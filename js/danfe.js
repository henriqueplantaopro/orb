/* ERP · danfe.js — leitura do PDF da nota fiscal.

   PDF que nasceu digital tem camada de texto: dá para ler no próprio
   navegador, sem servidor. PDF escaneado não tem, e aí só com OCR —
   o módulo detecta e diz isso em vez de devolver campos vazios.

   A parte confiável não depende do desenho do DANFE: é a CHAVE DE
   ACESSO. Os 44 dígitos são estruturados e, decodificados, entregam
   UF, mês de emissão, CNPJ do emitente, modelo, série e número da
   nota — sem depender de onde cada coisa foi impressa na página.
   Só valor e duplicatas precisam de heurística sobre o texto, e o
   módulo devolve o que achou marcando a confiança de cada campo.

   NFS-e em PDF é outra história: cada prefeitura desenha do seu jeito
   e não há chave estruturada. O que dá para tentar é número, CNPJ e
   valor, sempre para conferência humana.

   Depende de js/vendor/pdf.js (Mozilla pdf.js). Módulo puro. */
window.ERP = window.ERP || {};

ERP.danfe = (function () {

  const so = s => String(s == null ? '' : s).replace(/\D/g, '');
  const n2 = v => Math.round((parseFloat(v) || 0) * 100) / 100;
  // "1.234,56" -> 1234.56
  const valorBR = s => n2(String(s || '').replace(/\./g, '').replace(',', '.'));

  const UFS = {
    11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
    21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
    31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP',
    41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF'
  };

  /* ── chave de acesso ────────────────────────────────────
     cUF(2) AAMM(4) CNPJ(14) mod(2) série(3) nNF(9) tpEmis(1)
     cNF(8) DV(1) */
  function dvChave(ch43) {
    let peso = 2, soma = 0;
    for (let i = ch43.length - 1; i >= 0; i--) {
      soma += (+ch43[i]) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    const r = 11 - (soma % 11);
    return (r === 10 || r === 11) ? 0 : r;
  }

  function lerChave(ch) {
    const c = so(ch);
    if (c.length !== 44) return null;
    if (dvChave(c.slice(0, 43)) !== +c[43]) return { chave: c, invalida: true };
    const ano = +c.slice(2, 4), mes = c.slice(4, 6);
    return {
      chave: c,
      uf: UFS[+c.slice(0, 2)] || c.slice(0, 2),
      emissaoMes: '20' + String(ano).padStart(2, '0') + '-' + mes,
      cnpjEmitente: c.slice(6, 20),
      modelo: c.slice(20, 22),
      serie: String(+c.slice(22, 25)),
      numero: String(+c.slice(25, 34))
    };
  }

  /* ── extração do texto ──────────────────────────────────
     Abrindo o protótipo por file:// o navegador bloqueia Worker vindo
     de arquivo local. Carregar o worker como script comum antes resolve:
     o pdf.js encontra window.pdfjsWorker e roda na própria thread. */
  function prepararWorker() {
    if (window.pdfjsWorker || typeof document === 'undefined') return Promise.resolve();
    return new Promise(function (ok) {
      const s = document.createElement('script');
      s.src = 'js/vendor/pdf.worker.js';
      s.onload = function () { ok(); };
      s.onerror = function () { ok(); };   // segue e deixa o pdf.js tentar do jeito dele
      document.head.appendChild(s);
    });
  }

  function textoDoPDF(buffer) {
    const lib = window.pdfjsLib;
    if (!lib) return Promise.reject(new Error('pdf.js não carregado.'));
    return prepararWorker().then(function () {
    return lib.getDocument({ data: buffer, isEvalSupported: false }).promise.then(function (doc) {
      const paginas = [];
      const fila = [];
      for (let i = 1; i <= doc.numPages; i++) {
        fila.push(doc.getPage(i).then(function (pg) { return pg.getTextContent(); }));
      }
      return Promise.all(fila).then(function (conteudos) {
        const linhas = [];
        conteudos.forEach(function (c, pg) {
          const ls = emLinhas(c.items, pg + 1);
          ls.forEach(function (l) { linhas.push(l); });
          paginas.push(ls.map(function (l) { return l.txt; }).join('\n'));
        });
        return { texto: paginas.join('\n'), linhas: linhas, paginas: doc.numPages };
      });
    });
    });
  }

  /* Reconstrói as LINHAS do papel a partir dos fragmentos do pdf.js.

     Isto era o defeito central da leitura de PDF: os fragmentos vinham
     concatenados com espaço, virando uma única linha gigante por
     página. Sem linha não existe quadro de produtos, não existe linha
     de item e não existe "o nome logo acima do CNPJ" — todas as
     heurísticas de layout ficavam sem chão, e a leitura devolvia o
     que conseguisse achar solto no meio do texto.

     Cada fragmento traz a sua posição (transform[4] = x,
     transform[5] = y). Agrupando por y com tolerância e ordenando por
     x dentro do grupo, a linha do papel volta a existir. A tolerância
     sai da altura da fonte: DANFE mistura corpos bem diferentes na
     mesma página. */
  function emLinhas(itens, pagina) {
    const bons = (itens || []).filter(function (i) {
      return i.str && i.str.trim() && i.transform;
    }).map(function (i) {
      return { txt: i.str, x: i.transform[4], y: i.transform[5],
               w: i.width || (i.str.length * Math.abs(i.transform[3] || 8) * 0.5),
               h: Math.abs(i.height || i.transform[3] || 8) };
    }).sort(function (a, b) { return b.y - a.y || a.x - b.x; });

    const linhas = [];
    let atual = null;
    bons.forEach(function (f) {
      const tol = Math.max(1.6, f.h * 0.45);
      if (!atual || Math.abs(atual.y - f.y) > tol) {
        atual = { y: f.y, pagina: pagina, frag: [f] };
        linhas.push(atual);
      } else {
        atual.frag.push(f);
      }
    });

    return linhas.map(function (l) {
      l.frag.sort(function (a, b) { return a.x - b.x; });
      /* Vão grande entre fragmentos é separação de COLUNA, e vira dois
         espaços: é o que deixa "código | NCM | CFOP" distinguível de
         uma frase quebrada no meio. */
      let txt = '';
      let fimAnterior = null;
      l.frag.forEach(function (f) {
        if (fimAnterior !== null && f.x - fimAnterior > f.h * 0.9) txt += '  ';
        else if (txt && !/\s$/.test(txt) && !/^\s/.test(f.txt)) txt += ' ';
        txt += f.txt;
        fimAnterior = f.x + f.w;
      });
      /* Os fragmentos ficam guardados com o x: é o que permite ler o
         valor pela COLUNA, e não por proximidade no texto corrido. */
      return { y: Math.round(l.y * 10) / 10, pagina: l.pagina,
               frag: l.frag.map(function (f) {
                 return { txt: f.txt.trim(), x: Math.round(f.x * 10) / 10 }; }),
               txt: txt.replace(/[ \t]{3,}/g, '  ').trim() };
    }).filter(function (l) { return l.txt; });
  }

  /* ── valor total, pela COLUNA ───────────────────────────
     No DANFE o rótulo fica numa faixa e o número na faixa de baixo,
     alinhado à direita da mesma coluna. Procurar "o primeiro número
     depois do rótulo" no texto corrido pega o vizinho errado: depois
     de "VALOR TOTAL DA NOTA" vem a linha inteira de números, que
     começa no frete — e o frete desta nota é 0,00. Era exatamente
     isso que devolvia valor zero.

     Com o x de cada fragmento, a busca é na coluna do rótulo. */
  const MOEDA_EXATA = /^\d{1,3}(?:\.\d{3})*,\d{2}$/;
  const DATA_EXATA = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  /* Estritamente "da nota": "V. TOTAL PRODUTOS" e "VALOR TOTAL DOS
     PRODUTOS" ficam na faixa vizinha e dariam outro número. Os
     emissores abreviam de todas as formas — VALOR, V., VLR. */
  const ROTULO_TOTAL = /^(?:VALOR|VLR\.?|V\.)\s*TOTAL\s*D[AO]\s*(?:NOTA|NF)\b|VALOR\s*L[ÍI]QUIDO|VALOR\s*TOTAL\s*DOS?\s*SERVI/i;
  const ROTULO_EMISSAO = /DATA\s*(?:DE|DA)?\s*EMISS[ÃA]O/i;

  /* Lê o campo que fica ABAIXO do rótulo, na mesma coluna.

     No DANFE, rótulo e valor são duas faixas: o rótulo numa, o dado na
     de baixo, alinhado na coluna. Procurar "o primeiro número depois
     do rótulo" no texto corrido pega o vizinho de coluna — foi o que
     devolvia zero no total (pegava o frete) e o CNPJ em vez da data de
     emissão. Com o x de cada fragmento, a busca é na coluna certa. */
  function porColuna(linhas, rotulo, aceita) {
    for (let i = 0; i < (linhas || []).length; i++) {
      const l = linhas[i];
      const rot = (l.frag || []).find(function (z) { return rotulo.test(z.txt); });
      if (!rot) continue;
      const cands = [];
      linhas.forEach(function (o) {
        if (o.pagina !== l.pagina) return;
        const dy = l.y - o.y;
        if (dy <= 0 || dy > 26) return;            // só a faixa imediatamente abaixo
        (o.frag || []).forEach(function (z) {
          if (!aceita(z.txt)) return;
          if (z.x < rot.x - 12) return;            // coluna à esquerda, outro campo
          cands.push({ txt: z.txt, dx: Math.abs(z.x - rot.x), dy: dy });
        });
      });
      if (cands.length) {
        cands.sort(function (a, b) { return a.dy - b.dy || a.dx - b.dx; });
        return cands[0].txt;
      }
    }
    return null;
  }

  function acharValorGeo(linhas) {
    const t = porColuna(linhas, ROTULO_TOTAL, function (s2) { return MOEDA_EXATA.test(s2); });
    return t ? { valor: valorBR(t), confianca: 'rótulo e coluna' } : null;
  }

  function acharEmissaoGeo(linhas) {
    const t = porColuna(linhas, ROTULO_EMISSAO, function (s2) { return DATA_EXATA.test(s2); });
    if (!t) return '';
    const m = t.match(DATA_EXATA);
    return m[3] + '-' + m[2] + '-' + m[1];
  }

  /* ── heurísticas sobre o texto ──────────────────────────*/
  function acharValor(txt) {
    // procura o rótulo e pega o primeiro número com centavos depois dele
    const rotulos = [
      /VALOR\s+TOTAL\s+DA\s+NOTA[^\d]{0,80}([\d.]+,\d{2})/i,
      /V\.?\s*TOTAL\s+DA\s+NOTA[^\d]{0,80}([\d.]+,\d{2})/i,
      /VALOR\s+TOTAL\s+DOS?\s+SERVI[ÇC]OS?[^\d]{0,80}([\d.]+,\d{2})/i,
      /VALOR\s+L[ÍI]QUIDO[^\d]{0,80}([\d.]+,\d{2})/i,
      /TOTAL\s+DA\s+NOTA[^\d]{0,80}([\d.]+,\d{2})/i
    ];
    for (let i = 0; i < rotulos.length; i++) {
      const m = txt.match(rotulos[i]);
      if (m) return { valor: valorBR(m[1]), confianca: 'rótulo encontrado' };
    }
    // sem rótulo: fica com o maior valor monetário da página
    const todos = (txt.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) || []).map(valorBR);
    if (!todos.length) return { valor: 0, confianca: 'nenhum valor encontrado' };
    return { valor: Math.max.apply(null, todos), confianca: 'maior valor da página — confira' };
  }

  function acharDuplicatas(txt) {
    // o quadro de fatura costuma vir como  001  27/09/2026  4.320,45
    const re = /(\d{1,3})\s+(\d{2}\/\d{2}\/\d{4})\s+([\d.]+,\d{2})/g;
    const achadas = [];
    let m;
    while ((m = re.exec(txt)) !== null) {
      const p = m[2].split('/');
      achadas.push({ numero: m[1], venc: p[2] + '-' + p[1] + '-' + p[0], valor: valorBR(m[3]) });
    }
    return achadas;
  }

  function acharEmissao(txt) {
    const m = txt.match(/EMISS[ÃA]O[^\d]{0,40}(\d{2}\/\d{2}\/\d{4})/i);
    if (!m) return '';
    const p = m[1].split('/');
    return p[2] + '-' + p[1] + '-' + p[0];
  }

  /* Natureza da operação é o campo que mais engana: fica colado no
     quadro do emitente e é frase, não nome. "VENDA DE PROD.ESTAB.C/
     SUBST.TR" foi lido como razão social justamente por isso. */
  const NATUREZA = /^(VENDA|COMPRA|REMESSA|DEVOLU|TRANSFER|BONIFICA|INDUSTRIALIZA|SIMPLES FATURAMENTO|OUTRAS? (SAIDA|ENTRADA))/i;
  const PARECE_EMPRESA = /\b(LTDA|S\/?A|SA|EIRELI|MEI|ME|EPP|CIA|INDUSTRIA|COMERCIO|DISTRIBUID|SERVICOS|ATACAD)\b/i;

  function acharNome(txt, cnpj, linhas) {
    /* Melhor fonte: o recibo do transportador, no alto de todo DANFE,
       traz a razão social inteira entre dois textos fixos. É layout
       padronizado, não chute. */
    const rec = txt.match(/RECEBEMOS\s+DE\s+(.{6,120}?)\s+OS\s+PRODUTOS/i);
    if (rec) {
      const n = rec[1].replace(/\s+/g, ' ').trim();
      if (!NATUREZA.test(n)) return n.slice(0, 90);
    }

    /* Segunda fonte: as linhas do quadro do emitente. A razão social
       costuma vir quebrada em duas, então junta as vizinhas que
       parecem continuação do nome. */
    if (linhas && linhas.length) {
      const cands = linhas.filter(function (l) {
        const t = l.txt;
        return t.length > 8 && PARECE_EMPRESA.test(t) && !NATUREZA.test(t) &&
               !/RECEBEMOS|DANFE|CHAVE|CONSULTA|DESTINAT|REMETENTE|TRANSPORTAD/i.test(t);
      });
      if (cands.length) {
        const base = cands[0];
        const vizinha = linhas.find(function (l) {
          return l.pagina === base.pagina && l.y < base.y && base.y - l.y < 14 &&
                 /^(DE |E )?[A-ZÀ-Ÿ][A-ZÀ-Ÿ\s.&-]{4,60}$/.test(l.txt) &&
                 !PARECE_EMPRESA.test(l.txt) === false;
        });
        const nome = vizinha && vizinha.txt !== base.txt
          ? (base.y > vizinha.y ? base.txt + ' ' + vizinha.txt : vizinha.txt + ' ' + base.txt)
          : base.txt;
        return nome.replace(/\s+/g, ' ').trim().slice(0, 90);
      }
    }

    // o nome do emitente costuma vir logo antes ou depois do CNPJ dele
    if (!cnpj) return '';
    const fmt = cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    const i = txt.indexOf(fmt) > -1 ? txt.indexOf(fmt) : txt.indexOf(cnpj);
    if (i < 0) return '';
    // o texto do PDF vem colado; tira o cabeçalho fixo do DANFE e fica
    // com o pedaço mais próximo do CNPJ, que costuma ser a razão social
    const LIXO = /(DANFE|DOCUMENTO AUXILIAR|NOTA FISCAL ELETR|IDENTIFICA|RECEBEMOS DE|EMITENTE|CNPJ|INSCRI)/i;
    const antes = txt.slice(Math.max(0, i - 160), i)
      .split(/\n|\s{2,}|,\s/).map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 6 && !LIXO.test(s) && /[A-Za-zÀ-ÿ]{4}/.test(s); });
    const cand = antes.pop() || '';
    const pareceEndereco = /^\d/.test(cand) || /\/[A-Z]{2}\b/.test(cand) ||
      /\b(RUA|AV|AVENIDA|ROD|TRAVESSA|ALAMEDA|BAIRRO|CEP)\b/i.test(cand);
    return (pareceEndereco || NATUREZA.test(cand)) ? '' : cand.slice(0, 60);
  }

  /* ── leitura ────────────────────────────────────────────*/
  function ler(buffer, opcoes) {
    opcoes = opcoes || {};
    return textoDoPDF(buffer).then(function (r) {
      const txt = r.texto.replace(/\s+/g, ' ');
      if (txt.replace(/\s/g, '').length < 40) {
        return {
          erro: 'Este PDF não tem texto — parece digitalizado. Ler exige OCR, que roda no servidor. ' +
                'Se tiver o XML da nota, use ele: a leitura é exata.'
        };
      }

      const avisos = [];
      // a chave às vezes vem em grupos de 4 dígitos
      /* A chave é impressa em 11 grupos de 4. A busca anterior varria o
         texto corrido e a gulodice do quantificador engolia os números
         vizinhos, devolvendo cadeias com mais de 44 dígitos que o
         filtro descartava — a chave existia no papel e era perdida.
         Com as linhas reconstruídas, ela é a linha cujos dígitos somam
         exatamente 44. */
      const porLinha = (r.linhas || []).map(function (l) { return so(l.txt); })
        .filter(function (d) { return d.length === 44; });
      const grupos = (txt.match(/(?:\d{4}[\s.]+){10}\d{4}/g) || []).map(so)
        .filter(function (d) { return d.length === 44; });
      const direta = (txt.match(/\d{44}/g) || []);
      const chaveTxt = porLinha[0] || direta[0] || grupos[0] || '';
      const ch = lerChave(chaveTxt);

      if (ch && ch.invalida) avisos.push('A chave encontrada não passa no dígito verificador — confira os campos.');
      if (!ch) avisos.push('Não achei a chave de acesso no PDF: número, série e CNPJ vieram do texto, com menos certeza.');

      const val = acharValorGeo(r.linhas) || acharValor(txt);
      const dups = acharDuplicatas(txt);
      const emissao = acharEmissaoGeo(r.linhas) || acharEmissao(txt) ||
        (ch && !ch.invalida ? ch.emissaoMes + '-01' : '');
      const cnpj = ch && !ch.invalida ? ch.cnpjEmitente
        : (txt.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/) || [''])[0].replace(/\D/g, '');

      if (val.confianca !== 'rótulo encontrado') {
        avisos.push('O valor foi deduzido (' + val.confianca + ').');
      }
      if (!dups.length) avisos.push('Não identifiquei o quadro de duplicatas — informe as parcelas à mão.');
      /* O outro CNPJ da nota é o do destinatário. Serve para a checagem
         que importa numa entrada de estoque: nota em que a empresa é o
         EMITENTE é venda, não compra — dar entrada nela lançaria
         material que saiu como se tivesse entrado. */
      const docs = (txt.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g) || []).map(so);
      const doDest = docs.find(function (d) { return d !== cnpj; }) || '';
      const daEmpresa = opcoes.cnpjEmpresa ? so(opcoes.cnpjEmpresa) : '';
      if (daEmpresa && cnpj && daEmpresa === cnpj) {
        avisos.push('O emitente desta nota é a própria empresa: é uma nota de SAÍDA, não de compra. ' +
          'Dar entrada nela lançaria no estoque material que saiu.');
      } else if (daEmpresa && doDest && daEmpresa !== doDest) {
        avisos.push('O destinatário da nota não é a empresa — confira se a nota é mesmo desta compra.');
      }

      const itens = acharItens(r.texto, r.linhas);
      if (itens.length) {
        avisos.push(itens.length + ' item(ns) lido(s) do quadro de produtos por heurística de layout. ' +
          'Confira quantidade e valor unitário contra o papel antes de dar entrada.');
      } else {
        avisos.push('Não identifiquei o quadro de produtos. Informe os itens à mão, ou use o XML — ' +
          'nele os itens vêm em campo próprio, com NCM e código de barras.');
      }

      return {
        tipo: 'pdf',
        rotulo: ch && !ch.invalida
          ? 'DANFE em PDF (chave lida)' : 'PDF de nota fiscal (leitura por texto)',
        confiavel: !!(ch && !ch.invalida),
        chave: ch ? ch.chave : '',
        numero: ch && !ch.invalida ? ch.numero : (txt.match(/N[ºO°]?\.?\s?(\d{3}\.?\d{3}\.?\d{3})/) || ['', ''])[1].replace(/\D/g, ''),
        serie: ch && !ch.invalida ? ch.serie : '',
        emissao: emissao,
        uf: ch && !ch.invalida ? ch.uf : '',
        modelo: ch && !ch.invalida ? ch.modelo : '',
        emitente: Object.assign({ nome: acharNome(txt, cnpj, r.linhas), documento: cnpj },
          acharEndereco(r.linhas || [])),
        destinatario: { documento: doDest },
        valor: val.valor,
        duplicatas: dups,
        retencoes: [], itens: itens,
        valorRetido: 0, valorLiquido: val.valor,
        complemento: acharComplemento(r.linhas || []),
        paginas: r.paginas,
        avisos: avisos
      };
    }).catch(function (e) {
      return { erro: 'Não consegui abrir o PDF: ' + e.message };
    });
  }

  /* Endereço do emitente. O quadro fica na coluna da esquerda e o
     pdf.js entrega as linhas dele intercaladas com as das colunas
     vizinhas, então a busca é por formato, não por posição:
     logradouro, CEP, município/UF e telefone têm forma reconhecível. */
  function acharEndereco(linhas) {
    /* Só dentro do quadro do emitente. Fora dele há dois endereços
       que enganam: o do DESTINATÁRIO, logo abaixo, e o que alguns
       emissores repetem no recibo do transportador, no topo. */
    const ate = linhas.findIndex(function (l) {
      return /^(DESTINAT[ÁA]RIO|DESTINATARIO)/i.test(l.txt) || /DESTINAT[ÁA]RIO\s*\/\s*REMETENTE/i.test(l.txt);
    });
    const de = linhas.findIndex(function (l) {
      return /DANFE|IDENTIFICA[ÇC][ÃA]O DO EMITENTE|Identifica[çc][ãa]o do emitente/i.test(l.txt);
    });
    const ini = de >= 0 ? de : 0;
    const fim = ate > ini ? ate : Math.min(linhas.length, ini + 30);
    const bloco = linhas.slice(ini, fim).map(function (l) { return l.txt; });
    const tudo = bloco.join(' | ');
    const out = {};

    const end = bloco.find(function (t) {
      return /^(AVENIDA|AV\.?|RUA|R\.|RODOVIA|ROD\.?|ALAMEDA|PRACA|PRAÇA|TRAVESSA|ESTRADA)\b/i.test(t);
    });
    if (end) out.logradouro = end.replace(/\s*-\s*$/, '').replace(/\s{2,}.*$/, '').trim().slice(0, 80);

    // CEP sai com ou sem rótulo, com ou sem ponto: 08586-010, 89.203-212
    const cep = tudo.match(/CEP[:\s]*(\d{2})\.?(\d{3})-?(\d{3})/i) ||
                tudo.match(/\b(\d{2})\.(\d{3})-(\d{3})\b/) ||
                tudo.match(/\b(\d{2})(\d{3})-(\d{3})\b/);
    if (cep) out.cep = cep[1] + cep[2] + cep[3];

    /* Município e UF vêm como "CIDADE - UF" ou "CIDADE/UF", e em
       maiúsculas ou não — cada emissor escolhe. A sigla tem de ser uma
       UF de verdade, senão "LOJ 108 - BR" entraria. */
    const siglas = Object.keys(UFS).map(function (k) { return UFS[k]; });
    const mun = bloco.map(function (t) {
      return t.match(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'´\s.]{2,34}?)\s*[-–\/]\s*([A-Z]{2})\b/);
    }).find(function (m) {
      return m && siglas.indexOf(m[2]) > -1 && !/^(CEP|FONE|TEL|LOJ|APT|SALA|N[ºO°])/i.test(m[1].trim());
    });
    if (mun) { out.municipio = mun[1].trim(); out.uf = mun[2]; }

    // telefone: os dígitos logo depois do rótulo, até 13 (alguns põem o 55)
    const fone = tudo.match(/(?:TEL|FONE)[.:\s]*\(?([\d)\s.\-]{8,18})/i);
    if (fone) out.fone = so(fone[1]).slice(0, 13);

    return out;
  }

  /* Informações complementares. É onde alguns emitentes escrevem os
     dados bancários — o único lugar da nota em que eles podem estar,
     já que o layout da NF-e não tem campo para conta de fornecedor.
     Ver sugestao.js. */
  function acharComplemento(linhas) {
    const i = linhas.findIndex(function (l) {
      return /INFORMA[ÇC][ÕO]ES\s+COMPLEMENTARES|DADOS\s+ADICIONAIS/i.test(l.txt);
    });
    if (i < 0) return '';
    const out = [];
    for (let k = i + 1; k < linhas.length && out.length < 12; k++) {
      const t = linhas[k].txt;
      if (/^RESERVADO\s+AO\s+FISCO|Software\s+Emissor/i.test(t)) break;
      if (/^INFORMA[ÇC][ÕO]ES\s+COMPLEMENTARES/i.test(t)) continue;
      out.push(t.replace(/\s{2,}RESERVADO AO FISCO.*$/i, '').trim());
    }
    return out.join(' ').replace(/\s+/g, ' ').trim();
  }

  /* ── quadro de produtos do DANFE ────────────────────────
     O desenho do quadro varia de emissor para emissor, mas a LINHA do
     item tem uma assinatura estável: código, NCM de 8 dígitos, CST de
     3, CFOP de 4, unidade e então os números. É nisso que a busca se
     ancora — não em posição na página.

     A descrição costuma vir nas linhas ANTERIORES à linha numérica
     (alguns emissores quebram em duas), então são recolhidas para
     trás, parando no rótulo do quadro ou na linha do item anterior.

     Heurística mesmo: devolve o que achou para conferência humana. O
     XML é sempre melhor quando existe. */
  const RUIDO_DESC = /^(DADOS DO PRODUTO|DADOS DOS PRODUTOS|ITENS DA NOTA|C[ÓO]D\.?\b|C[ÓO]DIGO|DESCRI[ÇC][ÃA]O|NCM|VALOR|BASE|AL[ÍI]QUOTAS|QUANT|UNID|CST|CFOP|I\.?C\.?M\.?S|I\.?P\.?I|DESCONTO|TOTAL|UNIT|SERV\.?|RESERVADO|PRE[ÇC]O)/i;

  /* Cabeçalho do quadro se reconhece pela densidade de rótulos, não
     pelo primeiro deles: cada emissor quebra a faixa de títulos num
     lugar diferente, e sobram linhas como "PRODUTO UNIT TOTAL DESC
     ICMS ICMS IPI" ou "COD. PROD DESCRIÇÃO DO PROD./SER. NCM/SH CST".
     Sem isso, essas linhas entram como descrição do material. */
  const VOCAB_CAB = ('COD COD. CODIGO CÓDIGO PROD PRODUTO PRODUTOS DESCRICAO DESCRIÇÃO ' +
    'NCM SH NCM/SH CST CSOSN O/CSOSN CFOP UN UNID UNID. QUANT QUANT. QTDE QTD ' +
    'VALOR VLR VLR. V.UNITARIO V.TOTAL UNIT UNITARIO UNITÁRIO TOTAL DESC DESCONTO ' +
    'BASE B.CALC B.CÁLC BC.ICMS CALC. CÁLC. ICMS IPI ALIQ ALIQ. ALÍQ ALÍQ. ALIQUOTAS ' +
    'ALÍQUOTAS A.ICMS A.IPI VLR.ICMS VLR.IPI %ICMS %IPI PRECO PREÇO SERV SERV. ' +
    'SERVICO SERVIÇO PROD./SER. RESERVADO FISCO').split(' ');

  function ehCabecalho(t) {
    const toks = String(t || '').toUpperCase().split(/[\s|]+/).filter(Boolean);
    if (toks.length < 3) return false;
    let n = 0;
    toks.forEach(function (k) { if (VOCAB_CAB.indexOf(k) > -1) n++; });
    return n >= 3 && n / toks.length >= 0.5;
  }

  function acharItens(texto, linhasGeo) {
    /* Com geometria, a descrição pode estar ACIMA e ABAIXO da linha
       numérica — o emissor da nota de teste imprime "CORDÃO PARALELO
       NEWPRIME" em cima e "300/300V 2 X 1,00 MM² - BR 100 MTS"
       embaixo, e é embaixo que está a medida, justamente o que
       distingue o material do vizinho. Então a coleta vai para os dois
       lados, limitada pela distância vertical. */
    const geo = (linhasGeo && linhasGeo.length)
      ? linhasGeo.map(function (l) { return { txt: l.txt.trim(), y: l.y, pg: l.pagina }; })
      : String(texto || '').split('\n').map(function (l, ix) {
          return { txt: l.trim(), y: -ix * 10, pg: 1 }; });
    const linhas = geo.map(function (l) { return l.txt; });
    /* Assinatura da linha do item, conferida contra quatro emissores
       diferentes. O que varia e teve de ser absorvido:
         · CST/CSOSN some, vem "000", "200", "010" ou "0/102";
         · CFOP às vezes sai pontuado — "6.102" em vez de 6102;
         · a unidade pode vir colada na quantidade — "UN160,00". */
    const CST = '(?:[0-9]{1,3}(?:\\/[0-9]{1,3})?\\s+)?';
    const CFOP = '(\\d\\.?\\d{3})\\s+';
    const UNID = '([A-Za-z]{1,6})\\s*';
    const NUM = '([\\d.,]+)';
    const LINHA = new RegExp(
      '^(\\S{1,24})\\s+' +          // código do produto
      '(\\d{8})\\s+' +              // NCM
      CST + CFOP + UNID +
      NUM + '\\s+' + NUM + '\\s+' + NUM);
    /* Variante comum: emissor que imprime código e descrição na mesma
       linha do item, antes do NCM. */
    const LINHA_JUNTA = new RegExp(
      '^(\\S{1,24})\\s+(.{3,120}?)\\s+(\\d{8})\\s+' +
      CST + CFOP + UNID + NUM + '\\s+' + NUM + '\\s+' + NUM);
    /* Linhas de descrição em volta da linha do item. Vale para as DUAS
       variantes: quando o fragmento da descrição cai no mesmo y do
       código (variante "junta"), a continuação ainda está na linha
       debaixo, e é lá que costuma estar a medida do material. */
    function vizinhas(ix) {
      const aqui = geo[ix];
      const serve = k => {
        const g = geo[k];
        if (!g || g.pg !== aqui.pg) return false;
        if (Math.abs(g.y - aqui.y) > 24) return false;      // outro quadro
        const t = g.txt;
        if (!t || RUIDO_DESC.test(t) || ehCabecalho(t)) return false;
        if (LINHA.test(t) || LINHA_JUNTA.test(t)) return false;
        if (/^[\d.,\s|-]+$/.test(t)) return false;           // linha só de números
        return /[A-Za-zÀ-ÿ]{2}/.test(t) || /\d+[.,]\d+\s*(MM|MM²|ML|MG|MTS|M|V|G|KG|L)\b/i.test(t);
      };
      const acima = [];
      for (let k = ix - 1; k >= 0 && acima.length < 2 && serve(k); k--) acima.unshift(geo[k].txt);
      const abaixo = [];
      for (let k = ix + 1; k < geo.length && abaixo.length < 2 && serve(k); k++) abaixo.push(geo[k].txt);
      return { acima: acima, abaixo: abaixo };
    }
    /* Coluna estreita quebra a descrição NO MEIO DA PALAVRA, sem
       hífen: a STALO imprime "QUADRO BRANCO FORMICA L" / "ISA ALUMINIO
       A 300 X 12" / "0 CM MDF 9". Juntar com espaço estraga o texto
       ("FORMICA L ISA"); juntar sem espaço estragaria os emissores que
       quebram entre palavras ("NEWPRIME300/300V").

       O sinal é o pedaço na emenda: uma letra ou dígito sozinho só
       aparece porque a palavra foi cortada ali. Pontuação solta não
       conta — "LEDS -" seguido de "COM ESTROBO" é quebra legítima. */
    const soUm = /^[A-Za-zÀ-ÿ0-9]$/;
    function junta(arr) {
      const ps = arr.filter(Boolean).map(function (t) {
        return String(t).replace(/\s{2,}/g, ' ').trim(); }).filter(Boolean);
      let out = '';
      ps.forEach(function (t) {
        if (!out) { out = t; return; }
        const fim = out.split(/\s+/).pop();
        const ini = t.split(/\s+/)[0];
        out += (soUm.test(fim) || soUm.test(ini)) ? t : ' ' + t;
      });
      return out.replace(/\s+/g, ' ').trim();
    }

    const out = [];
    linhas.forEach(function (l, ix) {
      const v = vizinhas(ix);
      const j = l.match(LINHA_JUNTA);
      if (j && !/^\d{8}$/.test(j[2].trim())) {
        out.push({
          codigo: j[1], descricao: junta(v.acima.concat([j[2]], v.abaixo)),
          ncm: j[3], cfop: so(j[4]), unidade: j[5].toUpperCase(), ean: '', cest: '',
          qtd: valorBR(j[6]), valorUnit: valorBR(j[7]), valor: valorBR(j[8]),
          confianca: 'lido do PDF'
        });
        return;
      }
      const m = l.match(LINHA);
      if (!m) return;
      out.push({
        codigo: m[1], descricao: junta(v.acima.concat(v.abaixo)),
        ncm: m[2], cfop: so(m[3]), unidade: m[4].toUpperCase(),
        ean: '', cest: '',
        qtd: valorBR(m[5]), valorUnit: valorBR(m[6]), valor: valorBR(m[7]),
        confianca: 'lido do PDF'
      });
    });
    return out;
  }

  /* `textoDoPDF` sai para fora porque a Habilitação precisa da MESMA
     extração para ler certidão. Duplicar daria duas versões da
     dança do worker, e a de lá envelheceria calada. */
  return { ler: ler, lerChave: lerChave, acharItens: acharItens, textoDoPDF: textoDoPDF };
})();
