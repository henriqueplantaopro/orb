-- ERP Dom Pedro — aviso por e-mail quando um chamado é aberto
-- Etapa 60.
--
-- POR QUE ISTO MORA NO BANCO, E NÃO NA PÁGINA NEM NO ERP.
--
-- A página da etiqueta e o ERP rodam no navegador. Chave de serviço
-- de e-mail colocada lá fica à vista de quem abrir o código — é a
-- mesma regra que mantém a `service_role` do Supabase fora do
-- repositório. E o chamado das duas da manhã precisa avisar mesmo
-- sem ninguém logado em lugar nenhum.
--
-- Então quem avisa é o próprio banco: um gatilho em `chamados` que,
-- a cada linha nova, manda o e-mail pelo Resend. A chave fica numa
-- tabela que nem `anon` nem `authenticated` alcançam, num esquema
-- que a API do Supabase não expõe.
--
-- O QUE ACONTECE SE O E-MAIL FALHAR: nada. O gatilho é AFTER INSERT
-- e tem tratamento de exceção — chave errada, Resend fora do ar,
-- domínio não verificado, tudo isso vira linha no registro de saída
-- e o chamado é gravado do mesmo jeito. O enfermeiro nunca perde o
-- chamado por causa do e-mail.

-- ╔═══════════════════════════════════════════════════════════════╗
-- ║  EDITE AS TRÊS LINHAS ABAIXO ANTES DE RODAR.                  ║
-- ║                                                               ║
-- ║  1. chave     → a chave da API do Resend (começa com re_)      ║
-- ║  2. remetente → de onde o e-mail sai                           ║
-- ║  3. destinos  → para quem vai, separados por vírgula            ║
-- ║                                                               ║
-- ║  Enquanto a chave não for colada, tudo é instalado mas fica    ║
-- ║  DESLIGADO — nada é enviado e nada quebra.                     ║
-- ╚═══════════════════════════════════════════════════════════════╝
create temp table _cfg as
select
  're_COLE_AQUI_A_CHAVE_DO_RESEND'                          as chave,
  /* Subdomínio de propósito: o `dompedrosaude.com.br` puro já tem
     SPF do Gmail, e dois registros SPF no mesmo nome quebram os
     dois. Verificando `avisos.` no Resend, nada do e-mail
     institucional é tocado. */
  'ORB <chamados@avisos.dompedrosaude.com.br>'              as remetente,
  'COLE-AQUI@dompedrosaude.com.br'                          as destinos,
  'https://orb-sistema.vercel.app'                          as url_erp;

-- ── 1. A extensão que faz a chamada HTTP ──────────────────────
--
-- `pg_net` já vem com o Supabase; só precisa ser ligada. Ela envia
-- em segundo plano: o gatilho enfileira e devolve na hora, então o
-- INSERT do chamado não espera o Resend responder.
do $$
begin
  if to_regproc('net.http_post') is null then
    begin
      execute 'create extension if not exists pg_net';
    exception when others then
      raise exception
        'Nao consegui ligar a extensao pg_net (%). Ligue em Database > Extensions no painel do Supabase e rode isto de novo.',
        sqlerrm;
    end;
  end if;
end $$;

-- ── 2. Onde a chave fica guardada ─────────────────────────────
--
-- Esquema próprio, fora do `public`. O Supabase só expõe pela API
-- os esquemas que estão na lista de exposição, e `privado` não
-- está. Mesmo assim, revogo tudo explicitamente: defesa em duas
-- camadas, porque a lista de exposição é configuração e configuração
-- muda sem avisar.
create schema if not exists privado;
revoke all on schema privado from public;
revoke all on schema privado from anon, authenticated;

create table if not exists privado.email_config (
  id        int primary key default 1 check (id = 1),
  chave     text not null default '',
  remetente text not null default '',
  destinos  text[] not null default '{}',
  url_erp   text not null default 'https://orb-sistema.vercel.app',
  ligado    boolean not null default false,
  atualizado_em timestamptz not null default now()
);

create table if not exists privado.email_log (
  id        bigserial primary key,
  chamado   bigint,
  destinos  text[],
  assunto   text,
  pedido    bigint,
  erro      text,
  criado_em timestamptz not null default now()
);
create index if not exists email_log_data_idx on privado.email_log (criado_em desc);

