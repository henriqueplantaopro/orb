/* ERP · ui-saldo.js — saldo bancário informado à mão.

   Existe para uma pergunta só: o que o sistema calcula bate com o que
   tem no banco? Você digita o saldo que aparece no extrato, e a tela
   compara com o saldo que sai da conciliação (saldo anterior + entradas
   − saídas conciliadas). Quando a diferença aparece, ela mostra o
   caminho: quanto veio do extrato ainda não conciliado e quanto foi
   baixado no sistema sem lançamento no extrato. */
window.ERP = window.ERP || {};

ERP.saldo = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;

  function montar() { /* desenhado no render */ }

  function render() {
    const hoje = U.hoje();
    const linhas = D.bancos.map(function (b) { return prova(b, hoje); });
    const divergentes = linhas.filter(function (l) { return l.informado !== null && Math.abs(l.diferenca) > 0.004; });

    U.el('sb-saida').innerHTML =
      '<div class="pr-confere">' +
        '<span>Contas <b>' + linhas.length + '</b></span>' +
        '<span>Conferidas hoje <b>' + linhas.filter(function (l) { return l.informado !== null; }).length + '</b></span>' +
        '<span>Divergentes <b class="' + (divergentes.length ? 'erro' : '') + '">' + divergentes.length + '</b></span>' +
      '</div>' +
      '<table><thead><tr><th>Conta</th><th class="num">Saldo no sistema</th>' +
        '<th class="num">Saldo informado</th><th class="num">Diferença</th><th>Prova real</th>' +
        '<th></th></tr></thead><tbody>' +
      linhas.map(function (l) {
        return '<tr' + (Math.abs(l.diferenca) > 0.004 && l.informado !== null ? ' style="background:#fff4f2"' : '') + '>' +
          '<td class="desc">' + U.esc(l.banco.apelido || l.banco.nome || l.banco.id) +
            (l.banco.agencia || l.banco.conta
              ? '<div class="sub">ag. ' + U.esc(l.banco.agencia || '—') + ' · c/c ' + U.esc(l.banco.conta || '—') + '</div>'
              : '') + '</td>' +
          '<td class="num">' + U.brl(l.sistema) +
            '<div class="sub">' + (l.ate ? 'conciliado até ' + U.fData(l.ate) : 'sem extrato importado') + '</div></td>' +
          '<td class="num">' + (l.informado === null ? '<span class="sub">—</span>' : U.brl(l.informado)) +
            (l.informado_em ? '<div class="sub">' + U.fData(l.informado_em) +
              (l.informado_por ? ' · ' + U.esc(l.informado_por) : '') + '</div>' : '') + '</td>' +
          '<td class="num' + (l.informado !== null && Math.abs(l.diferenca) > 0.004 ? ' erro' : ' sub') + '">' +
            (l.informado === null ? '—' : (Math.abs(l.diferenca) <= 0.004 ? 'bate' : U.brl(l.diferenca))) + '</td>' +
          '<td class="sub">' + explicacao(l) + '</td>' +
          '<td class="acoes"><button class="btn-sm btn-aprovar" data-sb="' + l.banco.id + '">Informar saldo</button></td>' +
          '</tr>';
      }).join('') + '</tbody></table>' +
      '<div class="ajuda">O saldo do sistema é o último saldo do extrato importado mais o que foi ' +
        'conciliado depois. A prova real decompõe a diferença: o que está no extrato e ainda não foi ' +
        'conciliado, e o que foi baixado no sistema sem aparecer no extrato.</div>' +
      blocoEntreEmpresas();
    ligar();
  }

  /* ── entre as empresas do grupo ─────────────────────────
     Dinheiro de uma empresa que pagou conta de outra, ou foi
     transferido direto para a conta dela. O saldo sai COMPENSADO por
     par: é o que a contabilidade lança. */
  function blocoEntreEmpresas() {
    const cc = S.contaCorrenteEmpresas({});
    const transf = S.transferenciasBanco({}).slice(0, 12);

    return '<h3 style="font-size:13px;margin:22px 0 6px">Entre as empresas do grupo</h3>' +
      '<div class="pr-confere">' +
        '<span>Em aberto <b>' + U.brl(cc.total) + '</b></span>' +
        '<span>Lançamentos <b>' + cc.linhas.length + '</b></span>' +
        '<button class="btn-linha" id="sb-transferir">Transferir entre contas</button>' +
      '</div>' +
      (cc.saldos.length
        ? '<table><thead><tr><th>Quem deve</th><th>A quem</th>' +
          '<th class="num" style="width:140px">Saldo</th>' +
          '<th style="width:220px">Composição</th></tr></thead><tbody>' +
          cc.saldos.map(function (x) {
            return '<tr><td class="desc">' + U.esc(x.devedora_nome) + '</td>' +
              '<td>' + U.esc(x.credora_nome) + '</td>' +
              '<td class="num"><b>' + U.brl(x.valor) + '</b></td>' +
              '<td class="sub">' + x.itens + ' lançamento(s)' +
              (x.compensado ? ' · compensado de ' + U.brl(Math.max(x.bruto_ida, x.bruto_volta)) +
                ' contra ' + U.brl(Math.min(x.bruto_ida, x.bruto_volta)) : '') +
              '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="vazio">Nenhuma operação entre as empresas no período.</div>') +
      (cc.linhas.length
        ? '<table style="margin-top:10px"><thead><tr><th style="width:90px">Data</th>' +
          '<th>Operação</th><th style="width:120px">Origem</th>' +
          '<th class="num" style="width:120px">Valor</th></tr></thead><tbody>' +
          cc.linhas.slice(0, 20).map(function (l) {
            return '<tr><td class="mono">' + U.fData(l.data) + '</td>' +
              '<td class="desc">' + U.esc(l.descricao) + '</td>' +
              '<td class="sub">' + (l.origem_registro === 'extrato' ? 'conciliação'
                : l.tipo === 'transferencia' ? 'transferência' : 'baixa manual') + '</td>' +
              '<td class="num">' + U.brl(l.valor) + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '') +
      /* As últimas transferências, com o botão de cancelar: a função
         existia no store desde a v17 e nunca teve caminho pela tela —
         transferência lançada errada só se desfazia por código. */
      (transf.length
        ? '<h3 style="font-size:13px;margin:22px 0 6px">Últimas transferências entre contas</h3>' +
          '<table><thead><tr><th style="width:90px">Data</th><th>De → para</th>' +
          '<th class="num" style="width:120px">Valor</th><th style="width:120px"></th>' +
          '</tr></thead><tbody>' +
          transf.map(function (t) {
            const de = (D.banco(t.origem) || {}).apelido || t.origem;
            const para = (D.banco(t.destino) || {}).apelido || t.destino;
            return '<tr><td class="mono">' + U.fData(t.data) + '</td>' +
              '<td class="desc">' + U.esc(de) + ' → ' + U.esc(para) +
              (t.cancelada ? '<div class="sub">cancelada: ' + U.esc(t.motivo_cancelamento || '') +
                '</div>' : '') + '</td>' +
              '<td class="num">' + U.brl(t.valor) + '</td>' +
              '<td>' + (t.cancelada ? '<span class="badge b-cancelado">cancelada</span>'
                : '<button class="btn-sm" data-canc-transf="' + t.id + '">Cancelar</button>') +
              '</td></tr>';
          }).join('') + '</tbody></table>' +
          '<div class="ajuda">Transferência entre contas da mesma empresa é remanejo de caixa e não ' +
          'entra na conta corrente acima — só as que cruzam CNPJ.</div>'
        : '') +
      '<div class="ajuda">Na baixa manual o sistema pergunta antes de registrar o mútuo. Na ' +
        'conciliação não pergunta: o dinheiro já saiu do banco, então o lançamento é registrado e ' +
        'aparece marcado como vindo do extrato.</div>';
  }

  /* A conta: saldo do extrato + conciliado depois dele. A diferença
     contra o informado costuma ter duas origens, e a tela diz quais. */
  function prova(banco, hoje) {
    const base0 = S.saldoAtual(banco.id);
    const base = base0.valor || 0;
    const ate = base0.data || null;

    /* Movimento do sistema depois da data do extrato: é o que explica a
       diferença legítima entre "o banco de ontem" e "o sistema de
       hoje". */
    const pagoDepois = S.todosPagamentos()
      .filter(function (p) { return p.banco === banco.id && (!ate || p.data > ate) && p.data <= hoje; })
      .reduce(function (s, p) { return s + p.valor + (p.juros || 0) + (p.multa || 0); }, 0);
    /* Recebido NESTA conta, baixa a baixa. */
    const recebidoDepois = S.recebidoNaConta(banco.id, hoje, ate);
    const semConta = S.recebidoSemConta(hoje);
    const naoConciliado = S.linhasExtrato({ banco: banco.id, situacao: 'pendente' })
      .reduce(function (s, l) { return s + l.valor; }, 0);

    const sistema = S.saldoDoSistema(banco.id, hoje);
    const inf = S.saldoInformado(banco.id) || {};
    const informado = inf.valor === undefined ? null : inf.valor;
    return {
      banco: banco, sistema: sistema, ate: ate, base: base,
      pago_depois: Math.round(pagoDepois * 100) / 100,
      recebido_depois: Math.round(recebidoDepois * 100) / 100,
      nao_conciliado: Math.round(naoConciliado * 100) / 100,
      sem_conta: semConta,
      informado: informado, informado_em: inf.data || null, informado_por: inf.por || null,
      diferenca: informado === null ? 0 : Math.round((informado - sistema) * 100) / 100
    };
  }

  function explicacao(l) {
    if (l.informado === null) return 'informe o saldo do extrato para conferir';
    if (Math.abs(l.diferenca) <= 0.004) return 'sistema e banco batem';
    const partes = [];
    if (Math.abs(l.nao_conciliado) > 0.004) {
      partes.push(U.brl(Math.abs(l.nao_conciliado)) + ' no extrato ainda não conciliado');
    }
    if (l.pago_depois) partes.push(U.brl(l.pago_depois) + ' baixado no sistema depois do extrato');
    if (l.recebido_depois) partes.push(U.brl(l.recebido_depois) + ' recebido no sistema depois do extrato');
    /* Recebimento baixado sem conta de crédito não entra em saldo
       nenhum — e é candidato a explicar a falta. */
    if (l.sem_conta && l.sem_conta.valor > 0.004) {
      partes.push(U.brl(l.sem_conta.valor) + ' recebido sem conta informada (' +
        l.sem_conta.baixas + ' ' + (l.sem_conta.baixas === 1 ? 'baixa' : 'baixas') +
        ') — fora de todo saldo');
    }
    return partes.length ? partes.join(' · ') : 'diferença sem origem identificada — conferir lançamento a lançamento';
  }

  function ligar() {
    U.el('sb-saida').querySelectorAll('[data-sb]').forEach(function (b) {
      b.addEventListener('click', function () {
        const banco = D.bancos.find(function (x) { return x.id === this.dataset.sb; }.bind(this));
        const l = prova(banco, U.hoje());
        ERP.app.modal({
          titulo: 'Saldo informado · ' + banco.nome,
          fecharTxt: 'Cancelar',
          corpo:
            '<div class="resumo-linha"><span>Saldo no sistema</span><span class="v">' + U.brl(l.sistema) + '</span></div>' +
            '<div class="ajuda">Digite o saldo que aparece no aplicativo ou no extrato do banco, na data ' +
              'de hoje. É a prova real: se der diferença, a tela mostra de onde ela vem.</div>' +
            '<div class="row2">' +
              '<div><label>Saldo no banco (R$) *</label><input class="num" id="sb-valor" inputmode="decimal" value="' +
                U.num(l.informado === null ? l.sistema : l.informado) + '"></div>' +
              '<div><label>Data</label><input type="date" id="sb-data" value="' + U.hoje() + '"></div>' +
            '</div>' +
            '<label>Observação</label><input id="sb-obs" placeholder="ex.: conferido no app às 9h">',
          acoes: [{ txt: 'Salvar', cls: 'btn-aprovar', fn: function () {
            const r = S.informarSaldoBancario(banco.id, { valor: U.parseValor(U.val('sb-valor')),
              data: U.val('sb-data'), observacao: U.val('sb-obs') });
            if (ERP.app.erroDoRetorno(r)) return;
            ERP.app.fecharModal();
            render();
            ERP.app.aviso(Math.abs(r.diferenca) <= 0.004
              ? 'Saldo confere com o sistema.'
              : 'Saldo salvo. Diferença de ' + U.brl(Math.abs(r.diferenca)) + ' — veja a prova real na linha.',
              Math.abs(r.diferenca) <= 0.004 ? 'ok' : 'erro');
          } }]
        });
      });
    });

    /* Cancelar transferência lançada errada: a função existia desde a
       v17 e não tinha botão. */
    document.querySelectorAll('[data-canc-transf]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = this.dataset.cancTransf;
        ERP.app.modal({
          titulo: 'Cancelar a transferência',
          corpo: '<label>Por quê?</label><input id="ct-motivo" placeholder="ex.: lancei a conta errada">' +
            '<div class="ajuda">Os dois saldos voltam ao que eram. Se a transferência cruzou CNPJ, ' +
            'o lançamento da conta corrente entre as empresas cai junto.</div>',
          acoes: [{ txt: 'Cancelar transferência', cls: 'btn-cancelar', fn: function () {
            const r = S.cancelarTransferenciaBanco(id, U.val('ct-motivo'));
            if (ERP.app.erroDoRetorno(r)) return;
            ERP.app.fecharModal(); render();
            ERP.app.aviso('Transferência cancelada — os saldos voltaram.', 'ok');
          } }]
        });
      });
    });

    const bt = U.el('sb-transferir');
    if (bt) bt.addEventListener('click', function () {
      const opts = D.bancos.filter(function (b) { return b.ativo !== false; })
        .map(function (b) {
          return '<option value="' + b.id + '">' + U.esc(b.apelido || b.nome) +
            (b.empresa ? ' · ' + U.esc((D.empresaPor(b.empresa) || {}).apelido || '') : '') +
            '</option>';
        }).join('');
      ERP.app.modal({
        titulo: 'Transferir entre contas',
        corpo:
          '<div class="row2"><div><label>De</label><select id="tb-origem">' + opts + '</select></div>' +
          '<div><label>Para</label><select id="tb-destino">' + opts + '</select></div></div>' +
          '<div class="row2"><div><label>Valor</label><input id="tb-valor" class="num"></div>' +
          '<div><label>Data</label><input type="date" id="tb-data" max="' + U.hoje() +
            '" value="' + U.hoje() + '"></div></div>' +
          '<label>Observação</label><input id="tb-obs" placeholder="ex.: aporte para a folha">' +
          '<div class="ajuda">Entre contas da mesma empresa é só remanejo de caixa. Entre empresas ' +
            'diferentes, quem manda vira credora e o valor entra na conta corrente do grupo.</div>',
        acoes: [{ txt: 'Transferir', cls: 'btn-aprovar', fn: function () {
          const dados = { origem: U.val('tb-origem'), destino: U.val('tb-destino'),
            valor: U.parseValor(U.val('tb-valor')), data: U.val('tb-data'), obs: U.val('tb-obs') };
          const r = S.transferirEntreContas(dados);
          /* Saldo que fica negativo é pergunta, não bloqueio: pode
             ser limite usado de verdade. */
          if (r.confirmar_saldo_negativo) {
            return ERP.app.modal({
              titulo: 'A conta fica negativa',
              corpo: '<div class="ajuda">' + U.esc(r.erro) + '</div>',
              acoes: [{ txt: 'Transferir mesmo assim', cls: 'btn-aprovar', fn: function () {
                const r2 = S.transferirEntreContas(
                  Object.assign({}, dados, { confirmar_saldo_negativo: true }));
                if (r2.erro) return ERP.app.aviso(r2.erro, 'erro');
                ERP.app.fecharModal(); render();
                ERP.app.aviso('Transferência registrada.', 'ok');
              } }]
            });
          }
          if (ERP.app.erroDoRetorno(r)) return;
          ERP.app.fecharModal();
          render();
          ERP.app.aviso(r.entre_empresas
            ? 'Transferência registrada — ' + r.transferencia.mutuo.devedora_nome +
              ' passou a dever ' + U.brl(r.transferencia.valor) + ' à ' +
              r.transferencia.mutuo.credora_nome + '.'
            : 'Transferência registrada entre contas da mesma empresa.', 'ok');
        } }]
      });
    });
  }

  return { montar: montar, render: render };
})();
