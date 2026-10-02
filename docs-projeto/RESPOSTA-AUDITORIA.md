# Resposta à auditoria — estado na v18

A auditoria do v11 levantou 13 críticos, 24 altos e 35 médios/baixos,
mais quatro padrões estruturais. Esta versão fecha a primeira leva.
Abaixo, o que foi corrigido, o que ficou e por quê.

A bateria passou de 904 para **1038 verificações**, incluindo os
invariantes que o relatório pediu. Há também um
`varredura-permissoes.js` na raiz: chama toda função de escrita com
perfis de leitura e exige erro.

---

## Corrigido nesta versão

### Padrão 1 — as duas camadas de permissão viraram uma
As ações grossas (`lancar`, `pagar`, `faturar`, `estoque`,
`requisitar`, `receber`, `comprar`, `dp`, `ver_custo`) passaram a ser
**derivadas da matriz V/M/$**. Com isso as ~200 chamadas de
`pode('lancar')` espalhadas pelo store respeitam a matriz sem
reescrita. Zerar a linha de Financeiro da assistente agora impede de
verdade criar título e registrar pagamento.

`admin` ficou **fora** do mapa de propósito: não é "mexer no módulo de
Administração", é a autorização de última instância que quebra
segregação (forçar cancelamento de fechamento já pago). Derivá-la
daria esse poder ao sócio, que tem Administração em VM$ — e a trava
existe justamente para que nem ele force sozinho.

| Item | O que mudou |
| --- | --- |
| **C10** | Alíquota de imposto exige movimentação em Administração |
| **C11** | Ver Administração não é poder mudá-la; e **ninguém amplia o próprio perfil** — nem com M |
| **A12/A18** | Resolvidos pela derivação: `entradaLote`, `criarTitulo`, `registrarPagamento` e as demais passaram a seguir a matriz |
| **A17** | Ativos migrou para `podeMover('ativos')`; `abrirOS` ganhou guarda; custo de OS exige o nível financeiro do módulo |
| médio | `ignorarLinha` ganhou a guarda de conciliação |
| médio | Matriz com M sem V em Administração é recusada |

### Padrão 2 — invariantes de conservação de valor
| Item | O que mudou |
| --- | --- |
| **C3** | Valor, juros, multa e desconto negativos ou não-finitos recusados antes de gravar |
| **C5** | Estorno de entrada sai pelo **custo médio vigente**, como a saída; recusa o que deixaria valor negativo; saldo zero força valor zero |
| **C6** | Custo negativo, infinito ou em texto recusado — e `"120,00"` passou a ser **interpretado** em vez de virar NaN |

### Críticos de dinheiro
| Item | Antes → depois |
| --- | --- |
| **C1** | R$ 1.000 recebidos entravam nas quatro contas → entram só na conta que recebeu |
| **C2** | Fluxo diário ignorava `previsto` → folha fechada aparece (R$ 14.831,43 no teste) |
| **C4** | Estorno parcial mantinha a retenção zerada → reverte sempre que o recebido deixa de cobrir o bruto |
| **C7** | Inventário com ano errado travava o armazém para sempre → data futura recusada e inventário estornado não trava mais |
| **C8** | Editar o nome do paciente apagava R$ 297,60 de material → o custo unitário fica **gravado na baixa** e a edição usa ele |
| **C9** | Estorno falhava em silêncio e o material saía em dobro → a edição **aborta** e desfaz o que já voltou; e quem movimenta procedimentos pode estornar o próprio material |

### Pessoal
| Item | Antes → depois |
| --- | --- |
| **C12** | Férias e folha reiniciavam a tabela de IRRF, cada uma com seu desconto simplificado e seu redutor → **cumulativo no mês**, espelhando o que o INSS já fazia. No teste: R$ 0,00 + R$ 0,00 passou a R$ 378,02, igual ao devido sobre o rendimento do mês |
| **C13** | Aviso indenizado pagava R$ 569,36 de férias contra R$ 6.832,27 do trabalhado → os períodos e as vencidas passaram a usar `dataParaAvos`, e as duas modalidades dão R$ 6.832,27 |

Em C12 apareceu um efeito que o relatório não previa: no mês de 30
dias de férias, a folha tem proventos quase nulos e o imposto do mês
inteiro a deixaria com **líquido negativo**. O desconto passou a ser
limitado ao que o líquido suporta, e o excedente fica registrado em
`irrf_adiado`.

### Testes
- Dois testes antigos falhavam desde a v12 por dependerem da data
  (viravam na passagem do mês). Ficaram imunes ao calendário.
- Entraram os invariantes de conservação no estoque, de permissão por
  perfil e os casos de C1 a C13.
- `varredura-permissoes.js`: varredura programática das funções de
  escrita.

---

## Corrigido na v14

