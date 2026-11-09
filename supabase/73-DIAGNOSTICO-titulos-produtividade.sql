-- ════════════════════════════════════════════════════════════════
--  73 · DIAGNÓSTICO — por que os títulos da produtividade não gravam
--
--  SÓ LÊ. Não altera nada no banco: o teste de gravação roda como a
--  Bianca DENTRO de um ponto de retorno e é desfeito na hora, dê
--  certo ou não. Rodar uma vez no SQL Editor do Supabase do ambiente
--  REAL e mandar o resultado (a tabela que aparece no fim).
--
--  O que ele responde:
--    1. o SQL 72 está aplicado neste banco?
--    2. o que o BANCO acha do perfil dela (pode ser diferente do que
--       a tela acha — a tela lê a matriz guardada, o banco lê a
--       tabela matriz_acesso);
--    3. os títulos que a mensagem cita existem? com que dados?
--    4. COMO ELA: o banco deixa ver, gravar e regravar um título?
--    5. há gatilho (trigger) nas tabelas de títulos e parcelas?
-- ════════════════════════════════════════════════════════════════

drop table if exists pg_temp.diag73;
create temp table diag73 (ordem int, o_que text, resultado text);
grant all on diag73 to authenticated;

do $$
declare
  v_user   record;
  v_auth   text;
  v_perfil text;
  v_t      record;
  v_n      int;
  v_txt    text;
  v_credor text;
  ids      text[] := array['t64904','t64907','t64910'];
  i        int;
