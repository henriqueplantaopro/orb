-- ERP Dom Pedro — etapa 64 (v124)
-- OS TRÊS CADASTROS QUE TODO MUNDO PRECISA ENXERGAR.
--
-- RODE NOS DOIS BANCOS, o real e o de testes. É seguro rodar mais
-- de uma vez.
--
-- O QUE ACONTECEU
--
-- Um usuário com perfil novo entrou e levou:
--
--   Cadastro essencial faltando no banco: empresas, centros,
--   plano_contas sem nenhuma linha. Rode o 03-seed.sql.
--
-- O banco estava cheio. O que faltava era permissão: estas três
-- tabelas estavam protegidas por `tem_nivel('cadastros','V')`, e
-- o perfil novo não tinha o módulo Cadastros marcado. Sob RLS,
-- quem não pode ver não recebe erro — recebe lista vazia. O
-- sistema leu vazio e concluiu, de boa-fé, que o banco estava sem
-- seed.
--
-- POR QUE ESTAS TRÊS SÃO DIFERENTES DAS OUTRAS DE CADASTROS
--
-- Elas não são "dados do módulo Cadastros": são a espinha do
-- sistema. Um título mostra o centro de custo dele; um lançamento
-- precisa do plano de contas; toda nota aponta para a empresa.
-- Sem as três, NENHUM módulo monta — tanto que a carga se recusa
-- a subir sem elas. Trancá-las atrás de um módulo significa que
-- qualquer perfil sem Cadastros simplesmente não entra no
-- sistema, o que não é uma política de acesso: é uma pane.
--
-- Então a LEITURA das três passa a valer para qualquer usuário
-- ativo do ERP. A ESCRITA continua onde estava — só quem
-- movimenta Cadastros cria ou altera. Ver o nome do centro de
-- custo não é poder mudá-lo.
--
-- `clientes`, `credores` e `bancos` NÃO entram aqui de propósito:
-- são dados de negócio, o sistema monta sem eles, e abrir a
-- leitura deles seria uma decisão de outra natureza.

-- ══════════════════════════════════════════════════════════
-- 1 · leitura das três para qualquer usuário ativo
-- ══════════════════════════════════════════════════════════
drop policy if exists ver_empresas on empresas;
create policy ver_empresas on empresas
  for select to authenticated
  using (app_usuario() is not null);

drop policy if exists ver_centros on centros;
create policy ver_centros on centros
  for select to authenticated
  using (app_usuario() is not null);

drop policy if exists ver_plano_contas on plano_contas;
create policy ver_plano_contas on plano_contas
  for select to authenticated
  using (app_usuario() is not null);

-- A escrita fica como estava. Recriada aqui só para ficar
-- declarado no mesmo lugar que a leitura — quem ler este arquivo
-- vê a regra inteira, e não metade dela.
drop policy if exists criar_empresas on empresas;
create policy criar_empresas on empresas
  for insert to authenticated with check (tem_nivel('cadastros', 'M'));
drop policy if exists editar_empresas on empresas;
create policy editar_empresas on empresas
  for update to authenticated
  using (tem_nivel('cadastros', 'M')) with check (tem_nivel('cadastros', 'M'));

drop policy if exists criar_centros on centros;
create policy criar_centros on centros
  for insert to authenticated with check (tem_nivel('cadastros', 'M'));
drop policy if exists editar_centros on centros;
create policy editar_centros on centros
  for update to authenticated
  using (tem_nivel('cadastros', 'M')) with check (tem_nivel('cadastros', 'M'));

drop policy if exists criar_plano_contas on plano_contas;
create policy criar_plano_contas on plano_contas
  for insert to authenticated with check (tem_nivel('cadastros', 'M'));
drop policy if exists editar_plano_contas on plano_contas;
create policy editar_plano_contas on plano_contas
  for update to authenticated
  using (tem_nivel('cadastros', 'M')) with check (tem_nivel('cadastros', 'M'));

-- ══════════════════════════════════════════════════════════
-- CONFERÊNCIA — uma única saída
-- ══════════════════════════════════════════════════════════
drop table if exists diag;
create temp table diag (ordem int, o_que text, resultado text);

insert into diag values
  (10, 'empresas · leitura liberada para usuario logado',
       coalesce((select case when qual like '%app_usuario%' then 'sim'
                             else 'NAO — ainda exige modulo' end
                   from pg_policies
                  where tablename = 'empresas' and policyname = 'ver_empresas'), 'SEM POLITICA')),
  (11, 'centros · leitura liberada para usuario logado',
       coalesce((select case when qual like '%app_usuario%' then 'sim'
                             else 'NAO — ainda exige modulo' end
                   from pg_policies
                  where tablename = 'centros' and policyname = 'ver_centros'), 'SEM POLITICA')),
  (12, 'plano_contas · leitura liberada para usuario logado',
       coalesce((select case when qual like '%app_usuario%' then 'sim'
                             else 'NAO — ainda exige modulo' end
                   from pg_policies
                  where tablename = 'plano_contas' and policyname = 'ver_plano_contas'), 'SEM POLITICA')),
  (20, 'empresas · escrita ainda restrita a Cadastros',
       coalesce((select case when with_check like '%cadastros%' then 'sim' else 'NAO' end
                   from pg_policies
                  where tablename = 'empresas' and policyname = 'criar_empresas'), 'SEM POLITICA')),
  (21, 'centros · escrita ainda restrita a Cadastros',
       coalesce((select case when with_check like '%cadastros%' then 'sim' else 'NAO' end
                   from pg_policies
                  where tablename = 'centros' and policyname = 'criar_centros'), 'SEM POLITICA')),
  (30, 'linhas em empresas', (select count(*)::text from empresas)),
  (31, 'linhas em centros', (select count(*)::text from centros)),
  (32, 'linhas em plano_contas', (select count(*)::text from plano_contas));

-- Quais perfis entrariam sem conseguir ver os cadastros, antes
-- desta correção. Serve para conferir que o problema era este.
insert into diag
select 40, 'perfil ' || p.id || ' tem Cadastros?',
       coalesce((select case when niveis like '%V%' then 'sim' else 'NAO' end
                   from matriz_acesso m
                  where m.perfil = p.id and m.modulo = 'cadastros'), 'NAO')
  from perfis p;

insert into diag values
  (90, '>>> QUALQUER PERFIL CONSEGUE ENTRAR AGORA?',
       case when (select count(*) from pg_policies
                   where tablename in ('empresas','centros','plano_contas')
                     and policyname in ('ver_empresas','ver_centros','ver_plano_contas')
                     and qual like '%app_usuario%') = 3
             and (select count(*) from empresas) > 0
             and (select count(*) from centros) > 0
             and (select count(*) from plano_contas) > 0
            then 'SIM' else 'NAO — veja as linhas acima' end);

select o_que, resultado from diag order by ordem, o_que;
