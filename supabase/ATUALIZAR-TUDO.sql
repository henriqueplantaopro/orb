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
--   20  trilha de auditoria imutável por privilégio: nem a
--       Administração altera ou apaga evento
--  20b  cria em `centros` e `clientes` as colunas que só existiam
--       no cadastro do sistema (tipo de serviço, previsão, cliente)
--   21  todo projeto ligado ao seu cliente, com tipo de serviço e
--       previsão estimada
--   22  previsão estimada em cada projeto
--
-- NÃO inclui 01, 02, 03 e 04 (estrutura, políticas, cadastros e
-- permissões de coluna): esses já rodaram e recriá-los sem
-- necessidade mexeria em coisa que está funcionando.
--   23  valor padrão em TODA coluna obrigatória: é a terceira vez
--       que uma coluna sem padrão derruba a gravação inteira
--   27  o banco recusa situação fora da lista: "terceiros" no
--       plural fazia o ativo sumir de todo filtro



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


-- ====================================================================
-- ETAPA 20 — 20-trilha-imutavel.sql
-- ====================================================================

-- ERP Dom Pedro — a trilha não se altera
-- Etapa 20.
--
-- A auditoria apontou com razão: UPDATE e DELETE em `eventos`
-- voltavam 204 com zero linha, não 42501. Ou seja, o privilégio
-- estava concedido e o que segurava era a AUSÊNCIA de política
-- permissiva. Funciona hoje; deixa de funcionar no dia em que
-- alguém criar uma política ampla ali — e ninguém vai lembrar de
-- conferir, porque ninguém decidiu.
--
-- "Nem o administrador altera a trilha" tem de ser verdade por
-- decisão. Trilha que o administrador reescreve não prova nada:
-- num questionamento, a defesa seria exatamente essa.

revoke update, delete, truncate on eventos from authenticated, anon;

-- Inserir continua liberado: é o que a aplicação faz o tempo todo.
grant insert on eventos to authenticated;

-- A leitura permanece como está: só quem tem Administração ou a
-- ação `admin` lê a trilha (política `ver_eventos`, da etapa 02).

-- Conferência (como qualquer perfil, pela API):
--   PATCH  /rest/v1/eventos?id=eq.1  → 42501, não 204
--   DELETE /rest/v1/eventos?id=eq.1  → 42501, não 204


-- ====================================================================
-- ETAPA 20b — 20b-colunas-centros.sql
-- ====================================================================

-- ERP Dom Pedro — colunas que faltavam em centros e clientes
-- Etapa 20b (roda antes da 21 e da 22).
--
-- `tipo_servico`, `prev_faturamento`, `prev_repasse`, `cliente` e
-- `grupo_faturamento` existiam no cadastro do sistema e nunca
-- tinham sido criadas no banco: até agora viviam na coluna `extra`,
-- o que funciona para ler e escrever pelo sistema mas não permite
-- consultar nem atualizar por SQL.
--
-- Como as etapas seguintes preenchem esses campos, eles precisam
-- existir como coluna de verdade.

alter table centros
  add column if not exists cliente text,
  add column if not exists tipo_servico text,
  add column if not exists grupo_faturamento text,
  add column if not exists prev_faturamento numeric default 0,
  add column if not exists prev_repasse numeric default 0,
  add column if not exists produtividade boolean default false,
  add column if not exists retencao_pct numeric default 0,
  add column if not exists impostos jsonb default '{}'::jsonb,
  add column if not exists prazo_dias int,
  add column if not exists codigo_hospital text,
  add column if not exists unidade text;

alter table clientes
  add column if not exists centro_padrao text,
  add column if not exists prazo_dias int,
  add column if not exists retencoes jsonb default '[]'::jsonb;

-- Conferência:
--   select column_name from information_schema.columns
--    where table_name = 'centros' and column_name in
--      ('cliente','tipo_servico','prev_faturamento','grupo_faturamento');
--   -- esperado: 4 linhas


