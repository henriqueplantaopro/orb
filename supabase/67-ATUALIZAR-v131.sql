-- ════════════════════════════════════════════════════════════════
-- ATUALIZAR v131 · a baixa da previsão de vale
--
-- POR QUE ESTA TABELA EXISTE
--
-- O vale não é pago ao funcionário: é pago à operadora do cartão,
-- contra boleto que chega depois. E o boleto não obedece ao
-- desenho do sistema — o vale-transporte vem em VÁRIOS boletos,
-- um por região, de operadoras diferentes; o vale-refeição vem num
-- só, de uma operadora que atende todas as filiais.
--
-- Não há como o sistema adivinhar que aqueles três títulos avulsos
-- são o VT daquele mês. Adivinhar daria falso positivo, e falso
-- positivo aqui faz despesa sumir do contas a pagar.
--
-- Então quem diz é a pessoa, por um botão na linha da previsão. A
-- baixa fica gravada aqui: benefício + competência, com quem
-- baixou e quando. Sem esta tabela a baixa viveria só na memória e
-- a previsão voltaria no próximo login.
--
-- Rodar duas vezes não faz mal.
--
-- RODE NO BANCO DO AMBIENTE QUE VOCÊ ESTÁ ATUALIZANDO.
-- ════════════════════════════════════════════════════════════════

create table if not exists vales_baixados (
  id             text primary key,
  -- 'vt' ou 'vr'. A trava fica no banco também, e não só na tela:
  -- o dia em que outro caminho gravar aqui, o Postgres recusa o
  -- que não for um dos dois em vez de guardar lixo em silêncio.
  beneficio      text not null check (beneficio in ('vt', 'vr')),
  competencia    char(7) not null,
  observacao     text,
  baixado_por    text,
  baixado_por_id text,
  baixado_em     timestamptz not null default now(),
  extra          jsonb not null default '{}'::jsonb,
  -- Um benefício só se baixa uma vez por mês. Dois cliques, ou
  -- duas pessoas ao mesmo tempo, não viram duas linhas.
  unique (beneficio, competencia)
);

comment on table vales_baixados is
  'Previsão de vale (VT/VR) que já foi resolvida: os boletos foram lançados ou a despesa foi paga.';

-- ── Quem pode ver e quem pode baixar ────────────────────────────
-- Ver: qualquer pessoa que já enxerga o contas a pagar, porque a
-- baixa explica uma linha que sumiu de lá.
-- Baixar e desfazer: quem lança no financeiro — é decisão sobre o
-- contas a pagar, não sobre a folha.
alter table vales_baixados enable row level security;

grant select, insert, update, delete on vales_baixados to authenticated;
revoke all on vales_baixados from anon;

drop policy if exists ver_vales_baixados on vales_baixados;
create policy ver_vales_baixados on vales_baixados
  for select to authenticated
  using (tem_nivel('financeiro', 'V'));

drop policy if exists mexer_vales_baixados on vales_baixados;
create policy mexer_vales_baixados on vales_baixados
  for all to authenticated
  using (tem_nivel('financeiro', 'M'))
  with check (tem_nivel('financeiro', 'M'));

-- ── Conferência ─────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables
     where table_name = 'vales_baixados') || ' de 1 tabela criada · ' ||
  (select count(*) from pg_policies
     where tablename = 'vales_baixados') || ' de 2 políticas · ' ||
  (select count(*) from vales_baixados) || ' baixa(s) registrada(s)'
  as diag;
