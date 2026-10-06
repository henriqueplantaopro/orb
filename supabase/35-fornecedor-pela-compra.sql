-- ERP Dom Pedro — cadastros criados no meio do trabalho
-- Etapa 35.
--
-- O sistema cria CREDOR em nove pontos, espalhados por módulos
-- diferentes: o médico ao lançar produtividade, o beneficiário de
-- pensão na folha, a prefeitura ao calcular retenção de ISS, o
-- fornecedor ao dar entrada de nota.
--
-- Criar credor exigia o módulo de Cadastros, que nenhum desses
-- perfis tem. O resultado era sempre o mesmo e sempre confuso: o
-- credor não gravava, e o lançamento seguinte caía com
-- "titulos_credor_fkey" — um erro sobre títulos quando a causa era
-- permissão de cadastro.
--
-- Dar Cadastros a todo mundo resolveria e abriria junto a edição
-- de conta bancária de todos os fornecedores — que é o caminho
-- mais curto para desviar um pagamento. Então:
--
--   CRIAR  → qualquer perfil que movimente um módulo que precise
--            disso, com o cadastro nascendo PENDENTE de aprovação
--   ALTERAR → continua só com Cadastros
--
-- `dados_aprovados` é o campo que o financeiro usa para liberar o
-- pagamento. Nascendo falso, o cadastro existe para o lançamento
-- andar, mas o dinheiro não sai sem um segundo par de olhos.

drop policy if exists criar_credor_no_trabalho on credores;
create policy criar_credor_no_trabalho on credores
  for insert to authenticated
  with check (
    (
      tem_nivel('compras', 'M') or tem_nivel('estoque', 'M') or
      tem_nivel('produtividade', 'M') or tem_nivel('procedimentos', 'M') or
      tem_nivel('dp', 'M') or tem_nivel('financeiro', 'M')
    )
    and coalesce(dados_aprovados, false) = false
  );

drop policy if exists ver_credor_no_trabalho on credores;
create policy ver_credor_no_trabalho on credores
  for select to authenticated
  using (
    tem_nivel('compras', 'V') or tem_nivel('estoque', 'V') or
    tem_nivel('produtividade', 'V') or tem_nivel('procedimentos', 'V') or
    tem_nivel('dp', 'V') or tem_nivel('financeiro', 'V')
  );

-- PRODUTOS pela mesma lógica: a nota traz item que não existe no
-- sistema, e quem dá entrada precisa cadastrar para a entrada
-- andar.
drop policy if exists criar_produto_no_trabalho on produtos;
create policy criar_produto_no_trabalho on produtos
  for insert to authenticated
  with check (tem_nivel('estoque', 'M') or tem_nivel('compras', 'M'));

-- A MATRIZ DE ACESSO passou a ser gravada pelo sistema (antes era
-- só lida). Quem movimenta Administração precisa poder escrever.
drop policy if exists mexer_matriz on matriz_acesso;
create policy mexer_matriz on matriz_acesso
  for all to authenticated
  using (tem_nivel('administracao', 'M'))
  with check (tem_nivel('administracao', 'M'));

-- Conferência:
--   select tablename, policyname, cmd from pg_policies
--    where tablename in ('credores','produtos','matriz_acesso')
--    order by tablename, policyname;
