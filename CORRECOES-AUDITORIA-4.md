# Quarta auditoria — as quatro

## 1. O `minimal` era ignorado pelo cliente

Você achou a causa exata: no supabase-js v2 a opção `returning`
dentro de `upsert()` foi removida e é ignorada em silêncio.

Agora o `Prefer: return=minimal` vai no **cliente**, na criação,
onde vale para toda escrita. Confirmado no teste: o header chega
como `{"Prefer":"return=minimal"}`.

## 2. A fila travada — a mais grave

Você tem razão de que isto preocupa mais que o header. Eu fiz o
limite de tentativas desligar a persistência inteira: abrir o
inventário uma vez parava o financeiro de gravar até recarregar, e
sem aviso.

Agora o limite vale **por coleção**. A que desiste entra em
`degradadas`, o cartão do módulo mostra "sem gravar", e as outras
continuam.

Testado: provoquei 7 falhas seguidas no estoque — `degradadas()`
devolve `['estoque','estoqueMov']`, a persistência fica ligada, o
cartão avisa, e um título lançado depois gravou normalmente.

## 3. A aba presa

O `beforeunload` só avisa enquanto ainda há chance de gravar. Se a
coleção desistiu, as diferenças nunca zerariam, e o aviso virava
uma aba impossível de recarregar. Preso é pior que avisado.

## 4. O estoque não abria

As posições vindas do banco eram hidratadas só com `{saldo,
valor}` — `produto` e `armazem` ficavam só na chave. O `sort`
estourava e o filtro por armazém não pegava.

Corrigido na hidratação: os dois campos vão dentro do objeto
também.

## A sua ressalva sobre a atomicidade: aceita, e resolvida no banco

Você está certo — "se a regra é que a origem tem que ir junto,
camadas e movimentos deveriam cair ou subir no mesmo bloco". A
versão anterior protegia a posição e deixava camadas órfãs.

Isso não se resolve no cliente: três chamadas HTTP são três
transações, e a segunda pode falhar depois de a primeira ter
gravado. Agora há uma função no banco, `gravar_estoque`, que recebe
camadas, movimentos e posições e grava **numa transação só**.
Qualquer erro desfaz o bloco inteiro.

A função roda com privilégio para poder escrever na coluna
`paciente`, revogada — mas confere `tem_nivel('estoque','M')`
antes: não é contorno da matriz, é acesso à coluna.

**Rode o `supabase/12-estoque-atomico.sql`.** Ele cria a função e
limpa o resíduo: as posições zeradas e as camadas órfãs das rodadas
anteriores.

## Para a próxima

Com o estoque abrindo e gravando atômico, a passada que ficou
pendente três vezes fica viável: baixa de material, requisição,
procedimento com material e OS, cada um com reload e conferência de
saldo. E, com procedimento no banco, finalmente o mascaramento do
paciente.
