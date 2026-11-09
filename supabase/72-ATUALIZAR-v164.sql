-- ══════════════════════════════════════════════════════════════════
-- ATUALIZAR v164 — quem lança a produtividade passa a conseguir gravar
--
-- Rode UMA VEZ, no SQL Editor do Supabase, nos DOIS projetos (teste e
-- real). Pode rodar de novo sem estragar nada.
--
-- O QUE ELE CONSERTA
--
-- A gerência de produtividade importa o fechamento, a tela mostra os
-- 36 médicos, gera os lançamentos e diz que deu certo. Mas o repasse
-- não existe no banco: ficou só no navegador dela. Depois do F5
-- sobra o cabeçalho do lançamento sem nenhum médico dentro — e é por
-- isso que o detalhe abre vazio para quem olha de outro lugar.
--
-- A importação escreve em TRÊS módulos:
--
--     lotes_produtividade  ->  Produtividade   (ela tem alteração)
--     credores             ->  Cadastros       (ela tem só consulta)
--     titulos e parcelas   ->  Financeiro      (ela não tem nada)
--
-- O sistema já tinha a válvula certa no navegador: `_interno`, que
-- deixa a produtividade criar o título do repasse sem ter a ação de
-- lançar conta a pagar avulsa. O BANCO não tinha válvula nenhuma. O
-- navegador dizia sim e o banco dizia não — e o não era quase
-- silencioso.
--
-- Medido num Postgres 16 com esta RLS, no perfil padrão "Gerência de
-- produtividade" (produtividade VMFA, faturamento VMF, contratos VMF,
-- cadastros V, procedimentos V):
--
--     insert into credores ...      ->  ERRO: row-level security
--     update credores set pix = ... ->  UPDATE 0, SEM ERRO
--     insert into titulos  ...      ->  ERRO: row-level security
--     insert into parcelas ...      ->  ERRO: row-level security
--     select count(*) from titulos  ->  0   (não vê nem o que lançou)
--
-- A linha do meio é a chave PIX do coordenador: a importação
-- preenchia o cadastro dele na memória, o banco ignorava o UPDATE sem
-- reclamar, e o F5 trazia o cadastro vazio. Não era a planilha.
--
-- O MESMO VALE PARA O PESSOAL (DP): a folha cria título e parcela com
-- origem 'folha' e 'decimo', e o perfil de DP também não tem
-- Financeiro. Mesma causa, mesmo conserto, aqui junto.
--
-- O QUE ESTE SCRIPT **NÃO** FAZ: dar Financeiro a esses perfis. Quem
-- lança produtividade continua sem poder criar conta a pagar avulsa,
-- sem ver título de aluguel, sem ver pagamento. O que ele ganha é
-- exatamente o que a tela dele produz, reconhecido pela ORIGEM do
-- registro — nada além.
-- ══════════════════════════════════════════════════════════════════

-- ── 0. A CONTA BANCÁRIA DO FAVORECIDO GANHA COLUNA ──────────────
--
-- `credores` tem `banco` e `agencia` como colunas, e o número da
-- conta não: o sistema sempre gravou `conta_bancaria`, que caía no
-- `extra` em JSON. Funcionava — o `extra` volta inteiro na recarga —,
-- mas deixava a metade do dado bancário escondida de qualquer
-- consulta ou relatório feito no banco, e é dado que a remessa usa.
--
-- (A tabela tem uma coluna `conta` que o sistema nunca escreveu, de
-- uma versão antiga. Fica onde está, vazia: renomear agora seria
-- trocar o nome do campo em dez lugares para arrumar zero dado.)
--
-- Ninguém perde nada: quem foi gravado antes continua com o valor no
-- `extra`, e a leitura preenche o campo com ele quando a coluna está
-- vazia.
alter table credores add column if not exists conta_bancaria text;

