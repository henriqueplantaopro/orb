-- ERP Dom Pedro — aprovação com as regras no SERVIDOR
-- Etapa 42. Roda nos dois bancos (real e teste).
--
-- POR QUE EXISTE
--
-- Até aqui, a alçada de aprovação, a trava de "quem solicita não
-- aprova" e a conferência de perfil viviam em JavaScript — isto é,
-- no navegador de quem está usando. O Supabase expõe o banco
-- diretamente pela internet; o que decide quem grava o quê são as
-- políticas (RLS) daqui. Uma regra escrita na tela é uma sugestão:
-- quem abrisse o console do navegador conseguiria marcar como
-- autorizado um pagamento de qualquer valor.
--
-- Isso passa a importar de verdade agora que existe um aplicativo de
-- celular para aprovar — um segundo caminho, num aparelho que anda
-- no bolso e se perde.
--
-- Estas funções rodam como donas da tabela (`security definer`) e
-- conferem tudo antes de gravar. O aplicativo não escreve em
-- `pagamentos` nem em `compras`: ele PEDE, e o banco decide.
--
-- As regras abaixo são as mesmas do `js/store.js`, e há um teste no
-- sistema que compara as duas listas.
--
-- É seguro rodar mais de uma vez.

-- ──────────────────────────────────────────────────────────────
-- 0. De onde vem a política
--
-- Alçada, segregação e perfis sem aprovação ficam na linha
-- `parametros_gerais`, gravada pela tela de Administração. Até a
-- v101 ela não era gravada: a alçada vivia só na sessão de quem
-- abriu o sistema. Se a linha não existir, as funções abaixo usam o
-- padrão do código — o mesmo que o sistema usava.
-- ──────────────────────────────────────────────────────────────

create or replace function app_politica()
returns jsonb language sql stable security definer as $$
  select coalesce(
    (select valor from parametros where chave = 'parametros_gerais'),
    '{"alcada":{"diretoria":50000,"socio":0,"admin":0,"comprador":5000,"assistente":0},
      "sem_aprovacao":["assistente","produtividade_dir","produtividade_ger"],
      "impedir_autoaprovacao":true,
      "impedir_autoaprovacao_compras":false}'::jsonb)
$$;

-- A alçada do perfil de quem está pedindo. 0 = sem limite.
create or replace function app_alcada()
returns numeric language sql stable security definer as $$
  select coalesce((app_politica() -> 'alcada' ->> app_perfil())::numeric, 0)
$$;

-- Dinheiro no formato do sistema: 00.000,00. O `to_char` com `G` e
-- `D` usa o idioma do servidor, e o Supabase responde em inglês —
-- a primeira versão devolvia "50,000.00" na mensagem de alçada,
-- que num aviso sobre dinheiro é exatamente o tipo de ambiguidade
-- que não se quer.
create or replace function app_brl(v numeric)
returns text language sql immutable as $$
  -- Formata no padrão americano (que não depende do idioma do
  -- servidor) e TROCA os dois separadores de uma vez.
  select 'R$ ' || translate(to_char(coalesce(v,0), 'FM999,999,999,990.00'), ',.', '.,')
$$;

-- Registra na trilha. Mesma tabela que o sistema usa.
create or replace function app_logar(
  p_entidade text, p_ref text, p_acao text, p_detalhe text)
returns void language plpgsql security definer as $$
declare u record;
begin
  select id, nome into u from usuarios where auth_id = auth.uid();
  -- `id` é bigserial e a coluna do registro referenciado chama-se
  -- `entidade_id` (não `ref`). Escrevi os dois errados na primeira
  -- versão, e o `exception` abaixo teria engolido o erro em
  -- silêncio — a aprovação valeria e a trilha ficaria vazia.
  insert into eventos (em, usuario, usuario_id, entidade, entidade_id, acao, detalhe)
  values (now(), coalesce(u.nome, '?'), u.id, p_entidade, p_ref, p_acao, p_detalhe);
