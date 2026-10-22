/* PROVA CONTRA BANCO DE VERDADE
   ═══════════════════════════════════════════════════════════════

   POR QUE ISTO EXISTE

   Três vezes seguidas um cadastro foi digitado, apareceu certo na
   tela, e não estava no banco no dia seguinte. As três vezes os
   testes passaram — porque TODOS os outros testes falam com um
   banco falso, que aceita qualquer coisa e devolve o que mandaram.
   Banco falso não tem coluna, não tem tipo, não tem restrição e
   não recusa nada. É cego exatamente para a classe de defeito que
   machucou.

   Esta prova é diferente: ela sobe o schema REAL num Postgres
   REAL, liga o sistema nele pelo caminho de gravação de verdade —
   `editarFuncionario` → `sincronizar` → `upsert` — e depois
   RECARREGA do banco e confere campo a campo se voltou igual.

   O que ela pega, e os outros não:
     • coluna que o sistema grava e a tabela não tem;
     • campo que cai no `extra` e nunca é lido de volta;
     • gravação recusada pelo banco que o sistema trata como
       sucesso;
     • valor que muda de forma na ida e na volta.

   COMO RODAR
     node prova-banco-real.js
   Ela sobe e derruba o seu próprio banco; não encosta em nada do
   ambiente real nem do de teste. */
const { Client } = require('/tmp/pgclient/node_modules/pg');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = __dirname;
const PORTA = 55970;
const DIR = '/tmp/pg-prova-' + PORTA;

const falhas = [];
const confere = (nome, ok, detalhe) => {
  console.log((ok ? 'OK   ' : 'FALHA') + ' - ' + nome + (detalhe ? '  [' + detalhe + ']' : ''));
  if (!ok) falhas.push(nome);
};

/* ── 1. um Postgres só para esta prova ───────────────── */
function bin() {
  return execSync('ls -d /usr/lib/postgresql/*/bin').toString().trim().split('\n')[0];
}
function subirBanco() {
  const b = bin();
  try { execSync(`su postgres -c "${b}/pg_ctl -D ${DIR} stop -m immediate"`, { stdio: 'ignore' }); } catch (e) {}
  execSync(`rm -rf ${DIR} && mkdir -p ${DIR} && chown postgres:postgres ${DIR}`);
  /* Nada de stdio:'ignore' aqui. Esta prova existe porque uma falha
     silenciosa passou tres vezes; engolir o erro do proprio banco que
     a prova usa seria repetir o defeito dentro da ferramenta. */
  try {
    execSync(`su postgres -c "${b}/initdb -D ${DIR} -A trust"`, { stdio: 'pipe' });
  } catch (e) {
    throw new Error('initdb falhou:\n' + (e.stderr || e.stdout || e.message).toString());
  }
  /* O socket vai para dentro do proprio DIR (-k). Sem isso ele cai no
     diretorio padrao da distribuicao (/var/run/postgresql) e o cliente
     nao acha — foi exatamente o que derrubou a primeira tentativa. */
  try {
    execSync(`su postgres -c "${b}/pg_ctl -D ${DIR} -o '-p ${PORTA} -k ${DIR}' -l ${DIR}/log start -w -t 30"`,
      { stdio: 'pipe' });
  } catch (e) {
    let log = '';
    try { log = execSync(`cat ${DIR}/log`).toString(); } catch (x) {}
    throw new Error('pg_ctl falhou:\n' + (e.stderr || e.stdout || e.message).toString() + '\n--- log ---\n' + log);
  }
  /* Conferir que o socket existe antes de seguir: se nao existir, a
     mensagem tem de dizer isso, nao um ENOENT solto la na frente. */
  if (!fs.existsSync(`${DIR}/.s.PGSQL.${PORTA}`)) {
    throw new Error('o banco subiu mas o socket nao apareceu em ' + DIR);
  }
}
function derrubarBanco() {
  try { execSync(`su postgres -c "${bin()}/pg_ctl -D ${DIR} stop -m immediate"`, { stdio: 'ignore' }); } catch (e) {}
  try { execSync(`rm -rf ${DIR}`); } catch (e) {}
}

