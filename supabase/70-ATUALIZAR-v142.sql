-- ══════════════════════════════════════════════════════════════════
-- ATUALIZAR v142 — os documentos do faturamento
--
-- Rode UMA VEZ, no SQL Editor do Supabase, no projeto de produção.
-- Pode rodar de novo sem estragar nada: tudo aqui é refeito sem
-- duplicar.
--
-- O QUE ELE FAZ, E POR QUÊ:
--
-- A nota não vai sozinha para o cliente. Vai com a AF do órgão, o
-- relatório de escala, a medição assinada — e até agora esse
-- acompanhamento vivia no e-mail de quem montou o envio. A v142
-- guarda esses documentos no faturamento; este script cria o lugar
-- onde os ARQUIVOS ficam.
--
-- Nenhuma coluna nova é necessária: a lista de anexos e o texto da
-- discriminação vão para a coluna `extra` da tabela `previsoes`,
-- que já existe e já é usada assim pelo resto do sistema.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. o balde dos documentos do faturamento ──────────────────
--
-- PRIVADO, como o de contratos e o da habilitação. Um balde público
-- resolveria isto em uma linha e deixaria a medição do órgão e o
-- relatório de escala — que tem nome de médico e plantão — ao
-- alcance de qualquer um que tivesse visto o endereço uma vez.
insert into storage.buckets (id, name, public)
values ('faturamento', 'faturamento', false)
on conflict (id) do update set public = false;

-- Quem VÊ faturamento no sistema abre o documento; quem MOVIMENTA
-- anexa e remove. É a mesma matriz que governa a tela — não há uma
-- segunda lista de permissão para manter em dia.
drop policy if exists fat_arq_ler on storage.objects;
create policy fat_arq_ler on storage.objects
  for select using (bucket_id = 'faturamento' and tem_nivel('faturamento', 'V'));

drop policy if exists fat_arq_subir on storage.objects;
create policy fat_arq_subir on storage.objects
  for insert with check (bucket_id = 'faturamento' and tem_nivel('faturamento', 'M'));

drop policy if exists fat_arq_trocar on storage.objects;
create policy fat_arq_trocar on storage.objects
  for update using (bucket_id = 'faturamento' and tem_nivel('faturamento', 'M'));

drop policy if exists fat_arq_apagar on storage.objects;
create policy fat_arq_apagar on storage.objects
  for delete using (bucket_id = 'faturamento' and tem_nivel('faturamento', 'M'));


-- ── 2. CONFERÊNCIA (uma única saída) ──────────────────────────
--
-- O editor do Supabase mostra só o resultado da ÚLTIMA consulta.
-- Então tudo vai para uma tabela temporária e sai de uma vez.
drop table if exists diag;
create temp table diag (ordem int, o_que text, resultado text);

insert into diag values
  (10, 'coluna extra em previsoes (onde ficam o texto da NF e a lista de anexos)',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'previsoes' and column_name = 'extra')
            then 'sim' else 'NAO — rode antes o 33-coluna-extra.sql' end),
  (20, 'balde faturamento criado',
       coalesce((select case when public then 'sim, mas PUBLICO — PROBLEMA' else 'sim, privado' end
                   from storage.buckets where id = 'faturamento'), 'NAO')),
  (30, 'politicas do balde faturamento',
       coalesce((select string_agg(policyname, ', ' order by policyname)
                   from pg_policies
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname like 'fat_arq_%'), 'NENHUMA')),
  (40, 'previsoes ja lancadas',
       (select count(*)::text from previsoes)),
  (41, 'previsoes com texto de NF escrito a mao',
       (select count(*)::text from previsoes
         where coalesce(extra->>'discriminacao', '') <> '')),
  (42, 'previsoes com algum documento anexado',
       (select count(*)::text from previsoes
         where jsonb_array_length(coalesce(extra->'anexos', '[]'::jsonb)) > 0)),
  (90, '>>> PRONTO PARA USAR?',
       case when exists (select 1 from storage.buckets where id = 'faturamento' and not public)
             and (select count(*) from pg_policies
                   where schemaname = 'storage' and tablename = 'objects'
                     and policyname like 'fat_arq_%') = 4
            then 'SIM' else 'NAO — veja as linhas acima' end);

select o_que, resultado from diag order by ordem, o_que;
