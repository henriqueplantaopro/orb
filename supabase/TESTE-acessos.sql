-- ERP Dom Pedro — acessos do AMBIENTE DE TESTE
-- Rode SOMENTE no projeto de teste (kwaxtnooxupqlqxcjevs).
--
-- Treze logins, um por perfil, todos com a MESMA senha:
--
--     Senha de todos:  Teste@2026
--
-- Senha única é escolha deliberada aqui: no teste a pessoa precisa
-- entrar como outro perfil para ver o que ele enxerga, e senha
-- diferente por usuário só atrapalharia. Num ambiente real isso
-- seria inaceitável.
--
-- POR QUE ESTE SQL EXISTE, e por que ele NÃO serve para produção:
-- criar senha por SQL mexe direto nas tabelas internas de
-- autenticação do Supabase. Num ambiente descartável é aceitável —
-- se quebrar, refaz. No sistema real o caminho é o botao "Criar
-- acesso" da tela de usuários, que passa pela função publicada e
-- obriga a troca da senha no primeiro acesso.
--
-- Os e-mails terminam em @teste.orb de propósito: é um domínio que
-- não existe. Ninguém recebe mensagem, e ninguém confunde com o
-- e-mail real da pessoa.

create extension if not exists pgcrypto;

-- 1. Os logins
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
select
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated', 'authenticated',
  e.email,
  crypt('Teste@2026', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
from (values
  ('dayana@teste.orb'),
  ('marcia@teste.orb'),
  ('fellype@teste.orb'),
  ('contabilidade@teste.orb'),
  ('admin@teste.orb'),
  ('monique.estoque@teste.orb'),
  ('compras@teste.orb'),
  ('carol@teste.orb'),
  ('romario@teste.orb'),
  ('david@teste.orb'),
  ('bianca@teste.orb'),
  ('monique.produtividade@teste.orb'),
  ('operacional.hgb@teste.orb')
) as e(email)
where not exists (select 1 from auth.users a where a.email = e.email);

-- 2. Os e-mails no cadastro do sistema
update usuarios set email = 'dayana@teste.orb' where id = 'u1';
update usuarios set email = 'marcia@teste.orb' where id = 'u2';
update usuarios set email = 'fellype@teste.orb' where id = 'u3';
update usuarios set email = 'contabilidade@teste.orb' where id = 'u4';
update usuarios set email = 'admin@teste.orb' where id = 'u5';
update usuarios set email = 'monique.estoque@teste.orb' where id = 'u6';
update usuarios set email = 'compras@teste.orb' where id = 'u7';
update usuarios set email = 'carol@teste.orb' where id = 'u8';
update usuarios set email = 'romario@teste.orb' where id = 'u9';
update usuarios set email = 'david@teste.orb' where id = 'u10';
update usuarios set email = 'bianca@teste.orb' where id = 'u11';
update usuarios set email = 'monique.produtividade@teste.orb' where id = 'u12';
update usuarios set email = 'operacional.hgb@teste.orb' where id = 'u13';

-- 3. O vínculo entre os dois
update usuarios
   set auth_id = (select id from auth.users where email = usuarios.email),
       senha_provisoria = false
 where email is not null;

-- Conferência:
--
--   select u.id, u.nome, u.email,
--          case when u.auth_id is null then 'SEM LOGIN' else 'ok' end as login
--     from usuarios u
--    order by (regexp_replace(u.id, '\D', '', 'g'))::int;
--   -- esperado: 13 linhas, todas "ok"