-- ====================================================================
-- ETAPA 21 — 21-projetos-clientes.sql
-- ====================================================================

-- ERP Dom Pedro — projetos ligados aos seus clientes
-- Etapa 21.
--
-- Todo projeto passa a ter cliente, tipo de serviço (médico ou
-- locação) e previsão estimada de faturamento.
--
-- Os vínculos seguem o contrato, não o nome: as sete frentes do HGB
-- são do mesmo Grupo Hospitalar Conceição, as quatro da Iron
-- Trainers do mesmo contratante, as quatro do HMSA da AGIR. Onde não
-- havia cliente cadastrado, ele nasce com o nome do projeto — sem
-- CNPJ, que o financeiro completa na hora de emitir.

insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl01', 'AGIR — Ass. de Gestão, Inovação e Resultados em Saúde', '05029600000287', 'pj19', 35, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl02', 'Santa Casa de Misericórdia de Barra Mansa', '28683712000171', 'pj23', 40, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl03', 'Grupo Hospitalar Conceição — Hospital Federal de Bonsucesso', '92787118002416', 'pj11', 40, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl04', 'Grupo Hospitalar Conceição S.A.', '92787118000553', 'pj10', 40, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl05', 'Irmandade Beneficente da Santa Casa da Misericórdia de Fortaleza', '07273592000164', 'pj08', 30, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl06', 'Instituto Dr. José Frota — IJF', '07835044000180', 'pj07', 30, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl07', 'Centro de Hematologia e Hemoterapia do Ceará — HEMOCE', '07954571011491', 'pj06', 30, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl08', 'Polícia Militar do Ceará', '01790944003350', 'pj01', 30, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl09', 'IBDSOCIAL', '05843874000124', 'pj22', 30, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl10', 'Instituto Brasileiro de Saúde, Ensino, Pesquisa e Extensão', '07836454000146', 'pj29', 60, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl11', 'Inst. Bras. de Saúde, Ensino, Pesq. e Extensão (filial)', '07836454002009', 'pj29', 60, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl12', 'Iron Trainers do Brasil Ltda', '21298287000158', 'pj12', 20, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl13', 'SPDM/PAIS — Ass. Paulista para o Desenvolvimento da Medicina', '61699567009300', 'pj31', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl14', 'Dr. Consulta Centro Médico Ltda', '14245016000179', 'pj30', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl15', 'Sociedade de Caridade — Santa Casa de Misericórdia Madre Michel', '22351316000160', 'pj16', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl16', 'CIDH', '', 'pj02', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl17', 'CDERM', '', 'pj03', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl18', 'CCAD', '', 'pj04', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl19', 'HSMM', '', 'pj05', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl20', 'HMSM - POA', '', 'pj28', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl21', 'CETHID', '', 'pj33', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl22', 'HMMQ', '', 'pj34', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl23', 'IPADE/UNICRISTUS', '', 'pj36', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl24', 'Fundação Edson Queiroz / UNIFOR', '', 'pj37', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl25', 'Santa Casa de Nilópolis', '', 'pj41', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl26', 'Hospital Moacyr do Carmo', '', 'pj42', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl27', 'SAMU Nova Friburgo', '', 'pj43', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
update centros set cliente = 'cl08', tipo_servico = 'medico', prev_faturamento = 22868.84 where id = 'pj01';
update centros set cliente = 'cl16', tipo_servico = 'medico', prev_faturamento = 21562.05 where id = 'pj02';
update centros set cliente = 'cl17', tipo_servico = 'medico', prev_faturamento = 4900.47 where id = 'pj03';
update centros set cliente = 'cl18', tipo_servico = 'medico', prev_faturamento = 11761.12 where id = 'pj04';
update centros set cliente = 'cl19', tipo_servico = 'medico', prev_faturamento = 110750.54 where id = 'pj05';
update centros set cliente = 'cl07', tipo_servico = 'medico', prev_faturamento = 29577.04 where id = 'pj06';
update centros set cliente = 'cl06', tipo_servico = 'medico', prev_faturamento = 93519.84 where id = 'pj07';
update centros set cliente = 'cl05', tipo_servico = 'medico', prev_faturamento = 358082.89 where id = 'pj08';
update centros set cliente = 'cl04', tipo_servico = 'medico', prev_faturamento = 323876.8 where id = 'pj09';
update centros set cliente = 'cl04', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj10';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 2043819.83 where id = 'pj11';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj44';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj45';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj46';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj47';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj48';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj49';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj50';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj51';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj52';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj53';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj54';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj55';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj56';
update centros set cliente = 'cl12', tipo_servico = 'medico', prev_faturamento = 58545.58 where id = 'pj12';
update centros set cliente = 'cl12', tipo_servico = 'medico', prev_faturamento = 97.6 where id = 'pj13';
update centros set cliente = 'cl12', tipo_servico = 'medico', prev_faturamento = 4698.56 where id = 'pj14';
update centros set cliente = 'cl12', tipo_servico = 'medico', prev_faturamento = 1272.73 where id = 'pj15';
update centros set cliente = 'cl15', tipo_servico = 'medico', prev_faturamento = 216000.51 where id = 'pj16';
update centros set cliente = 'cl15', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj17';
update centros set cliente = 'cl01', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj18';
update centros set cliente = 'cl01', tipo_servico = 'medico', prev_faturamento = 213427.2 where id = 'pj19';
update centros set cliente = 'cl01', tipo_servico = 'medico', prev_faturamento = 355713.6 where id = 'pj20';
update centros set cliente = 'cl01', tipo_servico = 'medico', prev_faturamento = 327600 where id = 'pj21';
update centros set cliente = 'cl09', tipo_servico = 'medico', prev_faturamento = 387223.52 where id = 'pj22';
update centros set cliente = 'cl02', tipo_servico = 'medico', prev_faturamento = 435765.29 where id = 'pj23';
update centros set cliente = 'cl02', tipo_servico = 'medico', prev_faturamento = 265036.5 where id = 'pj24';
update centros set cliente = 'cl02', tipo_servico = 'medico', prev_faturamento = 177696.23 where id = 'pj25';
update centros set cliente = 'cl02', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj26';
update centros set cliente = 'cl02', tipo_servico = 'medico', prev_faturamento = 84000 where id = 'pj27';
update centros set cliente = 'cl20', tipo_servico = 'medico', prev_faturamento = 94399.2 where id = 'pj28';
update centros set cliente = 'cl10', tipo_servico = 'medico', prev_faturamento = 190800 where id = 'pj29';
update centros set cliente = 'cl14', tipo_servico = 'medico', prev_faturamento = 35122.25 where id = 'pj30';
update centros set cliente = 'cl13', tipo_servico = 'medico', prev_faturamento = 5490 where id = 'pj31';
update centros set cliente = 'cl13', tipo_servico = 'medico', prev_faturamento = 7680 where id = 'pj32';
update centros set cliente = 'cl21', tipo_servico = 'medico', prev_faturamento = 289293.88 where id = 'pj33';
update centros set cliente = 'cl22', tipo_servico = 'medico', prev_faturamento = 720575.78 where id = 'pj34';
update centros set cliente = 'cl22', tipo_servico = 'medico', prev_faturamento = 506248.78 where id = 'pj35';
update centros set cliente = 'cl23', tipo_servico = 'locacao', prev_faturamento = 0 where id = 'pj36';
update centros set cliente = 'cl24', tipo_servico = 'locacao', prev_faturamento = 104700 where id = 'pj37';
update centros set cliente = 'cl05', tipo_servico = 'locacao', prev_faturamento = 14000 where id = 'pj38';
update centros set cliente = 'cl05', tipo_servico = 'locacao', prev_faturamento = 0 where id = 'pj39';
update centros set cliente = 'cl05', tipo_servico = 'locacao', prev_faturamento = 5000 where id = 'pj40';
update centros set cliente = 'cl25', tipo_servico = 'locacao', prev_faturamento = 227343.74 where id = 'pj41';
update centros set cliente = 'cl26', tipo_servico = 'locacao', prev_faturamento = 21600 where id = 'pj42';
update centros set cliente = 'cl27', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj43';

