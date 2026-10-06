/* ERP · ui-estoque.js — materiais por ARMAZÉM, custo médio ponderado móvel.

   O material fica em armazém, e o armazém aponta para o projeto — é
   assim que o consumo chega ao DRE. Material que vai direto para a
   unidade entra no armazém dela, sem passar pela sede.

   Quatro telas: posição com alerta, extrato, entrada de material
   (XML, PDF ou manual) e inventário inicial. Mais duas ações que
   movimentam vários materiais de uma vez: baixa e transferência. */
window.ERP = window.ERP || {};

ERP.estoque = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;
  let aba = 'posicao';
  let sel = new Set();
  let buscaMov = '';   // busca do extrato
  let fMov = {};       // período do extrato
  let pedidoSel = '';  // pedido vinculado na entrada (sobrevive ao render)
  let armEntrada = ''; // armazém escolhido na entrada
  let linhasEntrada = [];
  /* Texto digitado na busca da posição de estoque. */
  let buscaPosicao = '';
  let notaLida = null;

  function montar() {
    document.querySelectorAll('#es-nav button').forEach(function (b) {
      b.addEventListener('click', function () { aba = this.dataset.es; sel.clear(); render(); });
    });
    U.el('es-armazem').addEventListener('change', render);
    U.el('es-baixa').addEventListener('click', function () { abrirBaixa(); });
    U.el('es-transferir').addEventListener('click', abrirTransferencia);
  }

  const ativos = () => D.armazens.filter(function (a) { return a.ativo; });
  const nomeArm = id => (D.armazem(id) || {}).nome || '—';
  const projetoDe = id => (D.centro((D.armazem(id) || {}).centro) || {}).curto || '—';

  /* Seleção do topo. Além dos armazéns, um armazém que tem setores
     ganha a opção "casa inteira" (valor `tudo:<id>`), que soma o
     almoxarifado e os setores dele por material. */
  const casaSel = () => {
    const v = U.val('es-armazem') || '';
    return v.indexOf('tudo:') === 0 ? v.slice(5) : null;
  };
  const armSel = () => {
    const v = U.val('es-armazem') || '';
    return v.indexOf('tudo:') === 0 ? '' : v;
  };
  /* os armazéns que a seleção atual cobre, para extrato e alertas */
  const idsSel = () => {
    const casa = casaSel();
    return casa ? D.comSetores(casa) : (armSel() ? [armSel()] : null);
  };

  function opcoesArmazem(sel2, todos, somenteSetoresDe) {
    if (somenteSetoresDe) {
      const fs = D.setoresDe(somenteSetoresDe);
      return '<option value="">Escolher setor…</option>' + fs.map(function (a) {
        return '<option value="' + a.id + '"' + (a.id === sel2 ? ' selected' : '') + '>' +
          U.esc(a.codigo + ' · ' + a.nome) + '</option>';
      }).join('');
    }
    const opc = a => '<option value="' + a.id + '"' + (a.id === sel2 ? ' selected' : '') + '>' +
      U.esc((a.pai ? '   └ ' : '') + a.codigo + ' · ' + a.nome) + '</option>';
    return (todos ? '<option value="">Todos os armazéns</option>' : '<option value="">Escolher…</option>') +
      D.principais().map(function (a) {
        const fs = D.setoresDe(a.id);
        if (!fs.length) return opc(a);
        return (todos ? '<option value="tudo:' + a.id + '"' +
                 ('tudo:' + a.id === sel2 ? ' selected' : '') + '>' +
                 U.esc(a.nome) + ' — principal e setores</option>' : '') +
          opc(a) + fs.map(opc).join('');
      }).join('');
  }

  function render() {
    document.querySelectorAll('#es-nav button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.es === aba);
    });
    if (!U.el('es-armazem').options.length) U.el('es-armazem').innerHTML = opcoesArmazem('', true);
    U.el('es-saida').innerHTML =
      aba === 'familias'  ? telaFamilias() :
      aba === 'posicao'   ? posicao() :
      aba === 'extrato'   ? extrato() :
      aba === 'pacientes' ? telaPacientes() :
      aba === 'entrada'   ? telaEntrada() :
      aba === 'relatorios' ? telaRelatoriosEstoque() :
                            telaInventario();
    ligar();
    if (aba === 'relatorios') ligarRelatoriosEstoque();
  }


  /* ── relatórios de estoque ──────────────────────────────
     Três perguntas diferentes, que antes exigiam ler a tela de posição
     e somar à mão: quanto vale o estoque e onde ele está; o que
     movimentou no período; e quanto custa repor o que está faltando
     (para mandar a alguém autorizar). */
  let relE = 'posicao';
  let relEArm = '';
  /* Abre sem recorte de data: o estoque tem movimento antigo (o
     inventário inicial, por exemplo), e começar filtrado pelo mês
     mostrava zero e dava a impressão de relatório quebrado. */
  let relEDe = '';
  let relEAte = '';

  function timbreEstoque(sub, periodo) {
    const e = D.empresa || {};
    return '<div class="rel-timbre">' +
      '<div class="rel-emp">' + U.esc(e.nome || 'HJM Dom Pedro') +
        (e.cnpj ? '<span class="sub"> · CNPJ ' + U.esc(e.cnpj) + '</span>' : '') + '</div>' +
      '<h2 style="margin:2px 0 0">Estoque<span class="sub">' + U.esc(sub) + '</span></h2>' +
      '<div class="sub">' + U.esc(periodo || '') + ' · emitido em ' + U.fData(U.hoje()) +
        ' por ' + U.esc((S.usuario() || {}).nome || '') + '</div></div>';
  }

  /* Agrupa a posição por hospital (armazém principal) e por setor. */
  function posicaoAgrupada() {
    const linhas = [];
    D.armazens.filter(function (a) { return a.ativo; }).forEach(function (a) {
      S.posicaoEstoque(a.id).forEach(function (l) {
        if (l.saldo <= 0) return;
        const paiObj = D.paiDe(a.id);
        const pai = paiObj ? paiObj.id : a.id;
        linhas.push({
          armazem: a.id, armazem_nome: a.nome, codigo: a.codigo,
          hospital: (D.armazem(pai) || {}).nome || a.nome, hospital_id: pai,
          setor: D.ehSetor(a.id) ? a.nome : '(almoxarifado)',
          projeto: projetoDe(a.id),
          produto: l.produto, saldo: l.saldo, medio: l.medio, valor: l.valor
        });
      });
    });
    return linhas;
  }

  function somaPor(linhas, chave) {
    const m = {};
    linhas.forEach(function (l) {
      const k = l[chave] || '—';
      m[k] = m[k] || { chave: k, itens: 0, qtd: 0, valor: 0 };
      m[k].itens++;
      m[k].qtd = Math.round((m[k].qtd + l.saldo) * 1000) / 1000;
      m[k].valor = Math.round((m[k].valor + l.valor) * 100) / 100;
    });
    return Object.keys(m).map(function (k) { return m[k]; })
      .sort(function (a, b) { return b.valor - a.valor; });
  }

  function relPosicao() {
    const linhas = posicaoAgrupada();
    const total = linhas.reduce(function (s, l) { return s + l.valor; }, 0);
    const tab = (titulo, dados) =>
      '<h3 style="font-size:12px;margin:14px 0 4px">' + titulo + '</h3>' +
      '<table><thead><tr><th>' + titulo + '</th><th class="num" style="width:110px">Itens</th>' +
      '<th class="num" style="width:120px">Quantidade</th>' +
      (veCusto() ? '<th class="num" style="width:140px">Valor</th>' : '') +
      '</tr></thead><tbody>' +
      dados.map(function (x) {
        return '<tr><td class="desc">' + U.esc(x.chave) + '</td>' +
          '<td class="num sub">' + x.itens + '</td>' +
          '<td class="num sub">' + U.num(x.qtd) + '</td>' +
          (veCusto() ? '<td class="num">' + U.brl(x.valor) + '</td>' : '') + '</tr>';
      }).join('') +
      (veCusto() ? '<tr style="border-top:2px solid var(--ink)"><td><b>Total</b></td>' +
        '<td class="num sub">' + dados.reduce(function (s, x) { return s + x.itens; }, 0) + '</td>' +
        '<td></td><td class="num"><b>' + U.brl(dados.reduce(function (s, x) {
          return s + x.valor; }, 0)) + '</b></td></tr>' : '') +
      '</tbody></table>';

    return timbreEstoque('posição por hospital, setor e armazém', 'Posição de hoje') +
      '<div class="pr-confere">' +
        '<span>' + linhas.length + ' item(ns) com saldo</span>' +
        (veCusto() ? '<span>Valor total <b>' + U.brl(total) + '</b></span>' : '') +
      '</div>' +
      tab('Hospital', somaPor(linhas, 'hospital')) +
      tab('Setor', somaPor(linhas, 'setor')) +
      tab('Armazém', somaPor(linhas, 'armazem_nome')) +
      '<h3 style="font-size:12px;margin:14px 0 4px">Detalhe por material</h3>' +
      '<div class="tabela-rolagem"><table><thead><tr><th>Material</th>' +
        '<th style="width:150px">Armazém</th><th style="width:130px">Hospital</th>' +
        '<th class="num" style="width:100px">Saldo</th>' +
        (veCusto() ? '<th class="num" style="width:110px">Custo médio</th>' +
                     '<th class="num" style="width:120px">Valor</th>' : '') +
        '</tr></thead><tbody>' +
        linhas.slice().sort(function (a, b) {
          return a.produto.descricao.localeCompare(b.produto.descricao, 'pt-BR'); })
          .map(function (l) {
            return '<tr><td class="desc">' + U.esc(l.produto.descricao) + '</td>' +
              '<td class="sub col-material">' + U.esc(l.armazem_nome) + '</td>' +
              '<td class="sub col-material">' + U.esc(l.hospital) + '</td>' +
              '<td class="num">' + U.num(l.saldo) + '</td>' +
              (veCusto() ? '<td class="num sub">' + U.brl(l.medio) + '</td>' +
                           '<td class="num">' + U.brl(l.valor) + '</td>' : '') + '</tr>';
          }).join('') +
      '</tbody></table></div>';
  }

  function relMovimentos() {
    const f = { de: relEDe || undefined, ate: relEAte || undefined,
      armazem: relEArm || undefined };
    const movs = S.movimentos(f);
    const per = 'Período: ' + (relEDe ? U.fData(relEDe) : 'início') + ' a ' +
      (relEAte ? U.fData(relEAte) : U.fData(U.hoje()));
    const por = chave => {
      const m = {};
      movs.forEach(function (mv) {
        const am = D.armazem(mv.armazem) || {};
        const paiObj = D.paiDe(mv.armazem);
        const k = chave === 'hospital'
          ? ((D.armazem(paiObj ? paiObj.id : mv.armazem) || {}).nome || am.nome || '—')
          : (am.nome || '—');
        m[k] = m[k] || { chave: k, entradas: 0, saidas: 0, ve: 0, vs: 0 };
        if (mv.tipo === 'entrada') { m[k].entradas++; m[k].ve += mv.valor || 0; }
        else { m[k].saidas++; m[k].vs += mv.valor || 0; }
      });
      return Object.keys(m).map(function (k) {
        const x = m[k];
        x.ve = Math.round(x.ve * 100) / 100; x.vs = Math.round(x.vs * 100) / 100;
        return x;
      }).sort(function (a, b) { return (b.ve + b.vs) - (a.ve + a.vs); });
    };
    const tab = (titulo, dados) =>
      '<h3 style="font-size:12px;margin:14px 0 4px">Por ' + titulo + '</h3>' +
      '<table><thead><tr><th>' + titulo + '</th>' +
      '<th class="num" style="width:110px">Entradas</th>' +
      (veCusto() ? '<th class="num" style="width:130px">Valor entrada</th>' : '') +
      '<th class="num" style="width:110px">Saídas</th>' +
      (veCusto() ? '<th class="num" style="width:130px">Valor saída</th>' : '') +
      '</tr></thead><tbody>' +
      (dados.length ? dados.map(function (x) {
        return '<tr><td class="desc">' + U.esc(x.chave) + '</td>' +
          '<td class="num sub">' + x.entradas + '</td>' +
          (veCusto() ? '<td class="num">' + U.brl(x.ve) + '</td>' : '') +
          '<td class="num sub">' + x.saidas + '</td>' +
          (veCusto() ? '<td class="num">' + U.brl(x.vs) + '</td>' : '') + '</tr>';
      }).join('')
        : '<tr><td colspan="5" class="vazio">Sem movimento no período.</td></tr>') +
      '</tbody></table>';

    return timbreEstoque('movimentações do período', per) +
      '<div class="filtros">' +
        '<div class="f"><label for="re-de">De</label>' +
          '<input type="date" id="re-de" value="' + (relEDe || '') + '"></div>' +
        '<div class="f"><label for="re-ate">Até</label>' +
          '<input type="date" id="re-ate" value="' + (relEAte || '') + '"></div>' +
        '<div class="f"><label for="re-arm">Armazém</label><select id="re-arm">' +
          '<option value="">todos</option>' + opcoesArmazem(relEArm) + '</select></div>' +
        '<button class="btn-sm" id="re-exportar">Exportar</button>' +
      '</div>' +
      '<div class="pr-confere"><span>' + movs.length + ' movimento(s)</span></div>' +
      tab('hospital', por('hospital')) +
      tab('armazém', por('armazem'));
  }

  /* Pedido de compra com custo estimado: o que está abaixo do mínimo
     na unidade, quanto falta para chegar no ideal e quanto isso custa
     pelo último preço pago. É o papel que vai para quem autoriza. */
  function relPedido() {
    const base = S.posicaoEstoque(relEArm || null).filter(function (l) { return l.abaixo_unidade; });
    const linhas = base.map(function (l) {
      const qtd = l.sugerido || 0;
      return { produto: l.produto, armazem: (D.armazem(l.armazem) || {}).nome || '',
        projeto: projetoDe(l.armazem), saldo: l.saldo, unidade: l.saldo_unidade,
        minimo: l.minimo, ideal: l.ideal, qtd: qtd, medio: l.medio,
        custo: Math.round(qtd * (l.medio || 0) * 100) / 100 };
    }).sort(function (a, b) { return b.custo - a.custo; });
    const total = linhas.reduce(function (s, l) { return s + l.custo; }, 0);

    return timbreEstoque('pedido de compra — itens abaixo do mínimo',
        'Posição de ' + U.fData(U.hoje())) +
      '<div class="filtros">' +
        '<div class="f"><label for="re-arm2">Armazém</label><select id="re-arm2">' +
          '<option value="">todos</option>' + opcoesArmazem(relEArm) + '</select></div>' +
        '<button class="btn-sm" id="re-exportar-pedido">Exportar</button>' +
      '</div>' +
      '<div class="pr-confere">' +
        '<span>' + linhas.length + ' item(ns) a repor</span>' +
        (veCusto() ? '<span>Custo estimado <b>' + U.brl(total) + '</b></span>' : '') +
      '</div>' +
      (linhas.length
        ? '<div class="tabela-rolagem"><table><thead><tr><th>Material</th>' +
          '<th style="width:150px">Armazém</th><th class="num" style="width:90px">Saldo</th>' +
          '<th class="num" style="width:110px">Na unidade</th>' +
          '<th class="num" style="width:90px">Mínimo</th><th class="num" style="width:90px">Ideal</th>' +
          '<th class="num" style="width:100px">A comprar</th>' +
          (veCusto() ? '<th class="num" style="width:110px">Último custo</th>' +
                       '<th class="num" style="width:120px">Custo estimado</th>' : '') +
          '</tr></thead><tbody>' +
          linhas.map(function (l) {
            return '<tr><td class="desc">' + U.esc(l.produto.descricao) +
              '<div class="sub">' + U.esc(l.produto.codigo) + ' · ' +
              U.esc(l.produto.unidade) + '</div></td>' +
              '<td class="sub col-material">' + U.esc(l.armazem) + '</td>' +
              '<td class="num' + (l.saldo <= 0 ? ' erro' : ' sub') + '">' + U.num(l.saldo) + '</td>' +
              '<td class="num sub">' + U.num(l.unidade) + '</td>' +
              '<td class="num sub">' + U.num(l.minimo) + '</td>' +
              '<td class="num sub">' + U.num(l.ideal) + '</td>' +
              '<td class="num"><b>' + U.num(l.qtd) + '</b></td>' +
              (veCusto() ? '<td class="num sub">' + U.brl(l.medio) + '</td>' +
                           '<td class="num">' + U.brl(l.custo) + '</td>' : '') + '</tr>';
          }).join('') +
          (veCusto()
            ? '<tr style="border-top:2px solid var(--ink)"><td colspan="7"><b>Total estimado</b></td>' +
              '<td></td><td class="num"><b>' + U.brl(total) + '</b></td></tr>' : '') +
          '</tbody></table></div>' +
          '<div class="ajuda">Custo estimado pelo custo médio atual de cada material — serve para ' +
            'autorização, não como cotação. O preço final sai da cotação com o fornecedor.</div>'
        : '<div class="vazio"><strong>Nada abaixo do mínimo.</strong> Não há o que pedir agora.</div>');
  }

  function telaRelatoriosEstoque() {
    const abas = { posicao: 'Posição e custos', movimentos: 'Movimentações',
      pedido: 'Pedido de compra' };
    return '<div class="filtros"><div class="rel-nav" style="margin:0">' +
        Object.keys(abas).map(function (k) {
          return '<button data-re="' + k + '" aria-pressed="' + (relE === k) + '">' +
            abas[k] + '</button>'; }).join('') +
      '</div></div>' +
      (relE === 'movimentos' ? relMovimentos() :
       relE === 'pedido' ? relPedido() : relPosicao());
  }

  function ligarRelatoriosEstoque() {
    document.querySelectorAll('[data-re]').forEach(function (b) {
      b.addEventListener('click', function () { relE = this.dataset.re; render(); });
    });
    const liga = (id, fn) => { const e = U.el(id); if (e) e.addEventListener('change', fn); };
    liga('re-de', function () { relEDe = this.value; render(); });
    liga('re-ate', function () { relEAte = this.value; render(); });
    liga('re-arm', function () { relEArm = this.value; render(); });
    liga('re-arm2', function () { relEArm = this.value; render(); });

    const e1 = U.el('re-exportar');
    if (e1) e1.addEventListener('click', function () {
      const movs = S.movimentos({ de: relEDe || undefined, ate: relEAte || undefined,
        armazem: relEArm || undefined });
      if (!movs.length) return ERP.app.aviso('Sem movimento no período.', 'erro');
      ERP.exportar.abrir({
        nome: 'estoque-movimentacoes-' + (relEDe || 'inicio') + '-a-' + (relEAte || 'hoje'),
        titulo: 'Movimentações de estoque',
        subtitulo: 'Período: ' + (relEDe ? U.fData(relEDe) : 'início') + ' a ' +
          (relEAte ? U.fData(relEAte) : U.fData(U.hoje())),
        colunas: [
          { titulo: 'Data', largura: 12, tipo: 'data', valor: m => U.fData(m.data) },
          { titulo: 'Tipo', largura: 10, valor: m => m.tipo },
          { titulo: 'Material', largura: 40, valor: m =>
            ((D.produtos.find(function (x) { return x.id === m.produto; }) || {}).descricao || '') },
          { titulo: 'Armazém', largura: 26, valor: m => (D.armazem(m.armazem) || {}).nome || '' },
          { titulo: 'Quantidade', largura: 12, tipo: 'numero', valor: m => m.qtd },
          { titulo: 'Valor', largura: 14, tipo: 'numero', valor: m => m.valor || 0 },
          { titulo: 'Motivo', largura: 30, valor: m => m.motivo || '' },
          { titulo: 'Documento', largura: 18, valor: m => m.documento || '' },
          { titulo: 'Usuário', largura: 20, valor: m => m.usuario || '' }
        ],
        linhas: movs, cabecalho: cabecalhoExport('Movimentações de estoque')
      });
    });

    const e2 = U.el('re-exportar-pedido');
    if (e2) e2.addEventListener('click', function () {
      const base = S.posicaoEstoque(relEArm || null).filter(function (l) { return l.abaixo_unidade; });
      if (!base.length) return ERP.app.aviso('Nada abaixo do mínimo.', 'erro');
      const linhas = base.map(function (l) {
        return { descricao: l.produto.descricao, codigo: l.produto.codigo,
          unidade: l.produto.unidade, armazem: (D.armazem(l.armazem) || {}).nome || '',
          saldo: l.saldo, na_unidade: l.saldo_unidade, minimo: l.minimo, ideal: l.ideal,
          qtd: l.sugerido || 0, medio: l.medio,
          custo: Math.round((l.sugerido || 0) * (l.medio || 0) * 100) / 100 };
      }).sort(function (a, b) { return b.custo - a.custo; });
      const total = Math.round(linhas.reduce(function (s, l) { return s + l.custo; }, 0) * 100) / 100;
      ERP.exportar.abrir({
        nome: 'pedido-de-compra-' + U.hoje(),
        titulo: 'Pedido de compra — itens abaixo do mínimo',
        subtitulo: 'Posição de ' + U.fData(U.hoje()),
        colunas: [
          { titulo: 'Material', largura: 40, valor: l => l.descricao },
          { titulo: 'Código', largura: 14, valor: l => l.codigo },
          { titulo: 'Unidade', largura: 10, valor: l => l.unidade },
          { titulo: 'Armazém', largura: 26, valor: l => l.armazem },
          { titulo: 'Saldo', largura: 10, tipo: 'numero', valor: l => l.saldo },
          { titulo: 'Na unidade', largura: 12, tipo: 'numero', valor: l => l.na_unidade },
          { titulo: 'Mínimo', largura: 10, tipo: 'numero', valor: l => l.minimo },
          { titulo: 'Ideal', largura: 10, tipo: 'numero', valor: l => l.ideal },
          { titulo: 'A comprar', largura: 12, tipo: 'numero', valor: l => l.qtd },
          { titulo: 'Último custo', largura: 13, tipo: 'numero', valor: l => l.medio },
          { titulo: 'Custo estimado', largura: 15, tipo: 'numero', valor: l => l.custo }
        ],
        linhas: linhas,
        cabecalho: cabecalhoExport('Pedido de compra — para autorização'),
        rodape: [[], ['Itens a repor', linhas.length], ['Custo estimado total', total],
          [], ['Autorizado por', ''], ['Data', '']]
      });
    });
  }

  function cabecalhoExport(titulo) {
    const e = D.empresa || {};
    return [[e.nome || 'HJM Dom Pedro', '', 'CNPJ', e.cnpj || ''], [titulo],
      ['Emitido em', U.fData(U.hoje()) + ' por ' + ((S.usuario() || {}).nome || '')]];
  }

  /* ── consumo por paciente ───────────────────────────────
     Rastreabilidade que o diretor pediu, do lado de quem consulta: o
     que cada paciente consumiu, com quantidade, custo e período. Nome
     de paciente é dado de saúde, então a aba só abre pra quem tem a
     permissão. */
  let fPac = {};
  function telaPacientes() {
    if (!S.vePaciente()) {
      return '<div class="vazio"><strong>Sem permissão.</strong>' +
        'Nome de paciente é dado de saúde: peça a permissão "Ver e exportar nome de paciente" ' +
        'em Administração › Perfis.</div>';
    }
    const r = S.consumoPorPaciente(fPac);
    const linhas = r.linhas || [];
    const totalQtd = linhas.reduce(function (a, l) { return a + l.qtd; }, 0);
    const totalValor = Math.round(linhas.reduce(function (a, l) { return a + l.valor; }, 0) * 100) / 100;
    return '<h2>Consumo por paciente<span class="sub">material dado a cada paciente, por período</span></h2>' +
      '<div class="filtros">' +
        '<div class="f"><label for="pc-de">De</label><input type="date" id="pc-de" value="' + (fPac.de || '') + '"></div>' +
        '<div class="f"><label for="pc-ate">Até</label><input type="date" id="pc-ate" value="' + (fPac.ate || '') + '"></div>' +
        '<div class="f"><label for="pc-arm">Armazém</label><select id="pc-arm">' + opcoesArmazem(fPac.armazem || '', true) + '</select></div>' +
        '<div class="f"><label for="pc-nome">Paciente</label><input id="pc-nome" value="' + U.esc(fPac.paciente || '') + '" placeholder="parte do nome"></div>' +
        '<button class="btn-sm" id="pc-limpar" style="align-self:flex-end">Limpar</button>' +
        '<button class="btn-sm" id="pc-exportar" style="align-self:flex-end">Exportar</button>' +
      '</div>' +
      '<div class="ajuda">' + linhas.length + ' linha(s) · ' + U.num(totalQtd) + ' unidade(s) · ' + U.brl(totalValor) +
        ' · registro de acesso guardado na trilha de auditoria (LGPD).</div>' +
      (linhas.length
        ? '<table><thead><tr><th>Paciente</th><th>Material</th><th class="num">Qtd</th>' +
          (veCusto() ? '<th class="num">Custo</th>' : '') +
          '<th>Armazém</th><th>1ª saída</th><th>Última</th><th class="num">Baixas</th></tr></thead><tbody>' +
          linhas.map(function (l) {
            return '<tr><td class="desc">' + U.esc(l.paciente) + '</td>' +
              '<td class="desc">' + U.esc(l.produto.descricao || '') +
                '<div class="sub">' + U.esc(l.produto.codigo || '') + '</div></td>' +
              '<td class="num">' + U.num(l.qtd) + ' ' + U.esc(l.produto.unidade || '') + '</td>' +
              (veCusto() ? '<td class="num">' + U.brl(l.valor) + '</td>' : '') +
              '<td class="sub">' + U.esc(l.armazem) + '</td>' +
              '<td class="mono">' + U.fData(l.primeira) + '</td>' +
              '<td class="mono">' + U.fData(l.ultima) + '</td>' +
              '<td class="num">' + l.movimentos + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="vazio"><strong>Nenhum consumo com paciente nesse período.</strong>' +
          'O nome do paciente é informado na baixa de material.</div>');
  }

  /* ── posição e alerta ───────────────────────────────────*/
  /* Custo na tela de estoque vem do nível financeiro do módulo, na
     matriz de acesso. */
  const veCusto = () => S.veFinanceiro('estoque');

  /* Agrupar por família ou listar item a item. Fica fora da função
     porque a escolha tem de sobreviver ao redesenho. */
  let agruparFamilia = false;
  let familiasAbertas = {};

  function posicao() {
    if (casaSel()) return posicaoCasa(casaSel());
    if (agruparFamilia) return posicaoFamilia();
    const am = armSel();
    /* Sempre em ordem alfabética: a lista é de conferência, e o
       operador procura pelo nome do material, não pela ordem em que
       cada item entrou no sistema. */
    /* Busca por texto: digitar "seringa" mostra tudo que é seringa,
       em qualquer armazém. Procura na descrição e no código. */
    const q = String(buscaPosicao || '').trim().toUpperCase();
    const linhas = S.posicaoEstoque(am || null).slice().filter(function (l) {
      if (!q) return true;
      return (l.produto.descricao + ' ' + (l.produto.codigo || '')).toUpperCase().indexOf(q) >= 0;
    }).sort(function (a2, b2) {
      return a2.produto.descricao.localeCompare(b2.produto.descricao, 'pt-BR');
    });
    /* Dois alertas diferentes: falta na UNIDADE inteira (aí é compra) e
       falta só neste setor, com saldo em outro (transferência interna). */
    const alertas = linhas.filter(function (l) { return l.abaixo_unidade; });
    const transferir = linhas.filter(function (l) { return l.so_transferir; });
    const valor = linhas.reduce(function (s, l) { return s + l.valor; }, 0);
    const marcados = linhas.filter(function (l) { return sel.has(l.produto.id + '|' + l.armazem); });

    return '<div class="filtros">' +
        '<div class="f" style="flex:1"><label for="es-busca">Buscar material</label>' +
          '<input id="es-busca" value="' + U.esc(buscaPosicao || '') +
          '" placeholder="digite parte do nome ou o código — ex.: seringa"></div>' +
        (q ? '<button class="btn-sm" id="es-busca-limpa">Limpar</button>' : '') +
        '<button class="btn-sm" id="es-familia">Agrupar por família</button>' +
      '</div>' +
      '<div class="pr-confere">' +
        '<span>Itens em estoque <b>' + linhas.length + '</b>' +
          (q ? ' <span class="sub">de ' + S.posicaoEstoque(am || null).length + '</span>' : '') +
          '</span>' +
        (veCusto() ? '<span>Valor do estoque <b>' + U.brl(valor) + '</b></span>' : '') +
        '<span>Falta na unidade <b class="' + (alertas.length ? 'erro' : '') + '">' + alertas.length + '</b></span>' +
        '<span>Só transferir <b>' + transferir.length + '</b></span>' +
        (veCusto() ? '<span>Custo <b>médio ponderado</b></span>' : '') +
      '</div>' +
      (alertas.length
        ? '<div class="aviso" style="margin:10px 0;border-left-color:var(--red)">' +
          '<b>' + alertas.length + ' item(ns) abaixo do mínimo na unidade inteira.</b> Aqui falta de verdade: ' +
          'marque o que quer repor e clique em "Requisitar" — a sugestão já desconta o saldo dos outros setores.</div>'
        : '') +
      (transferir.length
        ? '<div class="aviso" style="margin:10px 0">' +
          '<b>' + transferir.length + ' item(ns) faltando só neste setor.</b> Tem saldo em outro setor ou no ' +
          'almoxarifado da mesma unidade — resolva por transferência interna, sem abrir compra.</div>'
        : '') +
      (S.pode('requisitar')
        ? '<div class="ap-acoes">' +
          '<button class="btn-sm" id="es-marcar-alerta">Marcar os que faltam na unidade</button>' +
          '<button class="btn-sm" id="es-desmarcar">Desmarcar</button>' +
          '<button class="btn-linha" id="es-requisitar"' + (marcados.length ? '' : ' disabled') + '>' +
            'Requisitar ' + (marcados.length || '') + ' item(ns)</button>' +
        '</div>'
        : '') +
      /* Colunas com largura fixa e só o número: as observações
         embaixo do saldo ("zerado aqui", "80,00 em outros armazéns")
         empurravam as colunas de tamanhos diferentes e repetiam o que
         os próprios números já dizem. A situação, à direita, cobre o
         que precisava de aviso. */
      '<div class="tabela-rolagem" style="margin:0 -14px"><table class="tab-estoque"><thead><tr>' +
      '<th style="width:28px"></th>' +
      '<th style="width:auto">Material</th>' +
      '<th style="width:110px">Armazém</th>' +
      '<th style="width:130px">Projeto</th>' +
      '<th class="num" style="width:110px">Neste armazém</th>' +
      '<th class="num" style="width:120px">Total no hospital</th>' +
      '<th class="num" style="width:90px">Mínimo</th>' +
      '<th class="num" style="width:90px">Ideal</th>' +
      (veCusto() ? '<th class="num" style="width:110px">Custo médio</th>' +
                   '<th class="num" style="width:110px">Valor</th>' : '') +
      '<th class="num" style="width:100px">Sugerido</th>' +
      '<th style="width:150px">Situação</th></tr></thead><tbody>' +
      (linhas.length ? linhas.map(function (l) {
        const k = l.produto.id + '|' + l.armazem;
        return '<tr class="' + (sel.has(k) ? 'sel' : '') + '">' +
          /* Requisitar não é privilégio de quem está abaixo do mínimo:
             material de uso eventual nunca dispara o alerta e mesmo
             assim precisa ser pedido. Todas as linhas ganham caixa. */
          '<td><input type="checkbox" style="width:auto" data-es="' + k + '"' +
            (sel.has(k) ? ' checked' : '') + '></td>' +
          '<td class="desc">' + U.esc(l.produto.descricao) +
            '<div class="sub">' + U.esc(l.produto.codigo) + ' · ' + U.esc(l.produto.unidade) +
            '</div></td>' +
          '<td>' + U.esc((D.armazem(l.armazem) || {}).codigo || '—') + '</td>' +
          '<td class="sub">' + U.esc(projetoDe(l.armazem)) + '</td>' +
          '<td class="num">' + U.num(l.saldo) + '</td>' +
          '<td class="num' + (l.abaixo_unidade ? ' erro' : ' sub') + '">' +
            U.num(l.saldo_unidade) + '</td>' +
          '<td class="num sub"><button class="btn-sm" data-min="' + l.produto.id + '|' + l.armazem + '" ' +
            'title="definir mínimo e ideal deste material NESTE armazém">' + U.num(l.minimo) + '</button></td>' +
          '<td class="num sub">' + U.num(l.ideal) + '</td>' +
          (veCusto() ? '<td class="num sub">' + U.brl(l.medio) + '</td>' +
                       '<td class="num">' + U.brl(l.valor) + '</td>' : '') +
          '<td class="num">' + (l.abaixo ? U.num(l.sugerido) : '—') + '</td>' +
          '<td>' + (l.so_transferir ? '<span class="badge b-aguardando">transferir de outro setor</span>' : l.zerado ? '<span class="badge b-reprovado">zerado</span>'
            : l.abaixo_unidade ? '<span class="badge b-pendente">abaixo do mínimo</span>'
            : '<span class="badge b-pago">ok</span>') + '</td></tr>';
      }).join('')
        : '<tr><td colspan="12" class="vazio"><strong>Sem estoque neste armazém.</strong>' +
          'Comece pelo inventário inicial ou dê entrada de uma nota.</td></tr>') +
      '</tbody></table></div>';
  }

  /* ── a casa inteira: almoxarifado + setores ─────────────
     Uma linha por material, com o saldo total e a quebra de onde ele
     está. É a visão de quem repõe: o total diz se falta no hospital,
     a quebra diz se falta só no setor que consome. */
  /* ── Estoque agrupado por família ──────────────────────────
     Cento e vinte lentes em vinte graus são vinte linhas, e nenhuma
     responde "quantas lentes eu tenho". A família responde — e, ao
     abrir, mostra os graus.

     Os graus ZERADOS aparecem de propósito: saber que o +21,0
     acabou é mais útil que não ver a linha, porque é justamente o
     que precisa de reposição. */
  /* ── Famílias de material ──────────────────────────────────
     A família é o que permite dizer "uma lente intraocular" sem
     dizer qual grau: no estoque ela junta as variações numa linha
     só, e no procedimento ela deixa a escolha do item para quem
     lança a cirurgia.

     É um campo de texto livre de propósito. Uma lista fechada
     exigiria cadastrar a família antes do material, e na prática
     a família só fica óbvia quando o segundo item parecido
     aparece. */
  let buscaFam = '';

  function telaFamilias() {
    const q = String(buscaFam || '').trim().toUpperCase();
    const lista = D.produtos.filter(function (p) {
      if (!p.ativo) return false;
      if (!q) return true;
      return (p.descricao + ' ' + (p.codigo || '') + ' ' + (p.familia || ''))
        .toUpperCase().indexOf(q) >= 0;
    }).sort(function (a2, b2) {
      /* Agrupados por família, e os sem família no fim: é a lista
         de trabalho de quem está organizando. */
      const fa = a2.familia || 'zzz', fb = b2.familia || 'zzz';
      if (fa !== fb) return fa.localeCompare(fb, 'pt-BR');
      return (a2.descricao || '').localeCompare(b2.descricao || '', 'pt-BR', { numeric: true });
    });

    const familias = [];
    D.produtos.forEach(function (p) {
      if (p.familia && familias.indexOf(p.familia) < 0) familias.push(p.familia);
    });
    const semFamilia = D.produtos.filter(function (p) { return p.ativo && !p.familia; }).length;

    let html = '<div class="filtros">' +
        '<div class="f" style="flex:1"><label for="fm-busca">Buscar material</label>' +
          '<input id="fm-busca" value="' + U.esc(buscaFam) + '" placeholder="ex.: lente"></div>' +
        (q ? '<button class="btn-sm" id="fm-limpa">Limpar</button>' : '') +
      '</div>' +
      '<div class="pr-confere">' +
        '<span>Famílias <b>' + familias.length + '</b></span>' +
        '<span>Materiais sem família <b>' + semFamilia + '</b></span>' +
      '</div>' +
      '<div class="ajuda" style="margin:8px 0">Materiais com a <b>mesma família</b> aparecem ' +
      'juntos no estoque e podem ser usados como material padrão de uma cirurgia, com quem lança ' +
      'escolhendo a variação. Deixe em branco o que não tem variação.</div>';

    if (!S.podeMover('cadastros')) {
      html += '<div class="aviso">Seu perfil não altera cadastro — a lista está em leitura.</div>';
    }

    html += '<datalist id="fm-existentes">' +
      familias.sort(function (a2, b2) { return a2.localeCompare(b2, 'pt-BR'); })
        .map(function (f) { return '<option value="' + U.esc(f) + '">'; }).join('') +
      '</datalist>';

    html += '<table class="rel"><thead><tr><th>Material</th><th style="width:40%">Família</th>' +
      '<th class="num">Saldo</th></tr></thead><tbody>' +
      lista.map(function (p) {
        const saldo = D.armazens.reduce(function (t, am) {
          return t + S.saldoEstoque(p.id, am.id);
        }, 0);
        return '<tr><td>' + U.esc(p.codigo + ' · ' + p.descricao) + '</td>' +
          '<td>' + (S.podeMover('cadastros')
            ? '<input list="fm-existentes" data-fam-prod="' + p.id + '" value="' +
              U.esc(p.familia || '') + '" placeholder="— sem família —">'
            : U.esc(p.familia || '—')) + '</td>' +
          '<td class="num' + (saldo ? '' : ' sub') + '">' + U.num(saldo) + '</td></tr>';
      }).join('') +
      '</tbody></table>';

    if (!lista.length) {
      html += '<div class="card"><div class="ajuda">Nenhum material com esse texto.</div></div>';
    }
    return html;
  }

  function ligarFamilias() {
    const bq = U.el('fm-busca');
    if (bq) {
      bq.addEventListener('change', function () { buscaFam = this.value; render(); });
    }
    const lp = U.el('fm-limpa');
    if (lp) lp.addEventListener('click', function () { buscaFam = ''; render(); });

    /* Grava ao sair do campo, não a cada tecla: redesenhar a tabela
       a cada letra tiraria o foco e faria perder o que está sendo
       digitado. */
    document.querySelectorAll('[data-fam-prod]').forEach(function (e) {
      e.addEventListener('change', function () {
        const p = D.produtos.find(function (x) { return x.id === this.dataset.famProd; }.bind(this));
        if (!p) return;
        const nova = this.value.trim();
        if ((p.familia || '') === nova) return;
        p.familia = nova || null;
        S.logarCadastro('produto', p.id, nova ? 'agrupou na família' : 'tirou da família',
          p.codigo + ' · ' + (nova || 'sem família'));
        ERP.app.aviso(nova ? 'Agrupado em "' + nova + '".' : 'Família removida.', 'ok');
      });
    });
  }

  function posicaoFamilia() {
    const am = armSel();
    const q = String(buscaPosicao || '').trim().toUpperCase();
    const grupos = S.estoquePorFamilia(am || null).filter(function (g) {
      if (!q) return true;
      return (g.nome || '').toUpperCase().indexOf(q) >= 0 ||
        g.itens.some(function (i) {
          return (i.descricao + ' ' + (i.codigo || '')).toUpperCase().indexOf(q) >= 0;
        });
    });

    const comFamilia = grupos.filter(function (g) { return g.familia; });
    const valor = grupos.reduce(function (a2, g) { return a2 + g.valor; }, 0);

    let html = '<div class="filtros">' +
        '<div class="f" style="flex:1"><label for="es-busca">Buscar material ou família</label>' +
          '<input id="es-busca" value="' + U.esc(buscaPosicao || '') +
          '" placeholder="ex.: lente"></div>' +
        (q ? '<button class="btn-sm" id="es-busca-limpa">Limpar</button>' : '') +
        '<button class="btn-sm" id="es-familia">Ver item a item</button>' +
      '</div>' +
      '<div class="pr-confere">' +
        '<span>Famílias <b>' + comFamilia.length + '</b></span>' +
        '<span>Linhas <b>' + grupos.length + '</b></span>' +
        (veCusto() ? '<span>Valor do estoque <b>' + U.brl(valor) + '</b></span>' : '') +
      '</div>';

    if (!grupos.length) {
      return html + '<div class="card"><div class="ajuda">Nada em estoque' +
        (q ? ' com esse texto' : '') + '. A família aparece quando os materiais têm o campo ' +
        '<b>família</b> preenchido no cadastro — é ele que junta "Lente +18,0" e "Lente +21,0" ' +
        'numa linha só.</div></div>';
    }

    html += '<table class="rel"><thead><tr><th>Material / família</th>' +
      '<th class="num">Saldo</th>' + (veCusto() ? '<th class="num">Valor</th>' : '') +
      '<th>Variações</th><th></th></tr></thead><tbody>';

    grupos.forEach(function (g, ix) {
      const chave = g.familia || g.itens[0].produto;
      const aberta = !!familiasAbertas[chave];
      const ehFamilia = !!g.familia && g.itens.length > 1;
      html += '<tr' + (ehFamilia ? ' style="font-weight:600;cursor:pointer" data-fam="' +
          U.esc(chave) + '"' : '') + '>' +
        '<td>' + (ehFamilia ? (aberta ? '▾ ' : '▸ ') : '') + U.esc(g.nome) + '</td>' +
        '<td class="num">' + U.num(g.total) + ' <span class="sub">' + U.esc(g.unidade) + '</span></td>' +
        (veCusto() ? '<td class="num">' + U.num(g.valor) + '</td>' : '') +
        '<td class="sub">' + (ehFamilia
          ? g.itens.length + ' variação(ões)' +
            (g.zerados ? ' · <span style="color:var(--red)">' + g.zerados + ' zerada(s)</span>' : '')
          : '—') + '</td>' +
        '<td class="sub">' + (ehFamilia ? (aberta ? 'fechar' : 'abrir') : '') + '</td></tr>';

      if (ehFamilia && aberta) {
        g.itens.forEach(function (i) {
          html += '<tr style="background:var(--surface-2,#f8fafb)">' +
            '<td style="padding-left:26px" class="' + (i.saldo ? '' : 'sub') + '">' +
              U.esc(i.descricao) +
              (i.saldo ? '' : ' <span class="badge b-cancelado">zerado</span>') + '</td>' +
            '<td class="num' + (i.saldo ? '' : ' sub') + '">' + U.num(i.saldo) + '</td>' +
            (veCusto() ? '<td class="num sub">' + U.num(i.saldo * i.medio) + '</td>' : '') +
            '<td class="sub">' + U.esc(i.codigo || '') + '</td><td></td></tr>';
        });
      }
    });
    html += '</tbody></table>' +
      '<div class="ajuda">Clique na família para abrir as variações. As <b>zeradas</b> continuam ' +
      'na lista: material que já esteve em estoque e acabou é o que precisa de reposição — some ' +
      'da tela é o que faz ninguém lembrar de repor.</div>';
    return html;
  }

  function posicaoCasa(paiId) {
    const linhas = S.posicaoConsolidada(paiId).slice().sort(function (a2, b2) {
      return a2.produto.descricao.localeCompare(b2.produto.descricao, 'pt-BR');
    });
    const setores = D.setoresDe(paiId);
    const alertas = linhas.filter(function (l) { return l.abaixo; });
    const valor = linhas.reduce(function (s, l) { return s + l.valor; }, 0);
    const noPrincipal = linhas.reduce(function (s, l) {
      const o = l.onde.find(function (x) { return x.armazem === paiId; });
      return s + (o ? o.valor : 0); }, 0);
    const saldoDe = (l, am) => {
      const o = l.onde.find(function (x) { return x.armazem === am; });
      return o ? o.saldo : 0;
    };

    return '<div class="pr-confere">' +
        '<span>Materiais <b>' + linhas.length + '</b></span>' +
        '<span>Setores <b>' + setores.length + '</b></span>' +
        (veCusto() ? '<span>Valor da casa <b>' + U.brl(valor) + '</b></span>' +
          '<span>No almoxarifado <b>' + U.brl(noPrincipal) + '</b></span>' +
          '<span>Distribuído <b>' + U.brl(Math.round((valor - noPrincipal) * 100) / 100) + '</b></span>' : '') +
        '<span>Abaixo do mínimo <b class="' + (alertas.length ? 'erro' : '') + '">' + alertas.length + '</b></span>' +
      '</div>' +
      '<div class="ajuda">Soma do almoxarifado com os setores. O mínimo é conferido contra o total ' +
      'da casa: setor zerado com material sobrando no almoxarifado é caso de distribuir, não de comprar.</div>' +
      (S.pode('estoque')
        ? '<div class="ap-acoes"><button class="btn-linha" id="es-distribuir">Distribuir para setor</button></div>'
        : '') +
      '<div class="tabela-rolagem" style="margin:0 -14px"><table><thead><tr>' +
      '<th>Material</th><th class="num">Total na casa</th><th class="num">Almoxarifado</th>' +
      setores.map(function (s) {
        return '<th class="num">' + U.esc((s.nome.split('·')[1] || s.nome).trim()) + '</th>'; }).join('') +
      '<th class="num">Mínimo</th>' +
      (veCusto() ? '<th class="num">Custo médio</th><th class="num">Valor</th>' : '') +
      '<th>Situação</th></tr></thead><tbody>' +
      (linhas.length ? linhas.map(function (l) {
        return '<tr>' +
          '<td class="desc">' + U.esc(l.produto.descricao) +
            '<div class="sub">' + U.esc(l.produto.codigo) + ' · ' + U.esc(l.produto.unidade) + '</div></td>' +
          '<td class="num"><b>' + U.num(l.saldo) + '</b></td>' +
          '<td class="num">' + U.num(l.no_principal) + '</td>' +
          setores.map(function (s) {
            const q = saldoDe(l, s.id);
            return '<td class="num' + (q ? '' : ' sub') + '">' + (q ? U.num(q) : '—') + '</td>';
          }).join('') +
          '<td class="num sub">' + U.num(l.minimo) + '</td>' +
          (veCusto() ? '<td class="num sub">' + U.brl(l.medio) + '</td>' +
                       '<td class="num">' + U.brl(l.valor) + '</td>' : '') +
          '<td>' + (l.zerado ? '<span class="badge b-reprovado">zerado</span>'
            : l.abaixo ? '<span class="badge b-pendente">abaixo do mínimo</span>'
            : '<span class="badge b-pago">ok</span>') + '</td></tr>';
      }).join('')
        : '<tr><td colspan="' + (setores.length + 5) + '" class="vazio">' +
          '<strong>Sem estoque nesta casa.</strong>Comece pelo inventário inicial ou dê entrada de uma nota.' +
          '</td></tr>') +
      '</tbody></table></div>';
  }

  /* Distribuição: origem travada no almoxarifado, destino só entre os
     setores dele. Reaproveita a transferência — o que muda é a trava e
     o vocabulário da tela. */
  function abrirDistribuicao(paiId) {
    const setores = D.setoresDe(paiId);
    if (!setores.length) return ERP.app.aviso('Este armazém não tem setores cadastrados.', 'erro');
    ERP.app.modal({
      titulo: 'Distribuir do ' + nomeArm(paiId),
      corpo:
        '<div class="row3"><div><label>Origem</label>' +
          '<input value="' + U.esc(nomeArm(paiId)) + '" disabled></div>' +
        '<div><label>Setor de destino *</label><select id="ds-dst">' +
          opcoesArmazem('', false, paiId) + '</select></div>' +
        '<div><label>Data</label><input type="date" id="ds-data" value="' + U.hoje() + '"></div></div>' +
        '<label>Documento</label><input id="ds-doc" placeholder="guia de distribuição interna">' +
        '<div id="ds-lista" style="margin-top:10px"></div>' +
        '<div class="ajuda">O material sai do almoxarifado pelo custo médio de lá e entra no setor com ' +
        'esse custo. O saldo muda de lugar dentro do mesmo projeto; o DRE só é tocado quando o setor ' +
        'consome.</div>',
      acoes: [{ txt: 'Distribuir', cls: 'btn-pagar', fn: function () {
        const itens = [];
        document.querySelectorAll('[data-ds]').forEach(function (e) {
          const q = U.parseValor(e.value);
          if (q > 0) itens.push({ produto: e.dataset.ds, qtd: q });
        });
        const r = S.distribuir({ origem: paiId, destino: U.val('ds-dst'), data: U.val('ds-data'),
          documento: U.val('ds-doc'), itens: itens });
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        ERP.app.aviso(r.n + ' material(is) distribuído(s) para ' + nomeArm(U.val('ds-dst')) + '.', 'ok');
        render();
      } }],
      aoAbrir: function () {
        const comS = S.comSaldo(paiId);
        U.el('ds-lista').innerHTML = !comS.length
          ? '<div class="vazio"><strong>Almoxarifado sem saldo.</strong></div>'
          : '<table><thead><tr><th>Material</th><th class="num">No almoxarifado</th>' +
            '<th class="num">Distribuir</th></tr></thead><tbody>' +
            comS.map(function (l) {
              return '<tr><td class="desc">' + U.esc(l.produto.descricao) + '</td>' +
                '<td class="num">' + U.num(l.saldo) + ' ' + U.esc(l.produto.unidade) + '</td>' +
                '<td><input class="num" data-ds="' + l.produto.id + '" inputmode="decimal" ' +
                  'style="max-width:80px"></td></tr>';
            }).join('') + '</tbody></table>';
      }
    });
  }

  /* ── extrato ────────────────────────────────────────────*/
  function extrato() {
    const ids = idsSel();
    const busca = (buscaMov || '').trim();
    /* Na casa inteira o extrato junta almoxarifado e setores, para a
       distribuição interna aparecer como as duas pontas que é. */
    const lista = (ids && ids.length > 1
      ? ids.reduce(function (acc, id) { return acc.concat(S.movimentos({ armazem: id })); }, [])
          .sort(function (a, b) { return (b.data + b.id).localeCompare(a.data + a.id); })
      : S.movimentos({ armazem: (ids && ids[0]) || null }))
      .filter(function (m) { return !busca || S.textoDoMovimento(m).indexOf(busca.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')) > -1; })
      .filter(function (m) { return (!fMov.de || m.data >= fMov.de) && (!fMov.ate || m.data <= fMov.ate); });
    const listaTela = lista.slice(0, 250);
    return '<div class="filtros"><div class="f" style="min-width:260px">' +
        '<label for="es-busca-mov">Buscar no extrato</label>' +
        '<input id="es-busca-mov" placeholder="material, motivo, requisição…" value="' + U.esc(busca) + '"></div>' +
        '<div class="f"><label for="es-mov-de">De</label><input type="date" id="es-mov-de" value="' + (fMov.de || '') + '"></div>' +
        '<div class="f"><label for="es-mov-ate">Até</label><input type="date" id="es-mov-ate" value="' + (fMov.ate || '') + '"></div>' +
        (busca ? '<button class="btn-sm" id="es-busca-limpar" style="align-self:flex-end">Limpar</button>' : '') +
      '</div>' +
      '<div class="ajuda">' + lista.length + ' movimento(s)' +
        (busca ? ' com "' + U.esc(busca) + '"' : '') +
        (lista.length > 250 ? ' · mostrando os 250 mais recentes (a exportação leva todos)' : '') + '.</div>' +
      '<div class="tabela-rolagem" style="margin:0 -14px"><table><thead><tr>' +
      '<th>Data da NF</th><th>Data da entrada</th><th>Lançado no sistema</th>' +
      '<th>Material</th><th>Armazém</th><th>Movimento</th>' +
      '<th class="num">Quantidade</th>' + (veCusto() ? '<th class="num">Custo</th>' : '') +
      '<th>Lote / validade</th><th>Motivo</th><th>Paciente</th><th>Doc.</th><th>Quem</th><th></th>' +
      '</tr></thead><tbody>' +
      (listaTela.length ? listaTela.map(function (m) {
        const p = D.produtos.find(function (x) { return x.id === m.produto; }) || {};
        /* Três datas lado a lado. A do sistema não é editável em lugar
           nenhum: é o que permite reconstruir depois por que o saldo de
           uma data passada mudou. */
        return '<tr><td class="mono sub">' + (m.data_nf ? U.fData(m.data_nf) : '—') + '</td>' +
          '<td class="mono">' + U.fData(m.data) + '</td>' +
          '<td class="mono sub">' + (m.lancado_em ? U.fData(m.lancado_em) : '—') +
            (m.lancado_em && m.data && m.lancado_em !== m.data
              ? '<div class="sub">retroativo</div>' : '') + '</td>' +
          '<td class="desc col-material" title="' + U.esc(p.descricao || '') + '">' +
            U.esc(p.descricao || '?') + '</td>' +
          '<td class="col-arm">' + U.esc((D.armazem(m.armazem) || {}).codigo || '—') + '</td>' +
          '<td>' + (m.tipo === 'entrada'
            ? '<span class="badge b-pago">entrada</span>'
            : '<span class="badge b-pendente">saída</span>') + '</td>' +
          '<td class="num">' + (m.tipo === 'entrada' ? '+' : '−') + U.num(m.qtd) + ' ' + U.esc(p.unidade || '') + '</td>' +
          (veCusto() ? '<td class="num">' + U.brl(m.valor) + '</td>' : '') +
          '<td class="mono sub">' + (m.lote ? U.esc(m.lote) : '—') +
            (m.validade ? '<div class="sub">val. ' + U.fData(m.validade) + '</div>' : '') + '</td>' +
          /* Motivo e observação truncados: o nome do procedimento com
             o médico e o paciente junto estourava a coluna e empurrava
             a tabela para fora da tela. O começo do texto é o que
             identifica; o resto fica no title, ao passar o mouse. */
          '<td class="sub col-motivo" title="' +
            U.esc([m.motivo, m.requisicao ? 'req ' + m.requisicao : '', m.observacao]
              .filter(Boolean).join(' · ')) + '">' +
            U.esc(String(m.motivo || '—').slice(0, 26)) +
            (String(m.motivo || '').length > 26 ? '…' : '') +
            (m.requisicao ? '<div class="sub">req ' + U.esc(m.requisicao) + '</div>' : '') +
            (m.observacao ? '<div class="sub">' + U.esc(m.observacao.slice(0, 30)) +
              (m.observacao.length > 30 ? '…' : '') + '</div>' : '') + '</td>' +
          /* Paciente: um nome aparece inteiro; vários (um por unidade)
             mostram os dois primeiros e abrem a lista completa no
             botão — é o que torna a rastreabilidade consultável. */
          '<td class="sub col-paciente">' + (!S.vePaciente() ? '<span class="sub">[restrito]</span>' :
            (m.pacientes && m.pacientes.length)
              ? U.esc(m.pacientes.slice(0, 2).join(', ')) +
                (m.pacientes.length > 2 ? ' +' + (m.pacientes.length - 2) : '') +
                ' <button class="btn-sm" data-mv-pac="' + m.id + '">ver ' + m.pacientes.length + '</button>'
              : (m.paciente ? U.esc(m.paciente) : '—')) + '</td>' +
          '<td class="mono sub col-doc" title="' + U.esc(m.documento || '') + '">' +
            U.esc(m.documento || '—') + '</td>' +
          '<td class="sub col-user">' + U.esc(m.usuario) +
            (m.estornado ? '<div class="sub erro">estornado</div>'
              : m.estorno_de ? '<div class="sub">estorno</div>' : '') + '</td>' +
          '<td class="acoes">' + (!m.estornado && !m.estorno_de && S.pode('estoque')
            ? '<button class="btn-sm btn-cancelar" data-estorno="' + m.id + '">Estornar</button>' : '') + '</td></tr>';
      }).join('')
        : '<tr><td colspan="14" class="vazio"><strong>' +
          (busca ? 'Nenhum movimento com esse texto.' : 'Nenhum movimento.') + '</strong></td></tr>') +
      '</tbody></table></div>' +
      '<div class="ap-acoes"><button class="btn-sm" id="es-extrato-csv">Exportar extrato</button></div>' +
      '<div class="ajuda">A saída é valorada pelo custo médio ponderado do momento — a entrada recalcula ' +
      'a média e a saída baixa por ela. Transferência sai pelo médio da origem e entra no destino com ' +
      'esse custo.</div>';
  }

  /* ── entrada de material: XML, PDF ou manual ────────────*/
  /* Despesas da nota e como dividi-las. Ficam fora da função
     porque a tela se redesenha ao escolher pedido ou ler XML, e o
     valor digitado não pode se perder nesse caminho. */
  let despesasNota = 0;
  let criterioRateio = 'quantidade';

  function telaEntrada() {
    return '<div class="pr-cab">' +
        '<div><label for="en-armazem">Armazém de destino *</label>' +
          '<select id="en-armazem">' + opcoesArmazem(armEntrada || armSel()) + '</select>' +
          '<div class="ajuda">Material que foi direto para a unidade entra no armazém dela — ' +
          'não precisa dar entrada na sede e transferir depois.</div></div>' +
        '<div><label for="en-nf-data">Data da NF</label>' +
          '<input type="date" id="en-nf-data" value="" disabled>' +
          '<div class="ajuda">Vem da nota lida. Sem nota, fica vazia.</div></div>' +
        '<div><label for="en-data">Data da entrada</label><input type="date" id="en-data" max="' + U.hoje() + '" value="' + U.hoje() + '">' +
          '<div class="ajuda">Começa igual à da nota e pode ser corrigida — a mercadoria chega ' +
          'depois da emissão. A data do lançamento no sistema é registrada sozinha.</div></div>' +
        '<div><label for="en-doc">Nota / documento</label><input id="en-doc" placeholder="nº da NF ou recibo"></div>' +
        /* DESPESAS DA NOTA: frete, seguro, o que vier no total e não
           por item. Sem ratear, o custo do estoque fica abaixo do
           que a empresa pagou — e o efeito aparece longe, no custo
           do material da cirurgia e na margem do projeto. */
        '<div><label for="en-despesas">Frete e outras despesas da nota</label>' +
          '<input class="num" id="en-despesas" inputmode="decimal" value="' +
            U.num(despesasNota) + '">' +
          '<div class="ajuda">Total da nota, não por item — o sistema divide entre os ' +
          'materiais abaixo.</div></div>' +
        '<div><label for="en-criterio">Dividir o frete por</label>' +
          '<select id="en-criterio">' +
            '<option value="quantidade"' + (criterioRateio === 'quantidade' ? ' selected' : '') +
              '>Quantidade — cada unidade leva a mesma fatia</option>' +
            '<option value="valor"' + (criterioRateio === 'valor' ? ' selected' : '') +
              '>Valor — item caro leva mais frete</option>' +
          '</select>' +
          '<div class="ajuda">Por quantidade serve para material parecido em peso e volume. ' +
          'Por valor, quando a nota mistura coisas de preço muito diferente — senão a gaze ' +
          'barata carrega o mesmo frete do equipamento caro.</div></div>' +
        /* Pedido e armazém agora vêm do ESTADO, não do padrão: escolher
           o pedido redesenha a tela pra trazer os itens, e os dois
           campos voltavam a zero — a entrada gravava sem pedido, o
           pedido ficava com 0 recebido e o frete era rateado de novo a
           cada carga. */
        '<div><label for="en-pedido">Vincular a pedido de compra</label><select id="en-pedido">' +
          '<option value="">Nenhum</option>' +
          S.pedidosAbertos().map(function (r) {
            return '<option value="' + r.id + '"' + (pedidoSel === r.id ? ' selected' : '') + '>' +
              U.esc(r.numero) + ' · ' + U.esc(nomeArm(r.armazem)) + '</option>'; }).join('') + '</select>' +
          (pedidoSel ? '<div class="ajuda">Itens carregados com o preço cotado e o frete rateado. ' +
            'Quantidade acima do pedido é recusada.</div>' : '') + '</div>' +
      '</div>' +
      '<div class="importar" style="margin-top:10px">' +
        '<div class="tit">Ler a nota (XML da NF-e/NFS-e ou PDF que nasceu digital)</div>' +
        '<input type="file" id="en-arquivo" accept=".xml,.pdf">' +
        '<div class="ajuda">Nota física, sem arquivo: preencha os itens à mão abaixo.</div>' +
        '<div id="en-info"></div>' +
      '</div>' +
      '<h2 style="font-size:12px;margin:14px 0 6px">Itens que entraram</h2>' +
      '<div id="en-itens"></div>' +
      (S.pode('lancar')
      ? '<div class="card" style="margin:12px 0 0;background:#fafbfc">' +
        '<label style="display:flex;gap:7px;align-items:center;font-weight:600">' +
          '<input type="checkbox" id="en-financeiro" style="width:auto" checked> ' +
          'Lançar também no contas a pagar</label>' +
        '<div class="ajuda">Fecha o ciclo num ato só: o material entra no estoque e a despesa nasce no ' +
        'financeiro, amarrada à mesma nota e ao mesmo pedido. Desmarque se a nota já foi lançada lá.</div>' +
        '<div class="row3" style="margin-top:8px">' +
          '<div><label>Fornecedor</label><input id="en-credor" list="dl-credores" ' +
            'placeholder="quem emitiu a nota"><div id="en-credor-sug"></div></div>' +
          '<div><label>Natureza</label><select id="en-conta">' +
            D.plano.filter(function (p) { return p.nivel === 2 && p.pai !== '1'; }).map(function (p) {
              return '<option value="' + p.cod + '"' + (p.cod === '8.04' ? ' selected' : '') + '>' +
                U.esc(p.cod + ' ' + p.nome) + '</option>'; }).join('') + '</select></div>' +
          '<div><label>Vencimento</label><input type="date" id="en-venc" value="' + U.hoje() + '"></div>' +
        '</div></div>'
      : '') +
      '<div class="form-acoes" style="margin:14px -14px -14px">' +
        '<span class="ajuda" style="margin-right:auto">O custo informado aqui entra na média ponderada ' +
        'daquele material no armazém.</span>' +
        '<button class="btn-primary" id="en-gravar" style="width:auto;margin:0">Dar entrada</button>' +
      '</div>';
  }

  /* Uma linha da nota pode estar em três estados: casada por
     identificador (certeza), com palpite de descrição (o usuário
     confirma, troca ou cadastra) ou sem nada parecido. A linha mostra
     em qual deles está, com o motivo — palpite sem motivo visível é
     palpite que ninguém confere. */
  function tiraSugestao(i, ix) {
    if (!i.itemNf) return '';
    const sug = i.sug || { candidatos: [] };
    const cands = sug.candidatos || [];
    const escolhido = cands.find(function (c) { return c.produto.id === i.produto; });
    const pct = c => U.pct(Math.round(c.score * 1000) / 10);

    let etiqueta;
    if (!i.produto) {
      etiqueta = cands.length
        ? '<span class="badge b-pendente">nada aceito ainda</span>'
        : '<span class="badge b-reprovado">sem nada parecido no cadastro</span>';
    } else if (i.cadastradoAgora) {
      /* Material recém-criado a partir desta mesma nota: não é "à mão"
         (o usuário não escolheu de uma lista) nem "casado" com um
         candidato antigo (não existia candidato — o produto não
         existia). Rótulo próprio evita a etiqueta enganosa. */
      etiqueta = '<span class="badge b-pago">cadastrado agora pela nota</span>';
    } else if (sug.certeza && escolhido) {
      etiqueta = '<span class="badge b-pago">casado por ' + U.esc(escolhido.motivo) + '</span>';
    } else if (escolhido) {
      etiqueta = '<span class="badge b-aguardando">sugestão ' + pct(escolhido) + ' · ' +
        U.esc(escolhido.motivo) + '</span>';
    } else {
      etiqueta = '<span class="badge b-aberto">escolhido à mão</span>';
    }

    /* Os outros candidatos viram botão: trocar de vínculo é um clique,
       não uma caçada na lista de todos os materiais. */
    const outros = cands.filter(function (c) { return c.produto.id !== i.produto; }).slice(0, 3);

    return '<div class="sub" style="grid-column:1/-1;line-height:1.7">' +
      'da nota: <b>' + U.esc(i.nome_nf) + '</b>' +
      (i.itemNf.codigo ? ' · cód. ' + U.esc(i.itemNf.codigo) : '') +
      (i.itemNf.ean ? ' · EAN ' + U.esc(i.itemNf.ean) : '') +
      (i.itemNf.ncm ? ' · NCM ' + U.esc(i.itemNf.ncm) : '') +
      '<br>' + etiqueta + ' ' +
      outros.map(function (c) {
        return '<button class="btn-sm" type="button" data-troca="' + ix + '|' + c.produto.id + '">' +
          U.esc(c.produto.codigo) + ' (' + pct(c) + ')</button>';
      }).join(' ') +
      ' <button class="btn-sm" type="button" data-cad="' + ix + '">' +
      (i.produto ? 'Cadastrar como novo' : 'Cadastrar este material') + '</button>' +
      '</div>';
  }

  /* Resumo da nota lida (nº, emitente, valor, quantos itens ainda sem
     vínculo). Extraído da leitura do arquivo pra poder ser chamado de
     novo depois de cadastrar ou trocar um vínculo — antes só rodava
     uma vez, na hora de ler o arquivo, e o "2 itens sem vínculo"
     continuava dizendo 2 mesmo depois de resolver os dois. */
  function atualizarInfoNota() {
    if (!notaLida || !U.el('en-info')) return;
    const nf = notaLida;
    const itensNf = nf.itens || [];
    const semCasar = linhasEntrada.filter(function (l) { return !l.produto; }).length;
    const aConfirmar = linhasEntrada.filter(function (l) {
      return l.produto && l.sug && !l.sug.certeza; }).length;
    const jaLancada = nf.chave && S.todasParcelas().some(function (p) { return p.chave === nf.chave; });
    U.el('en-info').innerHTML = '<div class="nf-lida"><b>' + U.esc(nf.rotulo || 'Nota lida') + '</b>' +
      (nf.numero ? ' nº ' + U.esc(nf.numero) : '') +
      (nf.emitente && nf.emitente.nome ? ' · ' + U.esc(nf.emitente.nome) : '') +
      '<br>' + U.brl(nf.valor || 0) +
      (itensNf.length ? ' · ' + itensNf.length + ' item(ns)' : ' · nota sem itens detalhados') +
      (semCasar ? '<div class="ajuda erro">' + semCasar + ' item(ns) sem vínculo — escolha o ' +
        'material na lista ou cadastre pelos dados da nota.</div>' : '') +
      (aConfirmar ? '<div class="ajuda">' + aConfirmar + ' item(ns) vieram por semelhança de ' +
        'descrição, não por código. Confira o vínculo antes de dar entrada.</div>' : '') +
      (nf.avisos && nf.avisos.length ? '<div class="ajuda">' + nf.avisos.map(U.esc).join('<br>') + '</div>' : '') +
      (jaLancada ? '<div class="ajuda erro">Esta chave já está lançada em outro título — desmarquei ' +
        '"lançar também no contas a pagar" pra não duplicar.</div>' : '') +
      '</div>';
  }

  function renderItensEntrada() {
    const box = U.el('en-itens');
    if (!box) return;
    if (!linhasEntrada.length) linhasEntrada = [{ produto: '', qtd: 0, un_emb: 1, custo: 0, lote: '', validade: '', nome_nf: '' }];
    const total = linhasEntrada.reduce(function (s, i) { return s + (i.qtd || 0) * (i.custo || 0); }, 0);
    /* O estoque é controlado em UNIDADES, porque é assim que a
       cirurgia consome: entra 1 caixa de máscara com 100, e a baixa é
       de 1 máscara. Por isso a entrada tem duas quantidades — como veio
       na nota e quantas unidades cada uma traz. Material que a nota já
       manda em unidade vem sugerido com 1. */
    const emUnidade = p => ['UN', 'UND', 'UNID', 'UNIDADE'].indexOf(String((p || {}).unidade || '')
      .toUpperCase()) >= 0;
    const unidades = linhasEntrada.reduce(function (s, i) {
      return s + (i.qtd || 0) * (i.un_emb || 1); }, 0);
    const colunas = 'grid-template-columns:2fr 70px 90px 90px 80px 100px 26px';
    box.innerHTML =
      '<div class="parcelas"><div class="cab" style="' + colunas + '">' +
        '<span>Material</span><span>Qtd da nota</span><span>Unid. por emb.</span>' +
        '<span>' + (veCusto() ? 'Custo unit.' : 'Custo') +
        '</span><span>Lote</span><span>Validade</span><span></span></div>' +
      linhasEntrada.map(function (i, ix) {
        const prod = D.produtos.find(function (p) { return p.id === i.produto; });
        const emb = i.un_emb === undefined ? (emUnidade(prod) ? 1 : '') : i.un_emb;
        const totalUn = (i.qtd || 0) * (Number(emb) || 1);
        return '<div class="lin" style="' + colunas + '">' +
          '<select data-i="' + ix + '" data-c="produto"><option value="">Escolher…</option>' +
            D.produtos.filter(function (p) { return p.ativo; }).map(function (p) {
              return '<option value="' + p.id + '"' + (p.id === i.produto ? ' selected' : '') + '>' +
                U.esc(p.codigo + ' · ' + p.descricao) + '</option>'; }).join('') + '</select>' +
          '<input class="num" data-i="' + ix + '" data-c="qtd" inputmode="decimal" value="' + U.num(i.qtd) + '">' +
          '<input class="num" data-i="' + ix + '" data-c="un_emb" inputmode="decimal" value="' +
            (emb === '' ? '' : U.num(emb)) + '" placeholder="' + (emUnidade(prod) ? '1' : '?') +
            '" title="quantas unidades vêm em cada ' + U.esc((prod || {}).unidade || 'embalagem') + '">' +
          '<input class="num" data-i="' + ix + '" data-c="custo" inputmode="decimal" value="' + U.num(i.custo) + '">' +
          '<input data-i="' + ix + '" data-c="lote" value="' + U.esc(i.lote || '') + '">' +
          '<input type="date" data-i="' + ix + '" data-c="validade" value="' + (i.validade || '') + '">' +
          '<button class="btn-ghost" data-rem="' + ix + '" type="button">✕</button>' +
          (totalUn && Number(emb) > 1
            ? '<div class="sub" style="grid-column:1/-1">entra no estoque como ' + U.num(totalUn) +
              ' unidade(s)' + (veCusto() && i.custo
                ? ' a ' + U.brl(Math.round(i.custo / (Number(emb) || 1) * 10000) / 10000) + ' cada' : '') +
              '</div>'
            : '') +
          (i.itemNf ? tiraSugestao(i, ix)
            : (i.nome_nf ? '<div class="sub" style="grid-column:1/-1">da nota: ' + U.esc(i.nome_nf) + '</div>' : '')) +
        '</div>';
      }).join('') +
      '<div class="rodape"><button class="btn-sm" id="en-add" type="button">+ outro material</button>' +
        '<span class="sub">' + U.num(unidades) + ' unidade(s)</span>' +
        '<span class="dif ok" id="en-total">' + U.brl(total) + '</span></div></div>';

    box.querySelectorAll('[data-troca]').forEach(function (b) {
      b.addEventListener('click', function () {
        const par = this.dataset.troca.split('|');
        lerItensEntrada();
        linhasEntrada[+par[0]].produto = par[1];
        delete linhasEntrada[+par[0]].cadastradoAgora;
        renderItensEntrada();
      });
    });
    box.querySelectorAll('[data-cad]').forEach(function (b) {
      b.addEventListener('click', function () {
        lerItensEntrada();
        cadastrarProdutoDaNota(+this.dataset.cad);
      });
    });

    /* Campo de texto e de data NÃO redesenham a lista.

       Era o defeito da validade do lote: o `change` de um
       <input type="date"> dispara assim que a data fica válida, e ao
       digitar o primeiro dígito do ano o navegador já monta uma data
       completa. O redesenho trocava o elemento, o foco ia embora e os
       outros três dígitos do ano não tinham onde entrar — parecia que
       a digitação começava no último dígito.

       Só o select de material redesenha, porque a tira de sugestão
       muda com ele; select não sofre desse problema. O total é
       atualizado à parte. */
    box.querySelectorAll('input').forEach(function (e) {
      e.addEventListener('input', function () { lerItensEntrada(); atualizarTotalEntrada(); });
      e.addEventListener('change', function () { lerItensEntrada(); atualizarTotalEntrada(); });
    });
    box.querySelectorAll('select').forEach(function (e) {
      e.addEventListener('change', function () {
        lerItensEntrada();
        if (this.dataset.c === 'produto') {
          const i = +this.dataset.i;
          delete linhasEntrada[i].cadastradoAgora;   // troca manual não é mais "recém-cadastrado"
          const p = D.produtos.find(function (x) { return x.id === linhasEntrada[i].produto; });
          if (p && !linhasEntrada[i].custo) linhasEntrada[i].custo = p.custo || 0;
        }
        renderItensEntrada();
      });
    });
    box.querySelectorAll('[data-rem]').forEach(function (b) {
      b.addEventListener('click', function () {
        linhasEntrada.splice(+this.dataset.rem, 1);
        renderItensEntrada();
      });
    });
    U.el('en-add').addEventListener('click', function () {
      lerItensEntrada();
      linhasEntrada.push({ produto: '', qtd: 0, custo: 0, lote: '', validade: '', nome_nf: '' });
      renderItensEntrada();
    });
    atualizarInfoNota();
  }

  function atualizarTotalEntrada() {
    const el = U.el('en-total');
    if (!el) return;
    el.textContent = U.brl(linhasEntrada.reduce(function (s2, i) {
      return s2 + (i.qtd || 0) * (i.custo || 0); }, 0));
  }

  function lerItensEntrada() {
    const box = U.el('en-itens');
    if (!box) return;
    ['produto', 'qtd', 'un_emb', 'custo', 'lote', 'validade'].forEach(function (campo) {
      box.querySelectorAll('[data-c="' + campo + '"]').forEach(function (e) {
        const i = +e.dataset.i;
        if (!linhasEntrada[i]) return;
        const numerico = campo === 'qtd' || campo === 'custo' || campo === 'un_emb';
        linhasEntrada[i][campo] = numerico ? U.parseValor(e.value) : e.value;
      });
    });
    /* Unidades por embalagem em branco vale 1 — material que a nota
       manda em unidade não precisa de conversão. */
    linhasEntrada.forEach(function (l) {
      if (!(l.un_emb > 0)) l.un_emb = 1;
    });
  }

  /* Lê o arquivo e tenta casar cada item da nota com o cadastro, por
     código e por descrição. O que não casa fica para escolher à mão. */
  function lerArquivoEntrada(e) {
    const arq = e.target.files && e.target.files[0];
    if (!arq) return;
    const fim = function (nf) {
      if (nf.erro) {
        U.el('en-info').innerHTML = '<div class="ajuda erro">' + U.esc(nf.erro) + '</div>';
        return;
      }
      notaLida = nf;
      /* Chave já lançada em algum título existente: desmarca "lançar
         também no financeiro" sozinho, e avisa por quê. Deixar marcado
         nesse caso faria a entrada de estoque tentar criar um título
         duplicado da mesma nota. */
      if (nf.chave && S.todasParcelas().some(function (p) { return p.chave === nf.chave; }) &&
          U.el('en-financeiro')) {
        U.el('en-financeiro').checked = false;
      }
      if (nf.numero) U.setVal('en-doc', nf.numero + (nf.serie ? '/' + nf.serie : ''));
      if (nf.emissao) {
        U.setVal('en-nf-data', nf.emissao);
        U.setVal('en-data', nf.emissao);   // padrão: entrou no dia da emissão
      }
      const itensNf = nf.itens || [];
      if (itensNf.length) {
        linhasEntrada = itensNf.map(function (i) {
          const sug = ERP.sugestao.sugerirProduto(i, D.produtos);
          /* Identificador igual entra aceito. Palpite de descrição
             também entra preenchido, mas marcado como sugestão: é o
             que o usuário confirma ou troca. Abaixo de 60% não
             preenche nada — palpite ruim aceito no automático é pior
             que campo vazio. */
          const top = sug.candidatos[0];
          const aceita = sug.certeza || (top && top.score >= 0.6);
          return {
            produto: aceita ? top.produto.id : '', qtd: i.qtd || 0,
            custo: i.valorUnit || (i.qtd ? Math.round(i.valor / i.qtd * 10000) / 10000 : 0),
            lote: '', validade: '', nome_nf: i.descricao,
            itemNf: i, sug: sug
          };
        });
      }
      atualizarInfoNota();
      renderItensEntrada();
      renderCredorSugerido();
    };

    if (/\.pdf$/i.test(arq.name)) {
      const lp = new FileReader();
      lp.onload = function () {
        /* Do PDF o cabeçalho vem da chave de acesso, que é estruturada;
           os itens vêm por heurística de layout e entram marcados como
           tal. Nenhum item do PDF traz EAN, então o vínculo dele só
           pode ser por descrição — é por isso que o XML continua sendo
           o caminho melhor quando existe. */
        ERP.danfe.ler(new Uint8Array(lp.result), { cnpjEmpresa: D.empresa && D.empresa.cnpj })
          .then(function (r) { fim(r); });
      };
      lp.readAsArrayBuffer(arq);
    } else {
      const lx = new FileReader();
      lx.onload = function () { fim(ERP.nfe.ler(lx.result, {})); };
      lx.readAsText(arq, 'UTF-8');
    }
  }

  /* Cadastro do material a partir da linha da nota. O código interno
     é sugerido na sequência da casa; o código do FORNECEDOR fica
     guardado, e é ele que faz a próxima nota deste fornecedor casar
     por identificador em vez de por palpite. */
  function cadastrarProdutoDaNota(ix) {
    const linha = linhasEntrada[ix];
    if (!linha || !linha.itemNf) return;
    const base = ERP.sugestao.produtoDaNota(linha.itemNf);
    const usados = D.produtos.map(function (p) {
      const m = String(p.codigo).match(/(\d+)\s*$/); return m ? +m[1] : 0; });
    const prox = 'MT-' + String(Math.max.apply(null, usados.concat(0)) + 1).padStart(3, '0');

    ERP.app.modal({
      titulo: 'Cadastrar material da nota',
      corpo:
        '<div class="ajuda">Preenchido com o que a nota trouxe. A descrição é a do fornecedor — ' +
        'vale reescrever no padrão da casa, porque é ela que vai aparecer no estoque e nas ' +
        'requisições.</div>' +
        '<label>Descrição *</label><input id="np-desc" value="' + U.esc(base.descricao) + '">' +
        '<div class="row3"><div><label>Código interno</label>' +
          '<input id="np-cod" value="' + U.esc(prox) + '"></div>' +
        '<div><label>Unidade</label><input id="np-un" value="' + U.esc(base.unidade) + '"></div>' +
        '<div><label>Custo unitário</label><input class="num" id="np-custo" inputmode="decimal" value="' +
          U.num(base.custo) + '"></div></div>' +
        '<div class="row3"><div><label>NCM</label><input id="np-ncm" value="' + U.esc(base.ncm) + '"></div>' +
        '<div><label>Código de barras (EAN)</label><input id="np-ean" value="' + U.esc(base.ean) + '"></div>' +
        '<div><label>Código no fornecedor</label><input id="np-codf" value="' +
          U.esc(base.codigo_fornecedor) + '"></div></div>' +
        '<div class="row3"><div><label>Mínimo</label><input class="num" id="np-min" inputmode="decimal" value="0"></div>' +
        '<div><label>Ideal</label><input class="num" id="np-ideal" inputmode="decimal" value="0"></div>' +
        '<div><label>Natureza</label><select id="np-conta">' +
          D.plano.filter(function (p) { return p.nivel === 2 && p.pai !== '1'; }).map(function (p) {
            return '<option value="' + p.cod + '"' + (p.cod === '8.04' ? ' selected' : '') + '>' +
              U.esc(p.cod + ' ' + p.nome) + '</option>'; }).join('') + '</select></div></div>' +
        '<div class="ajuda">O EAN e o código do fornecedor são o que dispensa palpite na próxima ' +
        'nota: com um dos dois preenchido, o vínculo vem por identificador.</div>',
      acoes: [{ txt: 'Cadastrar e vincular', cls: 'btn-aprovar', fn: function () {
        const desc = U.val('np-desc');
        if (!desc) return ERP.app.aviso('Informe a descrição do material.', 'erro');
        const p = {
          id: 'pr' + Date.now().toString(36), codigo: U.val('np-cod') || prox,
          descricao: desc, unidade: (U.val('np-un') || 'UN').toUpperCase(),
          ncm: U.val('np-ncm'), ean: U.val('np-ean'),
          codigo_fornecedor: U.val('np-codf'),
          minimo: U.parseValor(U.val('np-min')), ideal: U.parseValor(U.val('np-ideal')),
          custo: U.parseValor(U.val('np-custo')), conta: U.val('np-conta'),
          origem: 'nota fiscal', ativo: true
        };
        if (D.produtos.some(function (x) { return String(x.codigo).toUpperCase() === p.codigo.toUpperCase(); })) {
          return ERP.app.aviso('Já existe material com o código ' + p.codigo + '.', 'erro');
        }
        D.produtos.push(p);
        linhasEntrada[ix].produto = p.id;
        linhasEntrada[ix].cadastradoAgora = true;
        if (!linhasEntrada[ix].custo) linhasEntrada[ix].custo = p.custo;
        ERP.app.fecharModal();
        ERP.app.aviso('Material ' + p.codigo + ' cadastrado e vinculado à linha.', 'ok');
        renderItensEntrada();
      } }]
    });
  }

  /* ── fornecedor da nota ─────────────────────────────────
     Mesma lógica dos materiais: CNPJ igual é certeza, nome parecido é
     sugestão, e não existir no cadastro é um botão — não um recado
     dizendo para ir cadastrar em outra tela e voltar. */
  function renderCredorSugerido() {
    const box = U.el('en-credor-sug');
    if (!box || !notaLida || !notaLida.emitente) return;
    const sug = ERP.sugestao.sugerirCredor(notaLida.emitente, D.credores);
    const top = sug.candidatos[0];
    if (sug.certeza) U.setVal('en-credor', top.credor.nome);
    else if (top && top.score >= 0.7) U.setVal('en-credor', top.credor.nome);

    const nf = notaLida.emitente;
    const doc = nf.documento ? U.cnpj(nf.documento) : '';
    box.innerHTML = '<div class="sub" style="line-height:1.7">' +
      'na nota: <b>' + U.esc(nf.nome || '?') + '</b>' + (doc ? ' · ' + U.esc(doc) : '') + '<br>' +
      (sug.certeza
        ? '<span class="badge b-pago">CNPJ já cadastrado</span>'
        : top
          ? '<span class="badge b-aguardando">sugestão ' + Math.round(top.score * 100) + '% · ' +
            U.esc(top.credor.nome) + '</span>'
          : '<span class="badge b-reprovado">fornecedor não cadastrado</span>') + ' ' +
      sug.candidatos.slice(sug.certeza ? 1 : 0, 3).map(function (c) {
        return '<button class="btn-sm" type="button" data-credor="' + U.esc(c.credor.nome) + '">' +
          U.esc(c.credor.nome.slice(0, 22)) + '</button>';
      }).join(' ') +
      (sug.certeza ? '' : ' <button class="btn-sm" type="button" id="en-cad-credor">' +
        'Cadastrar pelos dados da nota</button>') +
      '</div>';

    box.querySelectorAll('[data-credor]').forEach(function (b) {
      b.addEventListener('click', function () { U.setVal('en-credor', this.dataset.credor); });
    });
    if (U.el('en-cad-credor')) U.el('en-cad-credor').addEventListener('click', cadastrarCredorDaNota);
  }

  /* Cadastro do fornecedor com o que a nota trouxe, incluindo a
     tentativa de dados bancários. Ver sugestao.js: a NF-e não tem
     campo para conta do fornecedor, então isso sai do texto livre e
     entra na tela como proposta a conferir, nunca gravado calado. */
  function cadastrarCredorDaNota() {
    const base = ERP.sugestao.credorDaNota(notaLida);
    const b = base.bancarios;
    if (D.credores.some(function (c) { return U.so(c.documento) === base.documento && base.documento; })) {
      return ERP.app.aviso('Este CNPJ já está cadastrado.', 'erro');
    }
    ERP.app.modal({
      titulo: 'Cadastrar fornecedor da nota',
      corpo:
        '<label>Razão social *</label><input id="nc-nome" value="' + U.esc(base.nome) + '">' +
        '<div class="row3"><div><label>CNPJ / CPF</label><input id="nc-doc" value="' +
          U.esc(base.documento ? U.cnpj(base.documento) : '') + '"></div>' +
        '<div><label>Nome fantasia</label><input id="nc-fant" value="' + U.esc(base.fantasia) + '"></div>' +
        '<div><label>Inscrição estadual</label><input id="nc-ie" value="' + U.esc(base.ie) + '"></div></div>' +
        '<label>Endereço</label><input id="nc-end" value="' + U.esc(base.endereco) + '">' +
        '<div class="row3"><div><label>Município</label><input id="nc-mun" value="' +
          U.esc(base.municipio) + '"></div>' +
        '<div><label>UF</label><input id="nc-uf" value="' + U.esc(base.uf) + '"></div>' +
        '<div><label>Telefone</label><input id="nc-fone" value="' + U.esc(base.fone) + '"></div></div>' +
        '<div><label>Natureza padrão</label><select id="nc-conta">' +
          D.plano.filter(function (p) { return p.nivel === 2 && p.pai !== '1'; }).map(function (p) {
            return '<option value="' + p.cod + '"' + (p.cod === '8.04' ? ' selected' : '') + '>' +
              U.esc(p.cod + ' ' + p.nome) + '</option>'; }).join('') + '</select></div>' +

        '<h2 style="font-size:12px;margin:16px 0 4px">Dados de pagamento</h2>' +
        '<div class="ajuda' + (b.banco || b.pix ? '' : ' erro') + '">' + U.esc(b.avisos.join(' ')) + '</div>' +
        '<div class="row3"><div><label>Forma</label><select id="nc-forma">' +
          '<option value="">Não definida</option>' +
          Object.keys(D.formasPagamento).map(function (k) {
            return '<option value="' + k + '"' + (k === base.forma_pagamento ? ' selected' : '') +
              '>' + U.esc(D.formasPagamento[k].nome) + '</option>'; }).join('') + '</select></div>' +
        '<div><label>Banco</label><input id="nc-banco" value="' + U.esc(b.banco || '') + '"></div>' +
        '<div><label>Agência</label><input id="nc-ag" value="' + U.esc(b.agencia || '') + '"></div></div>' +
        '<div class="row2"><div><label>Conta</label><input id="nc-conta-num" value="' +
          U.esc(b.conta || '') + '"></div>' +
        '<div><label>Chave PIX</label><input id="nc-pix" value="' + U.esc(b.pix || '') + '"' +
          (b.pix ? '' : ' placeholder="a nota não informou"') + '></div></div>',
      acoes: [{ txt: 'Cadastrar e usar', cls: 'btn-aprovar', fn: function () {
        const nome = U.val('nc-nome');
        if (!nome) return ERP.app.aviso('Informe a razão social.', 'erro');
        const cr = {
          id: 'cr' + Date.now().toString(36), ativo: true, nome: nome,
          fantasia: U.val('nc-fant'), documento: U.val('nc-doc'), ie: U.val('nc-ie'),
          endereco: U.val('nc-end'), municipio: U.val('nc-mun'), uf: U.val('nc-uf'),
          fone: U.val('nc-fone'), tipo: 'fornecedor',
          conta_padrao: U.val('nc-conta'),
          forma_pagamento: U.val('nc-forma') || null,
          banco_nome: U.val('nc-banco'), agencia: U.val('nc-ag'), conta: U.val('nc-conta-num'),
          pix: U.val('nc-pix') || null,
          tipo_chave: U.val('nc-pix') ? (/@/.test(U.val('nc-pix')) ? 'email' : 'CNPJ') : null,
          origem: 'nota fiscal'
        };
        D.credores.push(cr);
        U.setVal('en-credor', cr.nome);
        ERP.app.fecharModal();
        ERP.app.aviso('Fornecedor cadastrado' +
          (cr.pix || cr.agencia ? ' com dados de pagamento — confira antes do primeiro pagamento.' : '.'), 'ok');
        renderCredorSugerido();
      } }]
    });
  }

  /* Entrada vinculada a pedido: traz os itens com o PREÇO COTADO e o
     frete daquele item rateado por unidade — antes a entrada usava o
     custo do cadastro, então o estoque nunca refletia o que a compra
     custou de verdade (e o frete não entrava em custo nenhum). */
  function puxarItensDoPedido(pedidoId) {
    const r = S.compra(pedidoId);
    if (!r) return;
    pedidoSel = pedidoId;
    // o armazém do pedido é o destino natural da entrada
    armEntrada = r.armazem || armEntrada || armSel();
    const pendentes = (r.itens || []).filter(function (i) {
      return !i.reprovado && (i.qtd - (i.recebido || 0)) > 0.0001;
    });
    if (!pendentes.length) return ERP.app.aviso('Este pedido já foi recebido por inteiro.', 'erro');
    linhasEntrada = pendentes.map(function (i) {
      const falta = Math.round((i.qtd - (i.recebido || 0)) * 1000) / 1000;
      /* Custo unitário vem do store, que rateia o frete pela
         quantidade TOTAL do item: ratear pelo que falta cobrava o
         frete inteiro em cada recebimento parcial. */
      return { produto: i.produto, qtd: falta,
        custo: S.custoDeAquisicao(i, D.produtos.find(function (x) { return x.id === i.produto; })),
        /* Material comprado em embalagem já vem convertido pela
           cotação: a quantidade do pedido é a de compra. */
        un_emb: 1,
        lote: '', validade: '', nome_nf: '' };
    });
    if (r.nota_documento && !U.val('en-doc')) U.setVal('en-doc', r.nota_documento);
    render();
    ERP.app.aviso('Itens do pedido ' + r.numero + ' carregados com o preço cotado' +
      ((r.itens || []).some(function (i) { return i.frete; }) ? ' e o frete rateado por unidade' : '') +
      '. Ajuste se a nota vier diferente.', 'ok');
  }

  function gravarEntrada() {
    lerItensEntrada();
    const armSel = U.val('en-armazem');

    /* As despesas da nota são divididas entre os itens ANTES de
       gravar: o que chega ao estoque é o custo real de aquisição,
       não o preço da mercadoria. Daqui pra frente o sistema inteiro
       — custo do procedimento, margem do projeto, DRE — trabalha
       com o número certo, sem saber que houve rateio. */
    despesasNota = U.parseValor(U.val('en-despesas')) || 0;
    criterioRateio = U.val('en-criterio') || 'quantidade';
    let itensGravar = linhasEntrada;
    let avisoRateio = '';
    if (despesasNota > 0) {
      const rt = S.ratearDespesasNota(linhasEntrada, despesasNota, criterioRateio);
      itensGravar = rt.itens;
      avisoRateio = ' ' + U.brl(rt.rateado) + ' de frete/despesas dividido(s) por ' +
        (rt.criterio === 'valor' ? 'valor' : 'quantidade') + '.';
    }

    const r = S.entradaLote({
      armazem: armSel, data: U.val('en-data'),
      data_nf: U.val('en-nf-data') || (notaLida ? notaLida.emissao : null),
      documento: U.val('en-doc'),
      pedido_id: U.val('en-pedido') || pedidoSel || null,
      origem: notaLida ? 'nota_fiscal' : 'manual',
      nota_chave: notaLida ? notaLida.chave : null,
      motivo: notaLida ? 'Entrada por nota' : 'Entrada manual',
      itens: itensGravar
    });
    if (r.erro) return ERP.app.aviso(r.erro, 'erro');

    /* A NOTA COMPLETA O CADASTRO. Material criado às pressas numa
       requisição nasce sem NCM; o XML tem esse dado, e a entrada é
       o momento em que ele está disponível sem ninguém procurar.
       Só preenche o que está vazio. */
    let completados = 0;
    if (notaLida && notaLida.itens) {
      itensGravar.forEach(function (i) {
        const daNota = notaLida.itens.find(function (x) {
          return x.produto === i.produto || x.codigo === i.codigo_nf;
        });
        if (!daNota) return;
        const c = S.completarCadastroPelaNota(i.produto, daNota);
        if (c.ok && c.preenchidos.length) completados++;
      });
    }

    /* Quem ficou sem NCM aparece ao final. A entrada NÃO é
       bloqueada: travar a chegada da mercadoria por um campo fiscal
       faria o material ficar fora do sistema, e aí o saldo mente —
       o que é pior que um NCM em branco. */
    const semNcm = S.materiaisSemNCM(itensGravar);

    // o mesmo evento vira despesa: é isso que fecha compras → estoque → financeiro
    let aviso = r.n + ' material(is) no estoque de ' + nomeArm(armSel) + ' · ' + U.brl(r.valor) +
      '.' + avisoRateio +
      (completados ? ' ' + completados + ' cadastro(s) completado(s) com os dados da nota.' : '');
    if (U.el('en-financeiro') && U.el('en-financeiro').checked && r.valor > 0) {
      const fin = lancarNoFinanceiro(armSel, r.valor);
      aviso += fin.erro ? ' Estoque atualizado, mas o financeiro não: ' + fin.erro
                        : ' Despesa lançada no contas a pagar.';
    }
    linhasEntrada = [];
    notaLida = null;
    pedidoSel = '';
    armEntrada = '';
    despesasNota = 0;
    ERP.app.aviso(aviso, 'ok');

    if (semNcm.length) {
      /* Modal, não aviso que some: NCM faltando trava a emissão de
         nota de saída depois, e a hora de resolver é agora, com a
         nota do fornecedor aberta na frente. */
      ERP.app.modal({
        titulo: semNcm.length + ' material(is) sem NCM',
        fecharTxt: 'Depois',
        corpo:
          '<div class="ajuda">A entrada foi gravada. Estes materiais ficaram sem NCM — a nota ' +
          'não trouxe, ou foram cadastrados às pressas. Sem NCM, a <b>nota de saída</b> desses ' +
          'itens não sai quando precisar.</div>' +
          semNcm.map(function (p, ix) {
            return '<div class="row2" style="margin-top:8px;align-items:end">' +
              '<div><label>' + U.esc(p.codigo + ' · ' + p.descricao) + '</label>' +
                '<input id="ncm-' + ix + '" data-pid="' + p.id + '" inputmode="numeric" ' +
                'maxlength="10" placeholder="8 dígitos — ex.: 90183919"></div>' +
              '<div class="sub">da nota do fornecedor</div></div>';
          }).join(''),
        acoes: [{ txt: 'Salvar NCM', cls: 'btn-aprovar', fn: function () {
          let n = 0;
          semNcm.forEach(function (p, ix) {
            const e = U.el('ncm-' + ix);
            const v = e ? String(e.value).replace(/\D/g, '') : '';
            if (v.length >= 8) {
              S.completarCadastroPelaNota(p.id, { ncm: v });
              n++;
            }
          });
          ERP.app.fecharModal();
          ERP.app.aviso(n ? n + ' NCM preenchido(s).'
            : 'Nenhum NCM válido — são 8 dígitos. Os materiais seguem pendentes em Cadastros.',
            n ? 'ok' : 'erro');
          render();
        } }]
      });
      return;
    }

    aba = 'posicao';
    render();
  }

  /* Gera o título no contas a pagar com os dados da nota, rateado no
     projeto do armazém que recebeu o material. */
  function lancarNoFinanceiro(armSel, valor) {
    const am = D.armazem(armSel) || {};
    const nomeCr = U.val('en-credor') ||
      (notaLida && notaLida.emitente ? notaLida.emitente.nome : '');
    if (!nomeCr) return { erro: 'informe o fornecedor.' };
    const cr = D.credores.find(function (c) {
      return c.nome.toUpperCase() === nomeCr.toUpperCase() ||
        (notaLida && notaLida.emitente && notaLida.emitente.documento &&
         String(c.documento || '').replace(/\D/g, '') ===
           String(notaLida.emitente.documento).replace(/\D/g, ''));
    });
    if (!cr) return { erro: 'fornecedor "' + nomeCr + '" não está cadastrado.' };
    if (!am.centro) return { erro: 'o armazém não aponta para nenhum projeto.' };

    const doc = U.val('en-doc') || 'ENTRADA';
    const dataEmissao = U.val('en-data') || U.hoje();
    const ped = U.val('en-pedido') || pedidoSel || '';
    /* A NF pode trazer mais de uma duplicata (vencimentos diferentes) —
       o Financeiro já respeita isso lendo o mesmo XML; aqui a entrada
       de estoque jogava tudo numa parcela só, com o vencimento do
       campo único da tela, mesmo quando a nota tinha duas ou três
       datas. As duplicatas da própria nota valem mais que o campo. */
    const linhas = (notaLida && notaLida.duplicatas && notaLida.duplicatas.length)
      ? notaLida.duplicatas.map(function (d, i) {
          return { num: i + 1, venc: d.venc, comp: (d.venc || dataEmissao).slice(0, 7), valor: d.valor };
        })
      : [{ num: 1, venc: U.val('en-venc') || U.hoje(), comp: dataEmissao.slice(0, 7), valor: valor }];
    return S.criarTitulo({
      descricao: 'Material — ' + (notaLida && notaLida.natureza ? notaLida.natureza : 'entrada de estoque') +
        (ped ? ' · pedido ' + (S.compra(ped) || {}).numero : ''),
      documento: doc, tipo_titulo: notaLida ? 'nf' : 'recibo',
      credor: cr.id, conta: U.val('en-conta'),
      centro: am.centro, rateio: [{ centro: am.centro, pct: 100 }],
      emissao: dataEmissao, origem: notaLida ? 'nota_fiscal' : 'manual',
      /* O vínculo com o pedido tem que ir ADIANTE: a descrição já
         escrevia o número do pedido, mas o título nascia sem
         `pedido_id` e a previsão do pedido continuava viva — o fluxo
         mostrava a compra duas vezes (previsão + título da entrada). */
      pedido_id: ped || null,
      chave: notaLida ? notaLida.chave : null,
      obs: 'Entrada no armazém ' + am.codigo + (ped ? ' · pedido de compra' : '')
    }, linhas);
  }

  /* ── inventário inicial ─────────────────────────────────*/
  function telaInventario() {
    const am = armSel();
    return '<div class="pr-cab">' +
        '<div><label for="iv-armazem">Armazém *</label><select id="iv-armazem">' + opcoesArmazem(am) + '</select></div>' +
        '<div><label for="iv-data">Data do inventário</label><input type="date" id="iv-data" max="' + U.hoje() + '" value="' + U.hoje() + '"></div>' +
        '<div><label for="iv-motivo">Motivo *</label><input id="iv-motivo" ' +
          'placeholder="contagem mensal, quebra, perda…"></div>' +
      '</div>' +
      '<div class="ajuda" style="margin:8px 0">Informe a quantidade <b>contada</b> de cada material. ' +
      'O sistema compara com o saldo e lança só a diferença: sobra vira entrada, falta vira saída de ' +
      'ajuste. Recontar o mesmo armazém não duplica nada — e o que bate com o sistema não gera ' +
      'movimento.</div>' +
      '<div class="tabela-rolagem" style="margin:0 -14px"><table><thead><tr>' +
      '<th>Material</th><th class="num">Saldo atual</th><th class="num">Quantidade</th>' +
      '<th class="num">Custo unitário</th><th>Lote</th><th>Validade</th></tr></thead><tbody>' +
      D.produtos.filter(function (p) { return p.ativo; }).map(function (p) {
        const saldo = am ? S.saldoEstoque(p.id, am) : 0;
        /* O CUSTO NÃO SE DIGITA NA CONTAGEM. Inventário é contagem
           física; o preço vem da entrada com nota ou pedido. O campo
           mostra o custo médio que o material já tem e fica
           bloqueado.

           A exceção é o material sem histórico nenhum — aí não há de
           onde puxar, e o campo abre para digitar. É o caso do
           primeiro inventário de um produto novo.

           Antes o campo vinha preenchido com o custo de cadastro e
           editável: recontar passava a média para um valor que
           ninguém decidiu informar. */
        const medio = am ? S.custoMedio(p.id, am) : 0;
        const temHistorico = medio > 0;
        return '<tr><td class="desc">' + U.esc(p.descricao) +
            '<div class="sub">' + U.esc(p.codigo + ' · ' + p.unidade) + '</div></td>' +
          '<td class="num sub">' + (am ? U.num(saldo) : '—') + '</td>' +
          '<td><input class="num" data-iv="' + p.id + '" data-c="qtd" inputmode="decimal"></td>' +
          '<td>' + (temHistorico
            ? '<input class="num" data-iv="' + p.id + '" data-c="custo" inputmode="decimal" value="' +
              U.num(medio) + '" readonly title="Vem da entrada com nota. Para mudar o custo, ' +
              'dê entrada com NF ou pedido.">'
            : '<input class="num" data-iv="' + p.id + '" data-c="custo" inputmode="decimal" ' +
              'placeholder="sem histórico — informe" title="Este material ainda não tem entrada ' +
              'com nota, então não há custo de onde puxar.">') + '</td>' +
          '<td><input data-iv="' + p.id + '" data-c="lote"></td>' +
          '<td><input type="date" data-iv="' + p.id + '" data-c="validade"></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="form-acoes" style="margin:14px -14px -14px">' +
        '<span class="ajuda" style="margin-right:auto">Deixe em branco o que não tem no armazém.</span>' +
        '<button class="btn-primary" id="iv-gravar" style="width:auto;margin:0">Lançar inventário</button>' +
        '<div class="ajuda">O <b>custo não se digita aqui</b>: ele vem da entrada com nota ou ' +
        'pedido de compra, e o campo mostra o custo médio atual de cada material. Só abre para ' +
        'digitação quando o material ainda não tem nenhuma entrada — não há de onde puxar.</div>' +
      '</div>';
  }

  /* Zera os campos da contagem. Usada ao trocar de armazém e
     depois de lançar: contagem é de um armazém e de um momento. */
  function limparGradeInventario() {
    document.querySelectorAll('[data-iv]').forEach(function (e) { e.value = ''; });
    if (U.el('iv-motivo')) U.setVal('iv-motivo', '');
  }

  function gravarInventario() {
    const am = U.val('iv-armazem');
    const itens = [];
    D.produtos.forEach(function (p) {
      const q = document.querySelector('[data-iv="' + p.id + '"][data-c="qtd"]');
      const c = document.querySelector('[data-iv="' + p.id + '"][data-c="custo"]');
      const l = document.querySelector('[data-iv="' + p.id + '"][data-c="lote"]');
      const v = document.querySelector('[data-iv="' + p.id + '"][data-c="validade"]');
      const qtd = U.parseValor(q ? q.value : 0);
      if (qtd > 0) itens.push({ produto: p.id, qtd: qtd, custo: U.parseValor(c ? c.value : 0),
        lote: l ? l.value : '', validade: v ? v.value : '' });
    });
    /* Contagem é AJUSTE, não entrada: o store compara com o saldo e
       lança só a diferença. Antes isto chamava `entradaLote` e
       recontar o mesmo armazém dobrava o estoque em silêncio. */
    const r = S.ajusteInventario(am, itens, {
      data: U.val('iv-data'), documento: 'INVENTÁRIO',
      /* Sem default: ajuste para baixo é material que sumiu, e a
         contabilidade cobra a justificativa. Deixar um texto genérico
         pronto anulava a obrigatoriedade que o store impõe. */
      motivo: U.val('iv-motivo')
    });
    if (r.erro) return ERP.app.aviso(r.erro, 'erro');
    if (!r.n) return ERP.app.aviso(r.aviso || 'Nada a ajustar.', 'ok');
    ERP.app.aviso('Inventário ajustado: ' + r.sobras + ' sobra(s) e ' + r.faltas +
      ' falta(s) lançada(s).', 'ok');
    limparGradeInventario();
    aba = 'posicao';
    render();
  }

  /* ── baixa de vários materiais ──────────────────────────*/
  function abrirBaixa(armazemInicial) {
    let am = armazemInicial || armSel() || '';
    ERP.app.modal({
      titulo: 'Baixa de material',
      corpo:
        '<div class="row3"><div><label>Armazém *</label><select id="ba-arm">' + opcoesArmazem(am) + '</select></div>' +
        '<div><label>Data</label><input type="date" id="ba-data" max="' + U.hoje() + '" value="' + U.hoje() + '"></div>' +
        '<div><label>Motivo</label><select id="ba-motivo">' +
          D.MOTIVOS_SAIDA.map(function (m) { return '<option>' + U.esc(m) + '</option>'; }).join('') +
        '</select></div></div>' +
        '<div class="row2"><div><label>Requisição interna</label><input id="ba-req" placeholder="nº da requisição"></div>' +
        '<div><label>Setor / documento</label><input id="ba-doc"></div></div>' +
        '<label>Observação</label><input id="ba-obs" placeholder="o que motivou a baixa, em texto livre">' +
        /* Rastreabilidade por paciente. Um nome só vale pra baixa
           inteira; pra uma unidade por paciente, cola a lista (uma
           linha por unidade) — bem mais rápido que abrir 20 campos, e
           aguenta o dia de 70 atendimentos. */
        '<label style="margin-top:10px">Paciente</label>' +
        '<div class="row2"><input id="ba-pac" placeholder="nome do paciente (vale pra baixa inteira)">' +
          '<button type="button" class="btn-sm" id="ba-pac-varios">Vários pacientes (um por unidade)</button></div>' +
        '<div id="ba-pac-box" style="display:none;margin-top:6px">' +
          '<textarea id="ba-pac-lista" rows="4" placeholder="um paciente por linha — cole a lista do sistema assistencial"></textarea>' +
          '<div class="ajuda" id="ba-pac-conta">0 paciente(s) na lista.</div></div>' +
        '<div class="ajuda erro" id="ba-um-material" style="display:none"></div>' +
        '<div id="ba-lista" style="margin-top:10px"></div>',
      acoes: [{ txt: 'Registrar baixa', cls: 'btn-pagar', fn: function () {
        const armSel = U.val('ba-arm');          // o modal fecha antes do aviso
        const itens = [];
        document.querySelectorAll('[data-ba]').forEach(function (e) {
          const q = U.parseValor(e.value);
          if (q > 0) itens.push({ produto: e.dataset.ba, qtd: q });
        });
        /* Só vale a lista se o modo "vários pacientes" estiver aberto:
           quem digitava a lista e voltava pra "um paciente só" gravava
           os dois — a lista ia escondida junto. */
        const modoVarios = U.el('ba-pac-box').style.display !== 'none';
        const pacLista = modoVarios
          ? (U.val('ba-pac-lista') || '').split('\n')
              .map(function (x) { return x.trim(); }).filter(function (x) { return x.length; })
          : [];
        if (pacLista.length > 1 && itens.length > 1) {
          return ERP.app.aviso('Baixa com lista de pacientes é de um material por vez — ' +
            'senão não dá pra saber qual nome é de qual material. Zere os outros e faça uma baixa por material.', 'erro');
        }
        const r = S.baixaMultipla({
          armazem: armSel, data: U.val('ba-data'), motivo: U.val('ba-motivo'),
          requisicao: U.val('ba-req'), documento: U.val('ba-doc'),
          observacao: U.val('ba-obs'), paciente: U.val('ba-pac'),
          pacientes: pacLista.length ? pacLista : null, itens: itens
        });
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        ERP.app.aviso('Baixa de ' + r.n + ' material(is) · ' + U.brl(r.valor) + ' em ' +
          nomeArm(armSel) + '.', 'ok');
        render();
      } }],
      aoAbrir: function () {
        const lista = function () {
          const arm = U.val('ba-arm');
          const box = U.el('ba-lista');
          if (!arm) {
            box.innerHTML = '<div class="ajuda">Escolha o armazém para ver o que tem saldo.</div>';
            return;
          }
          const comS = S.comSaldo(arm);
          if (!comS.length) {
            box.innerHTML = '<div class="vazio"><strong>Sem saldo neste armazém.</strong></div>';
            return;
          }
          box.innerHTML = '<h2 style="font-size:12px;margin:0 0 6px">Materiais com saldo · ' +
            U.esc(projetoDe(arm)) + '</h2>' +
            '<table><thead><tr><th>Material</th><th class="num">Saldo</th>' +
            (veCusto() ? '<th class="num">Custo médio</th>' : '') +
            '<th class="num">Baixar</th></tr></thead><tbody>' +
            comS.map(function (l) {
              return '<tr><td class="desc">' + U.esc(l.produto.descricao) +
                '<div class="sub">' + U.esc(l.produto.codigo) + '</div></td>' +
                '<td class="num">' + U.num(l.saldo) + ' ' + U.esc(l.produto.unidade) + '</td>' +
                (veCusto() ? '<td class="num sub">' + U.brl(l.medio) + '</td>' : '') +
                '<td><input class="num" data-ba="' + l.produto.id + '" inputmode="decimal" ' +
                  'placeholder="0" style="max-width:80px"></td></tr>';
            }).join('') + '</tbody></table>' +
            '<div class="ajuda">Preencha a quantidade de quantos materiais quiser — tudo sai num ' +
            'movimento só, com o mesmo motivo e a mesma requisição.</div>';
        };
        U.el('ba-arm').addEventListener('change', lista);
        /* Modo "vários pacientes": um nome por unidade só faz sentido
           com UM material na baixa — senão não dá pra saber qual nome é
           de qual produto. Em vez de recusar no fim, a tela trava os
           outros materiais assim que um recebe quantidade. */
        const travarUmMaterial = function () {
          const multi = U.el('ba-pac-box').style.display !== 'none';
          const campos = Array.prototype.slice.call(document.querySelectorAll('[data-ba]'));
          const comQtd = campos.filter(function (c) { return U.parseValor(c.value) > 0; });
          campos.forEach(function (c) {
            const bloquear = multi && comQtd.length > 0 && U.parseValor(c.value) <= 0;
            c.disabled = bloquear;
            c.title = bloquear ? 'Na baixa com lista de pacientes, um material por vez' : '';
            const linha = c.closest('tr');
            if (linha) linha.style.opacity = bloquear ? '0.45' : '';
          });
          const aviso = U.el('ba-um-material');
          if (aviso) {
            aviso.style.display = multi ? '' : 'none';
            aviso.textContent = comQtd.length
              ? 'Baixa com lista de pacientes: só este material. Zere a quantidade dele pra trocar de material.'
              : 'Baixa com lista de pacientes: informe a quantidade de UM material só.';
          }
        };
        /* O ouvinte fica no MODAL, não no documento: preso no document
           ele sobrevivia ao fechamento e se acumulava a cada abertura
           da baixa — cada tecla passava a disparar um erro por modal
           já fechado. */
        const boxModal = U.el('ba-lista').closest('.modal') || U.el('ba-lista').parentNode;
        boxModal.addEventListener('input', travarUmMaterial);
        U.el('ba-pac-varios').addEventListener('click', function () {
          const box = U.el('ba-pac-box');
          const abrir = box.style.display === 'none';
          box.style.display = abrir ? 'block' : 'none';
          U.el('ba-pac').disabled = abrir;
          this.textContent = abrir ? 'Voltar a um paciente só' : 'Vários pacientes (um por unidade)';
          travarUmMaterial();
        });
        U.el('ba-pac-lista').addEventListener('input', function () {
          const n = this.value.split('\n').filter(function (x) { return x.trim().length; }).length;
          const qtd = Array.prototype.reduce.call(document.querySelectorAll('[data-ba]'),
            function (a, e) { return a + (U.parseValor(e.value) || 0); }, 0);
          U.el('ba-pac-conta').textContent = n + ' paciente(s) na lista' +
            (qtd ? ' · ' + U.num(qtd) + ' unidade(s) na baixa' + (Math.abs(n - qtd) < 0.0001 ? ' — bate' : ' — precisa bater') : '');
          U.el('ba-pac-conta').className = qtd && Math.abs(n - qtd) > 0.0001 ? 'ajuda erro' : 'ajuda';
        });
        lista();
      }
    });
  }

  /* ── transferência entre armazéns ───────────────────────*/
  function abrirTransferencia() {
    ERP.app.modal({
      titulo: 'Transferência entre armazéns',
      corpo:
        '<div class="row3"><div><label>Origem *</label><select id="tr-org">' +
          opcoesArmazem(armSel()) + '</select></div>' +
        '<div><label>Destino *</label><select id="tr-dst">' + opcoesArmazem('') + '</select></div>' +
        '<div><label>Data</label><input type="date" id="tr-data" max="' + U.hoje() + '" value="' + U.hoje() + '"></div></div>' +
        '<label>Documento</label><input id="tr-doc" placeholder="guia de transferência">' +
        '<div id="tr-lista" style="margin-top:10px"></div>' +
        '<div class="ajuda">O material sai da origem pelo custo médio de lá e entra no destino com esse ' +
        'custo: muda de lugar, não de valor.</div>',
      acoes: [{ txt: 'Transferir', cls: 'btn-pagar', fn: function () {
        const itens = [];
        document.querySelectorAll('[data-tr]').forEach(function (e) {
          const q = U.parseValor(e.value);
          if (q > 0) itens.push({ produto: e.dataset.tr, qtd: q });
        });
        const r = S.transferir({
          origem: U.val('tr-org'), destino: U.val('tr-dst'), data: U.val('tr-data'),
          documento: U.val('tr-doc'), itens: itens
        });
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        ERP.app.aviso(r.n + ' material(is) transferido(s) · ' + U.brl(r.valor) + '.', 'ok');
        render();
      } }],
      aoAbrir: function () {
        const lista = function () {
          const arm = U.val('tr-org');
          const box = U.el('tr-lista');
          const comS = arm ? S.comSaldo(arm) : [];
          box.innerHTML = !arm ? '<div class="ajuda">Escolha a origem.</div>'
            : !comS.length ? '<div class="vazio"><strong>Origem sem saldo.</strong></div>'
            : '<table><thead><tr><th>Material</th><th class="num">Saldo</th>' +
              '<th class="num">Transferir</th></tr></thead><tbody>' +
              comS.map(function (l) {
                return '<tr><td class="desc">' + U.esc(l.produto.descricao) + '</td>' +
                  '<td class="num">' + U.num(l.saldo) + ' ' + U.esc(l.produto.unidade) + '</td>' +
                  '<td><input class="num" data-tr="' + l.produto.id + '" inputmode="decimal" ' +
                    'style="max-width:80px"></td></tr>';
              }).join('') + '</tbody></table>';
        };
        U.el('tr-org').addEventListener('change', lista);
        lista();
      }
    });
  }

  /* ── requisição: confere antes de abrir ─────────────────*/
  function requisitar() {
    const escolhidos = S.posicaoEstoque(armSel() || null)
      .filter(function (l) { return sel.has(l.produto.id + '|' + l.armazem); });
    if (!escolhidos.length) return;

    ERP.app.modal({
      titulo: 'Conferir requisição · ' + escolhidos.length + ' item(ns)',
      corpo:
        '<div class="ajuda" style="margin-bottom:8px">A quantidade sugerida é o que falta para chegar ao ' +
        'estoque ideal. Ajuste o que quiser antes de abrir — e tire o que não vai pedir agora.</div>' +
        '<table><thead><tr><th>Material</th><th>Armazém</th><th class="num">Saldo</th>' +
        '<th class="num">Mínimo</th><th class="num">Ideal</th><th class="num">Pedir</th></tr></thead><tbody>' +
        escolhidos.map(function (l) {
          return '<tr><td class="desc">' + U.esc(l.produto.descricao) +
              '<div class="sub">' + U.esc(l.produto.codigo + ' · ' + l.produto.unidade) + '</div></td>' +
            '<td class="sub">' + U.esc((D.armazem(l.armazem) || {}).codigo || '') + '</td>' +
            '<td class="num">' + U.num(l.saldo) + '</td>' +
            '<td class="num sub">' + U.num(l.minimo) + '</td>' +
            '<td class="num sub">' + U.num(l.ideal) + '</td>' +
            '<td><input class="num" data-rq="' + l.produto.id + '|' + l.armazem + '" ' +
              'inputmode="decimal" value="' + U.num(l.sugerido) + '" style="max-width:80px"></td></tr>';
        }).join('') + '</tbody></table>' +
        '<label>Observação da requisição</label><textarea id="rq-obs">Reposição de estoque abaixo do mínimo</textarea>' +
        '<div class="ajuda">A requisição não tem fornecedor nem valor: quem compra é que cota e define. ' +
        'O custo entra quando o material chega.</div>',
      acoes: [{ txt: 'Abrir requisição', cls: 'btn-aprovar', fn: function () {
        const porArm = {};
        document.querySelectorAll('[data-rq]').forEach(function (e) {
          const q = U.parseValor(e.value);
          if (q <= 0) return;
          const partes = e.dataset.rq.split('|');
          (porArm[partes[1]] = porArm[partes[1]] || []).push({ produto: partes[0], qtd: q });
        });
        const obs = U.val('rq-obs');
        let criadas = [], erros = [];
        Object.keys(porArm).forEach(function (arm) {
          const r = S.criarRequisicao({ armazem: arm, origem: 'alerta_estoque',
            observacao: obs, itens: porArm[arm] });
          if (r.ok) criadas.push(r.requisicao.numero); else erros.push(r.erro);
        });
        if (!criadas.length) return ERP.app.aviso(erros[0] || 'Nada para requisitar.', 'erro');
        sel.clear();
        ERP.app.fecharModal();
        ERP.app.atualizarContadores();
        render();
        ERP.app.aviso(criadas.length + ' requisição(ões) aberta(s): ' + criadas.join(', ') +
          '. Está em Compras, aguardando aprovação.', 'ok');
      } }]
    });
  }

  function ligar() {
    /* A aba de famílias tem campos próprios e nenhum dos elementos
       que o resto desta função espera — liga e sai. */
    if (aba === 'familias') { ligarFamilias(); return; }

    const box = U.el('es-saida');
    box.querySelectorAll('[data-es]').forEach(function (chk) {
      chk.addEventListener('change', function () {
        this.checked ? sel.add(this.dataset.es) : sel.delete(this.dataset.es);
        render();
      });
    });
    /* Mínimo e ideal POR SETOR: cada armazém tem o consumo dele, então
       o número do cadastro do produto é só o padrão. */
    document.querySelectorAll('[data-min]').forEach(function (b) {
      b.addEventListener('click', function () {
        const partes = this.dataset.min.split('|');
        const prod = D.produtos.find(function (x) { return x.id === partes[0]; }) || {};
        ERP.app.modal({
          titulo: 'Mínimo de ' + (prod.descricao || '') + ' · ' + nomeArm(partes[1]),
          fecharTxt: 'Cancelar',
          corpo: '<div class="ajuda">Vale só para este armazém. Em branco, usa o padrão do cadastro do ' +
              'material (mín. ' + U.num(prod.minimo || 0) + ' / ideal ' + U.num(prod.ideal || 0) + ').</div>' +
            '<div class="row2">' +
              '<div><label>Mínimo neste armazém</label><input class="num" id="mn-min" inputmode="decimal" value="' +
                U.num(S.minimoDe(partes[0], partes[1])) + '"></div>' +
              '<div><label>Ideal (quanto repor até)</label><input class="num" id="mn-ideal" inputmode="decimal" value="' +
                U.num(S.idealDe(partes[0], partes[1])) + '"></div></div>',
          acoes: [{ txt: 'Salvar', cls: 'btn-aprovar', fn: function () {
            const r = S.definirMinimo(partes[0], partes[1], {
              minimo: U.parseValor(U.val('mn-min')), ideal: U.parseValor(U.val('mn-ideal')) });
            if (r.erro) return ERP.app.aviso(r.erro, 'erro');
            ERP.app.fecharModal();
            ERP.app.atualizarContadores();
            render();
            ERP.app.aviso('Mínimo do setor atualizado.', 'ok');
          } }]
        });
      });
    });
    /* Busca por texto: aplica ao sair do campo ou no Enter, sem
       redesenhar a cada tecla. */
    const busca = U.el('es-busca');
    if (busca) {
      busca.addEventListener('change', function () { buscaPosicao = this.value; render(); });
      busca.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { buscaPosicao = this.value; render(); }
      });
    }
    if (U.el('es-familia')) {
      U.el('es-familia').addEventListener('click', function () {
        agruparFamilia = !agruparFamilia;
        render();
      });
    }
    /* Clicar na família abre as variações. A escolha fica guardada:
       fechar a tela e voltar mantém aberto o que estava aberto. */
    document.querySelectorAll('[data-fam]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        const k = this.dataset.fam;
        familiasAbertas[k] = !familiasAbertas[k];
        render();
      });
    });
    if (U.el('es-busca-limpa')) {
      U.el('es-busca-limpa').addEventListener('click', function () { buscaPosicao = ''; render(); });
    }
    if (U.el('es-marcar-alerta')) {
      U.el('es-marcar-alerta').addEventListener('click', function () {
        S.posicaoEstoque(armSel() || null).filter(function (l) { return l.abaixo_unidade; })
          .forEach(function (l) { sel.add(l.produto.id + '|' + l.armazem); });
        render();
      });
      U.el('es-desmarcar').addEventListener('click', function () { sel.clear(); render(); });
      U.el('es-requisitar').addEventListener('click', requisitar);
    }
    if (U.el('en-pedido')) {
      U.el('en-pedido').addEventListener('change', function () {
        pedidoSel = this.value;
        if (this.value) puxarItensDoPedido(this.value);
        else render();
      });
    }
    if (U.el('en-armazem')) {
      U.el('en-armazem').addEventListener('change', function () { armEntrada = this.value; });
    }
    if (U.el('en-arquivo')) {
      U.el('en-arquivo').addEventListener('change', lerArquivoEntrada);
      U.el('en-gravar').addEventListener('click', gravarEntrada);
      /* As despesas ficam guardadas: a tela se redesenha ao escolher
         pedido ou ler XML, e perder o valor digitado faria a pessoa
         redigitar sem perceber que havia sumido. */
      if (U.el('en-despesas')) {
        U.el('en-despesas').addEventListener('change', function () {
          despesasNota = U.parseValor(this.value) || 0;
        });
      }
      if (U.el('en-criterio')) {
        U.el('en-criterio').addEventListener('change', function () {
          criterioRateio = this.value;
          /* Redesenha para a prévia acompanhar a escolha. */
          lerItensEntrada();
          render();
        });
      }
      renderItensEntrada();
    }
    if (U.el('iv-gravar')) U.el('iv-gravar').addEventListener('click', gravarInventario);
    /* Trocar de armazém LIMPA a contagem. Sem isto, contar o
       almoxarifado, trocar a sala no seletor e clicar de novo
       relançava a mesma contagem no armazém errado — e o estoque
       errado só aparece no inventário seguinte. */
    if (U.el('iv-armazem')) U.el('iv-armazem').addEventListener('change', function () {
      limparGradeInventario();
      ERP.app.aviso('Armazém trocado: a contagem anterior foi limpa.', 'ok');
    });
    if (U.el('es-extrato-csv')) {
      U.el('es-extrato-csv').addEventListener('click', function () {
        /* Exporta a partir dos DADOS, não da tela: assim vão os 20
           nomes de paciente (a tela mostra "+18 ver 20"), todas as
           linhas (a tela para em 250) e a quantidade como número. */
        const ids = idsSel();
        const dados = (ids && ids.length > 1
          ? ids.reduce(function (acc, am) { return acc.concat(S.movimentos({ armazem: am })); }, [])
          : S.movimentos({ armazem: (ids && ids[0]) || null }))
          .filter(function (m) { return !buscaMov || S.textoDoMovimento(m).indexOf(buscaMov.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')) > -1; })
          .filter(function (m) { return (!fMov.de || m.data >= fMov.de) && (!fMov.ate || m.data <= fMov.ate); });
        if (!dados.length) return ERP.app.aviso('Nada para exportar.', 'erro');
        const prod = id => D.produtos.find(function (x) { return x.id === id; }) || {};
        ERP.exportar.abrir({
          nome: 'extrato-estoque', titulo: 'Extrato de estoque',
          colunas: [
            { titulo: 'Data', largura: 12, tipo: 'data', valor: m => U.fData(m.data) },
            { titulo: 'Tipo', largura: 12, valor: m => m.tipo },
            { titulo: 'Material', largura: 34, valor: m => prod(m.produto).descricao || '' },
            { titulo: 'Código', largura: 12, valor: m => prod(m.produto).codigo || '' },
            { titulo: 'Armazém', largura: 24, valor: m => nomeArm(m.armazem) },
            { titulo: 'Qtd', largura: 10, tipo: 'numero', valor: m => m.qtd },
            { titulo: 'Custo unit.', largura: 12, tipo: 'numero', valor: m => m.custo },
            { titulo: 'Valor', largura: 12, tipo: 'numero', valor: m => m.valor },
            { titulo: 'Lote', largura: 12, valor: m => m.lote || '' },
            { titulo: 'Validade', largura: 12, tipo: 'data', valor: m => m.validade ? U.fData(m.validade) : '' },
            { titulo: 'Motivo', largura: 20, valor: m => m.motivo || '' },
            { titulo: 'Observação', largura: 28, valor: m => m.observacao || '' },
            /* um nome por linha do arquivo seria melhor ainda, mas a
               lista completa separada por ";" já permite procurar */
            { titulo: 'Paciente(s)', largura: 40, valor: m => S.pacientesDoMovimento(m).join('; ') },
            { titulo: 'Documento', largura: 16, valor: m => m.documento || '' },
            { titulo: 'Requisição', largura: 14, valor: m => m.requisicao || '' },
            { titulo: 'Quem lançou', largura: 20, valor: m => m.usuario || '' }
          ],
          linhas: dados
        });
      });
    }
    /* Busca do extrato (por paciente, material, motivo…) e a lista
       completa de pacientes de uma baixa em lote. */
    ['pc-de', 'pc-ate', 'pc-arm', 'pc-nome'].forEach(function (id) {
      const el = U.el(id);
      if (!el) return;
      el.addEventListener('change', function () {
        fPac = { de: U.val('pc-de'), ate: U.val('pc-ate'), armazem: U.val('pc-arm'), paciente: U.val('pc-nome') };
        render();
      });
    });
    if (U.el('pc-limpar')) U.el('pc-limpar').addEventListener('click', function () { fPac = {}; render(); });
    if (U.el('pc-exportar')) {
      U.el('pc-exportar').addEventListener('click', function () {
        const r = S.consumoPorPaciente(fPac);
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        if (!r.linhas.length) return ERP.app.aviso('Nada para exportar.', 'erro');
        ERP.exportar.abrir({
          nome: 'consumo-por-paciente', titulo: 'Consumo por paciente',
          colunas: [
            { titulo: 'Paciente', largura: 28, valor: l => l.paciente },
            { titulo: 'Material', largura: 34, valor: l => l.produto.descricao || '' },
            { titulo: 'Código', largura: 12, valor: l => l.produto.codigo || '' },
            { titulo: 'Qtd', largura: 10, tipo: 'numero', valor: l => l.qtd },
            { titulo: 'Unidade', largura: 8, valor: l => l.produto.unidade || '' },
            { titulo: 'Custo', largura: 12, tipo: 'numero', valor: l => l.valor },
            { titulo: 'Armazém', largura: 24, valor: l => l.armazem },
            { titulo: '1ª saída', largura: 12, tipo: 'data', valor: l => U.fData(l.primeira) },
            { titulo: 'Última saída', largura: 12, tipo: 'data', valor: l => U.fData(l.ultima) },
            { titulo: 'Baixas', largura: 8, tipo: 'numero', valor: l => l.movimentos }
          ],
          linhas: r.linhas
        });
      });
    }
    if (U.el('es-busca-mov')) {
      const campo = U.el('es-busca-mov');
      campo.addEventListener('change', function () { buscaMov = this.value; render(); });
      ['es-mov-de', 'es-mov-ate'].forEach(function (id) {
        if (U.el(id)) U.el(id).addEventListener('change', function () {
          fMov = { de: U.val('es-mov-de'), ate: U.val('es-mov-ate') };
          render();
        });
      });
      campo.addEventListener('keydown', function (e) { if (e.key === 'Enter') { buscaMov = this.value; render(); } });
    }
    if (U.el('es-busca-limpar')) {
      U.el('es-busca-limpar').addEventListener('click', function () { buscaMov = ''; fMov = {}; render(); });
    }
    /* Estorno: desfaz a baixa (ou a transferência, dos dois lados) pelo
       mesmo custo, em vez de exigir uma entrada manual. */
    document.querySelectorAll('[data-estorno]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = this.dataset.estorno;
        const m = S.movimentos({}).find(function (x) { return x.id === id; });
        const prod = D.produtos.find(function (x) { return x.id === m.produto; }) || {};
        ERP.app.modal({
          titulo: 'Estornar movimento',
          fecharTxt: 'Cancelar',
          corpo: '<div class="resumo-linha"><span>Movimento</span><span class="v">' + U.esc(m.tipo) + ' · ' +
              U.fData(m.data) + '</span></div>' +
            '<div class="resumo-linha"><span>Material</span><span class="v">' + U.esc(prod.descricao || '') + '</span></div>' +
            '<div class="resumo-linha"><span>Quantidade</span><span class="v">' + U.num(m.qtd) + '</span></div>' +
            '<div class="resumo-linha"><span>Armazém</span><span class="v">' + U.esc(nomeArm(m.armazem)) + '</span></div>' +
            '<div class="ajuda">O estorno devolve o saldo pelo mesmo custo e tira este consumo do relatório por ' +
              'paciente. Transferência estorna os dois lados.</div>' +
            '<label>Motivo *</label><input id="ev-motivo" placeholder="ex.: baixa lançada no setor errado">',
          acoes: [{ txt: 'Estornar', cls: 'btn-cancelar', fn: function () {
            const r = S.estornarMovimento(id, U.val('ev-motivo'));
            if (r.erro) return ERP.app.aviso(r.erro, 'erro');
            ERP.app.fecharModal();
            ERP.app.atualizarContadores();
            render();
            ERP.app.aviso('Movimento estornado.', 'ok');
          } }]
        });
      });
    });
    document.querySelectorAll('[data-mv-pac]').forEach(function (b) {
      b.addEventListener('click', function () {
        const m = S.movimentos({}).find(function (x) { return x.id === this.dataset.mvPac; }.bind(this));
        if (!m) return;
        const p = D.produtos.find(function (x) { return x.id === m.produto; }) || {};
        ERP.app.modal({
          titulo: 'Pacientes da baixa · ' + U.fData(m.data),
          fecharTxt: 'Fechar',
          corpo: '<div class="resumo-linha"><span>Material</span><span class="v">' +
              U.esc(p.descricao || '') + '</span></div>' +
            '<div class="resumo-linha"><span>Quantidade</span><span class="v">' + U.num(m.qtd) + ' ' + U.esc(p.unidade || '') + '</span></div>' +
            '<div class="resumo-linha"><span>Armazém</span><span class="v">' + U.esc(nomeArm(m.armazem)) + '</span></div>' +
            (m.observacao ? '<div class="resumo-linha"><span>Observação</span><span class="v">' + U.esc(m.observacao) + '</span></div>' : '') +
            '<h3 style="font-size:12px;margin:12px 0 4px">' + m.pacientes.length + ' paciente(s), um por unidade</h3>' +
            '<table class="parcelas"><tbody>' + m.pacientes.map(function (nome, i) {
              return '<tr><td class="mono sub" style="width:34px">' + (i + 1) + '</td><td>' + U.esc(nome) + '</td></tr>';
            }).join('') + '</tbody></table>'
        });
      });
    });
    if (U.el('es-distribuir')) {
      U.el('es-distribuir').addEventListener('click', function () { abrirDistribuicao(casaSel()); });
    }
  }

  return { montar: montar, render: render, abrirBaixa: abrirBaixa };
})();
