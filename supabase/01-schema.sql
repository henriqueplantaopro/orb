-- ERP Dom Pedro — esquema do banco (Supabase / Postgres)
-- Etapa 1 de 3: tabelas, tipos e chaves.
--   02-rls.sql  → políticas de acesso (a matriz, dentro do banco)
--   03-seed.sql → cadastros iniciais
--
-- Gerado a partir do estado do ERP teste2 - v30. Cada tabela aqui
-- corresponde a uma coleção do `store.js`, com os mesmos nomes de
-- campo — a migração do código fica mecânica, e conferir o que foi
-- para o banco contra o que existe na tela também.
--
-- DUAS DECISÕES DE DESENHO, registradas aqui porque custam caro de
-- mudar depois:
--
-- 1. ID TEXTO, não UUID. O sistema inteiro usa `p12`, `t45`, `cr3`,
--    inclusive nas referências gravadas dentro de JSON (rateio,
--    retenções, itens de contrato). Trocar por UUID agora obrigaria
--    a reescrever essas estruturas e a bateria de 1311 testes. O id
--    continua gerado pela aplicação, com a sequência no banco.
--
-- 2. JSONB para as listas de dentro do registro (rateio da parcela,
--    itens do contrato, aditivos, retenções). São lidas e gravadas
--    sempre junto com o pai, nunca consultadas isoladamente — virar
--    tabela traria junção sem ganho. O que PRECISA ser consultado
--    sozinho (pagamento, movimento de estoque, holerite) é tabela.

create extension if not exists "pgcrypto";

-- ── empresas, pessoas e cadastros ──────────────────────

create table empresas (
  id            text primary key,
  apelido       text not null,
  nome          text not null,
  cnpj          text not null unique,
  municipio     text,
  uf            char(2),
  codigo_ibge   text,
  inscricao_municipal text,
  matriz        boolean not null default false,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);

create table perfis (
  id            text primary key,
  nome          text not null,
  sistema       boolean not null default false,
  -- Ações finas que não derivam da matriz (estornar, cancelar,
  -- ver dados pessoais, admin).
  acoes         jsonb not null default '[]'::jsonb,
  criado_em     timestamptz not null default now()
);

-- A matriz de acesso: perfil × módulo → níveis 'VMFA'.
-- Uma linha por cruzamento, em vez de um JSON por perfil, porque as
-- políticas de RLS consultam isto a cada consulta e precisam de
-- índice.
create table matriz_acesso (
  perfil        text not null references perfis (id) on delete cascade,
  modulo        text not null,
  niveis        text not null default '',
  primary key (perfil, modulo)
);

-- Usuário do sistema. O login em si vive em auth.users (Supabase);
-- aqui fica o vínculo com o perfil e o nome que aparece na trilha.
create table usuarios (
  id            text primary key,
  auth_id       uuid unique references auth.users (id) on delete set null,
  nome          text not null,
  email         text unique,
  perfil        text not null references perfis (id),
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);

create table centros (
  id            text primary key,
  curto         text,
  codigo        text,
  nome          text not null,
  tipo          text not null,            -- projeto | administrativo | ...
  unidade       text,
  cidade        text,
  uf            char(2),
  cnpj          text,
  empresa       text references empresas (id),
  cliente       text,
  grupo_faturamento text,
  especialidade_pate text,
  impostos      jsonb,
  ativo         boolean not null default true,
  extra         jsonb not null default '{}'::jsonb
);
create index on centros (tipo, ativo);
create index on centros (empresa);

create table clientes (
  id            text primary key,
  nome          text not null,
  documento     text,
  centro_padrao text references centros (id),
  prazo_dias    int,
  endereco      text, numero text, bairro text, cidade text, uf char(2), cep text,
  email         text,
  ativo         boolean not null default true,
  extra         jsonb not null default '{}'::jsonb
);

