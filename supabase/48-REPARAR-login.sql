-- ERP Dom Pedro — religa os logins aos usuários do sistema
-- Etapa 48. Rode depois do 47, no banco onde o login falhou.
--
-- O QUE ELE FAZ, E SÓ
--
-- Preenche `usuarios.auth_id` com o id do login de MESMO e-mail. É
-- exatamente o que a Administração faz no botão "vincular login" —
-- e existe como arquivo porque, quando é o SEU login que perdeu o
-- vínculo, você não consegue entrar para apertar o botão. Trancar
-- quem administra fora do sistema é o pior jeito de descobrir isso.
--
-- Não cria login, não cria usuário, não mexe em senha, não mexe em
-- perfil. Se faltar um dos dois lados, ele deixa como está e diz
-- quem ficou de fora.
--
-- É seguro rodar mais de uma vez: na segunda passada não há o que
-- religar e a contagem sai zero.

-- ──────────────────────────────────────────────────────────────
-- 1. RELIGA
--
-- `is distinct from` e não `is null`: pega tanto o vínculo vazio
-- quanto o que aponta para um login antigo, de uma conta que foi
-- recriada no Supabase. Os dois dão a mesma tela.
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
-- 2. CONFERÊNCIA — uma consulta só, no fim
--
-- O editor do Supabase mostra apenas o resultado da última
-- consulta, então a conferência tem de ser a última coisa do
-- arquivo. Ela lista TODO MUNDO e diz quem entra e quem não entra.
-- ──────────────────────────────────────────────────────────────
select
  u.id                                        as usuario,
  u.nome,
  coalesce(u.email, '— sem e-mail —')         as email,
  u.perfil,
  case
    when not u.ativo        then 'NAO ENTRA — usuário inativo'
    when u.auth_id is null  then 'NAO ENTRA — nenhum login com este e-mail no Supabase'
    else 'entra no sistema'
  end                                         as login
from usuarios u
order by
  case when u.ativo and u.auth_id is not null then 2 else 1 end,
  (regexp_replace(u.id, '\D', '', 'g'))::int;

-- ESPERADO: o seu usuário com "entra no sistema". Se ele ainda
-- aparecer com "nenhum login com este e-mail", então o e-mail que
-- você digita no login não é o que está gravado em `usuarios` —
-- compare os dois na tabela do arquivo 47 e me mande.
