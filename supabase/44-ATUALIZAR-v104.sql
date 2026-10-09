-- ERP Dom Pedro — ATUALIZAÇÃO v104, tudo num arquivo só
-- ════════════════════════════════════════════════════════════
--
-- Cole isto inteiro no SQL Editor do Supabase e rode UMA vez, em
-- cada banco (o real e o de teste). São as duas etapas que estavam
-- pendentes:
--
--   PARTE 1 — etapa 41, o contrato virando contas a pagar.
--             Já tinha sido mandada, mas GANHOU UMA COLUNA na v103
--             (`parcelas_quitadas_fora`, do contrato retroativo).
--             Rodar de novo é seguro e necessário.
--
--   PARTE 2 — etapa 43, o módulo HABILITAÇÃO (novo): o cofre de
--             documentos e o alerta de vencimento.
--
-- Rodar duas vezes não quebra nada: os dois trechos são escritos
-- para serem repetíveis.
--
-- NO FIM sai uma tabela de conferência. O esperado está escrito
-- logo abaixo dela.
--
-- ════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════
-- PARTE 1 de 2 — contrato vira contas a pagar (etapa 41, revisada)
-- ════════════════════════════════════════════════════════════

-- ERP Dom Pedro — o contrato vira contas a pagar
-- Etapa 41. Roda nos dois bancos (real e teste).
--
-- ORDEM: rode esta ANTES da etapa 40 (ou rode a 40 de novo depois).
-- A 40 promove para a coluna o que está preso no `extra`, e as
-- colunas criadas aqui são justamente onde esses valores precisam
-- cair.
--
-- POR QUE EXISTE
--
-- O contrato guardava dezenove campos dentro do `extra`, porque a
-- tabela nasceu só com o que o contrato de CLIENTE precisava. Entre
-- os que ficaram de fora estão o `fornecedor` e a `conta` — que são
-- exatamente o que o contas a pagar precisa para nascer de um
-- contrato.
--
-- Com as colunas criadas, o contrato passa a gerar as previsões de
-- pagamento: mensais pela vigência, ou pelo cronograma digitado
-- quando os pagamentos são variáveis.
--
-- É seguro rodar mais de uma vez.

alter table contratos
  add column if not exists fornecedor           text,
  add column if not exists conta                text,
  add column if not exists dia_vencimento       int,
  add column if not exists prazo_dias           int,
  add column if not exists dia_entrega_nf       int,
  add column if not exists multa_atraso_pct     numeric(6,2),
  add column if not exists juros_mes_pct        numeric(6,2),
  add column if not exists correcao_atraso      text,
  add column if not exists regra_reajuste       text,
  add column if not exists regra_renovacao      text,
  add column if not exists aviso_rescisao_dias  int,
  add column if not exists garantia             text,
  add column if not exists contato_cobranca     text,
  add column if not exists observacao           text,
  add column if not exists exemplo              boolean,
  -- programação de pagamento
  add column if not exists pagamentos_variaveis boolean not null default false,
  add column if not exists parcelas_previstas   jsonb not null default '[]'::jsonb,
  add column if not exists total_previsto       numeric(14,2),
  add column if not exists previsoes_geradas_em timestamptz,
  -- Parcelas do cronograma que JÁ ESTAVAM PAGAS quando o contrato
  -- entrou no sistema. Um contrato que começou no ano passado tem o
  -- cronograma inteiro, mas quase nada dele é compromisso futuro.
  -- Ficam registradas aqui para quem abrir o contrato depois não
  -- achar que ele começa no meio.
  add column if not exists parcelas_quitadas_fora jsonb not null default '[]'::jsonb;