create table credores (
  id            text primary key,
  nome          text not null,
  tipo          text,                      -- fornecedor | medico | funcionario
  documento     text,
  conta_padrao  text,
  forma_pagamento text,
  pix           text,
  tipo_chave    text,
  banco         text, agencia text, conta text,
  dados_aprovados boolean not null default false,
  ativo         boolean not null default true,
  extra         jsonb not null default '{}'::jsonb
);
create index on credores (tipo, ativo);

create table bancos (
  id            text primary key,
  empresa       text not null references empresas (id),
  apelido       text not null,
  banco         text,
  agencia       text, agencia_dv text, conta text, conta_dv text,
  layout_remessa text,
  convenio      text,
  saldo_inicial numeric(14,2) not null default 0,
  saldo_inicial_em date,
  ativo         boolean not null default true
);

create table plano_contas (
  cod           text primary key,
  nome          text not null,
  nivel         int not null,
  -- O tipo (receita | deducao | custo | despesa) existe SÓ nas
  -- contas de nível 1. É nelas que o DRE se apoia: ele monta os
  -- grupos com `plano.filter(nivel === 1)` e lê o tipo de cada
  -- grupo. A conta filha herda o tipo do pai pelo primeiro dígito
  -- do código — 1.02 é receita porque 1 é receita.
  --
  -- Duplicar o tipo nas 51 filhas criaria duas fontes para o mesmo
  -- fato: bastaria alguém marcar 6.07 como "receita" para o DRE
  -- passar a somar despesa administrativa na receita bruta, sem
  -- nada acusar. Melhor não ter o campo do que tê-lo podendo
  -- divergir.
  tipo          text,
  -- Mas no nível 1 ele é obrigatório: grupo sem tipo é grupo que
  -- some do DRE em silêncio.
  constraint tipo_no_grupo check (nivel <> 1 or tipo is not null),
  constraint tipo_valido check (
    tipo is null or tipo in ('receita', 'deducao', 'custo', 'despesa', 'nao_operacional')
  )
);

-- ── contas a pagar ─────────────────────────────────────

create table titulos (
  id            text primary key,
  descricao     text not null,
  credor        text references credores (id),
  doc           text,
  tipo_titulo   text,
  emissao       date,
  origem        text,
  origem_ref    text,
  obs           text,
  valor_total   numeric(14,2) not null,
  valor_bruto   numeric(14,2),             -- bruto da NF, para a conservação
  qtd           int not null default 1,
  empresa_tomadora text references empresas (id),
  criado_por    text, criado_por_id text references usuarios (id),
  criado_em     timestamptz not null default now()
);
create index on titulos (origem_ref);
create index on titulos (credor);

create table parcelas (
  id            text primary key,
  titulo_id     text not null references titulos (id) on delete cascade,
  num           int not null,
  total         int not null,
  descricao     text,
  credor        text references credores (id),
  conta         text references plano_contas (cod),
  centro        text references centros (id),
  rateio        jsonb not null default '[]'::jsonb,
  tipo_titulo   text,
  emissao       date,
  comp          char(7),                   -- AAAA-MM
  venc          date not null,
  valor         numeric(14,2) not null check (valor > 0),
  status        text not null,             -- aberto|pago|previsto|substituido|cancelado...
  valor_pago    numeric(14,2) not null default 0,
  pago_em       date,
  aprovacao     text,
  aprovado_por  text, aprovado_em timestamptz,
  motivo        text, origem text, doc text, obs text,
  chave         text,
  retencoes     jsonb,
  valor_retido  numeric(14,2) not null default 0,
  itens         jsonb not null default '[]'::jsonb,
  criado_por    text, criado_por_id text references usuarios (id),
  criado_em     timestamptz not null default now()
);
create index on parcelas (status, venc);
create index on parcelas (centro, comp);
create index on parcelas (titulo_id);

