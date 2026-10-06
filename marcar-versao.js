/* Grava a versão no config.js a partir do nome do pacote.

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

const caminho = __dirname + '/js/config.js';
let s = fs.readFileSync(caminho, 'utf8');
const antes = (s.match(/versao: '([^']*)'/) || [])[1];
s = s.replace(/versao: '[^']*'/, "versao: '" + v + ' · ' + data + "'");
fs.writeFileSync(caminho, s);
console.log('versão: ' + (antes || '(nenhuma)') + '  →  ' + v + ' · ' + data);
