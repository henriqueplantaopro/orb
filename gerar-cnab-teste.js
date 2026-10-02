/* Gera os arquivos de teste do CNAB: uma remessa com PIX, boleto e
   tributo, e um retorno correspondente com desfechos diferentes
   (pago, agendado, recusado por saldo, chave PIX inexistente). */
global.window = { ERP: {} };
global.ERP = global.window.ERP;
require('/home/claude/erp-teste-v122/js/util.js');
require('/home/claude/erp-teste-v122/js/dados.js');
require('/home/claude/erp-teste-v122/js/store.js');
require('/home/claude/erp-teste-v122/js/cnab-bradesco.js');
const fs = require('fs');
const S = ERP.store, D = ERP.dados, U = ERP.util;
S.init();
const b = D.bancos.find(x => x.layout_remessa === 'cnab240');
const cfg = {
  banco: b.banco, agencia: b.agencia, agencia_dv: b.agencia_dv, conta: b.conta, conta_dv: b.conta_dv,
  convenio: b.convenio, cnpj: b.cnpj, nomeEmpresa: b.razao_social,
  dataPagamento: '2026-10-05', sequencialArquivo: 1, agora: new Date('2026-09-29T09:00:00')
};
const venc = '2026-10-05';
const itens = [
  { seuNumero: 1, nome: 'DRA MARINA ALVES', documento: '12345678901', valor: 4820.50,
    vencimento: venc, chavePix: 'marina.alves@email.com', tipoChave: 'email', finalidade: '03' },
  { seuNumero: 2, nome: 'DR CARLOS EDUARDO LIMA', documento: '98765432100', valor: 7350.00,
    vencimento: venc, chavePix: '11987654321', tipoChave: 'telefone', finalidade: '03' },
  { seuNumero: 3, nome: 'MEDGAS COMERCIO DE GASES LTDA', documento: '11222333000181', valor: 1290.35,
    /* código de barras tem 44 posições (a linha digitável, 47, é outra
       coisa) — 237 no começo = boleto do próprio Bradesco */
    vencimento: venc, codigoBarras: '23793' + '8128'.padEnd(10, '0') + '00000129035'.padStart(29, '0') },
  { seuNumero: 4, nome: 'PREFEITURA DE BARUERI - ISS', documento: '34958609000190', valor: 862.14,
    vencimento: venc, codigoBarras: '858100000086214002530920263434958609000190'.padEnd(44, '0'), tributo: true }
];
const rem = ERP.cnab.gerarRemessa(cfg, itens);
if (rem.erros) { console.log('ERROS:', rem.erros); process.exit(1); }
fs.writeFileSync('/home/claude/cnab-teste/CB290926A.REM', rem.conteudo.replace(/\n/g, '\r\n'), 'latin1');
console.log('remessa gerada:', rem.conteudo.split('\n').length, 'registros de',
  new Set(rem.conteudo.split('\n').filter(Boolean).map(l => l.length)).size === 1 ? '240 posições' : 'TAMANHO IRREGULAR');
console.log('resumo:', JSON.stringify(rem.resumo || {}).slice(0, 200));

/* Retorno: a partir da própria remessa, viramos o código de arquivo
   para 2 (retorno) e carimbamos ocorrências diferentes em cada
   pagamento, para exercitar os quatro desfechos que o sistema trata. */
const linhas = rem.conteudo.split('\n').filter(Boolean);
const pos = (l, a, b, txt) => l.substring(0, a - 1) + txt + l.substring(b);
/* o "seu número" do CNAB é numérico e sequencial (é a chave que liga o
   retorno ao pagamento no sistema) */
const desfechos = { 1: '00', 2: 'PJ', 3: 'BD', 4: 'HB' };
const ret = linhas.map(function (l) {
  let x = l;
  if (x.substring(7, 8) === '0') x = pos(x, 143, 143, '2');   // 1=remessa, 2=retorno
  if (x.substring(7, 8) !== '3') return x;
  const seg = x.substring(13, 14);
  const seu = seg === 'A' ? x.substring(73, 93) : seg === 'J' ? x.substring(182, 202)
            : seg === 'O' ? x.substring(122, 142) : '';
  const cod = desfechos[String(parseInt(seu, 10))];
  if (!cod) return x;
  /* ocorrências: 231-240, até cinco códigos de duas posições */
  x = pos(x, 231, 240, (cod + '        ').slice(0, 10));
  /* no Segmento A o banco devolve data e valor efetivos */
  if (seg === 'A' && cod === '00') {
    x = pos(x, 155, 162, '05102026');
    x = pos(x, 163, 177, x.substring(119, 134));
  }
  return x;
});
fs.writeFileSync('/home/claude/cnab-teste/CB290926A.RET', ret.join('\r\n'), 'latin1');

const lido = ERP.cnab.lerRetorno(ret.join('\n'));
if (lido.erro) { console.log('ERRO ao ler:', lido.erro); process.exit(1); }
console.log('\nretorno lido:', lido.itens.length, 'pagamentos');
lido.itens.forEach(i => console.log('  seg ' + i.segmento, String(i.seuNumero).padEnd(10),
  String(i.desfecho).padEnd(9), 'R$ ' + i.valor.toFixed(2).padStart(9),
  (i.ocorrencias.join(',') || '-').padEnd(4), '·', i.mensagens.join(' / ')));
