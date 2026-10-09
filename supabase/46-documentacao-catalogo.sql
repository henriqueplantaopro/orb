-- ERP Dom Pedro — Documentação: catálogo editável e cobertura dupla
-- Etapa 46. Roda nos dois bancos (real e teste).
--
-- Roda DEPOIS da 45. É seguro rodar mais de uma vez.
--
-- TRÊS COISAS
--
-- 1. EXIGIDO — nem todo tipo de documento é pendência. Procuração a
--    HJM não tem e não precisa; CEIS, TCU e CNJ são extras que o
--    edital pede de vez em quando. Com tudo valendo como pendência,
--    o painel fica vermelho de coisa que não falta — e painel que
--    está sempre vermelho não é lido.
--
-- 2. COMUM — o download em lote leva o que se usa sempre. O
--    documento raro continua no cofre e só entra no zip quando
--    marcado de propósito.
--
-- 3. COBRE TAMBÉM — em algumas cidades um único papel vale por
--    alvará E por dispensa sanitária. Sem isso, o painel cobra o
--    segundo documento para sempre, e a pessoa aprende a ignorar o
--    vermelho.
--
-- As três são EDITÁVEIS na tela: o que vai abaixo é só o ponto de
-- partida.

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

-- ──────────────────────────────────────────────────────────────
-- CONFERÊNCIA
-- ──────────────────────────────────────────────────────────────
-- A prova de que a view enxerga as colunas novas vai num bloco
-- que ESTOURA se faltar, e não num select à parte: o editor do
-- Supabase mostra só o resultado da última consulta, e um select
-- de conferência no meio é um select que ninguém lê. Erro grita;
-- linha de tabela no meio do caminho, não.
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
                    'de uma vez, e não por partes.', faltam;
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

-- ESPERADO: 'alvara' e 'sanitaria' agora em cadastrais, e
-- Procuração, CEIS/CNEP, TCU, CNJ, SICAF, documentos de sócio,
-- CREA, CAU, ART, COREN, índices contábeis e "Outro documento"
-- fora da lista de pendências. Tudo isso é editável na aba Tipos
-- de documento — o que está aqui é só o começo.
