/* Liga++++o com o banco.

   A chave `anon` +¾ p++blica por natureza: ela identifica o projeto,
   n++o a pessoa. Quem decide o que cada um l++ +¾ a matriz de acesso
   dentro do Postgres ++« por isso ela pode viver aqui, no c++digo que
   vai para o navegador.

   A outra chave do painel, a `service_role`, NUNCA entra aqui nem
   em lugar nenhum do reposit++rio: ela ignora toda a seguran++a.

   Deixando `url` em branco, o sistema roda no modo local de sempre,
   com o seletor de usu+¼rio e sem guardar nada. ++ assim que a
   bateria de testes continua rodando. */
window.ERP = window.ERP || {};
ERP.config = {
  /* Endere++o da fun++++o que cria acesso. O painel do Supabase ++s
     vezes publica com um nome autom+¼tico (`dynamic-responder` e
     parecidos) e mostra o nome escolhido s++ como r++tulo ++« o ERP
     chama pelo endere++o, ent++o +¾ este valor que precisa bater com
     o que aparece na coluna URL, depois de `/functions/v1/`. */
  /* O painel do Supabase publicou a fun++++o com o nome autom+¼tico
     `dynamic-responder` e mostra "criar-login" s++ como r++tulo ++« o
     sistema chama pelo ENDERE+¼O. Este valor precisa bater com o
     trecho depois de /functions/v1/ na coluna URL do painel.

     ATEN+¼++O ao atualizar o sistema: este arquivo vem no pacote e
     sobrescreve o local. Se o acesso parar de ser criado depois de
     uma atualiza++++o, +¾ esta linha que voltou ao padr++o. */
  funcaoCriarLogin: 'quick-service',

  /* AMBIENTE. 'producao' +¾ o normal; 'teste' pinta o topo de
     laranja e p+-e um selo no t+¬tulo da aba.

     A cor existe para uma coisa s++: impedir que algu+¾m lance no
     lugar errado. Dois sistemas id++nticos em abas vizinhas +¾
     pedido de confus++o ++« e no financeiro a confus++o s++ aparece no
     fechamento, quando j+¼ virou retrabalho de dias.

     O ambiente de teste tem BANCO PR+-PRIO: a `url` acima aponta
     para outro projeto. Mesmo c++digo, dados separados. */
  ambiente: 'teste',

  /* A vers++o publicada vive em js/versao.js, carregado logo depois
     deste arquivo. Ela saiu daqui porque mudava a cada entrega
     enquanto as chaves abaixo mudam por ramo: juntas, as duas
     coisas faziam este arquivo conflitar no git em toda
     publica++++o. */

  url: 'https://kwaxtnooxupqlqxcjevs.supabase.co',
  anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3YXh0bm9veHVwcWxxeGNqZXZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyODg2OTUsImV4cCI6MjEwNjg2NDY5NX0.jlOUnxoSfctwNtzTwKWsrwHtgQciwVIMNVqTdfSJNvA'
};