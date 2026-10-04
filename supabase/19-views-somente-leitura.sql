-- ERP Dom Pedro — visões só de leitura
-- Etapa 19.
--
-- A auditoria encontrou isto: o insert pela visão
-- `funcionarios_publico` NÃO era barrado por política — ele
-- avançava e só parava nas colunas obrigatórias da tabela-base,
-- uma de cada vez. O que segurava era a ausência de `salario_base`
-- na visão, não uma negação.
--
-- Funciona hoje e deixa de funcionar no dia em que alguém der um
-- DEFAULT àquela coluna ou acrescentar um campo à visão. Proteção
-- por acidente não é proteção: ninguém decidiu, e por isso ninguém
-- vai lembrar de conferir.
--
-- As visões existem para LER. A escrita passa pela tabela, onde a
-- política decide.

revoke insert, update, delete on funcionarios_publico from authenticated, anon;
revoke insert, update, delete on procedimentos_visivel from authenticated, anon;
revoke insert, update, delete on estoque_movimentos_visivel from authenticated, anon;

-- E, para o caso de alguma visão futura nascer esquecida, o padrão
-- do schema passa a não conceder escrita em visão nova.
alter default privileges in schema public revoke insert, update, delete on tables from authenticated;
alter default privileges in schema public revoke insert, update, delete on tables from anon;

-- O que o `alter default privileges` acima faz é valer para objetos
-- criados DEPOIS dele pelo mesmo dono. As tabelas existentes não
-- são afetadas — a escrita delas continua como está, governada
-- pelas políticas de RLS.
--
-- Conferência (como Consulta, pela API):
--   POST /rest/v1/funcionarios_publico  → deve dar 42501, não 23502
