-- ERP Dom Pedro — colunas que a gravação espera
-- Etapa 34.
--
-- A gravação envia as colunas que o mapa do sistema lista. Quando
-- uma delas não existe no banco, o PostgREST recusa o lote inteiro
-- com "Could not find the 'X' column" — e o lançamento não grava.
--
-- Foi o que aconteceu com `cest` em produtos. Em vez de corrigir
-- essa, comparei o mapa inteiro com o schema: eram TREZE colunas
-- faltando em cinco tabelas, e cada uma apareceria como um erro
-- diferente, num dia diferente, sempre no meio do trabalho de
-- alguém.
--
-- Há agora um teste no sistema que compara as duas listas. Se eu
-- acrescentar uma coluna ao mapa e esquecer do banco, ele acusa
-- antes de chegar aqui.

alter table produtos
  add column if not exists cest text;

alter table centros
  add column if not exists tipo_servico     text,
  add column if not exists prev_faturamento numeric default 0,
  add column if not exists prev_repasse     numeric default 0,
  add column if not exists produtividade    boolean default false,
  add column if not exists retencao_pct     numeric default 0,
  add column if not exists prazo_dias       int;

-- As três de CANCELAMENTO: quem cancelou e quando. A etapa 15
-- acrescentou o motivo, mas não o autor nem a data — e motivo sem
-- autor não serve de trilha.
alter table fechamentos_procedimentos
  add column if not exists cancelado_em  timestamptz,
  add column if not exists cancelado_por text,
  add column if not exists refaz         boolean default false;

alter table lotes_produtividade
  add column if not exists cancelado_em  timestamptz,
  add column if not exists cancelado_por text;

alter table folhas
  add column if not exists cancelado_em  timestamptz,
  add column if not exists cancelado_por text;

-- Conferência: as colunas existem agora?
--
--   select table_name, column_name
--     from information_schema.columns
--    where table_schema = 'public'
--      and (table_name, column_name) in (
--        ('produtos','cest'), ('centros','tipo_servico'),
--        ('centros','prev_faturamento'), ('folhas','cancelado_por'))
--    order by 1, 2;
--   -- esperado: 4 linhas
