-- ERP Dom Pedro — ATUALIZAR para a v112
-- Roda nos DOIS bancos. É seguro rodar mais de uma vez.
--
-- O campo `centros.produtividade` é, por definição, "o tipo de
-- serviço é médico". Guardado ao lado da origem, ele envelheceu:
-- projeto que entrou por importação, e não pelo formulário, ficou
-- com `false` mesmo sendo de serviços médicos — e a tela de
-- previsões passou a dizer "locação — sem repasse" em todos.
--
-- A tela já não decide por ele (passou a derivar do tipo), mas o
-- campo continua no banco e em relatórios antigos. Isto alinha os
-- dois para não haver duas verdades.

update centros
   set produtividade = (tipo_servico = 'medico')
 where tipo = 'projeto'
   and tipo_servico is not null
   and produtividade is distinct from (tipo_servico = 'medico');

-- ──────────────────────────────────────────────────────────────
-- CONFERÊNCIA
-- ──────────────────────────────────────────────────────────────
select coalesce(tipo_servico, '(sem tipo)')                as tipo_de_servico,
       count(*)                                            as projetos,
       count(*) filter (where produtividade)               as com_repasse,
       count(*) filter (where not produtividade)           as sem_repasse
  from centros
 where tipo = 'projeto'
 group by tipo_servico
 order by 1;

-- ESPERADO: "medico" com TODOS em com_repasse, e "locacao" e
-- "venda" com todos em sem_repasse. Se sobrar projeto em
-- "(sem tipo)", é cadastro antigo sem tipo de serviço — abra o
-- projeto em Cadastros e escolha o tipo.
