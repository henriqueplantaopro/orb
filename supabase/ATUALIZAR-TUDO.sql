-- ERP Dom Pedro — ATUALIZAÇÃO COMPLETA DO BANCO
-- Reúne as etapas 06 a 12 num arquivo só, na ordem certa.
--
-- COMO USAR: cole tudo no SQL Editor do Supabase e rode UMA vez.
-- Ao terminar, confira com:
--
--   select * from verificar_instalacao() where resultado <> 'ok';
--
-- PODE RODAR DE NOVO sem medo. Tudo aqui é idempotente: as colunas
-- usam `if not exists`, as funções usam `create or replace`, as
-- visões são recriadas, e os `update` só tocam o que está nulo. Se
-- você não souber se já rodou alguma parte, rode o arquivo inteiro.
--
-- O QUE CADA PEDAÇO FAZ:
--   06  colunas `extra` nas tabelas do financeiro
--   07  reserva de ids em bloco (carga rápida)
--   08  hierarquia do plano de contas (o combo de natureza)
--   09  senha provisória com troca obrigatória
--   10  colunas `extra` nos demais módulos + especialidade da sala
--   11  visões completas (leitura sem expor o nome do paciente)
--   12  gravação atômica do estoque + limpeza de resíduo
--   13  destrava a escrita (coluna `estornado`, upsert com coluna
--       fechada) e remove o saldo que ficou sem lastro
--   14  corrige a função do estoque: chave ausente no JSON virava
--       NULL explícito e ignorava o DEFAULT da coluna
--   15  motivo do cancelamento onde faltava (fechamentos, lotes,
--       folhas): o modal pedia e o texto não tinha onde morar
--   16  destrava competências que ficaram presas em "fechado" sem
--       nenhum fechamento ativo
--   17  dois usuários de teste (acesso total e sem dados de
--       paciente), com senha provisória
--   18  vínculo automático do login: cadastrar usuário deixa de
--       exigir SQL
--   19  visões passam a ser só de leitura: a escrita era barrada
--       por acaso, não por política
--
-- NÃO inclui 01, 02, 03 e 04 (estrutura, políticas, cadastros e
-- permissões de coluna): esses já rodaram e recriá-los sem
-- necessidade mexeria em coisa que está funcionando.



-- ====================================================================
-- ETAPA 06 — 06-persistencia.sql
-- ====================================================================

-- ERP Dom Pedro — ajustes para guardar o movimento
-- Etapa 6. Roda depois dos anteriores, em qualquer momento.
--
-- O sistema guarda, em alguns registros, campos que o esquema não
-- previu: o anexo da nota numa parcela, o código de barras do
-- boleto, o motivo de um cancelamento. São poucos e variam por
-- caso.
--
-- Duas saídas possíveis. Criar uma coluna para cada um deixaria a
-- tabela larga e obrigaria a mexer no banco a cada campo novo da
-- aplicação. A outra é uma coluna `extra` em JSON, que recebe o que
-- não tem lugar próprio.
--
-- Escolhi a segunda, com uma regra: o que se CONSULTA, FILTRA ou
-- SOMA tem coluna de verdade (valor, vencimento, status, centro). O
-- `extra` é só para o que anda junto do registro e nunca aparece
-- num `where`. Assim o banco continua consultável, e o sistema não
-- perde dado por falta de coluna.

alter table titulos                 add column if not exists extra jsonb not null default '{}'::jsonb;
alter table parcelas                add column if not exists extra jsonb not null default '{}'::jsonb;
alter table pagamentos              add column if not exists extra jsonb not null default '{}'::jsonb;
alter table receber                 add column if not exists extra jsonb not null default '{}'::jsonb;
alter table previsoes               add column if not exists extra jsonb not null default '{}'::jsonb;
alter table contratos               add column if not exists extra jsonb not null default '{}'::jsonb;
alter table retencoes_registradas   add column if not exists extra jsonb not null default '{}'::jsonb;
alter table guias_retencao          add column if not exists extra jsonb not null default '{}'::jsonb;
alter table transferencias_banco    add column if not exists extra jsonb not null default '{}'::jsonb;
alter table extratos                add column if not exists extra jsonb not null default '{}'::jsonb;
alter table linhas_extrato          add column if not exists extra jsonb not null default '{}'::jsonb;
alter table saldos_informados       add column if not exists extra jsonb not null default '{}'::jsonb;
alter table regras_conciliacao      add column if not exists extra jsonb not null default '{}'::jsonb;

