-- ERP Dom Pedro — quem atende o chamado precisa poder responder
-- Etapa 59. Roda nos DOIS bancos. Seguro rodar mais de uma vez.
--
-- ACHADO NO DIAGNÓSTICO DA ETAPA 58, no banco real:
--
--   authenticated em chamados → REFERENCES, SELECT, TRIGGER, TRUNCATE
--
-- Há SELECT e não há UPDATE. A etapa 28 criou a política
-- `chamado_atender` (for update to authenticated, using
-- tem_nivel('ativos','M')) e parou aí, supondo que o papel
-- `authenticated` já tivesse os privilégios de tabela do resto do
-- sistema. Neste projeto ele não tem.
--
-- POLÍTICA E PRIVILÉGIO SÃO DUAS TRANCAS DIFERENTES. A política diz
-- QUAIS LINHAS a pessoa pode mexer; o privilégio diz SE ela pode
-- mexer em alguma. Com a política sozinha, o Postgres recusa antes
-- de chegar a ela: "permission denied for table chamados".
--
-- Na prática: a aba Chamados do módulo de Ativos LISTA os chamados
-- (SELECT existe) e não consegue responder nem encerrar nenhum. Como
-- nunca entrou um chamado neste banco, ninguém esbarrou nisso — o
-- defeito estava esperando o primeiro chamado de verdade.
--
-- O que NÃO se concede aqui, de propósito:
--   INSERT para authenticated — chamado nasce pela etiqueta, não
--     pelo sistema;
--   DELETE para ninguém — o sistema encerra, não apaga.

grant select, update on chamados to authenticated;

-- A política continua sendo quem decide as linhas: só quem tem o
-- módulo de ativos no nível de movimento atende.
drop policy if exists chamado_atender on chamados;
create policy chamado_atender on chamados
  for update to authenticated
  using (tem_nivel('ativos', 'M'))
  with check (tem_nivel('ativos', 'M'));

-- E o anônimo continua sem ler, sem alterar e sem apagar.
revoke select, update, delete on chamados from anon;
grant insert on chamados to anon;

-- ══════════════════════════════════════════════════════════════
-- CONFERÊNCIA — uma consulta só, que é o que a tela mostra.
-- ══════════════════════════════════════════════════════════════
select 'privilegio · ' || grantee as o_que,
       string_agg(privilege_type, ', ' order by privilege_type) as resultado
  from information_schema.role_table_grants
 where table_name = 'chamados' and grantee in ('anon', 'authenticated')
 group by grantee
union all
select 'politica · ' || policyname, cmd
  from pg_policies where tablename = 'chamados'
union all
select '>>> quem atende pode responder?',
       case when has_table_privilege('authenticated', 'chamados', 'UPDATE')
            then 'SIM' else 'NAO — o grant acima nao pegou' end
union all
select '>>> o anonimo continua sem ler?',
       case when has_table_privilege('anon', 'chamados', 'SELECT')
            then 'NAO — ele esta lendo, isso e vazamento' else 'SIM' end
 order by 1;

-- ESPERADO:
--   anon          → INSERT (e o que o Postgres dá de brinde:
--                   REFERENCES, TRIGGER, TRUNCATE, que não leem nada)
--   authenticated → SELECT, UPDATE
--   políticas chamado_criar (INSERT), chamado_ver (SELECT),
--   chamado_atender (UPDATE)
--   as duas últimas linhas: SIM e SIM