/* ── 2. o cliente que o sistema pensa ser o Supabase ──
   Traduz o punhado de chamadas que a camada de gravação usa para
   SQL de verdade. Só isto: nada de simular comportamento. O que o
   Postgres responder é o que o sistema recebe, inclusive o erro. */
function clienteSobrePostgres(pg, registro) {
  const aspas = n => '"' + String(n).replace(/"/g, '') + '"';
  function tabela(nome) {
    const q = { _tabela: nome, _ordem: null, _filtros: [] };
    q.select = function () { q._modo = 'select'; return q; };
    q.order = function (c) { q._ordem = c; return q; };
    q.eq = function (c, v) { q._filtros.push([c, v]); return q; };
    ['neq', 'in', 'is', 'gte', 'lte', 'gt', 'lt', 'like', 'ilike', 'or', 'limit', 'range', 'not', 'filter']
      .forEach(m => { q[m] = () => q; });
    q.single = q.maybeSingle = function () { q._um = true; return q; };

    q.upsert = async function (linhas) {
      registro.upserts.push({ tabela: nome, linhas: linhas.length });
      if (!linhas.length) return { data: [], error: null };
      /* União das chaves, como o PostgREST faz: a linha que não
         tem a chave recebe NULL. É justamente onde some campo. */
      const cols = [];
      linhas.forEach(l => Object.keys(l).forEach(k => { if (cols.indexOf(k) < 0) cols.push(k); }));
      const valores = [];
      const partes = linhas.map(function (l) {
        return '(' + cols.map(function (c) {
          let v = l[c];
          if (v === undefined) v = null;
          if (v !== null && typeof v === 'object') v = JSON.stringify(v);
          valores.push(v);
          return '$' + valores.length;
        }).join(',') + ')';
      });
      const set = cols.filter(c => c !== 'id')
        .map(c => aspas(c) + ' = excluded.' + aspas(c)).join(', ');
      const sql = 'insert into ' + aspas(nome) + ' (' + cols.map(aspas).join(',') + ') values ' +
        partes.join(',') + ' on conflict (id) do update set ' + (set || aspas('id') + ' = excluded.' + aspas('id'));
      try {
        await pg.query(sql, valores);
        return { data: null, error: null };
      } catch (e) {
        registro.erros.push(nome + ': ' + e.message);
        return { data: null, error: { message: e.message } };
      }
    };
    q.insert = q.upsert;
    q.delete = function () { q._modo = 'delete'; return q; };

    q.then = function (ok, erro) {
      const roda = (async function () {
        try {
          if (q._modo === 'delete') {
            const onde = q._filtros.map((f, i) => aspas(f[0]) + ' = $' + (i + 1));
            await pg.query('delete from ' + aspas(nome) +
              (onde.length ? ' where ' + onde.join(' and ') : ''), q._filtros.map(f => f[1]));
            return { data: null, error: null };
          }
          const onde = q._filtros.map((f, i) => aspas(f[0]) + ' = $' + (i + 1));
          const r = await pg.query('select * from ' + aspas(nome) +
            (onde.length ? ' where ' + onde.join(' and ') : '') +
            (q._ordem ? ' order by ' + aspas(q._ordem) : ''), q._filtros.map(f => f[1]));
          return { data: q._um ? (r.rows[0] || null) : r.rows, error: null };
        } catch (e) {
          return { data: q._um ? null : [], error: { message: e.message } };
        }
      })();
      return roda.then(ok, erro);
    };
    return q;
  }
  return {
    from: tabela,
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }),
      upload: async () => ({ data: null, error: null }), remove: async () => ({ data: null, error: null }) }) },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'q@a.com' } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    }
  };
}

