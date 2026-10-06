-- ERP Dom Pedro — MONTAR O AMBIENTE DE TESTE DO ZERO
--
-- Cole este arquivo inteiro no SQL Editor do projeto de TESTE e
-- rode uma vez. Ele monta a estrutura completa e carrega os dados
-- de demonstração.
--
-- ATENÇÃO: é para o banco de TESTE. Ele cria tabelas do zero e
-- popula com dados fictícios — no banco real, misturaria
-- demonstração com dado de verdade. Confira o nome do projeto no
-- alto da tela do Supabase antes de colar.
--
-- A ORDEM AQUI IMPORTA, e foi ela que falhou na primeira versão: o
-- seed já usa colunas que as etapas posteriores acrescentam (a
-- hierarquia do plano de contas, por exemplo). Então as colunas
-- extras entram ANTES do seed, não depois.
--
--   1. as 43 tabelas
--   2. as políticas de acesso
--   3. as colunas que as etapas 06 a 27 acrescentam — aqui, porque
--      o seed depende delas
--   4. os dados de demonstração
--   5. ajustes de coluna e revogações
--
-- DEPOIS deste arquivo, rode o ATUALIZAR-TUDO.sql: ele traz as
-- funções, as visões e as travas. Dois arquivos, nesta ordem.




-- ====================================================================
-- 1 e 2 — ESTRUTURA E POLÍTICAS
-- ====================================================================

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

-- ERP Dom Pedro — Row Level Security
-- Etapa 2 de 3. Depende de 01-schema.sql.
--
-- POR QUE ISTO EXISTE, e não só a checagem na tela: o navegador fala
-- direto com o Postgres pela API do Supabase. Esconder o botão não
-- esconde o dado — quem abrir o console e pedir `select * from
-- folhas` recebe a folha inteira se o banco deixar. A matriz de
-- acesso precisa valer AQUI.
--
-- Três coisas que o banco protege e a tela sozinha não protegeria:
--   · salário e dados bancários de funcionário (sigilo da folha);
--   · nome de paciente, que é dado de saúde (LGPD, art. 5º, II);
--   · a trilha de auditoria, que ninguém pode alterar nem apagar.

-- ── funções de apoio ───────────────────────────────────

-- Quem está pedindo, no vocabulário do ERP.
create or replace function app_usuario()
returns text language sql stable security definer as $$
  select id from usuarios where auth_id = auth.uid() and ativo
$$;

create or replace function app_perfil()
returns text language sql stable security definer as $$
  select perfil from usuarios where auth_id = auth.uid() and ativo
$$;

-- O nível do perfil no módulo: 'V', 'M', 'F' (financeiro) ou 'A'.
create or replace function tem_nivel(modulo text, nivel char)
returns boolean language sql stable security definer as $$
  select coalesce(
    (select position(nivel in niveis) > 0
       from matriz_acesso
      where perfil = app_perfil() and matriz_acesso.modulo = tem_nivel.modulo),
    false)
$$;

-- Ações finas que não vêm da matriz (ver dados pessoais, ver
-- pacientes, estornar, cancelar, admin).
create or replace function tem_acao(acao text)
returns boolean language sql stable security definer as $$
  select coalesce(
    (select p.acoes ? acao
       from perfis p join usuarios u on u.perfil = p.id
      where u.auth_id = auth.uid()),
    false)
$$;

-- ── liga a RLS em tudo ─────────────────────────────────
-- Sem política, nega. É o padrão do Postgres e é o que queremos:
-- tabela nova nasce fechada até alguém decidir quem vê.

-- A `sequencia` entra junto. Ela parece infraestrutura, não dado, e
-- foi por isso que ficou de fora numa primeira versão — mas é o
-- contador que gera os ids do sistema: com a chave pública e sem
-- login, alterá-la bagunçaria a numeração de tudo. Ela fica SEM
-- política nenhuma, o que no Postgres significa negado para todos;
-- quem precisa dela é a função `proximo_id`, que roda como dona.
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- ── cadastros: quem vê o módulo, lê; quem movimenta, escreve ──

-- Um par de políticas por módulo, montado por laço para não haver
-- divergência entre tabelas do mesmo módulo.
do $$
declare
  -- O mapa é um literal JSON: comentário aqui dentro invalida o
  -- valor inteiro e aborta o bloco, deixando o banco SEM RLS
  -- nenhuma. Por isso as observações ficam todas fora das aspas.
  --
  -- `funcionarios` e `folhas` NÃO estão no mapa, de propósito.
  -- Políticas de RLS se somam por OU: a política ampla que o laço
  -- cria anularia a restritiva escrita depois — foi o que deixou a
  -- Contabilidade lendo CPF, salário e conta bancária. As duas têm
  -- política própria mais abaixo, exigindo `ver_dados_pessoais`.
  mapa jsonb := '{
    "financeiro":    ["titulos","parcelas","pagamentos","retencoes_registradas","guias_retencao",
                      "extratos","linhas_extrato","saldos_informados","transferencias_banco",
                      "regras_conciliacao"],
    "faturamento":   ["receber","previsoes","lotes_rps"],
    "contratos":     ["contratos"],
    "estoque":       ["produtos","armazens","posicoes_estoque","estoque_camadas",
                      "estoque_movimentos","minimos_estoque"],
    "compras":       ["compras"],
    "procedimentos": ["procedimentos","fechamentos_procedimentos"],
    "produtividade": ["lotes_produtividade"],
    "ativos":        ["ativos","ativo_movimentos","ordens_servico"],
    "dp":            ["decimos","cargos"],
    "cadastros":     ["centros","clientes","credores","bancos","plano_contas","empresas"]
  }'::jsonb;
  modulo text;
  tabela text;
begin
  for modulo in select jsonb_object_keys(mapa) loop
    for tabela in select jsonb_array_elements_text(mapa -> modulo) loop
      execute format($f$
        create policy %I on %I for select using (tem_nivel(%L, 'V'));
      $f$, 'ver_' || tabela, tabela, modulo);
      execute format($f$
        create policy %I on %I for insert with check (tem_nivel(%L, 'M'));
      $f$, 'criar_' || tabela, tabela, modulo);
      execute format($f$
        create policy %I on %I for update using (tem_nivel(%L, 'M'))
          with check (tem_nivel(%L, 'M'));
      $f$, 'editar_' || tabela, tabela, modulo, modulo);
      -- DELETE não é dado a ninguém: o sistema cancela e estorna,
      -- nunca apaga. Quem precisar expurgar usa a service key, fora
      -- da aplicação, com registro.
    end loop;
  end loop;
end $$;

-- ── pessoal: sigilo salarial dentro do próprio módulo ──
--
-- Ter o módulo de Pessoal não é o mesmo que poder ver CPF, conta
-- bancária e dependentes. A ação fina `ver_dados_pessoais` separa as
-- duas coisas, como já acontece na tela.

-- `funcionarios` e `folhas` só se abrem para quem tem a ação
-- `ver_dados_pessoais`. É onde moram CPF, PIS, salário e conta
-- bancária — e o holerite, que é a mesma informação por outro
-- caminho. Fechar o cadastro e deixar a folha aberta não protege
-- nada.
--
-- Consequência registrada: a Contabilidade (perfil `consulta`) tem
-- o módulo mas não a ação, então perde as duas. Se o escritório
-- precisar da folha para escriturar, o caminho é a exportação, não
-- o acesso à tabela.
create policy ver_funcionario_completo on funcionarios
  for select using (tem_nivel('dp', 'V') and tem_acao('ver_dados_pessoais'));
create policy mexer_funcionario on funcionarios
  for all using (tem_nivel('dp', 'M') and tem_acao('ver_dados_pessoais'))
  with check (tem_nivel('dp', 'M') and tem_acao('ver_dados_pessoais'));

create policy ver_folhas on folhas
  for select using (tem_nivel('dp', 'V') and tem_acao('ver_dados_pessoais'));
create policy mexer_folhas on folhas
  for all using (tem_nivel('dp', 'M') and tem_acao('ver_dados_pessoais'))
  with check (tem_nivel('dp', 'M') and tem_acao('ver_dados_pessoais'));

-- Quem tem o módulo de Pessoal mas não a ação usa esta visão: dá a
-- lista de gente (escala, alocação, quem está ativo) sem nenhum dado
-- sensível. Ela roda como DONA (`security_invoker = false`), porque
-- sob a RLS da tabela não devolveria nada — e por isso o filtro de
-- acesso precisa estar escrito aqui dentro.
create view funcionarios_publico
  with (security_invoker = false) as
  select id, matricula, nome, cargo, centro, admissao, desligamento, ativo
    from funcionarios
   where tem_nivel('dp', 'V');

revoke all on funcionarios_publico from anon;
grant select on funcionarios_publico to authenticated;

-- O próprio funcionário vê o que é dele, quando tiver login.
create policy ver_meu_cadastro on funcionarios
  for select using (
    exists (select 1 from usuarios u
             where u.auth_id = auth.uid() and u.id = funcionarios.id)
  );

-- ── paciente é dado de saúde ───────────────────────────
--
-- O movimento de estoque e o procedimento continuam visíveis para
-- quem tem o módulo — o que a ação `ver_pacientes` controla é o
-- NOME. Como RLS é por linha e não por coluna, a aplicação consulta
-- estas visões; o acesso direto à tabela fica com quem tem a ação.

