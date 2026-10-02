/* ERP · ui-receber.js — a lista do contas a receber.
   O que foi faturado, o que já entrou, o que está atrasado e quanto
   ficou pelo caminho em retenção e glosa. */
window.ERP = window.ERP || {};

ERP.receber = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;
  const CAMPOS = ['rc-busca', 'rc-comp', 'rc-de', 'rc-ate', 'rc-centro', 'rc-status'];

  function montar() {
    const porUni = {};
    /* Projeto desativado não desaparece do filtro se já tem título
       lançado nele — senão não tem como achar de novo um recebimento
       residual de um projeto encerrado (o caso de "pode aparecer
       resíduo pago em algum momento"). */
    const comHistorico = new Set(S.contasReceber().map(function (r) { return r.centro; }));
    D.centros.filter(function (c) { return c.ativo || comHistorico.has(c.id); }).forEach(function (c) {
      const u = c.unidade || 'Estruturais';
      (porUni[u] = porUni[u] || []).push(c);
    });
    U.el('rc-centro').innerHTML = '<option value="">Todos os projetos</option>' +
      Object.keys(porUni).sort().map(function (u) {
        return '<optgroup label="' + U.esc(u) + '">' + porUni[u].map(function (c) {
          return '<option value="' + c.id + '">' + U.esc(c.curto || c.nome) +
            (!c.ativo ? ' (inativo)' : '') + '</option>';
        }).join('') + '</optgroup>';
      }).join('');
    CAMPOS.forEach(function (id) { U.el(id).addEventListener('input', render); });
    U.el('rc-limpar').addEventListener('click', function () {
      CAMPOS.forEach(function (id) { U.setVal(id, ''); });
      U.setVal('rc-status', 'aberto');
      render();
    });
    U.el('rc-exportar').addEventListener('click', function () {
      /* Quando há NF a conferir, o painel de conferência aparece ANTES
         da lista e a exportação pegava a tabela errada. Pega a última
         tabela da área, que é sempre a lista. */
      const tabelas = document.querySelectorAll('#rc-saida table');
      const t = tabelas[tabelas.length - 1];
      const dados = ERP.exportar.deTabela(t);
      if (!dados || !dados.linhas.length) return ERP.app.aviso('Nada para exportar com esses filtros.', 'erro');
      ERP.exportar.abrir(Object.assign({ nome: 'contas-a-receber', titulo: 'Contas a receber' }, dados));
    });
  }

  const filtros = () => ({
    busca: U.val('rc-busca'), comp: U.val('rc-comp'), de: U.val('rc-de'),
    ate: U.val('rc-ate'), centro: U.val('rc-centro'), status: U.val('rc-status')
  });

  /* Quatro situações, e a etiqueta diz de onde o número veio:
     previsto (previsão confirmada), faturado (nota emitida), recebido
     (dinheiro na conta) e substituído (a previsão que a nota trocou). */
  function rotulo(r) {
    if (r.status === 'recebido') {
      return '<span class="badge b-pago">recebido ' + U.fData(r.recebido_em) + '</span>' +
        (r.glosa_real > 0.004 ? '<div class="sub">glosa ' + U.brl(r.glosa_real) + '</div>' : '') +
        (r.divergencia_retencao ? '<div class="sub erro">retenção divergente: previsto ' +
          U.brl(r.divergencia_retencao.retido_previsto) + ', real ' +
          U.brl(r.divergencia_retencao.retido_real) + '</div>' : '');
    }
    if (r.status === 'previsto') {
      if (r.conferir) return '<span class="badge b-aguardando">conferir vínculo</span>';
      /* Valor que a responsável pela produtividade confirmou no
         fechamento: falta só a NF, o número já é firme. */
      return r.valor_confirmado_produtividade
        /* Selo próprio: com o verde de "pago" a lista dava a impressão
           de que o dinheiro já entrou. */
        /* O rótulo acompanha a ETAPA da esteira: confirmar o valor não
           é autorizar, e autorizar não é liberar. Dizer "falta a NF"
           logo após o fechamento dava a entender que bastava emitir. */
        ? (function () {
            const et = S.etapaDaPrevisao(S.previsaoDe(r.centro, r.competencia));
            const txt = { confirmado: 'aguardando autorização do órgão',
              autorizado: 'autorizado — aguardando liberação',
              liberado: 'liberado para emissão de NF' }[et] || 'valor confirmado';
            return '<span class="badge b-aguardando">' + txt + '</span>';
          })()
        : '<span class="badge b-pendente">previsto</span>';
    }
    if (r.status === 'substituido') return '<span class="badge b-cancelado">substituído pela nota</span>';
    if (r.status === 'cancelado') return '<span class="badge b-cancelado">cancelado</span>';
    return '<span class="badge b-aberto">faturado</span>' +
      (r.valor_recebido > 0.004 ? '<div class="sub">recebido ' + U.brl(r.valor_recebido) +
        ' · falta ' + U.brl(S.saldoReceberDe(r)) + '</div>' : '');
  }

  /* A nota chegou e pode estar substituindo uma previsão. Quem decide
     é você: por inteiro, parcial (a previsão vira resíduo) ou nenhum
     dos dois. Enquanto pende, a previsão não entra nas somas — o
     número que vale é o da nota. */
  function painelVinculos() {
    const vs = S.vinculosPendentes();
    if (!vs.length) return '';
    return '<div class="card" style="margin:0 0 12px;border-color:var(--blue)">' +
      '<h2 style="font-size:13px;margin:0 0 4px">' + vs.length +
        ' vínculo(s) de faturamento a conferir</h2>' +
      '<div class="ajuda">A nota bateu com uma previsão do mesmo projeto e competência. ' +
      'Confirme o que ela é: substitui o mês inteiro, é só uma parte dele, ou não tem relação. ' +
      'Até você decidir, a previsão fica fora das somas.</div>' +
      '<table style="margin-top:8px"><thead><tr><th>Projeto</th><th>Comp.</th>' +
      '<th>Previsão</th><th class="num">Previsto</th><th>Nota</th><th class="num">Faturado</th>' +
      '<th class="num">Diferença</th><th></th></tr></thead><tbody>' +
      vs.map(function (v) {
        const c = D.centro(v.previsto.centro) || {};
        return '<tr><td>' + U.esc(c.curto || '—') + '</td>' +
          '<td class="mono">' + U.fComp(v.previsto.competencia) + '</td>' +
          '<td class="mono sub">' + U.esc(v.previsto.numero) + '</td>' +
          '<td class="num">' + U.brl(v.previsto.valor_liquido) + '</td>' +
          '<td class="mono sub">' + U.esc(v.nota.numero) + '</td>' +
          '<td class="num">' + U.brl(v.nota.valor_liquido) + '</td>' +
          '<td class="num"' + (Math.abs(v.diferenca) > 0.05 ? ' style="color:var(--amber)"' : '') + '>' +
            (v.diferenca ? U.brl(v.diferenca) : '—') + '</td>' +
          '<td class="acoes">' +
            '<button class="btn-sm btn-aprovar" data-vinc-int="' + v.previsto.id + '">Substitui o mês</button>' +
            '<button class="btn-sm" data-vinc-parc="' + v.previsto.id + '">Faturamento parcial</button>' +
            '<button class="btn-sm btn-cancelar" data-vinc-nao="' + v.previsto.id + '">Não tem relação</button>' +
          '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function ligarVinculos() {
    const box = U.el('rc-saida');
    const agir = (attr, fn, msg) => box.querySelectorAll('[' + attr + ']').forEach(function (b) {
      b.addEventListener('click', function () {
        const r = fn(this.getAttribute(attr));
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        render();
        ERP.app.atualizarContadores();
        ERP.app.aviso(msg, 'ok');
      });
    });
    agir('data-vinc-int', function (id) { return S.confirmarSubstituicao(id, {}); },
      'Previsão substituída pela nota.');
    agir('data-vinc-parc', function (id) { return S.confirmarSubstituicao(id, { parcial: true }); },
      'Faturamento parcial: a previsão ficou com o resíduo.');
    agir('data-vinc-nao', S.recusarVinculo,
      'Vínculo recusado. A previsão continua valendo inteira.');
  }

  function render() {
    const lista = S.listarReceber(filtros());
    const todas = S.contasReceber();
    const hoje = U.hoje();
    const abertas = todas.filter(S.receberAberto);
    const previstos = abertas.filter(function (r) { return r.status === 'previsto'; });
    /* Mesmo critério do alerta e da lista (S.receberVencido): a regra
       própria daqui contava título SEM vencimento como vencido, e o
       cartão mostrava valor que não aparecia em lista nenhuma. */
    const vencidas = abertas.filter(function (r) { return S.receberVencido(r, hoje); });
    const recebidas = todas.filter(function (r) { return r.status === 'recebido'; });
    const soma = (arr, campo) => Math.round(arr.reduce(function (s, r) { return s + (r[campo] || 0); }, 0) * 100) / 100;
    /* Saldo restante, não o líquido inteiro — um título com recebimento
       parcial (resíduo mantido em aberto) continua "aberto", mas não
       pode contar o valor cheio: o que já entrou não é mais "a
       receber". */
    const somaSaldo = arr => Math.round(arr.reduce(function (s, r) { return s + S.saldoReceberDe(r); }, 0) * 100) / 100;

    U.el('rc-aberto').textContent = U.brl(somaSaldo(abertas));
    U.el('rc-aberto-pe').textContent = abertas.length + ' título(s)' +
      (previstos.length ? ' · ' + previstos.length + ' ainda previsto(s), ' +
        U.brl(somaSaldo(previstos)) : '');
    U.el('rc-vencido').textContent = U.brl(somaSaldo(vencidas));
    U.el('rc-vencido').style.color = vencidas.length ? 'var(--red)' : '';
    U.el('rc-vencido-pe').textContent = vencidas.length + ' após a previsão' +
      (vencidas.length ? ' · mais antiga ' + U.fData(vencidas.map(function (r) { return r.vencimento; }).sort()[0]) : '');
    /* Atalho do cartão de vencidas: joga o filtro direto pra lista de
       atrasadas, que é a visão que o financeiro usa pra cobrar. */
    const btnAtr = U.el('rc-ver-atrasadas');
    if (btnAtr && !btnAtr.dataset.ligado) {
      btnAtr.dataset.ligado = '1';
      btnAtr.addEventListener('click', function () {
        U.setVal('rc-status', 'atrasado');
        U.setVal('rc-comp', ''); U.setVal('rc-de', ''); U.setVal('rc-ate', '');
        render();
      });
    }
    if (btnAtr) btnAtr.style.display = vencidas.length ? '' : 'none';
    U.el('rc-recebido').textContent = U.brl(soma(recebidas, 'valor_recebido'));
    U.el('rc-recebido-pe').textContent = recebidas.length + ' recebimento(s)';
    const glosa = Math.round(recebidas.reduce(function (s, r) { return s + (r.glosa_real > 0 ? r.glosa_real : 0); }, 0) * 100) / 100;
    U.el('rc-retido').textContent = U.brl(soma(todas, 'valor_retido') + glosa);
    U.el('rc-retido-pe').textContent = 'retido ' + U.brl(soma(todas, 'valor_retido')) +
      (glosa ? ' · glosa ' + U.brl(glosa) : '');

    const painel = painelVinculos();

    if (!lista.length) {
      U.el('rc-saida').innerHTML = painel +
        '<div class="vazio"><strong>Nada com esses filtros.</strong>' +
        'O contas a receber é alimentado pelo módulo Faturamento, ao importar o pacote de notas do portal.</div>';
      ligarVinculos();
      return;
    }

    U.el('rc-saida').innerHTML = painel +
      '<table><thead><tr><th>Cliente</th><th class="num">Líquido</th><th>Previsão</th>' +
      '<th>NF</th><th>Projeto</th><th>Comp.</th><th class="num">Bruto</th><th class="num">Retido</th>' +
      '<th>Situação</th><th></th></tr></thead><tbody>' +
      lista.map(function (r) {
        const c = D.centro(r.centro) || {};
        const atraso = r.status !== 'recebido' && r.vencimento < hoje
          ? U.diasEntre(r.vencimento, hoje) : 0;
        return '<tr>' +
          '<td class="desc" title="' + U.esc(r.discriminacao.slice(0, 300)) + '">' + U.esc(r.cliente_nome) + '</td>' +
          '<td class="num">' + U.brl(r.valor_liquido) + '</td>' +
          '<td class="mono">' + U.fData(r.vencimento) +
            (atraso ? ' <span class="atraso">' + atraso + 'd</span>' : '') + '</td>' +
          '<td class="mono">' + U.esc(r.numero) +
            (r.origem === 'previsao' ? '<div class="sub">' +
              (r.valor_confirmado_produtividade ? 'confirmado na produtividade' : 'da previsão') + '</div>' : '') + '</td>' +
          '<td>' + U.esc(c.curto || '—') + '</td>' +
          '<td class="mono">' + U.fComp(r.competencia) +
            (r.competencia_presumida ? '<div class="sub">presumida</div>' : '') + '</td>' +
          '<td class="num">' + U.brl(r.valor_bruto) + '</td>' +
          '<td class="num">' + U.brl(r.valor_retido) +
            '<div class="sub">' + (r.retencao_origem === 'cadastro' ? 'do cadastro' : 'da nota') + '</div></td>' +
          '<td>' + rotulo(r) +
            (r.observacao ? '<div class="sub">' + U.esc(r.observacao) + '</div>' : '') + '</td>' +
          '<td class="acoes">' + (r.status === 'faturado' && S.pode('pagar')
            ? '<button class="btn-sm btn-pagar" data-baixar="' + r.id + '">Baixar</button>' : '') +
            (r.status !== 'recebido' && r.status !== 'cancelado' && r.status !== 'substituido' && S.pode('faturar')
              ? '<button class="btn-sm" data-editar-rec="' + r.id + '">Editar</button>' : '') +
            /* Cancelar NF/fatura emitida errada: não existia, e o único
               jeito era mudar a competência — a previsão substituída
               ficava presa e o mês continuava bloqueado pra nova
               emissão. */
            (['nota', 'fatura'].indexOf(r.origem) > -1 && r.status !== 'recebido' && r.status !== 'cancelado' &&
              (r.valor_recebido || 0) <= 0.004 && S.pode('cancelar')
              ? '<button class="btn-sm btn-cancelar" data-cancelar-rec="' + r.id + '">Cancelar</button>' : '') + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';

    U.el('rc-saida').querySelectorAll('[data-cancelar-rec]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = this.dataset.cancelarRec;
        const doc = S.contasReceber().find(function (x) { return x.id === id; }) || {};
        ERP.app.modal({
          titulo: 'Cancelar ' + (doc.origem === 'fatura' ? 'fatura ' : 'NF ') + U.esc(doc.numero || ''),
          fecharTxt: 'Voltar',
          corpo: '<div class="resumo-linha"><span>Cliente</span><span class="v">' + U.esc(doc.cliente_nome || '') + '</span></div>' +
            '<div class="resumo-linha"><span>Valor</span><span class="v">' + U.brl(doc.valor_bruto || 0) + '</span></div>' +
            '<div class="ajuda">A previsão que este documento substituiu volta a valer, e a competência ' +
              'fica livre pra emitir outro documento.</div>' +
            '<label>Motivo *</label><input id="rc-cm" placeholder="ex.: emitida com valor errado">',
          acoes: [{ txt: 'Cancelar documento', cls: 'btn-cancelar', fn: function () {
            const r2 = S.cancelarReceber(id, U.val('rc-cm'));
            if (r2.erro) return ERP.app.aviso(r2.erro, 'erro');
            ERP.app.fecharModal();
            ERP.app.atualizarContadores();
            render();
            ERP.app.aviso('Documento cancelado. A previsão do projeto voltou a valer.', 'ok');
          } }]
        });
      });
    });
    U.el('rc-saida').querySelectorAll('[data-baixar]').forEach(function (b) {
      b.addEventListener('click', function () { ERP.faturamento.baixar(this.dataset.baixar, render); });
    });
    U.el('rc-saida').querySelectorAll('[data-editar-rec]').forEach(function (b) {
      b.addEventListener('click', function () { abrirEditar(this.dataset.editarRec); });
    });
    ligarVinculos();
  }

  function abrirEditar(id) {
    const r = S.contasReceber().find(function (x) { return x.id === id; });
    if (!r) return;
    const porUni = {};
    /* O projeto atual do título entra na lista mesmo se estiver
       inativo — senão o select mostra outro projeto "selecionado" por
       acaso (o primeiro da lista) e salvar sem mexer nesse campo troca
       o projeto do título sem ninguém perceber. */
    D.centros.filter(function (c) { return c.ativo || c.id === r.centro; }).forEach(function (c) {
      const u = c.unidade || 'Estruturais';
      (porUni[u] = porUni[u] || []).push(c);
    });
    ERP.app.modal({
      titulo: 'Editar título · NF ' + r.numero,
      corpo:
        '<div class="ajuda" style="margin-bottom:8px">Pra corrigir um erro de importação — competência, ' +
        'vencimento, número ou projeto errado. Título já recebido não entra aqui: estorne o recebimento ' +
        'primeiro se precisar mexer nele.</div>' +
        '<div class="row2"><div><label>Cliente</label><input id="rce-cliente" value="' + U.esc(r.cliente_nome) + '"></div>' +
        '<div><label>Nº da NF</label><input id="rce-numero" value="' + U.esc(r.numero) + '"></div></div>' +
        '<label>Projeto</label><select id="rce-centro">' +
          Object.keys(porUni).sort().map(function (u) {
            return '<optgroup label="' + U.esc(u) + '">' + porUni[u].map(function (c) {
              return '<option value="' + c.id + '"' + (r.centro === c.id ? ' selected' : '') + '>' +
                U.esc(c.curto || c.nome) + (!c.ativo ? ' (inativo)' : '') + '</option>';
            }).join('') + '</optgroup>';
          }).join('') + '</select>' +
        '<div class="row2"><div><label>Competência</label><input type="month" id="rce-comp" value="' +
          U.esc(r.competencia) + '"></div>' +
        '<div><label>Vencimento</label><input type="date" id="rce-venc" value="' + U.esc(r.vencimento) + '"></div></div>',
      acoes: [{ txt: 'Salvar alterações', cls: 'btn-aprovar', fn: function () {
        const res = S.editarReceber(id, {
          cliente_nome: U.val('rce-cliente'), numero: U.val('rce-numero'),
          centro: U.val('rce-centro'), competencia: U.val('rce-comp'), vencimento: U.val('rce-venc')
        });
        if (res.erro) return ERP.app.aviso(res.erro, 'erro');
        ERP.app.fecharModal();
        render();
        ERP.app.aviso(res.n ? res.n + ' campo(s) alterado(s).' : 'Nada mudou.', 'ok');
      } }]
    });
  }

  /* "Recebido" é esta tela com o filtro de situação já em recebido —
     o menu chama por aqui em vez de criar outra lista. */
  function abrirAba(aba) {
    U.setVal('rc-status', aba === 'recebidas' ? 'recebido' : 'aberto');
    render();
  }

  return { montar: montar, render: render, abrirAba: abrirAba };
})();