create table pagamentos (
  id            text primary key,
  parcela_id    text not null references parcelas (id) on delete cascade,
  data          date not null,
  valor         numeric(14,2) not null,
  juros         numeric(14,2) not null default 0,
  multa         numeric(14,2) not null default 0,
  desconto      numeric(14,2) not null default 0,
  banco         text references bancos (id),
  empresa       text references empresas (id),
  cruzamento    jsonb,                     -- conta corrente entre empresas
  doc           text, obs text,
  forma         text, forma_codigo text,
  situacao      text not null,             -- aguardando|autorizado|liquidado
  estornado     boolean not null default false,
  usuario       text, usuario_id text references usuarios (id),
  criado_em     timestamptz not null default now()
);
create index on pagamentos (parcela_id);
create index on pagamentos (data, situacao);

create table retencoes_registradas (
  id            text primary key,
  titulo_id     text not null references titulos (id) on delete cascade,
  tributo       text not null,
  valor         numeric(14,2) not null,
  competencia   char(7),
  conta         text,
  municipio     text,
  guia_id       text,
  cancelada     boolean not null default false
);
create index on retencoes_registradas (tributo, competencia, cancelada);

create table guias_retencao (
  id            text primary key,
  tributo       text not null,
  competencia   char(7) not null,
  municipio     text,
  conta         text,
  por_conta     jsonb,
  titulo_id     text references titulos (id),
  total         numeric(14,2) not null,
  criado_em     timestamptz not null default now()
);

-- ── contas a receber e faturamento ─────────────────────

create table receber (
  id            text primary key,
  numero        text,
  serie         text,
  nf_chave      text unique,
  codigo_verificacao text,
  emissao       date,
  competencia   char(7),
  vencimento    date,
  centro        text references centros (id),
  rateio_centros jsonb,
  grupo_faturamento text,
  empresa       text references empresas (id),
  cliente       text references clientes (id),
  cliente_doc   text, cliente_nome text,
  discriminacao text,
  origem        text not null,             -- nota|fatura|avulso|previsao
  status        text not null,
  valor_bruto   numeric(14,2) not null,
  valor_retido  numeric(14,2) not null default 0,
  valor_liquido numeric(14,2) not null,
  glosa_prevista numeric(14,2) not null default 0,
  glosa_real    numeric(14,2),
  valor_recebido numeric(14,2) not null default 0,
  recebido_em   date,
  baixas        jsonb not null default '[]'::jsonb,
  retencoes     jsonb,
  substitui     jsonb,
  abatimentos   jsonb,
  conferir      text,
  observacao    text,
  criado_em     timestamptz not null default now()
);
create index on receber (competencia, origem, status);
create index on receber (centro, competencia);
create index on receber (emissao);

create table previsoes (
  id            text primary key,
  centro        text not null references centros (id),
  competencia   char(7) not null,
  faturamento   numeric(14,2) not null default 0,
  produtividade numeric(14,2) not null default 0,
  status        text not null,
  observacao    text,
  confirmado_por text, confirmado_em timestamptz,
  autorizado_em date, autorizado_por text, autorizado_por_id text,
  autorizacao_protocolo text,
  autorizacao_obs text,
  autorizado_valor numeric(14,2),
  autorizacoes_anteriores jsonb not null default '[]'::jsonb,
  liberado_em   date, liberado_por text,
  unique (centro, competencia)
);

create table contratos (
  id            text primary key,
  parte         text not null default 'cliente',
  numero        text not null,
  tipo          text,
  cliente       text references clientes (id),
  objeto        text, processo text,
  vigencia_ini  date, vigencia_fim date,
  renovacao     text, indice text, reajuste_mes text,
  itens         jsonb not null default '[]'::jsonb,
  aditivos      jsonb not null default '[]'::jsonb,
  valor_mensal  numeric(14,2),
  encerrado     boolean not null default false,
  atualizado_em timestamptz
);
create index on contratos (parte, encerrado);

create table lotes_rps (
  id            text primary key,
  remessa       text not null,
  competencia   char(7),
  rps           jsonb not null default '[]'::jsonb,
  status        text,
  protocolo     text,
  cancelado     boolean not null default false,
  criado_em     timestamptz not null default now()
);
create unique index on lotes_rps (remessa) where not cancelado;

