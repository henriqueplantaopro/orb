/* ERP · ofx.js — leitura do extrato bancário em OFX.

   Layout conferido contra um extrato real do Bradesco (OFXSGML 102,
   charset 1252): valores em vírgula decimal, data em AAAAMMDDHHMMSS,
   FITID como identificador único de cada lançamento e MEMO com o
   histórico — é dele que sai a pista de quem pagou ou recebeu.

   O FITID é o que impede a mesma linha de entrar duas vezes, mesmo que
   o arquivo seja importado de novo com período sobreposto.

   OFX é SGML, não XML: as tags não fecham. Por isso a leitura é por
   blocos e não por parser de XML. Módulo puro. */
window.ERP = window.ERP || {};

ERP.ofx = (function () {

  const tag = (bloco, nome) => {
    const m = bloco.match(new RegExp('<' + nome + '>([^<\\r\\n]*)', 'i'));
    return m ? m[1].trim() : '';
  };

  /* "1977125,94", "-3.500,00" e também "1,234.56" (formato
     americano). Quando os dois separadores aparecem, quem vem por
     ÚLTIMO é o decimal — assumir vírgula fazia 1.234,56 virar 1,23
     num arquivo estrangeiro. */
  const valor = s => {
    const t = String(s || '').trim().replace(/\s/g, '');
    if (!t) return 0;
    const negativo = t.charAt(0) === '-';
    const corpo = t.replace('-', '');
    const ultimaVirgula = corpo.lastIndexOf(',');
    const ultimoPonto = corpo.lastIndexOf('.');
    let limpo;
    if (ultimaVirgula >= 0 && ultimoPonto >= 0) {
      limpo = ultimaVirgula > ultimoPonto
        ? corpo.replace(/\./g, '').replace(',', '.')
        : corpo.replace(/,/g, '');
    } else {
      limpo = corpo.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    }
    const v = parseFloat(limpo) || 0;
    return Math.round((negativo ? -v : v) * 100) / 100;
  };

  const data = s => {
    const d = String(s || '').replace(/\D/g, '');
    if (d.length < 8 || d.slice(0, 8) === '00000000') return '';
    return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
  };

  /* O MEMO do Bradesco traz o meio e, muitas vezes, a contraparte:
     "PIX RECEBIDO REM: IRMANDADE B DA S C DA 11/09"
     "TED-TRANSF ELET DISPON REMET.GRUPO HOSPITALAR CON"
     "PIX ENVIADO DES: FELLYPE RODRIGUES MEN 11/09" */
  function interpretar(memo) {
    const m = String(memo || '').toUpperCase();
    /* Cada banco escreve o histórico do seu jeito. Estes padrões
       cobrem Bradesco (validado em extrato real), Itaú e Santander:
         Itaú      "PIX TRANSF <NOME> 11/09", "TED  123456 <NOME>",
                   "SISPAG <NOME>", "PAGTO CONTA <...>"
         Santander "PIX ENVIADO <NOME>", "TED-OUTRA TIT <NOME>",
                   "PAGAMENTO FORNECEDOR", "TARIFA PACOTE DE SERVICOS" */
    const meio =
      /TARIFA|TAR COMANDADA|CESTA|PACOTE DE SERVICOS/.test(m) ? 'Tarifa' :
      /SISPAG|PAGAMENTO FORNECEDOR|PAG FORNEC/.test(m) ? 'Pagamento a fornecedor' :
      /PIX/.test(m) ? 'PIX' :
      /\bTED\b|TRANSF ELET/.test(m) ? 'TED' :
      /TARIFA|TAR COMANDADA/.test(m) ? 'Tarifa' :
      /PAGTO ELETRON|COBRANCA/.test(m) ? 'Boleto' :
      /DEB.*AUTOM|DEBITO AUTOM/.test(m) ? 'Débito automático' :
      /IMPOSTO|DARF|GPS|FGTS|GARE|TRIBUTO/.test(m) ? 'Tributo' :
      /SALARIO|FOLHA/.test(m) ? 'Folha' :
      /RESGATE|APLICACAO|INVESTIMENT/.test(m) ? 'Aplicação' : '';
    /* Nome da contraparte. O extrato corta o nome e às vezes deixa um
       resto numérico colado ("...PINHE 1"): a versão anterior exigia
       que o nome terminasse sem dígito e, com isso, PERDIA a linha
       inteira — o favorecido sumia. Agora pega tudo o que vem depois
       do marcador e só limpa a data no fim. */
    let quem = '';
    /* Marcadores de quem é a contraparte, somando os três bancos:
       Bradesco usa REM:/DES:; Itaú escreve o nome logo após o meio;
       Santander usa ENVIADO/RECEBIDO seguido do nome. */
    const rem = memo.match(
      /(?:REM:|REMET\.?|DES:|DEST\.?|BENEF\.?|PIX (?:ENVIADO|RECEBIDO|TRANSF)|SISPAG|TED[- ]?(?:OUTRA TIT|MESMA TIT)?)\s*(.+)$/i);
    /* Dois marcadores na mesma linha ("PIX RECEBIDO REM: FULANO") faziam
       o primeiro capturar o segundo junto, e o nome saía com "REM:"
       grudado. */
    const limparMarcador = s => String(s || '')
      .replace(/^(?:REM:|REMET\.?:?|DES:|DEST\.?:?|BENEF\.?:?|\d{6,}\s+)\s*/i, '').trim();
    if (rem) quem = limparCauda(limparMarcador(rem[1]));
    if (quem.replace(/[^A-Za-zÀ-ÿ]/g, '').length < 4) quem = '';   // só número não é nome
    return { meio: meio, contraparte: quem, tarifa: /TARIFA|TAR COMANDADA/.test(m) };
  }

  // tira a data e a pontuação solta do fim do texto
  const limparCauda = s => String(s || '')
    .replace(/\b\d{2}\/\d{2}(?:\/\d{2,4})?\s*$/, '')
    .replace(/[\s\-.,;:*]+$/, '')
    .trim();

  /* Nome utilizável de uma linha do extrato, sem a nomenclatura do
     banco: "PIX ENVIADO DES: WALERIA EMMILLY PINHE 1" vira
     "WALERIA EMMILLY PINHE 1". É o que a conciliação usa como
     descrição e como fornecedor quando lança em lote. */
  const RUIDO = new RegExp('^(?:' + [
    'PIX\\s+(?:ENVIADO|RECEBIDO|QRS?|TRANSF\\w*)', 'PIX',
    'TED\\s*[-–]?\\s*TRANSF\\s+ELET\\s+DISPON', 'TED', 'DOC',
    'TRANSFERENCIA\\s*(?:ENVIADA|RECEBIDA)?', 'TRANSF\\w*',
    'PAGTO\\s+ELETRON\\w*', 'PAGAMENTO\\s+ELETRONICO', 'PAGAMENTO', 'PAGTO',
    'DEBITO\\s+AUTOMATICO', 'DEB\\.?\\s*AUTOM\\w*', 'COBRANCA',
    'REM\\.?:', 'REMET\\.?:?', 'DES\\.?:', 'DEST\\.?:?', 'BENEF\\.?:?'
  ].join('|') + ')\\b[\\s:.\\-]*', 'i');

  function nomeLimpo(l) {
    if (l && l.contraparte) return l.contraparte;
    let s = String((l && l.memo) || '').trim();
    let antes;
    do { antes = s; s = s.replace(RUIDO, ''); } while (s !== antes && s);
    s = limparCauda(s);
    return s || limparCauda(String((l && l.memo) || ''));
  }

  /* O cabeçalho do OFX declara a codificação. Bradesco manda
     windows-1252; Itaú e Santander costumam mandar UTF-8. Ler tudo
     como 1252 embaralha os acentos do histórico, que é justamente de
     onde sai o nome da contraparte. */
  function codificacao(amostra) {
    const t = String(amostra || '').slice(0, 2000).toUpperCase();
    const cs = (t.match(/CHARSET:\s*([\w-]+)/) || [])[1] || '';
    const enc = (t.match(/ENCODING:\s*([\w-]+)/) || [])[1] || '';
    if (/UTF-8/.test(cs) || /UTF-8/.test(enc)) return 'utf-8';
    if (/8859-1|LATIN1/.test(cs)) return 'iso-8859-1';
    if (/1252/.test(cs)) return 'windows-1252';
    /* Sem declaração, o padrão do OFX SGML brasileiro é 1252. */
    return 'windows-1252';
  }

  function ler(texto) {
    const t = String(texto || '');
    if (!/<OFX>/i.test(t)) return { erro: 'Este arquivo não parece um OFX de extrato.' };

    const conta = {
      banco: tag(t, 'BANKID'),
      agencia: tag(t, 'BRANCHID'),
      numero: tag(t, 'ACCTID'),
      tipo: tag(t, 'ACCTTYPE'),
      moeda: tag(t, 'CURDEF')
    };
    const periodo = { ini: data(tag(t, 'DTSTART')), fim: data(tag(t, 'DTEND')) };
    const saldo = { valor: valor(tag(t, 'BALAMT')), data: data(tag(t, 'DTASOF')) };

    const blocos = t.split(/<STMTTRN>/i).slice(1);
    const lancamentos = blocos.map(function (b, i) {
      const corpo = b.split(/<\/STMTTRN>/i)[0];
      const v = valor(tag(corpo, 'TRNAMT'));
      const memo = tag(corpo, 'MEMO');
      const info = interpretar(memo);
      return {
        ordem: i + 1,
        tipo: tag(corpo, 'TRNTYPE').toUpperCase(),
        data: data(tag(corpo, 'DTPOSTED')),
        valor: v,
        entrada: v > 0 ? v : 0,
        saida: v < 0 ? -v : 0,
        fitid: tag(corpo, 'FITID'),
        documento: tag(corpo, 'CHECKNUM'),
        memo: memo,
        meio: info.meio,
        contraparte: info.contraparte,
        tarifa: info.tarifa
      };
    }).filter(function (l) { return l.fitid || l.valor; });

    // o sinal do TRNAMT nem sempre vem: DEBIT sem sinal é saída
    lancamentos.forEach(function (l) {
      if (l.tipo === 'DEBIT' && l.valor > 0) {
        l.valor = -l.valor; l.saida = -l.valor * -1; l.entrada = 0;
        l.saida = Math.abs(l.valor);
      }
    });

    const entradas = Math.round(lancamentos.reduce(function (s, l) { return s + l.entrada; }, 0) * 100) / 100;
    const saidas = Math.round(lancamentos.reduce(function (s, l) { return s + l.saida; }, 0) * 100) / 100;

    return {
      conta: conta, periodo: periodo, saldo: saldo,
      lancamentos: lancamentos,
      qtd: lancamentos.length,
      entradas: entradas, saidas: saidas,
      liquido: Math.round((entradas - saidas) * 100) / 100
    };
  }

  return { ler: ler, interpretar: interpretar, nomeLimpo: nomeLimpo, codificacao: codificacao };
})();
