/* ERP · rps-barueri.js — arquivo de RPS em lote (Prefeitura de Barueri).

   Por que este caminho e não um robô no portal: o portal aceita
   ARQUIVO de RPS e converte em NF-e. É o caminho oficial, roda sem
   guardar senha nossa em lugar nenhum, não quebra quando a prefeitura
   mexe no HTML, e deixa rastro (arquivo enviado, protocolo, retorno).
   Um agente clicando no portal logado seria mais frágil e mais
   arriscado — inclusive porque emitir nota é ato fiscal em nome da
   empresa.

   Layout: "Alterações Layout Arquivo Texto RPS V4.4", versão PMB004,
   texto posicional, ISO-8859-1, linhas terminadas em CRLF.
     tipo 1 — cabeçalho (inscrição, versão, identificação da remessa)
     tipo 2 — o RPS (serviço, valores, tomador, discriminação)
     tipo 3 — retenções (IRRF, PIS, COFINS, CSLL, INSS), uma por linha
     tipo 4 — dados do Ambiente de Dados Nacional (IBGE, NBS, IBS/CBS)
     tipo 9 — rodapé (contagem de linhas e somatórios)

   Os códigos fiscais (serviço, NBS, indicador de operação,
   classificação tributária) ficam no cadastro da empresa: são eles que
   o validador da prefeitura recusa primeiro, e mudam por decisão da
   contabilidade, não do sistema. */
window.ERP = window.ERP || {};

