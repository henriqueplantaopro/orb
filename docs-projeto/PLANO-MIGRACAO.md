# ERP Dom Pedro — migração para a nuvem

Decisões tomadas: **Supabase (região São Paulo) + Vercel**, migração
de verdade começando pelo banco, e substituição do Protheus.

Este documento é o roteiro. O que já está pronto está marcado.

---

## O que já existe nesta pasta

- `supabase/01-schema.sql` — 43 tabelas, espelhando as coleções do
  `store.js` com os mesmos nomes de campo.
- `supabase/02-rls.sql` — as políticas de acesso **dentro do banco**,
  derivadas da matriz.
- `supabase/03-seed.sql` — 365 inserções: empresas, perfis, a matriz,
  usuários, plano de contas, 60 centros, clientes, credores, bancos,
  produtos, armazéns, cargos e os parâmetros do DP.

Falta rodar num projeto real do Supabase — é o primeiro marco.

---

## Por que a RLS é obrigatória aqui

O navegador fala direto com o Postgres pela API do Supabase.
Esconder o botão não esconde o dado: quem abrir o console e pedir
`select * from folhas` recebe a folha inteira se o banco deixar.

Três coisas que só o banco protege:

- **salário e dados bancários** de funcionário;
- **nome de paciente**, que é dado de saúde (LGPD, art. 5º, II) —
  tratado por visão, para o movimento continuar visível com o nome
  mascarado, como já funciona na tela;
- **a trilha de auditoria**, que ninguém altera nem apaga, nem o
  administrador. Trilha que o admin reescreve não serve de trilha.

A regra de negócio continua no `store.js`, onde está testada por
1311 verificações. A RLS é a rede embaixo, não a substituta.

---

## Ordem de trabalho

### Marco 1 — banco de pé (sem mexer no ERP)
Criar o projeto no Supabase, rodar os três SQL, conferir que a
matriz no banco bate com a da tela. O ERP continua rodando local,
intocado. **Nada quebra neste marco.**

### Marco 2 — login
Criar os treze usuários no Supabase Auth com o e-mail
`@dompedrosaude.com.br`, ligar cada um à linha de `usuarios`, e
trocar o seletor de usuário do canto da tela por tela de login.
Senha provisória com troca obrigatória no primeiro acesso.

Para quem aprova pagamento e para o DP, segundo fator. Não é
preciosismo: são os perfis que movem dinheiro e veem salário.

### Marco 3 — persistência, módulo a módulo
O `store.js` guarda tudo em `st` e as regras operam sobre isso. A
migração troca a camada de baixo, não as regras. Dá para fazer um
módulo por vez, com o resto seguindo em memória.

Ordem sugerida, da menor consequência para a maior:

1. Cadastros (centros, credores, clientes, produtos) — só leitura e
   escrita simples, sem regra pesada. Serve para validar a camada.
2. Estoque — tem invariante forte (`valor = saldo × médio`), que a
   bateria já confere; bom teste da camada sob regra real.
3. Financeiro — contas a pagar, receber e conciliação.
4. Procedimentos e produtividade.
5. Pessoal — por último, porque é o de pior consequência se algo
   escapar, e é o que você ainda não migrou do Protheus.

A bateria roda contra o banco em cada passo. Hoje ela leva segundos
em memória; contra o Postgres vai levar minutos — vale a pena.

### Marco 4 — carga dos dados reais
Cadastros vêm do seed. O que precisa vir do Protheus:

- saldo de estoque por armazém, na data do corte;
- contas a pagar e a receber em aberto;
- saldo das quatro contas bancárias na data do corte;
- ativos e contratos vigentes;
- ficha dos funcionários e histórico de férias.

**O corte é o ponto crítico.** Histórico fechado fica no Protheus
como consulta; o ERP começa do saldo. Tentar trazer cinco anos de
movimento é o que costuma atrasar migração em meses.

### Marco 5 — virada
Publicar na Vercel com domínio próprio, backup diário automático,
e a equipe operando.

---

## Sobre substituir o Protheus de uma vez

O risco não é o sistema — é o calendário. Se a virada cair sobre
fechamento de folha ou de faturamento, um erro não tem para onde
correr.

Sugestão concreta:

- virar **logo depois** de um fechamento concluído, com o mês novo
  começando limpo;
- manter o Protheus **em leitura** por 60 dias, não para operar, mas
  para conferir número quando alguém duvidar;
- primeiro fechamento no ERP feito **em paralelo** com a conferência
  manual que a equipe já faz hoje.

Isso não é rodar dois sistemas: é ter para onde olhar.

---

## O que precisa de você, e não de código

1. **Contrato de tratamento de dados (DPA) com o Supabase** e
   registro no seu rol da LGPD — o rol já existe, é acrescentar o
   fornecedor e a finalidade.
2. **Domínio**: `erp.dompedrosaude.com.br` ou similar, com o DNS
   apontando para a Vercel.
3. **E-mails dos treze usuários**, para criar os logins.
4. **Data do corte** — depende do calendário de fechamento.
5. **Quem é o administrador** do Supabase além de você: conta única
   de administrador é ponto único de falha.

---

## Custo esperado

Supabase: o plano gratuito atende em volume, mas não tem backup
diário retido nem suporte — para dado de folha e faturamento, o
plano pago (cerca de US$ 25/mês) é o mínimo razoável. Vercel: o
plano gratuito serve, já que a aplicação é estática.

Abaixo de R$ 200/mês no total, com backup e domínio.
