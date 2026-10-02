/* ERP · qrcode.js — gerador de QR Code em SVG.

   Escrito aqui dentro porque o sistema roda offline, de um arquivo
   local: qualquer biblioteca de CDN deixaria a etiqueta em branco
   justamente no hospital, que é onde ela precisa funcionar.

   Cobre o que a etiqueta de patrimônio precisa e nada além: modo byte
   (ISO-8859-1), nível de correção M (recupera ~15% da área — suficiente
   para etiqueta suja ou levemente rasgada), versões 1 a 10 escolhidas
   automaticamente pelo tamanho do texto. Implementa Reed-Solomon,
   entrelaçamento de blocos, as 8 máscaras e a escolha da melhor pela
   penalidade padrão. */
window.ERP = window.ERP || {};

ERP.qrcode = (function () {
  /* ── aritmética de Galois (GF 256) para Reed-Solomon ────*/
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;   // polinômio primitivo do QR
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  function polinomioGerador(grau) {
    let p = [1];
    for (let i = 0; i < grau; i++) {
      const novo = new Array(p.length + 1).fill(0);
      for (let j = 0; j < p.length; j++) {
        novo[j] ^= p[j];
        novo[j + 1] ^= mul(p[j], EXP[i]);
      }
      p = novo;
    }
    return p;
  }

  function correcao(dados, qtd) {
    const gen = polinomioGerador(qtd);
    const res = new Array(dados.length + qtd).fill(0);
    dados.forEach(function (b, i) { res[i] = b; });
    for (let i = 0; i < dados.length; i++) {
      const coef = res[i];
      if (!coef) continue;
      for (let j = 0; j < gen.length; j++) res[i + j] ^= mul(gen[j], coef);
    }
    return res.slice(dados.length);
  }

  /* ── tabelas do padrão (nível M, versões 1 a 10) ────────
     [total de códigos, códigos de correção por bloco,
      blocos do grupo 1, blocos do grupo 2] */
  const VERSOES = {
    1:  [26, 10, 1, 0],   2:  [44, 16, 1, 0],   3:  [70, 26, 1, 0],
    4:  [100, 18, 2, 0],  5:  [134, 24, 2, 0],  6:  [172, 16, 4, 0],
    7:  [196, 18, 4, 0],  8:  [242, 22, 2, 2],  9:  [292, 22, 3, 2],
    10: [346, 26, 4, 1]
  };
  /* Posições dos padrões de alinhamento por versão. */
  const ALINHAMENTO = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  const capacidadeDados = v => {
    const [total, ecPorBloco, g1, g2] = VERSOES[v];
    return total - ecPorBloco * (g1 + g2);
  };

  /* ── montagem do fluxo de bits ──────────────────────────*/
  /* UTF-8, não Latin-1: é o que os leitores de celular assumem. Com
     Latin-1, "série" voltava como texto vazio no leitor. */
  function bytesUTF8(texto) {
    const out = [];
    for (let i = 0; i < texto.length; i++) {
      let c = texto.codePointAt(i);
      if (c > 0xFFFF) i++;   // par substituto conta como um caractere
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F)); }
      else if (c < 0x10000) { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F)); }
      else {
        out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 0x3F),
                 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      }
    }
    return out;
  }

  function bitsDoTexto(texto, versao) {
    const bytes = bytesUTF8(texto);
    const cap = capacidadeDados(versao);
    const bits = [];
    const põe = (valor, n) => { for (let i = n - 1; i >= 0; i--) bits.push((valor >> i) & 1); };
    põe(0b0100, 4);                       // modo byte
    põe(bytes.length, versao <= 9 ? 8 : 16);
    bytes.forEach(function (b) { põe(b, 8); });
    /* Terminador, alinhamento em byte e bytes de enchimento. */
    for (let i = 0; i < 4 && bits.length < cap * 8; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const codigos = [];
    for (let i = 0; i < bits.length; i += 8) {
      codigos.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    }
    const ench = [0xEC, 0x11];
    let k = 0;
    while (codigos.length < cap) codigos.push(ench[k++ % 2]);
    return codigos;
  }

  /* Blocos entrelaçados: o padrão espalha os códigos para que um
     rasgo local não destrua um bloco inteiro. */
  function codigosFinais(texto, versao) {
    const [, ecPorBloco, g1, g2] = VERSOES[versao];
    const dados = bitsDoTexto(texto, versao);
    const totalBlocos = g1 + g2;
    const porBloco1 = Math.floor(dados.length / totalBlocos);
    const blocos = [];
    let pos = 0;
    for (let i = 0; i < totalBlocos; i++) {
      const tam = i < g1 ? porBloco1 : porBloco1 + 1;
      blocos.push(dados.slice(pos, pos + tam));
      pos += tam;
    }
    const ec = blocos.map(function (b) { return correcao(b, ecPorBloco); });
    const saida = [];
    const maiorDado = Math.max.apply(null, blocos.map(function (b) { return b.length; }));
    for (let i = 0; i < maiorDado; i++) {
      blocos.forEach(function (b) { if (i < b.length) saida.push(b[i]); });
    }
    for (let i = 0; i < ecPorBloco; i++) {
      ec.forEach(function (b) { saida.push(b[i]); });
    }
    return saida;
  }

  /* ── matriz ─────────────────────────────────────────────*/
  function novaMatriz(n) {
    const m = [];
    for (let i = 0; i < n; i++) m.push(new Array(n).fill(null));
    return m;
  }

  function padroes(m, versao) {
    const n = m.length;
    const localizador = (li, co) => {
      for (let i = -1; i <= 7; i++) {
        for (let j = -1; j <= 7; j++) {
          const y = li + i, x = co + j;
          if (y < 0 || y >= n || x < 0 || x >= n) continue;
          const borda = (i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
                        (j >= 0 && j <= 6 && (i === 0 || i === 6));
          const miolo = i >= 2 && i <= 4 && j >= 2 && j <= 4;
          m[y][x] = (borda || miolo) ? 1 : 0;
        }
      }
    };
    localizador(0, 0); localizador(0, n - 7); localizador(n - 7, 0);
    /* Linhas de sincronismo. */
    for (let i = 8; i < n - 8; i++) {
      m[6][i] = i % 2 === 0 ? 1 : 0;
      m[i][6] = i % 2 === 0 ? 1 : 0;
    }
    /* Alinhamento, exceto onde colide com os localizadores. */
    const pos = ALINHAMENTO[versao];
    pos.forEach(function (li) {
      pos.forEach(function (co) {
        if ((li === 6 && co === 6) || (li === 6 && co === n - 7) || (li === n - 7 && co === 6)) return;
        for (let i = -2; i <= 2; i++) {
          for (let j = -2; j <= 2; j++) {
            m[li + i][co + j] = (Math.abs(i) === 2 || Math.abs(j) === 2 || (i === 0 && j === 0)) ? 1 : 0;
          }
        }
      });
    });
    m[n - 8][8] = 1;   // módulo sempre escuro

    /* Da versão 7 em diante o padrão exige dois blocos 6x3 com a
       versão codificada em BCH(18,6). Sem eles o leitor não reconhece
       o código: era o que limitava a etiqueta a ~105 caracteres. */
    if (versao >= 7) {
      let bch = versao << 12;
      for (let i = 5; i >= 0; i--) {
        if (bch & (1 << (i + 12))) bch ^= 0b1111100100101 << i;
      }
      const bits = (versao << 12) | bch;
      for (let i = 0; i < 18; i++) {
        const bit = (bits >> i) & 1;
        const li = Math.floor(i / 3), co = i % 3;
        m[li][n - 11 + co] = bit;
        m[n - 11 + co][li] = bit;
      }
    }
  }

  const reservado = (m, li, co, n) =>
    (li <= 8 && co <= 8) || (li <= 8 && co >= n - 8) || (li >= n - 8 && co <= 8) ||
    li === 6 || co === 6 || m[li][co] !== null;

  function preencher(m, codigos) {
    const n = m.length;
    const bits = [];
    codigos.forEach(function (c) { for (let i = 7; i >= 0; i--) bits.push((c >> i) & 1); });
    let idx = 0, subindo = true;
    for (let col = n - 1; col > 0; col -= 2) {
      if (col === 6) col--;                       // pula a coluna de sincronismo
      for (let passo = 0; passo < n; passo++) {
        const li = subindo ? n - 1 - passo : passo;
        for (let c = 0; c < 2; c++) {
          const co = col - c;
          if (m[li][co] !== null) continue;
          m[li][co] = idx < bits.length ? bits[idx] : 0;
          idx++;
        }
      }
      subindo = !subindo;
    }
  }

  const MASCARAS = [
    (i, j) => (i + j) % 2 === 0,
    (i) => i % 2 === 0,
    (i, j) => j % 3 === 0,
    (i, j) => (i + j) % 3 === 0,
    (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
    (i, j) => (i * j) % 2 + (i * j) % 3 === 0,
    (i, j) => ((i * j) % 2 + (i * j) % 3) % 2 === 0,
    (i, j) => ((i + j) % 2 + (i * j) % 3) % 2 === 0
  ];

  /* Penalidade do padrão: escolhe a máscara que deixa o código menos
     "listrado", porque leitor erra em padrão repetitivo. */
  function penalidade(m) {
    const n = m.length;
    let p = 0;
    const linha = (get) => {
      for (let i = 0; i < n; i++) {
        let seq = 1;
        for (let j = 1; j < n; j++) {
          if (get(i, j) === get(i, j - 1)) { seq++; }
          else { if (seq >= 5) p += 3 + (seq - 5); seq = 1; }
        }
        if (seq >= 5) p += 3 + (seq - 5);
      }
    };
    linha(function (i, j) { return m[i][j]; });
    linha(function (i, j) { return m[j][i]; });
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < n - 1; j++) {
        const v = m[i][j];
        if (v === m[i][j + 1] && v === m[i + 1][j] && v === m[i + 1][j + 1]) p += 3;
      }
    }
    let escuros = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (m[i][j]) escuros++;
    const pct = escuros * 100 / (n * n);
    p += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return p;
  }

  const BITS_FORMATO = 0b101010000010010;   // máscara do formato, padrão
  function gravarFormato(m, mascara) {
    const n = m.length;
    /* Nível M = 00; depois 15 bits com BCH. */
    let valor = (0b00 << 3) | mascara;
    let bch = valor << 10;
    for (let i = 4; i >= 0; i--) {
      if (bch & (1 << (i + 10))) bch ^= 0b10100110111 << i;
    }
    const bits = ((valor << 10) | bch) ^ BITS_FORMATO;
    const põe = (pos, bit) => { m[pos[0]][pos[1]] = bit; };
    for (let i = 0; i < 15; i++) {
      const bit = (bits >> i) & 1;
      if (i < 6) põe([i, 8], bit);
      else if (i < 8) põe([i + 1, 8], bit);
      else if (i === 8) põe([8, 7], bit);
      else põe([8, 14 - i], bit);

      if (i < 8) põe([8, n - 1 - i], bit);
      else põe([n - 15 + i, 8], bit);
    }
  }

  function matriz(texto) {
    const nBytes = bytesUTF8(texto).length;
    let versao = 1;
    /* Cabeçalho: 4 bits de modo + contador (8 bits até a v9, 16 depois)
       + 4 de terminador, arredondado para byte. */
    while (versao < 10) {
      const cabecalho = versao <= 9 ? 2 : 3;
      if (nBytes + cabecalho <= capacidadeDados(versao)) break;
      versao++;
    }
    if (nBytes + (versao <= 9 ? 2 : 3) > capacidadeDados(versao)) {
      throw new Error('Texto longo demais para a etiqueta (' + nBytes + ' bytes). ' +
        'Use uma URL curta apontando para a ficha.');
    }
    const n = 17 + versao * 4;
    const codigos = codigosFinais(texto, versao);

    let melhor = null;
    for (let k = 0; k < 8; k++) {
      const m = novaMatriz(n);
      padroes(m, versao);
      /* Reserva a área do formato antes de preencher os dados. */
      const reserva = [];
      for (let i = 0; i < 9; i++) { if (m[8][i] === null) { m[8][i] = 'F'; reserva.push([8, i]); } }
      for (let i = 0; i < 9; i++) { if (m[i][8] === null) { m[i][8] = 'F'; reserva.push([i, 8]); } }
      for (let i = 0; i < 8; i++) { if (m[8][n - 1 - i] === null) { m[8][n - 1 - i] = 'F'; reserva.push([8, n - 1 - i]); } }
      for (let i = 0; i < 8; i++) { if (m[n - 1 - i][8] === null) { m[n - 1 - i][8] = 'F'; reserva.push([n - 1 - i, 8]); } }
      preencher(m, codigos);
      /* Aplica a máscara só nos módulos de dados. */
      const fixos = novaMatriz(n);
      padroes(fixos, versao);   // inclui a informação de versão, que é fixa
      reserva.forEach(function (p) { fixos[p[0]][p[1]] = 'F'; });
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (fixos[i][j] !== null) continue;
          if (MASCARAS[k](i, j)) m[i][j] ^= 1;
        }
      }
      reserva.forEach(function (p) { m[p[0]][p[1]] = 0; });
      gravarFormato(m, k);
      const p = penalidade(m);
      if (!melhor || p < melhor.penalidade) melhor = { matriz: m, penalidade: p, mascara: k };
    }
    return melhor.matriz;
  }

  /* ── saída ──────────────────────────────────────────────*/
  function svg(texto, opcoes) {
    opcoes = opcoes || {};
    const m = matriz(texto);
    const n = m.length;
    const quiet = opcoes.quiet === undefined ? 4 : opcoes.quiet;   // borda branca obrigatória
    const total = n + quiet * 2;
    const tam = opcoes.tamanho || 160;
    let caminho = '';
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (m[i][j]) caminho += 'M' + (j + quiet) + ' ' + (i + quiet) + 'h1v1h-1z';
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + tam + '" height="' + tam +
      '" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges">' +
      '<rect width="' + total + '" height="' + total + '" fill="#fff"/>' +
      '<path d="' + caminho + '" fill="#000"/></svg>';
  }

  return { svg: svg, matriz: matriz };
})();
