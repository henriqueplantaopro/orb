-- ERP Dom Pedro — por que o chamado da etiqueta não grava
-- Etapa 58. Substitui a 57. Rode no banco REAL.
--
-- Esta etapa NÃO apaga nada.
--
-- POR QUE ELA EXISTE: o editor de SQL do Supabase mostra só o
-- resultado da ÚLTIMA consulta do script. A etapa 57 tinha quatro
-- consultas, e as três primeiras — justamente as que respondiam a
-- pergunta — eram apagadas da tela pela quarta. Aqui tudo é juntado
-- numa tabela e sai numa resposta só, na ordem em que se lê.
--
-- O que ela faz, na ordem:
--   1. anota o que existe e como está a permissão (foto ANTES);
--   2. refaz a permissão como a etapa 28 a criou;
--   3. tenta gravar um chamado no papel do telefone e desfaz;
--   4. conta equipamentos e chamados.

drop table if exists pg_temp.diag;
create temp table diag (ordem int, o_que text, resultado text);

do $$
declare
  um_ativo text;
  n        text;
  r        record;
begin
  -- ── 1. A FOTO, ANTES DE QUALQUER CONSERTO ──────────────────
  insert into diag values
    (10, 'tabela chamados existe',
         case when to_regclass('public.chamados') is null
              then 'NAO — rode a etapa 28 neste banco' else 'sim' end),
    (11, 'visao ativo_etiqueta existe',
         case when to_regclass('public.ativo_etiqueta') is null
              then 'NAO — rode a etapa 28 neste banco' else 'sim' end),
    (12, 'sequencia chamados_id_seq existe',
         case when to_regclass('public.chamados_id_seq') is null then 'NAO' else 'sim' end),
    (13, 'anon pode usar o esquema public',
         case when has_schema_privilege('anon', 'public', 'USAGE')
              then 'sim' else 'NAO — nada funciona para o anonimo' end),
    (14, 'anon pode usar a sequencia do id',
         case when to_regclass('public.chamados_id_seq') is null then '(nao existe)'
              when has_sequence_privilege('anon', 'chamados_id_seq', 'USAGE')
              then 'sim' else 'NAO — o insert falha aqui' end),
    (16, 'ANTES · anon podia INSERIR em chamados',
         case when to_regclass('public.chamados') is null then '(a tabela nao existe)'
              when has_table_privilege('anon', 'chamados', 'INSERT')
              then 'sim' else 'NAO — era esta a causa' end),
    (17, 'ANTES · anon podia LER ativo_etiqueta',
         case when to_regclass('public.ativo_etiqueta') is null then '(a visao nao existe)'
              when has_table_privilege('anon', 'ativo_etiqueta', 'SELECT')
              then 'sim' else 'NAO — a pagina nem identifica o equipamento' end),
    (15, 'RLS ligada em chamados',
         coalesce((select case when relrowsecurity then 'sim' else 'NAO' end
                     from pg_class where oid = to_regclass('public.chamados')), '(nao existe)'));

  for r in
    select grantee, table_name,
           string_agg(privilege_type, ', ' order by privilege_type) as p
      from information_schema.role_table_grants
     where table_name in ('chamados', 'ativo_etiqueta')
       and grantee in ('anon', 'authenticated')
     group by grantee, table_name order by table_name, grantee
  loop
    insert into diag values (20, 'ANTES · ' || r.grantee || ' em ' || r.table_name, r.p);
  end loop;
  if not exists (select 1 from diag where ordem = 20) then
    insert into diag values (20, 'ANTES · privilegios de anon', 'NENHUM — e por isso que nao grava');
  end if;

  for r in select policyname, cmd from pg_policies
            where tablename = 'chamados' order by policyname
  loop
    insert into diag values (30, 'ANTES · politica ' || r.policyname, r.cmd);
  end loop;
  if not exists (select 1 from diag where ordem = 30) then
    insert into diag values (30, 'ANTES · politicas em chamados', 'NENHUMA');
  end if;

  -- ── 2. REFAZ A PERMISSÃO (igual à etapa 28) ────────────────
  if to_regclass('public.chamados') is null then
    insert into diag values (40, 'conserto da permissao', 'nada a fazer — a tabela nao existe');
  else
    drop policy if exists chamado_criar on chamados;
    create policy chamado_criar on chamados
      for insert to anon, authenticated
      with check (
        length(btrim(descricao)) between 5 and 2000
        and length(coalesce(contato_nome, '')) <= 120
        and length(coalesce(contato_fone, '')) <= 40
        and length(coalesce(local_informado, '')) <= 200
        and situacao = 'aberto'
        and atendido_por is null
        and resposta is null
      );
    revoke select, update, delete on chamados from anon;
    grant insert on chamados to anon;
    if to_regclass('public.chamados_id_seq') is not null then
      grant usage, select on sequence chamados_id_seq to anon;
    end if;
    if to_regclass('public.ativo_etiqueta') is not null then
      grant select on ativo_etiqueta to anon, authenticated;
    end if;
    insert into diag values (40, 'conserto da permissao', 'refeita como na etapa 28');
  end if;

  -- ── 3. A GRAVAÇÃO, NO PAPEL DO TELEFONE ────────────────────
  if to_regclass('public.chamados') is null then
    insert into diag values (50, '>>> O TELEFONE CONSEGUE GRAVAR?',
                             'NAO TESTEI — a tabela chamados nao existe');
  else
    select id into um_ativo from ativos
     where coalesce(desmembrado, false) = false order by id limit 1;
    begin
      set local role anon;
      -- `public.` por extenso: o caminho de busca do anonimo pode
      -- ser outro, e o erro sairia como "a tabela nao existe".
      insert into public.chamados (ativo, tag, descricao, contato_nome, urgencia)
      values (um_ativo, 'TESTE-DIAGNOSTICO',
              'Teste de permissao da etiqueta - nao e um chamado real',
              'diagnostico', 'normal');
      reset role;
      insert into diag values (50, '>>> O TELEFONE CONSEGUE GRAVAR?',
        'SIM — gravou (equipamento usado: ' || coalesce(um_ativo, 'nenhum') || ')');
    exception when others then
      reset role;
      insert into diag values (50, '>>> O TELEFONE CONSEGUE GRAVAR?',
        'NAO — ' || sqlstate || ': ' || sqlerrm);
    end;
    delete from chamados where tag = 'TESTE-DIAGNOSTICO';
  end if;

  -- ── 4. O QUE ESTE BANCO TEM ────────────────────────────────
  n := '(sem a tabela)';
  if to_regclass('public.chamados') is not null then
    execute 'select count(*)::text from chamados' into n;
  end if;
  insert into diag values
    (60, 'equipamentos ativos neste banco',
         (select count(*)::text from ativos where coalesce(desmembrado, false) = false)),
    (61, 'chamados ja abertos', n),
    (62, 'endereco da etiqueta (parametro)',
         coalesce((select valor #>> '{}' from parametros where chave = 'url_chamado'),
                  '(nao definido)'));
end $$;

-- A ÚNICA consulta do arquivo: é esta que a tela mostra.
select o_que, resultado from diag order by ordem, o_que;

-- A linha que interessa é ">>> O TELEFONE CONSEGUE GRAVAR?".
-- Se disser NAO, o código e o motivo vêm escritos ao lado.
