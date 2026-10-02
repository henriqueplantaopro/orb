# Envio de RPS ao web service de Barueri

O ERP gera o arquivo de RPS (Faturamento › RPS em lote). Este utilitário
envia esse arquivo à prefeitura pelo web service oficial, acompanha o
processamento e baixa o retorno.

Ele roda na máquina que tem o certificado digital — não precisa de
servidor. Quando o ERP for para a nuvem, o arquivo `barueri-ws.js` vai
junto sem mudança: ele é o núcleo, e só muda quem o chama.

## Antes de começar

1. Node.js instalado (versão 18 ou mais nova).
2. Certificado **A1** (arquivo `.pfx`) do CNPJ da empresa. O manual
   aceita A3, mas A1 é o que funciona sem token plugado.
3. `copiar config.exemplo.json → config.json` e preencher caminho do
   certificado, senha, inscrição municipal e CNPJ.

O `config.json` guarda a senha: deixe fora de pasta sincronizada
(OneDrive, Drive) e fora de qualquer repositório.

## A ordem segura de testar

```
node enviar-rps.js envelope rps-2026-08-001.txt     # vê o XML, sem enviar
node enviar-rps.js validar  rps-2026-08-001.txt     # homologação
node enviar-rps.js validar  rps-2026-08-001.txt --producao   # confere o layout sem gerar nota
node enviar-rps.js enviar   rps-2026-08-001.txt --producao   # gera as NF-e
```

`validar` usa o `ApenasValidaArq` da prefeitura: ela confere o arquivo
inteiro e responde as críticas **sem emitir nada**. É o teste que evita
nota errada.

Outros comandos:

```
node enviar-rps.js status  PROTOCOLO
node enviar-rps.js listar  2026-09-25 [TODAS|-2|-1|0|1|2]
node enviar-rps.js baixar  NOME_DO_ARQUIVO_DE_RETORNO
```

Cada execução grava uma linha em `envios.log` (arquivo, ambiente,
protocolo, situação) e os retornos ficam em `retornos/`.

## Perguntas para a contabilidade (antes do primeiro envio)

O arquivo carrega códigos fiscais que ficam em `js/dados.js`, no
cadastro da empresa (`empresa.rps`). Preenchi com valores plausíveis
para serviços médicos, mas são justamente os que a prefeitura recusa
primeiro. O que perguntar:

1. Qual o **código do serviço** que a empresa usa hoje nas notas de
   Barueri (aparece em qualquer NF-e já emitida).
2. Qual a **alíquota de ISS** e se o ISS é retido pelo tomador.
3. Com a reforma tributária: **código NBS**, **indicador de operação**,
   **classificação tributária** e **situação tributária** do IBS/CBS.
4. Confirmar que a empresa é **não optante do Simples Nacional**.

O caminho mais curto para os itens 1 e 2: abrir uma NF-e recente
emitida pela empresa em Barueri — o código do serviço e a alíquota
estão impressos nela.

## O que esperar

O processamento é assíncrono. O programa envia, recebe o protocolo e
fica consultando até a prefeitura terminar. Situações:

| código | significado |
| --- | --- |
| -2 | aguardando processamento |
| -1 | em processamento |
| 0 | arquivo validado (só validação) |
| 1 | arquivo importado — NF-e geradas |
| 2 | arquivo com erros — o retorno é a crítica |

Depois de `1`, abra o retorno, pegue os números das NF-e e informe no
ERP (Faturamento › RPS em lote › Informar NF-e). É ali que os títulos
nascem no contas a receber com o número real da nota.

## Limites conhecidos

- O endereço e a assinatura dos métodos foram conferidos na própria
  página do serviço (`wsrps.asmx`), que está no ar. O que **não** foi
  testado é o envio real com certificado — isso depende do A1 de vocês
  e tem que começar em homologação.
- Reenviar um lote com a mesma identificação de remessa é recusado. O
  ERP numera a remessa por data + sequência, então gere um arquivo novo
  em vez de reenviar o antigo.
- O web service informa a situação dos LOTES, não das notas. Cancelar
  nota continua sendo pelo portal ou por um lote de cancelamento
  (registro tipo 2 com situação "C").
- Prazo legal: o RPS precisa virar NF-e em até 10 dias corridos,
  limitado ao 3º dia útil do mês seguinte.
