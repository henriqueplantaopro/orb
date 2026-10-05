/* ERP · ui-faturamento.js — notas emitidas e contas a receber.

   Entra o pacote do portal da prefeitura (o ZIP do link que chega por
   e-mail, ou os TXT de dentro dele). O sistema lê as notas, confere os
   totais contra o próprio arquivo, deixa você amarrar cada tomador a um
   projeto e gera o contas a receber pelo LÍQUIDO — valor da nota menos
   as retenções que o tomador faz na fonte. */
window.ERP = window.ERP || {};

ERP.faturamento = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;
  let lote = null;
  let mapa = {};       // documento do tomador -> centro de custo
  let comps = {};      // número da nota -> competência corrigida na tela
  let sel = new Set();

  const ROT_ORIGEM = {
    explicita: { txt: 'na nota', cls: 'b-pago' },
    periodo:   { txt: 'do período', cls: 'b-aprovado' },
    presumida: { txt: 'presumida', cls: 'b-pendente' }
  };
  const compDe = n => comps[n.numero] || n.competencia;

  function montar() {
    U.el('fa-arquivo').addEventListener('change', abrir);
    document.querySelectorAll('#fa-nav button').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('#fa-nav button').forEach(function (x) {
          x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
        });
        U.el('fa-aba-notas').style.display = b.dataset.faaba === 'notas' ? '' : 'none';
        U.el('fa-aba-fatura').style.display = b.dataset.faaba === 'fatura' ? '' : 'none';
        U.el('fa-aba-cobertura').style.display = b.dataset.faaba === 'cobertura' ? '' : 'none';
        U.el('fa-aba-esteira').style.display = b.dataset.faaba === 'esteira' ? '' : 'none';
        U.el('fa-aba-rps').style.display = b.dataset.faaba === 'rps' ? '' : 'none';
        U.el('fa-aba-previsoes').style.display = b.dataset.faaba === 'previsoes' ? '' : 'none';
        U.el('fa-aba-status').style.display = b.dataset.faaba === 'status' ? '' : 'none';
        U.el('fa-aba-resultado').style.display = b.dataset.faaba === 'resultado' ? '' : 'none';
        if (b.dataset.faaba === 'status') renderStatus();
        if (b.dataset.faaba === 'resultado') renderResultado();
        if (b.dataset.faaba === 'fatura') renderFatura();
        if (b.dataset.faaba === 'cobertura') renderCobertura();
        if (b.dataset.faaba === 'esteira') renderEsteira();
        if (b.dataset.faaba === 'rps') renderRPS();
        /* Previsão de faturamento é assunto do faturamento: é dela que
           a esteira parte. Saiu do módulo financeiro. */
        if (b.dataset.faaba === 'previsoes') ERP.previsoes.render();
      });
    });
    atualizarAlertaFat();
    renderStatus();   // é a primeira aba
  }

  /* ── Status ─────────────────────────────────────────────
     Onde cada projeto está no ciclo do faturamento, do previsto ao
     recebido. É a tela de abertura do módulo: quem opera começa o dia
     olhando o que pede ação. */
  let stComp = '', stCentro = '', stStatus = '';
  function renderStatus() {
    const box = U.el('fa-aba-status');
    if (!box) return;
    const lista = S.statusFaturamento({ competencia: stComp, centro: stCentro, status: stStatus });
    const conta = s => S.statusFaturamento({ competencia: stComp, centro: stCentro })
      .filter(function (l) { return l.status === s; }).length;
    box.innerHTML =
      '<h2>Status do faturamento<span class="sub">do previsto ao recebido, projeto a projeto</span>' +
        (S.pode('faturar')
          ? '<button class="btn-sm" id="st-complemento" style="float:right">+ Complemento de NF</button>' : '') +
      '</h2>' +
      '<div class="filtros">' +
        '<div class="f"><label for="st-comp">Competência</label>' +
          '<input type="month" id="st-comp" value="' + stComp + '" title="vazio = todas"></div>' +
        '<div class="f"><label for="st-centro">Projeto</label><select id="st-centro">' +
          '<option value="">todos</option>' +
          D.centros.filter(function (c) { return c.tipo === 'projeto' && c.ativo; })
            .sort(function (x, y) { return String(x.curto).localeCompare(String(y.curto), 'pt-BR'); })
            .map(function (c) {
              return '<option value="' + c.id + '"' + (c.id === stCentro ? ' selected' : '') + '>' +
                U.esc(c.curto) + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="f"><label for="st-status">Status</label><select id="st-status">' +
          '<option value="">todos</option>' +
          ['sem_previsao', 'previsao', 'confirmado', 'autorizado', 'liberado', 'faturado', 'recebido_parcial', 'recebido']
            .map(function (s) {
              return '<option value="' + s + '"' + (s === stStatus ? ' selected' : '') + '>' +
                U.esc(S.NOME_STATUS_FAT[s]) + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="pr-confere">' +
        /* "Sem previsão" entra no contador: é o número que diz
           quanto falta lançar antes de o mês poder fechar. */
        ['sem_previsao', 'previsao', 'confirmado', 'autorizado', 'liberado', 'faturado', 'recebido'].map(function (s) {
          return '<span>' + U.esc(S.NOME_STATUS_FAT[s]) + ' <b>' + conta(s) + '</b></span>';
        }).join('') +
      '</div>' +
      (lista.length
        ? '<div class="tabela-rolagem"><table><thead><tr><th>Projeto</th><th>Competência</th>' +
          '<th>Status do faturamento</th><th class="num">Valor</th><th>Notas</th>' +
          '<th class="num">Recebido</th><th class="num">Parado há</th></tr></thead><tbody>' +
          lista.map(function (l) {
            const badge = { sem_previsao: 'b-cancelado',
              liberado: 'b-aprovado', autorizado: 'b-aguardando', confirmado: 'b-aguardando',
              previsao: 'b-pendente', faturado: 'b-pago', recebido: 'b-pago',
              recebido_parcial: 'b-parcial' }[l.status] || 'b-pendente';
            return '<tr><td class="desc">' + U.esc(l.projeto.curto || l.projeto.nome) +
                (l.eh_grupo ? '<div class="sub">nota única · ' + l.especialidades.length +
                  ' especialidades</div>' : '') + '</td>' +
              '<td class="mono">' + U.fComp(l.competencia) + '</td>' +
              '<td><span class="badge ' + badge + '">' + U.esc(S.NOME_STATUS_FAT[l.status] || l.status) + '</span></td>' +
              /* Sem previsão lançada, mostra a estimativa do cadastro
                 em cinza: é o valor que a pessoa provavelmente vai
                 lançar, e tê-lo à vista poupa a consulta. */
              '<td class="num">' + (l.status === 'sem_previsao'
                ? '<span class="sub">' + (l.estimado ? U.brl(l.estimado) + ' estimado' : '—') + '</span>'
                : U.brl(l.faturado_bruto || l.valor)) + '</td>' +
              '<td class="sub">' + U.esc((l.notas || []).join(', ') || '—') + '</td>' +
              '<td class="num">' + (l.recebido ? U.brl(l.recebido) : '—') + '</td>' +
              '<td class="num sub">' + (['faturado', 'recebido'].indexOf(l.status) > -1 ? '—' : l.dias + ' dias') +
              '</td></tr>';
          }).join('') + '</tbody></table></div>'
        : '<div class="vazio">Nada nesta combinação de filtros.</div>');
    if (U.el('st-complemento')) U.el('st-complemento').addEventListener('click', novoComplemento);
    U.el('st-comp').addEventListener('change', function () { stComp = this.value; renderStatus(); });
    U.el('st-centro').addEventListener('change', function () { stCentro = this.value; renderStatus(); });
    U.el('st-status').addEventListener('change', function () { stStatus = this.value; renderStatus(); });
  }

  /* Complemento de nota já faturada: faturei 2 milhões do HGB e chegou
     um relatório de mais 50 mil. */
  function novoComplemento() {
    const proj = D.centros.filter(function (c) { return c.tipo === 'projeto' && c.ativo; })
      .sort(function (x, y) { return String(x.curto).localeCompare(String(y.curto), 'pt-BR'); });
    ERP.app.modal({
      titulo: 'Complemento de faturamento',
      fecharTxt: 'Cancelar',
      corpo:
        '<div class="ajuda">Para o que ficou de fora de uma nota já emitida. A nota original não é tocada: ' +
          'isto vira uma cobrança nova, no mesmo projeto e competência, marcada como complemento.</div>' +
        '<div class="row2">' +
          '<div><label>Projeto *</label><select id="cp-centro">' +
            proj.map(function (c) {
              return '<option value="' + c.id + '">' + U.esc(c.curto) + '</option>'; }).join('') +
          '</select></div>' +
          '<div><label>Competência *</label><input type="month" id="cp-comp" value="' + U.mesAtual() + '"></div>' +
        '</div>' +
        '<div class="row3">' +
          '<div><label>Valor (R$) *</label><input class="num" id="cp-valor" inputmode="decimal" value="0,00"></div>' +
          '<div><label>Número da NF (se já tiver)</label><input id="cp-num"></div>' +
          '<div><label>Vencimento</label><input type="date" id="cp-venc" value="' + U.addDias(U.hoje(), 30) + '"></div>' +
        '</div>' +
        '<label>O que gerou o complemento *</label>' +
        '<textarea id="cp-motivo" rows="4" placeholder="ex.: relatório de plantões de agosto recebido após ' +
          'o fechamento — 14 plantões de clínica geral"></textarea>' +
        '<div class="ajuda">Este texto vai na discriminação da nota.</div>',
      acoes: [{ txt: 'Lançar complemento', cls: 'btn-aprovar', fn: function () {
        const r = S.lancarComplementoFaturamento({
          centro: U.val('cp-centro'), competencia: U.val('cp-comp'),
          valor: U.parseValor(U.val('cp-valor')), numero: U.val('cp-num'),
          vencimento: U.val('cp-venc'), motivo: U.val('cp-motivo')
        });
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        renderStatus(); ERP.receber.render(); ERP.app.atualizarContadores();
        ERP.app.aviso('Complemento de ' + U.brl(r.receber.valor_bruto) + ' lançado no contas a receber.', 'ok');
      } }]
    });
  }

  /* ── Resultado ──────────────────────────────────────────
     O que sobra de cada projeto no mês: faturamento menos custo e
     impostos previstos. */
  let resComp = '', resCentro = '';
  function renderResultado() {
    const box = U.el('fa-aba-resultado');
    if (!box) return;
    const lista = S.resultadoFaturamento({ competencia: resComp, centro: resCentro });
    const som = campo => Math.round(lista.reduce(function (t, l) { return t + (l[campo] || 0); }, 0) * 100) / 100;
    const totFat = som('faturamento'), totLucro = som('lucro');
    box.innerHTML =
      '<h2>Resultado por projeto<span class="sub">faturamento menos custo e impostos previstos</span></h2>' +
      '<div class="filtros">' +
        '<div class="f"><label for="res-comp">Competência</label>' +
          '<input type="month" id="res-comp" value="' + resComp + '" title="vazio = todas"></div>' +
        '<div class="f"><label for="res-centro">Projeto</label><select id="res-centro">' +
          '<option value="">todos</option>' +
          D.centros.filter(function (c) { return c.tipo === 'projeto' && c.ativo; })
            .sort(function (x, y) { return String(x.curto).localeCompare(String(y.curto), 'pt-BR'); })
            .map(function (c) {
              return '<option value="' + c.id + '"' + (c.id === resCentro ? ' selected' : '') + '>' +
                U.esc(c.curto) + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="pr-confere">' +
        '<span>Faturamento <b>' + U.brl(totFat) + '</b></span>' +
        '<span>Custo <b>' + U.brl(som('custo')) + '</b></span>' +
        '<span>Impostos <b>' + U.brl(som('impostos')) + '</b></span>' +
        '<span>Lucro direto <b class="' + (totLucro < 0 ? 'erro' : '') + '">' + U.brl(totLucro) + '</b></span>' +
        '<span>Margem <b>' + (totFat > 0 ? U.pct(Math.round(totLucro / totFat * 1000) / 10) : '—') + '</b></span>' +
      '</div>' +
      (lista.length
        ? '<div class="tabela-rolagem"><table><thead><tr><th>Projeto</th><th>Faturamento</th>' +
          '<th>Produtividade</th><th class="num">Valor faturado</th><th class="num">Custo</th>' +
          '<th class="num">Impostos</th><th class="num">Lucro direto</th><th class="num">Margem</th>' +
          '</tr></thead><tbody>' +
          lista.map(function (l) {
            return '<tr><td class="desc">' + U.esc(l.projeto.curto || l.projeto.nome) +
                '<div class="sub">' + U.fComp(l.competencia) + '</div></td>' +
              '<td class="sub">' + U.esc(S.NOME_STATUS_FAT[l.status] || l.status) + '</td>' +
              '<td class="sub">' + U.esc(S.NOME_STATUS_PROD[(l.prod || {}).status] || '—') + '</td>' +
              '<td class="num">' + U.brl(l.faturamento) + '</td>' +
              '<td class="num">' + U.brl(l.custo) +
                '<div class="sub">' + U.esc(l.tipo_custo) + '</div></td>' +
              '<td class="num sub">' + U.brl(l.impostos) + ' <span class="sub">' + l.impostos_pct + '%</span></td>' +
              '<td class="num ' + (l.lucro < 0 ? 'erro' : '') + '">' + U.brl(l.lucro) + '</td>' +
              '<td class="num">' + (l.margem === null ? '—' : U.pct(l.margem)) + '</td></tr>';
          }).join('') + '</tbody></table></div>'
        : '<div class="vazio">Nada nesta combinação de filtros.</div>');
    U.el('res-comp').addEventListener('change', function () { resComp = this.value; renderResultado(); });
    U.el('res-centro').addEventListener('change', function () { resCentro = this.value; renderResultado(); });
  }

  /* ── RPS em lote ────────────────────────────────────────
     O portal de Barueri converte arquivo de RPS em NF-e. É o caminho
     oficial: não guarda senha nossa, não quebra quando a prefeitura
     mexe no site e deixa rastro do que foi enviado. O sistema monta o
     arquivo com o que está LIBERADO na esteira; o envio e o retorno
     (número da NF-e) continuam passando por uma pessoa. */
  let rpsComp = '';   // vazio = todas as competências liberadas
  function renderRPS() {
    const itens = S.itensParaRPS(rpsComp);
    const lotes = S.st.lotesRPS.filter(function (l) { return !rpsComp || l.competencia === rpsComp; });
    const pend = itens.map(function (i) {
      return { item: i, falta: ERP.rpsBarueri.pendencias(i, D.empresa) };
    });
    const prontos = pend.filter(function (p) { return !p.falta.length; });
    const total = Math.round(prontos.reduce(function (a, p) { return a + p.item.valor; }, 0) * 100) / 100;

    U.el('fa-aba-rps').innerHTML =
      '<h2>RPS em lote<span class="sub">gera o arquivo que o portal da prefeitura converte em NF-e</span></h2>' +
      '<div class="filtros"><div class="f"><label for="rps-comp">Competência</label>' +
        '<input type="month" id="rps-comp" value="' + rpsComp + '"></div>' +
        (rpsComp ? '<button class="btn-sm" id="rps-todas" style="align-self:flex-end">Todas as liberadas</button>' : '') +
        '<button class="btn-linha" id="rps-gerar" style="align-self:flex-end"' +
          (prontos.length ? '' : ' disabled') + '>Gerar arquivo (' + prontos.length + ' RPS)</button></div>' +
      '<div class="pr-confere">' +
        '<span>Liberados para faturar <b>' + itens.length + '</b></span>' +
        '<span>Prontos <b>' + prontos.length + '</b></span>' +
        '<span>Com pendência <b class="' + (pend.length - prontos.length ? 'erro' : '') + '">' +
          (pend.length - prontos.length) + '</b></span>' +
        '<span>Valor do lote <b>' + U.brl(total) + '</b></span>' +
      '</div>' +
      (itens.length
        ? '<table><thead><tr><th>Cobrança</th><th>Tomador</th><th class="num">Valor</th>' +
          '<th class="num">Retenções</th><th>Situação</th></tr></thead><tbody>' +
          pend.map(function (p) {
            const i = p.item;
            const ret = Math.round((i.retencoes || []).reduce(function (a, r) { return a + r.valor; }, 0) * 100) / 100;
            return '<tr' + (p.falta.length ? ' style="background:#fff4f2"' : '') + '>' +
              '<td class="desc">' + U.esc(i.grupo ? 'Nota única · ' + i.grupo : (D.centro(i.centro) || {}).curto || '') +
                '<div class="sub">' + U.esc(String(i.discriminacao).slice(0, 70)) + '</div></td>' +
              '<td class="desc">' + U.esc(i.tomador_nome || '—') + '</td>' +
              '<td class="num">' + U.brl(i.valor) + '</td>' +
              '<td class="num sub">' + (ret ? U.brl(ret) : '—') + '</td>' +
              '<td>' + (p.falta.length
                ? '<span class="badge b-vencido">falta cadastro</span><div class="sub erro">' +
                  U.esc(p.falta.join(' · ')) + '</div>'
                : '<span class="badge b-pago">pronto</span>') + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="vazio"><strong>Nada liberado para faturar nesta competência.</strong>' +
          'A esteira precisa chegar em "liberado para emissão de NF".</div>') +
      (lotes.length
        ? '<h3 style="font-size:12px;margin:14px 0 4px">Lotes gerados</h3>' +
          '<table class="parcelas"><thead><tr><th>Remessa</th><th>RPS</th><th class="num">Valor</th>' +
          '<th>Situação</th><th></th></tr></thead><tbody>' + lotes.map(function (l) {
            return '<tr><td class="mono">' + U.esc(l.remessa) +
                '<div class="sub">' + U.fData(l.gerado_em) + ' por ' + U.esc(l.gerado_por) + '</div></td>' +
              '<td class="sub">' + l.rps.map(function (r) {
                return r.numero + (r.nf ? ' → NF ' + r.nf : ''); }).join(', ') + '</td>' +
              '<td class="num">' + U.brl(l.total) + '</td>' +
              '<td>' + (l.status === 'convertido'
                ? '<span class="badge b-pago">convertido</span>'
                : l.status === 'com_erro'
                  ? '<span class="badge b-vencido">arquivo com erros</span>'
                  : l.protocolo
                    ? '<span class="badge b-aguardando">enviado</span>'
                    : '<span class="badge b-aguardando">gerado, não enviado</span>') +
                (l.protocolo ? '<div class="sub">protocolo ' + U.esc(l.protocolo) +
                  (l.ambiente === 'homologacao' ? ' (homologação)' : '') + '</div>' : '') + '</td>' +
              '<td class="acoes">' +
                (l.status !== 'convertido'
                  ? '<button class="btn-sm" data-rps-prot="' + l.id + '">Protocolo</button> ' +
                    '<button class="btn-sm btn-aprovar" data-rps-ret="' + l.id + '">Informar NF-e</button>' : '') +
              '</td></tr>';
          }).join('') + '</tbody></table>'
        : '') +
      '<div class="ajuda">Fluxo: gerar o arquivo → enviar (no portal, em "Envio de Arquivo de RPS", ou ' +
        'pelo utilitário <b>envio-rps</b>, que fala direto com o web service usando o certificado A1) → ' +
        'guardar o protocolo → informar os números devolvidos. O contas a receber nasce nesse momento, ' +
        'com o número real da nota.</div>';
    ligarRPS();
  }

  function ligarRPS() {
    U.el('rps-comp').addEventListener('change', function () { rpsComp = this.value; renderRPS(); });
    if (U.el('rps-todas')) {
      U.el('rps-todas').addEventListener('click', function () { rpsComp = ''; renderRPS(); });
    }
    if (U.el('rps-gerar')) {
      U.el('rps-gerar').addEventListener('click', function () {
        const itens = S.itensParaRPS(rpsComp).filter(function (i) {
          return !ERP.rpsBarueri.pendencias(i, D.empresa).length;
        });
        const remessa = U.hoje().replace(/-/g, '') + String(S.st.lotesRPS.length + 1).padStart(3, '0');
        const r = ERP.rpsBarueri.gerar(itens, D.empresa, { remessa: remessa, numero_inicial: proximoRPS() });
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        const nome = 'rps-' + rpsComp + '-' + remessa + '.txt';
        ERP.rpsBarueri.baixar(nome, r.conteudo);
        S.registrarLoteRPS({ competencia: rpsComp, remessa: remessa, arquivo_nome: nome,
          rps: r.rps, total_servicos: r.total_servicos });
        renderRPS();
        ERP.app.aviso('Arquivo gerado com ' + r.rps.length + ' RPS. Envie no portal e depois informe os ' +
          'números da NF-e aqui.', 'ok');
      });
    }
    U.el('fa-aba-rps').querySelectorAll('[data-rps-ret]').forEach(function (b) {
      b.addEventListener('click', function () { informarNFe(this.dataset.rpsRet); });
    });
    U.el('fa-aba-rps').querySelectorAll('[data-rps-prot]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = this.dataset.rpsProt;
        const lote = S.st.lotesRPS.find(function (l) { return l.id === id; });
        ERP.app.modal({
          titulo: 'Envio ao portal · remessa ' + lote.remessa,
          fecharTxt: 'Cancelar',
          corpo: '<div class="ajuda">Depois de enviar o arquivo (pelo portal ou pelo utilitário ' +
              '<b>envio-rps</b>), guarde aqui o protocolo e a situação que a prefeitura devolveu. ' +
              'É o que amarra o arquivo às notas que saíram dele.</div>' +
            '<div class="row3">' +
              '<div><label>Protocolo *</label><input id="rp-prot" value="' + U.esc(lote.protocolo || '') + '"></div>' +
              '<div><label>Situação</label><select id="rp-sit">' +
                [['', '—'], ['-2', 'aguardando'], ['-1', 'processando'], ['0', 'validado'],
                 ['1', 'importado (NF-e geradas)'], ['2', 'com erros']].map(function (o) {
                  return '<option value="' + o[0] + '"' + (lote.situacao_portal === o[0] ? ' selected' : '') +
                    '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
              '<div><label>Ambiente</label><select id="rp-amb">' +
                '<option value="producao">Produção</option>' +
                '<option value="homologacao"' + (lote.ambiente === 'homologacao' ? ' selected' : '') +
                '>Homologação</option></select></div>' +
            '</div>',
          acoes: [{ txt: 'Salvar', cls: 'btn-aprovar', fn: function () {
            const r = S.registrarProtocoloRPS(id, { protocolo: U.val('rp-prot'),
              situacao: U.val('rp-sit'), ambiente: U.val('rp-amb') });
            if (r.erro) return ERP.app.aviso(r.erro, 'erro');
            ERP.app.fecharModal(); renderRPS(); ERP.app.aviso('Envio registrado.', 'ok');
          } }]
        });
      });
    });
  }

  /* A numeração do RPS é controlada pela prefeitura e não pode repetir:
     continua de onde o último lote parou. */
  function proximoRPS() {
    let maior = 0;
    S.st.lotesRPS.forEach(function (l) {
      l.rps.forEach(function (r) { if (r.numero > maior) maior = r.numero; });
    });
    return maior + 1;
  }

  function informarNFe(loteId) {
    const lote = S.st.lotesRPS.find(function (l) { return l.id === loteId; });
    ERP.app.modal({
      titulo: 'Retorno do portal · remessa ' + lote.remessa,
      fecharTxt: 'Fechar',
      corpo: '<div class="ajuda">Informe o número da NF-e que a prefeitura gerou para cada RPS. ' +
          'O título no contas a receber é criado agora, com o número real da nota.</div>' +
        '<table class="parcelas"><thead><tr><th>RPS</th><th>Cobrança</th><th class="num">Valor</th>' +
        '<th>Número da NF-e</th></tr></thead><tbody>' +
        lote.rps.map(function (r) {
          return '<tr><td class="mono">' + r.numero + '</td>' +
            '<td class="desc">' + U.esc(r.tomador || '') + '</td>' +
            '<td class="num">' + U.brl(r.valor) + '</td>' +
            '<td>' + (r.nf ? '<span class="mono">' + U.esc(r.nf) + '</span>'
              : '<input data-nf="' + r.numero + '" placeholder="ex.: 128455">') + '</td></tr>';
        }).join('') + '</tbody></table>',
      acoes: [{ txt: 'Registrar', cls: 'btn-aprovar', fn: function () {
        const numeros = {};
        document.querySelectorAll('[data-nf]').forEach(function (i) {
          if (i.value.trim()) numeros[+i.dataset.nf] = i.value.trim();
        });
        const r = S.converterLoteRPS(loteId, numeros);
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        renderRPS();
        atualizarAlertaFat();
        ERP.app.aviso(r.convertidos + ' NF-e registrada(s).' +
          (r.erros.length ? ' ' + r.erros.length + ' com erro: ' + r.erros[0] : ''), r.erros.length ? 'erro' : 'ok');
      } }]
    });
  }

  /* ── esteira do faturamento ─────────────────────────────
     Onde cada competência de cada projeto está, do previsto ao
     faturado, com o carimbo de quem fez cada etapa. Ordem: mais atrás
     na esteira e parado há mais tempo primeiro; faturado no fim. */
  let fEst = { pendentes: true, competencia: '', etapa: '' };
  const ETAPAS_NOME = { previsao: 'Previsão', confirmado: 'Valor confirmado',
    autorizado: 'Autorizado pelo órgão', liberado: 'Liberado p/ faturar', faturado: 'Faturado' };
  /* Versão curta para o cabeçalho da esteira, que tem oito colunas e
     precisa caber na tela sem rolagem lateral. */
  const ETAPAS_CURTO = { previsao: 'Previsto', confirmado: 'Confirm.',
    autorizado: 'Autoriz.', liberado: 'Liberado', faturado: 'Faturado' };
  const ORDEM_ETAPAS = ['previsao', 'confirmado', 'autorizado', 'liberado', 'faturado'];

  function renderEsteira() {
    const lista = S.esteiraFaturamento({ pendentes: fEst.pendentes, competencia: fEst.competencia, etapa: fEst.etapa });
    const todas = S.esteiraFaturamento({});
    const conta = {};
    ORDEM_ETAPAS.forEach(function (e) { conta[e] = todas.filter(function (l) { return l.etapa === e; }).length; });

    const comps = todas.map(function (l) { return l.competencia; })
      .filter(function (c, i, a) { return a.indexOf(c) === i; }).sort().reverse();

    const passo = function (l, etapa) {
      const feito = ORDEM_ETAPAS.indexOf(l.etapa) >= ORDEM_ETAPAS.indexOf(etapa);
      const quando = { confirmado: l.confirmado_em, autorizado: l.autorizado_em,
        liberado: l.liberado_em, faturado: l.faturado_em }[etapa];
      const quem = { confirmado: l.confirmado_por, autorizado: l.autorizado_por, liberado: l.liberado_por }[etapa];
      return '<td class="et' + (feito ? ' et-ok' : '') + '">' +
        (feito ? '✓' : '·') +
        (feito && quando ? '<div class="sub">' + U.fData(quando) + '</div>' : '') +
        (feito && quem ? '<div class="sub">' + U.esc(String(quem).split(' ')[0]) + '</div>' : '') + '</td>';
    };

    U.el('fa-aba-esteira').innerHTML =
      '<h2>Esteira do faturamento<span class="sub">confirmar o valor não é autorizar, e autorizar não é liberar</span></h2>' +
      '<div class="filtros">' +
        '<div class="f"><label for="es-comp">Competência</label><select id="es-comp">' +
          '<option value="">Todas</option>' + comps.map(function (c) {
            return '<option value="' + c + '"' + (fEst.competencia === c ? ' selected' : '') + '>' + U.fComp(c) + '</option>';
          }).join('') + '</select></div>' +
        '<div class="f"><label for="es-etapa">Etapa</label><select id="es-etapa">' +
          '<option value="">Todas</option>' + ORDEM_ETAPAS.map(function (e) {
            return '<option value="' + e + '"' + (fEst.etapa === e ? ' selected' : '') + '>' +
              ETAPAS_NOME[e] + ' (' + conta[e] + ')</option>';
          }).join('') + '</select></div>' +
        '<label style="align-self:flex-end;font-weight:400"><input type="checkbox" id="es-pend" style="width:auto"' +
          (fEst.pendentes ? ' checked' : '') + '> esconder os já faturados</label>' +
      '</div>' +
      '<div class="pr-confere">' + ORDEM_ETAPAS.map(function (e) {
        return '<span>' + ETAPAS_NOME[e] + ' <b' + (conta[e] && e !== 'faturado' ? ' class="erro"' : '') + '>' +
          conta[e] + '</b></span>';
      }).join('') + '</div>' +
      '<div class="tabela-rolagem" style="margin:0 -14px"><table><thead><tr>' +
        /* Cabeçalhos curtos e colunas de etapa estreitas: eram quatro
           títulos longos ("Autorizado pelo órgão", "Liberado p/
           faturar") empurrando a tabela para fora da tela, e cada um
           guarda só uma data ou um visto. O nome completo fica no
           `title`, para quem passar o mouse. */
        '<th>Projeto</th><th class="col-comp">Comp.</th>' +
        '<th class="col-prod">Prod.</th><th class="num col-val">Valor prod.</th>' +
        '<th class="num col-val">Valor</th>' +
        ORDEM_ETAPAS.slice(1).map(function (e) {
          return '<th class="num col-etapa" title="' + ETAPAS_NOME[e] + '">' +
            ETAPAS_CURTO[e] + '</th>';
        }).join('') +
        '<th class="num col-parado">Parado</th><th class="col-acoes"></th></tr></thead><tbody>' +
        (lista.length ? lista.map(function (l) {
          const atrasado = l.etapa !== 'faturado' && l.dias > 15;
          return '<tr' + (atrasado ? ' style="background:#fff4f2"' : '') + '>' +
            '<td class="desc">' +
              (l.eh_grupo
                ? '<button class="btn-ghost" data-est-exp="' + U.esc(l.grupo + '|' + l.competencia) + '" ' +
                    'title="ver especialidades">' + (expandidos[l.grupo + '|' + l.competencia] ? '▾' : '▸') + '</button> ' +
                  U.esc(l.projeto.curto) + '<div class="sub">faturamento global · ' +
                  (l.total_especialidades || l.especialidades.length) + ' especialidades' +
                  (l.especialidades.length < (l.total_especialidades || 0)
                    ? ' · ' + l.especialidades.length + ' com lançamento no mês' : '') + '</div>'
                : U.esc(l.projeto.curto || l.projeto.nome) +
                  '<div class="sub">' + U.esc(l.projeto.unidade || '') + '</div>') + '</td>' +
            '<td class="mono">' + U.fComp(l.competencia) + '</td>' +
            /* Em que pé está a produtividade, e o valor que corresponde
               a esse estágio — sem misturar estimativa com o que já é
               firme. */
            '<td>' + '<span class="badge ' +
              ({ previsto: 'b-pendente', lancado: 'b-aguardando', confirmado: 'b-aprovado' }[(l.prod || {}).status] || 'b-pendente') +
              '">' + U.esc(S.NOME_STATUS_PROD[(l.prod || {}).status] || '—') + '</span></td>' +
            '<td class="num">' + U.brl((l.prod || {}).valor || 0) + '</td>' +
            /* Estimativa editável na própria esteira: quem opera o
               faturamento corrige o número sem sair da tela. Depois de
               confirmado, o valor deixa de ser estimativa e só muda
               pelo caminho da confirmação. */
            '<td class="num">' +
              (podeEditarEstimativa() && !l.confirmado_em && l.etapa !== 'faturado'
                ? '<input class="num est-inline" data-est-val="' + U.esc(l.centro + '|' + l.competencia) +
                    '" inputmode="decimal" value="' + U.num(l.valor || 0) + '" ' +
                    'title="estimativa — Enter para salvar">'
                : U.brl(l.valor)) +
              (l.eh_grupo ? '<div class="sub">global do grupo</div>' : '') +
              (l.documentos.length ? '<div class="sub">' + U.esc(l.documentos.join(', ')) + '</div>' : '') + '</td>' +
            passo(l, 'confirmado') + passo(l, 'autorizado') + passo(l, 'liberado') + passo(l, 'faturado') +
            '<td class="num' + (atrasado ? ' erro' : ' sub') + '">' +
              (l.etapa === 'faturado' ? '—' : l.dias + ' dias') + '</td>' +
            '<td class="acoes">' + acoesEsteira(l) + '</td></tr>' +
            /* As especialidades do grupo aparecem como filhas: a
               produtividade de cada uma continua visível, mas nenhuma
               delas fatura sozinha. */
            (l.eh_grupo && expandidos[l.grupo + '|' + l.competencia]
              ? l.especialidades.map(function (e) {
                  return '<tr class="sub-linha"><td class="desc" style="padding-left:28px">' +
                    '<span class="sub">' + U.esc(e.projeto.curto) + '</span></td>' +
                    '<td class="mono sub">' + U.fComp(e.competencia) + '</td>' +
                    '<td class="num sub">' + U.brl(e.valor) + '</td>' +
                    '<td colspan="4" class="sub">' + U.esc(ETAPAS_NOME[e.etapa] || e.etapa) + '</td>' +
                    '<td class="num sub">' + (e.etapa === 'faturado' ? '—' : e.dias + ' dias') + '</td>' +
                    '<td class="sub">faturado no grupo</td></tr>';
                }).join('')
              : '');
        }).join('')
          : '<tr><td colspan="9" class="vazio"><strong>Nada na esteira com esse filtro.</strong></td></tr>') +
      '</tbody></table></div>' +
      '<div class="ajuda">Linha em vermelho está parada há mais de 15 dias na mesma etapa. ' +
        'Quem confirma o fechamento registra a autorização do órgão; a liberação é de quem responde pelo ' +
        'faturamento — e só depois dela a NF ou a fatura pode sair.</div>';
    ligarEsteira();
    atualizarAlertaFat();   // mantém o contador da aba em dia
  }

  const expandidos = {};
  /* Precisa ser avaliado A CADA render: calculado uma vez só, o campo
     continuava editável depois de trocar para um perfil de consulta. */
  const podeEditarEstimativa = function () {
    return S.pode('autorizar_faturamento') || S.pode('admin') || S.pode('cancelar');
  };

  /* Digitar o valor confirmado e autorizar de uma vez. Sem produtividade
     lançada o sistema avisa e pede confirmação, mas deixa seguir: há
     contrato que fatura por disponibilidade. */
  function confirmarEAutorizar(ref) {
    const par = ref.split('|');
    const l = S.esteiraFaturamento({ centro: par[0], competencia: par[1], sem_agrupar: true })[0] || {};
    const linhaGrupo = S.esteiraFaturamento({ competencia: par[1] })
      .find(function (x) { return x.eh_grupo && x.especialidades.some(function (e) { return e.centro === par[0]; }); });
    const grupo = linhaGrupo ? linhaGrupo.projeto.curto : null;
    const lotes = S.fechamentosVivosDe(par[0], par[1]);
    const prod = lotes.reduce(function (t, x) { return t + (x.valor || 0); }, 0);
    ERP.app.modal({
      titulo: 'Confirmar valor e autorizar · ' + U.esc(grupo || (l.projeto || {}).curto || ''),
      fecharTxt: 'Cancelar',
      corpo:
        '<div class="resumo-linha"><span>Competência</span><span class="v">' + U.fComp(par[1]) + '</span></div>' +
        (grupo ? '<div class="resumo-linha"><span>Faturamento</span><span class="v">único do grupo ' +
          U.esc(grupo) + '</span></div>' : '') +
        '<div class="resumo-linha"><span>Produtividade lançada</span><span class="v' +
          (lotes.length ? '' : ' erro') + '">' +
          (lotes.length ? U.brl(prod) + ' em ' + lotes.length + ' fechamento(s)' : 'nenhuma') + '</span></div>' +
        (lotes.length ? ''
          : '<div class="aviso-linha erro">Não há produtividade lançada para este projeto nesta ' +
            'competência. Se o valor vem de medição do órgão ou de contrato por disponibilidade, marque ' +
            'abaixo; se o fechamento ainda não foi lançado, lance antes.</div>' +
            '<label style="font-weight:400"><input type="checkbox" id="es-sem-prod" style="width:auto"> ' +
            'confirmo o valor sem produtividade lançada</label>') +
        '<div class="row2">' +
          '<div><label>Valor confirmado a faturar (R$) *</label>' +
            '<input class="num" id="es-valor" inputmode="decimal" value="' +
            U.num(l.valor || (l.previsao || {}).faturamento || 0) + '"></div>' +
          '<div><label>Protocolo / referência do órgão</label>' +
            '<input id="es-conf-prot" placeholder="ex.: Ofício 55/2026 — medição agosto"></div>' +
        '</div>' +
        '<label>Descrição / observação da nota</label>' +
        '<textarea id="es-conf-obs" rows="5" placeholder="texto que vai na discriminação da NF: competência, ' +
          'ofício, medição, plantões, o que o tomador exige ver na nota"></textarea>' +
        '<div class="ajuda">Ao autorizar, o faturamento já fica liberado para o RPS em lote — não precisa ' +
          'de uma segunda pessoa.</div>',
      acoes: [
        { txt: 'Só confirmar o valor', cls: 'btn-sm', fn: function () { aplicar(false); } },
        { txt: 'Confirmar e autorizar', cls: 'btn-aprovar', fn: function () { aplicar(true); } }
      ]
    });
    function aplicar(autorizar) {
      const r = S.confirmarEAutorizarFaturamento({
        centro: par[0], competencia: par[1],
        faturamento: U.parseValor(U.val('es-valor')),
        autorizar: autorizar,
        confirmar_sem_produtividade: U.el('es-sem-prod') ? U.el('es-sem-prod').checked : true,
        protocolo: U.val('es-conf-prot'), observacao: U.val('es-conf-obs')
      });
      if (r.erro) return ERP.app.aviso(r.erro, 'erro');
      ERP.app.fecharModal();
      renderEsteira();
      ERP.receber.render();
      ERP.app.aviso(autorizar
        ? 'Valor confirmado e faturamento autorizado — já liberado para o RPS em lote.'
        : 'Valor confirmado.', 'ok');
    }
  }

  function acoesEsteira(l) {
    const ref = l.centro + '|' + l.competencia;
    /* Quem cuida de produtividade e faturamento digita o valor e
       autoriza no mesmo gesto — e a liberação vai junto. */
    if (l.etapa === 'previsao' && S.pode('autorizar_faturamento')) {
      return '<button class="btn-sm btn-aprovar" data-est-conf="' + ref + '">Confirmar valor e autorizar</button>';
    }
    if (l.etapa === 'confirmado' && S.pode('autorizar_faturamento')) {
      return '<button class="btn-sm btn-aprovar" data-est-aut="' + ref + '">Autorizar faturamento</button>' +
        ' <button class="btn-sm" data-est-conf="' + ref + '">Corrigir valor</button>';
    }
    if (l.etapa === 'autorizado') {
      return (S.pode('liberar_faturamento')
        ? '<button class="btn-sm btn-aprovar" data-est-lib="' + l.centro + '|' + l.competencia + '">Liberar</button>' : '') +
        (S.pode('autorizar_faturamento')
          ? ' <button class="btn-sm" data-est-des="autorizado|' + l.centro + '|' + l.competencia + '">Desfazer</button>' : '');
    }
    if (l.etapa === 'liberado') {
      return '<span class="sub">pronto para faturar</span>' +
        (S.pode('liberar_faturamento')
          ? ' <button class="btn-sm" data-est-des="liberado|' + l.centro + '|' + l.competencia + '">Desfazer</button>' : '');
    }
    if (l.etapa === 'previsao') return '<span class="sub">aguarda o fechamento da produtividade</span>';
    return '';
  }

  function ligarEsteira() {
    const box = U.el('fa-aba-esteira');
    box.querySelectorAll('[data-est-exp]').forEach(function (b) {
      b.addEventListener('click', function () {
        const k = this.dataset.estExp;
        expandidos[k] = !expandidos[k];
        renderEsteira();
      });
    });
    box.querySelectorAll('[data-est-val]').forEach(function (inp) {
      const salvar = function () {
        const par = inp.dataset.estVal.split('|');
        const valor = U.parseValor(inp.value);
        const antes = U.parseValor(inp.defaultValue);
        if (Math.abs(valor - antes) < 0.004) return;
        const r = S.editarEstimativaEsteira({ centro: par[0], competencia: par[1], faturamento: valor });
        if (r.erro) { inp.value = U.num(antes); return ERP.app.aviso(r.erro, 'erro'); }
        renderEsteira();
        ERP.app.aviso(r.grupo
          ? 'Estimativa global do ' + r.grupo + ' atualizada para ' + U.brl(valor) + '.'
          : 'Estimativa atualizada para ' + U.brl(valor) + '.', 'ok');
      };
      inp.addEventListener('blur', salvar);
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    });
    box.querySelectorAll('[data-est-conf]').forEach(function (b) {
      b.addEventListener('click', function () { confirmarEAutorizar(this.dataset.estConf); });
    });
    U.el('es-comp').addEventListener('change', function () { fEst.competencia = this.value; renderEsteira(); });
    U.el('es-etapa').addEventListener('change', function () { fEst.etapa = this.value; renderEsteira(); });
    U.el('es-pend').addEventListener('change', function () { fEst.pendentes = this.checked; renderEsteira(); });

    box.querySelectorAll('[data-est-aut]').forEach(function (b) {
      b.addEventListener('click', function () {
        const par = this.dataset.estAut.split('|');
        const l = S.esteiraFaturamento({ centro: par[0], competencia: par[1] })[0] || {};
        ERP.app.modal({
          titulo: 'Autorização do órgão · ' + U.esc((l.projeto || {}).curto || ''),
          fecharTxt: 'Cancelar',
          corpo: '<div class="resumo-linha"><span>Competência</span><span class="v">' + U.fComp(par[1]) + '</span></div>' +
            '<div class="resumo-linha"><span>Valor confirmado</span><span class="v">' + U.brl(l.valor || 0) + '</span></div>' +
            '<div class="ajuda">Registre como o órgão autorizou este valor — ofício, e-mail, ata de medição. ' +
            'Sem isso, faturar é risco de glosa.</div>' +
            '<div class="row2">' +
              '<div><label>Protocolo / referência</label><input id="es-prot" placeholder="ex.: Ofício 55/2026 — medição agosto"></div>' +
              '<div><label>Data da autorização</label><input type="date" id="es-data" value="' + U.hoje() + '"></div></div>' +
            /* Aqui entra o texto que vai na DISCRIMINAÇÃO da nota, e
               às vezes é longo: competência, ofício, medição, relação
               de plantões. Campo de uma linha não servia. */
            '<label>Descrição / observação da nota</label>' +
            '<textarea id="es-obs" rows="5" placeholder="texto que vai na discriminação da NF"></textarea>',
          acoes: [{ txt: 'Registrar autorização', cls: 'btn-aprovar', fn: function () {
            const r = S.autorizarFaturamento(par[0], par[1], { protocolo: U.val('es-prot'),
              data: U.val('es-data'), observacao: U.val('es-obs') });
            if (r.erro) return ERP.app.aviso(r.erro, 'erro');
            ERP.app.fecharModal(); renderEsteira(); atualizarAlertaFat();
            ERP.app.aviso('Autorização registrada — já liberado para o RPS em lote.', 'ok');
          } }]
        });
      });
    });

    box.querySelectorAll('[data-est-lib]').forEach(function (b) {
      b.addEventListener('click', function () {
        const par = this.dataset.estLib.split('|');
        const liberar = function (forcar) {
          const r = S.liberarFaturamento(par[0], par[1], { forcar: forcar, observacao: '' });
          if (r.erro && r.divergencia && !forcar) {
            return ERP.app.modal({
              titulo: 'O valor mudou depois da autorização',
              fecharTxt: 'Voltar',
              corpo: '<div class="ajuda erro">' + U.esc(r.erro) + '</div>',
              acoes: [{ txt: 'Liberar assim mesmo', cls: 'btn-cancelar', fn: function () {
                ERP.app.fecharModal(); liberar(true); } }]
            });
          }
          if (r.erro) return ERP.app.aviso(r.erro, 'erro');
          renderEsteira(); atualizarAlertaFat();
          ERP.app.aviso('Liberado para faturar.', 'ok');
        };
        liberar(false);
      });
    });

    box.querySelectorAll('[data-est-des]').forEach(function (b) {
      b.addEventListener('click', function () {
        const par = this.dataset.estDes.split('|');
        ERP.app.modal({
          titulo: 'Desfazer ' + (par[0] === 'liberado' ? 'a liberação' : 'a autorização'),
          fecharTxt: 'Voltar',
          corpo: '<label>Motivo *</label><input id="es-motivo" placeholder="ex.: órgão pediu revisão da medição">',
          acoes: [{ txt: 'Desfazer', cls: 'btn-cancelar', fn: function () {
            const r = S.desfazerEtapaFaturamento(par[1], par[2], par[0], U.val('es-motivo'));
            if (r.erro) return ERP.app.aviso(r.erro, 'erro');
            ERP.app.fecharModal(); renderEsteira(); ERP.app.aviso('Etapa desfeita.', 'ok');
          } }]
        });
      });
    });
  }

  /* Nota única do grupo: um documento, rateado entre os projetos na
     proporção do que cada um confirmou na produtividade. */
  function notaDoGrupo(grupo) {
    const base = S.baseDoGrupo(grupo, covComp);
    const previa = S.ratearNoGrupo(grupo, covComp, base.total_confirmado || base.total_previsto);
    ERP.app.modal({
      titulo: 'Nota única · ' + grupo + ' · ' + U.fComp(covComp),
      fecharTxt: 'Cancelar',
      corpo:
        '<div class="ajuda">' + base.confirmados + ' de ' + base.projetos + ' projeto(s) com produtividade ' +
          'confirmada. O valor da nota é rateado entre eles na proporção do confirmado — cada especialidade ' +
          'fica com a sua parte no resultado.</div>' +
        (base.completo ? '' : '<div class="ajuda erro">Ainda faltam projetos confirmar o fechamento. ' +
          'Dá pra emitir assim mesmo, mas a base fica incompleta.</div>') +
        '<table class="parcelas"><thead><tr><th>Projeto</th><th class="num">Base</th>' +
          '<th class="num">Parte da nota</th></tr></thead><tbody>' +
          base.itens.map(function (i) {
            const p = previa.find(function (x) { return x.centro === i.centro; });
            return '<tr><td class="desc">' + U.esc((i.projeto || {}).curto || '') +
                '<div class="sub">' + U.esc(i.etapa) + '</div></td>' +
              '<td class="num">' + U.brl(i.confirmado !== null ? i.confirmado : i.previsto) + '</td>' +
              '<td class="num">' + (p ? U.brl(p.valor) : '—') + '</td></tr>';
          }).join('') + '</tbody></table>' +
        '<div class="row3" style="margin-top:8px">' +
          '<div><label>Número da NF *</label><input id="ng-num"></div>' +
          '<div><label>Valor total (R$) *</label><input class="num" id="ng-valor" inputmode="decimal" value="' +
            U.num(base.total_confirmado || base.total_previsto) + '"></div>' +
          '<div><label>Emissão</label><input type="date" id="ng-emissao" value="' + U.hoje() + '"></div>' +
        '</div>' +
        '<label>Vencimento</label><input type="date" id="ng-venc">',
      acoes: [{ txt: 'Lançar nota única', cls: 'btn-aprovar', fn: function () {
        const r = S.faturarGrupo({ grupo: grupo, competencia: covComp, numero: U.val('ng-num'),
          valor: U.parseValor(U.val('ng-valor')), emissao: U.val('ng-emissao'), vencimento: U.val('ng-venc') });
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal(); renderCobertura(); atualizarAlertaFat();
        ERP.app.aviso('Nota única lançada e rateada entre ' + r.partes.length + ' projeto(s).', 'ok');
      } }]
    });
  }

  /* ── fatura de locação (sem NF) ─────────────────────────
     Contrato de locação em que o cliente não exige NF: o faturamento
     sai por fatura. Dá pra emitir aqui (com os itens do projeto) ou
     anexar a fatura que já foi feita por fora. */
  let fatSel = { centro: '', comp: U.mesAtual(), itens: [], arquivo: null };

  function renderFatura() {
    const box = U.el('fa-aba-fatura');
    const projetos = D.centros.filter(function (c) { return c.ativo && c.tipo === 'projeto'; })
      .sort(function (a, b) { return String(a.curto || a.nome).localeCompare(String(b.curto || b.nome)); });
    if (!fatSel.centro) {
      const loc = projetos.find(function (c) { return c.tipo_servico === 'locacao'; });
      fatSel.centro = loc ? loc.id : (projetos[0] || {}).id || '';
    }
    const c = D.centro(fatSel.centro) || {};
    if (!fatSel.itens.length || fatSel.centroCarregado !== fatSel.centro) {
      fatSel.itens = ((c.itens_locacao || [])).map(function (i) {
        return { descricao: i.descricao, qtd: i.qtd, qtd_contratada: i.qtd, valor_unit: i.valor_unit, observacao: '' };
      });
      fatSel.centroCarregado = fatSel.centro;
    }
    const total = Math.round(fatSel.itens.reduce(function (a, i) { return a + (i.qtd || 0) * (i.valor_unit || 0); }, 0) * 100) / 100;
    const jaTem = S.contasReceber().filter(function (r) {
      return r.centro === fatSel.centro && r.competencia === fatSel.comp &&
        ['nota', 'fatura'].indexOf(r.origem) > -1 && r.status !== 'cancelado';
    });

    box.innerHTML =
      '<h2>Fatura de locação<span class="sub">para contrato em que não se emite NF</span></h2>' +
      '<div class="filtros">' +
        '<div class="f"><label for="fa-fat-proj">Projeto</label><select id="fa-fat-proj">' +
          projetos.map(function (x) {
            return '<option value="' + x.id + '"' + (x.id === fatSel.centro ? ' selected' : '') + '>' +
              U.esc(x.curto || x.nome) + (x.tipo_servico === 'locacao' ? '' : ' (não é locação)') + '</option>';
          }).join('') + '</select></div>' +
        '<div class="f"><label for="fa-fat-comp">Competência</label><input type="month" id="fa-fat-comp" value="' + fatSel.comp + '"></div>' +
      '</div>' +
      (jaTem.length ? '<div class="ajuda erro">Este projeto já tem ' + jaTem.length +
        ' documento(s) de faturamento em ' + U.fComp(fatSel.comp) + ' (' +
        jaTem.map(function (r) { return U.esc(r.numero); }).join(', ') + ').</div>' : '') +
      (fatSel.itens.length
        ? '<table class="parcelas"><thead><tr><th>Item</th><th class="num">Contratado</th>' +
          '<th class="num">A faturar</th><th class="num">Valor unit.</th><th class="num">Total</th>' +
          '<th>Observação (se reduziu)</th></tr></thead><tbody>' +
          fatSel.itens.map(function (i, idx) {
            const menos = i.qtd < i.qtd_contratada;
            return '<tr><td class="desc">' + U.esc(i.descricao) + '</td>' +
              '<td class="num">' + U.num(i.qtd_contratada) + '</td>' +
              '<td><input class="num" data-fi-qtd="' + idx + '" inputmode="decimal" value="' + U.num(i.qtd) + '"></td>' +
              '<td class="num">' + U.brl(i.valor_unit) + '</td>' +
              '<td class="num">' + U.brl(Math.round((i.qtd || 0) * (i.valor_unit || 0) * 100) / 100) + '</td>' +
              '<td><input data-fi-obs="' + idx + '" placeholder="' + (menos ? 'por que reduziu?' : '—') + '" value="' +
                U.esc(i.observacao || '') + '"' + (menos ? ' style="border-color:var(--red)"' : '') + '></td></tr>';
          }).join('') +
          '<tr><td colspan="4"><b>Total da fatura</b></td><td class="num"><b>' + U.brl(total) + '</b></td><td></td></tr>' +
          '</tbody></table>'
        : '<div class="ajuda erro">Este projeto não tem itens de locação cadastrados. Cadastre em ' +
          'Cadastros › Projetos (a lista aparece quando o tipo de serviço é Locação).</div>') +
      '<label style="margin-top:10px">Observação da fatura</label><input id="fa-fat-obs" placeholder="opcional">' +
      '<div class="ap-acoes" style="margin-top:10px">' +
        '<button class="btn-linha" id="fa-fat-emitir"' + (total > 0 ? '' : ' disabled') + '>Emitir fatura e lançar no a receber</button>' +
        '<button class="btn-sm" id="fa-fat-anexar">Anexar fatura já existente</button>' +
      '</div>' +
      '<input type="file" id="fa-fat-arq" accept=".pdf,.jpg,.jpeg,.png" style="display:none">';

    U.el('fa-fat-proj').addEventListener('change', function () { fatSel.centro = this.value; renderFatura(); });
    U.el('fa-fat-comp').addEventListener('change', function () { fatSel.comp = this.value; renderFatura(); });
    box.querySelectorAll('[data-fi-qtd]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        fatSel.itens[+this.dataset.fiQtd].qtd = U.parseValor(this.value);
        renderFatura();
      });
    });
    box.querySelectorAll('[data-fi-obs]').forEach(function (inp) {
      inp.addEventListener('input', function () { fatSel.itens[+this.dataset.fiObs].observacao = this.value; });
    });
    U.el('fa-fat-emitir').addEventListener('click', function () { emitir(null); });
    U.el('fa-fat-anexar').addEventListener('click', function () { U.el('fa-fat-arq').click(); });
    U.el('fa-fat-arq').addEventListener('change', function (e) {
      const arq = e.target.files && e.target.files[0];
      if (!arq) return;
      const fr = new FileReader();
      fr.onload = function () { perguntarDadosDoAnexo({ nome: arq.name, dados: fr.result }); };
      fr.readAsDataURL(arq);
    });

    /* Fatura feita por fora: o arquivo não diz número, valor nem data —
       antes o anexo entrava com o valor do contrato cheio. */
    function perguntarDadosDoAnexo(arquivo) {
      ERP.app.modal({
        titulo: 'Anexar fatura já existente',
        fecharTxt: 'Cancelar',
        corpo: '<div class="ajuda">Arquivo: <b>' + U.esc(arquivo.nome) + '</b>. ' +
            'Informe os dados do documento — é o que vai pro contas a receber.</div>' +
          '<div class="row3">' +
            '<div><label>Número da fatura *</label><input id="fa-anx-num"></div>' +
            '<div><label>Valor (R$) *</label><input class="num" id="fa-anx-valor" inputmode="decimal"></div>' +
            '<div><label>Emissão *</label><input type="date" id="fa-anx-data" value="' + U.hoje() + '"></div>' +
          '</div>' +
          '<label>Vencimento</label><input type="date" id="fa-anx-venc">',
        acoes: [{ txt: 'Anexar e lançar', cls: 'btn-aprovar', fn: function () {
          emitir(arquivo, { numero: U.val('fa-anx-num'), valor_anexo: U.parseValor(U.val('fa-anx-valor')),
            emissao: U.val('fa-anx-data'), vencimento: U.val('fa-anx-venc') });
        } }]
      });
    }

    function emitir(arquivo, dadosAnexo) {
      const semObs = fatSel.itens.filter(function (i) { return i.qtd < i.qtd_contratada && !i.observacao.trim(); });
      if (semObs.length) {
        return ERP.app.aviso('Explique na observação por que "' + semObs[0].descricao + '" está com quantidade menor que a contratada.', 'erro');
      }
      const r = S.emitirFatura(Object.assign({
        centro: fatSel.centro, competencia: fatSel.comp, itens: fatSel.itens,
        observacao: U.val('fa-fat-obs'), arquivo: arquivo
      }, dadosAnexo || {}));
      if (r.erro) return ERP.app.aviso(r.erro, 'erro');
      if (arquivo) ERP.app.fecharModal();
      if (!arquivo) pdfFatura(r.receber);
      ERP.contas.render();
      ERP.app.atualizarContadores();
      fatSel.centroCarregado = null;
      renderFatura();
      ERP.app.aviso((arquivo ? 'Fatura anexada' : 'Fatura ' + r.receber.numero + ' emitida') +
        ' e lançada no contas a receber (' + U.brl(r.receber.valor_bruto) + ').', 'ok');
    }
  }

  /* PDF da fatura, pra mandar pro cliente. */
  function pdfFatura(r) {
    const c = D.centro(r.centro) || {};
    const emp = D.empresa || {};
    const d = ERP.pdf.doc({ orientacao: 'retrato' });
    const x0 = d.margem, x1 = d.largura - d.margem;
    let y = d.margem + 12;
    d.texto(x0, y, emp.nome || 'Fatura', { tam: 15, negrito: true });
    d.texto(x1, y, 'FATURA ' + r.numero, { tam: 12, negrito: true, alinhar: 'direita' });
    y += 14;
    if (emp.cnpj) d.texto(x0, y, 'CNPJ ' + emp.cnpj, { tam: 8, cinza: 0.4 });
    d.texto(x1, y, 'Emissão ' + U.fData(r.emissao) + '  ·  Vencimento ' + U.fData(r.vencimento), { tam: 8, cinza: 0.4, alinhar: 'direita' });
    y += 18;
    d.linha(x0, y, x1, y, { cinza: 0.4 }); y += 16;
    d.texto(x0, y, 'Cliente: ' + (r.cliente_nome || ''), { tam: 10 }); y += 13;
    d.texto(x0, y, 'Projeto: ' + (c.curto || c.nome || '') + '   ·   Competência ' + U.fComp(r.competencia), { tam: 10 });
    y += 20;
    d.texto(x0, y, 'Item', { tam: 9, negrito: true });
    d.texto(x0 + 300, y, 'Qtd', { tam: 9, negrito: true, alinhar: 'direita' });
    d.texto(x0 + 400, y, 'Valor unit.', { tam: 9, negrito: true, alinhar: 'direita' });
    d.texto(x1, y, 'Total', { tam: 9, negrito: true, alinhar: 'direita' });
    y += 4; d.linha(x0, y, x1, y, { cinza: 0.5 }); y += 13;
    const cabecalhoItens = function () {
      d.texto(x0, y, 'Item', { tam: 9, negrito: true });
      d.texto(x0 + 300, y, 'Qtd', { tam: 9, negrito: true, alinhar: 'direita' });
      d.texto(x0 + 400, y, 'Valor unit.', { tam: 9, negrito: true, alinhar: 'direita' });
      d.texto(x1, y, 'Total', { tam: 9, negrito: true, alinhar: 'direita' });
      y += 4; d.linha(x0, y, x1, y, { cinza: 0.5 }); y += 13;
    };
    (r.itens_fatura || []).forEach(function (i) {
      /* Fatura com muitos itens (locação de 75 camas, por exemplo)
         precisa virar a página — antes o PDF saía com uma página só,
         cortando itens e o total. */
      if (y > d.altura - d.margem - 70) { d.novaPagina(); y = d.margem + 12; cabecalhoItens(); }
      d.texto(x0, y, i.descricao, { tam: 9, largura: 290 });
      d.texto(x0 + 300, y, U.num(i.qtd), { tam: 9, alinhar: 'direita' });
      d.texto(x0 + 400, y, U.brl(i.valor_unit), { tam: 9, alinhar: 'direita' });
      d.texto(x1, y, U.brl(i.valor), { tam: 9, alinhar: 'direita' });
      y += 12;
      if (i.qtd < i.qtd_contratada) {
        d.texto(x0 + 10, y, 'contratado ' + U.num(i.qtd_contratada) + ' · ' + (i.observacao || ''), { tam: 8, cinza: 0.45, largura: 400 });
        y += 11;
      }
    });
    y += 4; d.linha(x0, y, x1, y, { cinza: 0.5 }); y += 15;
    d.texto(x1, y, 'Total da fatura: ' + U.brl(r.valor_bruto), { tam: 12, negrito: true, alinhar: 'direita' });
    if (r.observacao) { y += 20; d.texto(x0, y, r.observacao, { tam: 8, cinza: 0.4, largura: x1 - x0 }); }
    d.salvar('fatura-' + r.numero + '.pdf');
  }

  /* ── cobertura de faturamento ───────────────────────────
     Mesma lógica da cobertura da produtividade: numa competência,
     quem já faturou e quem ainda não. */
  let covComp = null;
  function renderCobertura() {
    const box = U.el('fa-aba-cobertura');
    if (!covComp) {
      const d = new Date();
      covComp = new Date(Date.UTC(d.getFullYear(), d.getMonth() - 1, 1)).toISOString().slice(0, 7);
    }
    const linhas = S.coberturaFaturamento(covComp);
    const rot = {
      faturado: { t: 'faturado', c: 'sit-pago' },
      /* O rótulo acompanha a etapa: confirmar o valor não é autorizar,
         e autorizar não é liberar. */
      aguardando_nf: { t: 'aguardando autorização do órgão', c: 'sit-parcial' },
      aguardando_liberacao: { t: 'autorizado — aguardando liberação', c: 'sit-parcial' },
      liberado: { t: 'liberado para emissão de NF', c: 'sit-parcial' },
      sem_faturamento: { t: 'sem faturamento', c: 'sit-lancado' },
      encerrado: { t: 'encerrado sem faturar', c: 'sit-cancelado' },
      /* Projeto de um grupo sem produtividade no mês não deve nota: a
         especialidade simplesmente não teve plantão. Cobrar NF dele era
         pedir documento que o hospital não emite. */
      sem_base_no_grupo: { t: 'sem produtividade no mês', c: 'sit-neutro' },
      faturado_no_grupo: { t: 'coberto pela nota do grupo', c: 'sit-pago' }
    };
    /* Quem está num grupo conta UMA vez (a nota é uma só), e projeto
       sem base no mês não conta. */
    const vistos = {};
    const faltam = linhas.filter(function (x) {
      if (['aguardando_nf', 'aguardando_liberacao', 'liberado', 'sem_faturamento'].indexOf(x.situacao) < 0) return false;
      if (!x.grupo) return true;
      if (vistos[x.grupo]) return false;
      vistos[x.grupo] = true;
      return true;
    });
    box.innerHTML =
      '<h2>Cobertura de faturamento<span class="sub">quem já faturou a competência e quem ainda não</span></h2>' +
      '<div class="filtros"><div class="f"><label for="fa-cov-comp">Competência</label>' +
        '<input type="month" id="fa-cov-comp" value="' + covComp + '"></div></div>' +
      /* O gestor quer o MONTANTE: quanto se espera faturar no mês e
         quanto ainda falta sair em nota. O valor esperado é o mais
         firme que existe — faturado, senão confirmado, senão previsto. */
      '<div class="pr-confere">' +
        '<span>Previsto <b>' + U.brl(Math.round(linhas.reduce(function (a, x) { return a + x.previsto; }, 0) * 100) / 100) + '</b></span>' +
        '<span>Confirmado <b>' + U.brl(Math.round(linhas.reduce(function (a, x) { return a + (x.confirmado || 0); }, 0) * 100) / 100) + '</b></span>' +
        '<span>Faturado <b>' + U.brl(Math.round(linhas.reduce(function (a, x) { return a + x.faturado; }, 0) * 100) / 100) + '</b></span>' +
        '<span>Falta faturar <b class="' + (linhas.some(function (x) { return x.falta_faturar > 0; }) ? 'erro' : '') + '">' +
          U.brl(Math.round(linhas.reduce(function (a, x) { return a + x.falta_faturar; }, 0) * 100) / 100) + '</b></span>' +
      '</div>' +
      '<div class="' + (faltam.length ? 'ajuda erro' : 'dif ok') + '">' +
        (faltam.length ? faltam.length + ' faturamento(s) pendente(s) em ' + U.fComp(covComp) +
          ' — grupo de faturamento conta como um só. Se o projeto não fatura nesta competência, ' +
          'marque "Não fatura neste mês".'
          : 'Todos os projetos ativos com faturamento lançado em ' + U.fComp(covComp) + '.') + '</div>' +
      '<div class="tabela-rolagem" style="margin:0 -14px"><table><thead><tr><th>Projeto</th><th>Situação</th>' +
        '<th class="num">Previsto</th><th class="num">Confirmado</th><th class="num">Faturado</th>' +
        '<th class="num">Falta faturar</th><th>Documento</th><th></th></tr></thead><tbody>' +
      linhas.sort(function (a, b) {
        const ord = { aguardando_nf: 0, aguardando_liberacao: 1, liberado: 2, sem_faturamento: 3,
          faturado: 4, faturado_no_grupo: 5, sem_base_no_grupo: 6, encerrado: 7 };
        return ord[a.situacao] - ord[b.situacao] ||
          String(a.projeto.curto).localeCompare(String(b.projeto.curto));
      }).map(function (x) {
        const r = rot[x.situacao];
        return '<tr><td class="desc">' + U.esc(x.projeto.curto || x.projeto.nome) +
            '<div class="sub">' + U.esc(x.projeto.unidade || '') + '</div></td>' +
          '<td><span class="badge ' + r.c + '">' + r.t + '</span>' +
            (x.confirmado_por ? '<div class="sub">por ' + U.esc(x.confirmado_por) + '</div>' : '') +
            (x.grupo ? '<div class="sub">nota única: ' + U.esc(x.grupo) + '</div>' : '') + '</td>' +
          '<td class="num sub">' + (x.previsto ? U.brl(x.previsto) : '—') + '</td>' +
          '<td class="num">' + (x.confirmado !== null ? U.brl(x.confirmado) : '—') + '</td>' +
          '<td class="num">' + (x.faturado ? U.brl(x.faturado) : '—') + '</td>' +
          '<td class="num' + (x.falta_faturar > 0 ? ' erro' : ' sub') + '">' +
            (x.falta_faturar > 0 ? U.brl(x.falta_faturar) : '—') + '</td>' +
          '<td class="mono">' + (x.docs.length
            ? U.esc(x.docs.map(function (r2) { return r2.numero; }).join(', ')) +
              (x.docs.some(function (r2) { return r2.do_grupo; })
                ? '<div class="sub">nota única · ' + U.esc(x.grupo || '') + '</div>' : '')
            : '—') + '</td>' +
          /* "Não fatura nesta competência": encerra só ESTE projeto no
             mês, em vez de inativar o projeto (que o apagaria também
             dos meses passados). É o que tira do alerta os projetos sem
             faturamento esperado. */
          /* Projeto de grupo sem base no mês não precisa de ação
             nenhuma: a nota do grupo resolve, e não há o que encerrar. */
          '<td class="acoes">' + (['faturado', 'sem_base_no_grupo', 'faturado_no_grupo'].indexOf(x.situacao) > -1 ? ''
            : x.encerrado
              ? '<button class="btn-sm" data-reabrir="' + x.centro + '">Reabrir mês</button>'
              : '<button class="btn-sm" data-encerrar="' + x.centro + '">Não fatura neste mês</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      /* Grupos de faturamento (uma nota para vários projetos) ganham um
         resumo próprio: é por ele que o gestor decide emitir a nota. */
      (function () {
        const grupos = linhas.map(function (x) { return x.grupo; })
          .filter(function (g, i, a) { return g && a.indexOf(g) === i; });
        if (!grupos.length) return '';
        return '<h3 style="font-size:12px;margin:14px 0 4px">Faturamento único (nota que cobre vários projetos)</h3>' +
          '<table class="parcelas"><thead><tr><th>Grupo</th><th class="num">Projetos confirmados</th>' +
          '<th class="num">Base confirmada</th><th class="num">Faturado</th><th class="num">Falta</th>' +
          '<th></th></tr></thead><tbody>' + grupos.map(function (g) {
            const base = S.baseDoGrupo(g, covComp);
            const doGrupo = linhas.filter(function (x) { return x.grupo === g; });
            const fat = Math.round(doGrupo.reduce(function (a, x) { return a + x.faturado; }, 0) * 100) / 100;
            const falta = Math.round(doGrupo.reduce(function (a, x) { return a + x.falta_faturar; }, 0) * 100) / 100;
            return '<tr><td class="desc">' + U.esc(g) +
                '<div class="sub">' + base.projetos + ' projeto(s) · produtividade lançada por projeto</div></td>' +
              '<td class="num' + (base.completo ? '' : ' erro') + '">' + base.confirmados + ' de ' + base.projetos + '</td>' +
              '<td class="num">' + U.brl(base.total_confirmado) + '</td>' +
              '<td class="num">' + U.brl(fat) + '</td>' +
              '<td class="num' + (falta > 0 ? ' erro' : '') + '">' + U.brl(falta) + '</td>' +
              '<td class="acoes">' + (falta > 0 && S.pode('faturar')
                ? '<button class="btn-sm btn-aprovar" data-fat-grupo="' + U.esc(g) + '">Lançar nota única</button>' : '') +
              '</td></tr>';
          }).join('') + '</tbody></table>';
      })();
    box.querySelectorAll('[data-fat-grupo]').forEach(function (b) {
      b.addEventListener('click', function () { notaDoGrupo(this.dataset.fatGrupo); });
    });
    U.el('fa-cov-comp').addEventListener('change', function () { covComp = this.value; renderCobertura(); });
    box.querySelectorAll('[data-encerrar]').forEach(function (b) {
      b.addEventListener('click', function () {
        const r = S.marcarPrevisoes(covComp, 'encerrada', this.dataset.encerrar);
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        renderCobertura(); atualizarAlertaFat(); ERP.app.atualizarContadores();
        ERP.app.aviso('Projeto marcado como "não fatura em ' + U.fComp(covComp) + '".', 'ok');
      });
    });
    box.querySelectorAll('[data-reabrir]').forEach(function (b) {
      b.addEventListener('click', function () {
        const r = S.marcarPrevisoes(covComp, 'estimada', this.dataset.reabrir);
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        renderCobertura(); atualizarAlertaFat(); ERP.app.atualizarContadores();
        ERP.app.aviso('Competência reaberta para este projeto.', 'ok');
      });
    });
  }

  function atualizarAlertaFat() {
    const nEst = S.esteiraFaturamento({ pendentes: true }).length;
    const cont = U.el('fa-esteira-n');
    if (cont) { cont.textContent = nEst; cont.style.display = nEst ? '' : 'none'; }
    const el = U.el('fa-alerta');
    if (!el) return;
    const p = S.faturamentoPendente();
    const n = (p.faltando || []).length;
    el.style.display = n ? '' : 'none';
    el.textContent = n;
  }

  /* ── entrada: ZIP ou TXT ────────────────────────────────*/
  function abrir(e) {
    const arqs = Array.prototype.slice.call(e.target.files || []);
    if (!arqs.length) return;
    U.el('fa-saida').innerHTML = '<div class="ajuda">Lendo ' + arqs.length + ' arquivo(s)…</div>';

    Promise.all(arqs.map(function (a) {
      if (/\.zip$/i.test(a.name)) {
        if (!window.JSZip) return Promise.resolve([{ nome: a.name, erro: 'descompactador não carregado' }]);
        return JSZip.loadAsync(a).then(function (z) {
          const dentro = [];
          z.forEach(function (caminho, f) { if (!f.dir && /\.txt$/i.test(caminho)) dentro.push(f); });
          return Promise.all(dentro.map(function (f) {
            return f.async('string').then(function (t) { return { nome: f.name, conteudo: t }; });
          }));
        });
      }
      return a.text().then(function (t) { return [{ nome: a.name, conteudo: t }]; });
    })).then(function (grupos) {
      const arquivos = [].concat.apply([], grupos).filter(function (x) { return x.conteudo; });
      if (!arquivos.length) {
        U.el('fa-saida').innerHTML = '<div class="vazio"><strong>Nenhum TXT encontrado.</strong>' +
          'O pacote do portal traz um arquivo por dia de emissão.</div>';
        return;
      }
      /* XML da NFS-e e TXT do portal caem na MESMA tela: o leitor de
         XML devolve o lote no formato que o resto daqui já espera. */
      const xmls = arquivos.filter(function (x) { return /^\s*<\?xml|<Nfse|<InfNfse/i.test(x.conteudo); });
      if (xmls.length) {
        const lidos = xmls.map(function (x) {
          const r = ERP.nfse.ler(x.conteudo);
          return r.erro ? { erro: x.nome + ': ' + r.erro, notas: [] } : r;
        });
        const falhas = lidos.filter(function (x) { return x.erro; }).map(function (x) { return x.erro; });
        const todas = [].concat.apply([], lidos.map(function (x) { return x.notas || []; }));
        if (!todas.length) {
          U.el('fa-saida').innerHTML = '<div class="vazio"><strong>Nenhuma NFS-e no arquivo.</strong>' +
            (falhas.length ? '<div class="sub">' + U.esc(falhas.join(' · ')) + '</div>' : '') + '</div>';
          return;
        }
        lote = ERP.nfse.comoLote({ notas: todas }, xmls.map(function (x) { return x.nome; }).join(', '));
        lote.problemas = falhas;
        lote.arquivos = xmls.length;
        comps = {};
        sel = new Set(lote.notas.filter(function (n) { return !n.cancelada; })
          .map(function (n) { return n.numero; }));
        render();
        return;
      }
      lote = ERP.nfseEmitidas.consolidar(arquivos);
      lote.arquivos = arquivos.length;
      comps = {};
      sel = new Set(lote.notas.filter(function (n) { return !n.cancelada; }).map(function (n) { return n.numero; }));
      render();
    }).catch(function (err) {
      ERP.app.aviso('Não consegui abrir o pacote: ' + err.message, 'erro');
    });
  }

  /* ── sugestão de projeto ────────────────────────────────
     Primeiro o que o usuário escolheu nesta tela, depois o projeto
     padrão do cadastro do cliente, e só então o palpite pelos apelidos
     do projeto no nome do tomador ou na discriminação. */
  const clientePorDoc = doc => D.clientePorDoc(doc);

  const semAcento = s => String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  function casa(centro, alvo, campo) {
    return (centro[campo || 'aliases'] || []).some(function (k) {
      const kk = semAcento(k).trim();
      return kk.length > 2 && alvo.indexOf(kk) > -1;
    });
  }

  /* Duas etapas, porque o hospital tem várias linhas de contrato:
     1. o CLIENTE diz de qual unidade é a nota (por CNPJ);
     2. dentro daquela unidade, a ESPECIALIDADE na discriminação diz qual
        linha — anestesia, neo, pediatria, tomografia, e assim por diante.
     Sem cliente cadastrado, cai no palpite global pelos apelidos. */
  function sugerirCentro(nota) {
    if (mapa[nota.tomador.documento]) return mapa[nota.tomador.documento];
    const alvo = semAcento(nota.discriminacao + ' ' + nota.tomador.nome);
    const cli = clientePorDoc(nota.tomador.documento);

    if (cli && cli.centro_padrao) {
      const base = D.centro(cli.centro_padrao);
      const unidade = base ? base.unidade : null;
      if (unidade) {
        const irmas = D.centros.filter(function (c) { return c.ativo && c.unidade === unidade; });
        // só apelidos de LINHA aqui: os de cliente casariam com todas as irmãs
        const preciso = irmas.find(function (c) { return casa(c, alvo, 'aliases_linha'); });
        if (preciso) return preciso.id;
      }
      return cli.centro_padrao;
    }

    const achado = D.centros.filter(function (c) { return c.ativo && c.tipo === 'projeto'; })
      .find(function (c) { return casa(c, alvo); });
    return achado ? achado.id : '';
  }

  /* ── retenção: manda o cadastro do cliente ──────────────
     O que vem destacado na NF é só um palpite — na maioria dos
     contratos a retenção real é outra. Com alíquotas cadastradas, o
     sistema calcula sobre o bruto e ignora o que a nota diz. */
  function retencaoDe(nota) {
    const cli = clientePorDoc(nota.tomador.documento);
    /* Prioridade: percentual do PROJETO (é por contrato), depois as
       alíquotas do cliente, e só então o que vem destacado na NF. */
    const centro = D.centro(mapa[nota.tomador.documento] || sugerirCentro(nota));
    if (centro && centro.retencao_pct) {
      const v = Math.round(nota.valor * centro.retencao_pct) / 100;
      return {
        origem: 'projeto', cliente: cli,
        retencoes: [{ tributo: 'Retenção ' + U.num(centro.retencao_pct) + '%', aliquota: centro.retencao_pct, valor: v }],
        total: v
      };
    }
    if (cli && (cli.retencoes || []).length) {
      const itens = cli.retencoes.map(function (r) {
        return { tributo: r.tributo, aliquota: r.aliquota,
                 valor: Math.round(nota.valor * r.aliquota) / 100 };
      });
      return {
        origem: 'cadastro', cliente: cli, retencoes: itens,
        total: Math.round(itens.reduce(function (s, r) { return s + r.valor; }, 0) * 100) / 100
      };
    }
    return {
      origem: cli ? 'nota_sem_cadastro' : 'nota_sem_cliente',
      cliente: cli, retencoes: nota.retencoes, total: nota.valorRetido
    };
  }
  /* Quando a nota traz o líquido assinado pela prefeitura
     (`valorLiquido`, vindo do XML), é ele que vale: recalcular como
     valor − retenções ignora desconto incondicionado e deduções. */
  const liquidoDe = n => n.valorLiquido > 0
    ? n.valorLiquido
    : Math.round((n.valor - retencaoDe(n).total) * 100) / 100;

  const jaLancada = n => S.contasReceber().some(function (r) { return r.numero === n.numero; });

  // 42 linhas de projeto: a lista só é navegável agrupada por unidade
  function opcoesProjeto(sel2) {
    const porUni = {};
    D.centros.filter(function (c) { return c.ativo; }).forEach(function (c) {
      const u = c.unidade || 'Estruturais';
      (porUni[u] = porUni[u] || []).push(c);
    });
    return Object.keys(porUni).sort().map(function (u) {
      return '<optgroup label="' + U.esc(u) + '">' + porUni[u].map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === sel2 ? ' selected' : '') + '>' +
          U.esc(c.curto || c.nome) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
  }

  /* ── tela ───────────────────────────────────────────────*/
  function render() {
    const L = lote;
    if (!L) return;
    const validas = L.notas.filter(function (n) { return !n.cancelada; });
    const marcadas = validas.filter(function (n) { return sel.has(n.numero) && !jaLancada(n); });
    const somaSel = Math.round(marcadas.reduce(function (s, n) { return s + liquidoDe(n); }, 0) * 100) / 100;
    const retEfetiva = Math.round(validas.reduce(function (s, n) { return s + retencaoDe(n).total; }, 0) * 100) / 100;
    const semCadastro = validas.filter(function (n) {
      const o = retencaoDe(n).origem;
      return o === 'nota_sem_cadastro' || o === 'nota_sem_cliente';
    }).length;

    U.el('fa-saida').innerHTML =
      '<div class="pr-confere">' +
        '<span>Período <b>' + U.fData(L.periodoIni) + ' a ' + U.fData(L.periodoFim) + '</b></span>' +
        '<span>Notas <b>' + validas.length + (L.canceladas ? ' + ' + L.canceladas + ' cancelada(s)' : '') + '</b></span>' +
        '<span>Faturado <b>' + U.brl(L.total) + '</b></span>' +
        '<span>Retido na fonte <b>' + U.brl(retEfetiva) + '</b></span>' +
        '<span>Líquido a receber <b>' + U.brl(Math.round((L.total - retEfetiva) * 100) / 100) + '</b></span>' +
        '<span>Confere com o arquivo <b class="' + (L.confereTrailer ? '' : 'erro') + '">' +
          (L.confereTrailer ? 'sim' : 'NÃO') + '</b></span>' +
      '</div>' +
      resumoCompetencia(validas) +
      (semCadastro
        ? '<div class="aviso" style="margin:10px 0"><b>Retenção:</b> ' + semCadastro +
          ' nota(s) estão usando o que veio destacado na NF, que costuma não ser a retenção real do ' +
          'contrato. Configure as alíquotas no cliente (botão ao lado de cada tomador) — o cálculo passa ' +
          'a sair do cadastro, sobre o valor bruto.</div>'
        : '') +
      (L.problemas.length
        ? '<div class="aviso" style="margin:10px 0">' + L.problemas.map(U.esc).join('<br>') + '</div>' : '') +

      blocoTomadores(validas) +

      '<div class="ap-acoes">' +
        '<button class="btn-sm" id="fa-novo-projeto">+ Novo projeto</button>' +
        '<button class="btn-sm" id="fa-todos">Marcar todas</button>' +
        '<button class="btn-sm" id="fa-nada">Desmarcar</button>' +
        '<button class="btn-linha" id="fa-gerar"' + (marcadas.length ? '' : ' disabled') + '>' +
          'Gerar ' + marcadas.length + ' conta(s) a receber · ' + U.brl(somaSel) + '</button>' +
      '</div>' +

      '<div class="tabela-rolagem" style="margin:0 -14px">' +
      '<table><thead><tr><th style="width:24px"></th><th>NF</th><th>Emissão</th><th>Tomador</th>' +
      '<th>Projeto</th><th>Comp.</th><th class="num">Valor</th><th class="num">Retido</th>' +
      '<th class="num">Líquido</th><th>Situação</th></tr></thead><tbody>' +
      L.notas.map(function (n) {
        const lancada = jaLancada(n);
        const centro = sugerirCentro(n);
        const ret = retencaoDe(n);
        return '<tr class="' + (n.cancelada ? 'cancelada' : (sel.has(n.numero) && !lancada ? 'sel' : '')) + '">' +
          '<td>' + (n.cancelada || lancada ? '' :
            '<input type="checkbox" style="width:auto" data-nf="' + n.numero + '"' +
            (sel.has(n.numero) ? ' checked' : '') + '>') + '</td>' +
          '<td class="mono">' + U.esc(n.numero) + '</td>' +
          '<td class="mono">' + U.fData(n.emissao) + '</td>' +
          '<td class="desc" title="' + U.esc(n.discriminacao.slice(0, 300)) + '">' +
            U.esc(n.tomador.nome) + '<div class="sub">' + U.esc(n.tomador.documento) + ' · ' +
            U.esc(n.tomador.cidade) + '/' + U.esc(n.tomador.uf) + '</div></td>' +
          '<td>' + (n.cancelada ? '—' :
            '<select data-centro="' + n.tomador.documento + '" style="min-width:130px">' +
              '<option value="">Escolher…</option>' +
              opcoesProjeto(centro) + '</select>') + '</td>' +
          '<td>' + (n.cancelada
            ? '<span class="mono">' + U.fComp(n.competencia) + '</span>'
            : '<input type="month" data-comp="' + n.numero + '" value="' + compDe(n) + '" style="min-width:112px">' +
              '<div><span class="badge ' + (ROT_ORIGEM[n.competenciaOrigem] || {}).cls + '">' +
                ((ROT_ORIGEM[n.competenciaOrigem] || {}).txt || '?') + '</span>' +
              (n.competenciaConflito ? ' <span class="badge b-reprovado" title="o período aponta ' +
                U.fComp(n.competenciaConflito) + '">divergente</span>' : '') + '</div>') + '</td>' +
          '<td class="num">' + U.brl(n.valor) + '</td>' +
          '<td class="num">' + (ret.total ? U.brl(ret.total) : '—') +
            '<div class="sub">' + (ret.retencoes.length ? ret.retencoes.map(function (r) { return r.tributo; }).join(' ') : 'sem retenção') + '</div>' +
            '<div><span class="badge ' + (ret.origem === 'nota_sem_cadastro' || ret.origem === 'nota_sem_cliente'
                ? 'b-pendente' : 'b-pago') + '">' +
              ({ projeto: 'do projeto', cadastro: 'do cliente' }[ret.origem] || 'da nota') + '</span></div></td>' +
          '<td class="num">' + U.brl(Math.round((n.valor - ret.total) * 100) / 100) + '</td>' +
          '<td>' + (n.cancelada
            ? '<span class="badge b-cancelado">cancelada</span>'
            : lancada ? '<span class="badge b-pago">no contas a receber</span>'
            : '<span class="badge b-aberto">a lançar</span>') + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>' +
      listaReceber();

    U.el('fa-saida').querySelectorAll('[data-nf]').forEach(function (chk) {
      chk.addEventListener('change', function () {
        this.checked ? sel.add(this.dataset.nf) : sel.delete(this.dataset.nf);
        render();
      });
    });
    U.el('fa-saida').querySelectorAll('[data-comp]').forEach(function (i) {
      i.addEventListener('change', function () {
        comps[this.dataset.comp] = this.value;
        render();
      });
    });
    U.el('fa-saida').querySelectorAll('[data-centro]').forEach(function (s2) {
      s2.addEventListener('change', function () {
        mapa[this.dataset.centro] = this.value;   // vale para todas as notas do mesmo tomador
        render();
      });
    });
    U.el('fa-todos').addEventListener('click', function () {
      validas.forEach(function (n) { if (!jaLancada(n)) sel.add(n.numero); });
      render();
    });
    U.el('fa-nada').addEventListener('click', function () { sel.clear(); render(); });
    U.el('fa-gerar').addEventListener('click', gerar);
    /* Usa o cadastro COMPLETO de projeto (o mesmo de Cadastros): o
       formulário curto daqui criava projeto sem cliente, sem tipo de
       serviço e sem impostos, furando a regra de todo projeto ter
       cliente. */
    U.el('fa-novo-projeto').addEventListener('click', function () {
      if (ERP.cadastros && ERP.cadastros.editarProjeto) {
        ERP.cadastros.editarProjeto(null, function () { render(); });
      } else novoProjeto();
    });
    U.el('fa-saida').querySelectorAll('[data-cliente]').forEach(function (b) {
      b.addEventListener('click', function () { abrirCliente(this.dataset.cliente); });
    });
    (U.el('fa-saida').querySelectorAll('[data-receber]') || []).forEach(function (b) {
      b.addEventListener('click', function () { baixar(this.dataset.receber); });
    });
  }

  /* Competência é o campo que mais erra, porque não existe no layout:
     vem escrita na discriminação. Aqui fica claro de onde cada uma saiu
     e o que precisa de conferência antes de gerar. */
  function resumoCompetencia(validas) {
    const cont = { explicita: 0, periodo: 0, presumida: 0 };
    validas.forEach(function (n) { cont[n.competenciaOrigem] = (cont[n.competenciaOrigem] || 0) + 1; });
    const conflitos = validas.filter(function (n) { return n.competenciaConflito; });
    const partes = [];
    if (cont.explicita) partes.push(cont.explicita + ' dita na nota');
    if (cont.periodo) partes.push(cont.periodo + ' deduzida do período');
    if (cont.presumida) partes.push(cont.presumida + ' presumida (mês anterior à emissão)');
    return '<div class="aviso" style="margin:10px 0">' +
      '<b>Competência:</b> ' + partes.join(', ') + '. ' +
      (cont.presumida
        ? 'A competência não existe no layout do arquivo — vem escrita na discriminação. ' +
          'Corrija na coluna Comp. antes de gerar; quem emite a nota deveria sempre declarar o mês.'
        : 'Todas as competências vieram da própria nota.') +
      (conflitos.length
        ? '<br><b>Divergência:</b> ' + conflitos.map(function (n) {
            return 'NF ' + n.numero + ' diz ' + U.fComp(n.competencia) +
              ' mas o período aponta ' + U.fComp(n.competenciaConflito);
          }).join('; ') + '.'
        : '') + '</div>';
  }

  function blocoTomadores(validas) {
    const por = {};
    validas.forEach(function (n) {
      const k = n.tomador.documento;
      por[k] = por[k] || { nome: n.tomador.nome, n: 0, v: 0, liq: 0 };
      por[k].n++; por[k].v += n.valor; por[k].liq += n.valorLiquido;
    });
    const ids = Object.keys(por).sort(function (a, b) { return por[b].v - por[a].v; });
    return '<h2 style="font-size:12px;margin:16px 0 8px">Por tomador</h2>' +
      '<table><tbody>' + ids.map(function (k) {
        const cli = clientePorDoc(k);
        const cfg = cli && (cli.retencoes || []).length;
        return '<tr><td class="desc">' + U.esc(por[k].nome) + '<div class="sub">' + U.esc(k) + '</div></td>' +
          '<td class="num">' + por[k].n + ' nota(s)</td>' +
          '<td class="num">' + U.brl(Math.round(por[k].v * 100) / 100) + '</td>' +
          '<td>' + (cfg
            ? '<span class="badge b-pago">retenção cadastrada</span><div class="sub">' +
              cli.retencoes.map(function (r) { return r.tributo + ' ' + U.num(r.aliquota) + '%'; }).join(' · ') + '</div>'
            : '<span class="badge b-pendente">sem cadastro</span>') + '</td>' +
          '<td class="acoes"><button class="btn-sm" data-cliente="' + U.esc(k) + '">Retenções</button></td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* Projeto que ainda não existe se cadastra aqui, sem sair da tela. */
  function novoProjeto() {
    ERP.app.modal({
      titulo: 'Novo projeto',
      corpo:
        '<label>Nome do projeto</label><input id="np-nome" placeholder="Ex.: Hospital Municipal de Magé">' +
        '<div class="row2"><div><label>Apelido (aparece nas listas)</label><input id="np-curto"></div>' +
        '<div><label>Código</label><input id="np-codigo" inputmode="numeric"></div></div>' +
        '<div class="row2"><div><label>Dia do recebimento</label>' +
          '<input id="np-dia" type="number" min="1" max="31" value="15"></div>' +
        '<div><label>Mês do recebimento</label><select id="np-mes">' +
          '<option value="1">mês seguinte à competência</option>' +
          '<option value="2">dois meses depois</option>' +
          '<option value="0">mesmo mês</option></select></div></div>' +
        '<label>Apelidos para reconhecimento automático</label>' +
        '<input id="np-aliases" placeholder="separados por vírgula — ex.: MAGÉ, HMM">' +
        '<div class="ajuda">O sistema usa esses apelidos para achar o projeto no nome do tomador da NF ' +
        'e no arquivo de produtividade.</div>',
      acoes: [{ txt: 'Cadastrar projeto', cls: 'btn-aprovar', fn: function () {
        const nome = U.val('np-nome');
        if (!nome) return ERP.app.aviso('Informe o nome do projeto.', 'erro');
        const cod = U.val('np-codigo') ||
          String(D.centros.filter(function (c) { return c.tipo === 'projeto'; }).length + 1).padStart(3, '0');
        const id = 'p' + cod + '-' + Date.now().toString(36);
        D.centros.push({
          id: id, nome: nome, curto: U.val('np-curto') || nome.slice(0, 18),
          codigo: cod, tipo: 'projeto', ativo: true,
          recebimento_dia: parseInt(U.val('np-dia'), 10) || 15,
          recebimento_mes_offset: parseInt(U.val('np-mes'), 10),
          aliases: U.val('np-aliases').split(',').map(function (s) { return s.trim(); })
            .filter(function (s) { return s.length; })
        });
        ERP.app.fecharModal();
        ERP.app.aviso('Projeto "' + nome + '" cadastrado. Já aparece nas listas.', 'ok');
        render();
      } }]
    });
  }

  /* Alíquotas de retenção do cliente: é daqui que sai a retenção. */
  function abrirCliente(doc) {
    const nota = lote.notas.find(function (n) { return n.tomador.documento === doc; }) || { tomador: {} };
    const cli = clientePorDoc(doc);
    const atuais = {};
    (cli && cli.retencoes ? cli.retencoes : []).forEach(function (r) { atuais[r.tributo] = r.aliquota; });
    const daNota = {};
    (nota.retencoes || []).forEach(function (r) {
      daNota[r.tributo] = nota.valor ? Math.round(r.valor / nota.valor * 10000) / 100 : 0;
    });
    const TRIB = ['ISS', 'IRRF', 'PIS', 'COFINS', 'CSLL', 'INSS'];

    ERP.app.modal({
      titulo: 'Retenções de ' + (nota.tomador.nome || doc),
      corpo:
        '<div class="ajuda" style="margin-bottom:8px">Alíquota em % sobre o valor bruto da nota. Deixe zero no ' +
        'que o cliente não retém. Com isto preenchido, o sistema para de usar o que vem destacado na NF.</div>' +
        '<div class="row3">' + TRIB.map(function (t) {
          return '<div><label>' + t + ' (%)</label><input id="rt-' + t + '" class="num" inputmode="decimal" value="' +
            U.num(atuais[t] || 0) + '">' +
            (daNota[t] ? '<div class="ajuda">na NF: ' + U.num(daNota[t]) + '%</div>' : '') + '</div>';
        }).join('') + '</div>' +
        '<label>Projeto padrão deste cliente</label><select id="rt-centro">' +
          '<option value="">Nenhum</option>' +
          D.centros.filter(function (c) { return c.ativo; }).map(function (c) {
            return '<option value="' + c.id + '"' +
              ((cli && cli.centro_padrao === c.id) ? ' selected' : '') + '>' + U.esc(c.curto || c.nome) + '</option>';
          }).join('') + '</select>',
      acoes: [{ txt: 'Salvar cadastro', cls: 'btn-aprovar', fn: function () {
        const retencoes = TRIB.map(function (t) {
          return { tributo: t, aliquota: U.parseValor(U.val('rt-' + t)) };
        }).filter(function (r) { return r.aliquota > 0; });
        if (cli) {
          cli.retencoes = retencoes;
          cli.centro_padrao = U.val('rt-centro') || null;
        } else {
          D.clientes.push({
            id: 'og' + (D.clientes.length + 1) + '-' + Date.now().toString(36),
            documento: doc, nome: nota.tomador.nome,
            esfera: '', centro_padrao: U.val('rt-centro') || null, retencoes: retencoes
          });
        }
        ERP.app.fecharModal();
        ERP.app.aviso(retencoes.length
          ? 'Retenções salvas: ' + retencoes.map(function (r) { return r.tributo + ' ' + U.num(r.aliquota) + '%'; }).join(', ') + '.'
          : 'Cliente salvo sem retenção.', 'ok');
        render();
      } }]
    });
  }

  /* ── geração ────────────────────────────────────────────*/
  function gerar() {
    const alvo = lote.notas.filter(function (n) {
      return !n.cancelada && sel.has(n.numero) && !jaLancada(n);
    });
    let feitas = 0, semProjeto = 0, aConferir = 0, erros = [];
    alvo.forEach(function (n) {
      const centro = mapa[n.tomador.documento] || sugerirCentro(n);
      if (!centro) { semProjeto++; return; }
      const ret = retencaoDe(n);
      const r = S.criarReceber({
        numero: n.numero, nf_chave: n.verificacao, emissao: n.emissao,
        cliente_doc: n.tomador.documento, cliente_nome: n.tomador.nome,
        centro: centro, conta: '1.01',
        competencia: compDe(n),
        competencia_presumida: n.competenciaPresumida && !comps[n.numero],
        vencimento: previsaoDe(centro, compDe(n), n.tomador.documento),
        valor_bruto: n.valor,
        valor_retido: ret.total, retencoes: ret.retencoes, retencao_origem: ret.origem,
        glosa_prevista: 0, discriminacao: n.discriminacao
      });
      if (r.ok) { feitas++; aConferir += (r.aConferir || 0); }
      else erros.push('NF ' + n.numero + ': ' + r.erro);
    });
    sel.clear();
    render();
    ERP.app.atualizarContadores();
    ERP.app.aviso(feitas + ' conta(s) a receber gerada(s)' +
      (aConferir ? '. ' + aConferir + ' bateu(ram) com previsão e esperam conferência em Contas a receber' : '') +
      (semProjeto ? ', ' + semProjeto + ' sem projeto definido (escolha na coluna Projeto)' : '') +
      (erros.length ? '. ' + erros[0] : '.'), semProjeto || erros.length ? 'erro' : 'ok');
  }

  // prazo em dias a partir do fim da competência, do cliente ou do projeto
  function previsaoDe(centroId, comp, clienteDoc) {
    const pz = S.prazoDe(centroId, clienteDoc);
    return S.dataPrevista(comp || U.mesAtual(), pz.dias);
  }

  /* ── contas a receber já geradas ────────────────────────
     Usa listarReceber (e não contasReceber) de propósito: o filtro
     padrão tira substituído e cancelado. Antes, a previsão que a nota
     tinha acabado de substituir continuava na lista — e, pior, entrava
     no total de "A receber", inflando o mês inteiro. */
  function listaReceber() {
    const rs = S.listarReceber({});
    if (!rs.length) return '';
    const aberto = rs.filter(S.receberAberto)
      .reduce(function (s, r) { return s + r.valor_liquido; }, 0);
    const recebido = rs.reduce(function (s, r) { return s + (r.valor_recebido || 0); }, 0);
    return '<h2 style="font-size:12px;margin:18px 0 8px">Contas a receber</h2>' +
      '<div class="pr-confere"><span>A receber <b>' + U.brl(aberto) + '</b></span>' +
      '<span>Recebido <b>' + U.brl(recebido) + '</b></span></div>' +
      '<div class="tabela-rolagem" style="margin:8px -14px 0"><table><thead><tr>' +
      '<th>NF</th><th>Cliente</th><th>Projeto</th><th>Comp.</th><th>Previsão</th>' +
      '<th class="num">Bruto</th><th class="num">Retido</th><th class="num">Líquido</th>' +
      '<th>Situação</th><th></th></tr></thead><tbody>' +
      rs.map(function (r) {
        const c = D.centro(r.centro) || {};
        return '<tr><td class="mono">' + U.esc(r.numero) + '</td>' +
          '<td class="desc">' + U.esc(r.cliente_nome) + '</td>' +
          '<td>' + U.esc(c.curto || '—') + '</td>' +
          '<td class="mono">' + U.fComp(r.competencia) + '</td>' +
          '<td class="mono">' + U.fData(r.vencimento) + '</td>' +
          '<td class="num">' + U.brl(r.valor_bruto) + '</td>' +
          '<td class="num">' + U.brl(r.valor_retido) + '</td>' +
          '<td class="num">' + U.brl(r.valor_liquido) + '</td>' +
          '<td>' + situacao(r) + '</td>' +
          '<td class="acoes">' + (r.status !== 'recebido' && S.pode('pagar')
            ? '<button class="btn-sm btn-pagar" data-receber="' + r.id + '">Baixar</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* A etiqueta tem que dizer o que a linha é. Estava fixa em
     "faturado" para tudo que não fosse recebido, então previsão
     confirmada aparecia como nota emitida. */
  function situacao(r) {
    if (r.status === 'recebido') {
      return '<span class="badge b-pago">recebido ' + U.fData(r.recebido_em) + '</span>' +
        (r.glosa_real > 0.004 ? '<div class="sub">glosa ' + U.brl(r.glosa_real) + '</div>' : '');
    }
    if (r.status === 'previsto') return '<span class="badge b-pendente">previsto</span>';
    return '<span class="badge b-aberto">faturado</span>';
  }

  /* Recebimento abaixo do líquido esperado não tem resposta certa
     sozinha — mostra os números num modal de verdade, com Quitar,
     Manter resíduo, e o X/Fechar de sempre pra quem preferir não
     decidir agora (corrigir o faturamento, lançar uma glosa manual,
     e voltar depois). */
  /* Em qual conta o dinheiro entrou. Sem isso a baixa não pertence a
     saldo nenhum — e somá-la em todos foi o defeito corrigido na
     integração. As contas da empresa do título vêm primeiro, mas as
     outras continuam escolhíveis: recebimento na conta errada
     acontece e precisa poder ser registrado como foi. */
  function opcoesConta(r) {
    const emp = S.empresaDoCentro(r.centro);
    const ativas = D.bancos.filter(function (b) { return b.ativo !== false; });
    const daEmpresa = ativas.filter(function (b) { return emp && b.empresa === emp; });
    const outras = ativas.filter(function (b) { return daEmpresa.indexOf(b) < 0; });
    const opt = function (b) {
      return '<option value="' + b.id + '">' + U.esc(b.apelido || b.nome || b.id) + '</option>';
    };
    if (!daEmpresa.length) return ativas.map(opt).join('');
    return daEmpresa.map(opt).join('') +
      (outras.length ? '<optgroup label="Outras empresas do grupo">' +
        outras.map(opt).join('') + '</optgroup>' : '');
  }

  function perguntarResiduo(r, aoDecidir) {
    ERP.app.modal({
      titulo: 'Recebimento abaixo do esperado',
      corpo: '<div class="ajuda">' + U.esc(r.mensagem) + '</div>' +
        '<div class="ajuda">Feche esta janela (✕ ou "Fechar") se preferir não decidir agora.</div>',
      acoes: [
        { txt: 'Quitar (glosa de ' + U.brl(r.resta) + ')', cls: 'btn-pagar', fn: function () {
            ERP.app.fecharModal(); aoDecidir('quitar');
          } },
        { txt: 'Manter resíduo em aberto', cls: 'btn-sm', fn: function () {
            ERP.app.fecharModal(); aoDecidir('residual');
          } }
      ]
    });
  }

  function baixar(id, depois) {
    const r = S.contasReceber().find(function (x) { return x.id === id; });
    if (!r) return;
    ERP.app.modal({
      titulo: 'Baixar recebimento · NF ' + r.numero,
      corpo:
        '<div class="resumo-linha"><span>Cliente</span><span class="v">' + U.esc(r.cliente_nome) + '</span></div>' +
        '<div class="resumo-linha"><span>Bruto</span><span class="v">' + U.brl(r.valor_bruto) + '</span></div>' +
        '<div class="resumo-linha"><span>Retido na fonte</span><span class="v">' + U.brl(r.valor_retido) + '</span></div>' +
        '<div class="resumo-linha"><span>Esperado</span><span class="v">' + U.brl(r.valor_liquido) + '</span></div>' +
        '<div class="row2"><div><label>Data do crédito</label><input type="date" id="rb-data" value="' + U.hoje() + '"></div>' +
        '<div><label>Valor recebido</label><input id="rb-valor" class="num" value="' + U.num(r.valor_liquido) + '"></div></div>' +
        '<div class="row2"><div><label>Conta de crédito *</label>' +
          '<select id="rb-banco">' + opcoesConta(r) + '</select></div><div></div></div>' +
        '<div class="ajuda">Entre o líquido e o bruto, o sistema vincula direto e sinaliza a ' +
          'divergência de retenção. Abaixo do líquido, ele pergunta se quita com glosa ou mantém ' +
          'o resíduo em aberto.</div>',
      acoes: [{ txt: 'Registrar recebimento', cls: 'btn-pagar', fn: function () {
        const tentar = function (decisao) {
          const res = S.receberBaixa(id, { data: U.val('rb-data'),
            valor: U.parseValor(U.val('rb-valor')), banco: U.val('rb-banco'), decisao: decisao });
          if (res.erro) return ERP.app.aviso(res.erro, 'erro');
          if (res.decidir) return perguntarResiduo(res, tentar);
          ERP.app.fecharModal();
          ERP.app.aviso('Recebimento registrado.', 'ok');
          if (lote) render();
          if (depois) depois();
          ERP.app.atualizarContadores();
        };
        tentar();
      } }]
    });
  }

  return { montar: montar, render: render, baixar: baixar, renderCobertura: renderCobertura,
    renderStatus: renderStatus, renderResultado: renderResultado, atualizarAlertaFat: atualizarAlertaFat };
})();
