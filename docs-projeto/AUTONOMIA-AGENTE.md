# Autonomia — o que decidir sozinho e o que trazer

Este documento existe porque o runbook anterior pedia julgamento a
cada passo e você acabava perguntando mais do que executando. A
culpa é do runbook, não sua.

A regra geral: **decida tudo que for reversível e verificável; traga
o que for irreversível ou ambíguo.** Abaixo, o detalhe.

---

## Decida sozinho e siga (não pergunte)

### Erros no SQL que você mesmo consegue diagnosticar
Se um arquivo falhar e a causa estiver clara — ordem de criação,
sintaxe, literal inválido, coluna faltando —, **corrija numa cópia,
rode, e relate a correção no fim**, com o diff. Nada disso é
irreversível: o banco está vazio.

Foi assim que você achou a ordenação do `01-schema.sql` e o
comentário dentro do JSON. Em ambos eu teria dito "corrija" se
tivesse sido perguntado. Não pergunte de novo nesse caso.

### Divergência entre número obtido e esperado
Rode `select * from verificar_instalacao()` em vez de conferir à
mão. Se alguma linha der `FALHOU`, investigue a causa antes de
relatar — o número sozinho não diz nada. Se a causa for um defeito
meu no SQL, veja o item acima.

### Dado de exemplo e nome de teste
Pode criar, usar e apagar o que precisar para testar, desde que
dentro de transação com `rollback` ou com prefixo `teste-`. Não
pergunte.

### A ordem das tarefas
Se uma tarefa depender de algo que ainda não existe, **pule e siga
para a próxima**, anotando. Não pare a execução inteira por causa de
uma dependência.

---

## Traga para decisão (pare e pergunte)

1. **Qualquer coisa que custe dinheiro.** Plano pago, add-on,
   domínio.
2. **Qualquer coisa que apague ou substitua** o que já existe:
   `drop`, `delete`, registro de DNS que já aponta para outro lugar,
   projeto do Supabase que já exista com o mesmo nome.
3. **Dado que você não tem.** E-mail de pessoa, CNPJ, nome de
   titular. **Nunca invente, nem "corrija" o que parece erro de
   digitação** — veja a regra dos e-mails abaixo.
4. **Mudança de política de acesso.** Quem vê o quê é decisão do
   dono, já tomada e registrada no `NOTAS-RLS.md`. Se o teste
   mostrar que a política não faz o que diz, isso é defeito e você
   relata; se fizer o que diz e você discordar, relate também — mas
   não mude.
5. **Qualquer credencial.** Senha, `service_role key`, chave de API
   de terceiro. Nunca copie, mostre ou grave.

---

## A regra dos e-mails, explícita

Use **exatamente** o endereço que o dono escrever, mesmo que pareça
errado. Endereço de e-mail é literal: um "admnistrativa" sem o "i"
pode ser a caixa real, criada assim há anos.

O que fazer: **grave como está, convide como está, e relate a
suspeita no fim** — "o endereço X me pareceu ter erro de digitação,
confirme". Não corrija por conta própria e não pare por causa disso.

A exceção é o endereço que **não pode existir**: o Gmail não aceita
cedilha nem acento no nome da conta, então `licitação@gmail.com` não
é um endereço que erra, é um endereço impossível. Nesse caso, pare e
pergunte — mas só nesse.

---

## Como relatar

Um relatório no fim, não um por tarefa. Nele:

1. **O que foi feito**, na ordem.
2. **A saída do `verificar_instalacao()`**, inteira.
3. **O que você corrigiu por conta própria**, com o diff.
4. **O que ficou pendente**, e por quê.
5. **O que você suspeita, mas não mudou.**

Se tudo passou, o relatório pode ser curto. O que não quero é
descobrir no fim que você parou na tarefa 2 esperando uma resposta
que eu daria em três segundos.

---

## O estado atual, para você não precisar perguntar

- **Projeto no Supabase:** ainda não existe. Criar é tarefa do dono,
  porque exige a conta dele. Se suas ferramentas de navegador
  voltarem, pode criar.
- **Login:** foi para o Marco 3. O ERP ainda não fala com o
  Supabase, então convite enviado hoje leva a uma página sem
  destino. **Grave os e-mails na tabela `usuarios` por SQL, sem
  disparar convite.**
- **Publicação na Vercel:** demonstração, sem variáveis de
  ambiente. Está descrito na Tarefa 6.
- **A conta `u5` (Administração)** é uma caixa possivelmente
  compartilhada. O dono foi avisado de que a trava do próprio
  registro supõe uma segunda mão, e que login compartilhado anula
  isso. É decisão dele; não bloqueia nada.

---

## Ordem de execução, para referência rápida

```
01-schema.sql          tabelas          (43 tabelas)
03-seed.sql            cadastros        (365 inserções)
02-rls.sql             políticas        (121 políticas)
04-ajustes.sql         colunas e travas
05-emails-usuarios.sql e-mails na tabela (não dispara convite)
99-verificar.sql       cria a função de verificação

select * from verificar_instalacao() where resultado <> 'ok';
-- nenhuma linha = instalação correta
```

O verificador não suja o banco: as duas escritas que ele tenta como
`anon` são desfeitas pelo próprio bloco, passando ou falhando.

O seed roda **antes** da RLS. A numeração dos arquivos não é a ordem
de execução, e isso é de propósito: os números dizem o que cada um
é, a ordem está aqui.
