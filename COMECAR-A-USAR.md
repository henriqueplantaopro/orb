# Limpar o sistema e começar a usar

Três passos, nesta ordem, no SQL Editor do Supabase.

## 1. Limpar

Cole o `supabase/24-limpar-para-uso.sql`.

**Rode uma vez só, antes de a equipe entrar.** Diferente das outras
etapas, esta apaga: rodar de novo depois que a equipe lançar coisas
apaga o trabalho dela. Por isso ela fica fora do
`ATUALIZAR-TUDO.sql`.

**O que permanece:** empresas, projetos, clientes, usuários,
perfis, matriz de acesso, plano de contas, cargos, parâmetros e as
previsões de faturamento.

**O que sai:** todo lançamento financeiro, o estoque inteiro,
procedimentos, compras, ativos, ordens de serviço, folha,
produtividade, extratos, retenções, armazéns, produtos,
fornecedores, médicos e contratos.

**As previsões ficam, mas voltam a "estimada".** Confirmar é um ato
de quem acompanha o contrato; herdar confirmação de teste faria o
mês nascer com uma etapa vencida que ninguém cumpriu.

## 2. Carregar os fornecedores

Cole o `supabase/25-carga-fornecedores.sql`. São 284 cadastros:
272 pessoas jurídicas e 12 físicas (Alessandro foi retirado).

Das doze pessoas físicas, quatro entram como **fornecedor** —
Fellype (sócio), David (recebe como fornecedor), Márcia e Bianca
(reembolso de despesas) — e oito como **funcionário**: Dayana,
Francy Amanda, Jéssica, Monique Cardoso, Monique Costa, Priscila,
Romário e Samara. Esses oito entram também na tabela de pessoal,
com cargo e salário em branco para você ajustar.

É um arquivo grande (116 kB). Se o editor reclamar do tamanho, use
o botão de upload de arquivo `.sql` do próprio SQL Editor.

## 3. Carregar armazéns e ativos

Cole o `supabase/26-armazens-ativos.sql`. São sete armazéns e os 27
equipamentos da planilha.

Os três sublocais do Bonsucesso (cirurgia geral, oftalmologia e
urologia) apontam para o estoque central pelo campo `pai`: o
material entra uma vez no central e se distribui, em vez de cada
sala ter entrada própria.

## 4. Conferir

```sql
select 'projetos' as o_que, count(*) from centros where tipo = 'projeto'
union all select 'clientes', count(*) from clientes
union all select 'usuários', count(*) from usuarios
union all select 'previsões', count(*) from previsoes
union all select 'fornecedores', count(*) from credores where tipo = 'fornecedor'
union all select 'médicos', count(*) from credores where tipo = 'medico'
union all select 'títulos (deve ser 0)', count(*) from titulos
union all select 'produtos (deve ser 0)', count(*) from produtos;
```

## O que vai faltar para operar

A limpeza apaga três cadastros que o sistema precisa para o estoque
e o faturamento funcionarem:

**Armazéns:** já resolvido no passo 3. Vale saber que a estrutura
antiga do mutirão tinha seis salas (oftalmo, cirurgia geral,
urologia, otorrino, gineco e risco cirúrgico) e agora são três. Se
otorrino, gineco e risco cirúrgico voltarem, precisam de armazém
próprio para o consumo continuar separado por tipo de cirurgia.

**Produtos.** O estoque começa vazio; o inventário inicial é o
caminho de entrada.

**Médicos.** A planilha do Protheus não tem nenhum: o quadro de
plantonistas é outro cadastro. Sem ele, não há repasse de
produtividade.

Quando tiver as planilhas desses três, mando o conversor do mesmo
jeito.
