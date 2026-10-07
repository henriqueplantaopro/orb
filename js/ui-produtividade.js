/* ERP · ui-produtividade.js — importação do fechamento do PegaPlantão.
   Lê a aba PRODUTIVIDADE (projeto, período, plantões por médico) e a aba
   FINANCEIRO (razão social, documento, chave PIX), agrupa por médico +
   setor + tipo e gera as contas a pagar em lote.
   Entrada e saída de cada plantão são descartadas de propósito: o que
   entra no financeiro é a soma por setor e tipo. */
window.ERP = window.ERP || {};

ERP.produtividade = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;
  let lote = null;   // resultado da leitura
  let loteAberto = null;
  let fLote = {};   // filtros da aba de lançamentos
  let soFicaramParaTras = false;   // aba Pendentes: só quem ficou de fora de fechamento já pago   // id do lote (já lançado) aberto no detalhe

  function montar() {
    U.el('pr-arquivo').addEventListener('change', abrir);
    document.querySelectorAll('#pr-nav button').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('#pr-nav button').forEach(function (x) {
          x.setAttribute('aria-pressed', x === b);
        });
        U.el('pr-aba-importar').style.display = b.dataset.praba === 'importar' ? '' : 'none';
        U.el('pr-aba-lotes').style.display = b.dataset.praba === 'lotes' ? '' : 'none';
        U.el('pr-aba-cobertura').style.display = b.dataset.praba === 'cobertura' ? '' : 'none';
        U.el('pr-aba-pendentes').style.display = b.dataset.praba === 'pendentes' ? '' : 'none';
        if (b.dataset.praba === 'pendentes') renderPendentes();
        if (b.dataset.praba === 'lotes') { loteAberto = null; renderLotes(); }
        if (b.dataset.praba === 'cobertura') renderCobertura();
      });
    });
    atualizarAlerta();
  }

  /* Contador na aba "Cobertura" — só liga a partir do dia 11, olhando
     pra competência do mês anterior. É pra lembrar sozinho do que
     ainda falta chegar, sem precisar abrir a aba pra descobrir. */
  function atualizarAlerta() {
    const p = S.produtividadePendente();
    const el = U.el('pr-alerta');
    if (!el) return;
    if (p.faltando.length) {
      el.textContent = p.faltando.length;
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  }

  /* ── cobertura por projeto ───────────────────────────────
     Todo projeto marcado como produtividade, cruzado com os lotes já
     lançados numa competência — pra saber quem ainda não mandou o
     arquivo, sem precisar caçar um por um. */
  function renderCobertura() {
    const pend = S.produtividadePendente();
    const compPadrao = pend.competencia || U.mesAtual();
    if (!U.el('pr-cob-comp')) {
      U.el('pr-aba-cobertura').innerHTML =
        '<div class="ajuda" style="margin-bottom:10px">Todo projeto marcado como produtividade, e se já tem ' +
        'ou não tem lote lançado naquela competência. O contador na aba só liga a partir do dia 11, olhando ' +
        'pra competência do mês anterior — antes disso o arquivo pode simplesmente ainda não ter chegado.</div>' +
        '<div class="f" style="max-width:220px"><label for="pr-cob-comp">Competência</label>' +
        '<input type="month" id="pr-cob-comp" value="' + compPadrao + '"></div>' +
        '<div id="pr-cob-tabela"></div>';
      U.el('pr-cob-comp').addEventListener('change', desenharCobertura);
    }
    desenharCobertura();
  }

  function ligarCobertura() {
    const b2 = U.el('pr-cob-todos');
    if (b2) {
      b2.addEventListener('click', function () {
        cobTodos = !cobTodos;
        desenharCobertura();
      });
    }
  }

  /* A cobertura abre com TODOS os projetos. Quem olha esta tela
     quer saber o que falta — e o que falta pode ser justamente um
     projeto que ninguém marcou como de produtividade. Filtrar por
     padrão esconde exatamente o caso que a tela existe para
     encontrar. */
  let cobTodos = true;

  function desenharCobertura() {
    const comp = U.val('pr-cob-comp');
    const linhas = S.coberturaProdutividade(comp, cobTodos);
    /* Falta = esperado e não lançado. Projeto de locação não entra
       na conta, senão o número "faltando" assusta sem motivo. */
    const faltando = linhas.filter(function (x) { return x.esperado && !x.lote; }).length;
    const extras = linhas.filter(function (x) { return !x.esperado && x.lote; }).length;
    U.el('pr-cob-tabela').innerHTML =
      '<div class="filtros" style="margin:6px 0">' +
        '<button class="btn-sm" id="pr-cob-todos">' +
          (cobTodos ? 'Ver só os com produtividade' : 'Ver TODOS os projetos') + '</button>' +
      '</div>' +
      '<div class="ajuda" style="margin:6px 0">' + linhas.length + ' projeto(s)' +
      (cobTodos ? ' (todos os ativos)' : ' com produtividade') + ' — ' +
      (faltando ? '<b>' + faltando + ' sem produtividade lançada</b> nesta competência.'
                : 'todos os esperados já lançados nesta competência.') +
      (extras ? ' ' + extras + ' projeto(s) lançaram sem estar marcados como de produtividade — ' +
        'vale conferir a marcação no cadastro.' : '') + '</div>' +
      /* A autorização do órgão fica AQUI, ao lado do fechamento: quem
         lança a produtividade é quem fala com o hospital e recebe o
         ofício. Antes só existia na esteira do faturamento, que é a
         tela de outra pessoa. */
      /* A etapa do faturamento aparece aqui só como INFORMAÇÃO — a
         ação (autorização do órgão) mora no módulo Faturamento, que é
         de quem cuida disso. Voltar à produtividade pra tratar
         faturamento não faz sentido. */
      '<table><thead><tr><th>Projeto</th><th>Unidade</th><th>Situação</th>' +
      '<th class="num">Médicos</th><th class="num">Valor</th>' +
      '<th>Faturamento</th></tr></thead><tbody>' +
      linhas.map(function (x) {
        const c = D.centro(x.centro) || {};
        /* Vermelho só no que é falta de verdade: esperado e não
           lançado. Pintar projeto de locação de vermelho faria a
           tela parecer cheia de problema todo mês. */
        return '<tr' + (x.esperado && !x.lote ? ' style="background:#fff4f2"' : '') + '>' +
          '<td class="desc">' + U.esc(c.curto || c.nome) + '</td>' +
          '<td class="sub">' + U.esc(c.unidade || '—') + '</td>' +
          '<td>' + (x.lote
            ? '<span class="badge b-pago">lançado</span>' +
              (x.qtd_lotes > 1 ? ' <span class="sub">' + x.qtd_lotes + ' fechamentos</span>' : '')
            : x.esperado
              ? '<span class="badge b-reprovado">sem produtividade</span>'
              : '<span class="badge b-aguardando">não tem produtividade</span>') + '</td>' +
          '<td class="num">' + (x.lote ? x.medicos : '—') + '</td>' +
          '<td class="num">' + (x.lote ? U.brl(x.valor) : '—') + '</td>' +
          '<td>' + etapaFat(x.centro, comp) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="ajuda">A autorização do órgão e a liberação para emitir a NF ficam em ' +
        '<b>Faturamento › Esteira</b>.</div>';
    ligarCobertura();
  }

  const ETAPA_TXT = {
    previsao: { t: 'sem valor confirmado', c: 'sit-cancelado' },
    confirmado: { t: 'aguardando autorização do órgão', c: 'sit-parcial' },
    autorizado: { t: 'autorizado — aguardando liberação', c: 'sit-parcial' },
    liberado: { t: 'liberado para emissão de NF', c: 'sit-pago' },
    faturado: { t: 'faturado', c: 'sit-pago' }
  };

  function etapaFat(centro, comp) {
    const linha = S.esteiraFaturamento({ centro: centro, competencia: comp })[0];
    const e = ETAPA_TXT[(linha || {}).etapa || 'previsao'];
    return '<span class="badge ' + e.c + '">' + e.t + '</span>' +
      (linha && linha.protocolo ? '<div class="sub">' + U.esc(linha.protocolo) + '</div>' : '');
  }

  /* ── lotes já lançados ───────────────────────────────────
     Cada importação vira um cartão: projeto, competência, quantos
     médicos e quanto somou. Clicar abre o detalhe por médico — mesma
     composição por setor/tipo que já existe no contas a pagar, só que
     aqui reunida pelo lote inteiro, não por título avulso. */
  /* Situação do repasse ao médico, em três níveis (o gestor quer ver de
     relance quem ainda não recebeu): lançado, pago em parte, pago. */
  /* Qual bloqueio pega esta parcela. O bloqueio é lançado por
     MÉDICO no fechamento, e a parcela é do médico — mas a situação
     só olhava o pagamento, então quem foi bloqueado aparecia como
     "lançado", igual a quem vai receber. É o oposto do que a tela
     precisa mostrar: o bloqueado é justamente o que exige
     decisão. */
  function bloqueioDa(p, l) {
    if (!l || !l.bloqueios) return null;
    const nome = (ERP.lancamento.nomeCredor(p.credor) || '').trim().toLowerCase();
    return l.bloqueios.find(function (b) {
      if (b.liberado_em) return null;
      return (b.credor && b.credor === p.credor) ||
        String(b.medico || '').trim().toLowerCase() === nome;
    }) || null;
  }

  function situacaoParcela(p, l) {
    if (p.status === 'cancelado') return { cls: 'sit-cancelado', txt: 'cancelado' };
    const bl = bloqueioDa(p, l);
    if (bl) {
      return { cls: 'sit-bloqueado', txt: 'bloqueado', bloqueio: bl,
        motivo: bl.motivo || '' };
    }
    const pago = S.pagoDe(p.id);
    if (p.status === 'pago' || S.saldoDe(p) <= 0.004) return { cls: 'sit-pago', txt: 'pago' };
    if (pago > 0.004) return { cls: 'sit-parcial', txt: 'pago em parte' };
    return { cls: 'sit-lancado', txt: 'lançado' };
  }
  function situacaoLote(l) {
    if (l.cancelado) return { cls: 'sit-cancelado', txt: 'cancelado' };
    const ps = S.todasParcelas().filter(function (p) { return l.titulo_ids.indexOf(p.titulo_id) > -1 && p.status !== 'cancelado'; });
    if (!ps.length) return { cls: 'sit-cancelado', txt: 'sem títulos' };
    const pagos = ps.filter(function (p) { return S.saldoDe(p) <= 0.004; }).length;
    const comAlgum = ps.filter(function (p) { return S.pagoDe(p.id) > 0.004; }).length;
    if (pagos === ps.length) return { cls: 'sit-pago', txt: 'pago' };
    if (comAlgum > 0) return { cls: 'sit-parcial', txt: 'pago em parte (' + pagos + '/' + ps.length + ')' };
    return { cls: 'sit-lancado', txt: 'lançado' };
  }

  /* Quem ainda não recebeu a produtividade. O filtro que interessa de
     verdade: médicos que ficaram de fora de um fechamento onde os
     colegas JÁ receberam — normalmente é cadastro incompleto ou uma
     remessa que saiu sem eles. */
  function renderPendentes() {
    const lotes = S.lotesProdutividade().filter(function (l) { return !l.cancelado; });
    const linhas = [];
    lotes.forEach(function (l) {
      const ps = S.todasParcelas().filter(function (p) { return l.titulo_ids.indexOf(p.titulo_id) > -1 && p.status !== 'cancelado'; });
      const loteTevePagamento = ps.some(function (p) { return S.pagoDe(p.id) > 0.004; });
      ps.forEach(function (p) {
        const saldo = S.saldoDe(p);
        if (saldo <= 0.004) return;
        const cred = D.credor(p.credor) || {};
        const forma = S.formaDoCredor(p.credor);
        const trava = [];
        if (!cred.documento) trava.push('sem CPF/CNPJ');
        if (!forma) trava.push('sem forma de pagamento');
        else if (forma.codigo === 'pix' && !cred.pix) trava.push('sem chave PIX');
        if (p.aprovacao === 'pendente') trava.push('aguardando aprovação');
        linhas.push({ p: p, lote: l, saldo: saldo, pago: S.pagoDe(p.id), loteTevePagamento: loteTevePagamento, trava: trava });
      });
    });
    linhas.sort(function (a, b) {
      return (b.loteTevePagamento ? 1 : 0) - (a.loteTevePagamento ? 1 : 0) ||
        a.lote.competencia.localeCompare(b.lote.competencia) || b.saldo - a.saldo;
    });
    const mostrar = soFicaramParaTras ? linhas.filter(function (x) { return x.loteTevePagamento; }) : linhas;
    const total = Math.round(mostrar.reduce(function (a, x) { return a + x.saldo; }, 0) * 100) / 100;

    U.el('pr-aba-pendentes').innerHTML =
      '<h2>Médicos sem pagamento de produtividade<span class="sub">repasse lançado com saldo em aberto</span></h2>' +
      '<div class="ap-acoes">' +
        '<button class="btn-sm' + (soFicaramParaTras ? ' btn-aprovar' : '') + '" id="pp-so-atras">' +
          (soFicaramParaTras ? 'Ver todos os pendentes' : 'Só quem ficou para trás em fechamento já pago (' +
            linhas.filter(function (x) { return x.loteTevePagamento; }).length + ')') + '</button>' +
      '</div>' +
      '<div class="ajuda">' + mostrar.length + ' médico(s) · ' + U.brl(total) + ' em aberto</div>' +
      (mostrar.length
        ? '<table><thead><tr><th>Médico</th><th>Projeto</th><th>Competência</th><th class="num">Valor</th>' +
          '<th class="num">Pago</th><th class="num">Falta</th><th>Situação</th><th>Trava</th><th></th></tr></thead><tbody>' +
          mostrar.map(function (x) {
            const c = D.centro(x.lote.centro) || {};
            const s = situacaoParcela(x.p);
            return '<tr><td class="desc">' + U.esc(ERP.lancamento.nomeCredor(x.p.credor) || '—') + '</td>' +
              '<td class="desc">' + U.esc(c.curto || c.nome || '—') + '</td>' +
              '<td class="mono">' + U.fComp(x.lote.competencia) + '</td>' +
              '<td class="num">' + U.brl(x.p.valor) + '</td>' +
              '<td class="num">' + (x.pago > 0.004 ? U.brl(x.pago) : '—') + '</td>' +
              '<td class="num">' + U.brl(x.saldo) + '</td>' +
              '<td><span class="badge ' + s.cls + '">' + s.txt + '</span>' +
                (x.loteTevePagamento ? '<div class="sub">colegas do mesmo fechamento já receberam</div>' : '') + '</td>' +
              '<td class="sub">' + (x.trava.length ? U.esc(x.trava.join(' · ')) : '—') + '</td>' +
              '<td class="acoes"><button class="btn-sm" data-lp-medico="' + x.p.id + '">Plantões</button></td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="vazio"><strong>Ninguém pendente.</strong>Toda produtividade lançada já foi paga.</div>');
    document.querySelectorAll('#pr-aba-pendentes [data-lp-medico]').forEach(function (b) {
      b.addEventListener('click', function () { detalheMedico(this.dataset.lpMedico); });
    });
    if (U.el('pp-so-atras')) U.el('pp-so-atras').addEventListener('click', function () { soFicaramParaTras = !soFicaramParaTras; renderPendentes(); });
  }

  function renderLotes() {
    const todos = S.lotesProdutividade();
    /* Com 40 lançamentos por mês, em meio ano a tela vira uma lista
       ingovernável — daí os filtros por competência, projeto, data de
       importação e situação. */
    const comps = todos.map(function (l) { return l.competencia; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; }).sort().reverse();
    const projs = todos.map(function (l) { return l.centro; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; })
      .map(function (id) { return D.centro(id) || { id: id, curto: id }; })
      .sort(function (a, b) { return String(a.curto || a.nome).localeCompare(String(b.curto || b.nome)); });

    const lotes = todos.filter(function (l) {
      if (fLote.comp && l.competencia !== fLote.comp) return false;
      if (fLote.centro && l.centro !== fLote.centro) return false;
      const dataImp = U.dataLocal(l.criado_em);
      if (fLote.de && dataImp < fLote.de) return false;
      if (fLote.ate && dataImp > fLote.ate) return false;
      if (fLote.sit) {
        const s = situacaoLote(l);
        if (fLote.sit === 'pendente' && s.cls === 'sit-pago') return false;
        if (fLote.sit !== 'pendente' && s.cls !== 'sit-' + fLote.sit) return false;
      }
      if (fLote.busca) {
        const c = D.centro(l.centro) || {};
        const alvo = ((c.curto || '') + ' ' + (c.nome || '') + ' ' + (l.criado_por || '') + ' ' + l.competencia).toLowerCase();
        if (alvo.indexOf(fLote.busca.toLowerCase()) < 0) return false;
      }
      return true;
    });
    const totalValor = Math.round(lotes.reduce(function (a, l) { return a + l.valor; }, 0) * 100) / 100;

    U.el('pr-aba-lotes').innerHTML =
      '<div class="filtros">' +
        '<div class="f"><label for="lp-f-comp">Competência</label><select id="lp-f-comp"><option value="">Todas</option>' +
          comps.map(function (c) { return '<option value="' + c + '"' + (fLote.comp === c ? ' selected' : '') + '>' + U.fComp(c) + '</option>'; }).join('') + '</select></div>' +
        '<div class="f"><label for="lp-f-proj">Projeto</label><select id="lp-f-proj"><option value="">Todos</option>' +
          projs.map(function (c) { return '<option value="' + c.id + '"' + (fLote.centro === c.id ? ' selected' : '') + '>' + U.esc(c.curto || c.nome) + '</option>'; }).join('') + '</select></div>' +
        '<div class="f"><label for="lp-f-de">Importado de</label><input type="date" id="lp-f-de" value="' + (fLote.de || '') + '"></div>' +
        '<div class="f"><label for="lp-f-ate">até</label><input type="date" id="lp-f-ate" value="' + (fLote.ate || '') + '"></div>' +
        '<div class="f"><label for="lp-f-sit">Situação</label><select id="lp-f-sit">' +
          [['', 'Todas'], ['lancado', 'Lançado'], ['parcial', 'Pago em parte'], ['pago', 'Pago'], ['pendente', 'Falta pagar (lançado + parcial)']]
            .map(function (o) { return '<option value="' + o[0] + '"' + (fLote.sit === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
        '<div class="f"><label for="lp-f-busca">Buscar</label><input id="lp-f-busca" placeholder="projeto, quem importou…" value="' + U.esc(fLote.busca || '') + '"></div>' +
        '<button class="btn-sm" id="lp-f-limpar" style="align-self:flex-end">Limpar</button>' +
      '</div>' +
      '<div class="ajuda">' + lotes.length + ' de ' + todos.length + ' lançamento(s) · ' + U.brl(totalValor) + '</div>' +
      (lotes.length ? '<table><thead><tr><th>Importado em</th><th>Projeto</th><th>Competência</th>' +
        '<th class="num">Médicos</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead><tbody>' +
        lotes.map(function (l) {
          const c = D.centro(l.centro) || {};
          const s = situacaoLote(l);
          return '<tr><td class="mono">' + U.fData(U.dataLocal(l.criado_em)) +
            '<div class="sub">' + U.esc(l.criado_por) + '</div></td>' +
            '<td class="desc">' + U.esc(c.curto || c.nome || '—') + '</td>' +
            '<td class="mono">' + U.fComp(l.competencia) + '</td>' +
            '<td class="num">' + l.medicos + '</td>' +
            '<td class="num">' + U.brl(l.valor) + '</td>' +
            /* A CONFIRMAÇÃO da produtividade é o que destrava o
               pagamento: enquanto não vem, o valor é número de
               trabalho e o financeiro não paga. A função existia no
               sistema e não tinha tela nenhuma — quem precisava
               confirmar não tinha onde. */
            '<td><span class="badge ' + s.cls + '">' + s.txt +
              (l.cancelado_parcial && !l.cancelado ? ' · cancelado em parte' : '') + '</span>' +
              (!l.cancelado
                ? (l.confirmado_em
                    ? '<div class="sub" title="' + U.esc(l.confirmado_por || '') + '">✓ confirmada em ' +
                      U.fData(U.dataLocal(l.confirmado_em)) + '</div>'
                    : '<div class="sub" style="color:var(--amber,#8a6d00)">aguardando confirmação</div>')
                : '') + '</td>' +
            '<td class="acoes"><button class="btn-sm" data-lp-ver="' + l.id + '">' +
              (loteAberto === l.id ? 'Fechar' : 'Ver detalhe') + '</button>' +
              (!l.cancelado && !l.confirmado_em && S.pode('confirmar_produtividade')
                ? '<button class="btn-sm btn-aprovar" data-lp-confirmar="' + l.id + '">' +
                  'Confirmar fechamento</button>' : '') +
              (!l.cancelado ? '<button class="btn-sm" data-lp-fat="' + l.id + '">Valor a faturar</button>' +
                '<button class="btn-sm btn-cancelar" data-lp-cancelar="' + l.id + '">Cancelar</button>' : '') +
              '</td></tr>' +
            (loteAberto === l.id ? detalheLote(l) : '');
        }).join('') + '</tbody></table>'
        : '<div class="vazio"><strong>Nenhum lançamento com esses filtros.</strong>Limpe os filtros para ver todos.</div>');
    ligarLotes();
  }

  /* Detalhe do lote: o que importa é médico, plantões, horas, valor e
     principalmente a situação. Cliente, projeto e setor saíram daqui —
     projeto e competência já estão na linha do lote, e o setor abre no
     detalhe do médico (botão "Plantões"). */
  function detalheLote(l) {
    const parcelas = S.todasParcelas().filter(function (p) { return l.titulo_ids.indexOf(p.titulo_id) > -1; });
    return '<tr><td colspan="7" style="background:#fafbfc;padding:10px 8px">' +
      '<table style="margin:0"><thead><tr><th>Médico</th>' +
      '<th class="num">Plantões</th><th class="num">Horas</th><th class="num">Valor</th>' +
      '<th class="num">Pago</th><th>Situação</th><th></th></tr></thead><tbody>' +
      parcelas.map(function (p) {
        const itens = p.itens || [];
        const qtd = itens.reduce(function (s, i) { return s + (i.qtd || 0); }, 0);
        const min = itens.reduce(function (s, i) { return s + (i.minutos || 0); }, 0);
        const s = situacaoParcela(p, l);
        const pago = S.pagoDe(p.id);
        return '<tr><td class="desc">' + U.esc(ERP.lancamento.nomeCredor(p.credor) || '—') + '</td>' +
          '<td class="num">' + qtd + '</td>' +
          '<td class="num">' + Math.floor(min / 60) + 'h' + String(min % 60).padStart(2, '0') + '</td>' +
          '<td class="num">' + U.brl(p.valor) + '</td>' +
          '<td class="num">' + (pago > 0.004 ? U.brl(pago) : '—') + '</td>' +
          '<td><span class="badge ' + s.cls + '">' + s.txt + '</span>' +
            (s.motivo ? '<div class="sub">' + U.esc(s.motivo) + '</div>' : '') + '</td>' +
          '<td class="acoes"><button class="btn-sm" data-lp-medico="' + p.id + '">Plantões</button>' +
            /* DESBLOQUEAR AQUI. Quem confere o fechamento é quem
               descobre que o bloqueio já não se aplica — mandar
               procurar a tela onde o bloqueio foi posto significa,
               na prática, o médico esperando mais um dia. */
            (s.bloqueio && S.podeMover('produtividade')
              ? ' <button class="btn-sm btn-aprovar" data-lp-liberar="' + p.id + '" ' +
                'data-lote="' + l.id + '">Liberar</button>'
              : '') +
          '</td></tr>';
      }).join('') + '</tbody></table></td></tr>';
  }

  /* Drill-down do médico: o que ele fez naquele fechamento, por setor e
     tipo de plantão, e como está o pagamento. */
  function detalheMedico(parcelaId) {
    const p = S.parcela(parcelaId);
    if (!p) return;
    const itens = p.itens || [];
    const pagos = S.pagamentosDe ? S.pagamentosDe(parcelaId) : [];
    const s = situacaoParcela(p);
    ERP.app.modal({
      titulo: (ERP.lancamento.nomeCredor(p.credor) || 'Médico') + ' · ' + U.fComp(p.comp),
      corpo:
        '<div class="resumo-linha"><span>Situação</span><span class="v"><span class="badge ' + s.cls + '">' + s.txt + '</span></span></div>' +
        '<div class="resumo-linha"><span>Valor do repasse</span><span class="v">' + U.brl(p.valor) + '</span></div>' +
        '<div class="resumo-linha"><span>Pago até agora</span><span class="v">' + U.brl(S.pagoDe(parcelaId)) + '</span></div>' +
        '<div class="resumo-linha"><span>Saldo</span><span class="v">' + U.brl(S.saldoDe(p)) + '</span></div>' +
        '<h3 style="font-size:12px;margin:14px 0 4px">Plantões deste fechamento</h3>' +
        (itens.length
          ? '<table class="parcelas"><thead><tr><th>Setor</th><th>Tipo</th><th class="num">Plantões</th>' +
            '<th class="num">Horas</th><th class="num">Valor</th></tr></thead><tbody>' +
            itens.map(function (i) {
              return '<tr><td class="desc">' + U.esc(i.setor || '—') + '</td><td>' + U.esc(i.tipo || '—') + '</td>' +
                '<td class="num">' + (i.qtd || 0) + '</td>' +
                '<td class="num">' + Math.floor((i.minutos || 0) / 60) + 'h' + String((i.minutos || 0) % 60).padStart(2, '0') + '</td>' +
                '<td class="num">' + U.brl(i.valor || 0) + '</td></tr>';
            }).join('') +
            '<tr><td colspan="4"><b>Total</b></td><td class="num"><b>' + U.brl(p.valor) + '</b></td></tr>' +
            '</tbody></table>'
          : '<div class="ajuda">Sem composição por setor/tipo neste lançamento.</div>')
    });
  }

  function ligarLotes() {
    /* CONFIRMAR O FECHAMENTO: a mão da produtividade dizendo "este
       valor é o certo, pode pagar". Sem isso o financeiro não
       libera, e o médico espera. */
    document.querySelectorAll('[data-lp-confirmar]').forEach(function (b2) {
      b2.addEventListener('click', function () {
        const id = this.dataset.lpConfirmar;
        const l = S.st.lotesProdutividade.find(function (x) { return x.id === id; });
        if (!l) return;
        const sit = S.situacaoLoteProdutividade(l);
        const c = D.centro(l.centro) || {};

        ERP.app.modal({
          titulo: 'Confirmar fechamento · ' + (c.curto || c.nome),
          fecharTxt: 'Cancelar',
          corpo:
            '<div class="resumo-linha"><span>Competência</span><span class="v">' +
              U.fComp(l.competencia) + '</span></div>' +
            '<div class="resumo-linha"><span>Médicos</span><span class="v">' + l.medicos + '</span></div>' +
            '<div class="resumo-linha"><span>Valor total</span><span class="v">' +
              U.brl(l.valor) + '</span></div>' +
            (sit.bloqueados
              ? '<div class="aviso" style="margin-top:10px;border-left-color:var(--red)">' +
                '<b>' + sit.bloqueados + ' médico(s) com pagamento bloqueado:</b> ' +
                U.esc(sit.medicos_bloqueados.join(', ')) + '. Eles ficam FORA da remessa de ' +
                'pagamento. Libere antes, ou confirme ciente disso.</div>' +
                '<label class="marcar" style="margin-top:8px"><input type="checkbox" id="cf-ciente">' +
                '<span>Estou ciente de que esses médicos não serão pagos agora</span></label>'
              : '') +
            '<div class="ajuda" style="margin-top:10px">Confirmar é dizer que este valor é o ' +
            'fidedigno. A partir daqui o financeiro pode pagar — antes disso, não.</div>' +
            '<div id="cf-erro"></div>',
          acoes: [{ txt: 'Confirmar fechamento', cls: 'btn-aprovar', fn: function () {
            const erro = U.el('cf-erro');
            const ciente = U.el('cf-ciente') ? U.el('cf-ciente').checked : false;
            const r = S.confirmarLoteProdutividade(id, { ciente_bloqueios: ciente });
            if (r.erro) {
              if (erro) erro.innerHTML = '<div class="login-erro">' + U.esc(r.erro) + '</div>';
              return;
            }
            ERP.app.fecharModal();
            ERP.app.aviso('Fechamento confirmado — liberado para pagamento.', 'ok');
            render();
          } }]
        });
      });
    });

    /* Liberar o pagamento do médico direto na conferência. */
    document.querySelectorAll('[data-lp-liberar]').forEach(function (b2) {
      b2.addEventListener('click', function () {
        const pid = this.dataset.lpLiberar;
        const loteId = this.dataset.lote;
        const p = S.todasParcelas().find(function (x) { return x.id === pid; });
        if (!p) return;
        const nome = ERP.lancamento.nomeCredor(p.credor) || 'o médico';
        ERP.app.modal({
          titulo: 'Liberar pagamento de ' + nome,
          fecharTxt: 'Cancelar',
          corpo: '<label for="lb-motivo">Por que está liberando?</label>' +
            '<input id="lb-motivo" placeholder="ex.: documento entregue, escala conferida">' +
            '<div class="ajuda">Fica na trilha junto com o motivo do bloqueio: quem olhar ' +
            'depois precisa entender por que o pagamento foi travado e por que foi solto.</div>' +
            '<div id="lb-erro"></div>',
          acoes: [{ txt: 'Liberar', cls: 'btn-aprovar', fn: function () {
            const motivo = U.val('lb-motivo').trim();
            const erro = U.el('lb-erro');
            if (!motivo) {
              if (erro) erro.innerHTML = '<div class="login-erro">Informe o motivo.</div>';
              return;
            }
            const r = S.liberarPagamentoMedico(loteId, p.titulo_id, motivo);
            if (r.erro) {
              if (erro) erro.innerHTML = '<div class="login-erro">' + U.esc(r.erro) + '</div>';
              return;
            }
            ERP.app.fecharModal();
            ERP.app.aviso('Pagamento de ' + nome + ' liberado.', 'ok');
            render();
          } }]
        });
      });
    });

    ['lp-f-comp', 'lp-f-proj', 'lp-f-de', 'lp-f-ate', 'lp-f-sit', 'lp-f-busca'].forEach(function (id) {
      const el = U.el(id);
      if (!el) return;
      const ev = id === 'lp-f-busca' ? 'input' : 'change';
      el.addEventListener(ev, function () {
        fLote = { comp: U.val('lp-f-comp'), centro: U.val('lp-f-proj'), de: U.val('lp-f-de'),
          ate: U.val('lp-f-ate'), sit: U.val('lp-f-sit'), busca: U.val('lp-f-busca') };
        renderLotes();
        if (id === 'lp-f-busca' && U.el('lp-f-busca')) { U.el('lp-f-busca').focus(); }
      });
    });
    if (U.el('lp-f-limpar')) U.el('lp-f-limpar').addEventListener('click', function () { fLote = {}; renderLotes(); });
    document.querySelectorAll('[data-lp-fat]').forEach(function (b) {
      b.addEventListener('click', function () {
        const l = S.lotesProdutividade().find(function (x) { return x.id === this.dataset.lpFat; }.bind(this));
        if (l) perguntarFaturamento(l.centro, l.competencia, l.valor, l);
      });
    });
    document.querySelectorAll('[data-lp-medico]').forEach(function (b) {
      b.addEventListener('click', function () { detalheMedico(this.dataset.lpMedico); });
    });
    document.querySelectorAll('[data-lp-ver]').forEach(function (b) {
      b.addEventListener('click', function () {
        loteAberto = loteAberto === this.dataset.lpVer ? null : this.dataset.lpVer;
        renderLotes();
      });
    });
    document.querySelectorAll('[data-lp-cancelar]').forEach(function (b) {
      b.addEventListener('click', function () { cancelarLote(this.dataset.lpCancelar); });
    });
  }

  function cancelarLote(id) {
    ERP.app.modal({
      titulo: 'Cancelar lote de produtividade',
      corpo: '<div class="ajuda" style="margin-bottom:8px">Cancela todos os títulos deste lote. A ' +
        'produtividade não é editável de propósito — pra corrigir um arquivo lançado errado, cancela o ' +
        'lote inteiro e importa de novo.</div>' +
        '<label>Motivo</label><textarea id="lp-motivo" placeholder="Ex.: arquivo errado, médicos a mais"></textarea>',
      acoes: [{ txt: 'Cancelar lote', cls: 'btn-cancelar', fn: function () {
        const motivo = U.val('lp-motivo');
        if (!motivo) return ERP.app.aviso('Informe o motivo.', 'erro');
        const r = S.cancelarLoteProdutividade(id, motivo, false);
        if (r.erro) {
          ERP.app.fecharModal();
          if (r.jaPagas) return perguntarForcar(id, motivo, r);
          return ERP.app.aviso(r.erro, 'erro');
        }
        ERP.app.fecharModal();
        ERP.app.aviso('Lote cancelado.' + (r.confirmacao_desfeita
          ? ' A confirmação do valor a faturar deste projeto também foi desfeita.' : ''), 'ok');
        ERP.contas.render();
        atualizarAlerta();
        renderLotes();
      } }]
    });
  }

  /* Pagamento em lote de produtividade é raro de cancelar depois de
     pago — por isso este caminho pede uma confirmação a mais, em vez
     de já vir embutido no cancelamento comum. Não é pra virar rotina. */
  function perguntarForcar(id, motivo, r) {
    ERP.app.modal({
      titulo: 'Este fechamento já teve pagamento',
      corpo: '<div class="ajuda erro">' + U.esc(r.erro) + '</div>' +
        (S.pode('admin')
          ? '<div class="ajuda">Você tem perfil de administrador e pode autorizar. Descreva a autorização: ' +
            'quem pediu, por quê e o que será feito com os valores já pagos. As parcelas já pagas NÃO são ' +
            'canceladas — elas viram correção manual (estorno do pagamento ou acerto no próximo fechamento).</div>' +
            '<label>Autorização *</label><input id="pr-aut" placeholder="ex.: autorizado por Fellype — erro de ' +
            'carga do arquivo; acerto do Dr. X no fechamento de outubro">'
          : '<div class="ajuda">Seu perfil não autoriza esta alteração. Peça ao administrador.</div>'),
      acoes: S.pode('admin') ? [{ txt: 'Autorizar e cancelar o que ainda não foi pago', cls: 'btn-cancelar', fn: function () {
        const r2 = S.cancelarLoteProdutividade(id, U.val('pr-aut') || motivo, true);
        if (r2.erro) return ERP.app.aviso(r2.erro, 'erro');
        ERP.app.fecharModal();
        /* Com parcela paga de fora, o lote fica PARCIALMENTE cancelado
           — dizer "Lote cancelado" escondia isso. */
        ERP.app.aviso(r2.parcial
          ? 'Lote cancelado EM PARTE: ' + r2.puladas + ' parcela(s) já paga(s) continuam valendo e precisam ser ' +
            'tratadas na mão (estorno do pagamento).'
          : 'Lote cancelado.' + (r2.confirmacao_desfeita
            ? ' A confirmação do valor a faturar também foi desfeita.' : ''),
          r2.parcial ? 'erro' : 'ok');
        ERP.contas.render();
        atualizarAlerta();
        renderLotes();
      } }] : []
    });
  }

  /* ── leitura ────────────────────────────────────────────*/
  function abrir(e) {
    const arq = e.target.files && e.target.files[0];
    if (!arq) return;
    const leitor = new FileReader();
    leitor.onload = function () {
      try {
        const wb = XLSX.read(new Uint8Array(leitor.result), { type: 'array' });
        lote = ler(wb, arq.name);
        complementar = null;   // arquivo novo: a pergunta do complemento volta a valer
        render();
      } catch (err) {
        ERP.app.aviso('Não consegui ler este arquivo: ' + err.message, 'erro');
      }
    };
    leitor.readAsArrayBuffer(arq);
  }

  const txt = v => (v === null || v === undefined ? '' : String(v).trim());
  // raw:true — o valor vem como número da célula, sem passar pela máscara
  const linhasDe = (wb, nome) => XLSX.utils.sheet_to_json(wb.Sheets[nome],
    { header: 1, raw: true, defval: '' });

  /* O nome da aba varia — PRODUTIVIDADE, ANESTESIA, CLINICA… — então a
     escolha é pelo CONTEÚDO: a aba de plantões é a que tem a linha de
     cabeçalho com Setor, Entrada e Saída; a financeira é a que tem
     Profissional e Chave Pix. */
  function acharAbas(wb) {
    let plantoes = null, financeiro = null;
    wb.SheetNames.forEach(function (n) {
      const l = linhasDe(wb, n);
      const cabecalhos = l.slice(0, 20).map(function (r) {
        return r.map(function (v) { return txt(v).toLowerCase(); }).join('|');
      }).join(' ');
      if (!financeiro && /profissional/.test(cabecalhos) &&
          /(chave pix|documento)/.test(cabecalhos)) financeiro = l;
      else if (!plantoes && /setor/.test(cabecalhos) &&
               /(entrada|sa[íi]da)/.test(cabecalhos)) plantoes = l;
    });
    // sobrou uma aba só: ela é a de plantões
    if (!plantoes) {
      const outra = wb.SheetNames.find(function (n) { return linhasDe(wb, n) !== financeiro; });
      if (outra && wb.SheetNames.length > 1) plantoes = linhasDe(wb, outra);
    }
    return { plantoes: plantoes, financeiro: financeiro };
  }
  // aceita número da célula ou texto no formato brasileiro
  function valorNum(v) {
    if (typeof v === 'number') return Math.round(v * 100) / 100;
    return U.parseValor(txt(v));
  }
  // "04:00" (texto) ou fração de dia (célula de hora) -> minutos
  function minutos(h) {
    if (typeof h === 'number') return Math.round(h * 24 * 60);
    const m = txt(h).match(/^(\d+):(\d{2})/);
    return m ? (+m[1]) * 60 + (+m[2]) : 0;
  }
  const hhmm = min => Math.floor(min / 60) + 'h' + (min % 60 ? String(min % 60).padStart(2, '0') : '');
  const chaveNome = n => txt(n).toLowerCase().replace(/\s+/g, ' ');

  /* O tipo da chave PIX vem escrito na planilha, mas quem manda é o
     CONTEÚDO da chave: planilha com "Email" e chave de CPF (ou o
     contrário) gera remessa recusada pelo banco — ou, pior, paga na
     chave errada. Aqui o tipo é deduzido da chave e só usa o que a
     planilha diz quando as duas coisas combinam. */
  function tipoDaChavePix(chave) {
    const v = String(chave || '').trim();
    if (!v) return '';
    if (v.indexOf('@') > -1) return 'email';
    const so = v.replace(/\D/g, '');
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return 'aleatoria';
    if (v.charAt(0) === '+' || so.length === 13 || (so.length === 11 && v.indexOf('(') > -1)) return 'telefone';
    /* 11 dígitos crus são CPF OU celular com DDD: aqui o conteúdo não
       decide, e quem desempata é o que a planilha declarou. */
    if (so.length === 11) return v.indexOf('.') > -1 ? 'cpf' : 'cpf_ou_telefone';
    if (so.length === 14) return 'cnpj';
    if (so.length === 10 || so.length === 12) return 'telefone';
    return '';
  }

  const NOME_TIPO_PIX = { email: 'e-mail', telefone: 'telefone', cpf: 'CPF', cnpj: 'CNPJ',
    aleatoria: 'chave aleatória' };

  /* Normaliza o par (chave, tipo) da planilha e diz se houve
     divergência, para a tela avisar em vez de gravar calado. */
  function normalizarPix(pg) {
    const chave = String(pg.pix || '').trim();
    const declarado = String(pg.tipo_chave || '').trim().toLowerCase()
      .replace('e-mail', 'email').replace('telefone/celular', 'telefone')
      .replace('celular', 'telefone').replace('aleatória', 'aleatoria').replace('aleatoria', 'aleatoria');
    let real = tipoDaChavePix(chave);
    let ambiguo = false;
    if (real === 'cpf_ou_telefone') {
      ambiguo = true;
      real = (declarado === 'telefone' || declarado === 'cpf') ? declarado : 'cpf';
    }
    return {
      pix: chave,
      tipo_chave: real || declarado,
      divergente: !!(chave && declarado && real && !ambiguo && real !== declarado),
      declarado: declarado
    };
  }

  function ler(wb, arquivo) {
    const abas = acharAbas(wb);
    const prod = abas.plantoes;
    if (!prod) {
      throw new Error('não achei a aba com os plantões (preciso de colunas Setor, Entrada e Saída)');
    }

    /* A coluna onde tudo começa muda de arquivo para arquivo: em uns o
       Setor está na coluna B, em outros na A. Descobre pelo cabeçalho. */
    let col0 = 1;
    for (let i = 0; i < Math.min(prod.length, 30); i++) {
      const j = (prod[i] || []).findIndex(function (v) { return txt(v).toLowerCase() === 'setor'; });
      if (j > -1) { col0 = j; break; }
    }

    let projeto = '', unidade = '', periodo = '', totalArquivo = 0;
    const grupos = {};   // medico|setor|tipo
    const medicos = {};  // nome -> { crm, total }
    let medico = null, crm = '';

    prod.forEach(function (linha, i) {
      const b = txt(linha[col0]), c = txt(linha[col0 + 1]);
      const f = linha[col0 + 4], g = linha[col0 + 5];
      const temDuracao = txt(f) !== '';

      // Até achar o período, o que existe é só o cabeçalho do relatório
      // (título e projeto) — nada dali é médico nem plantão.
      if (!periodo) {
        // "01/07/2026 ~ 31/07/2026" ou "15/07/2026 - 14/08/2026"
        if (/^\d{2}\/\d{2}\/\d{4}\s*[~\-a]\s*\d{2}\/\d{2}\/\d{4}$/.test(b)) {
          periodo = b;
          for (let k = i - 1; k >= 0; k--) {
            const acima = txt(prod[k][col0]);
            if (acima && acima.toUpperCase().indexOf('PRODUTIVIDADE') === -1) { projeto = acima; break; }
          }
          // a aba financeira costuma trazer o hospital acima da especialidade
          if (abas.financeiro) {
            const topo = abas.financeiro.slice(0, 6)
              .map(function (r) { return txt(r[0]); })
              .filter(function (v) { return v && !/^FINANCEIRO$/i.test(v) && !/\d{2}\/\d{2}\/\d{4}/.test(v); });
            if (topo.length) unidade = topo[0];
          }
        }
        return;
      }
      if (txt(linha[col0 + 3]).toUpperCase().indexOf('TOTAL DA PRODUTIVIDADE') > -1) {
        totalArquivo = valorNum(g);
        return;
      }
      if (b.toLowerCase() === 'setor') return;                          // cabeçalho do bloco
      if (b && !c && !temDuracao && b.indexOf('*para validar') !== 0) { // nome do médico
        const m = b.match(/^(.*?)\s+-+\s+(\S+)\s*$/);
        medico = m ? m[1].trim() : b;
        crm = m ? m[2].trim() : '';
        medicos[chaveNome(medico)] = medicos[chaveNome(medico)] || { nome: medico, crm: crm, total: 0, plantoes: 0 };
        return;
      }
      if (!medico || !b || !c) return;                            // linha de total do bloco
      const min = minutos(f), val = valorNum(g);
      const k = medico + '||' + b + '||' + c;
      const gr = grupos[k] = grupos[k] || { medico: medico, crm: crm, setor: b, tipo: c, plantoes: 0, minutos: 0, valor: 0 };
      gr.plantoes++; gr.minutos += min; gr.valor = Math.round((gr.valor + val) * 100) / 100;
      const md = medicos[chaveNome(medico)];
      md.plantoes++; md.total = Math.round((md.total + val) * 100) / 100;
    });

    // aba FINANCEIRO: dados de pagamento do credor
    const fin = abas.financeiro || [];
    const pagto = {};
    let cabFin = -1;
    fin.forEach(function (l, i) {
      if (cabFin < 0 && l.some(function (v) { return txt(v) === 'Profissional'; })) cabFin = i;
    });
    if (cabFin >= 0) {
      const cab = fin[cabFin].map(function (v) { return txt(v).replace(/\s+/g, ' '); });
      const col = function (nome) { return cab.findIndex(function (v) { return v.toLowerCase().indexOf(nome) === 0; }); };
      const iNome = col('profissional'), iRazao = col('razão'), iCrm = col('crm'),
            iDoc = col('documento'), iTipo = col('tipo'), iVal = col('valor'),
            // "Chave Pix" tem "pix" no meio, não no início — col() exige início,
            // então essa coluna precisa de busca por conteúdo, não por prefixo.
            iPix = cab.findIndex(function (v) { return v.toLowerCase().indexOf('pix') > -1; });
      for (let i = cabFin + 1; i < fin.length; i++) {
        const nome = txt(fin[i][iNome]);
        if (!nome) continue;
        pagto[chaveNome(nome)] = {
          razao_social: iRazao > -1 ? txt(fin[i][iRazao]) : '',
          crm: iCrm > -1 ? txt(fin[i][iCrm]) : '',
          documento: iDoc > -1 ? txt(fin[i][iDoc]) : '',
          tipo_chave: iTipo > -1 ? txt(fin[i][iTipo]) : '',
          pix: iPix > -1 ? txt(fin[i][iPix]) : '',
          valor: iVal > -1 ? valorNum(fin[i][iVal]) : 0
        };
      }
    }

    const linhas = Object.keys(grupos).map(function (k) { return grupos[k]; })
      .sort(function (a, b) {
        return a.medico.localeCompare(b.medico) || a.setor.localeCompare(b.setor) || a.tipo.localeCompare(b.tipo);
      });
    const soma = Math.round(linhas.reduce(function (s, l) { return s + l.valor; }, 0) * 100) / 100;
    const somaFin = Math.round(Object.keys(pagto).reduce(function (s, k) { return s + pagto[k].valor; }, 0) * 100) / 100;

    // competência = mês da data FINAL do período (aceita ~, hífen ou "a")
    const partes = periodo.split(/\s+(?:a|~|-)\s+/i);
    const fim = (partes.length > 1 ? partes[1] : partes[0] || '').trim();
    const pf = fim.split('/');
    let competencia;
    if (pf.length === 3) {
      const ano = pf[2].length === 2 ? '20' + pf[2] : pf[2];
      competencia = ano + '-' + pf[1].padStart(2, '0');
    } else if (pf.length === 2) {
      /* Período sem ano ("01/07 a 31/07") — assume o ano corrente; se
         isso jogar a competência pro futuro, é do ano anterior:
         produtividade é sempre de um período que já aconteceu, nunca
         de um mês que ainda não chegou. Sem essa conta, caía direto no
         mês atual do sistema, errado sempre que o fechamento é de mês
         anterior — o caso mais comum. */
      const anoAtual = U.mesAtual().slice(0, 4);
      const mes = pf[1].padStart(2, '0');
      competencia = anoAtual + '-' + mes;
      if (competencia > U.mesAtual()) competencia = (Number(anoAtual) - 1) + '-' + mes;
    } else {
      competencia = U.mesAtual();
    }

    return {
      arquivo: arquivo, projeto: projeto, unidade: unidade, periodo: periodo, competencia: competencia,
      linhas: linhas, medicos: medicos, pagto: pagto,
      soma: soma, somaFin: somaFin, totalArquivo: totalArquivo
    };
  }

  /* Um pagamento por médico (é um PIX por médico), com a composição
     por setor e tipo pendurada como itens — o gestor abre o lançamento
     e vê de onde saiu cada real. */
  function porMedico(L) {
    const mapa = {};
    L.linhas.forEach(function (l) {
      const k = chaveNome(l.medico);
      const m = mapa[k] = mapa[k] || {
        medico: l.medico, crm: l.crm, itens: [], plantoes: 0, minutos: 0, valor: 0
      };
      m.itens.push({ setor: l.setor, tipo: l.tipo, qtd: l.plantoes, minutos: l.minutos, valor: l.valor });
      m.plantoes += l.plantoes;
      m.minutos += l.minutos;
      m.valor = Math.round((m.valor + l.valor) * 100) / 100;
    });
    return Object.keys(mapa).map(function (k) { return mapa[k]; })
      .sort(function (a, b) { return a.medico.localeCompare(b.medico); });
  }

  /* ── prévia ─────────────────────────────────────────────*/
  function centroSugerido(projeto) {
    const p = txt(projeto).toUpperCase();
    const achou = D.centros.find(function (c) {
      return p && (txt(c.curto).toUpperCase() === p || txt(c.codigo) === p ||
                   txt(c.nome).toUpperCase().indexOf(p) === 0);
    });
    return achou ? achou.id : '';
  }

  function render() {
    const L = lote;
    const medicos = porMedico(L);
    const centro = centroSugerido(L.projeto);
    const divergeArquivo = Math.abs(L.soma - L.totalArquivo) > 0.01;
    const divergeFin = Math.abs(L.soma - L.somaFin) > 0.01;

    U.el('pr-saida').innerHTML =
      '<div class="pr-cab">' +
        '<div><label>Projeto no arquivo</label><input value="' + U.esc(L.projeto) + '" disabled></div>' +
        '<div><label for="pr-centro">Centro de custo *</label><select id="pr-centro">' +
          '<option value="">Escolher…</option>' +
          D.centros.filter(function (c) { return c.ativo; }).map(function (c) {
            return '<option value="' + c.id + '"' + (c.id === centro ? ' selected' : '') + '>' +
              U.esc(c.codigo + ' · ' + c.nome) + '</option>';
          }).join('') + '</select></div>' +
        '<div><label>Período</label><input value="' + U.esc(L.periodo) + '" disabled></div>' +
        '<div><label for="pr-comp">Competência</label><input type="month" id="pr-comp" value="' + L.competencia + '"></div>' +
        '<div><label for="pr-venc">Vencimento do repasse</label>' +
          '<input type="date" id="pr-venc" value="' + venctoSugerido(L.competencia, centro) + '">' +
          '<div class="ajuda" id="pr-venc-nota">' + textoVencto(centro) + '</div></div>' +
        '<div><label for="pr-conta">Natureza</label><select id="pr-conta">' +
          D.plano.filter(function (p) { return p.nivel === 2 && (p.pai === '3' || p.pai === '4'); }).map(function (p) {
            return '<option value="' + p.cod + '"' + (p.cod === '3.01' ? ' selected' : '') + '>' +
              U.esc(p.cod + ' ' + p.nome) + '</option>';
          }).join('') + '</select></div>' +
        '<div><label for="pr-doc">Nº do título</label><input id="pr-doc" value="' + U.esc(refPadrao(L)) + '"></div>' +
      '</div>' +

      '<div class="pr-confere">' +
        '<span>Soma dos plantões <b>' + U.brl(L.soma) + '</b></span>' +
        '<span>Aba FINANCEIRO <b class="' + (divergeFin ? 'erro' : '') + '">' + U.brl(L.somaFin) + '</b></span>' +
        '<span>Total impresso no arquivo <b class="' + (divergeArquivo ? 'erro' : '') + '">' + U.brl(L.totalArquivo) + '</b></span>' +
        '<span>' + medicos.length + ' lançamento(s) · ' + L.linhas.length + ' linha(s) de setor/tipo</span>' +
      '</div>' +
      (divergeArquivo || divergeFin
        ? '<div class="aviso" style="margin:10px 0">Os totais do arquivo não fecham entre si. ' +
          'O sistema vai lançar a soma dos plantões (' + U.brl(L.soma) + '); confira com quem fechou antes de aprovar.</div>'
        : '') +

      '<div class="tabela-rolagem" style="margin:10px -14px 0">' +
      '<table><thead><tr><th>Médico</th><th>CRM</th><th class="num">Plantões</th>' +
      '<th class="num">Horas</th><th class="num">Valor</th><th>Bloqueio de PG</th>' +
      '<th>Credor</th></tr></thead><tbody>' +
      medicos.map(function (m) {
        const pg = L.pagto[chaveNome(m.medico)] || {};
        const doc = String(pg.documento || '').replace(/\D/g, '');
        const cad = (doc && D.credores.find(function (c) {
            return String(c.documento || '').replace(/\D/g, '') === doc; })) ||
          D.credores.find(function (c) { return chaveNome(c.nome) === chaveNome(m.medico); });
        return '<tr>' +
          '<td class="desc" style="white-space:normal">' + U.esc(m.medico) +
            '<div class="itens-sub">' + m.itens.map(function (i) {
              return U.esc(i.tipo) + ': ' + i.qtd + ' × ' + hhmm(i.minutos) + ' · ' + U.brl(i.valor);
            }).join(' &nbsp;|&nbsp; ') + '</div></td>' +
          '<td class="mono">' + U.esc(m.crm || pg.crm || '—') + '</td>' +
          '<td class="num">' + m.plantoes + '</td>' +
          '<td class="num">' + hhmm(m.minutos) + '</td>' +
          '<td class="num">' + U.brl(m.valor) + '</td>' +
          '<td>' + (S.pode('produtividade') || S.pode('lancar')
            ? '<label class="bloq-pg"><input type="checkbox" data-bloq="' + U.esc(chaveNome(m.medico)) +
              '"' + (bloqueiosPre[chaveNome(m.medico)] ? ' checked' : '') + '> bloquear</label>'
            : '') + '</td>' +
          '<td>' + (cad
            ? (cad.pix && cad.documento
                ? '<span class="badge b-pago">cadastrado</span>'
                : '<span class="badge b-aguardando">completa cadastro</span>' +
                  '<div class="sub">' + (cad.pix ? '' : 'chave PIX ') + (cad.documento ? '' : 'CPF/CNPJ') + '</div>')
            : '<span class="badge b-pendente">novo médico</span>' +
              (function () {
                /* Mostra a CHAVE e o tipo dela — antes aparecia o CPF
                   com o rótulo do tipo ("115.367.877-28 · Email"), que
                   parecia cadastro errado e escondia a chave real. */
                const npx = normalizarPix(pg);
                if (!npx.pix && !pg.documento) return '';
                return '<div class="sub">' +
                  (npx.pix
                    ? U.esc(npx.pix) + ' · ' + U.esc(NOME_TIPO_PIX[npx.tipo_chave] || npx.tipo_chave || 'tipo?')
                    : 'sem chave PIX') +
                  (pg.documento ? '<br>doc ' + U.esc(pg.documento) : '') +
                  (npx.divergente
                    ? '<div class="erro">planilha diz ' + U.esc(npx.declarado) + ', a chave é ' +
                      U.esc(NOME_TIPO_PIX[npx.tipo_chave] || npx.tipo_chave) + ' — vale a chave</div>'
                    : '') + '</div>';
              })()) + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>' +

      '<div class="form-acoes" style="margin:14px -14px -14px">' +
        '<span class="ajuda" style="margin-right:auto">Um título por médico, com a composição por setor e tipo ' +
        'no detalhe do lançamento. Tudo aguardando aprovação; reimportar o mesmo arquivo não duplica.</span>' +
        '<button class="btn-primary" id="pr-gerar" style="width:auto;margin:0">Gerar ' + medicos.length + ' lançamentos</button>' +
      '</div>';

    U.el('pr-gerar').addEventListener('click', gerar);
    document.querySelectorAll('[data-bloq]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        const k = this.dataset.bloq;
        if (!this.checked) { delete bloqueiosPre[k]; delete motivosPre[k]; return; }
        bloqueiosPre[k] = true;
        const self = this;
        ERP.app.modal({
          titulo: 'Bloquear pagamento',
          fecharTxt: 'Bloquear sem motivo',
          corpo: '<div class="ajuda">O lançamento é criado normalmente — o custo existe —, mas este médico ' +
            'fica fora da remessa de pagamento até alguém liberar na aba de lançamentos.</div>' +
            '<label>Motivo (opcional)</label>' +
            '<input id="bq-motivo" placeholder="ex.: contrato não assinado, check-ins não confirmados">',
          acoes: [{ txt: 'Bloquear', cls: 'btn-cancelar', fn: function () {
            motivosPre[k] = U.val('bq-motivo');
            ERP.app.fecharModal();
            self.parentElement.title = motivosPre[k] || 'bloqueado';
          } }]
        });
      });
    });
    // trocar o projeto ou a competência recalcula o vencimento
    ['pr-centro', 'pr-comp'].forEach(function (id) {
      U.el(id).addEventListener('change', function () {
        const cc = U.val('pr-centro');
        U.setVal('pr-venc', venctoSugerido(U.val('pr-comp'), cc));
        U.el('pr-venc-nota').textContent = textoVencto(cc);
      });
    });
  }

  /* O repasse do médico vence no dia em que o hospital paga: o vencimento
     sai do MESMO prazo que já alimenta a previsão de contas a receber —
     dias corridos a partir do fim da competência (prazoDe/dataPrevista).
     Antes esta função usava um esquema à parte (dia fixo do calendário,
     recebimento_dia/recebimento_mes_offset), que só existe quando o
     projeto foi criado pelo atalho "Novo projeto" do Faturamento — pra
     qualquer outro projeto, com prazo_dias já cadastrado certinho, caía
     no padrão embutido (dia 10 do mês seguinte) e ignorava o prazo real.
     Agora só cai no esquema de dia fixo quando o projeto NÃO tem
     prazo_dias — é o caso do projeto recém-criado por aquele atalho. */
  /* Confirmação do valor a faturar, no fechamento da produtividade.
     Sugere o valor da previsão do mês (ou a estimativa do cadastro do
     projeto) — quem fecha ajusta pro número real da medição. */
  function perguntarFaturamento(centro, comp, valorRepasse, lote) {
    const c = D.centro(centro) || {};
    /* Especialidade de grupo (GHC-HGB): o faturamento é negociado em
       valor GLOBAL com o hospital, não por especialidade. Lançar a
       produtividade da anestesia pergunta o valor do grupo inteiro. */
    const grupo = c.grupo_faturamento || null;
    const irmaos = grupo ? S.projetosDoGrupo(grupo) : [centro];
    const pv = S.previsaoDe(centro, comp);
    const globalAtual = grupo
      ? Math.round(irmaos.reduce(function (t, id) {
          const p = S.previsaoDe(id, comp); return t + (p ? p.faturamento : 0); }, 0) * 100) / 100
      : (pv ? pv.faturamento : 0);
    const sugerido = (pv && pv.faturamento) || c.prev_faturamento || 0;
    const prodDoGrupo = grupo
      ? irmaos.reduce(function (t, id) {
          return t + S.fechamentosVivosDe(id, comp)
            .reduce(function (x, l) { return x + (l.valor || 0); }, 0); }, 0)
      : valorRepasse;
    ERP.app.modal({
      titulo: 'Valor a faturar · ' + (grupo || c.curto || c.nome) + ' · ' + U.fComp(comp),
      fecharTxt: 'Depois',
      corpo:
        (grupo
          ? '<div class="aviso-linha">O ' + U.esc(grupo) + ' sai em <b>nota única</b> para ' +
            irmaos.length + ' especialidades, mas o valor é informado <b>por especialidade</b>: some-se o ' +
            'desta ao das outras para formar o faturamento do grupo.</div>'
          : '') +
        '<div class="ajuda">Produtividade lançada: ' + U.brl(valorRepasse) + ' de repasse aos médicos' +
          (grupo && prodDoGrupo > valorRepasse
            ? ' (' + U.brl(prodDoGrupo) + ' somando as especialidades do grupo já lançadas)' : '') + '. ' +
          'Informe quanto vai ser faturado nesta competência — o financeiro passa a trabalhar com ' +
          'esse número (status "valor confirmado", bem mais firme que a previsão) e ele já entra no contas a receber ' +
          'esperando só a NF.</div>' +
        '<label>Valor a faturar' + (grupo ? ' desta especialidade' : '') + ' (R$)</label>' +
        '<input class="num" id="pr-fat-valor" inputmode="decimal" value="' + U.num(sugerido) + '">' +
        (globalAtual ? '<div class="ajuda">' +
          (grupo ? 'Já confirmado no grupo neste mês: ' + U.brl(globalAtual) + ' (somando as especialidades).'
                 : 'Previsão atual do mês: ' + U.brl(globalAtual) + '.') + '</div>' : '') +
        '<label>Observação (opcional)</label><input id="pr-fat-obs" placeholder="glosa, mês parcial, acordo…">',
      /* "Confirmar valor" e nada mais: aqui não se fatura nada, e o
         botão antigo dava a entender que sim. */
      acoes: [{ txt: 'Confirmar valor', cls: 'btn-aprovar', fn: function () {
        const valor = U.parseValor(U.val('pr-fat-valor'));
        /* Valor desta especialidade: as do grupo somam para formar o
           faturamento do HGB, que sai em nota única. */
        const r = S.confirmarFaturamentoProdutividade({
          centro: centro, competencia: comp, faturamento: valor,
          produtividade: valorRepasse, observacao: U.val('pr-fat-obs'), lote: lote ? lote.id : null
        });
        if (ERP.app.erroDoRetorno(r)) return;
        ERP.app.fecharModal();
        ERP.contas.render();
        ERP.app.atualizarContadores();
        ERP.app.aviso('Faturamento de ' + U.brl(r.previsao.faturamento) + ' confirmado' +
          (grupo ? ' para ' + (c.curto || '') + ' — entra na nota única do ' + grupo + '.'
                 : ' — já está no contas a receber esperando a NF.'), 'ok');
      } }]
    });
  }

  function venctoSugerido(comp, centroId) {
    const c = D.centro(centroId) || {};
    const pz = S.prazoDe(centroId, null);
    if (pz.origem !== 'padrão' || c.recebimento_dia === undefined) {
      return S.dataPrevista(comp, pz.dias);
    }
    const dia = c.recebimento_dia || 10;
    const offset = c.recebimento_mes_offset === undefined ? 1 : c.recebimento_mes_offset;
    const p = comp.split('-');
    const ultimo = new Date(Date.UTC(+p[0], +p[1] - 1 + offset + 1, 0)).getUTCDate();
    const d = new Date(Date.UTC(+p[0], +p[1] - 1 + offset, Math.min(dia, ultimo)));
    return d.toISOString().slice(0, 10);
  }
  function textoVencto(centroId) {
    const c = D.centro(centroId) || {};
    const pz = S.prazoDe(centroId, null);
    if (pz.origem !== 'padrão' || c.recebimento_dia === undefined) {
      return pz.origem === 'padrão'
        ? 'projeto sem prazo cadastrado — usando 30 dias após o fim da competência'
        : pz.dias + ' dias após o fim da competência (prazo do ' + pz.origem + ')';
    }
    return c.recebimento_dia
      ? 'previsão de recebimento do projeto: dia ' + c.recebimento_dia
      : 'projeto sem previsão de recebimento cadastrada — usando dia 10';
  }
  const refPadrao = L => 'FECH-' + txt(L.projeto).toUpperCase() + '-' + L.competencia;

  /* ── geração em lote ────────────────────────────────────
     Quando parte do arquivo já foi lançada, o sistema PERGUNTA: é
     fechamento complementar (entra de novo e será pago de novo) ou é o
     mesmo arquivo reimportado por engano (os repetidos ficam de fora)?
     Deixar automático transformaria uma reimportação acidental em
     pagamento em dobro. */
  /* Bloqueio de pagamento marcado ANTES de gerar os lançamentos:
     contrato não assinado, check-in não confirmado. O lançamento é
     criado do mesmo jeito (o custo existe), mas fica fora da remessa
     até alguém liberar. */
  const bloqueiosPre = {};
  const motivosPre = {};

  let complementar = null;   // null = ainda não perguntado nesta importação; 'substituir' | true | false

  function gerar() {
    const L = lote;
    const jaLancados = porMedico(L).filter(function (m) {
      return S.refJaUsada([refPadrao(L), m.medico].join('|'));
    });
    if (jaLancados.length && complementar === null) {
      const centroAtual = U.val('pr-centro'), compAtual = U.val('pr-comp');
      const vivos = centroAtual && compAtual ? S.fechamentosVivosDe(centroAtual, compAtual) : [];
      const valorVivo = vivos.reduce(function (s2, l) { return s2 + (l.valor || 0); }, 0);
      const medicosVivos = vivos.reduce(function (s2, l) { return s2 + (l.medicos || 0); }, 0);
      return ERP.app.modal({
        titulo: 'Já existe fechamento desta competência neste projeto',
        fecharTxt: 'Cancelar',
        corpo:
          '<div class="resumo-linha"><span>Já lançado</span><span class="v">' + medicosVivos +
            ' médico(s) · ' + U.brl(valorVivo) + '</span></div>' +
          '<div class="resumo-linha"><span>Neste arquivo</span><span class="v">' + porMedico(L).length +
            ' médico(s) · ' + U.brl(porMedico(L).reduce(function (s2, m) { return s2 + m.valor; }, 0)) +
            '</span></div>' +
          '<div class="ajuda">' + jaLancados.length + ' médico(s) aparecem nos dois: ' +
            jaLancados.slice(0, 8).map(function (m) { return U.esc(m.medico); }).join(' · ') +
            (jaLancados.length > 8 ? ' · e mais ' + (jaLancados.length - 8) : '') + '</div>' +
          '<div class="ajuda"><b>Substituir</b> é o caso comum: o arquivo novo passa a valer inteiro. ' +
            'Quem saiu da lista deixa de receber, e quem teve o valor corrigido recebe o novo. Os ' +
            'lançamentos anteriores são cancelados e ficam no histórico.</div>' +
          '<div class="ajuda">Use <b>complemento</b> só quando o arquivo traz o que FALTOU (plantão que ' +
            'entrou depois): ali os valores se somam.</div>',
        acoes: [
          { txt: 'Já foi lançado — pular repetidos', cls: 'btn-sm', fn: function () {
            complementar = false; ERP.app.fecharModal(); gerar(); } },
          { txt: 'É complemento — somar', cls: 'btn-sm', fn: function () {
            complementar = true; ERP.app.fecharModal(); gerar(); } },
          { txt: 'Substituir o fechamento anterior', cls: 'btn-aprovar', fn: function () {
            const r = S.substituirFechamento(centroAtual, compAtual,
              'novo arquivo ' + L.arquivo + ' lançado por ' + S.usuario().nome);
            if (ERP.app.erroDoRetorno(r)) return;
            complementar = false;   // depois de cancelar, nada mais é repetido
            ERP.app.fecharModal();
            ERP.app.aviso(r.cancelados + ' fechamento(s) anterior(es) cancelado(s). Lançando o novo…', 'ok');
            gerar();
          } }
        ]
      });
    }
    const centro = U.val('pr-centro');
    if (!centro) { ERP.app.aviso('Escolha o centro de custo do projeto.', 'erro'); return; }
    const comp = U.val('pr-comp'), venc = U.val('pr-venc'),
          conta = U.val('pr-conta'), doc = U.val('pr-doc');

    let feitos = 0, repetidos = 0, erros = [];
    const tituloIds = [];
    const paresGerados = [];   // médico → título, para aplicar os bloqueios marcados
    let valorLote = 0;
    let complementares = 0;
    novos = 0; atualizados = 0; divergencias = [];
    porMedico(L).forEach(function (m) {
      const pg = L.pagto[chaveNome(m.medico)] || {};
      const credor = garantirCredor(m, pg);
      /* Fechamento COMPLEMENTAR do mesmo médico/projeto/competência é
         legítimo (plantão lançado depois, acerto). A chave ganha um
         sufixo quando já existe lançamento vivo daquele médico naquela
         competência — antes o sistema descartava com "já existia" e o
         médico ficava sem receber a diferença. */
      const refBase = [refPadrao(L), m.medico].join('|');
      const ref = (S.refJaUsada(refBase) && complementar)
        ? refBase + '|c' + S.proximoComplemento(refBase) : refBase;
      const r = S.criarTitulo({
        descricao: 'Produtividade médica ' + U.fComp(comp) + ' — ' + m.plantoes +
                   (m.plantoes > 1 ? ' plantões · ' : ' plantão · ') + hhmm(m.minutos),
        documento: doc, tipo_titulo: 'medicao', credor: credor,
        conta: conta, centro: centro, emissao: U.hoje(),
        origem: 'produtividade', origem_ref: ref,
        itens: m.itens,
        obs: 'Fechamento ' + L.arquivo + ' · período ' + L.periodo
      }, [{ num: 1, venc: venc, comp: comp, valor: m.valor }]);
      if (r.ok) {
        feitos++; tituloIds.push(r.titulo.id); valorLote += r.titulo.valor_total;
        paresGerados.push({ chave: chaveNome(m.medico), titulo_id: r.titulo.id });
        if (ref !== refBase) complementares++;
      } else if (r.duplicado) repetidos++;
      else erros.push(m.medico + ': ' + r.erro);
    });
    if (tituloIds.length) {
      const lotReg = S.registrarLoteProdutividade({
        centro: centro, competencia: comp, arquivo: L.arquivo, periodo: L.periodo,
        titulo_ids: tituloIds, medicos: tituloIds.length, valor: valorLote
      });
      /* Aplica os bloqueios marcados na conferência, antes de qualquer
         pagamento ser solicitado. */
      const loteId = (lotReg.lote || lotReg).id;
      let bloqueados = 0;
      Object.keys(bloqueiosPre).forEach(function (k) {
        const par = paresGerados.find(function (x) { return x.chave === k; });
        if (!par) return;
        const rb = S.bloquearPagamentoMedico(loteId, { titulo_id: par.titulo_id, motivo: motivosPre[k] || '' });
        if (rb.ok) bloqueados++;
      });
      if (bloqueados) {
        ERP.app.aviso(bloqueados + ' médico(s) com pagamento bloqueado — ficam fora da remessa até ' +
          'serem liberados na aba de lançamentos.', 'erro');
      }
      /* Fechou a produtividade: é aqui que a responsável informa quanto
         vai ser faturado do projeto. Esse número vale mais que a
         estimativa — vai pro contas a receber com status próprio. */
      setTimeout(function () { perguntarFaturamento(centro, comp, valorLote, lotReg); }, 400);
    }

    ERP.contas.render();
    ERP.app.atualizarContadores();
    atualizarAlerta();
    if (erros.length) ERP.app.aviso(erros[0], 'erro');
    else ERP.app.aviso(feitos + ' lançamento(s) gerado(s)' +
      (complementares ? ', ' + complementares + ' como complemento de fechamento já lançado' : '') +
      (repetidos ? ', ' + repetidos + ' já existiam e foram ignorados' : '') +
      '. ' + (novos ? novos + ' médico(s) cadastrado(s)' : '') +
      (novos && atualizados ? ' e ' : '') +
      (atualizados ? atualizados + ' atualizado(s) com dados bancários' : '') +
      (novos || atualizados ? '. ' : '') +
      'Os lançamentos estão em Financeiro › Contas a pagar.', 'ok');
    if (divergencias.length) avisarDivergencias();
  }

  /* O repasse sairia na chave antiga sem ninguém saber. */
  function avisarDivergencias() {
    ERP.app.modal({
      titulo: divergencias.length + ' divergência(s) de cadastro',
      corpo:
        '<div class="ajuda erro">O arquivo trouxe dados bancários diferentes do que está no ' +
        'cadastro. O sistema <b>não sobrescreveu nada</b> — o repasse vai sair pelo cadastro atual. ' +
        'Confira antes de gerar a remessa.</div>' +
        '<table><thead><tr><th>Médico</th><th>Campo</th><th>No cadastro</th><th>No arquivo</th>' +
        '<th></th></tr></thead><tbody>' +
        divergencias.map(function (d, ix) {
          return '<tr><td class="desc">' + U.esc(d.medico) + '</td>' +
            '<td>' + U.esc(d.campo) + '</td>' +
            '<td class="mono">' + U.esc(d.cadastro) + '</td>' +
            '<td class="mono">' + U.esc(d.arquivo) + '</td>' +
            '<td class="acoes"><button class="btn-sm" data-div="' + ix + '">' +
              'Usar a do arquivo</button></td></tr>';
        }).join('') + '</tbody></table>',
      aoAbrir: function () {
        document.querySelectorAll('[data-div]').forEach(function (b) {
          b.addEventListener('click', function () {
            const d = divergencias[+this.dataset.div];
            const c = D.credores.find(function (x) { return x.nome === d.medico; });
            if (!c) return;
            if (d.campo === 'chave PIX') c.pix = d.arquivo; else c.documento = d.arquivo;
            S.logarCadastro('credor', c.id, 'trocou ' + d.campo + ' pela do arquivo',
              d.cadastro + ' → ' + d.arquivo);
            this.textContent = 'trocado';
            this.disabled = true;
          });
        });
      },
      acoes: [{ txt: 'Manter o cadastro atual', cls: 'btn-aprovar', fn: ERP.app.fecharModal }]
    });
  }

  /* O cadastro do médico vem do arquivo: a aba FINANCEIRO traz razão
     social, CRM, CPF/CNPJ e a chave PIX. Quem já existe é ATUALIZADO
     com o que faltava — é isso que faz a remessa sair sem retrabalho.
     A busca é por documento primeiro, depois por nome. */
  let novos = 0, atualizados = 0, divergencias = [];

  function garantirCredor(l, pg) {
    const doc = String(pg.documento || '').replace(/\D/g, '');
    let c = doc ? D.credores.find(function (x) {
      return String(x.documento || '').replace(/\D/g, '') === doc; }) : null;
    if (!c) c = D.credores.find(function (x) { return chaveNome(x.nome) === chaveNome(l.medico); });

    if (c) {
      const mudou = [];
      /* DIVERGÊNCIA não é o mesmo que campo vazio.

         O sistema já não sobrescrevia o cadastro, o que está certo — mas
         também não avisava. Se o arquivo traz uma chave PIX ou um
         CPF/CNPJ diferente do cadastrado, o repasse sai na chave antiga
         e ninguém fica sabendo. Agora cada divergência é registrada e
         aparece na conferência da importação, para alguém decidir qual
         é a certa antes de gerar a remessa. */
      const so2 = v => String(v || '').replace(/\D/g, '');
      if (c.documento && pg.documento && so2(c.documento) !== so2(pg.documento)) {
        divergencias.push({ medico: c.nome, campo: 'CPF/CNPJ',
                            cadastro: c.documento, arquivo: pg.documento });
      }
      if (c.pix && pg.pix && String(c.pix).trim() !== String(pg.pix).trim()) {
        divergencias.push({ medico: c.nome, campo: 'chave PIX',
                            cadastro: c.pix, arquivo: pg.pix });
      }
      if (!c.documento && pg.documento) { c.documento = pg.documento; mudou.push('CPF/CNPJ'); }
      if (!c.pix && pg.pix) { c.pix = pg.pix; c.tipo_chave = pg.tipo_chave || ''; mudou.push('chave PIX'); }
      if (!c.crm && (l.crm || pg.crm)) { c.crm = l.crm || pg.crm; mudou.push('CRM'); }
      if (!c.razao_social && pg.razao_social) { c.razao_social = pg.razao_social; mudou.push('razão social'); }
      if (!c.forma_pagamento && pg.pix) { c.forma_pagamento = 'pix'; mudou.push('forma de pagamento'); }
      if (c.tipo !== 'medico') c.tipo = 'medico';
      if (mudou.length) atualizados++;
      return c.id;
    }

    const id = 'cr' + Date.now().toString(36) + '-' + (D.credores.length + 1);
    D.credores.push({
      id: id, nome: l.medico, tipo: 'medico', ativo: true, conta_padrao: '3.01',
      razao_social: pg.razao_social || '', crm: l.crm || pg.crm || '',
      documento: pg.documento || '',
      pix: normalizarPix(pg).pix, tipo_chave: normalizarPix(pg).tipo_chave,
      forma_pagamento: normalizarPix(pg).pix ? 'pix' : null
    });
    novos++;
    return id;
  }

  return { montar: montar, ler: ler };
})();