-- A trilha de auditoria recebe o id gerado pela aplicação. Sem
-- isso, dois eventos gravados no mesmo instante por pessoas
-- diferentes disputariam a mesma chave.
alter table eventos add column if not exists app_id text;
create unique index if not exists eventos_app_id_uk on eventos (app_id) where app_id is not null;

-- Conferência:
--   select count(*) from information_schema.columns
--    where table_name = 'parcelas' and column_name = 'extra';
--   -- esperado: 1


-- ====================================================================
-- ETAPA 07 — 07-ids.sql
-- ====================================================================

-- ERP Dom Pedro — reserva de ids em bloco
-- Etapa 7. Roda depois dos anteriores.
--
-- A `proximo_id` entrega um id por chamada. Na carga inicial o
-- sistema precisa de um punhado deles adiantado, e pedir um por vez
-- significava vinte idas e voltas pela rede — uns quinze segundos
-- em que o sistema parecia carregado mas ainda não gravava.
--
-- Esta função reserva um BLOCO de uma vez e devolve o primeiro
-- número. O cliente usa de `inicio` até `inicio + qtd - 1` sem
-- falar com o banco de novo, e ninguém mais recebe esses números.

create or replace function reservar_ids(qtd int)
returns bigint language plpgsql security definer as $$
declare inicio bigint;
begin
  if app_usuario() is null then
    raise exception 'sem usuário autenticado';
  end if;
  if qtd is null or qtd < 1 or qtd > 1000 then
    raise exception 'quantidade fora do intervalo (1 a 1000)';
  end if;
  update sequencia set valor = valor + qtd where id = 1
    returning valor - qtd + 1 into inicio;
  return inicio;
end $$;

revoke all on function reservar_ids(int) from public, anon;
grant execute on function reservar_ids(int) to authenticated;

-- Conferência (como usuário logado):
--   select reservar_ids(5);   -- devolve o primeiro de um bloco de 5


-- ====================================================================
-- ETAPA 08 — 08-plano-pai.sql
-- ====================================================================

-- ERP Dom Pedro — hierarquia do plano de contas
-- Etapa 8. Roda depois dos anteriores.
--
-- O sistema agrupa as contas pelo campo `pai`: o combo de natureza
-- mostra cada grupo de nível 1 com as suas contas dentro. A coluna
-- faltou no esquema, e o resultado foi um combo com os dez grupos e
-- nenhuma conta — o lançamento ficou impossível.
--
-- O `pai` é derivável do código (6.07 pertence ao 6), e por um
-- instante pensei em calcular na aplicação. Mas aí a regra passaria
-- a existir em dois lugares: no banco, implícita no código da
-- conta, e no JavaScript, explícita. Coluna de verdade, preenchida
-- uma vez, é mais simples de conferir.

alter table plano_contas add column if not exists pai text references plano_contas (cod);

-- Preenche a partir do código: tudo antes do primeiro ponto.
update plano_contas
   set pai = split_part(cod, '.', 1)
 where nivel > 1
   and pai is null
   and split_part(cod, '.', 1) <> cod
   and exists (select 1 from plano_contas p2 where p2.cod = split_part(plano_contas.cod, '.', 1));

-- Conferência:
--   select count(*) from plano_contas where nivel > 1 and pai is null;
--   -- esperado: 0
--   select cod, nome, pai from plano_contas where nivel > 1 order by cod limit 5;


-- ====================================================================
-- ETAPA 09 — 09-senha-provisoria.sql
-- ====================================================================

-- ERP Dom Pedro — senha provisória
-- Etapa 9. Roda depois dos anteriores.
--
-- Fluxo: quando alguém esquece a senha, o administrador define uma
-- provisória pelo painel do Supabase e marca o usuário aqui. No
-- próximo acesso, o sistema EXIGE a troca antes de deixar usar
-- qualquer coisa.
--
-- O efeito importante é o que o próprio dono pediu: o administrador
-- deixa de saber a senha de alguém assim que a pessoa entra. Senha
-- que o administrador conhece não serve de prova de autoria — se um
-- pagamento foi aprovado com o login de outra pessoa e você sabia a
-- senha dela, a trilha perde valor como prova.

