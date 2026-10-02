# Revisão das políticas — o que mudou, e o que a revisão anterior errou

Duas rodadas de correção. A primeira (v4) fechou quatro brechas; a
segunda (v5) corrige o que a primeira não fechou, mais dois defeitos
que impediam o conjunto de rodar.

## v5 — o que mudou agora

### 1. O `01-schema.sql` não rodava

`usuarios` referenciava `perfis` antes de `perfis` existir no
arquivo. No SQL Editor, que roda tudo numa transação, isso vira
rollback e zero tabela. Reordenado: `perfis` e `matriz_acesso` vêm
antes. Conferido por varredura: 43 tabelas, nenhuma referência
apontando para tabela criada depois.

### 2. A política ampla anulava a restritiva

Políticas de RLS **se somam por OU**. O laço genérico criava
`ver_funcionarios` com `tem_nivel('dp','V')`, e a
`ver_funcionario_completo`, escrita depois com
`ver_dados_pessoais`, não subtraía nada — a Contabilidade lia CPF,
PIS, salário e conta bancária.

`funcionarios` e `folhas` saíram da lista do módulo `dp` no mapa e
passaram a ter política própria. **A folha saiu junto de propósito:**
fechar o cadastro e deixar o holerite aberto não protege nada — é a
mesma informação por outro caminho.

Consequência registrada: a Contabilidade tem o módulo mas não a
ação, então perde as duas. Se o escritório precisar da folha para
escriturar, o caminho é a exportação, não o acesso à tabela.

### 3. `revoke` de coluna sozinho não faz nada

O Supabase concede a `authenticated` o SELECT da tabela inteira por
default privilege, e grant de tabela cobre toda coluna. A forma que
funciona é tirar o SELECT da tabela e devolvê-lo coluna a coluna,
menos as fechadas. É o que o `04-ajustes.sql` faz agora para
`paciente` e para as colunas de valor.

E, com as colunas fechadas, as visões precisaram virar
`security_invoker = false`: como `true`, exigiriam o privilégio de
quem chama, e nem quem tem a ação conseguiria ler. Rodando como
donas, o filtro de linha foi escrito dentro delas.

### 4. O `04-ajustes.sql` não estava no pacote v4

Foi escrito depois de empacotar. Está no v5.

### 5. A ordem de execução mudou

**01 → 03 → 02 → 04.** O seed roda antes da RLS: o `force row level
security` vale até para o dono da tabela, e só não morde porque o
papel do Supabase tem `BYPASSRLS`. Com um dono sem esse atributo, as
365 inserções falhariam.

## v4 — o que já estava corrigido

- A tabela `sequencia` entrou no laço da RLS e ficou sem política
  nenhuma: só a função `proximo_id`, que roda como dona e exige
  usuário autenticado, a alcança.
- O `or true` saiu da política de funcionários — embora, como se viu
  acima, isso sozinho não resolvesse.
- `funcionarios_publico` virou `security_invoker = false` com o
  filtro dentro e `revoke` do `anon`.
- `matriz_acesso`, `perfis` e `parametros` passaram a exigir usuário
  autenticado.

## Escalonamento de privilégio

O caso era: quem tinha `administracao = M` podia reescrever a
própria matriz e o próprio perfil. Resolvido em dois lugares:

- **Na matriz** (ERP v31): o assistente financeiro passou a ter
  `administracao = V`. Quem escreve é Administração, Diretoria e
  Sócio — decisão do dono.
- **No banco** (`04-ajustes.sql`): ninguém altera o próprio
  registro em `usuarios`, nem o administrador. Promover a si mesmo
  não é alçada, é falta de segunda mão.

## v6 — o comentário que derrubava tudo

O mapa de módulos do `02-rls.sql` é um literal JSON, e eu escrevi
dentro dele um comentário `/* … */` explicando por que
`funcionarios` e `folhas` tinham saído. JSON não aceita comentário:
o literal fica inválido, o bloco aborta e **nenhuma política do
laço é criada**.

O desfecho era o pior possível. Como o `04-ajustes.sql` roda sem
erro por conta própria, quem visse a falha no 02 e seguisse para o
04 terminaria com os revokes, as visões e a trava de `usuarios` no
lugar — e zero segurança de linha. Tudo aparentando feito.

Comentário movido para fora das aspas, e o literal passou a ser
validado com parser antes de empacotar.

Duas colunas também voltaram: `procedimentos.imposto_pct` e
`estoque_movimentos.custo_nota` tinham ficado fora do grant e fora
das visões — ninguém as alcançava. Era esquecimento, não decisão.
Entraram nas visões sob a mesma regra do `$`.

## O que ainda merece um segundo par de olhos

- As duas visões rodam como donas. O filtro de linha está escrito
  dentro de cada uma; se alguém editá-las depois e esquecer o
  `where`, elas abrem para todo mundo. É o ponto mais frágil do
  conjunto.
- Nenhuma tabela tem política de `delete`, de propósito: o sistema
  cancela e estorna, nunca apaga.