create view estoque_movimentos_visivel
  with (security_invoker = true) as
  select m.id, m.tipo, m.produto, m.armazem, m.qtd, m.custo, m.valor,
         m.medio_depois, m.data, m.motivo, m.documento, m.lote, m.validade,
         m.origem, m.grupo, m.estornado, m.usuario, m.lancado_em,
         case when tem_acao('ver_pacientes') then m.paciente else null end as paciente
    from estoque_movimentos m;

create view procedimentos_visivel
  with (security_invoker = true) as
  select p.id, p.data, p.competencia, p.centro, p.especialidade,
         p.procedimento, p.procedimento_nome, p.medico, p.qtd,
         p.armazem, p.materiais, p.transferencias, p.grupo, p.financeiro,
         p.cancelado, p.criado_em,
         case when tem_acao('ver_pacientes') then p.paciente else null end as paciente,
         -- Valor só para quem tem $ no módulo, como na tela.
         case when tem_nivel('procedimentos', 'F') then p.faturamento end as faturamento,
         case when tem_nivel('procedimentos', 'F') then p.repasse end as repasse,
         case when tem_nivel('procedimentos', 'F') then p.custo_material end as custo_material,
         case when tem_nivel('procedimentos', 'F') then p.imposto end as imposto,
         case when tem_nivel('procedimentos', 'F') then p.resultado end as resultado
    from procedimentos p;

-- ── administração ──────────────────────────────────────

create policy ver_usuarios on usuarios
  for select using (tem_nivel('administracao', 'V') or auth_id = auth.uid());
create policy mexer_usuarios on usuarios
  for all using (tem_nivel('administracao', 'M'))
  with check (tem_nivel('administracao', 'M'));

-- Perfis e matriz são lidos por qualquer usuário AUTENTICADO (a tela
-- precisa saber o que mostrar), nunca por quem só tem a chave
-- pública: juntas, as duas tabelas desenham a estrutura de poder da
-- empresa. As funções `tem_nivel` e `tem_acao` não dependem destas
-- políticas — rodam como donas.
create policy ver_perfis on perfis
  for select using (app_usuario() is not null);
create policy mexer_perfis on perfis
  for all using (tem_nivel('administracao', 'M'))
  with check (tem_nivel('administracao', 'M'));

-- A matriz é lida por todo mundo (as funções acima dependem dela) e
-- escrita só pela Administração.
create policy ver_matriz on matriz_acesso
  for select using (app_usuario() is not null);
create policy mexer_matriz on matriz_acesso
  for all using (tem_nivel('administracao', 'M'))
  with check (tem_nivel('administracao', 'M'));

-- Parâmetros guardam alçadas de aprovação e tabelas de INSS e IRRF:
-- configuração, não segredo, mas não é coisa que se leia da rua.
create policy ver_parametros on parametros
  for select using (app_usuario() is not null);
create policy mexer_parametros on parametros
  for all using (tem_nivel('administracao', 'M') or tem_acao('dp'))
  with check (tem_nivel('administracao', 'M') or tem_acao('dp'));

-- ── trilha de auditoria: append-only ───────────────────
--
-- Qualquer um que use o sistema escreve evento; ninguém altera nem
-- apaga, inclusive o admin. Trilha que o próprio administrador pode
-- reescrever não serve de trilha.

create policy ver_eventos on eventos
  for select using (tem_nivel('administracao', 'V') or tem_acao('admin'));
create policy gravar_eventos on eventos
  for insert with check (app_usuario() is not null);
-- sem política de update e de delete: negado para todos.

-- ── a função que gera id roda como dona ────────────────
-- Com a `sequencia` fechada para todos, `proximo_id` precisa ser
-- SECURITY DEFINER para funcionar — e só responde a quem está
-- autenticado.

create or replace function proximo_id(prefixo text)
returns text language plpgsql security definer as $$
declare n bigint;
begin
  if app_usuario() is null then
    raise exception 'sem usuário autenticado';
  end if;
  update sequencia set valor = valor + 1 where id = 1 returning valor into n;
  return prefixo || n::text;
end $$;

-- `from anon` não subtrai nada: o Postgres concede EXECUTE a PUBLIC
-- por padrão, e revogar de um papel específico não tira o que veio
-- de PUBLIC. Tem de ser `from public`.
-- `from public` tira o que o Postgres concede por padrão, mas o
-- Supabase também dá concessão PRÓPRIA a `anon` pelos default
-- privileges — e revogar de public não mexe nela. Precisa dos dois.
-- (A guarda de dentro da função já barra quem não está autenticado;
-- isto é o cinto além do suspensório.)
revoke all on function proximo_id(text) from public, anon;
grant execute on function proximo_id(text) to authenticated;

-- ── nota sobre o que a RLS NÃO faz ─────────────────────
--
-- A RLS decide QUEM LÊ E ESCREVE. Ela não aplica regra de negócio:
-- a conservação de valor no estoque, a conferência de saldo no
-- pagamento, o INSS por competência e a segregação de aprovação
-- continuam no `store.js`, onde estão testadas por 1311 verificações.
--
-- Isso significa que a aplicação continua sendo o caminho normal de
-- escrita. A RLS é a rede embaixo: impede que alguém com o token do
-- navegador contorne a tela e escreva direto onde não deveria.


-- ====================================================================
-- 3 — COLUNAS QUE O SEED PRECISA
--      (as mesmas das etapas 06 a 27, antecipadas)
-- ====================================================================

alter table titulos                 add column if not exists extra jsonb not null default '{}'::jsonb;
alter table parcelas                add column if not exists extra jsonb not null default '{}'::jsonb;
alter table pagamentos              add column if not exists extra jsonb not null default '{}'::jsonb;
alter table receber                 add column if not exists extra jsonb not null default '{}'::jsonb;
alter table previsoes               add column if not exists extra jsonb not null default '{}'::jsonb;
alter table contratos               add column if not exists extra jsonb not null default '{}'::jsonb;
alter table retencoes_registradas   add column if not exists extra jsonb not null default '{}'::jsonb;
alter table guias_retencao          add column if not exists extra jsonb not null default '{}'::jsonb;
alter table transferencias_banco    add column if not exists extra jsonb not null default '{}'::jsonb;
alter table extratos                add column if not exists extra jsonb not null default '{}'::jsonb;
alter table linhas_extrato          add column if not exists extra jsonb not null default '{}'::jsonb;
alter table saldos_informados       add column if not exists extra jsonb not null default '{}'::jsonb;
alter table regras_conciliacao      add column if not exists extra jsonb not null default '{}'::jsonb;
alter table eventos add column if not exists app_id text;
alter table plano_contas add column if not exists pai text references plano_contas (cod);
alter table usuarios add column if not exists senha_provisoria boolean not null default false;
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
alter table armazens add column if not exists especialidade text;
alter table fechamentos_procedimentos
  add column if not exists motivo_cancelamento text,
  add column if not exists cancelado_em date,
  add column if not exists cancelado_por text,
  add column if not exists refaz text;
alter table lotes_produtividade
  add column if not exists motivo_cancelamento text,
  add column if not exists cancelado_em date,
  add column if not exists cancelado_por text;
alter table folhas
  add column if not exists motivo_cancelamento text,
  add column if not exists cancelado_em date,
  add column if not exists cancelado_por text;
alter table centros
  add column if not exists cliente text,
  add column if not exists tipo_servico text,
  add column if not exists grupo_faturamento text,
  add column if not exists prev_faturamento numeric default 0,
  add column if not exists prev_repasse numeric default 0,
  add column if not exists produtividade boolean default false,
  add column if not exists retencao_pct numeric default 0,
  add column if not exists impostos jsonb default '{}'::jsonb,
  add column if not exists prazo_dias int,
  add column if not exists codigo_hospital text,
  add column if not exists unidade text;
alter table clientes
  add column if not exists centro_padrao text,
  add column if not exists prazo_dias int,
  add column if not exists retencoes jsonb default '[]'::jsonb;


-- ====================================================================
-- 4 — DADOS DE DEMONSTRAÇÃO
-- ====================================================================

-- ERP Dom Pedro — cadastros iniciais (etapa 3).
-- Gerado do dados.js da v31 (matriz e perfis já com as decisões
-- de 02/10). Os LANÇAMENTOS de exemplo não entram: o banco
-- nasce com cadastro, não com movimento.
--
-- RODA ANTES do 02-rls.sql. O `force row level security` vale
-- até para o dono da tabela; só não morde porque o papel do
-- Supabase tem BYPASSRLS. Semear antes de ligar a RLS funciona
-- nos dois casos.

-- empresas
insert into empresas (id,apelido,nome,cnpj,municipio,uf,codigo_ibge,inscricao_municipal,matriz,ativo) values ('emp1','HJM Matriz','HJM DOM PEDRO GESTAO E SERVICOS EM SAUDE LTDA','34.958.609/0001-90','BARUERI','SP','3505708','5BX8969',true,true);
insert into empresas (id,apelido,nome,cnpj,municipio,uf,codigo_ibge,inscricao_municipal,matriz,ativo) values ('emp2','HJM Filial CE','HJM DOM PEDRO GESTAO E SERVICOS EM SAUDE LTDA','34.958.609/0003-51','FORTALEZA','CE','2304400','',false,true);
insert into empresas (id,apelido,nome,cnpj,municipio,uf,codigo_ibge,inscricao_municipal,matriz,ativo) values ('emp3','Novaped','NOVAPED PROFISSIONAIS ESPECIALIZADOS DE SAUDE LTDA','34.015.981/0001-62','','','','',false,true);

