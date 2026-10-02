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
  function cnpj(v) {
    const d = so(v);
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

  return {
    slug,
    mesesEntre,
    diasUteis, brl, num, parseValor, hoje, mesAtual, dataLocal, fData, fDataHora, pct, fComp, addMeses, addDias, compDe, diasEntre, el, val, setVal, esc, baixar, tabelaParaCSV, so, cnpj };
})();
