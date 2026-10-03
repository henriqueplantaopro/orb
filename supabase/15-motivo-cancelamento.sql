-- ERP Dom Pedro — o motivo do cancelamento onde faltava
-- Etapa 15.
--
-- A correção do booleano veio completa em `procedimentos`, onde o
-- motivo já tinha coluna. Em `fechamentos_procedimentos` não: o
-- modal pede o motivo, a pessoa digita, e ele não tinha onde
-- morar. Cancelar o fechamento de uma competência inteira é
-- justamente o tipo de ato em que o "por quê" importa mais que o
-- "quando".

alter table fechamentos_procedimentos
  add column if not exists motivo_cancelamento text,
  add column if not exists cancelado_em date,
  add column if not exists cancelado_por text,
  add column if not exists refaz text;

-- O mesmo nas outras tabelas que cancelam e ainda não registravam
-- o porquê.
alter table lotes_produtividade
  add column if not exists motivo_cancelamento text,
  add column if not exists cancelado_em date,
  add column if not exists cancelado_por text;

alter table folhas
  add column if not exists motivo_cancelamento text,
  add column if not exists cancelado_em date,
  add column if not exists cancelado_por text;

-- Conferência:
--   select column_name from information_schema.columns
--    where table_name = 'fechamentos_procedimentos'
--      and column_name like 'cancelado%' or column_name = 'motivo_cancelamento';
