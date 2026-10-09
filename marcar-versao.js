/* Grava a versão no js/versao.js a partir do nome do pacote.

   O marcador servia para distinguir código novo de cache — e
   deixou de servir quando ficou parado no "v54" por quatro
   entregas. Marcador que não acompanha a realidade é pior que
   nenhum: ele dá confiança falsa.

   Uso:  node marcar-versao.js v73
*/
const fs = require('fs');
const v = process.argv[2];
if (!v) { console.error('uso: node marcar-versao.js v73'); process.exit(1); }

const hoje = new Date();
const data = String(hoje.getDate()).padStart(2, '0') + '/' +
  String(hoje.getMonth() + 1).padStart(2, '0') + '/' + hoje.getFullYear();

/* js/versao.js, não config.js: a versão saiu de lá para parar
   de conflitar no git com as chaves do banco, que diferem por
   ramo. Ver o comentário no próprio versao.js. */
const caminho = __dirname + '/js/versao.js';
let s = fs.readFileSync(caminho, 'utf8');
/* A forma mudou junto com o arquivo: no config.js era uma
   propriedade de objeto (`versao: '...'`), aqui é uma atribuição
   (`ERP.config.versao = '...'`). O padrão antigo não casava com o
   novo arquivo e a troca passava em silêncio, dizendo
   "(nenhuma) → v105" e deixando a versão anterior no ar — que é
   exatamente o defeito que este script existe para evitar. */
const PADRAO = /ERP\.config\.versao\s*=\s*'([^']*)'/;
const antes = (s.match(PADRAO) || [])[1];
if (antes === undefined) {
  console.error('ERRO: não achei a linha da versão em ' + caminho + ' — nada foi gravado.');
  process.exit(1);
}
s = s.replace(PADRAO, "ERP.config.versao = '" + v + ' · ' + data + "'");
fs.writeFileSync(caminho, s);
console.log('versão: ' + antes + '  →  ' + v + ' · ' + data);
