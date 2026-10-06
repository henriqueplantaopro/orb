-- ERP Dom Pedro — materiais padrão por procedimento
-- Etapa 31.
--
-- Toda facoemulsificação usa uma lente; toda colecistectomia
-- videolaparoscópica usa clipes. Fazer quem lança escolher isso do
-- zero a cada cirurgia é pedir esquecimento — e material esquecido
-- não é custo que some: é custo que aparece no inventário seguinte
-- como diferença sem explicação.
--
-- O padrão entra como SUGESTÃO, já marcada, e quem lança ajusta. O
-- que ele não pode é esquecer.
--
-- A FAMÍLIA é o que resolve o caso da lente: a tabela não sabe
-- qual grau foi usado, e não deveria. Ela diz "uma lente
-- intraocular" e a tela pede a específica na hora.

create table if not exists materiais_padrao (
  id            bigserial primary key,
  procedimento  text not null,          -- id da tabela de procedimentos
  produto       text,                   -- material exato, quando não varia
  familia       text,                   -- ou a família, quando varia (lente por grau)
  qtd           numeric not null default 1,
  obrigatorio   boolean not null default true,
  observacao    text,
  criado_em     timestamptz not null default now(),
  /* Um dos dois tem de estar preenchido: sem produto nem família,
     a linha não diz o que usar. */
  check (produto is not null or familia is not null)
);
create index if not exists materiais_padrao_proc on materiais_padrao (procedimento);

alter table materiais_padrao enable row level security;

drop policy if exists mp_ver on materiais_padrao;
create policy mp_ver on materiais_padrao
  for select to authenticated using (tem_nivel('procedimentos', 'V'));

drop policy if exists mp_mexer on materiais_padrao;
create policy mp_mexer on materiais_padrao
  for all to authenticated using (tem_nivel('cadastros', 'M'))
  with check (tem_nivel('cadastros', 'M'));

-- A FAMÍLIA no cadastro de produto: é ela que agrupa "Lente
-- intraocular +18,0" e "+21,5" sob um nome só na tela de estoque.
alter table produtos add column if not exists familia text;
create index if not exists produtos_familia on produtos (familia);

-- Conferência:
--   select * from materiais_padrao order by procedimento;
--   select familia, count(*) from produtos where familia is not null group by familia;
