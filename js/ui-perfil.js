/* Meus dados.

   Abre pelo nome da pessoa, no canto superior. Mostra o que o
   sistema sabe sobre ela e o que o perfil dela permite — útil
   quando alguém pergunta "por que não consigo aprovar isso?".

   A troca da PRÓPRIA senha acontece aqui. A de outra pessoa, não:
   trocar a senha alheia exige uma credencial de administração do
   banco que, se viesse para o navegador, daria a quem abrisse o
   console acesso total aos dados — inclusive folha e dados
   bancários. Essa credencial fica fora do sistema, de propósito. */
window.ERP = window.ERP || {};
ERP.perfilUsuario = (function () {
  /* Mesmo atalho que os outros módulos de tela usam. Eu tinha
     esquecido estas três linhas, e o resultado foi um botão que
     não abria nada. */
  const U = ERP.util, D = ERP.dados, S = ERP.store;

  function niveisDoPerfil(perfilId) {
    return D.MODULOS.map(function (m) {
      const a = S.acessoDoPerfil(perfilId, m.id);
      const letras = [a.ver && 'V', a.mover && 'M', a.financeiro && '$', a.aprovar && 'A']
        .filter(Boolean).join(' ');
      return letras ? { nome: m.nome, letras: letras } : null;
    }).filter(Boolean);
  }

  function abrir() {
    const u = S.usuario();
    if (!u) return;
    const p = D.perfil(u.perfil) || {};
    const email = (ERP.auth && ERP.auth.sessaoAtual && ERP.auth.sessaoAtual()) ?
      ERP.auth.sessaoAtual().email : (u.email || '—');
    const comBanco = !!(ERP.auth && ERP.auth.configurado());
    const mods = niveisDoPerfil(u.perfil);

    ERP.app.modal({
      titulo: 'Meus dados',
      fecharTxt: 'Fechar',
      corpo:
        '<div class="row2">' +
          '<div><label>Nome</label><div class="leitura">' + U.esc(u.nome) + '</div></div>' +
          '<div><label>Perfil</label><div class="leitura">' + U.esc(p.nome || u.perfil) +
          '</div></div>' +
        '</div>' +
        '<label>E-mail de acesso</label><div class="leitura">' + U.esc(email) + '</div>' +
        '<div class="ajuda">Nome, perfil e e-mail são alterados pela Administração.</div>' +

        '<h4 style="margin:18px 0 6px">O que o seu perfil permite</h4>' +
        '<table class="compacta"><thead><tr><th>Módulo</th><th>Níveis</th></tr></thead><tbody>' +
        mods.map(function (m) {
          return '<tr><td>' + U.esc(m.nome) + '</td><td>' + m.letras + '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<div class="ajuda"><b>V</b> vê · <b>M</b> movimenta · <b>$</b> vê valor · ' +
        '<b>A</b> aprova. Falta alguma coisa? Fale com a Administração.</div>' +

        (comBanco ?
          '<h4 style="margin:18px 0 6px">Trocar a minha senha</h4>' +
          '<label for="pf-nova">Nova senha</label>' +
          '<input type="password" id="pf-nova" autocomplete="new-password">' +
          '<label for="pf-nova2">Repita a nova senha</label>' +
          '<input type="password" id="pf-nova2" autocomplete="new-password">' +
          '<div class="ajuda">Pelo menos 8 caracteres. Você continua conectado depois de trocar.</div>' +
          '<div id="pf-msg"></div>'
        : '<div class="ajuda">Sem banco configurado, não há senha a trocar.</div>'),
      acoes: comBanco ? [{ txt: 'Trocar senha', cls: 'btn-aprovar', fn: trocarSenha }] : []
    });
  }

  async function trocarSenha() {
    const nova = U.val('pf-nova');
    const nova2 = U.val('pf-nova2');
    const msg = U.el('pf-msg');
    const aviso = function (t, cls) {
      if (msg) msg.innerHTML = '<div class="' + (cls || 'ajuda') + '">' + U.esc(t) + '</div>';
    };
    if (!nova || nova.length < 8) return aviso('A senha precisa ter pelo menos 8 caracteres.', 'login-erro');
    if (nova !== nova2) return aviso('As duas senhas não são iguais.', 'login-erro');

    const c = ERP.auth.cliente();
    if (!c) return aviso('Sem conexão com o banco.', 'login-erro');
    const { error } = await c.auth.updateUser({ password: nova });
    if (error) return aviso('Não foi possível trocar: ' + error.message, 'login-erro');
    ERP.app.fecharModal();
    ERP.app.aviso('Senha alterada.', 'ok');
  }

  return { abrir: abrir };
})();
