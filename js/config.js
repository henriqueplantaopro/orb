/* Liga+º+úo com o banco.

   A chave `anon` +® p+¦blica por natureza: ela identifica o projeto,
   n+úo a pessoa. Quem decide o que cada um l+¬ +® a matriz de acesso
   dentro do Postgres ÔÇö por isso ela pode viver aqui, no c+¦digo que
   vai para o navegador.

   A outra chave do painel, a `service_role`, NUNCA entra aqui nem
   em lugar nenhum do reposit+¦rio: ela ignora toda a seguran+ºa.

   Deixando `url` em branco, o sistema roda no modo local de sempre,
   com o seletor de usu+írio e sem guardar nada. +ë assim que a
   bateria de testes continua rodando. */
window.ERP = window.ERP || {};
ERP.config = {
  /* Endere+ºo da fun+º+úo que cria acesso. O painel do Supabase +ás
     vezes publica com um nome autom+ítico (`dynamic-responder` e
     parecidos) e mostra o nome escolhido s+¦ como r+¦tulo ÔÇö o ERP
     chama pelo endere+ºo, ent+úo +® este valor que precisa bater com
     o que aparece na coluna URL, depois de `/functions/v1/`. */
  /* O painel do Supabase publicou a fun+º+úo com o nome autom+ítico
     `dynamic-responder` e mostra "criar-login" s+¦ como r+¦tulo ÔÇö o
     sistema chama pelo ENDERE+çO. Este valor precisa bater com o
     trecho depois de /functions/v1/ na coluna URL do painel.

     ATEN+ç+âO ao atualizar o sistema: este arquivo vem no pacote e
     sobrescreve o local. Se o acesso parar de ser criado depois de
     uma atualiza+º+úo, +® esta linha que voltou ao padr+úo. */
  funcaoCriarLogin: 'quick-service',

  /* AMBIENTE. 'producao' +® o normal; 'teste' pinta o topo de
     laranja e p+Áe um selo no t+¡tulo da aba.

     A cor existe para uma coisa s+¦: impedir que algu+®m lance no
     lugar errado. Dois sistemas id+¬nticos em abas vizinhas +®
     pedido de confus+úo ÔÇö e no financeiro a confus+úo s+¦ aparece no
     fechamento, quando j+í virou retrabalho de dias.

     O ambiente de teste tem BANCO PR+ôPRIO: a `url` acima aponta
     para outro projeto. Mesmo c+¦digo, dados separados. */
  ambiente: 'teste',

  /* A vers+úo publicada vive em js/versao.js, carregado logo depois
     deste arquivo. Ela saiu daqui porque mudava a cada entrega
     enquanto as chaves abaixo mudam por ramo: juntas, as duas
     coisas faziam este arquivo conflitar no git em toda
     publica+º+úo. */

  url: 'https://kwaxtnooxupqlqxcjevs.supabase.co',
  anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3YXh0bm9veHVwcWxxeGNqZXZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyODg2OTUsImV4cCI6MjEwNjg2NDY5NX0.jlOUnxoSfctwNtzTwKWsrwHtgQciwVIMNVqTdfSJNvA'
};