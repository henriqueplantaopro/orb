-- ══════════════════════════════════════════════════════════════════
-- ATUALIZAR v163 — a exclusão passa a acontecer de verdade
--
-- Rode UMA VEZ, no SQL Editor do Supabase. Pode rodar de novo sem
-- estragar nada: cada política é derrubada e recriada.
--
-- O QUE ELE CONSERTA, E POR QUE NUNCA APARECEU COMO ERRO:
--
-- Excluir contrato, cliente, regra de conciliação ou previsão tirava
-- a linha da tela e não tirava do banco. Atualizando a página, o
-- registro voltava. Nenhum erro, em nenhum módulo, em nenhuma
-- tentativa — e é justamente por isso que o problema voltou tantas
-- vezes: não havia o que ler.
--
-- A causa está no 02-rls.sql. O laço que monta a RLS cria TRÊS
-- políticas por tabela — select, insert, update — e nenhuma de
-- delete. Está escrito lá que é de propósito: "o sistema cancela e
-- estorna, nunca apaga". Isso era verdade quando foi escrito.
-- Depois o sistema ganhou telas que apagam mesmo, e o pedido delas
-- passou a cair no vazio.
--
-- O silêncio tem explicação técnica, e ela importa para não procurar
-- no lugar errado de novo: uma política de exclusão não BARRA o
-- pedido, ela faz a linha não existir para aquele pedido. Apagar
-- nada é sucesso. O Postgres devolve "DELETE 0", o PostgREST
-- devolve 204, o navegador recebe `error: null`. Insert e update
-- recusados devolvem erro; o delete, não.
--
-- Medido num Postgres 16 com esta mesma RLS, com todos os níveis e
-- todas as ações concedidos:
--
--     delete from contratos where id = 'ct1';   ->  DELETE 0
--     select count(*) from contratos ...        ->  1
--
-- Este script cria a política onde o sistema realmente apaga — e só
-- onde ele apaga. O resto do banco continua sem exclusão, que é o
-- desenho: nota, título, pagamento e procedimento se cancelam e se
-- estornam, com rastro.
--
-- A outra ponta da correção está no sistema (v163): a gravação
-- passou a CONFERIR quantas linhas o delete apagou. Mesmo sem este
-- script, a partir da v163 a recusa aparece em vermelho e o registro
-- volta para a tela, em vez de sumir e reaparecer depois.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. contrato e cliente: só a autorização de última instância ──
--
-- É o que a tela já exige (`pode('admin')` no store). A ação `admin`
-- não vem da matriz de propósito — ver o comentário em store.js:
-- ela é a autorização que quebra segregação, e não se deriva de
-- "ter o módulo de Administração".
--
-- As duas tabelas têm quem aponta para elas (`ativos.contrato`,
-- `receber.cliente`, `centros.cliente`) sem cascade: se houver
-- registro dependente, o banco recusa COM ERRO, que agora aparece.
-- A regra de negócio continua no store, que recusa antes e explica
-- melhor; isto aqui é só permissão.
-- O `and tem_nivel(..., 'V')` em todas as políticas desta correção
-- não é zelo: é o que torna a conferência do sistema confiável.
-- Quando o delete volta vazio, o sistema LÊ a linha para saber se
-- foi recusa ou se ela já não estava lá. Um perfil que pudesse
-- apagar e não pudesse ler veria "já não estava lá" onde houve
-- recusa — de volta ao silêncio, por outra porta. Exigindo o V, quem
-- apaga sempre consegue conferir. Na prática não tira o acesso de
-- ninguém: todo perfil que movimenta um módulo também o vê, e a tela
-- de onde se apaga não abre sem o V.
drop policy if exists apagar_contratos on contratos;
create policy apagar_contratos on contratos
  for delete using (tem_acao('admin') and tem_nivel('contratos', 'V'));

drop policy if exists apagar_clientes on clientes;
create policy apagar_clientes on clientes
  for delete using (tem_acao('admin') and tem_nivel('cadastros', 'V'));

-- ── 2. regra de conciliação: quem movimenta o financeiro ────────
--
-- Regra é configuração de apoio: ela sugere o vínculo da linha do
-- extrato, não guarda valor nem histórico. Excluir é o normal dela.
drop policy if exists apagar_regras_conciliacao on regras_conciliacao;
create policy apagar_regras_conciliacao on regras_conciliacao
  for delete using (tem_nivel('financeiro', 'M') and tem_nivel('financeiro', 'V'));

-- ── 3. previsão: faturamento ou financeiro ──────────────────────
--
-- A mesma tabela guarda a previsão de faturamento (esteira) e a de
-- despesa (fluxo). As duas telas apagam, e cada uma responde ao seu
-- módulo — é o que o store já exige: pode('faturar') || pode('lancar').
drop policy if exists apagar_previsoes on previsoes;
create policy apagar_previsoes on previsoes
  for delete using (
    tem_nivel('faturamento', 'V')
    and (tem_nivel('faturamento', 'M') or tem_nivel('financeiro', 'M'))
  );

