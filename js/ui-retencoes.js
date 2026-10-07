/* ERP · ui-retencoes.js — retenção de impostos (ISS, IRRF, PIS, COFINS,
   CSLL, INSS) em NF de fornecedor.

   Cada NF com retenção já gera dois lançamentos na hora (ver
   store.js: criarTitulo separa a retenção pra uma reserva à parte).
   Esta tela é o que falta pra fechar o ciclo: mostrar quanto está
   pendente de cada tributo, por competência, e fechar a guia — um
   pagamento único (por conta de origem) que reúne todas as NFs do
   mês, com rastreabilidade de quais notas entraram e de quanto cada
   uma contribuiu. */
window.ERP = window.ERP || {};

ERP.retencoes = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;

  const NOMES = { ISS: 'ISS', IRRF: 'IRRF', PIS: 'PIS', COFINS: 'COFINS', CSLL: 'CSLL', INSS: 'INSS', CSRF: 'PIS/COFINS/CSLL (DARF 5952)' };

  function montar() {
    // a tela é toda refeita a cada render() — nada pra amarrar de antemão
  }

  function podeFechar() { return S.pode('lancar'); }

  function render() {
    const box = U.el('rt-saida');
    const pendentes = S.resumoRetencoesPendentes();
    const guias = S.guiasRetencao();

    box.innerHTML =
      '<h2>Retenções de impostos<span class="sub">ISS, IRRF, PIS, COFINS, CSLL e INSS retidos em NF de fornecedor — ' +
        'agrupados numa guia por tributo e competência</span></h2>' +
      '<h3 style="font-size:13px;margin:4px 0 6px">Pendente de fechar guia</h3>' +
      (pendentes.length
        ? '<table class="parcelas"><thead><tr><th>Tributo</th><th>Competência</th><th>Município</th>' +
            '<th class="num">NF(s)</th><th class="num">Total retido</th><th></th></tr></thead><tbody>' +
            pendentes.map(function (r) {
              return '<tr><td>' + U.esc(NOMES[r.tributo] || r.tributo) + '</td><td>' + U.fComp(r.competencia) + '</td><td>' + U.esc(r.tributo === 'ISS' ? (r.municipio || 'sede (não informado)') : '—') + '</td>' +
                '<td class="num">' + r.qtd + '</td><td class="num">' + U.brl(r.total) + '</td>' +
                '<td>' + (podeFechar()
                  ? '<button class="btn-sm" data-ver-pendente="' + r.tributo + '|' + r.competencia + '|' + (r.municipio || '') + '">Ver NFs</button> ' +
                    '<button class="btn-sm btn-aprovar" data-fechar-guia="' + r.tributo + '|' + r.competencia + '|' + (r.municipio || '') + '">Fechar guia</button>'
                  : '<button class="btn-sm" data-ver-pendente="' + r.tributo + '|' + r.competencia + '|' + (r.municipio || '') + '">Ver NFs</button>') + '</td></tr>';
            }).join('') +
          '</tbody></table>'
        : '<div class="ajuda">Nenhuma retenção pendente no momento.</div>') +
      '<h3 style="font-size:13px;margin:18px 0 6px">Guias já fechadas</h3>' +
      (guias.length
        ? '<table class="parcelas"><thead><tr><th>Tributo</th><th>Competência</th><th>Conta</th>' +
            '<th class="num">NF(s)</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead><tbody>' +
            guias.map(function (g) {
              return '<tr><td>' + U.esc(NOMES[g.tributo] || g.tributo) + '</td><td>' + U.fComp(g.competencia) + '</td>' +
                '<td>' + U.esc(g.conta) + '</td><td class="num">' + g.qtd_nfs + '</td><td class="num">' + U.brl(g.total) + '</td>' +
                '<td>' + (g.cancelada ? '<span class="badge b-cancelado">cancelada</span>' : '<span class="badge b-pago">fechada</span>') + '</td>' +
                '<td><button class="btn-sm" data-ver-guia="' + g.id + '">Ver</button> ' +
                  (!g.cancelada && podeFechar() ? '<button class="btn-sm" data-cancelar-guia="' + g.id + '">Cancelar</button>' : '') + '</td></tr>';
            }).join('') +
          '</tbody></table>'
        : '<div class="ajuda">Nenhuma guia fechada ainda.</div>');

    box.querySelectorAll('[data-ver-pendente]').forEach(function (b) {
      b.addEventListener('click', function () {
        const partes = this.dataset.verPendente.split('|');
        abrirDetalhePendente(partes[0], partes[1], partes[2]);
      });
    });
    box.querySelectorAll('[data-fechar-guia]').forEach(function (b) {
      b.addEventListener('click', function () {
        const partes = this.dataset.fecharGuia.split('|');
        abrirFecharGuia(partes[0], partes[1], partes[2]);
      });
    });
    box.querySelectorAll('[data-ver-guia]').forEach(function (b) {
      b.addEventListener('click', function () { abrirDetalheGuia(this.dataset.verGuia); });
    });
    box.querySelectorAll('[data-cancelar-guia]').forEach(function (b) {
      b.addEventListener('click', function () { abrirCancelarGuia(this.dataset.cancelarGuia); });
    });
  }

  function abrirDetalhePendente(tributo, competencia, municipio) {
    const itens = S.retencoesPendentes({ tributo: tributo, competencia: competencia, municipio: tributo === 'ISS' ? (municipio || '') : undefined });
    ERP.app.modal({
      titulo: NOMES[tributo] + ' pendente — ' + U.fComp(competencia),
      corpo: '<table class="parcelas"><thead><tr><th>NF</th><th>Fornecedor</th><th>Conta</th>' +
          '<th class="num">Valor retido</th></tr></thead><tbody>' +
        itens.map(function (r) {
          return '<tr><td>' + U.esc(r.nf_documento || '—') + '</td><td>' + U.esc((D.credor(r.credor) || {}).nome || '') + '</td>' +
            '<td>' + U.esc(r.conta) + '</td><td class="num">' + U.brl(r.valor) + '</td></tr>';
        }).join('') +
        '<tr><td colspan="3"><b>Total</b></td><td class="num"><b>' + U.brl(itens.reduce(function (s, r) { return s + r.valor; }, 0)) + '</b></td></tr>' +
      '</tbody></table>'
    });
  }

  function abrirFecharGuia(tributo, competencia, municipio) {
    const itens = S.retencoesPendentes({ tributo: tributo, competencia: competencia, municipio: tributo === 'ISS' ? (municipio || '') : undefined });
    const total = Math.round(itens.reduce(function (s, r) { return s + r.valor; }, 0) * 100) / 100;
    const contas = {};
    itens.forEach(function (r) { contas[r.conta] = Math.round(((contas[r.conta] || 0) + r.valor) * 100) / 100; });
    const qtdContas = Object.keys(contas).length;
    // vencimento sugerido: dia 20 do mês seguinte ao da competência — ajustável, cada guia tem prazo próprio
    /* Dia 20 do mês seguinte, ANTECIPANDO quando cai em fim de
       semana ou feriado — a tela montava a data na mão e, nas quatro
       competências seguintes, todas caíam em dia sem expediente
       bancário. O store já tinha a função, usada nas guias da folha. */
    const vencSugerido = S.dia20MesSeguinte(competencia + '-01');
    ERP.app.modal({
      titulo: 'Fechar guia de ' + NOMES[tributo] + ' — ' + U.fComp(competencia),
      fecharTxt: 'Cancelar',
      corpo:
        '<div class="ajuda">' + itens.length + ' NF(s) somam ' + U.brl(total) + ' de ' + NOMES[tributo] + ' retido — ' +
          'fecha num título só, do jeito que a guia de verdade também é uma só pra competência inteira.' +
          (qtdContas > 1
            ? ' Vêm de ' + qtdContas + ' contas contábeis diferentes (' +
              Object.keys(contas).map(function (c) { return c + ': ' + U.brl(contas[c]); }).join(', ') +
              ') — o título é um só (pra bater com o pagamento), mas cada natureza continua na sua linha da DRE.'
            : '') + '</div>' +
        '<label>Vencimento da guia</label><input type="date" id="rt-fg-venc" value="' + vencSugerido + '">' +
        '<div class="ajuda">Confira o vencimento de verdade com a contabilidade — cada prefeitura/a Receita tem seu prazo.</div>',
      acoes: [{ txt: 'Fechar guia', cls: 'btn-aprovar', fn: function () {
        const venc = U.val('rt-fg-venc');
        if (!venc) return ERP.app.aviso('Informe o vencimento.', 'erro');
        const r = S.fecharGuiaRetencao(tributo, competencia, venc, municipio);
        if (ERP.app.erroDoRetorno(r)) return;
        ERP.app.fecharModal();
        ERP.app.aviso('Guia fechada — já está em Contas a Pagar, como previsão.', 'ok');
        render();
      } }]
    });
  }

  function abrirDetalheGuia(id) {
    const g = S.guiasRetencao().find(function (x) { return x.id === id; });
    if (!g) return;
    const parcela = S.todasParcelas().find(function (p) { return p.titulo_id === g.titulo_id; });
    ERP.app.modal({
      titulo: NOMES[g.tributo] + ' — ' + U.fComp(g.competencia) + (g.cancelada ? ' — cancelada' : ''),
      corpo:
        '<div class="resumo-linha"><span>Conta</span><span class="v">' + U.esc(g.conta) + '</span></div>' +
        '<div class="resumo-linha"><span>Vencimento</span><span class="v">' + (parcela ? U.fData(parcela.venc) : '—') + '</span></div>' +
        '<div class="resumo-linha"><span>Total</span><span class="v">' + U.brl(g.total) + '</span></div>' +
        '<h3 style="font-size:12px;margin:12px 0 6px">NFs que entraram nesta guia</h3>' +
        '<table class="parcelas"><thead><tr><th>NF</th><th>Fornecedor</th><th class="num">Valor</th></tr></thead><tbody>' +
          (g.retencao_ids || []).map(function (rid) {
            const r = S.st.retencoesRegistradas.find(function (x) { return x.id === rid; });
            if (!r) return '';
            return '<tr><td>' + U.esc(r.nf_documento || '—') + '</td><td>' + U.esc((D.credor(r.credor) || {}).nome || '') +
              '</td><td class="num">' + U.brl(r.valor) + '</td></tr>';
          }).join('') +
        '</tbody></table>' +
        (g.cancelada ? '<div class="ajuda" style="margin-top:8px">Motivo do cancelamento: ' + U.esc(g.motivo_cancelamento || '') + '</div>' : '')
    });
  }

  function abrirCancelarGuia(id) {
    ERP.app.modal({
      titulo: 'Cancelar guia de retenção',
      fecharTxt: 'Voltar',
      corpo: '<label>Motivo</label><textarea id="rt-cg-motivo" rows="2"></textarea>' +
        '<div class="ajuda">As retenções desta guia voltam pra fila de pendentes — dá pra incluir numa guia nova depois.</div>',
      acoes: [{ txt: 'Cancelar guia', cls: 'btn-recusar', fn: function () {
        const motivo = U.val('rt-cg-motivo');
        if (!motivo) return ERP.app.aviso('Informe o motivo.', 'erro');
        let r = S.cancelarGuiaRetencao(id, motivo, false);
        if (r.erro && r.jaPagas) {
          if (!confirm(r.erro + '\n\nForçar o cancelamento mesmo assim?')) return;
          r = S.cancelarGuiaRetencao(id, motivo, true);
        }
        if (ERP.app.erroDoRetorno(r)) return;
        ERP.app.fecharModal();
        ERP.app.aviso('Guia cancelada.', 'ok');
        render();
      } }]
    });
  }

  return { montar: montar, render: render };
})();
