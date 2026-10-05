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
-- "terceiros" no plural fazia o item sumir de qualquer filtro —
-- aparecia na lista completa e desaparecia ao filtrar, que é o pior
-- jeito de um dado estar errado.
--
-- Os 27 itens da planilha de equipamentos.
--
-- Onde a planilha traz só o valor total (sem quantidade), a
-- quantidade entra como 1 e o total vira o valor do item: são
-- lotes comprados em bloco, e inventar uma quantidade faria a
-- depreciação por unidade mentir.
--
-- "Itaboraí" não existe como projeto no cadastro. Os dois itens de
-- lá ficam SEM projeto, com o destino gravado em `local` e
-- `projeto_nome` — melhor um ativo visivelmente sem projeto que um
-- ativo apontando para o projeto errado.

insert into ativos (id, tag, categoria, descricao, qtd, valor, status, condicao,
                    local, projeto, projeto_nome, fornecedor_nome, nf, aquisicao, observacao) values
  ('at001', 'PAT-001', 'Camas e macas', '5 camas leito', 5, 0, 'alocado', 'Novo',
   'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', '', '', null, ''),
  ('at002', 'PAT-002', 'Materiais e equipamentos', 'MAT EQTO', 1, 19500.00, 'alocado', 'Novo',
   'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', '', '', null, ''),
  ('at003', 'PAT-003', 'Materiais e equipamentos', 'MAT EQTO', 1, 60000.00, 'alocado', 'Novo',
   'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', '', '', null, ''),
  ('at004', 'PAT-004', 'Ventilação / Respiradores', '2 respiradores KTK seminovos', 2, 30000.00, 'alocado', 'Seminovo',
   'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', 'KTK', '', null, ''),
  ('at005', 'PAT-005', 'Monitorização', 'Monitores', 1, 100000.00, 'devolucao', 'Novo',
   'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', 'PRIOM', '', null, 'DEVOLUÇÃO MONITORES'),
  ('at006', 'PAT-006', 'Materiais e equipamentos', 'Equipamentos FPMED', 1, 93593.85, 'alocado', 'Novo',
   'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', 'FPMED', '', null, ''),
  ('at007', 'PAT-007', 'Camas e macas', 'Macas', 1, 47343.33, 'alocado', 'Novo',
   'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', '', '', null, ''),
  ('at008', 'PAT-008', 'Endoscopia / Vídeo', 'Torres de vídeo', 1, 26688.00, 'alocado', 'Novo',
   'Hospital Nilópolis', 'pj41', 'Nilópolis - Santa Casa', 'Confiance', '', null, ''),
  ('at009', 'PAT-009', 'Centro cirúrgico', 'Mesa cirúrgica', 1, 55000.00, 'alocado', 'Novo',
   'Hospital SCFORT', 'pj40', 'SCFORT - Mesa Cirúrgica', '', '', null, ''),
  ('at010', 'PAT-010', 'Diálise / Nefrologia', '2 máquinas de osmose reversa', 2, 51059.87, 'alocado', 'Novo',
   'Hospital Moacyr do Carmo', 'pj42', 'Moacyr do Carmo - Diálise', 'Fresenius / Saubern', '52349', null, ''),
  ('at011', 'PAT-011', 'Diálise / Nefrologia', '10 filtros máquinas de diálise', 10, 4478.40, 'alocado', 'Novo',
   'Hospital Moacyr do Carmo', 'pj42', 'Moacyr do Carmo - Diálise', 'Nipro', '158675', null, ''),
  ('at012', 'PAT-012', 'Diálise / Nefrologia', '10 máquinas de diálise', 10, 576000.00, 'alocado', 'Novo',
   'Hospital Moacyr do Carmo', 'pj42', 'Moacyr do Carmo - Diálise', 'Nipro', '158677', null,
   '23J317: 05P 78P 79P 80P 81P 82P 83P 86P 87P 88P'),
  ('at013', 'PAT-013', 'Diálise / Nefrologia', '3 máquinas de diálise', 3, 172800.00, 'alocado', 'Novo',
   'Hospital Itaboraí', null, 'Itaboraí (projeto não cadastrado)', 'Nipro', '158678', null, ''),
  ('at014', 'PAT-014', 'Diálise / Nefrologia', '3 filtros máquinas de diálise', 3, 1343.52, 'alocado', 'Novo',
   'Hospital Itaboraí', null, 'Itaboraí (projeto não cadastrado)', 'Nipro', '158676', null, ''),
  ('at015', 'PAT-015', 'Diálise / Nefrologia', '9 máquinas de diálise', 9, 518400.00, 'terceiro', 'Novo',
   'Depósito de terceiros', null, 'Sem projeto', 'Nipro', '158678', null, ''),
  ('at016', 'PAT-016', 'Diálise / Nefrologia', '9 filtros máquinas de diálise', 9, 4030.56, 'terceiro', 'Novo',
   'Depósito de terceiros', null, 'Sem projeto', 'Nipro', '158676', null, ''),
  ('at017', 'PAT-017', 'Camas e macas', '50 camas', 50, 274000.00, 'terceiro', 'Novo',
   'Depósito de terceiros', null, 'Sem projeto', 'Desematec', '', null, ''),
  ('at018', 'PAT-018', 'Materiais e equipamentos', 'Equipamentos FPMED', 1, 72993.85, 'terceiro', 'Novo',
   'Depósito de terceiros', null, 'Sem projeto', 'FPMED', '', null, ''),
  ('at019', 'PAT-019', 'Endoscopia / Vídeo', 'Endoscópio', 2, 35800.00, 'terceiro', 'Novo',
   'Depósito de terceiros', null, 'Sem projeto', 'Emporio Medical', '401', null, ''),
  ('at020', 'PAT-020', 'Materiais e equipamentos', 'Afastador, caixa, pinça, etc', 1, 91180.08, 'terceiro', 'Novo',
   'Depósito de terceiros', null, 'Sem projeto', 'Emporio Medical', '379', null, ''),
  ('at021', 'PAT-021', 'Camas e macas', 'Camas fowler', 1, 18845.19, 'terceiro', 'Novo',
   'Depósito de terceiros', null, 'Sem projeto', 'Max Soluções', '', null, ''),
  ('at022', 'PAT-022', 'Endoscopia / Vídeo', '4 vídeo processadores', 4, 340000.00, 'aguardando', 'Novo',
   'Aguardando produção', null, 'Sem projeto', 'Endoshopping', 'Contrato', '2026-06-24', ''),
  ('at023', 'PAT-023', 'Centro cirúrgico', '2 mesas de centro cirúrgico', 2, 50000.00, 'terceiro', 'Novo',
   'Depósito de terceiros', null, 'Sem projeto', '', '', null, ''),
  ('at024', 'PAT-024', 'Iluminação (focos)', '1 foco e teto', 1, 30000.00, 'terceiro', 'Novo',
   'Depósito de terceiros', null, 'Sem projeto', '', '', null, ''),
  ('at025', 'PAT-025', 'Iluminação (focos)', '1 foco e teto usado', 1, 12000.00, 'terceiro', 'Usado',
   'Depósito de terceiros', null, 'Sem projeto', '', '', null, ''),
  ('at026', 'PAT-026', 'Iluminação (focos)', '1 foco auxiliar', 1, 12000.00, 'terceiro', 'Novo',
   'Depósito de terceiros', null, 'Sem projeto', '', '', null, ''),
  ('at027', 'PAT-027', 'Diagnóstico por imagem', 'Tomógrafo', 1, 868000.00, 'alocado', 'Novo',
   'Hospital SCFORT', 'pj08', 'SCFORT - Tomografia', 'GE Healthcare', '20444', null, '')
on conflict (id) do update set descricao = excluded.descricao, valor = excluded.valor,
  qtd = excluded.qtd, status = excluded.status, local = excluded.local;

-- Conferência:
--
--   select count(*) as armazens from armazens;          -- 7
--   select count(*) as ativos, sum(valor) from ativos;  -- 27 itens, R$ 3.565.056,65
--   select status, count(*) from ativos group by status order by 1;
--   select descricao, local from ativos where projeto is null and local like '%Itabora%';
