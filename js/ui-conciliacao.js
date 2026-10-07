/* ERP · ui-conciliacao.js — o extrato contra o sistema, em três grupos.

   VÍNCULOS CONCRETOS — o sistema tem certeza: pagamento que nós mesmos
   mandamos ao banco, ou regra já aprendida. Aprova em lote.
   VÍNCULOS POSSÍVEIS — há candidato, mas alguém precisa olhar.
   SEM VÍNCULO — não achou nada: lançar, buscar na mão ou ignorar.

   A régua é diferente nos dois lados. Na entrada, valor aproximado
   ajuda porque a lista de contas a receber é curta. Na saída, não:
   com centenas de títulos, valor parecido casa qualquer coisa — por
   isso a saída só entra por pagamento nosso, nome do favorecido ou
   REGRA aprendida ("toda saída para José Antonio é contabilidade"). */
window.ERP = window.ERP || {};

ERP.conciliacao = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;
  let aba = 'concretos';
  let sel = new Set();
  let abertaLinha = null;
  let filtroDir = 'todos';   // 'todos' | 'entrada' | 'saida'

  function montar() {
    U.el('cn-arquivo').addEventListener('change', importar);
    /* A conta mostra de qual empresa ela é: com três CNPJs no mesmo
       ERP, "Santander" sozinho não diz qual. */
    U.el('cn-banco').innerHTML = D.bancos.filter(function (b) { return b.ativo; })
      .map(function (b) {
        const e = D.empresaPor(b.empresa);
        return '<option value="' + b.id + '">' + U.esc(b.apelido) +
          (e ? ' · ' + U.esc(e.apelido) : '') + '</option>';
      }).join('');
    U.el('cn-banco').addEventListener('change', render);
    document.querySelectorAll('#cn-nav button').forEach(function (b) {
      b.addEventListener('click', function () { aba = this.dataset.cn; sel.clear(); render(); });
    });
  }

  function importar(e) {
    const arq = e.target.files && e.target.files[0];
    if (!arq) return;
    const banco = U.val('cn-banco');
    const fr = new FileReader();
    fr.onload = function () {
      /* Lê os bytes e decodifica pela codificação que o próprio
         arquivo declara: Bradesco manda 1252, Itaú e Santander
         costumam mandar UTF-8, e ler tudo como 1252 embaralha os
         acentos do histórico. */
      const bytes = new Uint8Array(fr.result);
      const amostra = String.fromCharCode.apply(null, bytes.subarray(0, 2000));
      const enc = ERP.ofx.codificacao(amostra);
      let texto;
      try { texto = new TextDecoder(enc).decode(bytes); }
      catch (err) { texto = new TextDecoder('windows-1252').decode(bytes); }

      const lido = ERP.ofx.ler(texto);
      if (lido.erro) return ERP.app.aviso(lido.erro, 'erro');
      aplicar(banco, lido, arq.name);
    };
    fr.readAsArrayBuffer(arq);
  }

  function aplicar(banco, lido, nome, forcar) {
    const r = S.importarExtrato(banco, lido, nome);
    /* Arquivo de outra conta: o sistema reconhece pelo BANKID/ACCTID e
       oferece trocar, em vez de misturar extrato de empresas
       diferentes. */
    if (r.divergente && !forcar) {
      return ERP.app.modal({
        titulo: 'Este extrato é de outra conta', fecharTxt: 'Cancelar',
        corpo: '<div class="aviso-linha erro">' + U.esc(r.erro) + '</div>',
        acoes: [
          { txt: 'Importar assim mesmo', cls: 'btn-sm', fn: function () {
            ERP.app.fecharModal();
            const forcado = Object.assign({}, lido, { conta: {} });
            aplicar(banco, forcado, nome, true);
          } },
          { txt: 'Usar a conta do arquivo', cls: 'btn-aprovar', fn: function () {
            U.el('cn-banco').value = r.conta_certa;
            ERP.app.fecharModal();
            aplicar(r.conta_certa, lido, nome, true);
          } }
        ]
      });
    }
    if (ERP.app.erroDoRetorno(r)) return;
    U.el('cn-arquivo').value = '';
    render();
    ERP.app.aviso(r.novos + ' lançamento(s) importado(s)' +
      (r.repetidos ? ', ' + r.repetidos + ' já estavam no sistema' : '') +
      '. Saldo do extrato: ' + U.brl(lido.saldo.valor) + '.' +
      (lido.aviso_conta ? ' ' + lido.aviso_conta : ''),
      lido.aviso_conta ? 'erro' : 'ok');
  }

  function render() {
    const banco = U.val('cn-banco');
    const g = S.classificarLinhas(banco);
    const prod = S.gruposProdutividade(banco);
    const res = S.resumoConciliacao(banco);

    document.querySelectorAll('#cn-nav button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.cn === aba);
      const n = { concretos: g.concretos.length, possiveis: g.possiveis.length,
                  sem: g.sem.length, produtividade: prod.length,
                  regras: S.regras().length, feitos: res.conciliados }[b.dataset.cn];
      const marca = b.querySelector('.contador');
      if (marca) marca.textContent = n;
    });

    U.el('cn-saida').innerHTML =
      '<div class="pr-confere">' +
        '<span>Lançamentos <b>' + res.total + '</b></span>' +
        '<span>Conciliados <b>' + res.conciliados + '</b></span>' +
        '<span>Pendentes <b class="' + (res.pendentes ? 'erro' : '') + '">' + res.pendentes + '</b></span>' +
        '<span>A explicar — entradas <b>' + U.brl(res.pendenteEntrada) + '</b></span>' +
        '<span>saídas <b>' + U.brl(res.pendenteSaida) + '</b></span>' +
      '</div>' +
      (aba === 'concretos'     ? telaConcretos(g.concretos) :
       aba === 'possiveis'     ? telaPossiveis(g.possiveis) :
       aba === 'sem'           ? telaSem(g.sem) :
       aba === 'produtividade' ? telaProdutividade(prod) :
       aba === 'regras'        ? telaRegras() : telaFeitos(banco));
    ligar();
    ligarDesfazer();
  }

  /* Entradas e saídas embaralhadas na mesma lista confundem na hora de
     procurar um valor — o filtro é raso de propósito (só esconde
     linhas), então não precisa zerar seleção nem mexer no resto. */
  const porDirecao = itens => filtroDir === 'todos' ? itens :
    itens.filter(function (i) { return filtroDir === 'entrada' ? i.linha.entrada > 0 : i.linha.saida > 0; });

  const filtroDirHTML = () =>
    '<div class="ap-acoes" style="margin:0 0 8px">' +
      [['todos', 'Tudo'], ['entrada', 'Entradas'], ['saida', 'Saídas']].map(function (v) {
        return '<button class="btn-sm' + (filtroDir === v[0] ? ' btn-aprovar' : '') + '" data-cn-dir="' + v[0] + '">' +
          v[1] + '</button>';
      }).join('') +
    '</div>';

  const cab = (marcaTodos, extra, soma) =>
    '<div class="ap-acoes">' +
      (marcaTodos ? '<button class="btn-sm" id="cn-todos">Marcar todos</button>' +
        '<button class="btn-sm" id="cn-nada">Desmarcar</button>' : '') +
      (soma && soma.n ? '<span class="sub" style="align-self:center;font-weight:600">' +
        soma.n + ' selecionada(s) · ' + U.brl(soma.valor) + '</span>' : '') +
      (extra || '') +
    '</div>';

  const somaSel = itens => {
    const marcados = itens.filter(function (i) { return sel.has(i.linha.id); });
    return { n: marcados.length,
      valor: Math.round(marcados.reduce(function (s, i) { return s + Math.abs(i.linha.valor); }, 0) * 100) / 100 };
  };

  /* Nome do candidato do sistema — projeto e código de reconhecimento
     juntos, curtos, pra caber na tela e ainda dizer "é deste hospital
     mesmo". */
  const nomeCandidato = c => {
    const proj = c.codigo_hospital || c.projeto || '';
    return U.esc((c.nome || '—').slice(0, 28)) + (proj ? ' <span class="sub">· ' + U.esc(proj) + '</span>' : '');
  };

  /* Lado do EXTRATO: valor e nome juntos, na mesma célula. Antes o
     valor do extrato e o do sistema ficavam em colunas separadas por
     outras duas, e o cabeçalho estava fora de ordem — dava pra ler o
     valor de um como se fosse do outro. */
  const ladoExtrato = (l, marcavel) => {
    const desc = l.contraparte || l.meio || '';
    return (marcavel ? '<td><input type="checkbox" style="width:auto" data-cn-sel="' + l.id + '"' +
      (sel.has(l.id) ? ' checked' : '') + '></td>' : '') +
      '<td class="mono">' + U.fData(l.data) + '</td>' +
      '<td class="cn-lado">' +
        '<div class="num' + (l.saida > 0 ? ' erro' : '') + '"><b>' +
          (l.entrada > 0 ? '+' : '−') + U.brl(Math.abs(l.valor)) + '</b></div>' +
        '<div class="desc" title="' + U.esc(l.memo) + '">' + U.esc((desc || l.memo || '—').slice(0, 38)) + '</div>' +
        (desc ? '<div class="sub">' + U.esc(l.memo.slice(0, 44)) + '</div>' : '') +
      '</td>';
  };
  const linhaBase = ladoExtrato;

  /* Lado do SISTEMA: bruto e líquido explicados, e o nome do cadastro
     do lado do nome que veio no extrato — é a comparação que a pessoa
     está fazendo de cabeça. */
  function ladoSistema(alvo, valorExtrato) {
    if (!alvo) return '<td class="cn-lado sub">—</td>';
    const bruto = alvo.valorBruto !== undefined && alvo.valorBruto !== null ? alvo.valorBruto : alvo.valor;
    const liquido = alvo.valor;
    const temRetencao = Math.abs(bruto - liquido) > 0.005;
    /* Qual dos dois o banco pagou: é o que explica a diferença. */
    const bate = Math.abs(valorExtrato - liquido) <= 0.05 ? 'líquido'
      : Math.abs(valorExtrato - bruto) <= 0.05 ? 'bruto' : null;
    return '<td class="cn-lado">' +
      '<div class="num"><b>' + U.brl(liquido) + '</b>' +
        (temRetencao ? ' <span class="sub">líquido</span>' : '') + '</div>' +
      (temRetencao ? '<div class="num sub">' + U.brl(bruto) + ' bruto · ' +
        U.brl(Math.round((bruto - liquido) * 100) / 100) + ' retido</div>' : '') +
      '<div class="desc">' + nomeCandidato(alvo) + '</div>' +
      (alvo.detalhe ? '<div class="sub">' + U.esc(String(alvo.detalhe).slice(0, 48)) + '</div>' : '') +
      (temRetencao && bate ? '<div class="sub">o extrato pagou o ' + bate + '</div>' : '') +
      '</td>';
  }

  /* Diferença entre o que caiu no banco e o que o sistema esperava,
     dita em palavras: "R$ 12,00 a mais no extrato" é mais claro que um
     número solto com sinal. */
  function difCelula(valorExtrato, alvo) {
    if (!alvo) return '<td class="num sub">—</td>';
    const bruto = alvo.valorBruto !== undefined && alvo.valorBruto !== null ? alvo.valorBruto : alvo.valor;
    const dLiq = Math.round((valorExtrato - alvo.valor) * 100) / 100;
    const dBruto = Math.round((valorExtrato - bruto) * 100) / 100;
    const d = Math.abs(dLiq) <= Math.abs(dBruto) ? dLiq : dBruto;
    const base = Math.abs(dLiq) <= Math.abs(dBruto) ? 'líquido' : 'bruto';
    if (Math.abs(d) <= 0.005) {
      return '<td class="num"><span class="badge b-pago">bate</span>' +
        (Math.abs(bruto - alvo.valor) > 0.005 ? '<div class="sub">com o ' + base + '</div>' : '') + '</td>';
    }
    return '<td class="num' + (Math.abs(d) > 0.05 ? ' erro' : ' sub') + '">' + U.brl(Math.abs(d)) +
      '<div class="sub">' + (d > 0 ? 'a mais' : 'a menos') + ' no extrato</div></td>';
  }

  /* ── concretos: aprovação em lote ───────────────────────*/
  function telaConcretos(itensTodos) {
    const itens = porDirecao(itensTodos);
    const soma = somaSel(itens);
    return '<div class="ajuda" style="margin:10px 0">Estes o sistema tem como certos: pagamento que ' +
      'saiu daqui com valor exato, ou linha coberta por uma regra já aprendida. Confira e autorize em ' +
      'lote — ou troque o título de uma linha específica se o valor bater por coincidência.</div>' +
      filtroDirHTML() +
      cab(true, '<button class="btn-linha" id="cn-lote"' + (soma.n ? '' : ' disabled') + '>' +
        'Autorizar ' + (soma.n || '') + ' vínculo(s)</button>' +
        '<button class="btn-sm btn-cancelar" id="cn-ign-lote"' + (soma.n ? '' : ' disabled') +
          '>Ignorar ' + (soma.n || '') + '</button>', soma) +
      '<div class="tabela-rolagem" style="margin:0 -14px"><table><thead><tr>' +
      '<th style="width:24px"></th><th>Data</th><th>No extrato do banco</th>' +
      '<th>No sistema</th><th class="num">Diferença</th><th>Por quê</th><th></th></tr></thead><tbody>' +
      (itens.length ? itens.map(function (i) {
        const l = i.linha;
        const vExtrato = Math.abs(l.valor);
        return '<tr class="' + (sel.has(l.id) ? 'sel' : '') + '">' + ladoExtrato(l, true) +
          (i.porRegra
            ? '<td class="cn-lado"><div class="desc">Lançar em ' + U.esc(i.regra.conta) +
              (i.regra.descricao ? '<div class="sub">' + U.esc(i.regra.descricao) + '</div>' : '') + '</div></td>' +
              '<td class="num sub">—</td>'
            : ladoSistema(i.alvo, vExtrato) + difCelula(vExtrato, i.alvo)) +
          '<td class="sub">' + U.esc((i.porRegra ? 'regra: ' + i.regra.chave : i.alvo.motivo || '').slice(0, 50)) + '</td>' +
          '<td class="acoes"><button class="btn-sm" data-cn-buscar="' + l.id + '">Trocar</button></td></tr>';
      }).join('')
        : '<tr><td colspan="7" class="vazio"><strong>Nada com certeza absoluta.</strong>' +
          'Veja "Vínculos possíveis" ou crie regras para o que se repete.</td></tr>') +
      '</tbody></table></div>';
  }

  /* ── possíveis: um a um, com escolha ────────────────────*/
  function telaPossiveis(itensTodos) {
    const itens = porDirecao(itensTodos);
    const soma = somaSel(itens);
    return '<div class="ajuda" style="margin:10px 0">Há candidatos, mas a decisão é sua. A coluna ' +
      '"No sistema" mostra o título que o lote vai usar — com o líquido, o bruto e o que foi retido; ' +
      'para ver os outros ou buscar um título diferente, clique em Escolher.</div>' +
      filtroDirHTML() +
      cab(true,
        '<button class="btn-linha" id="cn-lote-poss"' + (soma.n ? '' : ' disabled') + '>' +
          'Vincular ' + (soma.n || '') + ' ao melhor candidato</button>' +
        '<button class="btn-sm btn-cancelar" id="cn-ign-lote"' + (soma.n ? '' : ' disabled') +
          '>Ignorar ' + (soma.n || '') + '</button>', soma) +
      '<div class="tabela-rolagem" style="margin:0 -14px"><table><thead><tr>' +
      '<th style="width:24px"></th><th>Data</th><th>No extrato do banco</th>' +
      '<th>No sistema</th><th class="num">Diferença</th><th>Por quê</th><th></th></tr></thead><tbody>' +
      (itens.length ? itens.map(function (i) {
        const c = i.cands[0];
        const vExtrato = Math.abs(i.linha.valor);
        return '<tr class="' + (sel.has(i.linha.id) ? 'sel' : '') + '">' + ladoExtrato(i.linha, true) +
          ladoSistema(c, vExtrato).replace('</td>', (i.cands.length > 1
            ? '<div class="sub">e mais ' + (i.cands.length - 1) + ' candidato(s)</div>' : '') + '</td>') +
          difCelula(vExtrato, c) +
          '<td class="sub">' + U.esc((c.motivo || '').slice(0, 50)) + '</td>' +
          '<td class="acoes"><button class="btn-sm btn-aprovar" data-cn-ver="' + i.linha.id + '">' +
            (abertaLinha === i.linha.id ? 'Fechar' : 'Escolher') + '</button></td></tr>' +
          (abertaLinha === i.linha.id ? painel(i.linha, i.cands) : '');
      }).join('')
        : '<tr><td colspan="7" class="vazio"><strong>Nada aqui.</strong></td></tr>') +
      '</tbody></table></div>';
  }

  /* ── sem vínculo: lançar, buscar ou ignorar ─────────────*/
  function telaSem(itensTodos) {
    const itens = porDirecao(itensTodos);
    const soma = somaSel(itens);
    const tarifas = itens.filter(function (i) { return i.linha.tarifa; });
    return '<div class="ajuda" style="margin:10px 0">Sem candidato. Lance como despesa (tarifa, imposto, ' +
      'débito), procure o título na mão ou marque como ignorado.</div>' +
      filtroDirHTML() +
      cab(true,
        '<button class="btn-linha" id="cn-lancar-lote"' + (soma.n ? '' : ' disabled') + '>' +
          'Lançar ' + (soma.n || '') + ' como despesa</button>' +
        '<button class="btn-sm btn-cancelar" id="cn-ign-lote"' + (soma.n ? '' : ' disabled') +
          '>Ignorar ' + (soma.n || '') + '</button>' +
        (tarifas.length ? '<button class="btn-sm" id="cn-marcar-tarifas">Marcar as ' +
          tarifas.length + ' tarifas</button>' : ''), soma) +
      '<div class="tabela-rolagem" style="margin:0 -14px"><table><thead><tr>' +
      '<th style="width:24px"></th><th>Data</th><th>No extrato do banco</th>' +
      '<th></th></tr></thead><tbody>' +
      (itens.length ? itens.map(function (i) {
        const l = i.linha;
        return '<tr class="' + (sel.has(l.id) ? 'sel' : '') + '">' + linhaBase(l, true) +
          '<td class="acoes">' +
            (l.saida > 0
              ? '<button class="btn-sm" data-cn-lanc="' + l.id + '">Lançar</button>'
              : '<button class="btn-sm" data-cn-rec="' + l.id + '">Lançar como receita</button>') +
            '<button class="btn-sm" data-cn-buscar="' + l.id + '">Buscar título</button>' +
            '<button class="btn-sm btn-cancelar" data-cn-ign="' + l.id + '">Ignorar</button>' +
          '</td></tr>';
      }).join('')
        : '<tr><td colspan="5" class="vazio"><strong>Nada sem vínculo.</strong></td></tr>') +
      '</tbody></table></div>';
  }

  /* ── produtividade: o fechamento sai picado ─────────────*/
  const BADGE_PROD = {
    nao_pago:     '<span class="badge b-reprovado">não pago</span>',
    identificado: '<span class="badge b-aguardando">saiu no extrato</span>',
    pago:         '<span class="badge b-pago">pago</span>'
  };

  function telaProdutividade(grupos) {
    const geral = grupos.reduce(function (a, f) {
      a.medicos += f.total; a.naoPagos += f.naoPagos; a.pagos += f.pagos;
      a.aberto += f.valorAberto; a.pago += f.valorPago; return a;
    }, { medicos: 0, naoPagos: 0, pagos: 0, aberto: 0, pago: 0 });

    return '<div class="ajuda" style="margin:10px 0">A produtividade é paga de uma vez, mas cai no ' +
      'extrato como um PIX por médico. Só aparecem aqui os fechamentos que encostaram neste extrato — ' +
      'com linha identificada, sugerida ou já conciliada. Dentro de cada um, os não pagos vêm primeiro.</div>' +
      (grupos.length
        ? '<div class="pr-confere" style="margin:0 0 10px">' +
            '<span>Fechamentos <b>' + grupos.length + '</b></span>' +
            '<span>Médicos <b>' + geral.medicos + '</b></span>' +
            '<span>Não pagos <b class="' + (geral.naoPagos ? 'erro' : '') + '">' + geral.naoPagos + '</b></span>' +
            '<span>Pagos <b>' + geral.pagos + '</b></span>' +
            '<span>Em aberto <b>' + U.brl(geral.aberto) + '</b></span>' +
            '<span>Já pago <b>' + U.brl(geral.pago) + '</b></span>' +
          '</div>' +
          '<div class="ap-acoes"><button class="btn-sm" id="cn-prod-csv">Exportar todos os ' +
            grupos.length + '</button></div>'
        : '') +
      (grupos.length ? grupos.map(function (f) {
        const falta = f.faltando.length;
        return '<div class="card" style="margin:0 0 12px">' +
          '<h2 style="font-size:13px;margin:0 0 6px">' + U.esc(f.doc || 'Fechamento') +
            ' <span class="sub">· competência ' + U.fComp(f.comp) + '</span></h2>' +
          '<div class="pr-confere" style="margin:0 0 8px">' +
            '<span>Médicos <b>' + f.total + '</b></span>' +
            '<span>Não pagos <b class="' + (f.naoPagos ? 'erro' : '') + '">' + f.naoPagos + '</b></span>' +
            '<span>Pagos <b>' + f.pagos + '</b></span>' +
            '<span>Identificados no extrato <b>' + f.identificados + '</b></span>' +
            '<span>Em aberto <b>' + U.brl(f.valorAberto) + '</b></span>' +
            '<span>Total do fechamento <b>' + U.brl(f.valorTotal) + '</b></span>' +
          '</div>' +
          '<div class="ap-acoes">' +
            (f.identificados
              ? '<button class="btn-linha" data-cn-prod="' + U.esc(f.chave) + '">' +
                'Conciliar os ' + f.identificados + ' identificados</button>'
              : '') +
            '<button class="btn-sm" data-cn-prod-csv="' + U.esc(f.chave) + '">' +
              'Exportar este fechamento</button>' +
          '</div>' +
          '<table data-prod-tab="' + U.esc(f.chave) + '"><thead><tr><th>Médico</th>' +
          '<th class="num">Valor do fechamento</th><th>Situação</th><th>No extrato</th>' +
          '<th class="num">Valor pago</th><th>Pago em</th></tr></thead><tbody>' +
          f.itens.map(function (i) {
            return '<tr><td class="desc">' + U.esc(i.medico) + '</td>' +
              '<td class="num">' + U.brl(i.valor) + '</td>' +
              '<td>' + (BADGE_PROD[i.situacao] || '') + '</td>' +
              '<td class="sub">' + (i.linha
                ? U.fData(i.linha.data) + ' · ' + U.esc(S.nomeDaLinha(i.linha).slice(0, 26))
                : '—') + '</td>' +
              '<td class="num">' + (i.pago ? U.brl(i.valor)
                : (i.linha ? U.brl(Math.abs(i.linha.valor)) : '—')) + '</td>' +
              '<td class="mono sub">' + (i.pago_em ? U.fData(i.pago_em) : '—') + '</td></tr>';
          }).join('') + '</tbody></table>' +
          (falta ? '<div class="ajuda erro">Ainda não pagos: ' +
            f.faltando.slice(0, 6).map(function (i) { return U.esc(i.medico); }).join(', ') +
            (falta > 6 ? ' e mais ' + (falta - 6) : '') + '.</div>' : '') +
          '</div>';
      }).join('')
        : '<div class="vazio"><strong>Nenhum fechamento de produtividade lançado.</strong>' +
          'Importe a produtividade e gere os títulos: os fechamentos aparecem aqui, pagos e não pagos.</div>');
  }

  /* Relatório da produtividade: não pagos primeiro, pagos depois.
     Sem argumento sai tudo; com a chave, só aquele fechamento. */
  function exportarProdutividade(chave) {
    let grupos = S.gruposProdutividade(U.val('cn-banco'));
    if (chave) grupos = grupos.filter(function (f) { return f.chave === chave; });
    if (!grupos.length) return ERP.app.aviso('Nada de produtividade para exportar.', 'erro');
    const asp = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const linhas = [['Situação', 'Fechamento', 'Competência', 'Médico', 'Valor do fechamento',
                     'Data no extrato', 'Valor pago', 'Pago em'].map(asp).join(';')];
    const rotulo = { nao_pago: 'Não pago', identificado: 'Saiu no extrato', pago: 'Pago' };

    ['nao_pago', 'identificado', 'pago'].forEach(function (sit) {
      grupos.forEach(function (f) {
        f.itens.filter(function (i) { return i.situacao === sit; }).forEach(function (i) {
          linhas.push([rotulo[sit], f.doc || 'Fechamento', U.fComp(f.comp), i.medico,
            U.num(i.valor), i.linha ? U.fData(i.linha.data) : '',
            i.pago ? U.num(i.valor) : (i.linha ? U.num(Math.abs(i.linha.valor)) : ''),
            i.pago_em ? U.fData(i.pago_em) : ''].map(asp).join(';'));
        });
      });
    });

    const nome = chave
      ? 'produtividade-' + String(grupos[0].doc || 'fechamento')
          .replace(/[^A-Za-z0-9-]+/g, '-').toLowerCase() + '.csv'
      : 'produtividade-pagamentos.csv';
    U.baixar(nome, linhas.join('\n'));
    ERP.app.aviso((linhas.length - 1) + ' linha(s) exportada(s), não pagos primeiro.', 'ok');
  }

  /* ── regras aprendidas ──────────────────────────────────*/
  function telaRegras() {
    const rs = S.regras();
    return '<div class="ajuda" style="margin:10px 0">A memória do sistema. Cada regra diz o que fazer ' +
      'quando aquele favorecido aparecer de novo no extrato — é assim que a conciliação vai ficando ' +
      'automática sem chutar por valor.</div>' +
      '<table><thead><tr><th>Quando aparecer</th><th>Fornecedor</th><th>Natureza</th>' +
      '<th>Centro</th><th class="num">Usos</th><th></th></tr></thead><tbody>' +
      (rs.length ? rs.map(function (r) {
        return '<tr><td class="desc mono">' + U.esc(r.chave) + '</td>' +
          '<td>' + U.esc((D.credor(r.credor) || {}).nome || '—') + '</td>' +
          '<td class="sub">' + U.esc(r.conta || '—') + '</td>' +
          '<td class="sub">' + U.esc((D.centro(r.centro) || {}).curto || '—') + '</td>' +
          '<td class="num">' + (r.usos || 0) + '</td>' +
          '<td class="acoes"><button class="btn-sm btn-cancelar" data-cn-rx="' + r.id + '">Excluir</button></td></tr>';
      }).join('')
        : '<tr><td colspan="6" class="vazio"><strong>Nenhuma regra ainda.</strong>' +
          'Elas nascem quando você lança uma linha e marca "lembrar disso".</td></tr>') +
      '</tbody></table>';
  }

  function telaFeitos(banco) {
    const feitos = S.linhasExtrato({ banco: banco }).filter(function (l) {
      return l.situacao !== 'pendente'; });
    return '<div class="tabela-rolagem" style="margin:10px -14px 0"><table><thead><tr>' +
      '<th>Data</th><th class="num">Valor</th><th>Descrição extrato</th>' +
      '<th>Situação</th></tr></thead><tbody>' +
      (feitos.length ? feitos.map(function (l) {
        return '<tr>' + linhaBase(l, false) +
          '<td>' + (l.situacao === 'conciliado'
            ? '<span class="badge b-pago">conciliado</span>'
            : '<span class="badge b-cancelado">ignorado</span>') +
            (l.observacao ? '<div class="sub">' + U.esc(l.observacao) + '</div>' : '') +
            /* As três ações existiam no store e não tinham caminho
               pela tela: linha conciliada por engano, linha ignorada
               por engano, e linha certa amarrada ao pagamento errado.
               Sem elas, a única saída era estornar o pagamento, que
               destrói informação verdadeira. */
            '<div class="ap-acoes" style="margin-top:4px">' +
              (l.situacao === 'conciliado'
                ? '<button class="btn-sm" data-desconc="' + l.id + '">Desfazer</button>' +
                  '<button class="btn-sm" data-reaponta="' + l.id + '">Trocar linha</button>'
                : '<button class="btn-sm" data-reabre="' + l.id + '">Reabrir</button>') +
            '</div>' +
          '</td></tr>';
      }).join('')
        : '<tr><td colspan="4" class="vazio"><strong>Nada conciliado ainda.</strong></td></tr>') +
      '</tbody></table></div>';
  }

  /* Recebimento abaixo do líquido esperado não tem resposta certa
     sozinha: pode ser glosa/multa de verdade, ou só faltou completar.
     Em vez de forçar uma escolha na hora (o antigo confirm() só dava
     OK/Cancelar, sem chance de recuar), mostra os números num modal de
     verdade — com Quitar, Manter resíduo, e o X/Fechar de sempre pra
     quem preferir não decidir agora e ir corrigir o faturamento ou
     lançar uma glosa manual antes de voltar. */
  /* Liga as três ações de desfazer da aba "já conciliados". */
  function ligarDesfazer() {
    document.querySelectorAll('[data-desconc]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = this.dataset.desconc;
        ERP.app.modal({
          titulo: 'Desfazer a conciliação',
          corpo: '<label>Por quê?</label><input id="dc-motivo" placeholder="ex.: amarrei na linha errada">' +
            '<div class="ajuda">A linha volta para pendente e pode ser conciliada de novo. ' +
            'Se houver pagamento liquidado atrás dela, o sistema recusa e explica — nesse caso o ' +
            'caminho é estornar o pagamento, ou trocar a linha.</div>',
          acoes: [{ txt: 'Desfazer', cls: 'btn-aprovar', fn: function () {
            const r = S.desconciliar(id, U.val('dc-motivo'));
            if (ERP.app.erroDoRetorno(r)) return;
            ERP.app.fecharModal(); render();
            ERP.app.aviso('Conciliação desfeita — a linha voltou para pendente.', 'ok');
          } }]
        });
      });
    });
    document.querySelectorAll('[data-reabre]').forEach(function (b) {
      b.addEventListener('click', function () {
        const r = S.reabrirLinha(this.dataset.reabre, 'reaberta na tela');
        if (ERP.app.erroDoRetorno(r)) return;
        render();
        ERP.app.aviso('Linha reaberta — voltou para a fila de conciliação.', 'ok');
      });
    });
    document.querySelectorAll('[data-reaponta]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = this.dataset.reaponta;
        const atual = S.linhasExtrato({}).find(function (x) { return x.id === id; }) || {};
        /* Candidatas: pendentes da mesma conta e do mesmo valor — é o
           caso real, a mesma saída registrada na linha errada. */
        const cand = S.linhasExtrato({ banco: atual.banco }).filter(function (x) {
          return x.situacao === 'pendente' &&
            Math.abs(Math.abs(x.valor) - Math.abs(atual.valor)) < 0.02;
        });
        if (!cand.length) {
          return ERP.app.aviso('Não há outra linha pendente desta conta com o mesmo valor.', 'erro');
        }
        ERP.app.modal({
          titulo: 'Trocar a linha que comprova o pagamento',
          corpo: '<div class="ajuda">O pagamento não muda — muda a linha do extrato que o ' +
            'comprova. Use quando a conciliação foi feita na linha errada e o dinheiro saiu mesmo.</div>' +
            '<label>Linha correta</label><select id="rp-nova">' +
            cand.map(function (x) {
              return '<option value="' + x.id + '">' + U.fData(x.data) + ' · ' +
                U.brl(Math.abs(x.valor)) + ' · ' + U.esc((x.memo || '').slice(0, 44)) + '</option>';
            }).join('') + '</select>' +
            '<label>Motivo</label><input id="rp-motivo" placeholder="ex.: a saída foi a do dia 12">',
          acoes: [{ txt: 'Trocar', cls: 'btn-aprovar', fn: function () {
            const r = S.reapontarConciliacao(id, U.val('rp-nova'), U.val('rp-motivo'));
            if (ERP.app.erroDoRetorno(r)) return;
            ERP.app.fecharModal(); render();
            ERP.app.aviso('Vínculo movido para a outra linha.', 'ok');
          } }]
        });
      });
    });
  }

  function perguntarResiduo(r, aoDecidir) {
    ERP.app.modal({
      titulo: 'Recebimento abaixo do esperado',
      corpo: '<div class="ajuda">' + U.esc(r.mensagem) + '</div>' +
        '<div class="ajuda">Feche esta janela (✕ ou "Fechar") se preferir não decidir agora — nada ' +
        'é alterado, e dá pra corrigir o faturamento ou lançar uma glosa manual antes de voltar aqui.</div>',
      acoes: [
        { txt: 'Quitar (glosa de ' + U.brl(r.resta) + ')', cls: 'btn-pagar', fn: function () {
            ERP.app.fecharModal(); aoDecidir('quitar');
          } },
        { txt: 'Manter resíduo em aberto', cls: 'btn-sm', fn: function () {
            ERP.app.fecharModal(); aoDecidir('residual');
          } }
      ]
    });
  }

  /* ── painel de candidatos ───────────────────────────────*/
  function painel(l, cands) {
    return '<tr><td colspan="7" style="background:#fafbfc;padding:10px 8px">' +
      '<div class="ajuda" style="margin:0 0 6px">Extrato: <b>' + U.brl(Math.abs(l.valor)) + '</b> em ' +
        U.fData(l.data) + ' · ' + U.esc((l.contraparte || l.memo || '').slice(0, 48)) + '</div>' +
      '<table style="margin:0"><thead><tr><th>Título no sistema</th><th>O que é</th>' +
      '<th class="num">Líquido</th><th class="num">Bruto</th><th class="num">Diferença p/ o extrato</th>' +
      '<th class="num">Dias</th><th></th></tr></thead><tbody>' +
      cands.map(function (c) {
        return '<tr><td class="desc">' + nomeCandidato(c) + '</td>' +
          '<td class="sub">' + U.esc(c.detalhe) + '</td>' +
          /* Líquido e bruto em colunas próprias: são dois números
             diferentes e a pessoa precisa saber qual bateu. */
          '<td class="num">' + U.brl(c.valor) + '</td>' +
          '<td class="num sub">' + ((c.valorBruto !== undefined && c.valorBruto !== null &&
            Math.abs(c.valorBruto - c.valor) > 0.005) ? U.brl(c.valorBruto) : '—') + '</td>' +
          difCelula(Math.abs(l.valor), c) +
          '<td class="num sub">' + c.dias + '</td>' +
          '<td class="acoes"><button class="btn-sm btn-pagar" data-cn-ok="' + l.id +
            '" data-tipo="' + c.tipo + '" data-alvo="' + c.id + '">Vincular</button></td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="ap-acoes" style="margin-top:8px">' +
        '<button class="btn-sm" data-cn-buscar="' + l.id + '">Buscar outro título</button>' +
        (l.saida > 0
          ? '<button class="btn-sm" data-cn-lanc="' + l.id + '">Lançar como despesa</button>'
          : '<button class="btn-sm" data-cn-rec="' + l.id + '">Lançar como receita</button>') +
        '<button class="btn-sm btn-cancelar" data-cn-ign="' + l.id + '">Ignorar</button>' +
      '</div></td></tr>';
  }

  /* Entrada do extrato que não é baixa de nota: reembolso, resgate de
     aplicação, aporte, estorno de fornecedor. Nasce recebida, na data
     do extrato. */
  function lancarReceita(id) {
    const l = S.linhasExtrato().find(function (x) { return x.id === id; });
    if (!l) return;
    let modo = 'cliente';
    const nomeSugerido = (S.nomeDaLinha(l) || l.memo || '').slice(0, 60);

    const corpoOutra =
      '<label>Descrição</label><input id="rc-desc" value="' + U.esc(nomeSugerido) + '">' +
      '<div class="row2"><div><label>Natureza *</label><select id="rc-conta">' +
        D.plano.filter(function (x) { return x.nivel === 2 && (x.pai === '1' || x.pai === '10'); })
          .map(function (x) {
            return '<option value="' + x.cod + '">' + U.esc(x.cod + ' ' + x.nome) + '</option>';
          }).join('') + '</select></div>' +
      '<div><label>Centro de custo</label><select id="rc-centro">' +
        D.centros.filter(function (c) { return c.ativo; }).map(function (c) {
          return '<option value="' + c.id + '"' + (c.id === 'cc100' ? ' selected' : '') + '>' +
            U.esc(c.curto || c.nome) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="ajuda">Para reembolso, resgate de aplicação, aporte ou estorno de fornecedor — ' +
      'entrada que não é baixa de nota. Nasce recebida, na data do extrato, e entra no fluxo realizado.</div>';

    const corpoCliente =
      '<label>Cliente</label><div style="display:flex;gap:6px">' +
      '<input id="rc-cliente" list="dl-rc-clientes" style="flex:1" value="' + U.esc(nomeSugerido) + '">' +
      '<button type="button" class="btn-sm" id="rc-novo-cliente">+ cadastrar</button></div>' +
      '<datalist id="dl-rc-clientes">' + D.clientes.map(function (c) {
        return '<option value="' + U.esc(c.nome) + '">'; }).join('') + '</datalist>' +
      '<label>Projeto *</label><select id="rc-projeto">' +
        D.centros.filter(function (c) { return c.ativo && c.tipo === 'projeto'; }).map(function (c) {
          return '<option value="' + c.id + '">' + U.esc(c.curto || c.nome) + '</option>'; }).join('') + '</select>' +
      '<div class="row2"><div><label>Nº da NF (se souber)</label><input id="rc-numero"></div>' +
      '<div><label>Competência</label><input type="month" id="rc-comp" value="' + U.compDe(l.data) + '"></div></div>' +
      '<div class="ajuda">Cria a NF/título já recebido, na data do extrato — sem esperar o lançamento ' +
      'no Faturamento. Sem retenção presumida: se o cliente reteve algo, ajuste depois no título.</div>';

    const ligarCliente = function () {
      if (!U.el('rc-novo-cliente')) return;
      U.el('rc-novo-cliente').addEventListener('click', function () {
        ERP.cadastros.editarCliente(null, function (clienteId) {
          const c = D.clientes.find(function (x) { return x.id === clienteId; });
          if (!c) return;
          U.setVal('rc-cliente', c.nome);
          if (c.centro_padrao) U.setVal('rc-projeto', c.centro_padrao);
        });
      });
    };

    ERP.app.modal({
      titulo: 'Lançar recebimento não reconhecido · ' + U.brl(Math.abs(l.valor)),
      corpo:
        '<div class="resumo-linha"><span>Histórico</span><span class="v">' + U.esc(l.memo) + '</span></div>' +
        '<div class="ap-acoes" style="margin-bottom:10px">' +
          '<button type="button" class="btn-sm btn-aprovar" data-rc-modo="cliente">Pagamento de cliente</button>' +
          '<button type="button" class="btn-sm" data-rc-modo="outra">Outra receita</button>' +
        '</div>' +
        '<div id="rc-corpo">' + corpoCliente + '</div>',
      aoAbrir: function () {
        document.querySelectorAll('[data-rc-modo]').forEach(function (b) {
          b.addEventListener('click', function () {
            modo = this.dataset.rcModo;
            const btnClicado = this;
            document.querySelectorAll('[data-rc-modo]').forEach(function (x) {
              x.classList.toggle('btn-aprovar', x === btnClicado);
            });
            U.el('rc-corpo').innerHTML = modo === 'cliente' ? corpoCliente : corpoOutra;
            if (modo === 'cliente') ligarCliente();
          });
        });
        ligarCliente();
      },
      acoes: [{ txt: 'Lançar e conciliar', cls: 'btn-aprovar', fn: function () {
        if (modo === 'cliente') {
          const nomeCliente = U.val('rc-cliente');
          const cli = nomeCliente ? D.clientes.find(function (x) {
            return x.nome.toUpperCase() === nomeCliente.toUpperCase(); }) : null;
          const r = S.lancarReceberAvulso(id, {
            cliente_nome: nomeCliente, cliente_doc: cli ? cli.documento : null,
            centro: U.val('rc-projeto'), numero: U.val('rc-numero'), competencia: U.val('rc-comp')
          });
          if (ERP.app.erroDoRetorno(r)) return;
          ERP.app.fecharModal();
          abertaLinha = null;
          render();
          ERP.app.aviso('Recebimento lançado e linha conciliada.', 'ok');
        } else {
          const r = S.lancarReceitaDoExtrato(id, {
            descricao: U.val('rc-desc'), conta: U.val('rc-conta'), centro: U.val('rc-centro')
          });
          if (ERP.app.erroDoRetorno(r)) return;
          ERP.app.fecharModal();
          abertaLinha = null;
          render();
          ERP.app.aviso('Receita lançada e linha conciliada.', 'ok');
        }
      } }]
    });
  }

  /* ── busca manual na lista completa ─────────────────────*/
  function buscar(id) {
    const l = S.linhasExtrato().find(function (x) { return x.id === id; });
    const entrada = l.entrada > 0;
    const lista = entrada
      ? S.contasReceber().filter(function (r) {
          return ['previsto', 'faturado'].indexOf(r.status) > -1; })
      : S.todasParcelas().filter(function (p) {
          return ['aberto', 'parcial', 'previsto'].indexOf(p.status) > -1; });

    /* O que o motor já reconheceu vem no topo, com o pagamento nosso
       já baixado incluído — é ele que resolve a linha, e era ele que
       faltava. */
    const sugeridos = S.candidatos(l).slice(0, 4);
    const compLinha = U.compDe(l.data);
    /* Saída que paga vários títulos de uma vez (DARF único, guia que
       junta encargos): grupos que fecham o valor exato + seleção manual. */
    const grupos = entrada ? [] : S.gruposQueFecham(l);
    const multi = {};   // id do título → saldo, marcados pra vincular juntos
    const alvoLinha = Math.round(Math.abs(l.valor) * 100) / 100;

    const linhas = lista.map(function (x) {
      const o = entrada
        ? { id: x.id, tipo: 'receber', nome: x.cliente_nome, doc: 'NF ' + x.numero,
            valor: x.valor_liquido, valorBruto: x.valor_bruto, data: x.vencimento,
            competencia: x.competencia,
            centro: (D.centro(x.centro) || {}).curto || '', codigo: (D.centro(x.centro) || {}).codigo_hospital || '' }
        : { id: x.id, tipo: 'parcela', nome: ERP.lancamento.nomeCredor(x.credor),
            doc: x.doc || '', valor: S.saldoDe(x) || x.valor, data: x.venc,
            competencia: x.comp,
            centro: (D.centro((x.rateio || [])[0] ? x.rateio[0].centro : x.centro) || {}).curto || '',
            codigo: (D.centro((x.rateio || [])[0] ? x.rateio[0].centro : x.centro) || {}).codigo_hospital || '' };
      o.dif = Math.round((Math.abs(l.valor) - o.valor) * 100) / 100;
      /* Conta recorrente tem parcela igual todo mês. Ordenar só por
         proximidade de valor punha a do mês seguinte em primeiro lugar,
         e vincular ali quita o mês errado. */
      o.outroMes = U.compDe(o.data || l.data) !== compLinha;
      return o;
    }).sort(function (a, b) {
      return (a.outroMes ? 1 : 0) - (b.outroMes ? 1 : 0) ||
             Math.abs(a.dif) - Math.abs(b.dif);
    });

    const desenha = (busca) => {
      const f = (busca || '').toUpperCase();
      const vis = linhas.filter(function (x) {
        return !f || (x.nome + ' ' + x.doc + ' ' + x.centro + ' ' + x.codigo).toUpperCase().indexOf(f) > -1;
      }).slice(0, 60);
      const somaMulti = Math.round(Object.keys(multi).reduce(function (a, k) { return a + multi[k]; }, 0) * 100) / 100;
      U.el('bs-lista').innerHTML =
        (grupos.length && !busca
          ? '<div class="ajuda">Juntos, estes títulos fecham o valor da linha:</div><table><tbody>' +
            grupos.map(function (g, gi) {
              return '<tr><td class="desc">' + U.esc(g.descricao) + '<div class="sub">' + g.ids.length + ' títulos</div></td>' +
                '<td class="num">' + U.brl(g.valor) + '</td>' +
                '<td class="acoes"><button class="btn-sm btn-aprovar" data-grupo="' + gi + '">Vincular os ' + g.ids.length + '</button></td></tr>';
            }).join('') + '</tbody></table>'
          : '') +
        (!entrada
          ? '<div class="dif ' + (Math.abs(somaMulti - alvoLinha) < 0.01 && Object.keys(multi).length > 1 ? 'ok' : '') +
              '" style="margin:8px 0">Marcados: ' + Object.keys(multi).length + ' título(s), ' + U.brl(somaMulti) +
              ' de ' + U.brl(alvoLinha) +
              (Object.keys(multi).length > 1 ? ' <button class="btn-sm btn-aprovar" id="bs-multi-ok"' +
                (Math.abs(somaMulti - alvoLinha) < 0.01 ? '' : ' disabled') + '>Vincular marcados</button>' : '') + '</div>'
          : '') +
        (sugeridos.length && !busca
          ? '<div class="ajuda">Reconhecidos pelo sistema para esta linha:</div>' +
            '<table><tbody>' + sugeridos.map(function (c) {
              return '<tr><td class="desc">' + nomeCandidato(c) +
                '<div class="sub">' + U.esc(c.motivo) + '</div></td>' +
                '<td class="num">' + U.brl(c.valor) +
                  (c.valorBruto && c.valorBruto !== c.valor ? '<div class="sub">bruto ' + U.brl(c.valorBruto) + '</div>' : '') + '</td>' +
                '<td class="mono sub">' + U.fData(c.data) + '</td>' +
                '<td class="acoes"><button class="btn-sm btn-aprovar" data-bs="' +
                  U.esc(c.id) + '" data-tipo="' + c.tipo + '">Vincular</button></td></tr>';
            }).join('') + '</tbody></table>' +
            '<div class="ajuda" style="margin-top:10px">Ou escolha à mão:</div>'
          : '') +
        '<table><thead><tr>' + (entrada ? '' : '<th></th>') + '<th>' + (entrada ? 'Cliente' : 'Fornecedor') +
        '</th><th>Doc</th><th>Projeto</th><th>Comp.</th><th class="num">Valor</th><th class="num">Diferença</th>' +
        '<th>Vencimento</th><th></th></tr></thead><tbody>' +
        (vis.length ? vis.map(function (x) {
          return '<tr>' + (entrada ? '' : '<td><input type="checkbox" style="width:auto" data-multi="' + x.id + '" data-v="' + x.valor + '"' +
              (multi[x.id] !== undefined ? ' checked' : '') + '></td>') +
            '<td class="desc" title="' + U.esc(x.nome || '') + '">' + U.esc((x.nome || '—').slice(0, 26)) + '</td>' +
            '<td class="mono sub">' + U.esc(x.doc) + '</td>' +
            '<td class="sub">' + U.esc(x.centro) + (x.codigo ? ' · ' + U.esc(x.codigo) : '') + '</td>' +
            '<td class="mono sub">' + (x.competencia ? U.fComp(x.competencia) : '—') + '</td>' +
            '<td class="num">' + U.brl(x.valor) +
              (x.valorBruto && x.valorBruto !== x.valor ? '<div class="sub">bruto ' + U.brl(x.valorBruto) + '</div>' : '') + '</td>' +
            '<td class="num' + (Math.abs(x.dif) > 0.05 ? ' erro' : ' sub') + '">' +
              (Math.abs(x.dif) > 0.005 ? U.brl(x.dif) : '—') + '</td>' +
            '<td class="mono sub">' + U.fData(x.data) +
              (x.outroMes ? '<div class="sub erro">outra competência</div>' : '') + '</td>' +
            '<td class="acoes"><button class="btn-sm ' + (x.outroMes ? 'btn-cancelar' : 'btn-pagar') +
              '" data-bs="' + x.id + '" data-tipo="' + x.tipo + '"' +
              (x.outroMes ? ' data-aviso="1"' : '') + '>Vincular</button></td></tr>';
        }).join('')
          : '<tr><td colspan="9" class="vazio"><strong>Nada com esse texto.</strong></td></tr>') +
        '</tbody></table>';
      const vincularVarios = function (ids) {
        const r = S.conciliarVarios(id, ids);
        if (ERP.app.erroDoRetorno(r)) return;
        ERP.app.fecharModal();
        abertaLinha = null;
        render();
        ERP.app.aviso('Conciliado com ' + r.n + ' títulos.', 'ok');
      };
      U.el('bs-lista').querySelectorAll('[data-grupo]').forEach(function (b) {
        b.addEventListener('click', function () { vincularVarios(grupos[+this.dataset.grupo].ids); });
      });
      U.el('bs-lista').querySelectorAll('[data-multi]').forEach(function (cb) {
        cb.addEventListener('change', function () {
          if (this.checked) multi[this.dataset.multi] = +this.dataset.v; else delete multi[this.dataset.multi];
          desenha(U.val('bs-busca'));
        });
      });
      if (U.el('bs-multi-ok')) U.el('bs-multi-ok').addEventListener('click', function () { vincularVarios(Object.keys(multi)); });
      U.el('bs-lista').querySelectorAll('[data-bs]').forEach(function (b) {
        b.addEventListener('click', function () {
          /* Vincular a parcela de outra competência é possível, mas
             não por distração: é assim que se quita o mês seguinte com
             o dinheiro deste mês. */
          if (this.dataset.aviso &&
              !confirm('Esta parcela vence em outra competência. Vincular aqui dá baixa ' +
                       'no mês errado. Confirmar mesmo assim?')) return;
          const tipo = this.dataset.tipo, alvo = this.dataset.bs;
          /* Recebimento abaixo do líquido esperado não tem resposta certa
             sozinho — pode ser glosa/multa (quita) ou só faltou completar
             (segue aberto). Quem concilia decide, e a chamada se repete
             já com a decisão. */
          const tentar = function (decisao) {
            const r = S.conciliar(id, { tipo: tipo, id: alvo, decisao: decisao });
            if (ERP.app.erroDoRetorno(r)) return;
            if (r.decidir) return perguntarResiduo(r, tentar);
            ERP.app.fecharModal();
            abertaLinha = null;
            render();
            ERP.app.aviso('Conciliado.', 'ok');
          };
          tentar();
        });
      });
    };

    ERP.app.modal({
      titulo: 'Buscar título · ' + U.brl(Math.abs(l.valor)) + ' em ' + U.fData(l.data),
      corpo:
        '<div class="resumo-linha"><span>Histórico</span><span class="v">' + U.esc(l.memo) + '</span></div>' +
        '<label>Filtrar</label><input id="bs-busca" placeholder="nome, documento ou projeto">' +
        '<div id="bs-lista" style="max-height:340px;overflow:auto;margin-top:8px"></div>' +
        '<div class="ajuda">A lista vem ordenada pela proximidade do valor. Não achou? ' +
        (l.entrada > 0
          ? 'Feche e use "Ignorar" — ou lance a nota antes.'
          : 'Feche e use "Lançar como despesa": o título nasce já pago.') + '</div>',
      acoes: [],
      aoAbrir: function () {
        desenha('');
        U.el('bs-busca').addEventListener('input', function () { desenha(this.value); });
      }
    });
  }

  /* ── lançar despesa (com opção de virar regra) ──────────*/
  function lancar(ids, rascunho) {
    const lista = (Array.isArray(ids) ? ids : [ids]).map(function (id) {
      return S.linhasExtrato().find(function (x) { return x.id === id; });
    }).filter(Boolean);
    if (!lista.length) return;
    const l = lista[0];
    const total = lista.reduce(function (s, x) { return s + Math.abs(x.valor); }, 0);

    const varias = lista.length > 1;
    const todasTarifa = lista.every(function (x) { return x.tarifa; });
    /* No lote, cada linha guarda o SEU favorecido. Só a tarifa foge
       disso: ali as linhas são todas do banco e faz sentido uma
       descrição só. */
    const porLinha = varias && !todasTarifa;
    const nomeLinha = x => (S.nomeDaLinha(x) || x.memo || '').slice(0, 60);

    ERP.app.modal({
      titulo: varias
        ? 'Lançar ' + lista.length + ' linhas · ' + U.brl(total)
        : 'Lançar como despesa · ' + U.brl(Math.abs(l.valor)),
      corpo:
        (varias
          ? '<div class="ajuda">Natureza e centro de custo valem para todas. Fornecedor e descrição ' +
            'já vêm com o nome de cada linha do extrato — mude o que precisar antes de lançar. Quem ' +
            'não estiver cadastrado é cadastrado na hora, com o tipo certo pra natureza escolhida.</div>'
          : '<div class="resumo-linha"><span>Histórico</span><span class="v">' + U.esc(l.memo) + '</span></div>') +

        (porLinha
          ? tabelaEditavel(lista)
          : campoDesc(varias ? 'Tarifa bancária' : nomeLinha(l))) +

        '<label>Natureza *</label><select id="cl-conta">' +
          D.plano.filter(function (p) { return p.nivel === 2 && p.pai !== '1'; }).map(function (p) {
            return '<option value="' + p.cod + '"' + (todasTarifa && p.cod === '9.01' ? ' selected' : '') + '>' +
              U.esc(p.cod + ' ' + p.nome) + '</option>'; }).join('') + '</select>' +
        '<div class="row2"><div><label>Centro de custo' + (varias ? ' (para todas)' : '') +
          '</label><select id="cl-centro">' +
          D.centros.filter(function (c) { return c.ativo; }).map(function (c) {
            return '<option value="' + c.id + '"' + (c.id === 'cc100' ? ' selected' : '') + '>' +
              U.esc(c.curto || c.nome) + '</option>'; }).join('') + '</select></div>' +
          (porLinha ? '<div></div>' : '<div>' + campoCredor(varias ? '' : nomeLinha(l)) + '</div>') + '</div>' +

        campoNF() +
        (!varias && (l.contraparte || l.tarifa)
          ? '<label style="display:flex;gap:8px;align-items:flex-start;margin-top:10px;font-weight:400">' +
            '<input type="checkbox" id="cl-regra" style="width:auto;margin-top:3px" checked>' +
            '<span><b>Lembrar disso.</b><br><span class="sub">Da próxima vez que aparecer ' +
            '"' + U.esc(S.chaveContraparte(l).slice(0, 34)) + '" no extrato, o sistema já sugere ' +
            'este lançamento como certo.</span></span></label>'
          : '') +
        '<div class="ajuda">O título nasce pago, na data do extrato, e entra no fluxo realizado.</div>',
      aoAbrir: function () {
        if (U.el('cl-credor-sel')) {
          U.el('cl-credor-sel').addEventListener('change', function () {
            if (this.value) U.setVal('cl-credor', this.value);
          });
        }
        if (!U.el('cl-novo-credor')) return;
        /* Guarda o que já foi digitado antes de abrir o cadastro do
           fornecedor: o cadastro é outro modal e substituía este,
           jogando fora conta, centro, NF e descrição. */
        if (rascunho) {
          ['cl-conta', 'cl-centro', 'cl-credor', 'cl-nf-doc', 'cl-desc'].forEach(function (id) {
            if (U.el(id) && rascunho[id] !== undefined && rascunho[id] !== '') U.setVal(id, rascunho[id]);
          });
        }
        U.el('cl-novo-credor').addEventListener('click', function () {
          const atual = {};
          ['cl-conta', 'cl-centro', 'cl-credor', 'cl-nf-doc', 'cl-desc'].forEach(function (id) {
            if (U.el(id)) atual[id] = U.val(id);
          });
          ERP.lancamento.abrirCadastroRapido(U.val('cl-credor'), function (id, nome) {
            atual['cl-credor'] = nome;
            lancar(ids, atual);   // reabre com tudo preenchido
          }, U.val('cl-conta'));
        });
      },
      acoes: [{ txt: 'Lançar e conciliar', cls: 'btn-aprovar', fn: function () {
        /* Nome digitado que não bate com nenhum cadastro vira fornecedor
           NOVO: um erro de digitação criava duplicado em silêncio. */
        const nomeDigitado = (U.val('cl-credor') || '').trim();
        if (nomeDigitado) {
          const achou = D.credores.some(function (c) {
            return String(c.nome).trim().toLowerCase() === nomeDigitado.toLowerCase();
          });
          if (!achou && !confirm('Não existe fornecedor com o nome "' + nomeDigitado + '".\n\n' +
              'Cadastrar um novo com esse nome? Se for erro de digitação, cancele e escolha na lista.')) return;
        }
        const dados = { conta: U.val('cl-conta'), centro: U.val('cl-centro'),
          documento: U.val('cl-nf-doc') || null };
        dados.sem_nf = !dados.documento;   // sem número informado → entra no alerta até alguém preencher
        /* Uma NF não cobre várias saídas do extrato: em lote, o número
           e o anexo iam para TODAS as linhas, dando a mesma nota a
           lançamentos diferentes. */
        if (lista.length > 1 && dados.documento) {
          return ERP.app.aviso('O número da NF vale para um lançamento só. Em lote, deixe em branco e ' +
            'informe a nota depois, título a título (ação "Informar NF").', 'erro');
        }
        let itens;
        if (porLinha) {
          itens = lista.map(function (x, i) {
            return { id: x.id, credorNome: U.val('cl-cred-' + i), descricao: U.val('cl-desc-' + i) };
          });
        } else {
          dados.credorNome = U.val('cl-credor') || null;
          dados.descricao = varias ? null : U.val('cl-desc');
          itens = lista.map(function (x) { return x.id; });
        }
        const arq = U.el('cl-nf-arq') && U.el('cl-nf-arq').files && U.el('cl-nf-arq').files[0];
        const seguir = function (lembrar) {
          const r = S.lancarLote(itens, dados);
          concluirLancamento(r, l, dados, lembrar);
        };
        if (arq) {
          const lembrarArq = U.el('cl-regra') && U.el('cl-regra').checked;
          const fr = new FileReader();
          fr.onload = function () { dados.arquivo = { nome: arq.name, dados: fr.result }; seguir(lembrarArq); };
          fr.readAsDataURL(arq);
          return;
        }
        const lembrar = U.el('cl-regra') && U.el('cl-regra').checked;
        seguir(lembrar);
      } }]
    });

    /* Depois de lançar: guarda a regra (se pedido), fecha e avisa. Fica
       à parte porque o anexo da NF é lido de forma assíncrona. */
    function concluirLancamento(r, linha, dados, lembrar) {
      if (lembrar) {
        const regra = { chave: S.chaveContraparte(linha), conta: dados.conta, centro: dados.centro };
        S.salvarRegra(regra);
      }
      ERP.app.fecharModal();
      sel.clear();
      abertaLinha = null;
      render();
      ERP.app.aviso(r.n + ' lançamento(s) criado(s) e conciliado(s) · ' + U.brl(r.valor) + '.' +
        (r.erros.length ? ' ' + r.erros.length + ' falharam: ' + r.erros[0] : ''),
        r.erros.length ? 'erro' : 'ok');
    }
  }

  const campoDesc = v =>
    '<label>Descrição</label><input id="cl-desc" value="' + U.esc(v) + '">';

  /* Fornecedor: dá pra VINCULAR um já cadastrado (lista) ou digitar o
     nome — se o nome não existir, é cadastrado na hora pelo botão. */
  const campoCredor = v =>
    '<label>Fornecedor</label>' +
    '<select id="cl-credor-sel" style="margin-bottom:4px"><option value="">— escolher um fornecedor já cadastrado —</option>' +
      D.credores.filter(function (c) { return c.ativo !== false; })
        .sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome)); })
        .map(function (c) { return '<option value="' + U.esc(c.nome) + '">' + U.esc(c.nome) +
          (c.documento ? ' · ' + U.esc(c.documento) : '') + '</option>'; }).join('') + '</select>' +
    '<div style="display:flex;gap:6px">' +
    '<input id="cl-credor" list="dl-credores" value="' + U.esc(v || '') + '" style="flex:1" ' +
    'placeholder="em branco = o próprio banco">' +
    '<button type="button" class="btn-sm" id="cl-novo-credor">+ cadastrar</button></div>';

  /* NF opcional: tarifa, imposto e débito automático não têm nota. */
  const campoNF = () =>
    '<label style="margin-top:10px">Nota fiscal (opcional)</label>' +
    '<div class="row2"><input id="cl-nf-doc" placeholder="número da NF, se houver">' +
    '<input type="file" id="cl-nf-arq" accept=".pdf,.xml,.jpg,.jpeg,.png" style="border:none;padding:0"></div>' +
    '<div class="ajuda">Sem NF o título nasce como recibo e NÃO entra no alerta de "pago sem NF" — ' +
      'é o caso de tarifa, imposto e débito automático. Com o número preenchido, ele passa a cobrar o anexo.</div>';

  /* Lote com nomes diferentes por linha: cada linha edita o seu
     próprio fornecedor e descrição, já preenchidos com o nome do
     extrato daquela linha — sem isso, ou aceita tudo às cegas, ou tem
     que lançar uma por uma. Mostra TODAS as linhas, não só as
     primeiras: é justamente o lote grande que mais precisa de
     conferência antes de mandar. */
  function tabelaEditavel(lista) {
    return '<div style="max-height:320px;overflow:auto;margin:8px 0">' +
      '<table style="margin:0"><thead><tr><th>Data</th><th class="num">Valor</th>' +
      '<th>Fornecedor</th><th>Descrição</th></tr></thead><tbody>' +
      lista.map(function (x, i) {
        const nome = (S.nomeDaLinha(x) || x.memo || '').slice(0, 60);
        return '<tr><td class="mono sub">' + U.fData(x.data) + '</td>' +
          '<td class="num">' + U.brl(Math.abs(x.valor)) + '</td>' +
          '<td><input id="cl-cred-' + i + '" list="dl-credores" value="' + U.esc(nome) + '"></td>' +
          '<td><input id="cl-desc-' + i + '" value="' + U.esc(nome) + '"></td></tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  function ligar() {
    const box = U.el('cn-saida');
    box.querySelectorAll('[data-cn-dir]').forEach(function (b) {
      b.addEventListener('click', function () { filtroDir = this.dataset.cnDir; render(); });
    });
    box.querySelectorAll('[data-cn-sel]').forEach(function (chk) {
      chk.addEventListener('change', function () {
        this.checked ? sel.add(this.dataset.cnSel) : sel.delete(this.dataset.cnSel);
        render();
      });
    });
    if (U.el('cn-todos')) {
      U.el('cn-todos').addEventListener('click', function () {
        box.querySelectorAll('[data-cn-sel]').forEach(function (c) { sel.add(c.dataset.cnSel); });
        render();
      });
      U.el('cn-nada').addEventListener('click', function () { sel.clear(); render(); });
    }
    if (U.el('cn-lote')) {
      U.el('cn-lote').addEventListener('click', function () {
        const g = S.classificarLinhas(U.val('cn-banco'));
        const pares = g.concretos.filter(function (i) { return sel.has(i.linha.id); })
          .map(function (i) { return { linha: i.linha.id, alvo: i.alvo }; });
        const r = S.conciliarLote(pares);
        sel.clear();
        render();
        ERP.app.atualizarContadores();
        ERP.app.aviso(r.n + ' vínculo(s) autorizado(s)' +
          (r.erros.length ? ', ' + r.erros.length + ' com problema' : '') + '.', r.n ? 'ok' : 'erro');
      });
    }
    if (U.el('cn-lote-poss')) {
      U.el('cn-lote-poss').addEventListener('click', function () {
        const g = S.classificarLinhas(U.val('cn-banco'));
        const pares = g.possiveis.filter(function (i) { return sel.has(i.linha.id); })
          .map(function (i) { return { linha: i.linha.id, alvo: i.cands[0] }; });
        const r = S.conciliarLote(pares);
        sel.clear();
        abertaLinha = null;
        render();
        ERP.app.atualizarContadores();
        ERP.app.aviso(r.n + ' vínculo(s) feito(s)' +
          (r.erros.length ? ', ' + r.erros.length + ' com problema' : '') + '.', r.n ? 'ok' : 'erro');
      });
    }
    if (U.el('cn-ign-lote')) {
      U.el('cn-ign-lote').addEventListener('click', function () {
        const motivo = window.prompt('Por que ignorar estas ' + sel.size + ' linhas?',
          'Transferência entre contas próprias');
        if (motivo === null) return;
        let n = 0;
        Array.from(sel).forEach(function (id) { if (S.ignorarLinha(id, motivo).ok) n++; });
        sel.clear();
        render();
        ERP.app.aviso(n + ' linha(s) ignorada(s).', 'ok');
      });
    }
    if (U.el('cn-lancar-lote')) {
      U.el('cn-lancar-lote').addEventListener('click', function () { lancar(Array.from(sel)); });
    }
    if (U.el('cn-prod-csv')) {
      U.el('cn-prod-csv').addEventListener('click', function () { exportarProdutividade(); });
    }
    box.querySelectorAll('[data-cn-prod-csv]').forEach(function (b) {
      b.addEventListener('click', function () { exportarProdutividade(this.dataset.cnProdCsv); });
    });
    if (U.el('cn-marcar-tarifas')) {
      U.el('cn-marcar-tarifas').addEventListener('click', function () {
        S.classificarLinhas(U.val('cn-banco')).sem
          .filter(function (i) { return i.linha.tarifa; })
          .forEach(function (i) { sel.add(i.linha.id); });
        render();
      });
    }
    box.querySelectorAll('[data-cn-ver]').forEach(function (b) {
      b.addEventListener('click', function () {
        abertaLinha = abertaLinha === this.dataset.cnVer ? null : this.dataset.cnVer;
        render();
      });
    });
    box.querySelectorAll('[data-cn-ok]').forEach(function (b) {
      b.addEventListener('click', function () {
        const linha = this.dataset.cnOk, tipo = this.dataset.tipo, alvo = this.dataset.alvo;
        const tentar = function (decisao) {
          const r = S.conciliar(linha, { tipo: tipo, id: alvo, decisao: decisao });
          if (ERP.app.erroDoRetorno(r)) return;
          if (r.decidir) return perguntarResiduo(r, tentar);
          abertaLinha = null;
          render();
          ERP.app.aviso('Conciliado com a data do extrato.', 'ok');
        };
        tentar();
      });
    });
    /* Para saída havia "Lançar como despesa"; para entrada, só "Buscar
       título" e "Ignorar" — então uma TED de crédito sem nota
       correspondente não tinha caminho nenhum e ficava pendente para
       sempre. */
    box.querySelectorAll('[data-cn-rec]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); lancarReceita(this.dataset.cnRec); });
    });
    box.querySelectorAll('[data-cn-lanc]').forEach(function (b) {
      b.addEventListener('click', function () { lancar(this.dataset.cnLanc); });
    });
    box.querySelectorAll('[data-cn-buscar]').forEach(function (b) {
      b.addEventListener('click', function () { buscar(this.dataset.cnBuscar); });
    });
    box.querySelectorAll('[data-cn-ign]').forEach(function (b) {
      b.addEventListener('click', function () {
        const motivo = window.prompt('Por que ignorar esta linha?', 'Transferência entre contas próprias');
        if (motivo === null) return;
        S.ignorarLinha(this.dataset.cnIgn, motivo);
        abertaLinha = null;
        render();
        ERP.app.aviso('Linha ignorada.', 'ok');
      });
    });
    box.querySelectorAll('[data-cn-prod]').forEach(function (b) {
      b.addEventListener('click', function () {
        const f = S.gruposProdutividade(U.val('cn-banco'))
          .find(function (x) { return x.chave === this.dataset.cnProd; }.bind(this));
        if (!f) return;
        const pares = f.itens.filter(function (i) { return i.linha; }).map(function (i) {
          return { linha: i.linha.id, alvo: { tipo: 'parcela', id: i.parcela.id } };
        });
        const r = S.conciliarLote(pares);
        render();
        ERP.app.aviso(r.n + ' repasse(s) conciliado(s) do fechamento' +
          (f.faltando.length ? '. Faltam ' + f.faltando.length + ' médico(s) que ainda não saíram.' : '.'), 'ok');
      });
    });
    box.querySelectorAll('[data-cn-rx]').forEach(function (b) {
      b.addEventListener('click', function () {
        S.excluirRegra(this.dataset.cnRx);
        render();
        ERP.app.aviso('Regra excluída.', 'ok');
      });
    });
  }

  return { montar: montar, render: render };
})();
