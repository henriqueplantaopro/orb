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
        if (ERP.app.erroDoRetorno(r)) return;
        ERP.app.fecharModal();
        renderStatus(); ERP.receber.render(); ERP.app.atualizarContadores();
        ERP.app.aviso('Complemento de ' + U.brl(r.receber.valor_bruto) + ' lançado no contas a receber.', 'ok');
      } }]
    });
  }

  /* ── Resultado ──────────────────────────────────────────
     O que sobra de cada projeto no mês: faturamento menos custo e
     impostos previstos. */
  /* A competência começa no MÊS CORRENTE e não pode ficar vazia:
     resultado somado de várias competências mistura mês fechado com
     mês em andamento, e a margem que sai disso não descreve nenhum
     dos dois. */
  let resComp = U.hoje().slice(0, 7), resCentro = '';

  function renderResultado() {
    const box = U.el('fa-aba-resultado');
    if (!box) return;
    if (!resComp) resComp = U.hoje().slice(0, 7);
    const lista = S.resultadoFaturamento({ competencia: resComp, centro: resCentro });
    const som = campo => Math.round(lista.reduce(function (t, l) { return t + (l[campo] || 0); }, 0) * 100) / 100;
    const totFat = som('faturamento'), totLucro = som('lucro');

    /* ── agrupado por CLIENTE ──────────────────────────────
       É o cliente que paga a nota e com quem se negocia preço e
       prazo; projeto é o recorte interno. Vinte linhas de projeto
       soltas não respondem "quanto a AGIR me dá de margem", que é
       a pergunta de quem abre esta tela. */
    const porCliente = {};
    lista.forEach(function (l) {
      const cid = D.clienteDoCentro(l.projeto.id) || '';
      const cli = (D.clientes || []).find(function (x) { return x.id === cid; });
      const chave = cli ? cli.nome : 'Sem cliente vinculado';
      (porCliente[chave] = porCliente[chave] || []).push(l);
    });
    const nomes = Object.keys(porCliente).sort(function (a, b) {
      /* O que não tem cliente vai para o fim: é pendência de
         cadastro, não um cliente chamado "Sem cliente". */
      if (a === 'Sem cliente vinculado') return 1;
      if (b === 'Sem cliente vinculado') return -1;
      return a.localeCompare(b, 'pt-BR');
    });

    const soma = (ls, campo) =>
      Math.round(ls.reduce(function (t, l) { return t + (l[campo] || 0); }, 0) * 100) / 100;

    box.innerHTML =
      '<h2>Resultado por cliente<span class="sub">faturamento menos custo e impostos previstos</span></h2>' +
      '<div class="filtros">' +
        '<div class="f"><label for="res-comp">Competência</label>' +
          '<input type="month" id="res-comp" value="' + resComp + '" required></div>' +
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
        ? '<div class="tabela-rolagem"><table class="tab-resultado"><thead><tr>' +
          '<th>Cliente / projeto</th><th>Faturamento</th>' +
          '<th class="num">Valor faturado</th><th class="num">Custo</th>' +
          '<th class="num">Impostos</th><th class="num">Lucro direto</th><th class="num">Margem</th>' +
          '</tr></thead><tbody>' +
          nomes.map(function (nome) {
            const ls = porCliente[nome];
            const f = soma(ls, 'faturamento'), lu = soma(ls, 'lucro');
            return '<tr class="res-cliente"><td class="desc">' + U.esc(nome) +
                '<div class="sub">' + ls.length + ' projeto(s)</div></td>' +
              '<td></td>' +
              '<td class="num">' + U.brl(f) + '</td>' +
              '<td class="num">' + U.brl(soma(ls, 'custo')) + '</td>' +
              '<td class="num">' + U.brl(soma(ls, 'impostos')) + '</td>' +
              '<td class="num' + (lu < 0 ? ' erro' : '') + '">' + U.brl(lu) + '</td>' +
              '<td class="num">' + (f > 0 ? U.pct(Math.round(lu / f * 1000) / 10) : '—') + '</td></tr>' +
              ls.map(function (l) {
                return '<tr><td class="desc" style="padding-left:24px">' +
                    U.esc(l.projeto.curto || l.projeto.nome) + '</td>' +
                  '<td class="sub">' + U.esc(S.NOME_STATUS_FAT[l.status] || l.status) + '</td>' +
                  '<td class="num">' + U.brl(l.faturamento) + '</td>' +
                  '<td class="num">' + U.brl(l.custo) +
                    '<div class="sub">' + U.esc(l.tipo_custo) + '</div></td>' +
                  '<td class="num sub">' + U.brl(l.impostos) +
                    ' <span class="sub">' + U.pct(l.impostos_pct) + '</span></td>' +
                  '<td class="num ' + (l.lucro < 0 ? 'erro' : '') + '">' + U.brl(l.lucro) + '</td>' +
                  '<td class="num">' + (l.margem === null ? '—' : U.pct(l.margem)) + '</td></tr>';
              }).join('');
          }).join('') + '</tbody></table></div>'
        : '<div class="vazio"><strong>Nada em ' + U.fComp(resComp) + '.</strong>' +
          'Escolha outra competência.</div>');
    U.ajustarColunas(box);
    U.el('res-comp').addEventListener('change', function () {
      /* O campo de mês pode ser esvaziado pelo teclado; esvaziado,
         ele volta para o mês corrente em vez de virar "todas". */
      resComp = this.value || U.hoje().slice(0, 7);
      renderResultado();
    });
    U.el('res-centro').addEventListener('change', function () { resCentro = this.value; renderResultado(); });
  }

  /* ── RPS em lote ────────────────────────────────────────
     O portal de Barueri converte arquivo de RPS em NF-e. É o caminho
     oficial: não guarda senha nossa, não quebra quando a prefeitura
     mexe no site e deixa rastro do que foi enviado. O sistema monta o
     arquivo com o que está LIBERADO na esteira; o envio e o retorno
     (número da NF-e) continuam passando por uma pessoa. */
  let rpsComp = '';   // vazio = todas as competências liberadas
  /* QUAIS COBRANÇAS ENTRAM NO ARQUIVO.

     O lote levava TODAS as prontas, sem escolha. Ele tem cinco
     faturamentos liberados e só um sai pela matriz por RPS — os
     outros quatro são emitidos à mão, no portal da prefeitura de
     onde o serviço foi prestado. Sem poder escolher, o único
     caminho era não gerar nada.

     Guarda a referência de cada item (`centro:pj01`, `grupo:GHC -
     HGB`), que é estável entre redesenhos; `null` significa "ainda
     não mexeu", e aí valem todas as prontas — o caso comum
     continua sendo um clique só. */
  let rpsSel = null;
  const refRps = i => i.referencia || (i.grupo ? 'grupo:' + i.grupo : 'centro:' + i.centro);
  const rpsEscolhido = (i, pronto) => pronto && (rpsSel === null || rpsSel.has(refRps(i)));

  function renderRPS() {
    const itens = S.itensParaRPS(rpsComp);
    const lotes = S.st.lotesRPS.filter(function (l) { return !rpsComp || l.competencia === rpsComp; });
    /* A CONFERÊNCIA OLHA A MESMA EMPRESA QUE O ARQUIVO VAI USAR.
       Olhando a cópia fixa, a tela dizia "pronto para gerar" com a
       inscrição da matriz enquanto o arquivo sairia com a da
       empresa do lote — e a recusa só aparecia no portal. */
    const quemEmite = S.empresaDoLoteRps(itens);
    const empRps = S.dadosDaEmpresaParaRps(quemEmite.empresa);
    const pend = itens.map(function (i) {
      return { item: i, falta: ERP.rpsBarueri.pendencias(i, empRps) };
    });
    const prontos = pend.filter(function (p) { return !p.falta.length; });
    /* O que de fato vai no arquivo: pronto E escolhido. */
    const escolhidos = prontos.filter(function (p) { return rpsEscolhido(p.item, true); });
    const total = Math.round(escolhidos.reduce(function (a, p) { return a + p.item.valor; }, 0) * 100) / 100;
    /* A empresa que vai no cabeçalho é a dos ESCOLHIDOS: o aviso de
       "notas de empresas diferentes" olhava o lote inteiro e
       acusava mistura que a escolha já tinha desfeito. */
    const quemEscolhido = S.empresaDoLoteRps(escolhidos.map(function (p) { return p.item; }));

    U.el('fa-aba-rps').innerHTML =
      '<h2>RPS em lote<span class="sub">gera o arquivo que o portal da prefeitura converte em NF-e</span></h2>' +
      '<div class="filtros"><div class="f"><label for="rps-comp">Competência</label>' +
        '<input type="month" id="rps-comp" value="' + rpsComp + '"></div>' +
        (rpsComp ? '<button class="btn-sm" id="rps-todas" style="align-self:flex-end">Todas as liberadas</button>' : '') +
        '<button class="btn-linha" id="rps-gerar" style="align-self:flex-end"' +
          (escolhidos.length ? '' : ' disabled title="Nenhuma cobrança marcada — marque na primeira coluna"') +
          '>Gerar arquivo (' + escolhidos.length + ' RPS)</button>' +
        (prontos.length > 1
          ? '<button class="btn-sm" id="rps-todos" style="align-self:flex-end">Marcar todas</button>' +
            '<button class="btn-sm" id="rps-nenhum" style="align-self:flex-end">Desmarcar</button>'
          : '') + '</div>' +
        /* BOTÃO DESLIGADO TEM DE DIZER POR QUÊ. Clicar e não
           acontecer nada deixa a pessoa procurando defeito onde não
           há: o motivo está na coluna Situação, logo abaixo, mas
           ninguém liga uma coisa à outra sozinho. */
        (prontos.length ? '' :
          '<div class="ajuda">Nenhuma cobrança está pronta para virar RPS' +
          (pend.length ? ', e por isso o botão está desligado. O motivo de cada uma está na coluna ' +
            '<b>Situação</b> da tabela abaixo — em geral falta dado no cadastro do tomador.'
            : '. Libere uma cobrança no faturamento para que ela apareça aqui.') +
          '</div>') +
        (prontos.length && !escolhidos.length
          ? '<div class="ajuda">Nenhuma cobrança marcada. Marque na primeira coluna as que vão ' +
            'neste arquivo — as outras ficam aqui, esperando o próximo lote.</div>'
          : '') +
        (escolhidos.length && escolhidos.length < prontos.length
          ? '<div class="ajuda">O arquivo vai com <b>' + escolhidos.length + ' de ' + prontos.length +
            '</b> cobranças prontas. As não marcadas continuam liberadas e aparecem no próximo lote.</div>'
          : '') +
        (quemEscolhido.misturado
          ? '<div class="ajuda erro">As marcadas são de <b>' + quemEscolhido.empresas.length +
            ' empresas diferentes</b> (' + U.esc(quemEscolhido.empresas.map(S.apelidoEmpresa).join(', ')) +
            '). O arquivo de RPS é de um prestador só — desmarque até sobrar uma empresa.</div>'
          : '') +
      '<div class="pr-confere">' +
        '<span>Liberados para faturar <b>' + itens.length + '</b></span>' +
        '<span>Prontos <b>' + prontos.length + '</b></span>' +
        '<span>Com pendência <b class="' + (pend.length - prontos.length ? 'erro' : '') + '">' +
          (pend.length - prontos.length) + '</b></span>' +
        '<span>Valor do lote <b>' + U.brl(total) + '</b></span>' +
      '</div>' +
      (itens.length
        ? '<table><thead><tr><th style="width:24px"></th><th>Cobrança</th><th>Emite</th>' +
          '<th>Tomador</th><th class="num">Valor</th>' +
          '<th class="num">Retenções</th><th>Situação</th></tr></thead><tbody>' +
          pend.map(function (p) {
            const i = p.item;
            const ret = Math.round((i.retencoes || []).reduce(function (a, r) { return a + r.valor; }, 0) * 100) / 100;
            const marcado = rpsEscolhido(i, !p.falta.length);
            return '<tr' + (p.falta.length ? ' class="atrasada"' : (marcado ? '' : ' class="cancelada"')) + '>' +
              /* Com pendência não se marca: o item não pode ir no
                 arquivo de jeito nenhum, e uma caixa que não faz
                 nada é pior que caixa nenhuma. */
              '<td>' + (p.falta.length
                ? '<span class="sub" title="falta cadastro — não pode ir no arquivo">—</span>'
                : '<input type="checkbox" style="width:auto" data-rps-sel="' + U.esc(refRps(i)) + '"' +
                  (marcado ? ' checked' : '') + '>') + '</td>' +
              '<td class="desc">' + U.esc(i.grupo ? 'Nota única · ' + i.grupo : (D.centro(i.centro) || {}).curto || '') +
                '<div class="sub">' + U.esc(String(i.discriminacao).slice(0, 70)) + '</div></td>' +
              /* POR QUAL CNPJ ESTA SAI. É a coluna que faltava para
                 ele escolher: sem ela, decidir quais marcar era
                 abrir a esteira e conferir uma a uma. */
              '<td class="sub">' + U.esc(S.apelidoEmpresa(S.empresaEmissora(i.centro, i.competencia))) + '</td>' +
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
                    /* v156: importar é o caminho preferido — traz o
                       número, a data real, o código de autenticidade
                       e a chave do ADN. Digitar continua ali ao lado
                       para quando o arquivo não estiver à mão. */
                    '<button class="btn-sm btn-aprovar" data-rps-imp="' + l.id + '">Importar retorno</button> ' +
                    '<button class="btn-sm" data-rps-ret="' + l.id + '">Informar à mão</button>' : '') +
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
    U.el('rps-comp').addEventListener('change', function () {
      rpsComp = this.value;
      /* Trocou de competência: a escolha era da lista anterior. */
      rpsSel = null;
      renderRPS();
    });
    if (U.el('rps-todas')) {
      U.el('rps-todas').addEventListener('click', function () { rpsComp = ''; rpsSel = null; renderRPS(); });
    }
    const prontasAgora = function () {
      const emp = S.dadosDaEmpresaParaRps(S.empresaDoLoteRps(S.itensParaRPS(rpsComp)).empresa);
      return S.itensParaRPS(rpsComp)
        .filter(function (i) { return !ERP.rpsBarueri.pendencias(i, emp).length; })
        .map(refRps);
    };
    if (U.el('rps-todos')) {
      U.el('rps-todos').addEventListener('click', function () { rpsSel = null; renderRPS(); });
    }
    if (U.el('rps-nenhum')) {
      U.el('rps-nenhum').addEventListener('click', function () { rpsSel = new Set(); renderRPS(); });
    }
    document.querySelectorAll('[data-rps-sel]').forEach(function (cx) {
      cx.addEventListener('change', function () {
        /* Primeira mexida: parte de todas marcadas, que é o que a
           tela estava mostrando. */
        if (rpsSel === null) rpsSel = new Set(prontasAgora());
        if (this.checked) rpsSel.add(this.dataset.rpsSel);
        else rpsSel.delete(this.dataset.rpsSel);
        renderRPS();
      });
    });
    if (U.el('rps-gerar')) {
      U.el('rps-gerar').addEventListener('click', function () {
        /* A EMPRESA DO LOTE VEM DO CADASTRO, não da cópia escrita
           no código — é o que faz corrigir a inscrição municipal em
           Cadastros › Empresas chegar ao arquivo. */
        /* SÓ AS MARCADAS. Levava todas as prontas, e com isso o
           lote de cinco saía inteiro quando só uma devia sair. */
        const todos = S.itensParaRPS(rpsComp).filter(function (i) {
          return rpsSel === null || rpsSel.has(refRps(i));
        });
        const quem = S.empresaDoLoteRps(todos);
        /* UM ARQUIVO, UM PRESTADOR. O cabeçalho do RPS tem uma
           inscrição só: misturar emitentes num lote produziria um
           arquivo em que metade das notas sai no CNPJ errado — e a
           prefeitura aceitaria, porque o cabeçalho estaria válido. */
        if (quem.misturado) {
          return ERP.app.aviso('Este lote tem notas de ' + quem.empresas.length +
            ' empresas diferentes (' + quem.empresas.map(S.apelidoEmpresa).join(', ') +
            '). O arquivo de RPS é de um prestador só — gere um lote por empresa, ' +
            'filtrando na esteira.', 'erro');
        }
        const emp = S.dadosDaEmpresaParaRps(quem.empresa);
        const itens = todos.filter(function (i) {
          return !ERP.rpsBarueri.pendencias(i, emp).length;
        });
        const remessa = U.hoje().replace(/-/g, '') + String(S.st.lotesRPS.length + 1).padStart(3, '0');
        const r = ERP.rpsBarueri.gerar(itens, emp, { remessa: remessa, numero_inicial: proximoRPS() });
        if (ERP.app.erroDoRetorno(r)) return;
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
    U.el('fa-aba-rps').querySelectorAll('[data-rps-imp]').forEach(function (b) {
      b.addEventListener('click', function () { importarRetorno(this.dataset.rpsImp); });
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
            if (ERP.app.erroDoRetorno(r)) return;
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

  /* v156: IMPORTAR O RETORNO DO PORTAL.

     O número da NF-e era digitado de volta, um por um, lendo o
     arquivo que a prefeitura devolve. Junto com o número se perdiam
     a data real de emissão (a nota ficava com "hoje"), o código de
     autenticidade e a chave de acesso do Ambiente Nacional — três
     coisas que o arquivo já traz.

     Confere ANTES de converter, e mostra o que achou: arquivo de
     outro lote ou de outra empresa cria título com número de nota
     que não é desse faturamento, e isso não se descobre olhando. */
  function importarRetorno(loteId) {
    const lote = S.st.lotesRPS.find(function (l) { return l.id === loteId; });
    if (!lote) return;
    const ent = document.createElement('input');
    ent.type = 'file';
    ent.accept = '.txt,.TXT,text/plain';
    ent.addEventListener('change', function () {
      const arq = ent.files && ent.files[0];
      if (!arq) return;
      const leitor = new FileReader();
      leitor.onload = function () {
        const r = ERP.rpsBarueri.lerRetorno(String(leitor.result || ''));
        if (ERP.app.erroDoRetorno(r)) return;
        conferirRetorno(lote, r, arq.name);
      };
      /* O arquivo vem em Latin-1, como o que mandamos: lido como
         UTF-8, cada acento do nome do tomador vira caractere
         quebrado. */
      leitor.readAsText(arq, 'ISO-8859-1');
    });
    ent.click();
  }

  function conferirRetorno(lote, r, nomeArq) {
    const porRps = {};
    lote.rps.forEach(function (x) { porRps[String(x.numero)] = x; });
    const casam = [], sobram = [], jaFeitos = [], canceladas = [];
    r.notas.forEach(function (n) {
      const rps = porRps[String(n.rps)];
      if (!rps) { sobram.push(n); return; }
      if (n.situacao === 'C') { canceladas.push(n); return; }
      if (rps.nf) { jaFeitos.push(n); return; }
      casam.push(n);
    });
    const faltam = lote.rps.filter(function (x) {
      return !x.nf && !casam.some(function (n) { return String(n.rps) === String(x.numero); });
    });
    const remessaDiverge = String(r.remessa || '') !== String(lote.remessa || '');

    ERP.app.modal({
      titulo: 'Retorno do portal · remessa ' + lote.remessa,
      fecharTxt: 'Fechar',
      corpo:
        '<div class="ajuda">Arquivo: <b>' + U.esc(nomeArq) + '</b> · remessa ' +
          U.esc(r.remessa || '—') + ' · inscrição ' + U.esc(r.inscricao || '—') + '</div>' +
        (remessaDiverge
          ? '<div class="aviso" style="margin:8px 0"><b>Este arquivo é de outra remessa</b> ' +
            '(' + U.esc(r.remessa || '—') + '), e este lote é a ' + U.esc(lote.remessa) + '. ' +
            'Importar criaria títulos com nota de outro faturamento. Confira no portal qual ' +
            'arquivo você baixou.</div>'
          : '') +
        (sobram.length
          ? '<div class="ajuda" style="margin-top:6px">' + sobram.length + ' nota(s) do arquivo não ' +
            'pertencem a este lote e vão ser ignoradas: RPS ' +
            U.esc(sobram.map(function (n) { return n.rps; }).join(', ')) + '.</div>'
          : '') +
        (canceladas.length
          ? '<div class="ajuda" style="margin-top:6px">' + canceladas.length + ' nota(s) vieram ' +
            'canceladas no arquivo e não entram.</div>'
          : '') +
        (jaFeitos.length
          ? '<div class="ajuda" style="margin-top:6px">' + jaFeitos.length + ' RPS já tinham ' +
            'NF-e registrada e não vão ser mexidos.</div>'
          : '') +
        '<table class="parcelas" style="margin-top:8px"><thead><tr><th>RPS</th><th>Cobrança</th>' +
        '<th class="num">Valor</th><th>NF-e</th><th>Emissão</th><th>Código</th></tr></thead><tbody>' +
        casam.map(function (n) {
          const rps = porRps[String(n.rps)];
          return '<tr><td class="mono">' + n.rps + '</td>' +
            '<td class="desc">' + U.esc(rps.tomador || '') + '</td>' +
            '<td class="num">' + U.brl(rps.valor) + '</td>' +
            '<td class="mono"><b>' + U.esc(n.nf) + '</b></td>' +
            '<td>' + U.esc(U.fData(dataDoArquivo(n.emissao))) + '</td>' +
            '<td class="mono sub">' + U.esc(n.codigo_verificacao || '—') + '</td></tr>';
        }).join('') +
        faltam.map(function (x) {
          return '<tr style="opacity:.55"><td class="mono">' + x.numero + '</td>' +
            '<td class="desc">' + U.esc(x.tomador || '') + '</td>' +
            '<td class="num">' + U.brl(x.valor) + '</td>' +
            '<td colspan="3" class="sub">não veio neste arquivo</td></tr>';
        }).join('') +
        '</tbody></table>' +
        (casam.length ? '' : '<div class="ajuda" style="margin-top:8px">Nenhuma nota deste arquivo ' +
          'entra neste lote. Nada vai ser registrado.</div>'),
      acoes: casam.length && !remessaDiverge
        ? [{ txt: 'Registrar ' + casam.length + ' NF-e', cls: 'btn-aprovar', fn: function () {
            const mapa = {};
            casam.forEach(function (n) {
              mapa[porRps[String(n.rps)].numero] = {
                nf: n.nf, serie: n.serie, emissao: dataDoArquivo(n.emissao),
                codigo_verificacao: n.codigo_verificacao, nf_chave: n.nf_chave
              };
            });
            const res = S.converterLoteRPS(lote.id, mapa);
            if (ERP.app.erroDoRetorno(res)) return;
            ERP.app.fecharModal();
            renderRPS();
            atualizarAlertaFat();
            ERP.app.aviso(res.convertidos + ' NF-e registrada(s) a partir do arquivo.' +
              (res.erros.length ? ' ' + res.erros.length + ' com erro: ' + res.erros[0] : ''),
              res.erros.length ? 'erro' : 'ok');
          } }]
        : []
    });
  }

  /* AAAAMMDD do arquivo para o formato de data do sistema. */
  const dataDoArquivo = d => {
    const s = String(d || '').replace(/\D/g, '');
    return s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) : U.hoje();
  };

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
        if (ERP.app.erroDoRetorno(r)) return;
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
  /* A esteira abre na competência do MÊS CORRENTE, e não em
     "todas". Faturamento se acompanha mês a mês: a lista de todas
     as competências junta o que está fechado com o que está em
     andamento, e o número que a pessoa olha deixa de querer dizer
     alguma coisa. */
  /* A ESTEIRA ABRE NO MÊS ANTERIOR, e não no corrente: dia 3 de
     novembro não há o que faturar de novembro — o que está em cima
     da mesa é outubro. Abrindo no mês corrente, a tela abria quase
     vazia e a primeira ação de todo dia era trocar a competência. */
  let fEst = { pendentes: true, competencia: '', etapa: '',
    sem_doc: false, anteriores: false, falta_enviar: false };
  /* Quantas competências para trás contam como ATRASADO. Dia 01/11,
     com 2, é setembro para trás. */
  const COMPETENCIAS_DE_ATRASO = 2;
  const ETAPAS_NOME = { previsao: 'Previsão', confirmado: 'Valor confirmado',
    autorizado: 'Autorizado pelo órgão', liberado: 'Liberado p/ faturar', faturado: 'Faturado' };
  /* Versão curta para o cabeçalho da esteira, que tem oito colunas e
     precisa caber na tela sem rolagem lateral. */
  const ETAPAS_CURTO = { previsao: 'Previsto', confirmado: 'Confirm.',
    autorizado: 'Autoriz.', liberado: 'Liberado', faturado: 'Faturado' };
  const ORDEM_ETAPAS = ['previsao', 'confirmado', 'autorizado', 'liberado', 'faturado'];

  function renderEsteira() {
    if (!fEst.competencia) fEst.competencia = S.competenciaDeslocada(1);
    const todas = S.esteiraFaturamento({});

    /* O QUE ESTÁ NA TELA, antes do filtro de etapa — é sobre ESTE
       conjunto que as contagens falam. Contando sobre todas as
       competências, o número da etiqueta prometia uma coisa e o
       clique entregava outra: "Previsão (71)" com setenta e um de
       todos os meses, e a lista mostrando os quatro do mês aberto. */
    /* "A ENVIAR" ATRAVESSA A COMPETÊNCIA, como "sem documento" e como
       "anteriores": a nota esquecida é justamente a do mês que
       ninguém está mais olhando. Filtrar dentro do mês aberto
       responderia outra pergunta. */
    /* PROJETO E CLIENTE INATIVOS NÃO APARECEM MAIS.

       Some da lista, mas não some da tela: `ocultos` é o que a
       esteira escondeu, e dele sai a linha que diz quantos foram e
       quais ainda têm faturamento em aberto. Inativar não pode ser
       um jeito de perder nota emitida e não enviada. */
    const ocultos = S.inativosNaEsteira({ competencia: fEst.competencia });
    const incl = fEst.inativos ? true : undefined;
    const base = fEst.anteriores
      ? S.esteiraFaturamento({ anteriores: COMPETENCIAS_DE_ATRASO, incluir_inativos: incl,
          sem_documento: fEst.sem_doc, falta_enviar: fEst.falta_enviar })
      : (fEst.falta_enviar
          ? S.esteiraFaturamento({ falta_enviar: true, incluir_inativos: incl, sem_documento: fEst.sem_doc })
          : S.esteiraFaturamento({ pendentes: fEst.pendentes, competencia: fEst.competencia,
              incluir_inativos: incl, sem_documento: fEst.sem_doc }));
    const conta = {};
    ORDEM_ETAPAS.forEach(function (e) {
      conta[e] = base.filter(function (l) { return l.etapa === e; }).length;
    });
    const lista = fEst.etapa
      ? base.filter(function (l) { return l.etapa === fEst.etapa; }) : base;

    /* As duas contagens que ela pediu, e que não dependem do mês
       aberto: o que está confirmado sem documento, e o que ficou
       para trás de duas competências sem fechar. */
    const semDoc = todas.filter(function (l) { return l.sem_documento; }).length;
    /* FATURADAS E AINDA NÃO ENVIADAS. Conta sobre TODAS as
       competências, como "sem documento": a nota esquecida é
       justamente a do mês que ninguém está mais olhando. */
    const aEnviar = todas.filter(function (l) { return l.falta_enviar; }).length;
    const atrasadas = S.esteiraFaturamento({ anteriores: COMPETENCIAS_DE_ATRASO }).length;
    const limiteAtraso = S.competenciaDeslocada(COMPETENCIAS_DE_ATRASO);

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
        '<div class="f"><label for="es-comp">Competência</label><select id="es-comp"' +
          (fEst.anteriores || fEst.falta_enviar ? ' disabled' : '') + '>' +
          /* Sem a opção "Todas": uma competência por vez, sempre. E
             o mês corrente entra na lista mesmo quando ainda não
             tem nada lançado — senão a tela abriria vazia e sem
             dizer por quê. */
          (comps.indexOf(fEst.competencia) < 0 ? [fEst.competencia] : []).concat(comps)
            .map(function (c) {
              return '<option value="' + c + '"' + (fEst.competencia === c ? ' selected' : '') + '>' +
                U.fComp(c) + '</option>';
            }).join('') + '</select></div>' +
        '<label style="align-self:flex-end;font-weight:400"><input type="checkbox" id="es-pend" style="width:auto"' +
          (fEst.pendentes ? ' checked' : '') +
          (fEst.anteriores || fEst.falta_enviar ? ' disabled' : '') +
          '> esconder os já faturados</label>' +
      '</div>' +
      /* AS ETAPAS LADO A LADO, e não num menu suspenso. Elas são
         seis: cabem numa linha, e escolher entre seis coisas
         visíveis é um clique, contra três num menu que esconde as
         opções até ser aberto. A contagem que antes só decorava
         virou o próprio botão. */
      '<div class="es-chips">' +
        '<button class="chip' + (!fEst.etapa ? ' sel' : '') + '" data-es-etapa="">Todas' +
          '<b>' + base.length + '</b></button>' +
        ORDEM_ETAPAS.map(function (e) {
          return '<button class="chip' + (fEst.etapa === e ? ' sel' : '') +
            '" data-es-etapa="' + e + '" title="' + ETAPAS_NOME[e] + '">' +
            ETAPAS_CURTO[e] + '<b' + (conta[e] && e !== 'faturado' ? ' class="erro"' : '') + '>' +
            conta[e] + '</b></button>';
        }).join('') +
        '<span class="es-sep"></span>' +
        /* AS DUAS PENDÊNCIAS QUE ELA PEDIU. Atravessam o filtro de
           competência de propósito: são justamente o que escapa de
           olhar um mês por vez. */
        '<button class="chip chip-falta' + (fEst.sem_doc ? ' sel' : '') + '" data-es-semdoc ' +
          'title="valor confirmado, nenhum documento anexado e ninguém marcou que este caso não tem">' +
          'Sem documento<b>' + semDoc + '</b></button>' +
        /* A ENVIAR fica ao lado de SEM DOCUMENTO: são as duas
           pendências que sobrevivem ao faturamento, e as duas se
           perdem de vista pelo mesmo motivo — o mês fechou e
           ninguém olha mais para ele. */
        '<button class="chip chip-falta' + (fEst.falta_enviar ? ' sel' : '') + '" data-es-enviar ' +
          'title="nota emitida e ainda não enviada ao cliente">' +
          'A enviar<b>' + aEnviar + '</b></button>' +
        '<button class="chip chip-atraso' + (fEst.anteriores ? ' sel' : '') + '" data-es-atraso ' +
          'title="não fechados de ' + U.fComp(limiteAtraso) + ' para trás">' +
          'Anteriores<b>' + atrasadas + '</b></button>' +
        /* O botão dos inativos só existe quando há inativo escondido:
           chip zerado numa barra de seis é ruído. */
        (ocultos.total
          ? '<button class="chip' + (fEst.inativos ? ' sel' : '') + '" data-es-inativos ' +
            'title="projetos ou clientes inativados — escondidos da esteira">' +
            'Inativos<b' + (ocultos.abertos ? ' class="erro"' : '') + '>' + ocultos.total + '</b></button>'
          : '') +
      '</div>' +
      /* ESCONDIDO NÃO É PERDIDO. Se um inativo ainda tem faturamento
         em aberto, a tela diz quais são — pelo nome — em vez de
         deixar a nota emitida desaparecer junto com o cadastro. */
      (ocultos.total && !fEst.inativos
        ? '<div class="ajuda' + (ocultos.abertos ? ' erro' : '') + '">' +
          'Escondi <b>' + ocultos.total + '</b> ' +
          (ocultos.total === 1 ? 'faturamento de projeto ou cliente inativo'
            : 'faturamentos de projetos ou clientes inativos') + '. ' +
          (ocultos.abertos
            ? '<b>' + ocultos.abertos + (ocultos.abertos === 1 ? ' ainda tem' : ' ainda têm') +
              ' coisa em aberto</b>: ' + U.esc(ocultos.nomes.slice(0, 6).join(', ')) +
              (ocultos.nomes.length > 6 ? ' e mais ' + (ocultos.nomes.length - 6) : '') + '. '
            : 'Nenhum deles tem pendência. ') +
          'O botão <b>Inativos</b> acima mostra todos.</div>'
        : '') +
      (fEst.inativos
        ? '<div class="ajuda">Mostrando também os <b>inativos</b>, marcados na lista. ' +
          'Clique em <b>Inativos</b> de novo para esconder.</div>'
        : '') +
      (fEst.anteriores
        ? '<div class="ajuda erro">Mostrando o que ficou para trás: faturamentos de <b>' +
          U.fComp(limiteAtraso) + ' para trás</b> que ainda não fecharam. A competência fica ' +
          'desligada enquanto esta visão está ativa.</div>'
        : '') +
      (fEst.sem_doc
        ? '<div class="ajuda">Mostrando só os que estão <b>sem documento</b>. Anexe a AF ou a escala, ' +
          'ou marque que este faturamento não tem documento — aí ele sai desta conta.</div>'
        : '') +
      (fEst.falta_enviar
        ? '<div class="ajuda">Mostrando só as notas <b>emitidas e ainda não enviadas ao cliente</b>. ' +
          'O botão <b>Enviar</b> na linha mostra o que vai no pacote e registra o envio.</div>'
        : '') +
      '<div class="tabela-rolagem" style="margin:0 -14px"><table><thead><tr>' +
        /* Cabeçalhos curtos e colunas de etapa estreitas: eram quatro
           títulos longos ("Autorizado pelo órgão", "Liberado p/
           faturar") empurrando a tabela para fora da tela, e cada um
           guarda só uma data ou um visto. O nome completo fica no
           `title`, para quem passar o mouse. */
        /* A PRODUTIVIDADE saiu desta aba. Ela tem estágio e valor
           próprios, que não são os do faturamento, e lado a lado as
           duas colunas de valor eram lidas como se fossem a mesma
           coisa. O acompanhamento da produtividade está na aba
           Previsões e no módulo de Produtividade. */
        '<th>Projeto</th><th class="col-comp">Comp.</th>' +
        '<th class="num col-val">Valor</th>' +
        ORDEM_ETAPAS.slice(1).map(function (e) {
          return '<th class="num col-etapa" title="' + ETAPAS_NOME[e] + '">' +
            ETAPAS_CURTO[e] + '</th>';
        }).join('') +
        '<th class="num col-parado">Parado</th><th class="col-acoes"></th></tr></thead><tbody>' +
        (lista.length ? lista.map(function (l) {
          const atrasado = l.etapa !== 'faturado' && l.dias > 15;
          return '<tr' + (l.inativo ? ' class="cancelada"' : atrasado ? ' class="atrasada"' : '') + '>' +
            /* UMA LINHA DE APOIO, não duas. O emitente nasceu na v141
               numa linha própria embaixo do nome, e com isso TODA
               linha da esteira passou a ocupar três alturas de
               texto: a tabela inteira cresceu um terço para dizer,
               em quase todas as linhas, a mesma coisa ("HJM
               Matriz"). Unidade e emitente cabem na mesma linha. */
            '<td class="desc">' +
              (l.eh_grupo
                ? '<button class="btn-ghost" data-est-exp="' + U.esc(l.grupo + '|' + l.competencia) + '" ' +
                    'title="ver especialidades">' + (expandidos[l.grupo + '|' + l.competencia] ? '▾' : '▸') + '</button> ' +
                  U.esc(l.projeto.curto)
                : U.esc(l.projeto.curto || l.projeto.nome)) +
              (l.inativo ? ' <span class="badge b-pendente">inativo</span>' : '') +
              /* POR QUAL CNPJ ESTA NOTA SAI.

                 Antes o CNPJ emitente não estava escrito em lugar
                 nenhum da tela e a nota saía pela matriz sem
                 ninguém ter decidido isso. */
              '<div class="sub">' + [
                /* Texto curto de propósito: a linha de apoio divide
                   o espaço com o emitente, e passando de uma linha
                   a esteira inteira volta a crescer. O detalhe
                   completo fica no `title`. */
                /* "global" saiu daqui também: o que é único no grupo
                   é a NOTA, não o valor. Dizer "global" ao lado de um
                   total que é soma de setores é a confusão que fez
                   alguém digitar o valor negociado inteiro numa
                   especialidade só. */
                l.eh_grupo
                  ? '<span title="nota única do grupo — o valor é a soma dos setores' +
                    (l.especialidades.length < (l.total_especialidades || 0)
                      ? ' · ' + l.especialidades.length + ' com lançamento no mês' : '') + '">nota única · ' +
                    (l.total_especialidades || l.especialidades.length) + ' setores</span>'
                  : U.esc(l.projeto.unidade || ''),
                linhaEmitente(l)
              ].filter(Boolean).join(' · ') + '</div></td>' +
            '<td class="mono">' + U.fComp(l.competencia) + '</td>' +
            /* Em que pé está a produtividade, e o valor que corresponde
               a esse estágio — sem misturar estimativa com o que já é
               firme. */

            /* Estimativa editável na própria esteira: quem opera o
               faturamento corrige o número sem sair da tela. Depois de
               confirmado, o valor deixa de ser estimativa e só muda
               pelo caminho da confirmação. */
            '<td class="num">' +
              /* NO GRUPO NÃO SE DIGITA O TOTAL.

                 Esta célula era um campo também na linha do grupo —
                 e o campo gravava em `l.centro`, que é UMA
                 especialidade (a primeira com valor). Quem digitava
                 o valor negociado do GHC inteiro jogava os dois
                 milhões na cardiologia e lia embaixo, em letra
                 miúda, "global do grupo". O valor do grupo é a SOMA
                 dos setores: aqui ele só se lê, e cada setor se
                 digita na sua própria linha (botão ▸). */
              (l.eh_grupo
                ? '<b>' + U.brl(l.valor) + '</b>'
                : (podeEditarEstimativa() && !l.confirmado_em && l.etapa !== 'faturado'
                    ? '<input class="num est-inline" data-est-val="' + U.esc(l.centro + '|' + l.competencia) +
                        '" inputmode="decimal" value="' + U.num(l.valor || 0) + '" ' +
                        'title="estimativa — Enter para salvar">'
                    : U.brl(l.valor))) +
              (l.eh_grupo
                ? '<div class="sub">soma de ' + (l.total_especialidades || l.especialidades.length) +
                  ' setores</div>'
                : '') +
              (l.documentos.length ? '<div class="sub">' + U.esc(l.documentos.join(', ')) + '</div>' : '') + '</td>' +
            passo(l, 'confirmado') + passo(l, 'autorizado') + passo(l, 'liberado') + passo(l, 'faturado') +
            '<td class="num' + (atrasado ? ' erro' : ' sub') + '">' +
              (l.etapa === 'faturado' ? '—' : l.dias + ' dias') + '</td>' +
            /* A célula dos botões ancorada à direita, como no contas
               a pagar: `<td class="col-acoes"><div class="acoes">`.
               Era `<td class="acoes">`, e a classe num `td` aplica
               `display:flex` — a célula deixava de ser célula e
               aparecia deslocada da própria linha, como um retângulo
               branco solto. */
            '<td class="col-acoes"><div class="acoes">' + acoesEsteira(l) + '</div></td></tr>' +
            /* As especialidades do grupo aparecem como filhas: a
               produtividade de cada uma continua visível, mas nenhuma
               delas fatura sozinha. */
            (l.eh_grupo && expandidos[l.grupo + '|' + l.competencia]
              ? l.especialidades.map(function (e) {
                  /* O VALOR DO SETOR SE DIGITA AQUI. Era só leitura,
                     e a única caixa de digitar ficava na linha do
                     grupo — isto é, não havia caminho nenhum para
                     informar quanto foi negociado por setor sem
                     abrir o modal de confirmação. */
                  return '<tr class="sub-linha"><td class="desc" style="padding-left:28px">' +
                    '<span class="sub">' + U.esc(e.projeto.curto) + '</span></td>' +
                    '<td class="mono sub">' + U.fComp(e.competencia) + '</td>' +
                    '<td class="num">' +
                      (podeEditarEstimativa() && !e.confirmado_em && e.etapa !== 'faturado'
                        ? '<input class="num est-inline" data-est-val="' +
                            U.esc(e.centro + '|' + e.competencia) + '" inputmode="decimal" value="' +
                            U.num(e.valor || 0) + '" title="valor deste setor — Enter para salvar">'
                        : '<span class="sub">' + U.brl(e.valor) + '</span>') + '</td>' +
                    '<td colspan="4" class="sub">' + U.esc(ETAPAS_NOME[e.etapa] || e.etapa) + '</td>' +
                    '<td class="num sub">' + (e.etapa === 'faturado' ? '—' : e.dias + ' dias') + '</td>' +
                    '<td class="sub">soma no grupo</td></tr>';
                }).join('')
              : '');
        }).join('')
          : '<tr><td colspan="8" class="vazio"><strong>Nada na esteira nesta competência.</strong></td></tr>') +
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
    /* TODAS as especialidades do grupo, não só as que lançaram
       produtividade no mês: a nota cobre o grupo inteiro, e uma
       especialidade fora da lista é uma que ninguém vai conseguir
       faturar. Para cada uma, o valor que já está previsto serve de
       ponto de partida. */
    const especialidadesDoGrupo = !grupo ? [] :
      S.projetosDoGrupo(grupo).map(function (id) {
        const pv = S.previsaoDe(id, par[1]);
        const st2 = S.statusProdutividade(id, par[1]);
        return { centro: id, projeto: D.centro(id) || { curto: id },
                 valor: pv ? pv.faturamento : 0, prodValor: st2 ? st2.valor : 0 };
      }).sort(function (a, b) {
        return String(a.projeto.curto || '').localeCompare(String(b.projeto.curto || ''), 'pt-BR');
      });
    const totalEspecialidades = especialidadesDoGrupo
      .reduce(function (t, e) { return Math.round((t + (e.valor || 0)) * 100) / 100; }, 0);
    /* O texto da nota COMO ESTÁ AGORA, e o que o sistema monta
       sozinho agora. Capturados na abertura de propósito: o padrão
       inclui o protocolo, e se a comparação fosse feita depois de
       gravar a autorização, o texto automático pareceria ter sido
       escrito à mão — e congelaria. */
    const discInicial = S.discriminacaoDaNota(par[0], par[1], grupo, '');
    const discPadrao = S.discriminacaoPadrao(par[0], par[1], grupo, '');
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
        /* GRUPO: UMA LINHA POR ESPECIALIDADE.

           O campo único pedia o total e o sistema repartia por peso
           adivinhado. Agora o número vem setor a setor, que é como
           ele é negociado — e o total é a soma, calculada na tela
           enquanto se digita. */
        (grupo
          ? '<div class="parcelas" style="margin-top:10px">' +
              '<div class="cab" style="grid-template-columns:1fr 150px">' +
                '<span>Especialidade</span><span class="num">Valor a faturar</span></div>' +
              especialidadesDoGrupo.map(function (e, ix) {
                return '<div class="lin" style="grid-template-columns:1fr 150px">' +
                  '<span>' + U.esc(e.projeto.curto || e.projeto.nome) +
                    (e.prodValor ? '<div class="sub">produtividade ' + U.brl(e.prodValor) + '</div>' : '') +
                  '</span>' +
                  '<input class="num" data-esp-val="' + ix + '" data-esp-centro="' + U.esc(e.centro) +
                    '" inputmode="decimal" value="' + U.num(e.valor || 0) + '">' +
                  '</div>';
              }).join('') +
              '<div class="rodape"><span class="sub">a nota é única — este é o total dela</span>' +
                '<span class="dif ok" id="es-esp-total">' + U.brl(totalEspecialidades) + '</span></div>' +
            '</div>' +
            '<div class="row2" style="margin-top:8px"><div></div>' +
              '<div><label>Protocolo / referência do órgão</label>' +
                '<input id="es-conf-prot" placeholder="ex.: Ofício 55/2026 — medição agosto"></div></div>'
          : '<div class="row2">' +
              '<div><label>Valor confirmado a faturar (R$) *</label>' +
                '<input class="num" id="es-valor" inputmode="decimal" value="' +
                U.num(l.valor || (l.previsao || {}).faturamento || 0) + '"></div>' +
              '<div><label>Protocolo / referência do órgão</label>' +
                '<input id="es-conf-prot" placeholder="ex.: Ofício 55/2026 — medição agosto"></div>' +
            '</div>') +
        /* A DISCRIMINAÇÃO JÁ VEM PREENCHIDA com o que vai sair se
           ninguém escrever nada. Em branco, a pessoa não tinha como
           saber que o sistema escreveria um texto por ela. */
        '<label>Discriminação — o texto que vai na NF</label>' +
        '<textarea id="es-conf-obs" rows="5" placeholder="competência, ofício, medição, plantões, ' +
          'o que o tomador exige ver na nota">' + U.esc(discInicial) + '</textarea>' +
        /* OS DOCUMENTOS QUE VÃO JUNTO. A AF do órgão e o relatório
           de escala chegam agora, junto com o valor — e não no dia
           de montar o e-mail para o cliente.

           Só para quem MOVIMENTA faturamento, que é a mesma regra
           que o servidor aplica ao arquivo: um campo oferecido a
           quem o banco vai recusar é um campo que mente. */
        (S.podeMover('faturamento')
          ? '<div class="row2" style="margin-top:8px">' +
              '<div><label>Anexar documentos do faturamento</label>' +
                '<input type="file" id="es-conf-arq" multiple style="border:none;padding:0"></div>' +
              '<div><label>Classificar (opcional)</label><select id="es-conf-arq-tipo">' +
                TIPOS_ANEXO_FAT.map(function (x) {
                  return '<option value="' + x[0] + '">' + U.esc(x[1]) + '</option>';
                }).join('') + '</select></div>' +
            '</div>'
          : '') +
        '<div class="ajuda" id="es-conf-aviso">A AF do órgão, o relatório de escala e a medição vão ' +
          'junto com a nota no envio ao cliente — guardados aqui, saem daqui. Dá para anexar mais ' +
          'depois, em <b>Ver / editar</b>. Ao autorizar, o faturamento já fica liberado para o RPS ' +
          'em lote — não precisa de uma segunda pessoa.</div>',
      acoes: [
        { txt: 'Só confirmar o valor', cls: 'btn-sm', fn: function () { aplicar(false); } },
        { txt: 'Confirmar e autorizar', cls: 'btn-aprovar', fn: function () { aplicar(true); } }
      ],
      aoAbrir: function () {
        /* O total do grupo acompanha a digitação. Só no fim ele
           apareceria tarde: quem reparte um valor negociado precisa
           ver a soma fechar enquanto reparte. */
        const somar = function () {
          const t = Array.prototype.slice.call(document.querySelectorAll('[data-esp-val]'))
            .reduce(function (a, e) {
              return Math.round((a + U.parseValor(e.value)) * 100) / 100; }, 0);
          const el = U.el('es-esp-total');
          if (el) el.textContent = U.brl(t);
        };
        document.querySelectorAll('[data-esp-val]').forEach(function (e) {
          e.addEventListener('input', somar);
        });
      }
    });
    function lerEspecialidades() {
      return Array.prototype.slice.call(document.querySelectorAll('[data-esp-val]'))
        .map(function (e) {
          return { centro: e.dataset.espCentro, valor: U.parseValor(e.value) };
        });
    }

    /* O TEXTO DA NOTA E O ANEXO, depois que o valor passou. Nesta
       ordem de propósito: se o valor for recusado, não fica anexo
       órfão nem texto gravado para um faturamento que não existe.

       O texto só é gravado quando é DIFERENTE do que o sistema
       monta sozinho — assim a frase automática continua
       acompanhando o protocolo e a composição em vez de congelar. */
    async function gravarTextoEAnexo() {
      const escrito = U.val('es-conf-obs').trim();
      const intocado = escrito === String(discInicial).trim();
      const eraDoSistema = String(discInicial).trim() === String(discPadrao).trim();
      S.definirDiscriminacao(par[0], par[1], intocado && eraDoSistema ? '' : escrito);
      const campo = U.el('es-conf-arq');
      const arquivos = campo && campo.files ? Array.prototype.slice.call(campo.files) : [];
      if (!arquivos.length) return { ok: true };
      const tipo = U.val('es-conf-arq-tipo') || 'outro';
      const falhou = [];
      let n = 0;
      for (let i = 0; i < arquivos.length; i++) {
        const sub = await subirArquivo(arquivos[i], par[0] + '-' + par[1], 'es-conf-aviso');
        if (sub.erro) { falhou.push(arquivos[i].name); continue; }
        const r = S.anexarAoFaturamento(par[0], par[1], Object.assign({ tipo: tipo }, sub.anexo));
        if (r.erro) { falhou.push(arquivos[i].name); continue; }
        n++;
      }
      return { ok: true, anexou: n ? n + ' documento(s)' : '',
        aviso: falhou.length ? 'Valor gravado, mas NÃO entraram: ' + falhou.join(', ') : '' };
    }

    async function aplicar(autorizar) {
      /* No grupo, a confirmação é das SETE de uma vez — e ou passam
         todas ou não passa nenhuma. Depois dela, a autorização
         continua sendo o caminho de sempre, por uma especialidade:
         a etapa é do conjunto. */
      if (grupo) {
        const partes = lerEspecialidades();
        const r = S.confirmarFaturamentoEspecialidades(grupo, par[1], partes, {});
        if (ERP.app.erroDoRetorno(r)) return;
        if (autorizar) {
          /* Autoriza por uma especialidade COM VALOR: a etapa do
             grupo é a menor entre elas, e autorizar uma que ficou
             em zero não moveria o grupo. */
          const comValor = (r.partes || [])[0];
          const a = S.autorizarFaturamento((comValor || {}).centro || par[0], par[1],
            { protocolo: U.val('es-conf-prot'), sem_produtividade: true });
          if (a.erro) {
            ERP.app.aviso('Valores confirmados, mas a autorização não passou: ' + a.erro, 'erro');
            ERP.app.fecharModal(); renderEsteira(); return;
          }
        }
        const extra = await gravarTextoEAnexo();
        ERP.app.fecharModal();
        renderEsteira();
        ERP.receber.render();
        ERP.app.aviso((autorizar ? 'Autorizado. ' : '') + 'Total do grupo ' + U.brl(r.total) +
          ' em ' + r.partes.length + ' especialidade(s).' +
          (extra.anexou ? ' ' + extra.anexou + ' anexado(s).' : '') +
          (extra.aviso ? ' ' + extra.aviso : ''), extra.aviso ? 'erro' : 'ok');
        return;
      }
      const r = S.confirmarEAutorizarFaturamento({
        centro: par[0], competencia: par[1],
        faturamento: U.parseValor(U.val('es-valor')),
        autorizar: autorizar,
        confirmar_sem_produtividade: U.el('es-sem-prod') ? U.el('es-sem-prod').checked : true,
        protocolo: U.val('es-conf-prot')
      });
      if (ERP.app.erroDoRetorno(r)) return;
      const extra = await gravarTextoEAnexo();
      ERP.app.fecharModal();
      renderEsteira();
      ERP.receber.render();
      ERP.app.aviso((autorizar
        ? 'Valor confirmado e faturamento autorizado — já liberado para o RPS em lote.'
        : 'Valor confirmado.') +
        (extra.anexou ? ' ' + extra.anexou + ' anexado(s).' : '') +
        (extra.aviso ? ' ' + extra.aviso : ''), extra.aviso ? 'erro' : 'ok');
    }
  }

  /* O emitente da linha, em uma linha de texto. Marcado quando é
     EXCEÇÃO da competência: regra e exceção lidas igual seriam o
     mesmo que não mostrar nada. */
  function linhaEmitente(l) {
    if (!l.centro) return '';
    const emp = S.empresaEmissora(l.centro, l.competencia);
    const origem = S.origemDaEmpresaEmissora(l.centro, l.competencia);
    const excecao = origem === 'escolhido nesta competência';
    const podeTrocar = l.etapa !== 'faturado' &&
      (S.pode('faturar') || S.pode('autorizar_faturamento') || S.pode('admin'));
    return '<span title="origem: ' + U.esc(origem) + '">emite: ' +
      '<b' + (excecao ? ' class="erro"' : '') + '>' + U.esc(S.apelidoEmpresa(emp)) + '</b>' +
      (excecao ? ' <span class="badge b-aguardando">exceção do mês</span>' : '') +
      (podeTrocar
        ? ' <button class="btn-ghost" data-est-emp="' + U.esc(l.centro + '|' + l.competencia) +
          '" title="trocar o CNPJ que emite esta nota">trocar</button>'
        : '') + '</span>';
  }

  /* Trocar o emitente de UMA competência. O cadastro do cliente
     continua como está — é exceção, não mudança de regra. */
  function trocarEmitente(ref) {
    const par = ref.split('|');
    const c = D.centro(par[0]) || {};
    const atual = S.empresaEmissora(par[0], par[1]);
    const origem = S.origemDaEmpresaEmissora(par[0], par[1]);
    const cli = D.clienteDoCentro(par[0]);
    ERP.app.modal({
      titulo: 'CNPJ que emite a nota · ' + U.esc(c.curto || c.nome || ''),
      fecharTxt: 'Cancelar',
      corpo:
        '<div class="resumo-linha"><span>Competência</span><span class="v">' + U.fComp(par[1]) + '</span></div>' +
        '<div class="resumo-linha"><span>Cliente</span><span class="v">' +
          U.esc(cli ? cli.nome : '— sem cliente amarrado —') + '</span></div>' +
        '<div class="resumo-linha"><span>Hoje emite</span><span class="v">' +
          U.esc(S.apelidoEmpresa(atual)) + ' <span class="sub">(' + U.esc(origem) + ')</span></span></div>' +
        (c.grupo_faturamento
          ? '<div class="ajuda">A nota do grupo <b>' + U.esc(c.grupo_faturamento) + '</b> é única: a ' +
            'escolha vale para todas as especialidades dele nesta competência.</div>'
          : '') +
        '<label style="margin-top:10px" for="emp-nova">Emitir esta competência por</label>' +
        '<select id="emp-nova">' +
          '<option value="">— seguir o cadastro (' + U.esc(S.apelidoEmpresa(
            cli && cli.empresa ? cli.empresa : S.empresaDoCentro(par[0]))) + ') —</option>' +
          D.empresas.filter(function (e) { return e.ativo !== false; }).map(function (e) {
            const pv = S.previsaoDe(par[0], par[1]);
            const marcado = pv && pv.empresa_emissora === e.id;
            return '<option value="' + e.id + '"' + (marcado ? ' selected' : '') + '>' +
              U.esc(e.apelido + ' · ' + e.cnpj) + '</option>';
          }).join('') + '</select>' +
        '<div class="ajuda">Para mudar de vez, troque no cadastro do cliente — ali vale para todo mês.</div>',
      acoes: [{ txt: 'Gravar', cls: 'btn-aprovar', fn: function () {
        const r = S.definirEmpresaEmissora(par[0], par[1], U.val('emp-nova') || null);
        if (ERP.app.erroDoRetorno(r)) return;
        ERP.app.fecharModal();
        renderEsteira();
        ERP.app.aviso(r.empresa
          ? 'Esta competência passa a emitir por ' + S.apelidoEmpresa(r.empresa) + '.'
          : 'Volta a seguir o cadastro.', 'ok');
      } }]
    });
  }

  /* A nota que já foi emitida em outro lugar entra aqui e fecha o
     faturamento. Os dados vêm do documento que a pessoa tem na
     mão; o sistema só confere o que pode conferir. */
  function anexarNFEmitida(ref) {
    const par = ref.split('|');
    const c = D.centro(par[0]) || {};
    const l = S.esteiraFaturamento({ centro: par[0], competencia: par[1], sem_agrupar: true })[0] || {};
    const grupo = c.grupo_faturamento || null;
    const linhaGrupo = grupo ? S.esteiraFaturamento({ competencia: par[1] })
      .find(function (x) { return x.eh_grupo && x.grupo === grupo; }) : null;
    const sugerido = grupo ? (linhaGrupo || {}).valor : (l.valor || (l.previsao || {}).faturamento || 0);
    const emp = D.empresaPor(S.empresaEmissora(par[0], par[1])) || {};
    let arquivo = null;
    ERP.app.modal({
      titulo: 'Anexar NF emitida · ' + U.esc(grupo || c.curto || c.nome || ''),
      fecharTxt: 'Cancelar',
      corpo:
        '<div class="ajuda">Para a nota que foi emitida <b>fora deste sistema</b> — pelo portal da ' +
          'prefeitura da filial, por exemplo. Informe os dados do documento e anexe o arquivo: ' +
          'é o que fecha este faturamento.</div>' +
        '<div class="resumo-linha"><span>Competência</span><span class="v">' + U.fComp(par[1]) + '</span></div>' +
        (grupo ? '<div class="resumo-linha"><span>Faturamento</span><span class="v">único do grupo ' +
          U.esc(grupo) + ' — a nota é rateada entre as especialidades</span></div>' : '') +
        '<div class="resumo-linha"><span>Emitida por</span><span class="v">' +
          U.esc(emp.apelido || '—') + ' <span class="sub">' + U.esc(emp.cnpj || '') + '</span></span></div>' +
        '<div class="row3" style="margin-top:8px">' +
          '<div><label>Número da NF *</label><input id="nfe-num"></div>' +
          '<div><label>Série</label><input id="nfe-serie"></div>' +
          '<div><label>Emissão *</label><input type="date" id="nfe-emissao" value="' + U.hoje() + '"></div>' +
        '</div>' +
        '<div class="row3">' +
          '<div><label>Valor da nota (R$) *</label><input class="num" id="nfe-valor" inputmode="decimal" value="' +
            U.num(sugerido || 0) + '"></div>' +
          '<div><label>Vencimento</label><input type="date" id="nfe-venc"></div>' +
          '<div><label>Chave de acesso</label><input id="nfe-chave" placeholder="se houver"></div>' +
        '</div>' +
        '<label>Discriminação (como saiu na nota)</label>' +
        '<textarea id="nfe-disc" rows="3" placeholder="o texto que consta no documento">' +
          U.esc(S.discriminacaoDaNota(par[0], par[1], grupo, '')) + '</textarea>' +
        '<label style="margin-top:8px">Arquivo da nota (PDF ou XML) *</label>' +
        '<input type="file" id="nfe-arq" accept=".pdf,.xml,.jpg,.jpeg,.png" style="border:none;padding:0">' +
        '<div class="ajuda" id="nfe-aviso">O valor sugerido é o que a esteira confirmou. Se a nota saiu por outro ' +
          'valor, informe o da nota — é ele que vai para o contas a receber.</div>',
      acoes: [{ txt: 'Anexar e fechar o faturamento', cls: 'btn-aprovar', fn: async function () {
        const arq = U.el('nfe-arq').files && U.el('nfe-arq').files[0];
        if (arq) {
          /* O arquivo vai para o balde privado, como todo documento
             do sistema. Na v141 ele era gravado em base64 dentro do
             próprio título do a receber: funcionava, e carregava um
             PDF inteiro em toda abertura do contas a receber. */
          const sub = await subirArquivo(arq, par[0] + '-' + par[1], 'nfe-aviso');
          if (sub.erro) return ERP.app.aviso(sub.erro, 'erro');
          arquivo = sub.anexo;
        }
        const r = S.anexarNotaEmitida({
          centro: par[0], competencia: par[1],
          numero: U.val('nfe-num'), serie: U.val('nfe-serie'),
          emissao: U.val('nfe-emissao'), vencimento: U.val('nfe-venc'),
          valor: U.parseValor(U.val('nfe-valor')), chave: U.val('nfe-chave'),
          discriminacao: U.val('nfe-disc'), arquivo: arquivo
        });
        if (ERP.app.erroDoRetorno(r)) return;
        ERP.app.fecharModal();
        renderEsteira();
        atualizarAlertaFat();
        ERP.receber.render();
        ERP.app.aviso('NF ' + r.receber.numero + ' anexada — faturamento fechado (' +
          U.brl(r.receber.valor_bruto) + ').' + (r.aviso ? ' ' + r.aviso : ''), 'ok');
      } }]
    });
  }

  /* ── o arquivo vai para o balde privado ──────────────────
     Mesma mecânica dos anexos de contrato e do cofre de
     habilitação: balde privado, link assinado de curta duração,
     nada público. O registro guarda o caminho, nunca o arquivo. */
  const BALDE_FAT = 'faturamento';
  async function subirArquivo(file, pasta, idAviso) {
    const cli = (ERP.auth && ERP.auth.cliente && ERP.auth.cliente()) || null;
    if (!cli) {
      return { erro: 'Sem conexão com o banco — o arquivo precisa do servidor para ser guardado.' };
    }
    const aviso = idAviso ? U.el(idAviso) : null;
    if (aviso) aviso.textContent = 'enviando ' + file.name + '…';
    /* Nome limpo: acento, espaço e barra em nome de objeto no balde
       são fonte certa de arquivo que sobe e não abre. */
    const limpo = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
    const caminho = String(pasta).replace(/[^\w.\-]+/g, '_') + '/' +
      Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '-' + limpo;
    const sub = await cli.storage.from(BALDE_FAT)
      .upload(caminho, file, { contentType: file.type || 'application/octet-stream' });
    if (sub.error) {
      if (aviso) aviso.textContent = '';
      return { erro: 'Não enviou: ' + sub.error.message };
    }
    return { anexo: { nome: file.name, path: caminho, tamanho: file.size,
      tipo_arquivo: file.type || '' } };
  }

  /* ── ver e editar o faturamento antes de emitir ──────────
     A gestora, a diretoria e quem responde pela produtividade
     lançam o valor, escrevem o texto da nota e autorizam — tudo
     dentro de modais que fecham. Desta tela em diante, o que foi
     lançado se olha de novo, inteiro, e se corrige.

     O que ela mostra é exatamente o que vai sair: a discriminação
     daqui é a mesma que o gerador de RPS escreve no arquivo. */
  /* "Sem classificação" É A PRIMEIRA e é o padrão: classificar é
     útil para quem procura depois, e não pode ser condição para
     guardar o arquivo. */
  const TIPOS_ANEXO_FAT = [
    ['outro', 'Sem classificação'],
    ['af', 'Autorização de fornecimento (AF)'],
    ['escala', 'Relatório de escala'],
    ['medicao', 'Medição / relatório do órgão'],
    ['oficio', 'Ofício / e-mail de autorização'],
    /* v157: só alguns clientes exigem, mas quando exigem a nota não
       vale sem ele — por isso é tipo próprio e não "Sem
       classificação". */
    ['boleto', 'Boleto']
  ];

  function revisarFaturamento(ref) {
    const par = String(ref).split('|');
    const d = S.dossieFaturamento(par[0], par[1]);
    if (d.erro) return ERP.app.aviso(d.erro, 'erro');
    const edita = d.pode_editar;
    /* Quem altera o VALOR tem guarda própria (é medição, não texto):
       a mesma do store, para a tela não oferecer o que ele recusa. */
    const editaSetor = !!d.grupo && !d.travado_por_nota &&
      (S.pode('faturar') || S.pode('lancar') || S.pode('produtividade'));
    const naoEdita = !edita
      ? (d.travado_por_nota
          ? 'A nota já foi emitida: o que está escrito aqui é o que foi para o documento. ' +
            'Para mudar, cancele a nota.'
          : 'Seu perfil vê o faturamento, mas não altera o que vai na nota.')
      : '';

    const linha = (rotulo, valor) =>
      '<div class="resumo-linha"><span>' + rotulo + '</span><span class="v">' + valor + '</span></div>';
    const carimbo = (rotulo, em, por) =>
      '<div class="resumo-linha"><span>' + rotulo + '</span><span class="v">' +
        (em ? U.fData(em) + (por ? ' <span class="sub">por ' + U.esc(String(por).split(' ')[0]) +
          '</span>' : '') : '<span class="sub">—</span>') + '</span></div>';

    ERP.app.modal({
      titulo: 'Faturamento · ' + U.esc(d.grupo || d.projeto.curto || d.projeto.nome || '') +
        ' · ' + U.fComp(d.competencia),
      fecharTxt: 'Fechar',
      corpo:
        (naoEdita ? '<div class="ajuda">' + naoEdita + '</div>' : '') +
        linha('Cliente', U.esc(d.cliente ? d.cliente.nome : '— sem cliente amarrado —')) +
        linha('Emite esta nota', '<b>' + U.esc(d.empresa_apelido) + '</b> <span class="sub">(' +
          U.esc(d.empresa_origem) + ')</span>') +
        linha('Etapa', U.esc(ETAPAS_NOME[d.etapa] || d.etapa)) +
        linha('Valor a faturar', '<b>' + U.brl(d.valor) + '</b>') +
        linha('Produtividade lançada', d.lotes
          ? U.brl(d.produtividade) + ' <span class="sub">em ' + d.lotes + ' fechamento(s)</span>'
          : '<span class="erro">nenhuma</span>') +

        /* A COMPOSIÇÃO. No grupo é o que mais se procura aqui: qual
           especialidade entrou com quanto nesta nota única. */
        /* O VALOR DE CADA SETOR, DIGITÁVEL AQUI.

           Esta grade era só leitura, e embaixo dela dizia "para
           corrigir, use Corrigir valor na esteira" — onde o único
           campo que existia era o do TOTAL do grupo. Quem abria para
           repartir os dois milhões do GHC por setor não tinha,
           em nenhuma das duas telas, onde digitar o valor de um
           setor. O total do grupo deixou de ser campo: é a soma
           que aparece no rodapé, acompanhando a digitação. */
        (d.grupo
          ? '<div class="parcelas" style="margin-top:10px">' +
              '<div class="cab" style="grid-template-columns:1fr 130px 130px">' +
                '<span>Setor</span><span class="num">A faturar</span>' +
                '<span class="num">Produtividade</span></div>' +
              d.partes.map(function (p) {
                return '<div class="lin" style="grid-template-columns:1fr 130px 130px">' +
                  '<span>' + U.esc(p.projeto.curto || p.projeto.nome || '') + '</span>' +
                  (editaSetor
                    ? '<span class="num"><input class="num" data-rv-setor="' + U.esc(p.centro) +
                      '" inputmode="decimal" value="' + U.num(p.valor || 0) + '" ' +
                      'title="valor negociado deste setor"></span>'
                    : '<span class="num">' + U.brl(p.valor) + '</span>') +
                  '<span class="num sub">' + (p.produtividade ? U.brl(p.produtividade) : '—') + '</span>' +
                  '</div>';
              }).join('') +
              '<div class="rodape"><span class="sub">a nota é única — o total dela é a soma dos setores' +
                '</span><span class="dif ok" id="rv-setor-total">' + U.brl(d.valor) + '</span></div>' +
            '</div>' +
            '<div class="ajuda">' + (editaSetor
              ? 'O valor é negociado por setor: digite cada um e o total da nota se forma pela soma. ' +
                'Não existe campo para o valor global — ele seria repartido por palpite, e é esse ' +
                'número que vai para o resultado de cada projeto.'
              : (d.travado_por_nota
                  ? 'A nota já foi emitida: para mudar o valor de um setor, cancele a nota primeiro.'
                  : 'Seu perfil vê a composição, mas não altera o valor dos setores.')) + '</div>'
          : '') +

        /* O TEXTO QUE VAI NA NOTA. É a pergunta que ele fez: "o que
           foi escrito para descrição da NF?". */
        '<label style="margin-top:12px">Discriminação — o texto que vai na NF</label>' +
        '<textarea id="rv-disc" rows="5"' + (edita ? '' : ' readonly') + ' placeholder="' +
          'competência, ofício, medição, plantões — o que o tomador exige ver na nota">' +
          U.esc(d.discriminacao) + '</textarea>' +
        /* O TEXTO LANÇADO ANTES DA ATUALIZAÇÃO, quando existe. Era
           onde o sistema parecia ter comido o que a pessoa escreveu:
           o texto continuava no banco, no campo antigo, e a tela
           mostrava a frase automática por cima dele. */
        (d.discriminacao_candidata
          ? '<div class="aviso-linha" style="margin-top:6px">' +
              '<b>Há outro texto lançado neste faturamento</b>, no campo de observação, antes da ' +
              'atualização que separou os dois campos. Confira se é ele que deve ir na nota:' +
              '<div class="mono" style="white-space:normal;margin:6px 0;padding:6px;' +
                'background:#fff;border:1px solid var(--line);border-radius:3px;font-size:11px">' +
                U.esc(d.discriminacao_candidata) + '</div>' +
              (edita ? '<button class="btn-sm" id="rv-usar-antigo">Usar este texto na nota</button>' : '') +
            '</div>'
          : '') +
        /* A FOLHA DE EMISSÃO sai daqui também: esta é a tela onde a
           pessoa confere os dados, e emitir à mão é o que ela faz em
           seguida quando a nota não sai pelo sistema. */
        '<div class="ajuda" style="margin-top:6px">Vai emitir esta nota no portal da prefeitura, à ' +
          'mão? <button class="btn-sm" id="rv-pdf">Gerar folha de emissão (PDF)</button> ' +
          '<span class="sub">— cliente, CNPJ emissor, valor, retenções e a descrição, ' +
          'na ordem em que o portal pergunta.</span></div>' +
        '<div class="ajuda">' +
          (d.discriminacao_origem === 'escrita'
            ? 'Este texto foi <b>escrito à mão</b> e é o que sai no arquivo de RPS.'
            : d.discriminacao_origem === 'antiga'
              ? 'Este texto foi <b>lançado antes da atualização</b>, no campo da autorização — está ' +
                'sendo usado na nota. Grave aqui para fixá-lo no campo novo.'
              : 'Ninguém escreveu nada ainda: este é o texto que o <b>sistema monta sozinho</b>. ' +
                'O que for digitado aqui passa a valer no lugar dele.') +
          (edita && d.discriminacao_origem !== 'sistema'
            ? ' <button class="btn-ghost" id="rv-padrao">voltar ao texto do sistema</button>' : '') +
        '</div>' +

        '<div class="row2" style="margin-top:8px">' +
          '<div><label>Protocolo / referência do órgão</label>' +
            '<input id="rv-prot"' + (edita ? '' : ' readonly') + ' value="' + U.esc(d.protocolo) +
            '" placeholder="ex.: Ofício 55/2026 — medição agosto"></div>' +
          '<div><label>Vencimento previsto</label>' +
            '<input type="date" id="rv-venc"' + (edita ? '' : ' readonly') + ' value="' +
            U.esc(d.vencimento || '') + '"></div>' +
        '</div>' +

        (d.retencoes.length
          ? '<div class="ajuda">Retenções previstas: ' + d.retencoes.map(function (r) {
              return U.esc(r.tributo) + ' ' + U.num(r.aliquota) + '% (' + U.brl(r.valor) + ')';
            }).join(' · ') + '</div>'
          : '<div class="ajuda">Sem retenção cadastrada para este tomador.</div>') +

        /* OS DOCUMENTOS QUE VÃO JUNTO COM A NOTA. */
        '<div style="margin-top:12px;padding-top:8px;border-top:1px solid #e6e9ee">' +
          '<b>Documentos deste faturamento</b>' +
          (S.podeMover('faturamento')
            ? ' <button class="btn-sm" id="rv-anexar">+ anexar</button>' : '') +
          (d.anexos.length || d.documentos.length
            ? ' <button class="btn-sm" id="rv-baixar">Baixar tudo</button>' : '') +
          '<div class="ajuda">A nota não vai sozinha para o cliente: a AF do órgão, o relatório de ' +
            'escala e a medição vão junto. Guardados aqui, saem daqui — ninguém precisa procurar no ' +
            'e-mail de quem montou o envio.</div>' +
          (d.documentos.length
            ? '<ul class="historico">' + d.documentos.map(function (doc) {
                return '<li><span class="badge b-pago">NF ' + U.esc(doc.numero || '') + '</span> ' +
                  (doc.arquivo && doc.arquivo.path
                    ? '<span class="mono">' + U.esc(doc.arquivo.nome) + '</span> ' +
                      '<button class="btn-sm" data-rv-ver="' + U.esc(doc.arquivo.path) + '|' +
                      U.esc(doc.arquivo.nome) + '">Ver</button>'
                    : '<span class="sub">emitida pelo sistema — sem arquivo anexado</span>') +
                  ' <span class="sub">· ' + U.brl(doc.valor) + '</span></li>';
              }).join('') + '</ul>'
            : '') +
          (d.anexos.length
            ? '<ul class="historico">' + d.anexos.map(function (an) {
                return '<li><span class="badge b-aguardando">' + U.esc(S.nomeTipoAnexoFat(an.tipo)) +
                  '</span> <span class="mono">' + U.esc(an.nome) + '</span>' +
                  (an.em ? ' <span class="sub">· ' + U.fData(String(an.em).slice(0, 10)) +
                    (an.por ? ' por ' + U.esc(String(an.por).split(' ')[0]) : '') + '</span>' : '') +
                  ' <button class="btn-sm" data-rv-ver="' + U.esc(an.path) + '|' + U.esc(an.nome) +
                  '">Ver</button>' +
                  (S.podeMover('faturamento') && !d.travado_por_nota
                    ? ' <button class="btn-sm btn-cancelar" data-rv-del="' + U.esc(an.id) +
                      '">Remover</button>' : '') + '</li>';
              }).join('') + '</ul>'
            : '<div class="sub">Nenhum documento anexado.</div>') +
        '</div>' +

        '<div style="margin-top:12px;padding-top:8px;border-top:1px solid #e6e9ee">' +
          '<b>Quem fez o quê</b>' +
          carimbo('Valor confirmado', d.confirmado_em, d.confirmado_por) +
          carimbo('Autorizado pelo órgão', d.autorizado_em, d.autorizado_por) +
          carimbo('Liberado para faturar', d.liberado_em, d.liberado_por) +
        '</div>' +
        (d.historico.length
          ? '<div style="margin-top:10px"><b>Histórico</b><ul class="historico">' +
              d.historico.slice(0, 12).map(function (e) {
                /* `e.em` é um Date, e `String(Date).slice(0,10)` dá
                   "Tue Nov 03" — data em inglês, no formato errado,
                   numa casa em que data é sempre dd/mm/aaaa.
                   `dataLocal` converte antes de formatar. */
                return '<li><span class="sub">' + U.fData(U.dataLocal(e.em)) + '</span> ' +
                  U.esc(e.acao) + ' <span class="sub">— ' + U.esc(e.usuario || '') +
                  (e.detalhe ? ' · ' + U.esc(String(e.detalhe).slice(0, 110)) : '') + '</span></li>';
              }).join('') + '</ul></div>'
          : ''),
      acoes: edita
        ? [{ txt: 'Gravar alterações', cls: 'btn-aprovar', fn: function () {
            /* O VALOR POR SETOR PRIMEIRO, e tudo-ou-nada: se ele for
               recusado (nota emitida, setor fora do grupo), nada mais
               é gravado — senão o texto da nota ficaria descrevendo
               uma composição que não passou. */
            if (editaSetor) {
              const setores = Array.prototype.slice.call(document.querySelectorAll('[data-rv-setor]'))
                .map(function (e) { return { centro: e.dataset.rvSetor, valor: U.parseValor(e.value) }; });
              const mudou = setores.some(function (x) {
                const p = (d.partes || []).find(function (y) { return y.centro === x.centro; });
                return !p || Math.abs(x.valor - (p.valor || 0)) > 0.004;
              });
              if (mudou) {
                const rs = S.valoresPorSetor(d.grupo, par[1], setores, {});
                if (ERP.app.erroDoRetorno(rs)) return;
              }
            }
            const r = S.editarFaturamento({
              centro: par[0], competencia: par[1],
              /* Texto igual ao que o sistema monta sozinho não vira
                 texto escrito: senão, a frase do sistema congelaria
                 na previsão e pararia de acompanhar o protocolo e a
                 composição quando eles mudassem. */
              discriminacao: U.val('rv-disc').trim() === String(d.discriminacao_padrao).trim()
                ? '' : U.val('rv-disc').trim(),
              protocolo: U.val('rv-prot'),
              vencimento: U.val('rv-venc')
            });
            if (ERP.app.erroDoRetorno(r)) return;
            ERP.app.fecharModal();
            renderEsteira();
            ERP.receber.render();
            const dpois = S.dossieFaturamento(par[0], par[1]);
            ERP.app.aviso((r.mudou.length ? 'Gravado: ' + r.mudou.join(', ') + '.' : 'Nada mudou.') +
              (d.grupo && !dpois.erro ? ' Total do ' + d.grupo + ': ' + U.brl(dpois.valor) + '.' : ''), 'ok');
          } }]
        : [],
      aoAbrir: function () { ligarRevisao(par, d); }
    });
  }

  function ligarRevisao(par, d) {
    /* A SOMA ACOMPANHA A DIGITAÇÃO. Quem reparte um valor negociado
       precisa ver o total fechar enquanto reparte — no fim ele
       apareceria tarde, depois de gravar. */
    const somarSetores = function () {
      const t = Array.prototype.slice.call(document.querySelectorAll('[data-rv-setor]'))
        .reduce(function (a, e) { return Math.round((a + U.parseValor(e.value)) * 100) / 100; }, 0);
      const el = U.el('rv-setor-total');
      if (el) el.textContent = U.brl(t);
    };
    document.querySelectorAll('[data-rv-setor]').forEach(function (e) {
      e.addEventListener('input', somarSetores);
    });
    const padrao = U.el('rv-padrao');
    if (padrao) {
      padrao.addEventListener('click', function () {
        const t = U.el('rv-disc');
        if (t) { t.value = d.discriminacao_padrao; t.focus(); }
      });
    }
    document.querySelectorAll('[data-rv-ver]').forEach(function (b) {
      b.addEventListener('click', function () {
        const p = this.dataset.rvVer.split('|');
        ERP.app.verDocumento({ bucket: BALDE_FAT, path: p[0], nome: p[1],
          titulo: 'Faturamento · ' + U.fComp(par[1]) });
      });
    });
    document.querySelectorAll('[data-rv-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = this.dataset.rvDel;
        const an = (d.anexos || []).find(function (x) { return x.id === id; });
        ERP.app.modal({
          titulo: 'Remover documento',
          fecharTxt: 'Voltar',
          corpo: '<p>Remover <b>' + U.esc((an || {}).nome || '') + '</b> deste faturamento?</p>' +
            '<div class="ajuda">O arquivo sai do faturamento e do servidor. Se ele for a única cópia ' +
            'da AF, não há como recuperá-la depois.</div>',
          acoes: [{ txt: 'Remover', cls: 'btn-cancelar', fn: async function () {
            const cli = (ERP.auth && ERP.auth.cliente && ERP.auth.cliente()) || null;
            if (cli && an && an.path) await cli.storage.from(BALDE_FAT).remove([an.path]);
            const r = S.removerAnexoDoFaturamento(par[0], par[1], id);
            if (ERP.app.erroDoRetorno(r)) return;
            ERP.app.fecharModal();
            revisarFaturamento(par.join('|'));
            ERP.app.aviso('Documento removido.', 'ok');
          } }]
        });
      });
    });
    const anexar = U.el('rv-anexar');
    if (anexar) {
      anexar.addEventListener('click', function () { anexarAoFaturamento(par); });
    }
    const baixar = U.el('rv-baixar');
    if (baixar) {
      baixar.addEventListener('click', function () { baixarPacote(par); });
    }
    const folha = U.el('rv-pdf');
    if (folha) {
      folha.addEventListener('click', function () { pdfEmissaoManual(par.join('|')); });
    }
    const antigo = U.el('rv-usar-antigo');
    if (antigo) {
      antigo.addEventListener('click', function () {
        const t = U.el('rv-disc');
        if (t) { t.value = d.discriminacao_candidata; t.focus(); }
        ERP.app.aviso('Texto copiado para o campo. Confira e grave para que ele vá na nota.', 'ok');
      });
    }
  }

  /* VÁRIOS ARQUIVOS DE UMA VEZ, e sem obrigar a classificar. Quem
     monta o envio ao cliente tem a AF, a escala e a medição na
     mesma pasta: escolher um, classificar, gravar, abrir de novo —
     três vezes — é trabalho que o sistema estava criando. A
     classificação continua existindo para quem quiser usá-la, como
     escolha, não como pedágio. */
  function anexarAoFaturamento(par) {
    ERP.app.modal({
      titulo: 'Anexar ao faturamento · ' + U.fComp(par[1]),
      fecharTxt: 'Cancelar',
      corpo:
        '<label>Arquivos *</label>' +
        '<input type="file" id="ax-arq" multiple style="border:none;padding:0">' +
        '<div class="ajuda">Dá para marcar vários de uma vez (Ctrl ou Shift na janela do ' +
          'Windows). Todos entram neste faturamento.</div>' +
        '<label style="margin-top:8px">Classificar (opcional)</label>' +
        '<select id="ax-tipo">' +
          TIPOS_ANEXO_FAT.map(function (x) {
            return '<option value="' + x[0] + '"' + (x[0] === 'outro' ? ' selected' : '') + '>' +
              U.esc(x[1]) + '</option>';
          }).join('') + '</select>' +
        /* v157: o cliente que exige boleto é lembrado AQUI, que é
           onde a nota está sendo anexada — e não depois, quando o
           financeiro liga perguntando por ele. */
        (S.faltaBoleto(par[0], par[1])
          ? '<div class="aviso" style="margin-top:8px"><b>Este cliente exige boleto</b> junto com a ' +
            'nota, e ainda não há boleto neste faturamento. Anexe-o agora, classificando como ' +
            '<b>Boleto</b>.</div>'
          : '') +
        '<div class="ajuda" id="ax-aviso">Os arquivos ficam em pasta privada no servidor: abrem por ' +
          'link temporário, para quem tem o módulo de Faturamento. São eles que vão junto com a nota ' +
          'no envio ao cliente.</div>',
      acoes: [{ txt: 'Anexar', cls: 'btn-aprovar', fn: async function () {
        const campo = U.el('ax-arq');
        const arquivos = campo && campo.files ? Array.prototype.slice.call(campo.files) : [];
        if (!arquivos.length) return ERP.app.aviso('Escolha ao menos um arquivo.', 'erro');
        const tipo = U.val('ax-tipo') || 'outro';
        const falhou = [];
        let n = 0;
        /* UM DE CADA VEZ, e o que falhar é nomeado. Subir tudo em
           paralelo e dizer "deu erro" deixaria a pessoa sem saber
           quais entraram — e ela reenviaria os que já estavam lá. */
        for (let i = 0; i < arquivos.length; i++) {
          const f = arquivos[i];
          const aviso = U.el('ax-aviso');
          if (aviso) aviso.textContent = 'enviando ' + (i + 1) + ' de ' + arquivos.length + '…';
          const sub = await subirArquivo(f, par[0] + '-' + par[1], null);
          if (sub.erro) { falhou.push(f.name + ' (' + sub.erro + ')'); continue; }
          const r = S.anexarAoFaturamento(par[0], par[1], Object.assign({ tipo: tipo }, sub.anexo));
          if (r.erro) { falhou.push(f.name + ' (' + r.erro + ')'); continue; }
          n++;
        }
        ERP.app.fecharModal();
        revisarFaturamento(par.join('|'));
        ERP.app.aviso(n + ' documento(s) anexado(s)' +
          (falhou.length ? '. NÃO entraram: ' + falhou.join(' · ') : '.'),
          falhou.length ? 'erro' : 'ok');
      } }]
    });
  }

  /* BAIXAR O PACOTE: a nota mais o que vai junto com ela. Um link
     assinado por peça, abertos em sequência — é o que o navegador
     permite sem pedir ao servidor que monte um .zip. */
  async function baixarPacote(par) {
    const p = S.pacoteDoFaturamento(par[0], par[1]);
    if (ERP.app.erroDoRetorno(p)) return;
    if (!p.pecas.length) {
      return ERP.app.aviso('Não há arquivo para baixar neste faturamento' +
        (p.nota_sem_arquivo ? ' — a nota foi emitida pelo sistema e não tem PDF anexado.' : '.'), 'erro');
    }
    const cli = (ERP.auth && ERP.auth.cliente && ERP.auth.cliente()) || null;
    if (!cli) return ERP.app.aviso('Sem conexão com o banco — os arquivos ficam no servidor.', 'erro');
    let n = 0;
    for (const peca of p.pecas) {
      const r = await cli.storage.from(BALDE_FAT).createSignedUrl(peca.path, 900);
      if (r.error || !r.data) continue;
      const url = r.data.signedUrl +
        (r.data.signedUrl.indexOf('?') > -1 ? '&' : '?') + 'download=' + encodeURIComponent(peca.nome);
      const a = document.createElement('a');
      a.href = url; a.download = peca.nome; a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      n++;
    }
    ERP.app.aviso(n + ' arquivo(s) baixado(s)' +
      (p.nota_sem_arquivo ? ' — a nota emitida pelo sistema não tem PDF anexado.' : '.'), n ? 'ok' : 'erro');
  }

  /* ── a folha de emissão manual ───────────────────────────
     A nota que não sai pelo sistema sai no portal da prefeitura, à
     mão, por alguém que precisa dos dados na frente. Esta folha é
     esses dados, na ordem em que o portal pergunta — e vem da
     mesma fonte do arquivo de RPS, para que a nota digitada seja
     igual à que o sistema teria emitido. */
  function pdfEmissaoManual(ref) {
    const par = String(ref).split('|');
    const e = S.dadosParaEmissaoManual(par[0], par[1]);
    if (ERP.app.erroDoRetorno(e)) return;
    const d = e.dossie, it = e.item, pr = e.prestador;
    /* O documento do tomador fica guardado só com os dígitos; no
       portal ele é digitado com máscara, e conferir um CNPJ de
       catorze dígitos corridos contra a tela é onde o erro entra. */
    const doc = function (v) {
      const s = String(v || '').replace(/\D/g, '');
      if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
      if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
      return v || '';
    };

    const p = ERP.pdf.doc({ orientacao: 'retrato' });
    const x0 = p.margem, x1 = p.largura - p.margem;
    let y = p.margem + 10;

    /* Cabeçalho. A marca identifica o documento; o aviso embaixo
       dela impede o mal-entendido que destruiria a confiança nele:
       isto NÃO é nota fiscal e não vale como uma. */
    p.marca(x0, y - 10);
    p.texto(x1, y, 'EMISSÃO MANUAL DE NF', { tam: 12, negrito: true, alinhar: 'direita' });
    y += 13;
    p.texto(x1, y, d.grupo || d.projeto.curto || d.projeto.nome || '',
      { tam: 9, alinhar: 'direita' });
    y += 11;
    p.texto(x1, y, 'Competência ' + U.fComp(d.competencia), { tam: 8, cinza: 0.4, alinhar: 'direita' });
    y += 14;
    p.retangulo(x0, y, x1 - x0, 16, { preenchimento: 0.94, borda: false });
    p.texto(x0 + 6, y + 11, 'Documento de apoio para digitar a nota no portal. Não é nota fiscal ' +
      'e não substitui nenhuma.', { tam: 8, cinza: 0.3 });
    y += 26;

    const secao = function (titulo) {
      if (y > p.altura - p.margem - 80) { p.novaPagina(); y = p.margem + 12; }
      p.texto(x0, y, titulo, { tam: 9, negrito: true });
      y += 4;
      p.linha(x0, y, x1, y, { cinza: 0.55 });
      y += 12;
    };
    const campo = function (rotulo, valor, alerta) {
      if (y > p.altura - p.margem - 30) { p.novaPagina(); y = p.margem + 12; }
      p.texto(x0, y, rotulo, { tam: 8, cinza: 0.45, largura: 150 });
      const txt = String(valor === undefined || valor === null || valor === '' ? '—' : valor);
      y = p.paragrafo(x0 + 155, y, txt, { tam: 9, largura: x1 - x0 - 155,
        negrito: !!alerta, cinza: alerta ? 0 : undefined });
      y += 2;
    };

    /* 1. QUEM EMITE. Primeiro de propósito: é o campo que o portal
       pergunta antes de tudo, e o que saiu errado na v141. */
    secao('1 · QUEM EMITE A NOTA (prestador)');
    campo('Empresa', S.apelidoEmpresa(d.empresa) + '  (' + d.empresa_origem + ')');
    campo('Razão social', pr.nome);
    campo('CNPJ', pr.cnpj);
    campo('Inscrição municipal', pr.inscricao_municipal ||
      'NÃO CADASTRADA — procure antes de emitir', !pr.inscricao_municipal);
    campo('Município', (pr.municipio || '') + (pr.uf ? ' / ' + pr.uf : ''));
    y += 6;

    /* 2. PARA QUEM. */
    secao('2 · PARA QUEM (tomador)');
    campo('Nome', it.tomador_nome);
    campo('CNPJ / CPF', it.tomador_documento ? doc(it.tomador_documento) : '');
    campo('Endereço', [it.tomador_endereco, it.tomador_numero, it.tomador_complemento]
      .filter(Boolean).join(', '));
    campo('Bairro', it.tomador_bairro);
    campo('Cidade / UF', (it.tomador_cidade || '') + (it.tomador_uf ? ' / ' + it.tomador_uf : ''));
    campo('CEP', it.tomador_cep);
    campo('E-mail', it.tomador_email);
    y += 6;

    /* 3. O QUE EMITIR. */
    secao('3 · O QUE EMITIR');
    campo('Valor da nota', U.brl(d.valor));
    campo('Competência', U.fComp(d.competencia));
    campo('Vencimento previsto', d.vencimento ? U.fData(d.vencimento) : '');
    campo('Código do serviço', (e.servico.codigo_servico || '') +
      '   (LC 116 · item 4.07 — serviços médicos)');
    campo('Local da prestação', e.servico.local_prestacao === '1'
      ? 'no município do prestador' : 'informe conforme o contrato');
    campo('Protocolo do órgão', d.protocolo);
    y += 6;

    /* 4. RETENÇÕES. O número que mais dá trabalho de refazer: nota
       emitida com retenção errada vira cancelamento. */
    secao('4 · RETENÇÕES');
    if (!e.retencoes.length) {
      p.texto(x0, y, 'Nenhuma retenção cadastrada para este tomador — confirme com o financeiro ' +
        'antes de emitir.', { tam: 9, largura: x1 - x0 });
      y += 16;
    } else {
      p.texto(x0, y, 'Tributo', { tam: 8, negrito: true, cinza: 0.45 });
      p.texto(x0 + 200, y, 'Alíquota', { tam: 8, negrito: true, cinza: 0.45, alinhar: 'direita' });
      p.texto(x0 + 330, y, 'Valor', { tam: 8, negrito: true, cinza: 0.45, alinhar: 'direita' });
      y += 12;
      e.retencoes.forEach(function (r) {
        p.texto(x0, y, r.tributo, { tam: 9 });
        p.texto(x0 + 200, y, U.num(r.aliquota) + '%', { tam: 9, alinhar: 'direita' });
        p.texto(x0 + 330, y, U.brl(r.valor), { tam: 9, alinhar: 'direita' });
        y += 12;
      });
      y += 2; p.linha(x0, y, x0 + 330, y, { cinza: 0.6 }); y += 12;
      p.texto(x0, y, 'Total retido', { tam: 9, negrito: true });
      p.texto(x0 + 330, y, U.brl(e.retido), { tam: 9, negrito: true, alinhar: 'direita' });
      y += 13;
      p.texto(x0, y, 'Líquido a receber', { tam: 9, negrito: true });
      p.texto(x0 + 330, y, U.brl(e.liquido), { tam: 9, negrito: true, alinhar: 'direita' });
      y += 18;
    }

    /* 5. A DESCRIÇÃO, inteira. É o campo que mais some no caminho
       entre quem escreve e quem digita. */
    secao('5 · DESCRIÇÃO / DISCRIMINAÇÃO DA NOTA');
    p.texto(x0, y, 'Copie o texto abaixo para o campo de discriminação do portal:',
      { tam: 8, cinza: 0.45 });
    y += 13;
    /* A caixa é desenhada ANTES do texto (senão ele fica por baixo),
       então a altura tem de ser contada antes: mesma quebra que o
       `paragrafo` vai aplicar, com a mesma medida de largura. */
    const larguraTxt = x1 - x0 - 12;
    let linhas = 1, atual = '';
    String(it.discriminacao || '').split(/\s+/).filter(Boolean).forEach(function (w) {
      const tent = atual ? atual + ' ' + w : w;
      if (atual && p.larguraTexto(tent, 9) > larguraTxt) { linhas++; atual = w; }
      else atual = tent;
    });
    p.retangulo(x0, y - 10, x1 - x0, linhas * 12 + 8, { preenchimento: 0.97 });
    y = p.paragrafo(x0 + 6, y, it.discriminacao, { tam: 9, largura: larguraTxt });
    y += 14;

    /* 6. COMPOSIÇÃO, quando a nota cobre um grupo. */
    if (d.grupo && d.partes.length > 1) {
      secao('6 · COMPOSIÇÃO DA NOTA POR ESPECIALIDADE');
      d.partes.forEach(function (parte) {
        if (!(parte.valor > 0)) return;
        if (y > p.altura - p.margem - 30) { p.novaPagina(); y = p.margem + 12; }
        p.texto(x0, y, parte.projeto.curto || parte.projeto.nome || '', { tam: 9, largura: 300 });
        p.texto(x0 + 330, y, U.brl(parte.valor), { tam: 9, alinhar: 'direita' });
        y += 12;
      });
      y += 2; p.linha(x0, y, x0 + 330, y, { cinza: 0.6 }); y += 12;
      p.texto(x0, y, 'Total da nota', { tam: 9, negrito: true });
      p.texto(x0 + 330, y, U.brl(d.valor), { tam: 9, negrito: true, alinhar: 'direita' });
      y += 18;
    }

    /* 7. O QUE FALTA. Em vez de a pessoa descobrir no meio do
       preenchimento que o cadastro não tem o CEP do tomador. */
    const faltas = (ERP.rpsBarueri && ERP.rpsBarueri.pendencias)
      ? ERP.rpsBarueri.pendencias(it, pr) : [];
    if (faltas.length) {
      secao('ATENÇÃO · DADOS QUE FALTAM NO CADASTRO');
      y = p.paragrafo(x0, y, 'O portal vai pedir, e o sistema não tem: ' + faltas.join(' · ') +
        '. Procure antes de começar, ou complete em Cadastros.',
        { tam: 9, largura: x1 - x0 });
      y += 10;
    }

    /* 8. DEPOIS DE EMITIR. Fecha o laço: sem isto o faturamento
       fica parado em "liberado" dizendo que falta emitir o que já
       foi emitido. */
    if (y > p.altura - p.margem - 70) { p.novaPagina(); y = p.margem + 12; }
    secao('DEPOIS DE EMITIR');
    y = p.paragrafo(x0, y, 'Volte à esteira do faturamento, nesta mesma linha, e use ' +
      '"Anexar NF emitida": informe número, série, valor e a chave, e anexe o arquivo da nota. ' +
      'É isso que fecha este faturamento e lança o título no contas a receber. Enquanto não for ' +
      'feito, a linha continua em "liberado para faturar".', { tam: 9, largura: x1 - x0 });

    /* Rodapé: quem gerou e quando. A folha vai circular fora do
       sistema, e daqui a um mês alguém vai precisar saber se o que
       está na mão dela ainda é o número vigente. */
    const rod = p.altura - p.margem + 2;
    p.linha(x0, rod - 10, x1, rod - 10, { cinza: 0.75 });
    /* A versão vem como "v142 · 03/11/2026"; só o número interessa
       aqui, porque a data já está na frase. */
    const versao = String((ERP.config || {}).versao || '').split('·')[0].trim();
    p.texto(x0, rod, 'Gerado por ' + ((S.usuario() || {}).nome || '') + ' em ' +
      U.fData(U.hoje()) + (versao ? ' · ORB ' + versao : ''), { tam: 7, cinza: 0.5 });
    p.texto(x1, rod, 'Confira na esteira antes de emitir — o valor pode ter mudado',
      { tam: 7, cinza: 0.5, alinhar: 'direita' });

    p.salvar('emissao-' + (d.grupo || d.projeto.curto || '').replace(/[^\w]+/g, '-') +
      '-' + d.competencia + '.pdf');
  }

  /* O DOCUMENTO DO FATURAMENTO, pela linha da esteira. Duas saídas,
     porque são as duas respostas verdadeiras: anexar o que existe,
     ou dizer que este caso não tem documento. A terceira — deixar
     como está — continua valendo, e é por isso que o valor não
     ficou travado esperando. */
  function documentoDoFaturamento(ref) {
    const par = String(ref).split('|');
    const d = S.dossieFaturamento(par[0], par[1]);
    if (ERP.app.erroDoRetorno(d)) return;
    const dispensado = !!(d.anexos.length === 0 && d.documento_dispensado);
    const podeMexer = S.podeMover('faturamento');
    ERP.app.modal({
      titulo: 'Documento do faturamento · ' + U.esc(d.grupo || d.projeto.curto || '') +
        ' · ' + U.fComp(d.competencia),
      fecharTxt: 'Fechar',
      corpo:
        '<div class="resumo-linha"><span>Valor confirmado</span><span class="v">' +
          U.brl(d.valor) + '</span></div>' +
        '<div class="resumo-linha"><span>Etapa</span><span class="v">' +
          U.esc(ETAPAS_NOME[d.etapa] || d.etapa) + '</span></div>' +
        (d.anexos.length
          ? '<ul class="historico">' + d.anexos.map(function (an) {
              return '<li><span class="badge b-aguardando">' + U.esc(S.nomeTipoAnexoFat(an.tipo)) +
                '</span> <span class="mono">' + U.esc(an.nome) + '</span></li>';
            }).join('') + '</ul>'
          : '<div class="ajuda' + (dispensado ? '' : ' erro') + '">' +
            (dispensado
              ? 'Marcado como faturamento <b>sem documento</b>' +
                (d.documento_dispensado_por ? ' por ' + U.esc(d.documento_dispensado_por) : '') +
                (d.documento_dispensado_em ? ' em ' + U.fData(d.documento_dispensado_em) : '') + '.'
              : 'Nenhum documento anexado. O valor seguiu assim mesmo, para não travar o ' +
                'financeiro — mas enquanto ficar assim este faturamento conta como pendência.') +
            '</div>') +
        (podeMexer && !d.anexos.length && !dispensado
          ? '<label style="margin-top:8px">Motivo <span class="sub">(se for marcar que não tem documento)</span></label>' +
            '<input id="doc-motivo" placeholder="ex.: contrato por disponibilidade, sem medição do órgão">'
          : ''),
      acoes: (podeMexer
        ? [{ txt: d.anexos.length ? 'Anexar mais' : 'Anexar documento', cls: 'btn-aprovar',
             fn: function () { ERP.app.fecharModal(); anexarAoFaturamento(par); } }]
          .concat(d.anexos.length ? [] : [dispensado
            ? { txt: 'Voltar a exigir documento', cls: 'btn-sm', fn: function () {
                const r = S.dispensarDocumentoFaturamento(par[0], par[1], false);
                if (ERP.app.erroDoRetorno(r)) return;
                ERP.app.fecharModal(); renderEsteira();
                ERP.app.aviso('Volta a contar como pendência de documento.', 'ok');
              } }
            : { txt: 'Este faturamento não tem documento', cls: 'btn-sm', fn: function () {
                const r = S.dispensarDocumentoFaturamento(par[0], par[1], true, U.val('doc-motivo'));
                if (ERP.app.erroDoRetorno(r)) return;
                ERP.app.fecharModal(); renderEsteira();
                ERP.app.aviso('Marcado como faturamento sem documento — sai da lista de pendências.', 'ok');
              } }])
        : [])
    });
  }

  /* ── A NOTA FOI AO CLIENTE? ─────────────────────────────

     O envio sai daqui porque é daqui que sai o pacote: a nota mais
     a AF e a escala, que o cliente exige juntas. A tela mostra o
     que vai no envio antes de marcar — marcar "enviada" com a AF
     faltando é registrar um envio incompleto. */
  function envioAoCliente(ref) {
    const par = String(ref).split('|');
    const d = S.dossieFaturamento(par[0], par[1]);
    if (ERP.app.erroDoRetorno(d)) return;
    const podeMexer = S.podeMover('faturamento');
    const jaEnviado = !!(d.previsao_envio && d.previsao_envio.em);
    const env = d.previsao_envio || {};
    ERP.app.modal({
      titulo: 'Envio ao cliente · ' + U.esc(d.grupo || d.projeto.curto || '') +
        ' · ' + U.fComp(d.competencia),
      fecharTxt: 'Fechar',
      corpo:
        '<div class="resumo-linha"><span>Cliente</span><span class="v">' +
          U.esc(d.cliente ? d.cliente.nome : '— sem cliente amarrado —') + '</span></div>' +
        '<div class="resumo-linha"><span>Valor faturado</span><span class="v">' +
          U.brl(d.valor) + '</span></div>' +
        /* O QUE VAI NO ENVIO, listado antes de marcar. */
        '<div style="margin-top:10px"><b>O que vai junto</b>' +
          (d.documentos.length
            ? '<ul class="historico">' + d.documentos.map(function (doc) {
                return '<li><span class="badge b-pago">NF ' + U.esc(doc.numero || '') + '</span> ' +
                  '<span class="sub">' + U.brl(doc.valor) + '</span></li>';
              }).join('') + '</ul>'
            : '<div class="ajuda erro">Nenhuma nota emitida neste faturamento.</div>') +
          (d.anexos.length
            ? '<ul class="historico">' + d.anexos.map(function (an) {
                return '<li><span class="badge b-aguardando">' + U.esc(S.nomeTipoAnexoFat(an.tipo)) +
                  '</span> <span class="mono">' + U.esc(an.nome) + '</span></li>';
              }).join('') + '</ul>'
            : '<div class="ajuda">Nenhum documento anexado — o cliente costuma exigir a AF ou a ' +
              'escala junto da nota. Dá para baixar o pacote em <b>Ver / editar</b>.</div>') +
          /* v157: o boleto que falta é dito AQUI, antes de marcar
             como enviada — depois de marcada, ninguém volta. */
          (S.faltaBoleto(par[0], par[1])
            ? '<div class="aviso" style="margin-top:8px"><b>Falta o boleto.</b> Este cliente exige ' +
              'boleto junto com a nota, e ele ainda não foi anexado. Anexe em <b>Ver / editar</b> ' +
              'antes de enviar.</div>'
            : '') +
        '</div>' +
        (jaEnviado
          ? '<div class="ajuda" style="margin-top:8px">Marcada como <b>enviada ao cliente</b> em ' +
            U.fData(env.em) + (env.por ? ' por ' + U.esc(String(env.por).split(' ')[0]) : '') +
            (env.como ? '.<br>Por: ' + U.esc(env.como) : '.') + '</div>'
          : (podeMexer
              ? '<label style="margin-top:10px">Como foi enviada <span class="sub">(e-mail, portal, ' +
                'protocolo — é o que se procura quando o cliente diz que não recebeu)</span></label>' +
                '<input id="env-como" placeholder="ex.: e-mail faturamento@cliente.com.br em 03/11, protocolo 4471">'
              : '')),
      acoes: (podeMexer
        ? [jaEnviado
            ? { txt: 'Desfazer o envio', cls: 'btn-sm', fn: function () {
                const r = S.marcarEnvioAoCliente(par[0], par[1], false);
                if (ERP.app.erroDoRetorno(r)) return;
                ERP.app.fecharModal(); renderEsteira();
                ERP.app.aviso('Volta a contar como nota a enviar.', 'ok');
              } }
            : { txt: 'Marcar como enviada ao cliente', cls: 'btn-aprovar', fn: function () {
                const r = S.marcarEnvioAoCliente(par[0], par[1], true, U.val('env-como'));
                if (ERP.app.erroDoRetorno(r)) return;
                ERP.app.fecharModal(); renderEsteira();
                ERP.app.aviso('Marcada como enviada ao cliente.', 'ok');
              } }]
        : [])
    });
  }

  function acoesEsteira(l) {
    const ref = l.centro + '|' + l.competencia;
    /* VER E EDITAR O QUE FOI LANÇADO, em toda linha e em toda etapa.
       Era o que faltava: o valor dava para ver na esteira, mas a
       descrição que vai na nota, o protocolo, a composição por
       especialidade e os documentos tinham sido digitados dentro de
       um modal que fechou e não abria mais. */
    const rever = '<button class="btn-sm" data-est-rev="' + ref + '" ' +
      'title="ver tudo que foi lançado neste faturamento">Ver / editar</button>';
    /* O DOCUMENTO QUE FALTA, na própria linha e em vermelho. O valor
       seguiu sem ele para não travar o financeiro — o que não pode é
       a falta sumir de vista até alguém procurar. Verde quando já
       tem; apagado quando alguém disse que este caso não tem. */
    const doc = l.sem_documento
      ? ' <button class="btn-sm btn-nf-falta" data-est-doc="' + ref + '" ' +
        'title="confirmado sem documento — anexe a AF ou a escala, ou marque que não tem">' +
        'Falta doc.</button>'
      : (l.anexos
          ? ' <button class="btn-sm btn-nf-ok" data-est-doc="' + ref + '" ' +
            'title="' + l.anexos + ' documento(s) anexado(s)">Doc. ' + l.anexos + '</button>'
          : (l.documento_dispensado
              ? ' <button class="btn-sm btn-nf-na" data-est-doc="' + ref + '" ' +
                'title="marcado como faturamento sem documento">sem doc.</button>'
              : ''));
    /* Quem cuida de produtividade e faturamento digita o valor e
       autoriza no mesmo gesto — e a liberação vai junto. */
    if (l.etapa === 'previsao' && S.pode('autorizar_faturamento')) {
      return rever + doc +
        ' <button class="btn-sm btn-aprovar" data-est-conf="' + ref + '">Confirmar valor e autorizar</button>';
    }
    if (l.etapa === 'confirmado' && S.pode('autorizar_faturamento')) {
      return rever + doc +
        ' <button class="btn-sm" data-est-conf="' + ref + '">Corrigir valor</button>' +
        ' <button class="btn-sm btn-aprovar" data-est-aut="' + ref + '">Autorizar</button>';
    }
    if (l.etapa === 'autorizado') {
      return rever + doc +
        (S.pode('autorizar_faturamento')
          ? ' <button class="btn-sm" data-est-des="autorizado|' + ref + '">Desfazer</button>' : '') +
        (S.pode('liberar_faturamento')
          ? ' <button class="btn-sm btn-aprovar" data-est-lib="' + ref + '">Liberar</button>' : '');
    }
    if (l.etapa === 'liberado') {
      /* NOTA EMITIDA FORA entra por aqui. A do Ceará sai pelo
         portal da prefeitura de lá, não pelo RPS deste sistema — e
         sem este caminho o faturamento ficava parado em "liberado"
         para sempre, dizendo que falta emitir o que já foi
         emitido. */
      /* SEM ETIQUETA DE SITUAÇÃO AQUI. "pronto para faturar" era
         uma frase solta espremida em três linhas; virou etiqueta; e
         com a folha de emissão na mesma célula, os quatro botões
         passaram a empurrar a tabela 81px para fora da tela — e
         esta casa não rola de lado. A etapa já está dita duas
         vezes: na coluna "Liberado", com data e nome, e no filtro
         do topo. A terceira era a que não cabia. */
      return rever + doc +
        /* A FOLHA PARA EMITIR À MÃO fica na linha liberada, que é
           onde a pessoa está quando vai emitir — e ao lado de
           "Anexar NF emitida", que é o passo seguinte dela. */
        ' <button class="btn-sm" data-est-pdf="' + ref + '" ' +
          'title="PDF com os dados para digitar a nota no portal da prefeitura">Emitir à mão</button>' +
        (S.pode('liberar_faturamento')
          ? ' <button class="btn-sm" data-est-des="liberado|' + ref + '">Desfazer</button>' : '') +
        (S.pode('faturar')
          ? ' <button class="btn-sm btn-aprovar" data-est-nf="' + ref + '" ' +
            'title="anexar a NF emitida fora do sistema e fechar o faturamento">Anexar NF</button>' : '');
    }
    if (l.etapa === 'previsao') {
      return rever + doc + ' <span class="badge b-aberto" title="o fechamento da produtividade ainda não veio">' +
        'aguarda produtividade</span>';
    }
    /* FATURADO AINDA NÃO É ENVIADO. A nota sai do sistema e vai ao
       cliente por e-mail, portal ou protocolo, junto da AF e da
       escala — e até aqui nada disso deixava rastro: "faturado"
       dizia a mesma coisa no dia da emissão e três semanas depois.
       Avermelhado enquanto não foi; verde com a data depois. */
    if (l.etapa === 'faturado') {
      return rever + doc + (l.enviado_cliente_em
        ? ' <button class="btn-sm btn-nf-ok" data-est-env="' + ref + '" title="enviado ao cliente em ' +
          U.fData(l.enviado_cliente_em) + (l.enviado_cliente_como ? ' · ' + U.esc(l.enviado_cliente_como) : '') +
          (l.enviado_cliente_por ? ' · por ' + U.esc(String(l.enviado_cliente_por).split(' ')[0]) : '') +
          '">Enviada</button>'
        : ' <button class="btn-sm btn-nf-falta" data-est-env="' + ref + '" ' +
          'title="nota emitida e ainda não enviada ao cliente">Enviar</button>');
    }
    return rever + doc;
  }

  function ligarEsteira() {
    const box = U.el('fa-aba-esteira');
    box.querySelectorAll('[data-est-emp]').forEach(function (b) {
      b.addEventListener('click', function () { trocarEmitente(this.dataset.estEmp); });
    });
    box.querySelectorAll('[data-est-nf]').forEach(function (b) {
      b.addEventListener('click', function () { anexarNFEmitida(this.dataset.estNf); });
    });
    box.querySelectorAll('[data-est-rev]').forEach(function (b) {
      b.addEventListener('click', function () { revisarFaturamento(this.dataset.estRev); });
    });
    box.querySelectorAll('[data-est-pdf]').forEach(function (b) {
      b.addEventListener('click', function () { pdfEmissaoManual(this.dataset.estPdf); });
    });
    box.querySelectorAll('[data-est-doc]').forEach(function (b) {
      b.addEventListener('click', function () { documentoDoFaturamento(this.dataset.estDoc); });
    });
    box.querySelectorAll('[data-est-env]').forEach(function (b) {
      b.addEventListener('click', function () { envioAoCliente(this.dataset.estEnv); });
    });
    /* AS ETAPAS LADO A LADO. Um clique troca a etapa; clicar na que
       já está escolhida volta para "Todas". */
    box.querySelectorAll('[data-es-etapa]').forEach(function (b) {
      b.addEventListener('click', function () {
        const e = this.dataset.esEtapa;
        fEst.etapa = (fEst.etapa === e && e) ? '' : e;
        renderEsteira();
      });
    });
    if (box.querySelector('[data-es-semdoc]')) {
      box.querySelector('[data-es-semdoc]').addEventListener('click', function () {
        fEst.sem_doc = !fEst.sem_doc;
        renderEsteira();
      });
    }
    if (box.querySelector('[data-es-enviar]')) {
      box.querySelector('[data-es-enviar]').addEventListener('click', function () {
        fEst.falta_enviar = !fEst.falta_enviar;
        /* A pergunta é sobre nota JÁ emitida: deixar "esconder os já
           faturados" ligado esvaziaria a lista justamente ao ligar
           este filtro. */
        if (fEst.falta_enviar) { fEst.pendentes = false; fEst.etapa = ''; }
        renderEsteira();
      });
    }
    if (box.querySelector('[data-es-atraso]')) {
      box.querySelector('[data-es-atraso]').addEventListener('click', function () {
        fEst.anteriores = !fEst.anteriores;
        /* A visão de atraso é de VÁRIOS meses: a etapa escolhida
           para um mês não quer dizer nada aqui. */
        if (fEst.anteriores) fEst.etapa = '';
        renderEsteira();
      });
    }
    if (box.querySelector('[data-es-inativos]')) {
      box.querySelector('[data-es-inativos]').addEventListener('click', function () {
        fEst.inativos = !fEst.inativos;
        renderEsteira();
      });
    }
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
        /* A mensagem dizia "estimativa global do grupo atualizada"
           quando o retorno trouxesse `grupo` — e nunca traz: o valor
           é sempre de um projeto. Dizer "global" onde o valor é de um
           setor era a própria confusão que este campo criava. */
        const g = (D.centro(par[0]) || {}).grupo_faturamento;
        ERP.app.aviso('Valor de ' + U.esc((D.centro(par[0]) || {}).curto || par[0]) +
          ' atualizado para ' + U.brl(valor) + '.' +
          (g ? ' O total do ' + g + ' é a soma dos setores.' : ''), 'ok');
      };
      inp.addEventListener('blur', salvar);
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    });
    box.querySelectorAll('[data-est-conf]').forEach(function (b) {
      b.addEventListener('click', function () { confirmarEAutorizar(this.dataset.estConf); });
    });
    U.el('es-comp').addEventListener('change', function () { fEst.competencia = this.value; renderEsteira(); });
    U.el('es-pend').addEventListener('change', function () { fEst.pendentes = this.checked; renderEsteira(); });

    box.querySelectorAll('[data-est-aut]').forEach(function (b) {
      b.addEventListener('click', function () {
        const par = this.dataset.estAut.split('|');
        const l = S.esteiraFaturamento({ centro: par[0], competencia: par[1] })[0] || {};
        const gr = (D.centro(par[0]) || {}).grupo_faturamento || null;
        const discInicial = S.discriminacaoDaNota(par[0], par[1], gr, '');
        const discPadrao = S.discriminacaoPadrao(par[0], par[1], gr, '');
        ERP.app.modal({
          titulo: 'Autorização do órgão · ' + U.esc((l.projeto || {}).curto || ''),
          fecharTxt: 'Cancelar',
          corpo: '<div class="resumo-linha"><span>Competência</span><span class="v">' + U.fComp(par[1]) + '</span></div>' +
            '<div class="resumo-linha"><span>Valor confirmado</span><span class="v">' + U.brl(l.valor || 0) + '</span></div>' +
            '<div class="ajuda">Registre como o órgão autorizou este valor — ofício, e-mail, ata de ' +
            'medição. Sem isso, faturar é risco de glosa — mas o faturamento <b>não fica parado ' +
            'por causa do protocolo</b>: dá para registrar a autorização agora e preencher o ' +
            'número quando ele chegar, em <b>Ver / editar</b>.</div>' +
            '<div class="row2">' +
              /* O CAMPO VEM PREENCHIDO COM O QUE JÁ ESTÁ GRAVADO.
                 Vinha vazio mesmo numa competência já autorizada:
                 quem reabria não via o número registrado, digitava
                 outro parecido e o sistema recusava dizendo que já
                 estava autorizado por um protocolo que a tela não
                 mostrava. Campo vazio que esconde o valor gravado é
                 convite a divergir dele. */
              '<div><label>Protocolo / referência</label><input id="es-prot" value="' +
                U.esc(l.protocolo || '') + '" placeholder="ex.: Ofício 55/2026 — medição agosto"></div>' +
              '<div><label>Data da autorização</label><input type="date" id="es-data" value="' +
                (l.autorizado_em ? U.dataLocal(l.autorizado_em) : U.hoje()) + '"></div></div>' +
            (l.protocolo
              ? '<div class="ajuda">Já autorizado pelo protocolo <b>' + U.esc(l.protocolo) +
                '</b>. Trocando o número aqui, o anterior fica no histórico deste faturamento.</div>'
              : '') +
            /* Aqui entra o texto que vai na DISCRIMINAÇÃO da nota, e
               às vezes é longo: competência, ofício, medição, relação
               de plantões. Campo de uma linha não servia — e, vazio,
               não dizia que o sistema escreveria um texto no lugar. */
            '<label>Discriminação — o texto que vai na NF</label>' +
            '<textarea id="es-obs" rows="5">' + U.esc(discInicial) + '</textarea>',
          acoes: [{ txt: 'Registrar autorização', cls: 'btn-aprovar', fn: function () {
            const escrito = U.val('es-obs').trim();
            const intocado = escrito === String(discInicial).trim();
            const eraDoSistema = String(discInicial).trim() === String(discPadrao).trim();
            const r = S.autorizarFaturamento(par[0], par[1], { protocolo: U.val('es-prot'),
              data: U.val('es-data') });
            if (ERP.app.erroDoRetorno(r)) return;
            S.definirDiscriminacao(par[0], par[1], intocado && eraDoSistema ? '' : escrito);
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
          if (ERP.app.erroDoRetorno(r)) return;
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
            if (ERP.app.erroDoRetorno(r)) return;
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
        if (ERP.app.erroDoRetorno(r)) return;
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
      /* POR QUAL CNPJ ESTE DOCUMENTO SAI — antes de emitir, não
         depois. Era a informação que faltava na tela: o documento
         saía pela matriz por omissão, e o CNPJ errado só aparecia
         no papel que chegava ao cliente. */
      (fatSel.centro
        ? (function () {
            const emp = D.empresaPor(S.empresaEmissora(fatSel.centro, fatSel.comp)) || {};
            return '<div class="resumo-linha"><span>Emitido por</span><span class="v">' +
              U.esc(emp.apelido || '—') + ' <span class="sub">' + U.esc(emp.cnpj || '') + ' · ' +
              U.esc(S.origemDaEmpresaEmissora(fatSel.centro, fatSel.comp)) + '</span></span></div>';
          })()
        : '') +
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
      if (ERP.app.erroDoRetorno(r)) return;
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
        if (ERP.app.erroDoRetorno(r)) return;
        renderCobertura(); atualizarAlertaFat(); ERP.app.atualizarContadores();
        ERP.app.aviso('Projeto marcado como "não fatura em ' + U.fComp(covComp) + '".', 'ok');
      });
    });
    box.querySelectorAll('[data-reabrir]').forEach(function (b) {
      b.addEventListener('click', function () {
        const r = S.marcarPrevisoes(covComp, 'estimada', this.dataset.reabrir);
        if (ERP.app.erroDoRetorno(r)) return;
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
    /* v152: `lote` é nulo até alguém importar um XML. A função já
       previa nota ausente; faltava prever lote ausente, e assim ela
       serve também para corrigir a retenção de um cliente sem ter
       nota nenhuma na mão. */
    const nota = ((lote && lote.notas) || [])
      .find(function (n) { return n.tomador.documento === doc; }) || { tomador: {} };
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
        /* v152: PELO STORE, não direto na memória. Era aqui que a
           retenção cadastrada se perdia: o formulário escrevia no
           objeto vivo e nunca chamava o store — e é a chamada ao
           store que agenda a gravação no banco. O mesmo defeito já
           tinha sido corrigido em Cadastros › Clientes e sobreviveu
           aqui, porque a regra morava em dois lugares. */
        const res = S.salvarRetencoesCliente(doc, retencoes,
          U.val('rt-centro') || null, nota.tomador.nome);
        if (ERP.app.erroDoRetorno(res)) return;
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
    /* "já geradas" é o título deste painel, e previsão não é gerada:
       ela é calculada na hora e não tem linha no banco. Desde a v133
       `listarReceber` mistura as duas coisas para a TELA do contas a
       receber; aqui, onde se dá baixa e se emite nota, só entra o que
       existe de verdade — senão apareceria um botão "Baixar" para um
       título que não existe. */
    const rs = S.listarReceber({}).filter(function (r) { return !r.previsao; });
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
    renderStatus: renderStatus, renderResultado: renderResultado, atualizarAlertaFat: atualizarAlertaFat,
    /* v152: exposta para que a prova consiga ABRIR esta janela e
       clicar em Salvar. O defeito das retenções perdidas estava
       exatamente aqui — no que a tela faz ao salvar, não no store,
       que estava certo. Prova que chama o store direto não vê esse
       defeito: foi o que deixou ele passar. */
    abrirCliente: abrirCliente };
})();