/* ── 3. o sistema, carregado de verdade ──────────────── */
function montarERP() {
  const sandbox = { console: console, setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, JSON, Date, Math, String, Number, Object, Array, RegExp, isFinite, isNaN, parseInt, parseFloat };
  vm.createContext(sandbox);
  /* Um `document` mínimo e MUDO. A gravação, quando falha, pinta um
     aviso na tela; sem isto a prova morria no aviso em vez de
     mostrar a falha que ele anuncia — o erro escondendo o erro.
     Mudo de propósito: esta prova mede o que vai ao BANCO, nunca o
     que aparece na tela. Quem mede tela é a prova de tela. */
  vm.runInContext(`
    var window = this;
    var document = {
      getElementById: function () { return null; },
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      createElement: function () { return { style: {}, classList: { add: function () {}, remove: function () {} },
        appendChild: function () {}, setAttribute: function () {} }; },
      addEventListener: function () {},
      body: { appendChild: function () {}, insertBefore: function () {}, removeChild: function () {},
              firstChild: null, classList: { add: function () {}, remove: function () {} } }
    };
    window.addEventListener = function () {};
    window.setTimeout = function () { return 0; };
    window.clearTimeout = function () {};
  `, sandbox);
  ['util.js', 'dre-gerencial.js', 'dados.js', 'store.js', 'persistencia.js', 'dados-remoto.js']
    .forEach(function (a) {
      vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js', a), 'utf8'), sandbox, { filename: a });
    });
  return sandbox.ERP;
}