-- perfis
insert into perfis (id,nome,sistema,acoes) values ('assistente','Assistente financeiro',true,'["lancar","pagar","faturar","ver_custo","estoque","requisitar","comprar","receber","autorizar_faturamento","ver_dados_pessoais"]'::jsonb);
insert into perfis (id,nome,sistema,acoes) values ('diretoria','Diretoria',true,'["lancar","pagar","aprovar","cancelar","estornar","faturar","ver_custo","estoque","requisitar","comprar","aprovar_compra","receber","dp","ver_dados_pessoais","ver_pacientes","autorizar_faturamento","liberar_faturamento","baixar_ativo"]'::jsonb);
insert into perfis (id,nome,sistema,acoes) values ('socio','Sócio',true,'["lancar","pagar","aprovar","cancelar","estornar","faturar","ver_custo","estoque","requisitar","comprar","aprovar_compra","receber","dp","ver_dados_pessoais","ver_pacientes","autorizar_faturamento","liberar_faturamento","baixar_ativo"]'::jsonb);
insert into perfis (id,nome,sistema,acoes) values ('admin','Administração',true,'["lancar","pagar","aprovar","cancelar","estornar","faturar","ver_custo","estoque","requisitar","comprar","aprovar_compra","receber","dp","ver_dados_pessoais","ver_pacientes","baixar_ativo","autorizar_faturamento","liberar_faturamento","admin"]'::jsonb);
insert into perfis (id,nome,sistema,acoes) values ('consulta','Consulta',true,'["ver_custo"]'::jsonb);
insert into perfis (id,nome,sistema,acoes) values ('estoquista','Controle de estoque',false,'["estoque","requisitar","receber","ver_pacientes"]'::jsonb);
insert into perfis (id,nome,sistema,acoes) values ('comprador','Compras',false,'["requisitar","comprar","receber","estoque"]'::jsonb);
insert into perfis (id,nome,sistema,acoes) values ('operacional','Operacional — centro cirúrgico',false,'["estoque","ver_pacientes"]'::jsonb);
insert into perfis (id,nome,sistema,acoes) values ('dp','Departamento Pessoal',false,'["dp","ver_dados_pessoais"]'::jsonb);
insert into perfis (id,nome,sistema,acoes) values ('produtividade_dir','Diretoria de produtividade',false,'["produtividade","lancar","faturar","autorizar_faturamento","ver_custo","receber"]'::jsonb);
insert into perfis (id,nome,sistema,acoes) values ('produtividade_ger','Gerência de produtividade',false,'["produtividade","lancar","faturar","autorizar_faturamento","ver_custo","receber"]'::jsonb);

