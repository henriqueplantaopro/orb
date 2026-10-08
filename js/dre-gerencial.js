/* DRE GERENCIAL — o resultado do jeito que a empresa lê.

   ESTE ARQUIVO É COMPARTILHADO entre o ERP e o aplicativo de celular,
   byte a byte. Não é cópia que se deixa divergir: há um teste que
   compara os dois arquivos e falha se um mudar sem o outro. A razão
   é simples — se o computador e o telefone calcularem o lucro de
   formas diferentes, o número deixa de servir para decidir qualquer
   coisa, e ninguém vai saber qual dos dois está certo.

   Por isso ele não depende do store, nem do Supabase, nem do DOM:
   recebe listas e devolve números. O ERP passa o que tem na memória;
   o aplicativo passa o que leu do banco.

   ─────────────────────────────────────────────────────────────

   O QUE ELE CALCULA, LINHA A LINHA

   Receita bruta        o que foi faturado (ou recebido, no caixa)
   (−) Impostos         retenção na fonte + imposto próprio
   (−) Custo direto     repasse médico e locação; nos projetos de
                        equipamento, a depreciação mensal — um bem de
                        R$ 360.000 em 36 meses custa R$ 10.000/mês ao
                        projeto onde está, mesmo sem nota nenhuma
   (−) Despesas diretas o que foi lançado NAQUELE projeto
   (−) Despesas gerais  o que não é de projeto nenhum (matriz, filial,
                        sem centro), RATEADO pelo faturamento
   = Lucro

   E, abaixo da linha, os INVESTIMENTOS do período — que não são
   despesa e não entram no lucro, mas explicam por que um mês de
   R$ 500.000 de lucro pode não ter deixado caixa: se foram
   R$ 450.000 em equipamento novo, o dinheiro está lá, virado em bem.

   ─────────────────────────────────────────────────────────────

   OS DOIS REGIMES

   COMPETÊNCIA — o mês a que o fato pertence. É o DRE principal: diz
   se a operação daquele mês deu lucro, independentemente de quando
   o dinheiro andou.

   CAIXA — o mês em que o dinheiro entrou ou saiu de verdade. Serve
   para outra pergunta: sobrou dinheiro? A depreciação NÃO entra no
   caixa, porque não é desembolso — o desembolso foi na compra, e
   aparece em investimentos. */

