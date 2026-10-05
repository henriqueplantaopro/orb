-- ERP Dom Pedro — armazéns e ativos
-- Etapa 26. Roda DEPOIS da limpeza (etapa 24).

-- ── ARMAZÉNS ───────────────────────────────────────────────
--
-- Três administrativos, um por endereço da empresa, e o estoque do
-- Bonsucesso com três sublocais.
--
-- Os sublocais apontam para o central pelo campo `pai`: o material
-- entra uma vez no central e se distribui, em vez de cada sala ter
-- entrada própria. A especialidade fica gravada em cada um porque
-- é por ela que o consumo de material é separado por tipo de
-- cirurgia — o centro de custo não faz esse corte.

insert into armazens (id, codigo, nome, centro, tipo, pai, ativo) values
  ('am01', 'ESC-RJ',  'Escritório RJ',           null,   'administrativo', null, true),
  ('am02', 'FIL-CE',  'Filial Fortaleza CE',     null,   'administrativo', null, true),
  ('am03', 'MAT-SP',  'Matriz Barueri SP',       null,   'administrativo', null, true),
  ('am04', 'HGB-CEN', 'Estoque central Bonsucesso', 'pj50', 'almox',       null, true)
on conflict (id) do update set nome = excluded.nome, centro = excluded.centro, ativo = true;

insert into armazens (id, codigo, nome, centro, tipo, pai, ativo) values
  ('am05', 'HGB-CIR', 'Bonsucesso · Cirurgia geral', 'pj50', 'setor', 'am04', true),
  ('am06', 'HGB-OFT', 'Bonsucesso · Oftalmologia',   'pj50', 'setor', 'am04', true),
  ('am07', 'HGB-URO', 'Bonsucesso · Urologia',       'pj50', 'setor', 'am04', true)
on conflict (id) do update set nome = excluded.nome, pai = excluded.pai, ativo = true;

-- A especialidade de cada sublocal, que é o corte do consumo.
update armazens set especialidade = 'CIRURGIA GERAL' where id = 'am05';
update armazens set especialidade = 'OFTALMO'        where id = 'am06';
update armazens set especialidade = 'UROLOGIA'       where id = 'am07';

-- ── ATIVOS ─────────────────────────────────────────────────
--
-- A SITUAÇÃO usa os identificadores que o sistema conhece, não o
-- texto da planilha: `sede`, `terceiro`, `alocado`, `transito`,
-- `manutencao`, `devolucao`, `aguardando`, `baixado`. Gravar
-- "terceiros" no plural fazia o item sumir de qualquer filtro.
--
-- ITENS JÁ DESMEMBRADOS. Nove máquinas de diálise não são um
-- patrimônio: são nove. Cada uma vai para um lugar, tem seu número
-- de série, sua manutenção e sua baixa — uma etiqueta para nove é o
-- mesmo que nenhuma, porque quando uma quebrar ninguém sabe qual é.
--
-- Então cada item individualizável entra como LOTE marcado
-- `desmembrado`, mais uma unidade por peça, com tag própria
-- (PAT-012.01, PAT-012.02…) e o valor rateado. As unidades apontam
-- para o lote em `lote_origem`, então a nota fiscal e o valor
-- original seguem rastreáveis.
--
-- Os FILTROS de diálise ficam como registro único de propósito: são
-- consumíveis que se trocam, não patrimônio. Numerar vinte e dois
-- filtros criaria vinte e dois registros que ninguém vai consultar.
--
-- São 27 lotes e 89 unidades: 116 registros. O lote desmembrado não
-- aparece nas listas — quem aparece são as unidades.

