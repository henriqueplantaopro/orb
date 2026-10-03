/* ERP · ui-administracao.js — quem pode o quê, e o rastro do que foi feito.

   As telas daqui existem por causa dos furos que a auditoria apontou:
   ninguém tinha alçada por valor, a mesma pessoa aprovava e pagava, dava
   para pagar sem nota anexada, o mês fechado continuava recebendo
   lançamento e o sequencial da remessa era dividido com o Protheus sem
   faixa combinada. */
window.ERP = window.ERP || {};

ERP.administracao = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;
  let aba = 'usuarios';

  const GRUPOS = [
    { titulo: 'Acesso', itens: [
      { id: 'usuarios', nome: 'Usuários e perfis', conta: function () {
          return D.usuarios.filter(function (u) { return u.ativo !== false; }).length; } },
      { id: 'perfis', nome: 'Perfis de acesso', conta: function () { return D.perfis.length; } }
    ] },
    { titulo: 'Controles', itens: [
      { id: 'politicas', nome: 'Alçadas e políticas', conta: function () { return 5; } },
      { id: 'bancos', nome: 'Contas e remessa', conta: function () { return D.bancos.length; } },
      { id: 'fiscal', nome: 'Parâmetros fiscais (NF-e)', conta: function () { return 8; } },
      { id: 'impostos', nome: 'Impostos dos procedimentos', conta: function () {
          return S.tributosProcedimentos().length; } }
    ] },
    { titulo: 'Registro', itens: [
      { id: 'auditoria', nome: 'Trilha de auditoria', conta: function () { return S.eventos().length; } }
    ] }
  ];

  // os perfis vêm do cadastro, não de uma lista fixa
  const perfilNome = id => (D.perfil(id) || {}).nome || id;

  function montar() { /* menu desenhado no render */ }

  function menu() {
    U.el('ad-nav').innerHTML = GRUPOS.map(function (g) {
      return '<div class="grupo">' + U.esc(g.titulo) + '</div>' +
        g.itens.map(function (i) {
          return '<button data-ad="' + i.id + '" aria-pressed="' + (i.id === aba) + '">' +
            U.esc(i.nome) + '<span class="qtd">' + i.conta() + '</span></button>';
        }).join('');
    }).join('');
    U.el('ad-nav').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { aba = this.dataset.ad; render(); });
    });
  }

  /* Imposto estimado dos procedimentos, aberto por tributo. Um número
     só escondia a composição — e é ela que a contabilidade ajusta:
     o ISS muda por município, e a presunção de IRPJ/CSLL muda se o
     serviço for equiparado a hospitalar (32% → 8% e 12%). */
  function impostos() {
    /* A alíquota vem do CADASTRO DO PROJETO — fonte única. Esta tela
       edita o mesmo dado que Cadastros › projeto › impostos, e os
       subprojetos do mutirão acompanham o projeto-mãe. */
    const lista = S.tributosProcedimentos(D.PATE_CENTRO).slice();
    const total = S.impostoProcedimentos(D.PATE_CENTRO);
    const exemplo = 1466.04;
    const det = S.detalharImposto(exemplo);
    return '<p class="ajuda">Alíquota aplicada sobre o faturamento dos procedimentos do mutirão. ' +
        'É o <b>mesmo dado</b> do cadastro do projeto ' +
        U.esc((D.centro(D.PATE_CENTRO) || {}).curto || '') + ' — mudar aqui muda lá, e os ' +
        'subprojetos por especialidade acompanham. O imposto é recalculado em todo o histórico, ' +
        'inclusive no que já foi lançado.</p>' +
      '<table><thead><tr><th>Tributo</th><th class="num" style="width:120px">Alíquota %</th>' +
        '<th>Observação</th><th class="num">Sobre ' + U.brl(exemplo) + '</th>' +
        '<th class="num" style="width:70px">Ativo</th></tr></thead><tbody>' +
        lista.map(function (t, i) {
          const parte = det.partes.find(function (x) { return x.id === t.id; });
          return '<tr><td><input class="imp-nome" data-i="' + i + '" value="' + U.esc(t.nome) + '"></td>' +
            '<td class="num"><input type="number" step="0.01" min="0" max="100" class="imp-aliq" ' +
              'data-i="' + i + '" style="text-align:right" value="' + t.aliquota + '"></td>' +
            '<td><input class="imp-obs" data-i="' + i + '" value="' + U.esc(t.obs || '') +
              '" placeholder="opcional"></td>' +
            '<td class="num sub">' + (t.ativo === false ? '—' : U.brl(parte ? parte.valor : 0)) + '</td>' +
            '<td class="num"><input type="checkbox" class="imp-ativo" data-i="' + i + '"' +
              (t.ativo === false ? '' : ' checked') + ' style="width:auto"></td></tr>';
        }).join('') +
        '<tr style="border-top:2px solid var(--ink)"><td><b>Total</b></td>' +
        '<td class="num"><b>' + U.num(total) + '%</b></td><td></td>' +
        '<td class="num"><b>' + U.brl(det.total) + '</b></td><td></td></tr>' +
      '</tbody></table>' +
      '<div class="acoes-rodape" style="margin-top:10px">' +
        '<button class="btn-sm" id="imp-novo">+ Tributo</button>' +
        '<button class="btn-sm" id="imp-padrao">Voltar ao padrão</button>' +
        '<button class="btn-aprovar" id="imp-salvar">Salvar</button>' +
      '</div>' +
      '<div class="ajuda">O ISS varia por município, e a presunção do Lucro Presumido muda se o ' +
        'serviço for equiparado a hospitalar (8% e 12% em vez de 32%), o que leva IRPJ e CSLL a ' +
        '1,2% e 1,08%. Estes valores também aparecem no resultado do faturamento e na montagem do ' +
        'RPS — é um cadastro só.</div>';
  }

  function lerImpostos() {
    const lista = S.tributosProcedimentos(D.PATE_CENTRO).map(function (t) {
      return Object.assign({}, t);
    });
    document.querySelectorAll('.imp-nome').forEach(function (e) {
      lista[+e.dataset.i].nome = e.value; });
    document.querySelectorAll('.imp-aliq').forEach(function (e) {
      lista[+e.dataset.i].aliquota = e.value; });
    document.querySelectorAll('.imp-obs').forEach(function (e) {
      lista[+e.dataset.i].obs = e.value; });
    document.querySelectorAll('.imp-ativo').forEach(function (e) {
      lista[+e.dataset.i].ativo = e.checked; });
    return lista;
  }

  function render() {
    menu();
    U.el('ad-saida').innerHTML =
      aba === 'usuarios'   ? usuarios() :
      aba === 'perfis'     ? perfis() :
      aba === 'politicas'  ? politicas() :
      aba === 'bancos'     ? bancos() :
      aba === 'fiscal'     ? fiscal() :
      aba === 'impostos'   ? impostos() :
                             auditoria();
    ligar();
  }

  /* Códigos que vão dentro do arquivo de RPS. Ficam aqui, editáveis,
     porque mudam por decisão da contabilidade — e porque são os que a
     prefeitura recusa primeiro. Os valores que vêm de fábrica são
     razoáveis para serviços médicos e servem para testar a emissão; o
     definitivo sai da NF-e que a empresa já emite. */
  const CAMPOS_FISCAIS = [
    { id: 'inscricao_municipal', nome: 'Inscrição municipal', onde: 'empresa',
      ajuda: 'sem ponto e sem traço — está no cabeçalho do portal' },
    { id: 'codigo_ibge', nome: 'Código IBGE do município', onde: 'empresa',
      ajuda: 'Barueri = 3505708' },
    { id: 'codigo_servico', nome: 'Código do serviço prestado', onde: 'rps',
      ajuda: 'aparece impresso em qualquer NF-e já emitida pela empresa' },
    { id: 'serie', nome: 'Série do RPS', onde: 'rps', ajuda: 'normalmente "RPS"' },
    { id: 'nbs', nome: 'Código NBS', onde: 'rps',
      ajuda: 'Nomenclatura Brasileira de Serviços — exigido pelo padrão nacional' },
    { id: 'ind_operacao', nome: 'Indicador da operação', onde: 'rps',
      ajuda: 'tabela do Anexo VII da NFS-e nacional' },
    { id: 'class_trib', nome: 'Classificação tributária IBS/CBS', onde: 'rps',
      ajuda: 'tabela nacional; os 3 primeiros dígitos têm que bater com a situação tributária' },
    { id: 'sit_trib', nome: 'Situação tributária IBS/CBS', onde: 'rps',
      ajuda: '3 primeiros dígitos da classificação acima' }
  ];

  function fiscal() {
    const e = D.empresa;
    const valor = c => (c.onde === 'rps' ? (e.rps || {})[c.id] : e[c.id]) || '';
    return '<h2>Parâmetros fiscais da NF-e<span class="sub">o que vai dentro do arquivo de RPS ' +
        'enviado à prefeitura</span></h2>' + avisoPerfil() +
      '<div class="ajuda">Os valores abaixo vêm preenchidos com uma sugestão para serviços médicos, ' +
        'o suficiente para testar a emissão. O definitivo sai de uma NF-e que a empresa já emitiu ' +
        '(código do serviço) e da contabilidade (os códigos de IBS/CBS). Trocar aqui vale para os ' +
        'próximos arquivos gerados.</div>' +
      '<table><thead><tr><th>Campo</th><th>Valor</th><th>Onde encontrar</th></tr></thead><tbody>' +
      CAMPOS_FISCAIS.map(function (c) {
        return '<tr><td class="desc">' + U.esc(c.nome) + '</td>' +
          '<td><input data-fiscal="' + c.id + '" data-onde="' + c.onde + '" value="' + U.esc(valor(c)) +
            '"' + (souAdmin() ? '' : ' disabled') + ' style="max-width:180px"></td>' +
          '<td class="sub">' + U.esc(c.ajuda) + '</td></tr>';
      }).join('') +
      '<tr><td class="desc">Enquadramento no Simples Nacional</td>' +
        '<td><select id="fiscal-simples"' + (souAdmin() ? '' : ' disabled') + '>' +
          [['1', 'Não optante'], ['2', 'MEI'], ['3', 'ME/EPP optante']].map(function (o) {
            return '<option value="' + o[0] + '"' +
              (String(e.simples_nacional || 1) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
          }).join('') + '</select></td>' +
        '<td class="sub">a HJM é lucro presumido: não optante</td></tr>' +
      '</tbody></table>' +
      (souAdmin() ? '<div class="ap-acoes"><button class="btn-linha" id="fiscal-salvar">Salvar</button></div>' : '') +
      '<div class="ajuda">A <b>retenção</b> não fica aqui: cada tomador retém de um jeito, então ela ' +
        'é por cliente, em Cadastros › Clientes. O ISS entra no líquido do contas a receber, mas não ' +
        'vai no arquivo — em Barueri a retenção do ISS decorre do código do serviço e do tomador, ' +
        'não de um campo do RPS.</div>';
  }

  const souAdmin = () => S.pode('admin');
  const avisoPerfil = () => souAdmin() ? '' :
    '<div class="aviso" style="margin-bottom:10px">Só o perfil de administração altera estas ' +
    'configurações. Troque o usuário no topo da tela (há um "Administrador" na lista) para editar.</div>';

  /* ── usuários ───────────────────────────────────────────*/
  /* Estado do login de cada pessoa, lido do banco. Guardado aqui
     porque a leitura é assíncrona e a tabela se redesenha várias
     vezes. */
  let statusLogin = null;

  function carregarStatusLogin() {
    if (!ERP.persistencia || !ERP.persistencia.statusLogins) return;
    ERP.persistencia.statusLogins().then(function (lista) {
      if (!lista || !lista.length) return;
      statusLogin = {};
      lista.forEach(function (l) { statusLogin[l.id] = l; });
      render();
    });
  }

  function usuarios() {
    return avisoPerfil() +
      '<div class="ap-acoes"><button class="btn-linha" id="ad-novo-user"' +
        (souAdmin() ? '' : ' disabled') + '>+ Novo usuário</button>' +
        (souAdmin() && ERP.persistencia && ERP.persistencia.ligado()
          ? '<button class="btn-sm" id="ad-ver-logins">Verificar logins</button>' : '') +
      '</div>' +
      '<div class="ajuda">O cadastro aqui define <b>o que a pessoa pode fazer</b>. A senha ' +
      'dela é criada uma única vez no painel do Supabase (Authentication › Users › Add user, ' +
      'com "Auto Confirm User" marcado) — o sistema não cria senha por conta própria, de ' +
      'propósito: para isso ele precisaria carregar a chave de administração do banco, e quem ' +
      'abrisse o console teria acesso a tudo. Criado o login, o vínculo é automático.</div>' +
      '<table><thead><tr><th>Nome</th><th>Perfil</th><th>E-mail</th>' +
      '<th class="num">Alçada</th><th>Login</th><th>Situação</th><th></th></tr></thead><tbody>' +
      D.usuarios.map(function (u) {
        const lim = S.parametros().alcada[u.perfil];
        return '<tr' + (u.ativo === false ? ' class="cancelada"' : '') + '>' +
          '<td class="desc">' + U.esc(u.nome) + '</td>' +
          '<td>' + U.esc(perfilNome(u.perfil)) +
            /* Conta pela matriz, não pela lista `modulos` do perfil:
               é a matriz que decide, e é ela que vem do banco. */
            '<div class="sub">' + D.MODULOS.filter(function (mo) {
              return S.acessoDoPerfil(u.perfil, mo.id).ver; }).length + ' módulo(s)</div></td>' +
          '<td class="sub">' + U.esc(u.email || '—') + '</td>' +
          '<td class="num">' + (['diretoria', 'socio', 'admin'].indexOf(u.perfil) < 0 ? '—'
            : lim ? U.brl(lim) : 'sem limite') + '</td>' +
          /* Quem já consegue entrar e quem não. Sem isto, só se
             descobria que faltava o login quando a pessoa tentava
             acessar e não conseguia. */
          '<td>' + (function () {
            if (!statusLogin) return '<span class="sub">—</span>';
            const st2 = statusLogin[u.id];
            if (!u.email) return '<span class="badge b-cancelado">sem e-mail</span>';
            if (st2 && st2.tem_login) {
              return '<span class="badge b-aprovado">entra</span>' +
                (st2.senha_provisoria ? '<div class="sub">senha provisória</div>' : '');
            }
            return '<span class="badge b-aberto" title="Crie em Authentication › Users">' +
              'falta criar</span>';
          })() + '</td>' +
          '<td>' + (u.ativo === false ? '<span class="badge b-cancelado">inativo</span>'
                                      : '<span class="badge b-aprovado">ativo</span>') + '</td>' +
          '<td class="acoes">' + (souAdmin()
            ? '<button class="btn-sm" data-user="' + u.id + '">Editar</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="ajuda">O seletor no topo da tela troca de usuário sem senha — é protótipo. ' +
      'No sistema de verdade isso vira login, e a trilha de auditoria passa a ser à prova de edição.</div>';
  }

  /* Dispara o e-mail de redefinição. Precisa de SMTP configurado no
     Supabase; sem isso o envio falha e a mensagem diz. */
  async function enviarReset(email) {
    const msg = U.el('us-reset-msg');
    const diz = function (t, cls) {
      if (msg) msg.innerHTML = '<div class="' + (cls || 'ajuda') + '">' + U.esc(t) + '</div>';
    };
    if (!email) return diz('Cadastre o e-mail antes e salve.', 'login-erro');
    const c = ERP.auth.cliente();
    if (!c) return diz('Sem conexão com o banco.', 'login-erro');
    diz('Enviando…');
    const { error } = await c.auth.resetPasswordForEmail(email);
    if (error) {
      return diz('Não foi possível enviar: ' + error.message +
        ' Enquanto o envio de e-mail não estiver configurado, redefina pelo painel do Supabase ' +
        '(Authentication › Users › a pessoa › Reset password).', 'login-erro');
    }
    diz('Link enviado para ' + email + '.');
  }

  function editarUsuario(id) {
    const u = id ? D.usuario(id) : null;
    ERP.app.modal({
      titulo: u ? 'Usuário · ' + u.nome : 'Novo usuário',
      corpo:
        '<label>Nome</label><input id="us-nome" value="' + U.esc(u ? u.nome : '') + '">' +
        '<div class="row2"><div><label>Perfil</label><select id="us-perfil">' +
          D.perfis.map(function (x) {
            return '<option value="' + x.id + '"' + (u && u.perfil === x.id ? ' selected' : '') + '>' +
              U.esc(x.nome) + '</option>'; }).join('') + '</select></div>' +
        '<div><label>E-mail</label><input id="us-email" value="' + U.esc(u ? (u.email || '') : '') + '"></div></div>' +
        (u ? '<label style="display:flex;gap:7px;align-items:center;margin-top:10px;font-weight:400">' +
             '<input type="checkbox" id="us-ativo" style="width:auto"' +
             (u.ativo !== false ? ' checked' : '') + '> ativo</label>' : '') +
        '<div class="ajuda" style="margin-top:8px">O perfil define o que a pessoa vê e faz. ' +
        'Os recortes ficam em "Perfis de acesso", onde dá para criar novos.</div>' +
        /* Senha: o sistema só manda o link de redefinição. Trocar a
           senha de outra pessoa direto exigiria a credencial de
           administração do banco no navegador — e quem abrisse o
           console teria acesso a tudo, inclusive folha e dados
           bancários. */
        (u && ERP.auth && ERP.auth.configurado() ?
          '<h4 style="margin:16px 0 6px">Senha</h4>' +
          '<div class="ajuda">O sistema envia um link de redefinição para o e-mail acima. ' +
          'A pessoa escolhe a senha nova — ninguém, nem você, chega a ver.</div>' +
          '<button class="btn-sm" id="us-reset" style="margin-top:6px">Enviar link de redefinição' +
          '</button><div id="us-reset-msg"></div>' +
          '<label style="display:flex;gap:7px;align-items:flex-start;margin-top:12px;font-weight:400">' +
          '<input type="checkbox" id="us-provisoria" style="width:auto;margin-top:3px"' +
          (u.senha_provisoria ? ' checked' : '') + '>' +
          '<span>Senha provisória — exigir troca no próximo acesso' +
          '<div class="sub">Marque depois de definir a senha da pessoa no painel do Supabase. ' +
          'Ela entra com a provisória, escolhe a dela, e a sua deixa de valer.</div>' +
          '</span></label>'
        : ''),
      aposAbrir: function () {
        const b = U.el('us-reset');
        if (b) b.addEventListener('click', function () { enviarReset(U.val('us-email').trim()); });
      },
      acoes: [{ txt: u ? 'Salvar' : 'Cadastrar', cls: 'btn-aprovar', fn: function () {
        const r = S.salvarUsuario({
          id: id, nome: U.val('us-nome'), perfil: U.val('us-perfil'), email: U.val('us-email'),
          ativo: U.el('us-ativo') ? U.el('us-ativo').checked : true,
          senha_provisoria: U.el('us-provisoria') ? U.el('us-provisoria').checked : false
        });
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        /* Usuário é cadastro: vai ao banco na hora, não pela
           sincronização do movimento. */
        if (ERP.persistencia && ERP.persistencia.ligado()) {
          const u2 = D.usuario(r.usuario ? r.usuario.id : id) || {};
          ERP.persistencia.salvarUsuario(u2).then(function (x) {
            if (x && x.erro) {
              return ERP.app.aviso('Salvo na tela, mas não no banco: ' + x.erro, 'erro');
            }
            /* Liga o login na hora, se já existir um com esse
               e-mail. Antes isto era um comando no SQL Editor a
               cada pessoa — o cadastro pela tela ficava pela
               metade. */
            if (!u2.email) return;
            ERP.persistencia.vincularLogin(u2.email).then(function (v) {
              if (v && v.ok) {
                ERP.app.aviso('Usuário salvo e login vinculado — já pode entrar.', 'ok');
              } else if (v && v.motivo === 'login_nao_existe') {
                ERP.app.aviso('Usuário salvo. Falta criar o login de ' + u2.email +
                  ' no painel do Supabase (Authentication › Users › Add user, com ' +
                  '"Auto Confirm User" marcado). Depois clique em "Verificar logins".', 'erro');
              } else if (v && v.erro) {
                ERP.app.aviso('Usuário salvo, mas o vínculo falhou: ' + v.erro, 'erro');
              }
              render();
            });
          });
        }
        ERP.app.fecharModal();
        ERP.app.aviso('Usuário salvo.', 'ok');
        ERP.app.montarSeletorUsuario && ERP.app.montarSeletorUsuario();
        render();
      } }]
    });
  }

  /* ── perfis de acesso ───────────────────────────────────
     Perfil é um recorte de permissões e de módulos visíveis. Dá para
     criar quantos precisar: quem só movimenta estoque, quem só compra,
     quem só consulta. Perfil de sistema pode ser editado, mas não
     excluído. */
  /* Perfis como MATRIZ: perfil na linha, módulo na coluna, e três
     caixas em cada cruzamento — ver, movimentar, financeiro. A versão
     anterior era uma lista de ações por extenso em duas colunas, que
     ficava ilegível assim que o perfil tinha mais de três permissões.

     Aqui a pergunta que o dono do sistema faz ("quem mexe em quê, e
     quem vê dinheiro") se responde olhando uma linha. */
  /* Abreviação para a coluna caber: todas as colunas têm a MESMA
     largura, então o nome do módulo é truncado quando precisa. Coluna
     do mesmo tamanho é o que deixa a tabela legível de relance — era
     a queixa principal da tela antiga, que tinha três sub-colunas por
     módulo e nenhuma alinhada com a outra. */
  const CURTO_MODULO = {
    financeiro: 'Financ.', produtividade: 'Produtiv.', estoque: 'Estoque',
    faturamento: 'Fatur.', compras: 'Compras', contratos: 'Contrat.',
    dp: 'Pessoal', ativos: 'Ativos', cadastros: 'Cadastr.',
    procedimentos: 'Procedim.', administracao: 'Admin.'
  };
  const abreviar = mo => CURTO_MODULO[mo.id] || (mo.nome.length > 9
    ? mo.nome.slice(0, 8) + '.' : mo.nome);

  function perfis() {
    const mods = D.MODULOS;
    const m = temRascunho() ? rascunhoMatriz() : S.matrizAcesso();
    const editavel = souAdmin();
    /* Largura igual para todas as colunas de módulo. */
    const larg = Math.max(62, Math.floor(760 / Math.max(1, mods.length)));

    return avisoPerfil() +
      '<div class="ap-acoes">' +
        '<button class="btn-linha" id="ad-novo-perfil"' + (editavel ? '' : ' disabled') +
          '>+ Novo perfil</button>' +
        (editavel ? '<button class="btn-sm" id="ad-matriz-padrao">Voltar à sugestão padrão</button>' +
          '<button class="btn-aprovar" id="ad-matriz-salvar">Salvar acessos</button>' : '') +
      '</div>' +
      '<div class="legenda-matriz ajuda">' +
        D.NIVEIS_ACESSO.map(function (n) {
          return '<b>' + n.curto + '</b> ' + n.nome.toLowerCase() + ' — ' + U.esc(n.ajuda);
        }).join(' · ') +
        (editavel ? '<br>Clique em qualquer célula para escolher os níveis daquele perfil no módulo.'
          : '') +
        '<br>Cadastros e Administração não têm o nível <b>$</b>: não há valor para ver ou mexer ' +
        'nesses módulos.' +
      '</div>' +
      '<div class="tabela-rolagem" style="margin:0 -14px">' +
      '<table class="matriz-acesso"><thead>' +
      '<tr><th style="width:190px">Perfil</th>' +
        mods.map(function (mo) {
          /* O título completo fica no `title`: a coluna mostra a
             abreviação para todas terem o mesmo tamanho. */
          return '<th class="mat-mod" style="width:' + larg + 'px;min-width:' + larg +
            'px;max-width:' + larg + 'px" title="' + U.esc(mo.nome) + '">' +
            U.esc(abreviar(mo)) + '</th>';
        }).join('') +
        '<th class="num" style="width:62px">Usuários</th>' +
        '<th style="width:70px"></th></tr>' +
      '</thead><tbody>' +
      D.perfis.map(function (p) {
        const quantos = D.usuarios.filter(function (u2) { return u2.perfil === p.id; }).length;
        const linha = m[p.id] || {};
        return '<tr><td class="desc">' + U.esc(p.nome) +
            (p.sistema ? ' <span class="badge b-aberto">sistema</span>' : '') +
            '<div class="sub">' + U.esc(p.id) + '</div></td>' +
          mods.map(function (mo) {
            const c = String(linha[mo.id] || '').replace('$', 'F');
            /* Mostra as LETRAS do que o perfil tem, não caixas de
               marcar: a tabela vira leitura, e a edição acontece no
               clique. Sem acesso nenhum, traço. */
            const permitidos = D.niveisDoModulo(mo.id);
            const letras = D.NIVEIS_ACESSO
              .filter(function (n) { return permitidos.indexOf(n.id) >= 0; })
              .filter(function (n) { return c.indexOf(n.curto === '$' ? 'F' : n.curto) >= 0; })
              .map(function (n) {
                return '<span class="niv niv-' + n.id + '" title="' + U.esc(n.nome) + '">' +
                  n.curto + '</span>';
              }).join('');
            return '<td class="mat-c' + (editavel ? ' mat-edit' : '') + '"' +
              ' style="width:' + larg + 'px;min-width:' + larg + 'px;max-width:' + larg + 'px"' +
              (editavel ? ' data-cel="' + p.id + '|' + mo.id + '" tabindex="0"' +
                ' title="Clique para alterar"' : '') + '>' +
              (letras || '<span class="sub">—</span>') + '</td>';
          }).join('') +
          '<td class="num">' + quantos + '</td>' +
          '<td class="acoes">' + (editavel
            ? '<button class="btn-sm" data-perfil="' + p.id + '">Ações</button>' +
              (p.sistema ? '' : '<button class="btn-sm btn-cancelar" data-perfil-x="' + p.id +
                '">Excluir</button>')
            : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="ajuda">Sem <b>V</b>, o módulo nem aparece na tela inicial do perfil. Com <b>V</b> ' +
        'e sem <b>M</b>, a pessoa consulta mas não lança. Sem <b>$</b>, some da tela dela custo, ' +
        'preço, faturamento e resultado daquele módulo. O <b>A</b> é a segunda mão — quem lança ' +
        'não deveria aprovar. "Ações" abre as permissões finas que não vêm do módulo ' +
        '(estornar, cancelar, ver dados pessoais).</div>';
  }

  /* Seletor de níveis de uma célula: abre no clique, com o que cada
     nível significa NAQUELE módulo escrito por extenso. A matriz
     antiga pedia que o operador soubesse de cabeça o que "A" quer
     dizer em Compras. */
  function abrirCelulaMatriz(perfilId, moduloId) {
    const perfil = D.perfis.find(function (x) { return x.id === perfilId; }) || {};
    const mod = D.MODULOS.find(function (x) { return x.id === moduloId; }) || {};
    const atual = String((rascunhoMatriz()[perfilId] || {})[moduloId] || '').replace('$', 'F');
    const marcado = l => atual.indexOf(l) >= 0 ? ' checked' : '';
    const oQueFaz = function (n) {
      if (n.id === 'aprovar') return D.APROVACAO_POR_MODULO[moduloId] || n.ajuda;
      return n.ajuda;
    };
    ERP.app.modal({
      titulo: perfil.nome + ' · ' + mod.nome,
      fecharTxt: 'Cancelar',
      corpo: '<div class="ajuda">O que este perfil pode fazer no módulo ' +
          U.esc(mod.nome) + ':</div>' +
        D.NIVEIS_ACESSO.filter(function (n) {
          /* Cadastros e Administração não têm dinheiro: oferecer o
             nível $ ali seria marcar algo que não muda nada. */
          return D.niveisDoModulo(moduloId).indexOf(n.id) >= 0;
        }).map(function (n) {
          const l = n.curto === '$' ? 'F' : n.curto;
          return '<label class="linha-check" style="display:flex;gap:8px;align-items:flex-start;' +
            'margin:8px 0"><input type="checkbox" id="cel-' + n.id + '" style="width:auto;' +
            'margin-top:3px"' + marcado(l) + '>' +
            '<span><b>' + n.nome + '</b> <span class="sub">(' + n.curto + ')</span>' +
            '<div class="sub">' + U.esc(oQueFaz(n)) + '</div></span></label>';
        }).join('') +
        '<div class="ajuda">Tirar a <b>Visualização</b> tira o módulo inteiro da tela deste ' +
        'perfil, com os outros níveis junto.</div>',
      acoes: [{ txt: 'Aplicar', cls: 'btn-aprovar', fn: function () {
        let novo = '';
        D.NIVEIS_ACESSO.forEach(function (n) {
          if (D.niveisDoModulo(moduloId).indexOf(n.id) < 0) return;
          const e = U.el('cel-' + n.id);
          if (e && e.checked) novo += (n.curto === '$' ? 'F' : n.curto);
        });
        /* Sem ver, não há o que movimentar nem aprovar: a combinação
           "M sem V" existiria no papel e em nenhum lugar na prática. */
        if (novo && novo.indexOf('V') < 0) novo = '';
        rascunhoMatriz()[perfilId] = rascunhoMatriz()[perfilId] || {};
        rascunhoMatriz()[perfilId][moduloId] = novo;
        ERP.app.fecharModal();
        render();
        ERP.app.aviso('Acesso ajustado. Clique em "Salvar acessos" para valer.', 'ok');
      } }]
    });
  }


  /* A edição agora vive em memória, não no DOM: a tabela deixou de
     ter caixas de marcar, e ler o estado da tela não é mais
     possível. O rascunho acumula as alterações até "Salvar acessos",
     para o admin poder mexer em várias células e conferir antes. */
  let _rascunho = null;
  function rascunhoMatriz() {
    if (!_rascunho) _rascunho = JSON.parse(JSON.stringify(S.matrizAcesso()));
    return _rascunho;
  }
  function descartarRascunho() { _rascunho = null; }
  const temRascunho = () => !!_rascunho;

  function lerMatriz() {
    const m = JSON.parse(JSON.stringify(rascunhoMatriz()));
    /* Movimentar, ver dinheiro ou aprovar sem enxergar o módulo não
       existe: o V entra junto em vez de virar acesso fantasma. */
    Object.keys(m).forEach(function (p) {
      Object.keys(m[p]).forEach(function (mo) {
        if (m[p][mo] && m[p][mo].indexOf('V') < 0) m[p][mo] = 'V' + m[p][mo];
      });
    });
    return m;
  }

  function editarPerfil(id) {
    const p = id ? D.perfil(id) : null;
    const grupos = {};
    D.ACOES.forEach(function (a2) { (grupos[a2.grupo] = grupos[a2.grupo] || []).push(a2); });
    ERP.app.modal({
      titulo: p ? 'Perfil · ' + p.nome : 'Novo perfil de acesso',
      corpo:
        '<label>Nome do perfil</label><input id="pf-nome" value="' + U.esc(p ? p.nome : '') + '" ' +
          'placeholder="Ex.: Controle de estoque"' + (p && p.sistema ? '' : '') + '>' +
        '<h2 style="font-size:12px;margin:14px 0 6px">Módulos que este perfil vê</h2>' +
        '<div class="row3">' + D.MODULOS.map(function (m) {
          /* `p.modulos` não existe nos perfis vindos do banco, e
             `p.modulos.indexOf` quebrava a tela inteira. A matriz é
             a fonte. */
          const tem = p ? S.acessoDoPerfil(p.id, m.id).ver : false;
          return '<label style="display:flex;gap:6px;align-items:center;font-weight:400">' +
            '<input type="checkbox" data-pf-mod="' + m.id + '" style="width:auto"' +
            (tem ? ' checked' : '') + '> ' + U.esc(m.nome) + '</label>';
        }).join('') + '</div>' +
        Object.keys(grupos).map(function (g) {
          return '<h2 style="font-size:12px;margin:14px 0 6px">' + U.esc(g) + '</h2>' +
            '<div class="row2">' + grupos[g].map(function (a2) {
              const tem = p ? p.acoes.indexOf(a2.id) > -1 : false;
              return '<label style="display:flex;gap:6px;align-items:center;font-weight:400">' +
                '<input type="checkbox" data-pf-ac="' + a2.id + '" style="width:auto"' +
                (tem ? ' checked' : '') + '> ' + U.esc(a2.nome) + '</label>';
            }).join('') + '</div>';
        }).join('') +
        '<div class="ajuda" style="margin-top:10px">Quem movimenta estoque sem "ver valores e custos" ' +
        'lança entrada e saída sem enxergar dinheiro nenhum. Aprovar requisição de compra é separado de ' +
        'aprovar pagamento: dá para ter quem libera material sem liberar caixa.</div>',
      acoes: [{ txt: p ? 'Salvar perfil' : 'Criar perfil', cls: 'btn-aprovar', fn: function () {
        const acoes = [], modulos = [];
        document.querySelectorAll('[data-pf-ac]').forEach(function (e) {
          if (e.checked) acoes.push(e.dataset.pfAc); });
        document.querySelectorAll('[data-pf-mod]').forEach(function (e) {
          if (e.checked) modulos.push(e.dataset.pfMod); });
        const r = S.salvarPerfil({ id: id, nome: U.val('pf-nome'), acoes: acoes, modulos: modulos });
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        ERP.app.aviso('Perfil salvo. Quem usa este perfil já sente a mudança.', 'ok');
        ERP.app.renderHome && ERP.app.renderHome();
        render();
      } }]
    });
  }

  /* ── alçadas e políticas ────────────────────────────────*/
  function politicas() {
    const p = S.parametros();
    const trava = p.travar_competencia_ate;
    return avisoPerfil() +
      '<h2 style="font-size:12px;margin:0 0 8px">Alçada de aprovação</h2>' +
      '<div class="row3">' +
        '<div><label>Diretoria (R$)</label><input id="po-dir" class="num" inputmode="decimal" value="' +
          U.num(p.alcada.diretoria) + '"' + (souAdmin() ? '' : ' disabled') + '></div>' +
        '<div><label>Sócio (R$)</label><input id="po-soc" class="num" inputmode="decimal" value="' +
          U.num(p.alcada.socio) + '"' + (souAdmin() ? '' : ' disabled') + '></div>' +
        '<div><label>Administração (R$)</label><input id="po-adm" class="num" inputmode="decimal" value="' +
          U.num(p.alcada.admin) + '"' + (souAdmin() ? '' : ' disabled') + '></div>' +
      '</div>' +
      '<div class="row2" style="margin-top:8px">' +
        '<div><label>Comprador (R$)</label><input id="po-compr" class="num" inputmode="decimal" value="' +
          U.num(p.alcada.comprador || 0) + '"' + (souAdmin() ? '' : ' disabled') + '></div>' +
        '<div><label>Assistente (R$)</label><input id="po-assist" class="num" inputmode="decimal" value="' +
          U.num(p.alcada.assistente || 0) + '"' + (souAdmin() ? '' : ' disabled') + '></div>' +
      '</div>' +
      '<div class="ajuda">Zero significa sem limite. Pagamento ou pedido de compra acima da alçada do ' +
      'aprovador é recusado com a mensagem de subir para quem tem alçada maior — foi o que a auditoria ' +
      'apontou: comprador e assistente não tinham nenhum teto cadastrado, e por isso não tinham teto ' +
      'nenhum na prática.</div>' +

      '<h2 style="font-size:12px;margin:16px 0 8px">Políticas</h2>' +
      '<label style="display:flex;gap:8px;align-items:flex-start;font-weight:400;margin-bottom:10px">' +
        '<input type="checkbox" id="po-auto" style="width:auto;margin-top:3px"' +
        (p.impedir_autoaprovacao ? ' checked' : '') + (souAdmin() ? '' : ' disabled') + '>' +
        '<span><b>Quem solicita não aprova.</b><br><span class="sub">Impede a mesma pessoa de pedir e ' +
        'liberar o pagamento — inclusive a própria retirada de sócio.</span></span></label>' +
      '<label style="display:flex;gap:8px;align-items:flex-start;font-weight:400;margin-bottom:10px">' +
        '<input type="checkbox" id="po-auto-compras" style="width:auto;margin-top:3px"' +
        (p.impedir_autoaprovacao_compras ? ' checked' : '') + (souAdmin() ? '' : ' disabled') + '>' +
        '<span><b>Em compras, quem pede não aprova (e quem cota não aprova a compra).</b><br>' +
        '<span class="sub">Vem desligada: em equipe pequena a mesma pessoa costuma fazer mais de uma etapa. ' +
        'Ligue quando quiser exigir a separação.</span></span></label>' +
      '<label style="display:flex;gap:8px;align-items:flex-start;font-weight:400;margin-bottom:10px">' +
        '<input type="checkbox" id="po-anexo" style="width:auto;margin-top:3px"' +
        (p.exigir_anexo ? ' checked' : '') + (souAdmin() ? '' : ' disabled') + '>' +
        '<span><b>Exigir nota anexada antes de pagar.</b><br><span class="sub">' +
        S.semAnexo().length + ' parcela(s) estão sem anexo hoje — ligar a regra trava o pagamento ' +
        'delas até o documento entrar.</span></span></label>' +

      '<h2 style="font-size:12px;margin:16px 0 8px">Fechamento de competência</h2>' +
      '<div class="row2"><div><label>Fechada até</label><input type="month" id="po-trava" value="' +
        (trava || '') + '"' + (souAdmin() ? '' : ' disabled') + '></div><div></div></div>' +
      '<div class="ajuda">Competência fechada não recebe lançamento novo. Deixe em branco para manter ' +
      'tudo aberto — foi a decisão que ficou em aberto quando o sócio manda conta de meses anteriores.</div>' +

      '<h2 style="font-size:12px;margin:16px 0 8px">Faixa do sequencial de remessa</h2>' +
      '<div class="row2">' +
        '<div><label>De</label><input id="po-nsai" class="num" value="' + p.nsa_ini + '"' +
          (souAdmin() ? '' : ' disabled') + '></div>' +
        '<div><label>Até</label><input id="po-nsaf" class="num" value="' + p.nsa_fim + '"' +
          (souAdmin() ? '' : ' disabled') + '></div>' +
      '</div>' +
      '<div class="ajuda">Enquanto o Protheus e o ERP mandarem arquivo para o mesmo convênio, cada um ' +
      'precisa da sua faixa de numeração, senão o banco rejeita por número repetido. Próximo número ' +
      'que o ERP vai usar: <b>' + S.proximoSequencialRemessa() + '</b>.</div>' +

      (souAdmin()
        ? '<div class="form-acoes" style="margin:14px -14px -14px">' +
          '<button class="btn-primary" id="po-salvar" style="width:auto;margin:0">Salvar parâmetros</button></div>'
        : '');
  }

  /* ── contas bancárias ───────────────────────────────────*/
  function bancos() {
    return '<table><thead><tr><th>Conta</th><th>Banco</th><th>Agência / conta</th>' +
      '<th>Convênio</th><th class="num">Saldo inicial</th><th>Layout</th><th>Situação</th>' +
      '</tr></thead><tbody>' +
      D.bancos.map(function (b) {
        return '<tr><td class="desc">' + U.esc(b.apelido) + '</td>' +
          '<td class="mono">' + U.esc(b.banco || '—') + '</td>' +
          '<td class="mono">' + U.esc((b.agencia || '—') + (b.conta ? ' / ' + b.conta : '')) + '</td>' +
          '<td class="mono">' + U.esc(b.convenio || '—') + '</td>' +
          '<td class="num">' + U.brl(b.saldo_inicial || 0) +
            (b.saldo_inicial_em ? '<div class="sub">em ' + U.fData(b.saldo_inicial_em) + '</div>' : '') + '</td>' +
          '<td class="sub">' + U.esc(b.layout_remessa || 'não configurado') + '</td>' +
          '<td>' + (b.ativo ? '<span class="badge b-aprovado">ativa</span>'
                            : '<span class="badge b-cancelado">inativa</span>') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="ajuda">O saldo inicial é o ponto de partida do fluxo de caixa. O convênio e a versão ' +
      'de layout são o que o banco confere no arquivo de remessa — hoje só o Bradesco está configurado; ' +
      'o Santander precisa do layout dele para gerar remessa.</div>';
  }

  /* ── trilha de auditoria ────────────────────────────────*/
  function filtrosAuditoria() {
    return {
      usuario: U.val('ad-f-user'), entidade: U.val('ad-f-ent'),
      de: U.val('ad-f-de'), ate: U.val('ad-f-ate'), busca: U.val('ad-f-busca')
    };
  }

  function auditoria() {
    const f = filtrosAuditoria();
    const todos = S.eventos();
    const lista = S.eventos(f).slice(0, 300);
    const entidades = Array.from(new Set(todos.map(function (e) { return e.entidade; }))).sort();
    const porUsuario = {};
    todos.forEach(function (e) { porUsuario[e.usuario] = (porUsuario[e.usuario] || 0) + 1; });

    return '<div class="filtros" style="margin:0 0 10px">' +
        '<div class="f"><label for="ad-f-busca">Buscar</label><input id="ad-f-busca" value="' +
          U.esc(f.busca || '') + '" placeholder="ação, detalhe"></div>' +
        '<div class="f"><label for="ad-f-user">Usuário</label><select id="ad-f-user">' +
          '<option value="">Todos</option>' +
          Object.keys(porUsuario).sort().map(function (u) {
            return '<option value="' + U.esc(u) + '"' + (f.usuario === u ? ' selected' : '') + '>' +
              U.esc(u) + ' (' + porUsuario[u] + ')</option>'; }).join('') + '</select></div>' +
        '<div class="f"><label for="ad-f-ent">Tipo</label><select id="ad-f-ent">' +
          '<option value="">Todos</option>' +
          entidades.map(function (e) {
            return '<option value="' + e + '"' + (f.entidade === e ? ' selected' : '') + '>' +
              U.esc(e) + '</option>'; }).join('') + '</select></div>' +
        '<div class="f"><label for="ad-f-de">De</label><input type="date" id="ad-f-de" value="' +
          U.esc(f.de || '') + '"></div>' +
        '<div class="f"><label for="ad-f-ate">Até</label><input type="date" id="ad-f-ate" value="' +
          U.esc(f.ate || '') + '"></div>' +
        '<button class="btn-sm" id="ad-limpar">Limpar</button>' +
        '<button class="btn-sm" id="ad-exportar">Exportar</button>' +
      '</div>' +
      '<div class="pr-confere"><span>Eventos <b>' + todos.length + '</b></span>' +
        '<span>Neste filtro <b>' + S.eventos(f).length + '</b></span>' +
        '<span>Usuários <b>' + Object.keys(porUsuario).length + '</b></span></div>' +
      '<div class="tabela-rolagem" style="margin:10px -14px 0"><table><thead><tr>' +
      '<th>Quando</th><th>Quem</th><th>Tipo</th><th>Ação</th><th>Detalhe</th>' +
      '</tr></thead><tbody>' +
      (lista.length ? lista.map(function (e) {
        return '<tr><td class="mono">' + U.fDataHora(e.em) + '</td>' +
          '<td>' + U.esc(e.usuario) + '</td>' +
          '<td class="sub">' + U.esc(e.entidade) + '</td>' +
          '<td>' + U.esc(e.acao) + '</td>' +
          '<td class="desc sub">' + U.esc(e.detalhe || '') + '</td></tr>';
      }).join('')
        : '<tr><td colspan="5" class="vazio"><strong>Nada com esses filtros.</strong></td></tr>') +
      '</tbody></table></div>' +
      '<div class="ajuda">Cada lançamento, aprovação, pagamento, baixa de estoque e alteração de ' +
      'parâmetro deixa registro de quem fez, quando e o quê. No banco de dados esta tabela recebe ' +
      'inserção e nada mais — sem edição e sem exclusão, nem pelo administrador.</div>';
  }

  function ligarImpostos() {
    const salvar = U.el('imp-salvar');
    if (salvar) salvar.addEventListener('click', function () {
      const r = S.salvarImpostosProcedimentos(lerImpostos(), D.PATE_CENTRO);
      if (r.erro) return ERP.app.aviso(r.erro, 'erro');
      render();
      ERP.app.aviso('Imposto estimado atualizado para ' + U.num(r.total) + '%.', 'ok');
    });
    const novo = U.el('imp-novo');
    if (novo) novo.addEventListener('click', function () {
      const lista = lerImpostos();
      lista.push({ id: 'outros', nome: 'Outros', aliquota: 0, obs: '', ativo: true });
      S.salvarImpostosProcedimentos(lista, D.PATE_CENTRO);
      render();
    });
    const padrao = U.el('imp-padrao');
    if (padrao) padrao.addEventListener('click', function () {
      const r = S.salvarImpostosProcedimentos([
        { id: 'iss', nome: 'ISS', aliquota: 2 },
        { id: 'pis_cofins', nome: 'PIS/COFINS', aliquota: 3.65 },
        { id: 'irpj', nome: 'IRPJ', aliquota: 2.2 },
        { id: 'csll', nome: 'CSLL', aliquota: 1.19 }
      ], D.PATE_CENTRO);
      if (r.erro) return ERP.app.aviso(r.erro, 'erro');
      render();
      ERP.app.aviso('Voltou ao padrão: ' + U.num(r.total) + '%.', 'ok');
    });
  }

  function ligarMatriz() {
    document.querySelectorAll('[data-cel]').forEach(function (td) {
      const abre = function () {
        const par = td.dataset.cel.split('|');
        abrirCelulaMatriz(par[0], par[1]);
      };
      td.addEventListener('click', abre);
      /* Teclado: a célula é focável, então Enter e espaço abrem. */
      td.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abre(); }
      });
    });

    const salvar = U.el('ad-matriz-salvar');
    if (salvar) salvar.addEventListener('click', function () {
      const r = S.salvarMatrizAcesso(lerMatriz());
      if (r.erro) return ERP.app.aviso(r.erro, 'erro');
      descartarRascunho();
      render();
      ERP.app.aviso('Acessos atualizados.', 'ok');
    });
    const padrao = U.el('ad-matriz-padrao');
    if (padrao) padrao.addEventListener('click', function () {
      const r = S.salvarMatrizAcesso(JSON.parse(JSON.stringify(D.MATRIZ_PADRAO)));
      if (r.erro) return ERP.app.aviso(r.erro, 'erro');
      descartarRascunho();
      render();
      ERP.app.aviso('Voltou à distribuição sugerida.', 'ok');
    });
  }

  function ligar() {
    /* Estava dentro de `ligarMatriz`, que só roda na aba de perfis —
       então a coluna de login nunca carregava na aba de usuários,
       que é onde ela aparece. */
    if (U.el('ad-ver-logins')) {
      U.el('ad-ver-logins').addEventListener('click', function () {
        ERP.persistencia.vincularPendentes().then(function (r) {
          if (r.erro) return ERP.app.aviso('Não consegui verificar: ' + r.erro, 'erro');
          ERP.app.aviso(r.n ? r.n + ' login(s) vinculado(s).'
            : 'Nenhum login novo para vincular.', 'ok');
          carregarStatusLogin();
        });
      });
    }
    if (aba === 'usuarios' && statusLogin === null &&
        ERP.persistencia && ERP.persistencia.ligado()) {
      carregarStatusLogin();
    }

    if (aba === 'perfis') ligarMatriz();
    if (aba === 'impostos') ligarImpostos();
    if (U.el('fiscal-salvar')) {
      U.el('fiscal-salvar').addEventListener('click', function () {
        D.empresa.rps = D.empresa.rps || {};
        document.querySelectorAll('[data-fiscal]').forEach(function (i) {
          const alvo = i.dataset.onde === 'rps' ? D.empresa.rps : D.empresa;
          alvo[i.dataset.fiscal] = i.value.trim();
        });
        D.empresa.simples_nacional = parseInt(U.val('fiscal-simples'), 10) || 1;
        S.logarCadastro('empresa', 'fiscal', 'alterou parâmetros fiscais da NF-e',
          'código de serviço ' + (D.empresa.rps.codigo_servico || '—'));
        ERP.app.aviso('Parâmetros fiscais salvos.', 'ok');
        render();
      });
    }
    const box = U.el('ad-saida');
    box.querySelectorAll('[data-perfil]').forEach(function (b) {
      b.addEventListener('click', function () { editarPerfil(this.dataset.perfil); });
    });
    box.querySelectorAll('[data-perfil-x]').forEach(function (b) {
      b.addEventListener('click', function () {
        const r = S.excluirPerfil(this.dataset.perfilX);
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.aviso('Perfil excluído.', 'ok');
        render();
      });
    });
    if (U.el('ad-novo-perfil')) U.el('ad-novo-perfil').addEventListener('click', function () { editarPerfil(null); });
    box.querySelectorAll('[data-user]').forEach(function (b) {
      b.addEventListener('click', function () { editarUsuario(this.dataset.user); });
    });
    if (U.el('ad-novo-user')) U.el('ad-novo-user').addEventListener('click', function () { editarUsuario(null); });
    if (U.el('po-salvar')) {
      U.el('po-salvar').addEventListener('click', function () {
        const r = S.salvarParametros({
          alcada: { diretoria: U.parseValor(U.val('po-dir')), socio: U.parseValor(U.val('po-soc')),
                    admin: U.parseValor(U.val('po-adm')), comprador: U.parseValor(U.val('po-compr')),
                    assistente: U.parseValor(U.val('po-assist')) },
          impedir_autoaprovacao: U.el('po-auto').checked,
          impedir_autoaprovacao_compras: U.el('po-auto-compras').checked,
          exigir_anexo: U.el('po-anexo').checked,
          travar_competencia_ate: U.val('po-trava'),
          nsa_ini: U.val('po-nsai'), nsa_fim: U.val('po-nsaf')
        });
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.aviso('Parâmetros salvos e já valendo.', 'ok');
        render();
      });
    }
    ['ad-f-busca', 'ad-f-user', 'ad-f-ent', 'ad-f-de', 'ad-f-ate'].forEach(function (id) {
      if (U.el(id)) U.el(id).addEventListener('input', render);
    });
    if (U.el('ad-limpar')) {
      U.el('ad-limpar').addEventListener('click', function () {
        ['ad-f-busca', 'ad-f-user', 'ad-f-ent', 'ad-f-de', 'ad-f-ate'].forEach(function (id) { U.setVal(id, ''); });
        render();
      });
      U.el('ad-exportar').addEventListener('click', function () {
        /* Exporta a partir dos DADOS e nos três formatos: a tela mostra
           só os 300 primeiros e a cópia da tabela trazia a coluna de
           ações junto. */
        const lista = S.eventos(filtrosAuditoria());
        if (!lista.length) return ERP.app.aviso('Nada para exportar com esses filtros.', 'erro');
        ERP.exportar.abrir({
          nome: 'trilha-auditoria', titulo: 'Trilha de auditoria',
          colunas: [
            { titulo: 'Data e hora', largura: 20, valor: e => U.fData(U.dataLocal(e.em)) + ' ' +
                new Date(e.em).toLocaleTimeString('pt-BR') },
            { titulo: 'Usuário', largura: 24, valor: e => e.usuario || '' },
            { titulo: 'Entidade', largura: 16, valor: e => e.entidade || '' },
            { titulo: 'Registro', largura: 14, valor: e => e.entidade_id || '' },
            { titulo: 'Ação', largura: 28, valor: e => e.acao || '' },
            { titulo: 'Detalhe', largura: 60, valor: e => e.detalhe || '' }
          ],
          linhas: lista
        });
      });
    }
  }

  return { montar: montar, render: render };
})();
