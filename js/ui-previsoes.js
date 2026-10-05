/* ERP · ui-previsoes.js — previsão estimada por projeto e competência.

   Um lançamento por projeto e por mês, com dois valores: o faturamento
   que se espera e a produtividade que se espera pagar. As duas datas
   são a mesma, porque o repasse ao médico sai no dia em que o hospital
   paga — é assim que o caixa não fica otimista.

   Quando a nota é emitida e importada, o realizado toma o lugar do
   estimado no fluxo de caixa: a previsão não é somada duas vezes. */
window.ERP = window.ERP || {};

ERP.previsoes = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;



  const rotStatus = {
    estimada:   { t: 'estimada', c: 'b-pendente' },
    confirmada: { t: 'confirmada', c: 'b-aprovado' },
    /* Valor que veio do fechamento da produtividade: confiança bem
       maior que uma estimativa, por isso status próprio. */
    confirmada_prod: { t: 'confirmado pela produtividade', c: 'sit-pago' },
    encerrada:  { t: 'encerrada', c: 'b-cancelado' }
  };

  function montar() {
    U.el('pv-comp').value = U.mesAtual();
    U.el('pv-comp').addEventListener('change', render);
    U.el('pv-salvar').addEventListener('click', salvarTudo);
    U.el('pd-comp').value = U.mesAtual();
    U.el('pd-comp').addEventListener('change', renderDespesas);
    U.el('pv-encerrar').addEventListener('click', function () { marcar('encerrada'); });
  }

  /* Confirmar e o ato do inicio do mes: a estimativa vira compromisso.
     Encerrar e o ato do fim: o que nao veio nao vem mais, e o previsto
     para de contribuir para o caixa. */
  function marcar(status) {
    const comp = U.val('pv-comp');
    if (status === 'encerrada') {
      const resto = S.previsoes().filter(function (x) { return x.competencia === comp; })
        .reduce(function (s, x) { return s + S.residuoPrevisao(x).faturamento; }, 0);
      if (resto > 0 && !window.confirm('Encerrar ' + U.fComp(comp) + ' retira ' + U.brl(resto) +
        ' de faturamento previsto que ainda nao virou nota. Confirmar?')) return;
    }
    const r = S.marcarPrevisoes(comp, status);
    render();
    ERP.app.atualizarContadores();
    ERP.app.aviso(r.n + ' previsão(ões) de ' + U.fComp(comp) +
      (status === 'encerrada'
        ? ' encerrada(s): o previsto que não virou nota foi cancelado no contas a receber.'
        : ' confirmada(s) — já entraram no contas a receber como "previsto".'), 'ok');
  }

  const projetos = () => D.centros.filter(function (c) { return c.ativo && c.tipo === 'projeto'; })
    .sort(function (a, b) {
      return String(a.unidade || '').localeCompare(String(b.unidade || '')) ||
             String(a.curto).localeCompare(String(b.curto));
    });

  function render() {
    const comp = U.val('pv-comp') || U.mesAtual();
    const lista = projetos();
    let tf = 0, tp = 0, trf = 0, trp = 0, tdf = 0, tdp = 0;
    const alertas = [];

    let uniAtual = null, grupoAtual = null;
    const linhas = lista.map(function (c) {
      // sem previsão salva para o mês, entra a estimativa do cadastro
      const salvaObj = S.previsaoDe(c.id, comp);
      const pv = salvaObj ||
        { faturamento: c.prev_faturamento || 0, produtividade: c.prev_repasse || 0 };
      const salva = !!salvaObj;
      const pvStatus = (salvaObj && salvaObj.status) || 'estimada';
      const res = S.residuoPrevisao(salvaObj || { centro: c.id, competencia: comp,
        status: 'estimada', faturamento: pv.faturamento, produtividade: pv.produtividade });
      // título correspondente no contas a receber, se a previsão foi confirmada
      const noCR = S.contasReceber().find(function (x) {
        return x.origem === 'previsao' && x.centro === c.id && x.competencia === comp &&
               x.status !== 'cancelado';
      });
      const real = S.realizadoDaPrevisao({ centro: c.id, competencia: comp });
      const pz = S.prazoDe(c.id, null);
      const data = S.dataPrevista(comp, pz.dias);
      tf += pv.faturamento; tp += pv.produtividade;
      trf += real.faturado; trp += real.produzido;
      let cab = '';
      if (c.unidade !== uniAtual) {
        uniAtual = c.unidade;
        cab = '<tr><td class="g" colspan="10" style="font-weight:650;background:#f2f4f5">' +
          U.esc(c.unidade || 'Sem unidade') + '</td></tr>';
      }
      /* Grupo de faturamento: uma linha de entrada para o conjunto (o
         hospital negocia um valor só) e, abaixo, os projetos com o
         rateio em leitura. */
      if (c.grupo_faturamento && c.grupo_faturamento !== grupoAtual) {
        grupoAtual = c.grupo_faturamento;
        const total = S.projetosDoGrupo(grupoAtual).reduce(function (a2, id) {
          const p2 = S.previsaoDe(id, comp);
          return a2 + (p2 ? p2.faturamento : ((D.centro(id) || {}).prev_faturamento || 0));
        }, 0);
        /* A previsão é DIGITADA POR ESPECIALIDADE, e esta linha mostra
           a soma. Antes era o contrário: um valor para o conjunto,
           rateado para baixo. Mas a produtividade e o pedido de
           faturamento vêm por especialidade — só a NOTA é única —, e
           quem conhece o contrato sabe quanto cada setor fatura,
           não uma proporção calculada. */
        cab += '<tr style="background:#f8fafb"><td class="desc"><b>' + U.esc(grupoAtual) + '</b>' +
          '<div class="sub">nota única — a soma das especialidades abaixo</div></td>' +
          '<td class="sub">—</td>' +
          '<td class="num"><b>' + U.num(Math.round(total * 100) / 100) + '</b>' +
            '<div class="sub">soma do grupo</div></td>' +
          '<td class="sub">produtividade é por projeto</td><td colspan="6" class="sub">' +
          'uma nota só para as ' + S.projetosDoGrupo(grupoAtual).length +
          ' especialidades, rateada pelo que cada uma previu</td></tr>';
      }
      /* Bruto contra bruto. A coluna do previsto é digitada sem
         retenção; comparar com o líquido das notas dava, como desvio,
         exatamente o imposto retido na fonte. */
      const cobFat = pv.faturamento ? real.faturado / pv.faturamento : (real.faturado ? 1 : 0);
      const desvFat = Math.round((real.faturado - pv.faturamento) * 100) / 100;
      tdf += desvFat;
      /* Faturado abaixo do previsto pede verificação: pode ser projeto
         encerrado, mês proporcional, ou nota faltando. Acima também
         interessa — pode ser competência trocada. */
      const pc = Math.round(cobFat * 1000) / 10;
      const sit = (!pv.faturamento && !pv.produtividade) ? { t: 'sem previsão', c: 'b-cancelado' }
        : !real.faturado ? { t: 'aguardando faturamento', c: 'b-aberto' }
        : cobFat < 0.98 ? { t: 'abaixo do previsto · ' + U.num(pc) + '%', c: 'b-reprovado', alerta: true }
        : cobFat > 1.02 ? { t: 'acima do previsto · ' + U.num(pc) + '%', c: 'b-aguardando' }
        : { t: 'dentro do previsto', c: 'b-pago' };
      // só o que faturou MENOS que o previsto vai para o aviso do topo
      if (sit.alerta) alertas.push({ projeto: c.curto || c.nome, pc: pc, desvio: desvFat });
      return cab + '<tr>' +
        '<td class="desc">' + U.esc(c.curto || c.nome) +
          '<div class="sub">' + (D.TIPOS_SERVICO[c.tipo_servico] || '') + ' · ' +
          pz.dias + ' dias' + (salva ? '' : ' · estimativa do cadastro') + '</div></td>' +
        '<td class="mono">' + U.fData(data) + '</td>' +
        /* Projeto que faz parte de um grupo de faturamento não tem
           previsão própria: o valor é do grupo, digitado uma vez na
           linha dele e rateado aqui. */
        (false
          ? '<td class="num sub">' + U.num(pv.faturamento) + '<div class="sub">rateio do grupo</div></td>'
          : '<td><input class="num" data-pv-fat="' + c.id + '" inputmode="decimal" value="' +
            U.num(pv.faturamento) + '"></td>') +
        '<td>' + (c.produtividade === false
          ? '<span class="sub">locação — sem repasse</span>'
          : '<input class="num" data-pv-prod="' + c.id + '" inputmode="decimal" value="' +
            U.num(pv.produtividade) + '">') + '</td>' +
        /* Só quatro colunas, por decisão da operação: projeto, previsão
           de caixa, faturamento estimado e produtividade estimada. O
           que é realizado (faturado, produzido, desvio, situação) vive
           nas abas Status e Resultado, que é onde se acompanha. */
      '</tr>';
    }).join('');

    U.el('pv-saida').innerHTML =
      '<div class="pr-confere">' +
        '<span>Faturamento previsto <b>' + U.brl(tf) + '</b></span>' +
        '<span>Produtividade prevista <b>' + U.brl(tp) + '</b></span>' +
        '<span>Margem prevista <b>' + U.brl(Math.round((tf - tp) * 100) / 100) +
          (tf ? ' · ' + U.num(Math.round((tf - tp) / tf * 1000) / 10) + '%' : '') + '</b></span>' +
        '<span>Já faturado <b>' + U.brl(trf) + '</b></span>' +
        '<span>Produtividade lançada <b>' + U.brl(trp) + '</b></span>' +
        (trf ? '<span>Desvio no faturamento <b class="' + (tdf < 0 ? 'erro' : '') + '">' + U.brl(tdf) + '</b></span>' : '') +
      '</div>' +
      (alertas.length
        ? '<div class="aviso" style="margin:10px 0"><b>Verificar ' + alertas.length + ' projeto(s):</b> ' +
          alertas.map(function (a) {
            return U.esc(a.projeto) + ' faturou ' + U.num(a.pc) + '% do previsto (' + U.brl(a.desvio) + ')';
          }).join('; ') + '. Pode ser projeto encerrado, mês proporcional, ' +
          'competência trocada ou nota complementar que ainda não veio — vale conferir antes de fechar ' +
          'o mês.</div>'
        : '') +
      '<div class="tabela-rolagem" style="margin:10px -14px 0">' +
      '<table><thead><tr><th>Projeto</th><th>Previsão de caixa</th>' +
      '<th class="num">Faturamento estimado</th><th class="num">Produtividade estimada</th>' +
      '</tr></thead><tbody>' + linhas + '</tbody></table></div>' +
      '<div class="ajuda">A data é a mesma para receber e para pagar: o repasse ao médico sai no dia em que ' +
      'o hospital paga.<br>' +
      '<b>Chegou a nota daquela linha, ela substitui a previsão inteira</b> — é uma nota por linha no ' +
      'mês, na esmagadora maioria dos casos. A substituição é por LINHA de projeto: nota de cirurgia ' +
      'zera a previsão de cirurgia e não encosta em anestesia, neo e pediatria. Quando o faturamento ' +
      'vier partido, marque <b>parcial</b> na linha e o que falta continua no fluxo até o mês ser ' +
      'encerrado.<br>' +
      '<b>Onde se lança o valor confirmado:</b> nos próprios campos de faturamento e produtividade desta ' +
      'grade. Digite o valor e clique em "Salvar e confirmar o mês" — a partir daí o ' +
      'título aparece no contas a receber. Se o valor mudar depois de confirmado, basta editar e salvar ' +
      'de novo: o título e o fluxo acompanham.</div>';
    ligarParcial();
  }

  /* Previsão de DESPESA: o que se espera pagar e ainda nao foi lancado.
     Some do fluxo na medida em que os titulos entram. */
  /* Despesa prevista mora no A PAGAR: é dinheiro saindo. */
  function renderDespesas() {
    const comp = U.val('pd-comp') || U.mesAtual();
    U.el('pd-saida').innerHTML = telaDespesa(comp);
    ligarDespesa();
  }

  function telaDespesa(comp) {
    const lista = S.previsoesDespesa(comp);
    const tPrev = lista.reduce(function (s, p) { return s + p.valor; }, 0);
    const tReal = lista.reduce(function (s, p) { return s + S.realizadoDespesa(p); }, 0);
    const tRes = lista.reduce(function (s, p) { return s + S.residuoDespesa(p); }, 0);

    return '<div class="pr-confere">' +
        '<span>Despesa prevista <b>' + U.brl(tPrev) + '</b></span>' +
        '<span>Já lançada <b>' + U.brl(tReal) + '</b></span>' +
        '<span>Ainda previsto <b>' + U.brl(tRes) + '</b></span>' +
      '</div>' +
      '<div class="ap-acoes"><button class="btn-linha" id="pd-nova">+ Nova despesa prevista</button>' +
        '<button class="btn-sm" id="pd-copiar">Copiar do mês anterior</button></div>' +
      '<div class="tabela-rolagem" style="margin:0 -14px"><table><thead><tr>' +
      '<th>Descrição</th><th>Fornecedor</th><th>Natureza</th><th>Centro</th><th>Data prevista</th>' +
      '<th class="num">Previsto</th><th class="num">Já lançado</th>' +
      '<th class="num">Ainda previsto</th><th></th></tr></thead><tbody>' +
      (lista.length ? lista.map(function (pv) {
        const c = D.conta(pv.conta) || {};
        const real = S.realizadoDespesa(pv);
        const naSérie = pv.serie ? S.previsoesDespesa().filter(function (x) {
          return x.serie === pv.serie; }).length : 0;
        return '<tr><td class="desc">' + U.esc(pv.descricao || c.nome || '') +
          (pv.serie ? '<div class="sub"><span class="badge b-aprovado">recorrente</span> ' +
            naSérie + ' mês(es) na série</div>' : '') + '</td>' +
          '<td>' + U.esc(pv.credor ? (D.credor(pv.credor) || {}).nome || '' : '—') + '</td>' +
          '<td class="sub">' + U.esc(pv.conta + ' ' + (c.nome || '')) + '</td>' +
          '<td>' + U.esc((D.centro(pv.centro) || {}).curto || 'sem centro') + '</td>' +
          '<td class="mono">' + U.fData(pv.data) + '</td>' +
          '<td class="num">' + U.brl(pv.valor) + '</td>' +
          '<td class="num">' + (real ? U.brl(real) : '\u2014') + '</td>' +
          '<td class="num">' + U.brl(S.residuoDespesa(pv)) +
            (real ? '<div><label class="sub" style="display:flex;gap:4px;align-items:center;' +
              'justify-content:flex-end;cursor:pointer"><input type="checkbox" data-pd-parcial="' +
              pv.id + '" style="width:auto"' + (pv.parcial ? ' checked' : '') +
              '> parcial</label></div>' : '') + '</td>' +
          '<td class="acoes"><button class="btn-sm" data-pd="' + pv.id + '">Editar</button>' +
            (pv.serie ? '<button class="btn-sm" data-pd-rep="' + pv.id + '" ' +
              'title="levar este valor aos meses seguintes da série">Replicar</button>' : '') +
            '<button class="btn-sm btn-cancelar" data-pd-x="' + pv.id + '">Excluir</button></td></tr>';
      }).join('')
        : '<tr><td colspan="9" class="vazio"><strong>Nenhuma despesa prevista neste mês.</strong>' +
          'Lance aqui o que se espera pagar e ainda não virou título: aluguel, folha, imposto.</td></tr>') +
      '</tbody></table></div>' +
      '<div class="ajuda">Lancado o titulo daquela natureza e centro na competencia, o valor real ' +
      'substitui a previsao inteira. Se a despesa vier partida em mais de um titulo, marque ' +
      '<b>parcial</b> e o que falta continua no fluxo.</div>';
  }

  function editarDespesa(id) {
    const pv = id ? S.previsoesDespesa().find(function (p) { return p.id === id; }) : null;
    const comp = U.val('pd-comp');
    ERP.app.modal({
      titulo: pv ? 'Despesa prevista' : 'Nova despesa prevista',
      corpo:
        '<label>Descrição</label><input id="pd-desc" value="' + U.esc(pv ? (pv.descricao || '') : '') +
          '" placeholder="Ex.: Aluguel matriz">' +
        '<label>Fornecedor <span class="sub">(opcional — deixa a coluna preenchida no contas a pagar)</span></label>' +
        '<input id="pd-credor" list="dl-credores" value="' +
          U.esc(pv && pv.credor ? (D.credor(pv.credor) || {}).nome || '' : '') + '" ' +
          'placeholder="Enel, Vivo, imobiliária…">' +
        '<label>Natureza</label><select id="pd-conta">' +
          D.plano.filter(function (x) { return x.nivel === 2 && x.pai !== '1'; }).map(function (x) {
            return '<option value="' + x.cod + '"' + (pv && pv.conta === x.cod ? ' selected' : '') + '>' +
              U.esc(x.cod + ' ' + x.nome) + '</option>'; }).join('') + '</select>' +
        '<div class="row3"><div><label>Centro de custo</label><select id="pd-centro">' +
          '<option value="">Sem centro</option>' +
          D.centros.filter(function (x) { return x.ativo; }).map(function (x) {
            return '<option value="' + x.id + '"' + (pv && pv.centro === x.id ? ' selected' : '') + '>' +
              U.esc(x.curto || x.nome) + '</option>'; }).join('') + '</select></div>' +
        '<div><label>Valor previsto</label><input id="pd-valor" class="num" inputmode="decimal" value="' +
          U.num(pv ? pv.valor : 0) + '"></div>' +
        '<div><label>Data prevista</label><input type="date" id="pd-data" value="' +
          (pv ? pv.data : comp + '-10') + '"></div></div>' +
        (pv
          ? (pv.serie
              ? '<div class="ajuda">Esta linha faz parte de uma série recorrente. Alterar aqui muda ' +
                'só este mês; use "Replicar" na lista para levar o novo valor aos meses seguintes.</div>'
              : '')
          : '<label>Repetir nos próximos meses</label><select id="pd-repetir">' +
            [['1', 'só este mês'], ['3', '3 meses'], ['6', '6 meses'], ['12', '12 meses'],
             ['24', '24 meses']].map(function (o) {
              return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select>' +
            '<div class="ajuda">Conta de luz, aluguel, folha: cadastre uma vez e o sistema cria a ' +
            'previsão de cada mês, sempre no mesmo dia. Depois dá para ajustar o valor de um mês só ' +
            'ou replicar o novo valor para os seguintes.</div>'),
      acoes: [{ txt: pv ? 'Salvar' : 'Incluir', cls: 'btn-aprovar', fn: function () {
        const rep = U.el('pd-repetir') ? parseInt(U.val('pd-repetir'), 10) : 1;
        const nomeCr = U.val('pd-credor');
        const cr = nomeCr ? D.credores.find(function (x) {
          return x.nome.toUpperCase() === nomeCr.toUpperCase(); }) : null;
        if (nomeCr && !cr) return ERP.app.aviso('Fornecedor "' + nomeCr +
          '" não está cadastrado. Deixe em branco ou cadastre em Cadastros › Fornecedores.', 'erro');
        const r = S.salvarPrevisaoDespesa({
          credor: cr ? cr.id : null,
          conta: U.val('pd-conta'), centro: U.val('pd-centro'), competencia: comp,
          valor: U.parseValor(U.val('pd-valor')), data: U.val('pd-data'),
          descricao: U.val('pd-desc'), serie: pv ? pv.serie : null, repetir: rep
        });
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        ERP.app.aviso(r.n > 1
          ? 'Despesa recorrente criada em ' + r.n + ' meses, a partir de ' + U.fComp(comp) + '.'
          : 'Despesa prevista salva.', 'ok');
        renderDespesas();
      } }]
    });
  }

  function ligarDespesa() {
    U.el('pd-nova').addEventListener('click', function () { editarDespesa(null); });
    ERP.lancamento.atualizarCredores();
    U.el('pd-copiar').addEventListener('click', function () {
      const comp = U.val('pd-comp');
      const ant = U.compDe(U.addMeses(comp + '-01', -1));
      const origem = S.previsoesDespesa(ant);
      if (!origem.length) return ERP.app.aviso('Não ha despesas previstas em ' + U.fComp(ant) + '.', 'erro');
      let n = 0;
      origem.forEach(function (pv) {
        const r = S.salvarPrevisaoDespesa({
          conta: pv.conta, centro: pv.centro, competencia: comp, valor: pv.valor,
          data: comp + '-' + String(pv.data || '').slice(-2), descricao: pv.descricao,
          credor: pv.credor
        });
        if (r.ok) n++;
      });
      renderDespesas();
      ERP.app.aviso(n + ' despesa(s) copiada(s) de ' + U.fComp(ant) + '.', 'ok');
    });
    U.el('pd-saida').querySelectorAll('[data-pd]').forEach(function (b) {
      b.addEventListener('click', function () { editarDespesa(this.dataset.pd); });
    });
    U.el('pd-saida').querySelectorAll('[data-pd-parcial]').forEach(function (chk) {
      chk.addEventListener('change', function () {
        const pv = S.previsoesDespesa().find(function (x) { return x.id === this.dataset.pdParcial; }
          .bind(this));
        if (pv) {
          S.salvarPrevisaoDespesa({ conta: pv.conta, centro: pv.centro,
            competencia: pv.competencia, valor: pv.valor, data: pv.data,
            descricao: pv.descricao, credor: pv.credor, parcial: this.checked });
        }
        renderDespesas();
      });
    });
    U.el('pd-saida').querySelectorAll('[data-pd-rep]').forEach(function (b) {
      b.addEventListener('click', function () {
        const r = S.replicarSerieDespesa(this.dataset.pdRep);
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        renderDespesas();
        ERP.app.aviso('Valor replicado para ' + r.n + ' mês(es) seguinte(s) da série.', 'ok');
      });
    });
    U.el('pd-saida').querySelectorAll('[data-pd-x]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = this.dataset.pdX;
        const pv = S.previsoesDespesa().find(function (x) { return x.id === id; });
        let serieToda = false;
        if (pv && pv.serie) {
          serieToda = window.confirm('Esta previsão é recorrente.\n\nOK apaga deste mês em diante; ' +
            'Cancelar apaga só ' + U.fComp(pv.competencia) + '.');
        }
        const r = S.excluirPrevisaoDespesa(id, serieToda);
        renderDespesas();
        ERP.app.aviso((r.n || 1) + ' previsão(ões) excluída(s).', 'ok');
      });
    });
  }

  function ligarParcial() {
    U.el('pv-saida').querySelectorAll('[data-parcial]').forEach(function (chk) {
      chk.addEventListener('change', function () {
        const r = S.marcarParcial(this.dataset.parcial, U.val('pv-comp'), this.checked);
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        render();
        ERP.app.aviso(this.checked
          ? 'Marcado como faturamento parcial: o que falta continua no fluxo.'
          : 'A nota volta a substituir a previsão inteira.', 'ok');
      });
    });
  }

  function salvarTudo() {
    const comp = U.val('pv-comp');
    if (!comp) return ERP.app.aviso('Escolha a competência.', 'erro');
    let n = 0;
    /* Projeto com valor CONFIRMADO no fechamento da produtividade não é
       sobrescrito em silêncio: o sistema separa esses casos e pergunta
       um por um, dizendo o valor que está gravado e o que foi digitado. */
    const conflitos = [];
    /* Primeiro os grupos: o valor do conjunto é rateado e sobrescreve o
       que estiver nas linhas dos projetos dele. */
    U.el('pv-saida').querySelectorAll('[data-pv-grupo]').forEach(function (el) {
      const r = S.salvarPrevisaoGrupo(el.dataset.pvGrupo, comp, U.parseValor(el.value));
      if (r.ok) {
        n += r.n;
        (r.conflitos || []).forEach(function (x) {
          conflitos.push({ centro: D.centro(x.centro), fat: x.valor, prod: 0, atual: x.atual });
        });
      }
    });
    projetos().forEach(function (c) {
      /* Projeto de grupo salva como qualquer outro: o faturamento é
         digitado na linha dele. O que o grupo define é a NOTA — uma
         só para todas as especialidades —, não a previsão. */
      const fat = U.parseValor((U.el('pv-saida').querySelector('[data-pv-fat="' + c.id + '"]') || {}).value);
      const pe = U.el('pv-saida').querySelector('[data-pv-prod="' + c.id + '"]');
      const prod = pe ? U.parseValor(pe.value) : 0;
      const antes = S.previsaoDe(c.id, comp);
      if (!fat && !prod && !antes) return;   // projeto sem valor não gera previsão
      const r = S.salvarPrevisao({ centro: c.id, competencia: comp, faturamento: fat, produtividade: prod });
      if (r.ok) n++;
      else if (r.confirmadaProd) conflitos.push({ centro: c, fat: fat, prod: prod, atual: r.valor_atual });
    });
    if (conflitos.length) { render(); return perguntarSobrescrita(conflitos, comp, n); }
    /* Salvar e confirmar viraram UM ato. Separados, a previsão ficava
       digitada mas invisível no contas a receber até alguém lembrar de
       clicar no segundo botão — e ninguém lembrava. Quem só quer
       rascunhar não precisa salvar. */
    const r = S.marcarPrevisoes(comp, 'confirmada');
    render();
    ERP.app.atualizarContadores();
    ERP.app.aviso(n + ' previsão(ões) salva(s) e confirmada(s) para ' + U.fComp(comp) +
      ' — já estão no contas a receber como "previsto".', 'ok');
  }

  /* Confirmação explícita para trocar valor que veio do fechamento. */
  function perguntarSobrescrita(conflitos, comp, salvos) {
    ERP.app.modal({
      titulo: 'Valor confirmado pela produtividade',
      fecharTxt: 'Manter como está',
      corpo: '<div class="ajuda">' + salvos + ' previsão(ões) foram salvas. ' +
          conflitos.length + ' projeto(s) têm valor confirmado no fechamento da produtividade — que é ' +
          'medição, não estimativa. Trocar faz o valor deixar de constar como confirmado.</div>' +
        '<table class="parcelas"><thead><tr><th>Projeto</th><th class="num">Confirmado</th>' +
          '<th class="num">Digitado</th></tr></thead><tbody>' +
          conflitos.map(function (x) {
            return '<tr><td class="desc">' + U.esc(x.centro.curto) + '</td>' +
              '<td class="num">' + U.brl(x.atual) + '</td>' +
              '<td class="num erro">' + U.brl(x.fat) + '</td></tr>';
          }).join('') + '</tbody></table>',
      acoes: [{ txt: 'Trocar pelos valores digitados', cls: 'btn-cancelar', fn: function () {
        let k = 0;
        conflitos.forEach(function (x) {
          const r = S.salvarPrevisao({ centro: x.centro.id, competencia: comp,
            faturamento: x.fat, produtividade: x.prod, forcar: true });
          if (r.ok) k++;
        });
        /* Mesmo ato do botão: trocar também confirma, senão a previsão
           trocada ficaria fora do contas a receber. */
        S.marcarPrevisoes(comp, 'confirmada');
        ERP.app.fecharModal();
        render();
        ERP.app.atualizarContadores();
        ERP.app.aviso(k + ' previsão(ões) trocadas e confirmadas — elas não constam mais como ' +
          'confirmadas pela produtividade, e o título no contas a receber acompanhou o novo valor.', 'ok');
      } }]
    });
  }

  return { montar: montar, render: render, renderDespesas: renderDespesas };
})();
