-- ERP Dom Pedro — Row Level Security
-- Etapa 2 de 3. Depende de 01-schema.sql.
--
-- POR QUE ISTO EXISTE, e não só a checagem na tela: o navegador fala
-- direto com o Postgres pela API do Supabase. Esconder o botão não
-- esconde o dado — quem abrir o console e pedir `select * from
-- folhas` recebe a folha inteira se o banco deixar. A matriz de
-- acesso precisa valer AQUI.
--
-- Três coisas que o banco protege e a tela sozinha não protegeria:
--   · salário e dados bancários de funcionário (sigilo da folha);
--   · nome de paciente, que é dado de saúde (LGPD, art. 5º, II);
--   · a trilha de auditoria, que ninguém pode alterar nem apagar.

-- ── funções de apoio ───────────────────────────────────

-- Quem está pedindo, no vocabulário do ERP.
create or replace function app_usuario()
returns text language sql stable security definer as $$
  select id from usuarios where auth_id = auth.uid() and ativo
$$;

create or replace function app_perfil()
returns text language sql stable security definer as $$
  select perfil from usuarios where auth_id = auth.uid() and ativo
$$;

-- O nível do perfil no módulo: 'V', 'M', 'F' (financeiro) ou 'A'.
create or replace function tem_nivel(modulo text, nivel char)
returns boolean language sql stable security definer as $$
  select coalesce(
    (select position(nivel in niveis) > 0
       from matriz_acesso
      where perfil = app_perfil() and matriz_acesso.modulo = tem_nivel.modulo),
    false)
$$;

-- Ações finas que não vêm da matriz (ver dados pessoais, ver
-- pacientes, estornar, cancelar, admin).
create or replace function tem_acao(acao text)
returns boolean language sql stable security definer as $$
  select coalesce(
    (select p.acoes ? acao
       from perfis p join usuarios u on u.perfil = p.id
      where u.auth_id = auth.uid()),
    false)
$$;

-- ── liga a RLS em tudo ─────────────────────────────────
-- Sem política, nega. É o padrão do Postgres e é o que queremos:
-- tabela nova nasce fechada até alguém decidir quem vê.

-- A `sequencia` entra junto. Ela parece infraestrutura, não dado, e
-- foi por isso que ficou de fora numa primeira versão — mas é o
-- contador que gera os ids do sistema: com a chave pública e sem
-- login, alterá-la bagunçaria a numeração de tudo. Ela fica SEM
-- política nenhuma, o que no Postgres significa negado para todos;
-- quem precisa dela é a função `proximo_id`, que roda como dona.
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- ── cadastros: quem vê o módulo, lê; quem movimenta, escreve ──

-- Um par de políticas por módulo, montado por laço para não haver
-- divergência entre tabelas do mesmo módulo.
do $$
declare
  -- O mapa é um literal JSON: comentário aqui dentro invalida o
  -- valor inteiro e aborta o bloco, deixando o banco SEM RLS
  -- nenhuma. Por isso as observações ficam todas fora das aspas.
  --
  -- `funcionarios` e `folhas` NÃO estão no mapa, de propósito.
  -- Políticas de RLS se somam por OU: a política ampla que o laço
  -- cria anularia a restritiva escrita depois — foi o que deixou a
  -- Contabilidade lendo CPF, salário e conta bancária. As duas têm
  -- política própria mais abaixo, exigindo `ver_dados_pessoais`.
  mapa jsonb := '{
    "financeiro":    ["titulos","parcelas","pagamentos","retencoes_registradas","guias_retencao",
                      "extratos","linhas_extrato","saldos_informados","transferencias_banco",
                      "regras_conciliacao"],
    "faturamento":   ["receber","previsoes","lotes_rps"],
    "contratos":     ["contratos"],
    "estoque":       ["produtos","armazens","posicoes_estoque","estoque_camadas",
                      "estoque_movimentos","minimos_estoque"],
    "compras":       ["compras"],
    "procedimentos": ["procedimentos","fechamentos_procedimentos"],
    "produtividade": ["lotes_produtividade"],
    "ativos":        ["ativos","ativo_movimentos","ordens_servico"],
    "dp":            ["decimos","cargos"],
    "cadastros":     ["centros","clientes","credores","bancos","plano_contas","empresas"]
  }'::jsonb;
  modulo text;
  tabela text;
