-- ERP Dom Pedro — ATUALIZAR para a v110
-- Etapa 52. Roda nos DOIS bancos (real e teste).
--
-- É seguro rodar mais de uma vez.
--
-- O QUE ELE FAZ
--
--   1. COEXISTE — marcação por documento para desligar o
--      "substituído" à mão. O registro no COREN exige cinco peças
--      diferentes do mesmo tipo, e as cinco valem ao mesmo tempo.
--
--   2. ISENTO — lista de empresas de quem aquele tipo NÃO é
--      exigido. A matriz tem inscrição estadual; a filial não vende
--      produto e não tem. Sem isto, o painel cobra da filial um
--      documento que ela nunca vai ter — e pendência que não se
--      resolve é pendência que se aprende a ignorar.
--
--   3. EXCLUIR EMPRESA — uma função que apaga o CNPJ digitado por
--      engano e RECUSA apagar o que tem movimento. O resto do
--      sistema nunca apaga, cancela e estorna; esta é a exceção
--      estreita para cadastro que nasceu errado e nunca foi usado.
--
--   4. A view é refeita, porque `select d.*` fixa a lista de
--      colunas na criação.

-- ══════════════════════════════════════════════════════════════
-- 0. A coluna `extra` em `empresas`
--
-- Toda tabela que a tela grava tem uma coluna `extra` em jsonb: a
-- gravação separa o que é coluna conhecida do que não é, e manda o
-- resto para lá, para que nenhum campo se perca quando o sistema
-- passa a ter um dado que o banco ainda não tem.
--
-- `empresas` era a única das 32 sem ela, porque até a v110 esta
-- tabela não era gravada pela tela — entrava por SQL. Ao virar
-- cadastro, a primeira gravação bateu em "Could not find the
-- 'extra' column of 'empresas'" e a alteração ficou só na tela.
-- ══════════════════════════════════════════════════════════════
alter table empresas
  add column if not exists extra jsonb not null default '{}'::jsonb;

-- ══════════════════════════════════════════════════════════════
-- 1. O documento que não é substituído por ninguém
-- ══════════════════════════════════════════════════════════════
alter table hab_documento
  add column if not exists coexiste boolean not null default false;

comment on column hab_documento.coexiste is
  'Marcado, este documento nunca aparece como substituído: vale junto com os outros do mesmo tipo.';

-- ══════════════════════════════════════════════════════════════
-- 2. De quem este tipo NÃO é exigido
-- ══════════════════════════════════════════════════════════════
alter table hab_tipo_documento
  add column if not exists isento jsonb not null default '[]'::jsonb;

comment on column hab_tipo_documento.isento is
  'Ids de empresas de quem este tipo nao e exigido (nao entra como pendencia no painel).';

-- ══════════════════════════════════════════════════════════════
-- 3. Excluir empresa — só a que nunca foi usada
--
-- A lista de tabelas é lida do próprio catálogo do Postgres, pelas
-- chaves estrangeiras que apontam para `empresas`. Escrita à mão,
-- ela envelheceria: a tabela nova de amanhã não entraria na
-- conferência, e a exclusão passaria a apagar coisa referenciada.
-- ══════════════════════════════════════════════════════════════
create or replace function excluir_empresa(p_id text)
returns jsonb language plpgsql security definer as $$
declare
  r         record;
  n         bigint;
  presos    text[] := '{}';
begin
  if app_usuario() is null then
    raise exception 'sem usuário autenticado';
  end if;
  if not tem_nivel('cadastros', 'M') then
    raise exception 'só quem movimenta Cadastros exclui empresa';
  end if;
  if not exists (select 1 from empresas where id = p_id) then
    return jsonb_build_object('ok', false, 'motivo', 'empresa_nao_existe');
  end if;

  for r in
    select c.conrelid::regclass::text as tabela,
           a.attname                  as coluna
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid = 'empresas'::regclass
       and array_length(c.conkey, 1) = 1
  loop
    execute format('select count(*) from %s where %I = $1', r.tabela, r.coluna)
       into n using p_id;
    if n > 0 then
      presos := presos || (r.tabela || ' (' || n || ')');
    end if;
  end loop;

  if array_length(presos, 1) > 0 then
    return jsonb_build_object('ok', false, 'motivo', 'tem_movimento',
                              'onde', array_to_string(presos, ', '));
  end if;

  delete from empresas where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function excluir_empresa(text) from public, anon;
grant execute on function excluir_empresa(text) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- 4. A view acompanha as colunas novas
-- ══════════════════════════════════════════════════════════════
drop view if exists hab_documento_vigente;

create view hab_documento_vigente as
select d.*,
       t.nome          as tipo_nome,
       t.sigla         as tipo_sigla,
       t.categoria     as tipo_categoria,
       t.sem_validade  as tipo_sem_validade,
       t.dado_pessoal  as tipo_dado_pessoal,
       t.url_emissao   as tipo_url_emissao,
       t.exigido       as tipo_exigido,
       t.comum         as tipo_comum,
       t.isento        as tipo_isento,
       e.apelido       as empresa_apelido,
       t.prazo_padrao_dias as tipo_prazo_dias,
       hab_validade_efetiva(d.data_validade, d.data_emissao, t.sem_validade,
                            t.prazo_padrao_dias) as validade_efetiva,
       case
         when t.sem_validade then null
         else hab_validade_efetiva(d.data_validade, d.data_emissao, t.sem_validade,
                                   t.prazo_padrao_dias) - current_date
       end as dias_para_vencer
  from hab_documento d
  join hab_tipo_documento t on t.id = d.tipo
  join empresas e on e.id = d.empresa
 where not d.arquivado;

grant select on hab_documento_vigente to authenticated;

-- ══════════════════════════════════════════════════════════════
-- CONFERÊNCIA
-- ══════════════════════════════════════════════════════════════
do $$
declare faltam text;
begin
  select string_agg(c, ', ') into faltam
    from unnest(array['coexiste', 'tipo_isento', 'tipo_exigido', 'tipo_comum']) as c
   where not exists (select 1 from information_schema.columns
                      where table_name = 'hab_documento_vigente'
                        and column_name = c);
  if faltam is not null then
    raise exception 'A view hab_documento_vigente ficou sem: %. Rode este arquivo inteiro.', faltam;
  end if;
  if not exists (select 1 from pg_proc where proname = 'excluir_empresa') then
    raise exception 'A funcao excluir_empresa nao foi criada.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'empresas' and column_name = 'extra') then
    raise exception 'A tabela empresas ficou sem a coluna extra — a tela nao consegue gravar.';
  end if;
end $$;

select e.apelido                                     as empresa,
       e.cnpj,
       case when e.ativo then 'ativa' else 'INATIVA' end as situacao,
       count(d.id)                                    as documentos_no_cofre,
       (select count(*) from hab_tipo_documento t
         where t.ativo and t.exigido and not (t.isento ? e.id)) as tipos_exigidos_dela
  from empresas e
  left join hab_documento d on d.empresa = e.id and not d.arquivado
 group by e.id, e.apelido, e.cnpj, e.ativo
 order by e.apelido;

-- ESPERADO: uma linha por empresa, com a contagem de documentos e
-- quantos tipos são exigidos dela. Nada isento ainda — a isenção se
-- marca na tela, na aba Tipos de documento.
