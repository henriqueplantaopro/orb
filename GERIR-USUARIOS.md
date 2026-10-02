# Usuários, senhas e acesso

## O que a pessoa vê

O nome dela no canto superior virou botão. Clicando, abre **Meus
dados**: nome, perfil, e-mail de acesso e a lista do que o perfil
permite em cada módulo (V vê, M movimenta, $ vê valor, A aprova).

É onde ela também **troca a própria senha**. Mínimo de 8
caracteres, e ela continua conectada depois.

Isso resolve a pergunta mais comum do dia a dia — "por que não
consigo aprovar isso?" — sem passar por você.

## O que o administrador faz pelo sistema

Em Administração › Usuários › Editar: nome, perfil, e-mail, e
ativar ou desativar.

Tem também **Enviar link de redefinição de senha**: o sistema manda
um e-mail para a pessoa escolher a senha nova.

## Esqueceu a senha: senha provisória

É o caminho recomendado, e resolve sem que você fique sabendo a
senha de ninguém.

1. **No painel do Supabase**, Authentication › Users › a pessoa,
   defina uma senha provisória e passe para ela.
2. **No sistema**, Administração › Usuários › Editar, marque
   **"Senha provisória — exigir troca no próximo acesso"** e salve.

No próximo acesso, a pessoa entra com a provisória e cai numa tela
que **exige** escolher a senha dela. Não dá para pular: o sistema
não carrega nada antes disso.

Assim que ela escolhe, a sua senha deixa de valer — e é esse o
ponto. Senha que o administrador conhece não serve de prova de
autoria: se um pagamento foi aprovado com o login da Márcia e você
sabia a senha dela, a trilha deixa de provar que foi ela.

## Por que o administrador NÃO troca a senha de outra pessoa

Essa operação exige a credencial de administração do banco (a
`service_role`). Se ela viesse para o navegador, qualquer um que
abrisse o console do sistema teria acesso total aos dados —
inclusive folha e contas bancárias, que passamos semanas
protegendo.

Então há dois caminhos, nenhum deles expondo a credencial:

1. **O link de redefinição**, pelo próprio sistema. Depende de o
   envio de e-mail estar configurado no Supabase (Authentication ›
   Emails). Enquanto não estiver, o botão avisa que falhou.
2. **O painel do Supabase**: Authentication › Users › a pessoa ›
   Reset password. Funciona sempre, e é o caminho enquanto o e-mail
   não estiver configurado.

Nos dois casos, quem escolhe a senha é a pessoa. Nem você chega a
vê-la — o que é melhor também para você: senha que o administrador
conhece é senha que não serve de prova de autoria.

## Se VOCÊ esquecer a sua senha

Não fica preso. A senha do ERP e a conta do Supabase são credenciais
diferentes:

1. Entre em `supabase.com` com a sua conta (se esquecer essa, o
   próprio site tem recuperação por e-mail).
2. Authentication › Users › seu usuário › **Reset password**.

**Dá para fazer por SQL?** Dá — a tabela `auth.users` aceita
`update ... set encrypted_password = crypt('nova', gen_salt('bf'))`.
Mas não recomendo e não vou documentar o comando: mexer na tabela
de autenticação na mão é o tipo de coisa que funciona nove vezes e
na décima quebra o login de todo mundo. O botão do painel faz o
mesmo, sem risco.

## Criar usuário novo

Dois passos, porque são duas coisas: o login (quem entra) e o
usuário do sistema (o que pode fazer).

1. Supabase › Authentication › Users › **Add user › Create new
   user**. Marque **Auto Confirm User**.
2. No sistema, Administração › Usuários › Novo usuário, com o mesmo
   e-mail. Depois, no SQL Editor:

```sql
update usuarios
   set auth_id = (select id from auth.users where email = usuarios.email)
 where email is not null and auth_id is null;
```

Conferência:

```sql
select id, nome, perfil, coalesce(email,'—') as email,
       case when auth_id is null then 'SEM LOGIN' else 'ok' end as login
  from usuarios order by (regexp_replace(id, '\D', '', 'g'))::int;
```
