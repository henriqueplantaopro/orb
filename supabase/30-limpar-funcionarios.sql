-- ERP Dom Pedro — limpar o cadastro de funcionários
-- Etapa 30. Roda uma vez, antes de cadastrar a equipe de verdade.
--
-- A carga do Protheus trouxe oito pessoas com admissão de hoje e
-- salário zero, porque a planilha não tinha esses campos. Corrigir
-- pela tela não resolve: salário só muda por REAJUSTE, que é um
-- evento com data e histórico — e inventar um reajuste de zero para
-- o valor real criaria um aumento que nunca houve na ficha da
-- pessoa.
--
-- Cadastrar do zero é mais limpo: a admissão entra com a data certa
-- e o salário nasce correto, sem reajuste fantasma no histórico.
--
-- ATENÇÃO: isto APAGA. Rode só enquanto o módulo de Pessoal ainda
-- não foi usado para valer.

begin;

-- Décimos e folhas apontam para funcionário: saem primeiro, senão
-- o banco recusa a exclusão.
delete from decimos;
delete from folhas;
delete from funcionarios;

-- Os mesmos oito também entraram como CREDOR, que é de onde o
-- pagamento sai. Saem junto: recadastrar pelo módulo de Pessoal
-- recria o que for preciso, e deixar o credor órfão faria aparecer
-- gente na lista de pagamento que não está na folha.
delete from credores where tipo = 'funcionario';

commit;

-- Conferência:
--
--   select count(*) as funcionarios from funcionarios;              -- 0
--   select count(*) as credor_funcionario from credores
--    where tipo = 'funcionario';                                     -- 0
--   select count(*) as fornecedores from credores
--    where tipo = 'fornecedor';                                      -- 276, intactos
