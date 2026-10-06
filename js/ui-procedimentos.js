/* ERP · ui-procedimentos.js — mutirão do HGB.

   Três abas: lançar a cirurgia, ver os lançamentos e os relatórios.

   O operador é quem está no centro cirúrgico: digita o nome do médico
   (que não é cadastro — são profissionais rotativos do mutirão), o
   paciente, escolhe o procedimento da tabela PATE e marca quanto usou
   de cada material do setor. O resto o sistema calcula. */
window.ERP = window.ERP || {};

ERP.procedimentos = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;
  let aba = 'lancar';
  /* O formulário vive fora do render: redesenhar a tela a cada
     material marcado não pode apagar o que já foi digitado. */
  let form = null;
  let filtro = {};
  let relAba = 'completo';
  let fechComp = U.compDe(U.hoje());

  function novoForm() {
    return {
      data: U.hoje(), especialidade: '', procedimento: '', medico: '', paciente: '',
      armazem: '', qtd: 1, repasse: '', observacao: '',
      materiais: {}   // produto → qtd
    };
  }

  function montar() {
    document.querySelectorAll('#pc-nav button').forEach(function (b) {
      b.addEventListener('click', function () { aba = this.dataset.pc; render(); });
    });
  }

  /* Quem lança a cirurgia no centro cirúrgico não vê dinheiro: sem
     `ver_custo`, some faturamento, repasse, imposto, resultado e até o
     custo unitário do material. O operacional precisa registrar o que
     foi usado, não saber quanto a empresa ganha com a cirurgia. */
  /* Os dois vêm da matriz de acesso (Administração › Perfis): o nível
     financeiro decide se a tela mostra dinheiro, e o de movimentação
     decide se a pessoa lança. */
  const veValor = () => S.veFinanceiro('procedimentos');
  const podeLancar = () => S.podeMover('procedimentos');
  const nomeArm = id => (D.armazem(id) || {}).nome || '—';
  const proced = id => D.pateP(id);

  function render() {
    /* Dois relatórios no mesmo lugar: quem não vê valores recebe o
       operacional (produção: quantidade, médico, sala, material
       consumido); quem tem `ver_custo` recebe o gerencial, com
       faturamento, custo e resultado. */
    /* Fechamento é do financeiro: quem não vê valor não fecha
       competência nem gera repasse. */
    const fechBtn = document.querySelector('#pc-nav button[data-pc="fechamento"]');
    if (fechBtn) fechBtn.style.display = veValor() ? '' : 'none';
    if (!veValor() && aba === 'fechamento') aba = 'lista';
    const relBtn = document.querySelector('#pc-nav button[data-pc="relatorios"]');
    if (relBtn) relBtn.textContent = veValor() ? 'Relatórios' : 'Produção';
    /* Sem movimentação no módulo, a aba de lançar não existe: quem só
       consulta não precisa de formulário. */
    const lancBtn = document.querySelector('#pc-nav button[data-pc="lancar"]');
    if (lancBtn) lancBtn.style.display = podeLancar() ? '' : 'none';
    if (!podeLancar() && aba === 'lancar') aba = 'lista';
    document.querySelectorAll('#pc-nav button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.pc === aba);
    });
    const alvo = U.el('pc-saida');
    if (!alvo) return;
    if (!form) form = novoForm();
    alvo.innerHTML =
      aba === 'lancar'     ? telaLancar() :
      aba === 'padroes'    ? telaPadroes() :
      aba === 'fechamento' ? telaFechamento() :
      aba === 'relatorios' ? (veValor() ? telaRelatorios() : telaProducao()) : telaLista();
    if (aba === 'padroes') ligarPadroes();
    else if (aba === 'lancar') ligarLancar();
    else if (aba === 'fechamento') ligarFechamento();
    else if (aba === 'lista') ligarLista();
    else if (veValor()) ligarRelatorios();
    else ligarProducao();
  }

  /* ── aba 1: lançar ─────────────────────────────────────*/
  function procedimentosDa(esp) {
    return D.tabelaPate.filter(function (p) { return !esp || p.area === esp; });
  }

  /* Material do setor, com saldo. Só aparece o que tem saldo: marcar o
     que não existe no armazém só geraria erro na hora de gravar. */
  /* Material da sala e do hospital. Aparece o que tem saldo em
     qualquer estoque da unidade: se a sala está zerada mas há caixa no
     almoxarifado, a cirurgia usou assim mesmo — o sistema puxa na hora
     da baixa e registra a transferência. */
  function materiaisDo(armazem) {
    return D.produtos.filter(function (p) { return p.ativo; }).map(function (p) {
      const naSala = S.saldoEstoque(p.id, armazem);
      const un = S.saldoNaUnidade(p.id, armazem) || { saldo: naSala, pai: armazem };
      /* Custo do material que vai ser puxado de outra sala: sem
         procurar onde ele está, a prévia mostrava R$ 0,00 para item
         que a sala não tem — e o custo só apareceria depois de gravar. */
      let medio = S.custoMedio(p.id, armazem);
      if (!medio) {
        const fontes = D.comSetores(un.pai).filter(function (am) {
          return S.saldoEstoque(p.id, am) > 0;
        });
        for (let i = 0; i < fontes.length && !medio; i++) medio = S.custoMedio(p.id, fontes[i]);
      }
      return { p: p, saldo: naSala, hospital: un.saldo, medio: medio || 0 };
    })
      /* Mostra TODO material ativo, com ou sem saldo. Antes só
         aparecia o que tinha estoque — e com o estoque zerado a
         lista ficava vazia, dando a impressão de que o sistema não
         conhecia os materiais. Quem lança sabe o que usou; se o
         saldo não cobre, o sistema avisa na hora de gravar, que é
         onde o aviso serve. */
      .sort(function (a, b) {
        /* Com saldo primeiro: é o que a pessoa procura na maioria
           das vezes, e o resto fica abaixo sem sumir. */
        if ((a.hospital > 0) !== (b.hospital > 0)) return a.hospital > 0 ? -1 : 1;
        return a.p.descricao.localeCompare(b.p.descricao, 'pt-BR');
      });
  }

  function previa() {
    const pate = proced(form.procedimento);
    if (!pate) return null;
    /* A conta é a MESMA do lançamento, feita pelo store: o que a sala
       tem sai pelo custo dela, o que falta vem de outra sala pelo
       custo de lá. Calcular aqui com o custo médio da sala aplicado a
       tudo divergia do gravado quando os preços diferiam. */
    const material = form.armazem
      ? S.custoMaterialPrevisto(form.armazem, Object.keys(form.materiais).map(function (id) {
          return { produto: id, qtd: form.materiais[id] }; })).total
      : 0;
    const base = Object.assign({}, pate);
    if (form.repasse !== '' && form.repasse !== null) base.repasse = Number(form.repasse) || 0;
    if (base.repasse === null || base.repasse === undefined) base.repasse = 0;
    return S.calcularProcedimento(base, Math.round(material * 100) / 100, form.qtd);
  }

  /* Marca os materiais padrão do procedimento escolhido.

     Quando o padrão aponta um PRODUTO, já entra marcado com a
     quantidade. Quando aponta uma FAMÍLIA — o caso da lente, que
     varia por grau —, fica registrado como pendente: a tela pede o
     item específico, porque a tabela sabe que vai uma lente mas
     não sabe qual.

     O que a pessoa já tinha marcado à mão não é apagado: ela pode
     ter começado pelo material e escolhido o procedimento depois. */
  function aplicarPadroes(procedimento) {
    form.pendentes = [];
    if (!procedimento || !S.materiaisPadraoDe) return;
    S.materiaisPadraoDe(procedimento).forEach(function (m) {
      if (m.produto) {
        if (!form.materiais[m.produto]) form.materiais[m.produto] = m.qtd;
        return;
      }
      /* Família: a escolha do item fica para quem lança. */
      form.pendentes.push({ familia: m.familia, qtd: m.qtd,
        opcoes: m.opcoes, obrigatorio: m.obrigatorio, escolhido: '' });
    });
  }

  /* As linhas de família pendente, no alto da lista de materiais:
     é o que falta decidir, e o que não pode passar batido. */
  function blocoPendentes() {
    const pend = form.pendentes || [];
    if (!pend.length) return '';
    return '<div class="aviso" style="margin:10px 0">' +
      '<b>Este procedimento usa ' + pend.length + ' material(is) que variam.</b> ' +
      'Escolha qual foi usado:' +
      pend.map(function (p, ix) {
        const comSaldo = p.opcoes.filter(function (o) {
          return form.armazem ? S.saldoNaUnidade(o.id, form.armazem).saldo > 0 : true;
        });
        const lista = comSaldo.length ? comSaldo : p.opcoes;
        return '<div class="row2" style="margin-top:8px;align-items:end">' +
          '<div><label>' + U.esc(p.familia) + ' · ' + U.num(p.qtd) + ' un</label>' +
            '<select data-pend="' + ix + '">' +
              '<option value="">Escolher…</option>' +
              lista.map(function (o) {
                const saldo = form.armazem ? S.saldoNaUnidade(o.id, form.armazem).saldo : 0;
                return '<option value="' + o.id + '"' +
                  (p.escolhido === o.id ? ' selected' : '') + '>' +
                  U.esc(o.descricao) + (saldo ? ' (' + U.num(saldo) + ' em estoque)' : ' (sem saldo)') +
                  '</option>';
              }).join('') +
            '</select></div>' +
          '<div class="sub">' + (comSaldo.length < p.opcoes.length
            ? 'mostrando as ' + comSaldo.length + ' com saldo'
            : '') + '</div>' +
        '</div>';
      }).join('') +
      '</div>';
  }

  /* ── Materiais padrão por cirurgia ────────────────────────
     Toda facoemulsificação usa uma lente; toda colecistectomia usa
     clipes. Definir isso uma vez evita que quem lança precise
     lembrar a cada cirurgia — e material esquecido não some do
     custo: aparece no inventário seguinte como diferença sem
     explicação. */
  let padraoProc = '';

  function telaPadroes() {
    const procs = (D.tabelaPate || []).slice().sort(function (a, b) {
      return (a.area + a.nome).localeCompare(b.area + b.nome, 'pt-BR');
    });
    if (!padraoProc && procs.length) padraoProc = procs[0].id;
    const atual = procs.find(function (p) { return p.id === padraoProc; });
    const lista = padraoProc ? S.materiaisPadraoDe(padraoProc) : [];

    /* As famílias que existem no cadastro: é o que permite dizer
       "uma lente" sem dizer qual grau. */
    const familias = [];
    D.produtos.forEach(function (p) {
      if (p.familia && familias.indexOf(p.familia) < 0) familias.push(p.familia);
    });
    familias.sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });

    return '<div class="filtros">' +
        '<div class="f" style="flex:1"><label for="mp-proc">Cirurgia</label>' +
          '<select id="mp-proc">' +
            procs.map(function (p) {
              const n = S.materiaisPadraoDe(p.id).length;
              return '<option value="' + p.id + '"' + (p.id === padraoProc ? ' selected' : '') + '>' +
                U.esc(p.area + ' · ' + p.nome) + (n ? ' (' + n + ')' : '') + '</option>';
            }).join('') +
          '</select></div>' +
      '</div>' +
      (!atual ? '<div class="card"><div class="ajuda">Nenhuma cirurgia na tabela.</div></div>' :
      '<div class="card">' +
        '<h2 style="font-size:13px;margin:0 0 4px">' + U.esc(atual.nome) + '</h2>' +
        '<div class="sub" style="margin-bottom:10px">' + U.esc(atual.area) + ' · ' +
          U.esc(atual.codigo || '') + '</div>' +
        (lista.length
          ? '<table class="rel"><thead><tr><th>Material</th><th class="num">Qtd</th>' +
            '<th>Como funciona</th><th></th></tr></thead><tbody>' +
            lista.map(function (m) {
              return '<tr><td>' +
                (m.familia
                  ? '<b>' + U.esc(m.familia) + '</b> <span class="badge b-aberto">família</span>'
                  : U.esc((D.produtos.find(function (x) { return x.id === m.produto; }) || {}).descricao || m.produto)) +
                '</td>' +
                '<td class="num">' + U.num(m.qtd) + '</td>' +
                '<td class="sub">' + (m.familia
                  ? 'quem lança escolhe entre ' + m.opcoes.length + ' opção(ões)'
                  : 'entra marcado automaticamente') + '</td>' +
                '<td><button class="btn-sm" data-mp-rem="' + m.id + '">Remover</button></td></tr>';
            }).join('') + '</tbody></table>'
          : '<div class="ajuda">Nenhum material padrão nesta cirurgia ainda.</div>') +
        '<div class="ap-acoes" style="margin-top:12px">' +
          '<button class="btn-linha" id="mp-add-prod">+ material específico</button>' +
          (familias.length
            ? '<button class="btn-linha" id="mp-add-fam">+ família (quem lança escolhe)</button>'
            : '') +
        '</div>' +
        '<div class="ajuda">Use <b>material específico</b> quando é sempre o mesmo item. Use ' +
        '<b>família</b> quando varia — a lente intraocular é a mesma cirurgia com graus ' +
        'diferentes, e a tabela não tem como saber qual foi usado.' +
        (familias.length ? '' : ' Nenhuma família cadastrada ainda: defina em Estoque › Famílias.') +
        '</div>' +
      '</div>');
  }

  function ligarPadroes() {
    const sel = U.el('mp-proc');
    if (sel) sel.addEventListener('change', function () { padraoProc = this.value; render(); });

    document.querySelectorAll('[data-mp-rem]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = this.dataset.mpRem;
        S.st.materiaisPadrao = (S.st.materiaisPadrao || []).filter(function (m) {
          return String(m.id) !== String(id);
        });
        render();
      });
    });

    const add = U.el('mp-add-prod');
    if (add) add.addEventListener('click', function () { modalPadrao(false); });
    const addF = U.el('mp-add-fam');
    if (addF) addF.addEventListener('click', function () { modalPadrao(true); });
  }

  function modalPadrao(porFamilia) {
    const familias = [];
    D.produtos.forEach(function (p) {
      if (p.familia && familias.indexOf(p.familia) < 0) familias.push(p.familia);
    });
    familias.sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });

    ERP.app.modal({
      titulo: porFamilia ? 'Família de material' : 'Material específico',
      fecharTxt: 'Cancelar',
      corpo:
        (porFamilia
          ? '<label for="mpn-fam">Família</label><select id="mpn-fam">' +
            familias.map(function (f) {
              const n = D.produtos.filter(function (p) { return p.familia === f && p.ativo; }).length;
              return '<option value="' + U.esc(f) + '">' + U.esc(f) + ' (' + n + ' variações)</option>';
            }).join('') + '</select>'
          : '<label for="mpn-prod">Material</label>' +
            '<input list="mpn-lista" id="mpn-prod" placeholder="digite parte do nome">' +
            '<datalist id="mpn-lista">' +
              D.produtos.filter(function (p) { return p.ativo; })
                .sort(function (a, b) { return (a.descricao || '').localeCompare(b.descricao || '', 'pt-BR'); })
                .map(function (p) {
                  return '<option value="' + U.esc(p.codigo + ' · ' + p.descricao) + '">';
                }).join('') +
            '</datalist>') +
        '<label for="mpn-qtd" style="margin-top:10px">Quantidade</label>' +
        '<input class="num" id="mpn-qtd" inputmode="decimal" value="1,00">' +
        '<div class="ajuda">' + (porFamilia
          ? 'Quem lançar a cirurgia escolhe qual variação foi usada — o grau da lente, por exemplo.'
          : 'Entra marcado automaticamente ao escolher esta cirurgia, e pode ser ajustado.') +
        '</div><div id="mpn-erro"></div>',
      acoes: [{ txt: 'Adicionar', cls: 'btn-aprovar', fn: function () {
        const erro = U.el('mpn-erro');
        const qtd = U.parseValor(U.val('mpn-qtd')) || 1;
        let dados = { procedimento: padraoProc, qtd: qtd };
        if (porFamilia) {
          dados.familia = U.val('mpn-fam');
        } else {
          const txt = U.val('mpn-prod').trim().toLowerCase();
          const p = D.produtos.find(function (x) {
            return (x.codigo + ' · ' + x.descricao).toLowerCase() === txt ||
              (x.descricao || '').toLowerCase() === txt;
          });
          if (!p) {
            if (erro) erro.innerHTML = '<div class="login-erro">Escolha um material da lista.</div>';
            return;
          }
          dados.produto = p.id;
        }
        const r = S.salvarMaterialPadrao(dados);
        if (r.erro) {
          if (erro) erro.innerHTML = '<div class="login-erro">' + U.esc(r.erro) + '</div>';
          return;
        }
        ERP.app.fecharModal();
        render();
      } }]
    });
  }

  function telaLancar() {
    const pate = proced(form.procedimento);
    const mats = form.armazem ? materiaisDo(form.armazem) : [];
    const r = previa();
    /* Campo de repasse avulso: só para o caso de combinar pagamento
       por procedimento com um médico específico, fora do plantão. */
    const semRepasse = porPlantao(pate);

    return '<div class="filtros" style="align-items:flex-end">' +
        '<div class="f"><label for="pc-data">Data</label>' +
          '<input type="date" id="pc-data" value="' + form.data + '"></div>' +
        '<div class="f"><label for="pc-esp">Especialidade</label><select id="pc-esp">' +
          '<option value="">escolha…</option>' +
          D.ESPECIALIDADES_PATE.map(function (e) {
            return '<option value="' + U.esc(e) + '"' + (form.especialidade === e ? ' selected' : '') +
              '>' + U.esc(e) + '</option>'; }).join('') + '</select></div>' +
        '<div class="f" style="min-width:320px"><label for="pc-proc">Procedimento</label>' +
          '<select id="pc-proc"' + (form.especialidade ? '' : ' disabled') + '>' +
          '<option value="">' + (form.especialidade ? 'escolha…' : 'escolha a especialidade') + '</option>' +
          procedimentosDa(form.especialidade).map(function (p) {
            return '<option value="' + p.id + '"' + (form.procedimento === p.id ? ' selected' : '') + '>' +
              U.esc(p.nome) + (p.tipo === 'diaria' ? ' (diária)' : '') + '</option>'; }).join('') +
          '</select></div>' +
        /* O setor vem da especialidade e não se escolhe: cada sala
           guarda o material dela, e deixar isso aberto só criaria a
           chance de baixar lente intraocular do estoque da gineco. */
        '<div class="f"><label for="pc-arm">Setor</label>' +
          '<input id="pc-arm" value="' + U.esc(form.armazem ? nomeArm(form.armazem)
            : 'escolha a especialidade') + '" disabled title="definido pela especialidade"></div>' +
      '</div>' +
      '<div class="filtros" style="align-items:flex-end">' +
        '<div class="f" style="min-width:240px"><label for="pc-medico">Médico</label>' +
          '<input id="pc-medico" list="pc-medicos" placeholder="nome do médico" value="' +
            U.esc(form.medico) + '"></div>' +
        '<datalist id="pc-medicos">' + medicosJaUsados().map(function (m) {
          return '<option value="' + U.esc(m) + '">'; }).join('') + '</datalist>' +
        '<div class="f" style="min-width:240px"><label for="pc-paciente">Paciente</label>' +
          '<input id="pc-paciente" placeholder="' +
            (pate && pate.tipo === 'diaria' ? 'não se aplica à diária' : 'nome do paciente') +
            '" value="' + U.esc(form.paciente) + '"' +
            (pate && pate.tipo === 'diaria' ? ' disabled' : '') + '></div>' +
        '<div class="f" style="max-width:90px"><label for="pc-qtd">Qtd</label>' +
          '<input type="number" id="pc-qtd" min="1" step="1" value="' + form.qtd + '"></div>' +
        (semRepasse && veValor()
          ? '<div class="f" style="max-width:190px"><label for="pc-repasse">Repasse avulso (R$)</label>' +
            '<input type="number" id="pc-repasse" step="0.01" placeholder="em branco = plantão" value="' +
            U.esc(form.repasse) + '"></div>'
          : '') +
      '</div>' +
      (pate ? fichaProcedimento(pate) : '') +
      '<h3 style="font-size:12px;margin:14px 0 4px">Material usado' +
        (form.armazem ? ' — ' + U.esc(nomeArm(form.armazem)) : '') + '</h3>' +
      blocoPendentes() +
      (!form.armazem
        ? '<div class="vazio"><strong>Escolha a especialidade.</strong> O material que aparece é o ' +
          'da sala daquela cirurgia.</div>'
        : mats.length
        ? '<div class="tabela-rolagem"><table><thead><tr><th>Material</th>' +
          '<th class="num" style="width:110px">No setor</th>' +
          '<th class="num" style="width:120px">No hospital</th>' +
          (veValor() ? '<th class="num" style="width:110px">Custo unit.</th>' : '') +
          '<th class="num" style="width:110px">Usado</th>' +
          (veValor() ? '<th class="num" style="width:110px">Custo</th>' : '') + '</tr></thead><tbody>' +
          mats.map(function (x) {
            const q = form.materiais[x.p.id] || 0;
            const puxa = q > x.saldo;
            return '<tr' + (q > 0 ? ' class="destaque"' : '') + '>' +
              '<td class="desc">' + U.esc(x.p.descricao) + ' <span class="sub">' +
                U.esc(x.p.unidade) + '</span></td>' +
              '<td class="num' + (x.saldo ? ' sub' : ' erro') + '">' + U.num(x.saldo) + '</td>' +
              '<td class="num sub">' + U.num(x.hospital) + '</td>' +
              (veValor() ? '<td class="num sub">' + U.brl(x.medio) + '</td>' : '') +
              '<td class="num"><input type="number" class="pc-mat" data-prod="' + x.p.id +
                '" min="0" max="' + x.hospital + '" step="1" style="width:90px;text-align:right" value="' +
                (q || '') + '" placeholder="0"' +
                (puxa ? ' title="vem de outro estoque do hospital"' : '') + '></td>' +
              (veValor() ? '<td class="num" id="pc-custo-' + x.p.id + '">' +
                (q > 0 ? U.brl(Math.round(q * x.medio * 100) / 100) : '—') + '</td>' : '') + '</tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="ajuda" id="pc-aviso-hosp"' +
            (mats.some(function (x) { return (form.materiais[x.p.id] || 0) > x.saldo; })
              ? '' : ' style="display:none"') + '>Algum material passa do saldo da sala e vem de ' +
            'outro estoque do hospital — a transferência fica registrada junto com a baixa.</div>'
        : '<div class="vazio"><strong>Sem saldo em ' + U.esc(nomeArm(form.armazem)) + '.</strong> ' +
          'Dê entrada do material no módulo de estoque antes de lançar.</div>') +
      '<div class="filtros" style="margin-top:12px">' +
        '<div class="f" style="flex:1"><label for="pc-obs">Observação</label>' +
          '<input id="pc-obs" value="' + U.esc(form.observacao) + '" placeholder="opcional"></div>' +
      '</div>' +
      '<div id="pc-previa">' + (r && veValor() ? resumoPrevia(r, pate) : '') + '</div>' +
      '<div class="acoes-rodape" style="margin-top:10px">' +
        '<button class="btn-sm" id="pc-limpar">Limpar</button>' +
        '<button class="btn-aprovar" id="pc-gravar">Lançar procedimento</button>' +
      '</div>';
  }

  const porPlantao = p => p && p.tipo === 'cirurgia' && !(p.repasse > 0);

  function fichaProcedimento(p) {
    if (!veValor()) {
      return '<div class="pr-confere">' +
        '<span>Especialidade <b>' + U.esc(p.area) + '</b></span>' +
        (p.codigo ? '<span class="sub mono">' + U.esc(p.codigo) + '</span>' : '') +
        (p.tipo === 'diaria' ? '<span class="sub">diária</span>' : '') + '</div>';
    }
    return '<div class="pr-confere">' +
      '<span>SIGTAP <b>' + U.brl(p.sigtap) + '</b></span>' +
      '<span>Múltiplo <b>' + p.multiplo + '×</b></span>' +
      '<span>Total <b>' + U.brl(p.total) + '</b></span>' +
      '<span>Faturamento 95% <b>' + U.brl(p.faturamento) + '</b></span>' +
      '<span>Médico <b>' + (porPlantao(p)
        ? 'plantão fixo (PegaPlantão)'
        : U.brl(p.repasse) + ' por procedimento') + '</b></span>' +
      (p.codigo ? '<span class="sub mono">' + U.esc(p.codigo) + '</span>' : '') +
      '</div>' +
      (porPlantao(p) && veValor()
        ? '<div class="ajuda">Este procedimento não tem repasse por cirurgia: o médico recebe ' +
          'plantão fixo de ' + U.brl(S.plantaoValor()) + ' por ' + U.num(S.plantaoHoras()) + ' horas, ' +
          'que vem do PegaPlantão. O sistema estima um plantão por médico e por dia, e rateia esse ' +
          'custo entre os procedimentos do dia — ajuste na aba Plantões quando o turno for maior.</div>'
        : '');
  }

  function resumoPrevia(r, pate) {
    const plantao = porPlantao(pate) && !form.repasse;
    return '<div class="pr-confere" style="margin-top:10px">' +
      '<span>Faturamento <b>' + U.brl(r.faturamento) + '</b></span>' +
      '<span>' + (plantao ? 'Médico <b>por plantão</b>' : 'Repasse <b>' + U.brl(r.repasse) + '</b>') + '</span>' +
      '<span>Material <b>' + U.brl(r.material) + '</b></span>' +
      '<span>Imposto estimado (' + U.num(S.impostoProcedimentos()) + '%) <b>' + U.brl(r.imposto) + '</b></span>' +
      '<span>Custo <b>' + U.brl(r.custo) + '</b></span>' +
      '<span>Resultado <b class="' + (r.resultado < 0 ? 'erro' : '') + '">' + U.brl(r.resultado) + '</b>' +
        (r.margem === null ? '' : ' <span class="sub">' + r.margem + '%</span>') + '</span>' +
      '</div>' +
      (pate && pate.tipo === 'diaria'
        ? '<div class="ajuda">Diária: não fatura por procedimento, entra só como custo do repasse.</div>'
        : plantao
          ? '<div class="ajuda">O resultado acima ainda não desconta o plantão — ele é rateado entre ' +
            'os procedimentos do dia e aparece já descontado na lista e nos relatórios.</div>'
          : '');
  }

  const medicosJaUsados = () => [...new Set(S.listarProcedimentos({}).map(function (p) {
    return p.medico; }))].sort();

  function ligarLancar() {
    const liga = (id, campo, ev) => {
      const e = U.el(id);
      if (e) e.addEventListener(ev || 'change', function () { form[campo] = this.value; render(); });
    };
    liga('pc-data', 'data');
    const esp = U.el('pc-esp');
    if (esp) esp.addEventListener('change', function () {
      form.especialidade = this.value;
      form.procedimento = '';
      /* A sala segue a especialidade, e o material marcado morre
         junto: o saldo era de outro armazém. */
      form.armazem = D.armazemDaEspecialidade(this.value, D.PATE_CENTRO) || '';
      form.materiais = {};
      render();
    });
    /* Escolher o procedimento já traz os MATERIAIS PADRÃO marcados.
       Toda faco usa uma lente; fazer quem lança lembrar disso a
       cada cirurgia é pedir esquecimento — e material esquecido
       vira diferença sem explicação no inventário seguinte. */
    /* Escolher o grau da família move o item para a lista de usados:
       a partir daí ele é material como outro qualquer. */
    document.querySelectorAll('[data-pend]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        const p = (form.pendentes || [])[+this.dataset.pend];
        if (!p) return;
        /* Troca de escolha: o anterior sai, senão os dois ficariam
           marcados e a cirurgia consumiria duas lentes. */
        if (p.escolhido) delete form.materiais[p.escolhido];
        p.escolhido = this.value;
        if (this.value) form.materiais[this.value] = p.qtd;
        render();
      });
    });

    const sp = U.el('pc-proc');
    if (sp) {
      sp.addEventListener('change', function () {
        form.procedimento = this.value;
        aplicarPadroes(this.value);
        render();
      });
    }
    liga('pc-repasse', 'repasse');
    /* Texto não redesenha a tela a cada tecla: guarda e segue. */
    ['pc-medico', 'pc-paciente', 'pc-obs'].forEach(function (id) {
      const e = U.el(id);
      if (!e) return;
      const campo = id === 'pc-medico' ? 'medico' : id === 'pc-paciente' ? 'paciente' : 'observacao';
      e.addEventListener('input', function () { form[campo] = this.value; });
    });
    const q = U.el('pc-qtd');
    if (q) q.addEventListener('change', function () {
      form.qtd = Math.max(1, Math.round(Number(this.value) || 1)); render();
    });
    /* Digitar a quantidade NÃO redesenha a tela. Antes, cada `change`
       chamava render(), o DOM inteiro era refeito e o TAB levava o foco
       de volta ao começo da página — lançar dez insumos virava dez
       voltas ao topo. Agora só a célula de custo e a prévia mudam, e o
       TAB segue para o próximo material como o operador espera. */
    document.querySelectorAll('.pc-mat').forEach(function (i) {
      i.addEventListener('change', function () {
        const prod = this.dataset.prod;
        const v = Math.max(0, Number(this.value) || 0);
        if (v > 0) form.materiais[prod] = v;
        else delete form.materiais[prod];
        atualizarLinhaMaterial(prod, v, this);
      });
    });
    const limpar = U.el('pc-limpar');
    if (limpar) limpar.addEventListener('click', function () { form = novoForm(); render(); });
    const gravar = U.el('pc-gravar');
    if (gravar) gravar.addEventListener('click', lancar);
  }

  /* Atualiza o que depende da quantidade sem refazer a tabela:
     a célula de custo da linha, o destaque e o resumo do resultado. */
  function atualizarLinhaMaterial(prod, qtd, campo) {
    const mats = form.armazem ? materiaisDo(form.armazem) : [];
    const x = mats.find(function (m) { return m.p.id === prod; });
    const linha = campo ? campo.closest('tr') : null;
    if (linha) linha.classList.toggle('destaque', qtd > 0);

    if (veValor() && x) {
      const td = U.el('pc-custo-' + prod);
      if (td) td.textContent = qtd > 0 ? U.brl(Math.round(qtd * x.medio * 100) / 100) : '—';
    }
    /* Passou do saldo da sala: marca a linha, porque o material vai ser
       puxado de outro estoque do hospital. */
    if (linha && x) linha.classList.toggle('puxa-hospital', qtd > x.saldo);

    const aviso = U.el('pc-aviso-hosp');
    if (aviso) {
      aviso.style.display = mats.some(function (m) {
        return (form.materiais[m.p.id] || 0) > m.saldo; }) ? '' : 'none';
    }

    const box = U.el('pc-previa');
    if (box) {
      const pate = proced(form.procedimento);
      const r = previa();
      box.innerHTML = (r && veValor()) ? resumoPrevia(r, pate) : '';
    }
  }

  function lancar(confirmado) {
    const d = {
      data: form.data, procedimento: form.procedimento, medico: form.medico,
      paciente: form.paciente, armazem: form.armazem, qtd: form.qtd,
      observacao: form.observacao,
      repasse: form.repasse === '' ? undefined : form.repasse,
      materiais: Object.keys(form.materiais).map(function (id) {
        return { produto: id, qtd: form.materiais[id] }; }),
      confirmar_sem_repasse: confirmado === true
    };
    const r = S.lancarProcedimento(d);
    if (r.erro && r.sem_repasse && !confirmado) {
      return ERP.app.modal({
        titulo: 'Repasse não está na tabela', fecharTxt: 'Voltar e informar',
        corpo: '<div class="aviso-linha erro">' + U.esc(r.erro) + '</div>',
        acoes: [{ txt: 'Lançar sem repasse', cls: 'btn-sm', fn: function () {
          ERP.app.fecharModal(); lancar(true);
        } }]
      });
    }
    if (r.erro) return ERP.app.aviso(r.erro, 'erro');
    const p = r.procedimento;
    const medico = form.medico, esp = form.especialidade, arm = form.armazem;
    form = novoForm();
    /* O operador lança vários seguidos: mantém médico, setor e
       especialidade, que mudam pouco dentro do mesmo mapa cirúrgico. */
    form.medico = medico; form.especialidade = esp; form.armazem = arm;
    render();
    ERP.app.aviso((veValor()
      ? 'Procedimento lançado. Resultado ' + U.brl(p.resultado) +
        (p.custo_material ? ' · material ' + U.brl(p.custo_material) + ' baixado do estoque' : '')
      : 'Procedimento lançado' + (p.materiais.length
        ? ' · ' + p.materiais.length + ' material(is) baixado(s) do estoque' : '')) + '.' +
      (r.aviso ? ' ' + r.aviso : ''), 'ok');
  }

  /* ── aba 2: lançamentos ────────────────────────────────*/
  function telaLista() {
    const linhas = S.procedimentosComPlantao(filtro);
    const soma = linhas.reduce(function (t, p) {
      t.fat += p.faturamento; t.custo += p.custo_total; t.res += p.resultado_final;
      t.plantao += p.custo_plantao; return t;
    }, { fat: 0, custo: 0, res: 0, plantao: 0 });

    const $ = veValor();
    return '<div class="filtros">' +
        '<div class="f"><label for="pl-comp">Competência</label>' +
          '<input type="month" id="pl-comp" value="' + (filtro.competencia || '') + '"></div>' +
        /* Dia, além da competência: o mapa cirúrgico é conferido por
           dia, não por mês. */
        '<div class="f"><label for="pl-de">De</label>' +
          '<input type="date" id="pl-de" value="' + (filtro.de || '') + '"></div>' +
        '<div class="f"><label for="pl-ate">Até</label>' +
          '<input type="date" id="pl-ate" value="' + (filtro.ate || '') + '"></div>' +
        '<button class="btn-sm" id="pl-hoje">Hoje</button>' +
        '<div class="f"><label for="pl-esp">Especialidade</label><select id="pl-esp">' +
          '<option value="">todas</option>' + D.ESPECIALIDADES_PATE.map(function (e) {
            return '<option value="' + U.esc(e) + '"' + (filtro.especialidade === e ? ' selected' : '') +
              '>' + U.esc(e) + '</option>'; }).join('') + '</select></div>' +
        '<div class="f"><label for="pl-arm">Setor</label><select id="pl-arm">' +
          '<option value="">todos os setores</option>' + D.PATE_ARMAZENS.map(function (a) {
            return '<option value="' + a + '"' + (filtro.armazem === a ? ' selected' : '') + '>' +
              U.esc(nomeArm(a)) + '</option>'; }).join('') + '</select></div>' +
        '<div class="f" style="flex:1"><label for="pl-busca">Busca</label>' +
          '<input id="pl-busca" placeholder="médico, paciente ou procedimento" value="' +
            U.esc(filtro.busca || '') + '"></div>' +
        '<button class="btn-sm" id="pl-exportar">Exportar</button>' +
        ($ ? '<button class="btn-linha" id="pl-financeiro">Gerar no financeiro</button>' : '') +
      '</div>' +
      '<div class="pr-confere">' +
        '<span>' + linhas.length + ' lançamento(s)</span>' +
        ($ ? '<span>Faturamento <b>' + U.brl(soma.fat) + '</b></span>' +
          (soma.plantao ? '<span>Plantão <b>' + U.brl(soma.plantao) + '</b></span>' : '') +
          '<span>Custo <b>' + U.brl(soma.custo) + '</b></span>' +
          '<span>Resultado <b class="' + (soma.res < 0 ? 'erro' : '') + '">' + U.brl(soma.res) +
          '</b></span>'
        : '<span>' + new Set(linhas.map(function (p) { return p.medico; })).size + ' médico(s)</span>' +
          '<span>' + new Set(linhas.map(function (p) { return p.especialidade; })).size +
          ' especialidade(s)</span>') +
      '</div>' +
      '<div class="tabela-rolagem"><table><thead><tr>' +
        '<th>Data</th><th>Especialidade</th><th>Procedimento</th><th>Médico</th><th>Paciente</th>' +
        '<th>Setor</th>' +
        ($ ? '<th class="num">Faturamento</th><th class="num">Médico</th>' +
             '<th class="num">Material</th><th class="num">Imposto</th><th class="num">Resultado</th>'
           : '<th class="num">Materiais</th>') +
        '<th></th></tr></thead><tbody>' +
        (linhas.length ? linhas.map(function (p) {
          return '<tr' + (p.cancelado ? ' class="cancelada"' : '') + '>' +
            '<td class="mono">' + U.fData(p.data) + '</td>' +
            '<td class="sub">' + U.esc(p.especialidade) + '</td>' +
            '<td class="desc" title="' + U.esc(p.procedimento_nome) + '">' +
              U.esc(p.procedimento_nome.slice(0, 34)) + (p.procedimento_nome.length > 34 ? '…' : '') +
              (p.qtd > 1 ? ' <span class="sub">' + p.qtd + '×</span>' : '') + '</td>' +
            '<td>' + U.esc(p.medico) + '</td>' +
            '<td class="sub">' + U.esc(p.paciente || '—') + '</td>' +
            '<td class="sub">' + U.esc((p.setor || '').replace('HGB · ', '')) + '</td>' +
            ($ ? '<td class="num">' + U.brl(p.faturamento) + '</td>' : '') +
            /* Custo do médico: repasse da tabela ou a parte do plantão
               daquele dia que cabe nesta cirurgia. */
            ($ ? '<td class="num">' + (p.pago_por_plantao
                  ? U.brl(p.custo_plantao) + ' <span class="sub" title="parte do plantão do dia">pl</span>'
                  : U.brl(p.repasse)) + '</td>' +
                 '<td class="num">' + U.brl(p.custo_material) + '</td>' +
                 '<td class="num sub">' + U.brl(p.imposto) + '</td>' +
                 '<td class="num ' + (p.resultado_final < 0 ? 'erro' : '') + '">' +
                   U.brl(p.resultado_final) + '</td>'
               : '<td class="num sub" title="' + U.esc(p.materiais.map(function (m) {
                   return U.num(m.qtd) + ' ' + m.descricao; }).join(', ')) + '">' +
                 (p.materiais.length || '—') + '</td>') +
            '<td>' + (p.cancelado
              ? '<span class="badge b-cancelado">' +
                /* `edicao` é campo próprio agora: `cancelado` é só
                   sim ou não, para a coluna booleana do banco
                   aceitar. */
                (p.edicao ? 'editado' : 'cancelado') + '</span>'
              : (p.financeiro
                ? '<span class="badge b-pago" title="' + U.esc(p.financeiro) + '">no financeiro</span>'
                : (podeLancar()
                  ? '<button class="btn-sm" data-editar="' + p.id + '">Editar</button> ' +
                    '<button class="btn-sm" data-cancelar="' + p.id + '">Cancelar</button>'
                  : ''))) +
            '</td></tr>';
        }).join('')
        : '<tr><td colspan="' + ($ ? 12 : 9) + '" class="vazio"><strong>Nenhum procedimento ' +
          'lançado.</strong></td></tr>') +
      '</tbody></table></div>';
  }

  function ligarLista() {
    const liga = (id, campo) => {
      const e = U.el(id);
      if (e) e.addEventListener('change', function () {
        filtro[campo] = this.value || undefined; render();
      });
    };
    liga('pl-comp', 'competencia'); liga('pl-esp', 'especialidade'); liga('pl-arm', 'armazem');
    liga('pl-de', 'de'); liga('pl-ate', 'ate');
    const hoje = U.el('pl-hoje');
    if (hoje) hoje.addEventListener('click', function () {
      filtro.de = U.hoje(); filtro.ate = U.hoje(); filtro.competencia = undefined; render();
    });
    const b = U.el('pl-busca');
    if (b) b.addEventListener('change', function () { filtro.busca = this.value || undefined; render(); });
    document.querySelectorAll('[data-cancelar]').forEach(function (btn) {
      btn.addEventListener('click', function () { abrirCancelar(this.dataset.cancelar); });
    });
    document.querySelectorAll('[data-editar]').forEach(function (btn) {
      btn.addEventListener('click', function () { abrirEditar(this.dataset.editar); });
    });
    const exp = U.el('pl-exportar');
    if (exp) exp.addEventListener('click', exportar);
    const fin = U.el('pl-financeiro');
    if (fin) fin.addEventListener('click', abrirFinanceiro);
  }

  /* Editar um lançamento. Corrigir médico, paciente, data ou material
     é rotina do centro cirúrgico — cancelar e relançar perderia o
     histórico e daria trabalho à toa. */
  function abrirEditar(id) {
    const p = S.listarProcedimentos({ cancelados: true }).find(function (x) { return x.id === id; });
    if (!p) return ERP.app.aviso('Procedimento não encontrado.', 'erro');
    const mats = materiaisDo(p.armazem);
    const usados = {};
    (p.materiais || []).forEach(function (m) { usados[m.produto] = m.qtd; });

    ERP.app.modal({
      titulo: 'Editar procedimento', fecharTxt: 'Voltar', largo: true,
      corpo: '<div class="filtros">' +
          '<div class="f"><label for="ed-data">Data</label>' +
            '<input type="date" id="ed-data" value="' + p.data + '"></div>' +
          '<div class="f" style="min-width:220px"><label for="ed-medico">Médico</label>' +
            '<input id="ed-medico" value="' + U.esc(p.medico) + '"></div>' +
          '<div class="f" style="min-width:220px"><label for="ed-paciente">Paciente</label>' +
            '<input id="ed-paciente" value="' + U.esc(p.paciente || '') + '"' +
            (p.tipo === 'diaria' ? ' disabled' : '') + '></div>' +
          '<div class="f" style="max-width:90px"><label for="ed-qtd">Qtd</label>' +
            '<input type="number" id="ed-qtd" min="1" step="1" value="' + (p.qtd || 1) + '"></div>' +
        '</div>' +
        '<p class="ajuda">' + U.esc(p.procedimento_nome) + ' · ' + U.esc(p.setor) + '. ' +
          'O material é refeito: o que foi baixado volta ao estoque e sai de novo pelo que ' +
          'ficar abaixo.</p>' +
        '<div class="tabela-rolagem" style="max-height:320px"><table><thead><tr><th>Material</th>' +
          '<th class="num">No setor</th><th class="num">No hospital</th>' +
          '<th class="num" style="width:110px">Usado</th></tr></thead><tbody>' +
          mats.map(function (x) {
            const q = usados[x.p.id] || 0;
            return '<tr' + (q > 0 ? ' class="destaque"' : '') + '>' +
              '<td class="desc">' + U.esc(x.p.descricao) + '</td>' +
              '<td class="num sub">' + U.num(x.saldo + (usados[x.p.id] || 0)) + '</td>' +
              '<td class="num sub">' + U.num(x.hospital + (usados[x.p.id] || 0)) + '</td>' +
              '<td class="num"><input type="number" class="ed-mat" data-prod="' + x.p.id +
                '" min="0" step="1" style="width:90px;text-align:right" value="' +
                (q || '') + '" placeholder="0"></td></tr>';
          }).join('') + '</tbody></table></div>',
      acoes: [{ txt: 'Salvar alterações', cls: 'btn-aprovar', fn: function () {
        const materiais = [];
        document.querySelectorAll('.ed-mat').forEach(function (e) {
          const v = Number(e.value) || 0;
          if (v > 0) materiais.push({ produto: e.dataset.prod, qtd: v });
        });
        const r = S.editarProcedimento(id, {
          data: U.val('ed-data'), medico: U.val('ed-medico'), paciente: U.val('ed-paciente'),
          qtd: Number(U.val('ed-qtd')) || 1, materiais: materiais
        });
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal(); render();
        ERP.app.aviso('Procedimento atualizado.', 'ok');
      } }]
    });
  }

  function abrirCancelar(id) {
    ERP.app.modal({
      titulo: 'Cancelar procedimento', fecharTxt: 'Voltar',
      corpo: '<div class="f"><label for="pc-motivo">Motivo</label>' +
        '<input id="pc-motivo" placeholder="por que está cancelando"></div>' +
        '<div class="ajuda">O material já saiu do estoque. Se voltou para a prateleira, ' +
        'lance a devolução no módulo de estoque — cancelar aqui não devolve sozinho.</div>',
      acoes: [{ txt: 'Cancelar procedimento', cls: 'btn-reprovar', fn: function () {
        const r = S.cancelarProcedimento(id, U.val('pc-motivo'));
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal(); render();
        ERP.app.aviso('Procedimento cancelado.' + (r.aviso ? ' ' + r.aviso : ''), 'ok');
      } }]
    });
  }

  function abrirFinanceiro() {
    const comp = filtro.competencia || U.mesAtual();
    const pend = S.listarProcedimentos({ competencia: comp })
      .filter(function (p) { return !p.financeiro; });
    const fat = pend.reduce(function (s, p) { return s + p.faturamento; }, 0);
    const porMedico = {};
    pend.forEach(function (p) {
      if (p.repasse) porMedico[p.medico] = (porMedico[p.medico] || 0) + p.repasse;
    });
    ERP.app.modal({
      titulo: 'Gerar no financeiro — ' + comp, fecharTxt: 'Fechar',
      corpo: (pend.length
        ? '<p class="ajuda">Gera uma receita com o faturamento da competência e um título por ' +
          'médico com o repasse. O material não entra: já virou custo na baixa do estoque, e ' +
          'lançar de novo contaria em dobro.</p>' +
          '<div class="pr-confere"><span>' + pend.length + ' procedimento(s)</span>' +
          '<span>Faturamento <b>' + U.brl(fat) + '</b></span>' +
          '<span>Repasses <b>' + Object.keys(porMedico).length + '</b></span></div>' +
          (Object.keys(porMedico).length
            ? '<table><thead><tr><th>Médico</th><th class="num">Repasse</th></tr></thead><tbody>' +
              Object.keys(porMedico).sort().map(function (m) {
                return '<tr><td>' + U.esc(m) + '</td><td class="num">' +
                  U.brl(Math.round(porMedico[m] * 100) / 100) + '</td></tr>'; }).join('') +
              '</tbody></table>'
            : '')
        : '<div class="vazio"><strong>Nada pendente nesta competência.</strong></div>'),
      acoes: pend.length ? [{ txt: 'Gerar', cls: 'btn-aprovar', fn: function () {
        const r = S.gerarFinanceiroProcedimentos(comp);
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal(); render();
        ERP.app.aviso('Gerado: ' + r.procedimentos + ' procedimento(s), faturamento ' +
          U.brl(r.faturamento) + ', ' + r.criados.titulos.length + ' repasse(s).' +
          (r.aviso ? ' ' + r.aviso : ''), r.criados.falhas ? 'erro' : 'ok');
      } }] : []
    });
  }

  const COLS = [
    { titulo: 'Data', largura: 12, tipo: 'data', valor: p => U.fData(p.data) },
    { titulo: 'Competência', largura: 12, valor: p => p.competencia },
    { titulo: 'Especialidade', largura: 16, valor: p => p.especialidade },
    { titulo: 'Procedimento', largura: 48, valor: p => p.procedimento_nome },
    { titulo: 'Código', largura: 16, valor: p => p.codigo || '' },
    { titulo: 'Médico', largura: 28, valor: p => p.medico },
    { titulo: 'Paciente', largura: 28, valor: p => p.paciente || '' },
    { titulo: 'Setor', largura: 22, valor: p => p.setor },
    { titulo: 'Qtd', largura: 7, tipo: 'numero', valor: p => p.qtd },
    { titulo: 'Faturamento', largura: 14, tipo: 'numero', valor: p => p.faturamento },
    { titulo: 'Repasse médico', largura: 14, tipo: 'numero', valor: p => p.repasse },
    { titulo: 'Plantão rateado', largura: 14, tipo: 'numero', valor: p => p.custo_plantao || 0 },
    { titulo: 'Material', largura: 12, tipo: 'numero', valor: p => p.custo_material },
    { titulo: 'Imposto estimado', largura: 15, tipo: 'numero', valor: p => p.imposto },
    { titulo: 'Custo total', largura: 13, tipo: 'numero',
      valor: p => p.custo_total !== undefined ? p.custo_total : p.custo },
    { titulo: 'Resultado', largura: 13, tipo: 'numero',
      valor: p => p.resultado_final !== undefined ? p.resultado_final : p.resultado }
  ];

  function exportar() {
    const linhas = S.procedimentosComPlantao(filtro);
    if (!linhas.length) return ERP.app.aviso('Nada a exportar com esses filtros.', 'erro');
    /* Exportar não é porta dos fundos: sem `ver_custo`, o arquivo sai
       sem as colunas de dinheiro. */
    if (!veValor()) {
      return ERP.exportar.abrir({
        nome: 'procedimentos-mutirao-hgb' + (filtro.competencia ? '-' + filtro.competencia : ''),
        titulo: 'Procedimentos — mutirão HGB',
        colunas: COLS.filter(function (c) { return c.tipo !== 'numero' || c.titulo === 'Qtd'; })
          .concat([{ titulo: 'Materiais usados', largura: 46,
            valor: p => p.materiais.map(function (m) {
              return U.num(m.qtd) + ' ' + m.descricao; }).join('; ') }]),
        linhas: linhas, cabecalho: [['Procedimentos do mutirão — HGB']]
      });
    }
    const r = S.resultadoProcedimentos(filtro);
    ERP.exportar.abrir({
      nome: 'procedimentos-mutirao-hgb' + (filtro.competencia ? '-' + filtro.competencia : ''),
      titulo: 'Procedimentos — mutirão HGB',
      colunas: COLS, linhas: linhas,
      cabecalho: [['Procedimentos do mutirão — HGB'],
        ['Imposto estimado', U.num(S.impostoProcedimentos()) + '%', 'a confirmar com a contabilidade']],
      rodape: [[], ['Faturamento', r.geral.faturamento], ['Repasse por procedimento', r.geral.repasse],
        ['Plantão estimado', r.geral.plantao], ['Material', r.geral.material],
        ['Imposto estimado', r.geral.imposto], ['Resultado', r.geral.resultado]]
    });
  }

  /* ── aba 3: relatórios ─────────────────────────────────*/
  function telaRelatorios() {
    const r = S.resultadoProcedimentos(filtro);
    const g = r.geral;
    const grupos = { completo: null, especialidade: r.por_especialidade, setor: r.por_setor,
      medico: r.por_medico, procedimento: r.por_procedimento, plantoes: null };
    const rot = { completo: 'Completo', especialidade: 'Especialidade', setor: 'Setor',
      medico: 'Médico', procedimento: 'Procedimento', plantoes: 'Plantões' };

    return '<div class="filtros">' +
        '<div class="f"><label for="pr-comp">Competência</label>' +
          '<input type="month" id="pr-comp" value="' + (filtro.competencia || '') + '"></div>' +
        '<div class="f"><label for="pr-de">De</label>' +
          '<input type="date" id="pr-de" value="' + (filtro.de || '') + '"></div>' +
        '<div class="f"><label for="pr-ate">Até</label>' +
          '<input type="date" id="pr-ate" value="' + (filtro.ate || '') + '"></div>' +
        '<button class="btn-sm" id="pr-hoje">Hoje</button>' +
        '<div class="rel-nav" style="margin:0">' +
          Object.keys(grupos).map(function (k) {
            return '<button data-grupo="' + k + '" aria-pressed="' + (relAba === k) + '">' +
              rot[k] + '</button>'; }).join('') +
        '</div>' +
        '<button class="btn-linha" id="pr-exportar" style="margin-left:auto">Exportar</button>' +
      '</div>' +
      timbre() +
      '<div class="pr-confere">' +
        '<span>' + g.cirurgias + ' cirurgia(s)</span>' +
        (g.diarias ? '<span>' + g.diarias + ' diária(s)</span>' : '') +
        '<span>' + g.medicos + ' médico(s)</span>' +
        '<span>Faturamento <b>' + U.brl(g.faturamento) + '</b></span>' +
        (g.repasse ? '<span>Repasse <b>' + U.brl(g.repasse) + '</b></span>' : '') +
        (g.plantao ? '<span>' + U.num(g.plantoes) + ' plantão(ões) <b>' + U.brl(g.plantao) + '</b> ' +
          '<span class="sub">' + (g.plantao_origem === 'realizado'
            ? 'PegaPlantão' : 'estimado') + '</span></span>' : '') +
        '<span>Material <b>' + U.brl(g.material) + '</b></span>' +
        '<span>Imposto <b>' + U.brl(g.imposto) + '</b></span>' +
        '<span>Resultado <b class="' + (g.resultado < 0 ? 'erro' : '') + '">' + U.brl(g.resultado) +
          '</b>' + (g.margem === null ? '' : ' <span class="sub">' + g.margem + '%</span>') + '</span>' +
      '</div>' +
      (relAba === 'completo' ? tabelaCompleta(r.linhas) :
      relAba === 'plantoes' ? tabelaPlantoes(r.plantoes, g, r.realizado) :
      '<div class="tabela-rolagem"><table><thead><tr><th>' + rot[relAba] + '</th>' +
        '<th class="num">Qtd</th><th class="num">Faturamento</th><th class="num">Repasse</th>' +
        '<th class="num">Plantão</th><th class="num">Material</th><th class="num">Imposto</th>' +
        '<th class="num">Custo</th><th class="num">Resultado</th><th class="num">Margem</th>' +
        '</tr></thead><tbody>' +
        (grupos[relAba].length ? grupos[relAba].map(function (x) {
          return '<tr><td class="desc">' + U.esc(x.chave) + '</td>' +
            '<td class="num sub">' + x.qtd + '</td>' +
            '<td class="num">' + U.brl(x.faturamento) + '</td>' +
            '<td class="num">' + U.brl(x.repasse) + '</td>' +
            '<td class="num">' + U.brl(x.plantao) + '</td>' +
            '<td class="num">' + U.brl(x.material) + '</td>' +
            '<td class="num sub">' + U.brl(x.imposto) + '</td>' +
            '<td class="num">' + U.brl(x.custo) + '</td>' +
            '<td class="num ' + (x.resultado < 0 ? 'erro' : '') + '">' + U.brl(x.resultado) + '</td>' +
            '<td class="num">' + (x.margem === null ? '—' : U.pct(x.margem)) + '</td></tr>';
        }).join('')
        : '<tr><td colspan="10" class="vazio"><strong>Nada lançado no período.</strong></td></tr>') +
      '</tbody></table></div>') +
      '';
  }

  /* Plantões estimados, um por médico e dia. O operador ajusta quando
     o turno não foi de 6 horas — é o único ponto em que ele mexe, e o
     valor definitivo vem do PegaPlantão. */
  function tabelaPlantoes(linhas, g, real) {
    const totalEstim = linhas.reduce(function (s, d) { return s + (d.custo_estimado || 0); }, 0);
    const total = linhas.reduce(function (s, d) { return s + d.custo; }, 0);

    return (real
        ? '<div class="aviso-linha">O fechamento do PegaPlantão desta competência já entrou (' +
          U.esc(real.arquivos) + '). <b>O valor a pagar do fechamento prevalece</b>: é ele que ' +
          'está no custo e no resultado. A estimativa fica ao lado só para conferência, e o ajuste ' +
          'manual de plantões deixa de ter efeito.</div>'
        : '<div class="ajuda">Estimativa: cada médico que lançou procedimento sem repasse na ' +
          'tabela fez um plantão de ' + U.num(S.plantaoHoras()) + ' horas naquele dia, a ' +
          U.brl(S.plantaoValor()) + '. Turno maior: ajuste na linha (12 horas = 2). Quando o ' +
          'fechamento do PegaPlantão for importado, ele passa a mandar.</div>') +
      (real && g.plantao_diferenca
        ? '<div class="pr-confere"><span>Estimado <b>' + U.brl(g.plantao_estimado) + '</b></span>' +
          '<span>Realizado <b>' + U.brl(g.plantao) + '</b></span>' +
          '<span>Diferença <b class="' + (g.plantao_diferenca > 0 ? 'erro' : '') + '">' +
          (g.plantao_diferenca > 0 ? '+' : '') + U.brl(g.plantao_diferenca) + '</b></span></div>'
        : '') +
      (real && g.plantao_nao_alocado
        ? '<div class="aviso-linha erro">' + U.brl(g.plantao_nao_alocado) + ' do fechamento é de ' +
          'médico sem procedimento lançado (' + U.esc(g.medicos_sem_procedimento.join(', ')) +
          '). Entra no custo total, mas não tem cirurgia onde ser rateado — confira se faltou ' +
          'lançar procedimento ou se é plantão de outra natureza.</div>'
        : '') +
      '<div class="tabela-rolagem"><table><thead><tr><th>Data</th><th>Médico</th>' +
        '<th>Especialidade</th><th class="num">Procedimentos</th><th class="num">Faturamento</th>' +
        '<th class="num">Plantões</th><th class="num">Horas</th><th class="num">Estimado</th>' +
        (real ? '<th class="num">Realizado</th>' : '') + '<th></th></tr></thead><tbody>' +
        (linhas.length ? linhas.map(function (d) {
          return '<tr><td class="mono">' + U.fData(d.data) + '</td>' +
            '<td>' + U.esc(d.medico) + '</td>' +
            '<td class="sub">' + U.esc(d.especialidade) + '</td>' +
            '<td class="num sub">' + d.procedimentos + '</td>' +
            '<td class="num sub">' + U.brl(d.faturamento) + '</td>' +
            '<td class="num">' + U.num(d.plantoes) +
              (d.ajustado ? ' <span class="sub" title="ajustado à mão">·</span>' : '') + '</td>' +
            '<td class="num sub">' + U.num(d.horas) + 'h</td>' +
            '<td class="num' + (real ? ' sub' : '') + '">' + U.brl(d.custo_estimado || 0) + '</td>' +
            (real ? '<td class="num">' + (d.custo_realizado === undefined
              ? '<span class="sub">sem fechamento</span>' : U.brl(d.custo_realizado)) + '</td>' : '') +
            '<td>' + (real ? '' : '<button class="btn-sm" data-plantao="' + U.esc(d.data) + '|' +
              U.esc(d.medico) + '" data-qtd="' + d.plantoes + '">Ajustar</button>') + '</td></tr>';
        }).join('')
        : '<tr><td colspan="' + (real ? 10 : 9) + '" class="vazio"><strong>Nenhum plantão no ' +
          'período.</strong> Só entram aqui os procedimentos sem repasse na tabela.</td></tr>') +
        (linhas.length
          ? '<tr style="border-top:2px solid var(--ink)"><td colspan="5"><b>Total</b></td>' +
            '<td class="num"><b>' + U.num(linhas.reduce(function (s, d) { return s + d.plantoes; }, 0)) +
            '</b></td><td></td><td class="num' + (real ? ' sub' : '') + '"><b>' + U.brl(totalEstim) +
            '</b></td>' + (real ? '<td class="num"><b>' + U.brl(total) + '</b></td>' : '') +
            '<td></td></tr>'
          : '') +
      '</tbody></table></div>';
  }

  function abrirAjustePlantao(chave, atual) {
    const partes = chave.split('|');
    ERP.app.modal({
      titulo: 'Plantões de ' + partes[1], fecharTxt: 'Voltar',
      corpo: '<p class="ajuda">' + U.fData(partes[0]) + ' · cada plantão são ' +
        U.num(S.plantaoHoras()) + ' horas a ' + U.brl(S.plantaoValor()) + '.</p>' +
        '<div class="f"><label for="pl-qtd">Plantões</label>' +
        '<input type="number" id="pl-qtd" step="0.5" min="0" value="' + atual + '"></div>' +
        '<div class="f"><label for="pl-motivo">Motivo</label>' +
        '<input id="pl-motivo" placeholder="turno de 12 horas, meio período…"></div>',
      acoes: [{ txt: 'Salvar', cls: 'btn-aprovar', fn: function () {
        const r = S.ajustarPlantoes(partes[0], partes[1], U.val('pl-qtd'), U.val('pl-motivo'));
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal(); render();
        ERP.app.aviso('Plantões atualizados para ' + U.num(r.qtd) + '.', 'ok');
      } }]
    });
  }

  /* Relatório operacional: produção, sem um número de dinheiro. É o
     que o centro cirúrgico precisa para conferir o dia — quantas
     cirurgias, de quem, em que sala, e o material que saiu. */
  function telaProducao() {
    const linhas = S.listarProcedimentos(filtro);
    const grupo = {};
    const chave = relAba === 'medico' ? 'medico'
      : relAba === 'setor' ? 'setor'
      : relAba === 'procedimento' ? 'procedimento_nome' : 'especialidade';
    linhas.forEach(function (p) {
      const k = p[chave] || '—';
      grupo[k] = grupo[k] || { qtd: 0, pacientes: {}, materiais: 0, dias: {} };
      grupo[k].qtd += p.qtd || 1;
      if (p.paciente) grupo[k].pacientes[p.paciente] = true;
      grupo[k].dias[p.data] = true;
      grupo[k].materiais += (p.materiais || []).reduce(function (s, m) { return s + m.qtd; }, 0);
    });
    const rot = { especialidade: 'Especialidade', setor: 'Sala', medico: 'Médico',
      procedimento: 'Procedimento' };

    /* Material consumido no período, somado — a conferência que o
       estoque cobra no fim do dia. */
    const porMaterial = {};
    linhas.forEach(function (p) {
      (p.materiais || []).forEach(function (m) {
        porMaterial[m.descricao] = porMaterial[m.descricao] || { qtd: 0, unidade: m.unidade };
        porMaterial[m.descricao].qtd += m.qtd;
      });
    });

    return '<div class="filtros">' +
        '<div class="f"><label for="pr-comp">Competência</label>' +
          '<input type="month" id="pr-comp" value="' + (filtro.competencia || '') + '"></div>' +
        '<div class="rel-nav" style="margin:0">' +
          ['especialidade', 'setor', 'medico', 'procedimento'].map(function (k) {
            return '<button data-grupo="' + k + '" aria-pressed="' + (relAba === k) + '">' +
              rot[k] + '</button>'; }).join('') +
        '</div>' +
      '</div>' +
      '<div class="pr-confere">' +
        '<span>' + linhas.filter(function (p) { return p.tipo === 'cirurgia'; }).length +
          ' cirurgia(s)</span>' +
        '<span>' + new Set(linhas.map(function (p) { return p.medico; })).size + ' médico(s)</span>' +
        '<span>' + new Set(linhas.map(function (p) { return p.data; })).size + ' dia(s)</span>' +
      '</div>' +
      '<div class="tabela-rolagem"><table><thead><tr><th>' + rot[relAba] + '</th>' +
        '<th class="num">Procedimentos</th><th class="num">Pacientes</th>' +
        '<th class="num">Dias</th><th class="num">Itens de material</th>' +
        '</tr></thead><tbody>' +
        (Object.keys(grupo).length
          ? Object.keys(grupo).sort(function (a, b) { return grupo[b].qtd - grupo[a].qtd; })
            .map(function (k) {
              const g = grupo[k];
              return '<tr><td class="desc">' + U.esc(k) + '</td>' +
                '<td class="num">' + g.qtd + '</td>' +
                '<td class="num sub">' + Object.keys(g.pacientes).length + '</td>' +
                '<td class="num sub">' + Object.keys(g.dias).length + '</td>' +
                '<td class="num sub">' + U.num(g.materiais) + '</td></tr>';
            }).join('')
          : '<tr><td colspan="5" class="vazio"><strong>Nada lançado no período.</strong></td></tr>') +
      '</tbody></table></div>' +
      (Object.keys(porMaterial).length
        ? '<h3 style="font-size:12px;margin:14px 0 4px">Material consumido</h3>' +
          '<div class="tabela-rolagem"><table><thead><tr><th>Material</th>' +
          '<th class="num" style="width:120px">Quantidade</th></tr></thead><tbody>' +
          Object.keys(porMaterial).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); })
            .map(function (k) {
              return '<tr><td class="desc">' + U.esc(k) + '</td><td class="num">' +
                U.num(porMaterial[k].qtd) + ' <span class="sub">' +
                U.esc(porMaterial[k].unidade || '') + '</span></td></tr>';
            }).join('') + '</tbody></table></div>'
        : '');
  }

  function ligarProducao() {
    const c = U.el('pr-comp');
    if (c) c.addEventListener('change', function () {
      filtro.competencia = this.value || undefined; render();
    });
    document.querySelectorAll('[data-grupo]').forEach(function (b) {
      b.addEventListener('click', function () { relAba = this.dataset.grupo; render(); });
    });
  }

  /* Mesmo timbre dos relatórios financeiros: empresa, título, período
     e quem emitiu. É o que faz o papel impresso ter dono. */
  function timbre() {
    const e = D.empresa || {};
    const per = filtro.de || filtro.ate
      ? 'Período: ' + (filtro.de ? U.fData(filtro.de) : 'início') + ' a ' +
        (filtro.ate ? U.fData(filtro.ate) : 'hoje')
      : filtro.competencia ? 'Competência ' + filtro.competencia : 'Todo o período';
    const recorte = [];
    if (filtro.especialidade) recorte.push(filtro.especialidade);
    if (filtro.armazem) recorte.push(nomeArm(filtro.armazem));
    if (filtro.medico) recorte.push(filtro.medico);
    return '<div class="rel-timbre">' +
      '<div class="rel-emp">' + U.esc(e.nome || 'HJM Dom Pedro') +
        (e.cnpj ? '<span class="sub"> · CNPJ ' + U.esc(e.cnpj) + '</span>' : '') + '</div>' +
      '<h2 style="margin:2px 0 0">Procedimentos — mutirão HGB' +
        '<span class="sub">' + U.esc(nomeRelatorio()) + '</span></h2>' +
      '<div class="sub">' + U.esc(per) +
        (recorte.length ? ' · ' + U.esc(recorte.join(' · ')) : '') +
        ' · emitido em ' + U.fData(U.hoje()) +
        ' por ' + U.esc((S.usuario() || {}).nome || '') + '</div></div>';
  }

  const nomeRelatorio = () => ({
    completo: 'analítico, lançamento a lançamento', especialidade: 'agrupado por especialidade',
    setor: 'agrupado por setor', medico: 'agrupado por médico',
    procedimento: 'agrupado por procedimento', plantoes: 'plantões estimados e realizados'
  })[relAba] || '';

  /* Relatório analítico: uma linha por procedimento, com tudo o que
     compõe o resultado. É o que se manda para conferência. */
  function tabelaCompleta(linhas) {
    const soma = linhas.reduce(function (t, p) {
      t.fat += p.faturamento; t.rep += p.repasse; t.pl += p.custo_plantao || 0;
      t.mat += p.custo_material; t.imp += p.imposto;
      t.custo += (p.custo_total !== undefined ? p.custo_total : p.custo);
      t.res += (p.resultado_final !== undefined ? p.resultado_final : p.resultado);
      return t;
    }, { fat: 0, rep: 0, pl: 0, mat: 0, imp: 0, custo: 0, res: 0 });
    const r2 = v => Math.round(v * 100) / 100;

    return '<div class="tabela-rolagem"><table class="tab-completo"><thead><tr>' +
        '<th style="width:82px">Data</th><th>Médico</th><th>Paciente</th>' +
        '<th style="width:110px">Especialidade</th><th>Procedimento</th>' +
        '<th class="num" style="width:100px">Faturamento</th>' +
        '<th class="num" style="width:110px">Repasse/Plantão</th>' +
        '<th class="num" style="width:92px">Material</th>' +
        '<th class="num" style="width:88px">Imposto</th>' +
        '<th class="num" style="width:96px">Custo</th>' +
        '<th class="num" style="width:100px">Resultado</th>' +
        '<th class="num" style="width:74px">Margem</th></tr></thead><tbody>' +
      (linhas.length ? linhas.map(function (p) {
        const custo = p.custo_total !== undefined ? p.custo_total : p.custo;
        const res = p.resultado_final !== undefined ? p.resultado_final : p.resultado;
        const margem = p.margem_final !== undefined ? p.margem_final : p.margem;
        return '<tr><td class="mono">' + U.fData(p.data) + '</td>' +
          '<td>' + U.esc(p.medico) + '</td>' +
          '<td class="sub">' + U.esc(p.paciente || '—') + '</td>' +
          '<td class="sub">' + U.esc(p.especialidade) + '</td>' +
          '<td class="desc" title="' + U.esc(p.procedimento_nome) + '">' +
            U.esc(p.procedimento_nome.slice(0, 40)) +
            (p.procedimento_nome.length > 40 ? '…' : '') + '</td>' +
          '<td class="num">' + U.brl(p.faturamento) + '</td>' +
          '<td class="num">' + U.brl(p.pago_por_plantao ? (p.custo_plantao || 0) : p.repasse) +
            (p.pago_por_plantao ? ' <span class="sub">pl</span>' : '') + '</td>' +
          '<td class="num">' + U.brl(p.custo_material) + '</td>' +
          '<td class="num sub">' + U.brl(p.imposto) + '</td>' +
          '<td class="num">' + U.brl(custo) + '</td>' +
          '<td class="num ' + (res < 0 ? 'erro' : '') + '">' + U.brl(res) + '</td>' +
          '<td class="num sub">' + (margem === null ? '—' : U.pct(margem)) + '</td></tr>';
      }).join('')
        : '<tr><td colspan="12" class="vazio"><strong>Nada lançado no período.</strong></td></tr>') +
      (linhas.length
        ? '<tr style="border-top:2px solid var(--ink)"><td colspan="5"><b>Total · ' +
          linhas.length + ' procedimento(s)</b></td>' +
          '<td class="num"><b>' + U.brl(r2(soma.fat)) + '</b></td>' +
          '<td class="num"><b>' + U.brl(r2(soma.rep + soma.pl)) + '</b></td>' +
          '<td class="num"><b>' + U.brl(r2(soma.mat)) + '</b></td>' +
          '<td class="num"><b>' + U.brl(r2(soma.imp)) + '</b></td>' +
          '<td class="num"><b>' + U.brl(r2(soma.custo)) + '</b></td>' +
          '<td class="num"><b>' + U.brl(r2(soma.res)) + '</b></td>' +
          '<td class="num"><b>' + (soma.fat > 0
            ? U.pct(Math.round(soma.res / soma.fat * 1000) / 10) : '—') + '</b></td></tr>'
        : '') +
      '</tbody></table></div>';
  }

  /* Colunas do analítico e dos agrupados, para PDF e Excel saírem com
     as mesmas informações da tela. */
  const COLS_COMPLETO = [
    { titulo: 'Data', largura: 12, tipo: 'data', valor: p => U.fData(p.data) },
    { titulo: 'Médico', largura: 26, valor: p => p.medico },
    { titulo: 'Paciente', largura: 26, valor: p => p.paciente || '' },
    { titulo: 'Especialidade', largura: 16, valor: p => p.especialidade },
    { titulo: 'Procedimento', largura: 44, valor: p => p.procedimento_nome },
    { titulo: 'Faturamento', largura: 14, tipo: 'numero', valor: p => p.faturamento },
    { titulo: 'Repasse/Plantão', largura: 15, tipo: 'numero',
      valor: p => p.pago_por_plantao ? (p.custo_plantao || 0) : p.repasse },
    { titulo: 'Custo material', largura: 14, tipo: 'numero', valor: p => p.custo_material },
    { titulo: 'Imposto', largura: 12, tipo: 'numero', valor: p => p.imposto },
    { titulo: 'Custo', largura: 13, tipo: 'numero',
      valor: p => p.custo_total !== undefined ? p.custo_total : p.custo },
    { titulo: 'Resultado', largura: 13, tipo: 'numero',
      valor: p => p.resultado_final !== undefined ? p.resultado_final : p.resultado },
    { titulo: 'Margem %', largura: 10, tipo: 'numero',
      valor: p => p.margem_final !== undefined ? p.margem_final : p.margem }
  ];

  const colsAgrupado = rotulo => [
    { titulo: rotulo, largura: 40, valor: x => x.chave },
    { titulo: 'Procedimentos', largura: 14, tipo: 'numero', valor: x => x.qtd },
    { titulo: 'Faturamento', largura: 14, tipo: 'numero', valor: x => x.faturamento },
    { titulo: 'Repasse', largura: 13, tipo: 'numero', valor: x => x.repasse },
    { titulo: 'Plantão', largura: 13, tipo: 'numero', valor: x => x.plantao },
    { titulo: 'Custo material', largura: 14, tipo: 'numero', valor: x => x.material },
    { titulo: 'Imposto', largura: 12, tipo: 'numero', valor: x => x.imposto },
    { titulo: 'Custo', largura: 13, tipo: 'numero', valor: x => x.custo },
    { titulo: 'Resultado', largura: 13, tipo: 'numero', valor: x => x.resultado },
    { titulo: 'Margem %', largura: 10, tipo: 'numero', valor: x => x.margem }
  ];

  function exportarRelatorio() {
    const r = S.resultadoProcedimentos(filtro);
    const g = r.geral;
    const per = filtro.de || filtro.ate
      ? 'Período: ' + (filtro.de ? U.fData(filtro.de) : 'início') + ' a ' +
        (filtro.ate ? U.fData(filtro.ate) : U.fData(U.hoje()))
      : filtro.competencia ? 'Competência ' + filtro.competencia : 'Todo o período';
    const e = D.empresa || {};
    const cab = [
      [e.nome || 'HJM Dom Pedro', '', 'CNPJ', e.cnpj || ''],
      ['Procedimentos — mutirão HGB', nomeRelatorio()],
      [per, '', 'Emitido em', U.fData(U.hoje()) + ' por ' + ((S.usuario() || {}).nome || '')]
    ];
    const rodape = [[], ['Faturamento', g.faturamento], ['Repasse por procedimento', g.repasse],
      ['Plantão (' + g.plantao_origem + ')', g.plantao], ['Material', g.material],
      ['Imposto estimado (' + U.num(S.impostoProcedimentos()) + '%)', g.imposto],
      ['Custo total', g.custo], ['Resultado', g.resultado]];

    const mapa = { especialidade: ['Especialidade', r.por_especialidade],
      setor: ['Setor', r.por_setor], medico: ['Médico', r.por_medico],
      procedimento: ['Procedimento', r.por_procedimento] };

    if (relAba === 'plantoes') {
      return ERP.exportar.abrir({
        nome: 'procedimentos-plantoes' + (filtro.competencia ? '-' + filtro.competencia : ''),
        titulo: 'Plantões — mutirão HGB', subtitulo: per,
        colunas: [
          { titulo: 'Data', largura: 12, tipo: 'data', valor: x => U.fData(x.data) },
          { titulo: 'Médico', largura: 28, valor: x => x.medico },
          { titulo: 'Especialidade', largura: 18, valor: x => x.especialidade },
          { titulo: 'Procedimentos', largura: 14, tipo: 'numero', valor: x => x.procedimentos },
          { titulo: 'Plantões', largura: 10, tipo: 'numero', valor: x => x.plantoes },
          { titulo: 'Horas', largura: 10, tipo: 'numero', valor: x => x.horas },
          { titulo: 'Estimado', largura: 13, tipo: 'numero', valor: x => x.custo_estimado || 0 },
          { titulo: 'Realizado', largura: 13, tipo: 'numero',
            valor: x => x.custo_realizado === undefined ? '' : x.custo_realizado }
        ],
        linhas: r.plantoes, cabecalho: cab, rodape: rodape
      });
    }
    if (mapa[relAba]) {
      return ERP.exportar.abrir({
        nome: 'procedimentos-por-' + relAba + (filtro.competencia ? '-' + filtro.competencia : ''),
        titulo: 'Procedimentos por ' + mapa[relAba][0], subtitulo: per,
        colunas: colsAgrupado(mapa[relAba][0]), linhas: mapa[relAba][1],
        cabecalho: cab, rodape: rodape
      });
    }
    ERP.exportar.abrir({
      nome: 'procedimentos-completo' + (filtro.competencia ? '-' + filtro.competencia : ''),
      titulo: 'Procedimentos — analítico', subtitulo: per,
      colunas: COLS_COMPLETO, linhas: r.linhas, cabecalho: cab, rodape: rodape
    });
  }


  /* ── aba fechamento ────────────────────────────────────
     O que sai daqui entra no financeiro pelo mesmo caminho dos outros
     serviços médicos: o faturamento vira previsão confirmada e título
     previsto no contas a receber; o repasse de cirurgia vira um título
     a pagar por médico. O plantão não entra — vem do PegaPlantão. */
  const ROT_ETAPA = { previsao: 'a fechar', confirmado: 'fechado',
    autorizado: 'autorizado para faturar', liberado: 'autorizado para faturar',
    faturado: 'faturado' };

  function telaFechamento() {
    const r = S.resumoFechamentoProcedimentos(fechComp, D.PATE_CENTRO);
    if (r.erro) return '<p class="ajuda">' + U.esc(r.erro) + '</p>';
    const f = r.fechamento;
    const enviado = ['autorizado', 'liberado', 'faturado'].indexOf(r.etapa) > -1;

    return '<div class="filtros">' +
        '<div class="f"><label for="fc-comp">Competência</label>' +
          '<input type="month" id="fc-comp" value="' + fechComp + '"></div>' +
        '<div class="f"><label>Situação</label>' +
          '<div style="padding:6px 0"><b>' + (ROT_ETAPA[r.etapa] || r.etapa) + '</b></div></div>' +
      '</div>' +
      '<div class="pr-confere">' +
        '<span>' + r.procedimentos + ' lançamento(s)</span>' +
        '<span>Faturamento <b>' + U.brl(r.faturamento) + '</b></span>' +
        '<span>Repasse por cirurgia <b>' + U.brl(r.repasse) + '</b></span>' +
        (r.plantao ? '<span>Plantão <b>' + U.brl(r.plantao) + '</b> ' +
          '<span class="sub">fora do fechamento</span></span>' : '') +
        '<span>Material <b>' + U.brl(r.material) + '</b></span>' +
        '<span>Imposto <b>' + U.brl(r.imposto) + '</b></span>' +
        '<span>Resultado <b class="' + (r.resultado < 0 ? 'erro' : '') + '">' +
          U.brl(r.resultado) + '</b></span>' +
      '</div>' +
      (r.procedimentos ? '' :
        '<p class="ajuda">Não há procedimento lançado nesta competência.</p>') +
      (r.pagos_por_plantao
        ? '<p class="ajuda">' + r.pagos_por_plantao + ' lançamento(s) sem repasse na tabela: esses ' +
          'médicos são pagos por plantão e continuam vindo do fechamento do PegaPlantão. ' +
          'O repasse abaixo é só o de cirurgia.</p>'
        : '') +
      (r.medicos.length
        ? '<div class="tabela-rolagem"><table><thead><tr><th>Médico</th>' +
            '<th class="num">Cirurgias</th><th class="num">Repasse</th></tr></thead><tbody>' +
            r.medicos.map(function (m) {
              return '<tr><td class="desc">' + U.esc(m.medico) + '</td>' +
                '<td class="num sub">' + m.qtd + '</td>' +
                '<td class="num">' + U.brl(m.valor) + '</td></tr>'; }).join('') +
            '<tr class="destaque"><td class="desc"><b>Total</b></td>' +
              '<td class="num sub">' + r.medicos.reduce(function (a, m) { return a + m.qtd; }, 0) + '</td>' +
              '<td class="num"><b>' + U.brl(r.repasse) + '</b></td></tr>' +
            '</tbody></table></div>'
        : '') +
      (f ? '<div class="pr-confere" style="margin-top:12px">' +
            '<span>Fechado por <b>' + U.esc(f.criado_por) + '</b></span>' +
            '<span>A faturar <b>' + U.brl(f.faturamento) + '</b></span>' +
            '<span>Repasse <b>' + U.brl(f.repasse) + '</b> em ' + f.titulo_ids.length + ' título(s), ' +
              'vencendo ' + U.fData(f.vencimento_repasse) + '</span>' +
            (f.enviado_em ? '<span>Enviado ao financeiro em <b>' + U.fData(f.enviado_em) + '</b>' +
              (f.autorizacao_protocolo ? ' · ' + U.esc(f.autorizacao_protocolo) : '') + '</span>' : '') +
          '</div>' : '') +
      '<div class="filtros" style="margin-top:12px">' +
        (enviado ? '' :
          '<button class="btn-aprovar" id="fc-fechar"' + (r.procedimentos ? '' : ' disabled') + '>' +
          (f ? 'Refazer o fechamento' : 'Fechar faturamento e repasse') + '</button>') +
        (f && !enviado ? '<button class="btn-sm" id="fc-enviar">Enviar autorização ao financeiro</button>' : '') +
        (f ? '<button class="btn-sm" id="fc-cancelar">Cancelar fechamento</button>' : '') +
      '</div>' +
      '<p class="ajuda">' +
        (enviado
          ? 'A competência está travada: enquanto o faturamento estiver autorizado, não dá para ' +
            'lançar, editar nem cancelar procedimento neste mês. Cancele o fechamento para reabrir.'
          : f
            ? 'O faturamento já virou previsão confirmada e título previsto no contas a receber, e o ' +
              'repasse já está no contas a pagar. Enviar a autorização libera o financeiro a faturar ' +
              'e trava a competência.'
            : 'Fechar confirma o faturamento da competência no projeto (vira previsão confirmada e ' +
              'título previsto no contas a receber) e gera o repasse de cirurgia, um título a pagar ' +
              'por médico. Até o envio ao financeiro, continua dando para lançar e corrigir.') +
      '</p>';
  }

  function ligarFechamento() {
    const c = U.el('fc-comp');
    if (c) c.addEventListener('change', function () { fechComp = this.value; render(); });

    const bf = U.el('fc-fechar');
    if (bf) bf.addEventListener('click', function () {
      const r0 = S.resumoFechamentoProcedimentos(fechComp, D.PATE_CENTRO);
      if (r0.erro) return ERP.app.aviso(r0.erro, 'erro');
      const refazendo = !!r0.fechamento;
      ERP.app.modal({
        titulo: refazendo ? 'Refazer o fechamento' : 'Fechar faturamento e repasse',
        fecharTxt: 'Voltar',
        corpo: '<p class="ajuda">' + U.fComp(fechComp) + ' · ' + r0.procedimentos +
            ' lançamento(s). Vai ser confirmado <b>' + U.brl(r0.faturamento) + '</b> a faturar e ' +
            'gerado <b>' + U.brl(r0.repasse) + '</b> de repasse para ' + r0.medicos.length +
            ' médico(s).' + (refazendo
              ? ' O fechamento anterior sai inteiro e este entra com o total novo.' : '') + '</p>' +
          '<div class="filtros">' +
            '<div class="f"><label for="fc-venc">Vencimento do repasse</label>' +
              '<input type="date" id="fc-venc" value="' +
                (U.compDe(U.addMeses(fechComp + '-01', 1)) + '-10') + '"></div>' +
            '<div class="f" style="min-width:240px"><label for="fc-obs">Observação</label>' +
              '<input id="fc-obs" placeholder="opcional"></div>' +
          '</div>',
        acoes: [{ txt: refazendo ? 'Refazer' : 'Fechar', cls: 'btn-aprovar', fn: function () {
          const r = S.fecharProcedimentos({
            competencia: fechComp, centro: D.PATE_CENTRO,
            vencimento_repasse: U.val('fc-venc'), observacao: U.val('fc-obs'),
            refazer: refazendo
          });
          if (r.erro) return ERP.app.aviso(r.erro, 'erro');
          ERP.app.fecharModal(); render();
          ERP.app.aviso('Fechamento gravado: ' + U.brl(r.fechamento.faturamento) +
            ' a faturar e ' + U.brl(r.fechamento.repasse) + ' de repasse em ' +
            r.titulo_ids.length + ' título(s).' +
            ((r.avisos || []).length ? ' ' + r.avisos.join(' ') : ''), 'ok');
        } }]
      });
    });

    const be = U.el('fc-enviar');
    if (be) be.addEventListener('click', function () {
      ERP.app.modal({
        titulo: 'Enviar autorização ao financeiro', fecharTxt: 'Voltar',
        corpo: '<p class="ajuda">Registra a autorização do órgão e libera o faturamento de ' +
            U.fComp(fechComp) + '. A partir daí a competência trava para lançamento.</p>' +
          '<div class="filtros">' +
            '<div class="f" style="min-width:240px"><label for="fc-prot">Protocolo/ofício</label>' +
              '<input id="fc-prot" placeholder="nº do ofício em que o hospital aceitou o valor"></div>' +
            '<div class="f"><label for="fc-data">Data</label>' +
              '<input type="date" id="fc-data" value="' + U.hoje() + '"></div>' +
          '</div>',
        acoes: [{ txt: 'Enviar', cls: 'btn-aprovar', fn: function () {
          const r = S.enviarFaturamentoProcedimentos(fechComp, D.PATE_CENTRO,
            { protocolo: U.val('fc-prot'), data: U.val('fc-data') });
          if (r.erro) return ERP.app.aviso(r.erro, 'erro');
          ERP.app.fecharModal(); render();
          ERP.app.aviso('Faturamento autorizado e liberado. O financeiro já pode emitir a nota.', 'ok');
        } }]
      });
    });

    const bc = U.el('fc-cancelar');
    if (bc) bc.addEventListener('click', function () {
      const r0 = S.resumoFechamentoProcedimentos(fechComp, D.PATE_CENTRO);
      if (!r0.fechamento) return;
      ERP.app.modal({
        titulo: 'Cancelar o fechamento', fecharTxt: 'Voltar',
        corpo: '<p class="ajuda">Os títulos de repasse ainda não pagos são cancelados e a ' +
            'competência volta a aceitar lançamento. O que já foi pago vira correção manual.</p>' +
          '<div class="filtros"><div class="f" style="min-width:280px">' +
            /* O motivo É obrigatório — o store recusa sem ele. O
               campo diz isso agora: antes parecia opcional, a
               pessoa clicava e nada acontecia. */
            '<label for="fc-motivo">Motivo *</label>' +
            '<input id="fc-motivo" placeholder="por que está cancelando"></div></div>' +
            '<div id="fc-erro"></div>',
        acoes: [{ txt: 'Cancelar fechamento', cls: 'btn-recusar', fn: function () {
          const r = S.cancelarFechamentoProcedimentos(r0.fechamento.id, U.val('fc-motivo'));
          if (r.erro) {
            /* A mensagem aparece DENTRO do modal, não só no aviso do
               canto: é aqui que a pessoa está olhando. */
            const e = U.el('fc-erro');
            if (e) e.innerHTML = '<div class="login-erro" style="margin-top:10px">' +
              U.esc(r.erro) + '</div>';
            const campo = U.el('fc-motivo');
            if (campo) campo.focus();
            return ERP.app.aviso(r.erro, 'erro');
          }
          ERP.app.fecharModal(); render();
          ERP.app.aviso('Fechamento cancelado · ' + r.parcelas_canceladas +
            ' título(s) de repasse cancelado(s).', 'ok');
        } }]
      });
    });
  }

  function ligarRelatorios() {
    const ex = U.el('pr-exportar');
    if (ex) ex.addEventListener('click', exportarRelatorio);
    ['pr-de', 'pr-ate'].forEach(function (id) {
      const e2 = U.el(id);
      if (e2) e2.addEventListener('change', function () {
        filtro[id === 'pr-de' ? 'de' : 'ate'] = this.value || undefined; render();
      });
    });
    const hj = U.el('pr-hoje');
    if (hj) hj.addEventListener('click', function () {
      filtro.de = U.hoje(); filtro.ate = U.hoje(); filtro.competencia = undefined; render();
    });
    document.querySelectorAll('[data-plantao]').forEach(function (b) {
      b.addEventListener('click', function () {
        abrirAjustePlantao(this.dataset.plantao, this.dataset.qtd);
      });
    });
    const c = U.el('pr-comp');
    if (c) c.addEventListener('change', function () {
      filtro.competencia = this.value || undefined; render();
    });
    document.querySelectorAll('[data-grupo]').forEach(function (b) {
      b.addEventListener('click', function () { relAba = this.dataset.grupo; render(); });
    });
  }

  return { montar: montar, render: render };
})();
