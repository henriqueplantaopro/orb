// ERP Dom Pedro — criar login a partir do próprio sistema
//
// POR QUE ISTO VIVE NO SERVIDOR: criar credencial exige a chave de
// administração do banco (`service_role`), que ignora toda a
// segurança. No navegador, qualquer um que abrisse o console teria
// acesso a folha, contas bancárias e dados de paciente. Aqui ela
// fica no servidor do Supabase e nunca sai dele — o ERP só pede.
//
// A função confere três coisas antes de criar:
//   1. quem pede está autenticado;
//   2. quem pede tem movimentação em Administração (a matriz manda,
//      como no resto do sistema);
//   3. o e-mail já existe como usuário do ERP — não se cria
//      credencial solta, só para quem já foi cadastrado na tela.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status, headers: { ...cors, 'Content-Type': 'application/json' }
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const servico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const autorizacao = req.headers.get('Authorization') || '';
    if (!autorizacao) return responder({ erro: 'sem credencial' }, 401);

    // Quem está pedindo, na identidade de quem pediu.
    const comoUsuario = createClient(url, anon, {
      global: { headers: { Authorization: autorizacao } }
    });
    const { data: { user }, error: erroUser } = await comoUsuario.auth.getUser();
    if (erroUser || !user) return responder({ erro: 'sessão inválida' }, 401);

    // A permissão vem da MESMA matriz que governa a tela.
    const { data: quem } = await comoUsuario
      .from('usuarios').select('id, perfil').eq('auth_id', user.id).maybeSingle();
    if (!quem) return responder({ erro: 'usuário não encontrado no sistema' }, 403);

    const { data: nivel } = await comoUsuario
      .from('matriz_acesso').select('niveis')
      .eq('perfil', quem.perfil).eq('modulo', 'administracao').maybeSingle();
    if (!nivel || !String(nivel.niveis || '').includes('M')) {
      return responder({ erro: 'seu perfil não cria login' }, 403);
    }

    const corpo = await req.json().catch(() => ({}));
    const email = String(corpo.email || '').trim().toLowerCase();
    const senha = String(corpo.senha || '');
    if (!email || senha.length < 8) {
      return responder({ erro: 'informe e-mail e senha de pelo menos 8 caracteres' }, 400);
    }

    // Só para quem já é usuário do ERP: credencial solta não serve
    // a ninguém e vira porta sem dono.
    const { data: alvo } = await comoUsuario
      .from('usuarios').select('id, nome').ilike('email', email).maybeSingle();
    if (!alvo) {
      return responder({ erro: 'cadastre a pessoa na tela de usuários antes, com este e-mail' }, 400);
    }

    const admin = createClient(url, servico, { auth: { persistSession: false } });

    // Já existe credencial com este e-mail? Então é só vincular.
    const { data: lista } = await admin.auth.admin.listUsers();
    const existente = (lista?.users || []).find(
      (u: { email?: string }) => (u.email || '').toLowerCase() === email);

    let authId = existente?.id;
    if (existente) {
      // Redefine a senha: é o caminho de "esqueci a senha".
      await admin.auth.admin.updateUserById(existente.id, { password: senha });
    } else {
      const { data: novo, error } = await admin.auth.admin.createUser({
        email, password: senha, email_confirm: true
      });
      if (error) return responder({ erro: error.message }, 400);
      authId = novo.user.id;
    }

    // Vincula e marca a senha como provisória: quem entrar é
    // obrigado a trocar, e nem o administrador passa a saber a
    // senha definitiva.
    await admin.from('usuarios')
      .update({ auth_id: authId, senha_provisoria: true })
      .eq('id', alvo.id);

    return responder({ ok: true, usuario: alvo.id, nome: alvo.nome,
      criado: !existente, redefinido: !!existente });
  } catch (e) {
    return responder({ erro: String((e as Error).message || e) }, 500);
  }
});
