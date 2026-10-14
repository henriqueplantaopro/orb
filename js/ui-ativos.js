/* ERP · ui-ativos.js — equipamentos.

   Outra natureza que a do almoxarifado: aqui não se pergunta "tenho
   quantas", se pergunta "onde está esta". Por isso o local NUNCA é
   editado no cadastro: toda mudança é um evento, e o que a tela mostra
   é o último evento. É o que permite provar devolução e dizer onde o
   equipamento estava numa data passada. */
window.ERP = window.ERP || {};

ERP.ativos = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;
  /* Dinheiro do módulo de Ativos: valor de aquisição, depreciação,
     residual e custo de OS. Sem o nível financeiro em Ativos a tela
     mostrava tudo — nenhum dos 17 `S.pode(...)` do arquivo tratava de
     valor. */
  const veValor = () => S.veFinanceiro('ativos');
  /* Um ponto só: quem não tem acesso financeiro vê o traço. */
  const brlSeguro = v => veValor() ? U.brl(v) : '—';

  let aba = 'inventario';
  let f = { busca: '', status: '', projeto: '', categoria: '' };
  /* Seleção do inventário. Vive FORA do render porque a tela se
     redesenha a cada filtro, e perder a marcação ao filtrar seria o
     mesmo que não ter marcação: quem separa cinquenta camas usa o
     filtro justamente para achá-las. */
  const marcados = new Set();

  function montar() {
    document.querySelectorAll('#av-nav button').forEach(function (b) {
      b.addEventListener('click', function () { aba = this.dataset.av; render(); });
    });
  }

  const nomeProjeto = id => (D.centro(id) || {}).curto || '—';
  const badge = st => {
    const cor = { alocado: 'b-pago', sede: 'b-aguardando', terceiro: 'b-aguardando',
      manutencao: 'b-vencido', devolucao: 'b-vencido', transito: 'b-aguardando',
      aguardando: 'b-aguardando', baixado: '' }[st] || '';
    return '<span class="badge ' + cor + '">' + U.esc(D.nomeStatusAtivo(st)) + '</span>';
  };

  function render() {
    /* Permissão conferida no RENDER, não só no menu: abrir o módulo por
       outro caminho não deve mostrar o inventário. */
    /* A fonte da permissão é a MATRIZ, não uma lista `modulos` no
       perfil. A lista existia no cadastro embutido e não existe na
       tabela do banco — então, depois da migração, este módulo se
       bloqueava sozinho para todo mundo, inclusive para quem tinha
       V M $ A na matriz. */
    if (!S.veModulo('ativos')) {
      U.el('av-saida').innerHTML = '<div class="vazio"><strong>Seu perfil não tem acesso a Ativos.</strong>' +
        'Fale com a administração se precisar deste módulo.</div>';
      return;
    }
    /* Preventiva vencida abre sozinha ao entrar no módulo: sem
       servidor, é aqui que o "job diário" acontece. */
    const abertas = S.gerarPreventivas();
    document.querySelectorAll('#av-nav button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.av === aba);
    });
    const nOS = S.ordensServico({}).filter(function (o) { return o.status !== 'fechada'; }).length;
    const cont = U.el('av-os-n');
    if (cont) { cont.textContent = nOS; cont.style.display = nOS ? '' : 'none'; }

    U.el('av-saida').innerHTML =
      aba === 'chamados'   ? telaChamados() :
      aba === 'os'         ? telaOS() :
      aba === 'preventiva' ? telaPreventiva() :
      aba === 'ociosos'    ? telaOciosos() :
      aba === 'resultado'  ? telaResultado() :
      aba === 'indicadores' ? telaIndicadores() :
                             inventario();
    ligar();
    if (abertas.length) {
      ERP.app.aviso(abertas.length + ' preventiva(s) venceram e foram abertas como OS.', 'ok');
    }
  }

  /* ── inventário ─────────────────────────────────────────*/
  function inventario() {
    const lista = S.ativos(f);
    const todos = S.ativos({});
    const valor = Math.round(lista.reduce(function (a, x) { return a + (x.valor || 0); }, 0) * 100) / 100;
    const cats = todos.map(function (a) { return a.categoria; })
      .filter(function (c, i, arr) { return c && arr.indexOf(c) === i; }).sort();
    const projetos = D.centros.filter(function (c) { return c.tipo === 'projeto'; })
      .sort(function (a, b) { return String(a.curto).localeCompare(String(b.curto), 'pt-BR'); });

    return '<div class="filtros">' +
        '<div class="f" style="min-width:220px"><label for="av-busca">Buscar</label>' +
          '<input id="av-busca" value="' + U.esc(f.busca) + '" placeholder="tag, série, descrição, local, custodiante"></div>' +
        '<div class="f"><label for="av-status">Situação</label><select id="av-status">' +
          '<option value="">Todas</option>' + D.STATUS_ATIVO.map(function (s) {
            return '<option value="' + s.id + '"' + (f.status === s.id ? ' selected' : '') + '>' +
              U.esc(s.nome) + '</option>'; }).join('') + '</select></div>' +
        '<div class="f"><label for="av-projeto">Projeto</label><select id="av-projeto">' +
          '<option value="">Todos</option>' + projetos.map(function (c) {
            return '<option value="' + c.id + '"' + (f.projeto === c.id ? ' selected' : '') + '>' +
              U.esc(c.curto) + '</option>'; }).join('') + '</select></div>' +
        '<div class="f"><label for="av-cat">Categoria</label><select id="av-cat">' +
          '<option value="">Todas</option>' + cats.map(function (c) {
            return '<option value="' + U.esc(c) + '"' + (f.categoria === c ? ' selected' : '') + '>' +
              U.esc(c) + '</option>'; }).join('') + '</select></div>' +
        (S.pode('estoque') ? '<button class="btn-sm btn-aprovar" id="av-novo" style="align-self:flex-end">+ Equipamento</button>' : '') +
        '<button class="btn-sm" id="av-exportar" style="align-self:flex-end">Exportar</button>' +
      '</div>' +
      '<div class="pr-confere">' +
        '<span>Equipamentos <b>' + lista.length + '</b></span>' +
        '<span>Valor imobilizado <b>' + brlSeguro(valor) + '</b></span>' +
        '<span>Alocados <b>' + todos.filter(function (a) { return a.status === 'alocado'; }).length + '</b></span>' +
        '<span>Parados <b class="' + (S.ociosidadeAtivos().length ? 'erro' : '') + '">' +
          S.ociosidadeAtivos().length + '</b></span>' +
      '</div>' +
      /* ── barra da seleção ─────────────────────────────
         Só existe quando há algo marcado. Barra de ações
         permanentemente na tela ocupa espaço o tempo todo para
         servir numa fração do tempo — e ensina o olho a ignorá-la. */
      (marcados.size
        ? '<div class="pr-confere sel-barra">' +
            '<span><b>' + marcados.size + '</b> selecionado(s)</span>' +
            (S.pode('estoque')
              ? '<button class="btn-sm btn-aprovar" id="av-mov-lote">Movimentar em lote</button>' : '') +
            '<button class="btn-sm" id="av-etq-lote">Imprimir etiquetas</button>' +
            '<button class="btn-sm" id="av-sel-limpar">Limpar seleção</button>' +
          '</div>'
        : '') +
      /* A coluna de PATRIMÔNIO só aparece se alguém tiver um.
         Ela guarda a etiqueta que o equipamento já trazia de antes
         do ERP, e a maioria dos itens não tem nenhuma — uma coluna
         inteira de travessão custa a largura que falta para "Onde
         está" caber antes dos botões. */
      (function () {
        const temPatrimonio = lista.some(function (a) { return a.patrimonio; });
        /* O colspan do aviso de lista vazia é CONTADO, não escrito:
           escrito, ele envelhece a cada coluna que entra ou sai — e
           estava em 9 numa tabela de doze. */
        /* DEZ colunas sem o patrimônio: marcação, tag, equipamento,
           categoria, valor, situação, contratante, onde está,
           locação e os botões. O número estava em 11 por um engano
           antigo — o cabeçalho tinha nove colunas fixas e o colspan
           dizia dez, uma a mais. Passava despercebido porque
           colspan maior que a tabela apenas estica até o fim. A
           coluna de marcação da v118 fez o dez virar verdade. */
        const colunas = 10 + (temPatrimonio ? 1 : 0);
        /* "Todos" é todos os que ESTÃO NO FILTRO. Marcar o que não
           está na tela é o jeito mais fácil de movimentar o que não
           se queria. */
        const todosNaTela = lista.length > 0 &&
          lista.every(function (a) { return marcados.has(a.id); });
        return '<div class="tabela-rolagem" style="margin:0 -14px"><table class="tab-ativos"><thead><tr>' +
        '<th class="col-marca"><input type="checkbox" id="av-marca-todos"' +
          (todosNaTela ? ' checked' : '') + ' aria-label="Marcar todos da tela"></th>' +
        '<th>Tag</th>' + (temPatrimonio ? '<th>Patrimônio</th>' : '') +
        '<th>Equipamento</th><th>Categoria</th><th class="num">Valor</th>' +
        '<th>Situação</th><th class="col-contratante">Contratante</th><th>Onde está</th>' +
        '<th class="col-locacao">Locação</th><th></th></tr></thead><tbody>' +
        (lista.length ? lista.map(function (a) {
          return '<tr' + (marcados.has(a.id) ? ' class="sel"' : '') + '>' +
            '<td class="col-marca"><input type="checkbox" data-av-marca="' + U.esc(a.id) + '"' +
              (marcados.has(a.id) ? ' checked' : '') +
              ' aria-label="Marcar ' + U.esc(a.tag) + '"></td>' +
            '<td class="mono">' + U.esc(a.tag) + '</td>' +
            /* Número de patrimônio é a etiqueta que já existe no
               equipamento, diferente da tag do sistema. */
            (temPatrimonio ? '<td class="mono sub">' + U.esc(a.patrimonio || '—') + '</td>' : '') +
            '<td class="desc">' + U.esc(a.descricao) +
              (a.serie ? '<div class="sub">série ' + U.esc(a.serie) + '</div>'
                : (a.qtd > 1 ? '<div class="sub">' + a.qtd + ' unidades no mesmo registro</div>' : '')) + '</td>' +
            '<td class="sub">' + U.esc(a.categoria || '—') + '</td>' +
            '<td class="num">' + brlSeguro(a.valor || 0) +
              (a.qtd > 1 ? '<div class="sub">' + brlSeguro((a.valor || 0) / a.qtd) + ' cada</div>' : '') + '</td>' +
            '<td>' + badge(a.status) + '</td>' +
            /* Quem contratou é uma coisa; onde o equipamento está é
               outra: a Unifor contrata e o aparelho opera na Santa
               Casa. */
            '<td class="sub col-contratante">' + U.esc(S.nomeContratante(a) || '—') + '</td>' +
            /* CUSTODIANTE desceu para dentro de "Onde está": é a
               pessoa daquele lugar, e as duas informações só são
               lidas juntas ("está na Santa Casa, com a Monique").
               Em coluna própria custava largura para repetir o
               contexto da coluna vizinha. */
            '<td class="desc">' + U.esc(a.local || '—') +
              (a.projeto ? '<div class="sub">' + U.esc(nomeProjeto(a.projeto)) + '</div>' : '') +
              (a.custodiante
                ? '<div class="sub">com ' + U.esc(a.custodiante) +
                  (a.desde ? ' desde ' + U.fData(a.desde) : '') + '</div>' : '') + '</td>' +
            '<td class="sub col-locacao">' + (a.contrato
              ? U.esc((S.contratos({}).find(function (c) { return c.id === a.contrato; }) || {}).numero || '') +
                '<div class="sub">' + brlSeguro(a.valor_locacao || 0) + '/mês</div>'
              : '—') + '</td>' +
            /* Havia uma SEGUNDA coluna "Valor" aqui, com exatamente
               o mesmo `a.valor` da quinta. Duas colunas iguais na
               mesma linha não são redundância inofensiva: custam a
               largura que falta, e quem lê fica procurando a
               diferença entre elas. */
            '<td class="acoes">' +
              '<button class="btn-sm" data-av-ficha="' + a.id + '">Ficha</button>' +
              ' <button class="btn-sm" data-av-etiqueta="' + a.id + '">Etiqueta</button>' +
              (S.pode('estoque') ? ' <button class="btn-sm" data-av-editar="' + a.id + '">Editar</button>' : '') +
              (S.pode('baixar_ativo') && a.status !== 'baixado'
                ? ' <button class="btn-sm btn-cancelar" data-av-baixar="' + a.id + '">Baixar</button>' : '') +
              (S.pode('estoque') && (a.qtd || 1) > 1
                ? ' <button class="btn-sm" data-av-desm="' + a.id + '">Desmembrar</button>' : '') +
              (S.pode('estoque') || S.pode('faturar')
                ? ' <button class="btn-sm" data-av-loc="' + a.id + '">Locação</button>' : '') +
              (S.pode('estoque') ? ' <button class="btn-sm btn-aprovar" data-av-mov="' + a.id + '">Movimentar</button>' : '') +
            '</td></tr>';
        }).join('')
          : '<tr><td colspan="' + colunas + '" class="vazio">' +
            '<strong>Nenhum equipamento com esse filtro.</strong></td></tr>') +
      '</tbody></table></div>';
      })();
  }

  /* Ficha: o histórico é o coração. Cada evento com origem, destino,
     quem autorizou e o documento de remessa. */
  function ficha(id) {
    const a = S.ativo(id);
    const at = S.situacaoAtiva(a);
    const movs = S.movimentacoesDoAtivo(id);
    /* A ficha mostra até as canceladas: rastreabilidade é o ponto do
       histórico, e uma OS cancelada explica um período parado. */
    const oss = S.ordensServico({ ativo: id, incluir_canceladas: true });
    ERP.app.modal({
      titulo: a.tag + ' · ' + a.descricao,
      fecharTxt: 'Fechar',
      corpo:
        '<div class="row3">' +
          '<div class="resumo-linha"><span>Situação</span><span class="v">' + badge(at.status) + '</span></div>' +
          '<div class="resumo-linha"><span>Onde está</span><span class="v">' + U.esc(at.local || '—') + '</span></div>' +
          '<div class="resumo-linha"><span>Custodiante</span><span class="v">' +
            U.esc(at.custodiante || '—') +
            /* O contato ao lado do nome: é na ficha que alguém procura
               quando precisa do equipamento de volta. */
            (at.custodiante_telefone || at.custodiante_email
              ? '<div class="sub">' +
                [at.custodiante_telefone, at.custodiante_email].filter(Boolean)
                  .map(function (x) { return U.esc(x); }).join(' · ') + '</div>'
              : '') +
          '</span></div>' +
        '</div>' +
        '<div class="row3">' +
          '<div class="resumo-linha"><span>Projeto</span><span class="v">' + U.esc(at.projeto ? nomeProjeto(at.projeto) : '—') + '</span></div>' +
          '<div class="resumo-linha"><span>Valor</span><span class="v">' + brlSeguro(a.valor || 0) + '</span></div>' +
          '<div class="resumo-linha"><span>NF de aquisição</span><span class="v">' + U.esc(a.nf || '—') + '</span></div>' +
        '</div>' +
        (a.serie || a.marca || a.modelo
          ? '<div class="ajuda">' + [a.marca, a.modelo, a.serie ? 'série ' + a.serie : ''].filter(Boolean).join(' · ') + '</div>' : '') +
        /* A ficha estava muda sobre o que decide a gestão do bem:
           garantia, criticidade, quanto já depreciou e o que ele
           recebe de locação. */
        (function () {
          const dep = S.depreciacaoDoAtivo(a);
          const res = S.resultadoDoAtivo(a.id) || {};
          const ct = a.contrato ? S.contratos({}).find(function (c) { return c.id === a.contrato; }) : null;
          const planos = S.st.planosManutencao.filter(function (p) {
            return p.ativo === a.id || (p.categoria && p.categoria === a.categoria); });
          return '<div class="row3">' +
              '<div class="resumo-linha"><span>Aquisição</span><span class="v">' +
                (a.aquisicao ? U.fData(a.aquisicao) : '—') + '</span></div>' +
              '<div class="resumo-linha"><span>Garantia até</span><span class="v">' +
                (a.garantia_ate
                  ? U.fData(a.garantia_ate) + (a.garantia_ate < U.hoje() ? ' <span class="sub">vencida</span>' : '')
                  : '—') + '</span></div>' +
              '<div class="resumo-linha"><span>Criticidade</span><span class="v">' +
                U.esc(a.criticidade || '—') + '</span></div>' +
            '</div>' +
            '<div class="row3">' +
              '<div class="resumo-linha"><span>Depreciação</span><span class="v">' + brlSeguro(dep.mensal) +
                '/mês <span class="sub">' + dep.meses_depreciados + '/' + dep.vida + ' meses</span></span></div>' +
              '<div class="resumo-linha"><span>Já depreciado</span><span class="v">' + brlSeguro(dep.acumulada) + '</span></div>' +
              '<div class="resumo-linha"><span>Valor residual</span><span class="v">' + brlSeguro(dep.residual) + '</span></div>' +
            '</div>' +
            (ct
              ? '<div class="row3">' +
                  '<div class="resumo-linha"><span>Contrato de locação</span><span class="v">' + U.esc(ct.numero) + '</span></div>' +
                  '<div class="resumo-linha"><span>Recebe por mês</span><span class="v">' + brlSeguro(a.valor_locacao || 0) +
                    (res.meses_faturados
                      ? ' <span class="sub">' + res.meses_faturados + ' mês(es) já faturado(s)</span>' : '') +
                    '</span></div>' +
                  '<div class="resumo-linha"><span>Resultado</span><span class="v ' +
                    (res.resultado < 0 ? 'erro' : '') + '">' + brlSeguro(res.resultado || 0) + '</span></div>' +
                '</div>'
              : '<div class="ajuda">Sem contrato de locação vinculado.</div>') +
            (planos.length
              ? '<div class="ajuda">Preventiva: ' + planos.map(function (p) {
                  return 'a cada ' + p.periodicidade_dias + ' dias (próxima ' + U.fData(p.proxima) + ')' +
                    (p.ativo ? '' : ' — plano da categoria'); }).join(' · ') + '</div>'
              : '') +
            (a.baixa
              ? '<div class="ajuda erro">Baixado em ' + U.fData(a.baixa.data) + ' · ' + U.esc(a.baixa.motivo) +
                (a.baixa.valor_venda ? ' · venda por ' + brlSeguro(a.baixa.valor_venda) : '') + '</div>'
              : '');
        })() +
        '<h3 style="font-size:12px;margin:14px 0 4px">Histórico de movimentação</h3>' +
        (movs.length
          ? '<table class="parcelas"><thead><tr><th>Data</th><th>De</th><th>Para</th><th>Situação</th>' +
            '<th>Quem autorizou</th><th>Documento</th><th></th></tr></thead><tbody>' +
            movs.map(function (m) {
              return '<tr><td class="mono">' + U.fData(m.data) + '</td>' +
                '<td class="sub">' + U.esc(m.origem) + '</td>' +
                '<td class="desc">' + U.esc(m.destino) +
                  (m.custodiante ? '<div class="sub">com ' + U.esc(m.custodiante) + '</div>' : '') + '</td>' +
                '<td class="sub">' + U.esc(D.nomeStatusAtivo(m.status)) + '</td>' +
                '<td class="sub">' + U.esc(m.autorizado_por || '') + '</td>' +
                '<td class="mono sub">' + U.esc(m.documento || '—') + '</td>' +
                '<td class="acoes">' + (m.estornado
                  ? '<span class="sub">estornado: ' + U.esc((m.estorno || {}).motivo || '') + '</span>'
                  : (S.pode('estoque') && !m.pela_baixa
                      ? '<button class="btn-sm btn-cancelar" data-av-estorno="' + m.id + '">Estornar</button>' : '')) +
                '</td></tr>';
            }).join('') + '</tbody></table>'
          : '<div class="ajuda">Sem movimentação registrada — a situação é a do cadastro inicial ' +
            '(veio da planilha). O primeiro evento já passa a valer como histórico.</div>') +
        '<h3 style="font-size:12px;margin:14px 0 4px">Ordens de serviço</h3>' +
        (oss.length
          ? '<table class="parcelas"><tbody>' + oss.map(function (o) {
              return '<tr><td class="mono">' + U.esc(o.numero) + '</td><td>' + U.esc(o.tipo) + '</td>' +
                '<td class="desc">' + U.esc(o.descricao.slice(0, 50)) + '</td>' +
                '<td>' + U.esc(S.NOME_ETAPA_OS[o.status] || o.status) +
                  (o.status === 'cancelada' && o.motivo_cancelamento
                    ? '<div class="sub">' + U.esc(o.motivo_cancelamento) + '</div>' : '') + '</td>' +
                '<td class="num">' + brlSeguro((o.custo_peca || 0) + (o.custo_servico || 0)) + '</td></tr>';
            }).join('') + '</tbody></table>'
          : '<div class="ajuda">Nenhuma OS para este equipamento.</div>'),
      aoAbrir: function () {
        document.querySelectorAll('[data-av-estorno]').forEach(function (b) {
          b.addEventListener('click', function () {
            const movId = this.dataset.avEstorno;
            ERP.app.fecharModal();
            ERP.app.modal({
              titulo: 'Estornar movimentação', fecharTxt: 'Cancelar',
              corpo: '<div class="ajuda">O evento continua no histórico, marcado como estornado, e deixa ' +
                'de contar para a situação atual do equipamento.</div>' +
                '<label>Motivo *</label><input id="es-mov-motivo" placeholder="ex.: lançado no equipamento errado">',
              acoes: [{ txt: 'Estornar', cls: 'btn-cancelar', fn: function () {
                const r = S.estornarMovimentacao(movId, U.val('es-mov-motivo'));
                if (ERP.app.erroDoRetorno(r)) return;
                ERP.app.fecharModal(); render(); ERP.app.aviso('Movimentação estornada.', 'ok');
              } }]
            });
          });
        });
      },
      acoes: !S.pode('estoque') ? []
        : at.status === 'baixado'
          ? [{ txt: 'Reativar', cls: 'btn-aprovar', fn: function () {
              ERP.app.fecharModal();
              ERP.app.modal({
                titulo: 'Desfazer a baixa de ' + a.tag, fecharTxt: 'Cancelar',
                corpo: '<label>Motivo *</label><input id="rt-motivo" placeholder="ex.: baixa registrada por engano">',
                acoes: [{ txt: 'Reativar', cls: 'btn-aprovar', fn: function () {
                  const r = S.reativarAtivo(id, { motivo: U.val('rt-motivo') });
                  if (ERP.app.erroDoRetorno(r)) return;
                  ERP.app.fecharModal(); render(); ERP.app.aviso('Baixa desfeita.', 'ok');
                } }]
              });
            } }]
          : [
            { txt: 'Abrir OS', cls: 'btn-sm', fn: function () { ERP.app.fecharModal(); novaOS(id); } },
            { txt: 'Movimentar', cls: 'btn-aprovar', fn: function () { ERP.app.fecharModal(); movimentar(id); } }
          ]
    });
  }

  /* Movimentação: nunca edita o cadastro, grava evento. */
  function movimentar(id) {
    const a = S.ativo(id);
    const at = S.situacaoAtiva(a);
    const projetos = D.centros.filter(function (c) { return c.tipo === 'projeto' && c.ativo; })
      .sort(function (x, y) { return String(x.curto).localeCompare(String(y.curto), 'pt-BR'); });
    ERP.app.modal({
      titulo: 'Movimentar ' + a.tag,
      fecharTxt: 'Cancelar',
      corpo:
        '<div class="resumo-linha"><span>Equipamento</span><span class="v">' + U.esc(a.descricao) + '</span></div>' +
        '<div class="resumo-linha"><span>Está em</span><span class="v">' + U.esc(at.local || '—') +
          ' · ' + U.esc(D.nomeStatusAtivo(at.status)) + '</span></div>' +
        '<div class="row2">' +
          '<div><label>Nova situação *</label><select id="mv-status">' +
            D.STATUS_ATIVO.map(function (s) {
              return '<option value="' + s.id + '"' + (s.id === at.status ? ' selected' : '') + '>' +
                U.esc(s.nome) + '</option>'; }).join('') + '</select></div>' +
          '<div><label>Data</label><input type="date" id="mv-data" value="' + U.hoje() + '"></div>' +
        '</div>' +
        '<div class="row2">' +
          '<div><label>Para onde *</label><input id="mv-destino" placeholder="ex.: Hospital Moacyr do Carmo — CTI"></div>' +
          '<div><label>Projeto</label><select id="mv-projeto"><option value="">— nenhum —</option>' +
            projetos.map(function (c) {
              return '<option value="' + c.id + '"' + (at.projeto === c.id ? ' selected' : '') + '>' +
                U.esc(c.curto) + '</option>'; }).join('') + '</select></div>' +
        '</div>' +
        '<div class="row2">' +
          '<div><label>Custodiante</label><input id="mv-cust" value="' + U.esc(at.custodiante || '') +
            '" placeholder="quem responde pelo equipamento"></div>' +
          '<div><label>Documento de remessa</label><input id="mv-doc" placeholder="nº da remessa, e-mail, termo"></div>' +
        '</div>' +
        /* Contato do custodiante, tudo opcional. Quando o
           equipamento precisa voltar — fim de contrato, manutenção,
           troca — o nome sozinho não resolve: alguém tem de ligar.
           Procurar esse telefone depois custa mais do que anotar
           agora. */
        '<div class="row2">' +
          '<div><label>Telefone do custodiante</label>' +
            '<input id="mv-cust-fone" value="' + U.esc(at.custodiante_telefone || '') +
            '" placeholder="opcional"></div>' +
          '<div><label>E-mail do custodiante</label>' +
            '<input id="mv-cust-email" type="email" value="' + U.esc(at.custodiante_email || '') +
            '" placeholder="opcional"></div>' +
        '</div>' +
        '<label>Observação</label><input id="mv-obs">' +
        '<div class="ajuda">O evento é o que prova a devolução: guarda de onde saiu, para onde foi, ' +
          'quem autorizou e o documento. O cadastro do equipamento não é alterado.</div>',
      acoes: [{ txt: 'Registrar movimentação', cls: 'btn-aprovar', fn: function () {
        const r = S.movimentarAtivo({ ativo: id, status: U.val('mv-status'), data: U.val('mv-data'),
          destino: U.val('mv-destino'), projeto: U.val('mv-projeto') || null,
          custodiante: U.val('mv-cust'),
          custodiante_telefone: U.val('mv-cust-fone'),
          custodiante_email: U.val('mv-cust-email'),
          documento: U.val('mv-doc'), observacao: U.val('mv-obs') });
        if (ERP.app.erroDoRetorno(r)) return;
        ERP.app.fecharModal(); render();
        ERP.app.aviso('Movimentação registrada.', 'ok');
      } }]
    });
  }

  /* ── movimentar em lote ──────────────────────────────────
     Cinquenta camas saindo para um projeto, ou voltando para a
     sede, são UM acontecimento — mas cinquenta eventos no
     histórico, porque é o evento por equipamento que prova onde
     cada um estava. O que muda aqui é só quantas vezes a pessoa
     digita o destino: uma.

     Cada item passa pela MESMA porta do movimento individual
     (`S.movimentarAtivo`), com as mesmas recusas. Um atalho que
     pulasse as validações em nome da rapidez deixaria o histórico
     com buracos justamente nas operações grandes, que são as que
     mais importam. */
  function movimentarLote(ids) {
    const lista = ids.map(function (i) { return S.ativo(i); })
      .filter(function (a) { return a && !a.desmembrado; });
    if (!lista.length) return ERP.app.aviso('Nenhum equipamento válido na seleção.', 'erro');

    const projetos = D.centros.filter(function (c) { return c.tipo === 'projeto' && c.ativo; })
      .sort(function (x, y) { return String(x.curto).localeCompare(String(y.curto), 'pt-BR'); });

    /* Quando todos partem da mesma situação, dá para sugerir. Com
       situações misturadas, sugerir seria chutar por todos. */
    const sits = lista.map(function (a) { return S.situacaoAtiva(a).status; })
      .filter(function (s, i, arr) { return arr.indexOf(s) === i; });
    const locais = lista.map(function (a) { return S.situacaoAtiva(a).local || '—'; })
      .filter(function (s, i, arr) { return arr.indexOf(s) === i; });
    const deOnde = locais.length === 1 ? locais[0] : locais.length + ' lugares diferentes';

    const amostra = lista.slice(0, 8).map(function (a) { return a.tag; }).join(', ') +
      (lista.length > 8 ? ' e mais ' + (lista.length - 8) : '');

    ERP.app.modal({
      titulo: 'Movimentar ' + lista.length + ' equipamentos',
      fecharTxt: 'Cancelar',
      corpo:
        '<div class="resumo-linha"><span>Equipamentos</span><span class="v">' +
          lista.length + '</span></div>' +
        '<div class="resumo-linha"><span>São eles</span><span class="v mono">' +
          U.esc(amostra) + '</span></div>' +
        '<div class="resumo-linha"><span>Saem de</span><span class="v">' + U.esc(deOnde) + '</span></div>' +
        '<div class="row2">' +
          '<div><label>Nova situação *</label><select id="mv-status">' +
            D.STATUS_ATIVO.map(function (s) {
              return '<option value="' + s.id + '"' +
                (sits.length === 1 && s.id === sits[0] ? ' selected' : '') + '>' +
                U.esc(s.nome) + '</option>'; }).join('') + '</select></div>' +
          '<div><label>Data</label><input type="date" id="mv-data" value="' + U.hoje() + '"></div>' +
        '</div>' +
        '<div class="row2">' +
          '<div><label>Para onde *</label><input id="mv-destino" placeholder="ex.: Hospital Moacyr do Carmo — CTI"></div>' +
          '<div><label>Projeto</label><select id="mv-projeto"><option value="">— nenhum —</option>' +
            projetos.map(function (c) {
              return '<option value="' + c.id + '">' + U.esc(c.curto) + '</option>'; }).join('') +
          '</select></div>' +
        '</div>' +
        '<div class="row2">' +
          '<div><label>Custodiante</label><input id="mv-cust" placeholder="quem responde pelos equipamentos"></div>' +
          '<div><label>Documento de remessa</label><input id="mv-doc" placeholder="nº da remessa, e-mail, termo"></div>' +
        '</div>' +
        '<div class="row2">' +
          '<div><label>Telefone do custodiante</label><input id="mv-cust-fone" placeholder="opcional"></div>' +
          '<div><label>E-mail do custodiante</label><input id="mv-cust-email" type="email" placeholder="opcional"></div>' +
        '</div>' +
        '<label>Observação</label><input id="mv-obs">' +
        '<div class="ajuda">O mesmo destino vale para todos os marcados, e cada equipamento ganha o ' +
          'seu próprio evento no histórico — é ele que prova a entrega e a devolução. ' +
          'Equipamento que já estivesse exatamente assim é deixado como está, e no fim a tela diz ' +
          'quantos foram, quantos já estavam e quais foram recusados.</div>',
      acoes: [{ txt: 'Registrar em lote', cls: 'btn-aprovar', fn: function () {
        const base = { status: U.val('mv-status'), data: U.val('mv-data'),
          destino: U.val('mv-destino'), projeto: U.val('mv-projeto') || null,
          custodiante: U.val('mv-cust'),
          custodiante_telefone: U.val('mv-cust-fone'),
          custodiante_email: U.val('mv-cust-email'),
          documento: U.val('mv-doc'), observacao: U.val('mv-obs') };

        const feitos = [], iguais = [], recusados = [];
        lista.forEach(function (a) {
          const r = S.movimentarAtivo(Object.assign({ ativo: a.id }, base));
          if (r && r.ok) return feitos.push(a.tag);
          const msg = (r && r.erro) || 'recusado sem motivo informado';
          /* "Já está assim" não é falha: é o item que já estava no
             destino. Misturá-lo com as recusas de verdade faria a
             lista de problemas crescer com coisa que não é
             problema — e lista assim não se lê. */
          if (msg.indexOf('já está assim') > -1) iguais.push(a.tag);
          else recusados.push({ tag: a.tag, erro: msg });
        });

        /* Sobra marcado só o que FALHOU: é o que ainda precisa de
           ação, e deixar tudo marcado obrigaria a refazer a
           seleção à mão para tentar de novo. */
        marcados.clear();
        recusados.forEach(function (x) {
          const a = lista.find(function (y) { return y.tag === x.tag; });
          if (a) marcados.add(a.id);
        });

        ERP.app.fecharModal();
        render();

        if (!recusados.length) {
          ERP.app.aviso(feitos.length + ' movimentado(s)' +
            (iguais.length ? ', ' + iguais.length + ' já estava(m) assim' : '') + '.', 'ok');
          return;
        }
        ERP.app.modal({
          titulo: 'Movimentação em lote — ' + recusados.length + ' não passou(ram)',
          fecharTxt: 'Entendi',
          corpo:
            '<div class="resumo-linha"><span>Movimentados</span><span class="v">' +
              feitos.length + '</span></div>' +
            (iguais.length
              ? '<div class="resumo-linha"><span>Já estavam assim</span><span class="v">' +
                iguais.length + '</span></div>' : '') +
            '<div class="resumo-linha"><span>Recusados</span><span class="v erro">' +
              recusados.length + '</span></div>' +
            '<table class="tab"><thead><tr><th>Equipamento</th><th>Por quê</th></tr></thead><tbody>' +
            recusados.map(function (x) {
              return '<tr><td class="mono">' + U.esc(x.tag) + '</td>' +
                '<td class="desc">' + U.esc(x.erro) + '</td></tr>';
            }).join('') + '</tbody></table>' +
            '<div class="ajuda">Os recusados continuam marcados no inventário: resolva o motivo e ' +
              'repita a movimentação só deles.</div>'
        });
      } }]
    });
  }

  function editarAtivo(id) {
    const a = id ? S.ativo(id) : null;
    const cats = S.ativos({}).map(function (x) { return x.categoria; })
      .filter(function (c, i, arr) { return c && arr.indexOf(c) === i; }).sort();
    ERP.app.modal({
      titulo: a ? 'Editar ' + a.tag : 'Novo equipamento',
      fecharTxt: 'Cancelar',
      corpo:
        '<div class="row3">' +
          '<div><label>Tag de patrimônio</label><input id="av-tag" value="' + U.esc(a ? a.tag : '') + '" placeholder="gerada se vazia"></div>' +
          '<div><label>Categoria</label><input id="av-cat-i" list="av-cats" value="' + U.esc(a ? a.categoria || '' : '') + '">' +
            '<datalist id="av-cats">' + cats.map(function (c) { return '<option value="' + U.esc(c) + '">'; }).join('') + '</datalist></div>' +
          '<div><label>Criticidade</label><select id="av-crit">' +
            ['', 'alta', 'média', 'baixa'].map(function (c) {
              return '<option value="' + c + '"' + (a && a.criticidade === c ? ' selected' : '') + '>' + (c || '—') + '</option>';
            }).join('') + '</select></div>' +
        '</div>' +
        '<label>Descrição *</label><input id="av-desc" value="' + U.esc(a ? a.descricao : '') + '">' +
        '<div class="row3">' +
          '<div><label>Marca</label><input id="av-marca" value="' + U.esc(a ? a.marca || '' : '') + '"></div>' +
          '<div><label>Modelo</label><input id="av-modelo" value="' + U.esc(a ? a.modelo || '' : '') + '"></div>' +
          '<div><label>Número de série</label><input id="av-serie" value="' + U.esc(a ? a.serie || '' : '') + '"></div>' +
        '</div>' +
        '<div class="row3">' +
          '<div><label>Valor (R$)</label><input class="num" id="av-valor" inputmode="decimal" value="' + U.num(a ? a.valor || 0 : 0) + '"></div>' +
          '<div><label>Data de aquisição</label><input type="date" id="av-aq" value="' + (a && a.aquisicao ? a.aquisicao : '') + '"></div>' +
          '<div><label>Garantia até</label><input type="date" id="av-gar" value="' + (a && a.garantia_ate ? a.garantia_ate : '') + '"></div>' +
        '</div>' +
        '<div class="row3">' +
          '<div><label>NF de aquisição</label><input id="av-nf" value="' + U.esc(a ? a.nf || '' : '') + '"></div>' +
          '<div><label>Unidades neste registro</label><input class="num" id="av-qtd" inputmode="numeric" value="' + (a ? a.qtd || 1 : 1) + '"></div>' +
          '<div><label>Vida útil (meses)</label><input class="num" id="av-vida" inputmode="numeric" value="' + (a && a.vida_util_meses ? a.vida_util_meses : '') + '"></div>' +
        '</div>' +
        '<div class="row2">' +
          '<div><label>Nº de patrimônio (etiqueta atual)</label><input id="av-patrimonio" value="' +
            U.esc(a ? a.patrimonio || '' : '') + '"></div>' +
          '<div><label>Contratante (quem contratou o equipamento)</label>' +
            '<input id="av-contratante" list="av-contratantes" value="' +
            U.esc(a ? a.contratante_nome || '' : '') + '" placeholder="ex.: Unifor"></div>' +
        '</div>' +
        '<datalist id="av-contratantes">' +
          D.centros.filter(function (c) { return c.tipo === 'projeto' && c.ativo; })
            .map(function (c) { return '<option value="' + U.esc(c.curto) + '">'; }).join('') +
          (D.clientes || []).map(function (c) { return '<option value="' + U.esc(c.nome) + '">'; }).join('') +
        '</datalist>' +
        (!a ? '<div class="row2">' +
            '<div><label>Situação inicial</label><select id="av-status">' +
              D.STATUS_ATIVO.filter(function (s) { return s.id !== 'baixado'; }).map(function (s) {
                return '<option value="' + s.id + '">' + U.esc(s.nome) + '</option>'; }).join('') +
            '</select></div>' +
            '<div><label>Projeto (se alocado)</label><select id="av-proj">' +
              '<option value="">— nenhum —</option>' +
              D.centros.filter(function (c) { return c.tipo === 'projeto' && c.ativo; })
                .sort(function (x, y) { return String(x.curto).localeCompare(String(y.curto), 'pt-BR'); })
                .map(function (c) { return '<option value="' + c.id + '">' + U.esc(c.curto) + '</option>'; }).join('') +
            '</select></div></div>' +
          '<div class="row2">' +
            '<div><label>Onde está</label><input id="av-local" placeholder="ex.: Sede - Rio de Janeiro"></div>' +
            '<div></div></div>' : '') +
        /* CUSTODIANTE entra também na EDIÇÃO, diferente de local e
           situação. Trocar o lugar do equipamento é um fato que
           precisa de data, origem e documento — por isso só por
           movimentação. Já corrigir o nome de quem responde, ou
           acrescentar o telefone que ninguém tinha anotado, não é
           fato novo: é o cadastro ficando certo. Exigir uma
           movimentação para isso faria inventarem movimentação que
           não houve, e aí o histórico passa a mentir. */
        '<div class="row2">' +
          '<div><label>Custodiante</label><input id="av-cust" value="' +
            U.esc(a ? a.custodiante || '' : '') + '" placeholder="quem responde pelo equipamento"></div>' +
          '<div><label>Telefone</label><input id="av-cust-fone" value="' +
            U.esc(a ? a.custodiante_telefone || '' : '') + '" placeholder="opcional"></div>' +
        '</div>' +
        '<div class="row2">' +
          '<div><label>E-mail do custodiante</label><input id="av-cust-email" type="email" value="' +
            U.esc(a ? a.custodiante_email || '' : '') + '" placeholder="opcional"></div>' +
          '<div></div>' +
        '</div>' +
        '<label>Observação</label><input id="av-obs" value="' + U.esc(a ? a.observacao || '' : '') + '">' +
        '<div class="ajuda">Local e situação mudam por MOVIMENTAÇÃO, não por edição — é o que mantém o ' +
          'histórico confiável. Custodiante e contato podem ser corrigidos aqui: acertar quem responde ' +
          'não é um fato novo, é o cadastro ficando certo.</div>',
      acoes: [{ txt: 'Salvar', cls: 'btn-aprovar', fn: function () {
        const r = S.salvarAtivo({
          id: a ? a.id : undefined, tag: U.val('av-tag'), categoria: U.val('av-cat-i'),
          descricao: U.val('av-desc'), marca: U.val('av-marca'), modelo: U.val('av-modelo'),
          serie: U.val('av-serie'), valor: U.parseValor(U.val('av-valor')), aquisicao: U.val('av-aq'),
          garantia_ate: U.val('av-gar'), nf: U.val('av-nf'), qtd: parseInt(U.val('av-qtd'), 10) || 1,
          vida_util_meses: parseInt(U.val('av-vida'), 10) || null, criticidade: U.val('av-crit'),
          observacao: U.val('av-obs'),
          local: U.el('av-local') ? U.val('av-local') : undefined,
          custodiante: U.el('av-cust') ? U.val('av-cust') : undefined,
          custodiante_telefone: U.el('av-cust-fone') ? U.val('av-cust-fone') : undefined,
          custodiante_email: U.el('av-cust-email') ? U.val('av-cust-email') : undefined,
          patrimonio: U.el('av-patrimonio') ? U.val('av-patrimonio') : undefined,
          contratante_nome: U.el('av-contratante') ? U.val('av-contratante') : undefined,
          status: U.el('av-status') ? U.val('av-status') : undefined,
          projeto: U.el('av-proj') ? (U.val('av-proj') || null) : undefined
        });
        if (ERP.app.erroDoRetorno(r)) return;
        ERP.app.fecharModal(); render(); ERP.app.aviso('Equipamento salvo.', 'ok');
      } }]
    });
  }

  /* Desmembrar a compra: manter junto, dividir em lotes ou virar tudo
     unitário. Cada parte sai com história, locação e resultado
     próprios, e todas continuam apontando para a mesma compra. */
  function desmembrar(id) {
    const a = S.ativo(id);
    const total = a.qtd || 1;
    const projetos = D.centros.filter(function (c) { return c.tipo === 'projeto' && c.ativo; })
      .sort(function (x, y) { return String(x.curto).localeCompare(String(y.curto), 'pt-BR'); });
    const opProj = '<option value="">— sem projeto —</option>' + projetos.map(function (c) {
      return '<option value="' + c.id + '">' + U.esc(c.curto) + '</option>'; }).join('');
    const opStatus = D.STATUS_ATIVO.filter(function (s) { return s.id !== 'baixado'; })
      .map(function (s) { return '<option value="' + s.id + '">' + U.esc(s.nome) + '</option>'; }).join('');
    let linhas = [{ qtd: total, status: 'sede', local: '', projeto: '', custodiante: '' }];

    const desenhar = function () {
      const soma = linhas.reduce(function (x, l) { return x + (l.qtd || 0); }, 0);
      U.el('dm-linhas').innerHTML = linhas.map(function (l, i) {
        return '<div class="rateio-lin">' +
          '<input class="num" data-dm="' + i + '" data-c="qtd" inputmode="numeric" value="' + (l.qtd || 0) + '" style="max-width:70px">' +
          '<select data-dm="' + i + '" data-c="status">' + opStatus.replace('value="' + l.status + '"', 'value="' + l.status + '" selected') + '</select>' +
          '<input data-dm="' + i + '" data-c="local" placeholder="onde vai ficar" value="' + U.esc(l.local || '') + '">' +
          '<select data-dm="' + i + '" data-c="projeto">' + opProj.replace('value="' + l.projeto + '"', 'value="' + l.projeto + '" selected') + '</select>' +
          '<input data-dm="' + i + '" data-c="custodiante" placeholder="custodiante" value="' + U.esc(l.custodiante || '') + '">' +
          '<button class="btn-sm btn-cancelar" data-dm-x="' + i + '">×</button></div>';
      }).join('') +
      '<div class="ajuda' + (Math.abs(soma - total) > 0.0001 ? ' erro' : '') + '">' +
        U.num(soma) + ' de ' + U.num(total) + ' unidade(s) distribuídas · valor rateado por unidade: ' +
        brlSeguro(total ? Math.round(((a.valor || 0) / total) * 100) / 100 : 0) + '</div>';
      U.el('dm-linhas').querySelectorAll('[data-dm]').forEach(function (el) {
        el.addEventListener('change', function () {
          const l = linhas[+this.dataset.dm];
          l[this.dataset.c] = this.dataset.c === 'qtd' ? (parseInt(this.value, 10) || 0) : this.value;
          desenhar();
        });
      });
      U.el('dm-linhas').querySelectorAll('[data-dm-x]').forEach(function (el) {
        el.addEventListener('click', function () { linhas.splice(+this.dataset.dmX, 1); desenhar(); });
      });
    };

    ERP.app.modal({
      titulo: 'Desmembrar ' + a.tag + ' · ' + U.num(total) + ' unidades',
      fecharTxt: 'Cancelar',
      corpo:
        '<div class="resumo-linha"><span>Compra</span><span class="v">' + U.esc(a.descricao) +
          (a.nf ? ' · NF ' + U.esc(a.nf) : '') + '</span></div>' +
        '<div class="resumo-linha"><span>Valor total</span><span class="v">' + brlSeguro(a.valor || 0) + '</span></div>' +
        '<div class="ajuda">A entrega foi dividida? Distribua as unidades: cada parte vira um registro com ' +
          'história, locação e resultado próprios, todas apontando para esta mesma compra.</div>' +
        '<div class="ap-acoes" style="margin-bottom:8px">' +
          '<button class="btn-sm" id="dm-add">+ Parte</button>' +
          '<button class="btn-sm" id="dm-unit">Tudo unitário (' + U.num(total) + ' registros de 1)</button>' +
        '</div>' +
        '<div id="dm-linhas"></div>' +
        '<label style="margin-top:8px">Documento (remessa, NF)</label><input id="dm-doc" value="' +
          (a.nf ? 'NF ' + U.esc(a.nf) : '') + '">',
      acoes: [{ txt: 'Desmembrar', cls: 'btn-aprovar', fn: function () {
        const r = S.desmembrarAtivo(id, { partes: linhas, documento: U.val('dm-doc') });
        if (ERP.app.erroDoRetorno(r)) return;
        ERP.app.fecharModal(); render();
        ERP.app.aviso('Compra desmembrada em ' + r.partes.length + ' registro(s).', 'ok');
      } }],
      aoAbrir: function () {
        desenhar();
        U.el('dm-add').addEventListener('click', function () {
          linhas.push({ qtd: 1, status: 'sede', local: '', projeto: '', custodiante: '' });
          desenhar();
        });
        U.el('dm-unit').addEventListener('click', function () {
          const base = linhas[0] || {};
          const r = S.desmembrarAtivo(id, { modo: 'unitario', documento: U.val('dm-doc'),
            destino: { status: base.status || 'sede', local: base.local || '',
              projeto: base.projeto || '', custodiante: base.custodiante || '' } });
          if (ERP.app.erroDoRetorno(r)) return;
          ERP.app.fecharModal(); render();
          ERP.app.aviso(r.partes.length + ' equipamentos criados, um por unidade.', 'ok');
        });
      }
    });
  }

  /* ══════════════════════════════════════════════════════════
     ETIQUETA DE PATRIMÔNIO · 8,5 × 5,5 cm

     É o que faz o inventário andar no hospital: o QR aponta para a
     página pública de chamado, que abre sem login — quem está com
     o aparelho na mão fotografa e descreve o problema.

     O TAMANHO É FIXO E DECLARADO EM MILÍMETROS, não em pixels.
     Pixel na impressora depende de resolução e de escala do
     navegador; milímetro não. `@page{size:85mm 55mm}` faz a
     impressora usar a mídia certa, e a caixa tem exatamente a
     medida pedida.

     UMA ETIQUETA, UM MOLDE. O que aparece na tela e o que sai na
     impressora saem da MESMA função. Antes eram dois trechos de
     HTML parecidos, e parecido é o que se desencontra: a prévia
     mostrava série e local, a impressão só a série.  */
  const ET_MM = { largura: 85, altura: 55 };

  function urlDoChamado(a) {
    /* O padrão aponta para a página PÚBLICA de chamado, que fica
       num endereço separado do sistema: quem lê uma etiqueta não
       precisa descobrir onde está o ERP. O parâmetro
       `url_chamado` sobrepõe, para o dia em que houver domínio
       próprio. */
    const base = (S.st.parametros && S.st.parametros.url_chamado) ||
      'https://orb-chamado.vercel.app';
    return base + '?ativo=' + a.id + '&tag=' + encodeURIComponent(a.tag || '');
  }

  function qrDe(url) {
    /* O tamanho vem do CSS, em milímetros; o SVG tem viewBox e se
       estica sem perder nitidez. O número aqui é só o de partida. */
    try { return ERP.qrcode.svg(url, { tamanho: 160 }); }
    catch (e) { return '<div class="et-erro">' + U.esc(e.message) + '</div>'; }
  }

  /* O corpo de UMA etiqueta. Serve a prévia e a impressão. */
  function etiquetaCorpo(a) {
    const at = S.situacaoAtiva(a);
    return '<div class="et-qr">' + qrDe(urlDoChamado(a)) + '</div>' +
      '<div class="et-dados">' +
        '<div class="et-empresa">' + U.esc((D.empresa || {}).nome || '') + '</div>' +
        '<div class="et-tag">' + U.esc(a.tag) + '</div>' +
        '<div class="et-desc">' + U.esc(a.descricao) + '</div>' +
        (a.serie ? '<div class="et-sub">série ' + U.esc(a.serie) + '</div>' : '') +
        (at.local ? '<div class="et-sub">' + U.esc(at.local) + '</div>' : '') +
        '<div class="et-sub et-chamado">Problema com este equipamento? Aponte a câmera.</div>' +
      '</div>';
  }

  /* O estilo da impressão. `folha` decide a mídia: uma etiqueta sai
     na mídia de 8,5 × 5,5; um lote sai em A4 com as etiquetas lado a
     lado e guias de corte.

     Dois por linha, cinco por página: 2 × 85 = 170 mm e 5 × 55 =
     275 mm cabem na área imprimível de um A4 com 8 mm de margem
     (194 × 281 mm). Com três colunas não caberia, e a etiqueta
     seria cortada pela impressora — erro que só aparece depois de
     gastar a folha. */
  function etiquetaEstilo(folha) {
    return (folha
        ? '@page{size:A4;margin:8mm}'
        : '@page{size:' + ET_MM.largura + 'mm ' + ET_MM.altura + 'mm;margin:0}') +
      'html,body{margin:0;padding:0;background:#fff;' +
        'font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#000}' +
      (folha ? '.folha{display:grid;grid-template-columns:' +
        ET_MM.largura + 'mm ' + ET_MM.largura + 'mm;}' : '') +
      '.et{width:' + ET_MM.largura + 'mm;height:' + ET_MM.altura + 'mm;box-sizing:border-box;' +
        'padding:3.5mm;display:flex;gap:3.5mm;align-items:center;overflow:hidden;' +
        'break-inside:avoid;page-break-inside:avoid;' +
        (folha ? 'border:0.2mm dashed #bbb;' : '') + '}' +
      /* O QR ocupa a altura útil da etiqueta. Abaixo de uns 30 mm a
         câmera de telefone antigo começa a falhar com etiqueta
         suja, que é a condição real de um equipamento em uso. Em
         30 mm ele lê bem e sobra largura para o texto, que na
         primeira medição estava espremido em 45 mm. */
      '.et-qr{width:30mm;height:30mm;flex:0 0 30mm}' +
      '.et-qr svg{width:100%;height:100%;display:block}' +
      '.et-dados{min-width:0;flex:1;text-align:left}' +
      '.et-empresa{font-size:2.4mm;text-transform:uppercase;letter-spacing:.2mm;color:#555}' +
      '.et-tag{font:700 7mm/1.05 ui-monospace,Consolas,monospace;margin:.3mm 0}' +
      /* Descrição longa não pode empurrar o resto para fora da
         etiqueta: duas linhas e corta. */
      '.et-desc{font-size:3.1mm;line-height:1.15;display:-webkit-box;-webkit-line-clamp:2;' +
        '-webkit-box-orient:vertical;overflow:hidden}' +
      '.et-sub{font-size:2.4mm;color:#444;line-height:1.2;overflow:hidden;' +
        'text-overflow:ellipsis;white-space:nowrap}' +
      /* A frase que ensina o uso da etiqueta não pode ser cortada
         com reticências: cortada, ela deixa de ensinar. Quebra em
         duas linhas e cabe. */
      '.et-chamado{margin-top:.8mm;color:#666;white-space:normal;line-height:1.1}' +
      '.et-erro{font-size:2.4mm;color:#b00020}';
  }

  /* Abre a janela de impressão com o HTML pronto. Devolve `false`
     quando o navegador bloqueou — aqui o `window.open` é síncrono
     dentro do clique, então o bloqueio é raro, mas acontece com
     bloqueador agressivo e sem isto a pessoa não saberia por quê. */
  function imprimir(titulo, corpo, folha) {
    const w = window.open('', '_blank');
    if (!w) {
      ERP.app.aviso('O navegador bloqueou a janela de impressão. Libere o pop-up deste site.', 'erro');
      return false;
    }
    w.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
      '<title>' + U.esc(titulo) + '</title><style>' + etiquetaEstilo(folha) + '</style></head>' +
      '<body>' + corpo + '</body></html>');
    w.document.close();
    /* O SVG do QR já está no HTML, mas a janela precisa de um
       instante para montar a página antes de imprimir. */
    setTimeout(function () { w.print(); }, 300);
    return true;
  }

  function etiqueta(id) {
    const a = S.ativo(id);
    const url = urlDoChamado(a);
    ERP.app.modal({
      titulo: 'Etiqueta · ' + a.tag,
      fecharTxt: 'Fechar',
      corpo:
        '<div class="etiqueta-previa"><div class="et" id="etiqueta-print">' +
          etiquetaCorpo(a) + '</div></div>' +
        '<div class="ajuda">A prévia acima está no tamanho real: <b>8,5 × 5,5 cm</b>. ' +
          'A impressão sai nessa medida, então escolha a mídia desse tamanho na impressora — ' +
          'ou, para várias de uma vez, marque os equipamentos no inventário e use ' +
          '<b>Etiquetas</b>, que arruma duas por linha numa folha A4 com guia de corte.<br>' +
          'O código leva para <span class="mono">' + U.esc(url) + '</span>. ' +
          'A página de chamado abre sem login e já vem com o equipamento identificado.</div>',
      acoes: [{ txt: 'Imprimir etiqueta', cls: 'btn-aprovar', fn: function () {
        imprimir(a.tag, '<div class="et">' + etiquetaCorpo(a) + '</div>', false);
      } }]
    });
  }

  /* ── etiquetas em lote ───────────────────────────────────
     Cinquenta camas chegando num projeto são cinquenta etiquetas.
     Uma por vez são cinquenta janelas de impressão — e é assim que
     um inventário deixa de ser mantido. */
  function etiquetasEmLote(ids) {
    const lista = ids.map(function (i) { return S.ativo(i); })
      .filter(function (a) { return a && !a.desmembrado; });
    if (!lista.length) return ERP.app.aviso('Nenhum equipamento válido na seleção.', 'erro');
    const corpo = '<div class="folha">' + lista.map(function (a) {
      return '<div class="et">' + etiquetaCorpo(a) + '</div>';
    }).join('') + '</div>';
    if (imprimir('Etiquetas · ' + lista.length + ' equipamentos', corpo, true)) {
      ERP.app.aviso(lista.length + ' etiqueta(s) enviada(s) para impressão.', 'ok');
    }
  }

  /* Painel de manutenção: MTTR, MTBF e SLA saem das datas que a OS já
     grava — não precisa de cadastro novo. */
  function telaIndicadores() {
    const i = S.indicadoresManutencao({});
    const cal = S.calibracoesVencendo(60);
    const cartao = (rot, val, sub) =>
      '<div class="ind-card"><div class="rot">' + rot + '</div>' +
      '<div class="valor">' + val + '</div>' +
      '<div class="det">' + (sub || '') + '</div></div>';
    return '<div class="ind-grade">' +
        cartao('MTTR', i.mttr_dias === null ? '—' : i.mttr_dias + ' dias', 'tempo médio de reparo') +
        cartao('MTBF', i.mtbf_dias === null ? '—' : i.mtbf_dias + ' dias', 'entre falhas do mesmo equipamento') +
        cartao('SLA (' + i.sla_dias + ' dias)', i.sla_pct === null ? '—' : U.pct(i.sla_pct), 'OS fechadas no prazo') +
        cartao('Parado', i.dias_parado + ' dias', 'soma do tempo fora de operação') +
      '</div>' +
      '<div class="pr-confere">' +
        '<span>OS no período <b>' + i.total + '</b></span>' +
        '<span>Corretivas <b>' + i.corretivas + '</b></span>' +
        '<span>Preventivas <b>' + i.preventivas + '</b></span>' +
        '<span>Calibrações <b>' + i.calibracoes + '</b></span>' +
        '<span>Abertas <b class="' + (i.abertas ? 'erro' : '') + '">' + i.abertas + '</b></span>' +
        '<span>Custo <b>' + brlSeguro(i.custo) + '</b></span>' +
      '</div>' +
      '<h3 style="font-size:12px;margin:14px 0 4px">Calibração</h3>' +
      (cal.length
        ? '<table><thead><tr><th>Tag</th><th>Equipamento</th><th>Laudo válido até</th>' +
          '<th>Situação</th><th></th></tr></thead><tbody>' + cal.map(function (c) {
            return '<tr' + (c.vencido ? ' style="background:#fff4f2"' : '') + '>' +
              '<td class="mono">' + U.esc(c.ativo.tag) + '</td>' +
              '<td class="desc">' + U.esc(c.ativo.descricao) +
                (c.ativo.calibracao_laudo ? '<div class="sub">laudo ' + U.esc(c.ativo.calibracao_laudo) + '</div>' : '') + '</td>' +
              '<td class="mono">' + U.fData(c.valido_ate) + '</td>' +
              '<td>' + (c.vencido
                ? '<span class="badge b-vencido">vencido há ' + Math.abs(c.dias) + ' dias</span>'
                : '<span class="badge b-aguardando">vence em ' + c.dias + ' dias</span>') + '</td>' +
              '<td class="acoes">' + (S.pode('estoque')
                ? '<button class="btn-sm btn-aprovar" data-av-calibrar="' + c.ativo.id + '">Abrir calibração</button>' : '') +
              '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="ajuda">Nenhum laudo de calibração vencendo nos próximos 60 dias. ' +
          'Para acompanhar um equipamento, crie um plano do tipo "calibração" na aba Preventiva.</div>');
  }

  /* Baixa: venda, sucata, perda. Sai do inventário e para de
     depreciar, mas continua no histórico. */
  function baixar(id) {
    const a = S.ativo(id);
    const dep = S.depreciacaoDoAtivo(a);
    ERP.app.modal({
      titulo: 'Baixar ' + a.tag,
      fecharTxt: 'Cancelar',
      corpo:
        '<div class="resumo-linha"><span>Equipamento</span><span class="v">' + U.esc(a.descricao) + '</span></div>' +
        '<div class="resumo-linha"><span>Valor de aquisição</span><span class="v">' + brlSeguro(a.valor || 0) + '</span></div>' +
        '<div class="resumo-linha"><span>Valor residual (não depreciado)</span><span class="v">' +
          brlSeguro(dep.residual) + '</span></div>' +
        '<div class="row3">' +
          '<div><label>Motivo *</label><select id="bx-motivo">' +
            ['venda', 'sucata', 'perda', 'roubo ou extravio', 'devolução ao fornecedor'].map(function (m) {
              return '<option value="' + m + '">' + m + '</option>'; }).join('') + '</select></div>' +
          '<div><label>Data</label><input type="date" id="bx-data" value="' + U.hoje() + '"></div>' +
          '<div><label>Valor da venda (R$)</label><input class="num" id="bx-valor" inputmode="decimal" value="0,00">' +
            '<div class="sub">só para o motivo "venda"</div></div>' +
        '</div>' +
        '<div class="row2">' +
          '<div><label>Comprador (se venda)</label><input id="bx-comprador"></div>' +
          '<div><label>Documento</label><input id="bx-doc" placeholder="NF de venda, termo de baixa"></div>' +
        '</div>' +
        '<label>Observação</label><input id="bx-obs">' +
        '<div class="ajuda">A venda entra no contas a receber na conta de <b>alienação de imobilizado</b> ' +
          '(receita não operacional, tributada sobre o ganho de capital — não infla a receita de serviço). ' +
          'O ganho ou a perda é apurado contra o valor residual, e a locação, se houver, é encerrada na ' +
          'data da baixa. Indenização de seguro entra como recebível próprio, contra a seguradora.</div>',
      acoes: [{ txt: 'Baixar equipamento', cls: 'btn-cancelar', fn: function () {
        const r = S.baixarAtivo(id, { motivo: U.val('bx-motivo'), data: U.val('bx-data'),
          valor_venda: U.parseValor(U.val('bx-valor')) || null, observacao: U.val('bx-obs'),
          comprador: U.val('bx-comprador'), documento: U.val('bx-doc') });
        if (ERP.app.erroDoRetorno(r)) return;
        ERP.app.fecharModal(); render();
        ERP.app.aviso('Equipamento baixado. ' +
          (r.resultado >= 0 ? 'Ganho de ' : 'Perda de ') + brlSeguro(Math.abs(r.resultado)) +
          ' contra o valor residual' + (r.receber ? ', e a venda entrou no contas a receber.' : '.'), 'ok');
      } }]
    });
  }

  /* Vínculo com o contrato de locação que remunera o equipamento. */
  function locacao(id) {
    const a = S.ativo(id);
    const at = S.situacaoAtiva(a);
    const contratos = S.contratos({ parte: 'cliente' }).filter(function (c) { return !c.encerrado; });
    ERP.app.modal({
      titulo: 'Locação · ' + a.tag,
      fecharTxt: 'Cancelar',
      corpo:
        '<div class="resumo-linha"><span>Equipamento</span><span class="v">' + U.esc(a.descricao) + '</span></div>' +
        '<div class="resumo-linha"><span>Está em</span><span class="v">' +
          U.esc(at.local || '—') + (at.projeto ? ' · ' + U.esc(nomeProjeto(at.projeto)) : '') + '</span></div>' +
        '<label>Contrato que remunera este equipamento</label><select id="lc-contrato">' +
          '<option value="">— nenhum (não está locado) —</option>' +
          contratos.map(function (c) {
            return '<option value="' + c.id + '"' + (a.contrato === c.id ? ' selected' : '') + '>' +
              U.esc(c.numero + ' · ' + (c.objeto || '').slice(0, 40)) + '</option>';
          }).join('') + '</select>' +
        '<div class="row3">' +
          '<div><label>Valor mensal deste item (R$)</label><input class="num" id="lc-valor" inputmode="decimal" value="' +
            U.num(a.valor_locacao || 0) + '"></div>' +
          '<div><label>Locado desde</label><input type="date" id="lc-desde" value="' + (a.locacao_desde || U.hoje()) + '"></div>' +
          '<div><label>Devolvido em</label><input type="date" id="lc-ate" value="' + (a.locacao_ate || '') + '"></div>' +
        '</div>' +
        '<label>Item do contrato (descrição na fatura)</label><input id="lc-item" value="' + U.esc(a.item_locacao || '') + '">' +
        '<div class="ajuda">Com o vínculo, o sistema calcula receita acumulada menos aquisição e manutenção ' +
          'por equipamento — e quantos meses faltam pra compra se pagar. A receita conta até a devolução ou ' +
          'o fim do contrato, não até hoje.</div>',
      acoes: [{ txt: 'Salvar', cls: 'btn-aprovar', fn: function () {
        /* Lê o campo ANTES de fechar o modal: depois de fechado o campo
           não existe mais, e a mensagem saía sempre como "removido". */
        const escolhido = U.val('lc-contrato');
        const r = S.vincularLocacao(id, { contrato: escolhido || null,
          valor_locacao: U.parseValor(U.val('lc-valor')), desde: U.val('lc-desde'),
          ate: U.val('lc-ate') || null, item: U.val('lc-item') });
        if (ERP.app.erroDoRetorno(r)) return;
        ERP.app.fecharModal(); render();
        ERP.app.aviso(escolhido
          ? 'Locação vinculada — a receita deste equipamento passa a contar no resultado.'
          : 'Vínculo de locação removido.', 'ok');
      } }]
    });
  }

  /* ── ordens de serviço ──────────────────────────────────*/
  let mostrarCanceladas = false;
  /* ── Chamados abertos pelo QR da etiqueta ─────────────────
     Quem está com o equipamento na mão não tem acesso ao sistema:
     aponta a câmera, descreve, envia. É aqui que esse chamado
     aparece — e é daqui que ele vira ordem de serviço, que é o
     documento que registra o conserto. */
  let chamados = [];
  let chamadosLidos = false;

  function carregarChamados() {
    if (!ERP.persistencia || !ERP.persistencia.listarChamados) return;
    ERP.persistencia.listarChamados().then(function (lista) {
      chamados = lista || [];
      chamadosLidos = true;
      const n = chamados.filter(function (c) { return c.situacao === 'aberto'; }).length;
      const el = U.el('av-ch-n');
      if (el) { el.textContent = n; el.style.display = n ? '' : 'none'; }
      if (aba === 'chamados') render();
    });
  }

  const URGENCIA = { critica: ['Crítica', 'b-reprovado'], alta: ['Alta', 'b-aberto'],
    normal: ['Normal', 'b-aguardando'] };

  function telaChamados() {
    if (!chamadosLidos) {
      carregarChamados();
      return '<div class="card"><div class="ajuda">Carregando os chamados…</div></div>';
    }
    const abertos = chamados.filter(function (c) { return c.situacao === 'aberto'; });
    if (!chamados.length) {
      return '<div class="card"><div class="ajuda">Nenhum chamado ainda. ' +
        'Eles chegam quando alguém lê o QR da etiqueta de um equipamento e descreve um problema — ' +
        'sem precisar de acesso ao sistema.</div></div>';
    }
    let html = '';
    if (abertos.length) {
      html += '<div class="aviso"><b>' + abertos.length + ' chamado(s) em aberto.</b> ' +
        'Cada um virou um pedido de alguém que está com o equipamento na mão.</div>';
    }
    html += '<table class="rel"><thead><tr><th>Quando</th><th>Equipamento</th>' +
      '<th>Urgência</th><th>Problema</th><th>Quem abriu</th><th>Situação</th><th></th></tr></thead><tbody>';
    chamados.forEach(function (c) {
      const u = URGENCIA[c.urgencia] || URGENCIA.normal;
      const fechado = c.situacao !== 'aberto';
      html += '<tr' + (c.urgencia === 'critica' && !fechado ? ' style="background:#fbe9e7"' : '') + '>' +
        '<td class="sub">' + U.fData(String(c.criado_em || '').slice(0, 10)) + '</td>' +
        '<td><b>' + U.esc(c.tag || '—') + '</b>' +
          (c.local_informado ? '<div class="sub">' + U.esc(c.local_informado) + '</div>' : '') + '</td>' +
        '<td><span class="badge ' + u[1] + '">' + u[0] + '</span></td>' +
        '<td class="desc">' + U.esc(c.descricao || '') + '</td>' +
        '<td class="sub">' + U.esc(c.contato_nome || '—') +
          (c.contato_fone ? '<div class="sub">' + U.esc(c.contato_fone) + '</div>' : '') + '</td>' +
        '<td>' + (fechado
          ? '<span class="badge b-pago">' + U.esc(c.situacao) + '</span>' +
            (c.resposta ? '<div class="sub">' + U.esc(c.resposta) + '</div>' : '')
          : '<span class="badge b-aberto">aberto</span>') + '</td>' +
        /* `podeMover` é a verificação certa: `pode` testa AÇÃO
           nomeada, e movimentar ativos vem do nível M na matriz. Com
           a verificação errada, os botões sumiam para todo mundo. */
        '<td>' + (!fechado && S.podeMover('ativos')
          ? '<button class="btn-sm" data-ch-os="' + c.id + '">Abrir OS</button> ' +
            '<button class="btn-sm" data-ch-fechar="' + c.id + '">Encerrar</button>'
          : '') + '</td></tr>';
    });
    html += '</tbody></table>' +
      '<div class="ajuda">O chamado é o pedido; a <b>ordem de serviço</b> é o conserto. ' +
      'Abrir OS a partir daqui já leva o equipamento e o problema descritos — e o chamado fica ' +
      'amarrado a ela, para quem abriu saber o que aconteceu.</div>';
    return html;
  }

  function telaOS() {
    const lista = S.ordensServico({ incluir_canceladas: mostrarCanceladas });
    const abertas = lista.filter(function (o) { return o.status !== 'fechada'; });
    const custo = Math.round(lista.reduce(function (a, o) {
      return a + (o.custo_peca || 0) + (o.custo_servico || 0); }, 0) * 100) / 100;
    return '<div class="filtros">' +
        (S.pode('estoque') ? '<button class="btn-sm btn-aprovar" id="av-nova-os">+ Abrir OS</button>' : '') +
        '<label style="align-self:flex-end;font-weight:400"><input type="checkbox" id="av-os-canc" ' +
          'style="width:auto"' + (mostrarCanceladas ? ' checked' : '') + '> mostrar canceladas</label>' +
      '</div>' +
      '<div class="pr-confere"><span>Abertas <b class="' + (abertas.length ? 'erro' : '') + '">' + abertas.length + '</b></span>' +
        '<span>Total de OS <b>' + lista.length + '</b></span>' +
        '<span>Custo acumulado <b>' + brlSeguro(custo) + '</b></span></div>' +
      '<table><thead><tr><th>OS</th><th>Equipamento</th><th>Tipo</th><th>Aberta em</th>' +
        '<th>Solicitante</th><th>Executante</th><th>Situação</th><th class="num">Custo</th><th></th></tr></thead><tbody>' +
        (lista.length ? lista.map(function (o) {
          const a = S.ativo(o.ativo) || {};
          const dias = o.status === 'fechada' ? null : U.diasEntre(o.abertura, U.hoje());
          return '<tr' + (dias > 10 ? ' style="background:#fff4f2"' : '') + '>' +
            '<td class="mono">' + U.esc(o.numero) + '</td>' +
            '<td class="desc">' + U.esc(a.tag || '') + ' · ' + U.esc((a.descricao || '').slice(0, 34)) +
              (o.parada_uso ? '<div class="sub erro">parado</div>' : '') + '</td>' +
            '<td class="sub">' + o.tipo + '</td>' +
            '<td class="mono">' + U.fData(o.abertura) +
              (dias !== null ? '<div class="sub">' + dias + ' dias</div>' : '') + '</td>' +
            '<td class="sub">' + U.esc(o.solicitante || '') + '</td>' +
            '<td class="sub">' + U.esc(o.executante || '—') + '</td>' +
            '<td>' + (o.status === 'fechada'
              ? '<span class="badge b-pago">fechada</span>'
              : o.status === 'cancelada'
                ? '<span class="badge sit-cancelado">cancelada</span>'
                : '<span class="badge b-' + (o.status === 'aberta' ? 'vencido' : 'aguardando') + '">' +
                  U.esc(S.NOME_ETAPA_OS[o.status] || o.status) + '</span>') + '</td>' +
            '<td class="num">' + brlSeguro((o.custo_peca || 0) + (o.custo_servico || 0)) + '</td>' +
            '<td class="acoes">' + (o.status !== 'fechada' && S.pode('estoque')
              ? S.ETAPAS_OS.filter(function (e) { return e !== 'fechada' && e !== o.status; })
                  .map(function (e) {
                    return '<button class="btn-sm" data-av-mover="' + o.id + '" data-etapa="' + e + '">' +
                      U.esc(S.NOME_ETAPA_OS[e]) + '</button>';
                  }).join(' ') + ' ' : '') +
              (o.status !== 'fechada' && (S.pode('estoque') || S.pode('lancar'))
                ? '<button class="btn-sm btn-aprovar" data-av-fechar="' + o.id + '">Fechar</button>' : '') +
              (['fechada', 'cancelada'].indexOf(o.status) < 0 && S.pode('estoque')
                ? ' <button class="btn-sm btn-cancelar" data-av-cancelar-os="' + o.id + '">Cancelar</button>' : '') +
              (['fechada', 'cancelada'].indexOf(o.status) > -1 && S.pode('estoque')
                ? ' <button class="btn-sm" data-av-reabrir-os="' + o.id + '">Reabrir</button>' : '') +
              '</td></tr>';
        }).join('')
          : '<tr><td colspan="9" class="vazio"><strong>Nenhuma ordem de serviço.</strong></td></tr>') +
      '</tbody></table>';
  }

  function novaOS(ativoId) {
    const lista = S.ativos({});
    ERP.app.modal({
      titulo: 'Abrir ordem de serviço',
      fecharTxt: 'Cancelar',
      corpo:
        '<label>Equipamento *</label><select id="os-ativo">' + lista.map(function (a) {
          return '<option value="' + a.id + '"' + (a.id === ativoId ? ' selected' : '') + '>' +
            U.esc(a.tag + ' · ' + a.descricao.slice(0, 40)) + '</option>'; }).join('') + '</select>' +
        '<div class="row2">' +
          '<div><label>Tipo</label><select id="os-tipo">' +
            '<option value="corretiva">Corretiva</option><option value="preventiva">Preventiva</option></select></div>' +
          '<div><label>Abertura</label><input type="date" id="os-data" value="' + U.hoje() + '"></div>' +
        '</div>' +
        '<label>O que houve *</label><input id="os-desc" placeholder="ex.: respirador não liga após queda de energia">' +
        '<div class="row2">' +
          '<div><label>Executante</label><input id="os-exec" placeholder="técnico interno ou fornecedor"></div>' +
          '<div><label style="font-weight:400;margin-top:22px"><input type="checkbox" id="os-parada" style="width:auto"> ' +
            'equipamento parado (sai de operação)</label></div>' +
        '</div>',
      acoes: [{ txt: 'Abrir OS', cls: 'btn-aprovar', fn: function () {
        const r = S.abrirOS({ ativo: U.val('os-ativo'), tipo: U.val('os-tipo'), abertura: U.val('os-data'),
          descricao: U.val('os-desc'), executante: U.val('os-exec'), parada_uso: U.el('os-parada').checked });
        if (ERP.app.erroDoRetorno(r)) return;
        ERP.app.fecharModal(); aba = 'os'; render();
        ERP.app.aviso(r.os.numero + ' aberta.', 'ok');
      } }]
    });
  }

  function fecharOS(id) {
    const os = S.ordensServico({}).find(function (o) { return o.id === id; });
    const a = S.ativo(os.ativo) || {};
    const at = S.situacaoAtiva(a);
    const credores = D.credores.filter(function (c) { return c.ativo !== false && ['medico', 'funcionario'].indexOf(c.tipo) < 0; })
      .sort(function (x, y) { return String(x.nome).localeCompare(String(y.nome), 'pt-BR'); });
    ERP.app.modal({
      titulo: 'Fechar ' + os.numero,
      fecharTxt: 'Cancelar',
      corpo:
        '<div class="resumo-linha"><span>Equipamento</span><span class="v">' + U.esc(a.tag + ' · ' + a.descricao) + '</span></div>' +
        '<div class="resumo-linha"><span>Projeto</span><span class="v">' +
          U.esc(os.projeto ? nomeProjeto(os.projeto) : 'sem projeto') + '</span></div>' +
        '<div class="row2">' +
          '<div><label>Custo de peça (R$)</label><input class="num" id="os-peca" inputmode="decimal" value="0,00"></div>' +
          '<div><label>Custo de serviço (R$)</label><input class="num" id="os-serv" inputmode="decimal" value="0,00"></div>' +
        '</div>' +
        '<div class="row2">' +
          '<div><label>Fornecedor que cobra</label><select id="os-cred"><option value="">— sem custo / interno —</option>' +
            credores.map(function (c) { return '<option value="' + c.id + '">' + U.esc(c.nome) + '</option>'; }).join('') +
            '</select></div>' +
          '<div><label>NF / documento</label><input id="os-doc"></div>' +
        '</div>' +
        '<label style="font-weight:400"><input type="checkbox" id="os-interno" style="width:auto"> ' +
          'custo interno (mão de obra própria — não gera conta a pagar)</label>' +
        '<label>Laudo / o que foi feito</label><input id="os-laudo">' +
        (os.tipo === 'calibracao'
          ? '<div class="row2">' +
              '<div><label>Número do laudo</label><input id="os-laudo-num"></div>' +
              '<div><label>Laudo válido até</label><input type="date" id="os-laudo-ate"></div>' +
            '</div>'
          : '') +
        '<div class="row2">' +
          '<div><label>Data do fechamento</label><input type="date" id="os-data" value="' + U.hoje() + '"></div>' +
          '<div><label>Vencimento do pagamento</label><input type="date" id="os-venc" value="' +
            U.addDias(U.hoje(), 15) + '"></div>' +
        '</div>' +
        (os.parada_uso ? '<div class="row2">' +
          /* Volta para onde ESTAVA antes da OS, não para o local atual
             (que é a oficina). */
          '<div><label>Devolver para</label><input id="os-volta" value="' +
            U.esc((os.voltar_para || {}).local || at.local || '') + '"></div>' +
          '<div><label>Custodiante</label><input id="os-cust" value="' +
            U.esc((os.voltar_para || {}).custodiante || '') + '"></div></div>' : '') +
        '<div class="ajuda">Com fornecedor e custo, o valor vira conta a pagar no centro do projeto onde o ' +
          'equipamento está — é assim que a manutenção entra na margem do contrato certo.</div>',
      acoes: [{ txt: 'Fechar OS', cls: 'btn-aprovar', fn: function () {
        const r = S.fecharOS(id, {
          custo_peca: U.parseValor(U.val('os-peca')), custo_servico: U.parseValor(U.val('os-serv')),
          executante_credor: U.val('os-cred') || null, documento: U.val('os-doc'), laudo: U.val('os-laudo'),
          custo_interno: U.el('os-interno') ? U.el('os-interno').checked : false,
          data: U.val('os-data'), vencimento: U.val('os-venc'),
          laudo_numero: U.el('os-laudo-num') ? U.val('os-laudo-num') : '',
          laudo_valido_ate: U.el('os-laudo-ate') ? (U.val('os-laudo-ate') || null) : null,
          devolver_para: U.el('os-volta') ? U.val('os-volta') : null,
          custodiante: U.el('os-cust') ? U.val('os-cust') : '',
          status_volta: (os.voltar_para || {}).status || (os.projeto ? 'alocado' : 'sede')
        });
        if (ERP.app.erroDoRetorno(r)) return;
        ERP.app.fecharModal(); render();
        ERP.app.aviso('OS fechada.' + (r.titulo ? ' Custo lançado no contas a pagar.' : ''), 'ok');
      } }]
    });
  }

  /* ── preventiva ─────────────────────────────────────────*/
  function telaPreventiva() {
    const planos = S.st.planosManutencao;
    const cats = S.ativos({}).map(function (a) { return a.categoria; })
      .filter(function (c, i, arr) { return c && arr.indexOf(c) === i; }).sort();
    return '<div class="filtros">' +
        (S.pode('estoque') ? '<button class="btn-sm btn-aprovar" id="av-novo-plano">+ Plano de manutenção</button>' : '') +
      '</div>' +
      '<div class="ajuda">A preventiva que vence é aberta como OS quando alguém entra neste módulo — ' +
        'sem servidor, é o que substitui o job diário.</div>' +
      (planos.length
        ? '<table><thead><tr><th>Alvo</th><th>Periodicidade</th><th>Checklist</th><th>Próxima</th>' +
          '<th>Responsável</th><th></th></tr></thead><tbody>' + planos.map(function (p) {
            const alvo = p.ativo ? (S.ativo(p.ativo) || {}) : null;
            const venceu = p.proxima && p.proxima <= U.hoje();
            return '<tr' + (venceu ? ' style="background:#fff4f2"' : '') + '>' +
              '<td class="desc">' + (alvo ? U.esc(alvo.tag + ' · ' + alvo.descricao.slice(0, 34))
                : 'Categoria: ' + U.esc(p.categoria)) + '</td>' +
              '<td class="sub">a cada ' + p.periodicidade_dias + ' dias</td>' +
              '<td class="sub">' + U.esc(p.checklist || '—') + '</td>' +
              '<td class="mono' + (venceu ? ' erro' : '') + '">' + U.fData(p.proxima) + '</td>' +
              '<td class="sub">' + U.esc(p.responsavel || '—') + '</td>' +
              '<td class="acoes">' + (S.pode('estoque')
                ? '<button class="btn-sm" data-av-plano="' + p.id + '">Editar</button> ' +
                  '<button class="btn-sm btn-cancelar" data-av-plano-x="' + p.id + '">Excluir</button>' : '') + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="vazio"><strong>Nenhum plano de manutenção.</strong>' +
          'Um plano por equipamento ou por categoria (ex.: respiradores a cada 180 dias).</div>') +
      '<datalist id="av-cats-pl">' + cats.map(function (c) { return '<option value="' + U.esc(c) + '">'; }).join('') + '</datalist>';
  }

  function novoPlano(planoId) {
    const p0 = planoId ? S.st.planosManutencao.find(function (x) { return x.id === planoId; }) : null;
    const lista = S.ativos({});
    ERP.app.modal({
      titulo: p0 ? 'Editar plano de manutenção' : 'Plano de manutenção preventiva',
      fecharTxt: 'Cancelar',
      corpo:
        '<div class="ajuda">Escolha um equipamento OU uma categoria inteira (nesse caso, a OS é aberta ' +
          'para cada equipamento dela).</div>' +
        '<div class="row2">' +
          '<div><label>Equipamento</label><select id="pl-ativo"><option value="">— por categoria —</option>' +
            lista.map(function (a) {
              return '<option value="' + a.id + '"' + (p0 && p0.ativo === a.id ? ' selected' : '') + '>' +
                U.esc(a.tag + ' · ' + a.descricao.slice(0, 34)) + '</option>';
            }).join('') + '</select></div>' +
          '<div><label>Categoria</label><input id="pl-cat" list="av-cats-pl" value="' +
            U.esc(p0 ? p0.categoria || '' : '') + '" placeholder="ex.: Ventilação / Respiradores"></div>' +
        '</div>' +
        '<div class="row3">' +
          '<div><label>Tipo</label><select id="pl-tipo">' +
            '<option value="preventiva"' + (p0 && p0.tipo !== 'calibracao' ? ' selected' : '') + '>Preventiva</option>' +
            '<option value="calibracao"' + (p0 && p0.tipo === 'calibracao' ? ' selected' : '') + '>Calibração (com laudo)</option>' +
          '</select></div>' +
          '<div><label>Validade do laudo (meses)</label><input class="num" id="pl-validade" inputmode="numeric" value="' +
            (p0 && p0.validade_laudo_meses ? p0.validade_laudo_meses : 12) + '"></div>' +
          '<div><label>A cada quantos dias *</label><input class="num" id="pl-dias" inputmode="numeric" value="' +
            (p0 ? p0.periodicidade_dias : 180) + '"></div>' +
          '<div><label>Próxima</label><input type="date" id="pl-prox" value="' +
            (p0 ? p0.proxima : U.addDias(U.hoje(), 180)) + '"></div>' +
          '<div><label>Responsável</label><input id="pl-resp" value="' + U.esc(p0 ? p0.responsavel || '' : '') + '"></div>' +
        '</div>' +
        '<label>Checklist</label><input id="pl-check" value="' + U.esc(p0 ? p0.checklist || '' : '') +
          '" placeholder="ex.: troca de filtro, teste de alarme, calibração do fluxo">',
      acoes: [{ txt: 'Salvar plano', cls: 'btn-aprovar', fn: function () {
        const r = S.salvarPlanoManutencao({ id: p0 ? p0.id : undefined,
          ativo: U.val('pl-ativo') || null, categoria: U.val('pl-cat') || null,
          tipo: U.val('pl-tipo'), validade_laudo_meses: parseInt(U.val('pl-validade'), 10) || null,
          periodicidade_dias: parseInt(U.val('pl-dias'), 10) || 0, proxima: U.val('pl-prox'),
          responsavel: U.val('pl-resp'), checklist: U.val('pl-check') });
        if (ERP.app.erroDoRetorno(r)) return;
        ERP.app.fecharModal(); render(); ERP.app.aviso('Plano salvo.', 'ok');
      } }]
    });
  }

  /* ── ociosidade e resultado ─────────────────────────────*/
  function telaOciosos() {
    const lista = S.ociosidadeAtivos();
    const valor = Math.round(lista.reduce(function (a, x) { return a + (x.valor || 0); }, 0) * 100) / 100;
    return '<div class="pr-confere">' +
        '<span>Equipamentos parados <b class="' + (lista.length ? 'erro' : '') + '">' + lista.length + '</b></span>' +
        '<span>Capital imobilizado parado <b>' + brlSeguro(valor) + '</b></span></div>' +
      '<div class="ajuda">Equipamento sem projeto é dinheiro parado: ou entra num contrato, ou é devolvido, ' +
        'ou vira venda. A coluna de dias conta desde o último evento.</div>' +
      (lista.length
        ? '<table><thead><tr><th>Tag</th><th>Equipamento</th><th>Situação</th><th>Onde está</th>' +
          '<th class="num">Parado há</th><th class="num">Valor</th><th></th></tr></thead><tbody>' +
          lista.map(function (a) {
            return '<tr><td class="mono">' + U.esc(a.tag) + '</td>' +
              '<td class="desc">' + U.esc(a.descricao) + '</td>' +
              '<td>' + badge(a.status) + '</td>' +
              '<td class="sub">' + U.esc(a.local || '—') + '</td>' +
              '<td class="num' + (a.dias_parado > 180 ? ' erro' : '') + '">' +
                (a.dias_parado === null ? '—' : a.dias_parado + ' dias') + '</td>' +
              '<td class="num">' + brlSeguro(a.valor || 0) + '</td>' +
              '<td class="acoes">' + (S.pode('estoque')
                ? '<button class="btn-sm btn-aprovar" data-av-mov="' + a.id + '">Alocar</button>' : '') + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="vazio"><strong>Nenhum equipamento parado.</strong>Tudo alocado.</div>');
  }

  let resPorCompra = false;
  function telaResultado() {
    const itens = S.ativos({}).map(function (a) { return S.resultadoDoAtivo(a.id); }).filter(Boolean);
    const lista = resPorCompra
      ? Object.keys(itens.reduce(function (acc, r) {
          acc[r.ativo.compra || r.ativo.id] = true; return acc; }, {}))
          .map(function (k) {
            const c = S.resultadoDaCompra(k);
            const p0 = c.partes[0];
            return Object.assign({}, c, {
              ativo: { tag: ((S.ativo(k) || {}).tag) || p0.ativo.tag,
                descricao: p0.ativo.descricao + (c.partes.length > 1 ? ' · ' + c.partes.length + ' partes' : '') },
              meses: Math.max.apply(null, c.partes.map(function (x) { return x.meses; })),
              os: c.partes.reduce(function (s2, x) { return s2 + x.os; }, 0),
              meses_para_pagar: null
            });
          })
      : itens;
    lista.sort(function (x, y) { return y.resultado - x.resultado; });
    return '<div class="filtros">' +
        '<label style="font-weight:400"><input type="checkbox" id="av-por-compra" style="width:auto"' +
          (resPorCompra ? ' checked' : '') + '> agrupar por compra (em vez de por unidade)</label></div>' +
      '<div class="ajuda">Nos meses já faturados vale a NOTA emitida, rateada entre os equipamentos do ' +
        'contrato na proporção do valor de locação de cada um; nos meses que ainda não faturaram, vale a ' +
        'estimativa mensal do equipamento. Menos aquisição e manutenção. ' +
        'É o número que decide comprar, alugar ou sucatear — e que precifica a próxima proposta de locação. ' +
        'Equipamento sem contrato de locação amarrado aparece só com o custo.</div>' +
      '<div class="tabela-rolagem" style="margin:0 -14px"><table><thead><tr>' +
        '<th>Tag</th><th>Equipamento</th><th class="num">Meses</th><th class="num">Receita</th>' +
        '<th class="num">Faturado</th><th class="num">Estimado</th>' +
        '<th class="num">Aquisição</th><th class="num">Manutenção</th><th class="num">OS</th>' +
        '<th class="num">Falta p/ pagar</th><th class="num">Resultado</th></tr></thead><tbody>' +
        lista.map(function (r) {
          return '<tr><td class="mono">' + U.esc(r.ativo.tag) + '</td>' +
            '<td class="desc">' + U.esc(r.ativo.descricao) + '</td>' +
            '<td class="num sub">' + (r.meses || '—') + '</td>' +
            '<td class="num">' + brlSeguro(r.receita) + '</td>' +
            /* Quanto da receita já é nota emitida e quanto ainda é
               promessa: é a diferença entre projeção e realizado. */
            '<td class="num">' + (r.receita_real ? brlSeguro(r.receita_real) : '—') +
              (r.meses_faturados ? '<div class="sub">' + r.meses_faturados + ' mês(es)</div>' : '') + '</td>' +
            '<td class="num sub">' + (r.receita_estimada ? brlSeguro(r.receita_estimada) : '—') + '</td>' +
            '<td class="num sub">' + brlSeguro(r.aquisicao) + '</td>' +
            '<td class="num sub">' + brlSeguro(r.manutencao) + '</td>' +
            '<td class="num sub">' + r.os + '</td>' +
            '<td class="num sub">' + (r.meses_para_pagar === null ? '—'
              : r.meses_para_pagar === 0 ? 'pago' : r.meses_para_pagar + ' meses') + '</td>' +
            '<td class="num' + (r.resultado < 0 ? ' erro' : '') + '">' + brlSeguro(r.resultado) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
  }

  function ligar() {
    /* ── seleção do inventário ───────────────────────── */
    const liga = function (id, ev, fn) { const e = U.el(id); if (e) e.addEventListener(ev, fn); };
    document.querySelectorAll('[data-av-marca]').forEach(function (c) {
      c.addEventListener('change', function () {
        if (this.checked) marcados.add(this.dataset.avMarca);
        else marcados.delete(this.dataset.avMarca);
        render();
      });
    });
    liga('av-marca-todos', 'change', function () {
      const visiveis = Array.from(document.querySelectorAll('[data-av-marca]'))
        .map(function (c) { return c.dataset.avMarca; });
      if (this.checked) visiveis.forEach(function (i) { marcados.add(i); });
      else visiveis.forEach(function (i) { marcados.delete(i); });
      render();
    });
    liga('av-sel-limpar', 'click', function () { marcados.clear(); render(); });
    liga('av-mov-lote', 'click', function () { movimentarLote(Array.from(marcados)); });
    liga('av-etq-lote', 'click', function () { etiquetasEmLote(Array.from(marcados)); });

    /* Chamado vira ORDEM DE SERVIÇO: é a OS que registra o conserto,
       com custo, técnico e data. O chamado sozinho é só o pedido. */
    document.querySelectorAll('[data-ch-os]').forEach(function (b2) {
      b2.addEventListener('click', function () {
        const ch = chamados.find(function (x) { return String(x.id) === b2.dataset.chOs; });
        if (!ch) return;
        const r = S.abrirOS({ ativo: ch.ativo, tipo: 'corretiva',
          descricao: ch.descricao,
          solicitante: ch.contato_nome || 'chamado pela etiqueta',
          abertura: U.hoje() });
        if (ERP.app.erroDoRetorno(r)) return;
        ERP.persistencia.responderChamado(ch.id, {
          situacao: 'em_atendimento',
          resposta: 'OS ' + (r.os ? r.os.numero || r.os.id : '') + ' aberta',
          atendido_por: (S.usuario() || {}).nome || '',
          atendido_em: new Date().toISOString()
        }).then(function () {
          chamadosLidos = false;
          ERP.app.aviso('Ordem de serviço aberta a partir do chamado.', 'ok');
          render();
        });
      });
    });
    document.querySelectorAll('[data-ch-fechar]').forEach(function (b2) {
      b2.addEventListener('click', function () {
        const id = b2.dataset.chFechar;
        ERP.app.modal({
          titulo: 'Encerrar chamado', fecharTxt: 'Cancelar',
          corpo: '<label for="ch-resp">O que foi feito</label>' +
            '<input id="ch-resp" placeholder="ex.: equipamento reiniciado, sem defeito">' +
            '<div class="ajuda">Quem abriu o chamado não vê esta resposta hoje — ela fica no ' +
            'registro, para a próxima vez que alguém olhar o histórico do equipamento.</div>',
          acoes: [{ txt: 'Encerrar', cls: 'btn-aprovar', fn: function () {
            ERP.persistencia.responderChamado(id, {
              situacao: 'encerrado', resposta: U.val('ch-resp'),
              atendido_por: (S.usuario() || {}).nome || '',
              atendido_em: new Date().toISOString()
            }).then(function (r) {
              if (ERP.app.erroDoRetorno(r)) return;
              ERP.app.fecharModal();
              chamadosLidos = false;
              render();
            });
          } }]
        });
      });
    });

    const box = U.el('av-saida');
    const relerFiltros = function () {
      f = { busca: U.val('av-busca'), status: U.val('av-status'),
        projeto: U.val('av-projeto'), categoria: U.val('av-cat') };
      render();
    };
    ['av-status', 'av-projeto', 'av-cat'].forEach(function (id) {
      const el = U.el(id);
      if (el) el.addEventListener('change', relerFiltros);
    });
    /* A BUSCA FILTRA ENQUANTO SE DIGITA, como a da Documentação.
       Estava em `change`: a lista só mudava ao sair do campo, e
       quem digitava "CAMA" via a tela inteira parada — o jeito mais
       fácil de concluir que a busca não funciona.

       Redesenhar recria o campo e o foco volta para o começo da
       página; sem devolvê-lo, digitar o segundo caractere seria
       impossível. */
    const busca = U.el('av-busca');
    if (busca) {
      busca.addEventListener('input', function () {
        relerFiltros();
        const e = U.el('av-busca');
        if (e) { e.focus(); e.setSelectionRange(e.value.length, e.value.length); }
      });
    }
    if (U.el('av-novo')) U.el('av-novo').addEventListener('click', function () { editarAtivo(null); });
    if (U.el('av-nova-os')) U.el('av-nova-os').addEventListener('click', function () { novaOS(null); });
    if (U.el('av-novo-plano')) U.el('av-novo-plano').addEventListener('click', novoPlano);
    if (U.el('av-exportar')) U.el('av-exportar').addEventListener('click', exportar);
    if (U.el('av-por-compra')) {
      U.el('av-por-compra').addEventListener('change', function () { resPorCompra = this.checked; render(); });
    }
    box.querySelectorAll('[data-av-ficha]').forEach(function (b) {
      b.addEventListener('click', function () { ficha(this.dataset.avFicha); });
    });
    box.querySelectorAll('[data-av-mov]').forEach(function (b) {
      b.addEventListener('click', function () { movimentar(this.dataset.avMov); });
    });
    box.querySelectorAll('[data-av-etiqueta]').forEach(function (b) {
      b.addEventListener('click', function () { etiqueta(this.dataset.avEtiqueta); });
    });
    box.querySelectorAll('[data-av-calibrar]').forEach(function (b) {
      b.addEventListener('click', function () {
        const r = S.abrirOS({ ativo: this.dataset.avCalibrar, tipo: 'calibracao',
          descricao: 'Calibração — laudo vencendo' });
        if (ERP.app.erroDoRetorno(r)) return;
        aba = 'os'; render();
        ERP.app.aviso(r.os.numero + ' aberta para calibração.', 'ok');
      });
    });
    box.querySelectorAll('[data-av-mover]').forEach(function (b) {
      b.addEventListener('click', function () {
        const r = S.moverOS(this.dataset.avMover, this.dataset.etapa);
        if (ERP.app.erroDoRetorno(r)) return;
        render();
        ERP.app.aviso('OS em ' + S.NOME_ETAPA_OS[this.dataset.etapa] + '.', 'ok');
      });
    });
    box.querySelectorAll('[data-av-editar]').forEach(function (b) {
      b.addEventListener('click', function () { editarAtivo(this.dataset.avEditar); });
    });
    box.querySelectorAll('[data-av-baixar]').forEach(function (b) {
      b.addEventListener('click', function () { baixar(this.dataset.avBaixar); });
    });
    box.querySelectorAll('[data-av-plano]').forEach(function (b) {
      b.addEventListener('click', function () { novoPlano(this.dataset.avPlano); });
    });
    box.querySelectorAll('[data-av-plano-x]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = this.dataset.avPlanoX;
        ERP.app.modal({
          titulo: 'Excluir plano de manutenção',
          fecharTxt: 'Cancelar',
          corpo: '<div class="ajuda">A preventiva deixa de ser aberta automaticamente. ' +
            'As OS já abertas continuam como estão.</div>',
          acoes: [{ txt: 'Excluir', cls: 'btn-cancelar', fn: function () {
            S.st.planosManutencao = S.st.planosManutencao.filter(function (p) { return p.id !== id; });
            ERP.app.fecharModal(); render(); ERP.app.aviso('Plano excluído.', 'ok');
          } }]
        });
      });
    });
    if (U.el('av-os-canc')) {
      U.el('av-os-canc').addEventListener('change', function () {
        mostrarCanceladas = this.checked; render();
      });
    }
    box.querySelectorAll('[data-av-reabrir-os]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = this.dataset.avReabrirOs;
        ERP.app.modal({
          titulo: 'Reabrir ordem de serviço', fecharTxt: 'Voltar',
          corpo: '<div class="ajuda">A OS volta para "em execução". Se ela tinha devolvido o equipamento, ' +
            'ele volta para a manutenção; se tinha gerado custo no contas a pagar, o título é cancelado ' +
            '(a reabertura é recusada se o custo já foi pago).</div>' +
            '<label>Motivo *</label><input id="ro-motivo" placeholder="ex.: retorno lançado no lugar errado">',
          acoes: [{ txt: 'Reabrir', cls: 'btn-aprovar', fn: function () {
            const r = S.reabrirOS(id, U.val('ro-motivo'));
            if (ERP.app.erroDoRetorno(r)) return;
            ERP.app.fecharModal(); render();
            ERP.app.aviso('OS reaberta.' + (r.retornos_desfeitos ? ' O equipamento voltou para a manutenção.' : ''), 'ok');
          } }]
        });
      });
    });
    box.querySelectorAll('[data-av-cancelar-os]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = this.dataset.avCancelarOs;
        ERP.app.modal({
          titulo: 'Cancelar ordem de serviço', fecharTxt: 'Voltar',
          corpo: '<div class="ajuda">Cancelar é para OS aberta por engano ou duplicada — nada de custo é ' +
            'lançado. Se o equipamento estava parado por ela, volta para onde estava.</div>' +
            '<label>Motivo *</label><input id="co-motivo" placeholder="ex.: aberta no equipamento errado">',
          acoes: [{ txt: 'Cancelar OS', cls: 'btn-cancelar', fn: function () {
            const r = S.cancelarOS(id, U.val('co-motivo'));
            if (ERP.app.erroDoRetorno(r)) return;
            ERP.app.fecharModal(); render(); ERP.app.aviso('OS cancelada.', 'ok');
          } }]
        });
      });
    });
    box.querySelectorAll('[data-av-fechar]').forEach(function (b) {
      b.addEventListener('click', function () { fecharOS(this.dataset.avFechar); });
    });
    box.querySelectorAll('[data-av-desm]').forEach(function (b) {
      b.addEventListener('click', function () { desmembrar(this.dataset.avDesm); });
    });
    box.querySelectorAll('[data-av-loc]').forEach(function (b) {
      b.addEventListener('click', function () { locacao(this.dataset.avLoc); });
    });
  }

  function exportar() {
    const lista = S.ativos(f);
    if (!lista.length) return ERP.app.aviso('Nada para exportar com esse filtro.', 'erro');
    ERP.exportar.abrir({
      nome: 'inventario-de-ativos', titulo: 'Inventário de ativos',
      cabecalho: [['Inventário de equipamentos'], ['Emitido em ' + U.fData(U.hoje())]],
      rodape: veValor()
        ? [[], ['Valor imobilizado', Math.round(lista.reduce(function (a, x) {
            return a + (x.valor || 0); }, 0) * 100) / 100]]
        : [],
      colunas: [
        { titulo: 'Tag', largura: 12, valor: a => a.tag },
        { titulo: 'Categoria', largura: 24, valor: a => a.categoria || '' },
        { titulo: 'Equipamento', largura: 38, valor: a => a.descricao },
        { titulo: 'Marca', largura: 14, valor: a => a.marca || '' },
        { titulo: 'Modelo', largura: 14, valor: a => a.modelo || '' },
        { titulo: 'Série', largura: 16, valor: a => a.serie || '' },
        { titulo: 'Unidades', largura: 9, tipo: 'numero', valor: a => a.qtd || 1 },
        { titulo: 'Situação', largura: 18, valor: a => D.nomeStatusAtivo(a.status) },
        { titulo: 'Onde está', largura: 26, valor: a => a.local || '' },
        { titulo: 'Projeto', largura: 22, valor: a => a.projeto ? nomeProjeto(a.projeto) : '' },
        { titulo: 'Custodiante', largura: 20, valor: a => a.custodiante || '' },
        { titulo: 'Desde', largura: 12, tipo: 'data', valor: a => a.desde ? U.fData(a.desde) : '' },
        { titulo: 'NF', largura: 14, valor: a => a.nf || '' },
        /* A coluna de dinheiro sai do arquivo quando a tela já a
           esconde: exportar o que a tela protege é o mesmo vazamento,
           com o agravante de virar arquivo que circula. */
        { titulo: 'Valor', largura: 14, tipo: 'numero', pular: !veValor(),
          valor: a => veValor() ? (a.valor || 0) : '' }
      ],
      linhas: lista
    });
  }

  return { montar: montar, render: render, ficha: ficha };
})();