-- Conferência: nenhum projeto pode ficar sem cliente.
--
--   select id, curto from centros
--    where tipo = 'projeto' and (cliente is null or cliente = '');
--   -- esperado: nenhuma linha


-- ====================================================================
-- ETAPA 22 — 22-previsoes-projetos.sql
-- ====================================================================

-- ERP Dom Pedro — previsões por projeto
-- Etapa 22.
--
-- Cada projeto recebe a previsão estimada de faturamento do mês.
--
-- No HGB os sete setores continuam separados, como já estavam: a
-- produtividade e o pedido de faturamento vêm POR ESPECIALIDADE, e
-- só a NOTA é única. O campo `grupo_faturamento` é o que amarra
-- isso, e o rateio da nota segue a proporção do que cada setor
-- confirmou de produtividade no mês — margem, custo e faturamento
-- seguem visíveis por especialidade. O mesmo vale para o mutirão.
--
-- A previsão do contrato (R$ 2.043.819,83) fica no projeto âncora
-- do grupo, e não repartida entre os setores. Dividir em partes
-- iguais faria cada setor pedir nota própria — o sistema tem teste
-- justamente para isso. A repartição real acontece no rateio, com
-- base no que cada um produziu, que é mais preciso que qualquer
-- divisão feita hoje.

