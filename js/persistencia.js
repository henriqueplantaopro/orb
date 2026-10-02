/* Persistência do movimento.

   Os cadastros já vêm do banco (ver `dados-remoto.js`). Aqui é o
   movimento: títulos, parcelas, pagamentos, recebíveis, previsões,
   retenções, conciliação. O que uma pessoa lança passa a existir
   para as outras.

   COMO FUNCIONA, e por que assim:

   O `store.js` tem quase trezentas funções de escrita, cada uma com
   sua regra. Chamar o banco dentro de cada uma significaria mexer em
   trezentos lugares e manter isso para sempre — e qualquer função
   nova nasceria sem gravar, em silêncio.

   Em vez disso, este módulo observa o ESTADO. Depois de cada
   operação, compara as coleções com uma cópia-sombra e envia ao
   banco só o que mudou: linha nova, linha alterada, linha que
   sumiu. A regra de negócio continua onde está, intocada, e
   qualquer função futura passa a gravar sem precisar saber que o
   banco existe.

   O preço é a comparação, que roda com um respiro de 400ms para
   não disparar a cada tecla. Em troca, não há caminho de escrita
   que escape.

   O QUE NÃO É SALVO: nada fica só na tela. Se a gravação falhar, o
   usuário vê o aviso — melhor saber na hora que o lançamento não
   subiu do que descobrir no fechamento. */