(async function () {
  console.log('subindo um Postgres só para esta prova…');
  subirBanco();
  const pg = new Client({ host: DIR, port: PORTA, user: 'postgres', database: 'postgres' });
  await pg.connect();

  /* O andaime que o Supabase já traz pronto e o 01-schema.sql supõe
     existir: o schema `auth` com a tabela de login, os três papéis e
     a função auth.uid(). Sem isto o schema real nem cria as tabelas.
     Nada aqui é regra de negócio — é só o chão do Supabase. */
  await pg.query(`
    create schema if not exists auth;
    create table if not exists auth.users (
      id uuid primary key default gen_random_uuid(),
      email text unique
    );
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='authenticated')
        then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname='anon')
        then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname='service_role')
        then create role service_role; end if;
    end $$;
    create or replace function auth.uid() returns uuid language sql stable as
      $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  `);

  /* O SCHEMA DE VERDADE, na ordem em que é aplicado no Supabase —
     TODAS as migrações, não um punhado escolhido a dedo. O banco do
     Henrique é a soma de todas elas; aplicar só algumas produz uma
     tabela que não existe em lugar nenhum, e foi assim que a coluna
     `eventos.app_id` apareceu faltando numa prova que deveria
     justamente medir se o sistema grava. */
  const sqls = fs.readdirSync(path.join(RAIZ, 'supabase'))
    .filter(n => /^\d+-.*\.sql$/.test(n))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  for (const s of sqls) {
    const texto = fs.readFileSync(path.join(RAIZ, 'supabase', s), 'utf8');
    try { await pg.query(texto); } catch (e) {
      /* O schema completo traz políticas e funções que dependem do
         Supabase; o que interessa aqui são as TABELAS. */
      console.log('   (' + s + ': ' + String(e.message).slice(0, 70) + ')');
    }
  }
  const temTabela = await pg.query(
    "select count(*)::int n from information_schema.tables where table_name='funcionarios'");
  confere('o schema real subiu no banco da prova', temTabela.rows[0].n === 1, '');
  if (temTabela.rows[0].n !== 1) {
    await pg.end(); derrubarBanco();
    console.log('\n1 FALHA(S): sem a tabela não há o que provar');
    process.exit(1);
  }

  const cols = (await pg.query(
    "select column_name from information_schema.columns where table_name='funcionarios'"))
    .rows.map(r => r.column_name);

  /* ── 4. a trava de esquema: o que o sistema grava existe? ── */
  const ERP = montarERP();
  const S = ERP.store, D = ERP.dados;
  S.init();
  const listaCols = (function () {
    const p = fs.readFileSync(path.join(RAIZ, 'js', 'persistencia.js'), 'utf8');
    /* Mesma leitura que a varredura-colunas faz: tira comentários e
       recolhe os nomes. JSON.parse não serve — a lista tem comentário
       no meio dela, que é documentação legítima do código. */
    const i = p.indexOf('const COLUNAS_FUNCIONARIO');
    const trecho = p.slice(i, p.indexOf('];', i)).replace(/\/\*[\s\S]*?\*\//g, '');
    const cols = [];
    trecho.replace(/'([a-z_0-9]+)'/g, function (_, c) { cols.push(c); return _; });
    return cols;
  })();
  const semColuna = listaCols.filter(c => cols.indexOf(c) < 0);
  confere('toda coluna que o sistema grava existe na tabela real',
    semColuna.length === 0, semColuna.join(', ') || String(listaCols.length) + ' colunas');

  /* ── 5. O CICLO INTEIRO: editar → gravar → recarregar ── */
  const registro = { upserts: [], erros: [] };
  const cliente = clienteSobrePostgres(pg, registro);
  ERP.auth = { cliente: () => cliente, sessao: () => ({ usuario: { id: 'u5' } }) };

  const adm = (D.usuarios || []).find(u => u.perfil === 'admin');
  if (adm) S.setUsuario(adm.id);

  /* O usuário que assina a trilha precisa existir no banco: a tabela
     `eventos` tem chave estrangeira para `usuarios`, e sem a linha a
     trilha não grava — o que esconderia justamente o que esta prova
     quer medir. É o mesmo id que a sessão usa aqui. */
  await pg.query(`insert into perfis (id, nome) values ('admin','Administrador')
                  on conflict (id) do nothing`);
  await pg.query(`insert into usuarios (id, nome, perfil) values ($1,'PROVA','admin')
                  on conflict (id) do nothing`, [S.usuario() ? S.usuario().id : 'u5']);

  /* Um funcionário no banco, como a pessoa do DP deixaria. */
  await pg.query(`insert into cargos (id, nome) values ('cg1','Analista') on conflict do nothing`);
  await pg.query(`insert into empresas (id, apelido, nome, cnpj) values ('e1','M','Matriz','1')
                  on conflict do nothing`);
  await pg.query(`insert into centros (id, curto, codigo, nome, tipo, empresa)
                  values ('c1','MAT','001','Matriz','matriz','e1') on conflict do nothing`);
  await pg.query(`insert into funcionarios
      (id, matricula, nome, cpf, admissao, salario_base, cargo, centro,
       vale_refeicao, vr_dia, vale_transporte, vt_dia, ativo)
      values ('fx1','9001','TESTE DA SILVA','99988877766','2026-01-02',3000,'cg1','c1',
              true, 400, true, 20, true)
      on conflict (id) do nothing`);

  /* Carrega como o sistema carrega NO LOGIN, pelo caminho de
     verdade: é `carregar()` que acende `ligado` e que tira as duas
     sombras (a das coleções e a dos funcionários). Sem passar por
     aqui, a prova mediria um sistema que nunca existiu. */
  await ERP.persistencia.carregar();
  const aviso = await ERP.dadosRemoto.funcionarios();
  confere('o sistema leu o funcionário do banco', !aviso && D.funcionarios.length > 0,
    aviso || D.funcionarios.length + ' funcionário(s)');
  const antes = D.funcionario('fx1');
  confere('e ele chegou sem modo de vale definido (como a Carol cadastrou)',
    !!antes && !antes.vr_modo, antes ? JSON.stringify(antes.vr_modo) : 'não achei');

  /* A EDIÇÃO, pelo caminho que a tela usa. */
  const r = S.editarFuncionario('fx1', { vr_modo: 'mes', vt_modo: 'mes' });
  confere('a edição foi aceita pelo sistema', !!(r && r.ok), (r || {}).erro || 'ok');
  confere('e o sistema registrou que ALGO mudou (vira trilha)',
    (S.st.eventos || []).some(e => e.entidade === 'funcionario' && e.entidade_id === 'fx1'),
    (S.st.eventos || []).filter(e => e.entidade === 'funcionario').length + ' evento(s)');

  /* A GRAVAÇÃO, pelo caminho que o sistema usa sozinho.

     Sem fallback para uma função vazia: se o nome mudar, esta prova
     tem de QUEBRAR, não passar medindo o nada. Era justamente esse
     tipo de silêncio que deixou o defeito passar três vezes. */
  if (typeof ERP.persistencia.sincronizar !== 'function') {
    throw new Error('ERP.persistencia.sincronizar não existe — a prova está medindo outra coisa');
  }
  /* `ligado` só fica true depois de `iniciar()`. Se ele estiver
     false, sincronizar devolve na primeira linha e NADA é gravado —
     o que daria exatamente o mesmo sintoma que estou investigando.
     Então isto é conferido ANTES, separado, para não confundir as
     duas causas. */
  confere('a persistência está ligada (senão o resto não mede nada)',
    ERP.persistencia.ligado(), String(ERP.persistencia.ligado()));

  const falhaSync = await ERP.persistencia.sincronizar();
  confere('a gravação não devolveu erro', !registro.erros.length,
    registro.erros.slice(0, 2).join(' · ') || 'sem erro');
  confere('e ela de fato mandou funcionários ao banco',
    registro.upserts.some(u => u.tabela === 'funcionarios'),
    registro.upserts.map(u => u.tabela).join(', ') || 'nenhum upsert');

  /* O QUE ESTÁ NO BANCO, não o que o sistema acha. */
  /* Destravar a gravação não pode virar gravação sem fim. Gravado o
     que havia, a próxima sincronização tem de não ter o que mandar —
     senão o sistema ficaria reenviando o mesmo funcionário a cada
     ciclo, o que num banco grande e com movimento é justamente o
     risco que o Henrique levantou. */
  const upsertsAteAqui = registro.upserts.length;
  await ERP.persistencia.sincronizar();
  confere('gravado uma vez, a sincronização seguinte não reenvia nada',
    registro.upserts.length === upsertsAteAqui,
    upsertsAteAqui + ' -> ' + registro.upserts.length);

  const noBanco = (await pg.query("select vr_modo, vt_modo, extra from funcionarios where id='fx1'")).rows[0];
  confere('O MODO DO VALE CHEGOU À COLUNA DO BANCO',
    noBanco && noBanco.vr_modo === 'mes',
    'vr_modo=' + JSON.stringify(noBanco && noBanco.vr_modo) +
    ' · extra=' + JSON.stringify(noBanco && noBanco.extra));
  confere('e o do transporte também',
    noBanco && noBanco.vt_modo === 'mes', 'vt_modo=' + JSON.stringify(noBanco && noBanco.vt_modo));

  /* A VOLTA: recarrega do zero, como no login do dia seguinte. */
  D.funcionarios.length = 0;
  await ERP.dadosRemoto.funcionarios();
  const depois = D.funcionario('fx1');
  confere('NO DIA SEGUINTE, o sistema lê o modo de volta',
    !!depois && depois.vr_modo === 'mes',
    depois ? 'vr_modo=' + JSON.stringify(depois.vr_modo) : 'não achei');

  /* E o número que a pessoa vê. */
  const h = S.calcularHolerite('fx1', ERP.util.mesAtual());
  confere('e o custo do VR é o valor fixo, não vinte e um vezes ele',
    Math.abs(h.vr_custo_empresa - 400) < 0.02, ERP.util.brl(h.vr_custo_empresa));

  await pg.end();
  derrubarBanco();
  console.log('\n' + (falhas.length ? falhas.length + ' FALHA(S): ' + falhas.join(' | ') : 'tudo passou'));
  process.exit(falhas.length ? 1 : 0);
})().catch(function (e) {
  console.error('erro na prova:', e && e.message);
  try { derrubarBanco(); } catch (x) {}
  process.exit(1);
});
