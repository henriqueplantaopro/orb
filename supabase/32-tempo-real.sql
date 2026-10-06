-- ERP Dom Pedro — atualização em tempo real
-- Etapa 32.
--
-- Sem isto, cada tela trabalha com o retrato do banco no momento
-- em que foi aberta. Duas pessoas no sistema ao mesmo tempo veem
-- coisas diferentes, e no estoque isso faz alguém decidir uma
-- compra olhando um saldo que já não existe.
--
-- O Supabase avisa o navegador quando uma linha muda, mas só das
-- tabelas que estiverem nesta publicação. As de MOVIMENTO entram;
-- as de cadastro ficam de fora porque mudam pouco e a recarga
-- periódica dá conta.

do $$
declare t text;
begin
  foreach t in array array[
    'estoque_movimentos', 'posicoes_estoque', 'estoque_camadas',
    'titulos', 'parcelas', 'pagamentos', 'receber',
    'compras', 'procedimentos', 'previsoes',
    'ativos', 'ativo_movimentos', 'ordens_servico', 'chamados'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception
      when duplicate_object then null;   -- já estava publicada
      when undefined_table then
        raise notice 'tabela % não existe, ignorada', t;
    end;
  end loop;
end $$;

-- Conferência: quais tabelas avisam em tempo real.
--
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' order by 1;
