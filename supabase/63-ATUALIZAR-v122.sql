-- ERP Dom Pedro — etapa 63 (v122)
-- O PERFIL DE ACESSO PASSA A SER GRAVADO PELA TELA.
--
-- RODE NOS DOIS BANCOS, o real e o de testes. É seguro rodar mais
-- de uma vez: tudo aqui é `grant` repetido ou `create policy` com
-- `drop` antes.
--
-- POR QUE ESTA ETAPA EXISTE
--
-- Até a v121 a tabela `perfis` era LIDA na entrada e nunca
-- gravada. O perfil criado no módulo de Administração vivia só na
-- memória do navegador: a tela dizia "Perfil salvo" e o primeiro
-- F5 o apagava. E como `usuarios.perfil` aponta para `perfis(id)`,
-- o usuário criado logo depois batia na chave estrangeira e também
-- não gravava — dois cadastros perdidos de uma vez.
--
-- A correção é no sistema (v122). Este arquivo só garante que o
-- banco deixa a Administração escrever, porque de nada adianta a
-- tela mandar se o banco recusar. Se as permissões já estiverem
-- certas, este script não muda nada — e diz isso na conferência.
--
-- NÃO há coluna nova. Os módulos que o perfil enxerga NÃO viram
-- campo em `perfis`: eles são linhas em `matriz_acesso`, que é
-- quem o sistema consulta. Guardar a mesma informação nos dois
-- lugares era o defeito antigo do campo `modulos`, que ninguém
-- lia.

-- ══════════════════════════════════════════════════════════
-- 1 · a Administração pode escrever em `perfis`
-- ══════════════════════════════════════════════════════════
grant select, insert, update, delete on perfis to authenticated;
grant select, insert, update, delete on matriz_acesso to authenticated;

-- A política diz QUEM, dentro de `authenticated`, pode escrever:
-- só quem movimenta Administração. O `to authenticated` explícito
-- é o mesmo ajuste que a etapa 35 fez na matriz.
drop policy if exists mexer_perfis on perfis;
create policy mexer_perfis on perfis
  for all to authenticated
  using (tem_nivel('administracao', 'M'))
  with check (tem_nivel('administracao', 'M'));

drop policy if exists ver_perfis on perfis;
create policy ver_perfis on perfis
  for select to authenticated
  using (app_usuario() is not null);

-- ══════════════════════════════════════════════════════════
-- 2 · perfil sem linha na matriz entra vendo tela vazia
-- ══════════════════════════════════════════════════════════
--
-- Se algum perfil foi criado antes desta correção e ficou sem
-- matriz, ele existe e não enxerga nada. Aqui ele ganha o mínimo
-- honesto — ver Cadastros —, para aparecer na tela e poder ser
-- ajustado pela Administração em vez de parecer quebrado.
insert into matriz_acesso (perfil, modulo, niveis)
select p.id, 'cadastros', 'V'
  from perfis p
 where not exists (select 1 from matriz_acesso m
                    where m.perfil = p.id and coalesce(m.niveis, '') <> '')
on conflict (perfil, modulo) do nothing;

-- ══════════════════════════════════════════════════════════
-- CONFERÊNCIA — uma única saída
-- ══════════════════════════════════════════════════════════
--
-- O editor do Supabase mostra só o resultado da ÚLTIMA consulta.
drop table if exists diag;
create temp table diag (ordem int, o_que text, resultado text);

insert into diag values
  (10, 'a Administracao pode INSERIR perfil',
       case when has_table_privilege('authenticated', 'perfis', 'INSERT')
            then 'sim' else 'NAO' end),
  (11, 'a Administracao pode ALTERAR perfil',
       case when has_table_privilege('authenticated', 'perfis', 'UPDATE')
            then 'sim' else 'NAO' end),
  (12, 'a Administracao pode EXCLUIR perfil',
       case when has_table_privilege('authenticated', 'perfis', 'DELETE')
            then 'sim' else 'NAO' end),
  (13, 'a Administracao pode escrever na matriz',
       case when has_table_privilege('authenticated', 'matriz_acesso', 'INSERT')
             and has_table_privilege('authenticated', 'matriz_acesso', 'UPDATE')
            then 'sim' else 'NAO' end),
  (20, 'politicas de escrita em perfis (esperado 1)',
       (select count(*)::text from pg_policies
         where tablename = 'perfis' and policyname = 'mexer_perfis')),
  (30, 'perfis cadastrados', (select count(*)::text from perfis)),
  (31, 'perfis SEM nenhum modulo na matriz',
       (select count(*)::text from perfis p
         where not exists (select 1 from matriz_acesso m
                            where m.perfil = p.id and coalesce(m.niveis,'') <> ''))),
  (40, 'usuarios cadastrados', (select count(*)::text from usuarios));

insert into diag
select 50, 'perfil ' || p.id,
       coalesce((select string_agg(m.modulo || '=' || m.niveis, ', ' order by m.modulo)
                   from matriz_acesso m
                  where m.perfil = p.id and coalesce(m.niveis,'') <> ''),
                'nenhum modulo')
  from perfis p;

insert into diag values
  (90, '>>> PRONTO PARA CRIAR PERFIL PELA TELA?',
       case when has_table_privilege('authenticated', 'perfis', 'INSERT')
             and has_table_privilege('authenticated', 'perfis', 'UPDATE')
             and has_table_privilege('authenticated', 'matriz_acesso', 'INSERT')
             and exists (select 1 from pg_policies
                          where tablename = 'perfis' and policyname = 'mexer_perfis')
            then 'SIM' else 'NAO — veja as linhas acima' end);

select o_que, resultado from diag order by ordem, o_que;
