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
