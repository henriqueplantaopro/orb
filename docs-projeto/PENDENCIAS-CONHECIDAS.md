# Pendências conhecidas — leia antes de auditar

> **v30:** a auditoria externa do v11 está respondida em
> `RESPOSTA-AUDITORIA.md`. Os 13 críticos e parte dos altos foram
> corrigidos; o que falta está listado lá, não aqui.

Este é um protótipo funcional que roda **em arquivo local, no
navegador**. Os itens abaixo já foram identificados e têm decisão
tomada: são limitações conscientes do estágio atual, não defeitos por
descobrir. Reportá-los de novo não acrescenta.

O que **não** está nesta lista é jogo aberto: qualquer outro erro de
cálculo, regra de negócio furada, inconsistência de estado ou validação
faltando é bem-vindo.

---

## 1. Depende de servidor (sai na migração para Supabase/Vercel)

| Item | Situação hoje |
| --- | --- |
| **Persistência** | Nada é salvo: recarregar a página volta ao exemplo inicial. O estado vive em memória. |
| **Envio da NF-e ao portal de Barueri** | O arquivo de RPS é gerado pelo sistema e o utilitário `envio-rps/` fala com o web service por SOAP com certificado A1 — mas roda fora do navegador, disparado à mão. O núcleo (`barueri-ws.js`) já está separado para ir ao servidor sem reescrita. |
| **Certificado digital A1** | Não instalado; o primeiro envio real precisa ser em homologação. |
| **E-mail automático** | Cotação a fornecedor, aviso de pagamento e envio de relatório montam a mensagem para envio manual. Sem servidor, não há como disparar. |
| **Página pública de chamado (QR Code)** | A etiqueta com QR já é gerada e o código aponta para a URL do chamado, mas a página em si não existe: depende de hospedagem e de RLS. |
| **Anexos de verdade** | Foto, NF, manual e laudo no ativo e na OS dependem de Storage. Hoje há só o campo. |
| **Login do cliente/hospital** | Abrir chamado e ver laudos pelo próprio hospital. |
| **API / webhook** | Integração com PlantãoPro e MedPay. |
| **App mobile / PWA offline** | Inventário no hospital sem rede. |
| **RLS, 2FA e backup** | Adiados por decisão: validar primeiro a aceitação operacional. |
| **Assinatura eletrônica no laudo da OS** | O PDF já é gerado pelo sistema; a assinatura ICP é outra etapa. |

## 1b. Multiempresa — o que falta desta etapa
O cadastro das três empresas, a amarração com contas e centros, o filtro
por empresa e a conta corrente entre empresas estão prontos. Falta:
- **remessa CNAB de Santander e Itaú**: decidido NÃO implementar — o
  volume por essas contas é baixo e o pagamento continua pelo portal do
  banco. A conciliação é por OFX, que já funciona nas três contas. Os
  manuais oficiais foram localizados caso a decisão mude (Itaú SISPAG
  CNAB 085; Santander Pagamento a Fornecedores 11.6).
- **emissão fiscal por CNPJ**: cada empresa tem inscrição municipal,
  certificado e numeração de RPS próprios, e a filial CE emite em outro
  município. Fica para a etapa da nuvem.
- **rateio de despesa comum entre CNPJs** (aluguel, contabilidade): hoje
  o rateio é só por centro de custo.

## 1c. Procedimentos do mutirão — o que falta confirmar
- **Plantão × PegaPlantão**: resolvido. O fechamento do PegaPlantão do
  pj50 prevalece sobre a estimativa assim que é importado; a
  estimativa vira conferência. Nada a fazer.
- **Valor e duração do plantão** (R$ 1.000 / 6 horas) estão em
  Administração.
- **Imposto**: resolvido na v15. A alíquota do mutirão é **9,04%**
  (ISS 2 + PIS/COFINS 3,65 + IRPJ 2,2 + CSLL 1,19) e vem do **cadastro
  do projeto** — fonte única, usada por Procedimentos, pelo resultado
  do faturamento e pela montagem do RPS. Edita-se em Cadastros ›
  projeto › impostos, ou pela tela de Administração, que escreve no
  mesmo lugar.