update centros set ativo = true, prev_faturamento = 22868.84, cliente = 'cl08', tipo_servico = 'medico' where id = 'pj01';
update centros set ativo = true, prev_faturamento = 21562.05, cliente = 'cl16', tipo_servico = 'medico' where id = 'pj02';
update centros set ativo = true, prev_faturamento = 4900.47, cliente = 'cl17', tipo_servico = 'medico' where id = 'pj03';
update centros set ativo = true, prev_faturamento = 11761.12, cliente = 'cl18', tipo_servico = 'medico' where id = 'pj04';
update centros set ativo = true, prev_faturamento = 110750.54, cliente = 'cl19', tipo_servico = 'medico' where id = 'pj05';
update centros set ativo = true, prev_faturamento = 29577.04, cliente = 'cl07', tipo_servico = 'medico' where id = 'pj06';
update centros set ativo = true, prev_faturamento = 93519.84, cliente = 'cl06', tipo_servico = 'medico' where id = 'pj07';
update centros set ativo = true, prev_faturamento = 358082.89, cliente = 'cl05', tipo_servico = 'medico' where id = 'pj08';
update centros set ativo = true, prev_faturamento = 323876.8, cliente = 'cl04', tipo_servico = 'medico' where id = 'pj09';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl04', tipo_servico = 'medico' where id = 'pj10';
update centros set ativo = true, prev_faturamento = 2043819.83, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj11';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj44';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj45';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj46';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj47';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj48';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj49';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj50';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj51';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj52';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj53';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj54';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj55';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj56';
update centros set ativo = true, prev_faturamento = 58545.58, cliente = 'cl12', tipo_servico = 'medico' where id = 'pj12';
update centros set ativo = true, prev_faturamento = 97.6, cliente = 'cl12', tipo_servico = 'medico' where id = 'pj13';
update centros set ativo = true, prev_faturamento = 4698.56, cliente = 'cl12', tipo_servico = 'medico' where id = 'pj14';
update centros set ativo = true, prev_faturamento = 1272.73, cliente = 'cl12', tipo_servico = 'medico' where id = 'pj15';
update centros set ativo = true, prev_faturamento = 216000.51, cliente = 'cl15', tipo_servico = 'medico' where id = 'pj16';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl15', tipo_servico = 'medico' where id = 'pj17';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl01', tipo_servico = 'medico' where id = 'pj18';
update centros set ativo = true, prev_faturamento = 213427.2, cliente = 'cl01', tipo_servico = 'medico' where id = 'pj19';
update centros set ativo = true, prev_faturamento = 355713.6, cliente = 'cl01', tipo_servico = 'medico' where id = 'pj20';
update centros set ativo = true, prev_faturamento = 327600, cliente = 'cl01', tipo_servico = 'medico' where id = 'pj21';
update centros set ativo = true, prev_faturamento = 387223.52, cliente = 'cl09', tipo_servico = 'medico' where id = 'pj22';
update centros set ativo = true, prev_faturamento = 435765.29, cliente = 'cl02', tipo_servico = 'medico' where id = 'pj23';
update centros set ativo = true, prev_faturamento = 265036.5, cliente = 'cl02', tipo_servico = 'medico' where id = 'pj24';
update centros set ativo = true, prev_faturamento = 177696.23, cliente = 'cl02', tipo_servico = 'medico' where id = 'pj25';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl02', tipo_servico = 'medico' where id = 'pj26';
update centros set ativo = true, prev_faturamento = 84000, cliente = 'cl02', tipo_servico = 'medico' where id = 'pj27';
update centros set ativo = true, prev_faturamento = 94399.2, cliente = 'cl20', tipo_servico = 'medico' where id = 'pj28';
update centros set ativo = true, prev_faturamento = 190800, cliente = 'cl10', tipo_servico = 'medico' where id = 'pj29';
update centros set ativo = true, prev_faturamento = 35122.25, cliente = 'cl14', tipo_servico = 'medico' where id = 'pj30';
update centros set ativo = true, prev_faturamento = 5490, cliente = 'cl13', tipo_servico = 'medico' where id = 'pj31';
update centros set ativo = true, prev_faturamento = 7680, cliente = 'cl13', tipo_servico = 'medico' where id = 'pj32';
update centros set ativo = true, prev_faturamento = 289293.88, cliente = 'cl21', tipo_servico = 'medico' where id = 'pj33';
update centros set ativo = true, prev_faturamento = 720575.78, cliente = 'cl22', tipo_servico = 'medico' where id = 'pj34';
update centros set ativo = true, prev_faturamento = 506248.78, cliente = 'cl22', tipo_servico = 'medico' where id = 'pj35';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl23', tipo_servico = 'locacao' where id = 'pj36';
update centros set ativo = true, prev_faturamento = 104700, cliente = 'cl24', tipo_servico = 'locacao' where id = 'pj37';
update centros set ativo = true, prev_faturamento = 14000, cliente = 'cl05', tipo_servico = 'locacao' where id = 'pj38';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl05', tipo_servico = 'locacao' where id = 'pj39';
update centros set ativo = true, prev_faturamento = 5000, cliente = 'cl05', tipo_servico = 'locacao' where id = 'pj40';
update centros set ativo = true, prev_faturamento = 227343.74, cliente = 'cl25', tipo_servico = 'locacao' where id = 'pj41';
update centros set ativo = true, prev_faturamento = 21600, cliente = 'cl26', tipo_servico = 'locacao' where id = 'pj42';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl27', tipo_servico = 'medico' where id = 'pj43';

