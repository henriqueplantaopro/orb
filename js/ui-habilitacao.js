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

/* O MÓDULO SE CHAMA "DOCUMENTAÇÃO" NA TELA; o id continua
   `habilitacao`, e isso é de propósito.

   O id está gravado na matriz de acesso e dentro das políticas do
   banco (`tem_nivel('habilitacao', ...)`), nas sete tabelas e no
   balde de arquivos. Trocar o id junto com o rótulo exigiria
   migração de SQL em dois bancos e, no intervalo entre uma coisa e
   outra, tiraria o acesso de todo mundo ao cofre. O nome que
   aparece é o que importa para quem usa; o identificador é
   encanamento. */
ERP.habilitacao = (function () {
  const U = ERP.util, S = ERP.store, D = ERP.dados;

  let aba = 'painel';
  let filtro = { empresa: '', categoria: '', tipo: '', situacao: '', busca: '' };
  /* As tabelas deste módulo ficam fora do mapa de sincronização por
     sombra: o cofre é leitura e escrita diretas, não movimento com
     foto anterior. Então o que foi lido vive aqui. */
  let dados = { tipos: [], documentos: [], tarefas: [], lido: null, erro: null };
  let carregando = false;
  /* O que está marcado no cofre para alteração em massa. */
  const marcados = new Set();
  /* Empresa e tipo sugeridos pelo botão "Subir nova" da fila do
     painel: o lote que vier nasce com eles onde o leitor não
     souber. */
  let sugerido = null;

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

     SUBSTITUIÇÃO SÓ EXISTE ONDE HÁ RENOVAÇÃO.

     A primeira versão colapsava tudo por empresa+tipo e marcava o
     resto como "substituído". Está certo para certidão: a CND nova
     torna a anterior inútil. Está ERRADO para todo o resto. Uma
     empresa tem dez atestados de capacidade técnica e os dez
     valem — é justamente o acervo deles que ganha a licitação. Tem
     o balanço de cada exercício, e todos continuam de pé. Tem o
     contrato social e suas alterações, que se somam em vez de se
     substituírem.

     Marcar nove atestados como "substituídos" é pior que feio:
     some com prova que a empresa tem.

     Então o colapso vale só para o tipo que VENCE. O tipo sem
     validade devolve cada documento por si. */
  function vigentes(lista) {
    const por = {};
    (lista || dados.documentos || []).forEach(function (d) {
      const k = d.tipo_sem_validade
        ? 'id:' + d.id                       // cada um vale por si
        : d.empresa + '|' + d.tipo;
      const atual = por[k];
      if (!atual) { por[k] = d; return; }
      /* A comparação é pela validade, não pela emissão: uma
         certidão emitida depois pode valer menos — a estadual de
         trinta dias emitida hoje vence antes da de cento e oitenta
         emitida no mês passado — e quem manda é até quando vale. */
      const a = d.validade_efetiva || d.data_emissao || '';
      const b = atual.validade_efetiva || atual.data_emissao || '';
      if (a > b) por[k] = d;
    });
    return Object.keys(por).map(function (k) { return por[k]; });
  }

  /* ── a quem o documento pertence ─────────────────────────
     Três respostas possíveis, e é assim que se pensa no papel:
     é da Matriz, é da Filial, ou é ÚNICO — serve para as duas.

     "Único" não é invenção administrativa: a CND Federal diz, com
     essas palavras, que vale para o estabelecimento matriz e suas
     filiais. O que define o alcance é a RAIZ do CNPJ (os oito
     primeiros dígitos), que é o que identifica a empresa; os
     quatro seguintes são o estabelecimento. Novaped tem outra
     raiz, então nunca é coberta por um documento da HJM — e isso
     cai de graça da regra, sem precisar de exceção escrita. */
  const raizCnpj = c => String(c || '').replace(/\D/g, '').slice(0, 8);
  const empresaPor = id => (D.empresas || []).find(function (e) { return e.id === id; }) || null;

  function empresasCobertas(d) {
    if (!d) return [];
    if (d.abrangencia !== 'matriz') return [d.empresa];
    const dona = empresaPor(d.empresa);
    if (!dona) return [d.empresa];
    const r = raizCnpj(dona.cnpj);
    const irmas = empresasAtivas().filter(function (e) { return raizCnpj(e.cnpj) === r; });
    return irmas.length ? irmas.map(function (e) { return e.id; }) : [d.empresa];
  }

  /* As opções do campo "Pertence a": cada empresa, mais um "Único"
     por raiz que tenha mais de um estabelecimento. */
  function opcoesPertence() {
    const fora = empresasAtivas().map(function (e) {
      return { v: e.id, rot: e.apelido || e.nome };
    });
    const porRaiz = {};
    empresasAtivas().forEach(function (e) {
      const r = raizCnpj(e.cnpj);
      (porRaiz[r] = porRaiz[r] || []).push(e);
    });
    Object.keys(porRaiz).forEach(function (r) {
      const g = porRaiz[r];
      if (g.length < 2) return;
      fora.push({ v: 'unico:' + r,
        rot: 'Único — ' + g.map(function (e) { return e.apelido || e.nome; }).join(' e ') });
    });
    return fora;
  }

  function dePertence(valor) {
    if (/^unico:/.test(valor || '')) {
      const r = String(valor).slice(6);
      const g = empresasAtivas().filter(function (e) { return raizCnpj(e.cnpj) === r; });
      const m = g.find(function (e) { return e.matriz; }) || g[0];
      return { empresa: m ? m.id : '', abrangencia: 'matriz' };
    }
    return { empresa: valor || '', abrangencia: 'estabelecimento' };
  }

  function paraPertence(d) {
    if (d && d.abrangencia === 'matriz') {
      const e = empresaPor(d.empresa);
      const r = e ? raizCnpj(e.cnpj) : '';
      if (r && empresasAtivas().filter(function (x) { return raizCnpj(x.cnpj) === r; }).length > 1) {
        return 'unico:' + r;
      }
    }
    return (d && d.empresa) || '';
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
    if (n) n.addEventListener('click', function () { aba = 'subir'; sugerido = null; render(); });
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
      saida.innerHTML = '<div class="vazio"><strong>Seu perfil não tem acesso a Documentação.</strong>' +
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

    saida.innerHTML =
      aba === 'cofre' ? cofre() :
      aba === 'subir' ? telaSubir() :
      aba === 'tipos' ? catalogo() : painel();
    ligar();
    if (aba === 'subir') ligarSubir();
  }

  /* ── painel: o checklist por empresa ────────────────────
     Um cartão por empresa, um crachá por tipo de documento. Verde
     é o que está em dia, âmbar o que vence dentro de trinta dias,
     vermelho o que venceu ou o que falta.

     Este desenho substituiu a fila de pendências, e por um motivo
     concreto: a fila respondia "o que vence primeiro", que é a
     pergunta do dia a dia, mas não respondia "a Filial está apta?"
     — que é a pergunta de quem vai entregar um envelope amanhã.
     Com o checklist as duas aparecem: o vermelho salta, e o verde
     ao redor é a prova de que o resto foi conferido.

     Os crachás QUEBRAM a linha em vez de empurrar a tela, e os
     cartões viram uma coluna só quando não cabem dois. Nada corre
     para o lado. */
  function painel() {
    const v = vigentes();
    const emp = empresasAtivas();
    if (!emp.length) return '<div class="vazio">Nenhuma empresa cadastrada.</div>';

    /* O que vale, por empresa e tipo — já contando os documentos
       marcados como Único, que cobrem todas as empresas da mesma
       raiz de CNPJ. */
    const mapa = {};
    v.forEach(function (d) {
      empresasCobertas(d).forEach(function (eid) {
        const k = eid + '|' + d.tipo;
        const atual = mapa[k];
        if (!atual) { mapa[k] = d; return; }
        const a = d.validade_efetiva || d.data_emissao || '';
        const b = atual.validade_efetiva || atual.data_emissao || '';
        if (a > b) mapa[k] = d;
      });
    });

    /* "Outro documento" fica de fora do checklist: é a gaveta do
       que não tem categoria, e cobrar a presença dela não faz
       sentido. */
    const tipos = (dados.tipos || []).filter(function (t) { return t.id !== 'outro'; });

    let faltam = 0, vencidos = 0, vencendo = 0;
    const cartoes = emp.map(function (e) {
      const chips = tipos.map(function (t) {
        const d = mapa[e.id + '|' + t.id];
        if (!d) { faltam++; return chip('falta ' + t.nome, 'b-reprovado', t.nome + ' — não está no cofre'); }
        const st = situacao(d);
        if (st.id === 'vencido') { vencidos++; return chip(t.nome + ' vencido', 'b-reprovado',
          'venceu em ' + U.fData(d.validade_efetiva)); }
        if (st.id === 'critico' || st.id === 'alerta' || st.id === 'atencao') {
          vencendo++;
          return chip(t.nome + ' vence em ' + d.dias_para_vencer + 'd', 'b-pendente',
            'vence em ' + U.fData(d.validade_efetiva));
        }
        if (st.id === 'sem-data') return chip(t.nome + ' sem validade', 'b-pendente',
          'o documento está guardado, mas sem data para o alerta');
        return chip(t.nome, 'b-pago', d.validade_efetiva
          ? 'vale até ' + U.fData(d.validade_efetiva) : 'não vence');
      }).join('');
      return '<div class="hb-cartao"><div class="hb-cartao-nome">' +
        U.esc(e.apelido || e.nome) +
        (e.municipio ? ' <span class="sub">(' + U.esc(e.municipio) + ')</span>' : '') +
        '</div><div class="hb-chips">' + chips + '</div></div>';
    }).join('');

    return indicadores(vencidos, vencendo, faltam) +
      (dados.tarefas.length ? tarefas() : '') +
      '<h3 class="hb-titulo">Checklist por empresa — o que falta ou está vencido</h3>' +
      '<div class="hb-cartoes">' + cartoes + '</div>' +
      '<div class="ajuda">Verde está em dia, âmbar vence dentro de trinta dias, vermelho venceu ou ' +
      'não está no cofre. O documento marcado como <b>Único</b> conta para as duas empresas da HJM, ' +
      'porque é isso que a certidão de matriz diz de si: vale para o estabelecimento matriz e suas ' +
      'filiais. A Novaped tem outra raiz de CNPJ e nunca é coberta por um documento da HJM. ' +
      'O prazo usa a validade impressa no documento ou, quando ele não traz nenhuma, o prazo do ' +
      'tipo contado da emissão.</div>';
  }

  const chip = (txt, cls, titulo) =>
    '<span class="badge ' + cls + ' hb-chip"' +
    (titulo ? ' title="' + U.esc(titulo) + '"' : '') + '>' + U.esc(txt) + '</span>';

  function indicadores(vencidos, vencendo, faltam) {
    const cartao = (rot, val, det, vermelho) =>
      '<div class="ind-card"><div class="rot">' + rot + '</div>' +
      '<div class="valor"' + (vermelho && val !== '0' ? ' style="color:var(--red)"' : '') + '>' +
      val + '</div><div class="det">' + det + '</div></div>';
    return '<div class="ind-grade">' +
      cartao('Vencidos', String(vencidos), 'inabilitam hoje', true) +
      cartao('Vencem em 30 dias', String(vencendo), 'entram na fila de renovação') +
      cartao('Faltam no cofre', String(faltam), 'nunca foram guardados', true) +
      '</div>';
  }

  function tarefas() {
    return '<div class="aviso">' + dados.tarefas.length +
      ' tarefa(s) de renovação em aberto: ' +
      U.esc(dados.tarefas.slice(0, 4).map(function (t) {
        return nomeEmpresa(t.empresa) + ' · ' + (tipoDe(t.tipo).nome || t.motivo) +
          (t.prazo ? ' (até ' + U.fData(t.prazo) + ')' : '');
      }).join(' · ')) + (dados.tarefas.length > 4 ? ' …' : '') + '</div>';
  }

  /* ── cofre ───────────────────────────────────────────── */
  function cofre() {
    const busca = filtro.busca.toLowerCase();
    const lista = (dados.documentos || []).filter(function (d) {
      /* Filtrar por empresa inclui o que é ÚNICO: um documento do
         grupo é documento da Matriz e da Filial, e escondê-lo ao
         filtrar por uma delas faria o cofre parecer vazio
         justamente onde ele está completo. */
      return (!filtro.empresa || empresasCobertas(d).indexOf(filtro.empresa) >= 0) &&
             (!filtro.categoria || (tipoDe(d.tipo).categoria || 'outros') === filtro.categoria) &&
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
        ? barraMassa(lista) +
          '<div class="tabela-rolagem"><table><thead><tr>' +
          (podeMexer()
            ? '<th style="width:24px"><input type="checkbox" id="hb-marca-todos"' +
              (lista.length && lista.every(function (d) { return marcados.has(d.id); })
                ? ' checked' : '') + '></th>'
            : '') +
          '<th>Documento</th><th>Pertence a</th><th>Número</th><th>Emissão</th>' +
          '<th>Validade</th><th>Situação</th><th></th></tr></thead><tbody>' +
          lista.map(function (d) {
            const s = situacao(d), vale = valem[d.id];
            return '<tr' + (vale ? '' : ' class="hb-velho"') + '>' +
              (podeMexer()
                ? '<td><input type="checkbox" data-hb-marca="' + U.esc(d.id) + '"' +
                  (marcados.has(d.id) ? ' checked' : '') + '></td>'
                : '') +
              '<td class="desc">' + U.esc(d.tipo_nome || d.tipo) +
                (d.tipo_dado_pessoal
                  ? ' <span class="badge b-reprovado">dado de sócio</span>' : '') +
                (vale ? '' : ' <span class="badge b-cancelado">substituído</span>') +
                (d.arquivo_nome ? '<div class="sub">' + U.esc(d.arquivo_nome) + '</div>' : '') + '</td>' +
              '<td>' + U.esc(d.abrangencia === 'matriz' ? 'Único' : nomeEmpresa(d.empresa)) +
                (d.abrangencia === 'matriz'
                  ? '<div class="sub">' + U.esc(empresasCobertas(d).map(nomeEmpresa).join(' e ')) +
                    '</div>'
                  : '') + '</td>' +
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

  /* ── alterar em massa ────────────────────────────────────
     Subir trinta atestados como "Matriz" e depois descobrir que
     quase todos são do grupo é o caso normal — e corrigir um a
     um, abrindo e fechando trinta formulários, é o tipo de
     trabalho que faz a pessoa desistir e deixar errado.

     A barra só aparece com algo marcado, e cada campo é
     OPCIONAL: muda o que você escolher e deixa o resto como
     está. A gravação é UM pedido ao banco com todos os ids, não
     trinta — além de rápido, ou grava tudo ou não grava nada. */
  function barraMassa(lista) {
    if (!podeMexer()) return '';
    const n = marcados.size;
    if (!n) {
      return '<div class="ajuda" style="margin:-4px 0 8px">Marque as linhas para alterar ' +
        'várias de uma vez — útil para corrigir a quem pertencem os atestados.</div>';
    }
    return '<div class="filtros" id="hb-barra-massa" ' +
      'style="background:var(--brand-soft);padding:8px;border-radius:6px">' +
      '<div class="f" style="min-width:auto;align-self:center"><b>' + n + ' marcado(s)</b></div>' +
      '<div class="f" style="min-width:200px"><label for="hb-m-pert">Passar a pertencer a</label>' +
        '<select id="hb-m-pert"><option value="">não mudar</option>' +
        opcoesPertence().map(function (o) {
          return '<option value="' + U.esc(o.v) + '">' + U.esc(o.rot) + '</option>'; }).join('') +
        '</select></div>' +
      '<div class="f" style="min-width:200px"><label for="hb-m-tipo">Passar a ser do tipo</label>' +
        '<select id="hb-m-tipo"><option value="">não mudar</option>' +
        (dados.tipos || []).map(function (t) {
          return '<option value="' + U.esc(t.id) + '">' + U.esc(t.nome) + '</option>'; }).join('') +
        '</select></div>' +
      '<button class="btn-linha" id="hb-m-aplicar">Aplicar aos ' + n + '</button>' +
      (podeAdmin()
        ? '<button class="btn-sm btn-cancelar" id="hb-m-arquivar">Arquivar os ' + n + '</button>' : '') +
      '<button class="btn-sm" id="hb-m-limpar">Desmarcar</button>' +
      '</div>';
  }

  async function aplicarEmMassa() {
    const ids = Array.from(marcados);
    if (!ids.length) return;
    const pert = U.val('hb-m-pert'), tipo = U.val('hb-m-tipo');
    if (!pert && !tipo) {
      return ERP.app.aviso('Escolha o que mudar — pertence a, tipo, ou os dois.', 'erro');
    }
    const campos = {};
    if (pert) {
      const q = dePertence(pert);
      campos.empresa = q.empresa;
      campos.abrangencia = q.abrangencia;
    }
    if (tipo) {
      campos.tipo = tipo;
      /* Virar um tipo que NÃO VENCE tem de apagar a validade: ela
         deixaria o documento no semáforo para sempre, com uma data
         que o tipo novo não tem. */
      if (tipoDe(tipo).sem_validade) campos.data_validade = null;
    }
    const r = await cli().from('hab_documento').update(campos).in('id', ids);
    if (r.error) return ERP.app.aviso('Não alterou: ' + r.error.message, 'erro');
    marcados.clear();
    ERP.app.aviso(ids.length + ' documento(s) alterado(s).');
    carregar();
  }

  async function arquivarEmMassa() {
    const ids = Array.from(marcados);
    if (!ids.length) return;
    ERP.app.modal({
      titulo: 'Arquivar ' + ids.length + ' documento(s)',
      corpo: '<div class="ajuda">Arquivar tira da lista e <b>mantém guardado</b> — o arquivo ' +
        'continua no cofre e pode ser reaberto no banco. Nada é apagado.</div>',
      acoes: [{ txt: 'Arquivar', cls: 'btn-cancelar', fn: async function () {
        const r = await cli().from('hab_documento').update({ arquivado: true }).in('id', ids);
        if (r.error) return ERP.app.aviso('Não arquivou: ' + r.error.message, 'erro');
        marcados.clear();
        ERP.app.fecharModal();
        ERP.app.aviso(ids.length + ' documento(s) arquivado(s).');
        carregar();
      } }]
    });
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
      '<div class="f"><label for="hb-f-cat">Categoria</label><select id="hb-f-cat">' +
        opc('', filtro.categoria, 'todas') +
        categoriasUsadas().map(function (c) {
          return opc(c[0], filtro.categoria, c[1]); }).join('') + '</select></div>' +
      '<div class="f"><label for="hb-f-tipo">Tipo</label><select id="hb-f-tipo">' +
        opc('', filtro.tipo, 'todos') +
        (dados.tipos || []).filter(function (t) {
          /* O seletor de tipo acompanha a categoria escolhida —
             senão ele oferece 31 tipos dos quais 28 não casam com
             o filtro ao lado e devolvem lista vazia. */
          return !filtro.categoria || (t.categoria || 'outros') === filtro.categoria;
        }).map(function (t) {
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
      '<button class="btn-linha" id="hb-baixar-lote">Baixar em lote</button>' +
      '</div>';
  }

  /* ── catálogo ────────────────────────────────────────── */
  /* As categorias são as do edital, não as do programador: é por
     elas que se monta um envelope de habilitação. A ordem é a que
     aparece na tela e dentro do zip. */
  const CATEGORIAS = [
    ['cadastrais',   'Cadastrais'],
    ['certidoes',    'Certidões'],
    ['tecnico_crm',  'Técnicos — CRM / conselhos de saúde'],
    ['tecnico_crea', 'Técnicos — CREA / engenharia'],
    ['atestados',    'Atestados de capacidade técnica'],
    ['contabeis',    'Contábeis'],
    ['outros',       'Outros'],
    /* Nomes antigos, para o cofre não esconder documento enquanto
       o 45-documentacao-categorias.sql não tiver rodado. */
    ['tecnico',      'Técnicos (categoria antiga)'],
    ['balancos',     'Contábeis (categoria antiga)']
  ];
  const ROT_CAT = {};
  CATEGORIAS.forEach(function (c) { ROT_CAT[c[0]] = c[1]; });
  /* Só as que de fato têm tipo no catálogo aparecem nos filtros. */
  const categoriasUsadas = () => CATEGORIAS.filter(function (c) {
    return (dados.tipos || []).some(function (t) { return t.categoria === c[0]; });
  });

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
    liga('hb-f-cat', 'change', function () {
      filtro.categoria = this.value;
      /* Trocar de categoria limpa o tipo: manter um tipo de outra
         categoria deixa a lista vazia sem dizer por quê. */
      filtro.tipo = '';
      render();
    });
    liga('hb-f-tipo', 'change', function () { filtro.tipo = this.value; render(); });
    liga('hb-baixar-lote', 'click', abrirBaixaEmLote);
    liga('hb-m-aplicar', 'click', aplicarEmMassa);
    liga('hb-m-arquivar', 'click', arquivarEmMassa);
    liga('hb-m-limpar', 'click', function () { marcados.clear(); render(); });
    liga('hb-marca-todos', 'change', function () {
      /* "Todos" é todos os que ESTÃO NO FILTRO, não os do cofre
         inteiro: marcar o que não está na tela é o jeito mais
         fácil de alterar o que não se queria. */
      const visiveis = Array.from(document.querySelectorAll('[data-hb-marca]'))
        .map(function (c) { return c.dataset.hbMarca; });
      if (this.checked) visiveis.forEach(function (id) { marcados.add(id); });
      else visiveis.forEach(function (id) { marcados.delete(id); });
      render();
    });
    document.querySelectorAll('[data-hb-marca]').forEach(function (c) {
      c.addEventListener('change', function () {
        if (this.checked) marcados.add(this.dataset.hbMarca);
        else marcados.delete(this.dataset.hbMarca);
        render();
      });
    });
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
      filtro = { empresa: '', categoria: '', tipo: '', situacao: '', busca: '' }; render();
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
        aba = 'subir';
        sugerido = { empresa: p[0], tipo: p[1] };
        render();
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


  /* ═══════════════════════════════════════════════════════════
     ENVIAR EM LOTE

     Subir uma certidão por vez é aceitável para quem tem uma
     empresa. Com quatro empresas e treze certidões cada, são
     cinquenta e dois formulários — e nenhum cofre se mantém em dia
     a esse preço. A pasta inteira entra de uma vez.

     O desenho é: o sistema arrisca um palpite em TODO campo que
     consegue, mostra tudo numa tabela editável, e deixa claro o
     que ele não soube. Quem confere corrige três linhas em vez de
     digitar cinquenta.

     DUAS DECISÕES QUE PARECEM DETALHE E NÃO SÃO

     A tabela NÃO é redesenhada a cada tecla. Redesenhar devolve o
     foco ao começo da página, e numa tabela de vinte linhas isso
     torna a correção impossível — foi o que aconteceu com o campo
     de busca do cofre. Aqui cada controle muda só o estado e
     reescreve a própria linha de situação.

     Nada é gravado até você mandar. O lote vive na memória da
     página; fechar a aba antes de guardar não deixa meia coisa no
     cofre.
     ═══════════════════════════════════════════════════════════ */

  /* Cada arquivo escolhido vira uma linha. */
  let lote = [];
  let lendo = null;      // { feitos, total } enquanto lê os PDFs
  let gravando = null;   // { feitos, total } enquanto grava

  const ACEITOS = /\.(pdf|jpe?g|png)$/i;

  function telaSubir() {
    return (sugerido
      ? '<div class="aviso">Renovando <b>' + U.esc(tipoDe(sugerido.tipo).nome || sugerido.tipo) +
        '</b> de <b>' + U.esc(nomeEmpresa(sugerido.empresa)) + '</b>. O que o documento disser ' +
        'vale mais que isto — a sugestão só preenche o que eu não conseguir ler.</div>'
      : '') +
      '<div class="importar" id="hb-solta">' +
        '<input type="file" id="hb-arqs" accept=".pdf,.jpg,.jpeg,.png" multiple style="display:none">' +
        /* `webkitdirectory` é o único jeito de o navegador aceitar
           uma pasta pelo botão. O nome é feio e não-padrão, mas
           funciona em Chrome, Edge e Firefox. */
        '<input type="file" id="hb-pasta" webkitdirectory directory multiple style="display:none">' +
        '<div class="tit">Arraste aqui a pasta ou os arquivos</div>' +
        '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' +
          '<button class="btn-sm" id="hb-escolher">Escolher arquivos</button>' +
          '<button class="btn-sm" id="hb-escolher-pasta">Escolher uma pasta</button>' +
        '</div>' +
        '<div class="ajuda">PDF, JPG ou PNG. De cada arquivo eu tento ler o tipo, a empresa, ' +
        'o número e as datas — pelo conteúdo e, quando ele não diz, pelo nome do arquivo. ' +
        'O que eu não souber fica marcado para você completar.</div>' +
      '</div>' +
      (lendo ? '<div class="aviso">lendo ' + lendo.feitos + ' de ' + lendo.total + '…</div>' : '') +
      (gravando ? '<div class="aviso">guardando ' + gravando.feitos + ' de ' + gravando.total + '…</div>' : '') +
      (lote.length ? barraLote() + tabelaLote() : '');
  }

  function problema(l) {
    if (l.estado === 'guardado') return null;
    if (l.estado === 'repetido') return 'este arquivo já está no cofre';
    if (l.estado === 'erro') return l.erro;
    if (!l.campos.empresa) return 'falta a empresa';
    if (!l.campos.tipo) return 'falta o tipo';
    const t = tipoDe(l.campos.tipo);
    if (!t.sem_validade && !l.campos.data_validade && !l.campos.data_emissao) {
      return 'falta a emissão ou a validade';
    }
    if (l.campos.data_validade && l.campos.data_emissao &&
        l.campos.data_validade < l.campos.data_emissao) {
      return 'a validade está antes da emissão';
    }
    return null;
  }

  const prontas = () => lote.filter(function (l) {
    return l.estado !== 'guardado' && l.estado !== 'repetido' && !problema(l);
  });

  function barraLote() {
    const faltando = lote.filter(function (l) {
      return l.estado !== 'guardado' && l.estado !== 'repetido' && problema(l);
    }).length;
    const guardados = lote.filter(function (l) { return l.estado === 'guardado'; }).length;
    const repetidos = lote.filter(function (l) { return l.estado === 'repetido'; }).length;

    return '<div class="filtros" style="margin-top:12px">' +
      /* Uma pasta quase sempre é de uma empresa só. Preencher as
         que ficaram em branco de uma vez economiza o trabalho
         repetitivo que a tela veio evitar. */
      '<div class="f" style="min-width:220px">' +
        '<label for="hb-todos-emp">Pertence a — para as que estão em branco</label>' +
        '<select id="hb-todos-emp"><option value="">escolha</option>' +
        opcoesPertence().map(function (o) {
          return '<option value="' + U.esc(o.v) + '">' + U.esc(o.rot) + '</option>';
        }).join('') + '</select></div>' +
      '<button class="btn-sm" id="hb-aplicar-emp">Aplicar</button>' +
      '<div style="flex:1"></div>' +
      '<div class="ajuda" id="hb-resumo" style="margin:0 8px 6px 0">' + resumoLote() + '</div>' +
      '<button class="btn-sm" id="hb-limpar-lote">Limpar lista</button>' +
      '<button class="btn-linha" id="hb-guardar-lote"' +
        (prontas().length && !gravando ? '' : ' disabled') + '>Guardar ' +
        prontas().length + ' documento(s)</button>' +
      '</div>' +
      (faltando ? '<div class="aviso">' + faltando + ' linha(s) esperando você: o que falta está ' +
        'escrito em vermelho ao lado do arquivo. Complete ou tire da lista — o botão guarda só as ' +
        'que estão prontas.</div>' : '') +
      (repetidos ? '<div class="aviso">' + repetidos + ' arquivo(s) já estão no cofre e ficam de ' +
        'fora.</div>' : '') +
      (guardados ? '<div class="aviso">' + guardados + ' guardado(s) nesta sessão.</div>' : '');
  }

  function resumoLote() {
    const n = prontas().length;
    const f = lote.filter(function (l) {
      return l.estado !== 'guardado' && l.estado !== 'repetido' && problema(l);
    }).length;
    return lote.length + ' arquivo(s) · ' + n + ' pronto(s)' + (f ? ' · ' + f + ' incompleto(s)' : '');
  }

  function tabelaLote() {
    return '<div class="tabela-rolagem"><table><thead><tr>' +
      '<th>Arquivo</th><th>Pertence a</th><th>Tipo</th><th>Emissão</th><th>Validade</th><th></th>' +
      '</tr></thead><tbody>' + lote.map(linhaLote).join('') + '</tbody></table></div>' +
      '<div class="ajuda">O que está escrito nos campos é o palpite do sistema, e é para ser ' +
      'corrigido onde estiver errado. Nada vai para o cofre antes de você clicar em Guardar.</div>';
  }

  function linhaLote(l, i) {
    const t = tipoDe(l.campos.tipo);
    const guardado = l.estado === 'guardado';
    const parado = guardado || l.estado === 'repetido';
    const trava = parado ? ' disabled' : '';

    return '<tr id="hb-l' + i + '"' + (parado ? ' class="hb-velho"' : '') + '>' +
      '<td class="desc">' + U.esc(l.nome) +
        '<div class="sub" id="hb-sit' + i + '">' + situacaoLinha(l, i) + '</div>' +
        (parado ? '' :
          '<input class="est-inline" style="width:100%;text-align:left;margin-top:3px" ' +
          'data-hb-num="' + i + '" value="' + U.esc(l.campos.numero || '') + '" ' +
          'placeholder="número do documento">') +
      '</td>' +
      '<td><select data-hb-emp="' + i + '"' + trava + '><option value="">—</option>' +
        opcoesPertence().map(function (o) {
          return '<option value="' + U.esc(o.v) + '"' +
            (paraPertence(l.campos) === o.v ? ' selected' : '') + '>' +
            U.esc(o.rot) + '</option>';
        }).join('') + '</select></td>' +
      '<td><select data-hb-tipo="' + i + '"' + trava + '><option value="">—</option>' +
        (dados.tipos || []).map(function (x) {
          return '<option value="' + U.esc(x.id) + '"' +
            (l.campos.tipo === x.id ? ' selected' : '') + '>' + U.esc(x.nome) + '</option>';
        }).join('') + '</select></td>' +
      '<td><input type="date" data-hb-emi="' + i + '" value="' +
        U.esc(l.campos.data_emissao || '') + '"' + trava + '></td>' +
      '<td><input type="date" data-hb-val="' + i + '" value="' +
        U.esc(l.campos.data_validade || '') + '"' +
        (t.sem_validade || parado ? ' disabled' : '') + '></td>' +
      '<td class="acoes">' +
        (parado ? '' : '<button class="btn-sm" data-hb-tirar="' + i + '">Tirar</button>') +
      '</td></tr>';
  }

  /* A linha de situação: o que o sistema soube, de onde, e o que
     falta. É a única coisa que muda quando alguém mexe num campo,
     justamente para a tabela não ser redesenhada inteira. */
  function situacaoLinha(l, i) {
    if (l.estado === 'lendo') return 'lendo…';
    if (l.estado === 'guardado') return '<span class="badge b-pago">guardado</span>';
    if (l.estado === 'repetido') {
      return '<span class="badge b-cancelado">' +
        U.esc(l.erro || 'já está no cofre') + '</span>';
    }
    if (l.estado === 'erro') return '<span class="badge b-reprovado">' + U.esc(l.erro || 'falhou') + '</span>';

    const p = problema(l);
    const partes = [];
    if (p) partes.push('<span style="color:var(--red);font-weight:600">' + U.esc(p) + '</span>');

    const t = tipoDe(l.campos.tipo);
    if (l.lido && l.lido.validade_calculada) {
      partes.push('validade = emissão + ' + (t.prazo_padrao_dias || 90) + ' dias');
    }
    if (l.lido && l.lido.so_pelo_nome) partes.push('tipo veio do nome do arquivo');
    if (l.lido && l.lido.empresa_por) partes.push('empresa por ' + U.esc(l.lido.empresa_por));
    if (l.lido && l.lido.vazio) partes.push('sem texto dentro (digitalização)');
    return partes.join(' · ') || 'pronto';
  }
  const parado = l => l.estado === 'guardado' || l.estado === 'repetido';

  /* ── escolher os arquivos ───────────────────────────────── */
  function ligarSubir() {
    const liga = function (id, ev, fn) { const e = U.el(id); if (e) e.addEventListener(ev, fn); };
    const solta = U.el('hb-solta');
    if (!solta) return;

    liga('hb-escolher', 'click', function () { U.el('hb-arqs').click(); });
    liga('hb-escolher-pasta', 'click', function () { U.el('hb-pasta').click(); });
    liga('hb-arqs', 'change', function () { receber(Array.from(this.files || [])); this.value = ''; });
    liga('hb-pasta', 'change', function () { receber(Array.from(this.files || [])); this.value = ''; });

    ['dragenter', 'dragover'].forEach(function (ev) {
      solta.addEventListener(ev, function (e) { e.preventDefault(); solta.classList.add('sobre'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      solta.addEventListener(ev, function (e) { e.preventDefault(); solta.classList.remove('sobre'); });
    });
    solta.addEventListener('drop', async function (e) {
      const dt = e.dataTransfer;
      if (!dt) return;
      /* Arrastar uma PASTA não entrega os arquivos em
         `dataTransfer.files` — entrega a pasta, e o navegador só
         deixa entrar nela pela API de entradas, que é recursiva e
         não-padrão. Sem isto, arrastar a pasta de habilitação não
         fazia absolutamente nada, em silêncio. */
      const itens = dt.items ? Array.from(dt.items) : [];
      const entradas = itens.map(function (x) {
        return x.webkitGetAsEntry ? x.webkitGetAsEntry() : null;
      }).filter(Boolean);
      if (entradas.length) return receber(await arquivosDe(entradas));
      receber(Array.from(dt.files || []));
    });

    liga('hb-limpar-lote', 'click', function () { lote = []; render(); });
    liga('hb-aplicar-emp', 'click', function () {
      const v = U.val('hb-todos-emp');
      if (!v) return ERP.app.aviso('Escolha a empresa antes de aplicar.', 'erro');
      const p2 = dePertence(v);
      let n = 0;
      lote.forEach(function (l) {
        if (!parado(l) && !l.campos.empresa) {
          l.campos.empresa = p2.empresa;
          l.campos.abrangencia = p2.abrangencia;
          n++;
        }
      });
      render();
      ERP.app.aviso(n ? n + ' linha(s) receberam a empresa.' : 'Nenhuma linha estava sem empresa.');
    });
    liga('hb-guardar-lote', 'click', guardarLote);

    ligarLinhas();
  }

  /* Percorre pastas arrastadas. Profundidade limitada: pasta de
     habilitação tem dois ou três níveis, e uma recursão sem limite
     numa pasta escolhida por engano (a raiz do disco) travaria a
     página sem dizer por quê. */
  async function arquivosDe(entradas, nivel) {
    nivel = nivel || 0;
    if (nivel > 5) return [];
    const saida = [];
    for (const e of entradas) {
      if (e.isFile) {
        const f = await new Promise(function (ok) { e.file(ok, function () { ok(null); }); });
        if (f) saida.push(f);
      } else if (e.isDirectory) {
        const leitor = e.createReader();
        let filhos = [], parte;
        /* `readEntries` devolve no máximo cem por chamada e é
           preciso insistir até vir vazio — ler uma vez só perdia
           silenciosamente tudo a partir do centésimo primeiro
           arquivo. */
        do {
          parte = await new Promise(function (ok) { leitor.readEntries(ok, function () { ok([]); }); });
          filhos = filhos.concat(parte);
        } while (parte.length);
        saida.push.apply(saida, await arquivosDe(filhos, nivel + 1));
      }
    }
    return saida;
  }

  async function receber(arquivos) {
    const novos = (arquivos || []).filter(function (f) { return ACEITOS.test(f.name); });
    const recusados = (arquivos || []).length - novos.length;
    if (!novos.length) {
      return ERP.app.aviso(recusados
        ? 'Nenhum PDF, JPG ou PNG nessa pasta — ' + recusados + ' arquivo(s) de outro tipo.'
        : 'Nenhum arquivo.', 'erro');
    }
    novos.forEach(function (f) {
      /* O mesmo arquivo arrastado duas vezes não vira duas linhas.
         A conferência de verdade é pelo conteúdo, mais abaixo;
         esta só evita a lista crescer à toa. */
      const repetido = lote.some(function (l) {
        return l.nome === f.name && l.tam === f.size && l.estado !== 'guardado';
      });
      if (repetido) return;
      lote.push({ file: f, nome: f.name, tam: f.size, estado: 'lendo', lido: null, hash: null,
                  campos: { empresa: '', tipo: '', numero: '', data_emissao: null,
                            data_validade: null, abrangencia: 'estabelecimento' } });
    });
    if (recusados) {
      ERP.app.aviso(recusados + ' arquivo(s) de outro tipo ficaram de fora.');
    }
    render();
    await lerTodos();
  }

  async function lerTodos() {
    const fila = lote.filter(function (l) { return l.estado === 'lendo'; });
    if (!fila.length) return;
    lendo = { feitos: 0, total: fila.length };
    render();
    /* Um de cada vez, de propósito: o pdf.js carrega o arquivo
       inteiro na memória, e vinte em paralelo derrubam a aba. */
    for (const l of fila) {
      await lerUm(l);
      lendo.feitos++;
      const cx = U.el('hb-resumo');
      if (cx) cx.textContent = 'lendo ' + lendo.feitos + ' de ' + lendo.total + '…';
    }
    lendo = null;
    render();
  }

  async function lerUm(l) {
    try {
      l.hash = await digerir(l.file);
      /* Já está no cofre? O índice do banco é por empresa+hash e
         recusaria no fim, depois de subir o arquivo à toa. Saber
         antes evita isso e evita a lista mentir sobre o que vai
         acontecer. */
      const igual = (dados.documentos || []).find(function (d) {
        return l.hash && d.arquivo_hash === l.hash;
      });
      if (igual) {
        l.estado = 'repetido';
        l.campos.empresa = igual.empresa; l.campos.tipo = igual.tipo;
        return;
      }
      /* E repetido DENTRO do próprio lote. A pasta de habilitação
         costuma ter a mesma certidão salva duas vezes com nomes
         diferentes ("CND.pdf" e "CND federal (1).pdf"); a conferência
         por nome e tamanho, feita lá na entrada, não pega isso. Sem
         esta, as duas subiriam e a segunda só seria recusada pelo
         banco, depois de o arquivo já ter ido para o balde. */
      const gemea = lote.find(function (o) {
        return o !== l && o.hash && o.hash === l.hash && o.estado !== 'repetido';
      });
      if (gemea) {
        l.estado = 'repetido';
        l.erro = 'mesmo conteúdo de ' + gemea.nome;
        return;
      }
      let texto = '';
      if (/\.pdf$/i.test(l.nome)) {
        try { texto = (await ERP.danfe.textoDoPDF(await l.file.arrayBuffer())).texto || ''; }
        catch (e) { texto = ''; }
      }
      const r = ERP.habLeitura.ler(texto, dados.tipos, {
        nome: l.nome, empresas: D.empresas || []
      });
      l.lido = r;
      /* O que o documento diz manda. A sugestão do botão "Subir
         nova" só preenche o que ficou em branco — senão renovar o
         FGTS da matriz carimbaria "matriz" numa certidão da filial
         que viesse junto na mesma pasta. */
      l.campos.tipo = r.tipo || (sugerido && sugerido.tipo) || '';
      l.campos.empresa = r.empresa || (sugerido && sugerido.empresa) || '';
      l.campos.numero = r.numero || '';
      l.campos.data_emissao = r.data_emissao || null;
      l.campos.data_validade = r.data_validade || null;
      l.campos.abrangencia = r.abrangencia || 'estabelecimento';
      l.estado = 'pronto';
    } catch (e) {
      l.estado = 'erro';
      l.erro = 'não consegui ler: ' + (e.message || e);
    }
  }

  /* ── edição linha a linha ────────────────────────────────
     Cada controle muda o estado e reescreve APENAS a sua linha de
     situação. Redesenhar a tabela inteira a cada mudança devolve o
     foco ao topo da página — numa tabela de vinte linhas isso
     torna a correção impraticável. */
  function ligarLinhas() {
    const repinta = function (i) {
      const cx = U.el('hb-sit' + i);
      if (cx) cx.innerHTML = situacaoLinha(lote[i], i);
      const b = U.el('hb-guardar-lote');
      if (b) {
        b.textContent = 'Guardar ' + prontas().length + ' documento(s)';
        b.disabled = !prontas().length || !!gravando;
      }
      const r = U.el('hb-resumo');
      if (r) r.textContent = resumoLote();
    };
    document.querySelectorAll('[data-hb-emp]').forEach(function (s) {
      s.addEventListener('change', function () {
        const i = +this.dataset.hbEmp;
        /* Um controle, dois campos: "Pertence a" decide a empresa
           dona e se o documento vale para o grupo. Eram dois
           selects, e ninguém via relação entre eles. */
        const p2 = dePertence(this.value);
        lote[i].campos.empresa = p2.empresa;
        lote[i].campos.abrangencia = p2.abrangencia;
        repinta(i);
      });
    });
    document.querySelectorAll('[data-hb-tipo]').forEach(function (s) {
      s.addEventListener('change', function () {
        const i = +this.dataset.hbTipo, l = lote[i];
        l.campos.tipo = this.value;
        const t = tipoDe(this.value);
        /* Trocar para um tipo que não vence tira a validade: o
           campo não serve, e deixar uma data ali gravaria uma
           validade num documento que não tem. */
        const campoVal = document.querySelector('[data-hb-val="' + i + '"]');
        if (campoVal) {
          campoVal.disabled = !!t.sem_validade;
          if (t.sem_validade) { campoVal.value = ''; l.campos.data_validade = null; }
          else if (!l.campos.data_validade && l.campos.data_emissao && t.prazo_padrao_dias) {
            /* E trocar para um tipo COM prazo recalcula a validade
               a partir da emissão — a mesma conta que o leitor faz,
               agora que o tipo mudou. */
            l.campos.data_validade =
              ERP.habLeitura.maisDias(l.campos.data_emissao, t.prazo_padrao_dias);
            campoVal.value = l.campos.data_validade;
            if (l.lido) l.lido.validade_calculada = true;
          }
        }
        repinta(i);
      });
    });
    document.querySelectorAll('[data-hb-emi]').forEach(function (s) {
      s.addEventListener('change', function () {
        lote[+this.dataset.hbEmi].campos.data_emissao = this.value || null;
        repinta(+this.dataset.hbEmi);
      });
    });
    document.querySelectorAll('[data-hb-val]').forEach(function (s) {
      s.addEventListener('change', function () {
        const i = +this.dataset.hbVal, l = lote[i];
        l.campos.data_validade = this.value || null;
        /* Data digitada a mão não é mais "calculada": a nota que
           explicava a conta deixaria de ser verdade. */
        if (l.lido) l.lido.validade_calculada = false;
        repinta(i);
      });
    });
    document.querySelectorAll('[data-hb-num]').forEach(function (s) {
      /* `input`, e sem repintar: é texto livre, e reescrever
         qualquer coisa a cada tecla tira o foco. */
      s.addEventListener('input', function () {
        lote[+this.dataset.hbNum].campos.numero = this.value;
      });
    });
    document.querySelectorAll('[data-hb-tirar]').forEach(function (b) {
      b.addEventListener('click', function () {
        lote.splice(+this.dataset.hbTirar, 1); render();
      });
    });
  }

  /* ── guardar o lote ──────────────────────────────────────
     Um de cada vez, e a falha de uma linha não derruba as outras:
     numa remessa de trinta documentos, abortar na décima deixaria
     a pessoa sem saber o que entrou e o que não. */
  async function guardarLote() {
    const fila = prontas();
    if (!fila.length) return;
    const c = cli();
    gravando = { feitos: 0, total: fila.length };
    render();

    let erros = 0;
    for (const l of fila) {
      try {
        const limpo = l.nome.replace(/[^\w.\-]+/g, '_').slice(-80);
        const caminho = l.campos.empresa + '/' + l.campos.tipo + '/' +
          Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '-' + limpo;

        const sub = await c.storage.from('habilitacao')
          .upload(caminho, l.file, { contentType: l.file.type || 'application/octet-stream' });
        if (sub.error) throw new Error(sub.error.message);

        const t = tipoDe(l.campos.tipo);
        const r = await c.from('hab_documento').insert({
          /* O id vem do gerador do store, que segue a sequência.
             `Date.now()` repete quando dois registros caem no mesmo
             milissegundo — e aqui eles caem, porque o lote grava
             dezenas em seguida. É exatamente o defeito que já
             apareceu em materiais e em fornecedores. */
          id: S.proximoId('hd'),
          empresa: l.campos.empresa,
          tipo: l.campos.tipo,
          numero: l.campos.numero || null,
          data_emissao: l.campos.data_emissao || null,
          data_validade: t.sem_validade ? null : (l.campos.data_validade || null),
          abrangencia: l.campos.abrangencia || 'estabelecimento',
          arquivo_path: caminho,
          arquivo_nome: l.nome,
          arquivo_bytes: l.tam,
          arquivo_hash: l.hash,
          criado_por: (S.usuario() || {}).id || null
        });
        if (r.error) {
          /* O registro não entrou: o arquivo que acabou de subir
             sai do balde. Deixá-lo lá acumularia arquivo órfão que
             ninguém encontraria depois. */
          await c.storage.from('habilitacao').remove([caminho]);
          throw new Error(/duplicate key|hab_doc_hash/i.test(r.error.message)
            ? 'já está no cofre para esta empresa'
            : r.error.message);
        }
        l.estado = 'guardado';
      } catch (e) {
        l.estado = 'erro';
        l.erro = String(e.message || e);
        erros++;
      }
      gravando.feitos++;
      const cx = U.el('hb-resumo');
      if (cx) cx.textContent = 'guardando ' + gravando.feitos + ' de ' + gravando.total + '…';
    }
    gravando = null;
    const ok = fila.length - erros;
    ERP.app.aviso(erros
      ? ok + ' guardado(s), ' + erros + ' falharam — o motivo está na linha de cada um.'
      : ok + ' documento(s) guardados no cofre.', erros ? 'erro' : '');
    await carregar();
  }

  /* ── baixar em lote, zipado ──────────────────────────────
     Montar envelope de habilitação é juntar de dez a vinte
     arquivos da mesma empresa, por categoria. Baixar um a um, com
     link assinado de cinco minutos cada, é meia hora de trabalho
     por certame — e é onde se esquece um documento.

     Aqui se escolhe a empresa e as categorias, e sai um zip com
     tudo organizado em pastas. O que é marcado como ÚNICO entra
     junto, porque documento do grupo é documento daquela empresa
     também.

     Por padrão vai só o que VALE hoje. Documento vencido num
     envelope de habilitação é o que inabilita — se alguém quiser
     mesmo levar, tem de marcar de propósito. */
  function abrirBaixaEmLote() {
    const emp = empresasAtivas();
    if (!emp.length) return ERP.app.aviso('Nenhuma empresa cadastrada.', 'erro');
    const cats = categoriasUsadas();

    ERP.app.modal({
      titulo: 'Baixar documentos em lote',
      corpo:
        '<div class="row2">' +
          '<div><label for="bl-emp">Empresa</label><select id="bl-emp">' +
            emp.map(function (e) {
              return '<option value="' + U.esc(e.id) + '"' +
                (filtro.empresa === e.id ? ' selected' : '') + '>' +
                U.esc(e.apelido || e.nome) + '</option>'; }).join('') + '</select>' +
            '<div class="ajuda">Entram também os documentos marcados como <b>Único</b>, que valem ' +
            'para as duas empresas da HJM.</div></div>' +
        '</div>' +
        '<label style="margin-top:10px">Categorias</label>' +
        '<div class="hb-chips" style="margin-bottom:4px">' +
          cats.map(function (c) {
            return '<label class="hb-marca"><input type="checkbox" data-bl-cat="' + U.esc(c[0]) +
              '" checked> ' + U.esc(c[1]) + '</label>';
          }).join('') +
        '</div>' +
        '<div style="display:flex;gap:6px;margin-bottom:10px">' +
          '<button class="btn-sm" id="bl-todas">Todas</button>' +
          '<button class="btn-sm" id="bl-nenhuma">Nenhuma</button>' +
        '</div>' +
        '<label style="font-weight:400"><input type="checkbox" id="bl-vencidos" style="width:auto"> ' +
          'Incluir também os vencidos e os substituídos</label>' +
        '<div class="ajuda" id="bl-conta"></div>',
      acoes: [{ txt: 'Baixar zip', cls: 'btn-aprovar', fn: baixarLote }],
      aposAbrir: function () {
        const recontar = function () {
          const cx = U.el('bl-conta');
          if (cx) {
            const n = selecionadosParaZip().length;
            cx.textContent = n ? n + ' arquivo(s) entram no zip.'
                               : 'Nenhum arquivo com essas marcações.';
          }
        };
        U.el('bl-emp').addEventListener('change', recontar);
        U.el('bl-vencidos').addEventListener('change', recontar);
        document.querySelectorAll('[data-bl-cat]').forEach(function (c) {
          c.addEventListener('change', recontar);
        });
        U.el('bl-todas').addEventListener('click', function () {
          document.querySelectorAll('[data-bl-cat]').forEach(function (c) { c.checked = true; });
          recontar();
        });
        U.el('bl-nenhuma').addEventListener('click', function () {
          document.querySelectorAll('[data-bl-cat]').forEach(function (c) { c.checked = false; });
          recontar();
        });
        recontar();
      }
    });
  }

  function selecionadosParaZip() {
    const empresa = U.val('bl-emp');
    const marcadas = Array.from(document.querySelectorAll('[data-bl-cat]'))
      .filter(function (c) { return c.checked; })
      .map(function (c) { return c.dataset.blCat; });
    const tudo = U.el('bl-vencidos') && U.el('bl-vencidos').checked;
    const base = tudo ? (dados.documentos || []) : vigentes();
    return base.filter(function (d) {
      if (!d.arquivo_path) return false;
      if (empresasCobertas(d).indexOf(empresa) < 0) return false;
      if (marcadas.indexOf(tipoDe(d.tipo).categoria || 'outros') < 0) return false;
      if (!tudo && situacao(d).id === 'vencido') return false;
      return true;
    });
  }

  async function baixarLote() {
    const lista = selecionadosParaZip();
    if (!lista.length) return ERP.app.aviso('Nenhum arquivo com essas marcações.', 'erro');
    if (!window.JSZip) return ERP.app.aviso('A biblioteca de zip não carregou nesta página.', 'erro');
    const empresa = U.val('bl-emp');
    const nomeEmp = nomeEmpresa(empresa);
    const c = cli();
    const zip = new window.JSZip();
    const cx = U.el('bl-conta');
    let feitos = 0, falhas = [];

    for (const d of lista) {
      if (cx) cx.textContent = 'baixando ' + (feitos + 1) + ' de ' + lista.length + '…';
      try {
        const assinado = await c.storage.from('habilitacao').createSignedUrl(d.arquivo_path, 300);
        if (assinado.error) throw new Error(assinado.error.message);
        const resp = await fetch(assinado.data.signedUrl);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const bytes = await resp.arrayBuffer();
        const cat = ROT_CAT[tipoDe(d.tipo).categoria] || 'Outros';
        const ext = (d.arquivo_nome || '').match(/\.[a-z0-9]+$/i);
        /* O nome dentro do zip é o do DOCUMENTO, não o do arquivo
           original: quem abre o envelope procura "CND Federal", não
           "scan0017.pdf". A validade entra no nome porque é o que a
           comissão confere primeiro. */
        let nome = (d.tipo_nome || d.tipo) +
          (d.validade_efetiva ? ' (val ' + U.fData(d.validade_efetiva).replace(/\//g, '-') + ')' : '') +
          (ext ? ext[0] : '.pdf');
        nome = nome.replace(/[\/:*?"<>|]+/g, '-');
        let caminho = cat + '/' + nome, n = 2;
        while (zip.file(caminho)) { caminho = cat + '/' + nome.replace(/(\.[^.]+)$/, ' (' + (n++) + ')$1'); }
        zip.file(caminho, bytes);
        feitos++;
      } catch (e) {
        falhas.push((d.tipo_nome || d.tipo) + ': ' + (e.message || e));
      }
    }
    if (!feitos) {
      if (cx) cx.textContent = '';
      return ERP.app.aviso('Nenhum arquivo baixou. ' + (falhas[0] || ''), 'erro');
    }
    if (cx) cx.textContent = 'montando o zip…';
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'documentacao-' + String(nomeEmp).toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') +
      '-' + U.hoje() + '.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    ERP.app.fecharModal();
    ERP.app.aviso(falhas.length
      ? feitos + ' arquivo(s) no zip, ' + falhas.length + ' falharam: ' + falhas[0]
      : feitos + ' arquivo(s) no zip.', falhas.length ? 'erro' : '');
  }

  /* SHA-256 do conteúdo, para reconhecer o arquivo repetido. */
  async function digerir(f) {
    try {
      const b = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
      return Array.from(new Uint8Array(b))
        .map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    } catch (e) { return null; }
  }

  /* ── editar um documento que já está no cofre ────────────
     Caminho diferente do lote, e de propósito: aqui o arquivo já
     existe e o que se corrige são os campos. */
  function abrirFormulario(id, sugestao) {
    const d = id ? (dados.documentos || []).find(function (x) { return x.id === id; }) : null;
    if (!d) {
      /* "Subir nova" da fila do painel: leva para a tela de lote
         com a empresa e o tipo já escolhidos para o que vier. */
      aba = 'subir';
      sugerido = sugestao || null;
      render();
      return;
    }
    ERP.app.modal({
      titulo: 'Editar documento',
      corpo:
        '<div class="row2">' +
          '<div><label for="hb-empresa">Pertence a</label><select id="hb-empresa">' +
            '<option value="">selecione</option>' +
            opcoesPertence().map(function (o) {
              return '<option value="' + U.esc(o.v) + '"' +
                (paraPertence(d) === o.v ? ' selected' : '') + '>' +
                U.esc(o.rot) + '</option>'; }).join('') + '</select></div>' +
          '<div><label for="hb-tipo">Tipo de documento</label><select id="hb-tipo">' +
            '<option value="">selecione</option>' +
            (dados.tipos || []).map(function (t) {
              return '<option value="' + U.esc(t.id) + '"' +
                (d.tipo === t.id ? ' selected' : '') + '>' +
                U.esc(t.nome) + '</option>'; }).join('') + '</select></div>' +
          '<div><label for="hb-numero">Número</label>' +
            '<input id="hb-numero" value="' + U.esc(d.numero || '') + '"></div>' +
          '<div><label for="hb-emissao">Emissão</label>' +
            '<input type="date" id="hb-emissao" value="' + U.esc(d.data_emissao || '') + '"></div>' +
          '<div><label for="hb-validade">Validade</label>' +
            '<input type="date" id="hb-validade" value="' + U.esc(d.data_validade || '') + '">' +
            '<div class="ajuda" id="hb-validade-nota"></div></div>' +
        '</div>' +
        '<label for="hb-obs">Observação</label>' +
        '<textarea id="hb-obs" rows="2">' + U.esc(d.observacao || '') + '</textarea>' +
        (d.arquivo_nome
          ? '<div class="ajuda">Arquivo guardado: ' + U.esc(d.arquivo_nome) +
            '. Aqui mudam só os campos — para trocar o arquivo, suba um documento novo.</div>'
          : ''),
      acoes: [{ txt: 'Salvar', fn: function () { salvar(id); } }]
        .concat(podeAdmin() ? [{ txt: 'Arquivar', cls: 'btn-sm',
                                 fn: function () { arquivar(id); } }] : []),
      aposAbrir: function () {
        notaValidade();
        const tp = U.el('hb-tipo');
        if (tp) tp.addEventListener('change', notaValidade);
      }
    });
  }

  /* A nota embaixo do campo de validade: quando o tipo não vence, o
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

  async function salvar(id) {
    const pertence = U.val('hb-empresa'), tipo = U.val('hb-tipo');
    if (!pertence) return ERP.app.erroCampo('hb-empresa', 'Escolha a quem o documento pertence.');
    const quem = dePertence(pertence);
    const empresa = quem.empresa;
    if (!tipo) return ERP.app.erroCampo('hb-tipo', 'Escolha o tipo de documento.');
    const t = tipoDe(tipo);
    const emissao = U.val('hb-emissao') || null;
    const validade = t.sem_validade ? null : (U.val('hb-validade') || null);

    if (validade && emissao && validade < emissao) {
      return ERP.app.erroCampo('hb-validade', 'A validade não pode ser anterior à emissão.');
    }
    /* Sem emissão e sem validade, o documento ficaria guardado e
       invisível para o alerta — que é o engano que o módulo existe
       para evitar. */
    if (!t.sem_validade && !validade && !emissao) {
      return ERP.app.erroCampo('hb-emissao',
        'Informe a emissão ou a validade — sem uma das duas o documento não entra no alerta.');
    }
    const r = await cli().from('hab_documento').update({
      empresa: empresa, tipo: tipo,
      numero: U.val('hb-numero') || null,
      data_emissao: emissao, data_validade: validade,
      abrangencia: quem.abrangencia,
      observacao: U.val('hb-obs') || null
    }).eq('id', id);
    if (r.error) return ERP.app.aviso('Não salvou: ' + r.error.message, 'erro');
    ERP.app.fecharModal();
    ERP.app.aviso('Documento atualizado.');
    carregar();
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
    problema: problema,
    _lote: function () { return lote; },
    _porFora: function (ls) { lote = ls; },
    _dados: function () { return dados; }
  };
})();
