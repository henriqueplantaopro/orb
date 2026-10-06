-- ERP Dom Pedro — coluna `extra` nos cadastros
-- Etapa 33.
--
-- A gravação separa o registro entre as colunas que a tabela tem e
-- um campo `extra`, em JSON, com o resto — assim nenhum dado se
-- perde quando o sistema ganha um campo antes do banco.
--
-- `produtos`, `armazens`, `bancos` e `plano_contas` não tinham essa
-- coluna, e a gravação caía inteira com "Could not find the 'extra'
-- column". O material cadastrado não chegava ao banco e a entrada
-- de estoque seguinte era recusada por chave estrangeira — um erro
-- apontando o estoque quando a causa era o cadastro.

alter table produtos      add column if not exists extra jsonb not null default '{}'::jsonb;
alter table armazens      add column if not exists extra jsonb not null default '{}'::jsonb;
alter table bancos        add column if not exists extra jsonb not null default '{}'::jsonb;
alter table plano_contas  add column if not exists extra jsonb not null default '{}'::jsonb;
alter table clientes      add column if not exists extra jsonb not null default '{}'::jsonb;
alter table centros       add column if not exists extra jsonb not null default '{}'::jsonb;
alter table credores      add column if not exists extra jsonb not null default '{}'::jsonb;

-- Conferência: nenhuma tabela de cadastro sem `extra`.
--
--   select t.table_name
--     from information_schema.tables t
--    where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
--      and t.table_name in ('produtos','armazens','bancos','plano_contas',
--                           'clientes','centros','credores')
--      and not exists (
--        select 1 from information_schema.columns c
--         where c.table_name = t.table_name and c.column_name = 'extra');
--   -- esperado: nenhuma linha
