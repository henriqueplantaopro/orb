/* HABILITAÇÃO · leitura do documento — o que o PDF diz de si mesmo.

   POR QUE EXISTE

   Subir uma certidão a mão são seis campos: tipo, número, emissão,
   validade, empresa, abrangência. Seis campos por certidão, treze
   certidões, quatro empresas — ninguém mantém isso em dia, e um
   cofre com data errada é pior que cofre nenhum: o semáforo fica
   verde e a empresa é inabilitada.

   O PDF da certidão traz tudo isso escrito. Este módulo lê.

   ─────────────────────────────────────────────────────────────
   O QUE É DIFÍCIL AQUI

   Não é achar data — é saber QUAL data. Uma CND Federal tem três
   (emissão, validade, e a data de corte do débito), e a mais
   vistosa na página costuma ser a errada. Então nada de "primeira
   data que aparecer": cada data é encontrada pela FRASE que a
   apresenta ("válida até", "expedição em"), e data sem frase que a
   qualifique é descartada. Errar para menos — devolver vazio e
   deixar a pessoa digitar — é barato. Errar para mais é o que
   inabilita.

   O segundo caso difícil é a certidão que NÃO imprime validade. A
   CNDT escreve "válida por 180 dias contados da expedição" em
   palavras, e o leitor precisa buscar o prazo no catálogo do tipo
   em vez de inventar.

   ─────────────────────────────────────────────────────────────
   DELIBERADAMENTE FORA

   OCR. PDF escaneado não tem camada de texto e aqui não há como
   ler — o módulo diz isso ("o arquivo não tem texto: deve ser
   digitalização") em vez de devolver campos vazios, que a pessoa
   leria como "o sistema não achou nada" e tentaria de novo.

   Módulo puro: texto entra, campos saem. Sem DOM, sem banco. Dá
   para rodar no node contra o texto de uma certidão de verdade, e
   é assim que os casos abaixo foram verificados. */

