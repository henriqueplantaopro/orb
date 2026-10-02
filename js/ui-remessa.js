/* ERP · ui-remessa.js — tela de remessa e retorno bancário.
   Seleciona o que já foi aprovado, gera o arquivo do Bradesco
   (Pag-For 500 com PIX) e importa o retorno dando baixa automática. */
window.ERP = window.ERP || {};

ERP.remessa = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;
  let sel = new Set();

  function montar() {
    U.el('rm-retorno').addEventListener('change', importarRetorno);
  }

  /* Com mais de um CNPJ e mais de uma conta, a remessa não pode sair
     "da primeira conta com CNAB": o arquivo leva o CNPJ do cabeçalho e
     o banco recusa o que não é dele. A conta vem do próprio pagamento,
     e cada conta gera o seu arquivo. */
  const contaDoPagamento = pg => D.bancos.find(function (b) { return b.id === (pg || {}).banco; }) || null;

  function contasDaSelecao() {
    const ids = {};
    S.aptasParaRemessa().forEach(function (x) {
      if (!sel.has(x.pagamento.id)) return;
      const b = contaDoPagamento(x.pagamento);
      if (b) ids[b.id] = b;
    });
    return Object.keys(ids).map(function (k) { return ids[k]; });
  }

  /* Só o Bradesco tem layout implementado e validado contra arquivo
     real. Santander e Itaú entram quando os manuais chegarem. */
  const LAYOUTS_PRONTOS = { '237': 'Bradesco' };

  const contaBradesco = () => contasDaSelecao()[0] ||
    D.bancos.find(function (b) { return b.layout_remessa === 'cnab240'; }) || D.bancos[0];

  /* O que sai do banco é principal + juros + multa − desconto, não só
     o principal. Usado em toda exibição de valor nesta tela e na
     geração do arquivo — antes cada lugar somava só `pg.valor`, e o
     total mostrado (e o que ia pro CNAB) ficava menor do que o
     aprovado sempre que havia juros ou multa. */
  const totalPg = pg => Math.round((pg.valor + pg.juros + pg.multa - (pg.desconto || 0)) * 100) / 100;

  function dadosDoCredor(p) {
    const c = D.credor(p.credor) || {};
    return {
      nome: c.nome || ERP.lancamento.nomeCredor(p.credor),
      documento: c.documento || '',
      chavePix: c.pix || '',
      tipoChave: c.tipo_chave || ''
    };
  }

  function render() {
    const banco = contaBradesco();
    const todos = S.aptasParaRemessa();
    // vão no arquivo: PIX (segmentos A/B), boleto (J/J-52) e tributo (O)
    const NO_ARQUIVO = { pix: 1, boleto: 1, guia: 1 };
    /* Aqui é o ponto de corte: título aprovado que ainda não tem dado
       bancário (ou o código de barras do boleto) não entra no arquivo,
       mas aparece listado com o que falta — resolver ali é um clique,
       e é o momento certo, porque o código de barras vence. */
    const semDados = todos.filter(function (x) { return x.falta.length; });
    const comDados = todos.filter(function (x) { return !x.falta.length; });
    const fila = comDados.filter(function (x) { return NO_ARQUIVO[x.pagamento.forma_codigo || 'pix']; });
    const fora = comDados.filter(function (x) { return !NO_ARQUIVO[x.pagamento.forma_codigo || 'pix']; });
    /* O número vem do store, que conhece as remessas já geradas e a
       faixa reservada ao ERP. Antes vinha de um campo do banco que
       ninguém atualizava, e por isso saíam seis arquivos com o mesmo
       nome. */
    const seq = S.proximoSequencialRemessa();
    const selecionados = fila.filter(function (x) { return sel.has(x.pagamento.id); });
    const total = selecionados.reduce(function (s, x) { return s + totalPg(x.pagamento); }, 0);

    U.el('rm-saida').innerHTML =
      (semDados.length
        ? '<div class="aviso" style="margin-bottom:10px"><b>' + semDados.length +
          ' pagamento(s) aprovado(s) fora do arquivo</b> — falta dado bancário. ' +
          'Resolva aqui e eles entram na próxima geração:' +
          '<table class="parcelas" style="margin-top:6px"><tbody>' + semDados.map(function (x) {
            /* A descrição também é mascarada: "Salário 09/2026 — Camila"
               ao lado do valor entrega o que o sigilo esconde no nome. */
            return '<tr><td class="desc">' + U.esc(S.nomeCredorVisivel(x.parcela,
                ERP.lancamento.nomeCredor(x.parcela.credor))) +
                '<div class="sub">' + U.esc(S.descricaoVisivel(x.parcela)) + '</div></td>' +
              '<td class="num">' + U.brl(totalPg(x.pagamento)) + '</td>' +
              '<td class="mono sub">' + U.fData(x.parcela.venc) + '</td>' +
              '<td class="sub erro">' + U.esc(x.falta.join(' · ')) + '</td>' +
              '<td class="acoes">' + (x.falta.some(function (f) { return f.indexOf('código de barras') > -1; })
                ? '<button class="btn-sm btn-aprovar" data-rm-barras="' + x.parcela.id + '">Informar código de barras</button>'
                : '<button class="btn-sm" data-rm-cadastro="' + x.parcela.credor + '">Completar cadastro</button>') +
              '</td></tr>';
          }).join('') + '</tbody></table></div>'
        : '') +
      '<div class="pr-cab">' +
        '<div><label>Conta de débito</label><input value="' + U.esc(banco.apelido) + '" disabled></div>' +
        '<div><label>Convênio</label><input value="' + U.esc(banco.convenio || '') + '" disabled>' +
          '<div class="ajuda">Header, posições 33-52.</div></div>' +
        '<div><label>Agência / conta</label>' +
          '<input value="' + U.esc((banco.agencia || '') + '-' + (banco.agencia_dv || '') + ' · ' +
            String(banco.conta || '').replace(/^0+/, '') + '-' + (banco.conta_dv || '')) + '" disabled></div>' +
        '<div><label for="rm-seqarq">Sequencial do arquivo</label>' +
          '<input id="rm-seqarq" value="' + seq + '">' +
          '<div class="ajuda">O último enviado pelo Protheus foi 000048.</div></div>' +
        '<div><label for="rm-data">Data de pagamento *</label><input type="date" id="rm-data" value="' + U.hoje() + '"></div>' +
      '</div>' +

      '<div class="pr-confere">' +
        '<span>Aprovados para pagamento <b>' + fila.length + '</b></span>' +
        '<span>Selecionados <b>' + selecionados.length + ' · ' + U.brl(total) + '</b></span>' +
        '<span>Layout <b>Bradesco Multipag CNAB 240</b></span>' +
      '</div>' +

      '<div class="ap-acoes">' +
        '<button class="btn-sm" id="rm-todos">Selecionar tudo</button>' +
        '<button class="btn-sm" id="rm-nada">Limpar</button>' +
        '<button class="btn-linha" id="rm-gerar"' + (sel.size ? '' : ' disabled') + '>Gerar arquivo de remessa</button>' +
      '</div>' +

      '<div class="tabela-rolagem" style="margin:0 -14px">' +
      '<table><thead><tr><th style="width:24px"></th><th>Favorecido</th><th>Título</th>' +
      '<th>Vencimento</th><th class="num">Valor</th><th>Meio de pagamento</th><th>Situação</th></tr></thead><tbody>' +
      (fila.length ? fila.map(function (x) {
        const p = x.parcela, pg = x.pagamento;
        const c = dadosDoCredor(p);
        const codigo = pg.forma_codigo || 'pix';
        const forma = ERP.cnab.formaIniciacao(c.tipoChave, c.chavePix);
        const falta = [];
        const ehTributo = codigo === 'guia' || String(pg.codigo_barras || '').charAt(0) === '8';
        if (!c.documento && !ehTributo) falta.push('sem CPF/CNPJ');
        if (codigo === 'pix') {
          if (!c.chavePix) falta.push('sem chave PIX');
          if (!forma) falta.push('chave não identificada');
        } else if (String(pg.codigo_barras || '').replace(/\D/g, '').length !== 44) {
          falta.push('sem código de barras');
        }
        const meio = codigo === 'pix'
          ? U.esc(c.chavePix || '—') + (forma ? '<div class="sub">PIX · forma ' + forma + '</div>' : '')
          : '<span class="mono" style="font-size:10.5px;word-break:break-all">' + U.esc(pg.codigo_barras || '—') + '</span>' +
            '<div class="sub">' + (String(pg.codigo_barras || '').charAt(0) === '8'
            ? 'conta/tributo · segmento O' : 'boleto · segmento J') + '</div>';
        return '<tr class="' + (sel.has(pg.id) ? 'sel' : '') + '">' +
          '<td>' + (falta.length ? '' : '<input type="checkbox" style="width:auto" data-sel="' + pg.id + '"' +
            (sel.has(pg.id) ? ' checked' : '') + '>') + '</td>' +
          '<td class="desc">' + U.esc(c.nome) + '<div class="sub">' + U.esc(c.documento || '—') + '</div></td>' +
          '<td class="mono">' + U.esc(p.doc || '—') + '<div class="sub">' + U.esc(p.descricao || '') + '</div></td>' +
          '<td class="mono">' + U.fData(p.venc) + '</td>' +
          '<td class="num">' + U.brl(totalPg(pg)) + '</td>' +
          '<td class="desc">' + meio + '</td>' +
          '<td>' + (falta.length
            ? '<span class="badge b-reprovado">' + falta.join(' · ') + '</span>'
            : (pg.ocorrencia_banco
                ? '<span class="badge b-pendente">recusado antes</span><div class="sub">' + U.esc(pg.ocorrencia_banco) + '</div>'
                : '<span class="badge b-aprovado">aprovado ' + (pg.autorizado_por ? 'por ' + U.esc(pg.autorizado_por) : '') + '</span>')) + '</td>' +
        '</tr>';
      }).join('')
        : '<tr><td colspan="7" class="vazio"><strong>Nada aprovado para pagamento.</strong>' +
          'O financeiro solicita o pagamento em Contas a pagar e a diretoria aprova na aba ' +
          'Aguardando aprovação — só então o pagamento chega aqui.</td></tr>') +
      '</tbody></table></div>' +

      blocoFora(fora) +
      '<div id="rm-erros"></div>' +
      historico();

    /* Informar o código de barras aqui, com a aprovação já dada: é o
       que evita digitar duas vezes um código que vence. */
    U.el('rm-saida').querySelectorAll('[data-rm-barras]').forEach(function (b) {
      b.addEventListener('click', function () {
        const par = S.parcela(this.dataset.rmBarras);
        ERP.app.modal({
          titulo: 'Código de barras · ' + S.nomeCredorVisivel(par),
          fecharTxt: 'Cancelar',
          corpo: '<div class="resumo-linha"><span>Vencimento</span><span class="v">' +
              U.fData(par.venc) + '</span></div>' +
            '<div class="resumo-linha"><span>Valor</span><span class="v">' + U.brl(S.saldoDe(par)) + '</span></div>' +
            '<div class="ajuda">O pagamento já está aprovado: informe a linha digitável atualizada e ' +
              'ele entra no próximo arquivo.</div>' +
            '<label>Linha digitável / código de barras *</label>' +
            '<input id="rm-cb" inputmode="numeric" placeholder="somente números">',
          acoes: [{ txt: 'Salvar', cls: 'btn-aprovar', fn: function () {
            const r = S.informarCodigoBarras(par.id, U.val('rm-cb'));
            if (r.erro) return ERP.app.aviso(r.erro, 'erro');
            ERP.app.fecharModal(); render();
            ERP.app.aviso('Código de barras salvo — o pagamento entra no próximo arquivo.', 'ok');
          } }]
        });
      });
    });
    U.el('rm-saida').querySelectorAll('[data-rm-cadastro]').forEach(function (b) {
      b.addEventListener('click', function () {
        ERP.app.aviso('Complete os dados bancários em Cadastros › Fornecedores.', 'erro');
      });
    });
    U.el('rm-saida').querySelectorAll('[data-sel]').forEach(function (chk) {
      chk.addEventListener('change', function () {
        this.checked ? sel.add(this.dataset.sel) : sel.delete(this.dataset.sel);
        render();
      });
    });
    if (U.el('rm-todos')) {
      U.el('rm-todos').addEventListener('click', function () {
        let fora = 0;
        fila.forEach(function (x) {
          const c = dadosDoCredor(x.parcela), pg = x.pagamento;
          const codigo = pg.forma_codigo || 'pix';
          const ehTributo = codigo === 'guia' || String(pg.codigo_barras || '').charAt(0) === '8';
          const ok = (c.documento || ehTributo) && (codigo === 'pix'
            ? (c.chavePix && ERP.cnab.formaIniciacao(c.tipoChave, c.chavePix))
            : String(pg.codigo_barras || '').replace(/\D/g, '').length === 44);
          if (ok) sel.add(pg.id); else fora++;
        });
        ERP.app.aviso(sel.size + ' pagamento(s) marcado(s)' +
          (fora ? ', ' + fora + ' fora da seleção por falta de cadastro' : '') + '.', 'ok');
        render();
      });
      U.el('rm-nada').addEventListener('click', function () { sel.clear(); render(); });
      U.el('rm-gerar').addEventListener('click', gerar);
    }
    U.el('rm-saida').querySelectorAll('[data-liq]').forEach(function (b) {
      b.addEventListener('click', function () {
        const r = S.liquidar(this.dataset.liq, { data: U.hoje() });
        if (r.erro) return ERP.app.aviso(r.erro, 'erro');
        ERP.app.aviso('Pagamento confirmado — baixa registrada.', 'ok');
        ERP.app.atualizar();
      });
    });
    U.el('rm-saida').querySelectorAll('[data-ver-rem]').forEach(function (b) {
      b.addEventListener('click', function () { verRemessa(this.dataset.verRem); });
    });
    U.el('rm-saida').querySelectorAll('[data-baixar]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = this.dataset.baixar;
        const r = S.remessas().find(function (x) { return x.id === id; });
        if (r) U.baixar(r.arquivo_nome, r.conteudo, 'text/plain');
      });
    });
  }

  /* Aprovados que não saem neste arquivo: boleto vai em outro segmento
     do CNAB, débito em conta e dinheiro não passam por remessa. */
  function blocoFora(fora) {
    if (!fora.length) return '';
    return '<h2 style="font-size:12px;margin:18px 0 8px">Aprovados que não entram neste arquivo</h2>' +
      '<table><tbody>' + fora.map(function (x) {
        const p = x.parcela, pg = x.pagamento;
        return '<tr><td class="desc">' +
          U.esc(S.nomeCredorVisivel(p, ERP.lancamento.nomeCredor(p.credor)) || '—') +
          '<div class="sub">' + U.esc(S.descricaoVisivel(p)) + '</div></td>' +
          '<td class="mono">' + U.fData(p.venc) + '</td>' +
          '<td class="num">' + U.brl(totalPg(pg)) + '</td>' +
          '<td><span class="badge b-aguardando">' + U.esc(pg.forma || '—') + '</span></td>' +
          '<td class="acoes">' + (S.pode('pagar')
            ? '<button class="btn-sm btn-pagar" data-liq="' + pg.id + '">Confirmar pagamento</button>' : '') +
          '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="ajuda">Débito em conta, TED e dinheiro não passam por este arquivo: o pagamento é feito ' +
      'no banco e confirmado aqui. (TED entra no Segmento A com forma 03/41, ainda não implementado.)</div>';
  }

  function historico() {
    const rs = S.remessas();
    if (!rs.length) return '';
    return '<h2 style="font-size:12px;margin:16px 0 8px">Remessas geradas</h2>' +
      '<table><thead><tr><th>Nº</th><th>Arquivo</th><th>Pagamento</th><th class="num">Itens</th>' +
      '<th class="num">Total</th><th>Retorno</th><th></th></tr></thead><tbody>' +
      rs.map(function (r) {
        const pagos = r.itens.filter(function (i) { return i.situacao === '02'; }).length;
        const rec = r.itens.filter(function (i) { return i.situacao === '01'; }).length;
        const age = r.itens.filter(function (i) { return i.situacao === 'agendado'; }).length;
        const ana = r.itens.filter(function (i) { return i.situacao === 'analise'; }).length;
        return '<tr style="cursor:pointer" data-ver-rem="' + r.id + '"><td class="mono">' + r.sequencial + '</td>' +
          '<td class="mono">' + U.esc(r.arquivo_nome) + '</td>' +
          '<td class="mono">' + U.fData(r.data_pagamento) + '</td>' +
          '<td class="num">' + r.qtd + '</td>' +
          '<td class="num">' + U.brl(r.valor_total) + '</td>' +
          '<td>' + (pagos || rec || age || ana
            ? (pagos ? '<span class="badge b-pago">' + pagos + ' pago(s)</span> ' : '') +
              (age ? '<span class="badge b-aguardando">' + age + ' agendado(s)</span> ' : '') +
              (rec ? '<span class="badge b-reprovado">' + rec + ' recusado(s)</span> ' : '') +
              (ana ? '<span class="badge b-pendente">' + ana + ' p/ análise</span>' : '')
            : '<span class="sub">aguardando</span>') + '</td>' +
          '<td class="acoes"><button class="btn-sm" data-ver-rem="' + r.id + '">Ver itens</button>' +
          '<button class="btn-sm" data-baixar="' + r.id + '">Baixar</button></td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* ── o que foi dentro de cada arquivo ───────────────────*/
  function verRemessa(id) {
    const r = S.remessas().find(function (x) { return x.id === id; });
    if (!r) return;
    const rot = { '02': 'pago', '01': 'não pago' };
    ERP.app.modal({
      titulo: 'Remessa ' + r.sequencial + ' · ' + r.arquivo_nome,
      corpo:
        '<div class="resumo-linha"><span>Gerada em</span><span class="v">' +
          U.fDataHora(r.criado_em) + ' por ' + U.esc(r.usuario) + '</span></div>' +
        '<div class="resumo-linha"><span>Data de pagamento</span><span class="v">' + U.fData(r.data_pagamento) + '</span></div>' +
        '<div class="resumo-linha"><span>Itens / total</span><span class="v">' + r.qtd + ' · ' + U.brl(r.valor_total) + '</span></div>' +
        '<h2 style="font-size:12px;margin:16px 0 8px">Pagamentos no arquivo</h2>' +
        '<table><thead><tr><th>Seu nº</th><th>Favorecido</th><th class="num">Valor</th><th>Retorno</th><th></th></tr></thead><tbody>' +
        r.itens.map(function (i) {
          const par = S.parcela(i.parcela_id) || {};
          const pg = S.pagamento(i.pagamento_id) || {};
          return '<tr><td class="mono">' + U.esc(i.numeroPagamento) + '</td>' +
            '<td>' + U.esc(S.nomeCredorVisivel(par, ERP.lancamento.nomeCredor(par.credor)) || '—') +
              '<div class="sub">' + U.esc(S.descricaoVisivel(par)) + ' · ' + U.esc(par.doc || '') + '</div>' +
              '<div class="sub">' + U.esc(i.chave || '') + '</div></td>' +
            '<td class="num">' + U.brl(i.valor) + '</td>' +
            '<td>' + (i.situacao
              ? '<span class="badge ' + (i.situacao === '02' ? 'b-pago' : 'b-reprovado') + '">' + rot[i.situacao] + '</span>' +
                (i.ocorrencias && i.ocorrencias.length
                  ? '<div class="sub">' + i.ocorrencias.map(function (c) {
                      return U.esc(c + ' — ' + (ERP.cnab.OCORRENCIAS[c] || '?')); }).join('<br>') + '</div>'
                  : '')
              : '<span class="sub">aguardando retorno</span>') +
              (pg.situacao === 'liquidado' ? '<div class="sub">baixado em ' + U.fData(pg.data) + '</div>' : '') +
            '</td>' +
            /* Sem isto, o arquivo saía e a parcela ficava presa em
               "enviado", travada por "já tem pagamento em andamento". A
               volta existia no motor — liquidar e devolverParaRemessa —
               mas não tinha botão em lugar nenhum, e o retorno do banco
               nem sempre chega. */
            '<td class="acoes">' + (pg.situacao === 'enviado' && S.pode('pagar')
              ? '<button class="btn-sm btn-aprovar" data-rm-ok="' + i.pagamento_id + '">Confirmar pagamento</button>' +
                '<button class="btn-sm btn-cancelar" data-rm-volta="' + i.pagamento_id + '">Não foi pago</button>'
              : '') + '</td></tr>';
        }).join('') + '</tbody></table>' +
        (r.itens.some(function (i) {
          return (S.pagamento(i.pagamento_id) || {}).situacao === 'enviado'; })
          ? '<div class="ajuda">Confirme pelo comprovante do banco quando o retorno não chegar. ' +
            '"Não foi pago" devolve o pagamento para a fila da próxima remessa, com o motivo.</div>'
          : ''),
      aoAbrir: function () {
        const recarrega = function () { ERP.app.fecharModal(); render(); ERP.contas.render(); };
        document.querySelectorAll('[data-rm-ok]').forEach(function (b) {
          b.addEventListener('click', function () {
            const res = S.liquidar(this.dataset.rmOk, { data: r.data_pagamento });
            if (res.erro) return ERP.app.aviso(res.erro, 'erro');
            recarrega();
            ERP.app.aviso('Pagamento confirmado e parcela baixada.', 'ok');
          });
        });
        document.querySelectorAll('[data-rm-volta]').forEach(function (b) {
          b.addEventListener('click', function () {
            const motivo = prompt('Por que este pagamento não saiu? (vai para o histórico da parcela)');
            if (!motivo) return;
            const res = S.devolverParaRemessa(this.dataset.rmVolta, motivo);
            if (res.erro) return ERP.app.aviso(res.erro, 'erro');
            recarrega();
            ERP.app.aviso('Pagamento devolvido para a fila da remessa.', 'ok');
          });
        });
      },
      acoes: [
        { txt: 'Baixar arquivo', cls: '', fn: function () {
          U.baixar(r.arquivo_nome, r.conteudo, 'text/plain');
        } },
        { txt: 'Confirmar todos os enviados', cls: 'btn-aprovar', fn: function () {
          const ids = r.itens.map(function (i) { return i.pagamento_id; })
            .filter(function (id) { return (S.pagamento(id) || {}).situacao === 'enviado'; });
          if (!ids.length) return ERP.app.aviso('Nenhum item aguardando confirmação.', 'erro');
          if (!confirm('Confirmar ' + ids.length + ' pagamento(s) como pagos em ' +
                       U.fData(r.data_pagamento) + '?')) return;
          const res = S.liquidar(ids, { data: r.data_pagamento });
          if (res.erro) return ERP.app.aviso(res.erro, 'erro');
          ERP.app.fecharModal(); render(); ERP.contas.render();
          ERP.app.aviso(res.n + ' pagamento(s) confirmado(s).', 'ok');
        } }
      ]
    });
  }

  /* ── gerar ──────────────────────────────────────────────*/
  function gerar() {
    const contas = contasDaSelecao();
    if (contas.length > 1) {
      return ERP.app.aviso('A seleção mistura ' + contas.length + ' contas (' +
        contas.map(function (b) {
          return b.apelido + ' · ' + ((D.empresaPor(b.empresa) || {}).apelido || ''); }).join(', ') +
        '). Cada conta gera o seu arquivo, com o CNPJ dela no cabeçalho — filtre por conta e gere um de ' +
        'cada vez.', 'erro');
    }
    const banco = contaBradesco();
    if (banco && !LAYOUTS_PRONTOS[banco.banco]) {
      return ERP.app.aviso('O layout de remessa do banco ' + banco.banco + ' (' + banco.apelido + ') ainda ' +
        'não está implementado — hoje só o Bradesco está validado contra arquivo real. Os pagamentos ' +
        'continuam na fila; gere por enquanto pelo portal do banco.', 'erro');
    }
    const seqArq = U.val('rm-seqarq');
    const cfg = {
      cnpj: banco.cnpj, nomeEmpresa: banco.razao_social,
      convenio: banco.convenio, agencia: banco.agencia, agenciaDv: banco.agencia_dv,
      conta: banco.conta, contaDv: banco.conta_dv,
      endereco: banco.endereco, numeroEndereco: banco.numero_endereco,
      complemento: banco.complemento, cidade: banco.cidade,
      cep: banco.cep, cepCompl: banco.cep_compl, uf: banco.uf,
      versaoLayout: banco.versao_layout, versaoLote: banco.versao_lote,
      tipoServico: banco.tipo_servico, camara: banco.camara,
      finalidadeDoc: banco.finalidade_doc, indicador: banco.indicador_lote,
      sequencialArquivo: seqArq,
      dataPagamento: U.val('rm-data'), dataGeracao: U.hoje()
    };
    const itens = S.aptasParaRemessa().filter(function (x) { return sel.has(x.pagamento.id); })
      .map(function (x) {
        const p = x.parcela, pg = x.pagamento, c = dadosDoCredor(p);
        return {
          parcela_id: p.id, pagamento_id: pg.id,
          nome: c.nome, documento: c.documento,
          chavePix: c.chavePix, tipoChave: c.tipoChave,
          codigoBarras: pg.codigo_barras || p.codigo_barras || '',
          vencimento: p.venc,
          /* O banco cobra o que efetivamente sai da conta — principal
             mais juros e multa, menos desconto — não só o principal.
             Esquecer os acréscimos aqui fazia o arquivo sair com um
             valor menor do que o aprovado. */
          valor: totalPg(pg),
          seuNumero: S.proximoSeuNumero()
        };
      });

    const r = ERP.cnab.gerarRemessa(cfg, itens);
    if (r.erros) {
      U.el('rm-erros').innerHTML = '<div class="aviso" style="margin-top:10px"><b>O arquivo não foi gerado:</b><ul style="margin:6px 0 0 16px">' +
        r.erros.map(function (e) { return '<li>' + U.esc(e) + '</li>'; }).join('') + '</ul></div>';
      return;
    }
    U.baixar(r.nome, r.conteudo, 'text/plain');
    banco.proximo_arquivo = (+seqArq) + 1;   // só informativo; quem manda é o store
    S.registrarRemessa({
      sequencial: seqArq, banco: banco.id, data_pagamento: cfg.dataPagamento,
      arquivo_nome: r.nome, conteudo: r.conteudo
    }, itens);
    sel.clear();
    render();
    ERP.contas.render();
    const rotLote = { pix: 'PIX', boleto: 'boleto Bradesco', boleto_outros: 'boleto de outros bancos', tributo: 'tributo' };
    const resumo = r.lotes.map(function (l) { return l.qtd + ' por ' + (rotLote[l.tipo] || l.tipo); }).join(', ');
    ERP.app.aviso('Arquivo ' + r.nome + ' gerado: ' + U.brl(r.total) + ' em ' + r.lotes.length +
      ' lote(s) — ' + resumo + '.' + (r.avisos.length ? ' ' + r.avisos[r.avisos.length - 1] : ''), 'ok');
  }

  /* ── retorno ────────────────────────────────────────────*/
  function importarRetorno(e) {
    const arq = e.target.files && e.target.files[0];
    if (!arq) return;
    const leitor = new FileReader();
    leitor.onload = function () {
      const lido = ERP.cnab.lerRetorno(leitor.result);
      if (lido.erro) { ERP.app.aviso(lido.erro, 'erro'); return; }
      const r = S.aplicarRetorno(lido);
      render();
      ERP.contas.render();
      ERP.app.atualizarContadores();
      const partes = [r.pagos + ' baixa(s)'];
      if (r.aceitos) partes.push(r.aceitos + ' apenas agendado(s) pelo banco — seguem no banco');
      if (r.recusados) partes.push(r.recusados + ' recusado(s)');
      if (r.analise) partes.push(r.analise + ' com código não classificado — requer análise');
      if (r.naoAchados) partes.push(r.naoAchados + ' sem par no sistema');
      ERP.app.aviso('Retorno lido (' + lido.itens.length + ' registro(s)): ' + partes.join(', ') + '.', 'ok');
    };
    leitor.readAsText(arq, 'ISO-8859-1');
    e.target.value = '';
  }

  return { montar: montar, render: render };
})();
