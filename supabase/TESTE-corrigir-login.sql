-- ERP Dom Pedro — corrigir os logins de teste
-- Rode SOMENTE no projeto de teste.
--
-- O serviço de autenticação do Supabase recusa login quando as
-- colunas de token estão NULAS — ele tenta ler texto e encontra
-- nada. O `insert` do arquivo anterior as deixou assim, e o
-- resultado é "e-mail ou senha incorretos" mesmo com a senha certa.
--
-- Vazio não é a mesma coisa que nulo: aqui a diferença é entre
-- entrar e não entrar.

-- 1. O que está gravado hoje
select email,
       (encrypted_password is not null) as tem_senha,
       (email_confirmed_at is not null) as confirmado,
       (confirmation_token is null)     as token_nulo
  from auth.users
 where email like '%@teste.orb'
 order by email;

-- 2. A correção
update auth.users
   set confirmation_token     = coalesce(confirmation_token, ''),
       recovery_token         = coalesce(recovery_token, ''),
       email_change           = coalesce(email_change, ''),
       email_change_token_new = coalesce(email_change_token_new, ''),
       email_change_token_current = coalesce(email_change_token_current, ''),
       phone_change           = coalesce(phone_change, ''),
       phone_change_token     = coalesce(phone_change_token, ''),
       reauthentication_token = coalesce(reauthentication_token, ''),
       /* `confirmed_at` NÃO entra aqui: é coluna calculada pelo
          próprio banco a partir de `email_confirmed_at`. Tentar
          escrevê-la derruba o comando inteiro. */
       email_confirmed_at     = coalesce(email_confirmed_at, now()),
       aud  = coalesce(nullif(aud, ''), 'authenticated'),
       role = coalesce(nullif(role, ''), 'authenticated')
 where email like '%@teste.orb';

-- 3. A senha, gravada de novo para garantir
update auth.users
   set encrypted_password = crypt('Teste@2026', gen_salt('bf'))
 where email like '%@teste.orb';

-- 4. Cada login precisa de uma identidade: sem ela, o serviço não
--    reconhece o e-mail como forma de entrar.
insert into auth.identities (
  id, user_id, identity_data, provider, provider_id,
  last_sign_in_at, created_at, updated_at
)
select gen_random_uuid(), u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', u.id::text,
       now(), now(), now()
  from auth.users u
 where u.email like '%@teste.orb'
   and not exists (
     select 1 from auth.identities i
      where i.user_id = u.id and i.provider = 'email');

-- 5. Conferência final
select u.email,
       (i.id is not null) as tem_identidade,
       (s.auth_id is not null) as ligado_ao_sistema
  from auth.users u
  left join auth.identities i on i.user_id = u.id and i.provider = 'email'
  left join usuarios s on s.auth_id = u.id
 where u.email like '%@teste.orb'
 order by u.email;
-- esperado: 13 linhas, todas com true nas duas colunas
