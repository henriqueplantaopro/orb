-- ══════════════════════════════════════════════════════════════════
-- ATUALIZAR v179 — arquivos das notas do contas a pagar no servidor
--
-- Rode UMA VEZ, no SQL Editor do Supabase, nos DOIS projetos (teste e
-- real). Pode rodar de novo sem estragar nada.
--
-- O QUE MUDA
--
-- Os XML e PDF das notas do contas a pagar passam a ficar no balde
-- privado `notas-pagar`, como já ficam os documentos do faturamento,
-- dos contratos e da habilitação. O título guarda só o caminho.
--
-- Antes, o arquivo anexado pela "Nota fiscal" ia inteiro (base64)
-- dentro do registro do título, e o lançamento guardava só o NOME do
-- arquivo — o conteúdo se perdia. Os anexos antigos que têm conteúdo
-- continuam abrindo e baixando normalmente; nada é apagado aqui.
--
-- Quem VÊ o financeiro baixa os arquivos; quem MOVIMENTA o financeiro
-- anexa, troca e remove. É a mesma matriz de acesso da tela.
-- ══════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('notas-pagar', 'notas-pagar', false)
on conflict (id) do update set public = false;

drop policy if exists npg_arq_ler on storage.objects;
create policy npg_arq_ler on storage.objects
  for select using (bucket_id = 'notas-pagar' and tem_nivel('financeiro', 'V'));

drop policy if exists npg_arq_subir on storage.objects;
create policy npg_arq_subir on storage.objects
  for insert with check (bucket_id = 'notas-pagar' and tem_nivel('financeiro', 'M'));

drop policy if exists npg_arq_trocar on storage.objects;
create policy npg_arq_trocar on storage.objects
  for update using (bucket_id = 'notas-pagar' and tem_nivel('financeiro', 'M'));

drop policy if exists npg_arq_apagar on storage.objects;
create policy npg_arq_apagar on storage.objects
  for delete using (bucket_id = 'notas-pagar' and tem_nivel('financeiro', 'M'));


-- ── CONFERÊNCIA (uma única saída) ─────────────────────────────────
drop table if exists diag;
create temp table diag (ordem int, o_que text, resultado text);

insert into diag values
  (10, 'balde notas-pagar criado',
       coalesce((select case when public then 'sim, mas PUBLICO — PROBLEMA' else 'sim, privado' end
                   from storage.buckets where id = 'notas-pagar'), 'NAO')),
  (20, 'politicas do balde notas-pagar',
       coalesce((select string_agg(policyname, ', ' order by policyname)
                   from pg_policies
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname like 'npg_arq_%'), 'NENHUMA')),
  (30, 'titulos com arquivo guardado no proprio registro (antigos, continuam valendo)',
       (select count(distinct titulo_id)::text from parcelas
         where coalesce(extra->'arquivo'->>'dados', extra->>'arquivo_dados', '') <> '')),
  (40, 'titulos com SO O NOME do arquivo (lancados antes da v179 — anexar de novo)',
       (select count(distinct titulo_id)::text from parcelas
         where jsonb_typeof(extra->'arquivo') = 'string'
           and coalesce(extra->>'arquivo_dados', '') = '')),
  (90, '>>> PRONTO PARA USAR?',
       case when exists (select 1 from storage.buckets where id = 'notas-pagar' and not public)
             and (select count(*) from pg_policies
                   where schemaname = 'storage' and tablename = 'objects'
                     and policyname like 'npg_arq_%') = 4
            then 'SIM' else 'NAO — veja as linhas acima' end);

select o_que, resultado from diag order by ordem, o_que;
