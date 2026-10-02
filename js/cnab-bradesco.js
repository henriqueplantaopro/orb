/* ERP · cnab-bradesco.js — remessa e retorno CNAB 240 BRADESCO MULTIPAG.

   Duas fontes, e a ordem importa:

   1) PIX (Segmentos A e B, forma de lançamento 45): extraído de um
      arquivo REAL gerado pelo TOTVS Protheus e aceito pelo Bradesco
      (bra.rem, layout 089 / lote 045). Reproduz o que passou, inclusive
      as escolhas estranhas do Protheus, comentadas onde aparecem.

   2) Boleto (Segmentos J e J-52) e tributo com código de barras
      (Segmento O): do "Manual de Procedimentos Multipag Bradesco —
      Layout CNAB 240 Posições", versão 08, revisão de julho/2025,
      publicado pelo próprio Bradesco. Estes NÃO foram conferidos contra
      arquivo real ainda — a estrutura segue o manual, e a primeira
      remessa de boleto deve ir pequena, para conferência.

   Estrutura: header de arquivo (0) · um lote por forma de pagamento
   (header 1 · detalhes 3 · trailer 5) · trailer de arquivo (9).
   Todo registro tem 240 bytes.

   Módulo PURO: não conhece a tela nem o banco de dados. Serve igual
   para o ERP e para o PlantãoPro. */
window.ERP = window.ERP || {};

