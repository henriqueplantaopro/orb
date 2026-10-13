-- ERP Dom Pedro — liga o SEU login ao SEU usuário, na força
-- Etapa 50. Rode no banco do site onde você está tentando entrar.
--
-- QUANDO USAR ESTE, E NÃO O 48
--
-- O 48 liga pelo e-mail: ele acha o login com o mesmo endereço que
-- está gravado em `usuarios` e preenche o vínculo. Isso não resolve
-- quando o endereço gravado é OUTRO, ou está em branco — e aí o 48
-- religa zero e a tela continua igual.
--
-- Este aqui não depende do e-mail gravado: você diz qual login está
-- usando e qual usuário do sistema você é, e ele liga os dois. Além
-- de ligar, corrige o e-mail do cadastro, para o 48 passar a
-- funcionar da próxima vez.
--
-- PREENCHA AS DUAS LINHAS ABAIXO E RODE O ARQUIVO INTEIRO.

do $$
declare
  -- 1. O e-mail que você DIGITA na tela de login:
  meu_email  text := 'henrique@dompedrosaude.com.br';
  -- 2. O id do seu usuário no sistema (a coluna `usuario` da tabela
  --    do arquivo 47; o Administrador costuma ser 'u5'):
  meu_id     text := 'u5';

  v_auth uuid;
  v_nome text;
begin
  select id into v_auth from auth.users
   where lower(btrim(email)) = lower(btrim(meu_email));
  if v_auth is null then
    raise exception 'Nao existe login com o e-mail %. Confira a lista em '
                    'Authentication > Users, no painel do Supabase.', meu_email;
  end if;

  select nome into v_nome from usuarios where id = meu_id;
  if v_nome is null then
    raise exception 'Nao existe usuario com o id % na tabela usuarios. '
                    'Pegue o id certo na tabela do arquivo 47.', meu_id;
  end if;

  -- Solta o vínculo de quem estiver com este login (a coluna é
  -- unique: sem isto, ligar daria erro de chave duplicada).
  update usuarios set auth_id = null
   where auth_id = v_auth and id <> meu_id;

  -- E liga, corrigindo o e-mail do cadastro de uma vez. O e-mail
  -- também é unique, então um homônimo em outra linha sai primeiro.
  update usuarios set email = null
   where lower(btrim(email)) = lower(btrim(meu_email)) and id <> meu_id;

  update usuarios
     set auth_id = v_auth,
         email   = btrim(meu_email),
         ativo   = true
   where id = meu_id;

  raise notice 'Pronto: % (%) agora entra com o e-mail %.', v_nome, meu_id, meu_email;
end $$;

-- ──────────────────────────────────────────────────────────────
-- CONFERÊNCIA — quem entra e quem não entra
-- ──────────────────────────────────────────────────────────────
select
  u.id                                        as usuario,
  u.nome,
  coalesce(u.email, '— sem e-mail —')         as email,
  u.perfil,
  case
    when not u.ativo        then 'NAO ENTRA — usuário inativo'
    when u.auth_id is null  then 'NAO ENTRA — nenhum login ligado a este usuário'
    else 'entra no sistema'
  end                                         as login
from usuarios u
order by
  case when u.ativo and u.auth_id is not null then 2 else 1 end,
  (regexp_replace(u.id, '\D', '', 'g'))::int;

-- DEPOIS DE RODAR: recarregue a tela de login com Ctrl+F5 antes de
-- tentar de novo. A página guarda a sessão anterior, e sem recarregar
-- ela repete a mesma mensagem mesmo com o banco já corrigido.
