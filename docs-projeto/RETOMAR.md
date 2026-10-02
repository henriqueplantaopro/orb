# Onde estamos — leia isto primeiro

Se esta é uma conversa nova, este arquivo substitui o histórico. Não
falta contexto: está tudo aqui e nos arquivos do pacote.

## O projeto

ERP de gestão da Dom Pedro Saúde — financeiro, estoque,
procedimentos, faturamento e pessoal. Hoje roda local, sem
persistência. Estamos migrando para Supabase (Postgres, região São
Paulo) + Vercel.

## O que já aconteceu

Uma sessão anterior sua rodou o pacote inteiro num Postgres 16
descartável configurado para imitar o Supabase, na ordem
01 → 03 → 02 → 04. **Zero erro, e as 41 checagens do verificador
passaram.** Nada foi criado no Supabase de verdade: o projeto ainda
não existe.

Nessa sessão você encontrou e eu corrigi, nesta ordem:

1. `01-schema.sql` com tabelas referenciando outras criadas depois.
2. Política ampla do laço anulando a restritiva em `funcionarios` —
   políticas de RLS se somam por OU.
3. `revoke select (coluna)` sem efeito por causa do grant de tabela.
4. Comentário `/* */` dentro de literal JSON, que abortava o
   `02-rls.sql` inteiro e deixava o banco sem RLS aparentando estar
   pronto.
5. Duas colunas fechadas sem visão que as devolvesse.
6. `security definer` impedindo o `set local role` no verificador
   (correção sua, adotada).
7. Checagem da sequência comparando com literal, que ficaria falsa
   depois do primeiro lançamento.
8. Escritas de teste que persistiriam se a RLS quebrasse.

O pacote atual é o **erp-nuvem-v8**, com todas essas correções.

## O que fazer agora

Leia, nesta ordem:

1. `AUTONOMIA-AGENTE.md` — o que você decide sozinho. Resumo:
   corrija o reversível e siga, traga o irreversível. Erro de SQL
   com causa clara, corrija numa cópia e relate no fim.
2. `INSTRUCOES-AGENTE.md` — o runbook, em oito tarefas.
3. `NOTAS-RLS.md` — por que as políticas estão como estão.

Depois:

```
01-schema.sql          tabelas            (43)
03-seed.sql            cadastros          (365 inserções)
02-rls.sql             políticas          (121)
04-ajustes.sql         colunas e travas
05-emails-usuarios.sql e-mails (não dispara convite)
99-verificar.sql       cria a função de verificação

select * from verificar_instalacao() where resultado <> 'ok';
```

Nenhuma linha = instalação correta. **O seed roda antes da RLS**: a
numeração dos arquivos não é a ordem de execução.

## O que está bloqueado, e por quê

- **O projeto no Supabase não existe.** Criar exige a conta do dono.
  Se suas ferramentas de navegador estiverem funcionando, você pode
  criar; na sessão anterior elas recusavam conexão
  (`anchor tab group not established`).
- **Login é Marco 3.** O ERP ainda não fala com o Supabase — não há
  `createClient` nem leitura de variável de ambiente. Convite
  enviado hoje leva a uma página sem destino. Grave os e-mails por
  SQL e **não dispare convite**.
- **Sete usuários sem endereço**: u4, u6, u7, u8, u9, u12, u13. Seis
  já estão no `05-emails-usuarios.sql`.

## Regras que não mudam

- Nunca copiar, mostrar ou gravar a `service_role key` nem a senha
  do banco. A aplicação usa só a chave `anon`.
- Nada de `drop`, `delete` ou `truncate`.
- Não contratar plano pago, não mexer em DNS existente.
- Usar e-mail exatamente como escrito, mesmo parecendo errado —
  relatar a suspeita no fim, sem corrigir.
- Um relatório no fim, não um por tarefa.

## O que eu quero de você

Se o banco já roda limpo no seu emulador, diga isso em uma linha e
passe à parte que falta: a sequência exata de cliques no Supabase
para o dono criar o projeto, e os SQL na ordem prontos para colar.
Ele vai conduzir pela conta dele.