-- Traz o que está no `extra` para as colunas recém-criadas. A etapa
-- 40 faz isso para o banco inteiro; aqui fica a parte do contrato,
-- para quem rodar só esta.
--
-- SÓ PROMOVE O QUE EXISTE NO CADASTRO, e isso não é zelo: é o que
-- torna o script repetível.
--
-- A primeira versão promovia tudo e limpava o órfão logo abaixo,
-- antes de criar a trava. Funcionava na primeira passada. Na
-- SEGUNDA, a trava já existia e a promoção tentava gravar de novo
-- o fornecedor que o passo seguinte tinha acabado de apagar —
-- `violates foreign key constraint` e o arquivo inteiro abortava
-- ali, sem chegar na parte 2. Peguei rodando duas vezes num
-- Postgres de teste com um contrato apontando para fornecedor que
-- saiu do cadastro.
--
-- Com a checagem aqui dentro, o valor órfão simplesmente não sobe
-- do `extra` — e ele continua guardado lá, caso o cadastro volte.
update contratos c
   set fornecedor = coalesce(c.fornecedor, x.id)
  from credores x
 where c.fornecedor is null
   and x.id = nullif(c.extra ->> 'fornecedor', '');

update contratos c
   set conta = coalesce(c.conta, x.cod)
  from plano_contas x
 where c.conta is null
   and x.cod = nullif(c.extra ->> 'conta', '');

-- ──────────────────────────────────────────────────────────────
-- Chaves estrangeiras.
--
-- Antes de travar, limpa o que apontaria para o vazio: um contrato
-- com fornecedor que não existe mais no cadastro derrubaria o
-- `alter` e deixaria o banco sem a trava. Normalizar primeiro e
-- travar depois foi o que funcionou na etapa 27.
-- ──────────────────────────────────────────────────────────────
update contratos c set fornecedor = null
 where c.fornecedor is not null
   and not exists (select 1 from credores x where x.id = c.fornecedor);

