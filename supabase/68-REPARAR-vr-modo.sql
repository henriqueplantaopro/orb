-- ════════════════════════════════════════════════════════════════
-- REPARAR · o modo do vale-refeição dos 12 cadastros antigos
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
-- POR QUE SÓ 12 E NÃO OS 19: os cadastros 0013–0020 foram CRIADOS
-- depois, e criar funcionário passa por outro caminho, que grava.
-- Os 0001–0012 nasceram antes de a coluna existir, ficaram em
-- NULL, e o 65-ATUALIZAR-v127 gravou neles o padrão 'dia' — que
-- era o que o sistema já vinha calculando. Esse SQL não apagou
-- correção sua: não havia correção no banco para apagar.
--
-- ════════════════════════════════════════════════════════════════
-- ANTES DE RODAR: suba a v132. Sem ela o sistema volta a descartar
-- edição de funcionário, e o problema se repete na próxima vez.
--
-- DEPOIS DE RODAR: RECARREGUE O ERP (F5, ou feche e abra).
-- Se ficar com a aba velha aberta, ela ainda tem na memória o
-- valor antigo; agora que a gravação funciona de verdade, a
-- próxima alteração que você fizer nessa aba mandaria o 'dia' de
-- volta por cima deste conserto. Recarregar resolve.
--
-- SÓ MEXE EM vr_modo. O vale-transporte fica como está: ele é por
-- dia útil de verdade (passagem), e você nunca pediu para mudar.
--
-- Rodar duas vezes não faz mal: na segunda não acha nada para
-- mudar e devolve zero linhas.
--
-- RODE NO BANCO REAL (jsdyowuqehryfwqyklax).
-- ════════════════════════════════════════════════════════════════

update funcionarios
   set vr_modo = 'mes'
 where coalesce(ativo, true)
   and vale_refeicao
   and coalesce(vr_modo, 'dia') <> 'mes'
returning
  matricula,
  nome,
  -- Separador brasileiro sem depender da configuração regional do
  -- servidor: `G` e `D` seguem o locale (e o do Supabase não é o
  -- nosso, por isso saía 8,000.00). Com `,` e `.` literais o
  -- resultado é sempre o mesmo, e o `translate` troca os dois de
  -- lugar de uma vez só.
  'R$ ' || translate(to_char(vr_dia, 'FM9,999,990.00'), '.,', ',.') as vr_cadastrado,
  'por dia útil'                                                    as antes,
  'fixo no mês'                                                     as agora;

-- Quanto isso deixa de custar não cabe aqui: o sistema multiplica o
-- valor/dia pelos DIAS ÚTEIS DE CADA MÊS, que mudam de mês para
-- mês. Qualquer número fixo escrito neste arquivo seria chute. O
-- valor certo aparece em Financeiro → Contas a pagar assim que você
-- recarregar.

-- A lista acima é exatamente o que mudou. Confira os nomes: se
-- algum deles for mesmo por dia útil, abra o cadastro dele no ERP
-- e volte para "por dia útil" — agora a alteração fica gravada.
