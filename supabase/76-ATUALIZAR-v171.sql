-- ══════════════════════════════════════════════════════════════════
-- ATUALIZAR v171 — a conciliação bancária passa a gravar no banco
--
-- Rode UMA VEZ, no SQL Editor do Supabase, nos DOIS projetos (teste e
-- real), DEPOIS do 75-ATUALIZAR-v170.sql. Pode rodar de novo sem
-- estragar nada.
--
-- O QUE ELE CONSERTA
--
-- As linhas do extrato importado não gravavam. A coluna `saida` da
-- tabela `linhas_extrato` foi criada como SIM/NÃO (boolean), mas o
-- sistema guarda nela o VALOR que saiu da conta (ex.: 2.000,00). O
-- banco recusava o lote inteiro de linhas: "invalid input syntax for
-- type boolean: 2000". O extrato importado e a conciliação feita
-- sobre ele ficavam só na tela, e sumiam ao atualizar a página.
--
-- Aqui a coluna passa a ser valor (numeric). Linha que tenha chegado
-- a gravar (só as de entrada, ou de saída de exatamente R$ 1,00) é
-- convertida: SIM vira o valor absoluto da linha, NÃO vira zero.
-- ══════════════════════════════════════════════════════════════════

do $$
begin
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'linhas_extrato'
         and column_name = 'saida') = 'boolean' then
    alter table linhas_extrato alter column saida drop default;
    alter table linhas_extrato alter column saida type numeric(14,2)
      using (case when saida then abs(valor) else 0 end);
  end if;
  alter table linhas_extrato alter column saida set default 0;
end $$;

-- O Supabase passa a enxergar o tipo novo na hora.
notify pgrst, 'reload schema';

-- Conferência: deve mostrar "numeric".
select column_name as coluna, data_type as tipo
  from information_schema.columns
 where table_schema = 'public' and table_name = 'linhas_extrato' and column_name = 'saida';
