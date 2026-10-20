/* VARREDURA · toda tabela que o sistema LÊ tem caminho de gravação?

   POR QUE ISTO EXISTE

   O mesmo defeito aconteceu três vezes, e das três eu só descobri
   quando o dado sumiu na frente de alguém:

     v115 · `cargos` era lida e nunca gravada. O cargo criado pelo
     botão "+ cadastrar" vivia na memória, e o funcionário que
     apontasse para ele derrubava a gravação com
     "funcionarios_cargo_fkey".

     v122 · `perfis`, idêntico. A tela dizia "Perfil salvo", o F5
     apagava, e o usuário novo caía junto por causa da chave
     estrangeira `usuarios.perfil`.

   É sempre a mesma forma: a tabela entra no mapa de LEITURA, a
   tela ganha um botão de criar, e ninguém escreve o caminho de
   volta. Nada no sistema reclama — a tela até diz que salvou.

   Esta varredura fecha a classe. Cada tabela lida precisa de uma
   destas três coisas, ou a varredura falha:

     1. estar no mapa de gravação do movimento (`persistencia`);
     2. ter uma função própria que escreve nela;
     3. estar declarada aqui embaixo como somente-leitura, COM O
        MOTIVO escrito.

   A terceira é o ponto: tabela somente-leitura é uma decisão, e
   decisão tem de ser declarada. Enquanto for esquecimento, ela se
   repete. */
const fs = require('fs');
const dir = __dirname;

const remoto = fs.readFileSync(dir + '/js/dados-remoto.js', 'utf8');
const persist = fs.readFileSync(dir + '/js/persistencia.js', 'utf8');

/* O que o sistema LÊ na entrada — os cadastros. */
const lidas = [];
const blocoRemoto = remoto.slice(remoto.indexOf('const MAPA'), remoto.indexOf('];', remoto.indexOf('const MAPA')));
blocoRemoto.replace(/tabela:\s*'([^']+)'/g, function (_, t) { lidas.push(t); return _; });

/* O que o sistema GRAVA pelo mapa do movimento. */
const gravadas = [];
const blocoPersist = persist.slice(persist.indexOf('const MAPA'), persist.indexOf('\n  };', persist.indexOf('const MAPA')));
blocoPersist.replace(/tabela:\s*'([^']+)'/g, function (_, t) { gravadas.push(t); return _; });

/* Quem escreve por função própria, fora do mapa. A busca é pelo
   que de fato manda ao banco: `.from('x').upsert(`, `.insert(`,
   `.delete(` ou `.update(`. */
const escritaPropria = {};
[persist, fs.readFileSync(dir + '/js/dados-remoto.js', 'utf8')].forEach(function (src) {
  const re = /from\(\s*'([a-z_]+)'\s*\)\s*(?:\n\s*)?\.(upsert|insert|delete|update)\b/g;
  let m;
  while ((m = re.exec(src))) { escritaPropria[m[1]] = m[2]; }
});

/* SOMENTE LEITURA, POR DECISÃO — e o motivo junto. */
const somenteLeitura = {
  plano_contas: 'O plano de contas é estrutura contábil, mantida por SQL ' +
    'com a contabilidade. Não há tela que crie conta, e não deve haver: ' +
    'conta nova fora do plano quebra o DRE e a classificação de despesa.'
};

let falhas = 0;
const linha = (ok, txt, det) => {
  console.log((ok ? 'OK   ' : 'FALHA') + ' - ' + txt + (det ? '  [' + det + ']' : ''));
  if (!ok) falhas++;
};

console.log('tabelas lidas na entrada: ' + lidas.length);
console.log('tabelas no mapa de gravação: ' + gravadas.length);
console.log('tabelas com função própria de escrita: ' +
  Object.keys(escritaPropria).sort().join(', ') + '\n');

lidas.forEach(function (t) {
  if (gravadas.indexOf(t) > -1) return linha(true, t + ' — grava pelo mapa do movimento');
  if (escritaPropria[t]) return linha(true, t + ' — grava por função própria (' + escritaPropria[t] + ')');
  if (somenteLeitura[t]) return linha(true, t + ' — somente leitura, declarado');
  linha(false, t + ' — LIDA E NUNCA GRAVADA', 'se a tela cria linha aqui, ela some no F5');
});

/* O estoque é escrito por `gravarIndexado`, que recebe a definição
   e chama `from(def.tabela)` — nome em VARIÁVEL, invisível para a
   busca por literal acima. Em vez de abrir exceção e seguir, a
   varredura confere o que de fato importa: que a função exista,
   que ela escreva, e que as duas definições apontem para estas
   tabelas. Exceção sem conferência é como o campo `modulos`: some
   do radar e envelhece mentindo. */
const escreveIndexado = /async function gravarIndexado[\s\S]{0,900}?from\(def\.tabela\)[\s\S]{0,120}?upsert\(/.test(persist);
linha(escreveIndexado, 'gravarIndexado escreve de verdade no banco',
  escreveIndexado ? '' : 'a função existe mas não manda nada');

[['posicoes_estoque', 'POSICOES'], ['minimos_estoque', 'MINIMOS']].forEach(function (par) {
  const def = new RegExp('const ' + par[1] + ' = \\{[^}]*tabela:\\s*\'' + par[0] + '\'');
  const temDef = def.test(persist);
  linha(temDef && escreveIndexado, par[0] + ' — tem caminho de gravação (via gravarIndexado)',
    temDef ? '' : 'nenhuma definição aponta para esta tabela');
});

['matriz_acesso', 'parametros'].forEach(function (t) {
  const temEscrita = escritaPropria[t] || gravadas.indexOf(t) > -1;
  linha(!!temEscrita, t + ' — tem caminho de gravação',
    temEscrita ? '' : 'nenhuma função escreve nesta tabela');
});

console.log('\n' + (falhas
  ? falhas + ' tabela(s) sem caminho de gravação — veja acima'
  : 'toda tabela lida tem caminho de gravação, ou está declarada somente-leitura ✓'));
process.exit(falhas ? 1 : 0);