insert into ativos (id, tag, categoria, descricao, qtd, valor, status, condicao,
                    local, projeto, projeto_nome, fornecedor_nome, nf, aquisicao,
                    observacao, desmembrado, lote_origem) values
  ('at001', 'PAT-001', 'Camas e macas', 'Camas leito (lote de 5)', 5, 0.00, 'alocado', 'Novo', 'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', '', '', null, '', true, null),
  ('at001-01', 'PAT-001.01', 'Camas e macas', 'Camas leito (1 de 5)', 1, 0.00, 'alocado', 'Novo', 'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', '', '', null, '', false, 'at001'),
  ('at001-02', 'PAT-001.02', 'Camas e macas', 'Camas leito (2 de 5)', 1, 0.00, 'alocado', 'Novo', 'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', '', '', null, '', false, 'at001'),
  ('at001-03', 'PAT-001.03', 'Camas e macas', 'Camas leito (3 de 5)', 1, 0.00, 'alocado', 'Novo', 'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', '', '', null, '', false, 'at001'),
  ('at001-04', 'PAT-001.04', 'Camas e macas', 'Camas leito (4 de 5)', 1, 0.00, 'alocado', 'Novo', 'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', '', '', null, '', false, 'at001'),
  ('at001-05', 'PAT-001.05', 'Camas e macas', 'Camas leito (5 de 5)', 1, 0.00, 'alocado', 'Novo', 'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', '', '', null, '', false, 'at001'),
  ('at002', 'PAT-002', 'Materiais e equipamentos', 'MAT EQTO', 1, 19500.00, 'alocado', 'Novo', 'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', '', '', null, '', false, null),
  ('at003', 'PAT-003', 'Materiais e equipamentos', 'MAT EQTO', 1, 60000.00, 'alocado', 'Novo', 'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', '', '', null, '', false, null),
  ('at004', 'PAT-004', 'Ventilação / Respiradores', 'Respirador KTK seminovo (lote de 2)', 2, 30000.00, 'alocado', 'Seminovo', 'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', 'KTK', '', null, '', true, null),
  ('at004-01', 'PAT-004.01', 'Ventilação / Respiradores', 'Respirador KTK seminovo (1 de 2)', 1, 15000.00, 'alocado', 'Seminovo', 'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', 'KTK', '', null, '', false, 'at004'),
  ('at004-02', 'PAT-004.02', 'Ventilação / Respiradores', 'Respirador KTK seminovo (2 de 2)', 1, 15000.00, 'alocado', 'Seminovo', 'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', 'KTK', '', null, '', false, 'at004'),
  ('at005', 'PAT-005', 'Monitorização', 'Monitores', 1, 100000.00, 'devolucao', 'Novo', 'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', 'PRIOM', '', null, 'DEVOLUÇÃO MONITORES', false, null),
  ('at006', 'PAT-006', 'Materiais e equipamentos', 'Equipamentos FPMED', 1, 93593.85, 'alocado', 'Novo', 'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', 'FPMED', '', null, '', false, null),
  ('at007', 'PAT-007', 'Camas e macas', 'Macas', 1, 47343.33, 'alocado', 'Novo', 'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', '', '', null, '', false, null),
  ('at008', 'PAT-008', 'Endoscopia / Vídeo', 'Torres de vídeo', 1, 26688.00, 'alocado', 'Novo', 'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', 'Confiance', '', null, '', false, null),
  ('at009', 'PAT-009', 'Centro cirúrgico', 'Mesa cirúrgica', 1, 55000.00, 'alocado', 'Novo', 'Hospital SCFORT', 'pj40', 'SCFORT - Mesa Cirúrgica', '', '', null, '', false, null),
  ('at010', 'PAT-010', 'Diálise / Nefrologia', 'Máquina de osmose reversa (lote de 2)', 2, 51059.87, 'alocado', 'Novo', 'Hospital Moacyr do Carmo', 'pj42', 'Moacyr do Carmo - Diálise', 'Fresenius / Saubern', '52349', null, '', true, null),
  ('at010-01', 'PAT-010.01', 'Diálise / Nefrologia', 'Máquina de osmose reversa (1 de 2)', 1, 25529.94, 'alocado', 'Novo', 'Hospital Moacyr do Carmo', 'pj42', 'Moacyr do Carmo - Diálise', 'Fresenius / Saubern', '52349', null, '', false, 'at010'),
  ('at010-02', 'PAT-010.02', 'Diálise / Nefrologia', 'Máquina de osmose reversa (2 de 2)', 1, 25529.94, 'alocado', 'Novo', 'Hospital Moacyr do Carmo', 'pj42', 'Moacyr do Carmo - Diálise', 'Fresenius / Saubern', '52349', null, '', false, 'at010'),
  ('at011', 'PAT-011', 'Diálise / Nefrologia', 'Filtros de máquina de diálise', 10, 4478.40, 'alocado', 'Novo', 'Hospital Moacyr do Carmo', 'pj42', 'Moacyr do Carmo - Diálise', 'Nipro', '158675', null, 'consumível — não individualizado', false, null),
  ('at012', 'PAT-012', 'Diálise / Nefrologia', 'Máquina de diálise (lote de 10)', 10, 576000.00, 'alocado', 'Novo', 'Hospital Moacyr do Carmo', 'pj42', 'Moacyr do Carmo - Diálise', 'Nipro', '158677', null, '23J317: 05P 78P 79P 80P 81P 82P 83P 86P 87P 88P', true, null),
  ('at012-01', 'PAT-012.01', 'Diálise / Nefrologia', 'Máquina de diálise (1 de 10)', 1, 57600.00, 'alocado', 'Novo', 'Hospital Moacyr do Carmo', 'pj42', 'Moacyr do Carmo - Diálise', 'Nipro', '158677', null, '23J317: 05P 78P 79P 80P 81P 82P 83P 86P 87P 88P', false, 'at012'),
  ('at012-02', 'PAT-012.02', 'Diálise / Nefrologia', 'Máquina de diálise (2 de 10)', 1, 57600.00, 'alocado', 'Novo', 'Hospital Moacyr do Carmo', 'pj42', 'Moacyr do Carmo - Diálise', 'Nipro', '158677', null, '23J317: 05P 78P 79P 80P 81P 82P 83P 86P 87P 88P', false, 'at012'),
  ('at012-03', 'PAT-012.03', 'Diálise / Nefrologia', 'Máquina de diálise (3 de 10)', 1, 57600.00, 'alocado', 'Novo', 'Hospital Moacyr do Carmo', 'pj42', 'Moacyr do Carmo - Diálise', 'Nipro', '158677', null, '23J317: 05P 78P 79P 80P 81P 82P 83P 86P 87P 88P', false, 'at012'),
  ('at012-04', 'PAT-012.04', 'Diálise / Nefrologia', 'Máquina de diálise (4 de 10)', 1, 57600.00, 'alocado', 'Novo', 'Hospital Moacyr do Carmo', 'pj42', 'Moacyr do Carmo - Diálise', 'Nipro', '158677', null, '23J317: 05P 78P 79P 80P 81P 82P 83P 86P 87P 88P', false, 'at012'),
  ('at012-05', 'PAT-012.05', 'Diálise / Nefrologia', 'Máquina de diálise (5 de 10)', 1, 57600.00, 'alocado', 'Novo', 'Hospital Moacyr do Carmo', 'pj42', 'Moacyr do Carmo - Diálise', 'Nipro', '158677', null, '23J317: 05P 78P 79P 80P 81P 82P 83P 86P 87P 88P', false, 'at012'),
  ('at012-06', 'PAT-012.06', 'Diálise / Nefrologia', 'Máquina de diálise (6 de 10)', 1, 57600.00, 'alocado', 'Novo', 'Hospital Moacyr do Carmo', 'pj42', 'Moacyr do Carmo - Diálise', 'Nipro', '158677', null, '23J317: 05P 78P 79P 80P 81P 82P 83P 86P 87P 88P', false, 'at012'),
  ('at012-07', 'PAT-012.07', 'Diálise / Nefrologia', 'Máquina de diálise (7 de 10)', 1, 57600.00, 'alocado', 'Novo', 'Hospital Moacyr do Carmo', 'pj42', 'Moacyr do Carmo - Diálise', 'Nipro', '158677', null, '23J317: 05P 78P 79P 80P 81P 82P 83P 86P 87P 88P', false, 'at012'),
  ('at012-08', 'PAT-012.08', 'Diálise / Nefrologia', 'Máquina de diálise (8 de 10)', 1, 57600.00, 'alocado', 'Novo', 'Hospital Moacyr do Carmo', 'pj42', 'Moacyr do Carmo - Diálise', 'Nipro', '158677', null, '23J317: 05P 78P 79P 80P 81P 82P 83P 86P 87P 88P', false, 'at012'),
  ('at012-09', 'PAT-012.09', 'Diálise / Nefrologia', 'Máquina de diálise (9 de 10)', 1, 57600.00, 'alocado', 'Novo', 'Hospital Moacyr do Carmo', 'pj42', 'Moacyr do Carmo - Diálise', 'Nipro', '158677', null, '23J317: 05P 78P 79P 80P 81P 82P 83P 86P 87P 88P', false, 'at012'),
  ('at012-10', 'PAT-012.10', 'Diálise / Nefrologia', 'Máquina de diálise (10 de 10)', 1, 57600.00, 'alocado', 'Novo', 'Hospital Moacyr do Carmo', 'pj42', 'Moacyr do Carmo - Diálise', 'Nipro', '158677', null, '23J317: 05P 78P 79P 80P 81P 82P 83P 86P 87P 88P', false, 'at012'),
  ('at013', 'PAT-013', 'Diálise / Nefrologia', 'Máquina de diálise (lote de 3)', 3, 172800.00, 'alocado', 'Novo', 'Hospital Itaboraí', null, 'Itaboraí (projeto não cadastrado)', 'Nipro', '158678', null, '', true, null),
  ('at013-01', 'PAT-013.01', 'Diálise / Nefrologia', 'Máquina de diálise (1 de 3)', 1, 57600.00, 'alocado', 'Novo', 'Hospital Itaboraí', null, 'Itaboraí (projeto não cadastrado)', 'Nipro', '158678', null, '', false, 'at013'),
  ('at013-02', 'PAT-013.02', 'Diálise / Nefrologia', 'Máquina de diálise (2 de 3)', 1, 57600.00, 'alocado', 'Novo', 'Hospital Itaboraí', null, 'Itaboraí (projeto não cadastrado)', 'Nipro', '158678', null, '', false, 'at013'),
  ('at013-03', 'PAT-013.03', 'Diálise / Nefrologia', 'Máquina de diálise (3 de 3)', 1, 57600.00, 'alocado', 'Novo', 'Hospital Itaboraí', null, 'Itaboraí (projeto não cadastrado)', 'Nipro', '158678', null, '', false, 'at013'),
  ('at014', 'PAT-014', 'Diálise / Nefrologia', 'Filtros de máquina de diálise', 3, 1343.52, 'alocado', 'Novo', 'Hospital Itaboraí', null, 'Itaboraí (projeto não cadastrado)', 'Nipro', '158676', null, 'consumível — não individualizado', false, null),
  ('at015', 'PAT-015', 'Diálise / Nefrologia', 'Máquina de diálise (lote de 9)', 9, 518400.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Nipro', '158678', null, '', true, null),
  ('at015-01', 'PAT-015.01', 'Diálise / Nefrologia', 'Máquina de diálise (1 de 9)', 1, 57600.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Nipro', '158678', null, '', false, 'at015'),
  ('at015-02', 'PAT-015.02', 'Diálise / Nefrologia', 'Máquina de diálise (2 de 9)', 1, 57600.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Nipro', '158678', null, '', false, 'at015'),
  ('at015-03', 'PAT-015.03', 'Diálise / Nefrologia', 'Máquina de diálise (3 de 9)', 1, 57600.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Nipro', '158678', null, '', false, 'at015'),
  ('at015-04', 'PAT-015.04', 'Diálise / Nefrologia', 'Máquina de diálise (4 de 9)', 1, 57600.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Nipro', '158678', null, '', false, 'at015'),
  ('at015-05', 'PAT-015.05', 'Diálise / Nefrologia', 'Máquina de diálise (5 de 9)', 1, 57600.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Nipro', '158678', null, '', false, 'at015'),
  ('at015-06', 'PAT-015.06', 'Diálise / Nefrologia', 'Máquina de diálise (6 de 9)', 1, 57600.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Nipro', '158678', null, '', false, 'at015'),
  ('at015-07', 'PAT-015.07', 'Diálise / Nefrologia', 'Máquina de diálise (7 de 9)', 1, 57600.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Nipro', '158678', null, '', false, 'at015'),
  ('at015-08', 'PAT-015.08', 'Diálise / Nefrologia', 'Máquina de diálise (8 de 9)', 1, 57600.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Nipro', '158678', null, '', false, 'at015'),
  ('at015-09', 'PAT-015.09', 'Diálise / Nefrologia', 'Máquina de diálise (9 de 9)', 1, 57600.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Nipro', '158678', null, '', false, 'at015'),
  ('at016', 'PAT-016', 'Diálise / Nefrologia', 'Filtros de máquina de diálise', 9, 4030.56, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Nipro', '158676', null, 'consumível — não individualizado', false, null),
  ('at017', 'PAT-017', 'Camas e macas', 'Cama (lote de 50)', 50, 274000.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', true, null),
  ('at017-01', 'PAT-017.01', 'Camas e macas', 'Cama (1 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-02', 'PAT-017.02', 'Camas e macas', 'Cama (2 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-03', 'PAT-017.03', 'Camas e macas', 'Cama (3 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-04', 'PAT-017.04', 'Camas e macas', 'Cama (4 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-05', 'PAT-017.05', 'Camas e macas', 'Cama (5 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-06', 'PAT-017.06', 'Camas e macas', 'Cama (6 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-07', 'PAT-017.07', 'Camas e macas', 'Cama (7 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-08', 'PAT-017.08', 'Camas e macas', 'Cama (8 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-09', 'PAT-017.09', 'Camas e macas', 'Cama (9 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-10', 'PAT-017.10', 'Camas e macas', 'Cama (10 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-11', 'PAT-017.11', 'Camas e macas', 'Cama (11 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-12', 'PAT-017.12', 'Camas e macas', 'Cama (12 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-13', 'PAT-017.13', 'Camas e macas', 'Cama (13 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-14', 'PAT-017.14', 'Camas e macas', 'Cama (14 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-15', 'PAT-017.15', 'Camas e macas', 'Cama (15 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-16', 'PAT-017.16', 'Camas e macas', 'Cama (16 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-17', 'PAT-017.17', 'Camas e macas', 'Cama (17 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-18', 'PAT-017.18', 'Camas e macas', 'Cama (18 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-19', 'PAT-017.19', 'Camas e macas', 'Cama (19 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-20', 'PAT-017.20', 'Camas e macas', 'Cama (20 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-21', 'PAT-017.21', 'Camas e macas', 'Cama (21 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-22', 'PAT-017.22', 'Camas e macas', 'Cama (22 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-23', 'PAT-017.23', 'Camas e macas', 'Cama (23 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-24', 'PAT-017.24', 'Camas e macas', 'Cama (24 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-25', 'PAT-017.25', 'Camas e macas', 'Cama (25 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-26', 'PAT-017.26', 'Camas e macas', 'Cama (26 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-27', 'PAT-017.27', 'Camas e macas', 'Cama (27 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-28', 'PAT-017.28', 'Camas e macas', 'Cama (28 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-29', 'PAT-017.29', 'Camas e macas', 'Cama (29 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-30', 'PAT-017.30', 'Camas e macas', 'Cama (30 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-31', 'PAT-017.31', 'Camas e macas', 'Cama (31 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-32', 'PAT-017.32', 'Camas e macas', 'Cama (32 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-33', 'PAT-017.33', 'Camas e macas', 'Cama (33 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-34', 'PAT-017.34', 'Camas e macas', 'Cama (34 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-35', 'PAT-017.35', 'Camas e macas', 'Cama (35 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-36', 'PAT-017.36', 'Camas e macas', 'Cama (36 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-37', 'PAT-017.37', 'Camas e macas', 'Cama (37 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-38', 'PAT-017.38', 'Camas e macas', 'Cama (38 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-39', 'PAT-017.39', 'Camas e macas', 'Cama (39 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-40', 'PAT-017.40', 'Camas e macas', 'Cama (40 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-41', 'PAT-017.41', 'Camas e macas', 'Cama (41 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-42', 'PAT-017.42', 'Camas e macas', 'Cama (42 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-43', 'PAT-017.43', 'Camas e macas', 'Cama (43 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-44', 'PAT-017.44', 'Camas e macas', 'Cama (44 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-45', 'PAT-017.45', 'Camas e macas', 'Cama (45 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-46', 'PAT-017.46', 'Camas e macas', 'Cama (46 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-47', 'PAT-017.47', 'Camas e macas', 'Cama (47 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-48', 'PAT-017.48', 'Camas e macas', 'Cama (48 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-49', 'PAT-017.49', 'Camas e macas', 'Cama (49 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at017-50', 'PAT-017.50', 'Camas e macas', 'Cama (50 de 50)', 1, 5480.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, '', false, 'at017'),
  ('at018', 'PAT-018', 'Materiais e equipamentos', 'Equipamentos FPMED', 1, 72993.85, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'FPMED', '', null, '', false, null),
  ('at019', 'PAT-019', 'Endoscopia / Vídeo', 'Endoscópio (lote de 2)', 2, 35800.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Emporio Medical', '401', null, '', true, null),
  ('at019-01', 'PAT-019.01', 'Endoscopia / Vídeo', 'Endoscópio (1 de 2)', 1, 17900.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Emporio Medical', '401', null, '', false, 'at019'),
  ('at019-02', 'PAT-019.02', 'Endoscopia / Vídeo', 'Endoscópio (2 de 2)', 1, 17900.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Emporio Medical', '401', null, '', false, 'at019'),
  ('at020', 'PAT-020', 'Materiais e equipamentos', 'Afastador, caixa, pinça, etc', 1, 91180.08, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Emporio Medical', '379', null, '', false, null),
  ('at021', 'PAT-021', 'Camas e macas', 'Camas fowler', 1, 18845.19, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', 'Max Soluções', '', null, '', false, null),
  ('at022', 'PAT-022', 'Endoscopia / Vídeo', 'Vídeo processador (lote de 4)', 4, 340000.00, 'aguardando', 'Novo', 'Aguardando produção', null, 'Sem projeto', 'Endoshopping', 'Contrato', '2026-06-24', '', true, null),
  ('at022-01', 'PAT-022.01', 'Endoscopia / Vídeo', 'Vídeo processador (1 de 4)', 1, 85000.00, 'aguardando', 'Novo', 'Aguardando produção', null, 'Sem projeto', 'Endoshopping', 'Contrato', '2026-06-24', '', false, 'at022'),
  ('at022-02', 'PAT-022.02', 'Endoscopia / Vídeo', 'Vídeo processador (2 de 4)', 1, 85000.00, 'aguardando', 'Novo', 'Aguardando produção', null, 'Sem projeto', 'Endoshopping', 'Contrato', '2026-06-24', '', false, 'at022'),
  ('at022-03', 'PAT-022.03', 'Endoscopia / Vídeo', 'Vídeo processador (3 de 4)', 1, 85000.00, 'aguardando', 'Novo', 'Aguardando produção', null, 'Sem projeto', 'Endoshopping', 'Contrato', '2026-06-24', '', false, 'at022'),
  ('at022-04', 'PAT-022.04', 'Endoscopia / Vídeo', 'Vídeo processador (4 de 4)', 1, 85000.00, 'aguardando', 'Novo', 'Aguardando produção', null, 'Sem projeto', 'Endoshopping', 'Contrato', '2026-06-24', '', false, 'at022'),
  ('at023', 'PAT-023', 'Centro cirúrgico', 'Mesa de centro cirúrgico (lote de 2)', 2, 50000.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', '', '', null, '', true, null),
  ('at023-01', 'PAT-023.01', 'Centro cirúrgico', 'Mesa de centro cirúrgico (1 de 2)', 1, 25000.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', '', '', null, '', false, 'at023'),
  ('at023-02', 'PAT-023.02', 'Centro cirúrgico', 'Mesa de centro cirúrgico (2 de 2)', 1, 25000.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', '', '', null, '', false, 'at023'),
  ('at024', 'PAT-024', 'Iluminação (focos)', 'Foco e teto', 1, 30000.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', '', '', null, '', false, null),
  ('at025', 'PAT-025', 'Iluminação (focos)', 'Foco e teto usado', 1, 12000.00, 'terceiro', 'Usado', 'Depósito de terceiros', null, 'Sem projeto', '', '', null, '', false, null),
  ('at026', 'PAT-026', 'Iluminação (focos)', 'Foco auxiliar', 1, 12000.00, 'terceiro', 'Novo', 'Depósito de terceiros', null, 'Sem projeto', '', '', null, '', false, null),
  ('at027', 'PAT-027', 'Diagnóstico por imagem', 'Tomógrafo', 1, 868000.00, 'alocado', 'Novo', 'Hospital SCFORT', 'pj08', 'SCFORT - Tomografia', 'GE Healthcare', '20444', null, '', false, null)
on conflict (id) do update set descricao = excluded.descricao, valor = excluded.valor,
  qtd = excluded.qtd, status = excluded.status, local = excluded.local;

-- Conferência:
--
--   select count(*) as armazens from armazens;                    -- 7
--   select count(*) from ativos where lote_origem is null;        -- 27 lotes
--   select count(*) from ativos where lote_origem is not null;    -- 89 unidades
--   select sum(valor) from ativos where lote_origem is null;      -- R$ 3.565.056,65
--   select status, count(*) from ativos group by status order by 1;
--
--   -- as unidades de um lote, com as tags individuais:
--   select tag, descricao, valor from ativos where lote_origem = 'at012' order by tag;
