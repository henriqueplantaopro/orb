/* ERP · store.js — estado e REGRAS DE NEGÓCIO do contas a pagar.
   As mesmas regras estão no banco (triggers do erp_schema_v2.sql):
   a tela nunca é a única guardiã. Aqui elas existem para o protótipo
   se comportar igual antes de ligar na API. */
window.ERP = window.ERP || {};

ERP.store = (function () {
  const U = ERP.util, D = ERP.dados;

  const st = {
    usuarioId: 'u1',
    /* PRODUTOS aponta para a MESMA lista de `dados`, não para uma
       cópia. A persistência só enxerga o que está em `st`, e o
       cadastro de material mexe em `dados.produtos` — então o
       material novo ficava só na memória. A entrada de estoque
       seguinte gravava uma camada apontando para um produto que o
       banco não conhecia, e a gravação inteira caía com
       "estoque_camadas_produto_fkey".

       Uma referência só, não duas listas: duas listas é como os
       dois lados se desencontram de novo. */
    get produtos() { return D.produtos; },
    /* Os demais CADASTROS pelo mesmo caminho. Nenhum deles era
       gravado: criar um armazém, um fornecedor ou um cliente pela
       tela mudava só a memória, e sumia ao recarregar. Só aparecia
       quando alguém tentava usar o cadastro novo em outro módulo —
       como a camada de estoque apontando para um produto que o
       banco não conhecia. */
    get credores() { return D.credores; },
    get armazens() { return D.armazens; },
    get centros() { return D.centros; },
    get clientes() { return D.clientes; },
    get bancos() { return D.bancos; },
    titulos: [],
    parcelas: [],
    pagamentos: [],
    eventos: [],
    remessas: [],
    receber: [],
    previsoes: [],
    /* Procedimentos do mutirão do HGB: uma linha por cirurgia
       realizada, com o material consumido, o repasse do médico e o
       faturamento da tabela PATE. */
    procedimentos: [],
    /* Fechamento do mutirão por competência: faturamento confirmado,
       repasse gerado e autorização do órgão. (integrado do ramo
       paralelo de QA) */
    fechamentosProcedimentos: [],
    /* Dinheiro movido entre contas do próprio grupo. Entre contas da
       MESMA empresa é só remanejo de caixa; entre empresas diferentes
       é mútuo, e entra na conta corrente. */
    transferenciasBanco: [],
    contratos: [],
    /* Parâmetros de administração. Existem porque a auditoria apontou
       o que faltava: alçada por valor, ninguém aprovando o que pediu,
       nota anexada antes de pagar, competência fechada e o sequencial
       da remessa dividido com o Protheus. */
    parametros: {
      /* Comprador e assistente ficavam de fora deste objeto — e aqui
         "não configurado" e "zero" dão exatamente no mesmo `|| 0`, que
         quer dizer SEM LIMITE. Na prática, os dois perfis que mais
         lançam pedido e pagamento no dia a dia eram os únicos sem
         teto nenhum. Os valores abaixo são um ponto de partida —
         ajuste em Administração pro real da operação. */
      /* Alçadas revistas: quem LANÇA não aprova o próprio pagamento, e
         a assistência financeira deixou de aprovar (a alçada dela era
         de R$ 5 mil, e 500 títulos/mês passam quase todos por baixo
         disso). Compras caiu de 20 para 5 mil pelo mesmo motivo: era
         alta demais para quem também cota. */
      alcada: { diretoria: 50000, socio: 0, admin: 0, comprador: 5000, assistente: 0 },   // 0 = sem limite
      /* Perfis que NÃO aprovam pagamento, qualquer que seja o valor —
         a alçada 0 do código significa "sem limite", então a trava de
         quem não aprova é esta lista. */
      sem_aprovacao: ['assistente', 'produtividade_dir', 'produtividade_ger'],
      /* Imposto estimado sobre o faturamento dos procedimentos, aberto
         por tributo. ESTIMATIVA — a confirmar com a contabilidade.
         Cada alíquota é editável em Administração. */
      impostos_procedimentos: D.IMPOSTOS_PROCEDIMENTOS_PADRAO.map(function (i) {
        return { id: i.id, nome: i.nome, aliquota: i.aliquota, obs: i.obs, ativo: true };
      }),
      /* Plantão do mutirão: valor e duração. O custo real vem do
         PegaPlantão; isto é o que o sistema usa para estimar enquanto
         o fechamento não chega. */
      plantao_valor: 1000,
      plantao_horas: 6,
      /* Ajuste manual de plantões por médico e dia, quando o turno não
         foi de 6 horas: chave "AAAA-MM-DD|MÉDICO" → quantidade. */
      plantoes_ajustados: {},
      impedir_autoaprovacao: true,
      /* Segregação de funções em COMPRAS: quem requisitou/cotou não
         aprova. Fica desligado por padrão — em equipe pequena a mesma
         pessoa faz mais de uma etapa, e travar por princípio emperra o
         dia a dia. Ligue em Administração quando quiser exigir. */
      impedir_autoaprovacao_compras: false,
      /* Feriados municipais/estaduais que a tabela nacional não cobre
         (aniversário da cidade, Consciência Negra onde não é nacional…),
         como 'AAAA-MM-DD' (só naquele ano) ou 'MM-DD' (todo ano). */
      feriados_extras: [],
      exigir_anexo: false,
      travar_competencia_ate: '',
      nsa_ini: 5000, nsa_fim: 9999
    },
    regras: [],       // memória: contraparte do extrato → o que lançar
    extratos: [],     // arquivos de extrato importados
    saldosInformados: [], // saldo do banco digitado à mão (prova real)
    linhas: [],       // lançamentos do extrato, conciliados ou não
    estoque: [],      // entradas registradas (lote, validade, custo da compra)
    posicoes: {},     // saldo e valor por produto+armazém (custo médio móvel)
    estoqueMov: [],   // extrato de movimentos
    ativos: [],           // equipamentos (item único, sem saldo)
    ativoMov: [],         // eventos de movimentação do ativo
    ordensServico: [],    // OS corretiva e preventiva
    planosManutencao: [], // preventiva por ativo ou categoria
    atestados: [],    // atestados de capacidade técnica pedidos/recebidos
    lotesRPS: [],     // lotes de RPS gerados para o portal da prefeitura
    minimos: {},      // mínimo/ideal por material e ARMAZÉM (setor)
    compras: [],      // requisições e pedidos
    lotesProdutividade: [],   // cada importação de fechamento, com os títulos que ela gerou
    folhas: [],                // cada fechamento de folha (Pessoal), com os títulos que ele gerou
    decimos: [],               // cada fechamento de parcela de 13º, com os títulos que ele gerou
    retencoesRegistradas: [],  // cada retenção de imposto (ISS/IRRF/PIS/COFINS/CSLL/INSS) de uma NF, até virar guia
    guiasRetencao: [],         // cada fechamento de guia de retenção (por tributo+competência), com os títulos que gerou
    seq: 1
  };
  const novoId = p => p + (st.seq++);

  /* ── permissões ─────────────────────────────────────────
     assistente lança e dá baixa; diretoria e sócio aprovam,
     cancelam e estornam; consulta só olha. */
  /* As permissões saem do PERFIL cadastrado, não de uma lista fixa:
     dá para criar perfil novo com o recorte que quiser. */
  const usuario = () => D.usuario(st.usuarioId);
  const perfilAtual = () => D.perfil((usuario() || {}).perfil);
  /* ── ações × matriz de acesso ───────────────────────────
     Antes havia duas camadas que não conversavam: a matriz (V/M/$ por
     módulo) governava Procedimentos e Estoque, e todo o resto seguia
     a lista de ações do perfil. Quem editava a matriz em Administração
     achava ter tirado o acesso ao Financeiro e não tinha tirado nada —
     o botão sumia da tela e a função continuava aceitando.

     Agora as ações que a matriz sabe expressar são DERIVADAS dela, e a
     lista do perfil guarda só o que a matriz não expressa: aprovar,
     estornar, cancelar, ver dado pessoal, ver paciente. Com isso as
     ~200 chamadas de pode('lancar') espalhadas pelo store passam a
     respeitar a matriz sem precisar ser reescritas uma a uma. */
  const ACAO_NA_MATRIZ = {
    lancar:    ['financeiro', 'mover'],
    pagar:     ['financeiro', 'mover'],
    faturar:   ['faturamento', 'mover'],
    estoque:   ['estoque', 'mover'],
    requisitar:['estoque', 'mover'],
    receber:   ['estoque', 'mover'],
    comprar:   ['compras', 'mover'],
    dp:        ['dp', 'mover'],
    ver_custo: ['estoque', 'financeiro'],
    /* As ações de APROVAÇÃO passam a vir do nível A de cada módulo,
       em vez de serem lista fixa por perfil: é o que torna a matriz
       a fonte única. Quem edita a matriz edita a segregação. */
    aprovar:              ['financeiro', 'aprovar'],
    aprovar_compra:       ['compras', 'aprovar'],
    confirmar_produtividade: ['produtividade', 'aprovar'],
    liberar_faturamento:  ['faturamento', 'aprovar'],
    fechar_procedimentos: ['procedimentos', 'aprovar'],
    fechar_folha:         ['dp', 'aprovar'],
    aprovar_inventario:   ['estoque', 'aprovar'],
    baixar_ativo:         ['ativos', 'aprovar'],
    aprovar_aditivo:      ['contratos', 'aprovar'],
    aprovar_dados_bancarios: ['cadastros', 'aprovar']
    /* `admin` NÃO entra aqui: não é "mexer no módulo de
       Administração", é a autorização de última instância que quebra
       segregação (forçar cancelamento de fechamento já pago, por
       exemplo). Derivá-la da matriz daria esse poder ao sócio, que tem
       Administração em VM$ — e a trava existe justamente para que nem
       ele force sozinho. Continua na lista do perfil. */
  };

  function pode(acao) {
    const m = ACAO_NA_MATRIZ[acao];
    if (m) return acesso(m[0])[m[1]];
    return ((perfilAtual() || {}).acoes || []).indexOf(acao) > -1;
  }

  /* Ações finas que continuam na lista do perfil, porque não são por
     módulo: aprovar_compra, aprovar, cancelar, estornar,
     ver_dados_pessoais, ver_pacientes, baixar_ativo,
     autorizar_faturamento, liberar_faturamento. */

  /* ── matriz de acesso ───────────────────────────────────
     Cada cruzamento perfil × módulo guarda três níveis: ver, mover e
     financeiro. É mais fácil de ler e de manter do que uma lista de
     ações soltas, e responde a pergunta que o dono do sistema faz de
     verdade: "quem pode mexer em quê, e quem vê dinheiro". */
  function matriz() {
    if (!st.parametros.matriz_acesso) {
      st.parametros.matriz_acesso = JSON.parse(JSON.stringify(D.MATRIZ_PADRAO));
    }
    return st.parametros.matriz_acesso;
  }

  function acessoDoPerfil(perfilId, modulo) {
    const linha = matriz()[perfilId] || {};
    const c = String(linha[modulo] || '');
    return { ver: c.indexOf('V') >= 0, mover: c.indexOf('M') >= 0,
      financeiro: c.indexOf('F') >= 0 || c.indexOf('$') >= 0,
      /* Quarto nível: a SEGUNDA MÃO. Não é "movimentar mais" — é
         aprovar, confirmar ou liberar o que outro lançou. */
      aprovar: c.indexOf('A') >= 0 };
  }

  const acesso = modulo => acessoDoPerfil((usuario() || {}).perfil, modulo);
  const veModulo = id => acesso(id).ver;
  /* Movimentar num módulo: lançar, editar, dar baixa, pagar. */
  const podeMover = modulo => acesso(modulo).mover;
  /* Ver ou mexer em valor dentro do módulo. */
  const veFinanceiro = modulo => acesso(modulo).financeiro;
  /* Aprovar dentro do módulo: o ato que trava ou destrava dinheiro. */
  const podeAprovar = modulo => acesso(modulo).aprovar;

  /* ── projetor de saída ──────────────────────────────────
     As telas mascaram certo, mas quem garante a regra é a função: o
     store devolvia custo e valor a quem não tem `$`, e nome e CPF de
     funcionário a quem não tem acesso ao DP. Chamando pelo console ou
     por outra tela, o dado saía inteiro.

     `visivel` apaga os campos de dinheiro quando falta o nível
     financeiro do módulo, e os identificadores quando falta a
     permissão de dado pessoal. Aplicado na SAÍDA das listagens
     sensíveis, resolve num lugar só o que cada tela precisava
     lembrar. */
  const CAMPOS_DINHEIRO = ['valor', 'custo', 'medio', 'custo_medio', 'preco', 'faturamento',
    'repasse', 'imposto', 'resultado', 'margem', 'custo_material', 'custo_total', 'custo_plantao',
    'resultado_final', 'margem_final', 'valor_total', 'valor_bruto', 'valor_liquido',
    'salario_base', 'salario', 'total_proventos', 'liquido'];
  const CAMPOS_PESSOAIS = ['cpf', 'rg', 'pis', 'conta_bancaria', 'agencia', 'nascimento'];

  function visivel(modulo, obj, opcoes) {
    if (!obj || typeof obj !== 'object') return obj;
    opcoes = opcoes || {};
    const temDinheiro = opcoes.financeiro !== undefined ? opcoes.financeiro : veFinanceiro(modulo);
    const temPessoal = opcoes.pessoal !== undefined ? opcoes.pessoal : pode('ver_dados_pessoais');
    if (temDinheiro && temPessoal) return obj;
    const copia = Array.isArray(obj) ? obj.slice() : Object.assign({}, obj);
    if (Array.isArray(copia)) {
      return copia.map(function (x) { return visivel(modulo, x, opcoes); });
    }
    if (!temDinheiro) {
      CAMPOS_DINHEIRO.forEach(function (k) { if (k in copia) copia[k] = null; });
      if (copia.produto && typeof copia.produto === 'object' && 'custo' in copia.produto) {
        copia.produto = Object.assign({}, copia.produto, { custo: null });
      }
    }
    if (!temPessoal) {
      CAMPOS_PESSOAIS.forEach(function (k) { if (k in copia) copia[k] = null; });
    }
    return copia;
  }

  function salvarMatrizAcesso(nova) {
    /* Nível que o módulo não tem é descartado na gravação, não só
       escondido na tela: senão uma importação ou um estado antigo
       deixaria o $ gravado em Cadastros, invisível e sem efeito —
       o tipo de sujeira que confunde quem audita a matriz depois. */
    if (nova && typeof nova === 'object') {
      Object.keys(nova).forEach(function (perfil) {
        const linha = nova[perfil] || {};
        Object.keys(linha).forEach(function (mod) {
          const permitidos = D.niveisDoModulo(mod);
          let limpo = '';
          D.NIVEIS_ACESSO.forEach(function (n) {
            if (permitidos.indexOf(n.id) < 0) return;
            const l = n.curto === '$' ? 'F' : n.curto;
            if (String(linha[mod] || '').replace('$', 'F').indexOf(l) >= 0) limpo += l;
          });
          linha[mod] = limpo;
        });
      });
    }
    /* VER a tela de acessos não é poder mudá-la: com o `||` antigo,
       quem recebesse só o V de Administração se promovia a tudo. */
    if (!pode('admin') && !podeMover('administracao')) {
      return { erro: 'Alterar acessos exige movimentação em Administração.' };
    }
    if (!nova || typeof nova !== 'object') return { erro: 'Matriz inválida.' };

    /* Ninguém amplia o próprio acesso. Quem precisa de mais pede a
       outro administrador — é a segregação que impede o caminho
       "entro na tela de acessos e me dou o resto". */
    const meu = (usuario() || {}).perfil;
    if (meu && !pode('admin')) {
      const ganhos = [];
      Object.keys(nova[meu] || {}).forEach(function (mo) {
        const antes = acessoDoPerfil(meu, mo);
        const c = String(nova[meu][mo] || '');
        const dep = { ver: c.indexOf('V') >= 0, mover: c.indexOf('M') >= 0,
          financeiro: c.indexOf('F') >= 0 || c.indexOf('$') >= 0 };
        ['ver', 'mover', 'financeiro'].forEach(function (n) {
          if (dep[n] && !antes[n]) ganhos.push((D.MODULOS.find(function (x) {
            return x.id === mo; }) || {}).nome || mo);
        });
      });
      if (ganhos.length) {
        return { erro: 'Você não pode ampliar o acesso do seu próprio perfil (' +
          [...new Set(ganhos)].join(', ') + '). Peça a outro administrador.' };
      }
    }
    /* Ninguém pode se trancar para fora: administração sem ninguém
       com acesso deixaria o sistema sem manutenção. */
    /* Movimentar sem ver não serve de nada: o módulo nem abre. A
       trava exige os dois, senão a matriz salva num estado em que
       ninguém mais chega à tela de acessos. */
    const temAdmin = Object.keys(nova).some(function (p) {
      const c = String(nova[p].administracao || '');
      return c.indexOf('M') >= 0 && c.indexOf('V') >= 0;
    });
    if (!temAdmin) {
      return { erro: 'Ao menos um perfil precisa movimentar em Administração — senão ninguém ' +
        'consegue mais mexer nos acessos.' };
    }
    st.parametros.matriz_acesso = nova;
    /* VAI AO BANCO. A matriz era lida de lá e nunca gravada:
       marcar um nível mudava só a sessão de quem marcou, e a outra
       pessoa continuava sem ver nada — sem erro em lugar nenhum,
       que é o pior tipo de falha, porque parece que o sistema está
       certo e a culpa é de quem usa. */
    if (ERP.persistencia && ERP.persistencia.gravarMatriz) {
      ERP.persistencia.gravarMatriz().then(function (r) {
        if (r && r.erro && ERP.app && ERP.app.aviso) {
          ERP.app.aviso('Acessos alterados na tela, MAS não gravados no banco: ' + r.erro +
            ' — as outras pessoas continuam com o acesso antigo.', 'erro');
        }
      });
    }
    logar('perfis', 'matriz', 'alterou', 'matriz de acesso atualizada');
    return { ok: true };
  }

  /* Sigilo salarial em Contas a Pagar: título de folha, férias, 13º,
     rescisão, pensão ou crédito do trabalhador tem, na descrição, o
     nome do funcionário — e quem lança/paga contas (perfil
     "assistente", por exemplo) não necessariamente tem
     `ver_dados_pessoais`, mas PRECISA continuar vendo valor, data e
     documento pra fazer o trabalho dela (conciliar com o banco,
     aprovar pagamento). A escolha aqui foi mascarar só a IDENTIDADE
     (quem é a pessoa), não o valor nem o resto do título — é o "quem
     ganha quanto" que é sigiloso, não o fluxo de caixa em si.
     `TIPOS_TITULO_PESSOAL` e o rótulo genérico de cada um ficam aqui,
     um lugar só, pra toda tela que mostra descrição de título usar a
     mesma regra. */
  const TIPOS_TITULO_PESSOAL = {
    folha: 'Folha de pagamento', ferias: 'Férias', decimo: '13º salário',
    rescisao: 'Rescisão', pensao: 'Pensão alimentícia (desconto de folha)',
    credito_trabalhador: 'Crédito do trabalhador (desconto de folha)'
  };
  function rotuloSigilo(p) {
    if (!p) return null;
    if (TIPOS_TITULO_PESSOAL[p.tipo_titulo]) return TIPOS_TITULO_PESSOAL[p.tipo_titulo];
    // guias de UM funcionário (férias, rescisão) citam o nome e, pelo valor, revelam o salário
    if (p.tipo_titulo === 'guia' && (p.origem === 'ferias' || p.origem === 'rescisao')) {
      return 'Guia de encargos (' + (p.origem === 'ferias' ? 'férias' : 'rescisão') + ')';
    }
    return null;
  }
  // título cujo conteúdo é sigiloso PARA O USUÁRIO ATUAL
  function tituloSigiloso(p) { return !!rotuloSigilo(p) && !pode('ver_dados_pessoais'); }
  function obsVisivel(p) { return (rotuloSigilo(p) && !pode('ver_dados_pessoais')) ? '' : ((p && p.obs) || ''); }
  function descricaoVisivel(p) {
    const rotulo = rotuloSigilo(p);
    if (!rotulo || pode('ver_dados_pessoais')) return (p && p.descricao) || '';
    return rotulo + ' — [confidencial]';
  }
  /* Nos tipos abaixo o CREDOR do título é o próprio funcionário (o
     salário/férias/13º/rescisão é pago a ele) — mascarar só a
     descrição e deixar o nome do credor aparecer do lado teria sido
     inútil, a identidade vazava do mesmo jeito por essa coluna. Em
     pensão e crédito do trabalhador o credor já É um terceiro
     (beneficiário/instituição), então o nome dele pode aparecer —
     só a descrição (que cita o funcionário) precisa de máscara. */
  // pensão: o nome da beneficiária revela que o funcionário paga pensão
  const TIPOS_CREDOR_E_FUNCIONARIO = { folha: 1, ferias: 1, decimo: 1, rescisao: 1, pensao: 1 };
  function nomeCredorVisivel(p, nomeReal) {
    if (!TIPOS_CREDOR_E_FUNCIONARIO[p && p.tipo_titulo] || pode('ver_dados_pessoais')) return nomeReal;
    return '[confidencial]';
  }

  function salvarPerfil(d) {
    if (!pode('admin')) return { erro: 'Só o perfil de administração altera perfis.' };
    if (!d.nome) return { erro: 'Informe o nome do perfil.' };
    const acoes = (d.acoes || []).filter(function (a) {
      return D.ACOES.some(function (x) { return x.id === a; });
    });
    const modulos = (d.modulos || []).filter(function (m) {
      return D.MODULOS.some(function (x) { return x.id === m; });
    });
    if (!acoes.length) return { erro: 'O perfil precisa de ao menos uma permissão.' };
    if (!modulos.length) return { erro: 'O perfil precisa de ao menos um módulo visível.' };

    const alvo = d.id ? D.perfil(d.id) : null;
    if (d.id && !alvo) return { erro: 'Perfil não encontrado.' };
    if (alvo) {
      // não deixa a última administração sem acesso a nada
      if (alvo.id === 'admin' && acoes.indexOf('admin') < 0) {
        return { erro: 'O perfil de administração não pode perder a permissão de administrar.' };
      }
      alvo.nome = d.nome; alvo.acoes = acoes; alvo.modulos = modulos;
    } else {
      const id = String(d.nome).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || ('p' + Date.now().toString(36));
      if (D.perfil(id)) return { erro: 'Já existe um perfil com esse nome.' };
      D.perfis.push({ id: id, nome: d.nome, acoes: acoes, modulos: modulos });
    }
    logar('perfil', d.id || d.nome, d.id ? 'editou perfil' : 'criou perfil',
      d.nome + ' · ' + acoes.length + ' permissão(ões) · ' + modulos.length + ' módulo(s)');
    return { ok: true };
  }

  function excluirPerfil(id) {
    if (!pode('admin')) return { erro: 'Só o perfil de administração exclui perfis.' };
    const p = D.perfil(id);
    if (!p) return { erro: 'Perfil não encontrado.' };
    if (p.sistema) return { erro: 'Perfil de sistema não pode ser excluído — edite as permissões dele.' };
    const usando = D.usuarios.filter(function (u) { return u.perfil === id; });
    if (usando.length) {
      return { erro: usando.length + ' usuário(s) usam este perfil (' +
        usando.map(function (u) { return u.nome; }).join(', ') + '). Troque o perfil deles antes.' };
    }
    D.perfis.splice(D.perfis.indexOf(p), 1);
    logar('perfil', id, 'excluiu perfil', p.nome);
    return { ok: true };
  }
  const setUsuario = id => { st.usuarioId = id; };

  /* Trilha de auditoria.

     Guarda o ID do usuário além do nome. Gravar só "Ana (assistente
     financeiro)" quebra a rastreabilidade no dia em que alguém renomeia
     o cadastro ou muda de perfil: o histórico passa a apontar para uma
     pessoa que não existe mais com aquele nome. O nome fica junto
     porque é o que se lê na tela — mas quem responde pelo evento é o
     id. */
  function logar(entidade, id, acao, detalhe) {
    const u = usuario() || {};
    st.eventos.push({
      id: novoId('ev'), entidade, entidade_id: id, acao,
      usuario_id: u.id || null, usuario: u.nome || '—',
      detalhe: detalhe || '', em: new Date()
    });
  }

  /* ── derivados ──────────────────────────────────────────
     valor pago e status NUNCA são digitados: saem dos pagamentos. */
  /* Ciclo de vida de um pagamento:
       aguardando  -> Ana solicitou; ela ainda pode alterar ou cancelar
       autorizado  -> diretoria/sócio aprovou; entra na fila da remessa
       enviado     -> saiu no arquivo bancário, esperando o retorno
       liquidado   -> dinheiro saiu de fato (retorno do banco ou confirmação)
       recusado    -> diretoria recusou; a parcela volta ao estado anterior
       cancelado   -> Ana desfez a própria solicitação
     SÓ 'liquidado' abate saldo e entra no fluxo de caixa realizado e no DRE. */
  /* Índice de pagamentos por parcela.

     Sem ele, cada consulta de saldo varria a lista inteira de
     pagamentos, e a tela do contas a pagar chama saldo e caixa uma vez
     por linha: com 6.240 parcelas e otantos pagamentos, são dezenas de
     milhões de comparações por render — era daí que vinham os 905 ms.
     O índice é reconstruído só quando a lista de pagamentos muda, o
     que o contador `versaoPag` detecta. */
  let idxPag = null, idxPagVersao = -1, versaoPag = 0;
  const mudouPagamentos = () => { versaoPag++; };

  function indicePagamentos() {
    if (idxPag && idxPagVersao === versaoPag && idxPagTam === st.pagamentos.length) return idxPag;
    idxPag = {};
    st.pagamentos.forEach(function (p) {
      if (p.estornado) return;
      const k = p.parcela_id;
      (idxPag[k] = idxPag[k] || []).push(p);
    });
    idxPagVersao = versaoPag;
    idxPagTam = st.pagamentos.length;
    return idxPag;
  }
  let idxPagTam = -1;

  const daParcela = (pid, sit) => (indicePagamentos()[pid] || []).filter(function (p) {
    return p.situacao === sit;
  });
  const pagamentosDe = pid => daParcela(pid, 'liquidado');
  const aguardandoDe = pid => daParcela(pid, 'aguardando');
  const autorizadosDe = pid => daParcela(pid, 'autorizado');
  const enviadosDe = pid => daParcela(pid, 'enviado');
  // tudo que já está "reservado" e não pode ser pedido de novo
  const emCursoDe = pid => aguardandoDe(pid).concat(autorizadosDe(pid), enviadosDe(pid));
  const pagoDe = pid => pagamentosDe(pid).reduce((s, p) => s + p.valor + p.desconto, 0);
  const caixaDe = pid => pagamentosDe(pid).reduce((s, p) => s + p.valor + p.juros + p.multa, 0);
  const saldoDe = par => Math.round((par.valor - pagoDe(par.id)) * 100) / 100;

  /* Parcela de R$ 0,00 (resto de um parcelamento de centavos) ficava
     presa em aberto para sempre: `recalcular` e `registrarPagamento`
     exigem valor > 0, então ela nunca fechava e aparecia eternamente
     no contas a pagar. Nada a pagar é parcela paga. */
  function fecharSeZerada(p) {
    if (!p || p.status === 'cancelado') return false;
    /* `Math.abs(NaN) > 0.004` é false: sem esta linha, a parcela com
       valor inválido era lida como "nada a pagar" e nascia PAGA. */
    if (!isFinite(p.valor)) return false;
    if (Math.abs(p.valor || 0) > 0.004) return false;
    if (p.status === 'pago') return false;
    p.status = 'pago';
    p.quitada_em = p.quitada_em || U.hoje();
    p.obs = ((p.obs || '') + ' · parcela de valor zero, fechada automaticamente').trim();
    return true;
  }

  function recalcular(pid) {
    const par = st.parcelas.find(p => p.id === pid);
    if (!par) return;
    const pago = pagoDe(pid);
    const pgs = pagamentosDe(pid);
    par.valor_pago = pago;
    par.pago_em = pgs.length ? pgs.map(p => p.data).sort().slice(-1)[0] : null;
    par.valor_solicitado = emCursoDe(pid).reduce(function (s, p) { return s + p.valor; }, 0);
    if (par.status === 'cancelado') return;
    /* `previsto` e `substituido` são preservados como o cancelado já
       era: sem isto, editar a descrição de uma previsão a rebaixava
       para `aberto`, o título real deixava de encontrá-la para
       substituir, e os dois apareciam juntos no fluxo — R$ 60.000
       projetados para uma despesa de R$ 30.000. */
    /* Só preserva enquanto NADA aconteceu com ela: havendo pagamento
       ou solicitação em curso, a parcela entrou no fluxo e o status
       passa a segui-lo (aguardando, autorizado, pago). */
    if (['previsto', 'substituido'].indexOf(par.status) > -1 &&
        !pago && !emCursoDe(pid).length) return;
    if (fecharSeZerada(par)) return;
    if (pago >= par.valor - 0.004 && par.valor > 0) par.status = 'pago';
    else if (enviadosDe(pid).length) par.status = 'enviado';
    else if (autorizadosDe(pid).length) par.status = 'autorizado';
    else if (aguardandoDe(pid).length) par.status = 'aguardando';
    else if (pago > 0) par.status = 'parcial';
    else { par.status = 'aberto'; par.pago_em = null; }
  }

  /* ── forma de pagamento e impedimentos ──────────────────
     A forma vem do cadastro do credor. Sem forma configurada (ou sem o
     dado que a forma exige), a parcela fica travada: aparece no contas
     a pagar com o motivo, mas não pode ser enviada para pagamento. */
  function formaDoCredor(credorId) {
    const c = D.credor(credorId);
    if (!c || !c.forma_pagamento) return null;
    return Object.assign({ codigo: c.forma_pagamento }, D.formasPagamento[c.forma_pagamento] || {});
  }

  function impedimentos(par) {
    const c = D.credor(par.credor);
    const f = formaDoCredor(par.credor);
    const e = [];
    if (!c) e.push('credor não cadastrado');
    else if (!f) e.push('credor sem forma de pagamento no cadastro');
    else if (f.codigo === 'pix' && !c.pix) e.push('cadastro sem chave PIX');
    else if (['ted', 'doc', 'transferencia'].indexOf(f.codigo) > -1) {
      /* TED precisa de CPF/CNPJ E de banco, agência e conta: faltando
         qualquer um, a remessa volta do banco. Antes só o documento era
         cobrado, e o título seguia pra pagamento sem conta nenhuma. */
      if (!c.documento) e.push('cadastro sem CPF/CNPJ');
      if (!c.banco || !c.agencia || !c.conta_bancaria) e.push('cadastro sem banco, agência e conta');
    }
    else if ((f.codigo === 'boleto' || f.codigo === 'guia') && !par.codigo_barras) {
      e.push('boleto sem código de barras no lançamento');
    }
    return e;
  }

  /* ── criação de título com parcelas ─────────────────────
     Um lançamento, N parcelas, cada uma com vencimento e valor próprios.
     A competência pode ser fixa (serviço prestado num mês só) ou
     acompanhar o vencimento (aluguel, assinatura). */
  function gerarParcelas(cfg) {
    const n = Math.max(1, parseInt(cfg.qtd, 10) || 1);
    const total = Math.round((cfg.valorTotal || 0) * 100);
    const base = Math.floor(total / n);
    const linhas = [];
    for (let i = 0; i < n; i++) {
      const cent = i === n - 1 ? total - base * (n - 1) : base;
      /* "unica" e "livre" não avançam data: a primeira é a única, e nas
         datas livres quem digita é o usuário, na grade. */
      const venc =
        cfg.periodicidade === 'quinzenal' ? U.addDias(cfg.primeiroVenc, 15 * i) :
        cfg.periodicidade === 'semanal'   ? U.addDias(cfg.primeiroVenc, 7 * i) :
        (cfg.periodicidade === 'unica' || cfg.periodicidade === 'livre')
          ? cfg.primeiroVenc
          : U.addMeses(cfg.primeiroVenc, i);
      const comp = cfg.compSegueVenc ? U.compDe(venc) : cfg.competencia;
      linhas.push({ num: i + 1, venc, comp, valor: cent / 100 });
    }
    return linhas;
  }

  /* Rateio: normaliza e confere. Sem rateio informado, 100% num centro. */
  function normalizaRateio(rateio, centro) {
    let r = (rateio || []).filter(function (x) { return x.centro; })
      .map(function (x) { return { centro: x.centro, pct: Math.round((x.pct || 0) * 100) / 100 }; });
    if (!r.length && centro) r = [{ centro: centro, pct: 100 }];
    if (r.length === 1) r[0].pct = 100;
    return r;
  }

  /* Título "vivo" = tem ao menos uma parcela não cancelada. Vive no
     escopo do módulo porque a anti-duplicidade da importação também
     precisa dela (estava dentro de criarTitulo e quebrava o
     fechamento complementar). */
  const tituloNaoCancelado = t => st.parcelas.some(function (p) { return p.titulo_id === t.id && p.status !== 'cancelado'; });

  function criarTitulo(dados, linhas) {
    dados = dados || {};
    /* `_interno` é só para o próprio sistema criar um título como
       efeito colateral de uma ação que a pessoa já está autorizada a
       fazer — o comprador manda pedido (tem `comprar`) e isso gera uma
       previsão financeira, mas comprador não tem `lancar` de propósito
       (não deveria poder lançar título avulso na mão). Sem essa
       válvula, a previsão falhava calada: `criarTitulo` recusava, e
       quem chamou não conferia o retorno — nem título, nem erro. */
    if (!dados._interno && !pode('lancar')) return { erro: 'Seu perfil não lança contas a pagar.' };
    if (!dados.descricao) return { erro: 'Informe a descrição.' };
    /* Número é obrigatório, MENOS quando quem lança marcou "sem NF"
       (tarifa, imposto, débito automático): aí o título nasce sem
       número e fica no alerta até alguém informar a nota depois. */
    if (!dados.documento && !dados.sem_nf) return { erro: 'Informe o nº do título / NF (ou marque "Sem NF").' };
    if (!dados.tipo_titulo) return { erro: 'Informe o tipo do título.' };
    if (!dados.credor) return { erro: 'Informe o fornecedor / credor.' };
    // F3 — credor é chave estrangeira: nome solto não entra
    if (!D.credor(dados.credor)) return { erro: 'Credor não encontrado no cadastro.' };
    if (!dados.emissao) return { erro: 'Informe a data de emissão.' };
    if (!dados.conta) return { erro: 'Escolha a natureza (plano de contas).' };
    /* A tela usa lista, mas a importação (PegaPlantão, PlantãoPro, XML)
       entra por aqui direto: conta fora do plano viraria despesa sem
       lugar no DRE. */
    if (!D.plano.some(function (c) { return c.cod === dados.conta; })) {
      return { erro: 'A natureza ' + dados.conta + ' não existe no plano de contas.' };
    }
    const rat = normalizaRateio(dados.rateio, dados.centro);
    if (!rat.length) return { erro: 'Escolha o centro de custo.' };
    const nomes = rat.map(function (r) { return r.centro; });
    if (nomes.length !== new Set(nomes).size) return { erro: 'O mesmo centro de custo aparece duas vezes no rateio.' };
    /* Centro é chave estrangeira, como o credor e a conta já eram:
       um centro inexistente aceitava o lançamento e o valor não caía
       em centro nenhum dos relatórios. */
    const centroRuim = rat.find(function (r) { return !D.centro(r.centro); });
    if (centroRuim) {
      return { erro: 'Centro de custo não encontrado: ' + centroRuim.centro };
    }
    const somaPct = rat.reduce(function (a, r) { return a + r.pct; }, 0);
    if (Math.abs(somaPct - 100) > 0.01) return { erro: 'O rateio soma ' + U.num(somaPct) + '% — precisa fechar em 100%.' };
    if (!linhas.length) return { erro: 'Nenhuma parcela gerada.' };
    /* Título cancelado não conta como "já lançado" — sem isso, cancelar
       uma folha (ou 13º, férias, rescisão, guia de retenção) e tentar
       fechar de novo travava pra sempre com "já foi importado antes",
       porque o título cancelado continuava contando pra checagem de
       duplicidade. O "cancelar e refazer" é o jeito documentado de
       corrigir esses fechamentos — se ele trava, não tem como corrigir
       nada. */
    // uma chave de NF-e só entra uma vez: nota relançada é erro comum
    if (dados.chave && st.parcelas.some(function (p) { return p.chave === dados.chave && p.status !== 'cancelado'; })) {
      const ja = st.parcelas.find(function (p) { return p.chave === dados.chave && p.status !== 'cancelado'; });
      return { erro: 'Esta nota já foi lançada (título ' + (ja.doc || '') + ', ' + U.brl(ja.valor) + ').' };
    }
    /* Mesmo credor + mesmo número de documento = provável lançamento em
       dobro. A trava por chave de NF-e só pega nota importada por XML,
       e a maior parte dos ~500 títulos do mês é digitada à mão — com a
       mesma pessoa lançando e dando baixa, é o caminho mais curto para
       um pagamento duplicado. Não bloqueia de vez (há nota parcelada
       relançada, carnê com o mesmo número, recibo sequencial repetido
       por fornecedor pequeno): mostra o que já existe e pede
       confirmação explícita. */
    /* Só para lançamento MANUAL: quem vem de importação (produtividade,
       folha, compras) já tem a trava de origem_ref, e ali o mesmo
       "documento" se repete por desenho — um fechamento complementar do
       mesmo médico usa o mesmo número. */
    if (dados.documento && !dados.confirmar_duplicado && !dados.origem_ref && !dados._interno) {
      const iguais = st.titulos.filter(function (t) {
        return t.credor === dados.credor &&
          String(t.doc || t.documento || '').trim().toLowerCase() ===
            String(dados.documento).trim().toLowerCase() &&
          tituloNaoCancelado(t) && (!dados.id || t.id !== dados.id);
      });
      if (iguais.length) {
        const t0 = iguais[0];
        const valorT = t0.valor_total !== undefined ? t0.valor_total
          : st.parcelas.filter(function (p) { return p.titulo_id === t0.id; })
              .reduce(function (a, p) { return a + p.valor; }, 0);
        return {
          erro: 'Já existe título com o documento ' + dados.documento + ' para ' +
            ((D.credor(dados.credor) || {}).nome || '') + ': ' + U.brl(valorT) +
            ', emitido em ' + U.fData(t0.emissao) + '. Confira se não é o mesmo lançamento.',
          duplicado_documento: true,
          titulos: iguais.map(function (t) { return t.id; })
        };
      }
    }
    // anti-duplicidade de importação: a mesma linha de fechamento não entra 2x
    if (dados.origem_ref && st.titulos.some(function (t) {
          return t.origem === dados.origem && t.origem_ref === dados.origem_ref && tituloNaoCancelado(t); })) {
      return { erro: 'Este lançamento já foi importado antes.', duplicado: true };
    }
    if (linhas.some(l => !l.venc)) return { erro: 'Toda parcela precisa de vencimento.' };
    if (linhas.some(l => !l.comp)) return { erro: 'Toda parcela precisa de competência.' };
    const compRuim = linhas.find(function (l) {
      return !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(l.comp)); });
    if (compRuim) return { erro: 'Competência inválida: ' + compRuim.comp + ' (use AAAA-MM, mês de 01 a 12).' };
    // competência fechada: o mês já foi conciliado e não recebe lançamento
    const trava = st.parametros.travar_competencia_ate;
    if (trava) {
      const presas = linhas.filter(function (l) { return l.comp <= trava; });
      if (presas.length) {
        return { erro: presas.length + ' parcela(s) em competência fechada (até ' + U.fComp(trava) +
          '). Lance na competência aberta ou reabra o período na Administração.' };
      }
    }
    // F4 — incoerências de data avisam, mas não travam: nota atrasada existe
    const alertas = [];
    if (dados.emissao) {
      const antes = linhas.filter(function (l) { return l.venc < dados.emissao; }).length;
      if (antes) alertas.push(antes + ' parcela(s) vencem antes da emissão (' + U.fData(dados.emissao) + ').');
      const distante = linhas.filter(function (l) {
        return Math.abs(U.diasEntre(dados.emissao, l.comp + '-01')) > 400;
      }).length;
      if (distante) alertas.push(distante + ' parcela(s) com competência a mais de um ano da emissão.');
    }
    const soma = Math.round(linhas.reduce((s, l) => s + l.valor, 0) * 100) / 100;
    /* NaN e Infinity passavam: `NaN <= 0` e `Infinity <= 0` são os
       dois false, então a única trava de valor do lançamento não
       pegava nenhum. Um título com valor em texto ('1.234,56', como
       vem de importação) gravava parcela NaN, e daí o NaN se espalhava
       para a apuração por empresa e para o DRE. A blindagem da v13
       cobriu `registrarPagamento`, não a criação. */
    /* Data de vencimento tem de ser data: '31/11/2026' era aceito,
       `U.diasEntre` devolvia NaN e a parcela não aparecia em dia
       nenhum do fluxo. */
    const vencRuim = linhas.find(function (l) {
      return !l.venc || !dataExiste(String(l.venc)) ||
        isNaN(new Date(l.venc + 'T00:00:00Z').getTime());
    });
    if (vencRuim) {
      return { erro: 'Vencimento inválido na parcela ' + (vencRuim.num || '') + ' (' +
        vencRuim.venc + '). Use o formato AAAA-MM-DD.' };
    }
    const invalida = linhas.find(function (l) { return !isFinite(Number(l.valor)); });
    if (invalida) {
      return { erro: 'Parcela ' + (invalida.num || '') + ' com valor inválido (' +
        invalida.valor + '). Use número, com ponto decimal.' };
    }
    if (!isFinite(soma) || soma <= 0) return { erro: 'O valor precisa ser maior que zero.' };

    /* Conservação de valor: PARCELAS + RETENÇÕES = BRUTO DA NOTA.
       A regra existia só na tela de lançamento (em `regerar`, que roda
       no change do campo de retenção), então editar a grade de
       parcelas depois não reconferia nada: uma NF de R$ 10.000 com
       R$ 1.150 de retenção e parcela de R$ 10.000 era aceita, e a
       empresa desembolsava R$ 11.150 — 10.000 ao fornecedor e 1.150
       em guias.

       Só vale quando o bruto é informado: lançamento sem NF e títulos
       internos (folha, produtividade) não têm esse número. */
    const retencoes = (dados.retencoes || []).filter(function (r) { return (r.valor || 0) > 0; });
    const somaRet = Math.round(retencoes.reduce(function (a, r) {
      return a + (r.valor || 0); }, 0) * 100) / 100;
    const bruto = dados.valor_bruto !== undefined && dados.valor_bruto !== null && dados.valor_bruto !== ''
      ? Math.round(Number(dados.valor_bruto) * 100) / 100 : null;
    if (bruto !== null) {
      if (!isFinite(bruto) || bruto <= 0) return { erro: 'Valor bruto da nota inválido.' };
      const diferenca = Math.round((bruto - soma - somaRet) * 100) / 100;
      if (Math.abs(diferenca) > 0.02) {
        return { erro: 'As parcelas (' + U.brl(soma) + ') mais as retenções (' + U.brl(somaRet) +
          ') somam ' + U.brl(Math.round((soma + somaRet) * 100) / 100) + ', e a nota é de ' +
          U.brl(bruto) + ' — diferença de ' + U.brl(Math.abs(diferenca)) + '. ' +
          (diferenca > 0 ? 'Falta distribuir.' : 'Está sobrando.'),
          diferenca: diferenca };
      }
    } else if (somaRet > 0) {
      /* Sem bruto informado, a retenção não pode passar do que foi
         parcelado: reter mais do que a nota inteira não existe. */
      if (somaRet > soma + 0.02) {
        return { erro: 'As retenções (' + U.brl(somaRet) + ') passam do valor das parcelas (' +
          U.brl(soma) + ').' };
      }
    }

    const t = {
      id: novoId('t'), descricao: dados.descricao, credor: dados.credor,
      doc: dados.documento, tipo_titulo: dados.tipo_titulo, emissao: dados.emissao,
      origem_ref: dados.origem_ref || null,
      origem: dados.origem, obs: dados.obs, valor_total: soma, qtd: linhas.length,
      /* O bruto da NF fica GRAVADO: a trava "parcelas + retenções =
         bruto" era conferida na criação e nunca mais, porque não havia
         contra o que reconferir — editar a parcela para o valor cheio
         passava e o desembolso virava bruto + retenções. */
      valor_bruto: bruto !== null ? bruto : null,
      /* Em nome de qual empresa do grupo a nota foi emitida. É o que
         distingue classificação de custo (NF da matriz, projeto de
         outra empresa) de conta corrente entre empresas (NF de uma,
         paga por outra). Sem informação, assume a empresa do projeto. */
      empresa_tomadora: dados.empresa_tomadora ||
        empresaDoCentro(dados.centro || ((dados.rateio || [])[0] || {}).centro),
      criado_por: usuario().nome, criado_por_id: (usuario() || {}).id || null,
      criado_em: new Date()
    };
    st.titulos.push(t);

    const novas = [];
    linhas.forEach(l => {
      novas.push({
        id: novoId('p'), titulo_id: t.id, num: l.num, total: linhas.length,
        descricao: t.descricao, credor: dados.credor, conta: dados.conta,
        centro: rat[0].centro, rateio: rat.map(function (r) { return { centro: r.centro, pct: r.pct }; }),
        tipo_titulo: dados.tipo_titulo, emissao: dados.emissao,
        comp: l.comp, venc: l.venc, valor: Math.round(l.valor * 100) / 100,
        status: 'aberto', valor_pago: 0, pago_em: null,
        /* O lançamento NÃO passa por aprovação: a nota entra no contas a
           pagar e pronto. Quem aprova é o pagamento, mais tarde, quando o
           financeiro manda a parcela para a fila. O campo continua aqui
           porque a regra pode voltar por exceção (ex.: acima de X). */
        aprovacao: 'aprovado', aprovado_por: null, aprovado_em: null, motivo: '',
        origem: dados.origem, doc: dados.documento, obs: dados.obs,
        chave: dados.chave || null, arquivo: dados.arquivo || null,
        nf_dispensada: dados.nf_dispensada !== undefined ? !!dados.nf_dispensada : dados.conta === '3.01',
        sem_nf: !!dados.sem_nf,
        serie: dados.serie || null, nf_itens: dados.nf_itens || null,
        retencoes: dados.retencoes || null, valor_retido: dados.valor_retido || 0,
        codigo_barras: dados.codigo_barras || null, linha_digitavel: dados.linha_digitavel || null,
        itens: (dados.itens || []).slice(),
        criado_por: usuario().nome, criado_por_id: (usuario() || {}).id || null,
        criado_em: new Date()
      });
    });
    novas.forEach(function (p) {
      st.parcelas.push(p);
      /* Parcela de R$ 0,00 já nasce fechada: um parcelamento de
         centavos gera resto zerado, que ficaria para sempre no contas
         a pagar sem nada a pagar. */
      fecharSeZerada(p);
    });

    /* Cada tributo retido nesta NF vira um registro PRÓPRIO na reserva
       de retenções — é o que depois se agrupa numa guia mensal por
       tributo (ver fecharGuiaRetencao). Guarda a conta e o rateio por
       centro desta NF especificamente: o valor retido não é uma
       despesa NOVA, é a mesma despesa da NF, só que uma parte vai pro
       fornecedor e outra pro governo em nome dele — a guia tem que
       cair na MESMA conta da NF de origem pra reconstituir o bruto
       certo (mesma lógica já usada pro INSS retido de funcionário,
       que vai pra 4.01 e não pra uma conta de "imposto" à parte).
       Quando NFs de contas diferentes caem na mesma competência, a
       guia fecha uma por conta — continua sendo bem menos pagamentos
       que uma guia por NF, só não finge que são a mesma despesa
       quando não são. */
    (dados.retencoes || []).forEach(function (ret) {
      if (!(ret.valor > 0.004)) return;
      st.retencoesRegistradas.push({
        id: novoId('ret'), tributo: ret.tributo, valor: Math.round(ret.valor * 100) / 100,
        titulo_id: t.id, credor: dados.credor, nf_documento: dados.documento, conta: dados.conta,
        municipio: ret.tributo === 'ISS' ? (dados.municipio_iss || '') : '',
        /* Competência de TODAS as retenções (ISS e federais) = a da NF.
           As retenções da competência X formam a guia que vence em X+1.
           Critério definido pela contabilidade da empresa (não o mês do
           pagamento, que seria a leitura literal pros federais). */
        competencia: (linhas[0] || {}).comp || U.compDe(dados.emissao),
        rateio: rat.map(function (r) { return { centro: r.centro, pct: r.pct }; }),
        guia_id: null, criado_em: new Date()
      });
    });

    /* Lançou o título de verdade: o previsto daquela natureza, centro e
       competência sai de cena — ou encolhe, se a previsão estiver
       marcada como parcial. Só vale pra previsão de DESPESA de
       verdade (`previsao_id` aponta pra um registro em st.previsoes) —
       sem essa trava, qualquer título "previsto" com a mesma
       natureza+centro+competência apagava o anterior, inclusive um do
       outro (foi o caso da folha: cada funcionário no mesmo centro
       "substituía" o anterior, sobrando só o último). */
    if (dados.origem !== 'previsao') {
      novas.forEach(function (nova) {
        st.parcelas.filter(function (x) {
          return x.status === 'previsto' && x.previsao_id && x.conta === nova.conta && x.comp === nova.comp &&
            (x.rateio || []).some(function (r) {
              return (nova.rateio || []).some(function (rn) { return rn.centro === r.centro; });
            });
        }).forEach(function (prev) {
          const pv = st.previsoes.find(function (y) { return y.id === prev.previsao_id; });
          if (pv && pv.parcial) {
            prev.valor = Math.max(0, Math.round((prev.valor - nova.valor) * 100) / 100);
            prev.obs = 'Resíduo da previsão após o título ' + (nova.doc || '');
            if (prev.valor <= 0.004) prev.status = 'substituido';
          } else {
            prev.status = 'substituido';
            prev.obs = 'Substituído pelo título ' + (nova.doc || '');
          }
        });
      });
    }

    /* Previsão de PEDIDO DE COMPRA: a NF do fornecedor precisa baixá-la,
       senão o fluxo de caixa mostra a mesma compra duas vezes (a
       previsão do pedido e a nota real). Baixa quando o credor é o
       mesmo e o pedido ainda está aberto; com valor diferente, encolhe
       ou fecha e registra a diferença. */
    if (dados.pedido_id && dados.tipo_titulo !== 'previsao') {
      /* A baixa é do pedido VINCULADO, não de qualquer previsão do
         mesmo fornecedor: uma nota de serviço de R$ 500 chegou a
         abater a previsão de uma compra de material. O vínculo é
         escolhido no lançamento. */
      const pedido = st.compras.find(function (c) { return c.id === dados.pedido_id; });
      const previstosDoPedido = st.parcelas.filter(function (x) {
        if (x.status !== 'previsto') return false;
        const tp = st.titulos.find(function (y) { return y.id === x.titulo_id; });
        return tp && tp.origem === 'previsao_compra' && tp.origem_ref === dados.pedido_id;
      });
      if (pedido) t.pedido_id = pedido.id;
      let restante = soma;
      previstosDoPedido.forEach(function (prev) {
        if (restante <= 0.004) return;
        const abate = Math.min(prev.valor, restante);
        restante = Math.round((restante - abate) * 100) / 100;
        prev.valor = Math.round((prev.valor - abate) * 100) / 100;
        if (prev.valor <= 0.004) {
          prev.status = 'substituido';
          prev.obs = 'Substituída pela nota ' + (dados.documento || t.id) + ' do fornecedor';
        } else {
          prev.obs = 'Resíduo do pedido após a nota ' + (dados.documento || t.id);
        }
        alertas.push('Previsão do pedido ' + ((pedido || {}).numero || '') +
          ' baixada pela nota (' + U.brl(abate) + ').');
      });
    }
    logar('titulo', t.id, 'criou', linhas.length + ' parcela(s), ' + U.brl(soma));
    return { ok: true, titulo: t, alertas: alertas };
  }

  /* ── retenção de impostos em NF de fornecedor ──────────────
     ISS, IRRF, PIS, COFINS, CSLL e INSS retidos na fonte de uma NF de
     serviço não são pagos ao fornecedor — a empresa recolhe direto
     pro governo, geralmente numa guia única no mês seguinte, somando
     todas as NFs que tiveram aquele tributo retido. `criarTitulo` já
     guarda cada retenção em `st.retencoesRegistradas` (ver acima);
     as funções abaixo consultam essa reserva e fecham a guia. */

  const NOMES_TRIBUTO = { ISS: 'ISS', IRRF: 'IRRF', PIS: 'PIS', COFINS: 'COFINS', CSLL: 'CSLL', INSS: 'INSS',
    CSRF: 'PIS/COFINS/CSLL (DARF 5952)' };
  /* PIS, COFINS e CSLL retidos saem num DARF único (código 5952) — na
     fila e na guia eles andam juntos como "CSRF"; cada registro guarda o
     tributo original pra rastreabilidade. */
  const grupoTributo = t => (t === 'PIS' || t === 'COFINS' || t === 'CSLL') ? 'CSRF' : t;

  /* Quem recebe cada guia. Federais (INSS, IRRF, PIS, COFINS, CSLL,
     patronal) → Receita Federal; FGTS → Caixa; ISS → a prefeitura do
     município de incidência (cada município recolhe o seu). Sem
     município informado (lançamento manual), usa a prefeitura de ISS
     cadastrada — a da sede. Município sem prefeitura cadastrada ganha
     um credor novo, com forma de pagamento "guia". */
  function normMun(x) { return String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
  function credorGuiaDe(tipo, municipio) {
    const orgaos = D.credores.filter(function (c) { return c.tipo === 'orgao' && c.ativo !== false; });
    if (tipo === 'fgts') {
      const c = orgaos.find(function (x) { return /fgts/i.test(x.nome); });
      if (c) return c.id;
    }
    if (tipo === 'iss') {
      const prefs = orgaos.filter(function (x) { return /\biss\b/i.test(normMun(x.nome)); });
      const mun = normMun(municipio);
      if (!mun) return (prefs[0] || {}).id || null;
      const achou = prefs.find(function (x) { return normMun(x.nome).indexOf(mun) > -1; });
      if (achou) return achou.id;
      const novo = { id: novoId('cr'), ativo: true, nome: 'Prefeitura de ' + municipio + ' — ISS', tipo: 'orgao',
        conta_padrao: '2.01', forma_pagamento: 'guia', origem: 'retencao',
        /* Nasce PENDENTE: é o campo que o financeiro usa para
           liberar pagamento, e cadastro criado no automático não
           deve chegar liberado. */
        dados_aprovados: false };
      D.credores.push(novo);
      return novo.id;
    }
    const rf = orgaos.find(function (x) { return /receita federal/i.test(x.nome); });
    return (rf || orgaos[0] || {}).id || null;
  }

  /* Apoio ao fechamento COMPLEMENTAR de produtividade: diz se a chave
     de importação já foi usada e qual o próximo número de complemento,
     pra um segundo fechamento do mesmo médico/competência entrar em vez
     de ser descartado como duplicado. */
  const refJaUsada = ref => st.titulos.some(function (t) {
    return t.origem === 'produtividade' && t.origem_ref === ref && tituloNaoCancelado(t);
  });
  function proximoComplemento(refBase) {
    let n = 2;
    while (st.titulos.some(function (t) {
      return t.origem === 'produtividade' && t.origem_ref === refBase + '|c' + n && tituloNaoCancelado(t);
    })) n++;
    return n;
  }

  function retencoesPendentes(filtro) {
    filtro = filtro || {};
    return st.retencoesRegistradas.filter(function (r) {
      if (r.guia_id || r.cancelada) return false;
      if (filtro.tributo && grupoTributo(r.tributo) !== grupoTributo(filtro.tributo)) return false;
      if (filtro.competencia && r.competencia !== filtro.competencia) return false;
      if (filtro.municipio !== undefined && (r.municipio || '') !== filtro.municipio) return false;
      return true;
    });
  }

  /* Visão geral pra tela: quanto tem pendente de cada tributo, em cada
     competência — é o que decide quais guias já dá pra fechar. */
  function resumoRetencoesPendentes() {
    const grupos = {};
    st.retencoesRegistradas.filter(function (r) { return !r.guia_id && !r.cancelada; }).forEach(function (r) {
      const mun = r.tributo === 'ISS' ? (r.municipio || '') : '';
      const grp = grupoTributo(r.tributo);
      const chave = grp + '|' + r.competencia + '|' + mun;
      grupos[chave] = grupos[chave] || { tributo: grp, competencia: r.competencia, municipio: mun, total: 0, qtd: 0 };
      grupos[chave].total = Math.round((grupos[chave].total + r.valor) * 100) / 100;
      grupos[chave].qtd++;
    });
    return Object.keys(grupos).map(function (k) { return grupos[k]; })
      .sort(function (a, b) { return b.competencia.localeCompare(a.competencia) || a.tributo.localeCompare(b.tributo); });
  }

  function guiasRetencao(filtro) {
    filtro = filtro || {};
    return st.guiasRetencao.slice().filter(function (g) {
      return (!filtro.tributo || g.tributo === filtro.tributo) &&
        (!filtro.competencia || g.competencia === filtro.competencia);
    }).sort(function (a, b) { return (b.competencia + b.tributo).localeCompare(a.competencia + a.tributo); });
  }

  /* Fecha a guia de um tributo numa competência — soma tudo que ainda
     não entrou em guia nenhuma. Se as NFs de origem usam mais de uma
     conta (uma de "Honorários de consultoria", outra de "Aluguéis",
     por exemplo), fecha uma guia por conta: continua sendo bem menos
     pagamento que um por NF, só não finge que a mesma despesa é outra
     só pra caber num título só. Vencimento é editável — cada
     prefeitura/a Receita tem seu próprio prazo. */
  function fecharGuiaRetencao(tributo, competencia, vencimento, municipio) {
    municipio = tributo === 'ISS' ? (municipio || '') : undefined;
    if (!pode('lancar')) return { erro: 'Seu perfil não fecha guia de retenção.' };
    if (!NOMES_TRIBUTO[tributo]) return { erro: 'Tributo inválido.' };
    if (!competencia) return { erro: 'Informe a competência.' };
    if (!vencimento) return { erro: 'Informe o vencimento da guia.' };
    if (!dataExiste(String(vencimento))) {
      return { erro: 'Vencimento da guia inválido.' };
    }
    /* Guia não vence antes do mês que ela recolhe: com 01/01/2020 a
       guia nascia vencida há anos e entrava no fluxo como atraso. */
    if (vencimento < competencia + '-01') {
      return { erro: 'O vencimento (' + U.fData(vencimento) + ') é anterior à competência ' +
        U.fComp(competencia) + ' que a guia recolhe.' };
    }
    const pendentes = retencoesPendentes({ tributo: tributo, competencia: competencia, municipio: municipio });
    if (!pendentes.length) {
      return { erro: 'Nenhuma retenção de ' + NOMES_TRIBUTO[tributo] + ' pendente em ' + U.fComp(competencia) + '.' };
    }
    const credorGuia = credorGuiaDe(tributo === 'ISS' ? 'iss' : 'federal', municipio);
    /* Um título só, sempre — é assim que a guia de verdade funciona
       (a prefeitura ou a Receita emitem UM boleto por competência, não
       um por NF que gerou a retenção). Rateio por CENTRO usa todas as
       NFs juntas; a conta contábil usa a que mais pesa no total, e a
       composição por conta e por NF fica registrada na observação —
       ajustar manualmente na contabilidade se o rateio entre contas
       importar de verdade. Antes esta função fechava uma guia por
       conta contábil de origem, o que parecia mais "correto" pro lado
       da despesa, mas quebrava a conciliação: o banco manda UM
       pagamento pra bater com UM título, não pode ficar dividido em
       vários que juntos nem sempre fecham exatamente o valor do
       extrato. */
    const total = Math.round(pendentes.reduce(function (s, r) { return s + r.valor; }, 0) * 100) / 100;
    const porConta = {};
    pendentes.forEach(function (r) { porConta[r.conta] = Math.round(((porConta[r.conta] || 0) + r.valor) * 100) / 100; });
    const contaPrincipal = Object.keys(porConta).sort(function (a, b) { return porConta[b] - porConta[a]; })[0];
    const bucket = {};
    pendentes.forEach(function (r) { acumularPorCentro(bucket, { rateio: r.rateio, centro: r.rateio[0].centro }, r.valor); });
    const rat = rateioDeBucket(bucket);
    const composicao = Object.keys(porConta).length > 1
      ? ' Composição por conta: ' + Object.keys(porConta).map(function (c) { return c + ' ' + U.brl(porConta[c]); }).join(', ') + '.'
      : '';
    const nfs = pendentes.map(function (r) { return r.nf_documento; }).filter(Boolean);
    const porTributo = {};
    pendentes.forEach(function (r) { porTributo[r.tributo] = Math.round(((porTributo[r.tributo] || 0) + r.valor) * 100) / 100; });
    const composicaoTributo = Object.keys(porTributo).length > 1
      ? ' Por tributo: ' + Object.keys(porTributo).map(function (t) { return t + ' ' + U.brl(porTributo[t]); }).join(', ') + '.' : '';

    const rTitulo = criarTitulo({
      _interno: true,
      descricao: 'Guia de ' + NOMES_TRIBUTO[tributo] + ' retido — ' + U.fComp(competencia) + (municipio ? ' — ' + municipio : '') +
        ' (' + pendentes.length + ' NF(s))',
      documento: 'GUIA-' + tributo + '-' + competencia + (municipio ? '-' + normMun(municipio).replace(/\s+/g, '') : ''),
      tipo_titulo: 'guia', credor: credorGuia, conta: contaPrincipal,
      centro: rat ? rat[0].centro : 'cc100', rateio: rat,
      emissao: U.hoje(), origem: 'retencao',
      /* Sequencial de complemento, como a produtividade já faz: a
         referência fixa por tributo + competência fazia a trava de
         duplicidade recusar a SEGUNDA guia da mesma competência — e a
         retenção de uma nota atrasada ficava fora de qualquer guia,
         para sempre, porque não havia segundo caminho. */
      origem_ref: (function () {
        const base = 'guia-retencao-' + tributo + '-' + competencia +
          (municipio ? '-' + normMun(municipio) : '');
        let n = 1, ref = base;
        while (st.titulos.some(function (t) { return t.origem_ref === ref; })) {
          n++; ref = base + '-c' + n;
        }
        return ref;
      })(),
      obs: NOMES_TRIBUTO[tributo] + ' retido de: ' + nfs.join(', ') + '.' + composicao + composicaoTributo
    }, [{ num: 1, venc: vencimento, comp: competencia, valor: total }]);
    if (!rTitulo.ok) return rTitulo;
    st.parcelas.filter(function (pc) { return pc.titulo_id === rTitulo.titulo.id; })
      .forEach(function (pc) {
        pc.status = 'previsto';
        // cada natureza de origem volta pra sua linha da DRE (título continua único pra conciliar)
        if (Object.keys(porConta).length > 1) {
          pc.contas_rateio = Object.keys(porConta).map(function (c) { return { conta: c, valor: porConta[c] }; });
        }
      });
    const guia = {
      id: novoId('gr'), tributo: tributo, competencia: competencia, municipio: municipio || '', conta: contaPrincipal, por_conta: porConta,
      titulo_id: rTitulo.titulo.id, total: total, qtd_nfs: pendentes.length,
      retencao_ids: pendentes.map(function (r) { return r.id; }), cancelada: false,
      criado_por: usuario().nome, criado_por_id: (usuario() || {}).id || null, criado_em: new Date()
    };
    st.guiasRetencao.push(guia);
    pendentes.forEach(function (r) { r.guia_id = guia.id; });
    logar('retencao', tributo, 'fechou guia de ' + NOMES_TRIBUTO[tributo],
      U.fComp(competencia) + ' · ' + U.brl(total));
    return { ok: true, guias: [guia] };
  }

  /* Cancela uma guia — devolve as retenções que ela continha pra
     reserva de pendentes, pra entrarem numa próxima guia. Segue o
     mesmo padrão de cancelarFolha/cancelar13: recusa se já tiver
     pagamento de verdade, a menos que force. */
  function cancelarGuiaRetencao(id, motivo, forcar) {
    if (!pode('lancar')) return { erro: 'Seu perfil não cancela guia de retenção.' };
    const guia = st.guiasRetencao.find(function (g) { return g.id === id; });
    if (!guia) return { erro: 'Guia não encontrada.' };
    if (guia.cancelada) return { erro: 'Esta guia já foi cancelada.' };
    if (!motivo) return { erro: 'Informe o motivo do cancelamento.' };
    const parcelasGuia = st.parcelas.filter(function (p) { return p.titulo_id === guia.titulo_id; });
    const jaPagas = parcelasGuia.filter(function (p) { return pagamentosDe(p.id).length > 0; });
    if (jaPagas.length && !forcar) {
      return { erro: 'Essa guia já teve pagamento registrado. Estorne o pagamento antes de cancelar — ' +
        'uma guia paga de verdade não devolve a retenção pra fila sozinha, pra não recolher o mesmo ' +
        'imposto duas vezes.', jaPagas: jaPagas.length };
    }
    /* `cancelar()` recusa sozinho qualquer parcela que já teve
       pagamento — nem `forcar` nem `_interno` passam por cima disso
       (é a mesma trava de sempre, ver a função). Então "forçar" aqui
       não força cancelar o que já foi pago: só deixa a chamada
       prosseguir mesmo sabendo que ALGUMA parcela vai ficar de fora.
       Por isso as retenções só voltam pra fila de pendentes se a
       cancelada de verdade — se ficou "parcial" (a parcela paga
       continuou de pé), o imposto dela provavelmente já foi recolhido
       de verdade, e devolver a retenção deixaria entrar numa guia
       futura e pagar a mesma competência duas vezes. */
    let n = 0;
    parcelasGuia.forEach(function (p) {
      if (p.status === 'cancelado') { n++; return; }
      const r = cancelar(p.id, motivo, true);
      if (r.ok) n++;
    });
    guia.cancelada = n === parcelasGuia.length;
    guia.cancelada_parcial = !guia.cancelada;
    guia.motivo_cancelamento = motivo;
    guia.cancelado_por = usuario().nome;
    guia.cancelado_em = new Date();
    if (guia.cancelada) {
      st.retencoesRegistradas.filter(function (r) { return r.guia_id === guia.id; })
        .forEach(function (r) { r.guia_id = null; });
    }
    logar('retencao', guia.tributo, guia.cancelada ? 'cancelou guia de ' + NOMES_TRIBUTO[guia.tributo]
        : 'cancelou guia de ' + NOMES_TRIBUTO[guia.tributo] + ' parcialmente (havia pagamento já registrado)',
      U.fComp(guia.competencia) + ' · ' + motivo);
    return { ok: true, cancelada_parcial: guia.cancelada_parcial };
  }

  /* ── aprovação ──────────────────────────────────────────*/
  function aprovar(ids) {
    if (!pode('aprovar')) return { erro: 'Só diretoria ou sócio aprova lançamento.' };
    let n = 0;
    ids.forEach(id => {
      const p = st.parcelas.find(x => x.id === id);
      if (!p || p.status === 'cancelado' || p.aprovacao === 'aprovado') return;
      p.aprovacao = 'aprovado';
      p.aprovado_por = usuario().nome;
    p.aprovado_por_id = (usuario() || {}).id || null;
      p.aprovado_por_id = (usuario() || {}).id || null;
      p.aprovado_em = new Date();
      p.motivo = '';
      logar('conta_pagar', p.id, 'aprovou', '');
      n++;
    });
    return { ok: true, n };
  }

  function reprovar(id, motivo) {
    if (!pode('aprovar')) return { erro: 'Só diretoria ou sócio reprova lançamento.' };
    if (!motivo) return { erro: 'Informe o motivo da reprovação.' };
    const p = st.parcelas.find(x => x.id === id);
    if (!p) return { erro: 'Parcela não encontrada.' };
    if (pagamentosDe(id).length) return { erro: 'Parcela já paga não pode ser reprovada.' };
    p.aprovacao = 'reprovado';
    p.motivo = motivo;
    p.aprovado_por = usuario().nome;
    p.aprovado_em = new Date();
    logar('conta_pagar', id, 'reprovou', motivo);
    return { ok: true };
  }

  /* ── baixa ──────────────────────────────────────────────
     Aceita pagamento PARCIAL. Juros e multa somam ao caixa e vão
     para despesa financeira na competência do pagamento; desconto
     abate o principal sem sair do caixa. */
  /* ── empresas do grupo ──────────────────────────────────
     A empresa nunca é digitada: vem da CONTA (quem pagou ou recebeu) ou
     do CENTRO DE CUSTO (de quem é o projeto). O default é a matriz. */
  const EMPRESA_PADRAO = 'emp1';

  function empresaDaConta(bancoId) {
    const b = D.bancos.find(function (x) { return x.id === bancoId; });
    return (b && b.empresa) || EMPRESA_PADRAO;
  }

  function empresaDoCentro(centroId) {
    const c = D.centro(centroId);
    return (c && c.empresa) || EMPRESA_PADRAO;
  }

  /* A empresa de um título: quem recebe segue o projeto (a nota é
     emitida por aquele CNPJ); quem paga segue a conta que pagou, e na
     falta dela o projeto. */
  function empresaDoTitulo(t) {
    if (!t) return EMPRESA_PADRAO;
    if (t.empresa) return t.empresa;
    /* Quem emitiu a nota manda; na falta, o projeto — que no título
       mora no rateio da parcela, não num campo próprio. */
    if (t.empresa_tomadora) return t.empresa_tomadora;
    const p = st.parcelas.find(function (x) { return x.titulo_id === t.id; });
    const centro = p ? ((p.rateio || [])[0] || {}).centro : null;
    return empresaDoCentro(centro);
  }

  /* Por qual conta a parcela foi paga. A contabilidade pede o
     movimento separado por banco, e a busca do dia a dia é "achar o
     pagamento que saiu do Bradesco". */
  function bancoDaParcela(p) {
    if (!p) return null;
    const pg = pagamentosDe(p.id).filter(function (x) { return x.banco; })[0];
    return pg ? pg.banco : null;
  }

  function bancoDoRecebimento(r) {
    const b = ((r || {}).baixas || []).filter(function (x) { return x.banco; })[0];
    return b ? b.banco : null;
  }

  function empresaDaParcela(p) {
    if (!p) return EMPRESA_PADRAO;
    const pgs = pagamentosDe(p.id).filter(function (x) { return x.banco; });
    if (pgs.length) return empresaDaConta(pgs[0].banco);
    const t = st.titulos.find(function (x) { return x.id === p.titulo_id; });
    if (t && (t.empresa || t.empresa_tomadora)) return t.empresa || t.empresa_tomadora;
    const centro = ((p.rateio || [])[0] || {}).centro;
    return empresaDoCentro(centro);
  }

  /* Pagamento cruzado: quando a NF está em nome de uma empresa e quem
     paga é a conta de outra, uma quitou obrigação da outra — isso é
     conta corrente entre empresas, não classificação. Custo de projeto
     da Novaped pago pela matriz, com a NF em nome da matriz, NÃO entra
     aqui: ali a obrigação sempre foi da matriz. */
  function pagamentoCruzado(parcelaId, bancoId) {
    const p = parcela(parcelaId);
    if (!p) return null;
    const t = st.titulos.find(function (x) { return x.id === p.titulo_id; });
    if (!t) return null;
    /* Quem é o tomador da nota: informado no título; sem isso, a
       empresa do projeto só vale como palpite e não gera alerta. */
    const tomador = t.empresa_tomadora || null;
    if (!tomador) return null;
    const pagadora = empresaDaConta(bancoId);
    if (tomador === pagadora) return null;
    return {
      tomadora: tomador, pagadora: pagadora,
      tomadora_nome: (D.empresaPor(tomador) || {}).apelido || tomador,
      pagadora_nome: (D.empresaPor(pagadora) || {}).apelido || pagadora,
      valor: saldoDe(p)
    };
  }

  /* Conta corrente entre empresas: o que uma deve à outra por conta de
     pagamento cruzado. */
  /* ── transferência entre contas ─────────────────────────
     Dinheiro que sai de uma conta do grupo e entra em outra. Não é
     despesa nem receita: o caixa total não muda. Mas quando as contas
     são de empresas diferentes, uma empresa financiou a outra, e isso
     é conta corrente — o caso que o Henrique apontou como o mais
     frequente na prática. */
  function transferirEntreContas(d) {
    d = d || {};
    if (!pode('pagar')) return { erro: 'Seu perfil não movimenta contas bancárias.' };
    const origem = D.banco(d.origem), destino = D.banco(d.destino);
    if (!origem) return { erro: 'Informe a conta de origem.' };
    if (!destino) return { erro: 'Informe a conta de destino.' };
    if (origem.id === destino.id) return { erro: 'Origem e destino são a mesma conta.' };
    const valor = Math.round(Number(d.valor) * 100) / 100;
    if (!isFinite(valor) || valor <= 0) return { erro: 'Informe o valor da transferência.' };
    const data = d.data || U.hoje();
    if (!dataExiste(data)) return { erro: 'Data inválida.' };
    if (data > U.hoje()) return { erro: 'Transferência com data no futuro (' + U.fData(data) + ').' };

    /* Saldo que fica negativo é aviso, não bloqueio: limite usado
       existe, mas sair R$ 999 milhões de uma conta sem nenhuma
       observação não combina com o resto do sistema, que pergunta
       antes de agir. */
    const saldoOrigem = +saldoDoSistema(origem.id);
    const fica = Math.round((saldoOrigem - valor) * 100) / 100;
    if (fica < 0 && !d.confirmar_saldo_negativo) {
      return { erro: 'A conta ' + (origem.apelido || origem.nome) + ' tem ' +
        U.brl(saldoOrigem) + ' e ficaria em ' + U.brl(fica) + ' depois desta transferência. ' +
        'Confirme se é isso mesmo (limite usado) ou ajuste o valor.',
        confirmar_saldo_negativo: true, saldo_atual: saldoOrigem, saldo_depois: fica };
    }

    const empO = origem.empresa || null, empD = destino.empresa || null;
    const entreEmpresas = empO && empD && empO !== empD;
    const t = {
      id: novoId('tb'), data: data, valor: valor,
      origem: origem.id, destino: destino.id,
      origem_nome: origem.apelido || origem.nome, destino_nome: destino.apelido || destino.nome,
      empresa_origem: empO, empresa_destino: empD,
      /* Quem mandou o dinheiro vira CREDORA de quem recebeu. */
      mutuo: entreEmpresas ? { credora: empO, devedora: empD,
        credora_nome: (D.empresaPor(empO) || {}).apelido || empO,
        devedora_nome: (D.empresaPor(empD) || {}).apelido || empD } : null,
      documento: d.documento || '', obs: d.obs || '',
      origem_registro: d.origem_registro || 'manual',
      usuario: usuario().nome, lancado_em: new Date()
    };
    st.transferenciasBanco.push(t);
    logar('banco', t.id, 'transferência entre contas',
      U.brl(valor) + ' · ' + t.origem_nome + ' → ' + t.destino_nome +
      (entreEmpresas ? ' · mútuo ' + t.mutuo.devedora_nome + ' deve à ' + t.mutuo.credora_nome : ''));
    return { ok: true, transferencia: t, entre_empresas: entreEmpresas };
  }

  const transferenciasBanco = f => st.transferenciasBanco.slice().filter(function (t) {
    f = f || {};
    if (t.cancelada && !f.canceladas) return false;
    if (f.de && t.data < f.de) return false;
    if (f.ate && t.data > f.ate) return false;
    if (f.banco && t.origem !== f.banco && t.destino !== f.banco) return false;
    return true;
  }).sort(function (a, b) { return b.data.localeCompare(a.data); });

  function cancelarTransferenciaBanco(id, motivo) {
    if (!pode('estornar')) return { erro: 'Só diretoria ou sócio cancela transferência.' };
    if (!motivo) return { erro: 'Informe o motivo.' };
    const t = st.transferenciasBanco.find(function (x) { return x.id === id; });
    if (!t) return { erro: 'Transferência não encontrada.' };
    if (t.cancelada) return { erro: 'Esta transferência já foi cancelada.' };
    t.cancelada = { motivo: motivo, em: U.hoje(), usuario: usuario().nome };
    logar('banco', t.id, 'cancelou transferência', U.brl(t.valor) + ' — ' + motivo);
    return { ok: true };
  }

  /* Conta corrente entre as empresas do grupo. Duas origens:

     1. PAGAMENTO CRUZADO — uma empresa quitou obrigação da outra. Na
        baixa manual o sistema pergunta e só grava com confirmação; na
        conciliação não pergunta, porque o dinheiro já saiu e o banco
        não desfaz: registra e marca a origem como "extrato".
     2. TRANSFERÊNCIA DIRETA entre contas de empresas diferentes — é o
        caso mais comum na prática, e quem manda vira credora.

     O saldo é por PAR de empresas e já vem compensado: se a matriz
     pagou R$ 50.000 da Novaped e a Novaped pagou R$ 12.000 da matriz,
     o que a contabilidade lança é a diferença, não os dois valores. */
  function contaCorrenteEmpresas(f) {
    f = f || {};
    const linhas = [];
    st.pagamentos.filter(function (pg) {
      return pg.cruzamento && !pg.estornado && ['cancelado'].indexOf(pg.situacao) < 0 &&
        (!f.de || pg.data >= f.de) && (!f.ate || pg.data <= f.ate);
    }).forEach(function (pg) {
      linhas.push({
        tipo: 'pagamento', origem_registro: pg.cruzamento.origem || 'baixa',
        data: pg.data, valor: pg.valor,
        devedora: pg.cruzamento.tomadora, credora: pg.cruzamento.pagadora,
        devedora_nome: pg.cruzamento.tomadora_nome, credora_nome: pg.cruzamento.pagadora_nome,
        parcela_id: pg.parcela_id, documento: pg.doc || '',
        descricao: 'Pagamento de nota da ' + pg.cruzamento.tomadora_nome +
          ' pela conta da ' + pg.cruzamento.pagadora_nome
      });
    });
    /* Transferência direta de dinheiro entre contas de empresas
       diferentes: quem mandou é credora. */
    transferenciasBanco({ de: f.de, ate: f.ate }).forEach(function (t) {
      if (!t.mutuo) return;
      linhas.push({
        tipo: 'transferencia', origem_registro: t.origem_registro || 'manual',
        data: t.data, valor: t.valor,
        devedora: t.mutuo.devedora, credora: t.mutuo.credora,
        devedora_nome: t.mutuo.devedora_nome, credora_nome: t.mutuo.credora_nome,
        transferencia_id: t.id, documento: t.documento || '',
        descricao: 'Transferência ' + t.origem_nome + ' → ' + t.destino_nome +
          (t.obs ? ' · ' + t.obs : '')
      });
    });
    linhas.sort(function (a3, b3) { return b3.data.localeCompare(a3.data); });

    /* Saldo por PAR, compensado: o par (A,B) é um só, e o sinal diz
       quem deve. Mostrar "A deve 50 mil a B" e "B deve 12 mil a A" ao
       mesmo tempo não é o que a contabilidade lança. */
    const pares = {};
    linhas.forEach(function (l) {
      const ids = [l.devedora, l.credora].sort();
      const k = ids.join('|');
      pares[k] = pares[k] || { a: ids[0], b: ids[1],
        a_nome: l.devedora === ids[0] ? l.devedora_nome : l.credora_nome,
        b_nome: l.devedora === ids[1] ? l.devedora_nome : l.credora_nome,
        bruto_a_deve: 0, bruto_b_deve: 0, itens: 0 };
      if (l.devedora === ids[0]) pares[k].bruto_a_deve += l.valor;
      else pares[k].bruto_b_deve += l.valor;
      pares[k].itens++;
    });
    const saldos = Object.keys(pares).map(function (k) {
      const p = pares[k];
      const liquido = Math.round((p.bruto_a_deve - p.bruto_b_deve) * 100) / 100;
      return {
        devedora: liquido >= 0 ? p.a : p.b, credora: liquido >= 0 ? p.b : p.a,
        devedora_nome: liquido >= 0 ? p.a_nome : p.b_nome,
        credora_nome: liquido >= 0 ? p.b_nome : p.a_nome,
        valor: Math.abs(liquido), itens: p.itens,
        bruto_ida: Math.round(p.bruto_a_deve * 100) / 100,
        bruto_volta: Math.round(p.bruto_b_deve * 100) / 100,
        compensado: p.bruto_a_deve > 0.004 && p.bruto_b_deve > 0.004
      };
    }).filter(function (x) { return x.valor > 0.004 || x.compensado; });

    return { linhas: linhas, saldos: saldos,
      total: Math.round(saldos.reduce(function (s2, x) { return s2 + x.valor; }, 0) * 100) / 100 };
  }

  /* ── apuração por empresa ───────────────────────────────
     Cada CNPJ tem o seu resultado, e o consolidado do grupo NÃO é a
     soma simples: operação entre as próprias empresas (uma presta para
     a outra, uma paga obrigação da outra) infla receita e despesa no
     mesmo valor. No consolidado ela é eliminada. */
  const soDigitos = v => String(v || '').replace(/\D/g, '');

  /* Credor ou cliente que É uma das empresas do grupo: é aqui que a
     operação intragrupo se identifica, pelo CNPJ. */
  function empresaDoCNPJ(doc) {
    const d = soDigitos(doc);
    if (!d) return null;
    const e = D.empresas.find(function (x) { return soDigitos(x.cnpj) === d; });
    return e ? e.id : null;
  }

  function ehIntragrupo(t) {
    if (!t) return null;
    const c = D.credor(t.credor);
    return c ? empresaDoCNPJ(c.documento || c.cnpj) : null;
  }

  /* A despesa é alocada pelo RATEIO: um título dividido entre centros
     de empresas diferentes (aluguel, contabilidade) se reparte entre os
     CNPJs sem precisar de campo novo. */
  function despesaPorEmpresa(p) {
    const out = {};
    /* Mesma divisão de `valorNoCentro` (ver `partesDoRateio`): o
       rateio guarda percentual, e a sobra de centavos vai na última
       parte para a soma fechar com a parcela. */
    partesDoRateio(p).forEach(function (parte) {
      const emp = empresaDoCentro(parte.centro);
      out[emp] = Math.round(((out[emp] || 0) + parte.valor) * 100) / 100;
    });
    return out;
  }

  function apuracaoPorEmpresa(f) {
    f = f || {};
    const emps = {};
    const nova = id => {
      emps[id] = emps[id] || {
        empresa: id, apelido: (D.empresaPor(id) || {}).apelido || id,
        cnpj: (D.empresaPor(id) || {}).cnpj || '',
        receita: 0, despesa: 0, intragrupo_receita: 0, intragrupo_despesa: 0
      };
      return emps[id];
    };
    D.empresas.filter(function (e) { return e.ativo; }).forEach(function (e) { nova(e.id); });

    /* Receita: nota emitida, pela empresa do projeto.

       Dois acertos aqui. Primeiro, só NOTA entra: antes a previsão e a
       nota que a substitui eram somadas, e a mesma receita aparecia
       duas vezes (R$ 30.000 de previsão + R$ 30.000 de NF = R$ 60.000).
       Segundo, o recorte por data usa a COMPETÊNCIA dos dois lados —
       a receita vinha filtrada por emissão e a despesa por vencimento,
       então uma NF de 10/09 com parcela vencendo em 10/10 eliminava a
       receita intragrupo sem eliminar a despesa, e o consolidado
       deixava de fechar com a soma das empresas. */
    const noPeriodo = comp => (!f.competencia || comp === f.competencia) &&
      (!f.de || comp >= U.compDe(f.de)) && (!f.ate || comp <= U.compDe(f.ate));

    st.receber.filter(function (r) {
      /* `fatura` (contrato de locação) e `avulso` são faturamento
         real: ficavam fora da apuração por empresa enquanto apareciam
         no contas a receber. A regra que a v14 criou era sobre não
         somar a PREVISÃO junto com a nota — e essa continua, pelo
         `conferir` e pela exclusão de `previsao`. */
      return ['cancelado', 'substituido'].indexOf(r.status) < 0 &&
        ['nota', 'fatura', 'avulso'].indexOf(r.origem) > -1 && !r.conferir &&
        noPeriodo(r.competencia);
    }).forEach(function (r) {
      const e = nova(empresaDoCentro(r.centro));
      const v = r.valor_bruto || 0;
      e.receita = Math.round((e.receita + v) * 100) / 100;
      /* Cliente que é empresa do grupo: receita intragrupo. */
      const cli = D.clientes.find(function (c) { return c.id === r.cliente; });
      const doGrupo = empresaDoCNPJ(r.cliente_documento || (cli || {}).documento);
      if (doGrupo) e.intragrupo_receita = Math.round((e.intragrupo_receita + v) * 100) / 100;
    });

    /* Despesa: parcela não cancelada, repartida pelo rateio — pela
       mesma competência usada na receita. */
    st.parcelas.filter(function (p) {
      return ['cancelado', 'substituido'].indexOf(p.status) < 0 && noPeriodo(p.comp);
    }).forEach(function (p) {
      const t = st.titulos.find(function (x) { return x.id === p.titulo_id; });
      const intra = ehIntragrupo(t);
      const porEmp = despesaPorEmpresa(p);
      Object.keys(porEmp).forEach(function (id) {
        const e = nova(id);
        e.despesa = Math.round((e.despesa + porEmp[id]) * 100) / 100;
        if (intra) e.intragrupo_despesa = Math.round((e.intragrupo_despesa + porEmp[id]) * 100) / 100;
      });
    });

    const lista = Object.keys(emps).map(function (k) {
      const e = emps[k];
      e.resultado = Math.round((e.receita - e.despesa) * 100) / 100;
      e.margem = e.receita > 0 ? Math.round(e.resultado / e.receita * 1000) / 10 : null;
      return e;
    });

    /* Consolidado: soma tudo e tira o que é operação entre as próprias
       empresas — o lucro não muda, mas receita e despesa param de
       aparecer infladas (e é esse número que vai para atestado). */
    const somar = campo => Math.round(lista.reduce(function (t, e) { return t + e[campo]; }, 0) * 100) / 100;
    const elimReceita = somar('intragrupo_receita');
    const elimDespesa = somar('intragrupo_despesa');
    const consolidado = {
      receita_bruta: somar('receita'), despesa_bruta: somar('despesa'),
      eliminacao_receita: elimReceita, eliminacao_despesa: elimDespesa,
      receita: Math.round((somar('receita') - elimReceita) * 100) / 100,
      despesa: Math.round((somar('despesa') - elimDespesa) * 100) / 100
    };
    /* Prova real: eliminar receita sem eliminar a despesa do outro
       lado (ou o contrário) significa que falta lançar a contrapartida
       — o consolidado deixa de fechar com a soma das empresas. */
    consolidado.eliminacao_fecha = Math.abs(elimReceita - elimDespesa) < 0.02;
    consolidado.eliminacao_diferenca = Math.round((elimReceita - elimDespesa) * 100) / 100;
    consolidado.resultado = Math.round((consolidado.receita - consolidado.despesa) * 100) / 100;
    consolidado.margem = consolidado.receita > 0
      ? Math.round(consolidado.resultado / consolidado.receita * 1000) / 10 : null;

    return { empresas: lista, consolidado: consolidado,
      conta_corrente: contaCorrenteEmpresas({ de: f.de, ate: f.ate }).saldos };
  }


  /* ══ Procedimentos do mutirão (HGB) ═════════════════════
     O operador lança a cirurgia: especialidade, médico (digitado, não
     é cadastro — são profissionais rotativos do mutirão), paciente,
     procedimento da tabela PATE e os materiais consumidos no setor.

     O resultado de cada cirurgia:
       custo       = repasse ao médico (tabela) + material (custo médio
                     do estoque, no momento da baixa)
       faturamento = coluna de 95% do total da tabela
       imposto     = estimativa sobre o faturamento (parâmetro)
       resultado   = faturamento − imposto − custo

     O material sai do estoque de verdade, pelo armazém do setor: é a
     mesma baixa do módulo de estoque, com origem 'procedimento'. Se a
     baixa falha por saldo, o procedimento NÃO é gravado — senão o
     custo entraria sem o material ter saído. */

  /* FONTE ÚNICA da alíquota: o cadastro do PROJETO (Cadastros ›
     projeto › impostos). Havia duas verdades para o mesmo faturamento
     — o projeto do mutirão com 9,04% (usado no resultado do
     faturamento e na montagem do RPS) e um parâmetro separado em
     Administração com 16,33% (usado só em Procedimentos) —, e o mesmo
     dinheiro aparecia com dois lucros diferentes conforme a tela.

     Agora Procedimentos lê o cadastro, como o resto do sistema. Quem
     precisa ajustar o imposto muda no projeto, num lugar só. */
  const NOME_IMPOSTO_PROJETO = { iss: 'ISS', pis_cofins: 'PIS/COFINS', irpj: 'IRPJ',
    csll: 'CSLL', inss: 'INSS', outros: 'Outros' };

  function tributosProcedimentos(centro) {
    const c = D.centro(centro || D.PATE_CENTRO) || {};
    const imp = c.impostos || {};
    const lista = Object.keys(imp)
      .filter(function (k) { return Number(imp[k]) > 0; })
      .map(function (k) {
        return { id: k, nome: NOME_IMPOSTO_PROJETO[k] || k, aliquota: Number(imp[k]), ativo: true };
      });
    /* Projeto sem alíquota cadastrada: cai no padrão, para o cálculo
       não sair zerado sem ninguém perceber. */
    if (!lista.length) {
      return (D.IMPOSTOS_PROCEDIMENTOS_PADRAO || [])
        .map(function (i) { return Object.assign({}, i, { padrao: true }); });
    }
    return lista;
  }

  const impostoProcedimentos = centro =>
    Math.round(tributosProcedimentos(centro)
      .reduce(function (s2, i) { return s2 + (Number(i.aliquota) || 0); }, 0) * 10000) / 10000;

  /* Quanto cada tributo representa num faturamento. A soma das partes
     fecha com o total: a sobra de centavos vai no último. */
  function detalharImposto(faturamento, centro) {
    const lista = tributosProcedimentos(centro);
    const total = Math.round(faturamento * impostoProcedimentos(centro) / 100 * 100) / 100;
    /* A sobra vai no tributo de MAIOR alíquota, não no último da
       lista: um tributo com 0% saía com −R$ 0,01 no detalhamento que
       a contabilidade confere. */
    let maior = 0;
    lista.forEach(function (i, n) {
      if ((Number(i.aliquota) || 0) > (Number(lista[maior].aliquota) || 0)) maior = n;
    });
    let usado = 0;
    const partes = lista.map(function (i, n) {
      if (n === maior) return { id: i.id, nome: i.nome, aliquota: Number(i.aliquota) || 0, valor: null };
      const v = Math.round(faturamento * (Number(i.aliquota) || 0) / 100 * 100) / 100;
      usado = Math.round((usado + v) * 100) / 100;
      return { id: i.id, nome: i.nome, aliquota: Number(i.aliquota) || 0, valor: v };
    });
    if (partes[maior]) partes[maior].valor = Math.round((total - usado) * 100) / 100;
    return { total: total, partes: partes };
  }

  /* Tabelas fiscais do DP: validação de coerência ANTES de salvar.
     A tela gravava direto no cadastro, sem conferir nada — subir o
     teto da última faixa sem mexer no teto de contribuição (o
     reajuste anual típico) fazia quem ganha mais pagar menos, e as
     faixas fora de ordem quebravam o `find` que escolhe a alíquota.
     Salvava em silêncio e a folha inteira passava a errar. */
  function validarTabelasDP(nova) {
    const erros = [];
    const inss = nova.inss || {};
    const faixas = inss.faixas || [];
    if (faixas.length) {
      for (let i = 0; i < faixas.length; i++) {
        const f = faixas[i];
        if (!(Number(f.ate) > 0) && f.ate !== Infinity) {
          erros.push('INSS: a faixa ' + (i + 1) + ' está sem teto.');
        }
        if (!(Number(f.aliquota) >= 0) || Number(f.aliquota) > 100) {
          erros.push('INSS: alíquota inválida na faixa ' + (i + 1) + '.');
        }
        if (i > 0 && Number(f.ate) <= Number(faixas[i - 1].ate)) {
          erros.push('INSS: as faixas precisam estar em ordem crescente — a ' + (i + 1) +
            ' termina antes da ' + i + '.');
        }
        if (i > 0 && Number(f.aliquota) < Number(faixas[i - 1].aliquota)) {
          erros.push('INSS: a alíquota da faixa ' + (i + 1) + ' é menor que a da anterior.');
        }
      }
      /* `teto_contribuicao` é o DESCONTO máximo, não o salário teto:
         precisa ser igual ao INSS progressivo calculado no fim da
         última faixa. Subir o teto da faixa sem subir este valor (o
         reajuste anual típico) fazia quem ganha acima do teto pagar
         menos que quem ganha menos. */
      const ultima = faixas[faixas.length - 1];
      const teto = Number(inss.teto_contribuicao);
      let devidoNoTeto = 0, piso = 0;
      faixas.forEach(function (fx) {
        const ate = Math.min(Number(fx.ate), Number(ultima.ate));
        if (ate > piso) {
          devidoNoTeto += (ate - piso) * Number(fx.aliquota) / 100;
          piso = ate;
        }
      });
      devidoNoTeto = Math.round(devidoNoTeto * 100) / 100;
      if (teto > 0 && Math.abs(teto - devidoNoTeto) > 0.05) {
        erros.push('INSS: o teto de contribuição está em ' + U.brl(teto) + ', mas as faixas dão ' +
          U.brl(devidoNoTeto) + ' no salário de ' + U.brl(Number(ultima.ate)) +
          '. Ajuste os dois juntos, senão quem ganha acima do teto paga diferente de quem ganha o teto.');
      }
    }
    const irrf = nova.irrf || {};
    (irrf.faixas || []).forEach(function (f, i, arr) {
      if (i > 0 && Number(f.ate) <= Number(arr[i - 1].ate) && f.ate !== Infinity) {
        erros.push('IRRF: as faixas precisam estar em ordem crescente (faixa ' + (i + 1) + ').');
      }
      if (Number(f.aliquota) < 0 || Number(f.aliquota) > 100) {
        erros.push('IRRF: alíquota inválida na faixa ' + (i + 1) + '.');
      }
    });
    return erros;
  }

  /* Prova de monotonicidade: salário maior nunca pode pagar menos
     INSS. Roda sobre a tabela proposta, em degraus de R$ 50. */
  function provaMonotonicidadeINSS(tabela) {
    const original = D.tabelaINSS;
    let anterior = -1, falha = null;
    try {
      D.tabelaINSS = tabela;
      const teto = Number(tabela.teto_contribuicao) || 10000;
      for (let v = 50; v <= teto + 500 && !falha; v += 50) {
        const x = calcularINSS(v);
        if (x < anterior - 0.011) falha = { valor: v, antes: anterior, agora: x };
        anterior = x;
      }
    } finally { D.tabelaINSS = original; }
    return falha;
  }

  /* Faixa de cada parâmetro do DP, pela lei: FGTS 8% (Lei 8.036 art.
     15), 1/3 constitucional (CF art. 7º XVII), multa de 40% (Decreto
     99.684 art. 18), teto de 6% no VT (Lei 7.418). O que estava fora
     era copiado cru para o cadastro, e o holerite seguinte saía com
     Infinity e NaN. */
  const FAIXA_PARAM_DP = {
    aliquota_fgts: [0, 15], aliquota_inss_patronal: [0, 30],
    aliquota_rat_fap: [0, 9], aliquota_terceiros: [0, 10],
    terco_constitucional_ferias: [0, 1], percentual_vt_max_desconto: [0, 20],
    salario_minimo: [1, 100000], multa_fgts_pct: [0, 100],
    divisor_hora_mensal: [100, 300], teto_salario_familia: [0, 100000],
    valor_salario_familia: [0, 10000], aliquota_multa_fgts: [0, 100]
  };

  function salvarTabelasDP(nova) {
    nova = nova || {};
    if (!pode('dp') && !pode('admin')) return { erro: 'Seu perfil não altera tabelas fiscais.' };
    const erros = validarTabelasDP(nova);
    if (erros.length) return { erro: erros.join(' ') };

    /* Objeto PARCIAL apagava as faixas: `{irrf: {deducao: 200}}` sem
       as faixas gravava undefined e o DP inteiro parava de calcular
       com TypeError. */
    if (nova.inss && !(nova.inss.faixas && nova.inss.faixas.length)) {
      return { erro: 'Para alterar o INSS, envie as faixas junto — sem elas o cálculo para.' };
    }
    if (nova.irrf && !(nova.irrf.faixas && nova.irrf.faixas.length)) {
      return { erro: 'Para alterar o IRRF, envie as faixas junto — sem elas o cálculo para.' };
    }
    const foraDaFaixa = Object.keys((nova.parametros || {})).map(function (k) {
      const faixa = FAIXA_PARAM_DP[k];
      if (!faixa) return 'parâmetro desconhecido: ' + k;
      const v = Number(nova.parametros[k]);
      if (!isFinite(v)) return k + ': valor inválido';
      if (v < faixa[0] || v > faixa[1]) {
        return k + ': ' + v + ' fora da faixa aceita (' + faixa[0] + ' a ' + faixa[1] + ')';
      }
      return null;
    }).filter(Boolean);
    if (foraDaFaixa.length) return { erro: foraDaFaixa.join(' · ') };
    if (nova.inss) {
      const falha = provaMonotonicidadeINSS(nova.inss);
      if (falha) {
        return { erro: 'Com esta tabela, quem ganha ' + U.brl(falha.valor) + ' pagaria ' +
          U.brl(falha.agora) + ' de INSS — menos que os ' + U.brl(falha.antes) +
          ' de quem ganha R$ 50 a menos. Confira as faixas e o teto.' };
      }
      D.tabelaINSS.faixas = nova.inss.faixas;
      D.tabelaINSS.teto_contribuicao = nova.inss.teto_contribuicao;
    }
    if (nova.irrf) {
      D.tabelaIRRF.faixas = nova.irrf.faixas;
      if (nova.irrf.deducao_por_dependente !== undefined) {
        D.tabelaIRRF.deducao_por_dependente = nova.irrf.deducao_por_dependente;
      }
      if (nova.irrf.desconto_simplificado !== undefined) {
        D.tabelaIRRF.desconto_simplificado = nova.irrf.desconto_simplificado;
      }
    }
    if (nova.parametros) {
      Object.keys(nova.parametros).forEach(function (k) {
        D.parametrosDP[k] = nova.parametros[k];
      });
    }
    logar('parametros', 'tabelas_dp', 'alterou', 'tabelas fiscais do DP atualizadas');
    return { ok: true };
  }

  /* Alterar a alíquota = alterar o cadastro do projeto. A função
     continua existindo (a tela de Administração usa), mas escreve no
     centro, não num parâmetro paralelo. */
  function salvarImpostosProcedimentos(lista, centro) {
    /* Parâmetro de Administração, não de Procedimentos: a alíquota
       recalcula o resultado de TODO o histórico, então quem a muda
       precisa movimentar em Administração. Antes bastava `lancar` ou
       `ver_custo`, e um perfil de consulta reescrevia o passado. */
    if (!pode('admin') && !podeMover('administracao')) {
      return { erro: 'Alterar a alíquota exige movimentação em Administração.' };
    }
    if (!Array.isArray(lista) || !lista.length) return { erro: 'Informe ao menos um tributo.' };
    const limpa = [];
    for (let i = 0; i < lista.length; i++) {
      const t = lista[i];
      const nome = String(t.nome || '').trim();
      if (!nome) return { erro: 'Dê um nome a cada tributo.' };
      const a = Number(String(t.aliquota).replace(',', '.'));
      if (!(a >= 0) || a > 100) return { erro: nome + ': a alíquota deve ficar entre 0 e 100.' };
      limpa.push({ id: t.id || U.slug(nome), nome: nome, aliquota: Math.round(a * 10000) / 10000,
        obs: t.obs || '', ativo: t.ativo !== false });
    }
    const soma = limpa.filter(function (t) { return t.ativo; })
      .reduce(function (s2, t) { return s2 + t.aliquota; }, 0);
    if (soma > 100) return { erro: 'A soma das alíquotas passou de 100%.' };
    const alvo = D.centro(centro || D.PATE_CENTRO);
    if (!alvo) return { erro: 'Projeto não encontrado.' };
    const novos = {};
    limpa.filter(function (t) { return t.ativo; }).forEach(function (t) {
      novos[t.id] = t.aliquota;
    });
    alvo.impostos = novos;
    /* Os subprojetos do mutirão acompanham o projeto-mãe: é uma nota
       só, com a mesma tributação. */
    if (alvo.id === D.PATE_CENTRO) {
      D.centros.filter(function (c) { return c.especialidade_pate; }).forEach(function (c) {
        c.impostos = Object.assign({}, novos);
      });
    }
    logar('parametros', 'impostos_procedimentos', 'alterou',
      limpa.filter(function (t) { return t.ativo; })
        .map(function (t) { return t.nome + ' ' + U.num(t.aliquota) + '%'; }).join(' · ') +
      ' = ' + U.num(Math.round(soma * 10000) / 10000) + '%');
    return { ok: true, total: Math.round(soma * 10000) / 10000, tributos: limpa };
  }

  /* `centro` entra na conta: a alíquota é do CADASTRO DO PROJETO, e
     os três pontos de cálculo chamavam sem argumento, caindo sempre
     no mutirão do HGB. Abrir mutirão em outra unidade é cadastro, não
     código — então o caminho é previsto e o imposto saía errado lá. */
  function calcularProcedimento(pate, custoMaterial, qtd, centro) {
    const q = qtd || 1;
    const faturamento = Math.round((pate.faturamento || 0) * q * 100) / 100;
    const repasse = Math.round((pate.repasse || 0) * q * 100) / 100;
    const material = Math.round((custoMaterial || 0) * 100) / 100;
    const imposto = Math.round(faturamento * impostoProcedimentos(centro) / 100 * 100) / 100;
    const custo = Math.round((repasse + material) * 100) / 100;
    return {
      faturamento: faturamento, repasse: repasse, material: material,
      imposto: imposto, custo: custo,
      resultado: Math.round((faturamento - imposto - custo) * 100) / 100,
      margem: faturamento > 0
        ? Math.round((faturamento - imposto - custo) / faturamento * 1000) / 10 : null
    };
  }

  /* Número que pode vir com vírgula decimal, como `entrada()` aceita
     desde a C6: '688,77' é R$ 688,77, não NaN. Devolve NaN quando não
     é número, para quem chama recusar em vez de silenciar. */
  /* A data precisa EXISTIR, não só ter o formato: '2026-11-31' casa
     com a máscara e o JavaScript rola para 1º de dezembro em
     silêncio — rescisão em 31/02 contava 30 dias de salário num mês
     de 28, e plantão em 31/11 sumia das duas competências. */
  function dataExiste(iso) {
    const t = String(iso || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
    const d = new Date(t + 'T00:00:00Z');
    if (isNaN(d.getTime())) return false;
    return d.toISOString().slice(0, 10) === t;
  }

  function numeroBR(v) {
    if (v === null || v === undefined || v === '') return NaN;
    if (typeof v === 'number') return v;
    const t = String(v).trim();
    const temPonto = t.indexOf('.') >= 0, temVirgula = t.indexOf(',') >= 0;
    let limpo = t;
    if (temPonto && temVirgula) {
      limpo = t.lastIndexOf(',') > t.lastIndexOf('.')
        ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    } else if (temVirgula) { limpo = t.replace(',', '.'); }
    return Number(limpo);
  }

  /* Separadores que denunciam dois nomes no mesmo campo. Não é
     adivinhação de nome: são os sinais que alguém usa para juntar
     duas pessoas num campo de um. */
  function medicoDuplo(nome) {
    const t = ' ' + String(nome || '').toUpperCase().replace(/\s+/g, ' ') + ' ';
    /* Só SINAIS FORTES. O " E " saiu: em português ele liga sobrenomes
       ("João de Paula e Silva", "Luiz Gonzaga e Melo") com a mesma
       frequência com que ligaria dois nomes, e recusar isso é pior
       que deixar passar. A vírgula saiu pelo mesmo motivo: "Silva
       Junior, João Carlos" é como a escala costuma vir escrita. */
    const marcas = [' / ', '/', ' + ', '+', ' & ', '&', ';', ' COM ', ' AUX ', ' AUXILIAR ',
      ' E DR ', ' E DRA ', ' E DR. ', ' E DRA. '];
    for (let i = 0; i < marcas.length; i++) {
      if (t.indexOf(marcas[i]) >= 0) return marcas[i].trim() || marcas[i];
    }
    return null;
  }

  function lancarProcedimento(d) {
    d = d || {};
    if (!podeMover('procedimentos')) {
      return { erro: 'Seu perfil vê procedimentos, mas não movimenta. Quem lança a cirurgia é ' +
        'quem está na sala.' };
    }
    const pate = D.pateP(d.procedimento);
    if (!pate) return { erro: 'Escolha o procedimento.' };
    const medico = String(d.medico || '').trim();
    if (!medico) return { erro: 'Informe o nome do médico.' };
    /* UM médico por cirurgia, sempre. O campo é texto e a chave do
       plantão é data + médico: dois nomes no mesmo campo viram um
       plantão só e um repasse só, e o segundo médico desaparece do
       fechamento. Decisão de produto: a cirurgia tem um responsável;
       havendo dois profissionais, lança-se um procedimento por
       médico, cada um com o seu repasse. */
    const doisMedicos = medicoDuplo(medico);
    if (doisMedicos) {
      return { erro: 'Informe um médico só (encontrei "' + doisMedicos + '" no nome). ' +
        'A cirurgia tem um responsável — se houve dois profissionais, lance um procedimento ' +
        'para cada um, com o repasse de cada um.', dois_medicos: true };
    }
    if (!d.data) return { erro: 'Informe a data.' };
    if (!dataExiste(String(d.data))) return { erro: 'Data inválida (' + d.data + ').' };
    /* O armazém vem da especialidade. Recebido em branco, o próprio
       store resolve — e se vier um de outra especialidade, recusa:
       baixar lente intraocular do estoque da gineco não é engano que
       o sistema deva deixar passar. */
    const armazem = d.armazem || D.armazemDaEspecialidade(pate.area, d.centro || D.PATE_CENTRO);
    if (!D.armazem(armazem)) {
      return { erro: 'Não há sala cadastrada para ' + pate.area +
        '. Cadastre o armazém da especialidade no módulo de estoque.' };
    }
    const daEsp = D.armazemDaEspecialidade(pate.area, d.centro || D.PATE_CENTRO);
    if (daEsp && armazem !== daEsp && !d.confirmar_outro_setor) {
      return { erro: pate.nome + ' é de ' + pate.area + ', cujo material fica em ' +
        (D.armazem(daEsp) || {}).nome + ' — e o lançamento aponta para ' +
        (D.armazem(armazem) || {}).nome + '.', setor_errado: true, setor_certo: daEsp };
    }
    /* Quantidade inteira e finita: Infinity passava e contaminava o
       relatório inteiro da competência; texto virava NaN gravado. */
    const qtdBruta = d.qtd === undefined || d.qtd === null || d.qtd === '' ? 1 : numeroBR(d.qtd);
    if (!isFinite(qtdBruta) || qtdBruta < 1) {
      return { erro: 'Quantidade inválida (' + d.qtd + '). Informe um número inteiro a partir de 1.' };
    }
    const qtd = Math.max(1, Math.round(qtdBruta));

    /* Paciente é obrigatório na cirurgia e dispensado na diária: a
       diária é turno de trabalho, não atendimento de um paciente. */
    const paciente = String(d.paciente || '').trim();
    if (pate.tipo === 'cirurgia' && !paciente) return { erro: 'Informe o nome do paciente.' };

    /* Sem repasse na tabela (zerado ou em branco) o médico NÃO é pago
       por procedimento: recebe plantão fixo, que vem do PegaPlantão.
       O custo dele não entra nesta linha — entra rateado pelo plantão
       estimado do dia, em `procedimentosComPlantao`. Lançar zero aqui
       e somar o plantão lá evita contar o médico duas vezes. */
    const informouRepasse = d.repasse !== undefined && d.repasse !== null && d.repasse !== '';
    const porPlantao = !informouRepasse && !(pate.repasse > 0) && pate.tipo === 'cirurgia';

    const itens = (d.materiais || []).filter(function (i) { return i.produto && i.qtd > 0; });

    /* Baixa do material ANTES de gravar: se não há saldo, nada é
       lançado. */
    /* Material que está no hospital mas ainda não foi transferido
       para a sala: a cirurgia aconteceu, o material saiu. Travar o
       lançamento por causa de uma transferência que ninguém fez no
       sistema empurra o operador a não lançar — pior que a
       imprecisão. Então o sistema transfere sozinho, deixando o
       rastro, e só recusa se faltar no hospital inteiro. */
    /* A trava de competência existia, com mensagem pronta, e só a
       tela a chamava: lançar e cancelar na competência já enviada ao
       órgão passavam, e o que existe deixava de bater com o que foi
       faturado. */
    const travaLanc = travaDeProcedimento(d.data, d.centro || D.PATE_CENTRO);
    if (travaLanc && !d.forcar) {
      return { erro: travaLanc, trava_competencia: true };
    }

    /* Consolida por PRODUTO antes de decidir: com o mesmo material em
       duas linhas, cada uma olhava o saldo isolada — a primeira
       puxava o que faltava para ela, a segunda achava que já bastava,
       e a baixa (que soma as duas) recusava depois de o material já
       ter sido movido. */
    const precisaPorProduto = {};
    itens.forEach(function (i) {
      precisaPorProduto[i.produto] =
        Math.round(((precisaPorProduto[i.produto] || 0) + i.qtd) * 1000) / 1000;
    });
    const transferidos = [];
    const produtosPedidos = Object.keys(precisaPorProduto);
    for (let i = 0; i < produtosPedidos.length; i++) {
      const it = { produto: produtosPedidos[i], qtd: precisaPorProduto[produtosPedidos[i]] };
      const naSala = saldoEstoque(it.produto, armazem);
      if (naSala >= it.qtd - 0.0001) continue;
      const falta = Math.round((it.qtd - naSala) * 1000) / 1000;
      const un = saldoNaUnidade(it.produto, armazem);
      const pr = D.produtos.find(function (x) { return x.id === it.produto; }) || {};
      if (un.saldo < it.qtd - 0.0001) {
        return { erro: pr.descricao + ': o hospital tem ' + U.num(un.saldo) + ' ' +
          (pr.unidade || 'un') + ' e a cirurgia usou ' + U.num(it.qtd) + '.' };
      }
      /* Puxa a diferença de onde houver, dentro da mesma unidade. */
      const fontes = D.comSetores(un.pai).filter(function (am) {
        return am !== armazem && saldoEstoque(it.produto, am) > 0;
      });
      let resta = falta;
      for (let j = 0; j < fontes.length && resta > 0.0001; j++) {
        const disp = saldoEstoque(it.produto, fontes[j]);
        const leva = Math.min(disp, resta);
        const t = transferir({ origem: fontes[j], destino: armazem, data: d.data,
          motivo: 'Transferência automática — consumo em procedimento',
          itens: [{ produto: it.produto, qtd: leva }] });
        if (t.erro) return { erro: pr.descricao + ': ' + t.erro };
        resta = Math.round((resta - leva) * 1000) / 1000;
        transferidos.push({ produto: it.produto, descricao: pr.descricao, qtd: leva,
          de: (D.armazem(fontes[j]) || {}).nome });
      }
      if (resta > 0.0001) {
        return { erro: pr.descricao + ': não foi possível reunir ' + U.num(it.qtd) + ' ' +
          (pr.unidade || 'un') + ' na unidade.' };
      }
    }

    /* Desfaz o que foi puxado, quando o lançamento não se completa:
       sem isto, o material ficava no armazém errado com o motivo de
       um procedimento que não existe. */
    const desfazerTransferencias = function () {
      transferidos.slice().reverse().forEach(function (t) {
        const origem = D.armazens.find(function (a) { return a.nome === t.de; });
        if (!origem) return;
        transferir({ origem: armazem, destino: origem.id, data: d.data,
          motivo: 'Devolução — o lançamento do procedimento foi recusado',
          itens: [{ produto: t.produto, qtd: t.qtd }] });
      });
    };

    let custoMaterial = 0, grupo = null, movimentos = [];
    if (itens.length) {
      const b = baixaMultipla({
        armazem: armazem, data: d.data, motivo: 'Consumo assistencial',
        documento: d.documento || '', paciente: paciente,
        observacao: pate.nome + ' — ' + medico,
        itens: itens, origem: 'procedimento'
      });
      if (b.erro) { desfazerTransferencias(); return { erro: b.erro }; }
      /* baixaMultipla devolve o custo somado em `valor`. */
      custoMaterial = b.valor || 0;
      grupo = b.grupo || null;
      movimentos = st.estoqueMov.filter(function (m) { return m.grupo === grupo; });
    }

    /* Repasse informado precisa ser número finito e não negativo:
       '688,77' virava NaN e o `(pate.repasse || 0)` o trocava por
       zero em silêncio — o médico sumia do fechamento e o resultado
       ganhava R$ 688,77 de lucro falso. */
    let repasseInformado = null;
    if (d.repasse !== undefined && d.repasse !== null && d.repasse !== '') {
      const rp = numeroBR(d.repasse);
      if (!isFinite(rp) || rp < 0) {
        return { erro: 'Repasse inválido (' + d.repasse + '). Use número, com vírgula ou ponto.' };
      }
      repasseInformado = Math.round(rp * 100) / 100;
    }
    const base = Object.assign({}, pate);
    if (repasseInformado !== null) base.repasse = repasseInformado;
    if (base.repasse === null || base.repasse === undefined) base.repasse = 0;
    const centroDoLancamento = d.centro || D.centroDaEspecialidade(pate.area) || D.PATE_CENTRO;
    const r = calcularProcedimento(base, custoMaterial, qtd, centroDoLancamento);

    const p = {
      id: novoId('pc'), data: d.data, competencia: d.competencia || U.compDe(d.data),
      /* Subprojeto da especialidade: é nele que o previsto e o
         resultado aparecem, como no GHC - HGB. */
      centro: centroDoLancamento,
      especialidade: pate.area, procedimento: pate.id, procedimento_nome: pate.nome,
      codigo: pate.codigo, tipo: pate.tipo,
      medico: medico, paciente: paciente, qtd: qtd,
      armazem: armazem, setor: (D.armazem(armazem) || {}).nome || '',
      /* O custo unitário de cada item fica GRAVADO na linha. Sem ele,
         a edição estornava pelo custo médio de hoje: se a sala tinha
         zerado, o custo médio era 0 e o material do procedimento
         evaporava (R$ 297,60 viravam R$ 0,00 e o resultado subia na
         mesma medida); se o preço tinha mudado, a edição reprecificava
         um consumo passado. */
      materiais: itens.map(function (i) {
        const pr = D.produtos.find(function (x) { return x.id === i.produto; }) || {};
        const mv = movimentos.find(function (m) { return m.produto === i.produto; });
        const unit = mv && mv.qtd ? Math.round((mv.valor / mv.qtd) * 10000) / 10000
          : custoMedio(i.produto, armazem);
        return { produto: i.produto, descricao: pr.descricao || '', unidade: pr.unidade || '',
                 qtd: i.qtd, custo_unitario: unit,
                 valor: Math.round(unit * i.qtd * 100) / 100 };
      }),
      grupo_estoque: grupo, movimentos: movimentos.map(function (m) { return m.id; }),
      faturamento: r.faturamento, repasse: r.repasse, custo_material: r.material,
      imposto: r.imposto, imposto_pct: impostoProcedimentos(centroDoLancamento),
      /* O imposto é sempre recalculado com a alíquota vigente, aqui e
         nos relatórios: quando a contabilidade fecha a alíquota certa,
         o resultado do que já passou tem de refletir a realidade —
         guardar o número do dia deixaria o histórico mentindo. */
      imposto_detalhe: detalharImposto(r.faturamento).partes,
      custo: r.custo, resultado: r.resultado, margem: r.margem,
      repasse_da_tabela: pate.repasse > 0 && repasseInformado === null,
      /* Quem paga o médico desta linha: a tabela (repasse por
         procedimento) ou o plantão fixo do PegaPlantão. */
      pago_por_plantao: porPlantao,
      observacao: d.observacao || '', documento: d.documento || '',
      financeiro: null,
      criado_em: new Date(), usuario: usuario().nome, usuario_id: (usuario() || {}).id || null
    };
    p.transferencias = transferidos;
    st.procedimentos.push(p);
    atualizarPrevisoesProcedimentos(p.competencia);
    logar('procedimento', p.id, 'lancou',
      pate.nome + ' — ' + medico + (paciente ? ' / ' + paciente : ''));
    return { ok: true, procedimento: p,
      aviso: transferidos.length
        ? 'Material puxado de outro estoque do hospital: ' +
          transferidos.map(function (t) {
            return U.num(t.qtd) + ' ' + t.descricao + ' de ' + t.de; }).join('; ') + '.'
        : null };
  }

  /* Editar um procedimento já lançado. O material é a parte delicada:
     estornar a baixa antiga e refazer, senão o estoque fica com o
     consumo errado. Por isso a edição é uma substituição — o
     procedimento antigo vira histórico e o novo carrega a correção. */
  function editarProcedimento(id, d) {
    const antigo = st.procedimentos.find(function (x) { return x.id === id; });
    if (!antigo) return { erro: 'Procedimento não encontrado.' };
    if (antigo.cancelado) return { erro: 'Este procedimento está cancelado.' };
    if (antigo.financeiro) {
      return { erro: 'Este procedimento já foi para o financeiro (' + antigo.financeiro +
        '). Estorne o lançamento financeiro antes de editar.' };
    }
    if (!podeMover('procedimentos')) return { erro: 'Seu perfil não movimenta procedimentos.' };
    /* Conferido ANTES de estornar: o relançamento recusaria igual,
       mas depois de o material já ter ido e voltado do estoque. */
    if (d && d.medico) {
      const dois = medicoDuplo(d.medico);
      if (dois) {
        return { erro: 'Informe um médico só (encontrei "' + dois + '" no nome). ' +
          'Se houve dois profissionais, lance um procedimento para cada um.',
          dois_medicos: true };
      }
    }

    /* Devolve ao estoque o que a baixa anterior consumiu, pelo mesmo
       custo — sem isso a correção de quantidade some do saldo. */
    /* Estorno que falha ABORTA a edição. Antes o `if (r.ok)` sem else
       engolia o erro: com o perfil operacional (que movimenta
       procedimentos mas não estoque), a devolução era recusada, a
       edição seguia e o material saía duas vezes — e a função ainda
       devolvia ok. */
    const devolvidos = [];
    for (let i = 0; i < (antigo.materiais || []).length; i++) {
      const m = antigo.materiais[i];
      const destino = antigo.armazem_material || antigo.armazem;
      const r = entrada({ produto: m.produto, armazem: destino, qtd: m.qtd,
        /* Pelo custo da baixa, não pelo de hoje. */
        custo: m.custo_unitario !== undefined && m.custo_unitario !== null
          ? m.custo_unitario : custoMedio(m.produto, destino),
        data: antigo.data, motivo: 'Estorno de edição de procedimento',
        documento: antigo.id, origem: 'procedimento-edicao' });
      if (r.ok) { devolvidos.push(m); continue; }
      /* Desfaz o que já voltou e sai sem alterar nada. */
      devolvidos.forEach(function (x) {
        saida({ produto: x.produto, armazem: destino, qtd: x.qtd, data: antigo.data,
          motivo: 'Consumo assistencial', observacao: 'Refeito após edição recusada',
          origem: 'procedimento' });
      });
      return { erro: 'Não foi possível devolver ' + (m.descricao || m.produto) +
        ' ao estoque: ' + r.erro + ' A edição não foi feita.' };
    }

    /* Lança o novo com os dados corrigidos. Se falhar, o estorno
       acima precisa voltar atrás — senão sobra material no estoque. */
    const novo = lancarProcedimento(Object.assign({}, {
      data: antigo.data, procedimento: antigo.procedimento, medico: antigo.medico,
      paciente: antigo.paciente, armazem: antigo.armazem, qtd: antigo.qtd,
      observacao: antigo.observacao, centro: antigo.centro,
      materiais: (antigo.materiais || []).map(function (m) {
        return { produto: m.produto, qtd: m.qtd }; })
    }, d));
    if (novo.erro) {
      /* Desfaz o estorno: tira de novo o que acabou de voltar. */
      devolvidos.forEach(function (m) {
        saida({ produto: m.produto, armazem: antigo.armazem_material || antigo.armazem, qtd: m.qtd,
          data: antigo.data, motivo: 'Consumo assistencial',
          observacao: 'Refeito após edição recusada', origem: 'procedimento' });
      });
      return novo;
    }

    /* `cancelado` é SIM OU NÃO, e o detalhe vai em campos próprios.
       Guardar um objeto aqui funcionava na memória — JavaScript
       trata objeto como verdadeiro — e era recusado pelo banco, que
       tem a coluna como booleana. O resultado: a edição gravava o
       procedimento NOVO e não conseguia encerrar o antigo, então
       corrigir o nome de um paciente dobrava o faturamento do
       mutirão depois do reload.

       É o tipo de divergência que só aparece quando há banco: na
       tela ficava certo. */
    antigo.cancelado = true;
    antigo.motivo_cancelamento = 'Editado — substituído por ' + novo.procedimento.id;
    antigo.cancelado_em = U.hoje();
    antigo.cancelado_por = usuario().nome;
    antigo.edicao = true;
    atualizarPrevisoesProcedimentos(antigo.competencia);
    if (novo.procedimento.competencia !== antigo.competencia) {
      atualizarPrevisoesProcedimentos(novo.procedimento.competencia);
    }
    novo.procedimento.substitui = antigo.id;
    logar('procedimento', novo.procedimento.id, 'editou', 'substitui ' + antigo.id);
    return { ok: true, procedimento: novo.procedimento, anterior: antigo.id };
  }

  function cancelarProcedimento(id, motivo, opcoes) {
    /* Sem guarda nenhuma: qualquer perfil cancelava cirurgia
       lançada — inclusive o de consulta. Encontrado pela varredura
       de permissões ampliada. */
    if (!podeMover('procedimentos')) {
      return { erro: 'Seu perfil não movimenta procedimentos.' };
    }
    const p = st.procedimentos.find(function (x) { return x.id === id; });
    if (!p) return { erro: 'Procedimento não encontrado.' };
    if (p.cancelado) return { erro: 'Este procedimento já está cancelado.' };
    if (p.financeiro) {
      return { erro: 'Este procedimento já foi para o financeiro (' + p.financeiro +
        '). Estorne o lançamento financeiro antes de cancelar.' };
    }
    const pAlvo = st.procedimentos.find(function (x) { return x.id === id; });
    const travaCanc = pAlvo ? travaDeProcedimento(pAlvo.data, pAlvo.centro) : null;
    if (travaCanc && !(opcoes || {}).forcar) {
      return { erro: travaCanc, trava_competencia: true };
    }
    if (!motivo) return { erro: 'Diga o motivo do cancelamento.' };
    /* O material JÁ saiu do estoque. Cancelar o procedimento não
       devolve sozinho: quem devolve é a entrada por devolução, no
       módulo de estoque, senão o saldo passa a mentir. */
    p.cancelado = true;
    p.motivo_cancelamento = motivo;
    p.cancelado_em = U.hoje();
    p.cancelado_por = usuario().nome;
    atualizarPrevisoesProcedimentos(p.competencia);
    logar('procedimento', p.id, 'cancelou', motivo);
    return { ok: true, aviso: p.materiais.length
      ? 'O material consumido continua baixado. Se voltou para o estoque, lance a devolução no módulo de estoque.'
      : null };
  }


  /* ── plantões do mutirão ────────────────────────────────
     Quando o procedimento não tem repasse na tabela, o médico é pago
     por plantão fixo — e esse dado vem do PegaPlantão, não daqui.
     Enquanto o fechamento não chega, o sistema ESTIMA pelo que foi
     lançado: cada médico que operou num dia fez um plantão de 6 horas.

     Um médico que fez 8 cataratas num dia continua sendo um plantão;
     o que muda o número é o turno ter sido maior, e isso o operador
     ajusta à mão (12 horas = 2 plantões). */
  const plantaoValor = () =>
    (st.parametros.plantao_valor !== undefined ? st.parametros.plantao_valor : D.PLANTAO_VALOR) || 0;
  const plantaoHoras = () =>
    (st.parametros.plantao_horas !== undefined ? st.parametros.plantao_horas : D.PLANTAO_HORAS) || 6;
  const chavePlantao = (data, medico) => data + '|' + String(medico || '').toUpperCase().trim();

  function ajustarPlantoes(data, medico, qtd, motivo) {
    if (!dataExiste(String(data))) return { erro: 'Data inválida (' + data + ').' };
    if (!podeMover('procedimentos')) return { erro: 'Seu perfil não ajusta plantão.' };
    /* Cada plantão vale R$ 1.000: mexer na quantidade é mexer em custo
       e em resultado, não só em contagem. */
    if (!veFinanceiro('procedimentos')) {
      return { erro: 'Ajustar plantão mexe no custo — seu perfil não tem acesso financeiro em ' +
        'Procedimentos.' };
    }
    /* Com o fechamento do PegaPlantão na mão, a estimativa não decide
       mais nada: ajustar aqui daria a impressão de mudar o custo sem
       mudar. */
    const jaTemReal = plantaoRealizado(U.compDe(data));
    if (jaTemReal) {
      return { erro: 'O fechamento do PegaPlantão desta competência já entrou (' +
        jaTemReal.arquivos + ') e é ele que vale. Ajustar a estimativa não mudaria o custo — ' +
        'corrija no fechamento, se for o caso.' };
    }
    const n = Number(qtd);
    if (!(n >= 0) || Math.round(n * 2) !== n * 2) {
      return { erro: 'A quantidade de plantões deve ser 0, 0,5, 1, 1,5… (meio plantão = ' +
        (plantaoHoras() / 2) + ' horas).' };
    }
    st.parametros.plantoes_ajustados = st.parametros.plantoes_ajustados || {};
    const k = chavePlantao(data, medico);
    if (n === 1) delete st.parametros.plantoes_ajustados[k];   // voltou ao padrão
    else st.parametros.plantoes_ajustados[k] = n;
    logar('procedimento', k, 'ajustou plantão', n + ' plantão(ões)' + (motivo ? ' — ' + motivo : ''));
    return { ok: true, qtd: n };
  }


  /* Plantão REALIZADO: quando o fechamento do PegaPlantão do mutirão é
     importado, o valor que a empresa vai pagar de fato existe — e ele
     manda. A estimativa vira conferência.

     O realizado vem dos títulos do lote de produtividade do projeto
     do mutirão: um título por médico, com o valor do fechamento. */
  function plantaoRealizado(comp, centro) {
    if (!comp) return null;
    const alvo = centro || D.PATE_CENTRO;
    const lotes = lotesProdutividade({ centro: alvo, competencia: comp })
      .filter(function (l) { return !l.cancelado; });
    if (!lotes.length) return null;

    const porMedico = {};
    let total = 0;
    lotes.forEach(function (l) {
      (l.titulo_ids || []).forEach(function (tid) {
        const t = st.titulos.find(function (x) { return x.id === tid; });
        if (!t || t.cancelado) return;
        const nome = (D.credor(t.credor) || {}).nome || '—';
        const k = U.slug(nome);
        porMedico[k] = porMedico[k] || { medico: nome, valor: 0, titulos: [] };
        porMedico[k].valor = Math.round((porMedico[k].valor + (t.valor_total || 0)) * 100) / 100;
        porMedico[k].titulos.push(t.id);
        total = Math.round((total + (t.valor_total || 0)) * 100) / 100;
      });
    });
    if (!Object.keys(porMedico).length) return null;
    return {
      competencia: comp, centro: alvo, total: total,
      por_medico: porMedico,
      lotes: lotes.map(function (l) { return { id: l.id, arquivo: l.arquivo, valor: l.valor }; }),
      arquivos: lotes.map(function (l) { return l.arquivo; }).join(', ')
    };
  }

  /* Plantões estimados no período: um por médico e dia em que houve
     procedimento pago por plantão, salvo ajuste manual. */
  function plantoesEstimados(f) {
    /* O DIA do médico é inteiro, independente do recorte da tela.
       Filtrando por especialidade, o dia do médico que operou oftalmo
       e otorrino era recalculado só com metade dos procedimentos, e o
       plantão de R$ 1.000 aparecia inteiro nas duas visões — R$ 2.000
       para um turno de 6 horas. O recorte limita o que se VÊ, não o
       que se calcula. */
    f = f || {};
    const recorte = { competencia: f.competencia, de: f.de, ate: f.ate,
      medico: f.medico, cancelados: f.cancelados };
    const linhas = listarProcedimentos(recorte).filter(function (p) { return p.pago_por_plantao; });
    const dias = {};
    linhas.forEach(function (p) {
      const k = chavePlantao(p.data, p.medico);
      dias[k] = dias[k] || { data: p.data, medico: p.medico, procedimentos: 0,
        faturamento: 0, especialidades: {} };
      dias[k].procedimentos += p.qtd || 1;
      dias[k].faturamento = Math.round((dias[k].faturamento + p.faturamento) * 100) / 100;
      dias[k].especialidades[p.especialidade] = true;
    });
    const ajustes = st.parametros.plantoes_ajustados || {};
    /* Se o fechamento do PegaPlantão já entrou na competência, o
       realizado manda: a estimativa continua visível, mas só para
       conferência. */
    const comp = f && f.competencia;
    const real = comp ? plantaoRealizado(comp) : null;

    const linhasDia = Object.keys(dias).map(function (k) {
      const d = dias[k];
      d.chave = k;
      d.plantoes = ajustes[k] !== undefined ? ajustes[k] : 1;
      d.ajustado = ajustes[k] !== undefined;
      d.horas = Math.round(d.plantoes * plantaoHoras() * 10) / 10;
      d.custo_estimado = Math.round(d.plantoes * plantaoValor() * 100) / 100;
      d.custo = d.custo_estimado;
      d.especialidade = Object.keys(d.especialidades).join(', ');
      delete d.especialidades;
      return d;
    }).sort(function (a, b) { return a.data.localeCompare(b.data) || a.medico.localeCompare(b.medico); });

    if (!real) return linhasDia;

    /* Realizado por médico, repartido entre os dias dele na proporção
       dos plantões estimados — o fechamento traz o total do mês por
       médico, não o valor de cada dia. */
    const diasDoMedico = {};
    linhasDia.forEach(function (d) {
      const k = U.slug(d.medico);
      diasDoMedico[k] = diasDoMedico[k] || { total: 0, linhas: [] };
      diasDoMedico[k].total += d.plantoes;
      diasDoMedico[k].linhas.push(d);
    });
    /* Médico que operou e NÃO está no fechamento: a estimativa dele
       não pode continuar somando ao lado do realizado — o custo total
       passava do que a empresa vai pagar (R$ 4.400 de fechamento
       viravam R$ 4.400 + R$ 1.000 de estimativa), e o painel ainda
       rotulava isso como "realizado". Com fechamento na mão, ele sai
       da conta e entra num aviso: ou o nome está grafado diferente, ou
       faltou incluí-lo. */
    const semFechamento = [];
    Object.keys(diasDoMedico).forEach(function (k) {
      const m = real.por_medico[k];
      const g = diasDoMedico[k];
      if (!g.total) return;
      if (!m) {
        g.linhas.forEach(function (d) {
          d.custo_realizado = 0;
          d.custo = 0;
          d.realizado = true;
          d.sem_fechamento = true;
        });
        semFechamento.push(g.linhas[0].medico);
        return;
      }
      let usado = 0;
      g.linhas.forEach(function (d, i) {
        d.custo_realizado = i === g.linhas.length - 1
          ? Math.round((m.valor - usado) * 100) / 100
          : Math.round(m.valor * (d.plantoes / g.total) * 100) / 100;
        usado = Math.round((usado + d.custo_realizado) * 100) / 100;
        d.custo = d.custo_realizado;
        d.realizado = true;
      });
    });
    linhasDia.medicos_sem_fechamento = [...new Set(semFechamento)];
    return linhasDia;
  }

  /* Procedimentos com o custo do plantão rateado. O rateio é pelo
     FATURAMENTO da linha dentro do dia daquele médico: a catarata de
     R$ 1.466 carrega mais plantão que o calázio de R$ 149, que é como
     o custo se distribui de fato. Sem isso, a margem por procedimento
     mentiria — mostraria a catarata com 50% e o calázio com 49%,
     quando o calázio dá prejuízo. */
  /* Só os dias que o recorte atual alcança — usado para exibir e
     somar sem recalcular o rateio. */
  function plantoesVisiveis(f) {
    f = f || {};
    const todos = plantoesEstimados(f);
    if (!f.especialidade && !f.armazem && !f.procedimento && !f.busca) return todos;
    const visiveis = {};
    listarProcedimentos(f).forEach(function (p) {
      if (p.pago_por_plantao) visiveis[chavePlantao(p.data, p.medico)] = true;
    });
    const out = todos.filter(function (d) { return visiveis[d.chave]; });
    out.medicos_sem_fechamento = todos.medicos_sem_fechamento || [];
    return out;
  }

  /* Custo estimado do material de uma cirurgia, do jeito que o
     lançamento vai calcular: o que a sala tem sai pelo custo médio
     dela, e o que falta vem de outro armazém da unidade pelo custo
     DE LÁ. A prévia da tela aplicava o custo da sala a tudo, e
     divergia do gravado sempre que os preços diferiam entre salas
     (R$ 12.000 na tela contra R$ 10.480 no lançamento). Mora no store
     para que tela e gravação usem a mesma conta. */
  function custoMaterialPrevisto(armazem, itens) {
    let total = 0;
    const partes = [];
    (itens || []).forEach(function (i) {
      if (!i.produto || !(i.qtd > 0)) return;
      const naSala = saldoEstoque(i.produto, armazem);
      const daSala = Math.min(naSala, i.qtd);
      const medioSala = custoMedio(i.produto, armazem);
      let valor = Math.round(daSala * medioSala * 100) / 100;
      let resta = Math.round((i.qtd - daSala) * 1000) / 1000;
      if (resta > 0.0001) {
        const un = saldoNaUnidade(i.produto, armazem);
        const fontes = D.comSetores(un.pai).filter(function (am) {
          return am !== armazem && saldoEstoque(i.produto, am) > 0;
        });
        for (let j = 0; j < fontes.length && resta > 0.0001; j++) {
          const disp = saldoEstoque(i.produto, fontes[j]);
          const leva = Math.min(disp, resta);
          valor = Math.round((valor + leva * custoMedio(i.produto, fontes[j])) * 100) / 100;
          resta = Math.round((resta - leva) * 1000) / 1000;
        }
      }
      total = Math.round((total + valor) * 100) / 100;
      partes.push({ produto: i.produto, qtd: i.qtd, valor: valor });
    });
    return { total: total, partes: partes };
  }

  function procedimentosComPlantao(f) {
    /* Imposto recalculado com a alíquota de agora, inclusive no que já
       foi lançado. */
    const linhas = listarProcedimentos(f).map(function (p) {
      /* A alíquota é a do centro do procedimento, não a do mutirão. */
      const d = detalharImposto(p.faturamento, p.centro);
      if (Math.abs(d.total - p.imposto) < 0.005 &&
          p.imposto_pct === impostoProcedimentos(p.centro)) return p;
      const o = Object.assign({}, p);
      o.imposto = d.total;
      o.imposto_pct = impostoProcedimentos(p.centro);
      o.imposto_detalhe = d.partes;
      o.imposto_recalculado = true;
      o.resultado = Math.round((o.faturamento - o.imposto - o.custo) * 100) / 100;
      o.margem = o.faturamento > 0
        ? Math.round(o.resultado / o.faturamento * 1000) / 10 : null;
      return o;
    });
    const porDia = {};
    plantoesEstimados(f).forEach(function (d) { porDia[d.chave] = d; });

    /* Base do rateio: soma do faturamento pago por plantão em cada
       médico/dia. Quando tudo no dia fatura zero, divide por igual. */
    /* A base do rateio é o DIA INTEIRO do médico, não o que o filtro
       mostra: com recorte por especialidade, ratear só sobre as linhas
       visíveis devolvia o plantão cheio em cada visão. */
    const base = {};
    const f2 = f || {};
    listarProcedimentos({ competencia: f2.competencia, de: f2.de, ate: f2.ate,
      medico: f2.medico, cancelados: f2.cancelados }).forEach(function (p) {
      if (!p.pago_por_plantao) return;
      const k = chavePlantao(p.data, p.medico);
      base[k] = base[k] || { fat: 0, n: 0 };
      base[k].fat = Math.round((base[k].fat + p.faturamento) * 100) / 100;
      base[k].n++;
    });

    /* A sobra de centavos do rateio vai na última linha de cada
       médico/dia, senão a soma das partes não fecha com o custo do
       plantão. */
    const usado = {}, restam = {};
    const diaInteiroNaVisao = {};
    linhas.forEach(function (p) {
      if (!p.pago_por_plantao) return;
      const k = chavePlantao(p.data, p.medico);
      restam[k] = (restam[k] || 0) + 1;
    });
    Object.keys(restam).forEach(function (k) {
      diaInteiroNaVisao[k] = base[k] && base[k].n === restam[k];
    });

    return linhas.map(function (p) {
      const o = Object.assign({}, p);
      o.custo_plantao = 0;
      if (p.pago_por_plantao) {
        const k = chavePlantao(p.data, p.medico);
        const dia = porDia[k], b = base[k];
        if (dia && b) {
          restam[k]--;
          /* Sobra de centavos só na última linha de um dia que está
             inteiro na visão; recortado, cada linha leva a sua parte
             proporcional e o total exibido fica menor que o plantão —
             que é o certo, porque parte do dia está fora do filtro. */
          if (restam[k] === 0 && diaInteiroNaVisao[k]) {
            o.custo_plantao = Math.round((dia.custo - (usado[k] || 0)) * 100) / 100;
          } else {
            const parte = b.fat > 0 ? (p.faturamento / b.fat) : (1 / b.n);
            o.custo_plantao = Math.round(dia.custo * parte * 100) / 100;
            usado[k] = Math.round(((usado[k] || 0) + o.custo_plantao) * 100) / 100;
          }
        }
      }
      o.custo_total = Math.round((p.custo + o.custo_plantao) * 100) / 100;
      o.resultado_final = Math.round((p.faturamento - p.imposto - o.custo_total) * 100) / 100;
      o.margem_final = p.faturamento > 0
        ? Math.round(o.resultado_final / p.faturamento * 1000) / 10 : null;
      return o;
    });
  }

  /* Previsões do mutirão: cada procedimento lançado atualiza o
     previsto da sua especialidade — faturamento de um lado, repasse
     e plantão do outro. É o mesmo desenho do GHC - HGB (nota única,
     previsão por especialidade), só que aqui o número não é digitado:
     vem do que foi operado.

     Roda a cada movimentação (lançar, editar, cancelar), sempre
     recalculando a competência inteira em vez de somar incrementos —
     assim cancelamento e edição não deixam resíduo. */
  function atualizarPrevisoesProcedimentos(comp) {
    if (!comp) return { ok: true, n: 0 };
    /* Competência já fechada tem número confirmado e, depois do envio,
       autorizado pelo órgão: a previsão automática não escreve por
       cima. Quem precisa mudar refaz o fechamento. */
    const fech = fechamentoProcedimentosDe(D.PATE_CENTRO, comp);
    if (fech && !fech.cancelado) return { ok: true, n: 0, bloqueado_por_fechamento: true };
    const linhas = procedimentosComPlantao({ competencia: comp });
    const porEsp = {};
    D.ESPECIALIDADES_PATE.forEach(function (e) {
      const centro = D.centroDaEspecialidade(e);
      if (centro) porEsp[e] = { centro: centro, faturamento: 0, repasse: 0 };
    });
    linhas.forEach(function (p) {
      const alvo = porEsp[p.especialidade];
      if (!alvo) return;
      alvo.faturamento = Math.round((alvo.faturamento + p.faturamento) * 100) / 100;
      /* Custo do médico: repasse da tabela, ou a parte do plantão que
         cabe naquela cirurgia. */
      alvo.repasse = Math.round((alvo.repasse +
        (p.pago_por_plantao ? (p.custo_plantao || 0) : p.repasse)) * 100) / 100;
    });

    let n = 0;
    Object.keys(porEsp).forEach(function (e) {
      const a = porEsp[e];
      const previsao = st.previsoes.find(function (p) {
        return p.centro === a.centro && p.competencia === comp;
      });
      /* Especialidade sem movimento na competência: só mexe se já
         existir previsão vinda daqui, para zerar o resíduo. */
      if (!a.faturamento && !a.repasse && !(previsao && previsao.origem === 'procedimentos')) return;
      const alvo = previsao || { id: novoId('pv'), centro: a.centro, competencia: comp };
      alvo.faturamento = a.faturamento;
      alvo.repasse = a.repasse;
      alvo.origem = 'procedimentos';
      alvo.observacao = 'Calculado pelos procedimentos lançados';
      alvo.atualizado_em = U.hoje();
      if (!alvo.data) alvo.data = dataPrevista(comp, prazoDe(a.centro, null).dias);
      if (!previsao) st.previsoes.push(alvo);
      n++;
    });
    return { ok: true, n: n, competencia: comp };
  }

  /* ── fechamento do mutirão (integrado do ramo paralelo de QA) ──*/
  const chaveMedico = n => String(n || '').toUpperCase().replace(/\s+/g, ' ').trim();

  const fechamentosProcedimentos = f => st.fechamentosProcedimentos.slice().filter(function (l) {
    f = f || {};
    return (!f.centro || l.centro === f.centro) &&
      (!f.competencia || l.competencia === f.competencia) &&
      (f.cancelados ? true : !l.cancelado);
  }).sort(function (a, b) { return new Date(b.criado_em) - new Date(a.criado_em); });

  const fechamentoProcedimentosDe = (centro, competencia) =>
    fechamentosProcedimentos({ centro: centro || D.PATE_CENTRO, competencia: competencia })[0] || null;

  /* Competência já enviada ao financeiro não recebe mais lançamento.
     Devolve a frase do impedimento, ou null quando está liberada. */

  /* Competência já enviada ao financeiro não recebe mais lançamento.
     Devolve a frase do impedimento, ou null quando está liberada. */
  function travaDeProcedimento(data, centro) {
    if (!data) return null;
    const comp = U.compDe(data);
    /* O procedimento fica no SUBPROJETO da especialidade, e o
       fechamento é do projeto-mãe: olhar só o centro do procedimento
       deixava a trava passar batido. Vale o que estiver mais
       adiantado entre os dois. */
    const alvo = centro || D.PATE_CENTRO;
    const mae = (D.centro(alvo) || {}).especialidade_pate ? D.PATE_CENTRO : null;
    const etapas = [previsaoDe(alvo, comp), mae ? previsaoDe(mae, comp) : null]
      .filter(Boolean).map(etapaDaPrevisao);
    const etapa = ['faturado', 'autorizado', 'liberado'].find(function (e) {
      return etapas.indexOf(e) >= 0;
    });
    if (!etapa) return null;
    return 'O faturamento de ' + U.fComp(comp) + ' já foi enviado ao financeiro' +
      (etapa === 'faturado' ? ' e a nota já saiu' : ' e está autorizado para faturar') +
      '. Para mexer nos lançamentos desta competência, desfaça a autorização em ' +
      'Procedimentos › Fechamento.';
  }

  /* Médico do mutirão é digitado, não é cadastro. Para virar título a
     pagar ele precisa de credor — o mesmo que a produtividade faz ao
     importar o fechamento do PegaPlantão. */
  function garantirCredorMedico(nome) {
    const k = chaveMedico(nome);
    const achado = D.credores.find(function (c) { return chaveMedico(c.nome) === k; });
    if (achado) {
      if (achado.tipo !== 'medico') achado.tipo = 'medico';
      return achado.id;
    }
    const id = novoId('cr');
    D.credores.push({ id: id, nome: String(nome || '').trim(), tipo: 'medico', ativo: true,
      conta_padrao: '3.01' });
    logar('credor', id, 'criou pelo fechamento do mutirão', String(nome || '').trim());
    return id;
  }


  /* O que o fechamento vai levar, sem gravar nada. */
  function resumoFechamentoProcedimentos(competencia, centro) {
    if (!veFinanceiro('procedimentos')) {
      return { erro: 'Seu perfil vê procedimentos, mas não vê valor. O fechamento é do financeiro.' };
    }
    if (!competencia) return { erro: 'Informe a competência.' };
    const alvo = centro || D.PATE_CENTRO;
    const linhas = listarProcedimentos({ competencia: competencia, centro: alvo });
    const som = (arr, k) => Math.round(arr.reduce(function (s2, x) {
      return s2 + (x[k] || 0); }, 0) * 100) / 100;
    const cirurgias = linhas.filter(function (p) { return (p.repasse || 0) > 0; });
    const mapa = {};
    cirurgias.forEach(function (p) {
      const k = chaveMedico(p.medico);
      const m = mapa[k] || (mapa[k] = { medico: p.medico, chave: k, qtd: 0, valor: 0, procedimentos: [] });
      m.qtd += p.qtd || 1;
      m.valor = Math.round((m.valor + (p.repasse || 0)) * 100) / 100;
      m.procedimentos.push(p.id);
    });
    const medicos = Object.keys(mapa).map(function (k) { return mapa[k]; })
      .sort(function (a, b) { return b.valor - a.valor || a.medico.localeCompare(b.medico); });
    const faturamento = som(linhas, 'faturamento');
    const imposto = som(linhas, 'imposto');
    const material = som(linhas, 'custo_material');
    const repasse = som(cirurgias, 'repasse');
    /* Plantão: informativo. Sai do mesmo cálculo do relatório, sem
       filtro de especialidade ou sala — com recorte o rateio do dia
       seria contado mais de uma vez. */
    const rp = resultadoProcedimentos({ competencia: competencia, centro: alvo });
    const plantao = Math.round(((rp.geral || {}).plantao || 0) * 100) / 100;
    const pv = previsaoDe(alvo, competencia);
    return {
      ok: true, competencia: competencia, centro: alvo,
      procedimentos: linhas.length,
      procedimento_ids: linhas.map(function (p) { return p.id; }),
      pagos_por_plantao: linhas.length - cirurgias.length,
      faturamento: faturamento, imposto: imposto, material: material,
      repasse: repasse, plantao: plantao,
      resultado: Math.round((faturamento - imposto - material - repasse - plantao) * 100) / 100,
      medicos: medicos,
      fechamento: fechamentoProcedimentosDe(alvo, competencia),
      /* A etapa olha o FECHAMENTO, não só o status da previsão.
         Uma competência cujo fechamento foi cancelado mas cuja
         previsão ficou em `confirmada_prod` aparecia como "fechado"
         para sempre: o botão oferecido era "Fechar", e fechar era
         recusado em silêncio porque a tela se achava fechada. O mês
         ficava preso, sem caminho de volta.

         Agora, sem fechamento ativo, a competência está aberta —
         qualquer que seja o status que tenha sobrado. A verdade é o
         fechamento; o status é consequência. */
      etapa: etapaCorrigida(alvo, competencia, pv),
      previsao: pv || null
    };
  }

  /* `confirmada_prod` sem fechamento ativo é resíduo, não estado.
     Além de responder certo, conserta o registro: a próxima leitura
     já encontra o status coerente. */
  function etapaCorrigida(centro, competencia, pv) {
    const etapa = etapaDaPrevisao(pv);
    if (etapa !== 'confirmado') return etapa;
    const f = fechamentoProcedimentosDe(centro, competencia);
    if (f && !f.cancelado) return etapa;
    if (pv && pv.status === 'confirmada_prod') {
      pv.status = 'estimada';
      delete pv.confirmado_por;
      delete pv.confirmado_em;
      logar('procedimento', pv.id, 'reabriu a competência',
        U.fComp(competencia) + ' — não há fechamento ativo');
    }
    return 'previsao';
  }

  function fecharProcedimentos(d) {
    if (!pode('fechar_procedimentos')) {
      return { erro: 'Seu perfil não fecha o faturamento dos procedimentos — é a aprovação ' +
        'do módulo.' };
    }
    d = d || {};
    if (!podeMover('procedimentos')) {
      return { erro: 'Seu perfil vê procedimentos, mas não movimenta.' };
    }
    if (!veFinanceiro('procedimentos')) {
      return { erro: 'Seu perfil não vê valor: o fechamento do faturamento é do financeiro.' };
    }
    /* As duas pernas do fechamento são escrita no financeiro. Conferir
       ANTES de gravar qualquer coisa: metade do fechamento feito é
       pior que nenhum. */
    if (!pode('lancar')) {
      return { erro: 'Seu perfil não lança título no financeiro, e o fechamento gera o repasse dos médicos.' };
    }
    if (!pode('faturar') && !pode('lancar') && !pode('produtividade')) {
      return { erro: 'Seu perfil não confirma valor de faturamento.' };
    }
    const alvo = d.centro || D.PATE_CENTRO;
    const comp = d.competencia;
    const res = resumoFechamentoProcedimentos(comp, alvo);
    if (res.erro) return res;
    if (!res.procedimentos) {
      return { erro: 'Não há procedimento lançado em ' + U.fComp(comp) + ' neste projeto.' };
    }
    if (['autorizado', 'liberado', 'faturado'].indexOf(res.etapa) > -1) {
      return { erro: 'O faturamento de ' + U.fComp(comp) + ' já foi enviado ao financeiro. ' +
        'Desfaça a autorização antes de refazer o fechamento.' };
    }
    /* Procedimento já fechado em OUTRO centro: o subprojeto da
       especialidade pertence ao projeto-mãe, então o mesmo
       procedimento é visto pelos dois. Fechar pelos dois caminhos
       criava duas previsões a receber, e a duplicata chegava ao RPS
       como nota emitida na prefeitura. A checagem é pelo
       PROCEDIMENTO, não pelo centro. */
    const jaEmOutro = {};
    st.fechamentosProcedimentos.forEach(function (f) {
      if (f.cancelado || f.competencia !== comp) return;
      if (res.fechamento && f.id === res.fechamento.id) return;
      (f.procedimento_ids || []).forEach(function (pid) {
        if ((res.procedimento_ids || []).indexOf(pid) >= 0) jaEmOutro[f.id] = f;
      });
    });
    const conflito = Object.keys(jaEmOutro).map(function (k) { return jaEmOutro[k]; })[0];
    if (conflito) {
      return { erro: 'Os procedimentos desta competência já estão no fechamento de ' +
        ((D.centro(conflito.centro) || {}).curto || conflito.centro) + ' (' +
        U.brl(conflito.faturamento) + '). Fechar de novo aqui faturaria as mesmas cirurgias duas ' +
        'vezes — cancele aquele fechamento antes, ou feche só por um caminho.',
        ja_fechado_em: conflito.centro, fechamento_conflitante: conflito.id };
    }
    if (res.fechamento && !d.refazer) {
      return { erro: 'Esta competência já foi fechada por ' + res.fechamento.criado_por + ' (' +
        U.brl(res.fechamento.faturamento) + ' a faturar e ' + U.brl(res.fechamento.repasse) +
        ' de repasse). Refaça o fechamento para incorporar o que mudou, ou cancele o anterior.',
        jaFechado: true, fechamento: res.fechamento };
    }
    const venc = d.vencimento_repasse || (U.compDe(U.addMeses(comp + '-01', 1)) + '-10');
    const conta = d.conta_repasse || '3.01';

    /* Refazer não é complemento: o fechamento anterior sai inteiro e
       este entra com o total novo. Senão o médico que ganhou mais uma
       cirurgia depois do 1º fechamento ficaria sem receber a
       diferença — a trava de duplicidade por `origem_ref` pularia ele
       em silêncio. Por isso a referência carrega a geração. */
    if (res.fechamento && d.refazer) {
      const antigas = st.parcelas.filter(function (x) {
        return res.fechamento.titulo_ids.indexOf(x.titulo_id) > -1 && x.status !== 'cancelado'; });
      const pagas = antigas.filter(function (x) { return pagamentosDe(x.id).length > 0; });
      if (pagas.length) {
        return { erro: pagas.length + ' médico(s) do fechamento anterior já receberam. Refazer ' +
          'apagaria um pagamento feito — cancele o fechamento com autorização, ou lance a ' +
          'diferença como complemento.', exigeCancelamento: true };
      }
      /* O cancelamento das antigas fica para DEPOIS de o faturamento
         novo ser confirmado: cancelando antes, qualquer erro adiante
         deixava os médicos sem título nenhum, com o fechamento
         antigo ainda vivo dizendo que havia repasse. */
      var cancelarAntigas = function () {
        antigas.forEach(function (x) {
          cancelar(x.id, 'fechamento do mutirão refeito em ' + U.fData(U.hoje()), true); });
      };
    }
    const geracao = fechamentosProcedimentos({ centro: alvo, competencia: comp, cancelados: true }).length + 1;

    /* Repasse: um título por médico, como no fechamento da
       produtividade — é o que permite bloquear e liberar um médico
       sem segurar os outros. `origem_ref` impede o mesmo médico ser
       lançado duas vezes na mesma competência. */
    const titulos = [];
    const avisos = [];
    let valorRepasse = 0;
    res.medicos.forEach(function (m) {
      const credor = garantirCredorMedico(m.medico);
      const r = criarTitulo({
        descricao: 'Repasse do mutirão ' + U.fComp(comp) + ' — ' + m.qtd +
          (m.qtd > 1 ? ' cirurgias' : ' cirurgia'),
        documento: d.documento || ('MUT-' + comp),
        tipo_titulo: 'medicao', credor: credor, conta: conta, centro: alvo,
        emissao: U.hoje(), origem: 'procedimentos',
        origem_ref: ['procedimentos', alvo, comp, m.chave, 'g' + geracao].join('|'),
        obs: 'Fechamento dos procedimentos do mutirão · ' + m.qtd + ' cirurgia(s) · ' +
          m.procedimentos.join(', ')
      }, [{ num: 1, venc: venc, comp: comp, valor: m.valor }]);
      if (r.ok) {
        titulos.push(r.titulo.id);
        valorRepasse = Math.round((valorRepasse + m.valor) * 100) / 100;
      } else if (r.duplicado) {
        avisos.push(m.medico + ': repasse já lançado nesta competência, mantido o título anterior.');
      } else {
        avisos.push(m.medico + ': ' + r.erro);
      }
    });

    /* Faturamento pelo mesmo caminho da produtividade: vira previsão
       confirmada e título previsto no contas a receber. */
    const cf = confirmarFaturamentoProdutividade({
      centro: alvo, competencia: comp,
      faturamento: res.faturamento,
      produtividade: res.repasse,
      forcar: !!(res.fechamento && d.refazer),
      observacao: 'Fechamento dos procedimentos do mutirão · ' + res.procedimentos +
        ' lançamento(s) · ' + res.medicos.length + ' médico(s) com repasse por cirurgia'
    });
    if (!cf.erro && typeof cancelarAntigas === 'function') cancelarAntigas();
    if (cf.erro) {
      /* Fechamento é um gesto só: se o faturamento não pôde ser
         confirmado, o repasse que acabou de entrar volta atrás. Meio
         fechamento gravado é pior que nenhum — é o médico com título
         a pagar de um faturamento que ninguém confirmou. */
      titulos.forEach(function (tid) {
        st.parcelas.filter(function (x) { return x.titulo_id === tid && x.status !== 'cancelado'; })
          .forEach(function (x) {
            cancelar(x.id, 'fechamento do mutirão desfeito: ' + cf.erro, true); });
      });
      return { erro: 'O faturamento não pôde ser confirmado, então o repasse foi desfeito: ' + cf.erro,
        desfeito: true };
    }

    const f = {
      id: novoId('fp'), centro: alvo, competencia: comp,
      faturamento: res.faturamento, imposto: res.imposto, material: res.material,
      repasse: valorRepasse, plantao: res.plantao, resultado: res.resultado,
      procedimentos: res.procedimentos, procedimento_ids: res.procedimento_ids,
      medicos: res.medicos.length, titulo_ids: titulos,
      vencimento_repasse: venc, conta_repasse: conta,
      previsao_id: cf.previsao ? cf.previsao.id : null,
      receber_id: cf.receber ? cf.receber.id : null,
      observacao: d.observacao || '',
      criado_por: usuario().nome, criado_por_id: (usuario() || {}).id || null,
      criado_em: new Date(), cancelado: false, enviado_em: null
    };
    /* Refazer substitui o anterior: dois fechamentos vivos na mesma
       competência somariam duas vezes na lista. */
    if (res.fechamento && d.refazer) {
      res.fechamento.cancelado = true;
      res.fechamento.motivo_cancelamento = 'refeito pelo fechamento ' + f.id;
      res.fechamento.cancelado_em = U.hoje();
      res.fechamento.cancelado_por = usuario().nome;
      f.refaz = res.fechamento.id;
    }
    st.fechamentosProcedimentos.push(f);
    logar('procedimento', f.id, 'fechou faturamento e repasse do mutirão',
      U.fComp(comp) + ' · faturar ' + U.brl(f.faturamento) + ' · repasse ' + U.brl(f.repasse) +
      ' em ' + titulos.length + ' médico(s)');
    return { ok: true, fechamento: f, previsao: cf.previsao, receber: cf.receber,
      titulo_ids: titulos, avisos: avisos };
  }

  /* Envia ao financeiro: registra a autorização do órgão e libera para
     faturar — daí em diante a competência trava. */

  /* Envia ao financeiro: registra a autorização do órgão e libera para
     faturar — daí em diante a competência trava. */
  function enviarFaturamentoProcedimentos(competencia, centro, d) {
    if (typeof competencia !== 'string' || !/^\d{4}-\d{2}$/.test(competencia)) {
      return { erro: 'Competência inválida (' + JSON.stringify(competencia) + ').' };
    }
    /* Única escrita do módulo sem guarda: o perfil que não lança
       procedimento gravava o protocolo da autorização do órgão em
       nome dele, liberava para faturar e travava a competência. */
    if (!podeMover('procedimentos')) {
      return { erro: 'Seu perfil não movimenta procedimentos.' };
    }
    const alvo = centro || D.PATE_CENTRO;
    const f = fechamentoProcedimentosDe(alvo, competencia);
    if (!f) {
      return { erro: 'Feche o faturamento e o repasse de ' + U.fComp(competencia) +
        ' antes de enviar a autorização ao financeiro.' };
    }
    const r = autorizarFaturamento(alvo, competencia, d || {});
    if (r.erro) return r;
    f.enviado_em = U.hoje();
    f.enviado_por = usuario().nome;
    f.autorizacao_protocolo = (d || {}).protocolo || '';
    logar('procedimento', f.id, 'enviou o faturamento do mutirão ao financeiro',
      U.fComp(competencia) + ' · ' + U.brl(f.faturamento) +
      ((d || {}).protocolo ? ' · ' + d.protocolo : ''));
    return { ok: true, fechamento: f, previsao: r.previsao };
  }

  function cancelarFechamentoProcedimentos(id, motivo, forcar) {
    const f = st.fechamentosProcedimentos.find(function (x) { return x.id === id; });
    if (!f) return { erro: 'Fechamento não encontrado.' };
    if (f.cancelado) return { erro: 'Este fechamento já foi cancelado.' };
    if (!motivo) return { erro: 'Informe o motivo do cancelamento.' };
    const parcelas = st.parcelas.filter(function (p) {
      return f.titulo_ids.indexOf(p.titulo_id) > -1 && p.status !== 'cancelado'; });
    const jaPagas = parcelas.filter(function (p) { return pagamentosDe(p.id).length > 0; });
    if (jaPagas.length && !forcar) {
      return { erro: jaPagas.length + ' médico(s) deste fechamento já receberam. Cancelar a partir ' +
        'daí precisa de autorização, e os valores pagos viram correção manual.', exigeForcar: true };
    }
    if (!pode('cancelar') && !pode('lancar')) {
      return { erro: 'Seu perfil não cancela fechamento.' };
    }
    if (f.enviado_em) {
      const des = desfazerEtapaFaturamento(f.centro, f.competencia, 'liberado', motivo);
      if (des.erro) return { erro: 'Desfaça a liberação do faturamento antes: ' + des.erro };
      const des2 = desfazerEtapaFaturamento(f.centro, f.competencia, 'autorizado', motivo);
      if (des2.erro) return { erro: 'Desfaça a autorização antes: ' + des2.erro };
    }
    parcelas.forEach(function (p) { cancelar(p.id, motivo, true); });
    f.cancelado = true;
    f.motivo_cancelamento = motivo;
    f.cancelado_em = U.hoje();
    f.cancelado_por = usuario().nome;
    /* A SITUAÇÃO volta junto. Cancelar o fechamento desfazia tudo
       menos o status da previsão, e a tela seguia dizendo "fechado"
       com os botões já oferecendo fechar de novo — dois textos
       contando histórias diferentes sobre o mesmo mês.

       `confirmada_prod` é o que faz a etapa ser "fechado"; voltar
       para `estimada` devolve a competência ao estado de antes. */
    const pvs = st.previsoes.filter(function (pv) {
      return pv.competencia === f.competencia && pv.status === 'confirmada_prod';
    });
    pvs.forEach(function (pv) {
      pv.status = 'estimada';
      delete pv.confirmado_por;
      delete pv.confirmado_em;
    });
    logar('procedimento', f.id, 'cancelou o fechamento do mutirão',
      U.fComp(f.competencia) + ' · ' + motivo);
    return { ok: true, fechamento: f, parcelas_canceladas: parcelas.length,
      previsoes_reabertas: pvs.length };
  }

  /* Quais centros um fechamento abrange. Pedindo o projeto-mãe do
     mutirão, entram ele e os subprojetos por especialidade; pedindo
     um subprojeto, só ele. */
  function centrosDoFechamento(centro) {
    if (!centro) return [];
    if (centro !== D.PATE_CENTRO) return [centro];
    return [centro].concat(D.centros
      .filter(function (c) { return c.especialidade_pate; })
      .map(function (c) { return c.id; }));
  }

  function listarProcedimentos(f) {
    f = f || {};
    return st.procedimentos.filter(function (p) {
      return (!f.competencia || p.competencia === f.competencia) &&
        (!f.de || p.data >= f.de) && (!f.ate || p.data <= f.ate) &&
        (!f.especialidade || p.especialidade === f.especialidade) &&
        (!f.medico || (p.medico || '').toUpperCase().indexOf(f.medico.toUpperCase()) >= 0) &&
        (!f.armazem || p.armazem === f.armazem) &&
        /* Filtro por CENTRO: o resumo do fechamento já o passava, mas
           aqui ele era ignorado — então cada subprojeto do mutirão
           enxergava os procedimentos de todos, e fechar em três
           subprojetos gerava três vezes o mesmo faturamento. O centro
           pedido inclui os subprojetos quando é o projeto-mãe: é uma
           nota só, com o resultado quebrado por especialidade. */
        (!f.centro || centrosDoFechamento(f.centro).indexOf(p.centro) >= 0) &&
        (!f.procedimento || p.procedimento === f.procedimento) &&
        (!f.busca || ((p.paciente || '') + ' ' + (p.medico || '') + ' ' + p.procedimento_nome)
          .toUpperCase().indexOf(f.busca.toUpperCase()) >= 0) &&
        (f.cancelados ? true : !p.cancelado);
    }).sort(function (a, b) { return b.data.localeCompare(a.data) || b.id.localeCompare(a.id); });
  }

  /* Resultado agrupado. A mesma soma serve para geral, especialidade,
     setor, médico e procedimento — muda só a chave. */
  function resultadoProcedimentos(f) {
    f = f || {};
    /* Com o plantão rateado: o médico sem repasse na tabela custa
       igual, só que por turno em vez de por cirurgia. */
    const linhas = procedimentosComPlantao(f);
    const zero = () => ({ qtd: 0, faturamento: 0, repasse: 0, material: 0, imposto: 0,
      plantao: 0, custo: 0, resultado: 0 });
    const somar = (alvo, p) => {
      alvo.qtd += p.qtd || 1;
      ['faturamento', 'repasse', 'imposto'].forEach(function (k) {
        alvo[k] = Math.round((alvo[k] + (p[k] || 0)) * 100) / 100;
      });
      alvo.material = Math.round((alvo.material + (p.custo_material || 0)) * 100) / 100;
      alvo.plantao = Math.round((alvo.plantao + (p.custo_plantao || 0)) * 100) / 100;
      alvo.custo = Math.round((alvo.custo + (p.custo_total !== undefined ? p.custo_total : p.custo)) * 100) / 100;
      alvo.resultado = Math.round((alvo.resultado +
        (p.resultado_final !== undefined ? p.resultado_final : p.resultado)) * 100) / 100;
      return alvo;
    };
    const porChave = fn => {
      const m = {};
      linhas.forEach(function (p) {
        const k = fn(p) || '—';
        m[k] = somar(m[k] || zero(), p);
      });
      return Object.keys(m).sort().map(function (k) {
        const v = m[k];
        v.chave = k;
        v.margem = v.faturamento > 0 ? Math.round(v.resultado / v.faturamento * 1000) / 10 : null;
        return v;
      }).sort(function (a, b) { return b.resultado - a.resultado; });
    };
    const geral = linhas.reduce(function (t, p) { return somar(t, p); }, zero());
    geral.margem = geral.faturamento > 0
      ? Math.round(geral.resultado / geral.faturamento * 1000) / 10 : null;
    geral.cirurgias = linhas.filter(function (p) { return p.tipo === 'cirurgia'; }).length;
    geral.diarias = linhas.filter(function (p) { return p.tipo === 'diaria'; }).length;
    geral.medicos = new Set(linhas.map(function (p) { return p.medico; })).size;
    /* Plantões do período. Quando o fechamento do PegaPlantão já
       entrou, o custo aqui é o realizado — a estimativa fica ao lado,
       só para conferir. */
    const plantoes = plantoesVisiveis(f);
    geral.plantoes = Math.round(plantoes.reduce(function (s2, d) { return s2 + d.plantoes; }, 0) * 10) / 10;
    geral.plantoes_ajustados = plantoes.filter(function (d) { return d.ajustado; }).length;
    geral.plantao_estimado = Math.round(plantoes.reduce(function (s2, d) {
      return s2 + (d.custo_estimado || 0); }, 0) * 100) / 100;

    const real = f.competencia ? plantaoRealizado(f.competencia) : null;
    geral.plantao_origem = real ? 'realizado' : 'estimado';
    /* Médico que operou e não está no fechamento: sai da conta e vira
       aviso, em vez de somar estimativa por cima do realizado. */
    geral.medicos_sem_fechamento = plantoes.medicos_sem_fechamento || [];
    geral.plantao_arquivos = real ? real.arquivos : '';
    geral.plantao_diferenca = real
      ? Math.round((geral.plantao - geral.plantao_estimado) * 100) / 100 : 0;

    /* Médico que está no fechamento mas não lançou procedimento: o
       custo dele é real e não tem cirurgia onde ser rateado. Some do
       resultado se ninguém avisar — então entra como não alocado. */
    if (real) {
      const comProc = {};
      plantoes.forEach(function (d) { comProc[U.slug(d.medico)] = true; });
      const orfaos = Object.keys(real.por_medico)
        .filter(function (k) { return !comProc[k]; })
        .map(function (k) { return real.por_medico[k]; });
      geral.plantao_nao_alocado = Math.round(orfaos.reduce(function (s2, m) {
        return s2 + m.valor; }, 0) * 100) / 100;
      geral.medicos_sem_procedimento = orfaos.map(function (m) { return m.medico; });
      if (geral.plantao_nao_alocado) {
        geral.custo = Math.round((geral.custo + geral.plantao_nao_alocado) * 100) / 100;
        geral.resultado = Math.round((geral.resultado - geral.plantao_nao_alocado) * 100) / 100;
        geral.margem = geral.faturamento > 0
          ? Math.round(geral.resultado / geral.faturamento * 1000) / 10 : null;
      }
    } else {
      geral.plantao_nao_alocado = 0;
      geral.medicos_sem_procedimento = [];
    }
    return {
      geral: geral, linhas: linhas, plantoes: plantoes, realizado: real,
      por_especialidade: porChave(function (p) { return p.especialidade; }),
      por_setor: porChave(function (p) { return p.setor; }),
      por_medico: porChave(function (p) { return p.medico; }),
      por_procedimento: porChave(function (p) { return p.procedimento_nome; })
    };
  }

  /* O médico do mutirão não é cadastro: o operador digita o nome. Para
     o repasse virar título, ele precisa de um credor — criado uma vez
     por nome, SEM dados bancários, que o financeiro completa antes de
     pagar. Reaproveita pelo nome normalizado, senão cada grafia vira
     um credor novo. */
  function credorMedicoMutirao(nome) {
    const chave = U.slug(nome);
    let cr = D.credores.find(function (c) {
      return c.origem === 'procedimentos' && U.slug(c.nome) === chave;
    });
    if (!cr) {
      cr = { id: novoId('cr'), ativo: true, nome: nome, tipo: 'medico',
        conta_padrao: '8.01', origem: 'procedimentos',
        /* Sem PIX e sem conta: o pagamento não sai enquanto o
           financeiro não completar, que é o comportamento certo. */
        forma_pagamento: '', documento: '', pix: '', dados_aprovados: false };
      D.credores.push(cr);
      logar('credor', cr.id, 'criou', 'Médico do mutirão — dados bancários pendentes');
    }
    return cr;
  }

  /* Do módulo para o financeiro: uma receita com o faturamento da
     competência e um título a pagar por médico com o repasse dele. O
     material não entra aqui — já virou custo na baixa do estoque, e
     lançar de novo contaria em dobro. */
  /* OBSOLETO desde a integração do fechamento: havia dois caminhos
     para o mesmo dinheiro (este, por competência, e a aba Fechamento,
     com rito de fechar/enviar/cancelar e trava de autorização), e os
     dois criavam recebível e títulos de repasse — gerar pelos dois
     pagaria o médico duas vezes. Fica recusando e apontando o caminho
     que vale, em vez de sumir: há tela e teste que ainda chamam. */
  function gerarFinanceiroProcedimentos(comp, d) {
    return { erro: 'Use Procedimentos › Fechamento: ele confirma a previsão, cria o título a ' +
      'receber e gera o repasse por médico, com trava depois da autorização do órgão.',
      use_fechamento: true };
  }

  function gerarFinanceiroProcedimentosAntigo(comp, d) {
    d = d || {};
    if (!veFinanceiro('procedimentos') || !podeMover('financeiro')) {
      return { erro: 'Gerar receita e repasse no financeiro exige acesso financeiro em ' +
        'Procedimentos e movimentação em Financeiro.' };
    }
    if (!comp) return { erro: 'Escolha a competência.' };
    const linhas = listarProcedimentos({ competencia: comp })
      .filter(function (p) { return !p.financeiro; });
    if (!linhas.length) return { erro: 'Nenhum procedimento pendente nesta competência.' };

    const faturamento = Math.round(linhas.reduce(function (s, p) {
      return s + (p.faturamento || 0); }, 0) * 100) / 100;
    const porMedico = {};
    linhas.forEach(function (p) {
      if (!p.repasse) return;
      porMedico[p.medico] = Math.round(((porMedico[p.medico] || 0) + p.repasse) * 100) / 100;
    });

    const criados = { receber: null, titulos: [] };

    if (faturamento > 0) {
      const r = criarReceber({
        numero: 'PATE-' + comp, emissao: U.hoje(), centro: D.PATE_CENTRO, competencia: comp,
        valor_bruto: faturamento, cliente_nome: d.cliente_nome || 'GHC — HGB',
        discriminacao: 'Procedimentos do mutirão — competência ' + comp,
        origem: 'procedimentos', forcar_sem_liberacao: true
      });
      if (r.erro) return { erro: 'Faturamento: ' + r.erro };
      criados.receber = (r.receber || {}).id || null;
    }

    /* Repasse: um título por médico, com o nome no histórico. Eles não
       são credores cadastrados, então o título vai como avulso — o
       financeiro completa os dados bancários na hora de pagar. */
    const falhas = [];
    Object.keys(porMedico).forEach(function (nome) {
      const cr = credorMedicoMutirao(nome);
      const t = criarTitulo({
        descricao: 'Repasse mutirão HGB — ' + nome + ' (' + comp + ')',
        documento: 'PATE-' + comp + '-' + U.slug(nome).slice(0, 12).toUpperCase(),
        tipo_titulo: 'rpa', credor: cr.id,
        conta: d.conta || '8.01', centro: D.PATE_CENTRO, emissao: U.hoje(),
        origem: 'procedimentos'
      }, [{ num: 1, venc: d.vencimento || U.addDias(U.hoje(), 10), comp: comp,
            valor: porMedico[nome] }]);
      if (t.ok) criados.titulos.push({ medico: nome, titulo: t.titulo.id, valor: porMedico[nome] });
      else falhas.push(nome + ': ' + t.erro);
    });
    /* Repasse que não virou título é dinheiro que ninguém vai pagar:
       avisa em vez de sumir. */
    if (falhas.length) criados.falhas = falhas;

    const marca = 'gerado em ' + U.fData(U.hoje());
    linhas.forEach(function (p) { p.financeiro = marca; });
    logar('procedimento', comp, 'gerou financeiro',
      linhas.length + ' procedimento(s), faturamento ' + U.brl(faturamento) +
      ', ' + criados.titulos.length + ' repasse(s)');
    return { ok: true, competencia: comp, procedimentos: linhas.length,
      faturamento: faturamento, criados: criados,
      aviso: criados.falhas
        ? 'Não foi possível gerar o título de: ' + criados.falhas.join('; ')
        : (criados.titulos.length
          ? 'Os médicos entraram como credores sem dados bancários — complete o PIX antes de pagar.'
          : null) };
  }

  function registrarPagamento(pid, d) {
    if (!pode('pagar')) return { erro: 'Seu perfil não registra pagamento.' };
    const p = st.parcelas.find(x => x.id === pid);
    if (!p) return { erro: 'Parcela não encontrada.' };
    if (p.status === 'cancelado') return { erro: 'Parcela cancelada não recebe pagamento.' };
    if (p.aprovacao !== 'aprovado') return { erro: 'Parcela ainda não aprovada — pagamento bloqueado.' };
    /* Duas travas da produtividade: o fechamento precisa estar
       CONFIRMADO pela gestão (antes disso o valor ainda é de trabalho),
       e o médico não pode estar com pagamento bloqueado. */
    if (p.bloqueio_pagamento) {
      return { erro: 'Pagamento deste médico está bloqueado pela produtividade' +
        (p.bloqueio_pagamento.motivo ? ' (' + p.bloqueio_pagamento.motivo + ')' : '') +
        '. A liberação é na aba de lançamentos da produtividade.' };
    }
    const tit = st.titulos.find(function (t) { return t.id === p.titulo_id; });
    if (tit && tit.origem === 'produtividade') {
      const lote = st.lotesProdutividade.find(function (l) {
        return !l.cancelado && (l.titulo_ids || []).indexOf(tit.id) > -1; });
      if (lote && !lote.confirmado_em) {
        return { erro: 'O fechamento de produtividade de ' + U.fComp(lote.competencia) +
          ' ainda não foi confirmado pela gestão. Enquanto não confirmarem, o valor não vai para pagamento.' };
      }
    }
    if (emCursoDe(pid).length && !d.situacao) {
      return { erro: 'Esta parcela já tem pagamento em andamento.' };
    }
    if (!d.data) return { erro: 'Informe a data do pagamento.' };
    /* As mesmas checagens que o recebimento já fazia: formato e data
       anterior à emissão da nota. Sem elas, `compDe('abacaxi')`
       devolvia 'abacaxi' e a linha ia para o DRE num ano inexistente. */
    if (!dataExiste(String(d.data))) {
      return { erro: 'Data de pagamento inválida (' + d.data + ').' };
    }
    /* Pagamento anterior à emissão não é barrado: adiantamento a
       fornecedor existe, e a nota lançada depois do extrato é rotina
       na conciliação. Mas fica registrado no título, porque diferença
       grande costuma ser data digitada errada. */
    const parcelaAlvo = parcela(pid);
    const tituloDaParcela = parcelaAlvo
      ? st.titulos.find(function (x) { return x.id === parcelaAlvo.titulo_id; }) : null;
    /* Previsão não tem credor: pagá-la é liquidar dinheiro para
       ninguém. O que se paga é o título real que a substitui. */
    if (tituloDaParcela && !tituloDaParcela.credor) {
      return { erro: 'Este lançamento é uma previsão, sem fornecedor definido — não se paga ' +
        'previsão. Lance a nota real e pague o título dela.' };
    }
    const antesDaEmissao = tituloDaParcela && tituloDaParcela.emissao &&
      d.data < tituloDaParcela.emissao
      ? 'Pago em ' + U.fData(d.data) + ', antes da emissão da nota (' +
        U.fData(tituloDaParcela.emissao) + ')'
      : null;
    /* Nenhum dos quatro pode ser negativo. O desconto negativo
       compensava o principal a maior e furava a trava de saldo: um
       título de R$ 1.000 saía do banco por R$ 1.500 e a parcela ainda
       fechava como paga. */
    const neg = ['valor', 'juros', 'multa', 'desconto'].filter(function (k) {
      return d[k] !== undefined && d[k] !== null && d[k] !== '' && Number(d[k]) < 0;
    });
    if (neg.length) {
      return { erro: 'Valor, juros, multa e desconto não podem ser negativos (' +
        neg.join(', ') + ').' };
    }
    if (['valor', 'juros', 'multa', 'desconto'].some(function (k) {
      return d[k] !== undefined && d[k] !== null && d[k] !== '' && !isFinite(Number(d[k]));
    })) {
      return { erro: 'Valor, juros, multa ou desconto com número inválido.' };
    }
    /* Pagar com a conta de outra empresa é decisão, não digitação: o
       sistema avisa e só segue com confirmação — e aí registra o
       vínculo entre as empresas. */
    const cruz = d.banco ? pagamentoCruzado(pid, d.banco) : null;
    if (cruz) cruz.origem = d.origem_cruzamento || 'baixa';
    if (cruz && !d.confirmar_cruzamento) {
      return { erro: 'Esta nota está em nome da ' + cruz.tomadora_nome + ' e o pagamento sairia da conta ' +
        'da ' + cruz.pagadora_nome + '. Isso é conta corrente entre as empresas, não classificação de ' +
        'custo. Confirme se é isso mesmo.', cruzamento: cruz };
    }
    /* F4 — "realizado" quer dizer que já saiu do banco: só quando a
       situação é "liquidado" isso não pode ser no futuro. A condição
       estava invertida (`!== 'liquidado'`), então travava exatamente o
       caso comum — solicitar pagamento para a data de vencimento, no
       futuro — e deixava passar uma baixa liquidada com data futura,
       que é o caso que realmente não faz sentido. */
    if (d.data > U.hoje() && (d.situacao || 'aguardando') === 'liquidado') {
      return { erro: 'Data de pagamento no futuro (' + U.fData(d.data) + ') não é compatível com "já ' +
        'liquidado" — esse status é só para o que já saiu do banco. Solicite o pagamento (situação ' +
        '"aguardando") se ainda não saiu.' };
    }
    if (!d.banco) return { erro: 'Informe a conta bancária de saída.' };
    const situacaoPedida = d.situacao || 'aguardando';
    if (situacaoPedida === 'aguardando' && st.parametros.exigir_anexo && !p.arquivo) {
      return { erro: 'Parâmetro de administração exige nota anexada antes de pagar. ' +
        'Anexe o documento no lançamento.' };
    }
    /* Cadastro incompleto NÃO barra mais o pedido nem a aprovação: a
       trava passou para a geração da remessa, que é o único momento em
       que os dados bancários fazem falta de verdade. O motivo é
       prático: o código de barras do boleto vence. Se a pessoa digita
       antes de aprovar e a aprovação demora, ela digita de novo no dia
       seguinte. Agora o boleto entra no fluxo, é aprovado, e o código
       de barras é informado uma única vez, já com a aprovação na mão. */
    const valor = Math.round((d.valor || 0) * 100) / 100;
    const desconto = Math.round((d.desconto || 0) * 100) / 100;
    if (valor + desconto <= 0) return { erro: 'Informe o valor pago.' };
    /* F2 — o teste correto é principal + desconto <= saldo: desconto
       quita parte da dívida sem sair do caixa. O que estava ruim era a
       TELA, que prefixava valor = saldo e não descontava nada quando o
       usuário digitava desconto; agora ela ajusta sozinha. */
    if (valor + desconto > saldoDe(p) + 0.004) {
      return { erro: 'Principal (' + U.brl(valor) + ') mais desconto (' + U.brl(desconto) +
        ') passa do saldo da parcela (' + U.brl(saldoDe(p)) + '). Com desconto, o valor pago é o saldo menos o desconto.' };
    }
    const situacao = situacaoPedida;

    st.pagamentos.push({
      id: novoId('pg'), parcela_id: pid, data: d.data, valor,
      /* Empresa que pagou (vem da conta) e, quando é pagamento cruzado,
         o vínculo entre as duas — é o que alimenta a conta corrente
         entre empresas. */
      empresa: d.banco ? empresaDaConta(d.banco) : null,
      cruzamento: cruz || null,
      aviso_data: antesDaEmissao,
      usuario_id: (usuario() || {}).id || null,
      juros: Math.round((d.juros || 0) * 100) / 100,
      multa: Math.round((d.multa || 0) * 100) / 100,
      desconto, banco: d.banco, doc: d.doc, obs: d.obs,
      forma: d.forma || ((formaDoCredor(p.credor) || {}).nome) || '',
      forma_codigo: (formaDoCredor(p.credor) || {}).codigo || null,
      codigo_barras: p.codigo_barras || null,
      situacao: situacao, estornado: false, usuario: usuario().nome, criado_em: new Date()
    });
    recalcular(pid);
    logar('conta_pagar', pid, situacao === 'liquidado' ? 'pagou' : 'solicitou pagamento',
      U.brl(valor) + ' em ' + U.fData(d.data) + ' · ' + ((D.banco(d.banco) || {}).apelido || ''));
    return { ok: true, status: p.status, situacao: situacao };
  }

  /* Solicitação em lote: é assim que o dia a dia funciona — marcar tudo
     que vence hoje e o que está atrasado e mandar de uma vez. */
  function solicitarLote(ids, d) {
    if (!pode('pagar')) return { erro: 'Seu perfil não solicita pagamento.' };
    if (!d.data) return { erro: 'Informe a data de pagamento.' };
    if (!d.banco) return { erro: 'Informe a conta bancária de saída.' };
    let n = 0, valor = 0, erros = [];
    ids.forEach(function (id) {
      const p = parcela(id);
      if (!p) return;
      const r = registrarPagamento(id, {
        data: d.data, valor: saldoDe(p), juros: 0, multa: 0, desconto: 0,
        banco: d.banco, doc: '', obs: d.obs
      });
      if (r.ok) { n++; valor += saldoDe(p); }
      else erros.push((p.descricao || '') + ': ' + r.erro);
    });
    return { ok: true, n: n, valor: valor, erros: erros };
  }

  /* Antes da aprovação, quem solicitou pode desfazer ou corrigir. */
  function cancelarSolicitacao(pagId) {
    if (Array.isArray(pagId)) {
      let n = 0;
      pagId.forEach(function (id) { if (cancelarSolicitacao(id).ok) n++; });
      return { ok: true, n: n };
    }
    if (!pode('pagar')) return { erro: 'Seu perfil não altera solicitação de pagamento.' };
    const pg = pagamento(pagId);
    if (!pg) return { erro: 'Solicitação não encontrada.' };
    if (pg.situacao !== 'aguardando') {
      return { erro: 'Só dá para desfazer enquanto está aguardando aprovação.' };
    }
    pg.situacao = 'cancelado';
    pg.cancelado_em = new Date();
    recalcular(pg.parcela_id);
    logar('conta_pagar', pg.parcela_id, 'desfez a solicitação de pagamento', U.brl(pg.valor));
    return { ok: true };
  }

  /* ── autorização do pagamento ───────────────────────────
     Quem lança e dá baixa é a mesma pessoa; a diretoria e o sócio
     autorizam a saída. Recusa devolve a parcela ao estado anterior. */
  const pagamentosAguardando = () => st.pagamentos.filter(function (p) {
    return p.situacao === 'aguardando' && !p.estornado;
  });
  const pagamento = id => st.pagamentos.find(function (p) { return p.id === id; }) || null;

  function autorizarPagamento(ids) {
    if (!pode('aprovar')) return { erro: 'Só diretoria ou sócio aprova pagamento.' };

    /* Alçada por valor e segregação de função: o limite é do perfil, e
       quem solicitou o pagamento não é quem aprova. Eram duas lacunas
       apontadas na auditoria. */
    const lista = (Array.isArray(ids) ? ids : [ids]).map(pagamento).filter(function (pg) {
      return pg && pg.situacao === 'aguardando';
    });
    const perfilAtual = (usuario() || {}).perfil;
    if ((st.parametros.sem_aprovacao || []).indexOf(perfilAtual) > -1) {
      return { erro: 'Seu perfil não aprova pagamento — quem lança e solicita não é quem aprova. ' +
        'A aprovação é da diretoria financeira ou dos sócios.' };
    }
    const lim = st.parametros.alcada[perfilAtual] || 0;
    if (lim) {
      const acima = lista.filter(function (pg) { return pg.valor + pg.juros + pg.multa > lim; });
      if (acima.length) {
        return { erro: acima.length + ' pagamento(s) acima da sua alçada de ' + U.brl(lim) +
          ' — o maior é ' + U.brl(Math.max.apply(null, acima.map(function (pg) {
            return pg.valor + pg.juros + pg.multa; }))) + '. Precisa da aprovação do sócio.' };
      }
    }
    if (st.parametros.impedir_autoaprovacao) {
      /* Compara por ID, não por nome: renomear o usuário derrubava a
         segregação, e dois homônimos a derrubavam também. O nome fica
         como reserva para pagamentos antigos, gravados antes de o id
         passar a ser guardado. */
      const eu = usuario() || {};
      const meus = lista.filter(function (pg) {
        return pg.usuario_id ? pg.usuario_id === eu.id : pg.usuario === eu.nome;
      });
      if (meus.length) {
        return { erro: meus.length + ' pagamento(s) foram solicitados por você — quem solicita não ' +
          'aprova. Peça a outro aprovador ou desligue a regra na Administração.' };
      }
    }

    let n = 0;
    (Array.isArray(ids) ? ids : [ids]).forEach(function (id) {
      const pg = pagamento(id);
      if (!pg || pg.situacao !== 'aguardando') return;
      pg.situacao = 'autorizado';
      pg.autorizado_por = usuario().nome;
      pg.autorizado_em = new Date();
      recalcular(pg.parcela_id);
      logar('conta_pagar', pg.parcela_id, 'aprovou pagamento', U.brl(pg.valor) + ' — liberado para a remessa');
      n++;
    });
    return { ok: true, n: n };
  }

  function recusarPagamento(id, motivo) {
    if (!pode('aprovar')) return { erro: 'Só diretoria ou sócio recusa pagamento.' };
    if (!motivo) return { erro: 'Informe o motivo da recusa.' };
    const pg = pagamento(id);
    if (!pg || pg.situacao !== 'aguardando') return { erro: 'Pagamento não está aguardando autorização.' };
    pg.situacao = 'recusado';
    pg.motivo_recusa = motivo;
    pg.recusado_por = usuario().nome;
    pg.recusado_em = new Date();
    recalcular(pg.parcela_id);
    const par = parcela(pg.parcela_id);
    if (par) par.recusa_pagamento = motivo;
    logar('conta_pagar', pg.parcela_id, 'recusou pagamento', motivo);
    return { ok: true };
  }

  /* O arquivo foi gerado: o pagamento fica no banco esperando o retorno. */
  function marcarEnviados(pagIds, remessaId) {
    pagIds.forEach(function (id) {
      const pg = pagamento(id);
      if (!pg || pg.situacao !== 'autorizado') return;
      pg.situacao = 'enviado';
      pg.remessa_id = remessaId;
      pg.enviado_em = new Date();
      recalcular(pg.parcela_id);
    });
  }

  /* Liquidação: o dinheiro saiu. Vem do retorno do banco ou, para o que
     não passa por arquivo (débito em conta, dinheiro), da confirmação
     de quem paga. É AQUI que o saldo abate e o caixa realizado mexe. */
  function liquidar(pagId, d) {
    if (Array.isArray(pagId)) {
      let n = 0, err = null;
      pagId.forEach(function (id) { const r = liquidar(id, d); if (r.ok) n++; else err = r.erro; });
      return n ? { ok: true, n: n } : { erro: err || 'Nada liquidado.' };
    }
    const pg = pagamento(pagId);
    if (!pg) return { erro: 'Pagamento não encontrado.' };
    if (pg.situacao !== 'autorizado' && pg.situacao !== 'enviado') {
      return { erro: 'Só pagamento aprovado ou enviado ao banco pode ser liquidado.' };
    }
    if (!pode('pagar')) return { erro: 'Seu perfil não confirma pagamento.' };
    /* Reconfere o saldo ANTES de liquidar. A trava de concorrência do
       registrarPagamento só vale quando a situação não é informada, e
       a conciliação informa — então uma solicitação antiga podia ser
       liquidada depois de outro pagamento já ter quitado a parcela, e
       a parcela fechava com R$ 2.000 pagos num título de R$ 1.000 e
       saldo negativo. */
    /* A comparação tem de ser entre grandezas iguais, e não era:
       `jaPago` somava só o principal, enquanto o saldo da parcela
       conta principal + desconto; e `esteValor` vinha como o TOTAL
       que saiu do banco (principal + juros + multa − desconto),
       comparado contra o principal da parcela.

       Errava dos dois lados: barrava o pagamento legítimo com juros e
       multa — que é o caminho normal do retorno CNAB e da conciliação,
       justamente os que mandam o total — e deixava passar o pagamento
       a mais quando havia desconto. */
    const parc = parcela(pg.parcela_id);
    if (parc) {
      const jaPago = pagamentosDe(parc.id)
        .filter(function (x) { return x.id !== pg.id && x.situacao === 'liquidado'; })
        .reduce(function (s2, x) { return s2 + x.valor + (x.desconto || 0); }, 0);
      /* O que SAI DO BANCO é valor + juros + multa. O desconto não
         sai: ele abate a dívida (`pagoDe` = valor + desconto), então
         subtraí-lo aqui inflava o principal calculado e todo desconto
         aparecia como excesso — a correção anterior consertou o lado
         dos juros e criou um bloqueio total do outro. */
      const totalPrevisto = Math.round((pg.valor + pg.juros + pg.multa) * 100) / 100;
      const principalDeste = (d && d.valor !== undefined && d.valor !== null && d.valor !== '')
        ? Math.round((pg.valor + (Math.round(Number(d.valor) * 100) / 100 - totalPrevisto)) * 100) / 100
        : pg.valor;
      const excesso = Math.round(
        (jaPago + principalDeste + (pg.desconto || 0) - parc.valor) * 100) / 100;
      if (excesso > 0.02) {
        return { erro: 'Esta parcela já tem ' + U.brl(jaPago) + ' liquidado de ' +
          U.brl(parc.valor) + '. Confirmar mais ' + U.brl(principalDeste) + ' de principal pagaria ' +
          U.brl(excesso) + ' a mais — cancele a solicitação em aberto ou ajuste o valor.' };
      }
    }
    pg.situacao = 'liquidado';
    if (d && d.data) pg.data = d.data;
    /* O valor que a conciliação manda é o total que saiu do banco
       (principal + juros + multa − desconto), não o principal sozinho.
       Sobrescrever `pg.valor` direto com esse total — mantendo juros e
       multa como estavam — contava os dois de novo: a saída batia
       maior que o extrato, e a parcela fechava com saldo negativo.
       Em vez disso, a diferença contra o que já estava previsto entra
       toda no principal; juros, multa e desconto continuam os que já
       tinham sido calculados na autorização. */
    if (d && d.valor !== undefined) {
      /* O desconto NÃO sai do banco (abate a dívida), então não entra
         no total previsto — subtraí-lo aqui jogava o desconto dentro
         do principal e a parcela fechava com saldo negativo. */
      const totalPrevisto = Math.round((pg.valor + pg.juros + pg.multa) * 100) / 100;
      const totalReal = Math.round(d.valor * 100) / 100;
      pg.valor = Math.round((pg.valor + (totalReal - totalPrevisto)) * 100) / 100;
    }
    if (d && d.doc) pg.doc = d.doc;
    pg.liquidado_em = new Date();
    recalcular(pg.parcela_id);
    logar('conta_pagar', pg.parcela_id, 'pagamento liquidado', U.brl(pg.valor) + ' em ' + U.fData(pg.data));
    return { ok: true };
  }

  /* Banco recusou: volta para a fila da remessa com o motivo. */
  function devolverParaRemessa(pagId, motivo) {
    if (!pode('pagar')) return { erro: 'Seu perfil não devolve pagamento para a remessa.' };
    const pg = pagamento(pagId);
    if (!pg) return { erro: 'Pagamento não encontrado.' };
    if (['enviado', 'autorizado'].indexOf(pg.situacao) < 0) {
      return { erro: 'Só pagamento enviado ao banco volta para a fila.' };
    }
    pg.situacao = 'autorizado';
    pg.remessa_id = null;
    pg.ocorrencia_banco = motivo;
    recalcular(pg.parcela_id);
    const par = parcela(pg.parcela_id);
    if (par) par.ocorrencia_banco = motivo;
    logar('conta_pagar', pg.parcela_id, 'recusado pelo banco', motivo);
    return { ok: true };
  }

  /* ── estorno ────────────────────────────────────────────
     Só diretoria/sócio e com motivo. O pagamento não some do
     histórico: fica marcado como estornado. */
  function estornar(pagId, motivo) {
    if (!pode('estornar')) return { erro: 'Só diretoria ou sócio estorna pagamento.' };
    if (!motivo) return { erro: 'Informe o motivo do estorno.' };
    const pg = st.pagamentos.find(x => x.id === pagId);
    if (!pg || pg.estornado) return { erro: 'Pagamento não encontrado ou já estornado.' };
    if (pg.situacao !== 'liquidado') return { erro: 'Só pagamento liquidado é estornado.' };
    pg.estornado = true;
    mudouPagamentos();   // o índice guarda só os não estornados
    pg.motivo_estorno = motivo;
    pg.estornado_por = usuario().nome;
    pg.estornado_em = new Date();
    recalcular(pg.parcela_id);
    /* Solta a linha do extrato que estava amarrada a este pagamento.
       Sem isso o dinheiro voltava para o título (certo), mas a linha
       continuava 'conciliado' e `conciliar` recusava a mesma linha —
       o título ficava aberto e não havia caminho de volta. */
    const soltas = st.linhas.filter(function (l) {
      if (l.situacao !== 'conciliado') return false;
      if (['parcela', 'parcelas', 'pagamento', 'pagar'].indexOf(l.alvo_tipo) < 0) return false;
      const ids = [l.alvo_id].concat(l.alvo_ids || []).filter(Boolean);
      return ids.indexOf(pg.parcela_id) >= 0 || ids.indexOf(pg.id) >= 0;
    });
    soltas.forEach(function (l) {
      /* Linha que quitou VÁRIOS títulos só é solta quando nenhum
         pagamento dela continua vivo — senão o estorno de um soltaria
         a linha que ainda explica os outros. */
      const ids = [l.alvo_id].concat(l.alvo_ids || []).filter(Boolean);
      const aindaVivo = st.pagamentos.some(function (x) {
        return !x.estornado && x.id !== pg.id && x.situacao === 'liquidado' &&
          (ids.indexOf(x.parcela_id) >= 0 || ids.indexOf(x.id) >= 0);
      });
      if (aindaVivo) return;
      l.situacao = 'pendente'; l.alvo_tipo = null; l.alvo_id = null; l.alvo_ids = null;
      l.observacao = ((l.observacao || '') + ' · reaberta pelo estorno de ' + U.fData(U.hoje())).trim();
    });
    logar('conta_pagar', pg.parcela_id, 'estornou', U.brl(pg.valor) + ' — ' + motivo +
      (soltas.length ? ' · ' + soltas.length + ' linha(s) do extrato reabertas' : ''));
    return { ok: true };
  }

  /* ── cancelamento ───────────────────────────────────────
     Bloqueado se já houve saída bancária não estornada. */
  function cancelar(id, motivo, _interno) {
    if (!_interno && !pode('cancelar')) return { erro: 'Só diretoria ou sócio cancela lançamento.' };
    if (!motivo) return { erro: 'Informe o motivo do cancelamento.' };
    const p = st.parcelas.find(x => x.id === id);
    if (!p) return { erro: 'Parcela não encontrada.' };
    if (p.status === 'cancelado') return { erro: 'Parcela já cancelada.' };
    if (pagamentosDe(id).length) {
      return { erro: 'Esta parcela já teve saída do banco. Estorne o pagamento antes de cancelar.' };
    }
    if (emCursoDe(id).length) {
      return { erro: 'Há pagamento em andamento. Desfaça ou recuse a solicitação antes de cancelar.' };
    }
    p.status = 'cancelado';
    p.motivo_cancelamento = motivo;
    p.cancelado_por = usuario().nome;
    p.cancelado_por_id = (usuario() || {}).id || null;
    p.cancelado_em = new Date();
    recalcularTotalTitulo((parcela(id) || {}).titulo_id);
    /* Cancelar uma NF que gerou retenção não pode deixar a retenção
       viva — sem isso, o imposto de uma nota cancelada continuava
       pendente pra sempre (ou, pior, já tinha entrado numa guia
       fechada, e a guia continuava valendo pra recolher imposto de
       nota cancelada). Se ainda não entrou em guia nenhuma, sai da
       fila sozinha. Se já entrou, não dá pra ajustar a guia sozinho
       (ela pode ter outras NFs dentro) — avisa quem cancelou. */
    let avisoGuia = null;
    /* A retenção é da NOTA, não da parcela: cancelar uma parcela de
       três apagava a retenção inteira, e o imposto retido de terceiro
       sumia da fila de recolhimento com a nota ainda viva e saldo a
       pagar ao fornecedor. Só cancela quando NÃO sobrar nenhuma
       parcela viva no título. */
    const sobramParcelas = st.parcelas.some(function (x) {
      return x.titulo_id === p.titulo_id && x.id !== p.id &&
        ['cancelado', 'substituido'].indexOf(x.status) < 0;
    });
    st.retencoesRegistradas.filter(function (r) {
      return r.titulo_id === p.titulo_id && !r.cancelada && !sobramParcelas;
    })
      .forEach(function (r) {
        r.cancelada = true;
        if (r.guia_id) {
          const g = st.guiasRetencao.find(function (x) { return x.id === r.guia_id; });
          avisoGuia = 'Esta NF tinha ' + U.brl(r.valor) + ' de ' + (NOMES_TRIBUTO[r.tributo] || r.tributo) +
            ' já incluído na guia ' + (g ? U.fComp(g.competencia) : '') + ' — revise/ajuste essa guia manualmente ' +
            '(o valor cancelado não sai sozinho de uma guia já fechada).';
        }
      });
    logar('conta_pagar', id, 'cancelou', motivo);
    if (sobramParcelas && !avisoGuia) {
      const pendente = st.retencoesRegistradas.filter(function (r) {
        return r.titulo_id === p.titulo_id && !r.cancelada;
      }).reduce(function (s2, r) { return s2 + r.valor; }, 0);
      if (pendente > 0.004) {
        avisoGuia = 'As retenções desta nota (' + U.brl(pendente) + ') continuam pendentes: ' +
          'a nota segue viva, com parcela a pagar. Se a nota inteira foi cancelada, cancele as ' +
          'outras parcelas também.';
      }
    }
    return { ok: true, aviso_retencao: avisoGuia };
  }

  /* ── lotes de produtividade ──────────────────────────────
     Cada importação de fechamento vira um registro próprio, com a
     lista dos títulos que ela gerou. Sem isso não tem como listar "as
     produtividades já lançadas", nem cancelar um lote inteiro de uma
     vez quando o arquivo errado entrou — cada título ficava solto,
     sem rastro de qual importação o criou. */
  function registrarLoteProdutividade(d) {
    d = d || {};
    if (!Array.isArray(d.titulo_ids) || !d.titulo_ids.length) {
      return { erro: 'Informe os títulos do lote.' };
    }
    /* Era a única função de escrita do sistema sem guarda nenhuma —
       e é a que vira repasse ao médico: quatro perfis sem acesso ao
       módulo gravaram lotes de R$ 97.000 cada. */
    if (!podeMover('produtividade')) {
      return { erro: 'Seu perfil não movimenta produtividade.' };
    }
    const l = {
      id: novoId('lp'), centro: d.centro, competencia: d.competencia,
      arquivo: d.arquivo, periodo: d.periodo || '',
      titulo_ids: d.titulo_ids.slice(), medicos: d.medicos || 0,
      valor: Math.round((d.valor || 0) * 100) / 100,
      criado_por: usuario().nome, criado_por_id: (usuario() || {}).id || null,
      criado_em: new Date(), cancelado: false
    };
    st.lotesProdutividade.push(l);
    logar('produtividade', l.id, 'lançou lote', l.arquivo + ' · ' + l.medicos + ' médico(s) · ' + U.brl(l.valor));
    return l;
  }

  const lotesProdutividade = f => st.lotesProdutividade.slice().filter(function (l) {
    f = f || {};
    return (!f.centro || l.centro === f.centro) && (!f.competencia || l.competencia === f.competencia);
  }).sort(function (a, b) { return new Date(b.criado_em) - new Date(a.criado_em); });

  /* Cobertura por competência: pra cada projeto marcado como
     produtividade, tem ou não tem lote lançado naquele mês. Usado
     tanto pela grade da tela quanto pelo alerta — o alerta é só o
     mesmo cálculo, aplicado à última competência que já devia estar
     fechada. */
  function coberturaProdutividade(competencia, todos) {
    /* `todos` traz TODO projeto ativo, não só os marcados com
       produtividade. A marcação é um cadastro que alguém precisa
       ter feito — e projeto esquecido na marcação simplesmente não
       aparecia nesta tela, que é justamente a que existe para
       encontrar o que falta. Com a lista completa, a ausência fica
       visível em vez de invisível. */
    const projetos = D.centros.filter(function (c) {
      if (!c.ativo || c.tipo !== 'projeto') return false;
      return todos ? true : !!c.produtividade;
    });
    /* Vários lotes no mesmo projeto/competência (fechamento
       complementar) são a regra, não a exceção: a cobertura mostrava só
       o último e escondia o resto. Agora vai a lista e o total. */
    const lancados = {};
    st.lotesProdutividade.filter(function (l) { return l.competencia === competencia && !l.cancelado; })
      .forEach(function (l) { (lancados[l.centro] = lancados[l.centro] || []).push(l); });
    return projetos.map(function (c) {
      const lotes = lancados[c.id] || [];
      return {
        centro: c.id, lote: lotes[0] || null, lotes: lotes,
        /* Se este projeto DEVERIA ter produtividade. Sem isso, a
           lista completa misturaria locação com serviço médico e a
           contagem de "faltando" perderia o sentido. */
        esperado: !!c.produtividade,
        qtd_lotes: lotes.length,
        valor: Math.round(lotes.reduce(function (a2, l) { return a2 + l.valor; }, 0) * 100) / 100,
        medicos: lotes.reduce(function (a2, l) { return a2 + l.medicos; }, 0)
      };
    });
  }

  /* Cobertura de FATURAMENTO — mesma ideia da produtividade: numa
     competência, quais projetos ativos já têm nota (ou fatura) e quais
     ainda não. Também mostra o valor confirmado no fechamento da
     produtividade, que é o que a NF deveria trazer. */
  /* ── RPS em lote (portal da prefeitura) ─────────────────
     Monta a lista do que está LIBERADO para faturar numa competência,
     no formato que o gerador de RPS entende. Cada item vira um RPS; o
     grupo de faturamento vira UM RPS só, somado — que é o que o
     hospital espera receber. */
  /* Sem competência, traz TUDO que está liberado: o que atrasou um mês
     não fica escondido atrás do filtro, e o lote sai de uma vez. */
  function itensParaRPS(competencia) {
    if (!competencia) {
      const comps = {};
      st.previsoes.forEach(function (p) { if (p.liberado_em) comps[p.competencia] = true; });
      return Object.keys(comps).sort().reduce(function (acc, c) {
        return acc.concat(itensParaRPS(c)); }, []);
    }
    const itens = [];
    const gruposFeitos = {};
    coberturaFaturamento(competencia).forEach(function (l) {
      if (l.situacao !== 'liberado') return;
      if (l.grupo) {
        if (gruposFeitos[l.grupo]) return;
        gruposFeitos[l.grupo] = true;
        const base = baseDoGrupo(l.grupo, competencia);
        const liberados = base.itens.filter(function (i) { return i.previsao && i.previsao.liberado_em; });
        if (!liberados.length) return;
        itens.push(montarItemRPS({
          referencia: 'grupo:' + l.grupo, grupo: l.grupo,
          centro: liberados[0].centro, competencia: competencia,
          valor: Math.round(liberados.reduce(function (a, i) {
            return a + (i.confirmado !== null ? i.confirmado : i.previsto); }, 0) * 100) / 100,
          detalhe: liberados.map(function (i) {
            return (i.projeto || {}).curto + ': ' + U.brl(i.confirmado !== null ? i.confirmado : i.previsto);
          }).join(' | ')
        }));
        return;
      }
      itens.push(montarItemRPS({
        referencia: 'centro:' + l.centro, centro: l.centro, competencia: competencia,
        valor: l.confirmado !== null ? l.confirmado : l.previsto, detalhe: ''
      }));
    });
    return itens;
  }

  function montarItemRPS(d) {
    const c = D.centro(d.centro) || {};
    const cli = D.clienteDoCentro(d.centro) || {};
    const pv = previsaoDe(d.centro, d.competencia);
    /* Quem manda nas retenções é o CADASTRO DO CLIENTE: cada tomador
       retém de um jeito, e alguns retêm ISS e outros não. Na falta de
       cadastro, cai para os impostos do projeto — que é como o a
       receber já calculava o líquido. */
    const ret = [];
    const põe = (t, pct) => { if (pct > 0) ret.push({ tributo: t, valor: Math.round(d.valor * pct) / 100 }); };
    if ((cli.retencoes || []).length) {
      cli.retencoes.forEach(function (r) { põe(r.tributo, r.aliquota); });
    } else {
      const imp = c.impostos || {};
      põe('IRRF', imp.irpj); põe('CSLL', imp.csll);
      if (imp.pis_cofins > 0) { põe('PIS', 0.65); põe('COFINS', 3); }
    }
    return {
      referencia: d.referencia, grupo: d.grupo || null, centro: d.centro,
      competencia: d.competencia, data: U.hoje(), quantidade: 1,
      valor: Math.round((d.valor || 0) * 100) / 100,
      retencoes: ret,
      tomador_documento: cli.documento || '', tomador_nome: cli.nome || '',
      tomador_endereco: cli.endereco || '', tomador_numero: cli.numero || '',
      tomador_complemento: cli.complemento || '', tomador_bairro: cli.bairro || '',
      tomador_cidade: cli.cidade || '', tomador_uf: cli.uf || '',
      tomador_cep: cli.cep || '', tomador_ibge: cli.codigo_ibge || '',
      tomador_email: cli.email || '',
      discriminacao: (d.grupo
        ? 'Serviços médicos prestados no ' + d.grupo + ' — competência ' + U.fComp(d.competencia) +
          '. Composição por especialidade: ' + d.detalhe
        : 'Serviços médicos prestados — ' + (c.curto || '') + ' — competência ' + U.fComp(d.competencia)) +
        (pv && pv.autorizacao_protocolo ? '. Autorização: ' + pv.autorizacao_protocolo : '')
    };
  }

  /* Guarda o lote gerado: número inicial e final dos RPS, o que cada um
     cobre e o arquivo enviado. Sem isso não dá pra saber qual NF veio
     de qual RPS quando o retorno chegar. */
  function registrarLoteRPS(d) {
    /* Remessa repetida gera dois arquivos com a mesma numeração no
       portal, e o controle do sequencial é dividido com o Protheus —
       avisa e pede confirmação, como a duplicidade de documento. */
    if (d && d.remessa) {
      const igual = st.lotesRPS.find(function (l) {
        return String(l.remessa) === String(d.remessa) && !l.cancelado;
      });
      if (igual && !d.confirmar_remessa_repetida) {
        return { erro: 'A remessa ' + d.remessa + ' já foi usada no lote ' + igual.id +
          ' (' + (igual.rps || []).length + ' RPS). Dois arquivos com a mesma numeração ' +
          'confundem o portal — confirme se é reenvio do mesmo arquivo, ou use outro número.',
          remessa_repetida: true, lote_anterior: igual.id };
      }
    }
    if (!pode('faturar')) return { erro: 'Seu perfil não emite nota.' };
    const lote = {
      id: novoId('rl'), competencia: d.competencia, remessa: d.remessa,
      arquivo: d.arquivo_nome, gerado_em: U.hoje(), gerado_por: usuario().nome,
      rps: (d.rps || []).map(function (r) { return Object.assign({ nf: null }, r); }),
      total: d.total_servicos, status: 'gerado'
    };
    st.lotesRPS.push(lote);
    logar('conta_receber', lote.id, 'gerou lote de RPS',
      U.fComp(d.competencia) + ' · ' + lote.rps.length + ' RPS · ' + U.brl(d.total_servicos));
    return { ok: true, lote: lote };
  }

  /* Protocolo e situação vindos do web service (o utilitário de envio
     roda fora do navegador e devolve esses dados). Guardar aqui é o que
     permite saber, meses depois, qual arquivo virou quais notas. */
  function registrarProtocoloRPS(loteId, d) {
    if (!pode('faturar')) return { erro: 'Seu perfil não emite nota.' };
    const lote = st.lotesRPS.find(function (l) { return l.id === loteId; });
    if (!lote) return { erro: 'Lote não encontrado.' };
    if (!d.protocolo) return { erro: 'Informe o protocolo devolvido pela prefeitura.' };
    lote.protocolo = d.protocolo;
    lote.situacao_portal = d.situacao || null;
    lote.enviado_em = d.data || U.hoje();
    lote.enviado_por = usuario().nome;
    lote.ambiente = d.ambiente || 'producao';
    if (d.situacao === '2') lote.status = 'com_erro';
    else if (lote.status === 'gerado') lote.status = 'enviado';
    logar('conta_receber', lote.id, 'registrou envio do lote de RPS',
      'protocolo ' + d.protocolo + (d.situacao ? ' · situação ' + d.situacao : '') +
      ' · ' + (lote.ambiente === 'homologacao' ? 'homologação' : 'produção'));
    return { ok: true, lote: lote };
  }

  /* Retorno do portal: para cada RPS, o número da NF-e que ele virou.
     É aqui que o recebível nasce — com o número real da nota. */
  function converterLoteRPS(loteId, numeros) {
    if (!pode('faturar')) return { erro: 'Seu perfil não emite nota.' };
    const lote = st.lotesRPS.find(function (l) { return l.id === loteId; });
    if (!lote) return { erro: 'Lote não encontrado.' };
    const feitos = [];
    const erros = [];
    /* Número devolvido pelo portal que não casa com nenhum RPS do
       lote é ERRO, não silêncio: antes a função devolvia
       `{ok:true, convertidos:0, erros:[]}` para mapa vazio, número
       inexistente, NF em branco e reconversão — quem digitava errado
       via sucesso e nenhuma nota era criada. */
    const mapa = numeros || {};
    Object.keys(mapa).forEach(function (numRps) {
      if (!lote.rps.some(function (r) { return String(r.numero) === String(numRps); })) {
        erros.push('O portal devolveu o RPS ' + numRps + ', que não está neste lote.');
      }
    });
    lote.rps.forEach(function (r) {
      const nf = mapa[r.numero];
      if (nf !== undefined && String(nf).trim() === '') {
        erros.push('RPS ' + r.numero + ': número da NF-e em branco.');
        return;
      }
      if (nf && r.nf) {
        erros.push('RPS ' + r.numero + ' já foi convertido na NF-e ' + r.nf + '.');
        return;
      }
      if (!nf || r.nf) return;
      const ref = String(r.referencia || '');
      const res = ref.indexOf('grupo:') === 0
        ? faturarGrupo({ grupo: ref.slice(6), competencia: lote.competencia, valor: r.valor,
            numero: nf, emissao: U.hoje() })
        : criarReceber({ numero: nf, emissao: U.hoje(), centro: ref.slice(7),
            competencia: lote.competencia, valor_bruto: r.valor,
            cliente_nome: (D.clienteDoCentro(ref.slice(7)) || {}).nome || '',
            origem: 'nota', discriminacao: 'NF-e convertida do RPS ' + r.numero });
      if (res.erro) { erros.push('RPS ' + r.numero + ': ' + res.erro); return; }
      r.nf = nf;
      r.convertido_em = U.hoje();
      feitos.push(nf);
    });
    lote.status = lote.rps.every(function (r) { return r.nf; }) ? 'convertido' : 'parcial';
    if (!feitos.length) {
      return { erro: erros.length ? erros.join(' · ')
        : 'Nenhum número de NF-e foi informado para este lote.',
        convertidos: 0, erros: erros };
    }
    logar('conta_receber', lote.id, 'registrou retorno do lote de RPS',
      feitos.length + ' NF-e · ' + (erros.length ? erros.length + ' com erro' : 'sem erro'));
    return { ok: true, convertidos: feitos.length, erros: erros, lote: lote };
  }

  /* ── faturamento único de vários projetos ───────────────
     O GHC-HGB é uma nota só para 7 especialidades, cada uma com sua
     produtividade lançada em separado. Amarrar a nota a UM projeto
     nunca fecha com o previsto; e exigir uma nota por projeto seria
     inventar documento que o hospital não emite. A solução é o GRUPO
     DE FATURAMENTO: as produtividades continuam separadas (é assim que
     o médico é pago), somam para formar a base, e a nota cobre o grupo,
     rateada entre os projetos na proporção do que cada um confirmou. */
  const grupoDe = centro => {
    const c = D.centro(centro) || {};
    return c.grupo_faturamento || null;
  };
  const projetosDoGrupo = grupo => D.centros
    .filter(function (c) { return c.tipo === 'projeto' && c.grupo_faturamento === grupo; })
    .map(function (c) { return c.id; });

  /* Base do grupo numa competência: soma do que cada projeto confirmou
     (ou, na falta, previu), com a lista para o gestor conferir. */
  function baseDoGrupo(grupo, competencia) {
    const ids = projetosDoGrupo(grupo);
    const itens = ids.map(function (id) {
      const pv = previsaoDe(id, competencia);
      return {
        centro: id, projeto: D.centro(id),
        previsto: pv ? pv.faturamento : 0,
        confirmado: pv && pv.status === 'confirmada_prod' ? pv.faturamento : null,
        etapa: etapaDaPrevisao(pv), previsao: pv || null
      };
    });
    const confirmados = itens.filter(function (i) { return i.confirmado !== null; });
    return {
      grupo: grupo, competencia: competencia, itens: itens,
      projetos: ids.length,
      confirmados: confirmados.length,
      total_previsto: Math.round(itens.reduce(function (a, i) { return a + i.previsto; }, 0) * 100) / 100,
      total_confirmado: Math.round(confirmados.reduce(function (a, i) { return a + i.confirmado; }, 0) * 100) / 100,
      completo: ids.length > 0 && confirmados.length === ids.length
    };
  }

  /* Previsão do GRUPO: o HGB negocia um valor só com o hospital, não um
     por especialidade. O valor entra uma vez e é distribuído entre os
     projetos do grupo — a produtividade continua lançada em cada um, e
     a esteira e a cobertura seguem funcionando por projeto. */
  function salvarPrevisaoGrupo(grupo, competencia, valor, opcoes) {
    opcoes = opcoes || {};
    const ids = projetosDoGrupo(grupo);
    if (!ids.length) return { erro: 'Nenhum projeto neste grupo de faturamento.' };
    /* A distribuição segue o que cada projeto já tem — confirmado da
       produtividade, senão a previsão anterior. Sem base nenhuma,
       divide igual. */
    /* O peso de cada projeto: o que ele já tem previsto no mês, senão a
       média do que faturou nos últimos meses, senão peso igual. Usar só
       a estimativa do cadastro jogava o valor inteiro na única
       especialidade que tinha estimativa preenchida. */
    const base = ids.map(function (id) {
      const pv = previsaoDe(id, competencia);
      if (pv && pv.faturamento > 0) return { id: id, peso: pv.faturamento };
      const historico = st.receber.filter(function (r) {
        return r.centro === id && ['nota', 'fatura'].indexOf(r.origem) > -1 &&
          ['cancelado', 'substituido'].indexOf(r.status) < 0 && r.competencia < competencia;
      }).sort(function (a2, b2) { return String(b2.competencia).localeCompare(String(a2.competencia)); })
        .slice(0, 3);
      if (historico.length) {
        return { id: id, peso: historico.reduce(function (a2, r) { return a2 + r.valor_bruto; }, 0) / historico.length };
      }
      const est = (D.centro(id) || {}).prev_faturamento || 0;
      return { id: id, peso: est, sem_base: !est };
    });
    /* Se algum projeto do grupo ficou sem base, todos entram com peso
       igual: melhor dividir parelho do que concentrar o valor inteiro
       em quem tinha uma estimativa velha no cadastro. */
    if (base.some(function (x) { return x.sem_base; })) {
      base.forEach(function (x) { x.peso = 1; });
    }
    const soma = base.reduce(function (a2, x) { return a2 + x.peso; }, 0);
    let acumulado = 0;
    const partes = base.map(function (x, i) {
      const v = i === base.length - 1
        ? Math.round((valor - acumulado) * 100) / 100
        : Math.round((soma > 0 ? valor * (x.peso / soma) : valor / base.length) * 100) / 100;
      acumulado = Math.round((acumulado + v) * 100) / 100;
      return { centro: x.id, valor: v };
    });
    let n = 0;
    const conflitos = [];
    partes.forEach(function (p) {
      const atual = previsaoDe(p.centro, competencia);
      const r = salvarPrevisao({ centro: p.centro, competencia: competencia, faturamento: p.valor,
        produtividade: atual ? atual.produtividade : 0, forcar: opcoes.forcar });
      if (r.ok) n++;
      else if (r.confirmadaProd) conflitos.push({ centro: p.centro, valor: p.valor, atual: r.valor_atual });
    });
    return { ok: true, n: n, partes: partes, conflitos: conflitos };
  }

  /* Rateia o valor da nota única entre os projetos do grupo, na
     proporção do confirmado (ou do previsto, se ninguém confirmou). O
     centavo da diferença fica na última linha. */
  function ratearNoGrupo(grupo, competencia, valor) {
    const base = baseDoGrupo(grupo, competencia);
    const usaConfirmado = base.total_confirmado > 0;
    const total = usaConfirmado ? base.total_confirmado : base.total_previsto;
    const itens = base.itens.filter(function (i) {
      return usaConfirmado ? i.confirmado !== null : i.previsto > 0;
    });
    if (!itens.length || !total) return [];
    let acumulado = 0;
    return itens.map(function (i, k) {
      const parte = usaConfirmado ? i.confirmado : i.previsto;
      const v = k === itens.length - 1
        ? Math.round((valor - acumulado) * 100) / 100
        : Math.round(valor * (parte / total) * 100) / 100;
      acumulado = Math.round((acumulado + v) * 100) / 100;
      return { centro: i.centro, valor: v, base: parte };
    });
  }

  /* ── relatório de faturamento por projeto ───────────────
     O que o gestor pergunta: de todos os projetos, quais foram
     faturados neste mês, quais não foram, e quanto deu no total. A
     tela de cobertura já respondia parte disso, mas só por
     competência e sem os números da nota.

     Dois recortes, porque as duas perguntas existem:
     - por COMPETÊNCIA (o normal): o mês de referência do serviço,
       que é como o contrato e a prefeitura leem o faturamento;
     - por PERÍODO de emissão (de/até): quando a pergunta é de caixa
       ou de conferência contra o livro fiscal — "o que saiu de nota
       entre 10 e 20 de março", que pode incluir competências
       diferentes.

     Projeto sem nota aparece na lista com faturado zero e
     `faturou: false` — a tela mostra o traço. Projeto nenhum fica de
     fora, que é justamente o ponto do relatório: o não faturado é a
     informação. */
  /* NOTAS EMITIDAS NO PERÍODO, por dia de emissão.

     Responde "o que eu emiti entre tal e tal data" — a pergunta do
     contador, e a que fecha com o livro fiscal. Traz a competência
     ao lado porque nota emitida em novembro pode ser de outubro, e é
     aí que a conferência costuma empacar. */
  function faturamentoPorEmissao(de, ate, centro) {
    const linhas = [];
    st.receber.forEach(function (r) {
      if (['cancelado', 'substituido'].indexOf(r.status) > -1) return;
      /* Só o que virou documento: previsão ainda não é faturamento. */
      if (['nota', 'fatura'].indexOf(r.origem) < 0) return;
      if (!r.emissao || r.emissao < de || r.emissao > ate) return;
      if (centro && r.centro !== centro) return;
      const c = D.centro(r.centro) || {};
      const bruto = r.valor_bruto || 0;
      /* O retido da NOTA: o que o cliente segura na fonte. Vem do
         percentual do projeto quando a nota não traz valor próprio —
         é assim que o resto do sistema calcula. */
      const retido = r.retencao !== undefined && r.retencao !== null
        ? Math.round((r.retencao || 0) * 100) / 100
        : Math.round(bruto * ((c.retencao_pct || 0) / 100) * 100) / 100;
      linhas.push({
        emissao: r.emissao,
        numero: r.numero || '',
        cliente: r.cliente_nome || '',
        projeto: c.curto || c.nome || r.centro || '',
        centro: r.centro,
        competencia: r.competencia || '',
        vencimento: r.vencimento || '',
        bruto: bruto,
        retido: retido,
        liquido: bruto - retido,
        status: r.status || 'em aberto'
      });
    });
    linhas.sort(function (a, b) {
      if (a.emissao !== b.emissao) return a.emissao > b.emissao ? 1 : -1;
      return String(a.numero) > String(b.numero) ? 1 : -1;
    });
    const soma = function (k) { return linhas.reduce(function (a, l) { return a + (l[k] || 0); }, 0); };
    return { linhas: linhas, bruto: soma('bruto'), retido: soma('retido'), liquido: soma('liquido') };
  }

  /* O QUE FOI E O QUE NÃO FOI FATURADO numa competência.

     A previsão diz quanto se espera de cada projeto no mês; as notas
     dizem quanto saiu. O que interessa é a diferença — e ela some num
     relatório que lista só o emitido. Projeto sem nota aparece aqui
     com o valor previsto, que é justamente o que se quer ver antes de
     fechar o mês. */
  function faturamentoPorCompetencia(comp, centro) {
    const linhas = [];
    D.centros.filter(function (c) {
      return c.tipo === 'projeto' && (!centro || c.id === centro);
    }).forEach(function (c) {
      const pv = previsaoDe(c.id, comp);
      const previsto = pv ? (pv.faturamento || 0) : 0;

      let faturado = 0, notas = 0, ultima = '';
      st.receber.forEach(function (r) {
        if (r.centro !== c.id || r.competencia !== comp) return;
        if (['cancelado', 'substituido'].indexOf(r.status) > -1) return;
        if (['nota', 'fatura'].indexOf(r.origem) < 0) return;
        faturado += r.valor_bruto || 0;
        notas++;
        if (!ultima || (r.emissao || '') > ultima) ultima = r.emissao || '';
      });

      if (!previsto && !faturado) return;   // projeto sem movimento no mês
      linhas.push({
        projeto: c.curto || c.nome || c.id,
        centro: c.id,
        previsto: previsto,
        faturado: faturado,
        notas: notas,
        ultima_emissao: ultima,
        diferenca: faturado - previsto,
        situacao: !faturado ? 'NÃO FATURADO'
          : Math.abs(faturado - previsto) < 0.01 ? 'faturado'
          : faturado < previsto ? 'faturado a menor' : 'faturado a maior',
        etapa: pv ? etapaDaPrevisao(pv) : null
      });
    });
    linhas.sort(function (a, b) {
      /* O que falta faturar primeiro: é o que exige ação antes do
         fechamento. */
      if (!a.faturado !== !b.faturado) return a.faturado ? 1 : -1;
      return a.projeto > b.projeto ? 1 : -1;
    });
    const soma = function (k) { return linhas.reduce(function (a, l) { return a + (l[k] || 0); }, 0); };
    return {
      linhas: linhas, competencia: comp,
      previsto: soma('previsto'), faturado: soma('faturado'),
      a_faturar: linhas.filter(function (l) { return !l.faturado; })
        .reduce(function (a, l) { return a + l.previsto; }, 0)
    };
  }

  /* COMPARATIVO entre duas competências: faturamento bruto,
     produtividade e quanto a produtividade pesa sobre o faturamento.

     A conta que interessa é a terceira. Faturamento sobe e desce com
     o volume do mês; o que diz se o projeto está indo bem é a fatia
     que vai para os médicos. Um projeto que passou de 85% para 89%
     perdeu margem mesmo faturando mais — e é esse movimento que não
     aparece olhando faturamento e repasse em telas separadas.

     `alerta` sai pronto da regra, para a tela e a planilha pintarem
     a mesma coisa: nunca duas definições do que é um desvio. */
  /* IMPOSTO SOBRE O FATURAMENTO — o que a empresa vai recolher,
     tenha o cliente retido ou não.

     A coluna "retido" respondia a pergunta errada. O que sai do
     caixa é o imposto devido, e a retenção é só a forma de
     pagamento: cliente que retém antecipa; cliente que não retém
     deixa a guia para a empresa. O total a recolher é o mesmo.

     Com uma exceção que muda o custo do projeto: quando o cliente
     retém MAIS do que a alíquota devida, o excedente não volta. Um
     município que retém 5% de ISS sobre um serviço tributado a 2%
     cobra 5% — e é esse o custo do projeto, não os 2%. O excedente
     fica registrado à parte, porque é informação de negociação:
     aparece na hora de decidir preço para aquele cliente.

     `imposto_efetivo` é o maior entre devido e retido, tributo a
     tributo. Somar os dois seria contar duas vezes; usar só o devido
     esconderia o excedente. */
  function impostoSobreFaturamento(centro, bruto, retidoInformado) {
    const c = D.centro(centro) || {};
    const imp = c.impostos || {};
    const base = bruto || 0;

    /* O ISS do projeto: a chave muda conforme o município da
       prestação, e o cadastro traz as duas. */
    const issPct = (c.uf === 'CE' || c.municipio_uf === 'CE') && imp.iss_ce !== undefined
      ? imp.iss_ce : (imp.iss || 0);

    const tributos = [
      { nome: 'ISS', pct: issPct },
      { nome: 'PIS/COFINS', pct: imp.pis_cofins || 0 },
      { nome: 'IRPJ', pct: imp.irpj || 0 },
      { nome: 'CSLL', pct: imp.csll || 0 }
    ];
    const devidoPct = tributos.reduce(function (a2, t) { return a2 + t.pct; }, 0);
    const devido = Math.round(base * devidoPct / 100 * 100) / 100;

    const retidoPct = c.retencao_pct || 0;
    const retido = retidoInformado !== undefined && retidoInformado !== null
      ? retidoInformado : Math.round(base * retidoPct / 100 * 100) / 100;

    /* Tributo a tributo seria o ideal, mas o cadastro guarda a
       retenção como um percentual único. Com um número só, a
       comparação honesta é no total. */
    const efetivo = Math.max(devido, retido);
    const excedente = Math.max(0, retido - devido);

    return {
      base: base,
      devido: devido, devido_pct: devidoPct,
      retido: retido, retido_pct: retidoPct,
      imposto_efetivo: efetivo,
      excedente: excedente,
      /* O aviso que o financeiro precisa ver: retenção acima do
         devido é custo a mais nesse contrato. */
      obs: excedente > 0
        ? 'Retenção de ' + U.num(retidoPct) + '% acima do imposto devido de ' +
          U.num(devidoPct) + '% — o excedente de ' + U.brl(excedente) + ' é custo do projeto'
        : (retido > 0 && retido < devido
          ? 'Retido ' + U.num(retidoPct) + '%; faltam ' + U.brl(devido - retido) + ' por guia'
          : ''),
      tributos: tributos
    };
  }

  /* SUGESTÃO DE PREVISÃO a partir do histórico.

     A previsão inicial de cada projeto foi digitada à mão, e no
     grupo do HGB foi dividida em partes iguais entre os setores —
     um chute honesto, já que não havia histórico. Assim que houver
     meses faturados, o chute deixa de ser necessário: o que o setor
     faturou de fato é a melhor estimativa do que ele vai faturar.

     Usa a média dos últimos meses COM nota, não dos últimos meses
     corridos: mês sem faturamento costuma ser mês sem fechamento,
     não mês de faturamento zero, e entrar com zero na média puxaria
     a previsão para baixo sem motivo. */
  function sugerirPrevisao(centro, meses) {
    const qtd = meses || 3;
    const hoje = U.mesAtual();
    const historico = [];
    for (let i = 1; i <= 12 && historico.length < qtd; i++) {
      const comp = U.compDe(U.addMeses(hoje + '-01', -i));
      let valor = 0;
      st.receber.forEach(function (r) {
        if (r.centro !== centro || r.competencia !== comp) return;
        if (['cancelado', 'substituido'].indexOf(r.status) > -1) return;
        if (['nota', 'fatura'].indexOf(r.origem) < 0) return;
        valor += r.valor_bruto || 0;
      });
      if (valor > 0) historico.push({ competencia: comp, valor: valor });
    }
    if (!historico.length) {
      const c = D.centro(centro) || {};
      return { sugerido: c.prev_faturamento || 0, base: 'cadastro',
        historico: [], obs: 'sem mês faturado ainda — vale o valor do cadastro' };
    }
    const soma = historico.reduce(function (a2, h) { return a2 + h.valor; }, 0);
    const media = Math.round(soma / historico.length * 100) / 100;
    const ultimo = historico[0];
    /* Diferença grande entre o último mês e a média é sinal de
       tendência ou de mês atípico — quem decide é quem conhece o
       contrato, então o sistema aponta em vez de escolher. */
    const desvio = media > 0 ? Math.abs(ultimo.valor - media) / media * 100 : 0;
    return {
      sugerido: media,
      base: historico.length + ' mês(es) faturado(s)',
      historico: historico,
      ultimo: ultimo.valor,
      obs: desvio > 15
        ? 'o último mês (' + U.brl(ultimo.valor) + ') difere ' + U.num(desvio) +
          '% da média — confira se foi atípico'
        : ''
    };
  }

  function comparativoProdutividade(compA, compB, limite) {
    const lim = limite === undefined ? 3 : limite;

    const dados = function (comp) {
      const m = {};
      D.centros.filter(function (c) { return c.tipo === 'projeto'; }).forEach(function (c) {
        let fat = 0;
        st.receber.forEach(function (r) {
          if (r.centro !== c.id || r.competencia !== comp) return;
          if (['cancelado', 'substituido'].indexOf(r.status) > -1) return;
          if (['nota', 'fatura'].indexOf(r.origem) < 0) return;
          fat += r.valor_bruto || 0;
        });
        /* Sem nota, vale a previsão: o mês corrente ainda não faturou
           e a comparação ficaria falsamente vazia. */
        let previsto = 0;
        const pv = previsaoDe(c.id, comp);
        if (pv) previsto = pv.faturamento || 0;

        let prod = 0;
        st.titulos.forEach(function (t) {
          if (t.centro !== c.id) return;
          if ((t.origem || '') !== 'produtividade' && (t.origem || '') !== 'plantao') return;
          const parc = parcelasDe(t.id);
          const compT = t.competencia || (parc[0] || {}).comp || '';
          if (compT !== comp) return;
          prod += parc.reduce(function (a2, p) { return a2 + (p.valor || 0); }, 0);
        });
        (st.lotesProdutividade || []).forEach(function (l) {
          if (l.centro !== c.id || l.competencia !== comp) return;
          if (l.cancelado) return;
          if (!prod) prod = l.valor_total || 0;
        });

        const base = fat || previsto;
        m[c.id] = {
          projeto: c.curto || c.nome || c.id, centro: c.id,
          faturamento: base, faturado_de_fato: fat > 0,
          produtividade: prod,
          pct: base > 0 ? (prod / base) * 100 : null
        };
      });
      return m;
    };

    const a1 = dados(compA), b1 = dados(compB);
    const linhas = [];
    Object.keys(a1).concat(Object.keys(b1)).forEach(function (id) {
      if (linhas.some(function (l) { return l.centro === id; })) return;
      const x = a1[id] || { faturamento: 0, produtividade: 0, pct: null };
      const y = b1[id] || { faturamento: 0, produtividade: 0, pct: null };
      if (!x.faturamento && !y.faturamento && !x.produtividade && !y.produtividade) return;
      const nome = (a1[id] || b1[id]).projeto;
      const dif = (x.pct !== null && y.pct !== null) ? y.pct - x.pct : null;
      linhas.push({
        projeto: nome, centro: id,
        fat_a: x.faturamento, prod_a: x.produtividade, pct_a: x.pct,
        fat_b: y.faturamento, prod_b: y.produtividade, pct_b: y.pct,
        dif_pct: dif,
        dif_faturamento: y.faturamento - x.faturamento,
        /* Acima do limite, a fatia do médico cresceu — margem caiu.
           Abaixo, sobrou mais. Os dois lados merecem atenção: o
           segundo costuma ser produtividade que ainda não entrou. */
        alerta: dif === null ? null : dif > lim ? 'piorou' : dif < -lim ? 'melhorou' : null
      });
    });
    linhas.sort(function (p, q) {
      const vp = p.dif_pct === null ? -1 : Math.abs(p.dif_pct);
      const vq = q.dif_pct === null ? -1 : Math.abs(q.dif_pct);
      return vq - vp;      // maiores desvios primeiro
    });

    const soma = function (k) { return linhas.reduce(function (acc, l) { return acc + (l[k] || 0); }, 0); };
    const fatA = soma('fat_a'), fatB = soma('fat_b');
    return {
      linhas: linhas, limite: lim, competencia_a: compA, competencia_b: compB,
      fat_a: fatA, fat_b: fatB, prod_a: soma('prod_a'), prod_b: soma('prod_b'),
      pct_a: fatA > 0 ? (soma('prod_a') / fatA) * 100 : null,
      pct_b: fatB > 0 ? (soma('prod_b') / fatB) * 100 : null,
      com_alerta: linhas.filter(function (l) { return l.alerta; }).length
    };
  }

  function relatorioFaturamento(f) {
    f = f || {};
    if (!veFinanceiro('faturamento') && !pode('faturar') && !pode('admin')) {
      return { erro: 'Seu perfil não vê valor de faturamento.' };
    }
    const porPeriodo = !!(f.de && f.ate);
    if (!porPeriodo && !f.competencia) {
      return { erro: 'Informe a competência ou o período (de/até).' };
    }
    if (porPeriodo && (!dataExiste(f.de) || !dataExiste(f.ate))) {
      return { erro: 'Período inválido.' };
    }
    if (porPeriodo && f.de > f.ate) return { erro: 'O período termina antes de começar.' };

    const docEntra = function (r) {
      if (['cancelado', 'substituido'].indexOf(r.status) > -1) return false;
      if (['nota', 'fatura', 'avulso'].indexOf(r.origem) < 0) return false;
      if (r.conferir) return false;
      return porPeriodo
        ? (r.emissao || '') >= f.de && (r.emissao || '') <= f.ate
        : r.competencia === f.competencia;
    };

    const projetos = D.centros.filter(function (c) {
      if (c.tipo !== 'projeto') return false;
      if (f.centro && c.id !== f.centro) return false;
      if (f.unidade && c.unidade !== f.unidade) return false;
      /* Inativo entra só se tiver nota no recorte — senão polui a
         lista com projeto que acabou ano passado. */
      if (!c.ativo) {
        return st.receber.some(function (r) { return docEntra(r) && r.centro === c.id; });
      }
      return true;
    });

    const linhas = projetos.map(function (c) {
      /* Documento do GRUPO conta em cada projeto pela parte do
         rateio — senão a especialidade principal aparece com a nota
         inteira e as outras como não faturadas. */
      const docs = st.receber.filter(function (r) {
        if (!docEntra(r)) return false;
        return r.centro === c.id ||
          (r.rateio_centros || []).some(function (x) { return x.centro === c.id; });
      }).map(function (r) {
        const parte = (r.rateio_centros || []).find(function (x) { return x.centro === c.id; });
        return {
          id: r.id, numero: r.numero || '', emissao: r.emissao || '',
          competencia: r.competencia || '', origem: r.origem,
          valor: parte ? parte.valor : r.valor_bruto,
          valor_liquido: parte ? parte.valor : (r.valor_liquido || r.valor_bruto),
          retido: parte ? 0 : (r.valor_retido || 0),
          recebido: parte ? 0 : (r.valor_recebido || 0),
          status: r.status, cliente: r.cliente_nome || '',
          do_grupo: r.grupo_faturamento || null,
          parte_do_rateio: !!parte
        };
      });
      const bruto = Math.round(docs.reduce(function (a, d) { return a + (d.valor || 0); }, 0) * 100) / 100;
      const liquido = Math.round(docs.reduce(function (a, d) {
        return a + (d.valor_liquido || 0); }, 0) * 100) / 100;
      const recebido = Math.round(docs.reduce(function (a, d) {
        return a + (d.recebido || 0); }, 0) * 100) / 100;
      /* O previsto só existe por competência: previsão é do mês, não
         de um intervalo de dias. */
      const pv = porPeriodo ? null : previsaoDe(c.id, f.competencia);
      const previsto = pv ? pv.faturamento : 0;
      return {
        centro: c.id,
        projeto: c.curto || c.nome,
        projeto_nome: c.nome,
        unidade: c.unidade || '',
        cliente: (D.clienteDoCentro(c.id) || {}).nome || '',
        empresa: (D.empresaPor(empresaDoCentro(c.id)) || {}).apelido || '',
        grupo: c.grupo_faturamento || null,
        faturou: docs.length > 0,
        documentos: docs.length,
        numeros: docs.map(function (d) { return d.numero; }).filter(Boolean),
        valor_bruto: bruto,
        valor_liquido: liquido,
        valor_recebido: recebido,
        a_receber: Math.round((liquido - recebido) * 100) / 100,
        previsto: previsto,
        diferenca: pv ? Math.round((bruto - previsto) * 100) / 100 : null,
        etapa: pv ? etapaDaPrevisao(pv) : null,
        docs: docs
      };
    });

    linhas.sort(function (a, b) {
      return (a.unidade || '').localeCompare(b.unidade || '') ||
        (a.projeto || '').localeCompare(b.projeto || '');
    });

    const comNota = linhas.filter(function (l) { return l.faturou; });
    const semNota = linhas.filter(function (l) { return !l.faturou; });
    const soma = function (arr, k) {
      return Math.round(arr.reduce(function (a, l) { return a + (l[k] || 0); }, 0) * 100) / 100;
    };
    /* O total NÃO soma as linhas: documento de grupo aparece rateado
       em vários projetos, e somar as partes daria o mesmo número —
       mas documento sem rateio que cubra dois centros contaria duas
       vezes. O total vem dos documentos únicos. */
    const idsUnicos = {};
    linhas.forEach(function (l) {
      l.docs.forEach(function (d) { idsUnicos[d.id] = d; });
    });
    const unicos = Object.keys(idsUnicos).map(function (k) { return idsUnicos[k]; });
    const totalBruto = Math.round(unicos.reduce(function (a, d) {
      return a + (d.parte_do_rateio ? 0 : d.valor); }, 0) * 100) / 100;

    return {
      ok: true,
      modo: porPeriodo ? 'periodo' : 'competencia',
      competencia: f.competencia || null,
      de: f.de || null, ate: f.ate || null,
      linhas: linhas,
      projetos: linhas.length,
      faturados: comNota.length,
      nao_faturados: semNota.length,
      documentos: unicos.length,
      total_bruto: totalBruto,
      total_liquido: soma(comNota, 'valor_liquido'),
      total_recebido: soma(comNota, 'valor_recebido'),
      total_a_receber: soma(comNota, 'a_receber'),
      total_previsto: soma(linhas, 'previsto'),
      /* Quanto do previsto do mês ainda não virou nota. */
      total_nao_faturado: porPeriodo ? null : soma(semNota, 'previsto')
    };
  }

  function coberturaFaturamento(competencia) {
    const projetos = D.centros.filter(function (c) { return c.ativo && c.tipo === 'projeto'; });
    return projetos.map(function (c) {
      /* Documento único do grupo conta em CADA projeto pela parte que
         lhe cabe no rateio — senão a especialidade principal aparecia
         com a nota inteira e as outras como "falta faturar". */
      const docs = st.receber.filter(function (r) {
        if (r.competencia !== competencia || r.status === 'cancelado') return false;
        if (['nota', 'fatura', 'avulso'].indexOf(r.origem) < 0) return false;
        return r.centro === c.id ||
          (r.rateio_centros || []).some(function (x) { return x.centro === c.id; });
      }).map(function (r) {
        const parte = (r.rateio_centros || []).find(function (x) { return x.centro === c.id; });
        return parte ? Object.assign({}, r, { valor_bruto: parte.valor, do_grupo: r.grupo_faturamento }) : r;
      });
      const prev = st.receber.find(function (r) {
        return r.centro === c.id && r.competencia === competencia && r.origem === 'previsao' &&
          ['previsto', 'faturado'].indexOf(r.status) > -1;
      });
      const pv = previsaoDe(c.id, competencia);
      const faturado = Math.round(docs.reduce(function (a, r) { return a + r.valor_bruto; }, 0) * 100) / 100;
      /* Projeto que faz parte de um GRUPO de faturamento não deve uma
         nota própria: a nota do grupo cobre todos. Sem isso, as 7
         especialidades do HGB que não têm produtividade no mês ficavam
         eternamente como "sem faturamento", cobrando um documento que
         o hospital nunca vai emitir. */
      const grupo = c.grupo_faturamento || null;
      const docsGrupo = grupo ? st.receber.filter(function (r) {
        return r.grupo_faturamento === grupo && r.competencia === competencia && r.status !== 'cancelado';
      }) : [];
      const previsto = pv ? pv.faturamento : (c.prev_faturamento || 0);
      const confirmado = pv && pv.status === 'confirmada_prod' ? pv.faturamento : null;
      /* O valor que vale é o mais firme que existe: faturado > 
         confirmado > previsto. "Falta faturar" é a diferença entre esse
         valor e o que já saiu em nota — é o número que o gestor quer. */
      const esperado = faturado > 0 ? faturado : (confirmado !== null ? confirmado : previsto);
      return {
        centro: c.id, projeto: c, docs: docs, faturado: faturado,
        confirmado: confirmado,
        confirmado_por: pv && pv.confirmado_por, previsto: previsto,
        esperado: esperado,
        falta_faturar: Math.max(0, Math.round((esperado - faturado) * 100) / 100),
        origem_valor: faturado > 0 ? 'faturado' : (confirmado !== null ? 'confirmado' : 'previsto'),
        grupo: grupo,
        grupo_faturado: docsGrupo.length > 0,
        /* "Sem base" = projeto sem produtividade e sem previsão no mês.
           Num grupo, isso é normal (a especialidade não teve plantão);
           fora dele, continua sendo "sem faturamento". */
        sem_base: !previsto && confirmado === null && !faturado,
        etapa: etapaDaPrevisao(pv),
        encerrado: pv && pv.status === 'encerrada',
        aguardando_nf: !docs.length && !!prev,
        /* A situação diz em que etapa da esteira a competência está —
           é o que separa "confirmado" de "pode emitir". */
        situacao: docs.length ? 'faturado'
          : (pv && pv.status === 'encerrada') ? 'encerrado'
          : (pv && pv.liberado_em) ? 'liberado'
          : (pv && pv.autorizado_em) ? 'aguardando_liberacao'
          : (grupo && !previsto && confirmado === null) ? 'sem_base_no_grupo'
          : (grupo && docsGrupo.length) ? 'faturado_no_grupo'
          : (pv && pv.status === 'confirmada_prod') ? 'aguardando_nf'
          : 'sem_faturamento'
      };
    });
  }

  /* Alerta: da mesma forma que a produtividade, a partir do dia 11 o
     faturamento da competência anterior já deveria estar lançado. */
  function faturamentoPendente() {
    const hoje = U.hoje();
    if (parseInt(hoje.slice(8, 10), 10) <= 10) return { competencia: null, faltando: [] };
    const d = new Date(hoje + 'T00:00:00Z');
    const comp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    /* O alerta conta por GRUPO: uma nota única pendente é um item, não
       oito. Projeto sem base no mês não entra. */
    const vistos = {};
    const faltando = coberturaFaturamento(comp)
      .filter(function (x) {
        if (['aguardando_nf', 'aguardando_liberacao', 'liberado', 'sem_faturamento'].indexOf(x.situacao) < 0) return false;
        if (!x.grupo) return true;
        if (vistos[x.grupo]) return false;
        vistos[x.grupo] = true;
        return true;
      });
    return { competencia: comp, faltando: faltando };
  }

  /* Alerta de atraso: só liga a partir do dia 11, olhando pra
     competência do mês anterior — antes do dia 10 o arquivo pode
     simplesmente ainda não ter chegado do projeto, o que é normal. */
  function produtividadePendente() {
    const hoje = U.hoje();
    if (parseInt(hoje.slice(8, 10), 10) <= 10) return { competencia: null, faltando: [] };
    const d = new Date(hoje + 'T00:00:00Z');
    const comp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    const faltando = coberturaProdutividade(comp).filter(function (x) { return !x.lote; }).map(function (x) { return x.centro; });
    return { competencia: comp, faltando: faltando };
  }

  /* ══════════════════════════════════════════════════════════
     DEPARTAMENTO PESSOAL
     Funcionário CLT não é credor (médico PJ/SCP) — mas pra pagar o
     líquido pelo mesmo CNAB/PIX que já existe, cada funcionário ganha
     um credor-espelho (`tipo: 'funcionario'`) no mesmo cadastro, com o
     mesmo CPF e a mesma chave. Um cálculo só (`calcularHolerite`)
     alimenta tanto a prévia na tela quanto o fechamento de verdade —
     não tem two-lugares-que-podem-divergir.
  ══════════════════════════════════════════════════════════ */

  /* Tabela progressiva com parcela a deduzir — o jeito que INSS e IRRF
     são publicados oficialmente. Acima do teto da última faixa, INSS
     cobra o teto fixo; IRRF não tem teto (a última faixa é infinita). */
  function calcularINSS(base) {
    base = Math.round((base || 0) * 100) / 100;
    if (base <= 0) return 0;
    const t = D.tabelaINSS;
    const ultima = t.faixas[t.faixas.length - 1];
    if (base > ultima.ate) return t.teto_contribuicao;
    const faixa = t.faixas.find(function (f) { return base <= f.ate; }) || ultima;
    return Math.round(Math.max(0, base * faixa.aliquota / 100 - faixa.deduzir) * 100) / 100;
  }

  /* Depois do IR apurado pela tabela, a Lei 15.270/2025 aplica um
     redutor sobre o RENDIMENTO BRUTO (não a base já líquida de INSS e
     dependentes — são duas bases diferentes usadas na mesma conta, e
     trocar uma pela outra muda o resultado). Até R$5.000 brutos o
     redutor zera o imposto; entre R$5.000 e R$7.350 reduz por uma
     fórmula linear decrescente; acima de R$7.350 não reduz nada. Sem
     isso, quem ganha até R$5 mil pagava IR que a lei de 2026 isenta. */
  /* IRRF mensal. `rendimento` é o bruto tributável; `inss` é o INSS
     descontado dele. Deduções legais (Lei 9.250, art. 4º, II a V):
     dependentes, pensão alimentícia, previdência oficial (INSS). O
     desconto simplificado mensal (R$607,20) SUBSTITUI esse conjunto
     inteiro — não soma com o INSS. Vale o maior dos dois:
       base = rendimento − max(INSS + dependentes + pensão, simplificado)
     (a v70–v73 abatia o INSS E o simplificado, descontando duas vezes).
     Depois do imposto da tabela, a Lei 15.270/2025 aplica o redutor
     sobre o RENDIMENTO BRUTO: zera até R$5.000, reduz linearmente até
     R$7.350. Conferido: salário R$5.500 sem dependentes → R$190,47.
     Pensão entra no conjunto substituído (Lei 9.250, art. 4º, II a V) —
     leitura confirmada pela empresa. */
  /* A base efetivamente usada no imposto: deduções legais ou desconto
     simplificado, o que for maior. O holerite mostrava a base com as
     deduções legais mesmo quando o cálculo usou o simplificado — não
     mudava o imposto, mas quem conferia não fechava a conta. */
  function baseIRRFEfetiva(rendimento, inss, dependentes, pensao) {
    const t = D.tabelaIRRF;
    const deducoesLegais = Math.round(((inss || 0) + (dependentes || 0) * t.deducao_por_dependente +
      (pensao || 0)) * 100) / 100;
    const deducao = Math.max(deducoesLegais, t.desconto_simplificado || 0);
    return {
      base: Math.round(((rendimento || 0) - deducao) * 100) / 100,
      deducao: deducao,
      usou_simplificado: deducao > deducoesLegais
    };
  }

  function calcularIRRF(rendimento, inss, dependentes, pensao) {
    const t = D.tabelaIRRF;
    rendimento = rendimento || 0;
    const deducoesLegais = Math.round(((inss || 0) + (dependentes || 0) * t.deducao_por_dependente +
      (pensao || 0)) * 100) / 100;
    const deducao = Math.max(deducoesLegais, t.desconto_simplificado || 0);
    const base = Math.round((rendimento - deducao) * 100) / 100;
    if (base <= 0) return 0;
    const faixa = t.faixas.find(function (f) { return base <= f.ate; });
    const irTabela = Math.round(Math.max(0, base * faixa.aliquota / 100 - faixa.deduzir) * 100) / 100;
    if (irTabela <= 0) return 0;
    const r = t.redutor;
    let redutor = 0;
    if (r && rendimento <= r.limite_zera) redutor = irTabela;
    else if (r && rendimento <= r.limite_fim) redutor = Math.max(0, Math.round((r.formula_a - r.formula_b * rendimento) * 100) / 100);
    return Math.round(Math.max(0, irTabela - redutor) * 100) / 100;
  }

  const calcularFGTS = base => Math.round((base || 0) * D.parametrosDP.aliquota_fgts / 100 * 100) / 100;

  /* Holerite de um funcionário numa competência. `extras` é tudo que
     varia mês a mês e ninguém cadastra fixo: horas extras, faltas,
     pensão, um provento ou desconto avulso. Devolve proventos e
     descontos linha a linha — é o que aparece na tela de conferência
     antes de fechar, e é a MESMA função que roda no fechamento de
     verdade, então o que a pessoa vê antes é exatamente o que vira
     título depois. */
  /* Campos numéricos do holerite: todos finitos e nunca negativos.
     A lista é explícita de propósito — campo novo que não entrar aqui
     não é normalizado, e é melhor que isso apareça na revisão do que
     na folha. */
  const EXTRAS_NUMERICOS_HOLERITE = [
    'he50_horas', 'he100_horas', 'horas_noturnas', 'gratificacao_valor',
    'faltas_dias', 'dsr_perdidos', 'dias_trabalhados', 'dias_uteis',
    'pensao_alimenticia_valor', 'credito_trabalhador_valor',
    'vt_desconto_valor', 'vr_desconto_valor'
  ];

  function normalizarExtrasHolerite(extras) {
    const saida = Object.assign({}, extras || {});
    for (let i = 0; i < EXTRAS_NUMERICOS_HOLERITE.length; i++) {
      const k = EXTRAS_NUMERICOS_HOLERITE[i];
      const v = saida[k];
      if (v === undefined || v === null || v === '') { delete saida[k]; continue; }
      const n = numeroBR(v);
      if (!isFinite(n)) {
        return { erro: 'Valor inválido em "' + k.replace(/_/g, ' ') + '" (' + v + ').' };
      }
      if (n < 0) {
        return { erro: 'O campo "' + k.replace(/_/g, ' ') + '" não pode ser negativo (' + v + ').' };
      }
      saida[k] = n;
    }
    /* Rubricas manuais: sem campo na tela hoje, mas é por onde passa
       qualquer importação. Linha sem descrição ou com valor não
       finito deixava o holerite inteiro NaN — e a pessoa ficava sem
       título, com as guias do mês reduzidas e nada avisando. */
    const listas = ['outros_proventos', 'outros_descontos'];
    for (let i = 0; i < listas.length; i++) {
      const nome = listas[i];
      if (saida[nome] === undefined || saida[nome] === null) continue;
      if (!Array.isArray(saida[nome])) {
        return { erro: '"' + nome.replace(/_/g, ' ') + '" precisa ser uma lista.' };
      }
      const linhas = [];
      for (let j = 0; j < saida[nome].length; j++) {
        const l = saida[nome][j] || {};
        const v = numeroBR(l.valor);
        if (!isFinite(v) || v < 0) {
          return { erro: 'Rubrica "' + (l.descricao || '(sem descrição)') +
            '" com valor inválido (' + l.valor + ').' };
        }
        if (v === 0) continue;
        if (!String(l.descricao || '').trim()) {
          return { erro: 'Rubrica de ' + U.brl(v) + ' sem descrição.' };
        }
        linhas.push(Object.assign({}, l, { valor: Math.round(v * 100) / 100 }));
      }
      saida[nome] = linhas;
    }
    return saida;
  }

  function calcularHolerite(funcionarioId, competencia, extras) {
    if (typeof competencia !== 'string' || !/^\d{4}-\d{2}$/.test(competencia)) {
      return { erro: 'Competência inválida (' + JSON.stringify(competencia) + ').' };
    }
    /* TODOS os campos de extras são normalizados AQUI, uma vez, em
       vez de em cada uso. A tela sanitizava com `U.parseValor` antes
       de mandar e o store confiava — regra morando só na tela, no
       módulo que paga gente. Doze campos aceitavam Infinity, NaN e
       texto, e o holerite saía com líquido NaN sem nenhum aviso.

       O piso ZERO é o ponto principal: `Math.min(faltas, dias)`
       limitava o teto e não o piso, então "-5" digitado por engano no
       campo de faltas (que é texto livre) virava AUMENTO de salário —
       R$ 963,58 a mais num caso de R$ 4.200, com FGTS e INSS inflados
       junto, e a folha fechando como se estivesse tudo certo. */
    extras = normalizarExtrasHolerite(extras);
    if (extras.erro) return { erro: extras.erro };
    const f = D.funcionario(funcionarioId);
    if (!f) return { erro: 'Funcionário não encontrado.' };
    const dp = D.parametrosDP;
    /* Salário de referência é o que estava em vigor NA COMPETÊNCIA
       sendo calculada, não o valor atual do cadastro — sem isso,
       fechar (ou recalcular) uma folha de um mês passado ou futuro
       usava o salário de hoje, e um reajuste com vigência futura
       nunca aparecia até a data virar "hoje" de verdade. */
    const salarioMes = salarioVigenteEm(f, competencia + '-01');
    const diasMes = 30;   // mês comercial de 30 dias, padrão de folha CLT
    const diasTrabalhados = extras.dias_trabalhados !== undefined ? extras.dias_trabalhados : diasMes;
    const faltas = Math.min(extras.faltas_dias || 0, diasTrabalhados);
    /* Falta injustificada derruba também o DSR da semana (Lei
       605/1949, art. 6º): descontar só o dia deixava duas faltas em
       semanas diferentes custando R$ 280 em vez de R$ 560. Como o
       sistema não guarda o calendário de cada falta, a conta assume
       uma falta por semana — que é o caso comum e o mais conservador
       do ponto de vista do empregado só quando as faltas são
       consecutivas. Quem tiver o detalhe informa `dsr_perdidos`. */
    const dsrPerdidos = extras.dsr_perdidos !== undefined
      ? Math.max(0, extras.dsr_perdidos)
      : Math.min(faltas, 4);
    /* Dias de férias já lançados que caem nesta competência não podem
       ser pagos como salário de novo — o valor deles já saiu (ou vai
       sair) no título de férias, com base e tributação próprias. Sem
       isso, os mesmos dias eram pagos duas vezes: cheio no salário do
       mês e de novo nas férias. */
    const diasFerias = Math.min(diasFeriasNoMes(f, competencia), diasTrabalhados - faltas);
    let diasPagos = Math.max(0, diasTrabalhados - faltas - dsrPerdidos - diasFerias);
    /* Mês comercial (30 dias) com férias tem dois extremos que o
       calendário real corrige:
       - férias de 01 a 30 num mês de 31 dias: 30 − 30 = 0, mas o dia 31
         foi trabalhado → paga 1 dia;
       - férias cobrindo fevereiro inteiro: 30 − 28 = 2, mas ninguém
         trabalhou → paga 0.
       Fora desses casos continua o mês comercial. */
    if (diasFerias > 0) {
      const iniMes = competencia + '-01';
      const fimMes = U.addDias(U.compDe(U.addMeses(iniMes, 1)) + '-01', -1);
      const iniContrato = f.admissao > iniMes ? f.admissao : iniMes;
      const fimContrato = (f.desligado_em && f.desligado_em < fimMes) ? f.desligado_em : fimMes;
      const diasCalendario = iniContrato <= fimContrato ? U.diasEntre(iniContrato, fimContrato) + 1 : 0;
      const trabalhadosCalendario = Math.max(0, diasCalendario - diasFeriasEntre(f, iniContrato, fimContrato, true) - faltas);
      /* O calendário manda sempre que há férias no mês, não só nos
         extremos: com férias de 05 a 31 num mês de 31 dias, a conta
         comercial (30 − 27) pagava 3 dias, mas foram 4 trabalhados.
         É o mesmo caso da admissão no dia 31, agora no meio do mês. */
      diasPagos = Math.min(30, trabalhadosCalendario);
    }

    const proventos = [];
    const descontos = [];

    const salarioProp = Math.round(salarioMes / diasMes * diasPagos * 100) / 100;
    const notas = [];
    if (diasPagos < diasMes) notas.push(diasPagos + '/' + diasMes + ' dias');
    if (faltas > 0) {
      notas.push(faltas + ' falta(s)' +
        (dsrPerdidos > 0 ? ' + ' + dsrPerdidos + ' DSR' : ''));
    }
    if (diasFerias > 0) notas.push(diasFerias + ' dia(s) de férias no mês');
    proventos.push({ codigo: '001', descricao: 'Salário' + (notas.length ? ' (' + notas.join(', ') + ')' : ''),
      valor: salarioProp, natureza: '4.01' });

    /* Insalubridade/periculosidade calculadas ANTES da hora extra —
       Súmula 264 do TST: adicional habitual (que é o caso dos dois)
       integra a remuneração pra base de cálculo da hora extra, não é
       só um provento à parte. Calcular depois e nunca somar na base
       da hora subestimava o valor da HE de quem tem direito a um dos
       dois adicionais.

       Também proporcionais aos dias efetivamente pagos no mês — igual
       ao salário — em vez de sempre o valor cheio: quem foi admitido
       no meio do mês, faltou, ou tirou férias numa parte do mês não
       trabalhou o adicional inteiro, então não recebe ele inteiro
       (mesmo raciocínio do salário fracionado logo acima). */
    let valorAdicionalMes = 0, codigoAdicional = null, descAdicional = '';
    if (f.insalubridade_pct > 0 || f.periculosidade) {
      /* CLT art. 193 §2º: não cumula insalubridade com periculosidade
         — quem tem direito aos dois recebe só o mais vantajoso. Antes
         o cálculo somava os dois ao mesmo tempo, o que paga mais do
         que a lei manda quando o cadastro tem as duas marcações. */
      const valorInsalMes = f.insalubridade_pct > 0
        ? Math.round(dp.salario_minimo * f.insalubridade_pct / 100 * 100) / 100 : 0;
      const valorPericulMes = f.periculosidade ? Math.round(salarioMes * 0.3 * 100) / 100 : 0;
      if (valorPericulMes > valorInsalMes) {
        valorAdicionalMes = valorPericulMes; codigoAdicional = '106';
        descAdicional = 'Periculosidade 30% (sobre o salário base)' +
          (valorInsalMes > 0 ? ' — mais vantajosa que a insalubridade, não cumula' : '');
      } else if (valorInsalMes > 0) {
        valorAdicionalMes = valorInsalMes; codigoAdicional = '105';
        descAdicional = 'Insalubridade ' + f.insalubridade_pct + '% (sobre o salário mínimo)' +
          (valorPericulMes > 0 ? ' — mais vantajosa que a periculosidade, não cumula' : '');
      }
    }
    const valorAdicionalProp = Math.round(valorAdicionalMes / diasMes * diasPagos * 100) / 100;
    if (valorAdicionalProp > 0.004) {
      proventos.push({ codigo: codigoAdicional,
        descricao: descAdicional + (diasPagos < diasMes ? ' (' + diasPagos + '/' + diasMes + ' dias)' : ''),
        valor: valorAdicionalProp, natureza: '4.02' });
    }

    /* Divisor de hora: 220 é o de referência pra 44h semanais (o mais
       comum); outra jornada usa jornada*5, aproximação padrão de
       mercado. Hora noturna reduzida (52min30s) não entra nesta
       primeira versão — sinalizado como simplificação conhecida. */
    const divisorHora = f.jornada_semanal_horas === 44 ? dp.divisor_hora_padrao
      : Math.round(f.jornada_semanal_horas * 5);
    /* Base da hora inclui o adicional (proporcional) — mesmo motivo do
       comentário acima. Usa o valor PROPORCIONAL, não o cheio do mês:
       a HE feita depois de admitir no meio do mês (por exemplo) tem
       que refletir o adicional que a pessoa de fato recebe naquele
       mês, não um valor cheio que ela não vai receber. */
    const valorHora = Math.round((salarioMes + valorAdicionalMes) / divisorHora * 100) / 100;
    let variaveis = 0;

    if (extras.he50_horas > 0) {
      const v = Math.round(valorHora * 1.5 * extras.he50_horas * 100) / 100;
      proventos.push({ codigo: '101', descricao: 'Horas extras 50% (' + extras.he50_horas + 'h)', valor: v, natureza: '4.01' });
      variaveis += v;
    }
    if (extras.he100_horas > 0) {
      const v = Math.round(valorHora * 2 * extras.he100_horas * 100) / 100;
      proventos.push({ codigo: '102', descricao: 'Horas extras 100% (' + extras.he100_horas + 'h)', valor: v, natureza: '4.01' });
      variaveis += v;
    }
    if (extras.horas_noturnas > 0) {
      const v = Math.round(valorHora * 0.2 * extras.horas_noturnas * 100) / 100;
      proventos.push({ codigo: '103', descricao: 'Adicional noturno (' + extras.horas_noturnas + 'h)', valor: v, natureza: '4.01' });
      variaveis += v;
    }
    if (variaveis > 0.004) {
      /* DSR sobre variáveis: proporção de referência (5 dias de
         descanso pra 25 dias úteis) — o cálculo exato depende do
         calendário de domingos e feriados de cada mês. Ajustável por
         `extras.razao_dsr` quando o calendário real pedir precisão
         maior. */
      const razao = extras.razao_dsr !== undefined ? extras.razao_dsr : (5 / 25);
      proventos.push({ codigo: '104', descricao: 'DSR sobre variáveis',
        valor: Math.round(variaveis * razao * 100) / 100, natureza: '4.01' });
    }
    if (extras.gratificacao_valor > 0) {
      proventos.push({ codigo: '107', descricao: extras.gratificacao_descricao || 'Gratificação',
        valor: Math.round(extras.gratificacao_valor * 100) / 100, natureza: '4.01' });
    }
    (extras.outros_proventos || []).forEach(function (p, i) {
      proventos.push({ codigo: '19' + i, descricao: p.descricao, valor: Math.round((p.valor || 0) * 100) / 100, natureza: '4.02' });
    });

    const totalAntesSalarioFamilia = Math.round(proventos.reduce(function (s, p) { return s + p.valor; }, 0) * 100) / 100;

    /* Salário-família: paga por dependente de até 14 anos (ou
       inválido de qualquer idade, não modelado aqui — sem campo pra
       isso no cadastro) quando a remuneração do mês não passa do teto.
       É benefício previdenciário reembolsado pela empresa, ISENTO de
       INSS e IRRF — por isso soma DEPOIS de já ter fechado a base
       tributável dos outros proventos, não entra nela. */
    let salarioFamilia = 0;
    if (totalAntesSalarioFamilia <= dp.teto_salario_familia) {
      /* Último dia REAL do mês: '2028-02-31' vira 02/03 em Date, e a
         referência de idade era antecipada em todo mês que não tem 31
         dias — tirando um mês devido de salário-família. */
      const fimMes = U.addDias(U.compDe(U.addMeses(competencia + '-01', 1)) + '-01', -1);
      const dependentesElegiveis = (f.dependentes || []).filter(function (d) {
        if (!d.data_nascimento) return false;
        /* Devido ATÉ o mês em que completa 14 (Decreto 3.048, art.
           84): cortar por "idade < 14" no último dia do mês excluía
           o mês inteiro do aniversário, que a lei inclui. A conta é
           a idade no PRIMEIRO DIA DO MÊS, não no último. */
        const idade = idadeEm(d.data_nascimento, competencia + '-01');
        return idade !== null && idade < 14;
      }).length;
      if (dependentesElegiveis > 0) {
        salarioFamilia = Math.round(dependentesElegiveis * dp.valor_salario_familia * 100) / 100;
        proventos.push({ codigo: '108', descricao: 'Salário-família (' + dependentesElegiveis + ' dependente(s) até 14 anos)',
          valor: salarioFamilia, natureza: '4.01' });
      }
    }

    const totalProventos = Math.round(proventos.reduce(function (s, p) { return s + p.valor; }, 0) * 100) / 100;

    // salário-família não entra na base de INSS/IRRF — é o total ANTES dele que conta pra tributação
    const baseINSS = totalAntesSalarioFamilia;
    /* INSS é por COMPETÊNCIA, não por título (Lei 8.212, arts. 20 e
       28): com férias no mesmo mês, a folha recalculava do zero e
       reiniciava a tabela progressiva. As férias reservaram faixa com
       base num salário estimado; quando o real sai diferente, a soma
       das partes não fecha com o devido do mês. O IRRF já era
       incremental desde a C12 — aqui faltava o espelho.

       O que a folha retém é o INSS do mês inteiro menos o que as
       férias já retiveram. */
    const inssFerias = (f.ferias || []).reduce(function (s2, per) {
      return s2 + (per.gozos || []).reduce(function (s3, g) {
        if (g.cancelado || g.__temporario) return s3;
        if (U.compDe(g.data_inicio) !== competencia) return s3;
        return s3 + (g.base_inss || 0);
      }, 0);
    }, 0);
    const inssJaRetido = (f.ferias || []).reduce(function (s2, per) {
      return s2 + (per.gozos || []).reduce(function (s3, g) {
        if (g.cancelado || g.__temporario) return s3;
        if (U.compDe(g.data_inicio) !== competencia) return s3;
        return s3 + (g.inss || 0);
      }, 0);
    }, 0);
    const valorINSS = inssFerias > 0.004
      ? Math.max(0, Math.round((calcularINSS(
          Math.round((inssFerias + baseINSS) * 100) / 100) - inssJaRetido) * 100) / 100)
      : calcularINSS(baseINSS);
    descontos.push({ codigo: '901', descricao: 'INSS', valor: valorINSS, natureza: '4.04' });

    const baseIRRFAntesDeducao = Math.round((baseINSS - valorINSS) * 100) / 100;
    /* Pensão alimentícia vem do cadastro do funcionário por padrão —
       só usa o valor digitado na hora (extras) se alguém explicitamente
       mandar um valor diferente pra este mês (decisão judicial nova,
       por exemplo). Sem isso, tinha que digitar tudo de novo toda
       folha, e era fácil esquecer. */
    /* Pensão fixa é mensal: se as férias que começam neste mês já
       descontaram pensão, a folha desconta só o que faltar (antes, férias
       do mês inteiro + pensão de novo na folha deixavam o líquido
       negativo, a pessoa saía da folha e a pensão não ia pra ninguém). */
    let pensaoJaNasFerias = 0;
    (f.ferias || []).forEach(function (per) {
      (per.gozos || []).forEach(function (g) {
        if (!g.cancelado && !g.__temporario && U.compDe(g.data_inicio) === competencia) pensaoJaNasFerias += (g.pensao || 0);
      });
    });
    const pensaoValor = extras.pensao_alimenticia_valor !== undefined
      ? extras.pensao_alimenticia_valor
      : Math.max(0, Math.round(((f.pensao_alimenticia && f.pensao_alimenticia.ativo ? f.pensao_alimenticia.valor : 0) - pensaoJaNasFerias) * 100) / 100);
    /* Cumulativo no mês: se já houve férias nesta competência, o
       imposto da folha é o do mês inteiro menos o que já foi retido —
       senão cada pagamento ganha faixa, desconto simplificado e
       redutor próprios, e os dois saem zerados. */
    const irrfIncFolha = irrfIncremental(f, competencia, baseINSS, valorINSS, pensaoValor || 0);
    /* O desconto não pode engolir a folha inteira. No mês em que o
       funcionário tira 30 dias de férias, os proventos do salário são
       quase nada e o imposto do mês todo cairia aqui, deixando o
       líquido negativo — o que a folha não faz: desconta o que cabe e
       o resto acerta no pagamento seguinte. */
    const descontosAteAqui = descontos.reduce(function (s2, x) { return s2 + x.valor; }, 0);
    const sobra = Math.round((totalProventos - descontosAteAqui) * 100) / 100;
    const valorIRRF = Math.max(0, Math.min(irrfIncFolha.valor, Math.max(0, sobra)));
    const irrfAdiado = Math.round((irrfIncFolha.valor - valorIRRF) * 100) / 100;
    if (valorIRRF > 0.004) descontos.push({ codigo: '902', descricao: 'IRRF', valor: valorIRRF, natureza: '4.04' });

    /* Vale-transporte e refeição se pagam por DIA ÚTIL trabalhado, não
       por 30 dias corridos: ninguém pega ônibus no domingo para ir
       trabalhar. Quem quiser outro número informa em extras. */
    const uteisDoMes = extras.dias_uteis !== undefined ? extras.dias_uteis : U.diasUteis(competencia);
    const uteisPagos = Math.max(0, Math.round(uteisDoMes * (diasPagos / (diasMes || 30))));
    let vtGasto = 0, vtDesconto = 0;
    if (f.vale_transporte && f.vt_dia > 0) {
      vtGasto = Math.round(f.vt_dia * uteisPagos * 100) / 100;
      /* Editável por mês via extras.vt_desconto_valor (a tela de Folha
         usa isso pra deixar corrigir o desconto sem mudar o cadastro).
         Sem override, usa o que está cadastrado no funcionário: modo
         "percentual" respeita um teto próprio se marcado, senão o teto
         global; "valor" é um desconto fixo; "nenhum" isenta. */
      /* TETO LEGAL de 6% do salário básico (Lei 7.418, art. 4º,
         parágrafo único): o excedente é custo do empregador. O
         parâmetro era usado só como fallback quando o cadastro não
         tinha percentual próprio, nunca como limite — então um
         percentual de 25% no cadastro, ou um override na tela,
         descontava 22% do salário. */
      const tetoLegalVT = Math.round(salarioMes * dp.percentual_vt_max_desconto / 100 * 100) / 100;
      if (extras.vt_desconto_valor !== undefined) {
        vtDesconto = Math.min(vtGasto, Math.max(0, extras.vt_desconto_valor));
      } else if (f.vt_desconto_modo === 'nenhum') {
        vtDesconto = 0;
      } else if (f.vt_desconto_modo === 'valor' && f.vt_desconto_valor > 0) {
        vtDesconto = Math.min(vtGasto, f.vt_desconto_valor);
      } else {
        const pct = f.vt_desconto_valor > 0 ? f.vt_desconto_valor : dp.percentual_vt_max_desconto;
        vtDesconto = Math.min(vtGasto, Math.round(salarioMes * pct / 100 * 100) / 100);
      }
      /* O teto vale para os três caminhos, inclusive o override. */
      vtDesconto = Math.min(vtDesconto, tetoLegalVT);
      if (vtDesconto > 0.004) {
        descontos.push({ codigo: '903', descricao: 'Vale-transporte' +
          (f.vt_desconto_modo === 'valor' ? ' (desconto fixo)' : ' (limitado a ' +
            (f.vt_desconto_valor > 0 ? f.vt_desconto_valor : dp.percentual_vt_max_desconto) + '% do salário)'),
          valor: vtDesconto, natureza: '4.02' });
      }
    }
    let vrGasto = 0, vrDesconto = 0;
    if (f.vale_refeicao && f.vr_dia > 0) {
      /* Mesma regra do vale-transporte: refeição se paga por dia
         trabalhado, não por 30 dias corridos. */
      vrGasto = Math.round(f.vr_dia * uteisPagos * 100) / 100;
      if (extras.vr_desconto_valor !== undefined) {
        vrDesconto = Math.min(vrGasto, Math.max(0, extras.vr_desconto_valor));
      } else if (f.vr_desconto_modo === 'valor' && f.vr_desconto_valor > 0) {
        vrDesconto = Math.min(vrGasto, f.vr_desconto_valor);
      } else if (f.vr_desconto_modo === 'percentual' && f.vr_desconto_valor > 0) {
        vrDesconto = Math.round(vrGasto * f.vr_desconto_valor / 100 * 100) / 100;
      }
      if (vrDesconto > 0.004) {
        descontos.push({ codigo: '907', descricao: 'Vale-refeição/alimentação', valor: vrDesconto, natureza: '4.02' });
      }
    }
    if (pensaoValor > 0) {
      descontos.push({ codigo: '904', descricao: 'Pensão alimentícia' +
        (f.pensao_alimenticia && f.pensao_alimenticia.beneficiario_nome ? ' — ' + f.pensao_alimenticia.beneficiario_nome : ''),
        valor: Math.round(pensaoValor * 100) / 100, natureza: '4.02' });
    }
    /* Crédito do trabalhador (Lei 14.438/2022) ou outro empréstimo com
       débito em folha — parcela fixa recorrente, editável por mês via
       extras.credito_trabalhador_valor (pra última parcela com valor
       residual diferente, por exemplo). */
    const creditoValor = extras.credito_trabalhador_valor !== undefined
      ? extras.credito_trabalhador_valor
      : (f.credito_trabalhador && f.credito_trabalhador.ativo ? f.credito_trabalhador.valor_parcela : 0);
    if (creditoValor > 0) {
      descontos.push({ codigo: '906', descricao: 'Crédito do trabalhador' +
        (f.credito_trabalhador && f.credito_trabalhador.instituicao ? ' — ' + f.credito_trabalhador.instituicao : ''),
        valor: Math.round(creditoValor * 100) / 100, natureza: '4.02' });
    }
    (extras.outros_descontos || []).forEach(function (d, i) {
      descontos.push({ codigo: '99' + i, descricao: d.descricao, valor: Math.round((d.valor || 0) * 100) / 100, natureza: '4.02' });
    });

    const totalDescontos = Math.round(descontos.reduce(function (s, d) { return s + d.valor; }, 0) * 100) / 100;
    const liquido = Math.round((totalProventos - totalDescontos) * 100) / 100;

    /* Encargos e provisões — o que soma ao custo pra empresa além do
       que o funcionário recebe. FGTS e INSS patronal incidem sobre o
       bruto TRIBUTÁVEL do mês (sem o salário-família, que é reembolso,
       não remuneração); a provisão de 13º e de férias usa o salário
       atual (não o bruto variável do mês), que é como a maioria das
       empresas provisiona no dia a dia — 1/12 avos por mês fechado. VT
       e VR viram custo pela diferença entre o que a empresa paga e o
       que desconta de volta do funcionário. */
    const inssPatronal = Math.round(baseINSS * dp.aliquota_inss_patronal / 100 * 100) / 100;
    /* RAT×FAP e terceiros (Sistema S) incidem sobre a mesma base que o
       INSS patronal, mas são um encargo à parte — vão pra "Outros
       encargos" (4.08), nunca usada até agora, não pra 4.04 (só INSS
       patronal de verdade). */
    const outrosEncargos = Math.round(baseINSS * (dp.aliquota_rat_fap + dp.aliquota_terceiros) / 100 * 100) / 100;
    /* A provisão de 13º e de férias carrega FGTS e INSS patronal por
       cima: quando esses valores forem pagos, os encargos vão junto.
       Sem isso, o custo por funcionário aparecia menor do que é. */
    const encargosSobreProvisao = (dp.aliquota_fgts + dp.aliquota_inss_patronal +
      dp.aliquota_rat_fap + dp.aliquota_terceiros) / 100;
    const provisaoDecimoBase = Math.round(salarioMes / 12 * 100) / 100;
    const provisaoFeriasBase = Math.round(salarioMes / 12 * (1 + dp.terco_constitucional_ferias) * 100) / 100;
    const provisaoDecimo = Math.round(provisaoDecimoBase * (1 + encargosSobreProvisao) * 100) / 100;
    const provisaoFerias = Math.round(provisaoFeriasBase * (1 + encargosSobreProvisao) * 100) / 100;
    const vrCusto = Math.round((vrGasto - vrDesconto) * 100) / 100;
    const vtCustoEmpresa = Math.round((vtGasto - vtDesconto) * 100) / 100;
    const beneficios = Math.round((vtCustoEmpresa + vrCusto) * 100) / 100;
    const fgts = calcularFGTS(baseINSS);
    const custoTotalEmpresa = Math.round((totalProventos + fgts + inssPatronal + outrosEncargos +
      provisaoDecimo + provisaoFerias + beneficios) * 100) / 100;

    return {
      funcionario: f.id, competencia: competencia,
      proventos: proventos, descontos: descontos,
      total_proventos: totalProventos, total_descontos: totalDescontos, liquido: liquido,
      base_inss: baseINSS, valor_inss: valorINSS,
      base_irrf: baseIRRFEfetiva(baseINSS, valorINSS, f.dependentes_irrf, pensaoValor || 0).base,
      /* Rendimento BRUTO tributável, igual ao que o gozo de férias
         grava: a folha guardava bruto − INSS e o acumulador do mês
         somava grandezas diferentes, retendo menos na complementar. */
      base_irrf_bruta: Math.round((baseINSS) * 100) / 100,
      base_irrf_apos_inss: baseIRRFAntesDeducao,
      /* IRRF do mês que não coube no líquido desta folha. */
      irrf_adiado: irrfAdiado,
      irrf_simplificado: baseIRRFEfetiva(baseINSS, valorINSS, f.dependentes_irrf, pensaoValor || 0).usou_simplificado,
      valor_irrf: valorIRRF,
      salario_familia: salarioFamilia,
      dias_pagos: diasPagos, faltas: faltas, dsr_perdidos: dsrPerdidos,
      dias_ferias_no_mes: diasFerias,
      desconto_faltas: Math.round(salarioMes / diasMes * (faltas + dsrPerdidos) * 100) / 100,
      fgts: fgts, base_fgts: baseINSS, inss_patronal: inssPatronal, outros_encargos: outrosEncargos,
      provisao_decimo: provisaoDecimo, provisao_ferias: provisaoFerias,
      provisao_decimo_base: provisaoDecimoBase, provisao_ferias_base: provisaoFeriasBase,
      encargos_sobre_provisao: Math.round((provisaoDecimo - provisaoDecimoBase +
        provisaoFerias - provisaoFeriasBase) * 100) / 100,
      dias_uteis: uteisPagos,
      vt_custo_empresa: vtCustoEmpresa, vr_custo_empresa: vrCusto, beneficios: beneficios,
      custo_total_empresa: custoTotalEmpresa
    };
  }

  const folhas = f => st.folhas.slice().filter(function (fl) {
    f = f || {};
    return (!f.competencia || fl.competencia === f.competencia);
  }).sort(function (a, b) { return b.competencia.localeCompare(a.competencia); });

  /* Relatório de custo por funcionário — soma o que cada folha fechada
     (não cancelada) já calculou pra cada funcionário, dentro de uma
     faixa de competência. Uma linha por funcionário, com o que ele
     recebeu e o que custou de verdade pra empresa (bruto + encargos +
     provisões + benefícios), pra bater com o que o financeiro cobra
     do dia a dia por CNPJ/projeto. */
  /* Provisão de férias e 13º pro mês — não precisa de folha fechada
     pra existir, é só 1/12 avos do salário de cada funcionário que
     estava na ativa naquele mês. Serve pra DRE não mostrar o custo de
     pessoal desproporcional só no mês em que a férias ou o 13º sai de
     fato — o resultado do ano inteiro fica torto quando o custo inteiro
     aparece de uma vez em vez de espalhado. Isto é referência gerencial,
     não lançamento — não soma no total de despesas junto com o que já
     foi de fato pago, senão contaria a mesma coisa duas vezes. */
  function provisaoMensalPessoal(competencia) {
    const fimMes = U.addDias(U.compDe(U.addMeses(competencia + '-01', 1)) + '-01', -1);
    const ativosNoMes = D.funcionarios.filter(function (f) {
      if (f.admissao > fimMes) return false;
      if (f.ativo) return true;
      return f.desligado_em && f.desligado_em >= (competencia + '-01');
    });
    const dp = D.parametrosDP;
    /* Mesma conta do holerite, encargos incluídos: havia duas
       provisões divergentes para a mesma coisa — a do holerite com os
       34,8% de FGTS, INSS patronal, RAT e terceiros, e esta sem —, e
       os dois números apareciam no sistema como se fossem o mesmo. */
    const fatorEncargos = 1 + (dp.aliquota_fgts + dp.aliquota_inss_patronal +
      dp.aliquota_rat_fap + dp.aliquota_terceiros) / 100;
    let decimo = 0, ferias = 0, decimoBase = 0, feriasBase = 0;
    ativosNoMes.forEach(function (f) {
      const salarioMes = salarioVigenteEm(f, fimMes);
      const d13 = salarioMes / 12;
      const dFer = salarioMes / 12 * (1 + dp.terco_constitucional_ferias);
      decimoBase += d13; feriasBase += dFer;
      decimo += d13 * fatorEncargos;
      ferias += dFer * fatorEncargos;
    });

    /* Saldo acumulado: provisão de um mês não é o passivo. O que a
       empresa deve é o 13º proporcional do ano corrente mais as
       férias já adquiridas e não gozadas — que o sistema sabe calcular
       e ninguém somava. */
    let saldoDecimo = 0, saldoFerias = 0;
    ativosNoMes.forEach(function (f) {
      const salarioMes = salarioVigenteEm(f, fimMes);
      /* Avos do 13º pela MESMA função que o cálculo usa (`avos13`),
         que respeita a regra dos 15 dias do art. 1º §2º: a contagem
         própria daqui dava o mês de admissão cheio qualquer que fosse
         o dia, e o sistema tinha três contagens diferentes para a
         mesma coisa. */
      const inicioAno = competencia.slice(0, 4) + '-01-01';
      saldoDecimo += salarioMes / 12 *
        avos13(f.admissao > inicioAno ? f.admissao : inicioAno, fimMes);
      /* Períodos FECHADOS e não gozados. */
      sincronizarPeriodosFerias(f, fimMes);
      (f.ferias || []).forEach(function (per) {
        const dias = Math.max(0, per.dias_direito - (per.dias_gozados || 0));
        if (!dias) return;
        saldoFerias += salarioMes / 30 * dias * (1 + dp.terco_constitucional_ferias);
      });
      /* E o período EM CURSO, que é a maior parte do passivo de quem
         tira férias em dia e ficava inteiro de fora. */
      const ultimo = (f.ferias || [])
        .map(function (p) { return p.aquisitivo_fim; }).sort().slice(-1)[0];
      const inicioAtual = ultimo ? U.addDias(ultimo, 1) : f.admissao;
      if (inicioAtual <= fimMes) {
        const mesesCurso = Math.min(12, Math.max(0, U.mesesEntre(inicioAtual, fimMes)));
        saldoFerias += salarioMes / 12 * mesesCurso * (1 + dp.terco_constitucional_ferias);
      }
    });

    const r2 = v => Math.round(v * 100) / 100;
    return {
      decimo: r2(decimo), ferias: r2(ferias),
      decimo_base: r2(decimoBase), ferias_base: r2(feriasBase),
      encargos: r2(decimo + ferias - decimoBase - feriasBase),
      saldo_decimo: r2(saldoDecimo * fatorEncargos),
      saldo_ferias: r2(saldoFerias * fatorEncargos),
      passivo: r2((saldoDecimo + saldoFerias) * fatorEncargos),
      funcionarios: ativosNoMes.length
    };
  }

  function custoFuncionarios(filtro) {
    filtro = filtro || {};
    const linhas = {};
    st.folhas.forEach(function (fl) {
      if (fl.cancelada) return;
      if (filtro.competencia_de && fl.competencia < filtro.competencia_de) return;
      if (filtro.competencia_ate && fl.competencia > filtro.competencia_ate) return;
      (fl.holerites || []).forEach(function (h) {
        if (filtro.funcionario && h.funcionario !== filtro.funcionario) return;
        const f = D.funcionario(h.funcionario);
        if (!f) return;
        if (filtro.centro && f.centro !== filtro.centro) return;
        const l = linhas[h.funcionario] = linhas[h.funcionario] || {
          funcionario: f, meses: 0, bruto: 0, liquido: 0, inss: 0, irrf: 0, fgts: 0,
          inss_patronal: 0, outros_encargos: 0, provisao_decimo: 0, provisao_ferias: 0, beneficios: 0, custo_total: 0
        };
        l.meses++;
        l.bruto += h.total_proventos; l.liquido += h.liquido;
        l.inss += h.valor_inss; l.irrf += h.valor_irrf; l.fgts += h.fgts;
        l.inss_patronal += h.inss_patronal || 0; l.outros_encargos += h.outros_encargos || 0;
        l.provisao_decimo += h.provisao_decimo || 0; l.provisao_ferias += h.provisao_ferias || 0;
        l.beneficios += h.beneficios || 0; l.custo_total += h.custo_total_empresa || 0;
      });
    });
    const arred = n => Math.round(n * 100) / 100;
    return Object.keys(linhas).map(function (fid) {
      const l = linhas[fid];
      ['bruto', 'liquido', 'inss', 'irrf', 'fgts', 'inss_patronal', 'outros_encargos', 'provisao_decimo',
        'provisao_ferias', 'beneficios', 'custo_total'].forEach(function (k) { l[k] = arred(l[k]); });
      return l;
    }).sort(function (a, b) { return b.custo_total - a.custo_total; });
  }

  /* Fecha a folha do mês: calcula todo funcionário ativo, lança um
     título por funcionário (paga pelo credor-espelho dele, mesmo CNAB
     de sempre) mais um título de FGTS e um de INSS+IRRF consolidados —
     e guarda tudo isso num registro de lote, igual produtividade, pra
     poder listar e cancelar em cascata depois. Não dá pra fechar duas
     vezes a mesma competência sem cancelar a de antes. */
  /* Quem pode entrar na folha desta competência — admitido depois do
     fim do mês fica de fora (sem isso, uma admissão futura já entrava
     numa folha de mês anterior). Usado tanto no fechamento de verdade
     quanto na prévia da tela, pra nunca mostrar uma coisa e fechar
     outra. Olha se a pessoa estava ativa NAQUELE mês, não se está
     ativa hoje — sem isso, refazer a folha de um mês passado depois
     que alguém foi desligado (em outro mês, mais recente) fazia essa
     pessoa sumir de uma folha onde ela trabalhou o mês inteiro.

     MAS quem tem rescisão lançada com desligamento DENTRO deste mês
     fica de fora mesmo tendo trabalhado uma parte dele — o saldo de
     salário até o dia do desligamento já saiu pela rescisão; incluir
     de novo na folha paga o mesmo mês duas vezes (a folha comum não
     sabe parar no dia do desligamento, paga os 30 dias inteiros). */
  function funcionariosDaFolha(competencia) {
    const fimMes = U.addDias(U.compDe(U.addMeses(competencia + '-01', 1)) + '-01', -1);
    const inicioMes = competencia + '-01';
    return D.funcionarios.filter(function (f) {
      if (f.admissao > fimMes) return false;
      const rescisaoNesteMes = st.titulos.some(function (t) {
        return t.origem === 'rescisao' && t.origem_ref === 'rescisao-' + f.id &&
          t.emissao >= inicioMes && t.emissao <= fimMes &&
          st.parcelas.some(function (p) { return p.titulo_id === t.id && p.status !== 'cancelado'; });
      });
      if (rescisaoNesteMes) return false;
      if (f.ativo) return true;
      return f.desligado_em && f.desligado_em >= inicioMes;
    /* Lista de funcionários é dado pessoal e salarial: sem acesso ao
       DP, sai sem CPF e sem salário. A função devolvia tudo a
       qualquer perfil que a chamasse. */
    }).map(function (f) {
      return visivel('dp', f, { financeiro: veFinanceiro('dp') || pode('dp') });
    });
  }

  /* Já existe rescisão lançada (não cancelada) pra este funcionário? */
  function temRescisaoLancada(f) {
    return st.titulos.some(function (t) {
      if (t.origem !== 'rescisao' || t.origem_ref !== 'rescisao-' + f.id) return false;
      return st.parcelas.some(function (p) { return p.titulo_id === t.id && p.status !== 'cancelado'; });
    });
  }

  /* Quem pode entrar como alvo de rescisão: todo ativo, mais quem já
     foi desligado (pelo botão "Desligar" direto, sem calcular verbas)
     mas ainda não tem rescisão lançada. Sem isso, quem usava aquele
     botão sumia da tela de Rescisão e ficava sem jeito de receber o
     que devia. */
  function funcionariosParaRescisao() {
    return D.funcionarios.filter(function (f) { return f.ativo || !temRescisaoLancada(f); });
  }

  /* Preenche `dias_trabalhados` sozinho quando a admissão cai dentro
     do mês sendo calculado e ninguém informou nada na mão — sem isso,
     quem entrou no meio do mês recebia o mês inteiro na primeira
     folha. Nunca sobrescreve um valor que a pessoa já digitou. */
  function extrasComDiasPadrao(f, competencia, extrasBase) {
    const extras = Object.assign({}, extrasBase || {});
    if (extras.dias_trabalhados === undefined && f.admissao.slice(0, 7) === competencia) {
      /* Quem entra no dia 31 trabalhou 1 dia, não zero: a conta antiga
         (30 − (dia − 1)) zerava o mês de quem era admitido no último
         dia de um mês de 31. O certo é contar da admissão até o fim do
         mês, com o teto de 30 avos da folha. */
      const diaAdmissao = parseInt(f.admissao.slice(8, 10), 10);
      const ultimoDia = parseInt(U.addDias(U.compDe(U.addMeses(competencia + '-01', 1)) + '-01', -1).slice(8, 10), 10);
      extras.dias_trabalhados = Math.max(1, Math.min(30, ultimoDia - diaAdmissao + 1));
    }
    return extras;
  }

  /* Quem deveria estar na folha desta competência mas não tem título
     de salário vivo em nenhuma folha fechada: ficou pendente de
     aprovação no fechamento, foi reativado (rescisão cancelada) ou
     admitido com data retroativa depois do fechamento. */
  function temSalarioNaFolha(f, competencia) {
    return st.titulos.some(function (t) {
      return t.origem === 'folha' && t.origem_ref === 'folha-' + competencia + '-' + f.id &&
        st.parcelas.some(function (p) { return p.titulo_id === t.id && p.status !== 'cancelado'; });
    });
  }
  function funcionariosForaDaFolha(competencia) {
    if (!st.folhas.some(function (fl) { return fl.competencia === competencia && !fl.cancelada; })) return [];
    return funcionariosDaFolha(competencia).filter(function (f) { return !temSalarioNaFolha(f, competencia); });
  }
  // competências com folha fechada que deixaram este funcionário de fora
  function avisoForaDeFolhaFechada(f) {
    const comps = st.folhas.filter(function (fl) { return !fl.cancelada; }).map(function (fl) { return fl.competencia; })
      .filter(function (c, i, a) { return a.indexOf(c) === i; })
      .filter(function (c) { return funcionariosForaDaFolha(c).some(function (x) { return x.id === f.id; }); });
    return comps.length
      ? f.nome + ' ficou fora da folha já fechada de ' + comps.map(U.fComp).join(', ') +
        ' — feche uma folha complementar na aba Folha.'
      : null;
  }

  function fecharFolha(competencia, ajustesPorFuncionario, opcoes) {
    opcoes = opcoes || {};
    if (!pode('fechar_folha')) {
      return { erro: 'Seu perfil não fecha folha — é a aprovação do módulo de Pessoal.' };
    }
    if (!competencia) return { erro: 'Informe a competência.' };
    const dp = D.parametrosDP;
    const folhasVivas = st.folhas.filter(function (fl) { return fl.competencia === competencia && !fl.cancelada; });
    const complementar = !!opcoes.complementar;
    if (!complementar && folhasVivas.length) {
      return { erro: 'Já existe uma folha fechada para ' + U.fComp(competencia) + '. Cancele antes de refazer, ' +
        'ou feche uma folha complementar pra quem ficou de fora.' };
    }
    if (complementar && !folhasVivas.length) {
      return { erro: 'Não há folha fechada em ' + U.fComp(competencia) + ' — feche a folha normal primeiro.' };
    }
    /* Guias da complementar ganham sufixo próprio (-c1, -c2…) — são um
       recolhimento a mais da mesma competência, não substituem as da
       folha principal. */
    const sufixo = complementar ? '-c' + folhasVivas.length : '';
    /* Só entra na folha quem já estava ativo até o fim do mês — sem
       isso, uma admissão cadastrada pra o futuro (dezembro, digamos)
       já aparecia na folha de um mês anterior, o que não faz sentido:
       a pessoa ainda nem tinha sido contratada naquela competência. */
    let ativos;
    if (complementar) {
      const fora = funcionariosForaDaFolha(competencia);
      if (!fora.length) return { erro: 'Ninguém ficou de fora da folha de ' + U.fComp(competencia) + '.' };
      // só entra quem já pode receber — quem continua pendente de aprovação ficaria de fora de novo
      ativos = fora.filter(function (f) { return f.pagamento_aprovado !== false; });
      if (!ativos.length) {
        return { erro: 'Quem ficou de fora ainda está com dados de pagamento pendentes de aprovação: ' +
          fora.map(function (f) { return f.nome; }).join(', ') + '. Aprove antes de fechar a complementar.' };
      }
    } else {
      ativos = funcionariosDaFolha(competencia);
      if (!ativos.length) return { erro: 'Nenhum funcionário ativo nesta competência.' };
    }

    /* Tudo daqui pra frente cria título de verdade em st.parcelas —
       se estourar um erro de programação no meio do caminho (já
       aconteceu uma vez: uma variável não declarada), os títulos já
       criados até ali ficavam órfãos, sem nenhuma folha pra
       referenciá-los, e a aba Custos não os enxergava. Envolver tudo
       num try/catch e desfazer (cancelar) o que já tinha sido criado
       se algo quebrar no meio é a rede de segurança — não substitui
       corrigir o bug em si, mas evita que o PRÓXIMO bug deixe lixo
       pra trás. */
    const tituloIds = [];
    try {
    const p = competencia.split('-');
    const fimMes = new Date(Date.UTC(+p[0], +p[1], 0));
    const dataFolha = fimMes.toISOString().slice(0, 10);
    const vencLiquido = quintoDiaUtil(competencia);                        // 5º dia útil do mês seguinte
    const vencEncargos = antecipaSeFimDeSemana(U.addDias(dataFolha, 20));   // FGTS e guia de INSS/IRRF, referência

    const holerites = [];
    let totalLiquido = 0, totalFGTS = 0, totalINSS = 0, totalIRRF = 0, totalINSSPatronal = 0, totalOutrosEncargos = 0, totalSalarioFamilia = 0;
    const erros = [];
    /* Rateio por centro do que vai pras guias consolidadas (FGTS,
       INSS patronal, e a parte de INSS+IRRF retida) — cada funcionário
       contribui pro centro dele (ou rateado, se tiver rateio de
       verdade), em vez de tudo cair sempre na matriz. Sem isso, o
       custo de um funcionário alocado num projeto específico (o caso
       da Iron Trainers) nunca aparecia nesse projeto — só o líquido
       dele aparecia lá, os encargos iam inteiros pra cc100. */
    const porCentroFGTS = {}, porCentroINSSPatronal = {}, porCentroRetido = {}, porCentroOutrosEncargos = {};

    let incluidos = 0;
    /* CONFERÊNCIA PRÉVIA, antes de gravar qualquer coisa: líquido
       negativo é erro de lançamento (falta ou desconto digitado
       errado), não pendência. Antes a folha fechava com a pessoa
       descartada — sem holerite, sem título, com as guias do mês
       reduzidas — e a volta era cancelar tudo e refazer. É mais
       barato corrigir o campo.

       Quem precisar fechar assim mesmo (adiantamento maior que o mês
       é caso real) passa `aceitar_liquido_negativo`, e aí a exclusão
       fica registrada como decisão, não como acidente. */
    if (!opcoes.aceitar_liquido_negativo) {
      const impedidos = [];
      ativos.forEach(function (f) {
        const prev = calcularHolerite(f.id, competencia,
          extrasComDiasPadrao(f, competencia, (ajustesPorFuncionario || {})[f.id]));
        if (prev.erro) { impedidos.push(f.nome + ': ' + prev.erro); return; }
        if (prev.liquido < 0) {
          impedidos.push(f.nome + ': líquido do mês deu negativo (' + U.brl(prev.liquido) + ')');
        }
      });
      if (impedidos.length) {
        return { erro: impedidos.join(' · ') + '. Revise faltas e descontos antes de fechar — ' +
          'nada foi gravado.', liquido_negativo: true, impedidos: impedidos };
      }
    }

    ativos.forEach(function (f) {
      const extras = extrasComDiasPadrao(f, competencia, (ajustesPorFuncionario || {})[f.id]);
      const h = calcularHolerite(f.id, competencia, extras);

      /* Líquido negativo é ERRO DE LANÇAMENTO, não pendência: alguém
         digitou falta ou desconto errado. Antes a folha fechava com
         a pessoa descartada — 2 holerites em vez de 3, sem título,
         com as guias reduzidas — e só o aviso na tela denunciava.
         Depois de fechada, a volta é cancelar tudo e refazer.

         Agora o fechamento PARA: é mais barato corrigir o campo que
         desfazer uma folha. Quem precisar fechar assim mesmo (caso
         real de adiantamento maior que o mês) usa
         `opcoes.aceitar_liquido_negativo`, que deixa rastro. */
      if (h.liquido < 0) {
        erros.push(f.nome + ': líquido do mês deu negativo (' + U.brl(h.liquido) + ') — ficou de fora ' +
          'desta folha por decisão de quem fechou.');
        return;
      }
      /* Quem não pode ser pago fica de fora da folha INTEIRA — salário,
         pensão E encargos. Antes os encargos dele entravam nas guias
         desta folha mesmo sem título de salário, e a folha complementar
         gerava os mesmos encargos de novo (FGTS, patronal e retidos em
         dobro). Agora tudo dele vai junto na complementar. */
      if (h.liquido > 0.004 && (!f.credor_id || !D.credor(f.credor_id))) {
        erros.push(f.nome + ': sem credor cadastrado — abra o funcionário em Editar e salve de novo ' +
          'pra gerar o fornecedor-espelho, ou recadastre. Ficou de fora desta folha (salário e encargos).');
        return;
      }
      if (h.liquido > 0.004 && f.pagamento_aprovado === false) {
        erros.push(f.nome + ': dados de pagamento ainda não aprovados por quem tem alçada — ficou de fora ' +
          'desta folha (salário e encargos). Depois de aprovar, feche a folha complementar.');
        return;
      }
      if (h.liquido > 0.004) {
        const r = criarTitulo({
          _interno: true,
          descricao: 'Salário ' + U.fComp(competencia) + ' — ' + f.nome,
          documento: 'FOLHA-' + competencia + '-' + f.matricula,
          tipo_titulo: 'folha', credor: f.credor_id, conta: '4.01',
          centro: (f.rateio || [])[0] ? f.rateio[0].centro : f.centro, rateio: f.rateio,
          emissao: dataFolha, origem: 'folha', origem_ref: 'folha-' + competencia + '-' + f.id,
          obs: 'Líquido da folha — proventos ' + U.brl(h.total_proventos) + ', descontos ' + U.brl(h.total_descontos)
        }, [{ num: 1, venc: vencLiquido, comp: competencia, valor: h.liquido }]);
        if (!r.ok) { erros.push(f.nome + ': ' + r.erro + ' Ficou de fora desta folha (salário e encargos).'); return; }
        tituloIds.push(r.titulo.id);
        /* Fecha como PREVISÃO: entra em Despesas Previstas na hora e
           alguém confirma com "Efetivar" quando for pagar. */
        st.parcelas.filter(function (pc) { return pc.titulo_id === r.titulo.id; })
          .forEach(function (pc) { pc.status = 'previsto'; });
      }
      // só quem entrou de fato soma nos totais e nas guias
      holerites.push(h);
      incluidos++;
      totalLiquido = Math.round((totalLiquido + h.liquido) * 100) / 100;
      totalFGTS = Math.round((totalFGTS + h.fgts) * 100) / 100;
      totalINSS = Math.round((totalINSS + h.valor_inss) * 100) / 100;
      totalIRRF = Math.round((totalIRRF + h.valor_irrf) * 100) / 100;
      totalINSSPatronal = Math.round((totalINSSPatronal + h.inss_patronal) * 100) / 100;
      totalOutrosEncargos = Math.round((totalOutrosEncargos + h.outros_encargos) * 100) / 100;
      totalSalarioFamilia = Math.round((totalSalarioFamilia + (h.salario_familia || 0)) * 100) / 100;
      acumularPorCentro(porCentroFGTS, f, h.fgts);
      acumularPorCentro(porCentroINSSPatronal, f, h.inss_patronal);
      acumularPorCentro(porCentroRetido, f, h.valor_inss + h.valor_irrf);
      acumularPorCentro(porCentroOutrosEncargos, f, h.outros_encargos);

      /* Pensão alimentícia descontada deste funcionário vira título à
         parte, pro beneficiário — não fica só um desconto no papel sem
         ninguém receber o dinheiro de verdade. Valor e dados bancários
         vêm do cadastro do funcionário por padrão (ver
         calcularHolerite) — só usa o que veio em `extras` se alguém
         alterou pra este mês especificamente. */
      const pensaoCadastro = f.pensao_alimenticia && f.pensao_alimenticia.ativo ? f.pensao_alimenticia : null;
      // o que o holerite descontou de fato (já sem a pensão paga nas férias do mês)
      const pensaoValorFolha = (h.descontos.find(function (d) { return d.codigo === '904'; }) || {}).valor || 0;
      if (pensaoValorFolha > 0.004) {
        if (!pensaoCadastro || !pensaoCadastro.beneficiario_nome) {
          erros.push(f.nome + ': pensão alimentícia sem beneficiário cadastrado — abra o funcionário em ' +
            'Editar e cadastre o beneficiário antes de fechar.');
        } else {
          const credorPensao = credorPensionista(f);
          const rp = criarTitulo({
            _interno: true, descricao: 'Pensão alimentícia — ' + pensaoCadastro.beneficiario_nome +
              ' (desconto de ' + f.nome + ')',
            documento: 'PENSAO-' + competencia + '-' + f.matricula,
            tipo_titulo: 'pensao', credor: credorPensao, conta: '4.01',
            centro: (f.rateio || [])[0] ? f.rateio[0].centro : f.centro, rateio: f.rateio,
            emissao: dataFolha, origem: 'folha', origem_ref: 'folha-pensao-' + competencia + '-' + f.id,
            obs: 'Descontado do salário de ' + f.nome + ' na folha de ' + U.fComp(competencia) + '.'
          }, [{ num: 1, venc: vencLiquido, comp: competencia, valor: Math.round(pensaoValorFolha * 100) / 100 }]);
          if (rp.ok) {
            tituloIds.push(rp.titulo.id);
            st.parcelas.filter(function (pc) { return pc.titulo_id === rp.titulo.id; })
              .forEach(function (pc) { pc.status = 'previsto'; });
          } else erros.push(f.nome + ' (pensão): ' + rp.erro);
        }
      }

      /* Crédito do trabalhador descontado deste funcionário também vira
         título à parte, pra instituição financeira — mesma lógica da
         pensão, mesmo motivo (senão o desconto só desaparece da conta,
         sem repasse nenhum). */
      const creditoCadastro = f.credito_trabalhador && f.credito_trabalhador.ativo ? f.credito_trabalhador : null;
      const creditoValorFolha = extras.credito_trabalhador_valor !== undefined
        ? extras.credito_trabalhador_valor : (creditoCadastro ? creditoCadastro.valor_parcela : 0);
      if (creditoValorFolha > 0.004) {
        const credorCredito = credorInstituicaoCredito(f);
        const rc = criarTitulo({
          _interno: true, descricao: 'Crédito do trabalhador — ' + (creditoCadastro ? creditoCadastro.instituicao : '') +
            ' (desconto de ' + f.nome + ')',
          documento: 'CREDITO-' + competencia + '-' + f.matricula,
          tipo_titulo: 'credito_trabalhador', credor: credorCredito, conta: '4.01',
          centro: (f.rateio || [])[0] ? f.rateio[0].centro : f.centro, rateio: f.rateio,
          emissao: dataFolha, origem: 'folha', origem_ref: 'folha-credito-' + competencia + '-' + f.id,
          obs: 'Descontado do salário de ' + f.nome + ' na folha de ' + U.fComp(competencia) + '.'
        }, [{ num: 1, venc: vencLiquido, comp: competencia, valor: Math.round(creditoValorFolha * 100) / 100 }]);
        if (rc.ok) {
          tituloIds.push(rc.titulo.id);
          st.parcelas.filter(function (pc) { return pc.titulo_id === rc.titulo.id; })
            .forEach(function (pc) { pc.status = 'previsto'; });
        } else erros.push(f.nome + ' (crédito do trabalhador): ' + rc.erro);
      }
    });

    /* FGTS, INSS patronal e a parte de INSS+IRRF retida viram guia
       consolidada, não um título por pessoa. O credor aqui é a
       Caixa/Receita; sem um credor de guia já cadastrado, usa o
       primeiro credor tipo "orgao" que achar, ou fica sem credor
       definido (título nasce travado, sinalizando que falta
       cadastrar). Cada guia usa o rateio por centro acumulado acima,
       em vez de cair sempre na matriz. */
    const credorGuia = credorGuiaDe('federal');
    if (totalFGTS > 0.004) {
      const rat = rateioDeBucket(porCentroFGTS);
      const r = criarTitulo({
        _interno: true, descricao: 'FGTS ' + U.fComp(competencia), documento: 'FGTS-' + competencia + sufixo,
        tipo_titulo: 'guia', credor: credorGuiaDe('fgts'), conta: '4.03',
        centro: rat ? rat[0].centro : 'cc100', rateio: rat,
        emissao: dataFolha, origem: 'folha', origem_ref: 'folha-fgts-' + competencia + sufixo,
        obs: '8% sobre a base de INSS de todos os funcionários da folha.'
      }, [{ num: 1, venc: vencEncargos, comp: competencia, valor: totalFGTS }]);
      if (r.ok) {
        tituloIds.push(r.titulo.id);
        st.parcelas.filter(function (pc) { return pc.titulo_id === r.titulo.id; })
          .forEach(function (pc) { pc.status = 'previsto'; });
      } else erros.push('FGTS: ' + r.erro);
    }
    /* INSS patronal é encargo GENUÍNO da empresa — não tinha título
       nenhum antes, e por isso nem aparecia no fluxo de caixa nem na
       DRE. Vai pra 4.04 (é o que esse plano de contas já reserva pra
       "INSS", como confirma o lançamento de exemplo já cadastrado —
       INSS retido do FUNCIONÁRIO não é a mesma coisa, e por isso não
       entra aqui: ver a nota abaixo). */
    /* INSS patronal e RAT×FAP+terceiros incidem sobre a mesma base e
       saem juntos na MESMA guia de verdade (GPS/DCTFWeb) — por isso um
       título só aqui, não dois. Salário-família que a empresa
       adiantou aos funcionários é reembolsado por COMPENSAÇÃO direto
       nesta guia — não é a empresa que "perde" esse dinheiro, é a
       Receita que desconta do que ela devia recolher. Sem abater
       aqui, o sistema cobrava a guia cheia e fingia que o
       salário-família tinha sido uma despesa a mais, quando na
       prática ele se paga sozinho. */
    const totalPatronalEEncargos = Math.round((totalINSSPatronal + totalOutrosEncargos) * 100) / 100;
    const patronalAPagar = Math.max(0, Math.round((totalPatronalEEncargos - totalSalarioFamilia) * 100) / 100);
    if (patronalAPagar > 0.004) {
      const bucketPatronal = {};
      Object.keys(porCentroINSSPatronal).forEach(function (c) { bucketPatronal[c] = (bucketPatronal[c] || 0) + porCentroINSSPatronal[c]; });
      Object.keys(porCentroOutrosEncargos).forEach(function (c) { bucketPatronal[c] = Math.round(((bucketPatronal[c] || 0) + porCentroOutrosEncargos[c]) * 100) / 100; });
      const rat = rateioDeBucket(bucketPatronal);
      const r = criarTitulo({
        _interno: true, descricao: 'INSS patronal + RAT×FAP + terceiros ' + U.fComp(competencia), documento: 'GPS-PATRONAL-' + competencia + sufixo,
        tipo_titulo: 'guia', credor: credorGuia, conta: '4.04',
        centro: rat ? rat[0].centro : 'cc100', rateio: rat,
        emissao: dataFolha, origem: 'folha', origem_ref: 'folha-inss-patronal-' + competencia + sufixo,
        obs: dp.aliquota_inss_patronal + '% de INSS patronal (' + U.brl(totalINSSPatronal) + ') + ' +
          (dp.aliquota_rat_fap + dp.aliquota_terceiros) + '% de RAT×FAP/terceiros (' + U.brl(totalOutrosEncargos) +
          ') sobre o bruto de todos os funcionários da folha' +
          (totalSalarioFamilia > 0.004
            ? ', menos ' + U.brl(totalSalarioFamilia) + ' de salário-família compensado direto na guia' : '') +
          ' — encargo da empresa, não desconto do funcionário. Confirme as alíquotas de RAT×FAP e terceiros ' +
          'com o contador, são as que mais variam de empresa pra empresa neste cálculo.'
      }, [{ num: 1, venc: vencEncargos, comp: competencia, valor: patronalAPagar }]);
      if (r.ok) {
        tituloIds.push(r.titulo.id);
        st.parcelas.filter(function (pc) { return pc.titulo_id === r.titulo.id; })
          .forEach(function (pc) { pc.status = 'previsto'; });
      } else erros.push('INSS patronal: ' + r.erro);
    }
    /* INSS e IRRF RETIDOS do funcionário não são um encargo A MAIS —
       são a parte do salário BRUTO que não vai pro bolso dele, vai pro
       governo. Por isso entram na MESMA conta do salário (4.01), não
       em "INSS" (4.04, que é só o patronal): salário líquido (4.01,
       título por pessoa) + este título (4.01 também) soma o bruto
       certinho. Iam pra 4.04 antes, misturados com o patronal — dobrava
       a conta e ainda incluía IRRF, que nem é encargo de folha. */
    const totalRetido = Math.round((totalINSS + totalIRRF) * 100) / 100;
    if (totalRetido > 0.004) {
      const rat = rateioDeBucket(porCentroRetido);
      const r = criarTitulo({
        _interno: true, descricao: 'INSS + IRRF retidos dos funcionários ' + U.fComp(competencia),
        documento: 'GPS-DARF-' + competencia + sufixo,
        tipo_titulo: 'guia', credor: credorGuia, conta: '4.01',
        centro: rat ? rat[0].centro : 'cc100', rateio: rat,
        emissao: dataFolha, origem: 'folha', origem_ref: 'folha-guia-' + competencia + sufixo,
        obs: 'INSS ' + U.brl(totalINSS) + ' + IRRF ' + U.brl(totalIRRF) + ' retidos de todos os funcionários — ' +
          'é a parte do salário bruto que vai pro governo em vez do bolso deles, por isso soma na mesma ' +
          'conta do salário líquido. Recolhimento simplificado numa guia só — separe por guia real ' +
          '(GPS/DARF) se precisar.'
      }, [{ num: 1, venc: vencEncargos, comp: competencia, valor: totalRetido }]);
      if (r.ok) {
        tituloIds.push(r.titulo.id);
        st.parcelas.filter(function (pc) { return pc.titulo_id === r.titulo.id; })
          .forEach(function (pc) { pc.status = 'previsto'; });
      } else erros.push('INSS/IRRF retidos: ' + r.erro);
    }

    const folha = {
      id: novoId('fl'), competencia: competencia, titulo_ids: tituloIds, complementar: complementar,
      funcionarios: incluidos, total_liquido: totalLiquido, total_fgts: totalFGTS,
      total_inss: totalINSS, total_irrf: totalIRRF, total_inss_patronal: totalINSSPatronal,
      total_outros_encargos: totalOutrosEncargos,
      holerites: holerites, cancelada: false,
      criado_por: usuario().nome, criado_por_id: (usuario() || {}).id || null, criado_em: new Date()
    };
    st.folhas.push(folha);
    logar('folha', folha.id, complementar ? 'fechou folha complementar' : 'fechou folha', U.fComp(competencia) + ' · ' + incluidos + ' funcionário(s) · ' +
      U.brl(totalLiquido) + ' líquido');
    return { ok: true, folha: folha, erros: erros };
    } catch (e) {
      /* Algo quebrou no meio do fechamento — desfaz (cancela) todo
         título que já tinha sido criado até aqui, em vez de deixar
         órfão sem folha nenhuma pra referenciar. O erro original vai
         junto na mensagem, pra dar pra corrigir o bug de verdade. */
      tituloIds.forEach(function (tid) {
        st.parcelas.filter(function (p) { return p.titulo_id === tid && p.status !== 'cancelado'; })
          .forEach(function (p) { cancelar(p.id, 'Fechamento de folha falhou no meio do processo — desfeito automaticamente.', true); });
      });
      logar('folha', competencia, 'erro ao fechar folha — títulos desfeitos', String(e && e.message || e));
      return { erro: 'Deu erro ao fechar a folha (' + String(e && e.message || e) + '). Nada ficou pendurado — ' +
        'os títulos que já tinham sido criados foram desfeitos. Avise quem cuida do sistema.' };
    }
  }

  /* (integrado do ramo paralelo de QA) Cancelamento parcial de folha:
     a guia de encargos é RECALCULADA a partir dos holerites que
     sobraram, não cancelada por inteiro. FGTS, INSS patronal e
     retidos são uma guia só para a folha toda; cancelar a folha com
     um salário já pago apagava o encargo daquele salário também —
     numa folha de três pessoas (R$ 14.831,43) com uma paga, sobravam
     R$ 3.622,60 e R$ 1.854,20 de encargo sumiam. */
  function cancelarFolha(id, motivo, forcar) {
    if (!pode('dp')) return { erro: 'Seu perfil não cancela folha.' };
    const fl = st.folhas.find(function (x) { return x.id === id; });
    if (!fl) return { erro: 'Folha não encontrada.' };
    if (fl.cancelada) return { erro: 'Esta folha já foi cancelada.' };
    if (!motivo) return { erro: 'Informe o motivo do cancelamento.' };
    const parcelasDaFolha = st.parcelas.filter(function (p) { return fl.titulo_ids.indexOf(p.titulo_id) > -1; });
    const jaPagas = parcelasDaFolha.filter(function (p) { return pagamentosDe(p.id).length > 0; });
    if (jaPagas.length && !forcar) {
      return { erro: jaPagas.length + ' pagamento(s) desta folha já saíram do banco. Force o cancelamento ' +
        'parcial se precisar mesmo assim, ou estorne os pagamentos antes.', jaPagas: jaPagas.length };
    }
    let n = 0;
    const puladas = [];
    const tituloDaParcela = function (p) {
      return st.titulos.find(function (x) { return x.id === p.titulo_id; }) || {};
    };
    const ehGuia = function (p) { return p.tipo_titulo === 'guia'; };
    /* Os salários primeiro: é o que sobrevive (ou não) que define
       quanto de encargo continua devido. */
    parcelasDaFolha.filter(function (p) { return !ehGuia(p); }).forEach(function (p) {
      if (p.status === 'cancelado') { n++; return; }
      /* `_interno`: quem chegou até aqui já passou por `pode('dp')` lá
         em cima — sem isso, esta chamada interna exigia a permissão
         'cancelar' (diretoria/sócio) de novo, e o perfil de DP nunca
         tinha essa ação. O cancelamento falhava calado em todas as
         parcelas, e a folha ainda assim aparecia como "cancelada
         parcialmente" — sem nada realmente cancelado. */
      const r = cancelar(p.id, motivo, true);
      if (r.ok) n++; else puladas.push(p);
    });

    /* FGTS, INSS patronal e INSS+IRRF retidos são UMA guia para a folha
       inteira. Cancelá-las por inteiro quando um salário sobrevive —
       porque já foi pago e não dá para cancelar — destruía a obrigação
       de recolher encargo sobre um salário efetivamente pago, e o
       único sinal disso era um `puladas: 1` no retorno. A folha
       complementar também não refaz esses encargos, porque quem ficou
       não está "fora da folha": o salário dele segue vivo.

       Então, havendo sobrevivente, a guia não é cancelada: é REDUZIDA
       à parte de quem sobrou, recalculada a partir dos holerites
       guardados na folha. Sem sobrevivente, segue cancelando tudo. */
    const sobreviventes = puladas.map(function (p) {
      const ref = tituloDaParcela(p).origem_ref || '';
      const m = /^folha-(?:pensao-|credito-)?\d{4}-\d{2}-(.+)$/.exec(ref);
      return m ? m[1] : null;
    }).filter(Boolean);
    const hs = (fl.holerites || []).filter(function (h) {
      return sobreviventes.indexOf(h.funcionario) > -1;
    });
    const somaH = function (campo) {
      return Math.round(hs.reduce(function (a, h) { return a + (h[campo] || 0); }, 0) * 100) / 100;
    };
    const restoDaGuia = {
      fgts: somaH('fgts'),
      patronal: Math.max(0, Math.round((somaH('inss_patronal') + somaH('outros_encargos') -
        somaH('salario_familia')) * 100) / 100),
      retido: Math.round((somaH('valor_inss') + somaH('valor_irrf')) * 100) / 100
    };
    const reduzidas = [];
    const avisos = [];
    parcelasDaFolha.filter(ehGuia).forEach(function (p) {
      if (p.status === 'cancelado') { n++; return; }
      const ref = tituloDaParcela(p).origem_ref || '';
      const tipo = /^folha-fgts-/.test(ref) ? 'fgts'
        : /^folha-inss-patronal-/.test(ref) ? 'patronal'
        : /^folha-guia-/.test(ref) ? 'retido' : null;
      const resto = (hs.length && tipo) ? restoDaGuia[tipo] : 0;
      if (resto > 0.004) {
        /* Guia já paga não dá para reduzir: avisa, para alguém estornar
           e refazer, em vez de deixar o número errado. */
        if (p.status === 'pago' || pagamentosDe(p.id).length || emCursoDe(p.id).length) {
          puladas.push(p);
          avisos.push(p.descricao + ': já tem pagamento, e deveria cair para ' + U.brl(resto) +
            ' (a parte de quem continua na folha). Estorne o pagamento e refaça.');
          return;
        }
        const de = p.valor;
        p.valor = resto;
        p.obs = (p.obs ? p.obs + ' · ' : '') + 'Reduzida de ' + U.brl(de) + ' para ' + U.brl(resto) +
          ' no cancelamento parcial da folha (' + motivo + '): sobrou o encargo de ' +
          hs.length + ' funcionário(s) cujo salário já havia sido pago.';
        recalcularTotalTitulo(p.titulo_id);
        reduzidas.push({ parcela: p.id, descricao: p.descricao, de: de, para: resto });
        logar('folha', fl.id, 'reduziu guia no cancelamento parcial',
          p.descricao + ' · ' + U.brl(de) + ' → ' + U.brl(resto));
        return;
      }
      const r = cancelar(p.id, motivo, true);
      if (r.ok) n++; else puladas.push(p);
    });

    fl.cancelada = n === parcelasDaFolha.length;
    fl.cancelada_parcial = !fl.cancelada;
    fl.motivo_cancelamento = motivo;
    fl.cancelado_por = usuario().nome;
    fl.cancelado_em = new Date();
    if (reduzidas.length) fl.guias_reduzidas = reduzidas;
    logar('folha', fl.id, fl.cancelada ? 'cancelou folha' : 'cancelou folha parcialmente',
      n + ' de ' + parcelasDaFolha.length + ' · ' + motivo +
      (reduzidas.length ? ' · ' + reduzidas.length + ' guia(s) reduzida(s)' : ''));
    return { ok: true, n: n, puladas: puladas.length,
      guias_reduzidas: reduzidas,
      aviso: avisos.length ? avisos.join(' ') : (reduzidas.length
        ? reduzidas.map(function (x) {
            return x.descricao + ': ' + U.brl(x.de) + ' → ' + U.brl(x.para);
          }).join(' · ') + '. O encargo de quem já teve o salário pago continua devido.'
        : null) };
  }

  /* ── 13º salário ─────────────────────────────────────────
     Duas parcelas: a 1ª (até 30/11) é metade do total, sem desconto
     nenhum. INSS e IRRF só entram na 2ª (até 20/12), calculados sobre
     o TOTAL do ano — não sobre a 2ª parcela isolada, que é só o total
     menos o que já saiu na 1ª. Avos contam pelo ANO CIVIL (diferente
     de férias, que conta pelo período aquisitivo — são coisas
     diferentes de propósito). */
  /* Quanto este funcionário RECEBEU de fato da 1ª parcela do 13º do
     ano — soma dos títulos 'decimo-1-<ano>-<id>' não cancelados. Quem
     estava desligado quando a 1ª parcela fechou (e foi reativado
     depois) não tem título nenhum, e não pode ter nada descontado. */
  function primeiraParcela13Paga(f, ano) {
    const ref = 'decimo-1-' + ano + '-' + f.id;
    let total = 0;
    st.titulos.forEach(function (t) {
      if (t.origem !== 'decimo' || t.origem_ref !== ref) return;
      st.parcelas.forEach(function (p) {
        if (p.titulo_id === t.id && p.status !== 'cancelado') total += p.valor;
      });
    });
    return Math.round(total * 100) / 100;
  }

  // dias de férias (gozos não cancelados) dentro de [ini, fim], inclusive
  function diasFeriasEntre(f, ini, fim, incluirTemporario) {
    let dias = 0;
    (f.ferias || []).forEach(function (per) {
      (per.gozos || []).forEach(function (g) {
        if (g.cancelado || (g.__temporario && !incluirTemporario)) return;
        if (!g.data_inicio || !(g.dias_gozo > 0)) return;   // registro incompleto não conta
        const fimGozo = U.addDias(g.data_inicio, g.dias_gozo - 1);
        const a = g.data_inicio > ini ? g.data_inicio : ini;
        const b = fimGozo < fim ? fimGozo : fim;
        if (a <= b) dias += U.diasEntre(a, b) + 1;
      });
    });
    return dias;
  }

  function calcular13(funcionarioId, ano, parcela) {
    /* Argumento ruim devolve {erro}, não exceção: no navegador a
       exceção é o clique que não responde. */
    if (!/^\d{4}$/.test(String(ano))) {
      return { erro: 'Ano inválido (' + JSON.stringify(ano) + ').' };
    }
    const f = D.funcionario(funcionarioId);
    if (!f) return { erro: 'Funcionário não encontrado.' };
    if (parcela !== 1 && parcela !== 2) return { erro: 'Parcela tem que ser 1 ou 2.' };
    const fimAno = ano + '-12-31';
    /* O 13º integra a média das variáveis habituais do ano (Lei 4.090
       art. 1º §1º e Súmula 347 do TST): horas extras e adicional
       noturno habituais ficavam de fora, embora gravados em cada
       holerite. */
    const mediaVar13 = mediaVariaveisHabituais(f, ano + '-01', ano + '-12');
    const salarioMes = salarioVigenteEm(f, fimAno) +
      adicionalHabitual(f, salarioVigenteEm(f, fimAno)) + mediaVar13;
    const inicioAno = ano + '-01-01';
    const inicioContagem = f.admissao > inicioAno ? f.admissao : inicioAno;
    const avos = avos13(inicioContagem, fimAno);
    const valorTotalAno = Math.round(salarioMes / 12 * avos * 100) / 100;
    const primeiraParcela = Math.round(valorTotalAno / 2 * 100) / 100;

    if (parcela === 1) {
      return {
        funcionario: f.id, ano: ano, parcela: 1, avos: avos, salario_referencia: salarioMes,
        valor_total_ano: valorTotalAno, valor: primeiraParcela,
        valor_inss: 0, valor_irrf: 0, liquido: primeiraParcela
      };
    }
    const valorINSS = calcularINSS(valorTotalAno);
    /* Pensão alimentícia incide sobre o 13º como sobre qualquer outro
       rendimento — reduz a base do IRRF e desconta do líquido de
       verdade. Só na 2ª parcela: é onde IRRF e INSS entram; a 1ª não
       tem desconto nenhum (adiantamento sem tributação). */
    const pensaoCadastro = f.pensao_alimenticia && f.pensao_alimenticia.ativo ? f.pensao_alimenticia : null;
    // proporcional aos avos (ano inteiro = valor cheio), mesma regra da rescisão
    const pensaoValor = (pensaoCadastro && pensaoCadastro.incide_13 !== false) ? Math.round(pensaoCadastro.valor * avos / 12 * 100) / 100 : 0;
    const valorIRRF = calcularIRRF(valorTotalAno, valorINSS, f.dependentes_irrf, pensaoValor);
    /* Desconta o que a pessoa REALMENTE recebeu na 1ª parcela, não a
       metade teórica — quem estava fora quando a 1ª fechou recebe o 13º
       inteiro aqui. */
    const primeiraPaga = primeiraParcela13Paga(f, ano);
    const segundaParcela = Math.round((valorTotalAno - primeiraPaga) * 100) / 100;
    const liquido = Math.round((segundaParcela - valorINSS - valorIRRF - pensaoValor) * 100) / 100;
    return {
      funcionario: f.id, ano: ano, parcela: 2, avos: avos, salario_referencia: salarioMes,
      valor_total_ano: valorTotalAno, primeira_parcela: primeiraPaga,
      valor: segundaParcela, valor_inss: valorINSS, valor_irrf: valorIRRF,
      pensao_alimenticia: pensaoValor, liquido: liquido
    };
  }

  function decimos(filtro) {
    filtro = filtro || {};
    return st.decimos.slice().filter(function (d) { return !filtro.ano || d.ano === filtro.ano; })
      .sort(function (a, b) { return (b.ano + b.parcela).localeCompare(a.ano + a.parcela); });
  }

  function fechar13(ano, parcela) {
    if (!pode('dp')) return { erro: 'Seu perfil não fecha 13º salário.' };
    if (!ano) return { erro: 'Informe o ano.' };
    if (parcela !== 1 && parcela !== 2) return { erro: 'Parcela tem que ser 1 ou 2.' };
    if (st.decimos.some(function (d) { return d.ano === ano && d.parcela === parcela && !d.cancelado; })) {
      return { erro: 'Já existe a ' + parcela + 'ª parcela do 13º de ' + ano + ' fechada. Cancele antes de refazer.' };
    }
    if (parcela === 2 && !st.decimos.some(function (d) { return d.ano === ano && d.parcela === 1 && !d.cancelado; })) {
      return { erro: 'Feche a 1ª parcela antes da 2ª.' };
    }
    const ativos = D.funcionarios.filter(function (f) { return f.ativo && f.admissao <= (ano + '-12-31'); });
    if (!ativos.length) return { erro: 'Nenhum funcionário ativo neste ano.' };

    // vencimento oficial (30/11 ou 20/12) antecipado se cair em fim de semana
    const dataDoc = antecipaSeFimDeSemana(parcela === 1 ? ano + '-11-30' : ano + '-12-20');
    const tituloIds = [];
    const calculos = [];
    let totalLiquido = 0, totalINSS = 0, totalIRRF = 0, totalINSSPatronal = 0, totalFGTS = 0, totalOutrosEncargos = 0;
    const erros = [];
    const porCentroRetido = {}, porCentroINSSPatronal = {}, porCentroFGTS = {}, porCentroOutrosEncargos = {};

    ativos.forEach(function (f) {
      const calc = calcular13(f.id, ano, parcela);
      calculos.push(calc);
      /* FGTS (8%), INSS patronal e RAT×FAP+terceiros incidem sobre o
         13º inteiro — encargo GENUÍNO da empresa, nunca tinham título
         nenhum antes (nem apareciam no fluxo de caixa nem na DRE). Só
         lança junto da 2ª parcela, quando o valor total do ano já está
         fechado. */
      if (parcela === 2) {
        const fgtsDeste = Math.round(calc.valor_total_ano * D.parametrosDP.aliquota_fgts / 100 * 100) / 100;
        const inssPatronalDeste = Math.round(calc.valor_total_ano * D.parametrosDP.aliquota_inss_patronal / 100 * 100) / 100;
        const outrosEncargosDeste = Math.round(calc.valor_total_ano *
          (D.parametrosDP.aliquota_rat_fap + D.parametrosDP.aliquota_terceiros) / 100 * 100) / 100;
        totalFGTS = Math.round((totalFGTS + fgtsDeste) * 100) / 100;
        totalINSSPatronal = Math.round((totalINSSPatronal + inssPatronalDeste) * 100) / 100;
        totalOutrosEncargos = Math.round((totalOutrosEncargos + outrosEncargosDeste) * 100) / 100;
        acumularPorCentro(porCentroFGTS, f, fgtsDeste);
        acumularPorCentro(porCentroINSSPatronal, f, inssPatronalDeste);
        acumularPorCentro(porCentroOutrosEncargos, f, outrosEncargosDeste);
      }
      if (calc.liquido <= 0.004) return;
      if (!f.credor_id || !D.credor(f.credor_id)) {
        erros.push(f.nome + ': sem credor cadastrado.');
        return;
      }
      if (f.pagamento_aprovado === false) {
        erros.push(f.nome + ': dados de pagamento ainda não aprovados por quem tem alçada.');
        return;
      }
      acumularPorCentro(porCentroRetido, f, calc.valor_inss + calc.valor_irrf);
      const r = criarTitulo({
        _interno: true,
        descricao: (parcela === 1 ? '1ª' : '2ª') + ' parcela do 13º ' + ano + ' — ' + f.nome,
        documento: '13-' + parcela + '-' + ano + '-' + f.matricula,
        tipo_titulo: 'decimo', credor: f.credor_id, conta: '4.06',
        centro: (f.rateio || [])[0] ? f.rateio[0].centro : f.centro, rateio: f.rateio,
        emissao: dataDoc, origem: 'decimo', origem_ref: 'decimo-' + parcela + '-' + ano + '-' + f.id,
        obs: 'Total do ano ' + U.brl(calc.valor_total_ano) + ' (' + calc.avos + '/12)' +
          (parcela === 2 ? ' · INSS ' + U.brl(calc.valor_inss) + ' · IRRF ' + U.brl(calc.valor_irrf)
            : ' · sem desconto (1ª parcela é sempre isenta)')
      }, [{ num: 1, venc: dataDoc, comp: ano + '-12', valor: calc.liquido }]);
      if (r.ok) {
        tituloIds.push(r.titulo.id);
        st.parcelas.filter(function (pc) { return pc.titulo_id === r.titulo.id; })
          .forEach(function (pc) { pc.status = 'previsto'; });
        totalLiquido = Math.round((totalLiquido + calc.liquido) * 100) / 100;
        totalINSS = Math.round((totalINSS + calc.valor_inss) * 100) / 100;
        totalIRRF = Math.round((totalIRRF + calc.valor_irrf) * 100) / 100;
        /* Pensão alimentícia descontada do 13º vira título à parte pro
           beneficiário — mesma lógica já usada na folha, rescisão e
           férias. Só existe desconto de pensão na 2ª parcela (é onde
           calcular13 aplica o desconto — ver lá). */
        if (calc.pensao_alimenticia > 0.004) {
          if (!f.pensao_alimenticia || !f.pensao_alimenticia.beneficiario_nome) {
            erros.push(f.nome + ': pensão alimentícia sem beneficiário cadastrado — o desconto saiu do 13º, ' +
              'mas não gerou título nenhum pro beneficiário. Cadastre o beneficiário e ajuste manualmente.');
          } else {
            const credorPensao = credorPensionista(f);
            const rPensao = criarTitulo({
              _interno: true, descricao: 'Pensão alimentícia — ' + f.pensao_alimenticia.beneficiario_nome +
                ' (desconto do 13º de ' + f.nome + ')',
              documento: 'PENSAO-13-' + ano + '-' + f.matricula,
              tipo_titulo: 'pensao', credor: credorPensao, conta: '4.06',
              centro: (f.rateio || [])[0] ? f.rateio[0].centro : f.centro, rateio: f.rateio,
              emissao: dataDoc, origem: 'decimo', origem_ref: 'decimo-pensao-' + ano + '-' + f.id,
              obs: 'Descontado da 2ª parcela do 13º de ' + f.nome + ' em ' + ano + '.'
            }, [{ num: 1, venc: dataDoc, comp: ano + '-12', valor: calc.pensao_alimenticia }]);
            if (rPensao.ok) {
              tituloIds.push(rPensao.titulo.id);
              st.parcelas.filter(function (pc) { return pc.titulo_id === rPensao.titulo.id; })
                .forEach(function (pc) { pc.status = 'previsto'; });
            } else erros.push(f.nome + ' (pensão do 13º): ' + rPensao.erro);
          }
        }
      } else erros.push(f.nome + ': ' + r.erro);
    });

    const credorGuia = credorGuiaDe('federal');
    /* INSS e IRRF retidos não são um encargo a mais — são a parte do
       13º que não vai pro bolso do funcionário, vai pro governo. Mesma
       conta do título principal (4.06), não 4.04 (isso é só INSS
       PATRONAL) — mesma correção já feita na folha mensal e na
       rescisão. Vencimento é o mesmo dia da 2ª parcela, não +20 dias
       (esse prazo maior é da folha mensal, não do 13º). */
    if (parcela === 2 && (totalINSS + totalIRRF) > 0.004) {
      const rat = rateioDeBucket(porCentroRetido);
      const rg = criarTitulo({
        _interno: true, descricao: 'INSS + IRRF retidos do 13º ' + ano, documento: 'GPS-DARF-13-' + ano,
        tipo_titulo: 'guia', credor: credorGuia, conta: '4.06',
        centro: rat ? rat[0].centro : 'cc100', rateio: rat,
        emissao: dataDoc, origem: 'decimo', origem_ref: 'decimo-guia-' + ano,
        obs: 'INSS ' + U.brl(totalINSS) + ' + IRRF ' + U.brl(totalIRRF) + ' retidos do 13º de todo mundo em ' + ano
      }, [{ num: 1, venc: dataDoc, comp: ano + '-12', valor: Math.round((totalINSS + totalIRRF) * 100) / 100 }]);
      if (rg.ok) {
        tituloIds.push(rg.titulo.id);
        st.parcelas.filter(function (pc) { return pc.titulo_id === rg.titulo.id; })
          .forEach(function (pc) { pc.status = 'previsto'; });
      }
    }
    if (totalFGTS > 0.004) {
      const rat = rateioDeBucket(porCentroFGTS);
      const rf = criarTitulo({
        _interno: true, descricao: 'FGTS sobre o 13º ' + ano, documento: 'FGTS-13-' + ano,
        tipo_titulo: 'guia', credor: credorGuiaDe('fgts'), conta: '4.03',
        centro: rat ? rat[0].centro : 'cc100', rateio: rat,
        emissao: dataDoc, origem: 'decimo', origem_ref: 'decimo-fgts-' + ano,
        obs: '8% sobre o 13º inteiro (não só a 2ª parcela) de todo mundo em ' + ano
      }, [{ num: 1, venc: dataDoc, comp: ano + '-12', valor: totalFGTS }]);
      if (rf.ok) {
        tituloIds.push(rf.titulo.id);
        st.parcelas.filter(function (pc) { return pc.titulo_id === rf.titulo.id; })
          .forEach(function (pc) { pc.status = 'previsto'; });
      }
    }
    if (totalINSSPatronal + totalOutrosEncargos > 0.004) {
      /* Mesma fusão da folha mensal: INSS patronal e RAT×FAP+terceiros
         saem juntos na guia de verdade (GPS/DCTFWeb), então um título
         só aqui também. */
      const bucketPatronal = {};
      Object.keys(porCentroINSSPatronal).forEach(function (c) { bucketPatronal[c] = (bucketPatronal[c] || 0) + porCentroINSSPatronal[c]; });
      Object.keys(porCentroOutrosEncargos).forEach(function (c) { bucketPatronal[c] = Math.round(((bucketPatronal[c] || 0) + porCentroOutrosEncargos[c]) * 100) / 100; });
      const rat = rateioDeBucket(bucketPatronal);
      const rp = criarTitulo({
        _interno: true, descricao: 'INSS patronal + RAT×FAP + terceiros sobre o 13º ' + ano, documento: 'GPS-PATRONAL-13-' + ano,
        tipo_titulo: 'guia', credor: credorGuia, conta: '4.04',
        centro: rat ? rat[0].centro : 'cc100', rateio: rat,
        emissao: dataDoc, origem: 'decimo', origem_ref: 'decimo-inss-patronal-' + ano,
        obs: D.parametrosDP.aliquota_inss_patronal + '% de INSS patronal (' + U.brl(totalINSSPatronal) + ') + ' +
          (D.parametrosDP.aliquota_rat_fap + D.parametrosDP.aliquota_terceiros) + '% de RAT×FAP/terceiros (' +
          U.brl(totalOutrosEncargos) + ') sobre o 13º inteiro de todo mundo em ' + ano + ' — encargo da empresa.'
      }, [{ num: 1, venc: dataDoc, comp: ano + '-12', valor: Math.round((totalINSSPatronal + totalOutrosEncargos) * 100) / 100 }]);
      if (rp.ok) {
        tituloIds.push(rp.titulo.id);
        st.parcelas.filter(function (pc) { return pc.titulo_id === rp.titulo.id; })
          .forEach(function (pc) { pc.status = 'previsto'; });
      }
    }

    const dec = {
      id: novoId('dec'), ano: ano, parcela: parcela, titulo_ids: tituloIds,
      funcionarios: ativos.length, total_liquido: totalLiquido, total_inss: totalINSS, total_irrf: totalIRRF,
      total_fgts: totalFGTS, total_inss_patronal: totalINSSPatronal, total_outros_encargos: totalOutrosEncargos,
      calculos: calculos, cancelado: false,
      criado_por: usuario().nome, criado_por_id: (usuario() || {}).id || null, criado_em: new Date()
    };
    st.decimos.push(dec);
    logar('decimo', dec.id, 'fechou ' + parcela + 'ª parcela do 13º',
      ano + ' · ' + ativos.length + ' funcionário(s) · ' + U.brl(totalLiquido));
    return { ok: true, decimo: dec, erros: erros };
  }

  function cancelar13(id, motivo, forcar) {
    if (!pode('dp')) return { erro: 'Seu perfil não cancela 13º.' };
    const dec = st.decimos.find(function (d) { return d.id === id; });
    if (!dec) return { erro: '13º não encontrado.' };
    if (dec.cancelado) return { erro: 'Este já foi cancelado.' };
    if (!motivo) return { erro: 'Informe o motivo do cancelamento.' };
    if (dec.parcela === 1 && st.decimos.some(function (d) {
          return d.ano === dec.ano && d.parcela === 2 && !d.cancelado; })) {
      return { erro: 'Cancele a 2ª parcela antes da 1ª.' };
    }
    const parcelasDoDecimo = st.parcelas.filter(function (p) { return dec.titulo_ids.indexOf(p.titulo_id) > -1; });
    const jaPagas = parcelasDoDecimo.filter(function (p) { return pagamentosDe(p.id).length > 0; });
    if (jaPagas.length && !forcar) {
      return { erro: jaPagas.length + ' pagamento(s) já saíram do banco. Force o cancelamento parcial se ' +
        'precisar mesmo assim.', jaPagas: jaPagas.length };
    }
    let n = 0;
    parcelasDoDecimo.forEach(function (p) {
      if (p.status === 'cancelado') { n++; return; }
      const r = cancelar(p.id, motivo, true);
      if (r.ok) n++;
    });
    dec.cancelado = n === parcelasDoDecimo.length;
    dec.cancelado_parcial = !dec.cancelado;
    dec.motivo_cancelamento = motivo;
    dec.cancelado_por = usuario().nome;
    dec.cancelado_em = new Date();
    logar('decimo', dec.id, dec.cancelado ? 'cancelou 13º' : 'cancelou 13º parcialmente',
      n + ' de ' + parcelasDoDecimo.length + ' · ' + motivo);
    return { ok: true, n: n };
  }

  /* ── cadastro de funcionário ─────────────────────────────
     Cada funcionário ganha um credor-espelho (tipo 'funcionario') pra
     poder ser pago pelo mesmo CNAB/PIX que já existe pra fornecedor e
     médico — em vez de inventar um segundo mecanismo de pagamento só
     pra folha. */
  /* Cargo é lista de apoio (nome, CBO, piso) — sem ela cadastrada, o
     formulário de funcionário travava em "escolha o cargo" pra
     qualquer função nova que a empresa ainda não tivesse contratado
     antes. Cadastro rápido direto de dentro do formulário, igual o
     credor já faz na tela de lançamento. */
  /* Cadastro mínimo de quem recebe uma pensão alimentícia descontada
     de um funcionário — sem isso, o valor era descontado do funcionário
     mas não virava título nenhum pra ninguém receber; o dinheiro
     simplesmente desaparecia da conta na hora de pagar. Reaproveita um
     credor já existente com o mesmo nome, se houver, e sincroniza os
     dados bancários a cada folha (caso tenham sido atualizados no
     cadastro do funcionário desde a última vez). */
  /* Mesma lógica de identificar o tipo de chave PIX usada no cadastro
     rápido de credor (ui-lancamento.js) — reaproveitada aqui em vez de
     um corte solto por "11 dígitos = CPF", que classificava um celular
     como CPF (os dois têm 11 dígitos). */
  function tipoChaveDe(chave) {
    if (!chave) return '';
    if (chave.indexOf('@') > -1) return 'Email';
    if (/^[0-9a-f]{8}-/i.test(chave)) return 'Aleatoria';
    const numerica = chave.replace(/\D/g, '');
    if (numerica.length === 14) return 'CNPJ';
    if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(chave.trim())) return 'CPF';
    if (numerica.length === 11) return pareceCPFValido(numerica) ? 'CPF' : 'Telefone';
    return 'Telefone';
  }

  /* Credor do beneficiário da pensão — TEM QUE ser um credor dedicado a
     ESTE cadastro, nunca procurado pelo nome: duas pessoas podem se
     chamar igual (uma médica cadastrada como fornecedora, e uma
     beneficiária de pensão homônima, por exemplo), e reaproveitar pelo
     nome sobrescrevia o PIX/banco de um credor que não tinha nada a
     ver — no pior caso, desviando o pagamento de um fornecedor de
     verdade. O id do credor fica guardado dentro do próprio cadastro
     de pensão do funcionário (`credor_id`), criado uma vez só. */
  function credorPensionista(f) {
    const pensao = f.pensao_alimenticia;
    let cr = pensao.credor_id && D.credor(pensao.credor_id);
    if (!cr) {
      const id = novoId('cr');
      cr = { id: id, ativo: true, nome: pensao.beneficiario_nome, tipo: 'outro', conta_padrao: '4.01',
        origem: 'dp', dados_aprovados: false };
      D.credores.push(cr);
      pensao.credor_id = id;
    }
    cr.nome = pensao.beneficiario_nome;
    cr.documento = pensao.beneficiario_cpf || cr.documento;
    cr.pix = pensao.pix || '';
    cr.banco = pensao.banco || null;
    cr.agencia = pensao.agencia || '';
    cr.conta_bancaria = pensao.conta_bancaria || '';
    cr.forma_pagamento = pensao.pix ? 'pix' : (pensao.banco && pensao.agencia && pensao.conta_bancaria) ? 'ted' : cr.forma_pagamento;
    cr.tipo_chave = tipoChaveDe(pensao.pix);
    return cr.id;
  }

  /* Mesma ideia pra instituição do crédito do trabalhador — sem isso o
     desconto no holerite não virava repasse nenhum, só desaparecia da
     conta do funcionário. Também um credor dedicado, nunca por nome. */
  function credorInstituicaoCredito(f) {
    const credito = f.credito_trabalhador;
    let cr = credito.credor_id && D.credor(credito.credor_id);
    if (!cr) {
      const id = novoId('cr');
      cr = { id: id, ativo: true, nome: credito.instituicao || 'Instituição do crédito do trabalhador',
        tipo: 'outro', conta_padrao: '4.01', origem: 'dp' };
      D.credores.push(cr);
      credito.credor_id = id;
    }
    cr.nome = credito.instituicao || cr.nome;
    cr.pix = credito.pix || '';
    cr.banco = credito.banco || null;
    cr.agencia = credito.agencia || '';
    cr.conta_bancaria = credito.conta_bancaria || '';
    cr.forma_pagamento = credito.pix ? 'pix' : (credito.banco && credito.agencia && credito.conta_bancaria) ? 'ted' : cr.forma_pagamento;
    cr.tipo_chave = tipoChaveDe(credito.pix);
    return cr.id;
  }

  function criarCargo(dados) {
    if (!pode('dp')) return { erro: 'Seu perfil não cadastra cargo.' };
    if (!dados.nome) return { erro: 'Informe o nome do cargo.' };
    if (D.cargos.some(function (c) { return c.nome.toLowerCase() === dados.nome.toLowerCase(); })) {
      return { erro: 'Já existe um cargo com este nome.' };
    }
    const cg = { id: novoId('cg'), nome: dados.nome, cbo: dados.cbo || '', salario_piso: Math.round((dados.salario_piso || 0) * 100) / 100 };
    D.cargos.push(cg);
    logar('cargo', cg.id, 'cadastrou cargo', cg.nome + (cg.cbo ? ' · CBO ' + cg.cbo : ''));
    return { ok: true, cargo: cg };
  }

  /* Mesmo algoritmo de dígito verificador usado no cadastro rápido de
     credor (ui-lancamento.js) — duplicado aqui porque store.js não
     depende da camada de UI. */
  function pareceCPFValido(v) {
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

  /* Normaliza a lista de dependentes vinda do formulário — cada um só
     com os três campos que interessam (nome, CPF, data de nascimento).
     Usado pro salário-família, que depende da idade de cada um. */
  function normalizarDependentes(lista) {
    if (!Array.isArray(lista)) return [];
    return lista.filter(function (d) { return d && d.nome; }).map(function (d) {
      return { nome: d.nome, cpf: d.cpf || '', data_nascimento: d.data_nascimento || '' };
    });
  }

  /* Pensão alimentícia cadastrada no funcionário — passa a ser a fonte
     por padrão do desconto mensal, em vez de digitar tudo de novo toda
     folha. Guarda os dados do beneficiário, inclusive bancários (é
     dado de pagamento de um TERCEIRO — mesma cautela de aprovação que
     PIX/banco do próprio funcionário). */
  /* CPF da beneficiária e chave PIX com cara de CPF são conferidos
     antes de salvar — um dígito errado manda a pensão pra conta errada
     ou faz o banco recusar o PIX. */
  /* Rateio do funcionário: centros existentes, sem repetir, % > 0 e
     soma de 100% — senão parte do custo some (ou sobra) nos projetos. */
  function validarRateio(rateio) {
    if (!rateio || !rateio.length) return null;
    const vistos = {};
    for (let i = 0; i < rateio.length; i++) {
      const r = rateio[i];
      if (!r.centro || !D.centro(r.centro)) return 'Rateio: escolha o centro de custo de cada linha.';
      if (vistos[r.centro]) return 'Rateio: o mesmo centro aparece duas vezes.';
      vistos[r.centro] = true;
      if (!(r.pct > 0)) return 'Rateio: cada centro precisa de um percentual maior que zero.';
    }
    const tot = Math.round(rateio.reduce(function (a, r) { return a + r.pct; }, 0) * 100) / 100;
    if (Math.abs(tot - 100) > 0.01) return 'Rateio soma ' + U.pct(tot) + ' — precisa somar 100%.';
    return null;
  }

  function validarPagamentoTerceiro(p, rotulo) {
    if (!p || !p.ativo) return null;
    if (p.beneficiario_cpf && !pareceCPFValido(p.beneficiario_cpf)) return rotulo + ': CPF da beneficiária inválido — confira os números.';
    const chave = String(p.pix || '').trim();
    if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(chave) && !pareceCPFValido(chave)) return rotulo + ': a chave PIX parece um CPF, mas o CPF é inválido — confira.';
    return null;
  }

  function normalizarPensao(p) {
    if (!p || !p.ativo) return { ativo: false };
    return {
      ativo: true, valor: Math.round((p.valor || 0) * 100) / 100,
      beneficiario_nome: p.beneficiario_nome || '', beneficiario_cpf: p.beneficiario_cpf || '',
      beneficiario_nascimento: p.beneficiario_nascimento || '',
      // a sentença diz se a pensão incide sobre 13º e férias; padrão: incide
      incide_13: p.incide_13 !== false, incide_ferias: p.incide_ferias !== false,
      banco: p.banco || null, agencia: p.agencia || '', conta_bancaria: p.conta_bancaria || '', pix: p.pix || ''
    };
  }

  /* Crédito do trabalhador (Lei 14.438/2022, empréstimo consignado
     privado via CLT) ou qualquer outro desconto de empréstimo com
     débito em folha — parcela fixa recorrente até acabar o contrato.
     Dados de pagamento da instituição (banco/conta ou PIX, ou o código
     de barras do boleto do mês, quando é assim que ela cobra) pra dar
     pra repassar de verdade, não só descontar do funcionário. */
  function normalizarCredito(c) {
    if (!c || !c.ativo) return { ativo: false };
    return {
      ativo: true, valor_parcela: Math.round((c.valor_parcela || 0) * 100) / 100,
      instituicao: c.instituicao || '',
      banco: c.banco || null, agencia: c.agencia || '', conta_bancaria: c.conta_bancaria || '', pix: c.pix || ''
    };
  }

  function criarFuncionario(dados) {
    if (!pode('dp')) return { erro: 'Seu perfil não cadastra funcionário.' };
    if (!dados.nome) return { erro: 'Informe o nome.' };
    if (!dados.cpf) return { erro: 'Informe o CPF.' };
    if (!pareceCPFValido(dados.cpf)) return { erro: 'CPF inválido — confira os números.' };
    const errPensaoNovo = validarPagamentoTerceiro(dados.pensao_alimenticia, 'Pensão alimentícia');
    if (errPensaoNovo) return { erro: errPensaoNovo };
    const errRateioNovo = validarRateio(dados.rateio);
    if (errRateioNovo) return { erro: errRateioNovo };
    if (dados.rateio && dados.rateio.length) dados.centro = dados.rateio[0].centro;
    if (!(dados.salario_base > 0)) return { erro: 'Informe o salário base.' };
    /* Salário mínimo integral é pra jornada cheia (44h/semana, a
       referência deste sistema) — quem trabalha menos tem direito ao
       mínimo PROPORCIONAL, não ao valor cheio. Bloquear pelo valor
       cheio recusava contratos de meio período perfeitamente válidos
       (20h/semana com pouco mais de R$700, por exemplo). */
    const jornada = dados.jornada_semanal_horas || 44;
    const minimoProporcional = Math.round(D.parametrosDP.salario_minimo * jornada / 44 * 100) / 100;
    if (dados.salario_base < minimoProporcional) {
      return { erro: 'Salário abaixo do mínimo proporcional à jornada de ' + jornada + 'h/semana (' +
        U.brl(minimoProporcional) + ').' };
    }
    if (!dados.cargo) return { erro: 'Informe o cargo.' };
    if (dados.dependentes_irrf !== undefined && !Number.isInteger(dados.dependentes_irrf)) {
      return { erro: 'Número de dependentes tem que ser inteiro.' };
    }
    if (dados.admissao && dados.admissao > U.hoje()) {
      return { erro: 'Data de admissão no futuro (' + U.fData(dados.admissao) + ').' };
    }
    /* Conferências que o DP faz de cabeça e o sistema deixava passar.
       Nenhuma delas é opinião: piso do cargo, jornada máxima
       constitucional e idade mínima para o trabalho são lei. */
    const cargo = D.cargos.find(function (c) { return c.id === dados.cargo; });
    /* O piso do cargo é para jornada cheia: em jornada parcial ele é
       proporcional, senão o sistema recusaria um meio-período pago
       corretamente. */
    const jornadaPiso = dados.jornada_semanal_horas || dados.jornada_semanal || dados.carga_horaria || 44;
    const pisoProporcional = cargo && cargo.salario_piso > 0
      ? Math.round(cargo.salario_piso * Math.min(1, jornadaPiso / 44) * 100) / 100 : 0;
    if (pisoProporcional > 0 && dados.salario_base > 0 && dados.salario_base < pisoProporcional - 0.01) {
      return { erro: 'O salário (' + U.brl(dados.salario_base) + ') está abaixo do piso do cargo ' +
        cargo.nome + (jornadaPiso < 44 ? ' proporcional a ' + jornadaPiso + 'h' : '') +
        ' (' + U.brl(pisoProporcional) + ').' };
    }
    if (jornadaPiso > 44) {
      return { erro: 'A jornada semanal não pode passar de 44 horas (CF, art. 7º, XIII).' };
    }
    if (dados.dependentes_irrf < 0 || dados.dependentes_salario_familia < 0) {
      return { erro: 'Número de dependentes não pode ser negativo.' };
    }
    const nasc = dados.nascimento || dados.data_nascimento;
    if (nasc) {
      const anos = Math.floor(U.diasEntre(nasc, U.hoje()) / 365.25);
      if (anos < 14) {
        return { erro: 'Idade de ' + anos + ' anos: menor de 14 não pode ser contratado em hipótese nenhuma.' };
      }
      if (anos < 16 && dados.tipo_contrato !== 'aprendiz') {
        return { erro: 'Entre 14 e 16 anos só na condição de aprendiz (CF, art. 7º, XXXIII). ' +
          'Marque o contrato como aprendiz ou revise a data de nascimento.' };
      }
      if (anos < 18 && dados.trabalho_noturno) {
        return { erro: 'Menor de 18 anos não pode em trabalho noturno, perigoso ou insalubre.' };
      }
    }
    if (dados.admissao && nasc && dados.admissao < nasc) {
      return { erro: 'A admissão não pode ser anterior ao nascimento.' };
    }
    const cpfLimpo = String(dados.cpf).replace(/\D/g, '');
    /* Só bloqueia CPF repetido entre quem está ATIVO — um ex-funcionário
       recontratado tem o mesmo CPF de propósito, e antes disso travava
       a recontratação. */
    if (D.funcionarios.some(function (f) { return f.ativo && String(f.cpf).replace(/\D/g, '') === cpfLimpo; })) {
      return { erro: 'Já existe funcionário ATIVO com este CPF.' };
    }
    const id = novoId('fn');
    const credorId = novoId('cr');
    D.credores.push({
      id: credorId, nome: dados.nome, tipo: 'funcionario', ativo: true,
      documento: dados.cpf, forma_pagamento: dados.pix ? 'pix' : 'ted',
      pix: dados.pix || '', banco: dados.banco || null, agencia: dados.agencia || '',
      conta_bancaria: dados.conta_bancaria || '',
      tipo_chave: tipoChaveDe(dados.pix),
      conta_padrao: '4.01', origem: 'dp'
    });
    const ultimaMatricula = D.funcionarios.reduce(function (m, f) {
      return Math.max(m, parseInt(f.matricula, 10) || 0); }, 0);
    /* Dado de pagamento de um funcionário RECÉM-ADMITIDO tem o mesmo
       risco de autodesvio que editar o de um já existente (que já
       exige aprovação — ver editarFuncionario): DP sozinho podia
       admitir alguém com o PRÓPRIO PIX e ninguém mais via isso antes
       do primeiro pagamento sair. Quem tem alçada de aprovação admite
       com o pagamento já liberado; quem não tem, admite normalmente
       mas o pagamento fica bloqueado até alguém com alçada confirmar
       (ver aprovarDadosPagamento) — a folha, o 13º e a rescisão
       recusam pagar enquanto isso não acontece. */
    const pagamentoAprovado = pode('aprovar');
    const f = {
      id: id, matricula: String(ultimaMatricula + 1).padStart(4, '0'), nome: dados.nome,
      cpf: dados.cpf, pis: dados.pis || '', nascimento: dados.nascimento || '',
      admissao: dados.admissao || U.hoje(), cargo: dados.cargo, tipo_contrato: dados.tipo_contrato || 'clt',
      salario_base: Math.round(dados.salario_base * 100) / 100,
      jornada_semanal_horas: dados.jornada_semanal_horas || 44,
      dependentes_irrf: dados.dependentes_irrf || 0,
      /* Cadastro nomeado, separado da CONTAGEM usada no IRRF acima —
         as duas coisas podem divergir de propósito (um dependente pra
         IRRF nem sempre é filho com data de nascimento à mão, e nem
         todo filho cadastrado aqui necessariamente entra na dedução de
         IRRF). Usado especificamente pro salário-família, que depende
         da idade de cada um. */
      dependentes: normalizarDependentes(dados.dependentes),
      pensao_alimenticia: normalizarPensao(dados.pensao_alimenticia),
      centro: dados.centro || 'cc100',
      rateio: (dados.rateio && dados.rateio.length) ? dados.rateio : [{ centro: dados.centro || 'cc100', pct: 100 }],
      credor_id: credorId, banco: dados.banco || null, agencia: dados.agencia || '',
      conta_bancaria: dados.conta_bancaria || '', pix: dados.pix || '',
      pagamento_aprovado: pagamentoAprovado,
      vale_transporte: !!dados.vale_transporte, vt_dia: dados.vt_dia || 0,
      vt_desconto_modo: dados.vt_desconto_modo || 'percentual', vt_desconto_valor: dados.vt_desconto_valor || 0,
      vale_refeicao: !!dados.vale_refeicao, vr_dia: dados.vr_dia || 0,
      vr_desconto_modo: dados.vr_desconto_modo || 'nenhum', vr_desconto_valor: dados.vr_desconto_valor || 0,
      credito_trabalhador: normalizarCredito(dados.credito_trabalhador),
      insalubridade_pct: dados.insalubridade_pct || 0, periculosidade: !!dados.periculosidade,
      ativo: true, desligado_em: null, motivo_desligamento: null, ferias: [],
      historico_salarial: [{ vigencia: dados.admissao || U.hoje(),
        salario: Math.round(dados.salario_base * 100) / 100, motivo: 'Admissão' }]
    };
    D.funcionarios.push(f);
    logar('funcionario', id, 'admitiu', dados.nome + ' · ' + ((D.cargo(dados.cargo) || {}).nome || '') +
      ' · ' + U.brl(f.salario_base) + (pagamentoAprovado ? '' : ' · pagamento pendente de aprovação'));
    return { ok: true, funcionario: f, aviso: avisoForaDeFolhaFechada(f) };
  }

  /* Libera o pagamento de um funcionário admitido por quem não tem
     alçada — só quem tem `aprovar` pode fazer isso, e só depois de
     conferir os dados de pagamento (PIX/banco) de verdade. */
  function aprovarDadosPagamento(funcionarioId) {
    if (!pode('aprovar')) return { erro: 'Seu perfil não aprova dados de pagamento.' };
    const f = D.funcionario(funcionarioId);
    if (!f) return { erro: 'Funcionário não encontrado.' };
    if (f.pagamento_aprovado) return { erro: 'Já está aprovado.' };
    f.pagamento_aprovado = true;
    logar('funcionario', funcionarioId, 'aprovou dados de pagamento', f.nome);
    return { ok: true, aviso: avisoForaDeFolhaFechada(f) };
  }

  /* Validações legais que valem tanto na criação quanto na edição —
     antes existiam só dentro de `criarFuncionario`. Recebe o registro
     JÁ MESCLADO, para conferir o estado final. */
  function validarDadosLegaisFuncionario(f) {
    if (f.jornada_semanal_horas !== undefined && f.jornada_semanal_horas !== null &&
        f.jornada_semanal_horas !== '') {
      const j = Number(f.jornada_semanal_horas);
      if (!isFinite(j) || j <= 0 || j > 44) {
        return 'Jornada semanal de ' + f.jornada_semanal_horas + 'h: o limite constitucional é ' +
          '44h (CF art. 7º, XIII).';
      }
    }
    if (f.dependentes_irrf !== undefined && f.dependentes_irrf !== null) {
      const dep = Number(f.dependentes_irrf);
      if (!isFinite(dep) || dep < 0 || dep % 1 !== 0) {
        return 'Número de dependentes para IRRF inválido (' + f.dependentes_irrf + ').';
      }
    }
    if (f.insalubridade_pct !== undefined && f.insalubridade_pct !== null &&
        f.insalubridade_pct !== '' && Number(f.insalubridade_pct) !== 0) {
      if ([10, 20, 40].indexOf(Number(f.insalubridade_pct)) < 0) {
        return 'Insalubridade só pode ser 10%, 20% ou 40% (NR-15) — recebido ' +
          f.insalubridade_pct + '%.';
      }
    }
    if (f.periculosidade_pct !== undefined && f.periculosidade_pct !== null &&
        f.periculosidade_pct !== '' && Number(f.periculosidade_pct) !== 0 &&
        Number(f.periculosidade_pct) !== 30) {
      return 'Periculosidade é 30% (CLT art. 193) — recebido ' + f.periculosidade_pct + '%.';
    }
    if (f.nascimento) {
      const idade = idadeEm(f.nascimento, U.hoje());
      if (idade !== null && idade < 14) {
        return 'Menor de 14 anos não pode ser contratado (CF art. 7º, XXXIII).';
      }
    }
    if (f.salario_base !== undefined && f.salario_base !== null && f.salario_base !== '') {
      const sal = Number(f.salario_base);
      if (!isFinite(sal) || sal <= 0) return 'Salário base inválido (' + f.salario_base + ').';
    }
    return null;
  }

  function editarFuncionario(id, dados) {
    if (!pode('dp')) return { erro: 'Seu perfil não edita funcionário.' };
    const f = D.funcionario(id);
    if (!f) return { erro: 'Funcionário não encontrado.' };
    const errPensaoEd = validarPagamentoTerceiro(dados.pensao_alimenticia, 'Pensão alimentícia');
    if (errPensaoEd) return { erro: errPensaoEd };
    const errRateioEd = validarRateio(dados.rateio);
    if (errRateioEd) return { erro: errRateioEd };
    /* As travas legais da CRIAÇÃO valiam só lá: a edição era um laço
       cego que gravava o que viesse. Jornada de 60h (CF art. 7º XIII
       limita a 44), dependentes negativos (que AUMENTAM o IRRF),
       insalubridade de 500% e menor de 14 anos passavam todos. */
    const legais = validarDadosLegaisFuncionario(Object.assign({}, f, dados));
    if (legais) return { erro: legais };
    if (dados.rateio && dados.rateio.length) dados.centro = dados.rateio[0].centro;
    /* Dado de pagamento (PIX, banco, agência, conta) de um funcionário
       JÁ CADASTRADO pede aprovação de quem tem alçada — não só o
       perfil de DP. Autoadmissão com o próprio PIX já é barrada, mas
       trocar a chave de alguém que já existe é o mesmo risco: DP
       sozinho não deveria conseguir redirecionar pra onde um
       pagamento cai. Na admissão (funcionário novo) isso não se
       aplica — ainda não há histórico de pagamento pra desviar. */
    const camposPagamento = ['banco', 'agencia', 'conta_bancaria', 'pix'];
    /* '' (o formulário sempre manda string) e null/undefined (o que o
       cadastro tem quando nunca foi preenchido) significam a MESMA
       coisa aqui — "sem banco definido". Comparar os valores crus
       fazia toda edição de um funcionário sem banco cadastrado (o
       caso mais comum: quem só tem PIX) cair na trava de aprovação
       por engano, mesmo sem ninguém ter tocado nesses campos. */
    const mudaPagamento = camposPagamento.some(function (k) {
      return dados[k] !== undefined && (dados[k] || '') !== (f[k] || '');
    });
    if (mudaPagamento && !pode('aprovar')) {
      return { erro: 'Mudar banco, agência, conta ou PIX de um funcionário já cadastrado precisa de ' +
        'aprovação da diretoria ou sócio — peça pra um deles fazer essa parte.' };
    }
    /* Dados bancários da pensão alimentícia são pagamento de um
       TERCEIRO (o beneficiário) — mesmo risco de autodesvio que o PIX
       do próprio funcionário. Trocar valor ou nome não pede aprovação
       (é decisão judicial/administrativa, não redirecionamento de
       dinheiro), só mexer em banco/agência/conta/PIX do beneficiário. */
    const pensaoAtual = f.pensao_alimenticia || { ativo: false };
    const pensaoNova = dados.pensao_alimenticia;
    const mudaPagamentoPensao = pensaoNova && ['banco', 'agencia', 'conta_bancaria', 'pix'].some(function (k) {
      return (pensaoNova[k] || '') !== (pensaoAtual[k] || '');
    });
    if (mudaPagamentoPensao && !pode('aprovar')) {
      return { erro: 'Mudar os dados bancários do beneficiário da pensão alimentícia precisa de aprovação ' +
        'da diretoria ou sócio.' };
    }
    /* Mesma cautela pros dados bancários da instituição do crédito do
       trabalhador — é pagamento de um terceiro também. */
    const creditoAtual = f.credito_trabalhador || { ativo: false };
    const creditoNovo = dados.credito_trabalhador;
    const mudaPagamentoCredito = creditoNovo && ['banco', 'agencia', 'conta_bancaria', 'pix'].some(function (k) {
      return (creditoNovo[k] || '') !== (creditoAtual[k] || '');
    });
    if (mudaPagamentoCredito && !pode('aprovar')) {
      return { erro: 'Mudar os dados bancários da instituição do crédito do trabalhador precisa de aprovação ' +
        'da diretoria ou sócio.' };
    }
    /* Salário não entra nesta lista de propósito — trocar de valor
       sem registrar vigência é exatamente o que quebra a
       rastreabilidade que a estimativa de multa de FGTS depende.
       Reajuste passa por `registrarReajusteSalarial`. */
    const campos = ['nome', 'pis', 'nascimento', 'cargo', 'jornada_semanal_horas',
      'dependentes_irrf', 'dependentes', 'pensao_alimenticia', 'credito_trabalhador',
      'centro', 'rateio', 'banco', 'agencia', 'conta_bancaria', 'pix',
      'vale_transporte', 'vt_dia', 'vt_desconto_modo', 'vt_desconto_valor',
      'vale_refeicao', 'vr_dia', 'vr_desconto_modo', 'vr_desconto_valor',
      'insalubridade_pct', 'periculosidade'];
    const mudou = [];
    campos.forEach(function (k) {
      if (dados[k] === undefined) return;
      const valor = k === 'dependentes' ? normalizarDependentes(dados[k])
        : k === 'pensao_alimenticia' ? normalizarPensao(dados[k])
        : k === 'credito_trabalhador' ? normalizarCredito(dados[k])
        : dados[k];
      if (JSON.stringify(valor) === JSON.stringify(f[k])) return;
      mudou.push(k);
      f[k] = valor;
    });
    if (dados.nome || mudaPagamento) {
      /* Sincroniza tudo que o CNAB/PIX realmente usa, não só nome e
         PIX — sem isso, tirar o PIX e informar banco deixava o
         fornecedor com "forma PIX" e chave vazia, sem dados bancários
         nenhum: impagável por qualquer via. */
      const cr = D.credor(f.credor_id);
      if (cr) {
        if (dados.nome) cr.nome = dados.nome;
        if (mudaPagamento) {
          cr.pix = f.pix || '';
          cr.banco = f.banco || null;
          cr.agencia = f.agencia || '';
          cr.conta_bancaria = f.conta_bancaria || '';
          cr.forma_pagamento = f.pix ? 'pix' : (f.banco && f.agencia && f.conta_bancaria) ? 'ted' : cr.forma_pagamento;
          // tipo_chave ficava com o valor antigo (ex.: "CPF") mesmo depois de tirar o PIX e trocar por conta
          cr.tipo_chave = f.pix ? (f.pix.replace(/\D/g, '').length === 11 ? 'CPF' : 'Email') : '';
        }
      }
    }
    if (mudou.length) logar('funcionario', id, 'editou' + (mudaPagamento ? ' (dado de pagamento, com aprovação)' : ''),
      mudou.join(', '));
    return { ok: true, n: mudou.length };
  }

  /* Salário em vigor numa data — última entrada do histórico com
     vigência igual ou anterior a ela. É a base de tudo que precisa
     saber "quanto ele ganhava então": a estimativa de FGTS acumulado
     olha mês a mês desde a admissão, e sem isso só teria o salário
     ATUAL pra aplicar em todos os meses, superestimando (ou
     subestimando) qualquer período com valor diferente. */
  function salarioVigenteEm(f, dataIso) {
    const hist = (f.historico_salarial && f.historico_salarial.length)
      ? f.historico_salarial : [{ vigencia: f.admissao, salario: f.salario_base }];
    const ordenado = hist.slice().sort(function (a, b) { return a.vigencia.localeCompare(b.vigencia); });
    let valor = ordenado[0].salario;
    ordenado.forEach(function (h) { if (h.vigencia <= dataIso) valor = h.salario; });
    return valor;
  }

  /* Insalubridade/periculosidade habituais somam na remuneração base
     de 13º e férias, não só no holerite mensal — são "adicionais
     habituais" pra fins de CLT, e ficavam de fora dessas duas contas
     (o 13º saía só sobre o salário nu, sem eles). Mesma regra de não
     cumular os dois (art. 193 §2º): usa o mais vantajoso. */
  /* Idade em anos completos numa data de referência — usado pro
     salário-família (dependente até 14 anos). Retorna null se a data
     de nascimento não é uma data válida. */
  function idadeEm(dataNascimento, dataRef) {
    if (!dataNascimento) return null;
    const nasc = new Date(dataNascimento + 'T00:00:00Z');
    const ref = new Date(dataRef + 'T00:00:00Z');
    if (isNaN(nasc.getTime()) || isNaN(ref.getTime())) return null;
    let idade = ref.getUTCFullYear() - nasc.getUTCFullYear();
    const aindaNaoFezAniversario = (ref.getUTCMonth() < nasc.getUTCMonth()) ||
      (ref.getUTCMonth() === nasc.getUTCMonth() && ref.getUTCDate() < nasc.getUTCDate());
    if (aindaNaoFezAniversario) idade--;
    return idade;
  }

  /* Média das VARIÁVEIS HABITUAIS (horas extras e adicional noturno)
     dos holerites de um período. Entram no 13º (Lei 4.090 art. 1º §1º
     e Súmula 347 do TST) e nas férias (CLT art. 142 §5º e Súmula 151),
     e o sistema nunca as somava: só insalubridade e periculosidade
     entravam no salário de referência, embora as rubricas de HE e
     noturno estivessem gravadas holerite a holerite.

     A média é pelo VALOR pago (Súmula 347 manda média da quantidade
     aplicada ao valor atual; com o valor da hora estável, o resultado
     é o mesmo e a conta não depende de reconstituir a hora de cada
     mês). Divide pelo número de meses do período, não pelos meses em
     que houve variável — média de 12 meses é média de 12. */
  const RUBRICAS_VARIAVEIS = ['101', '102', '103', '104'];

  function mediaVariaveisHabituais(f, compInicial, compFinal) {
    let soma = 0, meses = 0;
    let c = compInicial;
    let guarda = 0;
    while (c <= compFinal && guarda < 60) {
      meses++;
      const fl = st.folhas.find(function (x) {
        return x.competencia === c && !x.cancelada;
      });
      const h = fl && (fl.holerites || []).find(function (x) { return x.funcionario === f.id; });
      if (h) {
        (h.proventos || []).forEach(function (p) {
          if (RUBRICAS_VARIAVEIS.indexOf(p.codigo) >= 0) soma += (p.valor || 0);
        });
      }
      c = U.compDe(U.addMeses(c + '-01', 1));
      guarda++;
    }
    if (!meses) return 0;
    return Math.round((soma / meses) * 100) / 100;
  }

  function adicionalHabitual(f, salarioMes) {
    const dp = D.parametrosDP;
    const valorInsal = f.insalubridade_pct > 0
      ? Math.round(dp.salario_minimo * f.insalubridade_pct / 100 * 100) / 100 : 0;
    const valorPericul = f.periculosidade ? Math.round(salarioMes * 0.3 * 100) / 100 : 0;
    return Math.max(valorInsal, valorPericul);
  }

  /* Rateio por centro de um valor consolidado (guia de FGTS, INSS
     patronal, INSS+IRRF retido…) — cada funcionário contribui pro
     centro dele (ou rateado, se tiver rateio de verdade) em vez de
     tudo cair sempre na matriz. Compartilhado entre fecharFolha,
     fechar13 e qualquer outro fechamento em lote que precise disso. */
  function acumularPorCentro(bucket, func, valor) {
    if (valor <= 0.004) return;
    (func.rateio && func.rateio.length ? func.rateio : [{ centro: func.centro, pct: 100 }]).forEach(function (rt) {
      const parte = Math.round(valor * rt.pct / 100 * 100) / 100;
      bucket[rt.centro] = Math.round(((bucket[rt.centro] || 0) + parte) * 100) / 100;
    });
  }
  function rateioDeBucket(bucket) {
    const centros = Object.keys(bucket);
    const total = centros.reduce(function (s, k) { return s + bucket[k]; }, 0);
    if (total <= 0.004) return null;
    const rat = centros.map(function (c) { return { centro: c, pct: Math.round(bucket[c] / total * 10000) / 100 }; });
    // a última entrada absorve o resto do arredondamento, pra sempre fechar em 100%
    const soma = Math.round(rat.reduce(function (s, r) { return s + r.pct; }, 0) * 100) / 100;
    rat[rat.length - 1].pct = Math.round((rat[rat.length - 1].pct + (100 - soma)) * 100) / 100;
    return rat;
  }

  /* Guia (GPS/DARF/FGTS) que cai num sábado ou domingo antecipa pro
     dia útil anterior — convenção de recolhimento, não é regra do
     nosso sistema. Nunca empurra pra frente (isso poderia passar do
     prazo legal), só puxa pra trás. */
  /* Guias federais (INSS/IRRF via DCTFWeb) vencem no dia 20 do mês
     seguinte ao fato gerador, antecipando se cair em fim de semana. */
  function dia20MesSeguinte(dataIso) {
    return antecipaSeFimDeSemana(U.compDe(U.addMeses(dataIso.slice(0, 7) + '-01', 1)) + '-20');
  }
  /* Salário: até o 5º dia útil do mês seguinte (CLT art. 459 §1º).
     Conta segunda a sábado (sábado é dia útil pra esse fim, IN MTb
     1/1989), pulando domingos e feriados (nacionais + os cadastrados
     em parametros.feriados_extras). */
  function quintoDiaUtil(competencia) {
    let d = U.compDe(U.addMeses(competencia + '-01', 1)) + '-01', uteis = 0;
    for (let i = 0; i < 12; i++) {
      const dow = new Date(d + 'T12:00:00Z').getUTCDay();
      if (dow !== 0 && !ehFeriado(d, false)) uteis++;
      if (uteis === 5) return d;
      d = U.addDias(d, 1);
    }
    return d;
  }

  /* Páscoa (algoritmo de Meeus/Jones/Butcher) — base dos feriados
     móveis: carnaval (-48/-47), Sexta-feira Santa (-2). */
  function pascoa(ano) {
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return ano + '-' + String(mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
  }
  const cacheFeriados = {};
  /* Feriados nacionais (Lei 662/1949, 6.802/1980, 14.759/2023) + os
     cadastrados em parametros.feriados_extras. `bancario` inclui
     segunda e terça de carnaval, que não têm expediente bancário. */
  function ehFeriado(dataIso, bancario) {
    const ano = +dataIso.slice(0, 4);
    const chave = ano + (bancario ? 'b' : 'l');
    if (!cacheFeriados[chave]) {
      const fixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].map(function (md) { return ano + '-' + md; });
      const p = pascoa(ano);
      fixos.push(U.addDias(p, -2));                                   // Sexta-feira Santa
      if (bancario) { fixos.push(U.addDias(p, -48)); fixos.push(U.addDias(p, -47)); }   // carnaval
      cacheFeriados[chave] = fixos;
    }
    const extras = (st.parametros && st.parametros.feriados_extras) || [];
    return cacheFeriados[chave].indexOf(dataIso) > -1 ||
      extras.some(function (x) { return x === dataIso || x === dataIso.slice(5); });
  }
  /* Vencimento de guia/boleto que cai em dia sem expediente bancário
     (fim de semana, feriado, carnaval) antecipa pro dia útil anterior. */
  function antecipaSeFimDeSemana(dataIso) {
    let d = dataIso;
    for (let i = 0; i < 10; i++) {
      const dow = new Date(d + 'T00:00:00Z').getUTCDay();
      if (dow !== 0 && dow !== 6 && !ehFeriado(d, true)) return d;
      d = U.addDias(d, -1);
    }
    return d;
  }

  function historicoSalarial(funcionarioId) {
    const f = D.funcionario(funcionarioId);
    if (!f) return [];
    return (f.historico_salarial || []).slice().sort(function (a, b) { return a.vigencia.localeCompare(b.vigencia); });
  }

  /* Reajuste é ação própria, não um campo a mais no editar — é o que
     garante que toda mudança de salário fica registrada com vigência
     e motivo, em vez de só sobrescrever o valor anterior sem deixar
     rastro nenhum. */
  function registrarReajusteSalarial(funcionarioId, novoSalario, vigencia, motivo) {
    if (!pode('dp')) return { erro: 'Seu perfil não reajusta salário.' };
    const f = D.funcionario(funcionarioId);
    if (!f) return { erro: 'Funcionário não encontrado.' };
    if (!(novoSalario > 0)) return { erro: 'Informe o novo salário.' };
    if (!vigencia) return { erro: 'Informe a data de vigência.' };
    if (!motivo) return { erro: 'Informe o motivo do reajuste.' };
    f.historico_salarial = f.historico_salarial || [{ vigencia: f.admissao, salario: f.salario_base, motivo: 'Admissão' }];
    /* Irredutibilidade salarial (CF art. 7º, XI): o novo valor não pode
       ficar abaixo do que já estava em vigor logo antes desta
       vigência — sem essa trava, o sistema aceitava qualquer redução
       sem aviso nenhum. */
    const salarioAnterior = salarioVigenteEm(f, U.addDias(vigencia, -1));
    if (novoSalario < salarioAnterior - 0.004) {
      return { erro: 'Salário não pode reduzir (irredutibilidade salarial, CF art. 7º VI) — ' +
        'estava em ' + U.brl(salarioAnterior) + ' antes desta vigência.' };
    }
    f.historico_salarial.push({ vigencia: vigencia, salario: Math.round(novoSalario * 100) / 100, motivo: motivo });
    const anterior = f.salario_base;
    /* Recalcula o salário corrente a partir do histórico inteiro — não
       só "se a vigência já chegou, usa este valor". Sem isso, dois
       bugs: um reajuste com vigência futura nunca virava corrente
       quando a data chegava (a folha de um mês futuro usava o salário
       de hoje, não o da competência calculada); e um reajuste
       retroativo lançado depois sobrescrevia um mais recente que já
       estava valendo, só por ter sido cadastrado por último. */
    f.salario_base = salarioVigenteEm(f, U.hoje());
    logar('funcionario', funcionarioId, 'reajuste salarial',
      U.brl(anterior) + ' → ' + U.brl(novoSalario) + ' a partir de ' + U.fData(vigencia) + ' · ' + motivo);
    return { ok: true };
  }

  /* FGTS acumulado do contrato inteiro, mês a mês desde a admissão —
     não só o que este sistema gerou nas folhas que rodou. Pra cada
     competência: se tem folha fechada (não cancelada) com holerite
     deste funcionário, usa o FGTS de verdade dela; senão, estima 8%
     sobre o salário que estava em vigor naquele mês, pelo histórico
     salarial. Cobre o funcionário que já trabalhava antes deste ERP
     existir tanto quanto o que só tem folha daqui pra frente. */
  function fgtsAcumuladoDesdeAdmissao(f, ateDataIso) {
    let total = 0;
    let comp = f.admissao.slice(0, 7);
    const fim = ateDataIso.slice(0, 7);
    let guarda = 0;   // trava de segurança contra data de admissão inconsistente
    while (comp <= fim && guarda < 1200) {
      const folha = st.folhas.find(function (fl) { return fl.competencia === comp && !fl.cancelada; });
      const h = folha && (folha.holerites || []).find(function (x) { return x.funcionario === f.id; });
      if (h) {
        total += h.fgts;
      } else {
        const salarioDoMes = salarioVigenteEm(f, comp + '-01');
        total += salarioDoMes * D.parametrosDP.aliquota_fgts / 100;
      }
      comp = U.compDe(U.addMeses(comp + '-01', 1));
      guarda++;
    }

    /* O FGTS também incide sobre 13º e férias, e a estimativa contava
       só os salários mensais — subestimando a base da multa de 40% em
       cerca de 7% (uns R$ 550 num caso de 5 anos de casa). Onde a
       folha existe o número é real; onde não existe, estima: um 13º
       por ano completo e 1/3 a mais sobre as férias de cada período
       aquisitivo fechado. */
    const anos = Math.max(0, U.mesesEntre(f.admissao, ateDataIso) / 12);
    const salarioAtual = salarioVigenteEm(f, ateDataIso);
    const pct = D.parametrosDP.aliquota_fgts / 100;
    const decimoEstimado = Math.floor(anos) * salarioAtual * pct;
    const feriasEstimadas = Math.floor(anos) * salarioAtual *
      (1 + D.parametrosDP.terco_constitucional_ferias) * pct;
    /* Desconta o que já veio das folhas reais, para não contar duas
       vezes o 13º e as férias de quem tem folha lançada. */
    const jaNasFolhas = st.folhas.reduce(function (s2, fl) {
      if (fl.cancelada) return s2;
      const h = (fl.holerites || []).find(function (x) { return x.funcionario === f.id; });
      return s2 + (h && h.fgts_decimo ? h.fgts_decimo : 0) + (h && h.fgts_ferias ? h.fgts_ferias : 0);
    }, 0);
    total += Math.max(0, decimoEstimado + feriasEstimadas - jaNasFolhas);

    return Math.round(total * 100) / 100;
  }

  function desligarFuncionario(id, dados) {
    if (!pode('dp')) return { erro: 'Seu perfil não desliga funcionário.' };
    const f = D.funcionario(id);
    if (!f) return { erro: 'Funcionário não encontrado.' };
    if (!f.ativo) return { erro: 'Este funcionário já está desligado.' };
    if (!dados.data) return { erro: 'Informe a data de desligamento.' };
    if (dados.data < f.admissao) {
      return { erro: 'Data de desligamento (' + U.fData(dados.data) + ') é anterior à admissão (' +
        U.fData(f.admissao) + ').' };
    }
    if (!dados.motivo) return { erro: 'Informe o motivo do desligamento.' };
    f.ativo = false;
    f.desligado_em = dados.data;
    f.motivo_desligamento = dados.motivo;
    const cr = D.credor(f.credor_id);
    if (cr) cr.ativo = false;
    logar('funcionario', id, 'desligou', f.nome + ' · ' + dados.motivo + ' · ' + U.fData(dados.data));
    return { ok: true };
  }

  /* ── férias ──────────────────────────────────────────────
     Valor de férias tem tributação própria (INSS e IRRF incidem sobre
     o valor de férias, não sobre o salário do mês) — por isso passa
     pela mesma tabela progressiva, mas com base própria, separada do
     holerite mensal. */
  /* Abono pecuniário é venda de DIAS DE FÉRIAS por dinheiro — uma
     escolha à parte de quantos dias a pessoa tira de descanso, não
     "o que sobra" de um período curto. Limite de 1/3 de 30 (10 dias),
     e pode ser pedido mesmo gozando os 30 dias inteiros ou só uma
     parte — o que não pode é ultrapassar 10 dias de venda nem
     diasGozo+diasAbono passar de 30. É isento de INSS e IRRF (natureza
     indenizatória), diferente do valor de férias gozadas. Férias
     tiradas depois do limite pra gozar (vencidas) são pagas em DOBRO,
     inclusive o 1/3 — art. 137 da CLT. */
  function calcularFerias(funcionarioId, diasGozo, dataInicio, diasAbono) {
    const f = D.funcionario(funcionarioId);
    if (!f) return { erro: 'Funcionário não encontrado.' };
    sincronizarPeriodosFerias(f, dataInicio);
    diasAbono = diasAbono || 0;
    if (!(diasGozo > 0) || diasGozo > 30) return { erro: 'Dias de férias tem que ser entre 1 e 30.' };
    if (diasGozo < 5) return { erro: 'Cada período de férias tem que ter pelo menos 5 dias corridos (CLT art. 134 §1º).' };
    if (diasAbono < 0) return { erro: 'Abono pecuniário inválido.' };
    if (diasGozo + diasAbono > 30) return { erro: 'Dias de gozo mais abono não pode passar de 30.' };
    /* Art. 134 §3º: férias não começam dois dias antes de feriado nem
       do descanso semanal. Na prática, não começam sexta, sábado nem
       domingo, e não começam na véspera de feriado. */
    if (dataInicio) {
      const diaSemana = new Date(dataInicio + 'T12:00:00').getDay();
      const ehFimDeSemana = diaSemana === 0 || diaSemana === 6;
      const dois = [U.addDias(dataInicio, 1), U.addDias(dataInicio, 2)];
      const vespera = dois.some(function (d) {
        const ds = new Date(d + 'T12:00:00').getDay();
        return ds === 0 || ehFeriado(d);
      });
      if (ehFimDeSemana || ehFeriado(dataInicio) || vespera) {
        return { erro: 'As férias não podem começar em ' + U.fData(dataInicio) + ': o art. 134 §3º da CLT ' +
          'proíbe o início nos dois dias que antecedem feriado ou descanso semanal ' +
          '(na prática, evite sexta, sábado, domingo e véspera de feriado).' };
      }
    }
    /* Período aquisitivo tem que estar fechado: férias de um período
       que ainda não completou 12 meses é adiantamento, não férias. */
    if (dataInicio) {
      /* `sincronizarPeriodosFerias` já rodou acima com esta data: se
         não fechou nenhum período até aqui, o funcionário ainda não tem
         direito adquirido, e o que ele pediu é adiantamento. */
      const fechados = (f.ferias || []).filter(function (p) {
        return p.aquisitivo_fim < dataInicio && (p.dias_direito - (p.dias_gozados || 0)) > 0;
      });
      if (!fechados.length) {
        /* Mostra o período RELEVANTE para a data pedida, não o primeiro
           da vida do funcionário: com admissão em 2022 e pedido para
           2025, dizer "fecha em 31/05/2023" não ajuda ninguém. */
        let candidato = f.admissao;
        let guardaP = 0;
        while (guardaP++ < 80) {
          const fimP = U.addDias(U.addMeses(candidato, 12), -1);
          if (fimP >= dataInicio) break;
          candidato = U.addDias(fimP, 1);
        }
        const primeiro = U.addDias(U.addMeses(candidato, 12), -1);
        const jaTemTodos = (f.ferias || []).length &&
          (f.ferias || []).every(function (p) { return (p.dias_direito - (p.dias_gozados || 0)) <= 0; });
        return { erro: jaTemTodos
          ? 'Não há saldo de férias em nenhum período aquisitivo deste funcionário.'
          : 'O período aquisitivo ainda não fechou até ' + U.fData(dataInicio) +
            ' (o primeiro fecha em ' + U.fData(primeiro) + '). Férias antes disso são adiantamento, ' +
            'e o sistema não registra como férias.' };
      }
    }
    const dp = D.parametrosDP;
    const salarioBase = salarioVigenteEm(f, dataInicio);

    const pendente = (f.ferias || []).filter(function (p) { return (p.dias_gozados || 0) < p.dias_direito; })
      .sort(function (a, b) { return a.limite.localeCompare(b.limite); })[0];
    if (!pendente) return { erro: 'Não há período de férias pendente pra este funcionário.' };
    /* Férias integram a média das variáveis do PERÍODO AQUISITIVO
       (CLT art. 142 §5º e Súmula 151 do TST). */
    const mediaVarFer = mediaVariaveisHabituais(f,
      U.compDe(pendente.aquisitivo_inicio), U.compDe(pendente.aquisitivo_fim));
    const salarioMes = salarioBase + adicionalHabitual(f, salarioBase) + mediaVarFer;
    const vencida = dataInicio > pendente.limite;

    /* CLT art. 134 §1º: férias podem ser fracionadas em até 3
       períodos, mas UM DELES tem que ter pelo menos 14 dias corridos
       (os outros só precisam dos 5 mínimos já checados acima). Não dá
       pra saber isso só olhando esta fração isolada — depende de
       todas as frações já lançadas deste período aquisitivo. Por
       isso o corte é: bloqueia só quando esta fração tornaria
       IMPOSSÍVEL cumprir a regra depois — ou porque é a última fração
       (usa todo o período que resta) e nenhuma chegou a 14 dias, ou
       porque o que sobraria depois dela já é pouco demais (< 14) pra
       uma futura fração resolver sozinha. Fora desses dois casos,
       ainda dá tempo de uma fração posterior ter 14+ dias. */
    const fracoesExistentes = (pendente.gozos || []).filter(function (g) { return !g.cancelado && !g.__temporario; });
    if (fracoesExistentes.length >= 3) {
      return { erro: 'Este período aquisitivo já tem 3 frações de férias lançadas — a CLT (art. 134 §1º) permite no máximo 3.' };
    }
    /* Saldo do período, checado SEMPRE. Antes esta conta vivia dentro
       do `if (!jaTem14)`, então uma fração de 14 dias ou mais pulava a
       validação: era possível lançar 14 e depois 30 dias no mesmo
       período (44 de um direito de 30) e pagar R$ 8.400 a mais. O
       abono pecuniário passava pelo mesmo buraco. */
    const teto = tetoAbono(pendente.dias_direito);
    if (diasAbono > teto) {
      return { erro: 'Abono pecuniário não pode passar de ' + teto + ' dias (1/3 de ' +
        pendente.dias_direito + ').' };
    }
    const saldoPeriodo = pendente.dias_direito - (pendente.dias_gozados || 0);
    if (diasGozo + diasAbono > saldoPeriodo) {
      return { erro: 'O período aquisitivo tem ' + saldoPeriodo + ' dia(s) disponíveis e o ' +
        'lançamento soma ' + (diasGozo + diasAbono) + ' (' + diasGozo + ' de gozo' +
        (diasAbono ? ' + ' + diasAbono + ' de abono' : '') + ').' };
    }

    const jaTem14 = fracoesExistentes.some(function (g) { return g.dias_gozo >= 14; }) || diasGozo >= 14;
    if (!jaTem14) {
      const restanteDepois = pendente.dias_direito - (pendente.dias_gozados || 0) - diasGozo - diasAbono;
      if (restanteDepois <= 0) {
        return { erro: 'Uma das frações de férias deste período precisa ter pelo menos 14 dias corridos ' +
          '(CLT art. 134 §1º) — nenhuma das lançadas até agora chega lá, e esta seria a última fração do período.' };
      }
      if (restanteDepois < 14) {
        return { erro: 'Depois desta fração restariam só ' + restanteDepois + ' dia(s) no período — não dá mais ' +
          'pra nenhuma fração chegar aos 14 dias mínimos que uma delas precisa ter (CLT art. 134 §1º).' };
      }
    }

    const valorFerias = Math.round(salarioMes / 30 * diasGozo * (vencida ? 2 : 1) * 100) / 100;
    const tercoConstitucional = Math.round(valorFerias * dp.terco_constitucional_ferias * 100) / 100;
    // abono e o 1/3 sobre o abono também dobram se vencido — é a mesma regra do art. 137
    const abonoPecuniario = diasAbono > 0
      ? Math.round(salarioMes / 30 * diasAbono * (vencida ? 2 : 1) * 100) / 100 : 0;
    const tercoAbono = Math.round(abonoPecuniario * dp.terco_constitucional_ferias * 100) / 100;

    const baseBruta = Math.round((valorFerias + tercoConstitucional) * 100) / 100;
    /* A DOBRA das férias vencidas (art. 137 da CLT) não é salário de
       contribuição: a Lei 8.212, art. 28, §9º, "d", exclui a dobra.
       O INSS incide só sobre a parte simples; a dobra é indenizatória.
       Sem isso, a Camila pagava R$ 956,59 onde devia pagar R$ 585,51.
       FGTS: a contabilidade precisa confirmar o tratamento; por ora
       segue sobre o valor pago, que é o entendimento mais comum. */
    const baseSimples = vencida
      ? Math.round((valorFerias / 2 + tercoConstitucional / 2) * 100) / 100
      : baseBruta;
    const parteIndenizatoria = Math.round((baseBruta - baseSimples) * 100) / 100;
    /* INSS tem faixa progressiva e teto por COMPETÊNCIA, não por
       título — se o mesmo mês já vai ter (ou já teve) salário, ou
       outra fração de férias, o INSS desta aqui é o INCREMENTO sobre
       o que a competência já soma, não um cálculo do zero. Sem isso,
       cada pagamento recomeçava a tabela do zero e descontava menos
       INSS do que devido no total do mês (e o teto de R$988,09
       também é por competência, não por título). */
    const baseJaUsada = baseINSSJaUsadaNoMes(f, U.compDe(dataInicio),
      { data_inicio: dataInicio, dias_gozo: diasGozo, dias_abono: diasAbono });
    const inssComEsta = calcularINSS(Math.round((baseJaUsada + baseSimples) * 100) / 100);
    const inssJaDescontado = calcularINSS(baseJaUsada);
    const valorINSS = Math.max(0, Math.round((inssComEsta - inssJaDescontado) * 100) / 100);
    /* Pensão alimentícia incide sobre férias como sobre qualquer outro
       rendimento — reduz a base do IRRF (mesma lógica da folha
       mensal) E desconta do líquido de verdade (o beneficiário recebe
       a parte dele das férias também, não só do salário do mês). */
    const pensaoCadastro = f.pensao_alimenticia && f.pensao_alimenticia.ativo ? f.pensao_alimenticia : null;
    const pensaoValor = (pensaoCadastro && pensaoCadastro.incide_ferias !== false) ? pensaoCadastro.valor : 0;
    const irrfInc = irrfIncremental(f, U.compDe(dataInicio), baseBruta, valorINSS, pensaoValor);
    const valorIRRF = irrfInc.valor;
    const liquido = Math.round((baseBruta - valorINSS - valorIRRF - pensaoValor) * 100) / 100;
    // abono (+ 1/3 dele) é isento — entra direto no total, sem INSS/IRRF
    const totalAbono = Math.round((abonoPecuniario + tercoAbono) * 100) / 100;
    return {
      funcionario: f.id, dias_gozo: diasGozo, dias_abono: diasAbono, data_inicio: dataInicio, vencida: !!vencida,
      valor_ferias: valorFerias, terco_constitucional: tercoConstitucional,
      abono_pecuniario: abonoPecuniario, terco_abono: tercoAbono, total_abono: totalAbono,
      base_bruta: baseBruta, base_inss: baseSimples, dobra_indenizatoria: parteIndenizatoria,
      valor_inss: valorINSS, valor_irrf: valorIRRF, pensao_alimenticia: pensaoValor, liquido: liquido,
      total_pagar: Math.round((liquido + totalAbono) * 100) / 100
    };
  }

  /* Quantos dias de um mês já foram cobertos por férias já lançadas —
     usado pra não pagar salário cheio E férias na mesma competência
     pelos mesmos dias. Sobreposição simples entre o intervalo da
     folha (o mês inteiro) e o intervalo de cada gozo já lançado. */
  function diasFeriasNoMes(f, competencia) {
    const inicioMes = competencia + '-01';
    const fimMes = U.addDias(U.compDe(U.addMeses(inicioMes, 1)) + '-01', -1);
    let dias = 0;
    (f.ferias || []).forEach(function (per) {
      (per.gozos || []).forEach(function (g) {
        if (g.cancelado) return;   // gozo desfeito não ocupa mais dia nenhum do mês
        const fimGozo = U.addDias(g.data_inicio, g.dias_gozo - 1);
        const ini = g.data_inicio > inicioMes ? g.data_inicio : inicioMes;
        const fim = fimGozo < fimMes ? fimGozo : fimMes;
        if (ini <= fim) dias += U.diasEntre(ini, fim) + 1;
      });
    });
    return dias;
  }

  /* Base de INSS que este funcionário já vai gerar nesta competência,
     fora da férias que está sendo calculada agora — soma o salário do
     mês (real, se a folha já fechou; estimado, senão) com a base de
     qualquer OUTRA fração de férias já lançada no mesmo mês. O INSS
     tem teto e faixas progressivas por competência, não por título —
     pagar férias e salário (ou duas frações de férias) no mesmo mês em
     títulos separados sem somar as bases faz cada um recomeçar a
     tabela do zero, descontando MENOS INSS do que devido no total.
     Serve de base pro cálculo INCREMENTAL: o que este novo pagamento
     soma de INSS a mais, dado o que a competência já tem. */
  /* `gozoAtual`, quando informado, é o gozo de férias que está SENDO
     calculado agora — ainda não está em `f.ferias[].gozos[]` (só entra
     lá quando `lancarFerias` de fato confirma), mas os dias dele JÁ
     tiram a pessoa do trabalho normal naquele mês. Sem incluir esse
     gozo aqui, o salário do mês contava como se a pessoa tivesse
     trabalhado o mês inteiro, mesmo pedindo 30 dias de férias
     simultaneamente — a base ficava artificialmente alta (o salário
     cheio, não os poucos dias sobrando), e isso fazia o INSS "já
     descontado" vir maior do que devia, subtraindo demais e deixando
     o incremento (e o total do mês) abaixo do teto de verdade. */
  function baseINSSJaUsadaNoMes(f, competencia, gozoAtual) {
    let hFechado = null;
    st.folhas.forEach(function (fl) {
      if (fl.competencia !== competencia || fl.cancelada) return;
      const h = (fl.holerites || []).find(function (x) { return x.funcionario === f.id; });
      if (h) hFechado = h;
    });
    const folhaFechada = !!hFechado;
    let baseSalario;
    if (folhaFechada) {
      baseSalario = hFechado.base_inss;
    } else {
      /* Folha ainda não fechou: usa o MESMO cálculo que a folha vai
         usar de verdade (extrasComDiasPadrao + calcularHolerite), não
         uma conta simplificada à parte — assim a estimativa bate com
         o que vai sair na hora de fechar, incluindo o desconto dos
         dias de férias já lançados neste mês. Só não sabe de ajustes
         manuais (HE, faltas) que ainda serão digitados depois.

         Se há um gozo em cálculo agora, ele entra temporariamente na
         lista de gozos do funcionário só pelo tempo desta conta —
         calcularHolerite não tem outro jeito de saber dos dias dele,
         já que só olha `f.ferias[].gozos[]` de verdade. Desfaz logo
         em seguida, sem deixar rastro (nem se calcularHolerite der
         erro no meio do caminho). */
      let periodoAlvo = null, gozoTemporario = null;
      if (gozoAtual && gozoAtual.dias_gozo > 0) {
        periodoAlvo = (f.ferias || []).filter(function (p) { return (p.dias_gozados || 0) < p.dias_direito; })
          .sort(function (a, b) { return a.limite.localeCompare(b.limite); })[0];
        if (periodoAlvo) {
          periodoAlvo.gozos = periodoAlvo.gozos || [];
          gozoTemporario = { data_inicio: gozoAtual.data_inicio, dias_gozo: gozoAtual.dias_gozo,
            dias_abono: gozoAtual.dias_abono || 0, base_inss: 0, cancelado: false, __temporario: true };
          periodoAlvo.gozos.push(gozoTemporario);
        }
      }
      let h;
      try {
        const extras = extrasComDiasPadrao(f, competencia, {});
        h = calcularHolerite(f.id, competencia, extras);
      } finally {
        if (periodoAlvo && gozoTemporario) {
          const i = periodoAlvo.gozos.indexOf(gozoTemporario);
          if (i > -1) periodoAlvo.gozos.splice(i, 1);
        }
      }
      baseSalario = h.erro ? 0 : h.base_inss;
    }
    let baseOutrasFerias = 0;
    (f.ferias || []).forEach(function (per) {
      (per.gozos || []).forEach(function (g) {
        if (!g.cancelado && !g.__temporario && U.compDe(g.data_inicio) === competencia) baseOutrasFerias += (g.base_inss || 0);
      });
    });
    return Math.round((baseSalario + baseOutrasFerias) * 100) / 100;
  }

  /* IRRF é CUMULATIVO no mês, pela mesma fonte pagadora: férias e
     folha somam numa base só. Cada pagamento calculado isolado ganhava
     a sua própria faixa, o seu próprio desconto simplificado de
     R$ 607,20 e o seu próprio redutor da Lei 15.270/2025 — e, como
     cada parcela sozinha fica abaixo do limite, o redutor zerava as
     duas. Resultado: R$ 5.978,23 de rendimento no mês saíam com IRRF
     zero. O INSS já era tratado assim; faltava o espelho.

     Devolve o que já foi pago no mês (rendimento, INSS e deduções),
     para o cálculo seguinte sair por INCREMENTO. */
  function irrfJaUsadoNoMes(f, competencia) {
    let rendimento = 0, inss = 0, irrf = 0;
    st.folhas.forEach(function (fl) {
      if (fl.competencia !== competencia || fl.cancelada) return;
      const h = (fl.holerites || []).find(function (x) { return x.funcionario === f.id; });
      if (!h) return;
      /* O holerite grava `valor_inss` e `valor_irrf`; ler `h.inss` e
         `h.irrf` trazia undefined, então o imposto já retido entrava
         como ZERO e a folha complementar cobrava o mês inteiro de
         novo — R$ 3.028,28 a mais do funcionário num caso de salário
         de R$ 12.000. */
      rendimento += (h.base_irrf_bruta !== undefined ? h.base_irrf_bruta : (h.total_vencimentos || 0));
      inss += (h.valor_inss || h.inss || 0);
      irrf += (h.valor_irrf || h.irrf || 0);
    });
    (f.ferias || []).forEach(function (per) {
      (per.gozos || []).forEach(function (g) {
        if (g.cancelado || g.__temporario) return;
        if (U.compDe(g.data_inicio) !== competencia) return;
        rendimento += (g.base_irrf_bruta || 0);
        inss += (g.inss || 0);
        irrf += (g.irrf || 0);
      });
    });
    return { rendimento: Math.round(rendimento * 100) / 100,
      inss: Math.round(inss * 100) / 100, irrf: Math.round(irrf * 100) / 100 };
  }

  /* IRRF deste pagamento = imposto do mês inteiro − o que já foi
     retido no mês. */
  function irrfIncremental(f, competencia, rendimentoAtual, inssAtual, pensaoAtual) {
    const ja = irrfJaUsadoNoMes(f, competencia);
    const totalMes = calcularIRRF(
      Math.round((ja.rendimento + rendimentoAtual) * 100) / 100,
      Math.round((ja.inss + (inssAtual || 0)) * 100) / 100,
      f.dependentes_irrf, pensaoAtual);
    return { valor: Math.max(0, Math.round((totalMes - ja.irrf) * 100) / 100),
      acumulado: ja, total_mes: totalMes };
  }

  function lancarFerias(funcionarioId, calc, dataInicio) {
    if (!pode('dp')) return { erro: 'Seu perfil não lança férias.' };
    const f = D.funcionario(funcionarioId);
    if (!f) return { erro: 'Funcionário não encontrado.' };
    /* Cálculo com erro (ou sem data) não vira lançamento: passava
       adiante e gravava um gozo sem data de início, que depois
       quebrava qualquer conta que percorresse o período. */
    if (!calc || calc.erro) return { erro: (calc && calc.erro) || 'Calcule as férias antes de lançar.' };
    if (!dataInicio) return { erro: 'Informe a data de início das férias.' };
    const comp = U.compDe(dataInicio);
    if (st.folhas.some(function (fl) { return fl.competencia === comp && !fl.cancelada; })) {
      return { erro: 'A folha de ' + U.fComp(comp) + ' já foi fechada — o salário do mês já saiu. ' +
        'Cancele a folha antes de lançar férias que caem nesse mês, senão os mesmos dias são pagos duas vezes.' };
    }
    /* Pensão alimentícia descontada das férias vira título pro
       beneficiário (ver mais abaixo) — checado ANTES de criar
       qualquer título, mesmo motivo de sempre: falhar depois de já
       ter criado o título do líquido deixaria ele órfão. */
    if (calc.pensao_alimenticia > 0.004) {
      const pensaoCadastroCheck = f.pensao_alimenticia && f.pensao_alimenticia.ativo ? f.pensao_alimenticia : null;
      if (!pensaoCadastroCheck || !pensaoCadastroCheck.beneficiario_nome) {
        return { erro: 'Pensão alimentícia sem beneficiário cadastrado — abra o funcionário em Editar e ' +
          'cadastre o beneficiário antes de lançar as férias.' };
      }
    }
    const r = criarTitulo({
      _interno: true, descricao: 'Férias — ' + f.nome + ' (' + calc.dias_gozo + ' dias' +
        (calc.dias_abono ? ' + ' + calc.dias_abono + ' de abono' : '') + (calc.vencida ? ', vencidas — em dobro' : '') + ')',
      documento: 'FERIAS-' + f.matricula + '-' + dataInicio,
      tipo_titulo: 'ferias', credor: f.credor_id, conta: '4.05',
      centro: (f.rateio || [])[0] ? f.rateio[0].centro : f.centro, rateio: f.rateio,
      emissao: U.hoje(), origem: 'ferias', origem_ref: 'ferias-' + f.id + '-' + dataInicio,
      obs: 'Base ' + U.brl(calc.base_bruta) + ' (férias + 1/3)' +
        (calc.total_abono ? ' · abono ' + U.brl(calc.total_abono) + ' (isento)' : '') +
        (calc.vencida ? ' · pago em dobro (férias vencidas, art. 137 CLT)' : '')
    }, [{ num: 1, venc: diaUtilAnterior(U.addDias(dataInicio, -2)), comp: comp, valor: calc.total_pagar }]);
    if (!r.ok) return r;
    st.parcelas.filter(function (pc) { return pc.titulo_id === r.titulo.id; })
      .forEach(function (pc) { pc.status = 'previsto'; });
    const tituloIds = [r.titulo.id];

    /* Férias geravam só o título do líquido pago ao funcionário — o
       INSS e o IRRF retidos DELE (que reduzem o líquido) nunca viravam
       guia nenhuma pro governo, e o FGTS/INSS patronal/RAT×FAP da
       EMPRESA sobre as férias não existiam em lugar nenhum: eram
       encargo de verdade (mesma alíquota da folha mensal) que nunca
       tinha título nenhum representando ele. Mesmo padrão de conta e
       credor já usado no fechamento da folha e da rescisão. */
    const dp = D.parametrosDP;
    const credorGuia = credorGuiaDe('federal');
    const rateioF = f.rateio;
    const centroF = (f.rateio || [])[0] ? f.rateio[0].centro : f.centro;
    /* Competências diferentes: o IRRF é pelo PAGAMENTO (as férias são
       pagas 2 dias antes do início) e vence no dia 20 do mês seguinte a
       ele; INSS, FGTS e patronal são da competência do GOZO (mês de
       início) e vencem no dia 20 do mês seguinte ao gozo, junto com a
       DCTFWeb daquela competência. Férias que começam em 01/10 e são
       pagas em 29/09: IRRF vence 20/10; INSS/FGTS/patronal, 20/11. */
    const vencIRRFFerias = dia20MesSeguinte(diaUtilAnterior(U.addDias(dataInicio, -2)));
    const vencEncargosFerias = dia20MesSeguinte(dataInicio);
    [['INSS', calc.valor_inss, vencEncargosFerias, 'GPS-FER-'], ['IRRF', calc.valor_irrf, vencIRRFFerias, 'DARF-FER-']].forEach(function (g) {
      if (!(g[1] > 0.004)) return;
      const rg = criarTitulo({
        _interno: true, descricao: g[0] + ' retido das férias — ' + f.nome, documento: g[3] + f.matricula + '-' + dataInicio,
        tipo_titulo: 'guia', credor: credorGuia, conta: '4.05', centro: centroF, rateio: rateioF,
        emissao: U.hoje(), origem: 'ferias', origem_ref: 'ferias-' + g[0].toLowerCase() + '-' + f.id + '-' + dataInicio,
        obs: g[0] + ' ' + U.brl(g[1]) + ' retido das férias de ' + f.nome + ' (' +
          (g[0] === 'IRRF' ? 'competência do pagamento' : 'competência do gozo') + ').'
      }, [{ num: 1, venc: g[2], comp: comp, valor: Math.round(g[1] * 100) / 100 }]);
      if (rg.ok) {
        tituloIds.push(rg.titulo.id);
        st.parcelas.filter(function (pc) { return pc.titulo_id === rg.titulo.id; }).forEach(function (pc) { pc.status = 'previsto'; });
      }
    });
    const fgtsFerias = calcularFGTS(calc.base_bruta);
    if (fgtsFerias > 0.004) {
      const rf = criarTitulo({
        _interno: true, descricao: 'FGTS sobre férias — ' + f.nome, documento: 'FGTS-FER-' + f.matricula + '-' + dataInicio,
        tipo_titulo: 'guia', credor: credorGuiaDe('fgts'), conta: '4.03', centro: centroF, rateio: rateioF,
        emissao: U.hoje(), origem: 'ferias', origem_ref: 'ferias-fgts-' + f.id + '-' + dataInicio,
        obs: dp.aliquota_fgts + '% sobre a base de férias de ' + f.nome + ' — encargo da empresa.'
      }, [{ num: 1, venc: vencEncargosFerias, comp: comp, valor: fgtsFerias }]);
      if (rf.ok) {
        tituloIds.push(rf.titulo.id);
        st.parcelas.filter(function (pc) { return pc.titulo_id === rf.titulo.id; }).forEach(function (pc) { pc.status = 'previsto'; });
      }
    }
    /* Encargos patronais sobre a BASE DE INSS, não sobre a base bruta.
       O salário de contribuição é um só: a dobra do art. 137 que o
       próprio sistema exclui da parte do empregado (art. 28 §9º "d" da
       Lei 8.212) está igualmente fora do art. 22, I, da mesma lei.
       Cobrando sobre a bruta, férias vencidas de R$ 11.200 geravam
       R$ 2.240 de patronal onde são devidos R$ 1.120. */
    const basePatronalFerias = calc.base_inss !== undefined && calc.base_inss !== null
      ? calc.base_inss : calc.base_bruta;
    const inssPatronalFerias = Math.round(basePatronalFerias * dp.aliquota_inss_patronal / 100 * 100) / 100;
    const outrosEncargosFerias = Math.round(basePatronalFerias * (dp.aliquota_rat_fap + dp.aliquota_terceiros) / 100 * 100) / 100;
    if (inssPatronalFerias + outrosEncargosFerias > 0.004) {
      const rp = criarTitulo({
        _interno: true, descricao: 'INSS patronal + RAT×FAP + terceiros sobre férias — ' + f.nome,
        documento: 'GPS-PATRONAL-FER-' + f.matricula + '-' + dataInicio,
        tipo_titulo: 'guia', credor: credorGuia, conta: '4.04', centro: centroF, rateio: rateioF,
        emissao: U.hoje(), origem: 'ferias', origem_ref: 'ferias-patronal-' + f.id + '-' + dataInicio,
        obs: dp.aliquota_inss_patronal + '% de INSS patronal (' + U.brl(inssPatronalFerias) + ') + ' +
          (dp.aliquota_rat_fap + dp.aliquota_terceiros) + '% de RAT×FAP/terceiros (' + U.brl(outrosEncargosFerias) +
          ') sobre a base de férias de ' + f.nome + ' — encargo da empresa.'
      }, [{ num: 1, venc: vencEncargosFerias, comp: comp, valor: Math.round((inssPatronalFerias + outrosEncargosFerias) * 100) / 100 }]);
      if (rp.ok) {
        tituloIds.push(rp.titulo.id);
        st.parcelas.filter(function (pc) { return pc.titulo_id === rp.titulo.id; }).forEach(function (pc) { pc.status = 'previsto'; });
      }
    }
    /* Pensão alimentícia descontada das férias vira título à parte pro
       beneficiário — mesma lógica da folha e da rescisão. Beneficiário
       já foi conferido lá em cima, antes de criar qualquer título. */
    if (calc.pensao_alimenticia > 0.004) {
      const credorPensao = credorPensionista(f);
      const rPensao = criarTitulo({
        _interno: true, descricao: 'Pensão alimentícia — ' + f.pensao_alimenticia.beneficiario_nome +
          ' (desconto das férias de ' + f.nome + ')',
        documento: 'PENSAO-FER-' + f.matricula + '-' + dataInicio,
        tipo_titulo: 'pensao', credor: credorPensao, conta: '4.05', centro: centroF, rateio: rateioF,
        emissao: U.hoje(), origem: 'ferias', origem_ref: 'ferias-pensao-' + f.id + '-' + dataInicio,
        obs: 'Descontado das férias de ' + f.nome + ' a partir de ' + U.fData(dataInicio) + '.'
      }, [{ num: 1, venc: diaUtilAnterior(U.addDias(dataInicio, -2)), comp: comp, valor: calc.pensao_alimenticia }]);
      if (rPensao.ok) {
        tituloIds.push(rPensao.titulo.id);
        st.parcelas.filter(function (pc) { return pc.titulo_id === rPensao.titulo.id; }).forEach(function (pc) { pc.status = 'previsto'; });
      }
    }

    const per = (f.ferias || []).filter(function (p) { return (p.dias_gozados || 0) < p.dias_direito; })
      .sort(function (a, b) { return a.limite.localeCompare(b.limite); })[0];
    if (per) {
      per.dias_gozados = (per.dias_gozados || 0) + calc.dias_gozo + calc.dias_abono;
      per.gozos = per.gozos || [];
      /* base_inss guardada aqui é o que permite a PRÓXIMA fração de
         férias (ou o salário) do MESMO mês somar corretamente pro
         teto/faixa progressiva do INSS — ver baseINSSJaUsadaNoMes.
         titulo_ids guarda TODOS os títulos deste gozo (líquido +
         guias de INSS/IRRF/FGTS/patronal) — sem isso, cancelar um
         gozo só cancelava o líquido e as guias ficavam soltas,
         cobrando encargo de uma férias que nem existe mais. */
      per.gozos.push({ data_inicio: dataInicio, dias_gozo: calc.dias_gozo, dias_abono: calc.dias_abono,
        base_inss: calc.base_inss !== undefined && calc.base_inss !== null
          ? calc.base_inss : calc.base_bruta,
        /* Guardados para o IRRF do mês ser cumulativo: a folha
           seguinte precisa saber o que estas férias já somaram de
           rendimento e já retiveram de imposto. */
        /* `base_inss` guarda o SALÁRIO DE CONTRIBUIÇÃO, não a base
           bruta: nas férias vencidas a dobra do art. 137 está fora do
           INSS, e gravar a bruta reservava faixa a mais no mês. */
        base_irrf_bruta: calc.base_bruta, inss: calc.valor_inss || 0, irrf: calc.valor_irrf || 0,
        pensao: calc.pensao_alimenticia || 0, titulo_id: r.titulo.id, titulo_ids: tituloIds, cancelado: false });
    }
    logar('funcionario', f.id, 'tirou férias', calc.dias_gozo + ' dias a partir de ' + U.fData(dataInicio) +
      (calc.dias_abono ? ' + ' + calc.dias_abono + ' de abono' : ''));
    return { ok: true, titulo: r.titulo, titulo_ids: tituloIds };
  }

  /* Cancelar um gozo de férias já lançado — sem isso, um lançamento
     errado (data errada, dias errados) só dava pra "corrigir" lançando
     OUTRO gozo por cima, sem nunca desfazer o primeiro: os dias
     gozados ficavam contando duas vezes, e os títulos errados
     continuavam nas contas a pagar pra sempre. Segue o mesmo padrão de
     cancelarFolha/cancelar13: recusa se já tiver pagamento de
     verdade, a menos que force (e mesmo forçando, só devolve os dias
     ao período se TODOS os títulos foram cancelados de verdade). */
  function cancelarFerias(funcionarioId, dataInicio, motivo, forcar) {
    if (!pode('dp')) return { erro: 'Seu perfil não cancela férias.' };
    const f = D.funcionario(funcionarioId);
    if (!f) return { erro: 'Funcionário não encontrado.' };
    if (!motivo) return { erro: 'Informe o motivo do cancelamento.' };
    let gozoAlvo = null, periodoAlvo = null;
    (f.ferias || []).forEach(function (per) {
      (per.gozos || []).forEach(function (g) {
        if (g.data_inicio === dataInicio && !g.cancelado) { gozoAlvo = g; periodoAlvo = per; }
      });
    });
    if (!gozoAlvo) return { erro: 'Não encontrei férias lançadas nesta data (ou já foram canceladas).' };
    const idsDoGozo = gozoAlvo.titulo_ids || [gozoAlvo.titulo_id];
    const parcelasDoGozo = st.parcelas.filter(function (p) { return idsDoGozo.indexOf(p.titulo_id) > -1; });
    const jaPagas = parcelasDoGozo.filter(function (p) { return pagamentosDe(p.id).length > 0; });
    if (jaPagas.length && !forcar) {
      return { erro: 'Este gozo de férias já teve pagamento registrado. Force o cancelamento se precisar ' +
        'mesmo assim, ou estorne o pagamento antes.', jaPagas: jaPagas.length };
    }
    let n = 0;
    parcelasDoGozo.forEach(function (p) {
      if (p.status === 'cancelado') { n++; return; }
      const r = cancelar(p.id, motivo, true);
      if (r.ok) n++;
    });
    const canceladoCompleto = n === parcelasDoGozo.length;
    gozoAlvo.cancelado = canceladoCompleto;
    gozoAlvo.motivo_cancelamento = motivo;
    if (canceladoCompleto) {
      // devolve os dias ao período — só quando TODO o gozo foi desfeito de verdade
      periodoAlvo.dias_gozados = Math.max(0, (periodoAlvo.dias_gozados || 0) - gozoAlvo.dias_gozo - gozoAlvo.dias_abono);
    }
    logar('funcionario', f.id, canceladoCompleto ? 'cancelou férias' : 'cancelou férias parcialmente (havia pagamento já registrado)',
      U.fData(dataInicio) + ' · ' + motivo);
    return { ok: true, cancelado_completo: canceladoCompleto };
  }


  /* ── rescisão ────────────────────────────────────────────
     Cobre as verbas mais comuns de uma dispensa sem justa causa. Não
     cobre justa causa (sem aviso, sem multa de FGTS) nem pedido de
     demissão (sem multa, aviso pode ser descontado) — são fórmulas
     diferentes; comece por "sem justa causa" e ajuste na tela se o
     caso for outro. Multa de FGTS aqui é uma ESTIMATIVA (40% sobre o
     que a folha já gerou de FGTS para este funcionário no sistema) —
     o valor real depende do extrato de FGTS na Caixa, que este ERP
     não tem. */
  /* Rótulo e regras de cada motivo de rescisão — o texto que aparece
     na tela vem sempre daqui, pra nunca ficar descolado do que a
     conta realmente aplica. */
  const TIPOS_RESCISAO = {
    sem_justa_causa: { nome: 'Dispensa sem justa causa', fracaoAviso: 1, fracaoMulta: 1, feriasProporcionais: true, decimoProporcional: true },
    pedido_demissao: { nome: 'Pedido de demissão', fracaoAviso: 0, fracaoMulta: 0, feriasProporcionais: true, decimoProporcional: true },
    justa_causa: { nome: 'Dispensa por justa causa', fracaoAviso: 0, fracaoMulta: 0, feriasProporcionais: false, decimoProporcional: false },
    /* Acordo (CLT art. 484-A): aviso e multa de FGTS pela METADE — não
       zero, não inteiro. Férias e 13º proporcionais continuam
       integrais, isso não muda com o motivo. */
    acordo: { nome: 'Acordo entre as partes (art. 484-A)', fracaoAviso: 0.5, fracaoMulta: 0.5, feriasProporcionais: true, decimoProporcional: true },
    /* Fim natural do prazo de um contrato de experiência: sem aviso
       prévio (o fim já era esperado, não pega ninguém de surpresa) e
       sem multa de FGTS. Só cobre o término NO PRAZO — rescisão
       antecipada do contrato de experiência é outra conta (multa do
       art. 479 CLT), que este sistema não calcula ainda. */
    termino_experiencia: { nome: 'Término de contrato de experiência', fracaoAviso: 0, fracaoMulta: 0, feriasProporcionais: true, decimoProporcional: true },
    /* Rescisão indireta (CLT art. 483): o funcionário pede a saída por
       culpa do EMPREGADOR (atraso de salário, assédio etc.). Reconhecida
       a culpa, os direitos são os MESMOS de uma dispensa sem justa
       causa — muda só a justificativa jurídica, não a conta. */
    rescisao_indireta: { nome: 'Rescisão indireta (art. 483 — culpa do empregador)', fracaoAviso: 1, fracaoMulta: 1, feriasProporcionais: true, decimoProporcional: true }
  };

  /* `opcoes`: { tipo, avisoIndenizado, avisoCumprido, multaFGTSManual }.
     `tipo` decide o que a rescisão paga — é a mesma conta pros três
     casos, só liga e desliga verba conforme a regra de cada um, pra
     não manter três fórmulas soltas que podem divergir. */
  /* Início do período aquisitivo de férias EM CURSO numa data — o
     aniversário de admissão mais recente que não passou da data de
     referência. Férias proporcionais contam a partir daqui, não do
     ano civil (são coisas diferentes: 13º usa ano civil, férias usa
     período aquisitivo — bug real: os dois estavam usando ano civil). */
  function inicioPeriodoAquisitivoAtual(f, dataRef) {
    const adm = new Date(f.admissao + 'T00:00:00Z');
    const ref = new Date(dataRef + 'T00:00:00Z');
    let aniv = new Date(Date.UTC(ref.getUTCFullYear(), adm.getUTCMonth(), adm.getUTCDate()));
    if (aniv > ref) aniv = new Date(Date.UTC(ref.getUTCFullYear() - 1, adm.getUTCMonth(), adm.getUTCDate()));
    return aniv.toISOString().slice(0, 10);
  }

  /* Gera sozinho todo período aquisitivo já FECHADO (12 meses
     completos desde a admissão) que ainda não estava na lista do
     funcionário — sem isso, um funcionário novo (cadastrado com
     `ferias: []`) aparecia como "sem férias pendentes" pra sempre, e um
     período que já tinha completado o ciclo mas nunca foi digitado a
     mão ficava invisível tanto pra tela de férias quanto pra rescisão.
     Chamado sempre antes de LER `f.ferias`, nunca guarda período em
     curso (só o que já fechou os 12 meses). */
  /* Pagamento com prazo legal cai para o dia útil ANTERIOR quando a
     data bate em fim de semana ou feriado: pagar depois do prazo é que
     não pode (férias, art. 145; rescisão, art. 477 §6º). */
  function diaUtilAnterior(data) {
    let d = data;
    let guarda = 0;
    while (guarda++ < 10) {
      const ds = new Date(d + 'T12:00:00').getDay();
      if (ds !== 0 && ds !== 6 && !ehFeriado(d)) return d;
      d = U.addDias(d, -1);
    }
    return d;
  }

  /* Art. 130 da CLT: as faltas injustificadas do período aquisitivo
     reduzem os dias de férias — 30, 24, 18, 12 ou nenhum. O sistema
     assumia 30 sempre. O padrão continua 30 e a redução só vale
     quando alguém informar as faltas do período (`faltas_periodo`). */
  function diasDeDireitoPorFaltas(faltas) {
    const n = Math.max(0, Number(faltas) || 0);
    if (n <= 5) return 30;
    if (n <= 14) return 24;
    if (n <= 23) return 18;
    if (n <= 32) return 12;
    return 0;
  }

  /* Teto do abono pecuniário: 1/3 do direito (art. 143), não 10
     fixos — com 24 dias de direito o teto é 8. */
  const tetoAbono = diasDireito => Math.floor((diasDireito || 30) / 3);

  /* Faltas injustificadas dentro do período aquisitivo, somadas dos
     holerites fechados — é onde o sistema já as guarda. */
  function faltasNoPeriodo(f, inicio, fim) {
    let n = 0;
    st.folhas.forEach(function (fl) {
      if (fl.cancelada) return;
      const primeiroDia = fl.competencia + '-01';
      if (primeiroDia < inicio.slice(0, 7) + '-01' || primeiroDia > fim) return;
      const h = (fl.holerites || []).find(function (x) { return x.funcionario === f.id; });
      if (h) n += (h.faltas || 0);
    });
    return n;
  }

  function sincronizarPeriodosFerias(f, dataRef) {
    dataRef = dataRef || U.hoje();
    f.ferias = f.ferias || [];
    let inicio = f.admissao;
    let guarda = 0;
    while (guarda < 80) {   // trava de segurança — 80 períodos é 80 anos de casa
      const fim = U.addDias(U.addMeses(inicio, 12), -1);
      if (fim >= dataRef) break;   // este período ainda está em curso, não fechou
      if (!f.ferias.some(function (p) { return p.aquisitivo_inicio === inicio; })) {
        f.ferias.push({
          id: 'fer-' + f.id + '-' + inicio, aquisitivo_inicio: inicio, aquisitivo_fim: fim,
          /* As faltas do período vêm dos holerites: a regra do art.
             130 estava implementada e DESLIGADA, porque este era o
             único lugar que criava período e passava zero fixo. */
          dias_direito: diasDeDireitoPorFaltas(faltasNoPeriodo(f, inicio, fim)),
          faltas_periodo: faltasNoPeriodo(f, inicio, fim),
          dias_gozados: 0, limite: U.addMeses(fim, 12), gozos: []
        });
      }
      /* Período já existente é reavaliado: folha fechada depois pode
         ter trazido faltas que reduzem o direito. Nunca abaixo do
         que já foi gozado. */
      const existente = f.ferias.find(function (p) { return p.aquisitivo_inicio === inicio; });
      if (existente && !existente.dias_direito_manual) {
        const faltas = faltasNoPeriodo(f, inicio, fim);
        existente.faltas_periodo = faltas;
        existente.dias_direito = Math.max(existente.dias_gozados || 0,
          diasDeDireitoPorFaltas(faltas));
      }
      inicio = U.addDias(fim, 1);
      guarda++;
    }
    return f.ferias;
  }

  /* Avos entre duas datas: mês CALENDÁRIO completo conta cheio, 15+
     dias do mês corrente (contados a partir do último aniversário
     mensal da data de início) contam mais um, menos que isso não
     conta nada — nunca força um mínimo de 1. Usar blocos fixos de 30
     dias (jeito antigo) dava errado: de 01/06 a 14/01 são 228 dias,
     228/30 = 7 e resto 18 — 18≥15 arredondava pra 8, mas o calendário
     mostra só 7 meses completos (01/06 a 01/01) mais 13 dias de
     janeiro, que não fecham 15. */
  function avosEntre(inicioIso, fimIso) {
    if (fimIso < inicioIso) return 0;
    const ini = new Date(inicioIso + 'T00:00:00Z');
    const fim = new Date(fimIso + 'T00:00:00Z');
    let meses = (fim.getUTCFullYear() - ini.getUTCFullYear()) * 12 + (fim.getUTCMonth() - ini.getUTCMonth());
    if (fim.getUTCDate() < ini.getUTCDate()) meses--;
    meses = Math.max(0, meses);
    const ultimoAniversario = new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + meses, ini.getUTCDate()));
    // contagem INCLUSIVA: de 01/12 a 15/12 são 15 dias (antes dava 14 e a fração de 15 nunca contava)
    const diasNoMesIncompleto = Math.round((fim - ultimoAniversario) / 86400000) + 1;
    return Math.min(12, meses + (diasNoMesIncompleto >= 15 ? 1 : 0));
  }

  /* Avos de 13º (Lei 4.090, art. 1º §2º): por MÊS CIVIL — cada mês do
     ano em que a pessoa trabalhou 15 dias ou mais conta 1/12. Diferente
     das férias, que contam pelo período aquisitivo a partir do dia da
     admissão (avosEntre). Ex.: admitido 17/01, desligado 15/12 → janeiro
     tem 15 dias e dezembro 15 → 12 avos. */
  function avos13(inicioIso, fimIso) {
    if (fimIso < inicioIso) return 0;
    let n = 0, m = inicioIso.slice(0, 7);
    const ultimo = fimIso.slice(0, 7);
    for (let i = 0; i < 24 && m <= ultimo; i++) {
      const primeiroDia = m + '-01';
      const ultimoDia = U.addDias(U.compDe(U.addMeses(primeiroDia, 1)) + '-01', -1);
      const a = inicioIso > primeiroDia ? inicioIso : primeiroDia;
      const b = fimIso < ultimoDia ? fimIso : ultimoDia;
      if (U.diasEntre(a, b) + 1 >= 15) n++;
      m = U.compDe(U.addMeses(primeiroDia, 1));
    }
    return Math.min(12, n);
  }

  function calcularRescisao(funcionarioId, dataDesligamento, opcoes) {
    opcoes = opcoes || {};
    const tipoId = opcoes.tipo && TIPOS_RESCISAO[opcoes.tipo] ? opcoes.tipo : 'sem_justa_causa';
    const regra = TIPOS_RESCISAO[tipoId];
    const f = D.funcionario(funcionarioId);
    if (!f) return { erro: 'Funcionário não encontrado.' };
    if (!dataExiste(dataDesligamento)) {
      return { erro: 'Data de desligamento inválida (' + dataDesligamento + ').' };
    }
    if (dataDesligamento < f.admissao) {
      return { erro: 'Data de desligamento (' + U.fData(dataDesligamento) + ') é anterior à admissão (' +
        U.fData(f.admissao) + ').' };
    }
    sincronizarPeriodosFerias(f, dataDesligamento);
    const dp = D.parametrosDP;
    const salarioBase = salarioVigenteEm(f, dataDesligamento);
    /* Insalubridade/periculosidade explícitas — mesma conta de
       adicionalHabitual, mas guardadas à parte pra mostrar na tela em
       vez de só desaparecer dentro do salarioMes. */
    const valorAdicionalHabitual = adicionalHabitual(f, salarioBase);
    const salarioMes = salarioBase + valorAdicionalHabitual;
    /* Saldo de salário = dias do mês efetivamente trabalhados até o
       desligamento: começa na admissão se ela foi neste mesmo mês, e
       NÃO inclui dias de férias que caem no mês até a saída — esses já
       foram pagos no título de férias (antes, férias de 01 a 05/12 e
       saída em 10/12 pagavam 10 dias de saldo em vez de 5). */
    const inicioMesDeslig = dataDesligamento.slice(0, 8) + '01';
    const inicioSaldo = f.admissao > inicioMesDeslig ? f.admissao : inicioMesDeslig;
    const diasFeriasNoSaldo = diasFeriasEntre(f, inicioSaldo, dataDesligamento);
    const dia = Math.max(0, U.diasEntre(inicioSaldo, dataDesligamento) + 1 - diasFeriasNoSaldo);
    let saldoSalario = Math.round(salarioMes / 30 * Math.min(30, dia) * 100) / 100;

    /* Horas extras/noturno pendentes de pagar no saldo do mês da
       rescisão, com o DSR sobre elas — mesma fórmula da folha mensal
       (ver calcularHolerite). Opcional: só entra se informado. */
    const divisorHora = f.jornada_semanal_horas === 44 ? dp.divisor_hora_padrao : Math.round(f.jornada_semanal_horas * 5);
    const valorHora = Math.round(salarioMes / divisorHora * 100) / 100;
    let variaveisRescisao = 0;
    const he50Valor = opcoes.he50_horas > 0 ? Math.round(valorHora * 1.5 * opcoes.he50_horas * 100) / 100 : 0;
    const he100Valor = opcoes.he100_horas > 0 ? Math.round(valorHora * 2 * opcoes.he100_horas * 100) / 100 : 0;
    const noturnoValor = opcoes.horas_noturnas > 0 ? Math.round(valorHora * 0.2 * opcoes.horas_noturnas * 100) / 100 : 0;
    variaveisRescisao = Math.round((he50Valor + he100Valor + noturnoValor) * 100) / 100;
    const dsrRescisao = variaveisRescisao > 0.004
      ? Math.round(variaveisRescisao * (opcoes.razao_dsr !== undefined ? opcoes.razao_dsr : (5 / 25)) * 100) / 100 : 0;
    saldoSalario = Math.round((saldoSalario + variaveisRescisao + dsrRescisao) * 100) / 100;

    /* Gratificação, VT e VR do mês da rescisão — mesma lógica da folha
       mensal, só que proporcional aos dias efetivamente trabalhados
       (`dia`, o dia do desligamento) em vez do mês inteiro. Antes a
       rescisão não tocava em nenhum dos três. */
    const gratificacaoValor = opcoes.gratificacao_valor > 0 ? Math.round(opcoes.gratificacao_valor * 100) / 100 : 0;
    saldoSalario = Math.round((saldoSalario + gratificacaoValor) * 100) / 100;

    let vtGastoRescisao = 0, vtDescontoRescisao = 0;
    if (f.vale_transporte && f.vt_dia > 0) {
      vtGastoRescisao = Math.round(f.vt_dia * dia * 100) / 100;
      if (opcoes.vt_desconto_valor !== undefined) {
        vtDescontoRescisao = Math.min(vtGastoRescisao, Math.max(0, opcoes.vt_desconto_valor));
      } else if (f.vt_desconto_modo === 'nenhum') {
        vtDescontoRescisao = 0;
      } else if (f.vt_desconto_modo === 'valor' && f.vt_desconto_valor > 0) {
        vtDescontoRescisao = Math.min(vtGastoRescisao, f.vt_desconto_valor);
      } else {
        const pct = f.vt_desconto_valor > 0 ? f.vt_desconto_valor : dp.percentual_vt_max_desconto;
        vtDescontoRescisao = Math.min(vtGastoRescisao, Math.round(salarioMes * pct / 100 * Math.min(30, dia) / 30 * 100) / 100);
      }
    }
    let vrGastoRescisao = 0, vrDescontoRescisao = 0;
    if (f.vale_refeicao && f.vr_dia > 0) {
      vrGastoRescisao = Math.round(f.vr_dia * dia * 100) / 100;
      if (opcoes.vr_desconto_valor !== undefined) {
        vrDescontoRescisao = Math.min(vrGastoRescisao, Math.max(0, opcoes.vr_desconto_valor));
      } else if (f.vr_desconto_modo === 'valor' && f.vr_desconto_valor > 0) {
        vrDescontoRescisao = Math.min(vrGastoRescisao, f.vr_desconto_valor);
      } else if (f.vr_desconto_modo === 'percentual' && f.vr_desconto_valor > 0) {
        vrDescontoRescisao = Math.round(vrGastoRescisao * f.vr_desconto_valor / 100 * 100) / 100;
      }
    }

    /* Salário-família continua devido no mês do desligamento (é
       benefício por dependente, não proporcional a dias trabalhados)
       — mesma regra de teto e idade da folha mensal, calculada na
       data de desligamento. Isento de INSS/IRRF, por isso soma direto
       no bruto, não passa pela base tributável. */
    /* O teto é testado contra a REMUNERAÇÃO DO MÊS, não contra o
       saldo proporcional: quem ganha R$ 4.200 e sai no dia 5 tem
       saldo de R$ 700 e passava no teto, recebendo um benefício a que
       não tem direito. A cota também é proporcional aos dias
       trabalhados, como o próprio saldo de salário. */
    let salarioFamiliaRescisao = 0;
    const remuneracaoDoMes = salarioVigenteEm(f, dataDesligamento);
    if (remuneracaoDoMes <= dp.teto_salario_familia) {
      const dependentesElegiveis = (f.dependentes || []).filter(function (d) {
        if (!d.data_nascimento) return false;
        const idade = idadeEm(d.data_nascimento, dataDesligamento);
        /* Devido ATÉ o mês em que completa 14 (Decreto 3.048, art.
           84): cortar por "idade < 14" no último dia excluía o mês
           inteiro do aniversário, que a lei inclui. A conta é se
           ainda não completou 14 no primeiro dia do mês SEGUINTE. */
        return idade !== null && idade < 14;
      }).length;
      const diasDoMes = parseInt(dataDesligamento.slice(8, 10), 10);
      salarioFamiliaRescisao = Math.round(
        dependentesElegiveis * dp.valor_salario_familia * (diasDoMes / 30) * 100) / 100;
    }

    /* Pensão alimentícia continua descontando na rescisão — vem do
       cadastro por padrão, editável via opcoes.pensao_alimenticia_valor
       pro mesmo mecanismo de override da folha mensal. */
    const pensaoValorRescisao = opcoes.pensao_alimenticia_valor !== undefined
      ? opcoes.pensao_alimenticia_valor
      : (f.pensao_alimenticia && f.pensao_alimenticia.ativo ? f.pensao_alimenticia.valor : 0);

    const admissao = new Date(f.admissao + 'T00:00:00Z');
    const desligamento = new Date(dataDesligamento + 'T00:00:00Z');
    const mesesDeCasa = Math.max(0, Math.round((desligamento - admissao) / (1000 * 60 * 60 * 24 * 30)));
    /* Anos completos de casa por CALENDÁRIO, não por dias÷30
       arredondado — a mesma conta de idade em anos (ver idadeEm), só
       que entre admissão e desligamento. dias÷30 arredondado dava um
       "ano completo" a mais sempre que o tempo de casa passava de
       ~11,5 meses mas ainda não tinha completado o ano de verdade:
       admissão em 10/10/2025 e desligamento em 21/09/2026 são 346
       dias — ainda não é 1 ano — mas 346/30 = 11,53, que arredonda pra
       12, e 12/12 = 1 "ano completo" indevido, dando 3 dias a mais de
       aviso prévio do que a Lei 12.506/2011 realmente garante. */
    const anosCompletos = Math.max(0, idadeEm(f.admissao, dataDesligamento) || 0);

    /* Aviso prévio: 30 dias + 3 por ano completo de casa, até 90 (Lei
       12.506/2011) — antes era sempre 30. Quando é INDENIZADO (a
       empresa dispensa sem cumprir), o contrato conta como prorrogado
       por esse tanto de dias pra fins de 13º e férias proporcionais
       (Súmula 371 do TST) — por isso os avos usam `dataParaAvos`, não
       a data real de saída, só quando o aviso é indenizado. */
    const diasAviso = Math.min(90, 30 + 3 * anosCompletos);
    const avisoPrevio = (regra.fracaoAviso > 0 && opcoes.avisoIndenizado)
      ? Math.round(salarioMes / 30 * diasAviso * regra.fracaoAviso * 100) / 100 : 0;
    const descontoAvisoNaoCumprido = (tipoId === 'pedido_demissao' && opcoes.avisoCumprido === false)
      ? Math.round(salarioMes * 100) / 100 : 0;
    /* No acordo do art. 484-A o aviso é pago pela METADE, e é a
       projeção do que foi PAGO que integra o tempo de serviço
       (Súmula 371): projetar 42 dias pagando 21 dava um avo a mais de
       13º e de férias. */
    const diasAvisoEfetivos = Math.round(diasAviso * (regra.fracaoAviso || 1));
    const dataParaAvos = (regra.fracaoAviso > 0 && opcoes.avisoIndenizado)
      ? U.addDias(dataDesligamento, diasAvisoEfetivos) : dataDesligamento;

    // 13º usa ano civil (jan a dez do ano de dataParaAvos)
    /* Avos contam a partir de 1º/jan OU da admissão, o que vier depois
       (admitido em 01/08 e desligado em 20/09 = 2 avos, não 9). Se o
       aviso indenizado projeta a saída pro ano seguinte, somam-se os
       avos que faltavam no ano do desligamento com os do ano novo. */
    const anoDeslig = dataDesligamento.slice(0, 4);
    const inicioAno = f.admissao > anoDeslig + '-01-01' ? f.admissao : anoDeslig + '-01-01';
    let mesesAno = 0;
    if (regra.decimoProporcional) {
      if (dataParaAvos.slice(0, 4) === anoDeslig) {
        mesesAno = avos13(inicioAno, dataParaAvos);
      } else {
        mesesAno = avos13(inicioAno, anoDeslig + '-12-31') +
          avos13(dataParaAvos.slice(0, 4) + '-01-01', dataParaAvos);
      }
    }
    const decimoProporcional = Math.round(salarioMes / 12 * mesesAno * 100) / 100;
    /* 1ª parcela do 13º já paga no ano (rescisão em dezembro, depois de
       30/11): INSS/IRRF incidem sobre o 13º inteiro, mas o adiantamento
       é descontado do líquido — não se paga duas vezes. */
    const adiantamento13 = regra.decimoProporcional ? primeiraParcela13Paga(f, anoDeslig) : 0;

    /* Férias VENCIDAS (período aquisitivo já fechado, ainda não
       gozado) são devidas em qualquer motivo, até em justa causa — é
       tempo que já virou direito adquirido. Vencida fora do prazo pra
       gozar é paga em DOBRO (art. 137 CLT). Só as PROPORCIONAIS (do
       período em curso) somem na justa causa. */
    /* As vencidas seguem a MESMA data dos avos. Com aviso indenizado,
       o contrato conta como prorrogado (Súmula 371 do TST), e o
       período aquisitivo que se completa dentro da projeção vira
       direito adquirido. Antes o filtro usava a data real de saída e
       a sincronização dos períodos também, enquanto os avos já usavam
       a projetada: o período caía no vão entre as duas e não era pago
       por nenhuma — a projeção, que por lei só pode acrescentar,
       acabava subtraindo quase R$ 7 mil num caso de 5 anos de casa. */
    sincronizarPeriodosFerias(f, dataParaAvos);
    const feriasVencidas = (f.ferias || []).filter(function (p) {
      return (p.dias_gozados || 0) < p.dias_direito && p.aquisitivo_fim < dataParaAvos;
    });
    const valorFeriasVencidas = feriasVencidas.reduce(function (s, p) {
      const dias = p.dias_direito - (p.dias_gozados || 0);
      const dobro = dataParaAvos > p.limite ? 2 : 1;
      return s + salarioMes / 30 * dias * dobro;
    }, 0);
    const inicioPeriodoFerias = inicioPeriodoAquisitivoAtual(f, dataParaAvos);
    const mesesPeriodoFerias = regra.feriasProporcionais ? avosEntre(inicioPeriodoFerias, dataParaAvos) : 0;
    const feriasProporcionais = Math.round(salarioMes / 12 * mesesPeriodoFerias * 100) / 100;
    const totalFerias = Math.round((valorFeriasVencidas + feriasProporcionais) * 100) / 100;
    const tercoFerias = Math.round(totalFerias * dp.terco_constitucional_ferias * 100) / 100;

    // estimativa de multa de FGTS: 40% sobre o FGTS acumulado do contrato inteiro (ver fgtsAcumuladoDesdeAdmissao)
    const fgtsGerado = fgtsAcumuladoDesdeAdmissao(f, dataDesligamento);
    /* Rescisão ANTECIPADA de contrato de experiência (art. 479 CLT):
       quando a empresa encerra antes do prazo combinado, deve metade
       da remuneração que faltava até o fim do prazo — indenização à
       parte, não é aviso prévio. Só se aplica com "Término de
       contrato de experiência" escolhido E uma data de fim prevista
       informada que ainda não tinha chegado; sem os dois, fica em
       zero (o término NO PRAZO combinado não deve isso). Detectado
       ANTES da multa de FGTS porque a antecipação também MUDA a
       multa: ver comentário logo abaixo. */
    let multaAntecipada = 0, diasRestantesContrato = 0;
    const ehRescisaoAntecipada = tipoId === 'termino_experiencia' && opcoes.dataFimPrevista &&
      dataDesligamento < opcoes.dataFimPrevista;
    if (ehRescisaoAntecipada) {
      diasRestantesContrato = U.diasEntre(dataDesligamento, opcoes.dataFimPrevista);
      multaAntecipada = Math.round(salarioMes / 30 * diasRestantesContrato * 0.5 * 100) / 100;
    }

    /* A multa É parte do pagamento da rescisão — por isso pode ser
       digitada por cima da estimativa, e por isso já vem calculada
       (não zerada) mesmo antes de decidir desligar: dá pra rodar essa
       conta com qualquer funcionário ativo, numa data hipotética, só
       pra ver o total — nada aqui desliga ninguém; só "Confirmar
       rescisão" faz isso. A estimativa cobre o contrato inteiro desde
       a admissão (não só o que este sistema gerou), mas ainda é
       estimativa: some com tempo de casa anterior à admissão registrada
       aqui, com faltas ao trabalho não descontadas do FGTS mensal, ou
       com qualquer diferença entre o salário histórico cadastrado e o
       que a Caixa tem de verdade — o extrato de FGTS é a fonte final.
       Em pedido de demissão ou justa causa não há multa — a regra do
       motivo manda, e um valor digitado por engano não entra.

       Término de experiência NO PRAZO (sem antecipação) também não
       deve multa — mas encerrar ANTES do prazo combinado é dispensa
       sem justa causa na prática (art. 479 CLT + Decreto 99.684, art.
       14): além da indenização de metade dos dias restantes, a multa
       de 40% do FGTS também é devida sobre o que foi depositado.
       Confirme com o contador — é uma interpretação um pouco menos
       pacífica que o resto da rescisão. */
    const fracaoMultaEfetiva = ehRescisaoAntecipada ? 1 : regra.fracaoMulta;
    // base da multa inclui o FGTS que a própria rescisão deposita (saldo, 13º e aviso)
    const fgtsDaRescisaoParaMulta = Math.round((saldoSalario + decimoProporcional + avisoPrevio) * dp.aliquota_fgts / 100 * 100) / 100;
    const multaFGTSEstimada = Math.round((fgtsGerado + fgtsDaRescisaoParaMulta) * dp.aliquota_multa_fgts_rescisao * fracaoMultaEfetiva / 100 * 100) / 100;
    const multaFGTS = !(fracaoMultaEfetiva > 0) ? 0
      : (opcoes.multaFGTSManual !== undefined && opcoes.multaFGTSManual !== null)
        ? Math.round(opcoes.multaFGTSManual * 100) / 100
        : multaFGTSEstimada;

    /* Saldo de salário e 13º são tributados SEPARADOS — o 13º tem
       tributação exclusiva na fonte, com a mesma tabela mas aplicada
       só sobre ele, não somado ao saldo antes de calcular (isso jogava
       o conjunto pra uma faixa mais alta do que cada um pagaria
       sozinho). Férias (vencidas + proporcionais + 1/3), aviso e multa
       de FGTS são verba indenizatória — isentas de INSS e IRRF. */
    /* INSS por COMPETÊNCIA também na rescisão: férias e folha ficaram
       incrementais no P2, a rescisão não — e ela recalculava do zero
       sobre o saldo isolado, retendo a mais do funcionário. */
    const inssJaNoMes = (function () {
      const comp = U.compDe(dataDesligamento);
      let base = 0, retido = 0;
      st.folhas.forEach(function (fl) {
        if (fl.competencia !== comp || fl.cancelada) return;
        const h = (fl.holerites || []).find(function (x) { return x.funcionario === f.id; });
        if (h) { base += (h.base_inss || 0); retido += (h.valor_inss || 0); }
      });
      (f.ferias || []).forEach(function (per) {
        (per.gozos || []).forEach(function (g) {
          if (g.cancelado || g.__temporario) return;
          if (U.compDe(g.data_inicio) !== comp) return;
          base += (g.base_inss || 0); retido += (g.inss || 0);
        });
      });
      return { base: Math.round(base * 100) / 100, retido: Math.round(retido * 100) / 100 };
    })();
    const valorINSSSaldo = inssJaNoMes.base > 0.004
      ? Math.max(0, Math.round((calcularINSS(
          Math.round((inssJaNoMes.base + saldoSalario) * 100) / 100) - inssJaNoMes.retido) * 100) / 100)
      : calcularINSS(saldoSalario);
    const valorIRRFSaldo = calcularIRRF(saldoSalario, valorINSSSaldo, f.dependentes_irrf, Math.max(0, pensaoValorRescisao || 0));
    const valorINSSDecimo = calcularINSS(decimoProporcional);
    /* Pensão sobre o 13º (se a sentença manda — opção "incide sobre o
       13º" no cadastro): proporcional aos avos, e abate do IRRF do 13º. */
    const pensaoCad = f.pensao_alimenticia && f.pensao_alimenticia.ativo ? f.pensao_alimenticia : null;
    const pensaoDecimo = (pensaoCad && pensaoCad.incide_13 !== false && decimoProporcional > 0 && opcoes.pensao_alimenticia_valor === undefined)
      ? Math.round(pensaoCad.valor * mesesAno / 12 * 100) / 100 : 0;
    const valorIRRFDecimo = calcularIRRF(decimoProporcional, valorINSSDecimo, f.dependentes_irrf, pensaoDecimo);
    const valorINSS = Math.round((valorINSSSaldo + valorINSSDecimo) * 100) / 100;
    const valorIRRF = Math.round((valorIRRFSaldo + valorIRRFDecimo) * 100) / 100;

    /* FGTS de 8% continua incidindo sobre o que a rescisão paga de
       remuneração (saldo de salário, 13º proporcional e aviso prévio
       indenizado — Súmula 305 do TST inclui o aviso indenizado na base
       do FGTS) — isso é DEPÓSITO na conta vinculada, não dinheiro que
       passa pela mão do funcionário, então não entra no bruto pago a
       ele. A multa de 40% (`multaFGTS`) é a mesma história: também não
       é paga a ele — vira depósito/guia à parte. Sem essa separação,
       o líquido pago incluía a multa de 40% E a guia gerada em
       `lancarRescisao` pagava a mesma multa de novo. */
    const fgtsRescisao = Math.round((saldoSalario + decimoProporcional + avisoPrevio) *
      dp.aliquota_fgts / 100 * 100) / 100;

    const totalBruto = Math.round((saldoSalario + decimoProporcional + totalFerias + tercoFerias +
      avisoPrevio + multaAntecipada + salarioFamiliaRescisao - descontoAvisoNaoCumprido) * 100) / 100;
    /* Crédito do trabalhador (ou outro empréstimo com débito em folha)
       continua descontando na rescisão — é dívida do funcionário, não
       desaparece por ele estar saindo. Editável via
       opcoes.credito_trabalhador_valor pro saldo residual do contrato,
       que costuma ser diferente da parcela mensal normal. VT, VR e
       pensão alimentícia do mês seguem a mesma lógica: descontam do
       líquido, não são encargo a mais nem verba isenta. */
    const creditoTrabalhadorValor = opcoes.credito_trabalhador_valor !== undefined
      ? opcoes.credito_trabalhador_valor
      : (f.credito_trabalhador && f.credito_trabalhador.ativo ? f.credito_trabalhador.valor_parcela : 0);
    const descontoCreditoTrabalhador = Math.round(Math.max(0, creditoTrabalhadorValor || 0) * 100) / 100;
    const totalLiquido = Math.round((totalBruto - valorINSS - valorIRRF - descontoCreditoTrabalhador - adiantamento13 -
      vtDescontoRescisao - vrDescontoRescisao - Math.max(0, pensaoValorRescisao || 0) - pensaoDecimo) * 100) / 100;

    return {
      funcionario: f.id, data_desligamento: dataDesligamento, meses_de_casa: mesesDeCasa,
      tipo: tipoId, tipo_nome: regra.nome,
      saldo_salario: saldoSalario, insalubridade_periculosidade: Math.round(valorAdicionalHabitual * 100) / 100,
      gratificacao_valor: gratificacaoValor,
      he50_valor: he50Valor, he100_valor: he100Valor, adicional_noturno_valor: noturnoValor, dsr_valor: dsrRescisao,
      vt_desconto: vtDescontoRescisao, vr_desconto: vrDescontoRescisao,
      salario_familia: salarioFamiliaRescisao, pensao_alimenticia: Math.round((Math.max(0, pensaoValorRescisao || 0) + pensaoDecimo) * 100) / 100,
      pensao_13: pensaoDecimo,
      aviso_experiencia: (tipoId !== 'termino_experiencia' && U.diasEntre(f.admissao, dataDesligamento) < 90)
        ? 'Desligamento nos primeiros 90 dias: se for contrato de experiência encerrado antes do prazo, escolha ' +
          '"Término de contrato de experiência" e informe a data de fim prevista — é lá que entra a indenização do art. 479.'
        : null,
      decimo_proporcional: decimoProporcional, avos_13: mesesAno, adiantamento_13: adiantamento13,
      dias_saldo: Math.min(30, dia), dias_ferias_no_saldo: diasFeriasNoSaldo,
      ferias_vencidas: Math.round(valorFeriasVencidas * 100) / 100, ferias_proporcionais: feriasProporcionais,
      avos_ferias: mesesPeriodoFerias, terco_ferias: tercoFerias,
      /* Dias EFETIVOS: o termo informava 42 num acordo que pagou 21. */
      dias_aviso: (regra.fracaoAviso > 0 && opcoes.avisoIndenizado) ? diasAvisoEfetivos : 0,
      dias_aviso_integral: diasAviso, aviso_previo: avisoPrevio,
      desconto_aviso_nao_cumprido: descontoAvisoNaoCumprido,
      multa_fgts: multaFGTS, multa_fgts_estimada: multaFGTSEstimada, multa_fgts_aplicavel: fracaoMultaEfetiva > 0,
      fgts_rescisao: fgtsRescisao,
      /* Encargo da empresa sobre a rescisão: INSS patronal + RAT×FAP +
         terceiros, sobre o que tem natureza salarial (saldo e 13º). Aviso
         prévio indenizado e férias indenizadas + 1/3 não entram. */
      base_patronal_rescisao: Math.round((saldoSalario + decimoProporcional) * 100) / 100,
      inss_patronal_rescisao: Math.round((saldoSalario + decimoProporcional) * dp.aliquota_inss_patronal / 100 * 100) / 100,
      outros_encargos_rescisao: Math.round((saldoSalario + decimoProporcional) * (dp.aliquota_rat_fap + dp.aliquota_terceiros) / 100 * 100) / 100,
      multa_antecipada_experiencia: multaAntecipada, dias_restantes_contrato: diasRestantesContrato,
      fgts_gerado_estimado: Math.round(fgtsGerado * 100) / 100,
      desconto_credito_trabalhador: descontoCreditoTrabalhador,
      /* INSS e IRRF do saldo (a parte "de folha" da rescisão) e do 13º
         proporcional são tributados SEPARADOS (tributação exclusiva do
         13º) — aqui vão os dois jeitos, o total combinado (usado no
         líquido) e cada um à parte, pra tela mostrar sem juntar. */
      valor_inss: valorINSS, valor_irrf: valorIRRF,
      valor_inss_saldo: valorINSSSaldo, valor_irrf_saldo: valorIRRFSaldo,
      valor_inss_decimo: valorINSSDecimo, valor_irrf_decimo: valorIRRFDecimo,
      total_bruto: totalBruto, total_liquido: totalLiquido
    };
  }

  function lancarRescisao(funcionarioId, calc) {
    if (!pode('dp')) return { erro: 'Seu perfil não lança rescisão.' };
    const f = D.funcionario(funcionarioId);
    if (!f) return { erro: 'Funcionário não encontrado.' };
    /* Checa TUDO que pode dar errado antes de criar qualquer título —
       criar primeiro e desligar depois deixava um título órfão em
       Contas a Pagar quando o desligamento falhava (funcionário já
       desligado, por exemplo). */
    const jaTemRescisaoLancada = temRescisaoLancada(f);
    if (jaTemRescisaoLancada) {
      return { erro: 'Este funcionário já tem uma rescisão lançada. Cancele a existente antes de lançar outra.' };
    }
    /* Um funcionário já desligado pelo botão "Desligar" (sem calcular
       verbas) ainda pode ter a rescisão lançada aqui — sem isso, quem
       usasse aquele botão ficava sem jeito nenhum de pagar o que devia
       (a rescisão recusava com "já está desligado", travando de vez). */
    if (f.pagamento_aprovado === false) {
      return { erro: 'Dados de pagamento deste funcionário ainda não foram aprovados por quem tem alçada — ' +
        'peça pra diretoria ou sócio aprovar em Funcionários antes de lançar a rescisão.' };
    }
    if (calc.data_desligamento < f.admissao) {
      return { erro: 'Data de desligamento é anterior à admissão.' };
    }
    if (st.folhas.some(function (fl) { return fl.competencia === U.compDe(calc.data_desligamento) && !fl.cancelada; })) {
      return { erro: 'A folha de ' + U.fComp(U.compDe(calc.data_desligamento)) + ' já foi fechada — o saldo ' +
        'de salário deste mês já saiu por lá. Cancele a folha antes de lançar a rescisão.' };
    }
    const feriasFuturas = (f.ferias || []).some(function (p) {
      return (p.gozos || []).some(function (g) { return !g.cancelado && g.data_inicio > calc.data_desligamento; });
    });
    if (feriasFuturas) {
      return { erro: 'Existem férias lançadas com início depois desta data de desligamento — revise antes de confirmar.' };
    }
    /* Pensão alimentícia descontada na rescisão vira título à parte
       pro beneficiário, mesma lógica da folha mensal — sem isso o
       valor descontado desaparecia da conta, ninguém recebia.
       Checado ANTES de criar qualquer título (mesmo motivo do resto
       desta função): falhar depois de já ter criado o título
       principal deixaria ele órfão. */
    if (calc.pensao_alimenticia > 0.004) {
      const pensaoCadastroCheck = f.pensao_alimenticia && f.pensao_alimenticia.ativo ? f.pensao_alimenticia : null;
      if (!pensaoCadastroCheck || !pensaoCadastroCheck.beneficiario_nome) {
        return { erro: 'Pensão alimentícia sem beneficiário cadastrado — abra o funcionário em Editar e ' +
          'cadastre o beneficiário antes de lançar a rescisão.' };
      }
    }
    const credorGuia = credorGuiaDe('federal');
    const comp = U.compDe(calc.data_desligamento);
    const r = criarTitulo({
      _interno: true, descricao: 'Rescisão — ' + f.nome + ' (' + calc.tipo_nome + ')',
      documento: 'RESCISAO-' + f.matricula,
      tipo_titulo: 'rescisao', credor: f.credor_id, conta: '4.07',
      centro: (f.rateio || [])[0] ? f.rateio[0].centro : f.centro, rateio: f.rateio,
      emissao: calc.data_desligamento, origem: 'rescisao', origem_ref: 'rescisao-' + f.id,
      obs: 'Bruto ' + U.brl(calc.total_bruto) + ' · INSS ' + U.brl(calc.valor_inss) + ' · IRRF ' + U.brl(calc.valor_irrf)
    }, [{ num: 1, venc: diaUtilAnterior(U.addDias(calc.data_desligamento, 10)), comp: comp, valor: calc.total_liquido }]);
    if (!r.ok) return r;
    st.parcelas.filter(function (pc) { return pc.titulo_id === r.titulo.id; })
      .forEach(function (pc) { pc.status = 'previsto'; });

    const tituloIds = [r.titulo.id];
    /* INSS e IRRF retidos não são um encargo a mais — são a parte do
       bruto que não vai pro bolso do funcionário, vai pro governo.
       Mesma conta do título principal (4.07, rescisões), não 4.04
       (isso é só INSS PATRONAL) — a mesma correção já feita na folha
       mensal, aplicada aqui também. */
    if (calc.valor_inss + calc.valor_irrf > 0.004) {
      const rg = criarTitulo({
        _interno: true, descricao: 'INSS + IRRF retidos da rescisão — ' + f.nome, documento: 'GPS-DARF-RESC-' + f.matricula,
        tipo_titulo: 'guia', credor: credorGuia, conta: '4.07',
        centro: (f.rateio || [])[0] ? f.rateio[0].centro : f.centro, rateio: f.rateio,
        emissao: calc.data_desligamento, origem: 'rescisao', origem_ref: 'rescisao-guia-' + f.id,
        obs: 'INSS ' + U.brl(calc.valor_inss) + ' + IRRF ' + U.brl(calc.valor_irrf) + ' retidos da rescisão de ' + f.nome
      }, [{ num: 1, venc: dia20MesSeguinte(calc.data_desligamento), comp: comp, valor: Math.round((calc.valor_inss + calc.valor_irrf) * 100) / 100 }]);
      if (rg.ok) {
        tituloIds.push(rg.titulo.id);
        st.parcelas.filter(function (pc) { return pc.titulo_id === rg.titulo.id; }).forEach(function (pc) { pc.status = 'previsto'; });
      }
    }
    /* FGTS da rescisão — o depósito de 8% sobre o que ela paga de
       remuneração (saldo, 13º, aviso indenizado) MAIS a multa de 40%,
       quando aplicável. Os dois são depósito na conta vinculada, nunca
       dinheiro que passa pela mão do funcionário — por isso não entram
       no líquido pago a ele (título principal, acima). Antes só a
       multa tinha guia; o depósito de 8% nem existia, e a multa
       aparecia tanto aqui quanto dentro do líquido pago — dobrava a
       conta. */
    const totalFGTSRescisao = Math.round(((calc.fgts_rescisao || 0) + (calc.multa_fgts || 0)) * 100) / 100;
    if (totalFGTSRescisao > 0.004) {
      const rf = criarTitulo({
        _interno: true, descricao: 'FGTS da rescisão — ' + f.nome, documento: 'FGTS-RESC-' + f.matricula,
        tipo_titulo: 'guia', credor: credorGuiaDe('fgts'), conta: '4.03',
        centro: (f.rateio || [])[0] ? f.rateio[0].centro : f.centro, rateio: f.rateio,
        emissao: calc.data_desligamento, origem: 'rescisao', origem_ref: 'rescisao-fgts-' + f.id,
        obs: 'Depósito de 8% sobre saldo/13º/aviso (' + U.brl(calc.fgts_rescisao || 0) + ') + multa de 40% (' +
          U.brl(calc.multa_fgts || 0) + ') — os dois vão pra conta vinculada do funcionário, não pra ele diretamente.'
      }, [{ num: 1, venc: diaUtilAnterior(U.addDias(calc.data_desligamento, 10)), comp: comp, valor: totalFGTSRescisao }]);
      if (rf.ok) {
        tituloIds.push(rf.titulo.id);
        st.parcelas.filter(function (pc) { return pc.titulo_id === rf.titulo.id; }).forEach(function (pc) { pc.status = 'previsto'; });
      }
    }
    /* INSS patronal + RAT×FAP + terceiros sobre saldo e 13º — faltava
       na rescisão (só existiam líquido, INSS+IRRF retidos e FGTS). Vence
       no dia 20 do mês seguinte, junto com a DCTFWeb da competência. */
    const patronalResc = Math.round(((calc.inss_patronal_rescisao || 0) + (calc.outros_encargos_rescisao || 0)) * 100) / 100;
    if (patronalResc > 0.004) {
      const rpat = criarTitulo({
        _interno: true, descricao: 'INSS patronal + RAT×FAP + terceiros da rescisão — ' + f.nome,
        documento: 'GPS-PATRONAL-RESC-' + f.matricula,
        tipo_titulo: 'guia', credor: credorGuiaDe('federal'), conta: '4.04',
        centro: (f.rateio || [])[0] ? f.rateio[0].centro : f.centro, rateio: f.rateio,
        emissao: calc.data_desligamento, origem: 'rescisao', origem_ref: 'rescisao-patronal-' + f.id,
        obs: 'INSS patronal ' + U.brl(calc.inss_patronal_rescisao) + ' + RAT×FAP/terceiros ' + U.brl(calc.outros_encargos_rescisao) +
          ' sobre saldo + 13º (' + U.brl(calc.base_patronal_rescisao) + ') — encargo da empresa.'
      }, [{ num: 1, venc: dia20MesSeguinte(calc.data_desligamento), comp: comp, valor: patronalResc }]);
      if (rpat.ok) {
        tituloIds.push(rpat.titulo.id);
        st.parcelas.filter(function (pc) { return pc.titulo_id === rpat.titulo.id; }).forEach(function (pc) { pc.status = 'previsto'; });
      }
    }
    /* Pensão alimentícia descontada na rescisão vira título à parte
       pro beneficiário, mesma lógica da folha mensal — sem isso o
       valor descontado desaparecia da conta, ninguém recebia.
       (Beneficiário já foi conferido lá em cima, antes de criar
       qualquer título.) */
    if (calc.pensao_alimenticia > 0.004) {
      const pensaoCadastro = f.pensao_alimenticia;
      const credorPensao = credorPensionista(f);
      const rp = criarTitulo({
        _interno: true, descricao: 'Pensão alimentícia — ' + pensaoCadastro.beneficiario_nome +
          ' (desconto da rescisão de ' + f.nome + ')',
        documento: 'PENSAO-RESC-' + f.matricula,
        tipo_titulo: 'pensao', credor: credorPensao, conta: '4.07',
        centro: (f.rateio || [])[0] ? f.rateio[0].centro : f.centro, rateio: f.rateio,
        emissao: calc.data_desligamento, origem: 'rescisao', origem_ref: 'rescisao-pensao-' + f.id,
        obs: 'Descontado da rescisão de ' + f.nome + '.'
      }, [{ num: 1, venc: diaUtilAnterior(U.addDias(calc.data_desligamento, 10)), comp: comp, valor: calc.pensao_alimenticia }]);
      if (rp.ok) {
        tituloIds.push(rp.titulo.id);
        st.parcelas.filter(function (pc) { return pc.titulo_id === rp.titulo.id; }).forEach(function (pc) { pc.status = 'previsto'; });
      }
    }
    /* Crédito do trabalhador descontado na rescisão também vira título
       pra instituição — mesma lógica da folha mensal. */
    if (calc.desconto_credito_trabalhador > 0.004) {
      const creditoCadastro = f.credito_trabalhador && f.credito_trabalhador.ativo ? f.credito_trabalhador : {};
      const credorCredito = credorInstituicaoCredito(f);
      const rc = criarTitulo({
        _interno: true, descricao: 'Crédito do trabalhador — ' + (creditoCadastro.instituicao || '') +
          ' (desconto da rescisão de ' + f.nome + ')',
        documento: 'CREDITO-RESC-' + f.matricula,
        tipo_titulo: 'credito_trabalhador', credor: credorCredito, conta: '4.07',
        centro: (f.rateio || [])[0] ? f.rateio[0].centro : f.centro, rateio: f.rateio,
        emissao: calc.data_desligamento, origem: 'rescisao', origem_ref: 'rescisao-credito-' + f.id,
        obs: 'Descontado da rescisão de ' + f.nome + '.'
      }, [{ num: 1, venc: diaUtilAnterior(U.addDias(calc.data_desligamento, 10)), comp: comp, valor: calc.desconto_credito_trabalhador }]);
      if (rc.ok) {
        tituloIds.push(rc.titulo.id);
        st.parcelas.filter(function (pc) { return pc.titulo_id === rc.titulo.id; }).forEach(function (pc) { pc.status = 'previsto'; });
      }
    }

    /* Se já estava desligado (pelo botão "Desligar" direto, sem
       calcular verbas), não tenta desligar de novo — só atualiza data
       e motivo pra bater com o que a rescisão calculou, já que aquele
       desligamento inicial pode ter usado outra data/motivo. Só chama
       desligarFuncionario de verdade quando ainda está ativo. */
    if (f.ativo) {
      const rd = desligarFuncionario(funcionarioId, { data: calc.data_desligamento, motivo: calc.tipo_nome });
      if (rd.erro) return rd;
    } else {
      f.desligado_em = calc.data_desligamento;
      f.motivo_desligamento = calc.tipo_nome;
    }
    logar('funcionario', f.id, 'lançou rescisão', calc.tipo_nome + ' · líquido ' + U.brl(calc.total_liquido));
    return { ok: true, titulo: r.titulo, titulo_ids: tituloIds };
  }

  /* Cancelar uma rescisão já lançada — sem isso, uma rescisão calculada
     com data ou verba errada não tinha volta nenhuma: o funcionário
     ficava desligado pra sempre com um valor errado nas contas a
     pagar, e não dava nem pra corrigir nem pra readmitir de verdade
     (o CPF continuava "ocupado" por um desligamento que devia ter
     sido desfeito). Cancela todos os títulos que a rescisão gerou
     (líquido, guias de INSS/IRRF/FGTS, pensão, crédito do trabalhador)
     e reativa o funcionário — reativar é a interpretação mais segura:
     cancelar uma rescisão significa "isso não devia ter acontecido
     assim", e deixar a pessoa travada como desligada sem rescisão
     nenhuma associada seria um estado sem saída fácil. */
  function cancelarRescisao(funcionarioId, motivo, forcar) {
    if (!pode('dp')) return { erro: 'Seu perfil não cancela rescisão.' };
    const f = D.funcionario(funcionarioId);
    if (!f) return { erro: 'Funcionário não encontrado.' };
    if (!motivo) return { erro: 'Informe o motivo do cancelamento.' };
    const prefixos = ['rescisao-' + f.id, 'rescisao-guia-' + f.id, 'rescisao-fgts-' + f.id, 'rescisao-patronal-' + f.id,
      'rescisao-pensao-' + f.id, 'rescisao-credito-' + f.id];
    const titulosRescisao = st.titulos.filter(function (t) {
      return t.origem === 'rescisao' && prefixos.indexOf(t.origem_ref) > -1;
    });
    if (!titulosRescisao.length) return { erro: 'Não encontrei rescisão lançada pra este funcionário.' };
    const parcelasRescisao = st.parcelas.filter(function (p) {
      return titulosRescisao.some(function (t) { return t.id === p.titulo_id; });
    });
    const jaPagas = parcelasRescisao.filter(function (p) { return pagamentosDe(p.id).length > 0; });
    if (jaPagas.length && !forcar) {
      return { erro: 'Uma ou mais parcelas desta rescisão já tiveram saída do banco. Force o cancelamento ' +
        'se precisar mesmo assim, ou estorne o(s) pagamento(s) antes.', jaPagas: jaPagas.length };
    }
    let n = 0;
    parcelasRescisao.forEach(function (p) {
      if (p.status === 'cancelado') { n++; return; }
      const r = cancelar(p.id, motivo, true);
      if (r.ok) n++;
    });
    const canceladoCompleto = n === parcelasRescisao.length;
    if (canceladoCompleto) {
      f.ativo = true;
      f.desligado_em = null;
      f.motivo_desligamento = null;
      const cr = D.credor(f.credor_id);
      if (cr) cr.ativo = true;
    }
    logar('funcionario', f.id, canceladoCompleto ? 'cancelou rescisão' : 'cancelou rescisão parcialmente (havia pagamento já registrado)',
      motivo);
    return { ok: true, cancelado_completo: canceladoCompleto, aviso: canceladoCompleto ? avisoForaDeFolhaFechada(f) : null };
  }

  /* Férias vencendo em 60/30 dias — mesmo padrão do alerta de reajuste
     de contrato: avisa antes, muda de tom depois de vencido. */
  function alertasDP() {
    const hoje = U.hoje();
    const lista = [];
    D.funcionarios.filter(function (f) { return f.ativo; }).forEach(function (f) {
      sincronizarPeriodosFerias(f, hoje);
      (f.ferias || []).forEach(function (per) {
        if (per.dias_gozados >= per.dias_direito) return;
        const dias = U.diasEntre(hoje, per.limite);
        if (dias < 0) {
          lista.push({ funcionario: f, periodo: per, tipo: 'ferias_vencidas', dias: dias, nivel: 'erro',
            texto: f.nome + ': férias venceram há ' + Math.abs(dias) + ' dias e ainda não foram gozadas' });
        } else if (dias <= 60) {
          lista.push({ funcionario: f, periodo: per, tipo: 'ferias_vencendo', dias: dias,
            nivel: dias <= 30 ? 'erro' : 'alerta',
            texto: f.nome + ': férias vencem em ' + dias + ' dias (' + U.fData(per.limite) + ')' });
        }
      });
    });
    return lista.sort(function (a, b) { return a.dias - b.dias; });
  }

  /* Visão completa de férias por funcionário — não só quem está perto
     do limite (isso é `alertasDP`, pra alerta pontual), mas TODOS os
     ativos, pra dar pra olhar a situação de qualquer um numa tabela
     só. Quando há mais de um período pendente (raro, mas o cadastro
     permite), usa o de limite mais próximo — é o que importa primeiro. */
  function situacaoFerias() {
    const hoje = U.hoje();
    return D.funcionarios.filter(function (f) { return f.ativo; }).map(function (f) {
      sincronizarPeriodosFerias(f, hoje);
      const pendentes = (f.ferias || []).filter(function (p) { return p.dias_gozados < p.dias_direito; })
        .sort(function (a, b) { return a.limite.localeCompare(b.limite); });
      const per = pendentes[0] || null;
      if (!per) {
        return { funcionario: f, periodo: null, dias_restantes: 0, dias_ate_limite: null, situacao: 'sem_pendencia' };
      }
      const diasRestantes = per.dias_direito - (per.dias_gozados || 0);
      const diasAteLimite = U.diasEntre(hoje, per.limite);
      const situacao = diasAteLimite < 0 ? 'vencida' : diasAteLimite <= 30 ? 'urgente' : diasAteLimite <= 60 ? 'atencao' : 'em_dia';
      return { funcionario: f, periodo: per, dias_restantes: diasRestantes, dias_ate_limite: diasAteLimite, situacao: situacao };
    }).sort(function (a, b) {
      const ordem = { vencida: 0, urgente: 1, atencao: 2, em_dia: 3, sem_pendencia: 4 };
      return ordem[a.situacao] - ordem[b.situacao] ||
        (a.dias_ate_limite === null ? 999 : a.dias_ate_limite) - (b.dias_ate_limite === null ? 999 : b.dias_ate_limite);
    });
  }

  /* Cancelar um lote é tudo-ou-nada por padrão: se alguma parcela já
     saiu do banco, a função recusa em bloco em vez de cancelar metade
     e deixar a outra pendurada. `forcar` existe só pra quando esse
     silêncio não serve — o caso raro de já ter pago alguém do lote
     errado — e mesmo assim cancela só o que ainda é seguro cancelar,
     deixando as pagas de fora pra alguém tratar na mão. Não é pra virar
     rotina: por isso a UI pede confirmação extra quando usa. */
  /* A autorização precisa ser escrita, não um "ok": é o que a
     auditoria vai ler daqui a seis meses. */
  const d_autorizacao = m => String(m || '').trim().length >= 15;

  /* Substituir o fechamento do mês: o arquivo novo passa a ser a
     verdade daquela competência naquele projeto. É o caso comum —
     médico que saiu da lista, valor corrigido para mais ou para menos —
     e antes só havia "complemento" (soma) ou "pular repetidos" (ignora
     a correção). Os lançamentos anteriores são CANCELADOS, não
     apagados: ficam no histórico com o motivo. */
  function fechamentosVivosDe(centro, competencia) {
    return st.lotesProdutividade.filter(function (l) {
      return l.centro === centro && l.competencia === competencia && !l.cancelado;
    });
  }

  /* O que muda entre o fechamento lançado e o arquivo novo: quem saiu,
     quem entrou, quem mudou de valor — e, dentro disso, quem JÁ
     RECEBEU. É o que a gestão precisa ver antes de substituir. */
  function compararFechamento(centro, competencia, novos) {
    const lotes = fechamentosVivosDe(centro, competencia);
    const atuais = {};
    lotes.forEach(function (l) {
      (l.titulo_ids || []).forEach(function (tid) {
        const t = st.titulos.find(function (x) { return x.id === tid; });
        if (!t || !tituloNaoCancelado(t)) return;
        const nome = (D.credor(t.credor) || {}).nome || '';
        const pago = st.parcelas.filter(function (p) { return p.titulo_id === t.id; })
          .reduce(function (x, p) { return x + pagoDe(p.id); }, 0);
        const k = nome.toLowerCase().trim();
        atuais[k] = atuais[k] || { medico: nome, valor: 0, pago: 0, titulos: [] };
        atuais[k].valor += t.valor_total || 0;
        atuais[k].pago += pago;
        atuais[k].titulos.push(t.id);
      });
    });
    const novosPorNome = {};
    (novos || []).forEach(function (n) {
      const k = String(n.medico || '').toLowerCase().trim();
      novosPorNome[k] = novosPorNome[k] || { medico: n.medico, valor: 0 };
      novosPorNome[k].valor += n.valor || 0;
    });
    const saiu = [], reduziu = [], aumentou = [], entrou = [], iguais = [];
    Object.keys(atuais).forEach(function (k) {
      const a = atuais[k], n = novosPorNome[k];
      if (!n) return saiu.push(a);
      const dif = Math.round((n.valor - a.valor) * 100) / 100;
      if (Math.abs(dif) < 0.005) iguais.push(a);
      else if (dif < 0) reduziu.push(Object.assign({}, a, { novo: n.valor, diferenca: dif }));
      else aumentou.push(Object.assign({}, a, { novo: n.valor, diferenca: dif }));
    });
    Object.keys(novosPorNome).forEach(function (k) {
      if (!atuais[k]) entrou.push(novosPorNome[k]);
    });
    /* O caso que exige alerta forte: médico que já recebeu e agora saiu
       da lista ou teve o valor reduzido — o dinheiro já saiu. */
    const pagosAfetados = saiu.filter(function (m) { return m.pago > 0.004; })
      .map(function (m) { return Object.assign({}, m, { tipo: 'saiu' }); })
      .concat(reduziu.filter(function (m) { return m.pago > 0.004; })
        .map(function (m) { return Object.assign({}, m, { tipo: 'reduziu' }); }));
    return {
      lotes: lotes.length, saiu: saiu, entrou: entrou, reduziu: reduziu, aumentou: aumentou,
      iguais: iguais,
      tem_pagamento: Object.keys(atuais).some(function (k) { return atuais[k].pago > 0.004; }),
      pagos_afetados: pagosAfetados,
      medicos_pagos: Object.keys(atuais).filter(function (k) { return atuais[k].pago > 0.004; })
        .map(function (k) { return atuais[k].medico; })
    };
  }

  function substituirFechamento(centro, competencia, motivo, forcar) {
    /* Quem lança produtividade substitui o próprio fechamento enquanto
       ninguém recebeu — é correção de lançamento, não cancelamento de
       pagamento. Com pagamento feito, a coisa muda de natureza e cai na
       regra do cancelamento (diretoria, sócio ou admin). */
    if (!pode('lancar') && !pode('cancelar')) {
      return { erro: 'Seu perfil não lança nem cancela produtividade.' };
    }
    if (!motivo) return { erro: 'Informe o motivo da substituição.' };
    const lotes = fechamentosVivosDe(centro, competencia);
    if (!lotes.length) return { erro: 'Não há fechamento lançado nesta competência para este projeto.' };

    /* Pagamento já feito muda a natureza da coisa: vira correção de
       valor pago, médico a médico, e isso é decisão de quem pode
       cancelar. */
    const comPagamento = lotes.filter(function (l) {
      return st.parcelas.some(function (p) {
        return l.titulo_ids.indexOf(p.titulo_id) > -1 && pagamentosDe(p.id).length > 0;
      });
    });
    if (comPagamento.length && !forcar) {
      return { erro: 'Há fechamento desta competência com pagamento já feito. Substituir agora deixa os ' +
        'valores pagos para correção manual — precisa de autorização de quem cancela lançamento.',
        exigeAutorizacao: true, lotes: lotes.length };
    }

    const resultado = { cancelados: 0, parcelas: 0, erros: [] };
    lotes.forEach(function (l) {
      const r = cancelarLoteProdutividade(l.id, 'Substituído por novo fechamento: ' + motivo,
        !!forcar, { por_substituicao: true });
      if (r.erro) resultado.erros.push(l.id + ': ' + r.erro);
      /* Cancelamento PARCIAL não conta como cancelado: o fechamento
         antigo continua de pé em parte, e dizer "1 cancelado" fazia o
         operador acreditar que a substituição estava completa. */
      else if (r.parcial) {
        resultado.erros.push('Fechamento ' + l.id + ': só parte das parcelas foi cancelada (' +
          (r.puladas || 0) + ' seguem abertas). Cancele-as antes de substituir.');
      } else { resultado.cancelados++; resultado.parcelas += (r.canceladas || r.n || 0); }
    });
    if (resultado.erros.length && !resultado.cancelados) return { erro: resultado.erros[0] };
    logar('produtividade', centro, 'substituiu fechamento de produtividade',
      U.fComp(competencia) + ' · ' + resultado.cancelados + ' fechamento(s) anterior(es) cancelado(s) · ' + motivo);
    return Object.assign({ ok: true }, resultado);
  }

  /* Confirmação da produtividade pela gestora: enquanto o fechamento
     não é confirmado, o valor é um número de trabalho — o financeiro
     não pode pagar. É a mão da produtividade dizendo "este é o valor
     fidedigno". */
  function confirmarLoteProdutividade(loteId, opcoes) {
    /* Confirmar é a SEGUNDA MÃO do módulo, não "mexer mais": vem do
       nível de Aprovação da matriz. */
    if (!pode('confirmar_produtividade')) {
      return { erro: 'Seu perfil não confirma produtividade — é a aprovação do módulo.' };
    }
    const l = st.lotesProdutividade.find(function (x) { return x.id === loteId; });
    if (!l) return { erro: 'Fechamento não encontrado.' };
    if (l.cancelado) return { erro: 'Este fechamento foi cancelado.' };
    if (l.confirmado_em) return { erro: 'Este fechamento já foi confirmado.' };
    const bloqueados = (l.bloqueios || []).filter(function (b) { return !b.liberado_em; });
    if (bloqueados.length && !(opcoes || {}).ciente_bloqueios) {
      return {
        erro: bloqueados.length + ' médico(s) com pagamento bloqueado neste fechamento (' +
          bloqueados.slice(0, 3).map(function (b) { return b.medico; }).join(', ') +
          (bloqueados.length > 3 ? ' e mais ' + (bloqueados.length - 3) : '') +
          '). Eles ficam FORA da remessa de pagamento. Confirme ciente disso ou libere antes.',
        bloqueios: bloqueados.length
      };
    }
    l.confirmado_em = new Date().toISOString();
    l.confirmado_por = usuario().nome;
    l.confirmado_por_id = (usuario() || {}).id || null;
    logar('produtividade', l.centro, 'confirmou o fechamento de produtividade',
      U.fComp(l.competencia) + ' · ' + U.brl(l.valor || 0) + ' · ' + (l.medicos || 0) + ' médico(s)' +
      (bloqueados.length ? ' · ' + bloqueados.length + ' bloqueado(s) fora da remessa' : ''));
    return { ok: true, lote: l, bloqueados: bloqueados.length };
  }

  /* Bloqueio de pagamento por médico: contrato não assinado, check-in
     não confirmado, o que a gestão precisar segurar. O título continua
     lançado (o custo é real), mas não entra em remessa. */
  function bloquearPagamentoMedico(loteId, d) {
    if (!pode('produtividade') && !pode('lancar')) {
      return { erro: 'Seu perfil não bloqueia pagamento de médico.' };
    }
    const l = st.lotesProdutividade.find(function (x) { return x.id === loteId; });
    if (!l) return { erro: 'Fechamento não encontrado.' };
    if (!d || !d.titulo_id) return { erro: 'Informe o lançamento do médico.' };
    const t = st.titulos.find(function (x) { return x.id === d.titulo_id; });
    if (!t) return { erro: 'Lançamento não encontrado.' };
    const pagas = st.parcelas.filter(function (p) {
      return p.titulo_id === t.id && pagamentosDe(p.id).length > 0; });
    if (pagas.length) return { erro: 'Este médico já teve pagamento feito — não há o que bloquear.' };
    l.bloqueios = l.bloqueios || [];
    if (l.bloqueios.some(function (b) { return b.titulo_id === t.id && !b.liberado_em; })) {
      return { erro: 'Este médico já está bloqueado neste fechamento.' };
    }
    const b = {
      titulo_id: t.id, medico: (D.credor(t.credor) || {}).nome || '',
      motivo: d.motivo || '', em: U.hoje(), por: usuario().nome, liberado_em: null
    };
    l.bloqueios.push(b);
    st.parcelas.filter(function (p) { return p.titulo_id === t.id; })
      .forEach(function (p) { p.bloqueio_pagamento = { motivo: b.motivo, por: b.por, em: b.em }; });
    logar('produtividade', l.centro, 'bloqueou pagamento de médico',
      b.medico + ' · ' + U.fComp(l.competencia) + (b.motivo ? ' · ' + b.motivo : ''));
    return { ok: true, bloqueio: b };
  }

  function liberarPagamentoMedico(loteId, tituloId, motivo) {
    if (!pode('produtividade') && !pode('lancar')) {
      return { erro: 'Seu perfil não libera pagamento de médico.' };
    }
    const l = st.lotesProdutividade.find(function (x) { return x.id === loteId; });
    if (!l) return { erro: 'Fechamento não encontrado.' };
    const b = (l.bloqueios || []).find(function (x) { return x.titulo_id === tituloId && !x.liberado_em; });
    if (!b) return { erro: 'Este médico não está bloqueado.' };
    b.liberado_em = U.hoje();
    b.liberado_por = usuario().nome;
    b.liberacao_motivo = motivo || '';
    st.parcelas.filter(function (p) { return p.titulo_id === tituloId; })
      .forEach(function (p) { p.bloqueio_pagamento = null; });
    logar('produtividade', l.centro, 'liberou pagamento de médico',
      b.medico + ' · ' + U.fComp(l.competencia) + (motivo ? ' · ' + motivo : ''));
    return { ok: true, bloqueio: b };
  }

  /* Situação do fechamento para a lista de lançamentos. */
  function situacaoLoteProdutividade(l) {
    const bloqueados = (l.bloqueios || []).filter(function (b) { return !b.liberado_em; });
    return {
      confirmado: !!l.confirmado_em,
      bloqueados: bloqueados.length,
      medicos_bloqueados: bloqueados.map(function (b) { return b.medico; }),
      situacao: l.cancelado ? 'cancelado'
        : !l.confirmado_em ? 'aguardando confirmação'
        : bloqueados.length ? 'confirmado com bloqueio'
        : 'confirmado'
    };
  }

  function cancelarLoteProdutividade(loteId, motivo, forcar, opcoes) {
    /* Substituição de fechamento sem nenhum pagamento é rotina de quem
       lança; cancelamento avulso continua sendo de quem pode cancelar. */
    const porSubstituicao = (opcoes || {}).por_substituicao && pode('lancar');
    /* Quando o cancelamento vem de uma SUBSTITUIÇÃO, as parcelas são
       canceladas como parte da operação, não por decisão de quem
       clicou: sem o `_interno`, cada `cancelar` voltava a exigir
       `pode('cancelar')`, falhava calada em todas, e a função ainda
       devolvia ok com "1 cancelado" — o fechamento antigo continuava
       de pé e o médico aparecia com os dois. É a mesma correção que
       `cancelarFolha` já tinha. */
    const internoCancelar = !!porSubstituicao;
    if (!pode('cancelar') && !porSubstituicao) {
      return { erro: 'Só diretoria ou sócio cancela lançamento.' };
    }
    const l = st.lotesProdutividade.find(function (x) { return x.id === loteId; });
    if (!l) return { erro: 'Lote não encontrado.' };
    if (l.cancelado) return { erro: 'Este lote já foi cancelado.' };
    if (!motivo) return { erro: 'Informe o motivo do cancelamento.' };
    const parcelasDoLote = st.parcelas.filter(function (p) { return l.titulo_ids.indexOf(p.titulo_id) > -1; });
    const jaPagas = parcelasDoLote.filter(function (p) { return pagamentosDe(p.id).length > 0; });
    /* Regra da empresa: fechamento sem NENHUM pagamento feito se cancela
       direto. A partir do primeiro pagamento, cancelar deixa de ser
       rotina: exige AUTORIZAÇÃO do administrador, porque o que sobra
       depois é correção manual de valor pago, médico a médico. */
    if (jaPagas.length && !forcar) {
      return { erro: jaPagas.length + ' médico(s) deste fechamento já receberam. A partir daí o cancelamento ' +
        'precisa de autorização do administrador, e os valores já pagos viram correção manual.',
        jaPagas: jaPagas.length, exigeAutorizacao: true };
    }
    if (jaPagas.length && forcar) {
      if (!pode('admin')) {
        return { erro: 'Só o administrador autoriza alterar um fechamento com pagamento já feito. ' +
          'Peça a autorização — os ' + jaPagas.length + ' pagamento(s) já liquidados terão que ser ' +
          'corrigidos manualmente (estorno do pagamento ou acerto no próximo fechamento).',
          jaPagas: jaPagas.length, exigeAutorizacao: true };
      }
      if (!d_autorizacao(motivo)) {
        return { erro: 'Descreva a autorização (quem autorizou e por quê) — isso fica na trilha de auditoria.' };
      }
      logar('produtividade', l.id, 'AUTORIZOU alteração de fechamento com pagamento feito',
        jaPagas.length + ' pagamento(s) já liquidados · ' + motivo);
    }

    /* Parcela PAGA não se cancela — e era aí que o cancelamento
       falhava calado, deixando o fechamento de pé enquanto a função
       dizia ter cancelado. Com a autorização do administrador na mão,
       o pagamento é ESTORNADO primeiro, que é o que "autorizar" quer
       dizer: desfazer o que já saiu, com rastro. */
    const estornados = [];
    if (jaPagas.length && forcar && pode('admin')) {
      jaPagas.forEach(function (p) {
        pagamentosDe(p.id).filter(function (pg) {
          return !pg.estornado && pg.situacao === 'liquidado';
        }).forEach(function (pg) {
          const e = estornar(pg.id, 'Fechamento cancelado com autorização: ' + motivo);
          if (e.ok) estornados.push({ parcela: p.id, valor: pg.valor });
        });
      });
    }
    let n = 0;
    const puladas = [];
    parcelasDoLote.forEach(function (p) {
      /* Já cancelada antes (por conta própria, fora deste lote) conta
         como "já está no estado certo" — sem isso, o lote nunca fechava
         como "cancelado": o `n` nunca alcançava o total só porque uma
         das parcelas não precisava ser cancelada de novo. */
      if (p.status === 'cancelado') { n++; return; }
      const r = cancelar(p.id, motivo, internoCancelar);
      if (r.ok) n++; else puladas.push({ parcela: p, erro: r.erro });
    });
    /* Nenhuma cancelada é erro, não sucesso: antes a função devolvia
       ok com o contador cheio enquanto as parcelas seguiam abertas, e
       quem substituiu o fechamento acabava com os dois valendo. */
    if (!n && parcelasDoLote.length) {
      return { erro: 'Nenhuma parcela do lote pôde ser cancelada' +
        (puladas[0] && puladas[0].erro ? ': ' + puladas[0].erro : '.') };
    }
    l.cancelado = n === parcelasDoLote.length;
    l.cancelado_parcial = !l.cancelado;
    if (l.cancelado_parcial) {
      l.parcelas_nao_canceladas = puladas.map(function (x) { return x.parcela.id; });
    }
    l.motivo_cancelamento = motivo;
    l.cancelado_por = usuario().nome;
    l.cancelado_em = new Date();
    /* Cancelar o fechamento desfaz também a CONFIRMAÇÃO do valor a
       faturar que veio dele: senão o alerta seguia pedindo NF de um
       fechamento que não existe mais. Só quando não sobra nenhum outro
       lote vivo naquele projeto/competência. */
    let confirmacaoDesfeita = false;
    if (l.cancelado) {
      const aindaTem = st.lotesProdutividade.some(function (x) {
        return x.id !== l.id && !x.cancelado && x.centro === l.centro && x.competencia === l.competencia;
      });
      const pv = previsaoDe(l.centro, l.competencia);
      if (!aindaTem && pv && pv.status === 'confirmada_prod') {
        pv.status = 'estimada';
        pv.observacao = 'Confirmação desfeita: o fechamento da produtividade foi cancelado';
        st.receber.filter(function (r) {
          return r.origem === 'previsao' && r.status === 'previsto' && r.valor_confirmado_produtividade &&
            r.centro === l.centro && r.competencia === l.competencia;
        }).forEach(function (r) {
          r.valor_confirmado_produtividade = false;
          r.observacao = 'Fechamento de produtividade cancelado — valor voltou a ser previsão';
        });
        confirmacaoDesfeita = true;
      }
    }
    logar('produtividade', l.id, l.cancelado ? 'cancelou lote' : 'cancelou lote parcialmente',
      n + ' de ' + parcelasDoLote.length + ' · ' + motivo +
      (confirmacaoDesfeita ? ' · confirmação do faturamento desfeita' : ''));
    return { ok: true, n: n, puladas: puladas.length, parcial: !l.cancelado,
      estornados: estornados.length,
      valor_estornado: Math.round(estornados.reduce(function (s2, x) {
        return s2 + x.valor; }, 0) * 100) / 100,
      confirmacao_desfeita: confirmacaoDesfeita };
  }

  /* ── remessa bancária ───────────────────────────────────
     A parcela vai para o banco uma vez. Se o retorno recusar, ela
     volta a ficar disponível para uma nova remessa. */
  /* Fila da remessa: pagamentos que a diretoria já aprovou e que ainda
     não foram para o banco. */
  function aptasParaRemessa() {
    return st.pagamentos.filter(function (pg) {
      return pg.situacao === 'autorizado' && !pg.estornado;
    }).map(function (pg) {
      return { pagamento: pg, parcela: parcela(pg.parcela_id), falta: impedimentos(parcela(pg.parcela_id) || {}) };
    }).filter(function (x) { return x.parcela; })
      .sort(function (a, b) { return (a.parcela.venc || '').localeCompare(b.parcela.venc || ''); });
  }

  /* A remessa é o ponto de corte: o que não tem dado bancário fica de
     fora do arquivo, com o motivo, em vez de impedir o título de andar
     desde o começo. */
  /* Código de barras informado depois da aprovação: é o fluxo real —
     o boleto é atualizado quando já se sabe que o pagamento sai. */
  function informarCodigoBarras(parcelaId, codigo) {
    if (!pode('pagar') && !pode('lancar')) return { erro: 'Seu perfil não altera o pagamento.' };
    const p = parcela(parcelaId);
    if (!p) return { erro: 'Parcela não encontrada.' };
    const limpo = String(codigo || '').replace(/\D/g, '');
    if (limpo.length < 44) {
      return { erro: 'A linha digitável do boleto tem 47 dígitos e o código de barras, 44. ' +
        'Faltam dígitos no que foi informado (' + limpo.length + ').' };
    }
    p.codigo_barras = limpo;
    /* O pagamento já criado também recebe, senão a remessa continua
       lendo o código antigo (vazio). */
    st.pagamentos.filter(function (pg) {
      return pg.parcela_id === p.id && !pg.estornado && pg.situacao !== 'liquidado';
    }).forEach(function (pg) { pg.codigo_barras = limpo; });
    logar('parcela', p.id, 'informou código de barras',
      nomeCredorVisivel(p) + ' · ' + U.brl(saldoDe(p)) + ' · venc. ' + U.fData(p.venc));
    return { ok: true, parcela: p };
  }

  const remessaProntas = () => aptasParaRemessa().filter(function (x) { return !x.falta.length; });
  const remessaBloqueadas = () => aptasParaRemessa().filter(function (x) { return x.falta.length; });

  /* ── grupos de repasse médico ────────────────────────────
     Um fechamento de produtividade ("Anestesia GHC, julho") vira DEZENAS
     de títulos, um por médico, porque o pagamento é individual. Na tela
     isso vira uma parede de linhas iguais. Aqui esses títulos são
     agrupados pelo documento do fechamento, para a lista mostrar uma
     linha só, que abre; e para a seleção poder ser do grupo inteiro, de
     alguns médicos ou de um só. A remessa continua individual — é um
     pagamento por médico, e é assim que o banco recebe. */
  const tituloDaParcela = id => st.titulos.find(function (t) { return t.id === id; }) || {};

  function chaveDoGrupo(p) {
    if (p.origem !== 'produtividade') return null;
    const t = tituloDaParcela(p.titulo_id);
    /* O documento do fechamento é a chave natural; sem ele, cai para
       projeto + competência, que é o mesmo recorte. */
    const doc = (t.doc || '').replace(/\|c\d+$/, '');
    return doc ? 'fech:' + doc : 'pc:' + (p.centro || '-') + '|' + (p.comp || '-');
  }

  /* Monta os grupos a partir de uma lista de parcelas já filtrada pela
     tela — o grupo nunca inventa parcela que o filtro escondeu. */
  function agruparRepasses(parcelas) {
    const grupos = {};
    const soltas = [];
    (parcelas || []).forEach(function (p) {
      const k = chaveDoGrupo(p);
      if (!k) return soltas.push(p);
      const g = grupos[k] = grupos[k] || {
        chave: k, parcelas: [], centro: p.centro, comp: p.comp,
        doc: tituloDaParcela(p.titulo_id).doc || '',
        descricao: p.descricao || '', valor: 0, saldo: 0, venc: p.venc
      };
      g.parcelas.push(p);
      g.valor = Math.round((g.valor + (p.valor || 0)) * 100) / 100;
      g.saldo = Math.round((g.saldo + saldoDe(p)) * 100) / 100;
      if ((p.venc || '') < (g.venc || '')) g.venc = p.venc;
    });
    /* Fechamento com um médico só não vira grupo: seria uma linha que
       abre para mostrar ela mesma. */
    const lista = [];
    Object.keys(grupos).forEach(function (k) {
      const g = grupos[k];
      if (g.parcelas.length < 2) return soltas.push(g.parcelas[0]);
      g.medicos = g.parcelas.length;
      g.projeto = D.centro(g.centro) || null;
      /* O grupo só pode ir inteiro para pagamento se todas as parcelas
         puderem; as que não podem ficam visíveis dentro dele. */
      g.selecionaveis = g.parcelas.filter(function (p) {
        return p.aprovacao === 'aprovado' && ['cancelado', 'pago'].indexOf(p.status) < 0 &&
          !emCursoDe(p.id).length && saldoDe(p) > 0;
      });
      g.em_curso = g.parcelas.filter(function (p) { return emCursoDe(p.id).length; }).length;
      g.pagas = g.parcelas.filter(function (p) { return p.status === 'pago'; }).length;
      lista.push(g);
    });
    return { grupos: lista, soltas: soltas };
  }

  /* Mesma ideia do lado de quem aprova: a fila mostra o fechamento
     fechado, e quem quiser abre e aprova médico por médico. */
  function agruparPagamentos(pagamentos) {
    const grupos = {};
    const soltos = [];
    (pagamentos || []).forEach(function (pg) {
      const p = parcela(pg.parcela_id);
      const k = p ? chaveDoGrupo(p) : null;
      if (!k) return soltos.push(pg);
      const g = grupos[k] = grupos[k] || {
        chave: k, pagamentos: [], centro: p.centro, comp: p.comp,
        doc: tituloDaParcela(p.titulo_id).doc || '',
        descricao: p.descricao || '', valor: 0
      };
      g.pagamentos.push(pg);
      g.valor = Math.round((g.valor + (pg.valor || 0) + (pg.juros || 0) + (pg.multa || 0)) * 100) / 100;
    });
    const lista = [];
    Object.keys(grupos).forEach(function (k) {
      const g = grupos[k];
      if (g.pagamentos.length < 2) return soltos.push(g.pagamentos[0]);
      g.medicos = g.pagamentos.length;
      g.projeto = D.centro(g.centro) || null;
      lista.push(g);
    });
    return { grupos: lista, soltos: soltos };
  }

  const nomeDoGrupo = g => (g.projeto ? (g.projeto.curto || g.projeto.nome) + ' · ' : '') +
    (g.comp ? U.fComp(g.comp) : '') + (g.doc ? ' · ' + g.doc : '');

  // parcelas que Ana pode mandar para aprovação de pagamento
  function aptasParaSolicitar() {
    return st.parcelas.filter(function (p) {
      return p.aprovacao === 'aprovado' && p.status !== 'cancelado' &&
             p.status !== 'pago' && !emCursoDe(p.id).length && saldoDe(p) > 0;
    });
  }

  /* Quem já pode ir para o arquivo do banco: aprovado E com o cadastro
     completo. É aqui que os impedimentos passam a morar. */
  const prontasParaRemessa = () => aptasParaSolicitar().filter(function (p) {
    return !impedimentos(p).length;
  });
  const pendentesDeDados = () => aptasParaSolicitar().filter(function (p) {
    return impedimentos(p).length;
  }).map(function (p) {
    return { parcela: p, falta: impedimentos(p) };
  });

  /* "Seu número" (Segmento A, 74-93): numérico, único no convênio e é
     por ele que o retorno encontra a parcela. Continua a sequência que
     o Protheus já usava. */
  let seuNumeroSeq = null;
  function proximoSeuNumero() {
    if (seuNumeroSeq === null) {
      const b = D.bancos.find(function (x) { return x.proximo_seu_numero; });
      seuNumeroSeq = b ? b.proximo_seu_numero : 1;
    }
    return seuNumeroSeq++;
  }

  function registrarRemessa(dados, itens) {
    /* Sem guarda aqui, qualquer perfil registrava a remessa — e é este
       o arquivo que o banco executa. Exige a mesma permissão de quem
       autoriza pagamento. */
    if (!pode('aprovar') && !pode('pagar')) {
      return { erro: 'Seu perfil não gera remessa bancária.' };
    }
    const r = {
      id: novoId('rm'), sequencial: dados.sequencial, banco: dados.banco,
      data_pagamento: dados.data_pagamento, layout: 'pagfor500',
      qtd: itens.length, valor_total: itens.reduce(function (s, i) { return s + i.valor; }, 0),
      arquivo_nome: dados.arquivo_nome, conteudo: dados.conteudo,
      status: 'gerada', usuario: usuario().nome, usuario_id: (usuario() || {}).id || null, criado_em: new Date(),
      itens: itens.map(function (i) {
        return { numeroPagamento: String(i.seuNumero), parcela_id: i.parcela_id,
                 pagamento_id: i.pagamento_id, valor: i.valor,
                 chave: i.chavePix, situacao: null, ocorrencias: [] };
      })
    };
    st.remessas.push(r);
    marcarEnviados(r.itens.map(function (i) { return i.pagamento_id; }), r.id);
    r.itens.forEach(function (i) {
      const pg = pagamento(i.pagamento_id);
      if (pg) pg.numero_pagamento = i.numeroPagamento;
      logar('conta_pagar', i.parcela_id, 'enviou ao banco',
        'remessa ' + r.sequencial + ' · ' + U.brl(i.valor));
    });
    logar('remessa', r.id, 'gerou', r.qtd + ' pagamento(s), ' + U.brl(r.valor_total));
    return r;
  }

  const remessas = () => st.remessas.slice().reverse();
  const remessaPorSequencial = seq => st.remessas.find(function (r) { return String(r.sequencial) === String(seq); });
  /* O sequencial sai da FAIXA reservada ao ERP: enquanto o Protheus
     manda remessa para o mesmo convênio, cada sistema tem sua faixa e
     os números não colidem (era o achado F6 da auditoria). */
  const proximoSequencialRemessa = () => {
    // os sequenciais gravados podem vir como texto; compara por número
    const usados = st.remessas.map(function (r) { return parseInt(r.sequencial, 10); });
    let n = Math.max(st.parametros.nsa_ini || 1,
      (D.bancos[0] || {}).proximo_sequencial || (D.bancos[0] || {}).proximo_arquivo || 1);
    while (usados.indexOf(n) > -1) n++;
    return n;
  };

  /* Aplica o arquivo de retorno: o que o banco pagou vira baixa; o que
     recusou volta para a fila com o motivo registrado. */
  function aplicarRetorno(lido) {
    let pagos = 0, recusados = 0, naoAchados = 0, aceitos = 0, analise = 0;
    const conflitos = [];
    lido.itens.forEach(function (it) {
      let itemRemessa = null;
      st.remessas.forEach(function (r) {
        r.itens.forEach(function (i) {
          if (String(+i.numeroPagamento) === String(+it.seuNumero)) itemRemessa = i;
        });
      });
      if (!itemRemessa) { naoAchados++; return; }
      itemRemessa.ocorrencias = it.ocorrencias;
      /* A situação do item NÃO é gravada antes de a ação dar certo:
         um retorno de recusa chegando depois do de pagamento
         carimbava "01, recusado" na remessa enquanto o financeiro
         continuava "liquidado" — os dois dizendo coisas diferentes
         sobre o mesmo item. */
      const situacaoPretendida = { pago: '02', recusado: '01', aceito: 'agendado',
        analise: 'analise' }[it.desfecho];

      if (it.desfecho === 'aceito') {
        // o banco só confirmou o agendamento: fica onde está
        itemRemessa.situacao = 'agendado';
        aceitos++;
        return;
      }
      /* Item que o banco contradiz: já liquidado e vindo como recusa,
         ou já recusado e vindo como pago. Não se desfaz nada em
         silêncio — vira conflito, com o motivo, para alguém olhar. */
      const pgAtual = pagamento(itemRemessa.pagamento_id);
      const jaLiquidado = pgAtual && !pgAtual.estornado && pgAtual.situacao === 'liquidado';
      if (jaLiquidado && !it.pago) {
        conflitos.push({ seuNumero: it.seuNumero, parcela: itemRemessa.parcela_id,
          motivo: 'o banco devolveu recusa, mas este pagamento já está liquidado no sistema',
          ocorrencias: it.mensagens.join(' · ') });
        logar('conta_pagar', itemRemessa.parcela_id, 'retorno conflitante',
          'recusa do banco em pagamento já liquidado · ' + it.mensagens.join(' · '));
        return;
      }
      if (it.desfecho === 'analise') {
        itemRemessa.situacao = 'analise';
        analise++;
        const pgx = pagamento(itemRemessa.pagamento_id);
        if (pgx) pgx.ocorrencia_banco = 'requer análise: ' + it.mensagens.join(' · ');
        logar('conta_pagar', itemRemessa.parcela_id, 'retorno não classificado', it.ocorrencias.join(' '));
        return;
      }
      if (it.pago) {
        // CNAB 240 traz DDMMAAAA; a data real do pagamento tem precedência
        const bruta = it.dataReal || it.dataPagamento || '';
        const iso = bruta.length === 8
          ? bruta.slice(4) + '-' + bruta.slice(2, 4) + '-' + bruta.slice(0, 2)
          : U.hoje();
        const r = liquidar(itemRemessa.pagamento_id, {
          data: iso, valor: it.valorReal || it.valor, doc: 'seu nº ' + it.seuNumero
        });
        if (r.ok) { pagos++; itemRemessa.situacao = situacaoPretendida; }
        else {
          /* O erro de `liquidar` era descartado: o operador via
             "retorno lido" com todos os contadores em zero e nenhuma
             pista do que aconteceu. */
          conflitos.push({ seuNumero: it.seuNumero, parcela: itemRemessa.parcela_id,
            motivo: r.erro, ocorrencias: it.mensagens.join(' · ') });
          logar('conta_pagar', itemRemessa.parcela_id, 'retorno não aplicado', r.erro);
        }
      } else {
        recusados++;
        itemRemessa.situacao = situacaoPretendida;
        devolverParaRemessa(itemRemessa.pagamento_id, it.mensagens.join(' · '));
      }
    });
    return { pagos: pagos, recusados: recusados, naoAchados: naoAchados,
             aceitos: aceitos, analise: analise,
             conflitos: conflitos.length, detalhe_conflitos: conflitos };
  }

  /* ── edição do lançamento ───────────────────────────────
     Valor, vencimento, competência, natureza, centro de custo, desconto
     e dados do documento mudam depois do lançamento (reajuste, desconto
     negociado, NF corrigida). Só enquanto o pagamento não está em curso,
     e tudo fica no histórico com o de-para. */
  const CAMPOS_EDITAVEIS = {
    descricao: 'descrição', doc: 'nº do título', tipo_titulo: 'tipo',
    emissao: 'emissão', comp: 'competência', venc: 'vencimento',
    valor: 'valor', conta: 'natureza', obs: 'observação',
    /* Trocar credor e reclassificar centro de custo são rotina de
       fechamento, não exceção. A tela dizia "o rateio se edita pelo
       lançamento original" e esse caminho não existia. */
    credor: 'fornecedor',
    codigo_barras: 'código de barras', linha_digitavel: 'linha digitável',
    /* Dados da NF não tinham como entrar depois do lançamento — só na
       hora de criar o título. Produção médica nasce dispensada (é raro
       o médico pessoa física emitir NF pela produção); os demais tipos
       de despesa nascem exigindo, e ficam sinalizados até alguém
       marcar a chave ou dispensar manualmente. */
    chave: 'chave da NF', nf_dispensada: 'dispensa de NF', sem_nf: 'marcação de "sem NF"'
  };

  /* O total do título é a soma das parcelas.

     Editar uma parcela de 333,33 para 500,00 deixava as parcelas
     somando 1.166,67 e o título ainda dizendo 1.000,00 — dois números
     para a mesma dívida, e o relatório escolhe o que estiver mais à
     mão. O total deixou de ser digitado e passou a ser derivado. */
  function recalcularTotalTitulo(tituloId) {
    const t = st.titulos.find(function (x) { return x.id === tituloId; });
    if (!t) return;
    const soma = st.parcelas.filter(function (x) {
      return x.titulo_id === tituloId && x.status !== 'cancelado' && x.status !== 'substituido';
    }).reduce(function (a, x) { return a + x.valor; }, 0);
    t.valor_total = Math.round(soma * 100) / 100;
  }

  /* Informar ou anexar a NF DEPOIS, inclusive de título já pago — é o
     caso normal: paga-se o boleto e a nota chega dias depois. Mexe só
     nos campos da nota, sem reabrir o título inteiro pra edição. */
  function informarNF(id, d) {
    if (!pode('lancar') && !pode('pagar')) return { erro: 'Seu perfil não altera dados de nota fiscal.' };
    const p = parcela(id);
    if (!p) return { erro: 'Título não encontrado.' };
    if (p.status === 'cancelado') return { erro: 'Título cancelado.' };
    const antes = { doc: p.doc, arquivo: p.arquivo ? p.arquivo.nome : null, sem_nf: p.sem_nf };
    if (d.documento !== undefined) p.doc = d.documento || null;
    if (d.chave !== undefined) p.chave = d.chave || null;
    if (d.arquivo !== undefined) p.arquivo = d.arquivo || null;
    if (d.sem_nf !== undefined) p.sem_nf = !!d.sem_nf;
    // informou número, chave ou arquivo → deixa de ser "sem NF"
    if (temNota(p)) p.sem_nf = false;
    /* Desmarcar "Sem NF" sem informar nada tirava o título do alerta e
       deixava o pagamento sem documento nenhum — exatamente o que a
       marcação existe pra evitar. A tela já dizia isso; agora o
       sistema cumpre. */
    else if (d.sem_nf === false) {
      return { erro: 'Para tirar a marcação "Sem NF", informe o número da nota (ou anexe o arquivo). ' +
        'Sem isso o título ficaria pago e sem documento nenhum.' };
    }
    /* Todas as parcelas do mesmo título compartilham a nota: informar
       numa parcela vale pro título inteiro (senão a parcela 2/3 ficaria
       eternamente "sem NF"). */
    st.parcelas.filter(function (x) { return x.titulo_id === p.titulo_id && x.status !== 'cancelado'; })
      .forEach(function (x) {
        if (d.documento !== undefined) x.doc = p.doc;
        if (d.chave !== undefined) x.chave = p.chave;
        if (d.arquivo !== undefined) x.arquivo = p.arquivo;
        x.sem_nf = p.sem_nf;
      });
    logar('parcela', p.id, 'informou dados da NF',
      (antes.doc ? 'doc ' + antes.doc + ' → ' : 'doc → ') + (p.doc || '—') +
      (p.arquivo ? ' · anexo ' + p.arquivo.nome : '') + (p.sem_nf ? ' · marcado sem NF' : ''));
    return { ok: true, parcela: p };
  }

  function editarParcela(id, dados) {
    if (tituloSigiloso(parcela(id))) {
      return { erro: 'Título de pessoal — só quem tem acesso a dados pessoais edita.' };
    }
    if (!pode('lancar')) return { erro: 'Seu perfil não edita lançamento.' };
    const p = parcela(id);
    if (!p) return { erro: 'Parcela não encontrada.' };
    if (p.status === 'cancelado') return { erro: 'Parcela cancelada não é editável.' };
    if (p.status === 'pago') return { erro: 'Parcela paga não é editável — estorne o pagamento antes.' };
    if (emCursoDe(id).length) return { erro: 'Há pagamento em andamento. Desfaça ou recuse a solicitação antes de editar.' };
    if (dados.valor !== undefined && (!isFinite(Number(dados.valor)) || !(dados.valor > 0))) {
      return { erro: 'O valor precisa ser um número maior que zero.' };
    }
    if (dados.valor !== undefined && dados.valor < pagoDe(id) - 0.004) {
      return { erro: 'O valor não pode ficar menor que o já pago (' + U.brl(pagoDe(id)) + ').' };
    }

    /* Mesma conservação de valor da criação: parcelas + retenções têm
       de fechar com o bruto da nota. A trava existia só em
       `criarTitulo`, então editar a parcela para o valor cheio fazia
       o desembolso virar bruto + retenções. */
    const tEdit = st.titulos.find(function (x) { return x.id === p.titulo_id; });
    if (dados.valor !== undefined && tEdit && tEdit.valor_bruto) {
      const outras = st.parcelas.filter(function (x) {
        return x.titulo_id === p.titulo_id && x.id !== p.id &&
          ['cancelado', 'substituido'].indexOf(x.status) < 0;
      }).reduce(function (s2, x) { return s2 + x.valor; }, 0);
      const retido = st.retencoesRegistradas.filter(function (r) {
        return r.titulo_id === p.titulo_id && !r.cancelada;
      }).reduce(function (s2, r) { return s2 + r.valor; }, 0);
      const totalNovo = Math.round((outras + Number(dados.valor) + retido) * 100) / 100;
      if (Math.abs(totalNovo - tEdit.valor_bruto) > 0.02) {
        return { erro: 'As parcelas (' + U.brl(Math.round((outras + Number(dados.valor)) * 100) / 100) +
          ') mais as retenções (' + U.brl(retido) + ') somariam ' + U.brl(totalNovo) +
          ', e a nota é de ' + U.brl(tEdit.valor_bruto) + '.' };
      }
    }

    /* Centro repetido no rateio: `criarTitulo` já recusava, a edição
       não — e `valorNoCentro` devolvia só a primeira fatia, perdendo
       o resto no relatório por centro. */
    if (dados.rateio && dados.rateio.length) {
      const nomes = dados.rateio.map(function (r) { return r.centro; });
      if (nomes.length !== new Set(nomes).size) {
        return { erro: 'O mesmo centro de custo aparece duas vezes no rateio.' };
      }
      const semCentro = dados.rateio.find(function (r) { return !D.centro(r.centro); });
      if (semCentro) return { erro: 'Centro de custo não encontrado: ' + semCentro.centro };
    }

    /* A trava de competência valia só no lançamento. Editando, dava
       para arrastar uma parcela de 10/2026 para 07/2026 e reabrir um
       mês fechado por dentro — o que anula o fechamento como controle.
       Vale para a competência de ORIGEM e para a de DESTINO: nem tirar
       de um mês fechado, nem jogar para dentro dele. */
    const ate = st.parametros.travar_competencia_ate;
    if (ate && dados.comp !== undefined && String(dados.comp) !== String(p.comp || '')) {
      if (p.comp && p.comp <= ate) {
        return { erro: 'A parcela está em competência fechada (' + U.fComp(p.comp) +
          '). Reabra o período na Administração para movê-la.' };
      }
      if (dados.comp <= ate) {
        return { erro: 'Competência fechada até ' + U.fComp(ate) +
          '. Não dá para mover a parcela para ' + U.fComp(dados.comp) + '.' };
      }
    }

    let mudouRateio = null;
    if (dados.credor !== undefined && dados.credor && !D.credor(dados.credor)) {
      return { erro: 'Fornecedor não encontrado no cadastro.' };
    }
    // mesma regra do lançamento: uma chave de NF-e não pode estar em duas parcelas
    if (dados.chave && dados.chave !== p.chave &&
        st.parcelas.some(function (x) { return x.id !== id && x.chave === dados.chave; })) {
      const ja = st.parcelas.find(function (x) { return x.id !== id && x.chave === dados.chave; });
      return { erro: 'Esta chave já está no título ' + (ja.doc || ja.id) + '.' };
    }
    if (dados.rateio !== undefined) {
      const rt = (dados.rateio || []).filter(function (r) { return r.centro && r.pct > 0; });
      if (!rt.length) return { erro: 'Informe ao menos um centro de custo.' };
      const soma = Math.round(rt.reduce(function (a, r) { return a + r.pct; }, 0) * 100) / 100;
      if (Math.abs(soma - 100) > 0.01) {
        return { erro: 'O rateio soma ' + U.num(soma) + '% — tem de fechar em 100%.' };
      }
      const antes = (p.rateio || []).map(function (r) {
        return ((D.centro(r.centro) || {}).curto || '?') + ' ' + U.num(r.pct) + '%'; }).join(' + ');
      const agora = rt.map(function (r) {
        return ((D.centro(r.centro) || {}).curto || '?') + ' ' + U.num(r.pct) + '%'; }).join(' + ');
      if (antes !== agora) {
        p.rateio = rt;
        p.centro = rt[0].centro;
        mudouRateio = 'centro de custo: ' + (antes || '—') + ' → ' + agora;
      }
    }

    const mudou = [];
    if (mudouRateio) mudou.push(mudouRateio);
    Object.keys(CAMPOS_EDITAVEIS).forEach(function (k) {
      if (dados[k] === undefined || String(dados[k]) === String(p[k] || '')) return;
      const rot = v => k === 'valor' ? U.brl(v)
        : k === 'credor' ? ((D.credor(v) || {}).nome || '—')
        : (v || '—');
      mudou.push(CAMPOS_EDITAVEIS[k] + ': ' + rot(p[k]) + ' → ' + rot(dados[k]));
      p[k] = dados[k];
    });
    /* O arquivo (base64) fica fora do laço genérico de propósito: um
       PDF vira uma string de centenas de KB, e isso no log de
       alterações — "de [blob] para [blob]" — não ajuda ninguém a
       entender o que mudou, só pesa a tela de histórico. Registra só
       que um anexo entrou ou saiu, nunca o conteúdo. */
    if (dados.arquivo_dados !== undefined && dados.arquivo_dados !== (p.arquivo_dados || null)) {
      mudou.push(dados.arquivo_dados ? 'anexou a NF (' + (dados.arquivo || 'arquivo') + ')' : 'removeu o anexo da NF');
      p.arquivo_dados = dados.arquivo_dados;
      p.arquivo = dados.arquivo || null;
    }
    if (dados.rateio && dados.rateio.length) {
      const rat = normalizaRateio(dados.rateio, null);
      const soma = rat.reduce(function (a, r) { return a + r.pct; }, 0);
      if (Math.abs(soma - 100) > 0.01) return { erro: 'O rateio soma ' + U.num(soma) + '% — precisa fechar em 100%.' };
      const antes = (p.rateio || []).map(function (r) { return (D.centro(r.centro) || {}).curto + ' ' + U.pct(r.pct); }).join('/');
      const depois = rat.map(function (r) { return (D.centro(r.centro) || {}).curto + ' ' + U.pct(r.pct); }).join('/');
      if (antes !== depois) { mudou.push('centro de custo: ' + antes + ' → ' + depois); p.rateio = rat; p.centro = rat[0].centro; }
    }
    if (!mudou.length) return { ok: true, n: 0 };
    recalcular(id);
    recalcularTotalTitulo(p.titulo_id);
    logar('conta_pagar', id, 'editou', mudou.join(' · '));
    return { ok: true, n: mudou.length, mudou: mudou };
  }

  /* ── estoque por armazém, CUSTO MÉDIO PONDERADO MÓVEL ───
     Cada produto tem, em cada armazém, um saldo e um valor total. A
     entrada soma quantidade e valor e recalcula a média; a saída baixa
     pelo custo médio do momento. É o método usado pela maioria dos ERPs
     brasileiros e o que a contabilidade espera.

     As entradas continuam registradas uma a uma (com lote, validade e
     custo da compra) para rastreabilidade — o que mudou em relação ao
     FIFO é como o custo da SAÍDA é calculado. Trocar de método é mexer
     em saida() e em posicao(), não na estrutura. */
  let seqMov = 1;
  const chaveEst = (p, a) => p + '|' + a;

  function posicao(produtoId, armazemId) {
    const k = chaveEst(produtoId, armazemId);
    if (!st.posicoes[k]) st.posicoes[k] = { produto: produtoId, armazem: armazemId, saldo: 0, valor: 0 };
    return st.posicoes[k];
  }

  const saldoEstoque = (produtoId, armazemId) => armazemId
    ? Math.round(posicao(produtoId, armazemId).saldo * 1000) / 1000
    : Math.round(Object.keys(st.posicoes).filter(function (k) { return k.split('|')[0] === produtoId; })
        .reduce(function (s2, k) { return s2 + st.posicoes[k].saldo; }, 0) * 1000) / 1000;

  const valorEstoque = (produtoId, armazemId) => armazemId
    ? Math.round(posicao(produtoId, armazemId).valor * 100) / 100
    : Math.round(Object.keys(st.posicoes).filter(function (k) { return k.split('|')[0] === produtoId; })
        .reduce(function (s2, k) { return s2 + st.posicoes[k].valor; }, 0) * 100) / 100;

  const custoMedio = (produtoId, armazemId) => {
    const p = posicao(produtoId, armazemId);
    return p.saldo > 0 ? Math.round(p.valor / p.saldo * 10000) / 10000 : 0;
  };

  // as entradas ficam registradas para lote, validade e rastreio
  const camadas = (produtoId, armazemId) => st.estoque.filter(function (c) {
    return c.produto === produtoId && c.armazem === armazemId;
  });

  /* Data de movimento de estoque: nem no futuro, nem antes do último
     inventário daquele armazém — o inventário é a contagem física que
     zera a discussão, e lançar antes dele reescreve um saldo que já foi
     conferido. */
  /* (integrado do ramo paralelo de QA)
  /* Data de movimento de estoque: nem no futuro, nem antes do último
     inventário daquele armazém — o inventário é a contagem física que
     zera a discussão, e lançar antes dele reescreve um saldo que já foi
     conferido. */
  /* Data do último inventário que já ACONTECEU. Uma contagem com data
     futura não pode barrar o movimento de hoje: quando isso valia, um
     inventário digitado com o ano errado (29/12/2026 em vez de 2025)
     trancava o armazém até a data chegar — nem entrada, nem saída, nem
     transferência — e a mensagem mandava fazer um novo inventário, que
     não resolvia, porque o corte era o MAIOR dos inventários, não o
     último lançado. O armazém ficava morto com o material andando. */
  function ultimoInventario(armazemId) {
    const hoje = U.hoje();
    return st.estoqueMov.filter(function (m) {
      /* Nem contagem futura, nem a que foi estornada, nem o próprio
         movimento inverso do estorno (que herda a origem). */
      return m.armazem === armazemId && m.origem === 'inventario' && !m.estornado &&
        !m.estorno_de && m.data && m.data <= hoje;
    }).map(function (m) { return m.data; }).sort().pop() || null;
  }

  /* O inventário é a contagem física: também não acontece no futuro.
     Ele pode (e deve) ser lançado na data em que se contou, mas não
     antes do último inventário, que recontaria um saldo já conferido. */
  function checarDataInventario(data, armazemId) {
    const dt = data || U.hoje();
    if (!dataExiste(dt)) return 'Data do inventário inválida.';
    if (dt > U.hoje()) {
      return 'Data no futuro (' + U.fData(dt) + '). O inventário é a contagem física — ' +
        'lance na data em que o armazém foi contado.';
    }
    const inv = ultimoInventario(armazemId);
    if (inv && dt < inv) {
      return 'Já existe inventário deste armazém em ' + U.fData(inv) +
        '. Um inventário anterior a esse recontaria um saldo já conferido.';
    }
    return null;
  }

  function checarDataMovimento(data, armazemId) {
    const dt = data || U.hoje();
    if (!dataExiste(dt)) return 'Data do movimento inválida.';
    if (dt > U.hoje()) return 'Data no futuro (' + U.fData(dt) + '). O movimento de estoque é do dia em que aconteceu.';
    const inv = ultimoInventario(armazemId);
    if (inv && dt < inv) {
      return 'Data anterior ao último inventário deste armazém (' + U.fData(inv) +
        '). Lance a partir dessa data ou faça um novo inventário.';
    }
    return null;
  }

  function entrada(d) {
    d = d || {};
    /* A devolução do material na EDIÇÃO de um procedimento é parte do
       próprio procedimento: quem movimenta procedimentos precisa dela,
       senão a edição é recusada no meio e o material fica baixado duas
       vezes. Entrada comum continua exigindo o M de Estoque. */
    const estornoDeProcedimento = d.origem === 'procedimento-edicao' && podeMover('procedimentos');
    if (!podeMover('estoque') && !pode('receber') && !estornoDeProcedimento) {
      return { erro: 'Seu perfil não dá entrada no estoque.' };
    }
    /* O inventário é dispensado da trava "não lance antes do último
       inventário" — é ele que define esse marco. Mas data no futuro e
       data inválida valem para ele também: um ano digitado errado
       (31/12/2030) travava o armazém inteiro para sempre, porque daí
       em diante todo movimento caía antes do "último inventário". */
    const dtEntrada = d.data || U.hoje();
    if (!dataExiste(dtEntrada)) return { erro: 'Data do movimento inválida.' };
    if (dtEntrada > U.hoje()) {
      return { erro: 'Data no futuro (' + U.fData(dtEntrada) + '). O movimento de estoque é do dia ' +
        'em que aconteceu.' };
    }
    if (d.origem !== 'inventario') {
      const erroData = checarDataMovimento(d.data, d.armazem);
      if (erroData) return { erro: erroData };
    }
    const p = D.produtos.find(function (x) { return x.id === d.produto; });
    if (!p) return { erro: 'Produto não encontrado.' };
    if (!D.armazem(d.armazem)) return { erro: 'Informe o armazém.' };
    /* O estoque é controlado em UNIDADES, porque é assim que a
       cirurgia consome: entra 1 caixa de máscara com 100, e a baixa
       do centro cirúrgico é de 1 máscara, não de 1 caixa.

       Então a entrada aceita a quantidade como veio na nota (caixas)
       mais quantas unidades tem cada uma, e guarda o produto das
       duas. O custo unitário acompanha: 1 caixa a R$ 200 com 100
       unidades vira 100 unidades a R$ 2. Sem isso, a baixa de uma
       unidade tiraria R$ 200 do estoque. */
    /* Zero explícito não vira 1: `|| 1` transformava "0 unidades por
       caixa" em entrada normal, escondendo o erro de digitação. */
    const embInformada = d.unidades_por_embalagem;
    const embalagem = (embInformada === undefined || embInformada === null || embInformada === '')
      ? 1 : Math.round(Number(embInformada) * 1000) / 1000;
    if (!(embalagem > 0)) {
      return { erro: p.descricao + ': informe quantas unidades vêm em cada ' +
        (p.unidade || 'embalagem') + '.' };
    }
    const qtdNota = Math.round(Number(d.qtd || 0) * 1000) / 1000;
    if (!(qtdNota > 0) || !isFinite(qtdNota)) {
      return { erro: 'Informe a quantidade de ' + p.descricao + '.' };
    }
    if (!isFinite(embalagem)) {
      return { erro: p.descricao + ': unidades por embalagem com número inválido.' };
    }
    const qtd = Math.round(qtdNota * embalagem * 1000) / 1000;
    /* Custo vindo de import ou integração chega como texto ("120,00")
       ou negativo. Number('120,00') é NaN, e o NaN contaminava a
       posição para sempre: o valor do armazém inteiro virava vazio. */
    const custoBruto = typeof d.custo === 'string'
      ? Number(String(d.custo).replace(/\./g, '').replace(',', '.'))
      : Number(d.custo === undefined || d.custo === null || d.custo === '' ? 0 : d.custo);
    if (!isFinite(custoBruto) || custoBruto < 0) {
      return { erro: p.descricao + ': custo inválido (' + d.custo + ').' };
    }
    /* Frete informado entra no custo do estoque, com ou sem pedido:
       fora do caminho do pedido ele era simplesmente ignorado, e os
       R$ 100 de frete ficavam fora do custo do material, do
       procedimento e do DRE do projeto. */
    let freteLinha = 0;
    if (d.frete !== undefined && d.frete !== null && d.frete !== '') {
      freteLinha = numeroBR(d.frete);
      if (!isFinite(freteLinha) || freteLinha < 0) {
        return { erro: p.descricao + ': frete inválido (' + d.frete + ').' };
      }
    }
    const custoNota = Math.round(custoBruto * 10000) / 10000;
    const custo = Math.round((custoNota / embalagem) * 10000) / 10000;

    const pos = posicao(d.produto, d.armazem);
    /* Único caminho para mexer em saldo e valor: a função recusa o que
       deixaria a posição impossível (valor negativo, número inválido,
       saldo zerado com valor sobrando). */
    /* O valor que entra é o da NOTA, não qtd × unitário arredondado:
       com 4 casas no unitário, uma nota de R$ 200.000,00 entrava como
       R$ 200.000,10 no estoque. */
    /* `valor_total` permite mover o valor EXATO que saiu da origem:
       na transferência, recompor por custo unitário arredondado em 4
       casas criava centavos do nada (700 × 0,1429 = R$ 100,03 para
       R$ 100,00 que saíram). */
    const valorLinha = (d.valor_total !== undefined && d.valor_total !== null &&
        isFinite(Number(d.valor_total)))
      ? Math.round(Number(d.valor_total) * 100) / 100
      : Math.round((custoNota * (Number(d.qtd) || 0) + freteLinha) * 100) / 100;
    const apl = aplicarPosicao(pos, qtd, valorLinha, 'Entrada de ' + p.descricao);
    if (apl.erro) return { erro: apl.erro };

    /* Três datas, e cada uma responde a uma pergunta diferente:
         data_nf  — quando o fornecedor emitiu. Vem da nota, não se
                    inventa: sem nota fica vazia.
         data     — quando o material entrou no armazém. Começa igual à
                    da nota e pode ser corrigida, porque a mercadoria
                    chega depois da emissão.
         lancado_em — quando isto foi registrado no sistema. É carimbo,
                    não campo: ninguém digita e ninguém altera. É o que
                    permite explicar, depois, por que o estoque de
                    ontem não batia com o de hoje.
       Só as duas primeiras aparecem no lançamento; a terceira existe
       para o relatório. */
    const c = {
      id: 'en' + (seqMov++), produto: d.produto, armazem: d.armazem,
      qtd: qtd, custo: custo,
      data: d.data || d.data_nf || U.hoje(),
      data_nf: d.data_nf || null,
      lancado_em: U.hoje(),
      lote: d.lote || '', validade: d.validade || '',
      origem: d.origem || 'manual', documento: d.documento || '',
      nota_chave: d.nota_chave || null, pedido_id: d.pedido_id || null, grupo: d.grupo || null
    };
    st.estoque.push(c);
    st.estoqueMov.push({
      id: novoId('mv'), tipo: 'entrada',
      /* Explícito desde a origem: o banco exige preenchido, e
         deixar para a rede de obrigatórias preencher depois era
         contar com a rede. */
      estornado: false,
      /* Como veio na nota, para o histórico não virar adivinhação. */
      qtd_nota: qtdNota, unidades_por_embalagem: embalagem, custo_nota: custoNota, produto: d.produto, armazem: d.armazem,
      qtd: qtd, custo: custo, valor: Math.round(qtd * custo * 100) / 100,
      medio_depois: custoMedio(d.produto, d.armazem),
      data: c.data, data_nf: c.data_nf, lancado_em: c.lancado_em,
      motivo: d.motivo || 'Entrada', documento: c.documento,
      lote: c.lote, validade: c.validade, origem: c.origem, grupo: c.grupo,
      pedido_id: c.pedido_id, usuario: usuario().nome, usuario_id: (usuario() || {}).id || null
    });
    if (!d.grupo) {   // entrada em lote já registra o grupo inteiro
      logar('estoque', c.id, 'entrada de material',
        (D.produtos.find(function (x) { return x.id === d.produto; }) || {}).descricao +
        ' · ' + U.num(qtd) + ' un · ' + U.brl(qtd * custo) +
        ' · ' + ((D.armazem(d.armazem) || {}).nome || ''));
    }
    return { ok: true, entrada: c, medio: custoMedio(d.produto, d.armazem) };
  }

  /* Saída pelo custo médio do momento — é esse valor que vai para o
     DRE do projeto do armazém. */
  /* Nome de paciente é dado de saúde: quem não tem `ver_pacientes` vê
     a movimentação, mas com o nome mascarado — inclusive na exportação
     e na busca (senão dava pra descobrir o nome por tentativa). */
  const vePaciente = () => pode('ver_pacientes');
  function pacienteVisivel(nome) {
    if (!nome) return '';
    return vePaciente() ? nome : '[restrito]';
  }
  function pacientesDoMovimento(m) {
    const lista = (m.pacientes && m.pacientes.length) ? m.pacientes : (m.paciente ? [m.paciente] : []);
    return vePaciente() ? lista : lista.map(function () { return '[restrito]'; });
  }

  /* Consumo por paciente: o relatório que o diretor pediu. Uma linha
     por paciente e material, com quantidade, custo e as datas. Só pra
     quem tem a permissão. */
  function consumoPorPaciente(f) {
    if (!vePaciente()) return { erro: 'Seu perfil não vê nome de paciente (dado de saúde).' };
    f = f || {};
    const linhas = {};
    movimentos({ de: f.de, ate: f.ate, armazem: f.armazem, tipo: 'saida' }).forEach(function (m) {
      if (m.estornado) return;   // consumo desfeito não conta
      const nomes = (m.pacientes && m.pacientes.length) ? m.pacientes : (m.paciente ? [m.paciente] : []);
      if (!nomes.length) return;
      if (f.paciente && nomes.every(function (n) {
        return String(n).toLowerCase().indexOf(String(f.paciente).toLowerCase()) < 0; })) return;
      /* Lista com um nome por unidade: cada nome leva 1 unidade e a
         fração do custo. Um nome só na baixa leva a quantidade toda. */
      const porNome = nomes.length > 1 ? 1 : m.qtd;
      const custoUnit = m.qtd ? m.valor / m.qtd : 0;
      nomes.forEach(function (n) {
        const chave = String(n).trim().toLowerCase() + '|' + m.produto;
        const p = D.produtos.find(function (x) { return x.id === m.produto; }) || {};
        const l = linhas[chave] || (linhas[chave] = {
          paciente: String(n).trim(), produto: p, qtd: 0, valor: 0,
          primeira: m.data, ultima: m.data, movimentos: 0, armazens: {}
        });
        l.qtd = Math.round((l.qtd + porNome) * 1000) / 1000;
        l.valor = Math.round((l.valor + porNome * custoUnit) * 100) / 100;
        l.movimentos++;
        l.armazens[(D.armazem(m.armazem) || {}).nome || m.armazem] = true;
        if (m.data < l.primeira) l.primeira = m.data;
        if (m.data > l.ultima) l.ultima = m.data;
      });
    });
    const lista = Object.keys(linhas).map(function (k) {
      const l = linhas[k];
      l.armazem = Object.keys(l.armazens).join(', ');
      delete l.armazens;
      return l;
    }).sort(function (a, b) {
      return a.paciente.localeCompare(b.paciente) ||
        String(a.produto.descricao).localeCompare(String(b.produto.descricao));
    });
    logar('estoque', 'consumo-paciente', 'consultou consumo por paciente',
      lista.length + ' linha(s)' + (f.de ? ' de ' + U.fData(f.de) : '') + (f.ate ? ' até ' + U.fData(f.ate) : ''));
    return { ok: true, linhas: lista };
  }

  /* Confere a lista de pacientes contra a quantidade baixada. Erra pra
     mais ou pra menos → erro explicando, em vez de gravar torto. */
  function conferirPacientes(d, qtd, descricao) {
    const lista = (d.pacientes || []).map(function (x) { return String(x).trim(); })
      .filter(function (x) { return x.length; });
    if (!lista.length) return null;
    if (lista.length === 1) return null;                 // um paciente pra baixa inteira
    if (Math.abs(lista.length - qtd) > 0.0001) {
      return descricao + ': a lista tem ' + lista.length + ' paciente(s) e a baixa é de ' +
        U.num(qtd) + ' unidade(s). Use um nome por unidade, ou deixe um nome só pra baixa inteira.';
    }
    return null;
  }

  function saida(d) {
    d = d || {};
    if (!podeMover('estoque') && !podeMover('procedimentos')) {
      return { erro: 'Seu perfil não movimenta estoque (saída).' };
    }
    /* Consumo em 31/12/2027 passava sem aviso, e movimento com data
       fora de ordem estraga o custo médio na reconstrução. */
    const erroData = checarDataMovimento(d.data, d.armazem);
    if (erroData) return { erro: erroData };
    const p = D.produtos.find(function (x) { return x.id === d.produto; });
    if (!p) return { erro: 'Produto não encontrado.' };
    if (!D.armazem(d.armazem)) return { erro: 'Informe o armazém.' };
    const qtd = Math.round((d.qtd || 0) * 1000) / 1000;
    if (!(qtd > 0)) return { erro: 'Informe a quantidade de ' + p.descricao + '.' };
    const pos = posicao(d.produto, d.armazem);
    if (qtd > pos.saldo + 0.0001) {
      return { erro: p.descricao + ': saldo de ' + U.num(pos.saldo) + ' ' + p.unidade +
        ' em ' + (D.armazem(d.armazem) || {}).nome + ', pedido ' + U.num(qtd) + '.' };
    }
    const erroPac = conferirPacientes(d, qtd, p.descricao);
    if (erroPac) return { erro: erroPac };
    const medio = custoMedio(d.produto, d.armazem);
    /* Saída que ZERA o saldo leva o valor que está lá, não
       qtd × custo médio arredondado. O custo médio tem 4 casas e nem
       sempre multiplica de volta ao valor exato: 7 caixas de 100 a
       R$ 22,40 deixavam um resíduo de R$ 0,03, e a guarda de valor
       negativo — criada para fechar o furo do estorno — passava a
       recusar a baixa legítima do saldo inteiro. O saldo ficava preso
       no armazém, sem consumo, sem estorno e sem transferência. */
    const zeraSaldo = qtd >= pos.saldo - 0.0001;
    const custoTotal = zeraSaldo
      ? Math.round(pos.valor * 100) / 100
      : Math.round(qtd * medio * 100) / 100;
    const aplS = aplicarPosicao(pos, -qtd, -custoTotal, 'Saída de ' + p.descricao);
    if (aplS.erro) return { erro: aplS.erro };

    /* Rastreabilidade por paciente: o diretor quer saber pra quem foi
       cada unidade. Em vez de 20 campos pra uma baixa de 20 (inviável
       num dia de 70 atendimentos), a baixa aceita a LISTA de pacientes
       — uma linha por unidade, que a enfermagem cola do sistema dela.
       Um nome só vale pra baixa inteira (paciente que consumiu várias
       unidades). A conferência de quantidade fica em `pacientesDaBaixa`. */
    const pacientes = (d.pacientes || []).map(function (x) { return String(x).trim(); })
      .filter(function (x) { return x.length; });
    const mv = {
      id: novoId('mv'), tipo: 'saida', estornado: false,
      produto: d.produto, armazem: d.armazem,
      qtd: qtd, custo: medio, valor: custoTotal,
      medio_depois: custoMedio(d.produto, d.armazem),
      data: d.data || U.hoje(), lancado_em: U.hoje(),
      motivo: d.motivo || 'Consumo',
      observacao: d.observacao || '',
      paciente: pacientes.length === 1 ? pacientes[0] : (d.paciente || ''),
      pacientes: pacientes.length > 1 ? pacientes : [],
      documento: d.documento || '', requisicao: d.requisicao || '',
      origem: d.origem || 'manual', grupo: d.grupo || null, usuario: usuario().nome, usuario_id: (usuario() || {}).id || null
    };
    st.estoqueMov.push(mv);
    return { ok: true, movimento: mv, custo: custoTotal, medio: medio };
  }

  function baixaMultipla(d) {
    d = d || {};
    if (!podeMover('estoque') && !podeMover('procedimentos')) {
      return { erro: 'Seu perfil não movimenta estoque.' };
    }
    const itens = (d.itens || []).filter(function (i) { return i.produto && i.qtd > 0; });
    if (!itens.length) return { erro: 'Informe a quantidade de ao menos um material.' };
    /* A checagem é por PRODUTO somado, não linha a linha: com o mesmo
       produto em duas linhas, cada uma cabia no saldo isolada e as
       duas juntas não — o erro era devolvido depois de parte do
       material já ter saído. */
    const pedidoPorProduto = {};
    itens.forEach(function (i) {
      pedidoPorProduto[i.produto] = Math.round(((pedidoPorProduto[i.produto] || 0) + i.qtd) * 1000) / 1000;
    });
    const erros = [];
    Object.keys(pedidoPorProduto).forEach(function (prod) {
      const disp = saldoEstoque(prod, d.armazem);
      if (pedidoPorProduto[prod] > disp + 0.0001) {
        const p = D.produtos.find(function (x) { return x.id === prod; }) || {};
        erros.push(p.descricao + ' (saldo ' + U.num(disp) + ', pedido ' +
          U.num(pedidoPorProduto[prod]) + ')');
      }
    });
    if (erros.length) return { erro: 'Saldo insuficiente: ' + erros.join('; ') + '.' };
    /* A data era checada item a item, dentro de saida(), e o resultado
       de cada item era descartado: a baixa voltava {ok:true, n:0}, o
       modal fechava com "0 material(is)" e nada era gravado. Erro que
       sai como sucesso é pior que erro. Valida antes, uma vez. */
    const erroData = checarDataMovimento(d.data, d.armazem);
    if (erroData) return { erro: erroData };

    const grupo = novoId('gr');
    let total = 0, n = 0;
    const falhas = [], feitas = [];
    itens.forEach(function (i) {
      const r = saida({ produto: i.produto, armazem: d.armazem, qtd: i.qtd, data: d.data,
        motivo: d.motivo, documento: d.documento, requisicao: d.requisicao,
        observacao: i.observacao || d.observacao, paciente: i.paciente || d.paciente,
        pacientes: i.pacientes || (d.pacientes && d.itens.length === 1 ? d.pacientes : null),
        origem: 'baixa', grupo: grupo });
      if (r.ok) { total += r.custo; n++; feitas.push({ item: i, mov: r }); }
      else falhas.push((D.produtos.find(function (x) { return x.id === i.produto; }) || {}).descricao +
        ': ' + r.erro);
    });
    /* ATÔMICA: um item recusado desfaz os que já saíram. Antes o laço
       parava no erro e deixava metade da baixa gravada — o operador
       lia o erro e acreditava que nada tinha acontecido. */
    if (falhas.length) {
      feitas.forEach(function (f) {
        entrada({ produto: f.item.produto, armazem: d.armazem, qtd: f.item.qtd,
          custo: f.mov.custo && f.item.qtd ? f.mov.custo / f.item.qtd : 0,
          data: d.data, origem: 'estorno-baixa', grupo: grupo,
          motivo: 'Desfeita: a baixa múltipla foi recusada' });
      });
      return { erro: falhas.join('; '), desfeitas: feitas.length };
    }
    total = Math.round(total * 100) / 100;
    logar('estoque', grupo, 'baixa de material', n + ' item(ns) · ' + U.brl(total) + ' · ' +
      (D.armazem(d.armazem) || {}).nome + (d.requisicao ? ' · req ' + d.requisicao : ''));
    return { ok: true, n: n, valor: total, grupo: grupo };
  }

  /* Transferência: sai da origem pelo médio de lá e entra no destino
     com esse custo, que se mistura à média do destino. */
  function transferir(d) {
    d = d || {};
    if (!podeMover('estoque') && !podeMover('procedimentos')) {
      return { erro: 'Seu perfil não movimenta estoque.' };
    }
    if (!d.origem || !d.destino) return { erro: 'Informe os armazéns de origem e destino.' };
    if (d.origem === d.destino) return { erro: 'Origem e destino são o mesmo armazém.' };
    const itens = (d.itens || []).filter(function (i) { return i.produto && i.qtd > 0; });
    if (!itens.length) return { erro: 'Informe o que transferir.' };
    /* Data inválida pra QUALQUER um dos dois lados barra tudo, antes de
       mexer em qualquer saldo. Checar só a origem (como era antes)
       deixava a saída acontecer e travar na entrada do destino — que
       tem seu próprio "último inventário" e pode recusar uma data que
       a origem aceitou. Sem essa entrada, o material some: saiu de um
       lado e não chegou no outro. */
    const erroDataOrigem = checarDataMovimento(d.data, d.origem);
    if (erroDataOrigem) return { erro: erroDataOrigem };
    const erroDataDestino = checarDataMovimento(d.data, d.destino);
    if (erroDataDestino) return { erro: erroDataDestino };
    const erros = [];
    itens.forEach(function (i) {
      const disp = saldoEstoque(i.produto, d.origem);
      if (i.qtd > disp + 0.0001) {
        const p = D.produtos.find(function (x) { return x.id === i.produto; }) || {};
        erros.push(p.descricao + ' (saldo ' + U.num(disp) + ')');
      }
    });
    if (erros.length) return { erro: 'Saldo insuficiente na origem: ' + erros.join('; ') + '.' };

    const grupo = novoId('gr');
    let n = 0, total = 0;
    const falhas = [];
    itens.forEach(function (i) {
      const r = saida({ produto: i.produto, armazem: d.origem, qtd: i.qtd, data: d.data,
        motivo: 'Transferência para ' + (D.armazem(d.destino) || {}).nome,
        documento: d.documento, origem: 'transferencia', grupo: grupo });
      if (!r.ok) { falhas.push(r.erro); return; }
      /* O destino recebe o VALOR que de fato saiu da origem, não
         qtd × custo médio arredondado: quando a divisão não fecha em
         centavos, os dois lados divergiam e o total do grupo mudava
         numa operação que não é compra nem consumo. */
      const custoUnitTransf = i.qtd > 0 ? r.custo / i.qtd : r.medio;
      const r2 = entrada({ produto: i.produto, armazem: d.destino, qtd: i.qtd,
        custo: custoUnitTransf, valor_total: r.custo,
        data: d.data, origem: 'transferencia', grupo: grupo, documento: d.documento,
        motivo: 'Transferência de ' + (D.armazem(d.origem) || {}).nome });
      if (!r2.ok) {
        /* A saída já aconteceu — desfaz devolvendo a mesma quantidade
           na origem, pelo mesmo custo que tinha saído, em vez de deixar
           o material sumido entre os dois armazéns. */
        entrada({ produto: i.produto, armazem: d.origem, qtd: i.qtd, custo: r.medio,
          data: d.data, origem: 'transferencia', grupo: grupo, documento: d.documento,
          motivo: 'Estorno de transferência — entrada no destino falhou: ' + r2.erro });
        falhas.push((D.produtos.find(function (x) { return x.id === i.produto; }) || {}).descricao +
          ': ' + r2.erro);
        return;
      }
      n++; total += r.custo;
    });
    if (n === 0) return { erro: falhas.length ? falhas.join('; ') : 'Nenhum item foi transferido.' };
    logar('estoque', grupo, 'transferência de material', n + ' item(ns) · ' +
      U.brl(Math.round(total * 100) / 100) + ' · ' + (D.armazem(d.origem) || {}).nome +
      ' → ' + (D.armazem(d.destino) || {}).nome +
      (falhas.length ? ' · ' + falhas.length + ' item(ns) não transferido(s): ' + falhas.join('; ') : ''));
    return { ok: true, n: n, valor: Math.round(total * 100) / 100, falhas: falhas };
  }

  function entradaLote(d) {
    d = d || {};
    /* Com pedido na mão e custo não informado, o custo vem do STORE
       (`custoDeAquisicao`, com o frete rateado), não do que a tela
       sugerir: o rateio existia só nos dois modais, e qualquer
       entrada por outro caminho gravava o que quisesse. */
    if (d && d.pedido_id) {
      const ped = st.compras.find(function (x) { return x.id === d.pedido_id; });
      if (ped) {
        (d.itens || []).forEach(function (i) {
          if (i.custo !== undefined && i.custo !== null && i.custo !== '') return;
          const item = (ped.itens || []).find(function (x) { return x.produto === i.produto; });
          if (!item) return;
          const p = D.produtos.find(function (x) { return x.id === i.produto; });
          i.custo = custoDeAquisicao(item, p);
        });
      }
    }
    if (!pode('receber') && !pode('estoque')) return { erro: 'Seu perfil não dá entrada de material.' };
    if (!D.armazem(d.armazem)) return { erro: 'Escolha o armazém.' };
    const itens = (d.itens || []).filter(function (i) { return i.produto && i.qtd > 0; });
    if (!itens.length) return { erro: 'Informe ao menos um material com quantidade.' };
    /* Entrada acima do pedido é recusada ANTES de mexer no estoque:
       antes o estoque subia 40 e o pedido fechava 4/4, cada um com uma
       verdade diferente. */
    if (d.pedido_id) {
      const divergencias = conferirContraPedido(d.pedido_id, itens);
      if (divergencias && !d.forcar_divergencia) {
        return { erro: 'A entrada não bate com o pedido: ' + divergencias.join(' · ') +
          '. Se a nota veio assim mesmo, confirme a divergência; se chegou material a mais, ' +
          'desvincule o pedido e dê entrada como avulsa (o excedente não é do pedido).',
          divergencias: divergencias };
      }
      /* Divergência confirmada fica no histórico do pedido: quem
         aprovou um valor precisa poder ver que a nota veio outro. */
      if (divergencias && d.forcar_divergencia) {
        if (!d.motivo_divergencia) {
          return { erro: 'Diga por que a entrada diverge do pedido.', divergencias: divergencias };
        }
        const ped = st.compras.find(function (x) { return x.id === d.pedido_id; });
        if (ped) {
          ped.historico = ped.historico || [];
          ped.historico.push({ status: ped.status, data: U.hoje(), usuario: usuario().nome,
            obs: 'entrada com divergência: ' + divergencias.join(' · ') + ' — ' + d.motivo_divergencia });
        }
        logar('compra', d.pedido_id, 'entrada com divergência confirmada',
          divergencias.join(' · ') + ' — ' + d.motivo_divergencia);
      }
    }
    const grupo = novoId('gr');
    let n = 0, total = 0;
    const erros = [], entraram = [];
    itens.forEach(function (i) {
      const r = entrada({
        produto: i.produto, armazem: d.armazem, qtd: i.qtd, custo: i.custo,
        /* O frete da linha segue para o custo do estoque. */
        frete: i.frete,
        /* Quantas unidades vêm em cada embalagem da nota: o estoque é
           controlado em unidades, que é como a cirurgia consome. */
        unidades_por_embalagem: i.un_emb || i.unidades_por_embalagem || 1,
        data: d.data, data_nf: d.data_nf || null, lote: i.lote, validade: i.validade,
        origem: d.origem || 'manual', documento: d.documento, motivo: d.motivo,
        nota_chave: d.nota_chave, pedido_id: d.pedido_id, grupo: grupo
      });
      if (r.ok) { n++; total += i.qtd * (i.custo || 0); entraram.push(i); }
      else erros.push(r.erro);
    });
    /* ATÔMICO sempre, não só quando há pedido: a conferência prévia
       que a v22 ganhou só existe com `pedido_id`. Sem pedido, o laço
       gravava item a item e saía no erro deixando metade dentro — e
       como a tela não fecha, o operador corrigia e clicava de novo,
       duplicando o que já tinha entrado. */
    if (erros.length && entraram.length) {
      entraram.forEach(function (i) {
        saida({ produto: i.produto, armazem: d.armazem, qtd: i.qtd, data: d.data,
          origem: 'estorno-entrada', grupo: grupo,
          motivo: 'Desfeita: a entrada do lote foi recusada' });
      });
      return { erro: erros.join('; '), desfeitas: entraram.length, n: 0 };
    }
    if (n === 0) return { erro: erros.length ? erros.join('; ') : 'Nenhum item deu entrada.' };
    /* Só os itens que ENTRARAM baixam o pedido: passando a lista
       bruta, um item recusado era dado por recebido e o pedido
       fechava como completo — material que nunca chegou, liberado
       para cobrança. */
    if (d.pedido_id) baixarPedido(d.pedido_id, entraram, d);
    logar('estoque', grupo, d.origem === 'inventario' ? 'inventário inicial' : 'entrada de material',
      n + ' item(ns) · ' + U.brl(Math.round(total * 100) / 100) + ' · ' + (D.armazem(d.armazem) || {}).nome +
      (d.documento ? ' · ' + d.documento : ''));
    /* Entrada PARCIALMENTE recusada não é sucesso: as telas testam
       `res.erro`, que vinha vazio, e o operador lia "entrada
       registrada" com metade dos itens fora. */
    return { ok: !erros.length, n: n, valor: Math.round(total * 100) / 100,
      erro: erros.length ? erros.join('; ') : undefined,
      parcial: !!erros.length, erros: erros, grupo: grupo };
  }

  /* ── estorno de movimento ───────────────────────────────
     Corrigir um erro de baixa ou de transferência exigia uma entrada
     manual com o custo digitado — e o paciente ficava registrado num
     consumo que não aconteceu. O estorno desfaz pelo MESMO custo, marca
     os dois lados e some do consumo por paciente. */
  /* Custo de aquisição de um item de pedido: preço cotado mais a
     parte do frete que cabe em CADA unidade. O rateio é pela
     quantidade TOTAL do item, não pelo que falta receber — antes a
     fórmula usava `frete / falta` em dois arquivos de UI, e um pedido
     de 10 unidades com R$ 100 de frete recebido em duas parcelas de 5
     cobrava o frete duas vezes: R$ 650 no estoque em vez de R$ 600.
     Em três parciais o frete quase dobrava.

     Mora no store de propósito: a mesma conta vale para o recebimento
     de pedido e para a entrada por XML. */
  /* RATEIO DAS DESPESAS DA NOTA entre os itens.

     Frete, seguro e outras despesas vêm no total da nota, não por
     item — e sem rateá-las o custo do estoque fica abaixo do que a
     empresa pagou de verdade. O efeito aparece longe: o custo do
     material na cirurgia sai menor, a margem do projeto parece
     melhor do que é, e a diferença só aparece no fechamento.

     Dois critérios, porque nenhum serve sempre:

     `quantidade` — cada unidade carrega a mesma fatia. É o certo
     quando o frete depende de volume ou peso parecido entre os
     itens, que é o caso da maior parte do material hospitalar.

     `valor` — cada item carrega proporcional ao que custa. É o
     certo quando a nota mistura coisas de preço muito diferente:
     ratear por quantidade faria a gaze barata carregar o mesmo
     frete que o equipamento caro.

     Devolve os itens com `frete` preenchido por linha, que é o
     formato que `entrada()` já entende. O resto do sistema não
     precisa saber que houve rateio. */
  /* CADASTRO RÁPIDO DE MATERIAL, usado pela requisição de compra.

     Mora aqui, e não na tela, por dois motivos: a permissão é
     verificada no mesmo lugar que todo o resto, e o material nasce
     com os mesmos campos de um cadastro completo — só sem os que
     dependem de quem controla o estoque.

     `minimo` e `ideal` nascem ZERADOS de propósito, não em branco:
     zero significa "ninguém definiu ainda" e não dispara alerta de
     reposição. Um mínimo inventado por quem está com pressa faria
     o sistema pedir compra de material que não falta. */
  /* MATERIAIS PADRÃO de um procedimento.

     Toda facoemulsificação usa uma lente. Fazer quem lança escolher
     isso do zero a cada cirurgia é pedir esquecimento — e material
     esquecido não é custo que some: é custo que aparece no
     inventário seguinte como diferença sem explicação.

     Entra como sugestão já marcada; quem lança ajusta ou tira.

     Quando o padrão aponta uma FAMÍLIA em vez de um produto, a
     tela pede o item específico: a tabela sabe que vai uma lente,
     não sabe qual grau — e nem deveria. */
  function materiaisPadraoDe(procedimento) {
    const lista = (st.materiaisPadrao || []).filter(function (m) {
      return m.procedimento === procedimento;
    });
    return lista.map(function (m) {
      const familia = m.familia || null;
      /* Da família saem as opções; o produto exato fica em aberto
         para quem lança escolher. */
      const opcoes = familia
        ? D.produtos.filter(function (p) { return p.ativo && p.familia === familia; })
        : [];
      return {
        id: m.id,
        produto: m.produto || null,
        familia: familia,
        opcoes: opcoes,
        qtd: Number(m.qtd) || 1,
        obrigatorio: m.obrigatorio !== false,
        observacao: m.observacao || ''
      };
    });
  }

  function salvarMaterialPadrao(d) {
    if (!podeMover('cadastros')) return { erro: 'Seu perfil não define material padrão.' };
    if (!d || !d.procedimento) return { erro: 'Escolha o procedimento.' };
    if (!d.produto && !d.familia) {
      return { erro: 'Escolha o material ou a família — sem um dos dois, a linha não diz o que usar.' };
    }
    st.materiaisPadrao = st.materiaisPadrao || [];
    const reg = {
      id: d.id || ('mp' + novoId('mp').replace(/\D/g, '')),
      procedimento: d.procedimento,
      produto: d.produto || null,
      familia: d.familia || null,
      qtd: Number(d.qtd) || 1,
      obrigatorio: d.obrigatorio !== false,
      observacao: d.observacao || ''
    };
    const ix = st.materiaisPadrao.findIndex(function (m) { return m.id === reg.id; });
    if (ix >= 0) st.materiaisPadrao[ix] = reg; else st.materiaisPadrao.push(reg);
    logar('procedimento', reg.procedimento, 'definiu material padrão',
      (reg.familia || reg.produto) + ' · ' + U.num(reg.qtd));
    return { ok: true, padrao: reg };
  }

  /* ESTOQUE AGRUPADO POR FAMÍLIA.

     Cento e vinte lentes em vinte graus diferentes são vinte linhas
     na tela, e nenhuma responde "quantas lentes eu tenho". A
     família responde — e, ao abrir, mostra os graus.

     Os ZERADOS aparecem de propósito: saber que o grau +21,0 acabou
     é mais útil que não ver a linha. Material que já esteve em
     estoque e zerou é justamente o que precisa de reposição. */
  function estoquePorFamilia(armazem) {
    const grupos = {};
    D.produtos.forEach(function (p) {
      if (!p.ativo && !p.familia) return;
      const chave = p.familia || ('__' + p.id);
      /* Sem armazém informado, soma todos: é a visão "quantas lentes
         a empresa tem", independente de onde estejam. */
      const saldo = armazem
        ? saldoEstoque(p.id, armazem)
        : D.armazens.reduce(function (t, am) { return t + saldoEstoque(p.id, am.id); }, 0);
      /* Já teve movimento? É o que separa "acabou" de "nunca
         existiu" — e só o primeiro interessa na lista. */
      const jaTeve = (st.estoqueMov || []).some(function (m) {
        return m.produto === p.id && (!armazem || m.armazem === armazem);
      });
      if (!saldo && !jaTeve) return;

      if (!grupos[chave]) {
        grupos[chave] = {
          familia: p.familia || null,
          nome: p.familia || p.descricao,
          unidade: p.unidade || 'UN',
          total: 0, valor: 0, itens: [], zerados: 0
        };
      }
      const g = grupos[chave];
      /* Sem armazém informado, o custo é a MÉDIA PONDERADA entre os
         armazéns, não o custo de cadastro: material novo nasce com
         custo zero no cadastro, e usar esse número fazia a coluna
         de valor mostrar R$ 0,00 para estoque que vale dezenas de
         milhares. */
      let medio;
      if (armazem) {
        medio = custoMedio(p.id, armazem);
      } else {
        let q = 0, v = 0;
        D.armazens.forEach(function (am) {
          const sa = saldoEstoque(p.id, am.id);
          if (sa > 0) { q += sa; v += sa * custoMedio(p.id, am.id); }
        });
        medio = q > 0 ? v / q : (p.custo || 0);
      }
      g.total += saldo;
      g.valor += Math.round(saldo * medio * 100) / 100;
      if (!saldo) g.zerados++;
      g.itens.push({ produto: p.id, descricao: p.descricao, codigo: p.codigo,
        saldo: saldo, medio: medio, ja_teve: jaTeve });
    });

    return Object.keys(grupos).map(function (k) {
      const g = grupos[k];
      g.itens.sort(function (a, b) {
        /* Com saldo primeiro; dentro de cada grupo, pela descrição —
           que nas lentes é o próprio grau, então sai em ordem. */
        if ((a.saldo > 0) !== (b.saldo > 0)) return a.saldo > 0 ? -1 : 1;
        return (a.descricao || '').localeCompare(b.descricao || '', 'pt-BR', { numeric: true });
      });
      g.valor = Math.round(g.valor * 100) / 100;
      return g;
    }).sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
  }

  /* Exposto para a tela de cadastro completo usar o MESMO gerador:
     dois caminhos criando id de jeitos diferentes é como nascem ids
     repetidos. */
  function proximoIdProduto() { return novoId('pr'); }
  function proximoIdCredor() { return novoId('cr'); }
  /* Gerador único de id para as telas de cadastro. Cada uma usava
     `Date.now()`, que repete quando dois cadastros caem no mesmo
     milissegundo — e dois registros com o mesmo id significam
     saldo, título e movimento indo para o lugar errado. */
  function proximoId(prefixo) { return novoId(prefixo); }

  /* COMPLETA O CADASTRO do material com o que a nota traz.

     Material cadastrado às pressas numa requisição nasce sem NCM.
     A nota fiscal tem esse dado — e a entrada é o momento certo de
     aproveitá-lo: o material está na mão, a nota está aberta, e
     ninguém precisa procurar depois.

     Só preenche o que está VAZIO: o que alguém já informou tem
     precedência sobre o que veio do XML, porque a nota do
     fornecedor às vezes classifica diferente do que a empresa usa. */
  function completarCadastroPelaNota(produtoId, dadosNota) {
    const p = D.produtos.find(function (x) { return x.id === produtoId; });
    if (!p || !dadosNota) return { ok: false };
    const campos = ['ncm', 'cest', 'unidade'];
    const preenchidos = [];
    campos.forEach(function (c) {
      const valor = String(dadosNota[c] || '').trim();
      if (valor && !String(p[c] || '').trim()) {
        p[c] = c === 'unidade' ? valor.toUpperCase() : valor;
        preenchidos.push(c);
      }
    });
    /* O material deixa de ser "cadastro rápido" quando ganha o que
       faltava: é o sinal de que não precisa mais de revisão. */
    if (p.cadastro_rapido && p.ncm) delete p.cadastro_rapido;
    if (preenchidos.length) {
      logar('produto', p.id, 'completou cadastro pela nota',
        p.codigo + ' · ' + preenchidos.join(', '));
    }
    return { ok: true, preenchidos: preenchidos };
  }

  /* Quais materiais da entrada ainda estão sem NCM. A entrada não
     é bloqueada por isso — travar a chegada da mercadoria por um
     campo fiscal faria o material ficar fora do sistema, que é
     pior. Mas quem dá entrada precisa ver a lista. */
  function materiaisSemNCM(itens) {
    return (itens || []).map(function (i) {
      const p = D.produtos.find(function (x) { return x.id === i.produto; });
      return p && !String(p.ncm || '').trim() ? p : null;
    }).filter(Boolean);
  }

  function cadastrarMaterial(d) {
    /* Quem movimenta ESTOQUE também cadastra material: a nota chega
       com item que não existe no sistema, e sem poder cadastrar a
       entrada inteira trava. Era por isso que o cadastro em lote
       não fazia nada para o perfil de Compras — a verificação
       recusava calado, e o botão parecia quebrado.

       O caminho individual da tela já permitia isso há tempos,
       gravando direto; a diferença entre os dois é que criava a
       confusão. */
    if (!podeMover('cadastros') && !podeMover('estoque') && !podeMover('compras')) {
      return { erro: 'Seu perfil não cadastra material.' };
    }
    const desc = String((d && d.descricao) || '').trim();
    if (!desc) return { erro: 'Informe a descrição do material.' };

    const igual = D.produtos.find(function (p) {
      return (p.descricao || '').trim().toLowerCase() === desc.toLowerCase();
    });
    if (igual) {
      return { erro: 'Já existe o material ' + igual.codigo + ' · ' + igual.descricao + '.' };
    }

    /* O código segue o maior número já usado, não a contagem: com a
       contagem, apagar um material faria o próximo repetir código de
       outro. */
    let maior = 0;
    D.produtos.forEach(function (p) {
      const n = parseInt(String(p.codigo || '').replace(/\D/g, ''), 10);
      if (isFinite(n) && n > maior) maior = n;
    });
    const produto = {
      /* O id segue a SEQUÊNCIA do sistema, não o relógio: dois
         cadastros no mesmo milissegundo — o que acontece ao
         cadastrar vários materiais seguidos — recebiam o mesmo id,
         e aí as entradas de um iam para o saldo do outro. */
      id: novoId('pr'),
      codigo: String((d.codigo || '')).trim() || ('MT-' + String(maior + 1).padStart(3, '0')),
      descricao: desc,
      unidade: String(d.unidade || 'UN').trim().toUpperCase(),
      ncm: d.ncm || '',
      minimo: 0, ideal: 0,
      custo: 0,
      conta: d.conta || '',
      ativo: true,
      /* Marca de onde veio: quem for completar o cadastro depois
         precisa saber quais entraram pela pressa de uma requisição. */
      cadastro_rapido: true
    };
    D.produtos.push(produto);
    logar('produto', produto.id, 'cadastrou material pela requisição',
      produto.codigo + ' · ' + produto.descricao);
    return { ok: true, produto: produto };
  }

  function ratearDespesasNota(itens, despesas, criterio) {
    const lista = (itens || []).filter(function (i) { return (Number(i.qtd) || 0) > 0; });
    const total = Math.round((Number(despesas) || 0) * 100) / 100;
    if (!lista.length || !(total > 0)) {
      return { itens: itens || [], rateado: 0, criterio: criterio || 'quantidade' };
    }

    const modo = criterio === 'valor' ? 'valor' : 'quantidade';
    const peso = function (i) {
      return modo === 'valor'
        ? (Number(i.qtd) || 0) * (Number(i.custo) || 0)
        : (Number(i.qtd) || 0);
    };
    const somaPesos = lista.reduce(function (a2, i) { return a2 + peso(i); }, 0);
    /* Nota com tudo a custo zero não tem como ratear por valor —
       cai para quantidade em vez de dividir por zero. */
    if (!(somaPesos > 0)) return ratearDespesasNota(itens, despesas, 'quantidade');

    let distribuido = 0;
    const out = lista.map(function (i, k) {
      let parte;
      if (k === lista.length - 1) {
        /* O último fecha a conta: arredondar item a item deixa
           centavos sobrando, e o total rateado tem de bater com o
           total da nota — é esse número que vai para o financeiro. */
        parte = Math.round((total - distribuido) * 100) / 100;
      } else {
        parte = Math.round(total * (peso(i) / somaPesos) * 100) / 100;
        distribuido = Math.round((distribuido + parte) * 100) / 100;
      }
      return Object.assign({}, i, {
        frete: Math.round(((Number(i.frete) || 0) + parte) * 100) / 100,
        despesa_rateada: parte
      });
    });

    return { itens: out, rateado: total, criterio: modo,
      por_unidade: modo === 'quantidade' ? Math.round(total / somaPesos * 10000) / 10000 : null };
  }

  function custoDeAquisicao(item, produto) {
    if (!item || !item.custo) return (produto && produto.custo) || 0;
    const total = Number(item.qtd) || 0;
    const frete = Number(item.frete) || 0;
    if (!(total > 0)) return Math.round(Number(item.custo) * 10000) / 10000;
    return Math.round((Number(item.custo) + frete / total) * 10000) / 10000;
  }

  /* ── posição de estoque: um caminho só ──────────────────
     (integrado do ramo paralelo de QA) Toda alteração de saldo e valor
     passa por aqui.

     Antes, cada operação mexia direto em `pos.saldo` e `pos.valor`, e
     só a saída tinha o clamp. Dava para o estoque ficar com 90
     unidades valendo R$ 0,00 (toda baixa seguinte lançando custo
     zero), com saldo 0 valendo −R$ 450,00, ou com o valor em `null`
     para sempre depois de uma entrada com custo em texto. Nenhuma
     dessas três é um erro de conta: é a falta de alguém dizendo o que
     uma posição pode ser. */
  /* Mesma regra, sem gravar: serve para conferir os dois lados de uma
     transferência ANTES de mexer em qualquer um deles. */
  /* Resíduo tolerável de arredondamento: o custo médio tem 4 casas e
     nem sempre multiplica de volta ao valor exato. Um centavo por
     operação é ruído de arredondamento; mais que isso é erro de
     conta. Sem esta folga, a guarda de valor negativo — criada para
     fechar o furo do estorno — travava estorno, transferência e
     rollback legítimos. */
  const RESIDUO_CENTAVOS = 0.011;

  function checarPosicao(pos, dSaldo, dValor, contexto) {
    const saldo = Math.round((pos.saldo + dSaldo) * 1000) / 1000;
    const valor = Math.round((pos.valor + dValor) * 100) / 100;
    const onde = contexto || 'Movimento de estoque';
    if (!isFinite(saldo) || !isFinite(valor)) {
      return onde + ': valor inválido — o estoque ficaria sem número.';
    }
    if (saldo < -0.0001) return onde + ': o saldo ficaria negativo (' + U.num(saldo) + ').';
    /* A tolerância vale na COMPARAÇÃO, e vale mais quando a operação
       zera o saldo — aí o resíduo é inteiro e o valor correto é zero.
       Valor realmente negativo (erro de conta) continua barrado. */
    const zera = saldo <= 0.0001;
    const limite = zera ? Math.max(RESIDUO_CENTAVOS, Math.abs(pos.valor) + RESIDUO_CENTAVOS)
      : RESIDUO_CENTAVOS;
    if (valor < -limite) {
      return onde + ': o valor do estoque ficaria negativo (' + U.brl(valor) +
        '). Confira o custo do movimento que está sendo desfeito.';
    }
    return null;
  }


  function aplicarPosicao(pos, dSaldo, dValor, contexto) {
    const saldo = Math.round((pos.saldo + dSaldo) * 1000) / 1000;
    const valor = Math.round((pos.valor + dValor) * 100) / 100;
    const erroChk = checarPosicao(pos, dSaldo, dValor, contexto);
    if (erroChk) return { erro: erroChk };
    pos.saldo = saldo <= 0.0001 ? 0 : saldo;
    /* Saldo zerado é valor zerado: sobra de centavo num saldo zero
       vira custo médio absurdo na entrada seguinte. */
    pos.valor = pos.saldo === 0 ? 0 : Math.max(0, valor);
    return { ok: true };
  }

  /* ── ajuste de inventário ───────────────────────────────
     Contagem física vira AJUSTE, não entrada. A tela de inventário
     chamava `entradaLote`, então contar 500 num armazém que já tinha
     40 deixava 540 — e recontar 500 deixava 1.040. Nunca era possível
     ajustar para baixo, e recontar duplicava em silêncio, numa tela
     que diz "informe a quantidade que já está no armazém".

     Agora compara com o saldo e lança só a DIFERENÇA, pelo custo médio
     vigente: sobra vira entrada, falta vira saída com motivo de
     ajuste. O item contado igual ao sistema não gera movimento. */
  function ajusteInventario(armazem, itens, d) {
    d = d || {};
    if (!podeMover('estoque')) return { erro: 'Seu perfil não movimenta estoque.' };
    if (!D.armazem(armazem)) return { erro: 'Informe o armazém.' };
    const lista = (itens || []).filter(function (i) {
      return i.produto && i.qtd !== undefined && i.qtd !== null && i.qtd !== '';
    });
    if (!lista.length) return { erro: 'Informe ao menos um material contado.' };
    if (!d.motivo) return { erro: 'Diga o motivo do ajuste (contagem, quebra, perda).' };
    const data = d.data || U.hoje();
    const erroData = checarDataMovimento(data, armazem);
    if (erroData) return { erro: erroData };

    /* Confere tudo antes de mexer em qualquer saldo. */
    const plano = [];
    for (let i = 0; i < lista.length; i++) {
      const it = lista[i];
      const pr = D.produtos.find(function (x) { return x.id === it.produto; });
      if (!pr) return { erro: 'Produto não encontrado: ' + it.produto };
      const contado = Math.round(Number(it.qtd) * 1000) / 1000;
      if (!isFinite(contado) || contado < 0) {
        return { erro: pr.descricao + ': quantidade contada inválida.' };
      }
      const atual = saldoEstoque(it.produto, armazem);
      const dif = Math.round((contado - atual) * 1000) / 1000;
      if (Math.abs(dif) < 0.0001) continue;
      /* O CUSTO DA CONTAGEM VEM DO HISTÓRICO, não de quem conta.
         Inventário é contagem física; preço entra por nota ou
         pedido de compra. Se o material já tem custo médio, ele
         manda — mesmo que a tela envie outro valor.

         Só quando não há histórico nenhum é que o valor informado
         vale: é o primeiro inventário de um produto novo, e aí não
         há de onde puxar. Sem histórico e sem valor, o lançamento
         para e diz o que falta, em vez de gravar material a custo
         zero (que some do balanço e some do custo da cirurgia). */
      const medioAtual = custoMedio(it.produto, armazem);
      const informado = it.custo === undefined || it.custo === null || it.custo === ''
        ? null : numeroBR(it.custo);
      const custoLinha = medioAtual > 0 ? medioAtual : (informado !== null ? informado : 0);
      if (medioAtual <= 0 && (informado === null || informado <= 0) && dif > 0) {
        return { erro: pr.descricao + ': material sem entrada anterior, então o custo não tem ' +
          'de onde vir. Informe o custo unitário nesta linha, ou dê entrada por nota/pedido antes.' };
      }
      if (!isFinite(custoLinha) || custoLinha < 0) {
        return { erro: pr.descricao + ': custo inválido (' + it.custo + ').' };
      }
      plano.push({ produto: it.produto, descricao: pr.descricao, atual: atual,
        contado: contado, diferenca: dif,
        /* O MESMO `custoLinha` calculado acima, não um segundo
           cálculo. Havia dois, e o de baixo não conhecia a regra do
           histórico: a contagem acabava passando o custo digitado
           mesmo quando o material já tinha custo médio. Uma conta
           só, feita uma vez. */
        custo: custoLinha });
    }
    if (!plano.length) {
      return { ok: true, n: 0, ajustes: [], aviso: 'A contagem bate com o sistema: nada a ajustar.' };
    }

    const grupo = novoId('gi');
    const feitos = [];
    plano.forEach(function (x) {
      const r = x.diferenca > 0
        ? entrada({ produto: x.produto, armazem: armazem, qtd: x.diferenca, custo: x.custo,
            data: data, origem: 'inventario', grupo: grupo,
            motivo: 'Ajuste de inventário · ' + d.motivo,
            documento: d.documento || '' })
        : saida({ produto: x.produto, armazem: armazem, qtd: -x.diferenca, data: data,
            origem: 'inventario', grupo: grupo,
            motivo: 'Ajuste de inventário · ' + d.motivo,
            observacao: 'Contagem ' + U.num(x.contado) + ' contra ' + U.num(x.atual) + ' no sistema',
            documento: d.documento || '' });
      feitos.push(Object.assign({}, x, { ok: !!r.ok, erro: r.erro || null }));
    });
    const falhas = feitos.filter(function (x) { return !x.ok; });
    const sobra = feitos.filter(function (x) { return x.ok && x.diferenca > 0; });
    const falta = feitos.filter(function (x) { return x.ok && x.diferenca < 0; });
    logar('estoque', grupo, 'ajuste de inventário',
      (D.armazem(armazem) || {}).nome + ' · ' + sobra.length + ' sobra(s), ' +
      falta.length + ' falta(s) · ' + d.motivo);
    return { ok: !falhas.length, n: feitos.length - falhas.length, ajustes: feitos,
      sobras: sobra.length, faltas: falta.length,
      erro: falhas.length ? falhas.map(function (x) {
        return x.descricao + ': ' + x.erro; }).join('; ') : null };
  }

  /* (integrado do ramo paralelo de QA) Estorno de movimento, com os
     dois lados da transferência desfeitos pelo MESMO valor — o que
     atravessou. Antes cada lado era desfeito por um critério (valor
     histórico num, custo médio de hoje no outro) e a transferência
     estornada destruía ou criava valor: 10 un a R$ 1 enviadas para um
     armazém com 100 un a R$ 100 faziam o estoque total cair de
     R$ 10.010 para R$ 9.110, e o custo médio do destino despencar de
     R$ 100 para R$ 91, barateando toda baixa seguinte. */
  function estornarMovimento(movId, motivo) {
    if (!pode('estoque')) return { erro: 'Seu perfil não movimenta estoque.' };
    if (!motivo) return { erro: 'Informe o motivo do estorno.' };
    const m = st.estoqueMov.find(function (x) { return x.id === movId; });
    if (!m) return { erro: 'Movimento não encontrado.' };
    if (m.estornado) return { erro: 'Este movimento já foi estornado.' };
    if (m.estorno_de) return { erro: 'Um estorno não se estorna — lance o movimento de novo.' };
    if (['saida', 'entrada', 'transferencia_saida', 'transferencia_entrada'].indexOf(m.tipo) < 0) {
      return { erro: 'Só dá pra estornar entrada, saída e transferência.' };
    }
    const pos = posicao(m.produto, m.armazem);
    const volta = m.tipo === 'saida' || m.tipo === 'transferencia_saida';
    if (!volta && pos.saldo < m.qtd - 0.0001) {
      return { erro: 'Não há saldo suficiente pra estornar esta entrada (saldo ' + U.num(pos.saldo) + ').' };
    }
    /* Transferência é um movimento só, em dois lados. Antes o estorno
       mexia num lado, tentava o outro e, se o destino já tinha
       consumido o material, parava no meio: a origem ganhava o saldo
       de volta e o sistema CRIAVA material do nada. Agora os dois
       lados são conferidos ANTES de qualquer alteração. */
    const par = (m.origem === 'transferencia' && m.grupo)
      ? st.estoqueMov.find(function (x) {
          return x.grupo === m.grupo && x.produto === m.produto && x.id !== m.id && !x.estornado && !x.estorno_de;
        })
      : null;
    if (par) {
      const voltaPar = par.tipo === 'saida' || par.tipo === 'transferencia_saida';
      const posPar = posicao(par.produto, par.armazem);
      if (!voltaPar && posPar.saldo < par.qtd - 0.0001) {
        return { erro: 'O material já saiu de ' + ((D.armazem(par.armazem) || {}).nome || '') +
          ' (saldo ' + U.num(posPar.saldo) + ' de ' + U.num(par.qtd) + '). Estornar só a outra ponta criaria ' +
          'material que não existe — estorne antes as saídas do destino.' };
      }
    }
    /* O valor que sai no estorno de uma ENTRADA DE NOTA é o custo
       médio de hoje, não o valor histórico da nota.

       Subtrair o valor da nota de uma posição cujo valor já foi
       reduzido por saídas ao custo médio zerava o estoque: duas
       entradas (100 a R$1 e 10 a R$100), uma saída de 10 e o estorno
       da segunda deixavam 90 unidades valendo R$ 0,00, e toda baixa
       seguinte lançava custo zero no projeto. Material que sai do
       estoque sai pelo médio — e o estorno de uma entrada é material
       saindo.

       A TRANSFERÊNCIA é a exceção, e era onde a regra se voltava
       contra o estoque: ela é um movimento só em dois lados, e os dois
       têm de ser desfeitos pelo MESMO valor — o que atravessou. Com o
       médio de hoje num lado e o valor histórico no outro, desfazer
       uma transferência criava ou destruía valor sem nenhum movimento
       físico: 10 un a R$ 1 transferidas para um armazém com 100 un a
       R$ 100 voltavam valendo R$ 10 na origem e tiravam R$ 910 do
       destino — R$ 900 de estoque destruídos, e o médio do destino
       caindo de R$ 100 para R$ 91, o que barateava toda baixa
       seguinte. Invertendo os custos, o estorno criava valor.

       Os dois lados também passaram a ser conferidos e gravados
       juntos: antes o primeiro lado já estava aplicado e marcado como
       estornado quando a recursão tentava o segundo, e a falha do
       segundo devolvia erro com metade gravada. */
    const lados = [m].concat(par ? [par] : []);
    const planos = lados.map(function (mv) {
      const posL = posicao(mv.produto, mv.armazem);
      const voltaL = mv.tipo === 'saida' || mv.tipo === 'transferencia_saida';
      const medioL = custoMedio(mv.produto, mv.armazem);
      /* Lado de transferência: o valor que atravessou, gravado no
         próprio movimento, nos dois sentidos. */
      const valorL = (par || mv.origem === 'transferencia')
        ? Math.round((mv.valor || 0) * 100) / 100
        : (voltaL ? Math.round((mv.valor || 0) * 100) / 100
                  : Math.round(mv.qtd * medioL * 100) / 100);
      return { mv: mv, pos: posL, volta: voltaL, medio: medioL, valor: valorL,
               dSaldo: voltaL ? mv.qtd : -mv.qtd, dValor: voltaL ? valorL : -valorL };
    });
    /* Confere TODOS antes de aplicar QUALQUER um. */
    for (let i = 0; i < planos.length; i++) {
      const pl = planos[i];
      const erroChk = checarPosicao(pl.pos, pl.dSaldo, pl.dValor,
        'Estorno de ' + pl.mv.tipo + ' em ' + ((D.armazem(pl.mv.armazem) || {}).nome || pl.mv.armazem));
      if (erroChk) return { erro: erroChk };
    }
    const inversos = [];
    planos.forEach(function (pl) {
      aplicarPosicao(pl.pos, pl.dSaldo, pl.dValor, 'Estorno de ' + pl.mv.tipo);
      const invL = {
        id: novoId('mv'), tipo: pl.volta ? 'entrada' : 'saida', estorno_de: pl.mv.id,
        produto: pl.mv.produto, armazem: pl.mv.armazem, qtd: pl.mv.qtd,
        custo: pl.mv.qtd ? Math.round(pl.valor / pl.mv.qtd * 10000) / 10000 : 0,
        valor: pl.valor,
        medio_depois: custoMedio(pl.mv.produto, pl.mv.armazem),
        data: U.hoje(), lancado_em: U.hoje(),
        motivo: 'Estorno de ' + (pl.mv.motivo || pl.mv.tipo) + ' · ' + motivo,
        observacao: motivo, documento: pl.mv.documento || '', requisicao: pl.mv.requisicao || '',
        /* o estorno NÃO repete os pacientes: o consumo deixou de existir,
           e repetir os nomes contaria o material duas vezes no relatório */
        paciente: '', pacientes: [],
        grupo: pl.mv.grupo || null, origem: pl.mv.origem || 'manual',
        /* O estorno é um movimento como outro qualquer: nasce não
           estornado. Quem foi estornado é o movimento ORIGINAL. */
        estornado: false,
        usuario: usuario().nome, em: new Date()
      };
      st.estoqueMov.push(invL);
      inversos.push(invL);
      pl.mv.estornado = true;
      pl.mv.estornado_por = usuario().nome;
      pl.mv.estornado_em = U.hoje();
      pl.mv.motivo_estorno = motivo;
    });
    const inv = inversos[0];
    logar('estoque', m.id, 'estornou movimento',
      (D.produtos.find(function (x) { return x.id === m.produto; }) || {}).descricao + ' · ' +
      U.num(m.qtd) + ' · ' + motivo + (par ? ' · os dois lados da transferência' : ''));
    return { ok: true, movimento: inv, lados: inversos.length };
  }

  /* Entrada vinculada a pedido fecha o ciclo: atualiza o recebido de
     cada item e guarda a nota que veio junto. */
  /* Conferência da quantidade ANTES de dar entrada: receber 40 num
     pedido de 4 deixava estoque e pedido discordando (o estoque subia
     40, o pedido fechava 4/4). Agora a entrada é recusada, dizendo o
     que falta receber — quem realmente recebeu a mais desvincula o
     pedido e lança como entrada avulsa, que é o que aconteceu de fato. */
  function conferirContraPedido(pedidoId, itens) {
    const r = st.compras.find(function (x) { return x.id === pedidoId; });
    if (!r) return null;
    const erros = [];
    (itens || []).forEach(function (i) {
      const item = (r.itens || []).find(function (x) { return x.produto === i.produto; });
      const p = D.produtos.find(function (x) { return x.id === i.produto; }) || {};
      if (!item) {
        erros.push((p.descricao || 'material') + ' não está no pedido ' + r.numero);
        return;
      }
      const falta = Math.round((item.qtd - (item.recebido || 0)) * 1000) / 1000;
      if (i.qtd > falta + 0.0001) {
        erros.push((p.descricao || 'material') + ': faltam ' + U.num(falta) + ' ' + (p.unidade || '') +
          ' do pedido e você está dando entrada de ' + U.num(i.qtd));
      }
      /* A conferência olhava só a QUANTIDADE: material cotado a R$ 50
         entrava a R$ 999 e o pedido fechava como recebido, com custo
         médio dez vezes o aprovado. O valor divergente passa a pedir
         a mesma confirmação que a quantidade. */
      /* Compara GRANDEZAS IGUAIS: o esperado inclui o frete rateado,
         então o informado também tem de incluí-lo. Comparar contra o
         custo cru da nota recusava a entrada que trazia exatamente a
         cotação aprovada — e não havia botão para destravar. */
      const unitEsperado = custoDeAquisicao(item, p);
      if (unitEsperado > 0 && i.custo !== undefined && i.custo !== null && i.custo !== '') {
        /* O frete só é somado quando a ENTRADA o informa à parte: se
           o custo da linha já veio com o frete embutido (é o que a
           tela preenche a partir da cotação), somá-lo de novo
           compararia R$ 70 contra R$ 60. */
        const freteInformado = i.frete !== undefined && i.frete !== null && i.frete !== ''
          ? numeroBR(i.frete) : 0;
        const unitInformado = Math.round((numeroBR(i.custo) +
          (item.qtd > 0 ? freteInformado / item.qtd : 0)) * 10000) / 10000;
        if (isFinite(unitInformado) &&
            Math.abs(unitInformado - unitEsperado) > Math.max(0.02, unitEsperado * 0.01)) {
          erros.push((p.descricao || 'material') + ': cotado a ' + U.brl(unitEsperado) +
            ' (com frete rateado) e entrando a ' + U.brl(unitInformado));
        }
      }
    });
    return erros.length ? erros : null;
  }

  function baixarPedido(pedidoId, itens, d) {
    const r = st.compras.find(function (x) { return x.id === pedidoId; });
    if (!r) return;
    itens.forEach(function (i) {
      const item = r.itens.find(function (x) { return x.produto === i.produto; });
      if (!item) return;
      // a conferência já barrou o excesso; aqui só acumula o recebido
      item.recebido = Math.round(((item.recebido || 0) + i.qtd) * 1000) / 1000;
    });
    r.nota_documento = (d && d.documento) || r.nota_documento || '';
    r.nota_chave = (d && d.nota_chave) || r.nota_chave || null;
    const tudo = r.itens.every(function (i) { return i.recebido >= i.qtd - 0.0001; });
    mudarStatusCompra(pedidoId, tudo ? 'recebido' : 'recebido_parcial', {});
  }

  const textoDoMovimento = function (m) {
    const p = D.produtos.find(function (x) { return x.id === m.produto; }) || {};
    const nomes = vePaciente() ? [m.paciente, (m.pacientes || []).join(' ')] : [];
    return [p.descricao, p.codigo, m.motivo, m.observacao, m.documento, m.requisicao, m.usuario]
      .concat(nomes).filter(Boolean).join(' ').toLowerCase()
      /* busca sem acento: "joao" acha "João" */
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  };

  const movimentos = f => st.estoqueMov.slice().filter(function (m) {
    f = f || {};
    return (!f.produto || m.produto === f.produto) &&
           (!f.armazem || m.armazem === f.armazem) &&
           (!f.tipo || m.tipo === f.tipo) &&
           (!f.grupo || m.grupo === f.grupo) &&
           (!f.de || m.data >= f.de) && (!f.ate || m.data <= f.ate) &&
           /* busca livre: material, paciente, observação, motivo,
              documento e requisição — é por aqui que se responde
              "o que foi usado no paciente fulano?" */
           (!f.busca || textoDoMovimento(m).indexOf(
             String(f.busca).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')) > -1);
  }).sort(function (a, b) {
    return (b.data + b.id).localeCompare(a.data + a.id);
  /* Nome de paciente é dado de saúde: mascarado NA FONTE. A função
     devolvia o nome cru a qualquer chamador, e só funcionava porque
     cada tela lembrava de usar `pacienteVisivel` — `consumoPorPaciente`
     já barrava certo, esta não. */
  }).map(function (m) {
    if (!m.paciente || vePaciente()) return m;
    return Object.assign({}, m, { paciente: '[restrito]' });
  });

  /* Mínimo e ideal por ARMAZÉM (setor), com o cadastro do produto como
     padrão. Guardados em st.minimos['produto|armazem']. */
  function minimoDe(produtoId, armazemId) {
    const m = st.minimos[produtoId + '|' + armazemId];
    if (m && m.minimo !== undefined && m.minimo !== null) return m.minimo;
    return (D.produtos.find(function (x) { return x.id === produtoId; }) || {}).minimo || 0;
  }
  function idealDe(produtoId, armazemId) {
    const m = st.minimos[produtoId + '|' + armazemId];
    if (m && m.ideal !== undefined && m.ideal !== null) return m.ideal;
    return (D.produtos.find(function (x) { return x.id === produtoId; }) || {}).ideal || 0;
  }
  function definirMinimo(produtoId, armazemId, d) {
    if (!pode('estoque')) return { erro: 'Seu perfil não altera parâmetros de estoque.' };
    if (!produtoId || !armazemId) return { erro: 'Informe material e armazém.' };
    /* Mínimo em texto gravava NaN, e NaN fazia o material sair do
       alerta de compra PARA SEMPRE — zerado na sala e na unidade, e
       ainda assim fora da lista, porque toda comparação com NaN é
       false. Contaminava também o mínimo somado da unidade. */
    const minNum = d.minimo === '' || d.minimo === undefined || d.minimo === null
      ? null : numeroBR(d.minimo);
    const idealNum = d.ideal === '' || d.ideal === undefined || d.ideal === null
      ? null : numeroBR(d.ideal);
    if (minNum !== null && !isFinite(minNum)) return { erro: 'Mínimo inválido (' + d.minimo + ').' };
    if (idealNum !== null && !isFinite(idealNum)) return { erro: 'Ideal inválido (' + d.ideal + ').' };
    if ((minNum !== null && minNum < 0) || (idealNum !== null && idealNum < 0)) {
      return { erro: 'Mínimo e ideal não podem ser negativos.' };
    }
    d = Object.assign({}, d, { minimo: minNum === null ? '' : minNum,
      ideal: idealNum === null ? '' : idealNum });
    if (d.ideal && d.minimo && d.ideal < d.minimo) return { erro: 'O ideal não pode ser menor que o mínimo.' };
    st.minimos[produtoId + '|' + armazemId] = {
      produto: produtoId, armazem: armazemId,
      minimo: d.minimo === '' || d.minimo === undefined ? null : Math.round(d.minimo * 1000) / 1000,
      ideal: d.ideal === '' || d.ideal === undefined ? null : Math.round(d.ideal * 1000) / 1000
    };
    logar('estoque', produtoId, 'definiu mínimo do setor',
      (D.armazem(armazemId) || {}).nome + ' · mín ' + U.num(d.minimo || 0) + ' / ideal ' + U.num(d.ideal || 0));
    return { ok: true };
  }
  /* Mínimo/ideal da UNIDADE = soma do que foi definido setor a setor.
     Se ninguém definiu nada na unidade, vale o número do cadastro do
     produto (uma vez só) — somar o padrão de cada armazém inflava o
     sugerido de compra. */
  function somaDaUnidade(produtoId, armazemId, campo) {
    const paiObj = D.paiDe(armazemId);
    const pai = paiObj ? paiObj.id : armazemId;
    const ids = D.comSetores(pai);
    const definidos = ids.filter(function (am) {
      const m = st.minimos[produtoId + '|' + am];
      return m && m[campo] !== undefined && m[campo] !== null;
    });
    if (definidos.length) {
      return definidos.reduce(function (a, am) { return a + st.minimos[produtoId + '|' + am][campo]; }, 0);
    }
    const p = D.produtos.find(function (x) { return x.id === produtoId; }) || {};
    return p[campo] || 0;
  }
  const minimoDaUnidade = (produtoId, armazemId) => somaDaUnidade(produtoId, armazemId, 'minimo');
  const idealDaUnidade = (produtoId, armazemId) => somaDaUnidade(produtoId, armazemId, 'ideal');

  /* Saldo do MESMO material na unidade inteira (almoxarifado central
     do projeto + todos os setores). É isso que decide compra: se o
     centro cirúrgico está zerado mas tem caixa sobrando no
     almoxarifado, o certo é transferência interna, não compra nova. */
  function saldoNaUnidade(produtoId, armazemId) {
    // paiDe devolve o objeto do almoxarifado principal (ou nada, se já for o principal)
    const paiObj = D.paiDe(armazemId);
    const pai = paiObj ? paiObj.id : armazemId;
    const ids = D.comSetores(pai);
    let total = 0;
    ids.forEach(function (am) {
      const pos = st.posicoes[chaveEst(produtoId, am)];
      if (pos) total += pos.saldo;
    });
    return { pai: pai, saldo: Math.round(total * 1000) / 1000 };
  }

  function posicaoEstoque(armazemId) {
    return Object.keys(st.posicoes).map(function (k) {
      const pos = st.posicoes[k];
      if (armazemId && pos.armazem !== armazemId) return null;
      if (pos.saldo <= 0 && !armazemId) return null;
      const p = D.produtos.find(function (x) { return x.id === pos.produto; }) || {};
      /* Mínimo POR SETOR: cada armazém pode ter o seu (st.minimos), e o
         do cadastro do produto é o padrão de quem não definiu. Antes um
         número só era comparado com todo setor, e o almoxarifado
         aparecia como "transferir de outro setor". */
      const min = minimoDe(pos.produto, pos.armazem);
      const ideal = idealDe(pos.produto, pos.armazem);
      const falta = Math.max(0, (ideal || min || 0) - pos.saldo);
      const un = saldoNaUnidade(pos.produto, pos.armazem);
      /* Abaixo do mínimo no setor, mas com saldo na unidade → o alerta
         é de TRANSFERÊNCIA, não de compra. Compra só quando falta na
         unidade inteira. */
      const abaixoLocal = pos.saldo <= min;
      /* Na unidade o que vale é a soma dos mínimos dos setores que
         usam o material (ou o mínimo do próprio almoxarifado). */
      const abaixoUnidade = un.saldo <= minimoDaUnidade(pos.produto, pos.armazem);
      return {
        produto: p, armazem: pos.armazem, saldo: Math.round(pos.saldo * 1000) / 1000,
        valor: Math.round(pos.valor * 100) / 100,
        medio: pos.saldo > 0 ? Math.round(pos.valor / pos.saldo * 10000) / 10000 : 0,
        minimo: min, ideal: ideal,
        saldo_unidade: un.saldo, armazem_pai: un.pai,
        em_outros_setores: Math.round((un.saldo - pos.saldo) * 1000) / 1000,
        abaixo: abaixoLocal, abaixo_unidade: abaixoUnidade,
        so_transferir: abaixoLocal && !abaixoUnidade,
        zerado: pos.saldo <= 0,
        sugerido: Math.ceil(Math.max(0, (idealDaUnidade(pos.produto, pos.armazem) || minimoDaUnidade(pos.produto, pos.armazem)) - un.saldo)),
        sugerido_setor: Math.ceil(falta)
      };
    }).filter(Boolean).sort(function (a, b) {
      return (a.saldo / (a.minimo || 1)) - (b.saldo / (b.minimo || 1));
    /* Sem o nível financeiro de Estoque, a posição sai sem custo e sem
       valor — a tela já escondia, mas a função devolvia. */
    }).map(function (l) { return visivel('estoque', l); });
  }

  /* Posição da casa inteira: almoxarifado do hospital mais os setores,
     somados por material, com a quebra de onde cada saldo está. É a
     pergunta "quanto de luva tem no HGB", que nenhuma linha isolada
     por armazém responde. */
  function posicaoConsolidada(paiId) {
    const ids = D.comSetores(paiId);
    const por = {};
    ids.forEach(function (am) {
      posicaoEstoque(am).forEach(function (l) {
        const k = l.produto.id;
        por[k] = por[k] || { produto: l.produto, saldo: 0, valor: 0, onde: [],
                             minimo: l.minimo, ideal: l.ideal };
        por[k].saldo = Math.round((por[k].saldo + l.saldo) * 1000) / 1000;
        por[k].valor = Math.round((por[k].valor + l.valor) * 100) / 100;
        if (l.saldo > 0) por[k].onde.push({ armazem: am, saldo: l.saldo, valor: l.valor });
      });
    });
    return Object.keys(por).map(function (k) {
      const l = por[k];
      l.medio = l.saldo > 0 ? Math.round(l.valor / l.saldo * 10000) / 10000 : 0;
      l.abaixo = l.saldo <= (l.minimo || 0);
      l.zerado = l.saldo <= 0;
      l.sugerido = Math.ceil(Math.max(0, (l.ideal || l.minimo || 0) - l.saldo));
      /* quanto está parado no almoxarifado e quanto já desceu */
      const noPai = l.onde.find(function (o) { return o.armazem === paiId; });
      l.no_principal = noPai ? noPai.saldo : 0;
      l.nos_setores = Math.round((l.saldo - l.no_principal) * 1000) / 1000;
      return l;
    }).filter(function (l) { return l.saldo > 0 || l.abaixo; })
      .sort(function (a, b) { return (a.saldo / (a.minimo || 1)) - (b.saldo / (b.minimo || 1)); });
  }

  /* Distribuição para setor: é uma transferência, com a checagem de
     que o destino é setor do armazém de origem. O custo médio desce
     junto — o setor consome pelo valor que o hospital pagou. */
  function distribuir(d) {
    const dst = D.armazem(d.destino) || {};
    if (dst.pai && dst.pai !== d.origem) {
      return { erro: 'O setor ' + dst.nome + ' recebe do ' +
        ((D.armazem(dst.pai) || {}).nome || 'armazém dele') + ', não deste armazém.' };
    }
    return transferir(d);
  }

  /* Alerta de COMPRA: só o que falta na unidade inteira. O que falta
     só no setor vira alerta de transferência interna (abaixo). */
  /* Alerta de compra: uma linha por MATERIAL + unidade. Antes o mesmo
     material abaixo do mínimo em 3 setores virava 3 alertas (e o
     "Requisitar" pedia 3 vezes a quantidade); e material zerado na
     unidade inteira sumia da lista, porque não havia posição em
     armazém nenhum — justo o pior caso. */
  function alertasEstoque() {
    const porChave = {};
    posicaoEstoque().forEach(function (l) {
      if (!l.abaixo_unidade) return;
      const chave = l.produto.id + '|' + l.armazem_pai;
      if (!porChave[chave] || l.armazem === l.armazem_pai) porChave[chave] = l;
    });
    /* material com saldo ZERO não aparece em posicaoEstoque (não há
       registro), então entra aqui pelo cadastro: se tem mínimo definido
       pra algum armazém e não há saldo nenhum na unidade, falta tudo. */
    Object.keys(st.minimos).forEach(function (k) {
      const m = st.minimos[k];
      if (!(m.minimo > 0)) return;
      const un = saldoNaUnidade(m.produto, m.armazem);
      if (un.saldo > 0) return;
      const chave = m.produto + '|' + un.pai;
      if (porChave[chave]) return;
      const p = D.produtos.find(function (x) { return x.id === m.produto; }) || {};
      porChave[chave] = { produto: p, armazem: m.armazem, armazem_pai: un.pai, saldo: 0, saldo_unidade: 0,
        minimo: m.minimo, ideal: idealDe(m.produto, m.armazem), em_outros_setores: 0,
        abaixo: true, abaixo_unidade: true, so_transferir: false, zerado: true,
        sugerido: Math.ceil(idealDe(m.produto, m.armazem) || m.minimo), sugerido_setor: Math.ceil(m.minimo) };
    });
    return Object.keys(porChave).map(function (k) { return porChave[k]; });
  }
  const alertasTransferencia = () => posicaoEstoque().filter(function (l) { return l.so_transferir; });
  const comSaldo = armazemId => posicaoEstoque(armazemId).filter(function (l) { return l.saldo > 0; });

  /* ── compras ────────────────────────────────────────────
     A requisição pede MATERIAL e QUANTIDADE, sem fornecedor e sem
     valor: quem requisita não cota. O comprador define o fornecedor no
     pedido, e o custo só existe quando o material entra no estoque. */
  /* A trava de edição vale no store, não só na tela: requisição
     aprovada, cotada ou virada pedido não se edita — o caminho é
     reprovar ou devolver pra revisão. */
  function podeEditarRequisicao(r) {
    return !!r && r.status === 'requisicao';
  }

  function criarRequisicao(d) {
    /* Validar o que vem: produto e armazém inexistentes e quantidade
       infinita passavam e só quebravam lá na frente, na entrada de
       estoque — longe de quem errou. */
    if (d && d.armazem && !D.armazem(d.armazem)) return { erro: 'Armazém não encontrado.' };
    const itensReq = (d && d.itens) || [];
    for (let i = 0; i < itensReq.length; i++) {
      const it = itensReq[i];
      if (!D.produtos.some(function (x) { return x.id === it.produto; })) {
        return { erro: 'Produto não encontrado: ' + it.produto };
      }
      const q = Number(it.qtd);
      if (!isFinite(q) || q <= 0) {
        return { erro: 'Quantidade inválida em ' + it.produto + '.' };
      }
    }
    /* Requisição sem item não é requisição: zerar tudo na edição
       gravava "Requisição salva." com 0 itens, e ela seguia no fluxo. */
    if (d && d.itens && !d.itens.some(function (i) { return i.produto && (i.qtd || 0) > 0; })) {
      return { erro: 'Informe ao menos um material com quantidade. Para desistir, cancele a requisição.' };
    }
    /* Mesmo material em duas linhas quebra tudo depois: a cotação e a
       entrada casam por PRODUTO e ignoram a segunda linha. Juntar as
       quantidades é o que a pessoa queria de qualquer forma. */
    if (d && d.itens) {
      const juntos = {};
      d.itens.forEach(function (i) {
        if (!i.produto) return;
        if (juntos[i.produto]) {
          juntos[i.produto].qtd = Math.round((juntos[i.produto].qtd + (i.qtd || 0)) * 1000) / 1000;
          if (i.observacao) {
            juntos[i.produto].observacao = [juntos[i.produto].observacao, i.observacao].filter(Boolean).join(' · ');
          }
        } else juntos[i.produto] = Object.assign({}, i);
      });
      d = Object.assign({}, d, { itens: Object.keys(juntos).map(function (k) { return juntos[k]; }) });
    }
    if (!pode('requisitar')) return { erro: 'Seu perfil não abre requisição de compra.' };
    const itens = (d.itens || []).filter(function (i) { return i.produto && i.qtd > 0; });
    if (!itens.length) return { erro: 'Inclua ao menos um item com quantidade.' };
    if (!d.armazem) return { erro: 'Informe o armazém de destino.' };
    const r = {
      id: novoId('rq'),
      numero: 'RQ-' + String(st.compras.length + 1).padStart(4, '0'),
      armazem: d.armazem, status: 'requisicao',
      origem: d.origem || 'manual',
      credor: null, prazo: d.prazo || '',
      observacao: d.observacao || '',
      itens: itens.map(function (i) {
        return { produto: i.produto, qtd: Math.round(i.qtd * 1000) / 1000, recebido: 0 };
      }),
      historico: [{ status: 'requisicao', data: U.hoje(), usuario: usuario().nome }],
      /* Sem o id de quem abriu, a regra "quem pede não aprova" não tem
         como comparar — ficava desligada na prática. */
      criado_por: usuario().nome, criado_por_id: (usuario() || {}).id || null, criado_em: new Date()
    };
    st.compras.push(r);
    logar('compra', r.id, 'abriu requisição', r.numero + ' · ' + r.itens.length + ' item(ns)');
    return { ok: true, requisicao: r };
  }

  /* Valor da requisição.

     A requisição não tem campo de valor — o comprador é que cota. Mas
     aprovar sem nenhuma ordem de grandeza é aprovar quantidade, não
     dinheiro: a diretoria dizia sim para "300 caixas" sem saber se são
     mil ou cem mil reais. Então o sistema ESTIMA pelo custo médio do
     armazém, e na falta dele pelo último custo do cadastro, deixando
     claro que é estimativa e o que ficou sem base. */
  function valorEstimadoCompra(r) {
    let total = 0; const semBase = [];
    (r.itens || []).forEach(function (i) {
      const p = D.produtos.find(function (x) { return x.id === i.produto; }) || {};
      const base = i.custo || custoMedio(i.produto, r.armazem) || p.custo || 0;
      if (!base) semBase.push(p.descricao || i.produto);
      total += (i.qtd || 0) * base;
    });
    return {
      valor: Math.round(total * 100) / 100,
      estimado: !(r.itens || []).every(function (i) { return i.custo > 0; }),
      semBase: semBase
    };
  }

  /* ── 1ª aprovação: a NECESSIDADE ────────────────────────
     O diretor vê o valor estimado linha a linha (custo médio do
     estoque), aprova ou reprova ITEM POR ITEM e pode cortar
     quantidade. Reprovar tudo cancela a requisição. */
  function aprovarRequisicao(id, d) {
    if (!pode('aprovar_compra')) return { erro: 'Seu perfil não aprova requisição de compra.' };
    const r = st.compras.find(function (x) { return x.id === id; });
    if (!r) return { erro: 'Requisição não encontrada.' };
    if (st.parametros.impedir_autoaprovacao_compras && r.criado_por_id === (usuario() || {}).id) {
      return { erro: 'Você abriu esta requisição — com a segregação de funções ligada, quem pede não aprova.' };
    }
    if (r.status !== 'requisicao') {
      return { erro: 'Só requisição em aberto pode ser aprovada — esta está em "' + (D.STATUS_COMPRA[r.status] || r.status) + '".' };
    }
    const decisoes = d.itens || [];
    let aprovados = 0;
    let erroItem = null;
    r.itens.forEach(function (i, idx) {
      /* Casa por POSIÇÃO quando a tela manda o índice: o mesmo produto
         em duas linhas fazia reprovar uma reprovar as duas. */
      const dec = decisoes.find(function (x) {
        return x.indice !== undefined ? x.indice === idx : x.produto === i.produto;
      });
      if (!dec) return;
      // quantidade zerada é reprovação, não "mantém a original"
      if (dec.aprovado !== false && dec.qtd !== undefined && !(dec.qtd > 0)) dec.aprovado = false;
      if (dec.aprovado !== false && dec.qtd > i.qtd + 0.0001) {
        dec.qtd = i.qtd;   // não dá pra aprovar mais do que foi pedido
      }
      // reprovar item exige motivo: quem pediu precisa saber por quê
      if (dec.aprovado === false && !dec.motivo && !d.observacao) {
        erroItem = 'Diga o motivo da reprovação de ' +
          ((D.produtos.find(function (x) { return x.id === i.produto; }) || {}).descricao || 'item') + '.';
        return;
      }
      if (dec.aprovado === false) {
        i.reprovado = true;
        i.motivo_reprovacao = dec.motivo || '';
      } else {
        i.reprovado = false;
        if (dec.qtd > 0 && Math.abs(dec.qtd - i.qtd) > 0.0001) {
          i.qtd_pedida = i.qtd_pedida !== undefined ? i.qtd_pedida : i.qtd;   // guarda o que foi pedido
          i.qtd = Math.round(dec.qtd * 1000) / 1000;
        }
        aprovados++;
      }
    });
    if (erroItem) return { erro: erroItem };
    r.observacao_aprovacao = d.observacao || '';
    r.aprovada_por = usuario().nome;
    r.aprovada_em = new Date();
    if (!aprovados) {
      r.status = 'cancelada';
      r.historico.push({ status: 'cancelada', data: U.hoje(), usuario: usuario().nome, obs: 'todos os itens reprovados' });
      logar('compra', r.id, 'reprovou requisição', r.numero);
      return { ok: true, cancelada: true };
    }
    r.status = 'aprovada';
    r.historico.push({ status: 'aprovada', data: U.hoje(), usuario: usuario().nome });
    logar('compra', r.id, 'aprovou requisição', r.numero + ' · ' + aprovados + ' item(ns)');
    return { ok: true, aprovados: aprovados };
  }

  /* ── cotação ────────────────────────────────────────────
     O comprador anexa as cotações recebidas, escolhe o fornecedor de
     cada item e lança o preço. O FRETE é por item (o mesmo pedido pode
     ter dois fornecedores, cada um com seu frete — e o rateio é
     decisão de quem compra, não uma divisão igual automática). */
  function registrarCotacao(id, d) {
    if (!pode('comprar')) return { erro: 'Seu perfil não registra cotação.' };
    const r = st.compras.find(function (x) { return x.id === id; });
    if (!r) return { erro: 'Requisição não encontrada.' };
    if (['aprovada', 'cotada'].indexOf(r.status) < 0) {
      return { erro: 'A cotação entra depois da aprovação da requisição — esta está em "' +
        (D.STATUS_COMPRA[r.status] || r.status) + '".' };
    }
    const itens = (d.itens || []).filter(function (i) { return i.produto; });
    /* Custo e frete infinitos passavam e viravam parcela Infinity no
       contas a pagar: a requisição ganhou `isFinite` na quantidade, a
       cotação não. */
    const custoRuim = itens.find(function (i) {
      if (i.custo === undefined || i.custo === null || i.custo === '') return false;
      const v = numeroBR(i.custo);
      return !isFinite(v) || v < 0;
    });
    if (custoRuim) {
      return { erro: 'Custo inválido na cotação (' + custoRuim.custo + ').' };
    }
    const freteRuim = itens.find(function (i) {
      if (i.frete === undefined || i.frete === null || i.frete === '') return false;
      const v = numeroBR(i.frete);
      return !isFinite(v) || v < 0;
    });
    if (freteRuim) return { erro: 'Frete inválido na cotação (' + freteRuim.frete + ').' };
    const ativos = r.itens.filter(function (i) { return !i.reprovado; });
    const semPreco = ativos.filter(function (i) {
      const c = itens.find(function (x) { return x.produto === i.produto; });
      return !c || !(c.custo > 0) || !c.credor;
    });
    if (semPreco.length) {
      const p = D.produtos.find(function (x) { return x.id === semPreco[0].produto; }) || {};
      return { erro: 'Falta fornecedor e preço em "' + (p.descricao || semPreco[0].produto) + '" — ' +
        'a diretoria precisa dos valores reais pra aprovar a compra.' };
    }
    r.itens.forEach(function (i) {
      const c = itens.find(function (x) { return x.produto === i.produto; });
      if (!c || i.reprovado) return;
      i.credor = c.credor;
      i.custo = Math.round(c.custo * 100) / 100;
      i.frete = Math.max(0, Math.round((c.frete || 0) * 100) / 100);   // frete negativo não existe
    });
    /* Reenviar a cotação não duplica anexo: mesmo nome e mesmo
       fornecedor é o mesmo arquivo. */
    const jaAnexados = r.cotacoes || [];
    const novos = (d.anexos || []).filter(function (a) {
      return !jaAnexados.some(function (x) { return x.nome === a.nome && (x.fornecedor || '') === (a.fornecedor || ''); });
    }).map(function (a) {
      return { nome: a.nome, dados: a.dados, fornecedor: a.fornecedor || '', anexado_em: U.hoje() };
    });
    r.cotacoes = novos.concat(jaAnexados);
    r.observacao_cotacao = d.observacao || '';
    r.prazo = d.prazo || r.prazo;
    r.cotado_por = usuario().nome;
    r.cotado_por_id = (usuario() || {}).id || null;
    r.cotado_em = new Date();
    r.status = 'cotada';
    r.historico.push({ status: 'cotada', data: U.hoje(), usuario: usuario().nome });
    logar('compra', r.id, 'registrou cotação', r.numero + ' · ' + U.brl(totalCotado(r).total));
    return { ok: true };
  }

  /* Total da cotação: itens + frete de cada item, separado por
     fornecedor (é assim que o pedido vai sair). */
  function totalCotado(r) {
    const porFornecedor = {};
    let total = 0;
    (r.itens || []).filter(function (i) { return !i.reprovado; }).forEach(function (i) {
      const v = Math.round(((i.qtd || 0) * (i.custo || 0) + (i.frete || 0)) * 100) / 100;
      total += v;
      const k = i.credor || '(sem fornecedor)';
      porFornecedor[k] = Math.round(((porFornecedor[k] || 0) + v) * 100) / 100;
    });
    return { total: Math.round(total * 100) / 100, por_fornecedor: porFornecedor };
  }

  /* ── 2ª aprovação: o PREÇO ──────────────────────────────
     Agora com valores reais na frente. Pode aprovar, reprovar de vez,
     ou devolver pro comprador cotar de novo. */
  function aprovarCompra(id, d) {
    if (!pode('aprovar_compra')) return { erro: 'Seu perfil não aprova compra.' };
    const r = st.compras.find(function (x) { return x.id === id; });
    if (!r) return { erro: 'Requisição não encontrada.' };
    if (st.parametros.impedir_autoaprovacao_compras && r.cotado_por_id === (usuario() || {}).id) {
      return { erro: 'Você lançou esta cotação — com a segregação de funções ligada, quem cota não aprova a compra.' };
    }
    if (d.decisao === 'reprovar' && !d.observacao) {
      return { erro: 'Diga o motivo da reprovação — quem pediu precisa saber por quê.' };
    }
    if (r.status !== 'cotada') {
      return { erro: 'Só cotação registrada vai pra aprovação da compra — esta está em "' +
        (D.STATUS_COMPRA[r.status] || r.status) + '".' };
    }
    const t = totalCotado(r);
    const lim = st.parametros.alcada[(usuario() || {}).perfil] || 0;
    if (lim && t.total > lim && d.decisao === 'aprovar') {
      return { erro: 'Compra de ' + U.brl(t.total) + ' acima da sua alçada de ' + U.brl(lim) +
        '. Peça a quem tem alçada maior.' };
    }
    if (d.decisao === 'reprovar') {
      r.status = 'cancelada';
      r.observacao_aprovacao_compra = d.observacao || '';
      r.historico.push({ status: 'cancelada', data: U.hoje(), usuario: usuario().nome, obs: 'compra reprovada' });
      logar('compra', r.id, 'reprovou compra', r.numero + ' · ' + U.brl(t.total));
      return { ok: true, cancelada: true };
    }
    if (d.decisao === 'revisar') {
      if (!d.observacao) return { erro: 'Diga o que precisa mudar na cotação.' };
      r.status = 'aprovada';                       // volta pro comprador cotar de novo
      r.observacao_aprovacao_compra = d.observacao;
      r.historico.push({ status: 'aprovada', data: U.hoje(), usuario: usuario().nome, obs: 'devolvida: ' + d.observacao });
      logar('compra', r.id, 'pediu revisão da cotação', r.numero + ' · ' + d.observacao);
      return { ok: true, revisar: true };
    }
    r.status = 'compra_aprovada';
    r.observacao_aprovacao_compra = d.observacao || '';
    r.compra_aprovada_por = usuario().nome;
    r.compra_aprovada_em = new Date();
    r.historico.push({ status: 'compra_aprovada', data: U.hoje(), usuario: usuario().nome });
    logar('compra', r.id, 'aprovou compra', r.numero + ' · ' + U.brl(t.total));
    return { ok: true, total: t.total };
  }

  /* E-mail de confirmação do pedido. O sistema roda como arquivo local
     (sem servidor), então não dá pra DISPARAR o e-mail sozinho: o que
     dá é montar a mensagem pronta e abrir no programa de e-mail da
     máquina, com destinatário, assunto e corpo preenchidos — a pessoa
     só confere e envia. Exige e-mail no cadastro do fornecedor. */
  function emailDoPedido(id) {
    const r = st.compras.find(function (x) { return x.id === id; });
    if (!r) return { erro: 'Pedido não encontrado.' };
    const c = D.credor(r.credor);
    if (!c) return { erro: 'Pedido sem fornecedor.' };
    if (!c.email) {
      return { erro: 'O fornecedor ' + c.nome + ' está sem e-mail no cadastro — ' +
        'preencha em Cadastros › Fornecedores pra poder enviar o pedido.' };
    }
    const emp = D.empresa || {};
    const itens = (r.itens || []).filter(function (i) { return !i.reprovado; });
    const linhas = itens.map(function (i) {
      const p = D.produtos.find(function (x) { return x.id === i.produto; }) || {};
      return '- ' + (p.descricao || i.produto) + ' · ' + U.num(i.qtd) + ' ' + (p.unidade || 'un') +
        ' · ' + U.brl(i.custo || 0) + '/un' + (i.frete ? ' · frete ' + U.brl(i.frete) : '');
    });
    const total = itens.reduce(function (a, i) { return a + i.qtd * (i.custo || 0) + (i.frete || 0); }, 0);
    const corpo = 'Prezados,\n\nSegue nosso pedido de compra ' + r.numero + '.\n\n' +
      linhas.join('\n') + '\n\nTotal: ' + U.brl(Math.round(total * 100) / 100) +
      (r.prazo ? '\nEntrega prevista: ' + U.fData(r.prazo) : '') +
      '\nEntregar em: ' + ((D.armazem(r.armazem) || {}).nome || '') +
      '\n\nPor favor, confirmem o recebimento deste pedido e o prazo de entrega.\n\n' +
      (emp.nome || '') + (emp.cnpj ? '\nCNPJ ' + emp.cnpj : '') + '\n' + usuario().nome;
    return {
      ok: true, para: c.email, contato: c.contato || '',
      assunto: 'Pedido de compra ' + r.numero + ' — ' + (emp.nome || ''),
      corpo: corpo,
      mailto: 'mailto:' + encodeURIComponent(c.email) +
        '?subject=' + encodeURIComponent('Pedido de compra ' + r.numero + ' — ' + (emp.nome || '')) +
        '&body=' + encodeURIComponent(corpo)
    };
  }

  function mudarStatusCompra(id, status, dados) {
    const r = st.compras.find(function (x) { return x.id === id; });
    if (!r) return { erro: 'Requisição não encontrada.' };
    /* Mexer em compra é movimentar o módulo: a função aceitava
       qualquer perfil, inclusive o de consulta, porque só checava a
       permissão da transição específica. */
    if (!podeMover('compras') && !pode('comprar') && !pode('aprovar_compra')) {
      return { erro: 'Seu perfil não movimenta compras.' };
    }
    /* Alterar ITEM de compra já aprovada: o pedido ia ao fornecedor
       83 vezes maior sem nova aprovação e sem registro de quem mudou.
       Item só se edita enquanto é requisição. */
    const mexeNosItens = dados && dados.itens;
    if (mexeNosItens && ['requisicao', 'cotacao'].indexOf(r.status) < 0) {
      return { erro: 'Os itens não se editam depois de a compra sair da requisição (está em "' +
        r.status + '"). Cancele e refaça, ou peça nova aprovação.' };
    }
    if (status === 'aprovada' && !pode('aprovar_compra')) {
      return { erro: 'Seu perfil não aprova requisição de compra.' };
    }
    if (status === 'pedido' && !pode('comprar')) {
      return { erro: 'Seu perfil não envia pedido ao fornecedor.' };
    }
    if (status === 'pedido' && r.status !== 'aprovada') {
      return { erro: 'Só requisição aprovada vira pedido — esta está em "' + r.status + '".' };
    }
    if (status === 'pedido' && !(dados && dados.credor) && !r.credor) {
      return { erro: 'Informe o fornecedor antes de enviar o pedido.' };
    }
    /* Alçada também em compras. Existia só no contas a pagar, e o
       compromisso com o fornecedor nasce aqui — quando o título chega,
       a decisão de gastar já foi tomada. Na aprovação vale a
       estimativa; no pedido, o preço cotado, que é o número real. */
    const lim = st.parametros.alcada[(usuario() || {}).perfil] || 0;
    /* A alçada trava quem DECIDE gastar. Depois que a diretoria/sócio
       aprovou a compra, ENVIAR o pedido é execução: travar o comprador
       aqui deixava a compra aprovada presa sem ninguém poder mandar. */
    const jaAprovada = !!r.compra_aprovada_por;
    if (lim && ['aprovada', 'pedido'].indexOf(status) > -1 && !jaAprovada) {
      const v = valorEstimadoCompra(Object.assign({}, r, dados || {})).valor;
      if (v > lim) {
        return { erro: (status === 'aprovada' ? 'Requisição' : 'Pedido') + ' de ' + U.brl(v) +
          ' acima da sua alçada de ' + U.brl(lim) + '. Peça a quem tem alçada maior.' };
      }
    }
    const antes = r.status;
    const valorAntes = valorEstimadoCompra(r).valor;
    r.status = status;
    Object.keys(dados || {}).forEach(function (k) { r[k] = dados[k]; });
    /* Valor subiu depois de aprovada: a alçada foi dada para um
       número, não para outro — volta para aprovação. */
    if (jaAprovada && valorEstimadoCompra(r).valor > valorAntes + 0.004) {
      r.compra_aprovada_por = null;
      r.status = 'aprovacao';
      r.historico.push({ status: 'aprovacao', data: U.hoje(), usuario: usuario().nome,
        obs: 'valor subiu de ' + U.brl(valorAntes) + ' para ' +
          U.brl(valorEstimadoCompra(r).valor) + ' — aprovação refeita' });
      logar('compra', r.id, 'aprovação desfeita por aumento de valor',
        U.brl(valorAntes) + ' → ' + U.brl(valorEstimadoCompra(r).valor));
      return { erro: 'O valor subiu de ' + U.brl(valorAntes) + ' para ' +
        U.brl(valorEstimadoCompra(r).valor) + ' depois da aprovação. A compra voltou para ' +
        'aprovação.', reaprovar: true };
    }
    if (antes !== status) r.historico.push({ status: status, data: U.hoje(), usuario: usuario().nome });
    logar('compra', r.id, 'compra ' + status, r.numero);
    return { ok: true };
  }

  /* Cotação pode trazer fornecedores diferentes por item — quem decide
     isso é o comprador, na hora de cotar, não quem abriu a requisição.
     Divide em um pedido por fornecedor: cada um vai ter sua própria
     nota, seu próprio recebimento, seu próprio pagamento. Manter tudo
     num pedido só empurraria essa mistura pro recebimento e pro
     título — e lá não tem como um título ter dois credores. */
  function enviarPedido(id, itensComFornecedor, comuns) {
    const r = st.compras.find(function (x) { return x.id === id; });
    if (!r) return { erro: 'Requisição não encontrada.' };
    if (!pode('comprar')) return { erro: 'Seu perfil não envia pedido ao fornecedor.' };
    if (r.status !== 'compra_aprovada') {
      return { erro: 'O pedido só sai depois da diretoria aprovar a COMPRA (com os valores cotados) — ' +
        'esta está em "' + (D.STATUS_COMPRA[r.status] || r.status) + '".' };
    }
    /* Sem itens explícitos, usa a cotação já aprovada (fornecedor,
       preço e frete por item) — não faz sentido redigitar o que a
       diretoria acabou de aprovar. */
    const itens = ((itensComFornecedor && itensComFornecedor.length ? itensComFornecedor
      : (r.itens || []).filter(function (i) { return !i.reprovado; })
          .map(function (i) { return { produto: i.produto, qtd: i.qtd, credor: i.credor, custo: i.custo, frete: i.frete || 0 }; })))
      .filter(function (i) { return i.produto && i.qtd > 0; });
    if (!itens.length) return { erro: 'Nenhum item no pedido.' };
    if (itens.some(function (i) { return !i.credor; })) {
      return { erro: 'Informe o fornecedor de todos os itens.' };
    }
    if (itens.some(function (i) { return !(i.custo > 0); })) {
      return { erro: 'Informe o preço de todos os itens.' };
    }

    const grupos = {};
    const ordem = [];
    itens.forEach(function (i) {
      if (!grupos[i.credor]) { grupos[i.credor] = []; ordem.push(i.credor); }
      grupos[i.credor].push(i);
    });

    // alçada calculada por pedido resultante — é o compromisso real com aquele fornecedor
    const lim = st.parametros.alcada[(usuario() || {}).perfil] || 0;
    if (lim) {
      for (const cid of ordem) {
        const totalGrupo = grupos[cid].reduce(function (s, i) { return s + i.qtd * i.custo + (i.frete || 0); }, 0);
        if (totalGrupo > lim) {
          return { erro: 'Pedido para ' + ((D.credor(cid) || {}).nome || cid) + ' de ' +
            U.brl(Math.round(totalGrupo * 100) / 100) + ' acima da sua alçada de ' + U.brl(lim) +
            '. Peça a quem tem alçada maior.' };
        }
      }
    }

    const gerados = [];
    /* Número base guardado ANTES do laço: o primeiro pedido renomeia a
       própria requisição (RQ-0001 → RQ-0001-A) e, sem isso, o segundo
       virava RQ-0001-A-B. */
    const numeroBase = r.numero;
    ordem.forEach(function (cid, idx) {
      const itensDoGrupo = grupos[cid].map(function (i) {
        return { produto: i.produto, qtd: i.qtd, recebido: 0, custo: i.custo, frete: i.frete || 0 };
      });
      const dividir = ordem.length > 1;
      const alvo = idx === 0 ? r : {
        id: novoId('rq'), armazem: r.armazem, status: 'requisicao', origem: r.origem,
        observacao: r.observacao, criado_por: r.criado_por, criado_em: r.criado_em,
        historico: r.historico.slice()
      };
      alvo.numero = dividir ? numeroBase + '-' + String.fromCharCode(65 + idx) : numeroBase;
      /* Pedido dividido por fornecedor: cada um carrega as cotações
         anexadas e quem aprovou — antes o 2º nascia sem nada disso e
         ninguém sabia com base em que ele saiu. */
      if (dividir && idx > 0) {
        alvo.cotacoes = (r.cotacoes || []).slice();
        alvo.aprovada_por = r.aprovada_por;
        alvo.compra_aprovada_por = r.compra_aprovada_por;
        alvo.compra_aprovada_em = r.compra_aprovada_em;
        alvo.cotado_por = r.cotado_por;
        alvo.observacao_cotacao = r.observacao_cotacao;
        alvo.historico = (r.historico || []).slice();
      }
      alvo.itens = itensDoGrupo;
      alvo.status = 'pedido';
      alvo.credor = cid;
      alvo.prazo = comuns.prazo;
      alvo.pedido_fornecedor = comuns.pedido_fornecedor || '';
      /* Frete do pedido = soma do frete que o comprador lançou em cada
         item daquele fornecedor (nada de dividir igualmente entre
         fornecedores, que era o que acontecia antes). */
      alvo.frete = Math.round(itensDoGrupo.reduce(function (s2, i) { return s2 + (i.frete || 0); }, 0) * 100) / 100;
      if (!alvo.frete && comuns && comuns.frete) alvo.frete = Math.round(comuns.frete / ordem.length * 100) / 100;
      alvo.historico.push({ status: 'pedido', data: U.hoje(), usuario: usuario().nome });
      if (idx > 0) st.compras.push(alvo);
      logar('compra', alvo.id, 'compra pedido', alvo.numero + ' · ' + ((D.credor(cid) || {}).nome || ''));

      /* Previsão financeira nasce junto com o pedido — antes disso o
         compromisso só aparecia no contas a pagar quando o material já
         tinha chegado. A natureza usada aqui (3.03) é um chute
         razoável; quando a nota real entrar pelo Estoque, o
         `criarTitulo` de lá já casa por natureza+centro+competência e
         substitui esta previsão sozinho — se a nota vier em outra
         natureza, sobra como resíduo pra alguém cancelar na mão. */
      const totalAlvo = Math.round((itensDoGrupo.reduce(function (s, i) {
        return s + i.qtd * i.custo; }, 0) + alvo.frete) * 100) / 100;
      const venc = U.addDias(comuns.prazo || U.hoje(), 15);
      /* A natureza tem que ser a mesma que a NF real vai usar quando
         entrar pelo Estoque — senão a previsão nunca casa com o
         título de verdade e fica pendurada pra sempre. Usa a natureza
         cadastrada no primeiro produto do pedido; '8.04' (material
         médico-hospitalar) é só o último recurso, pra nunca ficar sem
         natureza nenhuma. */
      const contaPrevisao = (D.produtos.find(function (x) { return x.id === itensDoGrupo[0].produto; }) || {}).conta || '8.04';
      const prev = criarTitulo({
        _interno: true,
        descricao: 'Previsão de pedido ' + alvo.numero, documento: 'PREV-' + alvo.numero,
        tipo_titulo: 'previsao', credor: cid, conta: contaPrevisao,
        centro: (D.armazem(alvo.armazem) || {}).centro, emissao: U.hoje(),
        origem: 'previsao_compra', origem_ref: alvo.id,
        obs: 'Previsão gerada ao enviar o pedido ' + alvo.numero + ' — some sozinha quando a NF ' +
          'real for lançada na mesma natureza e projeto, ou peça pra cancelar se a compra cair.'
      }, [{ num: 1, venc: venc, comp: U.compDe(venc), valor: totalAlvo }]);
      if (prev.ok) {
        st.parcelas.filter(function (p) { return p.titulo_id === prev.titulo.id; })
          .forEach(function (p) { p.status = 'previsto'; });
        alvo.previsao_titulo_id = prev.titulo.id;
      } else {
        /* Não trava o pedido por causa disso — o compromisso com o
           fornecedor já está feito, e é pior recusar o pedido inteiro
           do que só ficar sem a previsão. Mas o erro tem que aparecer:
           antes sumia calado, e ninguém sabia que o fluxo de caixa
           não tinha essa saída prevista. */
        alvo.previsao_erro = prev.erro;
        logar('compra', alvo.id, 'previsão financeira não criada', prev.erro);
      }
      gerados.push(alvo);
    });
    return { ok: true, pedidos: gerados };
  }

  const compras = f => st.compras.slice().filter(function (r) {
    f = f || {};
    return (!f.status || r.status === f.status) && (!f.armazem || r.armazem === f.armazem);
  }).sort(function (a, b) { return b.numero.localeCompare(a.numero); });
  const compra = id => st.compras.find(function (r) { return r.id === id; }) || null;
  // pedidos esperando entrega, para vincular na entrada de material
  const pedidosAbertos = armazemId => st.compras.filter(function (r) {
    return (r.status === 'pedido' || r.status === 'recebido_parcial') &&
           (!armazemId || r.armazem === armazemId);
  });

  /* ── administração ──────────────────────────────────────*/
  const parametros = () => st.parametros;

  function salvarParametros(d) {
    if (!pode('admin')) return { erro: 'Só o perfil de administração altera parâmetros.' };
    const p = st.parametros;
    if (d.alcada) Object.keys(d.alcada).forEach(function (k) {
      p.alcada[k] = Math.max(0, Math.round((d.alcada[k] || 0) * 100) / 100);
    });
    ['impedir_autoaprovacao', 'impedir_autoaprovacao_compras', 'exigir_anexo'].forEach(function (k) {
      if (d[k] !== undefined) p[k] = !!d[k];
    });
    if (d.travar_competencia_ate !== undefined) p.travar_competencia_ate = d.travar_competencia_ate;
    if (d.nsa_ini !== undefined) p.nsa_ini = parseInt(d.nsa_ini, 10) || 1;
    if (d.nsa_fim !== undefined) p.nsa_fim = parseInt(d.nsa_fim, 10) || 999999;
    logar('parametro', 'geral', 'alterou parâmetros',
      'alçada diretoria ' + U.brl(p.alcada.diretoria) +
      ' · auto-aprovação ' + (p.impedir_autoaprovacao ? 'bloqueada' : 'liberada') +
      ' · anexo ' + (p.exigir_anexo ? 'obrigatório' : 'opcional') +
      (p.travar_competencia_ate ? ' · competência fechada até ' + U.fComp(p.travar_competencia_ate) : ''));
    return { ok: true };
  }

  /* Usuários: quem entra no sistema e com que perfil. */
  function salvarUsuario(d) {
    if (!pode('admin')) return { erro: 'Só o perfil de administração altera usuários.' };
    if (!d.nome) return { erro: 'Informe o nome.' };
    if (!d.perfil) return { erro: 'Informe o perfil.' };
    const alvo = d.id ? D.usuarios.find(function (u) { return u.id === d.id; }) : null;
    if (d.id && !alvo) return { erro: 'Usuário não encontrado.' };
    if (alvo) {
      alvo.nome = d.nome; alvo.perfil = d.perfil; alvo.email = d.email || '';
      alvo.ativo = d.ativo !== false;
      /* Senha provisória: quem marca é a Administração; quem
         desmarca é a própria pessoa, ao escolher a senha dela. */
      if (d.senha_provisoria !== undefined) alvo.senha_provisoria = !!d.senha_provisoria;
      if (alvo.id === st.usuarioId && alvo.perfil !== 'admin' && !D.usuarios.some(function (u) {
        return u.perfil === 'admin' && u.ativo !== false; })) {
        alvo.perfil = 'admin';
        return { erro: 'Ficaria ninguém com perfil de administração — o perfil foi mantido.' };
      }
    } else {
      D.usuarios.push({ id: novoId('u'), nome: d.nome, perfil: d.perfil,
        email: d.email || '', ativo: true });
    }
    logar('usuario', d.id || 'novo', d.id ? 'editou usuário' : 'criou usuário', d.nome + ' · ' + d.perfil);
    return { ok: true };
  }

  // trilha de eventos, com filtro — é a memória de quem fez o quê
  const eventos = f => st.eventos.slice().filter(function (e) {
    f = f || {};
    const dia = (e.em instanceof Date ? e.em.toISOString().slice(0, 10) : '');
    return (!f.usuario || e.usuario === f.usuario) &&
           (!f.entidade || e.entidade === f.entidade) &&
           (!f.de || dia >= f.de) && (!f.ate || dia <= f.ate) &&
           (!f.busca || (e.acao + ' ' + (e.detalhe || '') + ' ' + e.usuario)
              .toLowerCase().indexOf(f.busca.toLowerCase()) > -1);
  }).sort(function (a, b) { return b.em - a.em; });

  /* ── conciliação bancária ───────────────────────────────
     O extrato é a única fonte que diz o que de fato entrou e saiu. Cada
     linha importada vira um registro aqui e é casada com um pagamento
     ou um recebimento. O FITID impede a mesma linha de entrar duas
     vezes, mesmo reimportando período sobreposto.

     A conciliação REGISTRA um fato consumado: por isso ela liquida
     título travado por cadastro incompleto e até título previsto — o
     dinheiro já saiu, travar o registro só criaria divergência. */
  /* De qual conta cadastrada é este arquivo. O OFX traz o banco
     (BANKID) e a conta (ACCTID), e é por eles que o sistema reconhece —
     com três empresas e quatro contas, deixar isso por conta do
     seletor da tela é convite a lançar o extrato do Itaú na conta do
     Bradesco. */
  function contaDoExtrato(lido) {
    if (!lido || !lido.conta) return null;
    const so = v => String(v || '').replace(/\D/g, '').replace(/^0+/, '');
    const bank = so(lido.conta.banco), acct = so(lido.conta.numero);
    if (!acct) return null;
    /* A conta do OFX às vezes vem com o dígito junto, às vezes sem. */
    const bate = (a, b) => a && b && (a === b || a === b + '' || so(a + '') === so(b + ''));
    return D.bancos.find(function (b) {
      const c = so(b.conta), cdv = so(String(b.conta || '') + String(b.conta_dv || ''));
      const mesmoBanco = !bank || !b.banco || so(b.banco) === bank;
      return mesmoBanco && (bate(acct, c) || bate(acct, cdv));
    }) || null;
  }

  function importarExtrato(bancoId, lido, nomeArquivo) {
    if (!pode('pagar')) return { erro: 'Seu perfil não faz conciliação.' };
    if (!bancoId) return { erro: 'Escolha a conta bancária.' };
    if (!lido || !lido.lancamentos) return { erro: 'Extrato não reconhecido.' };

    /* Arquivo de outra conta: avisa antes de misturar extrato de
       empresas diferentes. */
    const daConta = contaDoExtrato(lido);
    if (daConta && daConta.id !== bancoId) {
      const e1 = D.empresaPor(daConta.empresa) || {}, e2 = D.empresaPor(empresaDaConta(bancoId)) || {};
      return { erro: 'Este extrato é da conta ' + daConta.apelido + ' (' + (e1.apelido || '') +
        '), mas a tela está na ' + ((D.bancos.find(function (b) { return b.id === bancoId; }) || {}).apelido || '') +
        ' (' + (e2.apelido || '') + '). Troque a conta na tela ou confirme que quer importar assim mesmo.',
        conta_certa: daConta.id, divergente: true };
    }
    if (!daConta && lido.conta && lido.conta.numero) {
      /* Conta não cadastrada: não impede, mas registra o aviso — é
         assim que se descobre agência/conta faltando no cadastro. */
      lido.aviso_conta = 'A conta ' + lido.conta.numero + ' do arquivo não está cadastrada no sistema. ' +
        'Confira o cadastro da conta para o reconhecimento automático funcionar.';
    }

    const ext = {
      id: novoId('ex'), banco: bancoId, arquivo: nomeArquivo || '',
      periodo_ini: lido.periodo.ini, periodo_fim: lido.periodo.fim,
      saldo: lido.saldo.valor, qtd: 0, criado_em: new Date(), usuario: usuario().nome, usuario_id: (usuario() || {}).id || null
    };
    let novos = 0, repetidos = 0;
    lido.lancamentos.forEach(function (l) {
      const chave = bancoId + '|' + l.fitid;
      if (st.linhas.some(function (x) { return x.chave === chave; })) { repetidos++; return; }
      st.linhas.push({
        id: novoId('lx'), chave: chave, extrato_id: ext.id, banco: bancoId,
        data: l.data, valor: l.valor, entrada: l.entrada, saida: l.saida,
        fitid: l.fitid, documento: l.documento, memo: l.memo,
        meio: l.meio, contraparte: l.contraparte, tarifa: l.tarifa,
        situacao: 'pendente', alvo_tipo: null, alvo_id: null, observacao: ''
      });
      novos++;
    });
    ext.qtd = novos;
    /* Extrato que não trouxe nenhum lançamento novo NÃO é gravado:
       reimportar o mesmo arquivo criava um extrato com qtd 0 e o
       mesmo saldo final, e como saldoAtual pega o último, a
       divergência apurada no primeiro desaparecia. A trava de
       conferência de saldo caía com dois cliques. */
    if (!novos) {
      return { ok: true, novos: 0, repetidos: repetidos, extrato: null,
        aviso: 'Este extrato já tinha sido importado: nenhum lançamento novo. ' +
          'A conferência de saldo anterior continua valendo.' };
    }
    st.extratos.push(ext);
    logar('extrato', ext.id, 'importou extrato',
      novos + ' lançamento(s)' + (repetidos ? ', ' + repetidos + ' já existiam' : '') +
      ' · ' + (D.banco ? '' : '') + U.fData(lido.periodo.ini));
    return { ok: true, novos: novos, repetidos: repetidos, extrato: ext };
  }

  const linhasExtrato = f => st.linhas.slice().filter(function (l) {
    f = f || {};
    return (!f.banco || l.banco === f.banco) &&
           (!f.situacao || l.situacao === f.situacao) &&
           (!f.de || l.data >= f.de) && (!f.ate || l.data <= f.ate) &&
           (!f.tipo || (f.tipo === 'entrada' ? l.entrada > 0 : l.saida > 0)) &&
           (!f.busca || (l.memo + ' ' + l.contraparte).toLowerCase().indexOf(f.busca.toLowerCase()) > -1);
  }).sort(function (a, b) { return (b.data + b.id).localeCompare(a.data + a.id); });

  /* ── casamento das linhas do extrato ────────────────────
     Três grupos, e a régua é diferente para cada lado:

     ENTRADA — dinheiro entrando é quase sempre um recebimento nosso, e
     a lista de contas a receber é curta. Valor aproximado ajuda.

     SAÍDA — aqui valor aproximado atrapalha: há centenas de títulos e
     dezenas com valor parecido. Por isso a saída só casa por:
       · pagamento que NÓS mandamos ao banco (valor exato, data perto);
       · REGRA aprendida para aquela contraparte;
       · nome do favorecido batendo com o credor do título.
     Sem isso, vai para "sem vínculo" — melhor pedir do que chutar.

     REGRA é a memória do sistema: "toda saída para JOSE ANTONIO DA
     SILVA é honorário contábil". Ela nasce quando alguém concilia ou
     lança uma linha e marca "lembrar disso". */
  const semAcento = s2 => String(s2 || '').toUpperCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

  /* Semelhança de nome com trava: "SILVA" batendo em "Dr. João Silva"
     não pode virar vínculo. Além da fração, exige DUAS palavras
     significativas em comum quando o nome tem duas ou mais — foi o que
     evitava o PIX do Felipe da Silva casar com o Dr. João Silva. */
  const COMUNS = ['SILVA', 'SANTOS', 'SOUZA', 'SOUSA', 'OLIVEIRA', 'PEREIRA', 'LIMA',
                  'COSTA', 'RIBEIRO', 'ALVES', 'FERREIRA', 'RODRIGUES', 'GOMES', 'MARTINS',
                  'HOSPITAL', 'CLINICA', 'SAUDE', 'MEDIC', 'SERVICOS', 'LTDA', 'ASSOCIACAO'];

  function parecido(a, b) {
    const r = comparar(a, b);
    return r.frac;
  }

  function comparar(a, b) {
    const x = semAcento(a), y = semAcento(b);
    if (!x || !y) return { frac: 0, bate: 0, fortes: 0 };
    const palavras = x.split(/[^A-Z0-9]+/).filter(function (p) { return p.length > 3; });
    if (!palavras.length) return { frac: 0, bate: 0, fortes: 0 };
    /* O extrato corta o nome no meio: "DANIELA GOMES DE SOUZ". Uma
       palavra também conta como casada se o texto TERMINA num pedaço
       dela com 4 letras ou mais — foi ali que a linha foi cortada. */
    const cortada = function (p) {
      for (let k = p.length - 1; k >= 4; k--) {
        if (y.slice(-k) === p.slice(0, k)) return true;
      }
      return false;
    };
    const casadas = palavras.filter(function (p) {
      return y.indexOf(p) > -1 || cortada(p);
    });
    const fortes = casadas.filter(function (p) {
      return COMUNS.indexOf(p) < 0;                 // sobrenome comum não distingue
    }).length;
    return { frac: casadas.length / palavras.length, bate: casadas.length, fortes: fortes };
  }

  // nome só casa se houver duas palavras em comum, sendo ao menos uma distintiva
  function nomeBate(nome, linha) {
    const a = comparar(nome, linha.contraparte);
    const b = comparar(nome, linha.memo);
    const m = a.frac >= b.frac ? a : b;
    const suficiente = (m.bate >= 2 && m.fortes >= 1) || (m.frac >= 0.99 && m.fortes >= 1);
    return { ok: suficiente, frac: m.frac, bate: m.bate, fortes: m.fortes };
  }

  /* ── regras aprendidas ─────────────────────────────────*/
  const chaveContraparte = l => semAcento(l.contraparte || l.memo).slice(0, 40);

  function salvarRegra(d) {
    if (!pode('lancar')) return { erro: 'Seu perfil não cria regras de conciliação.' };
    logar('conciliacao', d.chave || '—', 'guardou regra de conciliação',
      (d.chave || '') + ' → ' + (d.conta || ''));
    if (!d.chave) return { erro: 'Sem contraparte identificada para lembrar.' };
    const existe = st.regras.find(function (r) { return r.chave === d.chave; });
    const alvo = existe || { id: novoId('rg'), chave: d.chave, usos: 0 };
    alvo.credor = d.credor || null;
    alvo.conta = d.conta || null;
    alvo.centro = d.centro || null;
    alvo.descricao = d.descricao || '';
    alvo.criado_por = usuario().nome;
    if (!existe) st.regras.push(alvo);
    logar('regra', alvo.id, existe ? 'atualizou regra' : 'criou regra',
      d.chave + ' → ' + ((D.credor(d.credor) || {}).nome || '') +
      (d.conta ? ' · ' + d.conta : ''));
    return { ok: true, regra: alvo };
  }

  const regras = () => st.regras.slice();
  /* Só numa direção: a chave da regra tem que aparecer dentro do texto
     da linha, nunca o contrário. Bidirecional deixava uma regra com
     chave curta (um sobrenome comum, uma palavra de duas letras)
     bater com qualquer linha cujo texto coubesse dentro dela — e
     linha errada lançada como vínculo concreto é o pior tipo de erro
     de conciliação, porque passa despercebido. */
  const regraDe = l => st.regras.find(function (r) {
    const c = chaveContraparte(l);
    return c && r.chave && c.indexOf(r.chave) > -1;
  }) || null;
  function excluirRegra(id) {
    if (!pode('lancar')) return { erro: 'Seu perfil não exclui regra de conciliação.' };
    const rg = st.regras.find(function (x) { return x.id === id; });
    if (rg) logar('conciliacao', id, 'excluiu regra', rg.chave || '');
    const i = st.regras.findIndex(function (r) { return r.id === id; });
    if (i < 0) return { erro: 'Regra não encontrada.' };
    st.regras.splice(i, 1);
    return { ok: true };
  }

  /* ── candidatos por linha ───────────────────────────────*/
  function candidatos(l) {
    const alvo = Math.abs(l.valor);
    /* Título a receber que é o único daquele valor exato na janela:
       sem nome do cliente no extrato, é isso que sustenta o vínculo. */
    const unicoValor = r => st.receber.filter(function (o) {
      return o.id !== r.id && ['previsto', 'faturado'].indexOf(o.status) > -1 &&
        Math.abs(o.valor_liquido - alvo) <= 0.005;
    }).length === 0;
    const perto = (v) => Math.abs(v - alvo) <= Math.max(0.05, alvo * 0.0001);
    const dias = d2 => Math.abs(U.diasEntre(l.data, d2 || l.data));
    /* De onde é o título — projeto (e o código de reconhecimento que
       alguém tenha cadastrado nele), pra quem concilia saber se o
       candidato é do hospital certo antes de vincular. */
    const centroDaParcela = p => D.centro((p.rateio || [])[0] ? p.rateio[0].centro : p.centro);
    const out = [];

    if (l.saida > 0) {
      /* 1. Pagamento nosso. `liquidado` entra na lista — e é o caso
         MAIS comum, não o mais raro: quem dá baixa manual antes de
         importar o extrato deixa o pagamento liquidado, e ele ficava
         invisível aqui. A linha caía em "sem vínculo" e o buscador
         oferecia a parcela do mês SEGUINTE do mesmo credor, com o
         mesmo valor. Um clique quitava outubro com o dinheiro de
         setembro. */
      /* (integrado do ramo paralelo de QA) O candidato tem de ser da
         MESMA CONTA da linha. A saída de R$ 7.500 do Bradesco casava
         com certeza — entrando direto em "concretos" — com o pagamento
         de R$ 7.500 que saiu do Santander: o extrato de uma conta
         explicava o dinheiro de outra, o pagamento ficava marcado como
         usado, e a linha verdadeira caía em "sem vínculo", onde o
         caminho oferecido é lançar como despesa e duplicar o
         desembolso. Valor e favorecido identificam o pagamento; a
         conta diz se é esta saída. */
      st.pagamentos.filter(function (pg) {
        return !pg.estornado && pg.banco === l.banco &&
          ['liquidado', 'enviado', 'autorizado', 'aguardando'].indexOf(pg.situacao) > -1;
      }).forEach(function (pg) {
        const p = parcela(pg.parcela_id);
        if (!p) return;
        const total = Math.round((pg.valor + pg.juros + pg.multa) * 100) / 100;
        /* Aqui o valor tem de ser IGUAL, não "perto".

           A folga de um centavo existe para arredondamento de cálculo;
           neste ramo ela virava margem de erro: R$ 3.750,10 no extrato
           casava com um pagamento de R$ 3.750,00 de outro credor, e
           como este ramo dá certeza, entrava direto em "concretos". */
        /* Distância de data NÃO exclui candidato.

           A janela de dez dias derrubava o caso normal de antecipação:
           pagamento agendado para o fim do mês que se resolve pagar
           hoje. O que a data faz é ordenar e explicar, não eliminar —
           o que identifica o pagamento é o valor e o favorecido. */
        if (Math.abs(total - alvo) > 0.005) return;
        const jaConciliado = st.linhas.some(function (x) {
          return x.situacao === 'conciliado' && x.alvo_tipo === 'pagamento' && x.alvo_id === pg.id;
        });
        if (jaConciliado) return;

        /* E o nome tem de bater, como já batia no ramo das parcelas.

           Sem isso, dois pagamentos do mesmo dia e do mesmo valor eram
           intercambiáveis: "PIX ENVIADO DRA MARINA ALVES" apontava para
           a Advocacia Ribeiro & Sá só porque o valor coincidia. Quando
           o extrato não traz favorecido legível, o vínculo continua
           valendo — mas só se nenhum OUTRO pagamento do mesmo valor
           estiver na disputa. */
        const nomeCr = (D.credor(p.credor) || {}).nome || '';
        const nb = nomeBate(nomeCr, l);

        /* O nome era CALCULADO e não usado.

           `temNome` olhava só `l.contraparte`, que fica vazia quando o
           histórico não traz marcador (REM:, DES:). Aí caía na regra do
           "nenhum outro pagamento igual" e virava certeza: duas linhas
           de mercearia e de posto de gasolina, ambas de R$ 3.750,00,
           entraram como vínculo concreto no pagamento da Advocacia — e
           as duas no MESMO pagamento.

           Agora o texto limpo do histórico serve de nome quando não há
           marcador: "PAGTO MERCEARIA DO ZE" é nome suficiente para
           dizer que não é a Advocacia. Certeza exige nome compatível;
           sem nome legível nenhum, exige unicidade E data próxima. */
        const nomeLinha = nomeDaLinha(l);
        const temNome = nomeLinha.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 4;
        const disputa = st.pagamentos.filter(function (o) {
          return !o.estornado && o.id !== pg.id &&
            Math.abs(Math.round((o.valor + o.juros + o.multa) * 100) / 100 - alvo) <= 0.005 &&
            Math.abs(U.diasEntre(l.data, o.data || l.data)) <= 10;
        }).length;
        /* Dois nomes próprios sem NENHUMA palavra em comum não é
           candidato — é coincidência de valor com outra pessoa. Um PIX
           para o João Victor Rocha aparecendo como sugestão de vínculo
           de um pagamento já baixado da Maria Dyandra Karolin não ajuda
           ninguém, só confunde (e, se for já baixado, ainda por cima
           não tem como vincular de verdade — ver `liquidar`). Uma
           palavra em comum, mesmo só uma, ainda deixa passar: é o caso
           de abreviação ("Jose Luis da S. Santos" bate com "Jose L. da
           Silva" por "Jose"), e aí quem decide se serve é a pessoa, não
           o sistema. Só corta quando os dois lados têm nome de verdade
           (não é o caso de um TED ou PIX genérico, sem favorecido
           legível) e o resultado é zero. */
        const credorTemNome = nomeCr.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 4;
        if (temNome && credorTemNome && nb.bate === 0) return;
        /* Não descarta o candidato: o que o nome decide é a CERTEZA,
           não a existência. Sumir com ele jogaria a linha para "sem
           vínculo" e esconderia justamente a lista que ajuda a
           escolher. */
        /* Data: o mesmo dia (ou um de folga) é o normal de um PIX. Nove
           dias de diferença não sustentam certeza. */
        /* Com favorecido legível, o nome decide — a data pode estar
           longe, e estar longe é justamente o caso da antecipação.
           Sem favorecido legível, o que sustenta a certeza é ser o
           único pagamento daquele valor na janela. */
        const seguro = temNome ? nb.ok : disputa === 0;
        const cp = centroDaParcela(p) || {};

        out.push({
          tipo: 'pagamento', id: pg.id, parcela_id: p.id,
          nome: nomeCr, valor: total, data: pg.data,
          projeto: cp.curto || cp.nome || '', codigo_hospital: cp.codigo_hospital || '',
          detalhe: (pg.situacao === 'liquidado'
            ? 'pagamento já baixado no sistema'
            : 'pagamento enviado ao banco') + ' · ' + U.brl(total) +
            (dias(pg.data) > 3
              ? ' · agendado para ' + U.fData(pg.data) + ', saiu ' +
                (pg.data > l.data ? 'antes' : 'depois')
              : ''),
          certeza: seguro,
          similaridade: nb.frac,
          motivo: seguro
            ? 'pagamento nosso, valor exato' +
              (temNome ? ' e favorecido confere' : ' e nenhum outro pagamento igual no período') +
              (pg.situacao === 'liquidado' ? ' (baixa já registrada)' : '')
            : temNome
              ? 'valor confere, mas o histórico ("' + nomeLinha.slice(0, 24) +
                '") não bate com ' + nomeCr
              : 'valor confere, mas o extrato não identifica o favorecido e há ' +
                (disputa + 1) + ' pagamentos deste valor no período'
        });
      });

      /* 2. Título cujo credor bate com o favorecido do extrato.

         Aqui faltava a única checagem que importa: o VALOR. O nome
         batendo bastava para entrar na lista, então uma saída de
         R$ 38.720,15 aparecia ao lado de uma parcela de R$ 19.360,00 —
         dois meses de aluguel contra um — e havia botão de vincular em
         lote do lado. Agora a diferença tem teto, e o que passa do
         teto não é candidato: é outra coisa. */
      const TETO = Math.max(1, alvo * 0.02);       // 2% ou R$ 1, o que for maior
      st.parcelas.filter(function (p) {
        return ['aberto', 'parcial', 'previsto'].indexOf(p.status) > -1;
      }).forEach(function (p) {
        const nome = (D.credor(p.credor) || {}).nome || '';
        const nb = nomeBate(nome, l);
        const v = saldoDe(p) || p.valor;
        /* Sem nome de verdade em algum dos dois lados — TED ou PIX
           genérico no extrato, sem favorecido legível, ou título ainda
           sem fornecedor específico cadastrado (previsão de despesa
           por categoria, tipo "Previsão de aluguel" antes de saber
           quem é a imobiliária) — não tem o que comparar, e o valor
           decide sozinho. Com nome dos dois lados e nenhuma palavra em
           comum, a exigência de nome continua: são pessoas ou empresas
           diferentes, não é candidato. */
        const temNomeExtratoP = nomeDaLinha(l).replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 4;
        const credorTemNomeP = nome.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 4;
        if (!nb.ok && temNomeExtratoP && credorTemNomeP) return;
        const dif = Math.round((alvo - v) * 100) / 100;
        if (Math.abs(dif) > TETO) return;
        /* Parcela de outro mês: suspeita, não impedimento.

           A regra nasceu do aluguel — a parcela de outubro sendo
           oferecida para o dinheiro de setembro. Mas pagar hoje o que
           vence no fim do mês, ou no começo do próximo, é rotina de
           antecipação, e travar a certeza em TODO caso de competência
           diferente fazia o sistema desconfiar do normal.

           O que separa os dois casos é a existência de uma parcela
           CONCORRENTE: se há outra em aberto, do mesmo credor e do
           mesmo valor, cuja competência bate com a do extrato, então é
           essa a provável e a de outro mês não pode ser certeza. Não
           havendo concorrente, a antecipação é a única leitura
           possível — e vira vínculo concreto. */
        const outraComp = U.compDe(p.venc || l.data) !== U.compDe(l.data);
        const concorrente = outraComp && st.parcelas.some(function (o) {
          return o.id !== p.id && o.credor === p.credor &&
            ['aberto', 'parcial', 'previsto'].indexOf(o.status) > -1 &&
            Math.abs((saldoDe(o) || o.valor) - alvo) <= 0.05 &&
            U.compDe(o.venc || '') === U.compDe(l.data);
        });
        const outroMes = outraComp && concorrente;
        const cp = centroDaParcela(p) || {};
        out.push({
          tipo: 'parcela', id: p.id, nome: nome, valor: v, data: p.venc,
          projeto: cp.curto || cp.nome || '', codigo_hospital: cp.codigo_hospital || '',
          detalhe: (p.status === 'previsto' ? 'previsto' : 'em aberto') + ' · ' + U.brl(v) +
            ' · vence ' + U.fData(p.venc),
          certeza: perto(v) && nb.bate >= 2 && nb.fortes >= 1 && !outroMes,
          outroMes: outroMes,
          motivo: (nb.ok ? 'favorecido bate com o credor' : 'sem favorecido específico dos dois lados — valor decide') +
            (perto(v) ? ' e o valor confere' : '') +
            (outroMes
              ? ' — mas vence em outra competência, e há parcela do mesmo valor vencendo neste mês'
              : outraComp
                ? ' · vence em ' + U.fData(p.venc) + ', pagamento antecipado'
                : ''),
          similaridade: nb.frac, diferenca: dif
        });
      });
    } else if (l.entrada > 0) {
      /* Entrada: a lista de contas a receber é curta, e quem decide é
         só o valor — nome de cliente aqui é sinal fraco (o extrato
         quase nunca traz o nome de quem pagou de um jeito parecido com
         o cadastro), então não entra na conta nem pra filtrar nem pra
         dar certeza. Pagamento entre o líquido e o bruto do título (a
         retenção real foi menor que a prevista) conta como distância
         zero, não "quase o valor" — é a mesma lógica de receberBaixa. */
      st.receber.filter(function (r) {
        return ['previsto', 'faturado'].indexOf(r.status) > -1;
      }).forEach(function (r) {
        const bruto = r.valor_bruto || r.valor_liquido;
        const dentroFaixa = alvo >= r.valor_liquido - 0.05 && alvo <= bruto + 0.05;
        const dif = dentroFaixa ? 0 : Math.min(Math.abs(r.valor_liquido - alvo), Math.abs(bruto - alvo));
        if (dif / (alvo || 1) > 0.15) return;
        const cr = D.centro(r.centro) || {};
        out.push({
          tipo: 'receber', id: r.id, nome: r.cliente_nome,
          valor: r.valor_liquido, valorBruto: r.valor_bruto, data: r.vencimento,
          projeto: cr.curto || cr.nome || '', codigo_hospital: cr.codigo_hospital || '',
          detalhe: (r.status === 'previsto' ? 'previsto' : 'faturado') + ' · NF ' + r.numero +
            ' · líquido ' + U.brl(r.valor_liquido) + ' · bruto ' + U.brl(r.valor_bruto),
          /* Recebimento adiantado é ainda mais comum que atrasado: o
             cliente paga quando quer. Vencimento distante não tira a
             certeza — quem sustenta é o valor: exato, dentro da faixa
             líquido-bruto, ou único desse valor no período. */
          certeza: (dif <= 0.05 || dentroFaixa) && unicoValor(r),
          motivo: (dentroFaixa && alvo > r.valor_liquido + 0.05 ? 'valor dentro da faixa líquido-bruto do título'
            : dif <= 0.05 ? 'valor exato' : 'valor próximo') +
            (dias(r.vencimento) > 3
              ? ' · vence em ' + U.fData(r.vencimento) +
                (r.vencimento > l.data ? ', recebido antes' : ', recebido depois')
              : ''),
          diferenca: Math.round((alvo - r.valor_liquido) * 100) / 100
        });
      });
    }

    out.forEach(function (c) {
      c.dias = dias(c.data);
      c.diferenca = c.diferenca === undefined ? Math.round((alvo - c.valor) * 100) / 100 : c.diferenca;
    });
    return out.sort(function (a, b) {
      return (b.certeza ? 1 : 0) - (a.certeza ? 1 : 0) ||
             (a.outroMes ? 1 : 0) - (b.outroMes ? 1 : 0) ||
             Math.abs(a.diferenca) - Math.abs(b.diferenca) ||
             (a.dias || 0) - (b.dias || 0);
    });
  }

  /* Divide o extrato nos três grupos que a tela mostra. */
  function classificarLinhas(bancoId) {
    const pend = linhasExtrato({ banco: bancoId, situacao: 'pendente' });
    const concretos = [], possiveis = [], sem = [];
    pend.forEach(function (l) {
      const regra = regraDe(l);
      const cands = candidatos(l);
      const certo = cands.find(function (c) { return c.certeza; });
      if (certo) {
        concretos.push({ linha: l, alvo: certo, cands: cands, regra: regra });
      } else if (regra && l.saida > 0) {
        // regra manda lançar direto na natureza aprendida
        concretos.push({ linha: l, alvo: null, regra: regra, cands: cands, porRegra: true });
      } else if (cands.length) {
        possiveis.push({ linha: l, cands: cands, regra: regra });
      } else {
        sem.push({ linha: l, regra: regra });
      }
    });
    /* Dois extratos apontando para o MESMO título não podem ser os dois
       certos — seria pagar duas vezes. Na dúvida, ambos descem para
       "possíveis" e alguém decide. */
    const usos = {};
    concretos.forEach(function (c) {
      if (!c.alvo) return;
      const k = c.alvo.tipo + ':' + c.alvo.id;
      usos[k] = (usos[k] || 0) + 1;
    });
    const firmes = [], duvidosos = [];
    concretos.forEach(function (c) {
      const k = c.alvo ? c.alvo.tipo + ':' + c.alvo.id : '';
      if (k && usos[k] > 1) duvidosos.push({ linha: c.linha, cands: c.cands, regra: c.regra });
      else firmes.push(c);
    });
    return { concretos: firmes, possiveis: duvidosos.concat(possiveis), sem: sem };
  }

  /* Conciliação em lote: aceita a lista de pares linha→alvo. */
  function conciliarLote(pares) {
    let n = 0, erros = [];
    (pares || []).forEach(function (p) {
      const r = p.alvo ? conciliar(p.linha, p.alvo)
                       : aplicarRegra(p.linha);
      if (r.ok) n++; else erros.push(r.erro);
    });
    /* `ok` reflete o que aconteceu: devolver true com 100% de erros
       obrigava quem chama a ler `erros.length` para descobrir que
       nada foi feito — e as telas testam `res.erro`. */
    return { ok: n > 0, n: n, erros: erros,
      erro: n === 0 && erros.length ? erros.join('; ') : undefined,
      parcial: n > 0 && erros.length > 0 };
  }

  /* Linha que caiu numa regra: lança e concilia sem perguntar de novo. */
  function aplicarRegra(linhaId) {
    const l = st.linhas.find(function (x) { return x.id === linhaId; });
    if (!l) return { erro: 'Linha não encontrada.' };
    const regra = regraDe(l);
    if (!regra || !regra.conta) return { erro: 'Sem regra aplicável para esta linha.' };
    regra.usos = (regra.usos || 0) + 1;
    return classificarLinha(linhaId, {
      conta: regra.conta, centro: regra.centro, credor: regra.credor,
      descricao: regra.descricao || descricaoDaLinha(l), porLinha: !regra.credor
    });
  }

  /* Lançar várias linhas de uma vez na mesma natureza — o caso das
     tarifas bancárias, que aparecem picadas no extrato. */
  /* Entrada do extrato que não é baixa de nota. Cria o título no contas
     a receber já recebido, na data do extrato, e concilia a linha. */
  function lancarReceitaDoExtrato(linhaId, d) {
    if (!pode('faturar') && !pode('lancar')) {
      return { erro: 'Seu perfil não lança receita.' };
    }
    const l = st.linhas.find(function (x) { return x.id === linhaId; });
    if (!l) return { erro: 'Linha não encontrada.' };
    if (l.situacao !== 'pendente') return { erro: 'Esta linha já foi tratada.' };
    if (!(l.entrada > 0)) return { erro: 'Só linha de crédito vira receita.' };
    if (!d.conta) return { erro: 'Informe a natureza.' };

    const valor = Math.round(Math.abs(l.valor) * 100) / 100;
    const r = {
      id: novoId('cr'), numero: 'EXT-' + String(l.fitid || l.id).slice(-8),
      origem: 'extrato', nf_chave: null,
      cliente_doc: '', cliente_nome: nomeDaLinha(l) || 'Entrada do extrato',
      centro: d.centro || null, conta: d.conta,
      competencia: U.compDe(l.data), emissao: l.data, vencimento: l.data,
      descricao: d.descricao || nomeDaLinha(l),
      valor_bruto: valor, valor_retido: 0, valor_liquido: valor,
      retencoes: [], glosa_prevista: 0, glosa_real: 0,
      status: 'recebido', recebido_em: l.data, valor_recebido: valor,
      baixas: [{ data: l.data, valor: valor, banco: l.banco,
                 usuario: usuario().nome, em: U.hoje() }]
    };
    st.receber.push(r);
    l.situacao = 'conciliado';
    l.alvo_tipo = 'receber';
    l.alvo_id = r.id;
    l.conciliado_em = U.hoje();
    logar('conta_receber', r.id, 'receita lançada pelo extrato',
      U.brl(valor) + ' · ' + (d.descricao || ''));
    return { ok: true, receber: r };
  }

  /* itens aceita tanto o formato antigo (array de ids, todos com a
     mesma natureza/credor/descrição de `d`) quanto um array de
     {id, credorNome, descricao} — a janela de lote editável manda um
     objeto por linha, cada um com o fornecedor e a descrição que o
     usuário confirmou ou mudou pra aquela linha específica. */
  function lancarLote(itens, d) {
    let n = 0, total = 0, erros = [];
    (itens || []).forEach(function (item) {
      const porLinhaObj = item && typeof item === 'object';
      const id = porLinhaObj ? item.id : item;
      const l = st.linhas.find(function (x) { return x.id === id; });
      if (!l) return;
      const dd = porLinhaObj
        ? Object.assign({}, d, { credorNome: item.credorNome || null, descricao: item.descricao || null,
                                  credor: null, porLinha: false })
        : d;
      const r = classificarLinha(id, dd);
      if (r.ok) { n++; total += Math.abs(l.valor); } else erros.push(r.erro);
    });
    return { ok: n > 0, n: n, valor: Math.round(total * 100) / 100, erros: erros,
      erro: n === 0 && erros.length ? erros.join('; ') : undefined,
      parcial: n > 0 && erros.length > 0 };
  }

  /* ── produtividade: o fechamento sai picado no extrato ──
     Um PIX por médico. Agrupa as linhas por fechamento e mostra quem
     já foi identificado e quem falta. */
  const ORDEM_PROD = { nao_pago: 0, identificado: 1, pago: 2 };

  function gruposProdutividade(bancoId) {
    const doBanco = linhasExtrato({ banco: bancoId });
    const pend = doBanco.filter(function (l) {
      return l.situacao === 'pendente' && l.saida > 0; });

    /* Linha já conciliada contra uma parcela: é o que mantém o
       fechamento na tela DEPOIS de resolvido. Sem isso ele sumiria no
       instante em que você termina de conciliar. */
    const jaConciliada = {};
    doBanco.filter(function (l) { return l.situacao === 'conciliado'; }).forEach(function (l) {
      let pid = null;
      if (l.alvo_tipo === 'parcelas') { (l.alvo_ids || []).forEach(function (x) { jaConciliada[x] = l; }); return; }
      if (l.alvo_tipo === 'parcela') pid = l.alvo_id;
      else if (l.alvo_tipo === 'pagamento') {
        const pg = st.pagamentos.find(function (x) { return x.id === l.alvo_id; });
        pid = pg ? pg.parcela_id : null;
      }
      if (pid) jaConciliada[pid] = l;
    });

    const fechamentos = {};

    /* Todo status entra — inclusive pago. O recorte da tela não é por
       status, é por RELAÇÃO COM ESTE EXTRATO: fechamento que não
       encostou no extrato importado não aparece aqui (filtro no fim). */
    st.parcelas.filter(function (p) {
      return p.origem === 'produtividade' &&
             ['cancelado', 'substituido', 'previsto'].indexOf(p.status) < 0;
    }).forEach(function (p) {
      const k = (p.doc || 'fechamento') + '|' + p.comp;
      fechamentos[k] = fechamentos[k] || { chave: k, doc: p.doc, comp: p.comp, itens: [] };
      const nome = (D.credor(p.credor) || {}).nome || '';
      const feita = jaConciliada[p.id] || null;
      const pago = p.status === 'pago';
      const saldo = saldoDe(p);
      const achou = (pago || feita) ? null : pend.find(function (l) {
        const dif = Math.abs(Math.abs(l.valor) - (saldo || p.valor));
        const sim = Math.max(parecido(nome, l.contraparte), parecido(nome, l.memo));
        return !l.usada && (dif <= 0.05 || (sim >= 0.6 && dif / (p.valor || 1) < 0.02)) && sim >= 0.4;
      });
      if (achou) achou.usada = true;
      fechamentos[k].itens.push({
        parcela: p, medico: nome, valor: p.valor, saldo: saldo,
        status: p.status, pago: pago,
        pago_em: p.pago_em || null,
        linha: achou || feita || null,
        conciliada: !!feita,
        /* três estados, nesta ordem de urgência: não pago, saiu no
           extrato mas ainda não conciliado, e pago. */
        situacao: pago ? 'pago' : (achou ? 'identificado' : 'nao_pago')
      });
    });
    pend.forEach(function (l) { delete l.usada; });

    return Object.keys(fechamentos).map(function (k) {
      const f = fechamentos[k];
      const achados = f.itens.filter(function (i) { return i.linha && !i.conciliada; });
      const pagos = f.itens.filter(function (i) { return i.pago; });
      const naoPagos = f.itens.filter(function (i) { return !i.pago; });
      // não pago primeiro, depois o que saiu no extrato, e o pago no fim
      f.itens.sort(function (a, b) {
        return (ORDEM_PROD[a.situacao] || 0) - (ORDEM_PROD[b.situacao] || 0) ||
               String(a.medico).localeCompare(String(b.medico), 'pt-BR');
      });
      const soma = arr => Math.round(arr.reduce(function (s2, i) { return s2 + i.valor; }, 0) * 100) / 100;
      return {
        chave: k, doc: f.doc, comp: f.comp,
        total: f.itens.length, identificados: achados.length,
        pagos: pagos.length, naoPagos: naoPagos.length,
        noExtrato: f.itens.filter(function (i) { return i.linha; }).length,
        faltando: f.itens.filter(function (i) { return !i.pago && !i.linha; }),
        itens: f.itens,
        valorPago: soma(pagos),
        valorAberto: soma(naoPagos),
        valorIdentificado: Math.round(achados.reduce(function (s2, i) {
          return s2 + Math.abs(i.linha.valor); }, 0) * 100) / 100,
        valorTotal: soma(f.itens)
      };
    }).filter(function (f) {
      /* Só fechamento que encostou neste extrato — identificado,
         sugerido ou já conciliado. Ao longo do mês são dezenas de
         fechamentos; listar todos transformaria a tela num arquivo. */
      return f.noExtrato > 0;
    }).sort(function (a, b) {
      // fechamento com pendência primeiro; entre iguais, competência mais nova
      return (b.naoPagos > 0) - (a.naoPagos > 0) ||
             String(b.comp || '').localeCompare(String(a.comp || ''));
    });
  }

  /* Concilia: registra o fato no sistema e amarra a linha. */
  function conciliar(linhaId, alvo) {
    if (!pode('pagar')) return { erro: 'Seu perfil não faz conciliação.' };
    const l = st.linhas.find(function (x) { return x.id === linhaId; });
    if (!l) return { erro: 'Lançamento do extrato não encontrado.' };
    /* Exige PENDENTE: negar só 'conciliado' deixava a linha ignorada
       aceitar vínculo novo. */
    if (l.situacao !== 'pendente') {
      return { erro: l.situacao === 'conciliado'
        ? 'Esta linha já está conciliada.'
        : 'Esta linha está como ' + l.situacao + ' — reabra antes de conciliar.' };
    }

    if (alvo.tipo === 'pagamento') {
      /* Pagamento já liquidado (baixado fora do banco, antes do
         extrato chegar) não pode passar por `liquidar` de novo — a
         trava de status ali existe pra impedir reliquidar o que já foi
         pago, e bloquearia TAMBÉM o vínculo certo, não só o errado.
         Aqui só amarra a linha do extrato ao pagamento que já existe;
         nada muda no pagamento em si. */
      const pg = pagamento(alvo.id);
      if (!pg) return { erro: 'Pagamento não encontrado.' };
      /* Mesma trava de conta, repetida de propósito: `candidatos` já
         não oferece pagamento de outra conta, mas o vínculo também
         chega pelo buscador manual da tela. */
      if (pg.banco && pg.banco !== l.banco) {
        return { erro: 'Este pagamento saiu da conta ' +
          ((D.banco(pg.banco) || {}).apelido || pg.banco) + ', e esta linha é da conta ' +
          ((D.banco(l.banco) || {}).apelido || l.banco) + '.' };
      }
      if (pg.situacao !== 'liquidado') {
        const r = liquidar(alvo.id, { data: l.data, valor: Math.abs(l.valor) });
        if (r.erro) return r;
      }
    } else if (alvo.tipo === 'parcela') {
      const p = parcela(alvo.id);
      if (!p) return { erro: 'Título não encontrado.' };
      if (p.status === 'previsto') {
        // previsto some e vira o título real, pago pelo extrato
        p.status = 'aberto';
        p.origem = 'previsao_efetivada';
        p.valor = Math.abs(l.valor);
        p.obs = 'Efetivado pela conciliação de ' + U.fData(l.data);
        const pv = st.previsoes.find(function (x) { return x.id === p.previsao_id; });
        if (pv) pv.efetivada = true;
      }
      /* Pagamento cruzado vindo do EXTRATO não pergunta: o dinheiro já
         saiu e o banco não desfaz. Registra o mútuo direto e marca a
         origem, para o relatório distinguir o que foi confirmado na
         baixa manual do que foi constatado no extrato. */
      const r = registrarPagamento(alvo.id, {
        data: l.data, valor: Math.abs(l.valor), banco: l.banco,
        situacao: 'liquidado', forma: l.meio || 'Identificado no extrato',
        doc: l.documento, obs: 'Conciliação bancária · ' + l.memo,
        confirmar_cruzamento: true, origem_cruzamento: 'extrato'
      });
      if (r.erro) return r;
    } else if (alvo.tipo === 'receber') {
      /* A conta do extrato é a conta do crédito: é a única hora em que
         o sistema sabe com certeza onde o dinheiro entrou. */
      const r = receberBaixa(alvo.id, { data: l.data, valor: Math.abs(l.valor),
        banco: l.banco, decisao: alvo.decisao });
      if (r.erro) return r;
      if (r.decidir) return r;   // devolve pra tela perguntar antes de marcar como conciliado
    } else {
      return { erro: 'Tipo de vínculo desconhecido.' };
    }

    l.situacao = 'conciliado';
    l.alvo_tipo = alvo.tipo;
    l.alvo_id = alvo.id;
    l.conciliado_em = new Date();
    l.conciliado_por = usuario().nome;
    logar('extrato', l.id, 'conciliou', U.fData(l.data) + ' · ' + U.brl(Math.abs(l.valor)) +
      ' · ' + (l.memo || '').slice(0, 40));
    return { ok: true };
  }

  /* ── uma linha do extrato, vários títulos ──────────────
     A DCTFWeb emite UM DARF com INSS retido, patronal, RAT, terceiros
     e IRRF; o banco mostra UMA saída. Aqui a linha quita vários títulos
     de uma vez, cada um pelo seu saldo — só quando a soma bate com o
     valor da linha (tolerância de 1 centavo). */
  function conciliarVarios(linhaId, parcelaIds) {
    if (!pode('pagar')) return { erro: 'Seu perfil não faz conciliação.' };
    const l = st.linhas.find(function (x) { return x.id === linhaId; });
    if (!l) return { erro: 'Lançamento do extrato não encontrado.' };
    /* Exige PENDENTE: negar só 'conciliado' deixava a linha ignorada
       aceitar vínculo novo. */
    if (l.situacao !== 'pendente') {
      return { erro: l.situacao === 'conciliado'
        ? 'Esta linha já está conciliada.'
        : 'Esta linha está como ' + l.situacao + ' — reabra antes de conciliar.' };
    }
    if (!(l.saida > 0) && !(l.valor < 0)) return { erro: 'Vínculo com vários títulos é só pra saída do extrato.' };
    const ids = (parcelaIds || []).filter(function (x, i, a) { return a.indexOf(x) === i; });
    if (ids.length < 2) return { erro: 'Escolha pelo menos dois títulos (pra um só, use o vínculo normal).' };
    const ps = ids.map(parcela);
    if (ps.some(function (p) { return !p; })) return { erro: 'Título não encontrado.' };
    const invalido = ps.find(function (p) { return ['aberto', 'parcial', 'previsto'].indexOf(p.status) === -1; });
    if (invalido) return { erro: 'O título ' + (invalido.doc || invalido.id) + ' não está em aberto.' };
    const saldos = ps.map(function (p) { return p.status === 'previsto' ? p.valor : saldoDe(p); });
    const soma = Math.round(saldos.reduce(function (a, v) { return a + v; }, 0) * 100) / 100;
    const alvo = Math.round(Math.abs(l.valor) * 100) / 100;
    if (Math.abs(soma - alvo) > 0.01) {
      return { erro: 'Os títulos somam ' + U.brl(soma) + ' e a linha do extrato é de ' + U.brl(alvo) + ' — precisa bater.' };
    }
    // tudo ou nada: se um título falhar, desfaz os pagamentos criados aqui e restaura os previstos
    const pagamentosAntes = {};
    st.pagamentos.forEach(function (pg) { pagamentosAntes[pg.id] = true; });
    const estadoAntes = ps.map(function (p) { return { p: p, status: p.status, origem: p.origem, obs: p.obs }; });
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.status === 'previsto') {
        p.status = 'aberto';
        p.origem = 'previsao_efetivada';
        p.obs = (p.obs ? p.obs + ' · ' : '') + 'Efetivado pela conciliação de ' + U.fData(l.data);
      }
      const r = registrarPagamento(p.id, {
        data: l.data, valor: saldos[i], banco: l.banco, situacao: 'liquidado',
        forma: l.meio || 'Identificado no extrato', doc: l.documento,
        obs: 'Conciliação bancária (pagamento único de ' + ps.length + ' títulos) · ' + (l.memo || '')
      });
      if (r.erro) {
        st.pagamentos.forEach(function (pg) {
          if (!pagamentosAntes[pg.id] && !pg.estornado) {
            pg.estornado = true; pg.motivo_estorno = 'desfeito: conciliação com vários títulos não concluída';
          }
        });
        mudouPagamentos();
        estadoAntes.forEach(function (e) { e.p.status = e.status; e.p.origem = e.origem; e.p.obs = e.obs; recalcular(e.p.id); });
        estadoAntes.forEach(function (e) { e.p.status = e.status; });
        return { erro: 'Título ' + (p.doc || p.id) + ': ' + r.erro + ' — nada foi baixado.' };
      }
    }
    l.situacao = 'conciliado';
    l.alvo_tipo = 'parcelas';
    l.alvo_id = ids[0];
    l.alvo_ids = ids;
    l.conciliado_em = new Date();
    l.conciliado_por = usuario().nome;
    logar('extrato', l.id, 'conciliou com ' + ids.length + ' títulos', U.fData(l.data) + ' · ' + U.brl(alvo));
    return { ok: true, n: ids.length };
  }

  /* Combinações de 2 a 4 títulos em aberto que somam exatamente o valor
     da linha — procura primeiro entre títulos do mesmo favorecido e com
     vencimento perto da data do extrato (é o caso das guias). */
  function gruposQueFecham(l) {
    if (!l || !(Math.abs(l.valor) > 0) || l.entrada > 0) return [];
    const alvo = Math.round(Math.abs(l.valor) * 100);
    const abertos = st.parcelas.filter(function (p) {
      return ['aberto', 'parcial', 'previsto'].indexOf(p.status) > -1 && !emCursoDe(p.id).length &&
        Math.abs(U.diasEntre(p.venc, l.data)) <= 15;
    }).map(function (p) {
      return { p: p, v: Math.round((p.status === 'previsto' ? p.valor : saldoDe(p)) * 100) };
    }).filter(function (x) { return x.v > 0 && x.v < alvo; });
    const porCredor = {};
    abertos.forEach(function (x) { (porCredor[x.p.credor || '-'] = porCredor[x.p.credor || '-'] || []).push(x); });
    const achados = [];
    Object.keys(porCredor).forEach(function (cr) {
      const lista = porCredor[cr].slice(0, 14);
      const n = lista.length;
      (function busca(inicio, escolhidos, soma) {
        if (achados.length >= 5) return;
        if (escolhidos.length >= 2 && soma === alvo) {
          achados.push(escolhidos.map(function (x) { return x.p; }));
          return;
        }
        if (escolhidos.length === 4 || soma >= alvo) return;
        for (let i = inicio; i < n; i++) busca(i + 1, escolhidos.concat([lista[i]]), soma + lista[i].v);
      })(0, [], 0);
    });
    return achados.map(function (grupo) {
      return { ids: grupo.map(function (p) { return p.id; }),
        descricao: grupo.map(function (p) { return descricaoVisivel(p); }).join(' + '),
        valor: Math.round(grupo.reduce(function (a, p) { return a + (p.status === 'previsto' ? p.valor : saldoDe(p)); }, 0) * 100) / 100 };
    });
  }

  /* Linha que não estava prevista: vira lançamento já pago, com a
     natureza e o centro que quem concilia escolher. */
  /* ── nome e fornecedor tirados da própria linha ─────────
     No lote, o que identifica cada lançamento é o favorecido daquela
     linha, não o da primeira. Sem isso o relatório mostra uma médica
     recebendo trinta transferências e as outras nenhuma. */
  const nomeDaLinha = l => (ERP.ofx && ERP.ofx.nomeLimpo)
    ? ERP.ofx.nomeLimpo(l)
    : (l.contraparte || String(l.memo || ''));

  const descricaoDaLinha = l => String(nomeDaLinha(l) || l.memo || '').slice(0, 60);

  /* Tipo do cadastro a partir da natureza: produção médica cadastra
     médico, todo o resto cadastra fornecedor. Uma linha só, usada em
     todo lugar que cadastra um credor na hora — assim não tem como um
     lugar decidir médico e outro decidir fornecedor pro mesmo caso. */
  const tipoCredorPorConta = conta => conta === '3.01' ? 'medico' : 'fornecedor';

  /* Acha o credor por nome já digitado (ou confirmado numa tela); se
     não existir, cadastra na hora — com o tipo certo pra natureza
     escolhida, pra produção médica não virar fornecedor. Nome digitado
     à mão costuma vir completo, então o match é por igualdade, não por
     prefixo. */
  function credorPorNome(nome, conta) {
    nome = (nome || '').trim();
    if (!nome) return null;
    const chave = semAcento(nome);
    let cr = D.credores.find(function (x) { return semAcento(x.nome) === chave; });
    if (!cr) {
      cr = { id: novoId('cr') + '-' + (D.credores.length + 1),
             nome: nome, tipo: tipoCredorPorConta(conta), ativo: true,
             conta_padrao: conta || null, origem: 'conciliação' };
      D.credores.push(cr);
    }
    return cr.id;
  }

  /* Acha o fornecedor pelo nome do extrato; se não existir, cadastra.
     O nome do extrato vem cortado, então a busca também aceita o
     cadastro que COMEÇA com o que o banco mostrou. */
  function credorDaLinha(l, conta) {
    const nome = nomeDaLinha(l);
    if (!nome || nome.replace(/[^A-Za-zÀ-ÿ]/g, '').length < 4) return null;
    const chave = semAcento(nome).replace(/\s+\d+$/, '').trim();   // "... PINHE 1" → "... PINHE"
    if (chave.length < 4) return null;
    let cr = D.credores.find(function (x) {
      const n = semAcento(x.nome);
      return n === chave || n.indexOf(chave) === 0 || chave.indexOf(n) === 0;
    });
    if (!cr) {
      cr = { id: novoId('cr') + '-' + (D.credores.length + 1),
             nome: nome, tipo: tipoCredorPorConta(conta), ativo: true,
             conta_padrao: conta || null, origem: 'conciliação' };
      D.credores.push(cr);
    }
    return cr.id;
  }

  /* O banco da conta, para tarifa e débito. Match EXATO: procurar por
     "Bradesco" dentro do nome pegava "Banco Bradesco — empréstimo" e
     jogava toda tarifa para dentro do empréstimo. */
  function credorDoBanco(bancoId) {
    const b = D.bancos.find(function (x) { return x.id === bancoId; }) || {};
    const curto = (b.apelido || 'Banco').split('—')[0].trim();
    const nome = /^banco\b/i.test(curto) ? curto : 'Banco ' + curto;
    let cr = D.credores.find(function (x) { return semAcento(x.nome) === semAcento(nome); }) ||
             D.credores.find(function (x) { return semAcento(x.nome) === semAcento(curto); });
    if (!cr) {
      cr = { id: novoId('cr'), nome: nome, tipo: 'fornecedor',
             ativo: true, forma_pagamento: 'debito_conta', conta_padrao: '9.01' };
      D.credores.push(cr);
    }
    return cr.id;
  }

  function classificarLinha(linhaId, d) {
    const l = st.linhas.find(function (x) { return x.id === linhaId; });
    if (!l) return { erro: 'Lançamento não encontrado.' };
    if (!d.conta) return { erro: 'Escolha a natureza.' };
    if (l.entrada > 0) return { erro: 'Entrada sem título: vincule a um recebimento.' };

    /* Fornecedor. Quatro caminhos, nesta ordem:
       1. id já resolvido (quem chama já sabe o credor certo);
       2. nome digitado — por linha, no lote editável, ou no
          lançamento individual — acha por igualdade ou cadastra na
          hora, com o tipo certo pra natureza escolhida (produção
          médica cadastra médico, o resto cadastra fornecedor);
       3. `porLinha`: sem nome digitado, cada linha vira o favorecido
          do próprio extrato — é o caso do lote de repasse médico, em
          que copiar o nome do primeiro para todos os outros falseia o
          relatório;
       4. tarifa, IOF e débito de banco, que não têm fornecedor no
          sentido comum: o credor é o próprio banco da conta. */
    let credor = d.credor || null;
    if (!credor && d.credorNome) credor = credorPorNome(d.credorNome, d.conta);
    if (!credor && d.porLinha && !l.tarifa) credor = credorDaLinha(l, d.conta);
    if (!credor) credor = credorDoBanco(l.banco);

    /* NF é OPCIONAL aqui: o caso típico é tarifa, imposto e débito
       automático, que não têm nota. Quem tiver a nota informa o número
       (e anexa o arquivo) na hora; quem não tiver, marca dispensada e
       o título não entra no alerta de "pago sem NF". */
    /* O número do documento do EXTRATO (nº do lançamento bancário) não
       é nota fiscal. Antes ele virava o "doc" do título, que então
       parecia ter NF e nunca entrava no alerta de pago sem NF. Agora o
       doc só é preenchido com o que a pessoa digitou; o número do
       banco vai pra observação, que é onde ele ajuda a rastrear. */
    const docBanco = l.documento || l.fitid || '';
    const r = criarTitulo({
      descricao: d.descricao || descricaoDaLinha(l),
      documento: d.documento || null,
      sem_nf: !d.documento,
      tipo_titulo: d.documento ? 'nf' : 'recibo',
      credor: credor, conta: d.conta,
      centro: d.centro || 'cc900', rateio: [{ centro: d.centro || 'cc900', pct: 100 }],
      emissao: l.data, origem: 'conciliacao',
      arquivo: d.arquivo || null,
      nf_dispensada: d.nf_dispensada !== undefined ? !!d.nf_dispensada : false,
      obs: 'Criado pela conciliação · ' + l.memo + (docBanco ? ' · doc. do extrato ' + docBanco : '')
    }, [{ num: 1, venc: l.data, comp: U.compDe(l.data), valor: Math.abs(l.valor) }]);
    if (r.erro) return r;

    const p = st.parcelas.filter(function (x) { return x.titulo_id === r.titulo.id; })[0];
    /* O erro de registrarPagamento não pode ser ignorado: se a baixa
       falhar (perfil sem permissão de pagar, parcela não aprovada
       etc.) e a linha for marcada conciliada do mesmo jeito, o título
       fica aberto no sistema enquanto o extrato diz que já foi pago —
       risco real de pagar de novo. O título já criado fica de pé (é
       uma despesa real), só não marca a linha como resolvida. */
    const rp = registrarPagamento(p.id, {
      data: l.data, valor: Math.abs(l.valor), banco: l.banco, situacao: 'liquidado',
      forma: l.meio || 'Identificado no extrato', doc: l.documento,
      obs: 'Conciliação bancária'
    });
    if (rp.erro) {
      return { erro: 'Título criado (' + (r.titulo.doc || r.titulo.id) + '), mas a baixa falhou: ' +
        rp.erro + ' A linha do extrato continua pendente.' };
    }
    l.situacao = 'conciliado';
    l.alvo_tipo = 'parcela';
    l.alvo_id = p.id;
    l.conciliado_em = new Date();
    l.conciliado_por = usuario().nome;
    l.observacao = 'Lançado pela conciliação';
    logar('extrato', l.id, 'classificou e lançou', U.brl(Math.abs(l.valor)) + ' · ' + d.conta);
    return { ok: true, parcela: p };
  }

  /* Desfazer a conciliação de uma linha sem passar pelo estorno:
       o operador amarrou a linha no título errado. */
  /* Linha marcada como ignorada por engano precisava voltar: antes
     só voltava sendo conciliada, o que é o contrário do que se quer. */
  function reabrirLinha(linhaId, motivo) {
    if (!pode('pagar')) return { erro: 'Seu perfil não faz conciliação.' };
    const l = st.linhas.find(function (x) { return x.id === linhaId; });
    if (!l) return { erro: 'Lançamento não encontrado.' };
    if (l.situacao !== 'ignorado') {
      return { erro: 'Só linha ignorada é reaberta — esta está como ' + l.situacao + '.' };
    }
    l.situacao = 'pendente';
    l.observacao = ((l.observacao || '') + ' · reaberta' + (motivo ? ': ' + motivo : '')).trim();
    logar('extrato', l.id, 'reabriu linha ignorada', U.brl(l.valor) + (motivo ? ' — ' + motivo : ''));
    return { ok: true, linha: l };
  }

  /* Trocar a linha do extrato que comprova um pagamento, sem
     estornar: o operador amarrou a linha errada, o pagamento está
     certo e o dinheiro saiu mesmo. A única saída antes era estornar,
     que destrói informação verdadeira — devolve a parcela para aberto
     e zera o pago. Aqui o pagamento não muda; muda a linha que o
     comprova. */
  function reapontarConciliacao(linhaAtualId, linhaNovaId, motivo) {
    if (!pode('pagar')) return { erro: 'Seu perfil não faz conciliação.' };
    if (!motivo) return { erro: 'Diga por que a linha está sendo trocada.' };
    const atual = st.linhas.find(function (x) { return x.id === linhaAtualId; });
    const nova = st.linhas.find(function (x) { return x.id === linhaNovaId; });
    if (!atual) return { erro: 'Lançamento atual não encontrado.' };
    if (!nova) return { erro: 'Lançamento novo não encontrado.' };
    if (atual.situacao !== 'conciliado') return { erro: 'A linha atual não está conciliada.' };
    if (nova.situacao !== 'pendente') {
      return { erro: 'A linha nova está como ' + nova.situacao + ' — só linha pendente recebe o vínculo.' };
    }
    if (atual.banco !== nova.banco) {
      return { erro: 'As duas linhas são de contas diferentes (' +
        ((D.banco(atual.banco) || {}).apelido || atual.banco) + ' e ' +
        ((D.banco(nova.banco) || {}).apelido || nova.banco) + ').' };
    }
    if (Math.abs(Math.abs(atual.valor) - Math.abs(nova.valor)) > 0.02) {
      return { erro: 'Os valores não batem: ' + U.brl(Math.abs(atual.valor)) + ' contra ' +
        U.brl(Math.abs(nova.valor)) + '. Reapontar só vale para a mesma saída registrada na ' +
        'linha errada.' };
    }
    nova.situacao = 'conciliado';
    nova.alvo_tipo = atual.alvo_tipo;
    nova.alvo_id = atual.alvo_id;
    nova.alvo_ids = atual.alvo_ids ? atual.alvo_ids.slice() : null;
    nova.observacao = ((nova.observacao || '') + ' · vínculo movido de ' + atual.id +
      ': ' + motivo).trim();
    atual.situacao = 'pendente';
    atual.alvo_tipo = null; atual.alvo_id = null; atual.alvo_ids = null;
    atual.observacao = ((atual.observacao || '') + ' · vínculo movido para ' + nova.id +
      ': ' + motivo).trim();
    logar('extrato', nova.id, 'reapontou conciliação',
      U.brl(Math.abs(nova.valor)) + ' — de ' + atual.id + ' para ' + nova.id + ' · ' + motivo);
    return { ok: true, de: atual.id, para: nova.id };
  }

  function desconciliar(linhaId, motivo) {
    if (!pode('pagar')) return { erro: 'Seu perfil não faz conciliação.' };
    if (!motivo) return { erro: 'Diga por que está desfazendo a conciliação.' };
    const l = st.linhas.find(function (x) { return x.id === linhaId; });
    if (!l) return { erro: 'Lançamento não encontrado.' };
    if (l.situacao !== 'conciliado') return { erro: 'Esta linha não está conciliada.' };
    /* Pagamento liquidado por trás é dinheiro que saiu: desfazer a
       amarração sem estornar deixaria o título pago sem lastro. */
    /* O vínculo pode ser com VÁRIOS títulos: `conciliarVarios` grava
       alvo_tipo 'parcelas' (plural) e a lista em alvo_ids. A guarda
       olhava só o singular e o alvo_id, então uma linha que quitou
       dois títulos era solta com os dois pagamentos de pé — e a mesma
       linha podia ser conciliada de novo, pagando o dobro. */
    const alvos = [l.alvo_id].concat(l.alvo_ids || []).filter(Boolean);
    const pgLigado = st.pagamentos.find(function (pg) {
      return !pg.estornado && pg.situacao === 'liquidado' &&
        (alvos.indexOf(pg.parcela_id) >= 0 || alvos.indexOf(pg.id) >= 0);
    });
    if (['parcela', 'parcelas', 'pagamento', 'pagar'].indexOf(l.alvo_tipo) >= 0 && pgLigado) {
      return { erro: 'Esta linha está ligada a pagamento liquidado. Estorne o pagamento — ' +
        'a linha é liberada junto.' };
    }
    /* O lado de ENTRADA tinha a mesma porta aberta: a trava varria só
       os pagamentos, e um crédito conciliado contra uma NF podia ser
       solto com a baixa viva e reconciliado contra outra — a mesma
       entrada de R$ 10.000 somando R$ 20.000 na conta. */
    if (l.alvo_tipo === 'receber') {
      const comBaixa = st.receber.find(function (r) {
        if (alvos.indexOf(r.id) < 0) return false;
        return (r.baixas || []).some(function (b) { return !b.estornada; }) ||
          (r.valor_recebido || 0) > 0.004;
      });
      if (comBaixa) {
        return { erro: 'Esta linha deu baixa em ' + (comBaixa.numero ? 'NF ' + comBaixa.numero : 'um título') +
          '. Estorne o recebimento primeiro — a linha é liberada junto.' };
      }
    }
    const antes = { tipo: l.alvo_tipo, id: l.alvo_id };
    l.situacao = 'pendente'; l.alvo_tipo = null; l.alvo_id = null; l.alvo_ids = null;
    l.observacao = ((l.observacao || '') + ' · desconciliada: ' + motivo).trim();
    logar('extrato', l.id, 'desconciliou', U.brl(l.valor) + ' — ' + motivo +
      (antes.id ? ' (era ' + antes.tipo + ' ' + antes.id + ')' : ''));
    return { ok: true, linha: l };
  }

  function ignorarLinha(linhaId, motivo) {
    /* Sumir com uma linha do extrato é ato de conciliação: mesma
       guarda de `conciliar`. Esta função não tinha nenhuma. */
    if (!pode('pagar')) return { erro: 'Seu perfil não faz conciliação.' };
    const l = st.linhas.find(function (x) { return x.id === linhaId; });
    if (!l) return { erro: 'Lançamento não encontrado.' };
    /* Ignorar uma linha JÁ CONCILIADA apagava a conciliação do painel
       deixando o título pago e o pagamento vivo — estado sem saída,
       porque `desconciliar` passava a recusar ("não está
       conciliada"). E a linha ignorada aceitava vínculo novo. */
    if (l.situacao !== 'pendente') {
      return { erro: l.situacao === 'conciliado'
        ? 'Esta linha já está conciliada. Desfaça a conciliação antes de ignorá-la.'
        : 'Esta linha já está como ' + l.situacao + '.' };
    }
    l.situacao = 'ignorado';
    l.observacao = motivo || 'Ignorado na conciliação';
    logar('extrato', l.id, 'ignorou linha', (motivo || '') + ' · ' + U.brl(Math.abs(l.valor)));
    return { ok: true };
  }

  const extratos = () => st.extratos.slice().reverse();

  /* Fechamento: saldo do extrato contra o saldo do sistema. */
  function resumoConciliacao(bancoId) {
    const linhas = linhasExtrato({ banco: bancoId });
    const pend = linhas.filter(function (l) { return l.situacao === 'pendente'; });
    return {
      total: linhas.length,
      conciliados: linhas.filter(function (l) { return l.situacao === 'conciliado'; }).length,
      ignorados: linhas.filter(function (l) { return l.situacao === 'ignorado'; }).length,
      pendentes: pend.length,
      pendenteEntrada: Math.round(pend.reduce(function (s2, l) { return s2 + l.entrada; }, 0) * 100) / 100,
      pendenteSaida: Math.round(pend.reduce(function (s2, l) { return s2 + l.saida; }, 0) * 100) / 100
    };
  }

  /* ── contratos ──────────────────────────────────────────
     O contrato é a origem de tudo: ele diz quanto cada linha de projeto
     deve faturar por mês, até quando vale e quando reajusta. É dele que
     a previsão deveria nascer, e é a vigência que precisa gritar antes
     de vencer — contrato que caduca sem prorrogação é receita que para
     de um mês para o outro. */
  function salvarContrato(d) {
    d = d || {};
    /* O módulo de contratos tem nível próprio na matriz e não era
       consultado: a guarda derivava de Financeiro, então um perfil
       com contratos em V$ (só leitura) gravava contrato. */
    if (!podeMover('contratos') && !pode('admin')) {
      return { erro: 'Seu perfil não altera contratos.' };
    }
    if (!d.numero) return { erro: 'Informe o número do contrato.' };
    /* Dois tipos de contrato no mesmo módulo: o que a empresa FATURA
       (parte = cliente) e o que a empresa PAGA (parte = fornecedor —
       aluguel, software, contabilidade, manutenção). Os dois têm
       vigência, reajuste e renovação pra acompanhar; muda quem é a
       contraparte e de que lado o dinheiro anda. */
    const parte = d.parte === 'fornecedor' ? 'fornecedor' : 'cliente';
    if (parte === 'cliente' && !d.cliente) return { erro: 'Informe o cliente.' };
    if (parte === 'fornecedor' && !d.fornecedor) return { erro: 'Informe o fornecedor.' };
    if (parte === 'fornecedor' && !d.conta) return { erro: 'Informe a natureza (plano de contas) da despesa.' };
    /* Condições comerciais só entram se fizerem sentido — antes o
       contrato aceitava vencimento dia 45, multa negativa e juros de
       300% ao mês sem reclamar. */
    if (d.dia_vencimento && (d.dia_vencimento < 1 || d.dia_vencimento > 31)) {
      return { erro: 'Dia de vencimento tem que estar entre 1 e 31.' };
    }
    if (d.dia_entrega_nf && (d.dia_entrega_nf < 1 || d.dia_entrega_nf > 31)) {
      return { erro: 'Dia limite para entrega da NF tem que estar entre 1 e 31.' };
    }
    if (d.multa_atraso_pct < 0 || d.juros_mes_pct < 0 || d.prazo_dias < 0 || d.aviso_rescisao_dias < 0) {
      return { erro: 'Multa, juros, prazo e aviso prévio não podem ser negativos.' };
    }
    if (d.multa_atraso_pct > 20) return { erro: 'Multa por atraso de ' + U.num(d.multa_atraso_pct) + '% — confira: o usual é até 2%.' };
    if (d.juros_mes_pct > 20) return { erro: 'Juros de ' + U.num(d.juros_mes_pct) + '% ao mês — confira: o usual é 1% ao mês.' };
    if (!d.vigencia_ini || !d.vigencia_fim) return { erro: 'Informe a vigência.' };
    if (d.vigencia_fim < d.vigencia_ini) return { erro: 'A vigência termina antes de começar.' };
    const itens = (d.itens || []).filter(function (i) { return i.centro; });
    if (!itens.length) return { erro: 'Inclua ao menos uma linha de projeto.' };

    const contraparte = parte === 'fornecedor' ? d.fornecedor : d.cliente;
    // "abc-1" e "ABC-1" são o mesmo contrato
    const mesmoNumero = n => String(n || '').trim().toLowerCase();
    const repetido = st.contratos.find(function (c) {
      return c.id !== d.id && mesmoNumero(c.numero) === mesmoNumero(d.numero) &&
        (c.parte === 'fornecedor' ? c.fornecedor : c.cliente) === contraparte;
    });
    if (repetido) {
      return { erro: 'Já existe contrato ' + d.numero + ' para este ' +
        (parte === 'fornecedor' ? 'fornecedor' : 'cliente') + '.' };
    }

    const alvo = d.id ? st.contratos.find(function (c) { return c.id === d.id; }) : { id: novoId('ct'), aditivos: [] };
    if (!alvo) return { erro: 'Contrato não encontrado.' };
    alvo.parte = parte;
    ['numero', 'tipo', 'cliente', 'fornecedor', 'conta', 'objeto', 'processo', 'vigencia_ini', 'vigencia_fim',
     'renovacao', 'indice', 'reajuste_mes', 'observacao', 'exemplo',
     /* condições comerciais previstas em contrato — usadas no
        vencimento sugerido, na cobrança de atraso e nos alertas */
     'dia_vencimento', 'prazo_dias', 'dia_entrega_nf', 'multa_atraso_pct', 'juros_mes_pct',
     'correcao_atraso', 'regra_reajuste', 'regra_renovacao', 'aviso_rescisao_dias',
     'garantia', 'contato_cobranca'].forEach(function (k) {
      if (d[k] !== undefined) alvo[k] = d[k];
    });
    alvo.itens = itens.map(function (i) {
      return { centro: i.centro, valor: Math.round((i.valor || 0) * 100) / 100 };
    });
    alvo.valor_mensal = Math.round(alvo.itens.reduce(function (s2, i) { return s2 + i.valor; }, 0) * 100) / 100;
    alvo.encerrado = !!d.encerrado;
    if (d.id) alvo.exemplo = false;   // editado por alguém = conferido
    alvo.atualizado_em = new Date();
    if (!d.id) st.contratos.push(alvo);
    logar('contrato', alvo.id, d.id ? 'editou contrato' : 'criou contrato',
      alvo.numero + ' · ' + U.brl(alvo.valor_mensal) + '/mês · até ' + U.fData(alvo.vigencia_fim));
    return { ok: true, contrato: alvo };
  }

  function addAditivo(contratoId, d) {
    if (!podeMover('contratos') && !pode('admin')) {
      return { erro: 'Seu perfil não lança aditivo.' };
    }
    const c = st.contratos.find(function (x) { return x.id === contratoId; });
    if (!c) return { erro: 'Contrato não encontrado.' };
    if (!d.numero) return { erro: 'Informe o número do aditivo.' };
    /* Número repetido: dois cliques no botão aplicavam dois reajustes
       compostos (R$ 10.000 → 11.000 → 12.100), e não há como excluir
       aditivo pela tela. */
    if ((c.aditivos || []).some(function (x) {
      return String(x.numero).trim().toUpperCase() === String(d.numero).trim().toUpperCase();
    })) {
      return { erro: 'Este contrato já tem o aditivo ' + d.numero + '.' };
    }
    /* Percentual sem validação deixava o contrato com valor negativo,
       infinito ou absurdo — irreversível, porque não há como excluir
       o aditivo depois. */
    if (d.percentual !== undefined && d.percentual !== null && d.percentual !== '') {
      const pct = numeroBR(d.percentual);
      if (!isFinite(pct)) return { erro: 'Percentual do aditivo inválido (' + d.percentual + ').' };
      if (pct <= -100) {
        return { erro: 'Percentual de ' + pct + '% zeraria ou inverteria o valor do contrato.' };
      }
      if (pct > 1000) {
        return { erro: 'Percentual de ' + pct + '% parece engano — confira antes de aplicar.' };
      }
      d = Object.assign({}, d, { percentual: pct });
    }
    if (d.tipo === 'prazo' && d.nova_vigencia && d.nova_vigencia < U.hoje()) {
      return { erro: 'Nova vigência (' + U.fData(d.nova_vigencia) + ') está no passado — ' +
        'aditivo de prazo estende o contrato, não encerra ele retroativo. Pra encerrar de verdade, use a ação de encerrar contrato.' };
    }
    /* E nunca antes do início: o contrato terminaria antes de
       começar. */
    if (d.tipo === 'prazo' && d.nova_vigencia && c.vigencia_ini &&
        d.nova_vigencia < c.vigencia_ini) {
      return { erro: 'Nova vigência (' + U.fData(d.nova_vigencia) + ') é anterior ao início do ' +
        'contrato (' + U.fData(c.vigencia_ini) + ').' };
    }
    const a = {
      id: novoId('ad'), numero: d.numero, tipo: d.tipo, data: d.data || U.hoje(),
      nova_vigencia: d.nova_vigencia || '', percentual: d.percentual || 0,
      observacao: d.observacao || '', usuario: usuario().nome, usuario_id: (usuario() || {}).id || null
    };
    c.aditivos = c.aditivos || [];
    c.aditivos.push(a);
    // aditivo de prazo empurra a vigência; de valor reajusta as linhas
    if (a.tipo === 'prazo' && a.nova_vigencia) c.vigencia_fim = a.nova_vigencia;
    if (a.tipo === 'valor' && a.percentual) {
      c.itens.forEach(function (i) { i.valor = Math.round(i.valor * (1 + a.percentual / 100) * 100) / 100; });
      c.valor_mensal = Math.round(c.itens.reduce(function (s2, i) { return s2 + i.valor; }, 0) * 100) / 100;
      /* Sem isso, o alerta de reajuste continuava disparando pra sempre
         depois de aplicado — a data nunca andava, então "atrasado"
         nunca deixava de ser verdade. Reajuste é anual: empurra 12
         meses o próximo. */
      if (c.reajuste_mes) c.reajuste_mes = U.compDe(U.addMeses(c.reajuste_mes + '-01', 12));
    }
    logar('contrato', c.id, 'aditivo ' + a.numero,
      a.tipo + (a.nova_vigencia ? ' até ' + U.fData(a.nova_vigencia) : '') +
      (a.percentual ? ' · ' + U.num(a.percentual) + '%' : ''));
    return { ok: true, aditivo: a };
  }

  /* `parte` filtra entre contrato de cliente (o que faturamos) e de
     fornecedor (o que pagamos). Contrato antigo, sem o campo, conta
     como de cliente. */
  const contratos = f => st.contratos.slice()
    .filter(function (c) { return !f || !f.parte || (c.parte || 'cliente') === f.parte; })
    .sort(function (a, b) { return (a.vigencia_fim || '').localeCompare(b.vigencia_fim || ''); });
  const contrato = id => st.contratos.find(function (c) { return c.id === id; }) || null;
  /* Contrato do projeto, pro faturamento: só os de CLIENTE — um
     contrato de fornecedor no mesmo centro não define o que faturar. */
  const contratoDoProjeto = centroId => st.contratos.find(function (c) {
    return !c.encerrado && (c.parte || 'cliente') === 'cliente' &&
      (c.itens || []).some(function (i) { return i.centro === centroId; });
  }) || null;

  function excluirContrato(id) {
    if (!pode('admin')) return { erro: 'Só o perfil de administração exclui contrato.' };
    const i = st.contratos.findIndex(function (c) { return c.id === id; });
    if (i < 0) return { erro: 'Contrato não encontrado.' };
    const c = st.contratos[i];
    st.contratos.splice(i, 1);
    logar('contrato', id, 'excluiu contrato', (c.numero || '') + ' · ' + (c.objeto || ''));
    return { ok: true };
  }

  /* ── painel de pendências da página inicial ─────────────
     Uma lista só, já filtrada pelo que o perfil enxerga: cada alerta
     diz o que está pendente, quantos, e pra onde ir. A regra do "dia
     10" vale pra produtividade e pro faturamento — antes disso o mês
     ainda está fechando e cobrar seria ruído. */
  function pendenciasHome() {
    const hoje = U.hoje();
    const lista = [];
    const add = function (a) { if (a.n > 0) lista.push(a); };

    if (veModulo('faturamento')) {
      /* 1. Faturamento autorizado pela produtividade e ainda sem NF —
         está liberado pra faturar e ninguém faturou. */
      const semNF = st.receber.filter(function (r) {
        if (r.origem !== 'previsao' || r.status !== 'previsto' || !r.valor_confirmado_produtividade) return false;
        /* Já tem NF ou fatura naquele projeto/competência (mesmo
           aguardando conferência do vínculo)? Então não falta faturar —
           antes o alerta continuava aceso depois da nota lançada. */
        return !st.receber.some(function (x) {
          return ['nota', 'fatura'].indexOf(x.origem) > -1 && x.centro === r.centro &&
            x.competencia === r.competencia && ['cancelado', 'substituido'].indexOf(x.status) < 0;
        });
      });
      add({ id: 'faturar', nivel: 'erro', n: semNF.length,
        titulo: 'Faturamento autorizado esperando NF',
        texto: semNF.length + ' projeto(s) com valor confirmado no fechamento da produtividade e nota ainda não emitida · ' +
          U.brl(Math.round(semNF.reduce(function (a2, r) { return a2 + r.valor_bruto; }, 0) * 100) / 100),
        modulo: 'faturamento', destino: 'cobertura_faturamento' });

      // 3. faturamento da competência anterior sem NF depois do dia 10
      const fp = faturamentoPendente();
      add({ id: 'faturamento_atrasado', nivel: 'erro', n: (fp.faltando || []).length,
        titulo: 'Faturamento atrasado de ' + (fp.competencia ? U.fComp(fp.competencia) : ''),
        texto: (fp.faltando || []).length + ' projeto(s) sem NF/fatura da competência anterior — já passou do dia 10',
        modulo: 'faturamento', destino: 'cobertura_faturamento' });
    }

    // 2. produtividade da competência anterior não lançada depois do dia 10
    if (veModulo('produtividade')) {
      const pp = produtividadePendente();
      add({ id: 'produtividade_atrasada', nivel: 'erro', n: (pp.faltando || []).length,
        titulo: 'Produtividade atrasada de ' + (pp.competencia ? U.fComp(pp.competencia) : ''),
        texto: (pp.faltando || []).length + ' projeto(s) sem fechamento lançado — já passou do dia 10',
        modulo: 'produtividade', destino: 'cobertura_produtividade' });
    }

    if (veModulo('financeiro')) {
      /* Recebimento vencido há mais de 30 dias a partir da previsão:
         passou de atraso normal e virou cobrança — some o valor e diz
         qual é o mais antigo, que é por onde se começa. */
        const limite = U.addDias(hoje, -30);
        const atrasados = st.receber.filter(function (r) {
          return receberVencido(r, hoje) && r.vencimento < limite;
        }).sort(function (a2, b2) { return (a2.vencimento || '').localeCompare(b2.vencimento || ''); });
        const maisAntigo = atrasados[0];
        add({ id: 'receber_atrasado', nivel: 'erro', n: atrasados.length,
          titulo: 'Recebimentos vencidos há mais de 30 dias',
          texto: atrasados.length + ' título(s) · ' +
            U.brl(Math.round(atrasados.reduce(function (a2, r) { return a2 + saldoReceberDe(r); }, 0) * 100) / 100) +
            (maisAntigo ? ' · mais antigo ' + U.fData(maisAntigo.vencimento) + ' (' +
              diasDeAtraso(maisAntigo, hoje) + ' dias) — ' + (maisAntigo.cliente_nome || '') : ''),
          modulo: 'financeiro', destino: 'receber_atrasado' });

      /* Valor confirmado esperando a autorização do órgão: é a etapa
         que trava o faturamento e que ninguém vê se não for lembrada. */
      if (pode('autorizar_faturamento')) {
        const aut = esteiraFaturamento({ pendentes: true })
          .filter(function (l) { return l.etapa === 'confirmado'; });
        add({ id: 'autorizacao_orgao', nivel: 'alerta', n: aut.length,
          titulo: 'Fechamentos esperando autorização do órgão',
          texto: aut.slice(0, 3).map(function (l) {
            return (l.projeto.curto || '') + ' ' + U.fComp(l.competencia) + ' (' + l.dias + 'd)';
          }).join(' · ') + (aut.length > 3 ? ' · e mais ' + (aut.length - 3) : ''),
          modulo: 'faturamento', destino: 'esteira' });
      }

      /* Atestado de capacidade técnica por cliente: a cada 6 meses (ou
         o prazo do cliente) vale pedir um novo, com o que foi prestado
         desde o último. Atestado velho é o que derruba habilitação. */
        const ates = atestadosPendentes();
        add({ id: 'atestado', nivel: 'alerta', n: ates.length,
          titulo: 'Atestados de capacidade técnica a atualizar',
          texto: ates.slice(0, 3).map(function (a2) {
            return a2.cliente.nome.split('—')[0].trim().slice(0, 28) +
              (a2.nunca ? ' (nunca pedido)' : ' (' + a2.dias + ' dias)');
          }).join(' · ') + (ates.length > 3 ? ' · e mais ' + (ates.length - 3) : ''),
          modulo: 'cadastros', destino: 'atestados' });

      // 4. pagamentos já feitos sem NF
      const pagosSemNota = semAnexo();
      add({ id: 'pago_sem_nf', nivel: 'erro', n: pagosSemNota.length,
        titulo: 'Pagamentos sem nota fiscal',
        texto: pagosSemNota.length + ' título(s) pagos e marcados "sem NF" · ' +
          U.brl(Math.round(pagosSemNota.reduce(function (a2, p) { return a2 + pagoDe(p.id); }, 0) * 100) / 100) +
          ' — informe o número da nota quando ela chegar',
        modulo: 'financeiro', destino: 'pago_sem_nf' });
    }

    // 5. aprovações pendentes, por tipo de perfil
    if (pode('aprovar')) {
      const ap = pendentesAprovacao();
      add({ id: 'aprovar_titulos', nivel: 'alerta', n: ap.length,
        titulo: 'Títulos esperando sua aprovação',
        texto: ap.length + ' título(s) · ' + U.brl(Math.round(ap.reduce(function (a2, p) { return a2 + p.valor; }, 0) * 100) / 100),
        modulo: 'financeiro', destino: 'aprovacoes' });
      const pagto = st.parcelas.filter(function (p) { return p.status === 'aguardando'; });
      add({ id: 'autorizar_pagamento', nivel: 'alerta', n: pagto.length,
        titulo: 'Pagamentos esperando autorização',
        texto: pagto.length + ' solicitação(ões) · ' +
          U.brl(Math.round(pagto.reduce(function (a2, p) { return a2 + saldoDe(p); }, 0) * 100) / 100),
        modulo: 'financeiro' });
    }
    if (pode('aprovar_compra')) {
      const reqs = st.compras.filter(function (c) { return c.status === 'requisicao'; });
      add({ id: 'aprovar_requisicao', nivel: 'alerta', n: reqs.length,
        titulo: 'Requisições de compra pra aprovar',
        texto: reqs.length + ' requisição(ões) aguardando a 1ª aprovação', modulo: 'compras', destino: 'compras_aprovar' });
      const cot = st.compras.filter(function (c) { return c.status === 'cotada'; });
      add({ id: 'aprovar_compra', nivel: 'erro', n: cot.length,
        titulo: 'Compras cotadas pra aprovar',
        texto: cot.length + ' cotação(ões) com valores reais esperando sua decisão', modulo: 'compras', destino: 'compras_aprovar' });
    }
    if (pode('comprar')) {
      const cotar = st.compras.filter(function (c) { return c.status === 'aprovada'; });
      add({ id: 'cotar', nivel: 'alerta', n: cotar.length,
        titulo: 'Requisições aprovadas esperando cotação',
        texto: cotar.length + ' requisição(ões) pra cotar', modulo: 'compras', destino: 'compras_cotar' });
      const enviar = st.compras.filter(function (c) { return c.status === 'compra_aprovada'; });
      add({ id: 'enviar_pedido', nivel: 'alerta', n: enviar.length,
        titulo: 'Compras aprovadas pra enviar ao fornecedor',
        texto: enviar.length + ' pedido(s) pra enviar', modulo: 'compras', destino: 'compras_cotar' });
    }
    if (pode('dp')) {
      const fora = [];
      st.folhas.filter(function (f) { return !f.cancelada; })
        .map(function (f) { return f.competencia; })
        .filter(function (c, i, a) { return a.indexOf(c) === i; })
        .forEach(function (c) { funcionariosForaDaFolha(c).forEach(function (f) { fora.push(f); }); });
      add({ id: 'folha_complementar', nivel: 'alerta', n: fora.length,
        titulo: 'Gente fora de folha já fechada',
        texto: fora.length + ' funcionário(s) ficaram de fora — feche uma folha complementar', modulo: 'dp', destino: 'folha' });
    }

    // 6. estoque mínimo (só o que falta na unidade inteira)
    if (veModulo('estoque')) {
      const est = alertasEstoque();
      add({ id: 'estoque_minimo', nivel: 'alerta', n: est.length,
        titulo: 'Material abaixo do mínimo',
        texto: est.length + ' item(ns) abaixo do mínimo na unidade — precisa comprar',
        modulo: 'estoque', destino: 'estoque_minimo' });
      const tr = alertasTransferencia();
      add({ id: 'estoque_transferir', nivel: 'info', n: tr.length,
        titulo: 'Material pra transferir entre setores',
        texto: tr.length + ' item(ns) faltando num setor com saldo em outro da mesma unidade', modulo: 'estoque' });
    }

    // 7 e 8. contratos a vencer e com reajuste nos próximos 30 dias
    if (veModulo('contratos')) {
      const alertas = alertasContrato();
      const vencendo = alertas.filter(function (a2) {
        return (a2.tipo === 'vencendo' && a2.dias <= 30) || a2.tipo === 'vencido';
      });
      add({ id: 'contrato_vencendo', nivel: 'erro', n: vencendo.length,
        titulo: 'Contratos vencendo em 30 dias',
        texto: vencendo.slice(0, 3).map(function (a2) { return a2.contrato.numero + ' ' + a2.texto; }).join(' · ') +
          (vencendo.length > 3 ? ' · e mais ' + (vencendo.length - 3) : ''),
        modulo: 'contratos', destino: 'contratos' });
      const resumo = function (lista) {
        const txt = lista.slice(0, 3).map(function (a2) { return a2.contrato.numero + ' ' + a2.texto; }).join(' · ');
        return lista.length > 3 ? txt + ' · e mais ' + (lista.length - 3) : txt;
      };

      /* Reajuste VENCIDO e não aplicado é cartão próprio, e nunca é
         filtrado por fim de vigência: mesmo que o contrato esteja
         acabando, o reajuste que já era devido gera diferença
         retroativa a cobrar. Juntar com o "próximos 30 dias" escondia
         esse caso atrás de um título que não era o dele. */
      const atrasados = alertas.filter(function (a2) { return a2.tipo === 'reajuste_atrasado'; });
      add({ id: 'contrato_reajuste_atrasado', nivel: 'erro', n: atrasados.length,
        titulo: 'Reajuste vencido e não aplicado',
        texto: resumo(atrasados), modulo: 'contratos', destino: 'contratos' });

      /* Reajuste que ainda vai vencer. Fica de fora só o contrato que
         REALMENTE encerra antes da data ("não renova"): prorrogável e
         renovação automática continuam no alerta, porque o reajuste é
         justamente o que se aplica na prorrogação — excluir todo
         contrato cuja vigência termina antes do mês do reajuste
         escondia o caso mais comum. */
      const reaj = alertas.filter(function (a2) {
        if (a2.tipo !== 'reajuste' || a2.dias > 30) return false;
        const c = a2.contrato;
        const encerraAntes = c.vigencia_fim && c.reajuste_mes && c.vigencia_fim < c.reajuste_mes + '-01';
        return !(encerraAntes && c.renovacao === 'nao');
      });
      add({ id: 'contrato_reajuste', nivel: 'alerta', n: reaj.length,
        titulo: 'Contratos com reajuste nos próximos 30 dias',
        texto: resumo(reaj), modulo: 'contratos', destino: 'contratos' });
    }

    const ordem = { erro: 0, alerta: 1, info: 2 };
    return lista.sort(function (a2, b2) { return ordem[a2.nivel] - ordem[b2.nivel] || b2.n - a2.n; });
  }

  /* Alertas de vigência e de reajuste: 90, 60 e 30 dias. */
  function alertasContrato() {
    const hoje = U.hoje();
    const lista = [];
    st.contratos.forEach(function (c) {
      if (c.encerrado) return;
      const dias = c.vigencia_fim ? U.diasEntre(hoje, c.vigencia_fim) : null;
      if (dias !== null && dias < 0) {
        lista.push({ contrato: c, tipo: 'vencido', dias: dias, nivel: 'erro',
          texto: 'venceu há ' + Math.abs(dias) + ' dias e continua ativo' });
      } else if (dias !== null && dias <= 90) {
        lista.push({ contrato: c, tipo: 'vencendo', dias: dias,
          nivel: dias <= 30 ? 'erro' : 'alerta',
          texto: 'vence em ' + dias + ' dias (' + U.fData(c.vigencia_fim) + ')' });
      }
      /* Reajuste avisa ANTES: 45 dias dão tempo de calcular o índice,
         montar o pedido e protocolar. Depois do mês chegar, o aviso
         muda de tom — já está atrasado. */
      if (c.reajuste_mes) {
        const dataReajuste = c.reajuste_mes + '-01';
        const diasR = U.diasEntre(hoje, dataReajuste);
        const pelo = c.indice ? ' pelo ' + c.indice : '';
        if (diasR < 0) {
          lista.push({ contrato: c, tipo: 'reajuste_atrasado', dias: diasR, nivel: 'erro',
            texto: 'reajuste' + pelo + ' era para ' + U.fComp(c.reajuste_mes) +
              ' e ainda não foi aplicado (há ' + Math.abs(diasR) + ' dias)' });
        } else if (diasR <= 45) {
          lista.push({ contrato: c, tipo: 'reajuste', dias: diasR, nivel: 'alerta',
            texto: 'reajuste' + pelo + ' em ' + diasR + ' dias (' + U.fComp(c.reajuste_mes) +
              ') — hora de solicitar' });
        }
      }
    });
    return lista.sort(function (a, b) { return (a.dias || 0) - (b.dias || 0); });
  }

  /* ── prazos e previsões ─────────────────────────────────
     O prazo conta em DIAS a partir do FIM da competência: competência
     de agosto com 40 dias cai em 10/10. O cliente manda; sem prazo no
     cliente, vale o do projeto. */
  function prazoDe(centroId, clienteDoc) {
    const cli = clienteDoc ? D.clientePorDoc(clienteDoc) : null;
    if (cli && cli.prazo_dias) return { dias: cli.prazo_dias, origem: 'cliente' };
    const c = D.centro(centroId);
    if (c && c.prazo_dias) return { dias: c.prazo_dias, origem: 'projeto' };
    return { dias: 30, origem: 'padrão' };
  }

  function dataPrevista(comp, dias) {
    if (!comp) return '';
    const p = comp.split('-');
    const fimMes = new Date(Date.UTC(+p[0], +p[1], 0));       // último dia da competência
    fimMes.setUTCDate(fimMes.getUTCDate() + (dias || 30));
    return fimMes.toISOString().slice(0, 10);
  }

  /* Previsão estimada: um lançamento por projeto e competência, com o
     faturamento que se espera e a produtividade que se espera pagar.
     As duas datas são a mesma — o repasse ao médico sai no dia em que
     o hospital paga. Projeto de locação não tem produtividade. */
  /* CICLO DE VIDA DA PREVISÃO
       estimada  — veio do cadastro do projeto, ninguém confirmou
       confirmada— o financeiro confirmou no início do mês
       encerrada — não vem mais nada nessa competência

     Enquanto não está encerrada, a previsão contribui para o fluxo com
     o RESÍDUO: previsto menos o que já foi faturado. É isso que permite
     duas notas na mesma competência sem o fluxo derrubar a previsão
     inteira na primeira. Encerrar é o ato que diz "acabou" — aí só o
     real conta e o desvio fica registrado. */
  function residuoPrevisao(pv) {
    if (pv.status === 'encerrada') return { faturamento: 0, produtividade: 0 };
    const real = realizadoDaPrevisao(pv);
    /* PADRÃO: a nota substitui a previsão daquela linha. Quase sempre é
       uma nota por linha de projeto no mês, então chegou a nota, a
       previsão sai do fluxo inteira.

       A exceção se marca na mão: "faturamento parcial" mantém o resíduo
       (previsto − faturado) até alguém encerrar a competência.

       A substituição é por LINHA de projeto, não por hospital: nota de
       cirurgia do SCBM zera a previsão de cirurgia e não encosta em
       anestesia, neo e pediatria, que são centros de custo distintos. */
    /* Confirmada já virou título no contas a receber: o fluxo pega de
       lá, e a previsão deixa de contribuir para não contar duas vezes. */
    const fat = confirmada(pv) ? 0
      : real.faturado > 0.004
        ? (pv.parcial ? Math.max(0, pv.faturamento - real.faturado) : 0)
        : pv.faturamento;
    const prod = real.produzido > 0.004
      ? (pv.parcial ? Math.max(0, pv.produtividade - real.produzido) : 0)
      : pv.produtividade;
    return {
      faturamento: Math.round(fat * 100) / 100,
      produtividade: Math.round(prod * 100) / 100
    };
  }

  function marcarParcial(centro, comp, parcial) {
    const pv = st.previsoes.find(function (p) {
      return p.tipo !== 'despesa' && p.centro === centro && p.competencia === comp;
    });
    if (!pv) return { erro: 'Salve a previsão deste mês antes de marcar como parcial.' };
    pv.parcial = !!parcial;
    logar('previsao', pv.id, parcial ? 'marcou faturamento parcial' : 'desmarcou faturamento parcial',
      (D.centro(centro) || {}).curto + ' · ' + U.fComp(comp));
    return { ok: true };
  }

  /* Confirmar a previsão do mês cria o título no CONTAS A RECEBER com
     situação "previsto": ele já entra no fluxo e aparece na lista, com
     a etiqueta certa, em vez de existir só numa tela paralela.
     Encerrar cancela o que sobrou de previsto. */
  function marcarPrevisoes(comp, status, centro) {
    if (!pode('faturar') && !pode('lancar')) return { erro: 'Seu perfil não marca previsões.' };
    let alvo = st.previsoes.filter(function (p) {
      return p.tipo !== 'despesa' && p.competencia === comp && (!centro || p.centro === centro);
    });
    /* Encerrar UM projeto que ainda não tem previsão no mês: cria o
       registro para marcar. Sem isso, "não fatura nesta competência"
       não tinha o que marcar e o projeto seguia no alerta. */
    if (!alvo.length && centro && status === 'encerrada') {
      const c = D.centro(centro);
      if (!c) return { erro: 'Projeto não encontrado.' };
      const nova = {
        id: novoId('pv'), centro: centro, competencia: comp, tipo: 'receita',
        faturamento: 0, produtividade: 0, status: 'estimada',
        observacao: 'Sem faturamento nesta competência', criado_em: new Date()
      };
      st.previsoes.push(nova);
      alvo = [nova];
    }
    let mantidas = 0;
    alvo.forEach(function (p) {
      /* Confirmar em massa não pode REBAIXAR o que a produtividade já
         confirmou: 'confirmada_prod' é número de medição e vale mais
         que a confirmação genérica da tela de previsões. Encerrar a
         competência continua valendo (é uma decisão explícita). */
      if (p.status === 'confirmada_prod' && status === 'confirmada') { mantidas++; return; }
      p.status = status;
      p.status_em = U.hoje();
      if (confirmada({ status: status })) criarReceberPrevisto(p);
      if (status === 'encerrada') {
        st.receber.filter(function (r) {
          return r.origem === 'previsao' && r.status === 'previsto' &&
                 r.centro === p.centro && r.competencia === p.competencia;
        }).forEach(function (r) {
          r.status = 'cancelado';
          r.observacao = 'Competência encerrada sem faturamento';
        });
      }
    });
    logar('previsao', comp, status === 'encerrada' ? 'encerrou competência' : 'confirmou previsões',
      alvo.length + ' previsão(ões) de ' + U.fComp(comp) +
      (mantidas ? ' · ' + mantidas + ' mantida(s) como confirmadas pela produtividade' : ''));
    return { ok: true, n: alvo.length, mantidas: mantidas };
  }

  /* Previsão de DESPESA: o que se espera pagar e ainda não foi lançado
     — aluguel do mês que vem, folha, imposto. Enquanto não houver
     título lançado naquela natureza, centro e competência, o valor
     previsto entra no fluxo; lançado o título, o real toma o lugar. */
  /* Despesa recorrente — conta de luz, aluguel, folha — se cadastra
     uma vez e se repete pelos meses seguintes. Cada mês vira uma
     previsão própria (dá para ajustar o valor de um mês sem mexer nos
     outros), mas todas carregam o mesmo id de SÉRIE, então dá para
     editar ou apagar o conjunto de uma vez. */
  function salvarPrevisaoDespesa(d) {
    if (!pode('lancar')) return { erro: 'Seu perfil não altera previsões de despesa.' };
    if (!d.conta) return { erro: 'Escolha a natureza.' };
    if (!d.competencia) return { erro: 'Informe a competência.' };
    const repetir = Math.max(1, Math.min(36, parseInt(d.repetir, 10) || 1));
    if (repetir > 1) {
      const serie = d.serie || novoId('sr');
      const dia = String(d.data || (d.competencia + '-10')).slice(-2);
      let n = 0;
      for (let i = 0; i < repetir; i++) {
        const comp = U.compDe(U.addMeses(d.competencia + '-01', i));
        const r = salvarPrevisaoDespesa(Object.assign({}, d, {
          competencia: comp, data: comp + '-' + dia, repetir: 1, serie: serie
        }));
        if (r.ok) n++;
      }
      logar('previsao', serie, 'criou despesa recorrente',
        (D.conta(d.conta) || {}).nome + ' · ' + U.brl(d.valor || 0) + ' × ' + n + ' meses');
      return { ok: true, n: n, serie: serie };
    }
    const achado = st.previsoes.find(function (p) {
      return p.tipo === 'despesa' && p.conta === d.conta &&
             p.centro === (d.centro || null) && p.competencia === d.competencia;
    });
    const alvo = achado || {
      id: novoId('pd'), tipo: 'despesa', conta: d.conta,
      centro: d.centro || null, competencia: d.competencia, status: 'estimada'
    };
    alvo.valor = Math.round((d.valor || 0) * 100) / 100;
    alvo.data = d.data || (d.competencia + '-' + String(d.dia || 10).padStart(2, '0'));
    if (d.serie) alvo.serie = d.serie;
    alvo.descricao = d.descricao || '';
    if (d.credor !== undefined) alvo.credor = d.credor || null;
    if (d.parcial !== undefined) alvo.parcial = !!d.parcial;
    alvo.atualizado_em = new Date();
    if (!achado) {
      alvo.criado_por = usuario().nome;
      alvo.criado_por_id = (usuario() || {}).id || null;
      st.previsoes.push(alvo);
    }
    sincronizarTituloPrevisto(alvo);
    logar('previsao', alvo.id, achado ? 'atualizou previsão de despesa' : 'criou previsão de despesa',
      (D.conta(d.conta) || {}).nome + ' · ' + U.fComp(d.competencia) + ' · ' + U.brl(alvo.valor));
    return { ok: true, previsao: alvo };
  }

  /* A despesa prevista aparece no CONTAS A PAGAR como título
     "previsto" — do mesmo jeito que a previsão confirmada aparece no
     contas a receber. Ele não é selecionável para pagamento nem entra
     em remessa: é lembrete e caixa, não obrigação. Some quando o
     título real daquela natureza, centro e competência é lançado. */
  function sincronizarTituloPrevisto(pv) {
    const jaReal = st.parcelas.some(function (p) {
      return p.origem !== 'previsao' && p.status !== 'cancelado' &&
             p.conta === pv.conta && p.comp === pv.competencia &&
             (!pv.centro || (p.rateio || []).some(function (r) { return r.centro === pv.centro; }));
    });
    const existente = st.parcelas.find(function (p) { return p.previsao_id === pv.id; });
    // já efetivado: não mexe mais — virou título de verdade
    if (existente && existente.status !== 'previsto' && existente.status !== 'substituido') return existente;
    if (jaReal || !pv.valor) {
      if (existente && existente.status === 'previsto') existente.status = 'substituido';
      return;
    }
    const c = D.conta(pv.conta) || {};
    if (existente) {
      existente.valor = pv.valor;
      existente.venc = pv.data;
      existente.comp = pv.competencia;
      existente.descricao = pv.descricao || (c.nome + ' — previsto');
      existente.credor = pv.credor || null;
      existente.status = 'previsto';
      return existente;
    }
    const t = {
      id: novoId('t'), numero: st.titulos.length + 1,
      descricao: pv.descricao || (c.nome + ' — previsto'),
      credor: pv.credor || null, origem: 'previsao', criado_em: new Date()
    };
    st.titulos.push(t);
    const p = {
      id: novoId('p'), titulo_id: t.id, num: 1, total: 1,
      descricao: t.descricao, credor: pv.credor || null, conta: pv.conta,
      centro: pv.centro || 'cc900',
      rateio: [{ centro: pv.centro || 'cc900', pct: 100 }],
      doc: 'PREV-' + pv.competencia.replace('-', ''), tipo_titulo: 'previsao',
      emissao: null, comp: pv.competencia, venc: pv.data,
      valor: pv.valor, valor_pago: 0, pago_em: null,
      status: 'previsto', aprovacao: 'aprovado', aprovado_por: null, motivo: '',
      obs: 'Gerado pela previsão de despesa', arquivo: null, chave: null,
      itens: null, previsao_id: pv.id, criado_por: usuario().nome, criado_em: new Date()
    };
    st.parcelas.push(p);
    return p;
  }

  /* A conta chegou: o título PREVISTO vira título de verdade, no lugar,
     sem redigitar. Ganha credor, documento, valor real, vencimento e o
     código de barras — e a partir daí segue o caminho normal: entra na
     seleção de pagamento e sai na remessa. */
  function efetivarPrevisto(parcelaId, d) {
    if (!pode('lancar')) return { erro: 'Seu perfil não lança título.' };
    const p = parcela(parcelaId);
    if (!p) return { erro: 'Título não encontrado.' };
    if (p.status !== 'previsto') return { erro: 'Este título já foi efetivado.' };
    if (!d.credor || !D.credor(d.credor)) return { erro: 'Informe o fornecedor.' };
    const valor = Math.round((d.valor || 0) * 100) / 100;
    if (!(valor > 0)) return { erro: 'Informe o valor da conta.' };
    if (!d.venc) return { erro: 'Informe o vencimento.' };

    const antes = p.valor;
    const credorAntes = p.credor;
    /* Trocar o favorecido ou aumentar o valor de um previsto na hora de
       efetivar muda o que foi autorizado — volta pra aprovação (e,
       com a auto-aprovação bloqueada, de outra pessoa). Antes o título
       continuava "aprovado": dava pra efetivar o salário de alguém pra
       outro credor com outro valor e o único freio era o pagamento. */
    const mudouCredor = !!credorAntes && credorAntes !== d.credor;
    const subiuValor = valor > antes + 0.004;
    const exigeAprovacao = (mudouCredor || subiuValor) &&
      !(pode('aprovar') && !st.parametros.impedir_autoaprovacao);
    p.credor = d.credor;
    p.valor = valor;
    p.venc = d.venc;
    p.comp = d.comp || p.comp;
    p.doc = d.doc || p.doc;
    /* Preserva o tipo original (folha, férias, 13º, rescisão…) a
       menos que alguém explicitamente escolha outro — antes, não
       informar um tipo na tela de efetivar sobrescrevia qualquer
       título pra "fatura", perdendo a classificação de origem (a
       folha da Camila efetivada por outro perfil virava uma fatura
       comum, sem jeito de saber que era folha só olhando o título). */
    if (d.tipo_titulo) p.tipo_titulo = d.tipo_titulo;
    p.emissao = d.emissao || U.hoje();
    p.codigo_barras = d.codigo_barras || null;
    p.linha_digitavel = d.linha_digitavel || null;
    p.status = 'aberto';
    p.origem = 'previsao_efetivada';
    p.obs = 'Efetivado a partir da previsão' +
      (Math.abs(valor - antes) > 0.004 ? ' (previsto ' + U.brl(antes) + ')' : '') +
      (mudouCredor ? ' · credor alterado de ' + ((D.credor(credorAntes) || {}).nome || credorAntes) : '');
    if (exigeAprovacao) {
      p.aprovacao = 'pendente';
      p.aprovado_por = null; p.aprovado_por_id = null; p.aprovado_em = null;
      p.motivo = (mudouCredor ? 'credor alterado' : '') + (mudouCredor && subiuValor ? ' e ' : '') +
        (subiuValor ? 'valor acima do previsto (' + U.brl(antes) + ' → ' + U.brl(valor) + ')' : '') + ' na efetivação';
    }

    // a previsão não volta a criar título para esta competência
    const pv = st.previsoes.find(function (x) { return x.id === p.previsao_id; });
    if (pv) { pv.efetivada = true; pv.valor_real = valor; }

    logar('conta_pagar', p.id, 'efetivou previsão',
      p.doc + ' · ' + U.brl(valor) +
      (Math.abs(valor - antes) > 0.004 ? ' (previsto ' + U.brl(antes) + ')' : ''));
    return { ok: true, parcela: p, diferenca: Math.round((valor - antes) * 100) / 100, exige_aprovacao: exigeAprovacao };
  }

  const previsoesDespesa = comp => st.previsoes.filter(function (p) {
    return p.tipo === 'despesa' && (!comp || p.competencia === comp);
  });

  function excluirPrevisaoDespesa(id, serieToda) {
    if (!pode('lancar')) return { erro: 'Seu perfil não exclui previsão de despesa.' };
    const pv = st.previsoes.find(function (p) { return p.id === id; });
    if (!pv) return { erro: 'Previsão não encontrada.' };
    /* Série inteira apaga daquele mês em diante: o que já passou fica,
       porque é histórico de previsão contra realizado. */
    const alvo = (serieToda && pv.serie)
      ? st.previsoes.filter(function (p) {
          return p.serie === pv.serie && p.competencia >= pv.competencia; })
      : [pv];
    alvo.forEach(function (p) {
      const par = st.parcelas.find(function (x) { return x.previsao_id === p.id; });
      if (par && par.status === 'previsto') {
        st.parcelas.splice(st.parcelas.indexOf(par), 1);
      }
      const i = st.previsoes.indexOf(p);
      if (i > -1) st.previsoes.splice(i, 1);
    });
    return { ok: true, n: alvo.length };
  }

  // aplica o valor de uma linha aos meses seguintes da mesma série
  function replicarSerieDespesa(id) {
    if (!pode('lancar')) return { erro: 'Seu perfil não replica previsão.' };
    const pv = st.previsoes.find(function (p) { return p.id === id; });
    if (!pv || !pv.serie) return { erro: 'Esta previsão não faz parte de uma série.' };
    const alvo = st.previsoes.filter(function (p) {
      return p.serie === pv.serie && p.competencia > pv.competencia;
    });
    alvo.forEach(function (p) {
      p.valor = pv.valor;
      p.descricao = pv.descricao;
      p.data = p.competencia + '-' + String(pv.data || '').slice(-2);
    });
    logar('previsao', pv.serie, 'replicou valor na série',
      U.brl(pv.valor) + ' em ' + alvo.length + ' mês(es) seguinte(s)');
    return { ok: true, n: alvo.length };
  }

  // o que já foi lançado naquela natureza, centro e competência
  /* Realizado da previsão de despesa.

     A conta estava se comparando consigo mesma: a previsão cria um
     título com status `previsto`, e este filtro contava essa própria
     parcela como realizado. Uma previsão nova de R$ 999 nascia com
     "já lançado R$ 999,00" e "ainda previsto R$ 0,00" — a tela se
     anulava sozinha, e a regra "o lançamento real substitui a
     previsão" passava a valer contra a previsão.

     Realizado é título de verdade: fora o que a própria previsão
     gerou, e fora o que ainda está em status `previsto`. */
  function realizadoDespesa(pv) {
    return Math.round(st.parcelas.filter(function (p) {
      return p.status !== 'cancelado' && p.status !== 'previsto' &&
        p.previsao_id !== pv.id &&
        p.conta === pv.conta && p.comp === pv.competencia &&
        (!pv.centro || (p.rateio || []).some(function (r) { return r.centro === pv.centro; }));
    }).reduce(function (s2, p) { return s2 + p.valor; }, 0) * 100) / 100;
  }

  /* Mesma regra da receita: o título lançado substitui a previsão, a
     não ser que a linha esteja marcada como parcial. */
  function residuoDespesa(pv) {
    /* O título `previsto` que a própria previsão criou NÃO zera o
       resíduo: ele é a previsão, não o realizado. Quem zera é o
       lançamento de verdade. */
    if (pv.status === 'encerrada') return 0;
    const real = realizadoDespesa(pv);
    if (real > 0.004) {
      return pv.parcial ? Math.max(0, Math.round((pv.valor - real) * 100) / 100) : 0;
    }
    return Math.round(pv.valor * 100) / 100;
  }

  /* Dois jeitos de uma previsão virar valor firme:
     - 'confirmada': alguém do financeiro fechou o número estimado;
     - 'confirmada_prod': a responsável pela produtividade FECHOU o
       fechamento do mês e informou o valor a faturar. É outro grau de
       confiança — o número saiu da medição, não de estimativa — e por
       isso tem status próprio na tela e no contas a receber. */
  const confirmada = pv => pv && (pv.status === 'confirmada' || pv.status === 'confirmada_prod');

  /* Chamado quando a produtividade daquele projeto/competência é
     fechada: grava o valor informado, marca a previsão como confirmada
     pela produtividade e atualiza o título previsto do contas a
     receber (que herda o mesmo grau de confiança). */
  /* ── esteira do faturamento ─────────────────────────────
     Confirmar o valor no fechamento NÃO libera faturar. O caminho é:

       1 Previsão           estimativa do mês
       2 Valor confirmado   fechamento da produtividade fechou o número
       3 Autorizado         o órgão autorizou aquele valor (protocolo)
       4 Liberado           o responsável pelo faturamento liberou
       5 Faturado           NF ou fatura emitida

     Quem confirma a produtividade marca a autorização do órgão (é quem
     fala com o hospital); a liberação é de quem responde pelo
     faturamento. São duas mãos diferentes de propósito. */
  const ETAPAS = ['previsao', 'confirmado', 'autorizado', 'liberado', 'faturado'];

  function etapaDaPrevisao(pv) {
    if (!pv) return 'previsao';
    if (pv.liberado_em) return 'liberado';
    if (pv.autorizado_em) return 'autorizado';
    if (pv.status === 'confirmada_prod') return 'confirmado';
    return 'previsao';
  }

  /* Autorização do órgão: quem confirmou o fechamento registra o
     protocolo/ofício com que o hospital aceitou o valor. */
  function autorizarFaturamento(centro, competencia, d) {
    d = d || {};
    /* O protocolo é a razão de existir desta etapa: é o número que
       prova que o órgão autorizou. `liberarFaturamento` recusa com
       "o órgão ainda não autorizou", então a etapa não pode ficar
       sem número. */
    if (!String(d.protocolo || '').trim()) {
      return { erro: 'Informe o protocolo devolvido pelo órgão — é o que prova a autorização.' };
    }
    if (!pode('autorizar_faturamento')) {
      return { erro: 'Seu perfil não registra a autorização do órgão para faturar.' };
    }
    const pv = previsaoDe(centro, competencia);
    if (!pv) return { erro: 'Não há previsão para este projeto nesta competência.' };
    if (pv.status !== 'confirmada_prod' && !(d || {}).sem_produtividade) {
      return { erro: 'O valor ainda não foi confirmado no fechamento da produtividade. ' +
        'Confirme o fechamento antes de registrar a autorização do órgão.' };
    }
    /* Reautorizar substitui o protocolo e o valor autorizado. Pode
       ser legítimo (o órgão corrigiu o ofício), mas apaga o que
       estava registrado — então pergunta antes, e o anterior fica
       no histórico da previsão. */
    if (pv.autorizacao_protocolo && pv.autorizacao_protocolo !== d.protocolo &&
        !d.confirmar_substituicao) {
      return { erro: 'Esta competência já está autorizada pelo protocolo ' +
        pv.autorizacao_protocolo + ' no valor de ' + U.brl(pv.autorizado_valor || 0) +
        '. Confirme a substituição pelo protocolo ' + d.protocolo + '.',
        substitui_autorizacao: true, protocolo_anterior: pv.autorizacao_protocolo };
    }
    if (pv.autorizacao_protocolo && pv.autorizacao_protocolo !== d.protocolo) {
      pv.autorizacoes_anteriores = (pv.autorizacoes_anteriores || []).concat([{
        protocolo: pv.autorizacao_protocolo, valor: pv.autorizado_valor || 0,
        em: pv.autorizado_em, por: pv.autorizado_por }]);
    }
    pv.autorizado_em = d.data || U.hoje();
    pv.autorizado_por = usuario().nome;
    pv.autorizado_por_id = (usuario() || {}).id || null;
    pv.autorizacao_protocolo = d.protocolo;
    pv.autorizacao_obs = d.observacao || '';
    pv.autorizado_valor = pv.faturamento;
    /* Quem confirma a produtividade e autoriza o faturamento é o
       responsável pelo faturamento: não há segunda mão a esperar. A
       liberação acontece junto, registrada como tal, e o projeto já
       entra na fila do RPS em lote. */
    if (!pv.liberado_em) {
      pv.liberado_em = pv.autorizado_em;
      pv.liberado_por = usuario().nome;
      pv.liberado_por_id = (usuario() || {}).id || null;
      pv.liberado_na_autorizacao = true;
    }
    logar('previsao', pv.id, 'registrou autorização do órgão e liberou para faturar',
      (D.centro(centro) || {}).curto + ' · ' + U.fComp(competencia) + ' · ' + U.brl(pv.faturamento) +
      (d.protocolo ? ' · ' + d.protocolo : ''));
    return { ok: true, previsao: pv };
  }

  /* Liberação para faturar: responsabilidade de quem responde pelo
     faturamento. Só depois disso a NF/fatura pode sair. */
  function liberarFaturamento(centro, competencia, d) {
    if (!pode('liberar_faturamento')) {
      return { erro: 'Seu perfil não libera faturamento. Fale com quem responde pelo faturamento.' };
    }
    const pv = previsaoDe(centro, competencia);
    if (!pv) return { erro: 'Não há previsão para este projeto nesta competência.' };
    if (!pv.autorizado_em) {
      return { erro: 'O órgão ainda não autorizou este valor. Sem a autorização, faturar é risco de glosa.' };
    }
    /* Valor mexeu depois da autorização: o que o órgão autorizou não é
       mais o que se pretende faturar. */
    if (pv.autorizado_valor !== undefined && Math.abs((pv.autorizado_valor || 0) - pv.faturamento) > 0.004 && !(d || {}).forcar) {
      return { erro: 'O valor mudou depois da autorização (autorizado ' + U.brl(pv.autorizado_valor) +
        ', hoje ' + U.brl(pv.faturamento) + '). Peça nova autorização ou confirme a liberação assim mesmo.',
        divergencia: true };
    }
    d = d || {};
    pv.liberado_em = d.data || U.hoje();
    pv.liberado_por = usuario().nome;
    pv.liberado_por_id = (usuario() || {}).id || null;
    pv.liberacao_obs = d.observacao || '';
    logar('previsao', pv.id, 'liberou para faturamento',
      (D.centro(centro) || {}).curto + ' · ' + U.fComp(competencia) + ' · ' + U.brl(pv.faturamento));
    return { ok: true, previsao: pv };
  }

  function desfazerEtapaFaturamento(centro, competencia, etapa, motivo) {
    const pv = previsaoDe(centro, competencia);
    if (!pv) return { erro: 'Previsão não encontrada.' };
    if (!motivo) return { erro: 'Informe o motivo.' };
    /* Com documento JÁ EMITIDO na competência, desfazer a liberação
       reabre a porta para uma segunda nota do mesmo contrato — a
       trava de liberação volta a aceitar assim que o `liberado_em`
       existir de novo. A esteira já sabe que está faturado; só não
       estava olhando. */
    const jaFaturado = st.receber.filter(function (r) {
      return r.centro === centro && r.competencia === competencia &&
        ['nota', 'fatura'].indexOf(r.origem) > -1 &&
        ['cancelado', 'substituido'].indexOf(r.status) < 0;
    });
    if (jaFaturado.length) {
      return { erro: 'Esta competência já tem ' + jaFaturado.length + ' documento(s) emitido(s) (' +
        jaFaturado.map(function (r) { return r.numero; }).filter(Boolean).join(', ') +
        '). Cancele o documento antes de desfazer a etapa.',
        documentos: jaFaturado.map(function (r) { return r.id; }) };
    }
    if (etapa === 'liberado') {
      if (!pode('liberar_faturamento')) return { erro: 'Seu perfil não desfaz a liberação.' };
      pv.liberado_em = null; pv.liberado_por = null; pv.liberacao_obs = motivo;
    } else if (etapa === 'autorizado') {
      if (!pode('autorizar_faturamento')) return { erro: 'Seu perfil não desfaz a autorização.' };
      if (pv.liberado_em) return { erro: 'Desfaça a liberação antes de tirar a autorização.' };
      pv.autorizado_em = null; pv.autorizado_por = null; pv.autorizacao_obs = motivo;
    } else return { erro: 'Etapa não pode ser desfeita por aqui.' };
    logar('previsao', pv.id, 'desfez etapa ' + etapa, (D.centro(centro) || {}).curto + ' · ' + motivo);
    return { ok: true };
  }

  /* A esteira: uma linha por projeto/competência, com o carimbo de cada
     etapa, há quantos dias está parada e o que falta. Mais atrasado
     primeiro; faturado vai pro fim. */
  /* Em que pé está a produtividade de um projeto no mês:
       previsto  — só a estimativa do cadastro/previsão
       lançado   — fechamento já lançado (repasse gerado)
       confirmado— o valor a faturar já foi confirmado sobre ela
     O valor mostrado segue o status, sem misturar estimativa com o que
     já é firme. */
  function statusProdutividade(centro, competencia) {
    const lotes = fechamentosVivosDe(centro, competencia);
    const pv = previsaoDe(centro, competencia);
    const lancado = lotes.reduce(function (t, l) { return t + (l.valor || 0); }, 0);
    if (pv && pv.status === 'confirmada_prod') {
      return { status: 'confirmado', valor: pv.produtividade || lancado, lotes: lotes.length };
    }
    if (lotes.length) return { status: 'lancado', valor: lancado, lotes: lotes.length };
    return { status: 'previsto',
      valor: (pv && pv.produtividade) || (D.centro(centro) || {}).prev_produtividade || 0, lotes: 0 };
  }

  const NOME_STATUS_PROD = { previsto: 'previsto', lancado: 'lançado', confirmado: 'confirmado' };

  /* Painel de STATUS: uma linha por projeto e competência, com o
     estágio do faturamento do jeito que a operação fala — previsto,
     confirmado, autorizado para faturar, faturado, recebido. */
  /* Complemento de nota já faturada: chegou relatório depois do
     fechamento e falta faturar uma diferença. Não mexe na nota
     original — é uma cobrança nova, no mesmo projeto e competência,
     marcada como complemento para não parecer duplicidade. */
  function lancarComplementoFaturamento(d) {
    if (!pode('faturar')) return { erro: 'Seu perfil não lança faturamento.' };
    const c = D.centro(d.centro);
    if (!c) return { erro: 'Escolha o projeto do complemento.' };
    if (!(d.valor > 0)) return { erro: 'Informe o valor do complemento.' };
    if (!d.competencia) return { erro: 'Informe a competência.' };
    if (!d.motivo) return { erro: 'Diga o que gerou o complemento — vai na discriminação da nota.' };
    const originais = st.receber.filter(function (r) {
      return r.centro === d.centro && r.competencia === d.competencia &&
        ['nota', 'fatura'].indexOf(r.origem) > -1 &&
        ['cancelado', 'substituido'].indexOf(r.status) < 0 && !r.complemento_de;
    });
    const r = criarReceber({
      numero: d.numero || '',
      emissao: d.emissao || U.hoje(),
      centro: d.centro, competencia: d.competencia,
      vencimento: d.vencimento || U.addDias(U.hoje(), c.prazo_dias || 30),
      valor_bruto: d.valor,
      cliente_nome: (D.clienteDoCentro(d.centro) || {}).nome || '',
      origem: 'nota', forcar_sem_liberacao: true,
      discriminacao: 'Complemento de faturamento · ' + U.fComp(d.competencia) + ' · ' + d.motivo,
      observacao: d.motivo
    });
    if (r.erro) return r;
    r.receber.complemento_de = originais.map(function (x) { return x.numero || x.id; });
    r.receber.complemento = true;
    logar('receber', r.receber.id, 'lançou complemento de faturamento',
      (c.curto || '') + ' · ' + U.fComp(d.competencia) + ' · ' + U.brl(d.valor) + ' · ' + d.motivo +
      (originais.length ? ' (complementa ' + r.receber.complemento_de.join(', ') + ')' : ''));
    return { ok: true, receber: r.receber, originais: originais.length };
  }

  function statusFaturamento(f) {
    f = f || {};
    const linhas = esteiraFaturamento({ competencia: f.competencia, centro: f.centro,
      sem_agrupar: f.sem_agrupar, todos: true });
    const out = linhas.map(function (l) {
      const centros = l.eh_grupo ? l.especialidades.map(function (e) { return e.centro; }) : [l.centro];
      /* Recebido é o que o dinheiro diz, não a esteira: se as notas do
         projeto no mês foram baixadas, o ciclo fechou. */
      const notas = st.receber.filter(function (r) {
        return centros.indexOf(r.centro) > -1 && r.competencia === l.competencia &&
          ['cancelado', 'substituido'].indexOf(r.status) < 0;
      });
      const bruto = Math.round(notas.reduce(function (t, r) { return t + (r.valor_bruto || 0); }, 0) * 100) / 100;
      const recebido = Math.round(notas.reduce(function (t, r) { return t + (r.valor_recebido || 0); }, 0) * 100) / 100;
      let status = l.etapa;
      /* Sem previsão lançada é o estado mais acionável desta tela —
         alguém precisa lançar. Antes aparecia como "previsão", igual
         a quem já tinha lançado e aguardava a etapa seguinte. */
      if (l.sem_previsao && !bruto) status = 'sem_previsao';
      else if (l.etapa === 'faturado' && bruto > 0 && recebido >= bruto - 0.05) status = 'recebido';
      else if (l.etapa === 'faturado' && recebido > 0) status = 'recebido_parcial';
      return Object.assign({}, l, {
        status: status, faturado_bruto: bruto, recebido: recebido,
        notas: notas.map(function (r) { return r.numero; }).filter(Boolean)
      });
    });
    return f.status ? out.filter(function (l) { return l.status === f.status; }) : out;
  }

  const NOME_STATUS_FAT = {
    sem_previsao: 'sem previsão', previsao: 'previsto',
    confirmado: 'valor confirmado', autorizado: 'autorizado pelo órgão',
    liberado: 'autorizado para faturar', faturado: 'faturado',
    recebido_parcial: 'recebido em parte', recebido: 'recebido'
  };

  /* Resultado por projeto no mês: o que entra, o que sai e o que sobra,
     com os impostos que o próprio cadastro do projeto define. */
  function resultadoFaturamento(f) {
    f = f || {};
    return statusFaturamento(f).map(function (l) {
      const c = l.projeto || {};
      const centros = l.eh_grupo ? l.especialidades.map(function (e) { return e.centro; }) : [l.centro];
      const faturamento = l.faturado_bruto > 0 ? l.faturado_bruto : (l.valor || 0);

      /* Custo: repasse médico onde há produtividade; onde o projeto é de
         locação, o custo mensal dos equipamentos (depreciação). */
      const prod = l.prod || { valor: 0, status: 'previsto' };
      let custo = prod.valor || 0;
      let tipoCusto = 'produtividade';
      if (!custo) {
        const dep = centros.reduce(function (t, id) {
          return t + st.ativos.filter(function (a) {
            return !a.desmembrado && situacaoAtiva(a).projeto === id;
          }).reduce(function (x, a) { return x + depreciacaoDoAtivo(a).mensal; }, 0);
        }, 0);
        if (dep > 0) { custo = Math.round(dep * 100) / 100; tipoCusto = 'locação (custo mensal)'; }
      }

      /* Impostos previstos sobre o faturamento, pelas alíquotas do
         projeto (é o que o a receber já usa para o líquido). */
      const imp = (l.eh_grupo ? (D.centro(centros[0]) || {}) : c).impostos || {};
      const pct = (imp.iss || 0) + (imp.pis_cofins || 0) + (imp.irpj || 0) + (imp.csll || 0);
      const impostos = Math.round(faturamento * pct) / 100;
      const lucro = Math.round((faturamento - custo - impostos) * 100) / 100;
      return Object.assign({}, l, {
        faturamento: faturamento, custo: custo, tipo_custo: tipoCusto,
        impostos: impostos, impostos_pct: Math.round(pct * 100) / 100,
        lucro: lucro,
        margem: faturamento > 0 ? Math.round(lucro / faturamento * 1000) / 10 : null
      });
    });
  }

  function esteiraFaturamento(f) {
    f = f || {};
    const hoje = U.hoje();
    const linhas = [];
    const vistos = {};
    const add = function (centro, competencia) {
      const chave = centro + '|' + competencia;
      if (vistos[chave]) return;
      vistos[chave] = true;
      const c = D.centro(centro);
      if (!c || c.tipo !== 'projeto') return;
      const pv = previsaoDe(centro, competencia);
      const docs = st.receber.filter(function (r) {
        return r.centro === centro && r.competencia === competencia &&
          ['nota', 'fatura'].indexOf(r.origem) > -1 && ['cancelado', 'substituido'].indexOf(r.status) < 0;
      });
      const etapa = docs.length ? 'faturado' : etapaDaPrevisao(pv);
      const desde = docs.length ? (docs[0].emissao || hoje)
        : (pv && pv.liberado_em) || (pv && pv.autorizado_em) ||
          (pv && pv.confirmado_em && U.dataLocal(pv.confirmado_em)) ||
          (pv && pv.atualizado_em && U.dataLocal(pv.atualizado_em)) || (competencia + '-01');
      linhas.push({
        centro: centro, projeto: c, competencia: competencia, previsao: pv || null,
        etapa: etapa, indice: ETAPAS.indexOf(etapa),
        /* Projeto SEM PREVISÃO salva no mês é um estado em si, e o
           mais acionável da tela: é o que alguém precisa lançar. Sem
           distinguir, ele se confundia com quem já tem previsão e
           aguarda a etapa seguinte. `estimado` traz o valor do
           cadastro, que serve de ponto de partida. */
        sem_previsao: !pv,
        estimado: pv ? null : (c.prev_faturamento || 0),
        prod: statusProdutividade(centro, competencia),
        valor: docs.length ? Math.round(docs.reduce(function (a, r) { return a + r.valor_bruto; }, 0) * 100) / 100
          : (pv ? pv.faturamento : 0),
        documentos: docs.map(function (r) { return r.numero; }),
        parado_desde: desde,
        dias: U.diasEntre(desde, hoje),
        confirmado_em: pv && pv.confirmado_em ? U.dataLocal(pv.confirmado_em) : null,
        confirmado_por: pv ? pv.confirmado_por : null,
        autorizado_em: pv ? pv.autorizado_em : null,
        autorizado_por: pv ? pv.autorizado_por : null,
        protocolo: pv ? pv.autorizacao_protocolo : '',
        liberado_em: pv ? pv.liberado_em : null,
        liberado_por: pv ? pv.liberado_por : null,
        faturado_em: docs.length ? docs[0].emissao : null
      });
    };

    const comps = {};
    st.previsoes.filter(function (p) { return p.tipo !== 'despesa'; })
      .forEach(function (p) { comps[p.centro + '|' + p.competencia] = true; });
    st.receber.forEach(function (r) {
      if (['nota', 'fatura', 'previsao'].indexOf(r.origem) > -1 && r.centro && r.competencia) {
        comps[r.centro + '|' + r.competencia] = true;
      }
    });
    /* TODO PROJETO ATIVO aparece na competência pedida, mesmo sem
       previsão salva e sem nota. Antes a lista vinha só do que já
       tinha movimento — e projeto esquecido no mês ficava invisível
       justamente na tela que existe para encontrá-lo. Quem não tem
       nada entra com status "sem previsão", que é a informação mais
       útil dessa tela. */
    if (f.competencia) {
      D.centros.forEach(function (c) {
        if (c.tipo !== 'projeto' || c.ativo === false) return;
        comps[c.id + '|' + f.competencia] = true;
      });
    }

    Object.keys(comps).forEach(function (k) {
      const partes = k.split('|');
      add(partes[0], partes[1]);
    });

    /* GRUPO DE FATURAMENTO: o GHC-HGB tem produtividade por
       especialidade e nota ÚNICA. Na esteira ele é uma linha só, com as
       especialidades dentro — cada uma continua visível, mas o
       faturamento (valor, autorização, liberação) é do conjunto. */
    let lista = linhas;
    if (!f.sem_agrupar) {
      const grupos = {};
      const soltas = [];
      linhas.forEach(function (l) {
        const g = l.projeto.grupo_faturamento;
        if (!g) return soltas.push(l);
        const k = g + '|' + l.competencia;
        if (!grupos[k]) {
          grupos[k] = {
            grupo: g, centro: null, competencia: l.competencia,
            projeto: { curto: g, nome: g + ' (faturamento único)', grupo_faturamento: g },
            especialidades: [], valor: 0, documentos: [], eh_grupo: true,
            /* Quantas especialidades o grupo TEM, não quantas
               apareceram nesta competência: o faturamento é global e
               cobre todas, mesmo as que não lançaram produtividade. */
            total_especialidades: projetosDoGrupo(g).length
          };
        }
        grupos[k].especialidades.push(l);
      });
      Object.keys(grupos).forEach(function (k) {
        const g = grupos[k];
        const esp = g.especialidades;
        /* A etapa do grupo é a MENOR entre as especialidades: o
           faturamento só anda quando o conjunto está pronto. */
        const atras = esp.slice().sort(function (a, b) { return a.indice - b.indice; })[0];
        const comValor = esp.filter(function (e) { return e.valor > 0; });
        g.etapa = atras.etapa;
        g.indice = atras.indice;
        /* O valor do grupo é o do faturamento único: se alguma
           especialidade concentra a nota, é ela; senão, a soma. */
        g.valor = Math.round(esp.reduce(function (t, e) { return t + (e.valor || 0); }, 0) * 100) / 100;
        g.documentos = esp.reduce(function (t, e) { return t.concat(e.documentos || []); }, []);
        g.centro = (comValor[0] || esp[0]).centro;
        g.previsao = (comValor[0] || esp[0]).previsao;
        g.parado_desde = esp.reduce(function (t, e) {
          return !t || e.parado_desde < t ? e.parado_desde : t; }, null);
        g.dias = U.diasEntre(g.parado_desde, hoje);
        ['confirmado_em', 'confirmado_por', 'autorizado_em', 'autorizado_por', 'protocolo',
         'liberado_em', 'liberado_por', 'faturado_em'].forEach(function (campo) {
          const achou = esp.find(function (e) { return e[campo]; });
          g[campo] = achou ? achou[campo] : null;
        });
        /* O status de produtividade do grupo é o do conjunto: o mais
           atrasado entre as especialidades manda. */
        const ordemP = { previsto: 0, lancado: 1, confirmado: 2 };
        const sts = esp.map(function (e) { return statusProdutividade(e.centro, e.competencia); });
        g.prod = {
          status: sts.slice().sort(function (x, y) { return ordemP[x.status] - ordemP[y.status]; })[0].status,
          valor: Math.round(sts.reduce(function (t, x) { return t + x.valor; }, 0) * 100) / 100,
          lotes: sts.reduce(function (t, x) { return t + x.lotes; }, 0)
        };
        soltas.push(g);
      });
      lista = soltas;
    }
    if (f.competencia) lista = lista.filter(function (l) { return l.competencia === f.competencia; });
    if (f.centro) lista = lista.filter(function (l) { return l.centro === f.centro; });
    if (f.etapa) lista = lista.filter(function (l) { return l.etapa === f.etapa; });
    if (f.pendentes) lista = lista.filter(function (l) { return l.etapa !== 'faturado'; });
    /* Ordem: quem está mais atrás na esteira e parado há mais tempo vem
       primeiro; faturado fecha a lista. */
    /* Ordem pedida por quem usa a tela todo dia:
         1. o que já dá para autorizar (produtividade lançada, valor
            ainda não confirmado) — é a fila de trabalho;
         2. o que já teve o valor confirmado e espera autorização;
         3. o resto, do mais atrasado para o menos;
         4. faturado, no fim. */
    /* Ordem pedida pela operação: primeiro o que está MAIS ADIANTADO e
       ainda pede ação — pronto para faturar, depois esperando
       autorização, depois com valor a confirmar. O que já faturou, e o
       que ainda não tem nada, ficam no fim. */
    const prioridade = function (l) {
      if (l.etapa === 'faturado') return 8;
      if (l.etapa === 'liberado') return 1;      // só falta emitir a nota
      if (l.etapa === 'autorizado') return 2;    // falta liberar
      if (l.etapa === 'confirmado') return 3;    // falta a autorização do órgão
      const centros = l.eh_grupo
        ? l.especialidades.map(function (e) { return e.centro; }) : [l.centro];
      const temProd = centros.some(function (c2) {
        return fechamentosVivosDe(c2, l.competencia).length; });
      if (temProd) return 4;                     // produtividade lançada, falta confirmar o valor
      return 5;                                  // só previsão
    };
    return lista.sort(function (a, b) {
      return prioridade(a) - prioridade(b) || a.indice - b.indice || b.dias - a.dias ||
        String(a.projeto.curto).localeCompare(String(b.projeto.curto), 'pt-BR');
    });
  }

  function confirmarFaturamentoProdutividade(d) {
    if (!pode('faturar') && !pode('lancar') && !pode('produtividade')) {
      return { erro: 'Seu perfil não confirma valor de faturamento.' };
    }
    const c = D.centro(d.centro);
    if (!c) return { erro: 'Projeto não encontrado.' };
    if (!d.competencia) return { erro: 'Informe a competência.' };
    if (!(d.faturamento > 0)) return { erro: 'Informe o valor a faturar confirmado no fechamento.' };
    const anterior = previsaoDe(d.centro, d.competencia);
    const r = salvarPrevisao({
      centro: d.centro, competencia: d.competencia,
      faturamento: d.faturamento,
      produtividade: d.produtividade !== undefined ? d.produtividade
        : (anterior ? anterior.produtividade : 0),
      observacao: d.observacao || (anterior ? anterior.observacao : ''),
      status: 'confirmada_prod',
      /* O `forcar` precisa CHEGAR ao salvarPrevisao: é lá que a troca
         de um faturamento já confirmado exige confirmação explícita.
         Sem repassar, refazer o fechamento do mutirão era impossível
         — e o erro só aparecia depois de as parcelas antigas de
         repasse já terem sido canceladas, deixando os médicos sem
         título a pagar. */
      forcar: !!d.forcar
    });
    if (r.erro) return r;
    r.previsao.confirmado_por = usuario().nome;
    r.previsao.confirmado_por_id = (usuario() || {}).id || null;
    r.previsao.confirmado_em = new Date();
    r.previsao.lote_produtividade = d.lote || null;
    const rec = criarReceberPrevisto(r.previsao);
    if (rec) {
      rec.valor_confirmado_produtividade = true;
      rec.observacao = 'Valor confirmado no fechamento da produtividade por ' + usuario().nome +
        ' em ' + U.fData(U.hoje()) + (d.observacao ? ' · ' + d.observacao : '');
    }
    logar('previsao', r.previsao.id, 'confirmou faturamento pela produtividade',
      (c.curto || '') + ' · ' + U.fComp(d.competencia) + ' · ' + U.brl(d.faturamento) +
      (anterior && anterior.faturamento ? ' (estimativa anterior ' + U.brl(anterior.faturamento) + ')' : ''));
    return { ok: true, previsao: r.previsao, receber: rec, anterior: anterior ? anterior.faturamento : 0 };
  }

  /* Confirmar o valor e autorizar o faturamento é um gesto só para
     quem cuida de produtividade e faturamento: era botão de confirmar,
     depois outro de autorizar, depois um terceiro de liberar. */
  /* No GHC-HGB o faturamento é negociado com o hospital em valor
     GLOBAL: não existe previsão por especialidade. Lançar a
     produtividade da anestesia pede o valor do grupo inteiro, e o
     sistema distribui internamente entre as especialidades (é o que
     sustenta o resultado por projeto e o rateio da nota única). */
  function confirmarFaturamentoGrupo(grupo, competencia, valor, opcoes) {
    opcoes = opcoes || {};
    if (!pode('faturar') && !pode('lancar')) {
      return { erro: 'Seu perfil não confirma valor de faturamento.' };
    }
    const ids = projetosDoGrupo(grupo);
    if (!ids.length) return { erro: 'Nenhum projeto neste grupo de faturamento.' };
    if (!(valor > 0)) return { erro: 'Informe o valor global a faturar do grupo ' + grupo + '.' };
    const r = salvarPrevisaoGrupo(grupo, competencia, valor, { forcar: true });
    if (r.erro) return r;
    /* Cada parte fica com o selo de confirmada: é o mesmo valor
       global, visto por especialidade. */
    const partes = [];
    ids.forEach(function (id) {
      const pv = previsaoDe(id, competencia);
      if (!pv || !(pv.faturamento > 0)) return;
      const c = confirmarFaturamentoProdutividade({
        centro: id, competencia: competencia, faturamento: pv.faturamento,
        produtividade: pv.produtividade || 0,
        observacao: (opcoes.observacao ? opcoes.observacao + ' · ' : '') +
          'parte do faturamento global de ' + U.brl(valor) + ' do grupo ' + grupo,
        lote: opcoes.lote || null
      });
      if (c.ok) partes.push({ centro: id, valor: pv.faturamento });
    });
    logar('previsao', grupo, 'confirmou faturamento global do grupo',
      grupo + ' · ' + U.fComp(competencia) + ' · ' + U.brl(valor) + ' em ' + partes.length + ' especialidade(s)');
    return { ok: true, grupo: grupo, valor: valor, partes: partes };
  }

  function confirmarEAutorizarFaturamento(d) {
    const c = D.centro(d.centro);
    if (!c) return { erro: 'Projeto não encontrado.' };
    /* Especialidade de grupo não tem faturamento próprio: o valor
       negociado é um só, do grupo inteiro. */
    const grupoDoCentro = c.grupo_faturamento || null;
    /* Faturar sem produtividade lançada é permitido (há projeto que
       fatura por disponibilidade, e há o mês em que o fechamento ainda
       não veio), mas nunca em silêncio. */
    /* No grupo, a produtividade de QUALQUER especialidade já sustenta o
       faturamento global — é uma nota só. */
    const centrosProd = c.grupo_faturamento ? projetosDoGrupo(c.grupo_faturamento) : [d.centro];
    const lotes = centrosProd.reduce(function (acc, id) {
      return acc.concat(fechamentosVivosDe(id, d.competencia)); }, []);
    const semProdutividade = !lotes.length;
    if (semProdutividade && !d.confirmar_sem_produtividade) {
      return { erro: 'Não há produtividade lançada para ' + (c.curto || '') + ' em ' +
        U.fComp(d.competencia) + '. Confirme que o valor vem de outra fonte (medição do órgão, ' +
        'contrato por disponibilidade) antes de seguir.',
        sem_produtividade: true };
    }
    /* O valor é informado POR ESPECIALIDADE e as especialidades somadas
       montam o faturamento do grupo — a nota é que é única. (A v124
       tinha invertido isso; a operação confirmou que o número vem
       setor a setor.) */
    const r = confirmarFaturamentoProdutividade(d);
    if (r.erro) return r;
    if (!d.autorizar) return Object.assign(r, { sem_produtividade: semProdutividade });
    const a = autorizarFaturamento(d.centro, d.competencia,
      { protocolo: d.protocolo, observacao: d.observacao, sem_produtividade: true });
    if (a.erro) return { erro: 'Valor confirmado, mas a autorização falhou: ' + a.erro, previsao: r.previsao };
    return { ok: true, previsao: a.previsao, receber: r.receber,
      sem_produtividade: semProdutividade, autorizado: true, liberado: !!a.previsao.liberado_em };
  }

  /* Estimativa editada direto na esteira: quem opera produtividade e
     faturamento, a diretoria e a administração. Para o grupo, o valor
     é o global — nunca por especialidade. */
  function editarEstimativaEsteira(d) {
    if (!pode('autorizar_faturamento') && !pode('admin') && !pode('cancelar')) {
      return { erro: 'Só quem responde pelo faturamento, a diretoria ou a administração altera a estimativa.' };
    }
    const c = D.centro(d.centro);
    if (!c) return { erro: 'Projeto não encontrado.' };
    if (!d.competencia) return { erro: 'Informe a competência.' };
    if (!(d.faturamento >= 0)) return { erro: 'Informe o valor estimado.' };
    const atual = previsaoDe(d.centro, d.competencia);
    const r = salvarPrevisao({
      centro: d.centro, competencia: d.competencia, faturamento: d.faturamento,
      produtividade: atual ? atual.produtividade : 0,
      observacao: d.observacao !== undefined ? d.observacao : (atual ? atual.observacao : ''),
      forcar: true
    });
    if (r.erro) return r;
    logar('previsao', r.previsao.id, 'alterou a estimativa na esteira',
      (c.curto || '') + ' · ' + U.fComp(d.competencia) + ' · ' + U.brl(d.faturamento) +
      (atual && atual.faturamento ? ' (antes ' + U.brl(atual.faturamento) + ')' : ''));
    return { ok: true, previsao: r.previsao };
  }

  function salvarPrevisao(d) {
    if (!pode('faturar') && !pode('lancar')) return { erro: 'Seu perfil não altera previsões.' };
    const c = D.centro(d.centro);
    if (!c) return { erro: 'Projeto não encontrado.' };
    if (!d.competencia) return { erro: 'Informe a competência.' };
    const pz = prazoDe(d.centro, null);
    const data = d.data || dataPrevista(d.competencia, pz.dias);
    const achado = st.previsoes.find(function (p) {
      return p.centro === d.centro && p.competencia === d.competencia;
    });
    const alvo = achado || { id: novoId('pv'), centro: d.centro, competencia: d.competencia };
    /* Valor CONFIRMADO pela produtividade é medição, não estimativa:
       digitar por cima dele na grade de previsões deixava o número
       novo com o selo antigo ("confirmado no fechamento por Fulano"),
       dizendo uma coisa que o valor não sustenta. Mudar exige decisão
       explícita (`forcar`), e aí o selo cai junto. */
    const novoValor = Math.round((d.faturamento || 0) * 100) / 100;
    if (achado && achado.status === 'confirmada_prod' &&
        Math.abs(novoValor - (achado.faturamento || 0)) > 0.004) {
      if (!d.forcar) {
        return { erro: 'Este projeto está com ' + U.brl(achado.faturamento) + ' confirmado no fechamento da ' +
          'produtividade de ' + U.fComp(d.competencia) + '. Para trocar por ' + U.brl(novoValor) +
          ', confirme a alteração — o valor deixa de constar como confirmado pela produtividade.',
          confirmadaProd: true, valor_atual: achado.faturamento };
      }
      achado.status = 'estimada';
      achado.confirmado_por = null;
      achado.confirmado_em = null;
      st.receber.filter(function (r) {
        return r.origem === 'previsao' && r.centro === d.centro && r.competencia === d.competencia &&
          r.valor_confirmado_produtividade;
      }).forEach(function (r) {
        r.valor_confirmado_produtividade = false;
        /* O título do a receber acompanha: deixar o valor antigo com o
           selo derrubado era o pior dos dois mundos — número velho sem
           explicação. Previsão que volta a ser estimativa mantém o
           título como PREVISTO, com o valor novo. */
        if (['previsto'].indexOf(r.status) > -1) {
          const bruto = novoValor;
          const ret = Math.round((bruto * ((D.centro(d.centro) || {}).retencao_pct || 0) / 100) * 100) / 100;
          r.valor_bruto = bruto;
          r.valor_retido = ret;
          r.valor_liquido = Math.round((bruto - ret) * 100) / 100;
        }
        r.observacao = 'Valor alterado na grade de previsões por ' + usuario().nome +
          ' (não é mais o valor confirmado no fechamento)';
      });
      logar('previsao', achado.id, 'alterou valor confirmado pela produtividade',
        (D.centro(d.centro) || {}).curto + ' · ' + U.brl(achado.faturamento) + ' → ' + U.brl(novoValor));
    }
    alvo.faturamento = novoValor;
    alvo.produtividade = c.produtividade === false ? 0 : Math.round((d.produtividade || 0) * 100) / 100;
    alvo.data = data;
    alvo.prazo_dias = pz.dias;
    alvo.observacao = d.observacao || '';
    alvo.tipo = 'projeto';
    alvo.status = d.status || alvo.status || 'estimada';
    alvo.atualizado_em = new Date();
    alvo.atualizado_por = usuario().nome;
    if (!achado) {
      alvo.criado_por = usuario().nome;
      alvo.criado_por_id = (usuario() || {}).id || null;
      st.previsoes.push(alvo);
    }
    /* Se já estava confirmada, o título do contas a receber acompanha o
       novo valor — senão o fluxo continuaria com o número antigo. */
    if (confirmada(alvo)) criarReceberPrevisto(alvo);
    logar('previsao', alvo.id, achado ? 'atualizou previsão' : 'criou previsão',
      (D.centro(d.centro) || {}).curto + ' ' + U.fComp(d.competencia) + ' · faturar ' +
      U.brl(alvo.faturamento) + ' · produtividade ' + U.brl(alvo.produtividade));
    return { ok: true, previsao: alvo };
  }

  /* Título "previsto" no contas a receber, a partir da previsão. */
  function criarReceberPrevisto(pv) {
    const c = D.centro(pv.centro) || {};
    const jaFaturado = st.receber.some(function (r) {
      return ['nota', 'fatura'].indexOf(r.origem) > -1 && r.centro === pv.centro &&
        r.competencia === pv.competencia && ['cancelado', 'substituido'].indexOf(r.status) < 0;
    });
    if (jaFaturado || !pv.faturamento) return null;
    const existe = st.receber.find(function (r) {
      return r.origem === 'previsao' && r.centro === pv.centro && r.competencia === pv.competencia;
    });
    /* Previsão já SUBSTITUÍDA pela nota/fatura não volta a "previsto"
       só porque alguém clicou em "Confirmar mês": era o caminho que
       fazia o projeto aparecer com o dobro a receber. */
    if (existe && ['substituido', 'recebido', 'cancelado'].indexOf(existe.status) > -1) return null;
    const cli = D.clienteDoCentro(pv.centro);
    const ret = (c.retencao_pct || 0) * pv.faturamento / 100;
    const dados = {
      valor_bruto: Math.round(pv.faturamento * 100) / 100,
      valor_retido: Math.round(ret * 100) / 100,
      valor_liquido: Math.round((pv.faturamento - ret) * 100) / 100,
      vencimento: pv.data, competencia: pv.competencia,
      cliente_nome: cli ? cli.nome : (c.unidade || c.curto || ''),
      cliente_doc: cli ? cli.documento : '',
      observacao: (pv.status === 'confirmada_prod' ? 'Valor confirmado no fechamento da produtividade em ' : 'Previsão confirmada em ') + U.fData(U.hoje()),
      valor_confirmado_produtividade: pv.status === 'confirmada_prod'
    };
    if (existe) {
      Object.keys(dados).forEach(function (k) { existe[k] = dados[k]; });
      existe.status = 'previsto';
      return existe;
    }
    const r = {
      id: novoId('cr'), numero: 'PREV-' + (c.codigo || '') + '-' + pv.competencia.replace('-', ''),
      serie: '', nf_chave: null, emissao: null,
      centro: pv.centro, conta: '1.01',
      competencia_presumida: false, retencoes: [], glosa_prevista: 0,
      recebido_em: null, valor_recebido: 0, origem: 'previsao', status: 'previsto',
      discriminacao: 'Faturamento previsto — ' + (c.curto || ''),
      criado_por: usuario().nome, criado_em: new Date()
    };
    Object.keys(dados).forEach(function (k) { r[k] = dados[k]; });
    st.receber.push(r);
    logar('conta_receber', r.id, 'previsão confirmada',
      (c.curto || '') + ' · ' + U.fComp(pv.competencia) + ' · ' + U.brl(r.valor_liquido));
    return r;
  }

  const previsoes = () => st.previsoes.filter(function (p) { return p.tipo !== 'despesa'; })
    .sort(function (a, b) { return (a.competencia + a.centro).localeCompare(b.competencia + b.centro); });
  const previsaoDe = (centro, comp) => st.previsoes.find(function (p) {
    return p.tipo !== 'despesa' && p.centro === centro && p.competencia === comp; }) || null;
  function excluirPrevisao(id) {
    if (!pode('faturar') && !pode('lancar')) return { erro: 'Seu perfil não exclui previsão.' };
    const alvo = st.previsoes.find(function (x) { return x.id === id; });
    if (alvo) logar('previsao', id, 'excluiu previsão',
      ((D.centro(alvo.centro) || {}).curto || '') + ' · ' + U.fComp(alvo.competencia) +
      ' · ' + U.brl(alvo.faturamento || 0));
    const i = st.previsoes.findIndex(function (p) { return p.id === id; });
    if (i < 0) return { erro: 'Previsão não encontrada.' };
    st.previsoes.splice(i, 1);
    return { ok: true };
  }

  /* O real substitui o estimado: se já existe nota faturada para o
     projeto naquela competência, a previsão de faturamento sai do
     fluxo; o mesmo vale para a produtividade já lançada. */
  /* Realizado do faturamento.

     Duas coisas estavam erradas aqui, e juntas produziam um desvio que
     não existia. A soma pegava TODOS os títulos daquele projeto e
     competência — inclusive o próprio título PREVISTO criado pela
     previsão confirmada, que assim se comparava consigo mesmo. E somava
     o LÍQUIDO contra um previsto que é digitado BRUTO, de modo que o
     "desvio" era exatamente o total retido na fonte. Vinte e cinco
     projetos marcados para conferir todo mês, sem motivo.

     Realizado é nota emitida: origem 'nota', fora canceladas e
     substituídas. E devolve bruto e líquido separados, para cada tela
     comparar com o que é igual. */
  function realizadoDaPrevisao(pv) {
    /* Fatura de locação realiza a previsão igual à NF — é o documento
       de cobrança daquele contrato. Só reconhecer 'nota' fazia a
       previsão e a fatura conviverem no fluxo, contando duas vezes. */
    const notas = st.receber.filter(function (r) {
      return ['nota', 'fatura'].indexOf(r.origem) > -1 && r.centro === pv.centro &&
             r.competencia === pv.competencia &&
             ['cancelado', 'substituido'].indexOf(r.status) < 0;
    });
    const faturado = notas.reduce(function (s2, r) { return s2 + r.valor_bruto; }, 0);
    const faturadoLiquido = notas.reduce(function (s2, r) { return s2 + r.valor_liquido; }, 0);
    const produzido = st.parcelas.filter(function (p) {
      return p.status !== 'cancelado' && p.origem === 'produtividade' &&
             p.comp === pv.competencia &&
             (p.rateio || []).some(function (r) { return r.centro === pv.centro; });
    }).reduce(function (s2, p) { return s2 + p.valor; }, 0);
    return {
      faturado: Math.round(faturado * 100) / 100,              // bruto: compara com o previsto
      faturado_liquido: Math.round(faturadoLiquido * 100) / 100,
      retido: Math.round((faturado - faturadoLiquido) * 100) / 100,
      notas: notas.length,
      produzido: Math.round(produzido * 100) / 100
    };
  }

  /* ── contas a receber ───────────────────────────────────
     O que entra é o LÍQUIDO: valor da nota menos as retenções que o
     tomador faz na fonte. A retenção fica registrada porque vira
     crédito de imposto, e a glosa média entra como estimativa até o
     órgão pagar de verdade. */
  /* ── fatura (locação sem NF) ────────────────────────────
     Contrato de locação em que não se emite NF: o faturamento sai por
     FATURA. Duas portas: anexar a fatura que já existe, ou emitir aqui
     (o sistema lista os itens de locação cadastrados no projeto, com a
     quantidade total; quem fatura reduz a quantidade do que estiver
     parado/com defeito e escreve o motivo). Nos dois casos entra no
     contas a receber como faturamento de verdade — igual à NF, com o
     mesmo efeito sobre a previsão da competência. */
  function proximoNumeroFatura() {
    const n = st.receber.filter(function (r) { return r.origem === 'fatura'; }).length + 1;
    return 'FAT-' + new Date().getFullYear() + '-' + String(n).padStart(4, '0');
  }

  function emitirFatura(d) {
    if (!pode('faturar')) return { erro: 'Seu perfil não emite fatura.' };
    const c = D.centro(d.centro);
    if (!c) return { erro: 'Escolha o projeto.' };
    if (!d.competencia) return { erro: 'Informe a competência.' };
    const trava = travaDeLiberacao(d.centro, d.competencia);
    if (trava && !d.forcar_sem_liberacao) return { erro: trava };
    /* Uma cobrança por projeto/competência: a 2ª fatura no mesmo mês
       era somada ao a receber e dobrava o faturamento. */
    const jaTem = st.receber.find(function (r) {
      return r.centro === d.centro && r.competencia === d.competencia &&
        ['nota', 'fatura'].indexOf(r.origem) > -1 && r.status !== 'cancelado' && r.status !== 'substituido';
    });
    if (jaTem && !d.forcar) {
      return { erro: 'Este projeto já tem ' + (jaTem.origem === 'fatura' ? 'a fatura ' : 'a NF ') + jaTem.numero +
        ' em ' + U.fComp(d.competencia) + ' (' + U.brl(jaTem.valor_bruto) + '). Para emitir outra, cancele ' +
        'a anterior em Contas a receber (ação "Cancelar"), ou emita esta em outra competência.' };
    }
    /* Fatura que já existe (anexada) tem número, valor e data próprios —
       antes o anexo entrava com o valor do contrato cheio. */
    if (d.numero) {
      /* Número de fatura é nosso: não pode repetir em projeto nenhum.
         Repetido, duas cobranças diferentes ficam com a mesma
         referência e o cliente paga uma achando que quitou as duas. */
      const mesmoNumero = st.receber.find(function (r) {
        return String(r.numero || '').trim().toLowerCase() === String(d.numero).trim().toLowerCase() &&
          ['cancelado', 'substituido'].indexOf(r.status) < 0;
      });
      if (mesmoNumero) {
        return { erro: 'Já existe o documento ' + d.numero + ' no contas a receber (' +
          ((D.centro(mesmoNumero.centro) || {}).curto || '') + ' · ' + U.fComp(mesmoNumero.competencia) +
          ' · ' + U.brl(mesmoNumero.valor_bruto) + '). Use outro número.' };
      }
    }
    if (d.arquivo) {
      if (!d.numero) return { erro: 'Informe o número da fatura que está sendo anexada.' };
      if (!(d.valor_anexo > 0)) return { erro: 'Informe o valor da fatura anexada.' };
      if (!d.emissao) return { erro: 'Informe a data de emissão da fatura anexada.' };
    }
    const itens = (d.itens || []).filter(function (i) { return i.qtd > 0 && i.descricao; })
      .map(function (i) {
        return { descricao: i.descricao, qtd: i.qtd, qtd_contratada: i.qtd_contratada || i.qtd,
          valor_unit: Math.round((i.valor_unit || 0) * 100) / 100,
          valor: Math.round((i.qtd * (i.valor_unit || 0)) * 100) / 100,
          observacao: i.observacao || '' };
      });
    if (!itens.length && !d.arquivo) return { erro: 'Nenhum item com quantidade a faturar.' };
    // no anexo vale o valor do documento; na emissão, a soma dos itens
    const bruto = d.arquivo ? Math.round(d.valor_anexo * 100) / 100
      : Math.round(itens.reduce(function (a, i) { return a + i.valor; }, 0) * 100) / 100;
    const cli = D.clienteDoCentro(d.centro);
    const pz = prazoDe(d.centro, cli ? cli.documento : null);
    const r = criarReceber({
      numero: d.numero || proximoNumeroFatura(), serie: '',
      emissao: d.emissao || U.hoje(), cliente_doc: cli ? cli.documento : null,
      cliente_nome: cli ? cli.nome : (c.unidade || c.curto || ''),
      centro: d.centro, competencia: d.competencia,
      vencimento: d.vencimento || dataPrevista(d.competencia, pz.dias),
      valor_bruto: bruto, retencoes: [], retencao_origem: 'manual',
      origem: 'fatura', status: 'faturado',
      discriminacao: 'Locação — ' + itens.length + ' item(ns)',
      observacao: d.observacao || ''
    });
    if (r.erro) return r;
    r.receber.itens_fatura = itens;
    r.receber.fatura_emitida = !d.arquivo;
    if (d.arquivo) r.receber.arquivo = d.arquivo;   // fatura que já existia, anexada
    logar('conta_receber', r.receber.id, d.arquivo ? 'anexou fatura' : 'emitiu fatura',
      (c.curto || '') + ' · ' + U.fComp(d.competencia) + ' · ' + U.brl(bruto));
    return { ok: true, receber: r.receber };
  }

  /* Faturar exige a liberação: confirmar o valor no fechamento não é
     autorização do órgão, e autorização não é liberação interna. Quando
     não há previsão nenhuma (faturamento avulso), nada trava. */
  function travaDeLiberacao(centro, competencia) {
    const pv = previsaoDe(centro, competencia);
    if (!pv) return null;
    if (pv.liberado_em) return null;
    const c = D.centro(centro) || {};
    const etapa = etapaDaPrevisao(pv);
    const falta = etapa === 'autorizado'
      ? 'falta a liberação de quem responde pelo faturamento'
      : etapa === 'confirmado'
        ? 'o órgão ainda não autorizou este valor'
        : 'o valor ainda não foi confirmado no fechamento da produtividade';
    return (c.curto || 'Este projeto') + ' · ' + U.fComp(competencia) + ': ' + falta +
      '. Acompanhe em Faturamento › Esteira.';
  }

  /* Documento ÚNICO cobrindo vários projetos do mesmo grupo: cria um
     recebível só, rateado, e amarra as previsões de todos os projetos
     envolvidos — é o caso do GHC-HGB (1 nota, 7 especialidades). */
  function faturarGrupo(d) {
    if (!pode('faturar')) return { erro: 'Seu perfil não fatura.' };
    if (!d.grupo) return { erro: 'Informe o grupo de faturamento.' };
    if (!d.competencia) return { erro: 'Informe a competência.' };
    if (!(d.valor > 0)) return { erro: 'Informe o valor do documento.' };
    const base = baseDoGrupo(d.grupo, d.competencia);
    if (!base.projetos) return { erro: 'Nenhum projeto neste grupo de faturamento.' };
    /* Cada projeto do grupo precisa estar liberado: a nota é uma só,
       mas a autorização do órgão é por medição de cada especialidade. */
    const travados = base.itens.filter(function (i) {
      return i.previsao && !i.previsao.liberado_em;
    });
    if (travados.length && !d.forcar_sem_liberacao) {
      return { erro: travados.length + ' de ' + base.projetos + ' projeto(s) do grupo ainda não foram ' +
        'liberados para faturar (' + travados.slice(0, 3).map(function (i) {
          return (i.projeto || {}).curto; }).join(', ') + '). Veja a esteira.' };
    }
    const partes = ratearNoGrupo(d.grupo, d.competencia, d.valor);
    if (!partes.length) return { erro: 'Não há base (confirmada ou prevista) para ratear o documento.' };
    const principal = partes[0].centro;
    const r = criarReceber({
      numero: d.numero, emissao: d.emissao || U.hoje(), vencimento: d.vencimento,
      cliente_nome: d.cliente_nome || (D.clienteDoCentro(principal) || {}).nome || d.grupo,
      centro: principal, competencia: d.competencia, valor_bruto: d.valor,
      discriminacao: d.discriminacao || ('Faturamento único ' + d.grupo + ' · ' + U.fComp(d.competencia)),
      origem: d.origem || 'nota', arquivo: d.arquivo || null,
      grupo_faturamento: d.grupo,
      rateio_centros: partes,
      forcar_sem_liberacao: true   // a checagem do grupo já foi feita acima
    });
    if (r.erro) return r;
    logar('conta_receber', r.receber.id, 'faturou grupo',
      d.grupo + ' · ' + U.fComp(d.competencia) + ' · ' + U.brl(d.valor) + ' · ' +
      partes.length + ' projeto(s)');
    return { ok: true, receber: r.receber, partes: partes };
  }

  /* ── importação de NFS-e por XML ────────────────────────
     O XML da nota de serviço que a empresa emitiu vira título no
     contas a receber, do mesmo jeito que o OFX vira extrato: o
     operador não redigita número, valor, cliente nem retenção.

     Três coisas o arquivo resolve sozinho e que eram fonte de erro:
     a EMPRESA do grupo (pelo CNPJ do prestador), o CLIENTE (pelo CNPJ
     do tomador) e as RETENÇÕES (cada tributo com seu valor). O que
     ele não resolve é o PROJETO — a nota não sabe de centro de custo
     —, então quem importa escolhe, com a sugestão do projeto do
     cliente quando existe um só. */
  function analisarNFSeImportacao(notas) {
    return (notas || []).map(function (n) {
      const empresa = D.empresas.find(function (e) {
        return String(e.cnpj || '').replace(/\D/g, '') === n.prestador_doc;
      });
      const cliente = D.clientes.find(function (c) {
        return String(c.documento || '').replace(/\D/g, '') === n.tomador_doc;
      });
      /* Projeto sugerido: se o cliente tem um só, é ele. Com vários,
         quem importa decide — chutar classificaria receita no centro
         errado, que é pior que perguntar. */
      const doCliente = cliente ? (D.projetosDoCliente(cliente.id) || []) : [];
      const jaImportada = st.receber.find(function (r) {
        if (n.chave && r.nf_chave) return r.nf_chave === n.chave;
        return r.numero === n.numero && r.cliente_doc &&
          String(r.cliente_doc).replace(/\D/g, '') === n.tomador_doc &&
          ['cancelado'].indexOf(r.status) < 0;
      });
      return {
        nota: n,
        empresa: empresa ? empresa.id : null,
        empresa_nome: empresa ? (empresa.apelido || empresa.nome) : null,
        cliente: cliente ? cliente.id : null,
        cliente_novo: !cliente,
        centros_possiveis: doCliente.map(function (c) { return c.id || c; }),
        centro_sugerido: doCliente.length === 1 ? (doCliente[0].id || doCliente[0]) : null,
        ja_importada: !!jaImportada,
        receber_id: jaImportada ? jaImportada.id : null,
        /* Nota cancelada na prefeitura não vira título. */
        ignorar: n.cancelada,
        motivo_ignorar: n.cancelada ? 'cancelada na prefeitura' : null
      };
    });
  }

  function importarNFSe(notas, opcoes) {
    if (!pode('faturar')) return { erro: 'Seu perfil não lança contas a receber.' };
    opcoes = opcoes || {};
    const analise = analisarNFSeImportacao(notas);
    const criados = [], pulados = [], erros = [];

    analise.forEach(function (a, i) {
      const n = a.nota;
      if (a.ignorar) { pulados.push({ numero: n.numero, motivo: a.motivo_ignorar }); return; }
      if (a.ja_importada) { pulados.push({ numero: n.numero, motivo: 'já importada' }); return; }

      const centro = (opcoes.centros || {})[n.numero] || a.centro_sugerido;
      if (!centro) {
        erros.push({ numero: n.numero, erro: 'sem projeto definido' });
        return;
      }

      /* Cliente que ainda não existe é cadastrado com o que a nota
         traz — é dado da própria nota, não invenção. */
      let clienteId = a.cliente;
      if (!clienteId && n.tomador_doc) {
        const novo = {
          id: novoId('cl'), nome: n.tomador_nome || 'Cliente ' + n.tomador_doc,
          documento: n.tomador_doc, ativo: true, origem: 'nfse'
        };
        D.clientes.push(novo);
        clienteId = novo.id;
      }

      const r = criarReceber({
        numero: n.numero, serie: '', nf_chave: n.chave,
        emissao: n.emissao, competencia: n.competencia,
        centro: centro,
        valor_bruto: n.valor_servicos,
        valor_retido: n.valor_retido,
        retencoes: n.retencoes,
        cliente_doc: n.tomador_doc, cliente_nome: n.tomador_nome,
        descricao: n.discriminacao ? n.discriminacao.slice(0, 160) : ('NFS-e ' + n.numero),
        origem: 'nota',
        empresa: a.empresa || undefined,
        codigo_verificacao: n.codigo_verificacao,
        forcar_sem_liberacao: !!opcoes.forcar_sem_liberacao
      });
      if (r.erro) { erros.push({ numero: n.numero, erro: r.erro }); return; }
      criados.push({ numero: n.numero, id: r.receber.id, valor: n.valor_servicos,
        cliente: n.tomador_nome, centro: centro });
    });

    if (criados.length) {
      logar('receber', 'importacao-nfse', 'importou NFS-e por XML',
        criados.length + ' nota(s) · ' +
        U.brl(criados.reduce(function (s2, c) { return s2 + c.valor; }, 0)));
    }
    return { ok: !erros.length, criados: criados, pulados: pulados, erros: erros,
      total: Math.round(criados.reduce(function (s2, c) { return s2 + c.valor; }, 0) * 100) / 100 };
  }

  function criarReceber(d) {
    d = d || {};
    if (!pode('faturar')) return { erro: 'Seu perfil não lança contas a receber.' };
    /* O contas a pagar foi blindado contra número inválido; o contas a
       receber não tinha nenhuma checagem — aceitava bruto negativo,
       texto, Infinity, e retenção maior que a nota. Um título NaN
       contaminava o total de entradas de todos os relatórios. */
    const brutoR = Number(d.valor_bruto);
    if (!isFinite(brutoR) || brutoR <= 0) {
      return { erro: 'Valor da nota inválido (' + d.valor_bruto + ').' };
    }
    const retidoR = Number(d.valor_retido || 0);
    const glosaR = Number(d.glosa_prevista || 0);
    if (!isFinite(retidoR) || retidoR < 0) return { erro: 'Valor retido inválido.' };
    if (!isFinite(glosaR) || glosaR < 0) return { erro: 'Glosa prevista inválida.' };
    if (retidoR + glosaR > brutoR + 0.004) {
      return { erro: 'Retenção (' + U.brl(retidoR) + ') mais glosa (' + U.brl(glosaR) +
        ') passam do valor da nota (' + U.brl(brutoR) + ').' };
    }
    if (d.nf_chave && st.receber.some(function (r) { return r.nf_chave === d.nf_chave; })) {
      return { erro: 'Nota ' + d.numero + ' já está no contas a receber.' };
    }
    /* Segunda nota viva no mesmo projeto e competência: pode ser
       complemento legítimo, então não barra — mas avisa, porque
       também é o sintoma de faturar duas vezes o mesmo contrato. */
    let avisoDuplo = null;
    if ((d.origem || 'nota') === 'nota' && d.centro && d.competencia) {
      const irmas = st.receber.filter(function (r) {
        return r.centro === d.centro && r.competencia === d.competencia &&
          ['nota', 'fatura'].indexOf(r.origem) > -1 &&
          ['cancelado', 'substituido'].indexOf(r.status) < 0;
      });
      if (irmas.length) {
        avisoDuplo = 'Já existe ' + irmas.length + ' documento(s) desta competência neste projeto (' +
          irmas.map(function (r) { return r.numero; }).filter(Boolean).join(', ') +
          '). Se não for complemento, confira antes de seguir.';
      }
    }
    /* Nota chegando: o título PREVISTO daquele projeto e competência
       NÃO é mais substituído sozinho. Ele fica marcado como vínculo a
       conferir, e alguém decide se a nota substitui por inteiro, se é
       faturamento parcial (a previsão vira resíduo) ou se não é a
       mesma coisa. Enquanto pende, a previsão sai das somas — quem
       carrega o número é a nota. */
    /* A trava da esteira vale também para a NF lançada pelo portal: não
       é porque a nota foi emitida por fora que o caminho muda. */
    if ((d.origem || 'nota') === 'nota' && d.centro && d.competencia && !d.forcar_sem_liberacao) {
      const trava = travaDeLiberacao(d.centro, d.competencia);
      if (trava) return { erro: trava };
    }
    /* FATURA de locação realiza a previsão igual à NF: é o documento
       de cobrança daquele contrato. Antes só 'nota' entrava aqui, então
       a fatura somava por cima da previsão e o "a receber" contava o
       mesmo faturamento duas vezes. */
    /* Documento do grupo cobre VÁRIOS projetos: as previsões de todos
       eles entram na conferência, não só a do centro principal. */
    const centrosDoDoc = (d.rateio_centros && d.rateio_centros.length)
      ? d.rateio_centros.map(function (x) { return x.centro; }) : [d.centro];
    const pendentes = ['nota', 'fatura'].indexOf(d.origem || 'nota') > -1
      ? st.receber.filter(function (r) {
          return r.origem === 'previsao' && r.status === 'previsto' && !r.conferir &&
            centrosDoDoc.indexOf(r.centro) > -1 && r.competencia === d.competencia;
        })
      : [];
    const bruto = Math.round((d.valor_bruto || 0) * 100) / 100;
    const retido = Math.round((d.valor_retido || 0) * 100) / 100;
    const glosa = Math.round((d.glosa_prevista || 0) * 100) / 100;
    const r = {
      id: novoId('cr'), numero: d.numero, serie: d.serie || '',
      /* CNPJ do tomador: é por ele que se reconhece venda para outra
         empresa do grupo, que some no consolidado. */
      cliente_documento: d.cliente_documento ||
        (D.clienteDoCentro(d.centro) || {}).documento || '',
      nf_chave: d.nf_chave || null, emissao: d.emissao,
      cliente_doc: d.cliente_doc, cliente_nome: d.cliente_nome,
      centro: d.centro || null, conta: d.conta || '1.01',
      competencia: d.competencia, competencia_presumida: !!d.competencia_presumida,
      vencimento: d.vencimento,
      valor_bruto: bruto, retencoes: (d.retencoes || []).slice(),
      retencao_origem: d.retencao_origem || 'nota',
      valor_retido: retido, glosa_prevista: glosa,
      valor_liquido: Math.round((bruto - retido - glosa) * 100) / 100,
      recebido_em: null, valor_recebido: 0,
      origem: d.origem || 'nota',
      status: d.status || 'faturado',   // previsto | faturado | recebido | substituido | cancelado
      observacao: d.observacao || '',
      discriminacao: d.discriminacao || '',
      /* Documento único de um grupo: guarda o rateio por projeto, que é
         o que faz o valor cair no resultado de cada especialidade. */
      grupo_faturamento: d.grupo_faturamento || null,
      rateio_centros: (d.rateio_centros || []).slice(),
      criado_por: usuario().nome, criado_em: new Date()
    };
    r.criado_por = usuario().nome;
    r.criado_por_id = (usuario() || {}).id || null;
    st.receber.push(r);
    /* Amarra as duas pontas: a previsão sabe qual nota a questiona, e a
       nota sabe o que está esperando conferência. */
    if (pendentes.length) {
      r.substitui = pendentes.map(function (p) { return p.id; });
      pendentes.forEach(function (p) {
        p.conferir = r.id;
        p.observacao = 'Aguardando conferência do vínculo com a NF ' + r.numero;
      });
      logar('conta_receber', r.id, 'vínculo a conferir',
        (r.origem === 'fatura' ? 'Fatura ' : 'NF ') + r.numero + ' × ' + pendentes.length + ' previsão(ões)');
    }
    logar('conta_receber', r.id, 'faturou', 'NF ' + r.numero + ' · ' + U.brl(r.valor_liquido) + ' líquido');
    return { ok: true, receber: r, aConferir: pendentes.length, aviso: avisoDuplo || undefined };
  }

  /* Recebimento de cliente que a conciliação não reconheceu porque não
     tinha NF nem previsão no sistema ainda — dinheiro que caiu no
     banco antes de qualquer lançamento. Em vez de inventar um caminho
     novo de "baixa", cria o título com bruto igual ao líquido (sem
     retenção presumida — ninguém digitou uma) e manda pela mesma
     `receberBaixa` de sempre, que já sabe fechar e registrar o que
     precisar. */
  function lancarReceberAvulso(linhaId, d) {
    /* A operação inteira é uma baixa de recebimento com um título novo
       na frente — checa a permissão de baixa ANTES de criar qualquer
       coisa. Criar o título e só depois descobrir que a baixa não pode
       ser feita deixava um título "faturado" órfão no sistema, sem
       ninguém vinculado a ele, e tentar de novo criava outro. */
    if (!pode('pagar')) return { erro: 'Seu perfil não dá baixa em recebimento.' };
    const l = st.linhas.find(function (x) { return x.id === linhaId; });
    if (!l) return { erro: 'Lançamento não encontrado.' };
    /* Exige PENDENTE: negar só 'conciliado' deixava a linha ignorada
       aceitar vínculo novo. */
    if (l.situacao !== 'pendente') {
      return { erro: l.situacao === 'conciliado'
        ? 'Esta linha já está conciliada.'
        : 'Esta linha está como ' + l.situacao + ' — reabra antes de conciliar.' };
    }
    if (!(l.entrada > 0)) return { erro: 'Só linha de crédito vira recebimento de cliente.' };
    if (!d.cliente_nome) return { erro: 'Informe o cliente.' };
    if (!d.centro) return { erro: 'Informe o projeto.' };
    const valor = Math.round(Math.abs(l.valor) * 100) / 100;
    const criado = criarReceber({
      numero: d.numero || 'S/N', emissao: l.data, cliente_doc: d.cliente_doc || null,
      cliente_nome: d.cliente_nome, centro: d.centro,
      competencia: d.competencia || U.compDe(l.data), vencimento: l.data,
      valor_bruto: valor, valor_retido: 0, retencao_origem: 'manual',
      origem: 'avulso', status: 'faturado',
      observacao: 'Lançado pela conciliação · ' + l.memo
    });
    if (criado.erro) return criado;
    /* A linha do extrato diz de que conta o dinheiro é: sem passar o
       banco, a baixa ficava sem conta e o valor não entrava em saldo
       nenhum — caía em "recebido sem conta". Os outros dois caminhos
       do extrato já gravavam. */
    const baixa = receberBaixa(criado.receber.id, { data: l.data, valor: valor, banco: l.banco });
    if (baixa.erro) return baixa;
    l.situacao = 'conciliado';
    l.alvo_tipo = 'receber';
    l.alvo_id = criado.receber.id;
    l.conciliado_em = new Date();
    l.conciliado_por = usuario().nome;
    l.observacao = 'Lançado pela conciliação';
    logar('extrato', l.id, 'lançou recebimento avulso', U.brl(valor) + ' · ' + d.cliente_nome);
    return { ok: true, receber: criado.receber };
  }

  /* ── vínculos de faturamento aguardando conferência ─────
     Cada item é uma previsão que uma nota pode estar substituindo.
     Ninguém mexe no número antes de alguém dizer o que é. */
  function vinculosPendentes() {
    return st.receber.filter(function (r) {
      return r.conferir && r.status === 'previsto';
    }).map(function (p) {
      const nota = st.receber.find(function (x) { return x.id === p.conferir; }) || null;
      return {
        previsto: p, nota: nota,
        diferenca: nota ? Math.round((nota.valor_liquido - p.valor_liquido) * 100) / 100 : 0
      };
    }).filter(function (v) { return v.nota; });
  }

  const vinculosPendentesQtd = () => vinculosPendentes().length;

  /* parcial = a nota é só uma parte do mês; a previsão encolhe pelo
     que sobrou em vez de sair de cena. */
  function confirmarSubstituicao(previstoId, opc) {
    if (!pode('faturar') && !pode('pagar')) return { erro: 'Seu perfil não confere faturamento.' };
    const p = st.receber.find(function (x) { return x.id === previstoId; });
    if (!p || !p.conferir) return { erro: 'Vínculo não encontrado.' };
    const nota = st.receber.find(function (x) { return x.id === p.conferir; });
    if (!nota) return { erro: 'Nota do vínculo não encontrada.' };

    if (opc && opc.parcial) {
      /* Guarda o abatimento por NF: cancelar a nota devolvia só o
         STATUS da previsão, não o valor, e R$ 40.000 de receita
         prevista sumiam — com a observação dizendo o contrário. */
      p.abatimentos = p.abatimentos || {};
      p.abatimentos[nota.id] = Math.round(nota.valor_bruto * 100) / 100;
      p.valor_bruto = Math.max(0, Math.round((p.valor_bruto - nota.valor_bruto) * 100) / 100);
      p.valor_liquido = Math.max(0, Math.round((p.valor_liquido - nota.valor_liquido) * 100) / 100);
      p.observacao = 'Resíduo da previsão após a NF ' + nota.numero;
      if (p.valor_liquido <= 0.004) {
        p.status = 'substituido';
        p.observacao = 'Substituído pela NF ' + nota.numero + ' (parcial, sem resíduo)';
      }
    } else {
      p.status = 'substituido';
      p.observacao = 'Substituído pela NF ' + nota.numero;
    }
    delete p.conferir;
    p.conferido_por = usuario().nome;
    p.conferido_em = U.hoje();
    logar('conta_receber', p.id, opc && opc.parcial ? 'confirmou faturamento parcial' : 'confirmou substituição',
      'NF ' + nota.numero + ' · ' + U.brl(nota.valor_liquido) +
      (opc && opc.parcial ? ' · resíduo ' + U.brl(p.valor_liquido) : ''));
    return { ok: true, previsto: p };
  }

  /* "Não é a mesma coisa": a previsão volta a valer inteira, ao lado
     da nota. Acontece quando a nota é de outro serviço do mesmo mês. */
  function recusarVinculo(previstoId) {
    if (!pode('faturar') && !pode('pagar')) return { erro: 'Seu perfil não recusa vínculo de faturamento.' };
    const p = st.receber.find(function (x) { return x.id === previstoId; });
    if (!p || !p.conferir) return { erro: 'Vínculo não encontrado.' };
    const nota = st.receber.find(function (x) { return x.id === p.conferir; });
    if (nota && nota.substitui) {
      nota.substitui = nota.substitui.filter(function (id) { return id !== p.id; });
    }
    delete p.conferir;
    p.observacao = nota ? 'Vínculo com a NF ' + nota.numero + ' recusado — previsão mantida' : '';
    p.conferido_por = usuario().nome;
    p.conferido_em = U.hoje();
    logar('conta_receber', p.id, 'recusou vínculo',
      (nota ? 'NF ' + nota.numero : '') + ' · previsão mantida em ' + U.brl(p.valor_liquido));
    return { ok: true };
  }

  /* Correção de importação — muda competência, vencimento, número ou
     projeto de um título que ainda não foi recebido. Uma vez recebido,
     o dinheiro já está contado naquele mês; corrigir depois disso é
     estornar o recebimento primeiro, mesma regra do contas a pagar. */
  const CAMPOS_EDITAVEIS_RECEBER = {
    numero: 'número da NF', cliente_nome: 'cliente', centro: 'projeto',
    competencia: 'competência', vencimento: 'vencimento'
  };
  function editarReceber(id, dados) {
    if (!pode('faturar')) return { erro: 'Seu perfil não edita contas a receber.' };
    const r = st.receber.find(function (x) { return x.id === id; });
    if (!r) return { erro: 'Título não encontrado.' };
    if (r.status === 'recebido') return { erro: 'Título já recebido não é editável — estorne o recebimento antes.' };
    if (r.status === 'cancelado' || r.status === 'substituido') {
      return { erro: 'Título ' + r.status + ' não é editável.' };
    }
    const ate = st.parametros.travar_competencia_ate;
    if (ate && dados.competencia !== undefined && String(dados.competencia) !== String(r.competencia || '')) {
      if (r.competencia && r.competencia <= ate) {
        return { erro: 'O título está em competência fechada (' + U.fComp(r.competencia) +
          '). Reabra o período na Administração para movê-lo.' };
      }
      if (dados.competencia <= ate) {
        return { erro: 'Competência fechada até ' + U.fComp(ate) + '. Não dá para mover pra ' +
          U.fComp(dados.competencia) + '.' };
      }
    }
    const mudou = [];
    Object.keys(CAMPOS_EDITAVEIS_RECEBER).forEach(function (k) {
      if (dados[k] === undefined || String(dados[k]) === String(r[k] || '')) return;
      const rot = v => k === 'competencia' ? U.fComp(v) : k === 'vencimento' ? U.fData(v)
        : k === 'centro' ? ((D.centro(v) || {}).curto || '—') : (v || '—');
      mudou.push(CAMPOS_EDITAVEIS_RECEBER[k] + ': ' + rot(r[k]) + ' → ' + rot(dados[k]));
      r[k] = dados[k];
    });
    if (!mudou.length) return { ok: true, n: 0 };
    r.competencia_presumida = false;
    logar('conta_receber', id, 'editou', mudou.join(' · '));
    return { ok: true, n: mudou.length, mudou: mudou };
  }

  const contasReceber = () => st.receber.slice().sort(function (a, b) {
    return (a.vencimento || '').localeCompare(b.vencimento || '');
  });

  /* Título que ainda representa dinheiro a entrar. Um lugar só decide
     isso. Antes cada tela repetia `status !== 'recebido'`, e com isso
     somava previsão substituída, previsão cancelada e — agora —
     previsão aguardando conferência, cujo número já está na nota. */
  const receberAberto = r => ['previsto', 'faturado'].indexOf(r.status) > -1 && !r.conferir;
  /* Um critério só de "vencido" pra todo mundo: em aberto (sem vínculo
     pendente), com vencimento no passado e saldo a receber. Antes o
     alerta, o cartão e a lista usavam regras diferentes e davam 5, 6 e
     7 títulos no mesmo cenário. `dias` só conta quando há vencimento —
     título sem data não vira "NaN dias". */
  function receberVencido(r, refHoje) {
    const hoje = refHoje || U.hoje();
    return receberAberto(r) && !!r.vencimento && r.vencimento < hoje && saldoReceberDe(r) > 0.004;
  }
  const diasDeAtraso = (r, refHoje) => r.vencimento ? U.diasEntre(r.vencimento, refHoje || U.hoje()) : null;

  /* Quanto ainda falta entrar. Título "aberto" com um recebimento
     parcial já registrado (quem manteve o resíduo em vez de quitar com
     glosa) continua contando o líquido inteiro em todo relatório que
     não conhecesse este helper — o que já entrou desaparecia do
     realizado e nunca saía do previsto. */
  const saldoReceberDe = r => Math.max(0, Math.round((r.valor_liquido - (r.valor_recebido || 0)) * 100) / 100);

  function listarReceber(f) {
    f = f || {};
    return contasReceber().filter(function (r) {
      return (!f.comp    || r.competencia === f.comp) &&
             (!f.centro  || r.centro === f.centro) &&
             (!f.cliente || r.cliente_doc === f.cliente) &&
             (!f.de      || (r.vencimento || '') >= f.de) &&
             (!f.ate     || (r.vencimento || '') <= f.ate) &&
             (!f.status  ? r.status !== 'substituido' && r.status !== 'cancelado'
                         : f.status === 'aberto'
                           ? ['previsto', 'faturado'].indexOf(r.status) > -1
                           /* atrasado: em aberto e com vencimento no passado */
                           : f.status === 'atrasado'
                             ? receberVencido(r)
                             : r.status === f.status) &&
             (!f.origem || (r.origem || 'nota') === f.origem) &&
             (!f.busca   || (r.numero + ' ' + r.cliente_nome + ' ' + r.discriminacao)
                              .toLowerCase().indexOf(f.busca.toLowerCase()) > -1);
    });
  }

  const saldoInicial = () => D.bancos.reduce(function (s, b) { return s + (b.saldo_inicial || 0); }, 0);
  const saldoInicialEm = () => D.bancos.reduce(function (d2, b) {
    return b.saldo_inicial_em && (!d2 || b.saldo_inicial_em > d2) ? b.saldo_inicial_em : d2; }, '');

  /* Saldo atual de um banco: o do ÚLTIMO extrato importado, conferido
     contra o que a movimentação daquele mesmo extrato deveria dar a
     partir do saldo anterior — saldo_anterior + entradas − saídas do
     próprio arquivo. Bater ou não bater não depende de nada estar
     conciliado (o extrato já é a fonte da verdade sobre o que
     aconteceu no banco); a conferência aqui é só pra pegar arquivo
     faltando ou lançamento fora do período.

     Divergência pequena (< R$ 3.000): mostra o saldo do arquivo mesmo
     assim, com alerta. Acima disso, não mostra número — mostra que
     está bloqueado até alguém conferir, porque um número errado
     exibido pra quem aprova pagamento é pior que nenhum número. */
  const LIMITE_DIVERGENCIA_SALDO = 3000;
  function saldoAtual(bancoId) {
    const b = D.banco(bancoId) || {};
    const exts = st.extratos.filter(function (x) { return x.banco === bancoId; })
      .sort(function (a, b2) { return (a.periodo_fim || '').localeCompare(b2.periodo_fim || ''); });
    if (!exts.length) {
      return { banco: bancoId, valor: b.saldo_inicial || 0, data: b.saldo_inicial_em || null,
        divergencia: 0, status: 'sem-extrato' };
    }
    const ultimo = exts[exts.length - 1];
    const anterior = exts.length > 1 ? exts[exts.length - 2] : null;
    const base = anterior ? anterior.saldo : (b.saldo_inicial || 0);
    const mov = st.linhas.filter(function (l) { return l.extrato_id === ultimo.id; })
      .reduce(function (s, l) { return s + (l.entrada || 0) - (l.saida || 0); }, 0);
    const calculado = Math.round((base + mov) * 100) / 100;
    const divergencia = Math.round((ultimo.saldo - calculado) * 100) / 100;
    const status = Math.abs(divergencia) <= 0.01 ? 'ok'
      : Math.abs(divergencia) < LIMITE_DIVERGENCIA_SALDO ? 'alerta' : 'bloqueado';
    return { banco: bancoId, valor: ultimo.saldo, calculado: calculado, divergencia: divergencia,
      data: ultimo.periodo_fim, arquivo: ultimo.arquivo, status: status };
  }
  /* ── saldo informado à mão (prova real) ─────────────────
     O que o sistema calcula vem do extrato importado e das baixas. O
     saldo informado é o que a pessoa VÊ no banco. A diferença entre os
     dois é o que interessa: ou falta conciliar, ou falta baixar. */
  function informarSaldoBancario(bancoId, d) {
    /* Data futura e valor negativo passavam, e um saldo informado
       para 2099 virava o último — mandando em todo o resto. */
    if (d && d.data) {
      if (!dataExiste(String(d.data))) return { erro: 'Data inválida.' };
      if (d.data > U.hoje()) {
        return { erro: 'Saldo informado com data no futuro (' + U.fData(d.data) + ').' };
      }
    }
    if (d && Number(d.valor) < 0) {
      return { erro: 'Saldo bancário negativo precisa ser lançado como limite usado, não como saldo.' };
    }
    if (!pode('pagar') && !pode('lancar')) return { erro: 'Seu perfil não informa saldo bancário.' };
    if (!D.banco(bancoId)) return { erro: 'Conta não encontrada.' };
    if (d.valor === null || d.valor === undefined || isNaN(d.valor)) {
      return { erro: 'Informe o saldo que aparece no banco.' };
    }
    const reg = {
      banco: bancoId, valor: Math.round(d.valor * 100) / 100,
      data: d.data || U.hoje(), observacao: d.observacao || '',
      por: usuario().nome, em: new Date()
    };
    st.saldosInformados = st.saldosInformados.filter(function (x) {
      return !(x.banco === bancoId && x.data === reg.data);
    });
    st.saldosInformados.push(reg);
    const calc = saldoDoSistema(bancoId, reg.data);
    const dif = Math.round((reg.valor - calc) * 100) / 100;
    logar('extrato', bancoId, 'informou saldo bancário',
      U.brl(reg.valor) + ' em ' + U.fData(reg.data) +
      (Math.abs(dif) > 0.004 ? ' · diferença de ' + U.brl(dif) + ' contra o sistema' : ' · confere'));
    return { ok: true, registro: reg, sistema: calc, diferenca: dif };
  }

  const saldoInformado = bancoId => st.saldosInformados
    .filter(function (x) { return x.banco === bancoId; })
    .sort(function (a2, b2) { return (a2.data + '').localeCompare(b2.data + ''); })
    .slice(-1)[0] || null;

  /* Saldo que o sistema sustenta numa data: último extrato conciliado,
     mais o que foi baixado depois dele. */
  /* ── recebimento por CONTA ──────────────────────────────
     (integrado do ramo paralelo de QA) A soma é por BAIXA, não por
     título: um título pode ter baixas em datas e contas diferentes, e
     somar pelo título jogava tudo na conta da última baixa.

     Baixa sem conta informada fica fora de propósito — somá-la aqui a
     somaria no saldo de TODAS as contas. `recebidoSemConta` devolve
     esse total para a tela cobrar o cadastro. */
  function recebidoNaConta(bancoId, ate, corte) {
    const limite = ate || U.hoje();
    let soma = 0;
    st.receber.forEach(function (r) {
      (r.baixas || []).forEach(function (b) {
        if (b.banco !== bancoId) return;
        if (!b.data || b.data > limite) return;
        if (corte && b.data <= corte) return;
        soma += b.valor || 0;
      });
    });
    return Math.round(soma * 100) / 100;
  }


  function recebidoSemConta(ate) {
    const limite = ate || U.hoje();
    let soma = 0, qtd = 0;
    st.receber.forEach(function (r) {
      (r.baixas || []).forEach(function (b) {
        if (b.banco) return;
        if (!b.data || b.data > limite) return;
        soma += b.valor || 0; qtd++;
      });
    });
    return { valor: Math.round(soma * 100) / 100, baixas: qtd };
  }

  function saldoDoSistema(bancoId, ate) {
    const base = saldoAtual(bancoId);
    /* Saldo com divergência não entra em projeção como se fosse bom:
       quem consome recebe o aviso junto e decide. */
    const bloqueado = base && base.status === 'bloqueado';
    const corte = base.data || null;
    const limite = ate || U.hoje();
    const pago = todosPagamentos()
      .filter(function (p) { return p.banco === bancoId && p.data <= limite && (!corte || p.data > corte); })
      .reduce(function (s2, p) { return s2 + p.valor + (p.juros || 0) + (p.multa || 0); }, 0);
    /* Recebido na conta, somado BAIXA a BAIXA. Somar por título
       atribuía todo o recebimento à conta da última baixa, e o título
       com baixas em contas diferentes saía inteiro no lugar errado. */
    const recebido = recebidoNaConta(bancoId, limite, corte);
    /* Transferência entre contas do grupo move caixa de uma para
       outra: sai de uma, entra na outra, e o total do grupo não muda. */
    const transf = st.transferenciasBanco.reduce(function (s2, t) {
      if (t.cancelada) return s2;
      if (t.data > limite || (corte && t.data <= corte)) return s2;
      if (t.origem === bancoId) return s2 - t.valor;
      if (t.destino === bancoId) return s2 + t.valor;
      return s2;
    }, 0);
    const valor = Math.round(((base.valor || 0) - pago + recebido + transf) * 100) / 100;
    if (bloqueado) {
      /* Number com aviso anexado: quem só soma continua funcionando,
         e quem checa `.conferido` sabe que o número é provisório. */
      const n = new Number(valor);
      n.conferido = false;
      n.divergencia = base.divergencia;
      return n;
    }
    return valor;
  }

  /* Saldo do GRUPO, usado pelos resumos do contas a pagar e da fila de
     aprovação. Devolve o total e a decomposição por conta.
     (integrado do ramo paralelo de QA)

     Antes devolvia `D.bancos[0]`: o Bradesco da matriz passava por
     saldo de tudo, e a fila comparava um lote de quatro contas e três
     CNPJs contra o saldo de uma. A data é a MAIS ANTIGA das contas —
     um total só vale até onde a conta mais atrasada foi conferida. */
  function saldoBancarioAtual() {
    const ativas = D.bancos.filter(function (b) { return b.ativo !== false; });
    if (!ativas.length) return null;
    const contas = ativas.map(function (b) {
      const inf = saldoInformado(b.id);
      const doSistema = saldoDoSistema(b.id);
      return {
        banco: b.id, nome: b.apelido || b.nome || b.id, empresa: b.empresa || null,
        valor: inf ? inf.valor : +doSistema,
        /* Divergência de extrato acompanha o número, para quem
           consome decidir (ver saldoDoSistema). */
        /* Número digitado não é prova: divergência grande contra o
           sistema sai como NÃO conferida, a mesma regra que o extrato
           já seguia. Senão um zero a mais no saldo informado virava
           caixa do grupo e ia para a fila de aprovação e para o
           fluxo. */
        conferido: inf
          ? Math.abs((inf.valor || 0) - (+doSistema)) <= LIMITE_DIVERGENCIA_SALDO
          : doSistema.conferido !== false,
        divergencia_informado: inf
          ? Math.round(((inf.valor || 0) - (+doSistema)) * 100) / 100 : 0,
        data: inf ? inf.data : ((saldoAtual(b.id) || {}).data || null),
        origem: inf ? 'informado' : 'sistema'
      };
    });
    const total = Math.round(contas.reduce(function (s2, c) { return s2 + (c.valor || 0); }, 0) * 100) / 100;
    const datas = contas.map(function (c) { return c.data; }).filter(Boolean).sort();
    const informadas = contas.filter(function (c) { return c.origem === 'informado'; }).length;
    return {
      valor: total, data: datas[0] || null,
      origem: informadas === contas.length ? 'informado' : informadas ? 'misto' : 'sistema',
      contas: contas,
      /* Baixa sem conta não entra em saldo nenhum: a tela cobra. */
      sem_conta: recebidoSemConta()
    };
  }

  const saldosAtuais = () => D.bancos.filter(function (b) {
    return b.ativo && st.extratos.some(function (x) { return x.banco === b.id; });
  }).map(function (b) {
    return Object.assign({ nome: b.apelido || b.nome }, saldoAtual(b.id));
  });

  /* Baixa de recebimento.

     Antes não validava nada, e cada buraco tinha consequência no
     relatório: `d.valor || r.valor_liquido` tratava zero como campo
     vazio e gravava o valor cheio; o mesmo título podia ser baixado
     duas vezes; receber mais que o devido virava glosa negativa; e a
     data podia estar em qualquer ano. Agora tudo passa por aqui, e
     recebimento parcial deixou de ser gambiarra: soma as baixas e só
     fecha o título quando cobre o líquido.

     E "bater ou não bater" virou três faixas, porque líquido e bruto
     não são o mesmo teto:
     - entre o líquido esperado e o bruto da nota: a retenção real foi
       menor que a prevista (a previsão usa o percentual do cadastro,
       e nem sempre bate com o que o órgão de fato retém). Não é o
       cliente pagando a mais — vincula, quita e registra a
       divergência de retenção pra conferência.
     - acima do bruto: aí sim é dinheiro que não é deste título —
       bloqueia e pede outro título.
     - abaixo do líquido: pode ser glosa/multa de verdade (quita e a
       diferença vira glosa) ou só faltou completar (título segue
       aberto). Quem decide é quem está conciliando — a função devolve
       `decidir` em vez de chutar um dos dois. */
  /* Cancelar NF ou fatura no a receber. Não existia: emitida errada, o
     único jeito era mudar a competência — e a previsão substituída
     ficava presa. Cancelar devolve a previsão ao estado anterior. */
  function cancelarReceber(id, motivo) {
    if (!pode('cancelar')) return { erro: 'Seu perfil não cancela documento no contas a receber.' };
    if (!motivo) return { erro: 'Informe o motivo do cancelamento.' };
    const r = st.receber.find(function (x) { return x.id === id; });
    if (!r) return { erro: 'Documento não encontrado.' };
    if (r.status === 'cancelado') return { erro: 'Este documento já está cancelado.' };
    if (r.status === 'recebido' || (r.valor_recebido || 0) > 0.004) {
      return { erro: 'Já houve recebimento neste documento — estorne o recebimento antes de cancelar.' };
    }
    r.status = 'cancelado';
    r.cancelado_em = U.hoje();
    r.cancelado_por = usuario().nome;
    r.motivo_cancelamento = motivo;
    /* Devolve as previsões que ele havia substituído (ou travado como
       "a conferir"): sem isso o projeto ficava sem previsão nenhuma. */
    (r.substitui || []).forEach(function (pid) {
      const pv = st.receber.find(function (x) { return x.id === pid; });
      if (!pv) return;
      if (['substituido', 'previsto'].indexOf(pv.status) > -1) {
        pv.status = 'previsto';
        pv.conferir = null;
        /* Faturamento parcial: além do status, o VALOR abatido volta.
           Sem isso a previsão de R$ 100.000 abatida em R$ 40.000
           ficava em R$ 60.000 depois de a nota ser cancelada — e a
           observação dizia "voltou a valer". */
        const abatido = (pv.abatimentos || {})[r.id];
        if (abatido > 0) {
          pv.valor_bruto = Math.round((pv.valor_bruto + abatido) * 100) / 100;
          const ret = (pv.valor_retido || 0);
          pv.valor_liquido = Math.round((pv.valor_bruto - ret) * 100) / 100;
          delete pv.abatimentos[r.id];
        }
        pv.observacao = 'Voltou a valer: ' + (r.origem === 'fatura' ? 'fatura ' : 'NF ') + r.numero +
          ' cancelada' + (abatido > 0 ? ' · ' + U.brl(abatido) + ' devolvidos à previsão' : '');
      }
    });
    st.receber.filter(function (x) { return x.conferir === r.id; }).forEach(function (pv) {
      pv.conferir = null;
      pv.observacao = 'Voltou a valer: documento cancelado';
    });
    logar('conta_receber', r.id, 'cancelou documento',
      (r.origem === 'fatura' ? 'fatura ' : 'NF ') + r.numero + ' · ' + U.brl(r.valor_bruto) + ' · ' + motivo);
    return { ok: true };
  }

  function receberBaixa(id, d) {
    /* Permissão primeiro: um perfil de consulta recebia "título não
       encontrado" quando o id não existia, o que é a mensagem errada e
       ainda revela se o id existe ou não. */
    if (!pode('pagar')) return { erro: 'Seu perfil não dá baixa em recebimento.' };
    const r = st.receber.find(function (x) { return x.id === id; });
    if (!r) return { erro: 'Título não encontrado.' };
    if (r.status === 'recebido') {
      return { erro: 'Este título já está quitado. Para corrigir, estorne a baixa antes.' };
    }
    if (['cancelado', 'substituido'].indexOf(r.status) > -1) {
      return { erro: 'Título ' + r.status + ' não recebe baixa.' };
    }
    /* Dinheiro que entra é dinheiro que já foi faturado — uma previsão
       sozinha não emitiu nota pra ninguém pagar. Se caiu no banco, o
       faturamento já aconteceu e está sem lançar em algum lugar: o
       caminho é registrar a NF (que concilia com esta previsão pelo
       vínculo de faturamento), não dar baixa direto numa previsão. */
    if (r.status === 'previsto') {
      return { erro: 'Este título ainda é uma previsão, sem NF emitida. Se o dinheiro já ' +
        'entrou, é porque o faturamento já aconteceu — lance a NF em Faturamento (ela concilia ' +
        'com esta previsão) antes de vincular o recebimento.' };
    }

    /* zero é um valor digitado, não um campo em branco */
    const bruto = d.valor === '' || d.valor === null || d.valor === undefined
      ? r.valor_liquido : Number(d.valor);
    if (!isFinite(bruto)) return { erro: 'Valor inválido.' };
    const valor = Math.round(bruto * 100) / 100;
    if (valor <= 0) return { erro: 'O valor recebido tem de ser maior que zero.' };

    const jaRecebido = Math.round((r.valor_recebido || 0) * 100) / 100;
    const valorBrutoTitulo = Math.round((r.valor_bruto || r.valor_liquido) * 100) / 100;
    const restanteBruto = Math.round((valorBrutoTitulo - jaRecebido) * 100) / 100;
    const restanteLiquido = Math.round((r.valor_liquido - jaRecebido) * 100) / 100;

    if (valor > restanteBruto + 0.004) {
      return { erro: 'Recebimento de ' + U.brl(valor) + ' passa do valor bruto do título (' +
        U.brl(restanteBruto) + '). Se o cliente pagou a mais, lance a diferença como outro título.' };
    }
    if (valor < restanteLiquido - 0.004 && d.decisao !== 'quitar' && d.decisao !== 'residual') {
      return {
        decidir: 'resto_ou_glosa',
        mensagem: 'Recebido ' + U.brl(valor) + ', ' + U.brl(restanteLiquido - valor) +
          ' abaixo do líquido esperado (' + U.brl(restanteLiquido) + '). Esse pagamento quita ' +
          'a NF (pode ter tido glosa, multa etc.) ou mantém resíduo a receber?',
        resta: Math.round((restanteLiquido - valor) * 100) / 100
      };
    }

    const data = d.data || U.hoje();
    if (!dataExiste(data)) return { erro: 'Data de recebimento inválida.' };
    if (data > U.addDias(U.hoje(), 1)) {
      return { erro: 'Data de recebimento no futuro (' + U.fData(data) + ').' };
    }
    if (data < r.emissao) {
      return { erro: 'Recebimento (' + U.fData(data) + ') antes da emissão da nota (' +
        U.fData(r.emissao) + ').' };
    }
    const ate = st.parametros.travar_competencia_ate;
    if (ate && U.compDe(data) <= ate) {
      return { erro: 'Competência fechada até ' + U.fComp(ate) +
        '. Reabra o período na Administração para baixar nesta data.' };
    }

    r.baixas = r.baixas || [];
    r.baixas.push({ data: data, valor: valor, banco: d.banco || null,
                    usuario: usuario().nome, em: U.hoje() });
    r.valor_recebido = Math.round((jaRecebido + valor) * 100) / 100;
    r.recebido_em = data;
    const restaLiquido = Math.round((r.valor_liquido - r.valor_recebido) * 100) / 100;

    if (restaLiquido <= 0.004) {
      /* Cobriu o líquido esperado. Se sobrou até o bruto, a retenção
         real foi menor que a prevista — corrige o título pro que de
         fato entrou e registra a divergência, em vez de deixar o
         cadastro dizendo que reteve o que não reteve. */
      r.status = 'recebido';
      /* A glosa prevista já foi descontada para montar o líquido:
         contá-la de novo como retenção inflava o valor_retido,
         registrava uma divergência que não existiu e fazia o DRE
         deduzir a glosa na linha de retenções na fonte. */
      const glosaPrev = Math.round((r.glosa_prevista || 0) * 100) / 100;
      if (glosaPrev > 0) r.glosa_real = glosaPrev;
      const retencaoReal = Math.max(0, Math.round(
        (valorBrutoTitulo - r.valor_recebido - glosaPrev) * 100) / 100);
      if (Math.abs(retencaoReal - (r.valor_retido || 0)) > 0.004) {
        r.divergencia_retencao = { retido_previsto: r.valor_retido || 0, retido_real: retencaoReal,
          liquido_previsto: r.valor_liquido, origem_previsao: r.retencao_origem || null, em: data };
        logar('conta_receber', r.id, 'divergência de retenção',
          'previsto ' + U.brl(r.valor_retido || 0) + ' · real ' + U.brl(retencaoReal));
      }
      r.valor_retido = retencaoReal;
      r.valor_liquido = r.valor_recebido;
      r.glosa_real = 0;
    } else if (d.decisao === 'quitar') {
      /* Só chega aqui depois de alguém decidir — nunca sozinho. */
      r.status = 'recebido';
      r.glosa_real = restaLiquido;
    } else {
      r.status = 'faturado';
      r.glosa_real = 0;
    }
    logar('conta_receber', r.id, restaLiquido > 0.004 && d.decisao !== 'quitar' ? 'recebeu parcial' : 'recebeu',
      U.brl(valor) + (restaLiquido > 0.004 ? ' · resta ' + U.brl(restaLiquido) : '') +
      (r.glosa_real > 0.004 ? ' · glosa de ' + U.brl(r.glosa_real) : ''));
    return { ok: true, resta: Math.max(0, restaLiquido) };
  }

  /* Estorno da baixa: desfaz a última, ou todas. Não apaga histórico —
     o log guarda o que houve. */
  function estornarRecebimento(id, tudo) {
    const r = st.receber.find(function (x) { return x.id === id; });
    if (!r) return { erro: 'Título não encontrado.' };
    if (!pode('estornar')) return { erro: 'Seu perfil não estorna recebimento.' };
    const bx = r.baixas || [];
    if (!bx.length) return { erro: 'Este título não tem baixa para estornar.' };
    const tiradas = tudo ? bx.splice(0, bx.length) : [bx.pop()];
    const volta = tiradas.reduce(function (s2, b) { return s2 + b.valor; }, 0);
    r.valor_recebido = Math.round(((r.valor_recebido || 0) - volta) * 100) / 100;
    /* O ajuste de retenção é desfeito sempre que o recebido deixa de
       cobrir o bruto, não só quando zera. O caso que escapava: NF de
       1.000 com 100 de retenção, baixa de 400 e depois de 600 — a
       segunda cobre o bruto e o sistema zera a retenção; estornando
       os 600, sobravam 400 recebidos e a retenção continuava zerada,
       e o título passava a afirmar uma retenção que não existiu. */
    if (r.valor_recebido <= 0.004) {
      r.valor_recebido = 0; r.recebido_em = null;
    } else {
      r.recebido_em = bx[bx.length - 1].data;
    }
    if (r.divergencia_retencao && r.valor_recebido < (r.valor_bruto || 0) - 0.004) {
      r.valor_retido = r.divergencia_retencao.retido_previsto;
      r.valor_liquido = r.divergencia_retencao.liquido_previsto;
      delete r.divergencia_retencao;
    }
    r.glosa_real = 0;
    r.status = 'faturado';
    logar('conta_receber', r.id, 'estornou recebimento', U.brl(volta) +
      (tudo ? ' (todas as baixas)' : ''));
    return { ok: true, estornado: Math.round(volta * 100) / 100 };
  }

  /* ── consultas ──────────────────────────────────────────*/
  function listar(f) {
    f = f || {};
    return st.parcelas.filter(p =>
      /* Filtro por empresa do grupo: a parcela pertence à empresa que
         pagou (conta) ou, sem pagamento, à do projeto. */
      (!f.empresa || empresaDaParcela(p) === f.empresa) &&
      (!f.banco || bancoDaParcela(p) === f.banco) &&
      (!f.comp    || p.comp === f.comp) &&
      (!f.centro  || (p.rateio || []).some(function (r) { return r.centro === f.centro; })) &&
      (!f.conta   || p.conta === f.conta || (ERP.dados.conta(p.conta) || {}).pai === f.conta) &&
      (!f.status || (f.status === 'apagar'
                       ? (p.status !== 'pago' && p.status !== 'cancelado' && p.status !== 'substituido')
                       : f.status === 'nao_pago'
                         ? p.status !== 'pago'
                       : f.status === 'aberto'
                         ? (p.status === 'aberto' || p.status === 'parcial')
                         : p.status === f.status)) &&
      (!f.aprov   || p.aprovacao === f.aprov) &&
      /* O filtro de fornecedor aceita o id (escolha na lista) ou um
         pedaço do nome digitado, prefixado por __texto__ — é o que
         permite digitar "marina" e achar a Dra. Marina Alves sem rolar
         uma lista de centenas. */
      (!f.credor || (String(f.credor).indexOf('__texto__') === 0
        ? nomeCredorVisivel(p).toLowerCase().indexOf(String(f.credor).slice(9)) > -1
        : p.credor === f.credor)) &&
      (!f.de      || (p.venc || '') >= f.de) &&
      (!f.ate     || (p.venc || '') <= f.ate) &&
      (!f.baixaDe || (p.pago_em || '') >= f.baixaDe) &&
      (!f.baixaAte || (p.pago_em || '') <= f.baixaAte) &&
      (!f.anexo   || (f.anexo === 'sem' ? pagoSemNota(p)
                    : f.anexo === 'sem_qualquer' ? !temNota(p)
                    : f.anexo === 'sem_arquivo' ? (!!p.doc && !p.arquivo && !p.chave)
                    : f.anexo === 'dispensada' ? !!p.nf_dispensada
                    : !!(p.arquivo || p.chave))) &&
      /* A busca olha o nome do fornecedor — mas em título de pessoal
         quem não tem acesso a dados pessoais procura sobre o texto
         MASCARADO, senão dava pra achar o salário de alguém digitando
         o nome da pessoa. */
      (!f.busca   || (descricaoVisivel(p) + ' ' + (p.doc || '') + ' ' +
        nomeCredorVisivel(p, (D.credor(p.credor) || {}).nome || '')).toLowerCase()
        .indexOf(f.busca.toLowerCase()) > -1)
    ).sort((a, b) => (a.venc || '').localeCompare(b.venc || '') || a.num - b.num);
  }

  // valor da parcela que pertence a um centro de custo, já rateado
  /* Partes do rateio de uma parcela, com a SOBRA DE CENTAVOS na
     última: num rateio 33,33/33,33/33,34, arredondar cada parte por
     fora deixava a soma diferente do total em boa parte dos valores.
     `despesaPorEmpresa` já fazia certo e `valorNoCentro` não — duas
     contas para o mesmo rateio, discordando entre si. Agora é uma só. */
  function partesDoRateio(par) {
    const rat = (par.rateio && par.rateio.length)
      ? par.rateio : [{ centro: par.centro, pct: 100 }];
    let acumulado = 0;
    return rat.map(function (r, i) {
      const v = i === rat.length - 1
        ? Math.round((par.valor - acumulado) * 100) / 100
        : Math.round((par.valor * (r.pct !== undefined ? r.pct / 100 : 1)) * 100) / 100;
      acumulado = Math.round((acumulado + v) * 100) / 100;
      return { centro: r.centro, pct: r.pct, valor: v };
    });
  }

  function valorNoCentro(par, centroId) {
    /* SOMA as fatias do centro: com o mesmo centro repetido no rateio
       (que a edição deixava passar), o `find` devolvia só a primeira e
       o relatório por centro perdia o resto. */
    return Math.round(partesDoRateio(par).reduce(function (s2, x) {
      return x.centro === centroId ? s2 + x.valor : s2;
    }, 0) * 100) / 100;
  }

  const parcela = id => st.parcelas.find(p => p.id === id) || null;
  const eventosDe = id => st.eventos.filter(e => e.entidade_id === id);
  const pagamentosTodos = pid => st.pagamentos.filter(p => p.parcela_id === pid);
  const pendentesAprovacao = () => st.parcelas.filter(p => p.aprovacao === 'pendente' && p.status !== 'cancelado');
  /* Título PAGO e marcado "Sem NF". O alerta é a marcação explícita, não
     a ausência de anexo: a maioria dos títulos tem o NÚMERO da nota
     informado e isso basta pra contabilidade. Quem lança um pagamento
     sem nota marca "Sem NF" e o título entra aqui até alguém informar o
     número (ou anexar o arquivo) — o que pode ser feito a qualquer
     momento, mesmo depois de pago. */
  const temNota = p => !!(p.doc || p.arquivo || p.chave);
  /* Despesa que NÃO tem nota por natureza — tarifa bancária, IOF, juros
     de banco, imposto pago por guia — fica fora do alerta: cobrar nota
     dessas seria cobrar um documento que não existe. A dispensa marcada
     à mão (`nf_dispensada`) também tira do alerta. */
  const SEM_NOTA_POR_NATUREZA = ['9.01', '9.02', '9.03', '9.04'];
  const dispensaNota = p => !!p.nf_dispensada ||
    SEM_NOTA_POR_NATUREZA.indexOf(p.conta) > -1 ||
    (p.contas_rateio || []).every(function (c) { return SEM_NOTA_POR_NATUREZA.indexOf(c.conta) > -1; }) &&
      (p.contas_rateio || []).length > 0;
  const pagoSemNota = p => p.status !== 'cancelado' && p.sem_nf === true && !temNota(p) &&
    !dispensaNota(p) && (p.status === 'pago' || pagoDe(p.id) > 0.004);
  const semAnexo = () => st.parcelas.filter(pagoSemNota);
  const todasParcelas = () => st.parcelas.slice();
  /* Só "liquidado" já saiu do banco de verdade — autorizado e enviado
     ainda podem ser desfeitos (basta desautorizar ou a remessa falhar)
     e não são caixa realizado. Contar esses dois aqui inflava o
     realizado com dinheiro que nunca chegou a sair, e ainda deixava a
     solicitação desfeita sem desaparecer do relatório. */
  const todosPagamentos = () => st.pagamentos.filter(p => !p.estornado && p.situacao === 'liquidado');

  /* ── ATIVOS (equipamentos) ──────────────────────────────
     Natureza oposta à do almoxarifado: aqui não há saldo, há ITEM. Cada
     ativo tem série, local, custodiante e história. A regra central é
     não editar o local no cadastro: toda mudança é um EVENTO
     (movimentação), e local/status atuais são consulta do último. Sem
     isso não há como provar devolução nem dizer onde o equipamento
     estava numa data passada. */
  function ativos(f) {
    f = f || {};
    return st.ativos.filter(function (a) {
      const at = situacaoAtiva(a);
      return (!f.status || at.status === f.status) &&
        (!f.projeto || at.projeto === f.projeto) &&
        (!f.categoria || a.categoria === f.categoria) &&
        (f.incluir_baixados || at.status !== 'baixado') &&
        (f.incluir_desmembrados || !a.desmembrado) &&
        (!f.compra || (a.compra || a.id) === f.compra) &&
        (!f.busca || [a.tag, a.descricao, a.serie, a.modelo, a.marca, a.categoria,
          at.local, at.custodiante, a.nf].filter(Boolean).join(' ').toLowerCase()
          .indexOf(String(f.busca).toLowerCase()) > -1);
    }).map(function (a) { return Object.assign({}, a, situacaoAtiva(a)); })
      .sort(function (x, y) { return String(x.tag).localeCompare(String(y.tag), 'pt-BR'); });
  }

  const ativo = id => st.ativos.find(function (a) { return a.id === id; }) || null;
  const movimentacoesDoAtivo = id => st.ativoMov
    .filter(function (m) { return m.ativo === id; })
    .sort(function (a, b) { return -ordemEventos(a, b); });

  /* Situação ATUAL = último evento. O cadastro guarda só a situação
     inicial (a que veio da planilha). */
  /* A ordem dos eventos do MESMO dia era por id em texto, e "am999"
     vem depois de "am1000" em texto: passadas mil movimentações, o
     sistema apontava o lugar errado. A ordem agora é por data e, dentro
     do dia, pela sequência numérica do id (com o horário de registro
     como desempate). */
  const seqDoEvento = m => {
    const n = parseInt(String(m.id).replace(/\D/g, ''), 10);
    return isNaN(n) ? 0 : n;
  };
  const ordemEventos = (x, y) =>
    String(x.data).localeCompare(String(y.data)) ||
    (seqDoEvento(x) - seqDoEvento(y)) ||
    String(x.registrado_em || '').localeCompare(String(y.registrado_em || ''));

  function situacaoAtiva(a) {
    const evs = st.ativoMov.filter(function (m) { return m.ativo === a.id && !m.estornado; }).sort(ordemEventos);
    const ult = evs[evs.length - 1];
    if (!ult) {
      return { status: a.status || 'sede', local: a.local || '', projeto: a.projeto || null,
        custodiante: a.custodiante || '',
        custodiante_telefone: a.custodiante_telefone || '',
        custodiante_email: a.custodiante_email || '',
        desde: a.aquisicao || null, eventos: 0 };
    }
    /* O contato vem do último movimento, e cai para o do cadastro
       quando o movimento não trouxe: trocar de custodiante sem
       informar telefone não deve apagar o que já se sabia. */
    return { status: ult.status, local: ult.destino, projeto: ult.projeto || null,
      custodiante: ult.custodiante || '',
      custodiante_telefone: ult.custodiante_telefone || a.custodiante_telefone || '',
      custodiante_email: ult.custodiante_email || a.custodiante_email || '',
      desde: ult.data, eventos: evs.length };
  }

  /* Nome de quem contratou o equipamento — é diferente de onde ele
     está: a Unifor contrata e o aparelho opera na Santa Casa. */
  function nomeContratante(a) {
    if (!a) return '';
    if (a.contratante_nome) return a.contratante_nome;
    if (a.contratante) {
      const c = D.centro(a.contratante);
      if (c) return c.curto || c.nome;
      const cli = (D.clientes || []).find(function (x) { return x.id === a.contratante; });
      if (cli) return cli.nome;
    }
    /* Sem contratante informado, o contrato de locação diz quem é. */
    if (a.contrato) {
      const ct = st.contratos.find(function (x) { return x.id === a.contrato; });
      if (ct) return ct.parte_nome || ct.cliente_nome || '';
    }
    return '';
  }

  const proximaTag = () => {
    const maior = st.ativos.reduce(function (m, x) {
      const n = parseInt(String(x.tag || '').replace(/\D/g, ''), 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    return 'PAT-' + String(maior + 1).padStart(3, '0');
  };

  function salvarAtivo(d) {
    if (!podeMover('ativos')) return { erro: 'Seu perfil não cadastra ativos.' };
    /* Edição parcial (só a vida útil, por exemplo) não precisa repetir
       a descrição — só o cadastro novo exige. */
    if (!d.id && !d.descricao) return { erro: 'Informe a descrição do equipamento.' };
    if (d.id && d.descricao !== undefined && !d.descricao) {
      return { erro: 'A descrição não pode ficar vazia.' };
    }
    if (d.contratante !== undefined && d.contratante && !D.centro(d.contratante) &&
        !D.clientes.some(function (c) { return c.id === d.contratante; })) {
      return { erro: 'Contratante não encontrado no cadastro.' };
    }
    if (d.valor !== undefined && d.valor < 0) {
      return { erro: 'Valor negativo não existe em patrimônio — ele reduziria o imobilizado e inverteria o resultado.' };
    }
    if (d.aquisicao && d.aquisicao > U.hoje()) return { erro: 'A data de aquisição não pode ser no futuro.' };
    if (d.garantia_ate && d.aquisicao && d.garantia_ate < d.aquisicao) {
      return { erro: 'A garantia não pode terminar antes da aquisição.' };
    }
    if (d.vida_util_meses !== undefined && d.vida_util_meses !== null && d.vida_util_meses < 1) {
      return { erro: 'A vida útil é em meses inteiros, a partir de 1 (padrão: 60).' };
    }
    if (d.qtd !== undefined && d.qtd !== null && (d.qtd < 1 || d.qtd % 1 !== 0)) {
      return { erro: 'A quantidade de unidades é um número inteiro, a partir de 1.' };
    }
    const repetido = d.serie && st.ativos.find(function (a) {
      return a.id !== d.id && a.serie && a.serie.toLowerCase() === String(d.serie).toLowerCase();
    });
    if (repetido) return { erro: 'Já existe ativo com a série ' + d.serie + ' (' + repetido.tag + ').' };
    const novo = !d.id;
    const a = novo ? { id: novoId('at'), criado_em: new Date(), criado_por: usuario().nome } : ativo(d.id);
    if (!a) return { erro: 'Ativo não encontrado.' };
    ['tag', 'categoria', 'descricao', 'marca', 'modelo', 'serie', 'fornecedor', 'nf', 'valor',
     'aquisicao', 'garantia_ate', 'criticidade', 'vida_util_meses', 'contrato', 'observacao', 'qtd',
     /* patrimônio = etiqueta que a empresa já usa no equipamento;
        contratante = quem contratou, que não é onde ele está. */
     'patrimonio', 'contratante', 'contratante_nome'
    ].forEach(function (k) { if (d[k] !== undefined) a[k] = d[k]; });
    /* Patrimônio, como a tag, não se repete: é o número da etiqueta. */
    if (d.patrimonio) {
      const rep2 = st.ativos.find(function (x) {
        return x.id !== a.id && String(x.patrimonio || '').trim() &&
          String(x.patrimonio).trim() === String(d.patrimonio).trim(); });
      if (rep2) return { erro: 'Já existe equipamento com o patrimônio ' + d.patrimonio + ' (' + rep2.tag + ').' };
    }
    /* A tag digitada também precisa ser única: sem isso, PAT-030
       cadastrada à mão colidia com a próxima automática. */
    if (d.tag) {
      const mesmaTag = st.ativos.find(function (x) {
        return x.id !== d.id && String(x.tag || '').toLowerCase() === String(d.tag).toLowerCase();
      });
      if (mesmaTag) return { erro: 'Já existe equipamento com a tag ' + d.tag + '.' };
    }
    /* CUSTODIANTE e contato também na EDIÇÃO. Local, situação e
       projeto continuam só por movimentação — são fatos, e fato
       precisa de data e documento. Quem responde pelo equipamento é
       cadastro: exigir uma movimentação para corrigir um nome faria
       inventarem movimentação que não houve, e o histórico passaria
       a mentir sobre onde o bem esteve. */
    if (!novo) {
      if (d.custodiante !== undefined) a.custodiante = d.custodiante || '';
      if (d.custodiante_telefone !== undefined) a.custodiante_telefone = d.custodiante_telefone || '';
      if (d.custodiante_email !== undefined) a.custodiante_email = d.custodiante_email || '';
    }

    if (novo) {
      /* Numerar por "quantidade + 1" repetia a tag assim que alguém
         cadastrava uma fora da sequência: agora segue o maior número já
         usado. */
      a.tag = a.tag || proximaTag();
      a.status = d.status || 'sede';
      a.local = d.local || '';
      a.projeto = d.projeto || null;
      a.custodiante = d.custodiante || '';
      /* Contato do custodiante: opcional, mas guardado junto do nome
         — é o que falta quando o equipamento precisa voltar. */
      a.custodiante_telefone = d.custodiante_telefone || '';
      a.custodiante_email = d.custodiante_email || '';
      a.qtd = d.qtd || 1;
      st.ativos.push(a);
    }
    logar('ativo', a.id, novo ? 'cadastrou ativo' : 'editou ativo', a.tag + ' · ' + a.descricao);
    return { ok: true, ativo: a };
  }

  /* Movimentação: é o evento que manda. Guarda de onde saiu, para onde
     foi, quem autorizou e o documento de remessa — é o que prova a
     devolução. */
  function movimentarAtivo(d) {
    if (!podeMover('ativos')) return { erro: 'Seu perfil não movimenta ativos.' };
    const a = ativo(d.ativo);
    if (!a) return { erro: 'Ativo não encontrado.' };
    const eDesm = checarDesmembrado(a);
    if (eDesm) return { erro: eDesm };
    if (!d.status) return { erro: 'Informe a nova situação.' };
    if (!d.destino && d.status !== 'baixado') return { erro: 'Informe para onde o equipamento vai.' };
    if (d.data && d.data > U.hoje()) return { erro: 'A movimentação não pode ser no futuro.' };
    const atual = situacaoAtiva(a);
    if (d.status === 'alocado' && !d.projeto) return { erro: 'Alocar em projeto exige dizer qual projeto.' };
    if (['terceiro', 'alocado'].indexOf(d.status) > -1 && !d.custodiante && !d.responsavel) {
      return { erro: 'Equipamento fora da sede precisa de custodiante — é quem responde por ele.' };
    }
    /* Baixar não é movimentar: exige motivo, encerra locação e apura
       ganho ou perda. Sem esta porta fechada, dava para contornar o
       botão Baixar e deixar o ativo meio baixado. */
    if (d.status === 'baixado' && !d.pela_baixa) {
      return { erro: 'Para baixar o equipamento use "Baixar" — lá entram o motivo, o valor de venda ' +
        'e o encerramento da locação.' };
    }
    /* Item baixado não volta por movimentação comum: baixa é decisão
       (venda, sucata, perda) e desfazer exige motivo explícito. */
    if (atual.status === 'baixado' && d.status !== 'baixado' && !d.motivo_retorno) {
      return { erro: 'Este equipamento está baixado. Para reativá-lo, use "Reativar" e informe o motivo.' };
    }
    /* Movimentação retroativa não pode ficar ATRÁS de um evento já
       registrado: a origem gravada seria o local de hoje, e o histórico
       passaria a mentir sobre onde o item estava. */
    const ultimoEvento = st.ativoMov.filter(function (m) { return m.ativo === a.id && !m.estornado; })
      .sort(ordemEventos).slice(-1)[0];
    if (ultimoEvento && d.data && d.data < ultimoEvento.data) {
      return { erro: 'Já existe movimentação em ' + U.fData(ultimoEvento.data) +
        '. Uma movimentação anterior a essa data reescreveria o histórico. ' +
        'Estorne aquele evento na ficha do equipamento (com motivo) ou lance a partir da data dele.' };
    }
    /* Mesmo lugar e mesma situação não é movimentação: só zerava o
       contador de "parado há". */
    if (atual.status === d.status && (atual.local || '') === (d.destino || '') &&
        (atual.projeto || null) === (d.projeto || null)) {
      return { erro: 'O equipamento já está assim (' + D.nomeStatusAtivo(d.status) +
        (d.destino ? ' · ' + d.destino : '') + '). Nada mudou, então não há o que registrar.' };
    }
    const m = {
      id: novoId('am'), ativo: a.id, data: d.data || U.hoje(),
      origem: atual.local || '(sem registro)', destino: d.destino || '—',
      status: d.status,
      /* Fora de "alocado" e "em manutenção", o equipamento não pertence
         a projeto nenhum — senão continuava recebendo depreciação de um
         projeto de onde já tinha saído. */
      projeto: d.status === 'alocado' ? d.projeto
        : (d.status === 'manutencao' || d.status === 'devolucao' ? (d.projeto || null) : null),
      custodiante: d.custodiante || d.responsavel || '',
      custodiante_telefone: d.custodiante_telefone || '',
      custodiante_email: d.custodiante_email || '',
      autorizado_por: d.autorizado_por || usuario().nome,
      documento: d.documento || '', observacao: d.observacao || '',
      registrado_por: usuario().nome, registrado_em: new Date()
    };
    st.ativoMov.push(m);
    logar('ativo', a.id, 'movimentou ativo',
      a.tag + ' · ' + m.origem + ' → ' + m.destino + ' · ' + D.nomeStatusAtivo(m.status) +
      (m.documento ? ' · ' + m.documento : ''));
    return { ok: true, movimentacao: m };
  }

  /* Baixa: venda, sucata ou perda. É evento como qualquer outro, mas
     exige motivo — é o que sustenta a saída do imobilizado. */
  /* O lote-pai desmembrado não existe mais como bem: quem existe são
     as partes. Baixar, vender ou movimentar o pai mexia num registro
     fantasma — fora de `ativos({})`, então nada do que acontecia com
     ele aparecia — enquanto as unidades reais seguiam no patrimônio. */
  function checarDesmembrado(a) {
    if (a && a.desmembrado) {
      return 'Este registro foi desmembrado em ' + (a.partes || []).length +
        ' unidade(s). A ação tem de ser feita em cada parte, não no lote.';
    }
    return null;
  }

  function baixarAtivo(id, d) {
    /* Baixar é dar saída do patrimônio (e, na venda, mexer em dinheiro):
       não é a mesma mão que movimenta equipamento no dia a dia. */
    if (!pode('baixar_ativo')) {
      return { erro: 'Seu perfil não dá baixa em ativo — é decisão de patrimônio, não de movimentação.' };
    }
    const a = ativo(id);
    if (!a) return { erro: 'Ativo não encontrado.' };
    const baixaDesm = checarDesmembrado(a);
    if (baixaDesm) return { erro: baixaDesm };
    d = d || {};
    if (!d.motivo) return { erro: 'Informe o motivo da baixa (venda, sucata, perda, devolução ao fornecedor).' };
    /* Valor de venda só existe em venda. Numa perda, ele registrava
       "resultado positivo" e não gerava cobrança nenhuma; e uma venda
       sem valor virava perda do residual sem ninguém perceber. */
    if (d.motivo === 'venda' && !(d.valor_venda > 0)) {
      return { erro: 'Venda sem valor: informe por quanto o equipamento foi vendido. ' +
        'Se ele saiu sem contrapartida, o motivo é "devolução ao fornecedor" ou "perda".' };
    }
    if (d.motivo !== 'venda' && d.valor_venda > 0) {
      return { erro: 'Valor de venda só vale para o motivo "venda". Indenização de seguro (roubo, perda) ' +
        'entra como recebível próprio no contas a receber, contra a seguradora.' };
    }
    if (situacaoAtiva(a).status === 'baixado') return { erro: 'Este equipamento já está baixado.' };
    /* As mesmas travas da movimentação: a baixa é um evento como os
       outros, e estava passando por fora delas. */
    const data = d.data || U.hoje();
    if (data > U.hoje()) return { erro: 'A baixa não pode ser lançada com data futura.' };
    const ultimo = st.ativoMov.filter(function (m) { return m.ativo === a.id && !m.estornado; })
      .sort(ordemEventos).slice(-1)[0];
    if (ultimo && data < ultimo.data) {
      return { erro: 'Já existe movimentação em ' + U.fData(ultimo.data) +
        '. Uma baixa anterior a essa data entraria no meio do histórico e o equipamento ficaria ' +
        'baixado e alocado ao mesmo tempo. Estorne aquele evento ou use uma data a partir dele.' };
    }
    /* OS aberta é ponta solta: o equipamento sairia do patrimônio com
       serviço em andamento e custo a lançar. */
    const osAbertas = st.ordensServico.filter(function (o) {
      return o.ativo === a.id && o.status !== 'fechada'; });
    if (osAbertas.length) {
      return { erro: osAbertas.length + ' ordem(ns) de serviço em aberto (' +
        osAbertas.map(function (o) { return o.numero; }).join(', ') +
        '). Feche ou cancele antes de baixar o equipamento.', osAbertas: true };
    }
    const m = {
      id: novoId('am'), ativo: a.id, data: d.data || U.hoje(),
      origem: situacaoAtiva(a).local || '', destino: d.destino || 'Baixado',
      status: 'baixado', projeto: null, custodiante: '', pela_baixa: true,
      autorizado_por: usuario().nome, documento: d.documento || '',
      observacao: 'Baixa: ' + d.motivo + (d.observacao ? ' · ' + d.observacao : ''),
      registrado_por: usuario().nome, registrado_em: new Date()
    };
    st.ativoMov.push(m);

    /* A locação encerra na data da baixa: sem isso, o equipamento
       vendido continuava "rendendo" no resultado. */
    if (a.contrato) {
      a.locacao_ate = a.locacao_ate && a.locacao_ate < m.data ? a.locacao_ate : m.data;
    }
    /* Resultado da baixa contra o valor que ainda não tinha
       depreciado: venda acima do residual é ganho, abaixo é perda, e
       sucata/perda é o residual inteiro virando prejuízo. */
    const dep = depreciacaoDoAtivo(a, m.data);
    const venda = d.valor_venda || 0;
    const resultado = Math.round((venda - dep.residual) * 100) / 100;
    a.baixa = {
      motivo: d.motivo, data: m.data, por: usuario().nome,
      valor_venda: venda || null, residual: dep.residual, resultado: resultado
    };

    /* Venda gera cobrança: o dinheiro entra pelo contas a receber como
       qualquer outra venda, senão some do sistema. */
    let receber = null;
    if (venda > 0 && d.motivo === 'venda' && pode('faturar')) {
      const r = criarReceber({
        numero: d.documento || ('VENDA-' + a.tag), emissao: m.data,
        cliente_nome: d.comprador || 'Comprador do ativo ' + a.tag,
        centro: d.centro || 'cc100', competencia: U.compDe(m.data),
        vencimento: d.vencimento || m.data, valor_bruto: venda,
        origem: 'avulso', forcar_sem_liberacao: true,
        /* 1.04 é alienação de imobilizado — receita não operacional. */
        conta: '1.04',
        discriminacao: 'Venda do ativo ' + a.tag + ' — ' + (a.descricao || '') +
          ' · valor residual ' + U.brl(dep.residual) +
          ' · ' + (resultado >= 0 ? 'ganho de capital ' : 'perda de ') + U.brl(Math.abs(resultado))
      });
      if (r.ok) { receber = r.receber; a.baixa.receber_id = r.receber.id; }
      else a.baixa.erro_receber = r.erro;
    }

    logar('ativo', a.id, 'baixou ativo', a.tag + ' · ' + d.motivo +
      (venda ? ' · venda por ' + U.brl(venda) : '') +
      ' · residual ' + U.brl(dep.residual) +
      ' · ' + (resultado >= 0 ? 'ganho ' : 'perda ') + U.brl(Math.abs(resultado)));
    return { ok: true, movimentacao: m, resultado: resultado, residual: dep.residual, receber: receber };
  }

  function reativarAtivo(id, d) {
    if (!podeMover('ativos')) return { erro: 'Seu perfil não reativa ativo.' };
    const a = ativo(id);
    if (!a) return { erro: 'Ativo não encontrado.' };
    if (situacaoAtiva(a).status !== 'baixado') return { erro: 'Este equipamento não está baixado.' };
    if (!(d || {}).motivo) return { erro: 'Informe por que a baixa está sendo desfeita.' };
    /* A venda desfeita não pode deixar a cobrança de pé: ou cancela
       junto, ou o sistema explica por que não dá. */
    const vendaId = (a.baixa || {}).receber_id;
    const venda = vendaId ? st.receber.find(function (r) { return r.id === vendaId; }) : null;
    if (venda && venda.status !== 'cancelado') {
      if ((venda.valor_recebido || 0) > 0.004) {
        return { erro: 'A venda de ' + U.brl(venda.valor_bruto) + ' já teve recebimento registrado (' +
          U.brl(venda.valor_recebido) + '). Estorne o recebimento e cancele o título antes de reativar.' };
      }
      const c = cancelarReceber(venda.id, 'Baixa desfeita: ' + d.motivo);
      if (c.erro) return { erro: 'Não foi possível cancelar a cobrança da venda: ' + c.erro };
    }
    const r = movimentarAtivo({ ativo: id, status: d.status || 'sede', destino: d.destino || 'Sede',
      custodiante: d.custodiante || '', observacao: 'Baixa desfeita: ' + d.motivo,
      motivo_retorno: d.motivo });
    if (r.erro) return r;
    /* A locação NÃO é reaberta sozinha: se o equipamento volta a
       operar, o vínculo é decisão de quem cuida do contrato. */
    a.baixa = null;
    logar('ativo', a.id, 'desfez baixa', a.tag + ' · ' + d.motivo);
    return r;
  }

  /* Estorno de movimentação: a mensagem de bloqueio mandava "corrigir
     o evento existente" e não havia como. Estornar não apaga — marca o
     evento como estornado, com motivo, e ele sai do cálculo da
     situação atual, continuando visível no histórico. */
  function estornarMovimentacao(movId, motivo) {
    if (!pode('estoque')) return { erro: 'Seu perfil não estorna movimentação.' };
    if (!motivo) return { erro: 'Informe o motivo do estorno.' };
    const m = st.ativoMov.find(function (x) { return x.id === movId; });
    if (!m) return { erro: 'Movimentação não encontrada.' };
    if (m.estornado) return { erro: 'Esta movimentação já foi estornada.' };
    if (m.pela_baixa) return { erro: 'Baixa não se estorna: use "Reativar" na ficha do equipamento.' };
    /* Estornar a entrada em manutenção com a OS ainda aberta deixava o
       equipamento "alocado" e a OS "parada" ao mesmo tempo — e o
       retorno, no fechamento, devolvia algo que já tinha voltado. */
    /* Movimentação criada por OS não se estorna por fora, NUNCA: a
       trava antiga só valia enquanto a OS estava aberta, e depois de
       fechada dava para estornar o RETORNO — o equipamento ficava "em
       manutenção" sem OS nenhuma. Quem errou o retorno reabre a OS. */
    if (m.os_id || (m.documento && /^OS-\d+/.test(String(m.documento)))) {
      const os = st.ordensServico.find(function (o) {
        return o.id === m.os_id || o.numero === m.documento; });
      const nome = os ? os.numero : String(m.documento);
      return { erro: 'Esta movimentação foi criada pela ' + nome + '. ' +
        (os && ['fechada', 'cancelada'].indexOf(os.status) > -1
          ? 'Para corrigi-la, reabra a OS — o equipamento volta para a manutenção por lá.'
          : 'Feche ou cancele a OS — o equipamento volta por lá.') };
    }
    m.estornado = true;
    m.estorno = { motivo: motivo, em: U.hoje(), por: usuario().nome };
    logar('ativo', m.ativo, 'estornou movimentação',
      U.fData(m.data) + ' · ' + m.origem + ' → ' + m.destino + ' · ' + motivo);
    return { ok: true, movimentacao: m };
  }

  /* Onde o ativo estava numa DATA — é o que a auditoria pergunta. */
  function ondeEstavaEm(ativoId, data) {
    const evs = st.ativoMov.filter(function (m) {
      return m.ativo === ativoId && m.data <= data && !m.estornado; }).sort(ordemEventos);
    const a = ativo(ativoId) || {};
    const ult = evs[evs.length - 1];
    return ult ? { local: ult.destino, status: ult.status, projeto: ult.projeto, desde: ult.data }
      : { local: a.local || '', status: a.status || 'sede', projeto: a.projeto || null, desde: a.aquisicao || null };
  }

  /* ── desmembramento de compra em ativos ─────────────────
     Uma compra de 10 camas não é um ativo: pode virar 10 ativos, ou 3
     lotes (2 num projeto, 5 em outro, 3 na sede), ou seguir junta
     enquanto ninguém dividiu. Cada parte segue com história, locação e
     resultado próprios, e todas continuam apontando para a mesma
     COMPRA — é o que permite ler o resultado por unidade e o da compra
     inteira. */
  function desmembrarAtivo(id, d) {
    if (!podeMover('ativos')) return { erro: 'Seu perfil não desmembra ativos.' };
    const a = ativo(id);
    if (!a) return { erro: 'Ativo não encontrado.' };
    if (a.desmembrado) return { erro: 'Este registro já foi desmembrado.' };
    /* Registro BAIXADO não se desmembra: as partes nasciam na sede e
       o valor baixado voltava ao imobilizado — R$ 576.000 de sucata
       ressuscitando. */
    if (situacaoAtiva(a).status === 'baixado') {
      return { erro: 'Este registro está baixado. Não dá para desmembrar o que saiu do patrimônio.' };
    }
    d = d || {};
    const total = a.qtd || 1;
    if (total < 2) return { erro: 'Este registro tem uma unidade só — não há o que desmembrar.' };

    let partes;
    if (d.modo === 'unitario') {
      const base = d.destino || {};
      partes = [];
      for (let i = 0; i < total; i++) partes.push(Object.assign({ qtd: 1 }, base));
    } else {
      partes = (d.partes || []).filter(function (p) { return (p.qtd || 0) > 0; });
    }
    if (!partes.length) return { erro: 'Informe como a compra será dividida.' };
    /* Equipamento é contado em unidades inteiras: 1,5 bomba de
       infusão não existe. `salvarAtivo` já recusava fracionado, e o
       desmembramento deixava passar. */
    const fracionada = partes.find(function (p) { return Math.abs((p.qtd || 0) % 1) > 0.0001; });
    if (fracionada) {
      return { erro: 'As partes precisam ser quantidades inteiras (recebido ' +
        fracionada.qtd + ').' };
    }
    const soma = partes.reduce(function (x, p) { return x + p.qtd; }, 0);
    if (Math.abs(soma - total) > 0.0001) {
      return { erro: 'As partes somam ' + U.num(soma) + ' de ' + U.num(total) +
        ' unidades. A divisão precisa fechar com a quantidade comprada.' };
    }
    const semDestino = partes.find(function (p) {
      return (p.status === 'alocado' && !p.projeto) ||
        (['terceiro', 'alocado'].indexOf(p.status) > -1 && !p.custodiante);
    });
    if (semDestino) return { erro: 'Parte alocada precisa de projeto e custodiante.' };

    /* O valor da compra é rateado por unidade — é o que dá sentido ao
       resultado individual (aquisição de cada cama, não da nota toda). */
    const unit = total ? Math.round(((a.valor || 0) / total) * 100) / 100 : 0;
    const compra = a.compra || a.id;
    const filhos = [];
    let acumulado = 0;
    partes.forEach(function (p, i) {
      const ultimo = i === partes.length - 1;
      const valor = ultimo ? Math.round(((a.valor || 0) - acumulado) * 100) / 100
        : Math.round(unit * p.qtd * 100) / 100;
      acumulado = Math.round((acumulado + valor) * 100) / 100;
      const filho = {
        id: novoId('at'),
        tag: (a.tag || 'PAT') + '-' + String(i + 1).padStart(2, '0'),
        categoria: a.categoria,
        /* A descrição vinha do lote ("2 respiradores") e ficava errada
           na parte de 1 unidade. */
        descricao: a.descricao.replace(/^\s*\d+\s+/, '') +
          (p.qtd > 1 ? ' (' + U.num(p.qtd) + ' un.)' : ''),
        marca: a.marca, modelo: a.modelo, serie: p.serie || '',
        fornecedor: a.fornecedor, fornecedor_nome: a.fornecedor_nome, nf: a.nf,
        valor: valor, qtd: p.qtd, aquisicao: a.aquisicao, garantia_ate: a.garantia_ate,
        criticidade: a.criticidade, vida_util_meses: a.vida_util_meses,
        condicao: a.condicao, observacao: a.observacao,
        pai: a.id, compra: compra,
        status: p.status || 'sede', local: p.local || '', projeto: p.projeto || null,
        custodiante: p.custodiante || '',
        contrato: p.contrato || (p.status === 'alocado' ? a.contrato : null) || null,
        /* O valor da locação é dividido POR UNIDADE, e as datas vão
           junto. Sem isso, cada parte herdava o contrato sem valor e o
           resultado caía no valor mensal do contrato INTEIRO: dois
           respiradores apareciam com receita de milhões. */
        /* Só a parte que continua ALOCADA herda a locação: a que vai
           para a sede não está rendendo nada, e herdar o valor
           inventava receita. */
        valor_locacao: p.valor_locacao !== undefined && p.valor_locacao !== null
          ? p.valor_locacao
          : (a.valor_locacao && p.status === 'alocado'
              ? Math.round((a.valor_locacao / total) * p.qtd * 100) / 100 : null),
        locacao_desde: p.locacao_desde || a.locacao_desde || null,
        locacao_ate: p.locacao_ate || a.locacao_ate || null,
        item_locacao: a.item_locacao || null,
        criado_em: new Date(), criado_por: usuario().nome
      };
      st.ativos.push(filho);
      /* Cada parte nasce com o evento de entrada: a história começa
         aqui, e é dela que sai "onde estava em tal data". */
      st.ativoMov.push({
        id: novoId('am'), ativo: filho.id, data: d.data || U.hoje(),
        origem: a.local || 'Compra ' + (a.nf || ''), destino: filho.local || '—',
        status: filho.status, projeto: filho.projeto, custodiante: filho.custodiante,
        autorizado_por: usuario().nome, documento: d.documento || (a.nf ? 'NF ' + a.nf : ''),
        observacao: 'Desmembramento de ' + a.tag, registrado_por: usuario().nome, registrado_em: new Date()
      });
      filhos.push(filho);
    });

    a.desmembrado = true;
    a.desmembrado_em = U.hoje();
    a.desmembrado_por = usuario().nome;
    a.partes = filhos.map(function (x) { return x.id; });
    logar('ativo', a.id, 'desmembrou compra',
      a.tag + ' · ' + U.num(total) + ' unidade(s) em ' + filhos.length + ' registro(s)');
    return { ok: true, partes: filhos };
  }

  /* Vínculo com o contrato de LOCAÇÃO que remunera o equipamento: é o
     que fecha receita × aquisição × manutenção por item. */
  function vincularLocacao(id, d) {
    if (!pode('estoque') && !pode('faturar')) return { erro: 'Seu perfil não vincula locação.' };
    const a = ativo(id);
    if (!a) return { erro: 'Ativo não encontrado.' };
    d = d || {};
    if (!d.contrato) {
      a.contrato = null; a.valor_locacao = null; a.locacao_desde = null; a.item_locacao = null;
      logar('ativo', a.id, 'desvinculou locação', a.tag);
      return { ok: true, ativo: a };
    }
    const ct = st.contratos.find(function (c) { return c.id === d.contrato; });
    if (!ct) return { erro: 'Contrato não encontrado.' };
    if ((ct.parte || 'cliente') !== 'cliente') return { erro: 'Só contrato de cliente remunera equipamento.' };
    if (!(d.valor_locacao > 0)) return { erro: 'Informe quanto este equipamento recebe por mês no contrato.' };
    if (d.ate && d.desde && d.ate < d.desde) {
      return { erro: 'A devolução não pode ser anterior ao início da locação — a receita ficaria zerada sem aviso.' };
    }
    /* Contrato de outro projeto: o sistema aceita, mas pergunta. Há
       caso real (equipamento emprestado entre unidades do mesmo
       cliente), e há o caso de engano puro. */
    const proj = situacaoAtiva(a).projeto;
    const centrosDoContrato = (ct.itens || []).map(function (i) { return i.centro; });
    if (proj && centrosDoContrato.length && centrosDoContrato.indexOf(proj) < 0 && !d.forcar) {
      return { erro: 'O contrato ' + ct.numero + ' não cobre o projeto onde este equipamento está (' +
        ((D.centro(proj) || {}).curto || '') + '). Confirme se é isso mesmo.', outroProjeto: true };
    }
    a.contrato = ct.id;
    a.item_locacao = d.item || '';
    a.valor_locacao = Math.round(d.valor_locacao * 100) / 100;
    a.locacao_desde = d.desde || U.hoje();
    a.locacao_ate = d.ate || null;
    logar('ativo', a.id, 'vinculou à locação',
      a.tag + ' · contrato ' + ct.numero + ' · ' + U.brl(a.valor_locacao) + '/mês');
    return { ok: true, ativo: a };
  }

  /* Resultado da COMPRA inteira: soma das partes. Serve pra responder
     "aquela compra de 10 camas se pagou?" mesmo depois de dividida. */
  function resultadoDaCompra(compraId) {
    const partes = st.ativos.filter(function (a) {
      return !a.desmembrado && (a.compra === compraId || a.id === compraId);
    });
    if (!partes.length) return null;
    const res = partes.map(function (a) { return resultadoDoAtivo(a.id); }).filter(Boolean);
    const soma = function (campo) {
      return Math.round(res.reduce(function (s2, r) { return s2 + r[campo]; }, 0) * 100) / 100;
    };
    return {
      compra: compraId, partes: res,
      receita: soma('receita'), aquisicao: soma('aquisicao'),
      manutencao: soma('manutencao'), resultado: soma('resultado')
    };
  }

  /* ── ordens de serviço ──────────────────────────────────*/
  const proximaOS = () => {
    const maior = st.ordensServico.reduce(function (m, o) {
      const n = parseInt(String(o.numero || '').replace(/\D/g, ''), 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    return 'OS-' + String(maior + 1).padStart(4, '0');
  };

  function abrirOS(d) {
    /* Abrir OS cria obrigação e, no fechamento, custo: é movimentação
       do módulo. Esta função não tinha guarda nenhuma. */
    if (!podeMover('ativos')) return { erro: 'Seu perfil não movimenta o módulo de Ativos.' };
    if (!d.ativo || !ativo(d.ativo)) return { erro: 'Escolha o equipamento.' };
    if (!d.descricao) return { erro: 'Descreva o problema ou o serviço.' };
    const a = ativo(d.ativo);
    /* Duas OS "com parada" no mesmo equipamento gerariam dois eventos
       de entrada em manutenção para um item só. */
    if (situacaoAtiva(a).status === 'baixado') {
      return { erro: 'Este equipamento está baixado (' + ((a.baixa || {}).motivo || '') +
        '). Reative antes de abrir ordem de serviço.' };
    }
    if (d.parada_uso && st.ordensServico.some(function (o) {
      return o.ativo === d.ativo && o.status !== 'fechada' && o.parada_uso;
    })) {
      return { erro: 'Este equipamento já está parado por outra OS aberta. Feche-a antes de abrir outra.' };
    }
    if (d.abertura && d.abertura > U.hoje()) return { erro: 'A abertura não pode ser no futuro.' };
    const os = {
      id: novoId('os'), numero: proximaOS(),
      ativo: d.ativo, tipo: ['preventiva', 'calibracao'].indexOf(d.tipo) > -1 ? d.tipo : 'corretiva',
      abertura: d.abertura || U.hoje(), descricao: d.descricao,
      solicitante: d.solicitante || (usuario() || {}).nome || 'chamado externo',
      origem: d.origem || 'interno', foto: d.foto || null,
      executante: d.executante || '', executante_credor: d.executante_credor || null,
      status: 'aberta', parada_uso: !!d.parada_uso,
      custo_peca: 0, custo_servico: 0, fechada_em: null,
      plano: d.plano || null,
      projeto: situacaoAtiva(a).projeto || null,
      criada_por: usuario() ? usuario().nome : 'externo', criada_em: new Date()
    };
    st.ordensServico.push(os);
    /* Equipamento parado sai de operação: o evento registra isso, senão
       o inventário continua dizendo que ele está no hospital rodando. */
    if (os.parada_uso && pode('estoque')) {
      /* Guarda de onde o equipamento saiu: é para lá que ele volta ao
         fechar a OS. Antes, o retorno sugeria "Manutenção" (o local
         atual) e a situação caía sempre em "sede". */
      const de = situacaoAtiva(a);
      os.voltar_para = { local: de.local, status: de.status, projeto: de.projeto, custodiante: de.custodiante };
      const mv = movimentarAtivo({ ativo: d.ativo, status: 'manutencao',
        destino: d.local_manutencao || 'Manutenção', projeto: situacaoAtiva(a).projeto,
        custodiante: os.executante || 'Manutenção',
        documento: os.numero, observacao: 'Aberta a ' + os.numero });
      if (mv.ok) mv.movimentacao.os_id = os.id;
    }
    logar('ativo', d.ativo, 'abriu ordem de serviço', os.numero + ' · ' + os.tipo + ' · ' + os.descricao.slice(0, 60));
    return { ok: true, os: os };
  }

  /* A OS deixou de ser só "aberta/fechada": no hospital ela para
     esperando peça, esperando o técnico e esperando o aceite de quem
     usa. Sem esses estados, tudo aparecia como "aberta há 40 dias" sem
     dizer de quem é a bola. */
  const ETAPAS_OS = ['aberta', 'em_execucao', 'aguardando_peca', 'aguardando_aceite', 'fechada'];
  const NOME_ETAPA_OS = {
    aberta: 'aberta', em_execucao: 'em execução', aguardando_peca: 'aguardando peça',
    aguardando_aceite: 'aguardando aceite', fechada: 'fechada', cancelada: 'cancelada'
  };

  /* Cancelar OS: a mensagem da baixa mandava "feche ou cancele" e só
     existia fechar — e fechar obriga a lançar custo. OS aberta por
     engano, duplicada ou sem procedência se cancela, com motivo, e o
     equipamento parado volta de onde saiu. */
  function cancelarOS(id, motivo) {
    if (!pode('estoque')) return { erro: 'Seu perfil não cancela ordem de serviço.' };
    const os = st.ordensServico.find(function (o) { return o.id === id; });
    if (!os) return { erro: 'OS não encontrada.' };
    if (os.status === 'fechada') return { erro: 'OS fechada não se cancela — estorne o custo no financeiro.' };
    if (os.status === 'cancelada') return { erro: 'Esta OS já foi cancelada.' };
    if (!motivo) return { erro: 'Informe o motivo do cancelamento.' };
    os.status = 'cancelada';
    os.cancelada_em = U.hoje();
    os.cancelada_por = usuario().nome;
    os.motivo_cancelamento = motivo;
    /* Equipamento que estava parado por esta OS volta ao lugar de
       antes — senão fica "em manutenção" para sempre. */
    if (os.parada_uso && (os.voltar_para || {}).local && pode('estoque')) {
      const v = os.voltar_para;
      const mvCanc = movimentarAtivo({ ativo: os.ativo, status: v.status || 'sede', destino: v.local,
        projeto: v.projeto || null, custodiante: v.custodiante || '',
        documento: os.numero, observacao: 'OS cancelada: ' + motivo });
      if (mvCanc.ok) { mvCanc.movimentacao.os_id = os.id; mvCanc.movimentacao.os_retorno = true; }
    }
    logar('ativo', os.ativo, 'cancelou ordem de serviço', os.numero + ' · ' + motivo);
    return { ok: true, os: os };
  }

  /* Reabrir OS fechada ou cancelada: é o caminho para corrigir um
     retorno errado (o estorno da movimentação está fechado de
     propósito) e para desfazer um cancelamento por engano. O custo já
     lançado não some sozinho — ou não existe, ou é cancelado junto, ou
     a reabertura é recusada quando já houve pagamento. */
  function reabrirOS(id, motivo) {
    if (!pode('estoque')) return { erro: 'Seu perfil não reabre ordem de serviço.' };
    const os = st.ordensServico.find(function (o) { return o.id === id; });
    if (!os) return { erro: 'OS não encontrada.' };
    if (['fechada', 'cancelada'].indexOf(os.status) < 0) return { erro: 'Esta OS já está aberta.' };
    if (!motivo) return { erro: 'Informe o motivo da reabertura.' };

    /* Reabrir é abrir de novo: valem as mesmas travas de abrirOS e de
       movimentarAtivo. Sem isso, a reabertura virava a porta dos fundos
       para estados que o sistema recusa pela porta da frente. */
    const alvoAtivo = ativo(os.ativo);
    if (alvoAtivo && situacaoAtiva(alvoAtivo).status === 'baixado') {
      return { erro: 'Este equipamento está baixado (' + ((alvoAtivo.baixa || {}).motivo || '') +
        '). Reative o equipamento antes de reabrir a ordem de serviço.' };
    }
    if (os.parada_uso && st.ordensServico.some(function (o) {
      return o.id !== os.id && o.ativo === os.ativo && o.parada_uso &&
        ['fechada', 'cancelada'].indexOf(o.status) < 0;
    })) {
      return { erro: 'Já existe outra OS aberta com este equipamento parado. ' +
        'Feche ou cancele aquela antes de reabrir esta.' };
    }
    /* Calibração posterior já concluída: a trava de histórico olhava
       só as movimentações, e calibração normalmente não movimenta
       nada. Sem isto, reabrir a calibração antiga apagava o laudo da
       mais nova — e reabrir as duas deixava o equipamento "calibrado"
       com laudo de OS em execução. Mesma lógica das movimentações de
       OS: o caminho é abrir uma OS nova. */
    if (os.tipo === 'calibracao') {
      /* Duas calibrações fechadas no MESMO dia empatam pela data: o
         desempate é o número da OS, que é sequencial. */
      const seqOS = o => parseInt(String(o.numero || '').replace(/\D/g, ''), 10) || 0;
      const depoisDesta = o => (o.fechada_em || '') > (os.fechada_em || '') ||
        ((o.fechada_em || '') === (os.fechada_em || '') && seqOS(o) > seqOS(os));
      const posterior = st.ordensServico.filter(function (o) {
        return o.id !== os.id && o.ativo === os.ativo && o.tipo === 'calibracao' &&
          o.status === 'fechada' && depoisDesta(o);
      }).sort(function (x, y) { return seqOS(x) - seqOS(y); })[0];
      if (posterior) {
        return { erro: 'Existe calibração mais recente concluída neste equipamento (' + posterior.numero +
          ', laudo ' + (posterior.laudo_numero || 'sem número') + ' de ' + U.fData(posterior.fechada_em) +
          '). Reabrir esta apagaria o laudo que está valendo — abra uma OS nova de calibração.' };
      }
    }
    /* Movimentação posterior ao retorno: estornar o retorno deixaria o
       histórico contando uma saída de um lugar onde o equipamento nunca
       esteve. */
    const retornosDaOS = st.ativoMov.filter(function (m) {
      return m.os_id === os.id && m.os_retorno && !m.estornado; });
    if (retornosDaOS.length) {
      const ultimoRetorno = retornosDaOS.sort(ordemEventos).slice(-1)[0];
      const posteriores = st.ativoMov.filter(function (m) {
        return m.ativo === os.ativo && !m.estornado && m.id !== ultimoRetorno.id &&
          ordemEventos(ultimoRetorno, m) < 0;
      });
      if (posteriores.length) {
        const p0 = posteriores[0];
        /* Se o que veio depois foi outra OS, não há o que estornar — a
           movimentação de OS é fechada para estorno de propósito. Aí o
           caminho não é reabrir esta, é abrir uma nova. */
        const deOutraOS = posteriores.find(function (m) { return m.os_id && m.os_id !== os.id; });
        if (deOutraOS) {
          const outra = st.ordensServico.find(function (o) { return o.id === deOutraOS.os_id; });
          return { erro: 'Depois do retorno desta OS, o equipamento passou por ' +
            (outra ? outra.numero : 'outra ordem de serviço') +
            '. Reabrir agora reescreveria o histórico daquela OS também — abra uma OS nova para o ' +
            'serviço que faltou.' };
        }
        return { erro: 'O equipamento se movimentou depois do retorno desta OS (' +
          U.fData(p0.data) + ' · ' + p0.origem + ' → ' + p0.destino + '). ' +
          'Estorne essa movimentação antes de reabrir, senão o histórico passa a registrar uma saída ' +
          'de um lugar onde ele não estava.' };
      }
    }

    /* Custo lançado no financeiro: cancela junto se ninguém pagou. */
    if (os.titulo_id) {
      const parcelas = st.parcelas.filter(function (p) { return p.titulo_id === os.titulo_id; });
      const pago = parcelas.some(function (p) { return pagoDe(p) > 0.004; });
      if (pago) {
        return { erro: 'O custo desta OS já foi pago. Estorne o pagamento e cancele o título antes de reabrir.' };
      }
      /* Cancela parcela a parcela: é a mesma função que o financeiro
         usa, então passa pelas mesmas regras. */
      let erroCancel = null;
      parcelas.forEach(function (p) {
        if (erroCancel || p.status === 'cancelado') return;
        const c = cancelar(p.id, 'OS reaberta: ' + motivo, true);
        if (c && c.erro) erroCancel = c.erro;
      });
      if (erroCancel) return { erro: 'Não foi possível cancelar o custo lançado: ' + erroCancel };
      os.titulo_cancelado = os.titulo_id;
      os.titulo_id = null;
    }

    /* O retorno que a OS gerou é desfeito por aqui — é o único lugar
       que pode fazer isso — e o equipamento volta para a manutenção. */
    const retornos = st.ativoMov.filter(function (m) {
      return m.os_id === os.id && m.os_retorno && !m.estornado; });
    retornos.forEach(function (m) {
      m.estornado = true;
      m.estorno = { motivo: 'OS reaberta: ' + motivo, em: U.hoje(), por: usuario().nome };
    });
    /* Cancelamento que devolveu o equipamento também é desfeito, e a
       parada volta a valer. */
    /* Calibração reaberta devolve o laudo anterior: enquanto a OS não
       fecha de novo, não há calibração concluída. */
    if (os.tipo === 'calibracao' && alvoAtivo) {
      /* Só mexe no laudo do equipamento se o que está lá é o desta OS:
         se for de outra, não é esta reabertura que deve derrubá-lo. */
      const vigenteEhDesta = (alvoAtivo.calibracao_laudo || null) === (os.laudo_numero || null) &&
        (alvoAtivo.calibracao_ate || null) === (os.laudo_valido_ate || null);
      if (vigenteEhDesta) {
        const ant = os.laudo_anterior || { ate: null, numero: null };
        /* E o laudo restaurado tem que vir de uma calibração
           CONCLUÍDA — laudo de OS em execução não vale. */
        const origem = ant.numero ? st.ordensServico.find(function (o) {
          return o.ativo === os.ativo && o.tipo === 'calibracao' && o.laudo_numero === ant.numero;
        }) : null;
        const valido = !ant.numero || (origem && origem.status === 'fechada');
        alvoAtivo.calibracao_ate = valido ? ant.ate : null;
        alvoAtivo.calibracao_laudo = valido ? ant.numero : null;
      }
      os.laudo_valido_ate = null;
      os.laudo_numero = '';
    }
    const eraCancelada = os.status === 'cancelada';
    os.status = 'em_execucao';
    os.fechada_em = null;
    os.custo_peca = 0;
    os.custo_servico = 0;
    os.cancelada_em = null;
    (os.historico = os.historico || []).push({
      etapa: 'reaberta', em: U.hoje(), por: usuario().nome,
      observacao: motivo + (eraCancelada ? ' (estava cancelada)' : ' (estava fechada)')
    });
    logar('ativo', os.ativo, 'reabriu ordem de serviço',
      os.numero + ' · ' + motivo + (retornos.length ? ' · retorno desfeito' : ''));
    return { ok: true, os: os, retornos_desfeitos: retornos.length };
  }

  function moverOS(id, etapa, obs) {
    if (!pode('estoque')) return { erro: 'Seu perfil não move ordem de serviço.' };
    const os = st.ordensServico.find(function (o) { return o.id === id; });
    if (!os) return { erro: 'OS não encontrada.' };
    if (ETAPAS_OS.indexOf(etapa) < 0 || etapa === 'fechada') {
      return { erro: 'Para encerrar, use "Fechar OS" — é lá que entram custo e laudo.' };
    }
    if (os.status === 'fechada') return { erro: 'Esta OS já foi fechada.' };
    if (os.status === 'cancelada') return { erro: 'Esta OS foi cancelada.' };
    os.status = etapa;
    (os.historico = os.historico || []).push({ etapa: etapa, em: U.hoje(), por: usuario().nome, observacao: obs || '' });
    logar('ativo', os.ativo, 'moveu ordem de serviço', os.numero + ' → ' + NOME_ETAPA_OS[etapa]);
    return { ok: true, os: os };
  }

  /* Indicadores de manutenção com as datas que a OS já grava:
     MTTR = tempo médio de reparo; MTBF = tempo médio entre falhas. */
  function indicadoresManutencao(f) {
    f = f || {};
    const oss = st.ordensServico.filter(function (o) {
      /* OS cancelada não é serviço: contava como aberta e entrava na
         média de corretivas. */
      return o.status !== 'cancelada' &&
        (!f.ativo || o.ativo === f.ativo) &&
        (!f.de || (o.abertura || '') >= f.de) && (!f.ate || (o.abertura || '') <= f.ate);
    });
    const corretivas = oss.filter(function (o) { return o.tipo === 'corretiva'; });
    const fechadas = oss.filter(function (o) { return o.status === 'fechada' && o.fechada_em; });
    /* MTTR é tempo de REPARO: preventiva e calibração são programadas e
       inflavam a média. */
    const reparo = fechadas.filter(function (o) { return o.tipo === 'corretiva'; })
      .map(function (o) { return U.diasEntre(o.abertura, o.fechada_em); });
    const media = arr => arr.length
      ? Math.round(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length * 10) / 10 : null;

    const porAtivo = {};
    corretivas.forEach(function (o) { (porAtivo[o.ativo] = porAtivo[o.ativo] || []).push(o.abertura); });
    const intervalos = [];
    Object.keys(porAtivo).forEach(function (k) {
      const datas = porAtivo[k].slice().sort();
      for (let i = 1; i < datas.length; i++) intervalos.push(U.diasEntre(datas[i - 1], datas[i]));
    });

    const prazo = f.sla_dias || (D.parametrosManutencao || {}).sla_dias || 5;
    const noPrazo = fechadas.filter(function (o) { return U.diasEntre(o.abertura, o.fechada_em) <= prazo; });
    return {
      total: oss.length, corretivas: corretivas.length,
      preventivas: oss.filter(function (o) { return o.tipo === 'preventiva'; }).length,
      calibracoes: oss.filter(function (o) { return o.tipo === 'calibracao'; }).length,
      abertas: oss.filter(function (o) { return o.status !== 'fechada'; }).length,
      fechadas: fechadas.length,
      mttr_dias: media(reparo), mtbf_dias: media(intervalos),
      sla_dias: prazo,
      sla_pct: fechadas.length ? Math.round(noPrazo.length / fechadas.length * 1000) / 10 : null,
      dias_parado: oss.filter(function (o) { return o.parada_uso; })
        .reduce(function (a, o) { return a + U.diasEntre(o.abertura, o.fechada_em || U.hoje()); }, 0),
      custo: Math.round(oss.reduce(function (a, o) {
        return a + (o.custo_peca || 0) + (o.custo_servico || 0); }, 0) * 100) / 100
    };
  }

  /* Laudo de calibração vencido ou prestes a vencer. */
  function calibracoesVencendo(dias) {
    const limite = U.addDias(U.hoje(), dias === undefined ? 30 : dias);
    return st.ativos.filter(function (a) {
      return !a.desmembrado && a.calibracao_ate && a.calibracao_ate <= limite &&
        situacaoAtiva(a).status !== 'baixado';
    }).map(function (a) {
      return { ativo: a, valido_ate: a.calibracao_ate, vencido: a.calibracao_ate < U.hoje(),
        dias: U.diasEntre(U.hoje(), a.calibracao_ate) };
    }).sort(function (x, y) { return String(x.valido_ate).localeCompare(String(y.valido_ate)); });
  }

  function ordensServico(f) {
    f = f || {};
    return st.ordensServico.filter(function (o) {
      return (!f.ativo || o.ativo === f.ativo) && (!f.status || o.status === f.status) &&
        (!f.tipo || o.tipo === f.tipo) && (f.incluir_canceladas || o.status !== 'cancelada');
    }).sort(function (a, b) {
      if ((a.status === 'fechada') !== (b.status === 'fechada')) return a.status === 'fechada' ? 1 : -1;
      return (a.abertura || '').localeCompare(b.abertura || '');
    });
  }

  /* Fechar a OS lança o custo no contas a pagar COM O CENTRO DO PROJETO
     onde o ativo está: é isso que faz a manutenção cair na margem do
     contrato certo, em vez de virar despesa genérica da sede. */
  function fecharOS(id, d) {
    if (!podeMover('ativos')) return { erro: 'Seu perfil não fecha ordem de serviço.' };
    const os = st.ordensServico.find(function (o) { return o.id === id; });
    if (!os) return { erro: 'OS não encontrada.' };
    if (os.status === 'fechada') return { erro: 'Esta OS já foi fechada.' };
    if (os.status === 'cancelada') return { erro: 'Esta OS foi cancelada. Se foi engano, use "Reabrir OS".' };
    d = d || {};
    /* Custo da OS é dinheiro: quem não tem o nível financeiro do
       módulo fecha a OS, mas não carimba valor nela. */
    /* `(custo || 0) < 0` pega o sinal e não a finitude: Infinity
       fechava a OS e o indicador de custo de manutenção virava null. */
    const custosOS = [d.custo, d.custo_peca, d.custo_servico];
    for (let i = 0; i < custosOS.length; i++) {
      const v = custosOS[i];
      if (v === undefined || v === null || v === '') continue;
      if (!isFinite(Number(v))) return { erro: 'Custo da OS inválido (' + v + ').' };
    }
    if (d.custo && !veFinanceiro('ativos')) {
      return { erro: 'Seu perfil fecha a OS, mas não informa custo — peça a quem tem acesso ' +
        'financeiro em Ativos.' };
    }
    if (d.data && d.data > U.hoje()) return { erro: 'O fechamento não pode ser no futuro.' };
    if ((d.custo_peca || 0) + (d.custo_servico || 0) > 0 && !d.executante_credor && !os.executante_credor &&
        !d.custo_interno) {
      return { erro: 'Há custo lançado mas nenhum fornecedor: sem isso o valor entra nos indicadores e ' +
        'não vira conta a pagar. Escolha o fornecedor ou marque como custo interno (mão de obra própria).',
        semCredor: true };
    }
    if (d.laudo_valido_ate && d.laudo_valido_ate < (d.data || U.hoje())) {
      return { erro: 'A validade do laudo (' + U.fData(d.laudo_valido_ate) +
        ') é anterior ao fechamento: o equipamento nasceria com a calibração vencida. ' +
        'Confira a data do laudo.' };
    }
    if (d.data && d.data < os.abertura) {
      return { erro: 'O fechamento (' + U.fData(d.data) + ') não pode ser anterior à abertura (' +
        U.fData(os.abertura) + ').' };
    }
    if ((d.custo_peca || 0) < 0 || (d.custo_servico || 0) < 0) {
      return { erro: 'Custo negativo não existe. Se houve desconto ou devolução, lance como crédito no financeiro.' };
    }
    os.custo_peca = Math.round((d.custo_peca || 0) * 100) / 100;
    os.custo_servico = Math.round((d.custo_servico || 0) * 100) / 100;
    os.laudo = d.laudo || '';
    os.executante = d.executante || os.executante;
    os.executante_credor = d.executante_credor || os.executante_credor;
    os.status = 'fechada';
    os.fechada_em = d.data || U.hoje();
    /* Calibração fechada renova o laudo do equipamento: é essa data que
       o alerta passa a vigiar. */
    if (os.tipo === 'calibracao') {
      const plano = st.planosManutencao.find(function (p) { return p.id === os.plano; });
      const meses = d.validade_laudo_meses || (plano || {}).validade_laudo_meses || 12;
      os.laudo_numero = d.laudo_numero || '';
      os.laudo_valido_ate = d.laudo_valido_ate || U.addMeses(os.fechada_em, meses).slice(0, 10);
      const alvo = ativo(os.ativo);
      if (alvo) {
        /* Guarda o laudo que valia antes: reabrir a calibração tem que
           devolver o equipamento ao estado anterior, senão ele fica
           "calibrado" sem calibração concluída. */
        os.laudo_anterior = { ate: alvo.calibracao_ate || null, numero: alvo.calibracao_laudo || null };
        alvo.calibracao_ate = os.laudo_valido_ate;
        alvo.calibracao_laudo = os.laudo_numero;
      }
    }
    os.fechada_por = usuario().nome;

    const total = Math.round((os.custo_peca + os.custo_servico) * 100) / 100;
    let titulo = null;
    if (total > 0 && os.executante_credor && pode('lancar')) {
      const a = ativo(os.ativo) || {};
      const centro = os.projeto || situacaoAtiva(a).projeto || 'cc100';
      /* 6.07 é "Manutenção e conservação"; a 8.05 usada antes é "Frete
         e logística" — o custo da OS aparecia na natureza errada no
         DRE. Equipamento que está num contrato de locação vira custo do
         contrato (3.02). */
      const contaPadrao = a.contrato ? '3.02' : '6.07';
      const r = criarTitulo({
        descricao: 'Manutenção ' + (a.tag || '') + ' — ' + (a.descricao || '').slice(0, 40),
        documento: d.documento || os.numero, tipo_titulo: d.documento ? 'nf' : 'recibo',
        sem_nf: !d.documento, credor: os.executante_credor, conta: d.conta || contaPadrao,
        centro: centro, emissao: os.fechada_em, origem: 'manutencao', origem_ref: os.id,
        obs: 'Custo da ' + os.numero + ' · peça ' + U.brl(os.custo_peca) + ' + serviço ' + U.brl(os.custo_servico)
      }, [{ num: 1, venc: d.vencimento || os.fechada_em, comp: U.compDe(os.fechada_em), valor: total }]);
      if (r.ok) { os.titulo_id = r.titulo.id; titulo = r.titulo; }
      else os.erro_financeiro = r.erro;
    }
    /* Equipamento que estava parado volta de onde veio. */
    if (os.parada_uso && (d.devolver_para || (os.voltar_para || {}).local) && pode('estoque')) {
      const volta = os.voltar_para || {};
      const mvVolta = movimentarAtivo({ ativo: os.ativo,
        status: d.status_volta || volta.status || 'sede',
        destino: d.devolver_para || volta.local,
        projeto: d.projeto !== undefined ? d.projeto : (volta.projeto || os.projeto),
        custodiante: d.custodiante || volta.custodiante || '',
        documento: os.numero, observacao: 'Retorno da manutenção (' + os.numero + ')' });
      if (mvVolta.ok) { mvVolta.movimentacao.os_id = os.id; mvVolta.movimentacao.os_retorno = true; }
    }
    logar('ativo', os.ativo, 'fechou ordem de serviço',
      os.numero + ' · ' + U.brl(total) + (titulo ? ' · lançado no contas a pagar' : ''));
    return { ok: true, os: os, titulo: titulo };
  }

  /* ── manutenção preventiva ──────────────────────────────*/
  function salvarPlanoManutencao(d) {
    if (!podeMover('ativos')) return { erro: 'Seu perfil não define plano de manutenção.' };
    if (!d.ativo && !d.categoria) return { erro: 'Escolha o equipamento ou a categoria.' };
    if (!(d.periodicidade_dias >= 1) || d.periodicidade_dias % 1 !== 0) {
      return { erro: 'A periodicidade é em dias inteiros, a partir de 1.' };
    }
    const p = d.id ? st.planosManutencao.find(function (x) { return x.id === d.id; })
      : { id: novoId('pl'), criado_em: new Date() };
    if (!p) return { erro: 'Plano não encontrado.' };
    p.ativo = d.ativo || null;
    p.categoria = d.categoria || null;
    /* Calibração é preventiva com laudo: tem validade, e vencida o
       equipamento não deveria estar medindo nada. */
    p.tipo = d.tipo === 'calibracao' ? 'calibracao' : 'preventiva';
    p.validade_laudo_meses = d.validade_laudo_meses || null;
    p.periodicidade_dias = d.periodicidade_dias;
    p.checklist = d.checklist || '';
    p.proxima = d.proxima || U.addDias(U.hoje(), d.periodicidade_dias);
    p.responsavel = d.responsavel || '';
    if (!d.id) st.planosManutencao.push(p);
    logar('ativo', p.ativo || p.categoria, 'definiu plano de manutenção',
      'a cada ' + p.periodicidade_dias + ' dias · próxima ' + U.fData(p.proxima));
    return { ok: true, plano: p };
  }

  /* "Job diário": roda na abertura do sistema e abre a preventiva que
     venceu. Sem servidor, é o que dá — e é o suficiente pra ninguém
     depender de lembrar. */
  function gerarPreventivas() {
    /* Gerar OS é ato de quem cuida do equipamento: qualquer perfil que
       abrisse o módulo estava criando ordem de serviço. */
    if (!pode('estoque')) return [];
    const hoje = U.hoje();
    const abertas = [];
    st.planosManutencao.forEach(function (p) {
      if (!p.proxima || p.proxima > hoje) return;
      const alvos = (p.ativo ? [ativo(p.ativo)].filter(Boolean)
        : st.ativos.filter(function (a) { return a.categoria === p.categoria; }))
        /* Registro desmembrado não existe mais como equipamento (virou
           as partes) e item baixado não recebe preventiva. */
        .filter(function (a) { return a && !a.desmembrado && situacaoAtiva(a).status !== 'baixado'; });
      alvos.forEach(function (a) {
        const jaTem = st.ordensServico.some(function (o) {
          return o.ativo === a.id && o.plano === p.id && o.status !== 'fechada';
        });
        if (jaTem) return;
        const r = abrirOS({ ativo: a.id, plano: p.id,
          tipo: p.tipo === 'calibracao' ? 'calibracao' : 'preventiva',
          descricao: (p.tipo === 'calibracao' ? 'Calibração programada' : 'Preventiva programada') +
            (p.checklist ? ' · ' + p.checklist : ''),
          solicitante: 'plano de manutenção', origem: 'plano' });
        if (r.ok) abertas.push(r.os);
      });
      p.proxima = U.addDias(hoje, p.periodicidade_dias);
      p.ultima_geracao = hoje;
    });
    return abertas;
  }

  /* ── depreciação ────────────────────────────────────────
     Equipamento alocado num projeto custa àquele projeto mesmo sem
     nota no mês: o capital está imobilizado ali. Sem isso, projeto de
     locação e projeto remunerado por laudo (ultrassom) parecem ter
     margem que não têm. Padrão de 60 meses, ajustável por equipamento
     no cadastro — há bem com vida mais curta e mais longa. */
  const VIDA_UTIL_PADRAO = 60;

  function depreciacaoMensal(a) {
    if (!a || !a.valor) return 0;
    const meses = a.vida_util_meses > 0 ? a.vida_util_meses : VIDA_UTIL_PADRAO;
    return Math.round(((a.valor || 0) / meses) * 100) / 100;
  }

  /* Quanto ainda falta depreciar (o bem para de custar quando termina a
     vida útil — depois disso ele é lucro puro pro projeto). */
  function depreciacaoDoAtivo(a, ate) {
    const mensal = depreciacaoMensal(a);
    /* Sem valor, não há depreciação — mas o objeto precisa ter os
       mesmos campos, senão quem consome faz conta com undefined (o
       resultado do equipamento saía NaN). */
    if (!mensal) {
      return { mensal: 0, vida: (a && a.vida_util_meses > 0) ? a.vida_util_meses : VIDA_UTIL_PADRAO,
        meses_corridos: 0, meses_depreciados: 0, acumulada: 0,
        residual: a ? (a.valor || 0) : 0, encerrada: true };
    }
    const vida = a.vida_util_meses > 0 ? a.vida_util_meses : VIDA_UTIL_PADRAO;
    const inicio = a.aquisicao || a.criado_em && U.dataLocal(a.criado_em) || null;
    const fim = ate || U.hoje();
    /* Meses de CALENDÁRIO: dias ÷ 30 dava 59 meses onde o calendário
       tem 58, e a diferença ia direto para o valor depreciado. */
    const corridos = inicio ? Math.max(0, U.mesesEntre(inicio, fim)) : 0;
    const meses = Math.min(corridos, vida);
    /* A acumulada NUNCA passa do valor do bem: mensal × meses, com o
       arredondamento da parcela mensal, estourava uns centavos no fim
       da vida útil (R$ 1.000 em 60 meses davam R$ 1.000,20 acumulados
       e residual de −R$ 0,20 — que virava ganho a maior na venda). */
    const acumulada = Math.min(
      Math.round(mensal * meses * 100) / 100,
      Math.round((a.valor || 0) * 100) / 100);
    return { mensal: mensal, vida: vida, meses_corridos: corridos, meses_depreciados: meses,
      acumulada: acumulada, residual: Math.round(((a.valor || 0) - acumulada) * 100) / 100,
      encerrada: corridos >= vida };
  }

  /* Depreciação que cai em cada PROJETO numa competência: usa onde o
     equipamento estava no último dia do mês, não onde ele está hoje —
     um respirador que saiu em março não deprecia no projeto em agosto. */
  function depreciacaoPorProjeto(competencia) {
    const ref = U.addDias(U.compDe(U.addMeses(competencia + '-01', 1)) + '-01', -1);
    const por = {};
    st.ativos.forEach(function (a) {
      if (a.desmembrado) return;
      const mensal = depreciacaoMensal(a);
      if (!mensal) return;
      const dep = depreciacaoDoAtivo(a, ref);
      if (dep.encerrada && dep.meses_depreciados >= dep.vida) {
        /* já totalmente depreciado antes desta competência? então não
           lança nada neste mês */
        const anterior = depreciacaoDoAtivo(a, U.addDias(competencia + '-01', -1));
        if (anterior.meses_depreciados >= dep.vida) return;
      }
      if (a.aquisicao && a.aquisicao > ref) return;   // ainda não era nosso
      const onde = ondeEstavaEm(a.id, ref);
      if (!onde.projeto) return;                      // parado não onera projeto
      const l = por[onde.projeto] = por[onde.projeto] || { centro: onde.projeto, valor: 0, itens: [] };
      l.valor = Math.round((l.valor + mensal) * 100) / 100;
      l.itens.push({ ativo: a, mensal: mensal });
    });
    return Object.keys(por).map(function (k) { return por[k]; });
  }

  /* ── leitura gerencial ──────────────────────────────────*/
  /* Ociosidade: o que está parado, há quanto tempo e quanto de capital
     está imobilizado nisso. */
  function ociosidadeAtivos() {
    const hoje = U.hoje();
    return ativos({}).filter(function (a) {
      return ['sede', 'terceiro', 'aguardando', 'devolucao'].indexOf(a.status) > -1;
    }).map(function (a) {
      const desde = a.desde || a.aquisicao || null;
      return Object.assign({}, a, { dias_parado: desde ? U.diasEntre(desde, hoje) : null });
    }).sort(function (x, y) { return (y.dias_parado || 0) - (x.dias_parado || 0) || y.valor - x.valor; });
  }

  /* Resultado por equipamento: receita do contrato de locação que o
     remunera, menos aquisição e manutenção. É o número que decide
     comprar, alugar ou sucatear — e que precifica a próxima proposta. */
  function resultadoDoAtivo(id) {
    const a = ativo(id);
    if (!a) return null;
    const oss = st.ordensServico.filter(function (o) { return o.ativo === id; });
    const manutencao = Math.round(oss.reduce(function (s2, o) {
      return s2 + (o.custo_peca || 0) + (o.custo_servico || 0); }, 0) * 100) / 100;
    const ct = a.contrato ? st.contratos.find(function (c) { return c.id === a.contrato; }) : null;
    let receita = 0, meses = 0, mensal = 0, receitaReal = 0, receitaEstimada = 0, mesesFaturados = 0;
    const composicao = [];
    if (ct) {
      /* Só o valor cadastrado NO EQUIPAMENTO vale como estimativa dele.
         O valor do item do contrato remunera o contrato inteiro (todos
         os equipamentos daquele item), e usá-lo aqui multiplicava a
         receita por equipamento. */
      mensal = a.valor_locacao || 0;
      const ini = a.locacao_desde || ct.vigencia_ini;
      /* A receita conta até a devolução (ou o fim do contrato), não até
         hoje: equipamento devolvido em março não fatura em setembro. */
      const fim = [a.locacao_ate, ct.vigencia_fim, U.hoje()].filter(Boolean).sort()[0];

      /* Quanto este equipamento representa dentro do contrato: é a
         proporção usada para trazer o faturado REAL do mês para ele. Um
         contrato costuma cobrir vários equipamentos, e a nota vem
         somada. */
      const irmaos = st.ativos.filter(function (x) {
        return !x.desmembrado && x.contrato === ct.id && (x.valor_locacao || 0) > 0;
      });
      /* A proporção é apurada POR MÊS, entre os equipamentos que
         estavam locados naquele mês. Calculada uma vez só, a parte de
         um equipamento já devolvido se perdia e a soma das partes não
         fechava com a nota. */
      const fatiaNoMes = function (comp) {
        const ini2 = comp + '-01';
        const fim2 = U.addDias(U.compDe(U.addMeses(ini2, 1)) + '-01', -1);
        const vigentes = irmaos.filter(function (x) {
          const d = x.locacao_desde || (ct.vigencia_ini || ini2);
          return d <= fim2 && (!x.locacao_ate || x.locacao_ate >= ini2);
        });
        const soma = vigentes.reduce(function (t, x) { return t + (x.valor_locacao || 0); }, 0);
        if (!vigentes.some(function (x) { return x.id === a.id; })) return 0;
        return soma > 0 ? mensal / soma : 1 / vigentes.length;
      };

      if (ini && fim >= ini) {
        /* Mês a mês: onde já houve nota, o FATURADO substitui a
           estimativa daquele mês; onde ainda não houve, a estimativa
           continua valendo. É o que faz o número parar de ser promessa
           conforme o contrato roda. */
        let comp = U.compDe(ini);
        const compFim = U.compDe(fim);
        let guarda = 0;
        while (comp <= compFim && guarda++ < 600) {
          const notas = st.receber.filter(function (r) {
            return r.competencia === comp && ['nota', 'fatura'].indexOf(r.origem) > -1 &&
              ['cancelado', 'substituido'].indexOf(r.status) < 0 &&
              (r.contrato === ct.id ||
                (ct.itens || []).some(function (i) { return i.centro === r.centro; }));
          });
          const faturadoMes = notas.reduce(function (t, r) { return t + (r.valor_bruto || 0); }, 0);
          if (faturadoMes > 0) {
            const parte = Math.round(faturadoMes * fatiaNoMes(comp) * 100) / 100;
            receitaReal = Math.round((receitaReal + parte) * 100) / 100;
            mesesFaturados++;
            composicao.push({ competencia: comp, valor: parte, origem: 'faturado' });
          } else {
            receitaEstimada = Math.round((receitaEstimada + mensal) * 100) / 100;
            composicao.push({ competencia: comp, valor: mensal, origem: 'estimado' });
          }
          meses++;
          comp = U.compDe(U.addMeses(comp + '-01', 1));
        }
        receita = Math.round((receitaReal + receitaEstimada) * 100) / 100;
      }
    }
    const dep = depreciacaoDoAtivo(a);
    /* A margem da locação compara períodos iguais: a receita conta os
       meses locados, então a depreciação conta os mesmos meses. Antes,
       9 meses de receita eram confrontados com 50 meses de
       depreciação, e o resultado não significava nada. */
    const depDoPeriodo = Math.round(dep.mensal * Math.min(meses, dep.vida) * 100) / 100;
    return {
      ativo: a, receita: receita, meses: meses, mensal: mensal, contrato: ct,
      depreciacao_periodo: depDoPeriodo,
      /* A receita é mista de propósito: real onde já houve nota,
         estimada nos meses que ainda não faturaram. */
      receita_real: receitaReal, receita_estimada: receitaEstimada,
      meses_faturados: mesesFaturados, meses_estimados: meses - mesesFaturados,
      composicao: composicao,
      participacao_no_contrato: ct && composicao.length
        ? Math.round((mensal || 0) * 100) / 100 : 0,
      depreciacao: dep,
      aquisicao: a.valor || 0, manutencao: manutencao,
      /* O resultado desconta a depreciação acumulada, não o valor de
         compra inteiro: é assim que o equipamento se paga ao longo da
         vida útil. O valor de aquisição fica à parte, para quem quiser
         o retorno de caixa. */
      resultado: Math.round((receita - depDoPeriodo - manutencao) * 100) / 100,
      resultado_vida: Math.round((receita - dep.acumulada - manutencao) * 100) / 100,
      resultado_caixa: Math.round((receita - (a.valor || 0) - manutencao) * 100) / 100,
      /* Quantos meses de locação faltam pra compra se pagar — é a
         pergunta que decide comprar ou alugar. */
      meses_para_pagar: mensal > 0
        ? Math.max(0, Math.ceil(((a.valor || 0) + manutencao - receita) / mensal)) : null,
      os: oss.length
    };
  }

  /* ── atestado de capacidade técnica ─────────────────────
     Atestado vence na prática: edital costuma pedir prova de execução
     recente, e pedir ao hospital é sempre demorado. O sistema avisa a
     cada 6 meses (por cliente) e monta o histórico do período — o que
     foi prestado, quanto foi faturado e em que competências —, que é
     justamente o que o cliente pede pra emitir o documento. */
  const MESES_ATESTADO = 6;

  function proximoAtestado(cli) {
    const meses = cli.atestado_periodicidade || MESES_ATESTADO;
    /* Só o atestado RECEBIDO reinicia a contagem. Pedido feito não
       resolve nada em licitação — o alerta continua, agora dizendo que
       já foi pedido, pra ninguém pedir duas vezes nem esquecer de
       cobrar. */
    const base = cli.atestado_em || null;
    if (!base) return null;   // nunca teve: vence assim que houver prestação
    return U.compDe(U.addMeses(base, meses)) + '-' + base.slice(8, 10);
  }

  /* Primeira e última competência com prestação (faturamento ou
     produtividade) nos projetos do cliente. */
  function prestacaoDoCliente(clienteId) {
    const projetos = D.projetosDoCliente(clienteId).map(function (c) { return c.id; });
    if (!projetos.length) return { projetos: [], comps: [] };
    const comps = {};
    st.receber.forEach(function (r) {
      if (projetos.indexOf(r.centro) < 0) return;
      if (['nota', 'fatura'].indexOf(r.origem) < 0) return;
      if (['cancelado', 'substituido'].indexOf(r.status) > -1) return;
      comps[r.competencia] = true;
    });
    st.lotesProdutividade.forEach(function (l) {
      if (l.cancelado || projetos.indexOf(l.centro) < 0) return;
      comps[l.competencia] = true;
    });
    /* Medição de produtividade lançada também comprova prestação, mesmo
       antes de faturar: é o plantão que o médico já deu naquele mês. */
    st.parcelas.forEach(function (p) {
      if (p.status === 'cancelado' || p.origem !== 'produtividade') return;
      const rat = (p.rateio && p.rateio.length) ? p.rateio : [{ centro: p.centro }];
      if (!rat.some(function (r) { return projetos.indexOf(r.centro) > -1; })) return;
      comps[p.comp] = true;
    });
    return { projetos: projetos, comps: Object.keys(comps).sort() };
  }

  function atestadosPendentes() {
    const hoje = U.hoje();
    const lista = [];
    D.clientes.forEach(function (cli) {
      if (cli.atestado_dispensado) return;
      const pres = prestacaoDoCliente(cli.id);
      if (!pres.comps.length) return;          // sem prestação, não há o que atestar
      const proximo = proximoAtestado(cli);
      const meses = cli.atestado_periodicidade || MESES_ATESTADO;
      if (proximo && proximo > hoje) return;   // ainda no prazo
      lista.push({
        cliente: cli,
        desde: cli.atestado_em || null,
        solicitado_em: cli.atestado_solicitado_em || null,
        vencido_em: proximo,
        dias: proximo ? U.diasEntre(proximo, hoje) : null,
        nunca: !cli.atestado_em,
        periodicidade: meses,
        competencias: pres.comps.length,
        ultima_competencia: pres.comps[pres.comps.length - 1]
      });
    });
    return lista.sort(function (a2, b2) {
      if (a2.nunca !== b2.nunca) return a2.nunca ? -1 : 1;
      return (b2.dias || 0) - (a2.dias || 0);
    });
  }

  /* O histórico que vai junto do pedido: por projeto, o que foi
     prestado e faturado no período, com as competências cobertas. É o
     conteúdo que o hospital precisa pra escrever o atestado. */
  function historicoAtestado(clienteId, de, ate) {
    const cli = D.clientes.find(function (x) { return x.id === clienteId; });
    if (!cli) return { erro: 'Cliente não encontrado.' };
    const projetos = D.projetosDoCliente(clienteId);
    if (!projetos.length) return { erro: 'Este cliente não tem projeto ligado.' };
    const dentro = comp => (!de || comp >= U.compDe(de)) && (!ate || comp <= U.compDe(ate));

    const linhas = projetos.map(function (pj) {
      const notas = st.receber.filter(function (r) {
        return r.centro === pj.id && ['nota', 'fatura'].indexOf(r.origem) > -1 &&
          ['cancelado', 'substituido'].indexOf(r.status) < 0 && dentro(r.competencia);
      });
      const lotes = st.lotesProdutividade.filter(function (l) {
        return !l.cancelado && l.centro === pj.id && dentro(l.competencia);
      });
      /* Medições do projeto (o plantão prestado), inclusive as que ainda
         não viraram lote fechado nem nota. */
      const medicoes = st.parcelas.filter(function (p) {
        if (p.status === 'cancelado' || p.origem !== 'produtividade' || !dentro(p.comp)) return false;
        const rat = (p.rateio && p.rateio.length) ? p.rateio : [{ centro: p.centro }];
        return rat.some(function (r) { return r.centro === pj.id; });
      });
      const comps = {};
      notas.forEach(function (r) { comps[r.competencia] = true; });
      lotes.forEach(function (l) { comps[l.competencia] = true; });
      medicoes.forEach(function (p) { comps[p.comp] = true; });
      const chaves = Object.keys(comps).sort();
      /* Médicos DISTINTOS que prestaram no período — o número que o
         hospital costuma pedir ("equipe de X profissionais"). */
      const medicos = {};
      lotes.forEach(function (l) {
        (l.titulo_ids || []).forEach(function (tid) {
          const t = st.titulos.find(function (x) { return x.id === tid; });
          if (t && t.credor) medicos[t.credor] = true;
        });
      });
      medicoes.forEach(function (p) { if (p.credor) medicos[p.credor] = true; });
      return {
        projeto: pj,
        contrato: contratoDoProjeto(pj.id),
        competencias: chaves,
        de: chaves[0] || '', ate: chaves[chaves.length - 1] || '',
        meses: chaves.length,
        notas: notas.length,
        faturado: Math.round(notas.reduce(function (a2, r) { return a2 + r.valor_bruto; }, 0) * 100) / 100,
        producao: Math.round((lotes.length
          ? lotes.reduce(function (a2, l) { return a2 + l.valor; }, 0)
          : medicoes.reduce(function (a2, p) { return a2 + p.valor; }, 0)) * 100) / 100,
        medicoes: medicoes.length,
        medicos: Object.keys(medicos).length,
        servico: pj.tipo_servico || ''
      };
    }).filter(function (l) { return l.meses > 0; });

    const compsTodas = {};
    linhas.forEach(function (l) { l.competencias.forEach(function (c) { compsTodas[c] = true; }); });
    const chaves = Object.keys(compsTodas).sort();
    return {
      ok: true, cliente: cli, de: de, ate: ate, linhas: linhas,
      competencias: chaves,
      primeira: chaves[0] || '', ultima: chaves[chaves.length - 1] || '',
      total_faturado: Math.round(linhas.reduce(function (a2, l) { return a2 + l.faturado; }, 0) * 100) / 100,
      total_producao: Math.round(linhas.reduce(function (a2, l) { return a2 + l.producao; }, 0) * 100) / 100,
      total_notas: linhas.reduce(function (a2, l) { return a2 + l.notas; }, 0),
      contratos: linhas.map(function (l) { return l.contrato; }).filter(Boolean)
        .filter(function (c, i, arr) { return arr.indexOf(c) === i; })
    };
  }

  /* Registro do atestado recebido (ou do pedido feito): é o que reinicia
     a contagem dos 6 meses e monta o inventário pra licitação. */
  function registrarAtestado(clienteId, d) {
    if (!pode('faturar') && !pode('lancar')) return { erro: 'Seu perfil não registra atestado.' };
    const cli = D.clientes.find(function (x) { return x.id === clienteId; });
    if (!cli) return { erro: 'Cliente não encontrado.' };
    if (d.situacao === 'recebido' && !d.data) return { erro: 'Informe a data do atestado.' };
    const reg = {
      id: novoId('at'), cliente: clienteId, situacao: d.situacao || 'recebido',
      data: d.data || U.hoje(), numero: d.numero || '', periodo_de: d.periodo_de || '',
      periodo_ate: d.periodo_ate || '', observacao: d.observacao || '',
      arquivo: d.arquivo || null,
      registrado_por: usuario().nome, registrado_em: new Date()
    };
    st.atestados.push(reg);
    if (reg.situacao === 'recebido') cli.atestado_em = reg.data;
    else cli.atestado_solicitado_em = reg.data;
    if (d.periodicidade) cli.atestado_periodicidade = d.periodicidade;
    logar('cliente', clienteId, reg.situacao === 'recebido' ? 'registrou atestado' : 'registrou pedido de atestado',
      cli.nome + (reg.numero ? ' · ' + reg.numero : '') + ' · ' + U.fData(reg.data));
    return { ok: true, atestado: reg };
  }

  const atestadosDoCliente = clienteId => st.atestados
    .filter(function (a2) { return a2.cliente === clienteId; })
    .sort(function (a2, b2) { return (b2.data || '').localeCompare(a2.data || ''); });

  /* ── relatórios do financeiro por período ───────────────
     Dois relatórios que o financeiro pediu, no formato da planilha que
     eles já usam:

     1) "Contas a pagar e a receber": o que VENCE no período, entradas e
        saídas na mesma lista, em ordem de vencimento, com saldo corrido
        a partir do saldo bancário de hoje — é a projeção de caixa.
     2) "Contas pagas e recebidas": o que foi BAIXADO no período (data do
        pagamento/recebimento), sem saldo corrido — é a realização.

     Os dois saem um por arquivo, com uma aba só. */
  function contasAPagarEReceber(de, ate) {
    const linhas = [];
    const nomeCredor = id => (D.credor(id) || {}).nome || '';
    const formaDe = id => {
      const f = formaDoCredor(id);
      return f ? (f.nome || f.codigo) : '';
    };

    st.parcelas.forEach(function (p) {
      if (['aberto', 'parcial', 'previsto', 'aguardando', 'autorizado', 'enviado'].indexOf(p.status) < 0) return;
      if (!p.venc || p.venc < de || p.venc > ate) return;
      linhas.push({
        tipo: 'Saída', mov: 'Sim', documento: p.doc || '',
        forma: formaDe(p.credor),
        contraparte: nomeCredorVisivel(p, nomeCredor(p.credor)),
        descricao: descricaoVisivel(p),
        competencia: p.comp || '', emissao: p.emissao || '', vencimento: p.venc,
        parcela: p.num + '/' + (p.total || 1),
        valor: Math.round(saldoDe(p) * 100) / 100,
        previsto: p.status === 'previsto', origem: p
      });
    });

    st.receber.forEach(function (r) {
      if (!receberAberto(r)) return;
      if (!r.vencimento || r.vencimento < de || r.vencimento > ate) return;
      linhas.push({
        tipo: 'Entrada', mov: 'Sim', documento: r.numero || '',
        forma: r.origem === 'previsao' ? 'Previsão' : 'Recebimento',
        contraparte: r.cliente_nome || '',
        descricao: r.discriminacao || ((D.centro(r.centro) || {}).curto || ''),
        competencia: r.competencia || '', emissao: r.emissao || '', vencimento: r.vencimento,
        parcela: '1/1', valor: Math.round(saldoReceberDe(r) * 100) / 100,
        previsto: r.status === 'previsto', origem: r
      });
    });

    /* Ordem: vencimento e, no mesmo dia, entrada antes de saída (é
       assim que o caixa acontece — recebe de manhã, paga à tarde). */
    linhas.sort(function (a2, b2) {
      return a2.vencimento.localeCompare(b2.vencimento) ||
        (a2.tipo === b2.tipo ? b2.valor - a2.valor : (a2.tipo === 'Entrada' ? -1 : 1));
    });

    const saldoBanco = Math.round(D.bancos.filter(function (b) { return b.ativo; })
      .reduce(function (acc, b) { return acc + (saldoAtual(b.id).valor || 0); }, 0) * 100) / 100;
    let saldo = saldoBanco;
    linhas.forEach(function (l) {
      saldo = Math.round((saldo + (l.tipo === 'Entrada' ? l.valor : -l.valor)) * 100) / 100;
      l.saldo = saldo;
    });
    return {
      de: de, ate: ate, saldo_banco: saldoBanco, linhas: linhas,
      total_entradas: Math.round(linhas.filter(function (l) { return l.tipo === 'Entrada'; })
        .reduce(function (a2, l) { return a2 + l.valor; }, 0) * 100) / 100,
      total_saidas: Math.round(linhas.filter(function (l) { return l.tipo === 'Saída'; })
        .reduce(function (a2, l) { return a2 + l.valor; }, 0) * 100) / 100,
      saldo_final: saldo
    };
  }

  /* ── fluxo de caixa diário ──────────────────────────────
     Os próximos N dias, um por linha, com o saldo andando a cada dia a
     partir do saldo bancário de hoje. É a pergunta do caixa: "dá pra
     pagar tudo esta semana?". Opcionalmente ignora o que já venceu —
     útil quando o atrasado está em negociação e não vai sair agora. */
  function fluxoDiario(opcoes) {
    opcoes = opcoes || {};
    const dias = opcoes.dias || 10;
    const hoje = U.hoje();
    const semVencidos = !!opcoes.sem_vencidos;
    /* O parâmetro `banco` só ecoava no retorno: o saldo de partida
       vinha do grupo e as parcelas não eram filtradas, então dívida da
       Novaped era projetada contra o caixa da matriz. Pedindo uma
       conta, a projeção passa a ser daquela conta e das obrigações da
       empresa dela. */
    const bancoId = opcoes.banco || null;
    const contaFiltro = bancoId ? D.banco(bancoId) : null;
    const empresaFiltro = opcoes.empresa || (contaFiltro ? contaFiltro.empresa : null) || null;
    const saldoInicial = opcoes.saldo_inicial !== undefined && opcoes.saldo_inicial !== null
      ? opcoes.saldo_inicial
      : bancoId ? +saldoDoSistema(bancoId) : ((saldoBancarioAtual() || {}).valor || 0);

    const saidas = {}, entradas = {}, det = {};
    /* Quanto da projeção é PREVISTO (folha, FGTS, INSS, IRRF, guias):
       o leitor precisa saber que parte do buraco ainda não é título
       vencido. */
    let previstoSaida = 0, previstoEntrada = 0;
    const põe = (mapa, data, valor, desc, previsto) => {
      mapa[data] = Math.round(((mapa[data] || 0) + valor) * 100) / 100;
      if (previsto) {
        if (mapa === saidas) previstoSaida += valor; else previstoEntrada += valor;
      }
      (det[data] = det[data] || []).push({ tipo: mapa === saidas ? 'saida' : 'entrada',
        valor: valor, descricao: desc, previsto: !!previsto });
    };

    /* Vencido entra no primeiro dia (é o que sai assim que houver
       dinheiro), a menos que a pessoa peça para desconsiderar. */
    st.parcelas.forEach(function (p) {
      /* 'previsto' entra: é obrigação que vai sair do caixa — folha
         fechada, guia de retenção, provisão. Sem ele o fluxo diário
         ignorava justamente os maiores desembolsos do mês, e o
         "primeiro dia negativo" saía otimista. contasAPagarEReceber e
         o exportar-fluxo já contavam o previsto; só este ficou de
         fora. */
      if (['aberto', 'parcial', 'aguardando', 'autorizado', 'enviado', 'previsto']
        .indexOf(p.status) < 0) return;
      /* Recortado por conta ou empresa: dívida de um CNPJ não é
         projetada contra o caixa de outro. */
      if (empresaFiltro && empresaDaParcela(p) !== empresaFiltro) return;
      const saldo = saldoDe(p);
      if (saldo <= 0.004) return;
      const vencido = p.venc < hoje;
      if (vencido && semVencidos) return;
      const dia = vencido ? hoje : p.venc;
      põe(saidas, dia, saldo, (nomeCredorVisivel(p) || '') + (vencido ? ' (vencida)' : '') +
        (p.status === 'previsto' ? ' (previsto)' : ''), p.status === 'previsto');
    });
    st.receber.forEach(function (r) {
      if (!receberAberto(r)) return;
      const saldo = saldoReceberDe(r);
      if (saldo <= 0.004) return;
      const venc = r.vencimento || r.previsao;
      if (!venc) return;
      const vencido = venc < hoje;
      if (vencido && semVencidos) return;
      põe(entradas, vencido ? hoje : venc, saldo, r.cliente_nome || '');
    });

    const linhas = [];
    let saldo = saldoInicial;
    for (let i = 0; i < dias; i++) {
      const dia = U.addDias(hoje, i);
      const ent = entradas[dia] || 0;
      const sai = saidas[dia] || 0;
      saldo = Math.round((saldo + ent - sai) * 100) / 100;
      linhas.push({ data: dia, entradas: ent, saidas: sai, saldo: saldo,
        hoje: dia === hoje, itens: det[dia] || [], negativo: saldo < 0 });
    }
    return {
      banco: bancoId, empresa: empresaFiltro,
      saldo_inicial: saldoInicial, hoje: hoje, dias: dias,
      sem_vencidos: semVencidos, linhas: linhas,
      previsto_saida: Math.round(previstoSaida * 100) / 100,
      previsto_entrada: Math.round(previstoEntrada * 100) / 100,
      menor_saldo: linhas.reduce(function (m, l) { return Math.min(m, l.saldo); }, saldoInicial),
      primeiro_negativo: (linhas.find(function (l) { return l.saldo < 0; }) || {}).data || null
    };
  }

  function contasPagasERecebidas(de, ate, f) {
    f = f || {};
    const linhas = [];
    const nomeCredor = id => (D.credor(id) || {}).nome || '';

    todosPagamentos().forEach(function (pg) {
      if (!pg.data || pg.data < de || pg.data > ate) return;
      const p = parcela(pg.parcela_id);
      if (!p) return;
      const f = formaDoCredor(p.credor);
      linhas.push({
        tipo: 'Saída', documento: p.doc || '',
        forma: pg.forma || (f ? (f.nome || f.codigo) : ''),
        contraparte: nomeCredorVisivel(p, nomeCredor(p.credor)),
        descricao: descricaoVisivel(p),
        competencia: p.comp || '', emissao: p.emissao || '', vencimento: p.venc || '',
        baixa: pg.data, parcela: p.num + '/' + (p.total || 1),
        valor: Math.round((pg.valor + (pg.juros || 0) + (pg.multa || 0)) * 100) / 100,
        juros: Math.round(((pg.juros || 0) + (pg.multa || 0)) * 100) / 100,
        banco: (D.banco(pg.banco) || {}).apelido || '',
        banco_id: pg.banco || null,
        empresa: (D.empresaPor(pg.banco ? empresaDaConta(pg.banco) : empresaDaParcela(p)) || {}).apelido || ''
      });
    });

    /* Uma linha por BAIXA, como o lado da saída já fazia com os
       pagamentos. Antes exigia status 'recebido' — o recebimento
       parcial ficava 'faturado' e sumia do relatório — e carimbava o
       total na data da última baixa, jogando para setembro o dinheiro
       que entrou em agosto. É o relatório que a contabilidade recebe
       por banco, então a data de cada entrada tem de ser a real. */
    st.receber.forEach(function (r) {
      if (['cancelado', 'substituido'].indexOf(r.status) > -1) return;
      const baixas = (r.baixas || []).filter(function (b) { return !b.estornada; });
      /* Recebimento antigo, gravado antes de as baixas existirem:
         usa o carimbo, para não sumir do histórico. */
      const lista = baixas.length ? baixas
        : (r.status === 'recebido' && r.recebido_em
            ? [{ data: r.recebido_em, valor: r.valor_recebido || r.valor_liquido || 0,
                 banco: bancoDoRecebimento(r) }]
            : []);
      lista.forEach(function (b, i) {
        if (!b.data || b.data < de || b.data > ate) return;
        linhas.push({
          tipo: 'Entrada', documento: r.numero || '', forma: 'Recebimento',
          contraparte: r.cliente_nome || '',
          descricao: r.discriminacao || ((D.centro(r.centro) || {}).curto || ''),
          competencia: r.competencia || '', emissao: r.emissao || '', vencimento: r.vencimento || '',
          baixa: b.data, parcela: (i + 1) + '/' + lista.length,
          valor: Math.round((b.valor || 0) * 100) / 100,
          juros: 0,
          banco: (D.banco(b.banco) || {}).apelido || '',
          banco_id: b.banco || null,
          empresa: (D.empresaPor(b.banco
            ? empresaDaConta(b.banco) : empresaDoCentro(r.centro)) || {}).apelido || ''
        });
      });
    });

    /* Filtro por conta e por empresa: é assim que sai o arquivo que a
       contabilidade pede, um por banco. */
    const filtradas = linhas.filter(function (l) {
      return (!f.banco || l.banco_id === f.banco) &&
        (!f.empresa || l.empresa === ((D.empresaPor(f.empresa) || {}).apelido || f.empresa));
    });
    linhas.length = 0;
    filtradas.forEach(function (l) { linhas.push(l); });

    linhas.sort(function (a2, b2) {
      return a2.baixa.localeCompare(b2.baixa) ||
        (a2.tipo === b2.tipo ? b2.valor - a2.valor : (a2.tipo === 'Entrada' ? -1 : 1));
    });
    const recebido = Math.round(linhas.filter(function (l) { return l.tipo === 'Entrada'; })
      .reduce(function (a2, l) { return a2 + l.valor; }, 0) * 100) / 100;
    const pago = Math.round(linhas.filter(function (l) { return l.tipo === 'Saída'; })
      .reduce(function (a2, l) { return a2 + l.valor; }, 0) * 100) / 100;
    return { de: de, ate: ate, linhas: linhas, total_recebido: recebido, total_pago: pago,
      resultado: Math.round((recebido - pago) * 100) / 100 };
  }

  /* Custo de produtividade por projeto, setor e tipo — pago e em
     aberto. Só existe pra parcela que veio de importação de
     fechamento (tem `itens`); despesa lançada direto não tem setor
     nem tipo pra quebrar. Os filtros são progressivos: sem setor,
     agrupa por setor; com setor, agrupa por tipo dentro dele; com os
     dois, devolve também as parcelas por trás do número — sem isso o
     relatório vira uma soma sem rastro até o médico. */
  /* `centroId` aceita um projeto OU uma unidade (projeto mãe): quem
     quer "tudo da AGIR" não deveria ter que escolher setor por setor.
     `de`/`ate` filtram pela competência do lançamento. */
  function custosPorSetorTipo(centroId, setor, tipo, de, ate) {
    const grupos = {};
    const pega = k => (grupos[k] = grupos[k] || { pago: 0, aberto: 0 });
    const detalhe = [];
    const alvo = D.centro(centroId);
    const porUnidade = !alvo;   // não é um projeto: trata como unidade
    const idsDaUnidade = porUnidade
      ? D.centros.filter(function (c) { return c.tipo === 'projeto' && (c.unidade || '') === centroId; })
          .map(function (c) { return c.id; })
      : [centroId];
    const compDe = de ? U.compDe(de) : null;
    const compAte = ate ? U.compDe(ate) : null;
    st.parcelas.forEach(function (p) {
      if (p.status === 'cancelado' || !p.itens || !p.itens.length) return;
      const c = (p.rateio || [])[0] ? p.rateio[0].centro : p.centro;
      if (idsDaUnidade.indexOf(c) < 0) return;
      if (compDe && (p.comp || '') < compDe) return;
      if (compAte && (p.comp || '') > compAte) return;
      const pago = p.status === 'pago';
      p.itens.forEach(function (i) {
        if (setor && i.setor !== setor) return;
        if (tipo && i.tipo !== tipo) return;
        const k = setor ? i.tipo : i.setor;
        const b = pega(k);
        if (pago) b.pago = Math.round((b.pago + i.valor) * 100) / 100;
        else b.aberto = Math.round((b.aberto + i.valor) * 100) / 100;
        if (setor && tipo) {
          detalhe.push({ parcela: p.id, credor: (D.credor(p.credor) || {}).nome || p.credor,
            competencia: p.comp, status: p.status, venc: p.venc, pago_em: p.pago_em || null,
            valor: i.valor });
        }
      });
    });
    return { grupos: grupos, detalhe: detalhe };
  }
  /* Setores e tipos que já apareceram nalguma parcela do projeto —
     alimenta os selects do relatório sem precisar de cadastro à parte. */
  /* Unidades (projetos mãe) que têm produtividade: é por elas que se
     filtra "tudo da AGIR" sem escolher setor por setor. */
  const unidadesComProdutividade = () => D.centros
    .filter(function (c) { return c.tipo === 'projeto' && c.produtividade && c.unidade; })
    .map(function (c) { return c.unidade; })
    .filter(function (u, i, a) { return a.indexOf(u) === i; })
    .sort(function (a, b) { return String(a).localeCompare(String(b), 'pt-BR'); });

  function setoresTiposDe(centroId) {
    const setores = {};
    // aceita projeto ou unidade (projeto mãe), igual ao relatório
    const alvo = D.centro(centroId);
    const ids = alvo ? [centroId]
      : D.centros.filter(function (c) { return c.tipo === 'projeto' && (c.unidade || '') === centroId; })
          .map(function (c) { return c.id; });
    st.parcelas.forEach(function (p) {
      if (p.status === 'cancelado' || !p.itens || !p.itens.length) return;
      const c = (p.rateio || [])[0] ? p.rateio[0].centro : p.centro;
      if (ids.indexOf(c) < 0) return;
      p.itens.forEach(function (i) {
        const s = setores[i.setor] = setores[i.setor] || new Set();
        s.add(i.tipo);
      });
    });
    return Object.keys(setores).sort().map(function (s) {
      return { setor: s, tipos: Array.from(setores[s]).sort() };
    });
  }

  /* ── carga inicial de exemplo ───────────────────────────*/
  function init() {
    D.migrarVinculoCliente();   // cliente passa a morar no projeto
    /* Ativos vindos da planilha que a empresa já mantinha. O projeto
       vem por NOME (era assim na planilha) e é amarrado ao centro
       quando o nome bate. */
    if (!st.ativos.length) {
      D.ativosSeed.forEach(function (a) {
        const pj = D.centros.find(function (c) {
          return c.tipo === 'projeto' &&
            [c.curto, c.nome, c.unidade].filter(Boolean).some(function (n) {
              return String(n).toLowerCase().indexOf(String(a.projeto_nome || '').toLowerCase().split(' - ')[0]) > -1;
            });
        });
        st.ativos.push(Object.assign({}, a, { projeto: a.projeto_nome === 'Sem projeto' ? null : (pj ? pj.id : null) }));
      });
    }
    const guardaUsuario = st.usuarioId;
    /* O seed roda como ADMINISTRAÇÃO, não como sócio: a política de
       acesso é configuração do cliente e pode tirar do sócio a
       movimentação — foi o que aconteceu na v30, e os contratos de
       exemplo deixaram de nascer em silêncio. O dado inicial não
       pode depender de quem tem qual permissão hoje. */
    st.usuarioId = 'u5';
    D.titulosSeed.forEach(s => {
      const linhas = s.parcelas.map((p, i) => ({ num: i + 1, venc: p.venc, comp: p.comp, valor: p.valor }));
      const r = criarTitulo({
        descricao: s.descricao, credor: s.credor, conta: s.conta, centro: s.centro,
        rateio: s.rateio, documento: s.doc, tipo_titulo: s.tipo, emissao: s.emissao,
        origem: s.origem, itens: s.itens, obs: ''
      }, linhas);
      if (!r.ok) return;
      const minhas = st.parcelas.filter(p => p.titulo_id === r.titulo.id);
      if (s.aprovacao === 'aprovado') aprovar(minhas.map(p => p.id));
      if (s.cancelado) minhas.forEach(function (p) { cancelar(p.id, s.cancelado); });
      (s.pagos || []).forEach(pg => {
        const alvo = minhas.find(p => p.num === pg.parcela);
        if (alvo) registrarPagamento(alvo.id, {
          data: pg.data, valor: pg.valor, juros: pg.juros, multa: pg.multa,
          desconto: 0, banco: pg.banco, forma: pg.forma, doc: '', obs: '',
          situacao: pg.situacao || 'liquidado'
        });
      });
    });
    // inventário inicial: primeira camada de cada material
    D.estoqueSeed.forEach(function (e) {
      const p = D.produtos.find(function (x) { return x.id === e.produto; }) || {};
      entrada({ produto: e.produto, armazem: e.armazem, qtd: e.qtd, custo: p.custo,
        data: '2026-08-31', motivo: 'Inventário inicial', origem: 'inventario' });
    });
    D.contratosSeed.forEach(function (c) {
      salvarContrato(Object.assign({}, c, { itens: c.itens.slice() }));
    });
    st.usuarioId = guardaUsuario;
  }

  return {
    st, init, usuario, setUsuario, pode, acesso, acessoDoPerfil, podeMover, veFinanceiro,
    matrizAcesso: matriz, salvarMatrizAcesso, visivel, ehFeriado, quintoDiaUtil, conciliarVarios, gruposQueFecham, descricaoVisivel, nomeCredorVisivel, obsVisivel, tituloSigiloso,
    /* Cadastros são gravados direto pela tela (não passam por uma
       função de domínio). Enquanto for assim, ao menos deixam rastro. */
    logarCadastro: logar,
    gerarParcelas, criarTitulo, aprovar, reprovar, registrarPagamento, estornar, cancelar,
    criarReceber, emitirFatura, proximoNumeroFatura, contasReceber, listarReceber, receberBaixa, estornarRecebimento, editarReceber,
    saldoInicial, saldoInicialEm, saldoAtual, saldosAtuais,
    receberAberto, receberVencido, diasDeAtraso, cancelarReceber, saldoReceberDe, vinculosPendentes, vinculosPendentesQtd, confirmarSubstituicao, recusarVinculo,
    prazoDe, dataPrevista, salvarPrevisao, confirmarFaturamentoProdutividade,
    autorizarFaturamento, liberarFaturamento, confirmarEAutorizarFaturamento, confirmarFaturamentoGrupo,
    statusProdutividade, NOME_STATUS_PROD, lancarComplementoFaturamento, statusFaturamento, NOME_STATUS_FAT, resultadoFaturamento,
    editarEstimativaEsteira, desfazerEtapaFaturamento, esteiraFaturamento, etapaDaPrevisao, travaDeLiberacao, previsoes, previsaoDe, excluirPrevisao, realizadoDaPrevisao,
    residuoPrevisao, marcarPrevisoes, marcarParcial, salvarPrevisaoDespesa, previsoesDespesa,
    excluirPrevisaoDespesa, replicarSerieDespesa, realizadoDespesa, residuoDespesa,
    parametros, salvarParametros, salvarUsuario, eventos,
    perfilAtual, veModulo, salvarPerfil, excluirPerfil,
    efetivarPrevisto,
    importarExtrato, linhasExtrato, candidatos, extratos,
    informarSaldoBancario, saldoInformado, saldoDoSistema, saldoBancarioAtual, classificarLinhas, conciliar, conciliarLote,
    classificarLinha, lancarLote, lancarReceitaDoExtrato, aplicarRegra, salvarRegra, regras, regraDe, excluirRegra,
    chaveContraparte, nomeDaLinha, gruposProdutividade, ignorarLinha, extratos, resumoConciliacao,
    salvarContrato, addAditivo, contratos, contrato, contratoDoProjeto, excluirContrato, alertasContrato, pendenciasHome,
    entrada, saida, baixaMultipla, transferir, estornarMovimento, entradaLote, camadas, custoMedio,
    saldoEstoque, valorEstoque, movimentos, textoDoMovimento, consumoPorPaciente,
    pacientesDoMovimento, pacienteVisivel, vePaciente, posicaoEstoque, posicaoConsolidada, distribuir,
    alertasEstoque, alertasTransferencia, saldoNaUnidade, minimoDe, idealDe, definirMinimo, comSaldo,
    refJaUsada, proximoComplemento, podeEditarRequisicao,
    criarRequisicao, mudarStatusCompra, enviarPedido, valorEstimadoCompra, compras, compra, pedidosAbertos,
    aprovarRequisicao, registrarCotacao, totalCotado, aprovarCompra, emailDoPedido,
    registrarLoteProdutividade, lotesProdutividade, cancelarLoteProdutividade,
    confirmarLoteProdutividade, bloquearPagamentoMedico, liberarPagamentoMedico, situacaoLoteProdutividade,
    substituirFechamento, fechamentosVivosDe, compararFechamento,
    coberturaProdutividade, produtividadePendente, coberturaFaturamento, faturamentoPendente,
    empresaDaConta, empresaDoCentro, empresaDoTitulo, empresaDaParcela, contaDoExtrato,
    bancoDaParcela, bancoDoRecebimento, desconciliar, reabrirLinha, reapontarConciliacao,
    ajusteInventario, custoDeAquisicao, ratearDespesasNota, cadastrarMaterial,
    materiaisPadraoDe, salvarMaterialPadrao, estoquePorFamilia, proximoIdProduto,
    completarCadastroPelaNota, materiaisSemNCM, proximoIdCredor, proximoId,
    transferirEntreContas, transferenciasBanco, cancelarTransferenciaBanco,
    analisarNFSeImportacao, importarNFSe,
    recebidoNaConta, recebidoSemConta, ultimoInventario, checarDataInventario,
    checarPosicao,
    lancarProcedimento, editarProcedimento, cancelarProcedimento, listarProcedimentos,
    medicoDuplo,
    resumoFechamentoProcedimentos, fecharProcedimentos, relatorioFaturamento, enviarFaturamentoProcedimentos,
    faturamentoPorEmissao, faturamentoPorCompetencia, comparativoProdutividade, sugerirPrevisao,
    impostoSobreFaturamento,
    cancelarFechamentoProcedimentos, fechamentosProcedimentos, fechamentoProcedimentosDe,
    travaDeProcedimento,
    atualizarPrevisoesProcedimentos,
    plantoesEstimados, plantoesVisiveis, procedimentosComPlantao, ajustarPlantoes,
    plantaoValor, plantaoHoras, custoMaterialPrevisto,
    plantaoRealizado,
    resultadoProcedimentos, gerarFinanceiroProcedimentos, calcularProcedimento,
    impostoProcedimentos, tributosProcedimentos, detalharImposto, salvarImpostosProcedimentos,
    salvarTabelasDP, validarTabelasDP, diasDeDireitoPorFaltas, tetoAbono, partesDoRateio,
    dataExiste,
    dia20MesSeguinte, antecipaSeFimDeSemana,
    apuracaoPorEmpresa, empresaDoCNPJ, despesaPorEmpresa,
    pagamentoCruzado, contaCorrenteEmpresas, EMPRESA_PADRAO,
    calcularINSS, calcularIRRF, baseIRRFEfetiva, calcularFGTS, calcularHolerite, funcionariosDaFolha, extrasComDiasPadrao,
    folhas, fecharFolha, cancelarFolha,
    criarFuncionario, editarFuncionario, desligarFuncionario, registrarReajusteSalarial, historicoSalarial, criarCargo,
    aprovarDadosPagamento,
    funcionariosForaDaFolha, calcularFerias, lancarFerias, cancelarFerias, situacaoFerias, calcularRescisao, lancarRescisao, cancelarRescisao, TIPOS_RESCISAO, alertasDP,
    funcionariosParaRescisao,
    custoFuncionarios, provisaoMensalPessoal, calcular13, decimos, fechar13, cancelar13,
    retencoesPendentes, resumoRetencoesPendentes, guiasRetencao, fecharGuiaRetencao, cancelarGuiaRetencao,
    listar, parcela, saldoDe, valorNoCentro, aguardandoDe,
    formaDoCredor, impedimentos, editarParcela, CAMPOS_EDITAVEIS,
    pagamentosAguardando, pagamento, autorizarPagamento, recusarPagamento,
    autorizadosDe, enviadosDe, emCursoDe, pagoDe, caixaDe, pagamentosDe, pagamentosTodos, eventosDe,
    pendentesAprovacao, semAnexo, pagoSemNota, temNota, dispensaNota, informarNF, todasParcelas, custosPorSetorTipo, setoresTiposDe, unidadesComProdutividade,
    credorPorNome, tipoCredorPorConta, lancarReceberAvulso,
    aptasParaRemessa, remessaProntas, remessaBloqueadas, informarCodigoBarras,
    chaveDoGrupo, agruparRepasses, agruparPagamentos, nomeDoGrupo, aptasParaSolicitar, prontasParaRemessa, pendentesDeDados, solicitarLote, cancelarSolicitacao,
    marcarEnviados, liquidar, devolverParaRemessa,
    proximoSeuNumero, registrarRemessa, remessas,
    remessaPorSequencial, proximoSequencialRemessa, aplicarRetorno, todosPagamentos,
    grupoDe, projetosDoGrupo, baseDoGrupo, salvarPrevisaoGrupo, ratearNoGrupo, faturarGrupo,
    itensParaRPS, registrarLoteRPS, registrarProtocoloRPS, converterLoteRPS,
    ativos, ativo, salvarAtivo, movimentarAtivo, movimentacoesDoAtivo, situacaoAtiva, ondeEstavaEm,
    abrirOS, ordensServico, fecharOS, salvarPlanoManutencao, gerarPreventivas,
    moverOS, cancelarOS, reabrirOS, ETAPAS_OS, NOME_ETAPA_OS, indicadoresManutencao, calibracoesVencendo,
    desmembrarAtivo, vincularLocacao, resultadoDaCompra, baixarAtivo, nomeContratante, reativarAtivo, proximaTag, estornarMovimentacao,
    depreciacaoMensal, depreciacaoDoAtivo, depreciacaoPorProjeto, VIDA_UTIL_PADRAO,
    ociosidadeAtivos, resultadoDoAtivo,
    contasAPagarEReceber, contasPagasERecebidas, fluxoDiario,
    atestadosPendentes, historicoAtestado, registrarAtestado, atestadosDoCliente, prestacaoDoCliente
  };
})();
