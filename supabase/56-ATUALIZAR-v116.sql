-- ERP Dom Pedro — ATUALIZAR para a v116
-- Etapa 56. Roda nos DOIS bancos (real e teste).
--
-- É seguro rodar mais de uma vez.
--
-- O QUE ELE FAZ
--
--   A tabela `cargos` passa a ser gravada pela tela do DP. Até aqui
--   ela era lida do banco e tratada como lista fixa: o botão
--   "+ cadastrar" no cadastro de funcionário criava o cargo só na
--   memória do navegador, e o funcionário que apontasse para ele
--   derrubava a gravação com
--
--     insert or update on table "funcionarios"
--     violates foreign key constraint "funcionarios_cargo_fkey"
--
--   Toda tabela que a tela grava precisa da coluna `extra` em jsonb:
--   a gravação separa o que é coluna conhecida do que não é e manda o
--   resto para lá, para que nenhum campo se perca quando o sistema
--   passa a ter um dado que o banco ainda não tem. `cargos` não tinha
--   — era a mesma falta que `empresas` teve na v110, pelo mesmo
--   motivo: tabela que ninguém gravava.
--
--   A permissão já existia: a RLS da etapa 02 dá a quem movimenta o
--   módulo de DP (nível M) o direito de inserir e editar em `cargos`.
--   Não há nada a conceder aqui.

alter table cargos
  add column if not exists extra jsonb not null default '{}'::jsonb;

comment on column cargos.extra is
  'Campos que a tela grava e o banco ainda nao tem como coluna propria.';

-- ══════════════════════════════════════════════════════════════
-- CONFERÊNCIA
-- ══════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'cargos' and column_name = 'extra') then
    raise exception 'A tabela cargos ficou sem a coluna extra — a tela nao consegue gravar.';
  end if;
  -- A política de escrita tem de existir, senão o cargo novo é
  -- recusado por permissão em vez de por coluna, e o sintoma na tela
  -- é o mesmo: "nao foi gravado no banco".
  if not exists (select 1 from pg_policies
                  where tablename = 'cargos' and cmd = 'INSERT') then
    raise exception 'Nao ha politica de insercao em cargos. Rode a etapa 02-rls.sql.';
  end if;
end $$;

-- O separador de `to_char` com G e D vem da configuração regional do
-- servidor, e no Supabase ela é a americana: "3,200.00". Aqui o
-- número é montado com separador fixo e depois trocado, para sair
-- 00.000,00 em qualquer banco, como no resto do sistema.
select c.id,
       c.nome,
       coalesce(c.cbo, '—')                         as cbo,
       translate(to_char(coalesce(c.salario_piso, 0), 'FM999,999,990.00'),
                 ',.', '.,')                        as piso,
       count(f.id)                                  as funcionarios
  from cargos c
  left join funcionarios f on f.cargo = c.id
 group by c.id, c.nome, c.cbo, c.salario_piso
 order by c.nome;

-- ESPERADO: a lista de cargos que existe hoje no banco, com quantos
-- funcionários cada um tem. O cargo que a pessoa do DP tentou criar
-- NÃO vai estar aqui — ele nunca chegou ao banco. Depois de publicar
-- a v116, basta cadastrá-lo de novo pela tela: agora ele sobe.
