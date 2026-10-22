-- ════════════════════════════════════════════════════════════════
-- CONFERIR · onde está guardado o prazo de cada projeto
--
-- SÓ LÊ. Um comando, uma tabela, uma linha por projeto ativo.
--
-- POR QUE ESTE ARQUIVO EXISTE: você disse que a previsão de
-- outubro ficou TODA em 30/11, perdendo a lógica por projeto.
-- 30/11 é exatamente o que sai quando o sistema não acha prazo
-- nenhum e cai no padrão de 30 dias (último dia de outubro + 30).
--
-- Mas no meu banco de teste isso NÃO acontece: lá todos os 56
-- projetos têm prazo gravado na própria linha do projeto, e as
-- datas saem espalhadas. Ou seja, os seus dados estão guardados
-- de um jeito diferente dos meus, e eu não vou adivinhar qual.
--
-- O sistema procura o prazo nesta ordem:
--   1º  prazo_dias do CLIENTE ligado ao projeto
--   2º  prazo_dias do PROJETO
--   3º  recebimento_dia do projeto (paga em dia fixo do mês)
--   4º  30 dias, o padrão — é aqui que todo mundo vira 30/11
--
-- A coluna `de_onde_sai_o_prazo` responde a pergunta. Se vier
-- "4 · NENHUM" na maioria das linhas, o cadastro está vazio e o
-- conserto é preencher o prazo, não mexer no código. Se vier
-- "1 · CLIENTE", o prazo existe e o código é que estava
-- ignorando — que é o defeito que a v135 corrige.
--
-- RODE NO BANCO REAL (jsdyowuqehryfwqyklax).
-- ════════════════════════════════════════════════════════════════

-- `recebimento_dia` e `recebimento_mes_offset` NÃO são colunas da
-- tabela: moram dentro do campo `extra` (JSON), que é onde o
-- sistema guarda o que não virou coluna. Conferido contra o banco
-- antes de te mandar este arquivo.
with p as (
  select
    c.*,
    nullif(c.extra ->> 'recebimento_dia', '')::int        as receb_dia,
    nullif(c.extra ->> 'recebimento_mes_offset', '')::int as receb_offset
  from centros c
)
select
  c.curto                                                as projeto,
  c.nome,
  case
    when cli.prazo_dias is not null and cli.prazo_dias > 0
      then '1 · CLIENTE (' || cli.prazo_dias || ' dias)'
    when c.prazo_dias is not null and c.prazo_dias > 0
      then '2 · PROJETO (' || c.prazo_dias || ' dias)'
    when c.receb_dia is not null
      then '3 · DIA FIXO (dia ' || c.receb_dia || ')'
    else '4 · NENHUM — cai no padrão de 30 dias'
  end                                                    as de_onde_sai_o_prazo,
  coalesce(cli.nome, '— sem cliente ligado —')           as cliente,
  coalesce(cli.prazo_dias::text, '—')                    as prazo_no_cliente,
  coalesce(c.prazo_dias::text,   '—')                    as prazo_no_projeto,
  coalesce(c.receb_dia::text, '—')                       as dia_fixo,
  coalesce(c.receb_offset::text, '—')                    as meses_depois,
  -- A data que a competência 10/2026 teria, pela regra acima.
  -- É o número que você viu na tela: se tudo vier 30/11/2026, é
  -- porque o prazo não está cadastrado em lugar nenhum.
  to_char(
    case
      -- Projeto que paga em DIA FIXO do mês (e sem prazo em dias):
      -- a conta é outra, e escrever a conta errada aqui só
      -- confundiria a conferência.
      when coalesce(nullif(cli.prazo_dias, 0), nullif(c.prazo_dias, 0)) is null
       and c.receb_dia is not null
      then (date_trunc('month', date '2026-10-01')
              + make_interval(months => coalesce(c.receb_offset, 1)))::date
           + least(c.receb_dia,
                   extract(day from (date_trunc('month', date '2026-10-01')
                     + make_interval(months => coalesce(c.receb_offset, 1))
                     + interval '1 month - 1 day'))::int) - 1
      else (date_trunc('month', date '2026-10-01') + interval '1 month - 1 day')::date
           + coalesce(nullif(cli.prazo_dias, 0), nullif(c.prazo_dias, 0), 30)
    end,
    'DD/MM/YYYY')                                        as vencimento_de_10_2026
from p c
left join clientes cli on cli.id = c.cliente
where coalesce(c.ativo, true)
  and c.tipo = 'projeto'
order by 3, c.curto;

-- Se a coluna `cliente` vier "— sem cliente ligado —" em tudo, o
-- problema é outro: os projetos não estão amarrados a um cliente,
-- e aí o prazo do cliente nunca seria achado mesmo. Me diga o que
-- aparecer e eu sigo daí — sem chutar.
