/* ERP · ui-relatorios.js — os relatórios que saem de graça quando a
   competência e o caixa são guardados separados. */
window.ERP = window.ERP || {};

ERP.relatorios = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;
  let atual = 'aPagarReceber';   // os dois do financeiro vêm primeiro

  function montar() {
    U.el('rel-tipo').addEventListener('change', function () { atual = this.value; render(); });
    U.el('rel-fluxo-xls').addEventListener('click', function () { ERP.exportarFluxo.gerar(); });
    U.el('rel-exportar').addEventListener('click', () => {
      const t = document.querySelector('#rel-saida table');
      const dados = ERP.exportar.deTabela(t);
      if (!dados || !dados.linhas.length) return ERP.app.aviso('Nada para exportar neste relatório.', 'erro');
      if (atual === 'faturamento') return exportarFaturamento();
      if (atual === 'aPagarReceber' || atual === 'pagasRecebidas') return exportarPeriodo();
      /* LEGENDA EM TODO RELATÓRIO: nome, empresa e período. Os dois
         relatórios de contas já tinham; os outros saíam como uma
         tabela solta, e quem recebia não sabia de que empresa nem de
         que período era aquilo. */
      const e = D.empresa || {};
      ERP.exportar.abrir(Object.assign({
        nome: 'relatorio-' + atual,
        titulo: NOMES[atual] || 'Relatório',
        cabecalho: [
          [NOMES[atual] || 'Relatório'],
          [e.nome || '' + (e.cnpj ? ' · CNPJ ' + e.cnpj : '')],
          [periodoTexto()],
          ['Emitido em ' + U.fData(U.hoje()) + ' por ' + ((S.usuario() || {}).nome || '')]
        ]
      }, dados));
    });
    U.el('rel-imprimir').addEventListener('click', () => window.print());
  }

  function render() {
    if (U.el('rel-tipo').value !== atual) U.el('rel-tipo').value = atual;
    U.el('rel-saida').innerHTML =
      atual === 'dre'       ? timbrado('o que entrou e saiu por competência') + filtrosPeriodo() + dre() :
      atual === 'empresas'  ? timbrado('resultado por empresa do grupo') + filtrosPeriodo() + porEmpresa() :
      atual === 'centro'    ? timbrado('quanto cada centro consumiu no período') + filtrosPeriodo() + porCentro() :
      atual === 'fluxo'     ? timbrado('caixa realizado e previsto, dia a dia dentro do período') + filtrosPeriodo() + fluxo() :
      atual === 'setortipo' ? timbrado('produtividade por setor e tipo de plantão') + filtrosPeriodo() + porSetorTipo() :
      atual === 'fluxoDiario' ? timbrado('os próximos dias, com o saldo andando dia a dia') + fluxoDiario() :
      atual === 'aPagarReceber' ? timbrado('o que vence no período, com saldo corrido') + aPagarReceber() :
      atual === 'pagasRecebidas' ? timbrado('o que foi baixado no período') + pagasRecebidas() :
      atual === 'faturamento' ? timbrado('quais projetos foram faturados, quais não, e quanto deu') +
        filtrosFaturamento() + faturamentoPorProjeto() :
      atual === 'fatEmissao' ? timbrado('as notas emitidas no período, por dia de emissão') +
        filtrosPeriodo() + fatPorEmissao() :
      atual === 'fatCompetencia' ? timbrado('o previsto, o faturado e o que falta faturar no mês') +
        filtrosCompetencia() + fatPorCompetencia() :
      atual === 'comparativoProd' ? timbrado('quanto a produtividade pesa sobre o faturamento, mês a mês') +
        filtrosComparativo() + comparativo() :
                               timbrado('receita, custo e margem por projeto') + filtrosPeriodo() + projeto();
    if (atual === 'setortipo') ligarFiltrosSetorTipo();
    if (atual === 'faturamento') ligarFiltrosFaturamento();
    if (atual === 'fatCompetencia') ligarFiltrosCompetencia();
    if (atual === 'comparativoProd') ligarFiltrosComparativo();
    ligarPeriodo();   // o período vale pra todos os relatórios agora
    if (U.el('fd-dias')) {
      U.el('fd-dias').addEventListener('change', function () { fdDias = +this.value; render(); });
      U.el('fd-sem-venc').addEventListener('change', function () { fdSemVencidos = this.checked; render(); });
      U.el('fd-saldo').addEventListener('change', function () { fdSaldo = U.parseValor(this.value); render(); });
    }
  }

  /* Base dos relatórios de resultado, já recortada pelo PERÍODO: antes
     DRE, centro de custo e projeto mostravam a base inteira, sem
     nenhuma forma de recortar. O recorte é por COMPETÊNCIA, que é como
     esses três leem o mundo. */
  const compIni = () => U.compDe(per.de);
  const compFim = () => U.compDe(per.ate);
  const validas = () => S.todasParcelas().filter(function (p) {
    return p.status !== 'cancelado' && (p.comp || '') >= compIni() && (p.comp || '') <= compFim();
  });

  /* ── relatórios do financeiro por período ───────────────
     No formato da planilha que o financeiro já usa: um arquivo por
     relatório, com uma aba só, cabeçalho com período (e saldo bancário,
     no de projeção) e os totais no rodapé. */
  let per = { de: U.mesAtual() + '-01', ate: U.compDe(U.addMeses(U.mesAtual() + '-01', 1)) + '-01' };
  per.ate = U.addDias(per.ate, -1);

  /* Timbrado padrão: empresa, nome do relatório e período. Antes cada
     relatório começava direto na tabela, e o arquivo impresso não dizia
     de que empresa nem de que período era. */
  const NOMES = {
    aPagarReceber: 'Contas a pagar e a receber', pagasRecebidas: 'Contas pagas e recebidas',
    fluxoDiario: 'Fluxo de caixa diário',
    dre: 'DRE por competência', empresas: 'Resultado por empresa', centro: 'Total por centro de custo',
    projeto: 'Resultado por projeto', fluxo: 'Fluxo de caixa', setortipo: 'Custos por setor/tipo',
    faturamento: 'Faturamento por projeto',
    fatEmissao: 'Faturamento por data de emissão',
    fatCompetencia: 'Faturado x a faturar por competência',
    comparativoProd: 'Produtividade sobre faturamento — comparativo'
  };
  /* No relatório de faturamento o recorte pode ser por competência —
     mostrar "Período: 01/10 a 31/10" ali confundiria com o filtro
     geral, que não é o que está valendo. */
  const periodoTexto = () => {
    if (atual === 'faturamento' && fatModo === 'competencia') return 'Competência ' + U.fComp(fatComp);
    if (atual === 'fatCompetencia') return 'Competência ' + U.fComp(fatComp);
    if (atual === 'comparativoProd') {
      return 'Comparando ' + U.fComp(compA) + ' com ' + U.fComp(compB) +
        ' · alerta acima de ' + U.num(limAlerta) + ' ponto(s)';
    }
    return 'Período: ' + U.fData(per.de) + ' a ' + U.fData(per.ate);
  };
  function timbrado(sub) {
    const e = D.empresa || {};
    return '<div class="rel-timbre">' +
      /* A marca encabeça todo relatório. Documento que sai da
         empresa sem identificação vira papel solto na mesa de quem
         recebe — e esses relatórios vão para hospital, contador e
         órgão público. */
      '<div class="marca-doc">' + ERP.marca.img({ altura: 23 }) + '</div>' +
      '<div class="rel-emp">' + U.esc(e.nome || 'HJM Dom Pedro') +
        (e.cnpj ? '<span class="sub"> · CNPJ ' + U.esc(e.cnpj) + '</span>' : '') + '</div>' +
      '<h2 style="margin:2px 0 0">' + U.esc(NOMES[atual] || 'Relatório') +
        '<span class="sub">' + U.esc(sub || '') + '</span></h2>' +
      '<div class="sub">' + periodoTexto() + ' · emitido em ' + U.fData(U.hoje()) +
        ' por ' + U.esc((S.usuario() || {}).nome || '') + '</div></div>';
  }

  /* Os atalhos mudam com o relatório: nos que olham para frente (o que
     vence) faz sentido "Hoje" e "Próximos 30 dias"; no que olha para
     trás (o que foi baixado), o atalho útil é "Mês anterior". */
  /* ── faturamento por projeto ────────────────────────────
     Dois modos de recorte, porque as duas perguntas existem: por
     COMPETÊNCIA (o mês de referência do serviço, que é como o
     contrato e a prefeitura leem) e por PERÍODO DE EMISSÃO (para
     conferir contra o livro fiscal — "o que saiu de nota entre 10 e
     20", que pode misturar competências). */
  let fatModo = 'competencia';
  let fatComp = U.mesAtual();
  /* Comparativo: dois meses e o limite do alerta. O padrão compara o
     mês atual com o anterior, que é a leitura que o financeiro faz
     todo mês. */
  let compA = U.compDe(U.addMeses(U.mesAtual() + '-01', -1));
  let compB = U.mesAtual();
  let limAlerta = 3;
  let fatUnidade = '';

  function filtrosFaturamento() {
    const unidades = D.unidades();
    return '<div class="filtros">' +
      '<div class="f"><label for="fat-modo">Recorte</label><select id="fat-modo">' +
        '<option value="competencia"' + (fatModo === 'competencia' ? ' selected' : '') +
          '>Por competência</option>' +
        '<option value="periodo"' + (fatModo === 'periodo' ? ' selected' : '') +
          '>Por data de emissão</option>' +
      '</select></div>' +
      (fatModo === 'competencia'
        ? '<div class="f"><label for="fat-comp">Competência</label>' +
          '<input type="month" id="fat-comp" value="' + fatComp + '"></div>' +
          '<button class="btn-sm" id="fat-mes-ant">Mês anterior</button>'
        : '<div class="f"><label for="fat-de">De</label><input type="date" id="fat-de" value="' +
            per.de + '"></div>' +
          '<div class="f"><label for="fat-ate">Até</label><input type="date" id="fat-ate" value="' +
            per.ate + '"></div>' +
          '<button class="btn-sm" id="fat-30">Últimos 30 dias</button>') +
      '<div class="f"><label for="fat-unidade">Unidade</label><select id="fat-unidade">' +
        '<option value="">todas</option>' +
        unidades.map(function (un) {
          return '<option value="' + U.esc(un) + '"' + (fatUnidade === un ? ' selected' : '') +
            '>' + U.esc(un) + '</option>';
        }).join('') + '</select></div>' +
      '</div>';
  }

  function ligarFiltrosFaturamento() {
    /* `liga` serve a selects e caixas; campos de DATA usam
       `U.ligarData`, que não redesenha no meio da digitação. */
    const liga = (id, fn) => { const e = U.el(id); if (e) e.addEventListener('change', fn); };
    const ligaData = (id, fn) => U.ligarData(id, fn);
    const clica = (id, fn) => { const e = U.el(id); if (e) e.addEventListener('click', fn); };
    liga('fat-modo', function () { fatModo = this.value; render(); });
    liga('fat-comp', function () { fatComp = this.value; render(); });
    liga('fat-unidade', function () { fatUnidade = this.value; render(); });
    ligaData('fat-de', function () { per.de = this.value; render(); });
    ligaData('fat-ate', function () { per.ate = this.value; render(); });
    clica('fat-mes-ant', function () {
      fatComp = U.compDe(U.addMeses(fatComp + '-01', -1)); render();
    });
    clica('fat-30', function () {
      per.ate = U.hoje(); per.de = U.addDias(U.hoje(), -30); render();
    });
  }

  /* Exportação no mesmo formato do resto: uma aba, cabeçalho com o
     recorte, totais no rodapé. Projeto sem nota sai com a célula
     VAZIA, não com zero — zero somaria no Excel. */
  function exportarFaturamento() {
    const r = fatModo === 'periodo'
      ? S.relatorioFaturamento({ de: per.de, ate: per.ate, unidade: fatUnidade || undefined })
      : S.relatorioFaturamento({ competencia: fatComp, unidade: fatUnidade || undefined });
    if (ERP.app.erroDoRetorno(r)) return;
    const porComp = r.modo === 'competencia';
    const colunas = [
      { campo: 'unidade', titulo: 'Unidade' },
      { campo: 'projeto', titulo: 'Projeto' },
      { campo: 'cliente', titulo: 'Cliente' },
      { campo: 'empresa', titulo: 'Empresa' },
      { campo: 'notas', titulo: 'Nota(s)' },
      { campo: 'faturado', titulo: 'Faturado', tipo: 'numero' },
      { campo: 'liquido', titulo: 'Líquido', tipo: 'numero' }
    ].concat(porComp ? [
      { campo: 'previsto', titulo: 'Previsto', tipo: 'numero' },
      { campo: 'diferenca', titulo: 'Diferença', tipo: 'numero' }
    ] : []).concat([{ campo: 'situacao', titulo: 'Situação' }]);
    const linhas = r.linhas.map(function (l) {
      const base = {
        unidade: l.unidade, projeto: l.projeto, cliente: l.cliente, empresa: l.empresa,
        notas: l.numeros.join(', '),
        faturado: l.faturou ? l.valor_bruto : null,
        liquido: l.faturou ? l.valor_liquido : null,
        situacao: l.faturou ? 'faturado' : 'sem nota'
      };
      if (porComp) {
        base.previsto = l.previsto > 0 ? l.previsto : null;
        base.diferenca = l.faturou && l.diferenca !== null ? l.diferenca : null;
      }
      return base;
    });
    ERP.exportar.abrir({
      nome: 'faturamento-' + (porComp ? fatComp : per.de + '_a_' + per.ate),
      titulo: 'Faturamento por projeto',
      subtitulo: (porComp ? 'Competência ' + U.fComp(fatComp)
          : 'Emissão de ' + U.fData(per.de) + ' a ' + U.fData(per.ate)) +
        ' · ' + r.faturados + ' de ' + r.projetos + ' projeto(s) faturado(s) · total ' +
        U.brl(r.total_bruto),
      colunas: colunas, linhas: linhas,
      rodape: ['Total', '', '', '', r.documentos + ' documento(s)',
        r.total_bruto, r.total_liquido].concat(porComp ? [r.total_previsto, ''] : []).concat([''])
    });
  }

  function faturamentoPorProjeto() {
    const r = fatModo === 'periodo'
      ? S.relatorioFaturamento({ de: per.de, ate: per.ate, unidade: fatUnidade || undefined })
      : S.relatorioFaturamento({ competencia: fatComp, unidade: fatUnidade || undefined });
    if (r.erro) return '<div class="vazio"><strong>' + U.esc(r.erro) + '</strong></div>';
    if (!r.linhas.length) {
      return '<div class="vazio"><strong>Nenhum projeto nesse recorte.</strong></div>';
    }

    const porCompetencia = r.modo === 'competencia';
    /* Agrupa por unidade, que é como o gestor lê a carteira. */
    const unidades = [];
    r.linhas.forEach(function (l) {
      const u = l.unidade || '(sem unidade)';
      let g = unidades.find(function (x) { return x.nome === u; });
      if (!g) { g = { nome: u, linhas: [] }; unidades.push(g); }
      g.linhas.push(l);
    });

    const colunas = 6 + (porCompetencia ? 2 : 0);
    const linhaProjeto = function (l) {
      /* Projeto sem nota aparece com TRAÇO, não com zero: zero é um
         valor faturado, traço é ausência de nota. */
      const traco = '<span class="sub">—</span>';
      return '<tr' + (l.faturou ? '' : ' class="g"') + '>' +
        '<td class="desc">' + U.esc(l.projeto) +
          (l.grupo ? '<div class="sub">grupo ' + U.esc(l.grupo) + '</div>' : '') + '</td>' +
        '<td class="sub">' + U.esc(l.cliente) + '</td>' +
        '<td class="sub">' + (l.numeros.length ? U.esc(l.numeros.join(', ')) : traco) + '</td>' +
        '<td class="num">' + (l.faturou ? U.brl(l.valor_bruto) : traco) + '</td>' +
        '<td class="num">' + (l.faturou ? U.brl(l.valor_liquido) : traco) + '</td>' +
        (porCompetencia
          ? '<td class="num">' + (l.previsto > 0 ? U.brl(l.previsto) : traco) + '</td>' +
            '<td class="num">' + (l.faturou && l.diferenca !== null
              ? '<span class="' + (Math.abs(l.diferenca) < 0.01 ? 'sub'
                  : (l.diferenca < 0 ? 'erro' : '')) + '">' + U.brl(l.diferenca) + '</span>'
              : traco) + '</td>'
          : '') +
        '<td>' + (l.faturou
          ? '<span class="badge b-pago">faturado</span>'
          : '<span class="badge b-pendente">sem nota</span>') + '</td></tr>';
    };

    return '<div class="pr-confere">' +
        '<span>Projetos <b>' + r.projetos + '</b></span>' +
        '<span>Faturados <b>' + r.faturados + '</b></span>' +
        '<span>Sem nota <b>' + r.nao_faturados + '</b></span>' +
        '<span>Documentos <b>' + r.documentos + '</b></span>' +
        '<span>Total faturado <b>' + U.brl(r.total_bruto) + '</b></span>' +
        (porCompetencia && r.total_nao_faturado > 0
          ? '<span>Previsto sem nota <b>' + U.brl(r.total_nao_faturado) + '</b></span>' : '') +
      '</div>' +
      '<div class="tabela-rolagem"><table><thead><tr>' +
        '<th>Projeto</th><th>Cliente</th><th>Nota(s)</th>' +
        '<th class="num" style="width:130px">Faturado</th>' +
        '<th class="num" style="width:130px">Líquido</th>' +
        (porCompetencia
          ? '<th class="num" style="width:130px">Previsto</th>' +
            '<th class="num" style="width:120px">Diferença</th>'
          : '') +
        '<th style="width:110px">Situação</th></tr></thead><tbody>' +
      unidades.map(function (g) {
        const somaUn = Math.round(g.linhas.reduce(function (a, l) {
          return a + l.valor_bruto; }, 0) * 100) / 100;
        const faturadosUn = g.linhas.filter(function (l) { return l.faturou; }).length;
        return '<tr><td class="g" colspan="' + colunas + '" style="font-weight:650;background:#f2f4f5">' +
            U.esc(g.nome) + ' · ' + faturadosUn + ' de ' + g.linhas.length + ' faturado(s) · ' +
            U.brl(somaUn) + '</td></tr>' +
          g.linhas.map(linhaProjeto).join('');
      }).join('') +
      '<tr><td colspan="3"><b>Total</b></td>' +
        '<td class="num"><b>' + U.brl(r.total_bruto) + '</b></td>' +
        '<td class="num"><b>' + U.brl(r.total_liquido) + '</b></td>' +
        (porCompetencia
          ? '<td class="num"><b>' + U.brl(r.total_previsto) + '</b></td><td></td>'
          : '') +
        '<td></td></tr>' +
      '</tbody></table></div>' +
      '<div class="ajuda">Projeto sem nota no recorte aparece com traço, não com zero — zero seria ' +
      'um valor faturado. ' +
      (porCompetencia
        ? 'A competência é o mês de referência do serviço, que é como o contrato e a prefeitura leem.'
        : 'O recorte é pela data de EMISSÃO da nota, então pode misturar competências — é o modo ' +
          'de conferir contra o livro fiscal.') +
      ' Nota de grupo de faturamento entra em cada projeto pela parte do rateio; o total conta o ' +
      'documento uma vez só.</div>';
  }


  /* ── Faturamento por data de emissão ───────────────────────────
     Responde "o que eu emiti entre tal e tal data". A competência
     fica ao lado porque nota de novembro pode ser de outubro, e a
     conferência com o contador empaca justamente aí. */
  function fatPorEmissao() {
    const r = S.faturamentoPorEmissao(per.de, per.ate);
    if (!r.linhas.length) return vazio('Nenhuma nota emitida neste período.');

    let html = '<table class="rel"><thead><tr>' +
      '<th>Emissão</th><th>Documento</th><th>Projeto</th><th>Cliente</th>' +
      '<th>Competência</th><th>Vencimento</th>' +
      '<th class="num">Bruto</th><th class="num">Retido na fonte</th>' +
      '<th class="num">Líquido</th><th>Situação</th></tr></thead><tbody>';

    let diaAtual = '';
    r.linhas.forEach(function (l) {
      /* Uma linha de dia quando a data muda: o relatório é lido
         procurando "o que saiu no dia tal". */
      if (l.emissao !== diaAtual) {
        diaAtual = l.emissao;
        const doDia = r.linhas.filter(function (x) { return x.emissao === diaAtual; });
        const somaDia = doDia.reduce(function (a, x) { return a + x.bruto; }, 0);
        html += '<tr class="grupo"><td colspan="6"><b>' + U.fData(l.emissao) + '</b>' +
          '<span class="sub"> · ' + doDia.length + ' nota(s)</span></td>' +
          '<td class="num"><b>' + U.num(somaDia) + '</b></td><td colspan="3"></td></tr>';
      }
      html += '<tr><td class="sub">' + U.fData(l.emissao) + '</td>' +
        '<td>' + U.esc(l.numero || '—') + '</td>' +
        '<td>' + U.esc(l.projeto) + '</td>' +
        '<td class="sub">' + U.esc(l.cliente || '—') + '</td>' +
        '<td>' + U.esc(l.competencia ? U.fComp(l.competencia) : '—') + '</td>' +
        '<td class="sub">' + (l.vencimento ? U.fData(l.vencimento) : '—') + '</td>' +
        '<td class="num">' + U.num(l.bruto) + '</td>' +
        '<td class="num sub">' + (l.retido ? U.num(l.retido) : '—') + '</td>' +
        '<td class="num">' + U.num(l.liquido) + '</td>' +
        '<td>' + U.esc(l.status) + '</td></tr>';
    });
    html += '<tr class="total"><td colspan="6">Total — ' + r.linhas.length + ' nota(s)</td>' +
      '<td class="num">' + U.num(r.bruto) + '</td>' +
      '<td class="num">' + U.num(r.retido) + '</td>' +
      '<td class="num">' + U.num(r.liquido) + '</td><td></td></tr>';
    html += '</tbody></table>' +
      '<div class="ajuda">Data de emissão é o que fecha com o livro fiscal. A competência ao lado ' +
      'mostra a que mês o serviço pertence — e elas divergem sempre que a nota é emitida no mês ' +
      'seguinte ao da prestação.</div>';
    return html;
  }

  /* ── Faturado x a faturar, por competência ─────────────────────
     O que importa não é o que saiu, é o que FALTA sair. Projeto sem
     nota aparece primeiro, com o valor previsto. */
  function fatPorCompetencia() {
    const r = S.faturamentoPorCompetencia(fatComp);
    if (!r.linhas.length) return vazio('Nenhum projeto com previsão ou nota nesta competência.');

    const naoFaturados = r.linhas.filter(function (l) { return !l.faturado; });
    let html = '';
    if (naoFaturados.length) {
      html += '<div class="aviso"><b>' + naoFaturados.length + ' projeto(s) sem nota nesta ' +
        'competência</b>, somando ' + U.brl(r.a_faturar) + ' previstos. Eles aparecem no topo ' +
        'da lista.</div>';
    }
    html += '<table class="rel"><thead><tr><th>Projeto</th>' +
      '<th class="num">Previsto</th><th class="num">Faturado</th>' +
      '<th class="num">Diferença</th><th class="num">Notas</th>' +
      '<th>Última emissão</th><th>Situação</th><th>Etapa</th></tr></thead><tbody>';

    r.linhas.forEach(function (l) {
      const semNota = !l.faturado;
      html += '<tr' + (semNota ? ' style="background:var(--amber-bg,#fdf6e3)"' : '') + '>' +
        '<td>' + U.esc(l.projeto) + '</td>' +
        '<td class="num">' + (l.previsto ? U.num(l.previsto) : '—') + '</td>' +
        '<td class="num">' + (l.faturado ? U.num(l.faturado) : '—') + '</td>' +
        '<td class="num"' + (Math.abs(l.diferenca) > 0.01 ? ' style="color:var(--red)"' : '') + '>' +
          (Math.abs(l.diferenca) > 0.01 ? U.num(l.diferenca) : '—') + '</td>' +
        '<td class="num sub">' + (l.notas || '—') + '</td>' +
        '<td class="sub">' + (l.ultima_emissao ? U.fData(l.ultima_emissao) : '—') + '</td>' +
        '<td>' + (semNota ? '<span class="badge b-aberto">não faturado</span>'
          : '<span class="badge b-aprovado">' + U.esc(l.situacao) + '</span>') + '</td>' +
        '<td class="sub">' + U.esc(l.etapa || '—') + '</td></tr>';
    });
    html += '<tr class="total"><td>Total</td>' +
      '<td class="num">' + U.num(r.previsto) + '</td>' +
      '<td class="num">' + U.num(r.faturado) + '</td>' +
      '<td class="num">' + U.num(r.faturado - r.previsto) + '</td>' +
      '<td colspan="4"></td></tr></tbody></table>' +
      '<div class="ajuda">Previsto vem da previsão do mês; faturado é a soma das notas com aquela ' +
      'competência. <b>A faturar: ' + U.brl(r.a_faturar) + '</b> — é o que ainda não virou nota ' +
      'e precisa sair antes do fechamento.</div>';
    return html;
  }

  /* ── Comparativo de produtividade sobre faturamento ────────────
     A conta que interessa é o percentual. Faturamento sobe e desce
     com o volume; o que diz se o projeto está indo bem é a fatia que
     vai para os médicos. */
  function comparativo() {
    const r = S.comparativoProdutividade(compA, compB, limAlerta);
    if (!r.linhas.length) return vazio('Nenhum projeto com movimento nas duas competências.');

    let html = '';
    if (r.com_alerta) {
      html += '<div class="aviso"><b>' + r.com_alerta + ' projeto(s) com variação acima de ' +
        U.num(limAlerta) + ' ponto(s)</b> entre ' + U.fComp(compA) + ' e ' + U.fComp(compB) +
        '. Vermelho: a produtividade passou a pesar mais sobre o faturamento (margem menor). ' +
        'Azul: passou a pesar menos — confira se há produtividade ainda não lançada.</div>';
    }
    /* Cabeçalho em UMA linha, com a competência dentro do título de
       cada coluna. Duas linhas com `colspan` ficam bonitas na tela e
       quebram na exportação — a planilha não tem como saber a que
       mês pertence cada coluna. */
    html += '<table class="rel"><thead><tr><th>Projeto</th>' +
      '<th class="num">Faturamento ' + U.fComp(compA) + '</th>' +
      '<th class="num">Produtividade ' + U.fComp(compA) + '</th>' +
      '<th class="num">% ' + U.fComp(compA) + '</th>' +
      '<th class="num">Faturamento ' + U.fComp(compB) + '</th>' +
      '<th class="num">Produtividade ' + U.fComp(compB) + '</th>' +
      '<th class="num">% ' + U.fComp(compB) + '</th>' +
      '<th class="num">Variação</th></tr></thead><tbody>';

    r.linhas.forEach(function (l) {
      /* A cor sai da mesma regra que a planilha usa: nunca duas
         definições do que é um desvio. */
      const cor = l.alerta === 'piorou' ? 'background:#fbe9e7'
        : l.alerta === 'melhorou' ? 'background:#e3f2fd' : '';
      html += '<tr><td>' + U.esc(l.projeto) + '</td>' +
        '<td class="num">' + (l.fat_a ? U.num(l.fat_a) : '—') + '</td>' +
        '<td class="num">' + (l.prod_a ? U.num(l.prod_a) : '—') + '</td>' +
        '<td class="num">' + (l.pct_a === null ? '—' : U.num(l.pct_a) + '%') + '</td>' +
        '<td class="num">' + (l.fat_b ? U.num(l.fat_b) : '—') + '</td>' +
        '<td class="num">' + (l.prod_b ? U.num(l.prod_b) : '—') + '</td>' +
        '<td class="num"' + (cor ? ' style="' + cor + ';font-weight:650"' : '') + '>' +
          (l.pct_b === null ? '—' : U.num(l.pct_b) + '%') + '</td>' +
        '<td class="num"' + (cor ? ' style="' + cor + '"' : '') + '>' +
          (l.dif_pct === null ? '—'
            : (l.dif_pct > 0 ? '+' : '') + U.num(l.dif_pct) + ' p.p.') + '</td></tr>';
    });
    html += '<tr class="total"><td>Total</td>' +
      '<td class="num">' + U.num(r.fat_a) + '</td><td class="num">' + U.num(r.prod_a) + '</td>' +
      '<td class="num">' + (r.pct_a === null ? '—' : U.num(r.pct_a) + '%') + '</td>' +
      '<td class="num">' + U.num(r.fat_b) + '</td><td class="num">' + U.num(r.prod_b) + '</td>' +
      '<td class="num">' + (r.pct_b === null ? '—' : U.num(r.pct_b) + '%') + '</td>' +
      '<td class="num">' + (r.pct_a === null || r.pct_b === null ? '—'
        : (r.pct_b - r.pct_a > 0 ? '+' : '') + U.num(r.pct_b - r.pct_a) + ' p.p.') +
      '</td></tr></tbody></table>' +
      '<div class="ajuda">O percentual é produtividade dividida por faturamento. Projeto sem nota ' +
      'no mês entra pelo valor previsto, senão a comparação ficaria vazia justamente no mês ' +
      'corrente. Variação em pontos percentuais (p.p.): de 85% para 89% são 4 p.p.</div>';
    return html;
  }

  /* ── Filtros das telas novas ───────────────────────────────── */
  function filtrosCompetencia() {
    return '<div class="filtros">' +
      '<div class="f"><label for="fc-comp">Competência</label>' +
        '<input type="month" id="fc-comp" value="' + fatComp + '"></div>' +
      '<button class="btn-sm" id="fc-mes-ant">Mês anterior</button>' +
      '<button class="btn-sm" id="fc-mes-atual">Mês atual</button>' +
      '</div>';
  }

  function ligarFiltrosCompetencia() {
    const e = U.el('fc-comp');
    if (e) e.addEventListener('change', function () { fatComp = this.value; render(); });
    const ant = U.el('fc-mes-ant');
    if (ant) ant.addEventListener('click', function () {
      fatComp = U.compDe(U.addMeses(fatComp + '-01', -1)); render();
    });
    const at = U.el('fc-mes-atual');
    if (at) at.addEventListener('click', function () { fatComp = U.mesAtual(); render(); });
  }

  function filtrosComparativo() {
    return '<div class="filtros">' +
      '<div class="f"><label for="cp-a">Competência base</label>' +
        '<input type="month" id="cp-a" value="' + compA + '"></div>' +
      '<div class="f"><label for="cp-b">Comparar com</label>' +
        '<input type="month" id="cp-b" value="' + compB + '"></div>' +
      '<div class="f"><label for="cp-lim">Alerta acima de (p.p.)</label>' +
        '<input class="num" id="cp-lim" inputmode="decimal" value="' + U.num(limAlerta) + '" ' +
        'style="width:90px"></div>' +
      '<button class="btn-sm" id="cp-trocar">Inverter os meses</button>' +
      '</div>';
  }

  function ligarFiltrosComparativo() {
    const a = U.el('cp-a');
    if (a) a.addEventListener('change', function () { compA = this.value; render(); });
    const b = U.el('cp-b');
    if (b) b.addEventListener('change', function () { compB = this.value; render(); });
    const l = U.el('cp-lim');
    if (l) l.addEventListener('change', function () {
      const v = U.parseValor(this.value);
      /* Limite zero marcaria tudo e limite enorme não marcaria nada:
         nos dois casos o relatório deixa de ajudar. */
      limAlerta = (isFinite(v) && v > 0 && v <= 50) ? v : 3;
      render();
    });
    const t = U.el('cp-trocar');
    if (t) t.addEventListener('click', function () {
      const x = compA; compA = compB; compB = x; render();
    });
  }

  function filtrosPeriodo(extra) {
    const olhaParaFrente = atual === 'aPagarReceber';
    const olhaParaTras = atual === 'pagasRecebidas';
    return '<div class="filtros">' +
      '<div class="f"><label for="rp-de">De</label><input type="date" id="rp-de" value="' + per.de + '"></div>' +
      '<div class="f"><label for="rp-ate">Até</label><input type="date" id="rp-ate" value="' + per.ate + '"></div>' +
      (olhaParaFrente ? '<button class="btn-sm" id="rp-hoje">Hoje</button>' : '') +
      '<button class="btn-sm" id="rp-mes">Mês atual</button>' +
      (olhaParaTras ? '<button class="btn-sm" id="rp-mes-ant">Mês anterior</button>' : '') +
      /* Num relatório do que já foi baixado, "próximos 30 dias" traz
         sempre uma tela vazia: ali o atalho é para trás. */
      (olhaParaTras
        ? '<button class="btn-sm" id="rp-30-tras">Últimos 30 dias</button>'
        : '<button class="btn-sm" id="rp-30">Próximos 30 dias</button>') +
      (extra || '') + '</div>';
  }

  function ligarPeriodo() {
    ['rp-de', 'rp-ate'].forEach(function (id) {
      if (U.el(id)) U.el(id).addEventListener('change', function () {
        per = { de: U.val('rp-de'), ate: U.val('rp-ate') };
        render();
      });
    });
    if (U.el('rp-mes')) U.el('rp-mes').addEventListener('click', function () {
      const ini = U.mesAtual() + '-01';
      per = { de: ini, ate: U.addDias(U.compDe(U.addMeses(ini, 1)) + '-01', -1) };
      render();
    });
    if (U.el('rp-hoje')) U.el('rp-hoje').addEventListener('click', function () {
      per = { de: U.hoje(), ate: U.hoje() };
      render();
    });
    if (U.el('rp-mes-ant')) U.el('rp-mes-ant').addEventListener('click', function () {
      const ini = U.compDe(U.addMeses(U.mesAtual() + '-01', -1)) + '-01';
      per = { de: ini, ate: U.addDias(U.mesAtual() + '-01', -1) };
      render();
    });
    if (U.el('rp-30')) U.el('rp-30').addEventListener('click', function () {
      per = { de: U.hoje(), ate: U.addDias(U.hoje(), 30) };
      render();
    });
    if (U.el('rp-30-tras')) U.el('rp-30-tras').addEventListener('click', function () {
      per = { de: U.addDias(U.hoje(), -30), ate: U.hoje() };
      render();
    });
    if (U.el('rp-exportar')) U.el('rp-exportar').addEventListener('click', exportarPeriodo);
    if (U.el('rp-exportar-bancos')) U.el('rp-exportar-bancos').addEventListener('click', exportarPorBanco);
    if (U.el('rp-banco')) U.el('rp-banco').addEventListener('change', function () {
      relBanco = this.value; render();
    });
  }

  const COLS_PREVISTO = [
    { titulo: 'Tipo', largura: 10, valor: l => l.tipo },
    { titulo: 'Mov.', largura: 7, valor: l => l.mov },
    { titulo: 'Documento', largura: 16, valor: l => l.documento },
    { titulo: 'Forma PG', largura: 16, valor: l => l.forma },
    { titulo: 'Fornecedor', largura: 30, valor: l => l.contraparte },
    { titulo: 'Descrição', largura: 38, valor: l => l.descricao },
    /* Competência é data: sai 10/2026, não 2026-10. O banco guarda
       AAAA-MM porque ordena certo; a tela e o arquivo mostram no
       formato de quem lê. */
    { titulo: 'Competência', largura: 12, valor: l => U.fComp(l.competencia) },
    { titulo: 'Emissão', largura: 12, tipo: 'data', valor: l => l.emissao ? U.fData(l.emissao) : '' },
    { titulo: 'Vencimento', largura: 12, tipo: 'data', valor: l => U.fData(l.vencimento) },
    { titulo: 'Parcela', largura: 9, valor: l => l.parcela },
    { titulo: 'Valor da parcela', largura: 16, tipo: 'numero', valor: l => l.valor },
    { titulo: 'Saldo', largura: 16, tipo: 'numero', valor: l => l.saldo }
  ];

  const COLS_REALIZADO = [
    { titulo: 'Tipo', largura: 10, valor: l => l.tipo },
    { titulo: 'Documento', largura: 16, valor: l => l.documento },
    { titulo: 'Forma', largura: 16, valor: l => l.forma },
    { titulo: 'Fornecedor', largura: 30, valor: l => l.contraparte },
    { titulo: 'Descrição', largura: 38, valor: l => l.descricao },
    { titulo: 'Competência', largura: 12, valor: l => U.fComp(l.competencia) },
    { titulo: 'Emissão', largura: 12, tipo: 'data', valor: l => l.emissao ? U.fData(l.emissao) : '' },
    { titulo: 'Vencimento', largura: 12, tipo: 'data', valor: l => l.vencimento ? U.fData(l.vencimento) : '' },
    { titulo: 'Data baixa', largura: 12, tipo: 'data', valor: l => U.fData(l.baixa) },
    { titulo: 'Parcela', largura: 9, valor: l => l.parcela },
    { titulo: 'Valor da parcela', largura: 16, tipo: 'numero', valor: l => l.valor },
    /* Banco e empresa em coluna: é o que a contabilidade usa para
       separar o movimento por conta e por CNPJ. */
    { titulo: 'Banco', largura: 22, valor: l => l.banco || '' },
    { titulo: 'Empresa', largura: 18, valor: l => l.empresa || '' }
  ];

  /* Conta escolhida no relatório de pagas e recebidas. Vazio = todas,
     com o banco aparecendo em coluna. */
  let relBanco = '';

  function filtroBancoRel() {
    return '<div class="f"><label for="rp-banco">Banco</label><select id="rp-banco">' +
      '<option value="">todos os bancos</option>' +
      D.bancos.filter(function (b) { return b.ativo; }).map(function (b) {
        const e = D.empresaPor(b.empresa);
        return '<option value="' + b.id + '"' + (relBanco === b.id ? ' selected' : '') + '>' +
          U.esc(b.apelido) + (e ? ' · ' + U.esc(e.apelido) : '') + '</option>';
      }).join('') + '</select></div>';
  }

  /* Um arquivo por conta, que é como a contabilidade recebe: cada CNPJ
     lança o seu movimento, e um arquivo só com tudo junto obriga
     alguém a separar à mão do outro lado. */
  function exportarPorBanco() {
    const periodo = 'Período: ' + U.fData(per.de) + ' a ' + U.fData(per.ate);
    const contas = D.bancos.filter(function (b) { return b.ativo; }).map(function (b) {
      return { banco: b, r: S.contasPagasERecebidas(per.de, per.ate, { banco: b.id }) };
    }).filter(function (x) { return x.r.linhas.length; });
    if (!contas.length) return ERP.app.aviso('Nada a exportar neste período.', 'erro');
    const total = S.contasPagasERecebidas(per.de, per.ate);
    const somaContas = contas.reduce(function (s, x) { return s + x.r.linhas.length; }, 0);

    ERP.app.modal({
      titulo: 'Exportar por banco', fecharTxt: 'Fechar',
      corpo: '<p class="ajuda">Um arquivo por conta, com a empresa e o CNPJ no cabeçalho.</p>' +
        '<table><thead><tr><th>Conta</th><th>Empresa</th><th class="num">Lançamentos</th>' +
        '<th class="num">Pago</th><th class="num">Recebido</th><th></th></tr></thead><tbody>' +
        contas.map(function (x, i) {
          const e = D.empresaPor(x.banco.empresa) || {};
          return '<tr><td>' + U.esc(x.banco.apelido) + '</td>' +
            '<td class="sub">' + U.esc(e.apelido || '') + '</td>' +
            '<td class="num">' + x.r.linhas.length + '</td>' +
            '<td class="num">' + U.brl(x.r.total_pago) + '</td>' +
            '<td class="num">' + U.brl(x.r.total_recebido) + '</td>' +
            '<td><button class="btn-sm" data-exp="' + i + '">Baixar</button></td></tr>';
        }).join('') + '</tbody></table>' +
        (somaContas < total.linhas.length
          ? '<div class="aviso-linha erro">' + (total.linhas.length - somaContas) + ' lançamento(s) do ' +
            'período estão sem conta identificada e não entram em nenhum dos arquivos. ' +
            'Aparecem no relatório completo, com o banco em branco.</div>'
          : ''),
      depois: function () {
        document.querySelectorAll('[data-exp]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            const x = contas[+this.dataset.exp];
            const e = D.empresaPor(x.banco.empresa) || {};
            ERP.exportar.abrir({
              nome: 'movimento-' + U.slug(x.banco.apelido) + '-' + per.de + '-a-' + per.ate,
              titulo: 'Movimento — ' + x.banco.apelido,
              colunas: COLS_REALIZADO, linhas: x.r.linhas,
              cabecalho: [['Movimento bancário — ' + x.banco.apelido],
                [periodo, '', 'Empresa', (e.apelido || '') + ' · ' + (e.cnpj || '')]],
              rodape: [[], ['Recebido', x.r.total_recebido], ['Pago', x.r.total_pago],
                ['Resultado do caixa', x.r.resultado]]
            });
          });
        });
      }
    });
  }

  /* Fluxo diário: começa no saldo bancário de hoje e anda dia a dia.
     A caixa de "desconsiderar vencidos" existe para o caso real de
     atrasado em negociação, que não vai sair amanhã. */
  let fdDias = 10, fdSemVencidos = false, fdSaldo = null;
  function fluxoDiario() {
    const f = S.fluxoDiario({ dias: fdDias, sem_vencidos: fdSemVencidos, saldo_inicial: fdSaldo });
    /* O saldo de partida é o do GRUPO: somar as contas ativas, não a
       primeira. */
    const resumoContas = S.saldoBancarioAtual() || {};
    const qtdContas = (resumoContas.contas || []).length;
    return '<div class="filtros">' +
        '<div class="f"><label for="fd-saldo">Saldo de partida (R$)</label>' +
          '<input class="num" id="fd-saldo" inputmode="decimal" value="' + U.num(f.saldo_inicial) + '"></div>' +
        '<div class="f"><label for="fd-dias">Dias</label><select id="fd-dias">' +
          [7, 10, 15, 30].map(function (d) {
            return '<option value="' + d + '"' + (fdDias === d ? ' selected' : '') + '>' + d + ' dias</option>';
          }).join('') + '</select></div>' +
        '<label style="align-self:flex-end;font-weight:400"><input type="checkbox" id="fd-sem-venc" ' +
          'style="width:auto"' + (fdSemVencidos ? ' checked' : '') + '> desconsiderar vencidos</label>' +
      '</div>' +
      '<div class="pr-confere">' +
        '<span>Saldo hoje <b>' + U.brl(f.saldo_inicial) + '</b>' +
          (qtdContas ? ' <span class="sub">' + qtdContas +
            (qtdContas === 1 ? ' conta' : ' contas somadas') + '</span>' : '') + '</span>' +
        '<span>Menor saldo do período <b class="' + (f.menor_saldo < 0 ? 'erro' : '') + '">' +
          U.brl(f.menor_saldo) + '</b></span>' +
        /* Quanto do buraco é previsto (folha, guias): parte da
           projeção ainda não é título vencido. */
        (f.previsto_saida > 0.004 || f.previsto_entrada > 0.004
          ? '<span>Dentro disso, previsto <b>\u2212 ' + U.brl(f.previsto_saida) + '</b>' +
            (f.previsto_entrada > 0.004 ? ' <b>+ ' + U.brl(f.previsto_entrada) + '</b>' : '') + '</span>'
          : '') +
        (f.primeiro_negativo
          ? '<span class="erro">falta dinheiro a partir de <b>' + U.fData(f.primeiro_negativo) + '</b></span>'
          : '<span>o caixa não fica negativo no período</span>') +
      '</div>' +
      '<table class="rel"><thead><tr><th>Dia</th><th class="num">Entradas</th><th class="num">Saídas</th>' +
        '<th class="num">Saldo no fim do dia</th><th>O que pesa no dia</th></tr></thead><tbody>' +
        '<tr class="total"><td>Saldo de partida</td><td class="num">—</td><td class="num">—</td>' +
          '<td class="num">' + U.num(f.saldo_inicial) + '</td><td class="sub">saldo bancário de hoje</td></tr>' +
        f.linhas.map(function (l) {
          const maiores = l.itens.slice().sort(function (a2, b2) { return b2.valor - a2.valor; }).slice(0, 2);
          return '<tr' + (l.negativo ? ' style="background:#fff4f2"' : '') + '>' +
            '<td class="mono">' + U.fData(l.data) + (l.hoje ? ' <span class="sub">hoje</span>' : '') + '</td>' +
            '<td class="num">' + (l.entradas ? U.num(l.entradas) : '—') + '</td>' +
            '<td class="num">' + (l.saidas ? U.num(l.saidas) : '—') + '</td>' +
            '<td class="num' + (l.negativo ? ' erro' : '') + '">' + U.num(l.saldo) + '</td>' +
            '<td class="sub">' + (maiores.length
              ? U.esc(maiores.map(function (i) {
                  return (i.tipo === 'saida' ? '\u2212 ' : '+ ') + U.brl(i.valor) + ' ' + String(i.descricao).slice(0, 26);
                }).join(' · ')) + (l.itens.length > 2 ? ' · e mais ' + (l.itens.length - 2) : '')
              : '—') + '</td></tr>';
        }).join('') +
      '</tbody></table>' +
      '<div class="ajuda">O saldo de partida vem do saldo bancário informado (Financeiro › Saldo ' +
        'bancário) ou, na falta dele, do último extrato mais as baixas posteriores — e pode ser trocado ' +
        'aqui para simular. Parcela vencida entra no dia de hoje, porque é quando sai se houver dinheiro.</div>';
  }

  function aPagarReceber() {
    const r = S.contasAPagarEReceber(per.de, per.ate);
    return filtrosPeriodo('<button class="btn-sm" id="rp-exportar" style="align-self:flex-end">Exportar</button>') +
      '<div class="pr-confere">' +
        '<span>Saldo bancário hoje <b>' + U.brl(r.saldo_banco) + '</b></span>' +
        '<span>Entradas <b>' + U.brl(r.total_entradas) + '</b></span>' +
        '<span>Saídas <b>' + U.brl(r.total_saidas) + '</b></span>' +
        '<span>Saldo projetado <b class="' + (r.saldo_final < 0 ? 'erro' : '') + '">' + U.brl(r.saldo_final) + '</b></span>' +
      '</div>' +
      (r.saldo_final < 0 ? '<div class="ajuda erro">O saldo projetado fica negativo dentro do período — ' +
        'olhe a coluna Saldo para ver em que dia isso acontece.</div>' : '') +
      '<div class="tabela-rolagem" style="margin:0 -14px"><table><thead><tr>' +
        COLS_PREVISTO.map(function (c) {
          return '<th' + (c.tipo === 'numero' ? ' class="num"' : '') + '>' + c.titulo + '</th>';
        }).join('') + '</tr></thead><tbody>' +
        /* A primeira linha é o saldo de partida, como na planilha do
           financeiro — sem ela a coluna Saldo não faz sentido. */
        '<tr><td>Saldo</td><td>Sim</td><td colspan="8" class="sub">saldo bancário em ' + U.fData(U.hoje()) + '</td>' +
          '<td class="num">—</td><td class="num"><b>' + U.brl(r.saldo_banco) + '</b></td></tr>' +
        (r.linhas.length ? r.linhas.map(function (l) {
          return '<tr' + (l.saldo < 0 ? ' style="background:#fff4f2"' : '') + '>' +
            '<td>' + l.tipo + '</td><td class="sub">' + l.mov + '</td>' +
            '<td class="mono">' + U.esc(l.documento || '—') + '</td>' +
            '<td class="sub">' + U.esc(l.forma) + (l.previsto ? '<div class="sub">previsto</div>' : '') + '</td>' +
            '<td class="desc">' + U.esc(l.contraparte) + '</td>' +
            '<td class="desc">' + U.esc(l.descricao) + '</td>' +
            '<td class="mono sub">' + U.esc(l.competencia) + '</td>' +
            '<td class="mono">' + (l.emissao ? U.fData(l.emissao) : '—') + '</td>' +
            '<td class="mono">' + U.fData(l.vencimento) + '</td>' +
            '<td class="sub">' + l.parcela + '</td>' +
            '<td class="num">' + U.brl(l.valor) + '</td>' +
            '<td class="num' + (l.saldo < 0 ? ' erro' : '') + '">' + U.brl(l.saldo) + '</td></tr>';
        }).join('')
          : '<tr><td colspan="12" class="vazio"><strong>Nada vencendo neste período.</strong></td></tr>') +
      '</tbody></table></div>';
  }

  function pagasRecebidas() {
    const r = S.contasPagasERecebidas(per.de, per.ate, { banco: relBanco });
    return filtrosPeriodo(filtroBancoRel() +
        '<button class="btn-sm" id="rp-exportar" style="align-self:flex-end">Exportar</button>' +
        '<button class="btn-sm" id="rp-exportar-bancos" style="align-self:flex-end" ' +
          'title="Um arquivo por conta, do jeito que a contabilidade pede">Exportar por banco</button>') +
      '<div class="pr-confere">' +
        '<span>Recebido <b>' + U.brl(r.total_recebido) + '</b></span>' +
        '<span>Pago <b>' + U.brl(r.total_pago) + '</b></span>' +
        '<span>Resultado do caixa <b class="' + (r.resultado < 0 ? 'erro' : '') + '">' + U.brl(r.resultado) + '</b></span>' +
      '</div>' +
      '<div class="tabela-rolagem" style="margin:0 -14px"><table><thead><tr>' +
        COLS_REALIZADO.map(function (c) {
          return '<th' + (c.tipo === 'numero' ? ' class="num"' : '') + '>' + c.titulo + '</th>';
        }).join('') + '</tr></thead><tbody>' +
        (r.linhas.length ? r.linhas.map(function (l) {
          return '<tr><td>' + l.tipo + '</td>' +
            '<td class="mono">' + U.esc(l.documento || '—') + '</td>' +
            '<td class="sub">' + U.esc(l.forma) + '</td>' +
            '<td class="desc">' + U.esc(l.contraparte) + '</td>' +
            '<td class="desc">' + U.esc(l.descricao) +
              (l.juros > 0 ? '<div class="sub">inclui ' + U.brl(l.juros) + ' de juros/multa</div>' : '') + '</td>' +
            '<td class="mono sub">' + U.esc(l.competencia) + '</td>' +
            '<td class="mono">' + (l.emissao ? U.fData(l.emissao) : '—') + '</td>' +
            '<td class="mono">' + (l.vencimento ? U.fData(l.vencimento) : '—') + '</td>' +
            '<td class="mono">' + U.fData(l.baixa) + '</td>' +
            '<td class="sub">' + l.parcela + '</td>' +
            '<td class="num">' + U.brl(l.valor) + '</td></tr>';
        }).join('')
          : '<tr><td colspan="11" class="vazio"><strong>Nenhuma baixa neste período.</strong></td></tr>') +
      '</tbody></table></div>';
  }

  /* Cada relatório sai NUM ARQUIVO, com uma aba só — foi o pedido. */
  function exportarPeriodo() {
    const periodo = 'Período: ' + U.fData(per.de) + ' a ' + U.fData(per.ate);
    if (atual === 'aPagarReceber') {
      const r = S.contasAPagarEReceber(per.de, per.ate);
      if (!r.linhas.length) return ERP.app.aviso('Nada a exportar neste período.', 'erro');
      /* O saldo de partida vai como primeira LINHA, igual à planilha
         modelo: sem ele a coluna Saldo começa do nada. */
      const linhas = [{ tipo: 'Saldo', mov: 'Sim', documento: '', forma: '', contraparte: '',
        descricao: 'Saldo bancário em ' + U.fData(U.hoje()), competencia: '', emissao: '', vencimento: '',
        parcela: '', valor: null, saldo: r.saldo_banco }].concat(r.linhas);
      ERP.exportar.abrir({
        nome: 'contas-a-pagar-e-receber-' + per.de + '-a-' + per.ate,
        titulo: 'Contas a pagar e receber',
        colunas: COLS_PREVISTO, linhas: linhas,
        cabecalho: [['Relatório contas a pagar e a receber'], [periodo, '', 'Saldo bancário', r.saldo_banco]],
        rodape: [[], ['Entradas', r.total_entradas], ['Saídas', r.total_saidas], ['Saldo projetado', r.saldo_final]]
      });
      return;
    }
    const r = S.contasPagasERecebidas(per.de, per.ate, { banco: relBanco });
    if (!r.linhas.length) return ERP.app.aviso('Nada a exportar neste período.', 'erro');
    const conta = relBanco ? (D.banco(relBanco) || {}) : null;
    const emp = conta ? (D.empresaPor(conta.empresa) || {}) : null;
    ERP.exportar.abrir({
      nome: 'contas-pagas-e-recebidas-' +
        (conta ? U.slug(conta.apelido) + '-' : '') + per.de + '-a-' + per.ate,
      titulo: 'Contas pagas e recebidas' + (conta ? ' — ' + conta.apelido : ''),
      colunas: COLS_REALIZADO, linhas: r.linhas,
      cabecalho: [['Relatório contas pagas e recebidas' + (conta ? ' — ' + conta.apelido : '')],
        conta ? [periodo, '', 'Empresa', (emp.apelido || '') + ' · ' + (emp.cnpj || '')] : [periodo]],
      rodape: [[], ['Recebido', r.total_recebido], ['Pago', r.total_pago], ['Resultado do caixa', r.resultado]]
    });
  }

  /* 1. DRE por competência.

     Antes isto não era um DRE: começava no grupo 2 e terminava em
     "Total de saídas por competência" — sem receita, sem margem, sem
     resultado. Era um relatório de despesas com nome de demonstrativo,
     e quem lesse o rodapé achava que aquele total era o resultado do
     mês.

     Duas linhas também não pertenciam ao resultado e estavam dentro
     dele: retirada de sócio é distribuição de lucro, não despesa; e a
     parcela de empréstimo é, na maior parte, amortização de dívida —
     quem é despesa ali é o juro. Como o sistema não separa principal de
     juro dentro de 9.02, o grupo inteiro desceu para baixo da linha, e
     a tela pede que o juro seja lançado em 9.03 ou 9.04, onde ele conta
     como despesa financeira de verdade.

     A receita vem do contas a receber (só nota emitida, não previsão),
     pelo BRUTO, com a retenção como dedução — que é como o DRE se
     monta. */
  const FORA_DO_RESULTADO = ['9.02'];

  /* Resultado por CNPJ e o consolidado do grupo. O consolidado não é a
     soma: operação entre as próprias empresas é eliminada, senão
     receita e despesa aparecem infladas no mesmo valor. */
  function porEmpresa() {
    const a = S.apuracaoPorEmpresa({ de: per.de, ate: per.ate });
    const c = a.consolidado;
    const linha = e =>
      '<tr><td class="desc">' + U.esc(e.apelido) +
        '<div class="sub mono">' + U.esc(e.cnpj) + '</div></td>' +
      '<td class="num">' + U.brl(e.receita) + '</td>' +
      '<td class="num">' + U.brl(e.despesa) + '</td>' +
      '<td class="num ' + (e.resultado < 0 ? 'erro' : '') + '">' + U.brl(e.resultado) + '</td>' +
      '<td class="num">' + (e.margem === null ? '—' : U.pct(e.margem)) + '</td>' +
      '<td class="num sub">' + (e.intragrupo_receita || e.intragrupo_despesa
        ? U.brl(e.intragrupo_receita) + ' / ' + U.brl(e.intragrupo_despesa) : '—') + '</td></tr>';
    return '<table><thead><tr><th>Empresa</th><th class="num">Receita</th><th class="num">Despesa</th>' +
        '<th class="num">Resultado</th><th class="num">Margem</th>' +
        '<th class="num">Intragrupo (rec/desp)</th></tr></thead><tbody>' +
        a.empresas.map(linha).join('') +
        '<tr style="border-top:2px solid var(--ink)"><td class="desc"><b>Consolidado do grupo</b>' +
          '<div class="sub">sem as operações entre as empresas</div></td>' +
        '<td class="num"><b>' + U.brl(c.receita) + '</b>' +
          (c.eliminacao_receita ? '<div class="sub">bruto ' + U.brl(c.receita_bruta) + '</div>' : '') + '</td>' +
        '<td class="num"><b>' + U.brl(c.despesa) + '</b>' +
          (c.eliminacao_despesa ? '<div class="sub">bruto ' + U.brl(c.despesa_bruta) + '</div>' : '') + '</td>' +
        '<td class="num ' + (c.resultado < 0 ? 'erro' : '') + '"><b>' + U.brl(c.resultado) + '</b></td>' +
        '<td class="num"><b>' + (c.margem === null ? '—' : U.pct(c.margem)) + '</b></td>' +
        '<td class="num sub">' + (c.eliminacao_receita || c.eliminacao_despesa
          ? '−' + U.brl(c.eliminacao_receita) + ' / −' + U.brl(c.eliminacao_despesa) : '—') + '</td></tr>' +
      '</tbody></table>' +
      (a.conta_corrente.length
        ? '<h3 style="font-size:12px;margin:14px 0 4px">Conta corrente entre as empresas</h3>' +
          '<table><thead><tr><th>Devedora</th><th>Credora</th><th class="num">Valor</th>' +
          '<th class="num">Lançamentos</th></tr></thead><tbody>' +
          a.conta_corrente.map(function (x) {
            return '<tr><td>' + U.esc(x.devedora_nome) + '</td><td>' + U.esc(x.credora_nome) + '</td>' +
              '<td class="num">' + U.brl(x.valor) + '</td><td class="num sub">' + x.itens + '</td></tr>';
          }).join('') + '</tbody></table>' +
          '<div class="ajuda">Uma empresa pagou obrigação da outra (NF em nome de uma, paga pela conta ' +
            'da outra). Custo de projeto de uma empresa com NF em nome da outra é classificação e não ' +
            'aparece aqui.</div>'
        : '') +
      '<div class="ajuda">Receita pela empresa do projeto; despesa repartida pelo rateio, então conta ' +
        'dividida entre centros de empresas diferentes já se divide entre os CNPJs.</div>';
  }

  function dre() {
    const desp = {};      // cod -> {mes -> valor}
    const meses = new Set();

    /* Guia de retenção reúne NFs de naturezas diferentes num título só
       (pra bater com o pagamento único da prefeitura/Receita); a parcela
       traz a composição em contas_rateio e cada parte volta pra sua
       linha da DRE. */
    validas().forEach(p => {
      const partes = (p.contas_rateio && p.contas_rateio.length) ? p.contas_rateio : [{ conta: p.conta, valor: p.valor }];
      partes.forEach(pt => {
        const cod = pt.conta || '—';
        desp[cod] = desp[cod] || {};
        desp[cod][p.comp] = (desp[cod][p.comp] || 0) + pt.valor;
      });
      meses.add(p.comp);
    });
    // juros e multa entram na competência do pagamento
    S.todosPagamentos().forEach(pg => {
      const extra = pg.juros + pg.multa;
      if (extra <= 0) return;
      const m = U.compDe(pg.data);
      /* Também recortado: era daqui que vinham as colunas de meses
         fora do período pedido. */
      if (m < compIni() || m > compFim()) return;
      desp[D.contaJuros] = desp[D.contaJuros] || {};
      desp[D.contaJuros][m] = (desp[D.contaJuros][m] || 0) + extra;
      meses.add(m);
    });

    // receita: nota emitida, por competência, bruto e retido
    const rec = {}, ded = {};
    /* O recorte do período valia só para a despesa: a receita de
       TODOS os meses entrava, criando coluna e lucro fantasma nos
       meses de fora. E `fatura` (locação) e `avulso` são faturamento
       real tanto quanto a nota — ficavam fora do DRE enquanto
       apareciam no contas a receber, que é o relatório ao lado. */
    S.contasReceber().filter(function (r) {
      return ['nota', 'fatura', 'avulso'].indexOf(r.origem) > -1 && !r.conferir &&
        ['cancelado', 'substituido'].indexOf(r.status) < 0 &&
        (r.competencia || '') >= compIni() && (r.competencia || '') <= compFim();
    }).forEach(function (r) {
      const m = r.competencia;
      if (!m) return;
      rec[m] = (rec[m] || 0) + r.valor_bruto;
      ded[m] = (ded[m] || 0) + r.valor_retido;
      meses.add(m);
    });

    const cols = Array.from(meses).sort();
    if (!cols.length) return vazio('Nenhum lançamento para consolidar.');

    const soma = obj => cols.reduce((s2, m) => s2 + (obj[m] || 0), 0);
    const cel = (v, cls) => '<td class="num' + (cls ? ' ' + cls : '') + '">' +
      (v ? U.num(v) : '') + '</td>';
    const linhaTotal = (rot, obj, cls) => '<tr class="' + (cls || '') + '"><td>' + rot + '</td>' +
      cols.map(m => cel(obj[m] || 0, cls)).join('') + cel(soma(obj), cls) + '</tr>';

    /* soma por grupo do plano, devolvendo {mes -> valor} */
    function porGrupo(g) {
      const out = {};
      D.plano.filter(x => x.pai === g.cod && desp[x.cod]).forEach(f => {
        cols.forEach(m => { out[m] = (out[m] || 0) + (desp[f.cod][m] || 0); });
      });
      return out;
    }

    let html = '<table class="rel"><thead><tr><th>Conta</th>' +
      cols.map(m => '<th class="num">' + U.fComp(m) + '</th>').join('') +
      '<th class="num">Total</th></tr></thead><tbody>';

    // ── receita ──
    html += linhaTotal('Receita bruta de serviços', rec, 'g');
    html += linhaTotal('(−) Retenções na fonte', ded, '');

    /* IMPOSTOS PRÓPRIOS (grupo 2 do plano) entram aqui, como dedução
       da receita bruta. Antes o laço de despesas pulava `deducao` e o
       bloco "abaixo da linha" só recolhia não operacional — resultado:
       ISS, PIS/COFINS, IRPJ/CSLL e parcelamento tributário não
       apareciam em lugar nenhum do DRE, e o resultado operacional saía
       superestimado nesse valor.

       Não confundir com a linha acima: "retenções na fonte" é imposto
       que o TOMADOR retém da nossa nota; este é o que a empresa
       recolhe. */
    const gruposDeducao = D.plano.filter(g => g.nivel === 1 && g.tipo === 'deducao');
    const impostos = {};
    cols.forEach(m => { impostos[m] = 0; });
    gruposDeducao.forEach(g => {
      D.plano.filter(x => x.pai === g.cod && desp[x.cod]).forEach(f => {
        cols.forEach(m => { impostos[m] += (desp[f.cod][m] || 0); });
      });
    });
    if (cols.some(m => Math.abs(impostos[m]) > 0.004)) {
      gruposDeducao.forEach(g => {
        const filhos = D.plano.filter(x => x.pai === g.cod && desp[x.cod]);
        if (!filhos.length) return;
        const somaG = {};
        filhos.forEach(f => cols.forEach(m => { somaG[m] = (somaG[m] || 0) + (desp[f.cod][m] || 0); }));
        html += '<tr><td class="g">(−) ' + U.esc(g.cod + ' · ' + g.nome) + '</td>' +
          cols.map(m => cel(somaG[m], 'g')).join('') + cel(soma(somaG), 'g') + '</tr>';
        filhos.forEach(f => {
          html += '<tr><td style="padding-left:22px">' + U.esc(f.cod + ' ' + f.nome) + '</td>' +
            cols.map(m => cel(desp[f.cod][m])).join('') + cel(soma(desp[f.cod])) + '</tr>';
        });
      });
    }

    const liq = {};
    cols.forEach(m => { liq[m] = (rec[m] || 0) - (ded[m] || 0) - (impostos[m] || 0); });
    html += linhaTotal('= Receita líquida', liq, 'total');

    // ── custos e despesas, grupo a grupo ──
    const acumulado = {}; cols.forEach(m => { acumulado[m] = liq[m]; });
    let margem = null;

    D.plano.filter(g => g.nivel === 1).forEach(g => {
      if (g.tipo === 'receita' || g.tipo === 'deducao') return;
      const foraDoResultado = g.tipo === 'nao_operacional';
      const filhos = D.plano.filter(x => x.pai === g.cod && desp[x.cod])
        .filter(x => !foraDoResultado && FORA_DO_RESULTADO.indexOf(x.cod) < 0);
      if (!filhos.length) return;

      const somaG = {};
      filhos.forEach(f => cols.forEach(m => { somaG[m] = (somaG[m] || 0) + (desp[f.cod][m] || 0); }));
      html += '<tr><td class="g">(−) ' + U.esc(g.cod + ' · ' + g.nome) + '</td>' +
        cols.map(m => cel(somaG[m], 'g')).join('') + cel(soma(somaG), 'g') + '</tr>';
      filhos.forEach(f => {
        html += '<tr><td style="padding-left:22px">' + U.esc(f.cod + ' ' + f.nome) + '</td>' +
          cols.map(m => cel(desp[f.cod][m])).join('') + cel(soma(desp[f.cod])) + '</tr>';
      });
      cols.forEach(m => { acumulado[m] -= (somaG[m] || 0); });

      /* Referência de provisão de férias/13º — só pra despesas com
         pessoal (grupo 4), e só informativa: NÃO soma no total do
         grupo nem no resultado. É 1/12 avos por mês de cada
         funcionário ativo, pra mostrar o custo espalhado ao longo do
         ano — sem ela, um mês com férias ou 13º de fato pago mostra o
         custo inteiro de uma vez, e os outros meses mostram menos do
         que realmente custa manter a equipe. Os valores já pagos (nas
         linhas 4.05 e 4.06 acima) continuam sendo o que entra no
         resultado de verdade; isto aqui é só pra enxergar a
         distorção. */
      if (g.cod === '4') {
        const provDecimo = {}, provFerias = {};
        cols.forEach(function (m) {
          const p = S.provisaoMensalPessoal(m);
          provDecimo[m] = p.decimo; provFerias[m] = p.ferias;
        });
        html += '<tr><td style="padding-left:22px" class="sub">Referência — provisão de 13º (1/12 por mês, não soma no total)</td>' +
          cols.map(m => cel(provDecimo[m])).join('') + cel(soma(provDecimo)) + '</tr>';
        html += '<tr><td style="padding-left:22px" class="sub">Referência — provisão de férias + 1/3 (1/12 por mês, não soma no total)</td>' +
          cols.map(m => cel(provFerias[m])).join('') + cel(soma(provFerias)) + '</tr>';
      }

      // depois dos custos diretos, a margem de contribuição
      if (g.tipo === 'custo' && margem === null) {
        margem = {}; cols.forEach(m => { margem[m] = acumulado[m]; });
        html += linhaTotal('= Margem de contribuição', margem, 'total');
      }
    });

    html += linhaTotal('= Resultado operacional', acumulado, 'total');

    // ── abaixo da linha: o que não é resultado ──
    const fora = {};
    let temFora = false;
    D.plano.filter(x => x.nivel === 2).forEach(x => {
      const g = D.plano.find(y => y.cod === x.pai) || {};
      const conta = g.tipo === 'nao_operacional' || FORA_DO_RESULTADO.indexOf(x.cod) > -1;
      if (!conta || !desp[x.cod]) return;
      temFora = true;
      cols.forEach(m => { fora[m] = (fora[m] || 0) + (desp[x.cod][m] || 0); });
    });

    if (temFora) {
      html += '<tr><td class="g">Movimentações que não são resultado</td>' +
        cols.map(() => '<td class="num g"></td>').join('') + '<td class="num g"></td></tr>';
      D.plano.filter(x => x.nivel === 2).forEach(x => {
        const g = D.plano.find(y => y.cod === x.pai) || {};
        const conta = g.tipo === 'nao_operacional' || FORA_DO_RESULTADO.indexOf(x.cod) > -1;
        if (!conta || !desp[x.cod]) return;
        html += '<tr><td style="padding-left:22px">' + U.esc(x.cod + ' ' + x.nome) + '</td>' +
          cols.map(m => cel(desp[x.cod][m])).join('') + cel(soma(desp[x.cod])) + '</tr>';
      });
      const caixa = {}; cols.forEach(m => { caixa[m] = acumulado[m] - (fora[m] || 0); });
      html += linhaTotal('= Resultado depois de retiradas e amortização', caixa, 'total');
    }

    return html + '</tbody></table>' +
      '<div class="ajuda">Regime de competência: a despesa aparece no mês de referência do serviço, ' +
      'não na data do pagamento. Juros e multa de atraso entram na competência em que foram pagos. ' +
      'A receita sai das notas emitidas, pelo bruto, com a retenção como dedução.</div>' +
      (temFora
        ? '<div class="ajuda">Retirada de sócio é distribuição de lucro e a parcela de empréstimo é, ' +
          'em boa parte, amortização de dívida — nenhuma das duas é despesa, e por isso ficam abaixo ' +
          'da linha. O sistema não separa principal de juro dentro de 9.02: lance o juro em ' +
          '9.03 ou 9.04 para que ele conte como despesa financeira.</div>'
        : '');
  }

  /* 2. Total por centro de custo */
  function porCentro() {
    const acc = {};
    validas().forEach(p => {
      (p.rateio || []).forEach(function (rt) {
        const c = acc[rt.centro] = acc[rt.centro] || { total: 0, aberto: 0, pago: 0, n: 0 };
        const f = rt.pct / 100;
        c.total += Math.round(p.valor * rt.pct) / 100;
        c.aberto += (p.status === 'aberto' || p.status === 'parcial') ? Math.round(S.saldoDe(p) * rt.pct) / 100 : 0;
        c.pago += Math.round(S.caixaDe(p.id) * rt.pct) / 100;
        c.n++;
      });
    });
    const ids = Object.keys(acc);
    if (!ids.length) return vazio('Nenhum lançamento para consolidar.');

    const t = { total: 0, aberto: 0, pago: 0, n: 0 };
    let html = '<table class="rel"><thead><tr><th>Centro de custo</th><th>Tipo</th>' +
      '<th class="num">Parcelas</th><th class="num">Total (competência)</th>' +
      '<th class="num">Em aberto</th><th class="num">Pago</th></tr></thead><tbody>';
    ids.sort((a, b) => acc[b].total - acc[a].total).forEach(id => {
      const c = D.centro(id) || { nome: '—', tipo: '' }, v = acc[id];
      ['total', 'aberto', 'pago', 'n'].forEach(k => t[k] += v[k]);
      html += '<tr><td>' + U.esc(c.nome) + (c.ativo === false ? ' <span class="sub">(encerrado)</span>' : '') + '</td>' +
        '<td>' + U.esc(c.tipo) + '</td><td class="num">' + v.n + '</td>' +
        '<td class="num">' + U.num(v.total) + '</td><td class="num">' + U.num(v.aberto) + '</td>' +
        '<td class="num">' + U.num(v.pago) + '</td></tr>';
    });
    html += '<tr class="total"><td colspan="2">Total</td><td class="num">' + t.n + '</td>' +
      '<td class="num">' + U.num(t.total) + '</td><td class="num">' + U.num(t.aberto) + '</td>' +
      '<td class="num">' + U.num(t.pago) + '</td></tr></tbody></table>';
    return html;
  }

  /* 3. Fluxo de caixa: os dois lados e o saldo acumulado.
        Entradas vêm do contas a receber (recebido = realizado,
        previsão = previsto); saídas, do contas a pagar. Meses sem
        movimento aparecem, senão a série fica mentirosa. */
  function fluxo() {
    const ent = {}, entP = {}, sai = {}, saiP = {};
    const bota = (obj, mes, v) => { if (mes) obj[mes] = Math.round(((obj[mes] || 0) + v) * 100) / 100; };

    /* Recorte por DIA exato, não por mês inteiro: "de 10/09 a 05/10" era
       impossível antes, e o fluxo sempre abria a competência toda. Os
       meses das pontas entram só com o que cai dentro do período. */
    const dentro = d => !!d && d >= per.de && d <= per.ate;
    S.todosPagamentos().forEach(function (pg) {
      if (!dentro(pg.data)) return;
      bota(sai, U.compDe(pg.data), pg.valor + pg.juros + pg.multa);
    });
    /* Vencido em mês passado ainda não saiu do caixa.

       Jogar o previsto na competência do vencimento fazia 07 e 08/2026
       aparecerem com saída prevista já descontada do saldo acumulado —
       como se aquilo tivesse sido pago. O dinheiro vai sair, mas vai
       sair de hoje em diante. Então o que venceu e não foi pago é
       trazido para o mês corrente, marcado como atrasado. */
    const mesCorrente = U.mesAtual();
    const paraFrente = venc => {
      const m = U.compDe(venc);
      return (!m || m < mesCorrente) ? mesCorrente : m;
    };
    let atrasadoS = 0, atrasadoE = 0;

    /* Retenção de NF ainda sem guia fechada também vai sair do caixa —
       entra como saída prevista no mês seguinte ao da competência (é
       quando a guia vence). Antes só aparecia depois de alguém clicar
       "Fechar guia". */
    S.retencoesPendentes().forEach(function (rt) {
      const nf = S.todasParcelas().find(function (p) { return p.titulo_id === rt.titulo_id; });
      if (nf && nf.status === 'cancelado') return;
      const venc = U.compDe(U.addMeses(rt.competencia + '-01', 1)) + '-20';
      if (!dentro(venc) && !(venc < per.de && dentro(U.hoje()))) return;
      bota(saiP, paraFrente(venc), rt.valor);
    });
    S.todasParcelas().filter(function (p) { return p.status !== 'cancelado'; }).forEach(function (p) {
      if (['aberto', 'parcial', 'previsto', 'aguardando', 'autorizado', 'enviado'].indexOf(p.status) > -1) {
        /* Previsto é recortado pelo VENCIMENTO (quando o dinheiro sai),
           não pela competência — no fluxo é a data do caixa que manda.
           Vencido é trazido pra frente, então também conta se o mês
           corrente estiver dentro do período. */
        if (!dentro(p.venc) && !(p.venc < per.de && dentro(U.hoje()))) return;
        const m = paraFrente(p.venc);
        if (m !== U.compDe(p.venc)) atrasadoS += S.saldoDe(p);
        bota(saiP, m, S.saldoDe(p));
      }
    });
    S.contasReceber().forEach(function (r) {
      /* Recebido total OU parcial: o que já entrou vai pro realizado do
         mês em que entrou. O que falta — zero, se já quitou tudo —
         continua no previsto, só que pelo saldo, não pelo líquido
         inteiro. Antes, um recebimento parcial ficava fora do
         realizado (o dinheiro que já chegou não aparecia em lugar
         nenhum) e o previsto continuava com o valor cheio mesmo depois
         de parte já ter entrado. */
      const recebido = r.valor_recebido || 0;
      if (recebido > 0.004 && dentro(r.recebido_em)) bota(ent, U.compDe(r.recebido_em), recebido);
      if (r.status !== 'recebido' && S.receberAberto(r)) {
        const restante = S.saldoReceberDe(r);
        if (restante > 0.004 &&
            (dentro(r.vencimento) || (r.vencimento < per.de && dentro(U.hoje())))) {
          const m = paraFrente(r.vencimento);
          if (m !== U.compDe(r.vencimento)) atrasadoE += restante;
          bota(entP, m, restante);
        }
      }
    });

    /* Previsão estimada: o real SUBSTITUI a estimativa, não abate.
       Emitida a nota da competência, o faturamento é aquele — faturar
       menos que o previsto é faturamento abaixo do previsto, não saldo
       a faturar. Então a previsão só entra no fluxo enquanto não há
       realizado para aquele projeto e competência. O mesmo vale para o
       repasse: fechamento importado substitui a estimativa. */
    S.previsoes().forEach(function (pv) {
      if (!dentro(pv.data)) return;
      const res = S.residuoPrevisao(pv);
      if (res.faturamento) bota(entP, U.compDe(pv.data), res.faturamento);
      if (res.produtividade) bota(saiP, U.compDe(pv.data), res.produtividade);
    });
    S.previsoesDespesa().forEach(function (pv) {
      if (!dentro(pv.data)) return;
      const res = S.residuoDespesa(pv);
      if (res) bota(saiP, U.compDe(pv.data), res);
    });

    const meses = Object.keys(ent).concat(Object.keys(entP), Object.keys(sai), Object.keys(saiP))
      .filter(function (m) { return m; });
    if (!meses.length) return vazio('Sem movimento previsto nem realizado.');

    // preenche os meses vazios entre o primeiro e o último
    const ord = meses.sort();
    const serie = [];
    let cur = ord[0], fim = ord[ord.length - 1];
    while (cur <= fim && serie.length < 60) {
      serie.push(cur);
      const p = cur.split('-');
      const d = new Date(Date.UTC(+p[0], +p[1], 1));
      cur = d.toISOString().slice(0, 7);
    }

    const inicial = S.saldoInicial();
    let saldo = inicial;
    let te = 0, tep = 0, ts = 0, tsp = 0;

    let html = '<div class="ajuda" style="margin-bottom:8px">Saldo inicial de ' + U.brl(inicial) +
      (S.saldoInicialEm() ? ' em ' + U.fData(S.saldoInicialEm()) : '') +
      ', somando as contas bancárias cadastradas.</div>' +
      (atrasadoS || atrasadoE
        ? '<div class="ajuda">O que venceu e não foi pago ou recebido entra em ' + U.fComp(mesCorrente) +
          ', não no mês do vencimento — o dinheiro só sai (ou entra) de hoje em diante. ' +
          (atrasadoS ? 'Saídas atrasadas: ' + U.brl(atrasadoS) + '. ' : '') +
          (atrasadoE ? 'Entradas atrasadas: ' + U.brl(atrasadoE) + '.' : '') + '</div>'
        : '') +
      '<table class="rel"><thead><tr><th>Mês</th>' +
      '<th class="num">Entradas realizadas</th><th class="num">Entradas previstas</th>' +
      '<th class="num">Saídas realizadas</th><th class="num">Saídas previstas</th>' +
      '<th class="num">Resultado do mês</th><th class="num">Saldo acumulado</th></tr></thead><tbody>';

    /* corta a cauda de meses vazios no fim: linha de 0,00 até 2027 não
       informa nada e esconde o que interessa */
    while (serie.length > 1) {
      const m = serie[serie.length - 1];
      if ((ent[m] || 0) || (entP[m] || 0) || (sai[m] || 0) || (saiP[m] || 0)) break;
      serie.pop();
    }

    serie.forEach(function (m) {
      const e = ent[m] || 0, ep = entP[m] || 0, s = sai[m] || 0, sp = saiP[m] || 0;
      const res = Math.round((e + ep - s - sp) * 100) / 100;
      saldo = Math.round((saldo + res) * 100) / 100;
      te += e; tep += ep; ts += s; tsp += sp;
      html += '<tr><td class="mono">' + U.fComp(m) + '</td>' +
        '<td class="num">' + (e ? U.num(e) : '') + '</td>' +
        '<td class="num">' + (ep ? U.num(ep) : '') + '</td>' +
        '<td class="num">' + (s ? U.num(s) : '') + '</td>' +
        '<td class="num">' + (sp ? U.num(sp) : '') + '</td>' +
        '<td class="num"' + (res < 0 ? ' style="color:var(--red);font-weight:650"' : '') + '>' +
          U.num(res) + '</td>' +
        '<td class="num"' + (saldo < 0 ? ' style="color:var(--red);font-weight:700"' : '') + '>' + U.num(saldo) + '</td></tr>';
    });

    html += '<tr class="total"><td>Total</td>' +
      '<td class="num">' + U.num(te) + '</td><td class="num">' + U.num(tep) + '</td>' +
      '<td class="num">' + U.num(ts) + '</td><td class="num">' + U.num(tsp) + '</td>' +
      '<td class="num">' + U.num(te + tep - ts - tsp) + '</td>' +
      '<td class="num">' + U.num(saldo) + '</td></tr></tbody></table>' +
      '<div class="ajuda">Realizado é o que passou pelo banco: pagamento liquidado e recebimento baixado. ' +
      'Previsto usa o vencimento do que está em aberto e a previsão de recebimento de cada projeto. ' +
      'Saldo negativo aparece em vermelho — é a data em que o caixa fura.</div>';
    return html;
  }

  /* 4. Resultado por projeto: agora com os dois lados. */
  function projeto() {
    const acc = {};
    const pega = id => (acc[id] = acc[id] || { faturado: 0, retido: 0, direto: 0, indireto: 0, recebido: 0, depreciacao: 0 });

    /* Depreciação do equipamento alocado entra como custo do projeto,
       mês a mês: capital imobilizado num contrato custa àquele
       contrato, mesmo sem nota no mês. Sem isso, locação e projeto
       remunerado por laudo aparecem com margem que não têm. */
    let comp = compIni();
    while (comp <= compFim()) {
      S.depreciacaoPorProjeto(comp).forEach(function (d) { pega(d.centro).depreciacao += d.valor; });
      comp = U.compDe(U.addMeses(comp + '-01', 1));
    }

    validas().forEach(function (p) {
      const partes = (p.contas_rateio && p.contas_rateio.length) ? p.contas_rateio : [{ conta: p.conta, valor: p.valor }];
      partes.forEach(function (pt) {
        const tipo = D.tipoDre(pt.conta);
        (p.rateio || []).forEach(function (rt) {
          const c = D.centro(rt.centro);
          if (!c || c.tipo !== 'projeto') return;
          const v = Math.round(pt.valor * rt.pct) / 100;
          if (tipo === 'custo') pega(rt.centro).direto += v;
          else pega(rt.centro).indireto += v;
        });
      });
    });
    S.contasReceber().forEach(function (r) {
      const c = D.centro(r.centro);
      if (!c || c.tipo !== 'projeto') return;
      const a = pega(r.centro);
      a.faturado += r.valor_bruto;
      a.retido += r.valor_retido;
      a.recebido += (r.valor_recebido || 0);
    });

    /* O imposto de cada projeto, pela regra do imposto efetivo. O
       custo direto recebe o EXCEDENTE da retenção: quando o cliente
       retém acima da alíquota devida, a diferença não volta e pesa
       no resultado daquele contrato. */
    Object.keys(acc).forEach(function (id) {
      const v = acc[id];
      const i = S.impostoSobreFaturamento(id, v.faturado, v.retido || 0);
      v.imposto = i.imposto_efetivo;
      v.excedente = i.excedente;
      v.imposto_obs = i.obs;
      if (i.excedente > 0) v.direto += i.excedente;
    });

    const ids = Object.keys(acc);
    if (!ids.length) return vazio('Nenhum projeto com movimento.');

    const t = { faturado: 0, retido: 0, imposto: 0, excedente: 0,
      direto: 0, indireto: 0, recebido: 0, depreciacao: 0 };
    let html = '<table class="rel"><thead><tr><th>Projeto</th><th class="num">Faturado</th>' +
      /* "Retido" respondia a pergunta errada: o que sai do caixa é o
         imposto devido, e a retenção é só a forma de pagamento. O
         total a recolher é o mesmo com ou sem retenção — e quando o
         cliente retém mais que o devido, o excedente é custo do
         projeto. */
      '<th class="num" title="Imposto devido sobre o faturamento, retido ou por guia">' +
      'Imposto s/ faturamento</th>' +
      '<th class="num">Custos diretos</th><th class="num">Outras despesas</th>' +
      '<th class="num">Depreciação</th>' +
      '<th class="num">Resultado</th><th class="num">Margem de contribuição</th>' +
      '<th class="num">Recebido</th></tr></thead><tbody>';

    ids.sort(function (a, b) { return acc[b].faturado - acc[a].faturado; }).forEach(function (id) {
      const c = D.centro(id) || {}, v = acc[id];
      Object.keys(t).forEach(function (k) { t[k] += v[k]; });
      /* Depreciação entra no resultado como custo não-caixa: é o que
         faz um projeto de locação (ou de exame por laudo) mostrar a
         margem real, com o equipamento se pagando ao longo da vida
         útil. */
      v.depreciacao = Math.round(v.depreciacao * 100) / 100;
      const res = Math.round((v.faturado - v.direto - v.indireto - v.depreciacao) * 100) / 100;
      /* Margem de 100% não é margem boa: é projeto sem custo lançado.
         Dizer "100%" em treze de quinze projetos transforma o relatório
         num gerador de números falsos. E o que a conta mede é margem de
         CONTRIBUIÇÃO direta — não tem rateio de estrutura. */
      const semCusto = !v.direto && !v.indireto && !v.depreciacao;
      const margem = (v.faturado && !semCusto) ? Math.round(res / v.faturado * 1000) / 10 : null;
      html += '<tr><td>' + U.esc(c.curto || c.nome) + '</td>' +
        '<td class="num">' + (v.faturado ? U.num(v.faturado) : '—') + '</td>' +
        '<td class="num"' + (v.imposto_obs ? ' title="' + U.esc(v.imposto_obs) + '"' : '') + '>' +
          (v.imposto ? U.num(v.imposto) : '—') +
          (v.excedente ? '<div class="sub" style="color:var(--red)">retenção ' +
            U.num(v.excedente) + ' acima</div>' : '') + '</td>' +
        '<td class="num">' + (v.direto ? U.num(v.direto) : '—') + '</td>' +
        '<td class="num">' + (v.indireto ? U.num(v.indireto) : '—') + '</td>' +
        '<td class="num sub">' + (v.depreciacao ? U.num(v.depreciacao) : '—') + '</td>' +
        '<td class="num"' + (res < 0 ? ' style="color:var(--red);font-weight:650"' : '') + '>' +
          U.num(res) + '</td>' +
        '<td class="num"' + (margem !== null && margem < 0 ? ' style="color:var(--red);font-weight:650"' : '') + '>' +
          (semCusto ? '<span class="sub">sem custo lançado</span>'
            : margem === null ? '—' : U.num(margem) + '%') + '</td>' +
        '<td class="num">' + (v.recebido ? U.num(v.recebido) : '—') + '</td></tr>';
    });

    const resT = Math.round((t.faturado - t.direto - t.indireto - t.depreciacao) * 100) / 100;
    html += '<tr class="total"><td>Total</td>' +
      '<td class="num">' + U.num(t.faturado) + '</td><td class="num">' + U.num(t.imposto) + '</td>' +
      '<td class="num">' + U.num(t.direto) + '</td><td class="num">' + U.num(t.indireto) + '</td>' +
      '<td class="num">' + U.num(t.depreciacao) + '</td>' +
      '<td class="num">' + U.num(resT) + '</td>' +
      '<td class="num">' + (t.faturado ? U.num(Math.round(resT / t.faturado * 1000) / 10) + '%' : '—') + '</td>' +
      '<td class="num">' + U.num(t.recebido) + '</td></tr></tbody></table>' +
      '<div class="ajuda">Faturado é o bruto da nota. <b>Imposto sobre faturamento</b> é o que a empresa recolhe sobre ele — o mesmo valor com ou sem retenção na fonte, porque a retenção é forma de pagamento, não desconto. Quando o cliente retém <b>acima</b> da alíquota devida, o excedente não volta: ele entra nos custos diretos do projeto e aparece marcado na coluna. Margem de contribuição é direta, sem rateio de estrutura.</div>';
    return html;
  }

  const vazio = t => '<div class="vazio"><strong>' + t + '</strong>Lance algo na aba Contas a pagar.</div>';

  /* 5. Custos de produtividade por projeto, setor e tipo — pago e a
     pagar. Três filtros em cascata: projeto sempre, setor opcional
     (some os tipos que não existem ali), tipo só depois de escolher o
     setor. Com setor e tipo escolhidos, em vez de um número só, mostra
     as parcelas por trás dele — é o que faz o relatório servir pra
     conferir, não só pra somar. */
  let filtroST = { centro: '', setor: '', tipo: '' };

  function porSetorTipo() {
    const projetos = D.centros.filter(function (c) { return c.tipo === 'projeto' && c.produtividade; })
      .sort(function (a, b) { return (a.curto || a.nome).localeCompare(b.curto || b.nome, 'pt-BR'); });
    if (!projetos.length) return vazio('Nenhum projeto com produtividade cadastrado.');
    /* A lista traz as UNIDADES (projeto mãe) antes dos projetos: quem
       quer "tudo da AGIR" não precisa mais escolher setor por setor. */
    const unidades = S.unidadesComProdutividade();
    const valido = filtroST.centro &&
      (projetos.some(function (c) { return c.id === filtroST.centro; }) || unidades.indexOf(filtroST.centro) > -1);
    if (!valido) filtroST.centro = unidades.length ? unidades[0] : projetos[0].id;
    const opcoesProjeto =
      (unidades.length ? '<optgroup label="Unidade inteira (todos os projetos)">' + unidades.map(function (un) {
        return '<option value="' + U.esc(un) + '"' + (filtroST.centro === un ? ' selected' : '') + '>' +
          U.esc(un) + ' — todos</option>';
      }).join('') + '</optgroup>' : '') +
      '<optgroup label="Projeto">' + projetos.map(function (c) {
        return '<option value="' + c.id + '"' + (filtroST.centro === c.id ? ' selected' : '') + '>' +
          U.esc(c.curto || c.nome) + '</option>';
      }).join('') + '</optgroup>';

    const setores = S.setoresTiposDe(filtroST.centro);
    if (filtroST.setor && !setores.some(function (s) { return s.setor === filtroST.setor; })) filtroST.setor = '';
    const opcoesSetor = '<option value="">todos os setores</option>' + setores.map(function (s) {
      return '<option value="' + U.esc(s.setor) + '"' + (filtroST.setor === s.setor ? ' selected' : '') + '>' +
        U.esc(s.setor) + '</option>';
    }).join('');

    const setorAtual = setores.find(function (s) { return s.setor === filtroST.setor; });
    const tiposDisp = setorAtual ? setorAtual.tipos : [];
    if (filtroST.tipo && tiposDisp.indexOf(filtroST.tipo) === -1) filtroST.tipo = '';
    const opcoesTipo = '<option value="">todos os tipos</option>' + tiposDisp.map(function (t) {
      return '<option value="' + U.esc(t) + '"' + (filtroST.tipo === t ? ' selected' : '') + '>' + U.esc(t) + '</option>';
    }).join('');

    const filtros = '<div class="row3" style="margin-bottom:12px">' +
      '<div><label>Projeto ou unidade</label><select id="st-projeto">' + opcoesProjeto + '</select></div>' +
      '<div><label>Setor</label><select id="st-setor">' + opcoesSetor + '</select></div>' +
      '<div><label>Tipo</label><select id="st-tipo"' + (!filtroST.setor ? ' disabled' : '') + '>' + opcoesTipo + '</select></div>' +
    '</div>';

    const r = S.custosPorSetorTipo(filtroST.centro, filtroST.setor, filtroST.tipo, per.de, per.ate);
    const chaves = Object.keys(r.grupos).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    if (!chaves.length) return filtros + vazio('Nenhum lançamento de produtividade para esse filtro.');

    let html = filtros;
    if (filtroST.setor && filtroST.tipo) {
      const totalPago = Math.round(r.detalhe.reduce(function (s, d) { return s + (d.status === 'pago' ? d.valor : 0); }, 0) * 100) / 100;
      const totalAberto = Math.round(r.detalhe.reduce(function (s, d) { return s + (d.status !== 'pago' ? d.valor : 0); }, 0) * 100) / 100;
      html += '<div class="pr-confere" style="margin-bottom:10px">' +
        '<span>Pago <b>' + U.brl(totalPago) + '</b></span>' +
        '<span>A pagar <b>' + U.brl(totalAberto) + '</b></span>' +
        '<span>Total <b>' + U.brl(Math.round((totalPago + totalAberto) * 100) / 100) + '</b></span></div>' +
        '<table class="rel"><thead><tr><th>Médico</th><th>Competência</th><th>Situação</th>' +
        '<th class="num">Valor</th><th>Vencimento</th><th>Baixa</th></tr></thead><tbody>' +
        r.detalhe.sort(function (a, b) { return (a.competencia || '').localeCompare(b.competencia || ''); })
          .map(function (d) {
            return '<tr><td class="desc">' + U.esc(d.credor) + '</td><td class="mono">' + U.fComp(d.competencia) + '</td>' +
              '<td><span class="badge b-' + d.status + '">' + U.esc(d.status) + '</span></td>' +
              '<td class="num">' + U.brl(d.valor) + '</td>' +
              '<td class="mono">' + U.fData(d.venc) + '</td>' +
              '<td class="mono">' + (d.pago_em ? U.fData(d.pago_em) : '—') + '</td></tr>';
          }).join('') + '</tbody></table>';
    } else {
      const rotulo = filtroST.setor ? 'Tipo' : 'Setor';
      let tPago = 0, tAberto = 0;
      html += '<table class="rel"><thead><tr><th>' + rotulo + '</th><th class="num">Pago</th>' +
        '<th class="num">A pagar</th><th class="num">Total</th></tr></thead><tbody>' +
        chaves.map(function (k) {
          const g = r.grupos[k];
          tPago = Math.round((tPago + g.pago) * 100) / 100;
          tAberto = Math.round((tAberto + g.aberto) * 100) / 100;
          return '<tr><td>' + U.esc(k) + '</td><td class="num">' + U.brl(g.pago) + '</td>' +
            '<td class="num">' + U.brl(g.aberto) + '</td>' +
            '<td class="num">' + U.brl(Math.round((g.pago + g.aberto) * 100) / 100) + '</td></tr>';
        }).join('') +
        '<tr class="total"><td>Total</td><td class="num">' + U.brl(tPago) + '</td>' +
        '<td class="num">' + U.brl(tAberto) + '</td>' +
        '<td class="num">' + U.brl(Math.round((tPago + tAberto) * 100) / 100) + '</td></tr></tbody></table>' +
        '<div class="ajuda">' + (filtroST.setor ? 'Escolha um tipo acima pra ver as parcelas por trás do número.'
          : 'Escolha um setor acima pra abrir por tipo.') + '</div>';
    }
    return html;
  }

  function ligarFiltrosSetorTipo() {
    if (U.el('st-projeto')) U.el('st-projeto').addEventListener('change', function () {
      filtroST = { centro: this.value, setor: '', tipo: '' };
      render();
    });
    if (U.el('st-setor')) U.el('st-setor').addEventListener('change', function () {
      filtroST.setor = this.value; filtroST.tipo = '';
      render();
    });
    if (U.el('st-tipo')) U.el('st-tipo').addEventListener('change', function () {
      filtroST.tipo = this.value;
      render();
    });
  }

  return { montar, render };
})();
