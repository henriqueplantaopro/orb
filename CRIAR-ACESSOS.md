# Criar os acessos da equipe

## Antes: os dois usuários de teste

O `ATUALIZAR-TUDO.sql` já cria as duas linhas no sistema. Falta
criar os logins.

No Supabase, **Authentication › Users › Add user › Create new
user**, duas vezes:

| E-mail | Senha provisória |
|---|---|
| `henrique.jmbr+adm@gmail.com` | `TesteERP2026!` |
| `henrique.jmbr+consulta@gmail.com` | `TesteERP2026!` |

Marque **Auto Confirm User** nos dois. O "+" é um recurso do Gmail:
tudo cai na sua caixa, e para o sistema são contas distintas.

Depois, no SQL Editor:

```sql
update usuarios
   set auth_id = (select id from auth.users where email = usuarios.email)
 where email is not null and auth_id is null;
```

Os dois entram com `TesteERP2026!` e o sistema **exige** trocar a
senha no primeiro acesso — é a marca `senha_provisoria`.

**Por que dois:** o de acesso total é para você. O de Consulta é o
que falta para a auditoria fechar o teste do mascaramento: com
acesso total o nome do paciente aparece normalmente, e aí o teste
não prova nada. É preciso ver em branco para quem não pode ver.

Esse segundo login você pode passar ao auditor sem receio: o perfil
Consulta não movimenta nada, não vê paciente e não vê dados de
funcionário.

## Agora: a equipe

Para cada pessoa, três passos.

**1. Gravar o e-mail no sistema.** No SQL Editor, uma linha por
pessoa:

```sql
update usuarios set email = 'dayana@dompedrosaude.com.br'  where id = 'u1';
update usuarios set email = 'marcia@dompedrosaude.com.br'  where id = 'u2';
-- e assim por diante
```

A lista de ids está no fim deste arquivo.

**2. Criar o login** em Authentication › Users › Add user, com o
mesmo e-mail e uma senha provisória. Marque **Auto Confirm User**.

**3. Marcar como provisória**, no sistema: Administração ›
Usuários › Editar › "Senha provisória — exigir troca no próximo
acesso".

Ou, mais rápido, para todos de uma vez no SQL Editor:

```sql
update usuarios set senha_provisoria = true where ativo and auth_id is not null;
```

Depois de criar todos os logins, ligue tudo:

```sql
update usuarios
   set auth_id = (select id from auth.users where email = usuarios.email)
 where email is not null and auth_id is null;
```

E confira:

```sql
select id, nome, perfil, coalesce(email,'—') as email,
       case when auth_id is null then 'SEM LOGIN' else 'ok' end as login,
       senha_provisoria
  from usuarios
 order by (regexp_replace(id, '\D', '', 'g'))::int;
```

## O que dizer a cada pessoa

O endereço do sistema, o e-mail dela e a senha provisória. Avise
que o sistema vai pedir uma senha nova logo no primeiro acesso, e
que **você não vai saber qual ela escolheu** — isso é proposital: é
o que faz a trilha de auditoria valer como prova de quem fez o quê.

## Os ids

| id | Pessoa | Perfil |
|----|--------|--------|
| u1 | Dayana | Assistente financeiro |
| u2 | Márcia | Diretoria |
| u3 | Fellype | Sócio |
| u4 | Contabilidade | Consulta |
| u5 | Administrador | Administração |
| u6 | Monique Cardoso | Controle de estoque |
| u7 | Compras (a definir) | Compras |
| u8 | Carol | Departamento Pessoal |
| u9 | Romário | Assistente financeiro |
| u10 | David | Sócio |
| u11 | Bianca | Diretoria de produtividade |
| u12 | Monique Almeida | Gerência de produtividade |
| u13 | Operacional HGB | Operacional — centro cirúrgico |

Dois continuam sem titular definido: o **u7** (Compras) e o **u13**
(Operacional HGB), que parece ser um posto e não uma pessoa. Se mais
de alguém usa o centro cirúrgico, vale um login por pessoa — login
compartilhado anula a trilha, porque todo lançamento fica assinado
pelo mesmo nome.
