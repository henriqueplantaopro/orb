-- ERP Dom Pedro — usuários de teste
-- Etapa 17. Roda depois dos anteriores.
--
-- Dois logins para o mesmo e-mail, usando o "+" que o Gmail aceita:
-- tudo que chega em henrique.jmbr+algo@gmail.com cai na mesma caixa,
-- e para o sistema são contas diferentes.
--
--   u90  Administração  — acesso total, para você testar à vontade
--   u91  Consulta       — SEM `ver_pacientes`, que é o perfil que
--                         falta para fechar o teste do mascaramento
--
-- O segundo é o que importa para a auditoria: com acesso total o
-- nome do paciente aparece normalmente, e aí o teste não prova nada.
-- É preciso ver em branco para quem não pode ver.

insert into usuarios (id, nome, perfil, email, ativo, senha_provisoria)
values ('u90', 'Henrique (teste — acesso total)', 'admin',
        'henrique.jmbr+adm@gmail.com', true, true)
on conflict (id) do update set
  nome = excluded.nome, perfil = excluded.perfil, email = excluded.email,
  ativo = true, senha_provisoria = true;

insert into usuarios (id, nome, perfil, email, ativo, senha_provisoria)
values ('u91', 'Henrique (teste — sem dados de paciente)', 'consulta',
        'henrique.jmbr+consulta@gmail.com', true, true)
on conflict (id) do update set
  nome = excluded.nome, perfil = excluded.perfil, email = excluded.email,
  ativo = true, senha_provisoria = true;

-- Depois de criar os dois logins no painel (Authentication › Users),
-- este comando liga cada login ao usuário do sistema:
--
--   update usuarios
--      set auth_id = (select id from auth.users where email = usuarios.email)
--    where email is not null and auth_id is null;
--
-- Conferência:
--   select id, nome, perfil, email,
--          case when auth_id is null then 'SEM LOGIN' else 'ok' end as login,
--          senha_provisoria
--     from usuarios where id in ('u90','u91');
