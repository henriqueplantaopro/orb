-- ERP Dom Pedro — ajustes para guardar o movimento
-- Etapa 6. Roda depois dos anteriores, em qualquer momento.
--
-- O sistema guarda, em alguns registros, campos que o esquema não
-- previu: o anexo da nota numa parcela, o código de barras do
-- boleto, o motivo de um cancelamento. São poucos e variam por
-- caso.
--
-- Duas saídas possíveis. Criar uma coluna para cada um deixaria a
-- tabela larga e obrigaria a mexer no banco a cada campo novo da
-- aplicação. A outra é uma coluna `extra` em JSON, que recebe o que
-- não tem lugar próprio.
--
-- Escolhi a segunda, com uma regra: o que se CONSULTA, FILTRA ou
-- SOMA tem coluna de verdade (valor, vencimento, status, centro). O
-- `extra` é só para o que anda junto do registro e nunca aparece
-- num `where`. Assim o banco continua consultável, e o sistema não
-- perde dado por falta de coluna.

alter table titulos                 add column if not exists extra jsonb not null default '{}'::jsonb;
alter table parcelas                add column if not exists extra jsonb not null default '{}'::jsonb;
alter table pagamentos              add column if not exists extra jsonb not null default '{}'::jsonb;
alter table receber                 add column if not exists extra jsonb not null default '{}'::jsonb;
alter table previsoes               add column if not exists extra jsonb not null default '{}'::jsonb;
alter table contratos               add column if not exists extra jsonb not null default '{}'::jsonb;
alter table retencoes_registradas   add column if not exists extra jsonb not null default '{}'::jsonb;
alter table guias_retencao          add column if not exists extra jsonb not null default '{}'::jsonb;
alter table transferencias_banco    add column if not exists extra jsonb not null default '{}'::jsonb;
alter table extratos                add column if not exists extra jsonb not null default '{}'::jsonb;
alter table linhas_extrato          add column if not exists extra jsonb not null default '{}'::jsonb;
alter table saldos_informados       add column if not exists extra jsonb not null default '{}'::jsonb;
alter table regras_conciliacao      add column if not exists extra jsonb not null default '{}'::jsonb;

-- A trilha de auditoria recebe o id gerado pela aplicação. Sem
-- isso, dois eventos gravados no mesmo instante por pessoas
-- diferentes disputariam a mesma chave.
alter table eventos add column if not exists app_id text;
create unique index if not exists eventos_app_id_uk on eventos (app_id) where app_id is not null;

-- Conferência:
--   select count(*) from information_schema.columns
--    where table_name = 'parcelas' and column_name = 'extra';
--   -- esperado: 1
