/* HABILITAÇÃO — o cofre de documentos e o alerta de vencimento.

   O QUE ESTE MÓDULO RESOLVE

   Hoje as certidões estão espalhadas e a conferência é de olho: na
   véspera da sessão alguém abre a pasta e descobre que o CRF do
   FGTS venceu há três dias. Isso inabilita, e não tem recurso que
   conserte — o edital pede o documento válido na data.

   Então o módulo faz duas coisas, e só:

   1. GUARDA o documento, lendo dele a validade, o número e o CNPJ,
      e adivinhando o tipo pelo texto (js/hab-leitura.js). Subir
      uma certidão tem de custar um arrastar, não um formulário.

   2. AVISA antes de vencer, escalonado em 30 / 15 / 7 / 1 dia.

   Certames, checklist, geração de peças e empacotamento ficam para
   uma etapa seguinte, por decisão de escopo.

   ─────────────────────────────────────────────────────────────
   TRÊS ESCOLHAS DE TELA QUE NÃO SÃO ESTÉTICA

   O PAINEL não é uma matriz empresa × certidão. A matriz é o
   desenho óbvio e precisa de treze colunas, o que obriga a correr
   a tela para o lado para saber se falta algo — e o que está fora
   da vista não é conferido. No lugar dela vai a FILA DO QUE
   PRECISA DE AÇÃO, ordenada pelo que vence primeiro: é a pergunta
   que alguém tem de verdade ao abrir a tela ("o que eu faço
   hoje?"), e cabe na largura.

   O cofre guarda o HISTÓRICO: renovar não apaga a certidão
   anterior. Quem precisa provar regularidade numa data passada
   precisa do documento daquela data, e o semáforo olha só a que
   vale hoje de cada par empresa+tipo.

   Dados de sócio (RG, CPF, residência) seguem o mesmo tratamento
   de nome de paciente: a linha nem chega ao navegador de quem não
   tem a permissão — quem filtra é a política do banco, não esta
   tela. */

