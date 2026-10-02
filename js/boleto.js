/* ERP · boleto.js — código de barras de boleto e de arrecadação.

   Serve para o lançamento: o financeiro passa o leitor no boleto (ou
   digita a linha digitável) e o sistema já valida, extrai vencimento e
   valor e guarda o código de 44 posições, que é o que vai no arquivo de
   remessa (Segmento J, no caso de título bancário).

   Leitor de código de barras USB se comporta como teclado: ele "digita"
   os números no campo e dá Enter. Por isso o campo aceita os dois
   formatos e limpa qualquer pontuação sozinho.

   Módulo puro: nenhuma dependência da tela ou do banco de dados. */
window.ERP = window.ERP || {};

ERP.boleto = (function () {

  const so = s => String(s == null ? '' : s).replace(/\D/g, '');

  /* ── dígito verificador ─────────────────────────────────*/
  // módulo 11 do código de barras (posição 5 é o próprio DV)
  function dvBarras(cod44) {
    const base = cod44.slice(0, 4) + cod44.slice(5);
    let peso = 2, soma = 0;
    for (let i = base.length - 1; i >= 0; i--) {
      soma += (+base[i]) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    const r = 11 - (soma % 11);
    return (r === 0 || r === 10 || r === 11) ? 1 : r;
  }

  // módulo 10, usado nos campos da linha digitável
  function dvMod10(bloco) {
    let soma = 0, mult = 2;
    for (let i = bloco.length - 1; i >= 0; i--) {
      let x = (+bloco[i]) * mult;
      if (x > 9) x -= 9;
      soma += x;
      mult = mult === 2 ? 1 : 2;
    }
    return (10 - (soma % 10)) % 10;
  }

  /* ── linha digitável (47) -> código de barras (44) ──────*/
  function linhaParaBarras(linha) {
    const l = so(linha);
    if (l.length !== 47) return null;
    const banco = l.slice(0, 3), moeda = l.slice(3, 4), dv = l.slice(32, 33);
    const livre = l.slice(4, 9) + l.slice(10, 20) + l.slice(21, 31);
    const fatorValor = l.slice(33, 47);
    return banco + moeda + dv + fatorValor + livre;
  }

  /* ── fator de vencimento -> data ────────────────────────
     A base é 07/10/1997. Em 22/02/2025 o fator estourou 9999 e
     reiniciou em 1000, então há duas datas possíveis para o mesmo
     fator: fica a que cai perto de hoje. */
  function dataDoFator(fator) {
    const f = parseInt(fator, 10);
    if (!f) return '';
    const dia = 86400000;
    const cand = [
      new Date(Date.UTC(1997, 9, 7) + f * dia),
      new Date(Date.UTC(2025, 1, 22) + (f - 1000) * dia)
    ].filter(function (d) { return !isNaN(d.getTime()); });
    const hoje = Date.now();
    cand.sort(function (a, b) { return Math.abs(a - hoje) - Math.abs(b - hoje); });
    return cand[0].toISOString().slice(0, 10);
  }

  /* ── leitura ────────────────────────────────────────────*/
  function ler(entrada) {
    const n = so(entrada);
    if (!n) return { erro: 'Informe a linha digitável ou passe o leitor no código de barras.' };

    // arrecadação (concessionária/tributo): começa com 8, tem 44 ou 48 dígitos
    if (n.charAt(0) === '8') {
      if (n.length !== 44 && n.length !== 48) {
        return { erro: 'Código de arrecadação deve ter 44 (barras) ou 48 (linha digitável) dígitos; veio ' + n.length + '.' };
      }
      const barras = n.length === 48
        ? n.slice(0, 11) + n.slice(12, 23) + n.slice(24, 35) + n.slice(36, 47)
        : n;
      const valor = parseInt(barras.slice(4, 15), 10) / 100;
      return {
        tipo: 'arrecadacao', codigoBarras: barras,
        valor: valor || 0, vencimento: '',
        aviso: 'Guia de arrecadação: no arquivo bancário ela vai em outro segmento, não junto dos boletos.'
      };
    }

    let barras;
    if (n.length === 47) {
      barras = linhaParaBarras(n);
      // confere os DVs dos três campos da linha digitável
      const campos = [[n.slice(0, 9), n.slice(9, 10)], [n.slice(10, 20), n.slice(20, 21)], [n.slice(21, 31), n.slice(31, 32)]];
      const ruim = campos.filter(function (c) { return dvMod10(c[0]) !== +c[1]; }).length;
      if (ruim) return { erro: 'Linha digitável com dígito verificador errado — confira a digitação.' };
    } else if (n.length === 44) {
      barras = n;
    } else {
      return { erro: 'Um boleto bancário tem 47 dígitos na linha digitável ou 44 no código de barras; veio ' + n.length + '.' };
    }

    if (dvBarras(barras) !== +barras.charAt(4)) {
      return { erro: 'Código de barras inválido (dígito verificador geral não fecha).' };
    }

    const valor = parseInt(barras.slice(9, 19), 10) / 100;
    return {
      tipo: 'boleto',
      codigoBarras: barras,
      linhaDigitavel: n.length === 47 ? n : '',
      banco: barras.slice(0, 3),
      vencimento: dataDoFator(barras.slice(5, 9)),
      valor: valor || 0
    };
  }

  // formata a linha digitável para leitura humana
  function formatar(linha) {
    const l = so(linha);
    if (l.length !== 47) return l;
    return l.slice(0, 5) + '.' + l.slice(5, 10) + ' ' + l.slice(10, 15) + '.' + l.slice(15, 21) +
      ' ' + l.slice(21, 26) + '.' + l.slice(26, 32) + ' ' + l.slice(32, 33) + ' ' + l.slice(33);
  }

  return { ler: ler, linhaParaBarras: linhaParaBarras, dataDoFator: dataDoFator, formatar: formatar };
})();
