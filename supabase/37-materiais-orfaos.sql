-- ERP Dom Pedro — requisições apontando para material inexistente
-- Etapa 37. Roda uma vez, para limpar o que já aconteceu.
--
-- Enquanto o cadastro de material não chegava ao banco, as
-- requisições gravaram apontando para produtos que não existem —
-- a tela mostra "material fora do cadastro · pr8802".
--
-- O código do produto está lá, e o nome que a pessoa digitou pode
-- estar guardado no próprio item. Este script mostra o estrago e
-- recria os materiais que dá para recuperar.

-- 1. O QUE ESTÁ ÓRFÃO. Rode primeiro e veja o resultado.
select c.id as requisicao, c.status,
       i.item ->> 'produto'   as codigo_perdido,
       i.item ->> 'descricao' as nome_guardado,
       i.item ->> 'qtd'       as quantidade
  from compras c
 cross join lateral jsonb_array_elements(c.itens) as i(item)
 where i.item ->> 'produto' is not null
   and not exists (
     select 1 from produtos p where p.id = i.item ->> 'produto')
 order by c.id;

-- 2. RECRIAR os que têm nome guardado. O material volta com o
--    mesmo código que a requisição aponta, então a ligação se
--    refaz sozinha — sem mexer na requisição, que é o registro do
--    que foi pedido e não deve ser reescrito.
--
--    Mínimo e ideal ficam zerados: material recuperado assim não
--    deve disparar alerta de reposição até alguém conferir.
insert into produtos (id, codigo, descricao, unidade, minimo, ideal, custo, ativo)
select distinct on (i.item ->> 'produto')
       i.item ->> 'produto',
       coalesce(nullif(i.item ->> 'codigo', ''), 'REC-' || substr(i.item ->> 'produto', 3)),
       coalesce(nullif(i.item ->> 'descricao', ''), 'Material recuperado ' || (i.item ->> 'produto')),
       coalesce(nullif(i.item ->> 'unidade', ''), 'UN'),
       0, 0, 0, true
  from compras c
 cross join lateral jsonb_array_elements(c.itens) as i(item)
 where i.item ->> 'produto' is not null
   and not exists (select 1 from produtos p where p.id = i.item ->> 'produto')
on conflict (id) do nothing;

-- 3. Conferência: deve voltar vazio.
select count(*) as ainda_orfaos
  from compras c
 cross join lateral jsonb_array_elements(c.itens) as i(item)
 where i.item ->> 'produto' is not null
   and not exists (select 1 from produtos p where p.id = i.item ->> 'produto');

-- Os materiais recuperados ficam com nome genérico quando a
-- requisição não guardou a descrição. Procure por eles em
-- Cadastros e corrija o nome:
--
--   select id, codigo, descricao from produtos
--    where descricao like 'Material recuperado%' or codigo like 'REC-%';