- **Materiais**: os dez itens cirúrgicos e o estoque das seis salas do
  HGB foram criados para o módulo ter o que consumir. Substituir pelo
  cadastro e pelo inventário reais de cada sala.
- **Outras unidades**: o vínculo sala ↔ especialidade mora no cadastro
  do armazém (campo `especialidade`), então abrir mutirão em outro
  hospital é cadastrar as salas de lá — não mexe em código.
- **Cliente do faturamento**: a receita sai como "GHC — HGB". Conferir
  se é esse o tomador da nota do mutirão.

## 1d. Cadastro que falta — a filial CE sai zerada e duas contas partem de zero

**Saldo inicial das contas novas.** O Santander da filial CE (b3) e o
Itaú da Novaped (b4) não têm `saldo_inicial` nem `saldo_inicial_em`,
então partem de zero e o caixa do grupo nasce subestimado. É cadastro:
basta informar o saldo de cada conta numa data, pela tela de Saldo
bancário.

### A empresa de cada projeto

Só um centro tem `empresa: 'emp2'`. Os demais projetos de Fortaleza
não têm empresa definida e caem na matriz por padrão, então a linha da
filial aparece com receita, despesa e resultado zerados na apuração
por empresa.

Não dá para deduzir pela unidade: estar em Fortaleza não quer dizer
que o contrato é da filial. Precisa da lista de quais projetos são de
cada CNPJ — depois disso é só marcar o campo no cadastro.

## 2. Depende de decisão de terceiros

- **Parâmetros fiscais do RPS** (código do serviço, NBS, indicador de
  operação, classificação e situação tributária do IBS/CBS): estão
  preenchidos com uma sugestão para serviços médicos, editáveis em
  Administração › Parâmetros fiscais. O definitivo vem da contabilidade
  e de uma NF-e já emitida pela empresa.
- **Lei 12.506 (aviso prévio)**: se os dias que passam de 30 devem ser
  indenizados mesmo com aviso trabalhado. Há entendimento do TST nesse
  sentido, mas mudar sem a palavra da contabilidade alteraria rescisões
  já conferidas.
- **Convenção de dias na folha do mês com férias**: o sistema paga
  pelos dias de CALENDÁRIO trabalhados (férias de 05 a 31 num mês de 31
  dias → 4 dias de salário). A convenção comercial pura daria 3
  (30 − 27). Confirmar qual delas o escritório usa — o INSS do mês
  acompanha a escolha.
- **Conta da venda de imobilizado**: passou a ser a 1.04 "Alienação de
  imobilizado", não operacional. Confirmar o tratamento no Lucro
  Presumido (ganho de capital) e se a contabilidade quer subconta
  própria.
- **FGTS sobre a dobra das férias vencidas**: o INSS já ficou de fora
  (Lei 8.212, art. 28 §9º "d"), mas o FGTS segue incidindo sobre o valor
  pago, que é o entendimento mais comum. Confirmar com a contabilidade.

## 3. Decisões de produto (não são bugs)

- **Travamento de competência**: deliberadamente ausente — o sócio
  manda contas de meses anteriores para lançar.
- **Segregação de funções em compras**: existe como parâmetro, mas vem
  **desligada** por padrão, porque a equipe é pequena.
- **Anexo não é obrigatório** no lançamento; existe a lista de
  lançamentos sem NF para cobrança posterior.
- **Paciente é opcional** na baixa de estoque.
- **ISS fora do arquivo de RPS**: o registro 3 do layout de Barueri só
  tem código para tributos federais. O ISS do cadastro do cliente vale
  para o líquido do contas a receber, mas não vai no arquivo — lá a
  retenção decorre do código do serviço e do tomador.
- **Alerta de recebimento vencido** abre a lista inteira de atrasados,
  não só os de mais de 30 dias.
- **Calibração, laudo metrológico e analisadores de hardware**: fora de
  escopo por decisão (é produto de terceiros); o que existe é o
  acompanhamento da validade do laudo.

## 4. Onde procurar, se for auditar

- `teste-fumaca.js` — 1311 verificações automatizadas; rode com
  `node teste-fumaca.js` e veja o que falha.
- `VERSAO.md` — histórico versão a versão, com o motivo de cada
  decisão.
- `envio-rps/LEIA-ME.md` — o que falta para emitir NF-e de verdade.
