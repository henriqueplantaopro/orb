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
  add column if not exists previsoes_geradas_em timestamptz;

-- Traz o que está no `extra` para as colunas recém-criadas. A etapa
-- 40 faz isso para o banco inteiro; aqui fica a parte do contrato,
-- para quem rodar só esta.
update contratos
   set fornecedor = coalesce(fornecedor, nullif(extra ->> 'fornecedor', '')),
       conta      = coalesce(conta,      nullif(extra ->> 'conta', ''))
 where extra ? 'fornecedor' or extra ? 'conta';

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

-- ──────────────────────────────────────────────────────────────
-- Conferência
-- ──────────────────────────────────────────────────────────────
select count(*) filter (where parte = 'fornecedor') as contratos_de_fornecedor,
       count(*) filter (where parte = 'fornecedor' and fornecedor is null) as sem_fornecedor,
       count(*) filter (where parte = 'fornecedor' and conta is null)      as sem_natureza,
       count(*) filter (where pagamentos_variaveis)                        as com_cronograma
  from contratos;

-- Contratos de fornecedor que ainda não geraram contas a pagar:
select c.numero, c.fornecedor, c.valor_mensal, c.vigencia_ini, c.vigencia_fim
  from contratos c
 where c.parte = 'fornecedor' and not c.encerrado
   -- a referência ganha sufixo (-r2, -r3) a cada refazimento do
   -- cronograma, então o teste é por prefixo
   and not exists (select 1 from titulos t
                    where t.origem = 'contrato'
                      and (t.origem_ref = 'contrato-' || c.id
                        or t.origem_ref like 'contrato-' || c.id || '-r%'))
 order by c.numero;