-- ── 4. parcela: AQUI a política é estreita, e tem de ser ────────
--
-- Esta é a única das cinco em que a política leva condição de
-- estado, e o motivo é o cascade: `pagamentos.parcela_id` aponta
-- para parcela com `on delete cascade`. Cascade roda como DONO da
-- tabela e NÃO passa pela RLS de `pagamentos` — então uma política
-- larga aqui ("quem movimenta o financeiro apaga parcela") daria, a
-- quem abrisse o console do navegador, o poder de apagar PAGAMENTO,
-- que nenhuma política deste banco concede a ninguém.
--
-- Medido no mesmo Postgres: com a política larga, apagar uma parcela
-- paga levou o pagamento junto — pagamentos_restantes = 0.
--
-- O sistema só apaga parcela num caso: a parcela PREVISTA criada por
-- uma previsão de despesa, quando a previsão é excluída
-- (`excluirPrevisaoDespesa`). Essa parcela, por construção, não tem
-- pagamento. A condição abaixo é exatamente esse caso.
--
-- Isto é exceção consciente à regra de que a RLS não aplica regra de
-- negócio (ver o fim do 02-rls.sql). A regra continua no store; esta
-- condição existe porque o estrago, aqui, é irreversível e passa por
-- fora da RLS.
drop policy if exists apagar_parcelas on parcelas;
create policy apagar_parcelas on parcelas
  for delete using (
    tem_nivel('financeiro', 'M')
    and tem_nivel('financeiro', 'V')
    and status = 'previsto'
    and not exists (select 1 from pagamentos p where p.parcela_id = parcelas.id)
  );


-- ── 5. E O CONTRÁRIO: onde havia exclusão de sobra ──────────────
--
-- A verificação que acompanha esta correção confronta os caminhos de
-- exclusão do sistema com as políticas do banco, nas duas direções —
-- e na segunda direção achou poder a mais.
--
-- `folhas` e `funcionarios` têm política `for all` (02-rls.sql), e
-- ALL inclui DELETE. O sistema nunca apaga nenhuma das duas: folha se
-- cancela, funcionário se desliga. Mas o navegador fala direto com o
-- banco, e `for all` ali significa que quem tem Pessoal com alteração
-- podia apagar a folha de um mês inteiro — com os holerites dentro —
-- escrevendo uma linha no console. Isso nunca foi decisão de ninguém;
-- é o `all` sendo largo.
--
-- A trava é uma política RESTRITIVA: ela se SOMA por E (as permissivas
-- se somam por OU), então proíbe o delete sem mexer em mais nada.
-- Trocar o `for all` por insert e update separados daria no mesmo e
-- arriscaria tirar a leitura de algum perfil pelo caminho.
--
-- `perfis` e `matriz_acesso` continuam como estão: ali a exclusão é
-- usada de verdade, pela tela de Administração.
drop policy if exists nao_apagar_folhas on folhas;
create policy nao_apagar_folhas on folhas
  as restrictive for delete using (false);

drop policy if exists nao_apagar_funcionarios on funcionarios;
create policy nao_apagar_funcionarios on funcionarios
  as restrictive for delete using (false);


-- ── 6. CONFERÊNCIA (uma única saída) ────────────────────────────
--
-- O editor do Supabase mostra só o resultado da ÚLTIMA consulta.
-- Então tudo vai para uma tabela temporária e sai de uma vez.
drop table if exists diag;
create temp table diag (ordem int, o_que text, resultado text);

insert into diag
select 10, 'politica de exclusao em ' || t,
       coalesce((select policyname from pg_policies
                  where schemaname = 'public' and tablename = t and cmd = 'DELETE'
                  limit 1), 'NENHUMA — PROBLEMA')
  from unnest(array['contratos','clientes','regras_conciliacao','previsoes','parcelas']) as t;

insert into diag values
  (20, 'a condicao de parcelas protege o pagamento',
       case when exists (select 1 from pg_policies
                          where schemaname = 'public' and tablename = 'parcelas'
                            and cmd = 'DELETE' and qual like '%pagamentos%')
            then 'sim' else 'NAO — a politica de parcelas ficou larga, PROBLEMA' end),
  (25, 'folha e funcionario travados contra exclusao',
       (select count(*)::text || ' de 2' from pg_policies
         where schemaname = 'public' and permissive = 'RESTRICTIVE'
           and cmd = 'DELETE' and tablename in ('folhas', 'funcionarios'))),
  (30, 'tabelas que continuam SEM exclusao para ninguem (o desenho)',
       (select count(*)::text from pg_tables p
         where p.schemaname = 'public'
           and not exists (select 1 from pg_policies o
                            where o.schemaname = 'public' and o.tablename = p.tablename
                              and o.cmd in ('DELETE', 'ALL')))),
  (40, 'contratos no banco agora',
       (select count(*)::text from contratos)),
  (90, '>>> PRONTO PARA USAR?',
       case when (select count(*) from pg_policies
                   where schemaname = 'public' and cmd = 'DELETE'
                     and tablename in ('contratos','clientes','regras_conciliacao',
                                       'previsoes','parcelas')) = 5
            then 'SIM' else 'NAO — veja as linhas acima' end);

select o_que, resultado from diag order by ordem, o_que;
