/* Leitura do XML de NFS-e (nota de SERVIÇO emitida por nós).

   Não confundir com `nfe.js`, que lê a NF-e de MERCADORIA que chega do
   fornecedor e vira entrada de estoque. Aqui é o contrário: é a nossa
   nota de saída, que vira título no contas a receber.

   O padrão é o ABRASF, que a maior parte das prefeituras usa com
   pequenas variações de namespace — o arquivo de Fortaleza vem como
   GINFES tipos_v03. Para não depender do namespace certo, a leitura
   casa as tags pelo nome local, ignorando prefixo.

   Um arquivo costuma trazer VÁRIAS notas (o exemplo tem sete), então
   a função devolve sempre uma lista. */
window.ERP = window.ERP || {};
ERP.nfse = (function () {
  const U = () => ERP.util;

  /* O valor vem sem casas decimais em alguns emissores ("104700" para
     R$ 104.700,00) e com ponto em outros ("104700.00"). Quem tem
     separador manda; quem não tem é inteiro em reais — tratar tudo
     como centavos transformaria R$ 104.700 em R$ 1.047. */
  function valor(txt) {
    const t = String(txt == null ? '' : txt).trim();
    if (!t) return 0;
    const temPonto = t.indexOf('.') >= 0, temVirgula = t.indexOf(',') >= 0;
    let limpo = t;
    if (temPonto && temVirgula) {
      limpo = t.lastIndexOf(',') > t.lastIndexOf('.')
        ? t.replace(/\./g, '').replace(',', '.')
        : t.replace(/,/g, '');
    } else if (temVirgula) {
      limpo = t.replace(',', '.');
    }
    const v = parseFloat(limpo);
    return isFinite(v) ? Math.round(v * 100) / 100 : 0;
  }

  /* Busca pelo nome local da tag, em qualquer profundidade. */
  function pega(no, nome) {
    if (!no) return null;
    const achados = no.getElementsByTagName('*');
    for (let i = 0; i < achados.length; i++) {
      if (achados[i].localName === nome) return achados[i];
    }
    return null;
  }
  const texto = (no, nome) => {
    const el = pega(no, nome);
    return el && el.textContent ? el.textContent.trim() : '';
  };
  const filhoDireto = (no, nome) => {
    if (!no) return null;
    for (let i = 0; i < no.children.length; i++) {
      if (no.children[i].localName === nome) return no.children[i];
    }
    return null;
  };

  const soDigitos = s => String(s || '').replace(/\D/g, '');

  /* ── contribuições sociais somadas num campo só ──────────
     Função PURA, fora do `ler`, porque a leitura do XML precisa
     de DOMParser e só roda no navegador — e esta regra decide
     quanto de imposto de terceiro vai para cada guia. Regra que
     mexe em imposto tem de ser exercitável sem abrir navegador.

     A CSRF da Lei 10.833 é 4,65% do serviço: 0,65 de PIS, 3,00 de
     COFINS e 1,00 de CSLL. Muito emissor põe o total num campo
     só, com frequência no do CSLL por ser o último dos três.

     Devolve as três partes quando o total BATE com 4,65% do
     serviço, e null quando não bate — porque aí não é CSRF, é
     outra coisa, e separar seria inventar. Cada parte sai do
     serviço, como a lei define; a sobra de centavo fica na
     COFINS, que é a maior das três. */
  function separarCsrf(servicos, total) {
    if (!(total > 0) || !(servicos > 0)) return null;
    const esperado = Math.round(servicos * 0.0465 * 100) / 100;
    const folga = Math.max(0.05, servicos * 0.0002);
    if (Math.abs(total - esperado) > folga) return null;
    const pis = Math.round(servicos * 0.0065 * 100) / 100;
    const csll = Math.round(servicos * 0.01 * 100) / 100;
    const cofins = Math.round((total - pis - csll) * 100) / 100;
    return { PIS: pis, COFINS: cofins, CSLL: csll };
  }

  function ler(xmlTexto) {
    const doc = new DOMParser().parseFromString(xmlTexto, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      return { erro: 'Arquivo XML inválido ou corrompido.' };
    }
    /* Cada nota é um InfNfse. Em alguns arquivos a raiz é um lote de
       Nfse; em outros, uma nota só. */
    const blocos = [];
    const todos = doc.getElementsByTagName('*');
    for (let i = 0; i < todos.length; i++) {
      if (todos[i].localName === 'InfNfse') blocos.push(todos[i]);
    }
    if (!blocos.length) {
      return { erro: 'Nenhuma NFS-e encontrada no arquivo. Confira se é o XML da nota de ' +
        'serviço (e não o da NF-e de mercadoria).' };
    }

    const notas = blocos.map(function (inf) {
      /* Prestador e tomador têm a mesma estrutura por dentro
         (Cnpj, RazaoSocial), então a busca é feita a partir do bloco
         de cada um — não do documento inteiro. */
      const prest = pega(inf, 'PrestadorServico') || pega(inf, 'Prestador');
      const tom = pega(inf, 'TomadorServico') || pega(inf, 'Tomador');
      const valores = pega(inf, 'Valores');

      const servicos = valor(texto(valores, 'ValorServicos'));
      const deducoes = valor(texto(valores, 'ValorDeducoes'));
      const desconto = valor(texto(valores, 'DescontoIncondicionado')) +
        valor(texto(valores, 'DescontoCondicionado'));
      const liquido = valor(texto(valores, 'ValorLiquidoNfse')) || servicos;

      /* Retenções: o que o tomador segura e recolhe no lugar da
         empresa. ISS só conta quando marcado como retido (1 = sim). */
      const issRetidoFlag = texto(valores, 'IssRetido') === '1';
      const retencoes = [];
      const ret = (campo, nome) => {
        const v = valor(texto(valores, campo));
        if (v > 0) retencoes.push({ tributo: nome, valor: v });
        return v;
      };
      /* Parte dos emissores ABRASF marca IssRetido = 1 e deixa o
         valor em ValorIss, sem preencher ValorIssRetido: exigir o
         campo específico fazia o ISS retido sumir da conta. */
      const issRet = valor(texto(valores, 'ValorIssRetido')) ||
        (issRetidoFlag ? valor(texto(valores, 'ValorIss')) : 0);
      if (issRetidoFlag && issRet > 0) retencoes.push({ tributo: 'ISS', valor: issRet });
      ret('ValorIr', 'IRRF');
      const vPis = ret('ValorPis', 'PIS');
      const vCofins = ret('ValorCofins', 'COFINS');
      const vCsll = ret('ValorCsll', 'CSLL');
      ret('ValorInss', 'INSS');
      const outras = valor(texto(valores, 'OutrasRetencoes'));
      if (outras > 0) retencoes.push({ tributo: 'Outras', valor: outras });

      /* ── CONTRIBUIÇÕES SOCIAIS EM UM CAMPO SÓ ────────────────
         Boa parte das notas de serviço traz PIS, COFINS e CSLL
         somados num único campo — a CSRF da Lei 10.833, 4,65% do
         serviço (0,65 + 3,00 + 1,00). O emissor põe esse total
         onde der: às vezes num campo próprio, muitas vezes dentro
         do ValorCsll, porque é o último dos três.

         O sistema gravava tudo como CSLL. A consequência não é de
         tela: a guia de CSLL ficava inflada em quase cinco vezes e
         as de PIS e COFINS ficavam vazias, e é com esses números
         que se recolhe imposto de terceiro.

         Reconhecer o caso não é chute: a proporção é fixa em lei.
         Quando os três vêm somados num só e o total bate com
         4,65% do serviço, ele é separado nas três partes. Quando
         não bate, fica como veio — errar para menos aqui é
         deixar a pessoa conferir; errar para mais é recolher
         errado. */
      const somados = valor(texto(valores, 'ValorCsrf')) ||
                      valor(texto(valores, 'ContribuicoesSociais')) ||
                      valor(texto(valores, 'ValorPcc'));
      /* Os três separados já estão certos; mexer neles seria
         estragar o que o emissor acertou. Só entra aqui o campo
         próprio da CSRF, ou um CSLL sozinho com os outros dois
         zerados. */
      const soNoCsll = vCsll > 0 && vPis === 0 && vCofins === 0;
      const partes = separarCsrf(servicos, somados > 0 ? somados : (soNoCsll ? vCsll : 0));
      let csrfSeparada = false;
      if (partes) {
        for (let i = retencoes.length - 1; i >= 0; i--) {
          if (['PIS', 'COFINS', 'CSLL'].indexOf(retencoes[i].tributo) >= 0) retencoes.splice(i, 1);
        }
        retencoes.push({ tributo: 'PIS', valor: partes.PIS });
        retencoes.push({ tributo: 'COFINS', valor: partes.COFINS });
        retencoes.push({ tributo: 'CSLL', valor: partes.CSLL });
        csrfSeparada = true;
      }
      const totalRetido = Math.round(retencoes.reduce(function (s, r) {
        return s + r.valor; }, 0) * 100) / 100;

      const emissao = (texto(inf, 'DataEmissao') || '').slice(0, 10);
      const compBruta = texto(inf, 'Competencia');
      return {
        /* Para a tela poder dizer que separou — campo preenchido
           em silêncio é campo que ninguém confere. */
        csrf_separada: csrfSeparada,
        numero: texto(inf, 'Numero'),
        codigo_verificacao: texto(inf, 'CodigoVerificacao'),
        chave: texto(inf, 'ChaveAcesso') || null,
        emissao: emissao,
        /* Competência da nota quando vier; senão, o mês da emissão. */
        competencia: (compBruta || emissao).slice(0, 7),
        cancelada: !!pega(inf, 'NfseCancelamento') ||
          /cancel/i.test(texto(inf, 'SituacaoAdn') || ''),
        prestador_doc: soDigitos(texto(prest, 'Cnpj') || texto(prest, 'Cpf')),
        prestador_nome: texto(prest, 'RazaoSocial'),
        prestador_im: texto(prest, 'InscricaoMunicipal'),
        tomador_doc: soDigitos(texto(tom, 'Cnpj') || texto(tom, 'Cpf')),
        tomador_nome: texto(tom, 'RazaoSocial'),
        discriminacao: (texto(inf, 'Discriminacao') || '').replace(/\s+/g, ' ').trim(),
        item_lista: texto(inf, 'ItemListaServico'),
        municipio: texto(inf, 'CodigoMunicipio'),
        valor_servicos: servicos,
        deducoes: deducoes,
        desconto: desconto,
        valor_liquido: liquido,
        iss: valor(texto(valores, 'ValorIss')),
        iss_retido: issRetidoFlag,
        aliquota: valor(texto(valores, 'Aliquota')),
        retencoes: retencoes,
        valor_retido: totalRetido
      };
    });

    return { ok: true, notas: notas, qtd: notas.length };
  }

  /* Converte as notas do XML para o MESMO formato que o leitor de TXT
     do portal produz, para a tela de notas emitidas servir aos dois.
     A tela já sabe escolher projeto, conferir competência, marcar o
     que entra e montar o contas a receber — não faria sentido ter uma
     segunda tela só porque a origem do arquivo mudou. */
  function comoLote(lido, nomeArquivo) {
    const notas = (lido.notas || []).map(function (n) {
      return {
        numero: String(n.numero || ''),
        emissao: n.emissao, hora: '00:00',
        verificacao: n.codigo_verificacao,
        situacao: n.cancelada ? 'NC' : 'NA',
        cancelada: !!n.cancelada,
        cancelamento: '',
        inscricaoPrestador: n.prestador_im || '',
        documentoPrestador: n.prestador_doc || '',
        tomador: {
          documento: n.tomador_doc || '', nome: n.tomador_nome || '',
          logradouro: '', numero: '', complemento: '', bairro: '',
          cidade: '', uf: '', cep: '', email: ''
        },
        discriminacao: n.discriminacao || '',
        municipioPrestacao: n.municipio || '',
        servicos: [], retencoes: n.retencoes || [],
        valor: n.valor_servicos, aliquota: n.aliquota,
        valorRetido: n.valor_retido,
        /* O LÍQUIDO que a prefeitura assinou manda: recalcular como
           serviços − retenções jogava fora o desconto incondicionado
           e as deduções, e o título nascia maior do que o hospital
           vai pagar — a diferença ficava em aberto para sempre e
           entrava na régua de cobrança como atraso. */
        valorLiquido: n.valor_liquido > 0
          ? n.valor_liquido
          : Math.round((n.valor_servicos - n.valor_retido -
              (n.deducoes || 0) - (n.desconto || 0)) * 100) / 100,
        deducoes: n.deducoes || 0, desconto: n.desconto || 0,
        competencia: n.competencia, competenciaOrigem: 'xml', competenciaConflito: false,
        chave: n.chave || null,
        arquivo: nomeArquivo || 'XML'
      };
    });
    const validas = notas.filter(function (n) { return !n.cancelada; });
    const r2 = v => Math.round(v * 100) / 100;
    const total = r2(validas.reduce(function (s, n) { return s + n.valor; }, 0));
    const retido = r2(validas.reduce(function (s, n) { return s + n.valorRetido; }, 0));
    notas.sort(function (a2, b2) {
      return (a2.emissao).localeCompare(b2.emissao) || (+a2.numero) - (+b2.numero);
    });
    return {
      notas: notas, canceladas: notas.length - validas.length,
      total: total, retido: retido, liquido: r2(total - retido),
      totalTodas: r2(notas.reduce(function (s, n) { return s + n.valor; }, 0)),
      /* O XML não tem trailer para conferir contra: o arquivo é a
         própria fonte, assinada pela prefeitura. */
      confereTrailer: true, totalTrailer: total, retidoTrailer: retido,
      periodoIni: notas.length ? notas[0].emissao : '',
      periodoFim: notas.length ? notas[notas.length - 1].emissao : '',
      problemas: [], origem: 'xml'
    };
  }

  return { ler: ler, valor: valor, comoLote: comoLote, separarCsrf: separarCsrf };
})();
