/* ERP · ui-cadastros.js — módulo de Cadastros.
   Projetos (a linha de contrato, com impostos, retenção e previsão) e
   clientes. É daqui que sai o projeto de cada nota, o prazo de
   recebimento, a retenção e a estimativa mensal. */
window.ERP = window.ERP || {};

ERP.cadastros = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;
  let aba = 'estrutura';
  let sel = new Set();
  let verInativos = false;
  let soPendentes = false;   // filtro: só credores sem dados de pagamento completos
  const TRIB = ['ISS', 'IRRF', 'PIS', 'COFINS', 'CSLL', 'INSS'];
  const IMP = [['iss', 'ISS'], ['iss_ce', 'ISS CE'], ['pis_cofins', 'PIS/COFINS'], ['irpj', 'IRPJ'], ['csll', 'CSLL']];

  /* O menu é agrupado por assunto e fica todo visível: quem cadastra
     um armazém costuma cadastrar projeto e produto na mesma sentada. */
  const GRUPOS = [
    { titulo: 'Estrutura da empresa', itens: [
      { id: 'estrutura', nome: 'Matriz e filiais', req: 'lancar', conta: function () {
          return D.centros.filter(function (c) { return c.tipo !== 'projeto'; }).length; } },
      { id: 'projetos', nome: 'Projetos', req: 'lancar', conta: function () {
          return D.centros.filter(function (c) { return c.tipo === 'projeto' && c.ativo; }).length; } },
      { id: 'armazens', nome: 'Armazéns', req: 'estoque', conta: function () {
          return D.armazens.filter(function (a) { return a.ativo; }).length; } }
    ] },
    { titulo: 'Receita', itens: [
      { id: 'clientes', nome: 'Clientes', req: 'faturar', conta: function () { return D.clientes.length; } },
      { id: 'atestados', nome: 'Atestados', req: 'faturar', conta: function () {
          return S.atestadosPendentes().length; } }
    ] },
    { titulo: 'Compras e estoque', itens: [
      { id: 'produtos', nome: 'Produtos', req: 'estoque', conta: function () {
          return D.produtos.filter(function (p) { return p.ativo; }).length; } },
      { id: 'fornecedores', nome: 'Fornecedores', req: 'comprar', conta: function () {
          return D.credores.filter(function (c) { return c.tipo !== 'medico' && c.ativo !== false; }).length; } }
    ] },
    { titulo: 'Equipe médica', itens: [
      { id: 'medicos', nome: 'Médicos', req: 'lancar', conta: function () {
          return D.credores.filter(function (c) { return c.tipo === 'medico' && c.ativo !== false; }).length; } }
    ] }
  ];

  function montar() { /* o menu é desenhado no render */ }

  function menu() {
    // o menu mostra só o que o perfil pode abrir
    const visiveis = GRUPOS.map(function (g) {
      return { titulo: g.titulo, itens: g.itens.filter(function (i) {
        return !i.req || S.pode(i.req) || S.pode('admin'); }) };
    }).filter(function (g) { return g.itens.length; });
    const todas = [].concat.apply([], visiveis.map(function (g) { return g.itens; }));
    if (!todas.some(function (i) { return i.id === aba; })) aba = todas.length ? todas[0].id : 'estrutura';

    U.el('cad-nav').innerHTML = visiveis.map(function (g) {
      return '<div class="grupo">' + U.esc(g.titulo) + '</div>' +
        g.itens.map(function (i) {
          return '<button data-cad="' + i.id + '" aria-pressed="' + (i.id === aba) + '">' +
            U.esc(i.nome) + '<span class="qtd">' + i.conta() + '</span></button>';
        }).join('');
    }).join('');
    U.el('cad-nav').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { aba = this.dataset.cad; sel.clear(); render(); });
    });
  }

  function render() {
    menu();
    U.el('cad-saida').innerHTML =
      aba === 'estrutura'    ? estrutura() :
      aba === 'projetos'     ? projetos() :
      aba === 'clientes'     ? clientes() :
      aba === 'atestados'    ? atestados() :
      aba === 'fornecedores' ? credores('fornecedor') :
      aba === 'produtos'     ? produtos() :
      aba === 'armazens'     ? armazens() :
                               credores('medico');
    ligar();
  }

  const pct = v => (v || v === 0) ? U.num(v) + '%' : '—';

  /* ── atestados de capacidade técnica ────────────────────
     Atestado é o que sustenta a habilitação técnica em licitação, e o
     hospital demora a emitir. A tela avisa de quem já passou do prazo
     (6 meses por padrão, ajustável por cliente) e monta o histórico do
     período pra anexar ao pedido — é o que o hospital precisa receber
     pra conseguir escrever o documento. */
  function atestados() {
    const pend = S.atestadosPendentes();
    const comProjeto = D.clientes.filter(function (c) { return D.projetosDoCliente(c.id).length; });
    const pendIds = {};
    pend.forEach(function (p) { pendIds[p.cliente.id] = p; });
    const linha = function (cli) {
      const p = pendIds[cli.id];
      const ult = S.atestadosDoCliente(cli.id)[0];
      const pres = S.prestacaoDoCliente(cli.id);
      const meses = cli.atestado_periodicidade || 6;
      return '<tr' + (p ? ' style="background:#fff4f2"' : '') + '>' +
        '<td class="desc">' + U.esc(cli.nome) +
          '<div class="sub">' + D.projetosDoCliente(cli.id).map(function (x) { return U.esc(x.curto); }).join(' · ') + '</div></td>' +
        '<td class="mono">' + (cli.atestado_em ? U.fData(cli.atestado_em) : '—') +
          (ult && ult.numero ? '<div class="sub">' + U.esc(ult.numero) + '</div>' : '') + '</td>' +
        '<td class="sub">a cada ' + meses + ' meses</td>' +
        '<td>' + (p
          ? '<span class="badge b-vencido">' + (p.nunca ? 'nunca pedido' : 'vencido há ' + p.dias + ' dias') + '</span>' +
            (p.solicitado_em ? '<div class="sub">pedido em ' + U.fData(p.solicitado_em) + ' — aguardando</div>' : '')
          : (cli.atestado_dispensado ? '<span class="sub">dispensado</span>'
            : pres.comps.length ? '<span class="badge b-pago">em dia</span>' : '<span class="sub">sem prestação</span>')) + '</td>' +
        '<td class="sub">' + (pres.comps.length
          ? pres.comps.length + ' competência(s) · até ' + U.fComp(pres.comps[pres.comps.length - 1]) : '—') + '</td>' +
        '<td class="acoes">' +
          '<button class="btn-sm btn-aprovar" data-at-hist="' + cli.id + '">Histórico para o atestado</button> ' +
          '<button class="btn-sm" data-at-reg="' + cli.id + '">Registrar</button></td></tr>';
    };
    return '<h2>Atestados de capacidade técnica' +
        '<span class="sub">um pedido a cada ' + 6 + ' meses por cliente, com o histórico do período</span></h2>' +
      '<div class="pr-confere">' +
        '<span>Clientes com prestação <b>' + comProjeto.length + '</b></span>' +
        '<span>A atualizar <b class="' + (pend.length ? 'erro' : '') + '">' + pend.length + '</b></span>' +
      '</div>' +
      '<div class="ajuda">O alerta nasce quando há prestação registrada (medição, fechamento ou nota) e o ' +
        'último atestado passou do prazo. Registrar o atestado recebido reinicia a contagem.</div>' +
      '<table><thead><tr><th>Cliente</th><th>Último atestado</th><th>Periodicidade</th><th>Situação</th>' +
        '<th>Prestação registrada</th><th></th></tr></thead><tbody>' +
        (comProjeto.length ? comProjeto.map(linha).join('')
          : '<tr><td colspan="6" class="vazio"><strong>Nenhum cliente com projeto ligado.</strong></td></tr>') +
      '</tbody></table>';
  }

  /* Histórico do período: o que foi prestado, em que meses e quanto —
     o conteúdo do pedido. Sai em Excel, PDF ou CSV pra anexar. */
  function historicoAtestado(clienteId) {
    const cli = D.clientes.find(function (x) { return x.id === clienteId; });
    const ultimo = cli.atestado_em;
    const de = ultimo || '';
    ERP.app.modal({
      titulo: 'Histórico para o atestado · ' + U.esc(cli.nome),
      fecharTxt: 'Fechar',
      corpo: '<div class="filtros">' +
          '<div class="f"><label for="at-de">De</label><input type="date" id="at-de" value="' + de + '"></div>' +
          '<div class="f"><label for="at-ate">Até</label><input type="date" id="at-ate" value="' + U.hoje() + '"></div>' +
          '<button class="btn-sm" id="at-tudo" style="align-self:flex-end">Desde o início</button>' +
        '</div>' +
        (ultimo ? '<div class="ajuda">O período começa no último atestado (' + U.fData(ultimo) + '). ' +
          'É o que o hospital costuma pedir: o que foi prestado desde então.</div>' : '') +
        '<div id="at-saida"></div>',
      acoes: [{ txt: 'Exportar', cls: 'btn-aprovar', fn: function () { exportarHistorico(clienteId); } }],
      aoAbrir: function () {
        const desenhar = function () {
          const h = S.historicoAtestado(clienteId, U.val('at-de'), U.val('at-ate'));
          if (h.erro) { U.el('at-saida').innerHTML = '<div class="ajuda erro">' + U.esc(h.erro) + '</div>'; return; }
          U.el('at-saida').innerHTML = !h.linhas.length
            ? '<div class="vazio"><strong>Nenhuma prestação no período.</strong></div>'
            : '<div class="pr-confere">' +
                '<span>Período com prestação <b>' + U.fComp(h.primeira) + ' a ' + U.fComp(h.ultima) + '</b></span>' +
                '<span>Competências <b>' + h.competencias.length + '</b></span>' +
                (h.total_faturado ? '<span>Faturado <b>' + U.brl(h.total_faturado) + '</b></span>' : '') +
                (h.total_producao ? '<span>Produção médica <b>' + U.brl(h.total_producao) + '</b></span>' : '') +
              '</div>' +
              '<table class="parcelas"><thead><tr><th>Projeto / serviço</th><th>Período</th>' +
                '<th class="num">Meses</th><th class="num">Médicos</th><th class="num">Faturado</th>' +
                '<th>Contrato</th></tr></thead><tbody>' +
                h.linhas.map(function (l) {
                  return '<tr><td class="desc">' + U.esc(l.projeto.curto) +
                      (l.servico ? '<div class="sub">' + U.esc(l.servico) + '</div>' : '') + '</td>' +
                    '<td class="mono">' + U.fComp(l.de) + ' a ' + U.fComp(l.ate) + '</td>' +
                    '<td class="num">' + l.meses + '</td>' +
                    '<td class="num">' + (l.medicos || '—') + '</td>' +
                    '<td class="num">' + U.brl(l.faturado || l.producao) + '</td>' +
                    '<td class="sub">' + (l.contrato ? U.esc(l.contrato.numero) : '—') + '</td></tr>';
                }).join('') + '</tbody></table>' +
              '<div class="ajuda">Faturado é o que saiu em NF/fatura; sem nota no período, a coluna mostra o ' +
                'valor da produção médica medida. Leve este resumo junto do pedido.</div>';
        };
        /* `ligarData` em vez de `change` cru: digitar a data inteira
           disparava o redesenho no meio e congelava o ano. */
        ['at-de', 'at-ate'].forEach(function (id) { U.ligarData(id, desenhar); });
        U.el('at-tudo').addEventListener('click', function () { U.setVal('at-de', ''); desenhar(); });
        desenhar();
      }
    });
  }

  function exportarHistorico(clienteId) {
    const h = S.historicoAtestado(clienteId, U.val('at-de'), U.val('at-ate'));
    if (h.erro) return ERP.app.aviso(h.erro, 'erro');
    if (!h.linhas.length) return ERP.app.aviso('Nada a exportar no período.', 'erro');
    ERP.exportar.abrir({
      nome: 'historico-atestado-' + (h.cliente.nome || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40),
      titulo: 'Histórico para atestado',
      cabecalho: [['Histórico de prestação de serviços'], [h.cliente.nome],
        ['Período: ' + U.fComp(h.primeira) + ' a ' + U.fComp(h.ultima)],
        ['CNPJ do contratante', h.cliente.documento ? U.cnpj(h.cliente.documento) : '']],
      rodape: [[], ['Total faturado', h.total_faturado], ['Produção médica medida', h.total_producao],
        ['Notas emitidas', h.total_notas]],
      colunas: [
        { titulo: 'Projeto', largura: 30, valor: l => l.projeto.curto || l.projeto.nome },
        { titulo: 'Unidade', largura: 26, valor: l => l.projeto.unidade || '' },
        { titulo: 'Serviço', largura: 22, valor: l => l.servico },
        { titulo: 'Contrato', largura: 16, valor: l => l.contrato ? l.contrato.numero : '' },
        { titulo: 'Objeto do contrato', largura: 40, valor: l => l.contrato ? (l.contrato.objeto || '') : '' },
        { titulo: 'De', largura: 10, valor: l => U.fComp(l.de) },
        { titulo: 'Até', largura: 10, valor: l => U.fComp(l.ate) },
        { titulo: 'Meses', largura: 8, tipo: 'numero', valor: l => l.meses },
        { titulo: 'Médicos', largura: 9, tipo: 'numero', valor: l => l.medicos },
        { titulo: 'Notas', largura: 8, tipo: 'numero', valor: l => l.notas },
        { titulo: 'Faturado', largura: 14, tipo: 'numero', valor: l => l.faturado },
        { titulo: 'Produção medida', largura: 16, tipo: 'numero', valor: l => l.producao }
      ],
      linhas: h.linhas
    });
  }

  function registrarAtestado(clienteId) {
    const cli = D.clientes.find(function (x) { return x.id === clienteId; });
    const hist = S.atestadosDoCliente(clienteId);
    ERP.app.modal({
      titulo: 'Atestado · ' + U.esc(cli.nome),
      fecharTxt: 'Fechar',
      corpo: '<div class="row2">' +
          '<div><label>Situação</label><select id="at-sit">' +
            '<option value="recebido">Atestado recebido</option>' +
            '<option value="solicitado">Pedido feito, aguardando</option></select></div>' +
          '<div><label>Data</label><input type="date" id="at-data" value="' + U.hoje() + '"></div>' +
        '</div>' +
        '<div class="row3">' +
          '<div><label>Número / referência</label><input id="at-num"></div>' +
          '<div><label>Período atestado (de)</label><input type="month" id="at-pde"></div>' +
          '<div><label>(até)</label><input type="month" id="at-pate"></div>' +
        '</div>' +
        '<div class="row2">' +
          '<div><label>Pedir a cada (meses)</label><input class="num" id="at-per" inputmode="numeric" value="' +
            (cli.atestado_periodicidade || 6) + '"></div>' +
          '<div><label>Arquivo do atestado</label>' +
            '<input type="file" id="at-arq" accept=".pdf,.jpg,.jpeg,.png" style="border:none;padding:0"></div>' +
        '</div>' +
        '<label>Observação</label><input id="at-obs" placeholder="ex.: assinado pelo diretor técnico">' +
        (hist.length ? '<h3 style="font-size:12px;margin:12px 0 4px">Registros anteriores</h3>' +
          '<table class="parcelas"><tbody>' + hist.slice(0, 6).map(function (a2) {
            return '<tr><td class="mono">' + U.fData(a2.data) + '</td>' +
              '<td>' + (a2.situacao === 'recebido' ? 'recebido' : 'pedido') + '</td>' +
              '<td>' + U.esc(a2.numero || '—') + '</td>' +
              '<td class="sub">' + U.esc(a2.observacao || '') + '</td></tr>';
          }).join('') + '</tbody></table>' : ''),
      acoes: [{ txt: 'Salvar', cls: 'btn-aprovar', fn: function () {
        const arq = U.el('at-arq').files && U.el('at-arq').files[0];
        const salvar = function (arquivo) {
          const r = S.registrarAtestado(clienteId, {
            situacao: U.val('at-sit'), data: U.val('at-data'), numero: U.val('at-num'),
            periodo_de: U.val('at-pde'), periodo_ate: U.val('at-pate'),
            periodicidade: parseInt(U.val('at-per'), 10) || 6,
            observacao: U.val('at-obs'), arquivo: arquivo
          });
          if (r.erro) return ERP.app.aviso(r.erro, 'erro');
          ERP.app.fecharModal();
          ERP.app.atualizarContadores();
          render();
          ERP.app.aviso(r.atestado.situacao === 'recebido'
            ? 'Atestado registrado — a contagem recomeça agora.'
            : 'Pedido registrado. O alerta continua até o atestado chegar.', 'ok');
        };
        if (!arq) return salvar(null);
        const fr = new FileReader();
        fr.onload = function () { salvar({ nome: arq.name, dados: fr.result }); };
        fr.readAsDataURL(arq);
      } }]
    });
  }

  /* ── projetos ───────────────────────────────────────────*/
  function projetos() {
    const lista = D.centros.filter(function (c) {
      return c.tipo === 'projeto' && (verInativos || c.ativo);
    })
      .sort(function (a, b) {
        return String(a.unidade || '\u0000').localeCompare(String(b.unidade || '\u0000')) ||
               String(a.curto).localeCompare(String(b.curto));
      });
    const marcados = lista.filter(function (c) { return sel.has(c.id); });
    let uniAtual = null;

    return '<div class="ap-acoes">' +
        '<button class="btn-linha" id="cad-novo-projeto">+ Novo projeto</button>' +
        '<button class="btn-sm" id="cad-sel-todos">Marcar todos</button>' +
        '<button class="btn-sm" id="cad-sel-nada">Desmarcar</button>' +
        '<button class="btn-sm" id="cad-ver-inativos">' + (verInativos ? 'Esconder inativos' : 'Mostrar inativos') + '</button>' +
      '</div>' +
      (marcados.length
        ? '<div class="barra-lote" style="display:flex">' +
            '<span class="conta">' + marcados.length + ' projeto(s) marcado(s)</span>' +
            /* Definir a empresa de vários de uma vez: são dezenas de
               projetos a classificar, e um a um seria trabalho à toa. */
            '<select id="cad-empresa-lote" style="width:auto">' +
              '<option value="">— empresa do contrato —</option>' +
              D.empresas.map(function (e) {
                return '<option value="' + e.id + '">' + U.esc(e.apelido || e.nome) + '</option>';
              }).join('') + '</select>' +
            '<button class="btn-sm" id="cad-aplicar-empresa">Aplicar</button>' +
            '<button class="btn-sm" id="cad-inativar">Inativar</button>' +
            '<button class="btn-sm" id="cad-ativar">Reativar</button>' +
            '<button class="btn-sm btn-cancelar" id="cad-excluir">Excluir</button>' +
          '</div>'
        : '') +
      '<div class="tabela-rolagem" style="margin:0 -14px"><table><thead><tr>' +
      '<th style="width:24px"><input type="checkbox" id="cad-chk-todos" style="width:auto"></th>' +
      '<th>Projeto</th><th>Empresa</th><th>Tipo</th><th class="num">Prazo</th>' +
      IMP.map(function (i) { return '<th class="num">' + i[1] + '</th>'; }).join('') +
      '<th class="num">% Ret.</th><th class="num">Faturamento previsto</th>' +
      '<th class="num">Repasse previsto</th><th>Situação</th><th></th></tr></thead><tbody>' +
      lista.map(function (c) {
        let cab = '';
        const uni = c.unidade || '— estruturais —';
        if (uni !== uniAtual) {
          uniAtual = uni;
          cab = '<tr><td class="g" colspan="14" style="font-weight:650;background:#f2f4f5">' +
            U.esc(uni) + '</td></tr>';
        }
        const imp = c.impostos || {};
        return cab + '<tr class="' + (sel.has(c.id) ? 'sel ' : '') + (c.ativo ? '' : 'cancelada') + '">' +
          '<td><input type="checkbox" style="width:auto" data-sel="' + c.id + '"' + (sel.has(c.id) ? ' checked' : '') + '></td>' +
          '<td class="desc">' + U.esc(c.curto || c.nome) + '<div class="sub">' + U.esc(c.codigo || '') +
            (c.codigo_hospital ? ' · ' + U.esc(c.codigo_hospital) : '') + '</div></td>' +
          /* Sem empresa definida o projeto cai na matriz por padrão, e
             isso precisa ficar visível: é conferência de cadastro, não
             um dado que o sistema possa adivinhar. */
          '<td class="sub">' + (c.empresa
            ? U.esc((D.empresaPor(c.empresa) || {}).apelido || c.empresa)
            : '<span class="erro">definir</span>') + '</td>' +
          '<td>' + (c.tipo === 'projeto'
            ? U.esc(D.TIPOS_SERVICO[c.tipo_servico] || c.tipo_servico || '?') +
              (c.produtividade === false ? '<div class="sub">sem repasse</div>' : '')
            : '<span class="sub">' + U.esc(c.tipo) + '</span>') + '</td>' +
          '<td class="num">' + (c.prazo_dias ? c.prazo_dias + 'd' : '—') + '</td>' +
          IMP.map(function (i) { return '<td class="num sub">' + pct(imp[i[0]]) + '</td>'; }).join('') +
          '<td class="num">' + (c.retencao_pct ? U.num(c.retencao_pct) + '%' : '—') + '</td>' +
          '<td class="num">' + (c.prev_faturamento ? U.brl(c.prev_faturamento) : '—') + '</td>' +
          '<td class="num">' + (c.prev_repasse ? U.brl(c.prev_repasse) : '—') + '</td>' +
          '<td>' + (c.ativo ? '<span class="badge b-aprovado">ativo</span>'
                            : '<span class="badge b-cancelado">inativo</span>') + '</td>' +
          '<td class="acoes"><button class="btn-sm" data-proj="' + c.id + '">Editar</button></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="ajuda">Prazo em dias a partir do fim da competência. A retenção do projeto tem ' +
      'prioridade sobre o cadastro do cliente e sobre o que vem na NF. As previsões preenchem a tela ' +
      'de Previsões de qualquer mês. Projeto com movimento não pode ser excluído — inative.</div>';
  }

  /* Cliente ↔ projeto: o vínculo mora em cliente.centro_padrao, mas
     precisa ser editável dos DOIS lados — antes só dava pra escolher o
     projeto dentro do cliente, e quem cadastrava o projeto primeiro
     ficava sem como amarrar. */
  function clienteDoProjeto(c) {
    if (!c) return '';
    if (c.cliente) return c.cliente;
    const cl = D.clientes.find(function (x) { return x.centro_padrao === c.id; });
    return cl ? cl.id : '';
  }
  function opcoesCliente(sel) {
    return '<option value="">Sem cliente</option>' + D.clientes.slice()
      .sort(function (a, b) { return (a.nome || '').localeCompare(b.nome || ''); })
      .map(function (x) {
        return '<option value="' + x.id + '"' + (x.id === sel ? ' selected' : '') + '>' + U.esc(x.nome) + '</option>';
      }).join('');
  }
  /* O vínculo é gravado NO PROJETO. Um cliente pode ter vários
     projetos (as 8 especialidades do HGB, as filiais), e salvar um
     cadastro não mexe mais no vínculo dos outros — que era o efeito do
     modelo antigo, onde o cliente guardava um único projeto. */
  function vincularClienteProjeto(clienteId, projetoId) {
    if (!projetoId) return;
    const pj = D.centro(projetoId);
    if (pj) pj.cliente = clienteId || null;
    const cl = clienteId && D.clientes.find(function (x) { return x.id === clienteId; });
    if (cl && !cl.centro_padrao) cl.centro_padrao = projetoId;   // compatibilidade com telas antigas
  }

  const CAMPOS_PROJETO = ['pj-nome', 'pj-empresa', 'pj-uni', 'pj-curto', 'pj-cod', 'pj-prazo', 'pj-codhosp', 'pj-tiposerv',
    'pj-cliente', 'pj-ret', 'pj-alias', 'pj-prevfat', 'pj-prevrep'].concat(IMP.map(function (i) { return 'pj-' + i[0]; }));
  /* Itens de locação também entram no rascunho: usar "+ cadastrar
     cliente" no meio de um projeto de locação apagava a lista inteira. */
  function lerRascunhoProjeto() {
    const r = {};
    CAMPOS_PROJETO.forEach(function (k) { if (U.el(k)) r[k] = U.val(k); });
    r.__itens_locacao = lerItensLocacao();
    return r;
  }

  /* Itens de locação do projeto (descrição, quantidade e valor
     mensal por unidade) — base da fatura de locação. */
  function linhaLocacaoHTML(i) {
    return '<div class="row3" data-loc style="margin-top:4px;align-items:center">' +
      '<input data-loc-desc placeholder="Item locado" value="' + U.esc(i.descricao || '') + '">' +
      '<input class="num" data-loc-qtd inputmode="decimal" placeholder="Qtd" value="' + U.num(i.qtd || 0) + '">' +
      '<div style="display:flex;gap:4px"><input class="num" data-loc-vu inputmode="decimal" placeholder="R$/mês por unidade" value="' +
        U.num(i.valor_unit || 0) + '"><button type="button" class="btn-sm" data-loc-del>×</button></div></div>';
  }
  function lerItensLocacao() {
    return Array.prototype.map.call(document.querySelectorAll('#pj-locacao [data-loc]'), function (l) {
      return { descricao: l.querySelector('[data-loc-desc]').value.trim(),
        qtd: U.parseValor(l.querySelector('[data-loc-qtd]').value),
        valor_unit: U.parseValor(l.querySelector('[data-loc-vu]').value) };
    }).filter(function (i) { return i.descricao; });
  }
  function montarItensLocacao(itens) {
    const box = U.el('pj-locacao');
    if (!box) return;
    box.innerHTML = (itens.length ? itens : [{}]).map(linhaLocacaoHTML).join('');
    const atualiza = function () {
      const t = lerItensLocacao().reduce(function (a, i) { return a + i.qtd * i.valor_unit; }, 0);
      U.el('pj-loc-total').textContent = 'Total mensal: ' + U.brl(Math.round(t * 100) / 100);
    };
    box.addEventListener('input', atualiza);
    box.addEventListener('click', function (e) {
      if (e.target.matches('[data-loc-del]')) { e.target.closest('[data-loc]').remove(); atualiza(); }
    });
    U.el('pj-loc-add').addEventListener('click', function () {
      box.insertAdjacentHTML('beforeend', linhaLocacaoHTML({})); atualiza();
    });
    atualiza();
  }

  function editarProjeto(id, aoFechar, rascunho) {
    const c = id ? D.centro(id) : null;
    const imp = (c && c.impostos) || {};
    ERP.app.modal({
      titulo: c ? 'Projeto · ' + (c.curto || c.nome) : 'Novo projeto',
      corpo:
        '<div class="row2"><div><label>Nome do projeto</label><input id="pj-nome" value="' + U.esc(c ? c.nome : '') + '"></div>' +
        /* De qual CNPJ do grupo é o contrato. Não dá para deduzir pela
           unidade — projeto em Fortaleza pode ser da matriz —, e sem
           isso a apuração por empresa joga tudo na matriz e a linha da
           filial sai zerada. */
        '<div><label>Empresa do contrato</label><select id="pj-empresa">' +
          D.empresas.map(function (e) {
            return '<option value="' + e.id + '"' +
              ((c ? c.empresa : null) === e.id ? ' selected' : '') + '>' +
              U.esc(e.apelido || e.nome) + ' · ' + U.esc(e.cnpj ? U.cnpj(e.cnpj) : '') + '</option>';
          }).join('') + '</select></div></div>' +
        '<div class="row2"><div></div>' +
        '<div><label>Unidade</label><input id="pj-uni" list="dl-unidades" value="' + U.esc(c ? (c.unidade || '') : '') + '">' +
          '<datalist id="dl-unidades">' + D.unidades().map(function (u) {
            return '<option value="' + U.esc(u) + '">'; }).join('') + '</datalist></div></div>' +
        '<div class="row3"><div><label>Apelido</label><input id="pj-curto" value="' + U.esc(c ? (c.curto || '') : '') + '"></div>' +
        '<div><label>Código</label><input id="pj-cod" value="' + U.esc(c ? (c.codigo || '') : '') + '"></div>' +
        '<div><label>Prazo (dias)</label><input id="pj-prazo" type="number" min="0" max="365" value="' +
          (c && c.prazo_dias ? c.prazo_dias : 30) + '"></div></div>' +
        '<div><label>Código de reconhecimento (opcional)</label><input id="pj-codhosp" placeholder="Ex.: GHC_ANES, HMSM_PED" value="' +
          U.esc(c ? (c.codigo_hospital || '') : '') + '"></div>' +
        '<div class="ajuda">Aparece junto do nome nos candidatos de vínculo da conciliação — ajuda a ' +
          'diferenciar projetos parecidos do mesmo hospital.</div>' +
        '<label>Tipo de serviço</label><select id="pj-tiposerv">' +
          Object.keys(D.TIPOS_SERVICO).map(function (k) {
            return '<option value="' + k + '"' + (c && c.tipo_servico === k ? ' selected' : '') + '>' +
              U.esc(D.TIPOS_SERVICO[k]) + '</option>';
          }).join('') + '</select>' +
        '<div class="ajuda">Serviços médicos tem repasse de produtividade; locação e venda de material não.</div>' +
        '<label>Cliente (quem paga as notas deste projeto)</label>' +
        '<div class="row2"><select id="pj-cliente">' + opcoesCliente(clienteDoProjeto(c)) + '</select>' +
        '<button type="button" class="btn-sm" id="pj-novo-cliente">+ cadastrar cliente</button></div>' +
        '<div class="ajuda">O vínculo é o mesmo dos dois lados: escolher aqui já deixa o projeto marcado no cadastro do cliente.</div>' +
        '<h2 style="font-size:12px;margin:14px 0 6px">Impostos do projeto (%)</h2>' +
        '<div class="row3">' + IMP.map(function (i) {
          return '<div><label>' + i[1] + '</label><input id="pj-' + i[0] + '" class="num" inputmode="decimal" value="' +
            U.num(imp[i[0]] || 0) + '"></div>';
        }).join('') + '</div>' +
        '<div class="row2" style="margin-top:8px">' +
        '<div><label>Retenção do órgão (%)</label><input id="pj-ret" class="num" inputmode="decimal" value="' +
          U.num(c ? (c.retencao_pct || 0) : 0) + '">' +
          /* O aviso aparece na hora de digitar, não só no relatório:
             retenção acima da soma dos impostos é dinheiro que não
             volta, e isso pesa na hora de precificar aquele
             contrato. */
          '<div id="pj-ret-obs" class="sub"></div></div>' +
        '<div><label>Apelidos de busca</label><input id="pj-alias" value="' +
          U.esc(c ? (c.aliases || []).join(', ') : '') + '"></div></div>' +
        '<div id="pj-loc-bloco" style="display:' + (c && c.tipo_servico === 'locacao' ? 'block' : 'none') + '">' +
          '<h2 style="font-size:12px;margin:14px 0 6px">Itens de locação deste projeto</h2>' +
          '<div class="ajuda">É a lista que aparece na hora de emitir a fatura, com a quantidade total de cada item.</div>' +
          '<div id="pj-locacao"></div>' +
          '<button type="button" class="btn-sm" id="pj-loc-add" style="margin-top:4px">+ item de locação</button>' +
          ' <span id="pj-loc-total" class="sub"></span></div>' +
        '<h2 style="font-size:12px;margin:14px 0 6px">Previsão mensal</h2>' +
        '<div class="row2"><div><label>Faturamento estimado</label>' +
          '<input id="pj-prevfat" class="num" inputmode="decimal" value="' + U.num(c ? (c.prev_faturamento || 0) : 0) + '"></div>' +
        '<div><label>Repasse de produtividade estimado</label>' +
          '<input id="pj-prevrep" class="num" inputmode="decimal" value="' + U.num(c ? (c.prev_repasse || 0) : 0) + '"></div></div>' +
        (c ? '<label style="display:flex;gap:7px;align-items:center;margin-top:10px;font-weight:400">' +
             '<input type="checkbox" id="pj-ativo" style="width:auto"' + (c.ativo ? ' checked' : '') + '> ativo</label>' : ''),
      aposAbrir: function () {
        /* Compara a retenção do órgão com a soma dos impostos e avisa
           na hora. Retenção ACIMA do devido é dinheiro que não volta:
           o excedente vira custo do contrato, e quem está cadastrando
           precisa saber disso antes de fechar preço. */
        const atualizarObs = function () {
          const obs = U.el('pj-ret-obs');
          if (!obs) return;
          const ret = U.parseValor(U.val('pj-ret')) || 0;
          let soma = 0;
          IMP.forEach(function (i) {
            /* O ISS do Ceará é alternativa ao ISS, não adicional: somar
               os dois inventaria uma alíquota que ninguém recolhe. */
            if (i[0] === 'iss_ce') return;
            soma += U.parseValor(U.val('pj-' + i[0])) || 0;
          });
          if (!ret) { obs.innerHTML = '<span class="sub">o órgão não retém</span>'; return; }
          if (ret > soma + 0.001) {
            obs.innerHTML = '<span style="color:var(--red)">Retém ' + U.num(ret) +
              '% sobre imposto de ' + U.num(soma) + '% — o excedente de ' +
              U.num(ret - soma) + ' ponto(s) é custo do projeto, não volta.</span>';
          } else if (ret < soma - 0.001) {
            obs.innerHTML = '<span class="sub">Retém ' + U.num(ret) + '% de ' + U.num(soma) +
              '% devidos — os outros ' + U.num(soma - ret) + ' ponto(s) saem por guia.</span>';
          } else {
            obs.innerHTML = '<span class="sub">retenção igual ao imposto devido</span>';
          }
        };
        atualizarObs();
        const campos = ['pj-ret'].concat(IMP.map(function (i) { return 'pj-' + i[0]; }));
        campos.forEach(function (id) {
          const e = U.el(id);
          if (e) e.addEventListener('input', atualizarObs);
        });
      },
      acoes: [{ txt: c ? 'Salvar' : 'Cadastrar', cls: 'btn-aprovar', fn: function () {
        const nome = U.val('pj-nome');
        if (!nome) return ERP.app.aviso('Informe o nome do projeto.', 'erro');
        /* TODO PROJETO TEM CLIENTE. Sem ele, a nota não sabe para
           quem é emitida, o prazo de recebimento não existe e o
           projeto fica fora dos relatórios por cliente. Se o tomador
           ainda não estiver cadastrado, o caminho é criá-lo — nem
           que seja com o nome do próprio projeto. */
        if (!U.val('pj-cliente')) {
          return ERP.app.aviso('Escolha o cliente deste projeto. Se ainda não existir, ' +
            'cadastre-o primeiro — pode ser com o nome do próprio projeto.', 'erro');
        }
        const ts = U.val('pj-tiposerv');
        const dados = {
          nome: nome, curto: U.val('pj-curto') || nome.slice(0, 24),
          unidade: U.val('pj-uni'), codigo: U.val('pj-cod'), tipo: 'projeto',
          empresa: U.val('pj-empresa') || (D.empresas[0] || {}).id,
          codigo_hospital: U.val('pj-codhosp').trim() || null,
          tipo_servico: ts, produtividade: ts === 'medico',
          prazo_dias: parseInt(U.val('pj-prazo'), 10) || 30,
          retencao_pct: U.parseValor(U.val('pj-ret')),
          prev_faturamento: U.parseValor(U.val('pj-prevfat')),
          prev_repasse: ts === 'medico' ? U.parseValor(U.val('pj-prevrep')) : 0,
          impostos: {}, aliases: U.val('pj-alias').split(',').map(function (s) { return s.trim(); })
            .filter(function (s) { return s.length; }),
          itens_locacao: ts === 'locacao' ? lerItensLocacao() : []
        };
        IMP.forEach(function (i) {
          const v = U.parseValor(U.val('pj-' + i[0]));
          if (v) dados.impostos[i[0]] = v;
        });
        if (c) {
          Object.keys(dados).forEach(function (k) { c[k] = dados[k]; });
          S.logarCadastro('cadastro', c.id, 'editou cadastro', (c.nome || c.descricao || c.codigo || ''));
          c.ativo = U.el('pj-ativo') ? U.el('pj-ativo').checked : true;
        } else {
          dados.id = S.proximoId('pj');
          dados.ativo = true;
          D.centros.push(dados);
          S.logarCadastro('centro', dados.id, 'cadastrou centro de custo', dados.nome || dados.descricao || dados.codigo || '');
        }
        vincularClienteProjeto(U.val('pj-cliente'), c ? c.id : dados.id);
        ERP.app.fecharModal();
        ERP.app.aviso('Projeto salvo.', 'ok');
        if (aoFechar) aoFechar(c ? c.id : dados.id);
        else render();
      } }]
    });
    montarItensLocacao((rascunho && rascunho.__itens_locacao) || (c && c.itens_locacao) || []);
    U.el('pj-tiposerv').addEventListener('change', function () {
      U.el('pj-loc-bloco').style.display = this.value === 'locacao' ? 'block' : 'none';
    });
    if (rascunho) Object.keys(rascunho).forEach(function (k) { if (k !== '__itens_locacao' && U.el(k)) U.setVal(k, rascunho[k]); });
    /* Cadastrar o cliente na hora: guarda o que já foi digitado, abre o
       formulário de cliente e reabre este com o cliente novo escolhido. */
    U.el('pj-novo-cliente').addEventListener('click', function () {
      const atual = lerRascunhoProjeto();
      editarCliente(null, function (novoId) {
        atual['pj-cliente'] = novoId;
        editarProjeto(id, aoFechar, atual);
      });
    });
  }

  /* ── ações em massa ─────────────────────────────────────*/
  const temMovimento = id => S.todasParcelas().some(function (p) {
      return (p.rateio || []).some(function (r) { return r.centro === id; });
    }) || S.contasReceber().some(function (r) { return r.centro === id; }) ||
       S.previsoes().some(function (p) { return p.centro === id; });

  /* Além de movimento financeiro, projeto amarrado em CONTRATO, em
     CLIENTE ou com ESTOQUE não pode ser excluído: o contrato ficava com
     "?" no lugar do projeto e não salvava mais. */
  function amarras(id) {
    const lista = [];
    const cts = S.contratos().filter(function (c) {
      return (c.itens || []).some(function (i) { return i.centro === id; });
    });
    if (cts.length) lista.push(cts.length + ' contrato(s): ' + cts.map(function (c) { return c.numero; }).slice(0, 3).join(', '));
    const cli = D.clienteDoCentro(id);
    if (cli) lista.push('cliente ' + cli.nome);
    if (D.armazens.some(function (a) { return a.centro === id; })) lista.push('armazém de estoque');
    return lista;
  }

  function emMassa(acao) {
    const ids = Array.from(sel);
    let n = 0, bloqueados = [];
    if (acao === 'excluir' && ids.length) {
      const alvo = ids.map(function (id) { return (D.centro(id) || {}).curto || id; }).slice(0, 5).join(', ');
      if (!confirm('Excluir ' + ids.length + ' projeto(s) (' + alvo + ')?\n\n' +
          'A exclusão é definitiva. Projeto com movimento, contrato, cliente ou estoque não é excluído — ' +
          'nesses casos use Inativar.')) return;
    }
    ids.forEach(function (id) {
      const c = D.centro(id);
      if (!c) return;
      if (acao === 'inativar') { c.ativo = false; n++; }
      else if (acao === 'ativar') { c.ativo = true; n++; }
      else if (acao === 'excluir') {
        const presos = temMovimento(id) ? ['movimento lançado'] : [];
        const outras = amarras(id);
        if (presos.length || outras.length) {
          bloqueados.push((c.curto || c.nome) + ' (' + presos.concat(outras).join(' · ') + ')');
          return;
        }
        D.centros.splice(D.centros.indexOf(c), 1);
        n++;
      }
    });
    sel.clear();
    render();
    const rot = { inativar: 'inativado(s)', ativar: 'reativado(s)', excluir: 'excluído(s)' };
    ERP.app.aviso(n + ' projeto(s) ' + rot[acao] +
      (bloqueados.length ? '. Não deu para excluir ' + bloqueados.length + ': ' +
        bloqueados.slice(0, 3).join(' · ') + ' — use Inativar.' : '.'),
      bloqueados.length ? 'erro' : 'ok');
  }

  /* ── estrutura da empresa ───────────────────────────────
     Matriz, filiais e o "Geral" não são projeto: são onde a despesa da
     própria empresa é lançada. */
  function estrutura() {
    const lista = D.centros.filter(function (c) { return c.tipo !== 'projeto'; });
    return '<div class="ap-acoes"><button class="btn-linha" id="cad-nova-unidade">+ Nova filial</button></div>' +
      '<table><thead><tr><th>Código</th><th>Nome</th><th>Tipo</th><th>CNPJ</th>' +
      '<th>Cidade</th><th>Situação</th><th></th></tr></thead><tbody>' +
      lista.map(function (c) {
        return '<tr' + (c.ativo ? '' : ' class="cancelada"') + '>' +
          '<td class="mono">' + U.esc(c.codigo || '') + '</td>' +
          '<td class="desc">' + U.esc(c.nome) + '<div class="sub">' + U.esc(c.curto || '') + '</div></td>' +
          '<td>' + U.esc(c.tipo) + '</td>' +
          /* CNPJ com máscara, como na lista de fornecedores. Guardado
             sem pontuação (é o que o XML da nota exige), exibido com
             ela. */
          '<td class="mono">' + U.esc(c.cnpj ? U.cnpj(c.cnpj) : '—') + '</td>' +
          '<td>' + U.esc(c.cidade ? c.cidade + '/' + (c.uf || '') : '—') + '</td>' +
          '<td>' + (c.ativo ? '<span class="badge b-aprovado">ativa</span>'
                            : '<span class="badge b-cancelado">inativa</span>') + '</td>' +
          '<td class="acoes"><button class="btn-sm" data-uni="' + c.id + '">Editar</button></td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="ajuda">Despesa administrativa, folha e imposto da empresa são lançados aqui, ' +
      'não em projeto. "Geral" serve para o que não pertence a nenhuma unidade.</div>';
  }

  function editarUnidade(id) {
    const c = id ? D.centro(id) : null;
    ERP.app.modal({
      titulo: c ? 'Unidade · ' + c.nome : 'Nova filial',
      corpo:
        '<label>Nome</label><input id="un-nome" value="' + U.esc(c ? c.nome : '') + '">' +
        '<div class="row3"><div><label>Apelido</label><input id="un-curto" value="' + U.esc(c ? (c.curto || '') : '') + '"></div>' +
        '<div><label>Código</label><input id="un-cod" value="' + U.esc(c ? (c.codigo || '') : '') + '"></div>' +
        '<div><label>Tipo</label><select id="un-tipo">' +
          ['matriz', 'filial', 'geral'].map(function (t) {
            return '<option value="' + t + '"' + (c && c.tipo === t ? ' selected' : '') + '>' + t + '</option>';
          }).join('') + '</select></div></div>' +
        '<div class="row3"><div><label>CNPJ</label><input id="un-cnpj" inputmode="numeric" value="' +
          U.esc(c ? (c.cnpj || '') : '') + '"></div>' +
        '<div><label>Cidade</label><input id="un-cidade" value="' + U.esc(c ? (c.cidade || '') : '') + '"></div>' +
        '<div><label>UF</label><input id="un-uf" maxlength="2" value="' + U.esc(c ? (c.uf || '') : '') + '"></div></div>' +
        (c ? '<label style="display:flex;gap:7px;align-items:center;margin-top:10px;font-weight:400">' +
             '<input type="checkbox" id="un-ativo" style="width:auto"' + (c.ativo ? ' checked' : '') + '> ativa</label>' : ''),
      acoes: [{ txt: c ? 'Salvar' : 'Cadastrar', cls: 'btn-aprovar', fn: function () {
        const nome = U.val('un-nome');
        if (!nome) return ERP.app.aviso('Informe o nome.', 'erro');
        const dados = {
          nome: nome, curto: U.val('un-curto') || nome.slice(0, 18), codigo: U.val('un-cod'),
          tipo: U.val('un-tipo'), cnpj: U.val('un-cnpj').replace(/\D/g, ''),
          cidade: U.val('un-cidade'), uf: U.val('un-uf').toUpperCase()
        };
        if (c) {
          Object.keys(dados).forEach(function (k) { c[k] = dados[k]; });
          S.logarCadastro('cadastro', c.id, 'editou cadastro', (c.nome || c.descricao || c.codigo || ''));
          c.ativo = U.el('un-ativo') ? U.el('un-ativo').checked : true;
        } else {
          dados.id = S.proximoId('cc');
          dados.ativo = true;
          D.centros.push(dados);
          S.logarCadastro('centro', dados.id, 'cadastrou centro de custo', dados.nome || dados.descricao || dados.codigo || '');
        }
        ERP.app.fecharModal();
        ERP.app.aviso('Unidade salva.', 'ok');
        render();
      } }]
    });
  }

  /* ── produtos ───────────────────────────────────────────
     É aqui que se define o ponto de pedido (mínimo) e o alvo da
     reposição (ideal): a quantidade sugerida na requisição é a
     diferença entre o ideal e o saldo. */
  function produtos() {
    const lista = D.produtos.filter(function (p) { return verInativos || p.ativo; })
      .sort(function (a, b) { return String(a.codigo).localeCompare(String(b.codigo)); });
    const marcados = lista.filter(function (p) { return sel.has(p.id); });
    return '<div class="ap-acoes">' +
        '<button class="btn-linha" id="cad-novo-produto">+ Novo produto</button>' +
        '<button class="btn-sm" id="cad-prod-todos">Marcar todos</button>' +
        '<button class="btn-sm" id="cad-prod-nada">Desmarcar</button>' +
        '<button class="btn-sm" id="cad-ver-inativos">' + (verInativos ? 'Esconder inativos' : 'Mostrar inativos') + '</button>' +
      '</div>' +
      (marcados.length
        ? '<div class="barra-lote" style="display:flex"><span class="conta">' + marcados.length +
          ' marcado(s)</span>' +
          '<button class="btn-sm" id="cad-prod-inativar">Inativar</button>' +
          '<button class="btn-sm" id="cad-prod-ativar">Reativar</button></div>'
        : '') +
      '<div class="tabela-rolagem" style="margin:0 -14px"><table><thead><tr>' +
      '<th style="width:24px"></th><th>Código</th><th>Material</th><th>Unidade</th>' +
      '<th class="num">Mínimo</th><th class="num">Ideal</th><th class="num">Custo referência</th>' +
      '<th class="num">Saldo total</th><th>NCM</th><th>Situação</th><th></th></tr></thead><tbody>' +
      lista.map(function (p) {
        const saldo = S.saldoEstoque(p.id, null);
        return '<tr class="' + (sel.has(p.id) ? 'sel ' : '') + (p.ativo ? '' : 'cancelada') + '">' +
          '<td><input type="checkbox" style="width:auto" data-selp="' + p.id + '"' +
            (sel.has(p.id) ? ' checked' : '') + '></td>' +
          '<td class="mono">' + U.esc(p.codigo) + '</td>' +
          '<td class="desc">' + U.esc(p.descricao) + '</td>' +
          '<td>' + U.esc(p.unidade) + '</td>' +
          '<td class="num">' + U.num(p.minimo || 0) + '</td>' +
          '<td class="num">' + U.num(p.ideal || 0) + '</td>' +
          '<td class="num sub">' + U.brl(p.custo || 0) + '</td>' +
          '<td class="num">' + U.num(saldo) + '</td>' +
          '<td class="mono sub">' + U.esc(p.ncm || '—') + '</td>' +
          '<td>' + (p.ativo ? '<span class="badge b-aprovado">ativo</span>'
                            : '<span class="badge b-cancelado">inativo</span>') + '</td>' +
          '<td class="acoes"><button class="btn-sm" data-prod="' + p.id + '">Editar</button></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="ajuda">Mínimo é o ponto de pedido: abaixo dele o material entra no alerta. Ideal é o ' +
      'alvo da reposição — a quantidade sugerida na requisição é ideal menos saldo. O custo de referência ' +
      'serve de sugestão na entrada; o custo que vale no estoque é o da nota, pela média ponderada.</div>';
  }

  function editarProduto(id) {
    const p = id ? D.produtos.find(function (x) { return x.id === id; }) : null;
    ERP.app.modal({
      titulo: p ? 'Produto · ' + p.descricao : 'Novo produto',
      corpo:
        '<label>Descrição</label><input id="pd-desc" value="' + U.esc(p ? p.descricao : '') + '">' +
        '<div class="row3"><div><label>Código</label><input id="pd-cod" value="' + U.esc(p ? p.codigo : '') + '"></div>' +
        '<div><label>Unidade</label><input id="pd-un" maxlength="4" value="' + U.esc(p ? p.unidade : '') + '" ' +
          'placeholder="CX, UN, PCT"></div>' +
        '<div><label>NCM</label><input id="pd-ncm" value="' + U.esc(p ? (p.ncm || '') : '') + '"></div></div>' +
        '<div class="row3"><div><label>Mínimo (ponto de pedido)</label>' +
          '<input id="pd-min" class="num" inputmode="decimal" value="' + U.num(p ? (p.minimo || 0) : 0) + '"></div>' +
        '<div><label>Ideal (alvo da reposição)</label>' +
          '<input id="pd-ideal" class="num" inputmode="decimal" value="' + U.num(p ? (p.ideal || 0) : 0) + '"></div>' +
        '<div><label>Custo de referência</label>' +
          '<input id="pd-custo" class="num" inputmode="decimal" value="' + U.num(p ? (p.custo || 0) : 0) + '"></div></div>' +
        '<label>Natureza padrão (DRE)</label><select id="pd-conta">' +
          D.plano.filter(function (x) { return x.nivel === 2 && x.pai !== '1'; }).map(function (x) {
            return '<option value="' + x.cod + '"' + (p && p.conta === x.cod ? ' selected' : '') + '>' +
              U.esc(x.cod + ' ' + x.nome) + '</option>'; }).join('') + '</select>' +
        (p ? '<label style="display:flex;gap:7px;align-items:center;margin-top:10px;font-weight:400">' +
             '<input type="checkbox" id="pd-ativo" style="width:auto"' + (p.ativo ? ' checked' : '') + '> ativo</label>' : ''),
      acoes: [{ txt: p ? 'Salvar' : 'Cadastrar', cls: 'btn-aprovar', fn: function () {
        const desc = U.val('pd-desc');
        if (!desc) return ERP.app.aviso('Informe a descrição.', 'erro');
        const min = U.parseValor(U.val('pd-min')), ideal = U.parseValor(U.val('pd-ideal'));
        if (ideal && ideal < min) return ERP.app.aviso('O ideal não pode ser menor que o mínimo.', 'erro');
        const dados = {
          descricao: desc, codigo: U.val('pd-cod') || ('MT-' + String(D.produtos.length + 1).padStart(3, '0')),
          unidade: U.val('pd-un') || 'UN', ncm: U.val('pd-ncm'),
          minimo: min, ideal: ideal, custo: U.parseValor(U.val('pd-custo')),
          conta: U.val('pd-conta')
        };
        if (p) {
          Object.keys(dados).forEach(function (k) { p[k] = dados[k]; });
          S.logarCadastro('cadastro', p.id, 'editou cadastro', (p.nome || p.descricao || p.codigo || ''));
          p.ativo = U.el('pd-ativo') ? U.el('pd-ativo').checked : true;
        } else {
          /* Pelo gerador do store, não pelo relógio: dois cadastros
             no mesmo milissegundo recebiam o mesmo id, e as
             entradas de um iam para o saldo do outro. */
          dados.id = S.proximoIdProduto();
          dados.ativo = true;
          D.produtos.push(dados);
          S.logarCadastro('produto', dados.id, 'cadastrou material', dados.nome || dados.descricao || dados.codigo || '');
        }
        ERP.app.fecharModal();
        ERP.app.aviso('Produto salvo.', 'ok');
        render();
      } }]
    });
  }

  /* ── armazéns ───────────────────────────────────────────*/
  function armazens() {
    const lista = D.armazens.filter(function (a) { return verInativos || a.ativo; });
    return '<div class="ap-acoes">' +
        '<button class="btn-linha" id="cad-novo-armazem">+ Novo armazém</button>' +
        '<button class="btn-sm" id="cad-ver-inativos">' + (verInativos ? 'Esconder inativos' : 'Mostrar inativos') + '</button>' +
      '</div>' +
      '<table><thead><tr><th>Código</th><th>Armazém</th><th>Tipo</th><th>Projeto</th>' +
      '<th>Responsável</th><th class="num">Itens com saldo</th><th class="num">Valor</th>' +
      '<th>Situação</th><th></th></tr></thead><tbody>' +
      lista.map(function (a) {
        const pos = S.posicaoEstoque(a.id).filter(function (l) { return l.saldo > 0; });
        const valor = pos.reduce(function (s, l) { return s + l.valor; }, 0);
        return '<tr' + (a.ativo ? '' : ' class="cancelada"') + '>' +
          '<td class="mono">' + U.esc(a.codigo) + '</td>' +
          '<td class="desc">' + U.esc(a.nome) + '</td>' +
          '<td>' + U.esc(D.TIPOS_ARMAZEM[a.tipo] || a.tipo || '—') +
            (a.pai ? '<div class="sub">de ' + U.esc((D.armazem(a.pai) || {}).codigo || '') + '</div>'
                   : (D.setoresDe(a.id).length
                      ? '<div class="sub">' + D.setoresDe(a.id).length + ' setor(es)</div>' : '')) + '</td>' +
          '<td>' + U.esc((D.centro(a.centro) || {}).curto || '—') + '</td>' +
          '<td class="sub">' + U.esc(a.responsavel || '—') + '</td>' +
          '<td class="num">' + pos.length + '</td>' +
          '<td class="num">' + U.brl(valor) + '</td>' +
          '<td>' + (a.ativo ? '<span class="badge b-aprovado">ativo</span>'
                            : '<span class="badge b-cancelado">inativo</span>') + '</td>' +
          '<td class="acoes"><button class="btn-sm" data-arm="' + a.id + '">Editar</button></td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="ajuda">O armazém aponta para o projeto: é por ele que o consumo de material chega ao ' +
      'DRE. Armazém inativo não aparece nas telas de movimento, e o saldo dele continua registrado.</div>';
  }

  function editarArmazem(id) {
    const a = id ? D.armazem(id) : null;
    ERP.app.modal({
      titulo: a ? 'Armazém · ' + a.nome : 'Novo armazém',
      corpo:
        '<label>Nome</label><input id="am-nome" value="' + U.esc(a ? a.nome : '') + '" ' +
          'placeholder="Ex.: Farmácia HNSN — Porto Alegre">' +
        '<div class="row2"><div><label>Código</label><input id="am-cod" value="' + U.esc(a ? a.codigo : '') + '" ' +
          'placeholder="FARM-XXX"></div>' +
        '<div><label>Tipo</label><select id="am-tipo">' +
          Object.keys(D.TIPOS_ARMAZEM).map(function (k) {
            return '<option value="' + k + '"' + (a && a.tipo === k ? ' selected' : '') + '>' +
              U.esc(D.TIPOS_ARMAZEM[k]) + '</option>'; }).join('') + '</select></div></div>' +
        /* Setor é armazém filho: recebe do armazém pai por distribuição
           interna e herda o projeto dele. Um nível só — a lista de pais
           não inclui quem já é setor. */
        '<label>Setor de (deixe em branco se for um armazém principal)</label>' +
        '<select id="am-pai"><option value="">— armazém principal —</option>' +
          D.armazens.filter(function (x) {
            return x.ativo && !x.pai && (!a || x.id !== a.id); }).map(function (x) {
            return '<option value="' + x.id + '"' + (a && a.pai === x.id ? ' selected' : '') + '>' +
              U.esc(x.codigo + ' · ' + x.nome) + '</option>'; }).join('') + '</select>' +
        '<label>Projeto / unidade a que pertence</label><select id="am-centro">' +
          '<option value="">Nenhum</option>' +
          D.centros.filter(function (c) { return c.ativo; }).map(function (c) {
            return '<option value="' + c.id + '"' + (a && a.centro === c.id ? ' selected' : '') + '>' +
              U.esc((c.unidade ? c.unidade + ' · ' : '') + (c.curto || c.nome)) + '</option>'; }).join('') + '</select>' +
        '<div class="row2"><div><label>Responsável</label><input id="am-resp" value="' +
          U.esc(a ? (a.responsavel || '') : '') + '" placeholder="farmacêutica do projeto"></div>' +
        '<div><label>Endereço</label><input id="am-end" value="' + U.esc(a ? (a.endereco || '') : '') + '"></div></div>' +
        (a ? '<label style="display:flex;gap:7px;align-items:center;margin-top:10px;font-weight:400">' +
             '<input type="checkbox" id="am-ativo" style="width:auto"' + (a.ativo ? ' checked' : '') + '> ativo</label>' +
             '<div class="ajuda">Inativar não apaga o saldo: o armazém só deixa de aparecer nas telas de ' +
             'movimento. Zere o estoque antes, ou transfira para outro armazém.</div>' : ''),
      acoes: [{ txt: a ? 'Salvar' : 'Cadastrar', cls: 'btn-aprovar', fn: function () {
        const nome = U.val('am-nome');
        if (!nome) return ERP.app.aviso('Informe o nome do armazém.', 'erro');
        const dados = {
          nome: nome, codigo: U.val('am-cod') || ('ALM-' + (D.armazens.length + 1)),
          tipo: U.val('am-tipo'), centro: U.val('am-centro') || null,
          pai: U.val('am-pai') || null,
          responsavel: U.val('am-resp'), endereco: U.val('am-end')
        };
        /* Setor sem projeto herda o do pai, senão o consumo dele não
           acha o caminho até o DRE. */
        if (dados.pai && !dados.centro) dados.centro = (D.armazem(dados.pai) || {}).centro || null;
        if (dados.pai && dados.tipo !== 'setor') dados.tipo = 'setor';
        /* Quem já tem setor embaixo não pode virar setor de outro —
           o sistema só sustenta um nível de hierarquia. A checagem
           antes conferia `a.pai` (o pai que o registro JÁ tinha) junto
           com `!dados.pai` (a nova informação dizendo que NÃO vai ter
           pai) — as duas coisas nunca eram verdadeiras ao mesmo tempo
           do jeito certo, e o aviso nunca disparava. O que importa é
           se o formulário está tentando dar um pai novo a quem já tem
           filho. */
        if (a && dados.pai && D.setoresDe(a.id).length) {
          return ERP.app.aviso('Este armazém tem setores abaixo dele e não pode virar setor.', 'erro');
        }
        if (a) {
          const ativoNovo = U.el('am-ativo') ? U.el('am-ativo').checked : true;
          const comSaldo = S.posicaoEstoque(a.id).filter(function (l) { return l.saldo > 0; });
          if (!ativoNovo && comSaldo.length) {
            return ERP.app.aviso('Este armazém ainda tem ' + comSaldo.length +
              ' material(is) com saldo. Transfira ou baixe antes de inativar.', 'erro');
          }
          Object.keys(dados).forEach(function (k) { a[k] = dados[k]; });
          a.ativo = ativoNovo;
        } else {
          dados.id = S.proximoId('am');
          dados.ativo = true;
          D.armazens.push(dados);
          S.logarCadastro('armazem', dados.id, 'cadastrou armazém', dados.nome || dados.descricao || dados.codigo || '');
        }
        ERP.app.fecharModal();
        ERP.app.aviso('Armazém salvo.', 'ok');
        render();
      } }]
    });
  }

  /* ── fornecedores e médicos ─────────────────────────────*/
  function credores(qual) {
    const ehMedico = qual === 'medico';
    /* Pendência de dados de pagamento: sem documento, sem forma, PIX
       sem chave ou TED/DOC sem banco, agência e conta. Fornecedor assim
       trava a parcela na hora de pagar. */
    const pendenciaDe = function (c) {
      const fx = S.formaDoCredor(c.id);
      const falta = [];
      if (!c.documento) falta.push('sem CPF/CNPJ');
      if (!fx) falta.push('sem forma de pagamento');
      else if (fx.codigo === 'pix' && !c.pix) falta.push('sem chave PIX');
      else if (['ted', 'doc', 'transferencia'].indexOf(fx.codigo) > -1 &&
               !(c.banco && c.agencia && c.conta_bancaria)) falta.push('sem banco/agência/conta');
      return falta;
    };
    const todosCred = D.credores.filter(function (c) {
      return (ehMedico ? c.tipo === 'medico' : c.tipo !== 'medico') && (verInativos || c.ativo !== false);
    }).sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome)); });
    const qtdPendentes = todosCred.filter(function (c) { return pendenciaDe(c).length; }).length;
    const lista = soPendentes ? todosCred.filter(function (c) { return pendenciaDe(c).length; }) : todosCred;
    const marcados = lista.filter(function (c) { return sel.has(c.id); });

    return '<div class="ap-acoes">' +
        '<button class="btn-linha" id="cad-novo-credor">+ Novo ' + (ehMedico ? 'médico' : 'fornecedor') + '</button>' +
        '<button class="btn-sm" id="cad-cred-todos">Marcar todos</button>' +
        '<button class="btn-sm" id="cad-cred-nada">Desmarcar</button>' +
        '<button class="btn-sm' + (soPendentes ? ' btn-aprovar' : '') + '" id="cad-so-pendentes">' +
          (soPendentes ? 'Ver todos' : 'Só com pagamento pendente (' + qtdPendentes + ')') + '</button>' +
        '<button class="btn-sm" id="cad-ver-inativos">' + (verInativos ? 'Esconder inativos' : 'Mostrar inativos') + '</button>' +
      '</div>' +
      (marcados.length
        ? '<div class="barra-lote" style="display:flex">' +
            '<span class="conta">' + marcados.length + ' marcado(s)</span>' +
            '<button class="btn-sm" id="cad-cred-inativar">Inativar</button>' +
            '<button class="btn-sm" id="cad-cred-ativar">Reativar</button>' +
          '</div>'
        : '') +
      '<div class="tabela-rolagem" style="margin:0 -14px"><table><thead><tr>' +
      '<th style="width:24px"></th><th>' + (ehMedico ? 'Médico' : 'Fornecedor') + '</th>' +
      (ehMedico ? '<th>CRM</th>' : '<th>Tipo</th>') +
      '<th>CPF / CNPJ</th><th>Forma</th><th>Chave PIX</th><th>Natureza</th>' +
      '<th>Pagamento</th><th></th></tr></thead><tbody>' +
      lista.map(function (c) {
        const f = S.formaDoCredor(c.id);
        const falta = pendenciaDe(c);
        return '<tr class="' + (sel.has(c.id) ? 'sel ' : '') + (c.ativo === false ? 'cancelada' : '') + '">' +
          '<td><input type="checkbox" style="width:auto" data-selc="' + c.id + '"' + (sel.has(c.id) ? ' checked' : '') + '></td>' +
          '<td class="desc">' + U.esc(c.nome) +
            (c.razao_social && c.razao_social !== c.nome ? '<div class="sub">' + U.esc(c.razao_social) + '</div>' : '') + '</td>' +
          (ehMedico ? '<td class="mono">' + U.esc(c.crm || '—') + '</td>'
                    : '<td>' + U.esc(c.tipo || '—') + '</td>') +
          '<td class="mono">' + U.esc(c.documento || '—') + '</td>' +
          '<td>' + U.esc(f ? f.nome : '—') + '</td>' +
          '<td class="desc">' + U.esc(c.pix || '—') +
            (c.tipo_chave ? '<div class="sub">' + U.esc(c.tipo_chave) + '</div>' : '') + '</td>' +
          '<td class="sub">' + U.esc(c.conta_padrao || '—') + '</td>' +
          '<td>' + (falta.length
            ? '<span class="badge b-reprovado">' + U.esc(falta.join(' · ')) + '</span>'
            : '<span class="badge b-pago">pronto p/ remessa</span>') + '</td>' +
          '<td class="acoes"><button class="btn-sm" data-cred="' + c.id + '">Editar</button></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="ajuda">' + (ehMedico
        ? 'Os médicos são criados e atualizados pela importação do fechamento de produtividade, que traz ' +
          'razão social, CRM, CPF/CNPJ e chave PIX. Quem está com "pronto p/ remessa" entra no arquivo do banco.'
        : 'Fornecedor sem forma de pagamento ou sem o dado que a forma exige deixa a parcela travada no ' +
          'contas a pagar. O cadastro rápido do lançamento de NF cai aqui.') + '</div>';
  }

  function editarCredor(id, tipoPadrao) {
    /* Funcionário e médico têm cadastro próprio (DP e Produtividade),
       com aprovação de dados bancários. Editar por aqui trocava o tipo
       pra "médico" e mexia em PIX e banco sem passar pela alçada. */
    const existente = id && D.credor(id);
    if (existente && ['funcionario', 'medico'].indexOf(existente.tipo) > -1) {
      return ERP.app.aviso(existente.tipo === 'funcionario'
        ? 'Este cadastro é de funcionário: edite em Pessoal › Funcionários (dados bancários passam por aprovação).'
        : 'Este cadastro é de médico: edite pela aba Médicos.', 'erro');
    }
    const c = id ? D.credor(id) : null;
    const ehMedico = (c ? c.tipo : tipoPadrao) === 'medico';
    ERP.app.modal({
      titulo: c ? (ehMedico ? 'Médico · ' : 'Fornecedor · ') + c.nome : (ehMedico ? 'Novo médico' : 'Novo fornecedor'),
      corpo:
        '<label>Nome</label><input id="cd-nome" value="' + U.esc(c ? c.nome : '') + '">' +
        '<div class="row2"><div><label>Razão social</label><input id="cd-razao" value="' +
          U.esc(c ? (c.razao_social || '') : '') + '"></div>' +
        '<div><label>CPF / CNPJ</label><input id="cd-doc" inputmode="numeric" value="' +
          U.esc(c ? (c.documento || '') : '') + '"></div></div>' +
        '<div class="row3"><div><label>Tipo</label><select id="cd-tipo">' +
          ['medico', 'fornecedor', 'orgao', 'socio', 'outro'].map(function (t) {
            return '<option value="' + t + '"' + ((c ? c.tipo : tipoPadrao) === t ? ' selected' : '') + '>' + t + '</option>';
          }).join('') + '</select></div>' +
        '<div><label>CRM</label><input id="cd-crm" value="' + U.esc(c ? (c.crm || '') : '') + '"></div>' +
        '<div><label>Natureza padrão</label><select id="cd-conta">' +
          '<option value="">Nenhuma</option>' +
          D.plano.filter(function (p) { return p.nivel === 2 && p.pai !== '1'; }).map(function (p) {
            return '<option value="' + p.cod + '"' + (c && c.conta_padrao === p.cod ? ' selected' : '') + '>' +
              U.esc(p.cod + ' ' + p.nome) + '</option>';
          }).join('') + '</select></div></div>' +
        '<div class="row2"><div><label>Forma de pagamento</label><select id="cd-forma">' +
          '<option value="">Não configurada</option>' +
          Object.keys(D.formasPagamento).map(function (k) {
            return '<option value="' + k + '"' + (c && c.forma_pagamento === k ? ' selected' : '') + '>' +
              U.esc(D.formasPagamento[k].nome) + '</option>';
          }).join('') + '</select></div>' +
        '<div><label>Tipo de chave</label><select id="cd-tipochave">' +
          ['', 'CNPJ', 'CPF', 'Email', 'Telefone', 'Aleatoria'].map(function (t) {
            return '<option value="' + t + '"' + (c && c.tipo_chave === t ? ' selected' : '') + '>' +
              (t || '—') + '</option>';
          }).join('') + '</select></div></div>' +
        '<label>Chave PIX</label><input id="cd-pix" value="' + U.esc(c ? (c.pix || '') : '') + '">' +
        '<div class="row2" style="margin-top:8px">' +
          '<div><label>E-mail</label><input id="cd-email" type="email" placeholder="usado no envio do pedido de compra" value="' +
            U.esc(c ? (c.email || '') : '') + '"></div>' +
          '<div><label>Telefone</label><input id="cd-fone" value="' + U.esc(c ? (c.telefone || '') : '') + '"></div></div>' +
        '<label>Contato</label><input id="cd-contato" placeholder="nome de quem atende" value="' +
          U.esc(c ? (c.contato || '') : '') + '">' +
        '<div class="ajuda">Sem chave, o pagamento por PIX fica travado e o favorecido não entra na remessa.</div>' +
        (c ? '<label style="display:flex;gap:7px;align-items:center;margin-top:10px;font-weight:400">' +
             '<input type="checkbox" id="cd-ativo" style="width:auto"' + (c.ativo !== false ? ' checked' : '') + '> ativo</label>' : ''),
      acoes: [{ txt: c ? 'Salvar' : 'Cadastrar', cls: 'btn-aprovar', fn: function () {
        const nome = U.val('cd-nome');
        if (!nome) return ERP.app.aviso('Informe o nome.', 'erro');
        const doc = U.val('cd-doc').replace(/\D/g, '');
        const outro = D.credores.find(function (x) {
          return x !== c && doc && String(x.documento || '').replace(/\D/g, '') === doc; });
        if (outro) return ERP.app.aviso('Já existe cadastro com este documento: ' + outro.nome, 'erro');
        const dados = {
          nome: nome, razao_social: U.val('cd-razao'), documento: doc,
          tipo: U.val('cd-tipo'), crm: U.val('cd-crm'),
          conta_padrao: U.val('cd-conta') || null,
          forma_pagamento: U.val('cd-forma') || null,
          tipo_chave: U.val('cd-tipochave'), pix: U.val('cd-pix'),
          email: U.val('cd-email'), telefone: U.val('cd-fone'), contato: U.val('cd-contato')
        };
        if (c) {
          Object.keys(dados).forEach(function (k) { c[k] = dados[k]; });
          S.logarCadastro('cadastro', c.id, 'editou cadastro', (c.nome || c.descricao || c.codigo || ''));
          c.ativo = U.el('cd-ativo') ? U.el('cd-ativo').checked : true;
        } else {
          dados.id = S.proximoId('cr');
          dados.ativo = true;
          D.credores.push(dados);
          S.logarCadastro('credor', dados.id, 'cadastrou fornecedor/credor', dados.nome || dados.descricao || dados.codigo || '');
        }
        ERP.app.fecharModal();
        ERP.app.aviso((dados.tipo === 'medico' ? 'Médico' : 'Fornecedor') + ' salvo.', 'ok');
        ERP.lancamento.atualizarCredores();   // já aparece no lançamento
        render();
      } }]
    });
  }

  /* ── clientes ───────────────────────────────────────────*/
  function clientes() {
    return '<div class="ap-acoes"><button class="btn-linha" id="cad-novo-cliente">+ Novo cliente</button></div>' +
      '<div class="tabela-rolagem" style="margin:0 -14px"><table><thead><tr>' +
      '<th>Cliente</th><th>CNPJ</th><th>Projeto</th><th class="num">Prazo</th>' +
      '<th>Retenções</th><th></th></tr></thead><tbody>' +
      D.clientes.map(function (c) {
        const pj = D.centro(c.centro_padrao) || {};
        const pz = S.prazoDe(c.centro_padrao, c.documento);
        return '<tr><td class="desc">' + U.esc(c.nome) + '</td>' +
          '<td class="mono">' + U.esc(c.documento) + '</td>' +
          '<td>' + U.esc(pj.curto || '—') + (pj.unidade ? '<div class="sub">' + U.esc(pj.unidade) + '</div>' : '') + '</td>' +
          '<td class="num">' + pz.dias + 'd<div class="sub">' + pz.origem + '</div></td>' +
          '<td>' + ((c.retencoes || []).length
            ? '<span class="badge b-pago">cadastrada</span><div class="sub">' +
              c.retencoes.map(function (r) { return r.tributo + ' ' + U.num(r.aliquota) + '%'; }).join(' · ') + '</div>'
            : '<span class="badge b-pendente">usa projeto / NF</span>') + '</td>' +
          '<td class="acoes"><button class="btn-sm" data-cli="' + c.id + '">Editar</button></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="ajuda">O cliente decide o projeto de cada nota importada, por CNPJ. Prazo em branco ' +
      'herda o do projeto. Retenção em branco usa o percentual do projeto e, na falta dele, o da NF.</div>';
  }

  function editarCliente(id, aoFechar) {
    const c = id ? D.clientes.find(function (x) { return x.id === id; }) : null;
    const atuais = {};
    ((c && c.retencoes) || []).forEach(function (r) { atuais[r.tributo] = r.aliquota; });
    const porUni = {};
    D.centros.filter(function (x) { return x.ativo; }).forEach(function (x) {
      const u = x.unidade || 'Estruturais';
      (porUni[u] = porUni[u] || []).push(x);
    });
    ERP.app.modal({
      titulo: c ? 'Cliente · ' + c.nome : 'Novo cliente',
      corpo:
        '<label>Razão social</label><input id="cl-nome" value="' + U.esc(c ? c.nome : '') + '">' +
        /* Endereço e IBGE não são enfeite: sem eles a prefeitura recusa
           o RPS, e a nota não sai. */
        '<div class="row3">' +
          '<div><label>Endereço</label><input id="cl-end" value="' + U.esc(c ? c.endereco || '' : '') + '"></div>' +
          '<div><label>Número</label><input id="cl-num" value="' + U.esc(c ? c.numero || '' : '') + '"></div>' +
          '<div><label>Complemento</label><input id="cl-compl" value="' + U.esc(c ? c.complemento || '' : '') + '"></div>' +
        '</div>' +
        '<div class="row3">' +
          '<div><label>Bairro</label><input id="cl-bairro" value="' + U.esc(c ? c.bairro || '' : '') + '"></div>' +
          '<div><label>Cidade</label><input id="cl-cidade" value="' + U.esc(c ? c.cidade || '' : '') + '"></div>' +
          '<div><label>UF</label><input id="cl-uf" maxlength="2" value="' + U.esc(c ? c.uf || '' : '') + '"></div>' +
        '</div>' +
        '<div class="row3">' +
          '<div><label>CEP</label><input id="cl-cep" inputmode="numeric" value="' + U.esc(c ? c.cep || '' : '') + '"></div>' +
          '<div><label>Código IBGE da cidade</label><input id="cl-ibge" inputmode="numeric" value="' +
            U.esc(c ? c.codigo_ibge || '' : '') + '"></div>' +
          '<div><label>E-mail (NF-e)</label><input id="cl-email" value="' + U.esc(c ? c.email || '' : '') + '"></div>' +
        '</div>' +
        '<div class="row2"><div><label>CNPJ / CPF</label><input id="cl-doc" inputmode="numeric" value="' +
          U.esc(c ? c.documento : '') + '"></div>' +
        '<div><label>Prazo (dias)</label><input id="cl-prazo" type="number" min="0" max="365" value="' +
          (c && c.prazo_dias ? c.prazo_dias : '') + '" placeholder="herda do projeto"></div></div>' +
        '<label>Projeto</label><select id="cl-centro"><option value="">Nenhum</option>' +
          Object.keys(porUni).sort().map(function (u) {
            return '<optgroup label="' + U.esc(u) + '">' + porUni[u].map(function (x) {
              return '<option value="' + x.id + '"' + (c && c.centro_padrao === x.id ? ' selected' : '') + '>' +
                U.esc(x.curto || x.nome) + '</option>';
            }).join('') + '</optgroup>';
          }).join('') + '</select>' +
        '<h2 style="font-size:12px;margin:14px 0 6px">Retenções na fonte (% sobre o bruto)</h2>' +
        '<div class="row3">' + TRIB.map(function (t) {
          return '<div><label>' + t + '</label><input id="cl-' + t + '" class="num" inputmode="decimal" value="' +
            U.num(atuais[t] || 0) + '"></div>';
        }).join('') + '</div>',
      acoes: [{ txt: c ? 'Salvar' : 'Cadastrar', cls: 'btn-aprovar', fn: function () {
        const nome = U.val('cl-nome'), doc = U.val('cl-doc').replace(/\D/g, '');
        if (!nome) return ERP.app.aviso('Informe a razão social.', 'erro');
        if (doc.length !== 14 && doc.length !== 11) return ERP.app.aviso('CNPJ ou CPF inválido.', 'erro');
        const outro = D.clientes.find(function (x) {
          return x !== c && String(x.documento).replace(/\D/g, '') === doc; });
        if (outro) return ERP.app.aviso('Já existe cliente com este CNPJ: ' + outro.nome, 'erro');
        const retencoes = TRIB.map(function (t) {
          return { tributo: t, aliquota: U.parseValor(U.val('cl-' + t)) };
        }).filter(function (r) { return r.aliquota > 0; });
        const dados = {
          nome: nome, documento: doc, centro_padrao: U.val('cl-centro') || null,
          endereco: U.val('cl-end'), numero: U.val('cl-num'), complemento: U.val('cl-compl'),
          bairro: U.val('cl-bairro'), cidade: U.val('cl-cidade'), uf: U.val('cl-uf').toUpperCase(),
          cep: U.val('cl-cep').replace(/\D/g, ''), codigo_ibge: U.val('cl-ibge').replace(/\D/g, ''),
          email: U.val('cl-email'),
          /* marcar o projeto aqui grava o vínculo no projeto; os outros
             projetos do mesmo cliente continuam como estão */
          prazo_dias: parseInt(U.val('cl-prazo'), 10) || null, retencoes: retencoes
        };
        if (c) Object.keys(dados).forEach(function (k) { c[k] = dados[k]; });
        else {
          dados.id = S.proximoId('cl');
          D.clientes.push(dados);
          S.logarCadastro('cliente', dados.id, 'cadastrou cliente', dados.nome || dados.descricao || dados.codigo || '');
        }
        /* O vínculo mora NO PROJETO. Gravar só o "projeto padrão" no
           cliente não ligava nada: o projeto continuava sem dono, e
           trocar o padrão parecia desligar o anterior. Aqui o projeto
           escolhido passa a apontar para este cliente — e, se ele já
           era de outro, a troca é confirmada em vez de silenciosa. */
        const idCli = c ? c.id : dados.id;
        const pjEscolhido = U.val('cl-centro');
        if (pjEscolhido) {
          const pj = D.centro(pjEscolhido);
          const donoAtual = D.clienteDoCentro(pjEscolhido);
          if (pj && donoAtual && donoAtual.id !== idCli) {
            if (!confirm('O projeto ' + (pj.curto || pj.nome) + ' está ligado a ' + donoAtual.nome +
                '.\n\nPassar para ' + (dados.nome || '') + '?')) return;
          }
          if (pj) pj.cliente = idCli;
        }
        ERP.app.fecharModal();
        ERP.app.aviso(pjEscolhido
          ? 'Cliente salvo e ligado ao projeto ' + ((D.centro(pjEscolhido) || {}).curto || '') + '.'
          : 'Cliente salvo.', 'ok');
        if (aoFechar) aoFechar(c ? c.id : dados.id);
        else render();
      } }]
    });
  }

  function ligar() {
    const box = U.el('cad-saida');
    box.querySelectorAll('[data-proj]').forEach(function (b) {
      b.addEventListener('click', function () { editarProjeto(this.dataset.proj); });
    });
    box.querySelectorAll('[data-cli]').forEach(function (b) {
      b.addEventListener('click', function () { editarCliente(this.dataset.cli); });
    });
    box.querySelectorAll('[data-sel]').forEach(function (chk) {
      chk.addEventListener('change', function () {
        this.checked ? sel.add(this.dataset.sel) : sel.delete(this.dataset.sel);
        render();
      });
    });
    if (U.el('cad-chk-todos')) {
      U.el('cad-chk-todos').addEventListener('change', function () {
        sel.clear();
        if (this.checked) {
          D.centros.filter(function (c) { return c.tipo === 'projeto' && (verInativos || c.ativo); })
            .forEach(function (c) { sel.add(c.id); });
        }
        render();
      });
    }
    if (U.el('cad-novo-projeto')) U.el('cad-novo-projeto').addEventListener('click', function () { editarProjeto(null); });
    if (U.el('cad-novo-cliente')) U.el('cad-novo-cliente').addEventListener('click', function () { editarCliente(null); });
    /* Definir a empresa de vários projetos de uma vez: são dezenas a
       classificar, e um a um seria trabalho à toa. */
    const aplicarEmp = U.el('cad-aplicar-empresa');
    if (aplicarEmp) aplicarEmp.addEventListener('click', function () {
      const emp = U.val('cad-empresa-lote');
      if (!emp) return ERP.app.aviso('Escolha a empresa do contrato.', 'erro');
      let n = 0;
      D.centros.forEach(function (c) {
        if (!sel.has(c.id)) return;
        c.empresa = emp;
        n++;
      });
      S.logarCadastro('cadastro', 'lote', 'definiu empresa do contrato',
        n + ' projeto(s) → ' + ((D.empresaPor(emp) || {}).apelido || emp));
      sel.clear();
      render();
      ERP.app.aviso(n + ' projeto(s) agora pertencem à ' +
        ((D.empresaPor(emp) || {}).apelido || emp) + '.', 'ok');
    });

    if (U.el('cad-sel-todos')) {
      U.el('cad-sel-todos').addEventListener('click', function () {
        D.centros.filter(function (c) { return c.tipo === 'projeto' && (verInativos || c.ativo); })
          .forEach(function (c) { sel.add(c.id); });
        render();
      });
      U.el('cad-sel-nada').addEventListener('click', function () { sel.clear(); render(); });
    }
    /* "Mostrar inativos" existe em Projetos, Produtos, Fornecedores e
       Armazéns, mas o clique só era ligado dentro do bloco de projetos
       (que tem seleção em massa) — nas outras abas o botão não fazia
       nada e não havia como ver ou reativar um item inativo. */
    document.querySelectorAll('[data-at-hist]').forEach(function (b) {
      b.addEventListener('click', function () { historicoAtestado(this.dataset.atHist); });
    });
    document.querySelectorAll('[data-at-reg]').forEach(function (b) {
      b.addEventListener('click', function () { registrarAtestado(this.dataset.atReg); });
    });
    if (U.el('cad-ver-inativos')) {
      U.el('cad-ver-inativos').addEventListener('click', function () { verInativos = !verInativos; render(); });
    }
    if (U.el('cad-so-pendentes')) {
      U.el('cad-so-pendentes').addEventListener('click', function () { soPendentes = !soPendentes; render(); });
    }
    box.querySelectorAll('[data-prod]').forEach(function (b) {
      b.addEventListener('click', function () { editarProduto(this.dataset.prod); });
    });
    box.querySelectorAll('[data-arm]').forEach(function (b) {
      b.addEventListener('click', function () { editarArmazem(this.dataset.arm); });
    });
    box.querySelectorAll('[data-selp]').forEach(function (chk) {
      chk.addEventListener('change', function () {
        this.checked ? sel.add(this.dataset.selp) : sel.delete(this.dataset.selp);
        render();
      });
    });
    if (U.el('cad-novo-produto')) {
      U.el('cad-novo-produto').addEventListener('click', function () { editarProduto(null); });
      U.el('cad-prod-todos').addEventListener('click', function () {
        D.produtos.filter(function (p) { return verInativos || p.ativo; })
          .forEach(function (p) { sel.add(p.id); });
        render();
      });
      U.el('cad-prod-nada').addEventListener('click', function () { sel.clear(); render(); });
    }
    ['inativar', 'ativar'].forEach(function (a) {
      if (U.el('cad-prod-' + a)) U.el('cad-prod-' + a).addEventListener('click', function () {
        let n = 0;
        Array.from(sel).forEach(function (id) {
          const p = D.produtos.find(function (x) { return x.id === id; });
          if (p) { p.ativo = (a === 'ativar'); n++; }
        });
        sel.clear(); render();
        ERP.app.aviso(n + ' produto(s) ' + (a === 'ativar' ? 'reativado(s)' : 'inativado(s)') + '.', 'ok');
      });
    });
    if (U.el('cad-novo-armazem')) U.el('cad-novo-armazem').addEventListener('click', function () { editarArmazem(null); });
    box.querySelectorAll('[data-uni]').forEach(function (b) {
      b.addEventListener('click', function () { editarUnidade(this.dataset.uni); });
    });
    box.querySelectorAll('[data-cred]').forEach(function (b) {
      b.addEventListener('click', function () { editarCredor(this.dataset.cred); });
    });
    box.querySelectorAll('[data-selc]').forEach(function (chk) {
      chk.addEventListener('change', function () {
        this.checked ? sel.add(this.dataset.selc) : sel.delete(this.dataset.selc);
        render();
      });
    });
    if (U.el('cad-nova-unidade')) U.el('cad-nova-unidade').addEventListener('click', function () { editarUnidade(null); });
    if (U.el('cad-novo-credor')) {
      U.el('cad-novo-credor').addEventListener('click', function () {
        editarCredor(null, aba === 'medicos' ? 'medico' : 'fornecedor');
      });
      U.el('cad-cred-todos').addEventListener('click', function () {
        D.credores.filter(function (x) {
          return (aba === 'medicos' ? x.tipo === 'medico' : x.tipo !== 'medico') && (verInativos || x.ativo !== false);
        }).forEach(function (x) { sel.add(x.id); });
        render();
      });
      U.el('cad-cred-nada').addEventListener('click', function () { sel.clear(); render(); });
    }
    ['inativar', 'ativar'].forEach(function (a) {
      if (U.el('cad-cred-' + a)) U.el('cad-cred-' + a).addEventListener('click', function () {
        let n = 0;
        Array.from(sel).forEach(function (id) {
          const cr = D.credor(id);
          if (cr) { cr.ativo = (a === 'ativar'); n++; }
        });
        sel.clear();
        render();
        ERP.app.aviso(n + ' cadastro(s) ' + (a === 'ativar' ? 'reativado(s)' : 'inativado(s)') + '.', 'ok');
      });
    });
    ['inativar', 'ativar', 'excluir'].forEach(function (a) {
      if (U.el('cad-' + a)) U.el('cad-' + a).addEventListener('click', function () { emMassa(a); });
    });
  }

  return { montar: montar, render: render, editarCliente: editarCliente,
           editarProjeto: editarProjeto, editarCredor: editarCredor,
           editarProduto: editarProduto, editarArmazem: editarArmazem };
})();