ERP.cnab = (function () {

  /* ── campos ─────────────────────────────────────────────*/
  const so = s => String(s == null ? '' : s).replace(/\D/g, '');
  function alfa(v, n) {
    let s = String(v == null ? '' : v).toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9 .,\-\/@_:+]/g, '');
    return s.slice(0, n).padEnd(n, ' ');
  }
  const num = (v, n) => so(v).slice(-n).padStart(n, '0');
  const val = (v, n) => String(Math.round((Number(v) || 0) * 100)).slice(-n).padStart(n, '0');
  const br = n => ' '.repeat(n);
  const ze = n => '0'.repeat(n);
  // ATENÇÃO: no CNAB 240 a data é DDMMAAAA (o Pag-For 500 usa AAAAMMDD)
  const dataDMA = iso => {
    if (!iso) return ze(8);
    const p = iso.slice(0, 10).split('-');
    return p.length === 3 ? p[2] + p[1] + p[0] : ze(8);
  };
  const horaHMS = d => [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(x => String(x).padStart(2, '0')).join('');

  /* Forma de iniciação do PIX (Segmento B, posições 15-16).
     No arquivo real veio '03' = chave CPF/CNPJ. */
  function formaIniciacao(tipoChave, chave) {
    const t = String(tipoChave || '').toLowerCase();
    if (t.indexOf('tel') > -1) return '01';
    if (t.indexOf('mail') > -1) return '02';
    if (t.indexOf('cnpj') > -1 || t.indexOf('cpf') > -1) return '03';
    if (t.indexOf('aleat') > -1) return '04';
    if (t.indexOf('banc') > -1 || t.indexOf('conta') > -1) return '05';
    const c = String(chave || '');
    if (c.indexOf('@') > -1) return '02';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(c)) return '04';
    const d = so(c);
    if (d.length === 11 || d.length === 14) return '03';
    if (d.length >= 10 && d.length <= 13) return '01';
    return '';
  }
  const chaveFormatada = (forma, chave) =>
    forma === '03' || forma === '01' ? so(chave) : String(chave || '').trim();

  const inscricao = doc => (so(doc).length === 14 ? '2' : (so(doc).length === 11 ? '1' : '0'));

  /* ── HEADER DE ARQUIVO (registro 0) ─────────────────────*/
  function headerArquivo(cfg, agora) {
    return [
      '237', '0000', '0',                    // 001-008
      br(9),                                 // 009-017 uso exclusivo
      '2',                                   // 018 tipo de inscrição (CNPJ)
      num(cfg.cnpj, 14),                     // 019-032
      alfa(cfg.convenio, 20),                // 033-052 código do convênio (alfa, à esquerda)
      num(cfg.agencia, 5),                   // 053-057
      alfa(cfg.agenciaDv, 1),                // 058
      num(cfg.conta, 12),                    // 059-070
      alfa(cfg.contaDv, 1),                  // 071
      br(1),                                 // 072 dv agência/conta (o Protheus deixa branco)
      alfa(cfg.nomeEmpresa, 30),             // 073-102
      alfa('BANCO BRADESCO S.A.', 30),       // 103-132
      br(10),                                // 133-142
      '1',                                   // 143 remessa
      dataDMA(cfg.dataGeracao),              // 144-151 DDMMAAAA
      horaHMS(agora),                        // 152-157
      num(cfg.sequencialArquivo, 6),         // 158-163
      num(cfg.versaoLayout || '089', 3),     // 164-166
      num(cfg.densidade || '01600', 5),      // 167-171
      br(20), br(20), br(29)                 // 172-240
    ].join('');
  }

  /* ── HEADER DE LOTE (registro 1) ────────────────────────*/
  /* Cada forma de pagamento é um lote, com forma de lançamento e versão
     de layout próprias (manual Multipag):
       PIX .................. forma 45, versão de lote 045
       boleto Bradesco ...... forma 30, versão 040
       boleto outros bancos . forma 31, versão 040
       conta/tributo ........ forma 11, versão 012  */
  const LOTES = {
    pix:     { forma: '45', versao: '045', indicativo: '01' },
    boleto:  { forma: '30', versao: '040', indicativo: null },
    boleto_outros: { forma: '31', versao: '040', indicativo: null },
    tributo: { forma: '11', versao: '012', indicativo: '01' }
  };

  function headerLote(cfg, lote, tipo) {
    const L = LOTES[tipo] || LOTES.pix;
    return [
      '237', num(lote, 4), '1',              // 001-008
      'C',                                   // 009 crédito
      num(cfg.tipoServico || '10', 2),       // 010-011 no arquivo real veio 10
      L.forma,                               // 012-013 forma de lançamento
      num(L.versao, 3),                      // 014-016 versão do lote
      br(1),                                 // 017
      '2', num(cfg.cnpj, 14),                // 018-032
      alfa(cfg.convenio, 20),                // 033-052
      num(cfg.agencia, 5), alfa(cfg.agenciaDv, 1),
      num(cfg.conta, 12), alfa(cfg.contaDv, 1), br(1), // 053-072
      alfa(cfg.nomeEmpresa, 30),             // 073-102
      br(40),                                // 103-142 mensagem
      alfa(cfg.endereco, 30),                // 143-172
      num(cfg.numeroEndereco || 0, 5),       // 173-177
      alfa(cfg.complemento, 15),             // 178-192
      alfa(cfg.cidade, 20),                  // 193-212
      num(cfg.cep, 5), num(cfg.cepCompl, 3), // 213-220
      alfa(cfg.uf, 2),                       // 221-222
      // no lote de título de cobrança o manual manda brancos aqui
      L.indicativo ? alfa(cfg.indicador || L.indicativo, 2) : br(2), // 223-224
      br(6),                                 // 225-230
      ze(10)                                 // 231-240 ocorrências (zeros na remessa)
    ].join('');
  }

  /* ── SEGMENTO A (registro 3) ────────────────────────────*/
  function segmentoA(cfg, it, lote, nseq) {
    return [
      '237', num(lote, 4), '3', num(nseq, 5), 'A', // 001-014
      '0',                                   // 015 inclusão
      '00',                                  // 016-017
      num(cfg.camara || '009', 3),           // 018-020 câmara (real: 009)
      // No PIX por chave o banco não usa os dados bancários do favorecido.
      // No arquivo real o Protheus preencheu o 1º pagamento com a própria
      // agência/conta da empresa e deixou o 2º em branco/zeros — os dois
      // passaram. Ficou a forma limpa (zeros), que é a semanticamente
      // correta; só preenche de verdade quando a forma é 05 (dados bancários).
      it.forma === '05' ? num(it.banco, 3) : br(3),            // 021-023
      it.forma === '05' ? num(it.agencia, 5) : ze(5),          // 024-028
      it.forma === '05' ? alfa(it.agenciaDv, 1) : '0',         // 029
      it.forma === '05' ? num(it.conta, 12) : ze(12),          // 030-041
      it.forma === '05' ? alfa(it.contaDv, 1) : '0',           // 042
      '0',                                                     // 043
      alfa(it.nome, 30),                     // 044-073 nome do favorecido
      num(it.seuNumero, 20),                 // 074-093 seu número (chave do retorno)
      dataDMA(it.dataPagamento || cfg.dataPagamento), // 094-101
      'BRL',                                 // 102-104
      ze(15),                                // 105-119 quantidade de moeda
      val(it.valor, 15),                     // 120-134 valor do pagamento
      br(20),                                // 135-154 nosso número (retorno)
      ze(8), ze(15),                         // 155-177 data e valor reais (retorno)
      br(40),                                // 178-217 mensagem
      alfa(cfg.finalidadeDoc || '07', 2),    // 218-219 finalidade (real: 07)
      br(5), br(2), br(3),                   // 220-229
      '0',                                   // 230 sem aviso ao favorecido
      br(10)                                 // 231-240 ocorrências
    ].join('');
  }

  /* ── SEGMENTO B (registro 3) — é aqui que vive a chave PIX ──
     No arquivo real: forma de iniciação em 15-16, tipo de inscrição em
     18, CPF/CNPJ do favorecido em 19-32 e a CHAVE a partir de 128. */
  function segmentoB(cfg, it, lote, nseq) {
    const forma = it.forma;
    const chave = chaveFormatada(forma, it.chavePix);
    return [
      '237', num(lote, 4), '3', num(nseq, 5), 'B', // 001-014
      num(forma, 2),                         // 015-016 forma de iniciação
      br(1),                                 // 017
      inscricao(it.documento),               // 018
      num(it.documento, 14),                 // 019-032
      br(95),                                // 033-127 informações 10 e 11 (não usadas)
      alfa(chave, 99),                       // 128-226 chave PIX ("Informação 12")
      br(6),                                 // 227-232 uso SIAPE
      br(8)                                  // 233-240 ISPB (branco, como no arquivo real)
    ].join('');
  }

  /* ── SEGMENTO J — pagamento de título de cobrança (boleto) ──
     Manual Multipag, versão 08: código de barras em 18-61. */
  function segmentoJ(cfg, it, lote, nseq) {
    return [
      '237', num(lote, 4), '3', num(nseq, 5), 'J', // 001-014
      '0', '00',                             // 015-017 inclusão
      num(it.codigoBarras, 44),              // 018-061 código de barras
      alfa(it.nome, 30),                     // 062-091 nome do beneficiário
      dataDMA(it.vencimento),                // 092-099 vencimento nominal
      val(it.valorTitulo == null ? it.valor : it.valorTitulo, 15), // 100-114
      val(it.desconto, 15),                  // 115-129 desconto + abatimento
      val(it.acrescimo, 15),                 // 130-144 mora + multa
      dataDMA(it.dataPagamento || cfg.dataPagamento), // 145-152
      val(it.valor, 15),                     // 153-167 valor do pagamento
      ze(15),                                // 168-182 quantidade da moeda
      num(it.seuNumero, 20),                 // 183-202 seu número
      br(20),                                // 203-222 nosso número (retorno)
      num(cfg.codigoMoeda || '09', 2),       // 223-224 moeda: 09 = Real
      br(6),                                 // 225-230
      br(10)                                 // 231-240 ocorrências
    ].join('');
  }

  /* ── SEGMENTO J-52 — quem paga e quem recebe ────────────
     Obrigatório para título de cobrança: sem ele o retorno vem com
     ocorrência de beneficiário divergente. */
  function segmentoJ52(cfg, it, lote, nseq) {
    return [
      '237', num(lote, 4), '3', num(nseq, 5), 'J', // 001-014
      br(1), '00', '52',                     // 015-019
      '2', num(cfg.cnpj, 15), alfa(cfg.nomeEmpresa, 40),        // 020-075 pagador (a empresa)
      inscricao(it.documento), num(it.documento, 15), alfa(it.nome, 40), // 076-131 beneficiário
      '0', ze(15), br(40),                   // 132-187 sacador (não informado)
      br(53)                                 // 188-240
    ].join('');
  }

  /* ── SEGMENTO O — conta ou tributo com código de barras ──*/
  function segmentoO(cfg, it, lote, nseq) {
    return [
      '237', num(lote, 4), '3', num(nseq, 5), 'O', // 001-014
      '0', '00',                             // 015-017
      alfa(it.codigoBarras, 44),             // 018-061 código de barras
      alfa(it.nome, 30),                     // 062-091 concessionária / órgão
      dataDMA(it.vencimento || it.dataPagamento || cfg.dataPagamento), // 092-099
      dataDMA(it.dataPagamento || cfg.dataPagamento), // 100-107
      val(it.valor, 15),                     // 108-122 valor do pagamento
      num(it.seuNumero, 20),                 // 123-142 seu número
      br(20),                                // 143-162 nosso número (retorno)
      br(68),                                // 163-230
      br(10)                                 // 231-240 ocorrências
    ].join('');
  }

  /* ── TRAILERS ───────────────────────────────────────────*/
  const trailerLote = (lote, qtd, total) =>
    ['237', num(lote, 4), '5', br(9), num(qtd, 6), val(total, 18),
     ze(18), ze(6), br(165), br(10)].join('');

  const trailerArquivo = (qtdLotes, qtdReg) =>
    ['237', '9999', '9', br(9), num(qtdLotes, 6), num(qtdReg, 6), ze(6), br(205)].join('');

  /* ── geração ────────────────────────────────────────────*/
  // classifica cada pagamento no lote a que pertence
  function tipoDoItem(it) {
    if (it.tipoLote) return it.tipoLote;
    const cb = so(it.codigoBarras);
    if (cb.length === 44) {
      if (cb.charAt(0) === '8') return 'tributo';               // arrecadação
      return cb.slice(0, 3) === '237' ? 'boleto' : 'boleto_outros';
    }
    return 'pix';
  }

  function gerarRemessa(cfg, itens) {
    const erros = validar(cfg, itens);
    if (erros.length) return { erros: erros };

    const agora = cfg.agora || new Date();
    const preparados = itens.map(function (it) {
      return Object.assign({}, it, {
        forma: it.formaIniciacao || formaIniciacao(it.tipoChave, it.chavePix),
        tipo: tipoDoItem(it)
      });
    });

    // um lote por forma de pagamento, na ordem PIX, boleto, tributo
    const ordem = ['pix', 'boleto', 'boleto_outros', 'tributo'];
    const grupos = ordem.map(function (t) {
      return { tipo: t, itens: preparados.filter(function (i) { return i.tipo === t; }) };
    }).filter(function (g) { return g.itens.length; });

    const linhas = [headerArquivo(cfg, agora)];
    let lote = 0;

    grupos.forEach(function (g) {
      lote++;
      const inicio = linhas.length;
      linhas.push(headerLote(cfg, lote, g.tipo));
      let nseq = 0;
      g.itens.forEach(function (it) {
        if (g.tipo === 'pix') {
          linhas.push(segmentoA(cfg, it, lote, ++nseq));
          linhas.push(segmentoB(cfg, it, lote, ++nseq));
        } else if (g.tipo === 'tributo') {
          linhas.push(segmentoO(cfg, it, lote, ++nseq));
        } else {
          linhas.push(segmentoJ(cfg, it, lote, ++nseq));
          linhas.push(segmentoJ52(cfg, it, lote, ++nseq));
        }
      });
      const total = g.itens.reduce(function (s, i) { return s + (Number(i.valor) || 0); }, 0);
      // quantidade de registros do lote = header + detalhes + trailer
      linhas.push(trailerLote(lote, linhas.length - inicio + 1, total));
    });

    const total = preparados.reduce(function (s, i) { return s + (Number(i.valor) || 0); }, 0);
    linhas.push(trailerArquivo(lote, linhas.length + 1));

    const fora = linhas.map(function (l, i) { return l.length === 240 ? null : (i + 1) + ':' + l.length; }).filter(Boolean);
    if (fora.length) return { erros: ['Registro fora de 240 posições (' + fora.join(', ') + ') — erro no gerador.'] };

    const avisos = [];
    preparados.forEach(function (it) {
      if (String(it.nome || '').length > 30) avisos.push('O nome de ' + it.nome + ' foi cortado em 30 caracteres (limite do layout).');
      if (it.tipo === 'pix' && it.forma !== '03') {
        avisos.push('O favorecido ' + it.nome + ' usa chave ' +
          ({ '01': 'de telefone', '02': 'de e-mail', '04': 'aleatória', '05': 'por dados bancários' }[it.forma] || '?') +
          '; o arquivo de referência só tinha chave CPF/CNPJ — vale conferir esse caso no primeiro envio.');
      }
    });
    if (grupos.some(function (g) { return g.tipo !== 'pix'; })) {
      avisos.push('Este arquivo tem lote de boleto ou tributo, montado pelo manual do Bradesco e ainda ' +
        'não conferido contra arquivo real. Envie primeiro uma remessa pequena.');
    }

    return {
      avisos: avisos,
      conteudo: linhas.join('\r\n') + '\r\n',
      nome: nomeArquivo(cfg),
      qtd: preparados.length,
      lotes: grupos.map(function (g) { return { tipo: g.tipo, qtd: g.itens.length }; }),
      total: Math.round(total * 100) / 100,
      registros: linhas.length
    };
  }

  const nomeArquivo = cfg => 'bra' + String(cfg.sequencialArquivo || 1).padStart(5, '0') + '.rem';

  function validar(cfg, itens) {
    const e = [];
    if (!cfg.convenio) e.push('Falta o código do convênio (posições 33-52 do header).');
    if (!cfg.agencia || !cfg.conta) e.push('Faltam agência e conta de débito do convênio.');
    if (so(cfg.cnpj).length !== 14) e.push('CNPJ da empresa pagadora inválido.');
    if (!cfg.nomeEmpresa) e.push('Falta o nome da empresa pagadora.');
    if (!cfg.dataPagamento) e.push('Falta a data de pagamento.');
    if (!cfg.sequencialArquivo) e.push('Falta o número sequencial do arquivo.');
    if (!itens || !itens.length) e.push('Nenhum pagamento selecionado.');
    (itens || []).forEach(function (it, i) {
      const q = 'Item ' + (i + 1) + ' (' + (it.nome || '?') + '): ';
      const d = so(it.documento).length;
      // no Segmento O (conta/tributo) o beneficiário não é identificado
      if (tipoDoItem(it) !== 'tributo' && d !== 11 && d !== 14) {
        e.push(q + 'CPF/CNPJ ausente ou inválido.');
      }
      if (!it.nome) e.push(q + 'nome do favorecido não informado.');
      if (!(Number(it.valor) > 0)) e.push(q + 'valor zerado.');
      if (!it.seuNumero) e.push(q + 'sem "seu número".');
      const tipo = tipoDoItem(it);
      if (tipo === 'pix') {
        const forma = it.formaIniciacao || formaIniciacao(it.tipoChave, it.chavePix);
        if (!forma) e.push(q + 'não consegui identificar a forma de iniciação do PIX.');
        if (!it.chavePix) e.push(q + 'sem chave PIX.');
      } else if (so(it.codigoBarras).length !== 44) {
        e.push(q + 'código de barras inválido (precisa de 44 posições).');
      }
    });
    return e;
  }

  /* ── retorno (CNAB 240) ─────────────────────────────────
     Ocorrências no Segmento A, posições 231-240, até 5 códigos de 2.
     O Segmento Z traz a autenticação do PIX e só aparece no que
     liquidou — é um segundo sinal de que o pagamento saiu. */
  const OCORRENCIAS = {
    '00': 'Crédito ou débito efetivado',
    '01': 'Insuficiência de fundos — débito não efetuado',
    '02': 'Crédito ou débito cancelado pelo pagador',
    '03': 'Débito autorizado pela agência — efetuado',
    BD: 'Inclusão efetuada com sucesso', BE: 'Alteração efetuada', BF: 'Exclusão efetuada',
    AE: 'Tipo/número de inscrição inválido', AG: 'Agência/conta/DV inválido',
    AL: 'Código do banco do favorecido inválido', AO: 'Nome do favorecido não informado',
    AP: 'Data de pagamento inválida ou não permitida', AR: 'Valor do lançamento inválido',
    AT: 'Tipo/número de inscrição do favorecido inválido',
    BB: 'Seu número inválido', HB: 'Saldo insuficiente',
    HF: 'Conta corrente da empresa com saldo insuficiente',
    PA: 'PIX não efetivado — tentar mais tarde',
    PB: 'Erro no PSP do recebedor', PC: 'Conta do recebedor encerrada',
    PE: 'Tipo de transação não autorizado na conta do recebedor',
    PF: 'CPF/CNPJ do recebedor não corresponde ao titular da conta',
    PG: 'CPF/CNPJ do recebedor incorreto', PH: 'Ordem rejeitada pelo PSP do recebedor',
    PJ: 'Chave PIX não cadastrada no DICT', PL: 'Forma de iniciação inválida',
    PM: 'Chave de pagamento inválida', PN: 'Chave de pagamento não informada'
  };

  /* F1 — o retorno tem TRÊS desfechos, não dois:
       pago      = o dinheiro saiu (00, 03)
       aceito    = o banco recebeu e agendou (BD, BE) — NÃO é recusa, e
                   o pagamento tem de continuar 'enviado', esperando a
                   ocorrência definitiva. Tratar isso como recusa
                   devolvia o pagamento para a fila e o banco pagava
                   duas vezes.
       recusado  = rejeição de fato (01, 02, AE, PJ…)
     Código que não está em nenhuma das três listas vai para análise
     humana: nunca volta sozinho para a remessa. */
  const OC_PAGO = ['00', '03', 'HF'];
  const OC_ACEITO = ['BD', 'BE', 'BF', 'HA', 'B1', 'B3'];
  const OC_RECUSA = ['01', '02', 'AE', 'AG', 'AL', 'AO', 'AP', 'AR', 'AT', 'BB', 'BM', 'BN',
                     'FE', 'FJ', 'FK', 'FL', 'FN', 'GD', 'GP', 'GZ', 'HB', 'HD', 'HG',
                     'PA', 'PB', 'PC', 'PE', 'PF', 'PG', 'PH', 'PJ', 'PL', 'PM', 'PN'];

  function classificar(ocs, autenticado) {
    if (autenticado) return 'pago';
    if (ocs.some(function (c) { return OC_PAGO.indexOf(c) > -1; })) return 'pago';
    if (ocs.some(function (c) { return OC_RECUSA.indexOf(c) > -1; })) return 'recusado';
    if (ocs.some(function (c) { return OC_ACEITO.indexOf(c) > -1; })) return 'aceito';
    return 'analise';
  }

  function lerRetorno(texto) {
    const linhas = String(texto).split(/\r\n|\n|\r/).filter(function (l) { return l.trim().length; });
    if (!linhas.length) return { erro: 'Arquivo vazio.' };
    const p = (l, a, b) => l.substring(a - 1, b);
    if (p(linhas[0], 8, 8) !== '0') return { erro: 'Primeiro registro não é header de arquivo.' };
    if (linhas.some(function (l) { return l.length !== 240; })) {
      return { erro: 'Há registros fora de 240 posições — o arquivo não parece CNAB 240.' };
    }

    const itens = [];
    linhas.forEach(function (l, i) {
      if (p(l, 8, 8) !== '3') return;
      const seg = p(l, 14, 14);
      const ehJ52 = seg === 'J' && p(l, 18, 19) === '52';
      if (seg === 'A' || (seg === 'J' && !ehJ52) || seg === 'O') {
        // cada segmento guarda "seu número" e o valor em posições próprias
        const mapa = {
          A: { seu: [74, 93], valor: [120, 134], dataPg: [94, 101], dataReal: [155, 162], valReal: [163, 177] },
          J: { seu: [183, 202], valor: [153, 167], dataPg: [145, 152], dataReal: null, valReal: null },
          O: { seu: [123, 142], valor: [108, 122], dataPg: [100, 107], dataReal: null, valReal: null }
        }[seg];
        const ocs = [];
        for (let k = 0; k < 5; k++) {
          const c = p(l, 231 + k * 2, 232 + k * 2).trim();
          if (c) ocs.push(c);
        }
        const dataReal = mapa.dataReal ? p(l, mapa.dataReal[0], mapa.dataReal[1]) : '';
        const seu = p(l, mapa.seu[0], mapa.seu[1]);
        itens.push({
          segmento: seg,
          seuNumero: seu.replace(/^0+/, '').trim() || '0',
          seuNumeroBruto: seu,
          nome: (seg === 'A' ? p(l, 44, 73) : p(l, 62, 91)).trim(),
          valor: parseInt(p(l, mapa.valor[0], mapa.valor[1]), 10) / 100,
          valorReal: mapa.valReal ? parseInt(p(l, mapa.valReal[0], mapa.valReal[1]), 10) / 100 : 0,
          dataPagamento: p(l, mapa.dataPg[0], mapa.dataPg[1]),
          dataReal: /^\d{8}$/.test(dataReal) && dataReal !== '00000000' ? dataReal : '',
          ocorrencias: ocs,
          mensagens: ocs.map(function (c) { return OCORRENCIAS[c] || 'código ' + c; }),
          autenticado: false,
          desfecho: classificar(ocs, false),
          pago: classificar(ocs, false) === 'pago'
        });
      } else if (seg === 'Z' && itens.length) {
        // autenticação do PIX: confirma que o último pagamento liquidou
        const ult = itens[itens.length - 1];
        ult.autenticado = true;
        ult.desfecho = 'pago';
        ult.pago = true;
      }
    });

    return { remessa: p(linhas[0], 158, 163), itens: itens };
  }

  return {
    gerarRemessa: gerarRemessa, lerRetorno: lerRetorno, validar: validar,
    formaIniciacao: formaIniciacao, tipoDoItem: tipoDoItem,
    nomeArquivo: nomeArquivo, OCORRENCIAS: OCORRENCIAS, LOTES: LOTES,
    classificar: classificar, OC_PAGO: OC_PAGO, OC_ACEITO: OC_ACEITO, OC_RECUSA: OC_RECUSA
  };
})();