(function (raiz) {

  /* Acentuação atrapalha a comparação e não acrescenta nada: o
     catálogo guarda as palavras-chave já sem acento, e o texto do
     PDF vem como o emissor digitou. */
  function normalizar(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  const so = s => String(s == null ? '' : s).replace(/\D/g, '');

  /* ── datas ───────────────────────────────────────────────
     dd/mm/aaaa e "9 de outubro de 2026" — as duas formas que as
     certidões usam. Devolve ISO, que é como o banco guarda. */
  const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
                 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  function iso(d, m, a) {
    d = +d; m = +m; a = +a;
    if (a < 100) a += a < 70 ? 2000 : 1900;
    if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12 && a >= 1990 && a <= 2100)) return null;
    const dt = new Date(Date.UTC(a, m - 1, d));
    /* 31/02 existe como texto e não como data. O construtor rola
       para 03/03 em silêncio; comparar de volta é o que pega. */
    if (dt.getUTCDate() !== d || dt.getUTCMonth() !== m - 1) return null;
    return a + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  /* Todas as datas do trecho, com a posição onde cada uma estava —
     a posição é o que permite dizer "a que vem depois da frase". */
  function datasDe(txt) {
    const achadas = [];
    const numerica = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/g;
    let m;
    while ((m = numerica.exec(txt))) {
      const v = iso(m[1], m[2], m[3]);
      if (v) achadas.push({ iso: v, em: m.index, bruto: m[0] });
    }
    const escrita = new RegExp('(\\d{1,2}) de (' + MESES.join('|') + ') de (\\d{4})', 'g');
    while ((m = escrita.exec(txt))) {
      const v = iso(m[1], MESES.indexOf(m[2]) + 1, m[3]);
      if (v) achadas.push({ iso: v, em: m.index, bruto: m[0] });
    }
    return achadas.sort(function (a, b) { return a.em - b.em; });
  }

  /* As frases que apresentam cada data. A ordem importa: a primeira
     que casar ganha, então a frase específica vem antes da genérica
     ("data de validade" antes de "validade"). */
  const FRASES_VALIDADE = [
    'valida ate', 'valido ate', 'validade ate', 'data de validade', 'valida at',
    'vencimento', 'vence em', 'expira em', 'eficacia ate', 'validade'
  ];
  const FRASES_EMISSAO = [
    'data de emissao', 'emitida em', 'emitido em', 'emissao', 'expedicao',
    'expedida em', 'expedido em', 'emitida as', 'do dia', 'gerada em'
  ];

  /* A data que vem DEPOIS da frase, dentro de uma janela curta.

     A janela é o que impede de pescar longe: "válida até" seguido de
     120 caracteres de texto legal e só então uma data é outra data.
     Cento e sessenta caracteres cobrem a redação mais prolixa que
     apareceu (a CND Federal põe a hora e o fuso entre a frase e a
     data) sem alcançar o parágrafo seguinte. */
  const JANELA = 160;

  function dataApos(txt, frases, datas) {
    for (let i = 0; i < frases.length; i++) {
      const frase = frases[i];
      let de = 0, p;
      while ((p = txt.indexOf(frase, de)) >= 0) {
        de = p + frase.length;
        const dentro = datas.filter(function (d) {
          return d.em >= p && d.em <= p + frase.length + JANELA;
        });
        if (!dentro.length) continue;

        /* A PRIMEIRA data da janela, não a última.

           A CND Federal escreve "Emitida às 09:12:31 do dia
           02/04/2026 <hora de Brasília>. Válida até 29/09/2026." —
           as duas datas caem na mesma janela, e a última é a
           validade. Pegar a última dava a validade como emissão e,
           pior, dava a validade certa por acidente num caso e
           errada no outro. */
        const primeira = dentro[0];

        /* A exceção é o INTERVALO, e ele se reconhece pelo que
           está entre as duas datas: "25/09/2026 a 24/10/2026" (o
           CRF do FGTS). Só "a" ou "até", nada mais — se houver
           texto no meio são duas datas diferentes, não um
           intervalo. */
        if (dentro.length > 1) {
          const meio = txt.slice(primeira.em + primeira.bruto.length, dentro[1].em);
          if (/^\s*(a|ate|a te)\s*$/.test(meio)) {
            return { iso: dentro[1].iso, frase: frase, intervalo: primeira.iso };
          }
        }
        return { iso: primeira.iso, frase: frase, intervalo: null };
      }
    }
    return null;
  }

  /* ── CNPJ ────────────────────────────────────────────────
     Com dígito verificador conferido: a certidão traz inscrição
     estadual, número de protocolo e código de controle, todos com
     catorze dígitos de vez em quando. O DV separa. */
  function cnpjValido(c) {
    if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
    const calc = function (fim) {
      let peso = fim - 7, soma = 0;
      for (let i = 0; i < fim; i++) {
        soma += (+c[i]) * peso;
        peso = peso - 1 < 2 ? 9 : peso - 1;
      }
      const r = soma % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return calc(12) === +c[12] && calc(13) === +c[13];
  }

  function cnpjsDe(txt) {
    const fora = [];
    const re = /\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2}/g;
    let m;
    while ((m = re.exec(txt))) {
      const c = so(m[0]);
      if (c.length === 14 && cnpjValido(c) && fora.indexOf(c) < 0) fora.push(c);
    }
    return fora;
  }

  /* ── número do documento ─────────────────────────────────
     Só com frase que o apresente. Sem isso, qualquer sequência de
     dígitos da página virava "número da certidão" — inclusive o
     CNPJ e o código de barras. */
  const FRASES_NUMERO = [
    'numero da certidao', 'certidao numero', 'certificado numero', 'certificacao numero',
    'codigo de controle', 'numero do documento', 'certidao n', 'certificado n',
    'alvara n', 'licenca n', 'documento n', 'protocolo'
  ];

  function numeroDe(txt) {
    for (let i = 0; i < FRASES_NUMERO.length; i++) {
      const frase = FRASES_NUMERO[i];
      let de = 0, p;
      /* Todas as ocorrências, não só a primeira: "certidao n" casa
         antes com "CERTIDÃO NEGATIVA" do cabeçalho, e parar ali
         devolvia vazio enquanto o número estava três linhas
         abaixo. */
      while ((p = txt.indexOf(frase, de)) >= 0) {
        de = p + frase.length;
        const depois = txt.slice(de, de + 60);
        /* Ancorado: o número tem de vir COLADO na frase, separado
           no máximo por pontuação e espaço. Sem a âncora a busca
           alcançava qualquer sequência de dígitos adiante — o CNPJ,
           o código de barras — e etiquetava como número da
           certidão. */
        const m = depois.match(/^[:\s°ºo.\-]{0,6}([0-9][0-9.\/\-]{6,40}[0-9])/);
        if (m) return m[1].replace(/[.\-\/]+$/, '');
      }
    }
    return '';
  }

  /* ── abrangência ─────────────────────────────────────────
     A CND Federal diz, com estas palavras, se cobre as filiais.
     Importa para o edital: uma certidão de matriz dispensa a da
     filial; o contrário não. */
  function abrangenciaDe(txt) {
    if (/estabelecimento matriz e suas filiais|matriz e filiais|abrange.{0,30}filiais/.test(txt)) {
      return 'matriz';
    }
    return 'estabelecimento';
  }

  /* ── classificação do tipo ───────────────────────────────
     Soma dos pesos das palavras-chave encontradas. É o que o cofre
     que vocês já usavam fazia, e funcionou: a frase inteira do
     cabeçalho ("certificado de regularidade do fgts", peso 8) pesa
     mais que a sigla solta ("fgts", peso 3), que aparece em
     qualquer documento trabalhista. */
  function classificar(txt, tipos) {
    const notas = (tipos || []).map(function (t) {
      let chaves = t.palavras_chave;
      if (typeof chaves === 'string') { try { chaves = JSON.parse(chaves); } catch (e) { chaves = []; } }
      let pontos = 0; const achou = [];
      (chaves || []).forEach(function (par) {
        const termo = normalizar(Array.isArray(par) ? par[0] : par);
        const peso = Array.isArray(par) ? (+par[1] || 1) : 1;
        if (termo && txt.indexOf(termo) >= 0) { pontos += peso; achou.push(termo); }
      });
      return { tipo: t.id, nome: t.nome, pontos: pontos, achou: achou };
    }).filter(function (n) { return n.pontos > 0; })
      .sort(function (a, b) { return b.pontos - a.pontos; });
    return notas;
  }

  /* ── soma de dias ────────────────────────────────────────
     Para a certidão que escreve o prazo em palavras ("válida por
     180 dias"): a data sai do catálogo do tipo, não da página. */
  function maisDias(isoData, dias) {
    if (!isoData || !dias) return null;
    const p = isoData.split('-');
    const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    d.setUTCDate(d.getUTCDate() + (+dias));
    return d.toISOString().slice(0, 10);
  }

  /* ── a leitura ───────────────────────────────────────────
     texto cru + catálogo de tipos → campos do formulário.
     `avisos` é o que a pessoa precisa conferir à mão. */
  function ler(textoCru, tipos, opcoes) {
    opcoes = opcoes || {};
    const txt = normalizar(textoCru);
    const avisos = [];

    if (txt.replace(/[^a-z0-9]/g, '').length < 40) {
      return { vazio: true, avisos: ['O arquivo não tem texto — deve ser uma digitalização. ' +
        'Dá para guardar assim, mas as datas precisam ser digitadas.'] };
    }

    const candidatos = classificar(txt, tipos);
    const escolhido = candidatos[0] || null;
    const tipo = escolhido ? escolhido.tipo : '';
    const doCatalogo = (tipos || []).find(function (t) { return t.id === tipo; }) || {};

    /* Empate real: dois tipos com a mesma pontuação não se resolve
       por ordem de catálogo, que seria sorteio. Marca para a pessoa
       escolher. */
    if (candidatos.length > 1 && candidatos[1].pontos === escolhido.pontos) {
      avisos.push('O texto serve para "' + escolhido.nome + '" e "' + candidatos[1].nome +
        '" igualmente — confirme qual é.');
    }

    const datas = datasDe(txt);
    const val = dataApos(txt, FRASES_VALIDADE, datas);
    const emi = dataApos(txt, FRASES_EMISSAO, datas);

    let emissao = emi ? emi.iso : null;
    let validade = val ? val.iso : null;

    /* O intervalo do FGTS dá a emissão de graça quando ela não
       aparece com frase própria. */
    if (!emissao && val && val.intervalo) emissao = val.intervalo;

    /* Datas trocadas: validade antes da emissão é leitura errada,
       não documento estranho. Descarta a validade em vez de
       mostrar um vencido falso. */
    if (emissao && validade && validade < emissao) {
      avisos.push('As datas lidas ficaram fora de ordem (validade antes da emissão) — confira.');
      validade = null;
    }

    /* Prazo escrito em palavras: a data sai do catálogo. */
    let validadeCalculada = false;
    if (!validade && emissao && doCatalogo.prazo_padrao_dias && !doCatalogo.sem_validade) {
      validade = maisDias(emissao, doCatalogo.prazo_padrao_dias);
      validadeCalculada = true;
      avisos.push('O documento não imprime a validade: usei ' + doCatalogo.prazo_padrao_dias +
        ' dias da emissão, que é o prazo deste tipo.');
    }

    if (!doCatalogo.sem_validade && !validade && !emissao) {
      avisos.push('Não achei data nenhuma com frase que a identifique. Digite a validade à mão.');
    }

    const cnpjs = cnpjsDe(txt);

    return {
      tipo: tipo,
      tipo_nome: escolhido ? escolhido.nome : '',
      confianca: escolhido ? escolhido.pontos : 0,
      candidatos: candidatos.slice(0, 4),
      numero: numeroDe(txt),
      data_emissao: emissao,
      data_validade: doCatalogo.sem_validade ? null : validade,
      validade_calculada: validadeCalculada,
      cnpj: cnpjs[0] || '',
      cnpjs: cnpjs,
      abrangencia: abrangenciaDe(txt),
      avisos: avisos
    };
  }

  const api = { ler: ler, classificar: classificar, datasDe: datasDe, dataApos: dataApos,
                cnpjsDe: cnpjsDe, cnpjValido: cnpjValido, numeroDe: numeroDe,
                abrangenciaDe: abrangenciaDe, normalizar: normalizar, maisDias: maisDias,
                FRASES_VALIDADE: FRASES_VALIDADE, FRASES_EMISSAO: FRASES_EMISSAO };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) { raiz.ERP = raiz.ERP || {}; raiz.ERP.habLeitura = api; }

})(typeof window !== 'undefined' ? window : null);
