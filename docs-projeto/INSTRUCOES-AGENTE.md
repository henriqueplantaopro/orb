# Runbook para o agente — publicar o ERP Dom Pedro

Tarefa: deixar o ERP rodando na nuvem com login, a partir dos três
arquivos SQL desta pasta.

Pressupõe que o operador já está **logado** no Supabase, na Vercel e
no painel de DNS do domínio. O agente não cria contas nem digita
senha em lugar nenhum.

---

> **Leia antes o `AUTONOMIA-AGENTE.md`.** Ele diz o que você pode
> decidir e corrigir sozinho — que é mais do que este runbook
> sugeria. A regra curta: decida o reversível, traga o
> irreversível.
>
> E use `99-verificar.sql` em vez de conferir número a número:
> `select * from verificar_instalacao() where resultado <> 'ok';`
> Nenhuma linha significa instalação correta.

## Regras que valem o tempo todo

1. **Nunca copie, cole, mostre em tela ou grave a `service_role
   key` nem a senha do banco.** A aplicação usa só a chave `anon`,
   que é pública por natureza. Se um passo parecer pedir a
   `service_role`, pare e pergunte.
2. **Não apague nada.** Nenhum `drop`, nenhum `delete`, nenhum botão
   vermelho. Se algo precisar ser desfeito, pare e relate.
3. **Pare e pergunte** em: escolha de plano pago, exclusão de
   qualquer recurso, alteração de DNS que já aponte para outro lugar,
   e qualquer erro de SQL que não esteja previsto aqui.
4. **Confira depois de cada bloco.** Cada tarefa abaixo termina com
   uma verificação e um número esperado. Número diferente é motivo
   para parar, não para seguir.
5. **Relate ao final** o que foi feito, com os valores pedidos no
   último bloco.

---

## Tarefa 1 — projeto no Supabase

1. Em `supabase.com/dashboard`, criar novo projeto.
2. Nome: `erp-dom-pedro`.
3. Região: **South America (São Paulo)**. Isto não é preferência —
   o dado é de saúde e de folha, e a região consta do registro de
   LGPD da empresa.
4. A senha do banco deve ser gerada e guardada **pelo operador**, no
   gerenciador de senhas dele. O agente não vê nem anota essa senha.
5. Aguardar o provisionamento terminar (alguns minutos).

**Verificação:** o projeto aparece como `Active` e a aba `SQL Editor`
abre.

**Anotar para o relatório:** a URL do projeto
(`https://<ref>.supabase.co`) e a chave `anon public`, que ficam em
`Project Settings › API`.

---

## Tarefa 2 — criar as tabelas

No `SQL Editor`, rodar os arquivos **nesta ordem**, um por vez,
esperando cada um terminar:

1. `supabase/01-schema.sql` — tabelas
2. `supabase/03-seed.sql` — cadastros
3. `supabase/02-rls.sql` — políticas de acesso
4. `supabase/04-ajustes.sql` — colunas fechadas e travas
5. `supabase/05-emails-usuarios.sql` — e-mails (não dispara convite)
6. `supabase/99-verificar.sql` — cria a função de verificação

**A ordem não é a dos números.** O seed roda ANTES da RLS: o `force
row level security` vale até para o dono da tabela, e só não morde
porque o papel do Supabase tem `BYPASSRLS`. Semear antes de ligar a
RLS funciona nos dois casos, e custa dois minutos de precaução.

**Verificação:** rodar o `supabase/99-verificar.sql` (cria a
função) e depois:

```sql
select * from verificar_instalacao() where resultado <> 'ok';
```

**Nenhuma linha = tudo certo.** São 41 checagens: as doze contagens,
a estrutura, a política de acesso, o que a chave anônima alcança, a
escrita sem login, e duas que pegam defeitos sutis — política ampla
convivendo com restritiva em `funcionarios`, e coluna fechada sem
visão que a devolva.

Para ver tudo, inclusive o que passou:

```sql
select * from verificar_instalacao();
```

Se algo falhar, diagnostique antes de relatar — e, se a causa for
defeito no SQL, corrija numa cópia e siga, como o
`AUTONOMIA-AGENTE.md` autoriza.

---

## Tarefa 3 — travar o cadastro público

Em `Authentication › Providers › Email`:

- **Desligar** "Enable sign ups". Ninguém se cadastra sozinho: os
  usuários são criados por convite.
- Manter "Confirm email" ligado.

Em `Authentication › URL Configuration`, deixar a Site URL em branco
por enquanto. Ela só faz sentido quando o ERP tiver tela de login
(Marco 3) — antes disso, o convite não teria para onde levar.

**Consequência para a Tarefa 4:** os convites podem ser enviados
agora, mas quem clicar no link cairá numa página sem destino.
Melhor convidar junto com o Marco 3. Se o dono quiser os logins
criados desde já, crie os usuários e **não** dispare os convites —
relate isso.

**Verificação:** a opção de cadastro aparece desligada.

---

## Tarefa 4 — convidar os treze usuários

Em `Authentication › Users`, usar **Invite user** para cada linha da
tabela abaixo. O convite manda um e-mail para a pessoa definir a
própria senha — assim nenhuma senha passa pelas mãos do agente.

Os e-mails são `@dompedrosaude.com.br`. **Se algum e-mail não tiver
sido informado, pare e peça** — não invente endereço.

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

> `u7` está como "a definir" no cadastro. Se não houver pessoa
> designada para Compras, **pule** e relate — melhor um perfil sem
> usuário do que um login genérico circulando.

Depois de convidar todos, ligar cada login ao usuário do ERP. No
`SQL Editor`, uma linha por pessoa, trocando o e-mail:

