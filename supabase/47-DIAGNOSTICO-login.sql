-- ERP Dom Pedro — por que o login diz "não vinculado"
-- Etapa 47. Rode no banco onde o login falhou.
--
-- Esta consulta NÃO altera nada. Ela só responde a pergunta.
--
-- A tela mostra a mesma frase para quatro situações diferentes, e
-- é por isso que ela não ajuda a decidir o que fazer:
--
--   1. o login existe no Supabase e o usuário existe no sistema,
--      mas o vínculo (`usuarios.auth_id`) está vazio;
--   2. o vínculo existe e aponta para OUTRO login (conta recriada
--      no Supabase, por exemplo);
--   3. o login existe e NÃO há usuário no sistema com aquele
--      e-mail;
--   4. há usuário no sistema e nenhum login criado para ele.
--
-- A coluna `o_que_fazer` diz qual é o caso de cada linha.
--
-- A comparação de e-mail ignora maiúsculas e espaços nas pontas —
-- "Marcia@DomPedroSaude.com.br" e "marcia@dompedrosaude.com.br" são
-- o mesmo endereço. Diferença de verdade (um ponto, um acento, um
-- domínio trocado) aparece como DUAS linhas: uma "3." e uma "4.".

select
  coalesce(u.id, '—')                                   as usuario,
  coalesce(u.nome, '(só existe o login)')               as nome,
  coalesce(u.email, '—')                                as email_no_sistema,
  coalesce(a.email, '—')                                as email_do_login,
  coalesce(u.perfil, '—')                               as perfil,
  case when u.ativo is false then 'INATIVO' else 'ativo' end as situacao,
  case
    when u.id is null                      then '3. login sem usuário no sistema — cadastre a pessoa na Administração ou apague este login'
    when a.id is null and u.email is null  then '4. usuário sem e-mail — preencha o e-mail e depois crie o login'
    when a.id is null                      then '4. falta criar o login deste e-mail no Supabase (Authentication > Users)'
    when u.auth_id is null                 then '1. ENTRA NO REPARO do 48 — login e usuário existem, falta o vínculo'
    when u.auth_id <> a.id                 then '2. vínculo aponta para outro login — o 48 corrige'
    else 'ok — este entra no sistema'
  end                                                   as o_que_fazer
from usuarios u
full outer join auth.users a
  on lower(btrim(a.email)) = lower(btrim(u.email))
order by
  case
    when u.auth_id is not null and u.auth_id = a.id then 2   -- os que já funcionam, no fim
    else 1
  end,
  u.id nulls last, a.email;

-- COMO LER: se o seu e-mail aparecer com "1." ou "2.", o problema é
-- só o vínculo e o arquivo 48 resolve. Se aparecer com "3." ou
-- "4.", falta cadastro de um lado ou do outro, e o 48 não tem o que
-- ligar — me mande esta tabela.
