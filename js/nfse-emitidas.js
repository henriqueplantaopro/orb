/* ERP · nfse-emitidas.js — leitura do pacote de NFS-e emitidas que o
   portal da prefeitura manda por link.

   O portal gera um ZIP com um TXT por dia de emissão, em largura fixa.
   Layout mapeado a partir de um pacote real de agosto/2026 da Prefeitura
   de Barueri (identificador "PMB"), com cinco tipos de registro:

     1  header do arquivo .... inscrição, período e órgão
     2  nota ................. número, data/hora, código de verificação,
                               tomador completo e discriminação
     3  serviço .............. descrição, código de atividade, valor, alíquota
     4  tributo retido ....... 401 IR · 402 PIS · 403 COFINS · 404 CSLL
     9  trailer .............. quantidade de registros e os dois totais

   Os códigos de tributo foram conferidos pelas alíquotas do arquivo real:
   sobre R$ 314.213,68 saíram 1,5% de IR, 0,65% de PIS, 3% de COFINS e
   1% de CSLL — bate com 401, 402, 403 e 404 nessa ordem.

   Módulo puro: não conhece a tela nem o banco de dados. */
window.ERP = window.ERP || {};

ERP.nfseEmitidas = (function () {

  const TRIBUTOS = { '401': 'IRRF', '402': 'PIS', '403': 'COFINS', '404': 'CSLL', '405': 'INSS' };
  const cortar = (l, i, f) => l.substring(i - 1, f);
  const limpo = (l, i, f) => cortar(l, i, f).trim();
  const cent = (l, i, f) => {
    const v = parseInt(cortar(l, i, f).replace(/\D/g, ''), 10);
    return isNaN(v) ? 0 : Math.round(v) / 100;
  };
  const dataISO = s => (/^\d{8}$/.test(s) ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6) : '');
  const hora = s => (/^\d{6}$/.test(s) ? s.slice(0, 2) + ':' + s.slice(2, 4) : '');

  /* A competência não é campo do layout: vem escrita na discriminação,
     em formatos diferentes conforme quem preencheu. Vale tentar. */
  /* A competência não é campo do layout: vem escrita na discriminação.
     Ordem de confiança:
       1. dito explicitamente ("competência 07/2026", "competência julho de 2026")
       2. deduzido do período ("de 21/06/2026 a 20/07/2026" → julho)
       3. presumido como o mês anterior à emissão
     Quando 1 e 2 existem e discordam, devolve o conflito para a tela
     mostrar — é o sinal de que a nota foi escrita errada. */
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const semAcento = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function explicita(txt) {
    const t = String(txt || '');
    const m = t.match(/compet[êe]ncia\s*(?:de\s*|:\s*)?(0[1-9]|1[0-2])[\/\-](20\d{2})/i);
    if (m) return m[2] + '-' + m[1];
    const nome = t.match(/compet[êe]ncia\s*(?:de\s*|:\s*)?([A-Za-zÀ-ÿ]{3,9})\s*(?:de\s*)?(20\d{2})/i);
    if (nome) {
      const alvo = semAcento(nome[1]).slice(0, 4);
      const i = MESES.findIndex(function (x) { return semAcento(x).slice(0, 4) === alvo; });
      if (i >= 0) return nome[2] + '-' + String(i + 1).padStart(2, '0');
    }
    // "ref. 07/2026", "referente a 07/2026", "mês 07/2026"
    const ref = t.match(/(?:ref\.?|refer[êe]nte\s*a?o?|m[êe]s)\s*:?\s*(0[1-9]|1[0-2])[\/\-](20\d{2})/i);
    if (ref) return ref[2] + '-' + ref[1];
    return '';
  }

  // período: vale o mês da DATA FINAL (21/06 a 20/07 = julho)
  function doPeriodo(txt) {
    const p = String(txt || '').match(
      /(\d{2})\/(\d{2})\/(\d{4})\s*(?:a|à|até|\-)\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    return p ? p[6] + '-' + p[5] : '';
  }

  function competenciaDe(txt) {
    const ex = explicita(txt), pe = doPeriodo(txt);
    if (ex) {
      return { comp: ex, origem: 'explicita', conflito: (pe && pe !== ex) ? pe : '' };
    }
    if (pe) return { comp: pe, origem: 'periodo', conflito: '' };
    return { comp: '', origem: '', conflito: '' };
  }

  function lerArquivo(conteudo, nomeArquivo) {
    const linhas = String(conteudo).split(/\r\n|\n|\r/).filter(function (l) { return l.trim().length; });
    const notas = [];
    let cab = null, atual = null, trailer = null;

    linhas.forEach(function (l) {
      const t = l.charAt(0);
      if (t === '1') {
        cab = {
          inscricao: limpo(l, 2, 8),
          periodoIni: dataISO(cortar(l, 9, 16)),
          periodoFim: dataISO(cortar(l, 17, 24)),
          orgao: limpo(l, 25, 27)
        };
      } else if (t === '2') {
        atual = {
          numero: String(parseInt(cortar(l, 6, 12), 10) || ''),
          emissao: dataISO(cortar(l, 13, 20)),
          hora: hora(cortar(l, 21, 26)),
          verificacao: limpo(l, 27, 50),
          situacao: limpo(l, 66, 67),          // NA = normal · NC = cancelada
          cancelamento: dataISO(cortar(l, 68, 75)),
          inscricaoPrestador: limpo(l, 76, 85),
          tomador: {
            documento: limpo(l, 94, 107),
            nome: limpo(l, 108, 207),
            logradouro: limpo(l, 208, 307),
            numero: limpo(l, 308, 316),
            complemento: limpo(l, 317, 336),
            bairro: limpo(l, 337, 376),
            cidade: limpo(l, 377, 416),
            uf: limpo(l, 417, 418),
            cep: limpo(l, 419, 426),
            email: limpo(l, 477, 626)
          },
          discriminacao: limpo(l, 629, 1628).replace(/\s{2,}/g, ' '),
          municipioPrestacao: limpo(l, 1629, 1635),
          documentoPrestador: limpo(l, 1638, 1651),
          servicos: [], retencoes: [],
          valor: 0, aliquota: 0, valorRetido: 0, valorLiquido: 0,
          arquivo: nomeArquivo
        };
        const cp = competenciaDe(atual.discriminacao);
        atual.competencia = cp.comp;
        atual.competenciaOrigem = cp.origem;
        atual.competenciaConflito = cp.conflito;
        notas.push(atual);
      } else if (t === '3' && atual) {
        const s = {
          item: String(parseInt(cortar(l, 2, 7), 10) || 1),
          descricao: limpo(l, 8, 67),
          atividade: cortar(l, 68, 75),
          valor: cent(l, 76, 91),
          aliquota: cent(l, 92, 95)
        };
        atual.servicos.push(s);
        atual.valor = Math.round((atual.valor + s.valor) * 100) / 100;
        atual.aliquota = s.aliquota;
      } else if (t === '4' && atual) {
        const cod = cortar(l, 1, 3);
        const v = cent(l, 4, 18);
        if (v > 0) atual.retencoes.push({ tributo: TRIBUTOS[cod] || cod, codigo: cod, valor: v });
      } else if (t === '9') {
        trailer = {
          registros: parseInt(cortar(l, 2, 8), 10) || 0,
          valorTotal: cent(l, 9, 23),
          retencaoTotal: cent(l, 24, 38)
        };
      }
    });

    notas.forEach(function (n) {
      n.valorRetido = Math.round(n.retencoes.reduce(function (s, r) { return s + r.valor; }, 0) * 100) / 100;
      n.valorLiquido = Math.round((n.valor - n.valorRetido) * 100) / 100;
      n.cancelada = n.situacao === 'NC';
      // sem nada escrito, presume o mês anterior à emissão
      if (!n.competencia && n.emissao) {
        const d = new Date(n.emissao + 'T12:00:00Z');
        d.setUTCMonth(d.getUTCMonth() - 1);
        n.competencia = d.toISOString().slice(0, 7);
        n.competenciaOrigem = 'presumida';
      }
      n.competenciaPresumida = n.competenciaOrigem === 'presumida';
    });

    return { cabecalho: cab, notas: notas, trailer: trailer };
  }

  /* Junta os arquivos do pacote e confere os totais contra os trailers. */
  function consolidar(arquivos) {
    const notas = [];
    let somaTrailer = 0, retTrailer = 0;
    const problemas = [];

    arquivos.forEach(function (a) {
      let r;
      try { r = lerArquivo(a.conteudo, a.nome); }
      catch (e) { problemas.push(a.nome + ': não consegui ler (' + e.message + ')'); return; }
      if (!r.cabecalho) { problemas.push(a.nome + ': sem registro de cabeçalho — não parece um arquivo do portal.'); return; }
      if (!r.notas.length) { problemas.push(a.nome + ': nenhuma nota no arquivo.'); return; }

      // o trailer soma TODAS as notas do dia, canceladas inclusive
      const soma = Math.round(r.notas.reduce(function (s, n) { return s + n.valor; }, 0) * 100) / 100;
      if (r.trailer && Math.abs(soma - r.trailer.valorTotal) > 0.01) {
        problemas.push(a.nome + ': soma das notas (' + ERP.util.brl(soma) +
          ') diferente do total do arquivo (' + ERP.util.brl(r.trailer.valorTotal) + ').');
      }
      if (r.trailer) { somaTrailer += r.trailer.valorTotal; retTrailer += r.trailer.retencaoTotal; }
      notas.push.apply(notas, r.notas);
    });

    notas.sort(function (a, b) {
      return (a.emissao + a.hora).localeCompare(b.emissao + b.hora) || (+a.numero) - (+b.numero);
    });

    const validas = notas.filter(function (n) { return !n.cancelada; });
    const somaTodas = Math.round(notas.reduce(function (s, n) { return s + n.valor; }, 0) * 100) / 100;
    const total = Math.round(validas.reduce(function (s, n) { return s + n.valor; }, 0) * 100) / 100;
    const retido = Math.round(validas.reduce(function (s, n) { return s + n.valorRetido; }, 0) * 100) / 100;

    // duas notas com o mesmo número é sinal de pacote importado em dobro
    const vistos = {};
    notas.forEach(function (n) {
      if (vistos[n.numero]) problemas.push('Nota ' + n.numero + ' aparece mais de uma vez no pacote.');
      vistos[n.numero] = true;
    });

    return {
      notas: notas, canceladas: notas.length - validas.length,
      total: total, retido: retido,
      liquido: Math.round((total - retido) * 100) / 100,
      totalTodas: somaTodas,
      confereTrailer: Math.abs(somaTodas - somaTrailer) < 0.01,
      totalTrailer: Math.round(somaTrailer * 100) / 100,
      retidoTrailer: Math.round(retTrailer * 100) / 100,
      periodoIni: notas.length ? notas[0].emissao : '',
      periodoFim: notas.length ? notas[notas.length - 1].emissao : '',
      problemas: problemas
    };
  }

  return { lerArquivo: lerArquivo, consolidar: consolidar, competenciaDe: competenciaDe, TRIBUTOS: TRIBUTOS };
})();
