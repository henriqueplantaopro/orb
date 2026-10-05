-- ERP Dom Pedro — projetos ligados aos seus clientes
-- Etapa 21.
--
-- Todo projeto passa a ter cliente, tipo de serviço (médico ou
-- locação) e previsão estimada de faturamento.
--
-- Os vínculos seguem o contrato, não o nome: as sete frentes do HGB
-- são do mesmo Grupo Hospitalar Conceição, as quatro da Iron
-- Trainers do mesmo contratante, as quatro do HMSA da AGIR. Onde não
-- havia cliente cadastrado, ele nasce com o nome do projeto — sem
-- CNPJ, que o financeiro completa na hora de emitir.

insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl01', 'AGIR — Ass. de Gestão, Inovação e Resultados em Saúde', '05029600000287', 'pj19', 35, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl02', 'Santa Casa de Misericórdia de Barra Mansa', '28683712000171', 'pj23', 40, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl03', 'Grupo Hospitalar Conceição — Hospital Federal de Bonsucesso', '92787118002416', 'pj11', 40, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl04', 'Grupo Hospitalar Conceição S.A.', '92787118000553', 'pj10', 40, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl05', 'Irmandade Beneficente da Santa Casa da Misericórdia de Fortaleza', '07273592000164', 'pj08', 30, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl06', 'Instituto Dr. José Frota — IJF', '07835044000180', 'pj07', 30, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl07', 'Centro de Hematologia e Hemoterapia do Ceará — HEMOCE', '07954571011491', 'pj06', 30, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl08', 'Polícia Militar do Ceará', '01790944003350', 'pj01', 30, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl09', 'IBDSOCIAL', '05843874000124', 'pj22', 30, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl10', 'Instituto Brasileiro de Saúde, Ensino, Pesquisa e Extensão', '07836454000146', 'pj29', 60, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl11', 'Inst. Bras. de Saúde, Ensino, Pesq. e Extensão (filial)', '07836454002009', 'pj29', 60, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl12', 'Iron Trainers do Brasil Ltda', '21298287000158', 'pj12', 20, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl13', 'SPDM/PAIS — Ass. Paulista para o Desenvolvimento da Medicina', '61699567009300', 'pj31', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl14', 'Dr. Consulta Centro Médico Ltda', '14245016000179', 'pj30', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl15', 'Sociedade de Caridade — Santa Casa de Misericórdia Madre Michel', '22351316000160', 'pj16', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl16', 'CIDH', '', 'pj02', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl17', 'CDERM', '', 'pj03', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl18', 'CCAD', '', 'pj04', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl19', 'HSMM', '', 'pj05', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl20', 'HMSM - POA', '', 'pj28', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl21', 'CETHID', '', 'pj33', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl22', 'HMMQ', '', 'pj34', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl23', 'IPADE/UNICRISTUS', '', 'pj36', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl24', 'Fundação Edson Queiroz / UNIFOR', '', 'pj37', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl25', 'Santa Casa de Nilópolis', '', 'pj41', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl26', 'Hospital Moacyr do Carmo', '', 'pj42', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
insert into clientes (id, nome, documento, centro_padrao, prazo_dias, ativo) values ('cl27', 'SAMU Nova Friburgo', '', 'pj43', null, true) on conflict (id) do update set nome = excluded.nome, centro_padrao = excluded.centro_padrao;
update centros set cliente = 'cl08', tipo_servico = 'medico', prev_faturamento = 22868.84 where id = 'pj01';
update centros set cliente = 'cl16', tipo_servico = 'medico', prev_faturamento = 21562.05 where id = 'pj02';
update centros set cliente = 'cl17', tipo_servico = 'medico', prev_faturamento = 4900.47 where id = 'pj03';
update centros set cliente = 'cl18', tipo_servico = 'medico', prev_faturamento = 11761.12 where id = 'pj04';
update centros set cliente = 'cl19', tipo_servico = 'medico', prev_faturamento = 110750.54 where id = 'pj05';
update centros set cliente = 'cl07', tipo_servico = 'medico', prev_faturamento = 29577.04 where id = 'pj06';
update centros set cliente = 'cl06', tipo_servico = 'medico', prev_faturamento = 93519.84 where id = 'pj07';
update centros set cliente = 'cl05', tipo_servico = 'medico', prev_faturamento = 358082.89 where id = 'pj08';
update centros set cliente = 'cl04', tipo_servico = 'medico', prev_faturamento = 323876.8 where id = 'pj09';
update centros set cliente = 'cl04', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj10';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 2043819.83 where id = 'pj11';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj44';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj45';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj46';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj47';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj48';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj49';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj50';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj51';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj52';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj53';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj54';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj55';
update centros set cliente = 'cl03', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj56';
update centros set cliente = 'cl12', tipo_servico = 'medico', prev_faturamento = 58545.58 where id = 'pj12';
update centros set cliente = 'cl12', tipo_servico = 'medico', prev_faturamento = 97.6 where id = 'pj13';
update centros set cliente = 'cl12', tipo_servico = 'medico', prev_faturamento = 4698.56 where id = 'pj14';
update centros set cliente = 'cl12', tipo_servico = 'medico', prev_faturamento = 1272.73 where id = 'pj15';
update centros set cliente = 'cl15', tipo_servico = 'medico', prev_faturamento = 216000.51 where id = 'pj16';
update centros set cliente = 'cl15', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj17';
update centros set cliente = 'cl01', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj18';
update centros set cliente = 'cl01', tipo_servico = 'medico', prev_faturamento = 213427.2 where id = 'pj19';
update centros set cliente = 'cl01', tipo_servico = 'medico', prev_faturamento = 355713.6 where id = 'pj20';
update centros set cliente = 'cl01', tipo_servico = 'medico', prev_faturamento = 327600 where id = 'pj21';
update centros set cliente = 'cl09', tipo_servico = 'medico', prev_faturamento = 387223.52 where id = 'pj22';
update centros set cliente = 'cl02', tipo_servico = 'medico', prev_faturamento = 435765.29 where id = 'pj23';
update centros set cliente = 'cl02', tipo_servico = 'medico', prev_faturamento = 265036.5 where id = 'pj24';
update centros set cliente = 'cl02', tipo_servico = 'medico', prev_faturamento = 177696.23 where id = 'pj25';
update centros set cliente = 'cl02', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj26';
update centros set cliente = 'cl02', tipo_servico = 'medico', prev_faturamento = 84000 where id = 'pj27';
update centros set cliente = 'cl20', tipo_servico = 'medico', prev_faturamento = 94399.2 where id = 'pj28';
update centros set cliente = 'cl10', tipo_servico = 'medico', prev_faturamento = 190800 where id = 'pj29';
update centros set cliente = 'cl14', tipo_servico = 'medico', prev_faturamento = 35122.25 where id = 'pj30';
update centros set cliente = 'cl13', tipo_servico = 'medico', prev_faturamento = 5490 where id = 'pj31';
update centros set cliente = 'cl13', tipo_servico = 'medico', prev_faturamento = 7680 where id = 'pj32';
update centros set cliente = 'cl21', tipo_servico = 'medico', prev_faturamento = 289293.88 where id = 'pj33';
update centros set cliente = 'cl22', tipo_servico = 'medico', prev_faturamento = 720575.78 where id = 'pj34';
update centros set cliente = 'cl22', tipo_servico = 'medico', prev_faturamento = 506248.78 where id = 'pj35';
update centros set cliente = 'cl23', tipo_servico = 'locacao', prev_faturamento = 0 where id = 'pj36';
update centros set cliente = 'cl24', tipo_servico = 'locacao', prev_faturamento = 104700 where id = 'pj37';
update centros set cliente = 'cl05', tipo_servico = 'locacao', prev_faturamento = 14000 where id = 'pj38';
update centros set cliente = 'cl05', tipo_servico = 'locacao', prev_faturamento = 0 where id = 'pj39';
update centros set cliente = 'cl05', tipo_servico = 'locacao', prev_faturamento = 5000 where id = 'pj40';
update centros set cliente = 'cl25', tipo_servico = 'locacao', prev_faturamento = 227343.74 where id = 'pj41';
update centros set cliente = 'cl26', tipo_servico = 'locacao', prev_faturamento = 21600 where id = 'pj42';
update centros set cliente = 'cl27', tipo_servico = 'medico', prev_faturamento = 0 where id = 'pj43';

-- Conferência: nenhum projeto pode ficar sem cliente.
--
--   select id, curto from centros
--    where tipo = 'projeto' and (cliente is null or cliente = '');
--   -- esperado: nenhuma linha