-- ── conciliação bancária ───────────────────────────────

create table extratos (
  id            text primary key,
  banco         text not null references bancos (id),
  arquivo       text,
  de            date, ate date,
  importado_em  timestamptz not null default now(),
  usuario_id    text references usuarios (id)
);

create table linhas_extrato (
  id            text primary key,
  extrato_id    text references extratos (id) on delete cascade,
  banco         text not null references bancos (id),
  data          date not null,
  valor         numeric(14,2) not null,
  memo          text,
  fitid         text,
  saida         boolean not null,
  situacao      text not null default 'pendente',  -- pendente|conciliado|ignorado
  alvo_tipo     text,
  alvo_id       text,
  alvo_ids      jsonb,
  observacao    text
);
create index on linhas_extrato (banco, situacao);
create unique index on linhas_extrato (banco, fitid) where fitid is not null;

create table saldos_informados (
  id            text primary key,
  banco         text not null references bancos (id),
  data          date not null,
  valor         numeric(14,2) not null,
  divergencia   numeric(14,2),
  usuario_id    text references usuarios (id),
  criado_em     timestamptz not null default now()
);

create table transferencias_banco (
  id            text primary key,
  origem        text not null references bancos (id),
  destino       text not null references bancos (id),
  data          date not null,
  valor         numeric(14,2) not null check (valor > 0),
  obs           text,
  mutuo         jsonb,                     -- devedora/credora quando cruza CNPJ
  cancelada     boolean not null default false,
  motivo_cancelamento text,
  criado_em     timestamptz not null default now()
);

create table regras_conciliacao (
  id            text primary key,
  padrao        text not null,
  conta         text references plano_contas (cod),
  centro        text references centros (id),
  credor        text references credores (id),
  ativo         boolean not null default true
);

-- ── estoque e compras ──────────────────────────────────

create table produtos (
  id            text primary key,
  codigo        text,
  descricao     text not null,
  unidade       text,
  ncm           text,
  minimo        numeric(12,3), ideal numeric(12,3),
  custo         numeric(14,4),
  conta         text references plano_contas (cod),
  ativo         boolean not null default true
);

create table armazens (
  id            text primary key,
  codigo        text,
  nome          text not null,
  centro        text references centros (id),
  tipo          text,
  pai           text references armazens (id),
  responsavel   text,
  ativo         boolean not null default true
);

-- Posição atual: saldo e valor por produto/armazém. Mantida pela
-- aplicação a cada movimento, como hoje — o invariante
-- "valor = saldo × médio" é testado pela bateria.
create table posicoes_estoque (
  produto       text not null references produtos (id),
  armazem       text not null references armazens (id),
  saldo         numeric(14,3) not null default 0,
  valor         numeric(14,2) not null default 0 check (valor >= -0.011),
  primary key (produto, armazem)
);

-- Camadas de entrada (lote, validade, custo de aquisição).
create table estoque_camadas (
  id            text primary key,
  produto       text not null references produtos (id),
  armazem       text not null references armazens (id),
  qtd           numeric(14,3) not null,
  custo         numeric(14,4) not null,
  data          date not null,
  data_nf       date,
  lote          text, validade date,
  origem        text, documento text,
  nota_chave    text, pedido_id text,
  grupo         text,
  lancado_em    timestamptz not null default now()
);
create index on estoque_camadas (produto, armazem);

create table estoque_movimentos (
  id            text primary key,
  tipo          text not null,             -- entrada|saida|transferencia|ajuste
  produto       text not null references produtos (id),
  armazem       text not null references armazens (id),
  qtd           numeric(14,3) not null,
  qtd_nota      numeric(14,3),
  unidades_por_embalagem numeric(12,3),
  custo         numeric(14,4),
  custo_nota    numeric(14,4),
  valor         numeric(14,2),
  medio_depois  numeric(14,4),
  data          date not null,
  data_nf       date,
  motivo        text, documento text,
  lote text, validade date,
  origem text, grupo text, pedido_id text,
  -- Nome de paciente é dado de saúde: fica em coluna própria para a
  -- RLS poder mascará-la sem esconder o movimento inteiro.
  paciente      text,
  estornado     boolean not null default false,
  usuario       text, usuario_id text references usuarios (id),
  lancado_em    timestamptz not null default now()
);
create index on estoque_movimentos (produto, armazem, data);
create index on estoque_movimentos (grupo);

