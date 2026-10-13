-- ERP Dom Pedro — limpa Financeiro, Faturamento e Produtividade
-- Etapa 54. Rode SÓ DEPOIS de olhar o resultado do 53.
--
-- ⚠ ISTO APAGA DADOS. Leia as três garantias antes.
--
-- 1. CÓPIA ANTES DE APAGAR. Tudo é copiado para um esquema novo,
--    `lixo_AAAAMMDD_HHMM`, antes de sair das tabelas. Se amanhã
--    faltar alguma coisa, está lá inteira e dá para trazer de
--    volta com um `insert into ... select`. Nada é perdido de
--    verdade; o que acontece é uma mudança de lugar.
--
-- 2. TUDO OU NADA. O bloco inteiro roda numa transação só. Se
--    qualquer passo falhar — uma chave estrangeira que eu não
--    previ, uma tabela que não existe neste banco —, o Postgres
--    desfaz tudo e o banco fica exatamente como estava.
--
-- 3. CADASTRO NÃO É LANÇAMENTO. Empresa, centro de custo, cliente,
--    fornecedor, banco, plano de contas, contrato, as regras de
--    conciliação, os usuários e a trilha de auditoria ficam.
--    Também não encosta em Documentação, Estoque, Compras, Ativos
--    nem Pessoal.
--
-- O QUE SAI, nesta ordem (filho antes do pai):
--   pagamentos, guias_retencao, retencoes_registradas, parcelas,
--   titulos, linhas_extrato, extratos, saldos_informados,
--   transferencias_banco, receber, previsoes, lotes_rps,
--   lotes_produtividade.

do $$
declare
  esquema  text := 'lixo_' || to_char(now(), 'YYYYMMDD_HH24MI');
  -- A ORDEM IMPORTA: filho antes do pai. Algumas chaves têm
  -- `on delete cascade` e outras não — apagar na ordem certa
  -- dispensa confiar em qual é qual.
  alvos    text[] := array[
    'pagamentos', 'guias_retencao', 'retencoes_registradas', 'parcelas', 'titulos',
    'linhas_extrato', 'extratos', 'saldos_informados', 'transferencias_banco',
    'receber', 'previsoes', 'lotes_rps', 'lotes_produtividade'];
  t        text;
  n        bigint;
  total    bigint := 0;
  r        record;
  presos   text[] := '{}';
begin
  -- ── Antes de tudo: alguém de FORA da lista aponta para alguém
  --    de DENTRO? Se apontar, apagar quebraria esse vínculo, e é
  --    melhor parar e perguntar do que descobrir depois. A lista
  --    de dependências sai do catálogo do Postgres, não da minha
  --    memória — a tabela criada amanhã entra na conferência
  --    sozinha.
  for r in
    select c.conrelid::regclass::text as origem,
           c.confrelid::regclass::text as destino,
           a.attname as coluna
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid::regclass::text = any (alvos)
       and c.conrelid::regclass::text <> all (alvos)
       and array_length(c.conkey, 1) = 1
  loop
    execute format('select count(*) from %s where %I is not null', r.origem, r.coluna) into n;
    if n > 0 then
      presos := presos || (r.origem || '.' || r.coluna || ' -> ' || r.destino || ' (' || n || ')');
    end if;
  end loop;
  if array_length(presos, 1) > 0 then
    raise exception 'Existe coisa de fora apontando para o que seria apagado: %. '
                    'Nada foi tocado - me mande esta mensagem.', array_to_string(presos, '; ');
  end if;

  execute format('create schema %I', esquema);
  raise notice 'copia de seguranca no esquema %', esquema;

  -- ── A cópia, tabela por tabela.
  foreach t in array alvos loop
    execute format('create table %I.%I as table public.%I', esquema, t, t);
    execute format('select count(*) from %I.%I', esquema, t) into n;
    /* O ANALYZE não é zelo: a conferência lá embaixo lê a contagem
       do catálogo, e sem ele a tabela recém-criada aparece com
       ZERO linhas. Numa salvaguarda, relatório que diz "a cópia
       está vazia" quando ela está cheia é pior que relatório
       nenhum — foi o que a primeira versão deste arquivo fez. */
    execute format('analyze %I.%I', esquema, t);
    raise notice '  copiado %: % linha(s)', t, n;
  end loop;

  -- ── E só agora a remoção.
  foreach t in array alvos loop
    execute format('delete from public.%I', t);
    get diagnostics n = row_count;
    total := total + n;
    if n > 0 then raise notice '  apagado %: % linha(s)', t, n; end if;
  end loop;

  raise notice 'TOTAL APAGADO: % linha(s). Copia em %', total, esquema;
end $$;

-- ──────────────────────────────────────────────────────────────
-- CONFERÊNCIA — os módulos vazios, os cadastros de pé, e onde
-- está a cópia.
-- ──────────────────────────────────────────────────────────────
select 'LIMPO'    as bloco, 'titulos'    as tabela, count(*) as linhas from titulos
union all select 'LIMPO', 'parcelas',             count(*) from parcelas
union all select 'LIMPO', 'pagamentos',           count(*) from pagamentos
union all select 'LIMPO', 'retencoes_registradas',count(*) from retencoes_registradas
union all select 'LIMPO', 'guias_retencao',       count(*) from guias_retencao
union all select 'LIMPO', 'extratos',             count(*) from extratos
union all select 'LIMPO', 'linhas_extrato',       count(*) from linhas_extrato
union all select 'LIMPO', 'saldos_informados',    count(*) from saldos_informados
union all select 'LIMPO', 'transferencias_banco', count(*) from transferencias_banco
union all select 'LIMPO', 'receber',              count(*) from receber
union all select 'LIMPO', 'previsoes',            count(*) from previsoes
union all select 'LIMPO', 'lotes_rps',            count(*) from lotes_rps
union all select 'LIMPO', 'lotes_produtividade',  count(*) from lotes_produtividade
union all select 'DE PE', 'empresas',             count(*) from empresas
union all select 'DE PE', 'centros',              count(*) from centros
union all select 'DE PE', 'credores',             count(*) from credores
union all select 'DE PE', 'clientes',             count(*) from clientes
union all select 'DE PE', 'bancos',               count(*) from bancos
union all select 'DE PE', 'contratos',            count(*) from contratos
union all select 'DE PE', 'regras_conciliacao',   count(*) from regras_conciliacao
union all select 'DE PE', 'usuarios',             count(*) from usuarios
/* `reltuples` depois do ANALYZE, e não `n_live_tup`: o segundo vem
   do coletor de estatísticas, que é assíncrono, e numa tabela
   criada há um segundo ainda é zero. */
union all select 'COPIA', n.nspname || '.' || c.relname, c.reltuples::bigint
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname like 'lixo\_%' and c.relkind = 'r'
 order by 1, 2;

-- ESPERADO: tudo em LIMPO com zero, tudo em DE PE com o que já
-- tinha, e um bloco COPIA listando as tabelas guardadas.
--
-- Depois disso, recarregue o ERP com Ctrl+F5 — a aba aberta ainda
-- tem os lançamentos em memória, e um movimento nela os gravaria
-- de volta.
--
-- A cópia pode ficar guardada; não atrapalha nada e não aparece no
-- sistema. Quando tiver certeza de que não precisa mais:
--   drop schema lixo_AAAAMMDD_HHMM cascade;