begin
  for modulo in select jsonb_object_keys(mapa) loop
    for tabela in select jsonb_array_elements_text(mapa -> modulo) loop
      execute format($f$
        create policy %I on %I for select using (tem_nivel(%L, 'V'));
      $f$, 'ver_' || tabela, tabela, modulo);
      execute format($f$
        create policy %I on %I for insert with check (tem_nivel(%L, 'M'));
      $f$, 'criar_' || tabela, tabela, modulo);
      execute format($f$
        create policy %I on %I for update using (tem_nivel(%L, 'M'))
          with check (tem_nivel(%L, 'M'));
      $f$, 'editar_' || tabela, tabela, modulo, modulo);
      -- DELETE não é dado a ninguém: o sistema cancela e estorna,
      -- nunca apaga. Quem precisar expurgar usa a service key, fora
      -- da aplicação, com registro.
    end loop;
  end loop;
end $$;

-- ── pessoal: sigilo salarial dentro do próprio módulo ──
--
-- Ter o módulo de Pessoal não é o mesmo que poder ver CPF, conta
-- bancária e dependentes. A ação fina `ver_dados_pessoais` separa as
-- duas coisas, como já acontece na tela.

-- `funcionarios` e `folhas` só se abrem para quem tem a ação
-- `ver_dados_pessoais`. É onde moram CPF, PIS, salário e conta
-- bancária — e o holerite, que é a mesma informação por outro
-- caminho. Fechar o cadastro e deixar a folha aberta não protege
-- nada.
--
-- Consequência registrada: a Contabilidade (perfil `consulta`) tem
-- o módulo mas não a ação, então perde as duas. Se o escritório
-- precisar da folha para escriturar, o caminho é a exportação, não
-- o acesso à tabela.
create policy ver_funcionario_completo on funcionarios
  for select using (tem_nivel('dp', 'V') and tem_acao('ver_dados_pessoais'));
create policy mexer_funcionario on funcionarios
  for all using (tem_nivel('dp', 'M') and tem_acao('ver_dados_pessoais'))
  with check (tem_nivel('dp', 'M') and tem_acao('ver_dados_pessoais'));

create policy ver_folhas on folhas
  for select using (tem_nivel('dp', 'V') and tem_acao('ver_dados_pessoais'));
create policy mexer_folhas on folhas
  for all using (tem_nivel('dp', 'M') and tem_acao('ver_dados_pessoais'))
  with check (tem_nivel('dp', 'M') and tem_acao('ver_dados_pessoais'));

-- Quem tem o módulo de Pessoal mas não a ação usa esta visão: dá a
-- lista de gente (escala, alocação, quem está ativo) sem nenhum dado
-- sensível. Ela roda como DONA (`security_invoker = false`), porque
-- sob a RLS da tabela não devolveria nada — e por isso o filtro de
-- acesso precisa estar escrito aqui dentro.
create view funcionarios_publico
  with (security_invoker = false) as
  select id, matricula, nome, cargo, centro, admissao, desligamento, ativo
    from funcionarios
   where tem_nivel('dp', 'V');

revoke all on funcionarios_publico from anon;
grant select on funcionarios_publico to authenticated;

-- O próprio funcionário vê o que é dele, quando tiver login.
create policy ver_meu_cadastro on funcionarios
  for select using (
    exists (select 1 from usuarios u
             where u.auth_id = auth.uid() and u.id = funcionarios.id)
  );

-- ── paciente é dado de saúde ───────────────────────────
--
-- O movimento de estoque e o procedimento continuam visíveis para
-- quem tem o módulo — o que a ação `ver_pacientes` controla é o
-- NOME. Como RLS é por linha e não por coluna, a aplicação consulta
-- estas visões; o acesso direto à tabela fica com quem tem a ação.

create view estoque_movimentos_visivel
  with (security_invoker = true) as
  select m.id, m.tipo, m.produto, m.armazem, m.qtd, m.custo, m.valor,
         m.medio_depois, m.data, m.motivo, m.documento, m.lote, m.validade,
         m.origem, m.grupo, m.estornado, m.usuario, m.lancado_em,
         case when tem_acao('ver_pacientes') then m.paciente else null end as paciente
    from estoque_movimentos m;

