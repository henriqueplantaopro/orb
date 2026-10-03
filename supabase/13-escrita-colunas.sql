-- ERP Dom Pedro — destravar a escrita
-- Etapa 13.
--
-- Dois bloqueios que a auditoria isolou, e a limpeza que faltou.

-- ── 1. `estornado` sem default ─────────────────────────
--
-- A função `gravar_estoque` monta o INSERT no SQL, então a rede que
-- preenche obrigatórias no cliente não a alcança. A coluna ganha
-- default: é o lugar certo para "todo movimento nasce não
-- estornado".

alter table estoque_movimentos alter column estornado set default false;
update estoque_movimentos set estornado = false where estornado is null;

-- Mesmo cuidado nas outras colunas que nascem com valor conhecido.
alter table procedimentos      alter column cancelado set default false;
alter table estoque_camadas    alter column qtd set default 0;
alter table parcelas           alter column valor_pago set default 0;

-- ── 2. O 42501 do upsert em `procedimentos` ────────────
--
-- Diagnóstico da auditoria, confirmado coluna a coluna: o upsert
-- vira `insert ... on conflict (id) do update set ... paciente =
-- excluded.paciente`, e isso exige UPDATE na coluna `paciente`. O
-- INSERT puro passa; falta só o UPDATE.
--
-- A saída é dar UPDATE sem dar SELECT. Escrever e não poder ler é
-- exatamente o que se quer aqui: a aplicação grava o nome do
-- paciente que ela mesma acabou de receber do formulário, e segue
-- sem conseguir lê-lo de volta — quem lê é a visão, conforme a
-- permissão de cada um.
--
-- A outra saída seria mais uma função com privilégio. Preferi esta:
-- menos código com privilégio é menos lugar onde um erro futuro
-- vira brecha.

grant update (paciente, faturamento, repasse, custo_material, imposto, imposto_pct, resultado)
  on procedimentos to authenticated;

grant update (paciente, custo, custo_nota, valor, medio_depois)
  on estoque_movimentos to authenticated;

-- Conferência do que NÃO mudou (a leitura segue fechada):
--   select paciente from procedimentos limit 1;   -- 42501, como antes

-- ── 3. As 5 posições que ficaram sem lastro ────────────
--
-- A limpeza anterior tirou as camadas órfãs e deixou as posições
-- com saldo — que, sem camada e sem movimento, viraram justamente o
-- saldo sem lastro que a trava existe para impedir. Criado pela
-- própria limpeza.
--
-- Some com elas. O estoque real entra pelo inventário inicial, que
-- é o caminho que registra camada, movimento e saldo juntos.

delete from posicoes_estoque p
 where not exists (select 1 from estoque_movimentos m
                    where m.produto = p.produto and m.armazem = p.armazem)
   and not exists (select 1 from estoque_camadas c
                    where c.produto = p.produto and c.armazem = p.armazem);

-- Conferência:
--   select count(*) from posicoes_estoque;   -- 0 num banco sem inventário
