/* VARREDURA · a coluna que o sistema grava existe no banco?

   POR QUE ISTO EXISTE

   Ao gravar, o sistema monta a linha a partir de uma lista de
   colunas declarada em `js/persistencia.js`. O Postgres rejeita a
   linha INTEIRA se um único nome dessa lista não existir na tabela
   — não grava o resto, não grava nada.

   Foi o que quase aconteceu com `vt_modo` e `vr_modo`, os campos do
   modo do vale: entraram na lista de gravação e nunca foram criados
   no banco. Nos testes daqui passa, porque aqui não há Postgres. No
   banco de verdade, o cadastro de QUALQUER funcionário pararia de
   salvar — e a mensagem que aparece na tela fala de uma coluna que
   a pessoa do DP nunca ouviu falar.

   É o pior tipo de defeito deste sistema: não aparece em nada do
   que rodo, só aparece com a empresa usando, e derruba uma operação
   inteira em vez de um canto dela.

   A varredura lê as colunas declaradas para gravação e confere cada
   uma contra o que o banco realmente tem: o schema mais todo ALTER
   TABLE ... ADD COLUMN acumulado nas migrações. */
const fs = require('fs');
const path = require('path');

const persist = fs.readFileSync(path.join(__dirname, 'js', 'persistencia.js'), 'utf8');
const dirSql = path.join(__dirname, 'supabase');

/* ── 1. o que o sistema grava ───────────────────────── */
const declaradas = {};
/* Listas com nome proprio, fora do mapa. `funcionarios` tem a sua
   porque a FONTE de leitura muda conforme quem esta lendo. Foi
   justamente a que acumulou nove campos sem coluna. */
const AVULSAS = { COLUNAS_FUNCIONARIO: 'funcionarios' };
Object.keys(AVULSAS).forEach(function (nome) {
  const i = persist.indexOf('const ' + nome);
  if (i < 0) return;
  const lista = persist.slice(i, persist.indexOf('];', i)).replace(/\/\*[\s\S]*?\*\//g, '');
  const cols = [];
  lista.replace(/'([a-z_0-9]+)'/g, function (_, c) { cols.push(c); return _; });
  declaradas[AVULSAS[nome]] = (declaradas[AVULSAS[nome]] || []).concat(cols);
});
persist.replace(
  /\{\s*tabela:\s*'([a-z_]+)',\s*colunas:\s*\[([^\]]*)\]/g,
  function (_, tabela, lista) {
    const cols = [];
    lista.replace(/'([a-z_0-9]+)'/g, function (__, c) { cols.push(c); return __; });
    declaradas[tabela] = (declaradas[tabela] || []).concat(cols);
    return _;
  });

/* ── 2. o que o banco tem ───────────────────────────── */
/* O schema é a base; as migrações acrescentam. Um `add column`
   posterior vale tanto quanto uma coluna do schema original — é
   assim que o banco de verdade chegou ao estado de hoje. */
const existentes = {};
const poe = function (tabela, coluna) {
  existentes[tabela] = existentes[tabela] || {};
  existentes[tabela][coluna] = true;
};

const sqls = fs.readdirSync(dirSql)
  .filter(function (f) { return /\.sql$/.test(f); })
  .sort();

sqls.forEach(function (arq) {
  /* MONTAR-TESTE e ATUALIZAR-TUDO são compilados dos demais; ler os
     dois junto não muda o resultado, mas também não atrapalha. */
  const sql = fs.readFileSync(path.join(dirSql, arq), 'utf8')
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  /* create table [if not exists] [public.]nome ( ... ); */
  const reCreate = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_0-9]+)\s*\(/gi;
  let m;
  while ((m = reCreate.exec(sql))) {
    const tabela = m[1];
    /* Corpo da definição, equilibrando parênteses — numeric(10,2) e
       check(...) têm parênteses dentro e quebrariam um corte ingênuo
       no primeiro `)`. */
    let i = m.index + m[0].length, nivel = 1, corpo = '';
    while (i < sql.length && nivel > 0) {
      const ch = sql[i];
      if (ch === '(') nivel++;
      else if (ch === ')') { nivel--; if (!nivel) break; }
      corpo += ch; i++;
    }
    /* Cada item de primeiro nível começa com o nome da coluna. */
    let n = 0, item = '';
    corpo.split('').forEach(function (ch) {
      if (ch === '(') n++;
      if (ch === ')') n--;
      if (ch === ',' && !n) { item = ''; return; }
      item += ch;
      if (item.trim() && !/\s/.test(item.trim())) return;
    });
    corpo.replace(/(^|,)\s*([a-z_0-9]+)\s+[a-z]/gi, function (todo, _v, col) {
      const palavra = col.toLowerCase();
      if (['primary', 'foreign', 'unique', 'check', 'constraint', 'exclude'].indexOf(palavra) > -1) return todo;
      poe(tabela, palavra);
      return todo;
    });
  }

  /* alter table [public.]nome add [column] [if not exists] coluna */
  const reAlter = /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_0-9]+)\s+([\s\S]*?);/gi;
  while ((m = reAlter.exec(sql))) {
    const tabela = m[1];
    m[2].replace(/add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([a-z_0-9]+)/gi,
      function (todo, col) { poe(tabela, col.toLowerCase()); return todo; });
  }
});

/* ── 3. o confronto ─────────────────────────────────── */
let falhas = 0;
const semTabela = [];

Object.keys(declaradas).sort().forEach(function (tabela) {
  const tem = existentes[tabela];
  if (!tem) {
    /* Tabela que a varredura não achou em SQL nenhum: pode ser
       criada por outro caminho (Edge Function, painel). Sinaliza,
       mas não reprova — reprovar aqui seria ruído, e varredura
       ruidosa é varredura ignorada. */
    semTabela.push(tabela);
    return;
  }
  const faltando = declaradas[tabela].filter(function (c) { return !tem[c]; });
  if (faltando.length) {
    falhas += faltando.length;
    console.log('FALHA - ' + tabela + ': grava ' + faltando.join(', ') + ' — coluna que o banco não tem');
    console.log('        o Postgres recusa a linha inteira: nenhum ' + tabela.replace(/s$/, '') +
      ' consegue ser salvo.');
    console.log('        Crie com: alter table ' + tabela + ' add column if not exists ' +
      faltando[0] + ' <tipo>;');
  } else {
    console.log('OK    - ' + tabela + ' · ' + declaradas[tabela].length + ' colunas, todas no banco');
  }
});

if (semTabela.length) {
  console.log('\n        (sem definição em SQL, não conferidas: ' + semTabela.join(', ') + ')');
}

console.log('\n' + (falhas
  ? falhas + ' coluna(s) que o sistema grava e o banco não tem'
  : 'toda coluna gravada existe no banco ✓'));
process.exit(falhas ? 1 : 0);