ERP.habilitacao = (function () {
  const U = ERP.util, S = ERP.store, D = ERP.dados;

  let aba = 'painel';
  let filtro = { empresa: '', tipo: '', situacao: '', busca: '' };
  /* As tabelas deste módulo ficam fora do mapa de sincronização por
     sombra: o cofre é leitura e escrita diretas, não movimento com
     foto anterior. Então o que foi lido vive aqui. */
  let dados = { tipos: [], documentos: [], tarefas: [], lido: null, erro: null };
  let carregando = false;
  let lido = null;        // o que o leitor do PDF achou, enquanto o formulário está aberto
  let arquivo = null;     // o arquivo escolhido, antes de guardar

  const cli = () => (ERP.auth && ERP.auth.cliente && ERP.auth.cliente()) || null;
  const podeVer   = () => S.acesso('habilitacao').ver;
  const podeMexer = () => S.acesso('habilitacao').mover;
  const podeAdmin = () => S.acesso('habilitacao').aprovar;

  /* ── carga ───────────────────────────────────────────── */
  async function carregar() {
    const c = cli();
    if (!c) { dados.erro = 'sem-banco'; render(); return; }
    carregando = true; render();
    const [tp, dc, tf] = await Promise.all([
      c.from('hab_tipo_documento').select('*').eq('ativo', true).order('ordem'),
      c.from('hab_documento_vigente').select('*').order('data_emissao', { ascending: false }),
      c.from('hab_tarefa').select('*').eq('status', 'aberta').order('prazo')
    ]);
    carregando = false;
    const ruim = [tp, dc, tf].filter(function (r) { return r.error; })[0];
    if (ruim) {
      /* Tabela que não existe quer dizer SQL não rodado, e é a
         causa mais provável nas primeiras semanas. Dizer isso
         poupa a rodada de diagnóstico. */
      dados.erro = /does not exist|schema cache|relation/i.test(ruim.error.message)
        ? 'As tabelas do módulo ainda não existem no banco. Rode supabase/43-habilitacao.sql.'
        : ruim.error.message;
      render(); return;
    }
    dados = { tipos: tp.data || [], documentos: dc.data || [], tarefas: tf.data || [],
              lido: new Date(), erro: null };
    render();
  }

  const tipoDe = id => (dados.tipos || []).find(function (t) { return t.id === id; }) || {};
  const empresasAtivas = () =>
    (D.empresas || []).filter(function (e) { return e.ativo !== false; });
  function nomeEmpresa(id) {
    const e = (D.empresas || []).find(function (x) { return x.id === id; });
    return e ? (e.apelido || e.nome) : (id || '—');
  }

  /* ── semáforo ────────────────────────────────────────────
     Os degraus são os do alerta: 30 / 15 / 7 / 1. Um documento a
     quarenta dias não é assunto; a sete, é. `ordem` serve para a
     fila — o mais urgente em cima. */
  function situacao(d) {
    if (d.tipo_sem_validade) return { id: 'perene', txt: 'não vence', cls: 'b-cancelado', ordem: 9 };
    const n = d.dias_para_vencer;
    if (n === null || n === undefined) return { id: 'sem-data', txt: 'sem validade', cls: 'b-pendente', ordem: 2 };
    if (n < 0)   return { id: 'vencido', txt: 'vencido há ' + Math.abs(n) + ' dias', cls: 'b-reprovado', ordem: 0 };
    if (n <= 7)  return { id: 'critico', txt: 'vence em ' + n + ' dias', cls: 'b-reprovado', ordem: 1 };
    if (n <= 15) return { id: 'alerta',  txt: 'vence em ' + n + ' dias', cls: 'b-pendente', ordem: 3 };
    if (n <= 30) return { id: 'atencao', txt: 'vence em ' + n + ' dias', cls: 'b-pendente', ordem: 4 };
    return { id: 'ok', txt: 'vence em ' + n + ' dias', cls: 'b-pago', ordem: 5 };
  }
  const PRECISA = { vencido: 1, critico: 1, 'sem-data': 1, alerta: 1, atencao: 1 };

  /* O documento que VALE de cada par empresa+tipo.

     A comparação é pela validade, não pela emissão: uma certidão
     emitida depois pode valer menos — a estadual de trinta dias
     emitida hoje vence antes da de cento e oitenta emitida no mês
     passado — e quem manda na habilitação é até quando vale. */
  function vigentes(lista) {
    const por = {};
    (lista || dados.documentos || []).forEach(function (d) {
      const k = d.empresa + '|' + d.tipo;
      const atual = por[k];
      if (!atual) { por[k] = d; return; }
      const a = d.validade_efetiva || d.data_emissao || '';
      const b = atual.validade_efetiva || atual.data_emissao || '';
      if (a > b) por[k] = d;
    });
    return Object.keys(por).map(function (k) { return por[k]; });
  }

  /* Pares empresa+tipo que o cofre deveria ter e não tem. Só as
     certidões que vencem: contrato social e procuração não entram
     numa lista de "falta renovar". */
  function faltando(v) {
    const exigidos = (dados.tipos || []).filter(function (t) {
      return t.categoria === 'certidoes' && !t.sem_validade;
    });
    const fora = [];
    empresasAtivas().forEach(function (e) {
      exigidos.forEach(function (t) {
        if (!v.some(function (d) { return d.empresa === e.id && d.tipo === t.id; })) {
          fora.push({ empresa: e.id, tipo: t.id, nome: t.nome, url: t.url_emissao });
        }
      });
    });
    return fora;
  }

  /* ── montagem ────────────────────────────────────────── */
  function montar() {
    document.querySelectorAll('#hb-nav button').forEach(function (b) {
      b.addEventListener('click', function () { aba = this.dataset.hb; render(); });
    });
    const n = U.el('hb-novo');
    if (n) n.addEventListener('click', function () { abrirFormulario(null); });
  }

  function render() {
    const saida = U.el('hb-saida');
    if (!saida) return;
    document.querySelectorAll('#hb-nav button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.hb === aba ? 'true' : 'false');
    });
    const bNovo = U.el('hb-novo');
    if (bNovo) bNovo.style.display = (podeVer() && podeMexer()) ? '' : 'none';

    if (!podeVer()) {
      saida.innerHTML = '<div class="vazio"><strong>Seu perfil não tem acesso a Habilitação.</strong>' +
        'O cofre guarda contrato social, balanço e documento de sócio. O acesso é liberado em ' +
        'Administração, na matriz de perfis.</div>';
      return;
    }
    if (dados.erro === 'sem-banco') {
      saida.innerHTML = '<div class="vazio"><strong>Sem conexão com o banco.</strong>' +
        'O cofre guarda os arquivos no servidor — não funciona no modo local.</div>';
      return;
    }
    if (dados.erro) { saida.innerHTML = '<div class="aviso">' + U.esc(dados.erro) + '</div>'; return; }
    if (!dados.lido && !carregando) { carregar(); return; }
    if (carregando) { saida.innerHTML = '<div class="vazio">carregando o cofre…</div>'; return; }

    saida.innerHTML = aba === 'cofre' ? cofre() : aba === 'tipos' ? catalogo() : painel();
    ligar();
  }

  /* ── painel ──────────────────────────────────────────── */
  function painel() {
    const v = vigentes();
    const fila = v.filter(function (d) { return PRECISA[situacao(d).id]; })
                  .sort(function (a, b) {
                    const sa = situacao(a), sb = situacao(b);
                    return sa.ordem - sb.ordem ||
                      ((a.dias_para_vencer || 0) - (b.dias_para_vencer || 0));
                  });
    const falta = faltando(v);
    const conta = id => v.filter(function (d) { return situacao(d).id === id; }).length;

    const cartao = (rot, val, det, vermelho) =>
      '<div class="ind-card"><div class="rot">' + rot + '</div>' +
      '<div class="valor"' + (vermelho && val !== '0' ? ' style="color:var(--red)"' : '') + '>' +
      val + '</div><div class="det">' + det + '</div></div>';

    return '<div class="ind-grade">' +
        cartao('Vencidos', String(conta('vencido')), 'inabilitam hoje', true) +
        cartao('Vencem em 7 dias', String(conta('critico')), 'renovar esta semana', true) +
        cartao('Vencem em 30 dias', String(conta('alerta') + conta('atencao')), 'entram na fila') +
        cartao('Sem validade lida', String(conta('sem-data')), 'precisam de conferência') +
        cartao('Faltam no cofre', String(falta.length), 'nunca foram guardados') +
      '</div>' +

      (dados.tarefas.length ? tarefas() : '') +

      '<h3 class="hb-titulo">O que precisa de ação</h3>' +
      (fila.length ? filaAcao(fila)
        : '<div class="vazio"><strong>Nada vencendo nos próximos 30 dias.</strong>' +
          'As certidões guardadas estão todas com folga.</div>') +

      (falta.length ? blocoFalta(falta) : '') +

      '<div class="ajuda">A coluna <b>Vence em</b> usa a validade efetiva: a data impressa no ' +
      'documento ou, quando ele não traz nenhuma, o prazo do tipo contado da emissão — 180 dias ' +
      'para a CNDT, 30 para o CRF do FGTS, 90 para quem não declara prazo. Quem calcula é o ' +
      'banco, uma vez só, para nenhuma tela inventar a sua regra.</div>';
  }

  function tarefas() {
    return '<div class="aviso">' + dados.tarefas.length +
      ' tarefa(s) de renovação em aberto: ' +
      U.esc(dados.tarefas.slice(0, 4).map(function (t) {
        return nomeEmpresa(t.empresa) + ' · ' + (tipoDe(t.tipo).nome || t.motivo) +
          (t.prazo ? ' (até ' + U.fData(t.prazo) + ')' : '');
      }).join(' · ')) + (dados.tarefas.length > 4 ? ' …' : '') + '</div>';
  }

  function filaAcao(fila) {
    return '<div class="tabela-rolagem"><table><thead><tr>' +
      '<th>Empresa</th><th>Documento</th><th>Vence em</th><th>Situação</th><th></th>' +
      '</tr></thead><tbody>' +
      fila.map(function (d) {
        const s = situacao(d), t = tipoDe(d.tipo);
        return '<tr><td>' + U.esc(nomeEmpresa(d.empresa)) + '</td>' +
          '<td class="desc">' + U.esc(d.tipo_nome || d.tipo) +
            (d.abrangencia === 'matriz'
              ? ' <span class="badge b-cancelado">matriz+filiais</span>' : '') + '</td>' +
          '<td class="mono">' + (d.validade_efetiva ? U.fData(d.validade_efetiva) : '—') + '</td>' +
          '<td><span class="badge ' + s.cls + '">' + s.txt + '</span></td>' +
          '<td class="acoes">' +
            (t.url_emissao
              ? '<a class="btn-sm" href="' + U.esc(t.url_emissao) +
                '" target="_blank" rel="noopener">Emitir</a>' : '') +
            (podeMexer()
              ? '<button class="btn-sm" data-hb-renovar="' + U.esc(d.empresa) + '|' +
                U.esc(d.tipo) + '">Subir nova</button>' : '') +
          '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function blocoFalta(falta) {
    const por = {};
    falta.forEach(function (f) { (por[f.empresa] = por[f.empresa] || []).push(f); });
    return '<h3 class="hb-titulo">Certidões que o cofre não tem</h3>' +
      '<div class="tabela-rolagem"><table><thead><tr><th>Empresa</th><th>Documentos</th>' +
      '</tr></thead><tbody>' +
      Object.keys(por).map(function (e) {
        return '<tr><td>' + U.esc(nomeEmpresa(e)) + '</td><td class="desc">' +
          U.esc(por[e].map(function (f) { return f.nome; }).join(', ')) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ── cofre ───────────────────────────────────────────── */
  function cofre() {
    const busca = filtro.busca.toLowerCase();
    const lista = (dados.documentos || []).filter(function (d) {
      return (!filtro.empresa || d.empresa === filtro.empresa) &&
             (!filtro.tipo || d.tipo === filtro.tipo) &&
             (!filtro.situacao || situacao(d).id === filtro.situacao) &&
             (!busca || ((d.tipo_nome || '') + ' ' + (d.numero || '') + ' ' +
                (d.arquivo_nome || '') + ' ' + (d.observacao || ''))
                .toLowerCase().indexOf(busca) >= 0);
    });
    const valem = {};
    vigentes().forEach(function (d) { valem[d.id] = true; });
    lista.sort(function (a, b) {
      return String(b.data_emissao || '').localeCompare(String(a.data_emissao || '')) ||
        String(a.tipo_nome || '').localeCompare(String(b.tipo_nome || ''));
    });

    return filtros() +
      (lista.length
        ? '<div class="tabela-rolagem"><table><thead><tr>' +
          '<th>Documento</th><th>Empresa</th><th>Número</th><th>Emissão</th>' +
          '<th>Validade</th><th>Situação</th><th></th></tr></thead><tbody>' +
          lista.map(function (d) {
            const s = situacao(d), vale = valem[d.id];
            return '<tr' + (vale ? '' : ' class="hb-velho"') + '>' +
              '<td class="desc">' + U.esc(d.tipo_nome || d.tipo) +
                (d.tipo_dado_pessoal
                  ? ' <span class="badge b-reprovado">dado de sócio</span>' : '') +
                (vale ? '' : ' <span class="badge b-cancelado">substituído</span>') +
                (d.arquivo_nome ? '<div class="sub">' + U.esc(d.arquivo_nome) + '</div>' : '') + '</td>' +
              '<td>' + U.esc(nomeEmpresa(d.empresa)) +
                (d.abrangencia === 'matriz' ? '<div class="sub">cobre as filiais</div>' : '') + '</td>' +
              '<td class="mono">' + U.esc(d.numero || '—') + '</td>' +
              '<td class="mono">' + (d.data_emissao ? U.fData(d.data_emissao) : '—') + '</td>' +
              '<td class="mono">' +
                (d.tipo_sem_validade ? '—'
                  : d.validade_efetiva ? U.fData(d.validade_efetiva) : '—') +
                (!d.data_validade && d.data_emissao && !d.tipo_sem_validade
                  ? '<div class="sub">' + (d.tipo_prazo_dias || 90) +
                    ' dias da emissão</div>' : '') + '</td>' +
              '<td><span class="badge ' + s.cls + '">' + s.txt + '</span></td>' +
              '<td class="acoes">' +
                (d.arquivo_path
                  ? '<button class="btn-sm" data-hb-abrir="' + U.esc(d.id) + '">Abrir</button>' : '') +
                (podeMexer()
                  ? '<button class="btn-sm" data-hb-editar="' + U.esc(d.id) + '">Editar</button>' : '') +
              '</td></tr>';
          }).join('') + '</tbody></table></div>'
        : '<div class="vazio"><strong>Nenhum documento neste filtro.</strong>' +
          (podeMexer() ? 'Use "+ Subir documento" para guardar o primeiro.' : '') + '</div>') +
      '<div class="ajuda">O arquivo fica num endereço privado e abre por link temporário de cinco ' +
      'minutos: documento de habilitação traz CNPJ, endereço e quadro societário, e não pode ficar ' +
      'num lugar que qualquer um alcança sabendo o caminho. A linha cinza é o documento já ' +
      'substituído por uma renovação — fica guardado porque provar regularidade numa data passada ' +
      'exige o documento daquela data.</div>';
  }

  function filtros() {
    const opc = (val, atual, rot) =>
      '<option value="' + U.esc(val) + '"' + (atual === val ? ' selected' : '') + '>' +
      U.esc(rot) + '</option>';
    return '<div class="filtros">' +
      '<div class="f"><label for="hb-f-emp">Empresa</label><select id="hb-f-emp">' +
        opc('', filtro.empresa, 'todas') +
        empresasAtivas().map(function (e) {
          return opc(e.id, filtro.empresa, e.apelido || e.nome); }).join('') + '</select></div>' +
      '<div class="f"><label for="hb-f-tipo">Tipo</label><select id="hb-f-tipo">' +
        opc('', filtro.tipo, 'todos') +
        (dados.tipos || []).map(function (t) {
          return opc(t.id, filtro.tipo, t.nome); }).join('') + '</select></div>' +
      '<div class="f"><label for="hb-f-sit">Situação</label><select id="hb-f-sit">' +
        [['', 'todas'], ['vencido', 'vencidos'], ['critico', 'vencem em 7 dias'],
         ['alerta', 'vencem em 15 dias'], ['atencao', 'vencem em 30 dias'],
         ['sem-data', 'sem validade lida'], ['ok', 'em dia'], ['perene', 'não vencem']]
          .map(function (o) { return opc(o[0], filtro.situacao, o[1]); }).join('') + '</select></div>' +
      '<div class="f"><label for="hb-f-busca">Buscar</label>' +
        '<input id="hb-f-busca" value="' + U.esc(filtro.busca) + '" placeholder="número, arquivo"></div>' +
      '<button class="btn-sm" id="hb-limpar">Limpar</button>' +
      '<button class="btn-sm" id="hb-atualizar">Atualizar</button>' +
      '</div>';
  }

  /* ── catálogo ────────────────────────────────────────── */
  const ROT_CAT = { cadastrais: 'Cadastrais', certidoes: 'Certidões', tecnico: 'Técnicos',
                    balancos: 'Contábeis', outros: 'Outros' };

  function catalogo() {
    const por = {};
    (dados.tipos || []).forEach(function (t) { (por[t.categoria] = por[t.categoria] || []).push(t); });
    return Object.keys(por).map(function (c) {
      return '<h3 class="hb-titulo">' + U.esc(ROT_CAT[c] || c) + '</h3>' +
        '<div class="tabela-rolagem"><table><thead><tr><th>Nome</th><th>Órgão</th>' +
        '<th class="num">Prazo</th><th>Como funciona</th></tr></thead><tbody>' +
        por[c].map(function (t) {
          const notas = [];
          if (t.sem_validade) notas.push('não vence');
          if (t.dado_pessoal) notas.push('dado pessoal de sócio — acesso restrito');
          if (t.exige_captcha) notas.push('a emissão exige captcha, não dá para automatizar');
          if (t.renovacao_automatica) notas.push('dá para renovar sem intervenção');
          return '<tr><td class="desc">' + U.esc(t.nome) +
              (t.sigla ? ' <span class="badge b-cancelado">' + U.esc(t.sigla) + '</span>' : '') + '</td>' +
            '<td class="sub">' + U.esc(t.orgao_emissor || '—') + '</td>' +
            '<td class="num">' + (t.prazo_padrao_dias ? t.prazo_padrao_dias + ' dias'
                : t.sem_validade ? '—' : 'varia') + '</td>' +
            '<td class="sub">' + U.esc(notas.join('; ') || '—') +
              (t.url_emissao ? ' · <a href="' + U.esc(t.url_emissao) +
                '" target="_blank" rel="noopener">onde emitir</a>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).join('') +
    '<div class="ajuda">As palavras-chave de cada tipo são o que faz o sistema adivinhar o ' +
    'documento quando o arquivo é subido. Ficam no banco, na tabela ' +
    '<code>hab_tipo_documento</code>, e valem para todas as empresas. Prazo "varia" é o do tipo ' +
    'que não dura o mesmo em todo lugar — a CND estadual de São Paulo não dura o mesmo que a do ' +
    'Rio Grande do Sul —, e aí o que vale é a data impressa no documento.</div>';
  }

  /* ── eventos ─────────────────────────────────────────── */
  function ligar() {
    const liga = function (id, ev, fn) { const e = U.el(id); if (e) e.addEventListener(ev, fn); };
    liga('hb-f-emp', 'change', function () { filtro.empresa = this.value; render(); });
    liga('hb-f-tipo', 'change', function () { filtro.tipo = this.value; render(); });
    liga('hb-f-sit', 'change', function () { filtro.situacao = this.value; render(); });
    liga('hb-f-busca', 'input', function () {
      filtro.busca = this.value; render();
      /* Redesenhar recria o campo e o foco volta para o começo da
         página; sem devolvê-lo, digitar o segundo caractere da
         busca era impossível. */
      const e = U.el('hb-f-busca');
      if (e) { e.focus(); e.setSelectionRange(e.value.length, e.value.length); }
    });
    liga('hb-limpar', 'click', function () {
      filtro = { empresa: '', tipo: '', situacao: '', busca: '' }; render();
    });
    liga('hb-atualizar', 'click', carregar);

    document.querySelectorAll('[data-hb-abrir]').forEach(function (b) {
      b.addEventListener('click', function () { abrirArquivo(this.dataset.hbAbrir); });
    });
    document.querySelectorAll('[data-hb-editar]').forEach(function (b) {
      b.addEventListener('click', function () { abrirFormulario(this.dataset.hbEditar); });
    });
    document.querySelectorAll('[data-hb-renovar]').forEach(function (b) {
      b.addEventListener('click', function () {
        const p = this.dataset.hbRenovar.split('|');
        abrirFormulario(null, { empresa: p[0], tipo: p[1] });
      });
    });
  }

  /* ── abrir o arquivo ─────────────────────────────────────
     Link ASSINADO, válido por cinco minutos. O balde é privado de
     propósito: um endereço público resolveria isto em uma linha e
     deixaria o RG do sócio alcançável para sempre por quem tivesse
     visto a URL uma vez. */
  async function abrirArquivo(id) {
    const d = (dados.documentos || []).find(function (x) { return x.id === id; });
    if (!d || !d.arquivo_path) return ERP.app.aviso('Este registro não tem arquivo guardado.', 'erro');
    const r = await cli().storage.from('habilitacao').createSignedUrl(d.arquivo_path, 300);
    if (r.error) return ERP.app.aviso('Não foi possível abrir: ' + r.error.message, 'erro');
    window.open(r.data.signedUrl, '_blank', 'noopener');
  }

  /* ── o formulário ────────────────────────────────────────
     O que o PDF disse aparece preenchido e editável, e o que o
     leitor não teve certeza aparece dito em vez de preenchido no
     escuro: digitar uma data é barato, ter uma data errada no
     semáforo é o que inabilita. */
  function abrirFormulario(id, sugestao) {
    const d = id ? (dados.documentos || []).find(function (x) { return x.id === id; }) : null;
    if (id && !d) return ERP.app.aviso('Documento não encontrado — atualize a tela.', 'erro');
    lido = null; arquivo = null;
    const base = d || sugestao || {};

    ERP.app.modal({
      titulo: d ? 'Editar documento' : 'Subir documento',
      corpo:
        (d ? '' :
          '<div class="importar" id="hb-solta">' +
            '<input type="file" id="hb-arq" accept=".pdf,.jpg,.jpeg,.png" style="display:none">' +
            '<div><b>Arraste o PDF aqui</b> ou ' +
            '<button class="btn-sm" id="hb-escolher">escolher arquivo</button></div>' +
            '<div class="ajuda">Leio do arquivo o tipo, o número, a emissão e a validade. ' +
            'Confira antes de guardar.</div>' +
          '</div>' +
          '<div id="hb-leitura"></div>') +
        '<div class="row2">' +
          '<div><label for="hb-empresa">Empresa</label><select id="hb-empresa">' +
            '<option value="">selecione</option>' +
            empresasAtivas().map(function (e) {
              return '<option value="' + U.esc(e.id) + '"' +
                (base.empresa === e.id ? ' selected' : '') + '>' +
                U.esc(e.apelido || e.nome) + '</option>'; }).join('') + '</select></div>' +
          '<div><label for="hb-tipo">Tipo de documento</label><select id="hb-tipo">' +
            '<option value="">selecione</option>' +
            (dados.tipos || []).map(function (t) {
              return '<option value="' + U.esc(t.id) + '"' +
                (base.tipo === t.id ? ' selected' : '') + '>' +
                U.esc(t.nome) + '</option>'; }).join('') + '</select></div>' +
          '<div><label for="hb-numero">Número</label>' +
            '<input id="hb-numero" value="' + U.esc(base.numero || '') + '"></div>' +
          '<div><label for="hb-abrang">Abrangência</label><select id="hb-abrang">' +
            '<option value="estabelecimento"' +
              (base.abrangencia !== 'matriz' ? ' selected' : '') + '>Só este CNPJ</option>' +
            '<option value="matriz"' +
              (base.abrangencia === 'matriz' ? ' selected' : '') + '>Matriz e filiais</option>' +
            '</select></div>' +
          '<div><label for="hb-emissao">Emissão</label>' +
            '<input type="date" id="hb-emissao" value="' + U.esc(base.data_emissao || '') + '"></div>' +
          '<div><label for="hb-validade">Validade</label>' +
            '<input type="date" id="hb-validade" value="' + U.esc(base.data_validade || '') + '">' +
            '<div class="ajuda" id="hb-validade-nota"></div></div>' +
        '</div>' +
        '<label for="hb-obs">Observação</label>' +
        '<textarea id="hb-obs" rows="2">' + U.esc(base.observacao || '') + '</textarea>' +
        (d && d.arquivo_nome
          ? '<div class="ajuda">Arquivo guardado: ' + U.esc(d.arquivo_nome) +
            '. Aqui mudam só os campos — para trocar o arquivo, suba um documento novo.</div>'
          : ''),
      acoes: [{ txt: d ? 'Salvar' : 'Guardar no cofre', fn: function () { salvar(id); } }]
        .concat(d && podeAdmin()
          ? [{ txt: 'Arquivar', cls: 'btn-sm', fn: function () { arquivar(id); } }] : []),
      aposAbrir: function () { ligarFormulario(d); }
    });
  }

  function ligarFormulario(d) {
    notaValidade();
    const tp = U.el('hb-tipo');
    if (tp) tp.addEventListener('change', notaValidade);
    if (d) return;

    const solta = U.el('hb-solta'), arq = U.el('hb-arq');
    U.el('hb-escolher').addEventListener('click', function () { arq.click(); });
    arq.addEventListener('change', function () {
      if (this.files && this.files[0]) lerArquivo(this.files[0]);
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      solta.addEventListener(ev, function (e) { e.preventDefault(); solta.classList.add('sobre'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      solta.addEventListener(ev, function (e) { e.preventDefault(); solta.classList.remove('sobre'); });
    });
    solta.addEventListener('drop', function (e) {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) lerArquivo(f);
    });
  }

  /* CONTAGEM DE DIAS SAI SEM CASA DECIMAL.

     A regra da casa é número 00.000,00, e ela vale para VALOR —
     dinheiro, quantidade medida. Dia é contagem: "180,00 dias" foi
     o que apareceu na tela quando apliquei U.num aqui, e não é
     formato, é erro de leitura. O resto do sistema já imprime dia
     cru (ui-ativos, ui-contratos), e este módulo acompanha.

     A nota embaixo do campo de validade: quando o tipo não vence, o
     campo não serve; quando o tipo tem prazo, dizer qual evita que
     alguém o deixe em branco achando que o sistema não sabe. */
  function notaValidade() {
    const nota = U.el('hb-validade-nota'), campo = U.el('hb-validade');
    if (!nota || !campo) return;
    const t = tipoDe(U.val('hb-tipo'));
    if (t.sem_validade) {
      campo.value = ''; campo.disabled = true;
      nota.textContent = 'Este tipo não vence.';
    } else {
      campo.disabled = false;
      nota.textContent = t.prazo_padrao_dias
        ? 'Em branco, vale ' + t.prazo_padrao_dias + ' dias da emissão.'
        : 'Em branco, vale 90 dias da emissão — o prazo que o edital costuma aceitar.';
    }
  }

  async function lerArquivo(f) {
    arquivo = f;
    const cx = U.el('hb-leitura');
    cx.innerHTML = '<div class="aviso">lendo ' + U.esc(f.name) + '…</div>';

    if (!/\.pdf$/i.test(f.name)) {
      cx.innerHTML = '<div class="aviso"><b>' + U.esc(f.name) + '</b> escolhido. ' +
        'Imagem não tem texto para ler — preencha os campos abaixo.</div>';
      return;
    }
    let texto = '';
    try {
      texto = (await ERP.danfe.textoDoPDF(await f.arrayBuffer())).texto || '';
    } catch (e) {
      cx.innerHTML = '<div class="aviso"><b>' + U.esc(f.name) + '</b> escolhido, mas não consegui ' +
        'ler o texto (' + U.esc(e.message) + '). Preencha os campos abaixo.</div>';
      return;
    }
    lido = ERP.habLeitura.ler(texto, dados.tipos);
    aplicarLeitura(f);
  }

  function aplicarLeitura(f) {
    const cx = U.el('hb-leitura');
    if (lido.vazio) {
      cx.innerHTML = '<div class="aviso"><b>' + U.esc(f.name) + '</b> escolhido. ' +
        U.esc(lido.avisos[0]) + '</div>';
      return;
    }
    /* Só preenche campo VAZIO: quem já escolheu a empresa a mão não
       quer ver a escolha trocada por um palpite. */
    const pre = function (id, v) { if (v && !U.val(id)) U.setVal(id, v); };
    pre('hb-tipo', lido.tipo);
    pre('hb-numero', lido.numero);
    pre('hb-emissao', lido.data_emissao);
    pre('hb-validade', lido.data_validade);
    if (lido.abrangencia === 'matriz') U.setVal('hb-abrang', 'matriz');

    /* O CNPJ lido escolhe a empresa — é onde errar custa mais
       (guardar a certidão da filial como sendo da matriz deixa as
       duas erradas) e onde acertar é mais fácil. */
    let achou = '';
    if (lido.cnpj) {
      const so = s => String(s || '').replace(/\D/g, '');
      const e = (D.empresas || []).find(function (x) { return so(x.cnpj) === lido.cnpj; });
      if (e) {
        achou = e.apelido || e.nome;
        if (!U.val('hb-empresa')) U.setVal('hb-empresa', e.id);
      }
    }
    notaValidade();

    const linhas = [];
    if (lido.tipo_nome) linhas.push('tipo: <b>' + U.esc(lido.tipo_nome) + '</b>');
    if (lido.numero) linhas.push('número ' + U.esc(lido.numero));
    if (lido.data_emissao) linhas.push('emissão ' + U.fData(lido.data_emissao));
    if (lido.data_validade) linhas.push('validade ' + U.fData(lido.data_validade));
    if (achou) linhas.push('empresa pelo CNPJ: <b>' + U.esc(achou) + '</b>');
    else if (lido.cnpj) linhas.push('o CNPJ ' + U.esc(lido.cnpj) + ' não é de nenhuma empresa cadastrada');
    if (lido.abrangencia === 'matriz') linhas.push('cobre matriz e filiais');

    cx.innerHTML = '<div class="aviso"><b>' + U.esc(f.name) + '</b> — li: ' +
      (linhas.join(' · ') || 'nada com certeza') + '.' +
      (lido.avisos.length
        ? '<div style="margin-top:4px;color:var(--red)">' +
          lido.avisos.map(U.esc).join('<br>') + '</div>' : '') + '</div>';
  }

  /* ── guardar ─────────────────────────────────────────── */
  async function salvar(id) {
    const empresa = U.val('hb-empresa'), tipo = U.val('hb-tipo');
    if (!empresa) return ERP.app.erroCampo('hb-empresa', 'Escolha a empresa.');
    if (!tipo) return ERP.app.erroCampo('hb-tipo', 'Escolha o tipo de documento.');
    const t = tipoDe(tipo);
    const emissao = U.val('hb-emissao') || null;
    const validade = t.sem_validade ? null : (U.val('hb-validade') || null);

    if (validade && emissao && validade < emissao) {
      return ERP.app.erroCampo('hb-validade', 'A validade não pode ser anterior à emissão.');
    }
    /* Sem emissão e sem validade, o documento entraria no cofre sem
       semáforo: guardado e invisível para o alerta, que é
       exatamente o engano que o módulo existe para evitar. */
    if (!t.sem_validade && !validade && !emissao) {
      return ERP.app.erroCampo('hb-emissao',
        'Informe a emissão ou a validade — sem uma das duas o documento não entra no alerta.');
    }
    if (!id && !arquivo) return ERP.app.aviso('Escolha o arquivo do documento.', 'erro');

    const c = cli();
    const campos = {
      empresa: empresa, tipo: tipo,
      numero: U.val('hb-numero') || null,
      data_emissao: emissao, data_validade: validade,
      abrangencia: U.val('hb-abrang') || 'estabelecimento',
      observacao: U.val('hb-obs') || null
    };

    if (id) {
      const r = await c.from('hab_documento').update(campos).eq('id', id);
      if (r.error) return ERP.app.aviso('Não salvou: ' + r.error.message, 'erro');
      ERP.app.fecharModal();
      ERP.app.aviso('Documento atualizado.');
      return carregar();
    }

    /* O caminho no balde nasce do par empresa+tipo mais o instante:
       dois arquivos do mesmo tipo da mesma empresa convivem (a
       renovação não apaga o anterior) e o nome não colide. */
    const limpo = arquivo.name.replace(/[^\w.\-]+/g, '_').slice(-80);
    const caminho = empresa + '/' + tipo + '/' + Date.now() + '-' + limpo;

    const sub = await c.storage.from('habilitacao')
      .upload(caminho, arquivo, { contentType: arquivo.type || 'application/octet-stream' });
    if (sub.error) return ERP.app.aviso('O arquivo não subiu: ' + sub.error.message, 'erro');

    campos.id = 'hd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    campos.arquivo_path = caminho;
    campos.arquivo_nome = arquivo.name;
    campos.arquivo_bytes = arquivo.size;
    campos.arquivo_hash = await digerir(arquivo);
    campos.criado_por = (S.usuario() || {}).id || null;

    const r = await c.from('hab_documento').insert(campos);
    if (r.error) {
      /* O índice único é por empresa+hash: subir o MESMO arquivo
         duas vezes para a mesma empresa é quase sempre engano. O
         arquivo que acabou de subir sai do balde — deixá-lo lá
         acumularia lixo que ninguém encontraria depois. */
      await c.storage.from('habilitacao').remove([caminho]);
      const dup = /duplicate key|hab_doc_hash/i.test(r.error.message);
      return ERP.app.aviso(dup
        ? 'Este arquivo já está no cofre para esta empresa.'
        : 'O arquivo subiu mas o registro não gravou: ' + r.error.message, 'erro');
    }
    arquivo = null;
    ERP.app.fecharModal();
    ERP.app.aviso('Documento guardado no cofre.');
    carregar();
  }

  /* SHA-256 do conteúdo, para reconhecer o arquivo repetido. */
  async function digerir(f) {
    try {
      const b = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
      return Array.from(new Uint8Array(b))
        .map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    } catch (e) { return null; }
  }

  /* Arquivar, não apagar: o documento sai da vista e continua no
     cofre. Apagar certidão é perder a prova de regularidade de uma
     data que pode ser pedida depois. */
  async function arquivar(id) {
    const r = await cli().from('hab_documento').update({ arquivado: true }).eq('id', id);
    if (r.error) return ERP.app.aviso('Não arquivou: ' + r.error.message, 'erro');
    ERP.app.fecharModal();
    ERP.app.aviso('Documento arquivado — sai da lista e continua guardado.');
    carregar();
  }

  return {
    montar: montar, render: render, carregar: carregar,
    situacao: situacao, vigentes: vigentes, faltando: faltando,
    _dados: function () { return dados; }
  };
})();