```sql
update usuarios set email = 'dayana@dompedrosaude.com.br',
  auth_id = (select id from auth.users
              where email = 'dayana@dompedrosaude.com.br')
 where id = 'u1';
```

**Verificação:**

```sql
select id, nome, perfil, email,
       case when auth_id is null then 'SEM LOGIN' else 'ok' end as login
  from usuarios order by id;
```

Nenhuma linha pode ficar como `SEM LOGIN`, exceto `u7` se tiver sido
pulado.

---

## Tarefa 5 — provar que o acesso está fechado

Este bloco é o mais importante do runbook. Ele verifica que o banco
barra o que a tela esconde.

No `SQL Editor`, a sessão roda como administrador e enxerga tudo —
por isso o teste é feito pela **API**, com a chave `anon`, que é a
que o navegador usa. Em `Project Settings › API Docs`, ou por um
cliente HTTP, fazer uma requisição **sem autenticação**:

```
GET https://<ref>.supabase.co/rest/v1/folhas
  apikey: <chave anon>
```

**Resultado esperado:** lista vazia ou erro de permissão. **Nunca**
os dados da folha.

Repetir, sem autenticação, para **todas** estas:

```
/rest/v1/folhas            /rest/v1/funcionarios
/rest/v1/parcelas          /rest/v1/matriz_acesso
/rest/v1/perfis            /rest/v1/parametros
/rest/v1/sequencia         /rest/v1/funcionarios_publico
```

As quatro últimas entraram depois de uma revisão: `matriz_acesso` e
`perfis` juntas desenham a estrutura de poder da empresa,
`parametros` guarda as alçadas, e `sequencia` é o contador que gera
os ids — alterá-la bagunçaria a numeração de tudo.

Testar também **escrita** sem login, que é o que a leitura não pega:

```
POST https://<ref>.supabase.co/rest/v1/sequencia
  apikey: <chave anon>
  Content-Type: application/json
  { "id": 1, "valor": 999999 }
```

**Resultado esperado:** erro de permissão **ou "0 linhas
afetadas"**. Pela API, `update` e `delete` barrados pela RLS voltam
como 200 com corpo vazio — não como erro. A leitura correta é
"nenhuma linha mudou", e vale conferir depois que a `sequencia`
continua com o valor que tinha.

Se qualquer uma devolver conteúdo ou aceitar a escrita, **pare
imediatamente** e relate: a RLS não está valendo, e nada deve ser
publicado antes disso.

---

## Tarefa 6 — publicar (demonstração, sem login ainda)

**Leia antes de executar.** O ERP de hoje não fala com o Supabase:
não há `createClient`, não há leitura de variável de ambiente, e os
dados vivem na memória do navegador. Publicar agora entrega uma
**demonstração** — o sistema inteiro funcionando, sem guardar nada
e sem tela de login.

Isso é útil: a equipe conhece, treina e critica enquanto a migração
acontece. Mas não confunda com "o ERP na nuvem com login", que é o
Marco 3 do plano.

Por isso **não crie as variáveis de ambiente agora**:
`VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` seriam lidas por
ninguém, e variável de ambiente que não é lida vira pegadinha para
quem for depurar depois.

1. Em `vercel.com`, importar o repositório.
2. Framework Preset: **Other**. Build Command e Output Directory:
   **vazios** — são arquivos estáticos, não há build.
3. Deploy. Anotar o endereço `...vercel.app`.

**Verificação:** o endereço abre o sistema. Alguma coisa lançada e
a página recarregada: o lançamento some. É o comportamento esperado
hoje.

**Ao relatar, escreva com todas as letras que o endereço é
demonstração e não guarda dados.** Quem receber o link sem esse
aviso vai lançar meio dia de trabalho e perder.

### O que fica para depois da migração (Marco 3)

Quando o ERP passar a ler do banco, aí sim:

- criar as duas variáveis de ambiente na Vercel;
- pôr o endereço da Vercel como **Site URL** e em **Redirect URLs**
  no Supabase, sem o que o link do convite não funciona;
- refazer a verificação, agora esperando a **tela de login**.

## Tarefa 7 — domínio

No painel de DNS de `dompedrosaude.com.br`, criar o registro que a
Vercel indicar para `erp.dompedrosaude.com.br` (normalmente um CNAME
para `cname.vercel-dns.com`).

**Se já existir um registro com esse nome apontando para outro
lugar, pare e pergunte.** Não substitua.

Depois, acrescentar `https://erp.dompedrosaude.com.br` às Redirect
URLs do Supabase.

---

## Tarefa 8 — backup e segurança da conta

1. Em `Project Settings › Add Ons`, verificar se há backup diário.
   No plano gratuito **não há retenção** — se o projeto estiver no
   gratuito, **não contrate nada**: apenas relate, porque é decisão
   do dono.
2. Em `Account › Security`, confirmar que a conta do Supabase está
   com dois fatores ligados. Se não estiver, relatar — a ativação é
   feita pelo próprio dono, com o celular dele.

---

## O que relatar ao final

- URL do projeto Supabase e chave `anon` (a chave `anon` pode ser
  compartilhada; a `service_role`, nunca).
- Os sete números de verificação da Tarefa 2.
- Quais usuários foram convidados e quais ficaram pendentes.
- O resultado dos três testes da Tarefa 5, com as palavras exatas da
  resposta.
- Endereço da Vercel e situação do domínio.
- Se o backup diário existe e se o 2FA está ligado.
- Qualquer passo em que você parou, e por quê.

---

## O que NÃO fazer, resumido

- Não criar usuário com senha definida por você.
- Não copiar a `service_role key` nem a senha do banco.
- Não rodar `drop`, `delete` ou `truncate`.
- Não contratar plano pago.
- Não substituir registro de DNS existente.
- Não publicar o endereço para a equipe antes da Tarefa 5 passar.
