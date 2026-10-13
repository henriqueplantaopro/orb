-- ERP Dom Pedro — o que existe hoje em Financeiro, Faturamento
-- e Produtividade
-- Etapa 53. Rode PRIMEIRO, no banco que você quer limpar.
--
-- Esta consulta NÃO altera nada. Ela existe para você ver o que
-- seria apagado antes de apagar: quantas linhas, de quando até
-- quando, e o valor envolvido.
--
-- LEIA A COLUNA `de` e `ate`. Se tudo for do dia em que a sessão
-- errada rodou, a limpeza inteira é segura. Se aparecer coisa de
-- outras datas, NÃO rode o 54 — me mande esta tabela que eu faço a
-- limpeza por período.

with q as (
  select 'Financeiro'   as modulo, 'titulos'               as tabela, count(*) as linhas,
         min(criado_em)::date as de, max(criado_em)::date as ate,
         coalesce(sum(valor_total), 0) as valor                  from titulos
  union all
  select 'Financeiro', 'parcelas', count(*), min(criado_em)::date, max(criado_em)::date,
         coalesce(sum(valor), 0)                                 from parcelas
  union all
  select 'Financeiro', 'pagamentos', count(*), min(criado_em)::date, max(criado_em)::date,
         coalesce(sum(valor), 0)                                 from pagamentos
  union all
  select 'Financeiro', 'retencoes_registradas', count(*), null, null,
         coalesce(sum(valor), 0)                                 from retencoes_registradas
  union all
  select 'Financeiro', 'guias_retencao', count(*), min(criado_em)::date, max(criado_em)::date,
         coalesce(sum(total), 0)                                 from guias_retencao
  union all
  select 'Financeiro', 'extratos', count(*), null, null, 0        from extratos
  union all
  select 'Financeiro', 'linhas_extrato', count(*), min(data), max(data),
         coalesce(sum(valor), 0)                                 from linhas_extrato
  union all
  select 'Financeiro', 'saldos_informados', count(*), min(data), max(data),
         coalesce(sum(valor), 0)                                 from saldos_informados
  union all
  select 'Financeiro', 'transferencias_banco', count(*), min(data), max(data),
         coalesce(sum(valor), 0)                                 from transferencias_banco
  union all
  select 'Faturamento', 'receber', count(*), min(emissao), max(emissao),
         coalesce(sum(valor_bruto), 0)                           from receber
  union all
  select 'Faturamento', 'previsoes', count(*), null, null,
         coalesce(sum(faturamento), 0)                           from previsoes
  union all
  select 'Faturamento', 'lotes_rps', count(*), min(criado_em)::date, max(criado_em)::date, 0
                                                                 from lotes_rps
  union all
  select 'Produtividade', 'lotes_produtividade', count(*), min(criado_em)::date,
         max(criado_em)::date, coalesce(sum(valor), 0)           from lotes_produtividade
  union all
  -- NÃO entram na limpeza. Estão aqui só para você conferir que
  -- continuam de pé depois: cadastro não é lançamento.
  select 'NAO SERA APAGADO', 'empresas', count(*), null, null, 0  from empresas
  union all
  select 'NAO SERA APAGADO', 'centros', count(*), null, null, 0   from centros
  union all
  select 'NAO SERA APAGADO', 'credores', count(*), null, null, 0  from credores
  union all
  select 'NAO SERA APAGADO', 'clientes', count(*), null, null, 0  from clientes
  union all
  select 'NAO SERA APAGADO', 'bancos', count(*), null, null, 0    from bancos
  union all
  select 'NAO SERA APAGADO', 'contratos', count(*), null, null, 0 from contratos
  union all
  select 'NAO SERA APAGADO', 'regras_conciliacao', count(*), null, null, 0
                                                                 from regras_conciliacao
)
select modulo, tabela, linhas,
       coalesce(to_char(de,  'DD/MM/YYYY'), '—') as de,
       coalesce(to_char(ate, 'DD/MM/YYYY'), '—') as ate,
       to_char(valor, 'FM999G999G990D00')        as valor
  from q
 -- Tudo aparece, inclusive o que está zerado: numa tela que serve
 -- para decidir se apaga, a linha com zero é informação, e a linha
 -- escondida vira dúvida.
 order by case modulo when 'Financeiro' then 1 when 'Faturamento' then 2
                      when 'Produtividade' then 3 else 4 end, tabela;