-- matriz de acesso: perfil × módulo → níveis VMFA
insert into matriz_acesso (perfil,modulo,niveis) values ('assistente','financeiro','VMF');
insert into matriz_acesso (perfil,modulo,niveis) values ('assistente','produtividade','VMF');
insert into matriz_acesso (perfil,modulo,niveis) values ('assistente','estoque','VF');
insert into matriz_acesso (perfil,modulo,niveis) values ('assistente','ativos','VMF');
insert into matriz_acesso (perfil,modulo,niveis) values ('assistente','faturamento','VMF');
insert into matriz_acesso (perfil,modulo,niveis) values ('assistente','compras','VMF');
insert into matriz_acesso (perfil,modulo,niveis) values ('assistente','contratos','VMF');
insert into matriz_acesso (perfil,modulo,niveis) values ('assistente','dp','VF');
insert into matriz_acesso (perfil,modulo,niveis) values ('assistente','cadastros','VM');
insert into matriz_acesso (perfil,modulo,niveis) values ('assistente','procedimentos','VF');
insert into matriz_acesso (perfil,modulo,niveis) values ('assistente','administracao','V');
insert into matriz_acesso (perfil,modulo,niveis) values ('diretoria','financeiro','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('diretoria','produtividade','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('diretoria','estoque','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('diretoria','ativos','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('diretoria','faturamento','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('diretoria','compras','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('diretoria','contratos','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('diretoria','dp','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('diretoria','cadastros','VMA');
insert into matriz_acesso (perfil,modulo,niveis) values ('diretoria','procedimentos','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('diretoria','administracao','VM');
insert into matriz_acesso (perfil,modulo,niveis) values ('socio','financeiro','VFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('socio','produtividade','VFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('socio','estoque','VFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('socio','ativos','VFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('socio','faturamento','VFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('socio','compras','VFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('socio','contratos','VFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('socio','dp','VFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('socio','cadastros','VA');
insert into matriz_acesso (perfil,modulo,niveis) values ('socio','procedimentos','VFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('socio','administracao','VM');
insert into matriz_acesso (perfil,modulo,niveis) values ('admin','financeiro','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('admin','produtividade','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('admin','estoque','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('admin','ativos','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('admin','faturamento','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('admin','compras','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('admin','contratos','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('admin','dp','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('admin','cadastros','VMA');
insert into matriz_acesso (perfil,modulo,niveis) values ('admin','procedimentos','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('admin','administracao','VMA');
insert into matriz_acesso (perfil,modulo,niveis) values ('consulta','financeiro','VF');
insert into matriz_acesso (perfil,modulo,niveis) values ('consulta','produtividade','VF');
insert into matriz_acesso (perfil,modulo,niveis) values ('consulta','estoque','VF');
insert into matriz_acesso (perfil,modulo,niveis) values ('consulta','ativos','VF');
insert into matriz_acesso (perfil,modulo,niveis) values ('consulta','faturamento','VF');
insert into matriz_acesso (perfil,modulo,niveis) values ('consulta','compras','VF');
insert into matriz_acesso (perfil,modulo,niveis) values ('consulta','contratos','VF');
insert into matriz_acesso (perfil,modulo,niveis) values ('consulta','dp','VF');
insert into matriz_acesso (perfil,modulo,niveis) values ('consulta','cadastros','V');
insert into matriz_acesso (perfil,modulo,niveis) values ('consulta','procedimentos','VF');
insert into matriz_acesso (perfil,modulo,niveis) values ('consulta','administracao','');
insert into matriz_acesso (perfil,modulo,niveis) values ('estoquista','financeiro','');
insert into matriz_acesso (perfil,modulo,niveis) values ('estoquista','produtividade','');
insert into matriz_acesso (perfil,modulo,niveis) values ('estoquista','estoque','VM');
insert into matriz_acesso (perfil,modulo,niveis) values ('estoquista','ativos','VM');
insert into matriz_acesso (perfil,modulo,niveis) values ('estoquista','faturamento','');
insert into matriz_acesso (perfil,modulo,niveis) values ('estoquista','compras','VM');
insert into matriz_acesso (perfil,modulo,niveis) values ('estoquista','contratos','');
insert into matriz_acesso (perfil,modulo,niveis) values ('estoquista','dp','');
insert into matriz_acesso (perfil,modulo,niveis) values ('estoquista','cadastros','V');
insert into matriz_acesso (perfil,modulo,niveis) values ('estoquista','procedimentos','VM');
insert into matriz_acesso (perfil,modulo,niveis) values ('estoquista','administracao','');
insert into matriz_acesso (perfil,modulo,niveis) values ('comprador','financeiro','');
insert into matriz_acesso (perfil,modulo,niveis) values ('comprador','produtividade','');
insert into matriz_acesso (perfil,modulo,niveis) values ('comprador','estoque','VM');
insert into matriz_acesso (perfil,modulo,niveis) values ('comprador','ativos','V');
insert into matriz_acesso (perfil,modulo,niveis) values ('comprador','faturamento','');
insert into matriz_acesso (perfil,modulo,niveis) values ('comprador','compras','VMF');
insert into matriz_acesso (perfil,modulo,niveis) values ('comprador','contratos','');
insert into matriz_acesso (perfil,modulo,niveis) values ('comprador','dp','');
insert into matriz_acesso (perfil,modulo,niveis) values ('comprador','cadastros','V');
insert into matriz_acesso (perfil,modulo,niveis) values ('comprador','procedimentos','');
insert into matriz_acesso (perfil,modulo,niveis) values ('comprador','administracao','');
insert into matriz_acesso (perfil,modulo,niveis) values ('dp','financeiro','');
insert into matriz_acesso (perfil,modulo,niveis) values ('dp','produtividade','');
insert into matriz_acesso (perfil,modulo,niveis) values ('dp','estoque','');
insert into matriz_acesso (perfil,modulo,niveis) values ('dp','ativos','');
insert into matriz_acesso (perfil,modulo,niveis) values ('dp','faturamento','');
insert into matriz_acesso (perfil,modulo,niveis) values ('dp','compras','');
insert into matriz_acesso (perfil,modulo,niveis) values ('dp','contratos','');
insert into matriz_acesso (perfil,modulo,niveis) values ('dp','dp','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('dp','cadastros','V');
insert into matriz_acesso (perfil,modulo,niveis) values ('dp','procedimentos','');
insert into matriz_acesso (perfil,modulo,niveis) values ('dp','administracao','');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_dir','financeiro','');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_dir','produtividade','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_dir','estoque','');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_dir','ativos','VF');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_dir','faturamento','VMF');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_dir','compras','');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_dir','contratos','VMF');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_dir','dp','');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_dir','cadastros','V');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_dir','procedimentos','VFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_dir','administracao','');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_ger','financeiro','');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_ger','produtividade','VMFA');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_ger','estoque','');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_ger','ativos','');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_ger','faturamento','VMF');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_ger','compras','');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_ger','contratos','VMF');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_ger','dp','');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_ger','cadastros','V');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_ger','procedimentos','V');
insert into matriz_acesso (perfil,modulo,niveis) values ('produtividade_ger','administracao','');
insert into matriz_acesso (perfil,modulo,niveis) values ('operacional','financeiro','');
insert into matriz_acesso (perfil,modulo,niveis) values ('operacional','produtividade','');
insert into matriz_acesso (perfil,modulo,niveis) values ('operacional','estoque','VM');
insert into matriz_acesso (perfil,modulo,niveis) values ('operacional','ativos','');
insert into matriz_acesso (perfil,modulo,niveis) values ('operacional','faturamento','');
insert into matriz_acesso (perfil,modulo,niveis) values ('operacional','compras','');
insert into matriz_acesso (perfil,modulo,niveis) values ('operacional','contratos','');
insert into matriz_acesso (perfil,modulo,niveis) values ('operacional','dp','');
insert into matriz_acesso (perfil,modulo,niveis) values ('operacional','cadastros','');
insert into matriz_acesso (perfil,modulo,niveis) values ('operacional','procedimentos','VM');
insert into matriz_acesso (perfil,modulo,niveis) values ('operacional','administracao','');

-- usuários (o login vem por convite, no painel do Supabase)
insert into usuarios (id,nome,perfil,ativo) values ('u1','Dayana (assist. financeiro)','assistente',true);
insert into usuarios (id,nome,perfil,ativo) values ('u2','Márcia (diretora financeira)','diretoria',true);
insert into usuarios (id,nome,perfil,ativo) values ('u3','Fellype (sócio)','socio',true);
insert into usuarios (id,nome,perfil,ativo) values ('u4','Contabilidade (consulta)','consulta',true);
insert into usuarios (id,nome,perfil,ativo) values ('u5','Administrador','admin',true);
insert into usuarios (id,nome,perfil,ativo) values ('u6','Monique Cardoso (estoque)','estoquista',true);
insert into usuarios (id,nome,perfil,ativo) values ('u7','Compras (a definir)','comprador',true);
insert into usuarios (id,nome,perfil,ativo) values ('u8','Carol (DP)','dp',true);
insert into usuarios (id,nome,perfil,ativo) values ('u9','Romário (assist. financeiro)','assistente',true);
insert into usuarios (id,nome,perfil,ativo) values ('u10','David (sócio)','socio',true);
insert into usuarios (id,nome,perfil,ativo) values ('u11','Bianca (diretoria de produtividade)','produtividade_dir',true);
insert into usuarios (id,nome,perfil,ativo) values ('u12','Monique Almeida (gerência de produtividade)','produtividade_ger',true);
insert into usuarios (id,nome,perfil,ativo) values ('u13','Operacional HGB (centro cirúrgico)','operacional',true);

-- plano de contas (tipo só no nível 1; pai liga a conta ao grupo)
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('1','Receita operacional',1,'receita',null);
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('1.01','Serviços médicos',2,null,'1');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('1.02','Locação de equipamentos',2,null,'1');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('1.03','Outras receitas',2,null,'1');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('1.04','Alienação de imobilizado',2,null,'1');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('2','Impostos de venda',1,'deducao',null);
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('2.01','ISS',2,null,'2');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('2.02','PIS',2,null,'2');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('2.03','COFINS',2,null,'2');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('2.04','IRPJ',2,null,'2');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('2.05','CSLL',2,null,'2');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('2.06','ICMS',2,null,'2');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('2.07','Parcelamentos de impostos',2,null,'2');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('2.08','Outros impostos',2,null,'2');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('3','Custos diretos',1,'custo',null);
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('3.01','Serviços médicos — produção',2,null,'3');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('3.02','Custos de locações',2,null,'3');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('3.03','Outros custos diretos',2,null,'3');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('4','Despesas com pessoal',1,'despesa',null);
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('4.01','Folha de pagamento',2,null,'4');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('4.02','Benefícios',2,null,'4');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('4.03','FGTS',2,null,'4');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('4.04','INSS',2,null,'4');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('4.05','Férias',2,null,'4');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('4.06','13º salário',2,null,'4');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('4.07','Rescisões',2,null,'4');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('4.08','Outros encargos',2,null,'4');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('5','Despesas com P&D',1,'despesa',null);
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('5.01','Desenvolvimento de software — telemedicina',2,null,'5');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('6','Despesas administrativas',1,'despesa',null);
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('6.01','Aluguéis',2,null,'6');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('6.02','Certificações',2,null,'6');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('6.03','Honorários contábeis',2,null,'6');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('6.04','Honorários de consultoria',2,null,'6');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('6.05','Despesas com viagens',2,null,'6');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('6.06','Reembolsos',2,null,'6');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('6.07','Manutenção e conservação',2,null,'6');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('6.08','Segurança e rastreamento',2,null,'6');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('6.09','Cartão corporativo',2,null,'6');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('6.10','Ativo fixo',2,null,'6');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('6.11','Outros',2,null,'6');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('7','Tecnologia da informação',1,'despesa',null);
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('7.01','Sistemas de gestão (ERP)',2,null,'7');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('7.02','Software médico',2,null,'7');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('7.03','Sistemas / TI',2,null,'7');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('7.04','Telecomunicações',2,null,'7');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('8','Despesas operacionais',1,'despesa',null);
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('8.01','Locação de veículos',2,null,'8');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('8.02','Financiamentos',2,null,'8');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('8.03','Energia elétrica',2,null,'8');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('8.04','Material médico-hospitalar',2,null,'8');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('8.05','Frete e logística',2,null,'8');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('8.06','Outros',2,null,'8');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('9','Despesas financeiras',1,'despesa',null);
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('9.01','Despesa bancária',2,null,'9');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('9.02','Empréstimos e financiamentos',2,null,'9');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('9.03','Encargos financeiros',2,null,'9');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('9.04','Juros de atraso',2,null,'9');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('10','Aportes e retiradas',1,'nao_operacional',null);
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('10.01','Retiradas de sócios',2,null,'10');
insert into plano_contas (cod,nome,nivel,tipo,pai) values ('10.02','Aportes de sócios',2,null,'10');

-- centros de custo e projetos
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('cc100','Matriz SP','100','Matriz — Barueri/SP','matriz',null,'Barueri','SP','34958609000190',null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('cc200','Filial RJ','200','Filial — Petrópolis/RJ','filial',null,'Petrópolis','RJ',null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('cc300','Filial CE','300','Filial — Fortaleza/CE','filial',null,'Fortaleza','CE',null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('cc900','Geral','900','Geral (sem projeto)','geral',null,null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj01','PRISIONAL','001','PRISIONAL','projeto','Fortaleza',null,null,null,null,'cl08',null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj02','CIDH','002','CIDH','projeto','Fortaleza',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj03','CDERM','003','CDERM','projeto','Fortaleza',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj04','CCAD','004','CCAD','projeto','Fortaleza',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj05','HSMM','005','HSMM','projeto','Fortaleza',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj06','HEMOCE','006','HEMOCE','projeto','Fortaleza',null,null,null,null,'cl07',null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj07','IJF','007','IJF','projeto','Fortaleza',null,null,null,null,'cl06',null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj08','SCFORT - Tomografia','008','SCFORT - Tomografia','projeto','Fortaleza',null,null,null,null,'cl05',null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj09','GHC - UPA','009','GHC - UPA','projeto','POA',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj10','GHC - ANESTESIA POA','010','GHC - ANESTESIA POA','projeto','GHC - Anestesia POA',null,null,null,null,'cl04',null,null,false);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj11','GHC - HGB ANESTESIA','011','GHC - HGB — Anestesia','projeto','Bonsucesso',null,null,null,null,'cl03','GHC - HGB',null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj44','GHC - HGB CARDIOLOGIA','044','GHC - HGB — Cardiologia','projeto','Bonsucesso',null,null,null,null,null,'GHC - HGB',null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj45','GHC - HGB CTI PEDIATRICA','045','GHC - HGB — CTI Pediátrica','projeto','Bonsucesso',null,null,null,null,null,'GHC - HGB',null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj46','GHC - HGB EMERGENCIA ADULTO','046','GHC - HGB — Emergência adulto','projeto','Bonsucesso',null,null,null,null,null,'GHC - HGB',null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj47','GHC - HGB EMERGENCIA PEDIATRICA','047','GHC - HGB — Emergência pediátrica','projeto','Bonsucesso',null,null,null,null,null,'GHC - HGB',null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj48','GHC - HGB MEDICINA INTERNA','048','GHC - HGB — Medicina interna','projeto','Bonsucesso',null,null,null,null,null,'GHC - HGB',null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj49','GHC - HGB CORONARIANA','049','GHC - HGB — Coronariana','projeto','Bonsucesso',null,null,null,null,null,'GHC - HGB',null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj50','GHC - HGB MUTIRAO','050','GHC - HGB — Mutirão','projeto','Bonsucesso',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj51','HGB MUTIRAO OFTALMO','050.1','GHC - HGB Mutirão — Oftalmologia','projeto','Bonsucesso',null,null,null,null,null,'GHC - HGB MUTIRAO','OFTALMO',true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj52','HGB MUTIRAO CIR GERAL','050.2','GHC - HGB Mutirão — Cirurgia geral','projeto','Bonsucesso',null,null,null,null,null,'GHC - HGB MUTIRAO','CIRURGIA GERAL',true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj53','HGB MUTIRAO UROLOGIA','050.3','GHC - HGB Mutirão — Urologia','projeto','Bonsucesso',null,null,null,null,null,'GHC - HGB MUTIRAO','UROLOGIA',true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj54','HGB MUTIRAO OTORRINO','050.4','GHC - HGB Mutirão — Otorrinolaringologia','projeto','Bonsucesso',null,null,null,null,null,'GHC - HGB MUTIRAO','OTORRINO',true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj55','HGB MUTIRAO GINECO','050.5','GHC - HGB Mutirão — Ginecologia','projeto','Bonsucesso',null,null,null,null,null,'GHC - HGB MUTIRAO','GINECO',true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj56','HGB MUTIRAO RISCO CX','050.6','GHC - HGB Mutirão — Risco cirúrgico','projeto','Bonsucesso',null,null,null,null,null,'GHC - HGB MUTIRAO','RISCO CX',true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj12','IRON TRAINERS - Enfermagem','012','IRON TRAINERS - Enfermagem','projeto','Iron Trainers',null,null,null,null,'cl12',null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj13','IRON TRAINERS - FUP','013','IRON TRAINERS - FUP','projeto','Iron Trainers',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj14','IRON TRAINERS - Psicólogo','014','IRON TRAINERS - Psicólogo','projeto','Iron Trainers',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj15','IRON TRAINERS - AGP','015','IRON TRAINERS - AGP','projeto','Iron Trainers',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj16','HMTSM - PJ','016','HMTSM - PJ','projeto','HMTSM',null,null,null,null,'cl15',null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj17','HMTSM - Multidisciplinares','017','HMTSM - Multidisciplinares','projeto','HMTSM',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj18','AGIR - HMSA - CIR GERAL','018','AGIR - HMSA - CIR GERAL','projeto','Sant''ana',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj19','AGIR - HMSA - GO','019','AGIR - HMSA - GO','projeto','Sant''ana',null,null,null,null,'cl01',null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj20','AGIR - HMSA - ANESTESIA','020','AGIR - HMSA - ANESTESIA','projeto','Sant''ana',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj21','AGIR - HMSA - NEO','021','AGIR - HMSA - NEO','projeto','Sant''ana',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj22','IBD SOCIAL - SAMU','022','IBD SOCIAL - SAMU','projeto','Petrópolis',null,null,null,null,'cl09',null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj23','SCBM - ANESTESIA','023','SCBM - ANESTESIA','projeto','SCBM',null,null,null,null,'cl02',null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj24','SCBM - NEO','024','SCBM - NEO','projeto','SCBM',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj25','SCBM - CIR GERAL','025','SCBM - CIR GERAL','projeto','SCBM',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj26','SCBM - ANESTESIA PARTICULARES/CONVÊNIOS','026','SCBM - ANESTESIA PARTICULARES/CONVÊNIOS','projeto','SCBM',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj27','SCBM - PEDIATRIA','027','SCBM - PEDIATRIA','projeto','SCBM',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj28','HMSM - POA','028','HMSM - POA','projeto','HMSM',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj29','HNSN - Navegantes','029','HNSN - Navegantes','projeto','HNSN',null,null,null,null,'cl10',null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj30','Dr. Consulta - USG','030','Dr. Consulta - USG','projeto','Dr. Consulta',null,null,null,null,'cl14',null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj31','SPDM - Lusmar','031','SPDM - Lusmar','projeto','SPDM',null,null,null,null,'cl13',null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj32','SPDM - Randal','032','SPDM - Randal','projeto','SPDM',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj33','CETHID - NOVAPED','033','CETHID - NOVAPED','projeto','Maternidade Queimados',null,null,null,'emp3',null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj34','HMMQ - NOVAPED','034','HMMQ - NOVAPED','projeto','Maternidade Queimados',null,null,null,'emp3',null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj35','HMMQ MULTI - NOVAPED','035','HMMQ MULTI - NOVAPED','projeto','Maternidade Queimados',null,null,null,'emp3',null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj36','IPADE/UNICRISTUS','036','IPADE/UNICRISTUS','projeto','Fortaleza',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj37','Fund. Edson Queiroz/UNIFOR','037','Fund. Edson Queiroz/UNIFOR','projeto','Fortaleza',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj38','SCFORT - Intensificador','038','SCFORT - Intensificador','projeto','Fortaleza',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj39','SCFORT - Intensificador GE OEC','039','SCFORT - Intensificador GE OEC','projeto','Fortaleza',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj40','SCFORT - Mesa Cirúrgica','040','SCFORT - Mesa Cirúrgica','projeto','Fortaleza',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj41','Nilópolis - Santa Casa','041','Nilópolis - Santa Casa','projeto','Nilópolis',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj42','Moacyr do Carmo - Diálise','042','Moacyr do Carmo - Diálise','projeto','Duque de Caxias',null,null,null,null,null,null,null,true);
insert into centros (id,curto,codigo,nome,tipo,unidade,cidade,uf,cnpj,empresa,cliente,grupo_faturamento,especialidade_pate,ativo) values ('pj43','SAMU - Nova Friburgo','043','SAMU - Nova Friburgo','projeto','Nova Friburgo',null,null,null,null,null,null,null,true);

-- clientes
insert into clientes (id,nome,documento,centro_padrao,prazo_dias,cidade,uf,ativo) values ('cl01','AGIR — Ass. de Gestão, Inovação e Resultados em Saúde','05029600000287','pj19',35,'RIO DE JANEIRO','RJ',true);
insert into clientes (id,nome,documento,centro_padrao,prazo_dias,cidade,uf,ativo) values ('cl02','Santa Casa de Misericórdia de Barra Mansa','28683712000171','pj23',40,null,null,true);
insert into clientes (id,nome,documento,centro_padrao,prazo_dias,cidade,uf,ativo) values ('cl03','Grupo Hospitalar Conceição — Hospital Federal de Bonsucesso','92787118002416','pj11',40,null,null,true);
insert into clientes (id,nome,documento,centro_padrao,prazo_dias,cidade,uf,ativo) values ('cl04','Grupo Hospitalar Conceição S.A.','92787118000553','pj10',40,null,null,true);
insert into clientes (id,nome,documento,centro_padrao,prazo_dias,cidade,uf,ativo) values ('cl05','Irmandade Beneficente da Santa Casa da Misericórdia de Fortaleza','07273592000164','pj08',30,null,null,true);
insert into clientes (id,nome,documento,centro_padrao,prazo_dias,cidade,uf,ativo) values ('cl06','Instituto Dr. José Frota — IJF','07835044000180','pj07',30,null,null,true);
insert into clientes (id,nome,documento,centro_padrao,prazo_dias,cidade,uf,ativo) values ('cl07','Centro de Hematologia e Hemoterapia do Ceará — HEMOCE','07954571011491','pj06',30,null,null,true);
insert into clientes (id,nome,documento,centro_padrao,prazo_dias,cidade,uf,ativo) values ('cl08','Polícia Militar do Ceará','01790944003350','pj01',30,null,null,true);
insert into clientes (id,nome,documento,centro_padrao,prazo_dias,cidade,uf,ativo) values ('cl09','IBDSOCIAL','05843874000124','pj22',30,null,null,true);
insert into clientes (id,nome,documento,centro_padrao,prazo_dias,cidade,uf,ativo) values ('cl10','Instituto Brasileiro de Saúde, Ensino, Pesquisa e Extensão','07836454000146','pj29',60,null,null,true);
insert into clientes (id,nome,documento,centro_padrao,prazo_dias,cidade,uf,ativo) values ('cl11','Inst. Bras. de Saúde, Ensino, Pesq. e Extensão (filial)','07836454002009','pj29',60,null,null,true);
insert into clientes (id,nome,documento,centro_padrao,prazo_dias,cidade,uf,ativo) values ('cl12','Iron Trainers do Brasil Ltda','21298287000158','pj12',20,null,null,true);
insert into clientes (id,nome,documento,centro_padrao,prazo_dias,cidade,uf,ativo) values ('cl13','SPDM/PAIS — Ass. Paulista para o Desenvolvimento da Medicina','61699567009300','pj31',null,null,null,true);
insert into clientes (id,nome,documento,centro_padrao,prazo_dias,cidade,uf,ativo) values ('cl14','Dr. Consulta Centro Médico Ltda','14245016000179','pj30',null,null,null,true);
insert into clientes (id,nome,documento,centro_padrao,prazo_dias,cidade,uf,ativo) values ('cl15','Sociedade de Caridade — Santa Casa de Misericórdia Madre Michel','22351316000160','pj16',null,null,null,true);

-- credores
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr1','Dra. Marina Alves','medico','41.222.333/0001-70','3.01','pix','41.222.333/0001-70','CNPJ',true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr2','Dr. João Silva','medico','123.456.789-09','3.01','pix','(11) 98888-7777','Telefone',true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr3','MedTech Locações Ltda','fornecedor','55.444.333/0001-22','3.02','pix','financeiro@medtech.com.br','Email',true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr4','Imobiliária Centro RJ','fornecedor',null,'6.01',null,null,null,true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr5','Escritório Contábil','fornecedor',null,'6.03',null,null,null,true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr6','Receita Federal','orgao',null,'2.07','guia',null,null,true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr6b','Caixa Econômica Federal — FGTS','orgao',null,'4.03','guia',null,null,true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr7','Dr. Paulo Meireles','medico','31.884.207/0001-45','3.01','pix','31.884.207/0001-45','CNPJ',true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr8','Dra. Helena Coutinho','medico','842.117.330-52','3.01','pix','helena.coutinho@gmail.com','Email',true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr91','Dr. Rafael Amorim','medico','01234567890',null,'PIX','medico1@exemplo.com.br',null,true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr92','Dra. Beatriz Nunes','medico','78901234567',null,'PIX','medico2@exemplo.com.br',null,true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr93','Dr. Sérgio Tavares','medico','45678901234',null,'PIX','medico3@exemplo.com.br',null,true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr94','Dra. Camila Rocha','medico','12345678901',null,'PIX','medico4@exemplo.com.br',null,true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr95','Dr. Otávio Lins','medico','89012345678',null,'PIX','medico5@exemplo.com.br',null,true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr96','Dra. Renata Peixoto','medico','56789012345',null,'PIX','medico6@exemplo.com.br',null,true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr9','Dr. Sérgio Bastos','medico','19.457.882/0001-08','3.01','pix','f47ac10b-58cc-4372-a567-0e02b2c3d479','Aleatoria',true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr10','Imobiliária Alphaville','fornecedor','08.221.664/0001-31','6.01','pix','08.221.664/0001-31','CNPJ',true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr11','Enel Distribuição','fornecedor','33.050.071/0001-58','8.03','boleto',null,null,true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr12','Cirúrgica Nordeste Materiais','fornecedor','22.905.113/0001-77','8.04','pix','22.905.113/0001-77','CNPJ',true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr13','TOTVS S.A.','fornecedor','53.113.791/0001-22','7.01','boleto',null,null,true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr14','Vivo Empresas','fornecedor','02.558.157/0001-62','7.04','boleto',null,null,true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr15','Localiza Frotas','fornecedor','18.334.442/0001-90','8.01','pix','18.334.442/0001-90','CNPJ',true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr16','Advocacia Ribeiro & Sá','fornecedor','27.660.004/0001-13','6.04','pix','financeiro@ribeirosa.adv.br','Email',true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr17','Prefeitura de Barueri — ISS','orgao','46.523.015/0001-70','2.01','guia',null,null,true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr18','Banco Bradesco — empréstimo','fornecedor',null,'9.02','debito_conta',null,null,true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr19','Folha de pagamento','outro',null,'4.01','ted',null,null,true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr20','Sócios — retirada','socio',null,'10.01','ted',null,null,true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr21','Ar Puro Climatização','fornecedor','39.775.201/0001-64','6.07','pix','(11) 97744-2210','Telefone',true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr22','Azul Linhas Aéreas','fornecedor',null,'6.05',null,null,null,true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr23','Certisign Certificadora','fornecedor','01.554.285/0001-75','6.02','pix','01.554.285/0001-75','CNPJ',true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr24','Banco Bradesco','fornecedor',null,'9.01','debito_conta',null,null,true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('cr25','Banco Santander','fornecedor',null,'9.01','debito_conta',null,null,true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('crfn01','Camila Rodrigues Alves','funcionario','111.222.333-44','4.01','pix','111.222.333-44','CPF',true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('crfn02','Roberto Nascimento Lima','funcionario','222.333.444-55','4.01','pix','222.333.444-55','CPF',true);
insert into credores (id,nome,tipo,documento,conta_padrao,forma_pagamento,pix,tipo_chave,ativo) values ('crfn03','Juliana Ferreira Costa','funcionario','333.444.555-66','4.01','ted','',null,true);

-- contas bancárias
insert into bancos (id,empresa,apelido,banco,agencia,agencia_dv,conta,conta_dv,layout_remessa,convenio,ativo) values ('b1','emp1','Bradesco — movimento','237','01785','0','000000039464','5','cnab240','472572',true);
insert into bancos (id,empresa,apelido,banco,agencia,agencia_dv,conta,conta_dv,layout_remessa,convenio,ativo) values ('b2','emp1','Santander — movimento','033',null,null,null,null,'',null,true);
insert into bancos (id,empresa,apelido,banco,agencia,agencia_dv,conta,conta_dv,layout_remessa,convenio,ativo) values ('b3','emp2','Santander — filial CE','033','01234','','000013000567','','','',true);
insert into bancos (id,empresa,apelido,banco,agencia,agencia_dv,conta,conta_dv,layout_remessa,convenio,ativo) values ('b4','emp3','Itaú — Novaped','341','00456','','000000077889','','','',true);

-- produtos e armazéns
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr01','MT-001','Luva cirúrgica estéril 7,5','CX','40151200',20,60,128,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr02','MT-002','Seringa 20ml','CX','90183110',15,40,140.8,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr03','MT-003','Cateter venoso periférico 20G','CX','90183919',10,30,96.5,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr04','MT-004','Máscara cirúrgica tripla','CX','63079090',30,100,22.4,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr05','MT-005','Gaze estéril 7,5x7,5','PCT','30059011',40,120,8.9,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr06','MT-006','Soro fisiológico 0,9% 500ml','UN','30049099',60,200,6.75,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr07','MT-007','Equipo macrogotas','UN','90183290',50,150,3.2,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr08','MT-008','Álcool 70% 1L','UN','22072019',25,80,11.3,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr09','MT-009','Agulha 40x12','CX','90183220',12,40,18.6,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr10','MT-010','Fio de sutura nylon 3-0','CX','30061010',8,24,210,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr11','MT-011','Papel para eletrocardiógrafo','RL','48239099',10,30,14.5,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr12','MT-012','Eletrodo descartável ECG','PCT','90181910',15,50,32,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr20','CIR-001','Lente intraocular dobrável','UN','90213910',20,120,185,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr21','CIR-002','Viscoelástico 1,0ml','UN','30049099',20,120,96.5,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr22','CIR-003','Kit facoemulsificação descartável','UN','90183990',10,60,240,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr23','CIR-004','Tela de polipropileno 15x15','UN','30059090',8,40,152,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr24','CIR-005','Clipador laparoscópico descartável','UN','90183219',5,25,410,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr25','CIR-006','Trocarte descartável 10mm','UN','90183219',10,50,118,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr26','CIR-007','Fio de sutura vicryl 2-0','CX','30061010',6,30,178,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr27','CIR-008','Campo cirúrgico estéril descartável','PCT','63079090',15,80,64,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr28','CIR-009','Avental cirúrgico estéril','UN','62101000',20,100,22.5,'8.04',true);
insert into produtos (id,codigo,descricao,unidade,ncm,minimo,ideal,custo,conta,ativo) values ('pr29','CIR-010','Lâmina de bisturi 15','CX','82121020',5,25,46,'8.04',true);

insert into armazens (id,codigo,nome,centro,tipo,pai,responsavel,especialidade,ativo) values ('am01','ALM-SEDE','Almoxarifado central — Barueri','cc100','sede',null,'',null,true);
insert into armazens (id,codigo,nome,centro,tipo,pai,responsavel,especialidade,ativo) values ('am02','FARM-SCBM','Farmácia SCBM — Barra Mansa','pj23','externo',null,'Farmacêutica do projeto',null,true);
insert into armazens (id,codigo,nome,centro,tipo,pai,responsavel,especialidade,ativo) values ('am03','FARM-HMMQ','Farmácia HMMQ — Queimados','pj34','externo',null,'Farmacêutica do projeto',null,true);
insert into armazens (id,codigo,nome,centro,tipo,pai,responsavel,especialidade,ativo) values ('am04','FARM-CETHID','Farmácia CETHID — Queimados','pj33','externo',null,'',null,true);
insert into armazens (id,codigo,nome,centro,tipo,pai,responsavel,especialidade,ativo) values ('am05','ALM-HGB','Almoxarifado HGB — Bonsucesso','pj11','externo',null,'',null,true);
insert into armazens (id,codigo,nome,centro,tipo,pai,responsavel,especialidade,ativo) values ('am06','HGB-CC-OFTALMO','HGB · CC Oftalmologia','pj50','setor','am05','','OFTALMO',true);
insert into armazens (id,codigo,nome,centro,tipo,pai,responsavel,especialidade,ativo) values ('am07','HGB-CC-GERAL','HGB · CC Cirurgia geral','pj50','setor','am05','','CIRURGIA GERAL',true);
insert into armazens (id,codigo,nome,centro,tipo,pai,responsavel,especialidade,ativo) values ('am08','HGB-AMBULATORIO','HGB · Ambulatório','pj50','setor','am05','','RISCO CX',true);
insert into armazens (id,codigo,nome,centro,tipo,pai,responsavel,especialidade,ativo) values ('am09','HGB-CC-URO','HGB · CC Urologia','pj50','setor','am05','','UROLOGIA',true);
insert into armazens (id,codigo,nome,centro,tipo,pai,responsavel,especialidade,ativo) values ('am10','HGB-CC-OTORRINO','HGB · CC Otorrinolaringologia','pj50','setor','am05','','OTORRINO',true);
insert into armazens (id,codigo,nome,centro,tipo,pai,responsavel,especialidade,ativo) values ('am11','HGB-CC-GINECO','HGB · CC Ginecologia','pj50','setor','am05','','GINECO',true);

-- cargos
insert into cargos (id,nome,cbo,salario_piso) values ('cg01','Assistente administrativo','4110-05',1800);
insert into cargos (id,nome,cbo,salario_piso) values ('cg02','Analista financeiro','2524-05',3200);
insert into cargos (id,nome,cbo,salario_piso) values ('cg03','Auxiliar de escritório','4110-10',1600);
insert into cargos (id,nome,cbo,salario_piso) values ('cg04','Enfermeiro','2235-05',4200);
insert into cargos (id,nome,cbo,salario_piso) values ('cg05','Técnico de enfermagem','3222-05',2400);

-- parâmetros
insert into parametros (chave, valor) values ('tabela_inss', '{"vigencia":"2026-01","faixas":[{"ate":1621,"aliquota":7.5,"deduzir":0},{"ate":2902.84,"aliquota":9,"deduzir":24.32},{"ate":4354.27,"aliquota":12,"deduzir":111.4},{"ate":8475.55,"aliquota":14,"deduzir":198.49}],"teto_contribuicao":988.09}'::jsonb);
insert into parametros (chave, valor) values ('tabela_irrf', '{"vigencia":"2026-01","deducao_por_dependente":189.59,"desconto_simplificado":607.2,"faixas":[{"ate":2428.8,"aliquota":0,"deduzir":0},{"ate":2826.65,"aliquota":7.5,"deduzir":182.16},{"ate":3751.05,"aliquota":15,"deduzir":394.16},{"ate":4664.68,"aliquota":22.5,"deduzir":675.49},{"ate":null,"aliquota":27.5,"deduzir":908.73}],"redutor":{"limite_zera":5000,"limite_fim":7350,"formula_a":978.62,"formula_b":0.133145}}'::jsonb);
insert into parametros (chave, valor) values ('parametros_dp', '{"aliquota_fgts":8,"aliquota_multa_fgts_rescisao":40,"aliquota_inss_patronal":20,"aliquota_rat_fap":1,"aliquota_terceiros":5.8,"terco_constitucional_ferias":0.3333333333333333,"salario_minimo":1621,"teto_salario_familia":1980.38,"valor_salario_familia":67.54,"percentual_vt_max_desconto":6,"divisor_hora_padrao":220}'::jsonb);
insert into parametros (chave, valor) values ('tabela_pate', '[{"id":"pa01","area":"CIRURGIA GERAL","nome":"COLECISTECTOMIA VIDEOLAPAROSCOPICA","codigo":"04.07.03.003-4","sh":746.46,"sp":245.99,"sigtap":992.45,"multiplo":4,"total":3969.8,"faturamento":3771.31,"repasse":688.77,"tipo":"cirurgia"},{"id":"pa02","area":"CIRURGIA GERAL","nome":"HERNIOPLASTIA INGUINAL (BILATERAL)","codigo":"04.07.04.009-9","sh":399.57,"sp":210.49,"sigtap":610.06,"multiplo":4,"total":2440.24,"faturamento":2318.23,"repasse":589.37,"tipo":"cirurgia"},{"id":"pa03","area":"CIRURGIA GERAL","nome":"HERNIOPLASTIA UMBILICAL","codigo":"04.07.04.012-9","sh":298.55,"sp":136.44,"sigtap":434.99,"multiplo":4,"total":1739.96,"faturamento":1652.96,"repasse":382.03,"tipo":"cirurgia"},{"id":"pa04","area":"UROLOGIA","nome":"VASECTOMIA (AMBULATORIAL)","codigo":"04.09.04.024-0","sh":190.92,"sp":247.95,"sigtap":438.87,"multiplo":2,"total":877.74,"faturamento":833.85,"repasse":347.13,"tipo":"cirurgia"},{"id":"pa05","area":"UROLOGIA","nome":"POSTECTOMIA (AMBULATORIAL)","codigo":"04.09.05.008-3","sh":97.92,"sp":121.4,"sigtap":219.32,"multiplo":2,"total":438.64,"faturamento":416.71,"repasse":169.96,"tipo":"cirurgia"},{"id":"pa06","area":"UROLOGIA","nome":"TRATAMENTO CIRURGICO DE HIDROCELE","codigo":"04.09.04.021-5","sh":181.85,"sp":75.12,"sigtap":256.97,"multiplo":4,"total":1027.88,"faturamento":976.49,"repasse":210.34,"tipo":"cirurgia"},{"id":"pa07","area":"UROLOGIA","nome":"TRATAMENTO CIRURGICO DE VARICOCELE","codigo":"04.09.04.023-1","sh":173.24,"sp":84.32,"sigtap":257.56,"multiplo":4,"total":1030.24,"faturamento":978.73,"repasse":236.1,"tipo":"cirurgia"},{"id":"pa08","area":"OFTALMO","nome":"FACOEMULSIFICACAO C/ IMPLANTE DE LENTE INTRA-OCULAR DOBRAVEL","codigo":"04.05.05.037-2","sh":642.96,"sp":128.64,"sigtap":771.6,"multiplo":2,"total":1543.2,"faturamento":1466.04,"repasse":0,"tipo":"cirurgia"},{"id":"pa09","area":"OFTALMO","nome":"EXERESE DE CALAZIO E OUTRAS PEQUENAS LESOES DA PALPEBRA E SUPERCILIOS","codigo":"04.05.01.007-9","sh":55.3,"sp":23.45,"sigtap":78.75,"multiplo":2,"total":157.5,"faturamento":149.62,"repasse":0,"tipo":"cirurgia"},{"id":"pa10","area":"OTORRINO","nome":"SEPTOPLASTIA PARA CORRECAO DE DESVIO","codigo":"04.04.01.048-2","sh":686.36,"sp":303.48,"sigtap":989.84,"multiplo":1,"total":989.84,"faturamento":940.35,"repasse":null,"tipo":"cirurgia"},{"id":"pa11","area":"OTORRINO","nome":"SINUSOTOMIA BILATERAL","codigo":"04.04.01.032-6","sh":616.28,"sp":571.13,"sigtap":1187.41,"multiplo":1,"total":1187.41,"faturamento":1128.04,"repasse":null,"tipo":"cirurgia"},{"id":"pa12","area":"OTORRINO","nome":"TIMPANOPLASTIA (UNI/BILATERAL)","codigo":"04.04.01.035-0","sh":885.96,"sp":968.49,"sigtap":1854.45,"multiplo":1,"total":1854.45,"faturamento":1761.73,"repasse":null,"tipo":"cirurgia"},{"id":"pa13","area":"OTORRINO","nome":"ADENOIDECTOMIA","codigo":"04.04.01.001-6","sh":490.59,"sp":588.51,"sigtap":1079.1,"multiplo":1,"total":1079.1,"faturamento":1025.14,"repasse":null,"tipo":"cirurgia"},{"id":"pa14","area":"OTORRINO","nome":"AMIGDALECTOMIA","codigo":"04.04.01.002-4","sh":521.22,"sp":551.78,"sigtap":1073,"multiplo":1,"total":1073,"faturamento":1019.35,"repasse":null,"tipo":"cirurgia"},{"id":"pa15","area":"OTORRINO","nome":"TURBINECTOMIA","codigo":"04.04.01.041-5","sh":624.38,"sp":448.83,"sigtap":1073.21,"multiplo":1,"total":1073.21,"faturamento":1019.55,"repasse":null,"tipo":"cirurgia"},{"id":"pa16","area":"GINECO","nome":"LAQUEADURA TUBARIA","codigo":"04.09.06.018-6","sh":286.47,"sp":199.01,"sigtap":485.48,"multiplo":2,"total":970.96,"faturamento":922.41,"repasse":278.61,"tipo":"cirurgia"},{"id":"pa17","area":"GINECO","nome":"HISTERECTOMIA VIDEOLAPAROSCOPICA","codigo":"04.09.06.015-1","sh":400.24,"sp":265.08,"sigtap":665.32,"multiplo":2,"total":1330.64,"faturamento":1264.11,"repasse":371.11,"tipo":"cirurgia"},{"id":"pa18","area":"RISCO CX","nome":"RISCO CIRURGICO 6 HORAS - 30 A 35 AGENDAMENTOS","codigo":"","sh":0,"sp":0,"sigtap":0,"multiplo":1,"total":0,"faturamento":0,"repasse":1000,"tipo":"diaria"},{"id":"pa19","area":"OTORRINO","nome":"AMBULATORIO OTORRINO 6 HORAS - 20 A 25 AGENDAMENTOS","codigo":"","sh":0,"sp":0,"sigtap":0,"multiplo":1,"total":0,"faturamento":0,"repasse":1000,"tipo":"diaria"},{"id":"pa20","area":"OTORRINO","nome":"MAPA CIRURGICO DE OTORRINO 12 HORAS - 4 A 5 CIRURGIAS","codigo":"","sh":0,"sp":0,"sigtap":0,"multiplo":1,"total":0,"faturamento":0,"repasse":2000,"tipo":"diaria"},{"id":"pa21","area":"GINECO","nome":"AMBULATORIO GINECO 6 HORAS - 20 A 25 AGENDAMENTOS","codigo":"","sh":0,"sp":0,"sigtap":0,"multiplo":1,"total":0,"faturamento":0,"repasse":1000,"tipo":"diaria"}]'::jsonb);

-- Faltam, de propósito: funcionários (dado pessoal, carga à parte),
-- contratos e ativos reais, e todo o movimento.


-- ====================================================================
-- 5 — AJUSTES
-- ====================================================================

-- ERP Dom Pedro — ajustes de permissão
-- Etapa 4. Roda depois de 02-rls.sql.
--
-- Três decisões tomadas depois da revisão das políticas.

-- ── 1. Nome de paciente e valores: fechar na coluna ────
--
-- A RLS decide quais LINHAS alguém lê; ela não sabe esconder uma
-- coluna. Por isso as visões `procedimentos_visivel` e
-- `estoque_movimentos_visivel` mascaram o nome do paciente — mas,
-- enquanto a tabela-base estiver legível, a visão é enfeite: basta
-- pedir a tabela direto.
--
-- O `revoke` por coluna fecha isso de verdade. Quem não tem a
-- permissão não consegue pedir a coluna nem com `select *`: a
-- requisição inteira é recusada. As visões continuam sendo o
-- caminho normal de leitura.
--
-- A ESCRITA não é afetada: permissão de insert e update é separada
-- da de select, então a aplicação segue gravando o paciente e os
-- valores normalmente.

-- ATENÇÃO à forma. `revoke select (coluna)` sozinho NÃO funciona:
-- o Supabase concede a `authenticated` o SELECT da tabela inteira
-- por default privilege, e grant de tabela cobre toda coluna — o
-- revoke de coluna não subtrai nada. A forma que funciona é tirar o
-- SELECT da tabela e devolver coluna a coluna, menos as fechadas.

revoke select on procedimentos from authenticated, anon;
grant select (id, data, competencia, centro, especialidade, procedimento,
  procedimento_nome, medico, qtd, armazem, materiais, transferencias, grupo,
  financeiro, cancelado, motivo_cancelamento, editado_por, usuario_id, criado_em)
  on procedimentos to authenticated;

revoke select on estoque_movimentos from authenticated, anon;
grant select (id, tipo, produto, armazem, qtd, qtd_nota, unidades_por_embalagem,
  data, data_nf, motivo, documento, lote, validade, origem, grupo, pedido_id,
  estornado, usuario, usuario_id, lancado_em)
  on estoque_movimentos to authenticated;

-- A escrita não é afetada: insert e update têm privilégio próprio.
grant insert, update on procedimentos, estoque_movimentos to authenticated;

-- Com as colunas fechadas, as visões PRECISAM rodar como donas —
-- `security_invoker = true` exigiria o privilégio de quem chama, e
-- aí nem quem tem a ação conseguiria ler. E, rodando como donas,
-- o filtro de LINHA tem de estar escrito dentro delas.

drop view if exists procedimentos_visivel;
create view procedimentos_visivel
  with (security_invoker = false) as
  select p.id, p.data, p.competencia, p.centro, p.especialidade,
         p.procedimento, p.procedimento_nome, p.medico, p.qtd,
         p.armazem, p.materiais, p.transferencias, p.grupo, p.financeiro,
         p.cancelado, p.criado_em,
         case when tem_acao('ver_pacientes') then p.paciente end as paciente,
         case when tem_nivel('procedimentos', 'F') then p.faturamento end as faturamento,
         case when tem_nivel('procedimentos', 'F') then p.repasse end as repasse,
         case when tem_nivel('procedimentos', 'F') then p.custo_material end as custo_material,
         case when tem_nivel('procedimentos', 'F') then p.imposto end as imposto,
         -- A alíquota aplicada é informação de valor como as outras:
         -- diz quanto o projeto paga de imposto. Vai junto do $.
         case when tem_nivel('procedimentos', 'F') then p.imposto_pct end as imposto_pct,
         case when tem_nivel('procedimentos', 'F') then p.resultado end as resultado
    from procedimentos p
   where tem_nivel('procedimentos', 'V');

drop view if exists estoque_movimentos_visivel;
create view estoque_movimentos_visivel
  with (security_invoker = false) as
  select m.id, m.tipo, m.produto, m.armazem, m.qtd, m.data, m.motivo,
         m.documento, m.lote, m.validade, m.origem, m.grupo, m.estornado,
         m.usuario, m.lancado_em,
         case when tem_acao('ver_pacientes') then m.paciente end as paciente,
         case when tem_nivel('estoque', 'F') then m.custo end as custo,
         case when tem_nivel('estoque', 'F') then m.valor end as valor,
         -- Custo da nota: o que o fornecedor cobrou, antes do rateio
         -- do frete. É preço, então segue a mesma regra.
         case when tem_nivel('estoque', 'F') then m.custo_nota end as custo_nota,
         case when tem_nivel('estoque', 'F') then m.medio_depois end as medio_depois
    from estoque_movimentos m
   where tem_nivel('estoque', 'V');

revoke all on procedimentos_visivel, estoque_movimentos_visivel from anon;
grant select on procedimentos_visivel, estoque_movimentos_visivel to authenticated;

-- NOTA PARA A MIGRAÇÃO DO CÓDIGO (Marco 3): com as colunas
-- fechadas, `insert ... returning *` e `update ... returning *`
-- nestas duas tabelas voltam "permission denied" — o grant de
-- coluna morde antes da RLS. No supabase-js, a escrita em
-- `procedimentos` e `estoque_movimentos` não pode encadear um
-- `.select()` sem lista: ou pede só as colunas liberadas, ou não
-- pede retorno nenhum.

-- ── 2. Quem escreve na matriz e no perfil ──────────────
--
-- Decisão: Administração, Diretoria e Sócio continuam podendo —
-- são os três que respondem pela empresa. O que sai é o assistente
-- financeiro, que tinha Administração em VM por engano de cadastro
-- e podia, pela API, promover o próprio perfil.
--
-- A correção principal é na matriz (o assistente passa a ter só V
-- em Administração), e vem no ERP. Aqui fica a trava que impede o
-- caso que nenhuma matriz resolve: alguém alterar o PRÓPRIO perfil.

drop policy if exists mexer_usuarios on usuarios;

create policy criar_usuarios on usuarios
  for insert with check (tem_nivel('administracao', 'M'));

create policy editar_usuarios on usuarios
  for update using (
    tem_nivel('administracao', 'M')
    -- Ninguém muda o próprio registro por aqui, nem o administrador.
    -- Promover a si mesmo não é alçada: é falta de segunda mão.
    and auth_id is distinct from auth.uid()
  )
  with check (
    tem_nivel('administracao', 'M')
    and auth_id is distinct from auth.uid()
  );

-- ── 3. O que o assistente financeiro vê em Pessoal ─────
--
-- Decisão: vê tudo — cadastro e folha completos —, mas não
-- movimenta e não fecha. Ele paga os salários, e para pagar precisa
-- do líquido, da conta e do CPF.
--
-- A consequência, registrada porque é real: isso inclui o salário
-- de todos, inclusive de quem está acima dele. O sigilo salarial
-- que o sistema aplica em outros pontos não vale para este perfil.
-- Se um dia a empresa quiser separar "pagar" de "ver quanto cada um
-- ganha", o caminho é um perfil de tesouraria que leia só o líquido
-- a pagar, sem o cadastro.
--
-- Em termos de banco, o assistente ganha a ação `ver_dados_pessoais`
-- (feito no ERP, no cadastro do perfil) e segue com dp = V$: sem M,
-- não lança nada; sem A, não fecha a folha.

-- Conferência do resultado esperado:
--   select niveis from matriz_acesso
--    where perfil = 'assistente' and modulo = 'dp';        -- VF
--   select niveis from matriz_acesso
--    where perfil = 'assistente' and modulo = 'administracao';  -- V
--   select acoes ? 'ver_dados_pessoais' from perfis
--    where id = 'assistente';                              -- true


-- ══════════════════════════════════════════════════════════════════
-- Agora rode o ATUALIZAR-TUDO.sql neste mesmo projeto.
--
-- Depois dele, crie os logins em Authentication › Users (com
-- "Auto Confirm User" marcado) e ligue cada um ao usuário:
--
--   update usuarios
--      set auth_id = (select id from auth.users where email = usuarios.email)
--    where email is not null and auth_id is null;
--
-- Conferência:
--   select 'projetos', count(*) from centros where tipo = 'projeto'
--   union all select 'usuários', count(*) from usuarios
--   union all select 'títulos de exemplo', count(*) from titulos;
-- ══════════════════════════════════════════════════════════════════
