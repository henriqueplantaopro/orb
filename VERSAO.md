# v106 — previsão de faturamento no módulo de Faturamento

## Mudou de lugar
A aba **Previsões** saiu do Financeiro e virou a primeira aba do
**Faturamento** — é dali que a esteira parte (previsão → valor
confirmado → autorizado → liberado → faturado), e o módulo agora abre
nela. A ordem das abas passou a seguir esse fluxo: Previsões, Esteira,
RPS em lote, Notas do portal, Fatura, Cobertura.

"Despesas previstas" continua no Financeiro: é previsão de saída, não
de faturamento.

## Um botão, um ato
"Salvar previsões" e "Confirmar mês" viraram **"Salvar e confirmar o
mês"**. Separados, o valor ficava digitado mas invisível no contas a
receber até alguém lembrar de clicar no segundo botão. Agora um clique
grava a grade e leva tudo ao contas a receber como "previsto".

"Encerrar mês" segue como botão próprio — é o ato oposto, do fim do
mês, e cancela o previsto que não virou nota.

Quando a grade tenta sobrescrever valor confirmado pela produtividade, a
pergunta continua: confirmando a troca, o valor é gravado e confirmado
no mesmo passo.

teste-fumaca.js: 501 verificações.

---

# v105 — retenção por cliente e parâmetros fiscais editáveis

## Retenção é do cliente, não do sistema
Cada tomador retém de um jeito, então o arquivo de RPS passou a usar as
retenções do **cadastro do cliente** (Cadastros › Clientes, onde já
existiam ISS, IRRF, PIS, COFINS, CSLL e INSS com alíquota). Cliente sem
retenção cadastrada gera arquivo sem nenhuma linha de retenção.

O ISS é a exceção: entra no líquido do contas a receber, mas fica fora
do arquivo. O registro 3 do layout de Barueri só tem código para os
tributos federais — a retenção do ISS ali decorre do código do serviço
e da natureza do tomador, não de um campo do RPS. O total de retenções
do registro 2 e o rodapé passaram a somar só os federais, coerente com
isso.

## Parâmetros fiscais na tela
Nova aba **Administração › Parâmetros fiscais (NF-e)**: inscrição
municipal, código IBGE, código do serviço, série do RPS, NBS, indicador
de operação, classificação e situação tributária do IBS/CBS, e o
enquadramento no Simples (a HJM fica como **não optante**). Cada campo
traz onde encontrar o valor certo.

Os valores de fábrica são uma sugestão razoável para serviços médicos —
servem para testar a emissão de ponta a ponta e podem ser trocados
depois sem mexer em código.

teste-fumaca.js: 497 verificações.

---

# v104 — namespace do web service confirmado

O envelope SOAP usava `http://tempuri.org/`, o padrão de serviços .asmx.
A página do próprio serviço (`wsrps.asmx?op=NFeLoteEnviarArquivo`) mostra
que o namespace de Barueri é **`http://www.barueri.sp.gov.br/nfe`**, e o
SOAPAction é esse endereço + `/` + o nome do método. Com o namespace
errado, a prefeitura responderia "Mensagem XML não compatível" sem dizer
o motivo.

Confirmado também que o serviço está no ar e expõe exatamente os quatro
métodos do manual. O ciclo completo foi reexecutado contra o simulador
já com o namespace real.

O LEIA-ME ganhou a lista de perguntas para a contabilidade (código do
serviço, alíquota de ISS, e os códigos de IBS/CBS).

---

# v103 — utilitário de envio ao web service de Barueri

O ERP já gerava o arquivo de RPS (v102). Agora existe o **envio-rps**,
um utilitário que fala direto com o web service da prefeitura usando o
certificado A1 — sem portal, sem senha guardada, sem servidor.

## Pasta `envio-rps/`
- `barueri-ws.js` — o núcleo: SOAP sobre HTTPS com certificado do
  cliente, os quatro métodos do manual (`NFeLoteEnviarArquivo`,
  `NFeLoteStatusArquivo`, `NFeLoteListarArquivos`,
  `NFeLoteBaixarArquivo`), `VersaoSchema` + `MensagemXML` em CDATA,
  arquivo em base64 e leitura das mensagens de retorno. **Não sabe nada
  de tela nem de linha de comando**: quando o ERP for para a nuvem,
  este arquivo vai junto sem reescrita.
- `enviar-rps.js` — linha de comando: `envelope`, `validar`, `enviar`,
  `status`, `listar`, `baixar`. Grava `envios.log` e salva os retornos.
- `config.exemplo.json` e `LEIA-ME.md`.

`validar` usa o `ApenasValidaArq` da prefeitura: confere o arquivo
inteiro e devolve as críticas **sem gerar nota**. É a ordem segura —
homologação, depois validação em produção, depois o envio real.

## No ERP
O lote de RPS passou a guardar **protocolo, situação e ambiente**
(produção ou homologação), com botão "Protocolo" na aba RPS em lote. A
situação "2" marca o lote como "arquivo com erros".

## Testado
O núcleo foi exercitado contra um web service simulado com as mesmas
respostas do manual: envio com certificado do cliente, arquivo íntegro
na outra ponta, espera do processamento assíncrono, consulta de status,
listagem e download do retorno. **Contra o serviço real não foi testado**
— este ambiente não alcança o domínio da prefeitura.

Correção de passagem: os testes de RPS da v102 não estavam rodando (o
módulo não era carregado na bateria e o arquivo parava ali sem acusar
falha). Agora rodam.

teste-fumaca.js: 492 verificações.

---

# v102 — emissão de NF por arquivo de RPS (portal de Barueri)

Nova aba **Faturamento › RPS em lote**. O sistema monta o arquivo que o
portal converte em NF-e, no layout oficial de Barueri (texto posicional
"PMB004", versão 4.4, ISO-8859-1, CRLF), com os registros 1 (cabeçalho),
2 (RPS), 3 (retenções), 4 (Ambiente de Dados Nacional) e 9 (rodapé).

## Como funciona
1. A aba lista o que está **liberado para faturar** na competência —
   grupo de faturamento vira UM RPS só, somado.
2. Antes de gerar, o sistema confere o cadastro e diz o que falta
   (CNPJ, endereço, CEP, código IBGE, e-mail do tomador, código do
   serviço). Cliente incompleto não entra no arquivo.
3. Gera o .txt, numerando os RPS em sequência contínua entre lotes.
4. Você envia no portal ("Envio de Arquivo de RPS", com "Gera NF-e
   automaticamente").
5. Volta aqui e informa os números que a prefeitura devolveu: é nesse
   momento que o título nasce no contas a receber, com o número real da
   nota.

## Cadastro
- Empresa: inscrição municipal, endereço, código IBGE e os parâmetros
  fiscais (código do serviço, NBS, indicador de operação, classificação
  e situação tributária do IBS/CBS) — conferir com a contabilidade
  antes do primeiro envio de verdade.
- Cliente: endereço completo, CEP, código IBGE da cidade e e-mail
  (obrigatório para pessoa jurídica no layout).

teste-fumaca.js: 473 verificações, incluindo o tamanho de cada registro,
os valores em centavos e a ausência de caractere fora da tabela Latin-1.

---

# v101 — autorização no faturamento e conciliação legível

## A autorização do órgão saiu da produtividade
Faturamento se trata no módulo de Faturamento. A ação de registrar a
autorização ficou só em **Faturamento › Esteira**, e o alerta da página
inicial leva direto para lá. A aba Cobertura da Produtividade continua
mostrando em que etapa cada projeto está — como informação, sem ação —,
com o aviso de onde a autorização é feita.

## Conciliação: o comparativo ficou legível
O cabeçalho e as células estavam em ordens diferentes (o cabeçalho dizia
"Valor sistema" onde vinha a descrição do extrato), então dava pra ler o
valor de um lado como se fosse do outro. Agora são dois blocos:

- **No extrato do banco:** valor, nome da contraparte e o histórico
  original, juntos na mesma célula.
- **No sistema:** o líquido em destaque e, quando há retenção, o bruto e
  quanto foi retido, mais o nome do cadastro, o documento e a indicação
  de qual dos dois o banco pagou ("o extrato pagou o líquido").
- **Diferença** em palavras: "bate" quando fecha, ou o valor com "a mais
  / a menos no extrato".

No painel de candidatos, líquido e bruto agora são colunas próprias, o
extrato aparece no topo para comparação, e a diferença usa o mesmo
critério das listas.

teste-fumaca.js: 471 verificações.

---

# v100 — a situação diz a etapa, e a autorização fica onde nasce

## Rótulos por etapa
"Valor confirmado — falta a NF" dava a entender que bastava emitir.
Agora a situação acompanha a esteira, no contas a receber, na cobertura
e na produtividade:
- **aguardando autorização do órgão** (logo após o fechamento);
- **autorizado — aguardando liberação** (com o protocolo do ofício);
- **liberado para emissão de NF**;
- **faturado**.

## A autorização ficou na tela da produtividade
Quem lança o fechamento é quem fala com o hospital e recebe o ofício —
então o botão **"Órgão autorizou"** está na aba Cobertura da
Produtividade, na linha do projeto, junto do valor confirmado. Um
clique, pede o protocolo e a data, e pronto. A esteira do faturamento
continua tendo a mesma ação, para quem preferir trabalhar por lá.

A aba mostra também em que etapa cada projeto está e o número do ofício
registrado, e a página inicial ganhou o alerta "Fechamentos esperando
autorização do órgão", que leva direto para essa tela.

teste-fumaca.js: 469 verificações.

---

# v99 — grupo de faturamento na cobertura

As 7 especialidades do HGB sem produtividade no mês continuavam
aparecendo como "sem faturamento", cobrando uma NF que o hospital nunca
vai emitir — o faturamento do GHC-HGB é único.

- Projeto que faz parte de um grupo **não deve nota própria**. Quem tem
  base no mês aparece como faturado, com a sua parte do rateio; quem não
  teve plantão aparece como "sem produtividade no mês", em cinza, sem
  ação pendente e sem o botão "Não fatura neste mês" (não há o que
  encerrar).
- Cada linha do grupo mostra "nota única: GHC - HGB", pra não parecer
  que faltou documento.
- O alerta de faturamento atrasado e o contador de pendências contam o
  GRUPO uma vez, não oito.

teste-fumaca.js: 461 verificações.

---

# v98 — depreciação no custo do projeto e faturamento único de grupo

## Depreciação
Equipamento alocado num projeto custa àquele projeto mesmo sem nota no
mês — é capital imobilizado ali. Sem isso, locação e projeto remunerado
por laudo (ultrassom) aparecem com margem que não têm.
- Padrão de **60 meses**, ajustável por equipamento no cadastro (vida
  útil mais curta ou mais longa).
- O custo cai no projeto onde o equipamento ESTAVA no último dia da
  competência (pelo histórico de movimentação), não onde ele está hoje:
  respirador devolvido em março não deprecia no projeto em agosto.
- Equipamento parado não onera projeto nenhum, e o bem para de custar
  quando termina a vida útil.
- Nova coluna **Depreciação** no Resultado por projeto, somando no
  resultado e na margem; a ficha do ativo mostra acumulada e residual.

## Faturamento único para vários projetos (GHC - HGB)
As 8 especialidades do HGB são projetos separados — cada uma com sua
produtividade e seu repasse —, mas o hospital emite UMA nota. Amarrar a
nota a um projeto nunca fechava com o previsto.
- Campo **grupo de faturamento** no projeto (as 8 do HGB já vêm
  marcadas). A produtividade continua lançada por projeto.
- A base do grupo é a SOMA do que cada projeto confirmou, com a lista
  para conferir e o aviso de quantos ainda faltam confirmar.
- A nota única é rateada entre os projetos na proporção do confirmado
  (centavo da diferença na última linha), amarra as previsões de todos
  eles e cada especialidade fica com a sua parte no resultado.
- Cada projeto do grupo continua precisando da sua liberação na esteira:
  a nota é uma só, mas a autorização do órgão é por medição.

## Cobertura de faturamento com valores
A aba passou a mostrar o montante, que é o que o gestor pergunta:
previsto, confirmado, faturado e **falta faturar** — no total e por
projeto. O valor exibido é o mais firme que existe (faturado, senão
confirmado, senão previsto). Grupos de faturamento ganham um resumo
próprio, com botão para lançar a nota única.

teste-fumaca.js: 455 verificações.

---

# v97 — resultado por unidade: desmembrar a compra e vincular a locação

## Desmembrar a compra
Uma compra de 10 camas pode seguir de três jeitos, e agora os três
existem:
- **em conjunto** — como está hoje, um registro com a quantidade;
- **em lotes** — 2 para um projeto, 5 para outro, 3 na sede: cada parte
  vira um registro próprio, com destino, custodiante e situação
  próprios;
- **tudo unitário** — um registro por unidade, com um clique.

O valor da compra é rateado por unidade (é o que dá sentido ao resultado
individual), a divisão precisa fechar com a quantidade comprada, parte
alocada exige projeto e custodiante, e cada parte nasce com o evento de
entrada — a história começa ali. Todas continuam apontando para a mesma
COMPRA, então dá para ler o resultado por unidade e o da compra inteira.

## Locação por equipamento
Cada ativo pode apontar para o contrato de cliente que o remunera, com
valor mensal do item, início e devolução. Com isso o resultado por
equipamento fica: receita acumulada − aquisição − manutenção, mais
**quantos meses faltam para a compra se pagar**. A receita conta até a
devolução ou o fim do contrato, não até hoje — equipamento devolvido em
março não fatura em setembro.

## Na tela
Inventário ganhou a coluna de locação (contrato e valor mensal) e os
botões "Desmembrar" (só em registro com mais de uma unidade) e
"Locação". O relatório de resultado tem a opção de agrupar por compra em
vez de por unidade.

teste-fumaca.js: 439 verificações.

---

# v96 — módulo de ATIVOS (equipamentos)

Separado do almoxarifado de propósito: lá a pergunta é "tenho quantas",
aqui é "onde está esta". Não há saldo — há item, com série, local,
custodiante e história. Cadastro de fornecedor, entrada por NF, centro
de custo e anexos continuam compartilhados.

## Base
Os 27 equipamentos da planilha atual (R$ 3,56 mi) entram como cadastro
inicial, com o de/para 1:1: Status, Projeto, Local de Alocação e
Custodiante. Linhas que são lote (5 camas, 10 filtros) entram como um
registro com a quantidade indicada, para desmembrar depois.

## Regra central: local nunca é editado
Toda mudança é um EVENTO (de onde, para onde, quando, quem autorizou,
documento de remessa). Local e situação atuais são consulta do último
evento, e há consulta de onde o equipamento estava numa data passada —
sem isso não há como provar devolução. O sistema recusa alocar sem
projeto, mandar para fora da sede sem custodiante e datar no futuro.

## Ordens de serviço
Corretiva e preventiva, com solicitante, executante, parada de uso,
custo de peça e de serviço. Equipamento marcado como parado sai de
operação por evento e volta por evento ao fechar a OS.
**Fechar a OS com fornecedor e custo lança a conta a pagar no centro do
projeto onde o equipamento está** — é o que faz a manutenção entrar na
margem do contrato certo, em vez de virar despesa da sede.

## Preventiva
Plano por equipamento ou por categoria, com periodicidade, checklist e
próxima data. A preventiva vencida abre a OS sozinha quando alguém entra
no módulo (sem servidor, é o que substitui o job diário) e não duplica.

## Leitura gerencial
- **Ociosidade:** o que está parado, há quanto tempo e quanto de capital
  está imobilizado (hoje: 13 equipamentos, R$ 1,55 mi).
- **Resultado por equipamento:** receita do contrato que o remunera,
  menos aquisição e manutenção — para decidir comprar, alugar ou
  sucatear e para precificar a próxima proposta de locação.
- Exportação do inventário em Excel, PDF ou CSV.

## Próximos passos deste módulo (não incluídos)
QR Code na etiqueta com página pública de abertura de chamado; criação
do ativo a partir do XML da NF de compra; desmembrar lote em unidades.
Fora de escopo por decisão: calibração, certificado metrológico e laudo
assinado.

teste-fumaca.js: 422 verificações.

---

# v95 — esteira do faturamento (5 etapas, duas mãos)

Confirmar o valor no fechamento NÃO libera faturar. O caminho agora é
explícito e travado:

1. **Previsão** — estimativa do mês.
2. **Valor confirmado** — o fechamento da produtividade fechou o número.
3. **Autorizado pelo órgão** — o hospital aceitou aquele valor
   (protocolo, ofício, ata de medição).
4. **Liberado para faturar** — quem responde pelo faturamento liberou.
5. **Faturado** — NF ou fatura emitida.

Emitir NF ou fatura é BLOQUEADO enquanto não houver liberação, e a
mensagem diz em que etapa a competência parou.

## Duas mãos, de propósito
- **Registrar a autorização do órgão** (permissão nova) fica com quem
  confirma o fechamento da produtividade — é quem fala com o hospital.
  O assistente financeiro passou a ter essa permissão.
- **Liberar o faturamento** (outra permissão) fica com quem responde
  pelo faturamento (diretoria, sócio, administração), que também
  altera previsão e lançamento.
- Se o valor mudar depois da autorização, a liberação avisa e exige
  decisão: pedir nova autorização ou liberar assim mesmo.
- Desfazer a liberação é de quem libera; desfazer a autorização, de quem
  autoriza (e só depois de tirar a liberação). Ambos exigem motivo.

## Aba Esteira (Faturamento)
Uma linha por projeto e competência, com o carimbo de cada etapa (data e
quem fez), o valor, o documento emitido e há quantos dias está parada.
Ordem: mais atrás na esteira e parado há mais tempo primeiro; **faturado
vai para o fim**. Linha parada há mais de 15 dias fica destacada.
Filtros por competência e etapa, contador por etapa e opção de esconder
os já faturados. A aba mostra o número de competências pendentes.

teste-fumaca.js: 400 verificações.

---

# v94 — relatórios: menu, timbrado e filtros de período

## Menu suspenso, em vez de botões lado a lado
Sete relatórios enfileirados ocupavam a largura inteira. Agora é uma
lista suspensa, agrupada, com os dois do financeiro na frente:
- Financeiro — período: Contas a pagar e a receber · Contas pagas e
  recebidas (abre neste);
- Resultado: DRE por competência · Total por centro de custo ·
  Resultado por projeto;
- Caixa e produtividade: Fluxo de caixa · Custos por setor/tipo.

## Timbrado padrão em todos
Empresa e CNPJ, nome do relatório, período selecionado, data de emissão
e quem emitiu. Na impressão, filtros e botões saem da página.

## Filtro de período em todos
- **DRE** e **Total por centro de custo**: não tinham recorte nenhum —
  agora seguem o período (por competência).
- **Resultado por projeto**: idem. A lista segue mostrando só os
  projetos com custo ou receita — agora, dentro do período.
- **Fluxo de caixa**: recorte por DIA exato (antes só mês inteiro).
  Realizado entra pela data do pagamento/recebimento e o previsto pelo
  vencimento; o que venceu e não foi pago continua vindo para o mês
  corrente, quando ele está dentro do período.
- **Custos por setor/tipo**: ganhou período e, na lista de projetos,
  as UNIDADES na frente ("AGIR — todos"), pra filtrar o projeto mãe
  inteiro sem escolher setor por setor. Os setores listados passam a ser
  os da unidade quando ela é a escolhida.

teste-fumaca.js: 384 verificações.

---

# v93 — pontos menores da auditoria

- **Excel, coluna de data:** uma célula "—" no meio da coluna a fazia
  sair como texto (sem ordenar nem filtrar por período). Traço agora
  vira célula VAZIA, e a coluna sai como data de verdade. Conferido
  exportando o contas a receber com uma NF sem vencimento: a coluna
  Previsão saiu só com datas e vazios.
- **Número de documento no a receber é único:** o mesmo número era
  aceito em projetos diferentes — duas cobranças com a mesma referência,
  e o cliente paga uma achando que quitou as duas. Agora é recusado,
  dizendo onde o número já está em uso. Documento cancelado libera o
  número de volta.
- **Rodapé do PDF:** dizia "1 coluna(s) só no Excel/CSV" quando havia 12
  fora. Passou a contar todas as ausentes — as marcadas para não sair e
  as cortadas pelo limite de 12 colunas.

teste-fumaca.js: 380 verificações.

---

# v92 — auditoria da v91: os três pontos que faltavam

## 1. Entrada de estoque amarra o título ao pedido
Com "Lançar também no contas a pagar" marcado (que vem ligado), o
título nascia sem `pedido_id`: a descrição até escrevia o número do
pedido, mas a previsão continuava viva e o fluxo mostrava a mesma
compra duas vezes (previsão + título da entrada). Agora o vínculo vai
adiante e a previsão é baixada pela nota, como no lançamento manual.

## 2. Conferência da quantidade contra o pedido
Receber 40 num pedido de 4 deixava estoque e pedido com verdades
diferentes (estoque +40, pedido "4/4"). Agora a entrada é RECUSADA
antes de tocar no estoque, dizendo quanto falta receber de cada
material. Material que não está no pedido também é barrado. Quem
recebeu material a mais desvincula o pedido e lança como entrada
avulsa — que é o que aconteceu de fato.

## 3. Grade de previsões não sobrescreve o valor confirmado
Era o terceiro caminho: digitar na grade e "Salvar previsões" trocava o
valor mas mantinha o selo "confirmado no fechamento por Fulano" — o
rótulo dizia o que o número não sustentava. Agora:
- salvar recusa a troca e diz o valor confirmado que está gravado;
- a tela lista os projetos em conflito (confirmado × digitado) e pede
  confirmação explícita;
- confirmando, o valor troca, o selo cai e o título no contas a receber
  acompanha o novo valor;
- mexer só na produtividade, sem trocar o faturamento, continua livre.

teste-fumaca.js: 377 verificações.

## Pontos menores do relatório (ainda abertos)
Célula "—" numa coluna de data ainda sai como texto no Excel, número de
fatura repetido é aceito em projetos diferentes, e o rodapé do PDF conta
só as colunas cortadas pelo limite, não as marcadas para não sair.

---

# v91 — auditoria da v88: correções

## Produtividade
- **Regressão crítica corrigida:** `refJaUsada` chamava uma função que
  só existia dentro de `criarTitulo` e derrubava a importação justamente
  quando havia fechamento complementar. A função passou para o escopo do
  módulo.
- **Complemento virou decisão, não automatismo.** Quando parte do
  arquivo já foi lançada, o sistema pergunta: fechamento COMPLEMENTAR
  (entra de novo e será pago de novo) ou reimportação por engano (os
  repetidos ficam de fora). Automático transformaria uma reimportação
  acidental em pagamento em dobro.
- **Cancelamento com pagamento feito exige autorização do
  administrador** (regra da empresa): sem nenhum pagamento, cancela
  direto; a partir do primeiro, só o administrador autoriza, com a
  justificativa escrita (fica na auditoria). As parcelas já pagas não
  são canceladas — viram correção manual, e a tela diz isso.

## Faturamento
- O realizado da previsão passou a reconhecer FATURA, não só NF.
- Previsão já substituída não volta a "previsto" no "Confirmar mês",
  no "Salvar previsões" nem no "Aplicar valores".
- **Cancelamento de NF/fatura no contas a receber** (não existia):
  devolve a previsão substituída e libera emitir outro documento na
  competência. A mensagem do bloqueio aponta esse caminho.

## Compras e estoque
- **Entrada vinculada ao pedido:** pedido e armazém agora vivem no
  estado da tela e não zeram no redesenho — a entrada gravava sem
  pedido, o pedido ficava com 0 recebido e o frete era rateado de novo
  a cada carga.
- Entrada pela tela de Compras sugere o preço COTADO com frete rateado,
  não o custo do cadastro.
- Recebido não passa do pedido: 50 num pedido de 10 entra como 10, com
  40 registrados como excedente.
- **A previsão do pedido só é baixada pela nota VINCULADA a ele**, por
  um campo novo no lançamento. Antes qualquer nota do mesmo fornecedor
  abatia a previsão.
- **Estorno de transferência não cria mais material:** os dois lados são
  conferidos antes de qualquer alteração; se o destino já consumiu, o
  estorno é recusado sem mexer em saldo.

## Cadastros e compras
- Salvar o cliente grava o vínculo NO PROJETO (com confirmação quando o
  projeto já é de outro cliente).
- Produto repetido na requisição é somado numa linha só.
- Requisição sem item é recusada, e reprovar item exige motivo.
- Requisição grava quem abriu, e a segregação de funções em compras
  ganhou o controle em Administração › Alçadas e políticas (desligada
  por padrão).

## Alertas e exportações
- **Tarifa, IOF, encargos e juros bancários ficam fora do alerta "pago
  sem NF"** (decisão): são despesas sem nota por natureza. Dispensa
  marcada à mão também tira do alerta.
- O cartão "Vencidas" usa o mesmo critério do alerta e da lista; título
  sem vencimento não conta como vencido.
- Uma célula "—" não descaracteriza mais a coluna de datas no Excel.
- Contas a pagar rateado: a coluna "Valor da parcela" leva o valor DA
  LINHA; o valor cheio do título vai em coluna à parte, fora do PDF.
- Validade, no extrato de estoque, sai como data.

teste-fumaca.js: 364 verificações.

---

# v90 — atestado de capacidade técnica por cliente

Atestado é o que sustenta a habilitação técnica em licitação, e o
hospital demora a emitir. Agora o sistema cobra sozinho e já monta o
que o cliente precisa receber pra escrever o documento.

## Alerta
- Cartão na página inicial: "Atestados de capacidade técnica a
  atualizar", que leva direto à tela.
- Um cliente entra no alerta quando TEM prestação registrada (medição de
  produtividade, fechamento ou nota) e o último atestado passou do
  prazo. Sem prestação, não há o que atestar, e o cliente não alerta.
- Padrão de 6 meses, ajustável por cliente. Dá para marcar um cliente
  como dispensado.
- Registrar só o PEDIDO não tira do alerta — pedido não vale em
  licitação. A tela passa a mostrar "pedido em dd/mm — aguardando", pra
  ninguém pedir duas vezes nem esquecer de cobrar. Só o atestado
  recebido reinicia a contagem.

## Histórico para o atestado
Botão em cada cliente, com período (começa no último atestado) e, por
projeto: serviço, contrato e objeto, primeira e última competência,
meses de prestação, médicos distintos que atuaram, notas emitidas, valor
faturado e produção médica medida. Totais no rodapé.

Exporta em Excel, PDF ou CSV, com cabeçalho trazendo o nome e o CNPJ do
contratante e o período — é o anexo do pedido.

## Registro
Guarda situação (recebido ou pedido), data, número, período atestado,
observação e o arquivo do documento, com o histórico de registros
anteriores por cliente.

Nova aba: Cadastros › Receita › Atestados.

teste-fumaca.js: 343 verificações.

---

# v89 — relatórios do financeiro por período

Dois relatórios novos em Financeiro › Relatórios, no formato da planilha
que o financeiro já usa. Cada um sai em ARQUIVO PRÓPRIO, com uma aba só.

## Contas a pagar e a receber (projeção)
O que VENCE no período, entradas e saídas na mesma lista, em ordem de
vencimento, com saldo corrido a partir do saldo bancário de hoje.
- Primeira linha é o saldo de partida, como no modelo.
- Colunas: Tipo, Mov., Documento, Forma PG, Fornecedor, Descrição,
  Competência, Emissão, Vencimento, Parcela, Valor da parcela, Saldo.
- Valor é o SALDO da parcela (o que falta pagar/receber), não o valor
  cheio — parcela paga pela metade entra pelo que resta.
- Linha com saldo negativo fica destacada, e um aviso mostra que o caixa
  fica negativo dentro do período.
- Título ainda previsto aparece marcado como "previsto".

## Contas pagas e recebidas (realizado)
O que foi BAIXADO no período, pela data do pagamento ou recebimento.
- Colunas: Tipo, Documento, Forma, Fornecedor, Descrição, Competência,
  Emissão, Vencimento, Data baixa, Parcela, Valor da parcela.
- O valor pago inclui juros e multa, com a parte de juros indicada na
  descrição.
- Rodapé com recebido, pago e resultado do caixa.

## Comuns aos dois
- Filtro de período com atalhos "Mês atual" e "Próximos 30 dias".
- Exportação em Excel, PDF ou CSV. No Excel vão o cabeçalho (título,
  período e saldo bancário), a tabela com filtro pronto, datas como data
  e valores como número, e os totais no rodapé. O nome do arquivo leva o
  período.
- Sigilo: descrição e nome em títulos de pessoal seguem mascarados para
  quem não tem acesso a dados pessoais.

teste-fumaca.js: 332 verificações.

---

# v88 — pendências da auditoria (o que tinha ficado para depois)

## Dado que se perdia
- "+ cadastrar cliente" dentro de um CONTRATO preserva vencimento,
  prazo, multa, juros, correção, regras, aviso prévio, garantia e
  contato; dentro de um PROJETO de locação, preserva os itens.
- "+ cadastrar" na CONCILIAÇÃO reabre o lançamento com conta, centro,
  fornecedor, NF e descrição preenchidos.
- Contrato com linha em projeto INATIVO não perde mais a linha: o
  projeto continua na lista, marcado como inativo.

## Erro que passava
- "23.000" digitado passou a valer vinte e três mil (era R$ 23,00).
- Contrato recusa dia de vencimento fora de 1–31, multa/juros/prazo
  negativos, multa acima de 20% e juros acima de 20% ao mês; número é
  comparado sem diferenciar maiúsculas.
- TED (ou DOC) sem banco, agência e conta passou a impedir o pagamento —
  antes só o CPF/CNPJ era cobrado.
- Nome digitado na conciliação que não existe pede confirmação antes de
  criar fornecedor novo (erro de digitação criava duplicado calado).
- Em lote, o número de NF é recusado: uma nota não cobre várias saídas.
- Funcionário e médico não são editáveis pela aba Fornecedores (virava
  "médico" e trocava dados bancários sem aprovação).
- "+ Novo projeto" do Faturamento usa o cadastro completo (o curto criava
  projeto sem cliente, tipo e impostos).
- Excluir projeto pede confirmação e recusa com contrato, cliente,
  estoque ou movimento, dizendo qual é a amarra.
- "Mostrar inativos" passou a funcionar em Produtos, Fornecedores e
  Armazéns (o clique só estava ligado na aba de Projetos).
- Desmarcar "Sem NF" sem informar número é recusado, como a própria tela
  já dizia.
- Lista de pacientes só é gravada com o modo "vários pacientes" aberto.

## Produtividade e faturamento
- A cobertura soma TODOS os fechamentos do mês (mostrava só o último).
- Cancelar um fechamento desfaz a confirmação do valor a faturar, e o
  cancelamento parcial avisa que as parcelas pagas continuam valendo.

## Compras
- Anexos de cotação abrem em aba, nas duas telas de aprovação.
- Frete total por fornecedor com botão de ratear (proporcional ao valor,
  centavos ajustados na última linha).
- Alçada não trava o envio de compra que a diretoria já aprovou.
- Pedido dividido leva anexos e quem aprovou; anexo repetido não duplica.
- Fornecedores da cotação sem órgãos, sócios e funcionários.

## Estoque
- **Estorno de baixa e de transferência** (os dois lados), pelo mesmo
  custo, com motivo obrigatório e sem repetir os pacientes — o consumo
  estornado sai do relatório por paciente.
- Cartão de estoque mínimo abre a posição, não o último armazém usado.

## Acabamento
- Aba "Atrasadas" de verdade no contas a receber, com contador.
- Selo próprio para "valor confirmado" (era o mesmo verde de "pago").
- Datas exportadas como DATA no Excel (ordenam e filtram).
- Contador do filtro de fornecedor respeita a aba aberta e a escolha não
  se perde ao trocar de aba.
- Cartões de contrato dizem se é de cliente ou de fornecedor e respeitam
  a aba.
- Largura ajustada para notebook de 1366 px.

teste-fumaca.js: 322 verificações.

---

# v87 — auditoria da v85, blocos 2, 3 e 4

## Bloco 2 · integridade dos cadastros e de compras
- **Cliente mora no projeto.** Um cliente pode ter vários projetos (as 8
  especialidades do HGB, as filiais) e salvar um cadastro não desliga
  mais o vínculo do outro projeto. Migração automática do modelo antigo
  (cliente.centro_padrao) na carga.
- **Fechamento complementar de produtividade** deixou de ser descartado
  como duplicado: o 2º lançamento do mesmo médico/competência entra como
  complemento e aparece no aviso da importação.
- **Compras:** "Editar" só enquanto é requisição (depois de aprovada,
  passava por cima da aprovação e zerava a cotação); aprovar com
  quantidade 0 é reprovação; não dá pra aprovar mais do que foi pedido;
  o mesmo produto em duas linhas é tratado por posição; frete negativo
  vira zero; reprovar exige motivo.
- **Segregação de funções em compras** virou parâmetro
  (`impedir_autoaprovacao_compras`), desligado por padrão: quem pede não
  aprova, quem cota não aprova a compra — ligue quando quiser exigir.

## Bloco 3 · alertas e sigilo
- **Página inicial recalcula ao voltar** para "Início" (antes só na
  carga e na troca de usuário — todos os alertas ficavam velhos).
- **Um critério só de "vencido"** para o alerta, o cartão e a lista; sem
  vencimento não vira "NaN dias".
- **H1** para de alertar quando já existe NF ou fatura na competência.
- **H4** soma o valor PAGO, não o do título.
- **H3:** "não fatura nesta competência" por PROJETO, na cobertura, em
  vez de inativar o projeto (que o apagaria dos meses passados).
- **Estoque mínimo por SETOR** (cadastro por armazém, com o número do
  produto como padrão). O alerta virou um por material e unidade — antes
  o mesmo item faltando em 3 setores pedia 3x a quantidade — e material
  zerado na unidade voltou a aparecer.
- **Sigilo:** o filtro por fornecedor não lista funcionários e médicos
  para quem não vê dados pessoais, e a busca procura sobre o texto
  mascarado (antes achava o salário digitando o nome).
- **LGPD:** nome de paciente virou permissão própria
  ("Ver e exportar nome de paciente"). Sem ela, a movimentação aparece
  com o nome como "[restrito]", a busca não acha por nome e o relatório
  não abre. Nova aba **Consumo por paciente** (paciente × material,
  quantidade, custo, período), com acesso registrado na auditoria.

## Bloco 4 · exportações e acabamento
- **Exportações a partir dos dados** no extrato de estoque (todos os
  nomes de paciente, todas as linhas, quantidade como número) e na
  trilha de auditoria (agora em Excel, PDF e CSV).
- As exportações que copiam a tela passaram a ignorar colunas de ação e
  linhas de total (contas a receber vinha com "Baixar/Editar", a folha
  exportava o total como funcionário, o "Total por centro" saía
  deslocado).
- **Excel do contas a pagar:** título rateado leva pago e saldo na mesma
  proporção do rateio (antes repetia o valor cheio em cada linha).
- **PDF de lista larga** corta as colunas menos importantes e avisa no
  subtítulo, em vez de sair tudo ilegível.
- **Extrato de estoque** ganhou filtro de período, busca sem acento e
  deixou de perder linhas na exportação.
- **Holerite:** linha de corte mais forte que a borda (a borda do quadro
  é sempre contínua) e, com muitas rubricas, o quadro ajusta o
  espaçamento e avisa quantas não couberam.
- **Datas no fuso de quem usa:** depois das 21h o registro caía no dia
  seguinte (era gravado em UTC).
- Correção do ouvinte de digitação que se acumulava a cada abertura da
  baixa de estoque e gerava um erro por tecla.

teste-fumaca.js: 305 verificações.

## Não tratado, por decisão
- **Persistência** (recarregar perde o que foi lançado): esperado
  enquanto o sistema roda como arquivo local.
- **Envio automático de e-mail ao fornecedor:** exige servidor. O que há
  é a mensagem pronta para conferir e enviar.

---

# v86 — auditoria da v85, bloco 1: dinheiro e dados

## Remessa bancária sem o BOM
A função de download punha a marca de codificação (que o Excel precisa
no CSV) em TODO arquivo, inclusive na remessa CNAB: a 1ª linha ia com
243 posições em vez de 240 e o banco tende a recusar. Agora o BOM entra
só em CSV.

## Faturamento
- **Fatura de locação realiza a previsão**, como a NF já fazia. Antes a
  fatura somava por cima e o "a receber" contava o mesmo faturamento
  duas vezes (UNIFOR: R$ 104.700 + R$ 96.250).
- **Segunda fatura/NF na mesma competência é recusada**, dizendo qual
  documento já existe e o valor.
- **Anexar fatura feita por fora** passou a pedir número, valor e data
  do documento — antes entrava com o valor do contrato cheio.
- **PDF da fatura pagina**: com 75 itens saía 1 página, 59 itens e sem
  total; agora sai completo, com o cabeçalho repetido.

## Previsão
- **"Confirmar" em Previsões não rebaixa mais** o valor confirmado pela
  produtividade (que é medição, não estimativa). Avisa quantas foram
  mantidas.
- **"Aplicar valores nas previsões" (Contratos)**: só contratos de
  CLIENTE (o de fornecedor virava receita), só os vigentes na
  competência, SOMANDO quando o projeto está em mais de um contrato, e
  nunca por cima do valor confirmado pela produtividade.

## Conciliação
O número do documento do extrato não é nota fiscal. O título nasce sem
NF (marcado "sem NF", entrando no alerta) e o número do banco vai para a
observação.

## Compras
- **NF do fornecedor baixa a previsão do pedido** — antes ficavam as
  duas e o fluxo mostrava a saída em dobro. Com valor diferente, a
  previsão encolhe e sobra o resíduo.
- **Entrada de estoque puxa o preço COTADO e o frete rateado** por
  unidade ao vincular o pedido, em vez do custo do cadastro.

teste-fumaca.js: 287 verificações, agora cobrindo fatura × previsão,
conciliação e compras — áreas que não tinham teste nenhum.

---

# v85 — contratos com fornecedores (a pagar) no mesmo módulo

O módulo Contratos agora tem duas abas no topo:
- "Com clientes (a faturar)" — como era;
- "Com fornecedores (a pagar)" — aluguel, software, contabilidade,
  manutenção: contratos que a empresa paga e que também têm vigência,
  reajuste e renovação pra acompanhar.

No contrato de fornecedor o formulário troca o cliente pelo FORNECEDOR
e pede a NATUREZA da despesa (plano de contas), pra cair no lugar certo
da DRE. O resto é igual: vigência, renovação, índice e mês de reajuste,
dia de vencimento, prazo, multa, juros, garantia, contato e as linhas
de projeto com valor mensal (que aqui é rateio da despesa).

Detalhes de comportamento:
- a lista, o total ("Despesa mensal contratada") e a coluna da
  contraparte mudam conforme a aba;
- contrato antigo, sem o campo novo, continua valendo como de cliente;
- o mesmo número pode existir em fornecedores diferentes, mas não
  repetido no mesmo;
- o faturamento (contrato do projeto) ignora contrato de fornecedor;
- alertas de vigência e reajuste valem para os dois tipos.

teste-fumaca.js: 277 verificações.

---

# v84 — alerta de recebimento vencido há mais de 30 dias

Novo cartão na página inicial: "Recebimentos vencidos há mais de 30
dias", contado a partir da previsão de recebimento (vencimento do
título). Mostra a quantidade, o total em aberto e o mais antigo, com os
dias de atraso e o cliente. Só conta o que ainda tem saldo — recebido
sai do alerta. Leva direto à visão de atrasadas do contas a receber.

