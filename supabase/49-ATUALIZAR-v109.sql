-- ERP Dom Pedro — ATUALIZAR para a v109
-- Etapa 49. Roda nos DOIS bancos (real e teste).
--
-- Este arquivo é o 45 e o 46 juntos, na ordem certa, com UMA
-- conferência no fim — porque o editor do Supabase mostra só o
-- resultado da última consulta, e conferência no meio é
-- conferência que ninguém lê.
--
-- É seguro rodar mais de uma vez.
--
-- O QUE ELE FAZ
--
--   PARTE 1 (era o 45) — as categorias do cofre. `tecnico` se parte
--   em técnicos do CRM e técnicos do CREA; atestado vira categoria
--   própria; `balancos` passa a se chamar contábeis, que é o nome
--   que o edital usa. Entram os tipos de engenharia (CREA, CAU,
--   ART).
--
--   PARTE 2 (era o 46) — o catálogo passa a decidir três coisas que
--   antes estavam fixas no programa: se o tipo conta como pendência
--   no painel (`exigido`), se entra no download em lote (`comum`) e
--   se um documento pode valer por mais de um tipo
--   (`cobre_tambem`). As três se editam na aba Tipos de documento;
--   o que vai aqui é só o ponto de partida.
--
--   E a view `hab_documento_vigente` é refeita, porque ela foi
--   criada com `select d.*` e o `*` é expandido NA CRIAÇÃO:
--   acrescentar coluna à tabela não a acrescenta à view, e a tela lê
--   a view.

-- ══════════════════════════════════════════════════════════════
-- PARTE 1 — categorias do cofre
-- ══════════════════════════════════════════════════════════════
-- ──────────────────────────────────────────────────────────────
-- 1. Recategoriza o que já existe
-- ──────────────────────────────────────────────────────────────
update hab_tipo_documento set categoria = 'tecnico_crm'
 where id in ('req-crm', 'crm', 'coren', 'cnes', 'cert-tecnico');

update hab_tipo_documento set categoria = 'atestados'
 where id = 'atestado';

update hab_tipo_documento set categoria = 'contabeis'
 where categoria = 'balancos';

-- ──────────────────────────────────────────────────────────────
-- 2. Os tipos de engenharia
--
-- A HJM não tem nenhum hoje. Entram porque o edital de obra ou de
-- manutenção predial pede, e porque um cofre que não tem a gaveta
-- obriga a guardar tudo em "Outro documento" — que é onde documento
-- vai para não ser achado.
-- ──────────────────────────────────────────────────────────────
insert into hab_tipo_documento
  (id, nome, sigla, categoria, orgao_emissor, prazo_padrao_dias, sem_validade,
   renovacao_automatica, exige_captcha, dado_pessoal, url_emissao, palavras_chave, ordem)
values
 ('crea', 'Registro / Certidão CREA-PJ', 'CREA', 'tecnico_crea',
  'Conselho Regional de Engenharia e Agronomia',
  null, false, false, false, false, null,
  '[["conselho regional de engenharia",9],["crea",4],["registro de pessoa juridica",3]]', 46),
 ('cau', 'Registro / Certidão CAU', 'CAU', 'tecnico_crea',
  'Conselho de Arquitetura e Urbanismo',
  null, false, false, false, false, null,
  '[["conselho de arquitetura e urbanismo",9],["cau",4]]', 47),
 ('art', 'ART / RRT — responsabilidade técnica', 'ART', 'tecnico_crea',
  'CREA / CAU',
  null, true, false, false, false, null,
  '[["anotacao de responsabilidade tecnica",9],["registro de responsabilidade tecnica",9],["art",2]]', 48)
on conflict (id) do update set
  nome = excluded.nome, sigla = excluded.sigla, categoria = excluded.categoria,
  orgao_emissor = excluded.orgao_emissor, prazo_padrao_dias = excluded.prazo_padrao_dias,
  sem_validade = excluded.sem_validade, palavras_chave = excluded.palavras_chave,
  ordem = excluded.ordem;

-- ──────────────────────────────────────────────────────────────
-- 3. O comentário da coluna acompanha
-- ──────────────────────────────────────────────────────────────
comment on column hab_tipo_documento.categoria is
  'cadastrais | certidoes | tecnico_crm | tecnico_crea | atestados | contabeis | outros';

-- ══════════════════════════════════════════════════════════════
-- PARTE 2 — o catálogo passa a decidir
-- ══════════════════════════════════════════════════════════════
alter table hab_tipo_documento
  add column if not exists exigido boolean not null default true,
  add column if not exists comum   boolean not null default true;

comment on column hab_tipo_documento.exigido is
  'Entra no checklist do painel como pendência quando falta.';
comment on column hab_tipo_documento.comum is
  'Entra marcado por padrão no download em lote.';

-- Um documento pode valer por outros tipos além do seu.
alter table hab_documento
  add column if not exists cobre_tambem jsonb not null default '[]'::jsonb;

comment on column hab_documento.cobre_tambem is
  'Outros tipos que este mesmo documento satisfaz (ids de hab_tipo_documento).';