alter table usuarios add column if not exists senha_provisoria boolean not null default false;

-- Quem marca é a Administração, pela tela — a política de update
-- de `usuarios` já cobre isso.
--
-- Quem DESMARCA é a própria pessoa, ao trocar a senha. E aí há um
-- problema: a política proíbe alguém de alterar o próprio registro,
-- justamente para ninguém se promover. A saída é esta função, que
-- roda com privilégio e mexe em UM campo só — não dá para usá-la
-- para virar administrador.
create or replace function marcar_senha_trocada()
returns void language plpgsql security definer as $$
begin
  if app_usuario() is null then
    raise exception 'sem usuário autenticado';
  end if;
  update usuarios set senha_provisoria = false where id = app_usuario();
end $$;

revoke all on function marcar_senha_trocada() from public, anon;
grant execute on function marcar_senha_trocada() to authenticated;

-- Conferência:
--   select id, nome, senha_provisoria from usuarios order by id;


-- ====================================================================
-- ETAPA 10 — 10-modulos.sql
-- ====================================================================

-- ERP Dom Pedro — gravação dos demais módulos
-- Etapa 10. Roda depois dos anteriores.
--
-- O 06 preparou as tabelas do financeiro. Estas são as de estoque,
-- procedimentos, compras, ativos e pessoal, pelo mesmo critério: o
-- que se consulta tem coluna, o resto vai em `extra`.

alter table estoque_camadas           add column if not exists extra jsonb not null default '{}'::jsonb;
alter table estoque_movimentos        add column if not exists extra jsonb not null default '{}'::jsonb;
alter table procedimentos             add column if not exists extra jsonb not null default '{}'::jsonb;
alter table fechamentos_procedimentos add column if not exists extra jsonb not null default '{}'::jsonb;
alter table compras                   add column if not exists extra jsonb not null default '{}'::jsonb;
alter table ativos                    add column if not exists extra jsonb not null default '{}'::jsonb;
alter table ativo_movimentos          add column if not exists extra jsonb not null default '{}'::jsonb;
alter table ordens_servico            add column if not exists extra jsonb not null default '{}'::jsonb;
alter table lotes_produtividade       add column if not exists extra jsonb not null default '{}'::jsonb;
alter table lotes_rps                 add column if not exists extra jsonb not null default '{}'::jsonb;
alter table folhas                    add column if not exists extra jsonb not null default '{}'::jsonb;
alter table decimos                   add column if not exists extra jsonb not null default '{}'::jsonb;
alter table posicoes_estoque          add column if not exists extra jsonb not null default '{}'::jsonb;
alter table minimos_estoque           add column if not exists extra jsonb not null default '{}'::jsonb;

-- Conferência:
--   select count(*) from information_schema.columns
--    where column_name = 'extra' and table_schema = 'public';
--   -- esperado: 27

-- ── campo que faltou nos armazéns ──────────────────────
--
-- Cada sala de centro cirúrgico é ligada a uma especialidade, e é
-- isso que faz o sistema saber de qual estoque baixar o material da
-- cirurgia. A coluna não foi para o esquema, e o resultado foi o
-- módulo de Procedimentos calculando o repasse mas não deixando
-- lançar material nenhum — que é o ponto do módulo.
--
-- Mesmo caso do `pai` no plano de contas: campo que existia no
-- cadastro embutido e não foi transcrito.

alter table armazens add column if not exists especialidade text;

update armazens set especialidade = 'OFTALMO'        where id = 'am06' and especialidade is null;
update armazens set especialidade = 'CIRURGIA GERAL' where id = 'am07' and especialidade is null;
update armazens set especialidade = 'RISCO CX'       where id = 'am08' and especialidade is null;
update armazens set especialidade = 'UROLOGIA'       where id = 'am09' and especialidade is null;
update armazens set especialidade = 'OTORRINO'       where id = 'am10' and especialidade is null;
update armazens set especialidade = 'GINECO'         where id = 'am11' and especialidade is null;

-- Conferência:
--   select id, nome, especialidade from armazens where especialidade is not null;
--   -- esperado: 6 salas


