# Criar o seu login e entrar pela primeira vez

O banco já está de pé. Falta você existir como login.

## 1. Criar o usuário no Supabase

No painel do projeto, menu **Authentication › Users**, botão
**Add user › Create new user**.

- E-mail: o seu, o mesmo que está na tabela `usuarios`.
- Senha: escolha uma e guarde no gerenciador.
- Marque **Auto Confirm User**. Sem isso ele fica esperando a
  confirmação por e-mail, que ainda não está configurada.

## 2. Ligar o login ao usuário do sistema

O login do Supabase e o usuário do ERP são duas coisas: uma diz
quem entrou, a outra diz o que a pessoa pode fazer. No **SQL
Editor**:

```sql
update usuarios
   set auth_id = (select id from auth.users where email = usuarios.email)
 where email is not null;

-- Conferência: quem está ligado
select id, nome, perfil, email,
       case when auth_id is null then 'SEM LOGIN' else 'ok' end as login
  from usuarios
 order by (regexp_replace(id, '\D', '', 'g'))::int;
```

A sua linha precisa aparecer como `ok`. As outras continuam
`SEM LOGIN` até cada pessoa ter o login criado — é o esperado.

## 3. Abrir o sistema

Abra o `index.html`. Agora aparece a tela de login no lugar do
seletor de usuário.

Entre com o seu e-mail e a senha que você escolheu. Se o nome no
canto superior for o seu e os módulos aparecerem conforme o seu
perfil, está funcionando.

## A partir da v10: os cadastros vêm do banco

Ao entrar, o sistema carrega do Postgres as empresas, perfis,
usuários, centros de custo, plano de contas, clientes, produtos,
armazéns, bancos, credores, cargos, a matriz de acesso e os
parâmetros do DP — **antes** de montar a tela. Os cadastros de
exemplo do `dados.js` deixam de ser usados.

Dá para conferir sem sair do lugar: mude o nome de um projeto no
Supabase (Table Editor › centros), recarregue o sistema, e o nome
novo aparece.

Se algum cadastro vier vazio, o sistema **não sobe**: avisa e
volta para o login. Meio cadastro é pior que nenhum — o lançamento
sairia com centro de custo errado e ninguém perceberia.

## O que esperar — e o que ainda não funciona

**Funciona:** o login, a sessão (fecha e abre o navegador e você
continua dentro), e os módulos respeitando o perfil que o BANCO
diz. Trocar de usuário deixou de ser um clique no canto: é sair e
entrar de novo, que é como tem de ser.

**Ainda não funciona:** guardar o que você LANÇAR. Cadastro já vem
do banco; movimento (título, pagamento, procedimento, folha) ainda
fica na memória do navegador e some ao recarregar. O login é a porta; a persistência é a
próxima etapa, módulo a módulo.

Então, por enquanto, o sistema com login serve para a equipe
conhecer e treinar — ainda não para operar.

## Se der errado

**Entrou e a tela ficou vazia** — era um defeito na ordem de
inicialização, corrigido na v8 do repositório. Se acontecer de novo,
agora aparece uma faixa vermelha explicando; abra o console (F12) e
me mande o erro.

**"Este login não está vinculado a nenhum usuário do sistema"** — o
`update` do passo 2 não encontrou o e-mail. Confira se o endereço no
Authentication é idêntico ao da tabela `usuarios`.

**A tela de login não aparece e o seletor continua lá** — a
biblioteca do Supabase não carregou. Abra o console do navegador
(F12) e veja se há erro de rede. Sem internet, o sistema cai no
modo local de propósito.

**"E-mail ou senha incorretos" com a senha certa** — confira se
marcou *Auto Confirm User* ao criar o usuário.