update contratos c set conta = null
 where c.conta is not null
   and not exists (select 1 from plano_contas x where x.cod = c.conta);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contratos_fornecedor_fkey') then
    alter table contratos
      add constraint contratos_fornecedor_fkey
      foreign key (fornecedor) references credores (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contratos_conta_fkey') then
    alter table contratos
      add constraint contratos_conta_fkey
      foreign key (conta) references plano_contas (cod);
  end if;
end $$;

create index if not exists contratos_fornecedor on contratos (fornecedor);


-- ════════════════════════════════════════════════════════════
-- PARTE 2 de 2 — módulo HABILITAÇÃO (etapa 43, nova)
-- ════════════════════════════════════════════════════════════

-- ERP Dom Pedro — módulo HABILITAÇÃO, primeira parte: o cofre
-- Etapa 43. Roda nos dois bancos (real e teste).
--
-- O QUE ENTRA AGORA
--
-- O cofre de documentos e o alerta de vencimento. Guardar a certidão,
-- ler dela a data de validade, e avisar antes de vencer.
--
-- Certames, checklist, modelos de peça e empacotamento ficam para
-- depois — as tabelas deste script não os pressupõem, e acrescentá-los
-- não vai exigir mexer no que está aqui.
--
-- ─────────────────────────────────────────────────────────────
-- SOBRE AS PERMISSÕES
--
-- O pedido falava em três papéis novos (hab_admin, hab_operador,
-- hab_leitor). Eles entram como NÍVEIS do módulo `habilitacao` na
-- matriz de acesso que o sistema já tem, e não como um esquema
-- paralelo:
--
--   V (ver)        = hab_leitor     consulta e baixa
--   M (movimentar) = hab_operador   sobe documento, edita, arquiva
--   A (administrar)= hab_admin      mexe no catálogo de tipos
--
-- A razão é a mesma que já derrubou a matriz uma vez: duas camadas
-- de permissão para o mesmo ato acabam divergindo, e a pessoa vê a
-- permissão concedida numa tela enquanto a outra continua negando.
--
-- O documento com dado pessoal de sócio (RG, CPF, comprovante de
-- residência) tem tratamento à parte: a ação `ver_doc_socio`, no
-- mesmo molde de `ver_pacientes` e `ver_dados_pessoais`.
-- ─────────────────────────────────────────────────────────────
--
-- É seguro rodar mais de uma vez.

-- ──────────────────────────────────────────────────────────────
-- 1. CATÁLOGO DE TIPOS
--
-- O que é cada documento, quanto costuma durar e onde se emite.
-- `prazo_padrao_dias` é nulo quando varia (a CND estadual de SP não
-- dura o mesmo que a do RS).
-- ──────────────────────────────────────────────────────────────
create table if not exists hab_tipo_documento (
  id                 text primary key,
  nome               text not null,
  sigla              text,
  categoria          text not null default 'outros',   -- cadastrais|certidoes|tecnico|balancos|outros
  orgao_emissor      text,
  prazo_padrao_dias  int,
  sem_validade       boolean not null default false,   -- contrato social não vence
  renovacao_automatica boolean not null default false,
  url_emissao        text,
  exige_captcha      boolean not null default false,
  -- Dado pessoal de sócio: só quem tem `ver_doc_socio` enxerga.
  dado_pessoal       boolean not null default false,
  -- Palavras-chave para o sistema adivinhar o tipo ao subir o
  -- arquivo. Formato: [["texto procurado", peso], ...]
  palavras_chave     jsonb not null default '[]'::jsonb,
  ordem              int not null default 100,
  ativo              boolean not null default true,
  extra              jsonb not null default '{}'::jsonb
);

-- ──────────────────────────────────────────────────────────────
-- 2. O DOCUMENTO
--
-- `abrangencia` existe porque a CND conjunta cobre matriz e filiais
-- de uma vez, e o CRF do FGTS é por estabelecimento. Tratar os dois
-- igual faria o sistema pedir à filial uma certidão que ela já tem
-- pela matriz, ou dar por coberta uma filial que não está.
-- ──────────────────────────────────────────────────────────────
do $$ begin
  create type hab_abrangencia as enum ('matriz', 'estabelecimento');
exception when duplicate_object then null; end $$;

create table if not exists hab_documento (
  id              text primary key,
  empresa         text not null references empresas (id),
  tipo            text not null references hab_tipo_documento (id),
  numero          text,
  data_emissao    date,
  data_validade   date,                 -- nulo quando o documento não traz
  abrangencia     hab_abrangencia not null default 'estabelecimento',
  arquivo_path    text,                 -- caminho no Storage
  arquivo_nome    text,
  arquivo_hash    text,                 -- para não subir o mesmo duas vezes
  arquivo_bytes   bigint,
  observacao      text,
  -- Quando o definitivo não existe para aquele CNPJ e vale o par
  -- requerimento + protocolo, o protocolo aponta para o que ele
  -- substitui.
  substituto_de   text references hab_documento (id),
  arquivado       boolean not null default false,
  criado_por      text references usuarios (id),
  criado_em       timestamptz not null default now(),
  extra           jsonb not null default '{}'::jsonb
);
create index if not exists hab_doc_empresa on hab_documento (empresa, tipo);
create index if not exists hab_doc_validade on hab_documento (data_validade);
create unique index if not exists hab_doc_hash on hab_documento (empresa, arquivo_hash)
  where arquivo_hash is not null;

-- ──────────────────────────────────────────────────────────────
-- 3. APROVEITAMENTO ENTRE CNPJs
--
-- Documento de um CNPJ aceito em certame de outro. Caso real: a
-- filial de Fortaleza tem certificados técnicos próprios, e nos
-- certames da matriz vale o requerimento e o protocolo acompanhados
-- dos documentos técnicos da filial do Rio.
-- ──────────────────────────────────────────────────────────────
create table if not exists hab_aproveitamento (
  id              text primary key,
  documento       text not null references hab_documento (id) on delete cascade,
  empresa_destino text not null references empresas (id),
  observacao      text,
  criado_em       timestamptz not null default now(),
  unique (documento, empresa_destino)
);

-- ──────────────────────────────────────────────────────────────
-- 4. DADO CADASTRAL COM HISTÓRICO
--
-- Não sobrescreve. A inscrição municipal da matriz mudou em 10/2026
-- (4.BX896-2, antes 5.BX896-9), e uma peça de setembro precisa
-- continuar reproduzível com o número que valia naquele dia.
-- ──────────────────────────────────────────────────────────────
create table if not exists hab_empresa_dado (
  id           text primary key,
  empresa      text not null references empresas (id),
  campo        text not null,
  valor        text not null,
  vigente_de   date not null,
  vigente_ate  date,                    -- nulo = vigente
  observacao   text,
  criado_em    timestamptz not null default now()
);
create index if not exists hab_dado_vigencia on hab_empresa_dado (empresa, campo, vigente_de desc);

-- ──────────────────────────────────────────────────────────────
-- 5. TAREFA DE RENOVAÇÃO
--
-- Toda certidão que vence vira uma tarefa com prazo e responsável.
-- O alerta que ninguém pode fechar sem fazer nada é o que impede o
-- "eu achei que alguém tinha renovado".
-- ──────────────────────────────────────────────────────────────
create table if not exists hab_tarefa (
  id            text primary key,
  documento     text references hab_documento (id),
  tipo          text references hab_tipo_documento (id),
  empresa       text not null references empresas (id),
  motivo        text not null,
  prazo         date,
  status        text not null default 'aberta',   -- aberta|feita|dispensada
  responsavel   text references usuarios (id),
  observacao    text,
  criado_em     timestamptz not null default now(),
  concluida_em  timestamptz,
  extra         jsonb not null default '{}'::jsonb
);
create index if not exists hab_tarefa_aberta on hab_tarefa (status, prazo);

-- ──────────────────────────────────────────────────────────────
-- 6. A VALIDADE QUE VALE
--
-- Documento sem data de validade impressa não é documento eterno:
-- o edital costuma aceitar até 90 dias da emissão. A regra fica
-- aqui, uma vez, e não espalhada por cada tela que precisa dela.
--
-- O PRAZO VEM DO TIPO, e isso não é detalhe: a CNDT escreve o
-- prazo em palavras ("válida por 180 dias contados da expedição")
-- em vez de imprimir a data. Com os 90 dias fixos, uma CNDT
-- expedida há cem dias apareceria vencida estando válida — e
-- alarme falso é como se ensina a ignorar o semáforo. Os 90 dias
-- continuam valendo para o tipo que não declara prazo nenhum.
-- ──────────────────────────────────────────────────────────────
-- A ordem aqui é obrigatória, e custou um erro para descobrir:
-- `create or replace function` NÃO substitui uma função cuja lista
-- de parâmetros mudou — cria uma segunda, e a chamada de três
-- argumentos continuaria caindo na antiga, com os 90 dias fixos.
-- Então a antiga sai. Mas a view depende dela, e `drop function`
-- recusa enquanto a dependência existir — por isso a view sai
-- primeiro e é recriada logo abaixo.
drop view if exists hab_documento_vigente;
drop function if exists hab_validade_efetiva(date, date, boolean);

create or replace function hab_validade_efetiva(
  p_data_validade date, p_data_emissao date, p_sem_validade boolean,
  p_prazo_dias int default null)
returns date language sql immutable as $$
  select case
    when p_sem_validade then null                       -- não vence
    when p_data_validade is not null then p_data_validade
    when p_data_emissao  is not null then p_data_emissao + coalesce(p_prazo_dias, 90)
    else null
  end
$$;

create or replace view hab_documento_vigente as
select d.*,
       t.nome          as tipo_nome,
       t.sigla         as tipo_sigla,
       t.categoria     as tipo_categoria,
       t.sem_validade  as tipo_sem_validade,
       t.dado_pessoal  as tipo_dado_pessoal,
       t.url_emissao   as tipo_url_emissao,
       e.apelido       as empresa_apelido,
       t.prazo_padrao_dias as tipo_prazo_dias,
       hab_validade_efetiva(d.data_validade, d.data_emissao, t.sem_validade,
                            t.prazo_padrao_dias) as validade_efetiva,
       case
         when t.sem_validade then null
         else hab_validade_efetiva(d.data_validade, d.data_emissao, t.sem_validade,
                                   t.prazo_padrao_dias) - current_date
       end as dias_para_vencer
  from hab_documento d
  join hab_tipo_documento t on t.id = d.tipo
  join empresas e on e.id = d.empresa
 where not d.arquivado;

-- ──────────────────────────────────────────────────────────────
-- 7. QUEM VÊ O QUÊ
--
-- O módulo `habilitacao` na matriz de acesso decide; a ação
-- `ver_doc_socio` cobre o documento com dado pessoal de sócio.
-- ──────────────────────────────────────────────────────────────
-- O GRANT vem antes da política. A política diz QUAIS linhas; o
-- grant diz se a tabela é alcançável. Sem ele, o Postgres recusa
-- com "permission denied for table" e a política nem chega a ser
-- consultada — erro que parece de regra de acesso e é de privilégio.
grant select, insert, update, delete on
  hab_tipo_documento, hab_documento, hab_aproveitamento,
  hab_empresa_dado, hab_tarefa
  to authenticated;
grant select on hab_documento_vigente to authenticated;
grant execute on function hab_validade_efetiva(date, date, boolean, int) to authenticated;

alter table hab_tipo_documento enable row level security;
alter table hab_documento      enable row level security;
alter table hab_aproveitamento enable row level security;
alter table hab_empresa_dado   enable row level security;
alter table hab_tarefa         enable row level security;

drop policy if exists hab_tipo_ler on hab_tipo_documento;
create policy hab_tipo_ler on hab_tipo_documento
  for select using (tem_nivel('habilitacao', 'V'));
drop policy if exists hab_tipo_mexer on hab_tipo_documento;
create policy hab_tipo_mexer on hab_tipo_documento
  for all using (tem_nivel('habilitacao', 'A')) with check (tem_nivel('habilitacao', 'A'));

-- Documento: quem vê o módulo lê, MENOS o que é dado pessoal de
-- sócio — esse exige a ação própria.
drop policy if exists hab_doc_ler on hab_documento;
create policy hab_doc_ler on hab_documento
  for select using (
    tem_nivel('habilitacao', 'V') and (
      tem_acao('ver_doc_socio') or
      not exists (select 1 from hab_tipo_documento t
                   where t.id = hab_documento.tipo and t.dado_pessoal)
    ));
drop policy if exists hab_doc_mexer on hab_documento;
create policy hab_doc_mexer on hab_documento
  for all using (tem_nivel('habilitacao', 'M')) with check (tem_nivel('habilitacao', 'M'));

drop policy if exists hab_aprov_ler on hab_aproveitamento;
create policy hab_aprov_ler on hab_aproveitamento
  for select using (tem_nivel('habilitacao', 'V'));
drop policy if exists hab_aprov_mexer on hab_aproveitamento;
create policy hab_aprov_mexer on hab_aproveitamento
  for all using (tem_nivel('habilitacao', 'M')) with check (tem_nivel('habilitacao', 'M'));

drop policy if exists hab_dado_ler on hab_empresa_dado;
create policy hab_dado_ler on hab_empresa_dado
  for select using (tem_nivel('habilitacao', 'V'));
drop policy if exists hab_dado_mexer on hab_empresa_dado;
create policy hab_dado_mexer on hab_empresa_dado
  for all using (tem_nivel('habilitacao', 'A')) with check (tem_nivel('habilitacao', 'A'));

drop policy if exists hab_tarefa_ler on hab_tarefa;
create policy hab_tarefa_ler on hab_tarefa
  for select using (tem_nivel('habilitacao', 'V'));
drop policy if exists hab_tarefa_mexer on hab_tarefa;
create policy hab_tarefa_mexer on hab_tarefa
  for all using (tem_nivel('habilitacao', 'M')) with check (tem_nivel('habilitacao', 'M'));

-- A ação nova entra nos perfis que já administram.
update perfis set acoes = acoes || '["ver_doc_socio"]'::jsonb
 where id in ('admin', 'socio', 'diretoria')
   and not (acoes ? 'ver_doc_socio');

-- E o módulo entra na matriz, para a Administração poder ajustar na
-- tela. Começa fechado para quem não precisa: o cofre guarda
-- contrato social, balanço e documento de sócio.
insert into matriz_acesso (perfil, modulo, niveis)
select p.id, 'habilitacao',
       case when p.id in ('admin', 'socio', 'diretoria') then 'VMA'
            when p.id = 'assistente' then 'VM'
            else '' end
  from perfis p
 where not exists (select 1 from matriz_acesso m
                    where m.perfil = p.id and m.modulo = 'habilitacao');

-- ──────────────────────────────────────────────────────────────
-- 8. O CATÁLOGO INICIAL
--
-- Os tipos que a HJM usa, com as palavras que identificam cada um
-- dentro do PDF. Os pesos vieram do cofre que já estava em uso: a
-- frase inteira do cabeçalho da certidão pesa mais que a sigla
-- solta, porque "FGTS" aparece em qualquer documento trabalhista.
-- ──────────────────────────────────────────────────────────────
insert into hab_tipo_documento
  (id, nome, sigla, categoria, orgao_emissor, prazo_padrao_dias, sem_validade,
   renovacao_automatica, exige_captcha, dado_pessoal, url_emissao, palavras_chave, ordem)
values
 ('contrato-social', 'Contrato social / Alteração', null, 'cadastrais', 'Junta Comercial',
  null, true, false, false, false, null,
  '[["contrato social",7],["alteracao contratual",7],["junta comercial",4],["consolidacao",3]]', 1),
 ('cnpj', 'Cartão CNPJ', 'CNPJ', 'cadastrais', 'Receita Federal',
  null, true, false, false, false, 'https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/cnpjreva_solicitacao.asp',
  '[["comprovante de inscricao e de situacao cadastral",9],["situacao cadastral",3],["natureza juridica",3]]', 2),
 ('insc-estadual', 'Inscrição Estadual', 'IE', 'cadastrais', 'SEFAZ',
  null, true, false, false, false, null,
  '[["inscricao estadual",6],["cadastro de contribuintes do icms",6],["cadesp",5]]', 3),
 ('insc-municipal', 'Inscrição Municipal', 'CCM', 'cadastrais', 'Prefeitura',
  null, true, false, false, false, null,
  '[["inscricao municipal",6],["cadastro mobiliario",5],["ccm",4]]', 4),
 ('socios', 'Documentos dos sócios (RG, CPF, residência)', null, 'cadastrais', null,
  null, true, false, false, true, null,
  '[["carteira de identidade",6],["registro geral",5],["cadastro de pessoa fisica",5],["carteira nacional de habilitacao",6]]', 5),
 ('procuracao', 'Procuração', null, 'cadastrais', null,
  null, true, false, false, false, null,
  '[["procuracao",8],["outorgante",5],["outorgado",5]]', 6),

 ('cnd-federal', 'CND Federal (RFB/PGFN)', 'CND', 'certidoes', 'Receita Federal / PGFN',
  180, false, true, true, false, 'https://servicos.receita.fazenda.gov.br/servicos/certidaointernet/pj/emitir',
  '[["creditos tributarios federais",6],["divida ativa da uniao",6],["procuradoria-geral da fazenda nacional",3]]', 10),
 ('estadual', 'CND Estadual (SEFAZ)', null, 'certidoes', 'SEFAZ',
  null, false, false, true, false, null,
  '[["secretaria da fazenda",6],["debitos tributarios nao inscritos",6],["sefaz",5],["icms",2],["cadesp",2]]', 11),
 ('estadual-pge', 'CND Estadual PGE (dívida ativa)', 'PGE', 'certidoes', 'PGE',
  null, false, false, true, false, null,
  '[["procuradoria geral do estado",8],["procuradoria-geral do estado",8],["divida ativa do estado",7],["debitos inscritos na divida ativa",6],["pge",5]]', 12),
 ('municipal', 'CND Municipal', null, 'certidoes', 'Prefeitura',
  null, false, false, true, false, null,
  '[["tributos mobiliarios",5],["secretaria municipal de financas",4],["divida ativa do municipio",5],["prefeitura",3]]', 13),
 ('fgts', 'CRF — FGTS', 'CRF', 'certidoes', 'Caixa Econômica Federal',
  30, false, true, true, false, 'https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf',
  '[["certificado de regularidade do fgts",8],["fgts",3]]', 14),
 ('cndt', 'CNDT — Trabalhista', 'CNDT', 'certidoes', 'TST',
  180, false, true, true, false, 'https://cndt-certidao.tst.jus.br/inicio.faces',
  '[["debitos trabalhistas",8],["tribunal superior do trabalho",4],["banco nacional de devedores trabalhistas",4]]', 15),
 ('falencia', 'Certidão de Falência / Recuperação', null, 'certidoes', 'TJ',
  null, false, false, true, false, null,
  '[["falencia",6],["recuperacao judicial",6],["concordata",4],["distribuidor",3]]', 16),
 ('alvara', 'Alvará de funcionamento', null, 'certidoes', 'Prefeitura',
  null, false, false, false, false, null,
  '[["alvara",7],["licenca de funcionamento",6]]', 17),
 ('sanitaria', 'Licença / dispensa sanitária', null, 'certidoes', 'Vigilância Sanitária',
  null, false, false, false, false, null,
  '[["vigilancia sanitaria",7],["licenca sanitaria",7],["dispensa de licenca",6]]', 18),
 ('sicaf', 'SICAF', 'SICAF', 'certidoes', 'Compras.gov',
  null, false, false, false, false, null,
  '[["sistema de cadastramento unificado de fornecedores",9],["sicaf",6]]', 19),

 ('cgu', 'CEIS/CNEP — CGU (apenados)', null, 'certidoes', 'CGU',
  null, false, false, false, false, 'https://certidoes.cgu.gov.br/',
  '[["empresas inidoneas e suspensas",8],["cadastro nacional de empresas punidas",8],["ceis",4],["cnep",4],["portal da transparencia",4]]', 30),
 ('tcu', 'Certidão TCU', 'TCU', 'certidoes', 'TCU',
  null, false, false, false, false, 'https://contas.tcu.gov.br/ords/f?p=1660:3:::NO:::',
  '[["tribunal de contas da uniao",8],["licitantes inidoneos",6]]', 31),
 ('cnj', 'Certidão CNJ (improbidade)', 'CNJ', 'certidoes', 'CNJ',
  null, false, false, false, false, 'https://www.cnj.jus.br/improbidade_adm/consultar_requerido.php',
  '[["condenacoes civeis por ato de improbidade",9],["conselho nacional de justica",6]]', 32),

 ('req-crm', 'Requerimento / protocolo CRM', null, 'tecnico', 'CRM',
  null, true, false, false, false, null,
  '[["requerimento",5],["protocolo",5],["conselho regional de medicina",4]]', 40),
 ('crm', 'Registro / Certidão CRM-PJ', 'CRM', 'tecnico', 'CRM',
  null, false, false, false, false, null,
  '[["conselho regional de medicina",8],["crm",3],["responsavel tecnico",3]]', 41),
 ('coren', 'Registro / Certidão COREN', 'COREN', 'tecnico', 'COREN',
  null, false, false, false, false, null,
  '[["conselho regional de enfermagem",8],["coren",4]]', 42),
 ('cnes', 'CNES', 'CNES', 'tecnico', 'DATASUS',
  null, false, false, false, false, null,
  '[["cadastro nacional de estabelecimentos de saude",9],["cnes",4]]', 43),
 ('cert-tecnico', 'Certificado de regularidade técnica', null, 'tecnico', null,
  null, false, false, false, false, null,
  '[["certidao de regularidade",5],["certificado de regularidade",5],["pessoa juridica",2]]', 44),
 ('atestado', 'Atestado de capacidade técnica', null, 'tecnico', null,
  null, true, false, false, false, null,
  '[["atestado de capacidade tecnica",9],["atestamos",5],["prestou servicos",4]]', 45),

 ('balanco', 'Balanço patrimonial / DRE', null, 'balancos', null,
  null, true, false, false, false, null,
  '[["balanco patrimonial",8],["demonstracao do resultado",6],["escrituracao contabil",5],["patrimonio liquido",4]]', 50),
 ('indices', 'Índices contábeis / declaração do contador', null, 'balancos', null,
  null, true, false, false, false, null,
  '[["indice de liquidez",6],["liquidez geral",6],["solvencia geral",5],["crc",2]]', 51),

 ('outro', 'Outro documento', null, 'outros', null, null, true, false, false, false, null, '[]', 900)
on conflict (id) do update set
  nome = excluded.nome, sigla = excluded.sigla, categoria = excluded.categoria,
  orgao_emissor = excluded.orgao_emissor, prazo_padrao_dias = excluded.prazo_padrao_dias,
  sem_validade = excluded.sem_validade, renovacao_automatica = excluded.renovacao_automatica,
  exige_captcha = excluded.exige_captcha, dado_pessoal = excluded.dado_pessoal,
  url_emissao = excluded.url_emissao, palavras_chave = excluded.palavras_chave,
  ordem = excluded.ordem;

-- ──────────────────────────────────────────────────────────────
-- 9. ONDE OS ARQUIVOS FICAM
--
-- Um balde PRIVADO. O documento de habilitação traz CNPJ, endereço,
-- quadro societário e, no caso dos sócios, RG e CPF — nada disso
-- pode ficar num endereço que qualquer um abre sabendo o caminho.
-- O acesso é por link assinado, com validade curta.
-- ──────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('habilitacao', 'habilitacao', false)
on conflict (id) do update set public = false;

drop policy if exists hab_arq_ler on storage.objects;
create policy hab_arq_ler on storage.objects
  for select using (bucket_id = 'habilitacao' and tem_nivel('habilitacao', 'V'));

drop policy if exists hab_arq_subir on storage.objects;
create policy hab_arq_subir on storage.objects
  for insert with check (bucket_id = 'habilitacao' and tem_nivel('habilitacao', 'M'));

drop policy if exists hab_arq_trocar on storage.objects;
create policy hab_arq_trocar on storage.objects
  for update using (bucket_id = 'habilitacao' and tem_nivel('habilitacao', 'M'));

drop policy if exists hab_arq_apagar on storage.objects;
create policy hab_arq_apagar on storage.objects
  for delete using (bucket_id = 'habilitacao' and tem_nivel('habilitacao', 'A'));


-- ────────────────────────────────────────────────────────────
-- CONFERÊNCIA
-- ────────────────────────────────────────────────────────────
-- O editor do Supabase mostra só o resultado do ÚLTIMO comando.
-- Por isso a conferência é UMA consulta só, e é a última do
-- arquivo — qualquer select depois dela esconderia esta.
--
-- As duas últimas colunas trazem NOMES, não contagens: um número
-- diferente do esperado não diz quem sobrou ou quem faltou, e é
-- justamente isso que a gente precisa saber.
select
  -- PARTE 1 — o contrato virando contas a pagar
  (select count(*) from information_schema.columns
    where table_name = 'contratos'
      and column_name in ('fornecedor','conta','pagamentos_variaveis',
                          'parcelas_previstas','parcelas_quitadas_fora')) as colunas_do_contrato,
  (select count(*) from pg_constraint
    where conname in ('contratos_fornecedor_fkey','contratos_conta_fkey')) as travas_do_contrato,
  -- PARTE 2 — habilitação
  (select count(*) from hab_tipo_documento)                          as tipos_no_catalogo,
  (select count(*) from hab_tipo_documento where dado_pessoal)       as com_dado_de_socio,
  (select count(*) from storage.buckets where id = 'habilitacao')    as balde_criado,
  (select string_agg(perfil || '=' || niveis, ', ' order by perfil)
     from matriz_acesso
    where modulo = 'habilitacao' and niveis <> '')                   as quem_acessa,
  (select string_agg(id, ', ' order by id)
     from perfis where acoes ? 'ver_doc_socio')                      as quem_ve_doc_de_socio;

-- ESPERADO
--   colunas_do_contrato .. 5
--   travas_do_contrato ... 2
--   tipos_no_catalogo ... 28
--   com_dado_de_socio .... 1
--   balde_criado ......... 1
--   quem_acessa .......... admin=VMA, assistente=VM, consulta=V,
--                          diretoria=VMA, socio=VMA
--   quem_ve_doc_de_socio . admin, diretoria, socio
--
-- Os demais perfis (DP, estoquista, comprador, operacional,
-- produtividade) ficam FORA de propósito: o cofre guarda contrato
-- social, balanço e documento de sócio. Quem precisar entra pela
-- tela de perfis, em Administração.
--
-- Qualquer coisa diferente disso: me mande a linha inteira.