revoke all on all tables in schema privado from public;
revoke all on all tables in schema privado from anon, authenticated;
revoke all on all sequences in schema privado from anon, authenticated;

-- ── 3. Grava a configuração ───────────────────────────────────
insert into privado.email_config (id, chave, remetente, destinos, url_erp, ligado)
select 1,
       btrim(c.chave),
       btrim(c.remetente),
       (select array_agg(btrim(x)) from unnest(string_to_array(c.destinos, ',')) x
         where btrim(x) <> ''),
       btrim(c.url_erp),
       /* Só liga se a chave E o destinatário foram realmente
          preenchidos. Ligado pela metade seria pior que desligado:
          manda para o vazio e ninguém descobre. */
       btrim(c.chave) like 're\_%' and btrim(c.chave) not like '%COLE_AQUI%'
       and c.destinos not like '%COLE-AQUI%' and btrim(c.destinos) <> ''
  from _cfg c
on conflict (id) do update set
  chave = excluded.chave, remetente = excluded.remetente,
  destinos = excluded.destinos, url_erp = excluded.url_erp,
  ligado = excluded.ligado, atualizado_em = now();

-- ── 4. Escapar o texto de quem digitou ────────────────────────
--
-- O que o enfermeiro escreveu entra num e-mail HTML. Sem escapar,
-- um `<` na descrição desmonta o e-mail — e abre a porta para
-- conteúdo injetado por quem lê a etiqueta.
create or replace function privado.htm(t text) returns text
language sql immutable as $$
  select coalesce(
    replace(replace(replace(replace(t, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'),
    '');
$$;

-- ── 5. O gatilho ──────────────────────────────────────────────
create or replace function public.chamado_avisa_email() returns trigger
language plpgsql security definer
set search_path = public, privado, net
as $$
declare
  cfg      privado.email_config;
  eq_desc  text; eq_local text; eq_cust text; eq_proj text;
  urg      text; cor text; assun text; corpo text;
  pedido   bigint;
begin
  select * into cfg from privado.email_config where id = 1;
  if cfg.id is null or not cfg.ligado or btrim(coalesce(cfg.chave, '')) = ''
     or coalesce(array_length(cfg.destinos, 1), 0) = 0 then
    return new;
  end if;

  /* A etapa 58 grava um chamado de mentira para testar permissão e
     apaga em seguida. Ninguém precisa de e-mail por causa disso. */
  if coalesce(new.tag, '') = 'TESTE-DIAGNOSTICO' then return new; end if;

  select a.descricao, a.local, a.custodiante, a.projeto_nome
    into eq_desc, eq_local, eq_cust, eq_proj
    from public.ativos a where a.id = new.ativo;

  urg := case new.urgencia
           when 'critica' then 'CRÍTICA — risco ao atendimento'
           when 'alta'    then 'ALTA — equipamento parado'
           else                'Normal' end;
  cor := case new.urgencia
           when 'critica' then '#b00020'
           when 'alta'    then '#b45309'
           else                '#374151' end;

  assun := '[ORB] Chamado ' || new.id || ' · ' ||
           case new.urgencia when 'critica' then 'CRÍTICA'
                             when 'alta'    then 'Alta' else 'Normal' end ||
           ' · ' || coalesce(nullif(new.tag, ''), coalesce(new.ativo, 'sem etiqueta')) ||
           coalesce(' — ' || eq_desc, '');

  corpo :=
    '<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:15px;' ||
      'line-height:1.5;color:#111;max-width:620px">' ||
    '<p style="margin:0 0 4px;font-size:13px;color:#6b7280">Chamado aberto pela etiqueta do equipamento</p>' ||
    '<h2 style="margin:0 0 2px;font-size:19px">Chamado ' || new.id || '</h2>' ||
    '<p style="margin:0 0 16px;font-weight:600;color:' || cor || '">' || urg || '</p>' ||

    '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">' ||
    '<tr><td style="padding:6px 10px 6px 0;color:#6b7280;white-space:nowrap;vertical-align:top">Equipamento</td>' ||
      '<td style="padding:6px 0"><strong>' ||
        privado.htm(coalesce(nullif(new.tag, ''), new.ativo, '(sem etiqueta)')) ||
        '</strong>' || coalesce(' — ' || privado.htm(eq_desc), '') || '</td></tr>' ||

    '<tr><td style="padding:6px 10px 6px 0;color:#6b7280;vertical-align:top">O que está acontecendo</td>' ||
      '<td style="padding:6px 0">' || privado.htm(new.descricao) || '</td></tr>' ||

    '<tr><td style="padding:6px 10px 6px 0;color:#6b7280;vertical-align:top">Onde está</td>' ||
      '<td style="padding:6px 0">' ||
        coalesce(nullif(privado.htm(new.local_informado), ''), '<span style="color:#9ca3af">não informado</span>') ||
        coalesce('<br><span style="color:#6b7280;font-size:13px">no cadastro: ' ||
                 privado.htm(nullif(eq_local, '')) || '</span>', '') ||
        coalesce('<br><span style="color:#6b7280;font-size:13px">projeto: ' ||
                 privado.htm(nullif(eq_proj, '')) || '</span>', '') ||
      '</td></tr>' ||

    '<tr><td style="padding:6px 10px 6px 0;color:#6b7280;vertical-align:top">Quem abriu</td>' ||
      '<td style="padding:6px 0">' ||
        coalesce(nullif(privado.htm(new.contato_nome), ''), '<span style="color:#9ca3af">não informado</span>') ||
        coalesce(' · <a href="tel:' || privado.htm(new.contato_fone) || '">' ||
                 privado.htm(nullif(new.contato_fone, '')) || '</a>', '') ||
      '</td></tr>' ||

    coalesce('<tr><td style="padding:6px 10px 6px 0;color:#6b7280;vertical-align:top">Custodiante</td>' ||
      '<td style="padding:6px 0">' || privado.htm(nullif(eq_cust, '')) || '</td></tr>', '') ||

    '<tr><td style="padding:6px 10px 6px 0;color:#6b7280;vertical-align:top">Aberto em</td>' ||
      '<td style="padding:6px 0">' ||
        to_char(new.criado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || ' às ' ||
        to_char(new.criado_em at time zone 'America/Sao_Paulo', 'HH24:MI') || '</td></tr>' ||
    '</table>' ||

    '<p style="margin:20px 0 0"><a href="' || privado.htm(cfg.url_erp) ||
      '" style="background:#111;color:#fff;text-decoration:none;padding:10px 16px;' ||
      'border-radius:6px;display:inline-block">Abrir no ORB</a></p>' ||
    '<p style="margin:14px 0 0;font-size:12px;color:#9ca3af">' ||
      'Aviso automático do ORB. Para atender, entre em Ativos › Chamados.</p>' ||
    '</div>';

  select net.http_post(
           url := 'https://api.resend.com/emails',
           headers := jsonb_build_object(
             'Content-Type', 'application/json',
             'Authorization', 'Bearer ' || cfg.chave),
           body := jsonb_build_object(
             'from', cfg.remetente,
             'to', to_jsonb(cfg.destinos),
             'subject', assun,
             'html', corpo),
           timeout_milliseconds := 8000)
    into pedido;

  insert into privado.email_log (chamado, destinos, assunto, pedido)
  values (new.id, cfg.destinos, assun, pedido);

  return new;
exception when others then
  /* O chamado vale mais que o aviso. Registra o motivo e segue. */
  begin
    insert into privado.email_log (chamado, assunto, erro)
    values (new.id, '(nao enviado)', sqlerrm);
  exception when others then null;
  end;
  return new;
end $$;

drop trigger if exists chamado_email on chamados;
create trigger chamado_email
  after insert on chamados
  for each row execute function public.chamado_avisa_email();

-- ── 6. Um e-mail de teste, sem abrir chamado ──────────────────
--
-- Rode `select privado.email_testar();` no editor. Devolve o texto
-- do que aconteceu. Serve para separar dois problemas que parecem o
-- mesmo: "o gatilho não disparou" e "o Resend recusou".
create or replace function privado.email_testar() returns text
language plpgsql security definer set search_path = public, privado, net as $$
declare cfg privado.email_config; pedido bigint;
begin
  select * into cfg from privado.email_config where id = 1;
  if cfg.id is null then return 'Nao ha configuracao gravada — rode a etapa 60 inteira.'; end if;
  if not cfg.ligado then return 'DESLIGADO: a chave do Resend nao foi colada na etapa 60.'; end if;
  select net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || cfg.chave),
    body := jsonb_build_object('from', cfg.remetente, 'to', to_jsonb(cfg.destinos),
      'subject', '[ORB] teste de aviso de chamado',
      'html', '<p>Se este e-mail chegou, o aviso de chamado esta funcionando.</p>'),
    timeout_milliseconds := 8000) into pedido;
  insert into privado.email_log (chamado, destinos, assunto, pedido)
  values (null, cfg.destinos, '[ORB] teste de aviso de chamado', pedido);
  return 'Enviado ao Resend (pedido ' || pedido ||
         '). Veja o resultado em: select * from privado.email_saida limit 5;';
end $$;

-- ── 7. O que saiu, e o que o Resend respondeu ─────────────────
--
-- `pg_net` guarda a resposta de cada chamada. 200 com um `id` quer
-- dizer aceito pelo Resend. 401 é chave errada; 403 costuma ser
-- domínio não verificado; 422, remetente ou destinatário recusado.
create or replace view privado.email_saida as
  select l.criado_em, l.chamado, l.assunto, l.destinos,
         r.status_code                       as http,
         left(coalesce(r.content, ''), 300)  as resposta,
         nullif(r.error_msg, '')             as erro_rede,
         l.erro                              as erro_banco
    from privado.email_log l
    left join net._http_response r on r.id = l.pedido
   order by l.criado_em desc;

revoke all on privado.email_saida from anon, authenticated;

-- ── 8. CONFERÊNCIA (uma única saída) ──────────────────────────
drop table if exists diag;
create temp table diag (ordem int, o_que text, resultado text);

do $$
declare cfg privado.email_config;
begin
  select * into cfg from privado.email_config where id = 1;

  insert into diag values
    (10, 'extensao pg_net ligada',
         case when to_regproc('net.http_post') is null then 'NAO' else 'sim' end),
    (20, 'gatilho chamado_email instalado',
         case when exists (select 1 from pg_trigger
                            where tgrelid = to_regclass('public.chamados')
                              and tgname = 'chamado_email' and not tgisinternal)
              then 'sim' else 'NAO' end),
    (30, 'esquema privado fora do alcance de anon',
         case when has_schema_privilege('anon', 'privado', 'USAGE')
              then 'NAO — anon alcanca' else 'sim' end),
    (31, 'esquema privado fora do alcance de authenticated',
         case when has_schema_privilege('authenticated', 'privado', 'USAGE')
              then 'NAO — authenticated alcanca' else 'sim' end),
    (32, 'a chave esta fora do alcance de anon',
         case when has_table_privilege('anon', 'privado.email_config', 'SELECT')
              then 'NAO — anon le a chave' else 'sim' end),
    (40, '>>> O AVISO ESTA LIGADO?',
         case when cfg.id is null then 'NAO — nao gravou configuracao'
              when cfg.ligado then 'SIM'
              when coalesce(array_to_string(cfg.destinos, ','), '') like '%COLE-AQUI%'
                or coalesce(array_length(cfg.destinos, 1), 0) = 0
                   then 'NAO — falta o endereco de destino no alto do arquivo'
              else 'NAO — a chave do Resend nao foi colada no alto do arquivo' end),
    (50, 'remetente', coalesce(nullif(cfg.remetente, ''), '(vazio)')),
    (51, 'destinos', coalesce(array_to_string(cfg.destinos, ', '), '(nenhum)')),
    (52, 'chave', case when coalesce(cfg.chave, '') = '' then '(vazia)'
                       when cfg.ligado then 'colada (' || length(cfg.chave) || ' caracteres)'
                       else 'ainda o lugar reservado' end),
    (60, 'chamados ja abertos',
         (select count(*)::text from chamados)),
    (90, 'PROXIMO PASSO',
         case when coalesce(cfg.ligado, false)
              then 'rode:  select privado.email_testar();'
              else 'preencha as linhas do alto deste arquivo e rode de novo' end);
end $$;

select o_que, resultado from diag order by ordem, o_que;