exception when others then
  -- A trilha não pode derrubar a aprovação. Se a tabela mudou de
  -- forma, a aprovação vale e o registro falta — e isso aparece no
  -- log do Postgres, não em cima do usuário.
  raise warning 'trilha não registrada: %', sqlerrm;
end $$;

-- ──────────────────────────────────────────────────────────────
-- 1. APROVAR PAGAMENTO
--
-- Recebe a lista de pagamentos aguardando autorização. Confere, um
-- a um, e grava só os que passam. Devolve o que aprovou e o que
-- recusou, com o motivo de cada recusa — o aplicativo mostra isso
-- em vez de um "deu erro".
-- ──────────────────────────────────────────────────────────────

create or replace function aprovar_pagamento(p_ids text[])
returns jsonb language plpgsql security definer as $$
declare
  perfil    text := app_perfil();
  meu       text := app_usuario();
  politica  jsonb := app_politica();
  limite    numeric := app_alcada();
  pg        record;
  aprovados int := 0;
  recusas   jsonb := '[]'::jsonb;
  eu        record;
begin
  if meu is null then
    return jsonb_build_object('erro', 'Sessão não reconhecida. Entre de novo.');
  end if;
  if not tem_acao('aprovar') then
    return jsonb_build_object('erro', 'Seu perfil não aprova pagamento.');
  end if;
  -- A alçada 0 significa SEM LIMITE, então a trava de quem não
  -- aprova é esta lista, não o valor.
  if politica -> 'sem_aprovacao' ? perfil then
    return jsonb_build_object('erro',
      'Seu perfil não aprova pagamento — quem lança e solicita não é quem aprova.');
  end if;

  select id, nome into eu from usuarios where auth_id = auth.uid();

  for pg in
    select * from pagamentos where id = any(p_ids)
  loop
    if coalesce(pg.situacao, '') <> 'aguardando' then
      recusas := recusas || jsonb_build_object('id', pg.id,
        'motivo', 'não está aguardando autorização');
      continue;
    end if;

    if limite > 0 and (coalesce(pg.valor,0) + coalesce(pg.juros,0) + coalesce(pg.multa,0)) > limite then
      recusas := recusas || jsonb_build_object('id', pg.id,
        'motivo', 'acima da sua alçada de ' || app_brl(limite));
      continue;
    end if;

    -- Quem solicitou não aprova. Compara por id, não por nome:
    -- renomear o usuário derrubava a segregação, e dois homônimos
    -- também.
    if coalesce((politica ->> 'impedir_autoaprovacao')::boolean, true) and
       ((pg.usuario_id is not null and pg.usuario_id = eu.id) or
        (pg.usuario_id is null and pg.usuario = eu.nome)) then
      recusas := recusas || jsonb_build_object('id', pg.id,
        'motivo', 'solicitado por você — quem solicita não aprova');
      continue;
    end if;

    update pagamentos
       set situacao = 'autorizado',
           autorizado_por = eu.nome,
           autorizado_em = now()
     where id = pg.id;
    aprovados := aprovados + 1;
    perform app_logar('conta_pagar', pg.parcela_id, 'aprovou pagamento (celular)',
      app_brl(pg.valor) || ' — liberado para a remessa');
  end loop;

  return jsonb_build_object('ok', true, 'aprovados', aprovados, 'recusas', recusas);
end $$;

create or replace function recusar_pagamento(p_id text, p_motivo text)
returns jsonb language plpgsql security definer as $$
declare pg record; eu record;
begin
  if not tem_acao('aprovar') then
    return jsonb_build_object('erro', 'Seu perfil não recusa pagamento.');
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    return jsonb_build_object('erro', 'Informe o motivo da recusa.');
  end if;
  select * into pg from pagamentos where id = p_id;
  if pg is null or coalesce(pg.situacao,'') <> 'aguardando' then
    return jsonb_build_object('erro', 'Pagamento não está aguardando autorização.');
  end if;
  select id, nome into eu from usuarios where auth_id = auth.uid();
  update pagamentos
     set situacao = 'recusado', obs = coalesce(obs || ' · ', '') || 'recusado: ' || p_motivo
   where id = p_id;
  perform app_logar('conta_pagar', pg.parcela_id, 'recusou pagamento (celular)', p_motivo);
  return jsonb_build_object('ok', true);
