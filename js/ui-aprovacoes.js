/* ERP · ui-aprovacoes.js — a tela do sócio e da diretora.
   Duas filas, na ordem de urgência:
     1) pagamentos que o financeiro pediu para sair (depois disso o
        dinheiro vai embora — é o que precisa de olho primeiro)
     2) lançamentos novos aguardando aprovação
   Sem alçada por valor: a diretora autoriza qualquer valor; o token do
   banco, na hora do envio, é o controle final. */
window.ERP = window.ERP || {};

ERP.aprovacoes = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;
  let sel = new Set();     // lançamentos marcados
  let selPg = new Set();   // pagamentos marcados

  function mostrarSaldo() {
    const caixa = U.el('ap-saldo');
    if (!caixa) return;
    const banco = S.saldoBancarioAtual ? S.saldoBancarioAtual() : null;
    const aguardando = S.pagamentosAguardando();
    const totalDe = function (pg) { return (pg.valor || 0) + (pg.juros || 0) + (pg.multa || 0); };
    const fila = aguardando.reduce(function (s, pg) { return s + totalDe(pg); }, 0);

    /* O total do grupo cobrir a fila não quer dizer que cada conta
       cobre a sua parte: o lote sai de quatro contas e três CNPJs, e
       dinheiro de uma empresa não paga a conta de outra. A conta é
       feita conta a conta, e quem fura aparece pelo nome. */
    const estouradas = (banco && banco.contas ? banco.contas : []).map(function (c) {
      const naFila = aguardando.filter(function (pg) { return pg.banco === c.banco; })
        .reduce(function (s, pg) { return s + totalDe(pg); }, 0);
      return { nome: c.nome, sobra: Math.round((c.valor - naFila) * 100) / 100, fila: naFila };
    }).filter(function (c) { return c.fila > 0 && c.sobra < 0; });
    const semConta = aguardando.filter(function (pg) { return !pg.banco; })
      .reduce(function (s, pg) { return s + totalDe(pg); }, 0);
    const sobra = banco && banco.valor !== null ? Math.round((banco.valor - fila) * 100) / 100 : null;
    caixa.innerHTML =
      '<div class="rot">Saldo bancário do grupo</div>' +
      '<div class="valor">' + (banco && banco.valor !== null ? U.brl(banco.valor) : '—') + '</div>' +
      '<div class="det">' + (banco && banco.contas
        ? banco.contas.length + (banco.contas.length === 1 ? ' conta' : ' contas somadas') +
          (banco.data ? ' · a mais atrasada em ' + U.fData(banco.data) : '')
        : 'sem saldo informado') + '</div>' +
      (estouradas.length
        ? '<div class="det erro" style="margin-top:6px">Conta sem saldo para a sua parte da fila: ' +
          estouradas.map(function (c) {
            return U.esc(c.nome) + ' (falta ' + U.brl(Math.abs(c.sobra)) + ')';
          }).join(' · ') + '</div>'
        : '') +
      (semConta > 0.004
        ? '<div class="det" style="margin-top:6px">' + U.brl(semConta) +
          ' na fila sem conta de saída definida</div>'
        : '') +
      (fila > 0
        ? '<div class="det" style="margin-top:6px">Nesta fila: <b>' + U.brl(fila) + '</b>' +
          (sobra !== null
            ? ' · sobra depois de aprovar: <b class="' + (sobra < 0 ? 'erro' : '') + '">' + U.brl(sobra) + '</b>'
            : '') + '</div>'
        : '');
  }

  function render() {
    const box = U.el('ap-saida');
    if (!S.pode('aprovar') && !S.pode('pagar')) {
      box.innerHTML = '<div class="vazio"><strong>Sem acesso a esta fila.</strong>' +
        'Troque o usuário no topo da tela.</div>';
      return;
    }
    const aprovador = S.pode('aprovar');
    /* Quem aprova precisa do saldo na mesma tela: aprovar pagamento
       sem saber quanto há em conta é decidir no escuro. Mesma caixa do
       contas a pagar, e ao lado o quanto esta fila representa. */
    mostrarSaldo();

    const pagamentos = S.pagamentosAguardando()
      .sort(function (a, b) { return (a.data || '').localeCompare(b.data || ''); });

    // limpa marcações de itens que saíram da fila
    Array.from(selPg).forEach(function (id) {
      if (!pagamentos.some(function (p) { return p.id === id; })) selPg.delete(id);
    });

    if (!pagamentos.length) {
      box.innerHTML = ERP.contas.saldoBancarioResumoHTML() +
        '<div class="vazio"><strong>Nada aguardando você.</strong>' +
        'Nenhum pagamento na fila. O lançamento de nota entra direto no contas a pagar; ' +
        'o financeiro é quem manda para pagamento.</div>';
      return;
    }

    box.innerHTML = ERP.contas.saldoBancarioResumoHTML() + blocoPagamentos(pagamentos, aprovador);
    ligar([], pagamentos, aprovador);
  }

  /* ── fila 1: autorizar a saída do dinheiro ──────────────*/
  function blocoPagamentos(pagtos, aprovador) {
    if (!pagtos.length) return '';
    const total = pagtos.reduce(function (s, p) { return s + p.valor + p.juros + p.multa; }, 0);
    const marcados = pagtos.filter(function (p) { return selPg.has(p.id); });
    const somaSel = marcados.reduce(function (s, p) { return s + p.valor + p.juros + p.multa; }, 0);
    return '<h2 style="font-size:12px;margin:0 0 8px">Pagamentos aguardando aprovação' +
        '<span class="sub" style="font-weight:400"> — aprovados vão para a remessa bancária</span></h2>' +
      '<div class="pr-confere ap-resumo">' +
        '<span>' + pagtos.length + ' pagamento(s)<b>' + U.brl(total) + '</b></span>' +
        '<span>Marcados <b>' + marcados.length + ' · ' + U.brl(somaSel) + '</b></span>' +
      '</div>' +
      '<div class="ap-acoes">' +
        '<button class="btn-sm" id="ap-pg-todos">Marcar todos</button>' +
        '<button class="btn-sm" id="ap-pg-nada">Desmarcar</button>' +
        (aprovador
          ? '<button class="btn-linha" id="ap-autorizar"' + (marcados.length ? '' : ' disabled') + '>' +
              'Aprovar ' + (marcados.length || '') + ' marcado(s)</button>' +
            '<button class="btn-sm btn-cancelar" id="ap-recusar-lote"' + (marcados.length ? '' : ' disabled') + '>' +
              'Recusar marcados</button>'
          : '<button class="btn-sm btn-cancelar" id="ap-desfazer-lote"' + (marcados.length ? '' : ' disabled') + '>' +
              'Desfazer marcados</button>') +
      '</div>' +
      '<div class="ap-grupo">' +
        '<div class="ap-grupo-cab"><span>Solicitados pelo financeiro</span>' +
          '<span class="mono">' + U.brl(total) + '</span></div>' +
        /* Fechamento de produtividade chega aqui como UM item que abre:
           o gestor vê "Anestesia GHC · 08/2026 · 8 médicos · R$ 122.400"
           e decide aprovar todos, alguns ou nenhum. A aprovação segue
           sendo individual por médico — é só a leitura que agrupa. */
        (function () {
          const ag = S.agruparPagamentos(pagtos);
          const dentro = {};
          ag.grupos.forEach(function (g) {
            g.pagamentos.forEach(function (pg) { dentro[pg.id] = g.chave; });
          });
          const jaFez = {};
          return pagtos.map(function (pg) {
            const k = dentro[pg.id];
            if (!k) return linhaPagamento(pg);
            const g = ag.grupos.find(function (x) { return x.chave === k; });
            let out = '';
            if (!jaFez[k]) {
              jaFez[k] = true;
              const marcadosG = g.pagamentos.filter(function (x) { return selPg.has(x.id); }).length;
              const todosG = marcadosG === g.pagamentos.length;
              out += '<label class="ap-lin ap-lin-grupo' + (marcadosG ? ' sel' : '') + '">' +
                '<input type="checkbox" data-selgrupo="' + g.chave + '"' + (todosG ? ' checked' : '') + '>' +
                '<span class="quem"><button class="btn-abrir" type="button" data-apgrupo="' + g.chave + '">' +
                  (apAbertos.has(g.chave) ? '▾' : '▸') + '</button> <b>' +
                  U.esc(S.nomeDoGrupo(g)) + '</b></span>' +
                '<span class="oque">' + g.medicos + ' médicos · produtividade' +
                  (marcadosG ? ' <span class="sub">' + marcadosG + ' marcado(s)</span>' : '') + '</span>' +
                '<span class="mono venc"></span>' +
                '<span class="num quanto"><b>' + U.brl(g.valor) + '</b></span>' +
                '<span style="white-space:nowrap;display:flex;gap:3px">' +
                  (aprovador
                    ? '<button class="btn-sm btn-pagar" type="button" data-autgrupo="' + g.chave + '">Aprovar todos</button>'
                    : '') +
                  '<button class="btn-sm" type="button" data-apgrupo="' + g.chave + '">' +
                    (apAbertos.has(g.chave) ? 'Fechar' : 'Ver médicos') + '</button>' +
                '</span></label>';
            }
            return out + (apAbertos.has(k) ? linhaPagamento(pg, true) : '');
          }).join('');
        })() +
      '</div>';
  }

  function linhaPagamento(pg, dentroDeGrupo) {
    const aprovador = S.pode('aprovar');
    return (function (pg) {
          const par = S.parcela(pg.parcela_id) || {};
          const centro = D.centro(par.centro) || {};
          const extra = pg.juros + pg.multa;
          return '<label class="ap-lin' + (selPg.has(pg.id) ? ' sel' : '') +
            (dentroDeGrupo ? ' ap-lin-filha' : '') + '">' +
            '<input type="checkbox" data-selpg="' + pg.id + '"' + (selPg.has(pg.id) ? ' checked' : '') + '>' +
            '<span class="quem">' + U.esc(ERP.lancamento.nomeCredor(par.credor) || '—') + '</span>' +
            '<span class="oque">' + U.esc(par.descricao || '') +
              (centro.curto ? ' <span class="sub">' + U.esc(centro.curto) + '</span>' : '') +
              (extra > 0 ? ' <span class="sub">inclui ' + U.brl(extra) + ' de juros/multa</span>' : '') + '</span>' +
            '<span class="mono venc">' + U.fData(pg.data) + '</span>' +
            '<span class="num quanto">' + U.brl(pg.valor + extra) + '</span>' +
            '<span style="white-space:nowrap;display:flex;gap:3px">' +
              (aprovador
                ? '<button class="btn-sm btn-pagar" data-aut="' + pg.id + '" type="button">Aprovar</button>' +
                  '<button class="btn-sm btn-cancelar" data-rec="' + pg.id + '" type="button">Recusar</button>'
                : '<button class="btn-sm btn-cancelar" data-des="' + pg.id + '" type="button">Desfazer</button>') +
            '</span>' +
          '</label>';
    })(pg);
  }

  /* ── fila 2: aprovar lançamentos ────────────────────────*/
  function blocoLancamentos(lista) {
    if (!lista.length) return '';
    // agrupado por projeto, que é como o sócio pensa o gasto
    const grupos = {};
    lista.forEach(function (p) { (grupos[p.centro || '—'] = grupos[p.centro || '—'] || []).push(p); });
    const total = lista.reduce(function (s, p) { return s + p.valor; }, 0);
    const somaSel = Array.from(sel).map(function (id) { return S.parcela(id); })
      .filter(Boolean).reduce(function (s, p) { return s + p.valor; }, 0);

    return '<h2 style="font-size:12px;margin:18px 0 8px">Lançamentos aguardando aprovação</h2>' +
      '<div class="pr-confere ap-resumo">' +
        '<span>' + lista.length + ' lançamento(s)<b>' + U.brl(total) + '</b></span>' +
        '<span>Selecionados <b>' + sel.size + ' · ' + U.brl(somaSel) + '</b></span>' +
      '</div>' +
      '<div class="ap-acoes">' +
        '<button class="btn-sm" id="ap-todos">Selecionar tudo</button>' +
        '<button class="btn-sm" id="ap-nada">Limpar</button>' +
        '<button class="btn-linha" id="ap-aprovar"' + (sel.size ? '' : ' disabled') + '>' +
          'Aprovar ' + (sel.size || '') + ' selecionado(s)</button>' +
      '</div>' +
      Object.keys(grupos).map(function (k) {
        const c = D.centro(k) || {};
        const itens = grupos[k];
        const soma = itens.reduce(function (s, p) { return s + p.valor; }, 0);
        return '<div class="ap-grupo">' +
          '<div class="ap-grupo-cab">' +
            '<span>' + U.esc(c.nome || 'Sem centro de custo') + '</span>' +
            '<span class="mono">' + itens.length + ' · ' + U.brl(soma) + '</span>' +
          '</div>' +
          itens.map(function (p) {
            return '<label class="ap-lin' + (sel.has(p.id) ? ' sel' : '') + '">' +
              '<input type="checkbox" data-sel="' + p.id + '"' + (sel.has(p.id) ? ' checked' : '') + '>' +
              '<span class="quem">' + U.esc(ERP.lancamento.nomeCredor(p.credor) || '—') + '</span>' +
              '<span class="oque">' + U.esc(p.descricao) + '</span>' +
              '<span class="mono venc">' + U.fData(p.venc) + '</span>' +
              '<span class="num quanto">' + U.brl(p.valor) + '</span>' +
              '<button class="btn-sm" data-ver="' + p.id + '" type="button">Ver</button>' +
            '</label>';
          }).join('') +
        '</div>';
      }).join('');
  }

  /* ── eventos ────────────────────────────────────────────*/
  const apAbertos = new Set();   // fechamentos abertos na fila

  function ligarGrupos(pagtos, aprovador) {
    const box = U.el('ap-saida');
    const ag = S.agruparPagamentos(pagtos);
    box.querySelectorAll('[data-apgrupo]').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.preventDefault();
        const k = this.dataset.apgrupo;
        apAbertos.has(k) ? apAbertos.delete(k) : apAbertos.add(k);
        render();
      });
    });
    box.querySelectorAll('[data-selgrupo]').forEach(function (chk) {
      chk.addEventListener('change', function () {
        const g = ag.grupos.find(function (x) { return x.chave === this.dataset.selgrupo; }.bind(this));
        if (!g) return;
        g.pagamentos.forEach(function (pg) {
          this.checked ? selPg.add(pg.id) : selPg.delete(pg.id);
        }.bind(this));
        render();
      });
    });
    box.querySelectorAll('[data-autgrupo]').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.preventDefault();
        const g = ag.grupos.find(function (x) { return x.chave === this.dataset.autgrupo; }.bind(this));
        if (!g) return;
        const r = S.autorizarPagamento(g.pagamentos.map(function (pg) { return pg.id; }));
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        render();
        ERP.app.atualizarContadores();
        ERP.app.aviso(g.medicos + ' pagamentos aprovados (' + S.nomeDoGrupo(g) + ').', 'ok');
      });
    });
  }

  function ligar(lista, pagtos, aprovador) {
    ligarGrupos(pagtos, aprovador);
    const box = U.el('ap-saida');

    box.querySelectorAll('[data-selpg]').forEach(function (chk) {
      chk.addEventListener('change', function (e) {
        e.stopPropagation();
        this.checked ? selPg.add(this.dataset.selpg) : selPg.delete(this.dataset.selpg);
        render();
      });
    });
    if (U.el('ap-pg-todos')) {
      U.el('ap-pg-todos').addEventListener('click', function () {
        pagtos.forEach(function (p) { selPg.add(p.id); });
        ERP.app.aviso(pagtos.length + ' pagamento(s) marcado(s).', 'ok');
        render();
      });
      U.el('ap-pg-nada').addEventListener('click', function () { selPg.clear(); render(); });
    }
    if (U.el('ap-desfazer-lote')) {
      U.el('ap-desfazer-lote').addEventListener('click', function () {
        let n = 0;
        Array.from(selPg).forEach(function (id) { if (S.cancelarSolicitacao(id).ok) n++; });
        selPg.clear();
        ERP.app.aviso(n + ' solicitação(ões) desfeita(s).', 'ok');
        ERP.app.atualizar();
      });
    }
    if (U.el('ap-recusar-lote')) {
      U.el('ap-recusar-lote').addEventListener('click', function () {
        const ids = Array.from(selPg);
        ERP.app.modal({
          titulo: 'Recusar ' + ids.length + ' pagamento(s)',
          corpo: '<label>Motivo</label><textarea id="mo-motivo"></textarea>' +
                 '<div class="ajuda">As parcelas voltam ao estado anterior.</div>',
          acoes: [{ txt: 'Recusar', cls: 'btn-cancelar', fn: function () {
            const m = U.val('mo-motivo');
            if (!m) return ERP.app.aviso('Informe o motivo da recusa.', 'erro');
            let n = 0;
            ids.forEach(function (id) { if (S.recusarPagamento(id, m).ok) n++; });
            selPg.clear();
            ERP.app.fecharModal();
            ERP.app.aviso(n + ' pagamento(s) recusado(s).', 'ok');
            ERP.app.atualizar();
          } }]
        });
      });
    }
    box.querySelectorAll('[data-des]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        const r = S.cancelarSolicitacao(this.dataset.des);
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.aviso('Solicitação desfeita.', 'ok');
        ERP.app.atualizar();
      });
    });

    box.querySelectorAll('[data-aut]').forEach(function (b) {
      b.addEventListener('click', function () {
        const r = S.autorizarPagamento([this.dataset.aut]);
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.aviso('Pagamento aprovado — já está na aba de remessa bancária.', 'ok');
        ERP.app.atualizar();
      });
    });

    box.querySelectorAll('[data-rec]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = this.dataset.rec;
        ERP.app.modal({
          titulo: 'Recusar pagamento',
          corpo: '<div class="ajuda" style="margin-bottom:8px">A parcela volta ao estado anterior e ' +
                 'continua na lista de contas a pagar.</div>' +
                 '<label>Motivo</label><textarea id="mo-motivo" placeholder="Ex.: valor divergente do fechamento"></textarea>',
          acoes: [{ txt: 'Recusar pagamento', cls: 'btn-cancelar', fn: function () {
            const r = S.recusarPagamento(id, U.val('mo-motivo'));
            if (r.erro) return ERP.app.aviso(r.erro, 'erro');
            ERP.app.fecharModal();
            ERP.app.aviso('Pagamento recusado — a parcela voltou para a fila.', 'ok');
            ERP.app.atualizar();
          } }]
        });
      });
    });

    if (U.el('ap-autorizar')) {
      U.el('ap-autorizar').addEventListener('click', function () {
        const r = S.autorizarPagamento(Array.from(selPg));
        selPg.clear();
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.aviso(r.n + ' pagamento(s) aprovado(s) — já estão na aba de remessa bancária.', 'ok');
        ERP.app.atualizar();
      });
    }

    box.querySelectorAll('[data-sel]').forEach(function (chk) {
      chk.addEventListener('change', function (e) {
        e.stopPropagation();
        this.checked ? sel.add(this.dataset.sel) : sel.delete(this.dataset.sel);
        render();
      });
    });
    box.querySelectorAll('[data-ver]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        ERP.contas.verDetalhe(this.dataset.ver);
      });
    });
    if (U.el('ap-todos')) {
      U.el('ap-todos').addEventListener('click', function () {
        // marca tudo o que pode ser aprovado; o que não pode fica de fora
        const podem = lista.filter(function (p) { return p.status !== 'cancelado'; });
        podem.forEach(function (p) { sel.add(p.id); });
        const fora = lista.length - podem.length;
        ERP.app.aviso(podem.length + ' lançamento(s) marcado(s)' +
          (fora ? ', ' + fora + ' fora da seleção' : '') + '.', 'ok');
        render();
      });
      U.el('ap-nada').addEventListener('click', function () { sel.clear(); render(); });
      U.el('ap-aprovar').addEventListener('click', function () {
        const r = S.aprovar(Array.from(sel));
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        sel.clear();
        ERP.app.aviso(r.n + ' lançamento(s) aprovado(s).', 'ok');
        ERP.app.atualizar();
      });
    }
  }

  return { render: render };
})();
