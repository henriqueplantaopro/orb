-- ERP Dom Pedro — previsões por projeto
-- Etapa 22.
--
-- Cada projeto recebe a previsão estimada de faturamento do mês.
--
-- No HGB os sete setores continuam separados, como já estavam: a
-- produtividade e o pedido de faturamento vêm POR ESPECIALIDADE, e
-- só a NOTA é única. O campo `grupo_faturamento` é o que amarra
-- isso, e o rateio da nota segue a proporção do que cada setor
-- confirmou de produtividade no mês — margem, custo e faturamento
-- seguem visíveis por especialidade. O mesmo vale para o mutirão.
--
-- A previsão do contrato (R$ 2.043.819,83) fica no projeto âncora
-- do grupo, e não repartida entre os setores. Dividir em partes
-- iguais faria cada setor pedir nota própria — o sistema tem teste
-- justamente para isso. A repartição real acontece no rateio, com
-- base no que cada um produziu, que é mais preciso que qualquer
-- divisão feita hoje.

update centros set ativo = true, prev_faturamento = 22868.84, cliente = 'cl08', tipo_servico = 'medico' where id = 'pj01';
update centros set ativo = true, prev_faturamento = 21562.05, cliente = 'cl16', tipo_servico = 'medico' where id = 'pj02';
update centros set ativo = true, prev_faturamento = 4900.47, cliente = 'cl17', tipo_servico = 'medico' where id = 'pj03';
update centros set ativo = true, prev_faturamento = 11761.12, cliente = 'cl18', tipo_servico = 'medico' where id = 'pj04';
update centros set ativo = true, prev_faturamento = 110750.54, cliente = 'cl19', tipo_servico = 'medico' where id = 'pj05';
update centros set ativo = true, prev_faturamento = 29577.04, cliente = 'cl07', tipo_servico = 'medico' where id = 'pj06';
update centros set ativo = true, prev_faturamento = 93519.84, cliente = 'cl06', tipo_servico = 'medico' where id = 'pj07';
update centros set ativo = true, prev_faturamento = 358082.89, cliente = 'cl05', tipo_servico = 'medico' where id = 'pj08';
update centros set ativo = true, prev_faturamento = 323876.8, cliente = 'cl04', tipo_servico = 'medico' where id = 'pj09';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl04', tipo_servico = 'medico' where id = 'pj10';
update centros set ativo = true, prev_faturamento = 2043819.83, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj11';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj44';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj45';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj46';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj47';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj48';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj49';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj50';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj51';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj52';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj53';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj54';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj55';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl03', tipo_servico = 'medico' where id = 'pj56';
update centros set ativo = true, prev_faturamento = 58545.58, cliente = 'cl12', tipo_servico = 'medico' where id = 'pj12';
update centros set ativo = true, prev_faturamento = 97.6, cliente = 'cl12', tipo_servico = 'medico' where id = 'pj13';
update centros set ativo = true, prev_faturamento = 4698.56, cliente = 'cl12', tipo_servico = 'medico' where id = 'pj14';
update centros set ativo = true, prev_faturamento = 1272.73, cliente = 'cl12', tipo_servico = 'medico' where id = 'pj15';
update centros set ativo = true, prev_faturamento = 216000.51, cliente = 'cl15', tipo_servico = 'medico' where id = 'pj16';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl15', tipo_servico = 'medico' where id = 'pj17';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl01', tipo_servico = 'medico' where id = 'pj18';
update centros set ativo = true, prev_faturamento = 213427.2, cliente = 'cl01', tipo_servico = 'medico' where id = 'pj19';
update centros set ativo = true, prev_faturamento = 355713.6, cliente = 'cl01', tipo_servico = 'medico' where id = 'pj20';
update centros set ativo = true, prev_faturamento = 327600, cliente = 'cl01', tipo_servico = 'medico' where id = 'pj21';
update centros set ativo = true, prev_faturamento = 387223.52, cliente = 'cl09', tipo_servico = 'medico' where id = 'pj22';
update centros set ativo = true, prev_faturamento = 435765.29, cliente = 'cl02', tipo_servico = 'medico' where id = 'pj23';
update centros set ativo = true, prev_faturamento = 265036.5, cliente = 'cl02', tipo_servico = 'medico' where id = 'pj24';
update centros set ativo = true, prev_faturamento = 177696.23, cliente = 'cl02', tipo_servico = 'medico' where id = 'pj25';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl02', tipo_servico = 'medico' where id = 'pj26';
update centros set ativo = true, prev_faturamento = 84000, cliente = 'cl02', tipo_servico = 'medico' where id = 'pj27';
update centros set ativo = true, prev_faturamento = 94399.2, cliente = 'cl20', tipo_servico = 'medico' where id = 'pj28';
update centros set ativo = true, prev_faturamento = 190800, cliente = 'cl10', tipo_servico = 'medico' where id = 'pj29';
update centros set ativo = true, prev_faturamento = 35122.25, cliente = 'cl14', tipo_servico = 'medico' where id = 'pj30';
update centros set ativo = true, prev_faturamento = 5490, cliente = 'cl13', tipo_servico = 'medico' where id = 'pj31';
update centros set ativo = true, prev_faturamento = 7680, cliente = 'cl13', tipo_servico = 'medico' where id = 'pj32';
update centros set ativo = true, prev_faturamento = 289293.88, cliente = 'cl21', tipo_servico = 'medico' where id = 'pj33';
update centros set ativo = true, prev_faturamento = 720575.78, cliente = 'cl22', tipo_servico = 'medico' where id = 'pj34';
update centros set ativo = true, prev_faturamento = 506248.78, cliente = 'cl22', tipo_servico = 'medico' where id = 'pj35';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl23', tipo_servico = 'locacao' where id = 'pj36';
update centros set ativo = true, prev_faturamento = 104700, cliente = 'cl24', tipo_servico = 'locacao' where id = 'pj37';
update centros set ativo = true, prev_faturamento = 14000, cliente = 'cl05', tipo_servico = 'locacao' where id = 'pj38';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl05', tipo_servico = 'locacao' where id = 'pj39';
update centros set ativo = true, prev_faturamento = 5000, cliente = 'cl05', tipo_servico = 'locacao' where id = 'pj40';
update centros set ativo = true, prev_faturamento = 227343.74, cliente = 'cl25', tipo_servico = 'locacao' where id = 'pj41';
update centros set ativo = true, prev_faturamento = 21600, cliente = 'cl26', tipo_servico = 'locacao' where id = 'pj42';
update centros set ativo = true, prev_faturamento = 0, cliente = 'cl27', tipo_servico = 'medico' where id = 'pj43';

-- Conferência:
--
--   select curto, prev_faturamento from centros
--    where grupo_faturamento = 'GHC - HGB' order by prev_faturamento desc;
--   -- o âncora com 2043819.83, os demais zerados
--
--   select count(*) from centros where tipo = 'projeto' and ativo;
--   -- esperado: 56
