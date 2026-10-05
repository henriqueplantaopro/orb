-- ERP Dom Pedro — travas de domínio
-- Etapa 27.
--
-- A carga de ativos gravou "terceiros" (plural) numa coluna que o
-- sistema lê como "terceiro". O item aparecia na lista completa e
-- sumia de qualquer filtro — o pior jeito de um dado estar errado,
-- porque não parece erro: parece que o filtro não funciona.
--
-- Estas travas fazem o banco recusar valor fora da lista. Carga
-- futura com um identificador inventado para na hora, em vez de
-- entrar e só aparecer meses depois, quando alguém estranhar um
-- total que não fecha.

-- ANTES DE TRAVAR, NORMALIZA O QUE JÁ ESTÁ GRAVADO.
--
-- A primeira versão desta etapa travava direto e falhava: havia
-- linhas com situação fora da lista, e o banco recusava criar a
-- regra. Uma trava que não consegue ser criada não protege nada —
-- e ainda interrompe a atualização inteira.
--
-- Aqui os valores conhecidos são convertidos para o identificador
-- certo, e o que não se encaixa em nada vira `sede`, que é o
-- estado mais neutro: o item existe e está na empresa.

update ativos set status = 'terceiro'   where status in ('terceiros', 'terceiro(s)', 'em_terceiros');
update ativos set status = 'aguardando' where status in ('producao', 'produção', 'aguardando_producao');
update ativos set status = 'alocado'    where status in ('alocada', 'em_projeto', 'projeto');
update ativos set status = 'devolucao'  where status in ('devolução', 'em_devolucao');
update ativos set status = 'manutencao' where status in ('manutenção', 'em_manutencao');
update ativos set status = 'transito'   where status in ('trânsito', 'em_transito');
update ativos set status = 'sede'       where status in ('estoque', 'em_estoque', 'estoque_sede');
update ativos set status = 'sede'
 where status is not null and status not in
   ('sede', 'terceiro', 'alocado', 'transito', 'manutencao',
    'devolucao', 'aguardando', 'baixado');

update centros set tipo_servico = null
 where tipo_servico is not null and tipo_servico not in ('medico', 'locacao', 'misto');

update credores set tipo = 'outro'
 where tipo is not null and tipo not in
   ('fornecedor', 'medico', 'funcionario', 'orgao', 'socio', 'outro');

alter table ativos drop constraint if exists ativos_status_valido;
alter table ativos add constraint ativos_status_valido
  check (status is null or status in
    ('sede', 'terceiro', 'alocado', 'transito', 'manutencao',
     'devolucao', 'aguardando', 'baixado'));

alter table centros drop constraint if exists centros_tipo_servico_valido;
alter table centros add constraint centros_tipo_servico_valido
  check (tipo_servico is null or tipo_servico in ('medico', 'locacao', 'misto'));

-- Credores usam SEIS tipos, não três: além de fornecedor, médico e
-- funcionário, o cadastro distingue órgão, sócio e outro. Travar na
-- lista curta recusaria cadastro legítimo.
alter table credores drop constraint if exists credores_tipo_valido;
alter table credores add constraint credores_tipo_valido
  check (tipo is null or tipo in
    ('fornecedor', 'medico', 'funcionario', 'orgao', 'socio', 'outro'));

-- PREVISÕES ficam SEM trava, de propósito. O status ali passa por
-- mais estados do que parece à primeira vista, e alguns só aparecem
-- em caminhos pouco percorridos. Uma trava incompleta recusaria uma
-- gravação legítima no meio do fechamento — dano maior que o erro
-- que ela evitaria. Fica para quando a lista estiver levantada com
-- certeza.

-- Conferência: se alguma trava falhar ao ser criada, é porque já
-- existe dado fora da lista. Para encontrar:
--
--   select distinct status from ativos;
--   select distinct tipo_servico from centros;
--   select distinct tipo from credores;
--   select distinct status from previsoes;
