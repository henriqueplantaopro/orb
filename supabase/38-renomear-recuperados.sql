-- ERP Dom Pedro — dar nome aos materiais recuperados
-- Etapa 38.
--
-- A etapa 37 recriou os materiais que as requisições apontavam,
-- mas as requisições antigas não guardavam a descrição — então
-- eles voltaram como "Material recuperado pr8802".
--
-- Esses nomes precisam ser corrigidos à mão: o sistema não tem
-- como adivinhar o que a pessoa quis cadastrar. O que ele pode
-- fazer é mostrar exatamente quais são e onde cada um é usado,
-- para a conversa com quem lançou ser curta.

-- 1. Quais materiais estão com nome genérico, e em que requisição
--    cada um aparece. Leve esta lista para quem fez a requisição.
select p.id, p.codigo, p.descricao,
       string_agg(distinct c.id, ', ') as requisicoes,
       sum((i.item ->> 'qtd')::numeric) as qtd_total
  from produtos p
  left join compras c
    on exists (
      select 1 from jsonb_array_elements(c.itens) as x(item)
       where x.item ->> 'produto' = p.id)
  left join lateral jsonb_array_elements(c.itens) as i(item)
    on i.item ->> 'produto' = p.id
 where p.descricao like 'Material recuperado%' or p.codigo like 'REC-%'
 group by p.id, p.codigo, p.descricao
 order by p.codigo;

-- 2. Corrija um a um, pelo id que a consulta mostrou. Troque o
--    nome, o código e a unidade pelos de verdade:
--
--   update produtos
--      set descricao = 'NOME CORRETO DO MATERIAL',
--          codigo    = 'MT-XXX',
--          unidade   = 'CX'
--    where id = 'pr8802';
--
--    Dá para fazer pela tela também, em Cadastros › Materiais —
--    é o mesmo efeito, e lá o sistema confere repetidos.

-- 3. Depois de corrigir todos, confira que não sobrou nenhum:
--
--   select count(*) from produtos
--    where descricao like 'Material recuperado%' or codigo like 'REC-%';
--   -- esperado: 0