end $$;

-- ──────────────────────────────────────────────────────────────
-- 2. APROVAR REQUISIÇÃO DE COMPRA
--
-- No celular a decisão é da requisição inteira: aprovar ou
-- reprovar. Aprovar item a item, com ajuste de quantidade, continua
-- só no computador — é trabalho de tela grande, e fingir que cabe
-- no telefone seria convidar ao erro.
-- ──────────────────────────────────────────────────────────────

create or replace function aprovar_requisicao(p_id text, p_decisao text, p_obs text)
returns jsonb language plpgsql security definer as $$
declare
  r        record;
  eu       record;
  politica jsonb := app_politica();
begin
  if not tem_acao('aprovar_compra') then
    return jsonb_build_object('erro', 'Seu perfil não aprova requisição de compra.');
  end if;
  select * into r from compras where id = p_id;
  if r is null then return jsonb_build_object('erro', 'Requisição não encontrada.'); end if;
  if coalesce(r.status,'') <> 'requisicao' then
    return jsonb_build_object('erro', 'Só requisição em aberto pode ser aprovada — esta está em "' || coalesce(r.status,'?') || '".');
  end if;

  select id, nome into eu from usuarios where auth_id = auth.uid();

  if coalesce((politica ->> 'impedir_autoaprovacao_compras')::boolean, false) and
     (r.extra ->> 'criado_por_id') = eu.id then
    return jsonb_build_object('erro',
      'Você abriu esta requisição — com a segregação ligada, quem pede não aprova.');
  end if;

  if p_decisao = 'reprovar' then
    if coalesce(btrim(p_obs), '') = '' then
      return jsonb_build_object('erro', 'Diga o motivo da reprovação — quem pediu precisa saber por quê.');
    end if;
    update compras
       set status = 'cancelada',
           historico = coalesce(historico, '[]'::jsonb) || jsonb_build_object(
             'status', 'cancelada', 'data', to_char(now(), 'YYYY-MM-DD'),
             'usuario', eu.nome, 'obs', 'reprovada no celular: ' || p_obs)
     where id = p_id;
    perform app_logar('compra', p_id, 'reprovou requisição (celular)', coalesce(r.numero,'') || ' · ' || p_obs);
    return jsonb_build_object('ok', true, 'cancelada', true);
  end if;

  update compras
     set status = 'aprovada',
         historico = coalesce(historico, '[]'::jsonb) || jsonb_build_object(
           'status', 'aprovada', 'data', to_char(now(), 'YYYY-MM-DD'),
           'usuario', eu.nome, 'obs', coalesce(nullif(p_obs,''), 'aprovada no celular')),
         extra = coalesce(extra, '{}'::jsonb) ||
           jsonb_build_object('aprovada_por', eu.nome, 'aprovada_em', now(),
                              'observacao_aprovacao', coalesce(p_obs,''))
   where id = p_id;
  perform app_logar('compra', p_id, 'aprovou requisição (celular)', coalesce(r.numero,''));
  return jsonb_build_object('ok', true);
end $$;

-- ──────────────────────────────────────────────────────────────
-- 3. APROVAR A COMPRA (depois da cotação)
--
-- Aqui a alçada volta a valer: é o momento em que o dinheiro é
-- comprometido com um fornecedor e um valor.
-- ──────────────────────────────────────────────────────────────

create or replace function aprovar_compra(p_id text, p_decisao text, p_obs text)
returns jsonb language plpgsql security definer as $$
declare
  r        record;
  eu       record;
  politica jsonb := app_politica();
  limite   numeric := app_alcada();
  total    numeric := 0;
  item     jsonb;
