-- ERP Dom Pedro — limpar antes de começar a usar
-- Etapa 24.
--
-- Tira do banco tudo que é de teste e deixa só a estrutura: as
-- empresas, os projetos, os clientes, os usuários, os perfis, a
-- matriz de acesso e as previsões de faturamento.
--
-- RODE UMA VEZ SÓ, antes de a equipe entrar. Diferente das outras
-- etapas, esta NÃO é idempotente no sentido útil: rodar de novo
-- depois de a equipe lançar dados apaga o trabalho dela. Por isso
-- ela está separada do ATUALIZAR-TUDO.sql e não é incluída lá.
--
-- O que PERMANECE:
--   empresas, centros (projetos), clientes, usuarios, perfis,
--   matriz_acesso, plano_contas, cargos, parametros, previsoes
--
-- O que SAI:
--   todo lançamento (títulos, parcelas, pagamentos, a receber),
--   estoque inteiro, procedimentos, compras, ativos, ordens de
--   serviço, folhas, produtividade, extratos, retenções,
--   armazéns, produtos, fornecedores e médicos.

begin;

-- ── movimento financeiro ────────────────────────────────
delete from pagamentos;
delete from parcelas;
delete from titulos;
delete from receber;
delete from retencoes_registradas;
delete from guias_retencao;
delete from transferencias_banco;
delete from linhas_extrato;
delete from extratos;
delete from saldos_informados;
delete from regras_conciliacao;

-- ── estoque ─────────────────────────────────────────────
delete from estoque_movimentos;
delete from estoque_camadas;
delete from posicoes_estoque;
delete from minimos_estoque;

-- ── procedimentos e produtividade ───────────────────────
delete from procedimentos;
delete from fechamentos_procedimentos;
delete from lotes_produtividade;
delete from lotes_rps;

-- ── compras, ativos e manutenção ────────────────────────
delete from ordens_servico;
delete from ativo_movimentos;
delete from ativos;
delete from compras;

-- ── pessoal ─────────────────────────────────────────────
delete from decimos;
delete from folhas;
delete from funcionarios;

-- ── cadastros que serão recarregados ────────────────────
delete from armazens;
delete from produtos;
delete from credores;      -- fornecedores e médicos
delete from contratos;

-- ── previsões: ficam, mas voltam a "estimada" ───────────
--
-- O dono quer a previsão de cada projeto preservada e NADA
-- confirmado: confirmar é um ato de quem acompanha o contrato, e
-- herdar confirmação de teste faria o mês nascer com etapa vencida
-- que ninguém cumpriu.
update previsoes
   set status = 'estimada',
       confirmado_por = null, confirmado_em = null,
       autorizado_em = null, autorizado_por = null, autorizado_por_id = null,
       autorizacao_protocolo = null, autorizacao_obs = null, autorizado_valor = null,
       autorizacoes_anteriores = '{}',
       liberado_em = null, liberado_por = null;

-- ── a trilha de auditoria ───────────────────────────────
--
-- Os eventos de teste saem junto: trilha que começa com movimento
-- que não existe mais atrapalha a leitura de quem for auditar.
-- (A tabela não aceita delete por privilégio; é preciso rodar como
--  dono do banco, que é o caso aqui no SQL Editor.)
delete from eventos;

commit;

-- Conferência do que sobrou:
--
--   select 'projetos', count(*) from centros where tipo = 'projeto'
--   union all select 'clientes', count(*) from clientes
--   union all select 'usuários', count(*) from usuarios
--   union all select 'previsões', count(*) from previsoes
--   union all select 'títulos', count(*) from titulos
--   union all select 'fornecedores', count(*) from credores
--   union all select 'produtos', count(*) from produtos;