begin
  -- 1. o SQL 72
  select count(*) into v_n from pg_policies
   where policyname in ('criar_titulos_produtividade','editar_titulos_produtividade',
                        'ver_titulos_produtividade','criar_parcelas_produtividade',
                        'criar_credores_produtividade','editar_credores_produtividade');
  insert into diag73 values (10, 'SQL 72 aplicado (6 politicas esperadas)', v_n || ' de 6');

  -- 2. ela, para o banco
  select * into v_user from usuarios
   where nome ilike '%bianca%' and coalesce(ativo, true) order by id limit 1;
  if v_user.id is null then
    insert into diag73 values (20, 'usuaria Bianca', 'NAO ACHEI em usuarios');
    return;
  end if;
  v_auth := v_user.auth_id::text; v_perfil := v_user.perfil;
  insert into diag73 values (20, 'usuaria', v_user.id || ' · ' || v_user.nome || ' · perfil ' || v_perfil ||
    ' · login ' || case when v_auth is null then 'NAO VINCULADO' else 'vinculado' end);
  select string_agg(modulo || '=' || niveis, '  ' order by modulo) into v_txt
    from matriz_acesso where perfil = v_perfil;
  insert into diag73 values (21, 'matriz no BANCO (tabela matriz_acesso)', coalesce(v_txt, '(nenhuma linha)'));
  select acoes::text into v_txt from perfis where id = v_perfil;
  insert into diag73 values (22, 'acoes do perfil', coalesce(v_txt, '(perfil nao existe em perfis)'));

  -- 3. os titulos citados na mensagem
  for i in 1 .. array_length(ids, 1) loop
    select * into v_t from titulos where id = ids[i];
    if v_t.id is null then
      insert into diag73 values (30 + i, 'titulo ' || ids[i], 'NAO EXISTE no banco');
    else
      insert into diag73 values (30 + i, 'titulo ' || ids[i],
        'existe · origem=' || coalesce(v_t.origem, '(vazio)') || ' · tipo=' || coalesce(v_t.tipo_titulo, '(vazio)') ||
        ' · credor=' || coalesce(v_t.credor, '(vazio)') || ' · criado por ' || coalesce(v_t.criado_por, '?') ||
        ' em ' || to_char(v_t.criado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'));
      v_credor := coalesce(v_credor, v_t.credor);
    end if;
  end loop;
  select count(*) into v_n from titulos where origem = 'produtividade'
     and criado_em >= current_date - 1;
  insert into diag73 values (35, 'titulos de produtividade criados desde ontem', v_n::text);
  select string_agg(l.id || ' ' || coalesce(c.curto, l.centro) || ' ' || l.competencia ||
           case when coalesce(l.cancelado, false) then ' CANCELADO' else ' vivo' end ||
           ' · ' || jsonb_array_length(coalesce(l.titulo_ids, '[]'::jsonb)) || ' titulos (1o ' ||
           coalesce(l.titulo_ids ->> 0, '-') || ')', ' | ' order by l.criado_em)
    into v_txt
    from lotes_produtividade l left join centros c on c.id = l.centro
   where l.criado_em >= current_date - 40;
  insert into diag73 values (36, 'fechamentos de produtividade recentes', coalesce(v_txt, '(nenhum)'));

  if v_credor is null then
    select id into v_credor from credores where tipo = 'medico' order by id limit 1;
  end if;

  -- 4. COMO ELA
  if v_auth is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_auth, true);
    execute 'set local role authenticated';

    insert into diag73 values (40, 'COMO ELA · Financeiro alterar (tem_nivel M)', tem_nivel('financeiro','M')::text);
    insert into diag73 values (41, 'COMO ELA · Cadastros alterar', tem_nivel('cadastros','M')::text);
    insert into diag73 values (42, 'COMO ELA · Produtividade alterar', tem_nivel('produtividade','M')::text);

    select count(*) into v_n from titulos where id = any(ids);
    insert into diag73 values (43, 'COMO ELA · enxerga quantos dos 3 titulos', v_n::text);

    -- regravar um titulo que JA EXISTE, como o sistema faz (upsert + devolve o id)
    if exists (select 1 from titulos where id = ids[1]) then
      begin
        with x as (
          insert into titulos (id, descricao, credor, tipo_titulo, origem, valor_total)
          select id, descricao, credor, tipo_titulo, origem, valor_total from titulos where id = ids[1]
          on conflict (id) do update set descricao = excluded.descricao
          returning id)
        select count(*) into v_n from x;
        raise exception 'desfazer';   -- desfaz a gravacao; o numero fica na variavel
      exception when others then
        if sqlerrm = 'desfazer' then
          insert into diag73 values (44, 'COMO ELA · regravar ' || ids[1] || ' (devolveu quantos; 1 = gravou)', v_n::text);
        else
          insert into diag73 values (44, 'COMO ELA · regravar ' || ids[1], 'ERRO: ' || sqlerrm);
        end if;
      end;
    end if;

    -- gravar um titulo NOVO de produtividade, como a importacao faz
    begin
      with x as (
        insert into titulos (id, descricao, credor, tipo_titulo, origem, valor_total)
        values ('diag73-teste', 'teste do diagnostico 73', v_credor, 'medicao', 'produtividade', 1)
        on conflict (id) do update set descricao = excluded.descricao
        returning id)
      select count(*) into v_n from x;
      raise exception 'desfazer';
    exception when others then
      if sqlerrm = 'desfazer' then
        insert into diag73 values (45, 'COMO ELA · gravar titulo NOVO (devolveu quantos; 1 = gravou)', v_n::text);
      else
        insert into diag73 values (45, 'COMO ELA · gravar titulo NOVO', 'ERRO: ' || sqlerrm);
      end if;
    end;

    execute 'reset role';
  else
    insert into diag73 values (40, 'COMO ELA', 'nao deu para testar: login dela nao vinculado');
  end if;

  -- 5. gatilhos
  select string_agg(tgrelid::regclass || '.' || tgname, ', ') into v_txt
    from pg_trigger where not tgisinternal
     and tgrelid in ('titulos'::regclass, 'parcelas'::regclass, 'credores'::regclass, 'lotes_produtividade'::regclass);
  insert into diag73 values (50, 'gatilhos em titulos/parcelas/credores/lotes', coalesce(v_txt, 'nenhum'));
  select string_agg(policyname || '(' || cmd || ')', ', ' order by policyname) into v_txt
    from pg_policies where tablename = 'titulos';
  insert into diag73 values (51, 'politicas em titulos', v_txt);
end $$;

select o_que, resultado from diag73 order by ordem;