### Padrão 3 — a regra desceu da tela para o store
| Item | O que mudou |
| --- | --- |
| **A1** | `criarTitulo` exige **parcelas + retenções = bruto**. A NF de R$ 10.000 com parcela cheia e R$ 1.150 de retenção é recusada com a diferença na mensagem. Sem bruto informado, a retenção não pode passar das parcelas |
| **A10** | `ajusteInventario` no store: a contagem vira ajuste, não entrada. Contar 500 num armazém com 90 deixa 500; recontar não mexe; contar menos lança a falta. Motivo obrigatório, sem default na tela |
| **A11** | `custoDeAquisicao` no store, com o frete rateado pela quantidade **total**. Os dois arquivos de UI que duplicavam a fórmula errada passaram a delegar. Pedido de 10 a R$ 50 com R$ 100 de frete fecha em R$ 600, inteiro ou parcelado |
| **A20** | CPF fora da exportação de títulos sigilosos |
| **A21** | Remessa passou a usar nome e descrição mascarados nos três pontos |
| **A24** | Tabelas fiscais validadas antes de gravar: ordem das faixas, alíquota crescente, coerência do teto de contribuição e **prova de monotonicidade** (salário maior nunca paga menos INSS) |

### Padrão 4 e altos de dinheiro
| Item | Antes → depois |
| --- | --- |
| **A2** | `liquidar` reconfere o saldo: a solicitação antiga não paga mais em dobro |
| **A3** | DRE recuperou o grupo 2 — R$ 66.165,43 de ISS, COFINS, IRPJ e parcelamento aparecem como dedução entre receita bruta e líquida |
| **A4** | Apuração por empresa usa competência nos dois lados; eliminação fecha e o consolidado bate com a soma. Incluído `eliminacao_fecha` como prova real |
| **A5** | Só nota entra na apuração — a previsão que a NF substitui não é mais somada junto |
| **A7** | Extrato sem lançamento novo não é gravado: a divergência de R$ 60.060 não some no segundo clique |
| **A8** | Saldo com divergência volta marcado como não conferido |
| **A9** | Estorno solta a linha do extrato, que pode ser reconciliada; criado `desconciliar`, que recusa quando há pagamento liquidado por trás |

### Procedimentos e pessoal
| Item | Antes → depois |
| --- | --- |
| **A13** | Médico sem fechamento mantinha a estimativa somando ao realizado (R$ 4.400 viravam R$ 5.300) → sai da conta e vira aviso nomeando quem é |
| **A14** | Prévia divergia do gravado com preços diferentes entre salas → `custoMaterialPrevisto` no store, usado pela tela e pelo lançamento |
| **A15** | A sala do HGB era devolvida para outro hospital → procura primeiro a sala do centro pedido; hospital com salas próprias não herda as do mutirão |
| **A16** | Filtro por especialidade multiplicava o plantão (R$ 2.000 num turno de 6h) → o dia do médico é calculado inteiro e só a fatia visível é exibida; os filtros somam exatamente o plantão |
| **A19** | Projetor `visivel(modulo, obj)` no store: sem o nível financeiro, a posição de estoque sai sem custo e sem valor; sem acesso ao DP, a folha sai sem CPF e sem salário |
| **A22** | Fração de 14+ dias pulava a validação de saldo (44 dias de um direito de 30) → a conta saiu de dentro do `if` e vale sempre, abono incluído |
| **A23** | INSS patronal, RAT e terceiros incidiam sobre a dobra que o próprio sistema exclui → passaram a usar a base de INSS |

---

## Não corrigido ainda

**A6 — resolvido na v17.** Na baixa manual o sistema pergunta e só
registra o mútuo com confirmação; na conciliação não pergunta, porque
o dinheiro já saiu do banco, e o lançamento fica marcado como vindo do
extrato. Entrou junto a transferência direta entre contas (o caso mais
comum na prática) e o relatório de conta corrente, com saldo
compensado por par. O lançamento ganhou o campo "Nota em nome de",
sem o qual a comparação de CNPJ não tinha em que se apoiar.

**Fontes duplas: resolvidas na v18.** `valorNoCentro` e
`despesaPorEmpresa` passaram a usar a mesma divisão (`partesDoRateio`),
com a sobra de centavos na última parte — de 1 a 200 num rateio
33,33/33,33/33,34, nenhum valor deixa de fechar, contra 133 antes. As
duas provisões de pessoal viraram uma, com encargos nas duas pontas e
saldo acumulado.

A alíquota do mutirão foi resolvida na v15: o cadastro do projeto é a
fonte única (9,04%), e Procedimentos passou a lê-lo como o resto do
sistema já fazia. A tela de Administração continua existindo, mas
escreve no cadastro do projeto, e os subprojetos por especialidade
acompanham o projeto-mãe.

**Os médios e baixos: feitos na v18**, exceto os que dependem de dado
seu. Ver o changelog da v18 em `VERSAO.md` para a lista item a item.
O que ficou é cadastro, não código: quais projetos pertencem ao CNPJ
da filial CE (está em `PENDENCIAS-CONHECIDAS.md`).

As sugestões de produto ficaram numa fila à parte, sem data.

---

## Sobre dois achados

**A6 — conta corrente entre empresas inalcançável.** Procede: nenhuma
tela manda `confirmar_cruzamento`. Vale notar que o caminho pela
conciliação precisa de decisão de produto antes do código — o extrato
é fato consumado, então a flag pode ir automática ali; já a tela de
pagamento deve perguntar. Entra junto com o padrão 3.

**A15 — `armazemDaEspecialidade` devolve a sala do HGB para outro
hospital.** Procede, e contradiz o que `PENDENCIAS-CONHECIDAS.md`
afirma. Corrigir antes de cadastrar o segundo hospital, não depois.
