/* ERP · sugestao.js — casar o que vem na nota com o que já existe no
   cadastro, e propor o cadastro quando não existe.

   A nota traz o nome do FORNECEDOR, não o seu. "CORDAO PARALELO
   NEWPRIME 300/300V 2 X 1,00 MM - BR 100 MTS" nunca vai ser igual ao
   "Cabo paralelo 2x1,00mm" do seu cadastro. Então o módulo pontua a
   semelhança e devolve candidatos ORDENADOS com o motivo de cada um —
   nunca decide sozinho. Quem aceita é a tela.

   Três regras que valem para tudo aqui:
     · identificador exato (EAN, CNPJ, código) vale mais que qualquer
       semelhança de texto e entra como certeza, não como palpite;
     · palavra genérica não pontua. "CABO", "CAIXA", "LTDA", "COMERCIO"
       aparecem em metade do cadastro e casariam qualquer coisa com
       qualquer coisa;
     · número com unidade é o que separa um material do vizinho —
       1,00 mm² e 2,50 mm² são o mesmo texto e produtos diferentes.

   Módulo puro: não conhece a tela nem o banco. */
window.ERP = window.ERP || {};

ERP.sugestao = (function () {

  const so = s => String(s == null ? '' : s).replace(/\D/g, '');
  const limpo = s => String(s == null ? '' : s).toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  /* Palavra que não distingue nada. Nas descrições de material e nas
     razões sociais é o mesmo problema. */
  const GENERICAS = ('DE DA DO DAS DOS E COM SEM PARA POR EM NA NO AO UM UMA ' +
    'LTDA MEI EIRELI SA S/A ME EPP CIA COMERCIO COMERCIAL INDUSTRIA INDUSTRIAL ' +
    'DISTRIBUIDORA DISTRIBUICAO ATACADO ATACADISTA VAREJO SERVICOS SERVICO ' +
    'PRODUTOS PRODUTO MATERIAL MATERIAIS SUPRIMENTOS EQUIPAMENTOS ' +
    'CAIXA CX UN UNIDADE PCT PACOTE FARDO ROLO PC PCS KIT ' +
    'HOSPITALAR HOSPITALARES MEDICO MEDICA MEDICOS BR TIPO MOD MODELO REF').split(' ');

  const tokens = s => limpo(s).split(/[^A-Z0-9,.]+/)
    .map(function (t) { return t.replace(/^[,.]+|[,.]+$/g, ''); })
    .filter(function (t) { return t.length > 1; });

  const distintivas = s => tokens(s).filter(function (t) {
    return t.length > 2 && GENERICAS.indexOf(t) < 0 && !/^\d+$/.test(t);
  });

  /* Medidas: "2 X 1,00 MM", "300/300V", "7,5", "20G", "100 MTS".
     Normaliza vírgula/ponto para comparar 1,00 com 1.0 e com 1. */
  const numero = t => {
    const n = parseFloat(t.replace(/\./g, '').replace(',', '.'));
    return isFinite(n) ? n : null;
  };
  function medidas(s) {
    const out = [];
    limpo(s).replace(/(\d+(?:[.,]\d+)?)\s*(MM2|MM²|MM|CM|ML|MG|MTS|MT|M|G|KG|L|V|UI|GA?|FR)?/g,
      function (_, num, un) {
        const n = numero(num);
        if (n !== null) out.push(n + (un ? '|' + un.replace('²', '2') : ''));
        return _;
      });
    return out;
  }

  /* 0 a 1. Base é a fração de palavras distintivas em comum (pelo lado
     menor, porque descrição de nota é mais comprida que a do cadastro),
     com bônus para medidas iguais e desconto para medidas que
     conflitam. */
  function similaridade(a, b) {
    const ta = distintivas(a), tb = distintivas(b);
    if (!ta.length || !tb.length) return 0;
    let comuns = 0;
    ta.forEach(function (t) {
      if (tb.some(function (u) {
        return u === t ||
          (t.length >= 5 && u.indexOf(t) === 0) ||
          (u.length >= 5 && t.indexOf(u) === 0);
      })) comuns++;
    });
    let s = comuns / Math.min(ta.length, tb.length);

    /* Medidas não são só bônus: o que FALTA no candidato também pesa.
       "Quadro 300x120" e "Quadro 200x120" têm o mesmo texto e uma
       medida em comum — sem descontar a medida ausente, os dois
       empatavam em 100% e a escolha entre eles voltava a ser sorte. */
    const ma = medidas(a), mb = medidas(b);
    if (ma.length && mb.length) {
      const iguais = ma.filter(function (m) { return mb.indexOf(m) > -1; }).length;
      const faltando = ma.filter(function (m) { return mb.indexOf(m) < 0; }).length;
      if (iguais) s = Math.min(1, s + 0.12 * Math.min(2, iguais));
      if (faltando) s = s * (1 - 0.18 * Math.min(2, faltando));
      if (!iguais && s > 0) s = s * 0.7;      // texto parecido e nenhuma medida bate
    }
    return Math.round(s * 100) / 100;
  }

  /* ── produto ────────────────────────────────────────────
     item = { codigo, descricao, ean, ncm, unidade, ... } da nota.
     Devolve { certeza, candidatos:[{produto, score, motivo}] }. */
  function sugerirProduto(item, produtos) {
    const ativos = (produtos || []).filter(function (p) { return p.ativo; });
    const ean = so(item.ean);
    const cod = limpo(item.codigo);

    const exato = ativos.find(function (p) {
      return ean && so(p.ean) && so(p.ean) === ean; }) ||
      ativos.find(function (p) { return cod && limpo(p.codigo_fornecedor) === cod; }) ||
      ativos.find(function (p) { return cod && limpo(p.codigo) === cod; });
    if (exato) {
      const motivo = ean && so(exato.ean) === ean ? 'código de barras igual'
        : limpo(exato.codigo_fornecedor) === cod ? 'código do fornecedor já vinculado'
        : 'código do material igual';
      return { certeza: true, candidatos: [{ produto: exato, score: 1, motivo: motivo }] };
    }

    const cands = ativos.map(function (p) {
      let score = similaridade(item.descricao, p.descricao);
      const motivos = [];
      if (score > 0) motivos.push('descrição parecida');
      if (so(item.ncm) && so(p.ncm) && so(item.ncm) === so(p.ncm)) {
        score = Math.min(1, score + 0.2);
        motivos.push('mesmo NCM');
      }
      if (limpo(item.unidade) && limpo(p.unidade) && limpo(item.unidade) !== limpo(p.unidade)) {
        score = score * 0.85;
        motivos.push('unidade diferente (' + p.unidade + ')');
      }
      return { produto: p, score: Math.round(score * 100) / 100, motivo: motivos.join(', ') };
    }).filter(function (c) { return c.score >= 0.34; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 5);

    return { certeza: false, candidatos: cands };
  }

  /* Esboço de cadastro de produto a partir da linha da nota. O código
     interno fica em branco de propósito: quem cadastra decide a
     numeração da casa. O código do fornecedor é guardado, e é ele que
     faz a próxima nota casar na hora. */
  function produtoDaNota(item) {
    return {
      descricao: String(item.descricao || '').trim(),
      unidade: String(item.unidade || 'UN').toUpperCase().slice(0, 6),
      ncm: so(item.ncm), cest: so(item.cest), ean: so(item.ean),
      codigo_fornecedor: String(item.codigo || '').trim(),
      custo: item.valorUnit || (item.qtd ? Math.round(item.valor / item.qtd * 10000) / 10000 : 0)
    };
  }

  /* ── fornecedor ─────────────────────────────────────────*/
  function sugerirCredor(emit, credores) {
    const doc = so(emit && emit.documento);
    const lista = (credores || []).filter(function (c) { return c.ativo !== false; });
    const exato = doc && lista.find(function (c) { return so(c.documento) === doc; });
    if (exato) return { certeza: true, candidatos: [{ credor: exato, score: 1, motivo: 'CNPJ igual' }] };

    const nome = (emit && emit.nome) || '';
    const fant = (emit && emit.fantasia) || '';
    const cands = lista.map(function (c) {
      const score = Math.max(similaridade(nome, c.nome), similaridade(fant, c.nome));
      return { credor: c, score: score, motivo: 'nome parecido' };
    }).filter(function (c) { return c.score >= 0.4; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 5);
    return { certeza: false, candidatos: cands };
  }

  /* tPag da nota → forma de pagamento do ERP. Só mapeia o que o
     sistema sabe pagar; cheque e cartão não têm remessa aqui e ficam
     sem forma, para quem cadastra escolher. */
  const FORMA_TPAG = {
    '01': 'dinheiro', '14': 'boleto', '15': 'boleto',
    '16': 'ted', '17': 'pix', '18': 'ted', '20': 'pix'
  };
  const NOME_TPAG = {
    '01': 'dinheiro', '02': 'cheque', '03': 'cartão de crédito', '04': 'cartão de débito',
    '14': 'duplicata mercantil', '15': 'boleto bancário', '16': 'depósito bancário',
    '17': 'PIX dinâmico', '18': 'transferência bancária', '20': 'PIX estático',
    '90': 'sem pagamento', '99': 'outros'
  };

  /* ── dados bancários ───────────────────────────────────
     O layout da NF-e NÃO tem campo para a conta do fornecedor. O que
     existe é a forma de pagamento (tPag) e, quando o emitente resolve
     escrever, o texto livre das informações complementares. Então aqui
     é tudo heurística sobre texto solto, e o resultado vai para
     conferência — nunca gravado direto. */
  function dadosBancarios(nf) {
    const txt = limpo((nf && nf.complemento) || '');
    const achado = { forma: null, forma_nome: null, banco: null, agencia: null,
                     conta: null, pix: null, avisos: [] };

    const tPag = nf && nf.pagamento && nf.pagamento.tPag;
    if (tPag) {
      achado.forma = FORMA_TPAG[tPag] || null;
      achado.forma_nome = NOME_TPAG[tPag] || ('código ' + tPag);
    }

    const mBanco = txt.match(/BANCO[:\s]+([A-Z0-9 ]{3,28})/);
    if (mBanco) achado.banco = mBanco[1].trim().replace(/\s+(AG|AGENCIA|C\/C|CC|CONTA).*$/, '');
    const mAg = txt.match(/AG(?:ENCIA)?\.?[:\s]*(\d{3,5}(?:-?\d)?)/);
    if (mAg) achado.agencia = mAg[1];
    const mCc = txt.match(/(?:C\/C|CONTA(?:\s+CORRENTE)?|CC)\.?[:\s]*(\d{4,14}(?:-?[\dX])?)/);
    if (mCc) achado.conta = mCc[1];
    const mPix = txt.match(/(?:PIX|CHAVE\s+PIX)[:\s]*([A-Z0-9@._+-]{8,80})/);
    if (mPix) achado.pix = mPix[1].replace(/[.,;]$/, '');

    const temAlgo = achado.banco || achado.agencia || achado.conta || achado.pix;
    if (!temAlgo) {
      achado.avisos.push('A nota não traz dados bancários. O layout da NF-e não tem campo ' +
        'para a conta do fornecedor — só aparece quando o emitente escreve nas informações ' +
        'complementares, e esta não escreveu.' +
        (achado.forma_nome ? ' A forma de pagamento informada é ' + achado.forma_nome + '.' : ''));
    } else {
      achado.avisos.push('Dados bancários lidos do texto livre da nota, não de campo próprio. ' +
        'Confira antes de salvar.');
    }
    return achado;
  }

  function credorDaNota(nf) {
    const e = (nf && nf.emitente) || {};
    const b = dadosBancarios(nf);
    return {
      nome: e.nome || '', fantasia: e.fantasia || '', documento: so(e.documento),
      ie: e.ie || '',
      endereco: [e.logradouro, e.numero_end, e.bairro].filter(Boolean).join(', '),
      municipio: e.municipio || '', uf: e.uf || '', cep: so(e.cep),
      fone: so(e.fone), email: e.email || '',
      forma_pagamento: b.forma, banco: b.banco, agencia: b.agencia, conta: b.conta,
      pix: b.pix, tipo_chave: b.pix ? (/@/.test(b.pix) ? 'email' : 'CNPJ') : null,
      bancarios: b
    };
  }

  return {
    similaridade: similaridade, sugerirProduto: sugerirProduto, produtoDaNota: produtoDaNota,
    sugerirCredor: sugerirCredor, credorDaNota: credorDaNota, dadosBancarios: dadosBancarios,
    NOME_TPAG: NOME_TPAG
  };
})();
