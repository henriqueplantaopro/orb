-- ERP Dom Pedro — senha provisória
-- Etapa 9. Roda depois dos anteriores.
--
-- Fluxo: quando alguém esquece a senha, o administrador define uma
-- provisória pelo painel do Supabase e marca o usuário aqui. No
-- próximo acesso, o sistema EXIGE a troca antes de deixar usar
-- qualquer coisa.
--
-- O efeito importante é o que o próprio dono pediu: o administrador
-- deixa de saber a senha de alguém assim que a pessoa entra. Senha
-- que o administrador conhece não serve de prova de autoria — se um
-- pagamento foi aprovado com o login de outra pessoa e você sabia a
-- senha dela, a trilha perde valor como prova.

alter table usuarios add column if not exists senha_provisoria boolean not null default false;

-- Quem marca é a Administração, pela tela — a política de update
-- de `usuarios` já cobre isso.
--
-- Quem DESMARCA é a própria pessoa, ao trocar a senha. E aí há um
-- problema: a política proíbe alguém de alterar o próprio registro,
-- justamente para ninguém se promover. A saída é esta função, que
-- roda com privilégio e mexe em UM campo só — não dá para usá-la
-- para virar administrador.
create or replace function marcar_senha_trocada()
returns void language plpgsql security definer as $$
begin
  if app_usuario() is null then
    raise exception 'sem usuário autenticado';
  end if;
  update usuarios set senha_provisoria = false where id = app_usuario();
end $$;

revoke all on function marcar_senha_trocada() from public, anon;
grant execute on function marcar_senha_trocada() to authenticated;

-- Conferência:
--   select id, nome, senha_provisoria from usuarios order by id;
