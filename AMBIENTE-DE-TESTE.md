# Criar o ambiente de teste

Um segundo sistema, idêntico ao real, com **banco próprio**. Nada
do que for lançado nele aparece no sistema de verdade.

O topo fica laranja e o cabeçalho ganha o selo "Ambiente de
teste". A cor existe para uma coisa só: impedir que alguém lance no
lugar errado. Dois sistemas iguais em abas vizinhas é pedido de
confusão — e no financeiro a confusão só aparece no fechamento,
quando já virou retrabalho de dias.

## Por que banco separado

Dá para fazer só um link diferente apontando para o mesmo banco. É
mais rápido e é uma armadilha: cada lançamento de brincadeira vira
sujeira no financeiro real, e descobrir meses depois qual título
era teste custa mais do que o trabalho que isto economiza.

## 1. Criar o banco de teste

No Supabase, **New project**. Nome `orb-teste`, mesma região (São
Paulo). Anote a URL e a chave `anon` que ele gerar.

O plano gratuito permite dois projetos, então não há custo.

## 2. Montar a estrutura

No SQL Editor **do projeto novo**, DOIS arquivos, nesta ordem:

1. `supabase/MONTAR-TESTE.sql` — as 43 tabelas, as políticas de
   acesso e os dados de demonstração. (É a união de 01-schema,
   02-rls, 03-seed e 04-ajustes: eles existem soltos na pasta, mas
   rodar o unificado evita errar a ordem.)
2. `supabase/ATUALIZAR-TUDO.sql` — as etapas 06 a 27.

O seed vem de propósito: no ambiente de teste, dado de
demonstração é o que dá o que mexer sem medo.

**Não rode no teste:** o `24-limpar-para-uso.sql`, que apagaria
justamente esses dados, nem as cargas `25` e `26`, que trazem os
cadastros reais.

## 3. Criar os acessos

Em Authentication › Users, crie os logins de quem vai testar, com
*Auto Confirm User* marcado. Pode usar os mesmos e-mails do
sistema real — são bancos diferentes, não há conflito.

Depois, no SQL Editor:

```sql
update usuarios
   set auth_id = (select id from auth.users where email = usuarios.email)
 where email is not null and auth_id is null;
```

## 4. Publicar o site

No Vercel, **Add New › Project** com o mesmo repositório do
sistema. Nome: `orb-teste`. O endereço fica `orb-teste.vercel.app`.

Em **Settings › Git**, aponte para um ramo separado (por exemplo
`teste`), ou mantenha o mesmo ramo se quiser que teste e produção
andem sempre juntos.

## 5. Apontar para o banco de teste

No `js/config.js` **do projeto de teste**, três linhas mudam:

```js
url: 'https://SEU-PROJETO-TESTE.supabase.co',
anon: 'CHAVE-ANON-DO-PROJETO-TESTE',
ambiente: 'teste',
```

É o `ambiente: 'teste'` que pinta o topo de laranja.

## O cuidado que isto exige

Os dois sites saem do mesmo repositório. Se você usar o mesmo ramo
para os dois, **toda atualização sobrescreve o `config.js`** e o
ambiente de teste volta a apontar para o banco real — laranja sumido
e teste gravando em produção.

Duas formas de evitar:

**Ramo separado** (recomendado): o ramo `teste` tem o seu próprio
`config.js` e só recebe o que você mandar para ele.

**Variável no Vercel**: em Settings › Environment Variables do
projeto de teste, mas isso exige mudar o código para ler de lá.

Enquanto for só você atualizando, o ramo separado resolve.
