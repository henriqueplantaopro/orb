-- ════════════════════════════════════════════════════════════════
-- ATUALIZAR v129 · adicional de cargo de confiança
--
-- Uma coluna só: o valor fixo mensal pago a quem exerce cargo de
-- confiança. Ele sai no holerite em linha própria ("Adicional de
-- cargo de confiança"), separado do salário, e compõe 13º, férias
-- e rescisão.
--
-- Sem esta coluna o Postgres recusa a gravação de qualquer
-- funcionário — a tela do DP para de salvar. Rodar duas vezes não
-- faz mal.
--
-- RODE NO BANCO DO AMBIENTE QUE VOCÊ ESTÁ ATUALIZANDO.
-- ════════════════════════════════════════════════════════════════

alter table funcionarios
  add column if not exists adicional_confianca numeric(14,2);

-- A data de admissão passou a ser editável pela tela do DP nesta
-- versão. A coluna já existia e já aceita alteração — não há nada
-- a criar aqui. A trava contra corrigir a data para depois de uma
-- folha já fechada mora no sistema, não no banco, porque a
-- mensagem precisa dizer QUAIS competências impedem.

-- ── Conferência ─────────────────────────────────────────────────
select
  (select count(*) from information_schema.columns
     where table_name = 'funcionarios'
       and column_name = 'adicional_confianca') || ' de 1 coluna criada · ' ||
  (select count(*) from funcionarios where coalesce(adicional_confianca, 0) > 0)
     || ' funcionário(s) com adicional de confiança'
  as diag;
