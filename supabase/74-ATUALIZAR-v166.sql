-- ══════════════════════════════════════════════════════════════════
-- ATUALIZAR v166 — o Financeiro passa a enxergar os fechamentos da
-- produtividade
--
-- Rode UMA VEZ, no SQL Editor do Supabase, nos DOIS projetos (teste e
-- real). Pode rodar de novo sem estragar nada.
--
-- O QUE ELE CONSERTA
--
-- A regra é: o financeiro só manda o repasse do médico para aprovação
-- de pagamento depois que a gestão da produtividade CONFIRMA o
-- fechamento. Para saber se o fechamento foi confirmado, o sistema
-- precisa LER o fechamento — e a tabela lotes_produtividade só era
-- visível a quem tem o módulo Produtividade.
--
-- O financeiro sem Produtividade no perfil não via fechamento nenhum,
-- e a trava, sem achar o fechamento, deixava passar. Medido na pilha
-- real (Supabase): 35 das 36 parcelas do SAMU foram para aprovação
-- com o fechamento ainda por confirmar.
--
-- A v166 conserta dos dois lados:
--   • no sistema, a trava agora FALHA FECHADA: título de produtividade
--     cujo fechamento não aparece não vai para pagamento, e o motivo
--     aparece na tela ("fechamento não encontrado");
--   • aqui no banco, quem VÊ o Financeiro passa a VER os fechamentos —
--     só ver. Alterar continua sendo da Produtividade.
--
-- O que o financeiro passa a enxergar ele já enxergava pelos títulos:
-- o valor de cada médico. O fechamento acrescenta a confirmação e os
-- bloqueios, que é exatamente o que ele precisa para não pagar errado.
-- ══════════════════════════════════════════════════════════════════

drop policy if exists ver_lotes_produtividade_financeiro on lotes_produtividade;
create policy ver_lotes_produtividade_financeiro on lotes_produtividade
  for select using (tem_nivel('financeiro', 'V'));

-- Conferência: deve listar as duas políticas de leitura.
select policyname as politica, cmd as operacao, qual as quem_ve
  from pg_policies
 where tablename = 'lotes_produtividade' and cmd = 'SELECT'
 order by policyname;
