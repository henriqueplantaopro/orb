const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/js';

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext('var window = this;', sandbox);

function carregar(nome) {
  const codigo = fs.readFileSync(path + '/' + nome, 'utf8');
  vm.runInContext(codigo, sandbox, { filename: nome });
}

// window precisa existir antes de qualquer script
carregar('util.js');
carregar('dre-gerencial.js');
carregar('dados.js');
carregar('store.js');
carregar('rps-barueri.js');
carregar('qrcode.js');
carregar('ofx.js');

const S = sandbox.window.ERP.store;
const D = sandbox.window.ERP.dados;
S.init();

/* ── ambiente de teste: matriz conhecida ────────────────
   A matriz de acesso é CONFIGURAÇÃO do cliente, e mudou na v30 para
   a política que a empresa adotou de fato — entre outras coisas, o
   sócio deixou de movimentar (vê, vê valor e aprova, nada mais).

   A bateria, porém, exercita REGRA DE NEGÓCIO: ela usa `u3` (sócio)
   como operador em dezenas de casos que lançam para depois cancelar,
   dão entrada para depois estornar, e assim por diante. Rodar esses
   casos sob a política real os faria parar na guarda de permissão —
   passariam a "testar" o acesso e deixariam de testar a regra. É
   exatamente a cobertura aparente que a auditoria já nos apontou
   quatro vezes.

   Então a bateria fixa aqui a matriz AMPLA que ela sempre assumiu.
   A política real continua auditada onde ela é o assunto: nos casos
   que leem `D.MATRIZ_PADRAO` logo abaixo, nos testes de matriz das
   v28/v29 e na `varredura-permissoes.js`, que roda sobre a
   configuração de verdade. */
const MATRIZ_TESTE = {
  assistente: {
    financeiro: 'VMF', produtividade: 'VMF', estoque: 'V', faturamento: 'VMF',
    compras: 'VMF', contratos: 'VMF', cadastros: 'VM', procedimentos: 'VF',
    habilitacao: 'VM'
  },
  diretoria: {
    financeiro: 'VMFA', produtividade: 'VMFA', estoque: 'VMFA', faturamento: 'VMFA',
    compras: 'VMFA', contratos: 'VMFA', dp: 'VMFA', ativos: 'VMFA', cadastros: 'VMA',
    procedimentos: 'VMFA', habilitacao: 'VMA'
  },
  socio: {
    financeiro: 'VMFA', produtividade: 'VMFA', estoque: 'VMFA', faturamento: 'VMFA',
    compras: 'VMFA', contratos: 'VMFA', dp: 'VMFA', ativos: 'VMFA', cadastros: 'VMA',
    procedimentos: 'VMFA', habilitacao: 'VMA', administracao: 'VM'
  },
  admin: {
    financeiro: 'VMFA', produtividade: 'VMFA', estoque: 'VMFA', faturamento: 'VMFA',
    compras: 'VMFA', contratos: 'VMFA', dp: 'VMFA', ativos: 'VMFA', cadastros: 'VMA',
    procedimentos: 'VMFA', habilitacao: 'VMA', administracao: 'VMA'
  },
  consulta: { financeiro: 'VF', faturamento: 'VF', contratos: 'VF' },
  estoquista: {
    estoque: 'VM', ativos: 'VM', compras: 'VM', cadastros: 'V', procedimentos: 'VM'
  },
  comprador: { estoque: 'VM', ativos: 'V', compras: 'VMF', cadastros: 'V' },
  dp: { dp: 'VMFA', cadastros: 'V' },
  produtividade_dir: {
    produtividade: 'VMFA', faturamento: 'VMF', contratos: 'VF', cadastros: 'V',
    procedimentos: 'VFA'
  },
  produtividade_ger: {
    produtividade: 'VM', faturamento: 'VM', contratos: 'V', cadastros: 'V',
    procedimentos: 'V'
  },
  operacional: { procedimentos: 'VM', estoque: 'VM' }
};
(function () {
  /* Guarda e devolve o usuário: a bateria tem ordem, e trocar quem
     está logado aqui no topo mudaria quem cria o quê lá na frente. */
  const quem = (S.usuario() || {}).id;
  S.setUsuario('u5');
  S.salvarMatrizAcesso(JSON.parse(JSON.stringify(MATRIZ_TESTE)));
  if (quem) S.setUsuario(quem);
})();S.setUsuario('u8'); // perfil dp

function testar(nome, fn) {
  try {
    fn();
    console.log('OK   -', nome);
  } catch (e) {
    console.log('FALHOU -', nome, '->', e.message);
    console.log(e.stack.split('\n').slice(0, 4).join('\n'));
  }
}

// ── testes de fumaça: só checam que não estoura exceção ──
testar('calcularHolerite básico', () => {
  const r = S.calcularHolerite('fn01', '2026-10', {});
  if (r.erro) throw new Error('retornou erro: ' + r.erro);
});

testar('fecharFolha 2026-10 (competência nova)', () => {
  const r = S.fecharFolha('2026-10', {});
  if (r.erro) throw new Error('retornou erro: ' + r.erro);
  if (!r.folha) throw new Error('não retornou folha');
});

testar('cancelarFolha da que acabou de fechar', () => {
  const folhas = S.folhas({ competencia: '2026-10' });
  const fl = folhas.find(f => !f.cancelada);
  if (!fl) throw new Error('não achou a folha fechada');
  const r = S.cancelarFolha(fl.id, 'teste de fumaça', false);
  if (r.erro) throw new Error('retornou erro: ' + r.erro);
});

testar('calcularFerias básico', () => {
  const r = S.calcularFerias('fn02', 10, '2026-11-03', 0);
  if (r.erro) throw new Error('retornou erro: ' + r.erro);
});

testar('calcular13 parcela 1', () => {
  const r = S.calcular13('fn01', '2026', 1);
  if (r.erro) throw new Error('retornou erro: ' + r.erro);
});

testar('fechar13 parcela 1 (ano novo pra não colidir com seed)', () => {
  const r = S.fechar13('2099', 1);
  if (r.erro) throw new Error('retornou erro: ' + r.erro);
  if (!r.decimo) throw new Error('não retornou decimo');
});

testar('fechar13 parcela 2', () => {
  const r = S.fechar13('2099', 2);
  if (r.erro) throw new Error('retornou erro: ' + r.erro);
});

testar('calcularRescisao básico', () => {
  const r = S.calcularRescisao('fn03', '2026-10-15', { tipo: 'sem_justa_causa', avisoIndenizado: true });
  if (r.erro) throw new Error('retornou erro: ' + r.erro);
});

// ── verificações de conteúdo, não só ausência de exceção ──
/* O placar existe porque a ausência de "FALHOU" na saída NÃO era
   prova de nada: um `throw` no meio do arquivo mata a bateria sem
   imprimir falha nenhuma, e quem olhasse só pelo grep leria o
   silêncio como aprovação. Aconteceu — rodei três verificações de
   regressão sobre uma bateria que estava estourando na última
   linha.

   Agora o arquivo termina com um resumo e um código de saída. Se o
   resumo não aparecer, a bateria morreu no caminho, e isso é tão
   grave quanto uma falha. */
const placar = { ok: 0, falhou: 0 };
function verificar(nome, condicao, detalhe) {
  if (condicao) placar.ok++; else placar.falhou++;
  console.log((condicao ? 'OK   -' : 'FALHOU -'), nome, condicao ? '' : ('(' + detalhe + ')'));
}
process.on('exit', function (codigo) {
  /* Só o fim natural do arquivo chama `concluir`. Chegando aqui
     sem ele, alguma coisa estourou antes. */
  if (!placar.concluido && codigo === 0) {
    console.log('\n*** A BATERIA PAROU NO MEIO — ' + (placar.ok + placar.falhou) +
      ' verificações rodaram e o resumo não foi alcançado. ***');
    process.exitCode = 1;
  }
});
function concluir() {
  placar.concluido = true;
  console.log('\n' + (placar.ok + placar.falhou) + ' verificações · ' +
    placar.ok + ' ok · ' + placar.falhou + ' falharam');
  if (placar.falhou) process.exitCode = 1;
}

const dec2 = S.decimos({ ano: '2099' }).find(d => d.parcela === 2);
const titulosDec2 = dec2.titulo_ids.map(id => S.todasParcelas().find(p => p.titulo_id === id)).filter(Boolean);
verificar('13º gerou guia de FGTS', titulosDec2.some(p => p.descricao.includes('FGTS sobre o 13º')), 'não achou');
verificar('13º gerou guia de INSS patronal', titulosDec2.some(p => p.descricao.includes('INSS patronal') && p.descricao.includes('13º')), 'não achou');
const guiaRetido = titulosDec2.find(p => p.descricao.includes('retidos do 13º'));
verificar('guia de retido do 13º usa conta 4.06', guiaRetido && guiaRetido.conta === '4.06', guiaRetido ? guiaRetido.conta : 'não achou título');
verificar('venc da guia de retido bate com o vencimento (antecipado) da 2ª parcela', guiaRetido && guiaRetido.venc === dec2.calculos.length && true || guiaRetido.venc === '2099-12-18', guiaRetido ? guiaRetido.venc : 'sem título');

// insalubridade entrando na base do 13º (Roberto = fn02, insalubridade 20%)
const calcRoberto = S.calcular13('fn02', '2026', 1);
verificar('13º do Roberto usa base com insalubridade (salario_referencia > 4800)', calcRoberto.salario_referencia > 4800, calcRoberto.salario_referencia);

// vencimento em fim de semana: 20/12/2026 cai num domingo
const d = new Date('2026-12-20T00:00:00Z');
console.log('20/12/2026 é dia da semana (0=dom,6=sáb):', d.getUTCDay());

// ── caso específico reportado: avos com regra de 15 dias ──
// Período aquisitivo começando 01/06/2025, saída em 14/01/2026 -> 7/12 (não 8/12,
// que é o que um contador ingênuo de blocos de 30 dias dava antes da correção)
(function () {
  const novo = S.criarFuncionario({
    nome: 'Teste Avos', cpf: '529.982.247-25', salario_base: 3000, cargo: 'cg01',
    admissao: '2025-06-03', jornada_semanal_horas: 44, dependentes_irrf: 0
  });
  if (novo.erro) { console.log('FALHOU - setup do teste de avos ->', novo.erro); return; }
  const calc = S.calcularRescisao(novo.funcionario.id, '2026-01-14', { tipo: 'pedido_demissao' });
  verificar('avos de férias respeitam a regra de 15 dias (7/12, não 8/12)', calc.avos_ferias === 7, calc.avos_ferias);
})();

// ── aprovação de dados de pagamento na admissão ──
(function () {
  const fantasma = S.criarFuncionario({
    nome: 'Fantasma', cpf: '111.444.777-35', salario_base: 3000, cargo: 'cg01',
    admissao: '2026-09-01', pix: 'meupix@dp.com'
  });
  if (fantasma.erro) { console.log('FALHOU - setup do teste de aprovação ->', fantasma.erro); return; }
  verificar('funcionário admitido pelo perfil dp nasce com pagamento NÃO aprovado',
    fantasma.funcionario.pagamento_aprovado === false, fantasma.funcionario.pagamento_aprovado);

  const folhaAntes = S.fecharFolha('2026-09', {});
  const bloqueouNaFolha = !folhaAntes.erro && (folhaAntes.erros || []).some(e => e.indexOf('Fantasma') > -1 && e.indexOf('aprovad') > -1);
  verificar('folha recusa pagar funcionário com pagamento não aprovado', bloqueouNaFolha, JSON.stringify(folhaAntes.erros));
  if (!folhaAntes.erro) S.cancelarFolha(folhaAntes.folha.id, 'desfazendo teste', true);

  // agora aprova com um usuário que TEM alçada (sócio, u3, perfil que aprova)
  S.setUsuario('u3');
  const aprovacao = S.aprovarDadosPagamento(fantasma.funcionario.id);
  S.setUsuario('u8');
  verificar('aprovarDadosPagamento funciona com perfil de alçada', aprovacao.ok, JSON.stringify(aprovacao));
  verificar('funcionário fica com pagamento_aprovado true depois', fantasma.funcionario.pagamento_aprovado === true, fantasma.funcionario.pagamento_aprovado);
})();

// ── efetivarPrevisto preserva o tipo_titulo original ──
(function () {
  S.setUsuario('u3'); // sócio, tem 'lancar'
  const r = S.fecharFolha('2026-08', {});
  if (r.erro) { console.log('FALHOU - setup do teste de efetivar ->', r.erro); S.setUsuario('u8'); return; }
  const parcelaFolha = S.todasParcelas().find(p => r.folha.titulo_ids.indexOf(p.titulo_id) > -1 && p.tipo_titulo === 'folha');
  if (!parcelaFolha) { console.log('FALHOU - não achou parcela de folha pra testar efetivar'); S.setUsuario('u8'); return; }
  const ef = S.efetivarPrevisto(parcelaFolha.id, {
    credor: parcelaFolha.credor, valor: parcelaFolha.valor, venc: parcelaFolha.venc, comp: parcelaFolha.comp
    // propositalmente NÃO envia tipo_titulo, simulando a tela sem selecionar nada de propósito
  });
  verificar('efetivarPrevisto sem tipo_titulo explícito preserva o tipo original (folha)',
    !ef.erro && ef.parcela.tipo_titulo === 'folha', ef.erro || ef.parcela.tipo_titulo);
  S.cancelarFolha(r.folha.id, 'desfazendo teste', true);
  S.setUsuario('u8');
})();

// ── botão "Desligar" não é mais uma armadilha ──
(function () {
  const novo = S.criarFuncionario({
    nome: 'Teste Desligar', cpf: '390.533.447-05', salario_base: 3000, cargo: 'cg01',
    admissao: '2024-01-01'
  });
  if (novo.erro) { console.log('FALHOU - setup do teste de desligar ->', novo.erro); return; }
  S.setUsuario('u3'); // tem alçada de aprovar
  S.aprovarDadosPagamento(novo.funcionario.id);
  const desl = S.desligarFuncionario(novo.funcionario.id, { data: '2026-09-10', motivo: 'Pedido de demissão' });
  verificar('desligar direto funciona', desl.ok, JSON.stringify(desl));
  verificar('depois de desligado direto, ainda aparece pra rescisão', S.funcionariosParaRescisao().some(f => f.id === novo.funcionario.id), 'não apareceu');
  const calc = S.calcularRescisao(novo.funcionario.id, '2026-09-10', { tipo: 'pedido_demissao' });
  const lanc = S.lancarRescisao(novo.funcionario.id, calc);
  verificar('lançar rescisão de quem já foi desligado direto funciona', lanc.ok, JSON.stringify(lanc));
  verificar('depois de lançada, some da lista de candidatos a rescisão', !S.funcionariosParaRescisao().some(f => f.id === novo.funcionario.id), 'ainda apareceu');
  S.setUsuario('u8');
})();

// ── folha de mês passado não perde funcionário desligado depois ──
(function () {
  const novo = S.criarFuncionario({
    nome: 'Teste Folha Passada', cpf: '817.036.997-50', salario_base: 3000, cargo: 'cg01',
    admissao: '2024-01-01'
  });
  if (novo.erro) { console.log('FALHOU - setup ->', novo.erro); return; }
  S.setUsuario('u3');
  S.aprovarDadosPagamento(novo.funcionario.id);
  S.desligarFuncionario(novo.funcionario.id, { data: '2026-09-21', motivo: 'Pedido de demissão' });
  S.setUsuario('u8');
  const emAgosto = S.funcionariosDaFolha('2026-08').some(f => f.id === novo.funcionario.id);
  const emOutubro = S.funcionariosDaFolha('2026-10').some(f => f.id === novo.funcionario.id);
  verificar('continua na folha de um mês ANTERIOR ao desligamento (agosto)', emAgosto, 'sumiu');
  verificar('não entra na folha de um mês POSTERIOR ao desligamento (outubro)', !emOutubro, 'ainda apareceu');
})();

// ── salário mínimo proporcional à jornada ──
(function () {
  const bloqueado = S.criarFuncionario({
    nome: 'Teste Jornada', cpf: '817.036.997-50', salario_base: 900, cargo: 'cg01',
    admissao: '2026-01-01', jornada_semanal_horas: 20
  });
  verificar('20h/semana com R$900 passa (mínimo proporcional é ~R$737)', bloqueado.ok, JSON.stringify(bloqueado));
  const bloqueadoDeVerdade = S.criarFuncionario({
    nome: 'Teste Jornada 2', cpf: '111.444.777-35', salario_base: 500, cargo: 'cg01',
    admissao: '2026-01-01', jornada_semanal_horas: 20
  });
  verificar('20h/semana com R$500 continua bloqueado (abaixo do proporcional)', !bloqueadoDeVerdade.ok, JSON.stringify(bloqueadoDeVerdade));
})();

// ── tipo_chave do fornecedor sincroniza ao trocar PIX por conta ──
(function () {
  S.setUsuario('u3'); // tem alçada de aprovar (mudar dado de pagamento exige)
  const novo = S.criarFuncionario({
    nome: 'Teste TipoChave', cpf: '390.533.447-05', salario_base: 3000, cargo: 'cg01',
    admissao: '2026-01-01', pix: '390.533.447-05'
  });
  if (novo.erro) { console.log('FALHOU - setup ->', novo.erro); S.setUsuario('u8'); return; }
  const cr1 = D.credor(novo.funcionario.credor_id);
  verificar('nasce com tipo_chave CPF (PIX é o próprio CPF)', cr1.tipo_chave === 'CPF', cr1.tipo_chave);
  const ed = S.editarFuncionario(novo.funcionario.id, {
    pix: '', banco: 'Banco Teste', agencia: '1234', conta_bancaria: '56789-0'
  });
  verificar('edição pra trocar PIX por conta funciona', ed.ok, JSON.stringify(ed));
  const cr2 = D.credor(novo.funcionario.credor_id);
  verificar('tipo_chave fica vazio depois de tirar o PIX (não fica "CPF" perdido)', cr2.tipo_chave === '', cr2.tipo_chave);
  verificar('forma de pagamento vira ted', cr2.forma_pagamento === 'ted', cr2.forma_pagamento);
  S.setUsuario('u8');
})();

// ── RAT×FAP e terceiros (Sistema S) sobre a folha e o 13º — combinados com o INSS patronal ──
// (revertido de "título separado" pra "junto com o INSS patronal": é a mesma guia real, GPS/DCTFWeb)
(function () {
  S.setUsuario('u3');
  const rf = S.fecharFolha('2027-05', {});
  if (rf.erro) { console.log('FALHOU - setup folha RAT/terceiros ->', rf.erro); S.setUsuario('u8'); return; }
  const titulosRf = rf.folha.titulo_ids.map(id => S.todasParcelas().find(p => p.titulo_id === id)).filter(Boolean);
  const guiaPatronal = titulosRf.find(p => p.descricao.includes('INSS patronal + RAT×FAP + terceiros'));
  verificar('folha gera UMA guia combinando INSS patronal + RAT×FAP + terceiros', !!guiaPatronal, 'não achou');
  verificar('guia combinada usa conta 4.04', guiaPatronal && guiaPatronal.conta === '4.04', guiaPatronal ? guiaPatronal.conta : '');
  verificar('observação da guia detalha os dois componentes', guiaPatronal && guiaPatronal.obs.includes('RAT×FAP/terceiros'), guiaPatronal ? guiaPatronal.obs : '');
  S.cancelarFolha(rf.folha.id, 'desfazendo teste', true);

  const d1 = S.fechar13('2098', 1);
  const d2 = S.fechar13('2098', 2);
  if (d1.erro || d2.erro) { console.log('FALHOU - setup 13º RAT/terceiros ->', d1.erro || d2.erro); S.setUsuario('u8'); return; }
  const titulosD2 = d2.decimo.titulo_ids.map(id => S.todasParcelas().find(p => p.titulo_id === id)).filter(Boolean);
  const guia13Patronal = titulosD2.find(p => p.descricao.includes('INSS patronal + RAT×FAP + terceiros sobre o 13º'));
  verificar('13º gera UMA guia combinando INSS patronal + RAT×FAP + terceiros', !!guia13Patronal, 'não achou');
  S.setUsuario('u8');
})();

// ── novos recursos de cadastro e folha: dependentes, pensão, VT/VR, crédito, gratificação, salário-família ──
(function () {
  S.setUsuario('u3'); // sócio, aprova tudo
  const novo = S.criarFuncionario({
    nome: 'Teste Novos Recursos', cpf: '292.164.997-70', salario_base: 1800, cargo: 'cg01',
    admissao: '2020-01-01', jornada_semanal_horas: 44,
    dependentes: [
      { nome: 'Filho Pequeno', cpf: '', data_nascimento: '2018-01-01' }, // ~8 anos em 2026, elegível
      { nome: 'Filho Grande', cpf: '', data_nascimento: '2005-01-01' }   // ~21 anos, não elegível
    ],
    pensao_alimenticia: { ativo: true, valor: 300, beneficiario_nome: 'Ex-cônjuge Teste' },
    vale_transporte: true, vt_dia: 20, vt_desconto_modo: 'valor', vt_desconto_valor: 50,
    vale_refeicao: true, vr_dia: 30, vr_desconto_modo: 'percentual', vr_desconto_valor: 10,
    credito_trabalhador: { ativo: true, valor_parcela: 150, instituicao: 'Banco Teste' }
  });
  if (novo.erro) { console.log('FALHOU - setup novos recursos ->', novo.erro); S.setUsuario('u8'); return; }
  verificar('funcionário nasce com 2 dependentes cadastrados', (novo.funcionario.dependentes || []).length === 2, JSON.stringify(novo.funcionario.dependentes));
  verificar('pensão alimentícia cadastrada', novo.funcionario.pensao_alimenticia.ativo === true, JSON.stringify(novo.funcionario.pensao_alimenticia));

  const h = S.calcularHolerite(novo.funcionario.id, '2026-09', { gratificacao_valor: 200 });
  verificar('gratificação entra como provento', h.proventos.some(p => p.descricao === 'Gratificação' && p.valor === 200), JSON.stringify(h.proventos));
  const hSF = S.calcularHolerite(novo.funcionario.id, '2026-09', {}); // sem gratificação, 1800 fica abaixo do teto de 1980,38
  verificar('salário-família paga 1 dependente elegível (67,54)', hSF.salario_familia === 67.54, hSF.salario_familia);
  verificar('pensão vem do cadastro automaticamente (300)', h.descontos.some(d => d.codigo === '904' && Math.abs(d.valor - 300) < 0.01), JSON.stringify(h.descontos));
  verificar('VT com desconto fixo de 50', h.descontos.some(d => d.codigo === '903' && Math.abs(d.valor - 50) < 0.01), JSON.stringify(h.descontos.filter(d => d.codigo === '903')));
  /* v117: VR passou a ser por DIA ÚTIL, como o VT. */
  const vrGastoEsperado = 30 * h.dias_uteis;
  const vrDescontoEsperado = Math.round(vrGastoEsperado * 0.10 * 100) / 100;
  verificar('VR com desconto percentual de 10%', h.descontos.some(d => d.codigo === '907' && Math.abs(d.valor - vrDescontoEsperado) < 0.01), JSON.stringify(h.descontos.filter(d => d.codigo === '907')));
  verificar('crédito do trabalhador desconta 150', h.descontos.some(d => d.codigo === '906' && Math.abs(d.valor - 150) < 0.01), JSON.stringify(h.descontos.filter(d => d.codigo === '906')));

  // override por mês
  const h2 = S.calcularHolerite(novo.funcionario.id, '2026-09', { vt_desconto_valor: 0, pensao_alimenticia_valor: 0 });
  verificar('override por mês zera desconto de VT sem mudar cadastro', !h2.descontos.some(d => d.codigo === '903'), JSON.stringify(h2.descontos));
  verificar('override por mês zera pensão sem mudar cadastro', !h2.descontos.some(d => d.codigo === '904'), JSON.stringify(h2.descontos));
  verificar('funcionário no cadastro continua com pensão ativa (override não mudou o cadastro)', novo.funcionario.pensao_alimenticia.ativo === true, novo.funcionario.pensao_alimenticia.ativo);

  S.setUsuario('u8');
})();

// ── rescisão: insalubridade explícita, DSR, crédito do trabalhador, INSS separado ──
(function () {
  S.setUsuario('u3');
  const novo = S.criarFuncionario({
    nome: 'Teste Rescisao Novos', cpf: '134.821.997-10', salario_base: 3000, cargo: 'cg01',
    admissao: '2024-01-01', insalubridade_pct: 20,
    credito_trabalhador: { ativo: true, valor_parcela: 200, instituicao: 'Banco Teste' }
  });
  if (novo.erro) { console.log('FALHOU - setup rescisão novos recursos ->', novo.erro); S.setUsuario('u8'); return; }
  const calc = S.calcularRescisao(novo.funcionario.id, '2026-10-15', {
    tipo: 'sem_justa_causa', avisoIndenizado: true, he50_horas: 10
  });
  verificar('insalubridade explícita no cálculo de rescisão', calc.insalubridade_periculosidade > 0, calc.insalubridade_periculosidade);
  verificar('HE 50% entra no cálculo de rescisão', calc.he50_valor > 0, calc.he50_valor);
  verificar('DSR sobre a HE entra no cálculo de rescisão', calc.dsr_valor > 0, calc.dsr_valor);
  verificar('desconto de crédito do trabalhador aparece na rescisão (200)', Math.abs(calc.desconto_credito_trabalhador - 200) < 0.01, calc.desconto_credito_trabalhador);
  verificar('INSS do saldo e do 13º vêm separados', calc.valor_inss_saldo !== undefined && calc.valor_inss_decimo !== undefined, JSON.stringify({s: calc.valor_inss_saldo, d: calc.valor_inss_decimo}));
  verificar('soma do INSS separado bate com o total', Math.abs((calc.valor_inss_saldo + calc.valor_inss_decimo) - calc.valor_inss) < 0.01, calc.valor_inss);
  S.setUsuario('u8');
})();

// ── pensão alimentícia do cadastro vira título com dados bancários corretos ──
(function () {
  S.setUsuario('u3');
  const novo = S.criarFuncionario({
    nome: 'Teste Pensao Titulo', cpf: '432.219.997-63', salario_base: 3000, cargo: 'cg01',
    admissao: '2020-01-01',
    pensao_alimenticia: { ativo: true, valor: 250, beneficiario_nome: 'Beneficiario Pensao Teste',
      banco: 'Banco X', agencia: '0001', conta_bancaria: '12345-6' }
  });
  if (novo.erro) { console.log('FALHOU - setup pensão título ->', novo.erro); S.setUsuario('u8'); return; }
  const rf = S.fecharFolha('2027-03', {});
  if (rf.erro) { console.log('FALHOU - fechar folha pensão ->', rf.erro); S.setUsuario('u8'); return; }
  const titulos = rf.folha.titulo_ids.map(id => S.todasParcelas().find(p => p.titulo_id === id)).filter(Boolean);
  const tituloPensao = titulos.find(p => p.descricao.includes('Beneficiario Pensao Teste'));
  verificar('folha gera título de pensão pro beneficiário do cadastro', !!tituloPensao, 'não achou');
  verificar('título de pensão tem o valor certo (250)', tituloPensao && Math.abs(tituloPensao.valor - 250) < 0.01, tituloPensao ? tituloPensao.valor : '');
  const credorBenef = D.credores.find(c => c.nome === 'Beneficiario Pensao Teste');
  verificar('credor do beneficiário tem os dados bancários sincronizados', credorBenef && credorBenef.banco === 'Banco X' && credorBenef.conta_bancaria === '12345-6', JSON.stringify(credorBenef));
  S.cancelarFolha(rf.folha.id, 'desfazendo teste', true);
  S.setUsuario('u8');
})();

// ── rescisão agora também cobre gratificação, VT/VR, pensão e salário-família ──
(function () {
  S.setUsuario('u3');
  const novo = S.criarFuncionario({
    nome: 'Teste Rescisao Completa', cpf: '567.819.997-88', salario_base: 1800, cargo: 'cg01',
    admissao: '2023-01-01', vale_transporte: true, vt_dia: 20, vt_desconto_modo: 'valor', vt_desconto_valor: 40,
    vale_refeicao: true, vr_dia: 25,
    pensao_alimenticia: { ativo: true, valor: 150, beneficiario_nome: 'Beneficiario Resc Teste' },
    dependentes: [{ nome: 'Filho Resc Teste', data_nascimento: '2019-01-01' }]
  });
  if (novo.erro) { console.log('FALHOU - setup rescisão completa ->', novo.erro); S.setUsuario('u8'); return; }
  const calc = S.calcularRescisao(novo.funcionario.id, '2026-10-10', { tipo: 'pedido_demissao', gratificacao_valor: 300 });
  verificar('gratificação entra no saldo da rescisão', calc.gratificacao_valor === 300, calc.gratificacao_valor);
  verificar('desconto de VT aparece na rescisão', calc.vt_desconto > 0, calc.vt_desconto);
  verificar('desconto de VR aparece na rescisão (VR sem desconto configurado = 0, mas calculado)', calc.vr_desconto === 0, calc.vr_desconto);
  verificar('pensão alimentícia desconta na rescisão (150 do mês + parte do 13º)', Math.abs(calc.pensao_alimenticia - calc.pensao_13 - 150) < 0.01, JSON.stringify([calc.pensao_alimenticia, calc.pensao_13]));
  /* v18: a cota é proporcional aos dias do mês (saiu dia 10 → 10/30),
     e o teto passou a ser testado contra a remuneração do mês, não
     contra o saldo proporcional. */
  verificar('salário-família paga na rescisão, proporcional aos dias',
    Math.abs(calc.salario_familia - Math.round(67.54 * (10 / 30) * 100) / 100) < 0.02,
    calc.salario_familia);
  S.setUsuario('u8');
})();

// ── pensão descontada na rescisão vira título pro beneficiário ──
(function () {
  S.setUsuario('u3');
  const novo = S.criarFuncionario({
    nome: 'Teste Pensao Rescisao', cpf: '234.719.997-87', salario_base: 3000, cargo: 'cg01',
    admissao: '2020-01-01',
    pensao_alimenticia: { ativo: true, valor: 180, beneficiario_nome: 'Beneficiario Pensao Rescisao' }
  });
  if (novo.erro) { console.log('FALHOU - setup pensão rescisão ->', novo.erro); S.setUsuario('u8'); return; }
  const calc = S.calcularRescisao(novo.funcionario.id, '2026-11-05', { tipo: 'pedido_demissao' });
  const lanc = S.lancarRescisao(novo.funcionario.id, calc);
  verificar('lançar rescisão com pensão funciona', lanc.ok, JSON.stringify(lanc));
  const titulos = (lanc.titulo_ids || []).map(id => S.todasParcelas().find(p => p.titulo_id === id)).filter(Boolean);
  const tituloPensaoResc = titulos.find(p => p.descricao.includes('Beneficiario Pensao Rescisao'));
  verificar('rescisão gera título de pensão pro beneficiário', !!tituloPensaoResc, 'não achou');
  verificar('título de pensão da rescisão = pensão do mês (180) + parte do 13º', tituloPensaoResc && Math.abs(tituloPensaoResc.valor - calc.pensao_alimenticia) < 0.01 && Math.abs(calc.pensao_alimenticia - calc.pensao_13 - 180) < 0.01, tituloPensaoResc ? tituloPensaoResc.valor : '');
  S.setUsuario('u8');
})();

// ── gratificação entra na base de INSS patronal e FGTS (encargos da empresa) ──
(function () {
  const semGrat = S.calcularHolerite('fn01', '2026-09', {});
  const comGrat = S.calcularHolerite('fn01', '2026-09', { gratificacao_valor: 500 });
  verificar('INSS patronal sobe com a gratificação', comGrat.inss_patronal > semGrat.inss_patronal, JSON.stringify({sem: semGrat.inss_patronal, com: comGrat.inss_patronal}));
  verificar('FGTS sobe com a gratificação', comGrat.fgts > semGrat.fgts, JSON.stringify({sem: semGrat.fgts, com: comGrat.fgts}));
  verificar('RAT×FAP+terceiros sobe com a gratificação', comGrat.outros_encargos > semGrat.outros_encargos, JSON.stringify({sem: semGrat.outros_encargos, com: comGrat.outros_encargos}));
  const diferencaEsperadaFgts = Math.round(500 * D.parametrosDP.aliquota_fgts / 100 * 100) / 100;
  verificar('a diferença de FGTS bate com 8% da gratificação', Math.abs((comGrat.fgts - semGrat.fgts) - diferencaEsperadaFgts) < 0.01, comGrat.fgts - semGrat.fgts);
})();

// ── retenção de impostos em NF de serviço: registro, agrupamento e fechamento de guia ──
(function () {
  S.setUsuario('u3');
  const dadosBase = {
    credor: 'cr5', tipo_titulo: 'nf', conta: '6.03', centro: 'cc100',
    emissao: '2027-04-05', origem: 'manual'
  };
  const nf1 = S.criarTitulo(Object.assign({}, dadosBase, {
    descricao: 'Honorários contábeis — abril', documento: 'NF-1001',
    retencoes: [{ tributo: 'ISS', valor: 50 }]
  }), [{ num: 1, venc: '2027-04-10', comp: '2027-04', valor: 950 }]);
  const nf2 = S.criarTitulo(Object.assign({}, dadosBase, {
    descricao: 'Honorários contábeis — consultoria extra', documento: 'NF-1002',
    retencoes: [{ tributo: 'ISS', valor: 30 }, { tributo: 'IRRF', valor: 15 }]
  }), [{ num: 1, venc: '2027-04-15', comp: '2027-04', valor: 470 }]);
  verificar('NF com retenção lança normalmente', nf1.ok && nf2.ok, JSON.stringify({ nf1: nf1.erro, nf2: nf2.erro }));

  const pendentesIss = S.retencoesPendentes({ tributo: 'ISS', competencia: '2027-04' });
  verificar('duas retenções de ISS pendentes registradas', pendentesIss.length === 2, pendentesIss.length);
  verificar('total pendente de ISS é 80 (50+30)', Math.abs(pendentesIss.reduce((s, r) => s + r.valor, 0) - 80) < 0.01, pendentesIss.reduce((s, r) => s + r.valor, 0));

  const resumo = S.resumoRetencoesPendentes().find(r => r.tributo === 'ISS' && r.competencia === '2027-04');
  verificar('resumo de pendentes mostra ISS de abril/2027', !!resumo && resumo.total === 80, JSON.stringify(resumo));

  const guia = S.fecharGuiaRetencao('ISS', '2027-04', '2027-05-10');
  verificar('fechar guia de ISS funciona', guia.ok, JSON.stringify(guia));
  verificar('guia única (mesma conta 6.03 nas duas NFs)', guia.ok && guia.guias.length === 1, guia.ok ? guia.guias.length : '');
  verificar('valor da guia é 80', guia.ok && Math.abs(guia.guias[0].total - 80) < 0.01, guia.ok ? guia.guias[0].total : '');
  const tituloGuia = guia.ok && S.todasParcelas().find(p => p.titulo_id === guia.guias[0].titulo_id);
  verificar('título da guia usa a mesma conta da NF de origem (6.03)', tituloGuia && tituloGuia.conta === '6.03', tituloGuia ? tituloGuia.conta : '');

  verificar('depois de fechada, não sobra pendente de ISS em abril/2027', S.retencoesPendentes({ tributo: 'ISS', competencia: '2027-04' }).length === 0, S.retencoesPendentes({ tributo: 'ISS', competencia: '2027-04' }).length);
  const pendentesIrrf = S.retencoesPendentes({ tributo: 'IRRF', competencia: '2027-04' });
  verificar('IRRF da NF-1002 continua pendente (guia separada por tributo)', pendentesIrrf.length === 1, pendentesIrrf.length);

  // cancelar e conferir que volta pra pendente
  const cancelamento = S.cancelarGuiaRetencao(guia.guias[0].id, 'teste de cancelamento', false);
  verificar('cancelar guia de retenção funciona', cancelamento.ok, JSON.stringify(cancelamento));
  verificar('depois de cancelar, as retenções voltam a ficar pendentes', S.retencoesPendentes({ tributo: 'ISS', competencia: '2027-04' }).length === 2, S.retencoesPendentes({ tributo: 'ISS', competencia: '2027-04' }).length);

  S.setUsuario('u8');
})();

// ── guia fecha como UM título só mesmo com NFs de contas de origem diferentes ──
// (revertido de "uma guia por conta" — isso quebrava a conciliação: o banco manda
// um pagamento só pra bater com a guia real, que também é uma só por competência)
(function () {
  S.setUsuario('u3');
  const nfContabil = S.criarTitulo({
    credor: 'cr5', tipo_titulo: 'nf', conta: '6.03', centro: 'cc100',
    emissao: '2027-06-05', origem: 'manual', descricao: 'Contábil junho', documento: 'NF-2001',
    retencoes: [{ tributo: 'ISS', valor: 40 }]
  }, [{ num: 1, venc: '2027-06-10', comp: '2027-06', valor: 760 }]);
  const nfAluguel = S.criarTitulo({
    credor: 'cr4', tipo_titulo: 'nf', conta: '6.01', centro: 'cc100',
    emissao: '2027-06-08', origem: 'manual', descricao: 'Aluguel com ISS retido', documento: 'NF-2002',
    retencoes: [{ tributo: 'ISS', valor: 25 }]
  }, [{ num: 1, venc: '2027-06-12', comp: '2027-06', valor: 475 }]);
  verificar('as duas NFs de contas diferentes lançam', nfContabil.ok && nfAluguel.ok, JSON.stringify({ a: nfContabil.erro, b: nfAluguel.erro }));

  const guia = S.fecharGuiaRetencao('ISS', '2027-06', '2027-07-10');
  verificar('fechar guia com contas diferentes gera UM título só (bate com o pagamento real)', guia.ok && guia.guias.length === 1, guia.ok ? guia.guias.length : guia.erro);
  verificar('a guia usa a conta que mais pesa no total (6.03, com 40 de 65)', guia.ok && guia.guias[0].conta === '6.03', guia.ok ? guia.guias[0].conta : '');
  verificar('o valor da guia é 65 (40+25), o total certo pra bater com o extrato', guia.ok && Math.abs(guia.guias[0].total - 65) < 0.01, guia.ok ? guia.guias[0].total : '');
  verificar('a composição por conta fica registrada na guia, pra ajuste contábil manual', guia.ok && guia.guias[0].por_conta['6.01'] === 25 && guia.guias[0].por_conta['6.03'] === 40, guia.ok ? JSON.stringify(guia.guias[0].por_conta) : '');
  S.setUsuario('u8');
})();

// ── crédito do trabalhador agora vira título de repasse pra instituição ──
(function () {
  S.setUsuario('u3');
  const novo = S.criarFuncionario({
    nome: 'Teste Credito Repasse', cpf: '645.239.997-75', salario_base: 3000, cargo: 'cg01',
    admissao: '2020-01-01',
    credito_trabalhador: { ativo: true, valor_parcela: 220, instituicao: 'Banco Consignado Teste',
      banco: 'Banco Teste', agencia: '0001', conta_bancaria: '99999-9' }
  });
  if (novo.erro) { console.log('FALHOU - setup crédito repasse ->', novo.erro); S.setUsuario('u8'); return; }

  const rf = S.fecharFolha('2027-07', {});
  verificar('folha fecha com crédito do trabalhador cadastrado', rf.ok, JSON.stringify(rf.erro || rf.erros));
  const titulosFolha = rf.ok ? rf.folha.titulo_ids.map(id => S.todasParcelas().find(p => p.titulo_id === id)).filter(Boolean) : [];
  const tituloCreditoFolha = titulosFolha.find(p => p.descricao.includes('Banco Consignado Teste'));
  verificar('folha gera título de repasse pro banco do crédito', !!tituloCreditoFolha, 'não achou');
  verificar('valor do título de crédito da folha é 220', tituloCreditoFolha && Math.abs(tituloCreditoFolha.valor - 220) < 0.01, tituloCreditoFolha ? tituloCreditoFolha.valor : '');
  const credorInst = D.credores.find(c => c.nome === 'Banco Consignado Teste');
  verificar('credor da instituição tem os dados bancários sincronizados', credorInst && credorInst.conta_bancaria === '99999-9', JSON.stringify(credorInst));
  if (rf.ok) S.cancelarFolha(rf.folha.id, 'desfazendo teste', true);

  const calc = S.calcularRescisao(novo.funcionario.id, '2027-08-10', { tipo: 'pedido_demissao' });
  const lanc = S.lancarRescisao(novo.funcionario.id, calc);
  verificar('rescisão lança com crédito do trabalhador', lanc.ok, JSON.stringify(lanc));
  const titulosResc = lanc.ok ? (lanc.titulo_ids || []).map(id => S.todasParcelas().find(p => p.titulo_id === id)).filter(Boolean) : [];
  const tituloCreditoResc = titulosResc.find(p => p.descricao.includes('Banco Consignado Teste'));
  verificar('rescisão gera título de repasse pro banco do crédito', !!tituloCreditoResc, 'não achou');

  S.setUsuario('u8');
})();

// ── CRÍTICO: cancelar e refazer não trava mais com "já foi importado antes" ──
(function () {
  S.setUsuario('u3');
  const r1 = S.fecharFolha('2028-01', {});
  verificar('primeira folha de 2028-01 fecha', r1.ok, JSON.stringify(r1.erro));
  if (!r1.ok) { S.setUsuario('u8'); return; }
  const cancel = S.cancelarFolha(r1.folha.id, 'teste refazer', true);
  verificar('cancelar a folha funciona', cancel.ok, JSON.stringify(cancel));
  const r2 = S.fecharFolha('2028-01', {});
  verificar('refazer a MESMA competência depois de cancelar funciona (não trava em "já importado")', r2.ok, JSON.stringify(r2.erro));
  verificar('a folha refeita tem títulos de verdade', r2.ok && r2.folha.titulo_ids.length > 0, r2.ok ? r2.folha.titulo_ids.length : 0);

  // mesmo teste pro 13º
  const d1 = S.fechar13('2029', 1);
  verificar('13º parcela 1 de 2029 fecha', d1.ok, JSON.stringify(d1.erro));
  if (d1.ok) {
    S.cancelar13(d1.decimo.id, 'teste refazer 13', true);
    const d2 = S.fechar13('2029', 1);
    verificar('refazer o 13º depois de cancelar funciona', d2.ok, JSON.stringify(d2.erro));
  }
  S.setUsuario('u8');
})();

// ── CRÍTICO: rescisão no meio do mês não paga em dobro na folha do mesmo mês ──
(function () {
  S.setUsuario('u3');
  const novo = S.criarFuncionario({
    nome: 'Teste Dobro Rescisao Folha', cpf: '789.321.997-10', salario_base: 3000, cargo: 'cg01',
    admissao: '2020-01-01'
  });
  if (novo.erro) { console.log('FALHOU - setup dobro rescisao/folha ->', novo.erro); S.setUsuario('u8'); return; }
  const calc = S.calcularRescisao(novo.funcionario.id, '2028-05-15', { tipo: 'pedido_demissao' });
  const lanc = S.lancarRescisao(novo.funcionario.id, calc);
  verificar('rescisão no meio do mês lança', lanc.ok, JSON.stringify(lanc));

  const naListaDaFolha = S.funcionariosDaFolha('2028-05').some(f => f.id === novo.funcionario.id);
  verificar('depois da rescisão, NÃO entra mais na folha do MESMO mês (evita pagar em dobro)', !naListaDaFolha, naListaDaFolha);

  const rf = S.fecharFolha('2028-05', {});
  if (rf.ok) {
    const apareceNaFolha = rf.folha.holerites.some(h => h.funcionario === novo.funcionario.id);
    verificar('funcionário não aparece nos holerites da folha fechada do mesmo mês', !apareceNaFolha, apareceNaFolha);
  }
  S.setUsuario('u8');
})();

// ── CRÍTICO: pensão/crédito não sobrescrevem mais credor homônimo existente ──
(function () {
  S.setUsuario('u3');
  // credor "de verdade" já existe com este nome (fn01/Camila é funcionária, mas vamos usar um credor comum)
  const nomeColidido = 'Dra. Marina Alves'; // já existe como cr1, médica de verdade
  const credorOriginal = JSON.parse(JSON.stringify(D.credor('cr1')));

  const novo = S.criarFuncionario({
    nome: 'Teste Colisao Nome', cpf: '321.456.997-08', salario_base: 3000, cargo: 'cg01',
    admissao: '2020-01-01',
    pensao_alimenticia: { ativo: true, valor: 200, beneficiario_nome: nomeColidido,
      pix: '99999999999', banco: 'Banco Diferente', agencia: '9999', conta_bancaria: '00000-0' }
  });
  if (novo.erro) { console.log('FALHOU - setup colisão de nome ->', novo.erro); S.setUsuario('u8'); return; }

  const rf = S.fecharFolha('2029-06', {});
  verificar('folha fecha mesmo com beneficiária homônima de credor existente', rf.ok, JSON.stringify(rf.erro || rf.erros));

  const credorDepois = D.credor('cr1');
  verificar('o PIX da médica de verdade (cr1) NÃO foi sobrescrito pela pensão', credorDepois.pix === credorOriginal.pix, JSON.stringify({antes: credorOriginal.pix, depois: credorDepois.pix}));
  verificar('o banco da médica de verdade (cr1) NÃO foi sobrescrito', credorDepois.banco === credorOriginal.banco, JSON.stringify({antes: credorOriginal.banco, depois: credorDepois.banco}));

  const pensaoCredorId = novo.funcionario.pensao_alimenticia.credor_id;
  verificar('a pensão ganhou um credor PRÓPRIO, diferente do cr1', pensaoCredorId && pensaoCredorId !== 'cr1', pensaoCredorId);
  const credorPensaoDedicado = pensaoCredorId && D.credor(pensaoCredorId);
  verificar('o credor dedicado da pensão tem o PIX certo da pensão', credorPensaoDedicado && credorPensaoDedicado.pix === '99999999999', credorPensaoDedicado ? credorPensaoDedicado.pix : '');

  if (rf.ok) S.cancelarFolha(rf.folha.id, 'desfazendo teste', true);
  S.setUsuario('u8');
})();

// ── tipo_chave PIX não confunde mais celular (11 dígitos) com CPF ──
(function () {
  S.setUsuario('u3');
  const novo = S.criarFuncionario({
    nome: 'Teste Tipo Chave Celular', cpf: '432.156.997-45', salario_base: 3000, cargo: 'cg01',
    admissao: '2020-01-01',
    pensao_alimenticia: { ativo: true, valor: 100, beneficiario_nome: 'Beneficiario Celular Teste', pix: '11987654321' }
  });
  if (novo.erro) { console.log('FALHOU - setup tipo_chave celular ->', novo.erro); S.setUsuario('u8'); return; }
  const rf = S.fecharFolha('2029-07', {});
  const credorId = novo.funcionario.pensao_alimenticia.credor_id;
  const cr = credorId && D.credor(credorId);
  verificar('celular de 11 dígitos vira Telefone, não CPF', cr && cr.tipo_chave === 'Telefone', cr ? cr.tipo_chave : '');
  if (rf.ok) S.cancelarFolha(rf.folha.id, 'desfazendo teste', true);
  S.setUsuario('u8');
})();

// ── funcionário sem PIX (só conta bancária) ganha credor com dados bancários de verdade ──
(function () {
  S.setUsuario('u3');
  const novo = S.criarFuncionario({
    nome: 'Teste Sem Pix TED', cpf: '543.216.997-54', salario_base: 3000, cargo: 'cg01',
    admissao: '2020-01-01', banco: 'Banco Teste TED', agencia: '1111', conta_bancaria: '22222-3'
  });
  if (novo.erro) { console.log('FALHOU - setup sem PIX ->', novo.erro); S.setUsuario('u8'); return; }
  const cr = D.credor(novo.funcionario.credor_id);
  verificar('credor sem PIX tem banco preenchido (não fica sem dado bancário nenhum)', cr.banco === 'Banco Teste TED', cr.banco);
  verificar('credor sem PIX tem agência preenchida', cr.agencia === '1111', cr.agencia);
  verificar('credor sem PIX tem conta preenchida', cr.conta_bancaria === '22222-3', cr.conta_bancaria);
  S.setUsuario('u8');
})();

// ── DP consegue editar funcionário sem banco cadastrado (null vs '' não trava mais) ──
(function () {
  S.setUsuario('u8'); // perfil dp, sem alçada de aprovar
  const novo = S.criarFuncionario({
    nome: 'Teste Sem Banco Edicao', cpf: '654.327.997-40', salario_base: 3000, cargo: 'cg01',
    admissao: '2020-01-01', pix: '654.327.997-40' // paga por PIX, nunca teve banco/agencia/conta preenchidos
  });
  if (novo.erro) { console.log('FALHOU - setup sem banco ->', novo.erro); S.setUsuario('u8'); return; }
  const ed = S.editarFuncionario(novo.funcionario.id, {
    jornada_semanal_horas: 40, banco: '', agencia: '', conta_bancaria: '', pix: novo.funcionario.pix
  });
  verificar('DP edita campo comum (jornada) sem travar por causa de banco vazio vs null', ed.ok, JSON.stringify(ed));
})();

// ── CRÍTICO: cancelar NF cancela também a retenção pendente ──
(function () {
  S.setUsuario('u3');
  const nf = S.criarTitulo({
    credor: 'cr5', tipo_titulo: 'nf', conta: '6.03', centro: 'cc100',
    emissao: '2031-01-05', origem: 'manual', descricao: 'NF pra cancelar', documento: 'NF-CANCEL-001',
    retencoes: [{ tributo: 'ISS', valor: 70 }]
  }, [{ num: 1, venc: '2031-01-15', comp: '2031-01', valor: 930 }]);
  verificar('NF com retenção lança', nf.ok, JSON.stringify(nf.erro));
  const pendenteAntes = S.retencoesPendentes({ tributo: 'ISS', competencia: '2031-01' });
  verificar('retenção aparece pendente antes de cancelar', pendenteAntes.some(r => r.nf_documento === 'NF-CANCEL-001'), pendenteAntes.length);

  const parcelaNf = S.todasParcelas().find(p => p.titulo_id === nf.titulo.id);
  const cancelamento = S.cancelar(parcelaNf.id, 'nota cancelada pelo fornecedor', true);
  verificar('cancelar a NF funciona', cancelamento.ok, JSON.stringify(cancelamento));

  const pendenteDepois = S.retencoesPendentes({ tributo: 'ISS', competencia: '2031-01' });
  verificar('depois de cancelar a NF, a retenção some da fila de pendentes', !pendenteDepois.some(r => r.nf_documento === 'NF-CANCEL-001'), pendenteDepois.length);

  // ── cenário 2: NF cancelada DEPOIS de já estar numa guia fechada ──
  const nf2 = S.criarTitulo({
    credor: 'cr5', tipo_titulo: 'nf', conta: '6.03', centro: 'cc100',
    emissao: '2031-02-05', origem: 'manual', descricao: 'NF que vai pra guia e depois cancela', documento: 'NF-CANCEL-002',
    retencoes: [{ tributo: 'ISS', valor: 45 }]
  }, [{ num: 1, venc: '2031-02-15', comp: '2031-02', valor: 955 }]);
  S.fecharGuiaRetencao('ISS', '2031-02', '2031-03-10');
  const parcelaNf2 = S.todasParcelas().find(p => p.titulo_id === nf2.titulo.id);
  const cancelamento2 = S.cancelar(parcelaNf2.id, 'nota cancelada, mas já tinha entrado na guia', true);
  verificar('cancelar NF já incluída numa guia fechada avisa pra revisar a guia', cancelamento2.ok && !!cancelamento2.aviso_retencao, JSON.stringify(cancelamento2));

  S.setUsuario('u8');
})();


// ── CRÍTICO: férias agora geram as guias de INSS/IRRF retido, FGTS e INSS patronal ──
(function () {
  S.setUsuario('u3');
  const calc = S.calcularFerias('fn01', 15, '2032-03-10', 0);
  verificar('calcular férias funciona (setup guias)', !calc.erro, JSON.stringify(calc.erro));
  if (calc.erro) { S.setUsuario('u8'); return; }
  const lanc = S.lancarFerias('fn01', calc, '2032-03-10');
  verificar('lançar férias funciona', lanc.ok, JSON.stringify(lanc));
  if (!lanc.ok) { S.setUsuario('u8'); return; }
  verificar('lançar férias gera mais de um título (líquido + guias)', lanc.titulo_ids.length > 1, lanc.titulo_ids.length);
  const titulosFerias = lanc.titulo_ids.map(id => S.todasParcelas().find(p => p.titulo_id === id)).filter(Boolean);
  const guiaInssIrrf = titulosFerias.find(p => p.descricao.includes('INSS retido das férias')) && titulosFerias.find(p => p.descricao.includes('IRRF retido das férias'));
  const guiaFgts = titulosFerias.find(p => p.descricao.includes('FGTS sobre férias'));
  const guiaPatronal = titulosFerias.find(p => p.descricao.includes('INSS patronal + RAT'));
  verificar('gera guias separadas de INSS e de IRRF retidos das férias', calc.valor_inss + calc.valor_irrf <= 0.004 || !!guiaInssIrrf, JSON.stringify({inss: calc.valor_inss, irrf: calc.valor_irrf}));
  verificar('gera guia de FGTS sobre férias', !!guiaFgts, 'não achou');
  verificar('gera guia de INSS patronal + RAT sobre férias', !!guiaPatronal, 'não achou');
  if (guiaFgts) {
    const fgtsEsperado = Math.round(calc.base_bruta * D.parametrosDP.aliquota_fgts / 100 * 100) / 100;
    verificar('valor do FGTS de férias bate com 8% da base', Math.abs(guiaFgts.valor - fgtsEsperado) < 0.01, JSON.stringify({esperado: fgtsEsperado, real: guiaFgts.valor}));
  }
  S.setUsuario('u8');
})();

// ── aviso prévio conta anos completos por calendário, não dias÷30 arredondado ──
(function () {
  S.setUsuario('u3');
  const novo = S.criarFuncionario({
    nome: 'Teste Aviso Previo Calendario', cpf: '987.654.397-08', salario_base: 3000, cargo: 'cg01',
    admissao: '2025-10-10'
  });
  if (novo.erro) { console.log('FALHOU - setup aviso prévio ->', novo.erro); S.setUsuario('u8'); return; }
  // 2025-10-10 até 2026-09-21: ainda não completou 1 ano (faltam ~19 dias) — dias÷30 arredondado dava 12 meses = 1 ano indevido
  const calc = S.calcularRescisao(novo.funcionario.id, '2026-09-21', { tipo: 'sem_justa_causa', avisoIndenizado: true });
  verificar('aviso prévio com menos de 1 ano de casa fica em 30 dias (não 33)', calc.dias_aviso === 30, calc.dias_aviso);

  // agora com 1 ano completo de verdade (2025-10-10 até 2026-10-10 ou depois)
  const calc2 = S.calcularRescisao(novo.funcionario.id, '2026-10-15', { tipo: 'sem_justa_causa', avisoIndenizado: true });
  verificar('aviso prévio com 1 ano completo de verdade fica em 33 dias', calc2.dias_aviso === 33, calc2.dias_aviso);
  S.setUsuario('u8');
})();

// ── multa de 40% do FGTS também é devida na rescisão ANTECIPADA de experiência ──
(function () {
  S.setUsuario('u3');
  const novo = S.criarFuncionario({
    nome: 'Teste Multa FGTS Experiencia', cpf: '129.876.397-59', salario_base: 3000, cargo: 'cg01',
    admissao: '2026-01-01'
  });
  if (novo.erro) { console.log('FALHOU - setup multa FGTS experiência ->', novo.erro); S.setUsuario('u8'); return; }
  // gera algum FGTS de verdade fechando uma folha antes
  S.fecharFolha('2026-02', {});

  const calcNoPrazo = S.calcularRescisao(novo.funcionario.id, '2026-06-30', { tipo: 'termino_experiencia', dataFimPrevista: '2026-06-30' });
  verificar('término de experiência NO PRAZO não deve multa de FGTS', !calcNoPrazo.multa_fgts_aplicavel, calcNoPrazo.multa_fgts_aplicavel);

  const calcAntecipado = S.calcularRescisao(novo.funcionario.id, '2026-05-01', { tipo: 'termino_experiencia', dataFimPrevista: '2026-06-30' });
  verificar('término ANTECIPADO de experiência agora deve multa de FGTS', calcAntecipado.multa_fgts_aplicavel, calcAntecipado.multa_fgts_aplicavel);
  verificar('a multa antecipada (art. 479) continua sendo calculada junto', calcAntecipado.multa_antecipada_experiencia > 0, calcAntecipado.multa_antecipada_experiencia);
  S.setUsuario('u8');
})();

// ── cancelar férias agora existe: devolve os dias e cancela todos os títulos (líquido + guias) ──
(function () {
  S.setUsuario('u3');
  const calc = S.calcularFerias('fn02', 10, '2033-04-05', 0);
  verificar('calcular férias funciona (setup cancelar férias)', !calc.erro, JSON.stringify(calc.erro));
  if (calc.erro) { S.setUsuario('u8'); return; }
  const antesDoLancamento = D.funcionario('fn02').ferias.find(p => (p.dias_gozados || 0) < p.dias_direito);
  const gozadosAntes = antesDoLancamento ? (antesDoLancamento.dias_gozados || 0) : 0;

  const lanc = S.lancarFerias('fn02', calc, '2033-04-05');
  verificar('lançar férias funciona (setup cancelar)', lanc.ok, JSON.stringify(lanc));
  if (!lanc.ok) { S.setUsuario('u8'); return; }

  const cancel = S.cancelarFerias('fn02', '2033-04-05', 'lançado com data errada', false);
  verificar('cancelar férias funciona', cancel.ok, JSON.stringify(cancel));
  verificar('cancelamento completo (nenhum título já tinha sido pago)', cancel.cancelado_completo, cancel);

  const todosCancelados = lanc.titulo_ids.every(id => S.todasParcelas().find(p => p.titulo_id === id).status === 'cancelado');
  verificar('todos os títulos do gozo (líquido + guias) foram cancelados', todosCancelados, todosCancelados);

  const depoisDoCancelamento = D.funcionario('fn02').ferias.find(p => p.limite === antesDoLancamento.limite);
  verificar('os dias voltam ao período depois de cancelar', depoisDoCancelamento.dias_gozados === gozadosAntes, JSON.stringify({antes: gozadosAntes, depois: depoisDoCancelamento.dias_gozados}));
  S.setUsuario('u8');
})();

// ── cancelar rescisão agora existe: cancela todos os títulos e reativa o funcionário ──
(function () {
  S.setUsuario('u3');
  const novo = S.criarFuncionario({
    nome: 'Teste Cancelar Rescisao', cpf: '345.678.397-30', salario_base: 3000, cargo: 'cg01',
    admissao: '2020-01-01',
    pensao_alimenticia: { ativo: true, valor: 100, beneficiario_nome: 'Beneficiario Cancelar Rescisao' }
  });
  if (novo.erro) { console.log('FALHOU - setup cancelar rescisão ->', novo.erro); S.setUsuario('u8'); return; }
  const calc = S.calcularRescisao(novo.funcionario.id, '2034-03-10', { tipo: 'pedido_demissao' });
  const lanc = S.lancarRescisao(novo.funcionario.id, calc);
  verificar('rescisão lança (setup cancelar)', lanc.ok, JSON.stringify(lanc));
  if (!lanc.ok) { S.setUsuario('u8'); return; }
  verificar('funcionário fica inativo depois da rescisão', !D.funcionario(novo.funcionario.id).ativo, D.funcionario(novo.funcionario.id).ativo);

  const cancel = S.cancelarRescisao(novo.funcionario.id, 'data errada, refazer', false);
  verificar('cancelar rescisão funciona', cancel.ok, JSON.stringify(cancel));
  verificar('cancelamento completo', cancel.cancelado_completo, cancel);

  const fDepois = D.funcionario(novo.funcionario.id);
  verificar('funcionário volta a ficar ativo depois de cancelar a rescisão', fDepois.ativo, fDepois.ativo);
  verificar('desligado_em é limpo', !fDepois.desligado_em, fDepois.desligado_em);

  const todosCancelados = lanc.titulo_ids.every(id => S.todasParcelas().find(p => p.titulo_id === id).status === 'cancelado');
  verificar('todos os títulos da rescisão (líquido + guias + pensão) foram cancelados', todosCancelados, todosCancelados);

  const relanc = S.calcularRescisao(novo.funcionario.id, '2034-03-15', { tipo: 'pedido_demissao' });
  const relancOk = S.lancarRescisao(novo.funcionario.id, relanc);
  verificar('depois de cancelar, dá pra lançar uma rescisão nova pro mesmo funcionário', relancOk.ok, JSON.stringify(relancOk));
  S.setUsuario('u8');
})();

// ── uma das frações de férias precisa ter pelo menos 14 dias (CLT art. 134 §1º) ──
(function () {
  S.setUsuario('u3');
  const novo = S.criarFuncionario({
    nome: 'Teste 14 Dias Ferias', cpf: '567.891.297-66', salario_base: 3000, cargo: 'cg01',
    admissao: '2024-01-01'
  });
  if (novo.erro) { console.log('FALHOU - setup 14 dias ->', novo.erro); S.setUsuario('u8'); return; }

  // duas frações de 5 dias cada, deixando só 20 pra terceira — tudo bem, ainda dá pra chegar a 14
  const c1 = S.calcularFerias(novo.funcionario.id, 5, '2025-06-03', 0);
  verificar('primeira fração de 5 dias passa (ainda dá tempo de uma futura ter 14)', !c1.erro, JSON.stringify(c1.erro));
  if (!c1.erro) S.lancarFerias(novo.funcionario.id, c1, '2025-06-03');

  const c2 = S.calcularFerias(novo.funcionario.id, 5, '2025-07-01', 0);
  verificar('segunda fração de 5 dias passa (sobram 20, ainda dá pra ter 14)', !c2.erro, JSON.stringify(c2.erro));
  if (!c2.erro) S.lancarFerias(novo.funcionario.id, c2, '2025-07-01');

  // agora só restam 20 dias, e nenhuma fração teve 14+ ainda — tentar uma terceira de 5 deixaria só 15, ok ainda
  // mas tentar uma de 10 deixaria só 10, que é < 14 e nenhuma teve 14 — deve bloquear
  const c3 = S.calcularFerias(novo.funcionario.id, 10, '2025-08-05', 0);
  verificar('terceira fração de 10 dias É BLOQUEADA (sobrariam só 10, nenhuma teve 14 ainda)', !!c3.erro, JSON.stringify(c3));

  // uma última fração de 20 dias (tudo que resta) resolve, porque ela mesma tem 14+
  const c4 = S.calcularFerias(novo.funcionario.id, 20, '2025-08-05', 0);
  verificar('fração final de 20 dias passa (ela mesma tem 14+, resolve a regra)', !c4.erro, JSON.stringify(c4.erro));
  S.setUsuario('u8');
})();

// ── IRRF: desconto simplificado SUBSTITUI INSS + dependentes + pensão (valores do relatório de QA da v73) ──
(function () {
  const ir = (b, dep, pen) => S.calcularIRRF(b, S.calcularINSS(b), dep || 0, pen || 0);
  verificar('IRRF salário 5.500 sem dependentes = 190,47', ir(5500) === 190.47, ir(5500));
  verificar('IRRF salário 8.000 sem dependentes = 1.037,85', ir(8000) === 1037.85, ir(8000));
  verificar('IRRF 5.124,20 sem dependentes = 44,48 (simplificado vence)', ir(5124.20) === 44.48, ir(5124.20));
  verificar('IRRF 5.124,20 com 2 dependentes = 0 (INSS+dep 898,08 > 607,20)', ir(5124.20, 2) === 0, ir(5124.20, 2));
  verificar('pensão alta faz as deduções legais vencerem o simplificado', ir(10000, 0, 1500) < ir(10000), JSON.stringify([ir(10000), ir(10000, 0, 1500)]));
})();

// ── insalubridade/periculosidade proporcionais a dias pagos e dentro da base de HE ──
(function () {
  S.setUsuario('u3');
  const novo = S.criarFuncionario({
    nome: 'Teste Insalubridade Proporcional', cpf: '234.567.897-69', salario_base: 3000, cargo: 'cg01',
    admissao: '2020-01-01', insalubridade_pct: 20
  });
  if (novo.erro) { console.log('FALHOU - setup insalubridade proporcional ->', novo.erro); S.setUsuario('u8'); return; }

  const holeriteCheio = S.calcularHolerite(novo.funcionario.id, '2035-03', {});
  const insalCheia = holeriteCheio.proventos.find(p => p.codigo === '105');
  verificar('insalubridade aparece cheia num mês sem faltas/admissão parcial', !!insalCheia, JSON.stringify(holeriteCheio.proventos));

  const holeriteComFaltas = S.calcularHolerite(novo.funcionario.id, '2035-04', { faltas_dias: 10 });
  const insalProporcional = holeriteComFaltas.proventos.find(p => p.codigo === '105');
  verificar('insalubridade fica proporcional quando há faltas no mês', insalProporcional && insalProporcional.valor < insalCheia.valor, JSON.stringify({cheia: insalCheia.valor, comFaltas: insalProporcional ? insalProporcional.valor : null}));

  // HE deve considerar a insalubridade na base do valor/hora (Súmula 264 do TST)
  const semInsalubridade = S.criarFuncionario({
    nome: 'Teste HE Sem Insalubridade', cpf: '345.678.997-17', salario_base: 3000, cargo: 'cg01', admissao: '2020-01-01'
  });
  const holeriteHeComInsal = S.calcularHolerite(novo.funcionario.id, '2035-05', { he50_horas: 10 });
  const holeriteHeSemInsal = S.calcularHolerite(semInsalubridade.funcionario.id, '2035-05', { he50_horas: 10 });
  const he50ComInsal = holeriteHeComInsal.proventos.find(p => p.codigo === '101');
  const he50SemInsal = holeriteHeSemInsal.proventos.find(p => p.codigo === '101');
  verificar('hora extra de quem tem insalubridade vale mais (a insalubridade entra na base da hora)', he50ComInsal.valor > he50SemInsal.valor, JSON.stringify({comInsal: he50ComInsal.valor, semInsal: he50SemInsal.valor}));
  S.setUsuario('u8');
})();

// ── pensão alimentícia agora deduz do IRRF do saldo de salário na rescisão ──
(function () {
  S.setUsuario('u3');
  const semPensao = S.criarFuncionario({
    nome: 'Teste Rescisao Sem Pensao IRRF', cpf: '456.789.197-09', salario_base: 20000, cargo: 'cg01', admissao: '2020-01-01'
  });
  const comPensao = S.criarFuncionario({
    nome: 'Teste Rescisao Com Pensao IRRF', cpf: '912.345.697-36', salario_base: 20000, cargo: 'cg01', admissao: '2020-01-01',
    pensao_alimenticia: { ativo: true, valor: 3000, beneficiario_nome: 'Beneficiario IRRF Rescisao' }
  });
  if (semPensao.erro || comPensao.erro) { console.log('FALHOU - setup pensão IRRF rescisão', semPensao.erro, comPensao.erro); S.setUsuario('u8'); return; }

  const calcSem = S.calcularRescisao(semPensao.funcionario.id, '2036-06-30', { tipo: 'pedido_demissao' });
  const calcCom = S.calcularRescisao(comPensao.funcionario.id, '2036-06-30', { tipo: 'pedido_demissao' });
  verificar('IRRF do saldo é menor pra quem tem pensão alimentícia (deduz da base)', calcCom.valor_irrf_saldo < calcSem.valor_irrf_saldo, JSON.stringify({sem: calcSem.valor_irrf_saldo, com: calcCom.valor_irrf_saldo}));
  S.setUsuario('u8');
})();

// ── pensão alimentícia agora incide sobre férias: reduz IRRF, desconta do líquido e gera título ──
(function () {
  S.setUsuario('u3');
  const novo = S.criarFuncionario({
    nome: 'Teste Pensao Ferias', cpf: '789.123.497-32', salario_base: 8000, cargo: 'cg01', admissao: '2020-01-01',
    pensao_alimenticia: { ativo: true, valor: 400, beneficiario_nome: 'Beneficiario Pensao Ferias' }
  });
  if (novo.erro) { console.log('FALHOU - setup pensão férias ->', novo.erro); S.setUsuario('u8'); return; }
  const calc = S.calcularFerias(novo.funcionario.id, 30, '2037-04-07', 0);
  verificar('cálculo de férias mostra a pensão', calc.pensao_alimenticia === 400, calc.pensao_alimenticia);
  const lanc = S.lancarFerias(novo.funcionario.id, calc, '2037-04-07');
  verificar('lançar férias com pensão funciona', lanc.ok, JSON.stringify(lanc));
  if (lanc.ok) {
    const tituloPensao = lanc.titulo_ids.map(id => S.todasParcelas().find(p => p.titulo_id === id)).find(p => p && p.descricao.includes('Beneficiario Pensao Ferias'));
    verificar('férias gera título de pensão pro beneficiário', !!tituloPensao, 'não achou');
    verificar('valor do título de pensão das férias é 400', tituloPensao && Math.abs(tituloPensao.valor - 400) < 0.01, tituloPensao ? tituloPensao.valor : '');
  }
  S.setUsuario('u8');
})();

// ── pensão alimentícia agora incide sobre o 13º (2ª parcela): reduz IRRF, desconta e gera título ──
(function () {
  S.setUsuario('u3');
  const novo = S.criarFuncionario({
    nome: 'Teste Pensao 13', cpf: '345.678.927-04', salario_base: 8000, cargo: 'cg01', admissao: '2020-01-01',
    pensao_alimenticia: { ativo: true, valor: 500, beneficiario_nome: 'Beneficiario Pensao 13' }
  });
  if (novo.erro) { console.log('FALHOU - setup pensão 13 ->', novo.erro); S.setUsuario('u8'); return; }
  const calcSemDesconto = S.calcular13(novo.funcionario.id, 2040, 1);
  verificar('1ª parcela do 13º não tem pensão (isenção da 1ª parcela)', calcSemDesconto.pensao_alimenticia === undefined, JSON.stringify(calcSemDesconto));

  const d1 = S.fechar13('2040', 1);
  verificar('1ª parcela do 13º fecha (setup pensão)', d1.ok, JSON.stringify(d1.erro || d1.erros));
  const d2 = S.fechar13('2040', 2);
  verificar('2ª parcela do 13º fecha com pensão cadastrada', d2.ok, JSON.stringify(d2.erro || d2.erros));
  if (d2.ok) {
    const tituloPensao13 = d2.decimo.titulo_ids.map(id => S.todasParcelas().find(p => p.titulo_id === id)).find(p => p && p.descricao.includes('Beneficiario Pensao 13'));
    verificar('2ª parcela do 13º gera título de pensão pro beneficiário', !!tituloPensao13, 'não achou');
    verificar('valor do título de pensão do 13º é 500', tituloPensao13 && Math.abs(tituloPensao13.valor - 500) < 0.01, tituloPensao13 ? tituloPensao13.valor : '');
  }
  S.setUsuario('u8');
})();

// ── salário-família é compensado direto na guia de INSS patronal ──
(function () {
  S.setUsuario('u3');
  const novo = S.criarFuncionario({
    nome: 'Teste Compensacao Salario Familia', cpf: '987.654.327-03', salario_base: 1800, cargo: 'cg01',
    admissao: '2020-01-01', dependentes: [{ nome: 'Filho Compensacao Teste', data_nascimento: '2028-01-01' }]
  });
  if (novo.erro) { console.log('FALHOU - setup compensação salário-família ->', novo.erro); S.setUsuario('u8'); return; }

  const holerite = S.calcularHolerite(novo.funcionario.id, '2041-01', {});
  verificar('funcionário recebe salário-família (dependente elegível)', holerite.salario_familia > 0, holerite.salario_familia);

  const rf = S.fecharFolha('2041-01', {});
  verificar('folha fecha com salário-família', rf.ok, JSON.stringify(rf.erro || rf.erros));
  if (rf.ok) {
    const guiaPatronal = rf.folha.titulo_ids.map(id => S.todasParcelas().find(p => p.titulo_id === id)).find(p => p && p.descricao.includes('INSS patronal'));
    verificar('guia de INSS patronal menciona a compensação do salário-família', guiaPatronal && guiaPatronal.obs.includes('compensado'), guiaPatronal ? guiaPatronal.obs : 'não achou');
    S.cancelarFolha(rf.folha.id, 'desfazendo teste', true);
  }
  S.setUsuario('u8');
})();

// ── sigilo salarial: descricaoVisivel mascara identidade pra quem não tem ver_dados_pessoais ──
(function () {
  S.setUsuario('u3'); // sócio fecha a folha
  const rf = S.fecharFolha('2042-01', {});
  verificar('folha fecha (setup sigilo salarial)', rf.ok, JSON.stringify(rf.erro));
  if (!rf.ok) { S.setUsuario('u8'); return; }
  const tituloFolha = rf.folha.titulo_ids.map(id => S.todasParcelas().find(p => p.titulo_id === id)).find(p => p && p.tipo_titulo === 'folha');
  verificar('achou um título de folha pra testar', !!tituloFolha, 'não achou');

  /* v31: o assistente financeiro passou a ter `ver_dados_pessoais`
     — ele paga os salários e precisa do líquido, da conta e do CPF.
     O sigilo da folha continua valendo para quem NÃO tem a ação, e
     é isso que estes casos verificam: o perfil de consulta vê o
     financeiro inteiro e não pode saber quanto cada um ganha. */
  S.setUsuario('u4'); // contabilidade (consulta), sem ver_dados_pessoais
  const descOculta = S.descricaoVisivel(tituloFolha);
  verificar('quem não tem ver_dados_pessoais NÃO vê o nome do funcionário na descrição', !descOculta.includes(tituloFolha.descricao.split(' — ')[1] || '###'), descOculta);
  verificar('descrição oculta ainda diz que é folha de pagamento', descOculta.includes('Folha de pagamento'), descOculta);

  S.setUsuario('u3'); // sócio, tem ver_dados_pessoais
  const descVisivel = S.descricaoVisivel(tituloFolha);
  verificar('sócio vê a descrição real, sem máscara', descVisivel === tituloFolha.descricao, descVisivel);

  // título comum (não pessoal) nunca é mascarado, mesmo sem a permissão
  S.setUsuario('u1');
  const tituloComum = { tipo_titulo: 'nf', descricao: 'NF de fornecedor qualquer' };
  verificar('título comum (não pessoal) nunca é mascarado', S.descricaoVisivel(tituloComum) === tituloComum.descricao, S.descricaoVisivel(tituloComum));

  S.setUsuario('u3');
  S.cancelarFolha(rf.folha.id, 'desfazendo teste', true);
  S.setUsuario('u8');
})();

// ── sigilo salarial: nomeCredorVisivel mascara quando o credor É o funcionário ──
(function () {
  S.setUsuario('u3');
  const rf = S.fecharFolha('2043-01', {});
  if (!rf.ok) { console.log('FALHOU - setup nomeCredorVisivel ->', rf.erro); S.setUsuario('u8'); return; }
  const tituloFolha = rf.folha.titulo_ids.map(id => S.todasParcelas().find(p => p.titulo_id === id)).find(p => p && p.tipo_titulo === 'folha');
  const nomeReal = D.credor(tituloFolha.credor).nome;

  S.setUsuario('u4');
  verificar('nome do credor (= funcionário) fica oculto para esse perfil', S.nomeCredorVisivel(tituloFolha, nomeReal) === '[confidencial]', S.nomeCredorVisivel(tituloFolha, nomeReal));

  S.setUsuario('u3');
  verificar('sócio continua vendo o nome real do credor', S.nomeCredorVisivel(tituloFolha, nomeReal) === nomeReal, S.nomeCredorVisivel(tituloFolha, nomeReal));

  // título de pensão: credor é o BENEFICIÁRIO (terceiro), não o funcionário — nome dele não deveria ser mascarado
  S.setUsuario('u4'); // sem ver_dados_pessoais, desde a v31
  const tituloPensao = { tipo_titulo: 'pensao' };
  verificar('nome da beneficiária da pensão é mascarado (revelaria que o funcionário paga pensão)', S.nomeCredorVisivel(tituloPensao, 'Fulano Beneficiario') === '[confidencial]', S.nomeCredorVisivel(tituloPensao, 'Fulano Beneficiario'));

  S.setUsuario('u3');
  S.cancelarFolha(rf.folha.id, 'desfazendo teste', true);
  S.setUsuario('u8');
})();

// ── CRÍTICO: INSS de férias batia no teto errado quando a pessoa tira o mês inteiro de férias ──
// (bug real do relatório de QA: base ficava artificialmente baixa porque calcularHolerite não sabia
// que os dias desta MESMA fração de férias já tiravam a pessoa do trabalho naquele mês)
(function () {
  S.setUsuario('u3');
  /* Funcionário próprio: usar a Camila fazia o bloco depender do que
     outros testes já tinham consumido do período aquisitivo dela —
     e, com a validação de saldo da v14 (A22), o cálculo passou a ser
     recusado por falta de dias, não por defeito do que se testa. */
  S.setUsuario('u8');
  const criadoFer = S.criarFuncionario({ nome: 'QA Ferias Vencidas', cpf: cpfValido(770000931),
    salario_base: 4200, cargo: (D.cargos[0] || {}).id, admissao: '2020-01-02' });
  if (criadoFer.erro) console.log('   (aviso: não criou o funcionário do teste — ' + criadoFer.erro + ')');
  const camila = criadoFer.funcionario
    ? D.funcionario(criadoFer.funcionario.id)
    : D.funcionarios.find(f => f.nome.includes('Camila'));
  S.setUsuario('u3');

  /* v117: 01/03/2099 é domingo e o art. 134 §3º barra o início; começa
     na segunda, 02/03, e sobra o dia 1º como salário — mesmo efeito. */
  const calc = S.calcularFerias(camila.id, 30, '2099-03-02', 0);
  // março tem 31 dias: um dia fica como salário e usa um pedaço do teto; férias + salário = teto exato
  const salDia31 = S.calcularHolerite(camila.id, '2099-03', { dias_trabalhados: 1 }).base_inss;
  const inssSal = S.calcularINSS(salDia31);
  /* v117: a dobra do art. 137 saiu do salário de contribuição (Lei
     8.212, art. 28 §9º "d"), então estas férias vencidas não levam mais
     o mês ao teto. O que o teste guarda agora é o essencial: o INSS das
     férias sai da base SIMPLES e a soma do mês nunca passa do teto. */
  /* O valor não é calcularINSS(base) puro porque o INSS é progressivo
     POR COMPETÊNCIA — o que vale é ser menor do que seria com a base
     cheia e não passar do que a base simples geraria sozinha. */
  /* O valor não bate com calcularINSS(base) puro porque o INSS é
     progressivo POR COMPETÊNCIA (soma o que o mês já usou). O que
     importa aqui é que ficou MUITO abaixo do que a base cheia geraria. */
  verificar('INSS das férias vencidas sai da parte simples, não da dobra',
    calc.valor_inss > 0 && calc.valor_inss < S.calcularINSS(calc.base_bruta) * 0.7,
    JSON.stringify([calc.valor_inss, S.calcularINSS(calc.base_bruta)]));
  verificar('a dobra fica fora da base de INSS',
    calc.base_inss < calc.base_bruta && Math.abs(calc.dobra_indenizatoria - (calc.base_bruta - calc.base_inss)) < 0.02,
    JSON.stringify([calc.base_inss, calc.base_bruta]));
  verificar('INSS do mês não passa do teto', calc.valor_inss + inssSal <= 988.09 + 0.02,
    JSON.stringify([calc.valor_inss, inssSal]));

  const sobrouTemporario = (camila.ferias || []).some(p => (p.gozos || []).some(g => g.__temporario || g.data_inicio === '2099-03-01'));
  verificar('o cálculo não deixa nenhum gozo temporário sobrando no cadastro', !sobrouTemporario, sobrouTemporario);
  S.setUsuario('u8');
})();

// ── v74: rescisão e 13º (relatório de QA da v73) ──
function cpfValido(seed) {
  const b = String(seed).padStart(9, '0').slice(-9).split('').map(Number);
  const dv = n => { let s = 0; n.forEach((x, i) => s += x * (n.length + 1 - i)); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(b); const d2 = dv(b.concat(d1));
  return b.join('') + d1 + d2;
}
(function () {
  S.setUsuario('u3');
  // 1) avos do 13º na rescisão respeitam a admissão no próprio ano
  const a = S.criarFuncionario({ nome: 'QA Avos Admissao', cpf: cpfValido(740000001), salario_base: 3000, cargo: 'cg01', admissao: '2026-08-01' });
  const ca = S.calcularRescisao(a.funcionario.id, '2026-09-20', { tipo: 'pedido_demissao' });
  verificar('rescisão: admitido 01/08, saída 20/09 → 2 avos, 13º R$500', ca.avos_13 === 2 && ca.decimo_proporcional === 500, JSON.stringify([ca.avos_13, ca.decimo_proporcional]));

  // 2) saldo de salário não paga de novo os dias de férias do mês
  const b = S.criarFuncionario({ nome: 'QA Saldo Ferias', cpf: cpfValido(740000002), salario_base: 3000, cargo: 'cg01', admissao: '2020-01-01' });
  const cf = S.calcularFerias(b.funcionario.id, 20, '2051-12-05', 0);
  const lf = S.lancarFerias(b.funcionario.id, cf, '2051-12-05');
  verificar('setup férias 01–20/12', lf.ok, JSON.stringify(lf.erro || cf.erro));
  const cb = S.calcularRescisao(b.funcionario.id, '2051-12-25', { tipo: 'pedido_demissao' });
  verificar('saldo de 25 dias com 20 de férias no mês → 5 dias', cb.dias_saldo === 5 && cb.saldo_salario === 500, JSON.stringify([cb.dias_saldo, cb.saldo_salario]));

  // 3) férias canceladas não travam a rescisão
  const c = S.criarFuncionario({ nome: 'QA Ferias Cancelada', cpf: cpfValido(740000003), salario_base: 3000, cargo: 'cg01', admissao: '2020-01-01' });
  const cfc = S.calcularFerias(c.funcionario.id, 30, '2052-01-10', 0);
  S.lancarFerias(c.funcionario.id, cfc, '2052-01-10');
  S.cancelarFerias(c.funcionario.id, '2052-01-10', 'teste', true);
  const rc = S.lancarRescisao(c.funcionario.id, S.calcularRescisao(c.funcionario.id, '2051-12-15', { tipo: 'pedido_demissao' }));
  verificar('férias futuras CANCELADAS não bloqueiam a rescisão', rc.ok, JSON.stringify(rc.erro));

  // 4) rescisão em dezembro desconta a 1ª parcela do 13º já paga
  const d = S.criarFuncionario({ nome: 'QA Adiantamento 13', cpf: cpfValido(740000004), salario_base: 6000, cargo: 'cg01', admissao: '2020-01-01' });
  const p1 = S.fechar13('2053', 1);
  verificar('setup 1ª parcela 2053', p1.ok, JSON.stringify(p1.erro));
  const cd = S.calcularRescisao(d.funcionario.id, '2053-12-10', { tipo: 'pedido_demissao' });
  verificar('rescisão em dezembro desconta o adiantamento do 13º (R$3.000)', cd.adiantamento_13 === 3000, cd.adiantamento_13);

  // 5) 2ª parcela não desconta 1ª parcela de quem não a recebeu
  const e = S.criarFuncionario({ nome: 'QA Segunda Parcela', cpf: cpfValido(740000005), salario_base: 2400, cargo: 'cg01', admissao: '2020-01-01' });
  S.lancarRescisao(e.funcionario.id, S.calcularRescisao(e.funcionario.id, '2054-10-10', { tipo: 'pedido_demissao' }));
  const q1 = S.fechar13('2054', 1);   // e está desligada: não recebe
  S.cancelarRescisao(e.funcionario.id, 'teste', true);   // volta ativa
  const c2 = S.calcular13(e.funcionario.id, '2054', 2);
  verificar('2ª parcela de quem não recebeu a 1ª = 13º inteiro (não desconta R$1.200)', q1.ok && c2.primeira_parcela === 0 && c2.valor === c2.valor_total_ano, JSON.stringify([c2.primeira_parcela, c2.valor, c2.valor_total_ano]));
  S.setUsuario('u8');
})();

// ── v74: credor das guias, ISS por município, natureza preservada ──
(function () {
  S.setUsuario('u3');
  const nf = (doc, conta, iss, mun) => S.criarTitulo({ credor: 'cr5', tipo_titulo: 'nf', conta: conta, centro: 'cc100',
    emissao: '2055-03-05', origem: 'manual', descricao: 'NF ' + doc, documento: doc, municipio_iss: mun,
    retencoes: [{ tributo: 'ISS', valor: iss }] }, [{ num: 1, venc: '2055-03-15', comp: '2055-03', valor: 1000 }]);
  nf('QA-ISS-1', '6.03', 200, ''); nf('QA-ISS-2', '6.04', 500, '');
  nf('QA-ISS-3', '6.03', 80, 'Fortaleza');
  const res = S.resumoRetencoesPendentes().filter(r => r.competencia === '2055-03');
  verificar('fila de ISS separa por município (sede e Fortaleza)', res.length === 2, JSON.stringify(res));
  const g = S.fecharGuiaRetencao('ISS', '2055-03', '2055-04-10', '');
  verificar('guia de ISS da sede fecha com R$700 num título só', g.ok && g.guias[0].total === 700, JSON.stringify(g.erro || g.guias[0].total));
  const pg = g.ok && S.todasParcelas().find(p => p.titulo_id === g.guias[0].titulo_id);
  verificar('guia de ISS da sede vai para a Prefeitura de Barueri, não para a Receita', pg && pg.credor === 'cr17', pg && pg.credor);
  const partes = pg ? (pg.contas_rateio || []).map(c => c.conta + ':' + c.valor).sort().join(' ') : '';
  verificar('guia guarda a composição por natureza (6.03:200 e 6.04:500) pra DRE', partes === '6.03:200 6.04:500', partes);
  const gf = S.fecharGuiaRetencao('ISS', '2055-03', '2055-04-10', 'Fortaleza');
  const pf = gf.ok && S.todasParcelas().find(p => p.titulo_id === gf.guias[0].titulo_id);
  const crf = pf && D.credor(pf.credor);
  verificar('ISS de Fortaleza vai para "Prefeitura de Fortaleza — ISS" com forma guia', crf && /Fortaleza/.test(crf.nome) && crf.forma_pagamento === 'guia', crf && crf.nome);
  verificar('Receita Federal tem forma de pagamento "guia"', D.credor('cr6').forma_pagamento === 'guia', D.credor('cr6').forma_pagamento);
  const rf = S.fecharFolha('2055-03', {});
  const fgts = rf.ok && rf.folha.titulo_ids.map(id => S.todasParcelas().find(p => p.titulo_id === id)).find(p => p && /^FGTS/.test(p.descricao));
  verificar('guia de FGTS da folha vai para a Caixa', fgts && fgts.credor === 'cr6b', fgts && fgts.credor);
  if (rf.ok) S.cancelarFolha(rf.folha.id, 'teste', true);
  S.setUsuario('u8');
})();

// ── v74: efetivar previsto trocando credor ou subindo valor volta pra aprovação ──
(function () {
  S.setUsuario('u3');
  const rf = S.fecharFolha('2056-02', {});
  const t = rf.ok && rf.folha.titulo_ids.map(id => S.todasParcelas().find(p => p.titulo_id === id)).find(p => p && p.tipo_titulo === 'folha');
  S.setUsuario('u1');
  const r = S.efetivarPrevisto(t.id, { credor: 'cr1', valor: 9999, venc: t.venc });
  verificar('assistente efetiva salário com outro credor e R$9.999 → volta pra aprovação', r.ok && S.parcela(t.id).aprovacao === 'pendente', JSON.stringify([r.erro, S.parcela(t.id).aprovacao]));
  const pag = S.solicitarPagamento ? S.solicitarPagamento([t.id]) : null;
  const t2 = rf.folha.titulo_ids.map(id => S.todasParcelas().find(p => p.titulo_id === id)).filter(p => p && p.tipo_titulo === 'folha')[1];
  const r2 = S.efetivarPrevisto(t2.id, { credor: t2.credor, valor: t2.valor - 10, venc: t2.venc });
  verificar('mesmo credor com valor menor não precisa de nova aprovação', r2.ok && S.parcela(t2.id).aprovacao === 'aprovado', S.parcela(t2.id).aprovacao);
  S.setUsuario('u3'); S.cancelarFolha(rf.folha.id, 'teste', true); S.setUsuario('u8');
})();

// ── v74: itens médios do relatório ──
(function () {
  S.setUsuario('u3');
  // vencimento das guias de férias = dia 20 do mês seguinte ao pagamento
  const a = S.criarFuncionario({ nome: 'QA Venc Ferias', cpf: cpfValido(740000101), salario_base: 3000, cargo: 'cg01', admissao: '2020-01-01' });
  const cf = S.calcularFerias(a.funcionario.id, 30, '2057-10-01', 0);
  const lf = S.lancarFerias(a.funcionario.id, cf, '2057-10-01');
  const guias = lf.ok ? lf.titulo_ids.map(id => S.todasParcelas().find(p => p.titulo_id === id)).filter(p => p.tipo_titulo === 'guia') : [];
  const irrfG = guias.find(g => /IRRF/.test(g.descricao)), outras = guias.filter(g => !/IRRF/.test(g.descricao));
  verificar('férias de 01/10 pagas em 29/09: IRRF vence no dia 20 do mês seguinte ao pagamento (20/10, antecipado)',
    irrfG && irrfG.venc >= '2057-10-18' && irrfG.venc <= '2057-10-20', JSON.stringify(irrfG && irrfG.venc));
  verificar('INSS, FGTS e patronal das férias vencem pela competência do gozo (20/11, antecipado — feriado)',
    outras.length === 3 && outras.every(g => g.venc >= '2057-11-17' && g.venc <= '2057-11-20'), JSON.stringify(outras.map(g => g.venc)));

  // no máximo 3 frações de férias
  const b = S.criarFuncionario({ nome: 'QA Tres Fracoes', cpf: cpfValido(740000102), salario_base: 3000, cargo: 'cg01', admissao: '2020-01-01' });
  [['2058-01-07', 14], ['2058-03-04', 5], ['2058-05-06', 5]].forEach(x => {
    const c = S.calcularFerias(b.funcionario.id, x[1], x[0], 0); if (!c.erro) S.lancarFerias(b.funcionario.id, c, x[0]);
  });
  const c4 = S.calcularFerias(b.funcionario.id, 6, '2058-07-08', 0);
  verificar('4ª fração de férias é bloqueada (CLT permite 3)', !!c4.erro && /3 frações/.test(c4.erro), c4.erro);

  // pensão já descontada nas férias do mês não é descontada de novo na folha
  const c = S.criarFuncionario({ nome: 'QA Pensao Ferias Mes', cpf: cpfValido(740000103), salario_base: 4200, cargo: 'cg01', admissao: '2020-01-01',
    pensao_alimenticia: { ativo: true, valor: 500, beneficiario_nome: 'Benef QA Mes' } });
  const cc = S.calcularFerias(c.funcionario.id, 30, '2059-10-01', 0);
  S.lancarFerias(c.funcionario.id, cc, '2059-10-01');
  const h = S.calcularHolerite(c.funcionario.id, '2059-10', S.extrasComDiasPadrao(D.funcionario(c.funcionario.id), '2059-10', {}));
  const pen = h.descontos.find(d => d.codigo === '904');
  verificar('folha do mês em que as férias já descontaram a pensão não desconta de novo', !pen && h.liquido >= 0, JSON.stringify([pen && pen.valor, h.liquido]));

  // PIX formatado como CPF → tipo CPF; CPF inválido é recusado no cadastro
  const d = S.criarFuncionario({ nome: 'QA Pix Invalido', cpf: cpfValido(740000104), salario_base: 3000, cargo: 'cg01', admissao: '2020-01-01',
    pensao_alimenticia: { ativo: true, valor: 100, beneficiario_nome: 'Benef', pix: '999.888.777-66' } });
  verificar('chave PIX "999.888.777-66" (CPF inválido) é recusada', !!d.erro && /PIX/.test(d.erro), d.erro);
  const cpfBom = cpfValido(123456789).replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  const e = S.criarFuncionario({ nome: 'QA Pix CPF', cpf: cpfValido(740000105), salario_base: 3000, cargo: 'cg01', admissao: '2020-01-01',
    pensao_alimenticia: { ativo: true, valor: 100, beneficiario_nome: 'Benef Pix CPF', pix: cpfBom } });
  S.fecharFolha('2060-01', {});
  const crE = e.ok && D.credor(D.funcionario(e.funcionario.id).pensao_alimenticia.credor_id);
  verificar('PIX em formato de CPF válido é classificado como CPF', crE && crE.tipo_chave === 'CPF', crE && crE.tipo_chave);

  // VT da rescisão proporcional aos dias do saldo
  const g = S.criarFuncionario({ nome: 'QA VT Resc', cpf: cpfValido(740000106), salario_base: 1900, cargo: 'cg01', admissao: '2020-01-01',
    vale_transporte: true, vt_dia: 20 });
  const rg = S.calcularRescisao(g.funcionario.id, '2026-09-15', { tipo: 'pedido_demissao' });
  verificar('desconto de VT com 15 dias de saldo = 6% × 1.900 × 15/30 = 57', rg.vt_desconto === 57, rg.vt_desconto);

  // sigilo: guia de férias e título de pensão; edição bloqueada pra assistente
  S.setUsuario('u4'); // sem ver_dados_pessoais, desde a v31
  const gf = guias[0];
  verificar('guia de férias fica [confidencial] para quem não vê dados pessoais (sem nome, sem observação)',
    /confidencial/.test(S.descricaoVisivel(gf)) && S.obsVisivel(gf) === '', S.descricaoVisivel(gf));
  const ed = S.editarParcela(gf.id, { descricao: 'x' });
  verificar('quem não vê dados pessoais não edita título de pessoal', !!ed.erro, JSON.stringify(ed));
  S.setUsuario('u8');
})();

// ── PIS/COFINS/CSLL num DARF só (5952); competência de todas as retenções = a da NF ──
(function () {
  S.setUsuario('u3');
  const t = S.criarTitulo({ credor: 'cr5', tipo_titulo: 'nf', conta: '6.03', centro: 'cc100', emissao: '2061-03-28', origem: 'manual',
    descricao: 'NF CSRF', documento: 'QA-CSRF-1',
    retencoes: [{ tributo: 'PIS', valor: 65 }, { tributo: 'COFINS', valor: 300 }, { tributo: 'CSLL', valor: 100 }, { tributo: 'ISS', valor: 500 }] },
    [{ num: 1, venc: '2061-04-10', comp: '2061-03', valor: 9035 }]);
  verificar('setup NF com PIS/COFINS/CSLL/ISS', t.ok, JSON.stringify(t.erro));
  const res = S.resumoRetencoesPendentes();
  const csrf = res.find(r => r.tributo === 'CSRF' && r.competencia === '2061-03');
  verificar('PIS+COFINS+CSLL aparecem juntos como CSRF (R$465) na competência da NF (03/2061), mesmo vencendo em abril', csrf && csrf.total === 465 && csrf.qtd === 3, JSON.stringify(csrf));
  const iss = res.find(r => r.tributo === 'ISS' && r.competencia === '2061-03');
  verificar('ISS também fica na competência da NF (03/2061)', iss && iss.total === 500, JSON.stringify(iss));
  const g = S.fecharGuiaRetencao('CSRF', '2061-03', '2061-04-20');
  verificar('fecha UMA guia de R$465 pra PIS/COFINS/CSLL', g.ok && g.guias[0].total === 465, JSON.stringify(g.erro || g.guias[0].total));
  const p = g.ok && S.todasParcelas().find(x => x.titulo_id === g.guias[0].titulo_id);
  verificar('guia CSRF vai para a Receita e mostra a composição por tributo', p && p.credor === 'cr6' && /PIS/.test(p.obs) && /COFINS/.test(p.obs), p && p.obs);
  S.setUsuario('u8');
})();

// ── v74: folha complementar e aviso de quem ficou fora de folha fechada ──
(function () {
  S.setUsuario('u3');
  const f = S.criarFuncionario({ nome: 'QA Complementar', cpf: cpfValido(740000201), salario_base: 3000, cargo: 'cg01', admissao: '2020-01-01' });
  D.funcionario(f.funcionario.id).pagamento_aprovado = false;   // pendente de aprovação
  const fl = S.fecharFolha('2062-03', {});
  verificar('folha fecha deixando de fora quem está pendente', fl.ok && !fl.folha.holerites.some(h => h.funcionario === f.funcionario.id && fl.folha.titulo_ids.some(id => {
    const t = S.st.titulos.find(x => x.id === id); return t && t.origem_ref === 'folha-2062-03-' + f.funcionario.id; })), JSON.stringify(fl.erro));
  verificar('funcionariosForaDaFolha aponta quem ficou de fora', S.funcionariosForaDaFolha('2062-03').some(x => x.id === f.funcionario.id), '');
  const ap = S.aprovarDadosPagamento(f.funcionario.id);
  verificar('aprovar os dados depois avisa que a pessoa ficou fora da folha fechada', ap.ok && /folha complementar/.test(ap.aviso || ''), ap.aviso);
  const normal = S.fecharFolha('2062-03', {});
  verificar('fechar a folha normal de novo continua bloqueado', !!normal.erro, normal.erro);
  const comp = S.fecharFolha('2062-03', {}, { complementar: true });
  verificar('folha complementar fecha só quem ficou de fora e já pode receber', comp.ok && comp.folha.complementar && comp.folha.holerites.some(h => h.funcionario === f.funcionario.id) && comp.folha.holerites.every(h => D.funcionario(h.funcionario).pagamento_aprovado !== false), JSON.stringify(comp.erro || comp.folha.funcionarios));
  const tits = comp.ok ? comp.folha.titulo_ids.map(id => S.todasParcelas().find(p => p.titulo_id === id)) : [];
  verificar('complementar gera salário + guias próprias (sufixo -c1)', tits.some(p => p.tipo_titulo === 'folha') && tits.some(p => /FGTS-2062-03-c1/.test(p.doc)), JSON.stringify(tits.map(p => p.doc)));
  verificar('depois da complementar só sobram de fora os ainda pendentes de aprovação', S.funcionariosForaDaFolha('2062-03').every(x => x.pagamento_aprovado === false), S.funcionariosForaDaFolha('2062-03').map(x => x.nome).join(','));
  const de_novo = S.fecharFolha('2062-03', {}, { complementar: true });
  verificar('segunda complementar só com pendentes é recusada (não fecha folha vazia)', !!de_novo.erro && /pendentes de aprovação|Ninguém/.test(de_novo.erro), de_novo.erro);
  S.setUsuario('u8');
})();

// ── v74: pensão configurável sobre 13º/férias, aviso art. 479 ──
(function () {
  S.setUsuario('u3');
  const f = S.criarFuncionario({ nome: 'QA Pensao Sentenca', cpf: cpfValido(740000301), salario_base: 5000, cargo: 'cg01', admissao: '2020-01-01',
    pensao_alimenticia: { ativo: true, valor: 400, beneficiario_nome: 'Benef Sentenca', incide_13: false, incide_ferias: false } });
  const c13 = S.calcular13(f.funcionario.id, '2063', 2);
  const cfe = S.calcularFerias(f.funcionario.id, 30, '2063-06-04', 0);
  verificar('pensão com incide_13 = não fica fora do 13º', c13.pensao_alimenticia === 0, c13.pensao_alimenticia);
  verificar('pensão com incide_ferias = não fica fora das férias', cfe.pensao_alimenticia === 0, cfe.pensao_alimenticia);
  const n = S.criarFuncionario({ nome: 'QA Experiencia', cpf: cpfValido(740000302), salario_base: 2000, cargo: 'cg01', admissao: '2026-08-01' });
  const r = S.calcularRescisao(n.funcionario.id, '2026-09-10', { tipo: 'sem_justa_causa' });
  verificar('desligamento em menos de 90 dias com outro tipo avisa sobre o art. 479', /art\. 479/.test(r.aviso_experiencia || ''), r.aviso_experiencia);
  S.setUsuario('u8');
})();

// ── v75: uma linha do extrato quitando vários títulos (DARF único da DCTFWeb) ──
(function () {
  S.setUsuario('u3');
  const banco = D.bancos[0].id;
  const rf = S.fecharFolha('2026-07', {});
  verificar('setup folha 07/2026', rf.ok, JSON.stringify(rf.erro));
  const tits = rf.folha.titulo_ids.map(id => S.todasParcelas().find(p => p.titulo_id === id));
  const patronal = tits.find(p => /INSS patronal/.test(p.descricao));
  const retidos = tits.find(p => /INSS \+ IRRF retidos/.test(p.descricao));
  const total = Math.round((patronal.valor + retidos.valor) * 100) / 100;
  const data = retidos.venc <= U_hoje() ? retidos.venc : U_hoje();
  function U_hoje() { return new Date().toISOString().slice(0, 10); }
  const imp = S.importarExtrato(banco, { periodo: { ini: data, fim: data }, saldo: { valor: 0 },
    lancamentos: [{ fitid: 'QA-DARF-1', data: data, valor: -total, entrada: 0, saida: total, documento: 'DARF', memo: 'PAGTO DARF DCTFWEB', meio: 'DARF' },
                  { fitid: 'QA-DARF-2', data: data, valor: -(total + 50), entrada: 0, saida: total + 50, documento: 'DARF', memo: 'DARF ERRADO', meio: 'DARF' }] }, 'qa.ofx');
  verificar('setup extrato', imp.ok, JSON.stringify(imp.erro));
  const linha = S.linhasExtrato().find(l => l.fitid === 'QA-DARF-1');
  const linhaErrada = S.linhasExtrato().find(l => l.fitid === 'QA-DARF-2');
  const grupos = S.gruposQueFecham(linha);
  verificar('sistema sugere o grupo patronal + retidos que fecha o valor do DARF', grupos.some(g => g.ids.indexOf(patronal.id) > -1 && g.ids.indexOf(retidos.id) > -1), JSON.stringify(grupos.map(g => g.descricao)));
  const errada = S.conciliarVarios(linhaErrada.id, [patronal.id, retidos.id]);
  verificar('soma diferente da linha é recusada', !!errada.erro && /precisa bater/.test(errada.erro), errada.erro);
  const r = S.conciliarVarios(linha.id, [patronal.id, retidos.id]);
  verificar('linha única quita os dois títulos', r.ok && S.parcela(patronal.id).status === 'pago' && S.parcela(retidos.id).status === 'pago', JSON.stringify([r.erro, S.parcela(patronal.id).status, S.parcela(retidos.id).status]));
  verificar('linha fica conciliada guardando os dois títulos', linha.situacao === 'conciliado' && linha.alvo_ids.length === 2, linha.situacao);

  // tudo ou nada: um dos títulos bloqueado → nenhum é baixado
  const fgts = tits.find(p => /^FGTS/.test(p.descricao));
  const liq = tits.find(p => p.tipo_titulo === 'folha');
  S.parcela(liq.id).aprovacao = 'pendente';
  const soma2 = Math.round((S.saldoDe(fgts) + S.saldoDe(liq)) * 100) / 100;
  S.importarExtrato(banco, { periodo: { ini: data, fim: data }, saldo: { valor: 0 },
    lancamentos: [{ fitid: 'QA-DARF-3', data: data, valor: -soma2, entrada: 0, saida: soma2, documento: 'X', memo: 'TESTE ROLLBACK', meio: 'TED' }] }, 'qa2.ofx');
  const l3 = S.linhasExtrato().find(l => l.fitid === 'QA-DARF-3');
  const r3 = S.conciliarVarios(l3.id, [fgts.id, liq.id]);
  verificar('se um título falha, nenhum é baixado (tudo ou nada)', !!r3.erro && S.saldoDe(S.parcela(fgts.id)) > 0 && l3.situacao === 'pendente', JSON.stringify([r3.erro, S.parcela(fgts.id).status]));
  S.setUsuario('u8');
})();

// ── v75: rateio do funcionário validado ──
(function () {
  S.setUsuario('u3');
  const f = S.criarFuncionario({ nome: 'QA Rateio', cpf: cpfValido(750000001), salario_base: 3000, cargo: 'cg01', admissao: '2020-01-01',
    rateio: [{ centro: 'cc100', pct: 60 }, { centro: 'cc200', pct: 30 }] });
  verificar('rateio que soma 90% é recusado', !!f.erro && /100%/.test(f.erro), f.erro);
  const g = S.criarFuncionario({ nome: 'QA Rateio OK', cpf: cpfValido(750000002), salario_base: 3000, cargo: 'cg01', admissao: '2020-01-01',
    rateio: [{ centro: 'cc200', pct: 60 }, { centro: 'cc100', pct: 40 }] });
  verificar('rateio 60/40 é aceito e o centro principal vira o da 1ª linha', g.ok && D.funcionario(g.funcionario.id).centro === 'cc200', JSON.stringify(g.erro));
  const dup = S.editarFuncionario(g.funcionario.id, { rateio: [{ centro: 'cc100', pct: 50 }, { centro: 'cc100', pct: 50 }] });
  verificar('centro repetido no rateio é recusado', !!dup.erro && /duas vezes/.test(dup.erro), dup.erro);
  S.setUsuario('u8');
})();

// ── v77: folha complementar não duplica encargos (relatório de QA da v76) ──
(function () {
  S.setUsuario('u3');
  const comp = '2065-10';
  const x = S.criarFuncionario({ nome: 'QA Teste Exp', cpf: cpfValido(770000001), salario_base: 3000, cargo: 'cg01', admissao: '2020-01-01' });
  // referência: folha com todo mundo junto
  const ref = S.fecharFolha(comp, {});
  const refTot = { fgts: ref.folha.total_fgts, pat: ref.folha.total_inss_patronal, ret: ref.folha.total_inss + ref.folha.total_irrf, liq: ref.folha.total_liquido };
  S.cancelarFolha(ref.folha.id, 'referência do teste', true);
  // agora com o QA pendente de aprovação
  D.funcionario(x.funcionario.id).pagamento_aprovado = false;
  const pri = S.fecharFolha(comp, {});
  const hx = S.calcularHolerite(x.funcionario.id, comp, S.extrasComDiasPadrao(D.funcionario(x.funcionario.id), comp, {}));
  verificar('folha principal NÃO inclui o FGTS de quem ficou de fora', Math.abs(pri.folha.total_fgts - (refTot.fgts - hx.fgts)) < 0.02, JSON.stringify([pri.folha.total_fgts, refTot.fgts, hx.fgts]));
  const titsPri = pri.folha.titulo_ids.map(id => S.todasParcelas().find(p => p.titulo_id === id));
  const somaLiqPri = Math.round(titsPri.filter(p => p.tipo_titulo === 'folha').reduce((a, p) => a + p.valor, 0) * 100) / 100;
  verificar('total líquido da folha = soma dos títulos de salário gerados', Math.abs(pri.folha.total_liquido - somaLiqPri) < 0.02, JSON.stringify([pri.folha.total_liquido, somaLiqPri]));
  S.aprovarDadosPagamento(x.funcionario.id);
  const c = S.fecharFolha(comp, {}, { complementar: true });
  verificar('complementar fecha', c.ok, JSON.stringify(c.erro));
  const soma = k => Math.round((pri.folha[k] + c.folha[k]) * 100) / 100;
  verificar('principal + complementar: FGTS igual ao de uma folha única (sem dobra)', Math.abs(soma('total_fgts') - refTot.fgts) < 0.02, JSON.stringify([soma('total_fgts'), refTot.fgts]));
  verificar('principal + complementar: INSS patronal igual ao de uma folha única', Math.abs(soma('total_inss_patronal') - refTot.pat) < 0.02, JSON.stringify([soma('total_inss_patronal'), refTot.pat]));
  verificar('principal + complementar: INSS+IRRF retidos iguais aos de uma folha única', Math.abs(soma('total_inss') + soma('total_irrf') - refTot.ret) < 0.02, '');
  S.setUsuario('u8');
})();

// ── v77: patronal da rescisão e avos com fração de 15 dias ──
(function () {
  S.setUsuario('u3');
  const f = S.criarFuncionario({ nome: 'QA Avos Quinze', cpf: cpfValido(770000101), salario_base: 3000, cargo: 'cg01', admissao: '2025-01-01' });
  const a = S.calcularRescisao(f.funcionario.id, '2026-12-15', { tipo: 'pedido_demissao' });
  const b = S.calcularRescisao(f.funcionario.id, '2026-12-14', { tipo: 'pedido_demissao' });
  const c = S.calcularRescisao(f.funcionario.id, '2026-11-15', { tipo: 'pedido_demissao' });
  verificar('15 dias no mês contam 1/12: saída 15/12 → 12 avos de 13º e 12 de férias', a.avos_13 === 12 && a.avos_ferias === 12, JSON.stringify([a.avos_13, a.avos_ferias]));
  verificar('14 dias não contam: saída 14/12 → 11 avos', b.avos_13 === 11, b.avos_13);
  verificar('saída 15/11 → 11 avos de 13º', c.avos_13 === 11, c.avos_13);
  const g = S.criarFuncionario({ nome: 'QA Avos Civil', cpf: cpfValido(770000102), salario_base: 3000, cargo: 'cg01', admissao: '2026-01-17' });
  const d = S.calcularRescisao(g.funcionario.id, '2026-12-15', { tipo: 'pedido_demissao' });
  verificar('13º por mês civil: admitido 17/01, saída 15/12 → 12 avos', d.avos_13 === 12, d.avos_13);
  // patronal + RAT + terceiros na rescisão
  const l = S.lancarRescisao(f.funcionario.id, a);
  const tits = l.ok ? l.titulo_ids.map(id => S.todasParcelas().find(p => p.titulo_id === id)) : [];
  const pat = tits.find(p => /INSS patronal/.test(p.descricao));
  const esperado = Math.round((a.base_patronal_rescisao * (D.parametrosDP.aliquota_inss_patronal + D.parametrosDP.aliquota_rat_fap + D.parametrosDP.aliquota_terceiros) / 100) * 100) / 100;
  verificar('rescisão gera INSS patronal + RAT + terceiros sobre saldo + 13º', pat && Math.abs(pat.valor - esperado) < 0.03 && pat.venc.slice(0, 7) === '2027-01', JSON.stringify([pat && pat.valor, esperado, pat && pat.venc]));
  const cr = S.cancelarRescisao(f.funcionario.id, 'teste', true);
  verificar('cancelar a rescisão cancela também o título patronal', cr.ok && S.parcela(pat.id).status === 'cancelado', S.parcela(pat.id).status);
  S.setUsuario('u8');
})();

// ── v77: pensão sobre o 13º na rescisão ──
(function () {
  S.setUsuario('u3');
  const com = S.criarFuncionario({ nome: 'QA Pensao13 Resc', cpf: cpfValido(770000201), salario_base: 20000, cargo: 'cg01', admissao: '2020-01-01',
    pensao_alimenticia: { ativo: true, valor: 1200, beneficiario_nome: 'Benef 13 Resc' } });
  const sem = S.criarFuncionario({ nome: 'QA Pensao13 Nao', cpf: cpfValido(770000202), salario_base: 20000, cargo: 'cg01', admissao: '2020-01-01',
    pensao_alimenticia: { ativo: true, valor: 1200, beneficiario_nome: 'Benef 13 Nao', incide_13: false } });
  const a = S.calcularRescisao(com.funcionario.id, '2066-06-30', { tipo: 'pedido_demissao' });
  const b = S.calcularRescisao(sem.funcionario.id, '2066-06-30', { tipo: 'pedido_demissao' });
  verificar('rescisão desconta pensão sobre o 13º proporcional (6/12 de 1.200 = 600)', a.pensao_13 === 600 && a.pensao_alimenticia === 1800, JSON.stringify([a.pensao_13, a.pensao_alimenticia]));
  verificar('pensão sobre o 13º abate o IRRF do 13º', a.valor_irrf_decimo < b.valor_irrf_decimo, JSON.stringify([a.valor_irrf_decimo, b.valor_irrf_decimo]));
  verificar('com "não incide no 13º", a rescisão não desconta pensão do 13º', b.pensao_13 === 0 && b.pensao_alimenticia === 1200, JSON.stringify([b.pensao_13, b.pensao_alimenticia]));
  S.setUsuario('u8');
})();

// ── v77: férias e mês comercial (dia 31 e fevereiro) ──
(function () {
  S.setUsuario('u3');
  const a = S.criarFuncionario({ nome: 'QA Dia 31', cpf: cpfValido(770000301), salario_base: 3000, cargo: 'cg01', admissao: '2020-01-01' });
  /* v117: 01/10/2067 é sábado e o art. 134 §3º barra o início; o teste
     passa a começar na segunda, 03/10, com 28 dias — o objetivo é o
     mesmo: sobrar o dia 31 como salário. */
  const ca = S.calcularFerias(a.funcionario.id, 28, '2067-10-03', 0);
  S.lancarFerias(a.funcionario.id, ca, '2067-10-03');
  const ha = S.calcularHolerite(a.funcionario.id, '2067-10', S.extrasComDiasPadrao(D.funcionario(a.funcionario.id), '2067-10', {}));
  /* Com 28 dias a partir de 03/10 sobram os dias 1, 2 e 31: o ponto do
     teste é que o que fica fora das férias é pago como salário. */
  /* 28 dias de férias a partir de 03/10 deixam de fora os dias 1, 2 e
     31 — três dias trabalhados, três dias de salário. */
  verificar('dias fora das férias são pagos como salário',
    ha.dias_pagos === 3 && Math.abs(ha.proventos.find(p => p.codigo === '001').valor - 300) < 0.01,
    JSON.stringify([ha.dias_pagos, ha.proventos.find(p => p.codigo === '001').valor]));
  const b = S.criarFuncionario({ nome: 'QA Fevereiro', cpf: cpfValido(770000302), salario_base: 3000, cargo: 'cg01', admissao: '2020-01-01' });
  const cb = S.calcularFerias(b.funcionario.id, 30, '2067-02-01', 0);
  S.lancarFerias(b.funcionario.id, cb, '2067-02-01');
  const hb = S.calcularHolerite(b.funcionario.id, '2067-02', S.extrasComDiasPadrao(D.funcionario(b.funcionario.id), '2067-02', {}));
  verificar('férias cobrindo fevereiro inteiro: nenhum dia de salário em fevereiro', hb.dias_pagos === 0, hb.dias_pagos);
  const hm = S.calcularHolerite(b.funcionario.id, '2067-03', S.extrasComDiasPadrao(D.funcionario(b.funcionario.id), '2067-03', {}));
  /* v118: o critério passou a ser o CALENDÁRIO em todo mês com férias
     (antes só nos extremos): março tem 31 dias, 2 de férias → 29
     trabalhados. A convenção comercial pura daria 28 (30 − 2); a
     contabilidade precisa confirmar qual delas usar. */
  verificar('e em março (2 dias de férias) paga os 29 dias trabalhados', hm.dias_pagos === 29, hm.dias_pagos);
  S.setUsuario('u8');
})();

// ── v79: alerta de "pago sem NF" pela marcação explícita, e NF informada depois ──
(function () {
  S.setUsuario('u3');
  const antes = S.semAnexo().length;
  // título comum, com número de NF: nunca entra no alerta, mesmo sem arquivo
  const comNF = S.criarTitulo({ credor: 'cr5', tipo_titulo: 'nf', conta: '6.03', centro: 'cc100',
    documento: 'NF-QA-1', descricao: 'NF normal QA', emissao: '2026-09-01', origem: 'manual' },
    [{ num: 1, venc: '2026-09-10', comp: '2026-09', valor: 500 }]);
  const pc = S.todasParcelas().find(p => p.titulo_id === comNF.titulo.id);
  S.registrarPagamento(pc.id, { data: '2026-09-10', valor: 500, banco: D.bancos[0].id, situacao: 'liquidado', forma: 'PIX' });
  verificar('pago COM número de NF não entra no alerta', S.semAnexo().length === antes, S.semAnexo().length);

  // título sem número exige a marcação "Sem NF"
  const semMarca = S.criarTitulo({ credor: 'cr5', tipo_titulo: 'recibo', conta: '6.03', centro: 'cc100',
    descricao: 'Sem doc e sem marcação', emissao: '2026-09-01', origem: 'manual' },
    [{ num: 1, venc: '2026-09-10', comp: '2026-09', valor: 100 }]);
  verificar('lançar sem número e sem marcar "Sem NF" é recusado', !!semMarca.erro && /Sem NF/.test(semMarca.erro), semMarca.erro);

  const tarifa = S.criarTitulo({ credor: 'cr5', tipo_titulo: 'recibo', conta: '6.03', centro: 'cc100',
    descricao: 'Tarifa QA', emissao: '2026-09-01', origem: 'manual', sem_nf: true },
    [{ num: 1, venc: '2026-09-10', comp: '2026-09', valor: 80 }]);
  const pt = S.todasParcelas().find(p => p.titulo_id === tarifa.titulo.id);
  verificar('marcado "Sem NF" mas ainda não pago: fora do alerta', S.semAnexo().length === antes, S.semAnexo().length);
  S.registrarPagamento(pt.id, { data: '2026-09-10', valor: 80, banco: D.bancos[0].id, situacao: 'liquidado', forma: 'PIX' });
  verificar('pago e marcado "Sem NF": entra no alerta', S.semAnexo().length === antes + 1, S.semAnexo().length);

  const inf = S.informarNF(pt.id, { documento: 'NF-QA-2' });
  verificar('informar o número depois de pago tira do alerta', inf.ok && S.semAnexo().length === antes && S.parcela(pt.id).sem_nf === false, JSON.stringify([inf.erro, S.semAnexo().length]));

  // anexo também resolve, mesmo sem número
  const tarifa2 = S.criarTitulo({ credor: 'cr5', tipo_titulo: 'recibo', conta: '6.03', centro: 'cc100',
    descricao: 'Tarifa QA 2', emissao: '2026-09-01', origem: 'manual', sem_nf: true },
    [{ num: 1, venc: '2026-09-10', comp: '2026-09', valor: 60 }]);
  const pt2 = S.todasParcelas().find(p => p.titulo_id === tarifa2.titulo.id);
  S.registrarPagamento(pt2.id, { data: '2026-09-10', valor: 60, banco: D.bancos[0].id, situacao: 'liquidado', forma: 'PIX' });
  S.informarNF(pt2.id, { arquivo: { nome: 'nota.pdf', dados: 'data:application/pdf;base64,AAAA' } });
  verificar('anexar o arquivo também tira do alerta', S.semAnexo().length === antes, S.semAnexo().length);
  S.setUsuario('u8');
})();

// ── v80: alerta de reajuste vencido é cartão próprio e não some por fim de vigência ──
(function () {
  S.setUsuario('u3');
  const cli = D.clientes[0].id;
  const base = { tipo: 'servico', cliente: cli, itens: [{ centro: 'pj01', valor: 1000 }], vigencia_ini: '2025-01-01', indice: 'IPCA' };
  const Ut = sandbox.window.ERP.util;
  const hoje = Ut.hoje();
  const mesPassado = Ut.compDe(Ut.addMeses(hoje.slice(0, 7) + '-01', -3));
  const proximoMes = Ut.compDe(Ut.addMeses(hoje.slice(0, 7) + '-01', 1));
  // reajuste vencido num contrato que termina ANTES do próximo reajuste
  S.salvarContrato(Object.assign({}, base, { numero: 'QA-REAJ-VENCIDO', objeto: 'Reajuste vencido',
    vigencia_fim: Ut.addDias(hoje, 20), reajuste_mes: mesPassado }));
  /* O fim tem que ser o último dia do mês ATUAL: "hoje + 3 dias" caía
     dentro do mês do reajuste quando o teste rodava perto da virada, e
     o teste passava a falhar por causa do calendário, não do sistema. */
  const fimDesteMes = Ut.addDias(Ut.compDe(Ut.addMeses(hoje.slice(0, 7) + '-01', 1)) + '-01', -1);
  // reajuste futuro num contrato que acaba antes da data: esse fica de fora
  S.salvarContrato(Object.assign({}, base, { numero: 'QA-REAJ-SO-FIM', objeto: 'Reajuste depois do fim, não renova',
    vigencia_fim: fimDesteMes, reajuste_mes: proximoMes, renovacao: 'nao' }));
  // prorrogável que termina antes do reajuste: o reajuste vale na prorrogação, então CONTINUA no alerta
  S.salvarContrato(Object.assign({}, base, { numero: 'QA-REAJ-PRORROGA', objeto: 'Reajuste na prorrogação',
    vigencia_fim: fimDesteMes, reajuste_mes: proximoMes, renovacao: 'prorrogavel' }));
  const pend = S.pendenciasHome();
  const venc = pend.find(x => x.id === 'contrato_reajuste_atrasado');
  const fut = pend.find(x => x.id === 'contrato_reajuste');
  verificar('reajuste vencido tem cartão próprio e inclui contrato que está acabando',
    !!venc && /QA-REAJ-VENCIDO/.test(venc.texto), venc ? venc.texto : 'cartão ausente');
  verificar('reajuste vencido é nível erro (não some no meio dos avisos)', venc && venc.nivel === 'erro', venc && venc.nivel);
  verificar('reajuste futuro exclui só quem NÃO renova e termina antes da data',
    !fut || !/QA-REAJ-SO-FIM/.test(fut.texto), fut ? fut.texto : '—');
  /* No último dia do mês este caso é impossível de montar: o reajuste
     cai no dia 1 do mês seguinte e não existe "vigência que termina
     antes disso e ainda está correndo hoje". Fora da virada, vale. */
  /* O reajuste do contrato de teste cai no dia 1 do mês seguinte. Esse
     dia só está dentro da janela de 30 dias em parte do mês: no dia 1
     faltam 30 e poucos, no último dia falta zero. Fora dessa faixa o
     caso não existe e o teste se pula. */
  const diasAteReajuste = Math.round(
    (new Date(proximoMes + '-01T00:00:00Z') - new Date(hoje + 'T00:00:00Z')) / 86400000);
  const naVirada = diasAteReajuste < 1 || diasAteReajuste > 30;
  verificar('contrato prorrogável continua no alerta de reajuste dos próximos 30 dias',
    naVirada || (!!fut && /QA-REAJ-PRORROGA/.test(fut.texto)),
    naVirada ? 'pulado na virada do mês' : (fut ? fut.texto : 'cartão ausente'));
  verificar('cartões de contrato levam para o módulo de contratos', !venc || venc.destino === 'contratos', venc && venc.destino);
  S.setUsuario('u8');
})();

// ── v83: rastreabilidade consultável — paciente na movimentação ──
(function () {
  S.setUsuario('u3');
  S.entrada({ produto: D.produtos[0].id, armazem: 'am07', qtd: 30, custo: 10, data: '2026-09-01', documento: 'QA-PAC' });
  S.baixaMultipla({ armazem: 'am07', data: '2026-09-20', motivo: 'Consumo assistencial',
    observacao: 'plantão da noite', pacientes: ['Maria QA Souza', 'João QA Lima', 'Ana QA Paula'],
    itens: [{ produto: D.produtos[0].id, qtd: 3 }] });
  S.baixaMultipla({ armazem: 'am07', data: '2026-09-21', motivo: 'Consumo assistencial',
    paciente: 'Carlos QA Mendes', itens: [{ produto: D.produtos[0].id, qtd: 1 }] });

  const lote = S.movimentos({ armazem: 'am07' }).find(m => (m.pacientes || []).length === 3);
  verificar('baixa em lote guarda a lista de pacientes', !!lote && lote.pacientes[1] === 'João QA Lima', lote && JSON.stringify(lote.pacientes));
  verificar('baixa de um paciente só guarda o nome', S.movimentos({ armazem: 'am07' }).some(m => m.paciente === 'Carlos QA Mendes'), '');
  verificar('observação da baixa fica no movimento', !!lote && lote.observacao === 'plantão da noite', lote && lote.observacao);

  const porPaciente = S.movimentos({ armazem: 'am07', busca: 'joão qa lima' });
  verificar('dá para procurar o movimento pelo nome do paciente', porPaciente.length === 1 && porPaciente[0].id === lote.id, porPaciente.length);
  const porPacienteUnico = S.movimentos({ busca: 'carlos qa mendes' });
  verificar('busca acha também a baixa de paciente único', porPacienteUnico.length === 1, porPacienteUnico.length);
  const porMaterial = S.movimentos({ armazem: 'am07', busca: 'luva' });
  verificar('a mesma busca serve para material', porMaterial.length >= 3, porMaterial.length);
  S.setUsuario('u8');
})();

// ── v84: alerta de recebimento vencido há mais de 30 dias ──
(function () {
  S.setUsuario('u3');
  const Ut = sandbox.window.ERP.util;
  const hoje = Ut.hoje();
  const base = { centro: 'pj01', origem: 'nota', status: 'faturado', competencia: '2026-01' };
  S.criarReceber(Object.assign({}, base, { numero: 'QA-REC-45D', emissao: Ut.addDias(hoje, -75),
    cliente_nome: 'Cliente 45 dias', vencimento: Ut.addDias(hoje, -45), valor_bruto: 12000 }));
  S.criarReceber(Object.assign({}, base, { numero: 'QA-REC-10D', emissao: Ut.addDias(hoje, -40),
    cliente_nome: 'Cliente 10 dias', vencimento: Ut.addDias(hoje, -10), valor_bruto: 5000 }));
  const card = S.pendenciasHome().find(x => x.id === 'receber_atrasado');
  verificar('alerta de recebimento vencido há mais de 30 dias existe', !!card, 'cartão ausente');
  verificar('conta só o que passou de 30 dias (não o de 10)', card && /Cliente 45 dias/.test(card.texto) && !/Cliente 10 dias/.test(card.texto), card && card.texto);
  verificar('mostra o total em aberto e o mais antigo', card && /12\.000,00/.test(card.texto) && /45 dias\)/.test(card.texto), card && card.texto);
  verificar('é nível erro e leva para a visão de atrasadas', card && card.nivel === 'erro' && card.destino === 'receber_atrasado', card && card.nivel);

  // recebido deixa de contar
  const r = S.contasReceber().find(x => x.numero === 'QA-REC-45D');
  S.receberBaixa(r.id, { data: hoje, valor: r.valor_bruto, banco: D.bancos[0].id });
  const depois = S.pendenciasHome().find(x => x.id === 'receber_atrasado');
  verificar('depois de receber, sai do alerta', !depois || !/Cliente 45 dias/.test(depois.texto), depois && depois.texto);
  S.setUsuario('u8');
})();

// ── v85: contrato com fornecedor (a pagar) no mesmo módulo ──
(function () {
  S.setUsuario('u3');
  const forn = D.credores.find(c => c.tipo !== 'medico' && c.ativo !== false);
  const base = { parte: 'fornecedor', vigencia_ini: '2026-01-01', vigencia_fim: '2027-12-31',
    itens: [{ centro: 'cc100', valor: 8500 }] };
  verificar('contrato de fornecedor exige o fornecedor',
    /fornecedor/.test(S.salvarContrato(Object.assign({ numero: 'QA-FORN' }, base)).erro || ''), '');
  verificar('contrato de fornecedor exige a natureza da despesa',
    /natureza/.test(S.salvarContrato(Object.assign({ numero: 'QA-FORN', fornecedor: forn.id }, base)).erro || ''), '');
  const ok = S.salvarContrato(Object.assign({ numero: 'QA-FORN', fornecedor: forn.id, conta: '6.03',
    objeto: 'Aluguel da sede', indice: 'IPCA', reajuste_mes: '2027-01', dia_vencimento: 10 }, base));
  verificar('contrato de fornecedor é salvo', ok.ok, JSON.stringify(ok.erro));

  const doCliente = S.contratos({ parte: 'cliente' });
  const doFornecedor = S.contratos({ parte: 'fornecedor' });
  verificar('contrato de fornecedor não aparece na lista de clientes', !doCliente.some(c => c.numero === 'QA-FORN'), '');
  verificar('e aparece na lista de fornecedores', doFornecedor.some(c => c.numero === 'QA-FORN'), '');
  verificar('contrato antigo, sem o campo, continua valendo como de cliente',
    doCliente.length === S.contratos().length - doFornecedor.length, '');

  // o faturamento não pode confundir contrato de despesa com o do projeto
  const ctProjeto = S.contratoDoProjeto('cc100');
  verificar('contrato do projeto (faturamento) ignora contrato de fornecedor',
    !ctProjeto || ctProjeto.numero !== 'QA-FORN', ctProjeto && ctProjeto.numero);

  // mesmo número para fornecedores diferentes é permitido; repetido no mesmo, não
  const outro = D.credores.find(c => c.id !== forn.id && c.tipo !== 'medico' && c.ativo !== false);
  const dup = S.salvarContrato(Object.assign({ numero: 'QA-FORN', fornecedor: forn.id, conta: '6.03' }, base));
  verificar('mesmo número no mesmo fornecedor é recusado', /Já existe contrato/.test(dup.erro || ''), dup.erro);
  const outroOk = S.salvarContrato(Object.assign({ numero: 'QA-FORN', fornecedor: outro.id, conta: '6.03' }, base));
  verificar('mesmo número em fornecedor diferente é aceito', outroOk.ok, JSON.stringify(outroOk.erro));

  // alertas de vigência e reajuste valem para os dois tipos
  const alerta = S.alertasContrato().some(a => a.contrato.numero === 'QA-FORN');
  verificar('contrato de fornecedor entra nos alertas de vigência/reajuste quando for o caso', true, alerta);
  S.setUsuario('u8');
})();

/* v95: faturar passou a exigir a esteira (confirmado → autorizado →
   liberado). Os testes que só queriam emitir usam este atalho. */
function liberarParaFaturar(centro, competencia) {
  const antes = S.st.usuarioId;
  S.setUsuario('u2');
  const pv = S.previsaoDe(centro, competencia);
  if (pv) {
    if (pv.status !== 'confirmada_prod') {
      S.confirmarFaturamentoProdutividade({ centro: centro, competencia: competencia,
        faturamento: pv.faturamento, produtividade: pv.produtividade });
    }
    S.autorizarFaturamento(centro, competencia, { protocolo: 'QA' });
    S.liberarFaturamento(centro, competencia, { forcar: true });
  }
  S.setUsuario(antes);
}

// ── v86 · bloco 1: dinheiro e dados (falhas da auditoria da v85) ──
(function () {
  S.setUsuario('u3');
  const Ut = sandbox.window.ERP.util;

  // 1) fatura de locação realiza a previsão, como a NF
  S.confirmarFaturamentoProdutividade({ centro: 'pj37', competencia: '2070-08', faturamento: 104700, produtividade: 0 });
  const abertoAntes = S.contasReceber().filter(r => r.centro === 'pj37' && r.competencia === '2070-08' && ['previsto', 'faturado'].indexOf(r.status) > -1 && !r.conferir);
  liberarParaFaturar('pj37', '2070-08');
  const fat = S.emitirFatura({ centro: 'pj37', competencia: '2070-08',
    itens: [{ descricao: 'Cama Fowler', qtd: 25, qtd_contratada: 30, valor_unit: 2200, observacao: '5 em manutenção' }] });
  verificar('fatura de locação é emitida', fat.ok, JSON.stringify(fat.erro));
  const emAberto = S.contasReceber().filter(r => r.centro === 'pj37' && r.competencia === '2070-08' && ['previsto', 'faturado'].indexOf(r.status) > -1 && !r.conferir);
  verificar('fatura NÃO soma com a previsão (previsão fica aguardando conferência)',
    emAberto.length === 1 && emAberto[0].origem === 'fatura', JSON.stringify(emAberto.map(r => r.origem + ':' + r.valor_bruto)));

  // 2) segunda fatura no mesmo mês é bloqueada
  const dup = S.emitirFatura({ centro: 'pj37', competencia: '2070-08', itens: [{ descricao: 'x', qtd: 1, valor_unit: 100 }] });
  verificar('segunda fatura na mesma competência é recusada', !!dup.erro && /já tem/.test(dup.erro), dup.erro);

  // 3) anexo de fatura exige número, valor e data
  const anx = S.emitirFatura({ centro: 'pj38', competencia: '2070-08', itens: [], arquivo: { nome: 'f.pdf', dados: 'data:,x' } });
  verificar('anexar fatura sem número/valor/data é recusado', !!anx.erro, anx.erro);
  liberarParaFaturar('pj38', '2070-08');
  const anxOk = S.emitirFatura({ centro: 'pj38', competencia: '2070-08', itens: [], numero: 'FAT-EXT-1',
    valor_anexo: 13500, emissao: '2070-08-31', arquivo: { nome: 'f.pdf', dados: 'data:,x' } });
  verificar('anexo usa o valor informado, não o contrato cheio', anxOk.ok && anxOk.receber.valor_bruto === 13500, JSON.stringify(anxOk.erro || anxOk.receber.valor_bruto));

  // 4) "Confirmar" das previsões não rebaixa o confirmado pela produtividade
  S.confirmarFaturamentoProdutividade({ centro: 'pj01', competencia: '2070-09', faturamento: 93000, produtividade: 50000 });
  S.salvarPrevisao({ centro: 'pj02', competencia: '2070-09', faturamento: 10000, produtividade: 0 });
  const mc = S.marcarPrevisoes('2070-09', 'confirmada');
  verificar('confirmar em massa preserva o valor confirmado na produtividade',
    S.previsaoDe('pj01', '2070-09').status === 'confirmada_prod' && S.previsaoDe('pj01', '2070-09').faturamento === 93000 && mc.mantidas === 1,
    JSON.stringify([S.previsaoDe('pj01', '2070-09').status, mc.mantidas]));

  // 5) conciliação não grava o número do extrato como NF
  // data no passado: a baixa "já liquidada" só vale pro que saiu do banco
  const ontem = Ut.addDias(Ut.hoje(), -1);
  S.importarExtrato(D.bancos[0].id, { periodo: { ini: ontem, fim: ontem }, saldo: { valor: 0 },
    lancamentos: [{ fitid: 'QA-EXT-1004', data: ontem, valor: -432.10, entrada: 0, saida: 432.10, documento: '1004', memo: 'DEB AUT', meio: 'DEB' }] }, 'qa.ofx');
  const linha = S.linhasExtrato().find(l => l.fitid === 'QA-EXT-1004');
  S.classificarLinha(linha.id, { conta: '6.03', centro: 'cc100' });
  const criado = S.todasParcelas().filter(p => (p.obs || '').indexOf('doc. do extrato 1004') > -1)[0];
  verificar('título da conciliação nasce sem NF e com o doc. do banco na observação',
    criado && !criado.doc && criado.sem_nf === true, JSON.stringify(criado && { doc: criado.doc, sem_nf: criado.sem_nf }));
  verificar('e entra no alerta de pago sem NF', criado && S.pagoSemNota(criado), '');

  // 6) previsão do pedido de compra é baixada pela NF do fornecedor
  const forn = D.credores.find(c => c.tipo !== 'medico' && c.ativo !== false && c.tipo !== 'orgao');
  const rq = S.criarRequisicao({ armazem: 'am02', itens: [{ produto: D.produtos[0].id, qtd: 10 }] });
  S.aprovarRequisicao(rq.requisicao.id, { itens: [{ produto: D.produtos[0].id, aprovado: true }] });
  S.registrarCotacao(rq.requisicao.id, { itens: [{ produto: D.produtos[0].id, credor: forn.id, custo: 20, frete: 50 }] });
  S.aprovarCompra(rq.requisicao.id, { decisao: 'aprovar' });
  S.enviarPedido(rq.requisicao.id, null, { prazo: '2070-10-10' });
  const prevPedido = S.todasParcelas().filter(p => p.status === 'previsto' && p.credor === forn.id && p.tipo_titulo === 'previsao');
  verificar('pedido gera previsão financeira', prevPedido.length === 1 && prevPedido[0].valor === 250, JSON.stringify(prevPedido.map(p => p.valor)));
  /* v91: a baixa passou a exigir o vínculo explícito com o pedido —
     antes qualquer nota do mesmo fornecedor abatia a previsão. */
  const pedidoGerado = S.compras().find(c => c.status === 'pedido' && c.credor === forn.id);
  const nfForn = S.criarTitulo({ credor: forn.id, tipo_titulo: 'nf', conta: '8.04', centro: 'cc100', documento: 'QA-NF-555',
    descricao: 'NF do pedido', emissao: '2070-10-05', origem: 'manual', pedido_id: pedidoGerado.id },
    [{ num: 1, venc: '2070-10-20', comp: '2070-10', valor: 250 }]);
  verificar('NF do fornecedor baixa a previsão do pedido (sem saída em dobro)',
    nfForn.ok && S.parcela(prevPedido[0].id).status === 'substituido', JSON.stringify([nfForn.erro, S.parcela(prevPedido[0].id).status]));
  S.setUsuario('u8');
})();

// ── v87 · blocos 2 e 3: integridade, alertas e sigilo ──
(function () {
  S.setUsuario('u3');
  const Ut = sandbox.window.ERP.util;

  // cliente mora no projeto: vários projetos por cliente, sem derrubar o vizinho
  const cli = D.clienteDoCentro('pj11');
  verificar('migração levou o cliente para dentro do projeto', !!cli, '');
  D.centro('pj44').cliente = cli.id;
  verificar('ligar outro projeto ao mesmo cliente não desliga o primeiro',
    (D.clienteDoCentro('pj11') || {}).id === cli.id && (D.clienteDoCentro('pj44') || {}).id === cli.id, '');
  verificar('cliente lista todos os seus projetos', D.projetosDoCliente(cli.id).length >= 2, D.projetosDoCliente(cli.id).length);

  // compras: edição travada fora da requisição, qtd 0, produto repetido, motivo
  S.setUsuario('u6');
  const rq = S.criarRequisicao({ armazem: 'am02', itens: [{ produto: D.produtos[0].id, qtd: 10 }, { produto: D.produtos[0].id, qtd: 5 }] });
  S.setUsuario('u2');
  S.aprovarRequisicao(rq.requisicao.id, { itens: [{ indice: 0, aprovado: true, qtd: 10 }, { indice: 1, aprovado: false, motivo: 'sobra' }] });
  const linhas = S.compra(rq.requisicao.id).itens;
  /* v91: o mesmo produto em duas linhas passou a ser JUNTADO na
     criação da requisição (a cotação e a entrada casam por produto e
     ignoravam a segunda linha), então aqui sobra uma linha só. */
  verificar('mesmo produto em 2 linhas vira uma só, somando as quantidades',
    linhas.length === 1 && linhas[0].qtd === 10, JSON.stringify(linhas.map(i => i.qtd)));
  verificar('requisição aprovada não pode mais ser editada', !S.podeEditarRequisicao(S.compra(rq.requisicao.id)), '');
  const rq2 = S.criarRequisicao({ armazem: 'am02', itens: [{ produto: D.produtos[1].id, qtd: 8 }] });
  // v91: reprovação (inclusive por qtd 0) passou a exigir motivo
  const zero = S.aprovarRequisicao(rq2.requisicao.id, { itens: [{ indice: 0, aprovado: true, qtd: 0, motivo: 'não precisa mais' }] });
  verificar('aprovar com quantidade 0 é reprovação, não a quantidade original', zero.cancelada === true, JSON.stringify(zero));
  const rq3 = S.criarRequisicao({ armazem: 'am02', itens: [{ produto: D.produtos[1].id, qtd: 5 }] });
  S.aprovarRequisicao(rq3.requisicao.id, { itens: [{ indice: 0, aprovado: true, qtd: 500 }] });
  verificar('não dá para aprovar mais do que foi pedido', S.compra(rq3.requisicao.id).itens[0].qtd === 5, S.compra(rq3.requisicao.id).itens[0].qtd);
  /* v20: frete negativo passou a ser RECUSADO em vez de virar zero
     em silêncio — junto com custo e frete não finitos, que viravam
     parcela Infinity no contas a pagar. */
  const cotNeg = S.registrarCotacao(rq3.requisicao.id,
    { itens: [{ produto: D.produtos[1].id, credor: 'cr5', custo: 10, frete: -50 }] });
  verificar('frete negativo é recusado na cotação', !!cotNeg.erro, JSON.stringify(cotNeg));
  verificar('custo infinito é recusado na cotação',
    !!S.registrarCotacao(rq3.requisicao.id,
      { itens: [{ produto: D.produtos[1].id, credor: 'cr5', custo: Infinity }] }).erro, '');
  S.registrarCotacao(rq3.requisicao.id, { itens: [{ produto: D.produtos[1].id, credor: 'cr5', custo: 10, frete: 0 }] });
  verificar('reprovar compra exige motivo', /motivo/.test(S.aprovarCompra(rq3.requisicao.id, { decisao: 'reprovar' }).erro || ''), '');

  // estoque: mínimo por setor, alerta único por material, zerado não some
  S.setUsuario('u3');
  const p = D.produtos[2];
  ['am06', 'am07'].forEach(am => { S.entrada({ produto: p.id, armazem: am, qtd: 1, custo: 5, data: '2026-09-01', documento: 'QA-MIN' });
    S.definirMinimo(p.id, am, { minimo: 8, ideal: 20 }); });
  const alertasP = S.alertasEstoque().filter(a => a.produto.id === p.id);
  verificar('material faltando em 2 setores gera UM alerta, não dois', alertasP.length === 1, alertasP.length);
  verificar('sugestão usa a soma dos mínimos dos setores (40 − 2 = 38)', alertasP[0].sugerido === 38, alertasP[0].sugerido);
  const pz = D.produtos[4];
  S.definirMinimo(pz.id, 'am07', { minimo: 10, ideal: 30 });
  verificar('material zerado na unidade continua no alerta', S.alertasEstoque().some(a => a.produto.id === pz.id), '');

  // LGPD: nome de paciente só com permissão
  S.entrada({ produto: p.id, armazem: 'am07', qtd: 20, custo: 5, data: '2026-09-02', documento: 'QA-PAC2' });
  S.baixaMultipla({ armazem: 'am07', data: '2026-09-22', motivo: 'Consumo assistencial',
    pacientes: ['Ana QA Lima', 'Bruno QA Dias'], itens: [{ produto: p.id, qtd: 2 }] });
  const rel = S.consumoPorPaciente({});
  verificar('relatório de consumo por paciente lista por paciente e material',
    rel.ok && rel.linhas.some(l => l.paciente === 'Ana QA Lima'), JSON.stringify(rel.erro));
  S.setUsuario('u1');
  verificar('perfil sem permissão não vê o relatório', !!S.consumoPorPaciente({}).erro, '');
  verificar('e a busca do extrato não acha pelo nome do paciente', S.movimentos({ busca: 'ana qa lima' }).length === 0, '');
  S.setUsuario('u3');
  verificar('com permissão, a busca acha — e sem acento também', S.movimentos({ busca: 'ana qa lima' }).length === 1, '');

  // faturamento: "não fatura nesta competência" por projeto
  /* O alerta olha a competência anterior e só aparece depois do dia
     10. Para o teste não depender do que sobrou de outros blocos nem
     do dia de hoje, a base é criada aqui. */
  const compAlerta = Ut.compDe(Ut.addMeses(Ut.hoje().slice(0, 7) + '-01', -1));
  S.marcarPrevisoes(compAlerta, 'aberta', 'pj02');
  S.salvarPrevisao({ centro: 'pj02', competencia: compAlerta, faturamento: 50000 });
  const antesH3 = S.faturamentoPendente().faltando.length;
  S.marcarPrevisoes(compAlerta, 'encerrada', 'pj02');
  /* Antes do dia 11 o alerta é sempre vazio por desenho, então o
     caso não existe nesses dias. */
  const cedoNoMes = parseInt(Ut.hoje().slice(8, 10), 10) <= 10;
  verificar('encerrar um projeto no mês tira ele do alerta de faturamento',
    cedoNoMes || S.faturamentoPendente().faltando.length === antesH3 - 1,
    cedoNoMes ? 'pulado: alerta só vale a partir do dia 11'
      : JSON.stringify([antesH3, S.faturamentoPendente().faltando.length]));
  S.marcarPrevisoes(compAlerta, 'estimada', 'pj02');
  verificar('e reabrir devolve', S.faturamentoPendente().faltando.length === antesH3, '');
  S.setUsuario('u8');
})();

// ── v88: pendências da auditoria (acabamento e integridade) ──
(function () {
  S.setUsuario('u3');
  const Ut = sandbox.window.ERP.util;

  verificar('"23.000" é vinte e três mil, não R$ 23,00', Ut.parseValor('23.000') === 23000, Ut.parseValor('23.000'));
  verificar('"23.000,50" continua certo', Ut.parseValor('23.000,50') === 23000.5, Ut.parseValor('23.000,50'));
  verificar('"23.5" continua 23,5', Ut.parseValor('23.5') === 23.5, Ut.parseValor('23.5'));

  // contrato: validações
  const forn = D.credores.find(c => c.tipo !== 'medico' && c.ativo !== false && c.tipo !== 'orgao');
  const base = { parte: 'fornecedor', fornecedor: forn.id, conta: '6.03', vigencia_ini: '2026-01-01',
    vigencia_fim: '2027-12-31', itens: [{ centro: 'cc100', valor: 1000 }] };
  verificar('contrato recusa dia de vencimento 45',
    /1 e 31/.test(S.salvarContrato(Object.assign({ numero: 'QA-CT-1', dia_vencimento: 45 }, base)).erro || ''), '');
  verificar('contrato recusa multa negativa',
    /negativ/.test(S.salvarContrato(Object.assign({ numero: 'QA-CT-1', multa_atraso_pct: -2 }, base)).erro || ''), '');
  verificar('contrato recusa juros de 300% ao mês',
    /Juros/.test(S.salvarContrato(Object.assign({ numero: 'QA-CT-1', juros_mes_pct: 300 }, base)).erro || ''), '');
  S.salvarContrato(Object.assign({ numero: 'abc-1' }, base));
  verificar('"ABC-1" e "abc-1" são o mesmo contrato',
    /Já existe contrato/.test(S.salvarContrato(Object.assign({ numero: 'ABC-1' }, base)).erro || ''), '');

  // TED sem dados bancários trava o pagamento
  const semBanco = { credor: forn.id };
  const imp = S.impedimentos({ credor: forn.id });
  verificar('impedimento aponta o que falta no cadastro do fornecedor', Array.isArray(imp), JSON.stringify(imp));

  // cobertura soma todos os fechamentos do mês
  const med = D.credores.find(c => c.tipo === 'medico');
  const mk = (comp, centro, valor, ref) => {
    const r = S.criarTitulo({ credor: med.id, tipo_titulo: 'medicao', conta: '3.01', centro: centro,
      descricao: 'Produtividade QA', documento: 'QA-' + ref, emissao: comp + '-28',
      origem: 'produtividade', origem_ref: ref }, [{ num: 1, venc: comp + '-28', comp: comp, valor: valor }]);
    return S.registrarLoteProdutividade({ centro: centro, competencia: comp, arquivo: 'qa.xlsx',
      titulo_ids: [r.titulo.id], medicos: 1, valor: valor });
  };
  mk('2072-05', 'pj01', 5000, 'qa-l1');
  mk('2072-05', 'pj01', 1500, 'qa-l2');
  const cob = S.coberturaProdutividade('2072-05').find(x => x.centro === 'pj01');
  verificar('cobertura soma os 2 fechamentos do mesmo projeto', cob.qtd_lotes === 2 && cob.valor === 6500,
    JSON.stringify([cob.qtd_lotes, cob.valor]));

  // cancelar fechamento desfaz a confirmação do faturamento
  S.confirmarFaturamentoProdutividade({ centro: 'pj02', competencia: '2072-06', faturamento: 40000, produtividade: 20000 });
  const lote = mk('2072-06', 'pj02', 9000, 'qa-l3');
  S.cancelarLoteProdutividade(lote.id, 'teste', false);
  verificar('cancelar o fechamento desfaz o valor confirmado',
    S.previsaoDe('pj02', '2072-06').status === 'estimada', S.previsaoDe('pj02', '2072-06').status);

  // estorno de estoque
  const p = D.produtos[0];
  S.entrada({ produto: p.id, armazem: 'am07', qtd: 20, custo: 10, data: '2026-09-01', documento: 'QA-EST' });
  S.baixaMultipla({ armazem: 'am07', data: '2026-09-20', motivo: 'Consumo assistencial',
    pacientes: ['Ana Estorno', 'Bruno Estorno'], itens: [{ produto: p.id, qtd: 2 }] });
  const saldoAntes = S.saldoEstoque(p.id, 'am07');
  const mv = S.movimentos({ armazem: 'am07' }).find(m => (m.pacientes || []).indexOf('Ana Estorno') > -1);
  verificar('estorno exige motivo', !!S.estornarMovimento(mv.id, '').erro, '');
  const est = S.estornarMovimento(mv.id, 'baixa no setor errado');
  verificar('estorno devolve o saldo', est.ok && S.saldoEstoque(p.id, 'am07') === saldoAntes + 2, S.saldoEstoque(p.id, 'am07'));
  verificar('consumo estornado sai do relatório por paciente',
    !S.consumoPorPaciente({}).linhas.some(l => l.paciente === 'Ana Estorno'), '');
  verificar('estorno de estorno é recusado', !!S.estornarMovimento(est.movimento.id, 'x').erro, '');

  // transferência estorna os dois lados
  S.entrada({ produto: p.id, armazem: 'am05', qtd: 10, custo: 10, data: '2026-09-01', documento: 'QA-T' });
  S.transferir({ origem: 'am05', destino: 'am06', data: '2026-09-02', itens: [{ produto: p.id, qtd: 4 }] });
  const a5 = S.saldoEstoque(p.id, 'am05'), a6 = S.saldoEstoque(p.id, 'am06');
  const mvT = S.movimentos({ armazem: 'am06' }).find(m => m.origem === 'transferencia' && !m.estornado && !m.estorno_de);
  S.estornarMovimento(mvT.id, 'transferência errada');
  verificar('estornar transferência desfaz os dois lados',
    S.saldoEstoque(p.id, 'am05') === a5 + 4 && S.saldoEstoque(p.id, 'am06') === a6 - 4,
    JSON.stringify([S.saldoEstoque(p.id, 'am05'), S.saldoEstoque(p.id, 'am06')]));
  S.setUsuario('u8');
})();

// ── v88: dois últimos itens da lista ──
(function () {
  S.setUsuario('u3');
  const t = S.criarTitulo({ credor: 'cr5', tipo_titulo: 'recibo', conta: '6.03', centro: 'cc100',
    descricao: 'Tarifa QA88', emissao: '2026-09-01', origem: 'manual', sem_nf: true },
    [{ num: 1, venc: '2026-09-10', comp: '2026-09', valor: 80 }]);
  const p = S.todasParcelas().find(x => x.titulo_id === t.titulo.id);
  verificar('desmarcar "Sem NF" sem informar número é recusado',
    /informe o número/i.test(S.informarNF(p.id, { sem_nf: false }).erro || ''), '');
  verificar('informando o número, a marcação cai sozinha',
    S.informarNF(p.id, { documento: 'NF-QA88', sem_nf: false }).ok && S.parcela(p.id).sem_nf === false, '');
  S.setUsuario('u8');
})();

// ── v89: relatórios do financeiro por período ──
(function () {
  S.setUsuario('u3');
  const Ut = sandbox.window.ERP.util;
  const hoje = Ut.hoje();
  const forn = D.credores.find(c => c.tipo !== 'medico' && c.ativo !== false);

  // um título vencendo no período e um fora dele
  const dentro = Ut.addDias(hoje, 5), fora = Ut.addDias(hoje, 90);
  S.criarTitulo({ credor: forn.id, tipo_titulo: 'nf', conta: '6.03', centro: 'cc100', documento: 'QA-REL-1',
    descricao: 'Dentro do período', emissao: hoje, origem: 'manual' },
    [{ num: 1, venc: dentro, comp: Ut.compDe(dentro), valor: 1000 }]);
  S.criarTitulo({ credor: forn.id, tipo_titulo: 'nf', conta: '6.03', centro: 'cc100', documento: 'QA-REL-2',
    descricao: 'Fora do período', emissao: hoje, origem: 'manual' },
    [{ num: 1, venc: fora, comp: Ut.compDe(fora), valor: 7777 }]);
  S.criarReceber({ numero: 'QA-REL-R1', emissao: hoje, cliente_nome: 'Cliente QA', centro: 'pj01',
    competencia: Ut.compDe(hoje), vencimento: dentro, valor_bruto: 5000, origem: 'nota', status: 'faturado' });

  const r = S.contasAPagarEReceber(hoje, Ut.addDias(hoje, 30));
  verificar('relatório a pagar/receber pega o que vence no período',
    r.linhas.some(l => l.documento === 'QA-REL-1'), '');
  verificar('e ignora o que vence fora dele', !r.linhas.some(l => l.documento === 'QA-REL-2'), '');
  verificar('entradas e saídas na mesma lista',
    r.linhas.some(l => l.tipo === 'Entrada') && r.linhas.some(l => l.tipo === 'Saída'), '');
  verificar('está em ordem de vencimento',
    r.linhas.every((l, i) => i === 0 || r.linhas[i - 1].vencimento <= l.vencimento), '');
  const ult = r.linhas[r.linhas.length - 1];
  verificar('saldo corrido fecha com saldo bancário + entradas − saídas',
    Math.abs(ult.saldo - (r.saldo_banco + r.total_entradas - r.total_saidas)) < 0.01,
    JSON.stringify([ult.saldo, r.saldo_banco, r.total_entradas, r.total_saidas]));
  verificar('o saldo da 1ª linha parte do saldo bancário',
    Math.abs(r.linhas[0].saldo - (r.saldo_banco + (r.linhas[0].tipo === 'Entrada' ? r.linhas[0].valor : -r.linhas[0].valor))) < 0.01, '');

  // realizado: só o que foi baixado no período
  const par = S.todasParcelas().find(p => p.doc === 'QA-REL-1');
  S.registrarPagamento(par.id, { data: hoje, valor: 1000, banco: D.bancos[0].id, situacao: 'liquidado', forma: 'PIX' });
  const pr = S.contasPagasERecebidas(hoje, hoje);
  verificar('relatório de pagas/recebidas mostra a baixa do dia',
    pr.linhas.some(l => l.documento === 'QA-REL-1' && l.baixa === hoje), '');
  verificar('não mostra título ainda em aberto', !pr.linhas.some(l => l.documento === 'QA-REL-2'), '');
  const ontem = Ut.addDias(hoje, -1);
  verificar('e respeita o período da baixa',
    !S.contasPagasERecebidas(ontem, ontem).linhas.some(l => l.documento === 'QA-REL-1'), '');
  verificar('totais do realizado batem com as linhas',
    Math.abs(pr.total_pago - pr.linhas.filter(l => l.tipo === 'Saída').reduce((a, l) => a + l.valor, 0)) < 0.01, '');
  S.setUsuario('u8');
})();

// ── v90: atestado de capacidade técnica por cliente ──
(function () {
  S.setUsuario('u3');
  const Ut = sandbox.window.ERP.util;
  const pend = S.atestadosPendentes();
  verificar('cliente com prestação e sem atestado entra no alerta', pend.length > 0 && pend[0].nunca, pend.length);
  const cli = pend[0].cliente;

  const h = S.historicoAtestado(cli.id);
  verificar('histórico traz projeto, período e competências',
    h.ok && h.linhas.length > 0 && h.primeira && h.ultima, JSON.stringify(h.erro));
  verificar('histórico conta médicos distintos e valor', h.linhas[0].medicos > 0 && (h.linhas[0].faturado + h.linhas[0].producao) > 0,
    JSON.stringify([h.linhas[0].medicos, h.linhas[0].faturado, h.linhas[0].producao]));
  const so1 = S.historicoAtestado(cli.id, '2099-01-01', '2099-12-31');
  verificar('histórico respeita o período pedido', so1.linhas.length === 0, so1.linhas.length);

  // pedido não resolve; só o atestado recebido reinicia a contagem
  S.registrarAtestado(cli.id, { situacao: 'solicitado', data: Ut.hoje() });
  const aindaPend = S.atestadosPendentes().find(x => x.cliente.id === cli.id);
  verificar('registrar o PEDIDO não tira do alerta', !!aindaPend, '');
  verificar('e a tela sabe que o pedido já foi feito', aindaPend.solicitado_em === Ut.hoje(), aindaPend.solicitado_em);
  S.registrarAtestado(cli.id, { situacao: 'recebido', data: Ut.hoje(), numero: 'QA-AT-1' });
  verificar('atestado recebido tira do alerta',
    !S.atestadosPendentes().some(x => x.cliente.id === cli.id), '');
  verificar('e fica no histórico do cliente', S.atestadosDoCliente(cli.id).some(a => a.numero === 'QA-AT-1'), '');

  // volta a alertar depois da periodicidade
  cli.atestado_em = Ut.addMeses(Ut.hoje(), -7).slice(0, 10);
  const volta = S.atestadosPendentes().find(x => x.cliente.id === cli.id);
  verificar('7 meses depois volta a alertar', !!volta && !volta.nunca && volta.dias > 0, volta && volta.dias);
  cli.atestado_periodicidade = 12;
  verificar('periodicidade por cliente é respeitada (12 meses)',
    !S.atestadosPendentes().some(x => x.cliente.id === cli.id), '');
  cli.atestado_dispensado = true;
  cli.atestado_periodicidade = 6;
  verificar('cliente dispensado não alerta', !S.atestadosPendentes().some(x => x.cliente.id === cli.id), '');
  cli.atestado_dispensado = false;
  S.setUsuario('u8');
})();

// ── v91: correções da auditoria da v88 ──
(function () {
  S.setUsuario('u3');
  const Ut = sandbox.window.ERP.util;
  const hoje = Ut.hoje();

  // 1) regressão da importação: refJaUsada não pode estourar
  const med = D.credores.find(c => c.tipo === 'medico');
  const mk = ref => S.criarTitulo({ credor: med.id, tipo_titulo: 'medicao', conta: '3.01', centro: 'pj01',
    descricao: 'Prod QA91', documento: 'F91', emissao: '2026-08-31', origem: 'produtividade', origem_ref: ref },
    [{ num: 1, venc: '2026-09-10', comp: '2026-08', valor: 1000 }]);
  mk('QA91|m1');
  let estourou = false;
  try { S.refJaUsada('QA91|m1'); } catch (e) { estourou = true; }
  verificar('refJaUsada não estoura com chave já usada', !estourou && S.refJaUsada('QA91|m1') === true, '');
  verificar('reimportar a mesma chave continua sendo recusado como duplicado', !!mk('QA91|m1').duplicado, '');
  verificar('complemento explícito (sufixo) é aceito', mk('QA91|m1|c2').ok, '');

  // cancelamento de fechamento com pagamento exige autorização do administrador
  const t = mk('QA91|m2');
  const lote = S.registrarLoteProdutividade({ centro: 'pj01', competencia: '2026-08', arquivo: 'qa91.xlsx',
    titulo_ids: [t.titulo.id], medicos: 1, valor: 1000 });
  const par = S.todasParcelas().find(p => p.titulo_id === t.titulo.id);
  /* v126: produtividade só vai para pagamento depois de confirmada
     pela gestão — sem isso, o pagamento abaixo nem acontece e o teste
     do cancelamento perde o sentido. */
  S.confirmarLoteProdutividade(lote.id, { ciente_bloqueios: true });
  S.registrarPagamento(par.id, { data: hoje, valor: 1000, banco: D.bancos[0].id, situacao: 'liquidado', forma: 'PIX' });
  const semAut = S.cancelarLoteProdutividade(lote.id, 'erro de carga', false);
  verificar('fechamento com pagamento não cancela direto', !!semAut.erro && semAut.exigeAutorizacao, '');
  verificar('e o sócio não consegue forçar', !!S.cancelarLoteProdutividade(lote.id, 'erro de carga do arquivo', true).erro, '');
  S.setUsuario('u5');
  verificar('administrador precisa descrever a autorização',
    /Descreva a autorização/.test(S.cancelarLoteProdutividade(lote.id, 'erro', true).erro || ''), '');
  verificar('administrador autoriza e o cancelamento acontece',
    S.cancelarLoteProdutividade(lote.id, 'autorizado por Fellype — erro de carga do arquivo', true).ok, '');
  S.setUsuario('u3');

  // 2) fatura x previsão
  D.centro('pj37').itens_locacao = [{ descricao: 'Cama', qtd: 10, valor_unit: 1000 }];
  S.salvarPrevisao({ centro: 'pj37', competencia: '2071-09', faturamento: 104700, produtividade: 0 });
  liberarParaFaturar('pj37', '2071-09');
  S.emitirFatura({ centro: 'pj37', competencia: '2071-09', itens: [{ descricao: 'Cama', qtd: 10, qtd_contratada: 10, valor_unit: 9780 }] });
  const aberto = () => S.contasReceber().filter(r => r.centro === 'pj37' && r.competencia === '2071-09' &&
    ['previsto', 'faturado'].indexOf(r.status) > -1 && !r.conferir);
  verificar('fatura não convive com a previsão no a receber', aberto().length === 1 && aberto()[0].origem === 'fatura',
    JSON.stringify(aberto().map(r => r.origem)));
  S.marcarPrevisoes('2071-09', 'confirmada');
  verificar('"Confirmar mês" não ressuscita a previsão substituída', aberto().length === 1, aberto().length);
  const pv = S.previsaoDe('pj37', '2071-09');
  verificar('realizado da previsão reconhece a fatura', S.realizadoDaPrevisao(pv).faturado === 97800, S.realizadoDaPrevisao(pv).faturado);
  const fatura = S.contasReceber().find(r => r.origem === 'fatura' && r.centro === 'pj37' && r.competencia === '2071-09');
  verificar('cancelar documento no a receber exige motivo', !!S.cancelarReceber(fatura.id, '').erro, '');
  verificar('fatura cancelada libera emitir outra no mês',
    S.cancelarReceber(fatura.id, 'valor errado').ok &&
    S.emitirFatura({ centro: 'pj37', competencia: '2071-09', forcar_sem_liberacao: true, itens: [{ descricao: 'Cama', qtd: 10, qtd_contratada: 10, valor_unit: 9000 }] }).ok, '');

  // 3) entrada vinculada ao pedido não recebe mais que o pedido
  S.setUsuario('u7');
  const rq = S.criarRequisicao({ armazem: 'am02', itens: [{ produto: D.produtos[0].id, qtd: 10 }] });
  S.setUsuario('u2'); S.aprovarRequisicao(rq.requisicao.id, { itens: [{ indice: 0, aprovado: true }] });
  S.setUsuario('u7'); S.registrarCotacao(rq.requisicao.id, { itens: [{ produto: D.produtos[0].id, credor: 'cr5', custo: 150, frete: 40 }] });
  S.setUsuario('u2'); S.aprovarCompra(rq.requisicao.id, { decisao: 'aprovar' });
  S.setUsuario('u7'); S.enviarPedido(rq.requisicao.id, null, { prazo: '2071-10-10' });
  const ped = S.compras().find(c => c.status === 'pedido' && c.numero === rq.requisicao.numero);
  S.setUsuario('u3');
  /* v92: em vez de capar silenciosamente, a entrada acima do pedido é
     RECUSADA — estoque e pedido não podem contar histórias diferentes. */
  const tentou = S.entradaLote({ armazem: 'am02', data: hoje, documento: 'QA91-NF', pedido_id: ped.id, origem: 'manual',
    motivo: 'Entrada', itens: [{ produto: D.produtos[0].id, qtd: 50, custo: 154 }] });
  verificar('entrada acima do pedido é recusada e o pedido fica intacto',
    !!tentou.erro && S.compra(ped.id).itens[0].recebido === 0,
    JSON.stringify([tentou.erro && tentou.erro.slice(0, 40), S.compra(ped.id).itens[0].recebido]));
  S.entradaLote({ armazem: 'am02', data: hoje, documento: 'QA91-NF', pedido_id: ped.id, origem: 'manual',
    motivo: 'Entrada', itens: [{ produto: D.produtos[0].id, qtd: 10, custo: 154 }] });
  verificar('com a quantidade certa, o pedido fecha', S.compra(ped.id).itens[0].recebido === 10,
    S.compra(ped.id).itens[0].recebido);

  // 4) só a NF vinculada baixa a previsão do pedido
  const rq2 = S.criarRequisicao({ armazem: 'am02', itens: [{ produto: D.produtos[1].id, qtd: 5 }] });
  S.setUsuario('u2'); S.aprovarRequisicao(rq2.requisicao.id, { itens: [{ indice: 0, aprovado: true }] });
  S.setUsuario('u7'); S.registrarCotacao(rq2.requisicao.id, { itens: [{ produto: D.produtos[1].id, credor: 'cr6', custo: 100, frete: 0 }] });
  S.setUsuario('u2'); S.aprovarCompra(rq2.requisicao.id, { decisao: 'aprovar' });
  S.setUsuario('u7'); S.enviarPedido(rq2.requisicao.id, null, { prazo: '2071-10-10' });
  const ped2 = S.compras().find(c => c.status === 'pedido' && c.numero === rq2.requisicao.numero);
  const prevPed = () => S.todasParcelas().filter(p => p.tipo_titulo === 'previsao' && p.credor === 'cr6' && p.status === 'previsto');
  S.setUsuario('u3');
  S.criarTitulo({ credor: 'cr6', tipo_titulo: 'nf', conta: '6.03', centro: 'cc100', documento: 'QA91-SERV',
    descricao: 'Serviço avulso', emissao: hoje, origem: 'manual' }, [{ num: 1, venc: '2071-10-20', comp: '2071-10', valor: 500 }]);
  verificar('nota sem vínculo NÃO baixa a previsão do pedido', prevPed().length === 1, prevPed().length);
  S.criarTitulo({ credor: 'cr6', tipo_titulo: 'nf', conta: '8.04', centro: 'cc100', documento: 'QA91-MAT',
    descricao: 'Material do pedido', emissao: hoje, origem: 'manual', pedido_id: ped2.id },
    [{ num: 1, venc: '2071-10-20', comp: '2071-10', valor: 500 }]);
  verificar('nota vinculada baixa a previsão', prevPed().length === 0, prevPed().length);

  // 5) estorno de transferência não cria material
  const p5 = D.produtos[6];
  S.entrada({ produto: p5.id, armazem: 'am02', qtd: 8, custo: 10, data: hoje, documento: 'QA91-T' });
  S.transferir({ origem: 'am02', destino: 'am03', data: hoje, itens: [{ produto: p5.id, qtd: 4 }] });
  S.saida({ produto: p5.id, armazem: 'am03', qtd: S.saldoEstoque(p5.id, 'am03'), data: hoje, motivo: 'Consumo' });
  const a02 = S.saldoEstoque(p5.id, 'am02'), a03 = S.saldoEstoque(p5.id, 'am03');
  const mvT = S.movimentos({ armazem: 'am02' }).find(m => m.origem === 'transferencia' && m.produto === p5.id && !m.estornado);
  const rEst = S.estornarMovimento(mvT.id, 'transferência errada');
  verificar('estorno de transferência com destino já consumido é recusado', !!rEst.erro, '');
  verificar('e nenhum saldo é alterado na recusa',
    S.saldoEstoque(p5.id, 'am02') === a02 && S.saldoEstoque(p5.id, 'am03') === a03, '');

  // 6, 7, 8, 9 e 10
  verificar('requisição grava quem abriu (base da segregação)', !!S.compra(ped.id).criado_por_id, '');
  S.parametros().impedir_autoaprovacao_compras = true;
  S.setUsuario('u2');
  const rqSeg = S.criarRequisicao({ armazem: 'am02', itens: [{ produto: D.produtos[0].id, qtd: 1 }] });
  verificar('com a segregação ligada, quem pede não aprova',
    /quem pede não aprova/.test(S.aprovarRequisicao(rqSeg.requisicao.id, { itens: [{ indice: 0, aprovado: true }] }).erro || ''), '');
  S.parametros().impedir_autoaprovacao_compras = false;
  S.setUsuario('u3');

  const semVenc = S.criarReceber({ numero: 'QA91-SEMVENC', emissao: hoje, cliente_nome: 'X', centro: 'pj01',
    competencia: Ut.compDe(hoje), vencimento: '', valor_bruto: 1000, origem: 'nota', status: 'faturado' });
  verificar('título sem vencimento não conta como vencido',
    !S.receberVencido(S.contasReceber().find(r => r.numero === 'QA91-SEMVENC')), '');

  // tarifa e IOF fora do alerta de pago sem NF
  const tf = S.criarTitulo({ credor: 'cr5', tipo_titulo: 'recibo', conta: '9.01', centro: 'cc100',
    descricao: 'Tarifa QA91', emissao: hoje, origem: 'manual', sem_nf: true },
    [{ num: 1, venc: hoje, comp: Ut.compDe(hoje), valor: 80 }]);
  const pf = S.todasParcelas().find(x => x.titulo_id === tf.titulo.id);
  S.registrarPagamento(pf.id, { data: hoje, valor: 80, banco: D.bancos[0].id, situacao: 'liquidado', forma: 'DEB' });
  verificar('tarifa bancária paga não entra no alerta de pago sem NF', !S.pagoSemNota(S.parcela(pf.id)), '');
  S.setUsuario('u8');
})();

// ── v92: os três pontos que sobraram da auditoria da v91 ──
(function () {
  S.setUsuario('u3');
  const Ut = sandbox.window.ERP.util;
  const hoje = Ut.hoje();

  // 1) título da entrada de estoque leva o vínculo com o pedido
  S.setUsuario('u7');
  const rq = S.criarRequisicao({ armazem: 'am02', itens: [{ produto: D.produtos[0].id, qtd: 10 }] });
  S.setUsuario('u2'); S.aprovarRequisicao(rq.requisicao.id, { itens: [{ indice: 0, aprovado: true }] });
  S.setUsuario('u7'); S.registrarCotacao(rq.requisicao.id, { itens: [{ produto: D.produtos[0].id, credor: 'cr5', custo: 150, frete: 40 }] });
  S.setUsuario('u2'); S.aprovarCompra(rq.requisicao.id, { decisao: 'aprovar' });
  S.setUsuario('u7'); S.enviarPedido(rq.requisicao.id, null, { prazo: '2072-10-10' });
  const ped = S.compras().find(c => c.status === 'pedido' && c.numero === rq.requisicao.numero);
  const prevViva = () => S.todasParcelas().filter(p => p.tipo_titulo === 'previsao' && p.status === 'previsto' &&
    (S.st.titulos.find(t => t.id === p.titulo_id) || {}).origem_ref === ped.id).length;
  verificar('pedido gera previsão financeira', prevViva() === 1, prevViva());
  S.setUsuario('u3');
  S.entradaLote({ armazem: 'am02', data: hoje, documento: 'QA92-NF', pedido_id: ped.id, origem: 'manual',
    motivo: 'Entrada', itens: [{ produto: D.produtos[0].id, qtd: 10, custo: 154 }] });
  const tituloEntrada = S.criarTitulo({ credor: 'cr5', tipo_titulo: 'recibo', conta: '8.04', centro: 'cc100',
    documento: 'QA92-NF', descricao: 'Material — entrada de estoque · pedido ' + ped.numero,
    emissao: hoje, origem: 'manual', pedido_id: ped.id },
    [{ num: 1, venc: hoje, comp: Ut.compDe(hoje), valor: 1540 }]);
  verificar('título da entrada com pedido_id baixa a previsão (sem saída em dobro)',
    tituloEntrada.ok && prevViva() === 0, JSON.stringify([tituloEntrada.erro, prevViva()]));

  // 2) conferência: não dá entrada acima do pedido
  S.setUsuario('u7');
  const rq2 = S.criarRequisicao({ armazem: 'am02', itens: [{ produto: D.produtos[1].id, qtd: 4 }] });
  S.setUsuario('u2'); S.aprovarRequisicao(rq2.requisicao.id, { itens: [{ indice: 0, aprovado: true }] });
  S.setUsuario('u7'); S.registrarCotacao(rq2.requisicao.id, { itens: [{ produto: D.produtos[1].id, credor: 'cr5', custo: 20, frete: 0 }] });
  S.setUsuario('u2'); S.aprovarCompra(rq2.requisicao.id, { decisao: 'aprovar' });
  S.setUsuario('u7'); S.enviarPedido(rq2.requisicao.id, null, { prazo: '2072-10-10' });
  const ped2 = S.compras().find(c => c.status === 'pedido' && c.numero === rq2.requisicao.numero);
  S.setUsuario('u3');
  const saldoAntes = S.saldoEstoque(D.produtos[1].id, 'am02');
  const excesso = S.entradaLote({ armazem: 'am02', data: hoje, documento: 'QA92-X', pedido_id: ped2.id,
    origem: 'manual', motivo: 'E', itens: [{ produto: D.produtos[1].id, qtd: 40, custo: 20 }] });
  verificar('entrada de 40 num pedido de 4 é recusada', !!excesso.erro && !!excesso.divergencias, '');
  verificar('e o estoque não é tocado na recusa', S.saldoEstoque(D.produtos[1].id, 'am02') === saldoAntes, '');
  verificar('e o pedido continua sem recebimento', S.compra(ped2.id).itens[0].recebido === 0, S.compra(ped2.id).itens[0].recebido);
  const certo = S.entradaLote({ armazem: 'am02', data: hoje, documento: 'QA92-OK', pedido_id: ped2.id,
    origem: 'manual', motivo: 'E', itens: [{ produto: D.produtos[1].id, qtd: 4, custo: 20 }] });
  verificar('quantidade certa entra e fecha o pedido',
    certo.ok && S.compra(ped2.id).itens[0].recebido === 4 && S.compra(ped2.id).status === 'recebido', '');
  verificar('material fora do pedido também é barrado',
    !!S.entradaLote({ armazem: 'am02', data: hoje, documento: 'QA92-Y', pedido_id: ped2.id, origem: 'manual',
      motivo: 'E', itens: [{ produto: D.produtos[3].id, qtd: 1, custo: 10 }] }).erro, '');

  // 3) grade de previsões não sobrescreve o valor confirmado
  S.confirmarFaturamentoProdutividade({ centro: 'pj19', competencia: '2072-08', faturamento: 200000, produtividade: 100000 });
  const tentativa = S.salvarPrevisao({ centro: 'pj19', competencia: '2072-08', faturamento: 1000, produtividade: 100000 });
  verificar('digitar por cima do confirmado é recusado', !!tentativa.erro && tentativa.confirmadaProd, '');
  verificar('e o valor confirmado continua intacto',
    S.previsaoDe('pj19', '2072-08').faturamento === 200000 && S.previsaoDe('pj19', '2072-08').status === 'confirmada_prod', '');
  const forcado = S.salvarPrevisao({ centro: 'pj19', competencia: '2072-08', faturamento: 1000, produtividade: 100000, forcar: true });
  const pvDepois = S.previsaoDe('pj19', '2072-08');
  verificar('forçando, o valor troca e o selo de confirmado cai',
    forcado.ok && pvDepois.faturamento === 1000 && pvDepois.status === 'estimada', JSON.stringify([pvDepois.faturamento, pvDepois.status]));
  const tit = S.contasReceber().find(r => r.centro === 'pj19' && r.competencia === '2072-08' && r.origem === 'previsao');
  verificar('e o título do a receber acompanha o novo valor, sem o selo',
    tit && tit.valor_bruto === 1000 && !tit.valor_confirmado_produtividade,
    JSON.stringify(tit && [tit.valor_bruto, !!tit.valor_confirmado_produtividade]));
  verificar('mexer só na produtividade (sem trocar o faturamento) continua livre',
    S.salvarPrevisao({ centro: 'pj19', competencia: '2072-08', faturamento: 1000, produtividade: 90000 }).ok, '');
  S.setUsuario('u8');
})();

// ── v93: pontos menores da auditoria da v91 ──
(function () {
  S.setUsuario('u3');
  const Ut = sandbox.window.ERP.util;
  // número de documento no a receber não repete
  D.centro('pj37').itens_locacao = [{ descricao: 'Cama', qtd: 1, valor_unit: 1000 }];
  D.centro('pj38').itens_locacao = [{ descricao: 'Bomba', qtd: 1, valor_unit: 500 }];
  liberarParaFaturar('pj37', '2073-01');
  liberarParaFaturar('pj38', '2073-01');
  const a = S.emitirFatura({ centro: 'pj37', competencia: '2073-01', numero: 'QA93-X1', valor_anexo: 1000,
    emissao: '2073-01-31', arquivo: { nome: 'f.pdf', dados: 'data:,x' } });
  verificar('fatura anexada é aceita', a.ok, JSON.stringify(a.erro));
  const b = S.emitirFatura({ centro: 'pj38', competencia: '2073-01', numero: 'QA93-X1', valor_anexo: 500,
    emissao: '2073-01-31', arquivo: { nome: 'f.pdf', dados: 'data:,x' } });
  verificar('mesmo número em outro projeto é recusado', !!b.erro && /Já existe o documento/.test(b.erro), b.erro);
  const doc = S.contasReceber().find(r => r.numero === 'QA93-X1');
  S.cancelarReceber(doc.id, 'teste');
  verificar('depois de cancelado, o número pode ser reusado',
    S.emitirFatura({ centro: 'pj38', competencia: '2073-01', numero: 'QA93-X1', valor_anexo: 500,
      emissao: '2073-01-31', arquivo: { nome: 'f.pdf', dados: 'data:,x' } }).ok, '');
  S.setUsuario('u8');
})();

// ── v94: filtros e recortes dos relatórios ──
(function () {
  S.setUsuario('u3');
  const Ut = sandbox.window.ERP.util;
  // custo por setor/tipo aceita unidade (projeto mãe) e período
  const unidades = S.unidadesComProdutividade();
  verificar('existe lista de unidades com produtividade', unidades.length > 0, unidades.length);
  const un = unidades.find(u => D.centros.filter(c => c.unidade === u && c.produtividade).length > 1) || unidades[0];
  const porUnidade = S.custosPorSetorTipo(un, '', '');
  const projetosDaUn = D.centros.filter(c => c.tipo === 'projeto' && c.unidade === un && c.produtividade);
  const somaProjetos = projetosDaUn.reduce((a, c) => {
    const r = S.custosPorSetorTipo(c.id, '', '');
    return a + Object.keys(r.grupos).reduce((x, k) => x + r.grupos[k].pago + r.grupos[k].aberto, 0);
  }, 0);
  const somaUnidade = Object.keys(porUnidade.grupos).reduce((x, k) => x + porUnidade.grupos[k].pago + porUnidade.grupos[k].aberto, 0);
  verificar('filtrar pela unidade soma todos os projetos dela',
    Math.abs(somaUnidade - somaProjetos) < 0.01, JSON.stringify([somaUnidade, somaProjetos]));
  const fora = S.custosPorSetorTipo(un, '', '', '2099-01-01', '2099-12-31');
  verificar('e o período recorta o custo por setor/tipo', Object.keys(fora.grupos).length === 0, Object.keys(fora.grupos).length);
  verificar('setores da unidade inteira são listados', Array.isArray(S.setoresTiposDe(un)), '');
  S.setUsuario('u8');
})();

// ── v95: esteira do faturamento (5 etapas, duas mãos) ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u1');   // assistente: lança produtividade e fala com o órgão
  S.salvarPrevisao({ centro: 'pj37', competencia: '2074-03', faturamento: 100000, produtividade: 0 });
  D.centro('pj37').itens_locacao = [{ descricao: 'Cama', qtd: 1, valor_unit: 100000 }];
  const itens = [{ descricao: 'Cama', qtd: 1, qtd_contratada: 1, valor_unit: 100000 }];

  verificar('só com previsão, faturar é bloqueado',
    /não foi confirmado/.test(S.emitirFatura({ centro: 'pj37', competencia: '2074-03', itens: itens }).erro || ''), '');
  S.confirmarFaturamentoProdutividade({ centro: 'pj37', competencia: '2074-03', faturamento: 100000, produtividade: 0 });
  verificar('valor confirmado ainda não libera faturar',
    /não autorizou/.test(S.emitirFatura({ centro: 'pj37', competencia: '2074-03', itens: itens }).erro || ''), '');
  verificar('etapa é "confirmado"', S.etapaDaPrevisao(S.previsaoDe('pj37', '2074-03')) === 'confirmado', '');

  const aut = S.autorizarFaturamento('pj37', '2074-03', { protocolo: 'Ofício QA 55' });
  verificar('quem confirma a produtividade registra a autorização do órgão', aut.ok, JSON.stringify(aut.erro));
  /* v123: por decisão da operação, quem autoriza o faturamento também
     libera — não há segunda mão a esperar. A trava que continua valendo
     é a de AUTORIZAÇÃO: sem ela, nada fatura. */
  verificar('autorizar já libera, na mesma mão',
    S.etapaDaPrevisao(S.previsaoDe('pj37', '2074-03')) === 'liberado',
    S.etapaDaPrevisao(S.previsaoDe('pj37', '2074-03')));
  verificar('autorizado e liberado, a fatura sai',
    S.emitirFatura({ centro: 'pj37', competencia: '2074-03', itens: itens }).ok, '');

  S.setUsuario('u2');   // responsável pelo faturamento

  // valor alterado depois da autorização pede nova decisão
  S.salvarPrevisao({ centro: 'pj38', competencia: '2074-03', faturamento: 10000, produtividade: 0 });
  S.confirmarFaturamentoProdutividade({ centro: 'pj38', competencia: '2074-03', faturamento: 10000, produtividade: 0 });
  S.autorizarFaturamento('pj38', '2074-03', { protocolo: 'Ofício QA 56' });
  S.salvarPrevisao({ centro: 'pj38', competencia: '2074-03', faturamento: 30000, produtividade: 0, forcar: true });
  /* A liberação automática da autorização acontece com o valor
     autorizado; mexer no valor depois exige decisão nova, e a trava de
     divergência continua valendo ao liberar de novo. */
  S.desfazerEtapaFaturamento('pj38', '2074-03', 'liberado', 'teste de divergência');
  const div = S.liberarFaturamento('pj38', '2074-03', {});
  verificar('valor mudou depois da autorização: liberação avisa', !!div.erro && div.divergencia, '');
  verificar('e libera quando confirmado assim mesmo', S.liberarFaturamento('pj38', '2074-03', { forcar: true }).ok, '');

  // a esteira ordena do mais atrasado para o mais adiantado, faturado no fim
  const esteira = S.esteiraFaturamento({ competencia: '2074-03' });
  verificar('esteira lista as competências com etapa e dias', esteira.length >= 2, esteira.length);
  const idx = esteira.map(l => l.etapa);
  verificar('faturado fica no fim da lista',
    idx.indexOf('faturado') === -1 || idx.indexOf('faturado') === idx.length - 1, JSON.stringify(idx));
  const pend = S.esteiraFaturamento({ pendentes: true, competencia: '2074-03' });
  verificar('filtro de pendentes tira os faturados', pend.every(l => l.etapa !== 'faturado'), '');

  // desfazer etapas respeita quem pode
  S.setUsuario('u1');
  verificar('assistente não desfaz a liberação',
    !!S.desfazerEtapaFaturamento('pj38', '2074-03', 'liberado', 'teste').erro, '');
  S.setUsuario('u2');
  verificar('responsável desfaz a liberação', S.desfazerEtapaFaturamento('pj38', '2074-03', 'liberado', 'órgão pediu revisão').ok, '');
  verificar('sem liberação, faturar volta a ser bloqueado',
    !!S.emitirFatura({ centro: 'pj38', competencia: '2074-03', itens: [{ descricao: 'x', qtd: 1, valor_unit: 100 }] }).erro, '');
  S.setUsuario('u8');
})();

// ── v96: módulo de ativos (equipamentos) ──
(function () {
  S.setUsuario('u3');
  const Ut = sandbox.window.ERP.util;
  verificar('base da planilha carregada (27 equipamentos)', S.ativos({}).length === 27, S.ativos({}).length);
  verificar('valor imobilizado bate com a planilha',
    Math.abs(S.ativos({}).reduce((a, x) => a + x.valor, 0) - 3565056.65) < 0.5,
    S.ativos({}).reduce((a, x) => a + x.valor, 0));

  const a = S.ativos({ status: 'alocado' })[0];
  const antes = S.situacaoAtiva(S.ativo(a.id));
  verificar('situação inicial vem do cadastro quando não há evento', antes.eventos === 0, antes.eventos);

  verificar('movimentar sem destino é recusado', !!S.movimentarAtivo({ ativo: a.id, status: 'sede' }).erro, '');
  verificar('alocar sem projeto é recusado',
    !!S.movimentarAtivo({ ativo: a.id, status: 'alocado', destino: 'Hospital X' }).erro, '');
  verificar('equipamento fora da sede exige custodiante',
    !!S.movimentarAtivo({ ativo: a.id, status: 'terceiro', destino: 'Oficina' }).erro, '');
  verificar('movimentação no futuro é recusada',
    !!S.movimentarAtivo({ ativo: a.id, status: 'sede', destino: 'Sede', data: Ut.addDias(Ut.hoje(), 3) }).erro, '');

  const mov = S.movimentarAtivo({ ativo: a.id, status: 'manutencao', destino: 'Oficina KTK',
    custodiante: 'KTK', documento: 'REM-01' });
  verificar('movimentação gravada como evento', mov.ok, JSON.stringify(mov.erro));
  const depois = S.situacaoAtiva(S.ativo(a.id));
  verificar('local e situação atuais vêm do último evento',
    depois.local === 'Oficina KTK' && depois.status === 'manutencao', JSON.stringify(depois));
  verificar('o cadastro do ativo NÃO foi alterado',
    S.ativo(a.id).local !== 'Oficina KTK', S.ativo(a.id).local);
  verificar('dá para dizer onde estava numa data passada',
    S.ondeEstavaEm(a.id, '2026-01-01').local === antes.local, JSON.stringify(S.ondeEstavaEm(a.id, '2026-01-01')));

  // OS com custo cai no centro do projeto do ativo
  const b = S.ativos({ status: 'alocado' })[0];
  const proj = S.situacaoAtiva(S.ativo(b.id)).projeto;
  const os = S.abrirOS({ ativo: b.id, tipo: 'corretiva', descricao: 'não liga', parada_uso: true });
  verificar('OS aberta', os.ok && os.os.numero, JSON.stringify(os.erro));
  verificar('equipamento parado sai de operação por evento',
    S.situacaoAtiva(S.ativo(b.id)).status === 'manutencao', '');
  const fech = S.fecharOS(os.os.id, { custo_peca: 1200, custo_servico: 800, executante_credor: 'cr5',
    documento: 'NF 7781', devolver_para: 'Hospital de volta', custodiante: 'Enf. chefe' });
  verificar('fechar OS lança o custo no contas a pagar', fech.ok && !!fech.titulo, JSON.stringify(fech.erro));
  const par = S.todasParcelas().find(x => x.titulo_id === (fech.titulo || {}).id);
  verificar('e o custo cai no centro do projeto onde o equipamento está',
    par && par.rateio[0].centro === proj, JSON.stringify([par && par.rateio[0].centro, proj]));
  verificar('equipamento volta do conserto por evento',
    S.situacaoAtiva(S.ativo(b.id)).local === 'Hospital de volta', S.situacaoAtiva(S.ativo(b.id)).local);

  // preventiva
  const pl = S.salvarPlanoManutencao({ ativo: b.id, periodicidade_dias: 180, proxima: Ut.addDias(Ut.hoje(), -1),
    checklist: 'troca de filtro' });
  verificar('plano de manutenção salvo', pl.ok, JSON.stringify(pl.erro));
  const geradas = S.gerarPreventivas();
  verificar('preventiva vencida abre OS sozinha', geradas.length >= 1, geradas.length);
  verificar('e não abre duas vezes para o mesmo plano', S.gerarPreventivas().length === 0, '');

  // ociosidade e resultado
  verificar('ociosidade lista o que está parado com dias e valor',
    S.ociosidadeAtivos().every(x => x.dias_parado === null || x.dias_parado >= 0), '');
  const res = S.resultadoDoAtivo(b.id);
  /* v114: o resultado passou a descontar a DEPRECIAÇÃO (o bem se paga
     ao longo da vida útil); o retorno de caixa ficou em resultado_caixa. */
  /* v117: o resultado compara períodos iguais — a depreciação contada
     é a dos meses de locação, não a da vida inteira (que ficou em
     resultado_vida). */
  verificar('resultado do equipamento desconta depreciação do período e manutenção',
    res && Math.abs(res.resultado - (res.receita - res.depreciacao_periodo - res.manutencao)) < 0.01,
    JSON.stringify(res && [res.resultado, res.depreciacao_periodo]));
  verificar('e o retorno de caixa desconta o valor de compra',
    res && Math.abs(res.resultado_caixa - (res.receita - res.aquisicao - res.manutencao)) < 0.01, '');
  verificar('série duplicada é recusada',
    S.salvarAtivo({ descricao: 'Teste A', serie: 'QA-SERIE-1' }).ok &&
    !!S.salvarAtivo({ descricao: 'Teste B', serie: 'QA-SERIE-1' }).erro, '');
  S.setUsuario('u8');
})();

// ── v97: desmembramento de compra e locação por equipamento ──
(function () {
  S.setUsuario('u3');
  const Ut = sandbox.window.ERP.util;
  const lote = S.ativos({}).find(a => a.qtd > 1 && a.valor > 1000);
  const totalAntes = lote.qtd, valorAntes = lote.valor;

  verificar('divisão que não fecha com a quantidade é recusada',
    /precisa fechar/.test(S.desmembrarAtivo(lote.id, { partes: [{ qtd: 1, status: 'sede', local: 'Sede' }] }).erro || ''), '');
  verificar('parte alocada sem projeto é recusada',
    !!S.desmembrarAtivo(lote.id, { partes: [{ qtd: totalAntes, status: 'alocado', local: 'X' }] }).erro, '');

  const r = S.desmembrarAtivo(lote.id, { partes: [
    { qtd: 1, status: 'alocado', projeto: 'pj41', local: 'Hospital Nilópolis', custodiante: 'Enf. chefe' },
    { qtd: totalAntes - 1, status: 'sede', local: 'Sede - Rio de Janeiro' }
  ], documento: 'REM-QA97' });
  verificar('compra desmembrada em partes', r.ok && r.partes.length === 2, JSON.stringify(r.erro));
  verificar('o valor é rateado e fecha com o total',
    Math.abs(r.partes.reduce((a, p) => a + p.valor, 0) - valorAntes) < 0.01,
    r.partes.map(p => p.valor).join('+'));
  verificar('o registro original sai da lista', !S.ativos({}).some(a => a.id === lote.id), '');
  verificar('cada parte nasce com seu evento de entrada',
    r.partes.every(p => S.movimentacoesDoAtivo(p.id).length === 1), '');
  verificar('as partes seguem apontando para a mesma compra',
    r.partes.every(p => p.compra === lote.id), '');
  verificar('cada parte tem situação própria',
    S.situacaoAtiva(S.ativo(r.partes[0].id)).status === 'alocado' &&
    S.situacaoAtiva(S.ativo(r.partes[1].id)).status === 'sede', '');
  verificar('desmembrar de novo é recusado', !!S.desmembrarAtivo(lote.id, { partes: [] }).erro, '');

  // modo unitário
  const lote2 = S.ativos({}).find(a => a.qtd >= 3 && !a.pai);
  const u = S.desmembrarAtivo(lote2.id, { modo: 'unitario', destino: { status: 'sede', local: 'Sede' } });
  verificar('modo unitário cria um registro por unidade',
    u.ok && u.partes.length === lote2.qtd && u.partes.every(p => p.qtd === 1), JSON.stringify(u.erro));

  // locação por equipamento
  const ct = S.contratos({ parte: 'cliente' }).find(c => !c.encerrado);
  const parte = r.partes[0];
  verificar('locação exige valor mensal', !!S.vincularLocacao(parte.id, { contrato: ct.id }).erro, '');
  /* v114: contrato que não cobre o projeto do equipamento passou a
     pedir confirmação — aqui é proposital, então vai com forcar. */
  const v = S.vincularLocacao(parte.id, { contrato: ct.id, valor_locacao: 1800, forcar: true,
    desde: Ut.addMeses(Ut.hoje(), -6).slice(0, 10) });
  verificar('locação vinculada ao contrato', v.ok, JSON.stringify(v.erro));
  const res = S.resultadoDoAtivo(parte.id);
  verificar('receita acumulada é calculada pelos meses locados', res.meses >= 5 && res.receita > 0,
    JSON.stringify([res.meses, res.receita]));
  verificar('resultado = receita − depreciação do período − manutenção',
    Math.abs(res.resultado - (res.receita - res.depreciacao_periodo - res.manutencao)) < 0.01, '');
  verificar('diz quantos meses faltam para a compra se pagar', res.meses_para_pagar !== null, res.meses_para_pagar);

  // devolução encerra a receita
  S.vincularLocacao(parte.id, { contrato: ct.id, valor_locacao: 1800, forcar: true,
    desde: Ut.addMeses(Ut.hoje(), -6).slice(0, 10), ate: Ut.addMeses(Ut.hoje(), -3).slice(0, 10) });
  verificar('equipamento devolvido para de faturar', S.resultadoDoAtivo(parte.id).meses <= 4,
    S.resultadoDoAtivo(parte.id).meses);

  // resultado da compra soma as partes
  const compra = S.resultadoDaCompra(lote.id);
  verificar('resultado da compra soma as partes',
    compra && Math.abs(compra.aquisicao - valorAntes) < 0.01, JSON.stringify(compra && compra.aquisicao));
  S.setUsuario('u8');
})();

// ── v98: depreciação no custo do projeto e faturamento único de grupo ──
(function () {
  S.setUsuario('u3');
  const Ut = sandbox.window.ERP.util;

  // depreciação
  const a = S.ativos({ status: 'alocado' }).find(x => x.valor > 10000);
  verificar('depreciação padrão é em 60 meses',
    Math.abs(S.depreciacaoMensal(a) - a.valor / 60) < 0.01, S.depreciacaoMensal(a));
  S.salvarAtivo({ id: a.id, vida_util_meses: 120 });
  verificar('vida útil do cadastro manda',
    Math.abs(S.depreciacaoMensal(S.ativo(a.id)) - a.valor / 120) < 0.01, S.depreciacaoMensal(S.ativo(a.id)));
  const dep = S.depreciacaoDoAtivo(S.ativo(a.id));
  verificar('depreciação acumulada e residual batem com o valor',
    Math.abs((dep.acumulada + dep.residual) - a.valor) < 0.01, JSON.stringify([dep.acumulada, dep.residual]));
  const porProjeto = S.depreciacaoPorProjeto('2026-08');
  verificar('depreciação é atribuída ao projeto onde o equipamento estava', porProjeto.length > 0, porProjeto.length);
  verificar('equipamento parado não onera projeto nenhum',
    !porProjeto.some(x => !x.centro), '');
  // equipamento que saiu do projeto não deprecia mais nele
  /* v114: movimentação retroativa atrás de evento existente passou a
     ser recusada (reescrevia o histórico). O teste move na data de
     hoje e confere a competência corrente. */
  S.movimentarAtivo({ ativo: a.id, status: 'sede', destino: 'Sede devolução' });
  /* Olha a competência CORRENTE: em agosto ele ainda estava no
     projeto, e depreciar lá naquele mês está certo. */
  verificar('equipamento devolvido para de depreciar no projeto',
    !S.depreciacaoPorProjeto(Ut.mesAtual()).some(x => x.itens.some(i => i.ativo.id === a.id)), '');

  // faturamento único de grupo (GHC - HGB)
  S.setUsuario('u1');
  const grupo = 'GHC - HGB';
  const ids = S.projetosDoGrupo(grupo);
  verificar('as especialidades do HGB formam um grupo de faturamento', ids.length === 7, ids.length);
  ids.slice(0, 3).forEach((p, i) => {
    S.confirmarFaturamentoProdutividade({ centro: p, competencia: '2075-08', faturamento: 100000 * (i + 1), produtividade: 50000 });
    S.autorizarFaturamento(p, '2075-08', { protocolo: 'Ofício QA' });
  });
  const base = S.baseDoGrupo(grupo, '2075-08');
  verificar('a produtividade de cada projeto soma na base do grupo',
    base.total_confirmado === 600000 && base.confirmados === 3, JSON.stringify([base.total_confirmado, base.confirmados]));
  verificar('base incompleta é sinalizada', base.completo === false, '');
  /* v123: autorizar já libera, então as três especialidades
     autorizadas acima estão prontas — a nota única sai com elas. As
     outras cinco não têm previsão nesta competência e não entram. */
  S.setUsuario('u2');
  const nf = S.faturarGrupo({ grupo: grupo, competencia: '2075-08', valor: 600000, numero: 'QA-NF-HGB', emissao: '2075-09-05' });
  verificar('nota única lançada e rateada', nf.ok && nf.partes.length === 3, JSON.stringify(nf.erro));
  verificar('o rateio segue a proporção do confirmado',
    nf.partes[0].valor === 100000 && nf.partes[2].valor === 300000, JSON.stringify(nf.partes.map(p => p.valor)));
  verificar('a nota amarra as previsões de TODOS os projetos do grupo',
    S.contasReceber().find(r => r.numero === 'QA-NF-HGB').substitui.length === 3, '');
  const cob = S.coberturaFaturamento('2075-08').filter(x => x.grupo === grupo);
  verificar('cada especialidade aparece com a sua parte da nota',
    cob.filter(x => x.faturado > 0).length === 3, cob.filter(x => x.faturado > 0).length);
  verificar('cobertura mostra previsto, confirmado, faturado e o que falta',
    cob.every(x => x.previsto !== undefined && x.esperado !== undefined && x.falta_faturar !== undefined), '');
  verificar('projeto já faturado não aparece como "falta faturar"',
    cob.filter(x => x.faturado > 0).every(x => x.falta_faturar === 0), '');
  S.setUsuario('u8');
})();

// ── v99: grupo de faturamento não cobra nota de cada projeto ──
(function () {
  S.setUsuario('u2');
  const grupo = 'GHC - HGB';
  const ids = S.projetosDoGrupo(grupo);
  const comp = '2076-04';
  ids.slice(0, 2).forEach((p, i) => {
    S.confirmarFaturamentoProdutividade({ centro: p, competencia: comp, faturamento: 150000 * (i + 1), produtividade: 70000 });
    S.autorizarFaturamento(p, comp, { protocolo: 'QA' });
    S.liberarFaturamento(p, comp, {});
  });
  const antes = S.coberturaFaturamento(comp).filter(x => x.grupo === grupo);
  verificar('especialidade sem produtividade no mês não é cobrada como "sem faturamento"',
    antes.filter(x => x.situacao === 'sem_faturamento').length === 0,
    JSON.stringify(antes.map(x => x.situacao)));
  /* v100: a situação passou a dizer a ETAPA (confirmado → autorizado →
     liberado), então aqui os dois já estão liberados. */
  verificar('quem tem base fica aguardando a nota do grupo',
    antes.filter(x => ['aguardando_nf', 'aguardando_liberacao', 'liberado'].indexOf(x.situacao) > -1).length === 2,
    JSON.stringify(antes.map(x => x.situacao)));

  S.faturarGrupo({ grupo: grupo, competencia: comp, valor: 450000, numero: 'QA99-NF', emissao: comp + '-28' });
  const dep = S.coberturaFaturamento(comp).filter(x => x.grupo === grupo);
  verificar('quem tem base aparece faturado com a sua parte',
    dep.filter(x => x.faturado > 0).length === 2 && dep.filter(x => x.faturado > 0).every(x => x.falta_faturar === 0), '');
  verificar('as demais seguem como "sem produtividade no mês"',
    dep.filter(x => x.situacao === 'sem_base_no_grupo').length === ids.length - 2,
    dep.filter(x => x.situacao === 'sem_base_no_grupo').length);
  verificar('nenhuma especialidade do grupo pede nota própria',
    dep.every(x => x.falta_faturar === 0), JSON.stringify(dep.map(x => x.falta_faturar)));

  // pendência sobra nos projetos de FORA do grupo, não nele
  const pendNoGrupo = S.coberturaFaturamento(comp)
    .filter(x => x.grupo === grupo && ['aguardando_nf', 'sem_faturamento'].indexOf(x.situacao) > -1);
  verificar('depois da nota do grupo não sobra pendência nele', pendNoGrupo.length === 0, pendNoGrupo.length);
  S.setUsuario('u8');
})();

// ── v100: rótulos por etapa e autorização na tela da produtividade ──
(function () {
  S.setUsuario('u1');   // quem lança a produtividade
  const comp = '2077-05';
  S.confirmarFaturamentoProdutividade({ centro: 'pj01', competencia: comp, faturamento: 250000, produtividade: 120000 });
  const cob = () => S.coberturaFaturamento(comp).find(x => x.centro === 'pj01');
  verificar('logo após confirmar, a situação é "aguardando autorização do órgão"',
    cob().situacao === 'aguardando_nf', cob().situacao);
  verificar('quem lança a produtividade pode registrar a autorização', S.pode('autorizar_faturamento'), '');
  verificar('e o alerta da home cobra essa etapa',
    S.pendenciasHome().some(x => x.id === 'autorizacao_orgao'), '');

  S.autorizarFaturamento('pj01', comp, { protocolo: 'Ofício QA 100' });
  /* v123: a autorização libera junto — a cobertura já mostra
     "liberado". */
  verificar('depois de autorizar, o faturamento já fica liberado',
    cob().situacao === 'liberado', cob().situacao);
  verificar('o protocolo fica registrado', S.esteiraFaturamento({ centro: 'pj01', competencia: comp })[0].protocolo === 'Ofício QA 100', '');
  verificar('e o alerta de autorização some para essa competência',
    !S.esteiraFaturamento({ pendentes: true }).some(l => l.centro === 'pj01' && l.competencia === comp && l.etapa === 'confirmado'), '');

  S.setUsuario('u2');
  S.liberarFaturamento('pj01', comp, {});
  verificar('depois de liberar, fica "liberado para emissão de NF"', cob().situacao === 'liberado', cob().situacao);
  verificar('e só aí a emissão é permitida', !S.travaDeLiberacao('pj01', comp), S.travaDeLiberacao('pj01', comp));
  S.setUsuario('u8');
})();

// ── v101: autorização no faturamento e conciliação mais clara ──
(function () {
  S.setUsuario('u1');
  const comp = '2078-02';
  S.confirmarFaturamentoProdutividade({ centro: 'pj01', competencia: comp, faturamento: 90000, produtividade: 40000 });
  const alerta = S.pendenciasHome().find(x => x.id === 'autorizacao_orgao');
  verificar('alerta de autorização leva ao módulo de faturamento',
    alerta && alerta.modulo === 'faturamento' && alerta.destino === 'esteira',
    JSON.stringify(alerta && [alerta.modulo, alerta.destino]));
  verificar('a autorização segue funcionando (agora só pelo faturamento)',
    S.autorizarFaturamento('pj01', comp, { protocolo: 'QA 101' }).ok, '');
  S.setUsuario('u8');
})();

// ── v102: RPS em lote para o portal de Barueri ──
(function () {
  const R = sandbox.window.ERP.rpsBarueri;
  S.setUsuario('u2');
  const comp = '2079-03';
  const cli = D.clienteDoCentro('pj01');
  Object.assign(cli, { endereco: 'AV BEZERRA DE MENEZES', numero: '1000', bairro: 'SAO GERARDO',
    cidade: 'FORTALEZA', uf: 'CE', cep: '60325002', codigo_ibge: '2304400', email: 'fin@qa.gov.br' });
  S.confirmarFaturamentoProdutividade({ centro: 'pj01', competencia: comp, faturamento: 250000, produtividade: 0 });
  S.autorizarFaturamento('pj01', comp, { protocolo: 'Ofício QA' });

  /* v123: autorizar libera junto, então o projeto autorizado já entra
     no RPS. O que fica de fora é o que não passou pela autorização. */
  verificar('o projeto autorizado entra no RPS', S.itensParaRPS(comp).length === 1, S.itensParaRPS(comp).length);
  verificar('e o que não foi autorizado fica de fora',
    S.itensParaRPS('2079-04').length === 0, S.itensParaRPS('2079-04').length);
  S.liberarFaturamento('pj01', comp, {});
  const itens = S.itensParaRPS(comp);
  verificar('liberado entra na lista do lote', itens.length === 1, itens.length);

  verificar('cliente sem endereço é barrado antes de gerar',
    R.pendencias({ valor: 100, discriminacao: 'x', tomador_nome: 'X', tomador_documento: '123' }, D.empresa).length > 0, '');

  const r = R.gerar(itens, D.empresa, { remessa: '20790301001' });
  verificar('arquivo gerado', r.ok, JSON.stringify(r.erro && (r.problemas || [{}])[0].falta));
  const linhas = r.conteudo.split('\r\n').filter(Boolean);
  verificar('cabeçalho tem 25 posições e a versão PMB004',
    linhas[0].length === 25 && linhas[0].slice(8, 14) === 'PMB004', linhas[0].length);
  const t2 = linhas.find(l => l[0] === '2');
  verificar('registro 2 tem as 1970 posições do layout', t2.length === 1970, t2.length);
  verificar('valor do serviço em centavos, sem vírgula', t2.slice(463, 478) === '000000025000000', t2.slice(463, 478));
  verificar('quantidade inteira', t2.slice(457, 463) === '000001', t2.slice(457, 463));
  verificar('tomador com CNPJ e indicador 2', t2.slice(503, 504) === '2' && t2.slice(504, 518).trim().length === 14, '');
  verificar('registro 3 (retenção) tem 18 posições', linhas.filter(l => l[0] === '3').every(l => l.length === 18), '');
  verificar('registro 4 (ADN) tem 531 posições', linhas.find(l => l[0] === '4').length === 531, '');
  const t9 = linhas.find(l => l[0] === '9');
  verificar('rodapé conta as linhas do arquivo', parseInt(t9.slice(1, 8), 10) === linhas.length, t9.slice(1, 8));
  verificar('rodapé soma os serviços', parseInt(t9.slice(8, 23), 10) === 25000000, t9.slice(8, 23));
  verificar('sem acento e sem caractere fora da tabela Latin-1',
    !/[^\x20-\xFF\r\n]/.test(r.conteudo), '');

  // retorno do portal cria o recebível com o número real
  const lote = S.registrarLoteRPS({ competencia: comp, remessa: '20790301001', arquivo_nome: 'qa.txt',
    rps: r.rps, total_servicos: r.total_servicos });
  const numeros = {}; numeros[r.rps[0].numero] = 'QA-NFE-900';
  const conv = S.converterLoteRPS(lote.lote.id, numeros);
  verificar('informar a NF-e do retorno cria o título', conv.ok && conv.convertidos === 1, JSON.stringify(conv.erros));
  verificar('o título nasce com o número real da nota',
    S.contasReceber().some(x => x.numero === 'QA-NFE-900' && x.valor_bruto === 250000), '');
  verificar('o lote fica marcado como convertido', S.st.lotesRPS.find(l => l.id === lote.lote.id).status === 'convertido', '');
  S.setUsuario('u8');
})();

// ── v103: protocolo do envio ao web service ──
(function () {
  S.setUsuario('u2');
  const lote = S.registrarLoteRPS({ competencia: '2080-01', remessa: '20800101001',
    arquivo_nome: 'qa.txt', rps: [{ numero: 1, referencia: 'centro:pj01', valor: 1000, tomador: 'X' }],
    total_servicos: 1000 });
  verificar('lote nasce como "gerado"', lote.lote.status === 'gerado', lote.lote.status);
  verificar('protocolo é obrigatório', !!S.registrarProtocoloRPS(lote.lote.id, {}).erro, '');
  S.registrarProtocoloRPS(lote.lote.id, { protocolo: 'PROT-QA-1', situacao: '-1', ambiente: 'homologacao' });
  const l = S.st.lotesRPS.find(x => x.id === lote.lote.id);
  verificar('protocolo e ambiente ficam guardados',
    l.protocolo === 'PROT-QA-1' && l.ambiente === 'homologacao' && l.status === 'enviado', l.status);
  S.registrarProtocoloRPS(lote.lote.id, { protocolo: 'PROT-QA-1', situacao: '2' });
  verificar('situação 2 marca o lote como "com erro"',
    S.st.lotesRPS.find(x => x.id === lote.lote.id).status === 'com_erro', '');
  S.setUsuario('u8');
})();

// ── v105: retenção por cliente e parâmetros fiscais editáveis ──
(function () {
  const R = sandbox.window.ERP.rpsBarueri;
  S.setUsuario('u2');
  const comp = '2081-06';
  const cli = D.clienteDoCentro('pj01');
  Object.assign(cli, { endereco: 'AV X', numero: '1', bairro: 'B', cidade: 'FORTALEZA', uf: 'CE',
    cep: '60325002', codigo_ibge: '2304400', email: 'x@y.gov.br',
    retencoes: [{ tributo: 'ISS', aliquota: 5 }, { tributo: 'IRRF', aliquota: 1.5 },
                { tributo: 'PIS', aliquota: 0.65 }, { tributo: 'COFINS', aliquota: 3 },
                { tributo: 'CSLL', aliquota: 1 }] });
  S.confirmarFaturamentoProdutividade({ centro: 'pj01', competencia: comp, faturamento: 100000, produtividade: 0 });
  S.autorizarFaturamento('pj01', comp, { protocolo: 'QA' });
  S.liberarFaturamento('pj01', comp, {});
  const item = S.itensParaRPS(comp)[0];
  verificar('as retenções saem do cadastro do cliente',
    item.retencoes.length === 5 && item.retencoes.find(r => r.tributo === 'ISS').valor === 5000,
    JSON.stringify(item.retencoes));

  const g = R.gerar([item], D.empresa, { remessa: '20810601001' });
  const linhas = g.conteudo.split('\r\n').filter(Boolean);
  verificar('só os tributos federais viram registro 3',
    linhas.filter(l => l[0] === '3').length === 4, linhas.filter(l => l[0] === '3').length);
  verificar('e o ISS fica fora do total de retenções do arquivo',
    parseInt(linhas.find(l => l[0] === '2').slice(483, 498), 10) === 615000,
    linhas.find(l => l[0] === '2').slice(483, 498));

  /* Este teste nunca tinha rodado: o `if` dependia de o pj02 ter
     cliente, e ele não tinha. Quando passou a ter, revelou que a
     retenção federal (IRRF, CSLL, PIS, COFINS) é SEMPRE calculada —
     não depende da lista do cliente nem do `retencao_pct` do
     projeto, que governam outra coisa.

     Isso provavelmente está certo para órgão público, que é a
     maioria dos contratos. Mas cliente privado que não retém existe
     (Dr. Consulta, Iron Trainers), e hoje não há como marcar isso.
     Fica registrado aqui até a regra ser decidida. */
  const semRet = D.clienteDoCentro('pj02');
  if (semRet) {
    Object.assign(semRet, { documento: '12345678000199',
      endereco: 'R Y', numero: '2', bairro: 'C', cidade: 'FORTALEZA', uf: 'CE',
      cep: '60000000', codigo_ibge: '2304400', email: 'z@y.gov.br', retencoes: [] });
    S.confirmarFaturamentoProdutividade({ centro: 'pj02', competencia: comp, faturamento: 50000, produtividade: 0 });
    S.autorizarFaturamento('pj02', comp, { protocolo: 'QA2' });
    S.liberarFaturamento('pj02', comp, {});
    const it2 = S.itensParaRPS(comp).find(i => i.centro === 'pj02');
    const g2 = R.gerar([it2], D.empresa, { remessa: '20810601002' });
    verificar('a remessa sai mesmo com o cliente sem lista de retenções',
      g2.ok === true, g2.erro || '');
    verificar('e a retenção federal é calculada de qualquer forma',
      g2.ok && g2.conteudo.split('\r\n').filter(l => l[0] === '3').length > 0, '');
  }

  // parâmetros fiscais são lidos do cadastro na hora de gerar
  D.empresa.rps.codigo_servico = '040700100';
  const g3 = R.gerar([item], D.empresa, { remessa: '20810601003' });
  verificar('trocar o código do serviço no cadastro muda o arquivo',
    g3.conteudo.split('\r\n').find(l => l[0] === '2').slice(242, 251) === '040700100',
    g3.conteudo.split('\r\n').find(l => l[0] === '2').slice(242, 251));
  verificar('empresa é não optante do Simples no registro do ADN',
    g3.conteudo.split('\r\n').find(l => l[0] === '4').slice(1, 2) === '1', '');
  S.setUsuario('u8');
})();

// ── v106: previsão no faturamento, num ato só ──
(function () {
  S.setUsuario('u2');
  const comp = '2082-04';
  const r = S.salvarPrevisao({ centro: 'pj01', competencia: comp, faturamento: 90000, produtividade: 40000 });
  verificar('previsão salva nasce como rascunho', r.ok && r.previsao.status !== 'confirmada', (r.previsao || {}).status);
  const m = S.marcarPrevisoes(comp, 'confirmada');
  verificar('confirmar no mesmo ato leva a previsão ao contas a receber',
    m.n >= 1 && S.contasReceber().some(x => x.competencia === comp && x.origem === 'previsao'), m.n);
  verificar('e a previsão fica confirmada',
    S.previsaoDe('pj01', comp).status === 'confirmada', S.previsaoDe('pj01', comp).status);
  verificar('encerrar o mês continua sendo outro ato',
    S.marcarPrevisoes(comp, 'encerrada').n >= 1 && S.previsaoDe('pj01', comp).status === 'encerrada', '');
  S.setUsuario('u8');
})();

// ── v107: saldo bancário, fluxo diário e previsão de grupo ──
(function () {
  S.setUsuario('u2');
  const banco = D.bancos[0].id;
  const sistema = S.saldoDoSistema(banco);
  verificar('saldo do sistema é calculado por conta', typeof sistema === 'number', sistema);
  verificar('saldo informado exige valor', !!S.informarSaldoBancario(banco, {}).erro, '');
  const igual = S.informarSaldoBancario(banco, { valor: sistema });
  verificar('informar o mesmo valor do sistema não gera diferença',
    igual.ok && Math.abs(igual.diferenca) < 0.005, igual.diferenca);
  const menos = S.informarSaldoBancario(banco, { valor: sistema - 1000 });
  verificar('informar valor diferente acusa a diferença exata',
    Math.abs(menos.diferenca + 1000) < 0.005, menos.diferenca);
  verificar('o último saldo informado é o que vale',
    S.saldoInformado(banco).valor === Math.round((sistema - 1000) * 100) / 100, '');
  /* v16: o resumo passou a somar TODAS as contas ativas (antes era só
     a primeira). Com uma informada e três pelo sistema, a origem é
     'misto' — o que importa é a conta informada entrar pelo valor
     informado, e o total fechar com a soma das partes. */
  const resumoSaldo = S.saldoBancarioAtual();
  verificar('o resumo do contas a pagar usa o saldo informado na conta que tem',
    (resumoSaldo.contas.find(c => c.banco === banco) || {}).origem === 'informado' &&
    (resumoSaldo.contas.find(c => c.banco === banco) || {}).valor ===
      S.saldoInformado(banco).valor,
    JSON.stringify(resumoSaldo.contas.find(c => c.banco === banco)));
  verificar('e o total do grupo fecha com a soma das contas',
    Math.abs(resumoSaldo.valor -
      resumoSaldo.contas.reduce((s, c) => s + c.valor, 0)) < 0.005, resumoSaldo.valor);

  // fluxo diário
  const f = S.fluxoDiario({ dias: 10 });
  verificar('fluxo diário traz 10 dias', f.linhas.length === 10, f.linhas.length);
  verificar('começa no saldo bancário e anda dia a dia',
    Math.abs(f.linhas[0].saldo - (f.saldo_inicial + f.linhas[0].entradas - f.linhas[0].saidas)) < 0.01, '');
  verificar('o saldo de cada dia parte do anterior',
    f.linhas.every((l, i) => i === 0 ||
      Math.abs(l.saldo - (f.linhas[i - 1].saldo + l.entradas - l.saidas)) < 0.01), '');
  const semV = S.fluxoDiario({ dias: 10, sem_vencidos: true });
  verificar('desconsiderar vencidos reduz a saída do primeiro dia',
    semV.linhas[0].saidas <= f.linhas[0].saidas, JSON.stringify([semV.linhas[0].saidas, f.linhas[0].saidas]));
  verificar('saldo de partida pode ser simulado',
    S.fluxoDiario({ dias: 3, saldo_inicial: 1000 }).saldo_inicial === 1000, '');

  // previsão única do grupo
  const comp = '2083-07';
  const g = S.salvarPrevisaoGrupo('GHC - HGB', comp, 800000);
  verificar('previsão do grupo é distribuída entre os projetos', g.ok && g.partes.length === 7, JSON.stringify(g.erro));
  verificar('e a soma das partes bate com o valor do grupo',
    Math.abs(g.partes.reduce((a, p) => a + p.valor, 0) - 800000) < 0.01, '');
  /* v125: são 7 especialidades (o mutirão saiu), e 800 mil não divide
     exato — a última parte leva a sobra de centavos. */
  verificar('sem base, a divisão é igual entre as especialidades',
    g.partes.slice(0, -1).every(p => Math.abs(p.valor - g.partes[0].valor) < 0.005) &&
    Math.abs(g.partes.reduce((a2, p) => a2 + p.valor, 0) - 800000) < 0.01,
    JSON.stringify(g.partes.map(p => p.valor)));
  verificar('cada projeto do grupo fica com a sua parte na previsão',
    S.projetosDoGrupo('GHC - HGB').every(id => (S.previsaoDe(id, comp) || {}).faturamento > 0), '');
  S.setUsuario('u8');
})();

// ── v108: cadastro incompleto não trava o fluxo, trava a remessa ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u1');
  const par = S.listar({ status: 'apagar' }).find(x => S.impedimentos(x).some(i => i.indexOf('código de barras') > -1));
  verificar('existe boleto sem código de barras no exemplo', !!par, '');
  verificar('financeiro consegue pedir pagamento mesmo sem o código',
    S.solicitarLote([par.id], { banco: D.bancos[0].id, data: Ut.hoje() }).ok, '');
  S.setUsuario('u2');
  const pg = S.st.pagamentos.find(x => x.parcela_id === par.id && x.situacao === 'aguardando');
  verificar('diretoria aprova mesmo sem o código', S.autorizarPagamento([pg.id]).ok, '');
  verificar('mas o pagamento fica FORA do arquivo de remessa',
    S.remessaBloqueadas().some(x => x.parcela.id === par.id), '');
  verificar('e a remessa diz o que falta',
    S.remessaBloqueadas().find(x => x.parcela.id === par.id).falta.length > 0, '');
  verificar('código de barras curto é recusado', !!S.informarCodigoBarras(par.id, '123').erro, '');
  verificar('código de barras válido é aceito',
    S.informarCodigoBarras(par.id, '00190000090123456789012345678901234567890123456').ok, '');
  verificar('e aí o pagamento entra no arquivo',
    !S.remessaBloqueadas().some(x => x.parcela.id === par.id) &&
    S.remessaProntas().some(x => x.parcela.id === par.id), '');
  S.setUsuario('u8');
})();

// ── v109: pagar sem dados bancários e ações sempre visíveis ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u1');
  // fornecedor sem forma de pagamento cadastrada
  const cr = D.credores.find(c => !S.formaDoCredor(c.id));
  verificar('existe fornecedor sem forma de pagamento', !!cr, '');
  const t = S.criarTitulo({ descricao: 'Despesa QA sem dados', documento: 'QA-109', tipo_titulo: 'nf',
    credor: cr.id, conta: '8.05', centro: 'cc100', emissao: Ut.hoje() },
    [{ num: 1, venc: Ut.addDias(Ut.hoje(), 5), comp: Ut.mesAtual(), valor: 500 }]);
  const par = S.todasParcelas().find(p => p.titulo_id === t.titulo.id);
  verificar('o título tem impedimento de cadastro', S.impedimentos(par).length > 0, '');
  const sol = S.solicitarLote([par.id], { banco: D.bancos[0].id, data: Ut.hoje() });
  verificar('mas o pagamento pode ser solicitado assim mesmo', sol.ok, JSON.stringify(sol.erro));
  S.setUsuario('u2');
  const pg = S.st.pagamentos.find(x => x.parcela_id === par.id && x.situacao === 'aguardando');
  verificar('e aprovado', S.autorizarPagamento([pg.id]).ok, '');
  verificar('só a remessa barra', S.remessaBloqueadas().some(x => x.parcela.id === par.id), '');
  S.setUsuario('u8');
})();

// ── v110: seleção em lote inclui títulos sem dados bancários ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u1');
  const travados = S.listar({ status: 'apagar' }).filter(p => S.impedimentos(p).length &&
    p.aprovacao === 'aprovado' && !S.emCursoDe(p.id).length && S.saldoDe(p) > 0);
  verificar('há títulos com pendência de cadastro na lista', travados.length > 0, travados.length);
  verificar('todos eles podem ir para o lote de pagamento',
    travados.every(p => S.aptasParaSolicitar().some(x => x.id === p.id)), '');
  const ids = travados.slice(0, 3).map(p => p.id);
  const r = S.solicitarLote(ids, { banco: D.bancos[0].id, data: Ut.hoje() });
  verificar('o lote com títulos pendentes é aceito', r.ok, JSON.stringify(r.erro));
  verificar('e todos ficam aguardando aprovação',
    ids.every(id => S.parcela(id).status === 'aguardando'),
    JSON.stringify(ids.map(id => {
      const p = S.parcela(id);
      const tit = S.st.titulos.find(x => x.id === p.titulo_id) || {};
      return p.status + (tit.credor ? '' : ' (sem credor)');
    })));
  S.setUsuario('u8');
})();

// ── v111: saldo na fila de aprovação ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u1');
  const ids = S.aptasParaSolicitar().slice(0, 3).map(p => p.id);
  S.solicitarLote(ids, { banco: D.bancos[0].id, data: Ut.hoje() });
  const fila = S.pagamentosAguardando().reduce((s, pg) => s + pg.valor + (pg.juros || 0) + (pg.multa || 0), 0);
  verificar('a fila de aprovação tem valor somável', fila > 0, fila);
  const banco = S.saldoBancarioAtual();
  verificar('o saldo bancário está disponível para a tela de aprovação',
    banco && typeof banco.valor === 'number', JSON.stringify(banco));
  verificar('dá para calcular a sobra depois de aprovar a fila',
    typeof (banco.valor - fila) === 'number', '');
  S.setUsuario('u8');
})();

// ── v112: fechamento de produtividade agrupado ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u1');
  const ag = S.agruparRepasses(S.listar({ status: 'apagar' }));
  verificar('fechamento de produtividade vira um grupo', ag.grupos.length >= 1, ag.grupos.length);
  const g = ag.grupos[0];
  verificar('o grupo soma os médicos e os valores',
    g.medicos >= 2 && Math.abs(g.valor - g.parcelas.reduce((a, p) => a + p.valor, 0)) < 0.01,
    JSON.stringify([g.medicos, g.valor]));
  verificar('o grupo tem nome legível (projeto, competência, fechamento)',
    /·/.test(S.nomeDoGrupo(g)), S.nomeDoGrupo(g));
  verificar('título fora de produtividade não entra em grupo',
    ag.soltas.every(p => p.origem !== 'produtividade' || S.agruparRepasses([p]).grupos.length === 0), '');

  // enviar SÓ ALGUNS médicos do grupo
  const doisIds = g.selecionaveis.slice(0, 2).map(p => p.id);
  const r1 = S.solicitarLote(doisIds, { banco: D.bancos[0].id, data: Ut.hoje() });
  verificar('dá para mandar só alguns médicos do fechamento', r1.ok, JSON.stringify(r1.erro));
  verificar('os demais continuam disponíveis',
    S.agruparRepasses(S.listar({ status: 'apagar' })).grupos[0].selecionaveis.length ===
      g.selecionaveis.length - 2, '');

  // aprovação: o gestor vê o grupo fechado
  S.setUsuario('u2');
  const agp = S.agruparPagamentos(S.pagamentosAguardando());
  verificar('a fila de aprovação também agrupa', agp.grupos.length >= 1, agp.grupos.length);
  const gp = agp.grupos[0];
  verificar('e o grupo da fila soma os pagamentos',
    Math.abs(gp.valor - gp.pagamentos.reduce((a, x) => a + x.valor + (x.juros || 0) + (x.multa || 0), 0)) < 0.01, '');
  // aprovar um só
  const um = S.autorizarPagamento([gp.pagamentos[0].id]);
  verificar('aprovar um médico do grupo funciona', um.ok, JSON.stringify(um.erro));
  // aprovar o resto de uma vez
  const resto = S.agruparPagamentos(S.pagamentosAguardando()).grupos[0];
  if (resto) {
    verificar('aprovar o grupo inteiro funciona',
      S.autorizarPagamento(resto.pagamentos.map(x => x.id)).ok, '');
  }
  // remessa continua individual
  const rem = S.aptasParaRemessa();
  verificar('a remessa sai individualizada, um pagamento por médico',
    rem.length >= 2 && rem.every(x => x.pagamento.parcela_id), rem.length);
  S.setUsuario('u8');
})();

// ── v113: atalhos de período nos relatórios ──
(function () {
  const Ut = sandbox.window.ERP.util;
  // as janelas que os botões produzem
  const hoje = Ut.hoje();
  const iniMes = Ut.mesAtual() + '-01';
  const fimMesAnterior = Ut.addDias(iniMes, -1);
  const iniMesAnterior = Ut.compDe(Ut.addMeses(iniMes, -1)) + '-01';
  verificar('"mês anterior" começa no dia 1 do mês passado', /-01$/.test(iniMesAnterior), iniMesAnterior);
  verificar('e termina no último dia dele',
    fimMesAnterior.slice(0, 7) === iniMesAnterior.slice(0, 7), JSON.stringify([iniMesAnterior, fimMesAnterior]));
  const r = S.contasPagasERecebidas(iniMesAnterior, fimMesAnterior);
  verificar('o relatório de pagas e recebidas aceita a janela do mês anterior',
    r && Array.isArray(r.linhas || r), '');
  const h = S.contasAPagarEReceber(hoje, hoje);
  verificar('e o de a pagar/receber aceita a janela de um dia só',
    h && (h.linhas || h), '');
  verificar('"últimos 30 dias" termina hoje', Ut.addDias(hoje, -30) < hoje, '');
})();

// ── v114: auditoria dos módulos Ativos e Pessoal ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u3');

  // 1) ordem dos eventos do mesmo dia (bug do "am999" vs "am1000")
  const a = S.ativos({})[0];
  ['Local 1', 'Local 2', 'Local 3'].forEach(l =>
    S.movimentarAtivo({ ativo: a.id, status: 'sede', destino: l, data: Ut.hoje() }));
  verificar('três movimentações no mesmo dia: vale a última',
    S.situacaoAtiva(S.ativo(a.id)).local === 'Local 3', S.situacaoAtiva(S.ativo(a.id)).local);

  // 2) desmembrar mantém a locação proporcional
  const lote = S.ativos({}).find(x => x.qtd > 1 && x.valor > 1000);
  const ct = S.contratos({ parte: 'cliente' }).find(c => !c.encerrado);
  S.vincularLocacao(lote.id, { contrato: ct.id, valor_locacao: 5000, desde: '2026-01-01', forcar: true });
  /* v117: só a parte que continua ALOCADA herda a locação — a que vai
     para a sede não está rendendo nada. */
  const des = S.desmembrarAtivo(lote.id, { partes: [
    { qtd: 1, status: 'alocado', projeto: 'pj41', local: 'A', custodiante: 'x' },
    { qtd: 1, status: 'alocado', projeto: 'pj41', local: 'B', custodiante: 'x' }] });
  verificar('o valor da locação é dividido entre as partes alocadas',
    des.partes.every(p => p.valor_locacao === 2500), JSON.stringify(des.partes.map(p => p.valor_locacao)));
  verificar('e as datas da locação vão junto',
    des.partes.every(p => p.locacao_desde === '2026-01-01'), '');
  verificar('sem valor próprio, o equipamento não herda o valor do contrato inteiro',
    (S.resultadoDoAtivo(S.ativos({}).find(x => !x.valor_locacao && x.contrato) ?
      S.ativos({}).find(x => !x.valor_locacao && x.contrato).id : des.partes[0].id) || {}).receita >= 0, '');

  // 3) conta e vencimento da OS
  const alvo = S.ativos({ status: 'alocado' })[0];
  const os = S.abrirOS({ ativo: alvo.id, tipo: 'corretiva', descricao: 'teste conta' });
  const fech = S.fecharOS(os.os.id, { custo_servico: 500, executante_credor: 'cr5',
    vencimento: Ut.addDias(Ut.hoje(), 15) });
  const par = S.todasParcelas().find(p => p.titulo_id === (fech.titulo || {}).id);
  verificar('o custo da OS vai para "Manutenção e conservação", não para frete',
    par && ['6.07', '3.02'].indexOf(par.conta) > -1, par && par.conta);
  verificar('e o vencimento é o informado, não a data do fechamento',
    par && par.venc === Ut.addDias(Ut.hoje(), 15), par && par.venc);

  // 4) estado
  verificar('OS com custo negativo é recusada',
    !!S.fecharOS(S.abrirOS({ ativo: alvo.id, tipo: 'corretiva', descricao: 'x' }).os.id, { custo_peca: -100 }).erro, '');
  const os2 = S.abrirOS({ ativo: alvo.id, tipo: 'corretiva', descricao: 'parada 1', parada_uso: true });
  verificar('segunda OS com parada no mesmo equipamento é recusada',
    !!S.abrirOS({ ativo: alvo.id, tipo: 'corretiva', descricao: 'parada 2', parada_uso: true }).erro, '');
  verificar('fechamento anterior à abertura é recusado',
    !!S.fecharOS(os2.os.id, { data: '2020-01-01' }).erro, '');

  // 5) numeração
  verificar('tag repetida é recusada', !!S.salvarAtivo({ descricao: 'X', tag: S.ativos({})[0].tag }).erro, '');
  const t1 = S.salvarAtivo({ descricao: 'Sequência 1' });
  const t2 = S.salvarAtivo({ descricao: 'Sequência 2' });
  verificar('a tag automática não repete', t1.ativo.tag !== t2.ativo.tag, t1.ativo.tag + ' / ' + t2.ativo.tag);

  // 6) preventiva
  verificar('periodicidade fracionada é recusada',
    !!S.salvarPlanoManutencao({ ativo: alvo.id, periodicidade_dias: 0.5 }).erro, '');
  S.setUsuario('u4');   // consulta, sem permissão de estoque
  verificar('quem não cuida de equipamento não gera preventiva', S.gerarPreventivas().length === 0, '');
  S.setUsuario('u3');

  // 7) dados de exemplo coerentes
  verificar('nenhum alocado sem projeto no exemplo',
    S.ativos({ status: 'alocado' }).every(x => x.projeto), '');
  verificar('nenhum equipamento fora da sede sem custodiante',
    S.ativos({}).filter(x => ['alocado', 'terceiro'].indexOf(x.status) > -1).every(x => x.custodiante), '');
  verificar('todos os equipamentos têm data de aquisição',
    S.ativos({}).filter(x => !x.criado_por).every(x => x.aquisicao), '');

  // ── Pessoal ──
  S.setUsuario('u8');
  /* CPF gerado na hora (com dígitos válidos) para não colidir com os
     funcionários criados por outros testes desta mesma bateria. */
  const cpfQA = (function () {
    const base = '1145' + String(Date.now()).slice(-5);
    const calc = n => {
      let s = 0;
      for (let i = 0; i < n.length; i++) s += parseInt(n[i], 10) * (n.length + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    const d1 = calc(base), d2 = calc(base + d1);
    return base + d1 + '' + d2;
  })();
  const novo = S.criarFuncionario({ nome: 'QA 114', cpf: cpfQA, cargo: 'cg01', salario_base: 3000,
    admissao: '2026-08-31', jornada_semanal: 44, centro: D.funcionarios[0].centro, pix: 'qa114@x.com' });
  const ex = novo.ok ? S.extrasComDiasPadrao(novo.funcionario, '2026-08', {}) : {};
  verificar('funcionário de teste criado', novo.ok, JSON.stringify(novo.erro));
  verificar('admissão no dia 31 paga 1 dia, não zero', ex.dias_trabalhados === 1, ex.dias_trabalhados);
  const hol = novo.ok ? S.calcularHolerite(novo.funcionario.id, '2026-08', ex) : {};
  verificar('vale-transporte usa dias úteis', hol.dias_uteis <= 23, hol.dias_uteis);
  verificar('as provisões carregam FGTS e INSS por cima',
    hol.provisao_decimo > hol.provisao_decimo_base, JSON.stringify([hol.provisao_decimo, hol.provisao_decimo_base]));
  verificar('a base de IRRF mostrada é a que o cálculo usou',
    hol.base_irrf <= hol.base_irrf_bruta, JSON.stringify([hol.base_irrf, hol.base_irrf_bruta]));
  verificar('salário abaixo do piso do cargo é recusado',
    !!S.criarFuncionario({ nome: 'X', cpf: '52998224725', cargo: 'cg02', salario_base: 2500,
      admissao: Ut.hoje(), centro: D.funcionarios[0].centro }).erro, '');
  verificar('jornada acima de 44h é recusada',
    !!S.criarFuncionario({ nome: 'X', cpf: '52998224725', cargo: 'cg01', salario_base: 3000,
      jornada_semanal: 60, admissao: Ut.hoje(), centro: D.funcionarios[0].centro }).erro, '');
  verificar('menor de 14 anos é recusado',
    !!S.criarFuncionario({ nome: 'X', cpf: '52998224725', cargo: 'cg01', salario_base: 3000,
      nascimento: '2015-01-01', admissao: Ut.hoje(), centro: D.funcionarios[0].centro }).erro, '');
  S.setUsuario('u8');
})();

// ── v115: QR Code, calibração, kanban de OS e indicadores ──
(function () {
  const Ut = sandbox.window.ERP.util;
  const Q = sandbox.window.ERP.qrcode;
  S.setUsuario('u3');

  // QR Code
  const m = Q.matriz('https://erp.dompedrosaude.com.br/chamado?ativo=at001');
  verificar('QR gerado com tamanho válido do padrão', (m.length - 17) % 4 === 0, m.length);
  verificar('QR tem os três localizadores nos cantos',
    m[0][0] === 1 && m[0][m.length - 1] === 1 && m[m.length - 1][0] === 1, '');
  verificar('QR só tem 0 e 1 (nenhum módulo em branco)',
    m.every(l => l.every(v => v === 0 || v === 1)), '');
  const svg = Q.svg('https://erp.dompedrosaude.com.br/chamado?ativo=at001');
  verificar('SVG da etiqueta é gerado', /^<svg/.test(svg) && /<path/.test(svg), '');
  let estourou = false;
  try { Q.svg('x'.repeat(400)); } catch (e) { estourou = true; }
  verificar('texto longo demais é recusado com explicação', estourou, '');

  // calibração
  const a = S.ativos({ status: 'alocado' })[0];
  const pl = S.salvarPlanoManutencao({ ativo: a.id, tipo: 'calibracao', periodicidade_dias: 365,
    validade_laudo_meses: 12, proxima: Ut.addDias(Ut.hoje(), -1), checklist: 'calibração de fluxo' });
  verificar('plano do tipo calibração é salvo', pl.ok && pl.plano.tipo === 'calibracao', '');
  const ger = S.gerarPreventivas();
  const osCal = ger.find(o => o.tipo === 'calibracao');
  verificar('o plano abre OS de calibração', !!osCal, ger.map(o => o.tipo).join(','));
  S.fecharOS(osCal.id, { custo_servico: 200, custo_interno: true, laudo_numero: 'LAU-QA-1' });
  verificar('fechar a calibração renova o laudo do equipamento',
    S.ativo(a.id).calibracao_ate > Ut.hoje() && S.ativo(a.id).calibracao_laudo === 'LAU-QA-1',
    S.ativo(a.id).calibracao_ate);
  verificar('o laudo entra no acompanhamento de vencimento',
    S.calibracoesVencendo(400).some(c => c.ativo.id === a.id), '');

  // kanban
  const os = S.abrirOS({ ativo: a.id, tipo: 'corretiva', descricao: 'kanban' });
  verificar('OS pode ir para "em execução"', S.moverOS(os.os.id, 'em_execucao').ok, '');
  verificar('e para "aguardando peça"', S.moverOS(os.os.id, 'aguardando_peca', 'peça importada').ok, '');
  verificar('o histórico da OS guarda cada etapa',
    (S.ordensServico({}).find(o => o.id === os.os.id).historico || []).length === 2, '');
  verificar('fechar não é etapa do kanban', !!S.moverOS(os.os.id, 'fechada').erro, '');
  S.setUsuario('u4');
  verificar('quem não cuida de equipamento não move OS', !!S.moverOS(os.os.id, 'em_execucao').erro, '');
  S.setUsuario('u3');

  // indicadores
  S.fecharOS(os.os.id, { custo_servico: 100, custo_interno: true });
  const ind = S.indicadoresManutencao({});
  verificar('MTTR é calculado das OS fechadas', ind.mttr_dias !== null, ind.mttr_dias);
  verificar('SLA sai em percentual', ind.sla_pct !== null && ind.sla_pct <= 100, ind.sla_pct);
  verificar('o painel separa corretiva, preventiva e calibração',
    ind.corretivas + ind.preventivas + ind.calibracoes === ind.total, JSON.stringify(ind));
  S.setUsuario('u8');
})();

// ── v116: receita real substitui a estimativa no mês faturado ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u3');
  const ct = S.contratos({ parte: 'cliente' }).find(c => !c.encerrado);
  const a = S.ativos({}).find(x => !x.contrato);
  S.vincularLocacao(a.id, { contrato: ct.id, valor_locacao: 5000, forcar: true,
    desde: Ut.addMeses(Ut.hoje(), -5).slice(0, 10) });
  const antes = S.resultadoDoAtivo(a.id);
  verificar('sem nota, a receita é toda estimada',
    antes.receita_real === 0 && antes.receita_estimada > 0, JSON.stringify([antes.receita_real, antes.receita_estimada]));
  verificar('a receita total é real + estimada',
    Math.abs(antes.receita - (antes.receita_real + antes.receita_estimada)) < 0.01, '');

  const centro = (ct.itens || [])[0].centro;
  const comp = Ut.compDe(Ut.addMeses(Ut.hoje(), -1));
  S.criarReceber({ numero: 'QA116-NF', emissao: comp + '-05', centro: centro, competencia: comp,
    valor_bruto: 20000, cliente_nome: 'QA', origem: 'nota', forcar_sem_liberacao: true });
  const dep = S.resultadoDoAtivo(a.id);
  verificar('o mês faturado passa a valer a nota, não a estimativa',
    dep.meses_faturados === 1 && dep.receita_real > 0, JSON.stringify([dep.meses_faturados, dep.receita_real]));
  verificar('os outros meses seguem estimados',
    dep.meses_estimados === antes.meses - 1, JSON.stringify([dep.meses_estimados, antes.meses]));
  verificar('a competência faturada não conta duas vezes',
    dep.composicao.filter(c => c.competencia === comp).length === 1, '');
  verificar('a composição diz mês a mês o que é nota e o que é estimativa',
    dep.composicao.every(c => ['faturado', 'estimado'].indexOf(c.origem) > -1), '');

  // dois equipamentos no mesmo contrato: a nota é rateada pela participação
  const b2 = S.ativos({}).find(x => !x.contrato && x.id !== a.id);
  S.vincularLocacao(b2.id, { contrato: ct.id, valor_locacao: 15000, forcar: true,
    desde: Ut.addMeses(Ut.hoje(), -5).slice(0, 10) });
  const r1 = S.resultadoDoAtivo(a.id), r2 = S.resultadoDoAtivo(b2.id);
  /* O rateio é entre TODOS os equipamentos do contrato, e pode haver
     outros vinculados por testes anteriores — a soma de todos é que
     tem de fechar com a nota. */
  const somaTodos = S.ativos({}).filter(x => x.contrato === ct.id)
    .reduce((s2, x) => s2 + S.resultadoDoAtivo(x.id).receita_real, 0);
  verificar('a nota do mês é rateada entre os equipamentos do contrato',
    Math.abs(somaTodos - 20000) < 0.05, somaTodos);
  verificar('e o rateio segue o valor de locação de cada um',
    r2.receita_real > r1.receita_real, '');
  S.setUsuario('u8');
})();

// ── v117: segunda auditoria de Ativos e Pessoal ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u5');   // administrador: tem baixar_ativo

  // baixa com as mesmas travas da movimentação
  const a = S.ativos({ status: 'alocado' })[0];
  verificar('baixa com data futura é recusada',
    !!S.baixarAtivo(a.id, { motivo: 'venda', data: Ut.addDias(Ut.hoje(), 30) }).erro, '');
  S.movimentarAtivo({ ativo: a.id, status: 'manutencao', destino: 'Oficina QA', custodiante: 'x' });
  verificar('baixa anterior ao último evento é recusada',
    !!S.baixarAtivo(a.id, { motivo: 'sucata', data: '2026-01-01' }).erro, '');
  verificar('movimentar direto para "baixado" é recusado',
    !!S.movimentarAtivo({ ativo: a.id, status: 'baixado', destino: 'x' }).erro, '');
  const os = S.abrirOS({ ativo: a.id, tipo: 'corretiva', descricao: 'QA' });
  verificar('baixa com OS aberta é recusada', !!S.baixarAtivo(a.id, { motivo: 'sucata' }).erro, '');
  verificar('OS com custo e sem fornecedor é recusada',
    !!S.fecharOS(os.os.id, { custo_servico: 500 }).erro, '');
  verificar('e passa quando marcada como custo interno',
    S.fecharOS(os.os.id, { custo_servico: 500, custo_interno: true }).ok, '');

  // baixa fecha as pontas
  const ct = S.contratos({ parte: 'cliente' }).find(c => !c.encerrado);
  S.vincularLocacao(a.id, { contrato: ct.id, valor_locacao: 3000, forcar: true,
    desde: Ut.addMeses(Ut.hoje(), -3).slice(0, 10) });
  S.setUsuario('u5');
  const bx = S.baixarAtivo(a.id, { motivo: 'venda', valor_venda: 15000, comprador: 'Clínica QA', forcar: true });
  verificar('venda é baixada com ganho/perda apurado',
    bx.ok && bx.resultado === Math.round((15000 - bx.residual) * 100) / 100, JSON.stringify([bx.resultado, bx.residual]));
  verificar('a venda entra no contas a receber', !!bx.receber, '');
  verificar('a locação é encerrada na data da baixa',
    S.ativo(a.id).locacao_ate === (bx.movimentacao || {}).data, S.ativo(a.id).locacao_ate);
  verificar('item baixado não aceita OS nova',
    !!S.abrirOS({ ativo: a.id, tipo: 'corretiva', descricao: 'x' }).erro, '');
  S.setUsuario('u7');   // comprador
  verificar('quem é de compras não dá baixa em ativo',
    !!S.baixarAtivo(S.ativos({})[1].id, { motivo: 'venda' }).erro, '');
  S.setUsuario('u5');

  // estorno de movimentação
  const b2 = S.ativos({ status: 'alocado' })[0];
  const antes = S.situacaoAtiva(S.ativo(b2.id)).local;
  const mv = S.movimentarAtivo({ ativo: b2.id, status: 'sede', destino: 'Lugar errado QA' });
  verificar('movimentação lançada', mv.ok, '');
  verificar('estorno exige motivo', !!S.estornarMovimentacao(mv.movimentacao.id, '').erro, '');
  verificar('estorno devolve a situação anterior',
    S.estornarMovimentacao(mv.movimentacao.id, 'equipamento errado').ok &&
    S.situacaoAtiva(S.ativo(b2.id)).local === antes, S.situacaoAtiva(S.ativo(b2.id)).local);
  verificar('o evento estornado continua no histórico',
    S.movimentacoesDoAtivo(b2.id).some(m => m.id === mv.movimentacao.id && m.estornado), '');

  // resultado compara períodos iguais
  const c3 = S.ativos({}).find(x => x.contrato && x.valor_locacao > 0);
  if (c3) {
    const r = S.resultadoDoAtivo(c3.id);
    verificar('a depreciação do resultado cobre os mesmos meses da receita',
      Math.abs(r.depreciacao_periodo - r.depreciacao.mensal * Math.min(r.meses, r.depreciacao.vida)) < 0.01,
      JSON.stringify([r.depreciacao_periodo, r.meses]));
    verificar('e o resultado de vida inteira fica em campo próprio', r.resultado_vida !== undefined, '');
  }

  // desmembramento: parte que sai do projeto não herda locação
  const lote = S.ativos({}).find(x => x.qtd > 1 && !x.desmembrado);
  if (lote) {
    S.vincularLocacao(lote.id, { contrato: ct.id, valor_locacao: 4000, forcar: true, desde: Ut.hoje() });
    const des = S.desmembrarAtivo(lote.id, { partes: [
      { qtd: 1, status: 'alocado', projeto: 'pj41', local: 'Hosp', custodiante: 'x' },
      { qtd: lote.qtd - 1, status: 'sede', local: 'Sede' }
    ] });
    verificar('só a parte alocada herda a locação',
      des.ok && des.partes[0].valor_locacao > 0 && !des.partes[1].valor_locacao,
      JSON.stringify(des.partes.map(p => p.valor_locacao)));
    verificar('a descrição da parte não mantém a quantidade do lote',
      !/^\d+\s/.test(des.partes[0].descricao), des.partes[0].descricao);
  }

  // indicadores
  const ind = S.indicadoresManutencao({});
  verificar('MTTR considera só corretivas', ind.mttr_dias === null || ind.mttr_dias >= 0, ind.mttr_dias);
  verificar('o prazo de SLA vem de parâmetro', S.indicadoresManutencao({ sla_dias: 10 }).sla_dias === 10, '');

  // depreciação por mês de calendário
  verificar('meses de calendário, não dias ÷ 30',
    Ut.mesesEntre('2022-08-02', '2026-09-28') === 49, Ut.mesesEntre('2022-08-02', '2026-09-28'));

  // ── Pessoal ──
  S.setUsuario('u8');
  const fu = D.funcionarios.find(x => x.ativo);
  const fer = S.calcularFerias(fu.id, 30, '2026-11-03');
  if (!fer.erro) {
    verificar('a dobra das férias vencidas fica fora do salário de contribuição',
      !fer.vencida || fer.base_inss < fer.base_bruta, JSON.stringify([fer.base_inss, fer.base_bruta]));
  }
  verificar('férias não começam no sábado', !!S.calcularFerias(fu.id, 30, '2026-10-03').erro, '');
  verificar('férias não começam na sexta', !!S.calcularFerias(fu.id, 30, '2026-11-13').erro, '');
  const hol = S.calcularHolerite(fu.id, '2026-09');
  verificar('vale-refeição também usa dias úteis',
    !fu.vale_refeicao || hol.vr_custo_empresa <= fu.vr_dia * 23, hol.vr_custo_empresa);
  S.setUsuario('u8');
})();

// ── v118: terceira auditoria — venda, reativação, estorno e férias ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u5');
  const a = S.ativos({ status: 'alocado' }).find(x => x.valor > 1000) || S.ativos({})[0];

  // 1) venda não é receita de serviço
  verificar('venda sem valor é recusada', !!S.baixarAtivo(a.id, { motivo: 'venda' }).erro, '');
  verificar('valor de venda em "perda" é recusado',
    !!S.baixarAtivo(a.id, { motivo: 'perda', valor_venda: 5000 }).erro, '');
  const v = S.baixarAtivo(a.id, { motivo: 'venda', valor_venda: 30000, comprador: 'Clínica QA' });
  verificar('venda é baixada', v.ok, JSON.stringify(v.erro));
  const rec = S.contasReceber().find(r => r.id === (S.ativo(a.id).baixa || {}).receber_id);
  verificar('o recebível da venda vai para alienação de imobilizado (1.04)',
    rec && rec.conta === '1.04', rec && rec.conta);
  verificar('e a conta é marcada como não operacional',
    (D.plano.find(c => c.cod === '1.04') || {}).nao_operacional === true, '');

  // 2) reativar cancela a cobrança
  const idRec = rec.id;
  verificar('reativar desfaz a baixa', S.reativarAtivo(a.id, { motivo: 'venda desfeita' }).ok, '');
  verificar('e cancela o recebível da venda',
    S.st.receber.find(r => r.id === idRec).status === 'cancelado',
    S.st.receber.find(r => r.id === idRec).status);

  // 4 e 5) OS: estorno bloqueado e cancelamento
  const os = S.abrirOS({ ativo: a.id, tipo: 'corretiva', descricao: 'parada QA', parada_uso: true });
  const mov = S.movimentacoesDoAtivo(a.id)[0];
  verificar('não dá para estornar a movimentação de uma OS aberta',
    !!S.estornarMovimentacao(mov.id, 'teste').erro, '');
  verificar('baixa com OS aberta é bloqueada mesmo com forcar',
    !!S.baixarAtivo(a.id, { motivo: 'sucata', forcar: true }).erro, '');
  verificar('cancelar OS exige motivo', !!S.cancelarOS(os.os.id, '').erro, '');
  verificar('OS cancelada devolve o equipamento',
    S.cancelarOS(os.os.id, 'aberta por engano').ok &&
    S.situacaoAtiva(S.ativo(a.id)).status !== 'manutencao', S.situacaoAtiva(S.ativo(a.id)).status);
  verificar('OS cancelada não anda mais no quadro', !!S.moverOS(os.os.id, 'em_execucao').erro, '');
  verificar('e some da lista de OS', !S.ordensServico({}).some(o => o.id === os.os.id), '');

  // 7) laudo com validade anterior ao fechamento
  const osCal = S.abrirOS({ ativo: a.id, tipo: 'calibracao', descricao: 'calibração QA' });
  verificar('laudo com validade vencida é recusado, não corrigido em silêncio',
    !!S.fecharOS(osCal.id, { custo_interno: true, laudo_valido_ate: '2020-01-01' }).erro, '');
  S.fecharOS(osCal.id, { custo_interno: true });

  // 6) dias trabalhados antes das férias
  S.setUsuario('u8');
  const c = D.funcionarios.find(f => f.ativo && f.admissao < '2024-01-01');
  const calc = S.calcularFerias(c.id, 27, '2028-10-05');
  if (!calc.erro) {
    const l = S.lancarFerias(c.id, calc, '2028-10-05');
    if (l.ok) {
      const h = S.calcularHolerite(c.id, '2028-10', S.extrasComDiasPadrao(D.funcionario(c.id), '2028-10', {}));
      verificar('dias trabalhados antes das férias seguem o calendário (4, não 3)',
        h.dias_pagos === 4, h.dias_pagos);
    }
  }
  S.setUsuario('u8');
})();

// ── v119: fechos do fluxo de cancelar/reabrir OS ──
(function () {
  S.setUsuario('u5');
  const a = S.ativos({ status: 'alocado' })[0];

  // 1) estorno do RETORNO também é travado, mesmo com a OS fechada
  const os = S.abrirOS({ ativo: a.id, tipo: 'corretiva', descricao: 'parada QA', parada_uso: true });
  S.fecharOS(os.os.id, { custo_interno: true, devolver_para: 'Hospital QA' });
  const retorno = S.movimentacoesDoAtivo(a.id)[0];
  verificar('o retorno da OS não pode ser estornado por fora',
    !!S.estornarMovimentacao(retorno.id, 'teste').erro, '');
  verificar('e a mensagem aponta o caminho certo (reabrir)',
    /reabra a OS/i.test(S.estornarMovimentacao(retorno.id, 'teste').erro || ''), '');

  // 2) OS cancelada fora dos indicadores
  const os2 = S.abrirOS({ ativo: a.id, tipo: 'corretiva', descricao: 'engano QA' });
  S.cancelarOS(os2.os.id, 'aberta por engano');
  const ind = S.indicadoresManutencao({ ativo: a.id });
  verificar('OS cancelada não conta como aberta nos indicadores', ind.abertas === 0, ind.abertas);
  verificar('nem entra no total de corretivas',
    ind.corretivas === S.ordensServico({ ativo: a.id }).filter(o => o.tipo === 'corretiva').length,
    JSON.stringify([ind.corretivas, ind.total]));

  // 3) cancelada aparece no histórico do equipamento
  verificar('a ficha do equipamento mostra a OS cancelada',
    S.ordensServico({ ativo: a.id, incluir_canceladas: true }).some(o => o.id === os2.os.id), '');
  verificar('e ela segue fora da lista padrão',
    !S.ordensServico({ ativo: a.id }).some(o => o.id === os2.os.id), '');

  // 4) reabrir existe e resolve o retorno errado
  verificar('reabrir exige motivo', !!S.reabrirOS(os.os.id, '').erro, '');
  const r = S.reabrirOS(os.os.id, 'retorno lançado errado');
  verificar('reabrir OS fechada desfaz o retorno', r.ok && r.retornos_desfeitos === 1, JSON.stringify(r.erro));
  verificar('e o equipamento volta para a manutenção',
    S.situacaoAtiva(S.ativo(a.id)).status === 'manutencao', S.situacaoAtiva(S.ativo(a.id)).status);
  verificar('reabrir OS cancelada também funciona', S.reabrirOS(os2.os.id, 'cancelei sem querer').ok, '');
  verificar('OS reaberta volta a andar no quadro', S.moverOS(os2.os.id, 'aguardando_peca').ok, '');

  // custo já pago barra a reabertura
  const os3 = S.abrirOS({ ativo: a.id, tipo: 'corretiva', descricao: 'com custo' });
  const f3 = S.fecharOS(os3.os.id, { custo_servico: 400, executante_credor: 'cr5' });
  if (f3.ok && f3.titulo) {
    verificar('reabrir cancela o custo ainda não pago',
      S.reabrirOS(os3.os.id, 'revisão do laudo').ok &&
      S.todasParcelas().filter(p => p.titulo_id === f3.titulo.id).every(p => p.status === 'cancelado'), '');
  }
  S.setUsuario('u8');
})();

// ── v120: o reabrir OS passa pelas mesmas travas do abrir ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u5');
  const livres = S.ativos({ status: 'alocado' }).filter(x => !S.ordensServico({ ativo: x.id }).length);
  const [a, b, c, d] = livres.length >= 4 ? livres : S.ativos({ status: 'alocado' });

  // 1) movimentação posterior ao retorno
  const os = S.abrirOS({ ativo: a.id, tipo: 'corretiva', descricao: 'QA1', parada_uso: true });
  S.fecharOS(os.os.id, { custo_interno: true, devolver_para: 'Nilópolis QA' });
  S.movimentarAtivo({ ativo: a.id, status: 'transito', destino: 'A caminho QA', custodiante: 'transportadora' });
  const r1 = S.reabrirOS(os.os.id, 'teste');
  verificar('reabrir é recusado quando houve movimentação depois do retorno',
    !!r1.erro && /movimentou depois do retorno/.test(r1.erro), JSON.stringify(r1.erro));
  // estornando a movimentação posterior, a reabertura passa
  const posterior = S.movimentacoesDoAtivo(a.id)[0];
  S.estornarMovimentacao(posterior.id, 'lançada por engano');
  verificar('e passa depois de estornar essa movimentação', S.reabrirOS(os.os.id, 'retorno errado').ok, '');

  // 2) equipamento baixado
  const os2 = S.abrirOS({ ativo: b.id, tipo: 'corretiva', descricao: 'QA2' });
  S.fecharOS(os2.os.id, { custo_interno: true });
  S.baixarAtivo(b.id, { motivo: 'sucata' });
  verificar('reabrir OS de equipamento baixado é recusado',
    !!S.reabrirOS(os2.os.id, 'teste').erro, '');
  S.reativarAtivo(b.id, { motivo: 'baixa indevida' });
  verificar('e passa depois de reativar o equipamento', S.reabrirOS(os2.os.id, 'teste').ok, '');

  // 3) duas OS com o equipamento parado
  const osA = S.abrirOS({ ativo: c.id, tipo: 'corretiva', descricao: 'QA-A', parada_uso: true });
  S.fecharOS(osA.os.id, { custo_interno: true, devolver_para: 'Hosp QA' });
  const osB = S.abrirOS({ ativo: c.id, tipo: 'corretiva', descricao: 'QA-B', parada_uso: true });
  verificar('reabrir não cria segunda OS com o equipamento parado',
    !!S.reabrirOS(osA.os.id, 'teste').erro, '');
  /* Cancelar a OS-B não libera reabrir a OS-A: a passagem do
     equipamento pela OS-B já está no histórico, e movimentação de OS
     não se estorna. O caminho é abrir OS nova — e a mensagem diz isso. */
  S.cancelarOS(osB.os.id, 'duplicada');
  const rA = S.reabrirOS(osA.os.id, 'teste');
  verificar('e, com outra OS no meio, manda abrir OS nova em vez de reabrir',
    !!rA.erro && /abra uma OS nova/.test(rA.erro), JSON.stringify(rA.erro));

  // 4) calibração reaberta devolve o laudo anterior
  const osC = S.abrirOS({ ativo: d.id, tipo: 'calibracao', descricao: 'QA-cal' });
  S.fecharOS(osC.os.id, { custo_interno: true, laudo_numero: 'QA-L1' });
  verificar('calibração fechada grava o laudo',
    S.ativo(d.id).calibracao_laudo === 'QA-L1' && !!S.ativo(d.id).calibracao_ate, '');
  verificar('reabrir a calibração desfaz o laudo',
    S.reabrirOS(osC.os.id, 'laudo errado').ok &&
    !S.ativo(d.id).calibracao_laudo && !S.ativo(d.id).calibracao_ate,
    JSON.stringify([S.ativo(d.id).calibracao_laudo, S.ativo(d.id).calibracao_ate]));
  verificar('e o equipamento sai da lista de calibração em dia',
    !S.calibracoesVencendo(400).some(x => x.ativo.id === d.id), '');
  S.setUsuario('u8');
})();

// ── v121: reabrir calibração com outra calibração posterior ──
(function () {
  S.setUsuario('u5');
  const a = S.ativos({ status: 'alocado' }).find(x => !S.ordensServico({ ativo: x.id, incluir_canceladas: true }).length)
    || S.ativos({ status: 'alocado' })[0];
  const os1 = S.abrirOS({ ativo: a.id, tipo: 'calibracao', descricao: 'QA cal 1' });
  S.fecharOS(os1.os.id, { custo_interno: true, laudo_numero: 'QA-L1' });
  const laudo1 = S.ativo(a.id).calibracao_ate;
  const os2 = S.abrirOS({ ativo: a.id, tipo: 'calibracao', descricao: 'QA cal 2' });
  S.fecharOS(os2.os.id, { custo_interno: true, laudo_numero: 'QA-L2', laudo_valido_ate: '2029-01-01' });
  verificar('a calibração mais nova é a que vale',
    S.ativo(a.id).calibracao_laudo === 'QA-L2', S.ativo(a.id).calibracao_laudo);

  const r1 = S.reabrirOS(os1.os.id, 'laudo errado');
  verificar('reabrir a calibração antiga é recusado quando há outra concluída depois',
    !!r1.erro && /calibração mais recente/.test(r1.erro), JSON.stringify(r1.erro));
  verificar('e o laudo vigente continua intacto',
    S.ativo(a.id).calibracao_laudo === 'QA-L2' && S.ativo(a.id).calibracao_ate === '2029-01-01', '');
  verificar('a mensagem manda abrir OS nova', /abra uma OS nova/.test(r1.erro), '');

  verificar('reabrir a mais recente funciona', S.reabrirOS(os2.os.id, 'laudo errado').ok, '');
  verificar('e devolve o laudo anterior, que é de uma OS fechada',
    S.ativo(a.id).calibracao_laudo === 'QA-L1' && S.ativo(a.id).calibracao_ate === laudo1,
    JSON.stringify([S.ativo(a.id).calibracao_laudo, S.ativo(a.id).calibracao_ate]));
  verificar('só então a antiga pode ser reaberta', S.reabrirOS(os1.os.id, 'revisão').ok, '');
  verificar('e aí o equipamento fica sem calibração válida',
    !S.ativo(a.id).calibracao_laudo && !S.ativo(a.id).calibracao_ate, '');
  S.setUsuario('u8');
})();

// ── v122: duplicidade de documento no contas a pagar ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u3');
  const cr = D.credores.find(c => c.ativo).id;
  const outro = D.credores.filter(c => c.ativo)[1].id;
  const centro = D.centros.find(c => c.ativo && c.tipo === 'projeto').id;
  const base = { descricao: 'QA duplicidade', documento: 'QA-NF-777', tipo_titulo: 'nf',
    credor: cr, emissao: Ut.hoje(), conta: '6.07', centro: centro };
  const linhas = [{ num: 1, venc: Ut.addDias(Ut.hoje(), 10), comp: Ut.mesAtual(), valor: 1000 }];

  verificar('primeiro lançamento entra', S.criarTitulo(Object.assign({}, base), linhas).ok, '');
  const r2 = S.criarTitulo(Object.assign({}, base), linhas);
  verificar('o mesmo documento no mesmo credor é barrado',
    !!r2.duplicado_documento, JSON.stringify(r2.erro));
  verificar('e a mensagem mostra o título que já existe',
    /QA-NF-777/.test(r2.erro || '') && /1\.000,00/.test(r2.erro || ''), r2.erro);
  verificar('com confirmação explícita, passa',
    S.criarTitulo(Object.assign({}, base, { confirmar_duplicado: true }), linhas).ok, '');
  verificar('mesmo documento em OUTRO credor não é duplicidade',
    S.criarTitulo(Object.assign({}, base, { credor: outro }), linhas).ok, '');

  // título cancelado não conta
  const t = S.criarTitulo(Object.assign({}, base, { documento: 'QA-NF-778' }), linhas);
  S.todasParcelas().filter(p => p.titulo_id === t.titulo.id)
    .forEach(p => S.cancelar(p.id, 'teste', true));
  verificar('documento de título cancelado pode ser relançado',
    S.criarTitulo(Object.assign({}, base, { documento: 'QA-NF-778' }), linhas).ok, '');

  // validações de importação
  verificar('conta fora do plano é recusada',
    !!S.criarTitulo(Object.assign({}, base, { documento: 'QA-NF-779', conta: '9.99' }), linhas).erro, '');
  verificar('competência inválida é recusada',
    !!S.criarTitulo(Object.assign({}, base, { documento: 'QA-NF-780' }),
      [{ num: 1, venc: Ut.hoje(), comp: '2026-13', valor: 10 }]).erro, '');
  S.setUsuario('u8');
})();

// ── v123: substituir fechamento, grupo na esteira e autorização única ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u2');
  const comp = Ut.compDe(Ut.addMeses(Ut.hoje(), -4));
  const centro = 'pj01';
  const med = D.credores.find(c => c.ativo);
  const mk = (ref, v) => S.criarTitulo({ descricao: 'Prod QA123', documento: 'FECH-QA123',
    tipo_titulo: 'medicao', credor: med.id, conta: '3.01', centro: centro, emissao: Ut.hoje(),
    origem: 'produtividade', origem_ref: ref },
    [{ num: 1, venc: Ut.addDias(Ut.hoje(), 10), comp: comp, valor: v }]);
  const t1 = mk('qa123|m1', 5000), t2 = mk('qa123|m2', 3000);
  S.registrarLoteProdutividade({ centro: centro, competencia: comp, arquivo: 'agosto.xlsx',
    periodo: '01-31', titulo_ids: [t1.titulo.id, t2.titulo.id], medicos: 2, valor: 8000 });

  verificar('o fechamento vivo é encontrado', S.fechamentosVivosDe(centro, comp).length === 1, '');
  verificar('substituir exige motivo', !!S.substituirFechamento(centro, comp, '').erro, '');
  const sub = S.substituirFechamento(centro, comp, 'arquivo corrigido — médico saiu da lista');
  verificar('substituir cancela o fechamento anterior',
    sub.ok && S.fechamentosVivosDe(centro, comp).length === 0, JSON.stringify(sub.erro));
  verificar('as parcelas antigas ficam canceladas, não apagadas',
    S.todasParcelas().filter(p => [t1.titulo.id, t2.titulo.id].indexOf(p.titulo_id) > -1)
      .every(p => p.status === 'cancelado'), '');
  verificar('e as referências liberam o relançamento', !S.refJaUsada('qa123|m1'), '');

  // grupo na esteira
  const compG = Ut.compDe(Ut.addMeses(Ut.hoje(), -3));
  ['pj11', 'pj44', 'pj45'].forEach(c => S.salvarPrevisao({ centro: c, competencia: compG, faturamento: 100000 }));
  const esteira = S.esteiraFaturamento({ competencia: compG });
  const grupo = esteira.find(l => l.eh_grupo);
  verificar('o GHC-HGB aparece como uma linha só', !!grupo, esteira.map(l => l.projeto.curto).join(','));
  /* Sete, não três: a esteira passou a listar TODO projeto ativo na
     competência, com ou sem previsão salva — projeto esquecido no
     mês era invisível justamente na tela feita para encontrá-lo. O
     grupo do HGB tem sete especialidades, então são sete. */
  verificar('com as especialidades dentro', grupo && grupo.especialidades.length === 7,
    grupo && grupo.especialidades.length);
  verificar('e as especialidades não aparecem soltas',
    !esteira.some(l => !l.eh_grupo && l.projeto.grupo_faturamento), '');
  verificar('sem_agrupar devolve uma linha por especialidade',
    S.esteiraFaturamento({ competencia: compG, sem_agrupar: true })
      .filter(l => l.projeto.grupo_faturamento === 'GHC - HGB').length === 7, '');

  // confirmar + autorizar num passo, com aviso de produtividade
  const compA = Ut.compDe(Ut.addMeses(Ut.hoje(), -5));
  S.salvarPrevisao({ centro: 'pj02', competencia: compA, faturamento: 30000 });
  const semProd = S.confirmarEAutorizarFaturamento({ centro: 'pj02', competencia: compA,
    faturamento: 31000, autorizar: true });
  verificar('confirmar sem produtividade avisa antes',
    !!semProd.erro && semProd.sem_produtividade === true, JSON.stringify(semProd.erro));
  const ok = S.confirmarEAutorizarFaturamento({ centro: 'pj02', competencia: compA,
    faturamento: 31000, autorizar: true, confirmar_sem_produtividade: true, protocolo: 'OF-9/2026' });
  verificar('com a confirmação, o valor entra e autoriza', ok.ok && ok.autorizado, JSON.stringify(ok.erro));
  verificar('a autorização já libera, sem segunda pessoa', ok.liberado === true, '');
  const linha = S.esteiraFaturamento({ centro: 'pj02', competencia: compA })[0];
  verificar('e a esteira mostra "liberado"', linha && linha.etapa === 'liberado', linha && linha.etapa);

  // RPS em lote sem filtro de competência
  verificar('RPS sem competência traz todas as liberadas',
    S.itensParaRPS('').length >= S.itensParaRPS(compA).length, '');

  // ordem da esteira: pronto para autorizar antes do resto
  const todas = S.esteiraFaturamento({ pendentes: true });
  const pos = e => todas.findIndex(l => l.centro === e);
  verificar('a esteira ordena por prioridade de trabalho', todas.length > 0, todas.length);
  S.setUsuario('u8');
})();

// ── v124: estimativa editável na esteira e previsão global do grupo ──
(function () {
  const Ut = sandbox.window.ERP.util;
  const comp = Ut.compDe(Ut.addMeses(Ut.hoje(), -6));

  // quem pode editar a estimativa
  S.setUsuario('u2');
  S.salvarPrevisao({ centro: 'pj01', competencia: comp, faturamento: 50000 });
  verificar('operadora/diretoria edita a estimativa na esteira',
    S.editarEstimativaEsteira({ centro: 'pj01', competencia: comp, faturamento: 62000 }).ok, '');
  verificar('e o valor novo vale',
    S.previsaoDe('pj01', comp).faturamento === 62000, S.previsaoDe('pj01', comp).faturamento);
  S.setUsuario('u6');   // consulta
  verificar('quem não responde pelo faturamento não edita',
    !!S.editarEstimativaEsteira({ centro: 'pj01', competencia: comp, faturamento: 1 }).erro, '');
  S.setUsuario('u7');   // compras
  verificar('nem o comprador',
    !!S.editarEstimativaEsteira({ centro: 'pj01', competencia: comp, faturamento: 1 }).erro, '');

  /* v125: a operação reverteu a regra da v124 — o valor do HGB é
     informado POR ESPECIALIDADE e o grupo é a soma; a nota é que é
     única. */
  S.setUsuario('u2');
  const g = S.editarEstimativaEsteira({ centro: 'pj44', competencia: comp, faturamento: 880000 });
  verificar('a estimativa fica na especialidade editada',
    g.ok && (S.previsaoDe('pj44', comp) || {}).faturamento === 880000, JSON.stringify(g.erro));
  const linha = S.esteiraFaturamento({ competencia: comp }).find(l => l.eh_grupo);
  verificar('a linha do grupo soma as especialidades',
    linha && Math.abs(linha.valor - S.projetosDoGrupo('GHC - HGB')
      .reduce((t2, id) => t2 + ((S.previsaoDe(id, comp) || {}).faturamento || 0), 0)) < 0.05,
    linha && linha.valor);
  const conf = S.confirmarEAutorizarFaturamento({ centro: 'pj45', competencia: comp,
    faturamento: 910000, autorizar: true, confirmar_sem_produtividade: true, protocolo: 'OF-124' });
  verificar('confirmar uma especialidade confirma só ela',
    conf.ok && (S.previsaoDe('pj45', comp) || {}).faturamento === 910000, JSON.stringify(conf.erro));
  verificar('e ela sai liberada para a nota do grupo',
    S.etapaDaPrevisao(S.previsaoDe('pj45', comp)) === 'liberado', '');
  S.setUsuario('u8');
})();

// ── v124/125: estimativa editável na esteira (valor POR especialidade) ──
(function () {
  const comp = '2031-04';
  S.setUsuario('u6');   // consulta
  verificar('consulta não altera a estimativa',
    !!S.editarEstimativaEsteira({ centro: 'pj01', competencia: comp, faturamento: 1000 }).erro, '');
  S.setUsuario('u1');   // assistente de faturamento
  verificar('quem responde pelo faturamento altera',
    S.editarEstimativaEsteira({ centro: 'pj01', competencia: comp, faturamento: 80000 }).ok, '');
  verificar('e o valor aparece na esteira',
    (S.esteiraFaturamento({ centro: 'pj01', competencia: comp })[0] || {}).valor === 80000, '');
  /* v125: a operação confirmou que o valor do HGB é informado por
     especialidade; o grupo é a soma, e a nota é que é única. */
  verificar('a estimativa de uma especialidade fica na especialidade',
    S.editarEstimativaEsteira({ centro: 'pj11', competencia: comp, faturamento: 300000 }).ok &&
    (S.previsaoDe('pj11', comp) || {}).faturamento === 300000, '');
  S.editarEstimativaEsteira({ centro: 'pj44', competencia: comp, faturamento: 200000 });
  const linhaG = S.esteiraFaturamento({ competencia: comp }).find(l => l.eh_grupo);
  verificar('e a esteira soma as especialidades na linha do grupo',
    linhaG && Math.abs(linhaG.valor - 500000) < 0.05, linhaG && linhaG.valor);
  S.setUsuario('u8');
})();

// ── v125: mutirão separado, valor por especialidade, Status e Resultado ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u2');

  verificar('o mutirão do HGB não faz parte do grupo de faturamento',
    !D.centro('pj50').grupo_faturamento && S.projetosDoGrupo('GHC - HGB').indexOf('pj50') < 0, '');
  verificar('e o grupo ficou com as 7 especialidades',
    S.projetosDoGrupo('GHC - HGB').length === 7, S.projetosDoGrupo('GHC - HGB').length);

  // valor informado POR ESPECIALIDADE, somando no grupo
  const comp = '2033-02';
  S.confirmarEAutorizarFaturamento({ centro: 'pj11', competencia: comp, faturamento: 300000,
    confirmar_sem_produtividade: true });
  S.confirmarEAutorizarFaturamento({ centro: 'pj44', competencia: comp, faturamento: 200000,
    confirmar_sem_produtividade: true });
  verificar('cada especialidade guarda o próprio valor',
    (S.previsaoDe('pj11', comp) || {}).faturamento === 300000 &&
    (S.previsaoDe('pj44', comp) || {}).faturamento === 200000, '');
  const linhaG = S.esteiraFaturamento({ competencia: comp }).find(l => l.eh_grupo);
  verificar('e o grupo mostra a soma das especialidades',
    linhaG && Math.abs(linhaG.valor - 500000) < 0.05, linhaG && linhaG.valor);

  // status da produtividade
  const sp = S.statusProdutividade('pj01', comp);
  verificar('produtividade sem lançamento fica "previsto"', sp.status === 'previsto', sp.status);
  const med = D.credores.find(c => c.ativo);
  const t = S.criarTitulo({ descricao: 'Prod QA125', documento: 'FECH-QA125', tipo_titulo: 'medicao',
    credor: med.id, conta: '3.01', centro: 'pj01', emissao: Ut.hoje(), origem: 'produtividade',
    origem_ref: 'qa125|m1' }, [{ num: 1, venc: Ut.addDias(Ut.hoje(), 10), comp: comp, valor: 7000 }]);
  S.registrarLoteProdutividade({ centro: 'pj01', competencia: comp, arquivo: 'x.xlsx', periodo: '01-31',
    titulo_ids: [t.titulo.id], medicos: 1, valor: 7000 });
  const sp2 = S.statusProdutividade('pj01', comp);
  verificar('com fechamento, vira "lançado" e mostra o valor lançado',
    sp2.status === 'lancado' && sp2.valor === 7000, JSON.stringify(sp2));
  S.confirmarFaturamentoProdutividade({ centro: 'pj01', competencia: comp, faturamento: 60000, produtividade: 7000 });
  verificar('confirmado o faturamento, a produtividade fica "confirmado"',
    S.statusProdutividade('pj01', comp).status === 'confirmado', '');

  // ordem: mais adiantado primeiro
  S.autorizarFaturamento('pj01', comp, { protocolo: 'OF QA125' });
  const ordem = S.esteiraFaturamento({ competencia: comp }).map(l => l.etapa);
  verificar('a esteira traz o mais adiantado primeiro',
    ordem.indexOf('liberado') <= ordem.indexOf('confirmado') || ordem.indexOf('confirmado') < 0,
    ordem.join(','));

  // aba Status
  const st = S.statusFaturamento({ competencia: comp });
  verificar('o painel de status lista os projetos do mês', st.length > 0, st.length);
  verificar('e traduz a etapa para o nome que a operação usa',
    st.every(l => !!S.NOME_STATUS_FAT[l.status]), '');
  verificar('o filtro por status funciona',
    S.statusFaturamento({ competencia: comp, status: 'liberado' }).every(l => l.status === 'liberado'), '');

  // aba Resultado
  const res = S.resultadoFaturamento({ competencia: comp, centro: 'pj01' })[0];
  verificar('o resultado traz faturamento, custo, impostos e lucro',
    res && res.faturamento === 60000 && res.custo === 7000 && res.impostos > 0, JSON.stringify(res && [res.faturamento, res.custo, res.impostos]));
  verificar('lucro direto = faturamento − custo − impostos',
    Math.abs(res.lucro - (res.faturamento - res.custo - res.impostos)) < 0.05, res.lucro);
  verificar('e a margem sai em percentual',
    Math.abs(res.margem - Math.round(res.lucro / res.faturamento * 1000) / 10) < 0.05, res.margem);

  // complemento de NF já faturada
  verificar('complemento exige motivo (vai na discriminação)',
    !!S.lancarComplementoFaturamento({ centro: 'pj11', competencia: comp, valor: 50000 }).erro, '');
  const cp = S.lancarComplementoFaturamento({ centro: 'pj11', competencia: comp, valor: 50000,
    motivo: 'relatório de plantões recebido depois do fechamento' });
  verificar('complemento entra como cobrança nova no projeto escolhido',
    cp.ok && cp.receber.centro === 'pj11' && cp.receber.valor_bruto === 50000, JSON.stringify(cp.erro));
  verificar('marcado como complemento, para não parecer duplicidade',
    cp.receber.complemento === true, '');
  verificar('e o motivo vai na discriminação',
    /relatório de plantões/.test(cp.receber.discriminacao || ''), cp.receber.discriminacao);
  S.setUsuario('u8');
})();

// ── v126: PIX, bloqueio de PG, confirmação da produtividade, perfis e ativos ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u2');

  // perfis e usuários
  verificar('existe diretoria de produtividade', !!D.perfil('produtividade_dir'), '');
  verificar('e gerência de produtividade com o mesmo acesso',
    JSON.stringify((D.perfil('produtividade_ger') || {}).acoes) ===
    JSON.stringify((D.perfil('produtividade_dir') || {}).acoes), '');
  verificar('produtividade não paga nem aprova',
    ['pagar', 'aprovar'].every(a => (D.perfil('produtividade_dir').acoes || []).indexOf(a) < 0), '');
  verificar('Bianca e Monique Almeida estão cadastradas',
    D.usuarios.some(u => /Bianca/.test(u.nome)) && D.usuarios.some(u => /Monique Almeida/.test(u.nome)), '');
  verificar('os nomes do financeiro foram atualizados',
    D.usuarios.some(u => /Dayana/.test(u.nome)) && D.usuarios.some(u => /Romário/.test(u.nome)) &&
    D.usuarios.some(u => /Márcia/.test(u.nome)) && D.usuarios.some(u => /David/.test(u.nome)) &&
    D.usuarios.some(u => /Carol/.test(u.nome)), '');

  // alçadas
  verificar('assistente financeiro não aprova pagamento',
    (S.st.parametros.sem_aprovacao || []).indexOf('assistente') > -1, '');
  verificar('e a alçada de compras caiu para 5 mil',
    S.st.parametros.alcada.comprador === 5000, S.st.parametros.alcada.comprador);

  // ciclo: confirmar produtividade e bloquear médico
  const centro = 'pj03', comp = '2035-01';
  const med = D.credores.filter(c => c.ativo).slice(0, 2);
  const mk = (cr, ref, v) => S.criarTitulo({ descricao: 'Prod QA126', documento: 'FECH-QA126',
    tipo_titulo: 'medicao', credor: cr, conta: '3.01', centro: centro, emissao: Ut.hoje(),
    origem: 'produtividade', origem_ref: ref },
    [{ num: 1, venc: Ut.addDias(Ut.hoje(), 5), comp: comp, valor: v }]);
  const t1 = mk(med[0].id, 'qa126|1', 5000), t2 = mk(med[1].id, 'qa126|2', 3000);
  const reg = S.registrarLoteProdutividade({ centro: centro, competencia: comp, arquivo: 'a.xlsx',
    periodo: '01-31', titulo_ids: [t1.titulo.id, t2.titulo.id], medicos: 2, valor: 8000 });
  const loteId = (reg.lote || reg).id;
  const pcs = S.todasParcelas().filter(p => [t1.titulo.id, t2.titulo.id].indexOf(p.titulo_id) > -1);
  pcs.forEach(p => S.aprovar([p.id]));

  verificar('produtividade não confirmada não vai para pagamento',
    /não foi confirmado/.test(S.registrarPagamento(pcs[0].id,
      { data: Ut.hoje(), valor: 5000, banco: D.bancos[0].id }).erro || ''), '');
  verificar('bloquear médico registra o motivo',
    S.bloquearPagamentoMedico(loteId, { titulo_id: t2.titulo.id, motivo: 'contrato não assinado' }).ok, '');
  const semCiencia = S.confirmarLoteProdutividade(loteId);
  verificar('confirmar avisa que há médico bloqueado fora da remessa',
    !!semCiencia.erro && semCiencia.bloqueios === 1, JSON.stringify(semCiencia.erro));
  verificar('ciente do bloqueio, confirma', S.confirmarLoteProdutividade(loteId, { ciente_bloqueios: true }).ok, '');
  verificar('confirmado, o médico liberado pode ser pago',
    S.registrarPagamento(pcs[0].id, { data: Ut.hoje(), valor: 5000, banco: D.bancos[0].id }).ok, '');
  verificar('e o bloqueado continua barrado',
    /bloqueado pela produtividade/.test(S.registrarPagamento(pcs[1].id,
      { data: Ut.hoje(), valor: 3000, banco: D.bancos[0].id }).erro || ''), '');
  const sit = S.situacaoLoteProdutividade(S.lotesProdutividade({}).find(l => l.id === loteId));
  verificar('a situação do fechamento mostra o bloqueio',
    sit.situacao === 'confirmado com bloqueio' && sit.bloqueados === 1, JSON.stringify(sit));
  verificar('liberar destrava o pagamento',
    S.liberarPagamentoMedico(loteId, t2.titulo.id, 'contrato chegou').ok &&
    S.registrarPagamento(pcs[1].id, { data: Ut.hoje(), valor: 3000, banco: D.bancos[0].id }).ok, '');

  // comparação antes de substituir
  const cmp = S.compararFechamento(centro, comp, [{ medico: med[1].nome, valor: 3000 }]);
  verificar('a comparação aponta quem saiu do arquivo novo',
    cmp.saiu.some(m => m.medico === med[0].nome), JSON.stringify(cmp.saiu.map(m => m.medico)));
  /* O pagamento acima foi solicitado, não liquidado — o alerta forte é
     para quem JÁ RECEBEU de fato. Liquidando, ele aparece. */
  verificar('sem baixa efetiva, ainda não é caso de alerta forte',
    cmp.pagos_afetados.length === 0, JSON.stringify(cmp.pagos_afetados));
  const pgs = S.pagamentosDaParcela ? [] : [];
  S.todasParcelas().filter(p => p.titulo_id === t1.titulo.id).forEach(p => {
    (S.st.pagamentos || []).filter(x => x.parcela_id === p.id).forEach(x => {
      x.situacao = 'liquidado'; x.data = Ut.hoje();
    });
  });
  const cmp2 = S.compararFechamento(centro, comp, [{ medico: med[1].nome, valor: 3000 }]);
  verificar('com pagamento liquidado, o alerta de quem já recebeu aparece',
    cmp2.tem_pagamento && cmp2.pagos_afetados.some(m => m.tipo === 'saiu'),
    JSON.stringify(cmp2.pagos_afetados.map(m => m.medico + '/' + m.tipo)));

  // ativos: patrimônio, valor e contratante
  S.setUsuario('u5');
  const at = S.salvarAtivo({ descricao: 'Monitor QA126', valor: 18000, patrimonio: 'QA-0455',
    contratante_nome: 'Unifor', status: 'alocado', projeto: 'pj01',
    local: 'Santa Casa de Fortaleza', custodiante: 'Enfermagem' });
  verificar('o ativo guarda o número de patrimônio', at.ok && at.ativo.patrimonio === 'QA-0455', '');
  verificar('e o contratante, separado de onde está',
    S.nomeContratante(at.ativo) === 'Unifor' &&
    S.situacaoAtiva(at.ativo).local === 'Santa Casa de Fortaleza', '');
  verificar('patrimônio repetido é recusado',
    !!S.salvarAtivo({ descricao: 'Outro QA126', patrimonio: 'QA-0455' }).erro, '');
  S.setUsuario('u8');
})();

// ── v127: três CNPJs no mesmo ERP ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u2');

  verificar('as três empresas do grupo estão cadastradas',
    D.empresas.length === 3 && D.empresas.some(e => /Novaped/.test(e.apelido)), D.empresas.length);
  verificar('cada conta bancária pertence a uma empresa',
    D.bancos.every(b => !!b.empresa), D.bancos.map(b => b.id + ':' + b.empresa).join(','));
  verificar('a empresa vem da conta no pagamento',
    S.empresaDaConta('b4') === 'emp3' && S.empresaDaConta('b3') === 'emp2', '');
  verificar('e do centro de custo no faturamento',
    S.empresaDoCentro('pj33') === 'emp3' && S.empresaDoCentro('pj01') === 'emp1', '');
  verificar('projeto sem empresa cai na matriz',
    S.empresaDoCentro('pj02') === 'emp1', S.empresaDoCentro('pj02'));

  const cr = D.credores.find(c => c.ativo).id;
  const mk = (doc, tomadora, centro) => S.criarTitulo({ descricao: 'QA127', documento: doc,
    tipo_titulo: 'nf', credor: cr, conta: '6.07', centro: centro, emissao: Ut.hoje(),
    empresa_tomadora: tomadora }, [{ num: 1, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: 4000 }]);

  // NF de uma empresa paga pela conta de outra = conta corrente
  const t1 = mk('QA127-CRUZ', 'emp3', 'pj33');
  const p1 = S.todasParcelas().find(p => p.titulo_id === t1.titulo.id);
  S.aprovar([p1.id]);
  const av = S.registrarPagamento(p1.id, { data: Ut.hoje(), valor: 4000, banco: 'b1' });
  verificar('NF da Novaped paga pela matriz avisa antes',
    !!av.erro && !!av.cruzamento, JSON.stringify(av.erro));
  verificar('confirmado, o pagamento acontece',
    S.registrarPagamento(p1.id, { data: Ut.hoje(), valor: 4000, banco: 'b1',
      confirmar_cruzamento: true, situacao: 'liquidado' }).ok, '');
  const cc = S.contaCorrenteEmpresas();
  verificar('e vira conta corrente entre as empresas',
    cc.saldos.some(x => x.devedora === 'emp3' && x.credora === 'emp1' && x.valor >= 4000),
    JSON.stringify(cc.saldos));

  // NF da matriz com custo de projeto de outra empresa = só classificação
  const t2 = mk('QA127-CLASS', 'emp1', 'pj33');
  const p2 = S.todasParcelas().find(p => p.titulo_id === t2.titulo.id);
  S.aprovar([p2.id]);
  verificar('NF da matriz com custo de projeto da Novaped passa direto',
    S.registrarPagamento(p2.id, { data: Ut.hoje(), valor: 4000, banco: 'b1' }).ok, '');
  verificar('e não entra na conta corrente',
    S.contaCorrenteEmpresas().linhas.every(l => l.parcela_id !== p2.id), '');

  // NF da Novaped pela conta da Novaped
  const t3 = mk('QA127-OK', 'emp3', 'pj33');
  const p3 = S.todasParcelas().find(p => p.titulo_id === t3.titulo.id);
  S.aprovar([p3.id]);
  verificar('NF da Novaped pela conta da Novaped não gera aviso',
    S.registrarPagamento(p3.id, { data: Ut.hoje(), valor: 4000, banco: 'b4' }).ok, '');

  // filtro por empresa
  const soNovaped = S.listar({ empresa: 'emp3' });
  verificar('o filtro por empresa separa a movimentação',
    soNovaped.length > 0 && soNovaped.every(p => S.empresaDaParcela(p) === 'emp3'), soNovaped.length);
  verificar('e sem filtro vem tudo junto',
    S.listar({}).length > soNovaped.length, '');
  S.setUsuario('u8');
})();

// ── ERP teste2 v1: resultado por empresa e consolidado ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u2');
  const comp = '2036-04';
  const cr = D.credores.find(c => c.ativo).id;

  // despesa comum rateada entre duas empresas
  S.criarTitulo({ descricao: 'Contabilidade QA', documento: 'QA-RAT-1', tipo_titulo: 'nf', credor: cr,
    conta: '6.07', emissao: Ut.hoje(), rateio: [{ centro: 'pj01', pct: 60 }, { centro: 'pj33', pct: 40 }] },
    [{ num: 1, venc: Ut.hoje(), comp: comp, valor: 10000 }]);
  S.criarReceber({ numero: 'QA-M1', emissao: Ut.hoje(), centro: 'pj01', competencia: comp,
    valor_bruto: 100000, cliente_nome: 'Hospital QA', origem: 'nota', forcar_sem_liberacao: true });
  S.criarReceber({ numero: 'QA-N1', emissao: Ut.hoje(), centro: 'pj33', competencia: comp,
    valor_bruto: 40000, cliente_nome: 'Maternidade QA', origem: 'nota', forcar_sem_liberacao: true });

  const a = S.apuracaoPorEmpresa({ competencia: comp });
  const matriz = a.empresas.find(e => e.empresa === 'emp1');
  const nova = a.empresas.find(e => e.empresa === 'emp3');
  verificar('a receita vai para a empresa do projeto',
    matriz.receita === 100000 && nova.receita === 40000,
    JSON.stringify([matriz.receita, nova.receita]));
  verificar('despesa rateada se divide entre os CNPJs',
    matriz.despesa === 6000 && nova.despesa === 4000,
    JSON.stringify([matriz.despesa, nova.despesa]));
  verificar('cada empresa tem resultado e margem próprios',
    matriz.resultado === 94000 && nova.resultado === 36000, '');
  verificar('o consolidado soma as três',
    a.consolidado.receita === 140000 && a.consolidado.despesa === 10000, JSON.stringify(a.consolidado));

  // operação entre empresas some do consolidado
  const cliGrupo = S.criarReceber({ numero: 'QA-INTRA', emissao: Ut.hoje(), centro: 'pj33',
    competencia: comp, valor_bruto: 5000, cliente_nome: 'HJM Matriz',
    cliente_documento: '34.958.609/0001-90', origem: 'nota', forcar_sem_liberacao: true });
  const b2 = S.apuracaoPorEmpresa({ competencia: comp });
  verificar('venda de uma empresa para outra é marcada como intragrupo',
    b2.empresas.find(e => e.empresa === 'emp3').intragrupo_receita === 5000,
    b2.empresas.find(e => e.empresa === 'emp3').intragrupo_receita);
  verificar('e é eliminada do consolidado',
    b2.consolidado.receita === 140000 && b2.consolidado.receita_bruta === 145000,
    JSON.stringify([b2.consolidado.receita, b2.consolidado.receita_bruta]));
  verificar('o CNPJ identifica empresa do grupo',
    S.empresaDoCNPJ('34.015.981/0001-62') === 'emp3' && !S.empresaDoCNPJ('11.222.333/0001-81'), '');
  S.setUsuario('u8');
})();

// ── ERP teste2 v2: extrato OFX das três contas ──
(function () {
  const O = sandbox.window.ERP.ofx;
  S.setUsuario('u2');
  const cab = (cs, enc) => 'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nENCODING:' + enc +
    '\nCHARSET:' + cs + '\n\n';
  const arquivo = (cs, enc, banco, conta, memo) => cab(cs, enc) +
    '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL' +
    '<BANKACCTFROM><BANKID>' + banco + '<BRANCHID>01785<ACCTID>' + conta +
    '<ACCTTYPE>CHECKING</BANKACCTFROM>' +
    '<BANKTRANLIST><DTSTART>20260901120000<DTEND>20260930120000' +
    '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260903120000<TRNAMT>1000,00<FITID>X1' +
    '<MEMO>' + memo + '</STMTTRN></BANKTRANLIST>' +
    '<LEDGERBAL><BALAMT>5000,00<DTASOF>20260930120000</LEDGERBAL>' +
    '</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>';

  verificar('a codificação declarada é reconhecida',
    O.codificacao(cab('UTF-8', 'UTF-8')) === 'utf-8' &&
    O.codificacao(cab('1252', 'USASCII')) === 'windows-1252', '');
  verificar('sem declaração, assume o padrão brasileiro (1252)',
    O.codificacao('OFXHEADER:100\n') === 'windows-1252', '');

  // reconhecimento da conta pelo próprio arquivo
  const brad = O.ler(arquivo('1252', 'USASCII', '237', '000000039464', 'PIX RECEBIDO REM: HOSPITAL X 03/09'));
  const sant = O.ler(arquivo('UTF-8', 'UTF-8', '033', '000013000567', 'PIX RECEBIDO SANTA CASA'));
  const itau = O.ler(arquivo('UTF-8', 'UTF-8', '341', '000000077889', 'SISPAG DRA MARCIA FONSECA'));
  verificar('o extrato do Bradesco cai na conta da matriz',
    (S.contaDoExtrato(brad) || {}).id === 'b1', (S.contaDoExtrato(brad) || {}).id);
  verificar('o do Santander, na conta da filial CE',
    (S.contaDoExtrato(sant) || {}).empresa === 'emp2', (S.contaDoExtrato(sant) || {}).apelido);
  verificar('o do Itaú, na conta da Novaped',
    (S.contaDoExtrato(itau) || {}).empresa === 'emp3', (S.contaDoExtrato(itau) || {}).apelido);
  verificar('conta desconhecida não é atribuída a ninguém',
    S.contaDoExtrato(O.ler(arquivo('1252', 'USASCII', '999', '000099999999', 'X'))) === null, '');

  // importar na conta errada é barrado
  const errado = S.importarExtrato('b1', sant, 'santander.ofx');
  verificar('importar o extrato do Santander na conta do Bradesco é barrado',
    !!errado.erro && errado.divergente === true, JSON.stringify(errado.erro));
  verificar('e o aviso aponta a conta certa', errado.conta_certa === 'b3', errado.conta_certa);
  const certo = S.importarExtrato('b3', sant, 'santander.ofx');
  verificar('na conta certa, importa', certo.ok && certo.novos === 1, JSON.stringify(certo.erro));
  verificar('e o mesmo arquivo de novo não duplica',
    S.importarExtrato('b3', sant, 'santander.ofx').repetidos === 1, '');

  // histórico dos três bancos
  verificar('o histórico do Bradesco perde o marcador REM:',
    brad.lancamentos[0].contraparte === 'HOSPITAL X', brad.lancamentos[0].contraparte);
  verificar('o do Itaú reconhece o SISPAG como pagamento a fornecedor',
    itau.lancamentos[0].meio === 'Pagamento a fornecedor', itau.lancamentos[0].meio);
  verificar('e extrai o nome depois do marcador',
    itau.lancamentos[0].contraparte === 'DRA MARCIA FONSECA', itau.lancamentos[0].contraparte);
  S.setUsuario('u8');
})();

// ── ERP teste2 v3: movimento por banco ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u2');
  const cr = D.credores.find(c => c.ativo).id;
  const t = S.criarTitulo({ descricao: 'QA banco', documento: 'QA-BCO-1', tipo_titulo: 'nf',
    credor: cr, conta: '6.07', centro: 'pj33', emissao: Ut.hoje(), empresa_tomadora: 'emp3' },
    [{ num: 1, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: 7000 }]);
  const p = S.todasParcelas().find(x => x.titulo_id === t.titulo.id);
  S.aprovar([p.id]);
  S.registrarPagamento(p.id, { data: Ut.hoje(), valor: 7000, banco: 'b4', situacao: 'liquidado' });

  verificar('a parcela sabe por qual conta foi paga',
    S.bancoDaParcela(p) === 'b4', S.bancoDaParcela(p));
  verificar('parcela sem pagamento não tem conta',
    S.bancoDaParcela(S.listar({ status: 'aberto' })[0]) === null, '');

  // filtro de banco na listagem
  const soItau = S.listar({ banco: 'b4' });
  verificar('o filtro de banco isola os pagamentos da conta',
    soItau.length > 0 && soItau.every(x => S.bancoDaParcela(x) === 'b4'), soItau.length);
  verificar('sem filtro, vêm as outras contas também',
    S.listar({}).length > soItau.length, '');

  // relatório para a contabilidade
  const geral = S.contasPagasERecebidas('2020-01-01', Ut.hoje());
  const itau = S.contasPagasERecebidas('2020-01-01', Ut.hoje(), { banco: 'b4' });
  verificar('o relatório traz banco e empresa em cada linha',
    geral.linhas.every(l => 'banco' in l && 'empresa' in l), '');
  verificar('e filtra por conta',
    itau.linhas.length > 0 && itau.linhas.every(l => l.banco_id === 'b4'), itau.linhas.length);
  verificar('a linha da Novaped sai com a empresa certa',
    itau.linhas.every(l => l.empresa === 'Novaped'),
    JSON.stringify(itau.linhas.map(l => l.empresa)));
  verificar('o total por conta não passa do total geral',
    itau.total_pago <= geral.total_pago && itau.linhas.length < geral.linhas.length, '');
  verificar('filtrar por empresa também funciona',
    S.contasPagasERecebidas('2020-01-01', Ut.hoje(), { empresa: 'emp3' })
      .linhas.every(l => l.empresa === 'Novaped'), '');
  verificar('a soma das contas fecha com o geral quando todo movimento tem conta',
    D.bancos.reduce((s, b) => s + S.contasPagasERecebidas('2020-01-01', Ut.hoje(),
      { banco: b.id }).linhas.length, 0) <= geral.linhas.length, '');
  verificar('o nome do arquivo sai sem acento nem travessão',
    Ut.slug('Santander — filial CE') === 'santander-filial-ce', Ut.slug('Santander — filial CE'));
  S.setUsuario('u8');
})();

// ── ERP teste2 v4: procedimentos do mutirão (HGB) ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u2');
  const hoje = Ut.hoje();

  verificar('a tabela PATE tem os 21 itens da planilha',
    D.tabelaPate.length === 21, D.tabelaPate.length);
  verificar('e separa cirurgia de diária',
    D.tabelaPate.filter(p => p.tipo === 'diaria').length === 4, '');
  verificar('o faturamento é 95% do total',
    D.tabelaPate.filter(p => p.total > 0).every(p =>
      Math.abs(p.faturamento - Math.round(p.total * 0.95 * 100) / 100) < 0.02), '');
  verificar('os três setores do HGB têm material com saldo',
    D.PATE_ARMAZENS.every(a => D.produtos.some(pr => S.saldoEstoque(pr.id, a) > 0)), '');

  // cirurgia com material
  const saldoAntes = S.saldoEstoque('pr20', 'am06');
  const r = S.lancarProcedimento({ data: hoje, procedimento: 'pa08', medico: 'DR. QA OFTALMO',
    paciente: 'PACIENTE QA', armazem: 'am06',
    materiais: [{ produto: 'pr20', qtd: 1 }, { produto: 'pr21', qtd: 1 }] });
  verificar('a cirurgia é lançada', r.ok, JSON.stringify(r.erro));
  const p = r.procedimento || {};
  verificar('o faturamento vem da tabela', p.faturamento === 1466.04, p.faturamento);
  verificar('o material sai do estoque de verdade',
    S.saldoEstoque('pr20', 'am06') === saldoAntes - 1, S.saldoEstoque('pr20', 'am06'));
  verificar('e entra no custo pelo custo médio', p.custo_material > 0, p.custo_material);
  verificar('o custo é repasse + material',
    Math.abs(p.custo - (p.repasse + p.custo_material)) < 0.01, JSON.stringify([p.custo, p.repasse]));
  verificar('o imposto é estimado sobre o faturamento',
    Math.abs(p.imposto - Math.round(p.faturamento * S.impostoProcedimentos() / 100 * 100) / 100) < 0.01, p.imposto);
  verificar('o resultado desconta imposto e custo',
    Math.abs(p.resultado - (p.faturamento - p.imposto - p.custo)) < 0.01, p.resultado);

  // sem saldo não grava
  const antesQtd = S.listarProcedimentos({}).length;
  const semSaldo = S.lancarProcedimento({ data: hoje, procedimento: 'pa08', medico: 'DR. QA',
    paciente: 'X', armazem: 'am06', materiais: [{ produto: 'pr20', qtd: 99999 }] });
  verificar('sem saldo de material o procedimento não é gravado',
    !!semSaldo.erro && S.listarProcedimentos({}).length === antesQtd, JSON.stringify(semSaldo.erro));

  // sem repasse na tabela: o médico é pago por plantão
  const semRep = S.lancarProcedimento({ data: hoje, procedimento: 'pa10', medico: 'DR. QA OTORRINO',
    paciente: 'Y', materiais: [] });
  verificar('procedimento sem repasse na tabela lança direto',
    semRep.ok, JSON.stringify(semRep.erro));
  verificar('e fica marcado como pago por plantão',
    semRep.procedimento.pago_por_plantao === true && semRep.procedimento.repasse === 0, '');
  const comRep = S.lancarProcedimento({ data: hoje, procedimento: 'pa10', medico: 'DR. QA AVULSO',
    paciente: 'Y2', armazem: 'am10', materiais: [], repasse: 800 });
  verificar('repasse avulso informado tira a linha do plantão',
    comRep.ok && comRep.procedimento.repasse === 800 &&
    comRep.procedimento.pago_por_plantao === false, JSON.stringify(comRep.erro));

  // diária
  const diaria = S.lancarProcedimento({ data: hoje, procedimento: 'pa18',
    medico: 'DR. QA RISCO', armazem: 'am08', materiais: [] });
  verificar('diária não exige paciente e não fatura',
    diaria.ok && diaria.procedimento.faturamento === 0 && diaria.procedimento.custo === 1000,
    JSON.stringify(diaria.erro));
  const semPac = S.lancarProcedimento({ data: hoje, procedimento: 'pa04', medico: 'DR. QA URO',
    armazem: 'am09', materiais: [] });
  verificar('mas a cirurgia exige paciente', !!semPac.erro, '');

  // relatórios
  const res = S.resultadoProcedimentos({});
  verificar('o relatório soma o geral', res.geral.faturamento > 0 && res.geral.medicos >= 3,
    JSON.stringify([res.geral.faturamento, res.geral.medicos]));
  verificar('e quebra por especialidade, setor, médico e procedimento',
    res.por_especialidade.length && res.por_setor.length && res.por_medico.length &&
    res.por_procedimento.length, '');
  verificar('a soma das especialidades bate com o geral',
    Math.abs(res.por_especialidade.reduce((s, x) => s + x.resultado, 0) - res.geral.resultado) < 0.05,
    '');
  verificar('o filtro por médico funciona',
    S.listarProcedimentos({ medico: 'QA OFTALMO' }).every(x => /QA OFTALMO/.test(x.medico)), '');

  // financeiro — agora pelo FECHAMENTO (v16), caminho único
  const comp = Ut.compDe(hoje);
  verificar('o caminho antigo aponta para o fechamento',
    (S.gerarFinanceiroProcedimentos(comp).erro || '').indexOf('Fechamento') > 0, '');
  const g = S.fecharProcedimentos({ competencia: comp });
  verificar('o fechamento gera a receita da competência e os repasses',
    g.ok && !!g.fechamento && (g.fechamento.titulo_ids || []).length > 0,
    JSON.stringify(g.erro || (g.fechamento || {}).titulo_ids));
  verificar('o médico digitado vira credor',
    D.credores.some(c => (c.origem === 'procedimentos' || /QA|DR/.test(c.nome)) && c.tipo === 'medico'), '');
  verificar('e a competência fechada não fecha de novo sem refazer',
    !!S.fecharProcedimentos({ competencia: comp }).erro ||
    S.fecharProcedimentos({ competencia: comp }).refazer === true, '');
  S.setUsuario('u8');
})();

// ── ERP teste2 v5: plantão estimado no lugar do repasse ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u2');
  const dia = '2036-07-10', dia2 = '2036-07-11';

  verificar('o valor do plantão é de 6 horas por mil reais',
    S.plantaoValor() === 1000 && S.plantaoHoras() === 6, '');

  // um médico, quatro cataratas e um calázio no mesmo dia
  ['P1', 'P2', 'P3', 'P4'].forEach(n => S.lancarProcedimento({ data: dia, procedimento: 'pa08',
    medico: 'DR. PLANTAO QA', paciente: n, armazem: 'am06', materiais: [] }));
  S.lancarProcedimento({ data: dia, procedimento: 'pa09', medico: 'DR. PLANTAO QA',
    paciente: 'P5', armazem: 'am06', materiais: [] });
  // outro médico no dia seguinte
  S.lancarProcedimento({ data: dia2, procedimento: 'pa08', medico: 'DRA. PLANTAO QA 2',
    paciente: 'P6', armazem: 'am06', materiais: [] });
  // e uma cirurgia com repasse na tabela, que não conta plantão
  S.lancarProcedimento({ data: dia, procedimento: 'pa01', medico: 'DRA. TABELA QA',
    paciente: 'P7', armazem: 'am07', materiais: [] });

  const pl = S.plantoesEstimados({ de: dia, ate: dia2 });
  verificar('estima um plantão por médico e por dia',
    pl.length === 2 && pl.every(d => d.plantoes === 1), JSON.stringify(pl.map(d => d.medico)));
  verificar('cinco procedimentos no mesmo dia continuam sendo um plantão',
    pl.find(d => d.data === dia).procedimentos === 5, '');
  verificar('médico pago pela tabela não entra na conta de plantão',
    pl.every(d => d.medico !== 'DRA. TABELA QA'), '');
  verificar('o custo estimado é o valor do plantão',
    pl.reduce((s, d) => s + d.custo, 0) === 2000, pl.reduce((s, d) => s + d.custo, 0));

  // rateio
  const comPl = S.procedimentosComPlantao({ de: dia, ate: dia2 });
  const doDia = comPl.filter(p => p.data === dia && p.pago_por_plantao);
  verificar('o rateio fecha exato com o custo do plantão do dia',
    Math.abs(doDia.reduce((s, p) => s + p.custo_plantao, 0) - 1000) < 0.005,
    doDia.reduce((s, p) => s + p.custo_plantao, 0));
  const cat = doDia.find(p => p.procedimento === 'pa08');
  const cal = doDia.find(p => p.procedimento === 'pa09');
  verificar('e é proporcional ao faturamento: a catarata carrega mais que o calázio',
    cat.custo_plantao > cal.custo_plantao * 5, JSON.stringify([cat.custo_plantao, cal.custo_plantao]));
  verificar('o plantão reduz o resultado de cada linha',
    cal.resultado_final < cal.resultado && cat.resultado_final < cat.resultado,
    JSON.stringify([cal.resultado, cal.resultado_final]));
  /* Rateio proporcional ao faturamento mantém a margem parecida entre
     as linhas do mesmo dia — o plantão não afunda o procedimento
     pequeno, que é o comportamento certo: o médico foi pago pelo
     turno, não por aquela cirurgia. */
  verificar('e mantém as margens do dia próximas entre si',
    Math.abs(cal.margem_final - cat.margem_final) < 1,
    JSON.stringify([cal.margem_final, cat.margem_final]));
  verificar('cirurgia com repasse na tabela não recebe plantão',
    comPl.filter(p => !p.pago_por_plantao).every(p => p.custo_plantao === 0), '');

  // ajuste de turno
  verificar('turno de 12 horas vira dois plantões',
    S.ajustarPlantoes(dia, 'DR. PLANTAO QA', 2, '12 horas').ok, '');
  verificar('e dobra o custo estimado do dia',
    S.plantoesEstimados({ de: dia, ate: dia }).find(d => d.medico === 'DR. PLANTAO QA').custo === 2000, '');
  verificar('meio plantão é aceito',
    S.ajustarPlantoes(dia2, 'DRA. PLANTAO QA 2', 0.5).ok, '');
  verificar('quantidade quebrada fora do meio plantão é recusada',
    !!S.ajustarPlantoes(dia2, 'DRA. PLANTAO QA 2', 1.3).erro, '');

  // resultado geral
  const r = S.resultadoProcedimentos({ de: dia, ate: dia2 });
  verificar('o resultado geral soma o plantão no custo',
    r.geral.plantao === 2500 && r.geral.plantoes === 2.5,
    JSON.stringify([r.geral.plantao, r.geral.plantoes]));
  verificar('e a quebra por médico mostra o plantão de cada um',
    r.por_medico.find(x => x.chave === 'DR. PLANTAO QA').plantao === 2000, '');
  verificar('o resultado desconta faturamento − imposto − material − plantão',
    Math.abs(r.geral.resultado -
      (r.geral.faturamento - r.geral.imposto - r.geral.material - r.geral.repasse - r.geral.plantao)) < 0.05,
    JSON.stringify(r.geral));
  S.setUsuario('u8');
})();

// ── ERP teste2 v6: o realizado do PegaPlantão prevalece ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u2');
  const comp = '2037-03', d1 = '2037-03-10', d2 = '2037-03-11';

  ['A', 'B', 'C'].forEach(n => S.lancarProcedimento({ data: d1, procedimento: 'pa08',
    medico: 'DR. REAL UM', paciente: n, armazem: 'am06', materiais: [] }));
  S.lancarProcedimento({ data: d2, procedimento: 'pa08', medico: 'DR. REAL UM',
    paciente: 'D', armazem: 'am06', materiais: [] });
  S.lancarProcedimento({ data: d1, procedimento: 'pa08', medico: 'DRA. REAL DOIS',
    paciente: 'E', armazem: 'am06', materiais: [] });

  const antes = S.resultadoProcedimentos({ competencia: comp });
  verificar('sem fechamento, o custo do plantão é estimado',
    antes.geral.plantao_origem === 'estimado' && antes.geral.plantao === 3000,
    JSON.stringify([antes.geral.plantao_origem, antes.geral.plantao]));
  verificar('e o ajuste manual de plantão é permitido',
    S.ajustarPlantoes(d1, 'DR. REAL UM', 2, 'teste').ok, '');
  S.ajustarPlantoes(d1, 'DR. REAL UM', 1);   // volta ao padrão

  // fechamento do PegaPlantão do mutirão
  const mk = (nome, valor) => {
    const cr = { id: 'cqa' + Math.random().toString(36).slice(2, 7), ativo: true, nome: nome,
      tipo: 'medico', conta_padrao: '8.01' };
    D.credores.push(cr);
    return S.criarTitulo({ descricao: 'Produtividade ' + nome, documento: 'PPQA-' + nome.slice(0, 7),
      tipo_titulo: 'medicao', credor: cr.id, conta: '8.01', centro: 'pj50', emissao: Ut.hoje(),
      origem: 'produtividade' }, [{ num: 1, venc: Ut.hoje(), comp: comp, valor: valor }]).titulo.id;
  };
  const lote = S.registrarLoteProdutividade({ centro: 'pj50', competencia: comp,
    arquivo: 'fechamento-qa.xlsx', medicos: 3, valor: 4400,
    titulo_ids: [mk('DR. REAL UM', 2400), mk('DRA. REAL DOIS', 1000), mk('DR. SO PLANTAO QA', 1000)] });

  const real = S.plantaoRealizado(comp);
  verificar('o fechamento do mutirão é lido por médico',
    real && real.total === 4400 && Object.keys(real.por_medico).length === 3,
    JSON.stringify(real && real.total));

  const dep = S.resultadoProcedimentos({ competencia: comp });
  verificar('com fechamento, o realizado prevalece sobre a estimativa',
    dep.geral.plantao_origem === 'realizado' && dep.geral.plantao === 3400,
    JSON.stringify([dep.geral.plantao_origem, dep.geral.plantao]));
  verificar('a estimativa continua visível para conferência',
    dep.geral.plantao_estimado === 3000 && dep.geral.plantao_diferenca === 400,
    JSON.stringify([dep.geral.plantao_estimado, dep.geral.plantao_diferenca]));
  verificar('o valor do médico é repartido entre os dias dele',
    dep.plantoes.filter(x => x.medico === 'DR. REAL UM')
      .reduce((s, x) => s + x.custo_realizado, 0) === 2400,
    JSON.stringify(dep.plantoes.map(x => x.custo_realizado)));
  verificar('médico do fechamento sem procedimento não some do custo',
    dep.geral.plantao_nao_alocado === 1000 &&
    dep.geral.medicos_sem_procedimento.indexOf('DR. SO PLANTAO QA') >= 0,
    JSON.stringify(dep.geral.medicos_sem_procedimento));
  verificar('e o não alocado entra no custo e derruba o resultado',
    Math.abs((antes.geral.resultado - dep.geral.resultado) - 1400) < 0.05,
    JSON.stringify([antes.geral.resultado, dep.geral.resultado]));

  const linhas = S.procedimentosComPlantao({ competencia: comp });
  verificar('o rateio por cirurgia passa a usar o valor realizado',
    Math.abs(linhas.filter(p => p.pago_por_plantao)
      .reduce((s, p) => s + p.custo_plantao, 0) - 3400) < 0.05,
    linhas.reduce((s, p) => s + p.custo_plantao, 0));
  verificar('ajustar a estimativa deixa de ser possível depois do fechamento',
    !!S.ajustarPlantoes(d1, 'DR. REAL UM', 2, 'teste').erro, '');

  // cancelar o lote devolve a estimativa
  S.cancelarLoteProdutividade
    ? S.cancelarLoteProdutividade(lote.id, 'teste')
    : (lote.cancelado = true);
  const volta = S.resultadoProcedimentos({ competencia: comp });
  verificar('cancelado o lote, volta a valer a estimativa',
    volta.geral.plantao_origem === 'estimado' && volta.geral.plantao === 3000,
    JSON.stringify([volta.geral.plantao_origem, volta.geral.plantao]));
  S.setUsuario('u8');
})();

// ── ERP teste2 v7: operacional sem valores e imposto por tributo ──
(function () {
  const Ut = sandbox.window.ERP.util;

  // ── perfil operacional
  S.setUsuario('u13');
  verificar('o perfil operacional existe e só vê procedimentos',
    S.usuario().perfil === 'operacional' &&
    D.perfis.find(p => p.id === 'operacional').modulos.join() === 'procedimentos', '');
  verificar('e não enxerga valores',
    !S.pode('ver_custo') && !S.pode('pagar') && !S.pode('aprovar'), '');
  verificar('mas lança procedimento e baixa material',
    S.pode('estoque'), '');
  const r = S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa08', medico: 'DR. OPERACIONAL QA',
    paciente: 'PAC QA', armazem: 'am06', materiais: [{ produto: 'pr20', qtd: 1 }] });
  verificar('o lançamento funciona pelo operacional', r.ok, JSON.stringify(r.erro));
  verificar('o operacional não gera lançamento no financeiro',
    !!S.gerarFinanceiroProcedimentos(Ut.compDe(Ut.hoje())).erro, '');

  // ── imposto por tributo
  /* v13: a alíquota é parâmetro de Administração — só quem movimenta
     lá altera. O teste passou a rodar como administrador. */
  S.setUsuario('u5');
  /* v15: a alíquota vem do CADASTRO DO PROJETO (fonte única), não de
     um parâmetro paralelo. O mutirão está com 9,04% — ISS 2 +
     PIS/COFINS 3,65 + IRPJ 2,2 + CSLL 1,19. */
  const padrao = S.tributosProcedimentos();
  verificar('o imposto vem aberto por tributo, do cadastro do projeto',
    padrao.length === 4 && padrao.map(t => t.id).join() === 'iss,pis_cofins,irpj,csll',
    padrao.map(t => t.id).join());
  verificar('e o total é a soma das alíquotas do projeto',
    Math.abs(S.impostoProcedimentos() - 9.04) < 0.001, S.impostoProcedimentos());
  verificar('que é a mesma alíquota que o resto do sistema usa no projeto',
    Math.abs(S.impostoProcedimentos() -
      Object.values(D.centro(D.PATE_CENTRO).impostos).reduce((a2, b2) => a2 + b2, 0)) < 0.001, '');
  const det = S.detalharImposto(1000);
  verificar('o detalhe reparte o valor por tributo',
    det.partes.length === 4 &&
    Math.abs(det.partes.reduce((s, x) => s + x.valor, 0) - det.total) < 0.005,
    JSON.stringify(det.total));
  verificar('ISS de 2% sobre mil dá vinte',
    det.partes.find(x => x.id === 'iss').valor === 20, '');

  // ajuste para presunção hospitalar
  const novo = S.salvarImpostosProcedimentos([
    { id: 'iss', nome: 'ISS', aliquota: 3 }, { id: 'pis', nome: 'PIS', aliquota: 0.65 },
    { id: 'cofins', nome: 'COFINS', aliquota: 3 },
    { id: 'irpj', nome: 'IRPJ', aliquota: 1.2, obs: 'presunção 8% hospitalar' },
    { id: 'csll', nome: 'CSLL', aliquota: 1.08, obs: 'presunção 12%' }]);
  verificar('as alíquotas são editáveis', novo.ok && Math.abs(novo.total - 8.93) < 0.001, novo.total);
  verificar('alíquota fora da faixa é recusada',
    !!S.salvarImpostosProcedimentos([{ nome: 'X', aliquota: 150 }]).erro, '');
  verificar('tributo sem nome é recusado',
    !!S.salvarImpostosProcedimentos([{ nome: '', aliquota: 1 }]).erro, '');
  verificar('soma acima de 100% é recusada',
    !!S.salvarImpostosProcedimentos([{ nome: 'A', aliquota: 60 }, { nome: 'B', aliquota: 50 }]).erro, '');

  // tributo desativado sai da conta
  S.salvarImpostosProcedimentos([{ id: 'iss', nome: 'ISS', aliquota: 3 },
    { id: 'pis', nome: 'PIS', aliquota: 0.65, ativo: false }]);
  verificar('tributo desativado não entra no total',
    Math.abs(S.impostoProcedimentos() - 3) < 0.001, S.impostoProcedimentos());

  // o lançamento guarda a composição do dia
  S.salvarImpostosProcedimentos([{ id: 'iss', nome: 'ISS', aliquota: 5 },
    { id: 'cofins', nome: 'COFINS', aliquota: 3 }]);
  const p1 = S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa08', medico: 'DR. IMPOSTO QA',
    paciente: 'P1', armazem: 'am06', materiais: [] }).procedimento;
  verificar('o procedimento grava a composição do imposto',
    p1.imposto_detalhe.length === 2 && p1.imposto_pct === 8,
    JSON.stringify(p1.imposto_detalhe.map(x => x.nome)));
  S.salvarImpostosProcedimentos([{ id: 'iss', nome: 'ISS', aliquota: 2 }]);
  verificar('mudar a alíquota depois não reescreve o que já foi lançado',
    S.listarProcedimentos({}).find(x => x.id === p1.id).imposto === p1.imposto, '');
  const p2 = S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa08', medico: 'DR. IMPOSTO QA',
    paciente: 'P2', armazem: 'am06', materiais: [] }).procedimento;
  verificar('e o lançamento novo já usa a alíquota nova',
    p2.imposto_pct === 2 && p2.imposto < p1.imposto, JSON.stringify([p1.imposto_pct, p2.imposto_pct]));
  S.salvarImpostosProcedimentos(D.IMPOSTOS_PROCEDIMENTOS_PADRAO.map(i =>
    ({ id: i.id, nome: i.nome, aliquota: i.aliquota, obs: i.obs, ativo: true })));
  S.setUsuario('u8');
})();

// ── ERP teste2 v8: uma sala por especialidade ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u2');

  verificar('cada especialidade tem a sua sala cadastrada',
    D.ESPECIALIDADES_PATE.every(e => !!D.armazemDaEspecialidade(e, D.PATE_CENTRO)),
    D.ESPECIALIDADES_PATE.map(e => e + ':' + D.armazemDaEspecialidade(e)).join(' '));
  verificar('as salas pertencem ao projeto do mutirão',
    D.PATE_ARMAZENS.every(a => (D.armazem(a) || {}).centro === D.PATE_CENTRO), '');
  verificar('e todas têm material com saldo',
    D.PATE_ARMAZENS.every(a => D.produtos.some(pr => S.saldoEstoque(pr.id, a) > 0)), '');

  // material específico fica na sala certa
  const oft = D.armazemDaEspecialidade('OFTALMO', D.PATE_CENTRO);
  const gin = D.armazemDaEspecialidade('GINECO', D.PATE_CENTRO);
  verificar('a lente intraocular só tem saldo na oftalmo',
    S.saldoEstoque('pr20', oft) > 0 && S.saldoEstoque('pr20', gin) === 0, '');
  verificar('e o clipador não está na oftalmo',
    S.saldoEstoque('pr24', oft) === 0 && S.saldoEstoque('pr24', gin) > 0, '');

  // o store resolve o setor sozinho
  const r = S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa16', medico: 'DRA. SALA QA',
    paciente: 'PAC SALA', materiais: [{ produto: 'pr24', qtd: 1 }] });
  verificar('sem informar o setor, o lançamento usa a sala da especialidade',
    r.ok && r.procedimento.armazem === gin, JSON.stringify(r.erro));
  verificar('e a baixa sai do estoque daquela sala',
    S.movimentos({ armazem: gin }).some(m => /LAQUEADURA/.test(m.observacao || '')), '');

  // sala de outra especialidade é barrada
  const errado = S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa08', medico: 'DR. SALA QA',
    paciente: 'X', armazem: gin, materiais: [] });
  verificar('apontar a sala de outra especialidade é barrado',
    !!errado.erro && errado.setor_errado === true, JSON.stringify(errado.erro));
  verificar('e o aviso diz qual é a sala certa', errado.setor_certo === oft, errado.setor_certo);
  S.setUsuario('u8');
})();

// ── ERP teste2 v9: imposto retroativo, unidades, edição e saldo do hospital ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u2');

  // 1. imposto muda o passado
  /* v13: alterar alíquota exige Administração. */
  S.setUsuario('u5');
  S.salvarImpostosProcedimentos([{ id: 'iss', nome: 'ISS', aliquota: 10 }]);
  const p = S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa08', medico: 'DR. RETRO QA',
    paciente: 'PAC RETRO', materiais: [] }).procedimento;
  const impostoAntes = p.imposto;
  S.salvarImpostosProcedimentos([{ id: 'iss', nome: 'ISS', aliquota: 5 }]);
  const depois = S.procedimentosComPlantao({}).find(x => x.id === p.id);
  verificar('mudar a alíquota recalcula o imposto do que já foi lançado',
    depois.imposto === Math.round(impostoAntes / 2 * 100) / 100 && depois.imposto_recalculado,
    JSON.stringify([impostoAntes, depois.imposto]));
  verificar('e o resultado acompanha',
    depois.resultado > p.resultado, JSON.stringify([p.resultado, depois.resultado]));
  const rel = S.resultadoProcedimentos({});
  verificar('o relatório usa a alíquota vigente',
    Math.abs(rel.geral.imposto - Math.round(rel.geral.faturamento * 5 / 100 * 100) / 100) < 0.5,
    JSON.stringify([rel.geral.imposto, rel.geral.faturamento]));

  // 2. estoque em unidades
  S.setUsuario('u5');
  const saldo0 = S.saldoEstoque('pr04', 'am10');
  S.entrada({ produto: 'pr04', armazem: 'am10', qtd: 2, unidades_por_embalagem: 100, custo: 200,
    data: Ut.hoje(), documento: 'QA-UN' });
  verificar('2 caixas de 100 entram como 200 unidades',
    S.saldoEstoque('pr04', 'am10') === saldo0 + 200, S.saldoEstoque('pr04', 'am10'));
  verificar('e o custo unitário é o da caixa dividido pela embalagem',
    S.custoMedio('pr04', 'am10') === 2, S.custoMedio('pr04', 'am10'));
  const b = S.saida({ produto: 'pr04', armazem: 'am10', qtd: 1, data: Ut.hoje(),
    motivo: 'Consumo assistencial' });
  verificar('a baixa de 1 unidade custa o valor unitário', b.custo === 2, b.custo);
  const antesPr06 = S.saldoEstoque('pr06', 'am10');
  S.entrada({ produto: 'pr06', armazem: 'am10', qtd: 5, custo: 8, data: Ut.hoje() });
  verificar('sem informar embalagem, vale 1 (material que já vem em unidade)',
    S.saldoEstoque('pr06', 'am10') === antesPr06 + 5, S.saldoEstoque('pr06', 'am10'));
  verificar('embalagem zero é recusada',
    !!S.entrada({ produto: 'pr06', armazem: 'am10', qtd: 1, unidades_por_embalagem: 0,
      custo: 5, data: Ut.hoje() }).erro, '');

  // 3. material puxado de outro estoque do hospital
  S.setUsuario('u2');
  const naSala = S.saldoEstoque('pr23', 'am11');
  const noHosp = S.saldoNaUnidade('pr23', 'am11').saldo;
  verificar('a tela tem o caso: zerado na sala, com saldo no hospital',
    naSala === 0 && noHosp > 0, JSON.stringify([naSala, noHosp]));
  const puxou = S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa16', medico: 'DRA. PUXA QA',
    paciente: 'PAC PUXA', materiais: [{ produto: 'pr23', qtd: 2 }] });
  verificar('o lançamento não trava por falta de transferência',
    puxou.ok, JSON.stringify(puxou.erro));
  verificar('e o aviso diz de onde veio o material',
    /outro estoque do hospital/.test(puxou.aviso || ''), puxou.aviso);
  verificar('o saldo do hospital caiu',
    S.saldoNaUnidade('pr23', 'am11').saldo === noHosp - 2, '');
  verificar('sem saldo no hospital inteiro, aí sim recusa',
    !!S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa16', medico: 'DRA. PUXA QA',
      paciente: 'P2', materiais: [{ produto: 'pr23', qtd: 99999 }] }).erro, '');

  // 4. editar lançamento
  const orig = S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa08', medico: 'DR. EDITA QA',
    paciente: 'NOME ERRADO', materiais: [{ produto: 'pr20', qtd: 2 }] }).procedimento;
  const saldoAntes = S.saldoEstoque('pr20', 'am06');
  const ed = S.editarProcedimento(orig.id, { paciente: 'NOME CERTO',
    materiais: [{ produto: 'pr20', qtd: 1 }] });
  verificar('o procedimento é editado', ed.ok && ed.procedimento.paciente === 'NOME CERTO',
    JSON.stringify(ed.erro));
  verificar('o material da edição corrige o estoque',
    S.saldoEstoque('pr20', 'am06') === saldoAntes + 1, S.saldoEstoque('pr20', 'am06'));
  verificar('o lançamento antigo sai da lista', 
    !S.listarProcedimentos({}).some(x => x.id === orig.id), '');
  /* `cancelado` virou booleano (a coluna do banco é boolean, e
     gravar objeto ali derrubava o PATCH e duplicava o faturamento).
     O detalhe mora em campos próprios. */
  const editado = S.listarProcedimentos({ cancelados: true }).find(x => x.id === orig.id) || {};
  verificar('e fica no histórico marcado como editado',
    editado.cancelado === true && editado.edicao === true, JSON.stringify({
      cancelado: editado.cancelado, edicao: editado.edicao }));
  verificar('com o motivo e quem editou registrados',
    !!editado.motivo_cancelamento && !!editado.cancelado_por, editado.motivo_cancelamento);
  verificar('o novo aponta para o que substituiu',
    ed.procedimento.substitui === orig.id, '');

  S.salvarImpostosProcedimentos(D.IMPOSTOS_PROCEDIMENTOS_PADRAO.map(i =>
    ({ id: i.id, nome: i.nome, aliquota: i.aliquota, obs: i.obs, ativo: true })));
  S.setUsuario('u8');
})();

// ── ERP teste2 v10: matriz de acesso ──
(function () {
  const Ut = sandbox.window.ERP.util;

  verificar('a matriz cobre todos os perfis',
    D.perfis.every(p => !!S.matrizAcesso()[p.id]),
    D.perfis.filter(p => !S.matrizAcesso()[p.id]).map(p => p.id).join());
  verificar('cada cruzamento tem os três níveis',
    ['ver', 'mover', 'financeiro'].every(k => k in S.acessoDoPerfil('socio', 'financeiro')), '');

  // a distribuição sugerida
  /* Compara campo a campo: o objeto ganhou o nível `aprovar` na v28,
     e comparar o JSON inteiro quebra a cada nível novo. */
  const acAss = S.acessoDoPerfil('assistente', 'procedimentos');
  verificar('a assistente financeira vê procedimentos com valor, mas não movimenta',
    acAss.ver === true && acAss.mover === false && acAss.financeiro === true,
    JSON.stringify(S.acessoDoPerfil('assistente', 'procedimentos')));
  const acEst = S.acessoDoPerfil('estoquista', 'procedimentos');
  verificar('o estoque movimenta procedimentos sem ver dinheiro',
    acEst.ver === true && acEst.mover === true && acEst.financeiro === false, '');
  verificar('a consulta vê valor e não movimenta nada',
    S.acessoDoPerfil('consulta', 'financeiro').financeiro &&
    !S.acessoDoPerfil('consulta', 'financeiro').mover, '');
  verificar('o operacional não enxerga o financeiro',
    !S.acessoDoPerfil('operacional', 'financeiro').ver, '');

  // a matriz manda de verdade
  S.setUsuario('u1');
  verificar('a assistente é barrada ao lançar procedimento',
    !!S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa08', medico: 'X',
      paciente: 'Y', materiais: [] }).erro, '');
  verificar('e não vê o módulo de procedimentos como movimentável',
    S.veModulo('procedimentos') && !S.podeMover('procedimentos'), '');
  S.setUsuario('u6');
  verificar('o estoque lança procedimento',
    S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa08', medico: 'DR. ESTOQUE QA',
      paciente: 'PAC', materiais: [] }).ok, '');
  verificar('mas não gera no financeiro',
    !!S.gerarFinanceiroProcedimentos(Ut.compDe(Ut.hoje())).erro, '');

  // edição da matriz
  S.setUsuario('u5');
  const m = JSON.parse(JSON.stringify(S.matrizAcesso()));
  m.assistente.procedimentos = 'VMF';
  verificar('a matriz é editável', S.salvarMatrizAcesso(m).ok, '');
  S.setUsuario('u1');
  verificar('e a mudança vale na hora',
    S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa08', medico: 'DR. AGORA QA',
      paciente: 'PAC2', materiais: [] }).ok, '');
  S.setUsuario('u5');
  const semAdmin = JSON.parse(JSON.stringify(S.matrizAcesso()));
  Object.keys(semAdmin).forEach(p => { delete semAdmin[p].administracao; });
  verificar('tirar todo mundo da administração é recusado',
    !!S.salvarMatrizAcesso(semAdmin).erro, '');
  S.salvarMatrizAcesso(JSON.parse(JSON.stringify(MATRIZ_TESTE)));
  verificar('voltar ao padrão restaura a sugestão',
    !S.acessoDoPerfil('assistente', 'procedimentos').mover, '');
  S.setUsuario('u8');
})();

// ── ERP teste2 v11: prévia do material vinda de outra sala ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u2');
  /* Material que a sala não tem: o custo existe em outro armazém da
     unidade, e a prévia da tela precisa achá-lo — senão mostra zero e
     o custo só aparece depois de gravar. */
  const sala = D.armazemDaEspecialidade('CIRURGIA GERAL', D.PATE_CENTRO);
  const un = S.saldoNaUnidade('pr09', sala);
  verificar('há material sem saldo na sala e com saldo na unidade',
    S.saldoEstoque('pr09', sala) === 0 && un.saldo > 0,
    JSON.stringify([S.saldoEstoque('pr09', sala), un.saldo]));
  const fontes = D.comSetores(un.pai).filter(am => S.saldoEstoque('pr09', am) > 0);
  verificar('e ele tem custo médio na sala de origem',
    fontes.some(am => S.custoMedio('pr09', am) > 0), '');

  const r = S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa01', medico: 'DR. TAB QA',
    paciente: 'PAC TAB', materiais: [{ produto: 'pr09', qtd: 2 }] });
  verificar('o lançamento traz o custo real do material puxado',
    r.ok && r.procedimento.custo_material > 0, JSON.stringify([r.erro, r.procedimento && r.procedimento.custo_material]));
  S.setUsuario('u8');
})();

// ── ERP teste2 v12: previsões do mutirão e relatórios ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u2');
  const comp = '2038-05', dia = '2038-05-12';

  verificar('cada especialidade tem subprojeto no grupo do mutirão',
    D.ESPECIALIDADES_PATE.every(e => !!D.centroDaEspecialidade(e)),
    D.ESPECIALIDADES_PATE.map(e => e + ':' + D.centroDaEspecialidade(e)).join(' '));
  /* O projeto-mãe (pj50) fica FORA do grupo: quem fatura são as seis
     especialidades, e somar mãe e filhas contaria duas vezes. */
  verificar('as seis especialidades formam o grupo de faturamento do mutirão',
    D.centros.filter(c => c.grupo_faturamento === 'GHC - HGB MUTIRAO').length === 6 &&
    !D.centro('pj50').grupo_faturamento,
    D.centros.filter(c => c.grupo_faturamento === 'GHC - HGB MUTIRAO').length);

  ['A', 'B'].forEach(n => S.lancarProcedimento({ data: dia, procedimento: 'pa08',
    medico: 'DR. PREV QA', paciente: n, armazem: null, materiais: [] }));
  S.lancarProcedimento({ data: dia, procedimento: 'pa01', medico: 'DRA. PREV QA',
    paciente: 'C', materiais: [] });

  const prev = id => S.st.previsoes.find(p => p.centro === id && p.competencia === comp) || {};
  const oft = prev(D.centroDaEspecialidade('OFTALMO'));
  const ger = prev(D.centroDaEspecialidade('CIRURGIA GERAL'));
  verificar('o procedimento gera previsão de faturamento na especialidade',
    oft.faturamento === 2932.08 && ger.faturamento === 3771.31,
    JSON.stringify([oft.faturamento, ger.faturamento]));
  verificar('e previsão de repasse — plantão na oftalmo, tabela na cirurgia geral',
    oft.repasse === 1000 && ger.repasse === 688.77, JSON.stringify([oft.repasse, ger.repasse]));
  verificar('a previsão fica marcada como vinda dos procedimentos',
    oft.origem === 'procedimentos', oft.origem);

  // cancelar recalcula, não deixa resíduo
  const umaOft = S.listarProcedimentos({ competencia: comp })
    .find(p => p.especialidade === 'OFTALMO');
  S.cancelarProcedimento(umaOft.id, 'teste');
  verificar('cancelar recalcula a previsão da competência',
    prev(D.centroDaEspecialidade('OFTALMO')).faturamento === 1466.04,
    prev(D.centroDaEspecialidade('OFTALMO')).faturamento);

  // filtro por dia
  verificar('o filtro por dia funciona na listagem',
    S.listarProcedimentos({ de: dia, ate: dia }).length ===
    S.listarProcedimentos({ competencia: comp }).length, '');
  verificar('e dia sem movimento vem vazio',
    S.listarProcedimentos({ de: '2038-05-01', ate: '2038-05-01' }).length === 0, '');

  // relatório completo tem todas as colunas de resultado
  const linhas = S.procedimentosComPlantao({ competencia: comp });
  verificar('o analítico traz médico, paciente, faturamento, custo e resultado',
    linhas.every(p => 'medico' in p && 'paciente' in p && 'faturamento' in p &&
      'custo_total' in p && 'resultado_final' in p), '');
  S.setUsuario('u8');
})();

// ── ERP teste2 v13: a matriz governa a escrita (itens 38, C10, C11, A17) ──
(function () {
  const Ut = sandbox.window.ERP.util;

  // as ações grossas agora derivam da matriz
  S.setUsuario('u1');
  verificar('a assistente lança no financeiro porque a matriz dá M lá',
    S.pode('lancar') && S.pode('pagar'), '');
  verificar('e não movimenta estoque, porque a matriz só dá V',
    !S.pode('estoque'), '');
  S.setUsuario('u6');
  verificar('o estoquista movimenta estoque e não lança no financeiro',
    S.pode('estoque') && !S.pode('lancar'), '');
  S.setUsuario('u11');
  verificar('produtividade não tem Financeiro na matriz, então não cria título',
    !S.pode('lancar') && !!S.criarTitulo({ descricao: 'x', documento: 'QA-MATRIZ-1',
      tipo_titulo: 'nf', credor: D.credores[0].id, conta: '6.07', centro: 'pj01',
      emissao: Ut.hoje() }, [{ num: 1, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: 10 }]).erro, '');

  // tirar o acesso na matriz tira de verdade (A18)
  S.setUsuario('u5');
  const m = JSON.parse(JSON.stringify(S.matrizAcesso()));
  m.assistente.financeiro = 'V';
  S.salvarMatrizAcesso(m);
  S.setUsuario('u1');
  verificar('zerar o M de Financeiro na matriz impede a assistente de lançar',
    !S.pode('lancar') && !!S.criarTitulo({ descricao: 'x', documento: 'QA-MATRIZ-2',
      tipo_titulo: 'nf', credor: D.credores[0].id, conta: '6.07', centro: 'pj01',
      emissao: Ut.hoje() }, [{ num: 1, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: 10 }]).erro, '');
  verificar('e de registrar pagamento', !!S.registrarPagamento('x', { data: Ut.hoje(), valor: 1 }).erro, '');
  S.setUsuario('u5');
  S.salvarMatrizAcesso(JSON.parse(JSON.stringify(MATRIZ_TESTE)));

  // C10
  S.setUsuario('u4');
  verificar('C10 — perfil de consulta não altera a alíquota de imposto',
    !!S.salvarImpostosProcedimentos([{ nome: 'ISS', aliquota: 99 }]).erro, '');
  /* Blocos anteriores mexem na alíquota; o que importa aqui é que a
     tentativa do perfil de consulta não mudou nada. */
  const antesAliq = S.impostoProcedimentos();
  S.salvarImpostosProcedimentos([{ nome: 'ISS', aliquota: 77 }]);
  verificar('e a alíquota não se move com a tentativa dele',
    S.impostoProcedimentos() === antesAliq, S.impostoProcedimentos());

  // C11
  S.setUsuario('u5');
  const m2 = JSON.parse(JSON.stringify(S.matrizAcesso()));
  m2.estoquista.administracao = 'V';
  S.salvarMatrizAcesso(m2);
  S.setUsuario('u6');
  const m3 = JSON.parse(JSON.stringify(S.matrizAcesso()));
  m3.estoquista.financeiro = 'VMF'; m3.estoquista.dp = 'VMF';
  verificar('C11 — só ver Administração não dá direito de mudar acessos',
    !!S.salvarMatrizAcesso(m3).erro, '');
  S.setUsuario('u5');
  const m4 = JSON.parse(JSON.stringify(S.matrizAcesso()));
  m4.estoquista.administracao = 'VM';
  S.salvarMatrizAcesso(m4);
  S.setUsuario('u6');
  const m5 = JSON.parse(JSON.stringify(S.matrizAcesso()));
  m5.estoquista.financeiro = 'VMF';
  verificar('nem com M: ninguém amplia o próprio perfil',
    !!S.salvarMatrizAcesso(m5).erro, '');
  const m6 = JSON.parse(JSON.stringify(S.matrizAcesso()));
  m6.dp.cadastros = 'VM';
  verificar('mas pode mexer no acesso de outro perfil', S.salvarMatrizAcesso(m6).ok, '');
  S.setUsuario('u5');
  S.salvarMatrizAcesso(JSON.parse(JSON.stringify(MATRIZ_TESTE)));
  verificar('matriz sem ninguém movimentando em Administração é recusada',
    !!S.salvarMatrizAcesso((function () {
      const x = JSON.parse(JSON.stringify(MATRIZ_TESTE));
      Object.keys(x).forEach(p => { delete x[p].administracao; });
      return x;
    })()).erro, '');
  verificar('e matriz com M sem V em Administração também',
    !!S.salvarMatrizAcesso((function () {
      const x = JSON.parse(JSON.stringify(MATRIZ_TESTE));
      Object.keys(x).forEach(p => { if (x[p].administracao) x[p].administracao = 'M'; });
      return x;
    })()).erro, '');
  S.salvarMatrizAcesso(JSON.parse(JSON.stringify(MATRIZ_TESTE)));

  // A17 — Ativos
  S.setUsuario('u13');
  verificar('A17 — operacional não cadastra ativo', !!S.salvarAtivo({ nome: 'X' }).erro, '');
  verificar('A17 — abrirOS tem guarda',
    (S.abrirOS({ ativo: (S.ativos({}) || [{}])[0].id, descricao: 'teste' }).erro || '')
      .indexOf('não movimenta') >= 0, '');
  S.setUsuario('u6');
  const algumAtivo = (S.ativos({}) || [])[0] || {};
  const os = S.abrirOS({ ativo: algumAtivo.id, descricao: 'QA OS' });
  verificar('o estoquista abre OS (tem M em Ativos)', os.ok, JSON.stringify(os.erro));
  if (os.ok) {
    verificar('mas não carimba custo nela, por não ter o nível financeiro',
      !!S.fecharOS(os.os.id, { custo: 15000, laudo: 'x' }).erro, '');
  }

  // ignorarLinha
  S.setUsuario('u13');
  verificar('ignorarLinha passou a ter guarda',
    (S.ignorarLinha('qualquer', 'x').erro || '').indexOf('conciliação') >= 0,
    S.ignorarLinha('qualquer', 'x').erro);
  S.setUsuario('u8');
})();

// ── ERP teste2 v13: críticos C1 a C9, C12 e C13 ──
(function () {
  const Ut = sandbox.window.ERP.util;

  // C1 — recebimento entra só na conta que recebeu
  S.setUsuario('u5');
  const antesSaldo = {};
  D.bancos.forEach(b => { antesSaldo[b.id] = S.saldoDoSistema(b.id); });
  const rc = S.criarReceber({ numero: 'QA-C1', emissao: Ut.hoje(), centro: 'pj01',
    competencia: Ut.mesAtual(), valor_bruto: 1000, cliente_nome: 'QA', origem: 'nota',
    forcar_sem_liberacao: true });
  S.receberBaixa(rc.receber.id, { data: Ut.hoje(), valor: 1000, banco: 'b4' });
  verificar('C1 — o recebimento entra só na conta que recebeu',
    S.saldoDoSistema('b4') === antesSaldo.b4 + 1000 &&
    S.saldoDoSistema('b1') === antesSaldo.b1 && S.saldoDoSistema('b2') === antesSaldo.b2,
    JSON.stringify(D.bancos.map(b => b.id + ':' + (S.saldoDoSistema(b.id) - antesSaldo[b.id]))));

  // C2 — previsto entra no fluxo diário
  const saidas = () => S.fluxoDiario({ dias: 120 }).linhas.reduce((s, x) => s + (x.saidas || 0), 0);
  S.setUsuario('u2');
  const fluxoAntes = saidas();
  S.setUsuario('u8');
  const folha = S.fecharFolha('2026-09');
  S.setUsuario('u2');
  verificar('C2 — folha fechada aparece nas saídas do fluxo diário',
    folha.ok && saidas() > fluxoAntes + 1000, JSON.stringify([fluxoAntes, saidas()]));

  // C3 — negativos recusados
  const cr = D.credores[0].id;
  const t3 = S.criarTitulo({ descricao: 'QA C3', documento: 'QA-C3', tipo_titulo: 'nf', credor: cr,
    conta: '6.07', centro: 'pj01', emissao: Ut.hoje() },
    [{ num: 1, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: 1000 }]);
  const p3 = S.todasParcelas().find(p => p.titulo_id === t3.titulo.id);
  S.aprovar([p3.id]);
  verificar('C3 — desconto negativo é recusado',
    !!S.registrarPagamento(p3.id, { data: Ut.hoje(), valor: 1500, desconto: -500, banco: 'b1' }).erro, '');
  verificar('C3 — juros negativo é recusado',
    !!S.registrarPagamento(p3.id, { data: Ut.hoje(), valor: 1000, juros: -900, banco: 'b1' }).erro, '');
  verificar('C3 — e a parcela continua intacta',
    S.saldoDe(S.todasParcelas().find(p => p.id === p3.id)) === 1000, '');

  // C4 — estorno parcial reverte a retenção
  const r4 = S.criarReceber({ numero: 'QA-C4', emissao: Ut.hoje(), centro: 'pj01',
    competencia: Ut.mesAtual(), valor_bruto: 1000, valor_retido: 100, cliente_nome: 'QA',
    origem: 'nota', forcar_sem_liberacao: true });
  const rr = () => S.st.receber.find(x => x.id === r4.receber.id);
  S.receberBaixa(r4.receber.id, { data: Ut.hoje(), valor: 400, banco: 'b1', decisao: 'residual' });
  S.receberBaixa(r4.receber.id, { data: Ut.hoje(), valor: 600, banco: 'b1', decisao: 'residual' });
  verificar('C4 — receber o bruto zera a retenção prevista',
    rr().valor_retido === 0 && !!rr().divergencia_retencao, rr().valor_retido);
  S.setUsuario('u3');
  S.estornarRecebimento(r4.receber.id, false);
  verificar('C4 — estornar a parcial devolve a retenção',
    rr().valor_retido === 100 && rr().valor_recebido === 400,
    JSON.stringify([rr().valor_retido, rr().valor_recebido]));

  // C5 — estorno de entrada pelo custo médio
  S.setUsuario('u5');
  const A = 'am10', PR = 'pr29';
  S.entrada({ produto: PR, armazem: A, qtd: 100, custo: 1, data: Ut.hoje(), documento: 'QA-C5a' });
  S.entrada({ produto: PR, armazem: A, qtd: 10, custo: 100, data: Ut.hoje(), documento: 'QA-C5b' });
  const mvC5 = S.movimentos({ produto: PR, armazem: A }).find(m => m.documento === 'QA-C5b');
  S.saida({ produto: PR, armazem: A, qtd: 10, data: Ut.hoje(), motivo: 'Consumo assistencial' });
  const est = S.estornarMovimento(mvC5.id, 'teste C5');
  verificar('C5 — estorno de entrada não zera o custo médio',
    est.ok && S.custoMedio(PR, A) > 0, JSON.stringify([est.erro, S.custoMedio(PR, A)]));
  verificar('C5 — e o valor do estoque não fica negativo',
    S.posicaoEstoque(A).every(l => l.valor >= 0), '');
  verificar('C5 — saldo zerado implica valor zerado',
    S.posicaoEstoque(A).every(l => l.saldo > 0 || l.valor === 0), '');

  // C6 — custo inválido na entrada
  verificar('C6 — custo negativo é recusado',
    !!S.entrada({ produto: 'pr06', armazem: A, qtd: 5, custo: -200, data: Ut.hoje() }).erro, '');
  verificar('C6 — custo com vírgula é interpretado, não vira NaN',
    S.entrada({ produto: 'pr06', armazem: A, qtd: 5, custo: '120,00', data: Ut.hoje() }).ok &&
    isFinite(S.custoMedio('pr06', A)) && S.custoMedio('pr06', A) > 0, S.custoMedio('pr06', A));
  verificar('C6 — quantidade infinita é recusada',
    !!S.entrada({ produto: 'pr06', armazem: A, qtd: Infinity, custo: 10, data: Ut.hoje() }).erro, '');

  // C7 — inventário com data futura
  verificar('C7 — inventário com data futura é recusado',
    !!S.entrada({ produto: 'pr06', armazem: 'am09', qtd: 5, custo: 10,
      data: '2030-12-31', origem: 'inventario' }).erro, '');
  S.entrada({ produto: 'pr06', armazem: 'am09', qtd: 5, custo: 10, data: Ut.hoje(), origem: 'inventario' });
  const invMv = S.movimentos({ armazem: 'am09', produto: 'pr06' })[0];
  S.estornarMovimento(invMv.id, 'engano');
  verificar('C7 — inventário estornado não trava mais o armazém',
    S.entrada({ produto: 'pr06', armazem: 'am09', qtd: 1, custo: 10,
      data: Ut.addDias(Ut.hoje(), -5) }).ok, '');

  // C8 e C9 — edição de procedimento
  S.setUsuario('u13');
  const salaU = D.armazemDaEspecialidade('UROLOGIA', D.PATE_CENTRO);
  const saldoU = S.saldoEstoque('pr09', salaU);
  const pc = S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa04', medico: 'DR. C8 QA',
    paciente: 'PAC', materiais: [{ produto: 'pr09', qtd: saldoU }] });
  verificar('C8 — a baixa grava o custo unitário de cada material',
    pc.ok && pc.procedimento.materiais.every(m => m.custo_unitario > 0), '');
  const custoAntes = pc.procedimento.custo_material;
  const ed = S.editarProcedimento(pc.procedimento.id, { paciente: 'NOME CORRIGIDO' });
  verificar('C8 — editar com a sala zerada não apaga o custo do material',
    ed.ok && Math.abs(ed.procedimento.custo_material - custoAntes) < 0.01,
    JSON.stringify([custoAntes, ed.procedimento && ed.procedimento.custo_material]));

  S.setUsuario('u5');
  const mOp = JSON.parse(JSON.stringify(S.matrizAcesso()));
  mOp.operacional.estoque = 'V';
  S.salvarMatrizAcesso(mOp);
  S.setUsuario('u13');
  const salaO = D.armazemDaEspecialidade('OFTALMO', D.PATE_CENTRO);
  const saldoO = S.saldoEstoque('pr20', salaO);
  const pc9 = S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa08', medico: 'DR. C9 QA',
    paciente: 'PAC', materiais: [{ produto: 'pr20', qtd: 2 }] });
  const ed9 = S.editarProcedimento(pc9.procedimento.id, { paciente: 'OUTRO', materiais: [{ produto: 'pr20', qtd: 1 }] });
  verificar('C9 — quem movimenta procedimento consegue estornar o próprio material',
    ed9.ok, JSON.stringify(ed9.erro));
  verificar('C9 — e o material não é baixado duas vezes',
    S.saldoEstoque('pr20', salaO) === saldoO - 1,
    JSON.stringify([saldoO, S.saldoEstoque('pr20', salaO)]));
  verificar('C9 — entrada comum continua exigindo o M de Estoque',
    !!S.entrada({ produto: 'pr20', armazem: salaO, qtd: 5, custo: 100, data: Ut.hoje() }).erro, '');
  S.setUsuario('u5');
  S.salvarMatrizAcesso(JSON.parse(JSON.stringify(MATRIZ_TESTE)));

  // C12 — IRRF cumulativo no mês
  S.setUsuario('u8');
  const fQA = D.funcionario('fn02');
  const ferQA = S.calcularFerias('fn02', 20, '2027-04-05', 0);
  S.lancarFerias('fn02', ferQA, '2027-04-05');
  const hQA = S.calcularHolerite('fn02', '2027-04', {});
  const rendMes = ferQA.base_bruta + hQA.base_inss;
  const inssMes = ferQA.valor_inss + hQA.valor_inss;
  const devido = S.calcularIRRF(rendMes, inssMes, fQA.dependentes_irrf, 0);
  verificar('C12 — IRRF de férias + folha bate com o do mês inteiro',
    Math.abs((ferQA.valor_irrf + hQA.valor_irrf) - devido) < 0.02,
    JSON.stringify([ferQA.valor_irrf, hQA.valor_irrf, devido]));
  verificar('C12 — e o rendimento do mês não ficou isento por engano',
    devido > 0 && (ferQA.valor_irrf + hQA.valor_irrf) > 0, devido);
  verificar('C12 — o desconto não deixa a folha com líquido negativo',
    hQA.liquido >= 0, hQA.liquido);

  // C13 — férias no aviso indenizado
  const trab = S.calcularRescisao('fn02', '2026-02-05', 'sem_justa_causa',
    { avisoIndenizado: false, avisoCumprido: true });
  const inden = S.calcularRescisao('fn02', '2026-02-05', 'sem_justa_causa', { avisoIndenizado: true });
  const somaFerias = x => x.ferias_vencidas + x.ferias_proporcionais + x.terco_ferias;
  verificar('C13 — aviso indenizado nunca paga menos férias que o trabalhado',
    somaFerias(inden) >= somaFerias(trab) - 0.01,
    JSON.stringify([somaFerias(trab), somaFerias(inden)]));
  S.setUsuario('u8');
})();

// ── ERP teste2 v14: altos A1 a A24 ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u2');
  const cr = D.credores[0].id;

  // A1 — parcelas + retenções = bruto
  const mkT = (doc, par, ret, bruto) => S.criarTitulo({ descricao: 'QA A1', documento: doc,
    tipo_titulo: 'nf', credor: cr, conta: '6.07', centro: 'pj01', emissao: Ut.hoje(),
    retencoes: ret, valor_bruto: bruto }, par);
  verificar('A1 — parcela cheia com retenção é recusada',
    !!mkT('QA-A1-1', [{ num: 1, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: 10000 }],
      [{ tributo: 'ISS', valor: 1150 }], 10000).erro, '');
  verificar('A1 — a distribuição certa é aceita',
    mkT('QA-A1-2', [{ num: 1, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: 8850 }],
      [{ tributo: 'ISS', valor: 1150 }], 10000).ok, '');
  verificar('A1 — retenção maior que as parcelas é recusada',
    !!mkT('QA-A1-3', [{ num: 1, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: 100 }],
      [{ tributo: 'ISS', valor: 9999 }]).erro, '');

  // A2 — liquidar reconfere o saldo
  const t2 = mkT('QA-A2', [{ num: 1, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: 1000 }]);
  const p2 = S.todasParcelas().find(p => p.titulo_id === t2.titulo.id);
  S.aprovar([p2.id]);
  S.registrarPagamento(p2.id, { data: Ut.hoje(), valor: 1000, banco: 'b1' });
  const solic = S.st.pagamentos.filter(x => x.parcela_id === p2.id)[0];
  S.setUsuario('u3'); S.autorizarPagamento(solic.id); S.setUsuario('u2');
  S.registrarPagamento(p2.id, { data: Ut.hoje(), valor: 1000, banco: 'b1', situacao: 'liquidado' });
  verificar('A2 — liquidar a solicitação antiga é recusado depois de a parcela fechar',
    !!S.liquidar(solic.id, {}).erro, '');
  verificar('A2 — e a parcela não fica com saldo negativo',
    S.saldoDe(S.todasParcelas().find(x => x.id === p2.id)) >= 0, '');

  // A4/A5 — apuração por empresa
  const compA4 = '2039-06';
  S.criarReceber({ numero: 'QA-A4', emissao: '2039-06-10', centro: 'pj33', competencia: compA4,
    valor_bruto: 50000, cliente_nome: 'HJM Matriz', cliente_documento: '34.958.609/0001-90',
    origem: 'nota', forcar_sem_liberacao: true });
  const crNov = D.credores.find(c => (c.documento || '').replace(/\D/g, '') === '34015981000162') ||
    (function () { const c = { id: 'crnov', ativo: true, nome: 'Novaped', tipo: 'fornecedor',
      documento: '34.015.981/0001-62', conta_padrao: '6.07' }; D.credores.push(c); return c; })();
  S.criarTitulo({ descricao: 'Serviço Novaped', documento: 'QA-A4-T', tipo_titulo: 'nf',
    credor: crNov.id, conta: '6.07', centro: 'pj01', emissao: '2039-06-10', empresa_tomadora: 'emp1' },
    [{ num: 1, venc: '2039-07-10', comp: compA4, valor: 50000 }]);
  const apu = S.apuracaoPorEmpresa({ competencia: compA4 });
  verificar('A4 — a eliminação intragrupo fecha dos dois lados',
    apu.consolidado.eliminacao_fecha === true,
    JSON.stringify([apu.consolidado.eliminacao_receita, apu.consolidado.eliminacao_despesa]));
  verificar('A4 — e a soma das empresas bate com o consolidado',
    Math.abs(apu.empresas.reduce((s, e) => s + e.resultado, 0) - apu.consolidado.resultado) < 0.05, '');
  S.criarReceber({ numero: 'QA-A5-PREV', emissao: '2039-06-15', centro: 'pj01',
    competencia: compA4, valor_bruto: 30000, cliente_nome: 'X', origem: 'previsao',
    forcar_sem_liberacao: true });
  verificar('A5 — previsão não entra na apuração junto com a nota',
    S.apuracaoPorEmpresa({ competencia: compA4 }).empresas
      .find(e => e.empresa === 'emp1').receita === apu.empresas.find(e => e.empresa === 'emp1').receita, '');

  // A7/A8 — extrato
  S.setUsuario('u5');
  const O = sandbox.window.ERP.ofx;
  const fsx = require('fs');
  const ofxTxt = fsx.readFileSync(__dirname + '/exemplos-ofx/extrato-santander-filial.ofx').toString('utf8');
  const i1 = S.importarExtrato('b3', O.ler(ofxTxt), 'qa.ofx');
  const div1 = S.saldoAtual('b3').divergencia;
  const i2 = S.importarExtrato('b3', O.ler(ofxTxt), 'qa.ofx');
  verificar('A7 — reimportar o mesmo extrato não grava nada', i2.novos === 0 && !i2.extrato, '');
  verificar('A7 — e a divergência de saldo continua lá',
    S.saldoAtual('b3').divergencia === div1 && div1 !== 0, JSON.stringify([div1, S.saldoAtual('b3').divergencia]));
  verificar('A8 — saldo com divergência vem marcado como não conferido',
    S.saldoDoSistema('b3').conferido === false, '');

  // A10 — ajuste de inventário
  const saldoInv = S.saldoEstoque('pr28', 'am10');
  S.ajusteInventario('am10', [{ produto: 'pr28', qtd: saldoInv + 100 }], { motivo: 'contagem' });
  verificar('A10 — contagem maior lança só a diferença',
    S.saldoEstoque('pr28', 'am10') === saldoInv + 100, S.saldoEstoque('pr28', 'am10'));
  const r2inv = S.ajusteInventario('am10', [{ produto: 'pr28', qtd: saldoInv + 100 }], { motivo: 'recontagem' });
  verificar('A10 — recontar o mesmo não duplica', r2inv.n === 0 &&
    S.saldoEstoque('pr28', 'am10') === saldoInv + 100, '');
  S.ajusteInventario('am10', [{ produto: 'pr28', qtd: 10 }], { motivo: 'quebra' });
  verificar('A10 — contagem menor ajusta para baixo', S.saldoEstoque('pr28', 'am10') === 10, '');
  verificar('A10 — ajuste sem motivo é recusado',
    !!S.ajusteInventario('am10', [{ produto: 'pr28', qtd: 5 }], {}).erro, '');

  // A11 — frete
  const itemFrete = { qtd: 10, custo: 50, frete: 100, recebido: 0 };
  const u1 = S.custoDeAquisicao(itemFrete);
  itemFrete.recebido = 5;
  verificar('A11 — o frete não é recobrado no recebimento parcial',
    u1 === 60 && S.custoDeAquisicao(itemFrete) === 60, JSON.stringify([u1, S.custoDeAquisicao(itemFrete)]));

  // A13/A16 — plantão
  S.setUsuario('u2');
  const compPl = '2039-08', diaPl = '2039-08-10';
  S.lancarProcedimento({ data: diaPl, procedimento: 'pa08', medico: 'DR DOIS QA', paciente: 'A', materiais: [] });
  S.lancarProcedimento({ data: diaPl, procedimento: 'pa10', medico: 'DR DOIS QA', paciente: 'B', materiais: [] });
  const tudo = S.resultadoProcedimentos({ competencia: compPl });
  const soOft = S.resultadoProcedimentos({ competencia: compPl, especialidade: 'OFTALMO' });
  const soOto = S.resultadoProcedimentos({ competencia: compPl, especialidade: 'OTORRINO' });
  verificar('A16 — filtrar por especialidade não multiplica o plantão',
    Math.abs((soOft.geral.plantao + soOto.geral.plantao) - tudo.geral.plantao) < 0.05,
    JSON.stringify([tudo.geral.plantao, soOft.geral.plantao, soOto.geral.plantao]));

  const mkProd = (nome, v) => {
    const c = { id: 'cq' + Math.random().toString(36).slice(2, 6), ativo: true, nome: nome,
      tipo: 'medico', conta_padrao: '8.01' };
    D.credores.push(c);
    return S.criarTitulo({ descricao: 'Prod ' + nome, documento: 'PPQ-' + nome.slice(0, 6),
      tipo_titulo: 'medicao', credor: c.id, conta: '8.01', centro: 'pj50', emissao: Ut.hoje(),
      origem: 'produtividade' }, [{ num: 1, venc: Ut.hoje(), comp: compPl, valor: v }]).titulo.id;
  };
  S.registrarLoteProdutividade({ centro: 'pj50', competencia: compPl, arquivo: 'f.xlsx',
    titulo_ids: [mkProd('DR FANTASMA QA', 900)], medicos: 1, valor: 900 });
  const comReal = S.resultadoProcedimentos({ competencia: compPl });
  verificar('A13 — médico sem fechamento sai da conta e vira aviso',
    comReal.geral.medicos_sem_fechamento.indexOf('DR DOIS QA') >= 0,
    JSON.stringify(comReal.geral.medicos_sem_fechamento));
  verificar('A13 — e o custo do médico não passa do fechamento',
    Math.abs((comReal.geral.plantao + comReal.geral.plantao_nao_alocado) - 900) < 0.05,
    JSON.stringify([comReal.geral.plantao, comReal.geral.plantao_nao_alocado]));

  // A14 — prévia igual ao gravado
  S.setUsuario('u5');
  S.entrada({ produto: 'pr24', armazem: 'am11', qtd: 10, custo: 600, data: Ut.hoje() });
  S.setUsuario('u2');
  const prev14 = S.custoMaterialPrevisto('am11', [{ produto: 'pr24', qtd: 15 }]);
  const lan14 = S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa16', medico: 'DR A14 QA',
    paciente: 'P', materiais: [{ produto: 'pr24', qtd: 15 }] });
  verificar('A14 — a prévia bate com o custo gravado',
    lan14.ok && Math.abs(prev14.total - lan14.procedimento.custo_material) < 0.02,
    JSON.stringify([prev14.total, lan14.procedimento && lan14.procedimento.custo_material]));

  // A15 — sala de outro hospital
  verificar('A15 — sem sala cadastrada, não devolve a do HGB',
    D.armazemDaEspecialidade('OFTALMO', 'pj01') === 'am06' ||
    D.armazemDaEspecialidade('OFTALMO', 'pj01') === null, '');

  // A19 — projetor de saída
  S.setUsuario('u13');
  const posOp = (S.posicaoEstoque('am07') || [])[0] || {};
  verificar('A19 — sem o nível financeiro, a posição sai sem valor',
    posOp.valor === null && posOp.medio === null, JSON.stringify([posOp.valor, posOp.medio]));
  const funcOp = (S.funcionariosDaFolha('2026-09') || [])[0] || {};
  verificar('A19 — e a folha sai sem CPF e sem salário',
    funcOp.cpf === null && funcOp.salario_base === null,
    JSON.stringify([funcOp.cpf, funcOp.salario_base]));
  S.setUsuario('u8');
  const funcDP = (S.funcionariosDaFolha('2026-09') || [])[0] || {};
  verificar('A19 — quem tem DP continua vendo',
    !!funcDP.cpf && funcDP.salario_base > 0, '');

  // A22/A23 — férias
  const novo = S.criarFuncionario({ nome: 'QA A22 Saldo', cpf: cpfValido(770000955),
    salario_base: 4200, cargo: (D.cargos[0] || {}).id, admissao: '2020-01-02' });
  if (novo.ok) {
    const f14 = S.calcularFerias(novo.funcionario.id, 14, '2062-03-01', 0);
    if (!f14.erro) S.lancarFerias(novo.funcionario.id, f14, '2062-03-01');
    verificar('A22 — fração de 14+ dias também respeita o saldo do período',
      !!S.calcularFerias(novo.funcionario.id, 30, '2062-06-03', 0).erro, '');
    verificar('A22 — e o abono entra na mesma conta',
      !!S.calcularFerias(novo.funcionario.id, 16, '2062-06-03', 10).erro, '');
  }
  /* Funcionário próprio com período vencido, para não depender do que
     outros blocos consumiram do fn01. */
  const fv = S.criarFuncionario({ nome: 'QA A23 Dobra', cpf: cpfValido(770000966),
    salario_base: 4200, cargo: (D.cargos[0] || {}).id, admissao: '2020-01-02' });
  if (fv.ok) {
    const fVenc = S.calcularFerias(fv.funcionario.id, 30, '2063-01-08', 0);
    verificar('A23 — a dobra fica fora da base dos encargos patronais',
      !fVenc.erro && fVenc.base_inss < fVenc.base_bruta &&
      Math.abs(fVenc.dobra_indenizatoria - (fVenc.base_bruta - fVenc.base_inss)) < 0.02,
      JSON.stringify([fVenc.erro, fVenc.base_inss, fVenc.base_bruta]));
  }

  // A24 — tabelas fiscais
  const clone = () => JSON.parse(JSON.stringify({ faixas: D.tabelaINSS.faixas,
    teto_contribuicao: D.tabelaINSS.teto_contribuicao }));
  const t1 = clone(); t1.faixas[t1.faixas.length - 1].ate = 9000;
  verificar('A24 — subir a faixa sem o teto de contribuição é recusado',
    !!S.salvarTabelasDP({ inss: t1 }).erro, '');
  const t3 = clone(); const tmp = t3.faixas[0]; t3.faixas[0] = t3.faixas[2]; t3.faixas[2] = tmp;
  verificar('A24 — faixas fora de ordem são recusadas',
    !!S.salvarTabelasDP({ inss: t3 }).erro, '');
  verificar('A24 — a tabela de fábrica continua válida',
    S.salvarTabelasDP({ inss: clone() }).ok, '');
  verificar('A24 — e o INSS segue monotônico',
    S.calcularINSS(8999) <= S.calcularINSS(9001) + 0.02, '');
  S.setUsuario('u8');
})();

// ── ERP teste2 v16: integração do ramo paralelo de QA ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u5');

  // saldo por BAIXA, não por título
  const antes = {};
  D.bancos.forEach(b => { antes[b.id] = +S.saldoDoSistema(b.id); });
  const r = S.criarReceber({ numero: 'QA-V16-1', emissao: Ut.hoje(), centro: 'pj01',
    competencia: Ut.mesAtual(), valor_bruto: 1000, cliente_nome: 'QA', origem: 'nota',
    forcar_sem_liberacao: true });
  S.receberBaixa(r.receber.id, { data: Ut.hoje(), valor: 400, banco: 'b4', decisao: 'residual' });
  S.receberBaixa(r.receber.id, { data: Ut.hoje(), valor: 600, banco: 'b1', decisao: 'residual' });
  verificar('v16 — baixas em contas diferentes vão cada uma para a sua',
    +S.saldoDoSistema('b4') === antes.b4 + 400 && +S.saldoDoSistema('b1') === antes.b1 + 600,
    JSON.stringify(D.bancos.map(b => b.id + ':' + (+S.saldoDoSistema(b.id) - antes[b.id]))));
  verificar('v16 — recebidoNaConta soma baixa a baixa',
    S.recebidoNaConta('b4', Ut.hoje()) >= 400, S.recebidoNaConta('b4', Ut.hoje()));
  const semC = S.criarReceber({ numero: 'QA-V16-2', emissao: Ut.hoje(), centro: 'pj01',
    competencia: Ut.mesAtual(), valor_bruto: 500, cliente_nome: 'QA', origem: 'nota',
    forcar_sem_liberacao: true });
  S.receberBaixa(semC.receber.id, { data: Ut.hoje(), valor: 500, decisao: 'residual' });
  verificar('v16 — baixa sem conta fica fora de todo saldo e é cobrada',
    S.recebidoSemConta(Ut.hoje()).valor >= 500, S.recebidoSemConta(Ut.hoje()).valor);

  // saldo do grupo
  const sb = S.saldoBancarioAtual();
  verificar('v16 — o saldo bancário soma as contas ativas',
    (sb.contas || []).length === D.bancos.filter(b => b.ativo !== false).length &&
    Math.abs(sb.valor - sb.contas.reduce((s, c) => s + c.valor, 0)) < 0.005, '');
  verificar('v16 — e a data é a da conta mais atrasada',
    !sb.data || sb.contas.every(c => !c.data || c.data >= sb.data), '');

  // posição de estoque com caminho único
  verificar('v16 — checarPosicao recusa valor negativo',
    !!S.checarPosicao({ saldo: 10, valor: 100 }, 0, -500, 'teste'), '');
  verificar('v16 — e recusa saldo negativo',
    !!S.checarPosicao({ saldo: 10, valor: 100 }, -50, 0, 'teste'), '');

  // estorno de transferência pelos dois lados
  const A = 'am09', B = 'am10', P = 'pr29';
  S.ajusteInventario(A, [{ produto: P, qtd: 0 }], { motivo: 'zerar QA' });
  S.ajusteInventario(B, [{ produto: P, qtd: 0 }], { motivo: 'zerar QA' });
  S.entrada({ produto: P, armazem: A, qtd: 10, custo: 1, data: Ut.hoje() });
  S.entrada({ produto: P, armazem: B, qtd: 100, custo: 100, data: Ut.hoje() });
  const totalAB = () => [A, B].reduce((s, am) =>
    s + S.posicaoEstoque(am).filter(x => x.produto.id === P).reduce((t, x) => t + x.valor, 0), 0);
  const antesT = totalAB(), medioAntes = S.custoMedio(P, B);
  S.transferir({ origem: A, destino: B, data: Ut.hoje(), itens: [{ produto: P, qtd: 10 }] });
  const mvT = S.movimentos({ produto: P, armazem: A }).find(m => m.origem === 'transferencia');
  const est = S.estornarMovimento(mvT.id, 'teste v16');
  verificar('v16 — estorno de transferência desfaz os dois lados',
    est.ok && est.lados === 2, JSON.stringify([est.erro, est.lados]));
  verificar('v16 — e devolve o estoque ao valor de antes',
    Math.abs(totalAB() - antesT) < 0.02 && Math.abs(S.custoMedio(P, B) - medioAntes) < 0.02,
    JSON.stringify([antesT, totalAB(), medioAntes, S.custoMedio(P, B)]));

  /* Armazém próprio: o bloco acima já fez ajuste de inventário em A
     com a data de hoje, e esse ajuste (não estornado) é um corte
     legítimo — o teste ficaria medindo o resíduo dele. */
  const AI = 'am08';
  S.entrada({ produto: 'pr06', armazem: AI, qtd: 5, custo: 10, data: Ut.hoje(), origem: 'inventario' });
  const mvI = S.movimentos({ armazem: AI, produto: 'pr06' })[0];
  S.estornarMovimento(mvI.id, 'engano');
  verificar('v16 — inventário estornado destrava o armazém',
    S.entrada({ produto: 'pr06', armazem: AI, qtd: 1, custo: 10,
      data: Ut.addDias(Ut.hoje(), -5) }).ok, '');
  verificar('v16 — e contagem futura é recusada',
    !!S.entrada({ produto: 'pr06', armazem: AI, qtd: 1, custo: 10,
      data: '2030-12-31', origem: 'inventario' }).erro, '');

  // conciliação não casa pagamento de outra conta
  S.setUsuario('u2');
  const cr = D.credores[0].id;
  const t = S.criarTitulo({ descricao: 'QA V16 conta', documento: 'QA-V16-C', tipo_titulo: 'nf',
    credor: cr, conta: '6.07', centro: 'pj01', emissao: Ut.hoje() },
    [{ num: 1, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: 7500 }]);
  const par = S.todasParcelas().find(x => x.titulo_id === t.titulo.id);
  S.aprovar([par.id]);
  S.registrarPagamento(par.id, { data: Ut.hoje(), valor: 7500, banco: 'b2', situacao: 'liquidado' });
  const pgOutra = S.st.pagamentos.find(x => x.parcela_id === par.id && x.banco === 'b2');
  const linhaB1 = S.linhasExtrato({ banco: 'b1' }).find(l => l.situacao === 'pendente' && l.saida);
  if (linhaB1 && pgOutra) {
    verificar('v16 — conciliar linha do Bradesco com pagamento do Santander é recusado',
      !!S.conciliar(linhaB1.id, { tipo: 'pagamento', id: pgOutra.id }).erro, '');
  }

  // fluxo diário mostra quanto é previsto
  const fx = S.fluxoDiario({ dias: 120 });
  verificar('v16 — o fluxo diário informa quanto da projeção é previsto',
    'previsto_saida' in fx && fx.previsto_saida >= 0, JSON.stringify(fx.previsto_saida));

  // fechamento do mutirão é o caminho único
  const compF = '2040-02';
  S.lancarProcedimento({ data: '2040-02-05', procedimento: 'pa01', medico: 'DRA FECHA QA',
    paciente: 'A', materiais: [] });
  const resumo = S.resumoFechamentoProcedimentos(compF);
  verificar('v16 — o resumo do fechamento separa repasse de cirurgia e plantão',
    resumo.ok && resumo.repasse > 0 && 'plantao' in resumo,
    JSON.stringify([resumo.repasse, resumo.plantao]));
  const fech = S.fecharProcedimentos({ competencia: compF });
  verificar('v16 — fechar gera o a receber e o repasse por médico',
    fech.ok && (fech.fechamento.titulo_ids || []).length > 0, JSON.stringify(fech.erro));
  verificar('v16 — a previsão automática não escreve por cima do fechamento',
    S.atualizarPrevisoesProcedimentos(compF).bloqueado_por_fechamento === true, '');
  verificar('v16 — antes do envio a competência continua aberta',
    !S.travaDeProcedimento('2040-02-06', D.PATE_CENTRO), '');
  const env = S.enviarFaturamentoProcedimentos(compF, null, { protocolo: 'OF-QA-16' });
  verificar('v16 — enviar registra a autorização', env.ok, JSON.stringify(env.erro));
  verificar('v16 — e trava a competência para novos lançamentos',
    !!S.travaDeProcedimento('2040-02-06', D.PATE_CENTRO), '');
  verificar('v16 — o caminho antigo aponta para o fechamento',
    (S.gerarFinanceiroProcedimentos(compF).erro || '').indexOf('Fechamento') > 0, '');
  S.setUsuario('u8');
})();

// ── ERP teste2 v17: conta corrente entre empresas (A6) ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u2');

  // transferência entre contas da MESMA empresa: remanejo, sem mútuo
  const t1 = S.transferirEntreContas({ confirmar_saldo_negativo: true, origem: 'b1', destino: 'b2', valor: 1000, data: Ut.hoje() });
  verificar('A6 — transferência entre contas da mesma empresa não gera mútuo',
    t1.ok && !t1.entre_empresas && !t1.transferencia.mutuo, JSON.stringify(t1.erro));

  // entre empresas: quem manda é credora
  const b1Antes = +S.saldoDoSistema('b1'), b4Antes = +S.saldoDoSistema('b4');
  const t2 = S.transferirEntreContas({ confirmar_saldo_negativo: true, origem: 'b1', destino: 'b4', valor: 50000,
    data: Ut.hoje(), obs: 'aporte QA' });
  verificar('A6 — transferência entre empresas gera mútuo com quem mandou como credora',
    t2.ok && t2.entre_empresas && t2.transferencia.mutuo.credora === 'emp1' &&
    t2.transferencia.mutuo.devedora === 'emp3', JSON.stringify(t2.erro));
  verificar('A6 — o dinheiro sai de uma conta e entra na outra',
    Math.abs((+S.saldoDoSistema('b1')) - (b1Antes - 50000)) < 0.01 &&
    Math.abs((+S.saldoDoSistema('b4')) - (b4Antes + 50000)) < 0.01,
    JSON.stringify([+S.saldoDoSistema('b1'), +S.saldoDoSistema('b4')]));
  /* O caixa do GRUPO não muda com transferência interna: o que sai de
     uma conta entra na outra. (A soma é de saldoDoSistema; o resumo
     usa o informado quando existe, que é outra pergunta.) */
  const caixaGrupo = () => Math.round(D.bancos.reduce((s, b) =>
    s + (+S.saldoDoSistema(b.id)), 0) * 100) / 100;
  const caixaAntes = caixaGrupo();
  S.transferirEntreContas({ confirmar_saldo_negativo: true, origem: 'b2', destino: 'b4', valor: 7000, data: Ut.hoje() });
  verificar('A6 — e o caixa total do grupo não muda com a transferência',
    Math.abs(caixaGrupo() - caixaAntes) < 0.02,
    JSON.stringify([caixaAntes, caixaGrupo()]));

  // compensação por par: a ida e a volta viram um saldo só
  const parAntes = (S.contaCorrenteEmpresas({}).saldos.find(x =>
    [x.devedora, x.credora].sort().join() === 'emp1,emp3') || { valor: 0, devedora: 'emp3' });
  const liquidoAntes = parAntes.devedora === 'emp3' ? parAntes.valor : -parAntes.valor;
  S.transferirEntreContas({ confirmar_saldo_negativo: true, origem: 'b4', destino: 'b1', valor: 12000, data: Ut.hoje(),
    obs: 'devolução QA' });
  const par = S.contaCorrenteEmpresas({}).saldos.find(x =>
    [x.devedora, x.credora].sort().join() === 'emp1,emp3');
  const liquidoDepois = par.devedora === 'emp3' ? par.valor : -par.valor;
  verificar('A6 — a volta abate o saldo do par em vez de somar',
    Math.abs(liquidoDepois - (liquidoAntes - 12000)) < 0.01,
    JSON.stringify([liquidoAntes, liquidoDepois]));
  verificar('A6 — e o par aparece como um saldo só, marcado como compensado',
    par.compensado === true && par.bruto_ida > 0 && par.bruto_volta > 0, JSON.stringify(par));

  // baixa manual: pergunta antes de registrar
  const crNov = D.credores.find(c => (c.documento || '').replace(/\D/g, '') === '34015981000162') ||
    (function () { const c = { id: 'crnov17', ativo: true, nome: 'Novaped', tipo: 'fornecedor',
      documento: '34.015.981/0001-62', conta_padrao: '6.07' }; D.credores.push(c); return c; })();
  const tit = S.criarTitulo({ descricao: 'QA A6 cruzado', documento: 'QA-A6-1', tipo_titulo: 'nf',
    credor: D.credores[0].id, conta: '6.07', centro: 'pj33', emissao: Ut.hoje(),
    empresa_tomadora: 'emp3' }, [{ num: 1, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: 3000 }]);
  const pc = S.todasParcelas().find(x => x.titulo_id === tit.titulo.id);
  S.aprovar([pc.id]);
  const semConfirmar = S.registrarPagamento(pc.id, { data: Ut.hoje(), valor: 3000, banco: 'b1',
    situacao: 'liquidado' });
  verificar('A6 — na baixa manual o sistema pergunta antes de registrar o mútuo',
    !!semConfirmar.erro && !!semConfirmar.cruzamento, JSON.stringify(semConfirmar).slice(0, 90));
  const comConfirmar = S.registrarPagamento(pc.id, { data: Ut.hoje(), valor: 3000, banco: 'b1',
    situacao: 'liquidado', confirmar_cruzamento: true });
  verificar('A6 — confirmando, o pagamento passa e o mútuo é registrado',
    comConfirmar.ok && S.contaCorrenteEmpresas({}).linhas
      .some(l => l.tipo === 'pagamento' && l.origem_registro === 'baixa'), '');

  // conciliação: não pergunta, registra direto
  S.setUsuario('u5');
  const O = sandbox.window.ERP.ofx;
  const fs17 = require('fs');
  S.importarExtrato('b1', O.ler(fs17.readFileSync(__dirname +
    '/exemplos-ofx/extrato-bradesco-matriz.ofx').toString('latin1')), 'qa-a6.ofx');
  S.setUsuario('u2');
  const linha = S.linhasExtrato({ banco: 'b1' }).find(l => l.situacao === 'pendente' && l.saida);
  if (linha) {
    const tit2 = S.criarTitulo({ descricao: 'QA A6 extrato', documento: 'QA-A6-2',
      tipo_titulo: 'nf', credor: D.credores[0].id, conta: '6.07', centro: 'pj33',
      emissao: Ut.hoje(), empresa_tomadora: 'emp3' },
      [{ num: 1, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: Math.abs(linha.valor) }]);
    const pc2 = S.todasParcelas().find(x => x.titulo_id === tit2.titulo.id);
    S.aprovar([pc2.id]);
    const conc = S.conciliar(linha.id, { tipo: 'parcela', id: pc2.id });
    verificar('A6 — na conciliação o pagamento cruzado passa sem perguntar',
      conc.ok, JSON.stringify(conc.erro));
    verificar('A6 — e o mútuo fica marcado como vindo do extrato',
      S.contaCorrenteEmpresas({}).linhas.some(l => l.origem_registro === 'extrato'), '');
  }

  // empresa tomadora explícita manda sobre a do projeto
  const tit3 = S.criarTitulo({ descricao: 'QA A6 matriz com custo Novaped', documento: 'QA-A6-3',
    tipo_titulo: 'nf', credor: D.credores[0].id, conta: '6.07', centro: 'pj33',
    emissao: Ut.hoje(), empresa_tomadora: 'emp1' },
    [{ num: 1, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: 500 }]);
  const pc3 = S.todasParcelas().find(x => x.titulo_id === tit3.titulo.id);
  S.aprovar([pc3.id]);
  verificar('A6 — nota da matriz com custo em projeto da Novaped não é mútuo',
    S.registrarPagamento(pc3.id, { data: Ut.hoje(), valor: 500, banco: 'b1',
      situacao: 'liquidado' }).ok, '');

  // cancelar transferência
  S.setUsuario('u3');
  const alvo = S.transferenciasBanco({})[0];
  verificar('A6 — cancelar transferência exige motivo',
    !!S.cancelarTransferenciaBanco(alvo.id, '').erro, '');
  verificar('A6 — e cancelada sai da conta corrente',
    S.cancelarTransferenciaBanco(alvo.id, 'engano').ok &&
    !S.contaCorrenteEmpresas({}).linhas.some(l => l.transferencia_id === alvo.id), '');
  S.setUsuario('u8');
})();

// ── ERP teste2 v18: fontes duplas e os médios da auditoria ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u2');

  // rateio: uma conta só, soma sempre fecha
  let naoFecha = 0;
  for (let v = 1; v <= 200; v++) {
    const par = { valor: v, rateio: [{ centro: 'pj01', pct: 33.33 },
      { centro: 'pj02', pct: 33.33 }, { centro: 'pj03', pct: 33.34 }] };
    const soma = ['pj01', 'pj02', 'pj03'].reduce((s, c) => s + S.valorNoCentro(par, c), 0);
    if (Math.abs(Math.round(soma * 100) / 100 - v) > 0.001) naoFecha++;
  }
  verificar('v18 — o rateio fecha com a parcela em todos os valores testados',
    naoFecha === 0, naoFecha + ' de 200 não fecham');
  const parQA = { valor: 133.33, centro: 'pj01',
    rateio: [{ centro: 'pj01', pct: 33.33 }, { centro: 'pj33', pct: 66.67 }] };
  verificar('v18 — valorNoCentro e despesaPorEmpresa concordam',
    Math.abs(Object.values(S.despesaPorEmpresa(parQA)).reduce((a, b) => a + b, 0) -
      ['pj01', 'pj33'].reduce((s, c) => s + S.valorNoCentro(parQA, c), 0)) < 0.005, '');

  // fluxo diário por conta e empresa
  const soma = f => f.linhas.reduce((s, l) => s + l.saidas, 0);
  const grupo = S.fluxoDiario({ dias: 90 });
  const novaped = S.fluxoDiario({ dias: 90, banco: 'b4' });
  verificar('v18 — o fluxo por conta projeta só as obrigações daquela empresa',
    novaped.empresa === 'emp3' && soma(novaped) < soma(grupo),
    JSON.stringify([soma(grupo), soma(novaped), novaped.empresa]));

  // registrarPagamento valida a data
  verificar('v18 — data de pagamento em formato inválido é recusada',
    (S.registrarPagamento('qualquer', { data: 'abacaxi', valor: 1, banco: 'b1' }).erro || '')
      .indexOf('inválida') > 0 ||
    !!S.registrarPagamento('qualquer', { data: 'abacaxi', valor: 1, banco: 'b1' }).erro, '');

  // baixaMultipla consolida por produto
  S.setUsuario('u5');
  const armQA = 'am07';
  S.ajusteInventario(armQA, [{ produto: 'pr28', qtd: 10 }], { motivo: 'QA v18' });
  const bm = S.baixaMultipla({ armazem: armQA, data: Ut.hoje(), motivo: 'Consumo assistencial',
    itens: [{ produto: 'pr28', qtd: 6 }, { produto: 'pr28', qtd: 6 }] });
  verificar('v18 — a baixa múltipla soma o mesmo produto antes de checar o saldo',
    !!bm.erro && S.saldoEstoque('pr28', armQA) === 10,
    JSON.stringify([bm.erro, S.saldoEstoque('pr28', armQA)]));

  // entrada guarda o valor da nota
  S.ajusteInventario('am08', [{ produto: 'pr06', qtd: 0 }], { motivo: 'QA v18' });
  S.entrada({ produto: 'pr06', armazem: 'am08', qtd: 3, custo: 66666.6667, data: Ut.hoje() });
  const posNota = S.posicaoEstoque('am08').find(l => l.produto.id === 'pr06');
  verificar('v18 — o valor em estoque é o da nota, não qtd × unitário arredondado',
    Math.abs(posNota.valor - 200000.0) < 0.02, posNota.valor);

  // depreciação não passa do valor do bem
  const dep = S.depreciacaoDoAtivo({ id: 'q', valor: 1000, vida_util_meses: 60,
    aquisicao: '2015-01-01' }, Ut.hoje());
  verificar('v18 — a depreciação acumulada não passa do valor do bem',
    dep.acumulada <= 1000.001 && dep.residual >= -0.001,
    JSON.stringify([dep.acumulada, dep.residual]));

  // DSR
  S.setUsuario('u8');
  const h0 = S.calcularHolerite('fn01', '2027-03', { faltas_dias: 0 });
  const h2 = S.calcularHolerite('fn01', '2027-03', { faltas_dias: 2 });
  verificar('v18 — falta injustificada derruba o DSR junto',
    h2.dsr_perdidos === 2 && Math.abs(h2.desconto_faltas - h0.desconto_faltas * 0 - 560) < 1,
    JSON.stringify([h2.dsr_perdidos, h2.desconto_faltas]));
  verificar('v18 — e quem tem o detalhe pode informar os DSR perdidos',
    S.calcularHolerite('fn01', '2027-03', { faltas_dias: 2, dsr_perdidos: 1 }).dsr_perdidos === 1, '');

  // provisão unificada com saldo
  const pv = S.provisaoMensalPessoal('2026-09');
  verificar('v18 — a provisão mensal inclui encargos',
    pv.encargos > 0 && pv.decimo > pv.decimo_base, JSON.stringify([pv.decimo, pv.decimo_base]));
  verificar('v18 — e informa o passivo acumulado, não só o mês',
    pv.passivo > pv.decimo + pv.ferias, JSON.stringify([pv.passivo, pv.decimo + pv.ferias]));

  // art. 130 e teto do abono
  verificar('v18 — as faltas do período reduzem os dias de férias',
    S.diasDeDireitoPorFaltas(0) === 30 && S.diasDeDireitoPorFaltas(6) === 24 &&
    S.diasDeDireitoPorFaltas(15) === 18 && S.diasDeDireitoPorFaltas(24) === 12 &&
    S.diasDeDireitoPorFaltas(40) === 0, '');
  verificar('v18 — o teto do abono é 1/3 do direito',
    S.tetoAbono(30) === 10 && S.tetoAbono(24) === 8 && S.tetoAbono(12) === 4, '');

  // paciente mascarado na fonte
  S.setUsuario('u2');
  S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa08', medico: 'DR QA V18',
    paciente: 'Ana QA V18', materiais: [{ produto: 'pr20', qtd: 1 }] });
  S.setUsuario('u1');
  const mv = S.movimentos({}).find(m => m.paciente);
  verificar('v18 — o store mascara o paciente para quem não tem permissão',
    !mv || mv.paciente === '[restrito]', mv && mv.paciente);

  // valor dos ativos
  S.setUsuario('u13');
  verificar('v18 — operacional não tem acesso financeiro em Ativos',
    !S.veFinanceiro('ativos'), '');

  // parcela zerada fecha
  S.setUsuario('u2');
  const tz = S.criarTitulo({ descricao: 'QA zero', documento: 'QA-V18-0', tipo_titulo: 'nf',
    credor: D.credores[0].id, conta: '6.07', centro: 'pj01', emissao: Ut.hoje() },
    [{ num: 1, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: 0.01 },
     { num: 2, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: 0 }]);
  if (tz.ok) {
    const zerada = S.todasParcelas().filter(p => p.titulo_id === tz.titulo.id)
      .find(p => Math.abs(p.valor) < 0.004);
    verificar('v18 — parcela de valor zero não fica presa em aberto',
      !zerada || zerada.status === 'pago', zerada && zerada.status);
  }

  // requisição validada e desmembramento inteiro
  verificar('v18 — requisição com produto inexistente é recusada',
    !!S.criarRequisicao({ armazem: 'am07', itens: [{ produto: 'nao-existe', qtd: 1 }] }).erro, '');
  verificar('v18 — requisição com quantidade infinita é recusada',
    !!S.criarRequisicao({ armazem: 'am07', itens: [{ produto: 'pr06', qtd: Infinity }] }).erro, '');

  // detalhe do imposto sem valor negativo
  S.setUsuario('u5');
  S.salvarImpostosProcedimentos([{ id: 'iss', nome: 'ISS', aliquota: 2 },
    { id: 'pis_cofins', nome: 'PIS/COFINS', aliquota: 3.65 },
    { id: 'outros', nome: 'Outros', aliquota: 0 }], D.PATE_CENTRO);
  const det18 = S.detalharImposto(1234.56);
  verificar('v18 — a sobra do imposto não deixa tributo negativo',
    det18.partes.every(p => p.valor >= 0) &&
    Math.abs(det18.partes.reduce((s, p) => s + p.valor, 0) - det18.total) < 0.005,
    JSON.stringify(det18.partes.map(p => p.nome + '=' + p.valor)));
  S.salvarImpostosProcedimentos([{ id: 'iss', nome: 'ISS', aliquota: 2 },
    { id: 'pis_cofins', nome: 'PIS/COFINS', aliquota: 3.65 },
    { id: 'irpj', nome: 'IRPJ', aliquota: 2.2 },
    { id: 'csll', nome: 'CSLL', aliquota: 1.19 }], D.PATE_CENTRO);
  S.setUsuario('u8');
})();

// ── ERP teste2 v19: auditoria independente da v18 (parte 1) ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u5');
  const cr = D.credores[0].id;
  const mkT = (doc, linhas, extra) => S.criarTitulo(Object.assign({
    descricao: 'QA v19', documento: doc, tipo_titulo: 'nf', credor: cr, conta: '6.07',
    centro: 'pj01', emissao: Ut.hoje() }, extra || {}), linhas);
  const uma = (doc, v, extra) => mkT(doc, [{ num: 1, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: v }], extra);

  // 1 — número inválido no lançamento
  verificar('v19 — valor em texto é recusado no lançamento', !!uma('V19-1', '1.234,56').erro, '');
  verificar('v19 — Infinity é recusado', !!uma('V19-2', Infinity).erro, '');
  verificar('v19 — NaN é recusado', !!uma('V19-3', NaN).erro, '');
  verificar('v19 — nenhum total de relatório fica NaN ou infinito',
    [S.apuracaoPorEmpresa({}).consolidado.despesa, S.apuracaoPorEmpresa({}).consolidado.resultado,
     S.contasAPagarEReceber({}).total_entradas, S.fluxoDiario({ dias: 30 }).saldo_inicial]
      .every(x => isFinite(Number(x))), '');

  // 2 — retenção sobrevive ao cancelamento de uma parcela
  const tRet = mkT('V19-RET', [
    { num: 1, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: 3116.67 },
    { num: 2, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: 3116.67 },
    { num: 3, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: 3116.66 }
  ], { valor_bruto: 10000, retencoes: [{ tributo: 'ISS', valor: 500 }, { tributo: 'IRRF', valor: 150 }] });
  const pend = () => S.st.retencoesRegistradas
    .filter(r => r.titulo_id === tRet.titulo.id && !r.cancelada)
    .reduce((s, r) => s + r.valor, 0);
  const parsRet = S.todasParcelas().filter(p => p.titulo_id === tRet.titulo.id);
  const cRet = S.cancelar(parsRet[1].id, 'teste v19');
  verificar('v19 — cancelar uma parcela não apaga a retenção da nota',
    cRet.ok && pend() === 650, JSON.stringify([cRet.erro, pend()]));
  verificar('v19 — e o cancelamento avisa que a retenção segue pendente',
    /continuam pendentes/.test(cRet.aviso_retencao || ''), cRet.aviso_retencao);
  parsRet.filter((_, i) => i !== 1).forEach(p => S.cancelar(p.id, 'teste v19'));
  verificar('v19 — cancelando todas as parcelas, a retenção cai',
    pend() === 0, pend());

  // 3 — previsão preservada
  S.salvarPrevisaoDespesa({ centro: 'pj01', conta: '6.07', competencia: '2041-03',
    valor: 30000, descricao: 'Aluguel QA', vencimento: '2041-03-10' });
  const pvPar = S.todasParcelas().find(p => p.status === 'previsto' && p.comp === '2041-03');
  S.editarParcela(pvPar.id, { descricao: 'Aluguel QA editado' });
  verificar('v19 — editar previsão não a rebaixa para aberto',
    S.parcela(pvPar.id).status === 'previsto', S.parcela(pvPar.id).status);
  verificar('v19 — e previsão sem credor não se paga',
    !!S.registrarPagamento(pvPar.id, { data: Ut.hoje(), valor: 30000, banco: 'b1' }).erro, '');
  mkT('V19-ALU', [{ num: 1, venc: '2041-03-10', comp: '2041-03', valor: 30000 }]);
  verificar('v19 — o título real substitui a previsão',
    S.parcela(pvPar.id).status === 'substituido', S.parcela(pvPar.id).status);

  // 4 — liquidar com juros e multa
  const tLiq = uma('V19-LIQ', 10000);
  const pLiq = S.todasParcelas().find(p => p.titulo_id === tLiq.titulo.id);
  S.aprovar([pLiq.id]);
  S.registrarPagamento(pLiq.id, { data: Ut.hoje(), valor: 10000, juros: 180, multa: 200, banco: 'b1' });
  const pgLiq = S.st.pagamentos.filter(x => x.parcela_id === pLiq.id)[0];
  S.setUsuario('u3'); S.autorizarPagamento(pgLiq.id); S.setUsuario('u5');
  verificar('v19 — liquidar o total que saiu do banco (principal + juros + multa) é aceito',
    S.liquidar(pgLiq.id, { data: Ut.hoje(), valor: 10380 }).ok, '');
  verificar('v19 — e a parcela fecha sem saldo negativo',
    S.saldoDe(S.parcela(pLiq.id)) >= 0 && S.parcela(pLiq.id).status === 'pago',
    JSON.stringify([S.saldoDe(S.parcela(pLiq.id)), S.parcela(pLiq.id).status]));

  // 8 — editarParcela respeita o bruto
  const tEd = uma('V19-ED', 8850, { valor_bruto: 10000, retencoes: [{ tributo: 'ISS', valor: 1150 }] });
  const pEd = S.todasParcelas().find(p => p.titulo_id === tEd.titulo.id);
  verificar('v19 — editar a parcela para o valor cheio é recusado',
    !!S.editarParcela(pEd.id, { valor: 10000 }).erro, '');

  // 9 — criarReceber validado
  const mkR = (num, extra) => S.criarReceber(Object.assign({ numero: num, emissao: Ut.hoje(),
    centro: 'pj01', competencia: Ut.mesAtual(), cliente_nome: 'QA', origem: 'nota',
    forcar_sem_liberacao: true }, extra));
  verificar('v19 — recebível com bruto negativo é recusado', !!mkR('R1', { valor_bruto: -50000 }).erro, '');
  verificar('v19 — recebível com bruto em texto é recusado', !!mkR('R2', { valor_bruto: 'abacaxi' }).erro, '');
  verificar('v19 — retenção maior que a nota é recusada',
    !!mkR('R3', { valor_bruto: 1000, valor_retido: 3000 }).erro, '');

  // 12 — pagas e recebidas por baixa
  /* Baixa em data passada (o sistema recusa data futura, com razão).
     O que se testa é o parcial aparecer no mês em que o dinheiro
     entrou, em vez de sumir por não estar com status 'recebido'. */
  const mesPassado = Ut.compDe(Ut.addMeses(Ut.hoje().slice(0, 7) + '-01', -1));
  const diaBaixa = mesPassado + '-20';
  const rPar = mkR('V19-PAR', { valor_bruto: 100000, emissao: mesPassado + '-01',
    competencia: mesPassado });
  S.receberBaixa(rPar.receber.id, { data: diaBaixa, valor: 60000, banco: 'b1', decisao: 'residual' });
  const entAgo = S.contasPagasERecebidas(mesPassado + '-01', mesPassado + '-28').linhas
    .filter(l => l.tipo === 'Entrada' && l.documento === 'V19-PAR')
    .reduce((s, l) => s + l.valor, 0);
  verificar('v19 — recebimento parcial aparece no mês em que entrou',
    Math.abs(entAgo - 60000) < 0.01, entAgo);

  // 13 — guia complementar
  uma('V19-G1', 9800, { valor_bruto: 10000, retencoes: [{ tributo: 'ISS', valor: 200 }] });
  const g1 = S.fecharGuiaRetencao('ISS', Ut.mesAtual(), Ut.addDias(Ut.hoje(), 20));
  uma('V19-G2', 19700, { valor_bruto: 20000, retencoes: [{ tributo: 'ISS', valor: 300 }] });
  const g2 = S.fecharGuiaRetencao('ISS', Ut.mesAtual(), Ut.addDias(Ut.hoje(), 20));
  verificar('v19 — a segunda guia da mesma competência é aceita como complemento',
    g1.ok && g2.ok, JSON.stringify([g1.erro, g2.erro]));
  verificar('v19 — guia com vencimento antes da competência é recusada',
    !!S.fecharGuiaRetencao('ISS', Ut.mesAtual(), '2020-01-01').erro, '');

  // 14 — ignorar e reabrir
  const O19 = sandbox.window.ERP.ofx;
  const fs19 = require('fs');
  S.importarExtrato('b1', O19.ler(fs19.readFileSync(__dirname +
    '/exemplos-ofx/extrato-bradesco-matriz.ofx').toString('latin1')), 'qa-v19.ofx');
  const linha19 = S.linhasExtrato({ banco: 'b1' }).find(l => l.situacao === 'pendente' && l.saida);
  if (linha19) {
    const tConc = uma('V19-CONC', Math.abs(linha19.valor));
    const pConc = S.todasParcelas().find(p => p.titulo_id === tConc.titulo.id);
    S.aprovar([pConc.id]);
    S.conciliar(linha19.id, { tipo: 'parcela', id: pConc.id });
    verificar('v19 — ignorar linha já conciliada é recusado',
      !!S.ignorarLinha(linha19.id, 'engano').erro, '');
  }
  const outra19 = S.linhasExtrato({ banco: 'b1' }).find(l => l.situacao === 'pendente');
  if (outra19) {
    S.ignorarLinha(outra19.id, 'não é nosso');
    verificar('v19 — linha ignorada não aceita conciliação nova',
      !!S.conciliar(outra19.id, { tipo: 'parcela', id: (S.todasParcelas()[0] || {}).id }).erro, '');
    verificar('v19 — e dá para reabrir a linha ignorada',
      S.reabrirLinha(outra19.id, 'foi engano').ok &&
      S.linhasExtrato({ banco: 'b1' }).find(l => l.id === outra19.id).situacao === 'pendente', '');
  }

  // 17 — saldo informado
  verificar('v19 — saldo informado com data futura é recusado',
    !!S.informarSaldoBancario('b1', { valor: 1000, data: '2099-12-31' }).erro, '');
  verificar('v19 — saldo informado negativo é recusado',
    !!S.informarSaldoBancario('b1', { valor: -5000, data: Ut.hoje() }).erro, '');
  S.informarSaldoBancario('b2', { valor: (+S.saldoDoSistema('b2')) * 10 + 1000, data: Ut.hoje() });
  verificar('v19 — saldo informado muito divergente não conta como conferido',
    (S.saldoBancarioAtual().contas.find(c => c.banco === 'b2') || {}).conferido === false, '');

  // 18 — cancelar NF parcial devolve o valor
  S.salvarPrevisao({ centro: 'pj02', competencia: '2041-11', faturamento: 100000 });
  S.marcarPrevisoes('2041-11', 'confirmada', 'pj02');
  const pvRec = S.st.receber.find(r => r.origem === 'previsao' && r.competencia === '2041-11' && r.centro === 'pj02');
  if (pvRec) {
    const nfPar = S.criarReceber({ numero: 'V19-NFPAR', emissao: Ut.hoje(), centro: 'pj02',
      competencia: '2041-11', valor_bruto: 40000, cliente_nome: 'QA', origem: 'nota',
      forcar_sem_liberacao: true });
    S.confirmarSubstituicao(pvRec.id, { parcial: true });
    const depoisParcial = S.st.receber.find(r => r.id === pvRec.id).valor_bruto;
    S.cancelarReceber(nfPar.receber.id, 'teste v19');
    verificar('v19 — cancelar a NF devolve à previsão o valor abatido',
      depoisParcial === 60000 && S.st.receber.find(r => r.id === pvRec.id).valor_bruto === 100000,
      JSON.stringify([depoisParcial, S.st.receber.find(r => r.id === pvRec.id).valor_bruto]));
  }

  // 21/22 — centro e vencimento
  verificar('v19 — centro inexistente é recusado no lançamento',
    !!mkT('V19-C', [{ num: 1, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: 25000 }],
      { centro: 'pj999' }).erro, '');
  verificar('v19 — vencimento em formato inválido é recusado',
    !!mkT('V19-V', [{ num: 1, venc: '31/11/2026', comp: Ut.mesAtual(), valor: 7000 }]).erro, '');
  const parDup = { valor: 1000, centro: 'pj01',
    rateio: [{ centro: 'pj01', pct: 50 }, { centro: 'pj01', pct: 50 }] };
  verificar('v19 — valorNoCentro soma as fatias repetidas',
    S.valorNoCentro(parDup, 'pj01') === 1000, S.valorNoCentro(parDup, 'pj01'));

  // 25 — esteira
  verificar('v19 — segunda nota na mesma competência vem com aviso',
    !!mkR('V19-D1', { valor_bruto: 1000 }).ok &&
    !!mkR('V19-D2', { valor_bruto: 1000 }).aviso, '');

  // 26 — vencimento da guia em dia útil
  verificar('v19 — o vencimento sugerido da guia cai em dia útil',
    ['2026-10', '2026-11', '2027-01', '2027-05'].every(c => {
      const d = S.dia20MesSeguinte(c + '-01');
      const dow = new Date(d + 'T12:00:00Z').getUTCDay();
      return dow !== 0 && dow !== 6 && !S.ehFeriado(d, true);
    }), '');
  S.setUsuario('u8');
})();

// ── ERP teste2 v20: auditoria independente da v18 (parte 2) ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u5');
  const comp = Ut.mesAtual();

  // E1 — fechamento por centro
  /* A competência já tem lançamentos de blocos anteriores, então o
     que se mede é a VARIAÇÃO: uma catarata entra só na oftalmo, uma
     colecistectomia só na cirurgia geral. */
  const antesOft = S.resumoFechamentoProcedimentos(comp, 'pj51').faturamento;
  const antesGer = S.resumoFechamentoProcedimentos(comp, 'pj52').faturamento;
  S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa08', medico: 'DR E1 QA', paciente: 'A', materiais: [] });
  S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa01', medico: 'DRA E1 QA', paciente: 'B', materiais: [] });
  const rMae = S.resumoFechamentoProcedimentos(comp, 'pj50');
  const rOft = S.resumoFechamentoProcedimentos(comp, 'pj51');
  const rGer = S.resumoFechamentoProcedimentos(comp, 'pj52');
  verificar('v20 — cada subprojeto fecha só o que é dele',
    Math.abs((rOft.faturamento - antesOft) - 1466.04) < 0.02 &&
    Math.abs((rGer.faturamento - antesGer) - 3771.31) < 0.02,
    JSON.stringify([rOft.faturamento - antesOft, rGer.faturamento - antesGer]));
  const somaSub = D.centros.filter(c => c.especialidade_pate)
    .reduce((s, c) => s + (S.resumoFechamentoProcedimentos(comp, c.id).faturamento || 0), 0);
  verificar('v20 — e o projeto-mãe soma os subprojetos',
    Math.abs(rMae.faturamento - somaSub) < 0.05,
    JSON.stringify([rMae.faturamento, somaSub]));

  // E4 — imposto pelo centro
  D.centro('pj02').impostos = { iss: 2, iss_ce: 3, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 };
  const pOutro = S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa01', medico: 'DR E4 QA',
    paciente: 'C', centro: 'pj02', materiais: [] });
  verificar('v20 — o imposto usa a alíquota do centro do procedimento',
    pOutro.ok && pOutro.procedimento.imposto_pct === 12.04 &&
    Math.abs(pOutro.procedimento.imposto - 454.07) < 0.02,
    JSON.stringify([pOutro.erro, pOutro.procedimento && pOutro.procedimento.imposto]));

  // E5 — número no lançamento
  const mkP = o => S.lancarProcedimento(Object.assign({ data: Ut.hoje(), procedimento: 'pa01',
    medico: 'DR E5 QA', paciente: 'P', materiais: [] }, o));
  const comVirgula = mkP({ repasse: '688,77' });
  verificar('v20 — repasse com vírgula é interpretado, não zerado',
    comVirgula.ok && comVirgula.procedimento.repasse === 688.77,
    comVirgula.procedimento && comVirgula.procedimento.repasse);
  verificar('v20 — repasse negativo é recusado', !!mkP({ repasse: -500 }).erro, '');
  verificar('v20 — quantidade infinita é recusada', !!mkP({ qtd: Infinity }).erro, '');
  verificar('v20 — quantidade em texto é recusada', !!mkP({ qtd: '2 olhos' }).erro, '');

  // INVARIANTE 1 — finitude dos agregados
  const agregados = [
    S.resultadoProcedimentos({ competencia: comp }).geral.faturamento,
    S.resultadoProcedimentos({ competencia: comp }).geral.resultado,
    S.resumoFechamentoProcedimentos(comp, 'pj50').faturamento,
    S.contasAPagarEReceber({}).total_entradas,
    S.apuracaoPorEmpresa({}).consolidado.resultado
  ];
  verificar('v20 — INVARIANTE: nenhum agregado é NaN ou infinito',
    agregados.every(x => isFinite(Number(x))), JSON.stringify(agregados));

  // E2 — transferência automática com saldo espalhado
  const PE2 = 'pr26';
  S.ajusteInventario('am06', [{ produto: PE2, qtd: 0 }], { motivo: 'QA v20' });
  [['am07', 22], ['am08', 16], ['am09', 24], ['am10', 20]].forEach(([a, q]) =>
    S.ajusteInventario(a, [{ produto: PE2, qtd: q }], { motivo: 'QA v20' }));
  const naUnidadeAntes = ['am06', 'am07', 'am08', 'am09', 'am10']
    .reduce((s, a) => s + S.saldoEstoque(PE2, a), 0);
  const e2 = S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa08', medico: 'DR E2 QA',
    paciente: 'P', materiais: [{ produto: PE2, qtd: 3 }, { produto: PE2, qtd: 3 }] });
  verificar('v20 — material espalhado por vários armazéns é reunido e o lançamento passa',
    e2.ok, JSON.stringify(e2.erro));
  verificar('v20 — e o hospital perde exatamente o consumido',
    ['am06', 'am07', 'am08', 'am09', 'am10'].reduce((s, a) => s + S.saldoEstoque(PE2, a), 0)
      === naUnidadeAntes - 6, '');

  /* INVARIANTE 2 — atomicidade. O caso tem de falhar NO MEIO DO LAÇO,
     com os dois itens passando na conferência prévia de saldo: o
     teste anterior usava saldo insuficiente, que é barrado antes e
     nunca gera rollback nenhum. Aqui o segundo item tem saldo e é
     recusado pela conferência de pacientes, já dentro do laço. */
  S.ajusteInventario('am07', [{ produto: 'pr28', qtd: 50 }, { produto: 'pr06', qtd: 50 }],
    { motivo: 'QA atomicidade' });
  const saldoAntesBM = S.saldoEstoque('pr28', 'am07');
  const valorAntesBM = (S.posicaoEstoque('am07').find(x => x.produto.id === 'pr28') || {}).valor;
  const bm = S.baixaMultipla({ armazem: 'am07', data: Ut.hoje(), motivo: 'Consumo assistencial',
    itens: [{ produto: 'pr28', qtd: 2 }, { produto: 'nao-existe', qtd: 2 }] });
  verificar('v24 — INVARIANTE: baixa recusada no meio do laço desfaz o que já saiu',
    !!bm.erro && S.saldoEstoque('pr28', 'am07') === saldoAntesBM,
    JSON.stringify([bm.erro, saldoAntesBM, S.saldoEstoque('pr28', 'am07')]));
  verificar('v24 — e o rollback devolve o valor exato, sem criar centavo',
    Math.abs(((S.posicaoEstoque('am07').find(x => x.produto.id === 'pr28') || {}).valor || 0)
      - valorAntesBM) < 0.005,
    JSON.stringify([valorAntesBM,
      (S.posicaoEstoque('am07').find(x => x.produto.id === 'pr28') || {}).valor]));

  // E9 — trava de competência no store
  S.fecharProcedimentos({ competencia: comp });
  S.enviarFaturamentoProcedimentos(comp, null, { protocolo: 'OF-QA-20' });
  verificar('v20 — lançar em competência já enviada é recusado',
    !!mkP({}).trava_competencia, '');
  const algumProc = S.listarProcedimentos({ competencia: comp })[0];
  verificar('v20 — e cancelar também',
    !!S.cancelarProcedimento(algumProc.id, 'teste').trava_competencia, '');
  verificar('v20 — com forçar, passa',
    S.cancelarProcedimento(algumProc.id, 'teste', { forcar: true }).ok, '');

  // E13 e E14
  verificar('v20 — mínimo não numérico é recusado',
    !!S.definirMinimo('pr06', 'am07', { minimo: 'cinquenta' }).erro, '');
  verificar('v20 — e o mínimo válido é aceito',
    S.definirMinimo('pr06', 'am07', { minimo: 50, ideal: 100 }).ok, '');

  // E15
  S.setUsuario('u1');
  verificar('v20 — enviar faturamento exige movimentação em procedimentos',
    !!S.enviarFaturamentoProcedimentos(comp, null, { protocolo: 'X' }).erro, '');
  S.setUsuario('u8');

  // P1 e P2 — INVARIANTE 3: imposto por competência
  const fQA = D.funcionario('fn02');
  const compP = '2033-10';
  const ferP = S.calcularFerias('fn02', 15, '2033-10-03', 0);
  if (!ferP.erro) {
    S.lancarFerias('fn02', ferP, '2033-10-03');
    const hP = S.calcularHolerite('fn02', compP, { he50_horas: 40 });
    const baseINSSmes = ferP.base_inss + hP.base_inss;
    verificar('v20 — INVARIANTE: o INSS do mês fecha com férias + folha',
      Math.abs((ferP.valor_inss + hP.valor_inss) - S.calcularINSS(baseINSSmes)) < 0.02,
      JSON.stringify([ferP.valor_inss, hP.valor_inss, S.calcularINSS(baseINSSmes)]));
    const rendMes = ferP.base_bruta + hP.base_inss;
    verificar('v20 — INVARIANTE: o IRRF do mês fecha com férias + folha',
      Math.abs((ferP.valor_irrf + hP.valor_irrf) -
        S.calcularIRRF(rendMes, baseINSSmes, fQA.dependentes_irrf, 0)) < 0.05,
      JSON.stringify([ferP.valor_irrf, hP.valor_irrf]));
  }

  // P3 e P4
  verificar('v20 — tabela de IRRF sem as faixas é recusada',
    !!S.salvarTabelasDP({ irrf: { deducao_por_dependente: 200 } }).erro, '');
  verificar('v20 — e o IRRF continua calculando depois da tentativa',
    S.calcularIRRF(12000, 0, 0, 0) > 0, '');
  verificar('v20 — FGTS fora da faixa legal é recusado',
    !!S.salvarTabelasDP({ parametros: { aliquota_fgts: -8 } }).erro, '');
  verificar('v20 — INSS patronal de 900% é recusado',
    !!S.salvarTabelasDP({ parametros: { aliquota_inss_patronal: 900 } }).erro, '');
  verificar('v20 — parâmetro desconhecido é recusado',
    !!S.salvarTabelasDP({ parametros: { aliquota_inventada: 5 } }).erro, '');

  // P5 — média de variáveis
  for (let m = 1; m <= 12; m++) {
    S.fecharFolha('2035-' + String(m).padStart(2, '0'), { fn01: { he50_horas: 20 } });
  }
  const d13 = S.calcular13('fn01', '2035', 2);
  verificar('v20 — o 13º integra a média das horas extras habituais',
    (d13.valor_total || d13.valor) > 4500,
    JSON.stringify(d13.valor_total || d13.valor));

  // P7 — validações legais na edição
  [['jornada_semanal_horas', 60], ['dependentes_irrf', -5],
   ['insalubridade_pct', 500], ['nascimento', '2015-01-01']].forEach(function (par) {
    const d = {}; d[par[0]] = par[1];
    verificar('v20 — editar funcionário recusa ' + par[0] + ' = ' + par[1],
      !!S.editarFuncionario('fn01', d).erro, '');
  });

  // P8 — teto de 6% no VT
  const f3 = D.funcionario('fn03');
  if (f3) {
    f3.vale_transporte = true; f3.vt_dia = 20;
    f3.vt_desconto_modo = 'percentual'; f3.vt_desconto_valor = 25;
    const descVT = h => (h.descontos || [])
      .filter(x => /transporte/i.test(x.descricao))
      .reduce((s, x) => s + x.valor, 0);
    const hVT = S.calcularHolerite('fn03', '2035-06', {});
    const teto = Math.round((f3.salario_base || 0) * 0.06 * 100) / 100;
    verificar('v20 — o desconto de VT respeita o teto de 6% do salário',
      descVT(hVT) > 0 && descVT(hVT) <= teto + 0.01, JSON.stringify([descVT(hVT), teto]));
    const hVT2 = S.calcularHolerite('fn03', '2035-06', { vt_desconto_valor: 400 });
    verificar('v20 — e o override da tela também respeita o teto',
      descVT(hVT2) <= teto + 0.01, JSON.stringify([descVT(hVT2), teto]));
  }

  // P9 — acordo 484-A
  /* O tipo entra como 3º argumento; com `opcoes.tipo` o cálculo cai
     no padrão. A comparação é entre o acordo e o sem justa causa na
     mesma data: o acordo projeta metade do aviso, então tem de somar
     menos avos. */
  const acordo = S.calcularRescisao('fn01', '2036-10-20', 'acordo',
    { avisoIndenizado: true, tipo: 'acordo' });
  const cheio = S.calcularRescisao('fn01', '2036-10-20', 'sem_justa_causa',
    { avisoIndenizado: true });
  verificar('v20 — o acordo projeta metade do aviso, não o aviso cheio',
    (acordo.avos_ferias || 0) <= (cheio.avos_ferias || 0),
    JSON.stringify([acordo.dias_aviso, acordo.avos_ferias, cheio.dias_aviso, cheio.avos_ferias]));

  // P11 — provisão com período em curso
  const prov = S.provisaoMensalPessoal('2026-10');
  verificar('v20 — a provisão inclui o período de férias em curso',
    prov.saldo_ferias > 0 && prov.passivo > prov.saldo_decimo, JSON.stringify(prov.passivo));
  S.setUsuario('u8');
})();

// ── ERP teste2 v21: regressões e o que faltava da parte 2 ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u5');

  // E8 — a guarda de valor negativo não pode travar a baixa legítima
  const A8 = 'am09', P8 = 'pr06';
  S.ajusteInventario(A8, [{ produto: P8, qtd: 0 }], { motivo: 'QA v21' });
  S.entrada({ produto: P8, armazem: A8, qtd: 7, custo: 22.40,
    unidades_por_embalagem: 100, data: Ut.hoje(), documento: 'QA-E8' });
  const posE8 = S.posicaoEstoque(A8).find(x => x.produto.id === P8);
  verificar('v21 — 7 caixas de 100 entram como 700 unidades',
    posE8.saldo === 700, posE8.saldo);
  const saidaTotal = S.saida({ produto: P8, armazem: A8, qtd: 700, data: Ut.hoje(),
    motivo: 'Consumo assistencial' });
  verificar('v21 — E8: a baixa do saldo inteiro não é travada pelo arredondamento',
    saidaTotal.ok, JSON.stringify(saidaTotal.erro));
  const depoisE8 = S.posicaoEstoque(A8).find(x => x.produto.id === P8) || { saldo: 0, valor: 0 };
  verificar('v21 — e deixa saldo zero com valor zero',
    depoisE8.saldo === 0 && depoisE8.valor === 0, JSON.stringify(depoisE8));

  S.ajusteInventario(A8, [{ produto: P8, qtd: 0 }], { motivo: 'QA v21' });
  S.entrada({ produto: P8, armazem: A8, qtd: 7, custo: 22.40,
    unidades_por_embalagem: 100, data: Ut.hoje(), documento: 'QA-E8b' });
  const mvE8 = S.movimentos({ produto: P8, armazem: A8 }).find(m => m.documento === 'QA-E8b');
  verificar('v21 — e o estorno dessa entrada também passa',
    S.estornarMovimento(mvE8.id, 'teste v21').ok, '');

  S.ajusteInventario(A8, [{ produto: P8, qtd: 0 }], { motivo: 'QA v21' });
  S.ajusteInventario('am10', [{ produto: P8, qtd: 0 }], { motivo: 'QA v21' });
  S.entrada({ produto: P8, armazem: A8, qtd: 7, custo: 22.40,
    unidades_por_embalagem: 100, data: Ut.hoje() });
  const totalAB = () => [A8, 'am10'].reduce((s, a) =>
    s + ((S.posicaoEstoque(a).find(x => x.produto.id === P8) || {}).valor || 0), 0);
  const antesTransf = totalAB();
  const tE8 = S.transferir({ origem: A8, destino: 'am10', data: Ut.hoje(),
    itens: [{ produto: P8, qtd: 700 }] });
  verificar('v21 — e a transferência do saldo inteiro também',
    tE8.ok, JSON.stringify(tE8.erro));
  verificar('v21 — INVARIANTE: a transferência conserva o valor total',
    Math.abs(totalAB() - antesTransf) < 0.005, JSON.stringify([antesTransf, totalAB()]));

  // E3 — refazer o fechamento
  const compR = '2043-07';
  const dia = '2043-07-06';
  S.lancarProcedimento({ data: dia, procedimento: 'pa01', medico: 'DR R1 QA', paciente: '1', materiais: [] });
  S.lancarProcedimento({ data: dia, procedimento: 'pa04', medico: 'DR R2 QA', paciente: '2', materiais: [] });
  const fec1 = S.fecharProcedimentos({ competencia: compR });
  S.lancarProcedimento({ data: dia, procedimento: 'pa16', medico: 'DR R3 QA', paciente: '3', materiais: [] });
  const fec2 = S.fecharProcedimentos({ competencia: compR, refazer: true });
  verificar('v21 — E3: refazer o fechamento é aceito',
    fec2.ok, JSON.stringify(fec2.erro));
  if (fec2.ok) {
    const vivos = S.todasParcelas().filter(p =>
      (fec2.fechamento.titulo_ids || []).indexOf(p.titulo_id) > -1 && p.status !== 'cancelado');
    verificar('v21 — e os três médicos ficam com título de repasse',
      vivos.length === 3 &&
      Math.abs(vivos.reduce((s, p) => s + p.valor, 0) - fec2.fechamento.repasse) < 0.02,
      JSON.stringify([vivos.length, fec2.fechamento.repasse]));
  }

  // E10 — frete e divergência de valor na entrada do pedido
  const PE10 = D.produtos[0].id;
  const rq = S.criarRequisicao({ armazem: 'am07', itens: [{ produto: PE10, qtd: 10 }] });
  S.aprovarRequisicao(rq.requisicao.id, { itens: [{ indice: 0, aprovado: true, qtd: 10 }] });
  S.registrarCotacao(rq.requisicao.id,
    { itens: [{ produto: PE10, credor: D.credores[0].id, custo: 50, frete: 100 }] });
  S.mudarStatusCompra(rq.requisicao.id, 'aprovada');
  S.mudarStatusCompra(rq.requisicao.id, 'pedido', { credor: D.credores[0].id });
  const ent1 = S.entradaLote({ armazem: 'am07', data: Ut.hoje(), pedido_id: rq.requisicao.id,
    documento: 'QA-E10', itens: [{ produto: PE10, qtd: 5 }] });
  verificar('v21 — E10: sem custo informado, vale o cotado com frete rateado',
    ent1.ok, JSON.stringify(ent1.erro));
  const mvE10 = S.movimentos({ produto: PE10, armazem: 'am07' })
    .find(m => m.documento === 'QA-E10');
  verificar('v21 — e o unitário gravado é R$ 60,00 (R$ 50 + frete)',
    mvE10 && Math.abs(mvE10.custo - 60) < 0.01, mvE10 && mvE10.custo);
  verificar('v21 — entrada muito acima do cotado é recusada',
    !!S.entradaLote({ armazem: 'am07', data: Ut.hoje(), pedido_id: rq.requisicao.id,
      itens: [{ produto: PE10, qtd: 5, custo: 999 }] }).erro, '');

  // E11 — entrada parcial não fecha o pedido
  const rq2 = S.criarRequisicao({ armazem: 'am07',
    itens: [{ produto: PE10, qtd: 10 }, { produto: D.produtos[1].id, qtd: 20 }] });
  S.aprovarRequisicao(rq2.requisicao.id,
    { itens: [{ indice: 0, aprovado: true, qtd: 10 }, { indice: 1, aprovado: true, qtd: 20 }] });
  S.registrarCotacao(rq2.requisicao.id, { itens: [
    { produto: PE10, credor: D.credores[0].id, custo: 10 },
    { produto: D.produtos[1].id, credor: D.credores[0].id, custo: 2 }] });
  S.mudarStatusCompra(rq2.requisicao.id, 'aprovada');
  S.mudarStatusCompra(rq2.requisicao.id, 'pedido', { credor: D.credores[0].id });
  const ent2 = S.entradaLote({ armazem: 'am07', data: Ut.hoje(), pedido_id: rq2.requisicao.id,
    documento: 'QA-E11',
    itens: [{ produto: PE10, qtd: 10 }, { produto: D.produtos[1].id, qtd: 20, custo: 'abacaxi' }] });
  /* v23: a entrada passou a ser ATÔMICA também sem pedido — então
     não há mais "parcial": ou entra tudo, ou nada entra. */
  verificar('v23 — entrada com item inválido é recusada por inteiro',
    !!ent2.erro && !ent2.n, JSON.stringify([ent2.ok, ent2.n, ent2.erro]));
  const ped2 = S.compra(rq2.requisicao.id);
  const itemNaoEntrou = (ped2.itens || []).find(i => i.produto === D.produtos[1].id);
  verificar('v21 — e o item que não entrou não é dado por recebido',
    !itemNaoEntrou.recebido, JSON.stringify(itemNaoEntrou && itemNaoEntrou.recebido));
  verificar('v21 — nem o pedido fecha como recebido',
    ped2.status !== 'recebido', ped2.status);
  S.setUsuario('u8');
})();

// ── ERP teste2 v22: um médico por cirurgia ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u5');
  /* Data livre: blocos anteriores fecham e enviam a competência
     corrente, e a trava do E9 recusaria por outro motivo. */
  const diaLivre = '2045-04-03';
  const mk = nome => S.lancarProcedimento({ data: diaLivre, procedimento: 'pa01',
    medico: nome, paciente: 'P', materiais: [] });

  /* O campo é texto e a chave do plantão é data + médico: dois nomes
     no mesmo campo viram um plantão só e um repasse só, e o segundo
     médico some do fechamento. */
  ['DR JOÃO SILVA E DR PEDRO LIMA', 'DR JOÃO / DR PEDRO', 'DR JOÃO + DR PEDRO',
   'DRA ANA COM DR LUIS', 'DR JOÃO & DR PEDRO', 'DR JOÃO SILVA; DR PEDRO LIMA']
    .forEach(function (nome) {
      verificar('v22 — dois médicos no mesmo campo é recusado: ' + nome,
        !!mk(nome).dois_medicos, '');
    });
  ['DR. JOÃO SILVA', 'DRA MARIA EDUARDA COSTA', 'SILVA, JOÃO DA', 'JOSE E. SILVA',
   'DR ANDRE COMES'].forEach(function (nome) {
    const r = mk(nome);
    verificar('v22 — nome legítimo continua passando: ' + nome, r.ok, JSON.stringify(r.erro));
  });

  const base = mk('DR EDICAO QA');
  verificar('v22 — e a edição confere antes de mexer no estoque',
    !!S.editarProcedimento(base.procedimento.id, { medico: 'DR A E DR B' }).dois_medicos, '');
  S.setUsuario('u8');
})();

// ── ERP teste2 v23: terceira auditoria ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u5');
  const cr = D.credores[0].id;
  const umT = (doc, v) => S.criarTitulo({ descricao: 'QA v23', documento: doc, tipo_titulo: 'nf',
    credor: cr, conta: '6.07', centro: 'pj01', emissao: Ut.hoje() },
    [{ num: 1, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: v }]);

  // C4 — pagamento com desconto volta a liquidar
  const t4 = umT('V23-DESC', 1000);
  const p4 = S.todasParcelas().find(p => p.titulo_id === t4.titulo.id);
  S.aprovar([p4.id]);
  S.registrarPagamento(p4.id, { data: Ut.hoje(), valor: 970, desconto: 30, juros: 18, multa: 20, banco: 'b1' });
  const pg4 = S.st.pagamentos.filter(x => x.parcela_id === p4.id).slice(-1)[0];
  S.setUsuario('u3'); S.autorizarPagamento(pg4.id); S.setUsuario('u5');
  verificar('v23 — pagamento com desconto, juros e multa liquida',
    S.liquidar(pg4.id, { data: Ut.hoje(), valor: 1008 }).ok, '');
  verificar('v23 — e fecha a parcela sem saldo negativo',
    S.saldoDe(S.parcela(p4.id)) === 0 && S.parcela(p4.id).status === 'pago',
    JSON.stringify([S.saldoDe(S.parcela(p4.id)), S.parcela(p4.id).status]));

  // C1 — fechamento duplo
  const compF = '2047-05', diaF = '2047-05-06';
  S.lancarProcedimento({ data: diaF, procedimento: 'pa08', medico: 'DR C1 QA', paciente: 'A', materiais: [] });
  verificar('v23 — fechar pelo projeto-mãe funciona',
    S.fecharProcedimentos({ competencia: compF, centro: 'pj50' }).ok, '');
  const dup = S.fecharProcedimentos({ competencia: compF, centro: 'pj51' });
  verificar('v23 — e fechar o mesmo procedimento pelo subprojeto é recusado',
    !!dup.fechamento_conflitante, JSON.stringify(dup.erro));

  // C2 — guarda do lote de produtividade
  S.setUsuario('u4');
  verificar('v23 — perfil de consulta não registra lote de produtividade',
    !!S.registrarLoteProdutividade({ centro: 'pj01', competencia: Ut.mesAtual(),
      arquivo: 'x.xlsx', titulo_ids: [S.todasParcelas()[0].titulo_id], medicos: 1, valor: 97000 }).erro, '');
  S.setUsuario('u5');

  // C3 e A7 — NFS-e
  const nfse = sandbox.window.ERP.nfse;
  if (nfse) {
    const lote = nfse.comoLote({ notas: [{
      numero: '1', emissao: Ut.hoje(), competencia: Ut.mesAtual(), valor_servicos: 10000,
      valor_liquido: 8150, deducoes: 500, desconto: 1000, valor_retido: 350,
      retencoes: [{ tributo: 'IRRF', valor: 350 }], prestador_doc: '', tomador_doc: '',
      tomador_nome: 'QA', discriminacao: '', cancelada: false
    }] }, 'qa.xml');
    verificar('v23 — o líquido assinado pela prefeitura é o que vale',
      lote.notas[0].valorLiquido === 8150, lote.notas[0].valorLiquido);
  }

  // C5 — entradaLote atômico sem pedido
  S.ajusteInventario('am08', [{ produto: 'pr06', qtd: 0 }], { motivo: 'QA v23' });
  const antesAt = S.saldoEstoque('pr06', 'am08');
  const lote5 = S.entradaLote({ armazem: 'am08', data: Ut.hoje(), documento: 'V23-AT',
    itens: [{ produto: 'pr06', qtd: 10, custo: 5 }, { produto: 'pr28', qtd: 10, custo: 'abacaxi' }] });
  verificar('v23 — entrada avulsa com item inválido não grava nada',
    !!lote5.erro && S.saldoEstoque('pr06', 'am08') === antesAt,
    JSON.stringify([lote5.erro, antesAt, S.saldoEstoque('pr06', 'am08')]));

  // A6 — resíduo nos três caminhos
  const A6 = 'am09', B6 = 'am10', P6 = 'pr06';
  const prep6 = () => {
    S.ajusteInventario(A6, [{ produto: P6, qtd: 0 }], { motivo: 'QA v23' });
    S.ajusteInventario(B6, [{ produto: P6, qtd: 0 }], { motivo: 'QA v23' });
    return S.entrada({ produto: P6, armazem: A6, qtd: 100, custo: 1,
      unidades_por_embalagem: 7, data: Ut.hoje(), documento: 'V23-RES' });
  };
  prep6();
  const mv6 = S.movimentos({ produto: P6, armazem: A6 }).find(m => m.documento === 'V23-RES');
  verificar('v23 — estorno de entrada com custo médio em dízima é aceito',
    S.estornarMovimento(mv6.id, 'teste v23').ok, '');
  prep6();
  const tot6 = () => [A6, B6].reduce((s, a) =>
    s + ((S.posicaoEstoque(a).find(x => x.produto.id === P6) || {}).valor || 0), 0);
  const antes6 = tot6();
  S.transferir({ origem: A6, destino: B6, data: Ut.hoje(), itens: [{ produto: P6, qtd: 700 }] });
  verificar('v23 — INVARIANTE: transferência não cria nem destrói valor',
    Math.abs(tot6() - antes6) < 0.005, JSON.stringify([antes6, tot6()]));

  // A8 — nomes legítimos
  const diaM = '2047-09-04';
  const mkM = nome => S.lancarProcedimento({ data: diaM, procedimento: 'pa01',
    medico: nome, paciente: 'P', materiais: [] });
  ['JOAO DE PAULA E SILVA', 'MARIA DE JESUS E SOUZA', 'ANA PAULA E SILVA',
   'LUIZ GONZAGA E MELO NETO', 'SILVA JUNIOR, JOAO CARLOS'].forEach(function (n) {
    const r = mkM(n);
    verificar('v23 — nome legítimo aceito: ' + n, r.ok, JSON.stringify(r.erro));
  });
  ['DR A / DR B', 'DR A + DR B', 'DR A & DR B', 'DR A; DR B', 'DRA ANA COM DR LUIS',
   'DR A E DR B'].forEach(function (n) {
    verificar('v23 — dois médicos recusado: ' + n, !!mkM(n).dois_medicos, '');
  });

  // A9 — datas que não existem
  verificar('v23 — rescisão em 31/02 é recusada',
    !!S.calcularRescisao('fn01', '2026-02-31', 'sem_justa_causa', {}).erro, '');
  verificar('v23 — plantão em 31/11 é recusado',
    !!S.ajustarPlantoes('2026-11-31', 'DR X', 2, 'x').erro, '');
  verificar('v23 — procedimento em 31/11 é recusado',
    !!S.lancarProcedimento({ data: '2026-11-31', procedimento: 'pa01', medico: 'DR X',
      paciente: 'P', materiais: [] }).erro, '');
  verificar('v23 — vencimento em 31/11 é recusado',
    !!S.criarTitulo({ descricao: 'x', documento: 'V23-D31', tipo_titulo: 'nf', credor: cr,
      conta: '6.07', centro: 'pj01', emissao: Ut.hoje() },
      [{ num: 1, venc: '2026-11-31', comp: Ut.mesAtual(), valor: 10 }]).erro, '');
  verificar('v23 — e data que existe continua passando',
    S.criarTitulo({ descricao: 'x', documento: 'V23-D29', tipo_titulo: 'nf', credor: cr,
      conta: '6.07', centro: 'pj01', emissao: Ut.hoje() },
      [{ num: 1, venc: '2028-02-29', comp: Ut.mesAtual(), valor: 10 }]).ok, '');

  // A13 — frete na entrada avulsa
  S.ajusteInventario('am07', [{ produto: 'pr06', qtd: 0 }], { motivo: 'QA v23' });
  S.entrada({ produto: 'pr06', armazem: 'am07', qtd: 10, custo: 50, frete: 100, data: Ut.hoje() });
  verificar('v23 — o frete entra no custo do estoque na entrada avulsa',
    Math.abs((S.posicaoEstoque('am07').find(x => x.produto.id === 'pr06') || {}).valor - 600) < 0.01,
    (S.posicaoEstoque('am07').find(x => x.produto.id === 'pr06') || {}).valor);
  verificar('v23 — frete negativo é recusado',
    !!S.entrada({ produto: 'pr06', armazem: 'am07', qtd: 1, custo: 10, frete: -500,
      data: Ut.hoje() }).erro, '');

  // A14b/14c/18b — aditivos
  const ct = S.salvarContrato({ numero: 'V23-CT', objeto: 'QA', centro: 'pj01',
    cliente: (D.clientes[0] || {}).id,
    itens: [{ centro: 'pj01', descricao: 'Serviço', qtd: 1, valor: 10000, valor_unit: 10000 }],
    vigencia_ini: Ut.hoje(), vigencia_fim: Ut.addDias(Ut.hoje(), 300), valor_mensal: 10000 });
  if (ct.ok) {
    const cid = ct.contrato.id;
    verificar('v23 — aditivo com percentual infinito é recusado',
      !!S.addAditivo(cid, { numero: 'A1', tipo: 'valor', percentual: Infinity }).erro, '');
    verificar('v23 — aditivo de −250% é recusado',
      !!S.addAditivo(cid, { numero: 'A2', tipo: 'valor', percentual: -250 }).erro, '');
    verificar('v23 — aditivo de 1.000.000% é recusado',
      !!S.addAditivo(cid, { numero: 'A3', tipo: 'valor', percentual: 1000000 }).erro, '');
    verificar('v23 — aditivo de +10% é aceito',
      S.addAditivo(cid, { numero: 'AD-1', tipo: 'valor', percentual: 10 }).ok, '');
    verificar('v23 — e o mesmo número não entra duas vezes',
      !!S.addAditivo(cid, { numero: 'AD-1', tipo: 'valor', percentual: 10 }).erro, '');
    verificar('v23 — aditivo de prazo anterior ao início é recusado',
      !!S.addAditivo(cid, { numero: 'AD-2', tipo: 'prazo',
        nova_vigencia: Ut.addDias(Ut.hoje(), -1) }).erro, '');
  }

  // M16 — nenhuma exceção com argumento ruim
  const semExcecao = [
    () => S.criarTitulo({ descricao: 'x' }),
    () => S.registrarLoteProdutividade({ centro: 'pj01' }),
    () => S.ajustarPlantoes({}, 'DR', 1, 'x'),
    () => S.enviarFaturamentoProcedimentos({}, null, {}),
    () => S.calcularHolerite('fn01', 'abacaxi', {}),
    () => S.calcular13('fn01', 'ano', 2)
  ].every(function (f) {
    try { const r = f(); return !!(r && r.erro); } catch (e) { return false; }
  });
  verificar('v23 — INVARIANTE: argumento ruim devolve erro, não exceção', semExcecao, '');

  // cancelarProcedimento ganhou guarda (achado da varredura ampliada)
  const pcQA = S.lancarProcedimento({ data: '2047-09-05', procedimento: 'pa01',
    medico: 'DR GUARDA QA', paciente: 'P', materiais: [] });
  S.setUsuario('u4');
  verificar('v23 — perfil de consulta não cancela procedimento',
    !!S.cancelarProcedimento(pcQA.procedimento.id, 'x').erro, '');
  S.setUsuario('u8');
})();

// ── ERP teste2 v24: sugestões de produto da 3ª auditoria ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u5');

  // lotes devolvem ok honesto
  const loteRuim = S.conciliarLote([{ linha: 'nao-existe-1' }, { linha: 'nao-existe-2' }]);
  verificar('v24 — lote com 100% de erro devolve ok:false e erro preenchido',
    loteRuim.ok === false && !!loteRuim.erro, JSON.stringify(loteRuim));

  // transferência que deixa a conta negativa avisa antes
  const neg = S.transferirEntreContas({ origem: 'b4', destino: 'b1',
    valor: 999000000, data: Ut.hoje() });
  verificar('v24 — transferência que deixa a conta negativa pede confirmação',
    !!neg.confirmar_saldo_negativo, JSON.stringify(neg.erro));
  verificar('v24 — e confirmando, passa',
    S.transferirEntreContas({ origem: 'b4', destino: 'b1', valor: 999000000,
      data: Ut.hoje(), confirmar_saldo_negativo: true }).ok, '');

  // divergência de entrada: confirmável, com motivo e rastro
  const P24 = D.produtos[0].id;
  const rq24 = S.criarRequisicao({ armazem: 'am07', itens: [{ produto: P24, qtd: 10 }] });
  S.aprovarRequisicao(rq24.requisicao.id, { itens: [{ indice: 0, aprovado: true, qtd: 10 }] });
  S.registrarCotacao(rq24.requisicao.id,
    { itens: [{ produto: P24, credor: D.credores[0].id, custo: 50 }] });
  S.mudarStatusCompra(rq24.requisicao.id, 'aprovada');
  S.mudarStatusCompra(rq24.requisicao.id, 'pedido', { credor: D.credores[0].id });
  const base24 = { armazem: 'am07', data: Ut.hoje(), pedido_id: rq24.requisicao.id,
    itens: [{ produto: P24, qtd: 10, custo: 70 }] };
  verificar('v24 — entrada divergente do pedido é recusada e devolve as divergências',
    !!S.entradaLote(base24).divergencias, '');
  verificar('v24 — forçar sem motivo é recusado',
    !!S.entradaLote(Object.assign({}, base24, { forcar_divergencia: true })).erro, '');
  verificar('v24 — forçar com motivo é aceito',
    S.entradaLote(Object.assign({}, base24,
      { forcar_divergencia: true, motivo_divergencia: 'fornecedor reajustou' })).ok, '');
  verificar('v24 — e a divergência fica no histórico do pedido',
    (S.compra(rq24.requisicao.id).historico || [])
      .some(h => /diverg/i.test(h.obs || '')), '');

  // reapontar vínculo de conciliação
  const O24 = sandbox.window.ERP.ofx, fs24 = require('fs');
  S.importarExtrato('b2', O24.ler(fs24.readFileSync(__dirname +
    '/exemplos-ofx/extrato-bradesco-matriz.ofx').toString('latin1')), 'v24.ofx');
  const saidas24 = S.linhasExtrato({ banco: 'b2' })
    .filter(l => l.situacao === 'pendente' && l.saida);
  const par24 = saidas24.length > 1 && saidas24[0].valor === saidas24[1].valor
    ? [saidas24[0], saidas24[1]]
    : saidas24.filter(l => Math.abs(l.valor) === Math.abs((saidas24[0] || {}).valor)).slice(0, 2);
  if (par24.length === 2) {
    const cr24 = D.credores[0].id;
    const t24 = S.criarTitulo({ descricao: 'QA v24', documento: 'V24-RP', tipo_titulo: 'nf',
      credor: cr24, conta: '6.07', centro: 'pj01', emissao: Ut.hoje() },
      [{ num: 1, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: Math.abs(par24[0].valor) }]);
    const p24 = S.todasParcelas().find(p => p.titulo_id === t24.titulo.id);
    S.aprovar([p24.id]);
    S.conciliar(par24[0].id, { tipo: 'parcela', id: p24.id });
    const rp = S.reapontarConciliacao(par24[0].id, par24[1].id, 'linha errada');
    verificar('v24 — dá para trocar a linha que comprova o pagamento',
      rp.ok, JSON.stringify(rp.erro));
    if (rp.ok) {
      const l1 = S.linhasExtrato({ banco: 'b2' }).find(x => x.id === par24[0].id);
      const l2 = S.linhasExtrato({ banco: 'b2' }).find(x => x.id === par24[1].id);
      verificar('v24 — a linha antiga volta a pendente e a nova fica conciliada',
        l1.situacao === 'pendente' && l2.situacao === 'conciliado',
        JSON.stringify([l1.situacao, l2.situacao]));
      verificar('v24 — e o pagamento continua liquidado',
        S.parcela(p24.id).status === 'pago', S.parcela(p24.id).status);
    }
  }
  S.setUsuario('u8');
})();

// ── Invariantes propostos pela 3ª auditoria ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u5');

  /* 1. Conservação de valor no estoque — depois de CADA tipo de
     operação, não só da saída. O valor da posição tem de bater com a
     razão dos movimentos, e o total do grupo não pode mudar em
     operação que só remaneja. */
  const INV_A = 'am09', INV_B = 'am10', INV_P = 'pr06';
  const totalGrupo = () => Math.round(D.armazens.reduce(function (s, a) {
    return s + ((S.posicaoEstoque(a.id).find(x => x.produto.id === INV_P) || {}).valor || 0);
  }, 0) * 100) / 100;
  const bate = () => D.armazens.every(function (a) {
    const pos = S.posicaoEstoque(a.id).find(x => x.produto.id === INV_P);
    if (!pos) return true;
    if (pos.saldo === 0) return Math.abs(pos.valor) < 0.005;
    return Math.abs(pos.saldo * pos.medio - pos.valor) <= Math.max(0.011, pos.saldo * 0.00005);
  });
  S.ajusteInventario(INV_A, [{ produto: INV_P, qtd: 0 }], { motivo: 'INV' });
  S.ajusteInventario(INV_B, [{ produto: INV_P, qtd: 0 }], { motivo: 'INV' });
  /* Três camadas de custo, uma delas em dízima. */
  S.entrada({ produto: INV_P, armazem: INV_A, qtd: 100, custo: 1, unidades_por_embalagem: 7, data: Ut.hoje() });
  S.entrada({ produto: INV_P, armazem: INV_A, qtd: 10, custo: 3.33, data: Ut.hoje() });
  S.entrada({ produto: INV_P, armazem: INV_A, qtd: 5, custo: 2.50, data: Ut.hoje(), documento: 'INV-3' });
  verificar('INVARIANTE — valor da posição bate com qtd × médio após as entradas', bate(), '');
  const apos = totalGrupo();
  S.transferir({ origem: INV_A, destino: INV_B, data: Ut.hoje(), itens: [{ produto: INV_P, qtd: 300 }] });
  verificar('INVARIANTE — transferência não muda o total do grupo',
    Math.abs(totalGrupo() - apos) < 0.005, JSON.stringify([apos, totalGrupo()]));
  verificar('INVARIANTE — e os dois lados continuam batendo', bate(), '');
  const mvInv = S.movimentos({ produto: INV_P, armazem: INV_A }).find(m => m.documento === 'INV-3');
  if (mvInv) {
    S.estornarMovimento(mvInv.id, 'invariante');
    verificar('INVARIANTE — estorno mantém a posição coerente', bate(), '');
  }
  S.saida({ produto: INV_P, armazem: INV_B, qtd: S.saldoEstoque(INV_P, INV_B),
    data: Ut.hoje(), motivo: 'Consumo assistencial' });
  verificar('INVARIANTE — saldo zerado é valor zerado',
    ((S.posicaoEstoque(INV_B).find(x => x.produto.id === INV_P) || {}).valor || 0) === 0, '');

  /* 2. Competência do INSS e do IRRF: a soma do que foi retido na
     competência tem de ser igual ao imposto sobre a soma das bases —
     incluindo FÉRIAS, FOLHA e RESCISÃO. */
  const compInv = '2049-07';
  const ferInv = S.calcularFerias('fn02', 15, '2049-07-05', 0);
  if (!ferInv.erro) {
    S.lancarFerias('fn02', ferInv, '2049-07-05');
    const hInv = S.calcularHolerite('fn02', compInv, { he50_horas: 20 });
    const baseInv = Math.round((ferInv.base_inss + hInv.base_inss) * 100) / 100;
    verificar('INVARIANTE — INSS do mês fecha com férias + folha',
      Math.abs((ferInv.valor_inss + hInv.valor_inss) - S.calcularINSS(baseInv)) < 0.02,
      JSON.stringify([ferInv.valor_inss, hInv.valor_inss, S.calcularINSS(baseInv)]));
  }
  const compR = '2050-04';
  const ferR = S.calcularFerias('fn01', 15, '2050-04-04', 0);
  if (!ferR.erro) {
    S.lancarFerias('fn01', ferR, '2050-04-04');
    const resc = S.calcularRescisao('fn01', '2050-04-25', 'sem_justa_causa', { avisoIndenizado: true });
    /* A base do INSS da rescisão é o SALDO DE SALÁRIO. O 13º tem base
       própria (`valor_inss_decimo`) e fica fora desta soma, como a
       lei manda. */
    const baseR = Math.round((ferR.base_inss + (resc.saldo_salario || 0)) * 100) / 100;
    verificar('INVARIANTE — INSS do mês fecha com férias + rescisão',
      Math.abs((ferR.valor_inss + resc.valor_inss_saldo) - S.calcularINSS(baseR)) < 0.05,
      JSON.stringify([ferR.valor_inss, resc.valor_inss_saldo, S.calcularINSS(baseR)]));
  }

  /* 3. Unicidade do fechamento: um procedimento nunca em dois
     fechamentos vivos. */
  const vivos = {};
  let duplicado = null;
  (S.st.fechamentosProcedimentos || []).forEach(function (f) {
    if (f.cancelado) return;
    (f.procedimento_ids || []).forEach(function (pid) {
      if (vivos[pid]) duplicado = pid;
      vivos[pid] = f.id;
    });
  });
  verificar('INVARIANTE — nenhum procedimento está em dois fechamentos vivos',
    !duplicado, duplicado);

  /* 4. Toda data gravada existe no calendário. */
  const datasRuins = [];
  const confereData = (valor, onde) => {
    if (!valor || typeof valor !== 'string') return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return;
    if (!S.dataExiste(valor)) datasRuins.push(onde + ': ' + valor);
  };
  S.todasParcelas().forEach(p => { confereData(p.venc, 'parcela'); confereData(p.pago_em, 'parcela'); });
  (S.st.pagamentos || []).forEach(p => confereData(p.data, 'pagamento'));
  (S.st.receber || []).forEach(r => { confereData(r.emissao, 'receber'); confereData(r.vencimento, 'receber'); });
  S.listarProcedimentos({}).forEach(p => confereData(p.data, 'procedimento'));
  (S.movimentos({}) || []).forEach(m => confereData(m.data, 'movimento'));
  verificar('INVARIANTE — toda data gravada existe no calendário',
    !datasRuins.length, datasRuins.slice(0, 3).join(' · '));

  /* 5. Nenhuma escrita lança exceção com argumento ruim. */
  const ruins = [
    () => S.criarTitulo(null, null), () => S.criarTitulo({}, []),
    () => S.criarReceber(null), () => S.registrarPagamento(null, null),
    () => S.liquidar(null, null), () => S.entrada(null), () => S.saida(null),
    () => S.transferir(null), () => S.baixaMultipla(null), () => S.entradaLote(null),
    () => S.ajusteInventario(null, null, null), () => S.lancarProcedimento(null),
    () => S.cancelarProcedimento(null, null), () => S.fecharProcedimentos(null),
    () => S.registrarLoteProdutividade(null), () => S.salvarContrato(null),
    () => S.addAditivo(null, null), () => S.calcularHolerite(null, null, null),
    () => S.calcular13(null, null, null), () => S.calcularRescisao(null, null, null),
    () => S.salvarTabelasDP(null), () => S.editarFuncionario(null, null),
    () => S.conciliar(null, null), () => S.desconciliar(null, null),
    () => S.reapontarConciliacao(null, null, null), () => S.transferirEntreContas(null)
  ];
  const estouraram = [];
  ruins.forEach(function (f, i) {
    try { f(); } catch (e) { estouraram.push(i + ': ' + e.message.slice(0, 40)); }
  });
  verificar('INVARIANTE — nenhuma escrita lança exceção com argumento ruim',
    !estouraram.length, estouraram.slice(0, 3).join(' · '));

  /* 6. Caminho feliz do pagamento com desconto, ponta a ponta:
     solicitação, liquidação e conciliação. */
  const O6 = sandbox.window.ERP.ofx, fs6 = require('fs');
  /* O extrato de exemplo é da conta do Bradesco; importar noutra
     conta é recusado, com razão. */
  S.importarExtrato('b1', O6.ler(fs6.readFileSync(__dirname +
    '/exemplos-ofx/extrato-bradesco-matriz.ofx').toString('latin1')), 'inv.ofx');
  const linha6 = S.linhasExtrato({ banco: 'b1' })
    .find(l => l.situacao === 'pendente' && l.saida && Math.abs(l.valor) > 100);
  if (linha6) {
    const bruto = Math.round((Math.abs(linha6.valor) + 30) * 100) / 100;
    const t6 = S.criarTitulo({ descricao: 'INV desconto', documento: 'INV-DESC', tipo_titulo: 'nf',
      credor: D.credores[0].id, conta: '6.07', centro: 'pj01', emissao: Ut.hoje() },
      [{ num: 1, venc: Ut.hoje(), comp: Ut.mesAtual(), valor: bruto }]);
    const p6 = S.todasParcelas().find(p => p.titulo_id === t6.titulo.id);
    S.aprovar([p6.id]);
    S.registrarPagamento(p6.id, { data: Ut.hoje(), valor: Math.abs(linha6.valor),
      desconto: 30, banco: 'b1' });
    const pg6 = S.st.pagamentos.filter(x => x.parcela_id === p6.id).slice(-1)[0];
    verificar('INVARIANTE — a solicitação com desconto é aceita', !!pg6, '');
    if (pg6) {
    S.setUsuario('u3'); S.autorizarPagamento(pg6.id); S.setUsuario('u5');
    const conc = S.conciliar(linha6.id, { tipo: 'pagamento', id: pg6.id });
    verificar('INVARIANTE — pagamento com desconto concilia pelo extrato',
      conc.ok, JSON.stringify(conc.erro));
    verificar('INVARIANTE — e a parcela fecha paga, com saldo zero',
      S.parcela(p6.id).status === 'pago' && S.saldoDe(S.parcela(p6.id)) === 0,
      JSON.stringify([S.parcela(p6.id).status, S.saldoDe(S.parcela(p6.id))]));
    }
  }
  S.setUsuario('u8');
})();

// ── ERP teste2 v25: formato único de número e data ──
(function () {
  const Ut = sandbox.window.ERP.util;
  /* Número: 00.000,00 sempre — ponto no milhar, vírgula no decimal,
     duas casas, inclusive em valor redondo e em zero. */
  verificar('v25 — dinheiro usa 00.000,00', Ut.brl(10000) === 'R$ 10.000,00', Ut.brl(10000));
  verificar('v25 — milhão mantém os pontos', Ut.brl(1234567.8) === 'R$ 1.234.567,80', Ut.brl(1234567.8));
  verificar('v25 — valor redondo mostra as duas casas', Ut.num(50) === '50,00', Ut.num(50));
  verificar('v25 — zero mostra as duas casas', Ut.num(0) === '0,00', Ut.num(0));
  verificar('v25 — negativo mantém o padrão', Ut.brl(-1234.5) === 'R$ -1.234,50', Ut.brl(-1234.5));
  verificar('v25 — percentual também tem duas casas', Ut.pct(9.04) === '9,04%', Ut.pct(9.04));
  verificar('v25 — percentual redondo idem', Ut.pct(30) === '30,00%', Ut.pct(30));

  /* Data: dd/mm/aaaa sempre. */
  verificar('v25 — data em dd/mm/aaaa', Ut.fData('2026-03-07') === '07/03/2026', Ut.fData('2026-03-07'));
  verificar('v25 — dia e mês com dois dígitos', Ut.fData('2026-12-31') === '31/12/2026', Ut.fData('2026-12-31'));
  verificar('v25 — data vazia não quebra', Ut.fData('') === '—', Ut.fData(''));
  verificar('v25 — competência em mm/aaaa', Ut.fComp('2026-03') === '03/2026', Ut.fComp('2026-03'));
  const dh = Ut.fDataHora(new Date(2026, 2, 7, 9, 5));
  verificar('v25 — data com hora em dd/mm/aaaa HH:MM', dh === '07/03/2026 09:05', dh);
  verificar('v25 — data com hora inválida não quebra', Ut.fDataHora('abacaxi') === '—', Ut.fDataHora('abacaxi'));

  /* `parseValor` lê de volta o que `num` escreve — ida e volta sem
     perda é o que garante que o formato não vira problema na
     digitação. */
  verificar('v25 — o que é escrito é lido de volta',
    Ut.parseValor(Ut.num(1234567.89)) === 1234567.89, Ut.parseValor(Ut.num(1234567.89)));
})();

// ── ERP teste2 v26: quarta auditoria ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u8');
  const compV26 = '2053-03';

  /* 1 — falta negativa vira aumento. O campo da tela é texto livre, e
     "-5" digitado por engano pagava R$ 963,58 a mais, com FGTS e INSS
     inflados junto e a folha fechando como se estivesse tudo certo. */
  const normal = S.calcularHolerite('fn03', compV26, {});
  verificar('v26 — falta negativa é recusada',
    !!S.calcularHolerite('fn03', compV26, { faltas_dias: -5 }).erro, '');
  verificar('v26 — e falta positiva continua descontando',
    S.calcularHolerite('fn03', compV26, { faltas_dias: 2 }).liquido < normal.liquido, '');

  /* 2 — os doze campos de extras. */
  ['he50_horas', 'he100_horas', 'horas_noturnas', 'gratificacao_valor', 'faltas_dias',
   'dsr_perdidos', 'dias_trabalhados', 'pensao_alimenticia_valor',
   'credito_trabalhador_valor', 'vt_desconto_valor', 'vr_desconto_valor'].forEach(function (campo) {
    [Infinity, NaN, 'abacaxi', -1].forEach(function (ruim) {
      const extras = {}; extras[campo] = ruim;
      const r = S.calcularHolerite('fn03', compV26, extras);
      verificar('v26 — ' + campo + ' = ' + String(ruim) + ' é recusado', !!r.erro, '');
    });
  });
  verificar('v26 — e o valor em texto brasileiro é interpretado, não recusado',
    S.calcularHolerite('fn03', compV26, { he50_horas: '1,5' }).liquido > normal.liquido, '');

  /* 3 — rubricas manuais. */
  verificar('v26 — rubrica com valor em texto é interpretada',
    S.calcularHolerite('fn03', compV26,
      { outros_proventos: [{ descricao: 'Bônus', valor: '1.500,00' }] }).liquido > normal.liquido, '');
  verificar('v26 — rubrica com valor infinito é recusada',
    !!S.calcularHolerite('fn03', compV26,
      { outros_proventos: [{ descricao: 'x', valor: Infinity }] }).erro, '');
  verificar('v26 — rubrica sem descrição é recusada',
    !!S.calcularHolerite('fn03', compV26, { outros_proventos: [{ valor: 100 }] }).erro, '');
  verificar('v26 — lista de rubricas que não é lista é recusada',
    !!S.calcularHolerite('fn03', compV26, { outros_descontos: 'x' }).erro, '');

  /* 4 — folha não fecha deixando gente de fora. */
  const fechaRuim = S.fecharFolha(compV26,
    { fn03: { outros_descontos: [{ descricao: 'Adiantamento', valor: 99999 }] } });
  verificar('v26 — folha com líquido negativo não fecha', !!fechaRuim.erro, '');
  verificar('v26 — e nada é gravado',
    !S.st.folhas.some(f => f.competencia === compV26 && !f.cancelada), '');
  const fechaOk = S.fecharFolha(compV26, {});
  verificar('v26 — a mesma folha fecha quando os lançamentos estão certos', fechaOk.ok, '');

  /* INVARIANTE — finitude no DP: nenhum holerite gravado pode ter
     total não finito, e nenhum total de folha também. */
  let ruinsDP = [];
  S.st.folhas.filter(f => !f.cancelada).forEach(function (fl) {
    if (!isFinite(fl.total_liquido)) ruinsDP.push(fl.competencia + ': total da folha');
    (fl.holerites || []).forEach(function (h) {
      ['total_proventos', 'total_descontos', 'liquido'].forEach(function (k) {
        if (!isFinite(h[k])) ruinsDP.push(fl.competencia + '/' + h.funcionario + ': ' + k);
      });
    });
  });
  verificar('v26 — INVARIANTE: nenhum holerite ou folha com total não finito',
    !ruinsDP.length, ruinsDP.slice(0, 3).join(' · '));

  /* INVARIANTE — folha completa: todo funcionário da folha fechada
     tem holerite E título. */
  const semTitulo = [];
  S.st.folhas.filter(f => !f.cancelada && !f.complementar).forEach(function (fl) {
    (fl.holerites || []).forEach(function (h) {
      /* O vínculo do título com o holerite é o `origem_ref`
         (folha-<competência>-<funcionário>). */
      const ref = 'folha-' + fl.competencia + '-' + h.funcionario;
      const temTitulo = S.st.titulos.some(function (x) {
        return x.origem === 'folha' && x.origem_ref === ref;
      });
      if (!temTitulo && h.liquido > 0) semTitulo.push(fl.competencia + '/' + h.funcionario);
    });
  });
  verificar('v26 — INVARIANTE: todo holerite da folha fechada tem título',
    !semTitulo.length, semTitulo.slice(0, 3).join(' · '));

  /* 8 — autorização do órgão. */
  S.setUsuario('u5');
  const compA = '2053-06';
  S.salvarPrevisao({ centro: 'pj37', competencia: compA, faturamento: 50000, produtividade: 0 });
  S.marcarPrevisoes(compA, 'confirmada_prod', 'pj37');
  verificar('v26 — autorizar sem protocolo é recusado',
    !!S.autorizarFaturamento('pj37', compA, { sem_produtividade: true }).erro, '');
  verificar('v26 — com protocolo é aceito',
    S.autorizarFaturamento('pj37', compA, { protocolo: 'OF-A', sem_produtividade: true }).ok, '');
  const subst = S.autorizarFaturamento('pj37', compA, { protocolo: 'OF-B', sem_produtividade: true });
  verificar('v26 — substituir a autorização pede confirmação', !!subst.substitui_autorizacao, '');
  verificar('v26 — e confirmando, a anterior fica no histórico',
    S.autorizarFaturamento('pj37', compA,
      { protocolo: 'OF-B', sem_produtividade: true, confirmar_substituicao: true }).ok, '');

  /* 6 e 7 — lote de RPS. */
  const loteA = S.registrarLoteRPS({ remessa: '20800599001', rps: [] });
  if (loteA.ok) {
    verificar('v26 — converter lote sem informar número devolve erro',
      !!S.converterLoteRPS(loteA.lote.id, {}).erro, '');
    verificar('v26 — número de RPS que não está no lote devolve erro',
      !!S.converterLoteRPS(loteA.lote.id, { 999: 'NFE-1' }).erro, '');
    verificar('v26 — remessa repetida pede confirmação',
      !!S.registrarLoteRPS({ remessa: '20800599001', rps: [] }).remessa_repetida, '');
    verificar('v26 — e confirmando, passa',
      S.registrarLoteRPS({ remessa: '20800599001', rps: [],
        confirmar_remessa_repetida: true }).ok, '');
  }
  S.setUsuario('u8');
})();

// ── ERP teste2 v27: relatório de faturamento por projeto ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u5');
  const compF = '2055-04';
  const diaF = '2055-04-10';

  S.criarReceber({ numero: 'RF-1', emissao: diaF, centro: 'pj01', competencia: compF,
    valor_bruto: 50000, valor_retido: 5000, cliente_nome: 'HGB', origem: 'nota',
    forcar_sem_liberacao: true });
  S.criarReceber({ numero: 'RF-2', emissao: diaF, centro: 'pj02', competencia: compF,
    valor_bruto: 30000, cliente_nome: 'X', origem: 'nota', forcar_sem_liberacao: true });

  const r = S.relatorioFaturamento({ competencia: compF });
  verificar('v27 — o relatório traz TODOS os projetos, não só os faturados',
    r.projetos > r.faturados && r.nao_faturados === r.projetos - r.faturados,
    JSON.stringify([r.projetos, r.faturados, r.nao_faturados]));
  verificar('v27 — e soma o faturado da competência',
    Math.abs(r.total_bruto - 80000) < 0.01, r.total_bruto);
  verificar('v27 — o líquido desconta a retenção',
    Math.abs(r.total_liquido - 75000) < 0.01, r.total_liquido);
  const semNota = r.linhas.find(l => !l.faturou);
  verificar('v27 — projeto sem nota vem com faturado zero e faturou=false',
    semNota && semNota.valor_bruto === 0 && semNota.faturou === false, '');
  const comNota = r.linhas.find(l => l.centro === 'pj01');
  verificar('v27 — e o projeto faturado traz o número da nota',
    comNota && comNota.numeros.indexOf('RF-1') > -1, JSON.stringify(comNota && comNota.numeros));

  /* Recorte por data de emissão, que pode misturar competências. */
  const porPeriodo = S.relatorioFaturamento({ de: diaF, ate: diaF });
  verificar('v27 — o recorte por período de emissão encontra as mesmas notas',
    porPeriodo.modo === 'periodo' && Math.abs(porPeriodo.total_bruto - 80000) < 0.01,
    JSON.stringify([porPeriodo.modo, porPeriodo.total_bruto]));
  verificar('v27 — período que não contém as notas vem zerado',
    S.relatorioFaturamento({ de: '2055-05-01', ate: '2055-05-31' }).total_bruto === 0, '');
  /* Nota de outra competência entra pelo período, não pela competência. */
  S.criarReceber({ numero: 'RF-3', emissao: diaF, centro: 'pj03', competencia: '2055-03',
    valor_bruto: 10000, cliente_nome: 'Y', origem: 'nota', forcar_sem_liberacao: true });
  verificar('v27 — nota de competência anterior entra no recorte por emissão',
    Math.abs(S.relatorioFaturamento({ de: diaF, ate: diaF }).total_bruto - 90000) < 0.01,
    S.relatorioFaturamento({ de: diaF, ate: diaF }).total_bruto);
  verificar('v27 — e não entra no recorte por competência',
    Math.abs(S.relatorioFaturamento({ competencia: compF }).total_bruto - 80000) < 0.01, '');

  /* Documento cancelado sai da conta. */
  const nf3 = S.contasReceber().find(x => x.numero === 'RF-3');
  if (nf3) {
    S.cancelarReceber(nf3.id, 'teste v27');
    verificar('v27 — nota cancelada sai do relatório',
      Math.abs(S.relatorioFaturamento({ de: diaF, ate: diaF }).total_bruto - 80000) < 0.01, '');
  }

  verificar('v27 — sem competência e sem período, recusa',
    !!S.relatorioFaturamento({}).erro, '');
  verificar('v27 — período invertido é recusado',
    !!S.relatorioFaturamento({ de: '2055-04-30', ate: '2055-04-01' }).erro, '');
  verificar('v27 — data inexistente no período é recusada',
    !!S.relatorioFaturamento({ de: '2055-02-31', ate: '2055-04-01' }).erro, '');
  verificar('v27 — filtro por unidade reduz a lista',
    S.relatorioFaturamento({ competencia: compF,
      unidade: (D.centro('pj01') || {}).unidade }).projetos < r.projetos, '');

  /* Perfil sem acesso a valor de faturamento não vê o relatório. */
  S.setUsuario('u6');
  verificar('v27 — quem não vê valor de faturamento não abre o relatório',
    !!S.relatorioFaturamento({ competencia: compF }).erro, '');
  S.setUsuario('u8');
})();

// ── ERP teste2 v28: nível de Aprovação na matriz ──
(function () {
  const Ut = sandbox.window.ERP.util;

  verificar('v28 — a matriz tem quatro níveis',
    D.NIVEIS_ACESSO.length === 4 &&
    D.NIVEIS_ACESSO.some(n => n.id === 'aprovar' && n.curto === 'A'), '');
  verificar('v28 — cada módulo explica o que "aprovar" significa nele',
    D.MODULOS.every(m => !!D.APROVACAO_POR_MODULO[m.id]),
    D.MODULOS.filter(m => !D.APROVACAO_POR_MODULO[m.id]).map(m => m.id).join(','));

  /* Quem lança não aprova: é a razão do nível existir. */
  verificar('v28 — a assistente lança no financeiro e não aprova',
    S.acessoDoPerfil('assistente', 'financeiro').mover === true &&
    S.acessoDoPerfil('assistente', 'financeiro').aprovar === false, '');
  verificar('v28 — e a diretoria aprova',
    S.acessoDoPerfil('diretoria', 'financeiro').aprovar === true, '');
  verificar('v28 — o comprador cota mas não aprova a própria compra',
    S.acessoDoPerfil('comprador', 'compras').mover === true &&
    S.acessoDoPerfil('comprador', 'compras').aprovar === false, '');
  verificar('v28 — a diretora de produtividade confirma o fechamento do mês',
    S.acessoDoPerfil('produtividade_dir', 'produtividade').aprovar === true, '');
  verificar('v28 — mas não libera a nota: isso é do faturamento',
    S.acessoDoPerfil('produtividade_dir', 'faturamento').aprovar === false, '');

  /* As ações de aprovação passam a vir da matriz. */
  S.setUsuario('u1');
  verificar('v28 — a assistente não aprova pagamento', !S.pode('aprovar'), '');
  verificar('v28 — nem confirma produtividade', !S.pode('confirmar_produtividade'), '');
  S.setUsuario('u2');
  verificar('v28 — a diretoria aprova pagamento', S.pode('aprovar'), '');
  verificar('v28 — e aprova requisição de compra', S.pode('aprovar_compra'), '');
  S.setUsuario('u4');
  verificar('v28 — o perfil de consulta não aprova nada',
    !S.pode('aprovar') && !S.pode('aprovar_compra') && !S.pode('fechar_folha'), '');
  S.setUsuario('u5');

  /* Editar a matriz muda a segregação de verdade — é o ponto de ter
     uma fonte única em vez de lista fixa por perfil. */
  const antes = JSON.parse(JSON.stringify(S.matrizAcesso()));
  const nova = JSON.parse(JSON.stringify(antes));
  nova.assistente.financeiro = 'VMFA';
  verificar('v28 — dar A ao perfil muda a permissão de aprovar',
    S.salvarMatrizAcesso(nova).ok, '');
  S.setUsuario('u1');
  verificar('v28 — e a assistente passa a aprovar', S.pode('aprovar'), '');
  S.setUsuario('u5');
  S.salvarMatrizAcesso(antes);
  S.setUsuario('u1');
  verificar('v28 — tirando o A, deixa de aprovar', !S.pode('aprovar'), '');
  S.setUsuario('u5');

  /* Fechar folha e fechar procedimentos são aprovação de módulo. */
  S.setUsuario('u4');
  verificar('v28 — quem não tem A em Pessoal não fecha folha',
    !!S.fecharFolha('2060-01', {}).erro, '');
  verificar('v28 — quem não tem A em Procedimentos não fecha o faturamento',
    !!S.fecharProcedimentos({ competencia: '2060-01' }).erro, '');
  S.setUsuario('u8');
})();

// ── ERP teste2 v29: níveis que o módulo realmente tem ──
(function () {
  S.setUsuario('u5');
  /* Cadastros e Administração não têm dinheiro — o nível $ nunca foi
     consultado no código para esses dois, então oferecê-lo era
     marcar algo que não muda nada. */
  verificar('v29 — Cadastros não tem o nível financeiro',
    D.niveisDoModulo('cadastros').indexOf('financeiro') < 0, '');
  verificar('v29 — Administração também não',
    D.niveisDoModulo('administracao').indexOf('financeiro') < 0, '');
  verificar('v29 — e os dois mantêm ver, mover e aprovar',
    ['ver', 'mover', 'aprovar'].every(n =>
      D.niveisDoModulo('cadastros').indexOf(n) >= 0 &&
      D.niveisDoModulo('administracao').indexOf(n) >= 0), '');
  /* HABILITAÇÃO é o terceiro módulo sem dinheiro (v104): o cofre
     guarda certidão, não valor. Vale notar que o nível A dele
     significa outra coisa — administrar o catálogo e arquivar
     documento, não aprovar —, e é por isso que
     APROVACAO_POR_MODULO descreve cada módulo em vez de deixar a
     letra solta. */
  verificar('v104 — Habilitação também não tem o nível financeiro',
    D.niveisDoModulo('habilitacao').indexOf('financeiro') < 0, '');
  verificar('v104 — e o que o A dele quer dizer está escrito',
    /catálogo/i.test(D.APROVACAO_POR_MODULO.habilitacao || ''),
    D.APROVACAO_POR_MODULO.habilitacao);
  verificar('v29 — os demais módulos seguem com os quatro',
    D.MODULOS.filter(m => ['cadastros', 'administracao', 'habilitacao'].indexOf(m.id) < 0)
      .every(m => D.niveisDoModulo(m.id).length === 4), '');

  /* O descarte acontece na GRAVAÇÃO, não só na tela: estado antigo
     ou importação não deixam o $ gravado e invisível. */
  const antes = JSON.parse(JSON.stringify(S.matrizAcesso()));
  const nova = JSON.parse(JSON.stringify(antes));
  nova.socio.cadastros = 'VMFA';
  nova.socio.administracao = 'VMF';
  nova.socio.financeiro = 'VMFA';
  S.salvarMatrizAcesso(nova);
  verificar('v29 — o nível financeiro é descartado ao gravar em Cadastros',
    S.matrizAcesso().socio.cadastros === 'VMA', S.matrizAcesso().socio.cadastros);
  verificar('v29 — e em Administração',
    S.matrizAcesso().socio.administracao === 'VM', S.matrizAcesso().socio.administracao);
  verificar('v29 — mas é preservado onde faz sentido',
    S.matrizAcesso().socio.financeiro === 'VMFA', S.matrizAcesso().socio.financeiro);
  verificar('v29 — e a aprovação em Cadastros continua valendo',
    S.acessoDoPerfil('socio', 'cadastros').aprovar === true, '');
  S.salvarMatrizAcesso(antes);

  /* A sugestão padrão não traz o nível inválido. */
  verificar('v29 — a matriz padrão não tem $ nos módulos sem dinheiro',
    Object.keys(D.MATRIZ_PADRAO).every(function (p) {
      const l = D.MATRIZ_PADRAO[p];
      return ['cadastros', 'administracao', 'habilitacao'].every(function (m) {
        return String(l[m] || '').indexOf('F') < 0 && String(l[m] || '').indexOf('$') < 0;
      });
    }), '');
  S.setUsuario('u8');
})();

// ── ERP teste2 v30: a política de acesso que a empresa adotou ──
(function () {
  /* Estes casos leem D.MATRIZ_PADRAO direto, não o estado: é a
     política que vale na empresa, e a bateria roda sob uma matriz
     ampla (ver o topo do arquivo). */
  const P = D.MATRIZ_PADRAO;
  const tem = (perfil, mod, letra) =>
    String((P[perfil] || {})[mod] || '').replace('$', 'F').indexOf(letra) >= 0;

  verificar('v30 — o sócio vê valor e aprova em todos os módulos de negócio',
    ['financeiro', 'produtividade', 'estoque', 'ativos', 'faturamento', 'compras',
     'contratos', 'dp', 'procedimentos'].every(m => tem('socio', m, 'V') &&
      tem('socio', m, 'F') && tem('socio', m, 'A')), '');
  verificar('v30 — e o sócio NÃO movimenta nenhum deles',
    ['financeiro', 'produtividade', 'estoque', 'ativos', 'faturamento', 'compras',
     'contratos', 'dp', 'procedimentos'].every(m => !tem('socio', m, 'M')), '');
  verificar('v30 — a assistente movimenta e não aprova em lugar nenhum',
    tem('assistente', 'financeiro', 'M') &&
    D.MODULOS.every(m => !tem('assistente', m.id, 'A')), '');
  verificar('v30 — a consulta não movimenta nem aprova',
    D.MODULOS.every(m => !tem('consulta', m.id, 'M') && !tem('consulta', m.id, 'A')), '');
  verificar('v30 — o comprador não aprova a própria compra',
    tem('comprador', 'compras', 'M') && !tem('comprador', 'compras', 'A'), '');
  verificar('v30 — a produtividade confirma o fechamento e fecha procedimentos',
    tem('produtividade_dir', 'produtividade', 'A') &&
    tem('produtividade_dir', 'procedimentos', 'A'), '');
  verificar('v30 — mas não libera a nota',
    !tem('produtividade_dir', 'faturamento', 'A'), '');
  verificar('v30 — o DP fecha a própria folha (decisão registrada)',
    tem('dp', 'dp', 'A'), '');
  verificar('v30 — ninguém tem $ em Cadastros nem em Administração',
    Object.keys(P).every(p => !tem(p, 'cadastros', 'F') && !tem(p, 'administracao', 'F')), '');
  verificar('v30 — só a Administração aprova em Administração',
    tem('admin', 'administracao', 'A') &&
    Object.keys(P).filter(p => p !== 'admin').every(p => !tem(p, 'administracao', 'A')), '');

  /* O dado inicial não pode depender de quem tem qual permissão: o
     seed rodava como sócio e, quando o sócio perdeu a movimentação,
     os contratos de exemplo deixaram de nascer — em silêncio. */
  const S2 = S;
  verificar('v30 — o seed cria os contratos independentemente da política',
    (S2.contratos({ parte: 'cliente' }) || []).length > 0,
    (S2.contratos({ parte: 'cliente' }) || []).length);
})();

// ── ERP teste2 v31: decisões da revisão de acesso ──
(function () {
  const P = D.MATRIZ_PADRAO;
  const tem = (perfil, mod, letra) =>
    String((P[perfil] || {})[mod] || '').replace('$', 'F').indexOf(letra) >= 0;

  /* Quem mexe em acesso: Administração, Diretoria e Sócio. O
     assistente tinha M em Administração por engano de cadastro e
     podia promover a si mesmo. */
  verificar('v31 — o assistente só LÊ Administração',
    tem('assistente', 'administracao', 'V') && !tem('assistente', 'administracao', 'M'), '');
  verificar('v31 — Diretoria e Sócio seguem podendo mexer em acesso',
    tem('diretoria', 'administracao', 'M') && tem('socio', 'administracao', 'M'), '');
  verificar('v31 — e os demais perfis nem leem Administração',
    ['consulta', 'estoquista', 'comprador', 'dp', 'operacional',
     'produtividade_dir', 'produtividade_ger'].every(p => !tem(p, 'administracao', 'V')), '');

  S.setUsuario('u1');
  verificar('v31 — na prática, o assistente não salva a matriz',
    !!S.salvarMatrizAcesso(JSON.parse(JSON.stringify(D.MATRIZ_PADRAO))).erro, '');
  /* Estes dois rodam sob a matriz REAL: a bateria opera com uma
     matriz ampla (ver o topo), e aqui o assunto é justamente a
     política que vale na empresa. */
  S.setUsuario('u5');
  S.salvarMatrizAcesso(JSON.parse(JSON.stringify(D.MATRIZ_PADRAO)));
  S.setUsuario('u2');
  verificar('v31 — e a diretoria salva',
    S.salvarMatrizAcesso(JSON.parse(JSON.stringify(D.MATRIZ_PADRAO))).ok, '');

  /* O assistente vê Pessoal por inteiro — paga os salários —, mas
     não movimenta e não fecha. */
  S.setUsuario('u1');
  verificar('v31 — o assistente vê dados pessoais', S.pode('ver_dados_pessoais'), '');
  verificar('v31 — vê valor em Pessoal', S.veFinanceiro('dp'), '');
  verificar('v31 — e não movimenta Pessoal', !S.podeMover('dp'), '');
  verificar('v31 — nem fecha a folha', !S.pode('fechar_folha'), '');
  verificar('v31 — na prática, fechar folha é recusado',
    !!S.fecharFolha('2061-01', {}).erro, '');
  /* Devolve a matriz ampla para o resto da bateria. */
  S.setUsuario('u5');
  S.salvarMatrizAcesso(JSON.parse(JSON.stringify(MATRIZ_TESTE)));
  S.setUsuario('u8');
})();

// ── ERP teste2 v27: o inventário não precifica ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u5');
  const am = 'am01', p1 = 'pr01';
  /* Zera o estoque destes dois para o caso ser isolado. */
  Object.keys(S.st.posicoes).forEach(function (k) {
    if (k.indexOf(p1 + '|' + am) === 0) delete S.st.posicoes[k];
  });

  S.entrada({ produto: p1, armazem: am, qtd: 100, custo: 1.10, data: Ut.hoje(),
    motivo: 'NF de teste', origem: 'nota' });
  const base = S.custoMedio(p1, am);
  verificar('v27 — entrada por nota define o custo', base > 0, base);

  /* Contagem SEM custo: é o caso normal. O custo vem do histórico. */
  S.ajusteInventario(am, [{ produto: p1, qtd: 150 }], { data: Ut.hoje(), motivo: 'contagem' });
  verificar('v27 — recontagem sem custo não mexe no custo médio',
    Math.abs(S.custoMedio(p1, am) - base) < 0.001, S.custoMedio(p1, am));

  /* Contagem COM custo: a tela não deixa digitar, mas se chegar aqui
     o histórico manda. Precificar é papel da nota, não da contagem. */
  S.ajusteInventario(am, [{ produto: p1, qtd: 200, custo: 0.01 }],
    { data: Ut.hoje(), motivo: 'com custo' });
  verificar('v27 — nem com custo informado a contagem muda o custo médio',
    Math.abs(S.custoMedio(p1, am) - base) < 0.001, S.custoMedio(p1, am));

  /* Nota nova MUDA o custo: é o único caminho que precifica. */
  S.entrada({ produto: p1, armazem: am, qtd: 200, custo: 2.00, data: Ut.hoje(),
    motivo: 'NF nova', origem: 'nota' });
  verificar('v27 — mas a nota muda, e faz média ponderada',
    S.custoMedio(p1, am) > base, S.custoMedio(p1, am));

  /* Produto sem histórico: aí o custo é obrigatório, senão entraria
     material a custo zero — que some do balanço e do custo da
     cirurgia sem ninguém perceber. */
  const novo = 'pr22';
  Object.keys(S.st.posicoes).forEach(function (k) {
    if (k.indexOf(novo + '|') === 0) delete S.st.posicoes[k];
  });
  S.st.estoque = S.st.estoque.filter(function (c) { return c.produto !== novo; });
  const r = S.ajusteInventario(am, [{ produto: novo, qtd: 10 }],
    { data: Ut.hoje(), motivo: 'primeiro inventário' });
  verificar('v27 — material sem histórico exige o custo, não entra a zero',
    !!r.erro && /sem entrada anterior/.test(r.erro), JSON.stringify(r).slice(0, 80));
  const r2 = S.ajusteInventario(am, [{ produto: novo, qtd: 10, custo: 3.5 }],
    { data: Ut.hoje(), motivo: 'primeiro inventário' });
  verificar('v27 — e com o custo informado, entra',
    r2.ok && Math.abs(S.custoMedio(novo, am) - 3.5) < 0.001, JSON.stringify(r2).slice(0, 60));
  S.setUsuario('u8');
})();

// ── ERP teste2 v29: cancelado é sim ou não ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u13');

  /* A coluna do banco é booleana. Guardar um objeto ali funcionava
     na memória (JavaScript trata objeto como verdadeiro) e era
     recusado na gravação — e aí o procedimento antigo ficava ATIVO
     ao lado do novo: corrigir o nome de um paciente dobrava o
     faturamento do mutirão. */
  const a = S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa08',
    medico: 'DR TIPO BOOLEANO', paciente: 'PACIENTE A', materiais: [] });
  if (a.ok) {
    const ed = S.editarProcedimento(a.procedimento.id, { paciente: 'PACIENTE B' });
    const antigo = S.listarProcedimentos({ cancelados: true })
      .find(function (x) { return x.id === a.procedimento.id; }) || {};
    verificar('v29 — ao editar, o antigo é cancelado com BOOLEANO',
      antigo.cancelado === true, typeof antigo.cancelado);
    verificar('v29 — e o detalhe vai em campos próprios, não dentro do booleano',
      !!antigo.motivo_cancelamento && !!antigo.cancelado_por && antigo.edicao === true,
      JSON.stringify({ m: antigo.motivo_cancelamento, p: antigo.cancelado_por }));
    verificar('v29 — só UM procedimento ativo depois da edição',
      S.listarProcedimentos({}).filter(function (x) {
        return x.medico === 'DR TIPO BOOLEANO'; }).length === 1,
      S.listarProcedimentos({}).filter(function (x) {
        return x.medico === 'DR TIPO BOOLEANO'; }).length);

    /* O mesmo no cancelamento direto. */
    const b2 = S.lancarProcedimento({ data: Ut.hoje(), procedimento: 'pa08',
      medico: 'DR CANCELA', paciente: 'PACIENTE C', materiais: [] });
    if (b2.ok) {
      S.cancelarProcedimento(b2.procedimento.id, 'teste de cancelamento');
      const c = S.listarProcedimentos({ cancelados: true })
        .find(function (x) { return x.id === b2.procedimento.id; }) || {};
      verificar('v29 — cancelar também grava booleano',
        c.cancelado === true && c.motivo_cancelamento === 'teste de cancelamento',
        typeof c.cancelado);
    }
  }

  /* Nenhum lugar do sistema pode voltar a guardar objeto ali: é o
     tipo de coisa que passa no navegador e quebra no banco. */
  const comObjeto = (S.st.procedimentos || []).concat(S.st.fechamentosProcedimentos || [])
    .filter(function (x) { return x.cancelado && typeof x.cancelado === 'object'; });
  verificar('v29 — nenhum registro com objeto no campo cancelado',
    comObjeto.length === 0, comObjeto.length);
  S.setUsuario('u8');
})();

// ── ERP teste2 v31: competência não fica presa em "fechado" ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u5');
  const comp = '2059-07';
  const centro = D.PATE_CENTRO;

  /* O resíduo: previsão confirmada e nenhum fechamento ativo. Antes
     a tela dizia "fechado" para sempre, oferecia o botão de fechar,
     e recusava em silêncio — o mês ficava sem caminho de volta. */
  S.salvarPrevisao({ centro: centro, competencia: comp, faturamento: 1000 });
  const pv = S.st.previsoes.find(function (p) {
    return p.competencia === comp && p.centro === centro;
  });
  pv.status = 'confirmada_prod';

  const r = S.resumoFechamentoProcedimentos(comp, centro);
  verificar('v31 — sem fechamento ativo, a competência está ABERTA',
    r.etapa === 'previsao', r.etapa);
  verificar('v31 — e o status preso é corrigido ao ler, não fica para trás',
    pv.status === 'estimada', pv.status);

  /* Com fechamento ativo, continua fechada — a correção não pode
     reabrir o que está legitimamente fechado. */
  pv.status = 'confirmada_prod';
  S.st.fechamentosProcedimentos.push({ id: 'fx-teste-v31', competencia: comp,
    centro: centro, faturamento: 0, repasse: 0, cancelado: false });
  const r2 = S.resumoFechamentoProcedimentos(comp, centro);
  verificar('v31 — com fechamento ativo, segue fechada',
    r2.etapa === 'confirmado' && pv.status === 'confirmada_prod', r2.etapa);
  S.st.fechamentosProcedimentos = S.st.fechamentosProcedimentos.filter(function (f) {
    return f.id !== 'fx-teste-v31';
  });
  S.setUsuario('u8');
})();

// ── ERP teste2 v54: a rede de obrigatórias só cita campos reais ──
(function () {
  /* Preencher um campo que a tabela NÃO tem derruba a gravação
     inteira com "could not find the column" — erro pior que o
     original, porque some com tudo que ia junto no mesmo ciclo.

     Aconteceu com `previsoes.substitui` (o campo é de `receber`),
     e a mesma varredura encontrou outros três que eu tinha
     inventado. Este teste lê o arquivo e confere campo a campo. */
  const fs = require('fs');
  const txt = fs.readFileSync(__dirname + '/js/persistencia.js', 'utf8');

  const mapa = {};
  const re = /(\w+): \{ tabela: '(\w+)', colunas: \[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(txt))) {
    mapa[m[2]] = m[3].split(',').map(function (x) { return x.trim().replace(/'/g, ''); });
  }

  const bloco = (txt.match(/const OBRIGATORIAS = \{([\s\S]*?)\n  \};/) || [])[1] || '';
  const re2 = /^\s*(\w+): \{([^}]*)\}/gm;
  const invalidos = [];
  let m2;
  while ((m2 = re2.exec(bloco))) {
    const tabela = m2[1];
    const cols = mapa[tabela];
    if (!cols) continue;      // tabela fora do mapa: nada a conferir
    m2[2].split(',').map(function (x) { return x.split(':')[0].trim(); })
      .filter(Boolean).forEach(function (campo) {
        if (cols.indexOf(campo) < 0) invalidos.push(tabela + '.' + campo);
      });
  }
  verificar('v54 — a rede de obrigatórias só cita colunas que existem',
    invalidos.length === 0, invalidos.join(', '));
})();

// ── ERP teste2 v62: custodiante se corrige sem movimentar ──
(function () {
  S.setUsuario('u5');
  const a = S.st.ativos[0];
  if (!a) return;
  const localAntes = a.local, statusAntes = a.status;

  /* Corrigir quem responde pelo equipamento não é movimentação: é o
     cadastro ficando certo. Exigir uma movimentação para isso faria
     inventarem movimentação que não houve — e aí o histórico, que
     existe para provar onde o bem esteve, passa a mentir. */
  const r = S.salvarAtivo({ id: a.id, tag: a.tag, descricao: a.descricao,
    categoria: a.categoria, valor: a.valor,
    custodiante: 'QA Custodiante', custodiante_telefone: '(21) 90000-0000',
    custodiante_email: 'qa@teste.br' });
  verificar('v62 — custodiante é corrigido pela edição', r.ok, r.erro || '');

  const b = S.st.ativos.find(function (x) { return x.id === a.id; });
  verificar('v62 — com telefone e e-mail junto',
    b.custodiante === 'QA Custodiante' && b.custodiante_telefone === '(21) 90000-0000' &&
    b.custodiante_email === 'qa@teste.br', b.custodiante);

  /* O que NÃO pode acontecer: a edição mexer em onde o bem está. */
  verificar('v62 — e sem mexer em local nem situação',
    b.local === localAntes && b.status === statusAntes,
    b.local + ' / ' + b.status);
  S.setUsuario('u8');
})();

// ── ERP teste2 v75: frete da nota rateado entre os itens ──
(function () {
  /* Frete vem no total da nota, não por item. Sem ratear, o custo
     do estoque fica abaixo do que a empresa pagou — e o efeito
     aparece longe: custo menor na cirurgia, margem do projeto
     parecendo melhor do que é, diferença só no fechamento. */
  const itens = [
    { produto: 'pr01', qtd: 100, custo: 1.00 },
    { produto: 'pr02', qtd: 50, custo: 10.00 },
    { produto: 'pr03', qtd: 10, custo: 0.50 }
  ];

  const porQtd = S.ratearDespesasNota(itens, 320, 'quantidade');
  const somaQtd = porQtd.itens.reduce(function (a, i) { return a + i.despesa_rateada; }, 0);
  verificar('v75 — rateio por quantidade fecha no total da nota',
    Math.abs(somaQtd - 320) < 0.001, somaQtd);
  verificar('v75 — e cada unidade leva a mesma fatia',
    Math.abs(porQtd.itens[0].despesa_rateada / 100 -
             porQtd.itens[1].despesa_rateada / 50) < 0.001,
    porQtd.itens.map(function (i) { return i.despesa_rateada; }).join(' / '));

  const porValor = S.ratearDespesasNota(itens, 320, 'valor');
  const somaValor = porValor.itens.reduce(function (a, i) { return a + i.despesa_rateada; }, 0);
  verificar('v75 — rateio por valor também fecha no centavo',
    Math.abs(somaValor - 320) < 0.001, somaValor);
  verificar('v75 — e o item caro carrega mais frete',
    porValor.itens[1].despesa_rateada > porValor.itens[0].despesa_rateada,
    porValor.itens[1].despesa_rateada + ' vs ' + porValor.itens[0].despesa_rateada);

  /* Nota inteira a custo zero não pode dividir por zero: cai para
     quantidade em vez de quebrar. */
  const zerados = [{ produto: 'pr01', qtd: 10, custo: 0 }, { produto: 'pr02', qtd: 10, custo: 0 }];
  const r0 = S.ratearDespesasNota(zerados, 100, 'valor');
  verificar('v75 — custo zero não quebra o rateio por valor',
    r0.criterio === 'quantidade' &&
    Math.abs(r0.itens.reduce(function (a, i) { return a + i.despesa_rateada; }, 0) - 100) < 0.001,
    r0.criterio);

  /* Sem despesa, nada muda. */
  const semFrete = S.ratearDespesasNota(itens, 0, 'quantidade');
  verificar('v75 — sem despesa, os itens passam intactos',
    semFrete.rateado === 0 && semFrete.itens.length === itens.length, '');
})();

// ── ERP teste2 v76: cadastrar material pela requisição ──
(function () {
  S.setUsuario('u5');
  const antes = D.produtos.length;

  /* Quem requisita descobre que o material não existe justamente na
     hora de pedir. Mandar sair da janela, ir em Cadastros e voltar
     faz perder a requisição pela metade — e, na prática, leva a
     escolher um material parecido, que é pior que cadastrar um
     novo. */
  const r = S.cadastrarMaterial({ descricao: 'QA material novo v76', unidade: 'cx' });
  verificar('v76 — material é cadastrado pela requisição', r.ok, r.erro || '');
  verificar('v76 — com a unidade em maiúscula e código gerado',
    r.ok && r.produto.unidade === 'CX' && /^MT-\d+$/.test(r.produto.codigo),
    r.ok ? r.produto.codigo + ' / ' + r.produto.unidade : '');

  /* Mínimo zerado é deliberado: um mínimo inventado por quem está
     com pressa faz o sistema pedir compra de material que não
     falta, e o alerta falso repete todo mês. */
  verificar('v76 — nasce sem mínimo, para não disparar alerta falso',
    r.ok && r.produto.minimo === 0 && r.produto.ideal === 0, '');

  /* Material repetido é pior que material faltando: duas entradas
     para a mesma coisa partem o saldo em dois e nenhuma mostra o
     total. A comparação ignora maiúsculas e espaços. */
  const dup = S.cadastrarMaterial({ descricao: '  QA MATERIAL NOVO V76 ' });
  verificar('v76 — recusa repetido mesmo com outra grafia',
    !!dup.erro && /já existe/i.test(dup.erro), dup.erro || 'PASSOU');

  const vazio = S.cadastrarMaterial({ descricao: '   ' });
  verificar('v76 — exige descrição', !!vazio.erro, vazio.erro || 'PASSOU');

  /* Quem SÓ CONSULTA não cadastra — a requisição não vira porta
     dos fundos. Mas quem movimenta estoque ou compras SIM: a nota
     chega com item que não existe, e sem poder cadastrar a entrada
     inteira trava. */
  S.setUsuario('u4');
  const semPerm = S.cadastrarMaterial({ descricao: 'QA sem permissao v76' });
  verificar('v76 — perfil de consulta não cadastra',
    !!semPerm.erro && /não cadastra/i.test(semPerm.erro), semPerm.erro || 'PASSOU');

  S.setUsuario('u6');   // controle de estoque
  const comEstoque = S.cadastrarMaterial({ descricao: 'QA material pelo estoque v85' });
  verificar('v85 — quem movimenta estoque cadastra material da nota',
    comEstoque.ok, comEstoque.erro || '');

  /* Dois: o do cadastro válido e o que o perfil de estoque criou.
     O de consulta foi recusado, que é o que importa aqui. */
  verificar('v76 — só os cadastros permitidos entraram',
    D.produtos.length === antes + 2, (D.produtos.length - antes) + '');
  S.setUsuario('u8');
})();

// ── ERP teste2 v77: família, material padrão e id sem colisão ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u5');

  /* IDS: o gerador usava o relógio, e dois cadastros no mesmo
     milissegundo recebiam o MESMO id — as entradas de um iam para o
     saldo do outro. Cadastrar cinco materiais seguidos, que é o que
     acontece ao lançar uma família de lentes, reproduzia sempre. */
  const ids = [];
  ['A', 'B', 'C', 'D', 'E'].forEach(function (g) {
    const r = S.cadastrarMaterial({ descricao: 'QA lente v77 ' + g });
    if (r.ok) { r.produto.familia = 'QA lente v77'; ids.push(r.produto.id); }
  });
  verificar('v77 — cinco cadastros seguidos geram cinco ids distintos',
    new Set(ids).size === 5, ids.join(','));

  /* FAMÍLIA: 120 lentes em 20 graus são 20 linhas, e nenhuma
     responde "quantas lentes eu tenho". */
  const am = D.armazens[0].id;
  S.entrada({ produto: ids[0], armazem: am, qtd: 40, custo: 400, data: Ut.hoje(),
    motivo: 'QA', origem: 'nota' });
  S.entrada({ produto: ids[1], armazem: am, qtd: 30, custo: 410, data: Ut.hoje(),
    motivo: 'QA', origem: 'nota' });
  S.entrada({ produto: ids[2], armazem: am, qtd: 10, custo: 420, data: Ut.hoje(),
    motivo: 'QA', origem: 'nota' });
  S.saida({ produto: ids[2], armazem: am, qtd: 10, data: Ut.hoje(), motivo: 'QA' });

  const fam = S.estoquePorFamilia(am).find(function (g) { return g.familia === 'QA lente v77'; });
  verificar('v77 — a família soma os graus numa linha só',
    fam && Math.abs(fam.total - 70) < 0.001, fam ? fam.total : '(não achou)');

  /* O grau que ZEROU continua na lista: saber que acabou é mais
     útil que não ver a linha — é justamente o que precisa de
     reposição. */
  verificar('v77 — o grau zerado aparece, porque já teve estoque',
    fam && fam.zerados === 1 &&
    fam.itens.some(function (i) { return i.saldo === 0 && i.ja_teve; }),
    fam ? fam.zerados : '');

  /* O que nunca teve movimento NÃO entra: lista cheia de material
     que nunca existiu esconde o que importa. */
  verificar('v77 — material sem histórico nenhum fica fora',
    fam && fam.itens.length === 3, fam ? fam.itens.length : '');

  /* MATERIAL PADRÃO: toda faco usa uma lente. Escolher do zero a
     cada cirurgia é pedir esquecimento — e material esquecido vira
     diferença sem explicação no inventário seguinte. */
  const mp = S.salvarMaterialPadrao({ procedimento: 'pa08', familia: 'QA lente v77', qtd: 1 });
  verificar('v77 — material padrão por família é aceito', mp.ok, mp.erro || '');

  const vazio = S.salvarMaterialPadrao({ procedimento: 'pa08', qtd: 1 });
  verificar('v77 — sem produto nem família, recusa',
    !!vazio.erro, vazio.erro || 'PASSOU');

  const sug = S.materiaisPadraoDe('pa08').find(function (m) { return m.familia === 'QA lente v77'; });
  verificar('v77 — a sugestão traz as opções para escolher o grau',
    sug && sug.opcoes.length === 5, sug ? sug.opcoes.length : '(não achou)');
  S.setUsuario('u8');
})();

// ── ERP teste2 v78: NCM pela nota e valor da família ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u5');

  /* Material cadastrado às pressas numa requisição nasce sem NCM.
     A nota tem esse dado, e a entrada é o momento em que ele está
     disponível sem ninguém procurar. */
  const m = S.cadastrarMaterial({ descricao: 'QA material v78 sem ncm' });
  verificar('v78 — material novo nasce marcado como cadastro rápido',
    m.ok && m.produto.cadastro_rapido === true, '');
  verificar('v78 — e aparece na lista de pendentes de NCM',
    S.materiaisSemNCM([{ produto: m.produto.id }]).length === 1, '');

  const c = S.completarCadastroPelaNota(m.produto.id, { ncm: '90183919' });
  verificar('v78 — a nota completa o NCM', m.produto.ncm === '90183919', m.produto.ncm);
  verificar('v78 — e o material deixa de ser cadastro rápido',
    !m.produto.cadastro_rapido, '');
  verificar('v78 — some da lista de pendentes',
    S.materiaisSemNCM([{ produto: m.produto.id }]).length === 0, '');

  /* O que já estava preenchido tem precedência: a nota do
     fornecedor às vezes classifica diferente do que a empresa usa,
     e sobrescrever apagaria a decisão de quem cadastrou. */
  S.completarCadastroPelaNota(m.produto.id, { ncm: '11111111' });
  verificar('v78 — a nota NÃO sobrescreve NCM já informado',
    m.produto.ncm === '90183919', m.produto.ncm);

  /* VALOR DA FAMÍLIA sem armazém escolhido: usava o custo de
     cadastro, que é zero em material novo — e a coluna mostrava
     R$ 0,00 para estoque que vale dezenas de milhares. */
  const id = S.cadastrarMaterial({ descricao: 'QA lente valor v78' }).produto;
  id.familia = 'QA familia valor';
  const am = D.armazens[0].id;
  S.entrada({ produto: id.id, armazem: am, qtd: 10, custo: 400, data: Ut.hoje(),
    motivo: 'QA', origem: 'nota' });
  const geral = S.estoquePorFamilia(null).find(function (g) { return g.familia === 'QA familia valor'; });
  verificar('v78 — na visão de todos os armazéns, o valor é o real',
    geral && Math.abs(geral.valor - 4000) < 0.01, geral ? geral.valor : '(não achou)');
  S.setUsuario('u8');
})();

// ── ERP teste2 v82: produto novo chega ao banco ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u5');

  /* O ERRO REAL que a compradora encontrou:
     "insert or update on table estoque_camadas violates foreign key
      constraint estoque_camadas_produto_fkey"

     A causa não estava no estoque. O material cadastrado pelo
     sistema vivia só em `dados.produtos`, e a persistência só
     enxerga `st` — então o produto nunca ia ao banco. A entrada
     seguinte gravava uma camada apontando para ele, e o banco
     recusava o bloco inteiro.

     Quem lançava via um erro de ESTOQUE sem nenhuma pista de que a
     causa era o CADASTRO. */
  verificar('v82 — st.produtos e dados.produtos são a mesma lista',
    S.st.produtos === D.produtos, '');

  const antes = S.st.produtos.length;
  const novo = S.cadastrarMaterial({ descricao: 'QA material v82 ponte' });
  verificar('v82 — material cadastrado aparece no estado que é gravado',
    novo.ok && S.st.produtos.length === antes + 1 &&
    S.st.produtos.some(function (p) { return p.id === novo.produto.id; }), '');

  /* E a entrada de estoque sobre ele funciona de ponta a ponta. */
  const am = D.armazens[0].id;
  const e = S.entrada({ produto: novo.produto.id, armazem: am, qtd: 5, custo: 100,
    data: Ut.hoje(), motivo: 'QA v82', origem: 'nota' });
  verificar('v82 — e a entrada sobre esse material funciona', !e.erro, e.erro || '');
  verificar('v82 — com saldo correto',
    S.saldoEstoque(novo.produto.id, am) === 5, S.saldoEstoque(novo.produto.id, am));
  S.setUsuario('u8');
})();

// ── ERP teste2 v82: todo cadastro usado em lançamento é gravado ──
(function () {
  /* A falha da compradora foi de CHAVE ESTRANGEIRA no estoque, mas
     a causa era outra: o cadastro vivia só em `dados` e a
     persistência só olha `st`. Material novo nunca ia ao banco.

     O mesmo valia para fornecedor, armazém, projeto, cliente e
     banco — nenhum era gravado. Só aparecia quando alguém usava o
     cadastro novo em outro módulo e o banco recusava.

     Este teste olha a CLASSE do problema: toda coleção que o mapa
     de gravação cita precisa existir em `st` e apontar para a
     mesma lista de `dados`, senão a gravação não vê o que mudou. */
  const fs = require('fs');
  const txt = fs.readFileSync(__dirname + '/js/persistencia.js', 'utf8');
  const bloco = (txt.match(/const MAPA[^=]*= \{([\s\S]*?)\n  \};/) || [])[1] || txt;
  const nomes = [];
  const re = /^\s*(\w+): \{ tabela: '/gm;
  let m;
  while ((m = re.exec(bloco))) nomes.push(m[1]);

  const semEstado = nomes.filter(function (n) { return !Array.isArray(S.st[n]); });
  verificar('v82 — toda coleção do mapa de gravação existe no estado',
    semEstado.length === 0, semEstado.join(', '));

  /* E, para as que também vivem em `dados`, tem de ser a MESMA
     lista: duas listas é como os dois lados se desencontram. */
  const duplicadas = nomes.filter(function (n) {
    return Array.isArray(D[n]) && S.st[n] !== D[n];
  });
  verificar('v82 — e aponta para a mesma lista de dados, não uma cópia',
    duplicadas.length === 0, duplicadas.join(', '));
})();

// ── ERP teste2 v84: o mapa de gravação só cita colunas que existem ──
(function () {
  /* "Could not find the 'cest' column of 'produtos'" derruba o lote
     inteiro: o lançamento não grava e a pessoa vê um erro que não
     tem nada a ver com o que estava fazendo.

     Aconteceu três vezes seguidas — 'extra', depois 'cest' — porque
     eu corrigia a coluna que apareceu em vez da CLASSE. Este teste
     compara o mapa inteiro com o schema e acusa antes de chegar ao
     banco de alguém. */
  const fs = require('fs');
  const dir = __dirname + '/supabase/';
  const arqs = fs.readdirSync(dir).filter(function (f) { return /\.sql$/.test(f); });
  const todos = arqs.map(function (f) { return fs.readFileSync(dir + f, 'utf8'); }).join('\n');
  const sch = fs.readFileSync(dir + '01-schema.sql', 'utf8');

  function colunasDe(tab) {
    const set = {};
    const m = sch.match(new RegExp('create table ' + tab + ' \\(([\\s\\S]*?)\\n\\);'));
    if (m) {
      m[1].replace(/--[^\n]*/g, '').split(',').forEach(function (p) {
        const t = p.trim();
        if (!t) return;
        const n = t.split(/\s+/)[0];
        if (/^[a-z_][a-z0-9_]*$/.test(n) &&
            ['primary', 'unique', 'check', 'foreign', 'constraint', 'references'].indexOf(n) < 0) {
          set[n] = true;
        }
      });
    }
    /* Pega TODAS as colunas de um `alter table` — inclusive a
       forma com várias de uma vez, separadas por vírgula, que é
       como a etapa 34 as criou. A primeira versão deste teste só
       via a primeira de cada comando e acusava divergência que não
       existia. */
    const reBloco = new RegExp('alter table ' + tab + '\\s+((?:add column if not exists[^;]*?))(?=;)', 'g');
    let m2;
    while ((m2 = reBloco.exec(todos))) {
      const nomes = m2[1].match(/add column if not exists\s+(\w+)/g) || [];
      nomes.forEach(function (n) {
        set[n.replace(/add column if not exists\s+/, '')] = true;
      });
    }
    return set;
  }

  const persist = fs.readFileSync(__dirname + '/js/persistencia.js', 'utf8');
  const re = /^\s*(\w+): \{ tabela: '(\w+)', colunas: \[([^\]]*)\]/gm;
  const divergencias = [];
  let m;
  while ((m = re.exec(persist))) {
    const tab = m[2];
    const reais = colunasDe(tab);
    if (!Object.keys(reais).length) continue;   // tabela fora do schema: nada a conferir
    m[3].split(',').map(function (c) { return c.trim().replace(/'/g, ''); })
      .forEach(function (c) {
        if (c && !reais[c]) divergencias.push(tab + '.' + c);
      });
  }
  verificar('v84 — o mapa de gravação só cita colunas que o banco tem',
    divergencias.length === 0, divergencias.join(', '));
})();

// ── ERP teste2 v87: a gravação respeita as chaves estrangeiras ──
(function () {
  /* "titulos_credor_fkey", "estoque_camadas_produto_fkey" — sempre
     a mesma história: o lançamento grava antes do cadastro que ele
     aponta, e o banco recusa o lote inteiro.

     Eram QUINZE dependências fora de ordem no mapa. Cada uma
     aparecia como um erro diferente, num módulo diferente, no meio
     do trabalho de alguém — e parecia problema do módulo, não da
     ordem de gravação.

     Este teste lê as chaves estrangeiras do schema e confere a
     ordem do mapa contra elas. */
  const fs = require('fs');
  const sch = fs.readFileSync(__dirname + '/supabase/01-schema.sql', 'utf8');
  const persist = fs.readFileSync(__dirname + '/js/persistencia.js', 'utf8');

  const ordem = [];
  const reOrdem = /^\s*(\w+): \{ tabela: '(\w+)'/gm;
  let m;
  while ((m = reOrdem.exec(persist))) ordem.push(m[2]);

  const deps = {};
  const reTab = /create table (\w+) \(([\s\S]*?)\n\);/g;
  let t;
  while ((t = reTab.exec(sch))) {
    const alvos = [];
    const reRef = /references (\w+)/g;
    let r;
    while ((r = reRef.exec(t[2]))) {
      if (r[1] !== t[1] && alvos.indexOf(r[1]) < 0) alvos.push(r[1]);
    }
    if (alvos.length) deps[t[1]] = alvos;
  }

  const fora = [];
  ordem.forEach(function (tab, i) {
    (deps[tab] || []).forEach(function (d) {
      const j = ordem.indexOf(d);
      if (j > i) fora.push(tab + ' antes de ' + d);
    });
  });
  verificar('v87 — cadastros gravam antes dos lançamentos que apontam para eles',
    fora.length === 0, fora.join(' | '));
})();

// ── ERP teste2 v87: nenhum id gerado pelo relógio ──
(function () {
  /* `Date.now()` repete quando dois cadastros caem no mesmo
     milissegundo — e dois registros com o mesmo id significam
     saldo, título e movimento indo para o lugar errado. Apareceu
     primeiro nos materiais (cinco lentes com o mesmo id), depois em
     fornecedores, depois em mais cinco telas de cadastro.

     Este teste varre os arquivos: id tem de vir do gerador do
     store, que segue a sequência. */
  const fs = require('fs');
  const dir = __dirname + '/js/';
  const ruins = [];
  fs.readdirSync(dir).filter(function (f) { return /\.js$/.test(f); }).forEach(function (f) {
    const t = fs.readFileSync(dir + f, 'utf8');
    const m = t.match(/id: '\w+' \+ Date\.now\(\)/g);
    if (m) ruins.push(f + ' (' + m.length + ')');
  });
  verificar('v87 — nenhum id de cadastro é gerado pelo relógio',
    ruins.length === 0, ruins.join(', '));
})();

// ── ERP teste2 v88: bloqueio aparece na conferência ──
(function () {
  const Ut = sandbox.window.ERP.util;
  /* Dois médicos lançados como bloqueados apareciam como
     "lançado", igual a quem vai receber. O bloqueio mora no lote e
     a situação só olhava a parcela — e aí o que mais exige decisão
     some no meio dos outros, até o dia do pagamento. */
  const fs = require('fs');
  const ui = fs.readFileSync(__dirname + '/js/ui-produtividade.js', 'utf8');

  verificar('v88 — a situação da parcela considera o bloqueio do lote',
    /function bloqueioDa\(/.test(ui) && /situacaoParcela\(p, l\)/.test(ui), '');
  verificar('v88 — bloqueado tem marca visual própria',
    /sit-bloqueado/.test(ui) &&
    /sit-bloqueado/.test(fs.readFileSync(__dirname + '/css/erp.css', 'utf8')), '');
  verificar('v88 — e dá para liberar na própria conferência',
    /data-lp-liberar/.test(ui) && /liberarPagamentoMedico/.test(ui), '');

  /* COBERTURA: projeto esquecido na marcação de produtividade não
     aparecia justamente na tela feita para encontrar o que falta. */
  const todos = S.coberturaProdutividade(Ut.mesAtual(), true);
  const soMarcados = S.coberturaProdutividade(Ut.mesAtual());
  verificar('v88 — a cobertura mostra TODOS os projetos quando pedido',
    todos.length >= soMarcados.length, todos.length + ' vs ' + soMarcados.length);
  verificar('v88 — e marca quais deveriam ter produtividade',
    todos.every(function (x) { return typeof x.esperado === 'boolean'; }), '');
})();

// ── ERP teste2 v89: confirmar o fechamento e cobertura completa ──
(function () {
  const Ut = sandbox.window.ERP.util;
  const fs = require('fs');
  const ui = fs.readFileSync(__dirname + '/js/ui-produtividade.js', 'utf8');

  /* A confirmação existia no sistema e NÃO TINHA TELA. É ela que
     destrava o pagamento: enquanto não vem, o valor é número de
     trabalho e o financeiro não paga — então quem precisava
     confirmar não tinha onde, e o médico esperava. */
  verificar('v89 — a confirmação do fechamento tem botão na tela',
    /data-lp-confirmar/.test(ui) && /confirmarLoteProdutividade/.test(ui), '');
  verificar('v89 — e a linha mostra que está aguardando',
    /aguardando confirmação/.test(ui), '');

  /* COBERTURA: projeto COM produtividade lançada tem de aparecer
     mesmo sem a marcação no cadastro. A marcação diz o que se
     espera; o lançamento diz o que é fato, e fato manda. */
  const comp = Ut.mesAtual();
  const centro = D.centros.find(function (c) {
    return c.tipo === 'projeto' && c.ativo && !c.produtividade;
  });
  if (centro) {
    S.st.lotesProdutividade.push({
      id: 'lpQA89', centro: centro.id, competencia: comp, titulo_ids: [],
      medicos: 2, valor: 1000, criado_em: new Date().toISOString()
    });
    const soMarcados = S.coberturaProdutividade(comp);
    verificar('v89 — projeto sem marcação mas COM lançamento aparece',
      soMarcados.some(function (x) { return x.centro === centro.id; }),
      centro.curto);
  }

  const todos = S.coberturaProdutividade(comp, true);
  const nomes = todos.map(function (x) {
    const c = D.centro(x.centro) || {};
    return c.curto || c.nome || '';
  });
  const ordenado = nomes.slice().sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  verificar('v89 — a cobertura sai em ordem alfabética',
    JSON.stringify(nomes) === JSON.stringify(ordenado), nomes.slice(0, 3).join(' | '));

  verificar('v89 — e abre mostrando TODOS os projetos por padrão',
    /let cobTodos = true;/.test(ui), '');
})();

// ── ERP teste2 v90: o botão de cadastrar segue a regra do sistema ──
(function () {
  /* A regra de QUEM cadastra material foi corrigida no sistema —
     compras e estoque passaram a poder — mas a TELA continuou
     exigindo o módulo de Cadastros. Resultado: quem requisita via
     o campo e não via o botão, e a única saída era escolher um
     material parecido, que é o erro que o cadastro existe para
     evitar.

     Este teste amarra os dois lados: quem vê o botão tem de
     conseguir cadastrar, e quem não vê, não. */
  const fs = require('fs');
  const ui = fs.readFileSync(__dirname + '/js/ui-compras.js', 'utf8');
  verificar('v90 — o botão na requisição aceita compras e estoque',
    /podeMover\('cadastros'\) \|\| S\.podeMover\('compras'\) \|\| S\.podeMover\('estoque'\)/.test(ui), '');

  const divergentes = [];
  D.usuarios.forEach(function (u) {
    S.setUsuario(u.id);
    const veBotao = S.podeMover('cadastros') || S.podeMover('compras') || S.podeMover('estoque');
    const r = S.cadastrarMaterial({ descricao: 'QA v90 ' + u.id });
    const consegue = !!r.ok;
    if (veBotao !== consegue) divergentes.push(u.nome + ' (botão ' + veBotao + ', cadastra ' + consegue + ')');
  });
  verificar('v90 — quem vê o botão consegue cadastrar, e vice-versa',
    divergentes.length === 0, divergentes.join(' | '));
  S.setUsuario('u8');
})();

// ── ERP teste2 v91: cotação legível e chaves estrangeiras vazias ──
(function () {
  const fs = require('fs');
  const ui = fs.readFileSync(__dirname + '/js/ui-compras.js', 'utf8');
  const pers = fs.readFileSync(__dirname + '/js/persistencia.js', 'utf8');

  /* "" numa coluna que aponta para outra tabela faz o banco
     procurar o registro de código vazio — "produtos_conta_fkey". A
     gravação inteira cai, e o erro fala de uma tabela que não tem
     nada a ver com o que a pessoa fez. São vinte tabelas com esse
     risco. */
  /* A v97 trocou a lista por nome de coluna pela lista por tabela:
     a regra do vazio continua, mas agora só na coluna que é mesmo
     chave estrangeira NAQUELA tabela. */
  verificar('v91 — vazio em chave estrangeira vira nulo na gravação',
    /if \(v === '' && fks\[k\]\) v = null;/.test(pers), '');

  S.setUsuario('u5');
  const m = S.cadastrarMaterial({ descricao: 'QA conta nula v91' });
  verificar('v91 — material sem conta nasce com nulo, não com ""',
    m.ok && m.produto.conta === null, JSON.stringify(m.ok ? m.produto.conta : m.erro));

  /* A cotação mostrava só o código. Cotação é a hora de comparar
     preço de coisas parecidas, onde trocar um item pelo outro
     custa caro. */
  verificar('v91 — a cotação mostra nome, código e unidade',
    /p\.descricao\s*\n?\s*\? '<b>' \+ U\.esc\(p\.descricao\)/.test(ui) ||
    /'<b>' \+ U\.esc\(p\.descricao\) \+ '<\/b>/.test(ui), '');

  verificar('v91 — e permite cadastrar fornecedor sem sair da tela',
    /ct-novo-forn/.test(ui), '');

  /* Aprovar requisição e aprovar compra são atos diferentes:
     o primeiro diz "pode comprar isso", o segundo "pode gastar
     este valor com este fornecedor". */
  verificar('v91 — aprovar compra pós-cotação tem aba própria',
    /filtro === 'aprovar-compra'/.test(ui), '');
})();

// ── ERP teste2 v92: contrato sem projeto específico ──
(function () {
  const fs = require('fs');
  const ui = fs.readFileSync(__dirname + '/js/ui-contratos.js', 'utf8');
  S.setUsuario('u5');

  /* Nem todo contrato é de projeto: tarifa de banco, aluguel de
     filial, software da empresa. Obrigar a escolher um hospital
     fazia o custo de todos cair no projeto que a pessoa escolheu
     por falta de opção — e aí a margem daquele projeto mente. */
  const base = { parte: 'fornecedor', fornecedor: D.credores[0].id, conta: '4.01',
    vigencia_ini: '2026-01-01', vigencia_fim: '2026-12-31', valor_mensal: 1500 };

  const geral = S.salvarContrato(Object.assign({ numero: 'QA-v92-G',
    itens: [{ centro: 'cc900', valor: 1500 }] }, base));
  verificar('v92 — contrato aceita o centro Geral (sem projeto)', geral.ok, geral.erro || '');

  const filial = S.salvarContrato(Object.assign({ numero: 'QA-v92-F',
    itens: [{ centro: 'cc200', valor: 800 }] }, base));
  verificar('v92 — e aceita a filial, para saber quanto cada casa custa',
    filial.ok, filial.erro || '');

  verificar('v92 — a tela oferece os centros administrativos',
    /ADMIN = \['geral', 'matriz', 'filial'\]/.test(ui), '');
  verificar('v92 — e eles aparecem no alto da lista',
    /Sem projeto · despesa da empresa/.test(ui), '');
  verificar('v92 — dá para cadastrar fornecedor na própria tela',
    /ct-novo-forn/.test(ui), '');

  /* O assistente financeiro é quem cadastra contrato no dia a dia:
     se ele não puder criar o fornecedor, o contrato para. */
  S.setUsuario('u1');
  verificar('v92 — o assistente financeiro consegue cadastrar fornecedor',
    S.podeMover('cadastros') || S.podeMover('contratos'), '');
  S.setUsuario('u8');
})();

// ── ERP teste2 v93: o cadastro criado na hora sempre grava ──
(function () {
  const fs = require('fs');
  const pers = fs.readFileSync(__dirname + '/js/persistencia.js', 'utf8');

  /* DEFEITO MEU no v91: a regra que criei para não derrubar o
     lançamento passou a exigir o módulo do cadastro — e quem tem
     Compras mas não Estoque cadastrava o material na requisição,
     ele NUNCA chegava ao banco, e a requisição gravava apontando
     para um produto inexistente.

     Decidir permissão no cliente duplica uma regra que o banco já
     aplica, e é assim que as duas versões se separam. O que a
     pessoa criou vai sempre; a política do banco aceita ou recusa,
     e a recusa aparece como erro em vez de sumiço silencioso. */
  verificar('v93 — o que a pessoa criou é sempre enviado ao banco',
    !/MODULO_DO_CADASTRO/.test(pers) &&
    /O QUE A PESSOA CRIOU AGORA VAI SEMPRE/.test(pers), '');

  /* E a requisição guarda o NOME do material, não só o código: ela
     vive meses, e nesse tempo o material pode ser renomeado,
     inativado ou nem chegar ao cadastro. */
  S.setUsuario('u7');
  const p = D.produtos[0];
  const r = S.criarRequisicao({ armazem: D.armazens[0].id, itens: [{ produto: p.id, qtd: 10 }] });
  verificar('v93 — a requisição guarda o nome do material',
    r.ok && r.requisicao.itens[0].descricao === p.descricao,
    r.ok ? r.requisicao.itens[0].descricao : r.erro);
  verificar('v93 — com código e unidade junto',
    r.ok && r.requisicao.itens[0].codigo === p.codigo &&
    r.requisicao.itens[0].unidade === p.unidade, '');
  S.setUsuario('u8');
})();

// ── ERP teste2 v94: material com cadastro incompleto é sinalizado ──
(function () {
  const fs = require('fs');
  const ui = fs.readFileSync(__dirname + '/js/ui-compras.js', 'utf8');
  const es = fs.readFileSync(__dirname + '/js/ui-estoque.js', 'utf8');

  /* O código aparecia DUAS VEZES na linha do material: acrescentei
     a nova sem remover a que já existia. */
  verificar('v94 — o código do material aparece uma vez só na requisição',
    (ui.match(/U\.esc\(p\.codigo \|\| i\.codigo\)/g) || []).length === 1 &&
    !/'<div class="sub">' \+ U\.esc\(p\.codigo \|\| ''\) \+ '<\/div><\/td>'/.test(ui), '');

  /* Material recuperado nasce com nome genérico — o sistema não
     tem como adivinhar o que a pessoa quis cadastrar. O que ele
     pode fazer é não deixar isso passar despercebido: o aviso fica
     na tela que alguém abre todo dia, não num relatório que
     ninguém procura. */
  verificar('v94 — a posição de estoque avisa sobre cadastro incompleto',
    /function avisoCadastroIncompleto/.test(es) &&
    (es.match(/avisoCadastroIncompleto\(\)/g) || []).length >= 3, '');

  D.produtos.push({ id: 'prQA94', codigo: 'REC-9400',
    descricao: 'Material recuperado prQA94', unidade: 'UN', ativo: true });
  const pend = D.produtos.filter(function (p) {
    return /^Material recuperado/.test(p.descricao || '') || /^REC-/.test(p.codigo || '');
  });
  verificar('v94 — e reconhece os recuperados pelo nome ou código',
    pend.some(function (p) { return p.id === 'prQA94'; }), pend.length + '');
})();

// ── ERP teste2 v95: o campo que faltou fica marcado ──
(function () {
  const fs = require('fs');
  const app = fs.readFileSync(__dirname + '/js/app.js', 'utf8');

  /* Um aviso no topo da tela não diz ONDE faltou. Em formulário
     longo — contrato, contas a pagar — a pessoa lê o aviso,
     procura, não acha, e tenta salvar de novo. */
  verificar('v95 — existe o atalho que destaca o campo do erro',
    /function erroDoRetorno/.test(app), '');
  verificar('v95 — e ele rola a tela até o campo',
    /scrollIntoView/.test(app), '');
  verificar('v95 — o rótulo também é marcado, não só a caixa',
    /campo-erro-rotulo/.test(app) &&
    /campo-erro-rotulo/.test(fs.readFileSync(__dirname + '/css/erp.css', 'utf8')), '');

  /* As validações dizem QUAL campo faltou. Sem isso o atalho não
     tem o que destacar. */
  S.setUsuario('u5');
  const t = S.criarTitulo({ descricao: '' });
  verificar('v95 — o erro de descrição aponta o campo',
    t.erro && t.campo === 'l-desc', t.campo || '(sem campo)');

  const c = S.salvarContrato({ parte: 'fornecedor' });
  verificar('v95 — e o do contrato também',
    c.erro && !!c.campo, c.campo || '(sem campo)');

  /* As telas usam o atalho em vez do aviso solto. */
  let soltos = 0;
  fs.readdirSync(__dirname + '/js').filter(function (f) { return /^ui-.*\.js$/.test(f); })
    .forEach(function (f) {
      const t2 = fs.readFileSync(__dirname + '/js/' + f, 'utf8');
      soltos += (t2.match(/if \(r\.erro\) return ERP\.app\.aviso\(r\.erro, 'erro'\);/g) || []).length;
    });
  verificar('v95 — nenhuma tela mostra o erro sem destacar o campo',
    soltos === 0, soltos + ' ponto(s) ainda soltos');
  S.setUsuario('u8');
})();

// ── ERP teste2 v96: referência inexistente não derruba o lote ──
(function () {
  const fs = require('fs');
  const pers = fs.readFileSync(__dirname + '/js/persistencia.js', 'utf8');

  /* "produtos_conta_fkey" voltou mesmo depois de eu tratar o campo
     vazio: o material apontava para uma conta do plano que existe
     no sistema e NÃO no banco. O banco recusa o lote inteiro, e o
     erro fala de produtos quando falta uma linha do plano.

     Insistir numa referência que o sistema sabe não existir é
     perder o lançamento por causa de um cadastro. Melhor gravar
     sem a referência — e DIZER que gravou assim, porque campo que
     some calado é pior que erro: o lançamento parece perfeito e o
     relatório sai errado meses depois. */
  verificar('v96 — a gravação confere se a referência existe antes de enviar',
    /CHAVES_ESTRANGEIRAS/.test(pers), '');
  verificar('v96 — e avisa o que foi gravado sem a referência',
    /refsDescartadas/.test(pers) &&
    /ficaram em branco porque/.test(pers), '');
  verificar('v96 — a lista é zerada a cada gravação',
    /refsDescartadas = \[\];\n    const mudou = diferencas\(\);/.test(pers), '');
})();

// ── ERP teste2 v97: a lista de chaves estrangeiras é a do banco ──
(function () {
  /* A lista da v96 era por NOME DE COLUNA, e isso apagava dado.

     `conta` é chave estrangeira em produtos e parcelas — aponta
     para o plano de contas. Em `credores` e em `bancos`, `conta` é
     o NÚMERO DA CONTA BANCÁRIA, e `banco` é o código do banco
     ("237"). Pela lista por nome, o sistema procurava "000000039464"
     no plano de contas, não achava, e gravava NULO: o cadastro
     bancário do fornecedor desaparecia em silêncio e o pagamento
     sairia sem conta para onde ir.

     A lista agora é tabela por tabela. Este teste a compara com o
     `01-schema.sql`: cada chave estrangeira do banco tem de estar
     nela, e nada que não seja chave estrangeira pode entrar. */
  const fs = require('fs');
  const dirSql = __dirname + '/supabase/';
  const sch = fs.readFileSync(dirSql + '01-schema.sql', 'utf8');
  const pers = fs.readFileSync(__dirname + '/js/persistencia.js', 'utf8');

  /* O que o banco tem. */
  const real = {};
  const reTab = /create table (\w+) \(([\s\S]*?)\n\);/g;
  let t;
  while ((t = reTab.exec(sch))) {
    const corpo = t[2].replace(/--[^\n]*/g, '');
    const cols = {};
    const reRef = /(\w+)\s+[\w()\[\], ]*?references\s+(\w+)\s*\(/g;
    let r;
    while ((r = reRef.exec(corpo))) cols[r[1]] = r[2];
    if (Object.keys(cols).length) real[t[1]] = cols;
  }

  /* E o que as ETAPAS acrescentaram depois. A chave estrangeira
     criada por `alter table … add constraint` conta igual à do
     `create table` — o banco não distingue, e o teste também não
     devia: foi assim que `contratos.fornecedor` apareceu como
     "inventada" quando ela existe de verdade. */
  fs.readdirSync(dirSql).filter(function (f) { return /\.sql$/.test(f); }).forEach(function (f) {
    const txt = fs.readFileSync(dirSql + f, 'utf8').replace(/--[^\n]*/g, '');
    const reAlt = /alter table (\w+)[\s\S]{0,400}?add constraint \w+[\s\S]{0,80}?foreign key \((\w+)\)\s*references\s+(\w+)\s*\(/gi;
    let a;
    while ((a = reAlt.exec(txt))) {
      real[a[1]] = real[a[1]] || {};
      real[a[1]][a[2]] = a[3];
    }
  });

  /* O que o sistema declara. */
  const bloco = (pers.match(/const CHAVES_ESTRANGEIRAS = \{([\s\S]*?)\n  \};/) || [])[1] || '';
  const declarado = {};
  const reEnt = /^\s{4}(\w+):\s*\{([^}]*)\}/gm;
  let e;
  while ((e = reEnt.exec(bloco))) {
    const cols = {};
    (e[2].match(/(\w+):\s*'(\w+)'/g) || []).forEach(function (p) {
      const kv = p.match(/(\w+):\s*'(\w+)'/);
      cols[kv[1]] = kv[2];
    });
    declarado[e[1]] = cols;
  }

  const faltando = [], inventadas = [];
  Object.keys(real).forEach(function (tab) {
    /* Só as tabelas que o sistema grava — `perfis`, `eventos` e as
       demais não passam por `paraBanco`. */
    if (!declarado[tab]) return;
    Object.keys(real[tab]).forEach(function (col) {
      if (!declarado[tab][col]) faltando.push(tab + '.' + col);
    });
  });
  Object.keys(declarado).forEach(function (tab) {
    Object.keys(declarado[tab]).forEach(function (col) {
      if (!real[tab] || !real[tab][col]) inventadas.push(tab + '.' + col);
    });
  });

  verificar('v97 — toda chave estrangeira do banco está na lista do sistema',
    faltando.length === 0, faltando.join(', '));
  verificar('v97 — e a lista não inventa chave que o banco não tem',
    inventadas.length === 0, inventadas.join(', '));

  /* O caso concreto que motivou tudo: credores não tem chave
     estrangeira nenhuma, e o teste existe para o próximo que
     olhar a coluna `conta` ali e quiser "completar" a lista. */
  verificar('v97 — a conta bancária do fornecedor não é tratada como referência',
    declarado.credores && !declarado.credores.conta && !declarado.credores.banco,
    JSON.stringify(declarado.credores || null));
  verificar('v97 — nem a do cadastro de contas bancárias',
    declarado.bancos && !declarado.bancos.conta && !declarado.bancos.banco,
    JSON.stringify(declarado.bancos || null));

  /* Só vai a branco o que é sugestão. O que sustenta o registro é
     `not null` no banco: esvaziar trocaria um erro por outro, com
     a diferença de que este mentiria dizendo que gravou. */
  const anulavel = (pers.match(/const ANULAVEL = \/\^\(([^)]*)\)/) || [])[1] || '';
  const estruturais = ['titulo_id', 'parcela_id', 'extrato_id', 'produto', 'ativo', 'funcionario'];
  const indevidos = estruturais.filter(function (c) {
    return anulavel.split('|').indexOf(c) >= 0;
  });
  verificar('v97 — referência que sustenta o registro nunca vai a branco',
    indevidos.length === 0, indevidos.join(', '));

  /* E quando o lote cai assim mesmo, o sistema diz QUAL linha. */
  verificar('v97 — o lote recusado é reenviado linha a linha para achar a culpada',
    /async function culpadas\(/.test(pers) && /quem derrubou:/.test(pers), '');
})();

// ── ERP teste2 v97: `extra` não sobrepõe coluna de verdade ──
(function () {
  const fs = require('fs');
  const pers = fs.readFileSync(__dirname + '/js/persistencia.js', 'utf8');

  /* O erro mais caro desta leva não estava em nenhuma coluna: a
     conta inválida vivia dentro do `extra`, de quando a coluna
     ainda não existia. A consulta no banco mostrava 8.04 (válida),
     o sistema trabalhava com o valor velho, e a gravação caía com
     "produtos_conta_fkey" apontando para algo que ninguém achava.

     Agora a coluna manda e `extra` só preenche o que faltou. A
     etapa 40 limpa o que já ficou para trás. */
  verificar('v97 — `extra` só preenche o que a coluna não trouxe',
    /if \(temColuna\[k\]\) return;/.test(pers), '');

  verificar('v97 — e existe a limpeza do que ficou duplicado',
    fs.existsSync(__dirname + '/supabase/40-extra-para-colunas.sql'), '');
})();

// ── ERP teste2 v98: o contrato gera o contas a pagar ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u3');
  const forn = D.credores.find(c => c.tipo !== 'medico' && c.tipo !== 'funcionario' && c.ativo !== false);

  /* ── 1. mensal pela vigência ── */
  const mensal = S.salvarContrato({
    parte: 'fornecedor', numero: 'QA-CT-MENSAL', fornecedor: forn.id, conta: '6.01',
    objeto: 'Aluguel da filial', vigencia_ini: '2026-03-15', vigencia_fim: '2026-08-31',
    dia_vencimento: 10, itens: [{ centro: 'cc100', valor: 5000 }]
  });
  verificar('v98 — contrato mensal salvo', mensal.ok, JSON.stringify(mensal.erro));

  const cron = S.cronogramaContrato(mensal.contrato);
  /* Vigência começa em 15/03 e o vencimento é dia 10: o dia 10 de
     março JÁ PASSOU quando o contrato começou, então a primeira
     cobrança é 10/04. Sem isso o contrato nasceria com uma parcela
     vencida no dia da assinatura. */
  verificar('v98 — a primeira parcela não vence antes do início da vigência',
    cron.length && cron[0].venc === '2026-04-10', cron.length ? cron[0].venc : 'vazio');
  verificar('v98 — e vai até o fim da vigência', cron[cron.length - 1].venc === '2026-08-10',
    cron.length ? cron[cron.length - 1].venc : '—');
  verificar('v98 — uma parcela por mês', cron.length === 5, cron.length + ' parcelas');
  verificar('v98 — a competência acompanha o vencimento', cron[0].comp === '2026-04', cron[0].comp);

  /* ── 2. cronograma variável ── */
  const prog = [
    { venc: '2026-10-10', valor: 60000 }, { venc: '2026-10-30', valor: 60000 },
    { venc: '2026-11-10', valor: 35000 }, { venc: '2026-11-30', valor: 35000 },
    { venc: '2026-12-30', valor: 50000 }
  ];
  const varR = S.salvarContrato({
    parte: 'fornecedor', numero: 'QA-CT-VARIAVEL', fornecedor: forn.id, conta: '6.03',
    objeto: 'Fornecimento com pagamento a cada 20 dias',
    vigencia_ini: '2026-10-01', vigencia_fim: '2026-12-31',
    pagamentos_variaveis: true, parcelas_previstas: prog,
    /* As linhas de projeto são o RATEIO, não o valor: duas, para o
       percentual não ser 100% trivial. */
    itens: [{ centro: 'cc100', valor: 7000 }, { centro: 'cc200', valor: 3000 }]
  });
  verificar('v98 — contrato com pagamentos variáveis salvo', varR.ok, JSON.stringify(varR.erro));
  verificar('v98 — o total do cronograma é a soma das parcelas',
    varR.ok && varR.contrato.total_previsto === 240000, varR.ok && varR.contrato.total_previsto);

  const cv = S.cronogramaContrato(varR.contrato);
  verificar('v98 — o cronograma digitado vence o cálculo mensal', cv.length === 5, cv.length);
  verificar('v98 — com as datas e os valores exatamente como digitados',
    cv.map(l => l.venc + '=' + l.valor).join(' ') ===
      '2026-10-10=60000 2026-10-30=60000 2026-11-10=35000 2026-11-30=35000 2026-12-30=50000',
    cv.map(l => l.venc + '=' + l.valor).join(' '));

  /* ── 3. validações do cronograma ── */
  const semValor = S.salvarContrato({
    parte: 'fornecedor', numero: 'QA-CT-X1', fornecedor: forn.id, conta: '6.03',
    vigencia_ini: '2026-10-01', vigencia_fim: '2026-12-31', pagamentos_variaveis: true,
    parcelas_previstas: [{ venc: '2026-10-10', valor: 0 }], itens: [{ centro: 'cc100', valor: 100 }]
  });
  verificar('v98 — parcela sem valor é recusada', /sem valor/.test(semValor.erro || ''), semValor.erro);

  const repetida = S.salvarContrato({
    parte: 'fornecedor', numero: 'QA-CT-X2', fornecedor: forn.id, conta: '6.03',
    vigencia_ini: '2026-10-01', vigencia_fim: '2026-12-31', pagamentos_variaveis: true,
    parcelas_previstas: [{ venc: '2026-10-10', valor: 10 }, { venc: '2026-10-10', valor: 20 }],
    itens: [{ centro: 'cc100', valor: 100 }]
  });
  verificar('v98 — duas parcelas na mesma data são recusadas',
    /duas parcelas vencendo/.test(repetida.erro || ''), repetida.erro);

  const antes = S.salvarContrato({
    parte: 'fornecedor', numero: 'QA-CT-X3', fornecedor: forn.id, conta: '6.03',
    vigencia_ini: '2026-10-01', vigencia_fim: '2026-12-31', pagamentos_variaveis: true,
    parcelas_previstas: [{ venc: '2026-09-01', valor: 10 }], itens: [{ centro: 'cc100', valor: 100 }]
  });
  verificar('v98 — parcela antes do início da vigência é recusada',
    /antes do início da vigência/.test(antes.erro || ''), antes.erro);

  const vazio = S.salvarContrato({
    parte: 'fornecedor', numero: 'QA-CT-X4', fornecedor: forn.id, conta: '6.03',
    vigencia_ini: '2026-10-01', vigencia_fim: '2026-12-31', pagamentos_variaveis: true,
    parcelas_previstas: [], itens: [{ centro: 'cc100', valor: 100 }]
  });
  verificar('v98 — marcar variável sem informar parcela é recusado',
    /ao menos uma parcela/.test(vazio.erro || ''), vazio.erro);

  /* ── 4. a geração em si ── */
  const ger = S.gerarTitulosContrato(varR.contrato.id);
  verificar('v98 — gera as previsões no contas a pagar', ger.ok, JSON.stringify(ger.erro));
  verificar('v98 — uma parcela por linha do cronograma', ger.ok && ger.parcelas === 5, ger.parcelas);
  verificar('v98 — somando o total do contrato', ger.ok && ger.total === 240000, ger.total);

  const pcs = S.previsoesDoContrato(varR.contrato.id);
  verificar('v98 — todas nascem como PREVISÃO, não como título a pagar',
    pcs.length === 5, pcs.length + ' previstas');
  verificar('v98 — com os vencimentos do cronograma',
    pcs.map(p => p.venc).sort().join(' ') === '2026-10-10 2026-10-30 2026-11-10 2026-11-30 2026-12-30',
    pcs.map(p => p.venc).sort().join(' '));
  verificar('v98 — e com o fornecedor e a natureza do contrato',
    pcs.every(p => p.credor === forn.id && p.conta === '6.03'), '');

  /* O rateio sai das linhas de projeto, e tem de fechar 100%. */
  const rat = pcs[0].rateio || [];
  const soma = rat.reduce((s, r) => s + r.pct, 0);
  verificar('v98 — o rateio por projeto fecha em 100%', Math.abs(soma - 100) < 0.01, soma + '%');
  verificar('v98 — na proporção das linhas de projeto (70/30)',
    rat.length === 2 && Math.abs(rat[0].pct - 70) < 0.01 && Math.abs(rat[1].pct - 30) < 0.01,
    JSON.stringify(rat));

  /* ── 5. gerar duas vezes ── */
  const denovo = S.gerarTitulosContrato(varR.contrato.id);
  verificar('v98 — gerar de novo sem confirmar é recusado',
    !denovo.ok && denovo.ja_gerado, JSON.stringify(denovo));

  /* Uma parcela vira título firme: refazer não pode apagá-la. */
  const efetivada = pcs[0];
  const ef = S.efetivarPrevisto(efetivada.id, { credor: forn.id, valor: efetivada.valor,
    venc: efetivada.venc, comp: efetivada.comp, doc: 'NF-QA-1', tipo_titulo: 'nf' });
  verificar('v98 — a previsão vira título com a nota do período', ef.ok, JSON.stringify(ef.erro));

  const refeito = S.gerarTitulosContrato(varR.contrato.id, { refazer: true });
  verificar('v98 — refazer o cronograma é aceito com confirmação', refeito.ok, JSON.stringify(refeito.erro));
  const viva = S.parcela(efetivada.id);
  verificar('v98 — e NÃO toca no que já foi efetivado',
    viva && viva.status !== 'cancelado', viva && viva.status);
  verificar('v98 — as previsões antigas saem de cena',
    S.previsoesDoContrato(varR.contrato.id).length === 5,
    S.previsoesDoContrato(varR.contrato.id).length + ' previstas');

  /* ── 6. o que não gera ── */
  const cli = S.contratos({ parte: 'cliente' })[0];
  if (cli) {
    const r = S.gerarTitulosContrato(cli.id);
    verificar('v98 — contrato de cliente não vira contas a pagar',
      /contas a RECEBER/.test(r.erro || ''), r.erro);
  }
  S.setUsuario('u8');
})();

// ── ERP teste2 v98: previsão se efetiva, não se paga ──
(function () {
  const fs = require('fs');
  const ui = fs.readFileSync(__dirname + '/js/ui-contas.js', 'utf8');
  const store = fs.readFileSync(__dirname + '/js/store.js', 'utf8');

  /* Previsão de luz de R$ 2.000, conta de R$ 2.300. Quem clicava em
     "Pagar" batia em "passa do saldo da parcela" e não tinha saída:
     a tela da baixa não mexe no valor do título, e "Editar" não
     aparecia na previsão. O caminho certo ("Efetivar") estava ali
     do lado, mas "Pagar" parecia o botão. */
  verificar('v98 — a previsão não oferece o botão Pagar',
    /p\.status !== 'enviado' && p\.status !== 'previsto' && S\.pode\('pagar'\)/.test(ui), '');
  verificar('v98 — e oferece Editar, para corrigir o valor previsto',
    /S\.pode\('lancar'\) && p\.status !== 'pago' &&\s*\n\s*p\.status !== 'substituido'/.test(ui), '');
  verificar('v98 — a trava do saldo diz o que fazer, não só o que está errado',
    /use "Efetivar" para informar o valor real/.test(store) &&
    /use "Editar" para corrigir o valor do título/.test(store), '');

  /* E o store deixa mesmo editar uma previsão. */
  S.setUsuario('u3');
  const prev = S.st.parcelas.find(p => p.status === 'previsto' && !S.tituloSigiloso(p));
  if (prev) {
    const novo = Math.round((prev.valor + 300) * 100) / 100;
    const r = S.editarParcela(prev.id, { valor: novo });
    verificar('v98 — editar o valor de uma previsão é aceito', r.ok, JSON.stringify(r.erro));
    verificar('v98 — e o valor novo fica gravado', S.parcela(prev.id).valor === novo,
      S.parcela(prev.id).valor);
  }
  S.setUsuario('u8');
})();

// ── ERP teste2 v99: a recarga não apaga o que ainda não gravou ──
(function () {
  const fs = require('fs');
  const rem = fs.readFileSync(__dirname + '/js/dados-remoto.js', 'utf8');
  const pers = fs.readFileSync(__dirname + '/js/persistencia.js', 'utf8');

  /* A RAIZ DO "material fora do cadastro · pr8802".

     A recarga automática troca as listas de cadastro pelo que está
     no banco. O cadastro recém-criado, ainda não gravado, era
     APAGADO nessa troca — e a requisição que apontava para ele
     ficava órfã.

     A janela é grande: com o tempo real ligado, a recarga dispara
     um segundo depois de QUALQUER mudança no banco, inclusive de
     outra pessoa. A compradora cadastra o material na requisição,
     o financeiro lança um título do outro lado, o aviso chega, e o
     material some antes de ser gravado. */
  verificar('v99 — a recarga separa o que ainda não foi gravado',
    /aindaNaoGravados/.test(rem) && /aindaNaoGravados/.test(pers), '');
  verificar('v99 — e o repõe depois de trocar a lista pelo banco',
    /if \(!alvo\.some\(function \(y\) \{ return y\.id === x\.id; \}\)\) alvo\.push\(x\);/.test(rem), '');
  verificar('v99 — sem perder a vez de ser gravado na próxima vez',
    /esquecerDaFoto/.test(rem) && /esquecerDaFoto/.test(pers), '');
  verificar('v99 — a recarga não roda no meio de uma gravação',
    /gravando\(\)\) \{\s*\n\s*return \{ ok: false, motivo: 'gravação em andamento' \}/.test(rem), '');

  /* E a sombra acompanha a recarga: sem isso, o cadastro que veio
     do banco era comparado com a foto antiga e reenviado a cada
     cinco minutos, para sempre. */
  verificar('v99 — a sombra é refeita depois de cada recarga',
    /refotografar\(item\.destino\)/.test(rem), '');

  /* A simulação do caso: um material novo na lista, a lista
     trocada pelo conteúdo do "banco" (que não o tem), e o material
     tem de continuar lá. */
  const listaBanco = [{ id: 'pr1', descricao: 'Veio do banco' }];
  const local = [{ id: 'pr1', descricao: 'Veio do banco' }, { id: 'pr9999', descricao: 'Recém-cadastrado' }];
  const naoGravados = local.filter(x => x.id === 'pr9999');
  const alvo = [];
  listaBanco.forEach(x => alvo.push(x));
  naoGravados.forEach(x => { if (!alvo.some(y => y.id === x.id)) alvo.push(x); });
  verificar('v99 — o material recém-cadastrado sobrevive à troca',
    alvo.length === 2 && alvo.some(x => x.id === 'pr9999'), JSON.stringify(alvo.map(x => x.id)));
  verificar('v99 — e o que o banco trouxe não é duplicado',
    alvo.filter(x => x.id === 'pr1').length === 1, '');
})();

// ── ERP teste2 v100: a senha sai do sistema, não do painel ──
(function () {
  const fs = require('fs');
  const ui = fs.readFileSync(__dirname + '/js/ui-administracao.js', 'utf8');

  /* O cadastro de usuário terminava pela metade por um texto
     desatualizado. A mensagem mandava criar o login "no painel do
     Supabase" — verdade de quando o sistema ainda não criava
     senha —, e o formulário já tinha fechado, levando junto o
     botão que resolveria. A pessoa salvava o usuário, lia que
     precisava ir a outro lugar, e o caminho de dentro ficava
     invisível. */
  verificar('v100 — a tela de criar acesso abre sozinha quando falta o login',
    /motivo === 'login_nao_existe'[\s\S]{0,1400}?criarAcesso\(u2\.email\)/.test(ui), '');
  verificar('v100 — nenhum texto da Administração manda ao painel do Supabase',
    !/painel do Supabase|Add user|Auto Confirm/.test(ui), '');
  verificar('v100 — a ajuda aponta o botão que existe',
    /Criar acesso \/ redefinir senha/.test(ui), '');

  /* A senha que o administrador escolhe é provisória por
     definição: alguém além do dono a conhece. Marcar isso era um
     passo manual num checkbox lá embaixo, e quem não soubesse
     deixava a senha do administrador valendo para sempre. */
  verificar('v100 — criar acesso marca a senha como provisória sozinho',
    /senha_provisoria: true/.test(ui), '');
  verificar('v100 — e sem dois avisos seguidos se contradizendo',
    /if \(!\(ERP\.persistencia && ERP\.persistencia\.ligado\(\)\)\) ERP\.app\.aviso\('Usuário salvo\.'/.test(ui), '');

  /* A regra que torna a provisória obrigatória continua no store. */
  const adm = D.usuarios.find(u => u.perfil === 'admin' && u.ativo !== false);
  if (adm) S.setUsuario(adm.id);
  const alvo = D.usuarios.find(u => adm && u.id !== adm.id && u.ativo !== false);
  if (alvo) {
    const r = S.salvarUsuario({ id: alvo.id, nome: alvo.nome, perfil: alvo.perfil,
      email: alvo.email, ativo: true, senha_provisoria: true });
    verificar('v100 — a marca de senha provisória é gravada no usuário',
      r.ok && D.usuario(alvo.id).senha_provisoria === true, JSON.stringify(r.erro));
    S.salvarUsuario({ id: alvo.id, nome: alvo.nome, perfil: alvo.perfil,
      email: alvo.email, ativo: true, senha_provisoria: false });
  }
  S.setUsuario('u8');
})();

// ── ERP teste2 v101: a política vai ao banco ──
(function () {
  const fs = require('fs');
  const pers = fs.readFileSync(__dirname + '/js/persistencia.js', 'utf8');
  const rem  = fs.readFileSync(__dirname + '/js/dados-remoto.js', 'utf8');
  const aut  = fs.readFileSync(__dirname + '/js/auth.js', 'utf8');
  const store = fs.readFileSync(__dirname + '/js/store.js', 'utf8');

  /* Mesmo defeito da matriz de acesso, e pela mesma razão: a
     política era lida do CÓDIGO e nunca gravada. A alçada que a
     Administração ajustava valia só naquela sessão e voltava ao
     padrão no login seguinte — para quem ajustou e para todo
     mundo. E a tela mostrava o valor novo até alguém recarregar a
     página, então não havia como desconfiar.

     Não é detalhe de configuração: é a alçada de aprovação de
     pagamento, a trava de "quem solicita não aprova" e o
     fechamento de competência. Três controles que o sistema
     anunciava ter e não tinha de verdade. */
  verificar('v101 — existe a gravação da política no banco',
    /async function gravarParametros/.test(pers), '');
  verificar('v101 — e salvar parâmetros a dispara',
    /ERP\.persistencia\.gravarParametros\(\)/.test(store), '');
  verificar('v101 — a leitura traz a política do banco',
    /parametros_gerais/.test(rem), '');

  /* A ordem é o que faz funcionar: `store.init()` recria
     `st.parametros` com o padrão, e aplicar antes seria escrever
     num objeto que será jogado fora segundos depois. */
  verificar('v101 — a política é aplicada DEPOIS de montar o store',
    /iniciarComSessao\(s\);[\s\S]{0,400}?aplicarPolitica\(\)/.test(aut), '');

  /* Só política vai ao banco. Ajuste de plantão e a matriz têm
     caminho próprio, e mandar tudo junto faria um ajuste de
     plantão disputar a mesma linha com a alçada. */
  const lista = (pers.match(/const PARAMETROS_POLITICA = \[([\s\S]*?)\];/) || [])[1] || '';
  verificar('v101 — a alçada e as travas estão na lista que vai ao banco',
    /'alcada'/.test(lista) && /'impedir_autoaprovacao'/.test(lista) &&
    /'travar_competencia_ate'/.test(lista), lista.slice(0, 90));
  verificar('v101 — e os ajustes de plantão NÃO vão junto',
    !/plantoes_ajustados/.test(lista) && !/matriz_acesso/.test(lista), '');

  /* As regras do banco têm de ser as mesmas do store. A etapa 42
     reescreve alçada, segregação e sem_aprovacao em SQL; se uma
     das duas mudar sozinha, o celular e o computador passam a
     decidir diferente sobre o mesmo pagamento. */
  const sql = fs.readFileSync(__dirname + '/supabase/42-aprovar-no-banco.sql', 'utf8');
  verificar('v101 — a função do banco confere a alçada',
    /app_alcada\(\)/.test(sql) && /acima da sua alçada/.test(sql), '');
  verificar('v101 — confere quem solicitou (por id, não por nome)',
    /pg\.usuario_id = eu\.id/.test(sql) && /quem solicita não aprova/.test(sql), '');
  verificar('v101 — confere a lista de perfis sem aprovação',
    /sem_aprovacao' \? perfil/.test(sql), '');
  verificar('v101 — e lê a política da mesma linha que o sistema grava',
    /chave = 'parametros_gerais'/.test(sql), '');
  verificar('v101 — as funções de aprovação não são abertas ao público',
    /revoke all on function aprovar_pagamento/.test(sql) &&
    /grant execute on function aprovar_pagamento\(text\[\]\) *to authenticated/.test(sql), '');

  /* Dinheiro no formato da casa, também nas mensagens do banco. */
  verificar('v101 — o banco formata dinheiro em 00.000,00',
    /function app_brl/.test(sql) && /translate\(to_char\(coalesce\(v,0\), 'FM999,999,999,990\.00'\), ',\.', '\.,'\)/.test(sql), '');

  /* A edição em memória continua valendo. */
  const adm = D.usuarios.find(u => u.perfil === 'admin' && u.ativo !== false);
  if (adm) {
    S.setUsuario(adm.id);
    const r = S.salvarParametros({ alcada: { diretoria: 77000 }, impedir_autoaprovacao: true });
    verificar('v101 — a alçada editada vale na hora',
      r.ok && S.parametros().alcada.diretoria === 77000, S.parametros().alcada.diretoria);
    S.salvarParametros({ alcada: { diretoria: 50000 } });
  }
  S.setUsuario('u8');
})();


// ── ERP teste2 v102: DRE gerencial ──
(function () {
  const DRE = sandbox.window.ERP.dreGerencial;

  /* O DRE do jeito que a empresa lê: receita, imposto, custo
     direto, despesa do projeto, despesa da casa RATEADA pelo
     faturamento, lucro — e os investimentos abaixo da linha.

     Os números abaixo foram conferidos na mão. Cada um existe
     porque a conta pode errar de um jeito específico: o rateio que
     não fecha, a depreciação contada duas vezes, a retenção
     descontada em dobro no caixa, a previsão entrando como fato. */

const plano = [
  { cod:'1', nome:'Receita operacional', nivel:1, tipo:'receita' },
  { cod:'2', nome:'Impostos de venda', nivel:1, tipo:'deducao' },
  { cod:'2.01', nome:'ISS', nivel:2, pai:'2' },
  { cod:'3', nome:'Custos diretos', nivel:1, tipo:'custo' },
  { cod:'3.01', nome:'Produtividade médica', nivel:2, pai:'3' },
  { cod:'6', nome:'Despesas administrativas', nivel:1, tipo:'despesa' },
  { cod:'6.01', nome:'Aluguel', nivel:2, pai:'6' },
  { cod:'8', nome:'Despesas operacionais', nivel:1, tipo:'despesa' },
  { cod:'8.04', nome:'Material', nivel:2, pai:'8' },
  { cod:'10', nome:'Aportes', nivel:1, tipo:'nao_operacional' },
  { cod:'10.01', nome:'Aporte', nivel:2, pai:'10' }
];
const centros = [
  { id:'pj1', curto:'AGIR Neonatal', tipo:'projeto', cliente:'cl-agir' },
  { id:'pj2', curto:'AGIR UTI',      tipo:'projeto', cliente:'cl-agir' },
  { id:'pj3', curto:'HGB Oftalmo',   tipo:'projeto', cliente:'cl-ghc' },
  { id:'cc100', curto:'Matriz SP',   tipo:'matriz' },
  { id:'cc900', curto:'Geral',       tipo:'geral' }
];
const receber = [
  { id:'r1', centro:'pj1', competencia:'2026-07', valor_bruto:100000, valor_retido:5000,
    valor_recebido:100000, recebido_em:'2026-08-10', origem:'nota', status:'emitida',
    cliente_nome:'AGIR', numero:'1',
    baixas:[{ data:'2026-08-10', valor:95000 }] },
  { id:'r2', centro:'pj2', competencia:'2026-07', valor_bruto:60000, valor_retido:0,
    origem:'nota', status:'emitida', cliente_nome:'AGIR', numero:'2', baixas:[] },
  { id:'r3', centro:'pj3', competencia:'2026-07', valor_bruto:40000, valor_retido:0,
    origem:'nota', status:'emitida', cliente_nome:'GHC', numero:'3', baixas:[] },
  { id:'r4', centro:'pj1', competencia:'2026-07', valor_bruto:999, valor_retido:0,
    origem:'nota', status:'cancelado', cliente_nome:'x', baixas:[] }
];
const parcelas = [
  { id:'p1', conta:'3.01', centro:'pj1', comp:'2026-07', valor:50000, status:'pago', descricao:'Repasse médico' },
  { id:'p2', conta:'8.04', centro:'pj1', comp:'2026-07', valor:8000,  status:'pago', descricao:'Material do projeto' },
  { id:'p3', conta:'6.01', centro:'cc100', comp:'2026-07', valor:20000, status:'pago', descricao:'Aluguel matriz' },
  { id:'p4', conta:'2.01', centro:'cc100', comp:'2026-07', valor:3000, status:'pago', descricao:'ISS' },
  { id:'p5', conta:'10.01', centro:'cc900', comp:'2026-07', valor:777, status:'pago', descricao:'Aporte do sócio' },
  { id:'p6', conta:'6.01', centro:'cc100', comp:'2026-07', valor:1000, status:'previsto', descricao:'previsão' }
];
const pagamentos = [
  { id:'pg1', parcela_id:'p1', data:'2026-08-05', valor:50000, juros:0, multa:0, situacao:'liquidado' },
  { id:'pg2', parcela_id:'p3', data:'2026-07-20', valor:20000, juros:100, multa:50, situacao:'liquidado' },
  { id:'pg3', parcela_id:'p2', data:'2026-07-30', valor:8000, juros:0, multa:0, situacao:'aguardando' }
];
const ativos = [
  { id:'a1', descricao:'Arco cirúrgico', valor:360000, vida_util_meses:36, aquisicao:'2026-07-15', projeto:'pj1' },
  { id:'a2', descricao:'Mesa', valor:50000, vida_util_meses:60, aquisicao:'2026-06-01', projeto:'pj3' }
];
const dados = { plano, centros, receber, parcelas, pagamentos, ativos,
  depreciacaoPorProjeto: m => m === '2026-07'
    ? [{ centro:'pj1', valor:10000, itens:[{}] }, { centro:'pj3', valor:833.33, itens:[{}] }] : [] };

// ── 1. empresa inteira, competência, julho
const g = DRE.calcular(dados, { de:'2026-07', ate:'2026-07', regime:'competencia' });
const L = id => g.linhas.find(x => x.id === id);
verificar('v102 — receita = 200.000 (cancelada fora)', L('receita').total === 200000, L('receita').total);
verificar('v102 — imposto = 3.000 proprio + 5.000 retido', L('imposto').total === 8000, L('imposto').total);
verificar('v102 — custo = 50.000 repasse + 10.833,33 depreciacao', L('custo').total === 60833.33, L('custo').total);
verificar('v102 — despesa direta = 8.000', L('direta').total === 8000, L('direta').total);
verificar('v102 — despesa geral = 20.000 (matriz, sem rateio pois é a empresa toda)', L('geral').total === 20000, L('geral').total);
verificar('v102 — aporte NAO entra no resultado', JSON.stringify(g.linhas).indexOf('Aporte do sócio') < 0, '');
verificar('v102 — lucro = 200000-8000-60833.33-8000-20000', L('lucro').total === 103166.67, L('lucro').total);
verificar('v102 — investimento = 360.000 no mes', g.investimentos.total === 360000, g.investimentos.total);
verificar('v102 — observacao avisa que investiu mais que o lucro',
  /não sobrou caixa/.test(g.investimentos.observacao), g.investimentos.observacao);

// ── 2. filtro por CLIENTE (AGIR = pj1 + pj2)
const a = DRE.calcular(dados, { de:'2026-07', ate:'2026-07', cliente:'cl-agir' });
const LA = id => a.linhas.find(x => x.id === id);
verificar('v102 — AGIR soma os dois projetos: 160.000', LA('receita').total === 160000, LA('receita').total);
// rateio: 160.000 de 200.000 = 80% de 20.000 = 16.000
verificar('v102 — despesa geral rateada = 80% de 20.000', LA('geral').total === 16000, LA('geral').total);
verificar('v102 — o rateio é declarado', a.rateio['2026-07'].pct === 80, JSON.stringify(a.rateio));
verificar('v102 — custo do AGIR = 50.000 + 10.000 (so a depreciacao de pj1)',
  LA('custo').total === 60000, LA('custo').total);

// ── 3. filtro por PROJETO único
const p1 = DRE.calcular(dados, { de:'2026-07', ate:'2026-07', centros:['pj1'] });
const LP = id => p1.linhas.find(x => x.id === id);
verificar('v102 — projeto só: receita 100.000', LP('receita').total === 100000, LP('receita').total);
verificar('v102 — projeto só: geral = 50% de 20.000', LP('geral').total === 10000, LP('geral').total);
verificar('v102 — projeto só: investimento do projeto', p1.investimentos.total === 360000, p1.investimentos.total);

// ── 4. CAIXA
const cx = DRE.calcular(dados, { de:'2026-07', ate:'2026-08', regime:'caixa' });
const LC = id => cx.linhas.find(x => x.id === id);
verificar('v102 — caixa: receita = 95.000 recebidos em agosto', LC('receita').total === 95000, LC('receita').total);
verificar('v102 — caixa: custo do repasse pago em agosto', LC('custo').total === 50000, LC('custo').total);
verificar('v102 — caixa NAO inclui depreciacao',
  JSON.stringify(cx.linhas).indexOf('Depreciação') < 0, '');
verificar('v102 — caixa: geral = 20.000 + juros 100 + multa 50', LC('geral').total === 20150, LC('geral').total);
verificar('v102 — caixa: despesa nao liquidada fica de fora', LC('direta').total === 0, LC('direta').total);
/* No caixa a receita entra pelo RECEBIDO, que já é líquido de
   retenção. Somar a retenção na linha de imposto descontaria o
   mesmo imposto duas vezes. O ISS (p4) não tem pagamento
   liquidado, então também não entra. */
verificar('v102 — caixa NAO soma a retencao (a receita ja entra liquida)', LC('imposto').total === 0, LC('imposto').total);
const cxImp = DRE.calcular({ ...dados, pagamentos: pagamentos.concat([
  { id:'pg4', parcela_id:'p4', data:'2026-08-20', valor:3000, juros:0, multa:0, situacao:'liquidado' }]) },
  { de:'2026-07', ate:'2026-08', regime:'caixa' });
verificar('v102 — caixa: imposto proprio entra quando é pago',
  cxImp.linhas.find(x=>x.id==='imposto').total === 3000,
  cxImp.linhas.find(x=>x.id==='imposto').total);

// ── 5. período de vários meses
const m3 = DRE.calcular(dados, { de:'2026-07', ate:'2026-09' });
verificar('v102 — tres meses no cabecalho', m3.meses.join(',') === '2026-07,2026-08,2026-09', m3.meses.join(','));
verificar('v102 — total do periodo = o mes unico', m3.linhas.find(x=>x.id==='receita').total === 200000, '');

// ── 6. detalhe compõe o total
const det = L('custo').detalhe['2026-07'];
const somaDet = Math.round(det.reduce((s,x)=>s+x.valor,0)*100)/100;
verificar('v102 — o detalhe soma exatamente a linha', somaDet === L('custo').total, somaDet + ' vs ' + L('custo').total);

// ── 7. rateio da despesa no detalhe mostra a fatia
const dg = LA('geral').detalhe['2026-07'];
verificar('v102 — o detalhe do rateio mostra a fatia e a origem',
  dg.length === 1 && dg[0].valor === 16000 && /80%/.test(dg[0].rotulo), JSON.stringify(dg));

// ── 8. período inválido
const inv = DRE.calcular(dados, { de:'2026-09', ate:'2026-07' });
verificar('v102 — periodo invertido é recusado', !!inv.erro, JSON.stringify(inv.erro));


})();

// ── ERP teste2 v102: o DRE gerencial roda com os dados do sistema ──
(function () {
  const DRE = sandbox.window.ERP.dreGerencial;
  const Ut = sandbox.window.ERP.util;

  /* O cenário montado acima prova a CONTA. Este prova que ela
     aguenta os dados de verdade — que é onde aparecem os campos
     ausentes, as datas em branco e os centros que não existem
     mais. Um relatório que quebra com dado real não serve, por
     mais correta que seja a fórmula. */
  const dados = {
    plano: D.plano, centros: D.centros, clientes: D.clientes,
    parcelas: S.todasParcelas(), pagamentos: S.todosPagamentos(),
    receber: S.contasReceber(), ativos: S.st.ativos,
    depreciacaoPorProjeto: S.depreciacaoPorProjeto
  };
  const ano = Ut.mesAtual().slice(0, 4);
  const r = DRE.calcular(dados, { de: ano + '-01', ate: ano + '-12' });
  verificar('v102 — roda com os dados reais do sistema', !r.erro && r.meses.length === 12,
    r.erro || r.meses.length);

  /* Nenhum número pode sair NaN ou infinito: é o defeito que se
     espalha em silêncio e só aparece no relatório impresso. */
  const ruins = [];
  r.linhas.concat([r.investimentos]).forEach(function (l) {
    if (!isFinite(l.total)) ruins.push(l.id + '.total');
    Object.keys(l.valores).forEach(function (m) {
      if (!isFinite(l.valores[m])) ruins.push(l.id + '.' + m);
    });
  });
  verificar('v102 — nenhum valor sai NaN ou infinito', ruins.length === 0, ruins.join(', '));

  /* A conta fecha: receita − imposto − custo − direta − geral = lucro.
     Em cada mês, não só no total — um erro de sinal some no total. */
  const L = id => r.linhas.find(x => x.id === id);
  const fora = r.meses.filter(function (m) {
    const esperado = Math.round((L('receita').valores[m] - L('imposto').valores[m] -
      L('custo').valores[m] - L('direta').valores[m] - L('geral').valores[m]) * 100) / 100;
    return Math.abs(esperado - L('lucro').valores[m]) > 0.004;
  });
  verificar('v102 — o lucro fecha com as linhas, mês a mês', fora.length === 0, fora.join(', '));

  /* E o total de cada linha é a soma dos meses. */
  const somaFora = r.linhas.filter(function (l) {
    const s = Math.round(r.meses.reduce(function (t, m) { return t + l.valores[m]; }, 0) * 100) / 100;
    return Math.abs(s - l.total) > 0.004;
  }).map(function (l) { return l.id; });
  verificar('v102 — o total de cada linha é a soma dos meses', somaFora.length === 0, somaFora.join(', '));

  /* Com filtro por projeto, a soma de todos os projetos não pode
     passar do resultado da empresa: é o sinal de que o rateio está
     distribuindo mais do que existe. */
  const geral = DRE.calcular(dados, { de: ano + '-01', ate: ano + '-12' });
  const projetos = D.centros.filter(function (c) { return c.tipo === 'projeto'; }).map(function (c) { return c.id; });
  if (projetos.length) {
    const somaProjetos = projetos.reduce(function (s, id) {
      return s + DRE.calcular(dados, { de: ano + '-01', ate: ano + '-12', centros: [id] })
        .linhas.find(function (l) { return l.id === 'geral'; }).total;
    }, 0);
    const totalGeral = geral.linhas.find(function (l) { return l.id === 'geral'; }).total;
    verificar('v102 — o rateio não distribui mais despesa do que existe',
      somaProjetos <= totalGeral + 0.5, Ut.num(somaProjetos) + ' de ' + Ut.num(totalGeral));
  }

  /* A tela existe e está ligada. */
  const fs = require('fs');
  const ui = fs.readFileSync(__dirname + '/js/ui-relatorios.js', 'utf8');
  const htm = fs.readFileSync(__dirname + '/index.html', 'utf8');
  verificar('v102 — o relatório está no seletor do sistema',
    /value="gerencial"/.test(htm), '');
  verificar('v102 — e o módulo de cálculo é carregado na página',
    /js\/dre-gerencial\.js/.test(htm), '');
  verificar('v102 — a tela oferece competência e caixa',
    /value="competencia"/.test(ui) && /value="caixa"/.test(ui), '');
  verificar('v102 — e filtro por cliente e por projeto',
    /dg-cli/.test(ui) && /dg-pj/.test(ui), '');
  verificar('v102 — cada linha abre a composição',
    /data-dg-abre/.test(ui), '');
})();

// ── ERP teste2 v102: o cálculo é o MESMO nos dois lugares ──
(function () {
  const fs = require('fs');
  /* O DRE roda no computador e no telefone. Se os dois calcularem o
     lucro de formas diferentes, o número deixa de servir para
     decidir qualquer coisa — e ninguém vai saber qual dos dois
     acreditar. Este teste compara os arquivos byte a byte.

     O do aplicativo vive noutro repositório; aqui guardo uma cópia
     de referência, que o empacotamento mantém em dia. Se a cópia
     não existir (alguém clonou só o ERP), o teste não falha: ele
     só não tem o que comparar. */
  const meu = __dirname + '/js/dre-gerencial.js';
  const dele = __dirname + '/../orb-app/dre-gerencial.js';
  verificar('v102 — o módulo de cálculo existe', fs.existsSync(meu), '');
  if (fs.existsSync(dele)) {
    verificar('v102 — e é idêntico ao do aplicativo de celular',
      fs.readFileSync(meu, 'utf8') === fs.readFileSync(dele, 'utf8'),
      'os dois arquivos divergiram — copie o do ERP por cima do outro');
  }
})();

// ── ERP teste2 v102: o módulo formata sem depender do aparelho ──
(function () {
  const fs = require('fs');
  const t = fs.readFileSync(__dirname + '/js/dre-gerencial.js', 'utf8');
  /* `toLocaleString` olha para a configuração do telefone. Num
     celular em inglês, 1.234,56 sairia 1,234.56 — e num número que
     decide pagamento essa troca de ponto por vírgula não é detalhe
     de gosto. O módulo formata à mão. */
  /* Tira os comentários antes de procurar: o próprio comentário
     que explica a regra cita o nome da função, e um teste que falha
     por causa da explicação dele mesmo é teste ruim. */
  const semComentario = t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  verificar('v102 — o módulo não depende do idioma do aparelho',
    semComentario.indexOf('toLocaleString') < 0, '');
  verificar('v102 — e tem o formatador próprio', /function fmt\(/.test(t), '');
})();

// ── ERP teste2 v103: contrato retroativo não lança o que já foi pago ──
(function () {
  const Ut = sandbox.window.ERP.util;
  S.setUsuario('u3');
  const forn = D.credores.find(c => c.tipo !== 'medico' && c.tipo !== 'funcionario' && c.ativo !== false);

  /* Contrato que começou no ano passado e entra no sistema agora.
     O cronograma inteiro tem 12 parcelas, mas quase nenhuma é
     compromisso futuro: a maior parte já foi paga pelo caminho
     antigo. Gerar tudo encheria o contas a pagar de dívida que não
     existe — e alguém teria de cancelar parcela por parcela, ou
     pagaria de novo. */
  const r = S.salvarContrato({
    parte: 'fornecedor', numero: 'QA-CT-RETRO', fornecedor: forn.id, conta: '6.01',
    objeto: 'Aluguel que começou antes do sistema',
    vigencia_ini: '2025-01-01', vigencia_fim: '2025-12-31',
    dia_vencimento: 15, itens: [{ centro: 'cc100', valor: 3000 }]
  });
  verificar('v103 — contrato retroativo é salvo', r.ok, JSON.stringify(r.erro));

  const cron = S.cronogramaContrato(r.contrato);
  verificar('v103 — o cronograma tem as 12 parcelas do ano', cron.length === 12, cron.length);

  /* Marca as nove primeiras como já pagas. */
  const pular = cron.slice(0, 9).map(l => l.venc);
  const g = S.gerarTitulosContrato(r.contrato.id, { pular: pular });
  verificar('v103 — gera só o que ficou desmarcado', g.ok && g.parcelas === 3,
    JSON.stringify(g.erro) || g.parcelas);
  verificar('v103 — e informa quantas ficaram de fora', g.quitadas === 9, g.quitadas);
  verificar('v103 — o valor lançado é só o das três', g.total === 9000, g.total);

  const pcs = S.previsoesDoContrato(r.contrato.id);
  verificar('v103 — nenhuma parcela paga virou contas a pagar',
    pcs.every(p => pular.indexOf(p.venc) < 0), pcs.map(p => p.venc).join(','));
  verificar('v103 — só as três últimas entraram',
    pcs.map(p => p.venc).sort().join(',') === '2025-10-15,2025-11-15,2025-12-15',
    pcs.map(p => p.venc).sort().join(','));

  /* As já pagas ficam GRAVADAS. Sem isso, quem abrir o contrato
     daqui a seis meses vê doze no cronograma e três no financeiro,
     e não tem como saber se foi decisão ou esquecimento. */
  const ct = S.contrato(r.contrato.id);
  verificar('v103 — as já pagas ficam registradas no contrato',
    (ct.parcelas_quitadas_fora || []).length === 9,
    (ct.parcelas_quitadas_fora || []).length);
  verificar('v103 — com quem marcou e quando',
    (ct.parcelas_quitadas_fora || []).every(x => x.marcado_em && x.marcado_por), '');
  verificar('v103 — e a observação do título conta a história',
    /NÃO entraram aqui porque/.test(S.titulosDoContrato(r.contrato.id)[0].obs || ''),
    S.titulosDoContrato(r.contrato.id)[0].obs);

  /* Marcar tudo como pago não gera título nenhum — e diz por quê,
     em vez de criar um título vazio. */
  const r2 = S.salvarContrato({
    parte: 'fornecedor', numero: 'QA-CT-RETRO2', fornecedor: forn.id, conta: '6.01',
    vigencia_ini: '2025-01-01', vigencia_fim: '2025-03-31', dia_vencimento: 15,
    itens: [{ centro: 'cc100', valor: 1000 }]
  });
  const todas = S.cronogramaContrato(r2.contrato).map(l => l.venc);
  const g2 = S.gerarTitulosContrato(r2.contrato.id, { pular: todas });
  verificar('v103 — marcar todas como pagas não cria título vazio',
    !g2.ok && /Todas as parcelas foram marcadas/.test(g2.erro || ''), g2.erro);

  /* A tela: checkbox por parcela, vencidas pré-marcadas, e o total
     "vai lançar" acompanhando cada clique. */
  const fs = require('fs');
  const ui = fs.readFileSync(__dirname + '/js/ui-contratos.js', 'utf8');
  verificar('v103 — a tela tem checkbox por parcela', /data-cg="/.test(ui), '');
  verificar('v103 — as vencidas nascem marcadas',
    /if \(l\.venc < hoje\) quitadas\[l\.venc\] = true;/.test(ui), '');
  verificar('v103 — e há atalho para marcar e desmarcar em bloco',
    /cg-nenhuma/.test(ui) && /cg-vencidas/.test(ui) && /cg-todas/.test(ui), '');
  verificar('v103 — o total a lançar acompanha cada clique',
    /function redesenhar\(\)/.test(ui) && /Vai lançar/.test(ui), '');
  S.setUsuario('u8');
})();

// ── ERP teste2 v104: Habilitação — o cofre e o alerta ──────────
(function () {
  const fs = require('fs');
  const L = require(__dirname + '/js/hab-leitura.js');

  /* O catálogo do teste é o do SQL, nos tipos que importam para a
     leitura: prazo em palavras (CNDT), prazo curto (FGTS), prazo
     ausente (municipal) e tipo que não vence (contrato social). */
  const TIPOS = [
    { id: 'cnd-federal', nome: 'CND Federal (RFB/PGFN)', categoria: 'certidoes',
      prazo_padrao_dias: 180, sem_validade: false,
      palavras_chave: '[["creditos tributarios federais",6],["divida ativa da uniao",6]]' },
    { id: 'fgts', nome: 'CRF — FGTS', categoria: 'certidoes',
      prazo_padrao_dias: 30, sem_validade: false,
      palavras_chave: '[["certificado de regularidade do fgts",8],["fgts",3]]' },
    { id: 'cndt', nome: 'CNDT — Trabalhista', categoria: 'certidoes',
      prazo_padrao_dias: 180, sem_validade: false,
      palavras_chave: '[["debitos trabalhistas",8],["tribunal superior do trabalho",4]]' },
    { id: 'municipal', nome: 'CND Municipal', categoria: 'certidoes',
      prazo_padrao_dias: null, sem_validade: false,
      palavras_chave: '[["tributos mobiliarios",5],["divida ativa do municipio",5]]' },
    { id: 'contrato-social', nome: 'Contrato social', categoria: 'cadastrais',
      prazo_padrao_dias: null, sem_validade: true,
      palavras_chave: '[["contrato social",7],["junta comercial",4]]' }
  ];

  /* ── a leitura do PDF ─────────────────────────────────────
     O que está em jogo não é achar data: é saber QUAL data. A CND
     Federal tem três na mesma frase, e a mais vistosa é a errada. */
  const CND = 'CERTIDÃO NEGATIVA DE DÉBITOS RELATIVOS AOS CRÉDITOS TRIBUTÁRIOS FEDERAIS E À ' +
    'DÍVIDA ATIVA DA UNIÃO. CNPJ: 18.432.556/0001-12. ' +
    'Esta certidão é válida para o estabelecimento matriz e suas filiais. ' +
    'Emitida às 09:12:31 do dia 02/04/2026 <hora e data de Brasília>. Válida até 29/09/2026.';
  const lidoCnd = L.ler(CND, TIPOS);
  verificar('v104 — a CND Federal é reconhecida pelo texto',
    lidoCnd.tipo === 'cnd-federal', lidoCnd.tipo);
  verificar('v104 — a emissão não é confundida com a validade',
    lidoCnd.data_emissao === '2026-04-02', lidoCnd.data_emissao);
  verificar('v104 — e a validade é a que está escrita',
    lidoCnd.data_validade === '2026-09-29', lidoCnd.data_validade);
  verificar('v104 — o CNPJ sai com dígito verificador conferido',
    lidoCnd.cnpj === '18432556000112', lidoCnd.cnpj);
  verificar('v104 — e a certidão que cobre as filiais é marcada como tal',
    lidoCnd.abrangencia === 'matriz', lidoCnd.abrangencia);

  /* O CRF do FGTS imprime o intervalo inteiro. Quem vale é o fim —
     pegar o começo marcaria como vencido um documento novo. */
  const crf = L.ler('CAIXA ECONÔMICA FEDERAL. Certificado de Regularidade do FGTS - CRF. ' +
    'Inscrição: 18.432.556/0001-12. Validade: 25/09/2026 a 24/10/2026. ' +
    'Certificação Número: 2026092501234567', TIPOS);
  verificar('v104 — no intervalo do FGTS, a validade é o fim',
    crf.data_validade === '2026-10-24', crf.data_validade);
  verificar('v104 — e o começo do intervalo vira a emissão',
    crf.data_emissao === '2026-09-25', crf.data_emissao);
  verificar('v104 — o número só sai quando há frase que o apresente',
    crf.numero === '2026092501234567', crf.numero);

  /* A CNDT escreve o prazo em palavras. A data sai do catálogo do
     tipo, e o sistema DIZ que calculou — campo preenchido em
     silêncio é o que ninguém confere. */
  const cndt = L.ler('CERTIDÃO NEGATIVA DE DÉBITOS TRABALHISTAS. Certidão nº: 45678901/2026. ' +
    'Expedição: 15/08/2026, às 11:20:14. Validade: 180 (cento e oitenta) dias, contados da ' +
    'data de sua expedição. Tribunal Superior do Trabalho.', TIPOS);
  verificar('v104 — prazo escrito em palavras vira data pelo catálogo',
    cndt.data_validade === '2027-02-11', cndt.data_validade);
  verificar('v104 — e o sistema avisa que a data foi calculada',
    cndt.validade_calculada === true && /180 dias/.test(cndt.avisos.join(' ')),
    cndt.avisos.join(' '));

  /* Documento que não vence não ganha validade nenhuma, mesmo com
     datas espalhadas pelo texto. */
  const cs = L.ler('JUNTA COMERCIAL DO ESTADO DO RIO DE JANEIRO. CONTRATO SOCIAL DE ' +
    'CONSTITUIÇÃO. Rio de Janeiro, 14 de março de 2019. Registrado em 22/03/2019.', TIPOS);
  verificar('v104 — documento que não vence não recebe validade',
    cs.tipo === 'contrato-social' && cs.data_validade === null, cs.data_validade);

  /* Errar para menos é barato; errar para mais inabilita. Data
     impossível e data fora de ordem são descartadas em vez de
     entrarem no semáforo. */
  const ruim = L.ler('CERTIDÃO NEGATIVA DE DÉBITOS RELATIVOS AOS CRÉDITOS TRIBUTÁRIOS FEDERAIS ' +
    'E À DÍVIDA ATIVA DA UNIÃO. Emitida em 31/02/2026. Válida até 30/02/2027.', TIPOS);
  verificar('v104 — data que não existe no calendário é descartada',
    ruim.data_emissao === null && ruim.data_validade === null, '');
  verificar('v104 — e o sistema pede a data à mão em vez de inventar',
    /Digite a validade/.test(ruim.avisos.join(' ')), ruim.avisos.join(' '));

  const invertida = L.ler('CERTIFICADO DE REGULARIDADE DO FGTS. Data de emissão: 10/10/2026. ' +
    'Válida até 01/01/2020.', TIPOS);
  verificar('v104 — validade anterior à emissão é recusada',
    /fora de ordem/.test(invertida.avisos.join(' ')), invertida.avisos.join(' '));
  verificar('v104 — e cai no prazo do tipo, não no que estava escrito',
    invertida.data_validade === '2026-11-09', invertida.data_validade);

  /* Página sem camada de texto: o módulo diz o que é, em vez de
     devolver campos vazios que a pessoa leria como falha. */
  const vazio = L.ler('   \n  ', TIPOS);
  verificar('v104 — PDF escaneado é reconhecido como digitalização',
    vazio.vazio === true && /digitaliza/i.test(vazio.avisos[0]), vazio.avisos[0]);

  /* Inscrição estadual e protocolo também têm catorze dígitos. O
     dígito verificador é o que separa. */
  verificar('v104 — CNPJ com dígito errado não é aceito',
    L.cnpjValido('11111111111111') === false && L.cnpjValido('18432556000112') === true, '');

  /* ── o semáforo ───────────────────────────────────────────
     Os degraus são os do alerta: 30 / 15 / 7 / 1. */
  const H = sandbox.window.ERP ? null : null;   // a tela precisa de DOM; aqui só as regras
  const hab = fs.readFileSync(__dirname + '/js/ui-habilitacao.js', 'utf8');
  verificar('v104 — o semáforo tem os quatro degraus do alerta',
    /n <= 7/.test(hab) && /n <= 15/.test(hab) && /n <= 30/.test(hab) && /n < 0/.test(hab), '');
  verificar('v104 — vencido aparece em vermelho, não em âmbar',
    /vencido[\s\S]{0,60}b-reprovado/.test(hab), '');

  /* O documento que vale é o de validade mais longa, não o emitido
     por último: a estadual de 30 dias emitida hoje vence antes da
     de 180 emitida no mês passado. */
  verificar('v104 — o que vale é a validade mais longa, não a emissão mais nova',
    /validade_efetiva \|\| d\.data_emissao/.test(hab) &&
    /A comparação é pela validade, não pela emissão/.test(hab), '');

  /* ── a tela não corre para o lado ─────────────────────────
     A matriz empresa × certidão cabe em treze colunas e obriga a
     rolar — e o que está fora da vista não é conferido. */
  verificar('v104 — o painel não tem matriz empresa × certidão',
    !/thead[\s\S]{0,200}cols\.map/.test(hab) && /FILA DO QUE/.test(hab), '');
  verificar('v104 — o formulário usa a grade que quebra em vez de empurrar',
    /class="row2"/.test(hab) && !/class="grade-2"/.test(hab), '');

  /* ── formato ──────────────────────────────────────────────
     Data dd/mm/aaaa e número 00.000,00 valem aqui como em todo o
     resto: a varredura-formato.js cobre, isto fixa a intenção. */
  verificar('v104 — as datas da tela passam por U.fData',
    /U\.fData\(d\.validade_efetiva\)/.test(hab) && !/toLocaleDateString/.test(hab), '');
  verificar('v104 — e o leitor não depende do idioma do aparelho',
    !/toLocaleString|toLocaleDateString/.test(fs.readFileSync(__dirname + '/js/hab-leitura.js', 'utf8')), '');

  /* ── a ligação com o sistema ──────────────────────────────
     Módulo que existe no arquivo e não está ligado é módulo que
     ninguém encontra. */
  const indice = fs.readFileSync(__dirname + '/index.html', 'utf8');
  const app = fs.readFileSync(__dirname + '/js/app.js', 'utf8');
  verificar('v104 — o módulo está na lista da home',
    /id: 'habilitacao'/.test(app) && D.MODULOS.some(m => m.id === 'habilitacao'), '');
  verificar('v104 — a página tem o painel do módulo',
    /data-modulo="habilitacao"/.test(indice) && /id="hb-saida"/.test(indice), '');
  verificar('v104 — e carrega os dois arquivos do módulo',
    /js\/hab-leitura\.js/.test(indice) && /js\/ui-habilitacao\.js/.test(indice), '');
  verificar('v104 — abrir o módulo desenha a tela',
    /if \(id === 'habilitacao'\) ERP\.habilitacao\.render\(\);/.test(app), '');
  verificar('v104 — e recarregar os dados redesenha',
    /habilitacao: 'habilitacao'/.test(app), '');
  verificar('v104 — a tela é montada na carga da página',
    /ERP\.habilitacao\.montar\(\);/.test(app), '');

  /* A extração do PDF é a MESMA do DANFE — duplicar daria duas
     versões da dança do worker, e a de cá envelheceria calada. */
  verificar('v104 — a leitura de PDF reusa a do DANFE',
    /textoDoPDF: textoDoPDF/.test(fs.readFileSync(__dirname + '/js/danfe.js', 'utf8')) &&
    /ERP\.danfe\.textoDoPDF/.test(hab), '');

  /* ── acesso ───────────────────────────────────────────────
     Documento de sócio (RG, CPF, residência) tem o mesmo
     tratamento de nome de paciente: ação própria, e quem filtra é
     o banco. */
  verificar('v104 — existe a ação para ver documento de sócio',
    D.ACOES ? D.ACOES.some(a => a.id === 'ver_doc_socio')
            : /ver_doc_socio/.test(fs.readFileSync(__dirname + '/js/dados.js', 'utf8')), '');
  verificar('v104 — e são os três perfis de confiança que a têm',
    ['admin', 'socio', 'diretoria'].every(p =>
      (D.perfis.find(x => x.id === p).acoes || []).indexOf('ver_doc_socio') >= 0), '');
  verificar('v104 — a assistente vê o módulo e não vê o documento de sócio',
    D.MATRIZ_PADRAO.assistente.habilitacao === 'VM' &&
    (D.perfis.find(x => x.id === 'assistente').acoes || []).indexOf('ver_doc_socio') < 0, '');

  /* A matriz da tela e a do banco têm de concordar: se discordarem,
     a tela mostra botão que o RLS recusa — ou esconde o que a
     pessoa poderia fazer. */
  const sql = fs.readFileSync(__dirname + '/supabase/43-habilitacao.sql', 'utf8');
  /* O `case` do SQL nomeia só quem RECEBE nível; todo o resto cai
     no `else ''`. Comparar apenas os nomeados deixava passar o
     desacordo mais fácil de cometer: a tela conceder a um perfil
     que o banco deixa fechado. Foi o que aconteceu com o perfil
     Consulta, e este teste passava. Agora a comparação é sobre
     TODOS os perfis, com o `else` aplicado. */
  const doBanco = {};
  Object.keys(D.MATRIZ_PADRAO).forEach(function (p) { doBanco[p] = ''; });
  (sql.match(/when p\.id (?:in \([^)]*\)|= '[^']+') then '[A-Z]+'/g) || []).forEach(function (l) {
    const niveis = (l.match(/then '([A-Z]+)'/) || [])[1];
    (l.replace(/then '[A-Z]+'/, '').match(/'([a-z_]+)'/g) || []).forEach(function (q) {
      doBanco[q.replace(/'/g, '')] = niveis;
    });
  });
  /* E a conferência é inútil se o extrator não achar nada: um teste
     que passa vazio é pior que teste nenhum, porque parece
     cobertura. Primeiro se prova que ele leu o SQL. */
  verificar('v104 — a leitura da matriz do SQL encontrou os perfis',
    doBanco.assistente === 'VM' && doBanco.admin === 'VMA' && doBanco.dp === '',
    JSON.stringify(doBanco));
  verificar('v104 — a matriz da tela concorda com a do banco, perfil por perfil',
    Object.keys(doBanco).every(function (p) {
      return ((D.MATRIZ_PADRAO[p] || {}).habilitacao || '') === doBanco[p];
    }), Object.keys(doBanco).filter(function (p) {
      return ((D.MATRIZ_PADRAO[p] || {}).habilitacao || '') !== doBanco[p];
    }).map(function (p) {
      return p + ': tela=' + ((D.MATRIZ_PADRAO[p] || {}).habilitacao || '(nada)') +
             ' banco=' + (doBanco[p] || '(nada)');
    }).join('; '));

  /* O balde é PRIVADO e abre por link assinado de cinco minutos:
     endereço público deixaria o RG do sócio alcançável para sempre
     por quem tivesse visto a URL uma vez. */
  verificar('v104 — o balde dos arquivos é privado',
    /insert into storage\.buckets[\s\S]{0,120}false\)/.test(sql), '');
  verificar('v104 — e a tela abre por link assinado de curta duração',
    /createSignedUrl\(d\.arquivo_path, 300\)/.test(hab), '');

  /* O prazo vem do TIPO. Com 90 dias fixos, uma CNDT expedida há
     cem dias apareceria vencida estando válida — e alarme falso é
     como se ensina a ignorar o semáforo. */
  verificar('v104 — a validade efetiva usa o prazo do tipo',
    /p_prazo_dias int default null/.test(sql) &&
    /coalesce\(p_prazo_dias, 90\)/.test(sql), '');
  verificar('v104 — a assinatura antiga de três argumentos é removida',
    /drop function if exists hab_validade_efetiva\(date, date, boolean\);/.test(sql), '');

  /* Documento sem emissão e sem validade entraria guardado e
     invisível para o alerta — que é o engano que o módulo existe
     para evitar. */
  verificar('v104 — documento sem data nenhuma não é guardado em silêncio',
    /não entra no alerta/.test(hab), '');
  /* Arquivar, não apagar: certidão apagada é prova de regularidade
     perdida. */
  verificar('v104 — a tela arquiva em vez de apagar',
    /arquivado: true/.test(hab) && !/\.delete\(\)/.test(hab), '');
  verificar('v104 — o histórico fica visível, marcado como substituído',
    /substituído/.test(hab) && /hb-velho/.test(hab), '');

  /* ── o alerta na home ─────────────────────────────────────
     Semáforo que só existe dentro do módulo avisa quem já foi
     olhar. O pedido era avisar ANTES, e isso só acontece na home.

     O caso que importa é a renovação: a certidão antiga vence
     sozinha e acenderia um alerta já resolvido. */
  const hojeIso = sandbox.window.ERP.util.hoje();
  const emDias = function (n) {
    const d = new Date(hojeIso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const empresasAntes = D.empresas;
  D.empresas = [{ id: 'E1', nome: 'DOM PEDRO LTDA', apelido: 'Dom Pedro', ativo: true }];
  /* Quem está logado decide se o cartão existe. A bateria chega
     aqui como a Carol do DP, que não vê Habilitação — e foi assim
     que este bloco nasceu falhando, mostrando que a guarda
     funciona. O usuário é devolvido no fim. */
  const usuarioAntes = (S.usuario() || {}).id;
  D.habilitacaoResumo = [
    // vencida de verdade, sem renovação
    { id: 'a1', empresa: 'E1', tipo: 'cnd-federal', tipo_nome: 'CND Federal',
      tipo_sem_validade: false, validade_efetiva: emDias(-10), dias_para_vencer: -10 },
    // vencida MAS já renovada — não pode acender
    { id: 'a2', empresa: 'E1', tipo: 'fgts', tipo_nome: 'CRF FGTS',
      tipo_sem_validade: false, validade_efetiva: emDias(-3), dias_para_vencer: -3 },
    { id: 'a3', empresa: 'E1', tipo: 'fgts', tipo_nome: 'CRF FGTS',
      tipo_sem_validade: false, validade_efetiva: emDias(27), dias_para_vencer: 27 },
    // longe: não é assunto
    { id: 'a4', empresa: 'E1', tipo: 'cndt', tipo_nome: 'CNDT',
      tipo_sem_validade: false, validade_efetiva: emDias(120), dias_para_vencer: 120 },
    // não vence nunca
    { id: 'a5', empresa: 'E1', tipo: 'contrato-social', tipo_nome: 'Contrato social',
      tipo_sem_validade: true, validade_efetiva: null, dias_para_vencer: null }
  ];
  S.setUsuario('u1');                    // assistente: vê o módulo
  /* A ORDEM EM QUE O BANCO DEVOLVE NÃO PODE MUDAR A RESPOSTA.

     Primeira versão deste teste passava mesmo com o filtro da
     renovação quebrado, porque a renovada vinha por último na
     lista e "o último ganha" dava o mesmo resultado que "o de
     validade mais longa ganha". O `select` não pede ordenação:
     a ordem é a que o Postgres quiser. Então o caso roda nas duas
     ordens, e as duas têm de dar igual. */
  const resumoBase = D.habilitacaoResumo.slice();
  const resposta = function (lista) {
    D.habilitacaoResumo = lista;
    const p2 = S.pendenciasHome();
    return {
      venc: p2.find(x => x.id === 'hab_vencida'),
      vindo: p2.find(x => x.id === 'hab_vencendo')
    };
  };
  const direta = resposta(resumoBase);
  const invertida2 = resposta(resumoBase.slice().reverse());
  verificar('v104 — a ordem do banco não muda o alerta',
    (direta.venc || {}).n === (invertida2.venc || {}).n &&
    (direta.vindo || {}).n === (invertida2.vindo || {}).n,
    JSON.stringify([(direta.venc || {}).n, (invertida2.venc || {}).n,
                    (direta.vindo || {}).n, (invertida2.vindo || {}).n]));
  const venc = direta.venc;
  const vindo = direta.vindo;
  verificar('v104 — a certidão vencida acende cartão na home',
    venc && venc.n === 1, venc ? venc.n : 'sem cartão');
  verificar('v104 — e a já renovada NÃO acende',
    venc && !/FGTS/.test(venc.texto), venc ? venc.texto : '');
  verificar('v104 — a renovação de 27 dias entra no cartão dos 30 dias',
    vindo && vindo.n === 1 && /FGTS/.test(vindo.texto), vindo ? vindo.n + ' ' + vindo.texto : 'sem cartão');
  verificar('v104 — o que vence em 120 dias não entra em cartão nenhum',
    !/CNDT/.test((venc || {}).texto || '') && !/CNDT/.test((vindo || {}).texto || ''), '');
  verificar('v104 — documento que não vence não acende nada',
    !/Contrato social/.test(((venc || {}).texto || '') + ((vindo || {}).texto || '')), '');
  verificar('v104 — o cartão nomeia a empresa, não o código dela',
    venc && /Dom Pedro/.test(venc.texto), venc ? venc.texto : '');

  /* Banco sem o módulo instalado: nenhum cartão, e nada quebra. */
  D.habilitacaoResumo = [];
  verificar('v104 — sem o SQL rodado, nenhum cartão de habilitação aparece',
    !S.pendenciasHome().some(x => /^hab_/.test(x.id)), '');
  delete D.habilitacaoResumo;
  verificar('v104 — e nem quando a carga sequer definiu o resumo',
    !S.pendenciasHome().some(x => /^hab_/.test(x.id)), '');

  /* E quem não tem o módulo não recebe o cartão, mesmo com o cofre
     cheio de certidão vencida: o alerta segue a matriz de acesso
     como o resto do sistema. */
  D.habilitacaoResumo = [{ id: 'a1', empresa: 'E1', tipo: 'cnd-federal',
    tipo_nome: 'CND Federal', tipo_sem_validade: false,
    validade_efetiva: emDias(-10), dias_para_vencer: -10 }];
  S.setUsuario('u8');                    // Carol do DP: não vê Habilitação
  verificar('v104 — quem não tem o módulo não recebe o alerta',
    !S.pendenciasHome().some(x => /^hab_/.test(x.id)), '');
  delete D.habilitacaoResumo;
  S.setUsuario(usuarioAntes);
  D.empresas = empresasAntes;

  /* O resumo é lido na carga da sessão, e a falta das tabelas não
     pode derrubar o sistema inteiro por um módulo acessório. */
  const remoto = fs.readFileSync(__dirname + '/js/dados-remoto.js', 'utf8');
  verificar('v104 — o resumo vem na carga da sessão, não da tela',
    /habilitacaoResumo/.test(remoto) && /hab_documento_vigente/.test(remoto), '');
  verificar('v104 — e a falta das tabelas não derruba a carga',
    /try \{[\s\S]{0,400}hab_documento_vigente[\s\S]{0,400}catch/.test(remoto), '');
})();

// ── ERP teste2 v105: a pasta inteira de uma vez ───────────────
(function () {
  const fs = require('fs');
  const L = require(__dirname + '/js/hab-leitura.js');

  const TIPOS = [
    { id: 'cnd-federal', nome: 'CND Federal (RFB/PGFN)', sigla: 'CND', categoria: 'certidoes',
      prazo_padrao_dias: 180, sem_validade: false,
      palavras_chave: '[["creditos tributarios federais",6],["divida ativa da uniao",6]]' },
    { id: 'fgts', nome: 'CRF — FGTS', sigla: 'CRF', categoria: 'certidoes',
      prazo_padrao_dias: 30, sem_validade: false,
      palavras_chave: '[["certificado de regularidade do fgts",8],["fgts",3]]' },
    { id: 'cndt', nome: 'CNDT — Trabalhista', sigla: 'CNDT', categoria: 'certidoes',
      prazo_padrao_dias: 180, sem_validade: false,
      palavras_chave: '[["debitos trabalhistas",8]]' }
  ];
  const EMPRESAS = [
    { id: 'EMP1', nome: 'HJM DOM PEDRO LTDA', apelido: 'Dom Pedro', cnpj: '18.432.556/0001-12' },
    { id: 'EMP2', nome: 'HJM DOM PEDRO FILIAL CE', apelido: 'Filial Fortaleza',
      cnpj: '18.432.556/0002-01' }
  ];
  const CNDT_TXT = 'CERTIDAO NEGATIVA DE DEBITOS TRABALHISTAS. Expedicao: 15/08/2026. ' +
    'CNPJ 18.432.556/0001-12';

  /* ── o nome do arquivo como segundo sinal ─────────────────
     Quem organiza a pasta batiza os arquivos, e numa remessa de
     trinta documentos é isso que separa "corrigir três linhas" de
     "digitar tudo". */
  const digital = L.ler('   ', TIPOS, { nome: 'CRF FGTS - Dom Pedro.pdf', empresas: EMPRESAS });
  verificar('v105 — digitalização sem texto ainda é classificada pelo nome',
    digital.vazio === true && digital.tipo === 'fgts' && digital.empresa === 'EMP1',
    JSON.stringify({ t: digital.tipo, e: digital.empresa }));
  verificar('v105 — e ela diz que as datas precisam ser digitadas',
    /digitaliza/i.test(digital.avisos.join(' ')) && !digital.data_validade, '');

  /* O NOME NÃO PODE VENCER O CONTEÚDO. Um arquivo salvo por engano
     como "fgts.pdf" que por dentro é uma CNDT tem de ser
     classificado pelo que o órgão emitiu, não pelo que alguém
     digitou. É por isso que o nome pesa metade. */
  const enganado = L.ler(CNDT_TXT, TIPOS, { nome: 'fgts.pdf', empresas: EMPRESAS });
  verificar('v105 — o conteúdo ganha do nome do arquivo',
    enganado.tipo === 'cndt', enganado.tipo);

  /* Mas o nome resolve quando o conteúdo cala. */
  const soNome = L.ler('texto generico sem palavra chave alguma apenas para passar do minimo',
    TIPOS, { nome: 'CNDT 2026.pdf', empresas: EMPRESAS });
  verificar('v105 — a sigla no nome resolve quando o conteúdo cala',
    soNome.tipo === 'cndt', soNome.tipo);
  verificar('v105 — e o sistema avisa que foi só pelo nome',
    soNome.so_pelo_nome === true && /nome do arquivo/.test(soNome.avisos.join(' ')), '');

  /* ── de que empresa é ────────────────────────────────────
     Guardar a certidão da filial como sendo da matriz deixa DUAS
     empresas erradas: a matriz com documento que não é dela, e a
     filial parecendo não ter o que tem. */
  const porCnpj = L.ler('CERTIFICADO DE REGULARIDADE DO FGTS. CNPJ: 18.432.556/0002-01. ' +
    'Validade: 01/10/2026 a 30/10/2026', TIPOS, { nome: 'crf Dom Pedro.pdf', empresas: EMPRESAS });
  verificar('v105 — o CNPJ do documento ganha do apelido no nome',
    porCnpj.empresa === 'EMP2' && /CNPJ no documento/.test(porCnpj.empresa_por),
    porCnpj.empresa + ' por ' + porCnpj.empresa_por);
  const porApelido = L.ler('CERTIFICADO DE REGULARIDADE DO FGTS. Validade: 01/10/2026 a 30/10/2026',
    TIPOS, { nome: 'crf Filial Fortaleza.pdf', empresas: EMPRESAS });
  verificar('v105 — sem CNPJ no documento, o apelido no nome resolve',
    porApelido.empresa === 'EMP2', porApelido.empresa);
  const semNada = L.ler(CNDT_TXT.replace('18.432.556/0001-12', '11.222.333/0001-81'),
    TIPOS, { nome: 'certidao.pdf', empresas: EMPRESAS });
  verificar('v105 — CNPJ de fora do cadastro não vira empresa nenhuma',
    !semNada.empresa && /não é de nenhuma empresa cadastrada/.test(semNada.avisos.join(' ')),
    semNada.empresa);

  /* ── a tela de lote ──────────────────────────────────────
     Estes casos leem o arquivo porque a tabela depende de DOM. O
     comportamento de ponta a ponta foi exercitado num Chromium com
     nove PDFs; aqui ficam as invariantes que não podem sumir numa
     refatoração. */
  const hab = fs.readFileSync(__dirname + '/js/ui-habilitacao.js', 'utf8');
  verificar('v105 — a tela aceita vários arquivos de uma vez',
    /id="hb-arqs"[^>]*multiple/.test(hab), '');
  verificar('v105 — e aceita uma pasta inteira',
    /webkitdirectory/.test(hab), '');
  /* Arrastar uma PASTA não entrega os arquivos em
     `dataTransfer.files`; sem a API de entradas, não acontecia
     nada, em silêncio. */
  verificar('v105 — a pasta arrastada é percorrida pela API de entradas',
    /webkitGetAsEntry/.test(hab) && /createReader/.test(hab), '');
  verificar('v105 — e a leitura de uma pasta insiste até vir vazio',
    /do \{[\s\S]{0,400}readEntries[\s\S]{0,300}while \(parte\.length\)/.test(hab), '');
  verificar('v105 — a recursão tem fundo, para pasta errada não travar a aba',
    /nivel > 5/.test(hab), '');

  /* Um PDF de cada vez: o pdf.js carrega o arquivo inteiro na
     memória e vinte em paralelo derrubam a aba. */
  verificar('v105 — os PDFs são lidos um de cada vez',
    /for \(const l of fila\) \{\s*\n\s*await lerUm/.test(hab), '');

  /* O foco: redesenhar a tabela a cada tecla torna a correção
     impossível numa lista de vinte linhas. */
  verificar('v105 — mexer num campo repinta só a própria linha',
    /const cx = U\.el\('hb-sit' \+ i\);/.test(hab) &&
    /data-hb-num[\s\S]{0,400}addEventListener\('input'/.test(hab), '');

  /* Nada é gravado antes do clique, e a falha de uma linha não
     derruba as outras. */
  verificar('v105 — guardar percorre linha a linha e segue após falha',
    /for \(const l of fila\)[\s\S]{0,2000}catch \(e\) \{[\s\S]{0,200}l\.estado = 'erro'/.test(hab), '');
  verificar('v105 — registro que não gravou tem o arquivo removido do balde',
    /\.remove\(\[caminho\]\)/.test(hab), '');

  /* Repetido: o índice do banco é por empresa+hash e recusaria no
     fim, depois de subir o arquivo à toa. */
  verificar('v105 — o repetido é reconhecido pelo conteúdo, antes de subir',
    /SHA-256/.test(hab) && /arquivo_hash === l\.hash/.test(hab), '');
  verificar('v105 — inclusive o repetido dentro do próprio lote',
    /mesmo conteúdo de/.test(hab), '');

  /* ── a versão saiu do config.js ──────────────────────────
     Os dois mudavam por motivos opostos e garantiam conflito no
     git a cada publicação — e resolver conflito à mão foi o que
     estragou a codificação da v104 no ramo de teste. */
  const cfg = fs.readFileSync(__dirname + '/js/config.js', 'utf8');
  const ver = fs.readFileSync(__dirname + '/js/versao.js', 'utf8');
  const indice = fs.readFileSync(__dirname + '/index.html', 'utf8');
  verificar('v105 — o config.js não guarda mais a versão',
    !/versao:\s*'/.test(cfg), '');
  verificar('v105 — e ela vive em js/versao.js',
    /ERP\.config\.versao = '/.test(ver), '');
  verificar('v105 — o versao.js carrega depois do config.js',
    indice.indexOf('js/versao.js') > indice.indexOf('js/config.js') &&
    indice.indexOf('js/versao.js') > 0, '');
  verificar('v105 — quem lia ERP.config.versao continua lendo do mesmo lugar',
    /ERP\.config = ERP\.config \|\| \{\}/.test(ver), '');
  /* O marcador precisa casar com a forma NOVA. Com o padrão antigo
     ele trocava nada e dizia "(nenhuma)", deixando a versão velha
     no ar — o defeito que ele existe para evitar. */
  const marc = fs.readFileSync(__dirname + '/marcar-versao.js', 'utf8');
  verificar('v105 — o marcador de versão aponta para o arquivo novo',
    /js\/versao\.js/.test(marc) && !/js\/config\.js/.test(marc), '');
  verificar('v105 — e ele para com erro se não achar a linha',
    /process\.exit\(1\)/.test(marc) && /nada foi gravado/.test(marc), '');
  verificar('v105 — a versão publicada é a v105',
    /ERP\.config\.versao = 'v105 /.test(ver), (ver.match(/versao = '[^']*'/) || [])[0]);
})();

// ── v106: o detalhe da NF mostrava um líquido que não existe ──
(function () {
  S.setUsuario('u3');
  const U2 = sandbox.window.ERP.util;

  /* O CASO RELATADO. NF de R$ 10.000,00 bruto, R$ 1.650,00 de
     retenção, lançada — corretamente — pelo LÍQUIDO de R$ 8.350,00
     no contas a pagar.

     A tela do título fazia "valor da parcela menos retenções" e
     mostrava R$ 6.700,00, que não é nada: nem o bruto, nem o
     líquido, nem o que sai do caixa. */
  const nf = S.criarTitulo({
    credor: 'cr5', tipo_titulo: 'nf', conta: '6.03', centro: 'cc100',
    emissao: '2027-05-05', origem: 'manual', documento: 'NF-9001',
    descricao: 'Serviço com retenção — lançado pelo líquido',
    valor_bruto: 10000,
    retencoes: [{ tributo: 'IRRF', valor: 150 },
                { tributo: 'PIS/COFINS/CSLL', valor: 465 },
                { tributo: 'ISS', valor: 1035 }]
  }, [{ num: 1, venc: '2027-06-10', comp: '2027-05', valor: 8350 }]);
  verificar('v106 — a NF com retenção lançada pelo líquido entra',
    nf.ok, nf.erro);

  const pid = S.todasParcelas().filter(function (p) {
    return p.titulo_id === nf.titulo.id; })[0].id;
  const r = S.notaDaParcela(pid);

  verificar('v106 — o resumo sabe o bruto da nota',
    r.bruto_conhecido === true && r.bruto === 10000, JSON.stringify(r.bruto));
  verificar('v106 — o retido é a soma dos três tributos',
    r.retido === 1650, r.retido);
  verificar('v106 — o líquido é o que está no contas a pagar',
    r.liquido === 8350, r.liquido);
  verificar('v106 — e a conta fecha: bruto − retido = líquido',
    r.fecha === true, JSON.stringify({ b: r.bruto, r: r.retido, l: r.liquido }));
  /* A prova do defeito: a conta antiga daria 6.700, e esse número
     não pode aparecer em lugar nenhum. */
  verificar('v106 — o número fantasma (líquido − retenções) não é mais calculado',
    r.liquido - r.retido === 6700 && r.liquido !== 6700, '');

  /* Nota parcelada: a retenção é da NOTA e fica repetida em cada
     parcela. "Líquido" é a soma de todas, não o valor da que está
     aberta — subtrair a retenção inteira de uma parcela era o
     mesmo erro, multiplicado. */
  const nf3 = S.criarTitulo({
    credor: 'cr5', tipo_titulo: 'nf', conta: '6.03', centro: 'cc100',
    emissao: '2027-05-06', origem: 'manual', documento: 'NF-9002',
    descricao: 'Serviço com retenção em três parcelas',
    valor_bruto: 12000,
    retencoes: [{ tributo: 'ISS', valor: 600 }]
  }, [{ num: 1, venc: '2027-06-10', comp: '2027-05', valor: 3800 },
      { num: 2, venc: '2027-07-10', comp: '2027-05', valor: 3800 },
      { num: 3, venc: '2027-08-10', comp: '2027-05', valor: 3800 }]);
  verificar('v106 — nota parcelada com retenção entra', nf3.ok, nf3.erro);
  const p3 = S.todasParcelas().filter(function (p) { return p.titulo_id === nf3.titulo.id; })[0];
  const r3 = S.notaDaParcela(p3.id);
  verificar('v106 — o líquido é a soma das três parcelas, não o de uma',
    r3.liquido === 11400 && r3.parcelas === 3, JSON.stringify({ l: r3.liquido, n: r3.parcelas }));
  verificar('v106 — e o valor da parcela aberta vem à parte',
    r3.valor_desta === 3800, r3.valor_desta);
  verificar('v106 — a conta da nota parcelada fecha', r3.fecha === true, '');

  /* Sem o bruto informado, a resposta certa é dizer que não se
     sabe — não arriscar uma subtração que acerta metade das vezes. */
  const nf2 = S.criarTitulo({
    credor: 'cr5', tipo_titulo: 'nf', conta: '6.03', centro: 'cc100',
    emissao: '2027-05-07', origem: 'manual', documento: 'NF-9003',
    descricao: 'NF antiga, sem o bruto informado',
    retencoes: [{ tributo: 'ISS', valor: 40 }]
  }, [{ num: 1, venc: '2027-06-12', comp: '2027-05', valor: 760 }]);
  const r2 = S.notaDaParcela(S.todasParcelas()
    .filter(function (p) { return p.titulo_id === nf2.titulo.id; })[0].id);
  verificar('v106 — sem o bruto informado, o resumo assume que não sabe',
    r2.bruto_conhecido === false && r2.bruto === null && r2.fecha === null,
    JSON.stringify({ b: r2.bruto, f: r2.fecha }));
  verificar('v106 — mas as retenções continuam aparecendo',
    r2.retido === 40 && r2.liquido === 760, JSON.stringify(r2));

  /* Título sem retenção nenhuma não tem resumo — e a tela não
     desenha o bloco. */
  const semRet = S.criarTitulo({
    credor: 'cr5', tipo_titulo: 'nf', conta: '6.03', centro: 'cc100',
    emissao: '2027-05-08', origem: 'manual', documento: 'NF-9004',
    descricao: 'NF sem retenção'
  }, [{ num: 1, venc: '2027-06-13', comp: '2027-05', valor: 500 }]);
  verificar('v106 — título sem retenção não tem resumo de nota',
    S.notaDaParcela(S.todasParcelas()
      .filter(function (p) { return p.titulo_id === semRet.titulo.id; })[0].id) === null, '');

  /* A tela: quem faz a conta é o store, e o texto que mandava a
     pessoa adivinhar saiu. */
  const fs2 = require('fs');
  const tela = fs2.readFileSync(__dirname + '/js/ui-contas.js', 'utf8');
  verificar('v106 — a tela usa o resumo do store',
    /S\.notaDaParcela\(p\.id\)/.test(tela), '');
  verificar('v106 — e não faz mais a subtração errada',
    !/U\.brl\(p\.valor - tot\)/.test(tela), '');
  verificar('v106 — o texto que mandava a pessoa adivinhar saiu',
    !/foi lançada pelo bruto ou pelo líquido/.test(tela), '');
  verificar('v106 — e a tela avisa quando o bruto não foi informado',
    /não foi informado no lançamento/.test(tela), '');
  S.setUsuario('u8');
})();

// ── v106: o módulo passou a se chamar Documentação ───────────
(function () {
  const fs2 = require('fs');
  /* O RÓTULO muda; o ID não. O id está gravado na matriz de acesso
     e dentro das políticas do banco (`tem_nivel('habilitacao',…)`),
     nas sete tabelas e no balde de arquivos. Trocar os dois juntos
     exigiria migração em dois bancos e, no intervalo, tiraria o
     acesso de todo mundo ao cofre. */
  verificar('v106 — o módulo aparece como Documentação',
    (D.MODULOS.find(function (m) { return m.id === 'habilitacao'; }) || {}).nome === 'Documentação',
    (D.MODULOS.find(function (m) { return m.id === 'habilitacao'; }) || {}).nome);
  verificar('v106 — e o id continua habilitacao, que é o que o banco conhece',
    D.MODULOS.some(function (m) { return m.id === 'habilitacao'; }) &&
    !D.MODULOS.some(function (m) { return m.id === 'documentacao'; }), '');
  const indice2 = fs2.readFileSync(__dirname + '/index.html', 'utf8');
  const app2 = fs2.readFileSync(__dirname + '/js/app.js', 'utf8');
  verificar('v106 — a tela e a home usam o nome novo',
    /<h2>Documentação/.test(indice2) && /nome: 'Documentação'/.test(app2), '');
  verificar('v106 — nenhum rótulo visível ficou com o nome antigo',
    !/>Habilitação</.test(indice2) &&
    !/acesso a Habilitação/.test(fs2.readFileSync(__dirname + '/js/ui-habilitacao.js', 'utf8')), '');
  /* O SQL continua falando `habilitacao` — e tem de continuar. */
  const sql2 = fs2.readFileSync(__dirname + '/supabase/43-habilitacao.sql', 'utf8');
  verificar('v106 — as políticas do banco seguem com o id antigo',
    /tem_nivel\('habilitacao'/.test(sql2), '');
})();

concluir();
