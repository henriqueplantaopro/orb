# Briefing para auditoria — ERP Dom Pedro (ERP teste2 - v25)

Quarta rodada. As três anteriores encontraram, somadas, 106 defeitos:
37 na primeira (13 críticos e 24 altos), 53 na segunda (26 na parte 1,
financeiro e consistência de estado; 27 na parte 2, estoque,
procedimentos, compras e pessoal) e 29 na terceira. **Todos foram
corrigidos**, e as correções estão nesta versão.

O pedido agora é auditar o arquivo inteiro de novo, com três ênfases:

1. **Regressões das correções.** É de longe o achado mais valioso das
   rodadas anteriores. Na segunda, dois achados eram regressões; na
   terceira, **quatro dos cinco críticos** eram correções minhas que
   pegaram metade do problema — o pior deles consertou o bloqueio
   indevido de pagamento com juros e criou um bloqueio total de
   pagamento com desconto. Guarda local que resolve um caso e cria
   outro é o padrão a caçar.
2. **O que as rodadas cobriram pouco**: as telas (quase toda a
   auditoria até aqui foi de store), faturamento (esteira, RPS,
   importação de NFS-e por XML), e o módulo de DP fora de folha e
   rescisão.
3. **A bateria e as varreduras.** Elas também são auditáveis, e já
   erraram: quatro testes davam cobertura aparente a caminhos que não
   rodavam, e a varredura de permissões antiga cobria 14 funções em 2
   perfis — foi por isso que uma função de escrita passou meses sem
   guarda nenhuma.

Leia este documento inteiro antes de começar. A seção **"Decisões
deliberadas"** existe para você não gastar o relatório em coisas que
já foram decididas.

---

## 1. Como rodar

```
ERP teste2 - v25/
├── index.html               ← abrir direto no navegador, sem servidor
├── css/erp.css
├── js/                      ← toda a lógica
├── teste-fumaca.js          ← 1195 verificações
├── varredura-permissoes.js  ← 32 funções de escrita × 11 perfis
├── varredura-duplicatas.js  ← função definida duas vezes = erro
├── varredura-formato.js     ← número e data fora do padrão = erro
├── PENDENCIAS-CONHECIDAS.md
├── RESPOSTA-AUDITORIA.md    ← o que foi corrigido da 1ª auditoria
├── VERSAO.md                ← histórico, da versão mais recente para trás
├── docs/ e exemplos-ofx/
```

Ponto de partida, tudo limpo:

- `node teste-fumaca.js` → 1195 OK, nenhuma falha.
- `node varredura-permissoes.js` → nenhum caso inconclusivo; confira
  se algum perfil passa onde a matriz não concede.
- `node varredura-duplicatas.js` → nenhuma função duplicada.
- `node varredura-formato.js` → formatação uniforme.

**Persistência não existe.** Recarregar volta ao estado inicial. É
intencional e não deve ser reportado.

---

## 2. Arquitetura

- `js/store.js` — toda a lógica de negócio e o estado.
- `js/dados.js` — cadastros e dados de exemplo.
- `js/ui-*.js` — uma tela por módulo. **A UI não deve conter regra de
  negócio.** Regra que vive só na tela é achado válido e importante:
  foi o padrão mais recorrente das três rodadas.
- Sem framework, sem build, sem dependência externa.

**Princípio:** toda trava precisa existir no store. Teste chamando as
funções direto (`ERP.store.x(...)`) além de clicar na tela.

---

## 3. Perfis e a matriz de acesso

Matriz **perfil × módulo**, três níveis: **V** (vê), **M** (movimenta),
**$** (vê e mexe em valor).

| Usuário | Perfil | Para testar |
| --- | --- | --- |
| Márcia (u2) | diretoria | acesso amplo |
| Dayana (u1) | assistente | vê procedimentos com valor, **não lança** |
| Monique (u6) | estoquista | lança procedimento **sem ver dinheiro** |
| Operacional HGB (u13) | operacional | só procedimentos e estoque |
| Contabilidade (u4) | consulta | vê valor, não movimenta |
| Administrador (u5) | admin | tudo |

O meio-caminho é onde moram os defeitos: perfil que tem `lancar` e não
tem `cancelar`. A `varredura-permissoes.js` já roda os 11 perfis, com
uma conferência de sanidade (se o admin também é recusado, o caso não
testa permissão e sai como INCONCLUSIVO). Vale estendê-la com funções
que ela ainda não cobre.

---

## 4. Decisões deliberadas — NÃO reportar como defeito

### 4.1 Formato de número e data
**Número é sempre 00.000,00** (ponto no milhar, vírgula no decimal,
duas casas, inclusive em valor redondo e em zero) e **data é sempre
dd/mm/aaaa** (com hora, dd/mm/aaaa HH:MM; competência, mm/aaaa).
Use `U.brl`, `U.num`, `U.pct`, `U.fData`, `U.fDataHora`, `U.fComp`.

Reportar, sim: qualquer lugar que escape disso. A
`varredura-formato.js` pega os casos mecânicos; o que ela não pega é
formatação construída dinamicamente.

Exceções legítimas: ISO em `<input type="date">`, em data-attributes
e em nome de arquivo; `toFixed` nas coordenadas do PDF; as máscaras do
Excel (`#,##0.00` e `dd/mm/yyyy`).

### 4.2 Um médico por cirurgia
O campo `medico` é texto único e a chave do plantão é data + médico.
**A cirurgia tem um responsável, sempre.** O sistema recusa quando
encontra sinal de dois nomes (`/`, `+`, `&`, `;`, ` COM `, ` AUX `,
` E DR `), e orienta a lançar um procedimento por médico, cada um com
o seu repasse.

