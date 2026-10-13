-- ERP Dom Pedro — conserta o vínculo e mostra o estado real do login
-- Etapa 51. Rode no banco do site onde você está TENTANDO ENTRAR.
--
-- Este arquivo substitui o 47 e o 48: faz o reparo e termina com a
-- única tabela que responde tudo de uma vez — cada credencial que
-- existe no Supabase, e a qual usuário do ERP ela dá acesso.
--
-- A tabela parte de `auth.users`, e não de `usuarios`. A diferença
-- importa: a lista que parte de `usuarios` diz "nenhum login com
-- este e-mail", o que é conclusão tirada de uma comparação de
-- e-mail — justamente a coisa que quebra nesses casos. Partindo das
-- credenciais, o que se vê é o fato: esta conta existe, e entra
-- como tal pessoa, ou não entra.
--
-- É seguro rodar mais de uma vez.

-- ──────────────────────────────────────────────────────────────
-- 1. RELIGA o que der para religar, pelo e-mail
-- ──────────────────────────────────────────────────────────────
do $$
declare n int;
begin
  update usuarios u
     set auth_id = a.id
    from auth.users a
   where u.email is not null
     and btrim(u.email) <> ''
     and lower(btrim(a.email)) = lower(btrim(u.email))
     and u.auth_id is distinct from a.id;
  get diagnostics n = row_count;
  raise notice 'vinculos religados nesta passada: %', n;
end $$;

-- ──────────────────────────────────────────────────────────────
-- 2. O ESTADO REAL — uma credencial por linha
-- ──────────────────────────────────────────────────────────────
select
  a.email                                           as email_do_login,
  case when a.email_confirmed_at is null
       then 'NAO CONFIRMADO' else 'confirmado' end  as credencial,
  coalesce(u.id, '—')                               as entra_como,
  coalesce(u.nome, '—')                             as nome,
  coalesce(u.perfil, '—')                           as perfil,
  case
    when u.id is null      then 'NAO ENTRA — esta credencial nao esta ligada a nenhum usuario do ERP'
    when not u.ativo       then 'NAO ENTRA — o usuario ligado esta inativo'
    else 'entra no sistema'
  end                                               as resultado
from auth.users a
left join usuarios u on u.auth_id = a.id
order by (u.id is not null), a.created_at;

-- COMO LER: procure a linha do e-mail que VOCÊ DIGITA.
--
--   "entra no sistema"  → o problema não está aqui. Recarregue com
--                         Ctrl+F5 e tente; se continuar, você está
--                         entrando no site do OUTRO banco.
--
--   "NAO ENTRA — ...nao esta ligada..." → o e-mail gravado no
--                         cadastro do usuário é diferente deste.
--                         Use o 50 para ligar na força.
--
--   o e-mail não aparece na lista → não existe credencial com esse
--                         endereço NESTE banco. Se mesmo assim a
--                         senha certa e a errada dão mensagens
--                         diferentes, é o outro banco que você está
--                         usando.
