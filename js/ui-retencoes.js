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
        ? '<table class="parcelas"><thead><tr><th>Tributo</th><th>Competência</th><th>Vence</th><th>Município</th>' +
            '<th class="num">NF(s)</th><th class="num">Total retido</th><th></th></tr></thead><tbody>' +
            pendentes.map(function (r) {
              return '<tr><td>' + U.esc(NOMES[r.tributo] || r.tributo) +
                  (r.problemas ? ' <span class="badge b-reprovado" title="Nota repetida ou com título cancelado — veja em Ver NFs">' +
                    r.problemas + ' a conferir</span>' : '') + '</td>' +
                '<td>' + U.fComp(r.competencia) + '</td>' +
                '<td class="mono">' + (r.vencimento ? U.fData(r.vencimento) + (r.vencida ? ' <span class="badge b-reprovado">vencida</span>' : '') : '—') + '</td>' +
                '<td>' + U.esc(r.tributo === 'ISS' ? (r.municipio || 'sede (não informado)') : '—') + '</td>' +
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

  /* Uma linha por NOTA (v201): situação do pagamento, os tributos da
     nota em colunas, e os botões para abrir a nota e o título. */
  const SIT = { pago: ['pago', 'b-pago'], parcial: ['pago em parte', 'b-aguardando'], aberto: ['em aberto', 'b-aguardando'],
    titulo_cancelado: ['título cancelado', 'b-reprovado'] };
  function tabelaNotas(det, tributo) {
    const cols = tributo === 'CSRF' ? ['PIS', 'COFINS', 'CSLL'] : [tributo];
    const NUM = 'style="width:100px"';
    return '<div class="tabela-rolagem"><table class="parcelas" id="rt-notas"><thead><tr><th>NF</th><th>Fornecedor</th>' +
        '<th>Emissão</th><th>Vencimento</th><th>Pagamento</th><th class="num" ' + NUM + '>Bruto da NF</th>' +
        cols.map(function (c) { return '<th class="num" ' + NUM + '>' + c + '</th>'; }).join('') +
        (cols.length > 1 ? '<th class="num" ' + NUM + '>Total</th>' : '') + '<th></th></tr></thead><tbody>' +
      det.linhas.map(function (l) {
        const sit = SIT[l.situacao] || [l.situacao, ''];
        const avisos = (l.repetidos.length ? '<div class="erro">registro repetido neste título ' +
            l.repetidos.map(function (id) { return '<button class="btn-sm" data-rt-repetida="' + id + '">Tirar o repetido</button>'; }).join(' ') + '</div>' : '') +
          (l.nf_em_dois_titulos ? '<div class="erro">mesma NF lançada em outro título — cancele o título repetido no Contas a pagar</div>' : '');
        return '<tr data-rt-titulo="' + U.esc(l.titulo_id || '') + '"><td class="mono">' + U.esc(l.nf || '—') + '</td>' +
          '<td class="desc">' + U.esc(l.credor) + avisos + '</td>' +
          '<td class="mono">' + (l.emissao ? U.fData(l.emissao) : '—') + '</td>' +
          '<td class="mono">' + (l.vencimentos.length ? l.vencimentos.map(U.fData).join('<br>') : '—') + '</td>' +
          '<td><span class="badge ' + sit[1] + '">' + sit[0] + '</span>' +
            (l.pago_em ? '<div class="sub">' + U.fData(l.pago_em) + (l.banco ? ' · ' + U.esc(l.banco) : '') + '</div>' : '') + '</td>' +
          '<td class="num">' + U.num(l.bruto) + '</td>' +
          cols.map(function (c) { return '<td class="num">' + (l.por_tributo[c] ? U.num(l.por_tributo[c]) : '—') + '</td>'; }).join('') +
          (cols.length > 1 ? '<td class="num"><b>' + U.num(l.total) + '</b></td>' : '') +
          '<td class="acoes">' + (l.parcela_id ? (l.tem_anexo ? '<button class="btn-sm" data-rt-nota="' + l.parcela_id + '">Nota</button>' : '') +
            '<button class="btn-sm" data-rt-tit="' + l.parcela_id + '">Título</button>' : '') + '</td></tr>';
      }).join('') +
      '<tr><td colspan="' + (6 + cols.length) + '"><b>Total</b></td>' +
        (cols.length > 1 ? '<td class="num"><b>' + U.num(det.total) + '</b></td>' : '') + '<td></td></tr>' +
      '</tbody></table></div>';
  }
  function ligarNotas(reabrir) {
    document.querySelectorAll('[data-rt-nota]').forEach(function (b) {
      b.addEventListener('click', function () { ERP.contas.verNota(S.parcela(this.dataset.rtNota)); });
    });
    document.querySelectorAll('[data-rt-tit]').forEach(function (b) {
      b.addEventListener('click', function () { ERP.contas.verDetalhe(this.dataset.rtTit); });
    });
    document.querySelectorAll('[data-rt-repetida]').forEach(function (b) {
      b.addEventListener('click', function () {
        const r = S.tirarRetencaoRepetida(this.dataset.rtRepetida, 'registro repetido no mesmo título');
        if (ERP.app.erroDoRetorno(r)) return;
        render(); reabrir(); ERP.app.aviso('Registro repetido tirado da fila.', 'ok');
      });
    });
  }

  function abrirDetalhePendente(tributo, competencia, municipio) {
    const det = S.detalheRetencoes({ tributo: tributo, competencia: competencia, municipio: tributo === 'ISS' ? (municipio || '') : undefined });
    ERP.app.modal({
      titulo: NOMES[tributo] + ' pendente — ' + U.fComp(competencia), largo: true,
      corpo: (det.problemas ? '<div class="aviso-linha erro">' + det.problemas + ' nota(s) a conferir antes de fechar a guia.</div>' : '') +
        tabelaNotas(det, tributo) +
        '<div class="ajuda">Competência da retenção = a da nota (critério da contabilidade). "Em aberto" quer dizer que o ' +
          'fornecedor ainda não foi pago — por isso a nota não aparece no Contas pagas.</div>',
      aoAbrir: function () { ligarNotas(function () { abrirDetalhePendente(tributo, competencia, municipio); }); }
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
        (g.cancelada
          ? '<table class="parcelas"><thead><tr><th>NF</th><th>Fornecedor</th><th class="num">Valor</th></tr></thead><tbody>' +
            (g.retencao_ids || []).map(function (rid) {
              const r = S.st.retencoesRegistradas.find(function (x) { return x.id === rid; });
              if (!r) return '';
              return '<tr><td>' + U.esc(r.nf_documento || '—') + '</td><td>' + U.esc((D.credor(r.credor) || {}).nome || '') +
                '</td><td class="num">' + U.brl(r.valor) + '</td></tr>';
            }).join('') + '</tbody></table>'
          : tabelaNotas(S.detalheRetencoes({ guia_id: g.id }), g.tributo)) +
        (g.cancelada ? '<div class="ajuda" style="margin-top:8px">Motivo do cancelamento: ' + U.esc(g.motivo_cancelamento || '') + '</div>' : ''),
      largo: !g.cancelada,
      aoAbrir: function () { ligarNotas(function () { abrirDetalheGuia(id); }); }
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
