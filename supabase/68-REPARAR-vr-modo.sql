-- ════════════════════════════════════════════════════════════════
-- REPARAR · o modo do vale-refeição dos cadastros de R$ 400,00
--
-- ISTO NÃO É UMA MIGRAÇÃO DE VERSÃO. É um conserto de dado, uma
-- vez só, do estrago que o defeito da v131 deixou para trás.
--
-- O QUE ACONTECEU, em uma frase: suas correções nunca chegaram ao
-- banco. Você trocou "por dia útil" por "fixo no mês" três vezes,
-- a tela mostrou o valor novo, e o sistema devolveu sucesso sem
-- gravar nada — nem na coluna, nem na trilha. Por isso não havia
-- registro seu em `eventos`: não houve gravação nenhuma.
--
-- ────────────────────────────────────────────────────────────────
-- O FILTRO QUE IMPORTA: `vr_dia = 400`. SÓ ELES.
--
-- O conserto NÃO é "todo mundo que está por dia útil". Há quem
-- esteja por dia útil de verdade — o funcionário de R$ 40,00/dia é
-- exatamente isso, e virar R$ 40,00 fixos no mês seria trocar um
-- erro por outro, desta vez para menos e muito mais difícil de
-- notar.
--
-- O que caracteriza o grupo estragado não é o modo, é o VALOR: os
-- R$ 400,00 que foram lançados como diária e você converteu para
-- mensal. R$ 400,00 por dia útil dariam uns R$ 8.000,00 de
-- vale-refeição por mês para uma pessoa — não existe. Por isso o
-- valor identifica o grupo sem ambiguidade, e QUALQUER OUTRO VALOR
-- FICA DE FORA por padrão: R$ 40,00, R$ 250,00, o que houver.
--
-- Se um dia existir alguém que receba R$ 400,00 por dia útil de
-- verdade, este arquivo passa a estar errado. Ele é de uso único,
-- para hoje.
-- ────────────────────────────────────────────────────────────────
--
-- É UM COMANDO SÓ, de propósito: o editor do Supabase mostra
-- apenas o resultado do último comando, então um arquivo com
-- "confira antes / rode depois" esconderia justamente a lista de
-- conferência. Aqui o conserto e o relatório saem juntos.
--
-- A TABELA QUE VOLTA lista TODOS os funcionários com
-- vale-refeição, inclusive os que não foram tocados, para você
-- conferir de uma olhada quem ficou de fora e por quê.
--
-- ────────────────────────────────────────────────────────────────
-- ANTES DE RODAR: suba a v132. Sem ela o sistema volta a descartar
-- edição de funcionário, e o problema se repete na próxima vez.
--
-- DEPOIS DE RODAR: RECARREGUE O ERP (F5, ou feche e abra).
-- Se ficar com a aba velha aberta, ela ainda tem na memória o
-- valor antigo; agora que a gravação funciona de verdade, a
-- próxima alteração que você fizer nessa aba mandaria o valor
-- antigo de volta por cima deste conserto.
--
-- SÓ MEXE EM vr_modo. O vale-transporte fica como está: ele é por
-- dia útil de verdade (passagem), e você não pediu para mudar.
--
-- Rodar duas vezes não faz mal: na segunda não acha nada para
-- mudar, e a tabela volta mostrando todo mundo já correto.
--
-- RODE NO BANCO REAL (jsdyowuqehryfwqyklax).
-- ════════════════════════════════════════════════════════════════

with corrigidos as (
  update funcionarios
     set vr_modo = 'mes'
   where coalesce(ativo, true)
     and vale_refeicao
     and vr_dia = 400
     and coalesce(vr_modo, 'dia') <> 'mes'
  returning id
)
select
  case
    when f.id in (select id from corrigidos)
      then '1 · CORRIGIDO AGORA  (por dia útil → fixo no mês)'
    when coalesce(f.vr_modo, 'dia') = 'mes'
      then '2 · já estava certo, não foi tocado'
    else
      '3 · NÃO FOI TOCADO — valor diferente de R$ 400,00'
  end                                                                as situacao,
  f.matricula,
  f.nome,
  -- Separador brasileiro sem depender da configuração regional do
  -- servidor: `G` e `D` seguem o locale (e o do Supabase não é o
  -- nosso, por isso sairia 8,000.00). Com `,` e `.` literais o
  -- resultado é sempre o mesmo, e o `translate` troca os dois de
  -- lugar de uma vez só.
  'R$ ' || translate(to_char(f.vr_dia, 'FM9,999,990.00'), '.,', ',.') as vr_cadastrado,
  case
    when f.id in (select id from corrigidos) then 'fixo no mês'
    when coalesce(f.vr_modo, 'dia') = 'mes'  then 'fixo no mês'
    else 'por dia útil'
  end                                                                as modo_agora
from funcionarios f
where coalesce(f.ativo, true)
  and f.vale_refeicao
order by 1, f.nome;

-- Confira a lista "3": são os que continuam por dia útil. Se algum
-- deles devesse ser fixo no mês, abra o cadastro no ERP e mude por
-- lá — agora a alteração fica gravada.
--
-- Quanto isso deixa de custar não cabe aqui: o sistema multiplica
-- o valor/dia pelos DIAS ÚTEIS DE CADA MÊS, que mudam de mês para
-- mês. Qualquer número fixo escrito neste arquivo seria chute. O
-- valor certo aparece em Financeiro → Contas a pagar assim que
-- você recarregar.
