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
        return '<tr' + (x.esperado && !x.lote ? ' class="atrasada"' : '') + '>' +
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
    /* A ORDEM DA LISTA É A ORDEM DO TRABALHO.

       Quatro grupos, do que precisa de gente para o que já está
       resolvido:

         1. não classificado e "outro" — ninguém disse ainda se esse
            médico emite nota. É decisão humana, e enquanto não for
            tomada o sistema não cobra nada dele: se ficasse no fim
            da lista, não seria tomada nunca.
         2. PJ sem nota — a cobrança que está aberta.
         3. PJ com nota — conferido.
         4. SCP — não deve nota, não há o que fazer.

       Dentro de cada grupo valem os critérios de sempre (quem ficou
       para trás num fechamento já pago primeiro, depois competência
       e saldo), que são sobre urgência de PAGAMENTO. Esta ordem é
       sobre pendência de DOCUMENTO, e por isso vem antes: pagar sem
       a nota é o que já acontece hoje; o que falta é não esquecer
       da nota depois. */
    const ordemNf = function (x) {
      const regime = S.regimeDoCredor(x.p.credor);
      if (!S.regimeExigeNota(regime)) return (regime === 'scp') ? 4 : 1;
      return S.temNota(x.p) ? 3 : 2;
    };
    linhas.sort(function (a, b) {
      return ordemNf(a) - ordemNf(b) ||
        (b.loteTevePagamento ? 1 : 0) - (a.loteTevePagamento ? 1 : 0) ||
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
        ? '<table><thead><tr><th>Médico</th><th>Regime</th><th>Projeto</th><th>Competência</th><th class="num">Valor</th>' +
          '<th class="num">Pago</th><th class="num">Falta</th><th>Situação</th><th>Trava</th><th></th></tr></thead><tbody>' +
          mostrar.map(function (x) {
            const c = D.centro(x.lote.centro) || {};
            const s = situacaoParcela(x.p);
            const regime = S.regimeDoCredor(x.p.credor);
            const exigeNf = S.regimeExigeNota(regime);
            return '<tr><td class="desc">' + U.esc(ERP.lancamento.nomeCredor(x.p.credor) || '—') + '</td>' +
              /* O regime aparece com a MESMA cor do botão da nota:
                 quem exige e está sem fica vermelho dos dois lados,
                 e a linha se lê de uma vez só. "Não classificado"
                 usa o selo de pendência porque é pendência — de
                 cadastro, não de nota. */
              '<td>' + (regime === 'scp'
                ? '<span class="badge">SCP</span>'
                : exigeNf
                  ? '<span class="badge ' + (S.temNota(x.p) ? 'b-pago' : 'b-reprovado') + '">PJ</span>'
                  : '<span class="badge b-pendente" title="Classifique o médico em Cadastros › Médicos. ' +
                    'Enquanto não for, não cobra nota.">' +
                    U.esc(regime ? S.rotuloRegime(regime) : 'Não classificado') + '</span>') + '</td>' +
              '<td class="desc">' + U.esc(c.curto || c.nome || '—') + '</td>' +
              '<td class="mono">' + U.fComp(x.lote.competencia) + '</td>' +
              '<td class="num">' + U.brl(x.p.valor) + '</td>' +
              '<td class="num">' + (x.pago > 0.004 ? U.brl(x.pago) : '—') + '</td>' +
              '<td class="num">' + U.brl(x.saldo) + '</td>' +
              '<td><span class="badge ' + s.cls + '">' + s.txt + '</span>' +
                (x.loteTevePagamento ? '<div class="sub">colegas do mesmo fechamento já receberam</div>' : '') + '</td>' +
              '<td class="sub">' + (x.trava.length ? U.esc(x.trava.join(' · ')) : '—') + '</td>' +
              '<td class="acoes">' +
                /* O botão da nota aqui é o mesmo do contas a pagar —
                   mesma janela, mesma sugestão de retenção. Quem
                   trabalha a produtividade não precisa trocar de
                   módulo para anexar a nota que acabou de chegar. */
                (exigeNf
                  ? '<button class="btn-sm ' + (S.temNota(x.p) ? 'btn-nf-ok' : 'btn-nf-falta') +
                    '" data-lp-nf="' + x.p.id + '">' + (S.temNota(x.p) ? 'NF ok' : 'Falta NF') + '</button> '
                  : '<button class="btn-sm btn-nf-na" data-lp-nf="' + x.p.id + '">NF —</button> ') +
                '<button class="btn-sm" data-lp-medico="' + x.p.id + '">' + rotuloComposicao(x.p) + '</button></td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="vazio"><strong>Ninguém pendente.</strong>Toda produtividade lançada já foi paga.</div>');
    document.querySelectorAll('#pr-aba-pendentes [data-lp-medico]').forEach(function (b) {
      b.addEventListener('click', function () { detalheMedico(this.dataset.lpMedico); });
    });
    document.querySelectorAll('#pr-aba-pendentes [data-lp-nf]').forEach(function (b) {
      b.addEventListener('click', function () {
        /* Redesenha ao fechar: a nota que acabou de entrar muda a
           cor do botão e o lugar da linha na lista. Sem isto, a
           pessoa anexa a nota e a tela continua dizendo que falta. */
        ERP.contas.abrirNF(this.dataset.lpNf, function () { renderPendentes(); });
      });
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

    /* CANCELADOS E SUBSTITUÍDOS FICAM ESCONDIDOS POR PADRÃO (v173):
       cada substituição deixa o fechamento anterior na lista, e com
       o tempo eles eram metade da tela. Continuam no histórico — a
       caixa "Ocultar" desmarcada mostra todos. */
    /* Só o que foi CANCELADO (a substituição cancela o anterior).
       "Sem títulos" não entra: é cabeçalho órfão, uma anomalia que
       precisa ser vista para ser substituída. */
    const morto = function (l) { return !!l.cancelado; };
    const ocultar = !fLote.mostrarCanc;
    let escondidos = 0;
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
      if (ocultar && morto(l)) { escondidos++; return false; }
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
        '<label style="font-weight:400;display:flex;gap:6px;align-items:center;align-self:flex-end;margin:0 0 6px">' +
          '<input type="checkbox" id="lp-f-ocultar" style="width:auto"' + (ocultar ? ' checked' : '') + '> ' +
          'Ocultar produtividades canceladas ou substituídas</label>' +
      '</div>' +
      '<div class="ajuda">' + lotes.length + ' de ' + todos.length + ' lançamento(s) · ' + U.brl(totalValor) +
        (escondidos ? ' · ' + escondidos + ' cancelado(s) ou substituído(s) oculto(s)' : '') + '</div>' +
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
              (!l.cancelado ? (S.podeCorrigirProdutividade()
                  ? '<button class="btn-sm" data-lp-editar="' + l.id + '">Editar</button>'
                  : '<button class="btn-sm" data-lp-fat="' + l.id + '">Valor a faturar</button>') +
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
  /* Os itens da parcela dizem de que formato ela veio: plantão (setor ×
     tipo, com horas) ou procedimento (especialidade × procedimento,
     só quantidade). Lançamento antigo, sem a marca, é plantão. */
  /* v174: além de plantão e procedimento, LAUDO (radiologia). Os
     dois últimos são contados por quantidade, sem horas. */
  const VOC = {
    plantao: { sing: 'plantão', plur: 'plantões', Plur: 'Plantões', colA: 'Setor', colB: 'Tipo' },
    procedimento: { sing: 'procedimento', plur: 'procedimentos', Plur: 'Procedimentos', colA: 'Especialidade', colB: 'Procedimento' },
    laudo: { sing: 'laudo', plur: 'laudos', Plur: 'Laudos', colA: 'Projeto', colB: 'Prioridade' }
  };
  const UNIDADE_DO_FORMATO = { procedimentos: 'procedimento', laudos: 'laudo' };
  const vocDoArquivo = function (L) { return VOC[UNIDADE_DO_FORMATO[(L || {}).formato] || 'plantao']; };
  const unidadeDa = function (p) {
    const it = (p && p.itens) || [];
    if (!it.length) return 'plantao';
    const u = it[0].unidade || 'plantao';
    return VOC[u] && it.every(function (i) { return (i.unidade || 'plantao') === u; }) ? u : 'plantao';
  };
  /* "Sem horas": a composição é por quantidade (procedimento ou laudo). */
  const ehProcedimento = function (p) { return unidadeDa(p) !== 'plantao'; };
  const rotuloComposicao = function (p) { return VOC[unidadeDa(p)].Plur; };

  function detalheLote(l) {
    const ids = Array.isArray(l.titulo_ids) ? l.titulo_ids : [];
    const parcelas = S.todasParcelas().filter(function (p) { return ids.indexOf(p.titulo_id) > -1; });
    /* ── DETALHE VAZIO TEM DE DIZER POR QUE ─────────────────

       O lançamento guarda a lista dos títulos que ele gerou. Quando
       nenhum deles aparece aqui, a tela mostrava uma tabela vazia —
       e "vazio" pode ser duas coisas muito diferentes: o repasse não
       chegou ao banco, ou chegou e este perfil não o vê. As duas
       pedem providências opostas, e nenhuma delas é olhar mais
       forte para a tabela.

       Foi o que aconteceu com os quatro fechamentos de outubro: a
       gerência de produtividade não tinha permissão de gravar
       `titulos` nem `parcelas` (são do módulo Financeiro), então o
       cabeçalho do lote foi para o banco e os médicos não. Quem
       lançou continuava vendo tudo — estava na memória do navegador
       dela —, e quem abriu depois viu uma lista vazia sem uma
       palavra de explicação. */
    if (!parcelas.length) {
      /* QUEM DECIDE ENTRE AS DUAS CAUSAS É O SISTEMA, NÃO ELE.
         A versão anterior listava as duas e deixava a escolha para
         quem estava lendo — e as duas pedem providências opostas.
         Mas o cliente SABE qual é: se este perfil vê o módulo
         Financeiro, ele veria os títulos caso existissem; então
         não existem. Mostrar as duas hipóteses quando uma delas é
         verificável aqui é empurrar o diagnóstico para o usuário. */
      const veFin = S.veModulo('financeiro');
      return '<tr><td colspan="7" style="background:#fafbfc;padding:10px 8px">' +
        '<div class="aviso" style="border-left-color:var(--red)">' +
        '<b>Este lançamento aponta para ' + ids.length + ' título(s), e nenhum deles está aqui.</b> ' +
        (veFin
          ? 'Seu perfil vê o módulo Financeiro, onde os títulos moram — então não é falta de ' +
            'acesso seu: os títulos não chegaram ao banco quando este fechamento foi importado.' +
            '<div class="sub" style="margin-top:6px">O valor do cabeçalho (' + U.brl(l.valor) +
            ' · ' + l.medicos + ' médico(s)) é o que foi lançado. Para recuperar: <b>importe o ' +
            'mesmo arquivo de novo</b> neste projeto e competência — o sistema vai oferecer ' +
            '<b>Substituir o fechamento anterior</b>, que cancela este cabeçalho vazio e lança ' +
            'os médicos. Não cancele antes de importar: sem o arquivo em mãos, cancelar apaga ' +
            'o único registro que sobrou.</div>'
          : 'Seu perfil <b>não vê</b> o módulo Financeiro, onde os títulos moram — pode ser só ' +
            'isso, e não falta de lançamento.' +
            '<div class="sub" style="margin-top:6px">Antes de refazer qualquer coisa, peça a ' +
            'alguém que vê o Financeiro para abrir este mesmo detalhe. Se para essa pessoa os ' +
            'médicos aparecerem, o lançamento está certo e o que falta é acesso, em ' +
            'Administração › Perfis.</div>') +
        '</div></td></tr>';
    }
    const unidadesLote = parcelas.map(unidadeDa).filter(function (u, i, a) { return a.indexOf(u) === i; });
    const vocLote = VOC[unidadesLote.length === 1 ? unidadesLote[0] : 'plantao'];
    return '<tr><td colspan="7" style="background:#fafbfc;padding:10px 8px">' +
      '<table style="margin:0"><thead><tr><th>Médico</th>' +
      '<th class="num">' + vocLote.Plur + '</th><th class="num">Horas</th><th class="num">Valor</th>' +
      '<th class="num">Pago</th><th>Situação</th><th>Como recebe</th><th></th></tr></thead><tbody>' +
      parcelas.map(function (p) {
        const itens = p.itens || [];
        const qtd = itens.reduce(function (s, i) { return s + (i.qtd || 0); }, 0);
        const min = itens.reduce(function (s, i) { return s + (i.minutos || 0); }, 0);
        const s = situacaoParcela(p, l);
        const pago = S.pagoDe(p.id);
        return '<tr><td class="desc">' + U.esc(ERP.lancamento.nomeCredor(p.credor) || '—') + '</td>' +
          '<td class="num">' + qtd + '</td>' +
          '<td class="num">' + (ehProcedimento(p) ? '—' : Math.floor(min / 60) + 'h' + String(min % 60).padStart(2, '0')) + '</td>' +
          '<td class="num">' + U.brl(p.valor) + '</td>' +
          '<td class="num">' + (pago > 0.004 ? U.brl(pago) : '—') + '</td>' +
          '<td><span class="badge ' + s.cls + '">' + s.txt + '</span>' +
            (s.motivo ? '<div class="sub">' + U.esc(s.motivo) + '</div>' : '') + '</td>' +
          /* ── COMO RECEBE, AQUI ─────────────────────────────────
             O impedimento de pagamento era descoberto duas telas
             depois, no contas a pagar, por quem não tem o arquivo
             do fechamento na mão para resolver. Quem confere o
             fechamento é quem sabe o PIX do médico. */
          (function () {
            const cr = D.credor(p.credor) || {};
            const imp = S.impedimentos(p) || [];
            const bancario = imp.filter(function (e) {
              return /chave PIX|forma de pagamento|banco, agência/.test(e); });
            const pod = S.podeMover('produtividade') || S.pode('lancar');
            if (!bancario.length) {
              return '<td class="desc"><div class="sub">' +
                (cr.forma_pagamento === 'ted'
                  ? 'banco ' + U.esc(cr.banco || '') + ' ag. ' + U.esc(cr.agencia || '')
                  : cr.pix
                    ? U.esc(cr.pix) + ' · ' + U.esc(NOME_TIPO_PIX[cr.tipo_chave] || cr.tipo_chave || 'tipo?')
                    : '—') + '</div>' +
                (pod ? '<button class="btn-ghost" data-lp-banco="' + p.id + '">trocar</button>' : '') +
                '</td>';
            }
            return '<td class="desc"><span class="badge b-cancelado">sem como pagar</span>' +
              '<div class="sub">' + U.esc(bancario.join('; ')) + '</div>' +
              (pod ? '<button class="btn-sm btn-cancelar" data-lp-banco="' + p.id + '">' +
                'Incluir dados bancários</button>' : '') + '</td>';
          })() +
          '<td class="acoes"><button class="btn-sm" data-lp-medico="' + p.id + '">' + rotuloComposicao(p) + '</button>' +
            /* BLOQUEAR E DESBLOQUEAR AQUI, os dois.
               Só o "Liberar" existia, e só aparecia em quem já
               estava bloqueado — então bloquear por falta de
               contrato só era possível no instante da importação, e
               quem descobre o contrato pendente descobre depois. */
            (S.podeMover('produtividade') || S.pode('lancar')
              ? (s.bloqueio
                  ? ' <button class="btn-sm btn-aprovar" data-lp-liberar="' + p.id + '" ' +
                    'data-lote="' + l.id + '">Liberar</button>'
                  : (pago > 0.004
                      ? ''
                      : ' <button class="btn-sm btn-cancelar" data-lp-bloquear="' + p.id + '" ' +
                        'data-lote="' + l.id + '">Bloquear</button>'))
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
        (ehProcedimento(p)
          /* PROCEDIMENTOS: a quantidade de cada um, sem horas. */
          ? '<h3 style="font-size:12px;margin:14px 0 4px">' + VOC[unidadeDa(p)].Plur + ' deste fechamento</h3>' +
            '<table class="parcelas"><thead><tr><th>' + VOC[unidadeDa(p)].colA + '</th><th>' + VOC[unidadeDa(p)].colB + '</th>' +
            '<th class="num">Qtd.</th><th class="num">Valor</th></tr></thead><tbody>' +
            itens.map(function (i) {
              return '<tr><td class="desc">' + U.esc(i.setor || '—') + '</td><td>' + U.esc(i.tipo || '—') + '</td>' +
                '<td class="num">' + (i.qtd || 0) + '</td><td class="num">' + U.brl(i.valor || 0) + '</td></tr>';
            }).join('') +
            '<tr><td colspan="2"><b>Total</b></td><td class="num"><b>' +
              itens.reduce(function (t, i) { return t + (i.qtd || 0); }, 0) + '</b></td><td class="num"><b>' +
              U.brl(p.valor) + '</b></td></tr></tbody></table>'
          : '') +
        (ehProcedimento(p) ? '' : '<h3 style="font-size:12px;margin:14px 0 4px">Plantões deste fechamento</h3>') +
        (ehProcedimento(p) ? '' : itens.length
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
            /* `render()` desenha a PRÉVIA da importação, que aqui
               não existe: ela sai no primeiro `if (!L) return`. A
               liberação acontecia e a tela ficava igual, mostrando
               "bloqueado" — até alguém trocar de aba. */
            renderLotes();
          } }]
        });
      });
    });

    /* BLOQUEAR depois de lançado. Antes só havia o caminho na
       importação: descobrir o contrato pendente no dia seguinte
       significava não ter onde segurar o pagamento. */
    document.querySelectorAll('[data-lp-bloquear]').forEach(function (b2) {
      b2.addEventListener('click', function () {
        const pid = this.dataset.lpBloquear;
        const loteId = this.dataset.lote;
        const p = S.todasParcelas().find(function (x) { return x.id === pid; });
        if (!p) return;
        const nome = ERP.lancamento.nomeCredor(p.credor) || 'o médico';
        ERP.app.modal({
          titulo: 'Bloquear pagamento de ' + nome,
          fecharTxt: 'Cancelar',
          corpo: '<div class="ajuda">O lançamento continua valendo — o custo existe —, mas este ' +
            'médico fica FORA da remessa de pagamento até alguém liberar aqui mesmo.</div>' +
            '<label for="bl-motivo">Por que está bloqueando?</label>' +
            '<input id="bl-motivo" placeholder="ex.: contrato não assinado, check-ins não confirmados">' +
            '<div id="bl-erro"></div>',
          acoes: [{ txt: 'Bloquear pagamento', cls: 'btn-cancelar', fn: function () {
            const motivo = U.val('bl-motivo').trim();
            const erro = U.el('bl-erro');
            if (!motivo) {
              if (erro) erro.innerHTML = '<div class="login-erro">Informe o motivo. ' +
                'Bloqueio sem motivo é o médico esperando sem ninguém saber por quê.</div>';
              return;
            }
            const r = S.bloquearPagamentoMedico(loteId, { titulo_id: p.titulo_id, motivo: motivo });
            if (r.erro) {
              if (erro) erro.innerHTML = '<div class="login-erro">' + U.esc(r.erro) + '</div>';
              return;
            }
            ERP.app.fecharModal();
            ERP.app.aviso('Pagamento de ' + nome + ' bloqueado.', 'ok');
            renderLotes();
          } }]
        });
      });
    });

    /* Dados bancários do médico, no lançamento já feito. Mesmo
       formulário da prévia; aqui o cadastro existe, então grava
       direto pelo store. */
    document.querySelectorAll('[data-lp-banco]').forEach(function (b2) {
      b2.addEventListener('click', function () {
        const pid = this.dataset.lpBanco;
        const p = S.todasParcelas().find(function (x) { return x.id === pid; });
        if (!p) return;
        const cr = D.credor(p.credor);
        if (!cr) return ERP.app.aviso('Este lançamento está sem cadastro de credor.', 'erro');
        formularioBancario({
          nome: cr.nome, credor: cr,
          ajuda: 'O que for gravado aqui vale para a remessa e para os próximos fechamentos, ' +
            'e fica na trilha com o valor anterior.',
          aoGravar: function (dados) {
            const r = S.informarDadosBancarios(cr.id, dados);
            if (!r.erro) { ERP.contas.render(); renderLotes(); }
            return r;
          }
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
    if (U.el('lp-f-ocultar')) U.el('lp-f-ocultar').addEventListener('change', function () {
      fLote.mostrarCanc = !this.checked; renderLotes();
    });
    document.querySelectorAll('[data-lp-editar]').forEach(function (b) {
      b.addEventListener('click', function () { editarLote(this.dataset.lpEditar); });
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

  /* ── EDITAR O LANÇAMENTO (v173) ──────────────────────────
     Dia do repasse, natureza, valor a faturar (ou "ainda não sei —
     vale a previsão") e observação, sem cancelar e lançar de novo.
     Projeto e competência não mudam aqui: trocar um dos dois é outro
     fechamento — o caminho é substituir. */
  function editarLote(id) {
    const l = S.lotesProdutividade().find(function (x) { return x.id === id; });
    if (!l) return;
    const c = D.centro(l.centro) || {};
    const ps = S.todasParcelas().filter(function (p) {
      return (l.titulo_ids || []).indexOf(p.titulo_id) > -1 && ['cancelado', 'substituido'].indexOf(p.status) < 0;
    });
    const abertas = ps.filter(function (p) { return p.status !== 'pago' && S.pagoDe(p.id) <= 0.004; });
    /* a data que mais aparece entre as que ainda podem mudar */
    const vencs = {};
    (abertas.length ? abertas : ps).forEach(function (p) { if (p.venc) vencs[p.venc] = (vencs[p.venc] || 0) + 1; });
    const vencAtual = Object.keys(vencs).sort(function (a, b) { return vencs[b] - vencs[a]; })[0] || '';
    const contaAtual = (ps[0] || {}).conta || '3.01';
    const pv = S.previsaoDe(l.centro, l.competencia);
    const confirmado = !!pv && pv.status === 'confirmada_prod';
    const andou = pv && (pv.autorizado_em || pv.liberado_em);
    const previsto = confirmado
      ? (pv.faturamento_previsto !== undefined && pv.faturamento_previsto !== null ? pv.faturamento_previsto : (c.prev_faturamento || 0))
      : (pv ? pv.faturamento : (c.prev_faturamento || 0));
    const grupo = c.grupo_faturamento || null;
    ERP.app.modal({
      titulo: 'Editar lançamento · ' + (c.curto || c.nome || '') + ' · ' + U.fComp(l.competencia),
      fecharTxt: 'Cancelar',
      corpo:
        '<div class="ajuda">' + l.medicos + ' médico(s) · ' + U.brl(l.valor) + ' de repasse. Projeto e competência ' +
          'não mudam aqui — para isso, importe o arquivo de novo e escolha <b>Substituir</b>.</div>' +
        '<label for="le-venc">Data do repasse</label>' +
        '<input type="date" id="le-venc" value="' + vencAtual + '">' +
        '<div class="ajuda">' + (abertas.length === ps.length ? 'Vale para os ' + ps.length + ' lançamento(s).'
          : 'Muda só os ' + abertas.length + ' que ainda não foram pagos; ' + (ps.length - abertas.length) +
            ' já pago(s) ficam como estão.') + ' O que estiver em pagamento (na aprovação ou na remessa) também fica.</div>' +
        '<label for="le-conta">Natureza</label><select id="le-conta">' +
          D.plano.filter(function (p) { return p.nivel === 2 && (p.pai === '3' || p.pai === '4'); }).map(function (p) {
            return '<option value="' + p.cod + '"' + (p.cod === contaAtual ? ' selected' : '') + '>' +
              U.esc(p.cod + ' ' + p.nome) + '</option>';
          }).join('') + '</select>' +
        '<fieldset class="le-fat" style="border:1px solid var(--line2);padding:8px 10px;margin:10px 0 0">' +
          '<legend style="font-size:11.5px;padding:0 4px">Valor a faturar' + (grupo ? ' desta especialidade' : '') + '</legend>' +
          (andou
            ? '<div class="ajuda">Este faturamento já foi ' + (pv.liberado_em ? 'liberado' : 'autorizado') + ' (' +
              U.brl(pv.faturamento) + '). Para mudar o valor, desfaça na Esteira do faturamento.</div>'
            : '<label style="font-weight:400;display:flex;gap:7px;align-items:center;margin:2px 0">' +
                '<input type="radio" name="le-modo" value="confirmar" style="width:auto"' + (confirmado ? ' checked' : '') + '> ' +
                'Valor confirmado:</label>' +
              '<input class="num" id="le-fat" inputmode="decimal" value="' +
                U.num(confirmado ? pv.faturamento : (previsto || 0)) + '"' + (confirmado ? '' : ' disabled') + '>' +
              '<label style="font-weight:400;display:flex;gap:7px;align-items:center;margin:8px 0 2px">' +
                '<input type="radio" name="le-modo" value="previsao" style="width:auto"' + (confirmado ? '' : ' checked') + '> ' +
                'Ainda não sei — deixar para depois e usar a previsão da aba Faturamento (' + U.brl(previsto || 0) + ')</label>' +
              '<div class="ajuda">' + (confirmado
                ? 'Hoje está confirmado em <b>' + U.brl(pv.faturamento) + '</b>.'
                : 'Hoje não há valor confirmado: vale a previsão.') + '</div>') +
        '</fieldset>' +
        '<label for="le-obs">Observação</label><input id="le-obs" value="' + U.esc(l.observacao || '') + '">',
      aoAbrir: function () {
        document.querySelectorAll('[name="le-modo"]').forEach(function (r) {
          r.addEventListener('change', function () {
            const campo = U.el('le-fat');
            if (campo) { campo.disabled = this.value !== 'confirmar'; if (!campo.disabled) campo.focus(); }
          });
        });
      },
      acoes: [{ txt: 'Salvar', cls: 'btn-aprovar', fn: function () {
        const modoEl = document.querySelector('[name="le-modo"]:checked');
        const modo = modoEl ? modoEl.value : null;
        let valorFat = null;
        if (modo === 'confirmar') {
          valorFat = U.parseValor(U.val('le-fat'));
          if (!(valorFat > 0)) return ERP.app.aviso('Informe o valor a faturar, ou escolha "Ainda não sei".', 'erro');
        }
        const r = S.editarLoteProdutividade(l.id, {
          vencimento: U.val('le-venc') || undefined, conta: U.val('le-conta'), observacao: U.val('le-obs')
        });
        if (ERP.app.erroDoRetorno(r)) return;
        const feito = r.mudou.slice();
        if (modo === 'confirmar' && (!confirmado || Math.abs(valorFat - pv.faturamento) > 0.004)) {
          const rf = S.confirmarFaturamentoProdutividade({ centro: l.centro, competencia: l.competencia,
            faturamento: valorFat, produtividade: l.valor, lote: l.id, forcar: true });
          if (ERP.app.erroDoRetorno(rf)) return;
          feito.push('valor a faturar ' + U.brl(valorFat));
        } else if (modo === 'previsao' && confirmado) {
          const rv = S.voltarFaturamentoParaPrevisao(l.centro, l.competencia);
          if (ERP.app.erroDoRetorno(rv)) return;
          feito.push('valor a faturar voltou à previsão (' + U.brl(rv.previsto) + ')');
        }
        ERP.app.fecharModal();
        renderLotes();
        ERP.contas.render();
        ERP.app.atualizarContadores();
        ERP.app.aviso(feito.length ? 'Lançamento atualizado: ' + feito.join(', ') + '.' +
            (r.venc_mantidos ? ' ' + r.venc_mantidos + ' já pago(s) ou em pagamento mantiveram a data.' : '')
          : 'Nada foi alterado.', feito.length ? 'ok' : 'erro');
      } }]
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
        zerosAceitos = null;   // e a dos médicos com valor zerado também
        render();
      } catch (err) {
        /* ARQUIVO RECUSADO LIMPA A TELA.

           A prévia do arquivo ANTERIOR continuava no lugar: quem
           subia um arquivo que o leitor recusa via a tabela cheia,
           com o aviso vermelho sumindo depois de alguns segundos, e
           tinha tudo para clicar em "gerar" achando que era o
           arquivo novo — lançando o fechamento do mês errado, do
           hospital errado. Recusou, a tela fica vazia e diz por quê,
           que é o estado honesto. */
        lote = null;
        complementar = null;
        const saida = U.el('pr-saida');
        if (saida) {
          saida.innerHTML = '<div class="aviso" style="margin:10px 0">' +
            '<b>Não consegui ler este arquivo.</b><br>' + U.esc(err.message) + '</div>';
        }
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
  /* TODAS as abas de plantões, não a primeira.

     O arquivo do hospital separa o detalhe por especialidade:
     AMBULATÓRIO, OBSTETRICIA, USG — cada uma com a mesma estrutura,
     cada uma com os seus médicos. A leitura pegava a PRIMEIRA que
     casasse e parava.

     No fechamento de HPM de agosto/setembro isso significava ler a
     aba AMBULATÓRIO, com um médico, e ignorar as outras duas, com
     dezenove. A tela oferecia "Gerar 1 lançamento" para um
     fechamento de vinte médicos.

     Não era silencioso de todo — a conferência contra a aba
     FINANCEIRO acusava a diferença de valor. Mas acusava como
     divergência de CENTAVOS acusaria, e a resposta certa para
     "faltam dezenove médicos" não é um número vermelho: é ler as
     três abas.

     As abas entram em sequência, e o parser já trata cada bloco
     ("nome do médico" seguido das linhas dele) por conta própria —
     é a mesma coisa que uma aba só com tudo dentro. Médico que
     aparece em duas especialidades soma as duas, que é o certo:
     ele recebe um título com a produtividade inteira do mês. */
  function acharAbas(wb) {
    let financeiro = null;
    const plantoes = [];
    const nomesPlantoes = [];
    wb.SheetNames.forEach(function (n) {
      const l = linhasDe(wb, n);
      const cabecalhos = l.slice(0, 20).map(function (r) {
        return r.map(function (v) { return txt(v).toLowerCase(); }).join('|');
      }).join(' ');
      if (!financeiro && /profissional/.test(cabecalhos) &&
          /(chave pix|documento)/.test(cabecalhos)) { financeiro = l; return; }
      /* ── ABA SEM COLUNA DE HORÁRIO TAMBÉM É ABA DE PLANTÕES ──

         Exigir "entrada" ou "saída" descartava a aba COORDENAÇÃO
         inteira: ela tem só "Setor | Tipo | Valor", porque
         coordenação não tem plantão. A planilha do SAMU traz
         REGULAÇÃO, USA 02, USA 04 e COORDENAÇÃO — as três primeiras
         entravam e a quarta sumia sem um aviso, levando junto os
         R$ 2.000,00 do coordenador.

         O que define uma aba de lançamento é ter SETOR e VALOR; as
         colunas de horário são o que distingue plantão de
         coordenação, e isso quem resolve é o leitor, linha a
         linha. */
      if (/setor/.test(cabecalhos) && /valor/.test(cabecalhos)) {
        plantoes.push.apply(plantoes, l);
        nomesPlantoes.push(n);
      }
    });
    // sobrou uma aba só: ela é a de plantões
    if (!plantoes.length) {
      const outra = wb.SheetNames.find(function (n) { return linhasDe(wb, n) !== financeiro; });
      if (outra && wb.SheetNames.length > 1) {
        plantoes.push.apply(plantoes, linhasDe(wb, outra));
        nomesPlantoes.push(outra);
      }
    }
    return { plantoes: plantoes.length ? plantoes : null, financeiro: financeiro,
             abasPlantoes: nomesPlantoes };
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

  /* Acento fora, para comparar cabeçalho e nome de mês sem depender
     de como foram digitados ("Duração"/"Duracao", "Março"/"Marco"). */
  const semAcento = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  /* ── O CABEÇALHO MANDA, NÃO A POSIÇÃO ──────────────────

     O leitor contava colunas a partir do "Setor": Duração em
     col0+4, Valor em col0+5. Funcionava enquanto todo arquivo
     tivesse o mesmo desenho. A planilha de NEONATOLOGIA do HMSA tem
     "Início" e "Fim" a mais, e com isso a Duração era lida da
     coluna "Entrada" e o Valor da coluna "Saída" — todo plantão
     entraria zerado, com hora errada, sem nada acusar.

     Pior: o cabeçalho muda DENTRO do mesmo arquivo. O primeiro
     bloco daquela planilha é a coordenação, com "Setor | Tipo |
     Valor" e nenhuma coluna de horário; os outros médicos têm o
     cabeçalho completo. Por isso o mapa é refeito a cada cabeçalho
     encontrado, e não uma vez no começo. */
  function mapearColunas(cab) {
    const limpo = v => semAcento(txt(v)).toLowerCase().replace(/\s+/g, ' ').trim();
    const achar = function () {
      const alts = Array.prototype.slice.call(arguments);
      return (cab || []).findIndex(function (v) {
        const t = limpo(v);
        return t && alts.some(function (x) { return t === x || t.indexOf(x) === 0; });
      });
    };
    return { setor: achar('setor'), tipo: achar('tipo'), duracao: achar('duracao'),
      valor: achar('valor'), inicio: achar('inicio'), fim: achar('fim'),
      entrada: achar('entrada'), saida: achar('saida') };
  }

  const MESES = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7,
    agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
    jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
  const doisDig = n => String(n).padStart(2, '0');

  /* A competência sai da data FINAL do período. */
  function compDeData(d) {
    const pf = String(d || '').split('/');
    if (pf.length === 3) {
      const ano = pf[2].length === 2 ? '20' + pf[2] : pf[2];
      return ano + '-' + pf[1].padStart(2, '0');
    }
    if (pf.length === 2) {
      /* Período sem ano ("01/07 a 31/07") — assume o ano corrente; se
         isso jogar a competência pro futuro, é do ano anterior:
         produtividade é sempre de um período que já aconteceu, nunca
         de um mês que ainda não chegou. */
      const anoAtual = U.mesAtual().slice(0, 4);
      const mes = pf[1].padStart(2, '0');
      const c = anoAtual + '-' + mes;
      return c > U.mesAtual() ? (Number(anoAtual) - 1) + '-' + mes : c;
    }
    return '';
  }

  /* ── O PERÍODO, EM QUALQUER DAS FORMAS QUE OS ARQUIVOS USAM ──

     Só o intervalo de datas era aceito ("21/08/2026 - 20/09/2026",
     como escreve o arquivo da HPM). A planilha do HMSA escreve
     "OUTUBRO 2026", e como o leitor usava o período como PORTEIRA —
     nada era lido antes de achá-lo —, o arquivo inteiro passava sem
     uma linha ser lida e a tela respondia "0 lançamento(s)". Quatro
     mensagens de erro, uma causa só. */
  function lerPeriodo(t) {
    t = txt(t).trim();
    if (!t) return null;
    let m = t.match(/^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*(?:~|-|a|at[eé])\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)$/i);
    if (m) { const c = compDeData(m[2]); return c ? { texto: t, competencia: c } : null; }
    /* A flag `i` faltava, e com ela o "DE" MAIÚSCULO não casava:
       "OUTUBRO DE 2026" — que é como o arquivo do SAMU escreve —
       passava direto, e o sistema dizia que não achou competência
       nenhuma. "outubro de 2026" em minúsculas funcionava, o que
       torna o defeito ainda mais difícil de acreditar. */
    m = t.match(/^([A-Za-zÀ-ÿ]{3,12})\s*(?:[\/ ]\s*)?(?:de\s+)?(\d{4})$/i);
    if (m) {
      const n = MESES[semAcento(m[1]).toLowerCase()];
      if (n) return { texto: t, competencia: m[2] + '-' + doisDig(n) };
    }
    m = t.match(/^(\d{1,2})\/(\d{4})$/);
    if (m && +m[1] >= 1 && +m[1] <= 12) return { texto: t, competencia: m[2] + '-' + doisDig(+m[1]) };
    return null;
  }

  /* Recalcula a contagem de plantões a partir da classificação de
     cada grupo. Uma implementação só, usada na leitura e de novo a
     cada reclassificação na tela — contagem que se soma em dois
     lugares diverge no primeiro clique. */
  function aplicarClasse(grupos, medicos) {
    const lista = Array.isArray(grupos)
      ? grupos : Object.keys(grupos).map(function (k) { return grupos[k]; });
    Object.keys(medicos).forEach(function (k) { medicos[k].plantoes = 0; });
    lista.forEach(function (g) {
      g.plantoes = g.coordenacao ? 0 : (g.linhas_origem || 0);
      const md = medicos[chaveNome(g.medico)];
      if (md) md.plantoes += g.plantoes;
    });
  }

  /* ══ FORMATO DE PROCEDIMENTOS (Dr Consulta e afins) ════════════

     Projetos em que o médico ganha por PROCEDIMENTO, não por plantão.
     O arquivo tem duas abas:
       • PRODUTIVIDADE — um bloco por médico ("Nome — CRM RJ-…"), com
         Data | Código | Paciente | Procedimento | Repasse, e TOTAL;
       • FINANCEIRO — uma linha por médico: CRM, CPF, Chave PIX,
         quantidade, Valor a pagar e Status do contrato ("SCP |
         ASSINADO"); e um RESUMO com o total de repasse.

     A saída é a MESMA estrutura do leitor de plantões — grupos de
     médico × (setor, tipo) com quantidade e valor —, para que títulos,
     travas, bloqueio e confirmação sigam pelo caminho já provado.
     Aqui o "setor" é a especialidade e o "tipo" é o procedimento; a
     quantidade é quantas vezes ele aparece no bloco do médico.

     O NOME DO PACIENTE NÃO É LIDO. A coluna existe no arquivo, mas a
     produtividade só precisa de quantos procedimentos de cada tipo; o
     ERP protege dado de paciente (a coluna `paciente` é fechada), e
     guardá-lo aqui no meio dos itens do título abriria um caminho em
     volta dessa proteção. */
  const semAc = function (v) { return semAcento(txt(v)).toLowerCase().replace(/\s+/g, ' ').trim(); };
  function linhaCabProcedimentos(linha) {
    const c = (linha || []).map(semAc);
    return c.indexOf('procedimento') > -1 && c.indexOf('repasse') > -1;
  }
  function ehProcedimentos(wb) {
    return wb.SheetNames.some(function (n) {
      return linhasDe(wb, n).slice(0, 40).some(linhaCabProcedimentos);
    });
  }
  function lerProcedimentos(wb, arquivo) {
    let projeto = '', especialidade = '', periodo = '', competenciaLida = '';
    let totalArquivo = 0, totalResumo = 0, procResumo = 0;
    const grupos = {}, medicos = {}, pagto = {}, abasLidas = [];
    const compsDasDatas = {};

    /* Títulos do topo de cada aba: projeto, especialidade, período. */
    wb.SheetNames.forEach(function (nome) {
      linhasDe(wb, nome).slice(0, 8).forEach(function (r) {
        r.forEach(function (v) {
          const t = txt(v).replace(/\s+/g, ' ');
          if (!t) return;
          const p = lerPeriodo(t);
          if (p) { if (!periodo) { periodo = p.texto; competenciaLida = p.competencia; } return; }
          let m = t.match(/^FINANCEIRO\s*-\s*(.+?)[\s-]*$/i);
          if (m && !projeto) { projeto = m[1].trim(); return; }
          m = t.match(/^PROCEDIMENTOS?\s*-\s*(.+?)[\s-]*$/i);
          if (m && !especialidade) especialidade = m[1].trim();
        });
      });
    });

    /* Aba(s) de procedimentos. */
    wb.SheetNames.forEach(function (nome) {
      const l = linhasDe(wb, nome);
      if (!l.slice(0, 40).some(linhaCabProcedimentos)) return;
      abasLidas.push(nome);
      let medico = null, crm = '', cols = null;
      l.forEach(function (linha) {
        const cheias = [];
        (linha || []).forEach(function (v, j) { if (txt(v) !== '') cheias.push(j); });
        if (!cheias.length) return;
        if (linhaCabProcedimentos(linha)) {
          const c = linha.map(semAc);
          cols = { data: c.indexOf('data'), proc: c.indexOf('procedimento'), valor: c.indexOf('repasse') };
          return;
        }
        const primeira = txt(linha[cheias[0]]);
        /* Total geral do arquivo: o número na coluna do repasse (ou o
           último número da linha, se o cabeçalho ainda não apareceu). */
        if (/^TOTAL GERAL$/i.test(semAcento(primeira))) {
          let v = cols && cols.valor > -1 ? valorNum(linha[cols.valor]) : 0;
          if (!v) for (let k = linha.length - 1; k >= 0; k--) { v = valorNum(linha[k]); if (v) break; }
          totalArquivo = Math.round((totalArquivo + v) * 100) / 100;
          return;
        }
        if (/^TOTAL\b/i.test(semAcento(primeira))) return;          // rodapé do bloco
        /* Nome do médico: uma célula só, "Nome — CRM RJ-…". */
        if (cheias.length === 1) {
          const m = primeira.match(/^(.*?)\s+[—–-]+\s+CRM\b\s*:?\s*(.*)$/i);
          if (m) {
            medico = m[1].trim(); crm = m[2].trim();
            medicos[chaveNome(medico)] = medicos[chaveNome(medico)] ||
              { nome: medico, crm: crm, total: 0, plantoes: 0 };
          }
          return;
        }
        if (!medico || !cols || cols.proc < 0) return;
        const proc = txt(linha[cols.proc]).replace(/\s+/g, ' ');
        if (!proc) return;
        const val = cols.valor > -1 ? valorNum(linha[cols.valor]) : 0;
        /* A data do atendimento ("28/10/2026, 12:30") diz a competência
           quando o cabeçalho não diz — e denuncia procedimento de outro
           mês misturado no fechamento. */
        if (cols.data > -1) {
          const d = String(txt(linha[cols.data])).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (d) { const cp = d[3] + '-' + doisDig(+d[2]); compsDasDatas[cp] = (compsDasDatas[cp] || 0) + 1; }
        }
        const setor = especialidade || 'Procedimentos';
        const k = medico + '||' + setor + '||' + proc;
        const gr = grupos[k] = grupos[k] || { medico: medico, crm: crm, setor: setor, tipo: proc,
          linhas_origem: 0, plantoes: 0, minutos: 0, valor: 0,
          coordenacao: false, coordenacao_sugerida: false };
        gr.linhas_origem++;
        gr.valor = Math.round((gr.valor + val) * 100) / 100;
        const md = medicos[chaveNome(medico)];
        md.total = Math.round((md.total + val) * 100) / 100;
      });
    });
    aplicarClasse(grupos, medicos);

    /* Aba FINANCEIRO: um médico por linha, e o RESUMO embaixo. */
    wb.SheetNames.forEach(function (nome) {
      const l = linhasDe(wb, nome);
      let m = null;
      l.forEach(function (linha) {
        const c = (linha || []).map(semAc);
        if (c.indexOf('medico') > -1 && (c.indexOf('valor a pagar') > -1 || c.indexOf('chave pix') > -1)) {
          const ach = function (nomeCol) { return c.indexOf(nomeCol); };
          m = { nome: ach('medico'), crm: ach('crm'), cpf: ach('cpf'), pix: ach('chave pix'),
            qtd: c.findIndex(function (v) { return v.indexOf('proc') === 0; }),
            valor: ach('valor a pagar'), status: c.findIndex(function (v) { return v.indexOf('status') === 0; }) };
          return;
        }
        /* RESUMO: rótulo numa célula, número na seguinte. */
        const rot = c.findIndex(function (v) { return v === 'total de repasse' || v.indexOf('n de procedimentos') === 0 || v.indexOf('no de procedimentos') === 0 || v.indexOf('nº de procedimentos') === 0; });
        if (rot > -1) {
          let n = 0;
          for (let k = rot + 1; k < linha.length; k++) { n = valorNum(linha[k]); if (n) break; }
          if (c[rot] === 'total de repasse') totalResumo = n; else procResumo = n;
          return;
        }
        if (!m) return;
        const nomeMed = txt(linha[m.nome]);
        if (!nomeMed || /^(TOTAL|RESUMO)/i.test(semAcento(nomeMed))) return;
        const status = m.status > -1 ? txt(linha[m.status]) : '';
        pagto[chaveNome(nomeMed)] = {
          observacao: status,
          regime: S.regimeDeTexto(status),
          razao_social: '',
          crm: m.crm > -1 ? txt(linha[m.crm]) : '',
          documento: m.cpf > -1 ? txt(linha[m.cpf]) : '',
          tipo_chave: '',
          pix: m.pix > -1 ? txt(linha[m.pix]) : '',
          valor: m.valor > -1 ? valorNum(linha[m.valor]) : 0,
          qtd_arquivo: m.qtd > -1 ? valorNum(linha[m.qtd]) : 0
        };
      });
    });

    const linhas = Object.keys(grupos).map(function (k) { return grupos[k]; })
      .sort(function (a, b) { return a.medico.localeCompare(b.medico) || a.tipo.localeCompare(b.tipo); });
    const soma = Math.round(linhas.reduce(function (s, l) { return s + l.valor; }, 0) * 100) / 100;
    const somaFin = Math.round(Object.keys(pagto).reduce(function (s, k) { return s + pagto[k].valor; }, 0) * 100) / 100;
    const qtdLida = linhas.reduce(function (s, l) { return s + l.linhas_origem; }, 0);

    /* Sem período no cabeçalho, a competência sai das DATAS dos
       atendimentos — é o arquivo dizendo, não um palpite. */
    const compsDatas = Object.keys(compsDasDatas).sort(function (a, b) { return compsDasDatas[b] - compsDasDatas[a]; });
    if (!competenciaLida && compsDatas.length) competenciaLida = compsDatas[0];
    const competencia = competenciaLida || '';
    const foraDoMes = Object.keys(compsDasDatas).filter(function (c) { return c !== competencia; })
      .reduce(function (s, c) { return s + compsDasDatas[c]; }, 0);

    /* O que mais o arquivo imprime e precisa bater com a soma. */
    const conferencias = [];
    if (totalResumo > 0) conferencias.push({ rotulo: 'Resumo · total de repasse', valor: totalResumo, dinheiro: true,
      diverge: Math.abs(totalResumo - soma) > 0.01 });
    if (procResumo > 0) conferencias.push({ rotulo: 'Resumo · nº de procedimentos', valor: procResumo, dinheiro: false,
      diverge: procResumo !== qtdLida });

    return {
      formato: 'procedimentos',
      arquivo: arquivo, projeto: projeto, especialidade: especialidade,
      /* A referência do título leva a ESPECIALIDADE: o mesmo projeto
         manda um arquivo por especialidade no mesmo mês, e sem ela os
         arquivos teriam a mesma referência e pareceriam repetidos. */
      ref_projeto: especialidade ? projeto + ' ' + especialidade : projeto,
      unidade: projeto, periodo: periodo || (competencia ? U.fComp(competencia) : ''),
      competencia: competencia,
      linhas: linhas, medicos: medicos, pagto: pagto,
      abasPlantoes: abasLidas,
      periodo_ausente: !competencia,
      soma: soma, somaFin: somaFin, totalArquivo: totalArquivo,
      conferencias: conferencias, qtd_procedimentos: qtdLida,
      fora_do_mes: foraDoMes
    };
  }

  /* ── HONORÁRIOS DE LAUDOS (RADIOLOGIA) — v174 ───────────

     Um médico por linha na aba FINANCEIRO: CRM, dados do PIX, total
     de laudos, valor e a quantidade por prioridade (Normal, Urgência,
     Emergência), com a tarifa de cada uma impressa logo acima do
     cabeçalho. Embaixo, um bloco COORDENAÇÃO com quem recebe por
     coordenar e o valor, e o TOTAL PRODUTIVIDADE.

     SÓ A ABA FINANCEIRO É LIDA. A outra aba é o relatório analítico
     do PACS, exame por exame, com o NOME DO PACIENTE em cada linha —
     não entra no sistema, nem para conferir. */
  const cabLaudos = function (linha) {
    const c = (linha || []).map(semAc);
    return c.indexOf('profissional') > -1 && c.some(function (v) { return v.indexOf('total de laudos') === 0; });
  };
  function ehLaudos(wb) {
    return wb.SheetNames.some(function (n) { return linhasDe(wb, n).slice(0, 15).some(cabLaudos); });
  }
  function lerLaudos(wb, arquivo) {
    const aba = wb.SheetNames.find(function (n) { return linhasDe(wb, n).slice(0, 15).some(cabLaudos); });
    const l = linhasDe(wb, aba);
    const iCab = l.findIndex(cabLaudos);
    const cab = l[iCab].map(semAc);
    const col = function (nome) { return cab.findIndex(function (v) { return v.indexOf(nome) === 0; }); };
    const c = { nome: col('profissional'), crm: col('crm'), tipo: col('documento'), cpf: col('cpf'),
      pix: col('chave pix'), qtd: col('total de laudos'), valor: col('valor') };
    /* As prioridades são as colunas depois do Valor; a tarifa de cada
       uma, quando o arquivo traz, está na linha de cima. */
    const prioridades = [];
    for (let j = c.valor + 1; j < cab.length; j++) {
      if (!cab[j]) continue;
      const tarifa = iCab > 0 ? valorNum((l[iCab - 1] || [])[j]) : 0;
      prioridades.push({ col: j, nome: txt(l[iCab][j]).trim(), tarifa: tarifa });
    }
    /* Topo: projeto e período. */
    let projeto = '', periodo = '', competencia = '';
    l.slice(0, iCab).forEach(function (r) {
      (r || []).forEach(function (v) {
        const t = txt(v).replace(/\s+/g, ' ').trim();
        if (!t) return;
        const p = lerPeriodo(t);
        if (p) { if (!periodo) { periodo = p.texto; competencia = p.competencia; } return; }
        if (/^gerado em\b/i.test(t) || /^FINANCEIRO$/i.test(t) || /^\d+([.,]\d+)?$/.test(t)) return;
        if (!projeto) projeto = t;
      });
    });
    const grupos = {}, medicos = {}, pagto = {}, notas = [];
    let modo = 'laudos', totalArquivo = 0, qtdImpressa = 0, valorImpresso = 0, qtdLida = 0;
    const limparNome = function (v) { return txt(v).replace(/^\s*\d+\s*[-.)]?\s+/, '').replace(/\s+/g, ' ').trim(); };
    const grupo = function (medico, crm, tipo, coord) {
      const k = medico + '||' + tipo;
      return grupos[k] = grupos[k] || { medico: medico, crm: crm, setor: projeto || 'Laudos', tipo: tipo,
        linhas_origem: 0, plantoes: 0, minutos: 0, valor: 0, coordenacao: !!coord, coordenacao_sugerida: false };
    };
    for (let i = iCab + 1; i < l.length; i++) {
      const r = l[i] || [];
      const cel = r.map(semAc);
      if (!cel.some(Boolean)) continue;
      if (cel.indexOf('coordenacao') > -1) { modo = 'coord'; continue; }
      /* TOTAL PRODUTIVIDADE: o último número da linha. */
      if (cel.some(function (v) { return v === 'total' || v.indexOf('total produtividade') === 0; }) &&
          cel.some(function (v) { return v.indexOf('produtividade') > -1; })) {
        for (let k = r.length - 1; k >= 0; k--) { const n = valorNum(r[k]); if (n) { totalArquivo = n; break; } }
        modo = 'fim';
        continue;
      }
      if (modo === 'fim') { const t = txt(r.find(function (v) { return txt(v); })); if (t) notas.push(t.trim()); continue; }
      const medico = limparNome(r[c.nome]);
      if (!medico) {
        /* Linha sem nome e com números: o total do bloco de laudos. */
        if (modo === 'laudos' && c.qtd > -1 && valorNum(r[c.qtd])) {
          qtdImpressa = valorNum(r[c.qtd]); valorImpresso = valorNum(r[c.valor]);
        }
        continue;
      }
      const crm = c.crm > -1 ? txt(r[c.crm]).trim() : '';
      const valor = valorNum(r[c.valor]);
      const md = medicos[chaveNome(medico)] = medicos[chaveNome(medico)] || { nome: medico, crm: crm, total: 0, plantoes: 0 };
      if (!md.crm && crm) md.crm = crm;
      md.total = Math.round((md.total + valor) * 100) / 100;
      if (modo === 'coord') {
        const g = grupo(medico, crm, 'Coordenação', true);
        g.linhas_origem++; g.valor = Math.round((g.valor + valor) * 100) / 100;
      } else {
        const total = c.qtd > -1 ? valorNum(r[c.qtd]) : 0;
        qtdLida += total;
        /* Por prioridade, com o valor pela tarifa; o que a tarifa não
           explica vira uma linha de AJUSTE, à vista — não some na soma. */
        let explicado = 0, somaQtd = 0;
        const comTarifa = prioridades.length && prioridades.every(function (p) { return p.tarifa > 0; });
        prioridades.forEach(function (p) {
          const q = valorNum(r[p.col]);
          if (!q) return;
          somaQtd += q;
          const g = grupo(medico, crm, 'Laudos · ' + p.nome, false);
          g.linhas_origem += q;
          const v = comTarifa ? Math.round(q * p.tarifa * 100) / 100 : 0;
          g.valor = Math.round((g.valor + v) * 100) / 100;
          explicado += v;
        });
        if (!prioridades.length || !comTarifa || somaQtd !== total) {
          /* Sem tarifa (ou quantidades que não fecham): uma linha só,
             com o total de laudos e o valor do arquivo. */
          Object.keys(grupos).forEach(function (k) {
            if (grupos[k].medico === medico && !grupos[k].coordenacao) delete grupos[k];
          });
          const g = grupo(medico, crm, 'Laudos', false);
          g.linhas_origem += total; g.valor = Math.round((g.valor + valor) * 100) / 100;
        } else {
          const dif = Math.round((valor - explicado) * 100) / 100;
          if (Math.abs(dif) > 0.004) {
            const g = grupo(medico, crm, 'Ajuste', false);
            g.valor = Math.round((g.valor + dif) * 100) / 100;
          }
        }
      }
      /* Pagamento: a coluna "Documento" deste arquivo é o TIPO da
         chave PIX (CPF, CELULAR, EMAIL); o documento é a coluna CPF. */
      const ja = pagto[chaveNome(medico)];
      if (ja) { ja.valor = Math.round((ja.valor + valor) * 100) / 100; continue; }
      pagto[chaveNome(medico)] = {
        observacao: '', regime: S.regimeDeTexto(''), razao_social: '', crm: crm,
        documento: c.cpf > -1 ? txt(r[c.cpf]).trim() : '',
        tipo_chave: c.tipo > -1 ? txt(r[c.tipo]).trim() : '',
        pix: c.pix > -1 ? txt(r[c.pix]).trim() : '',
        valor: valor
      };
    }
    aplicarClasse(grupos, medicos);
    const linhas = Object.keys(grupos).map(function (k) { return grupos[k]; })
      .sort(function (a, b) { return a.medico.localeCompare(b.medico) || a.tipo.localeCompare(b.tipo); });
    const soma = Math.round(linhas.reduce(function (t, x) { return t + x.valor; }, 0) * 100) / 100;
    const somaFin = Math.round(Object.keys(pagto).reduce(function (t, k) { return t + pagto[k].valor; }, 0) * 100) / 100;
    const somaLaudos = Math.round(linhas.filter(function (x) { return !x.coordenacao; })
      .reduce(function (t, x) { return t + x.valor; }, 0) * 100) / 100;
    const conferencias = [];
    if (qtdImpressa) conferencias.push({ rotulo: 'Total de laudos impresso', valor: qtdImpressa, dinheiro: false,
      diverge: qtdImpressa !== qtdLida });
    if (valorImpresso) conferencias.push({ rotulo: 'Valor dos laudos impresso', valor: valorImpresso, dinheiro: true,
      diverge: Math.abs(valorImpresso - somaLaudos) > 0.01 });
    return {
      formato: 'laudos', arquivo: arquivo, projeto: projeto, especialidade: '', ref_projeto: projeto,
      unidade: projeto, periodo: periodo, competencia: competencia,
      linhas: linhas, medicos: medicos, pagto: pagto, abasPlantoes: [aba],
      periodo_ausente: !competencia,
      soma: soma, somaFin: somaFin, totalArquivo: totalArquivo,
      conferencias: conferencias, qtd_procedimentos: qtdLida, fora_do_mes: 0, notas: notas
    };
  }

  function ler(wb, arquivo) {
    if (ehLaudos(wb)) return lerLaudos(wb, arquivo);
    if (ehProcedimentos(wb)) return lerProcedimentos(wb, arquivo);
    const abas = acharAbas(wb);
    const prod = abas.plantoes;
    if (!prod) {
      throw new Error('não achei a aba com os plantões (preciso de colunas Setor, Entrada e Saída)');
    }

    /* A coluna onde tudo começa muda de arquivo para arquivo: em uns o
       Setor está na coluna B, em outros na A. Descobre pelo cabeçalho. */
    /* ── NÃO EXISTE "A COLUNA" QUANDO SÃO VÁRIAS ABAS ──────

       Havia um `col0` só, achado na primeira linha com "Setor" e
       usado no arquivo inteiro. Funciona com uma aba; com várias,
       não: cada aba pode começar numa coluna diferente, e começa.
       Na planilha do SAMU, o leitor entrega REGULAÇÃO a partir da
       coluna B (que vira o índice 0) e COORDENAÇÃO a partir da
       coluna A. Com um índice só, a aba de coordenação era lida uma
       coluna à esquerda: o título "COORDENAÇÃO SAMU" entrava como
       se fosse um médico, e o David — o coordenador de verdade,
       R$ 2.000,00 — não entrava de jeito nenhum.

       Então nada mais é lido por índice fixo. As colunas de
       lançamento saem do cabeçalho do bloco, e a linha do nome do
       médico é reconhecida pela FORMA dela: uma célula só, seguida
       de uma linha com duas ou mais. */
    const cheiasDe = function (linha) {
      const c = [];
      (linha || []).forEach(function (v, j) { if (txt(v) !== '') c.push(j); });
      return c;
    };
    /* A próxima linha com conteúdo tem duas ou mais células? É isso
       que separa o NOME DO MÉDICO (seguido do cabeçalho do bloco ou
       direto dos lançamentos) do TÍTULO DA ABA, que é seguido de
       outro título sozinho. */
    const abreBloco = function (i) {
      for (let k = i + 1; k < prod.length && k <= i + 6; k++) {
        const c = cheiasDe(prod[k]);
        if (!c.length) continue;
        return c.length >= 2;
      }
      return false;
    };

    /* ── O PERÍODO, ANTES DE QUALQUER COISA, E EM VARREDURA PRÓPRIA ──

       Ele era porteira: o laço só começava a ler depois de encontrar
       uma linha no formato de intervalo de datas. Arquivo que
       escreve o período de outro jeito atravessava inteiro sem uma
       linha lida, e a tela dizia "0 lançamento(s)" sem dizer por
       quê. Agora a busca é uma varredura à parte, aceita as formas
       conhecidas, e NÃO ACHAR É MOTIVO DE RECUSA — não de silêncio. */
    let projeto = '', unidade = '', periodo = '', competenciaLida = '', totalArquivo = 0;
    for (let i = 0; i < prod.length && !periodo; i++) {
      const linha = prod[i] || [];
      for (let j = 0; j < linha.length; j++) {
        const achou = lerPeriodo(linha[j]);
        if (!achou) continue;
        periodo = achou.texto;
        competenciaLida = achou.competencia;
        /* O projeto é a linha de texto logo acima do período. */
        for (let k = i - 1; k >= 0; k--) {
          const acima = txt((prod[k] || [])[j]) || txt((prod[k] || [])[col0]);
          if (acima && acima.toUpperCase().indexOf('PRODUTIVIDADE') === -1) { projeto = acima; break; }
        }
        break;
      }
    }
    /* ── NÃO ACHAR O PERÍODO NÃO É MOTIVO DE RECUSA ────────

       A v160 passou a RECUSAR o arquivo sem período, para não
       importar calado na competência errada. Resolveu o silêncio e
       criou um beco: planilha cujo cabeçalho escreve a data de um
       jeito que o sistema não conhece não entra de jeito nenhum, e
       quem está fechando o mês fica sem saída.

       O meio-termo é deixar a pessoa dizer. O arquivo é lido
       inteiro, a competência fica VAZIA e marcada, e a tela pede
       que ela seja escolhida antes de gerar qualquer coisa. Nem
       adivinhação, nem porta fechada. */
    const periodoAusente = !periodo;
    // a aba financeira costuma trazer o hospital acima da especialidade
    if (abas.financeiro) {
      const topo = abas.financeiro.slice(0, 6)
        .map(function (r) { return txt(r[0]) || txt(r[1]) || txt(r[2]); })
        .filter(function (v) { return v && !/^FINANCEIRO$/i.test(v.trim()) && !lerPeriodo(v); });
      if (topo.length) unidade = topo[0];
    }

    const grupos = {};   // medico|setor|tipo
    const medicos = {};  // nome -> { crm, total }
    let medico = null, crm = '';
    /* O mapa de colunas do bloco em que estamos. Começa vazio: nada é
       lido como plantão antes de um cabeçalho dizer onde cada coisa
       está. */
    let cols = null;

    prod.forEach(function (linha, i) {
      /* LINHA DE CABEÇALHO: refaz o mapa e segue. Acontece a cada
         médico, e nesta planilha o primeiro bloco tem cabeçalho
         diferente dos outros. */
      const mapa = mapearColunas(linha);
      if (mapa.setor > -1 && mapa.valor > -1) { cols = mapa; return; }

      const cheias = cheiasDe(linha);
      if (!cheias.length) return;
      /* O SETOR sai do cabeçalho do bloco — MENOS quando a linha tem
         uma célula só. Aí a célula preenchida é a que importa, seja
         qual for a coluna: é a linha do nome do médico, e ela vem
         ANTES do cabeçalho do bloco dele, então o `cols` que vale
         naquele instante ainda é o do bloco anterior — de outra
         aba, que pode começar noutra coluna. Foi assim que o nome
         do coordenador saiu vazio. */
      const iSetor = cheias.length === 1 ? cheias[0]
        : (cols && cols.setor > -1 ? cols.setor : cheias[0]);
      const b = txt(linha[iSetor]);
      /* SEM COLUNA "TIPO" (v174). A coordenação da anestesia vem só
         com "Setor | Valor": sem plantão, sem horário, sem tipo. O
         leitor exigia o tipo e descartava as linhas — o arquivo dava
         "0 lançamentos". Sem a coluna, o tipo sai do próprio setor:
         se ele diz coordenação, é coordenação. */
      const semColTipo = !!cols && cols.tipo < 0;
      const c = cols && cols.tipo > -1 ? txt(linha[cols.tipo])
        : (semColTipo && b && cheias.length >= 2 && valorNum(linha[cols.valor]) !== 0
            ? (/coordena/i.test(semAcento(b)) ? 'Coordenação' : 'Sem tipo') : '');
      const temDuracao = !!(cols && (
        (cols.duracao > -1 && txt(linha[cols.duracao]) !== '') ||
        (cols.entrada > -1 && txt(linha[cols.entrada]) !== '') ||
        (cols.inicio > -1 && txt(linha[cols.inicio]) !== '')));
      /* SOMA os totais, não guarda o último.

         Cada aba de especialidade imprime o seu "Total da
         produtividade" no rodapé. Lendo as três abas, atribuir em
         vez de somar deixaria a conferência comparando o total do
         arquivo INTEIRO com o total impresso só da ÚLTIMA aba — e
         acusando divergência em todo fechamento que tem mais de uma
         especialidade, justamente os que estão certos. */
      /* O TOTAL IMPRESSO, ONDE QUER QUE ELE ESTEJA NA LINHA.

         Era procurado numa coluna fixa e com um texto só ("Total da
         produtividade"). A planilha do HMSA escreve "Total Geral"
         noutra coluna, e por isso o total de 265.500 que está lá no
         rodapé não era visto — a tela dizia "total impresso não vem
         no arquivo" com ele impresso. Agora procura o texto em
         qualquer célula da linha e pega o valor pela coluna do
         cabeçalho. */
      const ehTotalGeral = linha.some(function (v) {
        const t = semAcento(txt(v)).toUpperCase();
        return t.indexOf('TOTAL DA PRODUTIVIDADE') > -1 || t === 'TOTAL GERAL';
      });
      if (ehTotalGeral) {
        const vt = cols && cols.valor > -1 ? valorNum(linha[cols.valor]) : 0;
        totalArquivo = Math.round((totalArquivo + vt) * 100) / 100;
        return;
      }
      /* CABEÇALHO DE ABA NÃO É MÉDICO.

         Lendo várias abas em sequência, o cabeçalho da segunda e da
         terceira ("gerado em …", "PRODUTIVIDADE MÉDICA", o período)
         chega aqui depois de o período já ter sido achado na
         primeira, e cai na regra de "texto sozinho na linha = nome
         do médico". Nenhum deles chega a ganhar plantão — o nome de
         verdade vem antes da primeira linha de plantão —, mas ficar
         na lista de médicos faz a contagem mentir para quem vier
         ler. */
      if (/^gerado em\b/i.test(b) || /^PRODUTIVIDADE\b/i.test(b) || lerPeriodo(b)) return;
      /* NOME DO MÉDICO: uma célula só, e logo abaixo uma linha com
         duas ou mais. O título da aba ("COORDENAÇÃO SAMU") também
         vem sozinho, mas é seguido de outro título sozinho — e era
         por isso que ele entrava na lista de médicos. */
      if (cheias.length === 1 && abreBloco(i) && b.indexOf('*para validar') !== 0) {
        /* O CRM PODE TER ESPAÇO DENTRO — e tem.

           "Edson de Jesus Rocha  -  29213 /CE" é como o arquivo de
           HPM escreve. Exigindo que o CRM fosse um pedaço sem
           espaço nenhum, a separação simplesmente não acontecia: o
           nome do médico ficava sendo a linha inteira, com o traço
           e o CRM colados.

           A consequência não era cosmética. O nome colado não casa
           com o da aba FINANCEIRO, então aquele médico ficava sem
           CPF, sem chave PIX e sem regime — e `garantirCredor`, não
           achando ninguém com aquele nome, criava um cadastro NOVO
           a cada fechamento. Um médico impagável, duplicado todo
           mês, por causa de um espaço.

           O que separa é o traço cercado de espaços; o que vem
           depois é CRM, com espaço ou sem. */
        const m = b.match(/^(.*?)\s+-+\s+(.+?)\s*$/);
        medico = m ? m[1].trim() : b;
        crm = m ? m[2].trim() : '';
        medicos[chaveNome(medico)] = medicos[chaveNome(medico)] || { nome: medico, crm: crm, total: 0, plantoes: 0 };
        return;
      }
      if (!medico || !b || !c || !cols) return;                   // linha de total do bloco
      const min = cols.duracao > -1 ? minutos(linha[cols.duracao]) : 0;
      const val = cols.valor > -1 ? valorNum(linha[cols.valor]) : 0;
      /* ── LINHA COM VALOR E SEM HORÁRIO É COORDENAÇÃO ───────

         Pagamento sem plantão: nem início, nem fim, nem duração, e
         um valor. É remuneração de coordenação, e contá-la como
         plantão erra a quantidade de plantões do médico e do
         fechamento. Fica SUGERIDO, não decidido: a tela mostra a
         linha marcada e deixa reclassificar antes de gerar. */
      const semHorario = !temDuracao && min === 0 && val !== 0;
      const k = medico + '||' + b + '||' + c;
      const gr = grupos[k] = grupos[k] || { medico: medico, crm: crm, setor: b, tipo: c,
        linhas_origem: 0, plantoes: 0, minutos: 0, valor: 0,
        /* `coordenacao` é o que vale agora e muda no clique;
           `coordenacao_sugerida` é o que o arquivo disse e não muda —
           é ela que decide se a tela oferece o botão de trocar. */
        coordenacao: semHorario, coordenacao_sugerida: semHorario };
      gr.linhas_origem++;
      gr.minutos += min;
      gr.valor = Math.round((gr.valor + val) * 100) / 100;
      const md = medicos[chaveNome(medico)];
      md.total = Math.round((md.total + val) * 100) / 100;
    });

    /* A contagem de plantões é DERIVADA da classificação, não somada
       durante a leitura: reclassificar uma linha na tela tem de
       mudar a contagem sem reler o arquivo. */
    aplicarClasse(grupos, medicos);

    // aba FINANCEIRO: dados de pagamento do credor
    const fin = abas.financeiro || [];
    const pagto = {};
    let cabFin = -1;
    fin.forEach(function (l, i) {
      if (cabFin < 0 && l.some(function (v) { return txt(v) === 'Profissional'; })) cabFin = i;
    });
    /* ── O CABEÇALHO SE REPETE, E DESLOCADO ────────────────

       A aba FINANCEIRO tem mais de um bloco, e cada um traz o seu
       cabeçalho. No arquivo do SAMU o segundo — o da coordenação —
       está UMA COLUNA À DIREITA do primeiro: "Profissional" na C em
       vez da B, "Valor" na L em vez da K.

       Lendo o cabeçalho uma vez só, o bloco de baixo era lido pelas
       colunas do de cima: o nome do coordenador caía numa célula
       vazia, a linha era descartada por não ter nome, e os
       R$ 2.000,00 dele sumiam da conferência — que então acusava
       divergência contra o total impresso no próprio arquivo, que
       estava certo.

       Então o mapa é refeito a cada cabeçalho, como já é nas abas
       de plantão. É a mesma regra, pelo mesmo motivo. */
    const mapaFin = function (linha) {
      const cab = (linha || []).map(function (v) { return txt(v).replace(/\s+/g, ' '); });
      const col = function (nome) { return cab.findIndex(function (v) { return v.toLowerCase().indexOf(nome) === 0; }); };
      return {
        nome: col('profissional'), razao: col('razão'), crm: col('crm'),
        doc: col('documento'), tipo: col('tipo'),
        val: col('valor') > -1 ? col('valor') : col('total da produtividade'),
        obs: col('observa'),
        pix: cab.findIndex(function (v) { return v.toLowerCase().indexOf('pix') > -1; })
      };
    };
    const ehCabFin = function (linha) {
      return (linha || []).some(function (v) { return txt(v) === 'Profissional'; });
    };
    /* Fora do `if`: o total é usado lá embaixo, depois do bloco. */
    let totalFinanceiro = 0;
    if (cabFin >= 0) {
      let m = mapaFin(fin[cabFin]);
      for (let i = cabFin + 1; i < fin.length; i++) {
        /* Outro cabeçalho: refaz o mapa e segue. */
        if (ehCabFin(fin[i])) { m = mapaFin(fin[i]); continue; }
        /* ── O TOTAL DO ARQUIVO MORA AQUI ──────────────────

           Ele era somado só dos rodapés das abas de plantão. Na
           planilha do SAMU a aba de coordenação fecha com um total
           SEM rótulo, então aquele bloco ficava de fora e a
           conferência comparava 301.200 contra 299.200 — acusando
           divergência num arquivo que fecha certo.

           A aba FINANCEIRO traz o total geral do fechamento, com
           rótulo. Quando ele existe, é ele que vale: é o número que
           quem fechou a planilha conferiu. */
        if (fin[i].some(function (v) {
              return semAcento(txt(v)).toUpperCase().indexOf('TOTAL DA PRODUTIVIDADE') > -1; })) {
          /* O ÚLTIMO NÚMERO DA LINHA, não a coluna do cabeçalho.

             No HMSA a linha do total põe o número uma coluna à
             direita de "Valor", e na coluna do cabeçalho está a
             CONTAGEM DE HORAS — 62 dias e 1h48, que o Excel entrega
             como 62,075. Lendo pela coluna, o "total do arquivo"
             virava R$ 62,08: dinheiro vindo de uma contagem de
             horas, exatamente o defeito que a v160 corrigiu noutro
             ponto. O último número da linha acerta nos dois
             arquivos. */
          let tg = 0;
          for (let k = fin[i].length - 1; k >= 0; k--) {
            const n = valorNum(fin[i][k]);
            if (n > 0) { tg = n; break; }
          }
          if (tg > 0) totalFinanceiro = tg;
          continue;
        }
        const nome = txt(fin[i][m.nome]);
        if (!nome) continue;
        /* ── O QUE NÃO É MÉDICO NÃO ENTRA COMO MÉDICO ──────────

           A aba tem mais de um bloco (plantões e coordenação), cada
           um com o SEU cabeçalho e um rodapé de total. Lendo da
           primeira linha de "Profissional" até o fim, três coisas
           caíam na lista como se fossem gente: o título do segundo
           bloco ("COORDENAÇÃO"), o cabeçalho repetido
           ("Profissional") e a linha "TOTAL DA PRODUTIVIDADE:".

           A última não era só feia. O nome dela cai na coluna
           Profissional, e na coluna de Valor daquela linha está a
           célula de HORAS — 62 dias e 1h48, que o Excel entrega
           como 62,075. O total do arquivo entrou com R$ 62,08 a
           mais, vindo de uma contagem de horas. */
        const nomeLimpo = semAcento(nome).toUpperCase().replace(/[^A-Z ]/g, '').trim();
        if (nomeLimpo.indexOf('TOTAL') === 0 || nomeLimpo === 'PROFISSIONAL' ||
            nomeLimpo === 'COORDENACAO' || nomeLimpo === 'SUBTOTAL') continue;
        const obsLinha = m.obs > -1 ? txt(fin[i][m.obs]) : '';
        const valLinha = m.val > -1 ? valorNum(fin[i][m.val]) : 0;
        /* ── MESMO MÉDICO EM DOIS BLOCOS SOMA, NÃO SOBRESCREVE ──

           A Carolina recebe nos dois: R$ 18.000,00 de plantões e
           R$ 10.000,00 de coordenação. Guardando por nome, a
           segunda linha apagava a primeira e ela entrava com
           10.000 — R$ 18.000,00 a menos no total do arquivo, sem
           um aviso. O cadastro (CPF, PIX, regime) continua sendo o
           da primeira linha; o que soma é o dinheiro. */
        const ja = pagto[chaveNome(nome)];
        if (ja) {
          ja.valor = Math.round((ja.valor + valLinha) * 100) / 100;
          if (!ja.observacao) ja.observacao = obsLinha;
          continue;
        }
        pagto[chaveNome(nome)] = {
          observacao: obsLinha,
          /* O regime sai do texto por uma regra só, que mora no
             store: a tela não pode ter a sua própria ideia de o que
             é PJ, senão um dia a lista ordena por um critério e o
             contas a pagar cobra por outro. */
          regime: S.regimeDeTexto(obsLinha),
          /* Tudo pelo mapa do BLOCO, não pelo do primeiro cabeçalho:
             o bloco da coordenação está deslocado uma coluna. */
          razao_social: m.razao > -1 ? txt(fin[i][m.razao]) : '',
          crm: m.crm > -1 ? txt(fin[i][m.crm]) : '',
          documento: m.doc > -1 ? txt(fin[i][m.doc]) : '',
          tipo_chave: m.tipo > -1 ? txt(fin[i][m.tipo]) : '',
          pix: m.pix > -1 ? txt(fin[i][m.pix]) : '',
          valor: valLinha
        };
      }
    }

    const linhas = Object.keys(grupos).map(function (k) { return grupos[k]; })
      .sort(function (a, b) {
        return a.medico.localeCompare(b.medico) || a.setor.localeCompare(b.setor) || a.tipo.localeCompare(b.tipo);
      });
    const soma = Math.round(linhas.reduce(function (s, l) { return s + l.valor; }, 0) * 100) / 100;
    const somaFin = Math.round(Object.keys(pagto).reduce(function (s, k) { return s + pagto[k].valor; }, 0) * 100) / 100;

    /* A competência já saiu junto com o período, na varredura lá de
       cima: é uma conta só, feita onde o formato é reconhecido, em
       vez de duas interpretações do mesmo texto. */
    /* Sem período no arquivo a competência nasce VAZIA, para a
       gestora escolher — e não com o mês corrente, que seria um
       palpite com cara de certeza. */
    const competencia = competenciaLida || '';
    /* O total impresso na aba FINANCEIRO manda sobre a soma dos
       rodapés das abas de plantão, pelo motivo acima. */
    if (totalFinanceiro > 0) totalArquivo = totalFinanceiro;

    return {
      arquivo: arquivo, projeto: projeto, unidade: unidade, periodo: periodo, competencia: competencia,
      linhas: linhas, medicos: medicos, pagto: pagto,
      /* Quais abas entraram — a tela mostra, e sem isso uma aba
         inteira some do fechamento sem ninguém notar. */
      abasPlantoes: abas.abasPlantoes || [],
      periodo_ausente: periodoAusente,
      soma: soma, somaFin: somaFin, totalArquivo: totalArquivo
    };
  }

  /* Um pagamento por médico (é um PIX por médico), com a composição
     por setor e tipo pendurada como itens — o gestor abre o lançamento
     e vê de onde saiu cada real. */
  /* ── UM TÍTULO PARA PLANTÃO, OUTRO PARA COORDENAÇÃO ────

     A v160 passou a CLASSIFICAR a linha sem horário como
     coordenação, mas o pagamento continuava saindo num título só:
     os R$ 2.000,00 da coordenação do David entravam somados aos
     plantões dele, e não havia como pagar um sem o outro. É
     justamente o que a empresa precisa fazer — às vezes paga só a
     coordenação, às vezes só os plantões.

     Então a chave do agrupamento passa a ser MÉDICO + CLASSE. Quem
     só tem plantão continua com um título, como sempre; quem tem os
     dois passa a ter dois, cada um com a sua composição e o seu
     valor. */
  function porMedico(L) {
    const mapa = {};
    L.linhas.forEach(function (l) {
      const classe = l.coordenacao ? 'coordenacao' : 'plantao';
      const k = chaveNome(l.medico) + '||' + classe;
      const m = mapa[k] = mapa[k] || {
        medico: l.medico, crm: l.crm, classe: classe, itens: [], plantoes: 0, minutos: 0, valor: 0
      };
      m.itens.push({ setor: l.setor, tipo: l.tipo, qtd: l.plantoes, minutos: l.minutos, valor: l.valor,
        /* Gravada com o item: depois de lançado, é ela que diz ao
           detalhe do médico que aquilo é procedimento, não plantão. */
        unidade: UNIDADE_DO_FORMATO[L.formato] || 'plantao',
        coordenacao: !!l.coordenacao, coordenacao_sugerida: !!l.coordenacao_sugerida,
        chave: l.medico + '||' + l.setor + '||' + l.tipo });
      m.plantoes += l.plantoes;
      m.minutos += l.minutos;
      m.valor = Math.round((m.valor + l.valor) * 100) / 100;
    });
    return Object.keys(mapa).map(function (k) { return mapa[k]; })
      .sort(function (a, b) {
        /* O mesmo médico sai junto, plantão primeiro — ler a lista
           com as duas linhas lado a lado é o que deixa claro que
           são dois pagamentos e não uma duplicidade. */
        const n = a.medico.localeCompare(b.medico);
        return n !== 0 ? n : (a.classe === 'coordenacao' ? 1 : -1);
      });
  }

  /* ── DADOS BANCÁRIOS A MÃO ──────────────────────────────

     UM formulário, dois lugares: a prévia da importação (onde o
     cadastro do médico ainda não existe) e o detalhe do lançamento
     já feito (onde existe). Se fossem dois, um dia aceitariam coisas
     diferentes — e o que o banco recusa é igual nos dois.

     A validação não está aqui: está no store
     (`S.validarDadosBancarios`), que é a mesma regra que o contas a
     pagar usa para travar o pagamento. Um formulário que aceita o
     que o pagamento recusa não resolve nada, só muda o lugar onde a
     pessoa descobre. */
  function formularioBancario(opcoes) {
    const o = opcoes || {};
    const c = o.credor || {};
    const temBanco = !!(c.banco || c.agencia || c.conta_bancaria);
    const formaAtual = c.forma_pagamento === 'ted' || (temBanco && !c.pix) ? 'ted' : 'pix';
    ERP.app.modal({
      titulo: 'Dados bancários · ' + (o.nome || 'profissional'),
      fecharTxt: 'Cancelar',
      corpo:
        '<div class="ajuda">' + (o.ajuda ||
          'O arquivo do fechamento não trouxe como este profissional recebe. ' +
          'Sem isso o pagamento fica travado e ele não entra na remessa.') + '</div>' +
        '<label for="db-forma">Como recebe</label>' +
        '<select id="db-forma">' +
          '<option value="pix"' + (formaAtual === 'pix' ? ' selected' : '') + '>PIX</option>' +
          '<option value="ted"' + (formaAtual === 'ted' ? ' selected' : '') + '>Transferência (banco, agência e conta)</option>' +
        '</select>' +
        '<div id="db-pix">' +
          '<div class="row2" style="margin-top:8px">' +
            '<div><label for="db-chave">Chave PIX</label>' +
              '<input id="db-chave" value="' + U.esc(c.pix || '') + '" ' +
              'placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"></div>' +
            '<div><label for="db-tipo">Tipo da chave</label><select id="db-tipo">' +
              ['', 'CPF', 'CNPJ', 'Email', 'Telefone', 'Aleatoria'].map(function (t) {
                return '<option value="' + t + '"' + ((c.tipo_chave || '') === t ? ' selected' : '') +
                  '>' + (t || 'descobrir pela chave') + '</option>';
              }).join('') + '</select></div></div>' +
          '<div class="ajuda" id="db-tipo-nota"></div>' +
        '</div>' +
        '<div id="db-ted" style="display:none">' +
          '<div class="row3" style="margin-top:8px">' +
            '<div><label for="db-banco">Banco</label><input id="db-banco" value="' +
              U.esc(c.banco || '') + '" placeholder="nome ou número"></div>' +
            '<div><label for="db-ag">Agência</label><input id="db-ag" value="' +
              U.esc(c.agencia || '') + '" placeholder="com dígito, se tiver"></div>' +
            '<div><label for="db-conta">Conta</label><input id="db-conta" value="' +
              U.esc(c.conta_bancaria || '') + '" placeholder="com dígito"></div></div>' +
          '<div class="ajuda">O banco recusa a remessa inteira se faltar um dos três — ' +
            'não só a linha errada.</div>' +
        '</div>' +
        '<div id="db-erro"></div>',
      aoAbrir: function () {
        const troca = function () {
          const ted = U.val('db-forma') === 'ted';
          U.el('db-pix').style.display = ted ? 'none' : '';
          U.el('db-ted').style.display = ted ? '' : 'none';
        };
        U.el('db-forma').addEventListener('change', troca);
        troca();
        /* O TIPO DA CHAVE SAI DA CHAVE, não do que a pessoa marcou.
           É a mesma função que a importação usa (`tipoDaChavePix`):
           chave de CPF declarada como e-mail gera remessa recusada
           pelo banco — ou, pior, paga na chave de outra pessoa. */
        const aferir = function () {
          const chave = U.val('db-chave');
          const real = chave ? tipoDaChavePix(chave) : '';
          const nota = U.el('db-tipo-nota');
          if (!real) { nota.textContent = ''; return; }
          U.setVal('db-tipo', real);
          nota.textContent = 'Pela chave, o tipo é ' + (NOME_TIPO_PIX[real] || real) + '.';
        };
        U.el('db-chave').addEventListener('blur', aferir);
        aferir();
      },
      acoes: [{ txt: 'Gravar dados bancários', cls: 'btn-aprovar', fn: function () {
        const forma = U.val('db-forma');
        const dados = forma === 'ted'
          ? { forma_pagamento: 'ted', banco: U.val('db-banco'),
              agencia: U.val('db-ag'), conta_bancaria: U.val('db-conta') }
          : { forma_pagamento: 'pix', pix: U.val('db-chave'),
              tipo_chave: U.val('db-tipo') || tipoDaChavePix(U.val('db-chave')) };
        const v = S.validarDadosBancarios(dados);
        if (v.erro) {
          U.el('db-erro').innerHTML = '<div class="login-erro">' + U.esc(v.erro) + '</div>';
          return;
        }
        const r = o.aoGravar(dados);
        if (r && r.erro) {
          U.el('db-erro').innerHTML = '<div class="login-erro">' + U.esc(r.erro) + '</div>';
          return;
        }
        ERP.app.fecharModal();
        ERP.app.aviso('Dados bancários gravados.', 'ok');
      } }]
    });
  }

  /* O que falta para este profissional poder receber, contando o
     cadastro, o que o arquivo trouxe e o que foi digitado agora. É
     UMA conta, usada pela prévia e pelo detalhe: a prévia dizia
     "completa cadastro — chave PIX" olhando só o cadastro, e
     chamava de incompleto quem tinha a chave no arquivo, na linha
     de baixo. Era o aviso que mandou alguém reorganizar a planilha
     para resolver o que não era problema de planilha. */
  function faltaParaPagar(cad, pg, digitado) {
    const npx = normalizarPix(pg || {});
    const d = digitado || {};
    const fonte = function (campo, doArquivo) {
      if (d[campo]) return 'digitado';
      if (cad && cad[campo]) return 'cadastro';
      if (doArquivo) return 'arquivo';
      return '';
    };
    const pix = fonte('pix', npx.pix);
    const ted = (d.banco && d.agencia && d.conta_bancaria) ? 'digitado'
      : (cad && cad.banco && cad.agencia && cad.conta_bancaria) ? 'cadastro' : '';
    const doc = fonte('documento', (pg || {}).documento);
    const falta = [];
    if (!pix && !ted) falta.push('como recebe (PIX ou banco/agência/conta)');
    if (!doc) falta.push('CPF/CNPJ');
    return { falta: falta, pix: pix, ted: ted, doc: doc, chave: npx.pix,
             tipo_chave: npx.tipo_chave, divergente: npx.divergente, declarado: npx.declarado };
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
    /* SEM ARQUIVO LIDO NÃO HÁ O QUE DESENHAR. A limpeza feita quando
       um arquivo é recusado zera o `lote`; sem esta saída, qualquer
       caminho que chame `render()` depois disso quebraria — e com
       ela, o pior que acontece é a tela ficar como está, nunca
       voltar a mostrar o arquivo anterior. */
    if (!L) return;
    const medicos = porMedico(L);
    const centro = centroSugerido(L.projeto);
    /* TOTAL NÃO IMPRESSO NÃO É TOTAL ZERO.

       Nem todo fechamento traz a linha "Total da produtividade" no
       rodapé — o de HPM, por exemplo, não traz em nenhuma das três
       abas. Comparando contra zero, o aviso "os totais não fecham
       entre si" aparecia em TODO import desses arquivos, apontando
       uma divergência que não existe. Aviso que aparece sempre é
       aviso que se aprende a ignorar, e aí o dia em que os totais
       realmente não fecharem passa despercebido. */
    const temTotalImpresso = L.totalArquivo > 0;
    const divergeArquivo = temTotalImpresso && Math.abs(L.soma - L.totalArquivo) > 0.01;
    const divergeFin = Math.abs(L.soma - L.somaFin) > 0.01;
    /* Formato de procedimentos: a quantidade é de PROCEDIMENTOS, não de
       plantões, e não há horas. Um rótulo só, decidido aqui, para a
       tela inteira não misturar os dois vocabulários. */
    const proc = !!UNIDADE_DO_FORMATO[L.formato];   // por quantidade, sem horas
    const voc = vocDoArquivo(L);
    const extras = L.conferencias || [];
    const divergeExtra = extras.some(function (c) { return c.diverge; });

    U.el('pr-saida').innerHTML =
      '<div class="pr-cab">' +
        '<div><label>Projeto no arquivo</label><input value="' +
          U.esc(L.projeto + (L.especialidade ? ' · ' + L.especialidade : '')) + '" disabled></div>' +
        '<div><label for="pr-centro">Centro de custo *</label><select id="pr-centro">' +
          '<option value="">Escolher…</option>' +
          /* EM ORDEM ALFABÉTICA, não de cadastro: os projetos de nota
             única (GHC - HGB …) ficam juntos, um embaixo do outro. A
             busca por texto vem por cima (U.selectComBusca). */
          D.centros.filter(function (c) { return c.ativo; }).slice().sort(function (a, b) {
            return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt', { sensitivity: 'base', numeric: true });
          }).map(function (c) {
            return '<option value="' + c.id + '"' + (c.id === centro ? ' selected' : '') + '>' +
              U.esc(c.nome + ' · ' + c.codigo) + '</option>';
          }).join('') + '</select></div>' +
        '<div><label>Período</label><input value="' + U.esc(L.periodo) + '" disabled></div>' +
        '<div><label for="pr-comp">Competência' + (L.periodo_ausente ? ' *' : '') +
          '</label><input type="month" id="pr-comp" value="' + L.competencia + '"' +
          (L.periodo_ausente ? ' class="erro"' : '') + '></div>' +
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
        '<span>Soma dos ' + voc.plur + ' <b>' + U.brl(L.soma) + '</b></span>' +
        '<span>Aba FINANCEIRO <b class="' + (divergeFin ? 'erro' : '') + '">' + U.brl(L.somaFin) + '</b></span>' +
        '<span>Total impresso no arquivo <b class="' + (divergeArquivo ? 'erro' : '') + '">' +
          (temTotalImpresso ? U.brl(L.totalArquivo) : '<span class="sub">não vem no arquivo</span>') + '</b></span>' +
        extras.map(function (c) {
          return '<span>' + U.esc(c.rotulo) + ' <b class="' + (c.diverge ? 'erro' : '') + '">' +
            (c.dinheiro ? U.brl(c.valor) : c.valor) + '</b></span>';
        }).join('') +
        '<span>' + medicos.length + ' lançamento(s) · ' +
          (proc ? L.qtd_procedimentos + ' ' + voc.sing + '(s) de ' + L.linhas.length + ' tipo(s)'
                : L.linhas.length + ' linha(s) de setor/tipo') + '</span>' +
      '</div>' +
      (function () {
        const rep = docsRepetidos(L);
        const ds = Object.keys(rep);
        if (!ds.length) return '';
        return '<div class="aviso" style="margin:10px 0;border-left-color:var(--red)" id="pr-doc-repetido">' +
          '<b>O mesmo CPF/CNPJ aparece para médicos diferentes:</b> ' + ds.map(function (d) {
            return U.esc(L.pagto[rep[d][0]].documento) + ' — ' + rep[d].map(function (k) {
              return U.esc((L.medicos[k] || {}).nome || k); }).join(' e ');
          }).join('; ') + '. Um deles está errado no arquivo. Ao lançar, esse CPF <b>não é usado</b> para ' +
          'identificar nem é gravado no cadastro de nenhum dos dois — cada um vai pelo nome. Confira com ' +
          'quem fechou e corrija o cadastro depois.</div>';
      })() +
      /* As observações escritas no pé do arquivo (tarifas, ajustes):
         é por elas que se entende uma linha de AJUSTE. */
      ((L.notas || []).length
        ? '<div class="ajuda" style="margin:8px 0" id="pr-notas"><b>Observações do arquivo:</b> ' +
          L.notas.map(function (n) { return U.esc(n); }).join(' · ') + '</div>'
        : '') +
      (proc && L.fora_do_mes
        ? '<div class="aviso" style="margin:10px 0"><b>' + L.fora_do_mes + ' procedimento(s) com data fora de ' +
          U.fComp(L.competencia) + '.</b> Eles entram neste fechamento como vieram — confira com quem fechou ' +
          'se pertencem mesmo a este mês.</div>'
        : '') +
      (L.periodo_ausente
        ? '<div class="aviso" style="margin:10px 0"><b>Não reconheci a competência no arquivo.</b> ' +
          'Procurei por "21/08/2026 - 20/09/2026", "OUTUBRO DE 2026" e "10/2026" em todas as ' +
          'células e não achei nenhuma. Li o resto normalmente — <b>escolha a competência acima</b> ' +
          'antes de gerar o financeiro.</div>'
        : '') +
      (divergeArquivo || divergeFin || divergeExtra
        ? '<div class="aviso" style="margin:10px 0">Os totais do arquivo não fecham entre si. ' +
          'O sistema vai lançar a soma dos ' + voc.plur + ' (' + U.brl(L.soma) +
          '); confira com quem fechou antes de aprovar.</div>'
        : '') +
      /* O PALPITE FICA À VISTA. Linha sem horário é quase sempre
         coordenação, mas "quase sempre" não é sempre — e classificar
         calado troca um erro silencioso por outro. */
      (function () {
        const semHora = L.linhas.filter(function (l) { return l.coordenacao_sugerida; });
        if (!semHora.length) return '';
        const comoCoord = semHora.filter(function (l) { return l.coordenacao; }).length;
        return '<div class="ajuda" style="margin:10px 0">' +
          (semHora.length === 1 ? 'Uma linha veio' : semHora.length + ' linhas vieram') +
          ' <b>com valor e sem horário</b>. ' +
          (comoCoord
            ? 'Classifiquei ' + (semHora.length === 1 ? 'como' : comoCoord + ' como') +
              ' <b>coordenação</b>, então ' + (comoCoord === 1 ? 'ela não conta' : 'elas não contam') +
              ' como plantão na quantidade. '
            : '') +
          'Se não for isso, o botão na linha do médico troca para plantão.</div>';
      })() +

      '<div class="tabela-rolagem" style="margin:10px -14px 0">' +
      '<table><thead><tr><th>Médico</th><th>CRM</th><th class="num">' + voc.Plur + '</th>' +
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
              /* LINHA SEM HORÁRIO: a sugestão aparece escrita e com o
                 botão de desfazer ao lado. Classificar calado seria
                 trocar um erro silencioso (contar como plantão) por
                 outro (contar como coordenação sem avisar). */
              if (i.coordenacao_sugerida) {
                return (i.coordenacao
                    ? '<span class="badge b-pendente">coordenação</span> '
                    : '<span class="badge b-aberto">plantão</span> ') +
                  U.esc(i.tipo) + ': ' + i.qtd + ' × ' + hhmm(i.minutos) + ' · ' + U.brl(i.valor) +
                  ' <button class="btn-ghost" data-pr-classe="' + U.esc(i.chave) + '" ' +
                  'title="esta linha veio sem horário; o sistema sugeriu coordenação">' +
                  (i.coordenacao ? 'é plantão' : 'é coordenação') + '</button>';
              }
              /* Procedimento: quantidade de cada um, sem horas. */
              if (proc) return U.esc(i.tipo) + ': <b>' + i.qtd + '</b> · ' + U.brl(i.valor);
              return U.esc(i.tipo) + ': ' + i.qtd + ' × ' + hhmm(i.minutos) + ' · ' + U.brl(i.valor);
            }).join(' &nbsp;|&nbsp; ') + '</div></td>' +
          '<td class="mono">' + U.esc(m.crm || pg.crm || '—') + '</td>' +
          '<td class="num">' + m.plantoes + '</td>' +
          '<td class="num">' + (proc ? '—' : hhmm(m.minutos)) + '</td>' +
          '<td class="num">' + U.brl(m.valor) + '</td>' +
          /* `S.pode('produtividade')` NÃO EXISTE: não está na matriz
             nem na lista de ações do perfil, então devolvia `false`
             para todo mundo, inclusive para a diretoria. A trava de
             pagamento só aparecia para quem tinha `lancar` — e quem
             cuida de produtividade, que é quem precisa dela, ficava
             sem. O certo é perguntar pelo nível de movimentação no
             módulo, como o resto da tela faz. */
          '<td>' + (S.podeMover('produtividade') || S.pode('lancar')
            ? '<label class="bloq-pg"><input type="checkbox" data-bloq="' + U.esc(chaveNome(m.medico)) +
              '"' + (bloqueiosPre[chaveNome(m.medico)] ? ' checked' : '') + '> bloquear</label>'
            : '') + '</td>' +
          /* ── A COLUNA LIA SÓ O CADASTRO ────────────────────────

             Dizia "completa cadastro — chave PIX" para quem já está
             cadastrado e tem a chave no ARQUIVO, uma linha abaixo na
             mesma tela. O coordenador caía nisso: médico antigo da
             casa, cadastrado como sócio sem chave PIX (ninguém nunca
             lhe pagou produtividade), com a chave ali na aba
             FINANCEIRO. A tela acusava falta, a importação ia
             preencher, e quem leu o aviso foi reorganizar a planilha.

             Agora a conta é uma só e considera as três fontes —
             cadastro, arquivo e o que foi digitado agora. Falta é só
             o que, somando tudo, continua faltando. */
          (function () {
            const f = faltaParaPagar(cad, pg, bancariosPre[chaveNome(m.medico)]);
            const dig = bancariosPre[chaveNome(m.medico)];
            const botao = '<button class="btn-sm btn-cancelar" data-pr-banco="' +
              U.esc(chaveNome(m.medico)) + '" title="informar como este profissional recebe">' +
              'Incluir dados bancários</button>';
            const comoRecebe = dig
              ? (dig.forma_pagamento === 'ted'
                  ? 'banco ' + U.esc(dig.banco) + ' ag. ' + U.esc(dig.agencia) + ' c/c ' + U.esc(dig.conta_bancaria)
                  : U.esc(dig.pix) + ' · ' + U.esc(NOME_TIPO_PIX[dig.tipo_chave] || dig.tipo_chave || 'tipo?'))
              : f.ted === 'cadastro'
                ? 'banco ' + U.esc(cad.banco) + ' ag. ' + U.esc(cad.agencia)
                : f.pix === 'cadastro'
                  ? U.esc(cad.pix) + ' · ' + U.esc(NOME_TIPO_PIX[cad.tipo_chave] || cad.tipo_chave || 'tipo?')
                  : f.chave
                    ? U.esc(f.chave) + ' · ' + U.esc(NOME_TIPO_PIX[f.tipo_chave] || f.tipo_chave || 'tipo?')
                    : '';
            const deOnde = dig ? 'digitado agora'
              : (f.pix === 'arquivo' || f.doc === 'arquivo') ? 'vem do arquivo' : '';
            return '<td>' +
              (f.falta.length
                ? '<span class="badge b-cancelado">sem como pagar</span>' +
                  '<div class="sub">falta ' + U.esc(f.falta.join(' e ')) + '</div>' +
                  '<div style="margin-top:4px">' + botao + '</div>'
                : (cad
                    ? '<span class="badge b-pago">cadastrado</span>'
                    : '<span class="badge b-pendente">médico novo</span>') +
                  (comoRecebe ? '<div class="sub">' + comoRecebe +
                    (deOnde ? ' <span class="ajuda">(' + deOnde + ')</span>' : '') + '</div>' : '') +
                  (f.divergente
                    ? '<div class="erro">planilha diz ' + U.esc(f.declarado) + ', a chave é ' +
                      U.esc(NOME_TIPO_PIX[f.tipo_chave] || f.tipo_chave) + ' — vale a chave</div>'
                    : '') +
                  /* Deixa trocar mesmo quando está completo: médico
                     que mudou de banco é caso de todo mês, e o
                     cadastro de médico não abre em Cadastros. */
                  '<div style="margin-top:4px"><button class="btn-ghost" data-pr-banco="' +
                    U.esc(chaveNome(m.medico)) + '">trocar</button></div>') +
              '</td>';
          })() +
        '</tr>';
      }).join('') + '</tbody></table></div>' +

      '<div class="form-acoes" style="margin:14px -14px -14px">' +
        '<span class="ajuda" style="margin-right:auto">Um título por médico, com a composição ' +
        (proc ? 'por ' + voc.sing + ' ' : 'por setor e tipo ') +
        'no detalhe do lançamento. Tudo aguardando aprovação; reimportar o mesmo arquivo não duplica.</span>' +
        '<button class="btn-primary" id="pr-gerar" style="width:auto;margin:0">Gerar ' + medicos.length + ' lançamentos</button>' +
      '</div>';

    U.el('pr-gerar').addEventListener('click', gerar);
    /* RECLASSIFICAR A LINHA SEM HORÁRIO. Troca a classificação,
       refaz a contagem de plantões pela mesma função que a leitura
       usou, e redesenha — sem reler o arquivo. */
    document.querySelectorAll('[data-pr-classe]').forEach(function (b) {
      b.addEventListener('click', function () {
        const k = this.dataset.prClasse;
        const g = L.linhas.find(function (x) {
          return x.medico + '||' + x.setor + '||' + x.tipo === k; });
        if (!g) return;
        g.coordenacao = !g.coordenacao;
        aplicarClasse(L.linhas, L.medicos);
        render();
      });
    });
    /* O botão vermelho da coluna do credor: abre o formulário e
       guarda o que foi digitado para a hora de gerar. */
    document.querySelectorAll('[data-pr-banco]').forEach(function (b) {
      b.addEventListener('click', function () {
        const k = this.dataset.prBanco;
        const m2 = porMedico(L).find(function (x) { return chaveNome(x.medico) === k; });
        if (!m2) return;
        const pg2 = L.pagto[k] || {};
        const doc2 = String(pg2.documento || '').replace(/\D/g, '');
        const cad2 = (doc2 && D.credores.find(function (c) {
            return String(c.documento || '').replace(/\D/g, '') === doc2; })) ||
          D.credores.find(function (c) { return chaveNome(c.nome) === k; });
        formularioBancario({
          nome: m2.medico,
          credor: bancariosPre[k] || cad2 ||
            { pix: normalizarPix(pg2).pix, tipo_chave: normalizarPix(pg2).tipo_chave },
          aoGravar: function (dados) {
            bancariosPre[k] = dados;
            render();
            return { ok: true };
          }
        });
      });
    });
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
    U.selectComBusca(U.el('pr-centro'), { placeholder: 'Digite parte do nome ou o código…' });
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
  function perguntarFaturamento(centro, comp, valorRepasse, lote, depois) {
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
      aoFechar: depois || null,
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

  /* v135: esta funcao ERA a unica que conhecia projeto de dia fixo
     de recebimento, e por isso dava uma resposta que o resto do
     sistema nao dava. A regra mudou de casa para o store, onde todo
     mundo le dela; aqui ficou so o nome. */
  function venctoSugerido(comp, centroId) {
    return S.vencimentoPrevistoDe(comp, centroId);
  }
  /* O texto acompanha a mesma regra da data: se os dois nao sairem
     do mesmo lugar, a tela explica um criterio e aplica outro. */
  function textoVencto(centroId) {
    return S.origemDoPrazo(centroId).texto;
  }
  /* `ref_projeto` existe no formato de procedimentos: projeto +
     especialidade, porque o mesmo projeto manda um arquivo por
     especialidade. Nos arquivos de plantão não existe e nada muda. */
  const refPadrao = L => 'FECH-' + txt(L.ref_projeto || L.projeto).toUpperCase() + '-' + L.competencia;

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
  /* Dados bancários digitados na prévia, por médico. Valem no
     `garantirCredor`, na hora de gerar — antes disso não existe
     cadastro para gravar neles (o médico novo nasce ali). */
  const bancariosPre = {};

  let complementar = null;   // null = ainda não perguntado nesta importação; 'substituir' | true | false
  /* Resposta à pergunta dos médicos com valor ZERADO: null = ainda não
     perguntado nesta geração; true = lançar os outros e deixar esses
     de fora. Vale para UMA geração, como `complementar`. */
  let zerosAceitos = null;
  const valorZerado = function (m) { return !(m.valor > 0.004); };

  /* ── MÉDICO COM VALOR ZERADO: PERGUNTA ANTES, NO MEIO DA TELA ──

     Antes o título zerado era recusado um por um, e o único sinal era
     o aviso vermelho do canto, que some em segundos; a prévia ficava
     inteira na tela e parecia que nada tinha sido lançado. Valor zero
     no arquivo quase sempre é erro do arquivo — então a pergunta vem
     antes de gravar qualquer coisa: lançar os outros, ou voltar e
     corrigir o arquivo. */
  function perguntarZerados(zerados, total) {
    const todos = zerados.length === total;
    ERP.app.modal({
      titulo: zerados.length === 1 ? '1 médico está com valor zerado'
        : zerados.length + ' médicos estão com valor zerado',
      fecharTxt: 'Cancelar e corrigir o arquivo',
      corpo:
        '<div class="aviso" style="border-left-color:var(--red)">' +
          (todos ? '<b>Nenhum médico deste arquivo tem valor a receber.</b> Não há o que lançar — confira o arquivo.'
                 : 'Estes médicos vieram <b>sem valor</b> no arquivo. Se lançar agora, eles <b>ficam de fora</b> ' +
                   'deste fechamento; ' + (total - zerados.length === 1 ? 'o outro é lançado'
                   : 'os outros ' + (total - zerados.length) + ' são lançados') + ' normalmente.') +
        '</div>' +
        '<table id="pr-zerados"><thead><tr><th>Médico</th><th class="num">' +
          vocDoArquivo(lote).Plur + '</th><th class="num">Valor</th></tr></thead><tbody>' +
          zerados.map(function (m) {
            return '<tr><td class="desc">' + U.esc(m.medico) + (m.classe === 'coordenacao' ? ' <span class="sub">coordenação</span>' : '') +
              '</td><td class="num">' + (m.plantoes || 0) + '</td><td class="num erro">' + U.brl(m.valor || 0) + '</td></tr>';
          }).join('') + '</tbody></table>' +
        '<div class="ajuda">Para incluir esses médicos depois, corrija o arquivo e importe de novo como ' +
          '<b>complemento</b>.</div>',
      acoes: todos ? [] : [{ txt: 'Lançar sem esses médicos', cls: 'btn-aprovar', fn: function () {
        zerosAceitos = true;
        ERP.app.fecharModal();
        gerar();
      } }]
    });
  }

  /* O RESULTADO FICA NO MEIO DA TELA, deu certo ou não. Com algo
     lançado, a prévia sai (não há o que lançar duas vezes); com nada
     lançado, ela fica para corrigir. */
  function mostrarResultado(r) {
    const algum = r.feitos > 0;
    ERP.app.modal({
      titulo: !algum ? 'Nada foi lançado' : r.erros.length ? 'Lançamento realizado — com pendências' : 'Lançamento realizado',
      fecharTxt: r.fila.length ? 'Continuar' : 'OK',
      aoFechar: r.seguir,
      corpo:
        '<div class="lancamento-ok" id="pr-lancado">' +
        '<div class="resumo-linha"><span>Projeto</span><span class="v">' + U.esc(r.projeto) + '</span></div>' +
        '<div class="resumo-linha"><span>Competência</span><span class="v">' + U.fComp(r.comp) + '</span></div>' +
        '<div class="resumo-linha"><span>Lançamentos</span><span class="v">' + r.feitos + '</span></div>' +
        '<div class="resumo-linha"><span>Valor do repasse</span><span class="v">' + U.brl(r.valor) + '</span></div>' +
        (r.bloqueados ? '<div class="resumo-linha"><span>Com pagamento bloqueado</span><span class="v erro">' +
          r.bloqueados + '</span></div>' : '') +
        (r.zerados.length ? '<div class="resumo-linha"><span>Ficaram de fora (valor zerado)</span><span class="v erro">' +
          r.zerados.length + '</span></div><div class="ajuda">' +
          r.zerados.map(function (m) { return U.esc(m.medico); }).join(' · ') + '</div>' : '') +
        (r.erros.length
          ? '<div class="aviso" style="border-left-color:var(--red);margin-top:8px"><b>' +
            (r.erros.length === 1 ? '1 problema' : r.erros.length + ' problemas') + ':</b>' +
            '<ul class="pr-erros">' + r.erros.slice(0, 15).map(function (e) { return '<li>' + U.esc(e) + '</li>'; }).join('') +
            (r.erros.length > 15 ? '<li>e mais ' + (r.erros.length - 15) + '</li>' : '') + '</ul>' +
            (algum ? 'O que foi lançado está na aba de lançamentos. Para lançar o que faltou, corrija e importe ' +
                     'o arquivo de novo — os já lançados são reconhecidos e ficam de fora.'
                   : 'A prévia continua na tela para corrigir e lançar de novo.') + '</div>'
          : '') +
        (r.complementares ? '<div class="ajuda">' + r.complementares + ' como complemento de fechamento já lançado.</div>' : '') +
        (r.repetidos ? '<div class="ajuda">' + r.repetidos + ' já existiam e foram ignorados.</div>' : '') +
        (r.novos || r.atualizados ? '<div class="ajuda">' +
          (r.novos ? r.novos + ' médico(s) cadastrado(s)' : '') + (r.novos && r.atualizados ? ' e ' : '') +
          (r.atualizados ? r.atualizados + ' atualizado(s) com dados bancários' : '') + '.</div>' : '') +
        (algum ? '<div class="ajuda">Os lançamentos estão em Financeiro › Contas a pagar' +
          (r.fila.length ? '. Em seguida: ' + (r.loteFeito ? 'o valor a faturar' : '') +
            (r.loteFeito && r.divergencias ? ' e ' : '') +
            (r.divergencias ? 'as divergências de cadastro' : '') : '') + '.</div>' : '') +
        '</div>'
    });
  }

  function gerar() {
    const L = lote;
    /* ── QUEM FECHA A PRODUTIVIDADE PODE GERAR O FECHAMENTO ──

       A funcionária que lança a produtividade esbarrava em "Seu
       perfil não lança contas a pagar" e não conseguia fechar mês
       nenhum. A mensagem está certa sobre o perfil e errada sobre a
       ação: fechar a produtividade não é lançar um título avulso no
       contas a pagar — é registrar o repasse que ela acabou de
       conferir, e o pagamento ainda depende da liberação dela e do
       financeiro depois.

       O sistema já tem a válvula para isso (`_interno`, usada pelo
       comprador, que gera previsão sem ter `lancar`). O que faltava
       era usá-la aqui, conferindo ANTES a permissão que de fato
       corresponde: fechar a produtividade. */
    if (!S.podeMover('produtividade') && !S.pode('lancar')) {
      return ERP.app.aviso('Seu perfil não fecha a produtividade do mês.', 'erro');
    }
    const zerados = porMedico(L).filter(valorZerado);
    if (zerados.length && zerosAceitos !== true) return perguntarZerados(zerados, porMedico(L).length);
    /* A CHAVE AQUI TEM DE SER A MESMA QUE É GRAVADA.

       A v162 pôs a classe na referência do título (plantão e
       coordenação são dois títulos), e esta conferência ficou
       procurando a chave antiga, sem classe — que nunca existiu no
       banco. Resultado: nenhum médico era reconhecido como "já
       lançado", a pergunta sobre substituir o fechamento anterior
       não aparecia, e reimportar um arquivo CORRIGIDO não fazia
       nada — cada médico era recusado um por um como duplicado, com
       o aviso "N já existiam e foram ignorados", sem oferecer o
       caminho de substituir. */
    const jaLancados = porMedico(L).filter(function (m) {
      return S.refJaUsada([refPadrao(L), m.medico, m.classe].join('|'));
    });
    /* ── O CABEÇALHO ÓRFÃO TAMBÉM PRECISA DA PERGUNTA ──────

       Fechamento gravado sem os títulos (ver `fechamentosSemTitulos`)
       não é reconhecido por `jaLancados`: não há título para achar.
       Sem isto, reimportar o arquivo criaria um segundo cabeçalho ao
       lado do primeiro — dois lançamentos para a mesma competência,
       um vazio — e ninguém ofereceria o caminho de substituir, que é
       o certo aqui. */
    const centroPre = U.val('pr-centro'), compPre = U.val('pr-comp');
    const orfaos = (centroPre && compPre) ? S.fechamentosSemTitulos(centroPre, compPre) : [];
    if ((jaLancados.length || orfaos.length) && complementar === null) {
      const centroAtual = centroPre, compAtual = compPre;
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
          (orfaos.length
            ? '<div class="aviso" style="border-left-color:var(--red)"><b>' + orfaos.length +
              ' lançamento(s) desta competência estão no banco só pelo cabeçalho</b>, sem os ' +
              'médicos dentro — foi o que aconteceu com os fechamentos lançados antes da ' +
              'correção de permissão. <b>Substituir</b> é o caminho: cancela o cabeçalho vazio e ' +
              'lança este arquivo inteiro.</div>'
            : '') +
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
    /* A COMPETÊNCIA É OBRIGATÓRIA NA HORA DE GERAR, não na de ler.
       Sem este corte, o arquivo cuja data o sistema não reconheceu
       geraria o fechamento com competência vazia — e títulos sem
       competência não aparecem em relatório nenhum. */
    if (!U.val('pr-comp')) {
      ERP.app.aviso('Escolha a competência deste fechamento antes de gerar.', 'erro');
      const campo = U.el('pr-comp'); if (campo) campo.focus();
      return;
    }
    const comp = U.val('pr-comp'), venc = U.val('pr-venc'),
          conta = U.val('pr-conta'), doc = U.val('pr-doc');

    let feitos = 0, repetidos = 0, erros = [];
    const tituloIds = [];
    const paresGerados = [];   // médico → título, para aplicar os bloqueios marcados
    let valorLote = 0;
    let complementares = 0;
    novos = 0; atualizados = 0; divergencias = []; errosBancarios = [];
    docsRepetidosNoArquivo = docsRepetidos(L);
    loteEmGeracao = L;
    porMedico(L).forEach(function (m) {
      /* Zerado e aceito como "fica de fora": nem cadastro, nem título. */
      if (valorZerado(m)) return;
      const pg = L.pagto[chaveNome(m.medico)] || {};
      const credor = garantirCredor(m, pg);
      /* Fechamento COMPLEMENTAR do mesmo médico/projeto/competência é
         legítimo (plantão lançado depois, acerto). A chave ganha um
         sufixo quando já existe lançamento vivo daquele médico naquela
         competência — antes o sistema descartava com "já existia" e o
         médico ficava sem receber a diferença. */
      /* A CLASSE ENTRA NA CHAVE. Sem ela, o segundo título do mesmo
         médico (a coordenação) seria visto como repetição do
         primeiro e descartado com "já existia" — o coordenador
         receberia os plantões e perderia a coordenação, calado. */
      const refBase = [refPadrao(L), m.medico, m.classe].join('|');
      const ref = (S.refJaUsada(refBase) && complementar)
        ? refBase + '|c' + S.proximoComplemento(refBase) : refBase;
      /* O REGIME VEM DO CADASTRO, que `garantirCredor` acabou de
         acertar — não da planilha. É a mesma fonte que a tela de
         Cadastros edita, então corrigir lá vale para o mês que vem
         sem depender de a planilha mudar. */
      const regime = S.regimeDoCredor(credor);
      const exigeNota = S.regimeExigeNota(regime);
      const r = S.criarTitulo({
        /* A permissão conferida foi a de fechar produtividade, logo
           acima — não a de lançar título avulso. */
        _interno: true,
        descricao: m.classe === 'coordenacao'
          ? 'Coordenação médica ' + U.fComp(comp)
          : UNIDADE_DO_FORMATO[L.formato]
            ? 'Produtividade médica ' + U.fComp(comp) + ' — ' + m.plantoes + ' ' +
              (m.plantoes > 1 ? vocDoArquivo(L).plur : vocDoArquivo(L).sing) +
              (L.especialidade ? ' · ' + L.especialidade : '')
            : 'Produtividade médica ' + U.fComp(comp) + ' — ' + m.plantoes +
              (m.plantoes > 1 ? ' plantões · ' : ' plantão · ') + hhmm(m.minutos),
        /* O CAMPO DE NF NASCE VAZIO, inclusive para o PJ.

           Antes ia aqui o número do FECHAMENTO ("FECH-HPM-2026-09"),
           igual para os vinte médicos do lote. Era o mesmo campo que
           a tela chama de "Número da NF" — então todo título de
           produtividade já nascia parecendo ter nota, e não havia
           como distinguir o que tinha nota do que não tinha.

           O número do fechamento não se perdeu: continua na
           `origem_ref` (que é o que impede o mesmo fechamento de
           entrar duas vezes) e na observação do título, visível no
           "Ver" do contas a pagar. O que ele deixa de ocupar é o
           campo da nota, que agora fica livre para o que ele diz
           ser — a nota do médico, quando chegar. */
        documento: '', tipo_titulo: 'medicao', credor: credor,
        /* NASCE MARCADO "SEM NF", e isso é o fato: não há nota
           nenhuma no momento do fechamento, para PJ nem para SCP.

           É também o que o lançamento exige — número do título ou a
           marcação, nunca os dois em branco. A marcação cai sozinha
           quando a nota é informada, e quem a mantém fora do alerta
           de "pago sem NF" é a dispensa, não ela: SCP fica de fora
           porque está dispensado, e o PJ fica dentro, que é o
           ponto. */
        sem_nf: true,
        /* Dispensa é o avesso de exigir, e é o que o resto do
           sistema já consulta (alerta de pago sem NF, filtros,
           relatórios). SCP, "outro" e não classificado nascem
           dispensados; PJ nasce devendo a nota. */
        nf_dispensada: !exigeNota,
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
    let loteFeito = null, bloqueadosFeitos = 0;
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
      bloqueadosFeitos = bloqueados;
      /* Fechou a produtividade: é aqui que a responsável informa quanto
         vai ser faturado do projeto. Esse número vale mais que a
         estimativa — vai pro contas a receber com status próprio. A
         pergunta entra na FILA de janelas, lá embaixo — antes ela abria
         por cima da janela de divergências e a escondia. */
      loteFeito = lotReg;
    }

    ERP.contas.render();
    ERP.app.atualizarContadores();
    atualizarAlerta();
    /* Recusa ao gravar dado bancário entra na mesma lista: calar
       isso faria o lançamento sair "com sucesso" e o médico seguir
       sem como receber. */
    errosBancarios.forEach(function (e) { erros.push(e); });

    /* ── AS JANELAS DO FIM, EM FILA ────────────────────────
       Eram três coisas abrindo ao mesmo tempo: o aviso do canto, a
       janela de divergências e, 0,4 s depois, a pergunta do
       faturamento — que abria POR CIMA das divergências e as fazia
       sumir sem ninguém ler. Agora uma abre quando a anterior fecha. */
    const fila = [];
    if (loteFeito) fila.push(function (seguir) { perguntarFaturamento(centro, comp, valorLote, loteFeito, seguir); });
    if (divergencias.length) fila.push(function (seguir) { avisarDivergencias(seguir); });
    const seguir = function () { const f = fila.shift(); if (f) f(seguir); };

    /* ── O RESULTADO NO MEIO DA TELA, E A TELA LIMPA ──────────

       O único sinal de que tinha dado certo era o aviso do canto,
       que some em segundos — e a prévia continuava ali, inteira, com
       o botão de gerar. Quem não viu o aviso ficava na dúvida e
       clicava de novo. Agora o resultado fica no centro até ser
       fechado — inclusive quando algo deu errado, que era justamente
       o caso em que só o aviso vermelho do canto aparecia —, e a
       prévia sai sempre que algo foi lançado. */
    const resumo = { projeto: L.projeto + (L.especialidade ? ' · ' + L.especialidade : ''),
      comp: comp, feitos: feitos, valor: valorLote, bloqueados: bloqueadosFeitos,
      complementares: complementares, repetidos: repetidos, novos: novos, atualizados: atualizados,
      zerados: zerados, erros: erros, fila: fila, seguir: seguir, loteFeito: !!loteFeito,
      divergencias: divergencias.length };
    if (feitos > 0) {
      lote = null;
      Object.keys(bloqueiosPre).forEach(function (k) { delete bloqueiosPre[k]; });
      Object.keys(motivosPre).forEach(function (k) { delete motivosPre[k]; });
      Object.keys(bancariosPre).forEach(function (k) { delete bancariosPre[k]; });
      const saida = U.el('pr-saida');
      if (saida) {
        saida.innerHTML = '<div class="ajuda" style="margin:10px 0" id="pr-ultimo">Último lançamento: <b>' +
          U.esc(resumo.projeto) + ' · ' + U.fComp(comp) + '</b> — ' + feitos + ' lançamento(s), ' +
          U.brl(valorLote) + (erros.length ? ', com ' + erros.length + ' pendência(s)' : '') +
          '. Está na aba de lançamentos. Para lançar outro, escolha o arquivo acima.</div>';
      }
    }
    if (feitos > 0 || erros.length) mostrarResultado(resumo);
    else {
      ERP.app.aviso(repetidos ? repetidos + ' já existiam e foram ignorados — nada novo para lançar.'
        : 'Nada para lançar.', 'erro');
      seguir();
    }
    zerosAceitos = null;

    /* ── A RESPOSTA VALE PARA UMA GERAÇÃO, NÃO PARA A TELA ────

       "Substituir", "complemento" ou "pular repetidos" é uma decisão
       sobre ESTE fechamento. Ela só era esquecida quando um arquivo
       novo era lido — e o navegador não avisa nada quando a pessoa
       escolhe de novo o MESMO arquivo. Resultado medido: a diretora
       substituía um fechamento e, na importação seguinte, o sistema
       não perguntava nada, aplicava "pular repetidos" calado e dizia
       "0 lançamento(s) gerado(s), 36 já existiam e foram ignorados".

       Consumida a resposta, ela é esquecida; e o campo do arquivo é
       limpo, para que escolher o mesmo arquivo de novo seja lido de
       novo e a pergunta volte. */
    complementar = null;
    const campoArq = U.el('pr-arquivo');
    if (campoArq) campoArq.value = '';
  }

  /* O repasse sairia na chave antiga sem ninguém saber. */
  /* Qual campo do cadastro cada divergência conserta. O que não
     está aqui é aviso para conferir, não valor para copiar — e por
     isso não ganha botão. */
  const CAMPO_DA_DIVERGENCIA = {
    'CPF/CNPJ': 'documento',
    'chave PIX': 'pix',
    'regime (PJ/SCP)': 'regime'
  };

  function avisarDivergencias(depois) {
    ERP.app.modal({
      aoFechar: depois || null,
      titulo: divergencias.length + ' divergência(s) de cadastro',
      corpo:
        '<div class="ajuda erro">O arquivo discorda do cadastro em alguns pontos. O sistema ' +
        '<b>não sobrescreveu nada</b> — o repasse vai sair pelo cadastro atual. Confira antes ' +
        'de gerar a remessa.</div>' +
        '<table><thead><tr><th>Médico</th><th>Campo</th><th>No cadastro</th><th>No arquivo</th>' +
        '<th></th></tr></thead><tbody>' +
        divergencias.map(function (d, ix) {
          return '<tr><td class="desc">' + U.esc(d.medico) + '</td>' +
            '<td>' + U.esc(d.campo) + '</td>' +
            '<td class="mono">' + U.esc(d.cadastro) + '</td>' +
            '<td class="mono">' + U.esc(d.arquivo) + '</td>' +
            /* SEM BOTÃO no que não é um valor para copiar.

               "regime x documento" não compara duas versões do mesmo
               campo: é um aviso de que o regime cadastrado não
               combina com o tipo de documento. Não existe "usar a do
               arquivo" para isso, e o botão genérico que existia
               aqui gravaria o texto da observação dentro do campo de
               CPF/CNPJ. */
            '<td class="acoes">' + (CAMPO_DA_DIVERGENCIA[d.campo]
              ? '<button class="btn-sm" data-div="' + ix + '">Usar a do arquivo</button>'
              : '<span class="sub">confira o cadastro</span>') + '</td></tr>';
        }).join('') + '</tbody></table>',
      aoAbrir: function () {
        document.querySelectorAll('[data-div]').forEach(function (b) {
          b.addEventListener('click', function () {
            const d = divergencias[+this.dataset.div];
            const c = D.credores.find(function (x) { return x.nome === d.medico; });
            if (!c) return;
            /* CADA CAMPO NO SEU LUGAR.

               Isto era `if (chave PIX) c.pix = …; else c.documento = …`
               — um "senão" que recebia tudo o que não fosse PIX. Com
               a divergência de regime passando a existir, clicar no
               botão dela gravaria "PJ" dentro do CPF/CNPJ do médico,
               e o repasse sairia para um documento inválido.

               O mapa resolve a classe inteira: campo que não está
               nele não tem botão e não grava nada. */
            const alvo = CAMPO_DA_DIVERGENCIA[d.campo];
            if (!alvo) return;
            c[alvo] = d.campo === 'regime (PJ/SCP)'
              ? S.regimeDeTexto(d.arquivo)   // o rótulo volta a ser o código
              : d.arquivo;
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
  /* Recusa ao gravar o que foi digitado na prévia. Mora aqui, e
     não dentro do `gerar`, porque quem a produz é o
     `garantirCredor`; o `gerar` a junta às outras no fim. */
  let errosBancarios = [];

  /* ── O CPF SÓ IDENTIFICA SE FOR DA MESMA PESSOA (v174) ──

     O cadastro do médico era achado PRIMEIRO pelo CPF/CNPJ. No
     arquivo de radiologia de agosto, Alexandre e Elton vêm com o
     MESMO CPF: o primeiro criava o cadastro com ele, e o repasse do
     segundo caía no cadastro do primeiro — R$ 12.870,00 indo para o
     PIX de outro médico, sem aviso.

     Agora: CPF repetido entre nomes diferentes NO MESMO ARQUIVO não
     identifica ninguém (cada um vai pelo nome, e o CPF não é gravado
     em nenhum dos dois); e CPF que no cadastro é de OUTRA pessoa
     também não. "Outra pessoa" é primeiro e último nome diferentes —
     abreviação do meio ("Fabio Diniz B Fernandes") continua sendo a
     mesma pessoa. */
  let docsRepetidosNoArquivo = {};
  let loteEmGeracao = null;
  const L0 = function () { return loteEmGeracao; };
  function docsRepetidos(L) {
    const porDoc = {};
    Object.keys((L && L.pagto) || {}).forEach(function (k) {
      const d = String(L.pagto[k].documento || '').replace(/\D/g, '');
      if (d.length !== 11) return;   // CPF; CNPJ repetido pode ser a mesma empresa
      (porDoc[d] = porDoc[d] || []).push(k);
    });
    const r = {};
    Object.keys(porDoc).forEach(function (d) {
      const nomes = porDoc[d];
      const distintos = nomes.filter(function (n, i) {
        return !nomes.slice(0, i).some(function (o) { return mesmaPessoa(o, n); });
      });
      if (distintos.length > 1) r[d] = nomes;
    });
    return r;
  }
  /* Mesma pessoa = mesmo PRIMEIRO NOME, sem título ("Dr.", "Dra.").
     Sobrenome abreviado, "Junior", nome do meio que falta: tudo isso
     continua sendo a mesma pessoa. O que se quer pegar é o CPF de um
     médico colado na linha de OUTRO — e aí os nomes não têm nada em
     comum. */
  function mesmaPessoa(a, b) {
    const primeiro = function (n) {
      return semAcento(chaveNome(n)).replace(/[^a-z ]/g, ' ').split(/\s+/).filter(function (t) {
        return t && ['dr', 'dra', 'doutor', 'doutora'].indexOf(t) < 0;
      })[0] || '';
    };
    const pa = primeiro(a), pb = primeiro(b);
    return !!pa && pa === pb;
  }

  function garantirCredor(l, pg) {
    /* O que foi digitado na prévia manda sobre cadastro e arquivo:
       quem digitou agora sabe mais do que os dois. Aplicado pela
       função do store, que valida e registra na trilha — a tela não
       grava chave PIX por conta própria. */
    const digitado = bancariosPre[chaveNome(l.medico)];
    const aplicarDigitado = function (id) {
      if (!digitado || !id) return id;
      const r = S.informarDadosBancarios(id, digitado);
      if (r && r.erro) errosBancarios.push(l.medico + ': ' + r.erro);
      return id;
    };
    let doc = String(pg.documento || '').replace(/\D/g, '');
    if (doc && docsRepetidosNoArquivo[doc]) {
      divergencias.push({ medico: l.medico, campo: 'CPF/CNPJ repetido no arquivo',
        cadastro: 'não usado', arquivo: pg.documento + ' — também em ' + docsRepetidosNoArquivo[doc]
          .filter(function (n) { return n !== chaveNome(l.medico); }).map(function (n) {
            return (L0() && L0().medicos[n] ? L0().medicos[n].nome : n); }).join(', ') });
      pg = Object.assign({}, pg, { documento: '' });
      doc = '';
    }
    let c = doc ? D.credores.find(function (x) {
      return String(x.documento || '').replace(/\D/g, '') === doc; }) : null;
    /* Só CPF: CNPJ pode ser da empresa do médico, com outro nome. */
    if (c && doc.length === 11 && !mesmaPessoa(c.nome, l.medico) && !mesmaPessoa(c.razao_social, l.medico)) {
      divergencias.push({ medico: l.medico, campo: 'CPF/CNPJ de outro médico',
        cadastro: 'pertence a ' + c.nome, arquivo: pg.documento });
      pg = Object.assign({}, pg, { documento: '' });
      c = null;
    }
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
      /* REGIME: o cadastro manda, a planilha avisa.

         Quem corrigiu o regime na mão uma vez não quer ver a
         correção desfeita pela planilha do mês seguinte — a
         planilha é digitada por outra pessoa, em outro sistema. Mas
         também não pode mudar calado: se o arquivo passou a dizer
         outra coisa, ou o médico virou PJ, alguém precisa olhar. */
      if (c.regime && pg.regime && c.regime !== pg.regime) {
        divergencias.push({ medico: c.nome, campo: 'regime (PJ/SCP)',
                            cadastro: S.rotuloRegime(c.regime),
                            arquivo: S.rotuloRegime(pg.regime) });
      }
      if (!c.regime && pg.regime) { c.regime = pg.regime; mudou.push('regime'); }
      /* PJ pago em CPF não emite nota, e é o tipo de coisa que só
         aparece quando a nota é cobrada e não vem. Aponta, não
         decide: trocar um erro de cadastro por um palpite do
         sistema torna o erro mais difícil de achar. */
      const choque = S.regimeBateComDocumento(c.regime, c.documento || pg.documento);
      if (choque) {
        divergencias.push({ medico: c.nome, campo: 'regime x documento',
                            cadastro: choque, arquivo: pg.observacao || '—' });
      }
      if (!c.documento && pg.documento) { c.documento = pg.documento; mudou.push('CPF/CNPJ'); }
      if (!c.pix && pg.pix) { c.pix = pg.pix; c.tipo_chave = pg.tipo_chave || ''; mudou.push('chave PIX'); }
      if (!c.crm && (l.crm || pg.crm)) { c.crm = l.crm || pg.crm; mudou.push('CRM'); }
      if (!c.razao_social && pg.razao_social) { c.razao_social = pg.razao_social; mudou.push('razão social'); }
      if (!c.forma_pagamento && pg.pix) { c.forma_pagamento = 'pix'; mudou.push('forma de pagamento'); }
      if (c.tipo !== 'medico') c.tipo = 'medico';
      if (mudou.length) atualizados++;
      return aplicarDigitado(c.id);
    }

    const id = 'cr' + Date.now().toString(36) + '-' + (D.credores.length + 1);
    D.credores.push({
      id: id, nome: l.medico, tipo: 'medico', ativo: true, conta_padrao: '3.01',
      /* Nasce com o regime que a planilha trouxe. Vazio quando ela
         não disse nada — e vazio segue a regra do SCP, sem cobrar
         nota, até alguém classificar. */
      regime: pg.regime || '',
      razao_social: pg.razao_social || '', crm: l.crm || pg.crm || '',
      documento: pg.documento || '',
      pix: normalizarPix(pg).pix, tipo_chave: normalizarPix(pg).tipo_chave,
      forma_pagamento: normalizarPix(pg).pix ? 'pix' : null
    });
    novos++;
    return aplicarDigitado(id);
  }

  return { montar: montar, ler: ler };
})();
