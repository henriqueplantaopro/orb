/* Login.

   Enquanto não houver banco configurado (ou enquanto a biblioteca
   do Supabase não carregar), o sistema segue como sempre: o seletor
   de usuário no canto, sem login, sem guardar nada. É o modo em que
   a bateria de testes roda e em que a demonstração funciona.

   Com banco configurado, o seletor some e aparece a tela de login.
   Quem entra passa a ser o usuário da sessão, com o perfil que o
   BANCO disser — não o que o navegador escolher. */
window.ERP = window.ERP || {};
ERP.auth = (function () {
  const U = () => ERP.util;
  let cliente = null;
  let sessao = null;          // { usuario, perfil, email }

  const configurado = () => !!(ERP.config && ERP.config.url && ERP.config.anon &&
    window.supabase && window.supabase.createClient);

  function conectar() {
    if (cliente || !configurado()) return cliente;
    cliente = window.supabase.createClient(ERP.config.url, ERP.config.anon, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    return cliente;
  }

  /* Quem é a pessoa, no vocabulário do ERP. O login do Supabase
     devolve um e-mail; é a tabela `usuarios` que diz qual perfil
     esse e-mail tem. Sem linha correspondente, não entra: conta de
     login sem usuário no sistema é conta que ninguém cadastrou. */
  async function carregarSessao() {
    const c = conectar();
    if (!c) return null;
    const { data: { session } } = await c.auth.getSession();
    if (!session) return null;
    const { data, error } = await c
      .from('usuarios')
      .select('id, nome, perfil, email, ativo')
      .eq('auth_id', session.user.id)
      .maybeSingle();
    if (error || !data) {
      return { erro: 'Este login não está vinculado a nenhum usuário do sistema. ' +
        'Fale com a Administração.' };
    }
    if (!data.ativo) return { erro: 'Este usuário está inativo.' };
    sessao = { usuario: data, email: session.user.email };
    return sessao;
  }

  async function entrar(email, senha) {
    const c = conectar();
    if (!c) return { erro: 'Banco não configurado.' };
    const { error } = await c.auth.signInWithPassword({ email: email, password: senha });
    if (error) {
      /* Mensagem única para e-mail errado e senha errada: dizer qual
         dos dois está errado conta a quem tenta se aquele e-mail
         existe no sistema. */
      return { erro: 'E-mail ou senha incorretos.' };
    }
    const s = await carregarSessao();
    if (!s || s.erro) {
      await c.auth.signOut();
      return { erro: (s && s.erro) || 'Não foi possível abrir a sessão.' };
    }
    return { ok: true, sessao: s };
  }

  async function sair() {
    const c = conectar();
    if (c) await c.auth.signOut();
    sessao = null;
    location.reload();
  }

  function telaLogin(mensagem) {
    const d = document.createElement('div');
    d.id = 'tela-login';
    d.innerHTML =
      '<div class="login-caixa">' +
        '<div class="login-marca">HJM Dom Pedro</div>' +
        '<h1>Entrar no sistema</h1>' +
        (mensagem ? '<div class="login-erro">' + ERP.util.esc(mensagem) + '</div>' : '') +
        '<label for="login-email">E-mail</label>' +
        '<input type="email" id="login-email" autocomplete="username" autofocus>' +
        '<label for="login-senha">Senha</label>' +
        '<input type="password" id="login-senha" autocomplete="current-password">' +
        '<button class="btn-aprovar" id="login-entrar">Entrar</button>' +
        '<div class="login-ajuda">Esqueceu a senha? Fale com a Administração.</div>' +
      '</div>';
    document.body.appendChild(d);

    const tentar = async function () {
      const b = ERP.util.el('login-entrar');
      b.disabled = true; b.textContent = 'Entrando…';
      const r = await entrar(ERP.util.val('login-email').trim(), ERP.util.val('login-senha'));
      if (r.erro) {
        b.disabled = false; b.textContent = 'Entrar';
        const velho = d.querySelector('.login-erro');
        if (velho) velho.remove();
        const e = document.createElement('div');
        e.className = 'login-erro';
        e.textContent = r.erro;
        d.querySelector('h1').insertAdjacentElement('afterend', e);
        return;
      }
      d.remove();
      montarTudo(r.sessao);
    };
    ERP.util.el('login-entrar').addEventListener('click', tentar);
    d.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') tentar(); });
  }

  /* Com sessão aberta, o seletor de usuário vira o nome de quem
     entrou, com a opção de sair. Trocar de usuário deixa de ser um
     clique: é sair e entrar de novo. */
  function iniciarComSessao(s) {
    /* A ORDEM importa, e errá-la deixa a tela em branco:

       1. montar o sistema primeiro. O `init` do app chama
          `store.init()`, que recria o estado do zero — definir o
          usuário antes seria perdê-lo;
       2. e só então trocar o seletor de usuário pela barra de
          sessão. Trocar antes faz o `init` procurar um seletor que
          já não existe e morrer no meio. */
    try {
      if (ERP.app && ERP.app.iniciar) ERP.app.iniciar();
      ERP.store.setUsuario(s.usuario.id);

      const cx = document.querySelector('.sessao');
      if (cx) {
        cx.innerHTML = '<span>Você está como</span>' +
          '<b style="margin:0 8px">' + ERP.util.esc(s.usuario.nome) + '</b>' +
          '<button class="btn-sm" id="btn-sair">Sair</button>';
        const bs = ERP.util.el('btn-sair');
        if (bs) bs.addEventListener('click', sair);
      }
      const tag = ERP.util.el('tag-modo');
      if (tag) tag.textContent = 'conectado ao banco — dados ainda não são guardados';
      /* Com o usuário já definido, redesenha: as permissões do
         perfil mudam o que aparece. */
      if (ERP.app && ERP.app.atualizar) ERP.app.atualizar();
      if (ERP.app && ERP.app.renderHome) ERP.app.renderHome();
    } catch (e) {
      console.error('Falha ao montar o sistema depois do login:', e);
      document.body.insertAdjacentHTML('afterbegin',
        '<div style="background:#fdeaea;border:1px solid #f0c2c2;color:#8a2b2b;' +
        'padding:12px;margin:12px;border-radius:6px">Entrou como <b>' +
        ERP.util.esc(s.usuario.nome) + '</b>, mas a tela não montou: ' +
        ERP.util.esc(e.message) + '. Abra o console (F12) e me mande o erro.</div>');
    }
  }

  /* CAMINHO ÚNICO de montagem. Existem duas formas de entrar — com
     a sessão já salva no navegador, ou digitando e-mail e senha — e
     as duas passam por aqui.

     Ter dois caminhos foi o defeito da primeira versão: quem
     acabava de fazer login entrava sem carregar nada do banco, e o
     lançamento sumia ao recarregar. Um caminho só, para não haver
     o que esquecer de repetir. */
  async function montarTudo(s) {
    /* 1. cadastros antes de montar: o sistema tem de subir com os
       centros e credores que existem de verdade. */
    if (ERP.dadosRemoto) {
      const r = await ERP.dadosRemoto.carregar();
      if (r && r.erro) {
        telaLogin('Entrou, mas não foi possível carregar os cadastros: ' + r.erro);
        return;
      }
    }

    // 2. a tela
    iniciarComSessao(s);

    /* Enquanto o movimento carrega, a etiqueta diz isso. Sem o
       aviso, quem olhasse nesse intervalo concluiria que o sistema
       não grava — e estaria vendo só a carga em andamento. */
    const tagCarga = ERP.util.el('tag-modo');
    if (tagCarga) tagCarga.textContent = 'carregando os lançamentos…';

    // 3. o movimento, que é o que leva mais tempo
    if (!ERP.persistencia) return;
    let r;
    try {
      r = await ERP.persistencia.iniciar();
    } catch (e) {
      r = { erro: e.message };
    }
    if (r && r.erro) {
      if (ERP.app && ERP.app.aviso) {
        ERP.app.aviso('Conectado, mas SEM GRAVAR no banco: ' + r.erro +
          ' Os lançamentos ficarão só nesta tela.', 'erro');
      }
      const tag = ERP.util.el('tag-modo');
      if (tag) tag.textContent = 'conectado — mas NÃO está gravando';
      return;
    }
    if (ERP.app && ERP.app.atualizar) ERP.app.atualizar();
    if (ERP.app && ERP.app.renderHome) ERP.app.renderHome();
    const tag = ERP.util.el('tag-modo');
    if (tag) tag.textContent = 'conectado ao banco';
  }

  /* Ponto de entrada: decide entre modo local e modo com login. */
  async function iniciar() {
    if (!configurado()) return false;      // segue no modo local
    const s = await carregarSessao();
    if (s && !s.erro) {
      /* Os cadastros vêm do banco ANTES de montar: o sistema tem de
         subir já com os centros, credores e contas que existem de
         verdade, não com os de exemplo. */
      await montarTudo(s);
      return true;
    }
    telaLogin(s && s.erro);
    return true;
  }

  return { iniciar: iniciar, entrar: entrar, sair: sair, configurado: configurado,
           sessaoAtual: () => sessao, cliente: conectar };
})();
