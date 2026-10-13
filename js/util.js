/* ERP · util.js — formatação, datas e atalhos de DOM.
   Nenhuma regra de negócio mora aqui. */
window.ERP = window.ERP || {};

ERP.util = (function () {
  const brl = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // "1.234,56" | "1234.56" | 1234.56  ->  1234.56
  function parseValor(s) {
    if (typeof s === 'number') return s;
    s = String(s || '').trim().replace(/[R$\s]/g, '');
    if (!s) return 0;
    if (s.indexOf(',') > -1) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
      /* "23.000" digitado no Brasil é vinte e três mil, não 23 reais e
         zero centavos: ponto seguido de exatamente 3 dígitos (e sem
         vírgula nenhuma) é separador de milhar. "23.5" continua sendo
         23,5, que é como quem digita rápido escreve. */
      s = s.replace(/\./g, '');
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : Math.round(n * 100) / 100;
  }

  /* Data local, não UTC. `toISOString()` sempre devolve o horário de
     Greenwich — depois das 21h no Brasil (UTC-3) já é meia-noite em
     Londres, e "hoje" virava amanhã: vencidas calculadas erradas, data
     padrão de lançamento um dia à frente, alerta de competência
     disparando cedo demais. */
  const doisDig = n => String(n).padStart(2, '0');
  const hoje = () => {
    const d = new Date();
    return d.getFullYear() + '-' + doisDig(d.getMonth() + 1) + '-' + doisDig(d.getDate());
  };
  const mesAtual = () => {
    const d = new Date();
    return d.getFullYear() + '-' + doisDig(d.getMonth() + 1);
  };

  const fData = iso => (iso ? iso.split('-').reverse().join('/') : '—');

  /* Data COM HORA no mesmo padrão: dd/mm/aaaa HH:MM. Vários pontos
     usavam `new Date().toLocaleString('pt-BR')` direto, que depende
     do locale da máquina e varia o formato entre um computador e
     outro. O formato é sempre este, em qualquer lugar. */
  const fDataHora = v => {
    if (!v) return '—';
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) return '—';
    const p = n => String(n).padStart(2, '0');
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };

  /* Percentual com as mesmas duas casas: 9,04% — nunca "9.04%" nem
     "9%". */
  const pct = v => num(v) + '%';
  const fComp = c => {
    if (!c) return '—';
    const [a, m] = c.slice(0, 7).split('-');
    return m + '/' + a;
  };

  // soma meses preservando o dia; se o mês destino não tem o dia, cai no último
  function addMeses(iso, n) {
    const [a, m, d] = iso.split('-').map(Number);
    const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
    const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
    alvo.setUTCDate(Math.min(d, ultimo));
    return alvo.toISOString().slice(0, 10);
  }
  function addDias(iso, n) {
    const dt = new Date(iso + 'T12:00:00Z');
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }
  const compDe = iso => (iso ? iso.slice(0, 7) : '');
  function diasEntre(a, b) {
    return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
  }

  const el = id => document.getElementById(id);
  const val = id => (el(id) ? el(id).value.trim() : '');
  const setVal = (id, v) => { if (el(id)) el(id).value = v; };
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* Baixa um arquivo gerado na hora. O BOM (marca de codificação) é o
     que faz o Excel abrir CSV acentuado direito — mas em arquivo de
     remessa bancária ele é veneno: são 3 bytes a mais no começo, a 1ª
     linha do CNAB fica com 243 posições em vez de 240 e o banco recusa.
     Por isso o BOM entra só em CSV. */
  /* Data (AAAA-MM-DD) no fuso de QUEM USA. toISOString() devolve UTC:
     depois das 21h em Brasília o registro caía no dia seguinte. */
  function dataLocal(d) {
    const dt = d ? new Date(d) : new Date();
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') +
      '-' + String(dt.getDate()).padStart(2, '0');
  }

  function baixar(nome, conteudo, tipo) {
    const ehCsv = !tipo || /csv/i.test(tipo) || /\.csv$/i.test(nome || '');
    const blob = new Blob([(ehCsv ? '\ufeff' : '') + conteudo],
      { type: (tipo || 'text/csv') + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 300);
  }

  // tabela HTML -> CSV que o Excel abre com ; como separador
  /* CSV a partir de uma tabela da tela.

     Raspar o DOM traz junto o que é da tela e não do dado: a coluna do
     checkbox, a coluna de botões ("Pagar Editar Ver"), o badge colado
     no vencimento ("05/08/2026 42d") e o valor como texto
     ("R$ 12.400,00"), que o Excel não soma. E sem BOM o acento sai
     quebrado no Excel do Windows.

     Isto continua sendo raspagem — a exportação boa é a que sai do
     dado, como a do contas a pagar e a do fluxo de caixa. Mas ao menos
     o arquivo abre limpo e as colunas de valor somam. */
  const MOEDA_TXT = /^-?R\$\s*-?[\d.]+,\d{2}$/;

  function tabelaParaCSV(tabela) {
    const linhas = Array.from(tabela.querySelectorAll('tr'));
    if (!linhas.length) return '';

    // colunas a descartar: as que só têm controle, em toda a tabela
    const inutil = ix => linhas.every(function (tr) {
      const c = tr.querySelectorAll('th,td')[ix];
      if (!c) return true;
      if (c.querySelector('input[type=checkbox],button')) return true;
      return !c.innerText.replace(/\s+/g, '').length;
    });
    const nCols = Math.max.apply(null, linhas.map(function (tr) {
      return tr.querySelectorAll('th,td').length; }));
    const manter = [];
    for (let i = 0; i < nCols; i++) if (!inutil(i)) manter.push(i);

    const limpa = c => {
      // o badge fica em bloco próprio: só a primeira linha visual interessa
      let t = c.innerText.split('\n')[0].replace(/\s+/g, ' ').trim();
      if (MOEDA_TXT.test(t)) {
        return t.replace(/R\$\s*/, '').replace(/\./g, '').replace(',', '.');
      }
      return '"' + t.replace(/"/g, '""') + '"';
    };

    const corpo = linhas.map(function (tr) {
      const cs = tr.querySelectorAll('th,td');
      return manter.map(function (i) { return cs[i] ? limpa(cs[i]) : '""'; }).join(';');
    }).join('\n');
    return '\ufeff' + corpo;   // BOM, senão o Excel do Windows quebra o acento
  }

  // só os dígitos, e a máscara de CNPJ/CPF para exibição
  const so = s => String(s == null ? '' : s).replace(/\D/g, '');
  /* ── CNPJ e CPF ──────────────────────────────────────────
     O ZERO DA FRENTE SOME, e some em silêncio.

     CNPJ tem catorze dígitos e muitos começam com zero. Passando
     por planilha, por importação ou por qualquer lugar que trate o
     campo como NÚMERO, o 08.656.723/0001-70 vira 8656723000170 —
     treze dígitos. A tela mostra "8.656.723/0001-70", que parece
     um CNPJ, e o arquivo de remessa sai com treze dígitos num
     campo de catorze. O banco recusa o arquivo inteiro, e o motivo
     que ele devolve não fala em zero nenhum.

     A correção não pode ser "preencher com zero à esquerda e
     torcer": completar um número truncado é chute. Mas CNPJ tem
     dígito verificador, e isso permite COMPROVAR o chute — se o
     valor com o zero na frente tem DV válido e o valor sem não
     tem, o zero estava lá. É o único caso em que completar é
     dedução e não palpite.

     Quando nem assim fecha, o valor volta como está: errado e
     visível, em vez de errado e disfarçado de certo. */
  function dvCnpj(c) {
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
  function cnpjValido(v) {
    const d = so(v);
    return /^\d{14}$/.test(d) && !/^(\d)\1{13}$/.test(d) && dvCnpj(d);
  }
  function dvCpf(c) {
    const calc = function (fim) {
      let soma = 0;
      for (let i = 0; i < fim; i++) soma += (+c[i]) * (fim + 1 - i);
      const r = (soma * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return calc(9) === +c[9] && calc(10) === +c[10];
  }
  function cpfValido(v) {
    const d = so(v);
    return /^\d{11}$/.test(d) && !/^(\d)\1{10}$/.test(d) && dvCpf(d);
  }

  /* Devolve o documento com os dígitos que ele deveria ter, quando
     dá para PROVAR que faltam zeros à esquerda. */
  function documentoNormalizado(v) {
    const d = so(v);
    if (!d) return d;
    if (d.length === 14 || d.length === 11) return d;
    if (d.length > 11 && d.length < 14) {
      const c = d.padStart(14, '0');
      if (cnpjValido(c)) return c;
    }
    if (d.length > 8 && d.length < 11) {
      const c = d.padStart(11, '0');
      if (cpfValido(c)) return c;
    }
    return d;
  }

  function cnpj(v) {
    const d = documentoNormalizado(v);
    if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    return v || '';
  }

  /* Dias úteis do mês (sem sábado, domingo e feriado): é a base de
     vale-transporte e vale-refeição. */
  function diasUteis(competencia) {
    const ini = competencia + '-01';
    const fim = addDias(compDe(addMeses(ini, 1)) + '-01', -1);
    let n = 0, d = ini;
    while (d <= fim) {
      const dia = new Date(d + 'T12:00:00').getDay();
      if (dia !== 0 && dia !== 6 && !(ERP.store && ERP.store.ehFeriado && ERP.store.ehFeriado(d))) n++;
      d = addDias(d, 1);
    }
    return n;
  }

  /* Meses inteiros de calendário entre duas datas (conta o mês só
     quando o dia já passou). */
  function mesesEntre(de, ate) {
    if (!de || !ate) return 0;
    const a = new Date(de + 'T12:00:00'), b = new Date(ate + 'T12:00:00');
    let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    if (b.getDate() < a.getDate()) m--;
    return Math.max(0, m);
  }

  /* Nome de arquivo a partir de um rótulo: "Santander — filial CE"
     vira "santander-filial-ce". Acento e travessão fora, porque nome
     de arquivo com eles quebra em alguns sistemas. */
  const slug = s => String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sem-nome';

  /* Liga um campo de DATA a uma ação, sem atrapalhar quem digita.

     O navegador avisa de mudança assim que a data fica válida — e,
     ao digitar 01012026, ele passa por 01/01/0002, que é uma data
     válida. Se a tela se redesenha nesse instante, o campo é
     recriado, o foco se perde e o ano congela em 0002. A pessoa
     digitava certo e via a data errada.

     Aqui a ação só roda quando o ano é plausível, ou quando o campo
     perde o foco — o que cobre tanto quem digita quanto quem escolhe
     no calendário. */
  function ligarData(id, fn) {
    const e = document.getElementById(id);
    if (!e) return;
    const vale = function (v) {
      if (!v) return true;              // limpar o campo é uma ação legítima
      const ano = parseInt(String(v).slice(0, 4), 10);
      return ano >= 1900 && ano <= 2200;
    };
    e.addEventListener('change', function () {
      if (vale(this.value)) fn.call(this);
    });
    e.addEventListener('blur', function () {
      /* Saiu do campo com ano incompleto: a ação roda assim mesmo,
         senão o filtro ficaria para trás do que está na tela. */
      if (!vale(this.value)) fn.call(this);
    });
  }

  /* ── COLUNAS QUE CABEM NA TELA ─────────────────────────
     As colunas de número têm largura fixa e igual entre si — é o que
     permite comparar mês a mês sem o olho se perder. Com doze meses
     mais o total, porém, treze colunas de 96px não cabem em tela
     nenhuma, e a tabela passava a sair pela direita.

     A saída não é desistir da simetria: é escolher a largura comum
     PELO ESPAÇO QUE EXISTE. Mede-se o que a caixa tem, desconta-se o
     mínimo da coluna de descrição e divide-se o resto pelo número de
     colunas. Elas continuam todas iguais — só menores.

     E o piso de cada coluna não é um número escolhido: é o que o
     MAIOR VALOR da tabela mede naquela fonte. Chutar o piso cortava
     "-6.208.928,30" e a tabela voltava a sair pela direita — pior do
     que o defeito original, porque um número cortado mente. */
  const COL_PADRAO = { rel: 96, 'tab-resultado': 120 };
  /* Três degraus, do mais confortável ao mais apertado. Cada um só é
     usado se o anterior não couber: primeiro o tamanho de sempre,
     depois fonte e respiro menores, por último a descrição estreita.
     Nenhum deles corta número — quem encolhe é o espaço em volta. */
  const DEGRAUS = [
    { classe: '',                   desc: null },
    { classe: 'apertada',           desc: 150  },
    { classe: 'apertada muito',     desc: 110  }
  ];

  function ajustarColunas(raiz) {
    const onde = raiz && raiz.querySelectorAll ? raiz : document;
    Array.prototype.forEach.call(
      onde.querySelectorAll('table.rel, table.tab-resultado'), function (t) {
        const nums = t.querySelectorAll('thead th.num').length;
        if (!nums) return;
        const padrao = t.classList.contains('tab-resultado')
          ? COL_PADRAO['tab-resultado'] : COL_PADRAO.rel;
        const caixa = t.parentElement;
        const espaco = (caixa && caixa.clientWidth) || t.clientWidth || 0;
        if (!espaco) return;
        const th0 = t.querySelector('thead th');
        /* O mínimo da descrição é o que a própria tela pediu (o DRE
           gerencial pede 230px); sem pedido, 150px, que é onde um
           nome de conta ainda se lê. */
        const pedido = th0 ? (parseFloat(getComputedStyle(th0).minWidth) || 0) : 0;

        /* QUANTO O NÚMERO PRECISA, MEDIDO E NÃO ARBITRADO. Com a
           coluna espremida a 1px, o `scrollWidth` da célula é
           exatamente a largura que o maior valor pede naquela fonte.
           Uma largura escolhida no chute cortava "-6.208.928,30" e a
           tabela voltava a sair pela direita. */
        const precisaDe = function () {
          t.style.setProperty('--col-num', '1px');
          let maior = 0;
          Array.prototype.forEach.call(t.querySelectorAll('th.num, td.num'), function (c) {
            if (c.scrollWidth > maior) maior = c.scrollWidth;
          });
          return maior + 2;
        };

        let escolhido = null;
        for (let i = 0; i < DEGRAUS.length; i++) {
          const d = DEGRAUS[i];
          t.className = t.className.replace(/\s*\bapertada\b|\s*\bmuito\b/g, '') +
            (d.classe ? ' ' + d.classe : '');
          const minDesc = d.desc === null ? (pedido > 0 ? pedido : 150)
            : Math.min(pedido > 0 ? pedido : d.desc, d.desc);
          if (d.desc === null) t.style.removeProperty('--col-desc');
          else t.style.setProperty('--col-desc', minDesc + 'px');
          const cada = Math.floor((espaco - minDesc - 2) / nums);
          const precisa = precisaDe();
          const largura = Math.max(precisa, Math.min(padrao, cada));
          escolhido = { classe: d.classe, desc: d.desc, minDesc: minDesc, largura: largura };
          t.style.setProperty('--col-num', largura + 'px');
          /* Coube? Pronto — não se aperta o que já está confortável. */
          if (largura * nums + minDesc <= espaco) break;
        }
        /* Se nem o último degrau couber (tela de telefone com doze
           meses), fica o último: as colunas continuam iguais entre si
           e a caixa rola, que é melhor que número cortado. */
        if (escolhido) t.style.setProperty('--col-num', escolhido.largura + 'px');
      });
  }

  /* A mesma conta vale quando a janela muda de tamanho — senão a
     tabela nasce certa e fica errada ao primeiro arrasto. */
  let pendente = null;
  /* A bateria carrega este arquivo fora do navegador, com um `window`
     de mentira: sem a conferência, o módulo inteiro deixa de carregar
     e 1.771 verificações param por causa de um ouvinte de tela. */
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('resize', function () {
      clearTimeout(pendente);
      pendente = setTimeout(function () { ajustarColunas(); }, 120);
    });
  }

  return {
    ligarData: ligarData,
    ajustarColunas: ajustarColunas,
    slug,
    mesesEntre,
    diasUteis, brl, num, parseValor, hoje, mesAtual, dataLocal, fData, fDataHora, pct, fComp, addMeses, addDias, compDe, diasEntre, el, val, setVal, esc, baixar, tabelaParaCSV, so, cnpj,
    cnpjValido, cpfValido, documentoNormalizado };
})();