O " E " solto e a vírgula **não** contam: "João de Paula e Silva" e
"Silva Junior, João Carlos" são nomes únicos. Reportar falso positivo
é bem-vindo; "deveria ser lista" não.

### 4.3 Material de outro armazém do mesmo hospital
O operador pode consumir material sem saldo na sala, desde que exista
na mesma unidade: o sistema transfere sozinho, registra e avisa de
onde veio. Só recusa se faltar no hospital inteiro.

Por quê: a cirurgia aconteceu e o material saiu. Travar empurra o
operador a não lançar nada, e aí se perde o custo.

Auditável aqui: custo da transferência, saldo fechando, rastro, e o
caso "falta no hospital inteiro".

### 4.4 Imposto retroativo
Mudar a alíquota recalcula tudo que já foi lançado. A alíquota vem do
**cadastro do projeto** — fonte única, usada por Procedimentos, pelo
resultado do faturamento e pelo RPS.

### 4.5 Plantão estimado
Procedimento sem repasse na tabela = médico pago por plantão. Até o
fechamento do PegaPlantão chegar, estima 1 plantão de 6h por médico e
por dia, rateado **proporcional ao faturamento**. Com o fechamento na
mão, o realizado prevalece.

### 4.6 Estoque em unidades
Toda entrada tem a quantidade da nota e as unidades por embalagem. Uma
caixa com 100 entra como 100 unidades, com o custo dividido.

### 4.7 Setor travado pela especialidade
Escolher a especialidade define o armazém e trava o campo.

### 4.8 Editar procedimento é substituição
Devolve o material, lança um novo corrigido e marca o antigo como
editado.

### 4.9 Multiempresa e conta corrente
Três CNPJs. A empresa **nunca é digitada**: vem da conta bancária ou
do centro de custo. O lançamento pergunta de quem é a nota ("Nota em
nome de"), sugerindo a empresa do projeto.

**Na baixa manual o sistema pergunta** antes de registrar o mútuo; **na
conciliação não pergunta** — o dinheiro já saiu do banco. Transferência
direta entre contas de empresas diferentes também gera mútuo, e o saldo
sai **compensado por par**.

### 4.10 Outras
- Duplicidade de documento avisa e pede confirmação, não bloqueia.
- Divergência de entrada contra o pedido é pergunta com motivo, não
  parede — e a confirmação fica no histórico do pedido.
- Transferência que deixa a conta negativa pergunta antes; não é
  bloqueio, porque limite usado existe.
- Remessa CNAB só Bradesco (decisão); conciliação por OFX nos três bancos.
- Diárias têm faturamento zero e não exigem paciente.
- O fechamento do mutirão (aba Fechamento) é o caminho único do
  faturamento para o financeiro.

---

## 5. Duas pendências em aberto, aguardando decisão do dono

Não são defeitos esquecidos; estão esperando resposta.

- **Requisição de compra pelo perfil operacional.** A matriz dá a ele
  só procedimentos e estoque, mas a ação `requisitar` é derivada de
  `['estoque','mover']`. Faz sentido que quem fica sem material peça
  compra. A inconsistência entre a matriz e a derivação é conhecida.
- **O ponto no leitor de NFS-e.** "104.700" é lido como R$ 104,70,
  correto pelo padrão ABRASF. Tratar ponto seguido de três dígitos
  como milhar resolveria o emissor fora do padrão e quebraria o
  emissor correto.

---

## 6. O que já foi corrigido

Detalhado em `RESPOSTA-AUDITORIA.md` e no `VERSAO.md` (v13 a v25).

Se encontrar algo dessas listas ainda aberto, **reporte com o script
que reproduz** — pode ser correção incompleta, e é exatamente o que
mais interessa.

Vale saber o que mudou por último, porque é o terreno mais fresco:
conservação de valor no estoque com tolerância de resíduo e
transferência movendo o valor exato; reconferência de saldo no
pagamento (desconto e juros); atomicidade de `entradaLote` e
`baixaMultipla`; INSS e IRRF incrementais por competência, incluindo
rescisão; `dataExiste` em todos os pontos de data; validação de
aditivos de contrato; e dez funções que passaram a normalizar
argumento nulo.

---

## 7. Onde concentrar o esforço

1. **Regressões** do que está no parágrafo acima.
2. **Telas.** Abrir o navegador e usar o sistema. Três rodadas quase
   inteiras foram de store, e "regra que mora só na tela" apareceu em
   todas elas. Os botões de desfazer conciliação, trocar linha,
   reabrir linha e cancelar transferência são novos e nunca foram
   auditados.
3. **Faturamento**: esteira (liberar, autorizar, desfazer), RPS em
   lote, NFS-e por XML (`js/nfse.js`), fatura de locação, cobertura.
4. **DP fora de folha e rescisão**: afastamentos, adiantamentos,
   pensão alimentícia, rubricas manuais, 13º em duas parcelas.
5. **Permissões**: estender a varredura às funções que ela ainda não
   cobre.

---

## 8. Como reportar

Igual às rodadas anteriores, que funcionaram bem:

- **Onde**: arquivo e função, ou a tela.
- **Como reproduzir**: script que roda em node e imprime o número
  errado. Foi isso que tornou os relatórios anteriores diretamente
  acionáveis.
- **O que esperava** e **o que aconteceu**, com números.
- **Gravidade**: crítico (dinheiro ou dado errado), alto (regra de
  negócio furada), médio (inconsistência), baixo (tela).
- Separe **defeitos** de **sugestões de produto**.
- Se algo deveria ser pego pela bateria e não é, diga. E se um teste
  da bateria estiver validando outra coisa, diga também — já
  aconteceu quatro vezes, e dois desses avisos vieram de você.