-- Conferência:
--
--   select curto, prev_faturamento from centros
--    where grupo_faturamento = 'GHC - HGB' order by prev_faturamento desc;
--   -- o âncora com 2043819.83, os demais zerados
--
--   select count(*) from centros where tipo = 'projeto' and ativo;
--   -- esperado: 56


-- ====================================================================
-- ETAPA 23 — 23-defaults-obrigatorias.sql
-- ====================================================================

-- ERP Dom Pedro — valor padrão nas colunas obrigatórias
-- Etapa 23.
--
-- Terceira vez que a mesma coisa aparece: coluna NOT NULL sem
-- DEFAULT, o cliente não manda o campo, e a gravação inteira cai
-- ("estornado", depois "status" em previsões, agora "baixas" em
-- receber). Corrigir uma por vez garante que vai aparecer uma
-- quarta.
--
-- Este bloco varre o schema e dá um padrão a TODA coluna obrigatória
-- que ainda não tem: lista vazia para jsonb de array, objeto vazio
-- para jsonb de registro, zero para número, falso para booleano e
-- texto vazio para texto. Colunas-chave e datas ficam de fora: ali a
-- ausência de valor é erro de verdade, e inventar um padrão
-- esconderia o problema.

do $$
declare r record;
begin
  for r in
    select c.table_name, c.column_name, c.data_type
      from information_schema.columns c
      join information_schema.tables t
        on t.table_name = c.table_name and t.table_schema = c.table_schema
     where c.table_schema = 'public'
       and t.table_type = 'BASE TABLE'
       and c.is_nullable = 'NO'
       and c.column_default is null
       and c.column_name not in ('id', 'created_at', 'criado_em', 'lancado_em')
       /* `ARRAY` é o tipo de colunas como `autorizacoes_anteriores`:
          ficou de fora da primeira versão e derrubou a gravação de
          previsões. Os numéricos menos comuns entram pelo mesmo
          motivo — a varredura só serve se cobrir tudo. */
       and c.data_type in ('jsonb', 'boolean', 'numeric', 'integer', 'bigint', 'text',
                           'ARRAY', 'double precision', 'real', 'smallint', 'json')
  loop
    begin
      if r.data_type = 'ARRAY' then
        execute format('alter table %I alter column %I set default ''{}''',
                       r.table_name, r.column_name);
      elsif r.data_type in ('jsonb', 'json') then
        /* Campos cujo nome é plural guardam lista; os demais, objeto.
           Errar aqui não quebra: o sistema sobrescreve na primeira
           gravação. */
        if r.column_name ~ 's$' then
          execute format('alter table %I alter column %I set default ''[]''::jsonb',
                         r.table_name, r.column_name);
        else
          execute format('alter table %I alter column %I set default ''{}''::jsonb',
                         r.table_name, r.column_name);
        end if;
      elsif r.data_type = 'boolean' then
        execute format('alter table %I alter column %I set default false',
                       r.table_name, r.column_name);
      elsif r.data_type in ('numeric', 'integer', 'bigint', 'double precision', 'real', 'smallint') then
        execute format('alter table %I alter column %I set default 0',
                       r.table_name, r.column_name);
      elsif r.data_type = 'text' then
        execute format('alter table %I alter column %I set default ''''',
                       r.table_name, r.column_name);
      end if;
    exception when others then
      /* Coluna gerada ou com regra própria: segue em frente. */
      raise notice 'sem default em %.%: %', r.table_name, r.column_name, sqlerrm;
    end;
  end loop;
end $$;

-- Conferência: quantas colunas obrigatórias ainda não têm padrão.
--
--   select table_name, column_name, data_type
--     from information_schema.columns c
--     join information_schema.tables t using (table_name, table_schema)
--    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
--      and c.is_nullable = 'NO' and c.column_default is null
--      and c.column_name not in ('id','created_at','criado_em','lancado_em')
--    order by 1, 2;
--   -- o que sobrar são chaves e datas, que é o esperado


-- ====================================================================
-- ETAPA 27 — 27-validar-dominios.sql
-- ====================================================================

-- ERP Dom Pedro — travas de domínio
-- Etapa 27.
--
-- A carga de ativos gravou "terceiros" (plural) numa coluna que o
-- sistema lê como "terceiro". O item aparecia na lista completa e
-- sumia de qualquer filtro — o pior jeito de um dado estar errado,
-- porque não parece erro: parece que o filtro não funciona.
--
-- Estas travas fazem o banco recusar valor fora da lista. Carga
-- futura com um identificador inventado para na hora, em vez de
-- entrar e só aparecer meses depois, quando alguém estranhar um
-- total que não fecha.

-- ANTES DE TRAVAR, NORMALIZA O QUE JÁ ESTÁ GRAVADO.
--
-- A primeira versão desta etapa travava direto e falhava: havia
-- linhas com situação fora da lista, e o banco recusava criar a
-- regra. Uma trava que não consegue ser criada não protege nada —
-- e ainda interrompe a atualização inteira.
--
-- Aqui os valores conhecidos são convertidos para o identificador
-- certo, e o que não se encaixa em nada vira `sede`, que é o
-- estado mais neutro: o item existe e está na empresa.

update ativos set status = 'terceiro'   where status in ('terceiros', 'terceiro(s)', 'em_terceiros');
update ativos set status = 'aguardando' where status in ('producao', 'produção', 'aguardando_producao');
update ativos set status = 'alocado'    where status in ('alocada', 'em_projeto', 'projeto');
update ativos set status = 'devolucao'  where status in ('devolução', 'em_devolucao');
update ativos set status = 'manutencao' where status in ('manutenção', 'em_manutencao');
update ativos set status = 'transito'   where status in ('trânsito', 'em_transito');
update ativos set status = 'sede'       where status in ('estoque', 'em_estoque', 'estoque_sede');
update ativos set status = 'sede'
 where status is not null and status not in
   ('sede', 'terceiro', 'alocado', 'transito', 'manutencao',
    'devolucao', 'aguardando', 'baixado');

update centros set tipo_servico = null
 where tipo_servico is not null and tipo_servico not in ('medico', 'locacao', 'misto');

update credores set tipo = 'outro'
 where tipo is not null and tipo not in
   ('fornecedor', 'medico', 'funcionario', 'orgao', 'socio', 'outro');

alter table ativos drop constraint if exists ativos_status_valido;
alter table ativos add constraint ativos_status_valido
  check (status is null or status in
    ('sede', 'terceiro', 'alocado', 'transito', 'manutencao',
     'devolucao', 'aguardando', 'baixado'));

alter table centros drop constraint if exists centros_tipo_servico_valido;
alter table centros add constraint centros_tipo_servico_valido
  check (tipo_servico is null or tipo_servico in ('medico', 'locacao', 'misto'));

-- Credores usam SEIS tipos, não três: além de fornecedor, médico e
-- funcionário, o cadastro distingue órgão, sócio e outro. Travar na
-- lista curta recusaria cadastro legítimo.
alter table credores drop constraint if exists credores_tipo_valido;
alter table credores add constraint credores_tipo_valido
  check (tipo is null or tipo in
    ('fornecedor', 'medico', 'funcionario', 'orgao', 'socio', 'outro'));

-- PREVISÕES ficam SEM trava, de propósito. O status ali passa por
-- mais estados do que parece à primeira vista, e alguns só aparecem
-- em caminhos pouco percorridos. Uma trava incompleta recusaria uma
-- gravação legítima no meio do fechamento — dano maior que o erro
-- que ela evitaria. Fica para quando a lista estiver levantada com
-- certeza.

-- Conferência: se alguma trava falhar ao ser criada, é porque já
-- existe dado fora da lista. Para encontrar:
--
--   select distinct status from ativos;
--   select distinct tipo_servico from centros;
--   select distinct tipo from credores;
--   select distinct status from previsoes;


-- ══════════════════════════════════════════════════════════════════
-- FIM. Confira com:
--   select * from verificar_instalacao() where resultado <> 'ok';
-- Nenhuma linha = tudo certo.
-- ══════════════════════════════════════════════════════════════════
