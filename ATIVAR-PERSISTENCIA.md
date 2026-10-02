# Ligar a gravação no banco

A partir desta versão o sistema grava o movimento — títulos,
parcelas, pagamentos, recebíveis, previsões, retenções e
conciliação. Falta um passo no banco.

## 1. Rodar o SQL novo

No SQL Editor do Supabase, cole e rode:

```
supabase/06-persistencia.sql
```

Ele acrescenta uma coluna `extra` às tabelas de movimento. Alguns
registros carregam campos que o esquema não previu — o anexo de uma
nota, o código de barras de um boleto, o motivo de um cancelamento.
O que se consulta, filtra ou soma tem coluna de verdade; o resto vai
nessa coluna, em JSON, para nada se perder.

**Conferência:**

```sql
select count(*) from information_schema.columns
 where table_name = 'parcelas' and column_name = 'extra';
-- esperado: 1
```

## 2. Testar

Abra o sistema, entre, e lance um título a pagar qualquer.
**Recarregue a página.** O título tem de continuar lá.

Melhor ainda: abra o Supabase, Table Editor › titulos. O
lançamento aparece na tabela.

## Como saber que está gravando

A etiqueta no topo da tela diz **"conectado ao banco"**. Se disser
que os dados não são guardados, a persistência não subiu.

Se uma gravação falhar, aparece um aviso em vermelho dizendo que o
lançamento está na tela mas não foi gravado. Não é alarme falso:
quando isso aparece, o dado ainda não está salvo, e fechar a aba o
perde. O sistema também avisa ao tentar fechar a aba com algo
pendente.

## O que muda no dia a dia

O que uma pessoa lança passa a existir para as outras. Isso é o
ponto, e traz uma consequência: **não há mais "testar à vontade"**.
O que for lançado fica.

Se quiser um espaço para treinar sem sujar, o caminho é um segundo
projeto no Supabase com os mesmos SQL — me peça que eu preparo.

## O que ainda não grava

Estoque, procedimentos, folha, compras e ativos. Vêm em seguida, na
mesma mecânica. Até lá, esses módulos continuam só na tela.
