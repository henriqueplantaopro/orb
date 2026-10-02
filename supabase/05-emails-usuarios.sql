-- ERP Dom Pedro — e-mails dos usuários
-- Roda depois de 01-schema.sql e 03-seed.sql. Independe da RLS.
--
-- Só grava o endereço na tabela `usuarios`. NÃO cria login e NÃO
-- dispara convite: o login é Marco 3, e convite enviado hoje levaria
-- a uma página sem destino.
--
-- Os endereços estão exatamente como o dono escreveu. O `auth_id`
-- fica nulo de propósito — é o que a Tarefa 4 preenche quando o
-- Supabase Auth entrar, no Marco 3:
--
--   update usuarios set auth_id = (select id from auth.users
--                                   where email = usuarios.email)
--    where email is not null;

update usuarios set email = 'notasfiscais@dompedrosaude.com.br'      where id = 'u1';
update usuarios set email = 'dir.financeira@dompedrosaude.com.br'    where id = 'u2';
update usuarios set email = 'fellype.rmendonca@gmail.com'            where id = 'u3';
update usuarios set email = 'licitacao.dompedrosaude@gmail.com'      where id = 'u5';
update usuarios set email = 'davidbvalente@gmail.com'                where id = 'u10';

-- Gravado como o dono escreveu. Parece faltar o "i" de
-- administrativa; fica assim de propósito, e se descobre no convite.
update usuarios set email = 'dir.admnistrativa@dompedrosaude.com.br' where id = 'u11';

-- Sem endereço, por decisão do dono: u4 (Contabilidade), u6 (Monique
-- Cardoso), u7 (Compras, a definir), u8 (Carol), u9 (Romário),
-- u12 (Monique Almeida), u13 (Operacional HGB).

-- Conferência:
select id, nome, perfil, coalesce(email, '—') as email,
       case when auth_id is null then 'SEM LOGIN' else 'ok' end as login
  from usuarios
 order by (regexp_replace(id, '\D', '', 'g'))::int;
-- esperado: 6 linhas com e-mail, 7 com '—', todas em SEM LOGIN
