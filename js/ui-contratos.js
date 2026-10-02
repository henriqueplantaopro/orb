/* ERP · ui-contratos.js — gestão de contratos.

   O contrato é a origem da receita: diz quanto cada linha de projeto
   fatura por mês, até quando vale e quando reajusta. Duas coisas
   importam mais que o cadastro em si — a vigência gritar antes de
   vencer, e o valor do contrato poder virar a previsão do mês. */
window.ERP = window.ERP || {};

ERP.contratos = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;
  let filtro = 'vigentes';
  let parte = 'cliente';   // aba: contratos com clientes ou com fornecedores
  let abertos = new Set();

  function montar() {
    document.querySelectorAll('#ct-nav button').forEach(function (b) {
      b.addEventListener('click', function () { filtro = this.dataset.ct; render(); });
    });
    document.querySelectorAll('#ct-parte button').forEach(function (b) {
      b.addEventListener('click', function () { parte = this.dataset.parte; abertos.clear(); render(); });
    });
    U.el('ct-novo').addEventListener('click', function () { editar(null); });
    U.el('ct-aplicar').addEventListener('click', aplicarNasPrevisoes);
  }

  const nomeCliente = id => (D.clientes.find(function (c) { return c.id === id; }) || {}).nome || '—';
  const nomeFornecedor = id => (D.credor(id) || {}).nome || '—';
  /* Contrato de cliente é o que a empresa fatura; o de fornecedor é o
     que ela paga (aluguel, software, contabilidade, manutenção). Os
     dois moram no mesmo módulo, em abas separadas. */
  const ehFornecedor = c => (c.parte || 'cliente') === 'fornecedor';
  const nomeContraparte = c => ehFornecedor(c) ? nomeFornecedor(c.fornecedor) : nomeCliente(c.cliente);
  const rotTipo = t => D.TIPOS_CONTRATO[t] || t || '—';

  function render() {
    document.querySelectorAll('#ct-nav button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.ct === filtro);
    });
    document.querySelectorAll('#ct-parte button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.parte === parte);
    });
    const hoje = U.hoje();
    const todos = S.contratos({ parte: parte });
    const lista = todos.filter(function (c) {
      if (filtro === 'vigentes') return !c.encerrado && (!c.vigencia_fim || c.vigencia_fim >= hoje);
      if (filtro === 'vencendo') return !c.encerrado && c.vigencia_fim &&
        U.diasEntre(hoje, c.vigencia_fim) <= 90;
      if (filtro === 'reajuste') {
        if (c.encerrado || !c.reajuste_mes) return false;
        const d = U.diasEntre(hoje, c.reajuste_mes + '-01');
        return d <= 45;
      }
      if (filtro === 'encerrados') return c.encerrado || (c.vigencia_fim && c.vigencia_fim < hoje);
      return true;
    });
    const alertas = S.alertasContrato().filter(function (a2) {
      return ((a2.contrato.parte || 'cliente') === parte);
    });
    const mensal = lista.reduce(function (s, c) { return s + c.valor_mensal; }, 0);

    U.el('ct-saida').innerHTML =
      '<div class="pr-confere">' +
        '<span>Contratos <b>' + lista.length + ' de ' + todos.length + '</b></span>' +
        '<span>' + (parte === 'fornecedor' ? 'Despesa mensal contratada' : 'Valor mensal contratado') +
          ' <b>' + U.brl(mensal) + '</b></span>' +
        '<span>Ao ano <b>' + U.brl(Math.round(mensal * 12 * 100) / 100) + '</b></span>' +
        '<span>Alertas <b class="' + (alertas.length ? 'erro' : '') + '">' + alertas.length + '</b></span>' +
      '</div>' +
      blocoExemplos(todos) +
      blocoAlertas(alertas) +
      '<div class="tabela-rolagem" style="margin:10px -14px 0"><table><thead><tr>' +
      '<th style="width:18px"></th><th>Contrato</th><th>' +
      (parte === 'fornecedor' ? 'Fornecedor' : 'Cliente') + '</th><th>Tipo</th>' +
      '<th class="num">Valor mensal</th><th>Início</th><th>Fim da vigência</th>' +
      '<th>Reajuste</th><th>Situação</th><th></th>' +
      '</tr></thead><tbody>' +
      (lista.length ? lista.map(function (c) {
        const dias = c.vigencia_fim ? U.diasEntre(hoje, c.vigencia_fim) : null;
        const sit = c.encerrado ? { t: 'encerrado', c: 'b-cancelado' }
          : dias === null ? { t: 'sem vigência', c: 'b-pendente' }
          : dias < 0 ? { t: 'vencido há ' + Math.abs(dias) + 'd', c: 'b-reprovado' }
          : dias <= 30 ? { t: 'vence em ' + dias + 'd', c: 'b-reprovado' }
          : dias <= 90 ? { t: 'vence em ' + dias + 'd', c: 'b-pendente' }
          : { t: 'vigente', c: 'b-pago' };
        const aberto = abertos.has(c.id);
        return '<tr class="' + (c.encerrado ? 'cancelada' : '') + '" style="cursor:pointer" data-ct-ab="' + c.id + '">' +
          '<td class="sub">' + (aberto ? '▾' : '▸') + '</td>' +
          '<td class="desc">' + U.esc(c.numero) +
            (c.exemplo ? ' <span class="badge b-reprovado" title="vigência, índice e mês de reajuste ' +
              'não foram informados por você — são dados de exemplo">exemplo</span>' : '') +
            ((c.aditivos || []).length ? '<div class="sub">' + c.aditivos.length + ' aditivo(s)</div>' : '') + '</td>' +
          '<td class="desc">' + U.esc(nomeContraparte(c)) + '</td>' +
          '<td>' + U.esc(rotTipo(c.tipo)) + '</td>' +
          '<td class="num">' + U.brl(c.valor_mensal) + '</td>' +
          '<td class="mono">' + U.fData(c.vigencia_ini) + '</td>' +
          '<td class="mono">' + U.fData(c.vigencia_fim) + '</td>' +
          '<td>' + (c.reajuste_mes ? U.fComp(c.reajuste_mes) : '—') +
            (c.indice ? ' <span class="sub">' + U.esc(c.indice) + '</span>' : '') + '</td>' +
          '<td><span class="badge ' + sit.c + '">' + sit.t + '</span>' +
            (c.renovacao === 'automatica' ? '<div class="sub">renova automático</div>' : '') + '</td>' +
          '<td class="acoes">' +
            '<button class="btn-sm" data-ct-ed="' + c.id + '">Editar</button>' +
            '<button class="btn-sm" data-ct-ad="' + c.id + '">Aditivo</button></td></tr>' +
          (aberto ? detalhe(c) : '');
      }).join('')
        : '<tr><td colspan="10" class="vazio"><strong>Nenhum contrato neste filtro.</strong>' +
          'Cadastre pelo botão acima ou troque o filtro.</td></tr>') +
      '</tbody></table></div>' +
      '<div class="ajuda">Clique no contrato para abrir as linhas de projeto e o objeto. ' +
      'O valor mensal é a soma das linhas. Aditivo de prazo ' +
      'empurra a vigência; aditivo de valor reajusta as linhas pelo percentual e recalcula o mensal.</div>';

    ligar();
  }

  /* Contrato que veio do exemplo não pode ser confundido com dado real:
     os alertas dele valem tanto quanto a vigência que o gerou. */
  /* As linhas de projeto abrem para baixo em vez de virar coluna:
     com quatro linhas por contrato, a tabela ficava larga demais. */
  function detalhe(c) {
    const itensC = c.itens || [];
    return '<tr><td></td><td colspan="9" style="background:#fafbfc;padding:10px 8px">' +
      (c.objeto ? '<div style="margin-bottom:8px"><b>Objeto:</b> ' + U.esc(c.objeto) + '</div>' : '') +
      '<table style="margin:0"><thead><tr><th>Projeto</th><th>Unidade</th><th>Tipo</th>' +
      '<th class="num">Valor mensal</th><th class="num">% do contrato</th></tr></thead><tbody>' +
      itensC.map(function (i) {
        const pj = D.centro(i.centro) || {};
        const parte = c.valor_mensal ? Math.round(i.valor / c.valor_mensal * 1000) / 10 : 0;
        return '<tr><td class="desc">' + U.esc(pj.curto || '?') + '</td>' +
          '<td>' + U.esc(pj.unidade || '—') + '</td>' +
          '<td class="sub">' + U.esc(D.TIPOS_SERVICO[pj.tipo_servico] || '—') + '</td>' +
          '<td class="num">' + U.brl(i.valor) + '</td>' +
          '<td class="num sub">' + U.num(parte) + '%</td></tr>';
      }).join('') +
      '<tr class="total"><td colspan="3">Total mensal</td>' +
      '<td class="num">' + U.brl(c.valor_mensal) + '</td><td></td></tr>' +
      '</tbody></table>' +
      ((c.aditivos || []).length
        ? '<div style="margin-top:8px"><b>Aditivos:</b><ul class="historico">' +
          c.aditivos.map(function (a) {
            return '<li>' + U.fData(a.data) + ' · ' + U.esc(a.numero) + ' · ' + U.esc(a.tipo) +
              (a.nova_vigencia ? ' — nova vigência ' + U.fData(a.nova_vigencia) : '') +
              (a.percentual ? ' — ' + U.num(a.percentual) + '%' : '') +
              (a.observacao ? ' · ' + U.esc(a.observacao) : '') + '</li>';
          }).join('') + '</ul></div>'
        : '') +
      (c.renovacao ? '<div class="ajuda">Renovação: ' + U.esc(c.renovacao) +
        (c.processo ? ' · processo ' + U.esc(c.processo) : '') + '</div>' : '') +
      '</td></tr>';
  }

  function blocoExemplos(todos) {
    const ex = todos.filter(function (c) { return c.exemplo; });
    if (!ex.length) return '';
    return '<div class="aviso" style="margin:10px 0;border-left-color:var(--red)">' +
      '<b>' + ex.length + ' contrato(s) com dados de exemplo:</b> ' +
      ex.map(function (c) { return U.esc(c.numero); }).join(', ') + '. ' +
      'Número, processo e valor mensal vieram das notas e da sua tabela de previsões; ' +
      '<b>vigência, índice e mês de reajuste foram preenchidos para testar o alerta e não são reais</b>. ' +
      'Os avisos de vencimento desses contratos só valem depois que você editar e confirmar as datas — ' +
      'editar tira a marca de exemplo.</div>';
  }

  function blocoAlertas(alertas) {
    if (!alertas.length) return '';
    return '<div class="aviso" style="margin:10px 0">' +
      '<b>' + alertas.length + ' aviso(s) de contrato:</b><ul style="margin:6px 0 0 16px">' +
      alertas.map(function (a) {
        return '<li>' + U.esc(a.contrato.numero) +
          (a.contrato.exemplo ? ' <span class="badge b-reprovado">exemplo</span>' : '') +
          ' (' + U.esc(nomeContraparte(a.contrato).slice(0, 34)) + ' · ' +
            (ehFornecedor(a.contrato) ? 'fornecedor' : 'cliente') + ') ' + U.esc(a.texto) +
          ' — ' + U.brl(a.contrato.valor_mensal) + '/mês' +
          (a.contrato.exemplo ? ' (data não confirmada)' : '') + '</li>';
      }).join('') + '</ul></div>';
  }

  /* ── cadastro ───────────────────────────────────────────*/
  let itens = [];

  /* Cliente ou projeto que ainda não existe se cadastra daqui, sem
     perder o que já foi digitado: o formulário é guardado, o cadastro
     abre por cima e o contrato volta com tudo no lugar. */
  function lerRascunho() {
    lerItens();
    return {
      numero: U.val('ct-num'), tipo: U.val('ct-tipo'), processo: U.val('ct-proc'),
      cliente: U.el('ct-cli') ? U.val('ct-cli') : '',
      fornecedor: U.el('ct-forn') ? U.val('ct-forn') : '',
      conta: U.el('ct-conta') ? U.val('ct-conta') : '',
      objeto: U.val('ct-obj'),
      vigencia_ini: U.val('ct-ini'), vigencia_fim: U.val('ct-fim'),
      renovacao: U.val('ct-ren'), indice: U.val('ct-idx'), reajuste_mes: U.val('ct-reaj'),
      /* As condições comerciais também entram no rascunho: sem elas,
         usar "+ cadastrar cliente" no meio do contrato apagava
         vencimento, multa, juros, regras, garantia e contato. */
      dia_vencimento: U.val('ct-dia-venc'), prazo_dias: U.val('ct-prazo'),
      dia_entrega_nf: U.val('ct-dia-nf'), multa_atraso_pct: U.val('ct-multa'),
      juros_mes_pct: U.val('ct-juros'), correcao_atraso: U.val('ct-corr'),
      regra_reajuste: U.val('ct-regra-reaj'), regra_renovacao: U.val('ct-regra-ren'),
      aviso_rescisao_dias: U.val('ct-aviso'), garantia: U.val('ct-garantia'),
      contato_cobranca: U.val('ct-contato'),
      observacao: U.val('ct-obs'), itens: itens.slice(),
      encerrado: U.el('ct-enc') ? U.el('ct-enc').checked : false
    };
  }

  function cadastrarDentro(tipo) {
    const rascunho = lerRascunho();
    if (tipo === 'cliente') {
      ERP.cadastros.editarCliente(null, function (novoId) {
        if (novoId) rascunho.cliente = novoId;         // já vem escolhido
        editar(idEmEdicao, rascunho);
      });
    } else {
      ERP.cadastros.editarProjeto(null, function (novoId) {
        if (novoId) {
          const vago = rascunho.itens.find(function (i) { return !i.centro; });
          if (vago) vago.centro = novoId;
          else rascunho.itens.push({ centro: novoId, valor: 0 });
        }
        editar(idEmEdicao, rascunho);
      });
    }
  }

  let idEmEdicao = null;

  function editar(id, rascunho) {
    idEmEdicao = id;
    // contrato novo herda a aba aberta; contrato existente manda no que é
    const fornec = id ? (S.contrato(id) || {}).parte === 'fornecedor' : parte === 'fornecedor';
    const base = S.contrato(id);
    const c = rascunho ? Object.assign({}, base || {}, rascunho) : base;
    itens = (c && c.itens && c.itens.length)
      ? c.itens.map(function (i) { return { centro: i.centro, valor: i.valor }; })
      : [{ centro: '', valor: 0 }];

    ERP.app.modal({
      titulo: (id ? 'Contrato ' + (c ? c.numero : '') : 'Novo contrato') +
        (fornec ? ' · com fornecedor (a pagar)' : ' · com cliente (a faturar)'),
      corpo:
        '<div class="row3"><div><label>Número *</label><input id="ct-num" value="' + U.esc(c ? c.numero : '') + '"></div>' +
        '<div><label>Tipo</label><select id="ct-tipo">' +
          Object.keys(D.TIPOS_CONTRATO).map(function (k) {
            return '<option value="' + k + '"' + (c && c.tipo === k ? ' selected' : '') + '>' +
              U.esc(D.TIPOS_CONTRATO[k]) + '</option>';
          }).join('') + '</select></div>' +
        '<div><label>Processo / edital</label><input id="ct-proc" value="' + U.esc(c ? (c.processo || '') : '') + '"></div></div>' +
        (fornec
          /* Contrato de fornecedor: a contraparte é um credor e a
             despesa precisa de natureza (plano de contas) pra cair no
             lugar certo da DRE quando virar título. */
          ? '<div class="row2"><div><label>Fornecedor *</label><select id="ct-forn">' +
              '<option value="">Escolher…</option>' +
              D.credores.filter(function (x) { return x.ativo !== false && x.tipo !== 'medico' && x.tipo !== 'funcionario'; })
                .sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome)); })
                .map(function (x) {
                  return '<option value="' + x.id + '"' + (c && c.fornecedor === x.id ? ' selected' : '') + '>' +
                    U.esc(x.nome) + '</option>';
                }).join('') + '</select></div>' +
            '<div><label>Natureza da despesa *</label><select id="ct-conta">' +
              '<option value="">Escolher…</option>' +
              D.plano.filter(function (x) { return x.nivel === 2 && x.tipo !== 'receita'; }).map(function (x) {
                return '<option value="' + x.cod + '"' + (c && c.conta === x.cod ? ' selected' : '') + '>' +
                  U.esc(x.cod + ' ' + x.nome) + '</option>';
              }).join('') + '</select></div></div>'
          : '<label>Cliente * <button class="btn-ghost" id="ct-novo-cli" type="button" ' +
            'style="float:right;padding:0">+ cadastrar cliente</button></label><select id="ct-cli">' +
            '<option value="">Escolher…</option>' +
            D.clientes.map(function (x) {
              return '<option value="' + x.id + '"' + (c && c.cliente === x.id ? ' selected' : '') + '>' +
                U.esc(x.nome) + '</option>';
            }).join('') + '</select>') +
        '<label>Objeto</label><textarea id="ct-obj">' + U.esc(c ? (c.objeto || '') : '') + '</textarea>' +
        '<div class="row3"><div><label>Início da vigência *</label><input type="date" id="ct-ini" value="' +
          (c ? c.vigencia_ini : '') + '"></div>' +
        '<div><label>Fim da vigência *</label><input type="date" id="ct-fim" value="' +
          (c ? c.vigencia_fim : '') + '"></div>' +
        '<div><label>Renovação</label><select id="ct-ren">' +
          [['prorrogavel', 'prorrogável por aditivo'], ['automatica', 'automática'], ['nao', 'não renova']]
            .map(function (o) {
              return '<option value="' + o[0] + '"' + (c && c.renovacao === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
            }).join('') + '</select></div></div>' +
        '<div class="row2"><div><label>Índice de reajuste</label><select id="ct-idx">' +
          ['', 'IPCA', 'IGPM', 'INPC', 'IPCA-E', 'contratual'].map(function (t) {
            return '<option value="' + t + '"' + (c && c.indice === t ? ' selected' : '') + '>' + (t || '—') + '</option>';
          }).join('') + '</select></div>' +
        '<div><label>Mês do próximo reajuste</label><input type="month" id="ct-reaj" value="' +
          (c ? (c.reajuste_mes || '') : '') + '"></div></div>' +
        '<h2 style="font-size:12px;margin:14px 0 6px">Pagamento e reajuste previstos em contrato</h2>' +
        '<div class="row3">' +
          '<div><label>Dia de vencimento</label><input class="num" id="ct-dia-venc" inputmode="numeric" placeholder="ex.: 10" value="' +
            (c && c.dia_vencimento ? c.dia_vencimento : '') + '"></div>' +
          '<div><label>Prazo de pagamento (dias após a NF)</label><input class="num" id="ct-prazo" inputmode="numeric" value="' +
            (c && c.prazo_dias ? c.prazo_dias : '') + '"></div>' +
          '<div><label>Dia limite para entrega da NF</label><input class="num" id="ct-dia-nf" inputmode="numeric" placeholder="ex.: 5" value="' +
            (c && c.dia_entrega_nf ? c.dia_entrega_nf : '') + '"></div></div>' +
        '<div class="row3">' +
          '<div><label>Multa por atraso (%)</label><input class="num" id="ct-multa" inputmode="decimal" value="' +
            U.num(c ? (c.multa_atraso_pct || 0) : 0) + '"></div>' +
          '<div><label>Juros de mora (% ao mês)</label><input class="num" id="ct-juros" inputmode="decimal" value="' +
            U.num(c ? (c.juros_mes_pct || 0) : 0) + '"></div>' +
          '<div><label>Correção do atraso</label><select id="ct-corr">' +
            [['', '—'], ['ipca', 'IPCA'], ['igpm', 'IGPM'], ['selic', 'SELIC'], ['contratual', 'conforme contrato']]
              .map(function (o) { return '<option value="' + o[0] + '"' +
                (c && c.correcao_atraso === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
            '</select></div></div>' +
        '<div class="row2">' +
          '<div><label>Regra de reajuste</label><input id="ct-regra-reaj" placeholder="ex.: anual pelo IPCA, na data-base de assinatura" value="' +
            U.esc(c ? (c.regra_reajuste || '') : '') + '"></div>' +
          '<div><label>Regra de renovação</label><input id="ct-regra-ren" placeholder="ex.: automática por 12 meses, aviso 60 dias antes" value="' +
            U.esc(c ? (c.regra_renovacao || '') : '') + '"></div></div>' +
        '<div class="row3">' +
          '<div><label>Aviso prévio para rescisão (dias)</label><input class="num" id="ct-aviso" inputmode="numeric" value="' +
            (c && c.aviso_rescisao_dias ? c.aviso_rescisao_dias : '') + '"></div>' +
          '<div><label>Garantia contratual</label><input id="ct-garantia" placeholder="caução, seguro, fiança…" value="' +
            U.esc(c ? (c.garantia || '') : '') + '"></div>' +
          '<div><label>Contato do cliente para cobrança</label><input id="ct-contato" placeholder="nome / e-mail / telefone" value="' +
            U.esc(c ? (c.contato_cobranca || '') : '') + '"></div></div>' +
        '<h2 style="font-size:12px;margin:14px 0 6px">Linhas de projeto e valor mensal' +
          '<button class="btn-ghost" id="ct-novo-pj" type="button" style="float:right;padding:0">' +
          '+ cadastrar projeto</button></h2>' +
        '<div id="ct-itens"></div>' +
        '<label>Observação</label><textarea id="ct-obs">' + U.esc(c ? (c.observacao || '') : '') + '</textarea>' +
        (c ? '<label style="display:flex;gap:7px;align-items:center;margin-top:10px;font-weight:400">' +
             '<input type="checkbox" id="ct-enc" style="width:auto"' + (c.encerrado ? ' checked' : '') + '> ' +
             'contrato encerrado</label>' : ''),
      acoes: [{ txt: idEmEdicao ? 'Salvar' : 'Cadastrar', cls: 'btn-aprovar', fn: function () {
        lerItens();
        const r = S.salvarContrato({
          id: idEmEdicao, numero: U.val('ct-num'), tipo: U.val('ct-tipo'),
          processo: U.val('ct-proc'),
          /* parte vem da aba (contrato novo) ou do próprio contrato */
          parte: fornec ? 'fornecedor' : 'cliente',
          cliente: U.el('ct-cli') ? U.val('ct-cli') : '',
          fornecedor: U.el('ct-forn') ? U.val('ct-forn') : '',
          conta: U.el('ct-conta') ? U.val('ct-conta') : '',
          objeto: U.val('ct-obj'),
          vigencia_ini: U.val('ct-ini'), vigencia_fim: U.val('ct-fim'),
          renovacao: U.val('ct-ren'), indice: U.val('ct-idx'), reajuste_mes: U.val('ct-reaj'),
          dia_vencimento: parseInt(U.val('ct-dia-venc'), 10) || null,
          prazo_dias: parseInt(U.val('ct-prazo'), 10) || null,
          dia_entrega_nf: parseInt(U.val('ct-dia-nf'), 10) || null,
          multa_atraso_pct: U.parseValor(U.val('ct-multa')),
          juros_mes_pct: U.parseValor(U.val('ct-juros')),
          correcao_atraso: U.val('ct-corr'),
          regra_reajuste: U.val('ct-regra-reaj'), regra_renovacao: U.val('ct-regra-ren'),
          aviso_rescisao_dias: parseInt(U.val('ct-aviso'), 10) || null,
          garantia: U.val('ct-garantia'), contato_cobranca: U.val('ct-contato'),
          observacao: U.val('ct-obs'), itens: itens,
          encerrado: U.el('ct-enc') ? U.el('ct-enc').checked : false
        });
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        ERP.app.aviso('Contrato salvo: ' + U.brl(r.contrato.valor_mensal) + '/mês.', 'ok');
        render();
      } }],
      aoAbrir: function () {
        renderItens();
        if (rascunho) {
          [['ct-dia-venc', 'dia_vencimento'], ['ct-prazo', 'prazo_dias'], ['ct-dia-nf', 'dia_entrega_nf'],
           ['ct-multa', 'multa_atraso_pct'], ['ct-juros', 'juros_mes_pct'], ['ct-corr', 'correcao_atraso'],
           ['ct-regra-reaj', 'regra_reajuste'], ['ct-regra-ren', 'regra_renovacao'],
           ['ct-aviso', 'aviso_rescisao_dias'], ['ct-garantia', 'garantia'],
           ['ct-contato', 'contato_cobranca'], ['ct-obs', 'observacao'],
           ['ct-num', 'numero'], ['ct-proc', 'processo'], ['ct-obj', 'objeto'],
           ['ct-ini', 'vigencia_ini'], ['ct-fim', 'vigencia_fim'], ['ct-reaj', 'reajuste_mes']
          ].forEach(function (par) {
            if (U.el(par[0]) && rascunho[par[1]] !== undefined && rascunho[par[1]] !== '') U.setVal(par[0], rascunho[par[1]]);
          });
        }
        // no contrato de fornecedor não existe o botão de cadastrar cliente
        if (U.el('ct-novo-cli')) U.el('ct-novo-cli').addEventListener('click', function () { cadastrarDentro('cliente'); });
        U.el('ct-novo-pj').addEventListener('click', function () { cadastrarDentro('projeto'); });
      }
    });
  }

  function renderItens() {
    const box = U.el('ct-itens');
    const total = itens.reduce(function (s, i) { return s + (i.valor || 0); }, 0);
    const porUni = {};
    /* Projeto INATIVO que já está no contrato continua na lista (com
       a marca): antes ele não aparecia no select, e salvar o contrato
       apagava aquela linha — um contrato de R$ 70.000 caiu pra
       R$ 20.000 só por ser reaberto. */
    const usados = {};
    itens.forEach(function (i) { if (i.centro) usados[i.centro] = true; });
    D.centros.filter(function (c) {
      return c.tipo === 'projeto' && (c.ativo || usados[c.id]);
    }).forEach(function (c) {
      (porUni[c.unidade || '—'] = porUni[c.unidade || '—'] || []).push(c);
    });
    box.innerHTML = itens.map(function (i, ix) {
      return '<div class="rateio-lin">' +
        '<select data-i="' + ix + '" data-c="centro"><option value="">Escolher projeto…</option>' +
          Object.keys(porUni).sort().map(function (u) {
            return '<optgroup label="' + U.esc(u) + '">' + porUni[u].map(function (c) {
              return '<option value="' + c.id + '"' + (c.id === i.centro ? ' selected' : '') + '>' +
                U.esc(c.curto) + (c.ativo ? '' : ' (inativo)') + '</option>';
            }).join('') + '</optgroup>';
          }).join('') + '</select>' +
        '<input class="num" data-i="' + ix + '" data-c="valor" inputmode="decimal" value="' + U.num(i.valor) + '">' +
        '<button class="btn-ghost" data-rem="' + ix + '" type="button">✕</button>' +
      '</div>';
    }).join('') +
    '<div class="rateio-pe"><button class="btn-sm" id="ct-add-item" type="button">+ outra linha</button>' +
      '<span class="soma">' + U.brl(total) + ' / mês</span></div>';

    box.querySelectorAll('select,input').forEach(function (e) {
      e.addEventListener('change', function () {
        lerItens();
        renderItens();
      });
    });
    box.querySelectorAll('[data-rem]').forEach(function (b) {
      b.addEventListener('click', function () {
        itens.splice(+this.dataset.rem, 1);
        if (!itens.length) itens = [{ centro: '', valor: 0 }];
        renderItens();
      });
    });
    U.el('ct-add-item').addEventListener('click', function () {
      lerItens();
      itens.push({ centro: '', valor: 0 });
      renderItens();
    });
  }

  function lerItens() {
    const box = U.el('ct-itens');
    if (!box) return;
    box.querySelectorAll('[data-c="centro"]').forEach(function (s) {
      const i = +s.dataset.i;
      if (itens[i]) itens[i].centro = s.value;
    });
    box.querySelectorAll('[data-c="valor"]').forEach(function (s) {
      const i = +s.dataset.i;
      if (itens[i]) itens[i].valor = U.parseValor(s.value);
    });
  }

  /* ── aditivo ────────────────────────────────────────────*/
  function aditivo(id) {
    const c = S.contrato(id);
    if (!c) return;
    ERP.app.modal({
      titulo: 'Aditivo · contrato ' + c.numero,
      corpo:
        '<div class="resumo-linha"><span>Vigência atual</span><span class="v">' +
          U.fData(c.vigencia_ini) + ' a ' + U.fData(c.vigencia_fim) + '</span></div>' +
        '<div class="resumo-linha"><span>Valor mensal atual</span><span class="v">' + U.brl(c.valor_mensal) + '</span></div>' +
        '<div class="row3"><div><label>Número</label><input id="ad-num"></div>' +
        '<div><label>Data</label><input type="date" id="ad-data" value="' + U.hoje() + '"></div>' +
        '<div><label>Tipo</label><select id="ad-tipo">' +
          '<option value="prazo">prorrogação de prazo</option>' +
          '<option value="valor">reajuste de valor</option>' +
          '<option value="escopo">alteração de escopo</option></select></div></div>' +
        '<div class="row2"><div><label>Nova vigência (prazo)</label><input type="date" id="ad-vig"></div>' +
        '<div><label>Percentual (valor)</label><input id="ad-pct" class="num" inputmode="decimal" value="0,00"></div></div>' +
        '<label>Observação</label><textarea id="ad-obs"></textarea>' +
        '<div class="ajuda">Aditivo de prazo troca o fim da vigência; de valor aplica o percentual em ' +
        'todas as linhas do contrato. O histórico fica registrado.</div>' +
        ((c.aditivos || []).length
          ? '<h2 style="font-size:12px;margin:14px 0 6px">Aditivos já registrados</h2><ul class="historico">' +
            c.aditivos.map(function (a) {
              return '<li>' + U.fData(a.data) + ' · ' + U.esc(a.numero) + ' · ' + U.esc(a.tipo) +
                (a.nova_vigencia ? ' até ' + U.fData(a.nova_vigencia) : '') +
                (a.percentual ? ' · ' + U.num(a.percentual) + '%' : '') + '</li>';
            }).join('') + '</ul>'
          : ''),
      acoes: [{ txt: 'Registrar aditivo', cls: 'btn-aprovar', fn: function () {
        const r = S.addAditivo(id, {
          numero: U.val('ad-num'), tipo: U.val('ad-tipo'), data: U.val('ad-data'),
          nova_vigencia: U.val('ad-vig'), percentual: U.parseValor(U.val('ad-pct')),
          observacao: U.val('ad-obs')
        });
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        ERP.app.aviso('Aditivo registrado.', 'ok');
        render();
      } }]
    });
  }

  /* O contrato é a fonte do valor: joga o mensal nas previsões do mês,
     para a estimativa não ser digitada de novo. */
  /* Joga o valor dos contratos na previsão de faturamento do mês. Três
     cuidados que faltavam:
     - só contrato de CLIENTE (o de fornecedor é despesa; jogá-lo aqui
       virava receita no a receber);
     - só quem está VIGENTE na competência (antes gravava previsão em
       mês fora da vigência);
     - SOMA quando o mesmo projeto aparece em mais de um contrato, em
       vez do último apagar o anterior;
     - e nunca por cima do valor já confirmado pela produtividade, que
       é número de medição e vale mais que estimativa de contrato. */
  function aplicarNasPrevisoes() {
    const comp = U.val('ct-comp') || U.mesAtual();
    const ini = comp + '-01';
    const fim = U.addDias(U.compDe(U.addMeses(ini, 1)) + '-01', -1);
    const porCentro = {};
    const origem = {};
    S.contratos({ parte: 'cliente' }).forEach(function (c) {
      if (c.encerrado) return;
      if (c.vigencia_ini && c.vigencia_ini > fim) return;
      if (c.vigencia_fim && c.vigencia_fim < ini) return;
      (c.itens || []).forEach(function (i) {
        if (!i.valor || !D.centro(i.centro)) return;
        porCentro[i.centro] = Math.round(((porCentro[i.centro] || 0) + i.valor) * 100) / 100;
        (origem[i.centro] = origem[i.centro] || []).push(c.numero);
      });
    });

    let n = 0, protegidas = 0;
    Object.keys(porCentro).forEach(function (centro) {
      const atual = S.previsaoDe(centro, comp);
      if (atual && atual.status === 'confirmada_prod') { protegidas++; return; }
      const pj = D.centro(centro);
      const r = S.salvarPrevisao({
        centro: centro, competencia: comp, faturamento: porCentro[centro],
        produtividade: atual ? atual.produtividade : (pj.prev_repasse || 0),
        observacao: 'valor do(s) contrato(s) ' + origem[centro].join(', ')
      });
      if (r.ok) n++;
    });
    ERP.app.aviso(n + ' previsão(ões) de faturamento atualizada(s) para ' + U.fComp(comp) +
      ' com o valor dos contratos de cliente vigentes.' +
      (protegidas ? ' ' + protegidas + ' ficaram como estavam por já terem valor confirmado na produtividade.' : ''), 'ok');
  }

  function ligar() {
    const box = U.el('ct-saida');
    box.querySelectorAll('[data-ct-ab]').forEach(function (tr) {
      tr.addEventListener('click', function (e) {
        if (e.target.closest('button')) return;      // botão de ação não expande
        const id = this.dataset.ctAb;
        abertos.has(id) ? abertos.delete(id) : abertos.add(id);
        render();
      });
    });
    box.querySelectorAll('[data-ct-ed]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); editar(this.dataset.ctEd); });
    });
    box.querySelectorAll('[data-ct-ad]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); aditivo(this.dataset.ctAd); });
    });
  }

  return { montar: montar, render: render };
})();
