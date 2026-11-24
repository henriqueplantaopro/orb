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
    opcoesContas();
    U.el('cn-banco').addEventListener('change', render);
    document.querySelectorAll('#cn-nav button').forEach(function (b) {
      b.addEventListener('click', function () { aba = this.dataset.cn; sel.clear(); render(); });
    });
  }

  /* As contas do seletor. Refeito quando o cadastro muda: conta nova
     cadastrada na Administração não aparecia aqui até recarregar a
     página — e o "mover para a conta certa" mudava para uma conta que
     o seletor nem tinha. */
  let assinaturaContas = '';
  function opcoesContas() {
    const ativas = D.bancos.filter(function (b) { return b.ativo !== false; });
    const ass = ativas.map(function (b) { return b.id + ':' + b.apelido + ':' + b.empresa; }).join('|');
    if (ass === assinaturaContas) return;
    const sel = U.el('cn-banco'), atual = sel.value;
    sel.innerHTML = ativas.map(function (b) {
      const e = D.empresaPor(b.empresa);
      return '<option value="' + b.id + '">' + U.esc(b.apelido) +
        (e ? ' · ' + U.esc(e.apelido) : '') + '</option>';
    }).join('');
    if (atual && ativas.some(function (b) { return b.id === atual; })) sel.value = atual;
    assinaturaContas = ass;
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
      let enc = ERP.ofx.codificacao(amostra);
      /* O CABEÇALHO NEM SEMPRE DIZ A VERDADE: o Bradesco declara
         CHARSET:1252 e manda o arquivo em UTF-8 — "José" virava
         "JosÃ©". Se os bytes formam UTF-8 válido com acento, é UTF-8:
         um arquivo 1252 com acento quase nunca passa nessa leitura. */
      if (enc !== 'utf-8' && bytes.some(function (b) { return b > 0x7f; })) {
        try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); enc = 'utf-8'; } catch (err) { /* é 1252 mesmo */ }
      }
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
    if (r.nao_cadastrada) {
      return ERP.app.modal({
        titulo: 'Conta do arquivo não cadastrada', fecharTxt: 'Cancelar',
        corpo: '<div class="aviso-linha erro">' + U.esc(r.erro) + '</div>',
        acoes: [{ txt: 'É desta conta — importar aqui', cls: 'btn-sm', fn: function () {
          ERP.app.fecharModal();
          aplicar(banco, Object.assign({}, lido, { importar_sem_conta: true }), nome, true);
        } }]
      });
    }
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
      (r.saldos_ignorados ? ', ' + r.saldos_ignorados + ' linha(s) de saldo ignorada(s) (não são movimento)' : '') +
      (r.futuros ? ', ' + r.futuros + ' agendamento(s) com data futura ficaram de fora (entram no extrato do dia em que acontecerem)' : '') +
      '. Saldo do extrato: ' + U.brl(lido.saldo.valor) + '.' +
      (lido.aviso_conta ? ' ' + lido.aviso_conta : ''),
      lido.aviso_conta ? 'erro' : 'ok');
  }

  function render() {
    opcoesContas();
    const banco = U.val('cn-banco');
    const g = S.classificarLinhas(banco);
    const prod = S.gruposProdutividade(banco);
    const res = S.resumoConciliacao(banco);

    document.querySelectorAll('#cn-nav button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.cn === aba);
      const n = { concretos: g.concretos.length, possiveis: g.possiveis.length,
                  sem: g.sem.length, produtividade: prod.length,
                  regras: S.regras().length,
                  /* arquivos no período escolhido, de todas as contas */
                  feitos: S.conciliacoesPorArquivo(filtroFeitos()).grupos.length }[b.dataset.cn];
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
      '</div>' + blocoExtratos(banco) + blocoConferencia(banco) +
      (aba === 'concretos'     ? telaConcretos(g.concretos) :
       aba === 'possiveis'     ? telaPossiveis(g.possiveis) :
       aba === 'sem'           ? telaSem(g.sem) :
       aba === 'produtividade' ? telaProdutividade(prod) :
       aba === 'regras'        ? telaRegras() : telaFeitos());
    ligar();
    ligarDesfazer();
    if (aba === 'feitos') ligarFeitos();
  }

  /* Os arquivos importados nesta conta, com a saída para o caso do
     arquivo que entrou na conta errada: mover para a certa. */
  let extratosAbertos = false;
  function blocoExtratos(banco) {
    const es = S.extratosDaConta(banco);
    if (!es.length) return '';
    return '<details id="cn-extratos" style="margin:8px 0"' + (extratosAbertos ? ' open' : '') + '><summary class="sub" style="cursor:pointer">' +
      'Arquivos importados nesta conta (' + es.length + ')</summary>' +
      '<table class="rel"><thead><tr><th>Arquivo</th><th>Período</th><th class="num">Linhas</th>' +
      '<th class="num">Conciliadas</th><th class="num">Saldo do arquivo</th><th>Importado</th><th></th></tr></thead><tbody>' +
      es.map(function (x) {
        const e = x.extrato;
        const quando = e.criado_em ? new Date(e.criado_em) : null;
        return '<tr><td class="desc">' + U.esc(e.arquivo || '—') + '</td>' +
          '<td class="mono">' + (e.periodo_ini ? U.fData(e.periodo_ini) : '—') + ' a ' + (e.periodo_fim ? U.fData(e.periodo_fim) : '—') + '</td>' +
          '<td class="num">' + x.linhas + '</td><td class="num">' + x.conciliadas + '</td>' +
          '<td class="num">' + U.num(e.saldo || 0) + '</td>' +
          '<td class="sub">' + (quando && !isNaN(quando) ? U.fData(quando.toISOString().slice(0, 10)) : '') +
            (e.usuario ? ' · ' + U.esc(e.usuario) : '') + '</td>' +
          '<td class="acoes">' + (x.conciliadas ? '' :
            '<button class="btn-sm" data-cn-mover="' + e.id + '">Mover para outra conta</button>') + '</td></tr>';
      }).join('') + '</tbody></table></details>';
  }

  function moverExtratoTela(id) {
    const atual = U.val('cn-banco');
    const contas = D.bancos.filter(function (b) { return b.ativo !== false && b.id !== atual; });
    const nomeEmp = e => (D.empresaPor(e) || {}).apelido || e || '';
    ERP.app.modal({
      titulo: 'Mover o arquivo para a conta certa',
      corpo: '<div class="ajuda">As linhas deste arquivo e o saldo dele saem desta conta e vão para a escolhida. ' +
        'Linhas de saldo (ex.: "SALDO ANTERIOR" do Itaú) ficam ignoradas na mudança.</div>' +
        '<label for="mv-conta">Conta certa</label><select id="mv-conta"><option value="">escolha…</option>' +
        contas.map(function (b) {
          return '<option value="' + b.id + '">' + U.esc(b.apelido) + ' · ' + U.esc(nomeEmp(b.empresa)) + '</option>';
        }).join('') + '</select>',
      acoes: [{ txt: 'Mover', cls: 'btn-aprovar', fn: function () {
        const destino = U.val('mv-conta');
        const r = S.moverExtrato(id, destino);
        if (ERP.app.erroDoRetorno(r)) return;
        ERP.app.fecharModal();
        opcoesContas();
        U.el('cn-banco').value = destino;
        render();
        ERP.app.aviso(r.movidas + ' linha(s) movida(s)' + (r.saldos ? ' (' + r.saldos + ' de saldo, ignoradas)' : '') +
          (r.ignoradas_duplicadas ? '; ' + r.ignoradas_duplicadas + ' já estavam na conta certa' : '') +
          '. A tela agora mostra a conta certa.', 'ok');
      } }]
    });
  }

  /* ── conferência: o que ficou torto na conciliação ──────
     Aparece só quando há algo: duas linhas do extrato no MESMO
     pagamento (as duas faturas iguais da Claro — a segunda ficou com
     o título aberto) e linha conciliada com valor diferente do
     pagamento (boleto com juros baixado pelo valor da nota). */
  function blocoConferencia(banco) {
    const c = S.conferenciaConciliacao(banco);
    if (!c.dobradas.length && !c.diferencas.length) return '';
    return '<div class="card" style="border-left:3px solid var(--erro, #b42318);margin:10px 0;padding:10px 14px">' +
      '<b>Conferência da conciliação</b>' +
      c.dobradas.map(function (d) {
        return d.sobra.map(function (l) {
          return '<div class="resumo-linha"><span>' + U.esc(d.credor) + ': as linhas de ' +
            d.linhas.map(function (x) { return U.fData(x.data) + ' (' + U.brl(Math.abs(x.valor)) + ')'; }).join(' e ') +
            ' estão no MESMO pagamento — uma saída do banco ficou sem título.</span>' +
            '<span class="v"><button class="btn-sm btn-aprovar" data-cf-desfaz="' + l.id + '">Liberar a linha de ' +
            U.fData(l.data) + '</button></span></div>';
        }).join('');
      }).join('') +
      c.diferencas.map(function (d) {
        return '<div class="resumo-linha"><span>' + U.esc(d.credor) + ' · ' + U.fData(d.linha.data) + ': extrato ' +
          U.brl(d.extrato) + ', pagamento ' + U.brl(d.pago) + ' — diferença de ' + U.brl(d.diferenca) + '.</span>' +
          '<span class="v">' + (d.diferenca > 0
            ? '<button class="btn-sm btn-aprovar" data-cf-juros="' + d.linha.id + '" data-dif="' + d.diferenca +
              '" data-pago="' + d.pago + '">Lançar como juros/multa</button>'
            : '<span class="sub">extrato menor: estorne e baixe pelo valor certo</span>') + '</span></div>';
      }).join('') +
      '</div>';
  }

  /* Transferência entre as empresas do grupo: nem receita nem despesa.
     A conta da outra empresa diz quem mandou e quem recebeu. */
  function mutuo(id) {
    const l = S.linhasExtrato({}).find(function (x) { return x.id === id; });
    if (!l) return;
    const minha = S.empresaDaConta(l.banco);
    const contas = D.bancos.filter(function (b) { return b.ativo !== false && b.empresa && b.empresa !== minha; });
    if (!contas.length) {
      return ERP.app.aviso('Não há conta de outra empresa do grupo cadastrada em Bancos.', 'erro');
    }
    const entrada = l.valor > 0 || l.entrada > 0;
    const nomeEmp = e => (D.empresaPor(e) || {}).apelido || e;
    ERP.app.modal({
      titulo: 'Mútuo entre empresas · ' + U.brl(Math.abs(l.valor)),
      corpo: '<div class="ajuda">' + (entrada
          ? 'Dinheiro que <b>entrou</b> na ' + U.esc(nomeEmp(minha)) + ' vindo de outra empresa do grupo. ' +
            'Não é receita: a ' + U.esc(nomeEmp(minha)) + ' passa a <b>dever</b> à empresa que mandou.'
          : 'Dinheiro que <b>saiu</b> da ' + U.esc(nomeEmp(minha)) + ' para outra empresa do grupo. ' +
            'Não é despesa: a empresa que recebeu passa a <b>dever</b> à ' + U.esc(nomeEmp(minha)) + '.') + '</div>' +
        '<label for="mt-conta">' + (entrada ? 'Veio da conta' : 'Foi para a conta') + '</label>' +
        '<select id="mt-conta">' + (contas.length > 1 ? '<option value="">escolha…</option>' : '') +
          contas.map(function (b) {
            return '<option value="' + b.id + '">' + U.esc(nomeEmp(b.empresa)) + ' — ' + U.esc(b.apelido || b.nome) + '</option>';
          }).join('') + '</select>' +
        '<div class="ajuda" id="mt-efeito"></div>' +
        '<label for="mt-obs">Observação (opcional)</label><input id="mt-obs">',
      acoes: [{ txt: 'Conciliar como mútuo', cls: 'btn-pagar', fn: function () {
        const r = S.conciliarMutuo(id, { conta: U.val('mt-conta'), obs: U.val('mt-obs') });
        if (ERP.app.erroDoRetorno(r)) return;
        ERP.app.fecharModal(); abertaLinha = null; render();
        ERP.app.aviso((r.outro_lado ? 'Outro lado do mútuo amarrado' : 'Mútuo registrado') + ': ' +
          r.transferencia.mutuo.devedora_nome + ' deve ' + U.brl(r.transferencia.valor) + ' à ' +
          r.transferencia.mutuo.credora_nome + '.', 'ok');
      } }],
      aoAbrir: function () {
        const efeito = function () {
          const b = D.banco(U.val('mt-conta'));
          U.el('mt-efeito').textContent = !b ? '' : entrada
            ? nomeEmp(minha) + ' passa a dever ' + U.brl(Math.abs(l.valor)) + ' à ' + nomeEmp(b.empresa) + '.'
            : nomeEmp(b.empresa) + ' passa a dever ' + U.brl(Math.abs(l.valor)) + ' à ' + nomeEmp(minha) + '.';
        };
        U.el('mt-conta').addEventListener('change', efeito);
        efeito();
      }
    });
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
            '<button class="btn-sm" data-cn-mutuo="' + l.id + '" title="Transferência entre empresas do grupo">Mútuo</button>' +
            '<button class="btn-sm" data-cn-buscar="' + l.id + '">Buscar título</button>' +
            '<button class="btn-sm btn-cancelar" data-cn-ign="' + l.id + '">Ignorar</button>' +
          '</td></tr>';
      }).join('')
        : '<tr><td colspan="5" class="vazio"><strong>Nada sem vínculo.</strong></td></tr>') +
      '</tbody></table></div>';
  }

  /* ── produtividade: o fechamento sai picado ─────────────*/
  const BADGE_PROD = {
    nao_pago:      '<span class="badge b-reprovado">não pago</span>',
    identificado:  '<span class="badge b-aguardando">saiu no extrato</span>',
    pago:          '<span class="badge b-pago">pago</span>',
    sem_pagamento: '<span class="badge b-cancelado">sem pagamento</span>'
  };
  /* Fechamentos abertos na tela. Começa tudo recolhido: a primeira
     coisa que se quer é a visão de cada produtividade, não 316 nomes. */
  const prodAbertos = new Set();

  function telaProdutividade(grupos) {
    const geral = grupos.reduce(function (a, f) {
      a.medicos += f.total; a.naoPagos += f.naoPagos; a.pagos += f.pagos; a.sem += f.semPagamento;
      a.aberto += f.valorAberto; a.pago += f.valorPago; return a;
    }, { medicos: 0, naoPagos: 0, pagos: 0, sem: 0, aberto: 0, pago: 0 });

    const detalhe = function (f) {
      const falta = f.faltando.length;
      return '<tr class="prod-det"><td colspan="8" style="background:var(--fundo-2, #f7f7f5);padding:10px 12px">' +
        '<div class="ap-acoes" style="margin:0 0 8px">' +
          (f.identificados
            ? '<button class="btn-linha" data-cn-prod="' + U.esc(f.chave) + '">Conciliar os ' + f.identificados +
              ' identificados</button>' : '') +
          '<button class="btn-sm" data-cn-prod-csv="' + U.esc(f.chave) + '">Exportar este fechamento</button>' +
        '</div>' +
        '<table class="rel" data-prod-tab="' + U.esc(f.chave) + '"><thead><tr><th>Médico</th>' +
        '<th class="num">Valor do fechamento</th><th>Situação</th><th>No extrato</th>' +
        '<th class="num">Valor pago</th><th>Pago em</th><th></th></tr></thead><tbody>' +
        f.itens.map(function (i) {
          return '<tr><td class="desc">' + U.esc(i.medico) +
              (i.sem_pagamento ? '<div class="sub">' + U.esc(i.sem_pagamento.motivo) + ' · ' +
                U.esc(i.sem_pagamento.por || '') + '</div>' : '') + '</td>' +
            '<td class="num">' + U.num(i.valor) + '</td>' +
            '<td>' + (BADGE_PROD[i.situacao] || '') + '</td>' +
            '<td class="sub">' + (i.linha
              ? U.fData(i.linha.data) + ' · ' + U.esc(S.nomeDaLinha(i.linha).slice(0, 26)) : '—') + '</td>' +
            '<td class="num">' + (i.pago ? U.num(i.valor) : (i.linha ? U.num(Math.abs(i.linha.valor)) : '—')) + '</td>' +
            '<td class="mono sub">' + (i.pago_em ? U.fData(i.pago_em) : '—') + '</td>' +
            '<td class="acoes">' + (i.situacao === 'nao_pago'
              ? '<button class="btn-sm" data-prod-sempg="' + i.parcela.id + '">Não vai ter pagamento</button>'
              : i.situacao === 'sem_pagamento'
                ? '<button class="btn-sm" data-prod-desfaz="' + i.parcela.id + '">Desfazer</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>' +
        (falta ? '<div class="ajuda erro">Ainda não pagos: ' +
          f.faltando.slice(0, 6).map(function (i) { return U.esc(i.medico); }).join(', ') +
          (falta > 6 ? ' e mais ' + (falta - 6) : '') + '. Se algum não vai receber, use "Não vai ter pagamento".</div>' : '') +
        '</td></tr>';
    };

    return '<div class="ajuda" style="margin:10px 0">A produtividade é paga de uma vez, mas cai no ' +
      'extrato como um PIX por médico. Cada linha abaixo é UMA produtividade importada (o projeto e o arquivo) ' +
      'que encostou neste extrato. Clique para abrir os médicos.</div>' +
      (grupos.length
        ? '<div class="pr-confere" style="margin:0 0 10px">' +
            '<span>Produtividades <b>' + grupos.length + '</b></span>' +
            '<span>Médicos <b>' + geral.medicos + '</b></span>' +
            '<span>Não pagos <b class="' + (geral.naoPagos ? 'erro' : '') + '">' + geral.naoPagos + '</b></span>' +
            '<span>Pagos <b>' + geral.pagos + '</b></span>' +
            (geral.sem ? '<span>Sem pagamento <b>' + geral.sem + '</b></span>' : '') +
            '<span>Em aberto <b>' + U.brl(geral.aberto) + '</b></span>' +
            '<span>Já pago <b>' + U.brl(geral.pago) + '</b></span>' +
          '</div>' +
          '<div class="ap-acoes"><button class="btn-sm" id="cn-prod-abrir">Expandir todas</button>' +
            '<button class="btn-sm" id="cn-prod-fechar">Recolher todas</button>' +
            '<button class="btn-sm" id="cn-prod-csv">Exportar todas</button></div>' +
          '<div class="tabela-rolagem" style="margin:0 -14px"><table class="rel"><thead><tr>' +
            '<th>Produtividade</th><th>Competência</th><th class="num">Médicos</th><th class="num">Pagos</th>' +
            '<th class="num">Não pagos</th><th class="num">Em aberto</th><th class="num">Pago</th>' +
            '<th class="num">Total</th></tr></thead><tbody>' +
          grupos.map(function (f) {
            const aberto = prodAbertos.has(f.chave);
            return '<tr data-prod-toggle="' + U.esc(f.chave) + '" style="cursor:pointer">' +
                '<td class="desc"><b>' + (aberto ? '▾ ' : '▸ ') + U.esc(f.titulo) + '</b>' +
                  (f.arquivo || f.periodo ? '<div class="sub">' + U.esc([f.arquivo, f.periodo].filter(Boolean).join(' · ')) +
                    '</div>' : '') + '</td>' +
                '<td class="mono">' + U.fComp(f.comp) + '</td>' +
                '<td class="num">' + f.total + '</td>' +
                '<td class="num">' + f.pagos + '</td>' +
                '<td class="num' + (f.naoPagos ? ' erro' : '') + '">' + f.naoPagos +
                  (f.semPagamento ? '<div class="sub">+' + f.semPagamento + ' sem pagamento</div>' : '') + '</td>' +
                '<td class="num">' + U.num(f.valorAberto) + '</td>' +
                '<td class="num">' + U.num(f.valorPago) + '</td>' +
                '<td class="num">' + U.num(f.valorTotal) + '</td></tr>' +
              (aberto ? detalhe(f) : '');
          }).join('') + '</tbody></table></div>'
        : '<div class="vazio"><strong>Nenhum fechamento de produtividade encostou neste extrato.</strong>' +
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
    const rotulo = { nao_pago: 'Não pago', identificado: 'Saiu no extrato', pago: 'Pago', sem_pagamento: 'Sem pagamento' };

    ['nao_pago', 'identificado', 'pago', 'sem_pagamento'].forEach(function (sit) {
      grupos.forEach(function (f) {
        f.itens.filter(function (i) { return i.situacao === sit; }).forEach(function (i) {
          linhas.push([rotulo[sit], f.titulo || f.doc || 'Fechamento', U.fComp(f.comp), i.medico,
            U.num(i.valor), i.linha ? U.fData(i.linha.data) : '',
            i.pago ? U.num(i.valor) : (i.linha ? U.num(Math.abs(i.linha.valor)) : ''),
            i.pago_em ? U.fData(i.pago_em) : ''].map(asp).join(';'));
        });
      });
    });

    const nome = chave
      ? 'produtividade-' + String(grupos[0].titulo || grupos[0].doc || 'fechamento')
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

  /* ── JÁ CONCILIADOS: uma conciliação por arquivo ───────
     Era uma lista só, de todas as linhas da conta desde o primeiro
     extrato — infinita. Agora abre nos últimos 30 dias, agrupada pelo
     arquivo importado: por fora, o resumo (arquivo, empresa, banco,
     período, entradas, saídas); clicando, tudo o que foi feito em
     cada linha daquele arquivo. Todas as contas por padrão, porque o
     resumo já diz de qual empresa e banco é cada arquivo. */
  const feitos = { de: null, ate: null, conta: '', abertos: new Set() };
  function filtroFeitos() {
    if (!feitos.de) { feitos.ate = U.hoje(); feitos.de = U.addDias(U.hoje(), -30); }
    return { de: feitos.de, ate: feitos.ate, banco: feitos.conta || null, abertos: Array.from(feitos.abertos) };
  }
  function telaFeitos() {
    const r = S.conciliacoesPorArquivo(filtroFeitos());
    const contas = D.bancos.filter(function (b) { return b.ativo !== false; });
    const NUM = 'style="width:130px"';
    return '<div class="filtros" style="margin-top:10px">' +
        '<div class="f"><label for="cf-de">De</label><input type="date" id="cf-de" value="' + U.esc(feitos.de) + '"></div>' +
        '<div class="f"><label for="cf-ate">até</label><input type="date" id="cf-ate" value="' + U.esc(feitos.ate) + '"></div>' +
        '<div class="f"><label for="cf-conta">Conta</label><select id="cf-conta"><option value="">todas as contas</option>' +
          contas.map(function (b) {
            const e = D.empresaPor(b.empresa);
            return '<option value="' + b.id + '"' + (feitos.conta === b.id ? ' selected' : '') + '>' +
              U.esc(b.apelido) + (e ? ' · ' + U.esc(e.apelido) : '') + '</option>';
          }).join('') + '</select></div>' +
        '<button class="btn-sm" id="cf-30" style="align-self:flex-end">Últimos 30 dias</button>' +
      '</div>' +
      '<div class="pr-confere"><span>Arquivos <b>' + r.grupos.length + '</b></span>' +
        '<span>Entradas <b>' + U.brl(r.entradas) + '</b></span>' +
        '<span>Saídas <b>' + U.brl(r.saidas) + '</b></span>' +
        /* Ignoradas à vista: nada sai da conciliação em silêncio. */
        '<span' + (r.ignoradas ? ' class="erro"' : '') + '>Ignoradas <b>' + r.ignoradas + '</b>' +
          (r.ignoradas ? ' (' + U.brl(r.valor_ignorado) + ')' : '') + '</span></div>' +
      '<div class="tabela-rolagem" style="margin:0 -14px"><table class="rel" id="cf-tabela"><thead><tr>' +
        '<th style="width:22px"></th><th>Arquivo</th><th>Empresa</th><th>Banco</th><th>Período</th>' +
        '<th class="num" ' + NUM + '>Entradas</th><th class="num" ' + NUM + '>Saídas</th>' +
        '<th class="num" style="width:110px">Conciliadas</th></tr></thead><tbody>' +
      (r.grupos.length ? r.grupos.map(function (g) {
        const aberto = feitos.abertos.has(g.id);
        return '<tr class="cf-arq" data-cf-arq="' + U.esc(g.id) + '" style="cursor:pointer" title="clique para ver o que foi feito">' +
            '<td>' + (aberto ? '▾' : '▸') + '</td>' +
            '<td class="desc"><b>' + U.esc(g.arquivo) + '</b>' +
              (g.importado_em ? '<div class="sub">importado em ' + U.fData(g.importado_em) +
                (g.importado_por ? ' · ' + U.esc(String(g.importado_por).split(' ')[0]) : '') + '</div>' : '') + '</td>' +
            '<td>' + U.esc(g.empresa || '—') + '</td>' +
            '<td>' + U.esc(g.banco || '—') + '</td>' +
            '<td class="mono">' + (g.periodo_ini ? U.fData(g.periodo_ini) : '—') + ' a ' +
              (g.periodo_fim ? U.fData(g.periodo_fim) : '—') + '</td>' +
            '<td class="num">' + U.num(g.entradas) + '</td>' +
            '<td class="num erro">' + U.num(g.saidas) + '</td>' +
            '<td class="num">' + g.conciliadas + ' de ' + g.linhas +
              (g.pendentes ? '<div class="sub erro">' + g.pendentes + ' pendente(s)</div>' : '') +
              (g.ignoradas ? '<div class="sub">' + g.ignoradas + ' ignorada(s)</div>' : '') + '</td>' +
          '</tr>' +
          (aberto ? '<tr class="cf-detalhe"><td></td><td colspan="7" style="padding:0 0 10px">' + detalheArquivo(g) + '</td></tr>' : '');
      }).join('')
        : '<tr><td colspan="8" class="vazio"><strong>Nenhum arquivo de extrato neste período.</strong> ' +
          'Mude as datas ou a conta para ver conciliações mais antigas.</td></tr>') +
      '</tbody></table></div>';
  }

  /* Tudo o que foi feito no arquivo: cada linha, a que ela foi
     amarrada, e as ações de desfazer de sempre. */
  function detalheArquivo(g) {
    return '<table><thead><tr><th>Data</th><th>Extrato</th><th>O que foi feito</th><th>Situação</th></tr></thead><tbody>' +
      g.itens.map(function (l) {
        return '<tr>' + linhaBase(l, false) +
          '<td class="desc">' + (l.vinculo ? U.esc(l.vinculo) : '<span class="sub">—</span>') +
            (l.observacao ? '<div class="sub">' + U.esc(l.observacao) + '</div>' : '') + '</td>' +
          '<td>' + (l.situacao === 'conciliado'
            ? '<span class="badge b-pago">conciliado</span>'
            : l.situacao === 'ignorado'
              ? '<span class="badge b-cancelado">ignorado</span>'
              : '<span class="badge b-aberto">pendente</span>') +
            /* As ações de desfazer de cada linha continuam aqui: linha
               conciliada por engano, ignorada por engano, ou amarrada
               na linha errada. */
            (l.situacao === 'pendente' ? '' :
              '<div class="ap-acoes" style="margin-top:4px">' +
                (l.situacao === 'conciliado'
                  ? '<button class="btn-sm" data-desconc="' + l.id + '">Desfazer</button>' +
                    '<button class="btn-sm" data-reaponta="' + l.id + '">Trocar linha</button>'
                  : '<button class="btn-sm" data-reabre="' + l.id + '">Reabrir</button>') +
              '</div>') +
          '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function ligarFeitos() {
    const tab = U.el('cf-tabela');
    if (!tab) return;
    tab.querySelectorAll('[data-cf-arq]').forEach(function (tr) {
      tr.addEventListener('click', function (ev) {
        if (ev.target.closest('button')) return;
        const id = this.dataset.cfArq;
        if (feitos.abertos.has(id)) feitos.abertos.delete(id); else feitos.abertos.add(id);
        render();
      });
    });
    const mudou = function () {
      feitos.de = U.val('cf-de') || feitos.de; feitos.ate = U.val('cf-ate') || feitos.ate;
      feitos.conta = U.val('cf-conta'); render();
    };
    ['cf-de', 'cf-ate', 'cf-conta'].forEach(function (id) { U.el(id).addEventListener('change', mudou); });
    U.el('cf-30').addEventListener('click', function () { feitos.de = null; filtroFeitos(); render(); });
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

  /* Boleto pago com atraso: o extrato veio MAIOR que o título. A
     diferença entra como juros (e multa, se houver) no pagamento — o
     título continua com o valor da nota. O campo já vem com a
     diferença inteira em juros; quem concilia separa a multa se o
     boleto mostrar. */
  function perguntarEncargos(r, aoInformar) {
    const dif = r.diferenca || 0;
    ERP.app.modal({
      titulo: 'Pago a maior que o título',
      corpo: '<div class="ajuda">O extrato saiu por <b>' + U.brl(r.total || 0) + '</b>' +
        (r.saldo !== undefined ? ' e o título é de <b>' + U.brl(r.saldo) + '</b>' : '') +
        ' — diferença de <b>' + U.brl(dif) + '</b>. Se foi pago com atraso, informe os encargos: ' +
        'o título fica com o valor da nota e a diferença vai como juros/multa no pagamento.</div>' +
        '<div class="row2"><div><label for="cj-juros">Juros</label>' +
          '<input id="cj-juros" inputmode="decimal" value="' + U.num(dif) + '"></div>' +
        '<div><label for="cj-multa">Multa</label><input id="cj-multa" inputmode="decimal" value="0,00"></div></div>' +
        '<div class="ajuda" id="cj-soma"></div>',
      acoes: [{ txt: 'Vincular com juros/multa', cls: 'btn-pagar', fn: function () {
        const vj = U.val('cj-juros'), vm = U.val('cj-multa');
        if (!U.valorValido(vj) || !U.valorValido(vm)) return ERP.app.aviso('Juros e multa: use 00.000,00.', 'erro');
        const j = U.parseValor(vj) || 0, m = U.parseValor(vm) || 0;
        ERP.app.fecharModal();
        aoInformar({ juros: j, multa: m });
      } }],
      aoAbrir: function () {
        const soma = function () {
          const t = Math.round(((U.parseValor(U.val('cj-juros')) || 0) + (U.parseValor(U.val('cj-multa')) || 0)) * 100) / 100;
          U.el('cj-soma').textContent = 'Juros + multa: ' + U.brl(t) +
            (Math.abs(t - dif) > 0.005 ? ' — a diferença é ' + U.brl(dif) + '.' : ' — fecha com a diferença.');
        };
        ['cj-juros', 'cj-multa'].forEach(function (id) { U.el(id).addEventListener('input', soma); });
        soma();
      }
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
        '<button class="btn-sm" data-cn-mutuo="' + l.id + '">Mútuo entre empresas</button>' +
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
          const tentar = function (decisao, enc) {
            const r = S.conciliar(id, { tipo: tipo, id: alvo, decisao: decisao,
              juros: enc ? enc.juros : undefined, multa: enc ? enc.multa : undefined });
            if (r.pago_a_maior && !enc) return perguntarEncargos(r, function (e) { tentar(decisao, e); });
            if (ERP.app.erroDoRetorno(r)) return;
            if (r.decidir) return perguntarResiduo(r, function (dd) { tentar(dd, enc); });
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

  /* ── IGNORAR: SÓ COM MOTIVO QUE SE PROVA (v195) ────────
     Era um prompt com "Transferência entre contas próprias" já
     escrito — um Enter e um lançamento real saía da conciliação sem
     ninguém saber. Agora a pessoa escolhe o motivo, e o sistema
     confere: cópia precisa ter a original; crédito por engano só sai
     amarrado à devolução; "outro" pede justificativa escrita. Nada
     vem marcado. */
  function perguntarIgnorar(ids) {
    const todas = S.linhasExtrato({});
    const linhas = ids.map(function (id) { return todas.find(function (x) { return x.id === id; }); }).filter(Boolean);
    if (!linhas.length) return;
    const uma = linhas.length === 1 ? linhas[0] : null;
    const cands = uma ? S.candidatosDevolucao(uma.id) : [];
    const op = function (v, titulo, ajuda, extra, desabilitada) {
      return '<label class="ig-op" style="display:block;border:1px solid var(--line);border-radius:6px;padding:8px 10px;margin:6px 0' +
        (desabilitada ? ';opacity:.55' : '') + '"><input type="radio" name="ig-tipo" value="' + v + '" style="width:auto"' +
        (desabilitada ? ' disabled' : '') + '> <b>' + titulo + '</b><div class="sub">' + ajuda + '</div>' + (extra || '') + '</label>';
    };
    ERP.app.modal({
      titulo: uma ? 'Ignorar linha · ' + U.fData(uma.data) + ' · ' + (uma.valor > 0 ? '+' : '−') + U.brl(Math.abs(uma.valor))
        : 'Ignorar ' + linhas.length + ' linhas',
      fecharTxt: 'Cancelar',
      corpo:
        '<div class="ajuda">Linha ignorada sai da conciliação e de toda conferência. Use só quando ela <b>não</b> ' +
        'é um movimento a explicar. Transferência entre contas ou empresas não se ignora: use Mútuo ou ' +
        'Transferência. Na dúvida, deixe pendente.</div>' +
        op('copia', 'Cópia de uma linha que já está no sistema',
          'A mesma data e o mesmo valor já existem nesta conta. O sistema confere antes de ignorar.') +
        (uma ? op('engano', uma.valor > 0 ? 'Recebido por engano — e já devolvido' : 'Devolução de valor recebido por engano',
          cands.length ? 'Escolha a linha ' + (uma.valor > 0 ? 'da devolução' : 'do crédito') + '. As duas saem juntas, amarradas.'
            : 'Não há ' + (uma.valor > 0 ? 'devolução' : 'crédito') + ' do mesmo valor pendente nesta empresa. ' +
              'Deixe a linha pendente até ' + (uma.valor > 0 ? 'a devolução aparecer no extrato.' : 'o crédito aparecer.'),
          cands.length ? '<select id="ig-par" style="margin-top:6px">' + cands.map(function (c) {
            return '<option value="' + c.id + '">' + U.fData(c.data) + ' · ' + (c.valor > 0 ? '+' : '−') + U.brl(Math.abs(c.valor)) +
              ' · ' + U.esc(c.banco) + ' · ' + U.esc((c.memo || '').slice(0, 40)) + '</option>';
          }).join('') + '</select>' : '', !cands.length) : '') +
        op('outro', 'Outro motivo', 'Escreva qual é. Fica gravado na linha e no histórico.') +
        '<label for="ig-motivo" style="margin-top:6px">Observação' + ' <span class="sub">(obrigatória em "Outro motivo")</span></label>' +
        '<input id="ig-motivo" maxlength="200" placeholder="ex.: lançamento informativo do banco, sem movimento">',
      acoes: [{ txt: 'Ignorar', cls: 'btn-cancelar', fn: function () {
        const marc = document.querySelector('input[name="ig-tipo"]:checked');
        if (!marc) return ERP.app.aviso('Escolha o motivo.', 'erro');
        const motivo = U.val('ig-motivo').trim();
        let n = 0; const erros = [];
        linhas.forEach(function (l) {
          const r = S.ignorarLinha(l.id, motivo, { tipo: marc.value, par: U.val('ig-par'), tela: true });
          if (r.ok) n++; else erros.push(U.fData(l.data) + ' ' + U.brl(Math.abs(l.valor)) + ': ' + r.erro);
        });
        if (!n) return ERP.app.aviso(erros[0] || 'Nada ignorado.', 'erro');
        ERP.app.fecharModal();
        sel.clear(); abertaLinha = null;
        render(); ERP.app.atualizarContadores();
        ERP.app.aviso(n + ' linha(s) ignorada(s)' + (marc.value === 'engano' ? ' junto com o par' : '') +
          (erros.length ? '. ' + erros.length + ' não: ' + erros.join(' · ') : '.'), erros.length ? 'erro' : 'ok');
      } }]
    });
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
        perguntarIgnorar(Array.from(sel));
      });
    }
    if (U.el('cn-lancar-lote')) {
      U.el('cn-lancar-lote').addEventListener('click', function () { lancar(Array.from(sel)); });
    }
    if (U.el('cn-prod-csv')) {
      U.el('cn-prod-csv').addEventListener('click', function () { exportarProdutividade(); });
    }
    box.querySelectorAll('[data-prod-toggle]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        const k = this.dataset.prodToggle;
        if (prodAbertos.has(k)) prodAbertos.delete(k); else prodAbertos.add(k);
        render();
      });
    });
    if (U.el('cn-prod-abrir')) {
      U.el('cn-prod-abrir').addEventListener('click', function () {
        S.gruposProdutividade(U.val('cn-banco')).forEach(function (f) { prodAbertos.add(f.chave); }); render();
      });
      U.el('cn-prod-fechar').addEventListener('click', function () { prodAbertos.clear(); render(); });
    }
    box.querySelectorAll('[data-prod-sempg]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = this.dataset.prodSempg;
        const p = S.parcela(id) || {};
        ERP.app.modal({
          titulo: 'Médico não vai ter pagamento',
          corpo: '<div class="ajuda"><b>' + U.esc(ERP.lancamento.nomeCredor(p.credor) || '') + '</b> · ' + U.brl(p.valor || 0) +
            '. O título dele é cancelado com o motivo — não haverá saída do banco — e o fechamento deixa de ' +
            'mostrá-lo como pendente. Dá para desfazer.</div>' +
            '<label for="sp-motivo">Por quê?</label><input id="sp-motivo" placeholder="ex.: recebeu por fora, valor indevido, desligado">',
          acoes: [{ txt: 'Confirmar: sem pagamento', cls: 'btn-cancelar', fn: function () {
            const r = S.medicoSemPagamento(id, U.val('sp-motivo'));
            if (ERP.app.erroDoRetorno(r)) return;
            ERP.app.fecharModal(); render();
            ERP.app.aviso('Médico marcado como sem pagamento — saiu dos pendentes.', 'ok');
          } }]
        });
      });
    });
    box.querySelectorAll('[data-prod-desfaz]').forEach(function (b) {
      b.addEventListener('click', function () {
        const r = S.desfazerSemPagamento(this.dataset.prodDesfaz);
        if (ERP.app.erroDoRetorno(r)) return;
        render();
        ERP.app.aviso('Desfeito — o médico voltou para "não pago".', 'ok');
      });
    });
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
        const tentar = function (decisao, enc) {
          const r = S.conciliar(linha, { tipo: tipo, id: alvo, decisao: decisao,
            juros: enc ? enc.juros : undefined, multa: enc ? enc.multa : undefined });
          if (r.pago_a_maior && !enc) return perguntarEncargos(r, function (e) { tentar(decisao, e); });
          if (ERP.app.erroDoRetorno(r)) return;
          if (r.decidir) return perguntarResiduo(r, function (dd) { tentar(dd, enc); });
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
    box.querySelectorAll('[data-cn-mover]').forEach(function (b) {
      b.addEventListener('click', function () { moverExtratoTela(this.dataset.cnMover); });
    });
    if (U.el('cn-extratos')) {
      U.el('cn-extratos').addEventListener('toggle', function () { extratosAbertos = this.open; });
    }
    box.querySelectorAll('[data-cn-mutuo]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); mutuo(this.dataset.cnMutuo); });
    });
    box.querySelectorAll('[data-cf-desfaz]').forEach(function (b) {
      b.addEventListener('click', function () {
        const r = S.desconciliar(this.dataset.cfDesfaz, 'mesmo pagamento conciliado com duas linhas do extrato');
        if (ERP.app.erroDoRetorno(r)) return;
        aba = 'sem'; render();
        ERP.app.aviso('Linha liberada — agora vincule-a ao título certo (Buscar título).', 'ok');
      });
    });
    box.querySelectorAll('[data-cf-juros]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = this.dataset.cfJuros;
        const dif = Number(this.dataset.dif), pago = Number(this.dataset.pago);
        perguntarEncargos({ diferenca: dif, saldo: pago, total: Math.round((pago + dif) * 100) / 100 }, function (e) {
          const r = S.encargosDaConciliacao(id, e);
          if (ERP.app.erroDoRetorno(r)) return;
          render();
          ERP.app.aviso('Juros/multa lançados no pagamento — o relatório passa a bater com o extrato.', 'ok');
        });
      });
    });
    box.querySelectorAll('[data-cn-buscar]').forEach(function (b) {
      b.addEventListener('click', function () { buscar(this.dataset.cnBuscar); });
    });
    box.querySelectorAll('[data-cn-ign]').forEach(function (b) {
      b.addEventListener('click', function () {
        perguntarIgnorar([this.dataset.cnIgn]);
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
