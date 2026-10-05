-- ERP Dom Pedro — valor padrão nas colunas obrigatórias
-- Etapa 23.
--
-- Terceira vez que a mesma coisa aparece: coluna NOT NULL sem
-- DEFAULT, o cliente não manda o campo, e a gravação inteira cai
-- ("estornado", depois "status" em previsões, agora "baixas" em
-- receber). Corrigir uma por vez garante que vai aparecer uma
-- quarta.
--
-- Este bloco varre o schema e dá um padrão a TODA coluna obrigatória
-- que ainda não tem: lista vazia para jsonb de array, objeto vazio
-- para jsonb de registro, zero para número, falso para booleano e
-- texto vazio para texto. Colunas-chave e datas ficam de fora: ali a
-- ausência de valor é erro de verdade, e inventar um padrão
-- esconderia o problema.

do $$
declare r record;
begin
  for r in
    select c.table_name, c.column_name, c.data_type
      from information_schema.columns c
      join information_schema.tables t
        on t.table_name = c.table_name and t.table_schema = c.table_schema
     where c.table_schema = 'public'
       and t.table_type = 'BASE TABLE'
       and c.is_nullable = 'NO'
       and c.column_default is null
       and c.column_name not in ('id', 'created_at', 'criado_em', 'lancado_em')
       /* `ARRAY` é o tipo de colunas como `autorizacoes_anteriores`:
          ficou de fora da primeira versão e derrubou a gravação de
          previsões. Os numéricos menos comuns entram pelo mesmo
          motivo — a varredura só serve se cobrir tudo. */
       and c.data_type in ('jsonb', 'boolean', 'numeric', 'integer', 'bigint', 'text',
                           'ARRAY', 'double precision', 'real', 'smallint', 'json')
  loop
    begin
      if r.data_type = 'ARRAY' then
        execute format('alter table %I alter column %I set default ''{}''',
                       r.table_name, r.column_name);
      elsif r.data_type in ('jsonb', 'json') then
        /* Campos cujo nome é plural guardam lista; os demais, objeto.
           Errar aqui não quebra: o sistema sobrescreve na primeira
           gravação. */
        if r.column_name ~ 's$' then
          execute format('alter table %I alter column %I set default ''[]''::jsonb',
                         r.table_name, r.column_name);
        else
          execute format('alter table %I alter column %I set default ''{}''::jsonb',
                         r.table_name, r.column_name);
        end if;
      elsif r.data_type = 'boolean' then
        execute format('alter table %I alter column %I set default false',
                       r.table_name, r.column_name);
      elsif r.data_type in ('numeric', 'integer', 'bigint', 'double precision', 'real', 'smallint') then
        execute format('alter table %I alter column %I set default 0',
                       r.table_name, r.column_name);
      elsif r.data_type = 'text' then
        execute format('alter table %I alter column %I set default ''''',
                       r.table_name, r.column_name);
      end if;
    exception when others then
      /* Coluna gerada ou com regra própria: segue em frente. */
      raise notice 'sem default em %.%: %', r.table_name, r.column_name, sqlerrm;
    end;
  end loop;
end $$;

-- Conferência: quantas colunas obrigatórias ainda não têm padrão.
--
--   select table_name, column_name, data_type
--     from information_schema.columns c
--     join information_schema.tables t using (table_name, table_schema)
--    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
--      and c.is_nullable = 'NO' and c.column_default is null
--      and c.column_name not in ('id','created_at','criado_em','lancado_em')
--    order by 1, 2;
--   -- o que sobrar são chaves e datas, que é o esperado
