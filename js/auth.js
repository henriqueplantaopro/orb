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
    /* ERRO DE CONSULTA E AUSÊNCIA DE VÍNCULO NÃO SÃO A MESMA COISA,
       e juntá-los numa frase só custou uma rodada de diagnóstico.

       Sem linha: a conta de login existe e ninguém a ligou a um
       usuário do sistema — é cadastro, e a Administração resolve.

       Com erro: a consulta nem chegou a responder (política de
       acesso, coluna que mudou, banco fora). Dizer "fale com a
       Administração" nesse caso manda a pessoa para o lugar
       errado, porque não há nada que a Administração possa fazer.

       O e-mail vai na mensagem porque é a pergunta seguinte em
       qualquer um dos dois casos: quase sempre o endereço digitado
       não é o que está gravado em `usuarios`. */
    if (error) {
      return { erro: 'O login funcionou, mas não foi possível conferir o seu usuário no ' +
        'sistema: ' + (error.message || 'erro sem mensagem') + '. Isso não é senha errada — ' +
        'mande esta mensagem para quem cuida do sistema.' };
    }
    if (!data) {
      return { erro: 'Este login (' + (session.user.email || 'sem e-mail') + ') não está ' +
        'vinculado a nenhum usuário do sistema. Fale com a Administração — é o e-mail ' +
        'gravado no cadastro do usuário que tem de ser igual a este.' };
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
    marcarDiaDaSessao();
    vigiarVirada();
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
  /* ── A TELA DA ESPERA ────────────────────────────────────
     Entre o login aceito e o sistema montado há uma carga, e até a
     v120 esse intervalo não tinha tela nenhuma: ficava o cabeçalho
     sozinho sobre o cinza. Indistinguível de um sistema quebrado —
     e, no dia em que o banco respondeu devagar, foi lido como
     quebra pela empresa inteira.

     Agora o intervalo tem voz: diz o que está buscando e quantas
     de quantas já vieram. Quem espera sabendo o que espera, espera
     melhor; e quem vê "12 de 33" sabe que não travou. */
  function telaEspera() {
    let d = document.getElementById('tela-carregando');
    if (d) return d;
    d = document.createElement('div');
    d.id = 'tela-carregando';
    d.innerHTML =
      '<div class="carregando-caixa">' +
        '<div class="login-marca">HJM Dom Pedro</div>' +
        '<div class="carregando-txt" id="carregando-txt">entrando…</div>' +
        '<div class="carregando-barra"><i id="carregando-fita"></i></div>' +
      '</div>';
    document.body.appendChild(d);
    return d;
  }

  function fecharEspera() {
    const d = document.getElementById('tela-carregando');
    if (d) d.remove();
  }

  /* O FIM RUIM TAMBÉM É UMA TELA, e não um sumiço.

     Antes, falha na carga jogava a pessoa de volta no login com
     uma frase — o que é enganoso, porque a senha estava certa e o
     login tinha funcionado. O problema é do banco, e a ação certa
     não é digitar a senha de novo: é tentar de novo. */
  function esperaFalhou(motivo, tentarDeNovo) {
    const d = telaEspera();
    d.innerHTML =
      '<div class="carregando-caixa">' +
        '<div class="login-marca">HJM Dom Pedro</div>' +
        '<h1>Não consegui carregar os dados</h1>' +
        '<div class="login-erro">' + ERP.util.esc(motivo) + '</div>' +
        '<div class="sub">Seu acesso está certo — quem não respondeu foi o banco. ' +
        'Isso costuma passar numa segunda tentativa.</div>' +
        '<button class="btn-aprovar" id="carregando-retentar">Tentar de novo</button>' +
        '<button class="btn-sm" id="carregando-sair">Sair</button>' +
      '</div>';
    const b = document.getElementById('carregando-retentar');
    if (b) b.addEventListener('click', function () {
      b.disabled = true; b.textContent = 'tentando…';
      tentarDeNovo();
    });
    const x = document.getElementById('carregando-sair');
    if (x) x.addEventListener('click', function () { sair(); });
  }

  async function montarTudo(s) {
    /* 1. cadastros antes de montar: o sistema tem de subir com os
       centros e credores que existem de verdade. */
    if (ERP.dadosRemoto) {
      telaEspera();
      ERP.util.avisarCarga(function (txt, feitos, total) {
        const t = document.getElementById('carregando-txt');
        if (t) t.textContent = txt + (total ? ' — ' + feitos + ' de ' + total : '…');
        const f = document.getElementById('carregando-fita');
        if (f && total) f.style.width = Math.round((feitos / total) * 100) + '%';
      });

      /* O `try` é o ponto da correção. Sem ele, qualquer recusa
         aqui dentro — rede caindo, prazo estourado — virava
         promessa rejeitada sem dono: a montagem parava no meio,
         nada era dito e a tela ficava como estava, para sempre. */
      let r;
      try {
        r = await ERP.dadosRemoto.carregar();
      } catch (e) {
        ERP.util.avisarCarga(null);
        esperaFalhou(e && e.message ? e.message : String(e),
          function () { montarTudo(s); });
        return;
      }
      ERP.util.avisarCarga(null);
      if (r && r.erro) {
        esperaFalhou(r.erro, function () { montarTudo(s); });
        return;
      }
      fecharEspera();
      /* A partir daqui a tela se mantém atualizada sozinha: sem
         isso, a sessão trabalha para sempre com o retrato do
         momento em que entrou, e quem dá entrada de material não
         aparece para quem está com a tela aberta. */
      if (ERP.dadosRemoto.ligarRecargaAutomatica) ERP.dadosRemoto.ligarRecargaAutomatica();
    }

    // 2. a tela
    iniciarComSessao(s);

    /* A POLÍTICA LIDA DO BANCO entra agora, não antes: `store.init()`
       acabou de recriar `st.parametros` com o padrão do código, e
       aplicar antes seria escrever num objeto já descartado. Alçada,
       segregação e trava de competência vêm daqui. */
    if (ERP.dadosRemoto && ERP.dadosRemoto.aplicarPolitica) ERP.dadosRemoto.aplicarPolitica();

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
    if (tag) {
      /* A etiqueta vira BOTÃO de atualizar e mostra há quanto tempo
         os dados foram lidos. Duas pessoas no sistema ao mesmo
         tempo veem coisas diferentes por minutos — e sem nada na
         tela dizendo isso, cada uma acha que a outra não lançou. */
      tag.textContent = 'conectado ao banco';
      tag.style.cursor = 'pointer';
      tag.title = 'Clique para buscar o que mudou agora';
      if (!tag.dataset.ligado) {
        tag.dataset.ligado = '1';
        tag.addEventListener('click', function () {
          if (!ERP.dadosRemoto || !ERP.dadosRemoto.recarregar) return;
          tag.textContent = 'atualizando…';
          ERP.dadosRemoto.recarregar(false).then(function () { atualizarEtiqueta(); });
        });
        setInterval(atualizarEtiqueta, 30000);
      }
      atualizarEtiqueta();
    }
  }

  function atualizarEtiqueta() {
    const tag = ERP.util.el('tag-modo');
    if (!tag || !ERP.dadosRemoto || !ERP.dadosRemoto.minutosDesdeALeitura) return;
    const m = ERP.dadosRemoto.minutosDesdeALeitura();
    if (m === null) { tag.textContent = 'conectado ao banco'; return; }
    tag.textContent = m < 1 ? 'dados de agora'
      : m === 1 ? 'dados de 1 minuto atrás'
      : 'dados de ' + m + ' minutos atrás';
    /* Passou muito tempo sem leitura — conexão caiu, aba
       hibernou — a cor avisa antes que alguém decida por um saldo
       velho. */
    tag.style.color = m >= 15 ? 'var(--amber, #8a6d00)' : '';
  }

  /* EXPIRAÇÃO DIÁRIA à meia-noite.

     A sessão do Supabase se renova sozinha e dura semanas — quem
     entrou uma vez num computador compartilhado continua dentro.
     Aqui a sessão vale até as 00:00 do dia em que começou.

     O que isto cobre: o computador que fica ligado, a aba que
     ninguém fechou, a pessoa que saiu de férias. Na prática, é o
     caso real.

     O que NÃO cobre, e é honesto dizer: quem copiasse o token do
     navegador poderia usá-lo pela API até ele expirar no servidor,
     porque esta desconexão acontece no cliente. Fechar isso exige
     reduzir o tempo de vida do token nas configurações do Supabase
     (Authentication › Sessions) — é uma troca entre segurança e
     pedir senha com mais frequência, e fica como decisão sua. */
  const CHAVE_DIA = 'erp_sessao_dia';

  function hojeLocal() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  }

  function marcarDiaDaSessao() {
    try { localStorage.setItem(CHAVE_DIA, hojeLocal()); } catch (e) { /* sem storage */ }
  }

  function sessaoVenceu() {
    try {
      const dia = localStorage.getItem(CHAVE_DIA);
      return !!dia && dia !== hojeLocal();
    } catch (e) { return false; }
  }

  /* Com a aba aberta, a virada do dia desconecta sem esperar a
     próxima ação: o relógio é verificado de minuto em minuto. */
  function vigiarVirada() {
    setInterval(function () {
      if (!sessaoVenceu()) return;
      if (ERP.persistencia && ERP.persistencia.pendencias &&
          ERP.persistencia.pendencias() > 0) {
        /* Não desconecta com lançamento por gravar: perder trabalho
           é pior que a sessão durar mais alguns minutos. */
        return;
      }
      alert('Sua sessão expirou (as sessões valem até a meia-noite). Entre de novo.');
      sair();
    }, 60000);
  }

  /* Ponto de entrada: decide entre modo local e modo com login. */
  async function iniciar() {
    if (!configurado()) return false;      // segue no modo local
    const s = await carregarSessao();
    if (s && !s.erro && sessaoVenceu()) {
      /* Sessão de ontem: pede a senha de novo antes de qualquer
         coisa, sem carregar dado nenhum. */
      const c = conectar();
      if (c) await c.auth.signOut();
      try { localStorage.removeItem(CHAVE_DIA); } catch (e) { /* sem storage */ }
      telaLogin('Sua sessão expirou — as sessões valem até a meia-noite. Entre de novo.');
      return true;
    }
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
           sessaoAtual: () => sessao, cliente: conectar,
           /* Gancho da bateria: deixa a prova entrar pelo mesmo
              caminho que o login de verdade usa, sem ter de
              digitar senha num banco falso. O sublinhado marca que
              não é para ser chamado pela tela. */
           _montarTudo: montarTudo };
})();
