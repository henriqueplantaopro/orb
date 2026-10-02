# Segunda auditoria — respostas

## O 42501: a recusa estava certa, o pedido é que estava errado

O hint do PostgREST sugere `GRANT SELECT ON procedimentos TO anon`.
**Não segui, e não se deve seguir.** Esse grant devolveria a coluna
`paciente` a quem não pode vê-la — o dado de saúde que a etapa 04
fechou por coluna. Seria calar o erro desfazendo a proteção.

A causa real: a aplicação lia com `select *` numa tabela com coluna
revogada. O banco recusa a requisição inteira, e está certo.

Corrigido onde era: `procedimentos` e `estoque_movimentos` passaram
a ser lidos pelas **visões**, que já mascaram conforme a permissão
de cada um. A escrita continua na tabela. As visões ganharam as
colunas que faltavam (`motivo_cancelamento`, `usuario_id`, `extra`,
`qtd_nota`, `data_nf`, `pedido_id`) — rode o
`supabase/11-visoes-completas.sql`.

Nenhum grant novo para `anon`.

## A defesa de projeto que você sugeriu: feita

Uma coleção que falha não derruba mais as outras. A carga continua,
a coleção problemática fica marcada como indisponível, e o sistema
grava os outros 24 módulos.

Testado com uma tabela recusando: persistência fica ligada,
`degradadas()` devolve `['estoqueMov']`, o lançamento no financeiro
grava normalmente.

Fiz uma trava junto: coleção que não carregou também **não grava**.
Sem a cópia de referência, tudo pareceria novo e a sincronização
sobrescreveria o banco com o que está na memória.

## Os avisos agora dizem a verdade

Você está certo — quem lança olha o aviso, não o topo da tela.

Em modo não-grava, todo aviso de sucesso vira vermelho e ganha:
"ATENÇÃO: não está sendo gravado no banco, vai sumir ao recarregar."

Com módulos degradados, o aviso diz quantos estão sem gravar. E, na
entrada, um aviso nomeia quais e a causa.

## "Voltar e trocar a conta" agora volta

Era cancelamento com nome de volta. Agora reabre a baixa com data,
valores e comprovante preservados, com o foco na conta de saída —
que é o campo que a pessoa veio trocar. Fechar pelo X ou pelo Esc
continua cancelando, e o botão que cancela diz "Cancelar a baixa".

## A empresa no seletor de conta

Corrigido: "Bradesco — movimento · HJM Matriz", como em Conciliação
e Saldo. Você apontou bem — era o único lugar onde a pessoa decidia
algo que vira conta corrente entre empresas sem ver de quem é a
conta.

## Para rodar

```
supabase/11-visoes-completas.sql
```

Depois a passada completa nos quatro módulos que agora gravam, com
reload e conferência de saldo, mais o OFX.
