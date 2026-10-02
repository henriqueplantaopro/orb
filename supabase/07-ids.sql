-- ERP Dom Pedro — reserva de ids em bloco
-- Etapa 7. Roda depois dos anteriores.
--
-- A `proximo_id` entrega um id por chamada. Na carga inicial o
-- sistema precisa de um punhado deles adiantado, e pedir um por vez
-- significava vinte idas e voltas pela rede — uns quinze segundos
-- em que o sistema parecia carregado mas ainda não gravava.
--
-- Esta função reserva um BLOCO de uma vez e devolve o primeiro
-- número. O cliente usa de `inicio` até `inicio + qtd - 1` sem
-- falar com o banco de novo, e ninguém mais recebe esses números.

create or replace function reservar_ids(qtd int)
returns bigint language plpgsql security definer as $$
declare inicio bigint;
begin
  if app_usuario() is null then
    raise exception 'sem usuário autenticado';
  end if;
  if qtd is null or qtd < 1 or qtd > 1000 then
    raise exception 'quantidade fora do intervalo (1 a 1000)';
  end if;
  update sequencia set valor = valor + qtd where id = 1
    returning valor - qtd + 1 into inicio;
  return inicio;
end $$;

revoke all on function reservar_ids(int) from public, anon;
grant execute on function reservar_ids(int) to authenticated;

-- Conferência (como usuário logado):
--   select reservar_ids(5);   -- devolve o primeiro de um bloco de 5