ERP.rpsBarueri = (function () {
  const U = () => ERP.util;

  /* ── formatação posicional ──────────────────────────────*/
  /* Tira acento e troca o que não existe em Latin-1 (travessão, aspas
     curvas, reticências) por equivalente ASCII: um caractere fora da
     tabela vira byte errado e desloca a linha posicional inteira. */
  const semAcento = s => String(s === null || s === undefined ? '' : s)
    .replace(/[\u2010-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"').replace(/\u2026/g, '...')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\xFF]/g, ' ');
  /* Texto: à esquerda, completado com espaço, cortado no tamanho. */
  const txt = (v, n) => semAcento(v).toUpperCase().slice(0, n).padEnd(n, ' ');
  /* Número: à direita, completado com zero. */
  const num = (v, n) => String(v === null || v === undefined ? '' : v)
    .replace(/\D/g, '').slice(-n).padStart(n, '0');
  /* Valor: centavos sem vírgula nem ponto. R$ 10,25 → 000000000001025 */
  const val = (v, n) => num(Math.round((Number(v) || 0) * 100), n || 15);
  const vazio = n => ''.padEnd(n, ' ');
  const data8 = d => String(d || '').replace(/\D/g, '').slice(0, 8);

  /* A discriminação é impressa num retângulo de 100 colunas por 13
     linhas, com "|" marcando a quebra — o manual exige a barra a cada
     100 caracteres. */
  function discriminacao(texto) {
    const limpo = semAcento(texto).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    const linhas = [];
    for (let i = 0; i < limpo.length && linhas.length < 13; i += 100) {
      linhas.push(limpo.slice(i, i + 100));
    }
    return txt(linhas.join('|'), 1000);
  }

  /* ── o que falta pra emitir ─────────────────────────────
     Melhor recusar aqui, com a lista do que falta, do que mandar o
     arquivo e receber a rejeição da prefeitura em código. */
  function pendencias(item, empresa) {
    const p = [];
    const e = empresa || {};
    if (!e.inscricao_municipal) p.push('inscrição municipal da empresa');
    if (!(e.rps || {}).codigo_servico) p.push('código do serviço prestado');
    if (!item.tomador_documento) p.push('CNPJ/CPF do tomador');
    if (!item.tomador_nome) p.push('razão social do tomador');
    if (!item.tomador_endereco) p.push('endereço do tomador');
    if (!item.tomador_cidade) p.push('cidade do tomador');
    if (!item.tomador_uf) p.push('UF do tomador');
    if (!item.tomador_cep) p.push('CEP do tomador');
    if (!item.tomador_ibge) p.push('código IBGE da cidade do tomador');
    if (String(item.tomador_documento || '').replace(/\D/g, '').length === 14 && !item.tomador_email) {
      p.push('e-mail do tomador (obrigatório para pessoa jurídica)');
    }
    if (!(item.valor > 0)) p.push('valor do serviço');
    if (!item.discriminacao) p.push('discriminação do serviço');
    return p;
  }

  /* ── registros ──────────────────────────────────────────*/
  function cabecalho(empresa, remessa) {
    return '1' +
      txt(empresa.inscricao_municipal, 7) +
      txt('PMB004', 6) +
      num(remessa, 11);
  }

  function registroRps(item, empresa, numeroRps) {
    const r = empresa.rps || {};
    const doc = String(item.tomador_documento || '').replace(/\D/g, '');
    const pj = doc.length === 14;
    /* Quantidade é inteira e o valor do serviço é UNITÁRIO: com
       quantidade 1 o unitário é o total, que é o caso de medição
       médica e de locação mensal. */
    return '2' +
      txt('RPS', 5) +
      txt(r.serie || '', 4) +
      txt(r.serie_nfe || '', 5) +
      num(numeroRps, 10) +
      data8(item.data) +
      num((item.hora || '090000'), 6) +
      txt('E', 1) +                       // enviado (C seria cancelamento)
      vazio(2) +                          // motivo de cancelamento
      num('', 7) +                        // NF-e a cancelar
      vazio(5) + vazio(8) + vazio(180) +  // série, data e descrição do cancelamento
      num(r.codigo_servico, 9) +
      txt(r.local_prestacao || '1', 1) +
      txt('2', 1) +                       // não é serviço em via pública
      vazio(75) + vazio(9) + vazio(30) + vazio(40) + vazio(40) + vazio(2) + num('', 8) +
      num(item.quantidade || 1, 6) +
      val(item.valor, 15) +
      num('', 5) +                        // alíquota fora do município
      val(item.retencoes_total || 0, 15) +
      txt('2', 1) +                       // tomador brasileiro
      num('', 3) +                        // país (só estrangeiro)
      txt('2', 1) +                       // não é exportação
      txt(pj ? '2' : '1', 1) +
      txt(doc, 14) +
      txt(item.tomador_nome, 60) +
      txt(item.tomador_endereco, 75) +
      txt(item.tomador_numero || 'S/N', 9) +
      txt(item.tomador_complemento || '', 30) +
      txt(item.tomador_bairro || '', 40) +
      txt(item.tomador_cidade, 40) +
      txt(item.tomador_uf, 2) +
      num(item.tomador_cep, 8) +
      txt(item.tomador_email || '', 152) +
      num(item.fatura || '', 6) +
      (item.fatura ? val(item.valor, 15) : num('', 15)) +
      txt(item.fatura ? (item.forma_pagamento || 'DEPOSITO') : '', 15) +
      discriminacao(item.discriminacao);
  }

  /* Uma linha por retenção, e só quando há valor. */
  /* O registro 3 só tem código para os tributos FEDERAIS. O ISS não
     entra aqui: em Barueri, a retenção do ISS decorre do código do
     serviço e da natureza do tomador, não de um campo do arquivo. Por
     isso o ISS do cadastro do cliente continua valendo para o líquido
     do contas a receber, mas fica fora do RPS. */
  const CODIGO_RETENCAO = { IRRF: '01', IR: '01', PIS: '02', COFINS: '03', CSLL: '04',
    INSS: '05', PREVIDENCIA: '05' };
  function registrosRetencao(item) {
    const out = [];
    (item.retencoes || []).forEach(function (rt) {
      const cod = CODIGO_RETENCAO[String(rt.tributo || '').toUpperCase()];
      if (!cod || !(rt.valor > 0)) return;
      out.push('3' + txt(cod, 2) + val(rt.valor, 15));
    });
    return out;
  }

  /* Só os federais somam no "Valor Total das Retenções" do registro 2 e
     no rodapé — pela mesma razão. */
  const totalRetencoesFederais = item => Math.round((item.retencoes || []).reduce(function (a, rt) {
    return a + (CODIGO_RETENCAO[String(rt.tributo || '').toUpperCase()] ? (rt.valor || 0) : 0);
  }, 0) * 100) / 100;

  /* Registro do Ambiente de Dados Nacional: não apura nada, mas sem ele
     a prefeitura não aceita mais (obrigatório desde 2026). */
  function registroAdn(item, empresa) {
    const r = empresa.rps || {};
    return '4' +
      num(empresa.simples_nacional || 1, 1) +
      vazio(1) +                          // regime do Simples (só optante ME/EPP)
      num('', 3) +                        // país do local da prestação
      num(item.ibge_prestacao || empresa.codigo_ibge, 7) +
      num(item.tomador_ibge, 7) +
      txt('', 40) +                       // NIF (estrangeiro)
      num(r.nbs, 9) +
      txt('', 11) + txt('', 60) +         // endereço postal e região do tomador estrangeiro
      vazio(1) +                          // vínculo entre as partes
      vazio(30) +                         // reservado
      txt('', 11) + txt('', 60) +         // serviço no exterior
      txt('', 255) + vazio(8) + vazio(8) +// evento (só atividades do item 12)
      vazio(1) +                          // justificativa de substituição
      num(r.ind_operacao, 6) +
      num(r.class_trib, 6) +
      num(r.sit_trib, 3) +
      num(0, 1) +                         // não é uso ou consumo pessoal
      num(0, 1);                          // destinatário é o próprio tomador
  }

  function rodape(linhas, totalServicos, totalRetencoes) {
    return '9' + num(linhas, 7) + val(totalServicos, 15) + val(totalRetencoes, 15);
  }

  /* ── montagem do lote ───────────────────────────────────*/
  function gerar(itens, empresa, opcoes) {
    opcoes = opcoes || {};
    const e = empresa || {};
    if (!itens || !itens.length) return { erro: 'Nenhum RPS para gerar.' };

    const problemas = [];
    itens.forEach(function (i, k) {
      const p = pendencias(i, e);
      if (p.length) problemas.push({ indice: k, item: i, falta: p });
    });
    if (problemas.length) return { erro: 'Faltam dados obrigatórios.', problemas: problemas };

    const inicio = opcoes.numero_inicial || 1;
    const linhas = [cabecalho(e, opcoes.remessa || (U().hoje().replace(/-/g, '') + '001'))];
    let totalServicos = 0, totalRetencoes = 0;
    const rpsGerados = [];

    itens.forEach(function (item, k) {
      const numeroRps = inicio + k;
      const retTotal = totalRetencoesFederais(item);
      const comTotal = Object.assign({}, item, { retencoes_total: retTotal });
      linhas.push(registroRps(comTotal, e, numeroRps));
      registrosRetencao(comTotal).forEach(function (l) { linhas.push(l); });
      linhas.push(registroAdn(comTotal, e));
      totalServicos += (item.valor || 0) * (item.quantidade || 1);
      totalRetencoes += retTotal;
      rpsGerados.push({ numero: numeroRps, referencia: item.referencia || null,
        valor: item.valor, tomador: item.tomador_nome });
    });

    linhas.push(rodape(linhas.length + 1, totalServicos, totalRetencoes));
    /* CRLF no fim de TODAS as linhas, inclusive a última — o manual
       trata o fim de linha como campo do registro. */
    return {
      ok: true,
      conteudo: linhas.join('\r\n') + '\r\n',
      rps: rpsGerados,
      total_servicos: Math.round(totalServicos * 100) / 100,
      total_retencoes: Math.round(totalRetencoes * 100) / 100,
      linhas: linhas.length
    };
  }

  /* O arquivo tem que sair em ISO-8859-1 (Latin-1), não em UTF-8: o
     validador da prefeitura lê byte a byte por posição, e um acento em
     dois bytes desloca a linha inteira. Como já tiramos os acentos, a
     conversão é direta. */
  function baixar(nome, conteudo) {
    const bytes = new Uint8Array(conteudo.length);
    for (let i = 0; i < conteudo.length; i++) bytes[i] = conteudo.charCodeAt(i) & 0xFF;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'text/plain;charset=ISO-8859-1' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  return { gerar: gerar, baixar: baixar, pendencias: pendencias, discriminacao: discriminacao,
    totalRetencoesFederais: totalRetencoesFederais };
})();