-- ====================================================================
-- ETAPA 11 — 11-visoes-completas.sql
-- ====================================================================

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


-- ====================================================================
-- ETAPA 12 — 12-estoque-atomico.sql
-- ====================================================================

-- ERP Dom Pedro — gravação atômica do estoque
-- Etapa 12. Roda depois dos anteriores.
--
-- A etapa 11 impediu o saldo de gravar sem as camadas e os
-- movimentos. Faltava metade: as CAMADAS continuavam gravando
-- sozinhas, e sobraram camadas no banco sem movimento e sem
-- posição.
--
-- A regra certa é "os três ou nenhum", e isso não se resolve no
-- cliente: três chamadas HTTP são três transações, e a segunda pode
-- falhar depois de a primeira ter gravado. Precisa ser UMA
-- transação, e transação é coisa do banco.
--
-- Esta função recebe os três conjuntos e grava tudo junto. Qualquer
-- erro desfaz o bloco inteiro — é o `rollback` implícito de uma
-- função PL/pgSQL.

create or replace function gravar_estoque(
  p_camadas jsonb default '[]'::jsonb,
  p_movimentos jsonb default '[]'::jsonb,
  p_posicoes jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer as $$
declare
  n_cam int := 0;
  n_mov int := 0;
  n_pos int := 0;
begin
  if app_usuario() is null then
    raise exception 'sem usuário autenticado';
  end if;
  /* A permissão é a mesma da tela: quem não movimenta estoque não
     grava por aqui. A função roda com privilégio para poder
     escrever na coluna `paciente`, que está revogada — não para
     contornar a matriz de acesso. */
  if not tem_nivel('estoque', 'M') then
    raise exception 'seu perfil não movimenta estoque';
  end if;

  if jsonb_array_length(p_camadas) > 0 then
    insert into estoque_camadas
    select * from jsonb_populate_recordset(null::estoque_camadas, p_camadas)
    on conflict (id) do update set
      qtd = excluded.qtd, custo = excluded.custo, armazem = excluded.armazem,
      lote = excluded.lote, validade = excluded.validade, extra = excluded.extra;
    get diagnostics n_cam = row_count;
  end if;

  if jsonb_array_length(p_movimentos) > 0 then
    insert into estoque_movimentos
    select * from jsonb_populate_recordset(null::estoque_movimentos, p_movimentos)
    on conflict (id) do update set
      qtd = excluded.qtd, custo = excluded.custo, valor = excluded.valor,
      estornado = excluded.estornado, medio_depois = excluded.medio_depois,
      extra = excluded.extra;
    get diagnostics n_mov = row_count;
  end if;

  if jsonb_array_length(p_posicoes) > 0 then
    insert into posicoes_estoque (produto, armazem, saldo, valor)
    select (x->>'produto')::text, (x->>'armazem')::text,
           coalesce((x->>'saldo')::numeric, 0), coalesce((x->>'valor')::numeric, 0)
      from jsonb_array_elements(p_posicoes) x
    on conflict (produto, armazem) do update set
      saldo = excluded.saldo, valor = excluded.valor;
    get diagnostics n_pos = row_count;
  end if;

  return jsonb_build_object('camadas', n_cam, 'movimentos', n_mov, 'posicoes', n_pos);
end $$;

revoke all on function gravar_estoque(jsonb, jsonb, jsonb) from public, anon;
grant execute on function gravar_estoque(jsonb, jsonb, jsonb) to authenticated;

-- ── limpeza do resíduo das rodadas anteriores ──────────
--
-- 154 posições zeradas que versões antigas gravaram, e 5 camadas
-- órfãs (sem movimento e sem posição). Nada disso é dado do
-- cliente: é sujeira de teste.

delete from posicoes_estoque where coalesce(saldo, 0) = 0 and coalesce(valor, 0) = 0;

delete from estoque_camadas c
 where not exists (select 1 from estoque_movimentos m where m.produto = c.produto
                     and m.armazem = c.armazem)
   and not exists (select 1 from posicoes_estoque p where p.produto = c.produto
                     and p.armazem = c.armazem and coalesce(p.saldo, 0) <> 0);

-- Conferência:
--   select count(*) from posicoes_estoque;      -- só as com saldo
--   select count(*) from estoque_camadas;       -- sem órfãs


-- ====================================================================
-- ETAPA 13 — 13-escrita-colunas.sql
-- ====================================================================

-- ERP Dom Pedro — destravar a escrita
-- Etapa 13.
--
-- Dois bloqueios que a auditoria isolou, e a limpeza que faltou.

-- ── 1. `estornado` sem default ─────────────────────────
--
-- A função `gravar_estoque` monta o INSERT no SQL, então a rede que
-- preenche obrigatórias no cliente não a alcança. A coluna ganha
-- default: é o lugar certo para "todo movimento nasce não
-- estornado".

alter table estoque_movimentos alter column estornado set default false;
update estoque_movimentos set estornado = false where estornado is null;

-- Mesmo cuidado nas outras colunas que nascem com valor conhecido.
alter table procedimentos      alter column cancelado set default false;
alter table estoque_camadas    alter column qtd set default 0;
alter table parcelas           alter column valor_pago set default 0;

-- ── 2. O 42501 do upsert em `procedimentos` ────────────
--
-- Diagnóstico da auditoria, confirmado coluna a coluna: o upsert
-- vira `insert ... on conflict (id) do update set ... paciente =
-- excluded.paciente`, e isso exige UPDATE na coluna `paciente`. O
-- INSERT puro passa; falta só o UPDATE.
--
-- A saída é dar UPDATE sem dar SELECT. Escrever e não poder ler é
-- exatamente o que se quer aqui: a aplicação grava o nome do
-- paciente que ela mesma acabou de receber do formulário, e segue
-- sem conseguir lê-lo de volta — quem lê é a visão, conforme a
-- permissão de cada um.
--
-- A outra saída seria mais uma função com privilégio. Preferi esta:
-- menos código com privilégio é menos lugar onde um erro futuro
-- vira brecha.

grant update (paciente, faturamento, repasse, custo_material, imposto, imposto_pct, resultado)
  on procedimentos to authenticated;

grant update (paciente, custo, custo_nota, valor, medio_depois)
  on estoque_movimentos to authenticated;

-- Conferência do que NÃO mudou (a leitura segue fechada):
--   select paciente from procedimentos limit 1;   -- 42501, como antes

-- ── 3. As 5 posições que ficaram sem lastro ────────────
--
-- A limpeza anterior tirou as camadas órfãs e deixou as posições
-- com saldo — que, sem camada e sem movimento, viraram justamente o
-- saldo sem lastro que a trava existe para impedir. Criado pela
-- própria limpeza.
--
-- Some com elas. O estoque real entra pelo inventário inicial, que
-- é o caminho que registra camada, movimento e saldo juntos.

delete from posicoes_estoque p
 where not exists (select 1 from estoque_movimentos m
                    where m.produto = p.produto and m.armazem = p.armazem)
   and not exists (select 1 from estoque_camadas c
                    where c.produto = p.produto and c.armazem = p.armazem);

-- Conferência:
--   select count(*) from posicoes_estoque;   -- 0 num banco sem inventário


-- ====================================================================
-- ETAPA 14 — 14-estoque-defaults.sql
-- ====================================================================

-- ERP Dom Pedro — a função do estoque e os valores padrão
-- Etapa 14.
--
-- A auditoria levantou a hipótese certa: `jsonb_populate_recordset`
-- transforma chave AUSENTE no JSON em NULL EXPLÍCITO, e NULL
-- explícito não aciona o DEFAULT da coluna. Então
-- `alter column estornado set default false` não resolve nada
-- quando o INSERT vem por esse caminho — a coluna continua
-- recebendo NULL e o NOT NULL estoura.
--
-- Aqui a função passa a aplicar `coalesce` nas colunas que o banco
-- exige preenchidas, em vez de confiar no default. O default
-- continua lá e serve para quem inserir por outro caminho.

create or replace function gravar_estoque(
  p_camadas jsonb default '[]'::jsonb,
  p_movimentos jsonb default '[]'::jsonb,
  p_posicoes jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer as $$
declare
  n_cam int := 0;
  n_mov int := 0;
  n_pos int := 0;
begin
  if app_usuario() is null then
    raise exception 'sem usuário autenticado';
  end if;
  if not tem_nivel('estoque', 'M') then
    raise exception 'seu perfil não movimenta estoque';
  end if;

  if jsonb_array_length(p_camadas) > 0 then
    insert into estoque_camadas as d
      (id, produto, armazem, qtd, custo, data, data_nf, lote, validade,
       origem, documento, nota_chave, pedido_id, grupo, lancado_em, extra)
    select x.id, x.produto, x.armazem,
           coalesce(x.qtd, 0), coalesce(x.custo, 0),
           coalesce(x.data, current_date), x.data_nf, x.lote, x.validade,
           x.origem, x.documento, x.nota_chave, x.pedido_id, x.grupo,
           coalesce(x.lancado_em, now()), coalesce(x.extra, '{}'::jsonb)
      from jsonb_populate_recordset(null::estoque_camadas, p_camadas) x
    on conflict (id) do update set
      qtd = excluded.qtd, custo = excluded.custo, armazem = excluded.armazem,
      lote = excluded.lote, validade = excluded.validade, extra = excluded.extra;
    get diagnostics n_cam = row_count;
  end if;

  if jsonb_array_length(p_movimentos) > 0 then
    insert into estoque_movimentos as d
      (id, tipo, produto, armazem, qtd, qtd_nota, unidades_por_embalagem,
       custo, custo_nota, valor, medio_depois, data, data_nf, motivo, documento,
       lote, validade, origem, grupo, pedido_id, paciente, estornado,
       usuario, usuario_id, lancado_em, extra)
    select x.id, x.tipo, x.produto, x.armazem, coalesce(x.qtd, 0), x.qtd_nota,
           x.unidades_por_embalagem, x.custo, x.custo_nota, x.valor, x.medio_depois,
           coalesce(x.data, current_date), x.data_nf, x.motivo, x.documento,
           x.lote, x.validade, x.origem, x.grupo, x.pedido_id, x.paciente,
           /* O ponto da etapa: chave ausente virava NULL explícito e
              derrubava a gravação inteira do estoque. */
           coalesce(x.estornado, false),
           x.usuario, x.usuario_id, coalesce(x.lancado_em, now()),
           coalesce(x.extra, '{}'::jsonb)
      from jsonb_populate_recordset(null::estoque_movimentos, p_movimentos) x
    on conflict (id) do update set
      qtd = excluded.qtd, custo = excluded.custo, valor = excluded.valor,
      estornado = coalesce(excluded.estornado, false),
      medio_depois = excluded.medio_depois, extra = excluded.extra;
    get diagnostics n_mov = row_count;
  end if;

  if jsonb_array_length(p_posicoes) > 0 then
    insert into posicoes_estoque (produto, armazem, saldo, valor)
    select (x->>'produto')::text, (x->>'armazem')::text,
           coalesce((x->>'saldo')::numeric, 0), coalesce((x->>'valor')::numeric, 0)
      from jsonb_array_elements(p_posicoes) x
    on conflict (produto, armazem) do update set
      saldo = excluded.saldo, valor = excluded.valor;
    get diagnostics n_pos = row_count;
  end if;

  return jsonb_build_object('camadas', n_cam, 'movimentos', n_mov, 'posicoes', n_pos);
end $$;

revoke all on function gravar_estoque(jsonb, jsonb, jsonb) from public, anon;
grant execute on function gravar_estoque(jsonb, jsonb, jsonb) to authenticated;

-- Conferência rápida (logado, não grava nada de verdade):
--   select gravar_estoque('[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
--   -- esperado: {"camadas": 0, "movimentos": 0, "posicoes": 0}


-- ====================================================================
-- ETAPA 15 — 15-motivo-cancelamento.sql
-- ====================================================================

-- ERP Dom Pedro — o motivo do cancelamento onde faltava
-- Etapa 15.
--
-- A correção do booleano veio completa em `procedimentos`, onde o
-- motivo já tinha coluna. Em `fechamentos_procedimentos` não: o
-- modal pede o motivo, a pessoa digita, e ele não tinha onde
-- morar. Cancelar o fechamento de uma competência inteira é
-- justamente o tipo de ato em que o "por quê" importa mais que o
-- "quando".

alter table fechamentos_procedimentos
  add column if not exists motivo_cancelamento text,
  add column if not exists cancelado_em date,
  add column if not exists cancelado_por text,
  add column if not exists refaz text;

-- O mesmo nas outras tabelas que cancelam e ainda não registravam
-- o porquê.
alter table lotes_produtividade
  add column if not exists motivo_cancelamento text,
  add column if not exists cancelado_em date,
  add column if not exists cancelado_por text;

alter table folhas
  add column if not exists motivo_cancelamento text,
  add column if not exists cancelado_em date,
  add column if not exists cancelado_por text;

-- Conferência:
--   select column_name from information_schema.columns
--    where table_name = 'fechamentos_procedimentos'
--      and column_name like 'cancelado%' or column_name = 'motivo_cancelamento';


-- ====================================================================
-- ETAPA 16 — 16-previsoes-presas.sql
-- ====================================================================

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


-- ====================================================================
-- ETAPA 17 — 17-usuarios-teste.sql
-- ====================================================================

-- ERP Dom Pedro — usuários de teste
-- Etapa 17. Roda depois dos anteriores.
--
-- Dois logins para o mesmo e-mail, usando o "+" que o Gmail aceita:
-- tudo que chega em henrique.jmbr+algo@gmail.com cai na mesma caixa,
-- e para o sistema são contas diferentes.
--
--   u90  Administração  — acesso total, para você testar à vontade
--   u91  Consulta       — SEM `ver_pacientes`, que é o perfil que
--                         falta para fechar o teste do mascaramento
--
-- O segundo é o que importa para a auditoria: com acesso total o
-- nome do paciente aparece normalmente, e aí o teste não prova nada.
-- É preciso ver em branco para quem não pode ver.

insert into usuarios (id, nome, perfil, email, ativo, senha_provisoria)
values ('u90', 'Henrique (teste — acesso total)', 'admin',
        'henrique.jmbr+adm@gmail.com', true, true)
on conflict (id) do update set
  nome = excluded.nome, perfil = excluded.perfil, email = excluded.email,
  ativo = true, senha_provisoria = true;

insert into usuarios (id, nome, perfil, email, ativo, senha_provisoria)
values ('u91', 'Henrique (teste — sem dados de paciente)', 'consulta',
        'henrique.jmbr+consulta@gmail.com', true, true)
on conflict (id) do update set
  nome = excluded.nome, perfil = excluded.perfil, email = excluded.email,
  ativo = true, senha_provisoria = true;

-- Depois de criar os dois logins no painel (Authentication › Users),
-- este comando liga cada login ao usuário do sistema:
--
--   update usuarios
--      set auth_id = (select id from auth.users where email = usuarios.email)
--    where email is not null and auth_id is null;
--
-- Conferência:
--   select id, nome, perfil, email,
--          case when auth_id is null then 'SEM LOGIN' else 'ok' end as login,
--          senha_provisoria
--     from usuarios where id in ('u90','u91');


-- ====================================================================
-- ETAPA 18 — 18-vincular-login.sql
-- ====================================================================

-- ERP Dom Pedro — vínculo automático do login
-- Etapa 18.
--
-- O cadastro de usuário pela tela gravava a pessoa e o perfil, mas
-- o `auth_id` — que liga o login ao usuário do sistema — só era
-- preenchido por SQL. Na prática, cadastrar alguém exigia abrir o
-- SQL Editor, e o módulo de Administração virava meia ferramenta.
--
-- Estas funções tiram o SQL do caminho. O que continua no painel do
-- Supabase é a CRIAÇÃO da credencial em si, e isso é de propósito:
-- criar login pelo navegador exigiria a chave de administração do
-- banco no código do cliente, e quem abrisse o console teria acesso
-- total.

/* Liga o usuário do sistema ao login de mesmo e-mail, se existir.
   Devolve o que aconteceu, para a tela poder dizer à pessoa. */
create or replace function vincular_login(p_email text)
returns jsonb language plpgsql security definer as $$
declare
  v_auth uuid;
  v_user text;
begin
  if app_usuario() is null then
    raise exception 'sem usuário autenticado';
  end if;
  if not tem_nivel('administracao', 'M') then
    raise exception 'só a Administração vincula login';
  end if;
  if p_email is null or btrim(p_email) = '' then
    return jsonb_build_object('ok', false, 'motivo', 'sem e-mail');
  end if;

  select id into v_auth from auth.users where lower(email) = lower(btrim(p_email));
  if v_auth is null then
    return jsonb_build_object('ok', false, 'motivo', 'login_nao_existe');
  end if;

  select id into v_user from usuarios where lower(email) = lower(btrim(p_email));
  if v_user is null then
    return jsonb_build_object('ok', false, 'motivo', 'usuario_nao_existe');
  end if;

  update usuarios set auth_id = v_auth where id = v_user;
  return jsonb_build_object('ok', true, 'usuario', v_user);
end $$;

revoke all on function vincular_login(text) from public, anon;
grant execute on function vincular_login(text) to authenticated;

/* Quem já tem login e quem não tem. A tela usa para mostrar o
   estado de cada pessoa sem ninguém precisar consultar o banco. */
create or replace function status_logins()
returns table (id text, nome text, email text, tem_login boolean, senha_provisoria boolean)
language plpgsql security definer as $$
begin
  if app_usuario() is null then
    raise exception 'sem usuário autenticado';
  end if;
  if not tem_nivel('administracao', 'V') then
    raise exception 'sem acesso à Administração';
  end if;
  return query
    select u.id, u.nome, u.email,
           (u.auth_id is not null
             or exists (select 1 from auth.users a
                         where lower(a.email) = lower(coalesce(u.email, '')))) as tem_login,
           coalesce(u.senha_provisoria, false)
      from usuarios u
     order by (regexp_replace(u.id, '\D', '', 'g'))::int;
end $$;

revoke all on function status_logins() from public, anon;
grant execute on function status_logins() to authenticated;

/* Varredura: liga tudo que der, de uma vez. É o que antes se fazia
   com um `update ... from auth.users` colado no SQL Editor. */
create or replace function vincular_logins_pendentes()
returns int language plpgsql security definer as $$
declare n int;
begin
  if app_usuario() is null then
    raise exception 'sem usuário autenticado';
  end if;
  if not tem_nivel('administracao', 'M') then
    raise exception 'só a Administração vincula login';
  end if;
  update usuarios u
     set auth_id = a.id
    from auth.users a
   where u.auth_id is null
     and u.email is not null
     and lower(a.email) = lower(u.email);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function vincular_logins_pendentes() from public, anon;
grant execute on function vincular_logins_pendentes() to authenticated;


-- ====================================================================
-- ETAPA 19 — 19-views-somente-leitura.sql
-- ====================================================================

-- ERP Dom Pedro — visões só de leitura
-- Etapa 19.
--
-- A auditoria encontrou isto: o insert pela visão
-- `funcionarios_publico` NÃO era barrado por política — ele
-- avançava e só parava nas colunas obrigatórias da tabela-base,
-- uma de cada vez. O que segurava era a ausência de `salario_base`
-- na visão, não uma negação.
--
-- Funciona hoje e deixa de funcionar no dia em que alguém der um
-- DEFAULT àquela coluna ou acrescentar um campo à visão. Proteção
-- por acidente não é proteção: ninguém decidiu, e por isso ninguém
-- vai lembrar de conferir.
--
-- As visões existem para LER. A escrita passa pela tabela, onde a
-- política decide.

revoke insert, update, delete on funcionarios_publico from authenticated, anon;
revoke insert, update, delete on procedimentos_visivel from authenticated, anon;
revoke insert, update, delete on estoque_movimentos_visivel from authenticated, anon;

-- E, para o caso de alguma visão futura nascer esquecida, o padrão
-- do schema passa a não conceder escrita em visão nova.
alter default privileges in schema public revoke insert, update, delete on tables from authenticated;
alter default privileges in schema public revoke insert, update, delete on tables from anon;

-- O que o `alter default privileges` acima faz é valer para objetos
-- criados DEPOIS dele pelo mesmo dono. As tabelas existentes não
-- são afetadas — a escrita delas continua como está, governada
-- pelas políticas de RLS.
--
-- Conferência (como Consulta, pela API):
--   POST /rest/v1/funcionarios_publico  → deve dar 42501, não 23502


-- ══════════════════════════════════════════════════════════════════
-- FIM. Confira com:
--   select * from verificar_instalacao() where resultado <> 'ok';
-- Nenhuma linha = tudo certo.
-- ══════════════════════════════════════════════════════════════════