begin
  if not tem_acao('aprovar_compra') then
    return jsonb_build_object('erro', 'Seu perfil não aprova compra.');
  end if;
  select * into r from compras where id = p_id;
  if r is null then return jsonb_build_object('erro', 'Requisição não encontrada.'); end if;
  if coalesce(r.status,'') <> 'cotada' then
    return jsonb_build_object('erro', 'Só cotação registrada vai para a aprovação da compra — esta está em "' || coalesce(r.status,'?') || '".');
  end if;

  select id, nome into eu from usuarios where auth_id = auth.uid();

  if coalesce((politica ->> 'impedir_autoaprovacao_compras')::boolean, false) and
     (r.extra ->> 'cotado_por_id') = eu.id then
    return jsonb_build_object('erro',
      'Você lançou esta cotação — com a segregação ligada, quem cota não aprova a compra.');
  end if;

  -- Total cotado: quantidade aprovada × preço escolhido, item a item.
  for item in select * from jsonb_array_elements(coalesce(r.itens, '[]'::jsonb))
  loop
    if coalesce((item ->> 'reprovado')::boolean, false) then continue; end if;
    total := total + coalesce((item ->> 'qtd')::numeric, 0) *
                     coalesce((item ->> 'preco')::numeric, 0);
  end loop;

  if p_decisao = 'reprovar' then
    if coalesce(btrim(p_obs), '') = '' then
      return jsonb_build_object('erro', 'Diga o motivo da reprovação.');
    end if;
    update compras
       set status = 'cancelada',
           historico = coalesce(historico, '[]'::jsonb) || jsonb_build_object(
             'status', 'cancelada', 'data', to_char(now(), 'YYYY-MM-DD'),
             'usuario', eu.nome, 'obs', 'compra reprovada no celular: ' || p_obs)
     where id = p_id;
    perform app_logar('compra', p_id, 'reprovou compra (celular)', coalesce(r.numero,''));
    return jsonb_build_object('ok', true, 'cancelada', true);
  end if;

  if limite > 0 and total > limite then
    return jsonb_build_object('erro',
      'Compra de ' || app_brl(total) ||
      ' acima da sua alçada de ' || app_brl(limite) ||
      '. Peça a quem tem alçada maior.');
  end if;

  update compras
     set status = 'compra_aprovada',
         compra_aprovada_por = eu.nome,
         historico = coalesce(historico, '[]'::jsonb) || jsonb_build_object(
           'status', 'compra_aprovada', 'data', to_char(now(), 'YYYY-MM-DD'),
           'usuario', eu.nome, 'obs', coalesce(nullif(p_obs,''), 'aprovada no celular')),
         extra = coalesce(extra, '{}'::jsonb) ||
           jsonb_build_object('compra_aprovada_em', now(),
                              'observacao_aprovacao_compra', coalesce(p_obs,''))
   where id = p_id;
  perform app_logar('compra', p_id, 'aprovou compra (celular)',
    coalesce(r.numero,'') || ' · ' || app_brl(total));
  return jsonb_build_object('ok', true, 'total', total);
end $$;

-- ──────────────────────────────────────────────────────────────
-- 4. AUTORIZAR O FATURAMENTO
--
-- O protocolo é a razão de existir desta etapa: é o número que
-- prova que o órgão autorizou. Sem ele a liberação não acontece, e
-- faturar sem autorização é risco de glosa.
-- ──────────────────────────────────────────────────────────────

create or replace function autorizar_previsao(
  p_centro text, p_competencia text, p_protocolo text, p_obs text, p_substituir boolean)