-- ──────────────────────────────────────────────────────────────
-- O alvará é documento CADASTRAL, não certidão
--
-- Certidão é declaração de que não há débito, e vence sozinha. O
-- alvará é licença de funcionamento: é a autorização em si. Estavam
-- juntos porque os dois vencem, o que não faz deles a mesma coisa.
-- ──────────────────────────────────────────────────────────────
update hab_tipo_documento set categoria = 'cadastrais'
 where id in ('alvara', 'sanitaria');

-- ──────────────────────────────────────────────────────────────
-- O que NÃO é pendência
--
-- Só muda o que nunca foi mexido na tela: `where exigido` sem mais
-- nada reverteria, a cada execução, a decisão que você tiver
-- tomado. Por isso a marca de "já ajustado" fica no `extra`.
-- ──────────────────────────────────────────────────────────────
update hab_tipo_documento
   set exigido = false,
       extra = extra || '{"padrao_exigido_aplicado": true}'::jsonb
 where id in ('procuracao', 'cgu', 'tcu', 'cnj', 'sicaf', 'socios',
              'crea', 'cau', 'art', 'coren', 'indices', 'outro')
   and not (extra ? 'padrao_exigido_aplicado');

-- ──────────────────────────────────────────────────────────────
-- O que NÃO entra no download por padrão
-- ──────────────────────────────────────────────────────────────
update hab_tipo_documento
   set comum = false,
       extra = extra || '{"padrao_comum_aplicado": true}'::jsonb
 where id in ('procuracao', 'crea', 'cau', 'art', 'coren', 'socios', 'outro',
              'req-crm', 'indices')
   and not (extra ? 'padrao_comum_aplicado');

-- ──────────────────────────────────────────────────────────────
-- A VIEW TEM DE SER REFEITA
--
-- `hab_documento_vigente` foi criada com `select d.*`, e o `*` é
-- expandido NA CRIAÇÃO: o Postgres grava a lista de colunas que
-- existia naquele momento. Acrescentar `cobre_tambem` à tabela não
-- a acrescenta à view — e a tela lê a view, não a tabela.
--
-- Sem isto, o campo salva no banco e a tela nunca o vê de volta:
-- a cobertura dupla pareceria não ter sido gravada.
--
-- A ordem é obrigatória: a view sai antes porque depende da
-- função, e volta idêntica logo abaixo.
-- ──────────────────────────────────────────────────────────────
drop view if exists hab_documento_vigente;

create view hab_documento_vigente as
select d.*,
       t.nome          as tipo_nome,
       t.sigla         as tipo_sigla,
       t.categoria     as tipo_categoria,
       t.sem_validade  as tipo_sem_validade,
       t.dado_pessoal  as tipo_dado_pessoal,
       t.url_emissao   as tipo_url_emissao,
       t.exigido       as tipo_exigido,
       t.comum         as tipo_comum,
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

grant select on hab_documento_vigente to authenticated;

-- ══════════════════════════════════════════════════════════════
-- CONFERÊNCIA
-- ══════════════════════════════════════════════════════════════
-- A prova de que a view enxerga as colunas novas vai num bloco que
-- ESTOURA se faltar, e não num select à parte: erro grita, linha de
-- tabela no meio do caminho não.
do $$
declare faltam text;
begin
  select string_agg(c, ', ') into faltam
    from unnest(array['cobre_tambem', 'tipo_exigido', 'tipo_comum']) as c
   where not exists (select 1 from information_schema.columns
                      where table_name = 'hab_documento_vigente'
                        and column_name = c);
  if faltam is not null then
    raise exception 'A view hab_documento_vigente ficou sem: %. Rode este arquivo inteiro, '
                    'de uma vez, e nao por partes.', faltam;
  end if;
end $$;

-- E a mesma prova para as categorias antigas: se alguma sobrou, o
-- update da parte 1 não pegou.
do $$
declare sobrou text;
begin
  select string_agg(distinct categoria, ', ') into sobrou
    from hab_tipo_documento where categoria in ('tecnico', 'balancos');
  if sobrou is not null then
    raise exception 'Sobrou categoria antiga: %. A parte 1 nao pegou.', sobrou;
  end if;
end $$;

select categoria,
       count(*)                                  as tipos,
       count(*) filter (where exigido)           as exigidos,
       count(*) filter (where comum)             as no_download,
       string_agg(nome, ', ' order by nome) filter (where not exigido) as nao_sao_pendencia
  from hab_tipo_documento
 where ativo
 group by categoria
 order by min(ordem);

-- ESPERADO: sete categorias, nenhuma chamada 'tecnico' nem
-- 'balancos'; 'alvara' e 'sanitaria' em cadastrais; e Procuração,
-- CEIS/CNEP, TCU, CNJ, SICAF, documentos de sócio, CREA, CAU, ART,
-- COREN, índices contábeis e "Outro documento" fora da lista de
-- pendências. Tudo isso é editável na aba Tipos de documento — o
-- que está aqui é só o começo.