window.ERP = window.ERP || {};
ERP.persistencia = (function () {
  const ESPERA = 400;

  /* Coleção do estado → tabela do banco, com as colunas que a
     tabela tem de verdade. O que o sistema guarda e a tabela não
     prevê vai para `extra`, em JSON: assim nenhum campo se perde
     por falta de coluna, e o que se consulta continua em coluna
     de verdade. */
  const MAPA = {
    titulos: { tabela: 'titulos', colunas: ['id', 'descricao', 'credor', 'doc', 'tipo_titulo', 'emissao', 'origem', 'origem_ref', 'obs', 'valor_total', 'valor_bruto', 'qtd', 'empresa_tomadora', 'criado_por', 'criado_por_id', 'criado_em'] },
    parcelas: { tabela: 'parcelas', colunas: ['id', 'titulo_id', 'num', 'total', 'descricao', 'credor', 'conta', 'centro', 'rateio', 'tipo_titulo', 'emissao', 'comp', 'venc', 'valor', 'status', 'valor_pago', 'pago_em', 'aprovacao', 'aprovado_por', 'aprovado_em', 'motivo', 'origem', 'doc', 'obs', 'chave', 'retencoes', 'valor_retido', 'itens', 'criado_por', 'criado_por_id', 'criado_em'] },
    pagamentos: { tabela: 'pagamentos', colunas: ['id', 'parcela_id', 'data', 'valor', 'juros', 'multa', 'desconto', 'banco', 'empresa', 'cruzamento', 'doc', 'obs', 'forma', 'forma_codigo', 'situacao', 'estornado', 'usuario', 'usuario_id', 'criado_em'] },
    receber: { tabela: 'receber', colunas: ['id', 'numero', 'serie', 'nf_chave', 'codigo_verificacao', 'emissao', 'competencia', 'vencimento', 'centro', 'rateio_centros', 'grupo_faturamento', 'empresa', 'cliente', 'cliente_doc', 'cliente_nome', 'discriminacao', 'origem', 'status', 'valor_bruto', 'valor_retido', 'valor_liquido', 'glosa_prevista', 'glosa_real', 'valor_recebido', 'recebido_em', 'baixas', 'retencoes', 'substitui', 'abatimentos', 'conferir', 'observacao', 'criado_em'] },
    previsoes: { tabela: 'previsoes', colunas: ['id', 'centro', 'competencia', 'faturamento', 'produtividade', 'status', 'observacao', 'confirmado_por', 'confirmado_em', 'autorizado_em', 'autorizado_por', 'autorizado_por_id', 'autorizacao_protocolo', 'autorizacao_obs', 'autorizado_valor', 'autorizacoes_anteriores', 'liberado_em', 'liberado_por'] },
    contratos: { tabela: 'contratos', colunas: ['id', 'parte', 'numero', 'tipo', 'cliente', 'objeto', 'processo', 'vigencia_ini', 'vigencia_fim', 'renovacao', 'indice', 'reajuste_mes', 'itens', 'aditivos', 'valor_mensal', 'encerrado', 'atualizado_em'] },
    retencoesRegistradas: { tabela: 'retencoes_registradas', colunas: ['id', 'titulo_id', 'tributo', 'valor', 'competencia', 'conta', 'municipio', 'guia_id', 'cancelada'] },
    guiasRetencao: { tabela: 'guias_retencao', colunas: ['id', 'tributo', 'competencia', 'municipio', 'conta', 'por_conta', 'titulo_id', 'total', 'criado_em'] },
    transferenciasBanco: { tabela: 'transferencias_banco', colunas: ['id', 'origem', 'destino', 'data', 'valor', 'obs', 'mutuo', 'cancelada', 'motivo_cancelamento', 'criado_em'] },
    extratos: { tabela: 'extratos', colunas: ['id', 'banco', 'arquivo', 'de', 'ate', 'importado_em', 'usuario_id'] },
    linhas: { tabela: 'linhas_extrato', colunas: ['id', 'extrato_id', 'banco', 'data', 'valor', 'memo', 'fitid', 'saida', 'situacao', 'alvo_tipo', 'alvo_id', 'alvo_ids', 'observacao'] },
    saldosInformados: { tabela: 'saldos_informados', colunas: ['id', 'banco', 'data', 'valor', 'divergencia', 'usuario_id', 'criado_em'] },
    regras: { tabela: 'regras_conciliacao', colunas: ['id', 'padrao', 'conta', 'centro', 'credor', 'ativo'] },

    /* Estoque, procedimentos, compras, ativos e pessoal. Entraram
       depois do financeiro, na mesma mecânica: quem observa o
       estado não precisa saber de que módulo veio a mudança. */
    estoque: { tabela: 'estoque_camadas', colunas: ['id', 'produto', 'armazem', 'qtd', 'custo', 'data', 'data_nf', 'lote', 'validade', 'origem', 'documento', 'nota_chave', 'pedido_id', 'grupo', 'lancado_em'] },
    estoqueMov: { tabela: 'estoque_movimentos', colunas: ['id', 'tipo', 'produto', 'armazem', 'qtd', 'qtd_nota', 'unidades_por_embalagem', 'custo', 'custo_nota', 'valor', 'medio_depois', 'data', 'data_nf', 'motivo', 'documento', 'lote', 'validade', 'origem', 'grupo', 'pedido_id', 'paciente', 'estornado', 'usuario', 'usuario_id', 'lancado_em'] },
    procedimentos: { tabela: 'procedimentos', colunas: ['id', 'data', 'competencia', 'centro', 'especialidade', 'procedimento', 'procedimento_nome', 'medico', 'paciente', 'qtd', 'faturamento', 'repasse', 'custo_material', 'imposto', 'imposto_pct', 'resultado', 'armazem', 'materiais', 'transferencias', 'grupo', 'financeiro', 'cancelado', 'motivo_cancelamento', 'editado_por', 'usuario_id', 'criado_em'] },
    fechamentosProcedimentos: { tabela: 'fechamentos_procedimentos', colunas: ['id', 'competencia', 'centro', 'faturamento', 'repasse', 'procedimento_ids', 'titulo_ids', 'cancelado', 'criado_por', 'criado_em'] },
    compras: { tabela: 'compras', colunas: ['id', 'numero', 'armazem', 'centro', 'status', 'credor', 'itens', 'historico', 'compra_aprovada_por', 'criado_em'] },
    ativos: { tabela: 'ativos', colunas: ['id', 'tag', 'categoria', 'descricao', 'qtd', 'valor', 'aquisicao', 'status', 'condicao', 'local', 'projeto', 'projeto_nome', 'fornecedor_nome', 'nf', 'custodiante', 'contrato', 'valor_locacao', 'vida_util_meses', 'desmembrado', 'lote_origem', 'baixa', 'observacao'] },
    ativoMov: { tabela: 'ativo_movimentos', colunas: ['id', 'ativo', 'data', 'status', 'origem', 'destino', 'motivo', 'usuario_id', 'criado_em'] },
    ordensServico: { tabela: 'ordens_servico', colunas: ['id', 'ativo', 'tipo', 'descricao', 'abertura', 'fechamento', 'custo', 'custo_peca', 'custo_servico', 'fornecedor', 'laudo', 'status'] },
    lotesProdutividade: { tabela: 'lotes_produtividade', colunas: ['id', 'centro', 'competencia', 'arquivo', 'titulo_ids', 'medicos', 'valor', 'confirmado', 'confirmado_por', 'confirmado_em', 'cancelado', 'cancelado_parcial', 'criado_por', 'criado_em'] },
    lotesRPS: { tabela: 'lotes_rps', colunas: ['id', 'remessa', 'competencia', 'rps', 'status', 'protocolo', 'cancelado', 'criado_em'] },
    folhas: { tabela: 'folhas', colunas: ['id', 'competencia', 'complementar', 'holerites', 'total_proventos', 'total_descontos', 'total_liquido', 'guias', 'cancelada', 'fechada_por', 'fechada_em'] },
    decimos: { tabela: 'decimos', colunas: ['id', 'funcionario', 'ano', 'parcela', 'valor', 'pago_em', 'cancelado'] }
  };

  /* `usuarios` não entra no MAPA acima de propósito: ele é cadastro,
     carregado por `dados-remoto`, e a gravação passa por aqui à
     parte — só a Administração escreve, e a RLS confere. */
  async function salvarUsuario(u) {
    const c = cliente();
    if (!c) return { erro: 'Sem conexão com o banco.' };
    const linha = { id: u.id, nome: u.nome, perfil: u.perfil,
      email: u.email || null, ativo: u.ativo !== false,
      senha_provisoria: !!u.senha_provisoria };
    const { error } = await c.from('usuarios').upsert([linha], { onConflict: 'id' });
    return error ? { erro: error.message } : { ok: true };
  }

  /* O saldo de estoque não é uma lista com id: é um objeto indexado
     por "produto|armazém". Vai separado porque a chave é composta —
     e porque ele é a posição ATUAL, não um histórico: cada linha é
     substituída, nunca acumulada. */
  const POSICOES = { estado: 'posicoes', tabela: 'posicoes_estoque',
                     colunas: ['produto', 'armazem', 'saldo', 'valor'] };
  const MINIMOS = { estado: 'minimos', tabela: 'minimos_estoque',
                    colunas: ['produto', 'armazem', 'minimo', 'ideal'] };

  function chaveComposta(k) {
    const p = String(k).split('|');
    return { produto: p[0], armazem: p[1] };
  }

  async function gravarIndexado(def) {
    const c = cliente();
    const obj = ERP.store.st[def.estado] || {};
    const linhas = Object.keys(obj).map(function (k) {
      const base = chaveComposta(k);
      const v = obj[k] || {};
      const linha = { produto: base.produto, armazem: base.armazem };
      def.colunas.forEach(function (col) {
        if (col !== 'produto' && col !== 'armazem') linha[col] = v[col] === undefined ? 0 : v[col];
      });
      return linha;
    }).filter(function (l) { return l.produto && l.armazem; });
    if (!linhas.length) return null;
    const { error } = await c.from(def.tabela)
      .upsert(linhas, { onConflict: 'produto,armazem' });
    return error ? def.tabela + ': ' + error.message : null;
  }

  async function lerIndexado(def) {
    const c = cliente();
    const { data, error } = await c.from(def.tabela).select('*');
    if (error) return;
    const obj = ERP.store.st[def.estado];
    if (!obj) return;
    Object.keys(obj).forEach(function (k) { delete obj[k]; });
    (data || []).forEach(function (l) {
      const o = {};
      def.colunas.forEach(function (col) {
        if (col !== 'produto' && col !== 'armazem') o[col] = Number(l[col]) || 0;
      });
      obj[l.produto + '|' + l.armazem] = o;
    });
  }

  let sombra = {};        // coleção → { id: json }
  let agendado = null;
  let ligado = false;
  let salvando = false;
  let pendente = false;

  const cliente = () => ERP.auth && ERP.auth.cliente && ERP.auth.cliente();

  /* Separa o registro entre colunas conhecidas e `extra`. */
  function paraBanco(item, colunas) {
    const linha = {};
    const extra = {};
    Object.keys(item).forEach(function (k) {
      if (colunas.indexOf(k) >= 0) {
        linha[k] = item[k] === undefined ? null : item[k];
      } else if (item[k] !== undefined) {
        extra[k] = item[k];
      }
    });
    linha.extra = extra;
    return linha;
  }

  /* E a volta: o que estava em `extra` vira campo normal de novo,
     para o resto do sistema não saber que essa divisão existe. */
  function doBanco(linha) {
    const o = {};
    Object.keys(linha).forEach(function (k) {
      if (k === 'extra') return;
      if (linha[k] !== null) o[k] = linha[k];
    });
    if (linha.extra && typeof linha.extra === 'object') {
      Object.keys(linha.extra).forEach(function (k) { o[k] = linha.extra[k]; });
    }
    return o;
  }

  /* ── carga inicial ──────────────────────────────────── */
  async function carregar() {
    const c = cliente();
    if (!c) return { erro: 'Sem conexão com o banco.' };
    const st = ERP.store.st;

    for (const nome of Object.keys(MAPA)) {
      const def = MAPA[nome];
      const { data, error } = await c.from(def.tabela).select('*');
      if (error) return { erro: 'Falha ao ler ' + def.tabela + ': ' + error.message };
      const alvo = st[nome];
      if (!Array.isArray(alvo)) continue;
      alvo.length = 0;
      (data || []).forEach(function (l) { alvo.push(doBanco(l)); });
    }

    await lerIndexado(POSICOES);
    await lerIndexado(MINIMOS);

    /* A sequência de ids vive no banco: dois navegadores gerando
       `p12` ao mesmo tempo criariam dois registros com a mesma
       chave. A partir daqui, o id vem de lá. */
    await alinharSequencia();

    tirarFoto();
    ligado = true;
    return { ok: true };
  }

  /* O store gera id com um contador próprio. Com várias pessoas
     usando, o contador tem de ser único — então ele passa a pedir
     o próximo número ao banco. Como a chamada é assíncrona e o
     store é síncrono, o sistema mantém um pequeno lote de números
     reservados à frente. */
  const TAMANHO_BLOCO = 200;
  async function alinharSequencia() {
    const c = cliente();
    if (!c) return;
    /* UMA chamada reserva um bloco inteiro. A primeira versão pedia
       um id por vez, vinte vezes — vinte idas e voltas pela rede, e
       uns quinze segundos em que o sistema já estava na tela mas
       ainda não gravava. Quem testasse nesse intervalo via o
       sistema "não salvando" sem nada estar errado. */
    const { data, error } = await c.rpc('reservar_ids', { qtd: TAMANHO_BLOCO });
    if (!error && data) {
      ERP.store.st.seq = Number(data);
      return;
    }
    /* Banco ainda sem a função (07-ids.sql não rodado): cai no
       caminho antigo, pedindo um só. Melhor um id do que nenhum. */
    const r = await c.rpc('proximo_id', { prefixo: '' });
    if (r && r.data) {
      ERP.store.st.seq = parseInt(String(r.data).replace(/\D/g, ''), 10) || ERP.store.st.seq;
    }
  }

  /* ── o que mudou desde a última vez ─────────────────── */
  function tirarFoto() {
    const st = ERP.store.st;
    sombra = {};
    Object.keys(MAPA).forEach(function (nome) {
      const m = {};
      (st[nome] || []).forEach(function (it) { m[it.id] = JSON.stringify(it); });
      sombra[nome] = m;
    });
  }

  function diferencas() {
    const st = ERP.store.st;
    const mudou = [];
    Object.keys(MAPA).forEach(function (nome) {
      const antes = sombra[nome] || {};
      const agora = {};
      const novos = [];
      (st[nome] || []).forEach(function (it) {
        if (!it || !it.id) return;
        const s = JSON.stringify(it);
        agora[it.id] = s;
        if (antes[it.id] !== s) novos.push(it);
      });
      const sumiram = Object.keys(antes).filter(function (id) { return !(id in agora); });
      if (novos.length || sumiram.length) {
        mudou.push({ nome: nome, def: MAPA[nome], novos: novos, sumiram: sumiram });
      }
    });
    return mudou;
  }

  /* ── gravar ─────────────────────────────────────────── */
  async function sincronizar() {
    if (!ligado || salvando) { pendente = !!ligado; return; }
    const c = cliente();
    if (!c) return;
    const mudou = diferencas();
    if (!mudou.length) return;

    salvando = true;
    const falhas = [];
    for (const m of mudou) {
      if (m.novos.length) {
        const linhas = m.novos.map(function (it) { return paraBanco(it, m.def.colunas); });
        const { error } = await c.from(m.def.tabela).upsert(linhas, { onConflict: 'id' });
        if (error) falhas.push(m.def.tabela + ': ' + error.message);
      }
      /* Registro que saiu do estado. O sistema cancela e estorna em
         vez de apagar, então isto quase nunca dispara — mas, quando
         dispara, o banco tem de acompanhar. */
      for (const id of m.sumiram) {
        const { error } = await c.from(m.def.tabela).delete().eq('id', id);
        if (error) falhas.push(m.def.tabela + ' (remover ' + id + '): ' + error.message);
      }
    }
    /* Saldo e mínimos vão sempre: são poucos e sempre pequenos, e
       comparar objeto indexado custaria mais do que regravar. */
    const f1 = await gravarIndexado(POSICOES);
    if (f1) falhas.push(f1);
    const f2 = await gravarIndexado(MINIMOS);
    if (f2) falhas.push(f2);

    salvando = false;

    if (falhas.length) {
      /* Não atualiza a sombra: na próxima tentativa, o que falhou
         vai de novo. E o usuário precisa saber agora, não no
         fechamento. */
      if (ERP.app && ERP.app.aviso) {
        ERP.app.aviso('Não foi possível salvar no banco: ' + falhas[0] +
          '. O lançamento está na tela, mas ainda não foi gravado.', 'erro');
      }
      console.error('Falhas ao gravar:', falhas);
      return;
    }

    tirarFoto();
    if (pendente) { pendente = false; agendar(); }
  }

  function agendar() {
    if (!ligado) return;
    if (agendado) clearTimeout(agendado);
    agendado = setTimeout(function () { agendado = null; sincronizar(); }, ESPERA);
  }

  /* ── observar o store ───────────────────────────────── */
  /* Envolve cada função do store: depois que ela roda, agenda a
     comparação. Não interfere no que a função faz nem no que
     devolve. */
  function observar() {
    const S = ERP.store;
    Object.keys(S).forEach(function (nome) {
      if (typeof S[nome] !== 'function') return;
      const original = S[nome];
      S[nome] = function () {
        const r = original.apply(this, arguments);
        agendar();
        return r;
      };
    });
  }

  async function iniciar() {
    const r = await carregar();
    if (r.erro) return r;
    observar();
    /* Antes de fechar a aba, tenta mandar o que ainda não subiu. */
    window.addEventListener('beforeunload', function (e) {
      if (diferencas().length) {
        e.preventDefault();
        e.returnValue = 'Há lançamentos ainda não salvos.';
        return e.returnValue;
      }
    });
    return r;
  }

  return { iniciar: iniciar, sincronizar: sincronizar, carregar: carregar,
           salvarUsuario: salvarUsuario,
           pendencias: () => diferencas().length, ligado: () => ligado };
})();
