/* ERP · app.js — casca da aplicação: módulos, abas, sessão, modal e avisos.
   Nenhuma regra de negócio; só orquestração dos módulos. */
window.ERP = window.ERP || {};

ERP.app = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;

  /* Os cinco que você pediu + os que o fluxo de vocês pede:
     contratos e medições abrem o ciclo que termina no contas a pagar,
     cadastros centralizam credor / plano de contas / centro de custo,
     e administração guarda usuários e perfis de aprovação. */
  const MODULOS = [
    { id: 'financeiro',    nome: 'Financeiro',        txt: 'Contas a pagar e a receber, baixas, fluxo de caixa e DRE por competência.', estado: 'ativo' },
    { id: 'produtividade', nome: 'Produtividade',     txt: 'Importa o fechamento do PegaPlantão e gera as contas a pagar dos médicos.', estado: 'ativo' },
    { id: 'estoque',       nome: 'Estoque',           txt: 'Materiais de consumo por projeto, saída pela farmácia e alerta de reposição.', estado: 'ativo' },
    { id: 'faturamento',   nome: 'Faturamento',       txt: 'Notas emitidas, retenções e contas a receber por projeto.', estado: 'ativo' },
    { id: 'compras',       nome: 'Compras',           txt: 'Requisição vinda do alerta de estoque, aprovação, pedido e recebimento.', estado: 'ativo' },
    { id: 'contratos',     nome: 'Contratos',         txt: 'Vigência, valor mensal por projeto, reajuste e aditivos — com alerta de vencimento.', estado: 'ativo' },
    { id: 'dp',            nome: 'Pessoal',           txt: 'Funcionários CLT, folha de pagamento, férias e rescisão.', estado: 'ativo' },
    { id: 'ativos',        nome: 'Ativos',            txt: 'Equipamentos: onde está cada um, com quem, manutenção e resultado por item.', estado: 'ativo' },
    { id: 'cadastros',     nome: 'Cadastros',         txt: 'Projetos e clientes: prazo de recebimento, retenções e produtividade.', estado: 'ativo' },
    { id: 'procedimentos', nome: 'Procedimentos',     txt: 'Cirurgias do mutirão do HGB: material consumido, repasse ao médico e resultado por cirurgia.', estado: 'ativo' },
    { id: 'administracao', nome: 'Administração',     txt: 'Usuários e perfis, alçadas de aprovação, políticas e trilha de auditoria.', estado: 'ativo' }
  ];
  const rotEstado = { ativo: 'disponível', construcao: 'em construção', planejado: 'planejado' };

  /* ── avisos ────────────────────────────────────────────*/
  let timer = null;
  /* Erro no CAMPO, não só no rodapé.

     O toast some sozinho em cinco segundos e não diz onde foi o
     problema: quem estava olhando para o formulário não vê nada. Isto
     marca o campo e escreve a mensagem embaixo dele, até a pessoa
     mexer ali de novo. */
  function erroCampo(id, msg) {
    const e = U.el(id);
    if (!e) return aviso(msg, 'erro');
    e.classList.add('campo-erro');
    let m = document.getElementById(id + '-erro');
    if (!m) {
      m = document.createElement('div');
      m.id = id + '-erro';
      m.className = 'ajuda erro';
      e.parentNode.insertBefore(m, e.nextSibling);
    }
    m.textContent = msg;
    const limpa = function () {
      e.classList.remove('campo-erro');
      if (m && m.parentNode) m.parentNode.removeChild(m);
      e.removeEventListener('input', limpa);
      e.removeEventListener('change', limpa);
    };
    e.addEventListener('input', limpa);
    e.addEventListener('change', limpa);
    try { e.focus(); } catch (x) {}
    aviso(msg, 'erro');
  }

  function aviso(msg, tipo) {
    const t = U.el('toast');
    /* Quando o banco não está gravando, um "Lançado" sem ressalva é
       mentira útil para ninguém: quem lança olha o aviso, não a
       etiqueta no topo da tela. Então o aviso de SUCESSO carrega o
       recado junto, e em vermelho.

       Se o módulo específico está degradado mas o resto grava, o
       recado nomeia a situação em vez de dizer que nada grava. */
    const semBanco = ERP.auth && ERP.auth.configurado() &&
      ERP.persistencia && !ERP.persistencia.ligado();
    const degradadas = (ERP.persistencia && ERP.persistencia.degradadas)
      ? ERP.persistencia.degradadas() : [];
    if (tipo !== 'erro' && semBanco) {
      msg = msg + ' — ATENÇÃO: não está sendo gravado no banco, vai sumir ao recarregar.';
      tipo = 'erro';
    } else if (tipo !== 'erro' && degradadas.length) {
      msg = msg + ' (atenção: ' + degradadas.length + ' módulo(s) sem gravar nesta sessão)';
    }
    t.textContent = msg;
    t.style.background = tipo === 'erro' ? 'var(--red)' : 'var(--brand)';
    t.style.display = 'block';
    clearTimeout(timer);
    timer = setTimeout(function () { t.style.display = 'none'; }, 5000);
  }

  /* ── modal ─────────────────────────────────────────────*/
  function modal(cfg) {
    fecharModal();
    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.id = 'modal-fundo';
    fundo.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
        '<div class="topo"><h3>' + U.esc(cfg.titulo) + '</h3>' +
        '<button class="btn-ghost" id="modal-x" aria-label="Fechar">✕</button></div>' +
        '<div class="corpo">' + cfg.corpo + '</div>' +
        '<div class="rodape"><button class="btn-sm" id="modal-fechar">' + U.esc(cfg.fecharTxt || 'Fechar') + '</button></div>' +
      '</div>';
    document.body.appendChild(fundo);

    const rodape = fundo.querySelector('.rodape');
    (cfg.acoes || []).forEach(function (a) {
      const b = document.createElement('button');
      b.className = a.cls || 'btn-aprovar';
      b.textContent = a.txt;
      b.addEventListener('click', a.fn);
      rodape.appendChild(b);
    });
    U.el('modal-x').addEventListener('click', fecharModal);
    /* Gancho para quem precisa amarrar evento em algo DENTRO do
       modal: o conteúdo só existe no DOM a partir daqui. */
    if (typeof cfg.aposAbrir === 'function') cfg.aposAbrir();
    U.el('modal-fechar').addEventListener('click', fecharModal);
    /* Só fecha se o clique COMEÇOU e TERMINOU no fundo. Sem isso,
       selecionar um texto dentro do modal e soltar o mouse fora fecha a
       janela e perde o que estava digitado. */
    let comecouNoFundo = false;
    fundo.addEventListener('mousedown', function (e) { comecouNoFundo = e.target === fundo; });
    fundo.addEventListener('click', function (e) {
      if (e.target === fundo && comecouNoFundo) fecharModal();
      comecouNoFundo = false;
    });
    document.addEventListener('keydown', escFecha);
    if (cfg.aoAbrir) cfg.aoAbrir();
  }
  function escFecha(e) { if (e.key === 'Escape') fecharModal(); }
  function fecharModal() {
    const f = U.el('modal-fundo');
    if (f) f.remove();
    document.removeEventListener('keydown', escFecha);
  }

  /* ── módulos ───────────────────────────────────────────*/
  /* Painel de pendências: o que está esperando alguém. Cada cartão diz
     quantos, o que é e leva pro módulo — e a lista já vem filtrada
     pelo que o perfil enxerga (o estoquista não vê faturamento). */
  function renderPendencias() {
    const box = U.el('home-pendencias');
    if (!box) return;
    const lista = S.pendenciasHome();
    if (!lista.length) {
      box.innerHTML = '<div class="card" style="margin-bottom:12px"><div class="dif ok">' +
        'Nenhuma pendência pra você agora.</div></div>';
      return;
    }
    const cor = { erro: 'var(--red)', alerta: '#b8860b', info: 'var(--line)' };
    box.innerHTML = '<div class="card" style="margin-bottom:12px">' +
      '<h2>Pendências<span class="sub">o que está esperando alguém</span></h2>' +
      '<div class="pend-grade">' +
      lista.map(function (a) {
        return '<button class="pend" data-pend="' + a.modulo + '"' +
          (a.destino ? ' data-destino="' + a.destino + '"' : '') +
          ' style="border-left-color:' + cor[a.nivel] + '">' +
          '<div class="pend-n" style="color:' + (a.nivel === 'info' ? 'var(--ink2)' : cor[a.nivel]) + '">' + a.n + '</div>' +
          '<div class="pend-t">' + U.esc(a.titulo) + '</div>' +
          '<div class="pend-x">' + U.esc(a.texto) + '</div></button>';
      }).join('') + '</div></div>';
    box.querySelectorAll('[data-pend]').forEach(function (b) {
      b.addEventListener('click', function () {
        abrirModulo(this.dataset.pend);
        /* Alguns cartões apontam pra uma tela específica dentro do
           módulo — abrir só o módulo deixava a pessoa procurando. */
        const destino = this.dataset.destino;
        if (destino) setTimeout(function () { irParaDestino(destino); }, 30);
      });
    });
  }

  /* Atalhos dos cartões de pendência pras telas exatas. No financeiro
     ainda é preciso abrir a ÁREA certa (a pagar, a receber…) antes de
     clicar na aba — abrir só o módulo deixa na tela em que a pessoa
     estava por último. */
  function irParaDestino(destino) {
    const abrirArea = function (area) {
      const b = document.querySelector('#area-fin button[data-area="' + area + '"]');
      if (b) b.click();
    };
    if (destino === 'receber_atrasado') {
      abrirArea('receber');
      setTimeout(function () {
        const b = document.getElementById('rc-ver-atrasadas');
        if (b) b.click();
        else { const s = document.getElementById('rc-status'); if (s) { s.value = 'atrasado'; ERP.receber.render(); } }
      }, 40);
      return;
    }
    if (destino === 'pago_sem_nf' || destino === 'aprovacoes') abrirArea('pagar');
    if (destino === 'pago_sem_nf') {
      const aba = document.querySelector('[data-aba="anexos"]');
      if (aba) aba.click();
      return;
    }
    // (receber_atrasado tratado acima, antes de abrir a aba)
    if (destino === 'aprovacoes') {
      const aba = document.querySelector('[data-aba="aprovacoes"]');
      if (aba) aba.click();
      return;
    }
    const mapa = {
      cobertura_faturamento: ['#fa-nav button[data-faaba="cobertura"]'],
      esteira: ['#fa-nav button[data-faaba="esteira"]'],
      cobertura_produtividade: ['#pr-nav button[data-praba="cobertura"]'],
      pendentes_produtividade: ['#pr-nav button[data-praba="pendentes"]'],
      compras_aprovar: ['#cp-nav button[data-cp="aprovar"]', '[data-cp="aprovar"]'],
      compras_cotar: ['[data-cp="cotar"]'],
      folha: ['#dp-nav button[data-dpaba="folha"]'],
      estoque_minimo: ['#es-nav button[data-es="posicao"]'],
      atestados: ['#cad-nav button[data-cad="atestados"]'],
      receber_atrasado: ['#rc-ver-atrasadas']
    }[destino] || [];
    mapa.some(function (sel) {
      const el = document.querySelector(sel);
      if (el) { el.click(); return true; }
      return false;
    });
  }

  /* Quais modulos ficaram sem gravar nesta sessao. A persistencia
     fala em colecoes (`estoqueMov`); a tela fala em modulos. */
  const COLECAO_DO_MODULO = {
    financeiro: ['titulos', 'parcelas', 'pagamentos', 'retencoesRegistradas', 'guiasRetencao',
                 'extratos', 'linhas', 'saldosInformados', 'transferenciasBanco', 'regras'],
    faturamento: ['receber', 'previsoes', 'lotesRPS'],
    contratos: ['contratos'],
    estoque: ['estoque', 'estoqueMov'],
    compras: ['compras'],
    procedimentos: ['procedimentos', 'fechamentosProcedimentos'],
    produtividade: ['lotesProdutividade'],
    ativos: ['ativos', 'ativoMov', 'ordensServico'],
    dp: ['folhas', 'decimos']
  };
  function moduloDegradado(id) {
    if (!ERP.persistencia || !ERP.persistencia.degradadas) return false;
    const fora = ERP.persistencia.degradadas().map(function (d) { return d.nome; });
    if (!fora.length) return false;
    return (COLECAO_DO_MODULO[id] || []).some(function (c) { return fora.indexOf(c) >= 0; });
  }

  function renderHome() {
    /* A home mostra só o que o perfil vê: o estoquista entra e encontra
       Estoque, Compras e Cadastros — nada financeiro. */
    const meus = MODULOS.filter(function (m) { return S.veModulo(m.id); });
    U.el('grade-modulos').innerHTML = (meus.length ? meus : MODULOS).map(function (m) {
      const livre = m.estado === 'ativo';
      return '<button class="modulo" data-mod="' + m.id + '"' + (livre ? '' : ' disabled') + '>' +
        '<div class="nome">' + U.esc(m.nome) + '</div>' +
        '<div class="txt">' + U.esc(m.txt) + '</div>' +
        '<span class="est' + (livre ? ' ativo' : '') + '">' + rotEstado[m.estado] + '</span>' +
        /* Modulo cujo dado nao carregou do banco: o cartao avisa.
           Sem isto ele abria vazio, indistinguivel de "nao ha nada
           cadastrado" -- e a pessoa recadastraria tudo. */
        (moduloDegradado(m.id)
          ? '<span class="est" style="background:var(--red);color:#fff">sem gravar</span>' : '') +
      '</button>';
    }).join('');
    U.el('grade-modulos').querySelectorAll('[data-mod]').forEach(function (b) {
      b.addEventListener('click', function () { abrirModulo(this.dataset.mod); });
    });
    // os módulos vêm primeiro; as pendências ficam logo abaixo deles
    renderPendencias();
  }

  function abrirModulo(id) {
    if (id === 'ativos' && ERP.ativos) setTimeout(function () { ERP.ativos.render(); }, 0);
    /* Faturamento abre na Previsão: é o começo do fluxo (previsão →
       confirmado → autorizado → liberado → faturado). */
    /* Abrir o módulo cai no Status, que é a primeira aba e a tela onde
       a operação começa o dia. */
    if (id === 'faturamento') {
      setTimeout(function () {
        if (ERP.previsoes) ERP.previsoes.render();
        if (ERP.faturamento && ERP.faturamento.renderStatus) ERP.faturamento.renderStatus();
      }, 0);
    }
    /* Voltar pra "Início" tem que RECALCULAR os alertas: antes a home
       só era montada na carga e na troca de usuário, então lançar uma
       NF, aplicar reajuste ou emitir fatura e voltar mostrava os
       cartões velhos. */
    if (id === 'home') renderHome();
    const m = MODULOS.find(function (x) { return x.id === id; });
    if (id !== 'home' && m && !S.veModulo(id)) {
      aviso('Seu perfil (' + (S.perfilAtual() || {}).nome + ') não tem acesso a ' + m.nome + '.', 'erro');
      return abrirModulo('home');
    }
    const conhecido = m && m.estado === 'ativo';
    const painel = id === 'home' ? 'home' : (conhecido ? id : 'em-breve');

    document.querySelectorAll('[data-modulo]').forEach(function (p) {
      p.style.display = p.dataset.modulo === painel ? '' : 'none';
    });
    U.el('barra-modulo').style.display = id === 'home' ? 'none' : '';
    U.el('modulo-nome').textContent = m ? m.nome : '';
    U.el('sub-abas').style.display = id === 'financeiro' ? '' : 'none';
    U.el('area-fin').style.display = id === 'financeiro' ? '' : 'none';

    if (painel === 'em-breve' && m) {
      U.el('eb-nome').textContent = m.nome + ' — ' + rotEstado[m.estado];
      U.el('eb-texto').textContent = m.txt;
    }
    if (id === 'cadastros') ERP.cadastros.render();
    if (id === 'contratos') { U.setVal('ct-comp', U.mesAtual()); ERP.contratos.render(); }
    if (id === 'dp') ERP.dp.render();
    if (id === 'estoque') ERP.estoque.render();
    if (id === 'procedimentos') ERP.procedimentos.render();
    if (id === 'compras') ERP.compras.render();
    if (id === 'administracao') ERP.administracao.render();
    if (id === 'financeiro') { abrirArea('pagar'); abrirAba('contas'); }
  }

  /* ── abas do financeiro ────────────────────────────────*/
  /* O financeiro tem duas áreas: pagar e receber. A aba escolhida
     define a área, e a área filtra quais abas aparecem — assim os dois
     assuntos não se misturam na mesma fila de botões. */
  /* Sete áreas no financeiro; só "A pagar" tem sub-abas. Nas outras a
     fila de botões some, porque uma aba sozinha não é navegação. */
  const AREA_UNICA = { pago: 'pago', receber: 'receber', recebido: 'recebido',
    conciliacao: 'conciliacao', saldo: 'saldo', relatorios: 'relatorios' };

  function mostrarArea(area) {
    document.querySelectorAll('#area-fin button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.area === area);
    });
    document.querySelectorAll('#sub-abas button').forEach(function (b) {
      b.style.display = (b.dataset.area === area && !AREA_UNICA[area]) ? '' : 'none';
    });
    U.el('sub-abas').style.display = AREA_UNICA[area] ? 'none' : '';
  }

  function abrirArea(area) {
    mostrarArea(area);
    if (AREA_UNICA[area]) return abrirAba(AREA_UNICA[area]);
    const atual = U.el('sub-abas').querySelector('[aria-current="true"]');
    if (!atual || atual.dataset.area !== area) {
      const primeira = U.el('sub-abas').querySelector('[data-area="' + area + '"]');
      if (primeira) abrirAba(primeira.dataset.aba);
    }
  }

  function abrirAba(nome) {
    const botao = U.el('sub-abas').querySelector('[data-aba="' + nome + '"]');
    if (botao) mostrarArea(botao.dataset.area);
    document.querySelectorAll('#sub-abas button').forEach(function (b) {
      b.setAttribute('aria-current', b.dataset.aba === nome);
    });
    /* "Pago" e "Recebido" são as mesmas listas de "A pagar" e "A
       receber", já filtradas pelo que foi baixado — não são telas
       novas, são a mesma tela com outro recorte. */
    const painel = nome === 'relatorios-r' ? 'relatorios'
      : nome === 'pago' ? 'contas'
      : nome === 'recebido' ? 'receber'
      : nome;
    document.querySelectorAll('[data-painel]').forEach(function (p) {
      p.style.display = p.dataset.painel === painel ? '' : 'none';
    });
    // a lista de contas precisa ser refeita ao voltar: previsões e
    // lançamentos criados em outra aba não apareciam até recarregar
    if (painel === 'contas' || painel === 'anexos') {
      ERP.contas.abrirAba(nome === 'pago' ? 'pagas' : 'apagar');
    }
    if (painel === 'saldo') ERP.saldo.render();
    if (painel === 'relatorios') ERP.relatorios.render();
    if (nome === 'aprovacoes') ERP.aprovacoes.render();
    if (nome === 'remessa') ERP.remessa.render();
    if (nome === 'receber') ERP.receber.abrirAba('abertas');
    if (nome === 'recebido') ERP.receber.abrirAba('recebidas');
    if (nome === 'despesas') ERP.previsoes.renderDespesas();
    if (nome === 'retencoes') ERP.retencoes.render();
    if (painel === 'conciliacao') ERP.conciliacao.render();
    // "Sem anexo" é a lista de contas com o filtro de anexo já aplicado
    /* "Atrasadas" virou aba de verdade, com contador, e não só uma
       opção escondida no filtro de situação. */
    if (nome === 'receber-atraso') {
      document.querySelector('[data-painel="receber"]').style.display = '';
      U.setVal('rc-status', 'atrasado');
      U.setVal('rc-comp', ''); U.setVal('rc-de', ''); U.setVal('rc-ate', '');
      ERP.receber.render();
    }
    if (nome === 'anexos') {
      document.querySelector('[data-painel="contas"]').style.display = '';
      // pago sem NF vive na aba das PAGAS, não na de contas a vencer
      ERP.contas.preFiltrar({ 'flt-anexo': 'sem' }, 'pagas');
    }
  }

  /* ── sessão ────────────────────────────────────────────*/
  function montarSessao() {
    const sel = U.el('sessao-usuario');
    /* Com login, o seletor de usuário não existe: a barra mostra
       quem entrou e um botão de sair. Trocar de usuário passa a ser
       sair e entrar de novo. */
    if (!sel) return;
    sel.innerHTML = D.usuarios.map(function (u) {
      return '<option value="' + u.id + '">' + U.esc(u.nome) + '</option>';
    }).join('');
    sel.value = S.st.usuarioId;
    sel.addEventListener('change', function () {
      S.setUsuario(this.value);
      renderHome();
      const atual = document.querySelector('[data-modulo]:not([style*="none"])');
      const idAtual = atual ? atual.dataset.modulo : 'home';
      if (idAtual !== 'home' && !S.veModulo(idAtual)) abrirModulo('home');
      aplicarPermissoes();
      ERP.contas.render();
      atualizarContadores();
      if (U.el('sub-abas').querySelector('[aria-current="true"]').dataset.aba === 'aprovacoes') {
        ERP.aprovacoes.render();
      }
      aviso('Agora você está como ' + S.usuario().nome + '.', 'ok');
    });
  }

  function aplicarPermissoes() {
    const podeLancar = S.pode('lancar');
    U.el('btn-abrir-lanc').disabled = !podeLancar;
    U.el('btn-lancar').disabled = !podeLancar;
    U.el('btn-lancar').textContent = podeLancar ? 'Lançar conta a pagar' : 'Seu perfil é só de consulta';
    if (!podeLancar) ERP.lancamento.abrir(false);
  }

  // Depois de qualquer ação, redesenha o painel que está na tela — senão
  // a fila da diretoria fica desatualizada até alguém trocar de aba.
  function atualizar() {
    const aba = U.el('sub-abas').querySelector('[aria-current="true"]');
    ERP.contas.render();
    if (aba && aba.dataset.aba === 'aprovacoes') ERP.aprovacoes.render();
    if (aba && aba.dataset.aba === 'remessa') ERP.remessa.render();
    if (aba && aba.dataset.aba === 'receber') ERP.receber.render();
    atualizarContadores();
  }

  function atualizarContadores() {
    [['cont-pendentes', S.pagamentosAguardando().length],
     ['cont-receber', S.contasReceber().filter(S.receberAberto).length],
     ['cont-receber-atraso', S.contasReceber().filter(function (r) { return S.receberVencido(r); }).length],
     ['cont-anexos', S.semAnexo().length]].forEach(function (par) {
      const el = U.el(par[0]);
      el.textContent = par[1];
      el.style.display = par[1] ? '' : 'none';
    });
    // a aba existe para quem aprova e para quem solicitou (pode desfazer)
    U.el('aba-aprovacoes').style.display = (S.pode('aprovar') || S.pode('pagar')) ? '' : 'none';
  }

  let iniciado = false;
  function init() {
    if (iniciado) return;   // DOMContentLoaded pode disparar duas vezes
    iniciado = true;
    U.el('empresa-nome').textContent = D.empresa.nome;
    S.init();
    /* Clicar num campo numérico com "0" (ou qualquer valor) e digitar
       direto, sem apagar antes — comportamento padrão de campo
       numérico em qualquer planilha. Um listener só, delegado no
       documento, cobre todo campo `.num` da tela inteira, mesmo os
       que ainda vão ser desenhados depois (a lista se redesenha o
       tempo todo). `focusin` porque `focus` puro não borbulha. */
    document.addEventListener('focusin', function (e) {
      if (e.target.classList && e.target.classList.contains('num')) e.target.select();
    });
    montarSessao();
    ERP.lancamento.montar();
    ERP.contas.montar();
    ERP.relatorios.montar();
    ERP.produtividade.montar();
    ERP.remessa.montar();
    ERP.faturamento.montar();
    ERP.receber.montar();
    ERP.cadastros.montar();
    ERP.previsoes.montar();
    ERP.contratos.montar();
    ERP.estoque.montar();
    ERP.procedimentos.montar();
    ERP.compras.montar();
    ERP.conciliacao.montar();
    ERP.saldo.montar();
    ERP.ativos.montar();
    ERP.retencoes.montar();
    ERP.administracao.montar();
    ERP.dp.montar();
    renderHome();
    U.el('btn-home').addEventListener('click', function () { abrirModulo('home'); });
    document.querySelectorAll('#area-fin button').forEach(function (b) {
      b.addEventListener('click', function () { abrirArea(b.dataset.area); });
    });
    document.querySelectorAll('#sub-abas button').forEach(function (b) {
      b.addEventListener('click', function () { abrirAba(b.dataset.aba); });
    });
    aplicarPermissoes();
    ERP.contas.render();
    atualizarContadores();
    abrirModulo('home');
  }

  return { init: init, iniciar: init, aviso: aviso, erroCampo: erroCampo, modal: modal, fecharModal: fecharModal,
           abrirModulo: abrirModulo, abrirAba: abrirAba, abrirArea: abrirArea, renderHome: renderHome,
           atualizar: atualizar, atualizarContadores: atualizarContadores };
})();

/* Com banco configurado, quem decide quando iniciar é o login: o
   sistema só monta depois que alguém entra, e com o perfil que o
   BANCO disser. Sem banco, inicia direto, como sempre — é o modo em
   que a bateria roda e em que a demonstração funciona. */
document.addEventListener('DOMContentLoaded', function () {
  if (ERP.auth && ERP.auth.configurado()) {
    ERP.auth.iniciar().then(function (assumiu) {
      if (!assumiu) ERP.app.init();
    }).catch(function (e) {
      console.error('Falha ao iniciar a sessão:', e);
      ERP.app.init();
    });
    return;
  }
  ERP.app.init();
});
