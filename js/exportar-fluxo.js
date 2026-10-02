/* ERP · exportar-fluxo.js — fluxo de caixa em Excel, no formato da
   planilha que a empresa já usa, com FÓRMULAS de verdade.

   A planilha não é um retrato morto: trocar "S" por "N" na coluna
   Pagar? recalcula a saída efetiva, o movimento líquido e todo o saldo
   acumulado dali para baixo — igual à planilha manual. O Resumo puxa
   dos dois fluxos por SUMIFS, então também acompanha.

   Usa ExcelJS porque a biblioteca anterior (SheetJS Community) escreve
   valores mas ignora formatação: saía tudo cru, sem cabeçalho, sem
   moeda e sem congelar painel. */
window.ERP = window.ERP || {};

ERP.exportarFluxo = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;

  /* Data vai como número de série do Excel, não como objeto Date: é o
     que garante que a célula seja data de verdade em qualquer leitor, e
     é o formato que o SUMIFS compara sem tropeço. */
  const serial = iso => {
    if (!iso) return null;
    const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
    return Math.round((d.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
  };
  const dt = iso => serial(iso);
  const mesDe = iso => serial(iso ? iso.slice(0, 7) + '-01' : null);
  const n2 = v => Math.round((v || 0) * 100) / 100;

  const TINTA = 'FF1F2937';      // cabeçalho
  const CLARO = 'FFF2F4F5';      // faixas
  const MOEDA = '#,##0.00;[Red]-#,##0.00';
  const DATA = 'dd/mm/yyyy';

  const grupoDe = conta => {
    const c = D.plano.find(function (p) { return p.cod === conta; });
    if (!c) return { grupo: 'Sem classificação', sub: '' };
    const g = D.plano.find(function (p) { return p.cod === c.pai; });
    return { grupo: g ? g.nome : c.nome, sub: c.nome };
  };
  const projetoDe = p => {
    const r = (p.rateio || [])[0];
    return (D.centro(r ? r.centro : p.centro) || {}).curto || '';
  };
  /* Guia que reúne naturezas diferentes (ISS de NFs de 6.03 e 6.04)
     tem a composição em contas_rateio — o valor é repartido na mesma
     proporção entre as linhas de cada natureza. */
  const partesPorConta = function (p, valor) {
    const cr = p.contas_rateio;
    if (!cr || cr.length < 2) return [{ conta: p.conta, valor: valor }];
    const tot = cr.reduce(function (a, x) { return a + x.valor; }, 0) || 1;
    let acum = 0;
    return cr.map(function (x, i) {
      const v = i === cr.length - 1 ? n2(valor - acum) : n2(valor * x.valor / tot);
      acum += v;
      return { conta: x.conta, valor: v };
    });
  };
  // sigilo: quem não tem acesso a dados pessoais não vê nome em títulos de pessoal
  const descDe = p => S.descricaoVisivel(p);
  const credorDe = p => S.nomeCredorVisivel(p, ERP.lancamento.nomeCredor(p.credor));
  const grupoReceita = c => (c.tipo_servico === 'locacao'
    ? 'Receita - Locações' : 'Receita - Serviços médicos');

  /* ── realizado ──────────────────────────────────────────*/
  function realizado() {
    const L = [];
    S.todosPagamentos().forEach(function (pg) {
      const p = S.parcela(pg.parcela_id);
      if (!p) return;
      partesPorConta(p, n2(pg.valor + pg.juros + pg.multa)).forEach(function (pt) {
        const g = grupoDe(pt.conta);
        L.push({ data: pg.data, desc: descDe(p), entrada: 0,
          saida: pt.valor, grupo: g.grupo, sub: g.sub,
          projeto: projetoDe(p), fornecedor: credorDe(p),
          origem: 'Contas pagas' });
      });
    });
    S.contasReceber().forEach(function (r) {
      /* Recebido total ou parcial entra aqui — a versão anterior só
         pegava status 'recebido', então um recebimento parcial (que
         fica em 'faturado' com resíduo) nunca aparecia como
         realizado, mesmo com dinheiro de verdade já na conta. */
      const recebido = r.valor_recebido || 0;
      if (recebido <= 0.004) return;
      const c = D.centro(r.centro) || {};
      L.push({ data: r.recebido_em, desc: (c.curto || '') + ' — NF ' + r.numero,
        entrada: n2(recebido), saida: 0, grupo: grupoReceita(c),
        sub: c.curto || '', projeto: c.curto || '', fornecedor: r.cliente_nome,
        origem: 'Recebido' });
    });
    return L.sort(function (a, b) { return (a.data || '').localeCompare(b.data || ''); });
  }

  /* ── previsto ───────────────────────────────────────────
     Três origens: parcela em aberto, conta a receber pendente e a
     PREVISÃO por projeto. A previsão usa o que foi salvo no mês; onde
     não houver, cai na estimativa mensal do cadastro do projeto — é o
     mesmo número que a tela de Previsões mostra. Projeto que já
     faturou aquela competência não entra de novo. */
  function previsto(mesesFrente) {
    const L = [];
    S.todasParcelas().forEach(function (p) {
      if (['aberto', 'parcial', 'previsto', 'aguardando', 'autorizado', 'enviado'].indexOf(p.status) < 0) return;
      partesPorConta(p, n2(S.saldoDe(p))).forEach(function (pt) {
        const g = grupoDe(pt.conta);
        L.push({ data: p.venc, desc: descDe(p), entrada: 0, saida: pt.valor,
          pagar: 'S', grupo: g.grupo, sub: g.sub, projeto: projetoDe(p),
          fornecedor: credorDe(p), origem: 'Contas a pagar' });
      });
    });
    /* Retenção de NF que ainda não virou guia também vai sair do caixa:
       entra no dia 20 do mês seguinte à competência, na natureza da NF
       de origem (que é onde ela pesa na DRE). */
    S.retencoesPendentes().forEach(function (rt) {
      const nf = S.todasParcelas().find(function (p) { return p.titulo_id === rt.titulo_id; });
      if (nf && nf.status === 'cancelado') return;
      const g = grupoDe(rt.conta);
      L.push({ data: U.compDe(U.addMeses(rt.competencia + '-01', 1)) + '-20',
        desc: rt.tributo + ' retido de ' + (rt.nf_documento || 'NF') + ' (guia ainda não fechada)',
        entrada: 0, saida: n2(rt.valor), pagar: 'S', grupo: g.grupo, sub: g.sub,
        projeto: (D.centro((rt.rateio || [])[0] ? rt.rateio[0].centro : '') || {}).curto || '',
        fornecedor: rt.tributo === 'ISS' ? 'Prefeitura' : 'Receita Federal', origem: 'Retenção a recolher' });
    });
    S.contasReceber().filter(S.receberAberto).forEach(function (r) {
      /* Saldo que falta, não o líquido inteiro — um recebimento
         parcial já registrado não desaparece da conta, mas também não
         pode continuar pedindo o valor cheio no previsto. */
      const restante = S.saldoReceberDe(r);
      if (restante <= 0.004) return;
      const c = D.centro(r.centro) || {};
      L.push({ data: r.vencimento, desc: (c.curto || '') + ' — NF ' + r.numero,
        entrada: n2(restante), saida: 0, pagar: '', grupo: grupoReceita(c),
        sub: c.curto || '', projeto: c.curto || '', fornecedor: r.cliente_nome,
        origem: 'A receber' });
    });

    const projetos = D.centros.filter(function (c) { return c.ativo && c.tipo === 'projeto'; });
    const base = U.mesAtual();
    for (let i = 0; i < (mesesFrente || 6); i++) {
      const comp = U.compDe(U.addMeses(base + '-01', i));
      projetos.forEach(function (c) {
        const salva = S.previsaoDe(c.id, comp);
        // salva: entra o resíduo (previsto − faturado), e nada se encerrada
        const base = salva || { centro: c.id, competencia: comp, status: 'estimada',
          faturamento: c.prev_faturamento || 0, produtividade: c.prev_repasse || 0 };
        const res = S.residuoPrevisao(base);
        const fat = res.faturamento, rep = res.produtividade;
        if (!fat && !rep) return;
        const data = salva ? salva.data : S.dataPrevista(comp, S.prazoDe(c.id, null).dias);
        if (fat) {
          L.push({ data: data, desc: c.curto + ' — faturamento previsto ' + U.fComp(comp),
            entrada: n2(fat), saida: 0, pagar: '', grupo: grupoReceita(c),
            sub: c.curto, projeto: c.curto, fornecedor: '', origem: 'Previsão' });
        }
        if (rep) {
          L.push({ data: data, desc: 'Repasse produção — ' + c.curto + ' ' + U.fComp(comp),
            entrada: 0, saida: n2(rep), pagar: 'S',
            grupo: 'Custos diretos - Serviços médicos', sub: c.curto,
            projeto: c.curto, fornecedor: '', origem: 'Previsão' });
        }
      });
    }
    // despesas previstas que ainda não viraram título
    S.previsoesDespesa().forEach(function (pv) {
      const resto = S.residuoDespesa(pv);
      if (!resto) return;
      const g = grupoDe(pv.conta);
      L.push({ data: pv.data, desc: pv.descricao || (g.sub + ' — previsto'),
        entrada: 0, saida: resto, pagar: 'S', grupo: g.grupo, sub: g.sub,
        projeto: (D.centro(pv.centro) || {}).curto || '', fornecedor: '',
        origem: 'Previsão de despesa' });
    });

    return L.sort(function (a, b) { return (a.data || '').localeCompare(b.data || ''); });
  }

  /* ── formatação ─────────────────────────────────────────*/
  function estiloCabecalho(ws, linha, ate) {
    const r = ws.getRow(linha);
    r.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10.5, name: 'Arial' };
    r.height = 22;
    r.alignment = { vertical: 'middle' };
    for (let c = 1; c <= ate; c++) {
      r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TINTA } };
      r.getCell(c).border = { bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } } };
    }
  }
  function titulo(ws, cel, texto, tam) {
    ws.getCell(cel).value = texto;
    ws.getCell(cel).font = { bold: true, size: tam || 13, name: 'Arial' };
  }

  /* ── aba de fluxo, com fórmulas ─────────────────────────*/
  function abaFluxo(wb, nome, linhas, prev, saldoInicialRef) {
    const ws = wb.addWorksheet(nome, { views: [{ state: 'frozen', ySplit: prev ? 14 : 6 }] });
    const off = prev ? 1 : 0;                    // o previsto começa na coluna B
    const col = i => String.fromCharCode(65 + i + off);

    titulo(ws, prev ? 'C2' : 'B2', (prev ? 'FLUXO DE CAIXA PREVISTO' : 'FLUXO DE CAIXA REALIZADO') +
      ' — ' + D.empresa.nome);
    ws.getCell(prev ? 'C3' : 'B3').value = 'Gerado pelo ERP em ' + ERP.util.fDataHora(new Date());
    ws.getCell(prev ? 'C3' : 'B3').font = { size: 9, color: { argb: 'FF6B7280' }, name: 'Arial' };

    // bloco de saldos
    const bancos = D.bancos.filter(function (b) { return b.ativo; });
    const lin0 = 5;
    ws.getCell((prev ? 'D' : 'C') + lin0).value = 'Saldos bancários';
    ws.getCell((prev ? 'D' : 'C') + lin0).font = { bold: true, name: 'Arial' };
    ws.getCell((prev ? 'F' : 'E') + lin0).value = 'Saldo';
    ws.getCell((prev ? 'F' : 'E') + lin0).font = { bold: true, name: 'Arial' };
    bancos.forEach(function (b, i) {
      ws.getCell((prev ? 'D' : 'C') + (lin0 + 1 + i)).value = b.apelido;
      const c = ws.getCell((prev ? 'F' : 'E') + (lin0 + 1 + i));
      c.value = n2(b.saldo_inicial || 0);
      c.numFmt = MOEDA;
    });
    const linTotal = lin0 + 1 + bancos.length;
    ws.getCell((prev ? 'D' : 'C') + linTotal).value = prev ? 'Saldo de partida (fim do realizado)' : 'Total em bancos';
    ws.getCell((prev ? 'D' : 'C') + linTotal).font = { bold: true, name: 'Arial' };
    const celTotal = ws.getCell((prev ? 'F' : 'E') + linTotal);
    celTotal.value = prev
      ? { formula: saldoInicialRef }
      : { formula: 'SUM(' + (prev ? 'F' : 'E') + (lin0 + 1) + ':' + (prev ? 'F' : 'E') + (linTotal - 1) + ')' };
    celTotal.numFmt = MOEDA;
    celTotal.font = { bold: true, name: 'Arial' };

    const linCab = prev ? 14 : 6;
    const cab = prev
      ? ['Seq', 'Mês', 'Data', 'Descrição', 'Entrada', 'Saída', 'Pagar?', 'Saída efet.',
         'Mov. líq.', 'Saldo', '', 'Grupo', 'Subgrupo', 'Projeto', 'Fornecedor', '', '', 'Origem']
      : ['Seq', 'Mês', 'Data', 'Descrição', 'Entrada', 'Saída', 'Saída efet.', 'Mov. líq.',
         'Saldo', 'Revisar', '', 'Grupo', 'Subgrupo', 'Projeto', 'Fornecedor', '', '', 'Origem'];
    cab.forEach(function (t, i) { ws.getCell(linCab, i + 1 + off).value = t; });
    estiloCabecalho(ws, linCab, cab.length + off);

    // colunas de fórmula, por posição
    const cEnt = col(4), cSai = col(5);
    const cPag = prev ? col(6) : null;
    const cEfet = prev ? col(7) : col(6);
    const cLiq = prev ? col(8) : col(7);
    const cSaldo = prev ? col(9) : col(8);

    linhas.forEach(function (l, i) {
      const r = linCab + 1 + i;
      const row = ws.getRow(r);
      const set = (idx, v) => { row.getCell(idx + 1 + off).value = v; };
      set(0, i + 1);
      set(1, mesDe(l.data));
      set(2, dt(l.data));
      set(3, l.desc);
      set(4, l.entrada || null);
      set(5, l.saida || null);
      if (prev) set(6, l.pagar || '');
      // "Pagar? = N" zera a saída efetiva e o saldo se refaz sozinho
      row.getCell((prev ? 8 : 7) + off).value = prev
        ? { formula: 'IF(' + cPag + r + '="N",0,' + cSai + r + ')' }
        : { formula: cSai + r };
      row.getCell((prev ? 9 : 8) + off).value =
        { formula: cEnt + r + '-' + cEfet + r };
      row.getCell((prev ? 10 : 9) + off).value = {
        formula: (i === 0 ? (prev ? 'F' : 'E') + linTotal : cSaldo + (r - 1)) + '+' + cLiq + r
      };
      set(prev ? 11 : 10, '');
      set(prev ? 11 : 11, l.grupo);
      set(prev ? 12 : 12, l.sub);
      set(prev ? 13 : 13, l.projeto);
      set(prev ? 14 : 14, l.fornecedor);
      set(17, l.origem);

      [4, 5, prev ? 7 : 6, prev ? 8 : 7, prev ? 9 : 8].forEach(function (idx) {
        row.getCell(idx + 1 + off).numFmt = MOEDA;
      });
      row.getCell(2 + off).numFmt = 'mmm/yy';
      row.getCell(3 + off).numFmt = DATA;
      if (i % 2) {
        for (let c = 1 + off; c <= cab.length + off; c++) {
          row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CLARO } };
        }
      }
    });

    const ultima = linCab + linhas.length;
    ws.autoFilter = { from: { row: linCab, column: 1 + off }, to: { row: ultima, column: cab.length + off } };
    const larg = [6, 10, 11, 48, 14, 14, 8, 14, 14, 16, 2, 30, 28, 22, 30, 2, 2, 15];
    larg.forEach(function (w, i) { ws.getColumn(i + 1 + off).width = w; });
    ws.getColumn(1).width = prev ? 2 : 6;

    return { ws: ws, celSaldoFinal: cSaldo + ultima, linCab: linCab, ultima: ultima };
  }

  /* ── resumo com SUMIFS ──────────────────────────────────*/
  function abaResumo(wb, lr, lp, fr, fp) {
    const ws = wb.addWorksheet('Resumo fluxo', { views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }] });
    titulo(ws, 'B2', 'DRE GERENCIAL — ' + D.empresa.nome);
    ws.getCell('B3').value = 'Realizado + previsto, mês a mês. Puxa dos dois fluxos por SUMIFS: ' +
      'mexeu lá, muda aqui.';
    ws.getCell('B3').font = { size: 9, color: { argb: 'FF6B7280' }, name: 'Arial' };

    const meses = Array.from(new Set(lr.concat(lp).map(function (l) { return (l.data || '').slice(0, 7); })))
      .filter(Boolean).sort();
    const linCab = 4;
    ws.getCell(linCab, 2).value = 'Descrição';
    meses.forEach(function (m, i) {
      const c = ws.getCell(linCab, 3 + i);
      c.value = mesDe(m + '-01');
      c.numFmt = 'mmm/yy';
    });
    estiloCabecalho(ws, linCab, 2 + meses.length);

    // SUMIFS: soma no realizado pelo Mês+Subgrupo e no previsto idem
    const somaLinha = (linha, rotulo, coluna, campo, negativo) => {
      ws.getCell(linha, 2).value = rotulo;
      meses.forEach(function (m, i) {
        const letra = ws.getColumn(3 + i).letter;
        const cel = ws.getCell(linha, 3 + i);
        const alvoR = coluna === 'grupo' ? 'L' : 'M';
        const alvoP = coluna === 'grupo' ? 'M' : 'N';
        const valR = campo === 'entrada' ? 'E' : 'F';
        const valP = campo === 'entrada' ? 'F' : 'I';
        cel.value = { formula:
          "SUMIFS('Fluxo realizado'!$" + valR + ':$' + valR + ",'Fluxo realizado'!$B:$B," + letra + '$' + linCab +
          ",'Fluxo realizado'!$" + alvoR + ':$' + alvoR + ',$B' + linha + ')' +
          "+SUMIFS('Fluxo previsto'!$" + valP + ':$' + valP + ",'Fluxo previsto'!$C:$C," + letra + '$' + linCab +
          ",'Fluxo previsto'!$" + alvoP + ':$' + alvoP + ',$B' + linha + ')' };
        cel.numFmt = MOEDA;
      });
    };

    let L = linCab + 1;
    const receitas = Array.from(new Set(lr.concat(lp)
      .filter(function (l) { return l.grupo.indexOf('Receita') === 0; })
      .map(function (l) { return l.sub; }))).filter(Boolean).sort();
    const despesas = Array.from(new Set(lr.concat(lp)
      .filter(function (l) { return l.grupo.indexOf('Receita') !== 0; })
      .map(function (l) { return l.grupo; }))).filter(Boolean).sort();

    ws.getCell(L, 2).value = 'RECEITA';
    ws.getRow(L).font = { bold: true, name: 'Arial' };
    const linReceitaIni = L + 1;
    L++;
    receitas.forEach(function (sub) { somaLinha(L++, sub, 'sub', 'entrada'); });
    const linReceitaFim = L - 1;
    ws.getCell(L, 2).value = 'Receita total';
    ws.getRow(L).font = { bold: true, name: 'Arial' };
    meses.forEach(function (m, i) {
      const letra = ws.getColumn(3 + i).letter;
      const c = ws.getCell(L, 3 + i);
      c.value = { formula: 'SUM(' + letra + linReceitaIni + ':' + letra + linReceitaFim + ')' };
      c.numFmt = MOEDA;
    });
    const linReceitaTotal = L;
    L += 2;

    ws.getCell(L, 2).value = 'SAÍDAS POR GRUPO';
    ws.getRow(L).font = { bold: true, name: 'Arial' };
    const linSaidaIni = L + 1;
    L++;
    despesas.forEach(function (g) { somaLinha(L++, g, 'grupo', 'saida'); });
    const linSaidaFim = L - 1;
    ws.getCell(L, 2).value = 'Saídas totais';
    ws.getRow(L).font = { bold: true, name: 'Arial' };
    meses.forEach(function (m, i) {
      const letra = ws.getColumn(3 + i).letter;
      const c = ws.getCell(L, 3 + i);
      c.value = { formula: 'SUM(' + letra + linSaidaIni + ':' + letra + linSaidaFim + ')' };
      c.numFmt = MOEDA;
    });
    const linSaidaTotal = L;
    L += 2;

    ws.getCell(L, 2).value = 'RESULTADO DO MÊS';
    ws.getRow(L).font = { bold: true, size: 11, name: 'Arial' };
    meses.forEach(function (m, i) {
      const letra = ws.getColumn(3 + i).letter;
      const c = ws.getCell(L, 3 + i);
      c.value = { formula: letra + linReceitaTotal + '-' + letra + linSaidaTotal };
      c.numFmt = MOEDA;
      c.font = { bold: true, name: 'Arial' };
    });

    ws.getColumn(1).width = 2;
    ws.getColumn(2).width = 42;
    meses.forEach(function (m, i) { ws.getColumn(3 + i).width = 15; });
    return ws;
  }

  /* ── posições ───────────────────────────────────────────*/
  function abaTabela(wb, nome, cab, linhas, formatos) {
    const ws = wb.addWorksheet(nome, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(cab);
    estiloCabecalho(ws, 1, cab.length);
    linhas.forEach(function (l, i) {
      const row = ws.addRow(l);
      (formatos || []).forEach(function (f, c) {
        if (f) row.getCell(c + 1).numFmt = f;
      });
      if (i % 2) {
        for (let c = 1; c <= cab.length; c++) {
          row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CLARO } };
        }
      }
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: linhas.length + 1, column: cab.length } };
    cab.forEach(function (t, i) {
      ws.getColumn(i + 1).width = Math.max(12, Math.min(42, String(t).length + 8));
    });
    return ws;
  }

  /* ── geração ────────────────────────────────────────────*/
  function gerar() {
    if (!window.ExcelJS) return ERP.app.aviso('A biblioteca de Excel não carregou.', 'erro');
    const lr = realizado(), lp = previsto(6);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ERP Dom Pedro';
    wb.created = new Date();

    const fr = abaFluxo(wb, 'Fluxo realizado', lr, false, null);
    const fp = abaFluxo(wb, 'Fluxo previsto', lp, true,
      "'Fluxo realizado'!" + fr.celSaldoFinal);
    abaResumo(wb, lr, lp, fr, fp);

    abaTabela(wb, 'Contas a pagar',
      ['Fornecedor', 'Título', 'Tipo', 'Grupo', 'Subgrupo', 'Emissão', 'Vencimento',
       'Valor original', 'Saldo', 'Situação', 'Projeto', 'Competência', 'Forma', 'Origem'],
      S.todasParcelas().filter(function (p) {
        return p.status !== 'pago' && p.status !== 'cancelado';
      }).sort(function (a, b) { return (a.venc || '').localeCompare(b.venc || ''); })
        .map(function (p) {
          const g = grupoDe(p.conta);
          return [credorDe(p),
            (p.doc || '') + (p.total > 1 ? ' ' + p.num + '/' + p.total : ''),
            p.tipo_titulo || '', g.grupo, g.sub, dt(p.emissao), dt(p.venc),
            n2(p.valor), n2(S.saldoDe(p)), p.status, projetoDe(p), mesDe(p.comp + '-01'),
            (S.formaDoCredor(p.credor) || {}).nome || '', p.origem || ''];
        }),
      [null, null, null, null, null, DATA, DATA, MOEDA, MOEDA, null, null, 'mmm/yy']);

    abaTabela(wb, 'A receber-Recebido',
      ['Mês', 'Projeto', 'Tipo', 'Unidade', 'Valor bruto', 'Retido', 'Valor líquido',
       'Vencimento', 'Dt Receb.', 'Status', 'Cliente', 'NF'],
      S.contasReceber().map(function (r) {
        const c = D.centro(r.centro) || {};
        return [mesDe(r.competencia + '-01'), c.curto || '',
          c.tipo_servico === 'locacao' ? 'Locações' : 'Serviços médicos',
          c.unidade || '', n2(r.valor_bruto), n2(r.valor_retido), n2(r.valor_liquido),
          dt(r.vencimento), r.recebido_em ? dt(r.recebido_em) : null,
          r.status === 'recebido' ? 'Recebido' : 'A receber', r.cliente_nome, r.numero];
      }),
      ['mmm/yy', null, null, null, MOEDA, MOEDA, MOEDA, DATA, DATA]);

    abaTabela(wb, 'Previsões',
      ['Competência', 'Projeto', 'Unidade', 'Tipo', 'Faturamento previsto',
       'Repasse previsto', 'Margem prevista', 'Data no caixa', 'Faturado de verdade', 'Origem'],
      lp.filter(function (l) { return l.origem === 'Previsão' && l.entrada > 0; })
        .map(function (l) {
          const c = D.centros.find(function (x) { return x.curto === l.projeto; }) || {};
          const rep = lp.find(function (x) {
            return x.origem === 'Previsão' && x.projeto === l.projeto && x.data === l.data && x.saida > 0;
          });
          return [mesDe((l.data || '').slice(0, 7) + '-01'), l.projeto, c.unidade || '',
            D.TIPOS_SERVICO[c.tipo_servico] || '', n2(l.entrada), rep ? n2(rep.saida) : 0,
            n2(l.entrada - (rep ? rep.saida : 0)), dt(l.data), null,
            S.previsaoDe(c.id, (l.data || '').slice(0, 7)) ? 'salva no mês' : 'estimativa do cadastro'];
        }),
      ['mmm/yy', null, null, null, MOEDA, MOEDA, MOEDA, DATA]);

    // instruções por último, mas na frente
    const wsI = wb.addWorksheet('Instruções');
    titulo(wsI, 'B2', 'FLUXO DE CAIXA — ' + D.empresa.nome);
    [
      'Gerado pelo ERP em ' + ERP.util.fDataHora(new Date()),
      '',
      'A planilha tem fórmulas de verdade — não é um retrato morto.',
      '',
      '• Coluna "Pagar?" no Fluxo previsto: trocar S por N zera a saída efetiva daquela linha',
      '  e o saldo acumulado se refaz dali para baixo, como na planilha manual.',
      '• Coluna "Saldo": saldo anterior mais o movimento líquido da linha.',
      '• O Fluxo previsto parte do saldo final do Fluxo realizado.',
      '• "Resumo fluxo" puxa dos dois fluxos por SUMIFS: mexeu no fluxo, muda no resumo.',
      '',
      'De onde vem cada linha (coluna Origem):',
      '• Contas pagas / Recebido — o que passou pelo banco.',
      '• Contas a pagar — parcela em aberto, pelo vencimento.',
      '• A receber — nota emitida, ainda não recebida.',
      '• Previsão — estimativa por projeto, nos meses que ainda não têm nota emitida.',
      '',
      'Editar este arquivo não muda o sistema: ele é uma fotografia com calculadora.'
    ].forEach(function (t, i) {
      wsI.getCell('B' + (4 + i)).value = t;
      wsI.getCell('B' + (4 + i)).font = { name: 'Arial', size: 10 };
    });
    wsI.getColumn(1).width = 2;
    wsI.getColumn(2).width = 100;
    wb.worksheets.forEach(function (ws) {
      ws.eachRow(function (row) {
        row.eachCell(function (cel) {
          if (!cel.font) cel.font = { name: 'Arial', size: 10 };
          else if (!cel.font.name) cel.font = Object.assign({}, cel.font, { name: 'Arial' });
        });
      });
    });
    // Instruções na primeira posição
    wb.worksheets.splice(0, 0, wb.worksheets.splice(wb.worksheets.indexOf(wsI), 1)[0]);
    wb.worksheets.forEach(function (ws, i) { ws.orderNo = i; });

    const nome = 'Fluxo_de_Caixa_' + U.hoje().replace(/-/g, '') + '.xlsx';
    wb.xlsx.writeBuffer().then(function (buf) {
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nome;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      ERP.app.aviso('Excel gerado: ' + lr.length + ' linhas realizadas, ' + lp.length +
        ' previstas (' + lp.filter(function (l) { return l.origem === 'Previsão'; }).length +
        ' de previsão por projeto). Com fórmulas: mude o "Pagar?" e o saldo recalcula.', 'ok');
    });
  }

  return { gerar: gerar, realizado: realizado, previsto: previsto };
})();
