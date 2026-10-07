/* ERP · ui-compras.js — requisição, aprovação, pedido e recebimento.

   A requisição nasce do alerta de estoque ou à mão, passa por aprovação
   (diretoria ou sócio, mesma regra do pagamento), vira pedido ao
   fornecedor e volta como entrada de material. Recebimento parcial
   fica aberto pelo que falta. */
window.ERP = window.ERP || {};

ERP.compras = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;
  let filtro = 'abertas';
  let abertos = new Set();

  function montar() {
    document.querySelectorAll('#cp-nav button').forEach(function (b) {
      b.addEventListener('click', function () { filtro = this.dataset.cp; render(); });
    });
    U.el('cp-nova').addEventListener('click', function () { nova(); });
  }

  const prod = id => D.produtos.find(function (p) { return p.id === id; }) || {};
  const ABERTAS = ['requisicao', 'aprovada', 'cotada', 'compra_aprovada', 'pedido', 'recebido_parcial'];

  function render() {
    document.querySelectorAll('#cp-nav button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.cp === filtro);
    });
    const todas = S.compras();
    const lista = todas.filter(function (r) {
      if (filtro === 'abertas') return ABERTAS.indexOf(r.status) > -1;
      /* DOIS ATOS DIFERENTES, duas abas. Aprovar a requisição é
         dizer "pode comprar isso"; aprovar a compra depois da
         cotação é dizer "pode gastar este valor, com este
         fornecedor". Juntas numa aba só, a segunda — que é a que
         move dinheiro — se perdia no meio da primeira. */
      if (filtro === 'aprovar') return r.status === 'requisicao';
      if (filtro === 'aprovar-compra') return r.status === 'cotada';
      if (filtro === 'cotar') return r.status === 'aprovada' || r.status === 'compra_aprovada';
      if (filtro === 'receber') return r.status === 'pedido' || r.status === 'recebido_parcial';
      if (filtro === 'fechadas') return r.status === 'recebido' || r.status === 'cancelada';
      return true;
    });
    const emAberto = todas.filter(function (r) { return ABERTAS.indexOf(r.status) > -1; });

    /* Os contadores nas próprias abas: quem abre o módulo vê de
       imediato onde há coisa parada esperando decisão. */
    const nReq = todas.filter(function (r) { return r.status === 'requisicao'; }).length;
    const nCot = todas.filter(function (r) { return r.status === 'cotada'; }).length;
    [['cp-n-req', nReq], ['cp-n-cot', nCot]].forEach(function (par) {
      const el = U.el(par[0]);
      if (el) { el.textContent = par[1]; el.style.display = par[1] ? '' : 'none'; }
    });

    U.el('cp-saida').innerHTML =
      '<div class="pr-confere">' +
        '<span>Em andamento <b>' + emAberto.length + '</b></span>' +
        '<span>Itens pedidos <b>' + emAberto.reduce(function (s, r) { return s + r.itens.length; }, 0) + '</b></span>' +
        '<span>Aprovar requisição <b class="' +
          (todas.filter(function (r) { return r.status === 'requisicao'; }).length ? 'erro' : '') + '">' +
          todas.filter(function (r) { return r.status === 'requisicao'; }).length + '</b></span>' +
        '<span>Em cotação <b>' + todas.filter(function (r) { return r.status === 'aprovada'; }).length + '</b></span>' +
        '<span>Aprovar compra <b class="' +
          (todas.filter(function (r) { return r.status === 'cotada'; }).length ? 'erro' : '') + '">' +
          todas.filter(function (r) { return r.status === 'cotada'; }).length + '</b></span>' +
        '<span>Aguardando entrega <b>' + todas.filter(function (r) {
          return r.status === 'pedido' || r.status === 'recebido_parcial'; }).length + '</b></span>' +
      '</div>' +
      '<div class="tabela-rolagem" style="margin:10px -14px 0"><table><thead><tr>' +
      '<th style="width:18px"></th><th>Requisição</th><th>Armazém</th><th>Projeto</th>' +
      '<th>Fornecedor</th><th class="num">Itens</th><th>Prazo</th><th>Situação</th><th></th>' +
      '</tr></thead><tbody>' +
      (lista.length ? lista.map(function (r) {
        const aberto = abertos.has(r.id);
        const cor = { requisicao: 'b-pendente', aprovada: 'b-aguardando', pedido: 'b-aguardando',
                      recebido_parcial: 'b-aguardando', recebido: 'b-pago', cancelada: 'b-cancelado' };
        return '<tr style="cursor:pointer" data-cp-ab="' + r.id + '">' +
          '<td class="sub">' + (aberto ? '▾' : '▸') + '</td>' +
          '<td class="desc">' + U.esc(r.numero) +
            (r.origem === 'alerta_estoque' ? '<div class="sub">do alerta de estoque</div>' : '') + '</td>' +
          '<td>' + U.esc((D.armazem(r.armazem) || {}).codigo || '—') + '</td>' +
          '<td class="sub">' + U.esc((D.centro((D.armazem(r.armazem) || {}).centro) || {}).curto || '—') + '</td>' +
          '<td class="desc">' + U.esc(r.credor ? ERP.lancamento.nomeCredor(r.credor) : 'a definir') + '</td>' +
          '<td class="num">' + r.itens.length + '</td>' +
          '<td class="mono">' + U.fData(r.prazo) + '</td>' +
          '<td><span class="badge ' + (cor[r.status] || '') + '">' +
            U.esc(D.STATUS_COMPRA[r.status] || r.status) + '</span></td>' +
          '<td class="acoes">' + acoes(r) + '</td></tr>' +
          (aberto ? detalhe(r) : '');
      }).join('')
        : '<tr><td colspan="9" class="vazio"><strong>Nada neste filtro.</strong>' +
          'Requisições nascem do alerta de estoque, em Estoque › Posição, ou pelo botão acima.</td></tr>') +
      '</tbody></table></div>' +
      '<div class="ajuda">Clique na linha para ver os itens. O recebimento dá entrada no estoque do ' +
      'projeto — e é o mesmo evento que a NF de compra registra quando você lança a nota no financeiro.</div>';
    ligar();
  }

  function acoes(r) {
    const b = [];
    /* Duas aprovações: a 1ª aprova a necessidade (com valor estimado
       item a item) e a 2ª aprova o preço, já com a cotação na frente. */
    if (r.status === 'requisicao' && S.pode('aprovar_compra')) b.push(bt('Aprovar itens', 'btn-aprovar', 'ap', r.id));
    if (['aprovada', 'cotada'].indexOf(r.status) > -1 && S.pode('comprar')) {
      b.push(bt(r.status === 'cotada' ? 'Rever cotação' : 'Lançar cotação', '', 'ct', r.id));
    }
    if (r.status === 'cotada' && S.pode('aprovar_compra')) b.push(bt('Aprovar compra', 'btn-aprovar', 'ac', r.id));
    if (r.status === 'compra_aprovada' && S.pode('comprar')) b.push(bt('Enviar pedido', 'btn-pagar', 'pd', r.id));
    if (r.status === 'pedido' && r.credor && S.pode('comprar')) b.push(bt('E-mail ao fornecedor', '', 'em', r.id));
    if ((r.status === 'pedido' || r.status === 'recebido_parcial') && S.pode('receber')) {
      b.push(bt('Dar entrada', 'btn-pagar', 'rc', r.id));
    }
    /* Editar só enquanto é REQUISIÇÃO. Depois de aprovada, editar
       passava por cima da aprovação (de 10 pra 777) e, em compra já
       aprovada, apagava fornecedor, preço e frete, travando o pedido em
       zero. Pra mudar depois, reprove ou devolva pra revisão. */
    if (r.status === 'requisicao' && S.pode('requisitar')) b.push(bt('Editar', '', 'ed', r.id));
    return b.join('');
  }
  const bt = (t, c, a, id) => '<button class="btn-sm ' + c + '" data-cp-' + a + '="' + id + '">' + t + '</button>';

  function detalhe(r) {
    return '<tr><td></td><td colspan="8" style="background:#fafbfc;padding:10px 8px">' +
      (r.observacao ? '<div class="sub" style="margin-bottom:6px">' + U.esc(r.observacao) + '</div>' : '') +
      '<table style="margin:0"><thead><tr><th>Material</th><th class="num">Pedido</th>' +
      '<th class="num">Recebido</th><th class="num">Falta</th></tr></thead><tbody>' +
      r.itens.map(function (i) {
        const p = prod(i.produto);
        const falta = Math.round((i.qtd - i.recebido) * 1000) / 1000;
        /* "?" não diz nada a quem olha. Quando o material não está
           no cadastro — porque a gravação falhou, ou porque alguém
           o inativou — a linha mostra o nome guardado na própria
           requisição, e só então o código. */
        /* O nome do cadastro primeiro; depois o que ficou guardado
           na própria requisição. "Material fora do cadastro" só
           quando não há nem um nem outro — aí é informação de
           verdade, não um código cru. */
        return '<tr><td class="desc">' +
          U.esc(p.descricao || i.descricao || i.nome ||
            ('material fora do cadastro · ' + (i.produto || 'sem código'))) +
          /* UMA linha de código e unidade, não duas: eu acrescentei
             esta sem remover a que já existia, e o código aparecia
             repetido embaixo do nome. */
          (p.codigo || i.codigo
            ? '<div class="sub">' + U.esc(p.codigo || i.codigo) +
              (p.unidade || i.unidade ? ' · ' + U.esc(p.unidade || i.unidade) : '') + '</div>'
            : '') + '</td>' +
          '<td class="num">' + U.num(i.qtd) + ' ' + U.esc(p.unidade || '') + '</td>' +
          '<td class="num">' + U.num(i.recebido) + '</td>' +
          '<td class="num"' + (falta > 0 ? ' style="color:var(--amber)"' : '') + '>' + U.num(falta) + '</td></tr>';
      }).join('') +
      '</tbody></table>' +
      (function () {
        /* Quem aprova precisa de uma ordem de grandeza. O valor não é
           digitado na requisição — é estimado pelo custo médio do
           armazém, e a tela diz que é estimativa. */
        const v = S.valorEstimadoCompra(r);
        if (!S.pode('ver_custo')) return '';
        return '<div class="pr-confere" style="margin:8px 0">' +
          '<span>' + (v.estimado ? 'Valor estimado' : 'Valor do pedido') +
            ' <b>' + U.brl(v.valor) + '</b></span>' +
          (v.estimado ? '<span class="sub">pelo custo médio do armazém</span>' : '') +
          (v.semBase.length ? '<span class="erro">' + v.semBase.length +
            ' item(ns) sem custo de referência</span>' : '') + '</div>';
      })() +
      '<div class="ajuda">A requisição não tem valor digitado: o comprador cota no pedido, e o custo ' +
      'definitivo entra na entrada do estoque, que é o que vai para a média ponderada.' +
      (r.nota_documento ? ' Nota da entrega: <b>' + U.esc(r.nota_documento) + '</b>.' : '') + '</div>' +
      '<div class="ajuda">' + (r.historico || []).map(function (h) {
        return U.fData(h.data) + ' ' + U.esc(D.STATUS_COMPRA[h.status] || h.status) + ' (' + U.esc(h.usuario) + ')';
      }).join(' → ') + '</div></td></tr>';
  }

  /* ── nova requisição à mão ──────────────────────────────*/
  let itens = [];

  /* Qual requisição está aberta, para poder reabri-la depois do
     cadastro de material. O sistema tem UM modal: abrir o cadastro
     por cima substitui a requisição, e fechá-lo deixaria a pessoa
     na tela de lista, com o que já tinha digitado perdido. */
  let reqAberta = null;

  function nova(id, manterItens) {
    const r = id ? S.compra(id) : null;
    reqAberta = id || null;
    if (!manterItens) {
      itens = r ? r.itens.map(function (i) { return { produto: i.produto, qtd: i.qtd }; })
                : [{ produto: '', qtd: 0 }];
    }
    ERP.app.modal({
      titulo: r ? 'Requisição ' + r.numero : 'Nova requisição de compra',
      corpo:
        '<div class="row2"><div><label>Armazém de destino *</label><select id="cp-arm">' +
          '<option value="">Escolher…</option>' +
          D.armazens.filter(function (a) { return a.ativo; }).map(function (a) {
            return '<option value="' + a.id + '"' + (r && r.armazem === a.id ? ' selected' : '') + '>' +
              U.esc(a.codigo + ' · ' + a.nome) + '</option>'; }).join('') + '</select></div>' +
        '<div><label>Prazo desejado</label><input type="date" id="cp-prazo" value="' +
          (r ? (r.prazo || '') : '') + '"></div></div>' +
        '<h2 style="font-size:12px;margin:14px 0 6px">Materiais e quantidades</h2>' +
        listaMateriais() +
        '<div id="cp-itens"></div>' +
        '<label>Observação</label><textarea id="cp-obs">' + U.esc(r ? (r.observacao || '') : '') + '</textarea>' +
        '<div class="ajuda">Quem requisita pede material e quantidade. Fornecedor e preço são de quem ' +
        'compra: ele cota e define no pedido, e o custo só existe na entrada do estoque.</div>',
      acoes: [{ txt: r ? 'Salvar' : 'Abrir requisição', cls: 'btn-aprovar', fn: function () {
        lerItens();
        if (r) {
          r.itens = itens.filter(function (i) { return i.produto && i.qtd > 0; }).map(function (i) {
            const antigo = r.itens.find(function (x) { return x.produto === i.produto; });
            return { produto: i.produto, qtd: i.qtd, recebido: antigo ? antigo.recebido : 0 };
          });
          const res = S.mudarStatusCompra(r.id, r.status, {
            armazem: U.val('cp-arm'), prazo: U.val('cp-prazo'),
            observacao: U.val('cp-obs'), itens: r.itens
          });
          if (res.erro) return ERP.app.aviso(res.erro, 'erro');
        } else {
          const res = S.criarRequisicao({
            armazem: U.val('cp-arm'), prazo: U.val('cp-prazo'),
            observacao: U.val('cp-obs'), itens: itens
          });
          if (res.erro) return ERP.app.aviso(res.erro, 'erro');
        }
        ERP.app.fecharModal();
        ERP.app.aviso('Requisição salva.', 'ok');
        render();
      } }],
      aoAbrir: renderItens
    });
  }

  /* Uma `datalist` só para todas as linhas: repetir a lista em cada
     linha multiplicaria o HTML por quantos itens a requisição
     tiver. */
  function listaMateriais() {
    return '<datalist id="lista-materiais">' +
      D.produtos.filter(function (x) { return x.ativo; })
        .sort(function (a, b) {
          return (a.descricao || '').localeCompare(b.descricao || '', 'pt-BR');
        })
        .map(function (x) {
          return '<option value="' + U.esc(x.codigo + ' · ' + x.descricao) + '">';
        }).join('') +
      '</datalist>';
  }

  /* Do texto digitado para o id do material. Aceita o rótulo
     inteiro, só o código ou só a descrição — quem digita não sabe
     qual formato o sistema espera. */
  function acharProduto(txt) {
    const t = String(txt || '').trim().toLowerCase();
    if (!t) return '';
    const lista = D.produtos.filter(function (x) { return x.ativo; });
    const exato = lista.find(function (x) {
      return (x.codigo + ' · ' + x.descricao).toLowerCase() === t ||
        (x.codigo || '').toLowerCase() === t ||
        (x.descricao || '').toLowerCase() === t;
    });
    if (exato) return exato.id;
    /* Sem correspondência exata, tenta a única que contém o texto:
       com mais de uma, não adivinha — deixa vazio e a pessoa
       escolhe. */
    const contem = lista.filter(function (x) {
      return (x.codigo + ' ' + x.descricao).toLowerCase().indexOf(t) > -1;
    });
    return contem.length === 1 ? contem[0].id : '';
  }

  function renderItens() {
    const box = U.el('cp-itens');
    box.innerHTML = itens.map(function (i, ix) {
      const p = prod(i.produto);
      return '<div class="rateio-lin" style="grid-template-columns:1fr 90px 26px">' +
        /* CAMPO DE BUSCA, não lista suspensa. Com cem materiais
           cadastrados, rolar a lista até achar "luva" é pior que
           digitar — e a opção de cadastrar, se ficasse no fim da
           lista, exigiria rolar tudo para encontrá-la.

           `datalist` dá busca nativa: a pessoa digita "luv" e o
           navegador filtra. Funciona em celular, não precisa de
           biblioteca, e quem sabe o código digita o código. */
        '<div class="busca-mat">' +
          '<input list="lista-materiais" data-i="' + ix + '" data-c="produto-txt" ' +
            'value="' + U.esc(i.produto ? (prod(i.produto).codigo + ' · ' + prod(i.produto).descricao) : '') + '" ' +
            'placeholder="digite parte do nome ou o código" autocomplete="off">' +
          '<input type="hidden" data-i="' + ix + '" data-c="produto" value="' + U.esc(i.produto || '') + '">' +
          /* O botão segue a MESMA regra do cadastro em si: quem
             movimenta compras ou estoque também cadastra material.
             A regra foi corrigida no sistema, mas a tela continuou
             exigindo o módulo de Cadastros — então quem requisita
             via o campo e não via o botão, e a única saída era
             escolher um material parecido. */
          (S.podeMover('cadastros') || S.podeMover('compras') || S.podeMover('estoque')
            ? '<button type="button" class="btn-sm" data-novo="' + ix + '" ' +
              'title="Cadastrar um material que ainda não existe">+ novo</button>' : '') +
        '</div>' +
        '<input class="num" data-i="' + ix + '" data-c="qtd" inputmode="decimal" value="' + U.num(i.qtd) + '" ' +
          'title="quantidade em ' + U.esc(p.unidade || '') + '">' +
        '<button class="btn-ghost" data-rem="' + ix + '" type="button">✕</button>' +
      '</div>';
    }).join('') +
    '<div class="rateio-pe"><button class="btn-sm" id="cp-add" type="button">+ outro material</button>' +
      '<span class="soma">' + itens.filter(function (i) { return i.produto && i.qtd > 0; }).length +
      ' item(ns)</span></div>';

    box.querySelectorAll('select,input').forEach(function (e) {
      e.addEventListener('change', function () {
        /* Escolher "cadastrar material" abre a janela de cadastro
           POR CIMA da requisição, sem fechá-la: ao terminar, o
           material novo já vem escolhido naquela linha e a pessoa
           continua de onde parou. */
        lerItens(); renderItens();
      });
    });
    /* O botão fica NA LINHA, não no fim da lista: com cem materiais,
       uma opção no fim da lista suspensa exigiria rolar tudo para
       ser encontrada. */
    box.querySelectorAll('[data-novo]').forEach(function (b) {
      b.addEventListener('click', function () {
        lerItens();
        cadastrarMaterialRapido(+this.dataset.novo);
      });
    });
    box.querySelectorAll('[data-rem]').forEach(function (b) {
      b.addEventListener('click', function () {
        itens.splice(+this.dataset.rem, 1);
        if (!itens.length) itens = [{ produto: '', qtd: 0 }];
        renderItens();
      });
    });
    U.el('cp-add').addEventListener('click', function () {
      lerItens();
      itens.push({ produto: '', qtd: 0 });
      renderItens();
    });
  }

  /* Cadastro de material sem sair da requisição.

     Só o essencial: descrição, unidade e código. Mínimo, ideal,
     NCM e conta contábil ficam para depois — pedir tudo agora faria
     a pessoa abandonar no meio ou inventar número, e material com
     mínimo inventado dispara alerta de reposição errado por meses.

     Quem requisita costuma saber o que é e em que unidade compra;
     o resto é de quem controla o estoque. */
  function cadastrarMaterialRapido(linha) {
    /* Desistir do cadastro devolve a requisição, não a lista: quem
       cancelou quis desistir do material, não do pedido inteiro. */
    const voltar = function () { nova(reqAberta, true); };
    ERP.app.modal({
      titulo: 'Cadastrar material',
      fecharTxt: 'Voltar à requisição',
      aoFechar: voltar,
      corpo:
        '<label for="np-desc">Descrição *</label>' +
        '<input id="np-desc" placeholder="ex.: Luva cirúrgica estéril 7,5">' +
        '<div class="row2" style="margin-top:8px">' +
          '<div><label for="np-un">Unidade</label>' +
            '<input id="np-un" value="UN" placeholder="UN, CX, PCT, PAR"></div>' +
          '<div><label for="np-cod">Código</label>' +
            '<input id="np-cod" placeholder="deixe vazio para gerar"></div>' +
        '</div>' +
        '<div class="ajuda">Só o essencial. Mínimo de estoque, NCM e conta contábil ficam para ' +
        'quem controla o estoque completar depois — material com mínimo inventado dispara alerta ' +
        'de reposição errado por meses.</div>' +
        '<div id="np-erro"></div>',
      acoes: [{ txt: 'Cadastrar e usar', cls: 'btn-aprovar', fn: function () {
        const desc = U.val('np-desc').trim();
        const erro = U.el('np-erro');
        if (!desc) {
          if (erro) erro.innerHTML = '<div class="login-erro">Informe a descrição.</div>';
          return;
        }
        /* Material repetido é pior que material faltando: duas
           entradas para a mesma coisa partem o saldo em dois e
           nenhuma mostra o total. */
        const igual = D.produtos.find(function (p) {
          return (p.descricao || '').trim().toLowerCase() === desc.toLowerCase();
        });
        if (igual) {
          if (erro) {
            erro.innerHTML = '<div class="login-erro">Já existe: <b>' +
              U.esc(igual.codigo + ' · ' + igual.descricao) + '</b>. Use esse na lista.</div>';
          }
          return;
        }
        const r = S.cadastrarMaterial({
          descricao: desc,
          unidade: U.val('np-un').trim() || 'UN',
          codigo: U.val('np-cod').trim()
        });
        if (r.erro) {
          if (erro) erro.innerHTML = '<div class="login-erro">' + U.esc(r.erro) + '</div>';
          return;
        }
        /* Já escolhido na linha de onde a pessoa veio, e a
           requisição reabre com tudo que estava digitado. */
        if (itens[linha]) itens[linha].produto = r.produto.id;
        nova(reqAberta, true);
        ERP.app.aviso('Material cadastrado e escolhido: ' + r.produto.codigo + ' · ' +
          r.produto.descricao + '. Complete o mínimo de estoque em Cadastros quando puder.', 'ok');
      } }]
    });
  }

  function lerItens() {
    const box = U.el('cp-itens');
    if (!box) return;
    /* O texto digitado vira id aqui: o campo visível guarda o
       rótulo, o escondido guarda o id, e é o id que o resto do
       sistema usa. */
    box.querySelectorAll('[data-c="produto-txt"]').forEach(function (e) {
      const i = +e.dataset.i;
      if (!itens[i]) return;
      itens[i].produto = acharProduto(e.value);
    });
    box.querySelectorAll('[data-c="qtd"]').forEach(function (e) {
      const i = +e.dataset.i;
      if (!itens[i]) return;
      itens[i].qtd = U.parseValor(e.value);
    });
  }

  /* ── recebimento ────────────────────────────────────────*/
  /* Entrega chegou: a entrada é feita no estoque, onde o custo e o
     armazém são informados — é lá que o custo médio se move. */
  /* ── enviar pedido ──────────────────────────────────────
     Esta etapa não existia, e o fluxo morria aqui: "Enviar pedido"
     chamava a mudança de status sem fornecedor, o store recusava — com
     razão — e a tela caía no editor da REQUISIÇÃO, que por decisão de
     projeto não tem campo de fornecedor nem de preço. Sem saída:
     nenhuma requisição chegava a "Aguardando entrega", e por isso o
     recebimento e o vínculo com a entrada de estoque nunca aconteciam.

     É aqui que o comprador faz o que lhe cabe: escolhe o fornecedor
     que cotou, põe o preço de cada item e a previsão de entrega. */
  /* ── 1ª aprovação: a necessidade, item a item ───────────
     O diretor precisa ver o valor estimado LINHA A LINHA (não só o
     total): é assim que dá pra cortar quantidade ou reprovar um item
     caro e deixar o resto passar. */
  function aprovarItens(id) {
    const r = S.compra(id);
    if (!r) return;
    const linhas = r.itens.map(function (i, idx) {
      const p = D.produtos.find(function (x) { return x.id === i.produto; }) || {};
      const base = S.custoMedio(i.produto, r.armazem) || p.custo || 0;
      return { i: i, p: p, idx: idx, base: base, total: Math.round(i.qtd * base * 100) / 100 };
    });
    const estimado = Math.round(linhas.reduce(function (a2, l) { return a2 + l.total; }, 0) * 100) / 100;
    ERP.app.modal({
      titulo: 'Aprovar requisição ' + r.numero,
      fecharTxt: 'Fechar',
      corpo:
        '<div class="ajuda">Valores estimados pelo custo médio do estoque — servem pra decidir, o preço real vem na cotação. ' +
          'Dá pra cortar a quantidade de qualquer linha e reprovar itens específicos.</div>' +
        '<table class="parcelas"><thead><tr><th>Item</th><th class="num">Pedido</th>' +
        '<th class="num">Aprovar qtd</th><th class="num">Custo ref.</th><th class="num">Estimado</th>' +
        '<th>Reprovar</th></tr></thead><tbody>' +
        linhas.map(function (l) {
          return '<tr><td class="desc">' + U.esc(l.p.descricao || l.i.produto) +
              '<div class="sub">' + U.esc(l.p.codigo || '') + ' · ' + U.esc(l.p.unidade || '') + '</div></td>' +
            '<td class="num">' + U.num(l.i.qtd) + '</td>' +
            '<td><input class="num" data-ai-qtd="' + l.idx + '" inputmode="decimal" value="' + U.num(l.i.qtd) + '"></td>' +
            '<td class="num sub">' + (l.base ? U.brl(l.base) : '—') + '</td>' +
            '<td class="num" data-ai-tot="' + l.idx + '">' + U.brl(l.total) + '</td>' +
            '<td><label style="font-weight:400"><input type="checkbox" style="width:auto" data-ai-rep="' + l.idx + '"> não comprar</label>' +
              '<input data-ai-mot="' + l.idx + '" placeholder="motivo" style="display:none;margin-top:4px"></td></tr>';
        }).join('') +
        '<tr><td colspan="4"><b>Total estimado</b></td><td class="num"><b id="ai-total">' + U.brl(estimado) + '</b></td><td></td></tr>' +
        '</tbody></table>' +
        '<label>Observação da aprovação</label><input id="ai-obs" placeholder="opcional">',
      acoes: [{ txt: 'Aprovar o que foi marcado', cls: 'btn-aprovar', fn: function () {
        const itens = linhas.map(function (l) {
          // manda o índice: o mesmo produto em 2 linhas não se confunde
          return { indice: l.idx, produto: l.i.produto,
            aprovado: !U.el('ai-rep-' + l.idx) && !document.querySelector('[data-ai-rep="' + l.idx + '"]').checked,
            qtd: U.parseValor(document.querySelector('[data-ai-qtd="' + l.idx + '"]').value),
            motivo: (document.querySelector('[data-ai-mot="' + l.idx + '"]') || {}).value || '' };
        });
        const rr = S.aprovarRequisicao(id, { itens: itens, observacao: U.val('ai-obs') });
        if (rr.erro) return ERP.app.aviso(rr.erro, 'erro');
        ERP.app.fecharModal();
        ERP.app.aviso(rr.cancelada ? 'Todos os itens reprovados — requisição cancelada.'
          : rr.aprovados + ' item(ns) aprovado(s). Agora o comprador lança a cotação.', 'ok');
        render();
      } }],
      aoAbrir: function () {
        const recalcular = function () {
          let t = 0;
          linhas.forEach(function (l) {
            const rep = document.querySelector('[data-ai-rep="' + l.idx + '"]').checked;
            const q = U.parseValor(document.querySelector('[data-ai-qtd="' + l.idx + '"]').value);
            const v = rep ? 0 : Math.round(q * l.base * 100) / 100;
            document.querySelector('[data-ai-tot="' + l.idx + '"]').textContent = rep ? '—' : U.brl(v);
            t += v;
          });
          U.el('ai-total').textContent = U.brl(Math.round(t * 100) / 100);
        };
        document.querySelectorAll('[data-ai-qtd]').forEach(function (e) { e.addEventListener('input', recalcular); });
        document.querySelectorAll('[data-ai-rep]').forEach(function (e) {
          e.addEventListener('change', function () {
            document.querySelector('[data-ai-mot="' + this.dataset.aiRep + '"]').style.display = this.checked ? '' : 'none';
            recalcular();
          });
        });
      }
    });
  }

  /* ── cotação: fornecedor, preço e frete por item ────────*/
  function cotar(id) {
    const r = S.compra(id);
    if (!r) return;
    const ativos = r.itens.filter(function (i) { return !i.reprovado; });
    let anexos = [];
    /* Receita Federal, FGTS, prefeituras, sócios e funcionários não
       vendem material — tirá-los encurta a lista e evita escolha errada. */
    const opForn = D.credores.filter(function (c) {
      return c.ativo !== false && ['medico', 'funcionario', 'orgao', 'socio'].indexOf(c.tipo) < 0;
    })
      .sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome)); });
    ERP.app.modal({
      titulo: 'Cotação · ' + r.numero,
      fecharTxt: 'Fechar',
      corpo:
        (r.observacao_aprovacao_compra ? '<div class="ajuda erro">Devolvida pela diretoria: ' +
          U.esc(r.observacao_aprovacao_compra) + '</div>' : '') +
        '<div class="ajuda">Escolha o fornecedor e o preço de cada item. O frete vai POR ITEM: numa compra com ' +
          'dois fornecedores, lance o frete de cada um nos itens dele.</div>' +
        '<table class="parcelas"><thead><tr><th>Item</th><th class="num">Qtd</th><th>Fornecedor</th>' +
        '<th class="num">Preço unit.</th><th class="num">Frete do item</th><th class="num">Total</th></tr></thead><tbody>' +
        ativos.map(function (i, idx) {
          const p = D.produtos.find(function (x) { return x.id === i.produto; }) || {};
          /* CÓDIGO E NOME. Só o código obriga quem cota a decorar o
             cadastro — e cotação é a hora em que se compara preço
             de coisas parecidas, onde trocar um item pelo outro
             custa caro. */
          return '<tr><td class="desc">' +
            (p.descricao
              ? '<b>' + U.esc(p.descricao) + '</b><div class="sub">' + U.esc(p.codigo || '') +
                (p.unidade ? ' · ' + U.esc(p.unidade) : '') + '</div>'
              : U.esc(i.descricao || ('material fora do cadastro · ' + (i.produto || '')))) +
            '</td>' +
            '<td class="num">' + U.num(i.qtd) + ' ' + U.esc(p.unidade || '') + '</td>' +
            '<td><select data-ct-forn="' + idx + '"><option value="">—</option>' +
              opForn.map(function (c) {
                return '<option value="' + c.id + '"' + (i.credor === c.id ? ' selected' : '') + '>' +
                  U.esc(c.nome) + (c.email ? '' : ' (sem e-mail)') + '</option>';
              }).join('') + '</select></td>' +
            '<td><input class="num" data-ct-custo="' + idx + '" inputmode="decimal" value="' + U.num(i.custo || 0) + '"></td>' +
            '<td><input class="num" data-ct-frete="' + idx + '" inputmode="decimal" value="' + U.num(i.frete || 0) + '"></td>' +
            '<td class="num" data-ct-tot="' + idx + '">' + U.brl((i.qtd || 0) * (i.custo || 0) + (i.frete || 0)) + '</td></tr>';
        }).join('') +
        '<tr><td colspan="5"><b>Total cotado</b></td><td class="num"><b id="ct-total">R$ 0,00</b></td></tr>' +
        '</tbody></table>' +
        /* CADASTRAR FORNECEDOR na própria cotação. O fornecedor
           novo aparece justamente quando a cotação chega — e
           mandar sair da tela para cadastrar faz perder os preços
           já digitados. */
        (S.podeMover('compras') || S.podeMover('cadastros')
          ? '<div style="margin-top:8px"><button type="button" class="btn-linha" id="ct-novo-forn">' +
            '+ cadastrar fornecedor</button></div>'
          : '') +
        '<div class="row2" style="margin-top:8px">' +
          '<div><label>Frete total de um fornecedor (R$)</label><input class="num" id="ct-frete-total" inputmode="decimal" placeholder="ex.: 100,00"></div>' +
          '<div><label>Ratear entre os itens de</label><div style="display:flex;gap:6px">' +
            '<select id="ct-frete-forn"><option value="">— fornecedor —</option>' +
              opForn.map(function (c) { return '<option value="' + c.id + '">' + U.esc(c.nome) + '</option>'; }).join('') +
            '</select><button type="button" class="btn-sm" id="ct-ratear">Ratear</button></div></div></div>' +
        '<div class="ajuda">O rateio divide o frete pelos itens daquele fornecedor, proporcional ao valor de ' +
          'cada um, e ajusta os centavos na última linha (R$ 100 em 3 itens não vira 3 × R$ 33,33).</div>' +
        '<div class="row2"><div><label>Entrega prevista</label><input type="date" id="ct-prazo" value="' +
          U.esc(r.prazo || '') + '"></div>' +
        '<div><label>Anexar cotações recebidas</label><input type="file" id="ct-anexos" multiple ' +
          'accept=".pdf,.jpg,.jpeg,.png,.xlsx" style="border:none;padding:0"></div></div>' +
        (r.cotacoes && r.cotacoes.length ? '<div class="ajuda">Já anexadas: ' +
          r.cotacoes.map(function (a, i) {
            return '<button type="button" class="btn-sm" data-anexo="' + i + '">' + U.esc(a.nome) + '</button>';
          }).join(' ') + '</div>' : '') +
        '<label>Observação da cotação</label><input id="ct-obs" value="' + U.esc(r.observacao_cotacao || '') + '">',
      acoes: [{ txt: 'Enviar para aprovação da compra', cls: 'btn-aprovar', fn: function () {
        const itens = ativos.map(function (i, idx) {
          return { produto: i.produto,
            credor: document.querySelector('[data-ct-forn="' + idx + '"]').value,
            custo: U.parseValor(document.querySelector('[data-ct-custo="' + idx + '"]').value),
            frete: U.parseValor(document.querySelector('[data-ct-frete="' + idx + '"]').value) };
        });
        const enviar = function () {
          const rr = S.registrarCotacao(id, { itens: itens, anexos: anexos,
            prazo: U.val('ct-prazo'), observacao: U.val('ct-obs') });
          if (rr.erro) return ERP.app.aviso(rr.erro, 'erro');
          ERP.app.fecharModal();
          ERP.app.aviso('Cotação registrada. A diretoria aprova a compra com os valores reais.', 'ok');
          render();
        };
        const arqs = Array.prototype.slice.call((U.el('ct-anexos') || {}).files || []);
        if (!arqs.length) return enviar();
        let lidos = 0;
        arqs.forEach(function (a) {
          const fr = new FileReader();
          fr.onload = function () {
            anexos.push({ nome: a.name, dados: fr.result });
            if (++lidos === arqs.length) enviar();
          };
          fr.readAsDataURL(a);
        });
      } }],
      aoAbrir: function () {
        ligarAnexos(r);
        const recalcular = function () {
          let t = 0;
          ativos.forEach(function (i, idx) {
            const v = U.parseValor(document.querySelector('[data-ct-custo="' + idx + '"]').value) * i.qtd +
              U.parseValor(document.querySelector('[data-ct-frete="' + idx + '"]').value);
            document.querySelector('[data-ct-tot="' + idx + '"]').textContent = U.brl(Math.round(v * 100) / 100);
            t += v;
          });
          U.el('ct-total').textContent = U.brl(Math.round(t * 100) / 100);
        };
        document.querySelectorAll('[data-ct-custo], [data-ct-frete]').forEach(function (e) {
          e.addEventListener('input', recalcular);
        });
        /* Cadastro do fornecedor sem sair da cotação: nasce
           pendente de aprovação do financeiro, como todo credor
           criado no meio do trabalho. */
        const bNf = U.el('ct-novo-forn');
        if (bNf) {
          bNf.addEventListener('click', function () {
            ERP.app.modal({
              titulo: 'Cadastrar fornecedor',
              fecharTxt: 'Cancelar',
              corpo:
                '<label for="nf-nome">Razão social ou nome *</label>' +
                '<input id="nf-nome" placeholder="como está na nota">' +
                '<div class="row2" style="margin-top:8px">' +
                  '<div><label for="nf-doc">CNPJ ou CPF</label>' +
                    '<input id="nf-doc" inputmode="numeric" placeholder="só números"></div>' +
                  '<div><label for="nf-fone">Telefone</label>' +
                    '<input id="nf-fone" placeholder="opcional"></div>' +
                '</div>' +
                '<div class="ajuda">Dados bancários ficam para o financeiro: o cadastro nasce ' +
                'pendente de aprovação, e o pagamento só sai depois que alguém de lá conferir. ' +
                'Para cotar, nome basta.</div><div id="nf-erro"></div>',
              acoes: [{ txt: 'Cadastrar e usar', cls: 'btn-aprovar', fn: function () {
                const nome = U.val('nf-nome').trim();
                const erro = U.el('nf-erro');
                if (!nome) {
                  if (erro) erro.innerHTML = '<div class="login-erro">Informe o nome.</div>';
                  return;
                }
                const doc = String(U.val('nf-doc')).replace(/\D/g, '');
                const igual = D.credores.find(function (c) {
                  return (doc && String(c.documento || '').replace(/\D/g, '') === doc) ||
                    (c.nome || '').trim().toLowerCase() === nome.toLowerCase();
                });
                if (igual) {
                  if (erro) {
                    erro.innerHTML = '<div class="login-erro">Já existe: <b>' +
                      U.esc(igual.nome) + '</b>. Use esse na lista.</div>';
                  }
                  return;
                }
                D.credores.push({
                  id: S.proximoId('cr'), nome: nome, tipo: 'fornecedor',
                  documento: doc, telefone: U.val('nf-fone').trim(),
                  ativo: true, origem: 'cotação', dados_aprovados: false
                });
                ERP.app.fecharModal();
                ERP.app.aviso('Fornecedor cadastrado. O financeiro aprova os dados de pagamento ' +
                  'antes do primeiro pagamento.', 'ok');
                cotar(id);
              } }]
            });
          });
        }

        U.el('ct-ratear').addEventListener('click', function () {
          const forn = U.val('ct-frete-forn');
          const total = U.parseValor(U.val('ct-frete-total'));
          if (!forn) return ERP.app.aviso('Escolha o fornecedor cujo frete será rateado.', 'erro');
          if (!(total > 0)) return ERP.app.aviso('Informe o valor do frete a ratear.', 'erro');
          const alvos = ativos.map(function (i, idx) { return { i: i, idx: idx }; })
            .filter(function (x) { return document.querySelector('[data-ct-forn="' + x.idx + '"]').value === forn; });
          if (!alvos.length) return ERP.app.aviso('Nenhum item está com esse fornecedor.', 'erro');
          const base = alvos.map(function (x) {
            return x.i.qtd * U.parseValor(document.querySelector('[data-ct-custo="' + x.idx + '"]').value);
          });
          const somaBase = base.reduce(function (a, v) { return a + v; }, 0);
          let acumulado = 0;
          alvos.forEach(function (x, k) {
            const parte = k === alvos.length - 1
              ? Math.round((total - acumulado) * 100) / 100
              : Math.round((somaBase ? total * base[k] / somaBase : total / alvos.length) * 100) / 100;
            acumulado = Math.round((acumulado + parte) * 100) / 100;
            document.querySelector('[data-ct-frete="' + x.idx + '"]').value = U.num(parte);
          });
          recalcular();
          ERP.app.aviso('Frete de ' + U.brl(total) + ' rateado entre ' + alvos.length + ' item(ns).', 'ok');
        });
        recalcular();
      }
    });
  }

  /* Abre o arquivo anexado da cotação numa aba. Antes o diretor via só
     o nome e tinha que aprovar no escuro. */
  function ligarAnexos(r) {
    document.querySelectorAll('[data-anexo]').forEach(function (b) {
      b.addEventListener('click', function () {
        const a = (r.cotacoes || [])[+this.dataset.anexo];
        if (!a || !a.dados) return ERP.app.aviso('Arquivo não encontrado.', 'erro');
        const w = window.open();
        if (!w) return ERP.app.aviso('O navegador bloqueou a abertura — libere pop-ups.', 'erro');
        w.document.write('<iframe src="' + a.dados + '" style="border:0;position:fixed;inset:0;width:100%;height:100%"></iframe>');
        w.document.title = a.nome;
      });
    });
  }

  /* ── 2ª aprovação: o preço, com a cotação na frente ─────*/
  function aprovarPreco(id) {
    const r = S.compra(id);
    if (!r) return;
    const t = S.totalCotado(r);
    const ativos = r.itens.filter(function (i) { return !i.reprovado; });
    ERP.app.modal({
      titulo: 'Aprovar compra · ' + r.numero,
      fecharTxt: 'Fechar',
      corpo:
        '<table class="parcelas"><thead><tr><th>Item</th><th class="num">Qtd</th><th>Fornecedor</th>' +
        '<th class="num">Unit.</th><th class="num">Frete</th><th class="num">Total</th></tr></thead><tbody>' +
        ativos.map(function (i) {
          const p = D.produtos.find(function (x) { return x.id === i.produto; }) || {};
          const c = D.credor(i.credor) || {};
          const base = S.custoMedio(i.produto, r.armazem) || p.custo || 0;
          const dif = base ? (i.custo - base) / base * 100 : 0;
          return '<tr><td class="desc">' + U.esc(p.descricao || i.produto) +
              (base ? '<div class="sub">custo médio atual ' + U.brl(base) +
                (Math.abs(dif) >= 5 ? ' · <b class="' + (dif > 0 ? 'erro' : '') + '">' +
                  (dif > 0 ? '+' : '') + U.num(Math.round(dif)) + '%</b>' : '') + '</div>' : '') + '</td>' +
            '<td class="num">' + U.num(i.qtd) + '</td>' +
            '<td>' + U.esc(c.nome || '—') + (c.email ? '' : '<div class="sub erro">sem e-mail</div>') + '</td>' +
            '<td class="num">' + U.brl(i.custo || 0) + '</td>' +
            '<td class="num">' + U.brl(i.frete || 0) + '</td>' +
            '<td class="num">' + U.brl(Math.round(((i.qtd || 0) * (i.custo || 0) + (i.frete || 0)) * 100) / 100) + '</td></tr>';
        }).join('') +
        '<tr><td colspan="5"><b>Total da compra</b></td><td class="num"><b>' + U.brl(t.total) + '</b></td></tr>' +
        '</tbody></table>' +
        (Object.keys(t.por_fornecedor).length > 1
          ? '<div class="ajuda">Sai um pedido por fornecedor: ' +
            Object.keys(t.por_fornecedor).map(function (k) {
              return U.esc((D.credor(k) || {}).nome || k) + ' ' + U.brl(t.por_fornecedor[k]);
            }).join(' · ') + '</div>' : '') +
        (r.cotacoes && r.cotacoes.length
          ? '<div class="ajuda">Cotações anexadas: ' + r.cotacoes.map(function (a, i) {
              return '<button type="button" class="btn-sm" data-anexo="' + i + '">' + U.esc(a.nome) + '</button>';
            }).join(' ') + '</div>'
          : '<div class="ajuda erro">Nenhuma cotação anexada.</div>') +
        (r.observacao_cotacao ? '<div class="ajuda">' + U.esc(r.observacao_cotacao) + '</div>' : '') +
        '<label>Observação / o que precisa mudar</label><input id="ac-obs" placeholder="obrigatório se for devolver pra revisão">',
      aoAbrir: function () { ligarAnexos(r); },
      acoes: [
        { txt: 'Aprovar compra', cls: 'btn-aprovar', fn: function () { decidir('aprovar'); } },
        { txt: 'Devolver pra revisão', cls: '', fn: function () { decidir('revisar'); } },
        { txt: 'Reprovar', cls: 'btn-recusar', fn: function () { decidir('reprovar'); } }
      ]
    });
    function decidir(decisao) {
      const rr = S.aprovarCompra(id, { decisao: decisao, observacao: U.val('ac-obs') });
      if (rr.erro) return ERP.app.aviso(rr.erro, 'erro');
      ERP.app.fecharModal();
      ERP.app.aviso(rr.cancelada ? 'Compra reprovada.'
        : rr.revisar ? 'Devolvida pro comprador revisar a cotação.'
        : 'Compra aprovada em ' + U.brl(rr.total) + '. Agora é enviar o pedido ao fornecedor.', 'ok');
      render();
    }
  }

  /* E-mail de confirmação ao fornecedor. Sem servidor, o sistema monta
     a mensagem e abre no programa de e-mail — a pessoa confere e envia. */
  function emailPedido(id) {
    const e = S.emailDoPedido(id);
    if (e.erro) return ERP.app.aviso(e.erro, 'erro');
    ERP.app.modal({
      titulo: 'E-mail do pedido',
      fecharTxt: 'Fechar',
      corpo:
        '<div class="resumo-linha"><span>Para</span><span class="v">' + U.esc(e.para) +
          (e.contato ? ' (' + U.esc(e.contato) + ')' : '') + '</span></div>' +
        '<div class="resumo-linha"><span>Assunto</span><span class="v">' + U.esc(e.assunto) + '</span></div>' +
        '<label>Mensagem</label><textarea id="em-corpo" rows="12">' + U.esc(e.corpo) + '</textarea>' +
        '<div class="ajuda">O sistema abre a mensagem pronta no seu programa de e-mail — confira e clique em enviar. ' +
          'Envio automático de verdade só com um servidor de e-mail, que este protótipo não tem.</div>',
      acoes: [
        { txt: 'Abrir no e-mail', cls: 'btn-aprovar', fn: function () {
          window.location.href = 'mailto:' + encodeURIComponent(e.para) +
            '?subject=' + encodeURIComponent(e.assunto) + '&body=' + encodeURIComponent(U.val('em-corpo'));
        } },
        { txt: 'Copiar mensagem', cls: '', fn: function () {
          const ta = U.el('em-corpo'); ta.select(); document.execCommand('copy');
          ERP.app.aviso('Mensagem copiada.', 'ok');
        } }
      ]
    });
  }

  /* Envio do pedido: a cotação JÁ foi aprovada pela diretoria, então
     aqui é conferência e confirmação — nada de redigitar fornecedor e
     preço (o que, além de retrabalho, permitiria mandar pro fornecedor
     algo diferente do que foi aprovado). Só a data de entrega e o nº
     do pedido no fornecedor são editáveis. */
  function pedido(id) {
    const r = S.compra(id);
    if (!r) return;
    const ativos = (r.itens || []).filter(function (i) { return !i.reprovado; });
    const t = S.totalCotado(r);
    const fornecedores = Object.keys(t.por_fornecedor);
    const semEmail = fornecedores.filter(function (c) { return !(D.credor(c) || {}).email; });
    ERP.app.modal({
      titulo: 'Enviar pedido · ' + U.esc(r.numero),
      corpo:
        '<div class="ajuda">Valores aprovados pela diretoria' +
          (r.compra_aprovada_por ? ' (' + U.esc(r.compra_aprovada_por) + ')' : '') + '. ' +
          (fornecedores.length > 1 ? 'Sai um pedido por fornecedor — cada um com sua nota e seu pagamento.' : '') + '</div>' +
        '<table class="parcelas"><thead><tr><th>Material</th><th class="num">Qtd</th><th>Fornecedor</th>' +
        '<th class="num">Unit.</th><th class="num">Frete</th><th class="num">Total</th></tr></thead><tbody>' +
        ativos.map(function (i) {
          const p = D.produtos.find(function (x) { return x.id === i.produto; }) || {};
          const c = D.credor(i.credor) || {};
          return '<tr><td class="desc">' + U.esc(p.descricao || i.produto) + '</td>' +
            '<td class="num">' + U.num(i.qtd) + ' ' + U.esc(p.unidade || '') + '</td>' +
            '<td>' + U.esc(c.nome || '—') + (c.email ? '<div class="sub">' + U.esc(c.email) + '</div>'
              : '<div class="sub erro">sem e-mail no cadastro</div>') + '</td>' +
            '<td class="num">' + U.brl(i.custo || 0) + '</td>' +
            '<td class="num">' + U.brl(i.frete || 0) + '</td>' +
            '<td class="num">' + U.brl(Math.round(((i.qtd || 0) * (i.custo || 0) + (i.frete || 0)) * 100) / 100) + '</td></tr>';
        }).join('') +
        '<tr><td colspan="5"><b>Total</b></td><td class="num"><b>' + U.brl(t.total) + '</b></td></tr>' +
        '</tbody></table>' +
        '<div class="row2"><div><label>Previsão de entrega</label><input type="date" id="pd-prazo" value="' +
          U.esc(r.prazo || U.addDias(U.hoje(), 7)) + '"></div>' +
        '<div><label>Nº do pedido no fornecedor</label><input id="pd-num" value="' +
          U.esc(r.pedido_fornecedor || '') + '"></div></div>' +
        (semEmail.length
          ? '<div class="ajuda erro">' + semEmail.map(function (c) { return U.esc((D.credor(c) || {}).nome || c); }).join(', ') +
            ' está sem e-mail no cadastro — o pedido é enviado do mesmo jeito, mas a confirmação por e-mail ' +
            'só sai depois de preencher em Cadastros › Fornecedores.</div>'
          : '<div class="ajuda">Depois de enviar, use "E-mail ao fornecedor" pra mandar a confirmação do pedido.</div>'),
      acoes: [{ txt: 'Enviar pedido', cls: 'btn-pagar', fn: function () {
        const rr = S.enviarPedido(id, null, { prazo: U.val('pd-prazo'), pedido_fornecedor: U.val('pd-num') });
        if (rr.erro) return ERP.app.aviso(rr.erro, 'erro');
        ERP.app.fecharModal();
        ERP.contas.render();
        ERP.app.atualizarContadores();
        ERP.app.aviso('Pedido enviado' + (fornecedores.length > 1 ? ' (' + fornecedores.length + ' fornecedores)' : '') +
          ' · ' + U.brl(t.total) + '. A previsão já está no contas a pagar.', 'ok');
        render();
      } }]
    });
  }

  /* Preço da cotação + frete daquele item dividido pelas unidades. Sem
     cotação (compra antiga), cai no custo do cadastro. */
  /* Delegado ao store: o frete é rateado pela quantidade TOTAL do
     item, não pelo que falta receber (ver `custoDeAquisicao`). */
  const custoReal = (item, produto) => S.custoDeAquisicao(item, produto);

  function receber(id) {
    const r = S.compra(id);
    if (!r) return;
    const pendentes = r.itens.filter(function (i) { return i.recebido < i.qtd - 0.0001; });
    ERP.app.modal({
      titulo: 'Entrada do pedido ' + r.numero,
      corpo:
        '<div class="resumo-linha"><span>Armazém de destino</span><span class="v">' +
          U.esc((D.armazem(r.armazem) || {}).nome || '') + '</span></div>' +
        '<div class="resumo-linha"><span>Fornecedor</span><span class="v">' +
          U.esc(r.credor ? ERP.lancamento.nomeCredor(r.credor) : '—') + '</span></div>' +
        '<div class="row2"><div><label>Data da entrada</label><input type="date" id="rc-data" value="' + U.hoje() + '"></div>' +
        '<div><label>Nota / documento</label><input id="rc-doc" placeholder="nº da NF"></div></div>' +
        '<h2 style="font-size:12px;margin:14px 0 6px">O que chegou e a que custo</h2>' +
        pendentes.map(function (i) {
          const p = prod(i.produto);
          const falta = Math.round((i.qtd - i.recebido) * 1000) / 1000;
          return '<div class="rateio-lin" style="grid-template-columns:1fr 80px 90px 80px">' +
            '<span>' + U.esc(p.descricao) + '<div class="sub">falta ' + U.num(falta) + ' ' + U.esc(p.unidade) + '</div></span>' +
            '<input class="num" data-rc="' + i.produto + '" inputmode="decimal" value="' + U.num(falta) + '">' +
            /* Custo sugerido é o COTADO mais o frete rateado por
               unidade, não o do cadastro: com o custo do cadastro o
               estoque nunca refletia o que a compra custou. */
            (S.pode('ver_custo')
              ? '<input class="num" data-rcusto="' + i.produto + '" inputmode="decimal" value="' + U.num(custoReal(i, p)) + '">'
              : '<input type="hidden" data-rcusto="' + i.produto + '" value="' + U.num(custoReal(i, p)) + '">') +
            '<input data-lote="' + i.produto + '" placeholder="lote">' +
          '</div>';
        }).join('') +
        '<div class="ajuda">Quantidade, custo unitário e lote. Receber menos que o pedido deixa o pedido ' +
        'aberto pelo que falta. O custo informado aqui é o que vale no estoque.</div>',
      acoes: [{ txt: 'Dar entrada no estoque', cls: 'btn-pagar', fn: function () {
        const itensEnt = [];
        pendentes.forEach(function (i) {
          const q = document.querySelector('[data-rc="' + i.produto + '"]');
          const cu = document.querySelector('[data-rcusto="' + i.produto + '"]');
          const l = document.querySelector('[data-lote="' + i.produto + '"]');
          const qtd = U.parseValor(q ? q.value : 0);
          if (qtd > 0) itensEnt.push({ produto: i.produto, qtd: qtd,
            custo: U.parseValor(cu ? cu.value : 0), lote: l ? l.value : '' });
        });
        if (!itensEnt.length) return ERP.app.aviso('Informe o que chegou.', 'erro');
        const dadosEnt = {
          armazem: r.armazem, data: U.val('rc-data'), documento: U.val('rc-doc'),
          origem: 'compra', motivo: 'Entrada do pedido ' + r.numero,
          pedido_id: r.id, itens: itensEnt
        };
        const res = S.entradaLote(dadosEnt);
        /* Divergência contra o pedido é pergunta, não parede: a nota
           pode trazer quantidade ou preço diferente do cotado por
           razão legítima. `forcar_divergencia` existia no store e não
           tinha botão — ajustar o campo travava a entrada sem saída. */
        if (res.divergencias) {
          return ERP.app.modal({
            titulo: 'A entrada não bate com o pedido',
            corpo: '<div class="ajuda">' + res.divergencias.map(U.esc).join('<br>') + '</div>' +
              '<div class="ajuda">Se a nota veio assim mesmo, registre a entrada com os números ' +
              'dela — a diferença fica no histórico do pedido. Se foi engano de digitação, feche ' +
              'esta janela e corrija a grade.</div>' +
              '<label>Por que a entrada diverge?</label>' +
              '<input id="rc-div-motivo" placeholder="ex.: fornecedor reajustou o frete">',
            acoes: [{ txt: 'Registrar assim mesmo', cls: 'btn-aprovar', fn: function () {
              const motivo = U.val('rc-div-motivo');
              if (!motivo) return ERP.app.aviso('Diga por que a entrada diverge do pedido.', 'erro');
              const r2 = S.entradaLote(Object.assign({}, dadosEnt,
                { forcar_divergencia: true, motivo_divergencia: motivo }));
              if (r2.erro) return ERP.app.aviso(r2.erro, 'erro');
              ERP.app.fecharModal();
              ERP.app.aviso(r2.n + ' material(is) no estoque · ' + U.brl(r2.valor) +
                ' (com divergência registrada).', 'ok');
              render();
            } }]
          });
        }
        if (res.erro) return ERP.app.aviso(res.erro, 'erro');
        ERP.app.fecharModal();
        const dep = S.compra(id);
        ERP.app.aviso(res.n + ' material(is) no estoque · ' + U.brl(res.valor) + '. ' +
          (dep.status === 'recebido' ? 'Pedido recebido por completo.' : 'Pedido segue aberto pelo que falta.'), 'ok');
        render();
      } }]
    });
  }

  function ligar() {
    const box = U.el('cp-saida');
    box.querySelectorAll('[data-cp-ab]').forEach(function (tr) {
      tr.addEventListener('click', function (e) {
        if (e.target.closest('button')) return;
        const id = this.dataset.cpAb;
        abertos.has(id) ? abertos.delete(id) : abertos.add(id);
        render();
      });
    });
    box.querySelectorAll('[data-cp-ap]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); aprovarItens(this.dataset.cpAp); });
    });
    box.querySelectorAll('[data-cp-ct]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); cotar(this.dataset.cpCt); });
    });
    box.querySelectorAll('[data-cp-ac]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); aprovarPreco(this.dataset.cpAc); });
    });
    box.querySelectorAll('[data-cp-em]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); emailPedido(this.dataset.cpEm); });
    });
    box.querySelectorAll('[data-cp-pd]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); pedido(this.dataset.cpPd); });
    });
    box.querySelectorAll('[data-cp-rc]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); receber(this.dataset.cpRc); });
    });
    box.querySelectorAll('[data-cp-ed]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); nova(this.dataset.cpEd); });
    });
  }

  return { montar: montar, render: render, cotar: cotar };
})();
