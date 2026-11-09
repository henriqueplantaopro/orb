/* Liga+¦+·o com o banco.

   A chave `anon` +« p+ªblica por natureza: ela identifica o projeto,
   n+·o a pessoa. Quem decide o que cada um l+¼ +« a matriz de acesso
   dentro do Postgres ÈÃ÷ por isso ela pode viver aqui, no c+ªdigo que
   vai para o navegador.

   A outra chave do painel, a `service_role`, NUNCA entra aqui nem
   em lugar nenhum do reposit+ªrio: ela ignora toda a seguran+¦a.

   Deixando `url` em branco, o sistema roda no modo local de sempre,
   com o seletor de usu+Ýrio e sem guardar nada. +Ù assim que a
   bateria de testes continua rodando. */
window.ERP = window.ERP || {};
ERP.config = {
  /* Endere+¦o da fun+¦+·o que cria acesso. O painel do Supabase +ßs
     vezes publica com um nome autom+Ýtico (`dynamic-responder` e
     parecidos) e mostra o nome escolhido s+ª como r+ªtulo ÈÃ÷ o ERP
     chama pelo endere+¦o, ent+·o +« este valor que precisa bater com
     o que aparece na coluna URL, depois de `/functions/v1/`. */
  /* O painel do Supabase publicou a fun+¦+·o com o nome autom+Ýtico
     `dynamic-responder` e mostra "criar-login" s+ª como r+ªtulo ÈÃ÷ o
     sistema chama pelo ENDERE+þO. Este valor precisa bater com o
     trecho depois de /functions/v1/ na coluna URL do painel.

     ATEN+þ+ÔO ao atualizar o sistema: este arquivo vem no pacote e
     sobrescreve o local. Se o acesso parar de ser criado depois de
     uma atualiza+¦+·o, +« esta linha que voltou ao padr+·o. */
  funcaoCriarLogin: 'dynamic-responder',

  /* AMBIENTE. 'producao' +« o normal; 'teste' pinta o topo de
     laranja e p+-e um selo no t+ítulo da aba.

     A cor existe para uma coisa s+ª: impedir que algu+«m lance no
     lugar errado. Dois sistemas id+¼nticos em abas vizinhas +«
     pedido de confus+·o ÈÃ÷ e no financeiro a confus+·o s+ª aparece no
     fechamento, quando j+Ý virou retrabalho de dias.

     O ambiente de teste tem BANCO PR+¶PRIO: a `url` acima aponta
     para outro projeto. Mesmo c+ªdigo, dados separados. */
  ambiente: 'producao',

  /* A vers+·o publicada vive em js/versao.js, carregado logo depois
     deste arquivo. Ela saiu daqui porque mudava a cada entrega
     enquanto as chaves abaixo mudam por ramo: juntas, as duas
     coisas faziam este arquivo conflitar no git em toda
     publica+¦+·o. */

  url: 'https://jsdyowuqehryfwqyklax.supabase.co',
  anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzZHlvd3VxZWhyeWZ3cXlrbGF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5NDM4ODIsImV4cCI6MjEwNjUxOTg4Mn0.UPFhyMPwmM9DzyiRnjTg3EQGPg9KvcIQcP6wHM5WRSg'
};