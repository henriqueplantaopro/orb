-- ERP Dom Pedro — as duas etapas pendentes, numa colagem só
-- Etapa 62: junta a 56 (v116) e a 61 (v118).
--
-- RODE NOS DOIS BANCOS, o real e o de testes. É seguro rodar mais
-- de uma vez, e rodar num banco que já recebeu uma das duas: tudo
-- aqui é `if not exists` ou `on conflict`.
--
-- O QUE CADA UMA RESOLVE
--
--   56 — a tabela `cargos` passa a ser GRAVADA pela tela do DP.
--   Toda tabela que a tela grava precisa da coluna `extra` em
--   jsonb: a gravação separa o que é coluna conhecida do que não é
--   e manda o resto para lá, para nenhum campo se perder quando o
--   sistema passa a ter um dado que o banco ainda não tem. Sem
--   ela, o cargo criado pelo botão "+ cadastrar" ficava só na
--   memória do navegador, e o funcionário que apontasse para ele
--   derrubava a gravação com
--
--     insert or update on table "funcionarios"
--     violates foreign key constraint "funcionarios_cargo_fkey"
--
--   61 — o contrato ganha FORMA DE PAGAMENTO e ANEXOS. A forma é
--   do contrato, não do credor: o mesmo hospital paga um contrato
--   por empenho e outro por boleto. Os anexos (contrato assinado,
--   proposta) vão para um balde PRIVADO do Supabase, alcançável só
--   por link assinado de curta duração.

-- ══════════════════════════════════════════════════════════════
-- ETAPA 56 · a coluna que faltava em `cargos`
-- ══════════════════════════════════════════════════════════════
alter table cargos
  add column if not exists extra jsonb not null default '{}'::jsonb;

comment on column cargos.extra is
  'Campos que a tela grava e o banco ainda nao tem como coluna propria.';

-- ══════════════════════════════════════════════════════════════
-- ETAPA 61 · forma de pagamento e anexos no contrato
-- ══════════════════════════════════════════════════════════════
--
-- `anexos` é jsonb pelo mesmo motivo que `itens` e `aditivos` já
-- são: é uma lista curta que só faz sentido junto do contrato.
alter table contratos add column if not exists forma_pagamento text;
alter table contratos add column if not exists anexos jsonb not null default '[]'::jsonb;

-- O balde é PRIVADO. Um balde público resolveria isto em uma linha
-- e deixaria contrato assinado e proposta comercial alcançáveis
-- para sempre por quem tivesse visto o endereço uma vez — inclusive
-- depois de a pessoa sair da empresa.
insert into storage.buckets (id, name, public)
values ('contratos', 'contratos', false)
on conflict (id) do update set public = false;

-- Quem VÊ contrato no sistema abre o anexo; quem MOVIMENTA anexa e
-- remove. É a mesma matriz que governa a tela — não há segunda
-- lista de permissão para manter.
drop policy if exists ct_arq_ler on storage.objects;
create policy ct_arq_ler on storage.objects
  for select using (bucket_id = 'contratos' and tem_nivel('contratos', 'V'));

drop policy if exists ct_arq_subir on storage.objects;
create policy ct_arq_subir on storage.objects
  for insert with check (bucket_id = 'contratos' and tem_nivel('contratos', 'M'));

drop policy if exists ct_arq_trocar on storage.objects;
create policy ct_arq_trocar on storage.objects
  for update using (bucket_id = 'contratos' and tem_nivel('contratos', 'M'));

drop policy if exists ct_arq_apagar on storage.objects;
create policy ct_arq_apagar on storage.objects
  for delete using (bucket_id = 'contratos' and tem_nivel('contratos', 'M'));

-- ══════════════════════════════════════════════════════════════
-- CONFERÊNCIA — uma única saída
-- ══════════════════════════════════════════════════════════════
--
-- O editor do Supabase mostra só o resultado da ÚLTIMA consulta.
-- Então tudo vai para uma tabela temporária e sai de uma vez.
drop table if exists diag;
create temp table diag (ordem int, o_que text, resultado text);

insert into diag values
  (10, 'ETAPA 56 · coluna extra em cargos',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'cargos' and column_name = 'extra')
            then 'sim' else 'NAO' end),
  (11, 'ETAPA 56 · politica de insercao em cargos',
       case when exists (select 1 from pg_policies
                          where tablename = 'cargos' and cmd = 'INSERT')
            then 'sim' else 'NAO — rode a etapa 02-rls.sql' end),
  (12, 'ETAPA 56 · cargos cadastrados hoje',
       (select count(*)::text from cargos)),

  (20, 'ETAPA 61 · coluna forma_pagamento em contratos',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'contratos' and column_name = 'forma_pagamento')
            then 'sim' else 'NAO' end),
  (21, 'ETAPA 61 · coluna anexos em contratos',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'contratos' and column_name = 'anexos')
            then 'sim' else 'NAO' end),
  (22, 'ETAPA 61 · balde contratos',
       coalesce((select case when public then 'existe, mas PUBLICO — PROBLEMA'
                             else 'existe, privado' end
                   from storage.buckets where id = 'contratos'), 'NAO EXISTE')),
  (23, 'ETAPA 61 · politicas do balde (esperado 4)',
       coalesce((select count(*)::text from pg_policies
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname like 'ct_arq_%'), '0')),
  (24, 'ETAPA 61 · contratos cadastrados hoje',
       (select count(*)::text from contratos)),

  (90, '>>> OS DOIS PRONTOS?',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'cargos' and column_name = 'extra')
             and exists (select 1 from information_schema.columns
                          where table_name = 'contratos' and column_name = 'anexos')
             and exists (select 1 from storage.buckets where id = 'contratos' and not public)
             and (select count(*) from pg_policies
                   where schemaname = 'storage' and tablename = 'objects'
                     and policyname like 'ct_arq_%') = 4
            then 'SIM' else 'NAO — veja as linhas acima' end);

select o_que, resultado from diag order by ordem, o_que;
