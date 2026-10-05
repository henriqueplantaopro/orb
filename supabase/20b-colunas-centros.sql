-- ERP Dom Pedro — colunas que faltavam em centros e clientes
-- Etapa 20b (roda antes da 21 e da 22).
--
-- `tipo_servico`, `prev_faturamento`, `prev_repasse`, `cliente` e
-- `grupo_faturamento` existiam no cadastro do sistema e nunca
-- tinham sido criadas no banco: até agora viviam na coluna `extra`,
-- o que funciona para ler e escrever pelo sistema mas não permite
-- consultar nem atualizar por SQL.
--
-- Como as etapas seguintes preenchem esses campos, eles precisam
-- existir como coluna de verdade.

alter table centros
  add column if not exists cliente text,
  add column if not exists tipo_servico text,
  add column if not exists grupo_faturamento text,
  add column if not exists prev_faturamento numeric default 0,
  add column if not exists prev_repasse numeric default 0,
  add column if not exists produtividade boolean default false,
  add column if not exists retencao_pct numeric default 0,
  add column if not exists impostos jsonb default '{}'::jsonb,
  add column if not exists prazo_dias int,
  add column if not exists codigo_hospital text,
  add column if not exists unidade text;

alter table clientes
  add column if not exists centro_padrao text,
  add column if not exists prazo_dias int,
  add column if not exists retencoes jsonb default '[]'::jsonb;

-- Conferência:
--   select column_name from information_schema.columns
--    where table_name = 'centros' and column_name in
--      ('cliente','tipo_servico','prev_faturamento','grupo_faturamento');
--   -- esperado: 4 linhas