-- ── 1. Título e parcela do repasse da produtividade ─────────────
--
-- A regra é por ORIGEM **e** TIPO. Só origem não bastava: medido
-- aqui, com origem sozinha ela conseguia gravar um título de qualquer
-- natureza marcado como produtividade — uma conta a pagar inventada
-- com disfarce. Com `tipo_titulo = 'medicao'` o que ela pode criar é
-- repasse médico, que é o que a tela dela produz, e nada mais.
--
-- `origem = 'produtividade'` é posto pelo sistema em `criarTitulo` e
-- não é campo de tela: não há como a gerência marcar um título de
-- aluguel como se fosse produtividade. O `with check` repete a
-- condição para que ela também não possa MUDAR a origem de um
-- registro depois (seria a porta dos fundos da restrição).
--
-- A leitura entra junto, e não é conforto: sem ver o que lançou, ela
-- não confere o fechamento, não libera médico bloqueado e, no F5,
-- perde o detalhe. Ela passa a ver os títulos de produtividade e só
-- eles.
drop policy if exists ver_titulos_produtividade on titulos;
create policy ver_titulos_produtividade on titulos
  for select using (tem_nivel('produtividade', 'V') and origem = 'produtividade');

drop policy if exists criar_titulos_produtividade on titulos;
create policy criar_titulos_produtividade on titulos
  for insert with check (tem_nivel('produtividade', 'M')
    and origem = 'produtividade' and tipo_titulo = 'medicao');

drop policy if exists editar_titulos_produtividade on titulos;
create policy editar_titulos_produtividade on titulos
  for update using (tem_nivel('produtividade', 'M')
                      and origem = 'produtividade' and tipo_titulo = 'medicao')
         with check (tem_nivel('produtividade', 'M')
                      and origem = 'produtividade' and tipo_titulo = 'medicao');

drop policy if exists ver_parcelas_produtividade on parcelas;
create policy ver_parcelas_produtividade on parcelas
  for select using (tem_nivel('produtividade', 'V') and origem = 'produtividade');

drop policy if exists criar_parcelas_produtividade on parcelas;
create policy criar_parcelas_produtividade on parcelas
  for insert with check (tem_nivel('produtividade', 'M') and origem = 'produtividade');

-- O UPDATE da parcela é o bloqueio de pagamento do médico (e o
-- cancelamento do fechamento). Era isto que não gravava quando ela
-- bloqueava alguém por falta de contrato.
drop policy if exists editar_parcelas_produtividade on parcelas;
create policy editar_parcelas_produtividade on parcelas
  for update using (tem_nivel('produtividade', 'M') and origem = 'produtividade')
         with check (tem_nivel('produtividade', 'M') and origem = 'produtividade');


-- ── 2. O mesmo para a folha e o décimo (módulo Pessoal) ─────────
drop policy if exists ver_titulos_dp on titulos;
create policy ver_titulos_dp on titulos
  for select using (tem_nivel('dp', 'V') and origem in ('folha', 'decimo'));

drop policy if exists criar_titulos_dp on titulos;
create policy criar_titulos_dp on titulos
  for insert with check (tem_nivel('dp', 'M') and origem in ('folha', 'decimo')
    and tipo_titulo in ('folha', 'decimo', 'guia'));

drop policy if exists editar_titulos_dp on titulos;
create policy editar_titulos_dp on titulos
  for update using (tem_nivel('dp', 'M') and origem in ('folha', 'decimo')
                      and tipo_titulo in ('folha', 'decimo', 'guia'))
         with check (tem_nivel('dp', 'M') and origem in ('folha', 'decimo')
                      and tipo_titulo in ('folha', 'decimo', 'guia'));

drop policy if exists ver_parcelas_dp on parcelas;
create policy ver_parcelas_dp on parcelas
  for select using (tem_nivel('dp', 'V') and origem in ('folha', 'decimo'));

drop policy if exists criar_parcelas_dp on parcelas;
create policy criar_parcelas_dp on parcelas
  for insert with check (tem_nivel('dp', 'M') and origem in ('folha', 'decimo'));

drop policy if exists editar_parcelas_dp on parcelas;
create policy editar_parcelas_dp on parcelas
  for update using (tem_nivel('dp', 'M') and origem in ('folha', 'decimo'))
         with check (tem_nivel('dp', 'M') and origem in ('folha', 'decimo'));