(function (raiz) {
  'use strict';

  /* Dinheiro em centavos, sempre. Somar float direto acumula erro e
     o total deixa de bater com a soma das partes na terceira casa —
     numa DRE de R$ 46 milhões isso vira dezenas de reais de
     diferença entre a linha e o detalhe que a compõe. */
  const cent = v => Math.round((Number(v) || 0) * 100);
  const real = c => Math.round(c) / 100;

  /* Número no formato da casa: 00.000,00, sempre, em qualquer
     aparelho. `toLocaleString` olha para a configuração do
     telefone; num celular em inglês o mesmo relatório sairia com
     ponto e vírgula trocados, e "1.234" passaria a querer dizer
     outra coisa. Num número que decide pagamento, essa ambiguidade
     não cabe. */
  function fmt(v) {
    const neg = v < 0;
    const x = Math.abs(Math.round((Number(v) || 0) * 100)) / 100;
    const inteiro = Math.floor(x);
    const dec = String(Math.round((x - inteiro) * 100)).padStart(2, '0');
    let s = String(inteiro), out = '';
    while (s.length > 3) { out = '.' + s.slice(-3) + out; s = s.slice(0, -3); }
    return (neg ? '-' : '') + s + out + ',' + dec;
  }

  function mesesEntre(de, ate) {
    const saida = [];
    if (!de || !ate || ate < de) return saida;
    let [a, m] = de.split('-').map(Number);
    const [af, mf] = ate.split('-').map(Number);
    let guarda = 0;
    while ((a < af || (a === af && m <= mf)) && guarda++ < 120) {
      saida.push(a + '-' + String(m).padStart(2, '0'));
      m++; if (m > 12) { m = 1; a++; }
    }
    return saida;
  }

  const compDe = d => (d ? String(d).slice(0, 7) : '');

  /* ── quem é quem ─────────────────────────────────────────
     Centro administrativo (matriz, filial, geral) NÃO é projeto: o
     que cai nele é despesa da casa, e a casa serve todos os
     projetos. É essa distinção que separa "despesa direta" de
     "despesa geral", e ela não existia em lugar nenhum do sistema —
     cada tela decidia por conta própria. */
  const TIPOS_ADMIN = ['geral', 'matriz', 'filial'];
  const ehProjeto = c => !!c && c.tipo === 'projeto';
  const ehAdmin = c => !!c && TIPOS_ADMIN.indexOf(c.tipo) >= 0;

  function indexar(lista, chave) {
    const m = {};
    (lista || []).forEach(function (x) { if (x && x[chave || 'id'] != null) m[x[chave || 'id']] = x; });
    return m;
  }

  /* O grupo de nível 1 a que a conta pertence: 6.07 → 6. Aceita o
     campo `pai` quando existe e deduz do código quando não — bancos
     antigos não têm a coluna preenchida. */
  function grupoDa(cod, plano) {
    if (!cod) return '';
    const c = (plano || []).find(function (x) { return x.cod === cod; });
    if (c && c.pai) return String(c.pai);
    return String(cod).split('.')[0];
  }

  function tipoDoGrupo(g, plano) {
    const raizConta = (plano || []).find(function (x) { return x.cod === String(g) && x.nivel === 1; });
    return raizConta ? raizConta.tipo : '';
  }

  const nomeConta = (cod, plano) => {
    const c = (plano || []).find(function (x) { return x.cod === cod; });
    return c ? (cod + ' ' + c.nome) : (cod || 'sem natureza');
  };

  /* ── o rateio de uma parcela entre centros ───────────────
     Mesma divisão que o resto do sistema usa, com a sobra de
     centavos na última parte: 1 dividido em três 33,33/33,33/33,34
     fecha em 1, não em 0,9999. */
  function partes(par) {
    const total = cent(par.valor);
    const r = (par.rateio && par.rateio.length)
      ? par.rateio
      : [{ centro: par.centro, pct: 100 }];
    let usado = 0;
    return r.map(function (x, i) {
      const v = i === r.length - 1
        ? total - usado
        : Math.round(total * (Number(x.pct) || 0) / 100);
      usado += v;
      return { centro: x.centro, cent: v };
    });
  }

  /* ─────────────────────────────────────────────────────────
     CALCULAR

     dados  = { parcelas, pagamentos, receber, centros, clientes,
                plano, ativos }
     filtro = { de:'AAAA-MM', ate:'AAAA-MM', regime:'competencia'|'caixa',
                centros:[ids], cliente:'id' }
     ───────────────────────────────────────────────────────── */
  function calcular(dados, filtro) {
    dados = dados || {}; filtro = filtro || {};
    const plano = dados.plano || [];
    const centros = dados.centros || [];
    const porId = indexar(centros);
    const caixa = filtro.regime === 'caixa';
    const meses = mesesEntre(filtro.de, filtro.ate);
    if (!meses.length) {
      return { meses: [], linhas: [], investimentos: null, erro: 'Período inválido.' };
    }
    const dentro = m => meses.indexOf(m) >= 0;

    /* QUAIS PROJETOS ESTÃO EM FOCO.

       Sem seleção: a empresa inteira. Com cliente: todos os projetos
       daquele cliente (o AGIR com seus quatro projetos). Com
       projetos: só eles. */
    let alvo = null;   // null = empresa inteira
    if (filtro.centros && filtro.centros.length) {
      alvo = filtro.centros.slice();
    } else if (filtro.cliente) {
      alvo = centros.filter(function (c) { return c.cliente === filtro.cliente; })
        .map(function (c) { return c.id; });
      if (!alvo.length) alvo = ['__nenhum__'];
    }
    const noAlvo = id => !alvo || alvo.indexOf(id) >= 0;

    /* ── 1. RECEITA ─────────────────────────────────────────
       Competência: a nota pertence ao mês que ela cobre.
       Caixa: cada baixa pertence ao mês em que o dinheiro entrou —
       uma nota de agosto recebida em outubro é receita de outubro. */
    const receita = {}, retido = {};
    const detReceita = {};
    meses.forEach(function (m) { receita[m] = 0; retido[m] = 0; detReceita[m] = []; });

    /* O faturamento POR PROJETO do período inteiro é a base do
       rateio das despesas gerais. Ele é calculado sobre a empresa
       TODA, não só sobre o alvo — senão, ao filtrar um projeto, ele
       receberia 100% da despesa da matriz. */
    const fatPorCentro = {};        // centro -> {mes -> centavos}
    const fatMes = {};              // mes -> centavos (empresa inteira)
    meses.forEach(function (m) { fatMes[m] = 0; });

    (dados.receber || []).forEach(function (r) {
      if (['cancelado', 'substituido'].indexOf(r.status) >= 0) return;
      if (r.conferir) return;
      if (['nota', 'fatura', 'avulso'].indexOf(r.origem) < 0) return;

      /* A receita pode estar rateada entre projetos (nota única do
         HGB cobrindo várias especialidades). */
      const linhas = (r.rateio_centros && r.rateio_centros.length)
        ? r.rateio_centros.map(function (x) {
            return { centro: x.centro, pct: Number(x.pct) || 0 };
          })
        : [{ centro: r.centro, pct: 100 }];

      const lancar = function (mes, brutoCent, retidoCent, rotulo) {
        if (!dentro(mes)) return;
        let usadoB = 0, usadoR = 0;
        linhas.forEach(function (l, i) {
          const b = i === linhas.length - 1 ? brutoCent - usadoB : Math.round(brutoCent * l.pct / 100);
          const q = i === linhas.length - 1 ? retidoCent - usadoR : Math.round(retidoCent * l.pct / 100);
          usadoB += b; usadoR += q;
          fatPorCentro[l.centro] = fatPorCentro[l.centro] || {};
          fatPorCentro[l.centro][mes] = (fatPorCentro[l.centro][mes] || 0) + b;
          fatMes[mes] += b;
          if (!noAlvo(l.centro)) return;
          receita[mes] += b;
          retido[mes] += q;
          detReceita[mes].push({
            rotulo: rotulo || ((r.cliente_nome || '') + (r.numero ? ' · NF ' + r.numero : '')),
            centro: l.centro,
            centro_nome: (porId[l.centro] || {}).curto || (porId[l.centro] || {}).nome || '—',
            valor: real(b)
          });
        });
      };

      if (!caixa) {
        lancar(r.competencia, cent(r.valor_bruto), cent(r.valor_retido), null);
      } else {
        const bx = (r.baixas || []).filter(function (b) { return b && !b.estornada && b.data; });
        if (bx.length) {
          bx.forEach(function (b) {
            lancar(compDe(b.data), cent(b.valor), 0,
              (r.cliente_nome || '') + ' · recebido ' + String(b.data).slice(0, 10));
          });
        } else if (r.valor_recebido > 0 && r.recebido_em) {
          /* Título antigo, recebido antes de o sistema guardar baixa
             a baixa. O valor existe; só a data detalhada não. */
          lancar(compDe(r.recebido_em), cent(r.valor_recebido), 0,
            (r.cliente_nome || '') + ' · recebido');
        }
      }
    });

    /* ── 2. DESPESAS, por natureza e por centro ─────────────
       A parcela é a unidade: ela tem conta (natureza) e centro (ou
       rateio entre centros). Cada pedaço vai para a sua linha. */
    const imposto = {}, custo = {}, direta = {}, geral = {};
    const detImposto = {}, detCusto = {}, detDireta = {}, detGeral = {};
    meses.forEach(function (m) {
      imposto[m] = 0; custo[m] = 0; direta[m] = 0; geral[m] = 0;
      detImposto[m] = []; detCusto[m] = []; detDireta[m] = []; detGeral[m] = [];
    });
    /* Despesa geral do período, antes do rateio. */
    const geralBruta = {};
    meses.forEach(function (m) { geralBruta[m] = 0; });
    const detGeralBruta = {};
    meses.forEach(function (m) { detGeralBruta[m] = []; });

    /* No caixa, o que vale é o pagamento; na competência, a parcela.
       O índice abaixo liga um ao outro. */
    const pagosPorParcela = {};
    if (caixa) {
      (dados.pagamentos || []).forEach(function (pg) {
        if (!pg || pg.estornado) return;
        if (pg.situacao !== 'liquidado') return;
        (pagosPorParcela[pg.parcela_id] = pagosPorParcela[pg.parcela_id] || []).push(pg);
      });
    }

    (dados.parcelas || []).forEach(function (p) {
      if (!p || ['cancelado', 'substituido'].indexOf(p.status) >= 0) return;
      /* Previsão não é fato: entra no fluxo de caixa projetado, não
         no resultado. */
      if (p.status === 'previsto') return;

      const grupo = grupoDa(p.conta, plano);
      const tipo = tipoDoGrupo(grupo, plano);
      if (tipo === 'receita') return;              // receita vem do a receber
      if (tipo === 'nao_operacional') return;      // aporte e retirada não são resultado

      /* Em que mês, e quanto. */
      const eventos = [];
      if (!caixa) {
        eventos.push({ mes: p.comp, cent: cent(p.valor), rotulo: '' });
      } else {
        (pagosPorParcela[p.id] || []).forEach(function (pg) {
          eventos.push({
            mes: compDe(pg.data),
            /* Juros e multa são custo real do atraso e saem do caixa
               junto; desconto obtido reduz o desembolso. */
            cent: cent(pg.valor) + cent(pg.juros) + cent(pg.multa),
            rotulo: ' · pago ' + String(pg.data).slice(0, 10)
          });
        });
      }

      eventos.forEach(function (ev) {
        if (!dentro(ev.mes)) return;
        /* Divide a parcela entre os centros na mesma proporção do
           rateio, qualquer que seja o valor do evento (um pagamento
           parcial divide igual). */
        const prop = partes(p);
        const totalParcela = prop.reduce(function (s, x) { return s + x.cent; }, 0) || 1;
        let usado = 0;
        prop.forEach(function (parte, i) {
          const v = i === prop.length - 1
            ? ev.cent - usado
            : Math.round(ev.cent * parte.cent / totalParcela);
          usado += v;
          const c = porId[parte.centro];
          const item = {
            rotulo: (p.descricao || '') + ev.rotulo,
            conta: p.conta, conta_nome: nomeConta(p.conta, plano),
            centro: parte.centro,
            centro_nome: c ? (c.curto || c.nome) : 'sem projeto',
            valor: real(v)
          };

          if (tipo === 'deducao') {
            if (!noAlvo(parte.centro) && alvo) return;
            imposto[ev.mes] += v; detImposto[ev.mes].push(item);
            return;
          }
          if (tipo === 'custo') {
            if (alvo && !noAlvo(parte.centro)) return;
            custo[ev.mes] += v; detCusto[ev.mes].push(item);
            return;
          }
          /* Despesa: direta quando cai num PROJETO; geral quando cai
             na casa (matriz, filial, geral) ou em centro nenhum. */
          if (ehProjeto(c)) {
            if (alvo && !noAlvo(parte.centro)) return;
            direta[ev.mes] += v; detDireta[ev.mes].push(item);
          } else {
            /* Vai para o bolo que será rateado — inclusive quando há
               filtro, porque a fatia do projeto sai do bolo inteiro. */
            geralBruta[ev.mes] += v;
            detGeralBruta[ev.mes].push(item);
          }
        });
      });
    });

    /* Retenção na fonte é imposto sobre a venda: entra na mesma
       linha do imposto próprio.

       SÓ NA COMPETÊNCIA. No caixa, a receita já entra pelo valor
       RECEBIDO, que é o líquido — a retenção nunca passou pela
       conta. Somá-la ali seria descontar o mesmo imposto duas
       vezes: uma na receita menor, outra na linha de imposto.
       (`retido` fica zerado no caixa, mas a guarda abaixo diz o
       porquê para quem ler.) */
    meses.forEach(function (m) {
      if (caixa) return;
      if (retido[m] > 0) {
        imposto[m] += retido[m];
        detImposto[m].push({ rotulo: 'Retenções na fonte sobre as notas do mês',
          conta: '', conta_nome: 'retenção na fonte', centro: '', centro_nome: '—',
          valor: real(retido[m]) });
      }
    });

    /* ── 3. DEPRECIAÇÃO como custo do projeto ───────────────
       Só na competência. No caixa não entra: o dinheiro saiu na
       compra, e a compra aparece em investimentos. Contá-la nos dois
       seria pagar o equipamento duas vezes. */
    if (!caixa && dados.depreciacaoPorProjeto) {
      meses.forEach(function (m) {
        (dados.depreciacaoPorProjeto(m) || []).forEach(function (d) {
          if (alvo && !noAlvo(d.centro)) return;
          const c = porId[d.centro];
          custo[m] += cent(d.valor);
          detCusto[m].push({
            rotulo: 'Depreciação de equipamento alocado' +
              (d.itens && d.itens.length ? ' (' + d.itens.length + ' item(ns))' : ''),
            conta: '', conta_nome: 'depreciação (não é desembolso)',
            centro: d.centro, centro_nome: c ? (c.curto || c.nome) : '—',
            valor: d.valor
          });
        });
      });
    }

    /* ── 4. RATEIO DAS DESPESAS GERAIS ──────────────────────
       Pelo faturamento de cada projeto no mês. É a régua que a
       empresa já usa para pensar: quem fatura mais sustenta mais da
       estrutura.

       Mês sem faturamento nenhum não tem como ratear — a despesa
       geral fica inteira no resultado da empresa e, com filtro de
       projeto, não é atribuída a ninguém. Fingir uma divisão por
       igual ali inventaria custo num projeto que talvez nem
       existisse no mês. */
    const rateio = {};
    meses.forEach(function (m) {
      const bolo = geralBruta[m];
      if (!bolo) { rateio[m] = { pct: alvo ? 0 : 100, base: fatMes[m] }; geral[m] = 0; return; }
      if (!alvo) {
        geral[m] = bolo;
        detGeral[m] = detGeralBruta[m];
        rateio[m] = { pct: 100, base: fatMes[m] };
        return;
      }
      const fatAlvo = alvo.reduce(function (s, id) {
        return s + ((fatPorCentro[id] || {})[m] || 0);
      }, 0);
      const pct = fatMes[m] > 0 ? fatAlvo / fatMes[m] : 0;
      geral[m] = Math.round(bolo * pct);
      rateio[m] = {
        pct: Math.round(pct * 10000) / 100,
        base: real(fatAlvo), total: real(fatMes[m])
      };
      /* O detalhe mostra a despesa inteira e a fatia que coube —
         sem isso, a pessoa vê "aluguel R$ 2.000" num projeto e não
         entende de onde saiu. */
      detGeral[m] = detGeralBruta[m].map(function (i) {
        return Object.assign({}, i, {
          valor: Math.round(cent(i.valor) * pct) / 100,
          rotulo: i.rotulo + ' (' + (Math.round(pct * 1000) / 10) + '% de ' + fmt(i.valor) + ')'
        });
      });
    });

    /* ── 5. LUCRO ───────────────────────────────────────────*/
    const lucro = {};
    meses.forEach(function (m) {
      lucro[m] = receita[m] - imposto[m] - custo[m] - direta[m] - geral[m];
    });

    /* ── 6. INVESTIMENTOS ───────────────────────────────────
       Equipamento comprado no período. Não é despesa e não entra no
       lucro — mas é dinheiro que saiu, e é a resposta para "o mês
       deu lucro, cadê o caixa?". */
    const invest = {}, detInvest = {};
    meses.forEach(function (m) { invest[m] = 0; detInvest[m] = []; });
    (dados.ativos || []).forEach(function (a) {
      if (!a || a.desmembrado) return;
      const m = compDe(a.aquisicao);
      if (!m || !dentro(m)) return;
      const projeto = a.projeto || null;
      /* Com filtro de projeto, mostra o que foi investido NELE. Sem
         filtro, mostra tudo, separando o que não tem projeto. */
      if (alvo && !noAlvo(projeto)) return;
      invest[m] += cent(a.valor);
      detInvest[m].push({
        rotulo: (a.descricao || a.tag || 'equipamento') + (a.nf ? ' · NF ' + a.nf : ''),
        conta: '', conta_nome: projeto ? 'investimento no projeto' : 'investimento sem projeto',
        centro: projeto, centro_nome: projeto ? ((porId[projeto] || {}).curto || '—') : 'sem projeto',
        valor: Number(a.valor) || 0
      });
    });

    const emReais = obj => {
      const o = {};
      meses.forEach(function (m) { o[m] = real(obj[m] || 0); });
      return o;
    };
    const somar = obj => real(meses.reduce(function (s, m) { return s + (obj[m] || 0); }, 0));

    const linha = (id, rotulo, obj, det, tipo) => ({
      id: id, rotulo: rotulo, tipo: tipo || 'normal',
      valores: emReais(obj), total: somar(obj),
      detalhe: det
        ? meses.reduce(function (o, m) { o[m] = (det[m] || []).slice()
            .sort(function (a, b) { return b.valor - a.valor; }); return o; }, {})
        : null
    });

    const receitaTotal = somar(receita);
    return {
      meses: meses,
      regime: caixa ? 'caixa' : 'competencia',
      alvo: alvo,
      linhas: [
        linha('receita', caixa ? 'Receita recebida (+)' : 'Receita bruta (+)', receita, detReceita, 'receita'),
        linha('imposto', 'Impostos de venda (−)', imposto, detImposto),
        linha('custo', 'Custos diretos (−)', custo, detCusto),
        linha('direta', 'Despesas diretas do projeto (−)', direta, detDireta),
        linha('geral', 'Despesas gerais rateadas (−)', geral, detGeral),
        linha('lucro', caixa ? 'Sobra de caixa' : 'Resultado líquido', lucro, null, 'total')
      ],
      investimentos: Object.assign(
        linha('investimento', 'Investimentos no período (−)', invest, detInvest, 'abaixo'),
        { observacao: montarObservacao(somar(lucro), somar(invest), caixa) }
      ),
      margem: receitaTotal > 0
        ? Math.round((somar(lucro) / receitaTotal) * 1000) / 10
        : null,
      rateio: rateio
    };
  }

  /* A frase que explica o mês. É o que a pessoa procura quando o
     lucro não apareceu na conta bancária. */
  function montarObservacao(lucro, investido, caixa) {
    if (!investido) return '';
    const n = fmt;
    if (lucro <= 0) {
      return 'Além do resultado acima, foram investidos R$ ' + n(investido) +
        ' em equipamento no período — dinheiro que saiu do caixa e virou bem.';
    }
    const sobra = Math.round((lucro - investido) * 100) / 100;
    if (sobra < 0) {
      return 'O período deu R$ ' + n(lucro) + ' de ' + (caixa ? 'sobra' : 'lucro') +
        ', mas foram investidos R$ ' + n(investido) + ' em equipamento — ' +
        'R$ ' + n(-sobra) + ' a mais do que o resultado. É por isso que não sobrou caixa.';
    }
    return 'Do ' + (caixa ? 'que sobrou' : 'lucro') + ', R$ ' + n(investido) +
      ' foram investidos em equipamento; restam R$ ' + n(sobra) + '.';
  }

  const api = { calcular: calcular, mesesEntre: mesesEntre, TIPOS_ADMIN: TIPOS_ADMIN };

  /* Serve ao ERP (window.ERP), ao aplicativo (window.ORB) e aos
     testes (module.exports) sem mudar de forma. */
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) {
    raiz.ERP = raiz.ERP || {}; raiz.ERP.dreGerencial = api;
    raiz.ORB = raiz.ORB || {}; raiz.ORB.dreGerencial = api;
  }
})(typeof window !== 'undefined' ? window : null);
