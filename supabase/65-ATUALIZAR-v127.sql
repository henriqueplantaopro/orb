-- ════════════════════════════════════════════════════════════════
-- ATUALIZAR v127 · as nove colunas que faltavam em funcionarios
--
-- O QUE ESTE ARQUIVO CONSERTA
--
-- A tela do DP salvava nove campos que o banco não tinha coluna
-- para guardar. Eles iam para a coluna `extra`, em JSON, e a
-- leitura de funcionários — diferente das outras tabelas — nunca
-- desempacotava o `extra`. O efeito: o campo era digitado,
-- aparecia na ficha, continuava certo o resto do dia, e voltava
-- ao vazio na próxima vez que alguém abria o sistema.
--
-- Os nove:
--   banco, agencia, conta_bancaria, pix  → a conta de quem recebe
--     a folha. Sumindo, o pagamento sai sem destino.
--   credito_trabalhador                  → o desconto do consignado
--     em folha. Sumindo, a pessoa recebe a mais e o desconto some.
--   vt_modo, vr_modo                     → se o vale é valor fixo
--     do mês ou valor por dia útil. Sumindo, volta a "por dia":
--     um vale de R$ 500,00 fixos vira R$ 500,00 x 21 na previsão.
--   vr_desconto_modo, vr_desconto_valor  → o desconto do VR.
--
-- NADA SE PERDE. O que foi digitado até hoje está no `extra`, e a
-- v127 passa a lê-lo de volta; estas colunas só garantem que, daqui
-- em diante, cada campo tenha lugar próprio. Rodar duas vezes não
-- faz mal: todo comando é `if not exists`.
--
-- RODE NO BANCO DO AMBIENTE QUE VOCÊ ESTÁ ATUALIZANDO.
-- ════════════════════════════════════════════════════════════════

alter table funcionarios add column if not exists banco           text;
alter table funcionarios add column if not exists agencia         text;
alter table funcionarios add column if not exists conta_bancaria  text;
alter table funcionarios add column if not exists pix             text;
alter table funcionarios add column if not exists credito_trabalhador jsonb;
alter table funcionarios add column if not exists vt_modo         text;
alter table funcionarios add column if not exists vr_modo         text;
alter table funcionarios add column if not exists vr_desconto_modo  text;
alter table funcionarios add column if not exists vr_desconto_valor numeric(10,2);

-- ── O que já está preso no `extra` volta para a coluna ──────────
-- A v127 também lê o `extra` na carga, então isto não é obrigatório
-- para o sistema funcionar. É para o banco ficar consultável: um
-- relatório feito direto no Supabase, ou o contador olhando a
-- tabela, enxerga a conta bancária na coluna e não dentro de um
-- JSON. Só preenche onde a coluna está vazia — a coluna manda.
update funcionarios set
  banco              = coalesce(banco,              extra->>'banco'),
  agencia            = coalesce(agencia,            extra->>'agencia'),
  conta_bancaria     = coalesce(conta_bancaria,     extra->>'conta_bancaria'),
  pix                = coalesce(pix,                extra->>'pix'),
  credito_trabalhador= coalesce(credito_trabalhador, extra->'credito_trabalhador'),
  vt_modo            = coalesce(vt_modo,            extra->>'vt_modo'),
  vr_modo            = coalesce(vr_modo,            extra->>'vr_modo'),
  vr_desconto_modo   = coalesce(vr_desconto_modo,   extra->>'vr_desconto_modo'),
  vr_desconto_valor  = coalesce(vr_desconto_valor, (extra->>'vr_desconto_valor')::numeric)
where extra is not null and extra <> '{}'::jsonb;

-- ── O vale só tem modo onde o vale existe ───────────────────────
-- Cadastro antigo, feito antes de o campo existir, fica sem modo.
-- Sem modo, o cálculo assume "por dia útil", que é como o sistema
-- sempre se comportou — então gravar o padrão explícito não muda
-- número nenhum, só deixa de depender de um `undefined`.
update funcionarios set vt_modo = 'dia' where vale_transporte and vt_modo is null;
update funcionarios set vr_modo = 'dia' where vale_refeicao   and vr_modo is null;

-- ── A operadora do cartão ───────────────────────────────────────
-- Rio Card, Pluxee e afins são credores como qualquer outro: não
-- precisam de tabela nem de coluna. Quem recebe cada vale é
-- escolhido DENTRO DO ERP, em Pessoal → Tabelas fiscais →
-- Operadoras do vale, e guardado junto com os outros parâmetros de
-- política, que já têm lugar no banco. Não há nada a criar aqui.

-- ── Conferência ─────────────────────────────────────────────────
select
  (select count(*) from information_schema.columns
     where table_name = 'funcionarios'
       and column_name in ('banco','agencia','conta_bancaria','pix',
         'credito_trabalhador','vt_modo','vr_modo','vr_desconto_modo',
         'vr_desconto_valor')) || ' de 9 colunas criadas · ' ||
  (select count(*) from funcionarios where vale_transporte and vt_modo is null)
     || ' com VT sem modo (tem de ser 0) · ' ||
  (select count(*) from funcionarios where vale_refeicao and vr_modo is null)
     || ' com VR sem modo (tem de ser 0) · ' ||
  (select count(*) from funcionarios where coalesce(pix, banco, conta_bancaria) is not null)
     || ' com dados de pagamento na coluna'
  as diag;
