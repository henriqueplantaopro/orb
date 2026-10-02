/* ERP · ui-dp.js — Departamento Pessoal: funcionários, folha, férias e
   rescisão. Motor de cálculo completo (modelo A): o próprio sistema
   calcula INSS, IRRF e FGTS pela tabela progressiva vigente, em vez de
   só registrar um valor que vem calculado de fora.

   Antes de rodar a primeira folha real, confira com o contador ou a
   analista de DP: (1) a tabela de INSS e IRRF na aba Tabelas — são
   valores de referência, e a lei muda quase todo ano; (2) a fórmula
   de rescisão cobre "sem justa causa" — outro motivo pede outra
   conta; (3) hora noturna reduzida e DSR sobre variáveis usam
   aproximações assumidas, marcadas no código. */
window.ERP = window.ERP || {};

ERP.dp = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;
  let abaAtual = 'funcionarios';
  let funcionarioEmEdicao = null;
  let ajustesFolha = {};   // { funcionarioId: { he50_horas, he100_horas, faltas_dias, ... } } — só desta sessão
  let ajustesFolhaComp = null;
  let modoComplementar = false;   // prévia só de quem ficou fora de uma folha já fechada   // de qual competência são os ajustes acima — ver renderFolha

  function montar() {
    document.querySelectorAll('#dp-nav button').forEach(function (b) {
      b.addEventListener('click', function () { abrirAba(this.dataset.dpaba); });
    });
  }

  function abrirAba(aba) {
    abaAtual = aba;
    document.querySelectorAll('#dp-nav button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.dpaba === aba);
    });
    ['funcionarios', 'folha', 'relatorio', 'decimo', 'ferias', 'rescisao', 'custos', 'tabelas'].forEach(function (a) {
      U.el('dp-aba-' + a).style.display = a === aba ? '' : 'none';
    });
    render();
  }

  function render() {
    atualizarAlertaFerias();
    if (abaAtual === 'funcionarios') renderFuncionarios();
    else if (abaAtual === 'folha') renderFolha();
    else if (abaAtual === 'relatorio') renderRelatorioFolha();
    else if (abaAtual === 'decimo') renderDecimo();
    else if (abaAtual === 'ferias') renderFerias();
    else if (abaAtual === 'rescisao') renderRescisao();
    else if (abaAtual === 'custos') renderCustos();
    else if (abaAtual === 'tabelas') renderTabelas();
  }

  function atualizarAlertaFerias() {
    const n = S.alertasDP().filter(function (a) { return a.nivel === 'erro'; }).length;
    const el = U.el('dp-alerta-ferias');
    if (n) { el.style.display = ''; el.textContent = n; } else el.style.display = 'none';
  }

  const podeDP = () => S.pode('dp');
  const podeVerPessoal = () => S.pode('ver_dados_pessoais');
  const podeAprovarPagamento = () => S.pode('aprovar');

  /* ══════════════════ FUNCIONÁRIOS ══════════════════ */
  function renderFuncionarios() {
    const box = U.el('dp-aba-funcionarios');
    const ativos = D.funcionarios.filter(function (f) { return f.ativo; });
    const desligados = D.funcionarios.filter(function (f) { return !f.ativo; });

    const linha = f => {
      const cg = D.cargo(f.cargo) || {};
      return '<tr>' +
        '<td>' + U.esc(f.matricula) + '</td>' +
        '<td>' + U.esc(f.nome) + (podeVerPessoal() ? '<div class="sub">' + U.esc(f.cpf) + '</div>' : '') + '</td>' +
        '<td>' + U.esc(cg.nome || '—') + '</td>' +
        '<td>' + U.esc((D.centro(f.centro) || {}).curto || f.centro) + '</td>' +
        '<td class="num">' + U.brl(f.salario_base) + '</td>' +
        '<td>' + U.fData(f.admissao) + '</td>' +
        '<td class="acoes">' +
          '<button class="btn-sm" data-ver-fn="' + f.id + '">Ver</button>' +
          (f.ativo && podeDP() ? '<button class="btn-sm" data-editar-fn="' + f.id + '">Editar</button>' : '') +
          (f.ativo && podeDP() ? '<button class="btn-sm" data-reajustar-fn="' + f.id + '">Reajustar</button>' : '') +
          (f.ativo && podeDP() ? '<button class="btn-sm" data-desligar-fn="' + f.id + '">Desligar</button>' : '') +
          (!f.ativo ? '<span class="badge b-cancelado">desligado ' + U.fData(f.desligado_em) + '</span>' : '') +
          (f.pagamento_aprovado === false
            ? (podeAprovarPagamento()
                ? ' <button class="btn-sm btn-aprovar" data-aprovar-pag-fn="' + f.id + '">Aprovar pagamento</button>'
                : ' <span class="badge b-aguardando">pagamento pendente de aprovação</span>')
            : '') +
        '</td></tr>';
    };

    box.innerHTML =
      '<h2>Funcionários<span class="sub">quem é CLT, cargo, salário e rateio de custo</span></h2>' +
      '<div class="acao-topo" style="margin-bottom:10px">' +
        (podeDP() ? '<button class="btn-linha" id="dp-novo-fn">+ Admitir funcionário</button>' : '') +
      '</div>' +
      '<table class="parcelas"><thead><tr><th>Matrícula</th><th>Nome</th><th>Cargo</th><th>Centro de custo</th>' +
        '<th>Salário base</th><th>Admissão</th><th></th></tr></thead><tbody>' +
        ativos.map(linha).join('') +
      '</tbody></table>' +
      (desligados.length ?
        '<h2 style="margin-top:18px">Desligados</h2><table class="parcelas"><tbody>' +
          desligados.map(linha).join('') + '</tbody></table>' : '');

    if (podeDP() && U.el('dp-novo-fn')) U.el('dp-novo-fn').addEventListener('click', function () { abrirFormFuncionario(null); });
    box.querySelectorAll('[data-ver-fn]').forEach(function (b) {
      b.addEventListener('click', function () { abrirVisualizarFuncionario(this.dataset.verFn); });
    });
    box.querySelectorAll('[data-editar-fn]').forEach(function (b) {
      b.addEventListener('click', function () { abrirFormFuncionario(this.dataset.editarFn); });
    });
    box.querySelectorAll('[data-reajustar-fn]').forEach(function (b) {
      b.addEventListener('click', function () { abrirReajusteSalarial(this.dataset.reajustarFn); });
    });
    box.querySelectorAll('[data-desligar-fn]').forEach(function (b) {
      b.addEventListener('click', function () { abrirDesligamento(this.dataset.desligarFn); });
    });
    box.querySelectorAll('[data-aprovar-pag-fn]').forEach(function (b) {
      b.addEventListener('click', function () {
        const f = D.funcionario(this.dataset.aprovarPagFn);
        if (!confirm('Confirma os dados de pagamento de ' + (f ? f.nome : '') +
            ' (PIX/banco) antes de aprovar? Isso libera folha, férias, 13º e rescisão pra pagar essa pessoa.')) return;
        const r = S.aprovarDadosPagamento(this.dataset.aprovarPagFn);
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.aviso(r.aviso ? 'Dados de pagamento aprovados. ' + r.aviso : 'Dados de pagamento aprovados.', r.aviso ? 'erro' : 'ok');
        render();
      });
    });
  }

  function abrirVisualizarFuncionario(id) {
    const f = D.funcionario(id);
    if (!f) return;
    const cg = D.cargo(f.cargo) || {};
    const centro = D.centro(f.centro) || {};
    const vp = podeVerPessoal();
    const linha = (rotulo, valor) => valor ? '<div class="resumo-linha"><span>' + rotulo + '</span><span class="v">' + valor + '</span></div>' : '';
    const hist = S.historicoSalarial(id);

    ERP.app.modal({
      titulo: f.nome + (!f.ativo ? ' (desligado)' : ''),
      corpo:
        linha('Matrícula', U.esc(f.matricula)) +
        (vp ? linha('CPF', U.esc(f.cpf)) + linha('PIS/NIS', U.esc(f.pis || '—')) +
          linha('Nascimento', f.nascimento ? U.fData(f.nascimento) : '—') : '') +
        linha('Cargo', U.esc(cg.nome || '—') + (cg.cbo ? ' · CBO ' + U.esc(cg.cbo) : '')) +
        linha('Admissão', U.fData(f.admissao)) +
        linha('Tipo de contrato', U.esc(f.tipo_contrato === 'clt' ? 'CLT' : f.tipo_contrato)) +
        linha('Jornada semanal', f.jornada_semanal_horas + 'h') +
        linha('Dependentes (IRRF)', String(f.dependentes_irrf)) +
        linha('Centro de custo', U.esc((centro.unidade ? centro.unidade + ' · ' : '') + (centro.curto || f.centro))) +
        linha('Salário atual', '<b>' + U.brl(f.salario_base) + '</b>') +
        (vp ? linha('Banco', U.esc(f.banco || '—') + (f.agencia ? ' · ag. ' + U.esc(f.agencia) : '') +
          (f.conta_bancaria ? ' · cc ' + U.esc(f.conta_bancaria) : '')) +
          linha('PIX', U.esc(f.pix || '—')) : '') +
        linha('Vale-transporte', f.vale_transporte ? U.brl(f.vt_dia) + '/dia' : 'Não') +
        linha('Vale-refeição', f.vale_refeicao ? U.brl(f.vr_dia) + '/dia' : 'Não') +
        linha('Insalubridade', f.insalubridade_pct > 0 ? f.insalubridade_pct + '% do salário mínimo' : 'Não') +
        linha('Periculosidade', f.periculosidade ? '30% do salário base' : 'Não') +
        (vp && f.pensao_alimenticia && f.pensao_alimenticia.ativo
          ? linha('Pensão alimentícia', U.brl(f.pensao_alimenticia.valor) + ' — ' + U.esc(f.pensao_alimenticia.beneficiario_nome || '')) : '') +
        (vp && f.credito_trabalhador && f.credito_trabalhador.ativo
          ? linha('Crédito do trabalhador', U.brl(f.credito_trabalhador.valor_parcela) + '/mês' +
              (f.credito_trabalhador.instituicao ? ' — ' + U.esc(f.credito_trabalhador.instituicao) : '')) : '') +
        (!f.ativo ? linha('Desligamento', U.fData(f.desligado_em) + ' — ' + U.esc(f.motivo_desligamento || '')) : '') +
        (hist.length > 1 || (hist.length === 1 && vp) ? '<h3 style="font-size:12px;margin:14px 0 6px">Histórico salarial</h3>' +
          '<table class="parcelas"><tbody>' + hist.map(function (h) {
            return '<tr><td>' + U.fData(h.vigencia) + '</td><td class="num">' + U.brl(h.salario) + '</td>' +
              '<td class="sub">' + U.esc(h.motivo || '') + '</td></tr>';
          }).join('') + '</tbody></table>' : '') +
        (f.dependentes && f.dependentes.length ? '<h3 style="font-size:12px;margin:14px 0 6px">Dependentes cadastrados</h3>' +
          '<table class="parcelas"><tbody>' + f.dependentes.map(function (d) {
            return '<tr><td>' + U.esc(d.nome) + '</td>' +
              '<td class="sub">' + (d.data_nascimento ? U.fData(d.data_nascimento) : '—') + '</td></tr>';
          }).join('') + '</tbody></table>' : '') +
        (f.ferias && f.ferias.length ? '<h3 style="font-size:12px;margin:14px 0 6px">Férias</h3>' +
          '<table class="parcelas"><tbody>' + f.ferias.map(function (p) {
            return '<tr><td>' + U.fData(p.aquisitivo_inicio) + ' a ' + U.fData(p.aquisitivo_fim) + '</td>' +
              '<td class="num">' + (p.dias_gozados || 0) + '/' + p.dias_direito + ' dias gozados</td>' +
              '<td class="sub">limite ' + U.fData(p.limite) + '</td></tr>';
          }).join('') + '</tbody></table>' : ''),
    });
  }

  function abrirReajusteSalarial(id) {
    const f = D.funcionario(id);
    const hist = S.historicoSalarial(id);
    ERP.app.modal({
      titulo: 'Reajuste salarial — ' + f.nome,
      fecharTxt: 'Cancelar',
      corpo:
        '<table class="parcelas"><thead><tr><th>Vigência</th><th class="num">Salário</th><th>Motivo</th></tr></thead><tbody>' +
          hist.map(function (h) {
            return '<tr><td>' + U.fData(h.vigencia) + '</td><td class="num">' + U.brl(h.salario) + '</td>' +
              '<td class="sub">' + U.esc(h.motivo || '') + '</td></tr>';
          }).join('') +
        '</tbody></table>' +
        '<div class="row3" style="margin-top:12px">' +
          '<div><label>Novo salário *</label><input class="num" id="rj-salario" inputmode="decimal" value="' + U.num(f.salario_base) + '"></div>' +
          '<div><label>Vigência a partir de *</label><input type="date" id="rj-vigencia" value="' + U.hoje() + '"></div>' +
          '<div><label>Motivo *</label><select id="rj-motivo">' +
            ['Reajuste anual', 'Dissídio / convenção coletiva', 'Promoção', 'Mudança de cargo', 'Equiparação salarial', 'Outro'].map(function (m) {
              return '<option value="' + m + '">' + m + '</option>'; }).join('') + '</select></div>' +
        '</div>' +
        '<div class="ajuda">Fica registrado no histórico com essa vigência — é o que a estimativa de multa ' +
        'de FGTS numa eventual rescisão usa pra saber quanto ele ganhava em cada época do contrato.</div>',
      acoes: [{ txt: 'Registrar reajuste', cls: 'btn-aprovar', fn: function () {
        const r = S.registrarReajusteSalarial(id, U.parseValor(U.val('rj-salario')), U.val('rj-vigencia'), U.val('rj-motivo'));
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        ERP.app.aviso('Reajuste registrado.', 'ok');
        render();
      } }]
    });
  }

  function opcoesCargo(sel) {
    return '<option value="">Escolher…</option>' + D.cargos.map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === sel ? ' selected' : '') + '>' + U.esc(c.nome) + '</option>';
    }).join('');
  }
  function opcoesCentroDP(sel) {
    return D.centros.filter(function (c) { return c.ativo; }).map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === sel ? ' selected' : '') + '>' +
        U.esc((c.unidade || '') + ' · ' + (c.curto || c.nome)) + '</option>';
    }).join('');
  }

  /* ── editor de rateio do funcionário (centro + %) ── */
  function linhaRateioHTML(centro, pct) {
    return '<div class="row3" data-rt style="margin-top:4px;align-items:center">' +
      '<select data-rt-centro>' + opcoesCentroDP(centro) + '</select>' +
      '<input class="num" data-rt-pct inputmode="decimal" value="' + U.num(pct) + '" placeholder="%">' +
      '<button type="button" class="btn-sm" data-rt-del title="remover">×</button></div>';
  }
  function lerRateioForm() {
    return Array.prototype.map.call(document.querySelectorAll('#fn-rateio [data-rt]'), function (l) {
      return { centro: l.querySelector('[data-rt-centro]').value, pct: U.parseValor(l.querySelector('[data-rt-pct]').value) };
    }).filter(function (r) { return r.centro; });
  }
  function montarEditorRateio(rateio) {
    const box = U.el('fn-rateio');
    box.innerHTML = rateio.map(function (r) { return linhaRateioHTML(r.centro, r.pct); }).join('');
    const atualiza = function () {
      const linhas = box.querySelectorAll('[data-rt]');
      linhas.forEach(function (l) { l.querySelector('[data-rt-del]').style.visibility = linhas.length > 1 ? 'visible' : 'hidden'; });
      const tot = Math.round(lerRateioForm().reduce(function (a, r) { return a + (r.pct || 0); }, 0) * 100) / 100;
      const t = U.el('fn-rateio-total');
      t.textContent = 'Total: ' + U.num(tot) + '%' + (Math.abs(tot - 100) > 0.01 ? ' — precisa somar 100%' : '');
      t.style.color = Math.abs(tot - 100) > 0.01 ? 'var(--red)' : '';
    };
    box.addEventListener('input', atualiza);
    box.addEventListener('change', atualiza);
    box.addEventListener('click', function (e) {
      if (e.target.matches('[data-rt-del]')) { e.target.closest('[data-rt]').remove(); atualiza(); }
    });
    U.el('fn-rateio-add').addEventListener('click', function () {
      const falta = Math.max(0, 100 - lerRateioForm().reduce(function (a, r) { return a + (r.pct || 0); }, 0));
      box.insertAdjacentHTML('beforeend', linhaRateioHTML('', Math.round(falta * 100) / 100));
      atualiza();
    });
    atualiza();
  }

  function abrirFormFuncionario(id) {
    const f = id ? D.funcionario(id) : null;
    let dependentesAtuais = (f && f.dependentes ? f.dependentes : []).slice();
    const pensaoAtual = (f && f.pensao_alimenticia) || { ativo: false };
    const creditoAtual = (f && f.credito_trabalhador) || { ativo: false };

    function renderDependentesRows() {
      const box = U.el('fn-dependentes-lista');
      if (!box) return;
      box.innerHTML = dependentesAtuais.map(function (d, i) {
        return '<div class="row3" data-dep-row="' + i + '" style="margin-top:4px">' +
          '<input placeholder="Nome" data-dep="' + i + '" data-c="nome" value="' + U.esc(d.nome || '') + '">' +
          '<input placeholder="CPF (opcional)" data-dep="' + i + '" data-c="cpf" value="' + U.esc(d.cpf || '') + '">' +
          '<div style="display:flex;gap:6px"><input type="date" data-dep="' + i + '" data-c="data_nascimento" value="' + U.esc(d.data_nascimento || '') + '" style="flex:1">' +
          '<button type="button" class="btn-sm" data-dep-remover="' + i + '">×</button></div></div>';
      }).join('');
      box.querySelectorAll('[data-dep]').forEach(function (inp) {
        inp.addEventListener('change', function () {
          const i = +this.dataset.dep, c = this.dataset.c;
          dependentesAtuais[i][c] = this.value;
        });
      });
      box.querySelectorAll('[data-dep-remover]').forEach(function (b) {
        b.addEventListener('click', function () {
          dependentesAtuais.splice(+this.dataset.depRemover, 1);
          renderDependentesRows();
        });
      });
    }

    ERP.app.modal({
      titulo: f ? 'Editar funcionário' : 'Admitir funcionário',
      fecharTxt: 'Cancelar',
      corpo:
        '<div class="row2"><div><label>Nome completo *</label><input id="fn-nome" value="' + U.esc(f ? f.nome : '') + '"></div>' +
        '<div><label>CPF *</label><input id="fn-cpf" value="' + U.esc(f ? f.cpf : '') + '"' + (f ? ' disabled' : '') + '></div></div>' +
        '<div class="row3"><div><label>PIS/NIS</label><input id="fn-pis" value="' + U.esc(f ? f.pis : '') + '"></div>' +
        '<div><label>Nascimento</label><input type="date" id="fn-nasc" value="' + U.esc(f ? f.nascimento : '') + '"></div>' +
        '<div><label>Admissão *</label><input type="date" id="fn-admissao" value="' + U.esc(f ? f.admissao : U.hoje()) + '"' + (f ? ' disabled' : '') + '></div></div>' +
        '<div class="row2"><div><label>Cargo *</label><div style="display:flex;gap:6px">' +
          '<select id="fn-cargo" style="flex:1">' + opcoesCargo(f ? f.cargo : '') + '</select>' +
          '<button type="button" class="btn-sm" id="fn-novo-cargo">+ cadastrar</button></div>' +
          '<div id="fn-cargo-form" style="display:none;margin-top:8px">' +
            '<div class="row3"><div><label>Nome do cargo</label><input id="fn-cargo-nome"></div>' +
            '<div><label>CBO</label><input id="fn-cargo-cbo" placeholder="0000-00"></div>' +
            '<div><label>Piso salarial</label><input class="num" id="fn-cargo-piso" inputmode="decimal" value="0"></div></div>' +
            '<button type="button" class="btn-sm" id="fn-cargo-salvar" style="margin-top:6px">Salvar cargo</button>' +
          '</div></div>' +
        '<div><label>Salário base *' + (f ? ' <span class="sub">— use "Reajustar" pra mudar, com histórico</span>' : '') +
          '</label><input class="num" id="fn-salario" inputmode="decimal" value="' + U.num(f ? f.salario_base : 0) + '"' +
          (f ? ' disabled' : '') + '></div></div>' +
        '<div class="row3"><div><label>Jornada semanal (h)</label><input class="num" id="fn-jornada" inputmode="decimal" value="' + (f ? f.jornada_semanal_horas : 44) + '"></div>' +
        '<div><label>Dependentes (IRRF) <span class="sub">contagem pra dedução</span></label><input class="num" id="fn-dependentes" inputmode="numeric" value="' + (f ? f.dependentes_irrf : 0) + '"></div>' +
        '<div></div></div>' +
        '<label>Centro de custo / rateio *</label><div id="fn-rateio"></div>' +
        '<button type="button" class="btn-sm" id="fn-rateio-add" style="margin-top:4px">+ dividir com outro centro</button>' +
        ' <span id="fn-rateio-total" class="sub"></span>' +
        '<div class="ajuda">O centro de custo decide em qual projeto o custo deste funcionário aparece — use o ' +
        'projeto do cliente quando for mão de obra alocada (o caso da Iron Trainers), ou a matriz para quem é ' +
        'administrativo.</div>' +
        '<div class="row3"><div><label>Banco</label><input id="fn-banco" placeholder="nome ou código" value="' + U.esc(f ? f.banco || '' : '') + '"></div><div><label>Agência</label><input id="fn-agencia" value="' + U.esc(f ? f.agencia : '') + '"></div>' +
        '<div><label>Conta</label><input id="fn-conta" value="' + U.esc(f ? f.conta_bancaria : '') + '"></div></div>' +
        '<label>Chave PIX (se pagar por PIX)</label><input id="fn-pix" value="' + U.esc(f ? f.pix : '') + '">' +

        '<h3 style="font-size:12px;margin:14px 0 4px">Dependentes cadastrados <span class="sub">nome, CPF (opcional) e nascimento — usado pro salário-família</span></h3>' +
        '<div id="fn-dependentes-lista"></div>' +
        '<button type="button" class="btn-sm" id="fn-dep-add" style="margin-top:6px">+ Adicionar dependente</button>' +

        '<h3 style="font-size:12px;margin:14px 0 4px">Vale-transporte e vale-refeição</h3>' +
        '<div class="row2"><div><label><input type="checkbox" id="fn-vt"' + (f && f.vale_transporte ? ' checked' : '') + '> Vale-transporte</label>' +
          '<div class="row2" style="margin-top:4px"><input class="num" id="fn-vt-dia" inputmode="decimal" placeholder="valor por dia" value="' + U.num(f ? f.vt_dia : 0) + '">' +
          '<select id="fn-vt-desc-modo"><option value="percentual"' + (!f || f.vt_desconto_modo === 'percentual' ? ' selected' : '') + '>Desconto % (padrão 6%)</option>' +
          '<option value="valor"' + (f && f.vt_desconto_modo === 'valor' ? ' selected' : '') + '>Desconto fixo (R$)</option>' +
          '<option value="nenhum"' + (f && f.vt_desconto_modo === 'nenhum' ? ' selected' : '') + '>Sem desconto</option></select></div>' +
          '<input class="num" id="fn-vt-desc-valor" inputmode="decimal" placeholder="% ou R$ conforme o modo" value="' + U.num(f ? f.vt_desconto_valor || 0 : 0) + '" style="margin-top:4px"></div>' +
        '<div><label><input type="checkbox" id="fn-vr"' + (f && f.vale_refeicao ? ' checked' : '') + '> Vale-refeição</label>' +
          '<div class="row2" style="margin-top:4px"><input class="num" id="fn-vr-dia" inputmode="decimal" placeholder="valor por dia" value="' + U.num(f ? f.vr_dia : 0) + '">' +
          '<select id="fn-vr-desc-modo"><option value="nenhum"' + (!f || f.vr_desconto_modo === 'nenhum' ? ' selected' : '') + '>Sem desconto</option>' +
          '<option value="percentual"' + (f && f.vr_desconto_modo === 'percentual' ? ' selected' : '') + '>Desconto %</option>' +
          '<option value="valor"' + (f && f.vr_desconto_modo === 'valor' ? ' selected' : '') + '>Desconto fixo (R$)</option></select></div>' +
          '<input class="num" id="fn-vr-desc-valor" inputmode="decimal" placeholder="% ou R$ conforme o modo" value="' + U.num(f ? f.vr_desconto_valor || 0 : 0) + '" style="margin-top:4px"></div></div>' +

        '<div class="row2" style="margin-top:8px"><div><label>Insalubridade</label><select id="fn-insal">' +
          [0, 10, 20, 40].map(function (p) { return '<option value="' + p + '"' + (f && f.insalubridade_pct === p ? ' selected' : '') + '>' + (p ? p + '% do salário mínimo' : 'Nenhuma') + '</option>'; }).join('') +
          '</select></div><div><label style="margin-top:22px;display:block"><input type="checkbox" id="fn-pericul"' + (f && f.periculosidade ? ' checked' : '') + '> Periculosidade (30%)</label></div></div>' +

        '<h3 style="font-size:12px;margin:14px 0 4px">Pensão alimentícia</h3>' +
        '<label><input type="checkbox" id="fn-pensao-ativa"' + (pensaoAtual.ativo ? ' checked' : '') + '> Desconta pensão alimentícia deste funcionário</label>' +
        '<div id="fn-pensao-campos" style="display:' + (pensaoAtual.ativo ? 'block' : 'none') + ';margin-top:6px">' +
          '<div class="row3"><input class="num" id="fn-pensao-valor" inputmode="decimal" placeholder="Valor mensal" value="' + U.num(pensaoAtual.valor || 0) + '">' +
          '<input id="fn-pensao-nome" placeholder="Nome do beneficiário" value="' + U.esc(pensaoAtual.beneficiario_nome || '') + '">' +
          '<input id="fn-pensao-cpf" placeholder="CPF do beneficiário" value="' + U.esc(pensaoAtual.beneficiario_cpf || '') + '"></div>' +
          '<div style="margin-top:4px"><label style="display:inline"><input type="checkbox" id="fn-pensao-13"' + (pensaoAtual.incide_13 !== false ? ' checked' : '') + '> Incide sobre o 13º</label> ' +
          '<label style="display:inline;margin-left:12px"><input type="checkbox" id="fn-pensao-ferias"' + (pensaoAtual.incide_ferias !== false ? ' checked' : '') + '> Incide sobre férias</label>' +
          ' <span class="sub">— conforme a sentença</span></div>' +
          '<div class="row3" style="margin-top:4px"><input type="date" id="fn-pensao-nasc" value="' + U.esc(pensaoAtual.beneficiario_nascimento || '') + '">' +
          '<input id="fn-pensao-banco" placeholder="Banco" value="' + U.esc(pensaoAtual.banco || '') + '">' +
          '<input id="fn-pensao-agencia" placeholder="Agência" value="' + U.esc(pensaoAtual.agencia || '') + '"></div>' +
          '<div class="row2" style="margin-top:4px"><input id="fn-pensao-conta" placeholder="Conta" value="' + U.esc(pensaoAtual.conta_bancaria || '') + '">' +
          '<input id="fn-pensao-pix" placeholder="Chave PIX (se preferir)" value="' + U.esc(pensaoAtual.pix || '') + '"></div>' +
          (f ? '<div class="ajuda">Mudar os dados bancários do beneficiário precisa de aprovação de quem tem alçada.</div>' : '') +
        '</div>' +

        '<h3 style="font-size:12px;margin:14px 0 4px">Crédito do trabalhador / empréstimo com débito em folha</h3>' +
        '<label><input type="checkbox" id="fn-credito-ativo"' + (creditoAtual.ativo ? ' checked' : '') + '> Tem parcela de empréstimo descontada em folha</label>' +
        '<div id="fn-credito-campos" style="display:' + (creditoAtual.ativo ? 'block' : 'none') + ';margin-top:6px">' +
          '<div class="row2"><input class="num" id="fn-credito-valor" inputmode="decimal" placeholder="Valor da parcela mensal" value="' + U.num(creditoAtual.valor_parcela || 0) + '">' +
          '<input id="fn-credito-instituicao" placeholder="Instituição" value="' + U.esc(creditoAtual.instituicao || '') + '"></div>' +
          '<div class="row3" style="margin-top:4px"><input id="fn-credito-banco" placeholder="Banco" value="' + U.esc(creditoAtual.banco || '') + '">' +
          '<input id="fn-credito-agencia" placeholder="Agência" value="' + U.esc(creditoAtual.agencia || '') + '">' +
          '<input id="fn-credito-conta" placeholder="Conta" value="' + U.esc(creditoAtual.conta_bancaria || '') + '"></div>' +
          '<input id="fn-credito-pix" placeholder="Chave PIX (se preferir)" value="' + U.esc(creditoAtual.pix || '') + '" style="margin-top:4px">' +
          (f ? '<div class="ajuda">Mudar os dados bancários da instituição precisa de aprovação de quem tem alçada.</div>' : '') +
        '</div>',
      acoes: [{ txt: f ? 'Salvar' : 'Admitir', cls: 'btn-aprovar', fn: function () {
        // rateio vem direto das linhas do editor (centro + %); o store confere se soma 100%
        const rateioFinal = lerRateioForm();
        const centroEscolhido = (rateioFinal[0] || {}).centro || '';
        const dados = {
          nome: U.val('fn-nome'), cpf: U.val('fn-cpf'), pis: U.val('fn-pis'),
          nascimento: U.val('fn-nasc'), admissao: U.val('fn-admissao'), cargo: U.val('fn-cargo'),
          salario_base: U.parseValor(U.val('fn-salario')), jornada_semanal_horas: U.parseValor(U.val('fn-jornada')),
          dependentes_irrf: U.parseValor(U.val('fn-dependentes')), centro: centroEscolhido,
          rateio: rateioFinal,
          banco: U.val('fn-banco'), agencia: U.val('fn-agencia'), conta_bancaria: U.val('fn-conta'),
          pix: U.val('fn-pix'), vale_transporte: U.el('fn-vt').checked, vt_dia: U.parseValor(U.val('fn-vt-dia')),
          vt_desconto_modo: U.val('fn-vt-desc-modo'), vt_desconto_valor: U.parseValor(U.val('fn-vt-desc-valor')),
          vale_refeicao: U.el('fn-vr').checked, vr_dia: U.parseValor(U.val('fn-vr-dia')),
          vr_desconto_modo: U.val('fn-vr-desc-modo'), vr_desconto_valor: U.parseValor(U.val('fn-vr-desc-valor')),
          insalubridade_pct: U.parseValor(U.val('fn-insal')), periculosidade: U.el('fn-pericul').checked,
          dependentes: dependentesAtuais.filter(function (d) { return d.nome; }),
          pensao_alimenticia: {
            ativo: U.el('fn-pensao-ativa').checked, valor: U.parseValor(U.val('fn-pensao-valor')),
            incide_13: U.el('fn-pensao-13').checked, incide_ferias: U.el('fn-pensao-ferias').checked,
            beneficiario_nome: U.val('fn-pensao-nome'), beneficiario_cpf: U.val('fn-pensao-cpf'),
            beneficiario_nascimento: U.val('fn-pensao-nasc'), banco: U.val('fn-pensao-banco'),
            agencia: U.val('fn-pensao-agencia'), conta_bancaria: U.val('fn-pensao-conta'), pix: U.val('fn-pensao-pix')
          },
          credito_trabalhador: {
            ativo: U.el('fn-credito-ativo').checked, valor_parcela: U.parseValor(U.val('fn-credito-valor')),
            instituicao: U.val('fn-credito-instituicao'),
            banco: U.val('fn-credito-banco'), agencia: U.val('fn-credito-agencia'),
            conta_bancaria: U.val('fn-credito-conta'), pix: U.val('fn-credito-pix')
          }
        };
        const r = f ? S.editarFuncionario(f.id, dados) : S.criarFuncionario(dados);
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        if (r.aviso) ERP.app.aviso((f ? 'Funcionário atualizado. ' : 'Funcionário admitido. ') + r.aviso, 'erro');
        else ERP.app.aviso(f ? 'Funcionário atualizado.' : 'Funcionário admitido — já pode entrar na próxima folha.', 'ok');
        render();
      } }]
    });

    renderDependentesRows();
    U.el('fn-dep-add').addEventListener('click', function () {
      dependentesAtuais.push({ nome: '', cpf: '', data_nascimento: '' });
      renderDependentesRows();
    });
    montarEditorRateio(f ? ((f.rateio && f.rateio.length) ? f.rateio : [{ centro: f.centro, pct: 100 }]) : [{ centro: 'cc100', pct: 100 }]);
    U.el('fn-pensao-ativa').addEventListener('change', function () {
      U.el('fn-pensao-campos').style.display = this.checked ? 'block' : 'none';
    });
    U.el('fn-credito-ativo').addEventListener('change', function () {
      U.el('fn-credito-campos').style.display = this.checked ? 'block' : 'none';
    });
    /* Botão de cadastrar cargo na hora existia na tela mas nunca teve
       ação nenhuma amarrada — corrigido de caminho, já que este modal
       estava sendo mexido de qualquer jeito. */
    U.el('fn-novo-cargo').addEventListener('click', function () {
      const form = U.el('fn-cargo-form');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });
    U.el('fn-cargo-salvar').addEventListener('click', function () {
      const nome = U.val('fn-cargo-nome');
      if (!nome) return ERP.app.aviso('Informe o nome do cargo.', 'erro');
      const r = S.criarCargo({ nome: nome, cbo: U.val('fn-cargo-cbo'), piso_salarial: U.parseValor(U.val('fn-cargo-piso')) });
      if (r.erro) return ERP.app.aviso(r.erro, 'erro');
      U.el('fn-cargo').innerHTML = opcoesCargo(r.cargo.id);
      U.el('fn-cargo-form').style.display = 'none';
      ERP.app.aviso('Cargo cadastrado.', 'ok');
    });
  }

  function abrirDesligamento(id) {
    const f = D.funcionario(id);
    ERP.app.modal({
      titulo: 'Desligar ' + f.nome,
      fecharTxt: 'Cancelar',
      corpo:
        '<div class="ajuda">Isso só encerra o vínculo no cadastro, sem calcular nada. Pra calcular e lançar ' +
        'as verbas de rescisão, use a aba Rescisão — dá pra fazer isso depois também, mesmo já tendo ' +
        'desligado por aqui (a pessoa continua aparecendo lá até a rescisão ser lançada).</div>' +
        '<label>Data</label><input type="date" id="dg-data" value="' + U.hoje() + '">' +
        '<label>Motivo</label><select id="dg-motivo">' +
          ['Pedido de demissão', 'Dispensa sem justa causa', 'Dispensa por justa causa', 'Término de contrato', 'Acordo (art. 484-A)'].map(function (m) {
            return '<option value="' + m + '">' + m + '</option>'; }).join('') + '</select>',
      acoes: [{ txt: 'Confirmar desligamento (sem calcular verbas)', cls: 'btn-recusar', fn: function () {
        const r = S.desligarFuncionario(id, { data: U.val('dg-data'), motivo: U.val('dg-motivo') });
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        ERP.app.aviso('Funcionário desligado.', 'ok');
        render();
      } }]
    });
  }

  /* ══════════════════ FOLHA ══════════════════ */
  function renderFolha() {
    const box = U.el('dp-aba-folha');
    const comp = U.el('dp-fl-comp') ? U.val('dp-fl-comp') : U.mesAtual();
    /* Horas extras, faltas etc. digitadas numa competência não podem
       sobreviver a trocar de mês na tela — sem isso, HE digitada em
       setembro continuava lá se alguém trocasse pra outubro sem
       fechar setembro antes, e entraria na folha errada se a pessoa
       nem percebesse a troca. */
    if (ajustesFolhaComp !== comp) { ajustesFolha = {}; ajustesFolhaComp = comp; }
    const ativos = S.funcionariosDaFolha(comp);
    const jaFechada = S.folhas({ competencia: comp }).find(function (fl) { return !fl.cancelada; });
    /* Folha já fechada, mas alguém ficou de fora (dados de pagamento
       aprovados depois, rescisão cancelada, admissão retroativa): mostra
       a prévia só dessas pessoas pra fechar uma folha complementar. */
    const fora = jaFechada ? S.funcionariosForaDaFolha(comp) : [];
    modoComplementar = !!(jaFechada && fora.length);

    box.innerHTML =
      '<h2>Folha de pagamento<span class="sub">calcula, revisa e fecha — gera título por funcionário mais as guias</span></h2>' +
      '<div class="filtros"><div class="f"><label for="dp-fl-comp">Competência</label>' +
        '<input type="month" id="dp-fl-comp" value="' + comp + '"></div></div>' +
      (jaFechada ?
        '<div class="ajuda erro">Já existe uma folha fechada para ' + U.fComp(comp) + ' (' + jaFechada.funcionarios +
          ' funcionário(s), líquido ' + U.brl(jaFechada.total_liquido) + '). Cancele antes de refazer, ' +
          'na lista de folhas fechadas abaixo.</div>' +
          (fora.length ? '<div class="ajuda erro" style="margin-top:6px">' + fora.length + ' funcionário(s) ficaram de fora dessa folha: ' +
            fora.map(function (f) { return U.esc(f.nome); }).join(', ') + '. Revise abaixo e feche uma folha complementar.</div>' +
            '<div id="dp-fl-previa"></div>' : '') :
        '<div id="dp-fl-previa"></div>') +
      '<h2 style="margin-top:20px">Folhas fechadas</h2>' +
      '<div id="dp-fl-historico"></div>';

    U.el('dp-fl-comp').addEventListener('change', renderFolha);
    if (!jaFechada) renderPreviaFolha(comp, ativos);
    else if (fora.length) renderPreviaFolha(comp, fora);
    renderHistoricoFolhas();
  }

  function renderPreviaFolha(comp, ativos) {
    const box = U.el('dp-fl-previa');
    if (!ativos.length) { box.innerHTML = '<div class="ajuda">Nenhum funcionário ativo.</div>'; return; }

    let totalLiquido = 0;
    const linhas = ativos.map(function (f) {
      const extras = S.extrasComDiasPadrao(f, comp, ajustesFolha[f.id]);
      const h = S.calcularHolerite(f.id, comp, extras);
      totalLiquido += h.liquido;
      return { f: f, h: h };
    });

    /* Insalubridade/periculosidade, salário-família, pensão e crédito
       do trabalhador aparecem SEMPRE, mesmo zerados — antes só
       apareciam depois de abrir o holerite de cada um, e dava pra
       fechar a folha sem perceber que estavam ausentes. VT e VR viram
       campo editável direto na tabela, junto de HE/faltas, em vez de
       escondidos no "+". */
    box.innerHTML =
      '<table class="parcelas" style="overflow-x:auto;display:block"><thead><tr><th>Funcionário</th><th class="num">Salário base</th>' +
        '<th class="num" style="width:80px">HE 50% (h)</th><th class="num" style="width:80px">HE 100% (h)</th>' +
        '<th class="num" style="width:70px">Faltas (d)</th>' +
        '<th class="num">Insalubridade/Pericul.</th><th class="num">Salário-família</th>' +
        '<th class="num" style="width:100px">Desc. VT (R$)</th><th class="num" style="width:100px">Desc. VR (R$)</th>' +
        '<th class="num">Pensão</th><th class="num">Crédito trab.</th>' +
        '<th class="num">Proventos</th><th class="num">Descontos</th>' +
        '<th class="num">Líquido</th><th></th></tr></thead><tbody>' +
        linhas.map(function (x) {
          const insalPericul = somaCodigos(x.h.proventos, ['105', '106']);
          const vtDesconto = somaCodigos(x.h.descontos, ['903']);
          const vrDesconto = somaCodigos(x.h.descontos, ['907']);
          const pensao = somaCodigos(x.h.descontos, ['904']);
          const credito = somaCodigos(x.h.descontos, ['906']);
          const ajusteAtual = ajustesFolha[x.f.id] || {};
          return '<tr>' +
            '<td>' + U.esc(x.f.nome) + '</td>' +
            '<td class="num">' + U.brl(x.f.salario_base) + '</td>' +
            '<td><input class="num" data-fn="' + x.f.id + '" data-c="he50_horas" inputmode="decimal" min="0" value="' + U.num(ajusteAtual.he50_horas || 0) + '"></td>' +
            '<td><input class="num" data-fn="' + x.f.id + '" data-c="he100_horas" inputmode="decimal" min="0" value="' + U.num(ajusteAtual.he100_horas || 0) + '"></td>' +
            '<td><input class="num" data-fn="' + x.f.id + '" data-c="faltas_dias" inputmode="decimal" min="0" value="' + U.num(ajusteAtual.faltas_dias || 0) + '"></td>' +
            '<td class="num">' + U.brl(insalPericul) + '</td>' +
            '<td class="num">' + U.brl(x.h.salario_familia || 0) + '</td>' +
            (x.f.vale_transporte
              ? '<td><input class="num" data-fn="' + x.f.id + '" data-c="vt_desconto_valor" inputmode="decimal" min="0" value="' + U.num(ajusteAtual.vt_desconto_valor !== undefined ? ajusteAtual.vt_desconto_valor : vtDesconto) + '"></td>'
              : '<td class="num sub">R$ 0,00</td>') +
            (x.f.vale_refeicao
              ? '<td><input class="num" data-fn="' + x.f.id + '" data-c="vr_desconto_valor" inputmode="decimal" min="0" value="' + U.num(ajusteAtual.vr_desconto_valor !== undefined ? ajusteAtual.vr_desconto_valor : vrDesconto) + '"></td>'
              : '<td class="num sub">R$ 0,00</td>') +
            '<td class="num">' + U.brl(pensao) + '</td>' +
            '<td class="num">' + U.brl(credito) + '</td>' +
            '<td class="num">' + U.brl(x.h.total_proventos) + '</td>' +
            '<td class="num">' + U.brl(x.h.total_descontos) + '</td>' +
            '<td class="num"><b>' + U.brl(x.h.liquido) + '</b></td>' +
            '<td><button class="btn-sm" data-ver-holerite="' + x.f.id + '">Ver</button> ' +
              '<button class="btn-sm" data-mais-ajustes="' + x.f.id + '">+</button></td>' +
          '</tr>';
        }).join('') +
      '</tbody></table>' +
      '<div class="dif ok" style="margin-top:8px">Total líquido da folha: ' + U.brl(totalLiquido) + ' · ' + linhas.length + ' funcionário(s)</div>' +
      (podeDP() ? '<button class="btn-linha" id="dp-fechar-folha" style="margin-top:10px">' + (modoComplementar ? 'Fechar folha complementar de ' : 'Fechar folha de ') + U.fComp(comp) + '</button>' : '');

    box.querySelectorAll('input[data-fn]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        const fid = this.dataset.fn, campo = this.dataset.c;
        ajustesFolha[fid] = ajustesFolha[fid] || {};
        ajustesFolha[fid][campo] = U.parseValor(this.value);
        renderPreviaFolha(comp, ativos);
      });
    });
    box.querySelectorAll('[data-ver-holerite]').forEach(function (b) {
      b.addEventListener('click', function () {
        abrirHoleriteDetalhe(linhas.find(function (l) { return l.f.id === b.dataset.verHolerite; }));
      });
    });
    box.querySelectorAll('[data-mais-ajustes]').forEach(function (b) {
      b.addEventListener('click', function () { abrirMaisAjustesFolha(b.dataset.maisAjustes, comp, ativos); });
    });
    if (podeDP() && U.el('dp-fechar-folha')) {
      U.el('dp-fechar-folha').addEventListener('click', function () {
        /* O total mostrado aqui tem que bater com o que REALMENTE vai
           virar título — sem isso, mostrava a soma de todo mundo, mas
           fecharFolha pula quem está com dados de pagamento pendentes
           de aprovação, e o valor lançado de verdade saía bem menor
           que o anunciado, sem aviso nenhum antes de clicar. */
        const pendentes = linhas.filter(function (x) { return x.f.pagamento_aprovado === false; });
        const totalAFechar = Math.round((totalLiquido - pendentes.reduce(function (s, x) { return s + x.h.liquido; }, 0)) * 100) / 100;
        ERP.app.modal({
          titulo: 'Fechar folha de ' + U.fComp(comp),
          fecharTxt: 'Cancelar',
          corpo: '<div class="ajuda">Isso gera um título a pagar por funcionário (' +
              (linhas.length - pendentes.length) + ' no total), mais a guia de FGTS e a guia de INSS/IRRF. ' +
              'Depois de fechada, só dá pra corrigir cancelando e refazendo — não editando.</div>' +
            (pendentes.length
              ? '<div class="ajuda erro" style="margin-top:6px">' + pendentes.length + ' funcionário(s) ficam DE FORA ' +
                'deste fechamento — dados de pagamento ainda pendentes de aprovação: ' +
                pendentes.map(function (x) { return U.esc(x.f.nome); }).join(', ') + '. ' +
                'Aprove antes se quiser incluir na folha, ou feche assim e lance o(s) título(s) dele(s) depois, numa folha à parte.</div>'
              : '') +
            '<div class="dif ok">Total líquido' + (pendentes.length ? ' (só de quem vai entrar)' : '') + ': ' + U.brl(totalAFechar) + '</div>',
          acoes: [{ txt: 'Fechar folha', cls: 'btn-aprovar', fn: function () {
            const r = S.fecharFolha(comp, ajustesFolha, { complementar: modoComplementar });
            if (r.erro) return ERP.app.aviso(r.erro, 'erro');
            ERP.app.fecharModal();
            ajustesFolha = {};
            ERP.app.aviso('Folha de ' + U.fComp(comp) + ' fechada' +
              (r.erros && r.erros.length ? ' — ' + r.erros.length + ' pendência(s): ' + r.erros.join('; ') : '') + '.',
              r.erros && r.erros.length ? 'erro' : 'ok');
            render();
          } }]
        });
      });
    }
  }

  function abrirMaisAjustesFolha(fid, comp, ativos) {
    const f = D.funcionario(fid);
    const atual = ajustesFolha[fid] || {};
    const pensaoCadastro = f.pensao_alimenticia && f.pensao_alimenticia.ativo ? f.pensao_alimenticia : null;
    const temCredito = f.credito_trabalhador && f.credito_trabalhador.ativo;

    ERP.app.modal({
      titulo: 'Mais ajustes — ' + f.nome,
      fecharTxt: 'Cancelar',
      corpo:
        '<div class="row2"><div><label>Horas noturnas (22h-5h)</label><input class="num" id="dp-ma-noturno" inputmode="decimal" value="' + U.num(atual.horas_noturnas || 0) + '"></div>' +
        '<div><label>Gratificação <span class="sub">(valor)</span></label><input class="num" id="dp-ma-grat-valor" inputmode="decimal" value="' + U.num(atual.gratificacao_valor || 0) + '"></div></div>' +
        '<input id="dp-ma-grat-desc" placeholder="Descrição da gratificação (opcional)" value="' + U.esc(atual.gratificacao_descricao || '') + '" style="margin-top:4px">' +
        '<div class="ajuda" style="margin-top:8px">VT e VR ficam direto na tabela da folha, junto de HE e faltas.</div>' +

        (pensaoCadastro
          ? '<div class="ajuda" style="margin-top:10px">Pensão do cadastro: ' + U.brl(pensaoCadastro.valor) +
              ' para ' + U.esc(pensaoCadastro.beneficiario_nome || '(sem nome)') + ' — entra sozinha na folha, não precisa repetir aqui.</div>' +
            '<label><input type="checkbox" id="dp-ma-pensao-alterar"' + (atual.pensao_alimenticia_valor !== undefined ? ' checked' : '') + '> Usar valor diferente da pensão neste mês</label>' +
            '<input class="num" id="dp-ma-pensao-valor" inputmode="decimal" value="' + U.num(atual.pensao_alimenticia_valor !== undefined ? atual.pensao_alimenticia_valor : pensaoCadastro.valor) +
              '" style="margin-top:4px;display:' + (atual.pensao_alimenticia_valor !== undefined ? 'block' : 'none') + '">'
          : '<div class="ajuda" style="margin-top:10px">Sem pensão alimentícia cadastrada pra este funcionário — cadastre em Editar se precisar descontar.</div>') +

        (temCredito
          ? '<div class="ajuda" style="margin-top:10px">Crédito do trabalhador: parcela de ' + U.brl(f.credito_trabalhador.valor_parcela) +
              ' entra sozinha na folha.</div>' +
            '<label><input type="checkbox" id="dp-ma-credito-alterar"' + (atual.credito_trabalhador_valor !== undefined ? ' checked' : '') + '> Usar valor diferente da parcela neste mês <span class="sub">(última parcela, por exemplo)</span></label>' +
            '<input class="num" id="dp-ma-credito-valor" inputmode="decimal" value="' + U.num(atual.credito_trabalhador_valor !== undefined ? atual.credito_trabalhador_valor : f.credito_trabalhador.valor_parcela) +
              '" style="margin-top:4px;display:' + (atual.credito_trabalhador_valor !== undefined ? 'block' : 'none') + '">'
          : ''),
      acoes: [{ txt: 'Aplicar', cls: 'btn-aprovar', fn: function () {
        ajustesFolha[fid] = ajustesFolha[fid] || {};
        ajustesFolha[fid].horas_noturnas = U.parseValor(U.val('dp-ma-noturno'));
        ajustesFolha[fid].gratificacao_valor = U.parseValor(U.val('dp-ma-grat-valor'));
        ajustesFolha[fid].gratificacao_descricao = U.val('dp-ma-grat-desc');
        if (pensaoCadastro && U.el('dp-ma-pensao-alterar').checked) {
          ajustesFolha[fid].pensao_alimenticia_valor = U.parseValor(U.val('dp-ma-pensao-valor'));
        } else {
          delete ajustesFolha[fid].pensao_alimenticia_valor;
        }
        if (temCredito && U.el('dp-ma-credito-alterar').checked) {
          ajustesFolha[fid].credito_trabalhador_valor = U.parseValor(U.val('dp-ma-credito-valor'));
        } else {
          delete ajustesFolha[fid].credito_trabalhador_valor;
        }
        ERP.app.fecharModal();
        renderPreviaFolha(comp, ativos);
      } }]
    });
    if (pensaoCadastro) {
      U.el('dp-ma-pensao-alterar').addEventListener('change', function () {
        U.el('dp-ma-pensao-valor').style.display = this.checked ? 'block' : 'none';
      });
    }
    if (temCredito) {
      U.el('dp-ma-credito-alterar').addEventListener('change', function () {
        U.el('dp-ma-credito-valor').style.display = this.checked ? 'block' : 'none';
      });
    }
  }

  function abrirHoleriteDetalhe(x) {
    if (!x) return;
    const linhaItem = i => '<tr><td>' + U.esc(i.descricao) + '</td><td class="num">' + U.brl(i.valor) + '</td></tr>';
    ERP.app.modal({
      titulo: 'Holerite — ' + x.f.nome + ' (' + U.fComp(x.h.competencia) + ')',
      corpo:
        '<table class="parcelas"><thead><tr><th>Proventos</th><th class="num"></th></tr></thead><tbody>' +
          x.h.proventos.map(linhaItem).join('') +
          '<tr><td><b>Total proventos</b></td><td class="num"><b>' + U.brl(x.h.total_proventos) + '</b></td></tr>' +
        '</tbody></table>' +
        '<table class="parcelas" style="margin-top:10px"><thead><tr><th>Descontos</th><th class="num"></th></tr></thead><tbody>' +
          x.h.descontos.map(linhaItem).join('') +
          '<tr><td><b>Total descontos</b></td><td class="num"><b>' + U.brl(x.h.total_descontos) + '</b></td></tr>' +
        '</tbody></table>' +
        '<div class="dif ok" style="margin-top:10px">Líquido a pagar: ' + U.brl(x.h.liquido) + '</div>' +
        '<div class="ajuda">Base do INSS/FGTS: ' + U.brl(x.h.base_inss) + ' · Base do IRRF (antes de ' +
          'dependentes e pensão): ' + U.brl(x.h.base_irrf) + '</div>' +
        '<div class="ajuda">FGTS do mês (encargo da empresa, não desconta do funcionário): ' + U.brl(x.h.fgts) +
          ' · INSS patronal: ' + U.brl(x.h.inss_patronal) + '</div>',
    });
  }

  function renderHistoricoFolhas() {
    const box = U.el('dp-fl-historico');
    const todas = S.folhas();
    if (!todas.length) { box.innerHTML = '<div class="ajuda">Nenhuma folha fechada ainda.</div>'; return; }
    box.innerHTML = '<table class="parcelas"><thead><tr><th>Competência</th><th class="num">Funcionários</th>' +
      '<th class="num">Líquido</th><th class="num">FGTS</th><th class="num">INSS+IRRF</th><th>Situação</th><th></th></tr></thead><tbody>' +
      todas.map(function (fl) {
        return '<tr>' +
          '<td>' + U.fComp(fl.competencia) + '</td>' +
          '<td class="num">' + fl.funcionarios + '</td>' +
          '<td class="num">' + U.brl(fl.total_liquido) + '</td>' +
          '<td class="num">' + U.brl(fl.total_fgts) + '</td>' +
          '<td class="num">' + U.brl(fl.total_inss + fl.total_irrf) + '</td>' +
          '<td>' + (fl.cancelada ? '<span class="badge b-cancelado">cancelada</span>' :
            fl.cancelada_parcial ? '<span class="badge b-aguardando">cancelada em parte</span>' :
            '<span class="badge b-pago">fechada</span>') + '</td>' +
          '<td><button class="btn-sm" data-ver-folha="' + fl.id + '">Ver</button> ' +
            (!fl.cancelada && podeDP() ? '<button class="btn-sm" data-cancelar-folha="' + fl.id + '">Cancelar</button>' : '') + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
    box.querySelectorAll('[data-cancelar-folha]').forEach(function (b) {
      b.addEventListener('click', function () { abrirCancelarFolha(this.dataset.cancelarFolha); });
    });
    box.querySelectorAll('[data-ver-folha]').forEach(function (b) {
      b.addEventListener('click', function () { abrirDetalheFolha(this.dataset.verFolha); });
    });
  }

  function abrirDetalheFolha(id) {
    const fl = S.folhas().find(function (x) { return x.id === id; });
    if (!fl) return;
    const linhas = (fl.holerites || []).map(function (h) { return { f: D.funcionario(h.funcionario) || { nome: '(funcionário removido)' }, h: h }; });
    ERP.app.modal({
      titulo: 'Folha de ' + U.fComp(fl.competencia) +
        (fl.cancelada ? ' — cancelada' : fl.cancelada_parcial ? ' — cancelada em parte' : ''),
      corpo:
        '<table class="parcelas"><thead><tr><th>Funcionário</th><th class="num">Proventos</th>' +
          '<th class="num">Descontos</th><th class="num">Líquido</th><th></th></tr></thead><tbody>' +
          linhas.map(function (x) {
            return '<tr><td>' + U.esc(x.f.nome) + '</td>' +
              '<td class="num">' + U.brl(x.h.total_proventos) + '</td>' +
              '<td class="num">' + U.brl(x.h.total_descontos) + '</td>' +
              '<td class="num">' + U.brl(x.h.liquido) + '</td>' +
              '<td><button class="btn-sm" data-ver-holerite-fl="' + x.f.id + '">Holerite</button></td></tr>';
          }).join('') +
          '<tr><td><b>Total</b></td><td></td><td></td><td class="num"><b>' + U.brl(fl.total_liquido) + '</b></td><td></td></tr>' +
        '</tbody></table>' +
        '<div class="ajuda" style="margin-top:8px">FGTS ' + U.brl(fl.total_fgts) + ' · INSS retido ' + U.brl(fl.total_inss) +
          ' · IRRF ' + U.brl(fl.total_irrf) + ' · INSS patronal ' + U.brl(fl.total_inss_patronal || 0) +
          ' — fechada por ' + U.esc(fl.criado_por) + ' em ' +
          U.fData(new Date(fl.criado_em).toISOString().slice(0, 10)) + '.' +
          (fl.cancelada || fl.cancelada_parcial ? ' Motivo do cancelamento: ' + U.esc(fl.motivo_cancelamento || '') : '') + '</div>',
    });
    document.querySelectorAll('[data-ver-holerite-fl]').forEach(function (b) {
      b.addEventListener('click', function () {
        abrirHoleriteDetalhe(linhas.find(function (l) { return l.f.id === b.dataset.verHoleriteFl; }));
      });
    });
  }

  function abrirCancelarFolha(id) {
    ERP.app.modal({
      titulo: 'Cancelar folha',
      fecharTxt: 'Voltar',
      corpo: '<label>Motivo</label><textarea id="dp-cf-motivo" rows="2"></textarea>',
      acoes: [{ txt: 'Cancelar folha', cls: 'btn-recusar', fn: function () {
        const motivo = U.val('dp-cf-motivo');
        if (!motivo) return ERP.app.aviso('Informe o motivo.', 'erro');
        let r = S.cancelarFolha(id, motivo, false);
        if (r.erro && r.jaPagas) {
          if (!confirm(r.erro + '\n\nForçar cancelamento parcial mesmo assim?')) return;
          r = S.cancelarFolha(id, motivo, true);
        }
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        ERP.app.aviso('Folha cancelada.', 'ok');
        render();
      } }]
    });
  }

  /* ══════════════════ 13º SALÁRIO ══════════════════ */
  function renderDecimo() {
    const box = U.el('dp-aba-decimo');
    const ano = U.el('dp-13-ano') ? U.val('dp-13-ano') : String(new Date().getUTCFullYear());
    const fechada1 = S.decimos({ ano: ano }).find(function (d) { return d.parcela === 1 && !d.cancelado; });
    const fechada2 = S.decimos({ ano: ano }).find(function (d) { return d.parcela === 2 && !d.cancelado; });

    box.innerHTML =
      '<h2>13º salário<span class="sub">1ª parcela até 30/11, sem desconto — 2ª até 20/12, com INSS e IRRF sobre o total</span></h2>' +
      '<div class="filtros"><div class="f"><label for="dp-13-ano">Ano</label>' +
        '<input class="num" id="dp-13-ano" inputmode="numeric" value="' + ano + '"></div></div>' +
      '<div class="row2" style="margin-top:8px">' +
        '<div>' + (fechada1
          ? '<div class="ajuda">1ª parcela de ' + ano + ' já fechada — vencimento ' + U.fData(ano + '-11-30') + ', ' +
            fechada1.funcionarios + ' funcionário(s), ' + U.brl(fechada1.total_liquido) +
            ' <button class="btn-sm" data-ver-13="' + fechada1.id + '" style="margin-left:6px">Ver detalhe</button></div>'
          : '<div id="dp-13-previa-1"></div>') + '</div>' +
        '<div>' + (fechada2
          ? '<div class="ajuda">2ª parcela de ' + ano + ' já fechada — vencimento ' + U.fData(ano + '-12-20') + ', ' +
            fechada2.funcionarios + ' funcionário(s), ' + U.brl(fechada2.total_liquido) +
            ' <button class="btn-sm" data-ver-13="' + fechada2.id + '" style="margin-left:6px">Ver detalhe</button></div>'
          : fechada1
            ? '<div id="dp-13-previa-2"></div>'
            : '<div class="ajuda">Feche a 1ª parcela antes de calcular a 2ª.</div>') + '</div>' +
      '</div>' +
      '<h2 style="margin-top:20px">Fechamentos</h2>' +
      '<div id="dp-13-historico"></div>';

    U.el('dp-13-ano').addEventListener('change', renderDecimo);
    if (!fechada1) renderPrevia13(ano, 1, 'dp-13-previa-1');
    if (fechada1 && !fechada2) renderPrevia13(ano, 2, 'dp-13-previa-2');
    renderHistorico13();
    box.querySelectorAll('[data-ver-13]').forEach(function (b) {
      b.addEventListener('click', function () { abrirDetalhe13(this.dataset.ver13); });
    });
  }

  function renderPrevia13(ano, parcela, idBox) {
    const box = U.el(idBox);
    const ativos = D.funcionarios.filter(function (f) { return f.ativo && f.admissao <= (ano + '-12-31'); });
    if (!ativos.length) { box.innerHTML = '<div class="ajuda">Nenhum funcionário ativo neste ano.</div>'; return; }
    let totalLiquido = 0;
    const linhas = ativos.map(function (f) {
      const calc = S.calcular13(f.id, ano, parcela);
      totalLiquido += calc.liquido;
      return { f: f, calc: calc };
    });
    box.innerHTML =
      '<h3 style="font-size:12px;margin:0 0 6px">' + (parcela === 1 ? '1ª parcela' : '2ª parcela') + '</h3>' +
      '<table class="parcelas"><thead><tr><th>Funcionário</th><th class="num">Avos</th>' +
        (parcela === 2 ? '<th class="num">INSS</th><th class="num">IRRF</th><th class="num">Pensão</th>' : '') +
        '<th class="num">Líquido</th></tr></thead><tbody>' +
        linhas.map(function (x) {
          return '<tr><td>' + U.esc(x.f.nome) + '</td><td class="num">' + x.calc.avos + '/12</td>' +
            (parcela === 2 ? '<td class="num">−' + U.brl(x.calc.valor_inss) + '</td><td class="num">−' + U.brl(x.calc.valor_irrf) +
              '</td><td class="num">' + U.brl(x.calc.pensao_alimenticia || 0) + '</td>' : '') +
            '<td class="num">' + U.brl(x.calc.liquido) + '</td></tr>';
        }).join('') +
      '</tbody></table>' +
      '<div class="dif ok" style="margin-top:8px">Total: ' + U.brl(Math.round(totalLiquido * 100) / 100) + '</div>' +
      (podeDP() ? '<button class="btn-linha" id="dp-13-fechar-' + parcela + '" style="margin-top:10px">Fechar ' +
        (parcela === 1 ? '1ª' : '2ª') + ' parcela</button>' : '');
    if (U.el('dp-13-fechar-' + parcela)) {
      U.el('dp-13-fechar-' + parcela).addEventListener('click', function () {
        if (!confirm('Fechar a ' + (parcela === 1 ? '1ª' : '2ª') + ' parcela do 13º de ' + ano + '? Total: ' +
            U.brl(Math.round(totalLiquido * 100) / 100))) return;
        const r = S.fechar13(ano, parcela);
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.aviso((parcela === 1 ? '1ª' : '2ª') + ' parcela do 13º fechada' +
          (r.erros && r.erros.length ? ' — ' + r.erros.length + ' pendência(s): ' + r.erros.join('; ') : '') + '.',
          r.erros && r.erros.length ? 'erro' : 'ok');
        render();
      });
    }
  }

  function renderHistorico13() {
    const box = U.el('dp-13-historico');
    const todos = S.decimos();
    if (!todos.length) { box.innerHTML = '<div class="ajuda">Nenhum 13º fechado ainda.</div>'; return; }
    box.innerHTML = '<table class="parcelas"><thead><tr><th>Ano</th><th>Parcela</th><th class="num">Funcionários</th>' +
      '<th class="num">Líquido</th><th class="num">INSS</th><th class="num">IRRF</th><th>Situação</th><th></th></tr></thead><tbody>' +
      todos.map(function (d) {
        return '<tr><td>' + U.esc(d.ano) + '</td><td>' + d.parcela + 'ª</td>' +
          '<td class="num">' + d.funcionarios + '</td>' +
          '<td class="num">' + U.brl(d.total_liquido) + '</td>' +
          '<td class="num">' + U.brl(d.total_inss) + '</td>' +
          '<td class="num">' + U.brl(d.total_irrf) + '</td>' +
          '<td>' + (d.cancelado ? '<span class="badge b-cancelado">cancelada</span>' :
            d.cancelado_parcial ? '<span class="badge b-aguardando">cancelada em parte</span>' :
            '<span class="badge b-pago">fechada</span>') + '</td>' +
          '<td><button class="btn-sm" data-ver-13="' + d.id + '">Ver</button> ' +
            (!d.cancelado && podeDP() ? '<button class="btn-sm" data-cancelar-13="' + d.id + '">Cancelar</button>' : '') + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
    box.querySelectorAll('[data-cancelar-13]').forEach(function (b) {
      b.addEventListener('click', function () { abrirCancelar13(this.dataset.cancelar13); });
    });
    box.querySelectorAll('[data-ver-13]').forEach(function (b) {
      b.addEventListener('click', function () { abrirDetalhe13(this.dataset.ver13); });
    });
  }

  function abrirDetalhe13(id) {
    const d = S.decimos().find(function (x) { return x.id === id; });
    if (!d) return;
    // usa o vencimento real do título (já antecipado se caiu em fim de semana), não recalcula
    const primeiraParcela = (d.titulo_ids || []).map(function (tid) {
      return (S.todasParcelas() || []).find(function (p) { return p.titulo_id === tid; });
    }).find(Boolean);
    const venc = primeiraParcela ? primeiraParcela.venc : (d.parcela === 1 ? d.ano + '-11-30' : d.ano + '-12-20');
    const linhas = (d.calculos || []).map(function (c) { return { f: D.funcionario(c.funcionario) || { nome: '(funcionário removido)' }, c: c }; });
    ERP.app.modal({
      titulo: d.parcela + 'ª parcela do 13º de ' + d.ano + (d.cancelado ? ' — cancelada' : d.cancelado_parcial ? ' — cancelada em parte' : ''),
      corpo:
        '<table class="parcelas"><thead><tr><th>Funcionário</th><th class="num">Avos</th>' +
          (d.parcela === 2 ? '<th class="num">INSS</th><th class="num">IRRF</th>' : '') +
          '<th class="num">Líquido</th></tr></thead><tbody>' +
          linhas.map(function (x) {
            return '<tr><td>' + U.esc(x.f.nome) + '</td><td class="num">' + x.c.avos + '/12</td>' +
              (d.parcela === 2 ? '<td class="num">−' + U.brl(x.c.valor_inss) + '</td><td class="num">−' + U.brl(x.c.valor_irrf) + '</td>' : '') +
              '<td class="num">' + U.brl(x.c.liquido) + '</td></tr>';
          }).join('') +
          '<tr><td><b>Total</b></td><td></td>' + (d.parcela === 2 ? '<td></td><td></td>' : '') +
            '<td class="num"><b>' + U.brl(d.total_liquido) + '</b></td></tr>' +
        '</tbody></table>' +
        '<div class="ajuda" style="margin-top:8px">Vencimento ' + U.fData(venc) + ' · INSS retido ' + U.brl(d.total_inss) +
          ' · IRRF ' + U.brl(d.total_irrf) +
          (d.total_fgts ? ' · FGTS ' + U.brl(d.total_fgts) : '') +
          (d.total_inss_patronal ? ' · INSS patronal ' + U.brl(d.total_inss_patronal) : '') +
          ' — fechada por ' + U.esc(d.criado_por) + ' em ' +
          U.fData(new Date(d.criado_em).toISOString().slice(0, 10)) + '.' +
          (d.cancelado || d.cancelado_parcial ? ' Motivo do cancelamento: ' + U.esc(d.motivo_cancelamento || '') : '') + '</div>',
    });
  }

  function abrirCancelar13(id) {
    ERP.app.modal({
      titulo: 'Cancelar parcela do 13º',
      fecharTxt: 'Voltar',
      corpo: '<label>Motivo</label><textarea id="dp-c13-motivo" rows="2"></textarea>',
      acoes: [{ txt: 'Cancelar parcela', cls: 'btn-recusar', fn: function () {
        const motivo = U.val('dp-c13-motivo');
        if (!motivo) return ERP.app.aviso('Informe o motivo.', 'erro');
        let r = S.cancelar13(id, motivo, false);
        if (r.erro && r.jaPagas) {
          if (!confirm(r.erro + '\n\nForçar cancelamento parcial mesmo assim?')) return;
          r = S.cancelar13(id, motivo, true);
        }
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        ERP.app.aviso('Parcela cancelada.', 'ok');
        render();
      } }]
    });
  }

  /* ══════════════════ FÉRIAS ══════════════════ */
  function renderFerias() {
    const box = U.el('dp-aba-ferias');
    const situacao = S.situacaoFerias();

    const ROTULO = {
      vencida: { txt: 'Vencida', badge: 'b-reprovado' },
      urgente: { txt: 'Urgente', badge: 'b-reprovado' },
      atencao: { txt: 'Atenção', badge: 'b-aguardando' },
      em_dia: { txt: 'Em dia', badge: 'b-pago' },
      sem_pendencia: { txt: 'Sem férias pendentes', badge: 'b-cancelado' }
    };

    box.innerHTML =
      '<h2>Férias<span class="sub">quem tem férias pra tirar, o limite pra gozar e quem já venceu</span></h2>' +
      '<table class="parcelas"><thead><tr><th>Funcionário</th><th>Período aquisitivo</th>' +
        '<th class="num">Dias a gozar</th><th>Limite pra gozar</th><th>Situação</th><th></th></tr></thead><tbody>' +
        situacao.map(function (s) {
          const rot = ROTULO[s.situacao];
          const per = s.periodo;
          return '<tr>' +
            '<td>' + U.esc(s.funcionario.nome) + '</td>' +
            '<td>' + (per ? U.fData(per.aquisitivo_inicio) + ' a ' + U.fData(per.aquisitivo_fim) : '—') + '</td>' +
            '<td class="num">' + (per ? s.dias_restantes : '—') + '</td>' +
            '<td>' + (per ? U.fData(per.limite) : '—') +
              (s.dias_ate_limite !== null && s.dias_ate_limite >= 0
                ? ' <span class="sub">(' + s.dias_ate_limite + 'd)</span>'
                : s.dias_ate_limite !== null
                  ? ' <span class="sub">(vencida há ' + Math.abs(s.dias_ate_limite) + 'd)</span>' : '') + '</td>' +
            '<td><span class="badge ' + rot.badge + '">' + rot.txt + '</span></td>' +
            '<td>' + (per && podeDP() ? '<button class="btn-sm" data-lancar-ferias="' + s.funcionario.id + '">Lançar férias</button>' : '') + '</td>' +
          '</tr>';
        }).join('') +
      '</tbody></table>' +
      '<div class="ajuda" style="margin-top:8px">Vencida ou Urgente: limite em 30 dias ou já passou — risco de pagar em dobro se ' +
        'não gozar a tempo. Atenção: vence em até 60 dias.</div>' +
      '<h2 style="margin-top:20px">Férias já lançadas</h2>' +
      '<div id="dp-fe-historico"></div>';

    box.querySelectorAll('[data-lancar-ferias]').forEach(function (b) {
      b.addEventListener('click', function () { abrirCalculoFerias(this.dataset.lancarFerias); });
    });
    renderHistoricoFerias();
  }

  /* Todo gozo já lançado, de qualquer funcionário, mais recente
     primeiro — sem isso, um lançamento errado (data errada, dias
     errados) não tinha jeito de desfazer: só dava pra "corrigir"
     lançando outro por cima, sem nunca cancelar o primeiro. */
  function renderHistoricoFerias() {
    const box = U.el('dp-fe-historico');
    if (!box) return;
    const linhas = [];
    D.funcionarios.forEach(function (f) {
      (f.ferias || []).forEach(function (per) {
        (per.gozos || []).forEach(function (g) {
          linhas.push({ f: f, per: per, g: g });
        });
      });
    });
    linhas.sort(function (a, b) { return b.g.data_inicio.localeCompare(a.g.data_inicio); });
    if (!linhas.length) { box.innerHTML = '<div class="ajuda">Nenhuma férias lançada ainda.</div>'; return; }
    box.innerHTML = '<table class="parcelas"><thead><tr><th>Funcionário</th><th>Início</th>' +
      '<th class="num">Dias</th><th class="num">Abono</th><th>Situação</th><th></th></tr></thead><tbody>' +
      linhas.map(function (x) {
        return '<tr>' +
          '<td>' + U.esc(x.f.nome) + '</td>' +
          '<td>' + U.fData(x.g.data_inicio) + '</td>' +
          '<td class="num">' + x.g.dias_gozo + '</td>' +
          '<td class="num">' + (x.g.dias_abono || 0) + '</td>' +
          '<td>' + (x.g.cancelado ? '<span class="badge b-cancelado">cancelada</span>' : '<span class="badge b-pago">lançada</span>') + '</td>' +
          '<td>' + (!x.g.cancelado && podeDP() ? '<button class="btn-sm" data-cancelar-ferias="' + x.f.id + '|' + x.g.data_inicio + '">Cancelar</button>' : '') + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
    box.querySelectorAll('[data-cancelar-ferias]').forEach(function (b) {
      b.addEventListener('click', function () {
        const partes = this.dataset.cancelarFerias.split('|');
        abrirCancelarFerias(partes[0], partes[1]);
      });
    });
  }

  function abrirCancelarFerias(fid, dataInicio) {
    const f = D.funcionario(fid);
    ERP.app.modal({
      titulo: 'Cancelar férias — ' + f.nome + ' (' + U.fData(dataInicio) + ')',
      fecharTxt: 'Voltar',
      corpo: '<label>Motivo</label><textarea id="dp-fe-cancel-motivo" rows="2"></textarea>' +
        '<div class="ajuda">Cancela o líquido pago e as guias de encargos desta férias, e devolve os dias ao período — dá pra lançar de novo com os dados certos.</div>',
      acoes: [{ txt: 'Cancelar férias', cls: 'btn-recusar', fn: function () {
        const motivo = U.val('dp-fe-cancel-motivo');
        if (!motivo) return ERP.app.aviso('Informe o motivo.', 'erro');
        let r = S.cancelarFerias(fid, dataInicio, motivo, false);
        if (r.erro && r.jaPagas) {
          if (!confirm(r.erro + '\n\nForçar o cancelamento mesmo assim?')) return;
          r = S.cancelarFerias(fid, dataInicio, motivo, true);
        }
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        ERP.app.aviso('Férias cancelada' + (r.cancelado_completo ? '' : ' em parte (havia pagamento já registrado)') + '.', 'ok');
        renderFerias();
      } }]
    });
  }

  function abrirCalculoFerias(fid) {
    const f = D.funcionario(fid);
    ERP.app.modal({
      titulo: 'Calcular férias — ' + f.nome,
      corpo:
        '<div class="row3"><div><label>Dias de gozo</label><input class="num" id="dp-fe-dias" inputmode="numeric" value="30"></div>' +
        '<div><label>Dias de abono <span class="sub">(venda, máx. 10)</span></label><input class="num" id="dp-fe-abono" inputmode="numeric" value="0"></div>' +
        '<div><label>Início</label><input type="date" id="dp-fe-inicio" value="' + U.addDias(U.hoje(), 30) + '"></div></div>' +
        '<button class="btn-sm" id="dp-fe-calcular" style="margin-top:8px">Calcular</button>' +
        '<div id="dp-fe-resultado"></div>',
    });
    /* Mudou qualquer campo depois de já ter calculado? O resultado
       antigo (e o botão de lançar, que carrega ele) some — só volta
       depois de clicar em Calcular de novo. Antes dava pra mudar de
       14 pra 5 dias e lançar o de 14 sem perceber. */
    ['dp-fe-dias', 'dp-fe-abono', 'dp-fe-inicio'].forEach(function (id) {
      U.el(id).addEventListener('input', function () { U.el('dp-fe-resultado').innerHTML = ''; });
    });
    U.el('dp-fe-calcular').addEventListener('click', function () {
      const dias = U.parseValor(U.val('dp-fe-dias'));
      const abono = U.parseValor(U.val('dp-fe-abono'));
      const inicio = U.val('dp-fe-inicio');
      const calc = S.calcularFerias(fid, dias, inicio, abono);
      if (calc.erro) return ERP.app.aviso(calc.erro, 'erro');
      renderResultadoFerias(fid, calc, inicio);
    });
  }

  function renderResultadoFerias(fid, calc, inicio) {
    U.el('dp-fe-resultado').innerHTML =
      (calc.vencida ? '<div class="ajuda erro">Período vencido — pago em dobro (art. 137 da CLT).</div>' : '') +
      '<table class="parcelas" style="margin-top:12px"><tbody>' +
        '<tr><td>Férias (' + calc.dias_gozo + ' dias' + (calc.vencida ? ', em dobro' : '') + ')</td><td class="num">' + U.brl(calc.valor_ferias) + '</td></tr>' +
        '<tr><td>1/3 constitucional</td><td class="num">' + U.brl(calc.terco_constitucional) + '</td></tr>' +
        '<tr><td>INSS</td><td class="num">−' + U.brl(calc.valor_inss) + '</td></tr>' +
        '<tr><td>IRRF</td><td class="num">−' + U.brl(calc.valor_irrf) + '</td></tr>' +
        (calc.pensao_alimenticia ? '<tr><td>Pensão alimentícia</td><td class="num">−' + U.brl(calc.pensao_alimenticia) + '</td></tr>' : '') +
        '<tr><td>Líquido das férias</td><td class="num">' + U.brl(calc.liquido) + '</td></tr>' +
        (calc.dias_abono ? '<tr><td>Abono pecuniário (' + calc.dias_abono + ' dias, isento) + 1/3</td><td class="num">' + U.brl(calc.total_abono) + '</td></tr>' : '') +
        '<tr><td><b>Total a pagar</b></td><td class="num"><b>' + U.brl(calc.total_pagar) + '</b></td></tr>' +
      '</tbody></table>' +
      (podeDP() ? '<button class="btn-linha" id="dp-fe-lancar" style="margin-top:10px">Lançar férias</button>' : '');
    if (U.el('dp-fe-lancar')) {
      U.el('dp-fe-lancar').addEventListener('click', function () {
        const r = S.lancarFerias(fid, calc, inicio);
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        ERP.app.aviso('Férias lançadas — entrou como previsão em Contas a Pagar.', 'ok');
        render();
      });
    }
  }

  /* ══════════════════ RESCISÃO ══════════════════ */
  function renderRescisao() {
    const box = U.el('dp-aba-rescisao');
    const candidatos = S.funcionariosParaRescisao();
    box.innerHTML =
      '<h2>Rescisão<span class="sub">o motivo decide o que é devido — troque e recalcule antes de decidir</span></h2>' +
      '<div class="filtros">' +
        '<div class="f"><label for="dp-rc-func">Funcionário</label><select id="dp-rc-func">' +
          '<option value="">Escolher…</option>' +
          candidatos.map(function (f) {
            return '<option value="' + f.id + '">' + U.esc(f.nome) + (!f.ativo ? ' (já desligado, sem verbas lançadas)' : '') + '</option>';
          }).join('') +
        '</select></div>' +
        '<div class="f"><label for="dp-rc-data">Data</label><input type="date" id="dp-rc-data" value="' + U.hoje() + '"></div>' +
        '<div class="f"><label for="dp-rc-tipo">Quem tomou a decisão</label><select id="dp-rc-tipo">' +
          Object.keys(S.TIPOS_RESCISAO).map(function (t) {
            return '<option value="' + t + '">' + U.esc(S.TIPOS_RESCISAO[t].nome) + '</option>'; }).join('') +
        '</select></div>' +
        '<button class="btn-sm" id="dp-rc-calcular">Calcular</button>' +
      '</div>' +
      '<div id="dp-rc-opcoes"></div>' +
      '<h3 style="font-size:12px;margin:10px 0 4px">Horas pendentes de pagar no saldo do mês (opcional)</h3>' +
      '<div class="row3"><div><label>HE 50% (h)</label><input class="num" id="dp-rc-he50" inputmode="decimal" value="0"></div>' +
        '<div><label>HE 100% (h)</label><input class="num" id="dp-rc-he100" inputmode="decimal" value="0"></div>' +
        '<div><label>Noturnas (h)</label><input class="num" id="dp-rc-noturno" inputmode="decimal" value="0"></div></div>' +
      '<div class="ajuda">Só preencha se houver hora extra ou adicional noturno ainda não pago do mês da saída — o DSR sobre elas entra sozinho no cálculo.</div>' +
      '<h3 style="font-size:12px;margin:10px 0 4px">Gratificação e VT/VR do mês (opcional)</h3>' +
      '<div class="row3"><div><label>Gratificação (valor)</label><input class="num" id="dp-rc-grat" inputmode="decimal" value="0"></div>' +
        '<div><label>Desconto de VT (R$) <span class="sub">deixe em branco pra usar o cadastro</span></label><input class="num" id="dp-rc-vt" inputmode="decimal" placeholder="cadastro"></div>' +
        '<div><label>Desconto de VR (R$) <span class="sub">deixe em branco pra usar o cadastro</span></label><input class="num" id="dp-rc-vr" inputmode="decimal" placeholder="cadastro"></div></div>' +
      '<div class="ajuda">Pensão alimentícia e salário-família vêm sozinhos do cadastro — aparecem no resultado abaixo.</div>' +
      '<div class="ajuda">Só desliga o funcionário quando você clicar em "Confirmar rescisão" no resultado — ' +
        'calcular aqui é só uma prévia, dá pra rodar antes mesmo de decidir demitir.</div>' +
      '<div id="dp-rc-resultado"></div>' +
      '<h2 style="margin-top:20px">Rescisões já lançadas</h2>' +
      '<div id="dp-rc-historico"></div>';

    renderOpcoesRescisao();
    U.el('dp-rc-tipo').addEventListener('change', renderOpcoesRescisao);
    U.el('dp-rc-calcular').addEventListener('click', calcularEExibirRescisao);
    /* Selecionou alguém já desligado (sem verbas lançadas)? Usa a data
       que aquele desligamento já tinha, não hoje — senão a rescisão
       calcula com uma data errada, diferente da que já está no
       cadastro do funcionário. */
    U.el('dp-rc-func').addEventListener('change', function () {
      const f = D.funcionario(this.value);
      if (f && !f.ativo && f.desligado_em) U.el('dp-rc-data').value = f.desligado_em;
    });
    renderHistoricoRescisoes();
  }

  /* Toda rescisão já lançada (o título PRINCIPAL de cada uma —
     origem_ref 'rescisao-<id>', não as guias que ele gera junto),
     mais recente primeiro. Sem cancelar, uma rescisão calculada com
     data ou verba errada não tinha volta: o funcionário ficava
     desligado pra sempre com um valor errado nas contas a pagar. */
  function renderHistoricoRescisoes() {
    const box = U.el('dp-rc-historico');
    if (!box) return;
    const linhas = D.funcionarios.map(function (f) {
      const t = S.st.titulos.find(function (x) { return x.origem === 'rescisao' && x.origem_ref === 'rescisao-' + f.id; });
      return t ? { f: f, t: t } : null;
    }).filter(Boolean).sort(function (a, b) { return b.t.emissao.localeCompare(a.t.emissao); });
    if (!linhas.length) { box.innerHTML = '<div class="ajuda">Nenhuma rescisão lançada ainda.</div>'; return; }
    box.innerHTML = '<table class="parcelas"><thead><tr><th>Funcionário</th><th>Data</th><th>Motivo</th>' +
      '<th class="num">Líquido</th><th>Situação</th><th></th></tr></thead><tbody>' +
      linhas.map(function (x) {
        const parcela = S.st.parcelas.find(function (p) { return p.titulo_id === x.t.id; });
        const cancelada = parcela && parcela.status === 'cancelado';
        return '<tr>' +
          '<td>' + U.esc(x.f.nome) + '</td>' +
          '<td>' + U.fData(x.t.emissao) + '</td>' +
          '<td>' + U.esc(x.t.descricao.replace('Rescisão — ' + x.f.nome + ' (', '').replace(/\)$/, '')) + '</td>' +
          '<td class="num">' + U.brl(x.t.valor_total) + '</td>' +
          '<td>' + (cancelada ? '<span class="badge b-cancelado">cancelada</span>' : '<span class="badge b-pago">lançada</span>') + '</td>' +
          '<td>' + (!cancelada && podeDP() ? '<button class="btn-sm" data-cancelar-rescisao="' + x.f.id + '">Cancelar</button>' : '') + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
    box.querySelectorAll('[data-cancelar-rescisao]').forEach(function (b) {
      b.addEventListener('click', function () { abrirCancelarRescisao(this.dataset.cancelarRescisao); });
    });
  }

  function abrirCancelarRescisao(fid) {
    const f = D.funcionario(fid);
    ERP.app.modal({
      titulo: 'Cancelar rescisão — ' + f.nome,
      fecharTxt: 'Voltar',
      corpo: '<label>Motivo</label><textarea id="dp-rc-cancel-motivo" rows="2"></textarea>' +
        '<div class="ajuda">Cancela o líquido pago e todas as guias desta rescisão (INSS/IRRF, FGTS, pensão, ' +
          'crédito do trabalhador) e reativa ' + U.esc(f.nome) + ' — dá pra lançar uma rescisão nova com os dados certos.</div>',
      acoes: [{ txt: 'Cancelar rescisão', cls: 'btn-recusar', fn: function () {
        const motivo = U.val('dp-rc-cancel-motivo');
        if (!motivo) return ERP.app.aviso('Informe o motivo.', 'erro');
        let r = S.cancelarRescisao(fid, motivo, false);
        if (r.erro && r.jaPagas) {
          if (!confirm(r.erro + '\n\nForçar o cancelamento mesmo assim?')) return;
          r = S.cancelarRescisao(fid, motivo, true);
        }
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.fecharModal();
        ERP.app.aviso('Rescisão cancelada' + (r.cancelado_completo ? ' — ' + f.nome + ' está ativo de novo.' : ' em parte (havia pagamento já registrado).') +
          (r.aviso ? ' ' + r.aviso : ''), r.aviso ? 'erro' : 'ok');
        renderRescisao();
      } }]
    });
  }

  function renderOpcoesRescisao() {
    const tipo = U.val('dp-rc-tipo');
    const box = U.el('dp-rc-opcoes');
    if (tipo === 'sem_justa_causa') {
      box.innerHTML = '<div class="f"><label><input type="checkbox" id="dp-rc-aviso" checked> Aviso prévio indenizado (a empresa paga por não avisar com antecedência)</label></div>';
    } else if (tipo === 'acordo') {
      box.innerHTML = '<div class="f"><label><input type="checkbox" id="dp-rc-aviso" checked> Aviso prévio indenizado</label></div>' +
        '<div class="ajuda">Acordo (art. 484-A): aviso e multa de FGTS pela metade do que seria numa dispensa sem justa causa. Férias e 13º proporcionais continuam integrais.</div>';
    } else if (tipo === 'pedido_demissao') {
      box.innerHTML = '<div class="f"><label><input type="checkbox" id="dp-rc-aviso-cumprido" checked> Funcionário cumpriu o aviso prévio de 30 dias</label></div>' +
        '<div class="ajuda">Se não marcar, desconta o equivalente a 1 salário do total — é a empresa quem tem o direito de descontar, não o contrário.</div>';
    } else if (tipo === 'termino_experiencia') {
      box.innerHTML = '<div class="f"><label>Data prevista de término do contrato <span class="sub">(deixe em branco se é o fim natural do prazo)</span></label>' +
        '<input type="date" id="dp-rc-fim-previsto"></div>' +
        '<div class="ajuda">Sem data prevista (ou desligando depois dela): fim natural do prazo — sem aviso prévio, sem multa de FGTS, férias e 13º proporcionais normais. Com uma data prevista e desligando ANTES dela: rescisão antecipada, indenização de metade dos dias restantes (art. 479 CLT), em cima do resto.</div>';
    } else if (tipo === 'rescisao_indireta') {
      box.innerHTML = '<div class="f"><label><input type="checkbox" id="dp-rc-aviso" checked> Aviso prévio indenizado</label></div>' +
        '<div class="ajuda">Rescisão indireta (art. 483): mesmos direitos de uma dispensa sem justa causa — muda só a justificativa jurídica, não a conta.</div>';
    } else {
      box.innerHTML = '<div class="ajuda">Justa causa não tem aviso prévio, não tem multa de FGTS e não tem 13º nem férias proporcionais — só o que já era direito adquirido (saldo de salário e férias vencidas, se houver).</div>';
    }
  }

  function calcularEExibirRescisao() {
    const fid = U.val('dp-rc-func');
    if (!fid) return ERP.app.aviso('Escolha o funcionário.', 'erro');
    const tipo = U.val('dp-rc-tipo');
    const data = U.val('dp-rc-data');
    const opcoes = { tipo: tipo };
    if (tipo === 'sem_justa_causa' || tipo === 'acordo' || tipo === 'rescisao_indireta') opcoes.avisoIndenizado = U.el('dp-rc-aviso').checked;
    if (tipo === 'pedido_demissao') opcoes.avisoCumprido = U.el('dp-rc-aviso-cumprido').checked;
    if (tipo === 'termino_experiencia' && U.val('dp-rc-fim-previsto')) opcoes.dataFimPrevista = U.val('dp-rc-fim-previsto');
    opcoes.he50_horas = U.parseValor(U.val('dp-rc-he50'));
    opcoes.he100_horas = U.parseValor(U.val('dp-rc-he100'));
    opcoes.horas_noturnas = U.parseValor(U.val('dp-rc-noturno'));
    opcoes.gratificacao_valor = U.parseValor(U.val('dp-rc-grat'));
    if (U.val('dp-rc-vt') !== '') opcoes.vt_desconto_valor = U.parseValor(U.val('dp-rc-vt'));
    if (U.val('dp-rc-vr') !== '') opcoes.vr_desconto_valor = U.parseValor(U.val('dp-rc-vr'));
    const calc = S.calcularRescisao(fid, data, opcoes);
    if (calc.erro) return ERP.app.aviso(calc.erro, 'erro');
    renderResultadoRescisao(fid, calc, data, opcoes);
  }

  function renderResultadoRescisao(fid, calc, data, opcoes) {
    U.el('dp-rc-resultado').innerHTML =
      (calc.aviso_experiencia ? '<div class="ajuda erro">' + U.esc(calc.aviso_experiencia) + '</div>' : '') +
      '<table class="parcelas" style="margin-top:12px"><tbody>' +
        '<tr><td>Saldo de salário <span class="sub">(' + calc.dias_saldo + ' dia(s)' +
          (calc.dias_ferias_no_saldo ? ', sem os ' + calc.dias_ferias_no_saldo + ' de férias já pagos' : '') + ')</span></td>' +
          '<td class="num">' + U.brl(calc.saldo_salario) + '</td></tr>' +
        (calc.insalubridade_periculosidade ? '<tr><td class="sub">— já inclui insalubridade/periculosidade de</td><td class="num sub">' + U.brl(calc.insalubridade_periculosidade) + '</td></tr>' : '') +
        (calc.he50_valor ? '<tr><td class="sub">— inclui HE 50%</td><td class="num sub">' + U.brl(calc.he50_valor) + '</td></tr>' : '') +
        (calc.he100_valor ? '<tr><td class="sub">— inclui HE 100%</td><td class="num sub">' + U.brl(calc.he100_valor) + '</td></tr>' : '') +
        (calc.adicional_noturno_valor ? '<tr><td class="sub">— inclui adicional noturno</td><td class="num sub">' + U.brl(calc.adicional_noturno_valor) + '</td></tr>' : '') +
        (calc.dsr_valor ? '<tr><td class="sub">— inclui DSR sobre as variáveis</td><td class="num sub">' + U.brl(calc.dsr_valor) + '</td></tr>' : '') +
        (calc.gratificacao_valor ? '<tr><td class="sub">— inclui gratificação</td><td class="num sub">' + U.brl(calc.gratificacao_valor) + '</td></tr>' : '') +
        (calc.decimo_proporcional ? '<tr><td>13º proporcional</td><td class="num">' + U.brl(calc.decimo_proporcional) + '</td></tr>' : '') +
        (calc.adiantamento_13 ? '<tr><td>Adiantamento do 13º já pago (1ª parcela)</td><td class="num">−' + U.brl(calc.adiantamento_13) + '</td></tr>' : '') +
        (calc.ferias_vencidas ? '<tr><td>Férias vencidas</td><td class="num">' + U.brl(calc.ferias_vencidas) + '</td></tr>' : '') +
        (calc.ferias_proporcionais ? '<tr><td>Férias proporcionais</td><td class="num">' + U.brl(calc.ferias_proporcionais) + '</td></tr>' : '') +
        (calc.terco_ferias ? '<tr><td>1/3 sobre férias</td><td class="num">' + U.brl(calc.terco_ferias) + '</td></tr>' : '') +
        (calc.salario_familia ? '<tr><td>Salário-família</td><td class="num">' + U.brl(calc.salario_familia) + '</td></tr>' : '') +
        (calc.aviso_previo ? '<tr><td>Aviso prévio indenizado</td><td class="num">' + U.brl(calc.aviso_previo) + '</td></tr>' : '') +
        (calc.desconto_aviso_nao_cumprido ? '<tr><td>Desconto por aviso prévio não cumprido</td><td class="num">−' + U.brl(calc.desconto_aviso_nao_cumprido) + '</td></tr>' : '') +
        (calc.multa_antecipada_experiencia ? '<tr><td>Indenização por rescisão antecipada (art. 479 — metade de ' +
          calc.dias_restantes_contrato + ' dia(s) restante(s) do contrato)</td><td class="num">' + U.brl(calc.multa_antecipada_experiencia) + '</td></tr>' : '') +
        '<tr><td>INSS <span class="sub">(saldo ' + U.brl(calc.valor_inss_saldo) + ' + 13º ' + U.brl(calc.valor_inss_decimo) + ', separados)</span></td><td class="num">−' + U.brl(calc.valor_inss) + '</td></tr>' +
        '<tr><td>IRRF <span class="sub">(saldo ' + U.brl(calc.valor_irrf_saldo) + ' + 13º ' + U.brl(calc.valor_irrf_decimo) + ', separados)</span></td><td class="num">−' + U.brl(calc.valor_irrf) + '</td></tr>' +
        (calc.vt_desconto ? '<tr><td>Desconto de VT</td><td class="num">−' + U.brl(calc.vt_desconto) + '</td></tr>' : '') +
        (calc.vr_desconto ? '<tr><td>Desconto de VR</td><td class="num">−' + U.brl(calc.vr_desconto) + '</td></tr>' : '') +
        (calc.pensao_alimenticia ? '<tr><td>Pensão alimentícia' + (calc.pensao_13 ? ' <span class="sub">(inclui ' + U.brl(calc.pensao_13) + ' sobre o 13º)</span>' : '') + '</td><td class="num">−' + U.brl(calc.pensao_alimenticia) + '</td></tr>' : '') +
        (calc.desconto_credito_trabalhador ? '<tr><td>Crédito do trabalhador <span class="sub">— editável, confira o saldo residual real</span></td>' +
          '<td class="num"><input class="num" id="dp-rc-credito" inputmode="decimal" value="' + U.num(calc.desconto_credito_trabalhador) + '"></td></tr>' : '') +
        '<tr><td><b>Total líquido — vai pro funcionário</b></td><td class="num"><b id="dp-rc-liquido">' + U.brl(calc.total_liquido) + '</b></td></tr>' +
      '</tbody></table>' +
      '<table class="parcelas" style="margin-top:10px"><thead><tr><th>Não vai pro funcionário — depósito na conta vinculada de FGTS</th><th class="num"></th></tr></thead><tbody>' +
        '<tr><td>FGTS de 8% sobre saldo/13º/aviso</td><td class="num">' + U.brl(calc.fgts_rescisao || 0) + '</td></tr>' +
        '<tr><td>INSS patronal + RAT×FAP + terceiros sobre saldo e 13º <span class="sub">(encargo da empresa, guia à parte)</span></td><td class="num">' +
          U.brl(Math.round(((calc.inss_patronal_rescisao || 0) + (calc.outros_encargos_rescisao || 0)) * 100) / 100) + '</td></tr>' +
        (calc.multa_fgts_aplicavel
          ? '<tr><td>Multa de 40% do FGTS <span class="sub">— editável, confira o valor real no extrato ' +
            'da Caixa antes de confirmar</span></td>' +
            '<td class="num"><input class="num" id="dp-rc-multa" inputmode="decimal" value="' + U.num(calc.multa_fgts) + '"></td></tr>'
          : '<tr><td>Multa de FGTS</td><td class="num sub">não se aplica a ' + U.esc(calc.tipo_nome.toLowerCase()) + '</td></tr>') +
      '</tbody></table>' +
      (calc.multa_fgts_aplicavel
        ? '<div class="ajuda">Estimativa de partida da multa: 40% sobre R$ ' + U.num(calc.fgts_gerado_estimado) +
          ' de FGTS, contando mês a mês desde a admissão — usa o FGTS de verdade nos meses com folha ' +
          'fechada aqui, e 8% do salário histórico do funcionário nos demais. Corrija o campo acima pelo ' +
          'extrato de FGTS real da Caixa antes de confirmar, principalmente se o histórico salarial ' +
          'cadastrado (aba Funcionários → Reajustar) não cobrir o contrato inteiro.</div>' : '') +
      (podeDP() ? '<button class="btn-linha" id="dp-rc-lancar" style="margin-top:10px">Confirmar rescisão e desligar</button>' : '');

    if (U.el('dp-rc-multa')) {
      U.el('dp-rc-multa').addEventListener('change', function () {
        const novoCalc = S.calcularRescisao(fid, data, Object.assign({}, opcoes, { multaFGTSManual: U.parseValor(this.value) }));
        if (novoCalc.erro) return ERP.app.aviso(novoCalc.erro, 'erro');
        renderResultadoRescisao(fid, novoCalc, data, opcoes);
      });
    }
    if (U.el('dp-rc-credito')) {
      U.el('dp-rc-credito').addEventListener('change', function () {
        const novoCalc = S.calcularRescisao(fid, data, Object.assign({}, opcoes, { credito_trabalhador_valor: U.parseValor(this.value) }));
        if (novoCalc.erro) return ERP.app.aviso(novoCalc.erro, 'erro');
        renderResultadoRescisao(fid, novoCalc, data, opcoes);
      });
    }
    if (U.el('dp-rc-lancar')) {
      U.el('dp-rc-lancar').addEventListener('click', function () {
        if (!confirm('Confirmar a rescisão (' + calc.tipo_nome + ')? Isso desliga o funcionário — dá pra cancelar depois, na lista de rescisões já lançadas.')) return;
        const r = S.lancarRescisao(fid, calc);
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.aviso('Rescisão lançada e funcionário desligado.', 'ok');
        abrirAba('funcionarios');
      });
    }
  }

  /* ══════════════════ CUSTOS ══════════════════ */
  /* ══════════════════ RELATÓRIO DA FOLHA ══════════════════ */
  function renderRelatorioFolha() {
    const box = U.el('dp-aba-relatorio');
    const comp = U.el('dp-rl-comp') ? U.val('dp-rl-comp') : U.mesAtual();
    const fl = S.folhas({ competencia: comp }).find(function (x) { return !x.cancelada; });

    box.innerHTML =
      '<h2>Relatório da folha<span class="sub">detalhado por funcionário, da folha já fechada da competência</span></h2>' +
      '<div class="filtros"><div class="f"><label for="dp-rl-comp">Competência</label>' +
        '<input type="month" id="dp-rl-comp" value="' + comp + '"></div>' +
        (fl ? '<button class="btn-sm" id="dp-rl-exportar" style="align-self:flex-end">Exportar planilha</button>' +
          '<button class="btn-sm" id="dp-rl-pdf" style="align-self:flex-end">Baixar holerites em PDF</button>' : '') +
      '</div>' +
      '<div id="dp-rl-saida"></div>';

    U.el('dp-rl-comp').addEventListener('change', renderRelatorioFolha);
    if (!fl) {
      U.el('dp-rl-saida').innerHTML = '<div class="ajuda">Nenhuma folha fechada (não cancelada) para ' + U.fComp(comp) + '.</div>';
      return;
    }
    renderTabelaRelatorioFolha(fl);
    if (U.el('dp-rl-exportar')) U.el('dp-rl-exportar').addEventListener('click', function () {
      const dados = ERP.exportar.deTabela(document.querySelector('#dp-rl-saida table'));
      if (!dados || !dados.linhas.length) return ERP.app.aviso('Nada para exportar.', 'erro');
      ERP.exportar.abrir(Object.assign({ nome: 'folha-' + fl.competencia,
        titulo: 'Folha de ' + U.fComp(fl.competencia) }, dados));
    });
    if (U.el('dp-rl-pdf')) U.el('dp-rl-pdf').addEventListener('click', function () { exportarPdfRelatorioFolha(fl); });
  }

  /* (antigo) PDF dos holerites por impressão — substituído pelo
     download direto via ERP.pdf (3 quadros por folha A4, corte
     abre o diálogo de impressão do navegador, onde "Salvar como PDF" é
     um dos destinos — não existe servidor aqui pra gerar o PDF direto,
     e essa é a forma mais confiável de chegar num PDF de verdade sem
     depender de uma biblioteca externa. */
  /* PDF dos holerites: gera e BAIXA o arquivo (ERP.pdf), sem abrir a
     tela de impressão do navegador — ela tomava o lugar do sistema e,
     no arquivo local, obrigava a recarregar a página (perdendo tudo que
     estava na tela). Três quadros por página A4 retrato, com espaço
     entre eles e uma linha de corte tracejada. */
  function exportarPdfRelatorioFolha(fl) {
    const empresa = D.empresa || {};
    const holerites = (fl.holerites || []).filter(function (h) { return !h.erro; });
    if (!holerites.length) return ERP.app.aviso('Esta folha não tem holerites pra exportar.', 'erro');

    const d = ERP.pdf.doc({ orientacao: 'retrato', margem: 34 });
    const alturaQuadro = (d.altura - d.margem * 2 - 24) / 3;   // 3 por página, com respiro entre eles
    let indice = 0;

    holerites.forEach(function (h, i) {
      if (i > 0 && indice === 0) d.novaPagina();
      const topo = d.margem + indice * (alturaQuadro + 12);
      desenharHolerite(d, h, topo, alturaQuadro, empresa);
      /* Linha de corte entre os quadros. Fica MAIS CLARA que a borda
         (tracejada e mais escura) e a borda do quadro é sempre
         contínua — antes, do 2º quadro em diante, a borda saía
         tracejada igual à linha de corte e não dava pra distinguir uma
         da outra. */
      if (indice < 2 && i < holerites.length - 1) {
        const yCorte = topo + alturaQuadro + 6;
        d.linha(d.margem - 8, yCorte, d.largura - d.margem + 8, yCorte, { tracejada: true, cinza: 0.3, espessura: 0.8 });
      }
      indice = (indice + 1) % 3;
    });

    d.salvar('holerites-' + fl.competencia + '.pdf');
    ERP.app.aviso('PDF dos holerites baixado (' + holerites.length + ' funcionário(s)).', 'ok');
  }

  function desenharHolerite(d, h, topo, alturaQuadro, empresa) {
    const f = D.funcionario(h.funcionario) || { nome: '(funcionário removido)', matricula: '' };
    const cargo = (D.cargo(f.cargo) || {}).nome || '';
    const x0 = d.margem, x1 = d.largura - d.margem, largura = x1 - x0;
    let y = topo + 11;

    d.retangulo(x0, topo, largura, alturaQuadro, { borda: true });
    d.texto(x0 + 8, y, empresa.nome || 'Folha de pagamento', { tam: 10, negrito: true });
    d.texto(x1 - 8, y, 'Competência ' + U.fComp(h.competencia), { tam: 9, alinhar: 'direita' });
    y += 12;
    d.texto(x0 + 8, y, f.nome + '   ·   matrícula ' + (f.matricula || '—') + (cargo ? '   ·   ' + cargo : ''),
      { tam: 8.5, cinza: 0.35, largura: largura - 16 });
    y += 6;
    d.linha(x0 + 6, y, x1 - 6, y, { cinza: 0.5 });
    y += 12;

    // duas colunas: proventos à esquerda, descontos à direita
    const meio = x0 + largura / 2;
    const proventos = (h.proventos || []).filter(function (p) { return p.valor > 0.004; });
    const descontos = (h.descontos || []).filter(function (x) { return x.valor > 0.004; });
    d.texto(x0 + 8, y, 'Proventos', { tam: 8.5, negrito: true });
    d.texto(meio + 8, y, 'Descontos', { tam: 8.5, negrito: true });
    y += 3;
    d.linha(x0 + 6, y, meio - 6, y, { cinza: 0.8 });
    d.linha(meio + 6, y, x1 - 6, y, { cinza: 0.8 });
    y += 11;

    const linhasMax = Math.max(proventos.length, descontos.length);
    const yLista = y;
    /* Com muitas rubricas o quadro perdia linhas em silêncio. Agora o
       passo encolhe até caber; se ainda assim não couber, a última
       linha avisa quantas ficaram de fora. */
    const espaco = topo + alturaQuadro - 34 - yLista;
    const passo = linhasMax > 0 ? Math.max(6.5, Math.min(10.5, espaco / linhasMax)) : 10.5;
    const cabem = Math.max(1, Math.floor(espaco / passo));
    for (let i = 0; i < linhasMax; i++) {
      const yy = yLista + i * passo;
      if (i >= cabem) {
        d.texto(x0 + 8, yLista + cabem * passo, '… mais ' + (linhasMax - cabem) +
          ' rubrica(s) — veja o relatório da folha', { tam: 7.5, cinza: 0.45 });
        break;
      }
      if (proventos[i]) {
        d.texto(x0 + 8, yy, proventos[i].descricao, { tam: 8, largura: largura / 2 - 70 });
        d.texto(meio - 8, yy, U.brl(proventos[i].valor), { tam: 8, alinhar: 'direita' });
      }
      if (descontos[i]) {
        d.texto(meio + 8, yy, descontos[i].descricao, { tam: 8, largura: largura / 2 - 70 });
        d.texto(x1 - 8, yy, U.brl(descontos[i].valor), { tam: 8, alinhar: 'direita' });
      }
    }

    // rodapé do quadro: totais e líquido
    const yTot = topo + alturaQuadro - 26;
    d.linha(x0 + 6, yTot - 8, x1 - 6, yTot - 8, { cinza: 0.5 });
    d.texto(x0 + 8, yTot, 'Total de proventos', { tam: 8 });
    d.texto(meio - 8, yTot, U.brl(h.total_proventos), { tam: 8, alinhar: 'direita' });
    d.texto(meio + 8, yTot, 'Total de descontos', { tam: 8 });
    d.texto(x1 - 8, yTot, U.brl(h.total_descontos), { tam: 8, alinhar: 'direita' });
    d.texto(meio + 8, yTot + 13, 'Líquido a receber', { tam: 10, negrito: true });
    d.texto(x1 - 8, yTot + 13, U.brl(h.liquido), { tam: 10, negrito: true, alinhar: 'direita' });
  }
  // soma o valor de uma lista de códigos dentro dos proventos ou descontos de um holerite
  function somaCodigos(itens, codigos) {
    return Math.round((itens || []).filter(function (i) { return codigos.indexOf(i.codigo) > -1; })
      .reduce(function (s, i) { return s + i.valor; }, 0) * 100) / 100;
  }

  function renderTabelaRelatorioFolha(fl) {
    const linhas = (fl.holerites || []).map(function (h) {
      const f = D.funcionario(h.funcionario) || { nome: '(funcionário removido)' };
      return {
        f: f, h: h,
        gratificacoes: somaCodigos(h.proventos, ['107']),
        horas_extras: somaCodigos(h.proventos, ['101', '102']),
        noturno: somaCodigos(h.proventos, ['103']),
        dsr: somaCodigos(h.proventos, ['104']),
        vt: somaCodigos(h.descontos, ['903']),
        vr: somaCodigos(h.descontos, ['907'])
      };
    });
    const box = U.el('dp-rl-saida');
    /* Cada coluna carrega junto como extrair o valor da linha (x) e
       como somar o total (a soma sempre lê da MESMA linha, não de um
       índice separado — evita o total desalinhar da coluna se a
       ordem das colunas mudar no futuro). */
    const cols = [
      { titulo: 'Funcionário', num: false, valor: function (x) { return U.esc(x.f.nome); } },
      { titulo: 'Salário bruto', num: true, valor: function (x) { return U.brl(x.h.total_proventos); }, total: function (x) { return x.h.total_proventos; } },
      { titulo: 'Desconto INSS', num: true, valor: function (x) { return U.brl(x.h.valor_inss); }, total: function (x) { return x.h.valor_inss; } },
      { titulo: 'Desconto IRRF', num: true, valor: function (x) { return x.h.valor_irrf ? U.brl(x.h.valor_irrf) : '—'; }, total: function (x) { return x.h.valor_irrf || 0; } },
      { titulo: 'Gratificações', num: true, valor: function (x) { return x.gratificacoes ? U.brl(x.gratificacoes) : '—'; }, total: function (x) { return x.gratificacoes; } },
      { titulo: 'Horas extras', num: true, valor: function (x) { return x.horas_extras ? U.brl(x.horas_extras) : '—'; }, total: function (x) { return x.horas_extras; } },
      { titulo: 'Adicional noturno', num: true, valor: function (x) { return x.noturno ? U.brl(x.noturno) : '—'; }, total: function (x) { return x.noturno; } },
      { titulo: 'DSR sobre variáveis', num: true, valor: function (x) { return x.dsr ? U.brl(x.dsr) : '—'; }, total: function (x) { return x.dsr; } },
      { titulo: 'Desconto faltas', num: true, valor: function (x) { return x.h.desconto_faltas ? U.brl(x.h.desconto_faltas) : '—'; }, total: function (x) { return x.h.desconto_faltas || 0; } },
      { titulo: 'Desconto VR', num: true, valor: function (x) { return x.vr ? U.brl(x.vr) : '—'; }, total: function (x) { return x.vr; } },
      { titulo: 'Desconto VT', num: true, valor: function (x) { return x.vt ? U.brl(x.vt) : '—'; }, total: function (x) { return x.vt; } },
      { titulo: 'Salário-família', num: true, valor: function (x) { return x.h.salario_familia ? U.brl(x.h.salario_familia) : '—'; }, total: function (x) { return x.h.salario_familia || 0; } },
      { titulo: 'Líquido', num: true, valor: function (x) { return U.brl(x.h.liquido); }, total: function (x) { return x.h.liquido; } }
    ];
    box.innerHTML = '<table class="parcelas"><thead><tr>' +
      cols.map(function (c) { return '<th' + (c.num ? ' class="num"' : '') + '>' + c.titulo + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      linhas.map(function (x) {
        return '<tr>' + cols.map(function (c) { return '<td' + (c.num ? ' class="num"' : '') + '>' + c.valor(x) + '</td>'; }).join('') + '</tr>';
      }).join('') +
      '<tr><td><b>Total</b></td>' +
        cols.slice(1).map(function (c) {
          return '<td class="num"><b>' + U.brl(linhas.reduce(function (s, x) { return s + c.total(x); }, 0)) + '</b></td>';
        }).join('') +
      '</tr></tbody></table>';
  }

  function exportarCsvRelatorioFolha(fl) {
    const linhas = (fl.holerites || []).map(function (h) {
      const f = D.funcionario(h.funcionario) || { nome: '(funcionário removido)' };
      return [
        f.nome, h.total_proventos, h.valor_inss, h.valor_irrf || 0,
        somaCodigos(h.proventos, ['107']), somaCodigos(h.proventos, ['101', '102']),
        somaCodigos(h.proventos, ['103']), somaCodigos(h.proventos, ['104']),
        h.desconto_faltas || 0, somaCodigos(h.descontos, ['907']), somaCodigos(h.descontos, ['903']),
        h.salario_familia || 0, h.liquido
      ];
    });
    const cabecalho = ['Funcionário', 'Salário bruto', 'Desconto INSS', 'Desconto IRRF', 'Gratificações',
      'Horas extras', 'Adicional noturno', 'DSR', 'Desconto faltas', 'Desconto VR', 'Desconto VT',
      'Salário-família', 'Líquido'];
    const csv = [cabecalho].concat(linhas).map(function (l) {
      return l.map(function (v) { return typeof v === 'number' ? String(v).replace('.', ',') : '"' + v + '"'; }).join(';');
    }).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'relatorio-folha-' + fl.competencia + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function renderCustos() {
    const box = U.el('dp-aba-custos');
    const de = U.el('dp-cu-de') ? U.val('dp-cu-de') : U.mesAtual();
    const ate = U.el('dp-cu-ate') ? U.val('dp-cu-ate') : U.mesAtual();
    const todos = D.funcionarios;

    box.innerHTML =
      '<h2>Custos por funcionário<span class="sub">o que cada folha fechada já calculou, somado no período</span></h2>' +
      '<div class="filtros">' +
        '<div class="f"><label for="dp-cu-de">De</label><input type="month" id="dp-cu-de" value="' + de + '"></div>' +
        '<div class="f"><label for="dp-cu-ate">Até</label><input type="month" id="dp-cu-ate" value="' + ate + '"></div>' +
        '<div class="f"><label for="dp-cu-func">Funcionário</label><select id="dp-cu-func">' +
          '<option value="">Todos</option>' +
          todos.map(function (f) { return '<option value="' + f.id + '">' + U.esc(f.nome) + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div id="dp-cu-saida"></div>' +
      '<div class="ajuda" style="margin-top:8px">Provisão de 13º e de férias são estimativas (1/12 avos do salário ' +
        'atual por mês fechado) — não são um valor já reservado em conta, é o quanto a empresa vai precisar ' +
        'desembolsar mais adiante. INSS patronal usa a alíquota cadastrada em Tabelas (20% é a regra geral do ' +
        'Regime Geral; confirme se a Dom Pedro se enquadra em algum regime de desoneração).</div>';

    ['dp-cu-de', 'dp-cu-ate', 'dp-cu-func'].forEach(function (id) {
      U.el(id).addEventListener('change', renderTabelaCustos);
    });
    renderTabelaCustos();
  }

  function renderTabelaCustos() {
    const filtro = {
      competencia_de: U.val('dp-cu-de'), competencia_ate: U.val('dp-cu-ate'),
      funcionario: U.val('dp-cu-func') || null
    };
    const linhas = S.custoFuncionarios(filtro);
    const box = U.el('dp-cu-saida');
    if (!linhas.length) {
      box.innerHTML = '<div class="ajuda">Nenhuma folha fechada (não cancelada) no período escolhido.</div>';
      return;
    }
    const soma = (campo) => linhas.reduce(function (s, l) { return s + l[campo]; }, 0);
    box.innerHTML = '<table class="parcelas"><thead><tr><th>Funcionário</th><th class="num">Meses</th>' +
      '<th class="num">Bruto</th><th class="num">Líquido</th><th class="num">INSS</th><th class="num">IRRF</th>' +
      '<th class="num">FGTS</th><th class="num">INSS patronal</th><th class="num">RAT+terceiros</th><th class="num">Provisão 13º</th>' +
      '<th class="num">Provisão férias</th><th class="num">Benefícios</th><th class="num">Custo total</th></tr></thead><tbody>' +
      linhas.map(function (l) {
        return '<tr><td>' + U.esc(l.funcionario.nome) + '</td>' +
          '<td class="num">' + l.meses + '</td>' +
          '<td class="num">' + U.brl(l.bruto) + '</td>' +
          '<td class="num">' + U.brl(l.liquido) + '</td>' +
          '<td class="num">' + U.brl(l.inss) + '</td>' +
          '<td class="num">' + U.brl(l.irrf) + '</td>' +
          '<td class="num">' + U.brl(l.fgts) + '</td>' +
          '<td class="num">' + U.brl(l.inss_patronal) + '</td>' +
          '<td class="num">' + U.brl(l.outros_encargos) + '</td>' +
          '<td class="num">' + U.brl(l.provisao_decimo) + '</td>' +
          '<td class="num">' + U.brl(l.provisao_ferias) + '</td>' +
          '<td class="num">' + U.brl(l.beneficios) + '</td>' +
          '<td class="num"><b>' + U.brl(l.custo_total) + '</b></td></tr>';
      }).join('') +
      '<tr><td><b>Total</b></td><td></td>' +
        ['bruto', 'liquido', 'inss', 'irrf', 'fgts', 'inss_patronal', 'outros_encargos', 'provisao_decimo', 'provisao_ferias', 'beneficios', 'custo_total']
          .map(function (c) { return '<td class="num"><b>' + U.brl(soma(c)) + '</b></td>'; }).join('') +
      '</tr>' +
      '</tbody></table>';
  }

  /* ══════════════════ TABELAS FISCAIS ══════════════════ */
  function renderTabelas() {
    const box = U.el('dp-aba-tabelas');
    const inss = D.tabelaINSS, irrf = D.tabelaIRRF, dp = D.parametrosDP;
    const podeEditar = S.pode('admin');

    box.innerHTML =
      '<h2>Tabelas fiscais<span class="sub">o que muda por lei — confirme todo início de ano</span></h2>' +
      '<h3 style="font-size:12px;margin:0 0 6px">Rubricas do cálculo de folha</h3>' +
      '<div class="ajuda">Isto é documentação do que o cálculo já faz hoje (função `calcularHolerite`), pra ' +
        'conferir contra o que você já conhece — não é uma configuração: mudar aqui não muda o cálculo. Se ' +
        'alguma coisa estiver diferente do que deveria, é ajuste de código, não desta lista.</div>' +
      '<table class="parcelas"><thead><tr><th>Código</th><th>Rubrica</th><th>Tipo</th><th>Natureza</th>' +
        '<th>INSS</th><th>IRRF</th><th>FGTS</th><th>Observação</th></tr></thead><tbody>' +
        D.rubricasPadrao.map(function (r) {
          const sn = v => v ? 'Sim' : '—';
          return '<tr><td class="mono">' + U.esc(r.codigo) + '</td><td>' + U.esc(r.nome) + '</td>' +
            '<td>' + (r.tipo === 'provento' ? 'Provento' : 'Desconto') + '</td>' +
            '<td class="mono">' + U.esc(r.natureza) + '</td>' +
            '<td>' + sn(r.inss) + '</td><td>' + sn(r.irrf) + '</td><td>' + sn(r.fgts) + '</td>' +
            '<td class="sub">' + U.esc(r.obs) + '</td></tr>';
        }).join('') +
      '</tbody></table>' +
      '<h3 style="font-size:12px;margin:18px 0 6px">INSS (empregado) — tabela progressiva</h3>' +
      '<div class="ajuda">Vigência de referência: INSS ' + U.esc(inss.vigencia) + ' · IRRF ' + U.esc(irrf.vigencia) +
        '. Só o perfil de Administração edita — peça pra ele se a tabela publicada for diferente.</div>' +
      '<table class="parcelas"><thead><tr><th>Até (R$)</th><th>Alíquota</th><th>Parcela a deduzir</th></tr></thead><tbody>' +
        inss.faixas.map(function (f, i) {
          return '<tr><td><input class="num" data-inss="' + i + '" data-c="ate" value="' + U.num(f.ate) + '"' + (podeEditar ? '' : ' disabled') + '></td>' +
            '<td><input class="num" data-inss="' + i + '" data-c="aliquota" value="' + U.num(f.aliquota) + '"' + (podeEditar ? '' : ' disabled') + '>%</td>' +
            '<td><input class="num" data-inss="' + i + '" data-c="deduzir" value="' + U.num(f.deduzir) + '"' + (podeEditar ? '' : ' disabled') + '></td></tr>';
        }).join('') +
        '<tr><td colspan="2">Teto de contribuição</td><td><input class="num" id="dp-inss-teto" value="' + U.num(inss.teto_contribuicao) + '"' + (podeEditar ? '' : ' disabled') + '></td></tr>' +
      '</tbody></table>' +
      '<h3 style="font-size:12px;margin:14px 0 6px">IRRF — tabela progressiva</h3>' +
      '<table class="parcelas"><thead><tr><th>Até (R$)</th><th>Alíquota</th><th>Parcela a deduzir</th></tr></thead><tbody>' +
        irrf.faixas.map(function (f, i) {
          return '<tr><td><input class="num" data-irrf="' + i + '" data-c="ate" value="' + (f.ate === Infinity ? 'Acima' : U.num(f.ate)) + '"' + (podeEditar && f.ate !== Infinity ? '' : ' disabled') + '></td>' +
            '<td><input class="num" data-irrf="' + i + '" data-c="aliquota" value="' + U.num(f.aliquota) + '"' + (podeEditar ? '' : ' disabled') + '>%</td>' +
            '<td><input class="num" data-irrf="' + i + '" data-c="deduzir" value="' + U.num(f.deduzir) + '"' + (podeEditar ? '' : ' disabled') + '></td></tr>';
        }).join('') +
        '<tr><td colspan="2">Dedução por dependente</td><td><input class="num" id="dp-irrf-dep" value="' + U.num(irrf.deducao_por_dependente) + '"' + (podeEditar ? '' : ' disabled') + '></td></tr>' +
      '</tbody></table>' +
      '<h3 style="font-size:12px;margin:14px 0 6px">Outros parâmetros</h3>' +
      '<div class="row3">' +
        '<div><label>Alíquota FGTS (%)</label><input class="num" id="dp-fgts-pct" value="' + U.num(dp.aliquota_fgts) + '"' + (podeEditar ? '' : ' disabled') + '></div>' +
        '<div><label>INSS patronal (%)</label><input class="num" id="dp-inss-pat" value="' + U.num(dp.aliquota_inss_patronal) + '"' + (podeEditar ? '' : ' disabled') + '></div>' +
        '<div><label>Salário mínimo (R$)</label><input class="num" id="dp-sal-min" value="' + U.num(dp.salario_minimo) + '"' + (podeEditar ? '' : ' disabled') + '></div>' +
      '</div>' +
      '<div class="row3" style="margin-top:8px">' +
        '<div><label>Desconto máx. de VT (% do salário)</label><input class="num" id="dp-vt-max" value="' + U.num(dp.percentual_vt_max_desconto) + '"' + (podeEditar ? '' : ' disabled') + '></div>' +
        '<div><label>RAT×FAP (%) <span class="sub">varia por CNAE/FAP</span></label><input class="num" id="dp-rat-fap" value="' + U.num(dp.aliquota_rat_fap) + '"' + (podeEditar ? '' : ' disabled') + '></div>' +
        '<div><label>Terceiros/Sistema S (%) <span class="sub">confirme com o contador</span></label><input class="num" id="dp-terceiros" value="' + U.num(dp.aliquota_terceiros) + '"' + (podeEditar ? '' : ' disabled') + '></div>' +
      '</div>' +
      (podeEditar ? '<button class="btn-linha" id="dp-salvar-tabelas" style="margin-top:12px">Salvar tabelas</button>' : '');

    if (podeEditar && U.el('dp-salvar-tabelas')) {
      U.el('dp-salvar-tabelas').addEventListener('click', function () {
        /* Monta a tabela PROPOSTA e manda o store validar antes de
           gravar: faixas fora de ordem, alíquota decrescente ou teto
           de contribuição que não bate com as faixas faziam a folha
           inteira errar em silêncio — inclusive com quem ganha mais
           pagando menos INSS. */
        const inss = { faixas: D.tabelaINSS.faixas.map(function (f) { return Object.assign({}, f); }),
          teto_contribuicao: U.parseValor(U.val('dp-inss-teto')) };
        box.querySelectorAll('[data-inss]').forEach(function (inp) {
          inss.faixas[+inp.dataset.inss][inp.dataset.c] = U.parseValor(inp.value);
        });
        const irrf = { faixas: D.tabelaIRRF.faixas.map(function (f) { return Object.assign({}, f); }),
          deducao_por_dependente: U.parseValor(U.val('dp-irrf-dep')) };
        box.querySelectorAll('[data-irrf]').forEach(function (inp) {
          const i = +inp.dataset.irrf, c = inp.dataset.c;
          if (c === 'ate' && D.tabelaIRRF.faixas[i].ate === Infinity) return;
          irrf.faixas[i][c] = U.parseValor(inp.value);
        });
        const r = S.salvarTabelasDP({ inss: inss, irrf: irrf, parametros: {
          aliquota_fgts: U.parseValor(U.val('dp-fgts-pct')),
          aliquota_inss_patronal: U.parseValor(U.val('dp-inss-pat')),
          salario_minimo: U.parseValor(U.val('dp-sal-min')),
          percentual_vt_max_desconto: U.parseValor(U.val('dp-vt-max')),
          aliquota_rat_fap: U.parseValor(U.val('dp-rat-fap')),
          aliquota_terceiros: U.parseValor(U.val('dp-terceiros'))
        } });
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.aviso('Tabelas atualizadas — os próximos cálculos já usam os novos valores.', 'ok');
        render();
      });
    }
  }

  return { montar, render };
})();
