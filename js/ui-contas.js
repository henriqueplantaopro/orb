/* ERP · ui-contas.js — lista de contas a pagar, aprovação, baixa,
   cancelamento e histórico de cada parcela. */
window.ERP = window.ERP || {};

ERP.contas = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;
  let selecionadas = new Set();
  let abaContas = 'apagar';   // 'apagar' | 'pagas'

  const rotOrigem = { manual: 'Manual', produtividade: 'Produtividade', nota_fiscal: 'NF de compra', recorrente: 'Recorrente' };
  /* Guia com várias naturezas de origem (contas_rateio): texto com a
     composição, pra lista, detalhe e exportações não mostrarem só a
     natureza principal. */
  function naturezasTexto(p) {
    if (!p.contas_rateio || p.contas_rateio.length < 2) return null;
    return p.contas_rateio.map(function (x) {
      return x.conta + ' ' + ((D.conta(x.conta) || {}).nome || '') + ' ' + U.brl(x.valor);
    }).join(' + ');
  }
  const rotStatus = { aberto: 'Em aberto', parcial: 'Parcial',
                      aguardando: 'Aguardando aprovação do pagamento',
                      autorizado: 'Aprovado — vai na remessa',
                      enviado: 'No banco', pago: 'Pago', cancelado: 'Cancelado',
                      previsto: 'Previsto', substituido: 'Substituído pelo título' };
  const rotAprov = { pendente: 'Aguardando', aprovado: 'Aprovado', reprovado: 'Reprovado' };
  /* Mostrado dentro da linha, sem rolar a tela pro lado: a versão
     completa continua no title do badge "travado". */
  const impedimentoCurto = msg => ({
    'credor sem forma de pagamento no cadastro': 'completar cadastro',
    'credor não cadastrado': 'completar cadastro',
    'cadastro sem chave PIX': 'completar cadastro',
    'cadastro sem CPF/CNPJ': 'completar cadastro'
  })[msg] || msg;

  /* Saldo em conta — vem do último extrato conciliado, conferido
     contra o que a movimentação daquele extrato deveria dar. Usado
     aqui e na tela de aprovação de pagamentos: é lá que a diretora
     mais precisa saber quanto tem em caixa antes de autorizar. */
  function atualizarMetricaSaldo() {
    if (!U.el('m-saldo')) return;
    const saldos = S.saldosAtuais();
    const box = U.el('m-saldo-box');
    if (!saldos.length) { if (box) box.style.display = 'none'; return; }
    if (box) box.style.display = '';
    const s = saldos[0];
    if (s.status === 'bloqueado') {
      U.el('m-saldo').textContent = 'bloqueado';
      U.el('m-saldo').style.color = 'var(--red)';
      U.el('m-saldo-pe').innerHTML = '<span class="erro">diferença de ' + U.brl(Math.abs(s.divergencia)) +
        ' entre o arquivo e o conciliado</span>';
    } else {
      U.el('m-saldo').textContent = U.brl(s.valor);
      U.el('m-saldo').style.color = '';
      U.el('m-saldo-pe').innerHTML = (s.data ? 'em ' + U.fData(s.data) : '') +
        (s.status === 'alerta' ? ' · <span class="erro">divergência de ' + U.brl(Math.abs(s.divergencia)) + '</span>' : '');
    }
  }

  /* Mesma informação, em HTML pronto pra embutir numa tela que monta
     string em vez de ter elementos fixos (a de aprovação de pagamento). */
  function saldoBancarioResumoHTML() {
    const saldos = S.saldosAtuais();
    if (!saldos.length) return '';
    return '<div class="pr-confere" style="margin-bottom:10px">' +
      saldos.map(function (s) {
        if (s.status === 'bloqueado') {
          return '<span>' + U.esc(s.nome) + ' <b class="erro">saldo bloqueado — diferença de ' +
            U.brl(Math.abs(s.divergencia)) + ' entre o arquivo e o conciliado; confira antes de aprovar</b></span>';
        }
        return '<span>' + U.esc(s.nome) + ' <b>' + U.brl(s.valor) + '</b>' +
          (s.data ? ' <span class="sub">em ' + U.fData(s.data) + '</span>' : '') +
          (s.status === 'alerta'
            ? ' <span class="sub erro">divergência de ' + U.brl(Math.abs(s.divergencia)) + ' com o conciliado</span>'
            : '') + '</span>';
      }).join('') + '</div>';
  }
  const rotTipo = { nf: 'NF', fatura: 'Fatura', boleto: 'Boleto', recibo: 'Recibo',
                    guia: 'Guia', medicao: 'Medição', adiantamento: 'Adiant.' };

  // só o número referencial na coluna Título; o resto vive na dica e no "Ver"
  function refCurta(doc) {
    doc = String(doc || '—');
    return doc.length > 12 ? doc.slice(0, 12) + '…' : doc;
  }

  const CAMPOS_FILTRO = ['flt-comp', 'flt-centro', 'flt-conta', 'flt-status', 'flt-anexo', 'flt-credor',
    'flt-de', 'flt-ate', 'flt-baixa-de', 'flt-baixa-ate', 'flt-busca'];

  /* "Selecionar todos" marca tudo o que dá para marcar e ignora o resto —
     nunca fica desabilitado por causa de uma linha travada. */
  function podeSelecionar(p) {
    // título previsto é lembrete de caixa, não obrigação: não se paga
    if (p.status === 'previsto' || p.status === 'substituido') return false;
    /* Cadastro incompleto não impede mais selecionar nem aprovar: a
       trava é na remessa. Antes, o título ficava fora do fluxo inteiro
       por falta de um dado que só o banco exige — e o código de barras
       do boleto, digitado cedo, vencia antes da aprovação sair. */
    return S.pode('pagar') && p.status !== 'cancelado' && p.status !== 'pago' &&
      !S.emCursoDe(p.id).length && S.saldoDe(p) > 0;
  }

  /* Filtro enxuto por padrão: data resolve a maioria das buscas. O
     resto abre no botão, e fica aberto se já houver algo preenchido. */
  function ligarPesquisaAvancada() {
    const btn = U.el('flt-avancada');
    if (!btn) return;
    const caixa = U.el('flt-mais');
    const usado = ['flt-credor', 'flt-busca', 'flt-comp', 'flt-centro', 'flt-conta', 'flt-anexo']
      .some(function (id) { return U.val(id); });
    if (usado) { caixa.style.display = ''; btn.setAttribute('aria-expanded', 'true'); }
    btn.addEventListener('click', function () {
      const aberto = caixa.style.display !== 'none';
      caixa.style.display = aberto ? 'none' : '';
      btn.setAttribute('aria-expanded', String(!aberto));
      btn.textContent = aberto ? 'Pesquisa avançada' : 'Esconder filtros';
    });
  }

  function montar() {
    ligarPesquisaAvancada();
    U.el('flt-centro').innerHTML = '<option value="">Todos os centros</option>' +
      D.centros.map(c => '<option value="' + c.id + '">' + U.esc(c.codigo + ' · ' + c.nome) + (c.ativo ? '' : ' (encerrado)') + '</option>').join('');
    U.el('flt-conta').innerHTML = '<option value="">Todas as contas</option>' +
      D.plano.filter(p => p.nivel === 1 && p.tipo !== 'receita').map(g =>
        '<option value="' + g.cod + '">' + U.esc(g.cod + ' · ' + g.nome) + '</option>' +
        D.plano.filter(s => s.pai === g.cod).map(s =>
          '<option value="' + s.cod + '">&nbsp;&nbsp;&nbsp;' + U.esc(s.cod + ' ' + s.nome) + '</option>').join('')
      ).join('');

    /* Busca com respiro. Sem isto, cada tecla refazia filtro, soma e
       tabela inteira — "MedTech" travava a tela por três quartos de
       segundo. Os outros filtros são select e botão, e respondem na
       hora. */
    let debounce = null;
    CAMPOS_FILTRO.forEach(function (id) {
      const e = U.el(id);
      const ehTexto = e.tagName === 'INPUT' && e.type !== 'date';
      e.addEventListener('input', function () {
        selecionadas.clear();
        mostrando = PAGINA;
        if (!ehTexto) return render();
        clearTimeout(debounce);
        debounce = setTimeout(render, 160);
      });
    });
    U.el('flt-limpar').addEventListener('click', limpar);
    U.el('lote-aprovar').addEventListener('click', aprovarLote);
    U.el('lote-pagar').addEventListener('click', abrirLotePagar);
    U.el('lote-vencidas').addEventListener('click', selecionarVencidas);
    U.el('lote-limpar').addEventListener('click', () => { selecionadas.clear(); render(); });
    U.el('btn-exportar-contas').addEventListener('click', exportar);
    U.el('btn-imprimir-contas').addEventListener('click', function () { window.print(); });
    document.querySelectorAll('#ct-aba-nav button').forEach(function (b) {
      b.addEventListener('click', function () { aplicarAba(this.dataset.ctaba); });
    });
    U.setVal('flt-status', 'apagar');
    U.el('chk-todas').addEventListener('change', function () {
      selecionadas.clear();
      if (this.checked) {
        const lista = S.listar(filtros());
        const podem = lista.filter(podeSelecionar);
        podem.forEach(function (p) { selecionadas.add(p.id); });
        const fora = lista.length - podem.length;
        ERP.app.aviso(podem.length + ' marcada(s)' +
          (fora ? ', ' + fora + ' fora da seleção (travada, já em pagamento, paga ou cancelada)' : '') + '.', 'ok');
      }
      render();
    });
  }

  /* Duas abas na mesma tela em vez de mais um valor no filtro de
     situação: "a pagar" filtra por vencimento, "pagas" filtra por data
     da baixa — são perguntas diferentes ("o que vence quando" vs "o
     que já saiu quando"), e misturar os dois filtros no mesmo par de
     campos confundia qual data cada um estava usando. */
  function estadoDaAba(aba) {
    abaContas = aba;
    document.querySelectorAll('#ct-aba-nav button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.ctaba === aba);
    });
    const pagas = aba === 'pagas';
    U.el('f-venc-de').style.display = pagas ? 'none' : '';
    U.el('f-venc-ate').style.display = pagas ? 'none' : '';
    U.el('f-baixa-de').style.display = pagas ? '' : 'none';
    U.el('f-baixa-ate').style.display = pagas ? '' : 'none';
    U.el('f-status').style.display = pagas ? 'none' : '';
    const thB = U.el('th-banco');
    if (thB) thB.style.display = pagas ? '' : 'none';
    if (U.el('th-baixa')) U.el('th-baixa').style.display = pagas ? '' : 'none';
    U.setVal('flt-de', ''); U.setVal('flt-ate', '');
    U.setVal('flt-baixa-de', ''); U.setVal('flt-baixa-ate', '');
    U.setVal('flt-status', pagas ? 'pago' : 'apagar');
    /* O filtro de NF não é dono de nenhuma aba — sem resetar aqui, o
       atalho do painel ("Sem NF") ficava ligado pra sempre depois de
       usado uma vez, e continuava filtrando silenciosamente mesmo
       depois de trocar de aba sem ninguém perceber por quê. */
    U.setVal('flt-anexo', '');
    U.setVal('flt-credor', '');
    selecionadas.clear();
    mostrando = PAGINA;
  }
  function aplicarAba(aba) { estadoDaAba(aba); render(); }

  function limpar() {
    CAMPOS_FILTRO.forEach(id => U.setVal(id, ''));
    U.setVal('flt-status', abaContas === 'pagas' ? 'pago' : 'apagar');   // a tela abre pelo que falta pagar
    selecionadas.clear();
    render();
  }

  const filtros = () => ({
    empresa: U.val('flt-empresa'),
    banco: U.val('flt-banco'),
    comp: U.val('flt-comp'), centro: U.val('flt-centro'), conta: U.val('flt-conta'),
    status: abaContas === 'pagas' ? 'pago' : U.val('flt-status'), anexo: U.val('flt-anexo'),
    de: U.val('flt-de'), ate: U.val('flt-ate'),
    baixaDe: U.val('flt-baixa-de'), baixaAte: U.val('flt-baixa-ate'), busca: U.val('flt-busca'),
    /* O campo agora é texto: converte o nome digitado no id do
       fornecedor. Pedaço do nome também serve, desde que só um bata. */
    credor: credorDigitado()
  });

  /* Lista de fornecedores do filtro: só quem tem título, com a
     quantidade ao lado — a lista inteira de credores seria grande
     demais pra achar alguém. */
  /* Empresas do grupo no filtro — montado uma vez, na abertura. */
  /* Conta bancária no filtro — só faz sentido na aba de pagas, que é
     onde existe pagamento com banco. */
  function preencherFiltroBanco() {
    const sel = U.el('flt-banco');
    if (!sel) return;
    const caixa = U.el('f-flt-banco');
    if (caixa) caixa.style.display = abaContas === 'pagas' ? '' : 'none';
    if (abaContas !== 'pagas' && sel.value) { sel.value = ''; }
    if (sel.dataset.pronto) return;
    sel.innerHTML = '<option value="">todos os bancos</option>' +
      D.bancos.filter(function (b) { return b.ativo; }).map(function (b) {
        const e = D.empresaPor(b.empresa);
        return '<option value="' + b.id + '">' + U.esc(b.apelido) +
          (e ? ' · ' + U.esc(e.apelido) : '') + '</option>';
      }).join('');
    sel.dataset.pronto = '1';
    sel.addEventListener('change', render);
  }

  function preencherFiltroEmpresa() {
    preencherFiltroBanco();
    const sel = U.el('flt-empresa');
    if (!sel || sel.dataset.pronto) return;
    sel.innerHTML = '<option value="">todas as empresas</option>' +
      D.empresas.filter(function (e) { return e.ativo; }).map(function (e) {
        return '<option value="' + e.id + '">' + U.esc(e.apelido) + '</option>';
      }).join('');
    sel.dataset.pronto = '1';
    sel.addEventListener('change', render);
  }

  function preencherFiltroCredor() {
    preencherFiltroEmpresa();
    const sel = U.el('flt-credor');
    if (!sel) return;
    const atual = sel.value;
    /* O contador mostra quantos títulos daquele fornecedor existem NA
       ABA aberta (a pagar ou pagas) — antes somava tudo e o número não
       batia com a lista. */
    const conta = {};
    S.todasParcelas().forEach(function (p) {
      if (p.status === 'cancelado' || !p.credor) return;
      const pago = p.status === 'pago';
      if (abaContas === 'pagas' ? !pago : pago) return;
      conta[p.credor] = (conta[p.credor] || 0) + 1;
    });
    const itens = Object.keys(conta).map(function (id) {
      return { id: id, nome: (D.credor(id) || {}).nome || id, n: conta[id] };
    }).sort(function (a, b) { return a.nome.localeCompare(b.nome); });
    if (atual && !itens.some(function (x) { return x.id === atual; })) {
      // fornecedor sem título nesta aba: mantém na lista pra não zerar a escolha
      const cr = D.credor(atual);
      if (cr) itens.unshift({ id: atual, cred: cr, nome: cr.nome, n: 0 });
    }
    /* Virou campo de digitar com sugestão: com centenas de fornecedores
       cadastrados, rolar uma lista inteira é inviável. O valor digitado
       casa por nome, e o filtro aceita pedaço do nome. */
    const dl = U.el('lista-credores');
    if (dl) {
      dl.innerHTML = itens.map(function (x) {
        return '<option value="' + U.esc(x.nome) + '">' + x.n + ' título(s)</option>';
      }).join('');
    }
  }

  /* Nome digitado → id do fornecedor. Casa exato primeiro; na falta,
     aceita um único fornecedor que contenha o texto. */
  function credorDigitado() {
    const txt = (U.val('flt-credor') || '').trim().toLowerCase();
    if (!txt) return '';
    const exato = D.credores.find(function (c) { return String(c.nome).toLowerCase() === txt; });
    if (exato) return exato.id;
    const parciais = D.credores.filter(function (c) {
      return String(c.nome).toLowerCase().indexOf(txt) > -1; });
    return parciais.length === 1 ? parciais[0].id : '__texto__' + txt;
  }

  const PAGINA = 300;
  let mostrando = PAGINA;
  /* Quais fechamentos estão abertos na tela (some ao trocar de filtro,
     de propósito: o padrão é a lista compacta). */
  const gruposAbertos = new Set();

  function render() {
    preencherFiltroCredor();
    const lista = S.listar(filtros());
    if (mostrando > PAGINA && mostrando > lista.length) mostrando = PAGINA;
    U.el('chk-todas').disabled = false;   // nunca desabilita: marca o que dá
    if (!selecionadas.size) U.el('chk-todas').checked = false;
    const hoje = U.hoje();

    const emAberto = lista.filter(p => p.status === 'aberto' || p.status === 'parcial');
    const saldoAberto = emAberto.reduce((s, p) => s + S.saldoDe(p), 0);
    const vencido = emAberto.filter(p => p.venc < hoje).reduce((s, p) => s + S.saldoDe(p), 0);
    const pago = lista.reduce((s, p) => s + S.caixaDe(p.id), 0);
    const pend = lista.filter(p => p.aprovacao === 'pendente' && p.status !== 'cancelado');

    /* Uma caixa, um número. O texto comprido com a conta do dia saiu:
       quem quer a projeção tem o fluxo de caixa diário nos relatórios. */
    const banco = S.saldoBancarioAtual ? S.saldoBancarioAtual() : null;
    U.el('cp-resumo').innerHTML =
      '<div class="rot">Saldo bancário do grupo</div>' +
      '<div class="valor">' + (banco && banco.valor !== null ? U.brl(banco.valor) : '—') + '</div>' +
      /* O total é a soma das contas ativas; a data é a da conta mais
         atrasada, porque um total só vale até onde a última conferência
         alcançou. A composição fica no title. */
      '<div class="det" title="' + (banco && banco.contas
        ? U.esc(banco.contas.map(function (c) { return c.nome + ': ' + U.brl(c.valor); }).join(' · '))
        : '') + '">' + (banco && banco.contas
        ? banco.contas.length + (banco.contas.length === 1 ? ' conta' : ' contas somadas') +
          (banco.data ? ' · a mais atrasada em ' + U.fData(banco.data) : '')
        : (banco && banco.data ? 'em ' + U.fData(banco.data) : 'sem saldo informado')) + '</div>';

    const btnAprov = U.el('lote-aprovar');
    if (btnAprov) btnAprov.style.display = (pend.length && S.pode('aprovar')) ? '' : 'none';

    // barra de ação em lote: aprovar lançamentos e/ou solicitar pagamento
    const barra = U.el('barra-lote');
    const escolhidas = Array.from(selecionadas).map(function (id) { return S.parcela(id); }).filter(Boolean);
    const paraPagar = escolhidas.filter(function (p) {
      return p.status !== 'pago' && !S.emCursoDe(p.id).length;
    });
    const podeVencidas = S.pode('pagar') && S.aptasParaSolicitar().some(function (p) { return p.venc <= hoje; });

    if (selecionadas.size || podeVencidas) {
      barra.style.display = 'flex';
      const soma = escolhidas.reduce(function (s, p) { return s + S.saldoDe(p); }, 0);
      U.el('lote-conta').textContent = selecionadas.size
        ? selecionadas.size + ' selecionada(s) · ' + U.brl(soma)
        : 'Nada selecionado';
      U.el('lote-vencidas').style.display = podeVencidas ? '' : 'none';
      U.el('lote-pagar').style.display = (paraPagar.length && S.pode('pagar')) ? '' : 'none';
      U.el('lote-pagar').textContent = 'Solicitar pagamento de ' + paraPagar.length;
      U.el('lote-limpar').style.display = selecionadas.size ? '' : 'none';
    } else {
      barra.style.display = 'none';
    }

    const tb = U.el('tbody-contas');
    if (!lista.length) {
      tb.innerHTML = '<tr><td colspan="11" class="vazio"><strong>Nada com esses filtros.</strong>' +
        'Ajuste o período ou limpe os filtros para ver todos os lançamentos.</td></tr>';
      return;
    }

    /* A tabela mostra uma página por vez. Desenhar 6.240 linhas de uma
       vez custava ~900 ms e ninguém rola seis mil linhas: os totais
       acima continuam somando TUDO que o filtro pegou, que é o número
       que importa. */
    const visiveis = lista.slice(0, mostrando);
    /* Fechamento de produtividade vira UMA linha que abre. Um
       fechamento de anestesia tem dezenas de médicos, e a lista virava
       uma parede de linhas iguais; aqui o grupo mostra o total e o
       número de médicos, e quem quiser abre para escolher um, alguns
       ou todos. O pagamento continua individual por médico. */
    const agr = S.agruparRepasses(visiveis);
    const emGrupo = {};
    agr.grupos.forEach(function (g) { g.parcelas.forEach(function (p) { emGrupo[p.id] = g.chave; }); });
    const linhaGrupo = function (g) {
      const aberto = gruposAbertos.has(g.chave);
      const marcados = g.selecionaveis.filter(function (p) { return selecionadas.has(p.id); }).length;
      const todos = g.selecionaveis.length > 0 && marcados === g.selecionaveis.length;
      return '<tr class="linha-grupo' + (marcados ? ' sel' : '') + '">' +
        '<td>' + (g.selecionaveis.length
          ? '<input type="checkbox" style="width:auto" data-grupo-sel="' + g.chave + '"' +
            (todos ? ' checked' : '') + (marcados && !todos ? ' data-parcial="1"' : '') + '>'
          : '') + '</td>' +
        '<td class="desc"><button class="btn-abrir" data-grupo="' + g.chave + '">' +
          (aberto ? '▾' : '▸') + '</button> <b>' + U.esc(S.nomeDoGrupo(g)) + '</b>' +
          '<div class="sub">' + g.medicos + ' médicos' +
            (marcados ? ' · ' + marcados + ' selecionado(s)' : '') +
            (g.em_curso ? ' · ' + g.em_curso + ' aguardando aprovação' : '') +
            (g.pagas ? ' · ' + g.pagas + ' pago(s)' : '') + '</div></td>' +
        '<td class="sub">' + U.esc((g.projeto || {}).curto || '') + '</td>' +
        '<td class="num">' + U.brl(g.valor) + '</td>' +
        '<td class="num">' + U.brl(g.saldo) + '</td>' +
        '<td class="mono">' + U.fData(g.venc) + '</td>' +
        '<td class="mono sub">' + U.esc(g.doc) + '</td>' +
        '<td class="desc sub">Fechamento de produtividade — pagamento individual por médico</td>' +
        '<td class="col-situacao"><span class="badge b-aberto">' + g.medicos + ' títulos</span></td>' +
        '<td class="col-acoes"><div class="acoes">' +
          '<button class="btn-sm" data-grupo="' + g.chave + '">' + (aberto ? 'Fechar' : 'Ver médicos') + '</button>' +
        '</div></td></tr>';
    };

    const html = [];
    /* Os grupos aparecem no lugar da primeira parcela deles, para a
       ordem da lista (vencimento, valor) continuar valendo. */
    const jaDesenhado = {};
    visiveis.forEach(function (p) {
      const k = emGrupo[p.id];
      if (!k) { html.push(linhaParcela(p)); return; }
      const g = agr.grupos.find(function (x) { return x.chave === k; });
      if (!jaDesenhado[k]) {
        jaDesenhado[k] = true;
        html.push(linhaGrupo(g));
      }
      if (gruposAbertos.has(k)) html.push(linhaParcela(p, true));
    });
    tb.innerHTML = html.join('') +
      (lista.length > visiveis.length
        ? '<tr><td colspan="11" style="text-align:center;padding:10px">' +
          '<button class="btn-sm" id="ct-mais">Mostrar mais ' +
          Math.min(PAGINA, lista.length - visiveis.length) + ' de ' +
          (lista.length - visiveis.length) + ' restantes</button></td></tr>'
        : '');

    function linhaParcela(p, dentroDeGrupo) {
      const saldo = S.saldoDe(p);
      const atraso = (p.status === 'aberto' || p.status === 'parcial') && p.venc < hoje ? U.diasEntre(p.venc, hoje) : 0;
      const centro = D.centro(p.centro) || {};
      const conta = D.conta(p.conta) || {};
      const podeAprovarLanc = p.aprovacao === 'pendente' && p.status !== 'cancelado' && S.pode('aprovar');
      const trava = p.status === 'previsto'
        ? ['previsão de despesa — lance o título quando a conta chegar']
        : p.status === 'substituido' ? [] : S.impedimentos(p);
      /* A caixa de seleção segue a mesma regra do botão Pagar: falta de
         dado bancário não tira o título da seleção em lote (era por
         isso que "marcar vencidas e de hoje" pulava justamente os que
         precisavam de atenção). A trava vive na remessa. */
      const podeSolicitar = S.pode('pagar') && p.aprovacao === 'aprovado' &&
        p.status !== 'cancelado' && p.status !== 'pago' && !S.emCursoDe(p.id).length &&
        saldo > 0;
      const podeSel = podeAprovarLanc || podeSolicitar;
      const centros = (p.rateio || []).map(function (r) {
        return ((D.centro(r.centro) || {}).curto || '?') + ((p.rateio || []).length > 1 ? ' ' + U.num(r.pct) + '%' : '');
      }).join(' · ');
      const titulo = S.descricaoVisivel(p) +
        (p.doc ? ' · título ' + p.doc : '') +
        (naturezasTexto(p) ? ' · naturezas: ' + naturezasTexto(p) : (conta.cod ? ' · ' + conta.cod + ' ' + conta.nome : '')) +
        (centros ? ' · ' + centros : '') +
        ' · comp. ' + U.fComp(p.comp) + ' · emissão ' + U.fData(p.emissao) +
        (S.obsVisivel(p) ? ' · ' + S.obsVisivel(p) : '');

      return '<tr class="' + (selecionadas.has(p.id) ? 'sel ' : '') +
        (dentroDeGrupo ? 'linha-filha ' : '') + (p.status === 'cancelado' ? 'cancelada' : '') + '">' +
        '<td>' + (podeSel
          ? '<input type="checkbox" style="width:auto" data-sel="' + p.id + '"' + (selecionadas.has(p.id) ? ' checked' : '') + '>'
          : '') + '</td>' +
        '<td class="desc">' + U.esc(S.nomeCredorVisivel(p, ERP.lancamento.nomeCredor(p.credor) || '—')) + '</td>' +
        '<td class="sub" title="' + U.esc(centros || '') + '">' + U.esc((centros || '—').slice(0, 14)) +
          (centros && centros.length > 14 ? '…' : '') + '</td>' +
        '<td class="num">' + U.brl(p.valor) + '</td>' +
        '<td class="num">' + (p.status === 'cancelado' ? '—' : U.brl(saldo)) + '</td>' +
        '<td class="mono">' + U.fData(p.venc) + (atraso ? ' <span class="atraso">' + atraso + 'd</span>' : '') + '</td>' +
        '<td class="mono col-baixa"' + (abaContas === 'pagas' ? '' : ' style="display:none"') + '>' +
          (p.pago_em ? U.fData(p.pago_em) : '—') + '</td>' +
        /* Por qual conta saiu o dinheiro: a contabilidade pede o
           movimento separado por banco, e a busca do dia a dia é achar
           o pagamento de uma conta específica. */
        '<td class="sub col-banco"' + (abaContas === 'pagas' ? '' : ' style="display:none"') + '>' +
          (function () {
            const b = S.bancoDaParcela(p);
            const c = b ? (D.banco(b) || {}) : null;
            if (!c) return '—';
            const e = D.empresaPor(c.empresa);
            return '<span title="' + U.esc(c.apelido + (e ? ' · ' + e.apelido : '')) + '">' +
              U.esc(c.apelido) + '</span>';
          })() + '</td>' +
        '<td class="mono" title="' + U.esc(p.doc || '') + '">' + U.esc(refCurta(p.doc)) +
          (p.total > 1 ? ' <span class="sub">' + p.num + '/' + p.total + '</span>' : '') + '</td>' +
        '<td class="desc" title="' + U.esc(titulo) + '">' + U.esc(S.descricaoVisivel(p)) + '</td>' +
        /* A coluna de situação era a mais larga da tabela e empurrava
           os botões para fora da tela. O detalhe do que falta foi para
           o title (aparece ao passar o mouse) e para a ficha do
           título; aqui fica só o selo. */
        '<td class="col-situacao"><span class="badge b-' + p.status + '">' + rotStatus[p.status] + '</span>' +
          (trava.length && p.status !== 'pago' && p.status !== 'cancelado'
            ? '<div><span class="badge b-aguardando" title="' + U.esc(trava.join(' · ')) +
              '">falta p/ remessa</span></div>'
            : '') +
          /* O número da NF já aparece na coluna "Série / título": aqui
             repetir "NF 4471 (sem arquivo)" só alargava a coluna. Fica
             um selo curto, com o detalhe no title. */
          (S.pagoSemNota(p) ? '<div class="sub erro">pago sem NF</div>'
            : (p.sem_nf && p.status !== 'cancelado' ? '<div class="sub">sem NF</div>'
              : (p.doc && !p.arquivo && !p.chave && p.status !== 'cancelado'
                ? '<div class="sub" title="NF ' + U.esc(p.doc) + ' sem arquivo anexado">sem anexo</div>' : ''))) + '</td>' +
        '<td class="col-acoes"><div class="acoes">' + acoes(p, trava) + '</div></td>' +
      '</tr>';
    }

    if (U.el('ct-mais')) {
      U.el('ct-mais').addEventListener('click', function () { mostrando += PAGINA; render(); });
    }
    /* Abrir e fechar o grupo, e marcar o grupo inteiro de uma vez. */
    tb.querySelectorAll('[data-grupo]').forEach(function (b) {
      b.addEventListener('click', function () {
        const k = this.dataset.grupo;
        gruposAbertos.has(k) ? gruposAbertos.delete(k) : gruposAbertos.add(k);
        render();
      });
    });
    tb.querySelectorAll('[data-grupo-sel]').forEach(function (chk) {
      if (chk.dataset.parcial) chk.indeterminate = true;
      chk.addEventListener('change', function () {
        const g = agr.grupos.find(function (x) { return x.chave === this.dataset.grupoSel; }.bind(this));
        if (!g) return;
        g.selecionaveis.forEach(function (p) {
          this.checked ? selecionadas.add(p.id) : selecionadas.delete(p.id);
        }.bind(this));
        render();
      });
    });

    tb.querySelectorAll('[data-sel]').forEach(chk => {
      chk.addEventListener('change', function () {
        this.checked ? selecionadas.add(this.dataset.sel) : selecionadas.delete(this.dataset.sel);
        render();
      });
    });
    tb.querySelectorAll('[data-acao]').forEach(b => {
      b.addEventListener('click', function () {
        const { acao, id } = this.dataset;
        ({ aprovar: aprovarUma, reprovar: abrirReprovar, pagar: abrirBaixa,
           autorizar: autorizarUm, desfazer: desfazerSolicitacao,
           editar: abrirEditar, efetivar: abrirEfetivar,
           cancelar: abrirCancelar, ver: abrirDetalhe, nf: abrirNF })[acao](id);
      });
    });
  }

  // Na linha, só a ação principal + "Ver". Reprovar, cancelar e estornar
  // ficam dentro do detalhe, para a tabela não precisar de rolagem lateral.
  function acoes(p, trava) {
    const b = [];
    trava = trava || S.impedimentos(p);
    if (p.status !== 'cancelado') {
      if (p.status === 'aguardando') {
        if (S.pode('aprovar')) b.push(btn('Aprovar pagto', 'btn-pagar', 'autorizar', p.id));
        if (S.pode('pagar')) b.push(btn('Desfazer', 'btn-cancelar', 'desfazer', p.id));
      } else if (p.status !== 'pago' && p.status !== 'autorizado' &&
                 p.status !== 'enviado' && S.pode('pagar')) {
        /* Falta de dado bancário não esconde mais o botão: o título
           segue para aprovação e só é barrado na geração da remessa. */
        b.push(btn('Pagar', 'btn-pagar', 'pagar', p.id));
      }
      if (p.status === 'previsto' && S.pode('lancar')) {
        b.push(btn('Efetivar', 'btn-aprovar', 'efetivar', p.id));
      }
      if (S.pode('lancar') && p.status !== 'pago' && p.status !== 'previsto' &&
          p.status !== 'substituido' && !S.emCursoDe(p.id).length) {
        b.push(btn('Editar', '', 'editar', p.id));
      }
    }
    /* NF fica disponível SEMPRE, inclusive em título já pago: a nota
       costuma chegar depois do pagamento, e antes não havia por onde
       informar sem reabrir o título. */
    if (p.status !== 'cancelado') b.push(btn(S.temNota(p) ? 'NF' : 'Informar NF', '', 'nf', p.id));
    b.push(btn('Ver', '', 'ver', p.id));
    return b.join('');
  }

  const btn = (txt, cls, acao, id) =>
    '<button class="btn-sm ' + cls + '" data-acao="' + acao + '" data-id="' + id + '">' + txt + '</button>';

  /* ── nota fiscal do título ──────────────────────────────
     Ver, anexar e informar o número a QUALQUER momento (inclusive
     depois de pago — a nota quase sempre chega depois do pagamento).
     A marcação "Sem NF" é o que alimenta o alerta da página inicial, e
     ela cai sozinha quando o número ou o arquivo é informado. */
  function abrirNF(id) {
    const p = S.parcela(id);
    if (!p) return;
    let arquivoNovo;   // undefined = não mexeu
    ERP.app.modal({
      titulo: 'Nota fiscal · ' + U.esc(S.descricaoVisivel(p)),
      fecharTxt: 'Fechar',
      corpo:
        (S.pagoSemNota(p)
          ? '<div class="ajuda erro">Este título já foi pago e está marcado como sem NF. ' +
            'Informe o número (ou anexe o arquivo) pra tirar do alerta.</div>' : '') +
        '<div class="row2">' +
          '<div><label>Número da NF</label><input id="nf-doc" value="' + U.esc(p.doc || '') + '"></div>' +
          '<div><label>Chave de acesso (44 dígitos)</label><input id="nf-chave" value="' + U.esc(p.chave || '') + '"></div>' +
        '</div>' +
        '<label style="font-weight:400;margin-top:6px"><input type="checkbox" id="nf-sem" style="width:auto"' +
          (p.sem_nf ? ' checked' : '') + '> Sem NF (some do alerta só quando o número for informado)</label>' +
        '<label style="margin-top:10px">Arquivo da nota (PDF ou XML)</label>' +
        (p.arquivo
          ? '<div class="resumo-linha"><span>' + U.esc(p.arquivo.nome) + '</span>' +
            '<span class="v"><button class="btn-sm btn-aprovar" id="nf-abrir">Abrir</button> ' +
            '<button class="btn-sm btn-cancelar" id="nf-remover">Remover</button></span></div>'
          : '<div class="ajuda">Nenhum arquivo anexado.</div>') +
        '<input type="file" id="nf-arq" accept=".pdf,.xml,.jpg,.jpeg,.png" style="border:none;padding:0;margin-top:6px">',
      acoes: [{ txt: 'Salvar', cls: 'btn-aprovar', fn: function () {
        const salvar = function () {
          const r = S.informarNF(id, {
            documento: U.val('nf-doc'), chave: U.val('nf-chave'),
            sem_nf: U.el('nf-sem').checked,
            arquivo: arquivoNovo === undefined ? undefined : arquivoNovo
          });
          if (r.erro) return ERP.app.aviso(r.erro, 'erro');
          ERP.app.fecharModal();
          ERP.app.atualizarContadores();
          render();
          ERP.app.aviso(S.pagoSemNota(r.parcela) ? 'Salvo — o título continua no alerta de pago sem NF.'
            : 'Dados da nota salvos.', 'ok');
        };
        const arq = U.el('nf-arq').files && U.el('nf-arq').files[0];
        if (!arq) return salvar();
        const fr = new FileReader();
        fr.onload = function () { arquivoNovo = { nome: arq.name, dados: fr.result }; salvar(); };
        fr.readAsDataURL(arq);
      } }],
      aoAbrir: function () {
        if (U.el('nf-abrir')) U.el('nf-abrir').addEventListener('click', function () { verNota(p); });
        if (U.el('nf-remover')) U.el('nf-remover').addEventListener('click', function () {
          arquivoNovo = null;
          this.closest('.resumo-linha').innerHTML = '<span class="sub">arquivo será removido ao salvar</span>';
        });
      }
    });
  }

  /* Abrir o anexo. PDF e imagem abrem direto; XML vira um PDF de
     visualização — ninguém consegue conferir uma nota lendo XML cru, e
     o arquivo fica claramente marcado como leitura do XML, não como a
     DANFE/nota oficial. */
  function verNota(p) {
    if (!p.arquivo || !p.arquivo.dados) return ERP.app.aviso('Sem arquivo anexado.', 'erro');
    const ehXml = /\.xml$/i.test(p.arquivo.nome) || /application\/xml|text\/xml/.test(p.arquivo.dados.slice(0, 40));
    if (!ehXml) {
      const w = window.open();
      if (!w) return ERP.app.aviso('O navegador bloqueou a abertura. Libere pop-ups pra este arquivo.', 'erro');
      w.document.write('<iframe src="' + p.arquivo.dados + '" style="border:0;position:fixed;inset:0;width:100%;height:100%"></iframe>');
      w.document.title = p.arquivo.nome;
      return;
    }
    let texto = '';
    try {
      const base64 = p.arquivo.dados.split(',')[1] || '';
      texto = decodeURIComponent(escape(atob(base64)));
    } catch (e) { return ERP.app.aviso('Não consegui ler o XML anexado.', 'erro'); }
    const nf = ERP.nfe.ler(texto, { cnpjEmpresa: (D.empresa || {}).cnpj });
    if (nf.erro) return ERP.app.aviso('XML não reconhecido: ' + nf.erro, 'erro');
    pdfDoXml(nf, p);
  }

  function pdfDoXml(nf, p) {
    const d = ERP.pdf.doc({ orientacao: 'retrato' });
    const x0 = d.margem, x1 = d.largura - d.margem;
    let y = d.margem + 12;

    d.retangulo(x0, d.margem - 6, x1 - x0, 26, { preenchimento: 0.93, borda: true });
    d.texto(x0 + 8, y, 'VISUALIZAÇÃO GERADA A PARTIR DO XML', { tam: 11, negrito: true });
    y += 11;
    d.texto(x0 + 8, y, 'Não é a DANFE nem a nota oficial — é uma leitura do arquivo XML anexado ao título, ' +
      'montada pelo sistema para conferência.', { tam: 7.5, cinza: 0.35, largura: x1 - x0 - 16 });
    y += 24;

    const linha = function (rot, val, negrito) {
      if (val === undefined || val === null || val === '') return;
      d.texto(x0, y, rot, { tam: 8.5, cinza: 0.4 });
      d.texto(x0 + 120, y, String(val), { tam: 9, negrito: !!negrito, largura: x1 - x0 - 120 });
      y += 13;
    };
    d.texto(x0, y, nf.rotulo || 'Documento fiscal', { tam: 12, negrito: true }); y += 16;
    linha('Número / série', (nf.numero || '') + (nf.serie ? ' / ' + nf.serie : ''), true);
    linha('Emissão', nf.emissao ? U.fData(nf.emissao) : '');
    linha('Chave de acesso', nf.chave ? nf.chave.replace(/(\d{4})/g, '$1 ').trim() : '');
    linha('Natureza da operação', nf.natureza);
    y += 6;
    d.linha(x0, y, x1, y, { cinza: 0.6 }); y += 14;
    d.texto(x0, y, 'Emitente', { tam: 10, negrito: true }); y += 14;
    linha('Nome', (nf.emitente || {}).nome);
    linha('CNPJ/CPF', (nf.emitente || {}).documento ? U.cnpj(nf.emitente.documento) : '');
    linha('Município / UF', [(nf.emitente || {}).municipio, (nf.emitente || {}).uf].filter(Boolean).join(' / '));
    if ((nf.destinatario || {}).nome) {
      y += 4; d.texto(x0, y, 'Destinatário', { tam: 10, negrito: true }); y += 14;
      linha('Nome', nf.destinatario.nome);
      linha('CNPJ/CPF', nf.destinatario.documento ? U.cnpj(nf.destinatario.documento) : '');
    }

    if ((nf.itens || []).length) {
      y += 8; d.linha(x0, y, x1, y, { cinza: 0.6 }); y += 14;
      d.texto(x0, y, 'Itens', { tam: 10, negrito: true }); y += 14;
      d.texto(x0, y, 'Descrição', { tam: 8, negrito: true });
      d.texto(x0 + 300, y, 'Qtd', { tam: 8, negrito: true, alinhar: 'direita' });
      d.texto(x0 + 380, y, 'Unit.', { tam: 8, negrito: true, alinhar: 'direita' });
      d.texto(x1, y, 'Total', { tam: 8, negrito: true, alinhar: 'direita' });
      y += 3; d.linha(x0, y, x1, y, { cinza: 0.8 }); y += 11;
      nf.itens.slice(0, 30).forEach(function (i) {
        if (y > d.altura - 120) { d.novaPagina(); y = d.margem + 12; }
        d.texto(x0, y, i.descricao || '', { tam: 8, largura: 290 });
        d.texto(x0 + 300, y, U.num(i.qtd || 0) + (i.unidade ? ' ' + i.unidade : ''), { tam: 8, alinhar: 'direita' });
        d.texto(x0 + 380, y, U.brl(i.valorUnit || i.valor_unit || 0), { tam: 8, alinhar: 'direita' });
        d.texto(x1, y, U.brl(i.valor || 0), { tam: 8, alinhar: 'direita' });
        y += 11;
      });
      if (nf.itens.length > 30) {
        d.texto(x0, y, '… e mais ' + (nf.itens.length - 30) + ' item(ns) no XML.', { tam: 8, cinza: 0.4 });
        y += 12;
      }
    }

    if ((nf.retencoes || []).length) {
      y += 8; d.texto(x0, y, 'Retenções', { tam: 10, negrito: true }); y += 14;
      nf.retencoes.forEach(function (r) { linha(r.tributo, U.brl(r.valor)); });
    }

    y += 8; d.linha(x0, y, x1, y, { cinza: 0.6 }); y += 16;
    d.texto(x1, y, 'Valor do documento: ' + U.brl(nf.valor || 0), { tam: 12, negrito: true, alinhar: 'direita' });
    y += 18;
    d.texto(x0, y, 'Título no sistema: ' + S.descricaoVisivel(p) + ' · vencimento ' + U.fData(p.venc) +
      ' · ' + U.brl(p.valor), { tam: 8, cinza: 0.4, largura: x1 - x0 });
    d.salvar('nf-' + (nf.numero || p.doc || p.id) + '-visualizacao-xml.pdf');
    ERP.app.aviso('Visualização do XML gerada em PDF.', 'ok');
  }

  /* ── aprovação ─────────────────────────────────────────*/
  function aprovarUma(id) {
    const r = S.aprovar([id]);
    if (r.erro) return ERP.app.aviso(r.erro, 'erro');
    ERP.app.aviso('Aprovado.', 'ok');
    depois();
  }
  function aprovarLote() {
    const r = S.aprovar(Array.from(selecionadas));
    if (r.erro) return ERP.app.aviso(r.erro, 'erro');
    ERP.app.aviso(r.n + ' parcela(s) aprovada(s).', 'ok');
    selecionadas.clear();
    depois();
  }

  function desfazerSolicitacao(id) {
    const pg = S.aguardandoDe(id)[0];
    if (!pg) return ERP.app.aviso('Não há solicitação aguardando aprovação nesta parcela.', 'erro');
    const r = S.cancelarSolicitacao(pg.id);
    if (r.erro) return ERP.app.aviso(r.erro, 'erro');
    ERP.app.aviso('Solicitação desfeita — a parcela saiu da fila de aprovação.', 'ok');
    depois();
  }

  /* Solicitação em lote: o jeito que o dia a dia funciona. */
  function abrirLotePagar() {
    const alvos = Array.from(selecionadas).map(function (id) { return S.parcela(id); })
      .filter(function (p) { return p && p.aprovacao === 'aprovado' && p.status !== 'pago' && !S.emCursoDe(p.id).length; });
    if (!alvos.length) return ERP.app.aviso('Nenhuma das selecionadas pode ser paga agora.', 'erro');
    const soma = alvos.reduce(function (s, p) { return s + S.saldoDe(p); }, 0);

    ERP.app.modal({
      titulo: 'Solicitar pagamento de ' + alvos.length + ' parcela(s)',
      corpo:
        '<div class="resumo-linha"><span>Total</span><span class="v">' + U.brl(soma) + '</span></div>' +
        '<div class="row2"><div><label>Data de pagamento</label><input type="date" id="lp-data" value="' + U.hoje() + '"></div>' +
        '<div><label>Conta de saída</label><select id="lp-banco">' +
          D.bancos.map(function (b) { return '<option value="' + b.id + '">' + U.esc(b.apelido) + '</option>'; }).join('') +
        '</select></div></div>' +
        '<div class="ajuda" style="margin-top:8px">A forma de pagamento de cada parcela vem do ' +
        'cadastro do credor: ' + resumoFormas(alvos) + '. ' +
        'Juros e multa, quando houver, você lança na parcela individualmente. ' +
        'Nada sai do caixa: as solicitações vão para a fila da diretoria e, depois de aprovadas, ' +
        'para a aba de remessa bancária.</div>',
      acoes: [{ txt: 'Enviar para aprovação', cls: 'btn-pagar', fn: function () {
        const r = S.solicitarLote(alvos.map(function (p) { return p.id; }), {
          data: U.val('lp-data'), banco: U.val('lp-banco')
        });
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        selecionadas.clear();
        ERP.app.aviso(r.n + ' pagamento(s) solicitado(s), ' + U.brl(r.valor) +
          ' — aguardando aprovação da diretoria.' + (r.erros.length ? ' ' + r.erros.length + ' não entraram.' : ''), 'ok');
        depois();
      } }]
    });
  }

  function resumoFormas(alvos) {
    const cont = {};
    alvos.forEach(function (p) {
      const f = S.formaDoCredor(p.credor);
      const k = f ? f.nome : 'sem forma';
      cont[k] = (cont[k] || 0) + 1;
    });
    return Object.keys(cont).map(function (k) { return cont[k] + ' por ' + k; }).join(', ');
  }

  function selecionarVencidas() {
    const alvo = S.listar(filtros()).filter(function (p) {
      return podeSelecionar(p) && p.venc <= U.hoje();
    });
    alvo.forEach(function (p) { selecionadas.add(p.id); });
    ERP.app.aviso(alvo.length + ' parcela(s) vencida(s) ou de hoje marcada(s).', 'ok');
    render();
  }

  function autorizarUm(id) {
    const pg = S.aguardandoDe(id)[0];
    if (!pg) return ERP.app.aviso('Não há pagamento aguardando autorização nesta parcela.', 'erro');
    const r = S.autorizarPagamento([pg.id]);
    if (r.erro) return ERP.app.aviso(r.erro, 'erro');
    ERP.app.aviso('Pagamento autorizado.', 'ok');
    depois();
  }

  function abrirRecusarPagamento(pagId) {
    ERP.app.modal({
      titulo: 'Recusar pagamento',
      corpo: '<div class="ajuda" style="margin-bottom:8px">A parcela volta ao estado anterior e continua em aberto.</div>' +
             '<label>Motivo</label><textarea id="mo-motivo" placeholder="Ex.: valor divergente do fechamento"></textarea>',
      acoes: [{ txt: 'Recusar pagamento', cls: 'btn-cancelar', fn: () => {
        const r = S.recusarPagamento(pagId, U.val('mo-motivo'));
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal(); ERP.app.aviso('Pagamento recusado — a parcela voltou para a fila.', 'ok'); depois();
      } }]
    });
  }

  function abrirReprovar(id) {
    ERP.app.modal({
      titulo: 'Reprovar lançamento',
      corpo: '<label>Motivo</label><textarea id="mo-motivo" placeholder="O que precisa ser corrigido"></textarea>' +
             '<div class="ajuda">O motivo volta para quem lançou. Nada é apagado.</div>',
      acoes: [{ txt: 'Reprovar', cls: 'btn-cancelar', fn: () => {
        const r = S.reprovar(id, U.val('mo-motivo'));
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal(); ERP.app.aviso('Reprovado.', 'ok'); depois();
      } }]
    });
  }

  /* Confirmação do pagamento entre empresas do grupo. Mostra quem
     paga, quem deve, e deixa registrar — ou voltar atrás e escolher
     outra conta. */
  function confirmarCruzamento(id, dados, r, depois) {
    const cz = r.cruzamento || {};
    ERP.app.modal({
      titulo: 'Pagamento entre empresas do grupo',
      fecharTxt: 'Voltar e trocar a conta',
      corpo:
        '<div class="destaque">' +
          '<div class="resumo-linha"><span>Nota em nome de</span><span class="v">' +
            U.esc(cz.tomadora_nome || '—') + '</span></div>' +
          '<div class="resumo-linha"><span>Pagamento sai da conta de</span><span class="v">' +
            U.esc(cz.pagadora_nome || '—') + '</span></div>' +
          '<div class="resumo-linha"><span>Valor</span><span class="v">' +
            U.brl(dados.valor + dados.juros + dados.multa) + '</span></div>' +
        '</div>' +
        '<div class="ajuda">Confirmando, o sistema registra uma <b>conta corrente</b> entre as ' +
        'duas empresas: a ' + U.esc(cz.pagadora_nome || '') + ' passa a ter a receber da ' +
        U.esc(cz.tomadora_nome || '') + '. Isso não é classificação de custo, e não substitui ' +
        'o acerto entre elas.</div>' +
        '<label>Observação (opcional)</label>' +
        '<input id="cz-obs" placeholder="Ex.: acerto na transferência do dia 30">',
      acoes: [{ txt: 'Confirmar e registrar o mútuo', cls: 'btn-pagar', fn: function () {
        const obs = U.val('cz-obs');
        const d2 = Object.assign({}, dados, { confirmar_cruzamento: true });
        if (obs) d2.obs = obs;
        const r2 = S.registrarPagamento(id, d2);
        if (r2.erro) return ERP.app.aviso(r2.erro, 'erro');
        ERP.app.fecharModal();
        ERP.app.aviso('Pagamento solicitado, com a conta corrente entre as empresas registrada.', 'ok');
        if (depois) depois();
      } }]
    });
  }

  /* ── baixa ─────────────────────────────────────────────*/
  function abrirBaixa(id) {
    const p = S.parcela(id);
    const saldo = S.saldoDe(p);
    ERP.app.modal({
      titulo: 'Solicitar pagamento',
      corpo:
        '<div class="resumo-linha"><span>' + U.esc(S.descricaoVisivel(p)) + (p.total > 1 ? ' · ' + p.num + '/' + p.total : '') + '</span>' +
          '<span class="v">' + U.brl(p.valor) + '</span></div>' +
        '<div class="resumo-linha"><span>Saldo em aberto</span><span class="v">' + U.brl(saldo) + '</span></div>' +
        '<div class="row2"><div><label>Data do pagamento</label><input type="date" id="pg-data" value="' + U.hoje() + '"></div>' +
        '<div><label>Valor pago (principal)</label><input id="pg-valor" class="num" inputmode="decimal" value="' + U.num(saldo) + '"></div></div>' +
        '<div class="row3"><div><label>Juros</label><input id="pg-juros" class="num" inputmode="decimal" value="0,00"></div>' +
        '<div><label>Multa</label><input id="pg-multa" class="num" inputmode="decimal" value="0,00"></div>' +
        '<div><label>Desconto</label><input id="pg-desc" class="num" inputmode="decimal" value="0,00"></div></div>' +
        '<div class="row2"><div><label>Conta de saída</label><select id="pg-banco">' +
          D.bancos.map(b => '<option value="' + b.id + '">' + U.esc(b.apelido) + '</option>').join('') +
        '</select></div>' +
        '<div><label>Forma (do cadastro do credor)</label>' +
          '<input value="' + U.esc((S.formaDoCredor(p.credor) || {}).nome || 'não configurada') + '" disabled></div></div>' +
        '<label>Comprovante / autenticação</label><input id="pg-doc" placeholder="opcional">' +
        '<div class="destaque" id="pg-resumo"></div>',
      acoes: [{ txt: 'Enviar para autorização', cls: 'btn-pagar', fn: () => {
        /* Lê os campos ANTES de abrir qualquer outro modal: o
           modal de confirmação substitui este, e aí os campos já
           não existem mais no DOM. */
        const dados = {
          data: U.val('pg-data'), valor: U.parseValor(U.val('pg-valor')),
          juros: U.parseValor(U.val('pg-juros')), multa: U.parseValor(U.val('pg-multa')),
          desconto: U.parseValor(U.val('pg-desc')), banco: U.val('pg-banco'),
          doc: U.val('pg-doc')
        };
        const r = S.registrarPagamento(id, dados);

        /* Conta corrente entre empresas: o store recusa e devolve o
           vínculo. Antes disto o aviso aparecia e NÃO havia como
           confirmar — clicar de novo só repetia o aviso, e o
           pagamento nunca entrava. Regra pela metade trava o
           trabalho sem proteger nada. */
        if (r.erro && r.cruzamento) return confirmarCruzamento(id, dados, r, depois);

        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        ERP.app.aviso('Pagamento solicitado. Aguardando aprovação da diretoria ou do sócio.', 'ok');
        depois();
      } }],
      aoAbrir: () => {
        // ao digitar desconto, o principal cai para saldo - desconto:
        // é o desconto que quita o resto, sem sair do caixa
        U.el('pg-desc').addEventListener('change', function () {
          const dd = U.parseValor(this.value);
          const novo = Math.max(0, Math.round((saldo - dd) * 100) / 100);
          U.setVal('pg-valor', U.num(novo));
          calc();
        });
        const calc = () => {
          const v = U.parseValor(U.val('pg-valor')), j = U.parseValor(U.val('pg-juros')),
                m = U.parseValor(U.val('pg-multa')), d = U.parseValor(U.val('pg-desc'));
          const resta = Math.round((saldo - v - d) * 100) / 100;
          U.el('pg-resumo').innerHTML =
            '<div class="resumo-linha"><span>Sai do banco</span><span class="v">' + U.brl(v + j + m) + '</span></div>' +
            '<div class="resumo-linha"><span>Quita da parcela</span><span class="v">' + U.brl(v + d) +
              (d > 0 ? ' <span class="sub">(' + U.brl(v) + ' + ' + U.brl(d) + ' de desconto)</span>' : '') + '</span></div>' +
            '<div class="resumo-linha"><span>Saldo depois desta baixa</span><span class="v">' + U.brl(resta) + '</span></div>' +
            '<div class="ajuda">A solicitação vai para a diretoria aprovar e, depois, para a remessa bancária. ' +
            'Nada sai do caixa antes disso.</div>' +
            (j + m > 0 ? '<div class="ajuda">Juros e multa vão para “' + D.contaJuros + ' ' + (D.conta(D.contaJuros)||{}).nome + '” na competência ' +
              U.fComp(U.val('pg-data')) + ', não na competência da parcela.</div>' : '');
        };
        ['pg-valor', 'pg-juros', 'pg-multa', 'pg-desc', 'pg-data'].forEach(i => U.el(i).addEventListener('input', calc));
        calc();
      }
    });
  }

  /* ── edição do lançamento ──────────────────────────────*/
  const umaLinhaRateio = (centroId, pct) =>
    '<div class="lin" style="grid-template-columns:2fr 90px 26px">' +
      '<select data-rt-centro>' + ERP.lancamento.opcoesCentro(centroId) + '</select>' +
      '<input class="num" data-rt-pct inputmode="decimal" value="' + U.num(pct) + '">' +
      '<button class="btn-ghost" type="button" data-rt-rem>✕</button></div>';

  const linhasRateio = p => {
    const rt = (p.rateio && p.rateio.length) ? p.rateio : [{ centro: p.centro, pct: 100 }];
    return '<div class="parcelas">' + rt.map(function (r) {
      return umaLinhaRateio(r.centro, r.pct); }).join('') + '</div>';
  };

  function abrirEditar(id) {
    const p = S.parcela(id);
    if (S.tituloSigiloso(p)) {
      return ERP.app.aviso('Título de pessoal (folha, férias, 13º, rescisão, pensão ou guia de um funcionário) — ' +
        'só quem tem acesso a dados pessoais edita. Peça ao DP, à diretoria ou ao sócio.', 'erro');
    }
    let arquivoNovo;   // undefined = sem mudança; null = removido; {dados, nome} = novo arquivo
    const grupos = D.plano.filter(function (g) { return g.nivel === 1 && g.tipo !== 'receita'; });
    const opConta = grupos.map(function (g) {
      return '<optgroup label="' + U.esc(g.cod + ' · ' + g.nome) + '">' +
        D.plano.filter(function (s) { return s.pai === g.cod; }).map(function (s) {
          return '<option value="' + s.cod + '"' + (s.cod === p.conta ? ' selected' : '') + '>' +
            U.esc(s.cod + ' ' + s.nome) + '</option>';
        }).join('') + '</optgroup>';
    }).join('');
    const forma = S.formaDoCredor(p.credor);
    const ehBoleto = forma && (forma.codigo === 'boleto' || forma.codigo === 'guia');

    ERP.app.modal({
      titulo: 'Editar lançamento' + (p.total > 1 ? ' · parcela ' + p.num + '/' + p.total : ''),
      corpo:
        (S.impedimentos(p).length
          ? '<div class="aviso" style="margin:0 0 10px">Falta para entrar na remessa: ' +
            U.esc(S.impedimentos(p).join(' · ')) +
            '. O título pode ser aprovado assim mesmo — o dado é cobrado na hora de gerar o arquivo' +
            (forma ? '.' : ', e a forma de pagamento fica no cadastro do credor.') + '</div>'
          : '') +
        '<label>Descrição</label><input id="ed-desc" value="' + U.esc(p.descricao) + '">' +
        '<div class="row2"><div><label>Nº do título</label><input id="ed-doc" value="' + U.esc(p.doc || '') + '"></div>' +
        '<div><label>Valor (R$)</label><input id="ed-valor" class="num" inputmode="decimal" value="' + U.num(p.valor) + '"></div></div>' +
        '<div class="row2"><div><label>Competência</label><input type="month" id="ed-comp" value="' + (p.comp || '') + '"></div>' +
        '<div><label>Vencimento</label><input type="date" id="ed-venc" value="' + (p.venc || '') + '"></div></div>' +
        '<label>Natureza</label><select id="ed-conta">' + opConta + '</select>' +
        '<label>Fornecedor</label><div style="display:flex;gap:6px">' +
        '<input id="ed-credor" list="dl-credores" style="flex:1" value="' +
          U.esc((D.credor(p.credor) || {}).nome || '') + '">' +
        '<button type="button" class="btn-sm" id="ed-novo-credor">+ cadastrar</button></div>' +
        /* Reclassificar centro de custo é rotina de fechamento, e antes
           não havia caminho nenhum: o texto mandava editar "pelo
           lançamento original", que não existe. */
        '<label>Centro de custo</label>' +
        '<div id="ed-rateio">' + linhasRateio(p) + '</div>' +
        '<div class="ap-acoes"><button class="btn-sm" type="button" id="ed-rateio-add">' +
          '+ dividir com outro centro</button>' +
          '<span class="sub" id="ed-rateio-soma"></span></div>' +
        (ehBoleto
          ? '<label>Código de barras / linha digitável</label>' +
            '<input id="ed-barras" inputmode="numeric" value="' + U.esc(p.linha_digitavel || p.codigo_barras || '') + '">' +
            '<div class="ajuda" id="ed-barras-info">' +
              (p.codigo_barras ? 'Atual: ' + U.esc(p.codigo_barras) : 'Sem código — o pagamento fica travado até informar.') +
            '</div>'
          : '') +
        '<label style="display:flex;gap:8px;align-items:flex-start;margin-top:10px;font-weight:400">' +
          '<input type="checkbox" id="ed-nf-dispensada" style="width:auto;margin-top:3px"' +
            (p.nf_dispensada ? ' checked' : '') + '>' +
          '<span><b>Este pagamento não exige NF.</b><br><span class="sub">Já vem marcado assim pra ' +
          'produção médica (3.01) — desmarque pra informar a chave de acesso.</span></span></label>' +
        '<div id="ed-nf-box" style="display:' + (p.nf_dispensada ? 'none' : '') + '">' +
          '<label>Chave de acesso da NF</label>' +
          '<input id="ed-nf-chave" inputmode="numeric" maxlength="44" value="' + U.esc(p.chave || '') + '" ' +
          'placeholder="44 dígitos">' +
          '<label>Arquivo da NF (PDF ou XML)</label>' +
          '<input type="file" id="ed-nf-arquivo" accept=".pdf,.xml">' +
          '<div class="ajuda" id="ed-nf-arquivo-info">' +
            (p.arquivo_dados
              ? 'Anexado: <a href="' + p.arquivo_dados + '" download="' + U.esc(p.arquivo || 'nf') +
                '" target="_blank">' + U.esc(p.arquivo || 'arquivo') + '</a> — escolher outro substitui. ' +
                '<button type="button" class="btn-ghost" id="ed-nf-remover" style="padding:0">remover</button>'
              : 'Até 5 MB. Fica só nesta sessão até a migração para o Supabase — some se a página recarregar.') +
          '</div>' +
        '</div>' +
        '<label>Observação</label><textarea id="ed-obs">' + U.esc(p.obs || '') + '</textarea>' +
        '<div class="ajuda" style="margin-top:8px">Reajuste, desconto negociado, NF corrigida, ' +
        'reclassificação de centro: toda alteração fica no histórico do lançamento, com o valor ' +
        'antigo e o novo.</div>',
      aoAbrir: function () {
        const somar = function () {
          const t = Array.from(document.querySelectorAll('[data-rt-pct]'))
            .reduce(function (a, e) { return a + U.parseValor(e.value); }, 0);
          const el = U.el('ed-rateio-soma');
          el.textContent = 'soma ' + U.num(Math.round(t * 100) / 100) + '%';
          el.className = Math.abs(t - 100) < 0.01 ? 'sub' : 'sub erro';
        };
        const ligar = function () {
          document.querySelectorAll('[data-rt-pct]').forEach(function (e) {
            e.addEventListener('input', somar);
          });
          document.querySelectorAll('[data-rt-rem]').forEach(function (b) {
            b.addEventListener('click', function () {
              const linhas = document.querySelectorAll('#ed-rateio .lin');
              if (linhas.length <= 1) return ERP.app.aviso('Tem de sobrar um centro.', 'erro');
              this.closest('.lin').remove();
              somar();
            });
          });
        };
        U.el('ed-rateio-add').addEventListener('click', function () {
          U.el('ed-rateio').insertAdjacentHTML('beforeend', umaLinhaRateio('', 0));
          ligar(); somar();
        });
        U.el('ed-novo-credor').addEventListener('click', function () {
          ERP.lancamento.abrirCadastroRapido(U.val('ed-credor'), function (id, nome) {
            U.setVal('ed-credor', nome);
          }, U.val('ed-conta'));
        });
        U.el('ed-nf-dispensada').addEventListener('change', function () {
          U.el('ed-nf-box').style.display = this.checked ? 'none' : '';
        });
        if (U.el('ed-nf-arquivo')) {
          U.el('ed-nf-arquivo').addEventListener('change', function (e) {
            const arq = e.target.files && e.target.files[0];
            if (!arq) return;
            if (arq.size > 5 * 1024 * 1024) {
              ERP.app.aviso('Arquivo maior que 5 MB — reduza (ou comprima o PDF) antes de anexar.', 'erro');
              e.target.value = '';
              return;
            }
            const fr = new FileReader();
            fr.onload = function () {
              arquivoNovo = { dados: fr.result, nome: arq.name };
              U.el('ed-nf-arquivo-info').textContent = 'Vai anexar "' + arq.name + '" ao salvar.';
            };
            fr.readAsDataURL(arq);
          });
        }
        if (U.el('ed-nf-remover')) {
          U.el('ed-nf-remover').addEventListener('click', function () {
            arquivoNovo = null;
            U.el('ed-nf-arquivo-info').textContent = 'Anexo será removido ao salvar.';
          });
        }
        ligar(); somar();
      },
      acoes: [{ txt: 'Salvar alterações', cls: 'btn-aprovar', fn: function () {
        const nomeCr = U.val('ed-credor');
        const credorId = nomeCr ? S.credorPorNome(nomeCr, U.val('ed-conta')) : p.credor;
        const rateio = Array.from(document.querySelectorAll('#ed-rateio .lin')).map(function (l) {
          return { centro: l.querySelector('[data-rt-centro]').value,
                   pct: U.parseValor(l.querySelector('[data-rt-pct]').value) };
        }).filter(function (r) { return r.centro && r.pct > 0; });
        const nfDispensada = U.el('ed-nf-dispensada').checked;
        const dados = {
          descricao: U.val('ed-desc'), doc: U.val('ed-doc'),
          valor: U.parseValor(U.val('ed-valor')), comp: U.val('ed-comp'),
          venc: U.val('ed-venc'), conta: U.val('ed-conta'), obs: U.val('ed-obs'),
          credor: credorId, rateio: rateio,
          nf_dispensada: nfDispensada, chave: nfDispensada ? null : (U.val('ed-nf-chave') || null)
        };
        if (arquivoNovo !== undefined) {
          dados.arquivo_dados = arquivoNovo ? arquivoNovo.dados : null;
          dados.arquivo = arquivoNovo ? arquivoNovo.nome : null;
        }
        if (ehBoleto) {
          const bruto = U.val('ed-barras');
          if (bruto) {
            const lido = ERP.boleto.ler(bruto);
            if (lido.erro) return ERP.app.aviso(lido.erro, 'erro');
            dados.codigo_barras = lido.codigoBarras;
            dados.linha_digitavel = lido.linhaDigitavel || '';
          }
        }
        const r = S.editarParcela(id, dados);
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        ERP.app.aviso(r.n ? r.n + ' alteração(ões) salva(s): ' + r.mudou[0] : 'Nada mudou.', 'ok');
        depois();
      } }]
    });
  }

  /* ── efetivar previsão ─────────────────────────────────
     A conta chegou: o título previsto recebe fornecedor, valor real,
     vencimento e código de barras, e vira título comum. Leitor USB
     funciona como teclado — basta clicar no campo e bipar o boleto. */
  function abrirEfetivar(id) {
    const p = S.parcela(id);
    const conta = D.conta(p.conta) || {};
    let lido = null;

    /* Tipos genéricos de conta a pagar avulsa. Um título que já nasceu
       com um tipo mais específico (folha, férias, 13º, rescisão — o
       módulo de Pessoal fecha assim) não é um desses quatro, e o
       dropdown não tinha opção pra manter o tipo original: a pessoa
       efetivava sem mexer no campo e o título virava "Fatura" sem
       querer, perdendo a classificação de origem. Agora, se o tipo
       atual não é um dos quatro genéricos, ele entra como a primeira
       opção (selecionada), e continua assim a menos que alguém troque
       de propósito. */
    const TIPOS_GENERICOS = { boleto: 'Boleto', fatura: 'Fatura', nf: 'NF', guia: 'Guia' };
    const TIPOS_ESPECIFICOS = { folha: 'Folha de pagamento', ferias: 'Férias', decimo: '13º salário', rescisao: 'Rescisão' };
    const opcoesTipo = [];
    if (p.tipo_titulo && !TIPOS_GENERICOS[p.tipo_titulo]) {
      opcoesTipo.push([p.tipo_titulo, (TIPOS_ESPECIFICOS[p.tipo_titulo] || p.tipo_titulo) + ' (manter)']);
    }
    Object.keys(TIPOS_GENERICOS).forEach(function (k) { opcoesTipo.push([k, TIPOS_GENERICOS[k]]); });

    ERP.app.modal({
      titulo: 'Efetivar previsão · ' + (S.descricaoVisivel(p) || ''),
      corpo:
        '<div class="resumo-linha"><span>Previsto</span><span class="v">' + U.brl(p.valor) +
          ' em ' + U.fData(p.venc) + '</span></div>' +
        '<div class="resumo-linha"><span>Natureza</span><span class="v">' +
          U.esc(p.conta + ' ' + (conta.nome || '')) + '</span></div>' +
        '<label>Fornecedor *</label><div style="display:flex;gap:6px">' +
        '<input id="ef-credor" list="dl-credores" style="flex:1" value="' +
          U.esc(p.credor ? (D.credor(p.credor) || {}).nome || '' : '') + '" ' +
          'placeholder="quem emitiu a conta">' +
        '<button type="button" class="btn-sm" id="ef-novo-credor">+ cadastrar</button></div>' +
        '<div id="ef-forma" class="ajuda"></div>' +
        '<div class="row3"><div><label>Valor da conta *</label>' +
          '<input id="ef-valor" class="num" inputmode="decimal" value="' + U.num(p.valor) + '"></div>' +
        '<div><label>Vencimento *</label><input type="date" id="ef-venc" value="' + (p.venc || '') + '"></div>' +
        '<div><label>Tipo</label><select id="ef-tipo">' +
          opcoesTipo.map(function (t) {
            return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('') + '</select></div></div>' +
        '<div class="row2"><div><label>Nº do documento</label><input id="ef-doc"></div>' +
        '<div><label>Competência</label><input type="month" id="ef-comp" value="' + (p.comp || '') + '"></div></div>' +
        '<div id="ef-barras-box" style="display:none">' +
          '<label>Código de barras / linha digitável</label>' +
          '<input id="ef-barras" inputmode="numeric" autocomplete="off" ' +
            'placeholder="passe o leitor no boleto ou digite os 47 dígitos">' +
          '<div class="ajuda">Leitor USB funciona como teclado: clique no campo e bipe. O sistema ' +
          'valida, extrai vencimento e valor do próprio código e guarda as 44 posições da remessa.</div>' +
          '<div id="ef-info"></div>' +
        '</div>',
      acoes: [{ txt: 'Efetivar título', cls: 'btn-aprovar', fn: function () {
        const nome = U.val('ef-credor');
        if (!nome) return ERP.app.aviso('Informe o fornecedor.', 'erro');
        const credorId = S.credorPorNome(nome, p.conta);
        const r = S.efetivarPrevisto(id, {
          credor: credorId, valor: U.parseValor(U.val('ef-valor')), venc: U.val('ef-venc'),
          comp: U.val('ef-comp'), doc: U.val('ef-doc'), tipo_titulo: U.val('ef-tipo'),
          codigo_barras: lido ? lido.codigoBarras : null,
          linha_digitavel: lido ? (lido.linhaDigitavel || '') : null
        });
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        if (r.exige_aprovacao) ERP.app.aviso('Título efetivado, mas o credor ou o valor mudou em relação ao previsto — voltou para aprovação antes do pagamento.', 'erro'); else
        ERP.app.aviso('Título efetivado' +
          (r.diferenca ? ' — ' + (r.diferenca > 0 ? 'R$ ' + U.num(r.diferenca) + ' acima'
                                                  : 'R$ ' + U.num(-r.diferenca) + ' abaixo') + ' do previsto'
                       : '') + '. Já entra na seleção de pagamento.', 'ok');
        depois();
      } }],
      aoAbrir: function () {
        /* O que o título precisa depende da FORMA do fornecedor: boleto e
           guia pedem código de barras; PIX, TED, débito e dinheiro não —
           o dado deles já está no cadastro. */
        const mostrarForma = function () {
          const nome = U.val('ef-credor');
          const cr = D.credores.find(function (x) {
            return x.nome.toUpperCase() === nome.toUpperCase(); });
          const box = U.el('ef-barras-box');
          if (!cr) {
            U.el('ef-forma').innerHTML = nome
              ? '<span class="sub">Fornecedor novo — é cadastrado ao efetivar, mas sem forma de ' +
                'pagamento o título nasce travado. Complete em Cadastros › Fornecedores depois.</span>'
              : '';
            box.style.display = 'none';
            return;
          }
          const f = S.formaDoCredor(cr.id);
          if (!f) {
            U.el('ef-forma').innerHTML = '<span class="erro">' + U.esc(cr.nome) +
              ' está sem forma de pagamento no cadastro: o título vai nascer travado. ' +
              'Configure em Cadastros › Fornecedores.</span>';
            box.style.display = 'none';
            return;
          }
          const precisaBarras = f.codigo === 'boleto' || f.codigo === 'guia';
          box.style.display = precisaBarras ? '' : 'none';
          U.el('ef-forma').innerHTML = 'Forma de pagamento: <b>' + U.esc(f.nome) + '</b>' +
            (f.codigo === 'pix'
              ? (cr.pix ? ' · chave ' + U.esc(cr.pix) + (cr.tipo_chave ? ' (' + U.esc(cr.tipo_chave) + ')' : '')
                        : ' <span class="erro">— sem chave PIX no cadastro</span>')
              : f.codigo === 'ted'
                ? (cr.documento ? ' · CPF/CNPJ ' + U.esc(cr.documento)
                                : ' <span class="erro">— sem CPF/CNPJ no cadastro</span>')
                : precisaBarras ? ' · informe o código de barras abaixo'
                : ' · não passa por remessa: o pagamento é confirmado na mão');
          if (precisaBarras && U.val('ef-tipo') !== 'guia') U.setVal('ef-tipo', 'boleto');
          if (!precisaBarras && U.val('ef-tipo') === 'boleto') U.setVal('ef-tipo', 'fatura');
        };
        U.el('ef-credor').addEventListener('change', mostrarForma);
        U.el('ef-credor').addEventListener('blur', mostrarForma);
        U.el('ef-novo-credor').addEventListener('click', function () {
          ERP.lancamento.abrirCadastroRapido(U.val('ef-credor'), function (id, nome) {
            U.setVal('ef-credor', nome);
          }, p.conta);
        });
        mostrarForma();

        const ler = function () {
          const bruto = U.val('ef-barras');
          if (!bruto) { lido = null; U.el('ef-info').innerHTML = ''; return; }
          const r = ERP.boleto.ler(bruto);
          if (r.erro) {
            lido = null;
            U.el('ef-info').innerHTML = '<div class="ajuda erro">' + U.esc(r.erro) + '</div>';
            return;
          }
          lido = r;
          if (r.valor > 0) U.setVal('ef-valor', U.num(r.valor));
          if (r.vencimento) U.setVal('ef-venc', r.vencimento);
          if (r.linhaDigitavel) U.setVal('ef-barras', ERP.boleto.formatar(r.linhaDigitavel));
          U.setVal('ef-tipo', r.tipo === 'arrecadacao' ? 'guia' : 'boleto');
          U.el('ef-info').innerHTML = '<div class="nf-lida">' +
            (r.tipo === 'arrecadacao' ? '<b>Guia de arrecadação</b>' : '<b>Boleto do banco ' + U.esc(r.banco) + '</b>') +
            (r.vencimento ? ' · vence ' + U.fData(r.vencimento) : '') + ' · ' + U.brl(r.valor) +
            '<div class="chave">' + U.esc(r.codigoBarras) + '</div></div>';
        };
        U.el('ef-barras').addEventListener('change', ler);
        U.el('ef-barras').addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); ler(); }   // o leitor manda Enter no fim
        });
        ERP.lancamento.atualizarCredores();
      }
    });
  }

  /* ── cancelamento ──────────────────────────────────────*/
  function abrirCancelar(id) {
    ERP.app.modal({
      titulo: 'Cancelar lançamento',
      corpo: '<div class="ajuda" style="margin-bottom:8px">Cancelar não apaga: a parcela some das somas e fica no histórico.</div>' +
             '<label>Motivo</label><textarea id="mo-motivo" placeholder="Ex.: lançado em duplicidade"></textarea>',
      acoes: [{ txt: 'Cancelar lançamento', cls: 'btn-cancelar', fn: () => {
        const r = S.cancelar(id, U.val('mo-motivo'));
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        ERP.app.aviso('Lançamento cancelado.' + (r.aviso_retencao ? ' ' + r.aviso_retencao : ''), r.aviso_retencao ? 'erro' : 'ok');
        depois();
      } }]
    });
  }

  /* ── detalhe / histórico ───────────────────────────────*/
  function abrirDetalhe(id) {
    const p = S.parcela(id);
    const pagtos = S.pagamentosTodos(id);
    const evs = S.eventosDe(id);
    const conta = D.conta(p.conta) || {}, grupo = D.grupoDe(p.conta) || {};

    ERP.app.modal({
      titulo: 'Parcela ' + p.num + '/' + p.total + ' · ' + S.descricaoVisivel(p),
      corpo:
        '<div class="resumo-linha"><span>Credor</span><span class="v">' + U.esc(ERP.lancamento.nomeCredor(p.credor) || '—') + '</span></div>' +
        '<div class="resumo-linha"><span>Conta</span><span class="v">' + U.esc(naturezasTexto(p) || ((grupo.nome || '') + ' › ' + (conta.nome || '—'))) + '</span></div>' +
        '<div class="resumo-linha"><span>Título</span><span class="v">' + U.esc(p.doc || '—') + ' · ' +
          U.esc(rotTipo[p.tipo_titulo] || p.tipo_titulo || '') + '</span></div>' +
        '<div class="resumo-linha"><span>Emissão</span><span class="v">' + U.fData(p.emissao) + '</span></div>' +
        '<div class="resumo-linha"><span>Forma de pagamento</span><span class="v">' +
          U.esc((S.formaDoCredor(p.credor) || {}).nome || 'não configurada no cadastro do credor') + '</span></div>' +
        (p.codigo_barras ? '<div class="resumo-linha"><span>Código de barras</span>' +
          '<span class="v" style="font-size:11px;word-break:break-all">' + U.esc(p.codigo_barras) + '</span></div>' : '') +
        (S.impedimentos(p).length ? '<div class="ajuda">Falta para o arquivo do banco: ' +
          U.esc(S.impedimentos(p).join(' · ')) + '. Não impede aprovar.</div>' : '') +
        '<div class="resumo-linha"><span>Centro de custo</span><span class="v">' +
          (p.rateio || []).map(function (r) {
            return U.esc((D.centro(r.centro) || {}).nome || '—') + ' — ' + U.num(r.pct) + '% · ' +
                   U.brl(S.valorNoCentro(p, r.centro));
          }).join('<br>') + '</span></div>' +
        '<div class="resumo-linha"><span>Competência (DRE)</span><span class="v">' + U.fComp(p.comp) + '</span></div>' +
        '<div class="resumo-linha"><span>Vencimento (caixa previsto)</span><span class="v">' + U.fData(p.venc) + '</span></div>' +
        '<div class="resumo-linha"><span>Valor</span><span class="v">' + U.brl(p.valor) + '</span></div>' +
        '<div class="resumo-linha"><span>Saldo</span><span class="v">' + U.brl(S.saldoDe(p)) + '</span></div>' +
        (p.chave ? '<div class="resumo-linha"><span>Chave da NF</span><span class="v" style="font-size:11px;word-break:break-all">' + U.esc(p.chave) + '</span></div>' : '') +
        (p.arquivo ? '<div class="resumo-linha"><span>Arquivo</span><span class="v">' + U.esc(p.arquivo) + '</span></div>' : '') +
        (p.motivo ? '<div class="ajuda">Reprovado: ' + U.esc(p.motivo) + '</div>' : '') +
        (p.motivo_cancelamento ? '<div class="ajuda">Cancelado: ' + U.esc(p.motivo_cancelamento) + '</div>' : '') +
        composicao(p) + notaFiscal(p) +
        '<h2 style="margin-top:16px;font-size:12px">Pagamentos</h2>' +
        (pagtos.length ? '<table><tbody>' + pagtos.map(function (pg) {
          const rot = { aguardando: 'aguardando aprovação', autorizado: 'aprovado — na fila da remessa',
                        enviado: 'enviado ao banco', liquidado: 'liquidado',
                        recusado: 'recusado', cancelado: 'solicitação desfeita' };
          const cls = { aguardando: 'b-pendente', autorizado: 'b-aguardando', enviado: 'b-aguardando',
                        liquidado: 'b-pago', recusado: 'b-reprovado', cancelado: 'b-cancelado' };
          return '<tr' + (pg.estornado || pg.situacao === 'recusado' ? ' class="cancelada"' : '') + '>' +
          '<td class="mono">' + U.fData(pg.data) + '</td>' +
          '<td class="num">' + U.brl(pg.valor + pg.juros + pg.multa) + '</td>' +
          '<td>' + U.esc((D.banco(pg.banco) || {}).apelido || '—') +
            '<div class="sub">' + U.esc(pg.forma || '') +
            (pg.juros + pg.multa > 0 ? ' · juros/multa ' + U.brl(pg.juros + pg.multa) : '') + '</div>' +
            '<div><span class="badge ' + (cls[pg.situacao] || '') + '">' + (rot[pg.situacao] || pg.situacao) + '</span></div>' +
            (pg.motivo_recusa ? '<div class="sub">' + U.esc(pg.motivo_recusa) + '</div>' : '') +
            (pg.autorizado_por ? '<div class="sub">por ' + U.esc(pg.autorizado_por) + '</div>' : '') + '</td>' +
          '<td class="acoes">' + (pg.estornado ? '<span class="sub">estornado</span>'
            : pg.situacao === 'aguardando'
              ? (S.pode('aprovar')
                  ? '<button class="btn-sm btn-pagar" data-aut="' + pg.id + '">Aprovar</button>' +
                    '<button class="btn-sm btn-cancelar" data-rec="' + pg.id + '">Recusar</button>'
                  : (S.pode('pagar')
                      ? '<button class="btn-sm btn-cancelar" data-des="' + pg.id + '">Desfazer</button>'
                      : '<span class="sub">na fila da diretoria</span>'))
              : (pg.situacao === 'autorizado' || pg.situacao === 'enviado') && S.pode('pagar')
                ? '<button class="btn-sm btn-pagar" data-liq="' + pg.id + '">Confirmar pagamento</button>'
              : pg.situacao === 'liquidado' && S.pode('estornar')
                ? '<button class="btn-sm btn-cancelar" data-est="' + pg.id + '">Estornar</button>' : '') +
          '</td></tr>';
        }).join('') + '</tbody></table>'
          : '<div class="ajuda">Nenhum pagamento registrado.</div>') +
        '<h2 style="margin-top:16px;font-size:12px">Histórico</h2>' +
        '<ul class="historico">' + evs.map(e =>
          '<li>' + U.fDataHora(e.em) + ' · ' + U.esc(e.usuario) + ' ' + U.esc(e.acao) +
          (e.detalhe ? ' — ' + U.esc(e.detalhe) : '') + '</li>').join('') + '</ul>',
      acoes: acoesDetalhe(p),
      aoAbrir: () => {
        document.querySelectorAll('[data-aut]').forEach(function (b) {
          b.addEventListener('click', function () {
            const r = S.autorizarPagamento([this.dataset.aut]);
            if (r.erro) return ERP.app.aviso(r.erro, 'erro');
            ERP.app.fecharModal(); ERP.app.aviso('Pagamento autorizado.', 'ok'); depois();
          });
        });
        document.querySelectorAll('[data-rec]').forEach(function (b) {
          b.addEventListener('click', function () { abrirRecusarPagamento(this.dataset.rec); });
        });
        document.querySelectorAll('[data-des]').forEach(function (b) {
          b.addEventListener('click', function () {
            const r = S.cancelarSolicitacao(this.dataset.des);
            if (r.erro) return ERP.app.aviso(r.erro, 'erro');
            ERP.app.fecharModal(); ERP.app.aviso('Solicitação desfeita.', 'ok'); depois();
          });
        });
        // pagamento fora do arquivo bancário (débito em conta, dinheiro, boleto)
        document.querySelectorAll('[data-liq]').forEach(function (b) {
          b.addEventListener('click', function () {
            const r = S.liquidar(this.dataset.liq, { data: U.hoje() });
            if (r.erro) return ERP.app.aviso(r.erro, 'erro');
            ERP.app.fecharModal(); ERP.app.aviso('Pagamento confirmado — baixa registrada.', 'ok'); depois();
          });
        });
        document.querySelectorAll('[data-est]').forEach(b => b.addEventListener('click', function () {
          const motivo = prompt('Motivo do estorno:');
          if (!motivo) return;
          const r = S.estornar(this.dataset.est, motivo);
          if (r.erro) return ERP.app.aviso(r.erro, 'erro');
          ERP.app.fecharModal(); ERP.app.aviso('Pagamento estornado.', 'ok'); depois();
        }));
      }
    });
  }

  /* De onde saiu o valor: cada setor + tipo do fechamento.
     É o que permite agrupar o pagamento por médico sem perder rastro. */
  function composicao(p) {
    const itens = p.itens || [];
    if (!itens.length) return '';
    const hhmm = function (m) { return Math.floor(m / 60) + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : ''); };
    const soma = itens.reduce(function (s, i) { return s + i.valor; }, 0);
    const dif = Math.round((p.valor - soma) * 100) / 100;
    return '<h2 style="margin-top:16px;font-size:12px">Composição do valor</h2>' +
      '<table><thead><tr><th>Setor</th><th>Tipo</th><th class="num">Plantões</th>' +
      '<th class="num">Horas</th><th class="num">Valor</th></tr></thead><tbody>' +
      itens.map(function (i) {
        return '<tr><td>' + U.esc(i.setor) + '</td><td>' + U.esc(i.tipo) + '</td>' +
          '<td class="num">' + i.qtd + '</td><td class="num">' + hhmm(i.minutos) + '</td>' +
          '<td class="num">' + U.brl(i.valor) + '</td></tr>';
      }).join('') +
      '<tr class="total"><td colspan="2">Total</td>' +
      '<td class="num">' + itens.reduce(function (s, i) { return s + i.qtd; }, 0) + '</td>' +
      '<td class="num">' + hhmm(itens.reduce(function (s, i) { return s + i.minutos; }, 0)) + '</td>' +
      '<td class="num">' + U.brl(soma) + '</td></tr></tbody></table>' +
      (Math.abs(dif) > 0.004 ? '<div class="ajuda erro">A composição difere ' + U.brl(dif) + ' do valor da parcela.</div>' : '');
  }

  /* O que veio do XML da nota: retenções e itens. As retenções explicam
     a diferença entre o valor do título e o que sai do caixa. */
  function notaFiscal(p) {
    const ret = p.retencoes || [], itens = p.nf_itens || [];
    if (!ret.length && !itens.length) return '';
    let html = '';
    if (ret.length) {
      const tot = ret.reduce(function (s, r) { return s + r.valor; }, 0);
      html += '<h2 style="margin-top:16px;font-size:12px">Retenções da nota</h2>' +
        '<table><tbody>' + ret.map(function (r) {
          return '<tr><td>' + U.esc(r.tributo) + '</td><td class="num">' + U.brl(r.valor) + '</td></tr>';
        }).join('') +
        '<tr class="total"><td>Total retido</td><td class="num">' + U.brl(tot) + '</td></tr>' +
        '<tr><td>Valor do título menos retenções</td><td class="num">' + U.brl(p.valor - tot) + '</td></tr>' +
        '</tbody></table>' +
        '<div class="ajuda">Retenção é informação da nota: quem recolhe é a empresa, em guia própria. ' +
        'Confira se a parcela foi lançada pelo bruto ou pelo líquido.</div>';
    }
    if (itens.length) {
      html += '<h2 style="margin-top:16px;font-size:12px">Itens da nota</h2>' +
        '<table><tbody>' + itens.map(function (i) {
          return '<tr><td>' + U.esc(i.descricao) + (i.ncm ? '<div class="sub">NCM ' + U.esc(i.ncm) +
            (i.cfop ? ' · CFOP ' + U.esc(i.cfop) : '') + '</div>' : '') + '</td>' +
            '<td class="num">' + i.qtd + ' ' + U.esc(i.unidade || '') + '</td>' +
            '<td class="num">' + U.brl(i.valor) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    return html;
  }

  function acoesDetalhe(p) {
    const a = [];
    if (p.status === 'cancelado') return a;
    if (p.status === 'aguardando' && S.pode('aprovar')) {
      a.push({ txt: 'Aprovar pagamento', cls: 'btn-pagar', fn: () => { ERP.app.fecharModal(); autorizarUm(p.id); } });
    } else if (p.status !== 'pago' && p.status !== 'aguardando' &&
               p.status !== 'autorizado' && p.status !== 'enviado' && S.pode('pagar')) {
      a.push({ txt: 'Solicitar pagamento', cls: 'btn-pagar', fn: () => abrirBaixa(p.id) });
    }
    if (S.pode('cancelar') && !S.pagamentosDe(p.id).length) {
      a.push({ txt: 'Cancelar lançamento', cls: 'btn-cancelar', fn: () => abrirCancelar(p.id) });
    }
    return a;
  }

  /* Exportação do contas a pagar, tirada do DADO e não da tela.

     A versão raspada perdia justamente o que se usa numa planilha:
     centro de custo, natureza, competência e CNPJ não são colunas da
     tela, e o que ia era o texto formatado, que não soma. Aqui sai o
     filtro inteiro — não só a página visível —, com número como número
     e uma linha por rateio quando a parcela é dividida entre centros. */
  /* Uma extração só, três formatos (Excel, PDF e CSV) — o menu de
     exportação decide. Uma linha por centro do rateio, pra bater com a
     DRE de quem recebe o arquivo. */
  function colunasExportacao() {
    const hoje = U.hoje();
    return [
      { titulo: 'Documento', largura: 16, valor: l => l.p.doc || '' },
      { titulo: 'Descrição', largura: 40, valor: l => S.descricaoVisivel(l.p) },
      { titulo: 'Fornecedor', largura: 28, valor: l => S.nomeCredorVisivel(l.p, (D.credor(l.p.credor) || {}).nome || '') },
      /* Título de folha sai sem o CPF: o nome e a descrição já são
         mascarados, mas a coluna de documento imprimia o CPF em claro
         na mesma linha do valor — que é exatamente o par que o sigilo
         salarial existe para esconder. */
      { pdf: false, titulo: 'CNPJ/CPF', largura: 18, valor: l => {
        if (S.tituloSigiloso(l.p)) return '';
        const c = D.credor(l.p.credor) || {}; return c.documento ? U.cnpj(c.documento) : ''; } },
      { pdf: false, titulo: 'Tipo', largura: 12, valor: l => l.p.tipo_titulo || '' },
      { titulo: 'Natureza', largura: 30, valor: l => naturezasTexto(l.p) || (D.conta(l.p.conta) || {}).nome || '' },
      { pdf: false, titulo: 'Conta', largura: 10, valor: l => (l.p.contas_rateio && l.p.contas_rateio.length > 1)
          ? l.p.contas_rateio.map(x => x.conta).join('+') : (l.p.conta || '') },
      { titulo: 'Centro de custo', largura: 22, valor: l => (D.centro(l.rt.centro) || {}).curto || '' },
      { pdf: false, titulo: 'Projeto', largura: 22, valor: l => (D.centro(l.rt.centro) || {}).unidade || '' },
      { titulo: 'Competência', largura: 12, valor: l => l.p.comp || '' },
      { pdf: false, titulo: 'Emissão', largura: 12, tipo: 'data', valor: l => U.fData(l.p.emissao) },
      { titulo: 'Vencimento', largura: 12, tipo: 'data', valor: l => U.fData(l.p.venc) },
      { pdf: false, titulo: 'Parcela', largura: 9, valor: l => l.p.num + '/' + (l.p.total || 1) },
      /* Em título rateado, a linha é do CENTRO: o valor da linha é a
         parte dele. O valor cheio do título vai numa coluna à parte,
         que não entra no PDF — somar a coluna principal dobrava o
         total. */
      { titulo: 'Valor da parcela', largura: 15, tipo: 'numero',
        valor: l => Math.round(l.p.valor * (l.rt.pct || 100)) / 100 },
      { pdf: false, titulo: 'Valor cheio do título', largura: 15, tipo: 'numero', valor: l => l.p.valor },
      { pdf: false, titulo: '% do rateio', largura: 11, tipo: 'numero', valor: l => l.rt.pct },
      { pdf: false, titulo: 'Valor no centro', largura: 15, tipo: 'numero',
        valor: l => Math.round(l.p.valor * (l.rt.pct || 100)) / 100 },
      /* Título rateado vira uma linha por centro: pago e saldo saem na
         MESMA proporção do rateio. Repetir o valor cheio em cada linha
         dobrava o total quando alguém somava a coluna. */
      { titulo: 'Pago', largura: 13, tipo: 'numero',
        valor: l => Math.round(S.pagoDe(l.p.id) * (l.rt.pct || 100)) / 100 },
      { titulo: 'Saldo', largura: 13, tipo: 'numero',
        valor: l => Math.round(S.saldoDe(l.p) * (l.rt.pct || 100)) / 100 },
      { titulo: 'Situação', largura: 14, valor: l => l.p.status || '' },
      { pdf: false, titulo: 'Aprovação', largura: 12, valor: l => l.p.aprovacao || '' },
      { titulo: 'Dias em atraso', largura: 12, tipo: 'numero',
        valor: l => (l.p.status === 'aberto' || l.p.status === 'parcial') && l.p.venc < hoje
          ? U.diasEntre(l.p.venc, hoje) : 0 },
      { titulo: 'NF', largura: 14, valor: l => l.p.arquivo ? 'arquivo anexado'
          : l.p.doc ? 'nº informado' : (l.p.sem_nf ? 'sem NF' : '—') },
      { pdf: false, titulo: 'Pago em', largura: 12, tipo: 'data', valor: l => l.p.pago_em ? U.fData(l.p.pago_em) : '' }
    ];
  }

  function exportar() {
    const lista = S.listar(filtros());
    if (!lista.length) return ERP.app.aviso('Nada para exportar com esses filtros.', 'erro');
    const linhas = [];
    lista.forEach(function (p) {
      const rateio = (p.rateio && p.rateio.length) ? p.rateio : [{ centro: p.centro, pct: 100 }];
      rateio.forEach(function (rt) { linhas.push({ p: p, rt: rt }); });
    });
    ERP.exportar.abrir({
      nome: abaContas === 'pagas' ? 'contas-pagas' : 'contas-a-pagar',
      titulo: abaContas === 'pagas' ? 'Contas pagas' : 'Contas a pagar',
      colunas: colunasExportacao(), linhas: linhas
    });
  }

  function depois() { ERP.app.atualizar(); }

  // usado pela sub-aba "Sem anexo" e pela tela de aprovação — sempre
  // parte de "A pagar": um atalho de pendência não deve herdar a aba
  // "Pagas" se foi essa a última usada.
  /* `aba` decide em qual das duas listas o atalho cai. O alerta de
     "pago sem NF" precisa da aba PAGAS: forçar sempre "a pagar" fazia o
     atalho abrir a lista de vencidos filtrada por NF, que não tem
     nenhum dos títulos do alerta. */
  function preFiltrar(campos, aba) {
    estadoDaAba(aba || 'apagar');
    Object.keys(campos).forEach(function (id) { U.setVal(id, campos[id]); });
    render();
  }

  /* Chamado pelo menu: "Pago" é esta mesma tela na aba das pagas. */
  function abrirAba(aba) { estadoDaAba(aba); render(); }

  return { montar, render, preFiltrar, verDetalhe: abrirDetalhe, saldoBancarioResumoHTML, abrirAba };
})();
