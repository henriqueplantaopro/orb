-- ERP Dom Pedro — ajustes de permissão
-- Etapa 4. Roda depois de 02-rls.sql.
--
-- Três decisões tomadas depois da revisão das políticas.

-- ── 1. Nome de paciente e valores: fechar na coluna ────
--
-- A RLS decide quais LINHAS alguém lê; ela não sabe esconder uma
-- coluna. Por isso as visões `procedimentos_visivel` e
-- `estoque_movimentos_visivel` mascaram o nome do paciente — mas,
-- enquanto a tabela-base estiver legível, a visão é enfeite: basta
-- pedir a tabela direto.
--
-- O `revoke` por coluna fecha isso de verdade. Quem não tem a
-- permissão não consegue pedir a coluna nem com `select *`: a
-- requisição inteira é recusada. As visões continuam sendo o
-- caminho normal de leitura.
--
-- A ESCRITA não é afetada: permissão de insert e update é separada
-- da de select, então a aplicação segue gravando o paciente e os
-- valores normalmente.

-- ATENÇÃO à forma. `revoke select (coluna)` sozinho NÃO funciona:
-- o Supabase concede a `authenticated` o SELECT da tabela inteira
-- por default privilege, e grant de tabela cobre toda coluna — o
-- revoke de coluna não subtrai nada. A forma que funciona é tirar o
-- SELECT da tabela e devolver coluna a coluna, menos as fechadas.

revoke select on procedimentos from authenticated, anon;
grant select (id, data, competencia, centro, especialidade, procedimento,
  procedimento_nome, medico, qtd, armazem, materiais, transferencias, grupo,
  financeiro, cancelado, motivo_cancelamento, editado_por, usuario_id, criado_em)
  on procedimentos to authenticated;

revoke select on estoque_movimentos from authenticated, anon;
grant select (id, tipo, produto, armazem, qtd, qtd_nota, unidades_por_embalagem,
  data, data_nf, motivo, documento, lote, validade, origem, grupo, pedido_id,
  estornado, usuario, usuario_id, lancado_em)
  on estoque_movimentos to authenticated;

-- A escrita não é afetada: insert e update têm privilégio próprio.
grant insert, update on procedimentos, estoque_movimentos to authenticated;

-- Com as colunas fechadas, as visões PRECISAM rodar como donas —
-- `security_invoker = true` exigiria o privilégio de quem chama, e
-- aí nem quem tem a ação conseguiria ler. E, rodando como donas,
-- o filtro de LINHA tem de estar escrito dentro delas.

drop view if exists procedimentos_visivel;
create view procedimentos_visivel
  with (security_invoker = false) as
  select p.id, p.data, p.competencia, p.centro, p.especialidade,
         p.procedimento, p.procedimento_nome, p.medico, p.qtd,
         p.armazem, p.materiais, p.transferencias, p.grupo, p.financeiro,
         p.cancelado, p.criado_em,
         case when tem_acao('ver_pacientes') then p.paciente end as paciente,
         case when tem_nivel('procedimentos', 'F') then p.faturamento end as faturamento,
         case when tem_nivel('procedimentos', 'F') then p.repasse end as repasse,
         case when tem_nivel('procedimentos', 'F') then p.custo_material end as custo_material,
         case when tem_nivel('procedimentos', 'F') then p.imposto end as imposto,
         -- A alíquota aplicada é informação de valor como as outras:
         -- diz quanto o projeto paga de imposto. Vai junto do $.
         case when tem_nivel('procedimentos', 'F') then p.imposto_pct end as imposto_pct,
         case when tem_nivel('procedimentos', 'F') then p.resultado end as resultado
    from procedimentos p
   where tem_nivel('procedimentos', 'V');

drop view if exists estoque_movimentos_visivel;
create view estoque_movimentos_visivel
  with (security_invoker = false) as
  select m.id, m.tipo, m.produto, m.armazem, m.qtd, m.data, m.motivo,
         m.documento, m.lote, m.validade, m.origem, m.grupo, m.estornado,
         m.usuario, m.lancado_em,
         case when tem_acao('ver_pacientes') then m.paciente end as paciente,
         case when tem_nivel('estoque', 'F') then m.custo end as custo,
         case when tem_nivel('estoque', 'F') then m.valor end as valor,
         -- Custo da nota: o que o fornecedor cobrou, antes do rateio
         -- do frete. É preço, então segue a mesma regra.
         case when tem_nivel('estoque', 'F') then m.custo_nota end as custo_nota,
         case when tem_nivel('estoque', 'F') then m.medio_depois end as medio_depois
    from estoque_movimentos m
   where tem_nivel('estoque', 'V');

revoke all on procedimentos_visivel, estoque_movimentos_visivel from anon;
grant select on procedimentos_visivel, estoque_movimentos_visivel to authenticated;

-- NOTA PARA A MIGRAÇÃO DO CÓDIGO (Marco 3): com as colunas
-- fechadas, `insert ... returning *` e `update ... returning *`
-- nestas duas tabelas voltam "permission denied" — o grant de
-- coluna morde antes da RLS. No supabase-js, a escrita em
-- `procedimentos` e `estoque_movimentos` não pode encadear um
-- `.select()` sem lista: ou pede só as colunas liberadas, ou não
-- pede retorno nenhum.

-- ── 2. Quem escreve na matriz e no perfil ──────────────
--
-- Decisão: Administração, Diretoria e Sócio continuam podendo —
-- são os três que respondem pela empresa. O que sai é o assistente
-- financeiro, que tinha Administração em VM por engano de cadastro
-- e podia, pela API, promover o próprio perfil.
--
-- A correção principal é na matriz (o assistente passa a ter só V
-- em Administração), e vem no ERP. Aqui fica a trava que impede o
-- caso que nenhuma matriz resolve: alguém alterar o PRÓPRIO perfil.

drop policy if exists mexer_usuarios on usuarios;

create policy criar_usuarios on usuarios
  for insert with check (tem_nivel('administracao', 'M'));

create policy editar_usuarios on usuarios
  for update using (
    tem_nivel('administracao', 'M')
    -- Ninguém muda o próprio registro por aqui, nem o administrador.
    -- Promover a si mesmo não é alçada: é falta de segunda mão.
    and auth_id is distinct from auth.uid()
  )
  with check (
    tem_nivel('administracao', 'M')
    and auth_id is distinct from auth.uid()
  );

-- ── 3. O que o assistente financeiro vê em Pessoal ─────
--
-- Decisão: vê tudo — cadastro e folha completos —, mas não
-- movimenta e não fecha. Ele paga os salários, e para pagar precisa
-- do líquido, da conta e do CPF.
--
-- A consequência, registrada porque é real: isso inclui o salário
-- de todos, inclusive de quem está acima dele. O sigilo salarial
-- que o sistema aplica em outros pontos não vale para este perfil.
-- Se um dia a empresa quiser separar "pagar" de "ver quanto cada um
-- ganha", o caminho é um perfil de tesouraria que leia só o líquido
-- a pagar, sem o cadastro.
--
-- Em termos de banco, o assistente ganha a ação `ver_dados_pessoais`
-- (feito no ERP, no cadastro do perfil) e segue com dp = V$: sem M,
-- não lança nada; sem A, não fecha a folha.

-- Conferência do resultado esperado:
--   select niveis from matriz_acesso
--    where perfil = 'assistente' and modulo = 'dp';        -- VF
--   select niveis from matriz_acesso
--    where perfil = 'assistente' and modulo = 'administracao';  -- V
--   select acoes ? 'ver_dados_pessoais' from perfis
--    where id = 'assistente';                              -- true
