/* ERP · exportar.js — um exportador só, em três formatos.

   Cada tela tinha seu "Exportar CSV". CSV resolve pra quem vai abrir no
   Excel e mexer, mas perde formatação e atrapalha quem só quer mandar o
   arquivo pra alguém. Aqui a mesma tabela sai em:
   - CSV (ponto e vírgula, BOM — abre direto no Excel em português);
   - XLSX de verdade (zip montado à mão, sem biblioteca externa);
   - PDF (via ERP.pdf), pra anexar em e-mail e imprimir.

   A tela só descreve as colunas e as linhas; o formato é escolha de
   quem exporta. */
window.ERP = window.ERP || {};

ERP.exportar = (function () {
  const U = () => ERP.util;

  /* ── CSV ────────────────────────────────────────────────*/
  function csv(nome, colunas, linhas) {
    const esc = function (v) {
      const s = v === null || v === undefined ? '' : String(v);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const cab = colunas.map(function (c) { return esc(c.titulo); }).join(';');
    const corpo = linhas.map(function (l) {
      return colunas.map(function (c) { return esc(valorDe(c, l, true)); }).join(';');
    }).join('\n');
    // o util.baixar já põe o BOM — não repetir, senão a 1ª coluna vem suja
    U().baixar(nome + '.csv', cab + '\n' + corpo, 'text/csv;charset=utf-8');
  }

  /* Valor da célula. `paraTexto` devolve já formatado (CSV e PDF);
     no Excel o número vai como número, pra dar pra somar na planilha. */
  function valorDe(coluna, linha, paraTexto) {
    const v = typeof coluna.valor === 'function' ? coluna.valor(linha) : linha[coluna.campo];
    if (v === null || v === undefined) return paraTexto ? '' : '';
    if (coluna.tipo === 'numero' && paraTexto) {
      return typeof v === 'number' ? U().num(v) : v;
    }
    /* Data vai pro Excel como DATA de verdade (objeto), senão a coluna
       fica como texto e não ordena nem filtra por período. No CSV e no
       PDF continua dd/mm/aaaa. */
    if (coluna.tipo === 'data' && !paraTexto) {
      const txt = String(v).trim();
      /* Traço é "não tem data", não texto: uma célula "—" no meio da
         coluna fazia o Excel tratar a coluna inteira como texto, e ela
         deixava de ordenar e de filtrar por período. */
      if (!txt || txt === '—' || txt === '-' || txt === '–') return null;
      const iso = /^\d{2}\/\d{2}\/\d{4}$/.test(txt) ? txt.split('/').reverse().join('-') : txt;
      const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + 'T12:00:00') : null;
      return d && !isNaN(d.getTime()) ? d : txt;
    }
    return v;
  }

  /* ── XLSX ───────────────────────────────────────────────
     Usa o ExcelJS que já vem com o sistema (o mesmo do fluxo de caixa):
     cabeçalho destacado, filtro pronto, coluna de valor como NÚMERO
     (dá pra somar na planilha) e largura ajustada. */
  function xlsx(nome, colunas, linhas, titulo, cabecalho, rodape) {
    if (!window.ExcelJS) return ERP.app.aviso('A biblioteca de Excel não carregou.', 'erro');
    const wb = new ExcelJS.Workbook();
    /* Uma aba só, com o nome do relatório: o financeiro pediu um
       arquivo por relatório, não uma pasta com as duas abas. */
    const ws = wb.addWorksheet((titulo || 'Dados').slice(0, 28).replace(/[\\/?*\[\]:]/g, '-'));
    ws.columns = colunas.map(function (c) {
      return { key: c.titulo, width: c.largura || 18 };
    });
    /* O TIMBRE no alto da planilha. A imagem flutua sobre as
       células, então as três primeiras linhas ficam reservadas para
       ela — senão a marca cobre o título do relatório. */
    let reservaTimbre = 0;
    if (ERP.timbre && ERP.timbre.png) {
      try {
        /* PNG, não JPEG: a planilha abre em 100% e o JPEG deixava
           sujeira em volta das letras. A imagem é inserida na metade
           do tamanho do arquivo, o que a deixa nítida em tela de
           alta resolução. */
        const id = wb.addImage({ base64: ERP.timbre.png, extension: 'png' });
        ws.addImage(id, { tl: { col: 0.2, row: 0.25 },
          ext: { width: ERP.timbre.pngLargura * 0.3, height: ERP.timbre.pngAltura * 0.3 } });
        ws.addRow([]); ws.addRow([]);
        reservaTimbre = 2;
      } catch (e) {
        /* Sem timbre a planilha ainda serve; sem dados, não. */
        console.warn('timbre não entrou na planilha:', e);
      }
    }

    /* Cabeçalho do relatório (título, período, saldo bancário) antes da
       tabela, como na planilha que o financeiro já usa. */
    const linhasCab = (cabecalho || []).length + reservaTimbre;
    (cabecalho || []).forEach(function (linha, i) {
      const r = ws.addRow(Array.isArray(linha) ? linha : [linha]);
      r.font = { bold: i === 0, size: i === 0 ? 13 : 11 };
      /* CADA TEXTO OCUPA ATÉ A PRÓXIMA CÉLULA PREENCHIDA. "Período:
         01/10/2026 a 31/10/2026" saía como "Período: 01," porque a
         coluna A é estreita e o Excel corta no vizinho ocupado.
         Mesclar com as células vazias à frente resolve sem alargar
         coluna nenhuma. */
      /* CADA TEXTO OCUPA O QUE PRECISA. "Período: 01/10/2026 a
         31/10/2026" saía como "Período: 01," porque a coluna A é
         estreita e o Excel corta no vizinho ocupado.

         Mesclar com as vazias à frente não bastava: se o grupo não
         soma largura suficiente, o texto continua cortado. Então o
         grupo cresce até caber, e o que vinha depois é empurrado
         para a primeira coluna livre — ninguém perde conteúdo, e
         nenhuma coluna de dados é alargada por causa do cabeçalho. */
      const vals = Array.isArray(linha) ? linha : [linha];
      const itens = [];
      vals.forEach(function (v, c) {
        if (v !== '' && v !== null && v !== undefined) itens.push({ v: v, col: c });
      });
      /* limpa a linha: ela é remontada nas posições calculadas */
      for (let c = 1; c <= Math.max(colunas.length, vals.length); c++) r.getCell(c).value = null;

      let cursor = 0;
      itens.forEach(function (it, k) {
        const inicio = Math.max(cursor, it.col);
        const texto = String(it.v);
        const precisa = typeof it.v === 'number' ? 12 : texto.length + 2;
        let fim = inicio, soma = 0;
        while (fim < colunas.length - 1 && soma < precisa) {
          soma += (ws.getColumn(fim + 1).width || 12);
          if (soma >= precisa) break;
          fim++;
        }
        /* O item seguinte é EMPURRADO, não usado como trava: travar
           aqui era o que mantinha "Período: 01/10/2026 a 31/10/2026"
           cortado em duas colunas estreitas. Como o próximo começa em
           `cursor`, ninguém é sobreposto. */
        fim = Math.min(fim, colunas.length - 1);

        const cel = r.getCell(inicio + 1);
        cel.value = it.v;
        if (typeof it.v === 'number') cel.numFmt = '#,##0.00';
        if (fim > inicio) {
          try { ws.mergeCells(r.number, inicio + 1, r.number, fim + 1); }
          catch (e) { /* já mesclado */ }
        }
        cursor = fim + 1;
      });
    });
    if (linhasCab) ws.addRow([]);
    const linhaTitulos = linhasCab ? linhasCab + 2 : 1;
    const rTit = ws.getRow(linhaTitulos);
    colunas.forEach(function (c, i) { rTit.getCell(i + 1).value = c.titulo; });
    linhas.forEach(function (l) {
      ws.addRow(colunas.map(function (c) { return valorDe(c, l, false); }));
    });
    (rodape || []).forEach(function (linha) {
      const r = ws.addRow(Array.isArray(linha) ? linha : [linha]);
      r.font = { bold: true };
      if (Array.isArray(linha)) {
        linha.forEach(function (v, c) { if (typeof v === 'number') r.getCell(c + 1).numFmt = '#,##0.00'; });
      }
    });
    /* SEM LINHAS DE GRADE. A grade do Excel pinta a planilha inteira,
       inclusive onde não há nada, e compete com os números. No lugar
       dela: faixas alternadas em azul muito claro, que guiam o olho
       pela linha, e um fio cinza entre as linhas. */
    const primeiraDados = linhaTitulos + 1;
    const ultimaDados = linhaTitulos + linhas.length;
    for (let n = primeiraDados; n <= ultimaDados; n++) {
      const r = ws.getRow(n);
      const par = (n - primeiraDados) % 2 === 1;
      for (let c = 1; c <= colunas.length; c++) {
        const cel = r.getCell(c);
        if (par) {
          cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FA' } };
        }
        cel.border = {
          bottom: { style: 'thin', color: { argb: 'FFBFC8D0' } }
        };
      }
    }

    rTit.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    /* Cabeçalho na cor da marca: a planilha sai parecendo documento
       do sistema, não exportação genérica. */
    rTit.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A4D' } };
    rTit.alignment = { vertical: 'middle' };
    rTit.height = 20;
    /* Congela o cabeçalho E mantém a grade desligada: são a mesma
       configuração de visualização, e definir duas vezes faz a
       segunda apagar a primeira. */
    ws.views = [{ state: 'frozen', ySplit: linhaTitulos, showGridLines: false }];
    ws.autoFilter = { from: { row: linhaTitulos, column: 1 }, to: { row: linhaTitulos, column: colunas.length } };
    /* LARGURA PELO CONTEÚDO. Antes era 18 para quase tudo, e aí
       "Competência" virava "Competênc", "Vencimento" virava
       "Vencimenti" e a pessoa tinha de arrastar coluna por coluna
       antes de conseguir ler. Mede o maior texto de cada coluna,
       com teto para uma descrição longa não empurrar o resto para
       fora da tela. */
    colunas.forEach(function (c, i) {
      let maior = String(c.titulo || '').length;
      linhas.forEach(function (l) {
        const v = valorDe(c, l, true);
        const t = v === null || v === undefined ? '' : String(v);
        if (t.length > maior) maior = t.length;
      });
      ws.getColumn(i + 1).width = Math.min(Math.max(maior + 3, 10), 46);
    });

    colunas.forEach(function (c, i) {
      const col = ws.getColumn(i + 1);
      if (c.tipo === 'numero' || c.tipo === 'data') {
        const fmt = c.tipo === 'numero' ? '#,##0.00' : 'dd/mm/yyyy';
        col.eachCell({ includeEmpty: false }, function (cell, n) { if (n > linhaTitulos) cell.numFmt = fmt; });
      }
    });
    wb.xlsx.writeBuffer().then(function (buf) {
      const url = URL.createObjectURL(new Blob([buf],
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url; a.download = nome + '.xlsx';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
  }

  /* ── PDF ────────────────────────────────────────────────*/
  /* PDF de lista larga: com muitas colunas tudo saía cortado ("Docu…",
     datas pela metade). Além de respeitar `pdf: false`, o gerador
     agora corta as colunas menos importantes até caber com folga —
     melhor um PDF legível com 10 colunas do que ilegível com 20. */
  function pdf(nome, colunas, linhas, titulo, subtitulo, cabecalho, rodape) {
    const usaveis = colunas.filter(function (c) { return c.pdf !== false; });
    const MAX = 12;
    const escolhidas = usaveis.length > MAX ? usaveis.slice(0, MAX) : usaveis;
    /* Conta TODAS as colunas que ficaram de fora — as marcadas para não
       sair no PDF e as cortadas pelo limite. Antes o rodapé dizia
       "1 coluna(s) só no Excel/CSV" com 12 ausentes. */
    const cortadas = colunas.length - escolhidas.length;
    ERP.pdf.tabela({
      titulo: titulo || nome,
      subtitulo: (subtitulo || ('Gerado em ' + ERP.util.fData(ERP.util.hoje()) + ' · ' + linhas.length + ' linha(s)')) +
        (cortadas ? ' · ' + cortadas + ' coluna(s) só no Excel/CSV' : ''),
      orientacao: colunas.length > 6 ? 'paisagem' : 'retrato',
      colunas: escolhidas.map(function (c) {
        return { titulo: c.titulo, largura: c.largura || 18,
          alinhar: c.tipo === 'numero' ? 'direita' : null,
          valor: function (l) { return valorDe(c, l, true); } };
      }),
      linhas: linhas,
      notas: (cabecalho || []).concat(rodape || []).map(function (l) {
        return Array.isArray(l) ? l.filter(function (v) { return v !== '' && v !== null && v !== undefined; })
          .map(function (v) { return typeof v === 'number' ? ERP.util.brl(v) : v; }).join(': ') : l;
      })
    }).salvar(nome + '.pdf');
  }

  /* Algumas telas (relatórios, a receber) montam a tabela em HTML e
     não têm uma lista de objetos por trás. Aqui a tabela renderizada
     vira colunas e linhas — e o que parece dinheiro vira número de
     verdade no Excel, senão a planilha chega sem poder somar. */
  function deTabela(tabela) {
    if (!tabela) return null;
    const ths = Array.prototype.slice.call(tabela.querySelectorAll('thead th'));
    /* Colunas sem título são de AÇÃO (botões "Baixar", "Editar") e a
       linha de TOTAL não é um registro — as duas sujavam o arquivo:
       coluna com o texto dos botões e o total exportado como se fosse
       mais um funcionário. */
    const usar = ths.map(function (th, i) {
      const t = th.textContent.trim();
      return { i: i, titulo: t, ok: !!t && !th.classList.contains('acoes') };
    }).filter(function (c) { return c.ok; });
    const cabs = usar.map(function (c) { return c.titulo; });
    const linhas = Array.prototype.map.call(tabela.querySelectorAll('tbody tr'), function (tr) {
      if (/^(total|soma)\b/i.test((tr.children[0] || {}).innerText || '')) return null;
      if (tr.classList.contains('total') || tr.classList.contains('linha-total')) return null;
      const celulas = Array.prototype.slice.call(tr.children);
      /* linha com menos células que o cabeçalho é subtotal/agrupamento
         e sairia deslocada uma coluna */
      if (celulas.length < ths.length) return null;
      return usar.map(function (c) {
        const td = celulas[c.i];
        return td ? td.innerText.replace(/\n+/g, ' ').trim() : '';
      });
    }).filter(function (l) { return l && l.some(function (c) { return c; }); });

    const ehNumero = function (i) {
      const vals = linhas.map(function (l) { return l[i] || ''; })
        .filter(function (v) { return v && v !== '—' && v !== '-' && v !== '–'; });
      return vals.length > 0 && vals.every(function (v) { return /^-?R?\$?\s?[\d.]+,\d{2}$|^-?[\d.]+,\d{2}$|^-?\d+$|^—$/.test(v); });
    };
    const paraNumero = function (v) {
      if (!v || v === '—') return null;
      const n = parseFloat(String(v).replace(/[R$\s.]/g, '').replace(',', '.'));
      return isFinite(n) ? n : v;
    };
    /* Célula vazia ou com travessão não descaracteriza a coluna: uma
       única "—" fazia a coluna inteira de datas sair como texto no
       Excel, sem ordenar nem filtrar. */
    const vazio = v => !v || v === '—' || v === '-' || v === '–';
    const ehData = function (i) {
      const vals = linhas.map(function (l) { return l[i] || ''; }).filter(function (v) { return !vazio(v); });
      return vals.length > 0 && vals.every(function (v) { return /^\d{2}\/\d{2}\/\d{4}$/.test(v); });
    };
    const colunas = cabs.map(function (t, i) {
      const num = ehNumero(i);
      const data = !num && ehData(i);
      return { titulo: t || 'Coluna ' + (i + 1), largura: num ? 14 : (data ? 13 : 24),
        tipo: num ? 'numero' : (data ? 'data' : null),
        valor: function (l) { return num ? paraNumero(l[i]) : (l[i] || ''); } };
    });
    return { colunas: colunas, linhas: linhas };
  }

  /* Menu único: a tela chama isto no clique do botão "Exportar". */
  function abrir(op) {
    /* Coluna marcada com `pular` sai do arquivo: é como as telas
       tiram as colunas de dinheiro de quem não tem acesso financeiro
       sem precisar montar duas listas de colunas. */
    op = Object.assign({}, op, {
      colunas: (op.colunas || []).filter(function (c) { return !c.pular; })
    });
    const n = (op.linhas || []).length;
    ERP.app.modal({
      titulo: 'Exportar · ' + (op.titulo || ''),
      fecharTxt: 'Cancelar',
      corpo: '<div class="ajuda">' + n + ' linha(s) com os filtros de agora. Escolha o formato:</div>' +
        '<div class="ap-acoes" style="margin-top:8px">' +
        '<button class="btn-linha" id="ex-xlsx">Excel (.xlsx)</button>' +
        '<button class="btn-sm" id="ex-pdf">PDF</button>' +
        '<button class="btn-sm" id="ex-csv">CSV</button></div>' +
        '<div class="ajuda">Excel abre com filtro pronto e os valores como número; ' +
        'PDF é pra anexar e imprimir; CSV é pra importar em outro sistema.</div>',
      aoAbrir: function () {
        const fechar = function () { ERP.app.fecharModal(); };
        U().el('ex-xlsx').addEventListener('click', function () {
          xlsx(op.nome, op.colunas, op.linhas, op.titulo, op.cabecalho, op.rodape); fechar();
        });
        U().el('ex-pdf').addEventListener('click', function () {
          pdf(op.nome, op.colunas, op.linhas, op.titulo, op.subtitulo, op.cabecalho, op.rodape); fechar();
        });
        U().el('ex-csv').addEventListener('click', function () {
          csv(op.nome, op.colunas, op.linhas); fechar();
        });
      }
    });
  }

  return { abrir: abrir, csv: csv, xlsx: xlsx, pdf: pdf, deTabela: deTabela };
})();