-- ── 3. O cadastro do favorecido, pelo TIPO ──────────────────────
--
-- A produtividade cadastra MÉDICO: é o arquivo do fechamento que
-- traz CPF, CRM, razão social e chave PIX, e é essa importação que
-- faz a remessa sair sem retrabalho. O DP cadastra o espelho do
-- FUNCIONÁRIO, que é como o salário chega ao contas a pagar.
--
-- Nenhum dos dois alcança fornecedor, órgão ou sócio. E o `with
-- check` no tipo impede o caminho de volta: ninguém converte um
-- fornecedor em médico para poder editá-lo.
--
-- Isto dá à gerência de produtividade o poder de alterar a chave PIX
-- de um médico — que é, afinal, o trabalho dela. O controle não é a
-- permissão, é o RASTRO: toda alteração de cadastro fica registrada
-- com quem fez e o valor anterior (trilha de auditoria), e a
-- importação aponta divergência entre arquivo e cadastro em vez de
-- trocar calada.
drop policy if exists criar_credores_produtividade on credores;
create policy criar_credores_produtividade on credores
  for insert with check (tem_nivel('produtividade', 'M') and tipo = 'medico');

drop policy if exists editar_credores_produtividade on credores;
create policy editar_credores_produtividade on credores
  for update using (tem_nivel('produtividade', 'M') and tipo = 'medico')
         with check (tem_nivel('produtividade', 'M') and tipo = 'medico');

drop policy if exists criar_credores_dp on credores;
create policy criar_credores_dp on credores
  for insert with check (tem_nivel('dp', 'M') and tipo = 'funcionario');

drop policy if exists editar_credores_dp on credores;
create policy editar_credores_dp on credores
  for update using (tem_nivel('dp', 'M') and tipo = 'funcionario')
         with check (tem_nivel('dp', 'M') and tipo = 'funcionario');


-- ── 4. CONFERÊNCIA (uma única saída) ────────────────────────────
drop table if exists diag;
create temp table diag (ordem int, o_que text, resultado text);

insert into diag
select 10, 'politica de ' || p.o || ' em ' || p.t || ' para ' || p.m,
       coalesce((select string_agg(policyname, ', ') from pg_policies
                  where schemaname = 'public' and tablename = p.t and cmd = p.c
                    and policyname like '%' || p.m) , 'NENHUMA — PROBLEMA')
  from (values
    ('leitura','titulos','produtividade','SELECT'),
    ('criacao','titulos','produtividade','INSERT'),
    ('alteracao','titulos','produtividade','UPDATE'),
    ('leitura','parcelas','produtividade','SELECT'),
    ('criacao','parcelas','produtividade','INSERT'),
    ('alteracao','parcelas','produtividade','UPDATE'),
    ('criacao','credores','produtividade','INSERT'),
    ('alteracao','credores','produtividade','UPDATE'),
    ('criacao','titulos','dp','INSERT'),
    ('criacao','parcelas','dp','INSERT'),
    ('criacao','credores','dp','INSERT')
  ) as p(o, t, m, c);

-- E O MAIS ÚTIL DAQUI: quem, no SEU banco, movimenta produtividade
-- ou pessoal, e o que cada um tem nos módulos que a tela toca. É
-- esta lista que diz se o problema era este.
insert into diag
select 50, 'perfil "' || pf.nome || '"',
       'produtividade=' || coalesce((select niveis from matriz_acesso where perfil = pf.id and modulo = 'produtividade'), '—') ||
       ' · pessoal='     || coalesce((select niveis from matriz_acesso where perfil = pf.id and modulo = 'dp'), '—') ||
       ' · financeiro='  || coalesce((select niveis from matriz_acesso where perfil = pf.id and modulo = 'financeiro'), '—') ||
       ' · cadastros='   || coalesce((select niveis from matriz_acesso where perfil = pf.id and modulo = 'cadastros'), '—')
  from perfis pf
 where exists (select 1 from matriz_acesso m
                where m.perfil = pf.id and m.modulo in ('produtividade', 'dp')
                  and m.niveis like '%M%');

insert into diag values
  (90, '>>> PRONTO PARA USAR?',
       case when (select count(*) from pg_policies
                   where schemaname = 'public'
                     and (policyname like '%_produtividade' or policyname like '%_dp')
                     and tablename in ('titulos', 'parcelas', 'credores')) >= 14
            then 'SIM' else 'NAO — veja as linhas acima' end);

select o_que, resultado from diag order by ordem, o_que;
