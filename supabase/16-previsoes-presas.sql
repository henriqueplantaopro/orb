-- ERP Dom Pedro — destravar competências presas
-- Etapa 16.
--
-- Antes da correção da v30, cancelar o fechamento não devolvia a
-- previsão para `estimada`. A competência ficava dizendo "fechado"
-- sem nenhum fechamento ativo — e, como a tela se achava fechada,
-- o botão de fechar era recusado em silêncio. O mês ficava preso,
-- sem caminho de volta pela interface.
--
-- O código da v31 deixou de depender disto: a etapa passou a olhar
-- o fechamento, não só o status da previsão, e corrige o registro
-- ao encontrar. Este SQL resolve o que já está no banco, para não
-- depender de alguém abrir a tela daquela competência.

update previsoes p
   set status = 'estimada',
       confirmado_por = null,
       confirmado_em = null
 where p.status = 'confirmada_prod'
   and not exists (
     select 1 from fechamentos_procedimentos f
      where f.competencia = p.competencia
        and coalesce(f.cancelado, false) = false
   );

-- Conferência: não deve sobrar previsão confirmada sem fechamento
-- ativo na mesma competência.
--
--   select p.competencia, p.status
--     from previsoes p
--    where p.status = 'confirmada_prod'
--      and not exists (select 1 from fechamentos_procedimentos f
--                       where f.competencia = p.competencia
--                         and coalesce(f.cancelado, false) = false);
--   -- esperado: nenhuma linha
