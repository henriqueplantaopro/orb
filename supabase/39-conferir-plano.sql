-- ERP Dom Pedro — por que "produtos_conta_fkey" ainda aparece
-- Etapa 39. Diagnóstico e correção.
--
-- Os materiais do cadastro apontam para a conta 8.04 do plano
-- (Material médico-hospitalar). Se essa conta não existe no banco,
-- toda gravação de produto é recusada — e o erro fala de produtos
-- quando o que falta é uma linha do plano de contas.

-- 1. A conta existe?
select cod, nome, nivel, tipo from plano_contas where cod = '8.04';
-- vazio = é esta a causa

-- 2. Quantas contas o plano tem, e quais os produtos usam
select (select count(*) from plano_contas) as contas_no_plano,
       (select count(*) from produtos)     as produtos,
       (select count(distinct conta) from produtos where conta is not null) as contas_usadas;

-- 3. Produtos apontando para conta que não existe
select p.id, p.codigo, p.descricao, p.conta
  from produtos p
 where p.conta is not null
   and not exists (select 1 from plano_contas c where c.cod = p.conta);

-- 4. CORREÇÃO A — se a conta 8.04 realmente não existe, crie:
--    (confira antes o padrão do seu plano: nível e conta-pai)
--
--   insert into plano_contas (cod, nome, nivel, tipo, pai)
--   values ('8.04', 'Material médico-hospitalar', 2, 'custo', '8')
--   on conflict (cod) do nothing;

-- 5. CORREÇÃO B — se preferir deixar os materiais sem conta por
--    enquanto, o que não impede nada no estoque:
--
--   update produtos set conta = null
--    where conta is not null
--      and not exists (select 1 from plano_contas c where c.cod = produtos.conta);
--
--    A natureza da despesa é definida na ENTRADA da nota, que é
--    onde ela vira título — a conta no cadastro do material é só
--    uma sugestão para poupar digitação.

-- 6. Depois, confira que não sobrou nenhum:
--   select count(*) from produtos p where p.conta is not null
--    and not exists (select 1 from plano_contas c where c.cod = p.conta);
--   -- esperado: 0
