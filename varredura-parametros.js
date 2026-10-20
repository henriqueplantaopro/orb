/* VARREDURA · o parâmetro alterado na tela chega ao banco?

   POR QUE ISTO EXISTE

   `salvarParametros` grava em `st.parametros`, que é memória da
   sessão. Quem leva isso ao banco é `gravarParametros`, e ela não
   manda o objeto inteiro: manda só as chaves listadas em
   `PARAMETROS_POLITICA`. Uma chave nova escrita na tela e esquecida
   nessa lista é gravada em lugar nenhum.

   O defeito é invisível por desenho. A tela mostra o valor novo, a
   mensagem diz "salvo", nada erra no console. Só na próxima vez que
   alguém recarrega a página — talvez dias depois, talvez outra
   pessoa — o valor volta ao padrão, sem aviso e sem rastro. Foi
   exatamente assim com a alçada de aprovação, que durante meses
   valeu só até o logout.

   A varredura lê as duas pontas: toda chave que `salvarParametros`
   escreve em `p.` precisa estar na lista que vai ao banco. */
const fs = require('fs');
const path = require('path');

const store = fs.readFileSync(path.join(__dirname, 'js', 'store.js'), 'utf8');
const persist = fs.readFileSync(path.join(__dirname, 'js', 'persistencia.js'), 'utf8');

/* O corpo de salvarParametros, sem comentários. */
const ini = store.indexOf('function salvarParametros(');
const corpo = store.slice(ini, store.indexOf('\n  }', ini))
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const escritas = [];
/* `p.x = ...` e `p[k] = ...` dentro de um forEach sobre uma lista
   literal — as duas formas que o arquivo usa hoje. */
corpo.replace(/\bp\.([a-z_0-9]+)\s*(?:=|\[)/g, function (_, k) {
  if (escritas.indexOf(k) < 0) escritas.push(k); return _;
});
corpo.replace(/\[([^\]]*)\]\.forEach\(function \(k\)[\s\S]*?p\[k\]/g, function (bloco, lista) {
  lista.replace(/'([a-z_0-9]+)'/g, function (__, k) {
    if (escritas.indexOf(k) < 0) escritas.push(k); return __;
  });
  return bloco;
});

/* `alcada` é objeto e é escrito campo a campo (`p.alcada[k]`); a
   captura acima pega o nome certo de qualquer jeito. */

const listaIni = persist.indexOf('const PARAMETROS_POLITICA');
const lista = persist.slice(listaIni, persist.indexOf('];', listaIni))
  .replace(/\/\*[\s\S]*?\*\//g, '');
const vaoAoBanco = [];
lista.replace(/'([a-z_0-9]+)'/g, function (_, k) { vaoAoBanco.push(k); return _; });

if (!escritas.length || !vaoAoBanco.length) {
  console.log('FALHA - a varredura não achou uma das duas pontas ' +
    '(escritas: ' + escritas.length + ', lista: ' + vaoAoBanco.length + ')');
  console.log('        o formato do código mudou; conserte a varredura antes de confiar nela.');
  process.exit(1);
}

const orfas = escritas.filter(function (k) { return vaoAoBanco.indexOf(k) < 0; });

escritas.forEach(function (k) {
  console.log((orfas.indexOf(k) < 0 ? 'OK    - ' : 'FALHA - ') + k +
    (orfas.indexOf(k) < 0 ? ' · alterado na tela e gravado no banco' : ' · alterado na tela e NÃO gravado'));
});

if (orfas.length) {
  console.log('');
  console.log('        ' + orfas.join(', ') + ' — a tela vai dizer que salvou, e o valor');
  console.log('        volta ao padrão na próxima recarga, sem avisar ninguém.');
  console.log('        Inclua em PARAMETROS_POLITICA, em js/persistencia.js.');
}

console.log('\n' + (orfas.length
  ? orfas.length + ' parâmetro(s) que somem na recarga'
  : 'todo parâmetro alterado na tela chega ao banco ✓'));
process.exit(orfas.length ? 1 : 0);
