-- ══════════════════════════════════════════════════════════════════
-- ATUALIZAR v193 — extrato do Bradesco entrando inteiro
--
-- Rode UMA VEZ, no SQL Editor do Supabase do sistema real. Pode rodar
-- de novo sem estragar nada.
--
-- O QUE MUDA
--
-- O banco recusava duas linhas de extrato com o mesmo FITID na mesma
-- conta. O Bradesco não dá FITID fixo por lançamento: numera as linhas
-- de cada arquivo exportado (N10131, N10147…), e o arquivo do dia
-- seguinte repete a numeração. Lançamentos novos eram tratados como
-- "já importados".
--
-- O sistema agora reconhece a linha repetida pelo conteúdo (data,
-- valor e histórico). A trava de FITID único sai; fica um índice comum
-- para a busca continuar rápida. Nenhum dado é apagado ou alterado.
-- ══════════════════════════════════════════════════════════════════

drop index if exists linhas_extrato_banco_fitid_idx;

-- Se a trava tiver sido criada com outro nome, sai também.
do $$
declare i record;
begin
  for i in
    select indexname from pg_indexes
     where schemaname = 'public' and tablename = 'linhas_extrato'
       and indexdef ilike 'create unique index%' and indexdef ilike '%(banco, fitid)%'
  loop
    execute format('drop index if exists public.%I', i.indexname);
  end loop;
end $$;

create index if not exists linhas_extrato_banco_fitid_busca on linhas_extrato (banco, fitid);


-- ── CONFERÊNCIA (uma única saída) ─────────────────────────────────
select
  case when exists (select 1 from pg_indexes
                     where schemaname = 'public' and tablename = 'linhas_extrato'
                       and indexdef ilike 'create unique index%' and indexdef ilike '%fitid%')
       then 'NAO — ainda existe trava de FITID único'
       else 'SIM' end as "PRONTO PARA USAR?";
