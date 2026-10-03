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
      auth: { persistSession: true, autoRefreshToken: true },
      /* `Prefer: return=minimal` no CLIENTE, não na chamada.
         A opcao `returning` dentro de upsert() foi removida no
         supabase-js v2 e e ignorada em silencio — o POST continuava
         mandando `return=representation`, o Postgres fazia
         RETURNING *, e o * inclui a coluna `paciente`, revogada: 403.

         No cliente o cabecalho vale para toda escrita. Quando
         alguma chamada precisar do retorno, ela pede com um
         `.select('<colunas>')` explicito, que sobrescreve isto. */
      global: { headers: { Prefer: 'return=minimal' } }
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
      /* Mesma trava no outro caminho de entrada. Esquecer um dos
         dois já custou uma versão. */
      if (r.sessao.usuario && r.sessao.usuario.senha_provisoria) {
        telaTrocaObrigatoria(r.sessao);
        return;
      }
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
          '<button class="btn-usuario" id="btn-meus-dados" title="Ver meus dados">' +
          ERP.util.esc(s.usuario.nome) + '</button>' +
          '<button class="btn-sm" id="btn-sair">Sair</button>';
        const bu = ERP.util.el('btn-meus-dados');
        if (bu) bu.addEventListener('click', function () {
          if (ERP.perfilUsuario) ERP.perfilUsuario.abrir();
        });
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

  /* Senha provisória: o administrador definiu uma senha para
     destravar o acesso, e a pessoa tem de escolher a dela antes de
     usar o sistema. A tela não fecha e não há como pular — é o que
     garante que o administrador deixe de saber a senha assim que a
     pessoa entra. */
  function telaTrocaObrigatoria(s) {
    const d = document.createElement('div');
    d.id = 'tela-login';
    d.innerHTML =
      '<div class="login-caixa">' +
        '<div class="login-marca">HJM Dom Pedro</div>' +
        '<h1>Escolha a sua senha</h1>' +
        '<div class="ajuda">Você entrou com uma senha provisória, definida pela ' +
        'Administração. Escolha a sua para continuar — ninguém mais vai conhecê-la.</div>' +
        '<label for="tr-nova">Nova senha</label>' +
        '<input type="password" id="tr-nova" autocomplete="new-password" autofocus>' +
        '<label for="tr-nova2">Repita a nova senha</label>' +
        '<input type="password" id="tr-nova2" autocomplete="new-password">' +
        '<button class="btn-aprovar" id="tr-ok">Salvar e entrar</button>' +
        '<div id="tr-msg"></div>' +
        '<div class="login-ajuda">Pelo menos 8 caracteres.</div>' +
      '</div>';
    document.body.appendChild(d);

    const diz = function (t) {
      const m = ERP.util.el('tr-msg');
      if (m) m.innerHTML = '<div class="login-erro" style="margin-top:10px">' +
        ERP.util.esc(t) + '</div>';
    };

    const salvar = async function () {
      const n1 = ERP.util.val('tr-nova'), n2 = ERP.util.val('tr-nova2');
      if (!n1 || n1.length < 8) return diz('A senha precisa ter pelo menos 8 caracteres.');
      if (n1 !== n2) return diz('As duas senhas não são iguais.');
      const b = ERP.util.el('tr-ok');
      b.disabled = true; b.textContent = 'Salvando…';
      const c = conectar();
      const { error } = await c.auth.updateUser({ password: n1 });
      if (error) {
        b.disabled = false; b.textContent = 'Salvar e entrar';
        return diz('Não foi possível trocar: ' + error.message);
      }
      /* Só desmarca DEPOIS de a senha nova valer. Na ordem inversa,
         uma falha de rede no meio deixaria a pessoa sem a marca e
         ainda com a senha do administrador. */
      const r = await c.rpc('marcar_senha_trocada');
      if (r && r.error) {
        b.disabled = false; b.textContent = 'Salvar e entrar';
        return diz('Senha trocada, mas o sistema não conseguiu registrar isso: ' +
          r.error.message + ' Avise a Administração.');
      }
      if (s.usuario) s.usuario.senha_provisoria = false;
      d.remove();
      montarTudo(s);
    };

    ERP.util.el('tr-ok').addEventListener('click', salvar);
    d.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') salvar(); });
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

    /* O movimento de exemplo sai DEPOIS de montar, não antes.
       `iniciarComSessao` chama o `init` do app, que chama
       `store.init()` — e o `init` recria o seed inteiro. Limpar
       antes era limpar e ver tudo voltar: títulos, posições e
       ativos de demonstração seguiam na tela por um segundo, com
       cara de número da empresa.

       Depois da montagem, o estado fica vazio até o banco
       responder. Vazio é honesto. */
    if (ERP.persistencia && ERP.persistencia.limparMovimentoLocal) {
      ERP.persistencia.limparMovimentoLocal();
      if (ERP.app && ERP.app.redesenhar) ERP.app.redesenhar();
    }

    /* Funcionários: só agora dá para carregar, porque a FONTE
       depende da permissão de quem entrou — a tabela inteira para
       quem tem `ver_dados_pessoais`, a visão sem CPF e salário para
       os demais. Enquanto isso, a lista fica vazia em vez de
       mostrar a semente do código. */
    if (ERP.dados && Array.isArray(ERP.dados.funcionarios)) ERP.dados.funcionarios.length = 0;
    if (ERP.dadosRemoto && ERP.dadosRemoto.funcionarios) {
      ERP.dadosRemoto.funcionarios().then(function (aviso) {
        if (aviso && ERP.app && ERP.app.aviso) {
          ERP.app.aviso('Pessoal: ' + aviso, 'erro');
        }
        if (ERP.app && ERP.app.redesenhar) ERP.app.redesenhar();
      });
    }

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
    /* Os dados chegaram: redesenha a tela ABERTA, não só a home. Sem
       isto o módulo aberto seguia mostrando o estado anterior à
       carga — e trocar de aba e voltar "consertava", o que é pior
       que um erro claro: a pessoa vê dois números para a mesma
       coisa e não sabe qual vale. */
    if (ERP.app && ERP.app.redesenhar) ERP.app.redesenhar();
    else if (ERP.app && ERP.app.atualizar) ERP.app.atualizar();
    const tag = ERP.util.el('tag-modo');
    if (r && r.degradadas && r.degradadas.length) {
      /* Carregou quase tudo. Nomear o que faltou é melhor que
         desligar tudo ou fingir que está completo. */
      if (tag) tag.textContent = 'conectado — ' + r.degradadas.length + ' módulo(s) sem gravar';
      if (ERP.app && ERP.app.aviso) {
        ERP.app.aviso('Estes módulos não gravam nesta sessão: ' + r.degradadas.join(', ') +
          '. Causa: ' + (r.detalhe || 'desconhecida'), 'erro');
      }
      return;
    }
    if (tag) tag.textContent = 'conectado ao banco';
  }

  /* Ponto de entrada: decide entre modo local e modo com login. */
  async function iniciar() {
    if (!configurado()) return false;      // segue no modo local
    const s = await carregarSessao();
    if (s && !s.erro) {
      /* Senha provisória barra tudo: nem cadastro é carregado antes
         de a pessoa escolher a dela. */
      if (s.usuario && s.usuario.senha_provisoria) {
        telaTrocaObrigatoria(s);
        return true;
      }
      await montarTudo(s);
      return true;
    }
    telaLogin(s && s.erro);
    return true;
  }

  return { iniciar: iniciar, entrar: entrar, sair: sair, configurado: configurado,
           sessaoAtual: () => sessao, cliente: conectar };
})();
