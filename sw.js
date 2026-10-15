/* ORB · service worker — ele existe e NÃO guarda nada.

   POR QUE ELE EXISTE
   O Chrome só oferece "Instalar" para uma página que tenha
   manifesto, ícones e um service worker com tratador de `fetch`.
   É exigência da instalação, não necessidade do sistema.

   POR QUE ELE NÃO GUARDA NADA
   A receita comum de PWA manda guardar os arquivos num cache para
   a página abrir sem internet. Aqui isso não compra nada e cobra
   caro:

     NÃO COMPRA — o ORB não funciona sem internet de jeito nenhum.
     Lançamento, saldo, contrato e documento vivem no Supabase. Uma
     casca que abre sem dados não é o sistema, é uma tela vazia que
     mente dizendo que está funcionando.

     COBRA CARO — cache de service worker é servido NO LUGAR do
     servidor. Publicada uma versão nova, o app instalado continua
     servindo a antiga, e a troca só acontece quando todas as
     janelas do app são fechadas — coisa que ninguém faz com app
     instalado. Seria o defeito da aba velha rodando código velho,
     agora permanente e sem Ctrl+Shift+R para resolver, porque app
     instalado não tem essa tecla.

   Então o tratador abaixo faz uma coisa só: deixa o pedido seguir
   para a rede, como se o service worker não existisse. Quem avisa
   de versão nova é a vigia dentro do ERP (`vigiarVersao`, em
   app.js), que pergunta ao servidor e mostra a faixa para
   recarregar.

   `skipWaiting` e `clients.claim` estão aqui pelo mesmo motivo: se
   um dia este arquivo mudar, a versão nova assume na hora, sem
   esperar o app ser fechado. */

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  /* Limpa qualquer cache que uma versão anterior deste arquivo
     tenha criado. Se algum dia alguém instalar a receita comum por
     engano, isto desfaz na primeira abertura seguinte. */
  e.waitUntil(
    caches.keys()
      .then(function (nomes) { return Promise.all(nomes.map(function (n) { return caches.delete(n); })); })
      .then(function () { return self.clients.claim(); })
      .catch(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  /* Nada de cache. O pedido vai para a rede e volta de lá — é
     exatamente o que aconteceria sem service worker nenhum. */
  e.respondWith(fetch(e.request));
});
