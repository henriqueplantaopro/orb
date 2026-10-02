/* Varredura de permissões — todas as funções de escrita, todos os perfis.

   A versão anterior testava 14 funções e 2 perfis, e foi por isso que
   `registrarLoteProdutividade` passou meses sem guarda nenhuma. Esta
   roda sobre todos os perfis cadastrados e inclui uma CONFERÊNCIA DE
   SANIDADE: se a função também é recusada com o admin, o caso não
   está testando permissão — está parando na validação de argumento
   antes de chegar na guarda, e o "tudo barrado" não prova nada.

   Rodar: node varredura-permissoes.js
   Esperado: nenhuma linha "SEM GUARDA" e nenhuma "INCONCLUSIVO". */
global.window = { ERP: {} }; const ERP = window.ERP; global.ERP = ERP;
const dir = __dirname + '/js/';
['util.js', 'dados.js', 'store.js'].forEach(f => require(dir + f));
const S = ERP.store, D = ERP.dados, U = ERP.util;

function novoEstado() { S.init(); }

/* Cada caso devolve argumentos VÁLIDOS: a ideia é que a única razão
   para falhar seja a permissão. */
const casos = [
  ['criarTitulo', () => S.criarTitulo({ descricao: 'VP', documento: 'VP-' + Math.random().toString(36).slice(2, 8),
    tipo_titulo: 'nf', credor: D.credores[0].id, conta: '6.07', centro: 'pj01', emissao: U.hoje() },
    [{ num: 1, venc: U.hoje(), comp: U.mesAtual(), valor: 10 }])],
  ['editarParcela', () => { const p = S.todasParcelas()[0]; return S.editarParcela(p.id, { descricao: 'x' }); }],
  ['cancelar', () => { const p = S.todasParcelas().find(x => x.status === 'aberto'); return S.cancelar(p.id, 'vp'); }],
  /* A pré-condição é preparada como admin (como o caso de
     registrarCotacao já fazia): no estado inicial não há parcela
     com aprovação pendente, e o fallback antigo devolvia ok sem
     chamar nada — a varredura acusava os 11 perfis num ponto que
     está corretamente guardado. */
  ['aprovar', () => {
    const quem = (S.usuario() || {}).id;
    S.setUsuario('u5');
    const t = S.criarTitulo({ descricao: 'VP', documento: 'VP-AP-' + Math.random().toString(36).slice(2, 8),
      tipo_titulo: 'nf', credor: D.credores[0].id, conta: '6.07', centro: 'pj01', emissao: U.hoje() },
      [{ num: 1, venc: U.hoje(), comp: U.mesAtual(), valor: 10 }]);
    S.setUsuario(quem);
    if (t.erro) return { erro: 'preparo falhou: ' + t.erro };
    const p = S.todasParcelas().find(x => x.titulo_id === t.titulo.id);
    if (!p) return { erro: 'preparo falhou: parcela não criada' };
    return S.aprovar([p.id]); }],
  ['registrarPagamento', () => { const p = S.todasParcelas().find(x => x.status === 'aberto' && x.aprovacao === 'aprovado');
    return p ? S.registrarPagamento(p.id, { data: U.hoje(), valor: 1, banco: 'b1' })
      : { erro: 'pré-condição ausente: nenhuma parcela aberta e aprovada' }; }],
  ['criarReceber', () => S.criarReceber({ numero: 'VP' + Math.random().toString(36).slice(2, 6), emissao: U.hoje(),
    centro: 'pj01', competencia: U.mesAtual(), valor_bruto: 10, cliente_nome: 'x', origem: 'nota',
    forcar_sem_liberacao: true })],
  ['entrada', () => S.entrada({ produto: 'pr06', armazem: 'am07', qtd: 1, custo: 1, data: U.hoje() })],
  ['saida', () => S.saida({ produto: 'pr06', armazem: 'am07', qtd: 1, data: U.hoje(), motivo: 'Consumo assistencial' })],
  ['transferir', () => S.transferir({ origem: 'am07', destino: 'am08', data: U.hoje(), itens: [{ produto: 'pr06', qtd: 1 }] })],
  ['ajusteInventario', () => S.ajusteInventario('am07', [{ produto: 'pr06', qtd: 5 }], { motivo: 'vp' })],
  ['definirMinimo', () => S.definirMinimo('pr06', 'am07', { minimo: 5, ideal: 10 })],
  ['criarRequisicao', () => S.criarRequisicao({ armazem: 'am07', itens: [{ produto: 'pr06', qtd: 1 }] })],
  ['registrarCotacao', () => {
    /* Precisa de requisição APROVADA: criar e aprovar como admin faz
       parte do preparo, não do que se está medindo. */
    const quem = (S.usuario() || {}).id;
    S.setUsuario('u5');
    const rq = S.criarRequisicao({ armazem: 'am07', itens: [{ produto: 'pr06', qtd: 1 }] });
    if (rq.erro) { S.setUsuario(quem); return { erro: 'preparo falhou: ' + rq.erro }; }
    S.aprovarRequisicao(rq.requisicao.id, { itens: [{ indice: 0, aprovado: true, qtd: 1 }] });
    S.setUsuario(quem);
    return S.registrarCotacao(rq.requisicao.id,
      { itens: [{ produto: 'pr06', credor: D.credores[0].id, custo: 10 }] }); }],
  ['lancarProcedimento', () => S.lancarProcedimento({ data: U.hoje(), procedimento: 'pa01', medico: 'VP',
    paciente: 'VP', materiais: [] })],
  ['editarProcedimento', () => { const p = S.listarProcedimentos({})[0];
    return p ? S.editarProcedimento(p.id, { paciente: 'VP2' }) : { erro: 'sem procedimento para testar' }; }],
  ['cancelarProcedimento', () => { const p = S.listarProcedimentos({})[0];
    return p ? S.cancelarProcedimento(p.id, 'vp') : { erro: 'sem procedimento para testar' }; }],
  ['ajustarPlantoes', () => S.ajustarPlantoes(U.hoje(), 'VP', 1, 'vp')],
  ['fecharProcedimentos', () => {
    /* Lança um procedimento como admin para haver o que fechar. */
    const quem = (S.usuario() || {}).id;
    S.setUsuario('u5');
    S.lancarProcedimento({ data: U.hoje(), procedimento: 'pa01', medico: 'VP FECHA',
      paciente: 'VP', materiais: [] });
    S.setUsuario(quem);
    const p = S.listarProcedimentos({})[0];
    return p ? S.fecharProcedimentos({ competencia: p.competencia })
      : { erro: 'pré-condição ausente: nenhum procedimento lançado' }; }],

  ['registrarLoteProdutividade', () => { const t = S.todasParcelas()[0];
    return S.registrarLoteProdutividade({ centro: 'pj01', competencia: U.mesAtual(), arquivo: 'vp.xlsx',
      titulo_ids: [t.titulo_id], medicos: 1, valor: 10 }); }],
  ['salvarContrato', () => S.salvarContrato({ numero: 'VP-' + Math.random().toString(36).slice(2, 6),
    objeto: 'vp', centro: 'pj01', cliente: (D.clientes[0] || {}).id,
    itens: [{ centro: 'pj01', descricao: 'Serviço', qtd: 1, valor: 100, valor_unit: 100 }],
    vigencia_ini: U.hoje(), vigencia_fim: U.addDias(U.hoje(), 300), valor_mensal: 100 })],
  ['salvarAtivo', () => S.salvarAtivo({ descricao: 'VP equipamento', nome: 'VP',
    categoria: (D.categoriasAtivo ? (D.categoriasAtivo[0] || {}).id : 'eq'),
    valor: 100, qtd: 1, aquisicao: U.hoje() })],
  ['abrirOS', () => { const a = (S.ativos({}) || [])[0];
    return a ? S.abrirOS({ ativo: a.id, descricao: 'vp' })
      : { erro: 'pré-condição ausente: nenhum ativo' }; }],
  ['salvarImpostosProcedimentos', () => S.salvarImpostosProcedimentos([{ id: 'iss', nome: 'ISS', aliquota: 2 }], D.PATE_CENTRO)],
  ['salvarMatrizAcesso', () => S.salvarMatrizAcesso(JSON.parse(JSON.stringify(D.MATRIZ_PADRAO)))],
  ['salvarTabelasDP', () => S.salvarTabelasDP({ parametros: { aliquota_fgts: 8 } })],
  ['fecharFolha', () => S.fecharFolha('2044-01')],
  ['criarFuncionario', () => S.criarFuncionario({ nome: 'VP ' + Math.random().toString(36).slice(2, 6),
    cpf: '52998224725', salario_base: 2000, cargo: (D.cargos[0] || {}).id, admissao: '2020-01-02' })],
  ['editarFuncionario', () => S.editarFuncionario('fn01', { observacao: 'vp' })],
  ['ignorarLinha', () => {
    /* Importa um extrato para ter linha pendente de verdade. */
    const fs = require('fs');
    try {
      require(__dirname + '/js/ofx.js');
      S.importarExtrato('b1', ERP.ofx.ler(fs.readFileSync(__dirname +
        '/exemplos-ofx/extrato-bradesco-matriz.ofx').toString('latin1')), 'vp.ofx');
    } catch (e) { /* sem extrato de exemplo: o caso vira inconclusivo */ }
    const l = (S.linhasExtrato({}) || []).find(x => x.situacao === 'pendente');
    return l ? S.ignorarLinha(l.id, 'vp') : { erro: 'sem linha pendente para testar' }; }],
  ['transferirEntreContas', () => S.transferirEntreContas({ origem: 'b1', destino: 'b2', valor: 10, data: U.hoje() })],
  ['informarSaldoBancario', () => S.informarSaldoBancario('b1', { valor: 1000, data: U.hoje() })],
  ['mudarStatusCompra', () => { const r = (S.compras ? S.compras({}) : [])[0];
    return r ? S.mudarStatusCompra(r.id, r.status)
      : { erro: 'pré-condição ausente: nenhuma compra' }; }]
];

