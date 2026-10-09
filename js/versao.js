/* A VERSÃO PUBLICADA, e só ela.

   POR QUE ESTE ARQUIVO EXISTE

   A versão morava no `config.js`, junto com o endereço e a chave do
   banco. Os dois mudam por motivos opostos:

     as CHAVES diferem entre os ramos (produção e teste apontam para
     bancos diferentes) e não mudam de uma versão para a outra;

     a VERSÃO é igual nos dois ramos e muda em toda entrega.

   Morando no mesmo arquivo, os dois garantiam conflito no git a
   cada publicação: o ramo de teste tinha a sua chave, o de produção
   a dele, e a linha da versão mexia nos dois. Toda entrega exigia
   resolver o conflito à mão, e resolver conflito à mão é a chance
   de estragar o arquivo — foi o que aconteceu na v104, quando a
   resolução trocou a codificação da linha e o rodapé passou a
   mostrar "v104 Â·".

   Separados, nenhum dos dois conflita: este aqui é idêntico nos
   dois ramos, e o `config.js` deixa de mudar entre versões.

   Carrega DEPOIS do config.js e escreve nele, para que tudo que já
   lia `ERP.config.versao` continue lendo do mesmo lugar.

   A versão é gravada pelo `marcar-versao.js` no empacotamento, não
   à mão: escrita à mão, ela envelhece sem ninguém notar e passa a
   mentir sobre o que está no ar. */
window.ERP = window.ERP || {};
ERP.config = ERP.config || {};
ERP.config.versao = 'v106 · 09/10/2026';
