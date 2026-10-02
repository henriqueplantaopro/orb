/* Varredura de formatação — número e data têm UM formato só.

   Número: 00.000,00 (ponto no milhar, vírgula no decimal, sempre duas
   casas) — `U.brl` para dinheiro, `U.num` para quantidade, `U.pct`
   para percentual.
   Data: dd/mm/aaaa — `U.fData`; com hora, `U.fDataHora`; competência,
   `U.fComp`.

   Esta varredura falha quando aparece formatação feita à mão, que é
   como o padrão se perde: um `toFixed(2)` imprime "1234.56" e um
   `toLocaleString` depende do locale da máquina de quem abre.

   Exceções legítimas, que a varredura ignora:
   - pdf.js: `toFixed` em coordenadas do PDF, não em texto exibido;
   - ISO em `value="..."` de <input type="date">, em data-attributes e
     em nome de arquivo — ali o formato ISO é obrigatório;
   - exportar.js: máscaras do Excel ('#,##0.00' e 'dd/mm/yyyy'), que
     são o mesmo padrão escrito na linguagem da planilha.

   Rodar: node varredura-formato.js */
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'js');
const isentos = ['pdf.js', 'util.js', 'exportar.js'];
let achados = 0;

fs.readdirSync(dir).filter(f => /\.js$/.test(f) && isentos.indexOf(f) < 0).forEach(function (arq) {
  const linhas = fs.readFileSync(path.join(dir, arq), 'utf8').split('\n');
  linhas.forEach(function (linha, i) {
    const n = i + 1;
    const reporta = (motivo) => {
      console.log(arq + ':' + n + '  ' + motivo + '\n    ' + linha.trim().slice(0, 110));
      achados++;
    };
    if (/\.toFixed\s*\(/.test(linha)) reporta('toFixed imprime ponto decimal — use U.brl / U.num');
    if (/\.toLocaleString\s*\(/.test(linha)) reporta('toLocaleString depende do locale — use U.brl / U.num / U.fDataHora');
    /* Percentual montado à mão: `+ '%'` sem passar por U.pct/U.num. */
    if (/\+\s*'%'/.test(linha) && !/U\.(pct|num)\(/.test(linha)) {
      reporta("percentual sem formatação — use U.pct");
    }
    /* Data ISO exibida: split/reverse na mão em vez de U.fData. */
    if (/split\('-'\)\.reverse\(\)/.test(linha)) reporta('data formatada à mão — use U.fData');
  });
});

console.log(achados ? '\n' + achados + ' ponto(s) fora do padrão.'
  : 'formatação uniforme: número 00.000,00 e data dd/mm/aaaa em todos os módulos ✓');
process.exit(achados ? 1 : 0);
