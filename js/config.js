/* Liga+ª+Ào com o banco.

   A chave `anon` +½ p+¬blica por natureza: ela identifica o projeto,
   n+Ào a pessoa. Quem decide o que cada um l++ +½ a matriz de acesso
   dentro do Postgres ++¸ por isso ela pode viver aqui, no c+¬digo que
   vai para o navegador.

   A outra chave do painel, a `service_role`, NUNCA entra aqui nem
   em lugar nenhum do reposit+¬rio: ela ignora toda a seguran+ªa.

   Deixando `url` em branco, o sistema roda no modo local de sempre,
   com o seletor de usu+¦rio e sem guardar nada. ++ assim que a
   bateria de testes continua rodando. */
window.ERP = window.ERP || {};
ERP.config = {
  /* Endere+ªo da fun+ª+Ào que cria acesso. O painel do Supabase +¯s
     vezes publica com um nome autom+¦tico (`dynamic-responder` e
     parecidos) e mostra o nome escolhido s+¬ como r+¬tulo ++¸ o ERP
     chama pelo endere+ªo, ent+Ào +½ este valor que precisa bater com
     o que aparece na coluna URL, depois de `/functions/v1/`. */
  /* O painel do Supabase publicou a fun+ª+Ào com o nome autom+¦tico
     `dynamic-responder` e mostra "criar-login" s+¬ como r+¬tulo ++¸ o
     sistema chama pelo ENDERE+¦O. Este valor precisa bater com o
     trecho depois de /functions/v1/ na coluna URL do painel.

     ATEN+¦+ÈO ao atualizar o sistema: este arquivo vem no pacote e
     sobrescreve o local. Se o acesso parar de ser criado depois de
     uma atualiza+ª+Ào, +½ esta linha que voltou ao padr+Ào. */
  funcaoCriarLogin: 'dynamic-responder',

  /* AMBIENTE. 'producao' +½ o normal; 'teste' pinta o topo de
     laranja e p+-e um selo no t+Ýtulo da aba.

     A cor existe para uma coisa s+¬: impedir que algu+½m lance no
     lugar errado. Dois sistemas id++nticos em abas vizinhas +½
     pedido de confus+Ào ++¸ e no financeiro a confus+Ào s+¬ aparece no
     fechamento, quando j+¦ virou retrabalho de dias.

     O ambiente de teste tem BANCO PR+ÂPRIO: a `url` acima aponta
     para outro projeto. Mesmo c+¬digo, dados separados. */
  ambiente: 'producao',

  /* A vers+Ào publicada vive em js/versao.js, carregado logo depois
     deste arquivo. Ela saiu daqui porque mudava a cada entrega
     enquanto as chaves abaixo mudam por ramo: juntas, as duas
     coisas faziam este arquivo conflitar no git em toda
     publica+ª+Ào. */

  url: 'https://jsdyowuqehryfwqyklax.supabase.co',
  anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzZHlvd3VxZWhyeWZ3cXlrbGF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5NDM4ODIsImV4cCI6MjEwNjUxOTg4Mn0.UPFhyMPwmM9DzyiRnjTg3EQGPg9KvcIQcP6wHM5WRSg'
};