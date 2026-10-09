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
  ambiente: 'producao',

  /* Marcador da versão publicada. Serve para saber, em dois
     segundos, se o navegador está com o código novo ou com uma
     cópia velha em cache — pergunta que já custou duas rodadas de
     diagnóstico em cima de um erro que não existia mais. */
  /* A versão é gravada no empacotamento, não à mão: escrita
     manualmente, ela envelhece sem ninguém notar e passa a mentir
     sobre o que está no ar — foi o que aconteceu com o "v54" que
     ficou parado enquanto o código avançava. */
  versao: 'v104 · 09/10/2026',

  url: 'https://jsdyowuqehryfwqyklax.supabase.co',
  anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzZHlvd3VxZWhyeWZ3cXlrbGF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5NDM4ODIsImV4cCI6MjEwNjUxOTg4Mn0.UPFhyMPwmM9DzyiRnjTg3EQGPg9KvcIQcP6wHM5WRSg'
};
