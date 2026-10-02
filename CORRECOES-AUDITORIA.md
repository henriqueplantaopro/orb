# Resposta à auditoria do site publicado

Cinco achados, quatro defeitos meus. O que mudou:

## 1. Pagamento entre empresas travava

O sistema avisava que a nota era de uma empresa e a conta de outra,
mas não havia como confirmar — clicar de novo repetia o aviso e o
pagamento nunca entrava. Regra pela metade: travava o trabalho sem
proteger nada.

Agora o aviso abre uma confirmação que mostra quem paga, quem deve
e o valor, com campo de observação. Confirmando, o mútuo entre as
empresas fica registrado. O botão "Voltar e trocar a conta"
continua disponível para quem errou a conta.

## 2. Estoque, compras e os demais não gravavam

Verdade, e era o planejado para esta etapa — mas ficou só o
financeiro ligado, o que é pior que nada, porque parece que grava.

Agora são **25 coleções**: estoque (camadas, movimentos e saldo),
procedimentos, fechamentos, compras, ativos, ordens de serviço,
produtividade, RPS, folhas e décimos, além do financeiro.

O saldo de estoque precisou de tratamento à parte: não é lista com
id, é posição indexada por produto e armazém.

Exige rodar o `supabase/10-modulos.sql`.

## 3. Ativos bloqueado para quem tinha permissão

O módulo checava uma lista `modulos` dentro do perfil. Essa lista
existia no cadastro embutido e **não existe na tabela do banco** —
então, depois da migração, o módulo se bloqueava para todo mundo,
inclusive para quem tinha V M $ A na matriz.

Corrigido em três lugares: o bloqueio do módulo, a contagem de
módulos na lista de usuários (que mostrava "0 módulo(s)") e a tela
de edição de perfil, que quebrava ao abrir.

A matriz é a fonte, e agora é ela que todos consultam.

## 4. Procedimentos não liberava o material

Mesmo defeito do plano de contas: a coluna `especialidade` dos
armazéns não foi para o esquema. É ela que liga a sala à
especialidade e faz o sistema saber de qual estoque baixar.

Corrigido nos dois lados: coluna criada no banco (no
`10-modulos.sql`), e, se ela não existir, o sistema deduz pelo
código da sala (`HGB-CC-OFTALMO` → OFTALMO).

## 5. Formato numérico e de data

- **Campo "Valor total"**: formata ao sair do campo — 1.234.567,00.
- **Competência no relatório**: sai 10/2026, não 2026-10.
- **CNPJ em Matriz e filiais**: com máscara, como na lista de
  fornecedores. Guardado sem pontuação porque é o que o XML da nota
  exige; exibido com ela.
- **"October 2026"**: este é diferente dos outros. O campo de
  competência é o controle nativo do navegador (`input type=month`),
  e quem decide o idioma é o navegador de quem usa, não o sistema.
  Em português ele mostra "outubro de 2026".

  Para ficar `10/2026` em qualquer navegador, seria preciso trocar
  os 26 campos de mês e os de data por campos de texto com máscara
  — some o seletor visual e passa a haver digitação a validar.
  **Não fiz**, porque a troca é grande e muda o jeito de usar.
  Me diga se quer, que faço em uma versão só.

## Sobre o TST-0001

Pode deixar. Serve de caso de teste com rateio e parcelamento, e
quando a importação do Protheus entrar a gente limpa tudo junto.
