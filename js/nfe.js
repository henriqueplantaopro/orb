/* ERP · nfe.js — leitura do XML da nota fiscal de entrada.

   Cobre três formatos, porque nota de compra chega nos três:
     · NF-e modelo 55 (produto) — padrão nacional, layout 4.00
     · NFS-e padrão nacional (ADN / infNFSe) — serviço, desde 2023
     · NFS-e ABRASF (CompNfse) — o layout municipal mais difundido

   NFS-e municipal fora do ABRASF varia de prefeitura para prefeitura;
   quando não reconhece, devolve erro dizendo isso em vez de inventar.

   O que interessa para o contas a pagar: emitente (que vira credor),
   número e série, chave, emissão, valor, DUPLICATAS (que já são o
   parcelamento) e RETENÇÕES (que mudam quanto sai do caixa).

   Módulo puro: não conhece a tela nem o banco de dados. */
window.ERP = window.ERP || {};

ERP.nfe = (function () {

  const so = s => String(s == null ? '' : s).replace(/\D/g, '');
  const n2 = v => Math.round((parseFloat(String(v || '0').replace(',', '.')) || 0) * 100) / 100;

  function texto(ctx, tag) {
    if (!ctx) return '';
    const e = ctx.getElementsByTagName(tag)[0];
    return e ? String(e.textContent || '').trim() : '';
  }
  const el = (ctx, tag) => (ctx ? ctx.getElementsByTagName(tag)[0] : null);
  const dataISO = s => String(s || '').slice(0, 10);

  /* Nomes de campo variam entre o padrão nacional "canônico" e o que
     mais aparece na prática — inclui os dois lados quando há dúvida
     (nunca custa procurar uma tag a mais que não existe; custa muito
     não achar uma que existe). vRetCofins/vRetCOFINS é o caso mais
     claro: PIS e CSLL já vinham certos com a sigla toda em maiúscula
     (vRetPIS, vRetCSLL) — só COFINS estava com "ofins" minúsculo,
     inconsistente com o padrão do próprio arquivo, e XML diferencia
     maiúscula de minúscula. Ainda assim, vale testar com XMLs reais
     de fornecedores antes de confiar 100% na leitura automática —
     a NFS-e nacional é obrigatória desde 2026 e o layout può variar
     por versão. */
  const ROT_RET = {
    vRetPIS: 'PIS', vRetCofins: 'COFINS', vRetCOFINS: 'COFINS', vRetCSLL: 'CSLL',
    vIRRF: 'IRRF', vRetIRRF: 'IRRF',
    vRetPrev: 'INSS', vRetCP: 'INSS',
    vISSRet: 'ISS', vRetIss: 'ISS', vRetISSQN: 'ISS', vISSQN: 'ISS', vValorIss: 'ISS',
    ValorPis: 'PIS', ValorCofins: 'COFINS', ValorCsll: 'CSLL', ValorIr: 'IRRF',
    ValorInss: 'INSS', ValorIssRetido: 'ISS'
  };

  /* Só entra no total se a nota realmente marcar RETENÇÃO desse
     tributo — em vários leiautes, vISSQN (ou vPis/vCofins) existem
     SEMPRE, com ou sem retenção; um indicador à parte é que diz se
     aquele valor foi retido. Não temos XML real o bastante pra saber
     qual indicador cada leiaute usa, então por ora só evita CONTAR O
     MESMO TRIBUTO DUAS VEZES quando duas tags concorrentes (uma do
     padrão "novo", outra do "antigo") aparecem na mesma nota. */
  function retencoesDe(ctx, tags) {
    const lista = [];
    const vistos = {};
    tags.forEach(function (t) {
      const tributo = ROT_RET[t] || t;
      if (vistos[tributo]) return;   // já achou este tributo por outro nome de campo — não soma duas vezes
      const v = n2(texto(ctx, t));
      if (v > 0) { lista.push({ tributo: tributo, valor: v, campo: t }); vistos[tributo] = true; }
    });
    return lista;
  }

  /* ── NF-e modelo 55 ─────────────────────────────────────*/
  function lerNFe(doc) {
    const inf = el(doc, 'infNFe');
    const ide = el(doc, 'ide');
    const emit = el(doc, 'emit');
    const dest = el(doc, 'dest');
    const tot = el(doc, 'ICMSTot');
    const ender = el(emit, 'enderEmit');

    const itens = Array.prototype.slice.call(doc.getElementsByTagName('det')).map(function (d) {
      const p = el(d, 'prod');
      return {
        codigo: texto(p, 'cProd'), descricao: texto(p, 'xProd'),
        ncm: texto(p, 'NCM'), cfop: texto(p, 'CFOP'),
        /* EAN e CEST vêm para o cadastro: o EAN é o que faz a próxima
           nota do mesmo material casar sem palpite nenhum. */
        ean: so(texto(p, 'cEAN') || texto(p, 'cEANTrib')),
        cest: so(texto(p, 'CEST')),
        unidade: texto(p, 'uCom'),
        qtd: parseFloat(texto(p, 'qCom') || '0') || 0,
        valorUnit: n2(texto(p, 'vUnCom')), valor: n2(texto(p, 'vProd'))
      };
    });

    const dups = Array.prototype.slice.call(doc.getElementsByTagName('dup')).map(function (d) {
      return { numero: texto(d, 'nDup'), venc: dataISO(texto(d, 'dVenc')), valor: n2(texto(d, 'vDup')) };
    }).filter(function (d) { return d.venc && d.valor > 0; });

    const ret = retencoesDe(el(doc, 'retTrib') || doc,
      ['vRetPIS', 'vRetCofins', 'vRetCOFINS', 'vRetCSLL', 'vIRRF', 'vRetIRRF', 'vRetPrev', 'vRetCP']);
    const issRet = n2(texto(el(doc, 'ISSQNtot') || doc, 'vISSRet'));
    if (issRet > 0) ret.push({ tributo: 'ISS', valor: issRet, campo: 'vISSRet' });

    return {
      tipo: 'nfe', rotulo: 'NF-e de produto (modelo 55)',
      numero: texto(ide, 'nNF'), serie: texto(ide, 'serie'),
      chave: (inf && inf.getAttribute('Id') ? inf.getAttribute('Id') : texto(doc, 'chNFe')).replace(/\D/g, ''),
      emissao: dataISO(texto(ide, 'dhEmi') || texto(ide, 'dEmi')),
      natureza: texto(ide, 'natOp'),
      entradaSaida: texto(ide, 'tpNF'),   // 0 = entrada, 1 = saída (do emitente)
      emitente: {
        nome: texto(emit, 'xNome'), fantasia: texto(emit, 'xFant'),
        documento: so(texto(emit, 'CNPJ') || texto(emit, 'CPF')),
        ie: texto(emit, 'IE'),
        municipio: texto(ender, 'xMun'), uf: texto(ender, 'UF'),
        cep: so(texto(ender, 'CEP')),
        logradouro: texto(ender, 'xLgr'), numero_end: texto(ender, 'nro'),
        bairro: texto(ender, 'xBairro'),
        fone: so(texto(ender, 'fone')), email: texto(emit, 'email')
      },
      destinatario: { nome: texto(dest, 'xNome'), documento: so(texto(dest, 'CNPJ') || texto(dest, 'CPF')) },
      valor: n2(texto(tot, 'vNF')),
      frete: n2(texto(tot, 'vFrete')),
      itens: itens, duplicatas: dups, retencoes: ret,
      /* forma de pagamento declarada: é o único indício de como o
         fornecedor quer receber que a NF-e tem em campo próprio. */
      pagamento: (function () {
        const dp = el(doc, 'detPag');
        return dp ? { tPag: texto(dp, 'tPag'), valor: n2(texto(dp, 'vPag')) } : null;
      })(),
      complemento: texto(el(doc, 'infAdic') || doc, 'infCpl') ||
        texto(el(doc, 'infAdic') || doc, 'infAdFisco')
    };
  }

  /* ── NFS-e padrão nacional ──────────────────────────────*/
  function lerNFSeNacional(doc) {
    const inf = el(doc, 'infNFSe');
    const emit = el(doc, 'emit') || el(doc, 'prest');
    const decl = el(doc, 'DPS') || el(doc, 'infDPS') || doc;
    /* O layout nacional tem DOIS blocos <valores>: o de infNFSe
       (vBC, vISSQN, vTotalRet, vLiq — calculados pelo emissor) e o do
       DPS (vServPrest/vServ e trib). Antes o código pegava só o
       primeiro e nunca achava vServ nem o ISS retido. */
    const valNFSe = (inf && el(inf, 'valores')) || doc;
    const tribMun = el(doc, 'tribMun') || doc;
    const tribFed = el(doc, 'tribFed') || doc;
    const pisCofins = el(doc, 'piscofins') || tribFed;
    const alertasRet = [];

    // federais explícitos: sempre são retenção quando vêm preenchidos
    const ret = retencoesDe(tribFed, ['vRetIRRF', 'vIRRF', 'vRetCSLL', 'vRetCP', 'vRetPrev']);

    /* ISS: retido quando tpRetISSQN = 2 (pelo tomador) ou 3 (pelo
       intermediário); o valor é o vISSQN da nota. tpRetISSQN = 1 é
       "não retido" — o ISS é do prestador e não vai pra nossa guia. */
    const tpRetISS = texto(tribMun, 'tpRetISSQN');
    const vISSQN = n2(texto(valNFSe, 'vISSQN') || texto(tribMun, 'vISSQN'));
    if ((tpRetISS === '2' || tpRetISS === '3') && vISSQN > 0) {
      ret.push({ tributo: 'ISS', valor: vISSQN, campo: 'vISSQN (tpRetISSQN=' + tpRetISS + ')' });
    }

    /* PIS/COFINS: o valor vem em vPis/vCofins e quem diz se foi retido
       é tpRetPisCofins (1 = retido no layout 1.00). Outros códigos de
       versões mais novas do layout são conferidos contra vTotalRet
       logo abaixo em vez de adivinhados. */
    const tpRetPC = texto(pisCofins, 'tpRetPisCofins');
    const vPis = n2(texto(pisCofins, 'vPis')), vCofins = n2(texto(pisCofins, 'vCofins'));
    const candidatosPC = [];
    if (vPis > 0) candidatosPC.push({ tributo: 'PIS', valor: vPis, campo: 'vPis (tpRetPisCofins=' + tpRetPC + ')' });
    if (vCofins > 0) candidatosPC.push({ tributo: 'COFINS', valor: vCofins, campo: 'vCofins (tpRetPisCofins=' + tpRetPC + ')' });
    const somar = l => Math.round(l.reduce(function (a, r) { return a + r.valor; }, 0) * 100) / 100;
    const vTotalRet = n2(texto(valNFSe, 'vTotalRet'));
    if (tpRetPC === '1') {
      candidatosPC.forEach(function (c) { ret.push(c); });
    } else if (tpRetPC && tpRetPC !== '2' && candidatosPC.length && vTotalRet > 0 &&
               Math.abs(somar(ret) + somar(candidatosPC) - vTotalRet) < 0.01) {
      // código de retenção de outra versão do layout: só aceita se fechar exatamente com o total da nota
      candidatosPC.forEach(function (c) { ret.push(c); });
    }
    if (vTotalRet > 0 && Math.abs(somar(ret) - vTotalRet) >= 0.01) {
      alertasRet.push('A nota declara ' +ERP.util.brl( vTotalRet) +
        ' de retenções no total (vTotalRet), mas só foi possível identificar ' +
ERP.util.brl(        somar(ret)) +
        ' por tributo — confira e ajuste os campos de retenção à mão antes de lançar.');
    }

    // bruto: vServ do DPS; na falta, reconstitui pelo líquido + retenções
    const vServ = n2(texto(doc, 'vServ'));
    const vLiq = n2(texto(valNFSe, 'vLiq'));
    const somaRet = somar(ret);
    const bruto = vServ > 0 ? vServ : (vLiq > 0 ? Math.round((vLiq + somaRet) * 100) / 100 : 0);
    if (vServ > 0 && vLiq > 0 && Math.abs(vServ - somaRet - vLiq) >= 0.01) {
      alertasRet.push('Bruto menos retenções identificadas dá ' +
ERP.util.brl(        (vServ - somaRet)) + ', mas o líquido da nota (vLiq) é ' +
ERP.util.brl(        vLiq) + ' — confira as retenções.');
    }
    return {
      tipo: 'nfse-nacional', rotulo: 'NFS-e padrão nacional',
      numero: texto(inf, 'nNFSe') || texto(decl, 'nDPS'),
      serie: texto(decl, 'serie'),
      chave: so(inf && inf.getAttribute('Id') ? inf.getAttribute('Id') : texto(doc, 'chNFSe')),
      emissao: dataISO(texto(inf, 'dhProc') || texto(decl, 'dhEmi') || texto(decl, 'dCompet')),
      natureza: texto(doc, 'xDescServ') || texto(doc, 'xTribNac'),
      emitente: {
        nome: texto(emit, 'xNome'), fantasia: texto(emit, 'xFant'),
        documento: so(texto(emit, 'CNPJ') || texto(emit, 'CPF')),
        im: texto(emit, 'IM'),
        municipio: texto(emit, 'xMun'), uf: texto(emit, 'UF')
      },
      destinatario: {
        nome: texto(el(doc, 'toma') || doc, 'xNome'),
        documento: so(texto(el(doc, 'toma') || doc, 'CNPJ') || texto(el(doc, 'toma') || doc, 'CPF'))
      },
      valor: bruto,
      itens: [], duplicatas: [], retencoes: ret, alertas_retencao: alertasRet,
      municipio_incidencia: texto(doc, 'xLocIncid') || texto(emit, 'xMun'), cod_municipio_incidencia: texto(doc, 'cLocIncid'),
      complemento: texto(doc, 'xInfComp')
    };
  }

  /* ── NFS-e ABRASF ───────────────────────────────────────*/
  function lerNFSeAbrasf(doc) {
    const inf = el(doc, 'InfNfse') || el(doc, 'Nfse');
    const prest = el(doc, 'PrestadorServico') || el(doc, 'Prestador');
    const ident = el(prest, 'IdentificacaoPrestador') || prest;
    const tom = el(doc, 'TomadorServico') || el(doc, 'Tomador');
    const valores = el(doc, 'Valores') || doc;
    const ender = el(prest, 'Endereco');

    const ret = retencoesDe(valores, ['ValorPis', 'ValorCofins', 'ValorCsll', 'ValorIr', 'ValorInss']);
    /* ISS retido: ValorIssRetido quando existe; senão, IssRetido = 1
       (sim) com o valor em ValorIss. IssRetido fica em Valores (v1) ou
       em Servico (v2) — procura no documento todo. */
    const alertasRet = [];
    const issRetExplicito = n2(texto(doc, 'ValorIssRetido'));
    const flagIssRetido = texto(doc, 'IssRetido');
    const valorIss = n2(texto(doc, 'ValorIss'));
    if (issRetExplicito > 0) ret.push({ tributo: 'ISS', valor: issRetExplicito, campo: 'ValorIssRetido' });
    else if (flagIssRetido === '1' && valorIss > 0) ret.push({ tributo: 'ISS', valor: valorIss, campo: 'ValorIss (IssRetido=1)' });
    const vServA = n2(texto(valores, 'ValorServicos')), vLiqA = n2(texto(doc, 'ValorLiquidoNfse'));
    const somaRetA = Math.round(ret.reduce(function (a, r) { return a + r.valor; }, 0) * 100) / 100;
    if (vServA > 0 && vLiqA > 0 && Math.abs(vServA - somaRetA - vLiqA) >= 0.01) {
      alertasRet.push('Bruto menos retenções identificadas dá ' +
ERP.util.brl(        (vServA - somaRetA)) + ', mas o líquido da nota (ValorLiquidoNfse) é ' +
ERP.util.brl(        vLiqA) + ' — pode haver desconto condicionado/incondicionado ou retenção não identificada; confira.');
    }

    /* ValorServicos é o BRUTO; ValorLiquidoNfse já é líquido (o nome
       já entrega). `valor` tem que ser sempre o bruto — mesmo motivo
       da NFS-e nacional, ver o comentário lá em cima. */
    return {
      tipo: 'nfse-abrasf', rotulo: 'NFS-e municipal (padrão ABRASF)',
      numero: texto(inf, 'Numero'), serie: texto(inf, 'Serie'),
      chave: texto(inf, 'CodigoVerificacao'),
      emissao: dataISO(texto(inf, 'DataEmissao')),
      natureza: texto(doc, 'Discriminacao').slice(0, 120),
      emitente: {
        nome: texto(prest, 'RazaoSocial'), fantasia: texto(prest, 'NomeFantasia'),
        documento: so(texto(ident, 'Cnpj') || texto(ident, 'Cpf')),
        im: texto(ident, 'InscricaoMunicipal'),
        municipio: texto(ender, 'Uf') ? texto(ender, 'CodigoMunicipio') : '',
        uf: texto(ender, 'Uf')
      },
      destinatario: {
        nome: texto(tom, 'RazaoSocial'),
        documento: so(texto(el(tom, 'IdentificacaoTomador') || tom, 'Cnpj') ||
                      texto(el(tom, 'IdentificacaoTomador') || tom, 'Cpf'))
      },
      valor: n2(texto(valores, 'ValorServicos')) ||
        Math.round((n2(texto(valores, 'ValorLiquidoNfse')) +
          ret.reduce(function (s, r) { return s + r.valor; }, 0)) * 100) / 100,
      itens: [], duplicatas: [], retencoes: ret, alertas_retencao: alertasRet,
      municipio_incidencia: texto(doc, 'MunicipioIncidencia') || '',
      complemento: texto(doc, 'OutrasInformacoes')
    };
  }

  /* ── entrada ────────────────────────────────────────────*/
  function ler(xml, opcoes) {
    opcoes = opcoes || {};
    let doc;
    try {
      doc = new DOMParser().parseFromString(String(xml), 'text/xml');
    } catch (e) {
      return { erro: 'Não consegui interpretar o arquivo como XML.' };
    }
    if (!doc || doc.getElementsByTagName('parsererror').length) {
      return { erro: 'XML mal formado.' };
    }

    let nf;
    if (el(doc, 'infNFe')) nf = lerNFe(doc);
    else if (el(doc, 'infNFSe') || el(doc, 'NFSe')) nf = lerNFSeNacional(doc);
    else if (el(doc, 'InfNfse') || el(doc, 'CompNfse') || el(doc, 'Nfse')) nf = lerNFSeAbrasf(doc);
    else return {
      erro: 'Este XML não é NF-e nem NFS-e nos padrões que eu leio (NF-e 55, ' +
            'NFS-e nacional ou ABRASF). Se for de prefeitura com layout próprio, me mande o arquivo.'
    };

    if (!nf.numero && !nf.chave) return { erro: 'O XML não traz número nem chave da nota.' };

    // totais de retenção e o que sobra para pagar
    nf.valorRetido = Math.round(nf.retencoes.reduce(function (s, r) { return s + r.valor; }, 0) * 100) / 100;
    nf.valorLiquido = Math.round((nf.valor - nf.valorRetido) * 100) / 100;

    // conferências que evitam lançar nota errada
    nf.avisos = [];
    const meu = so(opcoes.cnpjEmpresa);
    if (meu && nf.destinatario && nf.destinatario.documento && nf.destinatario.documento !== meu) {
      nf.avisos.push('O destinatário da nota (' + (nf.destinatario.nome || nf.destinatario.documento) +
        ') não é o CNPJ da empresa — confira se a nota é de vocês.');
    }
    if (nf.tipo === 'nfe' && nf.entradaSaida === '0') {
      nf.avisos.push('Esta NF-e está marcada como entrada na visão de quem emitiu — pode ser devolução.');
    }
    (nf.alertas_retencao || []).forEach(function (a) { nf.avisos.push(a); });
    if (nf.valorRetido > 0) {
      const somaDup = Math.round(nf.duplicatas.reduce(function (s, d) { return s + d.valor; }, 0) * 100) / 100;
      nf.avisos.push('A nota tem ' +ERP.util.brl( nf.valorRetido) +
        ' de retenções (' + nf.retencoes.map(function (r) { return r.tributo; }).join(', ') + '). ' +
        (somaDup && Math.abs(somaDup - nf.valor) < 0.01
          ? 'As duplicatas vêm pelo valor bruto: confira com a contabilidade se o pagamento é bruto ou líquido.'
          : 'Confira se as duplicatas já estão líquidas.'));
    }
    if (nf.duplicatas.length) {
      const soma = Math.round(nf.duplicatas.reduce(function (s, d) { return s + d.valor; }, 0) * 100) / 100;
      if (Math.abs(soma - nf.valor) > 0.01 && Math.abs(soma - nf.valorLiquido) > 0.01) {
        nf.avisos.push('A soma das duplicatas (' + ERP.util.brl(soma) + ') não fecha com o valor da nota.');
      }
    }
    return nf;
  }

  return { ler: ler };
})();
