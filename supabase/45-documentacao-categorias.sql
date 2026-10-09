-- ERP Dom Pedro — Documentação: categorias do cofre
-- Etapa 45. Roda nos dois bancos (real e teste).
--
-- POR QUE
--
-- O cofre nasceu com cinco categorias: cadastrais, certidoes,
-- tecnico, balancos, outros. Na prática isso não serve para a
-- pergunta que se faz ao montar uma habilitação, que é "me dá os
-- técnicos do CRM" ou "me dá só os atestados".
--
-- Três mudanças:
--
--   `tecnico` se parte em TECNICO_CRM (conselhos da saúde: CRM,
--   COREN, CNES, regularidade técnica) e TECNICO_CREA (engenharia:
--   CREA, CAU, ART). São exigidos por editais diferentes e nunca
--   são pedidos juntos.
--
--   ATESTADO sai de `tecnico` e vira categoria própria. Ele não é
--   registro em conselho: é prova de que a empresa já executou o
--   objeto, e é a peça mais disputada de qualquer habilitação.
--
--   `balancos` vira CONTABEIS, que é o nome que o edital usa.
--
-- É seguro rodar mais de uma vez.

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

-- ──────────────────────────────────────────────────────────────
-- CONFERÊNCIA
-- ──────────────────────────────────────────────────────────────
select categoria, count(*) as tipos,
       string_agg(nome, ', ' order by ordem) as quais
  from hab_tipo_documento
 where ativo
 group by categoria
 order by min(ordem);

-- ESPERADO: sete categorias, nenhuma chamada 'tecnico' nem
-- 'balancos', e 'atestados' com um tipo só (Atestado de capacidade
-- técnica). Se aparecer 'tecnico' ou 'balancos', o update não
-- pegou — me mande a tabela inteira.
