# Publicar a função que cria acessos

Passo único. Depois dele, criar o acesso de alguém é um botão na
tela de Usuários — sem painel, sem SQL.

## Por que precisa de uma função no servidor

Criar credencial exige a chave de administração do banco, que
ignora toda a segurança. No navegador, qualquer um que abrisse o
console teria acesso a folha, contas bancárias e dados de paciente.

A função guarda essa chave no servidor do Supabase. O ERP só pede,
com a sessão de quem está pedindo — e a função confere três coisas
antes de criar:

1. quem pede está autenticado;
2. quem pede tem movimentação em Administração (a mesma matriz que
   governa a tela);
3. o e-mail já existe como usuário do ERP — não se cria credencial
   solta.

## Publicar

No painel do Supabase, menu **Edge Functions** › **Deploy a new
function** (ou **Create function**).

- Nome: **`criar-login`** (exatamente assim)
- Cole o conteúdo de `supabase/funcoes/criar-login/index.ts`
- Deploy

As chaves que a função usa (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`) já existem no ambiente do Supabase —
não precisa configurar nada.

Se a sua conta não mostrar o editor de funções no painel, dá para
publicar pelo computador:

```
npx supabase functions deploy criar-login --project-ref SEU-REF
```

O `SEU-REF` é o trecho do endereço do projeto: em
`https://jsdyowuqehryfwqyklax.supabase.co`, é `jsdyowuqehryfwqyklax`.

## Usar

Administração › Usuários › Editar na pessoa › **Criar acesso /
redefinir senha**. Você informa uma senha provisória, o sistema
cria a credencial e marca a troca como obrigatória.

Passe a senha à pessoa. No primeiro acesso ela escolhe a dela, e a
sua deixa de valer — inclusive para você. É o que faz a trilha de
auditoria valer como prova de quem fez o quê.

O mesmo botão **redefine** a senha de quem já tem acesso: é o
caminho de "esqueci minha senha".

## Enquanto não publicar

O botão avisa que a função não está no ar e nada quebra. O caminho
pelo painel (Authentication › Users › Add user, com *Auto Confirm
User*) continua funcionando.
