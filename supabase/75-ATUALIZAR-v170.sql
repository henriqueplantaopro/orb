-- ══════════════════════════════════════════════════════════════════
-- ATUALIZAR v170 — as despesas previstas passam a ter tabela própria
--
-- Rode UMA VEZ, no SQL Editor do Supabase, nos DOIS projetos (teste e
-- real). Pode rodar de novo sem estragar nada.
--
-- O QUE ELE CONSERTA
--
-- "Despesas previstas" (Financeiro › A pagar) nunca gravou no banco.
-- A previsão de despesa ia para a tabela `previsoes`, que é a do
-- FATURAMENTO: exige projeto e aceita uma só por projeto e mês. Sem
-- projeto, o banco recusava ("null value in column centro"); e o
-- título previsto que ela gera era recusado junto ("null value in
-- column itens"). Ficava tudo só na tela de quem lançou.
--
-- Aqui: a tabela `previsoes_despesa`, do módulo Financeiro (quem vê o
-- Financeiro lê; quem movimenta o Financeiro cria, altera e apaga —
-- previsão não é fato contábil, e excluir previsão é ação da tela).
-- Se alguma previsão de despesa tiver chegado a gravar na tabela do
-- faturamento, ela é MOVIDA para cá.
-- ══════════════════════════════════════════════════════════════════

create table if not exists previsoes_despesa (
  id            text primary key,
  conta         text,
  centro        text references centros (id),
  competencia   char(7) not null,
  data          date,
  valor         numeric(14,2) not null default 0,
  descricao     text,
  credor        text,
  serie         text,
  parcial       boolean not null default false,
  status        text not null default 'estimada',
  efetivada     boolean not null default false,
  valor_real    numeric(14,2),
  atualizado_em timestamptz,
  criado_por    text,
  criado_por_id text,
  criado_em     timestamptz not null default now(),
  extra         jsonb not null default '{}'::jsonb
);
create index if not exists previsoes_despesa_comp on previsoes_despesa (competencia);

grant select, insert, update, delete on previsoes_despesa to authenticated;

alter table previsoes_despesa enable row level security;
alter table previsoes_despesa force row level security;

drop policy if exists ver_previsoes_despesa    on previsoes_despesa;
drop policy if exists criar_previsoes_despesa  on previsoes_despesa;
drop policy if exists editar_previsoes_despesa on previsoes_despesa;
drop policy if exists apagar_previsoes_despesa on previsoes_despesa;
create policy ver_previsoes_despesa on previsoes_despesa
  for select using (tem_nivel('financeiro', 'V'));
create policy criar_previsoes_despesa on previsoes_despesa
  for insert with check (tem_nivel('financeiro', 'M'));
create policy editar_previsoes_despesa on previsoes_despesa
  for update using (tem_nivel('financeiro', 'M')) with check (tem_nivel('financeiro', 'M'));
create policy apagar_previsoes_despesa on previsoes_despesa
  for delete using (tem_nivel('financeiro', 'M') and tem_nivel('financeiro', 'V'));

-- Tempo real, como as outras tabelas de movimento.
do $$
begin
  execute 'alter publication supabase_realtime add table previsoes_despesa';
exception
  when duplicate_object then null;
  when undefined_object then raise notice 'sem publicação supabase_realtime, ignorado';
end $$;

-- Move o que tiver ficado na tabela do faturamento.
insert into previsoes_despesa (id, conta, centro, competencia, data, valor, descricao,
                               credor, serie, parcial, status, criado_por, extra)
select p.id,
       p.extra->>'conta',
       nullif(p.centro, ''),
       p.competencia,
       nullif(p.extra->>'data', '')::date,
       coalesce(nullif(p.extra->>'valor', '')::numeric, 0),
       p.extra->>'descricao',
       p.extra->>'credor',
       p.extra->>'serie',
       coalesce((p.extra->>'parcial')::boolean, false),
       coalesce(nullif(p.status, ''), 'estimada'),
       p.extra->>'criado_por',
       p.extra
  from previsoes p
 where p.extra->>'tipo' = 'despesa'
on conflict (id) do nothing;
delete from previsoes where extra->>'tipo' = 'despesa';

-- ── EXCLUIR A PREVISÃO TIRA O TÍTULO PREVISTO DELA ─────────────────
--
-- A regra de exclusão de parcela (v163) só deixa apagar parcela
-- PREVISTA e sem pagamento. Para saber "sem pagamento" ela consulta
-- `pagamentos` — e a regra de leitura de `pagamentos` da Produtividade
-- consulta `parcelas` de volta. O Postgres detecta o círculo e recusa
-- a exclusão inteira: "infinite recursion detected in policy for
-- relation parcelas". Medido: excluir uma previsão de despesa deixava
-- os 4 títulos previstos dela no banco.
--
-- A consulta de pagamento passa a ser feita por uma função que lê
-- `pagamentos` direto (como `tem_nivel` lê a matriz), sem passar pela
-- regra de leitura — e o círculo some. A condição é a mesma.
create or replace function parcela_tem_pagamento(pid text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from pagamentos where parcela_id = pid)
$$;
revoke all on function parcela_tem_pagamento(text) from public;
grant execute on function parcela_tem_pagamento(text) to authenticated;

drop policy if exists apagar_parcelas on parcelas;
create policy apagar_parcelas on parcelas
  for delete using (
    tem_nivel('financeiro', 'M')
    and tem_nivel('financeiro', 'V')
    and status = 'previsto'
    and not parcela_tem_pagamento(id)
  );

-- O Supabase passa a enxergar a tabela nova na hora.
notify pgrst, 'reload schema';

-- Conferência: a tabela existe, com as quatro políticas.
select policyname as politica, cmd as operacao
  from pg_policies
 where tablename = 'previsoes_despesa'
 order by policyname;
