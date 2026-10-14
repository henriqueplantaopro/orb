-- ERP Dom Pedro — atualização da v118
-- Etapa 61.
--
-- Duas coisas no cadastro de contrato:
--
--   FORMA DE PAGAMENTO. Ela é do CONTRATO, não do credor. O mesmo
--   hospital paga um contrato por empenho e outro por boleto, e é
--   no contrato que isso está escrito. Antes só existia no cadastro
--   do credor, que serve para a saída do dinheiro — e não dizia
--   nada sobre como o dinheiro ENTRA num contrato de cliente.
--
--   ANEXOS. O contrato assinado e a proposta passam a viver no
--   registro do contrato, e não numa pasta de rede que ninguém
--   encontra na hora da diligência. O arquivo fica num balde
--   PRIVADO do Supabase, alcançável só por link assinado de curta
--   duração; o que entra na tabela é o ponteiro para ele.
--
-- Rode nos DOIS bancos (real e testes).

-- ── 1. as duas colunas ────────────────────────────────────────
--
-- `anexos` é jsonb pelo mesmo motivo que `itens` e `aditivos` já
-- são: é uma lista curta que só faz sentido junto do contrato.
-- Tabela própria exigiria mapa de sincronização, políticas e um id
-- a mais para manter — custo que não se paga por meia dúzia de
-- arquivos por contrato.
alter table contratos add column if not exists forma_pagamento text;
alter table contratos add column if not exists anexos jsonb not null default '[]'::jsonb;

-- ── 2. o balde dos anexos ─────────────────────────────────────
--
-- PRIVADO, como o da habilitação. Um balde público resolveria isto
-- em uma linha e deixaria contrato assinado e proposta comercial
-- alcançáveis para sempre por quem tivesse visto o endereço uma
-- vez — inclusive depois de a pessoa sair da empresa.
insert into storage.buckets (id, name, public)
values ('contratos', 'contratos', false)
on conflict (id) do update set public = false;

-- Quem VÊ contrato no sistema abre o anexo; quem MOVIMENTA anexa;
-- apagar exige o nível de aprovação, porque o anexo pode ser a
-- única cópia do contrato assinado. É a mesma matriz que governa a
-- tela — não há segunda lista de permissão para manter.
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

-- ── 3. CONFERÊNCIA (uma única saída) ──────────────────────────
--
-- O editor do Supabase mostra só o resultado da ÚLTIMA consulta.
-- Então tudo vai para uma tabela temporária e sai de uma vez.
drop table if exists diag;
create temp table diag (ordem int, o_que text, resultado text);

insert into diag values
  (10, 'coluna forma_pagamento em contratos',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'contratos' and column_name = 'forma_pagamento')
            then 'sim' else 'NAO' end),
  (11, 'coluna anexos em contratos',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'contratos' and column_name = 'anexos')
            then 'sim' else 'NAO' end),
  (20, 'balde contratos criado',
       coalesce((select case when public then 'sim, mas PUBLICO — PROBLEMA' else 'sim, privado' end
                   from storage.buckets where id = 'contratos'), 'NAO')),
  (30, 'politicas do balde contratos',
       coalesce((select string_agg(policyname, ', ' order by policyname)
                   from pg_policies
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname like 'ct_arq_%'), 'NENHUMA')),
  (40, 'contratos ja cadastrados',
       (select count(*)::text from contratos)),
  (41, 'contratos com forma de pagamento informada',
       (select count(*)::text from contratos where coalesce(forma_pagamento, '') <> '')),
  (42, 'contratos com algum anexo',
       (select count(*)::text from contratos where jsonb_array_length(coalesce(anexos, '[]'::jsonb)) > 0)),
  (90, '>>> PRONTO PARA USAR?',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'contratos' and column_name = 'anexos')
             and exists (select 1 from storage.buckets where id = 'contratos' and not public)
             and (select count(*) from pg_policies
                   where schemaname = 'storage' and tablename = 'objects'
                     and policyname like 'ct_arq_%') = 4
            then 'SIM' else 'NAO — veja as linhas acima' end);

select o_que, resultado from diag order by ordem, o_que;
