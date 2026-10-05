-- ERP Dom Pedro — endereço do QR das etiquetas
-- Etapa 29.
--
-- O QR apontava para erp.dompedrosaude.com.br/chamado, endereço que
-- nunca existiu. Passa a apontar para a página pública publicada,
-- que fica separada do sistema de propósito: quem lê uma etiqueta
-- não precisa descobrir onde está o ERP.
--
-- Quando houver domínio próprio (chamado.dompedrosaude.com.br), é
-- só mudar aqui ou em Administração › Parâmetros — as etiquetas já
-- impressas continuam valendo se o endereço antigo redirecionar.

-- A coluna `valor` é jsonb: o endereço entra como texto JSON.
insert into parametros (chave, valor)
values ('url_chamado', '"https://orb-chamado.vercel.app"'::jsonb)
on conflict (chave) do update set valor = excluded.valor;

-- Conferência:
--   select chave, valor from parametros where chave = 'url_chamado';