create table minimos_estoque (
  produto       text not null references produtos (id),
  armazem       text not null references armazens (id),
  minimo        numeric(12,3),
  ideal         numeric(12,3),
  primary key (produto, armazem)
);

create table compras (
  id            text primary key,
  numero        text,
  armazem       text references armazens (id),
  centro        text references centros (id),
  status        text not null,
  credor        text references credores (id),
  itens         jsonb not null default '[]'::jsonb,
  historico     jsonb not null default '[]'::jsonb,
  compra_aprovada_por text,
  criado_em     timestamptz not null default now()
);
create index on compras (status);

-- ── procedimentos (mutirão) ────────────────────────────

create table procedimentos (
  id            text primary key,
  data          date not null,
  competencia   char(7) not null,
  centro        text not null references centros (id),
  especialidade text,
  procedimento  text,
  procedimento_nome text,
  medico        text not null,
  -- Dado de saúde, como o paciente do estoque.
  paciente      text,
  qtd           int not null default 1,
  faturamento   numeric(14,2) not null default 0,
  repasse       numeric(14,2) not null default 0,
  custo_material numeric(14,2) not null default 0,
  imposto       numeric(14,2) not null default 0,
  imposto_pct   numeric(7,4),
  resultado     numeric(14,2),
  armazem       text references armazens (id),
  materiais     jsonb not null default '[]'::jsonb,
  transferencias jsonb,
  grupo         text,
  financeiro    text,
  cancelado     boolean not null default false,
  motivo_cancelamento text,
  editado_por   text,
  usuario_id    text references usuarios (id),
  criado_em     timestamptz not null default now()
);
create index on procedimentos (competencia, centro, cancelado);
create index on procedimentos (data);

create table fechamentos_procedimentos (
  id            text primary key,
  competencia   char(7) not null,
  centro        text not null references centros (id),
  faturamento   numeric(14,2) not null,
  repasse       numeric(14,2) not null,
  procedimento_ids jsonb not null default '[]'::jsonb,
  titulo_ids    jsonb not null default '[]'::jsonb,
  cancelado     boolean not null default false,
  criado_por    text, criado_em timestamptz not null default now()
);
create index on fechamentos_procedimentos (competencia, cancelado);

create table lotes_produtividade (
  id            text primary key,
  centro        text references centros (id),
  competencia   char(7) not null,
  arquivo       text,
  titulo_ids    jsonb not null default '[]'::jsonb,
  medicos       int, valor numeric(14,2),
  confirmado    boolean not null default false,
  confirmado_por text, confirmado_em timestamptz,
  cancelado     boolean not null default false,
  cancelado_parcial boolean not null default false,
  criado_por    text, criado_em timestamptz not null default now()
);

-- ── pessoal ────────────────────────────────────────────
-- Tabelas com dado pessoal sensível: a RLS abaixo restringe por
-- perfil, e o sigilo salarial é tratado lá, não aqui.

create table cargos (
  id            text primary key,
  nome          text not null,
  cbo           text,
  salario_piso  numeric(14,2)
);

create table funcionarios (
  id            text primary key,
  matricula     text,
  nome          text not null,
  cpf           text,
  pis           text,
  nascimento    date,
  admissao      date not null,
  desligamento  date,
  cargo         text references cargos (id),
  tipo_contrato text,
  salario_base  numeric(14,2) not null,
  jornada_semanal_horas numeric(5,2),
  centro        text references centros (id),
  rateio        jsonb,
  dependentes   jsonb not null default '[]'::jsonb,
  dependentes_irrf int not null default 0,
  insalubridade_pct numeric(5,2),
  periculosidade boolean not null default false,
  vale_transporte boolean not null default false,
  vt_dia numeric(10,2), vt_desconto_modo text, vt_desconto_valor numeric(10,2),
  vale_refeicao boolean not null default false,
  vr_dia numeric(10,2),
  pensao_alimenticia jsonb,
  ferias        jsonb not null default '[]'::jsonb,
  dados_pagamento jsonb,
  dados_aprovados boolean not null default false,
  ativo         boolean not null default true,
  extra         jsonb not null default '{}'::jsonb
);

