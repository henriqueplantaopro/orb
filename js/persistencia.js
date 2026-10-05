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
  /* Tabelas com coluna fechada por permissão (paciente, valores)
     não podem ser lidas com `select *`: o banco recusa a requisição
     inteira, e com razão. A LEITURA vai pela visão, que mascara o
     que a pessoa não pode ver; a ESCRITA continua na tabela, que é
     onde o dado mora.

     A tentação aqui era dar `grant select` na tabela e seguir o
     hint do PostgREST. Isso calaria o erro e devolveria o nome do
     paciente a quem não pode vê-lo. */
  /* Tabelas com coluna fechada: a escrita não pode usar upsert.
     Ver o comentário em `sincronizar`. */
  const SEM_UPSERT = { procedimentos: true, estoque_movimentos: true };

  const LEITURA_POR_VISAO = {
    procedimentos: 'procedimentos_visivel',
    estoqueMov: 'estoque_movimentos_visivel',
  };

  function fonteDeLeitura(nome, tabela) {
    const f = LEITURA_POR_VISAO[nome];
    if (!f) return tabela;
    return typeof f === 'function' ? f() : f;
  }

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
    fechamentosProcedimentos: { tabela: 'fechamentos_procedimentos', colunas: ['id', 'competencia', 'centro', 'faturamento', 'repasse', 'procedimento_ids', 'titulo_ids', 'cancelado', 'motivo_cancelamento', 'cancelado_em', 'cancelado_por', 'refaz', 'criado_por', 'criado_em'] },
    compras: { tabela: 'compras', colunas: ['id', 'numero', 'armazem', 'centro', 'status', 'credor', 'itens', 'historico', 'compra_aprovada_por', 'criado_em'] },
    ativos: { tabela: 'ativos', colunas: ['id', 'tag', 'categoria', 'descricao', 'qtd', 'valor', 'aquisicao', 'status', 'condicao', 'local', 'projeto', 'projeto_nome', 'fornecedor_nome', 'nf', 'custodiante', 'contrato', 'valor_locacao', 'vida_util_meses', 'desmembrado', 'lote_origem', 'baixa', 'observacao'] },
    ativoMov: { tabela: 'ativo_movimentos', colunas: ['id', 'ativo', 'data', 'status', 'origem', 'destino', 'motivo', 'usuario_id', 'criado_em'] },
    ordensServico: { tabela: 'ordens_servico', colunas: ['id', 'ativo', 'tipo', 'descricao', 'abertura', 'fechamento', 'custo', 'custo_peca', 'custo_servico', 'fornecedor', 'laudo', 'status'] },
    lotesProdutividade: { tabela: 'lotes_produtividade', colunas: ['id', 'centro', 'competencia', 'arquivo', 'titulo_ids', 'medicos', 'valor', 'confirmado', 'confirmado_por', 'confirmado_em', 'cancelado', 'cancelado_parcial', 'criado_por', 'criado_em', 'motivo_cancelamento', 'cancelado_em', 'cancelado_por'] },
    lotesRPS: { tabela: 'lotes_rps', colunas: ['id', 'remessa', 'competencia', 'rps', 'status', 'protocolo', 'cancelado', 'criado_em'] },
    folhas: { tabela: 'folhas', colunas: ['id', 'competencia', 'complementar', 'holerites', 'total_proventos', 'total_descontos', 'total_liquido', 'guias', 'cancelada', 'fechada_por', 'fechada_em', 'motivo_cancelamento', 'cancelado_em', 'cancelado_por'] },
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
    }).filter(function (l) {
      if (!l.produto || !l.armazem) return false;
      /* Linha zerada é combinação que alguma tela encostou e nunca
         teve saldo: 159 linhas para 5 com estoque. Não vai. */
      return Object.keys(l).some(function (k) {
        return k !== 'produto' && k !== 'armazem' && Number(l[k]) !== 0;
      });
    });
    if (!linhas.length) return null;
    const { error } = await c.from(def.tabela)
      .upsert(linhas, { onConflict: 'produto,armazem', returning: 'minimal' });
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
      /* `produto` e `armazem` vão DENTRO do objeto também, não só
         na chave. O estoque lê `pos.produto` para achar a descrição
         e para filtrar por armazém; sem isso a tela de Posição
         quebrava no sort, e o filtro por armazém não pegava. */
      const o = { produto: l.produto, armazem: l.armazem };
      def.colunas.forEach(function (col) {
        if (col !== 'produto' && col !== 'armazem') o[col] = Number(l[col]) || 0;
      });
      obj[l.produto + '|' + l.armazem] = o;
    });
  }

  const LIMITE_TENTATIVAS = 5;
  let tentativas = 0;
  let degradadas = [];    // coleções que não carregaram
  /* Liga o usuário do sistema ao login de mesmo e-mail. Antes isto
     era um `update` colado no SQL Editor a cada pessoa cadastrada —
     o módulo de Administração gravava metade do cadastro e a outra
     metade ficava fora do sistema. */
  async function vincularLogin(email) {
    const c = cliente();
    if (!c) return { erro: 'Sem conexão com o banco.' };
    const { data, error } = await c.rpc('vincular_login', { p_email: email });
    if (error) {
      if (/function .*vincular_login|PGRST202/i.test(error.message || '')) {
        return { erro: 'O banco ainda não tem a função vincular_login — rode o ' +
          'ATUALIZAR-TUDO.sql.' };
      }
      return { erro: error.message };
    }
    return data || {};
  }

  /* Cria (ou redefine) a credencial de acesso de alguém. A chave de
     administração vive no servidor, nunca aqui — este código só
     pede, com a sessão de quem está pedindo. */
  const NAO_PUBLICADA = 'Não encontrei a função de criar acesso no Supabase. Duas causas ' +
    'possíveis: ela ainda não foi publicada, ou foi publicada com OUTRO endereço. No painel, ' +
    'em Edge Functions, veja a coluna URL: o trecho depois de /functions/v1/ precisa ser igual ' +
    'a "' + ((ERP.config && ERP.config.funcaoCriarLogin) || 'criar-login') + '". Se for ' +
    'diferente (o painel às vezes gera nomes como "dynamic-responder"), ajuste o campo ' +
    'funcaoCriarLogin no js/config.js. Enquanto isso, o caminho pelo painel continua valendo: ' +
    'Authentication › Users › Add user, com "Auto Confirm User" marcado.';

  async function criarLogin(email, senha) {
    const c = cliente();
    if (!c) return { erro: 'Sem conexão com o banco.' };
    const { data: { session } } = await c.auth.getSession();
    if (!session) return { erro: 'Sessão expirada. Entre de novo.' };

    const base = (ERP.config.url || '').replace(/\/$/, '');
    try {
      const nome = (ERP.config && ERP.config.funcaoCriarLogin) || 'criar-login';
      const resp = await fetch(base + '/functions/v1/' + nome, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + session.access_token,
          'apikey': ERP.config.anon,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: email, senha: senha })
      });
      if (resp.status === 404) {
        return { erro: NAO_PUBLICADA };
      }
      const r = await resp.json().catch(function () { return {}; });
      return resp.ok ? r : { erro: r.erro || ('falha ' + resp.status) };
    } catch (e) {
      /* "Failed to fetch" é o que o navegador diz quando a
         requisição nem chegou. Com função não publicada, o Supabase
         responde sem os cabeçalhos que o navegador exige e o erro
         vira este — então a mensagem crua não ajuda ninguém. */
      if (/failed to fetch|networkerror|load failed/i.test(e.message || '')) {
        return { erro: NAO_PUBLICADA };
      }
      return { erro: e.message };
    }
  }

  async function statusLogins() {
    const c = cliente();
    if (!c) return [];
    const { data, error } = await c.rpc('status_logins');
    return error ? [] : (data || []);
  }

  async function vincularPendentes() {
    const c = cliente();
    if (!c) return { erro: 'Sem conexão com o banco.' };
    const { data, error } = await c.rpc('vincular_logins_pendentes');
    return error ? { erro: error.message } : { ok: true, n: data || 0 };
  }

  /* FUNCIONÁRIOS: cadastro, com gravação à parte.

     Ao tirá-los do mapa de movimento (eles vivem em `D`, não em
     `st`), ficou só a leitura — e o cadastro pela tela do DP não
     chegava ao banco. A lista aparecia vazia para todo mundo, e o
     diagnóstico fácil era culpar a permissão.

     A comparação é feita contra a última cópia conhecida, igual ao
     resto: só sobe o que mudou. */
  const COLUNAS_FUNCIONARIO = ['id', 'matricula', 'nome', 'cpf', 'pis', 'nascimento',
    'admissao', 'desligamento', 'cargo', 'tipo_contrato', 'salario_base',
    'jornada_semanal_horas', 'centro', 'rateio', 'dependentes', 'dependentes_irrf',
    'insalubridade_pct', 'periculosidade', 'vale_transporte', 'vt_dia', 'vt_desconto_modo',
    'vt_desconto_valor', 'vale_refeicao', 'vr_dia', 'pensao_alimenticia', 'ferias',
    'dados_pagamento', 'dados_aprovados', 'ativo'];

  let sombraFuncionarios = {};

  function fotoFuncionarios() {
    sombraFuncionarios = {};
    (ERP.dados.funcionarios || []).forEach(function (f) {
      if (f && f.id) sombraFuncionarios[f.id] = JSON.stringify(f);
    });
  }

  async function gravarFuncionarios() {
    /* Sem `ver_dados_pessoais` a leitura veio da visão, que tem
       menos colunas: gravar a partir dela apagaria CPF, salário e
       conta de quem está no banco. Este perfil não grava, e isso
       não é falha. */
    if (!ERP.store.pode('ver_dados_pessoais')) return null;
    const c = cliente();
    if (!c) return null;

    const mudaram = (ERP.dados.funcionarios || []).filter(function (f) {
      if (!f || !f.id) return false;
      return sombraFuncionarios[f.id] !== JSON.stringify(f);
    });
    if (!mudaram.length) return null;

    const linhas = mudaram.map(function (f) { return paraBanco(f, COLUNAS_FUNCIONARIO); });
    const { error } = await c.from('funcionarios')
      .upsert(linhas, { onConflict: 'id', returning: 'minimal' });
    if (error) return 'funcionarios: ' + error.message;
    mudaram.forEach(function (f) { sombraFuncionarios[f.id] = JSON.stringify(f); });
    return null;
  }

  let sombra = {};        // coleção → { id: json }
  let agendado = null;
  let ligado = false;
  let salvando = false;
  let pendente = false;

  const cliente = () => ERP.auth && ERP.auth.cliente && ERP.auth.cliente();

  /* Campos de data e número que o Postgres não aceita vazios. O
     sistema guarda "" para "não preenchido" (é o que um input
     devolve), e o banco responde 22007 invalid input syntax for
     type date: "". Vazio quer dizer ausente, e ausente é nulo. */
  const DATA_OU_NUMERO = /^(data|emissao|venc|vencimento|validade|aquisicao|abertura|fechamento|desligamento|admissao|nascimento|pago_em|recebido_em|autorizado_em|liberado_em|de|ate|data_nf|baixa_em|cancelado_em|aprovado_em|confirmado_em|fechada_em|criado_em|lancado_em|atualizado_em|importado_em|reajuste_mes|vigencia_ini|vigencia_fim|saldo_inicial_em)$/;

  /* Colunas que o banco exige preenchidas e que algum caminho da
     aplicação deixa em branco. Em vez de recusar a gravação (e
     perder o lançamento), entra o valor que o próprio sistema usa
     como padrão naquele campo.

     Isto é rede, não desenho: se um `status` chega vazio, há um
     caminho no store que deveria preenchê-lo. O aviso no console
     serve para esse caminho ser achado depois. */
  const OBRIGATORIAS = {
    estoque_movimentos: { estornado: false },
    procedimentos: { cancelado: false },
    previsoes: { status: 'estimada' },
    receber: { origem: 'avulso', status: 'aberto' },
    parcelas: { status: 'aberto' },
    compras: { status: 'rascunho' },
    linhas_extrato: { situacao: 'pendente' },
    ordens_servico: { status: 'aberta' }
  };

  function completarObrigatorias(linha, tabela) {
    const regras = OBRIGATORIAS[tabela];
    if (!regras) return linha;
    Object.keys(regras).forEach(function (col) {
      if (linha[col] === null || linha[col] === undefined || linha[col] === '') {
        console.warn('Campo obrigatório vazio em ' + tabela + '.' + col +
          ' — gravando como "' + regras[col] + '". Vale achar o caminho que deixou em branco.');
        linha[col] = regras[col];
      }
    });
    return linha;
  }

  /* Separa o registro entre colunas conhecidas e `extra`. */
  function paraBanco(item, colunas) {
    const linha = {};
    const extra = {};
    Object.keys(item).forEach(function (k) {
      if (colunas.indexOf(k) >= 0) {
        let v = item[k];
        if (v === undefined) v = null;
        /* "" em coluna de data ou número é ausência, não valor. */
        if (v === '' && DATA_OU_NUMERO.test(k)) v = null;
        linha[k] = v;
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
  /* Com banco configurado, o movimento de EXEMPLO sai antes de a
     tela aparecer. Sem isto o sistema subia mostrando o inventário
     embutido no código, e só alguns segundos depois trocava pelo
     real — número de exemplo apresentado como número da empresa, o
     que é pior que tela vazia: a pessoa confere, aprova, e o número
     muda sozinho.

     Cadastro é diferente: `dados-remoto` carrega antes de montar, e
     ali a troca é síncrona. */
  function limparMovimentoLocal() {
    const st = ERP.store.st;
    Object.keys(MAPA).forEach(function (nome) {
      if (Array.isArray(st[nome])) st[nome].length = 0;
    });
    [POSICOES, MINIMOS].forEach(function (def) {
      const o = st[def.estado];
      if (o) Object.keys(o).forEach(function (k) { delete o[k]; });
    });
  }

  async function carregar() {
    const c = cliente();
    if (!c) return { erro: 'Sem conexão com o banco.' };
    const st = ERP.store.st;

    /* Uma coleção que falha NÃO derruba as outras. Antes, a primeira
       recusa abortava a carga inteira e a persistência desligava
       para o sistema todo — um privilégio esquecido numa tabela
       deixava 26 módulos em memória. Agora o módulo problemático
       fica indisponível e o resto funciona. */
    degradadas = [];
    /* As 25 leituras vão JUNTAS, não uma esperando a outra. Em fila
       o tempo era a soma de todas — uns segundos em internet boa, e
       bem mais em internet ruim. Em paralelo é o tempo da mais
       lenta. */
    const nomes = Object.keys(MAPA);
    const respostas = await Promise.all(nomes.map(function (nome) {
      const fonte = fonteDeLeitura(nome, MAPA[nome].tabela);
      return c.from(fonte).select('*').then(function (r) {
        return { nome: nome, fonte: fonte, data: r.data, error: r.error };
      }, function (e) {
        return { nome: nome, fonte: fonte, data: null, error: { message: e.message } };
      });
    }));
    respostas.forEach(function (r) {
      if (r.error) {
        degradadas.push({ nome: r.nome, tabela: r.fonte, erro: r.error.message });
        return;
      }
      const alvo = st[r.nome];
      if (!Array.isArray(alvo)) return;
      alvo.length = 0;
      (r.data || []).forEach(function (l) { alvo.push(doBanco(l)); });
    });

    /* O que já está na trilha não é reenviado. Lê só os ids, que é
       o suficiente e não traz a trilha inteira para a memória. */
    eventosEnviados = {};
    const { data: evs } = await c.from('eventos').select('app_id').not('app_id', 'is', null);
    (evs || []).forEach(function (e) { if (e.app_id) eventosEnviados[e.app_id] = true; });

    await lerIndexado(POSICOES);
    await lerIndexado(MINIMOS);

    /* A sequência de ids vive no banco: dois navegadores gerando
       `p12` ao mesmo tempo criariam dois registros com a mesma
       chave. A partir daqui, o id vem de lá. */
    await alinharSequencia();

    tirarFoto();
    ligado = true;
    /* Carregou o que deu. Quem não carregou vira aviso nomeado, não
       silêncio nem desligamento geral. */
    return degradadas.length
      ? { ok: true, degradadas: degradadas.map(function (d) { return d.nome; }),
          detalhe: degradadas[0].tabela + ': ' + degradadas[0].erro }
      : { ok: true };
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
    const n = Number(data);
    /* Só aceita NÚMERO. Uma resposta inesperada virava `NaN` aqui,
       e `NaN` contamina todos os ids seguintes: `evNaN`, `p NaN`…
       Como o id é a chave, isso faria o segundo registro colidir
       com o primeiro — um erro silencioso que só apareceria na
       gravação. Melhor manter a sequência local do que adotar
       lixo. */
    if (!error && isFinite(n) && n > 0) {
      ERP.store.st.seq = n;
      return;
    }
    if (!error && data !== null && data !== undefined && !isFinite(n)) {
      console.warn('reservar_ids devolveu algo que não é número:', data,
        '— seguindo com a sequência local.');
    }
    /* Banco ainda sem a função (07-ids.sql não rodado): cai no
       caminho antigo, pedindo um só. Melhor um id do que nenhum. */
    const r = await c.rpc('proximo_id', { prefixo: '' });
    if (r && r.data) {
      const m2 = parseInt(String(r.data).replace(/\D/g, ''), 10);
      if (isFinite(m2) && m2 > 0) ERP.store.st.seq = m2;
    }
  }

  /* ── o que mudou desde a última vez ─────────────────── */
  /* Registra que UMA coleção já está igual no banco. Antes a
     sombra só era atualizada quando o ciclo inteiro dava certo —
     então, se uma parte gravava e outra falhava, a que gravou era
     reenviada no ciclo seguinte e batia em "duplicate key". O
     lançamento ESTAVA no banco e o sistema dizia que não.

     Agora cada coleção registra o próprio sucesso. */
  function tirarFotoDe(nome) {
    const st = ERP.store.st;
    const m = {};
    (st[nome] || []).forEach(function (it) { if (it && it.id) m[it.id] = JSON.stringify(it); });
    sombra[nome] = m;
  }

  function tirarFoto() {
    const st = ERP.store.st;
    sombra = {};
    Object.keys(MAPA).forEach(function (nome) {
      const m = {};
      (st[nome] || []).forEach(function (it) { m[it.id] = JSON.stringify(it); });
      sombra[nome] = m;
    });
  }

  /* Funcionários entram na conta de pendências: sem isto, o aviso
     de "não salvo" ignoraria uma ficha recém-cadastrada. */
  function funcionariosPendentes() {
    if (!ERP.store.pode('ver_dados_pessoais')) return 0;
    return (ERP.dados.funcionarios || []).filter(function (f) {
      return f && f.id && sombraFuncionarios[f.id] !== JSON.stringify(f);
    }).length;
  }

  function diferencas() {
    const st = ERP.store.st;
    const mudou = [];
    const fora = degradadas.map(function (d) { return d.nome; });
    Object.keys(MAPA).forEach(function (nome) {
      /* Coleção que não carregou fica de fora da gravação também:
         sem a sombra, TUDO pareceria novo e a sincronização
         sobrescreveria o banco com o que está na memória. */
      if (fora.indexOf(nome) >= 0) return;
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
  /* Camadas + movimentos + saldo numa transação do banco. Se
     qualquer parte falhar, nada grava — nem camada órfã, nem saldo
     sem lastro. */
  async function gravarEstoqueJunto(mudou) {
    const c = cliente();
    const pega = function (nome) {
      const m = mudou.find(function (x) { return x.nome === nome; });
      if (!m) return [];
      /* Passa pela mesma completação das obrigatórias. A RPC monta
         o INSERT no SQL e tem o próprio `coalesce`, mas mandar o
         campo preenchido daqui é mais barato que depender só do
         outro lado. */
      return m.novos.map(function (it) {
        return completarObrigatorias(paraBanco(it, m.def.colunas), m.def.tabela);
      });
    };
    const posicoes = Object.keys(ERP.store.st.posicoes || {}).map(function (k) {
      const p = k.split('|');
      const v = ERP.store.st.posicoes[k] || {};
      return { produto: p[0], armazem: p[1], saldo: v.saldo || 0, valor: v.valor || 0 };
    }).filter(function (l) {
      return l.produto && l.armazem && (Number(l.saldo) !== 0 || Number(l.valor) !== 0);
    });

    const { error } = await c.rpc('gravar_estoque', {
      p_camadas: pega('estoque'),
      p_movimentos: pega('estoqueMov'),
      p_posicoes: posicoes
    });
    if (!error) return null;

    /* Banco sem a função (12-estoque-atomico não rodado): avisa o
       que falta, em vez de gravar pela metade. */
    if (/function .*gravar_estoque|does not exist|PGRST202/i.test(error.message || '')) {
      return 'estoque: o banco ainda não tem a função gravar_estoque — rode o ' +
        '12-estoque-atomico.sql. Nada do estoque foi gravado.';
    }
    return 'estoque: ' + error.message;
  }

  /* TRILHA DE AUDITORIA.
     Vai à parte do resto porque é só-inserção: evento não se
     altera nem se apaga, nem pelo administrador. Por isso não entra
     no mecanismo de comparação — basta lembrar o que já subiu.

     Sem isto, os 149 tipos de evento que o sistema registra ficavam
     só na memória e sumiam ao recarregar. Uma aprovação indevida
     não deixava rastro, e a segregação que a matriz garante perdia
     metade do valor: ela impede, mas não prova. */
  let eventosEnviados = {};

  async function gravarEventos() {
    const c = cliente();
    if (!c) return null;
    const novos = (ERP.store.st.eventos || []).filter(function (e) {
      return e && e.id && !eventosEnviados[e.id];
    });
    if (!novos.length) return null;

    const linhas = novos.map(function (e) {
      return {
        app_id: e.id,
        entidade: e.entidade || '',
        entidade_id: e.entidade_id || null,
        acao: e.acao || '',
        detalhe: e.detalhe || null,
        usuario_id: e.usuario_id || null,
        usuario: e.usuario || null,
        em: e.em || new Date().toISOString()
      };
    });
    const { error } = await c.from('eventos').insert(linhas);
    if (error) {
      /* Já estavam lá: o `app_id` é único justamente para o reenvio
         não duplicar a trilha. */
      if (/duplicate key|23505/i.test(error.message || '')) {
        novos.forEach(function (e) { eventosEnviados[e.id] = true; });
        return null;
      }
      return 'trilha de auditoria: ' + error.message;
    }
    novos.forEach(function (e) { eventosEnviados[e.id] = true; });
    return null;
  }

  async function sincronizar() {
    if (!ligado || salvando) { pendente = !!ligado; return; }
    const c = cliente();
    if (!c) return;
    const mudou = diferencas();
    if (!mudou.length) return;

    salvando = true;
    const falhas = [];

    /* ESTOQUE: camadas, movimentos e saldo vão juntos, numa chamada
       só, dentro de uma transação do banco.

       Três chamadas HTTP são três transações: a segunda pode falhar
       depois de a primeira ter gravado, e foi o que produziu
       camadas órfãs no banco. "Os três ou nenhum" não se resolve no
       cliente — resolve-se em `gravar_estoque`, que desfaz o bloco
       inteiro a qualquer erro. */
    const temEstoque = mudou.some(function (m) {
      return m.nome === 'estoque' || m.nome === 'estoqueMov';
    });
    if (temEstoque) {
      const erroEstoque = await gravarEstoqueJunto(mudou);
      if (erroEstoque) falhas.push(erroEstoque);
    }

    /* O que DEPENDE do estoque não vai se o estoque não foi.
       Procedimento consome material: gravá-lo com a baixa recusada
       produz uma cirurgia que diz ter usado 5 luvas que nunca
       saíram do armazém. É a mesma classe do saldo sem lastro, um
       nível acima — e o remédio é o mesmo: a parte que depende
       espera a parte de que depende.

       A transação do banco cobre as três tabelas de estoque; isto
       cobre o que vem depois delas. */
    const estoqueFalhou = falhas.some(function (f) { return String(f).indexOf('estoque') === 0; });
    const DEPENDE_DO_ESTOQUE = ['procedimentos', 'fechamentosProcedimentos', 'previsoes', 'compras'];

    for (const m of mudou) {
      /* Já foram no bloco acima. */
      if (m.nome === 'estoque' || m.nome === 'estoqueMov') continue;
      if (estoqueFalhou && DEPENDE_DO_ESTOQUE.indexOf(m.nome) >= 0) {
        falhas.push(m.def.tabela + ': não gravado de propósito — a baixa de estoque desta ' +
          'operação falhou, e o lançamento sem a baixa diz ter consumido material que não saiu');
        continue;
      }
      const falhasAntes = falhas.length;
      if (m.novos.length && SEM_UPSERT[m.def.tabela]) {
        /* Tabela com coluna fechada por permissão não aceita
           upsert. O `on conflict do update set paciente =
           excluded.paciente` LÊ a coluna, e ler exige SELECT além
           de UPDATE — nenhum grant de escrita resolve isso, e dar o
           SELECT seria reabrir o que a etapa 04 fechou.

           Então aqui o caminho é separado: linha nova vai por
           INSERT, linha alterada vai por UPDATE com `eq('id')`.
           Nenhum dos dois lê a coluna. O id nasce no cliente, então
           sabemos qual é qual pela sombra. */
        const conhecidos = sombra[m.nome] || {};
        const inserir = [], atualizar = [];
        m.novos.forEach(function (it) {
          (conhecidos[it.id] === undefined ? inserir : atualizar).push(it);
        });
        if (inserir.length) {
          const linhas = inserir.map(function (it) {
            return completarObrigatorias(paraBanco(it, m.def.colunas), m.def.tabela);
          });
          const { error } = await c.from(m.def.tabela).insert(linhas);
          if (error && /duplicate key|23505/i.test(error.message || '')) {
            /* Chave duplicada quer dizer QUE JÁ ESTÁ LÁ. Não é
               erro: é o sistema reenviando o que já gravou. Vira
               atualização, uma a uma, e segue sem alarmar ninguém. */
            for (const it of inserir) {
              const linha = completarObrigatorias(paraBanco(it, m.def.colunas), m.def.tabela);
              delete linha.id;
              const r2 = await c.from(m.def.tabela).update(linha).eq('id', it.id);
              if (r2.error) falhas.push(m.def.tabela + ' (' + it.id + '): ' + r2.error.message);
            }
          } else if (error) {
            falhas.push(m.def.tabela + ': ' + error.message);
          }
        }
        for (const it of atualizar) {
          const linha = completarObrigatorias(paraBanco(it, m.def.colunas), m.def.tabela);
          delete linha.id;
          const { error } = await c.from(m.def.tabela).update(linha).eq('id', it.id);
          if (error) falhas.push(m.def.tabela + ' (atualizar ' + it.id + '): ' + error.message);
        }
      } else if (m.novos.length) {
        const linhas = m.novos.map(function (it) {
          return completarObrigatorias(paraBanco(it, m.def.colunas), m.def.tabela);
        });
        /* `returning: 'minimal'` — sem isto, o supabase-js manda
           `Prefer: return=representation`, o Postgres faz RETURNING *,
           e o * inclui a coluna `paciente`, que está revogada: a
           gravação inteira volta 42501. Não precisamos da linha de
           volta — ela já está na memória, foi de lá que saiu. */
        const { error } = await c.from(m.def.tabela)
          .upsert(linhas, { onConflict: 'id', returning: 'minimal' });
        if (error && /duplicate key|23505/i.test(error.message || '')) {
          /* Idem: já está no banco. Com upsert isto é raro, mas
             acontece quando a tabela tem outra chave única. */
          tirarFotoDe(m.nome);
        } else if (error) {
          falhas.push(m.def.tabela + ': ' + error.message);
        }
      }
      /* Registro que saiu do estado. O sistema cancela e estorna em
         vez de apagar, então isto quase nunca dispara — mas, quando
         dispara, o banco tem de acompanhar. */
      for (const id of m.sumiram) {
        const { error } = await c.from(m.def.tabela).delete().eq('id', id);
        if (error) falhas.push(m.def.tabela + ' (remover ' + id + '): ' + error.message);
      }
      /* Esta coleção foi: guarda o estado dela. O que falhou em
         outra coleção não faz esta ser reenviada. */
      if (falhas.length === falhasAntes) tirarFotoDe(m.nome);
    }
    const ff = await gravarFuncionarios();
    if (ff) falhas.push(ff);

    /* A trilha vai SEMPRE, mesmo que outra coisa tenha falhado: o
       registro da tentativa é parte do que se quer guardar. */
    const fe = await gravarEventos();
    if (fe) falhas.push(fe);

    /* Mínimos é cadastro: vai sozinho, sem depender de nada. */
    const fm = await gravarIndexado(MINIMOS);
    if (fm) falhas.push(fm);

    salvando = false;

    if (falhas.length) {
      /* Não atualiza a sombra: o que falhou vai de novo. Mas com
         LIMITE — sem ele, um erro permanente (coluna faltando,
         permissão) vira retentativa a cada operação, para sempre.
         Depois do limite, para de tentar e deixa o aviso de pé. */
      tentativas++;
      console.error('Falhas ao gravar (tentativa ' + tentativas + '):', falhas);
      /* Faixa FIXA, além do aviso que some. Um toast de cinco
         segundos não serve para "o que você acabou de lançar não
         está salvo": quem estava digitando não olha para o canto da
         tela, e quem voltou do café não viu nada. A faixa fica até
         a gravação funcionar. */
      marcarPendencia(falhas);
      if (ERP.app && ERP.app.aviso) {
        /* Quando parte grava e parte não, o aviso no singular faz
           parecer que nada foi. */
        const quantas = falhas.length;
        ERP.app.aviso(
          (quantas > 1 ? quantas + ' partes não foram salvas no banco. Primeira: ' : 'Não foi possível salvar no banco: ') +
          falhas[0] +
          (tentativas >= LIMITE_TENTATIVAS
            ? ' — PAREI DE TENTAR. Anote o que lançou e avise quem cuida do sistema.'
            : '. O lançamento está na tela, mas ainda não foi gravado.'), 'erro');
      }
      /* O limite vale POR COLEÇÃO, não para o sistema. Desligar
         tudo fazia com que abrir o inventário uma vez parasse o
         financeiro de gravar até recarregar — e sem aviso nenhum.
         Agora a coleção com defeito sai de cena e o resto continua.

         Uma coleção que desiste entra em `degradadas`: é o mesmo
         estado de quem não carregou, e a tela já sabe mostrar isso
         no cartão do módulo. */
      if (tentativas >= LIMITE_TENTATIVAS) {
        falhas.forEach(function (f) {
          const prefixo = String(f).split(':')[0].trim();
          /* O prefixo pode ser o nome da TABELA (laço comum) ou o
             rótulo "estoque" (bloco transacional, que cobre duas
             coleções de uma vez). */
          const nomes = prefixo === 'estoque'
            ? ['estoque', 'estoqueMov']
            : Object.keys(MAPA).filter(function (k) { return MAPA[k].tabela === prefixo; });
          nomes.forEach(function (nome) {
            if (!degradadas.some(function (d) { return d.nome === nome; })) {
              degradadas.push({ nome: nome, tabela: MAPA[nome] ? MAPA[nome].tabela : prefixo,
                erro: 'desistiu após ' + LIMITE_TENTATIVAS + ' tentativas' });
            }
          });
        });
        /* Zera a contagem e tira da sombra o que desistiu, para as
           outras coleções voltarem a gravar normalmente. */
        tentativas = 0;
        tirarFoto();
        if (ERP.app && ERP.app.renderHome) ERP.app.renderHome();
      }
      return;
    }
    tentativas = 0;

    tirarFoto();
    limparPendencia();
    if (pendente) { pendente = false; agendar(); }
  }

  /* A faixa de "não está salvo". Fica no topo, vermelha, até a
     próxima gravação dar certo. */
  function marcarPendencia(falhas) {
    let el = document.getElementById('faixa-nao-salvo');
    if (!el) {
      el = document.createElement('div');
      el.id = 'faixa-nao-salvo';
      document.body.insertBefore(el, document.body.firstChild);
    }
    const quantas = falhas.length;
    el.innerHTML = '<b>Não foi gravado no banco.</b> ' +
      (quantas > 1 ? quantas + ' partes falharam. Primeira: ' : '') +
      ERP.util.esc(String(falhas[0])) +
      ' — o que está na tela ainda não está salvo. Não feche a aba.';
    el.style.display = 'block';
  }

  function limparPendencia() {
    const el = document.getElementById('faixa-nao-salvo');
    if (el) el.style.display = 'none';
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
      /* Só avisa quando ainda HÁ CHANCE de gravar. Se uma coleção
         desistiu, as diferenças dela nunca zeram — e o aviso virava
         uma aba impossível de recarregar, sem saída pelo caminho
         normal. Preso é pior que avisado. */
      if (!ligado) return;
      if (!diferencas().length) return;
      e.preventDefault();
      e.returnValue = 'Há lançamentos ainda não salvos.';
      return e.returnValue;
    });
    return r;
  }

  return { iniciar: iniciar, sincronizar: sincronizar, carregar: carregar,
           limparMovimentoLocal: limparMovimentoLocal,
           salvarUsuario: salvarUsuario, vincularLogin: vincularLogin,
           statusLogins: statusLogins, vincularPendentes: vincularPendentes,
           criarLogin: criarLogin,
           pendencias: () => diferencas().length + funcionariosPendentes(),
           fotoFuncionarios: fotoFuncionarios, ligado: () => ligado,
           degradadas: () => degradadas.slice() };
})();
