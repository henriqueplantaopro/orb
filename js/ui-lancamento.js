/* ERP · ui-lancamento.js — formulário de novo lançamento.
   Campos obrigatórios espelham o fluxo atual: nº do título, tipo,
   fornecedor, natureza, emissão, vencimento e valor. O rateio
   permite dividir a mesma parcela entre vários centros de custo. */
window.ERP = window.ERP || {};

ERP.lancamento = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;
  let linhas = [];          // parcelas geradas
  let rateio = [];          // [{ centro, pct }]
  let nfAtual = null;

  const nomeCredor = v => (D.credor(v) || {}).nome || v || '';

  /* A lista do campo de credor é remontada toda vez que o formulário
     abre: fornecedor cadastrado em Cadastros aparece na hora, sem
     precisar recarregar a página. */
  function atualizarCredores() {
    const dl = U.el('dl-credores');
    if (!dl) return;
    dl.innerHTML = D.credores.filter(function (c) { return c.ativo !== false; })
      .map(function (c) { return '<option value="' + U.esc(c.nome) + '">'; }).join('');
  }

  // comparação de nome sem acento, sem caixa e sem espaço duplicado
  const chaveN = s => String(s || '').toUpperCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const idCredorPorNome = function (nome) {
    const c = D.credores.find(function (x) { return chaveN(x.nome) === chaveN(nome); });
    return c ? c.id : null;
  };
  /* O XML traz a razão social em caixa alta e o cadastro costuma ter o
     nome curto — casar por CNPJ é o que funciona de verdade. */
  const credorPorDoc = function (doc) {
    const d = String(doc || '').replace(/\D/g, '');
    if (!d) return null;
    return D.credores.find(function (c) {
      return String(c.documento || '').replace(/\D/g, '') === d;
    }) || null;
  };

  function montar() {
    // natureza: só o que se paga, agrupado por grupo do DRE
    const grupos = D.plano.filter(p => p.nivel === 1 && p.tipo !== 'receita');
    U.el('l-conta').innerHTML = '<option value="">Escolher…</option>' + grupos.map(g =>
      '<optgroup label="' + U.esc(g.cod + ' · ' + g.nome) + '">' +
      D.plano.filter(s => s.pai === g.cod)
        .map(s => '<option value="' + s.cod + '">' + U.esc(s.cod + ' ' + s.nome) + '</option>').join('') +
      '</optgroup>'
    ).join('');

    atualizarCredores();
    U.setVal('l-comp', U.mesAtual());
    U.setVal('l-venc1', U.hoje());
    preencherEmpresas();
    U.setVal('l-emissao', U.hoje());

    rateio = [{ centro: '', pct: 100 }];
    renderRateio();

    U.el('l-reten-tem').addEventListener('change', function () {
      U.el('l-reten-campos').style.display = this.checked ? '' : 'none';
      U.el('l-reten-resumo').style.display = this.checked ? '' : 'none';
      U.el('l-valor-label').textContent = this.checked ? 'Valor bruto da NF (R$) *' : 'Valor total (R$) *';
      atualizarResumoRetencao();
      regerar();
    });
    /* Bruto − retenções = líquido pago ao fornecedor — sem isso, o
       "Valor total" digitado (o bruto da nota, como qualquer um lê
       nela) virava o valor da parcela por inteiro, e a retenção saía
       DE NOVO na guia: o fornecedor recebia o bruto e a Receita/
       Prefeitura recebia a retenção por cima, uma NF de R$10.000 com
       R$650 de retenção saindo R$10.650 do caixa. Os campos de
       retenção agora recalculam a parcela ao vivo, e o resumo mostra
       as três linhas (bruto, retenção, líquido) antes de lançar. */
    ['ISS', 'IRRF', 'PIS', 'COFINS', 'CSLL', 'INSS'].forEach(function (t) {
      U.el('l-reten-' + t).addEventListener('input', function () { atualizarResumoRetencao(); });
      U.el('l-reten-' + t).addEventListener('change', regerar);
    });

    ['l-valor', 'l-venc1', 'l-period', 'l-comp'].forEach(id => {
      U.el(id).addEventListener('change', regerar);
    });
    /* F5 — parcelamento com competência única joga um contrato anual
       inteiro num mês só do DRE, e nada na tela avisa. Com mais de uma
       parcela, a competência passa a acompanhar o vencimento por
       padrão; desmarcar vira escolha consciente. */
    U.el('l-period').addEventListener('change', function () {
      /* Pagamento único não tem intervalo: a quantidade trava em 1.
         "Datas livres" mantém as parcelas e deixa digitar cada data. */
      const p = this.value;
      const qtd = U.el('l-qtd');
      if (p === 'unica') {
        U.setVal('l-qtd', 1);
        qtd.disabled = true;
        U.el('l-compsegue').checked = false;
        U.el('l-comp').disabled = false;
      } else {
        qtd.disabled = false;
      }
      regerar();
    });
    U.el('l-qtd').addEventListener('change', function () {
      const n = parseInt(this.value, 10) || 1;
      // mais de uma parcela deixa de ser pagamento único
      if (n > 1 && U.val('l-period') === 'unica') U.setVal('l-period', 'mensal');
      const chk = U.el('l-compsegue');
      if (n > 1 && !chk.checked) {
        chk.checked = true;
        U.el('l-comp').disabled = true;
        ERP.app.aviso('Com mais de uma parcela, a competência passa a acompanhar cada vencimento. ' +
          'Desmarque se o serviço foi todo de um mês só.', 'ok');
      } else if (n === 1 && chk.checked) {
        chk.checked = false;
        U.el('l-comp').disabled = false;
      }
      regerar();
    });
    /* Ao sair do campo, o valor aparece no formato da casa:
       1.234.567,00. Antes ficava como foi digitado — e a tabela de
       parcelas logo abaixo já formatava, então os dois jeitos
       apareciam lado a lado na mesma tela. */
    U.el('l-valor').addEventListener('blur', function () {
      const v = U.parseValor(this.value);
      if (v) this.value = U.num(v);
      regerar();
    });
    U.el('l-credor').addEventListener('change', function () {
      const c = D.credor(idCredorPorNome(this.value));
      if (c && c.conta_padrao && !U.val('l-conta')) U.setVal('l-conta', c.conta_padrao);
      atualizarPedidos();
    });
    U.el('l-compsegue').addEventListener('change', function () {
      U.el('l-comp').disabled = this.checked;
      regerar();
    });
    U.el('l-nf').addEventListener('change', importarArquivo);
    U.el('l-novo-credor').addEventListener('click', function () {
      abrirCadastroRapido(U.val('l-credor'), function (id, nome) { U.setVal('l-credor', nome); });
    });
    U.el('l-tipo').addEventListener('change', mostrarBarras);
    /* Também no `input`: o leitor de código de barras dispara change ao
       final, mas quem digita ou cola pode nunca sair do campo — e aí o
       aviso de dígito verificador errado nunca aparecia. */
    U.el('l-barras').addEventListener('change', lerBarras);
    let tBarras = null;
    U.el('l-barras').addEventListener('input', function () {
      clearTimeout(tBarras);
      tBarras = setTimeout(lerBarras, 350);
    });
    U.el('l-barras').addEventListener('keydown', function (e) {
      // o leitor USB manda Enter no fim da leitura
      if (e.key === 'Enter') { e.preventDefault(); lerBarras(); }
    });
    mostrarBarras();
    U.el('btn-lancar').addEventListener('click', salvar);
    U.el('btn-limpar-lanc').addEventListener('click', function () { limpar(true); });
    U.el('btn-abrir-lanc').addEventListener('click', function () { abrir(true); });
    U.el('btn-fechar-lanc').addEventListener('click', function () { abrir(false); });
    regerar();
    abrir(false);
  }

  /* Zera o formulário inteiro. O botão usa isto para descartar uma nota
     lida por engano; depois de lançar, a mesma função roda em modo
     "série", mantendo natureza, centro de custo, tipo e competência. */
  /* Lista de pedidos do fornecedor escolhido: a previsão da compra só
     é baixada pelo pedido vinculado aqui. Sem vínculo, uma nota de
     serviço abatia a previsão de uma compra de material do mesmo
     fornecedor. */
  function atualizarPedidos() {
    const sel = U.el('l-pedido');
    if (!sel) return;
    const cred = D.credor(idCredorPorNome(U.val('l-credor')));
    const abertos = cred ? S.pedidosAbertos().filter(function (r) { return r.credor === cred.id; }) : [];
    sel.innerHTML = '<option value="">Nenhum</option>' + abertos.map(function (r) {
      return '<option value="' + r.id + '">' + U.esc(r.numero) + ' · ' + U.brl(S.totalCotado(r).total) + '</option>';
    }).join('');
    sel.disabled = !abertos.length;
  }

  /* As empresas do grupo, com a do projeto já selecionada quando o
     centro é escolhido. */
  function preencherEmpresas(centro) {
    const sel = U.el('l-empresa');
    if (!sel) return;
    const atual = sel.value;
    const daqui = centro ? S.empresaDoCentro(centro) : null;
    sel.innerHTML = D.empresas.map(function (e) {
      return '<option value="' + e.id + '">' + U.esc(e.apelido || e.nome) +
        (e.cnpj ? ' · ' + U.esc(e.cnpj) : '') + '</option>';
    }).join('');
    sel.value = daqui || atual || (D.empresas[0] || {}).id || '';
  }

  function limpar(tudo) {
    ['l-desc', 'l-credor', 'l-doc', 'l-valor', 'l-obs'].forEach(function (id) { U.setVal(id, ''); });
    if (U.el('l-sem-nf')) U.el('l-sem-nf').checked = false;
    U.setVal('l-qtd', 1);
    nfAtual = null;
    barrasLido = null;
    U.setVal('l-barras', '');
    U.el('l-barras-info').innerHTML = '';
    U.el('l-nf').value = '';
    U.el('l-nf-info').innerHTML = '';
    U.el('l-reten-tem').checked = false;
    U.el('l-reten-campos').style.display = 'none';
    ['ISS', 'IRRF', 'PIS', 'COFINS', 'CSLL', 'INSS'].forEach(function (t) { U.setVal('l-reten-' + t, 0); });

    if (tudo) {
      U.setVal('l-conta', '');
      U.setVal('l-tipo', 'nf');
      U.setVal('l-origem', 'manual');
      U.setVal('l-emissao', U.hoje());
      U.setVal('l-venc1', U.hoje());
      U.setVal('l-period', 'mensal');
      U.setVal('l-comp', U.mesAtual());
      U.el('l-compsegue').checked = false;
      U.el('l-comp').disabled = false;
      rateio = [{ centro: '', pct: 100 }];
      renderRateio();
      mostrarBarras();
      ERP.app.aviso('Formulário limpo.', 'ok');
    }
    regerar();
    U.el('l-desc').focus();
  }

  /* ── abrir / fechar o painel ────────────────────────────*/
  function abrir(sim) {
    U.el('card-lancamento').style.display = sim ? '' : 'none';
    U.el('btn-abrir-lanc').style.display = sim ? 'none' : '';
    // a dica ao lado do botão saiu da tela (poluía sem informar)
    if (sim) U.el('l-desc').focus();
  }

  /* ── boleto: código de barras ───────────────────────────*/
  let barrasLido = null;
  function mostrarBarras() {
    const t = U.val('l-tipo');
    U.el('l-barras-box').style.display = (t === 'boleto' || t === 'guia') ? '' : 'none';
  }

  function lerBarras() {
    const bruto = U.val('l-barras');
    if (!bruto) { barrasLido = null; U.el('l-barras-info').innerHTML = ''; return; }
    const r = ERP.boleto.ler(bruto);
    if (r.erro) {
      barrasLido = null;
      U.el('l-barras-info').innerHTML = '';
      /* só reclama quando já há dígitos suficientes para ser uma linha
         de verdade — senão acusa erro a cada tecla */
      if (String(bruto).replace(/\D/g, '').length >= 44) ERP.app.erroCampo('l-barras', r.erro);
      return;
    }
    U.el('l-barras').classList.remove('campo-erro');
    barrasLido = r;
    if (r.valor > 0) U.setVal('l-valor', U.num(r.valor));
    if (r.vencimento) U.setVal('l-venc1', r.vencimento);
    if (r.linhaDigitavel) U.setVal('l-barras', ERP.boleto.formatar(r.linhaDigitavel));
    regerar();
    U.el('l-barras-info').innerHTML = '<div class="nf-lida">' +
      (r.tipo === 'arrecadacao' ? '<b>Guia de arrecadação</b>' : '<b>Boleto do banco ' + U.esc(r.banco) + '</b>') +
      (r.vencimento ? ' · vence ' + U.fData(r.vencimento) : '') +
      ' · ' + U.brl(r.valor) +
      '<div class="chave">' + U.esc(r.codigoBarras) + '</div>' +
      (r.aviso ? '<div class="ajuda">' + U.esc(r.aviso) + '</div>' : '') + '</div>';
  }

  /* ── rateio entre centros de custo ──────────────────────*/
  function opcoesCentro(sel) {
    const marca = c => (c.id === sel ? ' selected' : '');
    return '<option value="">Escolher…</option>' +
      D.centros.filter(c => c.ativo).map(c => '<option value="' + c.id + '"' + marca(c) + '>' +
        U.esc(c.codigo + ' · ' + c.nome) + '</option>').join('') +
      '<optgroup label="Encerrados (rescisão, saldo atrasado)">' +
      D.centros.filter(c => !c.ativo).map(c => '<option value="' + c.id + '"' + marca(c) + '>' +
        U.esc(c.codigo + ' · ' + c.nome) + '</option>').join('') + '</optgroup>';
  }

  function renderRateio() {
    const box = U.el('l-rateio');
    const varias = rateio.length > 1;
    const soma = Math.round(rateio.reduce(function (s, r) { return s + (r.pct || 0); }, 0) * 100) / 100;

    box.innerHTML = rateio.map(function (r, i) {
      return '<div class="rateio-lin' + (varias ? '' : ' unica') + '">' +
        '<select data-i="' + i + '" data-c="centro">' + opcoesCentro(r.centro) + '</select>' +
        (varias
          ? '<input class="pct" data-i="' + i + '" data-c="pct" inputmode="decimal" value="' + U.num(r.pct) + '">' +
            '<button class="btn-ghost" data-rem="' + i + '" title="Remover" type="button">✕</button>'
          : '') +
      '</div>';
    }).join('') +
    '<div class="rateio-pe">' +
      '<button class="btn-sm" id="l-add-centro" type="button">+ ratear em outro centro</button>' +
      (varias ? '<span class="soma' + (Math.abs(soma - 100) < 0.01 ? '' : ' erro') + '">' + U.num(soma) + '% do valor</span>' : '') +
    '</div>';

    box.querySelectorAll('select,input').forEach(function (e) {
      e.addEventListener('change', function () {
        const i = +this.dataset.i;
        if (this.dataset.c === 'pct') rateio[i].pct = U.parseValor(this.value);
        else {
          rateio[i].centro = this.value;
          /* O primeiro centro sugere de quem é a nota — o operador
             troca quando for de outra empresa do grupo. */
          if (i === 0) preencherEmpresas(this.value);
        }
        renderRateio();
      });
    });
    box.querySelectorAll('[data-rem]').forEach(function (b) {
      b.addEventListener('click', function () {
        rateio.splice(+this.dataset.rem, 1);
        if (rateio.length === 1) rateio[0].pct = 100;
        renderRateio();
      });
    });
    U.el('l-add-centro').addEventListener('click', function () {
      if (rateio.length === 1) {
        rateio[0].pct = 50;
        rateio.push({ centro: '', pct: 50 });
      } else {
        const usado = rateio.reduce(function (s, r) { return s + (r.pct || 0); }, 0);
        rateio.push({ centro: '', pct: Math.max(0, Math.round((100 - usado) * 100) / 100) });
      }
      renderRateio();
    });
  }

  /* ── parcelas ───────────────────────────────────────────*/
  // soma dos 6 campos de retenção digitados na tela, só quando o checkbox está marcado
  function somaRetencoesDigitadas() {
    if (!U.el('l-reten-tem').checked) return 0;
    return Math.round(['ISS', 'IRRF', 'PIS', 'COFINS', 'CSLL', 'INSS'].reduce(function (s, t) {
      return s + (U.parseValor(U.val('l-reten-' + t)) || 0);
    }, 0) * 100) / 100;
  }

  function atualizarResumoRetencao() {
    const el = U.el('l-reten-resumo');
    if (!el || el.style.display === 'none') return;
    const bruto = U.parseValor(U.val('l-valor')) || 0;
    const retido = somaRetencoesDigitadas();
    const liquido = Math.round((bruto - retido) * 100) / 100;
    el.innerHTML = 'Bruto ' + U.brl(bruto) + ' · Retenções −' + U.brl(retido) +
      ' · <b>Líquido a pagar ao fornecedor: ' + U.brl(liquido) + '</b>' +
      (liquido < 0 ? ' <span style="color:var(--red)">— a retenção não pode passar do bruto</span>' : '');
  }

  function regerar() {
    const bruto = U.parseValor(U.val('l-valor'));
    const retido = somaRetencoesDigitadas();
    const valorTotal = Math.max(0, Math.round((bruto - retido) * 100) / 100);
    linhas = S.gerarParcelas({
      valorTotal: valorTotal,
      qtd: Math.max(1, parseInt(U.val('l-qtd'), 10) || 1),
      primeiroVenc: U.val('l-venc1') || U.hoje(),
      periodicidade: U.val('l-period'),
      competencia: U.val('l-comp'),
      compSegueVenc: U.el('l-compsegue').checked
    });
    atualizarResumoRetencao();
    render();
  }

  function render() {
    const box = U.el('l-parcelas');
    box.innerHTML =
      '<div class="cab"><span>Parc.</span><span>Vencimento</span><span>Valor</span></div>' +
      linhas.map(function (l, i) {
        return '<div class="lin">' +
          '<span class="n">' + l.num + '/' + linhas.length + '</span>' +
          '<input type="date" value="' + (l.venc || '') + '" data-i="' + i + '" data-c="venc">' +
          '<input inputmode="decimal" value="' + U.num(l.valor) + '" data-i="' + i + '" data-c="valor" class="num">' +
        '</div>';
      }).join('') +
      '<div class="rodape"><span>Soma das parcelas</span>' +
      '<span class="dif" id="l-soma"></span></div>';
    atualizarSoma();

    /* Não redesenhar a lista ao digitar.

       O `change` de um <input type="date"> dispara assim que a data
       fica válida, e o navegador monta uma data completa já no primeiro
       dígito do ano. Redesenhando, o elemento é trocado, o foco vai
       embora e os outros três dígitos não têm onde entrar. Só a soma do
       rodapé é atualizada. */
    box.querySelectorAll('input').forEach(function (inp) {
      const guarda = function () {
        const i = +this.dataset.i;
        if (this.dataset.c === 'venc') {
          linhas[i].venc = this.value;
          if (U.el('l-compsegue').checked) linhas[i].comp = U.compDe(this.value);
        } else {
          linhas[i].valor = U.parseValor(this.value);
        }
        atualizarSoma();
      };
      inp.addEventListener('input', guarda);
      inp.addEventListener('change', guarda);
    });
  }

  function atualizarSoma() {
    const el = U.el('l-soma');
    if (!el) return;
    const total = linhas.reduce(function (s, l) { return s + l.valor; }, 0);
    /* Com retenção marcada, a soma das parcelas bate com o LÍQUIDO
       (bruto − retenções), não com o valor bruto digitado em "Valor
       total" — sem esse ajuste, toda NF com retenção mostrava uma
       "diferença" do tamanho exato da retenção, mesmo estando tudo
       certo. */
    const alvo = Math.round((U.parseValor(U.val('l-valor')) - somaRetencoesDigitadas()) * 100) / 100;
    const dif = Math.round((total - alvo) * 100) / 100;
    const ok = Math.abs(dif) < 0.005;
    el.className = 'dif ' + (ok ? 'ok' : 'erro');
    el.textContent = U.brl(total) + (ok ? '' : ' · difere ' + U.brl(dif));
  }

  /* ── importação de nota fiscal ──────────────────────────
     XML da NF-e é lido no navegador: emitente, número, chave, emissão,
     valor e as DUPLICATAS, que já são o parcelamento.
     PDF fica anexado — ler DANFE exige um passo no servidor. */
  function importarArquivo(e) {
    const arq = e.target.files && e.target.files[0];
    if (!arq) return;
    if (/\.pdf$/i.test(arq.name)) {
      nfAtual = { arquivo: arq.name };
      U.setVal('l-origem', 'nota_fiscal');
      U.el('l-nf-info').innerHTML = '<div class="nf-lida">Lendo <b>' + U.esc(arq.name) + '</b>…</div>';
      const lp = new FileReader();
      lp.onload = function () {
        ERP.danfe.ler(new Uint8Array(lp.result), { cnpjEmpresa: (D.bancos[0] || {}).cnpj })
          .then(function (r) { aplicarPDF(r, arq.name); });
      };
      lp.readAsArrayBuffer(arq);
      return;
    }
    const leitor = new FileReader();
    leitor.onload = function () {
      try { aplicarNF(lerXML(leitor.result), arq.name); }
      catch (err) { ERP.app.aviso('Não consegui ler este XML como NF-e.', 'erro'); }
    };
    leitor.readAsText(arq, 'UTF-8');
  }

  const lerXML = function (texto) {
    return ERP.nfe.ler(texto, { cnpjEmpresa: (D.bancos[0] || {}).cnpj || D.empresa.cnpj });
  };

  /* PDF: a chave de acesso é o que dá certeza; valor e duplicatas vêm
     de heurística sobre o texto e ficam marcados para conferência. */
  function aplicarPDF(r, arquivo) {
    if (r.erro) {
      nfAtual = { arquivo: arquivo };
      U.el('l-nf-info').innerHTML = '<div class="nf-lida">Anexado: <b>' + U.esc(arquivo) + '</b>' +
        '<div class="ajuda erro">' + U.esc(r.erro) + '</div></div>';
      return;
    }
    abrir(true);
    nfAtual = { chave: r.chave, arquivo: arquivo, serie: r.serie, tipo_doc: 'pdf',
                itens: [], retencoes: [], valor_retido: 0, emitente: r.emitente };

    if (r.numero) U.setVal('l-doc', r.numero + (r.serie ? '/' + r.serie : ''));
    U.setVal('l-tipo', 'nf');
    if (r.valor) U.setVal('l-valor', U.num(r.valor));
    if (r.emissao) {
      U.setVal('l-emissao', r.emissao);
      U.setVal('l-comp', r.emissao.slice(0, 7));
    }
    const c = credorPorDoc(r.emitente.documento);
    if (c) {
      U.setVal('l-credor', c.nome);
      if (c.conta_padrao) U.setVal('l-conta', c.conta_padrao);
    } else if (r.emitente.nome) {
      U.setVal('l-credor', r.emitente.nome);
    }
    if (!U.val('l-desc')) U.setVal('l-desc', 'Nota fiscal ' + (r.numero || '') + ' — ' + (r.emitente.nome || ''));

    if (r.duplicatas.length) {
      U.setVal('l-qtd', r.duplicatas.length);
      U.setVal('l-venc1', r.duplicatas[0].venc);
      linhas = r.duplicatas.map(function (d, i) {
        return { num: i + 1, venc: d.venc, valor: d.valor,
                 comp: U.el('l-compsegue').checked ? U.compDe(d.venc) : U.val('l-comp') };
      });
      render();
    } else {
      regerar();
    }

    U.el('l-nf-info').innerHTML = '<div class="nf-lida">' +
      '<b>' + U.esc(r.rotulo) + '</b>' + (r.numero ? ' nº ' + U.esc(r.numero) : '') +
      (r.serie ? '/' + U.esc(r.serie) : '') + (r.uf ? ' · ' + U.esc(r.uf) : '') + '<br>' +
      (r.emitente.nome ? U.esc(r.emitente.nome) + ' · ' : '') + U.esc(r.emitente.documento || '—') + '<br>' +
      U.brl(r.valor) + (r.emissao ? ' · emissão ' + U.fData(r.emissao) : '') +
      (r.duplicatas.length ? ' · ' + r.duplicatas.length + ' duplicata(s) na grade' : '') +
      (r.chave ? '<div class="chave">' + U.esc(r.chave) + '</div>' : '') +
      (r.avisos.length ? '<div class="ajuda erro" style="margin-top:5px">' +
        r.avisos.map(function (a) { return U.esc(a); }).join('<br>') + '</div>' : '') +
      '<div class="ajuda">Do PDF só dá para ler o que está impresso. Se tiver o XML, use ele: ' +
      'traz itens, retenções e duplicatas exatas.</div></div>';
    ERP.app.aviso(r.confiavel
      ? 'PDF lido pela chave de acesso. Confira valor e parcelas antes de lançar.'
      : 'PDF lido por texto, sem chave válida. Confira todos os campos.', 'ok');
  }

  function aplicarNF(nf, arquivo) {
    if (nf.erro) { ERP.app.aviso(nf.erro, 'erro'); return; }
    nfAtual = {
      chave: nf.chave, arquivo: arquivo, serie: nf.serie, tipo_doc: nf.tipo,
      itens: nf.itens, retencoes: nf.retencoes,
      valor_retido: nf.valorRetido, valor_bruto: nf.valor,
      emitente: nf.emitente, municipio_iss: nf.municipio_incidencia || ''
    };
    abrir(true);

    U.setVal('l-desc', (nf.natureza || nf.rotulo) + ' — NF ' + nf.numero);
    U.setVal('l-credor', nf.emitente.nome);
    U.setVal('l-doc', nf.numero + (nf.serie ? '/' + nf.serie : ''));
    U.setVal('l-tipo', 'nf');
    U.setVal('l-origem', 'nota_fiscal');
    U.setVal('l-valor', U.num(nf.valor));
    U.setVal('l-obs', nf.complemento || '');
    if (nf.emissao) {
      U.setVal('l-emissao', nf.emissao);
      U.setVal('l-comp', nf.emissao.slice(0, 7));
    }
    if (nf.valorRetido > 0) {
      U.el('l-reten-tem').checked = true;
      U.el('l-reten-campos').style.display = '';
      ['ISS', 'IRRF', 'PIS', 'COFINS', 'CSLL', 'INSS'].forEach(function (t) { U.setVal('l-reten-' + t, 0); });
      (nf.retencoes || []).forEach(function (r) {
        if (U.el('l-reten-' + r.tributo)) U.setVal('l-reten-' + r.tributo, U.num(r.valor));
      });
      U.el('l-reten-resumo').style.display = '';
      U.el('l-valor-label').textContent = 'Valor bruto da NF (R$) *';
      atualizarResumoRetencao();
    }

    const c = D.credor(idCredorPorNome(nf.emitente.nome)) || credorPorDoc(nf.emitente.documento);
    if (c) {
      U.setVal('l-credor', c.nome);          // usa o nome do cadastro, não o do XML
      if (c.conta_padrao) U.setVal('l-conta', c.conta_padrao);
    }

    if (nf.duplicatas.length) {
      U.setVal('l-qtd', nf.duplicatas.length);
      U.setVal('l-venc1', nf.duplicatas[0].venc);
      linhas = nf.duplicatas.map(function (d, i) {
        return {
          num: i + 1, venc: d.venc, valor: d.valor,
          comp: U.el('l-compsegue').checked ? U.compDe(d.venc) : U.val('l-comp')
        };
      });
      render();
    } else {
      U.setVal('l-qtd', 1);
      if (nf.emissao) U.setVal('l-venc1', nf.emissao);
      regerar();
    }

    U.el('l-nf-info').innerHTML = '<div class="nf-lida">' +
      '<b>' + U.esc(nf.rotulo) + ' nº ' + U.esc(nf.numero) + (nf.serie ? '/' + U.esc(nf.serie) : '') + '</b><br>' +
      U.esc(nf.emitente.nome) + (nf.emitente.documento ? ' · ' + U.esc(nf.emitente.documento) : '') +
      (nf.emitente.municipio ? ' · ' + U.esc(nf.emitente.municipio) + '/' + U.esc(nf.emitente.uf) : '') + '<br>' +
      U.brl(nf.valor) + ' · emissão ' + U.fData(nf.emissao) +
      (nf.itens.length ? ' · ' + nf.itens.length + ' item(ns)' : '') +
      (nf.duplicatas.length ? ' · ' + nf.duplicatas.length + ' duplicata(s) na grade' : ' · sem duplicatas: parcelamento à mão') +
      (nf.valorRetido > 0
        ? '<div style="margin-top:5px">Retenções: ' +
          nf.retencoes.map(function (r) { return U.esc(r.tributo) + ' ' + U.brl(r.valor); }).join(' · ') +
          ' — total ' + U.brl(nf.valorRetido) + ', líquido ' + U.brl(nf.valorLiquido) + '</div>'
        : '') +
      (nf.chave ? '<div class="chave">' + U.esc(nf.chave) + '</div>' : '') +
      (nf.itens.length
        ? '<details style="margin-top:6px"><summary class="ajuda" style="cursor:pointer">ver itens da nota</summary>' +
          '<table style="margin-top:4px"><tbody>' + nf.itens.map(function (i) {
            return '<tr><td>' + U.esc(i.descricao) + '</td>' +
              '<td class="num">' + i.qtd + ' ' + U.esc(i.unidade) + '</td>' +
              '<td class="num">' + U.brl(i.valor) + '</td></tr>';
          }).join('') + '</tbody></table></details>'
        : '') +
      (nf.avisos.length
        ? '<div class="ajuda erro" style="margin-top:6px">' +
          nf.avisos.map(function (a) { return U.esc(a); }).join('<br>') + '</div>'
        : '') +
      '</div>';
    ERP.app.aviso('Nota lida. Confira a natureza, o centro de custo e as parcelas antes de lançar.', 'ok');
  }

  /* F3 — o campo era polimórfico: às vezes id do cadastro, às vezes
     texto cru, e o mesmo fornecedor virava dois no relatório. Agora só
     entra id; quem não existe passa pelo cadastro rápido aqui mesmo. */
  /* Dígito verificador de CPF — só isso decide com confiança se um
     número de 11 dígitos é CPF ou celular com DDD (os dois têm o mesmo
     tamanho). Um celular passar nessa conta por acaso é raro (~1%). */
  function pareceCPF(v) {
    const s = String(v || '').replace(/\D/g, '');
    if (s.length !== 11 || /^(\d)\1{10}$/.test(s)) return false;
    const dig = base => {
      let soma = 0;
      for (let i = 0; i < base; i++) soma += Number(s[i]) * (base + 1 - i);
      const r = (soma * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return dig(9) === Number(s[9]) && dig(10) === Number(s[10]);
  }

  /* Código de forma de pagamento da própria NF-e (tPag) — não é
     garantia (o emissor às vezes marca "outros"), mas é muito mais
     confiável que assumir PIX sempre. Só mapeia os códigos em que dá
     pra confiar; o resto fica sem sugestão em vez de chutar. */
  const FORMA_POR_TPAG = { '15': 'boleto', '17': 'pix', '18': 'ted', '16': 'ted', '01': 'dinheiro' };

  function abrirCadastroRapido(nome, aoCriar, contaSugerida) {
    // se o nome veio de um XML lido agora, já traz CNPJ e endereço
    const doXml = (nfAtual && nfAtual.emitente &&
      nfAtual.emitente.nome === nome) ? nfAtual.emitente : null;
    const tPag = (nfAtual && nfAtual.pagamento) ? nfAtual.pagamento.tPag : null;
    const formaSugerida = FORMA_POR_TPAG[tPag] || null;
    const tipoSugerido = S.tipoCredorPorConta(contaSugerida || U.val('l-conta'));
    const contaPreSelecionada = contaSugerida || U.val('l-conta');
    ERP.app.modal({
      titulo: 'Cadastrar credor',
      corpo:
        '<div class="ajuda" style="margin-bottom:8px">"' + U.esc(nome) + '" não está no cadastro. ' +
        'Sem CPF/CNPJ, forma de pagamento e chave, o título nasce travado para pagamento.</div>' +
        '<label>Nome</label><input id="cr-nome" value="' + U.esc(nome) + '">' +
        '<div class="row2"><div><label>CPF / CNPJ</label><input id="cr-doc" inputmode="numeric" value="' +
          U.esc(doXml ? doXml.documento : '') + '"></div>' +
        '<div><label>Tipo</label><select id="cr-tipo">' +
          ['fornecedor', 'medico', 'orgao', 'socio', 'outro'].map(function (t) {
            const rot = { fornecedor: 'Fornecedor', medico: 'Médico', orgao: 'Órgão público',
              socio: 'Sócio', outro: 'Outro' }[t];
            return '<option value="' + t + '"' + (t === tipoSugerido ? ' selected' : '') + '>' + rot + '</option>';
          }).join('') + '</select></div></div>' +
        '<div class="row2"><div><label>Forma de pagamento' +
          (formaSugerida ? '' : ' <span class="sub">(a nota não deixou claro)</span>') +
          '</label><select id="cr-forma">' +
          Object.keys(D.formasPagamento).map(function (k) {
            return '<option value="' + k + '"' + (k === formaSugerida ? ' selected' : '') + '>' +
              U.esc(D.formasPagamento[k].nome) + '</option>';
          }).join('') + '</select></div>' +
        '<div><label>Chave PIX (se for PIX)</label><input id="cr-pix" value="' +
          /* CNPJ vira sugestão de chave só quando a nota realmente diz
             PIX — botar o CNPJ ali sem essa confirmação é inventar uma
             chave que pode nem existir. */
          U.esc(formaSugerida === 'pix' && doXml ? doXml.documento : '') + '"></div></div>' +
        '<label>Natureza padrão</label><select id="cr-conta">' +
          D.plano.filter(function (p) { return p.nivel === 2 && p.pai !== '1'; }).map(function (p) {
            return '<option value="' + p.cod + '"' + (p.cod === contaPreSelecionada ? ' selected' : '') + '>' +
              U.esc(p.cod + ' ' + p.nome) + '</option>';
          }).join('') + '</select>',
      acoes: [{ txt: 'Cadastrar e lançar', cls: 'btn-aprovar', fn: function () {
        const nomeNovo = U.val('cr-nome');
        if (!nomeNovo) return ERP.app.aviso('Informe o nome do credor.', 'erro');
        const id = 'cr' + (D.credores.length + 1) + '-' + Date.now().toString(36);
        const chave = U.val('cr-pix');
        const doc = U.val('cr-doc').replace(/\D/g, '');
        /* Já existe com esse documento? Não recusa: usa o que está lá.
           O caso comum é o fornecedor ter sido cadastrado em Cadastros e
           o nome digitado aqui estar um pouco diferente. */
        const repetido = D.credores.find(function (x) {
          return doc && String(x.documento || '').replace(/\D/g, '') === doc; });
        if (repetido) {
          atualizarCredores();
          ERP.app.fecharModal();
          ERP.app.aviso('Este documento já é do cadastro de "' + repetido.nome +
            '" — usei ele no lançamento.', 'ok');
          aoCriar(repetido.id, repetido.nome);
          return;
        }
        const chaveNumerica = chave.replace(/\D/g, '');
        D.credores.push({
          id: id, nome: nomeNovo, tipo: U.val('cr-tipo'), ativo: true,
          razao_social: doXml ? doXml.nome : '',
          documento: U.val('cr-doc'), forma_pagamento: U.val('cr-forma'),
          pix: chave,
          /* 11 dígitos é CPF ou celular com DDD — só o dígito
             verificador do CPF decide com confiança; sem isso, tudo
             que tivesse 11 dígitos virava CPF, e celular usado como
             chave PIX saía com o tipo errado no CNAB. */
          tipo_chave: !chave ? ''
            : chave.indexOf('@') > -1 ? 'Email'
            : /^[0-9a-f]{8}-/i.test(chave) ? 'Aleatoria'
            : chaveNumerica.length === 14 ? 'CNPJ'
            : chaveNumerica.length === 11 ? (pareceCPF(chaveNumerica) ? 'CPF' : 'Telefone')
            : 'Telefone',
          conta_padrao: U.val('cr-conta')
        });
        atualizarCredores();
        ERP.app.fecharModal();
        ERP.app.aviso('Fornecedor cadastrado. Aparece em Cadastros › Fornecedores.', 'ok');
        aoCriar(id, nomeNovo);
      } }]
    });
  }

  /* ── gravar ─────────────────────────────────────────────*/
  function salvar() {
    const credorTxt = U.val('l-credor');
    const doXml = nfAtual && nfAtual.emitente ? nfAtual.emitente.documento : '';
    const achado = idCredorPorNome(credorTxt) || (credorPorDoc(doXml) || {}).id;
    if (credorTxt && !achado) {
      abrirCadastroRapido(credorTxt, function () { salvar(); });
      return;
    }
    /* Os campos de retenção valem por cima do que veio do XML — é
       assim que dá pra corrigir uma leitura errada, ou reter algo que
       a nota não trouxe (o caso de a HJM reter de um fornecedor, não
       o órgão retendo da HJM). Só entra o que o usuário marcou. */
    const temReten = U.el('l-reten-tem').checked;
    const retencoes = temReten
      ? ['ISS', 'IRRF', 'PIS', 'COFINS', 'CSLL', 'INSS'].map(function (t) {
          return { tributo: t, valor: U.parseValor(U.val('l-reten-' + t)) };
        }).filter(function (r) { return r.valor > 0; })
      : null;
    const valorRetido = retencoes ? Math.round(retencoes.reduce(function (s, r) { return s + r.valor; }, 0) * 100) / 100 : 0;
    const dadosTitulo = {
      descricao: U.val('l-desc'),
      documento: U.val('l-doc'),
      /* Marcação explícita de "sem NF": é ela que alimenta o alerta de
         pagamento sem nota — e some sozinha quando alguém informa o
         número depois. */
      sem_nf: U.el('l-sem-nf') ? U.el('l-sem-nf').checked && !U.val('l-doc') : false,
      tipo_titulo: U.val('l-tipo'),
      credor: achado,
      conta: U.val('l-conta'),
      rateio: rateio,
      emissao: U.val('l-emissao'),
      origem: U.val('l-origem'),
      chave: nfAtual ? nfAtual.chave : null,
      serie: nfAtual ? nfAtual.serie : null,
      nf_itens: nfAtual ? nfAtual.itens : null,
      /* O bruto da nota vai junto para o store conferir a conta:
         parcelas + retenções = bruto. Antes a regra só existia aqui, e
         valia só enquanto ninguém mexesse na grade de parcelas. */
      /* De quem é a obrigação. Sem isto, o sistema assumia a empresa
         do projeto, e uma nota da matriz com custo em projeto da
         Novaped virava mútuo sem ser — o inverso do defeito que a
         conta corrente existe para pegar. */
      empresa_tomadora: U.val('l-empresa') || undefined,
      valor_bruto: (U.parseValor(U.val('l-valor')) || 0) > 0
        ? U.parseValor(U.val('l-valor')) : undefined,
      retencoes: retencoes,
      valor_retido: valorRetido,
      municipio_iss: nfAtual ? (nfAtual.municipio_iss || '') : '',
      codigo_barras: barrasLido ? barrasLido.codigoBarras : null,
      linha_digitavel: barrasLido ? (barrasLido.linhaDigitavel || '') : null,
      arquivo: nfAtual ? nfAtual.arquivo : null,
      obs: U.val('l-obs')
    };
    const r = S.criarTitulo(dadosTitulo, linhas);

    /* Documento repetido no mesmo fornecedor: mostra o que já existe e
       pede confirmação, em vez de barrar (nota parcelada relançada e
       recibo com número repetido existem) ou deixar passar calado. */
    if (r.duplicado_documento) {
      ERP.app.modal({
        titulo: 'Este documento já foi lançado', fecharTxt: 'Revisar',
        corpo: '<div class="aviso-linha erro">' + U.esc(r.erro) + '</div>' +
          '<table><thead><tr><th>Documento</th><th>Emissão</th><th class="num">Valor</th>' +
          '<th>Situação</th></tr></thead><tbody>' +
          (r.titulos || []).map(function (id) {
            const t = S.st.titulos.find(function (x) { return x.id === id; });
            if (!t) return '';
            const pcs = S.todasParcelas().filter(function (p) { return p.titulo_id === t.id; });
            return '<tr><td class="mono">' + U.esc(t.doc || '') + '</td>' +
              '<td class="mono">' + U.fData(t.emissao) + '</td>' +
              '<td class="num">' + U.brl(t.valor_total || 0) + '</td>' +
              '<td>' + U.esc(pcs.map(function (p) { return p.status; }).join(', ')) + '</td></tr>';
          }).join('') + '</tbody></table>' +
          '<div class="ajuda">Se for mesmo um lançamento novo (nota parcelada relançada, recibo com ' +
            'número repetido), confirme abaixo. Se for engano, revise o número do documento.</div>',
        acoes: [{ txt: 'É outro lançamento, confirmar', cls: 'btn-cancelar', fn: function () {
          const r2 = S.criarTitulo(Object.assign({}, dadosTitulo, { confirmar_duplicado: true }), linhas);
          if (r2.erro) return ERP.app.aviso(r2.erro, 'erro');
          ERP.app.fecharModal();
          ERP.app.aviso('Lançado, com o documento repetido confirmado.', 'ok');
          limpar(false); ERP.contas.render(); ERP.app.atualizarContadores();
        } }]
      });
      return;
    }
    if (r.erro) { ERP.app.aviso(r.erro, 'erro'); return; }

    const n = linhas.length;
    ERP.app.aviso('Lançado: ' + n + (n > 1 ? ' parcelas' : ' parcela') +
      ' — já está no contas a pagar.' +
      ((r.alertas && r.alertas.length) ? ' Atenção: ' + r.alertas.join(' ') : ''), 'ok');
    // mantém natureza, rateio, tipo e competência para lançamento em série
    limpar(false);
    ERP.contas.render();
    ERP.app.atualizarContadores();
    U.el('l-desc').focus();
  }

  return { montar: montar, nomeCredor: nomeCredor, abrir: abrir, atualizarCredores: atualizarCredores,
           lerXML: lerXML, aplicarNF: aplicarNF, aplicarPDF: aplicarPDF, opcoesCentro: opcoesCentro,
           abrirCadastroRapido: abrirCadastroRapido };
})();
