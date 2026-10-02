-- ERP Dom Pedro — verificação automática
--
-- Roda depois dos quatro arquivos e devolve UMA TABELA com o
-- resultado de cada checagem. Em vez de conferir doze números à mão
-- e julgar cada um, rode isto e olhe a coluna `resultado`: se não
-- houver nenhum FALHOU, o banco está como deveria.
--
--   select * from verificar_instalacao();
--   select * from verificar_instalacao() where resultado <> 'ok';
--
-- As checagens de RLS trocam de papel com `set local role`, que é a
-- mesma coisa que a API faz com a chave anônima. Rodar dentro de uma
-- transação e dar rollback no fim: nada do que este arquivo faz
-- persiste.

create or replace function verificar_instalacao()
returns table (grupo text, checagem text, obtido text, esperado text, resultado text)
-- Sem `security definer`: o Postgres não deixa trocar de papel
-- dentro de função assim, e as checagens do grupo `anon` dependem
-- do `set local role`. Rodando como quem chama, no SQL Editor isso
-- é o `postgres`, que tem BYPASSRLS e é membro de anon.
language plpgsql as $$
declare
  n bigint;
  t text;
  ok boolean;
  seq_antes bigint;
begin
  -- Guarda o valor da sequência ANTES dos testes de escrita. Comparar
  -- com o literal 1 só funcionaria em banco recém-criado: o primeiro
  -- lançamento que alguém fizer deixaria esta linha vermelha para
  -- sempre.
  select valor into seq_antes from sequencia;
  -- helper inline: cada bloco adiciona uma linha ao resultado

  -- ── estrutura ────────────────────────────────────────
  select count(*) into n from pg_tables where schemaname = 'public';
  return query select 'estrutura', 'tabelas criadas', n::text, '43',
    case when n = 43 then 'ok' else 'FALHOU' end;

  select count(*) into n from pg_tables
   where schemaname = 'public' and not rowsecurity;
  return query select 'estrutura', 'tabelas SEM row level security', n::text, '0',
    case when n = 0 then 'ok' else 'FALHOU' end;

  select count(*) into n from pg_policies where schemaname = 'public';
  return query select 'estrutura', 'políticas criadas', n::text, '>= 100',
    case when n >= 100 then 'ok' else 'FALHOU' end;

  -- O laço do 02-rls precisa ter rodado inteiro. Se o literal JSON
  -- quebrar, nenhuma política `ver_` do laço existe — e o banco fica
  -- sem proteção aparentando estar pronto.
  select count(*) into n from pg_policies
   where schemaname = 'public' and policyname like 'ver\_%';
  return query select 'estrutura', 'políticas do laço (ver_)', n::text, '>= 30',
    case when n >= 30 then 'ok' else 'FALHOU' end;

  -- ── cadastros ────────────────────────────────────────
  select count(*) into n from centros;
  return query select 'cadastro', 'centros', n::text, '60',
    case when n = 60 then 'ok' else 'FALHOU' end;
  select count(*) into n from perfis;
  return query select 'cadastro', 'perfis', n::text, '11',
    case when n = 11 then 'ok' else 'FALHOU' end;
  select count(*) into n from matriz_acesso;
  return query select 'cadastro', 'matriz de acesso', n::text, '121',
    case when n = 121 then 'ok' else 'FALHOU' end;
  select count(*) into n from usuarios;
  return query select 'cadastro', 'usuários', n::text, '13',
    case when n = 13 then 'ok' else 'FALHOU' end;
  select count(*) into n from plano_contas;
  return query select 'cadastro', 'plano de contas', n::text, '61',
    case when n = 61 then 'ok' else 'FALHOU' end;
  select count(*) into n from credores;
  return query select 'cadastro', 'credores', n::text, '35',
    case when n = 35 then 'ok' else 'FALHOU' end;
  select count(*) into n from produtos;
  return query select 'cadastro', 'produtos', n::text, '22',
    case when n = 22 then 'ok' else 'FALHOU' end;
  select count(*) into n from clientes;
  return query select 'cadastro', 'clientes', n::text, '15',
    case when n = 15 then 'ok' else 'FALHOU' end;
  select count(*) into n from armazens;
  return query select 'cadastro', 'armazéns', n::text, '11',
    case when n = 11 then 'ok' else 'FALHOU' end;
  select count(*) into n from bancos;
  return query select 'cadastro', 'bancos', n::text, '4',
    case when n = 4 then 'ok' else 'FALHOU' end;
  select count(*) into n from empresas;
  return query select 'cadastro', 'empresas', n::text, '3',
    case when n = 3 then 'ok' else 'FALHOU' end;

  -- ── plano de contas: o tipo só no nível 1 ────────────
  select count(*) into n from plano_contas where nivel = 1 and tipo is null;
  return query select 'DRE', 'grupo de nível 1 sem tipo', n::text, '0',
    case when n = 0 then 'ok' else 'FALHOU' end;
  select count(*) into n from plano_contas where nivel > 1 and tipo is not null;
  return query select 'DRE', 'conta filha com tipo próprio', n::text, '0',
    case when n = 0 then 'ok' else 'FALHOU' end;

  -- ── a política de acesso que o dono decidiu ──────────
  select niveis into t from matriz_acesso where perfil = 'assistente' and modulo = 'dp';
  return query select 'política', 'assistente em Pessoal', coalesce(t,'(nulo)'), 'VF',
    case when t = 'VF' then 'ok' else 'FALHOU' end;
  select niveis into t from matriz_acesso where perfil = 'assistente' and modulo = 'administracao';
  return query select 'política', 'assistente em Administração', coalesce(t,'(nulo)'), 'V',
    case when t = 'V' then 'ok' else 'FALHOU' end;
  select (acoes ? 'ver_dados_pessoais') into ok from perfis where id = 'assistente';
  return query select 'política', 'assistente vê dados pessoais', ok::text, 'true',
    case when ok then 'ok' else 'FALHOU' end;
  select niveis into t from matriz_acesso where perfil = 'socio' and modulo = 'financeiro';
  return query select 'política', 'sócio no financeiro (vê e aprova, não movimenta)',
    coalesce(t,'(nulo)'), 'VFA',
    case when t = 'VFA' then 'ok' else 'FALHOU' end;
  select count(*) into n from matriz_acesso
   where modulo in ('cadastros','administracao') and niveis like '%F%';
  return query select 'política', 'nível $ em Cadastros ou Administração', n::text, '0',
    case when n = 0 then 'ok' else 'FALHOU' end;

  -- ── acesso sem login (o que a chave anônima alcança) ──
  -- `set local role` reproduz o que a API faz com a chave anon.
  set local role anon;

  select count(*) into n from folhas;
  return query select 'anon', 'lê folhas', n::text, '0',
    case when n = 0 then 'ok' else 'FALHOU' end;
  select count(*) into n from funcionarios;
  return query select 'anon', 'lê funcionários', n::text, '0',
    case when n = 0 then 'ok' else 'FALHOU' end;
  select count(*) into n from parcelas;
  return query select 'anon', 'lê parcelas', n::text, '0',
    case when n = 0 then 'ok' else 'FALHOU' end;
  select count(*) into n from titulos;
  return query select 'anon', 'lê títulos', n::text, '0',
    case when n = 0 then 'ok' else 'FALHOU' end;
  select count(*) into n from matriz_acesso;
  return query select 'anon', 'lê a matriz de acesso', n::text, '0',
    case when n = 0 then 'ok' else 'FALHOU' end;
  select count(*) into n from perfis;
  return query select 'anon', 'lê perfis', n::text, '0',
    case when n = 0 then 'ok' else 'FALHOU' end;
  select count(*) into n from parametros;
  return query select 'anon', 'lê parâmetros', n::text, '0',
    case when n = 0 then 'ok' else 'FALHOU' end;
  select count(*) into n from sequencia;
  return query select 'anon', 'lê a sequência de ids', n::text, '0',
    case when n = 0 then 'ok' else 'FALHOU' end;

  -- Escrita sem login. `update` e `delete` barrados pela RLS voltam
  -- como zero linha, não como erro — por isso a checagem conta.
  -- As duas escritas abaixo são REAIS. Hoje a RLS as barra e nada
  -- persiste — mas, se a RLS quebrar um dia, elas passariam e
  -- ficariam gravadas, porque o bloco de exceção só desfaz quando
  -- há erro. Por isso cada uma termina levantando uma exceção
  -- própria: o bloco `begin ... exception` desfaz o que fez, com
  -- erro ou sem erro. A verificação não suja o banco nem no pior
  -- caso.
  begin
    update sequencia set valor = 999999 where id = 1;
    get diagnostics n = row_count;
    raise exception using errcode = 'ERPOK', message = n::text;
  exception
    when sqlstate 'ERPOK' then
      -- Chegou aqui: o update rodou e já foi desfeito.
      n := sqlerrm::bigint;
      return query select 'anon', 'altera a sequência (linhas afetadas)', n::text, '0',
        case when n = 0 then 'ok' else 'FALHOU' end;
    when others then
      return query select 'anon', 'altera a sequência', 'recusado', '0 ou recusado', 'ok';
  end;

  begin
    insert into folhas (id, competencia, total_liquido)
      values ('fx-teste-verificador', '2099-01', 1);
    -- Se chegou aqui, a RLS deixou passar: é falha grave. A exceção
    -- desfaz a linha antes de reportar.
    raise exception using errcode = 'ERPOK', message = 'ACEITOU';
  exception
    when sqlstate 'ERPOK' then
      return query select 'anon', 'insere folha', 'ACEITOU', 'recusado', 'FALHOU';
    when others then
      return query select 'anon', 'insere folha', 'recusado', 'recusado', 'ok';
  end;

  -- Coluna de paciente: negada mesmo com a tabela acessível.
  begin
    perform paciente from procedimentos limit 1;
    return query select 'anon', 'lê a coluna paciente', 'ACEITOU', 'recusado', 'FALHOU';
  exception when insufficient_privilege then
    return query select 'anon', 'lê a coluna paciente', 'recusado', 'recusado', 'ok';
  when others then
    return query select 'anon', 'lê a coluna paciente', 'recusado', 'recusado', 'ok';
  end;

  reset role;

  -- ── a sequência ficou intacta ────────────────────────
  select valor into n from sequencia;
  return query select 'integridade', 'a sequência não mudou com os testes',
    n::text, seq_antes::text,
    case when n = seq_antes then 'ok' else 'FALHOU' end;

  -- ── nenhuma coluna ficou inalcançável ────────────────
  -- Toda coluna fechada por grant precisa voltar por alguma visão,
  -- senão o dado existe e ninguém o vê.
  select count(*) into n from (
    select a.attname from pg_attribute a
     where a.attrelid = 'procedimentos'::regclass and a.attnum > 0 and not a.attisdropped
       and not has_column_privilege('authenticated', 'procedimentos', a.attname, 'SELECT')
       and a.attname not in (
         select column_name from information_schema.columns
          where table_name = 'procedimentos_visivel')
  ) x;
  return query select 'colunas', 'colunas de procedimentos sem caminho de leitura', n::text, '0',
    case when n = 0 then 'ok' else 'FALHOU' end;

  select count(*) into n from (
    select a.attname from pg_attribute a
     where a.attrelid = 'estoque_movimentos'::regclass and a.attnum > 0 and not a.attisdropped
       and not has_column_privilege('authenticated', 'estoque_movimentos', a.attname, 'SELECT')
       and a.attname not in (
         select column_name from information_schema.columns
          where table_name = 'estoque_movimentos_visivel')
  ) x;
  return query select 'colunas', 'colunas de estoque sem caminho de leitura', n::text, '0',
    case when n = 0 then 'ok' else 'FALHOU' end;

  -- ── funcionarios e folhas fora do laço genérico ──────
  -- Política ampla aqui anularia a restritiva: elas se somam por OU.
  select count(*) into n from pg_policies
   where tablename in ('funcionarios','folhas')
     and qual not like '%ver_dados_pessoais%'
     and policyname <> 'ver_meu_cadastro';
  return query select 'pessoal', 'política ampla em funcionários ou folhas', n::text, '0',
    case when n = 0 then 'ok' else 'FALHOU' end;

  return;
end $$;

comment on function verificar_instalacao() is
  'Verificação completa da instalação. Use: select * from verificar_instalacao() where resultado <> ''ok'';';