create view procedimentos_visivel
  with (security_invoker = true) as
  select p.id, p.data, p.competencia, p.centro, p.especialidade,
         p.procedimento, p.procedimento_nome, p.medico, p.qtd,
         p.armazem, p.materiais, p.transferencias, p.grupo, p.financeiro,
         p.cancelado, p.criado_em,
         case when tem_acao('ver_pacientes') then p.paciente else null end as paciente,
         -- Valor só para quem tem $ no módulo, como na tela.
         case when tem_nivel('procedimentos', 'F') then p.faturamento end as faturamento,
         case when tem_nivel('procedimentos', 'F') then p.repasse end as repasse,
         case when tem_nivel('procedimentos', 'F') then p.custo_material end as custo_material,
         case when tem_nivel('procedimentos', 'F') then p.imposto end as imposto,
         case when tem_nivel('procedimentos', 'F') then p.resultado end as resultado
    from procedimentos p;

-- ── administração ──────────────────────────────────────

create policy ver_usuarios on usuarios
  for select using (tem_nivel('administracao', 'V') or auth_id = auth.uid());
create policy mexer_usuarios on usuarios
  for all using (tem_nivel('administracao', 'M'))
  with check (tem_nivel('administracao', 'M'));

-- Perfis e matriz são lidos por qualquer usuário AUTENTICADO (a tela
-- precisa saber o que mostrar), nunca por quem só tem a chave
-- pública: juntas, as duas tabelas desenham a estrutura de poder da
-- empresa. As funções `tem_nivel` e `tem_acao` não dependem destas
-- políticas — rodam como donas.
create policy ver_perfis on perfis
  for select using (app_usuario() is not null);
create policy mexer_perfis on perfis
  for all using (tem_nivel('administracao', 'M'))
  with check (tem_nivel('administracao', 'M'));

-- A matriz é lida por todo mundo (as funções acima dependem dela) e
-- escrita só pela Administração.
create policy ver_matriz on matriz_acesso
  for select using (app_usuario() is not null);
create policy mexer_matriz on matriz_acesso
  for all using (tem_nivel('administracao', 'M'))
  with check (tem_nivel('administracao', 'M'));

-- Parâmetros guardam alçadas de aprovação e tabelas de INSS e IRRF:
-- configuração, não segredo, mas não é coisa que se leia da rua.
create policy ver_parametros on parametros
  for select using (app_usuario() is not null);
create policy mexer_parametros on parametros
  for all using (tem_nivel('administracao', 'M') or tem_acao('dp'))
  with check (tem_nivel('administracao', 'M') or tem_acao('dp'));

-- ── trilha de auditoria: append-only ───────────────────
--
-- Qualquer um que use o sistema escreve evento; ninguém altera nem
-- apaga, inclusive o admin. Trilha que o próprio administrador pode
-- reescrever não serve de trilha.

create policy ver_eventos on eventos
  for select using (tem_nivel('administracao', 'V') or tem_acao('admin'));
create policy gravar_eventos on eventos
  for insert with check (app_usuario() is not null);
-- sem política de update e de delete: negado para todos.

-- ── a função que gera id roda como dona ────────────────
-- Com a `sequencia` fechada para todos, `proximo_id` precisa ser
-- SECURITY DEFINER para funcionar — e só responde a quem está
-- autenticado.

create or replace function proximo_id(prefixo text)
returns text language plpgsql security definer as $$
declare n bigint;
begin
  if app_usuario() is null then
    raise exception 'sem usuário autenticado';
  end if;
  update sequencia set valor = valor + 1 where id = 1 returning valor into n;
  return prefixo || n::text;
end $$;

-- `from anon` não subtrai nada: o Postgres concede EXECUTE a PUBLIC
-- por padrão, e revogar de um papel específico não tira o que veio
-- de PUBLIC. Tem de ser `from public`.
-- `from public` tira o que o Postgres concede por padrão, mas o
-- Supabase também dá concessão PRÓPRIA a `anon` pelos default
-- privileges — e revogar de public não mexe nela. Precisa dos dois.
-- (A guarda de dentro da função já barra quem não está autenticado;
-- isto é o cinto além do suspensório.)
revoke all on function proximo_id(text) from public, anon;
grant execute on function proximo_id(text) to authenticated;

-- ── nota sobre o que a RLS NÃO faz ─────────────────────
--
-- A RLS decide QUEM LÊ E ESCREVE. Ela não aplica regra de negócio:
-- a conservação de valor no estoque, a conferência de saldo no
-- pagamento, o INSS por competência e a segregação de aprovação
-- continuam no `store.js`, onde estão testadas por 1311 verificações.
--
-- Isso significa que a aplicação continua sendo o caminho normal de
-- escrita. A RLS é a rede embaixo: impede que alguém com o token do
-- navegador contorne a tela e escreva direto onde não deveria.
