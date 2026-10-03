-- ERP Dom Pedro — vínculo automático do login
-- Etapa 18.
--
-- O cadastro de usuário pela tela gravava a pessoa e o perfil, mas
-- o `auth_id` — que liga o login ao usuário do sistema — só era
-- preenchido por SQL. Na prática, cadastrar alguém exigia abrir o
-- SQL Editor, e o módulo de Administração virava meia ferramenta.
--
-- Estas funções tiram o SQL do caminho. O que continua no painel do
-- Supabase é a CRIAÇÃO da credencial em si, e isso é de propósito:
-- criar login pelo navegador exigiria a chave de administração do
-- banco no código do cliente, e quem abrisse o console teria acesso
-- total.

/* Liga o usuário do sistema ao login de mesmo e-mail, se existir.
   Devolve o que aconteceu, para a tela poder dizer à pessoa. */
create or replace function vincular_login(p_email text)
returns jsonb language plpgsql security definer as $$
declare
  v_auth uuid;
  v_user text;
begin
  if app_usuario() is null then
    raise exception 'sem usuário autenticado';
  end if;
  if not tem_nivel('administracao', 'M') then
    raise exception 'só a Administração vincula login';
  end if;
  if p_email is null or btrim(p_email) = '' then
    return jsonb_build_object('ok', false, 'motivo', 'sem e-mail');
  end if;

  select id into v_auth from auth.users where lower(email) = lower(btrim(p_email));
  if v_auth is null then
    return jsonb_build_object('ok', false, 'motivo', 'login_nao_existe');
  end if;

  select id into v_user from usuarios where lower(email) = lower(btrim(p_email));
  if v_user is null then
    return jsonb_build_object('ok', false, 'motivo', 'usuario_nao_existe');
  end if;

  update usuarios set auth_id = v_auth where id = v_user;
  return jsonb_build_object('ok', true, 'usuario', v_user);
end $$;

revoke all on function vincular_login(text) from public, anon;
grant execute on function vincular_login(text) to authenticated;

/* Quem já tem login e quem não tem. A tela usa para mostrar o
   estado de cada pessoa sem ninguém precisar consultar o banco. */
create or replace function status_logins()
returns table (id text, nome text, email text, tem_login boolean, senha_provisoria boolean)
language plpgsql security definer as $$
begin
  if app_usuario() is null then
    raise exception 'sem usuário autenticado';
  end if;
  if not tem_nivel('administracao', 'V') then
    raise exception 'sem acesso à Administração';
  end if;
  return query
    select u.id, u.nome, u.email,
           (u.auth_id is not null
             or exists (select 1 from auth.users a
                         where lower(a.email) = lower(coalesce(u.email, '')))) as tem_login,
           coalesce(u.senha_provisoria, false)
      from usuarios u
     order by (regexp_replace(u.id, '\D', '', 'g'))::int;
end $$;

revoke all on function status_logins() from public, anon;
grant execute on function status_logins() to authenticated;

/* Varredura: liga tudo que der, de uma vez. É o que antes se fazia
   com um `update ... from auth.users` colado no SQL Editor. */
create or replace function vincular_logins_pendentes()
returns int language plpgsql security definer as $$
declare n int;
begin
  if app_usuario() is null then
    raise exception 'sem usuário autenticado';
  end if;
  if not tem_nivel('administracao', 'M') then
    raise exception 'só a Administração vincula login';
  end if;
  update usuarios u
     set auth_id = a.id
    from auth.users a
   where u.auth_id is null
     and u.email is not null
     and lower(a.email) = lower(u.email);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function vincular_logins_pendentes() from public, anon;
grant execute on function vincular_logins_pendentes() to authenticated;
