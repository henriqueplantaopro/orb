/* Varredura de funções duplicadas no store.

   Quatro definições estavam duplicadas e a segunda sobrescrevia a
   primeira em silêncio: uma correção feita na cópia de cima virava
   código morto sem ninguém perceber. Isto passa a ser erro.

   Rodar: node varredura-duplicatas.js */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'js');
let total = 0;

fs.readdirSync(dir).filter(f => /\.js$/.test(f)).forEach(function (arq) {
  const texto = fs.readFileSync(path.join(dir, arq), 'utf8');
  const vistos = {};
  const re = /^\s{2}function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm;
  let m;
  while ((m = re.exec(texto))) {
    const nome = m[1];
    const linha = texto.slice(0, m.index).split('\n').length;
    (vistos[nome] = vistos[nome] || []).push(linha);
  }
  Object.keys(vistos).filter(n => vistos[n].length > 1).forEach(function (n) {
    console.log('DUPLICADA ' + arq + ' → function ' + n + ' nas linhas ' + vistos[n].join(', '));
    total++;
  });
});

console.log(total ? total + ' função(ões) duplicada(s)' : 'nenhuma função duplicada ✓');
process.exit(total ? 1 : 0);
