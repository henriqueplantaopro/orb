/* O timbre em imagem, embutido no código.

   Está aqui como texto, e não como arquivo em `img/`, porque o PDF
   e o Excel precisam do conteúdo na hora de montar o documento:
   imagem externa depende de carregar a tempo, e quando não carrega o
   documento sai sem timbre. Documento que vai para hospital,
   contador e órgão público não pode sair sem identificação.

   É a arte original da marca, reduzida ao tamanho de uso no papel
   (220px de largura), o que mantém o arquivo em torno de 10 kB. */
window.ERP = window.ERP || {};
ERP.timbre = {
  /* JPEG, versão escura — vai sobre papel branco. */
  largura: 220,
  altura: 81,
  jpeg: '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'
};
