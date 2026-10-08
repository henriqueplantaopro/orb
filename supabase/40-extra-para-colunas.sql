-- ERP Dom Pedro — o que ficou preso dentro de `extra`
-- Etapa 40 (v2). Roda uma vez, nos dois bancos (real e teste).
--
-- v2: a primeira versão varria `information_schema.columns`, que
-- lista TABELAS E VIEWS juntas. O bloco tentava atualizar a view
-- `estoque_movimentos_visivel` e parava com "cannot update column
-- paciente of view". Agora só tabelas de base entram.
--
-- POR QUE EXISTE
--
-- A coluna `extra` guarda o que o sistema tem e o banco ainda não.
-- Quando a coluna de verdade é criada depois — foi o caso de `cest`
-- e `familia` em produtos, e de treze outras na etapa 34 —, o valor
-- antigo CONTINUA dentro do `extra`, congelado no dia em que foi
-- gravado.
--
-- Até a v96 o `extra` vencia a coluna na hora de ler. O efeito era
-- o pior tipo de erro: a consulta no banco mostrava tudo certo
-- (`select conta from produtos` devolvia 8.04, que existe), mas o
-- sistema trabalhava com o valor velho de dentro do `extra` e o
-- mandava de volta na gravação — e o banco recusava o lote inteiro
-- com "produtos_conta_fkey", apontando para uma conta que ninguém
-- conseguia encontrar porque ela não estava em nenhuma coluna.
--
-- A v97 inverteu: a coluna manda, `extra` só preenche o que a linha
-- não trouxe. Este script é a outra metade — promove para a coluna
-- o que está preso no `extra` e limpa a chave de lá, para o valor
-- não ficar em dois lugares com duas respostas.
--
-- É seguro rodar mais de uma vez.

-- ──────────────────────────────────────────────────────────────
-- 1. PROMOVER o que está preso.
--
--    Precisa de SQL dinâmico, porque cada tabela tem suas colunas.
--    Percorre as TABELAS DE BASE que têm `extra` e, para cada
--    coluna de verdade com o mesmo nome de uma chave lá dentro,
--    passa o valor para a coluna e tira a chave.
--
--    O que foi movido aparece nas MENSAGENS (aba "Messages" do
--    editor do Supabase), uma linha por coluna.
-- ──────────────────────────────────────────────────────────────

-- O relatório do estrago fica aqui para você olhar depois do
-- bloco. É nele que aparece o valor fantasma — inclusive o que foi
-- descartado por já haver valor bom na coluna, que é o caso da
-- conta inválida e NÃO apareceria de outro jeito.
drop table if exists relatorio_extra;
create table relatorio_extra (
  tabela text, coluna text, registro text,
  valor_no_extra text, valor_na_coluna text, destino text
);

do $$
declare
  t    record;
  col  record;
  n    bigint;
  tot  bigint := 0;