returns jsonb language plpgsql security definer as $$
declare pv record; eu record;
begin
  if not tem_acao('autorizar_faturamento') then
    return jsonb_build_object('erro', 'Seu perfil não registra a autorização do órgão.');
  end if;
  if coalesce(btrim(p_protocolo), '') = '' then
    return jsonb_build_object('erro', 'Informe o protocolo devolvido pelo órgão — é o que prova a autorização.');
  end if;
  select * into pv from previsoes where centro = p_centro and competencia = p_competencia;
  if pv is null then
    return jsonb_build_object('erro', 'Não há previsão para este projeto nesta competência.');
  end if;
  if coalesce(pv.status,'') <> 'confirmada_prod' then
    return jsonb_build_object('erro',
      'O valor ainda não foi confirmado no fechamento da produtividade.');
  end if;

  -- Reautorizar substitui protocolo e valor. Pode ser legítimo (o
  -- órgão corrigiu o ofício), mas apaga o que estava registrado —
  -- então pergunta antes, e o anterior fica no histórico.
  if coalesce(pv.autorizacao_protocolo,'') <> '' and
     pv.autorizacao_protocolo <> p_protocolo and not coalesce(p_substituir, false) then
    return jsonb_build_object('erro',
      'Esta competência já está autorizada pelo protocolo ' || pv.autorizacao_protocolo ||
      ' no valor de ' || app_brl(pv.autorizado_valor) || '. Confirme a substituição.', 'substitui', true,
      'protocolo_anterior', pv.autorizacao_protocolo);
  end if;

  select id, nome into eu from usuarios where auth_id = auth.uid();

  update previsoes
     set autorizacoes_anteriores = case
           when coalesce(autorizacao_protocolo,'') <> '' and autorizacao_protocolo <> p_protocolo
           then coalesce(autorizacoes_anteriores, '[]'::jsonb) || jsonb_build_object(
             'protocolo', autorizacao_protocolo, 'valor', coalesce(autorizado_valor,0),
             'em', autorizado_em, 'por', autorizado_por)
           else coalesce(autorizacoes_anteriores, '[]'::jsonb) end,
         autorizado_em = current_date,
         autorizado_por = eu.nome,
         autorizado_por_id = eu.id,
         autorizacao_protocolo = p_protocolo,
         autorizacao_obs = coalesce(p_obs, ''),
         autorizado_valor = faturamento,
         -- quem autoriza libera junto: não há segunda mão a esperar
         liberado_em = coalesce(liberado_em, current_date),
         liberado_por = coalesce(liberado_por, eu.nome)
   where id = pv.id;

  perform app_logar('previsao', pv.id, 'autorizou faturamento (celular)',
    p_centro || ' · ' || p_competencia || ' · ' || p_protocolo);
  return jsonb_build_object('ok', true);
end $$;

-- ──────────────────────────────────────────────────────────────
-- 5. QUEM PODE CHAMAR
--
-- `authenticated` apenas: a chave pública sem login não chega aqui.
-- Dentro de cada função, o perfil é conferido de novo — estar
-- logado não é estar autorizado.
-- ──────────────────────────────────────────────────────────────

revoke all on function aprovar_pagamento(text[])            from public, anon;
revoke all on function recusar_pagamento(text, text)         from public, anon;
revoke all on function aprovar_requisicao(text, text, text)  from public, anon;
revoke all on function aprovar_compra(text, text, text)      from public, anon;
revoke all on function autorizar_previsao(text, text, text, text, boolean) from public, anon;

grant execute on function aprovar_pagamento(text[])           to authenticated;
grant execute on function recusar_pagamento(text, text)        to authenticated;
grant execute on function aprovar_requisicao(text, text, text) to authenticated;
grant execute on function aprovar_compra(text, text, text)     to authenticated;
grant execute on function autorizar_previsao(text, text, text, text, boolean) to authenticated;
grant execute on function app_politica()                       to authenticated;
grant execute on function app_alcada()                         to authenticated;
grant execute on function app_brl(numeric)                     to authenticated;

-- ──────────────────────────────────────────────────────────────
-- Conferência
-- ──────────────────────────────────────────────────────────────
select p.proname as funcao,
       pg_get_function_identity_arguments(p.oid) as argumentos
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('aprovar_pagamento','recusar_pagamento','aprovar_requisicao',
                     'aprovar_compra','autorizar_previsao','app_politica','app_alcada')
 order by 1;
-- esperado: 7 linhas

-- A política já está gravada? Vazio = ainda usando o padrão do
-- código; salve uma vez em Administração › Políticas.
select valor from parametros where chave = 'parametros_gerais';
