-- ERP Dom Pedro — quem dá entrada de nota pode criar o fornecedor
-- Etapa 35.
--
-- A nota traz o emitente. Quem dá entrada precisa que ele exista
-- no sistema — senão a entrada não grava, e foi o que aconteceu:
-- "new row violates row-level security policy for table credores".
--
-- Dar o módulo de Cadastros inteiro a quem faz compras resolveria,
-- e abriria junto a edição de conta bancária de TODOS os
-- fornecedores. Trocar a conta de um fornecedor é o caminho mais
-- curto para desviar um pagamento, e não é por aí que se resolve
-- um problema de cadastro faltando.
--
-- Então: Compras CRIA fornecedor, e nasce com `dados_aprovados`
-- em falso — que é o campo que o financeiro usa para liberar o
-- pagamento. Alterar dados bancários continua sendo de quem tem
-- Cadastros.

-- 1. Criar: quem movimenta COMPRAS ou ESTOQUE também pode, desde
--    que o cadastro nasça pendente de aprovação.
drop policy if exists criar_credor_pela_compra on credores;
create policy criar_credor_pela_compra on credores
  for insert to authenticated
  with check (
    (tem_nivel('compras', 'M') or tem_nivel('estoque', 'M'))
    and coalesce(dados_aprovados, false) = false
  );

-- 2. Ver: quem compra ou dá entrada precisa enxergar a lista para
--    não cadastrar repetido.
drop policy if exists ver_credor_pela_compra on credores;
create policy ver_credor_pela_compra on credores
  for select to authenticated
  using (tem_nivel('compras', 'V') or tem_nivel('estoque', 'V'));

-- 3. Alterar NÃO entra aqui de propósito. Corrigir o nome de um
--    fornecedor é cadastro; e separar "só o nome" de "a conta"
--    numa política é a porta que alguém usa depois.

-- O mesmo vale para PRODUTOS: quem dá entrada cadastra material
-- que a nota trouxe, o que já é permitido pelo módulo de estoque.
-- Fica aqui a conferência, porque foi a mesma classe de problema.
--
--   select polname, polcmd from pg_policy
--    where polrelid = 'credores'::regclass order by polname;
--   -- esperado: ver_, criar_, editar_ (do módulo cadastros) mais
--   --           as duas criadas aqui
