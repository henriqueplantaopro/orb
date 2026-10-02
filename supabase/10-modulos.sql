-- ERP Dom Pedro — gravação dos demais módulos
-- Etapa 10. Roda depois dos anteriores.
--
-- O 06 preparou as tabelas do financeiro. Estas são as de estoque,
-- procedimentos, compras, ativos e pessoal, pelo mesmo critério: o
-- que se consulta tem coluna, o resto vai em `extra`.

alter table estoque_camadas           add column if not exists extra jsonb not null default '{}'::jsonb;
alter table estoque_movimentos        add column if not exists extra jsonb not null default '{}'::jsonb;
alter table procedimentos             add column if not exists extra jsonb not null default '{}'::jsonb;
alter table fechamentos_procedimentos add column if not exists extra jsonb not null default '{}'::jsonb;
alter table compras                   add column if not exists extra jsonb not null default '{}'::jsonb;
alter table ativos                    add column if not exists extra jsonb not null default '{}'::jsonb;
alter table ativo_movimentos          add column if not exists extra jsonb not null default '{}'::jsonb;
alter table ordens_servico            add column if not exists extra jsonb not null default '{}'::jsonb;
alter table lotes_produtividade       add column if not exists extra jsonb not null default '{}'::jsonb;
alter table lotes_rps                 add column if not exists extra jsonb not null default '{}'::jsonb;
alter table folhas                    add column if not exists extra jsonb not null default '{}'::jsonb;
alter table decimos                   add column if not exists extra jsonb not null default '{}'::jsonb;
alter table posicoes_estoque          add column if not exists extra jsonb not null default '{}'::jsonb;
alter table minimos_estoque           add column if not exists extra jsonb not null default '{}'::jsonb;

-- Conferência:
--   select count(*) from information_schema.columns
--    where column_name = 'extra' and table_schema = 'public';
--   -- esperado: 27

-- ── campo que faltou nos armazéns ──────────────────────
--
-- Cada sala de centro cirúrgico é ligada a uma especialidade, e é
-- isso que faz o sistema saber de qual estoque baixar o material da
-- cirurgia. A coluna não foi para o esquema, e o resultado foi o
-- módulo de Procedimentos calculando o repasse mas não deixando
-- lançar material nenhum — que é o ponto do módulo.
--
-- Mesmo caso do `pai` no plano de contas: campo que existia no
-- cadastro embutido e não foi transcrito.

alter table armazens add column if not exists especialidade text;

update armazens set especialidade = 'OFTALMO'        where id = 'am06' and especialidade is null;
update armazens set especialidade = 'CIRURGIA GERAL' where id = 'am07' and especialidade is null;
update armazens set especialidade = 'RISCO CX'       where id = 'am08' and especialidade is null;
update armazens set especialidade = 'UROLOGIA'       where id = 'am09' and especialidade is null;
update armazens set especialidade = 'OTORRINO'       where id = 'am10' and especialidade is null;
update armazens set especialidade = 'GINECO'         where id = 'am11' and especialidade is null;

-- Conferência:
--   select id, nome, especialidade from armazens where especialidade is not null;
--   -- esperado: 6 salas