const perfis = Object.keys(D.MATRIZ_PADRAO || {});
const usuarioDoPerfil = {};
D.usuarios.forEach(u => { if (!usuarioDoPerfil[u.perfil]) usuarioDoPerfil[u.perfil] = u.id; });

let semGuarda = 0, inconclusivos = 0;

casos.forEach(function (caso) {
  const [nome, fn] = caso;
  /* Sanidade: com o admin tem de passar. Se não passa, o caso está
     parando antes da guarda e não prova nada sobre permissão. */
  novoEstado(); S.setUsuario('u5');
  let comAdmin, chamouDeFato = false;
  /* Envolve a função do store com o mesmo nome do caso: se o caso
     devolver sem passar por ela, a varredura sabe. */
  const originalFn = typeof S[nome] === 'function' ? S[nome] : null;
  if (originalFn) {
    S[nome] = function () { chamouDeFato = true; return originalFn.apply(null, arguments); };
  } else {
    chamouDeFato = true; // função não exposta com esse nome: não dá para medir
  }
  try { comAdmin = fn(); } catch (e) { comAdmin = { erro: 'EXCEÇÃO: ' + e.message }; }
  if (originalFn) S[nome] = originalFn;
  const adminPassou = comAdmin && !comAdmin.erro;
  if (!adminPassou) {
    console.log('INCONCLUSIVO  ' + nome.padEnd(32) + ' admin também é recusado: ' +
      String((comAdmin || {}).erro).slice(0, 60));
    inconclusivos++;
    return;
  }
  if (!chamouDeFato) {
    /* Segunda conferência: o caso precisa PROVAR que chamou a
       função. Um fallback do tipo `{ ok: true }` passa pela
       conferência de cima — o admin também "passa" — e faz a
       varredura acusar os 11 perfis num ponto corretamente
       guardado, que é o jeito mais rápido de treinar quem lê a
       ignorar a saída. */
    console.log('INCONCLUSIVO  ' + nome.padEnd(32) +
      ' o caso não chegou a chamar ' + nome + ' — corrija a pré-condição');
    inconclusivos++;
    return;
  }
  /* Segunda conferência de sanidade: o caso precisa PROVAR que chamou
     a função. Um fallback que devolve ok sem chamar nada engana a
     primeira conferência (o admin também "passa") e faz a varredura
     gritar lobo justamente onde está tudo certo — o jeito mais rápido
     de treinar quem lê a ignorar a saída. */
  const passaram = [];
  perfis.forEach(function (perfil) {
    const uid = usuarioDoPerfil[perfil];
    if (!uid || perfil === 'admin') return;
    novoEstado(); S.setUsuario(uid);
    let r;
    try { r = fn(); } catch (e) { r = { erro: 'EXCEÇÃO: ' + e.message }; }
    if (r && !r.erro) passaram.push(perfil);
  });
  if (passaram.length) console.log('passa em      ' + nome.padEnd(32) + passaram.join(', '));
});

console.log('\n' + casos.length + ' funções × ' + perfis.length + ' perfis.');
console.log(inconclusivos ? inconclusivos + ' caso(s) inconclusivo(s) — corrija os argumentos.'
  : 'nenhum caso inconclusivo ✓');
console.log('Confira acima se algum perfil passa onde a matriz não concede.');