begin
  for t in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables tb
        on tb.table_schema = c.table_schema
       and tb.table_name   = c.table_name
     where c.table_schema = 'public'
       and c.column_name  = 'extra'
       and tb.table_type  = 'BASE TABLE'     -- view não aceita update
     order by c.table_name
  loop
    for col in
      select c.column_name, c.data_type
        from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name   = t.table_name
         and c.column_name <> 'extra'
         and c.is_updatable = 'YES'
         and c.is_generated = 'NEVER'
         -- só tipos simples: jsonb e array saem de `extra` com
         -- forma diferente e não cabem num cast cego
         and c.data_type in ('text', 'character varying', 'numeric',
                             'integer', 'bigint', 'boolean', 'date')
    loop
      -- ANOTA antes de mexer. Sem isto, o valor fantasma some sem
      -- ninguém nunca ver qual era — e era exatamente o que estava
      -- derrubando a gravação.
      if exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = t.table_name
                    and column_name = 'id') then
        execute format($f$
          insert into relatorio_extra
          select %L, %L, x.id, x.extra ->> %L, x.%I::text,
                 case when x.%I is null then 'promovido para a coluna'
                      else 'DESCARTADO — a coluna já tinha valor' end
            from %I x
           where x.extra ? %L
             and coalesce(x.extra ->> %L, '') <> ''
             and coalesce(x.extra ->> %L, '') is distinct from coalesce(x.%I::text, '')
        $f$, t.table_name, col.column_name, col.column_name, col.column_name,
             col.column_name, t.table_name,
             col.column_name, col.column_name, col.column_name, col.column_name);
      end if;

      begin
        -- Promove só onde a coluna está VAZIA e o `extra` tem
        -- valor: nunca sobrescreve o que já está na coluna.
        execute format($f$
          update %I
             set %I = (extra ->> %L)::%s
           where extra ? %L
             and extra ->> %L is not null
             and extra ->> %L <> ''
             and %I is null
        $f$, t.table_name, col.column_name, col.column_name,
             case col.data_type
               when 'character varying' then 'text'
               else col.data_type
             end,
             col.column_name, col.column_name, col.column_name,
             col.column_name);
        get diagnostics n = row_count;
        if n > 0 then
          raise notice 'promovido: %.% — % linha(s)', t.table_name, col.column_name, n;
          tot := tot + n;
        end if;
      exception when others then
        -- Valor guardado num formato que não cabe na coluna (texto
        -- numa coluna de data, por exemplo). Não trava o resto: o
        -- caso fica nomeado aqui e a chave sai do `extra` abaixo,
        -- que é o que resolve a duplicidade.
        raise notice 'PULADO %.%: %', t.table_name, col.column_name, sqlerrm;
      end;

      -- Reconcilia o relatório com o que de fato aconteceu: o que
      -- anotei como "promovido" era previsão, e o cast pode ter
      -- falhado. Um relatório que mente não serve para diagnóstico.
      if exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = t.table_name
                    and column_name = 'id') then
        execute format($f$
          update relatorio_extra r
             set destino = 'NAO COUBE na coluna — formato incompativel'
           where r.tabela = %L and r.coluna = %L
             and r.destino = 'promovido para a coluna'
             and exists (select 1 from %I x where x.id = r.registro and x.%I is null)
        $f$, t.table_name, col.column_name, t.table_name, col.column_name);
      end if;

      -- Tira a chave do `extra` SEMPRE que a coluna existe, tenha
      -- sido promovida ou não. O valor em dois lugares é a origem
      -- do problema; um só lugar é a correção.
      execute format('update %I set extra = extra - %L where extra ? %L',
                     t.table_name, col.column_name, col.column_name);
    end loop;
  end loop;
  raise notice 'TOTAL promovido: % valor(es)', tot;
end $$;

-- ──────────────────────────────────────────────────────────────
-- 2. CONFERÊNCIA — deve dizer "OK".
--    Nenhuma chave do `extra` pode ter coluna com o mesmo nome.
-- ──────────────────────────────────────────────────────────────
do $$
declare
  t   record;
  n   bigint;
  mal int := 0;
begin
  for t in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables tb
        on tb.table_schema = c.table_schema
       and tb.table_name   = c.table_name
     where c.table_schema = 'public'
       and c.column_name  = 'extra'
       and tb.table_type  = 'BASE TABLE'
  loop
    execute format($f$
      select count(*) from %I x
       where exists (
         select 1 from jsonb_object_keys(coalesce(x.extra, '{}'::jsonb)) k
          where k in (select column_name from information_schema.columns
                       where table_schema = 'public' and table_name = %L))
    $f$, t.table_name, t.table_name) into n;
    if n > 0 then
      raise notice 'AINDA DUPLICADO em %: % linha(s)', t.table_name, n;
      mal := mal + 1;
    end if;
  end loop;
  if mal = 0 then raise notice 'OK — nenhum valor em dois lugares.'; end if;
end $$;

-- ──────────────────────────────────────────────────────────────
-- 3. A CAUSA DO ERRO, agora visível.
--
--    Esta é a consulta que importa: tudo que estava dentro do
--    `extra` divergindo da coluna. A linha com "DESCARTADO" é o
--    valor fantasma que o sistema lia e mandava de volta ao banco.
-- ──────────────────────────────────────────────────────────────
select * from relatorio_extra order by tabela, coluna, registro;

-- 3b. Especificamente a conta do material: o que o `extra` trazia
--     e que não existe no plano de contas. Se vier alguma linha
--     com `nao_existe_no_plano = true`, é ela que derrubava a
--     gravação com "produtos_conta_fkey".
select r.registro, p.codigo, p.descricao,
       r.valor_no_extra  as conta_que_o_sistema_usava,
       r.valor_na_coluna as conta_gravada,
       r.destino,
       not exists (select 1 from plano_contas c where c.cod = r.valor_no_extra)
         as nao_existe_no_plano
  from relatorio_extra r
  left join produtos p on p.id = r.registro
 where r.tabela = 'produtos' and r.coluna = 'conta';

-- 3c. E as que porventura ficaram na própria coluna.
select p.id, p.codigo, p.descricao, p.conta as conta_invalida
  from produtos p
 where p.conta is not null
   and not exists (select 1 from plano_contas c where c.cod = p.conta);

-- Para zerar as que aparecerem (a natureza do material é só uma
-- sugestão: quem define de verdade é a entrada da nota):
--
--   update produtos set conta = null
--    where conta is not null
--      and not exists (select 1 from plano_contas c where c.cod = produtos.conta);
