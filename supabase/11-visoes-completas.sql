-- ERP Dom Pedro — visões completas para a aplicação
-- Etapa 11. Roda depois dos anteriores.
--
-- POR QUE ESTE ARQUIVO EXISTE, e por que NÃO se deve seguir o hint
-- do PostgREST neste caso:
--
-- A aplicação lia `procedimentos` e `estoque_movimentos` com
-- `select *`, e o banco recusava com 42501. O PostgREST sugere
-- `GRANT SELECT ON ... TO anon`, e isso resolveria o erro — mas
-- devolveria a coluna `paciente` a quem não pode vê-la, que é
-- justamente o dado de saúde que a etapa 04 fechou por coluna.
-- Seguir o hint desfaria a proteção para calar um erro.
--
-- A recusa estava CERTA. O errado era a aplicação pedir `*` numa
-- tabela com coluna fechada. Ela passa a ler pelas visões, que já
-- mascaram conforme a permissão de cada um — e as visões precisam
-- trazer todas as colunas que a aplicação usa, que é o que este
-- arquivo completa.

drop view if exists procedimentos_visivel;
create view procedimentos_visivel
  with (security_invoker = false) as
  select p.id, p.data, p.competencia, p.centro, p.especialidade,
         p.procedimento, p.procedimento_nome, p.medico, p.qtd,
         p.armazem, p.materiais, p.transferencias, p.grupo, p.financeiro,
         p.cancelado, p.motivo_cancelamento, p.editado_por, p.usuario_id,
         p.criado_em, p.extra,
         case when tem_acao('ver_pacientes') then p.paciente end as paciente,
         case when tem_nivel('procedimentos', 'F') then p.faturamento end as faturamento,
         case when tem_nivel('procedimentos', 'F') then p.repasse end as repasse,
         case when tem_nivel('procedimentos', 'F') then p.custo_material end as custo_material,
         case when tem_nivel('procedimentos', 'F') then p.imposto end as imposto,
         case when tem_nivel('procedimentos', 'F') then p.imposto_pct end as imposto_pct,
         case when tem_nivel('procedimentos', 'F') then p.resultado end as resultado
    from procedimentos p
   where tem_nivel('procedimentos', 'V');

drop view if exists estoque_movimentos_visivel;
create view estoque_movimentos_visivel
  with (security_invoker = false) as
  select m.id, m.tipo, m.produto, m.armazem, m.qtd, m.qtd_nota,
         m.unidades_por_embalagem, m.data, m.data_nf, m.motivo, m.documento,
         m.lote, m.validade, m.origem, m.grupo, m.pedido_id, m.estornado,
         m.usuario, m.usuario_id, m.lancado_em, m.extra,
         case when tem_acao('ver_pacientes') then m.paciente end as paciente,
         case when tem_nivel('estoque', 'F') then m.custo end as custo,
         case when tem_nivel('estoque', 'F') then m.custo_nota end as custo_nota,
         case when tem_nivel('estoque', 'F') then m.valor end as valor,
         case when tem_nivel('estoque', 'F') then m.medio_depois end as medio_depois
    from estoque_movimentos m
   where tem_nivel('estoque', 'V');

revoke all on procedimentos_visivel, estoque_movimentos_visivel from anon;
grant select on procedimentos_visivel, estoque_movimentos_visivel to authenticated;

-- Conferência (logado):
--   select count(*) from procedimentos_visivel;
--   select count(*) from estoque_movimentos_visivel;
--   -- e, sem login, as duas devem recusar.
