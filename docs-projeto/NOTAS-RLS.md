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

## Exclusão (corrigido na v163)

Esta seção dizia, até a v163: *"nenhuma tabela tem política de
`delete`, de propósito: o sistema cancela e estorna, nunca apaga."*
Era verdade quando foi escrito e deixou de ser quando o sistema
ganhou telas que apagam mesmo — contrato, cliente, regra de
conciliação, previsão, e a troca do saldo informado do dia. O pedido
dessas telas caía no vazio, e o registro voltava na recarga.

**Delete recusado pela RLS não devolve erro.** A política de
exclusão não barra o pedido: ela faz a linha não existir para ele, e
apagar nada é sucesso — "DELETE 0", 204, `error: null`. É o único
verbo com esse comportamento; insert e update recusados gritam. Por
isso a falta ficou anos invisível, e por isso o cliente passou a
conferir o número de linhas em vez de supor (`apagarNoBanco`, em
`persistencia.js`).

Hoje: cinco tabelas com política de exclusão, no mesmo nível que a
tela já exige — `contratos` e `clientes` (ação `admin`),
`regras_conciliacao` (financeiro M), `previsoes` (faturamento M ou
financeiro M) e `parcelas`. O resto do banco continua sem exclusão
para ninguém. `saldos_informados` quase entrou na lista: a troca do
saldo do dia removia o registro anterior. Na v163 ela passou a
atualizar no lugar, e a tabela ficou de fora — exclusão que não
precisa existir é a melhor de todas.

Todas as cinco exigem também o `V` do módulo, e isso sustenta a
conferência do cliente: quando o delete volta vazio, ele LÊ a linha
para separar recusa de "outro já apagou". Quem pudesse apagar sem
poder ler veria "já não estava lá" onde houve recusa, e o silêncio
voltaria por outra porta.

`parcelas` é a única com CONDIÇÃO na política, e é exceção
consciente à regra de que a RLS não aplica regra de negócio:
`pagamentos.parcela_id` tem `on delete cascade`, o cascade roda como
dono e NÃO passa pela RLS de `pagamentos`. Política larga ali daria,
a quem abrisse o console, o poder de apagar pagamento — que nenhuma
política deste banco concede. Medido: com a política larga, apagar
uma parcela paga levou o pagamento junto.

`folhas` e `funcionarios` têm política `for all`, e ALL inclui
DELETE. Ganharam trava RESTRITIVA (`using (false)`) na v163: a
permissiva continua valendo para ler e escrever, e a restritiva, que
se soma por E, proíbe o delete. Ninguém decidiu dar exclusão de
folha a quem tem Pessoal; era o `all` sendo largo.

Uma verificação em `teste-fumaca.js` confronta, nas duas direções,
os caminhos de exclusão do código com as políticas do SQL: tela que
apaga sem política reprova, e política sem tela que apague também.

## O que ainda merece um segundo par de olhos

- As duas visões rodam como donas. O filtro de linha está escrito
  dentro de cada uma; se alguém editá-las depois e esquecer o
  `where`, elas abrem para todo mundo. É o ponto mais frágil do
  conjunto.
- A matriz aceita `M` sem `V` em qualquer módulo (só o de
  Administração exige os dois, para ninguém se trancar para fora).
  Movimentar sem ver não serve de nada — a tela do módulo nem abre —,
  então a combinação é inútil mas possível, e é dela que nascem
  surpresas. As políticas de exclusão já se protegem exigindo o `V`;
  vale decidir, com quem usa o sistema, se a tela de acessos deve
  simplesmente marcar o `V` junto quando alguém marca o `M`.
