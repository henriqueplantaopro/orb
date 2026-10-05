-- ERP Dom Pedro — chamados pelo QR da etiqueta
-- Etapa 28.
--
-- Quem está com o equipamento na mão quase nunca tem acesso ao
-- sistema: é o enfermeiro do plantão às duas da manhã com a máquina
-- parada. A etiqueta resolve isso — ele aponta a câmera e descreve
-- o problema, sem login e sem saber qual é o endereço do ERP.
--
-- A parte delicada não é a página, é esta política: deixar gravar
-- sem login SEM deixar ler. Quem abre a página pode criar um
-- chamado e nada mais — não lista chamados, não vê equipamento, não
-- descobre nenhum outro dado.

create table if not exists chamados (
  id            bigserial primary key,
  ativo         text references ativos (id),
  tag           text,
  descricao     text not null,
  contato_nome  text,
  contato_fone  text,
  urgencia      text default 'normal',
  local_informado text,
  situacao      text not null default 'aberto',
  atendido_por  text,
  atendido_em   timestamptz,
  resposta      text,
  criado_em     timestamptz not null default now(),
  /* Guardado para conter abuso: se alguém despejar chamados, dá
     para ver de onde veio e cortar. Não identifica pessoa. */
  origem        text
);
create index if not exists chamados_ativo_idx on chamados (ativo, situacao);
create index if not exists chamados_abertos_idx on chamados (situacao, criado_em desc);

alter table chamados enable row level security;

-- QUALQUER UM CRIA, com limites. A página é pública por desenho:
-- exigir login de quem está com o aparelho na mão anularia o
-- propósito da etiqueta.
drop policy if exists chamado_criar on chamados;
create policy chamado_criar on chamados
  for insert to anon, authenticated
  with check (
    /* Descrição real, não um toque acidental na tela, e com teto
       para ninguém usar o campo como depósito de texto. */
    length(btrim(descricao)) between 5 and 2000
    and length(coalesce(contato_nome, '')) <= 120
    and length(coalesce(contato_fone, '')) <= 40
    and length(coalesce(local_informado, '')) <= 200
    /* Nasce sempre aberto: quem cria não decide que já foi
       atendido. */
    and situacao = 'aberto'
    and atendido_por is null
    and resposta is null
  );

-- LER é outra coisa: só quem tem o módulo de ativos no sistema.
drop policy if exists chamado_ver on chamados;
create policy chamado_ver on chamados
  for select to authenticated
  using (tem_nivel('ativos', 'V'));

drop policy if exists chamado_atender on chamados;
create policy chamado_atender on chamados
  for update to authenticated
  using (tem_nivel('ativos', 'M'));

-- O anônimo NÃO lê, NÃO altera e NÃO apaga. Sem isto, bastaria
-- trocar o método na URL para listar tudo que já foi aberto.
revoke select, update, delete on chamados from anon;
grant insert on chamados to anon;
grant usage, select on sequence chamados_id_seq to anon;

-- A página precisa mostrar QUAL equipamento o QR identificou, sem
-- expor o resto do patrimônio. Esta visão devolve só isso.
drop view if exists ativo_etiqueta;
create view ativo_etiqueta as
  select id, tag, descricao, serie
    from ativos
   where coalesce(desmembrado, false) = false;

grant select on ativo_etiqueta to anon, authenticated;
revoke insert, update, delete on ativo_etiqueta from anon, authenticated;

-- Conferência (como anônimo, pela API):
--   GET  /rest/v1/chamados          → deve dar 401/403, nunca a lista
--   GET  /rest/v1/ativo_etiqueta?id=eq.at012-01 → 200, só tag e descrição
--   POST /rest/v1/chamados          → 201 com descrição de 5+ caracteres
