/* A marca do sistema, em um lugar só.

   O SVG usa `currentColor` no anel e no texto: a cor vem de quem o
   contém. No topo escuro ele fica branco; num relatório, azul
   institucional. Só a órbita e a esfera têm cor própria — são o
   acento da identidade e não mudam.

   Está aqui como função, e não como arquivo de imagem, porque
   relatório impresso e PDF embutem o conteúdo: imagem externa
   depende de carregar a tempo, e quando não carrega o documento sai
   sem timbre. */
window.ERP = window.ERP || {};
ERP.marca = (function () {
  'use strict';

  /* `id` evita colisão quando a marca aparece duas vezes na mesma
     página (tela e área de impressão): dois gradientes com o mesmo
     nome fazem o navegador usar só o primeiro. */
  function svg(opcoes) {
    const o = opcoes || {};
    const id = o.id || ('m' + Math.random().toString(36).slice(2, 7));
    const altura = o.altura || 34;
    const comAssinatura = o.assinatura !== false;
    return '<svg viewBox="0 0 660 150" height="' + altura + '" ' +
      'style="width:auto;display:block" role="img" ' +
      'aria-label="ORB — Sistema de Gestão Integrada">' +
      '<defs>' +
        '<linearGradient id="' + id + 'e" x1=".2" y1="0" x2=".9" y2="1">' +
          '<stop offset="0" stop-color="#8FDEFF"/><stop offset="1" stop-color="#009FE3"/>' +
        '</linearGradient>' +
        '<linearGradient id="' + id + 'o" x1="0" y1="1" x2="1" y2="0">' +
          '<stop offset="0" stop-color="#00B4FF"/><stop offset=".55" stop-color="#2BBEFF"/>' +
          '<stop offset="1" stop-color="#6FD2FF"/>' +
        '</linearGradient>' +
        '<mask id="' + id + 'c"><rect width="660" height="150" fill="#fff"/>' +
          '<path d="M30 96 L96 24 L110 36 L44 108 Z" fill="#000"/></mask>' +
      '</defs>' +
      '<circle cx="74" cy="74" r="45" fill="none" stroke="currentColor" ' +
        'stroke-width="15" mask="url(#' + id + 'c)"/>' +
      '<g transform="rotate(-40 74 74)">' +
        '<path d="M15 74 a59 27 0 0 0 118 0" fill="none" stroke="url(#' + id + 'o)" ' +
          'stroke-width="8.5" stroke-linecap="round"/></g>' +
      '<circle cx="118" cy="33" r="12" fill="url(#' + id + 'e)"/>' +
      '<text x="158" y="96" font-size="74" font-weight="800" letter-spacing="-.5" ' +
        'fill="currentColor">ORB</text>' +
      (comAssinatura
        ? '<text x="161" y="124" font-size="14.5" font-weight="500" letter-spacing="5" ' +
          'fill="currentColor" opacity=".8">SISTEMA DE GESTÃO INTEGRADA</text>'
        : '') +
      '</svg>';
  }

  /* A arte em imagem, para tela. `img()` devolve a versão certa para
     o fundo: clara no topo escuro, escura no papel. */
  function img(opcoes) {
    const o = opcoes || {};
    const clara = o.clara === true;
    const altura = o.altura || 34;
    return '<img src="img/orb-' + (clara ? 'claro' : 'escuro') + '.png" ' +
      'alt="ORB — Sistema de Gestão Integrada" style="height:' + altura +
      'px;width:auto;display:block">';
  }

  /* Bloco de timbre para documento em papel: marca à esquerda, dados
     da empresa à direita. */
  function timbre(empresa) {
    const e = empresa || {};
    return '<div class="marca-doc">' + img({ altura: 38 }) + '</div>' +
      (e.nome ? '<div class="rel-emp">' + ERP.util.esc(e.nome) +
        (e.cnpj ? '<span class="sub"> · CNPJ ' + ERP.util.esc(e.cnpj) + '</span>' : '') +
        '</div>' : '');
  }

  return { svg: svg, img: img, timbre: timbre };
})();
