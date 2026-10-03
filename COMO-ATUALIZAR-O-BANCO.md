# Atualizar o banco — um arquivo só

Em vez de rodar sete arquivos na ordem, cole o
`supabase/ATUALIZAR-TUDO.sql` inteiro no SQL Editor do Supabase e
rode uma vez.

**Pode rodar de novo sem medo.** Tudo nele é idempotente: colunas
com `if not exists`, funções com `create or replace`, visões
recriadas, e os `update` só tocam o que está nulo. Se você não
souber se já rodou alguma parte, rode o arquivo inteiro.

## O que ele faz

| Etapa | O quê |
|---|---|
| 06 | Colunas `extra` nas tabelas do financeiro |
| 07 | Reserva de ids em bloco — a carga deixa de levar 15 segundos |
| 08 | Hierarquia do plano de contas — o combo de natureza volta a ter contas |
| 09 | Senha provisória com troca obrigatória |
| 10 | Colunas `extra` nos demais módulos + especialidade da sala cirúrgica |
| 11 | Visões completas — leitura sem expor o nome do paciente |
| 12 | Gravação atômica do estoque + limpeza do resíduo de teste |

## Depois de rodar

```sql
select * from verificar_instalacao() where resultado <> 'ok';
```

Nenhuma linha = tudo certo.

## O que ele NÃO faz, de propósito

Não recria a estrutura (01), as políticas de acesso (02), os
cadastros (03) nem as permissões de coluna (04). Essas já rodaram e
estão funcionando; recriá-las sem necessidade mexeria no que está
de pé.

Os arquivos individuais continuam na pasta, caso você precise
conferir ou rodar um isolado.

## A única coisa que ele apaga

Dois `delete`, os dois sobre resíduo de teste das rodadas de
auditoria: posições de estoque zeradas e camadas sem movimento
nenhum. Nenhum dado seu é tocado.
