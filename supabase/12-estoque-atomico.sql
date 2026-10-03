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
