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
    regras: { tabela: 'regras_conciliacao', colunas: ['id', 'padrao', 'conta', 'centro', 'credor', 'ativo'] }
  };

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
  let reserva = [];
  async function alinharSequencia() {
    const c = cliente();
    if (!c) return;
    /* Pede um bloco e guarda: o store consome da reserva sem
       esperar a rede. */
    for (let i = 0; i < 20; i++) {
      const { data } = await c.rpc('proximo_id', { prefixo: '' });
      if (data) reserva.push(parseInt(String(data).replace(/\D/g, ''), 10));
    }
    if (reserva.length) {
      ERP.store.st.seq = Math.max.apply(null, reserva) + 1;
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
           pendencias: () => diferencas().length, ligado: () => ligado };
})();
