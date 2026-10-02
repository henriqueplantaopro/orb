# Terceira auditoria — as três que impediam gravar

## 1. O `RETURNING *` no INSERT

Você isolou certo: o supabase-js manda
`Prefer: return=representation`, o Postgres faz `RETURNING *`, e o
`*` inclui a coluna `paciente`, que está revogada.

Corrigido com `returning: 'minimal'` em toda gravação. Não
precisamos da linha de volta — ela já está na memória, foi de lá
que saiu. Nenhum grant novo, a coluna segue fechada.

## 2. Datas vazias

Campo de data opcional em branco ia como `""`. Vazio quer dizer
ausente, e ausente é nulo. Agora é convertido antes de enviar, para
toda coluna de data.

Junto, uma rede para o caso da previsão (`23502 null value in
column "status"`): colunas que o banco exige preenchidas recebem o
padrão que o próprio sistema usa, com aviso no console para o
caminho que deixou em branco ser achado depois.

## 3. Saldo sem lastro — a mais grave das três

Você nomeou bem: "pior do que não gravar, porque o próximo reload
parece íntegro".

Agora o saldo **só grava se as camadas e os movimentos gravarem**.
Se a origem falhou, a posição não vai, e o aviso diz isso com todas
as letras. É a mesma ideia da conservação de valor que a bateria
confere no estoque, aplicada à gravação.

Testado simulando falha nas camadas: camadas 0, posições 0.

## Os três menores que você apontou

**Loop de retentativa:** agora para depois de 5 tentativas, com o
aviso dizendo "PAREI DE TENTAR". Erro permanente não vira
retentativa eterna.

**Aviso no singular:** quando mais de uma parte falha, diz "2
partes não foram salvas. Primeira: …".

**159 posições para 5 com saldo:** linha zerada não é mais gravada.

**Cartão do módulo degradado:** ganhou um selo vermelho "sem
gravar". Você estava certo — abrir vazio é indistinguível de "não
há nada cadastrado", e a pessoa recadastraria tudo.

## O que NÃO é defeito

Estoque, ativos e compras vazios no banco. Os 66 itens e 27
equipamentos que você via eram o cadastro embutido; agora a fonte é
o banco, e esses dados nunca foram carregados. A carga é a
importação do Protheus, que é o próximo passo do projeto.

## Para a próxima passada

A prioridade é a mesma de duas rodadas atrás, agora destravada:
baixa de material, requisição, procedimento com material e OS, cada
um com reload e conferência de saldo.

Dois casos novos: confirme que o saldo **nunca** aparece no banco
sem camada e movimento correspondentes; e, depois de gravar um
procedimento, teste o mascaramento do paciente pela visão, que
ficou engatilhado.
