/* ERP · pdf.js — gerador de PDF próprio, sem biblioteca externa.

   O app roda como arquivo local, sem internet e sem build: dá pra usar
   a impressão do navegador, mas ela abre uma tela que toma o lugar do
   sistema (e no file:// dá pra perder o que estava aberto). Aqui a gente
   monta o PDF byte a byte e baixa o arquivo direto, igual ao CSV.

   Escopo de propósito pequeno: papel A4 (retrato ou paisagem), fontes
   padrão do PDF (Helvetica normal e negrito), texto, linhas e retângulos.
   É o suficiente pra holerite, relatório e fatura. Sem imagem, sem fonte
   embutida — se um dia precisar de logo, aí sim entra uma biblioteca. */
window.ERP = window.ERP || {};

ERP.pdf = (function () {
  const A4 = { retrato: [595.28, 841.89], paisagem: [841.89, 595.28] };

  /* PDF com fonte padrão usa WinAnsi (Latin-1 + alguns extras). Acento
     vira o byte certo; o que não existir na tabela vira o caractere sem
     acento ou '?', em vez de sujar o arquivo. */
  const EXTRAS = { '\u20AC': 128, '\u201A': 130, '\u201E': 132, '\u2026': 133, '\u2018': 145,
    '\u2019': 146, '\u201C': 147, '\u201D': 148, '\u2022': 149, '\u2013': 150, '\u2014': 151 };
  const SEM_ACENTO = { 'Ā': 'A', 'ā': 'a', 'Œ': 'OE', 'œ': 'oe', '\u2212': '-', '\u00A0': ' ' };
  function paraWinAnsi(txt) {
    let out = '';
    String(txt == null ? '' : txt).split('').forEach(function (ch) {
      const cod = ch.charCodeAt(0);
      if (cod < 256) { out += ch; return; }
      if (EXTRAS[ch] !== undefined) { out += String.fromCharCode(EXTRAS[ch]); return; }
      if (SEM_ACENTO[ch]) { out += SEM_ACENTO[ch]; return; }
      const semAcento = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      out += (semAcento.charCodeAt(0) < 256 ? semAcento : '?');
    });
    return out;
  }
  function escapar(txt) {
    return paraWinAnsi(txt).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  /* Larguras da Helvetica (em milésimos de em) — só o suficiente pra
     medir texto e cortar o que não cabe numa coluna. Aproximação por
     faixa de caracteres: o erro é pequeno e o uso aqui é de layout. */
  function larguraTexto(txt, tam, negrito) {
    const t = paraWinAnsi(txt);
    let w = 0;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (' ilj.,:;\'|!'.indexOf(c) > -1) w += 278;
      else if ('ftIr()[]-'.indexOf(c) > -1) w += 333;
      else if ('mMW@'.indexOf(c) > -1) w += 889;
      else if (c >= 'A' && c <= 'Z') w += 700;
      else w += 556;
    }
    return w / 1000 * tam * (negrito ? 1.06 : 1);
  }
  function cortar(txt, largura, tam, negrito) {
    let t = String(txt == null ? '' : txt);
    if (larguraTexto(t, tam, negrito) <= largura) return t;
    while (t.length > 1 && larguraTexto(t + '…', tam, negrito) > largura) t = t.slice(0, -1);
    return t + '…';
  }

  function doc(opcoes) {
    opcoes = opcoes || {};
    const tamanho = A4[opcoes.orientacao === 'paisagem' ? 'paisagem' : 'retrato'];
    const largura = tamanho[0], altura = tamanho[1];
    const margem = opcoes.margem !== undefined ? opcoes.margem : 34;   // ~12 mm
    const paginas = [];
    let atual = [];

    // y é contado de cima pra baixo (mais natural pra montar tabela)
    const y2pdf = y => altura - y;

    const api = {
      largura: largura, altura: altura, margem: margem,
      larguraUtil: largura - margem * 2,

      novaPagina: function () { paginas.push(atual); atual = []; return api; },

      texto: function (x, y, txt, o) {
        o = o || {};
        const tam = o.tam || 9;
        const fonte = o.negrito ? '/F2' : '/F1';
        let s = String(txt == null ? '' : txt);
        if (o.largura) s = cortar(s, o.largura, tam, o.negrito);
        let xx = x;
        if (o.alinhar === 'direita') xx = x - larguraTexto(s, tam, o.negrito);
        else if (o.alinhar === 'centro') xx = x - larguraTexto(s, tam, o.negrito) / 2;
        const cinza = o.cinza !== undefined ? o.cinza : 0;
        atual.push((cinza ? cinza.toFixed(2) + ' ' + cinza.toFixed(2) + ' ' + cinza.toFixed(2) + ' rg\n' : '0 0 0 rg\n') +
          'BT ' + fonte + ' ' + tam + ' Tf 1 0 0 1 ' + xx.toFixed(2) + ' ' + y2pdf(y).toFixed(2) + ' Tm (' + escapar(s) + ') Tj ET');
        return api;
      },

      linha: function (x1, y1, x2, y2, o) {
        o = o || {};
        const cor = o.cinza !== undefined ? o.cinza : 0.6;
        atual.push(cor.toFixed(2) + ' ' + cor.toFixed(2) + ' ' + cor.toFixed(2) + ' RG ' +
          (o.espessura || 0.5) + ' w ' +
          (o.tracejada ? '[3 2] 0 d ' : '[] 0 d ') +
          x1.toFixed(2) + ' ' + y2pdf(y1).toFixed(2) + ' m ' + x2.toFixed(2) + ' ' + y2pdf(y2).toFixed(2) + ' l S');
        return api;
      },

      retangulo: function (x, y, w, h, o) {
        o = o || {};
        const preenche = o.preenchimento !== undefined;
        atual.push((preenche ? o.preenchimento.toFixed(2) + ' ' + o.preenchimento.toFixed(2) + ' ' +
            o.preenchimento.toFixed(2) + ' rg ' : '') +
          (o.borda !== false ? '0.6 0.6 0.6 RG 0.5 w ' : '') +
          x.toFixed(2) + ' ' + y2pdf(y + h).toFixed(2) + ' ' + w.toFixed(2) + ' ' + h.toFixed(2) + ' re ' +
          (preenche && o.borda !== false ? 'B' : preenche ? 'f' : 'S'));
        return api;
      },

      larguraTexto: larguraTexto,

      /* Monta os objetos do PDF e devolve o Blob. Estrutura mínima:
         catálogo, páginas, duas fontes e um stream por página. */
      blob: function () {
        const todas = paginas.concat(atual.length ? [atual] : []);
        if (!todas.length) todas.push([]);
        const objs = [];
        const nPag = todas.length;
        const idsPagina = [], idsStream = [];
        for (let i = 0; i < nPag; i++) { idsPagina.push(4 + i * 2); idsStream.push(5 + i * 2); }

        objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        objs[2] = '<< /Type /Pages /Kids [' + idsPagina.map(function (id) { return id + ' 0 R'; }).join(' ') +
          '] /Count ' + nPag + ' >>';
        objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
        const idBold = 4 + nPag * 2;
        todas.forEach(function (conteudo, i) {
          objs[idsPagina[i]] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + largura.toFixed(2) + ' ' +
            altura.toFixed(2) + '] /Resources << /Font << /F1 3 0 R /F2 ' + idBold + ' 0 R >> >> /Contents ' +
            idsStream[i] + ' 0 R >>';
          const fluxo = conteudo.join('\n');
          objs[idsStream[i]] = '<< /Length ' + fluxo.length + ' >>\nstream\n' + fluxo + '\nendstream';
        });
        objs[idBold] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

        let pdf = '%PDF-1.4\n';
        const offsets = [];
        for (let i = 1; i < objs.length; i++) {
          if (objs[i] === undefined) continue;
          offsets[i] = pdf.length;
          pdf += i + ' 0 obj\n' + objs[i] + '\nendobj\n';
        }
        const inicioXref = pdf.length;
        const maxObj = objs.length;
        pdf += 'xref\n0 ' + maxObj + '\n0000000000 65535 f \n';
        for (let i = 1; i < maxObj; i++) {
          pdf += String(offsets[i] || 0).padStart(10, '0') + ' 00000 n \n';
        }
        pdf += 'trailer\n<< /Size ' + maxObj + ' /Root 1 0 R >>\nstartxref\n' + inicioXref + '\n%%EOF';

        // latin-1: cada caractere vira um byte, sem passar por UTF-8
        const bytes = new Uint8Array(pdf.length);
        for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
        return new Blob([bytes], { type: 'application/pdf' });
      },

      salvar: function (nomeArquivo) {
        const url = URL.createObjectURL(api.blob());
        const a = document.createElement('a');
        a.href = url;
        a.download = /\.pdf$/i.test(nomeArquivo) ? nomeArquivo : nomeArquivo + '.pdf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        return api;
      }
    };
    return api;
  }

  /* Tabela simples, usada pelos "exportar PDF" das telas de lista.
     colunas: [{ titulo, campo|valor(l), largura, alinhar }] */
  function tabela(opcoes) {
    const d = doc({ orientacao: opcoes.orientacao || 'paisagem' });
    const larguraTotal = opcoes.colunas.reduce(function (a, c) { return a + c.largura; }, 0);
    const escala = d.larguraUtil / larguraTotal;
    const cols = opcoes.colunas.map(function (c) { return Object.assign({}, c, { largura: c.largura * escala }); });
    let y = d.margem;

    function cabecalho() {
      d.texto(d.margem, y + 10, opcoes.titulo || '', { tam: 13, negrito: true });
      if (opcoes.subtitulo) d.texto(d.largura - d.margem, y + 10, opcoes.subtitulo, { tam: 8, cinza: 0.4, alinhar: 'direita' });
      y += 26;
      /* Notas do relatório (período, saldo bancário, totais) entram
         entre o título e a tabela — é a informação que o financeiro
         confere antes de olhar linha por linha. */
      (opcoes.notas || []).forEach(function (n) {
        d.texto(d.margem, y, n, { tam: 9, cinza: 0.25, largura: d.larguraUtil });
        y += 12;
      });
      if ((opcoes.notas || []).length) y += 6;
      let x = d.margem;
      cols.forEach(function (c) {
        d.texto(c.alinhar === 'direita' ? x + c.largura - 2 : x, y, c.titulo,
          { tam: 8, negrito: true, alinhar: c.alinhar, largura: c.largura - 4 });
        x += c.largura;
      });
      y += 4;
      d.linha(d.margem, y, d.largura - d.margem, y, { cinza: 0.3 });
      y += 11;
    }
    cabecalho();

    (opcoes.linhas || []).forEach(function (l) {
      if (y > d.altura - d.margem - 20) { d.novaPagina(); y = d.margem; cabecalho(); }
      let x = d.margem;
      cols.forEach(function (c) {
        const v = typeof c.valor === 'function' ? c.valor(l) : l[c.campo];
        d.texto(c.alinhar === 'direita' ? x + c.largura - 2 : x, y, v == null ? '' : String(v),
          { tam: 8, alinhar: c.alinhar, largura: c.largura - 4 });
        x += c.largura;
      });
      y += 3;
      d.linha(d.margem, y, d.largura - d.margem, y, { cinza: 0.85 });
      y += 11;
    });

    if (opcoes.rodape) {
      y += 6;
      d.texto(d.margem, y, opcoes.rodape, { tam: 8, cinza: 0.4 });
    }
    return d;
  }

  return { doc: doc, tabela: tabela };
})();