De passagem: os atalhos dos cartões do financeiro passaram a abrir a
ÁREA certa (a pagar / a receber) antes da aba. Sem isso, o cartão
abria o módulo na última tela em que a pessoa estava.

teste-fumaca.js: 267 verificações.

---

# v83 — paciente consultável na movimentação de estoque

O nome do paciente era gravado na baixa mas não aparecia em lugar
nenhum depois — rastreabilidade que não dá pra consultar não serve.
Na aba Movimentações:

- coluna **Paciente**: um nome aparece inteiro; vários mostram os dois
  primeiros, o "+N" e um botão que abre a lista completa, numerada, com
  material, quantidade, armazém e observação da baixa;
- a **observação** da baixa aparece junto do motivo;
- **busca no extrato** por paciente, material, motivo, observação,
  documento, requisição ou quem lançou — é assim que se responde "o que
  foi usado no paciente fulano?";
- o botão de exportar o extrato agora abre Excel, PDF ou CSV (antes só
  CSV), levando as colunas novas junto.

teste-fumaca.js: 262 verificações.

---

# v82 — leitura do estoque por armazém e baixa de um material por vez

## Posição de estoque com duas colunas claras
"Saldo" e "Na unidade" davam leitura errada quando o almoxarifado estava
zerado e o material tinha ido todo pro setor. Agora:
- "Neste armazém" — o saldo do armazém selecionado (com a marca "zerado
  aqui" quando está zerado mas existe em outro lugar da unidade);
- "Total no hospital" — almoxarifado + todos os setores, com a quebra do
  que está fora do armazém selecionado ("X em setores" ou "X em outros
  armazéns da unidade", conforme o que estiver aberto).

## Baixa com lista de pacientes: um material por vez
Um nome por unidade só faz sentido com um material na baixa. Antes a
tela deixava preencher vários e recusava no fim. Agora, ligando "Vários
pacientes", assim que um material recebe quantidade os demais são
travados (e voltam a liberar se a quantidade for zerada), com o aviso
explicando a regra.

teste-fumaca.js: 256 verificações.

---

# v81 — reajuste de contrato prorrogável e ordem da página inicial

## Reajuste nos próximos 30 dias voltou a aparecer
Na v80 a regra "não avisar sobre contrato que vai acabar" derrubava
qualquer contrato cuja vigência termina antes do mês do reajuste — o
que pega justamente o caso comum: contrato PRORROGÁVEL, em que o
reajuste é aplicado na prorrogação. Agora só fica de fora quem está
marcado como "não renova". Prorrogável e renovação automática
continuam no alerta.

## Página inicial
Os módulos voltaram para o topo, como eram, e o painel de pendências
ficou logo abaixo deles.

teste-fumaca.js: 256 verificações.

---

# v80 — alerta de reajuste vencido

O painel da página inicial mostrava o contrato com reajuste nos
próximos 30 dias, mas o reajuste JÁ VENCIDO e não aplicado podia não
aparecer. Duas causas:

- os dois casos dividiam o mesmo cartão, com o título "Contratos com
  reajuste nos próximos 30 dias" — que não é o caso do vencido;
- a regra "não avisar sobre contrato que vai acabar" era aplicada
  também ao vencido. Reajuste que era devido em julho continua valendo
  mesmo que o contrato termine em setembro: é diferença retroativa a
  cobrar.

Agora:
- "Reajuste vencido e não aplicado" é cartão próprio, em vermelho, e
  nunca é filtrado por fim de vigência;
- "Contratos com reajuste nos próximos 30 dias" segue excluindo quem
  termina antes da data do reajuste;
- os dois (e o de contratos vencendo) mostram até 3 contratos e "e mais
  N" quando houver, e levam ao módulo de contratos.

teste-fumaca.js: 255 verificações.

---

# v79 — alerta de NF por marcação explícita e anexo da nota

## O alerta mudou de critério
Antes o alerta pegava todo título pago sem ARQUIVO anexado, o que
incluía a maioria das notas (que têm só o número informado, e isso já
basta pra contabilidade). Agora:
- quem lança um pagamento sem nota marca "Sem NF (informar depois)" —
  só esses entram no alerta;
- título sem número só é aceito com essa marcação (antes o número era
  obrigatório sempre);
- informar o número, a chave ou anexar o arquivo tira do alerta na hora,
  mesmo depois de pago. Vale pra todas as parcelas do mesmo título.

## Informar e anexar a NF a qualquer momento
Ação "NF" na linha do título, disponível inclusive em título já pago (a
nota costuma chegar depois do pagamento). Permite número, chave, marcar
/ desmarcar "Sem NF", anexar e remover o arquivo.

## Ver a nota anexada
- PDF e imagem abrem direto numa aba.
- XML vira um PDF de visualização, com faixa no topo deixando claro que
  é leitura do XML e NÃO a DANFE/nota oficial. Traz número/série,
  emissão, chave formatada, natureza, emitente, destinatário, itens
  (descrição, quantidade com unidade, unitário e total), retenções e o
  valor do documento, mais o título do sistema ao qual está anexada.

## Atalho do painel de pendências
O cartão "Pagamentos sem nota fiscal" abre Contas a Pagar na sub-aba
PAGAS com o filtro aplicado — antes caía na lista de contas a vencer,
onde nenhum título do alerta aparece. Os demais cartões também levam à
tela exata (cobertura de faturamento, cobertura e pendentes de
produtividade, aprovações, compras a aprovar/cotar, folha).

teste-fumaca.js: 251 verificações.

---

# v78 — pedidos do Henrique (cadastro, produtividade, faturamento, compras, alertas e exportações)

## Cadastros
- Projeto tem campo de cliente, com "+ cadastrar cliente" que preserva
  o que já foi digitado. O vínculo vale dos dois lados.
- GHC - HGB virou 8 projetos, um por especialidade (Anestesia,
  Cardiologia, CTI Pediátrica, Emergência adulto, Emergência
  pediátrica, Medicina interna, Coronariana, Mutirão). O id antigo ficou
  na Anestesia — almoxarifado, cliente e previsão do HGB apontam pra ela.
- Fornecedores: filtro "só com pagamento pendente" com contador; TED sem
  banco/agência/conta agora também conta como pendência.
- Fornecedor ganhou e-mail, telefone e contato.

## Produtividade
- Aba de lançamentos com filtros (competência, projeto, data de
  importação, situação, busca) e total do que está filtrado.
- Situação em 3 níveis com cores leves: lançado (vermelho), pago em
  parte (amarelo), pago (verde).
- Detalhe do lote enxuto (médico, plantões, horas, valor, pago,
  situação); setor saiu dali e abre no botão "Plantões" de cada médico.
- Aba "Pendentes de pagamento", destacando quem ficou para trás em
  fechamento onde os colegas já receberam, com a coluna "Trava".

## Faturamento
- Valor confirmado pela produtividade: status próprio, diferente de uma
  previsão comum ("confirmado pela produtividade" / no a receber,
  "valor confirmado — falta a NF"), com quem confirmou e quando. A
  pergunta aparece ao lançar a produtividade e ajusta a previsão do
  projeto.
- Fatura de locação (sem NF): lista os itens de locação do projeto com a
  quantidade contratada, permite reduzir quantidade exigindo
  justificativa, emite o PDF e lança no a receber — ou anexa uma fatura
  já existente. Itens de locação cadastrados no projeto.
- Cobertura de faturamento, no molde da cobertura de produtividade:
  faturado / valor confirmado esperando NF / sem faturamento /
  encerrado, com contador na aba.

## Contas a pagar / a receber
- Alerta de NF virou "Pago sem NF": só o que já saiu do caixa sem
  documento. Conta futura sem NF não alerta mais.
- Filtro por fornecedor (com contagem) e busca que também acha por nome
  do fornecedor.
- Conciliação sem vínculo: dá pra vincular fornecedor já cadastrado
  (além de cadastrar na hora) e informar NF opcional (número e anexo).
- A receber: situação "Atrasadas" no filtro e atalho no cartão de
  Vencido, que mostra a data da mais antiga.

## Contratos
Dia de vencimento, prazo de pagamento, dia limite da NF, multa, juros de
mora, correção do atraso, regra de reajuste, regra de renovação, aviso
prévio de rescisão, garantia e contato de cobrança.

## Estoque
- Saída com observação e paciente. Rastreabilidade em lote por LISTA
  (um paciente por linha, colada do sistema assistencial), com
  conferência contra a quantidade — em vez de 20 campos.
- Estoque global da unidade: coluna "Na unidade", alerta de compra só
  quando falta na unidade inteira, e situação "transferir de outro
  setor" quando há saldo em outro setor.

## Compras — fluxo com duas aprovações
1. Requisição.
2. Aprovação da necessidade: valor estimado linha a linha, corte de
   quantidade e reprovação item a item.
3. Cotação: fornecedor e preço por item, anexo das cotações, FRETE POR
   ITEM.
4. Aprovação da compra: valores reais, variação vs custo médio, aprovar
   / reprovar / devolver pra revisão.
5. Envio do pedido: confirmação (sem redigitar), um pedido por
   fornecedor com o frete de cada um, e e-mail de confirmação montado
   pronto pro fornecedor (exige e-mail no cadastro).

## Pessoal
Holerite em PDF baixa o arquivo direto (gerador próprio, ERP.pdf), sem a
tela de impressão que tomava o lugar do sistema. Três por página A4, com
espaço e linha de corte entre funcionários.

## Página inicial
Painel de pendências filtrado por perfil: faturamento autorizado sem NF,
produtividade e faturamento atrasados (regra do dia 10), pagamentos sem
NF, aprovações pendentes por tipo, estoque mínimo, transferência entre
setores, folha complementar, contratos vencendo e com reajuste em 30
dias. Cada cartão leva ao módulo.

## Exportações
"Exportar" agora abre a escolha de formato — Excel (.xlsx com filtro e
valores numéricos), PDF ou CSV — em Contas a Pagar, Contas a Receber,
Relatórios e relatório da folha. Corrigido o BOM duplicado do CSV.

teste-fumaca.js: 245 verificações. Todas as telas percorridas com os 7
perfis, sem erro.

---

# v77 — relatório de QA da v76

## Mexem em dinheiro
- Folha complementar pagava encargos em dobro. A folha principal
  somava nas guias (FGTS, patronal, INSS+IRRF) e no total quem ficava de
  fora por falta de aprovação/credor; a complementar gerava tudo de
  novo. Agora quem fica de fora sai da folha inteira (salário, pensão e
  encargos) e entra só na complementar. Testado: principal + complementar
  somam exatamente o mesmo que uma folha única. O total da folha passa a
  bater com os títulos de salário gerados.
- Na mesma revisão: o título de pensão da folha usa o valor que o
  holerite descontou (sem a parte já paga nas férias do mês).
- Rescisão passa a gerar o INSS patronal + RAT×FAP + terceiros sobre
  saldo e 13º (aviso indenizado e férias indenizadas não entram), com
  vencimento no dia 20 do mês seguinte. Aparece no resultado da tela e é
  cancelado junto com a rescisão.
- Avos com fração de 15 dias: a fração do mês era medida sem contar o
  último dia (01 a 15 dava 14). Saída em 15/12 → 12 avos (antes 11);
  15/11 → 11 (antes 10). O 13º agora conta por mês civil (Lei 4.090):
  admitido 17/01 e desligado 15/12 → 12 avos. Férias seguem pelo período
  aquisitivo.

## Médios / baixos
- Guias de férias: IRRF pela competência do pagamento; INSS, FGTS e
  patronal pela competência do gozo. Férias de 01/10 pagas em 29/09:
  IRRF vence 20/10, os demais 20/11. INSS e IRRF viraram títulos
  separados.
- Pensão sobre o 13º na rescisão respeita "incide sobre o 13º":
  desconta proporcional aos avos e abate do IRRF do 13º. O 13º anual
  passou a usar a mesma proporção (ano inteiro = valor cheio).
- Férias e mês comercial: férias de 01 a 30 num mês de 31 dias pagam o
  dia 31 como salário; férias cobrindo fevereiro inteiro não pagam os 2
  dias "comerciais" que ninguém trabalhou.
- Guia de ISS com várias naturezas: a DRE e o fluxo da tela já
  repartiam; agora também a lista e o detalhe de Contas a Pagar, as
  exportações de contas e a planilha de fluxo (Excel).
- Planilha de fluxo (Excel) passa a incluir as retenções ainda sem guia
  e respeita o sigilo (descrição/credor de títulos de pessoal).

## Mantido por decisão da empresa
- Competência de IRRF e PIS/COFINS/CSLL retidos = a da NF (v76).

teste-fumaca.js: 245 verificações.

---

# v76 — critérios fiscais definidos pela empresa

## Competência das retenções = a da NF, para todos os tributos
ISS, IRRF, PIS, COFINS, CSLL e INSS retidos entram na competência da
NF (a do lançamento). As retenções da competência X formam a guia que
vence no mês X+1. Antes (v74–v75), os federais usavam o mês do
vencimento da parcela como estimativa do mês de pagamento — uma NF de
março com vencimento em abril caía em abril; agora cai em março.

## Pensão no desconto simplificado do IRRF
Mantida a leitura atual, agora confirmada: o desconto simplificado
(R$607,20) substitui o conjunto INSS + dependentes + pensão (Lei 9.250,
art. 4º, II a V); vale o maior dos dois. Nenhuma mudança de cálculo.

teste-fumaca.js: 226 verificações.

---

# v75 — pendências da v74: conciliação com vários títulos, feriados e rateio

## Uma linha do extrato quitando vários títulos
A DCTFWeb gera um DARF único (INSS retido, patronal, RAT, terceiros,
IRRF) que o banco mostra como uma saída só. No modal "Buscar título"
de uma saída:
- o sistema sugere combinações de 2 a 4 títulos em aberto, do mesmo
  favorecido e com vencimento perto da data, que somam exatamente o
  valor da linha ("Juntos, estes títulos fecham o valor");
- dá para marcar os títulos à mão; o total marcado aparece ao vivo e
  "Vincular marcados" só habilita quando bate com a linha.
É tudo ou nada: se um dos títulos não puder ser pago (ex.: pendente de
aprovação), nenhum é baixado.

## Feriados
Calendário de feriados nacionais, incluindo os móveis (Sexta-feira
Santa pela Páscoa) e o 20/11 (Lei 14.759/2023). Usado em:
- vencimento de guias e boletos: antecipa se cair em dia sem
  expediente bancário (fim de semana, feriado, segunda e terça de
  carnaval);
- 5º dia útil do salário: pula domingos e feriados (sábado conta).
Feriados municipais ficam em parametros.feriados_extras ('AAAA-MM-DD'
ou 'MM-DD').

## Rateio do funcionário
O campo único de centro de custo virou um editor de rateio (centro + %,
"+ dividir com outro centro", total ao vivo). O store valida: centro
existente, sem repetição, % > 0 e soma de 100%. O centro principal é o
da primeira linha.

## Testes
teste-fumaca.js: 226 verificações. Conciliação múltipla e editor de
rateio também testados no navegador.

---

# v74 — relatório de QA da v73

Todas as correções foram conferidas contra os números do relatório e
cobertas por teste automatizado (teste-fumaca.js: 216 verificações),
além de uma passada no navegador pelas telas alteradas.

## Graves

- IRRF com desconto simplificado: base = rendimento − max(INSS +
  dependentes + pensão, R$607,20). A v70–v73 abatia o INSS e o
  simplificado, descontando duas vezes. Conferido: R$5.500 → R$190,47;
  R$8.000 → R$1.037,85; R$5.124,20 sem dependentes → R$44,48 (com os 2
  dependentes do Roberto, deduções legais R$898,08 → IRRF zero).
  A pensão entra entre as deduções substituídas (Lei 9.250, art. 4º,
  II a V) — confirmar com o contador.
- 13º na rescisão conta avos a partir da admissão quando ela é no
  próprio ano (01/08 → 20/09 = 2 avos / R$500); aviso indenizado que
  atravessa o ano soma os avos dos dois anos.
- Férias canceladas não travam mais a rescisão.
- Saldo de salário começa na admissão (se no mesmo mês) e não inclui
  dias de férias do mês já pagos (Roberto: 5 dias, não 10).
- Rescisão desconta a 1ª parcela do 13º já paga no ano.
- 2ª parcela do 13º desconta só o que a pessoa recebeu de fato na 1ª
  (caso da Juliana, reativada depois da 1ª parcela).
- NFS-e nacional: o layout tem dois blocos <valores>; agora lê vServ
  do DPS, ISS retido por tpRetISSQN (2/3) + vISSQN e PIS/COFINS por
  tpRetPisCofins. ABRASF: IssRetido = 1 com ValorIss. As duas conferem
  contra o total do emissor (vTotalRet / ValorLiquidoNfse) e avisam se
  não fechar. XMLs de teste: nacional líquido R$8.885, ABRASF R$8.385.
- Efetivar previsto trocando credor ou aumentando valor volta para
  aprovação (e bloqueia o pagamento até aprovar).

## Médios

- Credor das guias: federais → Receita (agora com forma "guia"),
  FGTS → Caixa (credor novo), ISS → prefeitura do município de
  incidência, criada automaticamente se não existir. Fila de ISS
  separada por município.
- Guia de ISS continua um título só, mas cada natureza de origem volta
  pra sua linha na DRE e no resultado por projeto.
- PIS/COFINS/CSLL retidos numa guia só (DARF 5952); competência dos
  federais pelo mês do pagamento (vencimento), ISS pela prestação.
- Retenções ainda sem guia entram no fluxo de caixa como saída prevista.
- Vencimentos: INSS/IRRF de férias e rescisão no dia 20 do mês
  seguinte; salário no 5º dia útil (segunda a sábado; feriados não
  considerados).
- Máximo de 3 frações de férias por período.
- Pensão já descontada nas férias do mês não é descontada de novo na
  folha (o líquido não fica mais negativo).
- Folha complementar: com folha fechada, quem ficou de fora (aprovado
  depois, reativado, admitido com data retroativa) aparece na aba Folha
  e fecha numa complementar com guias próprias. Aprovar dados de
  pagamento, cancelar rescisão ou admitir retroativamente avisa quando
  a pessoa ficou fora de uma folha já fechada.
- Sigilo: guias individuais de férias/rescisão e o credor da pensão
  também ficam [confidencial]; observação escondida; título de pessoal
  não pode ser editado por quem não tem acesso a dados pessoais.
- PIX em formato de CPF é classificado como CPF; CPF da beneficiária e
  chave PIX com cara de CPF são validados ao salvar.

## Baixos

- VT da rescisão proporcional aos dias do saldo.
- Multa de 40% estimada inclui o FGTS da própria rescisão.
- Pensão configurável sobre 13º e férias (conforme a sentença).
- Aviso do art. 479 quando o desligamento é nos primeiros 90 dias e o
  tipo escolhido não é término de experiência.

## Não feito

- Edição do rateio multi-centro na tela do funcionário (o rateio é
  preservado ao salvar desde a v71, mas ainda não dá para editá-lo).
- Conciliação de uma linha do extrato com vários títulos. Com as guias
  consolidadas acima deixou de ser necessária para ISS e CSRF; a folha
  ainda gera títulos separados (FGTS, patronal, retidos).
- Feriados no cálculo do 5º dia útil.

---

# v73 — sigilo salarial em Contas a Pagar e o bug do INSS incremental de férias

As duas últimas pendências do relatório de QA, fechando a lista por
completo.

## Sigilo salarial em Contas a Pagar

Título de folha, férias, 13º, rescisão, pensão ou crédito do
trabalhador tem o nome do funcionário na descrição — e quem lança/paga
contas (perfil "Assistente financeiro", por exemplo) não tem
`ver_dados_pessoais`, mas precisa continuar vendo valor, data e
documento pra fazer o trabalho dela (conciliar com o banco, processar
pagamento). A decisão: mascarar só a IDENTIDADE, nunca o valor nem o
resto do título — é o "quem ganha quanto" que é sigiloso, não o fluxo
de caixa em si.

Dois helpers novos em `store.js` — `descricaoVisivel(p)` e
`nomeCredorVisivel(p, nome)` — decidem, por tipo de título e pela
permissão de quem está olhando, se mostram o texto real ou algo como
"Folha de pagamento — [confidencial]". Nos títulos onde o credor é o
próprio funcionário (folha, férias, 13º, rescisão), o nome na coluna
de credor também é mascarado; em pensão e crédito do trabalhador o
credor é um terceiro (beneficiário/instituição) e continua aparecendo
normal — só a descrição, que cita o funcionário, é que leva a máscara.

Aplicado em todos os pontos onde a Contas a Pagar mostra descrição ou
credor: lista principal, solicitar pagamento, efetivar previsão, ver
parcela, e as duas exportações CSV. Testado no navegador logado como a
assistente financeira — nenhum nome de funcionário aparece pra ela — e
como sócio, que continua vendo tudo normal.

## O bug do INSS incremental de férias — encontrado e corrigido

Reproduzido tentando o cenário mais óbvio pro relato original (férias
vencidas cobrindo o mês inteiro): uma funcionária de exemplo tirando 30
dias de férias em outubro batia EXATAMENTE no valor de INSS citado no
relatório (R$595,49) quando o correto seria bater no teto (R$988,09).

Causa raiz: o cálculo de "quanto INSS a competência já usou" olha o
salário do mês via `calcularHolerite`, que por sua vez exclui os dias
de férias já lançados — mas só os que JÁ ESTÃO no cadastro do
funcionário. A fração de férias sendo calculada NESTE EXATO momento
ainda não foi confirmada, então não está lá — e o sistema contava o
salário como se a pessoa tivesse trabalhado o mês inteiro, mesmo
pedindo férias pro mês inteiro ao mesmo tempo. Isso inflava a base "já
usada" e subtraía demais na conta do incremento, deixando o resultado
abaixo do teto de verdade.

Corrigido: `baseINSSJaUsadaNoMes` agora recebe os dados da fração
sendo calculada e a inclui temporariamente no cadastro só pelo tempo
da conta (removendo em seguida, mesmo se der erro no meio do
caminho) — assim `calcularHolerite` sabe descontar os dias certos.
Depois da correção, o mesmo cenário bate exatamente nos R$988,09
esperados.

## Testes

`teste-fumaca.js` chegou a 175 verificações, incluindo a reprodução
exata do bug do INSS e a confirmação de que a correção não deixa
rastro nenhum no cadastro do funcionário.

Isso fecha a lista original do relatório de QA por completo — nenhum
item numerado ficou pendente.

---

# v72 — INSS patronal e RAT×FAP/terceiros combinados numa guia só

## Guias de encargo reduzidas de 4 para 3 por fechamento

Folha e 13º geravam um título pro INSS patronal e OUTRO separado pro
RAT×FAP + terceiros (Sistema S) — mas na vida real os dois saem juntos
na mesma guia (GPS/DCTFWeb), então dois títulos pra uma coisa que é um
pagamento só não batia com a conciliação bancária, mesma classe de
problema já corrigido nas guias de retenção (v66/v68).

Corrigido: agora sai um título só, "INSS patronal + RAT×FAP +
terceiros", com os dois valores discriminados na observação. Férias já
fazia assim desde que os encargos foram implementados — só faltava
aplicar o mesmo em folha e 13º.

O que ficou como estava, de propósito: o INSS RETIDO do funcionário
continua na mesma conta do salário (4.01), separado do patronal — essa
separação existe pra reconstituir o salário bruto certo na DRE
(líquido + retido = bruto), e mexer nisso desfaria uma correção
anterior. Fundir os dois títulos teria juntado coisas de natureza
contábil diferente; fundir só patronal + RAT/terceiros (que já eram a
mesma natureza — encargo genuíno da empresa) não tem essa
contrapartida.

## Testes

Testei no navegador: fechar uma folha gera 3 guias (FGTS, INSS
patronal + RAT×FAP + terceiros, INSS + IRRF retidos), não mais 4.

---

# v71 — rateio preservado, total da folha correto, salário-família compensado na guia

Mais 3 itens do relatório de QA fechados.

## Rateio multi-centro apagado ao editar funcionário

Toda edição de funcionário — mesmo só pra mudar jornada ou
dependentes — reescrevia o rateio pra 100% num centro só, porque o
formulário só tem um campo de centro e sempre mandava isso como o
rateio inteiro. Corrigido: se o funcionário já tinha um rateio
multi-centro e o centro escolhido no formulário continua sendo um dos
que já estavam nele, o rateio existente é preservado sem mexer.
Trocar pra um centro que não estava no rateio anterior continua
funcionando como troca intencional (vira rateio único no novo
centro). Testado no navegador nos dois cenários.

## Total da confirmação da folha não batia com gente pendente de aprovação

O modal de "Fechar folha" mostrava a soma de todo mundo, mas
`fecharFolha` pula quem está com dados de pagamento pendentes de
aprovação — o valor lançado de verdade saía bem menor que o
anunciado, sem aviso nenhum antes de clicar. Corrigido: o modal agora
avisa explicitamente quem fica de fora e mostra o total ajustado (só
de quem realmente vai entrar no fechamento). Testado no navegador.

## Salário-família não era compensado na guia de INSS patronal

Salário-família é reembolso — a empresa adianta ao funcionário e
depois se ressarce por COMPENSAÇÃO direto na guia de INSS patronal,
não é uma despesa que ela simplesmente absorve. A base de cálculo do
INSS patronal já excluía o salário-família corretamente, mas a guia
em si nunca abatia o valor pago aos funcionários — cobrava a guia
cheia como se o salário-família fosse custo extra. Corrigido: a guia
de INSS patronal agora sai com o salário-família da competência
abatido, e a observação do título mostra a conta (valor cheio menos
o que foi compensado).

## Testes

`teste-fumaca.js` chegou a 163 verificações.

## Ainda pendente da lista completa do relatório

- Combinar INSS retido + patronal + RAT + terceiros num título só,
  mais perto de como a DCTFWeb realmente gera o DARF único
- INSS incremental de férias com cálculo errado num caso específico
  (ainda preciso do cenário exato reproduzido pra corrigir com
  segurança)
- Sigilo salarial: a assistente financeira vê o valor de cada
  holerite em Contas a Pagar — fica como decisão em aberto, é uma
  mudança de arquitetura (visibilidade por tipo de título dentro de
  uma lista hoje genérica), não uma correção pontual

---

# v70 — 14 dias mínimos, desconto simplificado do IRRF, insalubridade proporcional e pensão em férias/13º

Mais 5 itens da lista do relatório de QA fechados nesta rodada.

## Regra dos 14 dias mínimos numa fração de férias (CLT art. 134 §1º)

Só a regra dos 5 dias mínimos por fração estava implementada — faltava
a outra metade: pelo menos UMA das frações do período tem que ter 14
dias corridos. Não dá pra saber isso olhando uma fração isolada
(depende de todas as já lançadas no período), então o bloqueio
acontece só quando a fração atual tornaria IMPOSSÍVEL cumprir a regra
depois — é a última fração e nenhuma chegou a 14 dias, ou sobraria
menos que 14 dias pra uma fração futura resolver. Fora desses dois
casos, ainda dá tempo de uma fração posterior ter 14+.

## Desconto simplificado do IRRF (Lei 13.149/2015)

Estava na tabela (R$607,20) mas o cálculo nunca usava. Como o
desconto simplificado substitui só a dedução por dependente (nunca a
pensão alimentícia, que é obrigação judicial e vale sempre), e um
desconto maior sempre dá imposto igual ou menor, a correção é usar o
maior entre os dois — sem precisar rodar a conta duas vezes. Na
prática, isso reduz o IRRF de quem tem até 3 dependentes (568,77 é
menos que 607,20); com 4 ou mais, a dedução por dependente já supera
o simplificado e continua sendo usada.

## Insalubridade/periculosidade proporcionais e na base da hora extra

Duas correções juntas, porque uma dependia da outra:
- Ficavam sempre no valor cheio do mês, mesmo com admissão no meio do
  mês, faltas ou férias — agora são proporcionais aos dias
  efetivamente pagos, igual ao salário.
- Não entravam na base de cálculo da hora extra (Súmula 264 do TST:
  adicional habitual integra a remuneração pra esse fim) — a hora
  extra de quem tem direito a um dos dois adicionais agora vale mais,
  correspondendo à remuneração real da pessoa.

## Pensão alimentícia em férias e 13º

A pensão já deduzia do IRRF e descontava do líquido na folha e na
rescisão, mas não em férias nem no 13º — e nem chegava a existir
título nenhum pro beneficiário nesses dois casos. Corrigido nos dois:
- Férias: pensão reduz a base do IRRF, desconta do líquido de
  verdade, e gera título pro beneficiário (mesmo credor dedicado já
  usado na folha e rescisão).
- 13º: mesma coisa, só na 2ª parcela (a 1ª é sempre isenta de
  qualquer desconto).

Na rescisão, a mesma lacuna existia especificamente no IRRF do saldo
de salário (a pensão já descontava do líquido, mas não da base do
IRRF) — corrigido também.

## Testes

`teste-fumaca.js` chegou a 160 verificações.

## Ainda pendente da lista completa do relatório

- Rateio multi-centro sendo apagado ao editar um funcionário
- Sigilo salarial: a assistente financeira vê o valor de cada
  holerite em Contas a Pagar
- Salário-família não abatido da guia de INSS patronal
- Total mostrado na confirmação da folha não bater quando há gente
  pendente de aprovação de pagamento
- Combinar INSS retido + patronal + RAT + terceiros num título só
- INSS incremental de férias com cálculo errado num caso específico
  (ainda preciso do cenário exato reproduzido pra corrigir com
  segurança)

---

# v69 — cancelar férias e rescisão, aviso prévio e multa de FGTS corrigidos

Continuação da lista do relatório de QA: mais 4 itens fechados, os
dois últimos (cancelar férias/rescisão) com tela nova e testados no
navegador de ponta a ponta.

## Aviso prévio contava anos completos errado

`mesesDeCasa` vinha de dias÷30 arredondado, e isso empurrava tempo de
casa que ainda não tinha completado 1 ano pra dentro de "1 ano
completo" — o exemplo do relatório (admissão 10/10/2025, desligamento
21/09/2026, 346 dias corridos) dava 33 dias de aviso quando o certo,
com menos de 1 ano de casa, é 30. Corrigido reaproveitando a mesma
conta de "anos completos por calendário" já usada pro salário-família
(idadeEm). Testado com o cenário exato do relatório.

## Multa de 40% do FGTS zerada na experiência antecipada

Terminar um contrato de experiência ANTES do prazo combinado (sem
justa causa) é dispensa na prática — além da indenização de metade
dos dias restantes (art. 479 CLT, que já existia), a multa de 40% do
FGTS também é devida (Decreto 99.684, art. 14). O sistema sempre
zerava essa multa pra "término de experiência", mesmo quando era
antecipado. Corrigido: agora só fica zerada quando o término é DENTRO
do prazo combinado.

Vale a mesma ressalva do relatório: é uma interpretação um pouco menos
pacífica que o resto da rescisão — confirme com o contador.

## Cancelar férias — não existia

Um gozo de férias lançado com data ou dias errados não tinha volta:
só dava pra "corrigir" lançando outro por cima, sem nunca desfazer o
primeiro — os dias gozados ficavam contando duas vezes, e os títulos
errados (líquido + as guias de encargos que a v68 passou a gerar)
ficavam pra sempre nas contas a pagar.

Agora existe uma lista de "Férias já lançadas" na aba de Férias, com
botão de cancelar por gozo. Cancelar desfaz o líquido e todas as
guias daquele gozo, e devolve os dias ao período — dá pra lançar de
novo com os dados certos. Testado na tela, do lançamento ao
cancelamento.

## Cancelar rescisão — não existia

Mesma lacuna, mais grave: uma rescisão calculada errada deixava o
funcionário desligado pra sempre, sem jeito de corrigir nem de
readmitir de verdade — o CPF ficava "ocupado" por um desligamento que
devia ter sido desfeito.

Agora existe uma lista de "Rescisões já lançadas" na aba de Rescisão,
com botão de cancelar. Cancelar desfaz todos os títulos (líquido,
guias de INSS/IRRF/FGTS, pensão, crédito do trabalhador) e reativa o
funcionário — volta a aparecer como ativo, pronto pra uma rescisão
nova se for o caso. Testado na tela, do lançamento ao cancelamento e
de volta a um lançamento novo pro mesmo funcionário.

## Testes

`teste-fumaca.js` chegou a 139 verificações. Os dois cancelamentos
novos também foram confirmados na tela, num navegador de verdade —
lançar, ver no histórico, cancelar, e conferir que o estado (dias
devolvidos, funcionário reativado) bate.

## Ainda pendente da lista completa do relatório

- Regra dos 14 dias mínimos numa fração de férias (só a de 5 dias
  mínimos está implementada)
- Desconto simplificado do IRRF não aplicado
- Insalubridade/periculosidade não proporcionais a dias trabalhados e
  fora da base de hora extra
- Pensão alimentícia não deduzindo do IRRF na rescisão nem incidindo
  sobre o 13º
- Rateio multi-centro sendo apagado ao editar um funcionário
- Sigilo salarial: a assistente financeira vê o valor de cada
  holerite em Contas a Pagar
- Salário-família não abatido da guia de INSS patronal
- Total mostrado na confirmação da folha não bater quando há gente
  pendente de aprovação de pagamento
- Combinar INSS retido + patronal + RAT + terceiros num título só,
  mais perto de como a DCTFWeb realmente gera o DARF
- INSS incremental de férias com cálculo errado num caso específico
  (ainda preciso do cenário exato reproduzido pra corrigir com
  segurança)

---

# v68 — as 7 correções prioritárias do relatório de QA

Esta versão fecha, na ordem sugerida, os 7 itens que vocês apontaram
como prioridade no relatório de teste mais rigoroso que recebi até
agora. Cada um foi confirmado no código antes de corrigir, e testado
depois (a maioria também no navegador, não só por lógica isolada).

## 1 — Bruto/líquido no lançamento manual com retenção (crítico)

No lançamento manual de NF, "Valor total" era usado direto como valor
da parcela — sem descontar a retenção marcada ao lado. Uma NF de
R$10.000 com R$650 de retenção pagava R$10.000 ao fornecedor E
R$650 na guia: R$10.650 saindo do caixa por uma nota de R$10.000.

Corrigido: o campo agora é explicitamente "Valor bruto da NF" quando
a retenção está marcada, um resumo mostra as três linhas (bruto,
retenção, líquido) ao vivo, e o valor lançado é sempre o líquido.
Testado no navegador com o exemplo exato do relatório.

Na mesma frente, corrigi dois bugs de leitura de XML: NFS-e (nacional
e ABRASF) já trazem o valor líquido em campos como `vLiq` ou
`ValorLiquidoNfse`, e o sistema descontava a retenção DE NOVO desse
valor já líquido. Também ampliei a busca de tags de retenção para
cobrir nomes alternativos do padrão nacional (`vRetIRRF`, `vRetCP`,
`vRetISSQN`, `vRetCOFINS` com grafia correta) — mantendo o aviso de
testar com XML real de fornecedor antes de confiar de olhos fechados,
como vocês recomendaram.

## 2 — Trava de "já foi importado antes" ignorando títulos cancelados

Esta era a causa raiz de várias outras travas: cancelar uma folha (ou
13º, férias, rescisão, guia de retenção) e tentar fechar de novo
esbarrava em "já foi importado antes", porque o título cancelado
continuava contando pra checagem de duplicidade. "Cancelar e refazer"
é o jeito documentado de corrigir um fechamento errado — se trava,
não tem como corrigir nada. Testado refazendo folha e 13º depois de
cancelar.

## 3 — Folha do mês respeitando a data de desligamento

Rescisão no meio do mês seguida da folha comum do mesmo mês pagava o
mesmo período duas vezes: a rescisão paga o saldo até o dia do
desligamento, mas a folha comum não sabia parar aí e pagava os 30
dias inteiros de novo. Agora quem tem rescisão lançada com
desligamento dentro do mês sai da lista da folha daquele mês.
Reproduzi o cenário relatado e confirmei que não paga mais em dobro.

## 4 — Credor de pensão/crédito do trabalhador procurado pelo nome (o mais grave)

`credorPensionista`/`credorInstituicaoCredito` reaproveitavam um
credor existente pelo NOME. Duas pessoas com o mesmo nome — uma
médica de verdade cadastrada como fornecedora, e uma beneficiária de
pensão homônima, por exemplo — faziam o sistema sobrescrever o
PIX/banco da médica com os dados da pensão, arriscando desviar um
pagamento de fornecedor de verdade.

Corrigido: cada pensão/crédito agora tem um credor DEDICADO, guardado
por id dentro do próprio cadastro do funcionário, nunca mais
procurado por nome. Reproduzi o cenário exato (beneficiária homônima
de uma médica cadastrada) e confirmei que os dados da médica real não
são mais tocados.

De caminho, também corrigi: PIX de celular (11 dígitos) sendo
classificado como CPF; funcionário sem PIX (só conta bancária)
ganhando um credor-espelho sem banco/agência/conta nenhum; e o DP
travado ao editar um funcionário sem banco (`''` e `null` sendo
tratados como "mudou o pagamento" quando na prática são a mesma
coisa: nenhum banco cadastrado).

## 5 — Guias de encargos das férias (crítico)

Férias geravam só o título do líquido pago ao funcionário. O INSS e o
IRRF retidos dele nunca viravam guia nenhuma pro governo, e o
FGTS/INSS patronal/RAT×FAP da empresa sobre as férias não existiam em
lugar nenhum — eram encargo de verdade, mesma alíquota da folha
mensal, sem nenhum título representando ele.

Corrigido: cada lançamento de férias agora também gera a guia de
INSS+IRRF retido, a guia de FGTS (8% sobre a base de férias) e a guia
de INSS patronal + RAT×FAP + terceiros — mesmas contas e mesmo padrão
já usados no fechamento da folha e da rescisão.

## 6 — Cancelar NF cancela também a retenção

Cancelar uma NF que tinha gerado retenção não mexia na retenção: ela
continuava pendente pra sempre, ou — pior — se já tivesse entrado
numa guia fechada, a guia continuava valendo, recolhendo imposto de
uma nota cancelada.

Corrigido: cancelar a NF agora tira a retenção da fila de pendentes
automaticamente. Se ela já tinha entrado numa guia fechada, o
cancelamento avisa explicitamente pra revisar aquela guia à mão (não
tentei ajustar a guia sozinho, porque ela pode ter outras NFs dentro
e a decisão de como corrigir é de quem está vendo o caso de verdade).

## 7 — Guia de retenção por conta quebrava a conciliação

Reconsiderei uma decisão que eu mesmo tinha tomado numa versão
anterior: fechar uma guia separada por conta contábil de origem
"parecia" mais correto pro lado da despesa, mas não bate com a
realidade — a prefeitura ou a Receita emitem UM boleto por
competência, não um por conta contábil. Com a guia dividida, a
conciliação bancária não tinha como casar um pagamento único do
extrato com dois (ou mais) títulos.

Revertido: a guia volta a fechar como um título só, sempre. Quando as
NFs de origem vêm de contas diferentes, o título usa a conta que mais
pesa no total, e a composição por conta fica anotada na observação
pra ajuste manual na contabilidade, se isso importar de verdade pro
caso.

## Testes

`teste-fumaca.js` chegou a 120 verificações — a maior parte desta
rodada cobrindo exatamente os cenários relatados (rescisão + folha no
mesmo mês, cancelar e refazer, colisão de nome no credor, guias de
férias, cancelar NF com retenção já em guia).

## Ainda pendente da lista completa do relatório

- INSS incremental de férias com cálculo errado num caso específico
  (preciso do cenário exato reproduzido pra confirmar e corrigir)
- Rescisão em dezembro não descontando a 1ª parcela do 13º já paga
- Desconto simplificado do IRRF não aplicado (a tabela já tem o
  valor, o cálculo não usa)
- Insalubridade/periculosidade não proporcionais a dias trabalhados e
  fora da base de hora extra
- Pensão alimentícia não deduzindo do IRRF na rescisão nem incidindo
  sobre o 13º
- Não existe cancelar férias nem cancelar rescisão
- Regra dos 14 dias mínimos numa fração de férias (só a de 5 dias
  mínimos está implementada)
- Aviso prévio contando anos por dias÷30 arredondado, em vez de anos
  de calendário — pode dar um "ano completo" a mais indevido
- Multa de 40% do FGTS não considerada na rescisão antecipada de
  experiência (art. 14 do Decreto 99.684) — hoje sempre zerada
- Rateio multi-centro sendo apagado ao editar um funcionário
- Sigilo salarial: a assistente financeira vê o valor de cada
  holerite em Contas a Pagar, mesmo sem acesso a dados pessoais
- Salário-família não abatido da guia de INSS patronal (é reembolso
  via compensação, não desconto do funcionário)
- Total mostrado na confirmação da folha não bater quando há gente
  pendente de aprovação de pagamento (a prévia soma todo mundo, mas
  quem está pendente fica de fora do fechamento de verdade)
- Combinar INSS retido + patronal + RAT + terceiros num título só,
  mais perto de como a DCTFWeb realmente gera o DARF

---

# v67 — crédito do trabalhador com repasse de verdade

Fechando a última pendência conhecida do módulo de Pessoal: o crédito
do trabalhador (empréstimo com débito em folha) descontava do
funcionário certinho, mas o valor não ia pra lugar nenhum — não
existia dado bancário da instituição cadastrado, então não tinha como
gerar o repasse.

## O que mudou

- Cadastro do funcionário: a seção de crédito do trabalhador ganhou
  banco, agência, conta e PIX da instituição (mesmos campos que a
  pensão alimentícia já tinha). Mudar esses dados bancários passa a
  exigir aprovação de quem tem alçada — mesma cautela já aplicada ao
  PIX do próprio funcionário e ao da pensão, porque é pagamento de um
  terceiro sendo redirecionado.
- Folha e rescisão agora geram um título de repasse pra instituição
  sempre que descontam a parcela do crédito — mesma lógica que a
  pensão alimentícia já usa, incluindo a sincronização dos dados
  bancários no cadastro do credor a cada lançamento.

## Conciliação bancária com a guia de retenção (v66)

Investiguei o mecanismo de conciliação antes de mexer em mais coisa:
ele já é genérico — casa qualquer parcela por valor e nome do
favorecido, sem depender de qual módulo criou o título. A guia de
retenção fechada na v66 é uma parcela comum, então já deve conciliar
sozinha quando o extrato trouxer o pagamento; não precisei escrever
nada específico pra isso.

## Testes

7 verificações novas confirmando o repasse do crédito do trabalhador
na folha e na rescisão, com os dados bancários sincronizados no
credor. `teste-fumaca.js` chegou a 88 verificações.

## O que ainda falta

Nenhuma tela nova (desde a v64) foi testada visualmente num navegador
de verdade — só a lógica por trás, via `teste-fumaca.js` e checagem de
sintaxe. Um teste real de ponta a ponta é o próximo passo mais valioso
antes de considerar esse conjunto de mudanças pronto pra uso.

---

# v66 — retenção de impostos em NF de fornecedor, com guia consolidada

Pedido novo do financeiro: NF de serviço com retenção de ISS, IRRF,
PIS, COFINS, CSLL ou INSS gera dois lançamentos — o líquido pro
fornecedor e a retenção, que se acumula numa guia mensal por tributo.

## O que já existia (achei ao investigar antes de mexer)

O lançamento de NF (`ui-lancamento.js` + `index.html`) já tinha os
campos de retenção prontos: checkbox "tem retenção", um campo por
tributo (ISS/IRRF/PIS/COFINS/CSLL/INSS), e a leitura do XML já
preenchia esses valores sozinha quando a nota trazia retenção
declarada — exatamente como você descreveu. Faltava só o que vinha
depois: os dois lançamentos separados e o agrupamento em guia.

## O que foi construído

**Cada retenção vira um registro rastreável.** Ao lançar uma NF com
retenção, `criarTitulo` agora também guarda, pra cada tributo retido,
um registro à parte com o valor, a NF de origem, o fornecedor, a
competência, a conta contábil e o rateio por centro daquela NF
específica.

**Decisão de contabilidade importante**: a guia cai na MESMA conta
contábil da NF de origem, não numa conta de "imposto" separada — o
valor retido não é uma despesa nova, é a mesma despesa da NF, só que
uma parte vai pro fornecedor e a outra pro governo em nome dele
(exatamente a mesma lógica já usada pro INSS retido de funcionário na
folha, que vai pra conta do salário, não pra uma conta de imposto à
parte). Sem isso, ou a guia distorceria a DRE inflando "impostos", ou
a despesa real da NF ficaria subestimada.

**Fechamento de guia por tributo e competência.** Nova aba "Retenções
de impostos" dentro de Contas a Pagar: mostra quanto está pendente de
cada tributo em cada mês, com botão "Ver NFs" (rastreabilidade — quais
notas, de qual fornecedor, quanto cada uma) e "Fechar guia". Fechar
gera um título único (previsão em Contas a Pagar, pronta pra
conciliar quando o extrato trouxer o pagamento de verdade) — ou mais
de um, se as NFs pendentes vierem de contas contábeis diferentes: a
guia fecha uma por conta, pra não misturar despesas diferentes só pra
caber num pagamento só. Ainda assim é bem menos lançamentos que um
por NF.

**Cancelamento devolve as retenções pra fila.** Cancelar uma guia
(por engano, ou pra refazer com dado diferente) solta de volta as
retenções que estavam nela — elas voltam a aparecer como pendentes e
podem entrar numa guia nova.

## Testes

18 verificações novas cobrindo: registro da retenção ao lançar a NF,
acumulação por tributo e competência, fechamento de guia com o valor
e a conta certos, separação em guias distintas quando há mais de uma
conta de origem, e o cancelamento devolvendo tudo pra pendente.
`teste-fumaca.js` chegou a 82 verificações no total.

## O que ainda falta

- Nenhuma tela nova (desta rodada ou da anterior) foi testada
  visualmente num navegador de verdade — só a lógica por trás.
- Crédito do trabalhador (módulo de Pessoal) continua sem gerar
  título de repasse pra instituição financeira.
- A guia é criada como previsão comum em Contas a Pagar — não
  confirmei na prática que a conciliação bancária casa automaticamente
  com ela quando o extrato chegar, só que o mecanismo é o mesmo já
  usado por folha, 13º e demais previsões.

---

# v65 — prévia da folha completa, rescisão bem mais cheia, e PDF dos holerites

## Prévia da folha (antes de fechar)

Reescrita pra mostrar sempre, mesmo zerados: insalubridade/
periculosidade, salário-família, pensão alimentícia, crédito do
trabalhador. VT e VR viraram campos editáveis direto na tabela
principal — pré-preenchidos com o que sairia do cadastro (percentual,
valor fixo ou nada, conforme configurado), editar ali vale só pra
aquele mês, sem mudar o cadastro. O "+" (Mais ajustes) ficou só com o
que faz sentido ficar escondido: horas noturnas, gratificação e os
overrides de pensão/crédito do trabalhador que exigem confirmação
explícita antes de aplicar.

## Rescisão — bem mais completa agora

Você tinha razão que pouca coisa tinha mudado. Adicionei o que faltava,
com a mesma lógica já usada na folha mensal:
- **Gratificação** — campo novo, entra na base tributável do saldo.
- **VT e VR do mês** — desconto calculado igual à folha (usa o
  cadastro por padrão; dois campos deixam sobrescrever só nesta
  rescisão).
- **Pensão alimentícia** — desconta do líquido e agora também gera
  título pro beneficiário, com os dados bancários do cadastro (mesma
  correção que a folha já tinha).
- **Salário-família** — pago se a pessoa se enquadrar no teto e tiver
  dependente elegível, mesma regra da folha.

Tudo com verificação automatizada de que os valores realmente mudam o
cálculo e que o título de pensão sai certo.

## PDF do relatório da folha

Botão "Exportar PDF (holerites)" ao lado do CSV. Como este é um app
estático sem servidor, o caminho mais confiável pra chegar num PDF de
verdade é pela função de impressão do próprio navegador — o botão
monta as páginas certinhas (retrato, A4) e abre o diálogo de
impressão, onde "Salvar como PDF" é um dos destinos.

Formato: 3 quadros por página, um por funcionário, com corte horizontal
tracejado entre eles (pra separar fisicamente se imprimir em papel de
verdade) — cada quadro com cabeçalho (empresa, nome, matrícula, cargo,
competência), proventos e descontos detalhados em duas colunas, e o
líquido em destaque embaixo.

## Conferido

Tinha ficado uma dúvida da rodada passada: se a gratificação entra
certo na base do INSS patronal e do FGTS (os encargos da empresa, não
o desconto do funcionário). Testei e confirmei que sim — já estava
correto desde que a gratificação foi adicionada, só não tinha sido
verificado explicitamente ainda.

## Testes

`teste-fumaca.js` chegou a 66 verificações.

## Ainda pendente

Crédito do trabalhador continua sem gerar título de repasse pra
instituição financeira (seria preciso cadastrar os dados bancários
dela, que hoje não existem no sistema) — o desconto sai certo do
funcionário, o repasse ainda é manual. Nenhuma das telas novas foi
testada visualmente num navegador de verdade ainda.

---

# v64 — dependentes, pensão, VR/VT configurável, crédito do trabalhador, salário-família e relatório da folha

Leva completa de pedidos novos no módulo de Pessoal: cadastro,
fechamento de folha, relatório e rescisão.

## Cadastro

- **Dependentes cadastrados** (nome, CPF opcional, data de nascimento)
  — campo novo, separado da contagem "Dependentes (IRRF)" que já
  existia (as duas coisas podem divergir de propósito: nem todo
  dependente de IRRF tem data de nascimento à mão, e nem todo filho
  cadastrado aqui necessariamente entra na dedução de IRRF). Usado
  especificamente pro salário-família.
- **Pensão alimentícia cadastrada no funcionário** — valor e dados
  completos do beneficiário, inclusive bancários. Trocar os dados
  bancários do beneficiário pede aprovação de quem tem alçada, mesma
  cautela já aplicada ao PIX/banco do próprio funcionário (é dinheiro
  de um terceiro sendo redirecionado).
- **VT e VR com desconto configurável** — três modos: percentual (VT
  usa o teto de 6% por padrão, mas aceita um percentual próprio),
  valor fixo em R$, ou nenhum desconto. VR não tinha desconto nenhum
  modelado antes; agora aceita os três modos também.
- **Crédito do trabalhador** (Lei 14.438/2022) ou qualquer empréstimo
  com débito em folha — parcela mensal fixa cadastrada uma vez, desconta
  sozinha toda folha.

De caminho, achei e corrigi um botão "+ cadastrar cargo" na tela de
admitir/editar funcionário que existia desde antes dessas mudanças mas
nunca tinha ação nenhuma amarrada — agora funciona.

## Fechamento de folha

- **Gratificação** — campo de provento próprio, tributável, no "Mais
  ajustes" de cada funcionário.
- **Salário-família** — calculado automaticamente: teto de R$1.980,38
  na remuneração do mês (considerando gratificação e insalubridade,
  como você pediu), R$67,54 por dependente de até 14 anos, isento de
  INSS e IRRF. A idade é calculada na competência sendo fechada, não
  hoje.
- **Pensão aparece sozinha** — vem do cadastro por padrão; o "Mais
  ajustes" só pede confirmação se você quiser um valor diferente
  naquele mês específico (uma decisão judicial nova, por exemplo).
- **Desconto de VR e VT editável por mês** — mesma lógica: usa o que
  está cadastrado, com opção de valor diferente só naquela folha.
- **Insalubridade** já aparecia como linha própria no holerite
  detalhado (não estava escondida) — agora também tem coluna própria
  no relatório novo (abaixo).
- **Crédito do trabalhador** desconta sozinho todo mês, com opção de
  valor diferente (última parcela com saldo residual, por exemplo).

O título de pensão gerado ao fechar a folha agora usa os dados
bancários do CADASTRO do beneficiário (nome, CPF, banco, agência,
conta, PIX) — sincronizados a cada folha — em vez de só um nome digitado
na hora.

## Relatório da folha (aba nova)

Tabela detalhada por funcionário, da folha já fechada da competência:
salário bruto, desconto de INSS, desconto de IRRF, gratificações,
horas extras, adicional noturno, DSR sobre variáveis, desconto por
faltas, desconto de VR, desconto de VT, salário-família e líquido —
com totais no rodapé e exportação em CSV.

Sobre o DSR: já era calculado desde antes (toda vez que há horas
extras ou adicional noturno), só não tinha onde aparecer de forma
agregada — o relatório novo resolve isso.

## Rescisão

- **Insalubridade/periculosidade explícitas** no resultado — antes
  entravam silenciosamente dentro do salário-base do cálculo; agora
  aparecem como linha própria.
- **DSR** — a rescisão ganhou campos opcionais de horas extras e
  adicional noturno pendentes de pagar no saldo do mês, com o DSR
  sobre elas calculado do mesmo jeito que a folha mensal.
- **Crédito do trabalhador** continua descontando na rescisão — é
  dívida do funcionário, não desaparece por ele estar saindo. Editável
  na tela pro saldo residual do contrato.
- **INSS do saldo separado do INSS do 13º** — conferi e essa separação
  já existia desde a v58 (não era um bug); só não estava visível na
  tela. Agora o resultado mostra os dois valores lado a lado, além do
  total combinado.

## Testes

`teste-fumaca.js` chegou a 54 verificações — 20 novas cobrindo cada um
dos recursos desta rodada: dependentes, pensão (cadastro, override,
título com dados bancários sincronizados), VT/VR nos três modos,
crédito do trabalhador (folha e rescisão), salário-família com idade
calculada certa, gratificação, e DSR/insalubridade na rescisão.

## Limitações conhecidas

- Salário-família não modela "dependente inválido de qualquer idade"
  (não há campo pra isso no cadastro) — só considera idade até 14 anos.
- Crédito do trabalhador reduz o líquido pago ao funcionário
  corretamente, mas não gera título de pagamento pra instituição
  financeira (não há cadastro de dados bancários da instituição) — o
  desconto fica registrado, o repasse ainda seria manual.

---

# v63 — RAT×FAP, terceiros e o título manual de 13º duplicado

Esta fecha a lista completa que veio do teste do módulo de Pessoal.

**Encargos incompletos (RAT×FAP e terceiros).** O INSS patronal
sempre foi só os 20%. Adicionei os outros dois componentes que faltavam
— RAT×FAP (piso de 1%, mas varia de 0,5% a 6% conforme o grau de risco
da atividade e o FAP da empresa) e terceiros/Sistema S (5,8% de
referência, também variável por CNAE) — como parâmetros próprios em
Tabelas, editáveis, com uma nota clara de que os dois precisam ser
confirmados com o contador antes de valer pra alguma coisa oficial.

Interessante o que achei ao procurar onde lançar isso: a conta 4.08
"Outros encargos" já existia no plano de contas desde o início do
projeto — antes até do módulo de Pessoal — mas nunca tinha sido usada
em lugar nenhum. Era o lugar certo esperando essa peça. Agora folha e
13º geram guia própria pra RAT×FAP+terceiros nessa conta, rateada por
centro do mesmo jeito que FGTS e INSS patronal, e a aba Custos ganhou
uma coluna própria pra esse valor.

**Título manual de 13º duplicado nos dados de exemplo.** Removi o
lançamento manual "13º salário — 1ª parcela (provisão)" de R$19.360
que vinha nos dados de exemplo. Ele representava uma estimativa feita
à mão antes do módulo de 13º existir de verdade — agora que `fechar13`
calcula isso corretamente, por funcionário, com os avos e a base
certos, esse placeholder só duplicava o valor no fluxo de caixa
quando a parcela real fosse fechada. A forma certa de ter essa
previsão nos dados de exemplo é fechar a 1ª parcela de 2026 pela
própria tela, não por um lançamento manual solto.

## Testes

`teste-fumaca.js` chegou a 34 verificações — as duas novas cobrem a
guia de RAT×FAP+terceiros aparecendo tanto na folha quanto no 13º, com
a conta certa (4.08).

Com isso fica coberta a lista inteira que veio do relatório de teste
do módulo de Pessoal, do início ao fim desta série de versões (v55 a
v63).

---

# v62 — regra de 15 dias, armadilha do Desligar, e mais itens menores

**Regra de 15 dias nos avos** — trocado o cálculo por blocos de 30
dias por contagem de mês-calendário de verdade. Testado com o caso
exato do relatório (período começando 01/06/2025, saída 14/01/2026):
dá 7/12 agora, não mais 8/12. Corrige férias, 13º e rescisão juntos,
já que os três usam a mesma função.

**Brecha de aprovação na admissão de funcionário novo** — fechada.
Quem não tem alçada (perfil DP, por exemplo) ainda admite, mas o
funcionário nasce com o pagamento bloqueado (`pagamento_aprovado:
false`) até alguém com alçada de aprovação confirmar os dados de
PIX/banco — folha, 13º e rescisão recusam pagar essa pessoa até lá.
Recriei o "Fantasma" do relatório num teste automatizado pra confirmar
que o bloqueio segura.

**`tipo_titulo` virando "fatura" ao efetivar** — a causa real era o
modal de efetivar sempre mandar um tipo genérico (boleto/fatura/NF/
guia). Agora, se o tipo atual não é um desses quatro, ele entra como
primeira opção do dropdown ("Folha de pagamento (manter)", por
exemplo) e continua assim a menos que alguém troque de propósito.

**Armadilha do botão "Desligar"** — corrigida. Quem foi desligado por
ali (sem calcular verbas) continua aparecendo na aba Rescisão — antes
sumia e não tinha jeito de lançar o que devia. A data do desligamento
já vem preenchida ao escolher essa pessoa. Testei o fluxo completo:
desligar direto, aparecer na lista, calcular e lançar a rescisão, e
sumir da lista depois de lançada.

**Folha de mês passado perdendo funcionário desligado** — corrigida.
`funcionariosDaFolha` agora verifica se a pessoa estava ativa NAQUELE
mês (admitida até o fim dele e ainda não desligada, ou desligada só
depois), não se está ativa hoje.

## Itens menores corrigidos

- "art. 7º XI" → "art. 7º VI" na mensagem de irredutibilidade salarial.
- Férias com menos de 5 dias corridos agora são bloqueadas (CLT art.
  134 §1º).
- Data de início de férias não vem mais com hoje por padrão (o que
  jogava o vencimento do pagamento — 2 dias antes do início — pro
  passado); agora vem com hoje + 30 dias.
- Salário mínimo agora é proporcional à jornada — 20h/semana com pouco
  mais de R$700 passa a ser aceito, em vez de exigir o mínimo integral
  de quem trabalha meio período.
- `tipo_chave` do fornecedor (CPF/Email) agora sincroniza ao trocar
  PIX por conta bancária — antes ficava com o valor antigo mesmo
  depois de tirar o PIX.

## Sobre o teste de fumaça

`teste-fumaca.js` já tem 31 verificações rodando a cada entrega,
cobrindo bug crítico, multa de FGTS, INSS de férias, 13º, aprovação,
Desligar/Rescisão, folha de mês passado, salário mínimo proporcional e
sincronização de fornecedor — cada correção desta rodada ganhou um
teste específico, não só a checagem de sintaxe.

## O que ainda falta

Encargos incompletos (RAT×FAP e terceiros, ~5,8% além dos 20% de INSS
patronal), e o título manual de 13º duplicado nos dados de exemplo
(R$19.360 que não é baixado quando a parcela real é gerada, fazendo o
13º aparecer duas vezes no fluxo de caixa).

---

# v61 — bug crítico corrigido, mais um teste que teria pego ele antes

**O bug que travava "Fechar folha" (`dp is not defined`).** Confirmado
exatamente como você descreveu: faltava `const dp = D.parametrosDP;`
no início de `fecharFolha` — a variável só existia dentro de
`calcularHolerite`, mas a guia de INSS patronal (nova na v59) tentava
usar `dp.aliquota_inss_patronal` também em `fecharFolha`, que não tinha
essa variável no próprio escopo. Corrigido.

**Rede de segurança contra título órfão.** `fecharFolha` agora roda
dentro de um try/catch: se travar no meio (esse bug ou um futuro
qualquer), todo título que já tinha sido criado até ali é desfeito
automaticamente, em vez de ficar sem nenhuma folha pra referenciar.

**Um teste de fumaça de verdade.** O `node --check` que eu vinha
rodando só confere sintaxe — não pega uma variável não declarada
dentro de uma função, porque isso só estoura em tempo de execução. Foi
exatamente esse ponto cego que deixou o bug acima passar. Criei
`teste-fumaca.js` na raiz do projeto: carrega os três arquivos de
lógica (util, dados, store) de verdade num sandbox Node e EXECUTA
fecharFolha, fechar13, calcularFerias, calcularRescisao e afins contra
os funcionários de exemplo, checando que nada estoura exceção e que
alguns valores batem com o esperado (base do 13º com insalubridade,
conta certa na guia, vencimento antecipado). Rodo isso a cada entrega
daqui pra frente, antes de empacotar.

## Item 2 — multa do FGTS duplicada na rescisão

A multa de 40% saía duas vezes: uma dentro do líquido pago à
funcionária, outra na guia FGTS-RESC. Tirei a multa do bruto pago a
ela (ela nunca deveria ver esse dinheiro diretamente — é depósito na
conta vinculada) e completei a guia com o que faltava: o depósito de
8% sobre saldo de salário, 13º proporcional e aviso indenizado
(Súmula 305 TST), que antes nem existia. A tela de Rescisão agora
separa claramente "o que vai pro funcionário" de "o que vai pro FGTS
dele".

## Item 3 — INSS das férias calculado separado do salário

Corrigido com um cálculo incremental por competência: antes de
calcular o INSS de uma férias, o sistema soma quanto essa competência
JÁ vai gerar de base de INSS (o salário do mês, real se a folha já
fechou ou estimado se não, mais qualquer outra fração de férias já
lançada no mesmo mês) e cobra só o INCREMENTO sobre isso — não o
cálculo do zero. Isso faz o total do mês respeitar a faixa progressiva
e o teto (R$988,09) certos, em vez de cada pagamento reiniciar a
tabela.

## Mais achados corrigidos nesta rodada

- **Base do 13º sem insalubridade/periculosidade** — corrigido, e
  também estendido pra férias e rescisão (mesma causa).
- **Guia do 13º com conta errada e vencimento errado** — o INSS+IRRF
  retido do 13º ia pra 4.04 (que é do INSS PATRONAL, não do retido do
  funcionário — mesma confusão já corrigida na folha mensal) e o
  vencimento somava +20 dias em cima do dia 20 (virava janeiro).
  Corrigido: vai pra 4.06 (mesma conta do 13º) e vence no mesmo dia da
  2ª parcela.
- **FGTS e INSS patronal sobre o 13º não existiam** — agora são
  gerados junto da 2ª parcela, com rateio por centro.
- **Vencimento em fim de semana** — nova função `antecipaSeFimDeSemana`
  aplicada nas guias do 13º e também nas da folha mensal (FGTS,
  INSS/IRRF retido, e o próprio pagamento do líquido) — 20/12/2026 cai
  num domingo, então antecipa pra 18/12.
- **Documento duplicado em duas frações de férias no mesmo mês** —
  corrigido (usava só o mês, agora usa a data completa de início).
- **Detalhe do 13º fechado** — agora tem "Ver detalhe" com vencimento,
  quebra por funcionário, FGTS e INSS patronal.

## O que ainda falta

Regra de 15 dias nos avos de férias/13º (frações de 12-14 dias contam
errado como mês cheio), aprovação pulada em folha/férias/13º/rescisão
e `efetivarPrevisto` não devolvendo a aprovação pra pendente, botão
"Desligar" como armadilha, folha de mês passado perdendo funcionário
já desligado, encargos incompletos (RAT×FAP e terceiros, ~5,8%), e os
itens menores (salário mínimo proporcional à jornada, "art. 7º XI" →
"VI", férias abaixo de 5 dias, data de início de férias vindo com
hoje, tipo_chave do fornecedor não sincronizado, INSS/VT zerados com
31 faltas, alinhamento de tela, e o título manual de 13º duplicado nos
dados de exemplo).

---

# v60 — provisão na DRE e multa de rescisão antecipada de experiência

**Provisão de férias e 13º, como referência na DRE.** Adicionei duas
linhas informativas dentro de "Despesas com pessoal" — 1/12 avos por
mês de cada funcionário ativo, pra mostrar o custo espalhado ao longo
do ano. Essas linhas NÃO somam no total do grupo nem no resultado —
são só pra enxergar a distorção de um mês com férias ou 13º pago de
verdade aparecendo bem maior que os outros. Optei por não misturar
com o valor real (que continua vindo das linhas 4.05/4.06 de sempre):
juntar as duas coisas contaria o mesmo custo em dobro — uma vez
espalhada, outra vez no mês do pagamento de fato.

**Multa do art. 479 CLT — rescisão antecipada de contrato de
experiência.** A aba Rescisão, ao escolher "Término de contrato de
experiência", agora pede a data prevista de término (opcional). Sem
essa data, ou desligando depois dela, continua sendo o fim natural do
prazo — sem multa nenhuma. Com a data informada e desligando ANTES
dela, calcula a indenização de metade dos dias que faltavam até o fim
combinado, em cima do que já era devido (saldo, férias, 13º).

Isso fecha a lista completa que veio do teste no módulo de Pessoal.

---

# v59 — DRE de pessoal, rateio de encargos, pensão e rescisão indireta

**A causa real da distorção na DRE não era bruto vs. líquido — era o
INSS retido do funcionário caindo na mesma conta do INSS patronal.**
Investiguei antes de mexer: a conta 4.04 já era usada, desde antes do
módulo de Pessoal existir, especificamente pra INSS PATRONAL (tem um
lançamento de exemplo confirmando isso). A guia que a folha gerava
jogava o INSS RETIDO do funcionário — mais o IRRF, que nem é encargo
de folha — nessa mesma conta. Resultado: contava a mesma coisa duas
vezes (o retido já está dentro do bruto que devia aparecer em "Folha
de pagamento") e ainda por cima o INSS patronal de verdade nunca
tinha título nenhum — não aparecia em lugar algum, nem no fluxo de
caixa nem na DRE.

Corrigido assim: o líquido do funcionário continua na conta 4.01 (é o
que sai de fato pro bolso dele). O que é retido dele (INSS + IRRF)
agora também vai pra 4.01 — é a mesma folha, só que a parte que vai
pro governo em vez do funcionário; somado, 4.01 fecha no bruto certo.
INSS patronal virou título de verdade, na conta 4.04 (onde sempre
devia estar), com o valor calculado (20% de referência, cadastrado em
Tabelas) que antes só existia como número na tela de Custos, sem
nenhum lançamento por trás.

**Rateio por centro nas guias.** FGTS, INSS patronal e o retido dos
funcionários agora ratejam pelos centros de cada um, na mesma
proporção do título do salário — o funcionário alocado num projeto
específico (o caso da Iron Trainers) finalmente carrega os encargos
dele pro centro certo, não só o líquido.

**Pensão alimentícia agora vira título pro beneficiário.** A tela de
Folha ganhou um botão "+" por funcionário (horas noturnas e pensão
alimentícia — os dois já apareciam documentados em Tabelas, mas não
existiam na tela). Informando o valor e o nome do beneficiário, sai um
título à parte pra ele receber — antes o valor só desaparecia da conta
do funcionário sem virar pagamento pra ninguém.

**Mais um tipo de rescisão:**
- **Rescisão indireta (art. 483)** — mesmos direitos de uma dispensa
  sem justa causa (aviso, multa de 40%, férias e 13º integrais); muda
  só a justificativa jurídica, não a conta.

## Ainda falta

Provisão mensal de férias/13º como lançamento contábil de verdade na
DRE (hoje só aparece calculada na aba Custos, sem virar um lançamento
que a DRE também leia) e a multa do art. 479 CLT pra rescisão
antecipada de contrato de experiência.

---

# v58 — 13º salário e mais dois tipos de rescisão

**13º salário** — aba nova em Pessoal. 1ª parcela (até 30/11) é metade
do total do ano, sem desconto nenhum; 2ª parcela (até 20/12) tem INSS
e IRRF calculados sobre o TOTAL do ano — não sobre a 2ª parcela
isolada, que é só o total menos o que já saiu na 1ª. Avos contam pelo
ano civil (diferente de férias, que conta pelo período aquisitivo).
Gera título por funcionário (previsão, como a folha) mais a guia de
INSS/IRRF na 2ª parcela. Mesma mecânica de fechar/cancelar da folha:
não deixa fechar duas vezes a mesma parcela, exige a 1ª fechada antes
da 2ª, e cancelar a 1ª exige cancelar a 2ª primeiro (se existir).

**Dois tipos de rescisão a mais:**
- **Acordo entre as partes (art. 484-A)** — aviso prévio e multa de
  FGTS pela metade do que seria numa dispensa sem justa causa. Férias
  e 13º proporcionais continuam integrais.
- **Término de contrato de experiência** — cobre o fim natural do
  prazo: sem aviso prévio, sem multa de FGTS, com férias e 13º
  proporcionais normais. Não cobre rescisão ANTECIPADA de contrato de
  experiência (isso tem multa própria, art. 479 CLT, que ainda não
  está calculada).

## Ainda falta

Provisão mensal de férias/13º entrando na DRE, lançamento da folha
pelo bruto em vez do líquido, rateio de FGTS/guia por centro, título
de pensão alimentícia pro beneficiário, e rescisão indireta.

---

# v57 — itens de interface e arredondamento

**"Férias1" grudado** — o badge numérico ao lado do nome da aba só
tinha estilo dentro da barra principal (nav.abas); nas sub-abas de um
módulo (o caso de Pessoal) ficava sem espaço nenhum do texto. Regra
generalizada pra valer nos dois lugares.

**"44,00" e "0,00" em jornada e dependentes** — esses dois campos são
contagem, não dinheiro; pararam de passar pelo formatador de 2 casas
decimais que é certo pra valor em R$, errado pra "44 horas" ou "0
dependentes".

**Botão "Fechar" duplicado** — o modal já tem um botão de fechar por
padrão; quatro telas de Pessoal (ver funcionário, holerite, detalhe de
folha, calcular férias) declaravam um segundo "Fechar" por cima,
sobrando dois botões iguais. Removidos os quatro redundantes.

**"Fechar" ao lado de "Fechar folha"** — like o padrão global de todo
modal (buscar fora do modal) ficou "Fechar" nos casos sem cancelamento,
mas nas cinco telas de Pessoal que têm uma ação de verdade ao lado
(admitir/editar funcionário, desligar, reajustar, fechar folha,
cancelar folha) o botão de sair virou "Cancelar" — ou "Voltar" no caso
de "Cancelar folha", pra não repetir a mesma palavra da ação ao lado.
Isso não mudou nenhum outro modal do sistema — o padrão "Fechar"
continua default em todo o resto do app.

**Arredondamento (4639.3099999999995)** — já tinha sido corrigido de
raspão na v56 (o total de férias passou a arredondar depois de somar
líquido + abono), mas percebi que só a soma de duas parcelas
específicas estava coberta. Adicionei uma trava geral em `criarTitulo`:
todo valor de parcela arredonda em duas casas no momento de gravar,
não importa de qual módulo veio.

**Holerite sem mostrar as bases** — o detalhe de um holerite agora
mostra a base de INSS/FGTS, a base de IRRF (antes de dependentes e
pensão) e o INSS patronal do mês, além do que já mostrava.

## Ainda falta

13º salário, provisão mensal na DRE, lançamento da folha pelo bruto,
rateio de FGTS/guia por centro, título de pensão alimentícia pro
beneficiário, e os tipos de rescisão que faltam (acordo art. 484-A,
término de experiência, indireta).

---

# v56 — auditoria funda de Pessoal: substituição, tabelas 2026, faltas, férias, rescisão

Resposta ao teste que rodou direto nas funções de cálculo, com casos no
limite. Cobre os itens 1 a 5 da ordem que você deu, mais boa parte de
"o que falta no escopo". 13º salário, provisão na DRE, lançamento pelo
bruto e rateio de guia por centro continuam pendentes.

## Crítico — dinheiro saindo errado

**Substituição apagando título de outro funcionário.** Confirmado: um
mecanismo pensado só pra "previsão de despesa virar título real" (por
natureza+centro+competência) disparava pra qualquer título "previsto",
inclusive folha — cada funcionário no mesmo centro apagava o anterior.
Agora só substitui quando o previsto tem vínculo de verdade com uma
previsão cadastrada (`previsao_id`); folha e compra pararam de se
apagar.

**Tabelas de 2024 → 2026, com o redutor da Lei 15.270/2025.** Levantei
as tabelas oficiais em várias fontes (INSS: teto R$8.475,55,
contribuição máxima R$988,09; IRRF: mesma tabela desde maio/2025 +
redutor novo) e testei contra os três valores que vieram no relatório
como "corretos 2026" — bateu nos três (Camila 392,60/0, Roberto
518,90/0, Juliana 146,68/0). Ainda faltam: desconto simplificado
(R$607,20) e histórico de tabela por vigência (refazer folha antiga
ainda usa a tabela de hoje).

**Faltas não reduziam base nenhuma.** Agora reduzem os dias
efetivamente pagos no salário — a mesma linha que alimenta INSS, IRRF,
FGTS e VT, em vez de um desconto solto que só tirava do líquido. Líquido
negativo não some mais nos totais da folha: vira pendência explícita.

**Férias pagando em dobro na folha do mês.** Férias lançadas agora
"reservam" os dias na competência — a folha do mês desconta esses dias
do salário normal. Corrigi junto: abono pecuniário virou campo próprio
(0-10 dias, não "o que sobra" de um período curto), férias vencidas
pagam em dobro (art. 137), e a tela para de deixar lançar um cálculo
desatualizado depois de mudar os campos.

**Reajuste com vigência futura nunca entrava em vigor / retroativo
sobrescrevia o mais recente.** Raiz comum: a folha usava o salário
ATUAL do cadastro, não o que estava valendo na competência sendo
calculada. `calcularHolerite`, `calcularFerias` e `calcularRescisao`
agora buscam o salário do histórico pela data de referência de cada
cálculo. `registrarReajusteSalarial` recalcula o salário corrente a
partir do histórico inteiro, não só "se a vigência já chegou". Também
bloqueei redução de salário (irredutibilidade, CF art. 7º XI).

## Aprovação do DP

Mudar PIX, banco, agência ou conta de um funcionário **já cadastrado**
agora exige aprovação de diretoria/sócio — não só o perfil de DP (a
admissão de um funcionário novo continua só com DP, já que não há
histórico de pagamento ainda pra desviar). De caminho, corrigi o bug
por trás de "trocar PIX por conta quebra o pagamento": a sincronização
agora leva banco/agência/conta pro fornecedor-espelho, não só nome e
PIX (antes ficava com forma "PIX" e chave vazia, impagável por
qualquer via).

## Rescisão — reescrita

- Férias proporcionais por período aquisitivo, não ano civil (13º
  continua por ano civil, que já estava certo).
- Aviso prévio: 30 dias + 3 por ano de casa (Lei 12.506), até 90.
- Aviso indenizado projeta o contrato pra frente nos avos de 13º e
  férias (Súmula 371 TST) — antes não projetava nada.
- Removido o "no mínimo 1/12" forçado — quem sai com poucos dias de
  período novo não ganha avo nenhum daquele mês.
- Férias vencidas pagas em dobro também na rescisão.
- INSS e IRRF do 13º calculados separados do saldo de salário (tinham
  tributação exclusiva, e somar os dois antes de calcular jogava pra
  uma faixa mais alta do que cada um pagaria sozinho).
- Guias de INSS/IRRF e de multa de FGTS agora são geradas — antes só o
  líquido do funcionário virava título, e a multa de 40% caía direto
  na conta dela em vez de ir pra guia.
- Ordem de operações corrigida: confere motivo de folha fechada, férias
  lançadas depois da data, e funcionário já desligado ANTES de criar
  qualquer título — não gera mais título órfão quando o desligamento
  falha por último.
- Data de desligamento não aceita mais ser anterior à admissão.

## Cadastro e validações

- CPF validado de verdade (dígito verificador) — "123" não passa mais.
- CPF duplicado só bloqueia entre quem está ATIVO — dá pra recontratar
  um ex-funcionário.
- Salário abaixo do mínimo, dependentes não inteiros e admissão no
  futuro são recusados no cadastro.
- Folha não inclui mais quem foi admitido depois do fim do mês sendo
  fechado, e proporciona sozinho quem foi admitido no meio do mês
  (antes recebia o mês inteiro na primeira folha).
- Períodos aquisitivos de férias são gerados sozinhos conforme o tempo
  de casa completa 12 meses — um funcionário novo não fica mais "sem
  férias pendentes" pra sempre, e um período fechado que ninguém
  digitou a mão deixa de ficar invisível (inclusive pra rescisão).

## O que ainda falta

13º salário (1ª e 2ª parcela, vencimentos 30/11 e 20/12), provisão
mensal de férias/13º entrando na DRE, lançamento da folha pelo bruto em
vez do líquido (com INSS/IRRF como obrigação a recolher, não como
"imposto" reduzindo o custo de pessoal), rateio de FGTS e guia por
centro (hoje sempre cc100), título de pensão alimentícia pro
beneficiário, vale-refeição sem uso em lugar nenhum, tipos de rescisão
que faltam (acordo art. 484-A, término de experiência, indireta), e os
itens de interface (checkboxes desalinhados em mais lugares, botões
"Fechar" duplicados, "Férias1" grudado, arredondamento de valores
longos, holerite sem mostrar as bases).

---

# v55 — checkbox alinhado e tabela de férias

**Checkbox desalinhado do texto** — era geral, não só na Rescisão:
todo `<label>` que embrulha um checkbox ("aviso prévio indenizado",
"vale-transporte", "periculosidade" etc.) tinha o quadradinho fora da
linha de base do texto. Corrigido de forma ampla no CSS, não só no
campo que você apontou.

**Aba Férias virou uma tabela única com todo mundo** — antes só
mostrava alerta de quem estava perto do limite e um formulário pra
calcular um funcionário de cada vez. Agora é uma tabela com todo
funcionário ativo: período aquisitivo, dias ainda a gozar, o limite
pra gozar sem vencer (com quantos dias faltam, ou há quantos dias já
venceu), e uma situação (Em dia / Atenção / Urgente / Vencida / Sem
férias pendentes), ordenada da mais urgente pra mais tranquila. Quem
tem férias pendentes ganha um botão "Lançar férias" na própria linha,
que abre o cálculo (1/3, abono, INSS, IRRF) num modal, igual antes.

---

# v54 — histórico salarial e estimativa de FGTS mês a mês

**Estimativa de multa de FGTS agora cobre o contrato inteiro, não só o
que este sistema já gerou.** Antes, a estimativa somava o FGTS das
folhas fechadas AQUI — se o funcionário trabalhava desde antes deste
ERP existir, ou passou meses sem folha lançada, aquele período ficava
de fora e a estimativa vinha menor do que deveria. Agora percorre mês
a mês desde a admissão: usa o FGTS de verdade nos meses com folha
fechada, e nos demais estima 8% sobre o salário que estava em vigor
naquele mês — o que exige saber qual era o salário em cada época.

**Histórico salarial** — cada funcionário guarda a lista de salários
por vigência (nasce com uma entrada "Admissão" ao cadastrar). Reajuste
agora é uma ação própria — botão "Reajustar" na lista de Funcionários
— não mais um campo solto no formulário de editar: pede o novo
salário, a data de vigência e o motivo, e fica registrado. O campo de
salário no "Editar" ficou desabilitado com uma nota apontando pro
"Reajustar", pra não dar a entender que mudar ali funciona sem deixar
rastro.

Os 3 funcionários de exemplo já saem com histórico — Camila e Roberto
(mais tempo de casa) com um ou dois reajustes anteriores; Juliana
(admitida em 2024) só com a admissão.

Nada disso muda o que o financeiro já podia fazer desde a v52-53:
"Calcular" na aba Rescisão continua uma prévia sem efeito, com a multa
já vindo estimada (agora mais precisa) e editável antes de decidir
demitir.

---

# v53 — motivo da rescisão muda o que é devido

**Prévia da multa de FGTS antes de decidir demitir** — já era assim
desde a v52 e continua: "Calcular" na aba Rescisão não desliga
ninguém, é só leitura. O campo de multa nasce com a estimativa (40%
sobre o FGTS que a folha já gerou pra aquele funcionário no sistema) e
aceita edição — dá pra rodar o financeiro estimar o total antes de
qualquer decisão, com qualquer funcionário ativo, numa data hipotética.

**Motivo da rescisão** — campo novo "Quem tomou a decisão", com três
opções, cada uma calculando diferente:

- **Dispensa sem justa causa** (empresa demite) — o que já existia:
  saldo de salário, 13º e férias proporcionais, aviso prévio indenizado
  (opcional), multa de 40% do FGTS.
- **Pedido de demissão** — sem multa de FGTS e sem aviso prévio pago
  pela empresa. Ainda são devidos 13º e férias proporcionais (isso não
  muda com o motivo). Se o funcionário não cumprir os 30 dias de aviso,
  um checkbox desconta o equivalente a 1 salário — o direito de
  descontar aqui é da empresa, o oposto do caso anterior.
- **Dispensa por justa causa** — só o que já era direito adquirido:
  saldo de salário e férias vencidas (se houver período já fechado sem
  gozar). Sem 13º proporcional, sem férias proporcionais, sem aviso,
  sem multa de FGTS.

O resultado agora só mostra as linhas que se aplicam ao motivo
escolhido, em vez de listar tudo com zero. Isso vale tanto pra prévia
quanto pro lançamento de verdade — o texto do desligamento no cadastro
do funcionário registra automaticamente qual dos três foi usado.

---

# v52 — ajustes de Pessoal a partir do primeiro uso

**Rubricas do cálculo visíveis** — nova tabela no topo de Pessoal →
Tabelas, listando cada rubrica que `calcularHolerite` produz hoje
(código, tipo, natureza, se incide INSS/IRRF/FGTS, observação). É
documentação pra conferir contra o que a analista de DP já conhece —
deixei explícito na própria tela que mudar essa lista não muda o
cálculo (isso ainda exige mexer no código); uma rubrica cadastrável de
verdade é o passo seguinte, se fizer sentido depois da conferência.

**Campo numérico virando "10" ao digitar "1"** — corrigido de forma
geral: um clique em qualquer campo `.num` da tela inteira agora
seleciona o conteúdo, então digitar substitui em vez de inserir.
Achei melhor resolver assim (um listener só, no nível do app) do que
só nos campos de hora extra da Folha, já que o mesmo problema existiria
em qualquer outro campo numérico do sistema.

**Multa de FGTS editável na rescisão** — o campo virou um input: nasce
com a estimativa, mas aceita o valor real do extrato da Caixa antes de
confirmar. O total recalcula na hora — INSS e IRRF não mudam (a multa
de FGTS é isenta dos dois), só o líquido final muda.

**Ver e cancelar folha fechada** — a lista de folhas fechadas agora
tem um botão "Ver", que abre o detalhe completo (cada funcionário,
proventos, descontos, líquido, e o holerite linha a linha de cada um).
O cancelar já existia, mas tinha um bug sério: a checagem interna
exigia permissão de diretoria/sócio mesmo com o perfil de DP já
autorizado a fechar e cancelar folha — cancelar sempre falhava calado
e ainda por cima mostrava "cancelada parcialmente" sem cancelar nada.
Corrigido.

**Folha fecha como previsão, não como título pronto pra pagar** — ao
fechar, o salário de cada funcionário e as guias de FGTS e INSS/IRRF
entram em Despesas Previstas (dão visibilidade de caixa na hora), e só
viram título de verdade quando alguém confirma pelo botão "Efetivar"
já existente em Contas a Pagar. Como o fornecedor e o valor já vêm
certos da folha, efetivar é revisar e confirmar — não digitar tudo de
novo. Daí em diante segue o fluxo normal: aprovação, pagamento e
conciliação com o extrato como qualquer outro título.

**"Informe o fornecedor/credor" ao fechar** — bug nos 3 funcionários de
exemplo: eu tinha cadastrado eles direto no arquivo de dados, sem
passar pela função que cria o fornecedor-espelho automaticamente (o
que `criarFuncionario` faz sozinho pra qualquer funcionário cadastrado
pela tela). Os três já têm o fornecedor certo agora — fechar a folha
de teste deve funcionar de ponta a ponta.

---

# v51 — módulo de Departamento Pessoal (modelo A: cálculo completo)

Primeira versão pra bater com a analista de DP. Motor de cálculo de
verdade — INSS e IRRF pela tabela progressiva oficial, FGTS, não um
campo que só registra um valor calculado fora.

## O que tem

- **Funcionários** — cadastro CLT (separado do credor PJ/SCP que já
  existia), com cargo, salário, jornada, dependentes, rateio por
  centro de custo (o mesmo mecanismo de parcela — cobre o caso de
  funcionário alocado num contrato, como a Iron Trainers), dados
  bancários e benefícios. Cada funcionário ganha um credor-espelho
  automático pra ser pago pelo mesmo CNAB/PIX que já existe.
- **Folha** — escolhe a competência, ajusta hora extra/falta por
  funcionário, vê o líquido recalcular na hora, confere o holerite
  linha a linha (mesma conta que roda no fechamento — não tem "o que
  a tela mostra" e "o que o sistema realmente calcula" divergindo) e
  fecha: gera um título por funcionário mais a guia de FGTS e a guia
  de INSS+IRRF. Cancelamento em cascata igual ao lote de
  produtividade.
- **Férias** — férias + 1/3 constitucional + abono pecuniário (venda
  de até 10 dias), com INSS e IRRF sobre essa base específica.
  Alerta de período vencendo (60/30 dias) e vencido, mesmo padrão do
  alerta de reajuste de contrato.
- **Rescisão** — cobre dispensa sem justa causa: saldo de salário,
  13º proporcional, férias vencidas e proporcionais + 1/3, aviso
  prévio indenizado, multa de 40% do FGTS. Confirmar já desliga o
  funcionário.
- **Tabelas** — INSS, IRRF, alíquota de FGTS, salário mínimo, teto de
  desconto de VT, tudo editável (só pelo perfil Administração) em vez
  de preso no código. É a lei que muda todo ano, não o sistema.
- **Perfil "Departamento Pessoal"** novo, com acesso separado de
  "ver dados pessoais" (CPF, dependente, conta bancária) — a mesma
  lógica de `ver_custo` separar dinheiro de quem só move material.
  Diretoria e sócio também ganharam acesso ao módulo.

## O que testei antes de entregar

Rodei as fórmulas de INSS e IRRF fora do sistema com 4 salários
diferentes (com e sem dependente, no teto do INSS, no salário
mínimo) e conferi cada conta à mão — bateu em todos os casos.

## Simplificações que você e a analista de DP precisam confirmar

Estão marcadas em comentário no código, mas resumindo:

1. **As tabelas de INSS e IRRF são de referência (~2024)** — não são
   necessariamente as vigentes agora. É o primeiro ajuste antes de
   rodar uma folha real: abra Pessoal → Tabelas e confira os valores
   contra a tabela publicada.
2. **Hora noturna** não usa a "hora reduzida" de 52min30s — calcula
   sobre a hora cheia.
3. **DSR sobre variáveis** (hora extra, adicional noturno) usa uma
   proporção fixa de referência, não o calendário real de domingos e
   feriados de cada mês.
4. **Rescisão só cobre "sem justa causa"** — pedido de demissão e
   justa causa têm fórmula diferente (sem aviso, sem multa de FGTS).
5. **Multa de 40% do FGTS na rescisão é uma estimativa**, calculada
   sobre o que a própria folha deste sistema já gerou — o valor real
   depende do extrato de FGTS na Caixa (que este ERP não tem).
6. **A guia de FGTS e a guia de INSS/IRRF saem consolidadas** (uma
   linha só, todos os funcionários juntos, no centro da matriz) — se
   vocês precisam ratear encargo por projeto também, isso ainda não
   está feito.
7. **Banco do funcionário é texto livre**, não a lista de contas da
   empresa (`D.bancos` é outra coisa — são as contas de onde a HJM
   paga, não um cadastro de bancos brasileiros).

Nada disso trava o uso — é só o que vale checar com ela antes de
rodar a primeira folha de verdade.

---

# v50 — ajustes de cadastro a partir da comparação com o PegaPlantão

**GHC - Anestesia POA (pj10)** desativado — projeto descontinuado. Mas
achei um risco real ao mexer nisso: o combo de projeto em Contas a
Receber (filtro e editar título) só listava projeto ativo, então um
resíduo que ainda aparecesse nesse projeto ficaria sem opção certa no
select — salvar sem mexer nesse campo trocaria o projeto do título sem
ninguém perceber. Corrigido: o filtro agora mantém na lista qualquer
projeto inativo que já tenha título lançado nele, e o editar sempre
inclui o projeto atual do título mesmo se estiver inativo, marcado
"(inativo)". Contas a Pagar já tinha essa proteção (o combo de rateio
já separa "Encerrados" à parte); só faltava em Contas a Receber.

**SAMU - Nova Friburgo** cadastrado (pj43), igual ao contrato de SAMU
Petrópolis (pj22) que já existia. Sem histórico ainda — impostos e
retenção são o ponto de partida do outro contrato de SAMU, não os
números reais deste; confirme antes do primeiro faturamento.

**Iron Trainers, os demais "só no sistema" e "Pega Plantão":** nada a
mudar — Iron Trainers é fornecimento de mão de obra de enfermagem e
psicologia (confirmado, não é hospital mesmo), os outros projetos "só no
sistema" seguem como estão, e não existe (nem deveria existir) cadastro
para "Pega Plantão".

**Sobre o filtro de custo por setor:** conferi o código antes de mexer —
`setoresTiposDe()` já lê os setores direto das parcelas importadas
(`p.itens`), sem nenhuma lista fixa por trás. Um setor que apareça pela
primeira vez num arquivo novo já entra sozinho na próxima vez que o
relatório "Custos por setor/tipo" for aberto — não precisei mudar nada
aqui, o comportamento pedido já é o que existe.

---

# v49 — auditoria completa: 7 críticos, 7 importantes, 9 menores

---

# v49 — auditoria completa: 7 críticos, 7 importantes, 9 menores

Resposta ao relatório de QA — cada item abaixo foi conferido no código antes
de mexer, não só reescrito por suspeita.

## Críticos (dinheiro e fluxo)

**Previsões duplicadas.** `if` sem chaves: só a primeira linha estava
condicionada a "não existe ainda", o `push` rodava sempre. Corrigido em
`salvarPrevisao` e `salvarPrevisaoDespesa`.

**Fluxo realizado contando pagamento que não saiu do banco.**
`todosPagamentos()` só excluía estornado; agora exige `situacao ===
'liquidado'`. Resolve também a solicitação desfeita continuar aparecendo
como saída realizada.

**Trava de data futura invertida.** A condição usava `!== 'liquidado'`
quando precisava ser `=== 'liquidado'` — travava solicitar pagamento pra
data de vencimento (o caso comum) e deixava passar uma baixa liquidada
com data no futuro (o caso que não faz sentido). Removido também
`d.agendado`, um parâmetro morto que nunca era setado em lugar nenhum.

**Juros e multa dobrando/sumindo.** `liquidar()` sobrescrevia o campo
`valor` com o total do extrato mantendo juros/multa separados — dobrava a
conta. Agora a diferença contra o previsto entra só no principal. CNAB e a
tela de remessa somavam só o principal, sem juros/multa: criado um
`totalPg()` único, aplicado nos três lugares (arquivo, total da tela,
listagens).

**Conciliação marcando linha como conciliada sem pagar o título.**
`classificarLinha` ignorava o retorno de `registrarPagamento` — se a baixa
falhasse (perfil sem permissão de pagar, por exemplo), a linha virava
"conciliada" do mesmo jeito, com o título aberto por trás. Agora o erro
aparece e a linha continua pendente. `lancarReceberAvulso` criava o título
a receber ANTES de saber se conseguiria dar baixa (permissão diferente),
deixando órfão quando falhava — a checagem de permissão agora vem primeiro.

**Recebimento parcial sumindo do fluxo.** Um recebimento parcial (resíduo
mantido em aberto) não entrava no realizado nem saía do previsto pelo
valor certo — usava sempre o líquido cheio. Corrigido no relatório de
fluxo, no Excel exportado, nas métricas do Contas a Receber e num
indicador novo na própria linha (`recebido R$X · falta R$Y`).

**Estorno não desfazendo o ajuste de retenção.** Receber o bruto (a
retenção prevista zera, o líquido é corrigido) e depois estornar devolvia
o título pra "faturado", mas com a retenção e o líquido do recebimento
estornado — como se o dinheiro ainda tivesse entrado. Agora, ao voltar a
zero, restaura os valores originais gravados no momento do ajuste.

## Importantes

**Compras sem trava de aprovação.** `enviarPedido` agora exige que a
requisição esteja "aprovada". A causa do "sem alçada": o sistema usa "0 =
sem limite", e comprador/assistente simplesmente não tinham entrada
nenhuma — ausência e zero davam o mesmo resultado. Adicionados com tetos
de partida (comprador R$ 20 mil, assistente R$ 5 mil), editáveis em
Administração, cujo formulário só tinha campo pra diretoria/sócio/admin.

**Previsão de compra, os três problemas.** O erro ficava mudo porque
`criarTitulo` exige a permissão `lancar` (que comprador não tem de
propósito) e ninguém conferia o retorno — criada uma válvula interna
(`_interno`, nunca exposta a input) e o erro agora aparece de verdade. A
natureza da previsão vem do produto de verdade (com 8.04 como último
recurso), não mais um "3.03" chutado que nunca batia com a NF real. E
descobri que TODA previsão de despesa (não só a de compra) sumia do
relatório de fluxo e do Excel porque "previsto" nunca estava na lista de
status aceitos — corrigido nos dois lugares.

**NF do Estoque ignorando duplicatas.** Nota com dois vencimentos virava
um título único; agora usa as duplicatas da própria nota, igual o
Financeiro já fazia. O checkbox "lançar também no contas a pagar" se
desmarca sozinho, com aviso, quando a chave já está em outro título.

**Auto-cadastro de credor a partir de NF.** Os quatro problemas do modal de
cadastro rápido: natureza agora vem pré-selecionada com a do lançamento
(antes nenhuma opção tinha `selected`, o navegador sempre pegava a
primeira — "2.01 ISS"); forma de pagamento tenta ler o código da própria
NF-e (`tPag`) em vez de cair sempre em PIX por ser a primeira da lista;
chave PIX só vem preenchida com o CNPJ quando a nota realmente indica
pagamento PIX; CPF vs. celular com DDD (os dois têm 11 dígitos) agora usa
o dígito verificador de CPF de verdade em vez de assumir CPF sempre.

**Transferência de estoque.** Três correções: data inválida agora barra a
operação inteira, checando origem E destino antes de mexer em qualquer
saldo (antes só conferia a origem, e a entrada no destino podia recusar
uma data que a origem tinha aceito); se a entrada no destino falhar depois
que a saída já aconteceu, o estoque não soma mais — o estorno automático
devolve a quantidade na origem; a função nunca mais devolve "ok" com zero
itens. O mesmo padrão foi encontrado e corrigido em `entradaLote`.

**`hoje()`/`mesAtual()` em UTC.** Confirmado: depois das 21h no Brasil já
era "amanhã" no sistema. Agora usam os componentes de data locais do
navegador.

**Contratos.** Aditivo de valor agora empurra o mês de reajuste 12 meses
pra frente (o alerta parava de sumir depois de aplicado); aditivo de prazo
recusa data de vigência no passado. Contador "Sem anexo" corrigido pra
usar o mesmo critério da lista (excluía só cancelado; agora exclui também
NF dispensada, pago e substituído — por isso 62 contra 58). Filtro "Sem
NF" reseta ao trocar de aba em Contas a Pagar, em vez de ficar preso
depois de usado pelo atalho do painel.

## Menores

- Cancelar lote de produtividade com parcela já cancelada antes agora
  fecha como "cancelado" — a parcela já cancelada conta como "já no
  estado certo" em vez de nunca contar pro total.
- Período de produtividade escrito com "a" em vez de "~"/"-" agora é
  reconhecido; período sem ano assume o ano corrente (ou o anterior, se
  isso jogar a competência pro futuro). Não testado contra arquivo real
  do PegaPlantão — vale conferir com um de verdade.
- Validação de armazém com setores comparava o pai que o registro já
  tinha junto com uma condição que nunca era compatível com ela ao mesmo
  tempo; corrigida pra checar se o formulário está tentando dar um pai
  novo a quem já tem filho.
- `regraDe` não compara mais nos dois sentidos — uma chave curta não bate
  mais com qualquer linha que caiba dentro dela.
- Removida a exclusão por distância de data em `candidatos` que
  contradizia o próprio comentário ao lado (e a constante `JANELA`, que
  ficou sem uso).
- Botão "Baixar" não aparece mais em título ainda previsto (só em
  "faturado", que é o único que a baixa aceita).
- Toast de aviso movido do canto inferior pro canto superior direito —
  parava de cobrir botões de ação no rodapé de telas mais curtas.
- Barra de abas do Financeiro com padding reduzido e rolagem horizontal
  como reforço, pra nunca mais cortar a última aba.
- Ao cadastrar material a partir da nota, selo próprio ("cadastrado agora
  pela nota") em vez do enganoso "escolhido à mão"; e o resumo "X itens
  sem vínculo" agora recalcula a cada vínculo resolvido, em vez de ficar
  congelado no número da primeira leitura do arquivo.

---

# v48 — pedido por fornecedor, lotes de produtividade e saldo bancário

**Compras.** Cotação com fornecedores diferentes por item agora divide o
pedido sozinha, um por fornecedor (numeração PC-XXXX-A/B), cada um com sua
alçada calculada separado. Enviar o pedido já gera uma previsão financeira
(natureza 3.03, vencimento estimado) — antes o compromisso só aparecia no
contas a pagar quando o material chegava; a previsão some sozinha quando a
NF real entrar pela mesma natureza e projeto.

**Produtividade.** Três coisas novas, todas em cima de uma peça que faltava
por completo: um registro por importação (lote), sabendo quais títulos
saíram dali.
- Aba "Lançamentos": todo lote já lançado, com projeto, competência,
  médicos e valor; abre o detalhe por médico (setor, tipo, plantões,
  horas). Continua sem edição — o jeito de corrigir é cancelar o lote
  inteiro e reimportar.
- Cancelamento em cascata: cancela todos os títulos do lote de uma vez.
  Se algum já teve pagamento, recusa em bloco por padrão e só cancela
  com uma confirmação extra e deliberada ("forçar"), deixando de fora o
  que já foi pago — não vira caminho fácil.
- Aba "Cobertura": todo projeto com produtividade, cruzado com a
  competência escolhida, mostrando quem já tem lote e quem não tem. Um
  contador na própria aba liga sozinho a partir do dia 11, olhando pra
  competência do mês anterior.

**Contas a Pagar.**
- Upload de NF (PDF/XML) no editar — guardado em memória por enquanto
  (base64), com link pra abrir/baixar; vira referência de storage de
  verdade quando migrar pro Supabase. Limite de 5 MB.
- Retenção manual no lançamento — os 6 tributos comuns (ISS, IRRF, PIS,
  COFINS, CSLL, INSS), preenchidos sozinhos quando vem de XML, editáveis
  na mão quando não vem. Vale notar: o valor retido é guardado e mostrado,
  mas ainda não desconta do valor efetivamente pago — isso já era assim
  antes, para o caso de XML, e mantive igual para não mudar comportamento
  de pagamento sem pedir.
- Saldo em conta: novo cartão de métrica, vindo do último extrato
  importado, conferido contra o saldo anterior mais a movimentação do
  próprio arquivo. Diferença abaixo de R$ 3.000 mostra o saldo do arquivo
  com alerta; acima disso, mostra "bloqueado" em vez de um número errado.
  Aparece em Contas a Pagar e na fila de aprovação de pagamentos. Por
  enquanto só bancos com extrato já importado aparecem — hoje, só o
  Bradesco.

**Contas a Receber.** Botão "Editar" em título ainda não recebido —
cliente, número da NF, projeto, competência, vencimento. Título já
recebido não entra aqui (estorna o recebimento antes, mesma regra do
contas a pagar).

---

# v47 — três ajustes de espaço no Contas a Pagar

Coluna de projeto truncada em 14 caracteres (nome completo no title, pra
não rolar a tela pro lado). Coluna "Data da baixa" só aparece na aba
"Pagas" agora — na aba "A pagar" ela não dizia nada mesmo (nada foi
baixado ainda), e quem quer ver que um título foi pago parcialmente já
percebe pela diferença entre Valor e Saldo, sem precisar de mais uma
coluna. E o aviso de título travado ficou curto na lista ("completar
cadastro" em vez de "credor sem forma de pagamento no cadastro") — o
texto completo continua no title do badge "travado".

---

# v46 — cadastro na hora, médico não vira fornecedor, e NF fica editável depois

**Fornecedor não é mais tudo ou nada.** Três lugares recusavam um nome
digitado que não batia com nenhum cadastro (lançar despesa na
conciliação, editar parcela, efetivar previsão) — agora cadastram na
hora. E o tipo do cadastro passou a seguir a natureza: `3.01 — Serviços
médicos, produção` cadastra médico; qualquer outra natureza cadastra
fornecedor. Antes o auto-cadastro da conciliação sempre criava
fornecedor, então repasse de médico não identificado ia parar em
Cadastros › Fornecedores.

**Lançar despesa em lote virou conferência de verdade.** Antes, lote com
nomes diferentes por linha só mostrava uma prévia — pra editar algo,
desmarcava "cada linha com o seu nome" e um único texto valia pra todas.
Agora abre uma tabela com todas as linhas visíveis, cada uma com
Fornecedor e Descrição editáveis, já preenchidos com o nome do extrato
(um PIX "DES: CHRISTIAN DE OLIVEIRA" já chega como "CHRISTIAN DE
OLIVEIRA" nos dois campos). Lançamento individual continua com a janela
simples, só que os dois campos vêm preenchidos e editáveis do mesmo jeito.
Quem não estiver cadastrado é cadastrado com o nome que ficou no campo.

**Recebimento não reconhecido pode ser de cliente novo.** "Lançar como
receita" agora pergunta primeiro se é pagamento de cliente ou outra
receita (reembolso, resgate, aporte, estorno). Sendo cliente, escolhe um
já cadastrado ou cadastra na hora (mesmo cadastro completo de sempre, com
CNPJ), escolhe o projeto, e o título nasce direto como recebido — sem
precisar que a NF já estivesse lançada no Faturamento. Antes disso não
existia: só dava pra vincular a um título que já existia ou lançar como
receita genérica, sem cliente nenhum.

**Dados da NF ficaram editáveis depois do lançamento.** Faltava
completamente esse caminho — só dava pra informar chave e anexo na hora
de criar o título. Agora o modal de editar (Contas a Pagar e Pagas) tem
uma seção própria: checkbox "não exige NF" e, desmarcado, o campo da
chave de acesso. Produção médica (3.01) já nasce marcada como dispensada,
o resto nasce exigindo. O filtro que já existia como "com/sem anexo"
virou três estados reais — Sem NF (pendente), Dispensada, Com NF/anexo —
e uma linha "sem NF" aparece na tabela pra quem está pendente de verdade.

**Contas a Pagar sem filtro redundante.** "Em aberto e parciais" saiu do
seletor de situação (sobreposto com "A pagar") e "Pagas" também saiu de
lá — já tem aba própria pra isso. "Todas" agora exclui pagas de verdade
(antes trazia tudo misturado mesmo estando na aba errada).

---

# v45 — sugestão de vínculo não inventa parentesco, e contas pagas ganha aba própria

**O achado grave.** `candidatos()`, no ramo de pagamento (saída), tinha um
atalho perigoso: sem nome legível no extrato, a certeza virava "nenhum
outro pagamento igual no período" — sem NENHUMA exigência de que o nome do
pagamento sugerido tivesse a ver com o nome do extrato. Foi assim que um
PIX para o João Victor Rocha apareceu como possível vínculo de um
pagamento já baixado da Maria Dyandra Karolin: zero letras em comum, e o
sistema sugeriu do mesmo jeito. Agora, quando os dois lados têm nome de
verdade (não é um TED ou PIX genérico) e não compartilham nenhuma palavra,
o candidato **nem entra na lista** — antes só perdia a certeza, continuava
aparecendo em "possíveis". Abreviação ainda passa ("Jose Luis da S.
Santos" bate com "Jose L. da Silva" por "Jose"): quem decide se serve é a
pessoa, não o sistema.

Conferido também se dava pra CONSUMAR o vínculo errado, não só sugerir: não
dava — `liquidar()` já recusa reliquidar um pagamento fora de
autorizado/enviado, então clicar em "Vincular" numa sugestão dessas erra e
não faz nada. Mas essa mesma trava também impedia reconciliar um pagamento
já baixado quando o vínculo era o CERTO (o caso de quem baixa manual antes
do extrato chegar, que é o motivo de já baixado aparecer como candidato).
`conciliar()` agora pula a reliquidação quando o pagamento já está
liquidado, só amarrando a linha do extrato a ele.

De quebra, o critério de sugestão ficou mais parecido com o que cada lado
realmente sustenta: contas a receber passou a decidir só por valor (nome de
cliente lá é sinal fraco, e já considera a faixa líquido-bruto como
distância zero); contas a pagar com favorecido genérico ou previsão sem
fornecedor específico cadastrado também decide só por valor; e quando os
dois lados têm nome específico, continua exigindo compatibilidade real.

**Contas a Pagar virou duas abas.** "A pagar" e "Pagas", cada uma com o
filtro de data que faz sentido pra ela — vencimento na primeira, data da
baixa na segunda (misturar os dois filtros no mesmo par de campos deixava
ambíguo qual data estava em uso). A tabela ganhou coluna própria de Projeto
e coluna própria de Data da baixa (antes era uma sub-linha embaixo do
vencimento). E pra tirar um número pro financeiro na hora — "o que foi
pago do projeto X" — a tela ganhou Exportar Excel (.xlsx com cabeçalho,
moeda e data formatados) e Imprimir/PDF, além do CSV que já existia.

---

# v44 — doze ajustes na conciliação, na produtividade e nos relatórios

**Vencimento da produtividade.** O repasse ao médico usava um esquema de
dia fixo do calendário, populado só quando o projeto nasce pelo atalho
"Novo projeto" do Faturamento. Todo o resto — a imensa maioria dos
projetos — caía no padrão embutido (dia 10 do mês seguinte) e ignorava o
`prazo_dias` já cadastrado certinho para o contas a receber. Agora usa a
mesma conta de dias corridos a partir do fim da competência, e só cai no
esquema de dia fixo quando o projeto realmente não tem prazo em dias
cadastrado.

**Código de reconhecimento do projeto.** Novo campo no cadastro do
projeto (`GHC_ANES`, `HMSM_PED`...), opcional, que aparece junto do nome
em todo candidato de vínculo da conciliação — e nos relatórios de
título, o nome do candidato agora vem truncado, com o código ao lado em
vez de um texto longo demais para a tela.

**Rastro do projeto nos candidatos.** Candidato de pagamento (produtividade,
despesa) agora mostra de qual projeto ele saiu — útil pra notar um vínculo
errado quando você sabe que só lançou produtividade de um hospital no dia
anterior. Candidato de recebível mostra bruto e líquido lado a lado, não só
o líquido, pra facilitar quando o órgão paga o valor cheio.

**Conciliação — colunas, filtro e trocas.** As tabelas de vínculos concretos
e possíveis ganharam Valor sistema, Diferença, Descrição sistema e Por quê
como colunas próprias, com Descrição extrato numa coluna só (antes eram
Histórico e Contraparte separados). Um filtro Tudo/Entradas/Saídas evita
confundir os dois lados na hora de procurar um valor. Um vínculo "concreto"
agora tem botão Trocar — é raro, mas dois títulos de competências
diferentes podem coincidir em valor, e antes não dava pra escolher outro
sem desmarcar o lote inteiro. E a busca manual de título passou a mostrar
a competência de cada NF — importante quando duas notas do mesmo fornecedor
têm o mesmo valor e só o número muda.

**Decisão de resíduo, sem forçar a mão.** Quando o recebimento vem abaixo do
líquido esperado, o antigo aviso de OK/Cancelar virou um modal de verdade:
mostra os números, oferece Quitar (com o valor da glosa já calculado) e
Manter resíduo em aberto — e o X/Fechar de sempre continua ali pra quem
preferir não decidir agora e for primeiro corrigir o faturamento ou lançar
uma glosa manual.

**Soma da seleção.** Selecionar vários lançamentos na conciliação (pra
autorizar, vincular ou lançar em lote) agora mostra quantos e quanto somam,
do lado dos botões — o mesmo que o contas a pagar já fazia, só que a
conciliação não tinha.

**Data de baixa no contas a pagar.** A tabela só mostrava o vencimento,
mesmo pra título já pago. Agora, quando pago, aparece a data da baixa numa
sub-linha embaixo do vencimento.

**Relatório de custos por setor e tipo.** Nova aba em Relatórios com três
filtros em cascata — projeto, setor, tipo — mostrando pago e a pagar de
cada combinação. Escolhendo os três, em vez de um número só, mostra as
parcelas por trás dele (médico, competência, situação, baixa), pra manter
o rastro até quem gerou o custo.

---

# v43 — líquido não é o teto do recebimento, o bruto é

O vínculo de recebimento (baixa manual e conciliação bancária, as duas
passam pela mesma `receberBaixa`) comparava tudo contra o valor líquido
esperado do título, como se qualquer coisa acima dele fosse o cliente
pagando a mais. Não é: o líquido é uma estimativa de retenção, e o órgão
frequentemente reter menos do que o previsto — às vezes nada. Isso agora
vira três faixas, não duas:

**Entre o líquido e o bruto da nota** — a retenção real foi menor que a
prevista. O sistema vincula direto, fecha o título com o valor que
efetivamente entrou, corrige o `valor_retido`/`valor_liquido` para
refletir a realidade e grava uma divergência de retenção (aparece como
alerta na lista de contas a receber e no log de auditoria) para alguém
conferir depois. Nada disso bloqueia o vínculo.

**Acima do bruto** — aí sim é dinheiro que não é deste título. O bloqueio
que existia continua, só que agora comparando com o bruto, não com o
líquido — a mensagem pede pra lançar a diferença como outro título.

**Abaixo do líquido** — deixou de fechar sozinho o título como "faturado
com resíduo aberto" sem avisar ninguém (o texto do modal de baixa
prometia glosa automática, mas nenhuma tela nunca ativava isso — `d.encerrar`
existia na função e não era chamado por ninguém). Agora `receberBaixa`
devolve `decidir` em vez de decidir por conta própria, e quem concilia
escolhe: quitar registrando a diferença como glosa, ou manter o título
aberto aguardando o resto.

**Previsão sem NF** — baixa direta numa previsão (`status: 'previsto'`)
passou a ser bloqueada. Dinheiro que caiu no banco é dinheiro que já foi
faturado; se a nota ainda não foi lançada, o caminho é lançar a NF em
Faturamento — que já concilia com a previsão pelo vínculo de faturamento
existente — não dar baixa direto na previsão.

---

# v42 — chave PIX que não vinha porque o cabeçalho tinha uma palavra antes

A leitura da aba FINANCEIRO procurava a coluna da chave PIX por cabeçalho
começando com "pix". Em arquivos onde a coluna se chama "Chave Pix" — o
termo vem no meio, não no início — a busca nunca encontrava, e a chave
ficava vazia para todo mundo. Como a forma de pagamento só é preenchida
quando existe uma chave PIX no arquivo, a consequência em cascata era o
médico entrar como "sem forma" mesmo tendo os dados completos na planilha
importada.

A coluna Tipo (CPF, e-mail, telefone, aleatória) continuava sendo
localizada normalmente, por isso aparecia certa mesmo com a chave em
branco — o que tornava o problema mais difícil de perceber numa olhada
rápida.

A busca dessa coluna específica passou a aceitar "pix" em qualquer posição
do cabeçalho, sem mudar o critério das demais colunas.

---

# v41 — antecipação deixa de ser suspeita

Pagar hoje o que vence no fim do mês é rotina, e o sistema estava
desconfiando do normal. Três travas de data saíram, e o que sustenta a
certeza passou a ser o que de fato identifica o lançamento: valor e
favorecido.

**Pagamento nosso.** A janela de dez dias derrubava o candidato antes de
qualquer análise. Agora a distância de data ordena e explica, não elimina:
a janela é de 60 dias e a linha diz "agendado para 30/09, saiu antes". Com
favorecido legível, quem decide é o nome, por mais distante que esteja a
data. Sem favorecido legível, o que sustenta a certeza é ser o único
pagamento daquele valor no período — a regra dos dois dias, que o v40
tinha criado, saiu.

**Parcela em aberto.** A regra "outra competência nunca é certeza" nasceu
do aluguel, e acabou punindo toda antecipação. O que separa os dois casos
não é o mês: é haver uma parcela CONCORRENTE. Se existe outra em aberto,
do mesmo credor e do mesmo valor, vencendo no mês do extrato, então é
aquela a provável e a de outro mês não pode ser certeza. Não havendo
concorrente, a antecipação é a única leitura possível e vira vínculo
concreto.

**Recebimento.** Cliente paga quando quer, e vencimento distante tirava a
certeza de um recebimento de valor exato. Agora o vencimento longe é
apenas informado — "vence em 20/10, recebido antes" —, e a certeza vem do
nome do cliente ou de o valor exato ser único entre os títulos em aberto.

Conferido nos três casos ao mesmo tempo: conta de energia vencendo em
05/10 paga hoje entra como concreto; aluguel com setembro e outubro em
aberto casa com setembro e deixa outubro como possível, com o motivo
escrito; recebimento de 35 dias de antecedência entra como concreto.

**Competência:** o padrão continua sem mês fechado. A trava existe e
funciona, mas quem fecha o período é a Administração.

---

# v40 — dois achados novos e a metade que faltava da conciliação

## A baixa de estoque engolia o lançamento

Pior do que a lista dizia. A data era checada dentro de `saida()`, item a
item, e `baixaMultipla` **descartava o resultado de cada item**: a baixa
voltava `{ok:true, n:0}`, o modal fechava com "Baixa de 0 material(is) ·
R$ 0,00" e nada era gravado. Erro que sai como mensagem de sucesso é pior
que erro.

Agora a data é validada uma vez, antes, e qualquer item que falhe vira
mensagem de erro em vez de sumir. E amanhã também é futuro: o movimento
de estoque é do dia em que aconteceu, então a janela fecha em hoje.

## Despesa prevista nascia "já lançada"

A previsão cria um título com status `previsto`, e o cálculo do realizado
contava essa própria parcela. Uma previsão nova de R$ 999 aparecia com
"já lançado R$ 999,00" e "ainda previsto R$ 0,00": a tela se anulava
sozinha, e a regra "o lançamento real substitui a previsão" passava a
valer contra a própria previsão.

Realizado passou a ser título de verdade — fora o que a previsão gerou e
fora o que ainda está em `previsto`. E o título previsto deixou de zerar o
resíduo, porque ele **é** a previsão, não o realizado.

## Conciliação: o nome era calculado e não usado

A correção do v39 levou o valor à igualdade exata, mas `temNome` olhava
apenas `l.contraparte`, que fica vazia quando o histórico não traz
marcador (REM:, DES:). Aí caía na regra do "nenhum outro pagamento igual"
e virava certeza: duas linhas de mercearia e de posto de gasolina, ambas
de R$ 3.750,00, entravam como vínculo concreto no pagamento da Advocacia.

O texto limpo do histórico passou a servir de nome quando não há
marcador: "PAGTO MERCEARIA DO ZE" já é nome suficiente para dizer que não
é a Advocacia. Sem nome legível nenhum, a certeza exige unicidade **e**
data a até dois dias — nove dias de diferença não sustentam certeza.

O candidato não é mais descartado quando o nome não bate: o nome decide a
CERTEZA, não a existência. Sumir com ele jogaria a linha para "sem
vínculo" e esconderia justamente a lista que ajuda a escolher.

## Miudezas da lista

Margem negativa ganhou cor e a nota "repasse acima do faturamento" — em
texto preto no meio de 36 linhas ninguém via. O "Ja lancado" do cabeçalho
foi o último resquício de acento. `receberBaixa` passou a checar o perfil
antes de procurar o título, senão um perfil de consulta recebia "título
não encontrado" e ainda descobria se o id existe. E a autoria com id
chegou a pagamentos, contas a receber e previsões, que gravavam só o nome
ou nada.

---

# v39 — a regressão que eu mesmo introduzi

## Nomes de função acentuados em ui-previsoes.js

A correção de acentos do v38 foi feita com substituição cega de texto
sobre um arquivo `.js`. Ela acertou os rótulos da tela e, junto,
acentuou **nomes de função**: `S.residuoPrevisão`,
`S.realizadoDaPrevisão`, `S.salvarPrevisãoDespesa`. O store exporta os
três sem til, então a tela de Previsões abria vazia, "Salvar previsões" e
"Confirmar mês" não faziam nada — e sem isso o contas a receber não é
alimentado — e o "Incluir" das despesas previstas morria junto.

Corrigido, e com uma verificação que deveria ter existido antes: uma
varredura que confere, em todos os módulos, se cada `S.*`, `D.*` e `U.*`
chamado existe de fato na origem. Zero pendências nos sete arquivos.

A lição vale registrar: texto de tela e identificador de código moram no
mesmo arquivo, e substituição global não distingue os dois.

## Conciliação: o ramo de pagamentos próprios não conferia o nome

Efeito colateral da correção do v35. O ramo das parcelas checava nome e
valor; o dos pagamentos checava só valor, e com a folga de um centavo
usada para arredondamento. Resultado: "PIX ENVIADO DRA MARINA ALVES" de
R$ 3.750,10 casava, como **vínculo concreto**, com um pagamento de
R$ 3.750,00 da Advocacia Ribeiro & Sá.

Duas correções. O valor passou a ter de ser igual, não "perto" — a folga
de centavo existe para cálculo, não para escolher credor. E o nome passou
a contar, como no outro ramo: se o extrato traz favorecido legível e ele
não bate, o pagamento sai da lista quando há outro candidato do mesmo
valor. Quando o extrato não traz nome — "PAGAMENTO ELETRONICO COBRANCA" —
o vínculo só é certeza se nenhum outro pagamento igual estiver na
disputa; havendo dois, ambos descem para "possíveis" e alguém decide.

## P-03 completo

O v36 pôs o id do usuário no evento de auditoria, mas `criado_por`,
`aprovado_por` e `cancelado_por` continuavam guardando só o nome. Agora
guardam o id ao lado.

---

# v38 — os médios restantes e parte do acabamento

## M-02 · O "DRE por competência" não era um DRE

Começava no grupo 2 e terminava em "Total de saídas por competência":
sem receita, sem margem, sem resultado. Quem lesse o rodapé achava que
aquele total era o resultado do mês.

Agora é um demonstrativo de verdade — receita bruta das notas emitidas,
menos retenções, receita líquida, custos diretos, margem de contribuição,
despesas por grupo e resultado operacional.

Duas linhas estavam dentro do resultado e não pertencem a ele. Retirada
de sócio é distribuição de lucro; e a parcela de empréstimo é, em boa
parte, amortização de dívida — despesa ali é o juro. Como o sistema não
separa principal de juro dentro de 9.02, o grupo desceu para baixo da
linha, num bloco "Movimentações que não são resultado", e a tela pede que
o juro seja lançado em 9.03 ou 9.04.

## M-03 e B-08 · Margem de 100% não é margem boa

Era projeto sem custo lançado — treze de quinze. Agora escreve "sem custo
lançado" em vez de inventar um número, a coluna passou a se chamar
**margem de contribuição** (é o que a conta mede: não há rateio de
estrutura), e margem e resultado negativos vêm destacados.

## M-04 · "Exportar Excel" era CSV raspado da tela

O do contas a pagar passou a sair do **dado**: todo o filtro, não só a
página visível, com centro de custo, natureza, competência e CNPJ — que
não são colunas da tela —, valores como número e uma linha por rateio
quando a parcela é dividida. As demais exportações continuam raspando a
tela, mas a raspagem melhorou: descarta a coluna do checkbox e a de
botões, tira o badge colado no vencimento, converte "R$ 12.400,00" em
número e grava com BOM, senão o Excel do Windows quebra o acento. Os
botões deixaram de se chamar "Excel", porque o arquivo é CSV — o do fluxo
de caixa, que é .xlsx de verdade, manteve o nome.

## M-07 · KPI morto

O lançamento nasce aprovado por decisão de projeto, então "Aguardando
aprovação" marcava zero para sempre e o botão de aprovar em lote ficava na
tela sem uso. Os dois somem quando não há nada pendente e reaparecem
sozinhos se a auto-aprovação for desligada.

## M-08 · Credor e centro de custo não se editavam

A tela dizia "o rateio se edita pelo lançamento original" e esse caminho
não existia. Reclassificar centro é rotina de fechamento. A edição agora
tem fornecedor e rateio, com validação de 100% e as duas mudanças no
histórico.

## M-09 · Chave PIX divergente passava em silêncio

Reimportar o fechamento com CNPJ ou chave trocados não sobrescrevia o
cadastro (certo) e também não avisava — o repasse sairia na chave antiga
sem ninguém saber. Divergência agora é diferente de campo vazio: o
sistema lista o que diverge, mostra o valor do cadastro ao lado do valor
do arquivo e deixa escolher qual vale, item a item.

## M-11 · Data de movimento de estoque

Consumo em 31/12/2027 entrava sem aviso. Data no futuro é recusada, e
também data anterior ao último inventário do armazém — o inventário é a
contagem física que encerra a discussão, e lançar antes dele reescreve um
saldo já conferido.

## M-12 · Dizia FIFO, calculava custo médio

O cálculo sempre foi médio ponderado móvel, que é o método correto e o que
foi decidido. Só os rótulos estavam errados, em três lugares. Corrigidos.

## B-09 · Vencido de mês passado entrava no saldo como pago

07 e 08/2026 apareciam com saída prevista já descontada do saldo
acumulado. O dinheiro vai sair, mas de hoje em diante: o que venceu e não
foi pago passou a ser trazido para o mês corrente, com o total atrasado
declarado acima da tabela. A cauda de meses vazios até 2027 também foi
cortada.

## B-11 · Entrada do extrato não virava receita

Para saída havia "Lançar como despesa"; para entrada, só "Buscar título" e
"Ignorar" — então um crédito sem nota correspondente não tinha caminho e
ficava pendente para sempre. Agora há "Lançar como receita", para
reembolso, resgate de aplicação, aporte ou estorno de fornecedor: nasce
recebido, na data do extrato, e concilia a linha.

## B-01, B-04 e B-12

Acentos na tela de despesas previstas. Dois arquivos que o index carregava
em duplicidade (`exceljs.min.js` e `exportar-fluxo.js`). O valor do
estoque já aparecia desde o v30, para quem tem permissão de ver custo.

---

# v37 — os três médios que bloqueiam a operação

## M-05 · A remessa enviada não tinha volta

O arquivo saía, a parcela ficava em "enviado" e travada por "já tem
pagamento em andamento". `liquidar` e `devolverParaRemessa` existiam no
motor desde sempre — o que faltava era botão. E o retorno do banco nem
sempre chega: quando não chega, não havia caminho nenhum.

Dentro de cada remessa, todo item ainda aguardando ganhou **Confirmar
pagamento** (baixa pela data do arquivo, para quem confere pelo
comprovante) e **Não foi pago**, que devolve o pagamento para a fila da
próxima remessa pedindo o motivo, que vai para o histórico da parcela. No
rodapé, "Confirmar todos os enviados" para o caso normal, em que o lote
inteiro saiu.

`devolverParaRemessa` também ganhou a guarda de permissão e a checagem de
situação que lhe faltavam.

## M-06 · O total do título não acompanhava a edição

Editar uma parcela de 333,33 para 500,00 deixava as parcelas somando
1.166,67 e o título ainda dizendo 1.000,00 — dois números para a mesma
dívida, e cada relatório escolhia o que estivesse mais à mão.

O total deixou de ser um campo guardado e passou a ser derivado da soma
das parcelas vivas, recalculado na edição e no cancelamento. Testado:
1.000,00 → 1.166,67 ao editar, → 833,33 ao cancelar a terceira.

## M-10 e B-13 · O motor detectava, a tela não mostrava

Eram o mesmo problema. `ERP.boleto.ler()` devolve "dígito verificador
errado" corretamente, mas a mensagem só aparecia se o campo disparasse
`change` — o leitor de código de barras dispara, quem digita ou cola pode
nunca sair do campo. Agora também lê no `input`, com respiro de 350 ms, e
só reclama quando já há 44 dígitos, para não acusar erro a cada tecla.

E a mensagem deixou de morar só no rodapé. `ERP.app.erroCampo(id, msg)`
marca o campo em vermelho e escreve o texto embaixo dele, até a pessoa
mexer ali de novo — o toast some sozinho em cinco segundos e não diz onde
foi o problema. O helper está disponível para as demais validações.

---

# v36 — o resto do risco alto da auditoria

O v35 fechou cinco dos oito itens de risco alto. Este fecha os três que
faltavam, e corrige uma omissão minha.

## A remessa não tinha guarda — e eu tinha descartado o aviso

`registrarRemessa` gravava sem checar permissão nenhuma. Na varredura do
v35 eu a coloquei na lista de falsos positivos e não abri a função. É o
arquivo que o banco executa: qualquer perfil registrava a remessa. Agora
exige a mesma permissão de quem autoriza pagamento.

## A trava de competência valia só no lançamento

Com o mês fechado, criar em 08/2026 era recusado, mas `editarParcela`
movia uma parcela de 10/2026 para 07/2026 e reabria o mês por dentro — o
que anula o fechamento como controle. A trava passou a valer nos dois
sentidos: nem tirar de um mês fechado, nem jogar para dentro dele.

## Aprovar compra era aprovar quantidade, não dinheiro

A requisição não tem valor digitado, por decisão de projeto — quem cota é
o comprador. Só que a diretoria dizia sim para "300 caixas" sem saber se
são mil ou cem mil reais.

O sistema passou a estimar pelo custo médio do armazém, com o último custo
do cadastro como alternativa, dizendo na tela que é estimativa e quais
itens ficaram sem base. A confirmação de aprovação mostra o número antes
do clique. E a alçada por valor, que existia só no contas a pagar, passou
a valer aqui: na aprovação contra a estimativa, no envio do pedido contra
o preço cotado — que é onde o compromisso com o fornecedor realmente
nasce.

## Trilha de auditoria

Entrada de material avulsa, exclusão de previsão, criação e exclusão de
regra de conciliação e os seis cadastros (centro, produto, armazém,
credor, cliente, e as edições) passaram a registrar evento. Cadastros são
gravados direto pela tela, sem passar por função de domínio — enquanto for
assim, ao menos deixam rastro.

O evento agora guarda o **id** do usuário, não só o nome. Gravar apenas
"Ana (assistente financeiro)" quebra a rastreabilidade no dia em que
alguém renomeia o cadastro ou muda de perfil.

---

# v35 — sete achados de auditoria

Todos confirmados no código antes da correção. Nenhum era falso positivo.

## Conciliação pagava o mês errado

`candidatos()` filtrava pagamento por `enviado`, `autorizado` e
`aguardando` — **`liquidado` ficava de fora**. Quem dá baixa manual antes
de importar o extrato torna o pagamento invisível ali, e esse é o caso
comum, não o raro. A saída de R$ 14.800 do aluguel caía em "sem vínculo" e
o buscador oferecia, em primeiro lugar, a parcela de outubro: mesmo credor,
mesmo valor. Um clique quitava o mês seguinte com o dinheiro deste mês.

Agora `liquidado` entra, e a linha já conciliada contra aquele pagamento
não é oferecida de novo. Parcela que vence em outra competência nunca é
certeza, desce na ordenação, aparece marcada e pede confirmação explícita
ao vincular — conta recorrente tem parcela igual todo mês, e ordenar por
proximidade de valor punha a errada em primeiro lugar.

No segundo bloco não havia **nenhuma** checagem de valor: bastava o nome
bater. Por isso R$ 38.720,15 aparecia ao lado de uma parcela de
R$ 19.360,00, com botão de vincular em lote do lado. A diferença passou a
ter teto de 2%; acima disso não é candidato.

## Baixa de recebimento não validava nada

`d.valor || r.valor_liquido` tratava zero como campo vazio e gravava o
valor cheio. Fechado, junto com o resto: título quitado recusa nova baixa,
recebimento acima do saldo é recusado com o saldo no texto, data futura e
data anterior à emissão são recusadas, competência fechada trava.

Recebimento parcial deixou de ser gambiarra — soma as baixas e só fecha
quando cobre o líquido, com a opção de encerrar declarando a glosa. E
existe estorno, da última baixa ou de todas.

## Fluxo de compras morria na aprovação

"Enviar pedido" chamava a mudança de status sem fornecedor, o store
recusava (com razão) e a tela caía no editor da **requisição**, que por
decisão de projeto não tem campo de fornecedor nem de preço. Beco sem
saída: nenhuma requisição chegava a "Aguardando entrega", e por isso o
recebimento e o vínculo com a entrada de estoque nunca aconteciam.

Faltava a etapa do pedido, que agora existe: o comprador escolhe o
fornecedor que cotou, põe o preço de cada item, o frete e a previsão de
entrega.

## Quinze gravadores sem checagem de permissão

Não eram 14. Entrada e saída de estoque, exclusão de contrato, criação de
conta a receber, todas as previsões e as regras de conciliação gravavam sem
chamar `pode()`. Por isso o perfil "Contabilidade (consulta)" mudava custo
médio e apagava contrato. Todos fechados, e a exclusão de contrato passou a
deixar rastro. O arquivo foi reauditado: nenhuma função que grava ficou sem
guarda.

## O desvio de faturamento não existia

Duas causas somadas. O realizado somava **todos** os títulos do projeto e
competência — inclusive o próprio título previsto criado pela previsão
confirmada, que assim se comparava consigo mesma. E somava o líquido contra
um previsto que é digitado bruto, de modo que o "desvio" era exatamente o
imposto retido na fonte.

Agora conta só nota emitida (origem `nota`, fora canceladas e
substituídas), devolve bruto e líquido separados, e a tela compara bruto
com bruto mostrando o líquido embaixo.

## Desempenho: o problema não era o volume

`daParcela` varria a lista inteira de pagamentos a cada consulta de saldo,
e a tela chama saldo e caixa uma vez por linha. Com 6.240 parcelas são
dezenas de milhões de comparações por render. Índice por parcela,
reconstruído só quando a lista muda ou há estorno: **112 ms → 10 ms** na
medição com 3.120 pagamentos.

A busca era outra coisa. O filtro em si sempre levou 3 ms; os 764 ms eram o
redesenho das 6.240 linhas a cada tecla. Resolvido por paginação de 300
linhas — os totais continuam somando tudo que o filtro pegou — e debounce
de 160 ms no campo de texto.

---

# v34 — três datas no movimento de estoque, e a validade do lote digitável

## As três datas

Cada uma responde a uma pergunta diferente, e antes havia só uma:

- **Data da NF** — quando o fornecedor emitiu. Vem da nota e não se
  inventa: sem nota, fica vazia. No lançamento aparece bloqueada.
- **Data da entrada** — quando o material entrou no armazém. Começa igual
  à da nota e pode ser corrigida, porque a mercadoria chega depois da
  emissão. É esta que vale para o custo médio e para o saldo.
- **Data do lançamento** — quando isto foi registrado no sistema. É
  carimbo, não campo: ninguém digita, ninguém altera, e não aparece no
  lançamento. É o que permite explicar, semanas depois, por que o saldo
  de uma data passada mudou.

No extrato as três aparecem lado a lado, e a linha em que o lançamento não
é do dia da entrada vem marcada como retroativa. Saída e distribuição
também passaram a carimbar a data de lançamento. O extrato ganhou botão de
exportar, com as três datas, o lote e a validade.

## O campo de validade perdia o foco no primeiro dígito do ano

Digitando 2027, o campo saía no "2". A causa: o `change` de um
`<input type="date">` dispara assim que a data fica válida, e o navegador
monta uma data completa já no primeiro dígito do ano. O gravador de estado
redesenhava a lista inteira nesse evento, o elemento era trocado, o foco ia
embora e os outros três dígitos não tinham onde entrar — parecia que a
digitação começava no último dígito.

Agora campo de texto e de data só guardam o valor e atualizam o total; quem
redesenha é apenas o select de material, que precisa disso para a tira de
sugestão e não sofre do problema.

**O mesmo defeito existia nas parcelas do contas a pagar**, no campo de
vencimento, pela mesma razão — o `change` ali chamava o redesenho da lista
de parcelas. Corrigido junto: a soma do rodapé é atualizada sozinha.

---

# v33 — a leitura de PDF conferida contra quatro emissores

O v32 acertou uma nota. Com três notas novas (GLC, RMB e STALO, de
emissores diferentes), apareceu o que ainda estava amarrado ao layout de
uma só.

**Rótulo e valor ficam em faixas diferentes, e isso vale para mais de um
campo.** A leitura por coluna que o v32 fez para o valor total virou uma
função (`porColuna`) e passou a servir também para a data de emissão — que
vinha errada em duas notas, caindo no dia 01 do mês tirado da chave, porque
o texto entre "Data emissão" e a data é o nome do destinatário e o CNPJ
dele. O rótulo do total também ganhou as abreviações que os emissores usam:
"V. TOTAL DA NOTA" não era reconhecido, e a nota da GLC dava zero.

**A linha do item varia em três detalhes, e cada um derrubava um emissor:**

- CST/CSOSN pode vir como `0/102` e não só como `010`;
- CFOP às vezes sai pontuado — `6.102` em vez de `6102`;
- a unidade pode vir colada na quantidade — `UN160,00`.

**Cabeçalho do quadro entrava como descrição do material.** Reconhecê-lo
pelo primeiro rótulo não funciona, porque cada emissor quebra a faixa de
títulos num lugar diferente e sobram linhas como "PRODUTO UNIT TOTAL DESC
ICMS ICMS IPI". Agora a detecção é por densidade: linha em que metade ou
mais dos tokens são rótulos do quadro é cabeçalho.

**Coluna estreita quebra a descrição no meio da palavra, sem hífen.** A
STALO imprime "QUADRO BRANCO FORMICA L" / "ISA ALUMINIO A 300 X 12" /
"0 CM MDF 9". Juntar com espaço estraga; juntar sem espaço estragaria quem
quebra entre palavras. O sinal é o pedaço na emenda: letra ou dígito
sozinho só aparece porque a palavra foi cortada ali — pontuação solta,
não, senão "LEDS -" mais "COM ESTROBO" se emendaria errado.

**Endereço do emitente** passou a ser procurado só dentro do quadro dele,
entre o DANFE e o DESTINATÁRIO: fora dali havia dois endereços que
enganavam, o do destinatário e o que alguns repetem no recibo do topo.
Município e UF agora saem em maiúsculas ou minúsculas e com "-" ou "/".

**Venda lida como compra.** O outro CNPJ da nota virou o destinatário, e
com isso a checagem que importa numa entrada de estoque: nota em que a
empresa é o emitente é venda, e dar entrada nela lançaria como entrada o
material que saiu. Depende de o CNPJ da empresa estar cadastrado —
hoje é o de exemplo.

## Medida ausente também pesa na similaridade

"Quadro 300x120" e "Quadro 200x120" têm o mesmo texto e uma medida em
comum: empatavam em 100% e a escolha entre os dois voltava a ser sorte.
Agora a medida que falta no candidato desconta. O quadro certo da STALO
fica em 100% e o vizinho cai para 81%.

## Resultado nas quatro notas

| Nota | Chave | Emissão | Valor | Item |
|---|---|---|---|---|
| CONNECT | ok | 12/11/2025 | 1.975,74 | cordão paralelo, 12 UN, 133,86 |
| GLC | ok | 16/12/2025 | 22.879,99 | cordão LED, 240 UN, 95,3333 |
| RMB | ok | 13/03/2026 | 3.825,28 | grama sintética, 160 UN, 23,76 |
| STALO | ok | 15/01/2026 | 16.796,70 | quadro branco, 37 UN, 453,9649 |

Descrição completa nas quatro, e a duplicata da STALO (001, 16/01/2026,
R$ 16.796,70) lida junto.

---

# v32 — a leitura de PDF estava sem chão

O defeito era um só, e explicava todos os sintomas de uma vez: a extração
do texto juntava os fragmentos do pdf.js com espaço, produzindo **uma única
linha gigante por página**. Sem linha não existe quadro de produtos, não
existe linha de item e não existe "o nome logo acima do CNPJ". Todas as
heurísticas de layout ficavam sem chão e devolviam o que achavam solto no
meio do texto — daí a natureza da operação ter virado razão social.

Cada fragmento do pdf.js traz a sua posição. Agrupando por y com tolerância
tirada da altura da fonte, e ordenando por x dentro do grupo, a linha do
papel volta a existir. Vão grande entre fragmentos vira separação de coluna.
Isso arrumou quatro coisas:

**Razão social.** Agora sai do recibo do transportador, no alto de todo
DANFE, que traz a razão social inteira entre dois textos fixos — layout
padronizado, não chute. E a natureza da operação passou a ser rejeitada
explicitamente: "VENDA DE…", "REMESSA…", "DEVOLUÇÃO…" nunca são nome de
empresa. Na nota de teste: CONNECT CABOS INDUSTRIA E COMERCIO DE FIOS E
CABOS LTDA.

**Chave de acesso.** A busca anterior varria o texto corrido e a gulodice do
quantificador engolia os números vizinhos, devolvendo cadeias com mais de 44
dígitos que o filtro descartava — a chave estava impressa e era perdida.
Agora é a linha cujos dígitos somam exatamente 44. Com ela vêm número,
série, CNPJ, UF e modelo estruturados, e o rótulo virou "chave lida".

**Valor total.** Dava zero, e o motivo é instrutivo: o rótulo fica numa
faixa e o número na faixa de baixo, alinhado à direita da coluna. Procurar
"o primeiro número depois do rótulo" pegava o começo da linha de números,
que é o frete — zero nesta nota. Agora a busca é na coluna do rótulo, pelo x
do fragmento. Lê R$ 1.975,74.

**Itens.** A descrição pode estar acima E abaixo da linha numérica: este
emissor imprime "CORDÃO PARALELO NEWPRIME" em cima e "300/300V 2 X 1,00 MM²
- BR 100 MTS" embaixo — e é embaixo que está a medida, justamente o que
distingue o material do vizinho. A coleta agora vai para os dois lados, nas
duas variantes de quebra de linha.

Resultado contra o PDF da nota de teste: NPEPL02.02, descrição completa,
NCM 85444900, CFOP 6401, UN, 12, R$ 133,86, R$ 1.606,32. A sugestão pelo PDF
acerta o material certo com 100% e deixa o vizinho de 2,50 mm² em 47%.

Também passou a sair do PDF o endereço, CEP, município, UF e telefone do
emitente, e as informações complementares — que é onde eventuais dados
bancários estariam.

O PDF continua sem EAN e sem CEST, que só existem no XML. Então material
cadastrado a partir de PDF nasce sem o identificador que dispensaria palpite
na nota seguinte: quando houver XML, o XML continua sendo o caminho.

---

# v31 — a nota sugere o vínculo, e o cadastro sai da própria nota

## O problema: a nota fala a língua do fornecedor

"CORDAO PARALELO NEWPRIME 300/300V 2 X 1,00 MM - BR 100 MTS" nunca vai ser
igual ao "Cabo paralelo 2x1,00mm²" do cadastro da casa. O casamento antigo
comparava a primeira palavra da descrição e desistia — na prática, todo item
caía como não casado, e a alternativa era caçar o material na lista de
todos.

Novo módulo **`js/sugestao.js`**, puro, com três regras:

- identificador exato (EAN, código do fornecedor, código interno) vale mais
  que qualquer semelhança de texto e entra como certeza, não palpite;
- palavra genérica não pontua. CABO, CAIXA, LTDA, COMERCIO, HOSPITALAR
  aparecem em meio cadastro e casariam qualquer coisa com qualquer coisa;
- número com unidade é o que separa um material do vizinho. 1,00 mm² e
  2,50 mm² são quase o mesmo texto e são produtos diferentes, então medida
  igual dá bônus e medida conflitante desconta.

Na nota de teste (Connect Cabos), com dois cabos parecidos no cadastro, o
resultado foi 100% para o cordão certo e 47% para os dois vizinhos de
2,50 mm² e unidade diferente.

## Na tela: aceitar, trocar ou cadastrar

Cada linha da entrada mostra o que veio na nota (descrição, código, EAN,
NCM) e em que estado o vínculo está: casado por identificador, sugestão com
o percentual e o motivo, ou sem nada parecido. Os outros candidatos viram
botão — trocar é um clique.

Sugestão acima de 60% entra preenchida e marcada como sugestão; abaixo
disso a linha fica vazia de propósito, porque palpite ruim aceito no
automático é pior que campo em branco. O aviso do topo separa o que veio
por código do que veio por semelhança.

**Cadastrar este material** abre o cadastro preenchido com a nota: descrição,
unidade, NCM, CEST, EAN, código no fornecedor e custo unitário, com o código
interno já sugerido na sequência da casa. Guardar o EAN e o código do
fornecedor é o que faz a próxima nota casar por identificador em vez de
palpite.

## O mesmo para o fornecedor

CNPJ igual é certeza; nome parecido é sugestão com percentual; não existir é
um botão, não um recado mandando cadastrar em outra tela e voltar.
**Cadastrar pelos dados da nota** traz razão social, CNPJ, fantasia, IE,
endereço, município, UF e telefone do emitente.

## Dados bancários: o que a nota realmente tem

O layout da NF-e **não tem campo para a conta do fornecedor**. O que existe
é a forma de pagamento (`tPag`) em campo próprio e, quando o emitente
resolve escrever, o texto livre das informações complementares. Então o
módulo faz duas coisas distintas:

- `tPag` vira sugestão de forma de pagamento (16 → TED, 15 → boleto,
  17 e 20 → PIX). A nota de teste traz 16, depósito bancário;
- banco, agência, conta e chave PIX são procurados no texto livre, e o que
  sair vai para a tela marcado como lido de texto solto, para conferência.
  Nunca gravado calado.

Na nota anexada não há nada disso — o complemento só tem tributo aproximado
e número do pedido. A tela diz isso em vez de deixar os campos vazios sem
explicação.

## Entrada pelo PDF

O `danfe.js` já lia cabeçalho, chave e valor do PDF. Agora lê também o
quadro de produtos, ancorado na assinatura da linha do item — código, NCM de
8 dígitos, CST, CFOP, unidade e os números — e não em posição na página.
Cobre as duas formas em que os emissores quebram a linha: descrição acima do
código e tudo numa linha só. Testado contra o PDF da nota anexada: item,
quantidade, unitário e total corretos.

Continua sendo heurística e entra marcado assim. E o PDF não traz EAN, então
o vínculo do material pelo PDF só pode ser por descrição — por isso, quando
existe XML, o XML é o caminho melhor.

---

# v30 — setores dentro do armazém do hospital

## O material desce do almoxarifado para quem consome

O estoque era plano: um armazém por unidade, e ponto. Mas o hospital
recebe a compra num almoxarifado e de lá distribui para oftalmologia,
centro cirúrgico, ambulatório. Sem esse nível, ou o consumo do setor não
existia, ou cada setor virava um armazém solto, sem relação com a casa.

Agora o armazém tem **pai**. Setor é armazém filho: saldo próprio, custo
médio próprio, mas herda o projeto do pai — é assim que o consumo do setor
chega ao DRE no centro certo. Um nível só, de propósito: setor de setor
viraria uma árvore que ninguém confere no fim do mês.

Semeados no HGB (Bonsucesso), a título de exemplo: almoxarifado do hospital
com Oftalmologia, Centro cirúrgico e Ambulatório abaixo dele.

## A casa inteira, e a quebra por setor

O seletor do topo passou a mostrar a hierarquia, com os setores indentados
sob o armazém, e ganhou a opção **"principal e setores"**. Nela a posição
vem com uma linha por material: total da casa, quanto está parado no
almoxarifado e uma coluna por setor.

O mínimo é conferido contra o total da casa. Setor zerado com material
sobrando no almoxarifado é caso de distribuir, não de comprar — antes essa
distinção não existia, e a tela pedia compra dos dois jeitos.

O extrato, na visão da casa, junta almoxarifado e setores: a distribuição
interna aparece como as duas pontas que ela é.

## Distribuir

Botão **"Distribuir para setor"** na visão da casa. Origem travada no
almoxarifado, destino só entre os setores dele. Por baixo é a transferência
de sempre — o material sai pelo custo médio da origem e entra no destino
com esse custo, muda de lugar e não de valor. A trava recusa distribuir de
um armazém para o setor de outro hospital.

No cadastro de armazéns há o campo "Setor de". Setor sem projeto herda o do
pai automaticamente.

---

# v29 — o vínculo da nota com a previsão passa a ser conferido

## Nada mais é substituído sozinho

A nota chegava e apagava a previsão do mês na hora, sem ninguém olhar. O
único jeito de dizer "isso foi parcial" era ter marcado a previsão como
parcial *antes*, na tela de Previsões — decisão tomada semanas antes de
saber o que o hospital ia faturar.

Agora, quando a nota bate com uma previsão do mesmo projeto e competência,
o par vira um **vínculo a conferir**. A aba Contas a receber abre com o
painel dos pendentes, mostrando previsto contra faturado e a diferença, e
três saídas por linha:

- **Substitui o mês** — a previsão sai de cena, como era antes.
- **Faturamento parcial** — a previsão encolhe pelo que a nota cobriu e
  continua valendo pelo resíduo. Se não sobrar nada, vira substituída.
- **Não tem relação** — nota de outro serviço no mesmo mês; a previsão
  volta a valer inteira, ao lado dela.

Quem confirmou e quando fica na trilha de auditoria. A importação de notas
avisa quantos vínculos ficaram esperando.

## Enquanto pende, ninguém conta duas vezes

A previsão em conferência sai das somas: o número que vale é o da nota, que
é o fato. Ela continua visível na lista, com etiqueta própria.

Para isso valer em todo lugar, a pergunta "este título ainda é dinheiro a
entrar?" virou uma função só, `receberAberto`. Cinco telas respondiam isso
por conta própria com `status !== 'recebido'` — e por isso somavam também
previsão substituída e previsão cancelada. O vazamento não era só da aba
Faturamento (corrigida no v28): estava no contador do menu, no previsto do
fluxo de caixa exportado e no DRE por competência.

---

# v28 — a previsão substituída sumindo da lista do Faturamento

A substituição sempre funcionou: quando a nota chega, o título previsto
daquele projeto e competência vira `substituido` no contas a receber. Quem
mostrava errado era a lista "Contas a receber" **dentro da aba
Faturamento**, com dois defeitos somados:

- lia `contasReceber()` (tudo) em vez de `listarReceber()` (que já tira
  substituído e cancelado), então a previsão trocada continuava na tela ao
  lado da nota real;
- a etiqueta de situação estava fixa: qualquer coisa que não fosse
  "recebido" saía como **faturado**. Previsão e previsão substituída
  apareciam com a mesma cara de nota emitida.

O efeito não era só visual. O total de **A receber** no topo do bloco somava
tudo que não estivesse recebido, previsão substituída incluída — contando o
mesmo faturamento duas vezes. Num teste com um projeto do AGIR em 08/2026,
R$ 676.020,35 no lugar de R$ 342.183,14.

A aba Contas a receber (Financeiro) sempre mostrou certo; a divergência
entre as duas telas era o sintoma.

---

# v27 — aba de produtividade só com o que encosta no extrato

## O recorte deixou de ser por status e passou a ser por relação

No v26 a aba listava todo fechamento de produtividade lançado. Com dezenas
de fechamentos por mês, a tela virava um arquivo — e ainda trazia os quatro
fechamentos da base de simulação (FECH-GHC-08, FECH-HMMQ-08 e o retroativo
de julho), que nunca encostaram em extrato nenhum.

Agora o fechamento só aparece se tiver relação com o extrato importado:

- alguma linha **identificada ou sugerida** para um dos médicos, ou
- alguma linha **já conciliada** contra uma parcela daquele fechamento.

A segunda condição é o que mantém o bloco na tela depois de resolvido: sem
ela, o fechamento sumiria no instante em que você termina de conciliar, que
é justamente quando se quer conferir o resultado. Dentro do bloco nada muda
— os não pagos continuam vindo primeiro, e os médicos do fechamento que
ainda não saíram no extrato continuam listados, porque a pergunta ali é
quem falta.

## Exportar um fechamento por vez

Cada bloco ganhou **"Exportar este fechamento"**, com o nome do arquivo
tirado do número do fechamento (`produtividade-fech-anestesia-2026-08.csv`).
O botão do topo virou "Exportar todos os N" e continua saindo em arquivo
único. A ordem é a mesma nos dois: não pagos, depois os identificados,
depois os pagos.

---

# v26 — nome do favorecido linha a linha, tarifa fora do empréstimo e produtividade completa

## O nome cortado estava sendo perdido, não só encurtado

A leitura do OFX exigia que o favorecido terminasse sem dígito. Como o
Bradesco corta o nome e às vezes deixa um resto colado — "WALERIA EMMILLY
PINHE 1", "DANIELA GOMES DE SOUZ 2" — essas linhas ficavam **sem
contraparte nenhuma**. Era a raiz de dois problemas ao mesmo tempo: elas
caíam em "sem vínculo" e o lote não tinha nome nenhum para usar.

Agora o nome sai inteiro, sem a nomenclatura do banco e sem a data do fim:
"PIX ENVIADO DES: WALERIA EMMILLY PINHE 1" vira "WALERIA EMMILLY PINHE 1".

## Lote em "sem vínculo": cada linha com o seu nome

O lote copiava a descrição e o fornecedor da primeira linha para todas. No
relatório isso aparecia como uma médica recebendo trinta transferências e as
outras nenhuma.

O modal ganhou a opção **"Cada linha com o seu nome"**, marcada por padrão:
descrição e fornecedor saem do favorecido de cada linha do extrato, e quem
não está cadastrado é cadastrado na hora. Natureza e centro de custo
continuam valendo para todas — é só o nome que deixa de ser copiado.

Uma prévia mostra o nome que cada título vai levar antes de mandar, para o
lote não ser cego. Desmarcando a caixa, voltam os campos únicos de descrição
e fornecedor — que é o certo para as tarifas, e por isso ali a caixa já vem
desmarcada.

## Tarifa deixa de virar parcela de empréstimo

O sistema procurava um credor que *contivesse* "Bradesco" no nome e achava
"Banco Bradesco — empréstimo". A busca virou exata, e "Banco Bradesco" e
"Banco Santander" entraram no cadastro como credores próprios, natureza
9.01. Tarifa e empréstimo não se misturam mais no plano de contas.

## Produtividade: pago e não pago, com relatório

A aba só listava fechamento com parcela em aberto e ainda descartava o grupo
sem nenhum identificado — ou seja, o fechamento sumia justamente depois de
conciliado. Agora todo fechamento aparece, com três situações por médico:

- **não pago** — o repasse ainda não saiu;
- **saiu no extrato** — a linha foi identificada, falta conciliar;
- **pago** — com a data do pagamento.

Os não pagos vêm primeiro, os pagos no fim, e o cabeçalho traz quantos e
quanto de cada lado. O botão **Exportar relatório** gera o CSV na mesma
ordem: não pagos, depois os identificados, depois os pagos.

---

# v25 — nome cortado no extrato e lote em todas as abas

## Nome truncado não derruba mais o vínculo

O extrato corta o favorecido no meio ("DANIELA GOMES DE SOUZ"). Antes isso
baixava a semelhança e jogava a linha para "possíveis". Agora uma palavra
conta como casada se o texto termina num pedaço dela com quatro letras ou
mais — é ali que a linha foi cortada.

E a régua ficou como você pediu: **valor exato + duas palavras do nome
batendo, sendo uma distintiva, é vínculo concreto**. No extrato real do
Bradesco os concretos passaram de 2 para 29, quase todos repasses de médicos
com o nome cortado.

Uma trava acompanha isso: se duas linhas do extrato apontam para o mesmo
título, nenhuma das duas é tratada como certa — as duas descem para
"possíveis". Dois créditos iguais no mesmo título seria pagar duas vezes.

## Lote em todas as abas

- **Concretos** — autorizar em lote (já tinha) e agora ignorar em lote.
- **Possíveis** — ganhou caixa de seleção, "marcar todos", coluna
  "melhor candidato" com a diferença de valor, e o botão "Vincular N ao
  melhor candidato". Quem quiser conferir os outros candidatos ainda clica
  em Escolher.
- **Sem vínculo** — lançar em lote (já tinha) e ignorar em lote com motivo.

A coluna do melhor candidato existe para o lote não ser cego: você vê o que
vai ser vinculado antes de mandar.

---

# v24 — conciliação em três grupos, regras aprendidas e produtividade agrupada

## Conciliação bancária, refeita

A tela agora abre em seis abas com contador: **Vínculos concretos**,
**Vínculos possíveis**, **Sem vínculo**, **Produtividade**, **Regras** e
**Já conciliados**.

- **Concretos** — o sistema tem certeza (pagamento que saiu daqui com valor
  exato, ou linha coberta por regra). Marca e autoriza tudo de uma vez.
- **Possíveis** — há candidatos; você escolhe um a um.
- **Sem vínculo** — lançar como despesa (individual ou em lote), buscar o
  título na lista completa, ou ignorar com motivo.

## Régua diferente por lado

Na **entrada**, valor aproximado continua ajudando: a lista de contas a
receber é curta. Na **saída**, o casamento por valor aproximado foi
removido — com centenas de títulos ele casa qualquer coisa. Saída só entra
por pagamento nosso, por regra aprendida, ou por nome de favorecido batendo
com o credor, e o nome exige duas palavras em comum sendo uma distintiva
(sobrenomes como SILVA e SANTOS não contam sozinhos).

Resultado: o PIX para Rodrigo Dias Braga não é mais oferecido como
empréstimo do Bradesco — vai para "sem vínculo", que é a verdade.

## Regras aprendidas

Ao lançar uma linha, o campo "Lembrar disso" guarda a lógica: da próxima vez
que "JOSE ANTONIO DA SILVA" aparecer no extrato, o sistema já sugere
honorários contábeis como vínculo concreto. A aba Regras lista tudo com
contagem de usos.

## Tarifas em lote

Botão "Marcar as N tarifas" seleciona todas de uma vez; um único lançamento
cria os N títulos, cada um na sua data, já pagos e conciliados. Teste real:
15 tarifas do Bradesco, R$ 45,44, num clique.

## Produtividade agrupada

Cada fechamento aparece como um bloco: quantos médicos, quantos já saíram no
extrato, quanto foi identificado contra o total, e a lista nome a nome com
quem falta. Botão "Conciliar os N identificados" resolve o bloco inteiro.
Teste real com o fechamento de anestesia: 41 médicos, 29 identificados
(R$ 309.750,00 de R$ 454.652,99), 12 faltando nomeados.

## Importador de produtividade

Aceita o layout em blocos por médico, além da tabela plana. A aba é achada
pelo conteúdo, não pelo nome — pode se chamar ANESTESIA, CLINICA ou o que
for; o que importa é ter Setor/Entrada/Saída. Período com hífen
("15/07/2026 - 14/08/2026") passou a ser aceito, e a coluna inicial é
detectada sozinha.

Os médicos que não existem no cadastro entram automaticamente com CRM,
CPF/CNPJ e chave PIX vindos da aba financeira. Teste real: 41 médicos
cadastrados de uma vez, soma batendo com a aba FINANCEIRO no centavo.

---

# Versões do protótipo

A pasta e o arquivo .zip mudam de número a cada entrega, para nada ser
salvo por cima. Sempre baixe a maior versão.

| Versão | O que entrou |
|---|---|
| v1 | Contas a pagar em tela única, dados em memória |
| v2 | Módulos separados, plano de contas do DRE, parcelamento, rateio, aprovação, remessa CNAB 240 Bradesco, retorno, produtividade, faturamento, contas a receber, previsões, cadastros |
| **v3** | Cadastros com matriz e filiais separadas dos projetos, fornecedores e médicos em abas próprias, médico criado e atualizado pela importação de produtividade, cadastro de fornecedor direto no lançamento de NF |

| **v4** | Módulo de Contratos: vigência, valor mensal por linha de projeto, aditivos, alerta de vencimento e de reajuste (45 dias antes e quando atrasa), cadastro de cliente e projeto de dentro do contrato, linhas que abrem para baixo |

| **v5** | Módulos de Estoque (materiais por projeto, saída pela farmácia, alerta de reposição) e Compras (requisição do alerta, aprovação, pedido, recebimento parcial); alerta de reajuste de contrato com 45 dias |

| **v6** | Estoque por armazém com custo FIFO por camadas, baixa de vários materiais num movimento, transferência entre armazéns, inventário inicial, entrada por XML/PDF/manual com escolha do armazém; requisição de compra sem fornecedor e sem valor, com tela de conferência das quantidades |

| **v7** | Custo médio ponderado móvel no lugar do FIFO; abas de Produtos e Armazéns em Cadastros (com ativação); entrada de material que gera o contas a pagar e baixa o pedido no mesmo ato |

| **v8** | Cadastros com menu agrupado por assunto (estrutura, receita, compras e estoque, equipe médica), tudo visível com contador de registros |

| **v9** | Módulo de Administração: usuários e perfis, matriz de permissões, alçada por valor, "quem solicita não aprova", anexo obrigatório, fechamento de competência, faixa do sequencial de remessa e trilha de auditoria com filtros |

| **v10** | Perfis de acesso configuráveis: 13 permissões granulares, módulos visíveis por perfil, permissão "ver valores e custos" que esconde dinheiro de quem só movimenta material, e perfis "Controle de estoque" e "Compras" prontos |

| **v11** | Exportação do fluxo de caixa em Excel no formato da planilha da empresa: sete abas, saldo acumulado, previsto partindo do realizado e DRE mensal por linha de projeto |

| **v12** | Correções: fornecedor cadastrado em Cadastros passa a aparecer na hora no lançamento; documento repetido no cadastro rápido reaproveita o cadastro existente em vez de recusar; modal deixa de fechar quando a seleção de texto termina fora dele |

| **v13** | Financeiro dividido em "A pagar" e "A receber", com "Sem anexo" como lembrete à direita; intervalo do lançamento com pagamento único (padrão), semanal e datas livres; sequencial da remessa volta a incrementar |

| **v14** | Exportação do fluxo refeita com ExcelJS: fórmulas de verdade (Pagar? recalcula saída efetiva e saldo), SUMIFS no resumo, formatação completa e as previsões por projeto entrando no fluxo |

| **v15** | Ciclo da previsão (estimada, confirmada, encerrada) com substituição pelo resíduo em vez de all-or-nothing; aba de despesas previstas para o contas a pagar, com cópia do mês anterior |

| **v16** | Substituição da previsão pelo real volta a ser integral por padrão, com marcação opcional de "parcial" por linha (receita e despesa); confirmado que a substituição é por linha de projeto, não por hospital |

| **v17** | Previsão confirmada vira título "previsto" no contas a receber, com quatro situações (previsto, faturado, recebido, substituído), filtro e observação de origem; despesas previstas movidas para o lado A pagar |

| **v18** | Despesa prevista recorrente: repetir por 3, 6, 12 ou 24 meses em série, com replicação do valor para os meses seguintes e exclusão da série a partir de um mês |

| **v19** | Despesa prevista passa a gerar título "Previsto" no contas a pagar (não selecionável, não pagável), substituído quando o título real é lançado; filtro "Só previstos"; correção da lista de contas que não se atualizava ao voltar de outra aba |

| **v20** | Editar a previsão já confirmada passa a atualizar o título do contas a receber e o fluxo; coluna "No fluxo" mostrando o valor que está no caixa e sua origem |

| **v21** | Botão "Efetivar" no título previsto: recebe fornecedor, valor real, vencimento e código de barras (com leitor USB) e vira título comum, pronto para pagamento e remessa, com a diferença em relação ao previsto no aviso |

| **v22** | Fornecedor opcional na despesa prevista (coluna deixa de ficar vazia no contas a pagar) e modal de efetivação adaptado à forma de pagamento: código de barras só para boleto e guia, chave PIX ou CPF/CNPJ para os demais |

| **v23** | Conciliação bancária: leitor de OFX conferido com extrato real do Bradesco, importação com anti-duplicidade por FITID, sugestões pontuadas por valor/data/nome, vínculo com pagamento, título ou recebimento, lançamento de linha não prevista e "ignorar" com motivo |

| **v24** | Conciliação em seis abas com contador, régua diferente por lado, regras aprendidas por contraparte, tarifas em lote e produtividade agrupada por fechamento |

| **v25** | Nome cortado no extrato deixa de derrubar o vínculo, trava contra duas linhas apontando para o mesmo título, e seleção em lote nas três abas |

| **v26** | Favorecido preservado quando o extrato deixa um resto numérico; lote com descrição e fornecedor por linha (natureza e centro compartilhados) e prévia antes de mandar; tarifa deixa de cair no credor do empréstimo; aba de produtividade mostra pagos e não pagos, com exportação |

| **v27** | Aba de produtividade limitada aos fechamentos que encostam no extrato (identificados, sugeridos ou já conciliados) e exportação de um fechamento por vez |

| **v28** | Lista de contas a receber da aba Faturamento passa a esconder previsão substituída e a mostrar a situação real de cada título; total de "A receber" deixa de contar o mesmo faturamento duas vezes |

| **v29** | Substituição da previsão pela nota deixa de ser automática: painel de conferência com as opções de substituir o mês, faturamento parcial com resíduo ou recusar o vínculo; previsão em conferência fora das somas; predicado único de "a receber" corrigindo o vazamento no contador, no fluxo exportado e no DRE |

| **v30** | Armazém com setores internos: distribuição do almoxarifado para os setores, saldo e custo médio por setor, visão consolidada da casa com quebra por setor e extrato unificado |

| **v31** | Módulo de similaridade para casar item e fornecedor da nota com o cadastro, com aceitar/trocar/cadastrar na própria tela de entrada; cadastro de produto e de fornecedor pelos dados da NF; leitura dos itens do DANFE em PDF; forma de pagamento pelo tPag e tentativa de dados bancários no texto livre |

| **v32** | Leitura de PDF reconstruída por geometria (linhas e colunas): razão social pelo recibo do DANFE, chave de acesso encontrada, valor total pela coluna do rótulo, itens com descrição completa, e endereço/telefone/complemento do emitente |

| **v33** | Leitura de PDF conferida contra quatro emissores: data de emissão pela coluna do rótulo, abreviações do total, CST/CSOSN e CFOP pontuado na linha do item, unidade colada na quantidade, cabeçalho do quadro detectado por densidade, descrição quebrada no meio da palavra remontada, endereço restrito ao quadro do emitente e alerta de nota de saída; similaridade desconta medida ausente |

| **v34** | Data da NF, data da entrada e data do lançamento no sistema separadas no movimento de estoque, com as três no extrato e exportação; campo de data deixa de perder o foco ao digitar o ano, no estoque e nas parcelas do contas a pagar |

| **v35** | Auditoria: conciliação enxerga pagamento liquidado e recusa candidato fora de valor ou de competência; baixa de recebimento validada, com parcial e estorno; etapa de pedido de compra criada; 15 gravadores ganham checagem de permissão; desvio de faturamento passa a comparar bruto com bruto e só notas emitidas; índice de pagamentos e paginação no contas a pagar |

| **v36** | Remessa bancária ganha checagem de permissão; trava de competência passa a valer na edição de parcela; valor estimado e alçada por valor nas compras; trilha de auditoria em estoque, previsões, regras e cadastros, com id do usuário no evento |

| **v37** | Remessa enviada ganha confirmação e devolução na própria tela; total do título passa a ser derivado da soma das parcelas; erro de validação passa a marcar o campo, e o código de barras inválido avisa ao digitar |

| **v38** | DRE de verdade, com receita, margem e resultado, e retiradas e amortização abaixo da linha; margem sem custo deixa de virar 100%; exportação do contas a pagar sai do dado; credor e rateio editáveis; divergência de PIX avisada na importação; data de movimento de estoque validada; vencido não conta como pago no fluxo; entrada do extrato vira receita |

| **v39** | Corrige a regressão dos nomes de função acentuados em ui-previsoes.js, com varredura de chamadas em todos os módulos; conciliação passa a exigir valor igual e nome compatível também no ramo de pagamentos próprios; id do usuário nos campos criado_por, aprovado_por e cancelado_por |

| **v40** | Baixa de estoque deixa de sumir em silêncio com data fora da janela; despesa prevista deixa de se anular sozinha; conciliação passa a usar o histórico como nome do favorecido e exige data próxima quando não há nome; margem negativa destacada, autoria com id em pagamentos, recebimentos e previsões |

| **v41** | Antecipação de pagamento e de recebimento deixa de perder a certeza por distância de data; parcela de outra competência só é rejeitada quando há concorrente do mesmo valor no mês do extrato; a data passa a ordenar e explicar em vez de excluir |

Próxima entrega: **v42**. Cada .zip gerado sobe um número, mesmo que a
mudança seja pequena.
