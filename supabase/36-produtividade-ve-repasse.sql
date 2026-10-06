-- ERP Dom Pedro — quem lança produtividade vê o repasse que gerou
-- Etapa 36.
--
-- O "Ver detalhe" de um fechamento lista médico por médico: quanto
-- cada um produziu e quanto vai receber. Esses valores vivem em
-- `titulos` e `parcelas`, que pertencem ao módulo Financeiro — e o
-- perfil de Produtividade não tem Financeiro.
--
-- Resultado: a tela abria vazia. Para o administrador funcionava,
-- e quem precisa de verdade — quem confere o fechamento e autoriza
-- o pagamento — não via nada.
--
-- A regra aqui é estreita de propósito: só os títulos NASCIDOS da
-- produtividade e do mutirão. O contas a pagar da empresa continua
-- fora do alcance desse perfil — ver o repasse que você mesmo
-- fechou não é o mesmo que ver a despesa da empresa inteira.

drop policy if exists ver_titulo_da_produtividade on titulos;
create policy ver_titulo_da_produtividade on titulos
  for select to authenticated
  using (
    tem_nivel('produtividade', 'V')
    and origem in ('produtividade', 'procedimentos')
  );

drop policy if exists ver_parcela_da_produtividade on parcelas;
create policy ver_parcela_da_produtividade on parcelas
  for select to authenticated
  using (
    tem_nivel('produtividade', 'V')
    and exists (
      select 1 from titulos t
       where t.id = parcelas.titulo_id
         and t.origem in ('produtividade', 'procedimentos')
    )
  );

-- Os PAGAMENTOS dessas parcelas: é o que mostra "pago" ou "a
-- pagar" na conferência. Sem isso, o fechamento conferido parece
-- sempre em aberto.
drop policy if exists ver_pagamento_da_produtividade on pagamentos;
create policy ver_pagamento_da_produtividade on pagamentos
  for select to authenticated
  using (
    tem_nivel('produtividade', 'V')
    and exists (
      select 1 from parcelas p
        join titulos t on t.id = p.titulo_id
       where p.id = pagamentos.parcela_id
         and t.origem in ('produtividade', 'procedimentos')
    )
  );

-- ALTERAR continua fora: liberar um bloqueio mexe no lote, não na
-- parcela, e é por lá que a produtividade age.

-- Conferência (entrando com um usuário do perfil Produtividade):
--   select count(*) from parcelas;   -- deve trazer só as de repasse
--   select distinct origem from titulos;  -- produtividade, procedimentos
