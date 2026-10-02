-- ERP Dom Pedro — hierarquia do plano de contas
-- Etapa 8. Roda depois dos anteriores.
--
-- O sistema agrupa as contas pelo campo `pai`: o combo de natureza
-- mostra cada grupo de nível 1 com as suas contas dentro. A coluna
-- faltou no esquema, e o resultado foi um combo com os dez grupos e
-- nenhuma conta — o lançamento ficou impossível.
--
-- O `pai` é derivável do código (6.07 pertence ao 6), e por um
-- instante pensei em calcular na aplicação. Mas aí a regra passaria
-- a existir em dois lugares: no banco, implícita no código da
-- conta, e no JavaScript, explícita. Coluna de verdade, preenchida
-- uma vez, é mais simples de conferir.

alter table plano_contas add column if not exists pai text references plano_contas (cod);

-- Preenche a partir do código: tudo antes do primeiro ponto.
update plano_contas
   set pai = split_part(cod, '.', 1)
 where nivel > 1
   and pai is null
   and split_part(cod, '.', 1) <> cod
   and exists (select 1 from plano_contas p2 where p2.cod = split_part(plano_contas.cod, '.', 1));

-- Conferência:
--   select count(*) from plano_contas where nivel > 1 and pai is null;
--   -- esperado: 0
--   select cod, nome, pai from plano_contas where nivel > 1 order by cod limit 5;