create table folhas (
  id            text primary key,
  competencia   char(7) not null,
  complementar  boolean not null default false,
  holerites     jsonb not null default '[]'::jsonb,
  total_proventos numeric(14,2),
  total_descontos numeric(14,2),
  total_liquido numeric(14,2),
  guias         jsonb,
  cancelada     boolean not null default false,
  fechada_por   text, fechada_em timestamptz not null default now()
);
create index on folhas (competencia, cancelada);

create table decimos (
  id            text primary key,
  funcionario   text not null references funcionarios (id),
  ano           char(4) not null,
  parcela       int not null,
  valor         numeric(14,2) not null,
  pago_em       date,
  cancelado     boolean not null default false,
  unique (funcionario, ano, parcela)
);

-- ── ativos ─────────────────────────────────────────────

create table ativos (
  id            text primary key,
  tag           text,
  categoria     text,
  descricao     text not null,
  qtd           int not null default 1,
  valor         numeric(14,2) not null,
  aquisicao     date,
  status        text,
  condicao      text,
  local         text,
  projeto       text references centros (id),
  projeto_nome  text,
  fornecedor_nome text,
  nf            text,
  custodiante   text,
  contrato      text references contratos (id),
  valor_locacao numeric(14,2),
  vida_util_meses int,
  desmembrado   boolean not null default false,
  lote_origem   text references ativos (id),
  baixa         jsonb,
  observacao    text
);
create index on ativos (projeto);

create table ativo_movimentos (
  id            text primary key,
  ativo         text not null references ativos (id) on delete cascade,
  data          date not null,
  status        text,
  origem        text, destino text,
  motivo        text,
  usuario_id    text references usuarios (id),
  criado_em     timestamptz not null default now()
);

create table ordens_servico (
  id            text primary key,
  ativo         text not null references ativos (id),
  tipo          text,
  descricao     text,
  abertura      date not null,
  fechamento    date,
  custo         numeric(14,2),
  custo_peca    numeric(14,2),
  custo_servico numeric(14,2),
  fornecedor    text references credores (id),
  laudo         jsonb,
  status        text not null default 'aberta'
);

-- ── parâmetros e trilha ────────────────────────────────

-- Chave/valor para os parâmetros do sistema (alçadas, tabelas de
-- INSS e IRRF, feriados, imposto do procedimento). Uma linha por
-- grupo, em JSONB: são lidos inteiros e mudam raramente.
create table parametros (
  chave         text primary key,
  valor         jsonb not null,
  atualizado_por text,
  atualizado_em timestamptz not null default now()
);

-- Trilha de auditoria. Append-only: a RLS abaixo não dá update nem
-- delete a ninguém, nem ao admin.
create table eventos (
  id            bigserial primary key,
  entidade      text not null,
  entidade_id   text,
  acao          text not null,
  detalhe       text,
  usuario_id    text references usuarios (id),
  usuario       text,
  em            timestamptz not null default now()
);
create index on eventos (entidade, entidade_id);
create index on eventos (em desc);

-- Sequência dos ids da aplicação (p12, t45...). Uma linha só.
create table sequencia (
  id            int primary key default 1 check (id = 1),
  valor         bigint not null default 1
);
insert into sequencia (id, valor) values (1, 1);

create or replace function proximo_id(prefixo text)
returns text language plpgsql as $$
declare n bigint;
begin
  update sequencia set valor = valor + 1 where id = 1 returning valor into n;
  return prefixo || n::text;
end $$;
