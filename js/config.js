/* Ligação com o banco.

   A chave `anon` é pública por natureza: ela identifica o projeto,
   não a pessoa. Quem decide o que cada um lê é a matriz de acesso
   dentro do Postgres — por isso ela pode viver aqui, no código que
   vai para o navegador.

   A outra chave do painel, a `service_role`, NUNCA entra aqui nem
   em lugar nenhum do repositório: ela ignora toda a segurança.

   Deixando `url` em branco, o sistema roda no modo local de sempre,
   com o seletor de usuário e sem guardar nada. É assim que a
   bateria de testes continua rodando. */
window.ERP = window.ERP || {};
ERP.config = {
  /* Endereço da função que cria acesso. O painel do Supabase às
     vezes publica com um nome automático (`dynamic-responder` e
     parecidos) e mostra o nome escolhido só como rótulo — o ERP
     chama pelo endereço, então é este valor que precisa bater com
     o que aparece na coluna URL, depois de `/functions/v1/`. */
  /* O painel do Supabase publicou a função com o nome automático
     `dynamic-responder` e mostra "criar-login" só como rótulo — o
     sistema chama pelo ENDEREÇO. Este valor precisa bater com o
     trecho depois de /functions/v1/ na coluna URL do painel.

     ATENÇÃO ao atualizar o sistema: este arquivo vem no pacote e
     sobrescreve o local. Se o acesso parar de ser criado depois de
     uma atualização, é esta linha que voltou ao padrão. */
  funcaoCriarLogin: 'dynamic-responder',

  /* AMBIENTE. 'producao' é o normal; 'teste' pinta o topo de
     laranja e põe um selo no título da aba.

     A cor existe para uma coisa só: impedir que alguém lance no
     lugar errado. Dois sistemas idênticos em abas vizinhas é
     pedido de confusão — e no financeiro a confusão só aparece no
     fechamento, quando já virou retrabalho de dias.

     O ambiente de teste tem BANCO PRÓPRIO: a `url` acima aponta
     para outro projeto. Mesmo código, dados separados. */
  ambiente: 'teste',

  /* A versão publicada vive em js/versao.js, carregado logo depois
     deste arquivo. Ela saiu daqui porque mudava a cada entrega
     enquanto as chaves abaixo mudam por ramo: juntas, as duas
     coisas faziam este arquivo conflitar no git em toda
     publicação. */

  url: 'https://kwaxtnooxupqlqxcjevs.supabase.co',
  anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3YXh0bm9veHVwcWxxeGNqZXZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyODg2OTUsImV4cCI6MjEwNjg2NDY5NX0.jlOUnxoSfctwNtzTwKWsrwHtgQciwVIMNVqTdfSJNvA'
};
