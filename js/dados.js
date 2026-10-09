/* ERP · dados.js — cadastros de exemplo.
   No sistema real tudo isto vem do Supabase (erp_schema_v2.sql).
   Trocar este módulo pela camada de API não muda mais nada do resto. */
window.ERP = window.ERP || {};

ERP.dados = (function () {

  /* O grupo tem três CNPJs e a movimentação corre junta no mesmo ERP,
     etiquetada por empresa. A empresa nunca é digitada no lançamento:
     ela vem da CONTA BANCÁRIA (no pagamento e no extrato) ou do CENTRO
     DE CUSTO (no faturamento e na produtividade). */
  const empresas = [
    { id: 'emp1', apelido: 'HJM Matriz', nome: 'HJM DOM PEDRO GESTAO E SERVICOS EM SAUDE LTDA',
      cnpj: '34.958.609/0001-90', municipio: 'BARUERI', uf: 'SP', codigo_ibge: '3505708',
      inscricao_municipal: '5BX8969', matriz: true, ativo: true },
    { id: 'emp2', apelido: 'HJM Filial CE', nome: 'HJM DOM PEDRO GESTAO E SERVICOS EM SAUDE LTDA',
      cnpj: '34.958.609/0003-51', municipio: 'FORTALEZA', uf: 'CE', codigo_ibge: '2304400',
      inscricao_municipal: '', matriz: false, ativo: true },
    { id: 'emp3', apelido: 'Novaped', nome: 'NOVAPED PROFISSIONAIS ESPECIALIZADOS DE SAUDE LTDA',
      cnpj: '34.015.981/0001-62', municipio: '', uf: '', codigo_ibge: '',
      inscricao_municipal: '', matriz: false, ativo: true }
  ];
  const empresaPor = id => empresas.find(function (e) { return e.id === id; }) || null;

  const empresa = {
    nome: 'HJM DOM PEDRO GESTAO E SERVICOS EM SAUDE LTDA', cnpj: '34.958.609/0001-90',
    /* Dados usados no arquivo de RPS da prefeitura de Barueri (layout
       PMB004 / v4.4). Inscrição municipal sem ponto e sem traço. */
    inscricao_municipal: '5BX8969', municipio: 'BARUERI', uf: 'SP', codigo_ibge: '3505708',
    endereco: 'ALAMEDA ITAPECURU', numero: '645', complemento: 'SALA 1221 E 1223',
    bairro: 'ALPHAVILLE CENTRO INDUSTR E EMPR', cep: '06454080',
    email: 'DIR.FINANCEIRA@DOMPEDROSAUDE.COM.BR', fone: '(71) 3936-4641',
    simples_nacional: 1,              // 1 = não optante (lucro presumido)
    /* Parâmetros fiscais do serviço prestado. Conferir com a
       contabilidade antes do primeiro envio de verdade — são eles que
       o validador da prefeitura recusa primeiro. */
    rps: {
      serie: 'RPS', serie_nfe: '', codigo_servicoutm: '',
      codigo_servico: '040701001',    // serviços médicos (LC 116 item 4.07)
      nbs: '112031000', ind_operacao: '010101', class_trib: '000001', sit_trib: '000',
      local_prestacao: '1'            // 1 = prestado no município
    }
  };

  /* PERFIS DE ACESSO. Cada perfil é um conjunto de ações e de módulos
     visíveis — dá para criar quantos quiser. "ver_custo" separa quem
     movimenta material de quem pode ver dinheiro: o estoquista lança
     entrada e saída sem enxergar custo, valor de estoque ou qualquer
     tela financeira. */
  const ACOES = [
    { id: 'lancar',        nome: 'Lançar título e nota',            grupo: 'Financeiro' },
    { id: 'pagar',         nome: 'Solicitar e registrar pagamento', grupo: 'Financeiro' },
    { id: 'aprovar',       nome: 'Aprovar pagamento',               grupo: 'Financeiro' },
    { id: 'cancelar',      nome: 'Cancelar parcela',                grupo: 'Financeiro' },
    { id: 'estornar',      nome: 'Estornar pagamento',              grupo: 'Financeiro' },
    { id: 'faturar',       nome: 'Importar notas e faturar',        grupo: 'Financeiro' },
    { id: 'ver_custo',     nome: 'Ver valores e custos',            grupo: 'Financeiro' },
    { id: 'estoque',       nome: 'Movimentar estoque',              grupo: 'Suprimentos' },
    { id: 'requisitar',    nome: 'Abrir requisição de compra',      grupo: 'Suprimentos' },
    { id: 'comprar',       nome: 'Cotar e enviar pedido',           grupo: 'Suprimentos' },
    { id: 'aprovar_compra',nome: 'Aprovar requisição de compra',    grupo: 'Suprimentos' },
    { id: 'receber',       nome: 'Dar entrada de material',         grupo: 'Suprimentos' },
    { id: 'dp',            nome: 'Lançar e fechar folha',           grupo: 'Pessoal' },
    { id: 'ver_dados_pessoais', nome: 'Ver CPF, dependentes e dados bancários do funcionário', grupo: 'Pessoal' },
    /* Nome de paciente é dado de saúde (LGPD, art. 5º, II): ver e
       exportar exige permissão própria, separada do acesso ao estoque.
       Quem não tem vê a movimentação normalmente, só com o nome
       mascarado. */
    { id: 'ver_pacientes', nome: 'Ver e exportar nome de paciente nas movimentações (dado de saúde)', grupo: 'Estoque' },
    /* Duas mãos diferentes na esteira do faturamento: quem confirma o
       fechamento registra a autorização do órgão; quem responde pelo
       faturamento libera a emissão. */
    { id: 'baixar_ativo', nome: 'Dar baixa em ativo (venda, sucata, perda)', grupo: 'Estoque' },
    { id: 'autorizar_faturamento', nome: 'Registrar a autorização do órgão para faturar', grupo: 'Faturamento' },
    { id: 'liberar_faturamento', nome: 'Liberar o faturamento (permite emitir NF/fatura)', grupo: 'Faturamento' },
    { id: 'ver_doc_socio', nome: 'Ver documento com dado pessoal de sócio (RG, CPF, residência)', grupo: 'Habilitação' },
    { id: 'admin',         nome: 'Administrar usuários e políticas',grupo: 'Administração' }
  ];

  const MODULOS = [
    { id: 'financeiro',    nome: 'Financeiro' },
    { id: 'produtividade', nome: 'Produtividade' },
    { id: 'estoque',       nome: 'Estoque' },
    { id: 'ativos',        nome: 'Ativos' },
    { id: 'faturamento',   nome: 'Faturamento' },
    { id: 'compras',       nome: 'Compras' },
    { id: 'contratos',     nome: 'Contratos' },
    { id: 'dp',            nome: 'Pessoal' },
    { id: 'cadastros',     nome: 'Cadastros' },
    { id: 'procedimentos', nome: 'Procedimentos' },
    { id: 'habilitacao',   nome: 'Habilitação' },
    { id: 'administracao', nome: 'Administração' }
  ];

  const TODOS_MODULOS = MODULOS.map(function (m) { return m.id; });

  /* ── matriz de acesso ───────────────────────────────────
     Perfil × módulo, com três níveis em cada cruzamento:

       ver         — abre o módulo e consulta
       mover       — lança, edita, movimenta (baixa, entrada, pagamento)
       financeiro  — enxerga e mexe em valor: custo, preço, faturamento

     Os três são independentes de propósito. Quem opera o centro
     cirúrgico movimenta sem ver dinheiro; a contabilidade vê dinheiro
     sem movimentar nada.

     A sugestão abaixo é ponto de partida — a tela de Perfis de acesso
     edita cada quadradinho. Notar duas escolhas: a assistente
     financeira deixou de lançar procedimento (quem movimenta é o
     estoque, que está na sala), e o estoque lança procedimento e
     material mas não vê custo. */
  const NIVEIS_ACESSO = [
    { id: 'ver', nome: 'Visualização', curto: 'V',
      ajuda: 'Abre o módulo e lê o que está lá.' },
    { id: 'mover', nome: 'Movimentação', curto: 'M',
      ajuda: 'Lança, edita e movimenta — o trabalho do dia a dia.' },
    { id: 'financeiro', nome: 'Financeiro', curto: '$',
      ajuda: 'Vê e mexe em valor dentro do módulo.' },
    /* APROVAÇÃO é o quarto nível, e não é "movimentar mais": é a
       segunda mão. Quem lança não aprova — por isso é um nível
       próprio, e não uma extensão do M. Em cada módulo significa o
       ato que trava ou destrava dinheiro:
       financeiro = aprovar pagamento; compras = aprovar requisição;
       produtividade = confirmar o fechamento; faturamento = liberar
       a emissão da nota; dp = fechar a folha; procedimentos = fechar
       o faturamento do mutirão. */
    { id: 'aprovar', nome: 'Aprovação', curto: 'A',
      ajuda: 'A segunda mão: aprova, confirma ou libera o que outro lançou.' }
  ];

  /* Nem todo módulo tem os quatro níveis. CADASTROS e ADMINISTRAÇÃO
     não têm dinheiro para ver ou mexer — não existe custo, preço nem
     resultado ali —, então o nível $ nunca foi consultado no código
     para esses dois. Deixá-lo na tela era oferecer uma marcação que
     não muda nada, e pior: sugeria que mudava.

     Quem não aparece neste mapa tem os quatro. */
  const NIVEIS_DO_MODULO = {
    cadastros: ['ver', 'mover', 'aprovar'],
    administracao: ['ver', 'mover', 'aprovar'],
    habilitacao: ['ver', 'mover', 'aprovar']
  };
  const niveisDoModulo = id => (NIVEIS_DO_MODULO[id] ||
    NIVEIS_ACESSO.map(function (n) { return n.id; }));

  /* O que "aprovar" quer dizer em cada módulo — usado na tela para
     explicar o nível em vez de deixar a letra solta. */
  const APROVACAO_POR_MODULO = {
    financeiro:    'Aprovar pagamento antes de ir ao banco',
    compras:       'Aprovar requisição e liberar o pedido ao fornecedor',
    produtividade: 'Confirmar o fechamento da produtividade do mês',
    faturamento:   'Liberar a emissão da nota (depois da autorização do órgão)',
    procedimentos: 'Fechar o faturamento dos procedimentos e enviar ao financeiro',
    dp:            'Fechar a folha e as rescisões',
    estoque:       'Aprovar ajuste de inventário',
    ativos:        'Aprovar baixa e venda de ativo',
    contratos:     'Aprovar aditivo de contrato',
    cadastros:     'Aprovar dados bancários de credor e funcionário',
    habilitacao:   'Administrar o catálogo de tipos e arquivar documento do cofre',
    administracao: 'Autorização de última instância (quebra de segregação)'
  };

  /* 'VMF' = os três; 'VM' = vê e movimenta sem dinheiro; 'V$' = vê
     tudo, inclusive valor, mas não movimenta; '' = não vê o módulo. */
  const MATRIZ_PADRAO = {
    /* Transcrita da configuração que o Henrique montou na tela em
       02/10/2026 — é esta a distribuição de verdade, não mais a
       sugestão original. Dois pontos de desenho que valem registro,
       porque não são descuido:

       - O SÓCIO não movimenta nada (V $ A em tudo): ele vê, vê valor
         e aprova. Quem lança é a operação. É a segregação mais
         rigorosa da casa.
       - A ASSISTENTE lança em quase tudo e não aprova em lugar
         nenhum. O A dela é zero de propósito.

       Cadastros e Administração não têm o nível $ (v29): não há
       valor para ver nem mexer nesses dois. */
    assistente: {
      financeiro: 'VMF', produtividade: 'VMF', estoque: 'VF', ativos: 'VMF',
      faturamento: 'VMF', compras: 'VMF', contratos: 'VMF', dp: 'VF',
      cadastros: 'VM', procedimentos: 'VF', habilitacao: 'VM',
      /* Só LEITURA em Administração: com M, este perfil editava a
         matriz de acesso e podia promover a si mesmo. Quem mexe em
         acesso é Administração, Diretoria e Sócio. */
      administracao: 'V'
    },
    diretoria: {
      financeiro: 'VMFA', produtividade: 'VMFA', estoque: 'VMFA', ativos: 'VMFA',
      faturamento: 'VMFA', compras: 'VMFA', contratos: 'VMFA', dp: 'VMFA',
      cadastros: 'VMA', procedimentos: 'VMFA', habilitacao: 'VMA', administracao: 'VM'
    },
    /* Vê, vê valor e aprova — não movimenta. */
    socio: {
      financeiro: 'VFA', produtividade: 'VFA', estoque: 'VFA', ativos: 'VFA',
      faturamento: 'VFA', compras: 'VFA', contratos: 'VFA', dp: 'VFA',
      cadastros: 'VA', procedimentos: 'VFA', habilitacao: 'VMA', administracao: 'VM'
    },
    admin: {
      financeiro: 'VMFA', produtividade: 'VMFA', estoque: 'VMFA', ativos: 'VMFA',
      faturamento: 'VMFA', compras: 'VMFA', contratos: 'VMFA', dp: 'VMFA',
      cadastros: 'VMA', procedimentos: 'VMFA', habilitacao: 'VMA', administracao: 'VMA'
    },
    /* Consulta vê tudo com valor e não mexe em nada. */
    consulta: {
      financeiro: 'VF', produtividade: 'VF', estoque: 'VF', ativos: 'VF',
      faturamento: 'VF', compras: 'VF', contratos: 'VF', dp: 'VF',
      cadastros: 'V', procedimentos: 'VF', habilitacao: 'V'
    },
    estoquista: {
      estoque: 'VM', ativos: 'VM', compras: 'VM', cadastros: 'V', procedimentos: 'VM'
    },
    comprador: { estoque: 'VM', ativos: 'V', compras: 'VMF', cadastros: 'V' },
    /* O DP fecha a própria folha: não há segunda mão no setor hoje.
       Quando houver, tire o A daqui. */
    dp: { dp: 'VMFA', cadastros: 'V' },
    /* Confirma o fechamento do mês e fecha o faturamento dos
       procedimentos. A liberação da NOTA fica com o faturamento. */
    produtividade_dir: {
      produtividade: 'VMFA', ativos: 'VF', faturamento: 'VMF', contratos: 'VMF',
      cadastros: 'V', procedimentos: 'VFA'
    },
    produtividade_ger: {
      produtividade: 'VMFA', faturamento: 'VMF', contratos: 'VMF',
      cadastros: 'V', procedimentos: 'V'
    },
    operacional: { estoque: 'VM', procedimentos: 'VM' }
  };


  const perfis = [
    { id: 'assistente', nome: 'Assistente financeiro', sistema: true,
      /* Quem lança a produtividade e confirma o valor é quem fala com o
         hospital: registra a autorização do órgão. A LIBERAÇÃO para
         faturar fica com outra pessoa, de propósito. */
      /* `ver_dados_pessoais`: o assistente paga os salários, e para
         pagar precisa do líquido, da conta e do CPF. Consequência
         aceita e registrada — isso inclui ver o salário de todos,
         inclusive de quem está acima dele. Ele continua com dp em
         V$: sem M não lança nada, sem A não fecha a folha. */
      acoes: ['lancar', 'pagar', 'faturar', 'ver_custo', 'estoque', 'requisitar', 'comprar', 'receber',
              'autorizar_faturamento', 'ver_dados_pessoais'],
      modulos: ['financeiro', 'produtividade', 'estoque', 'faturamento', 'compras', 'contratos', 'cadastros', 'procedimentos', 'dp', 'habilitacao'] },
    { id: 'diretoria', nome: 'Diretoria', sistema: true,
      acoes: ['lancar', 'pagar', 'aprovar', 'cancelar', 'estornar', 'faturar', 'ver_custo',
              'estoque', 'requisitar', 'comprar', 'aprovar_compra', 'receber', 'dp', 'ver_dados_pessoais',
              'ver_pacientes', 'autorizar_faturamento', 'liberar_faturamento', 'baixar_ativo', 'ver_doc_socio'],
      modulos: TODOS_MODULOS.filter(function (m) { return m !== 'administracao'; }) },
    { id: 'socio', nome: 'Sócio', sistema: true,
      acoes: ['lancar', 'pagar', 'aprovar', 'cancelar', 'estornar', 'faturar', 'ver_custo',
              'estoque', 'requisitar', 'comprar', 'aprovar_compra', 'receber', 'dp', 'ver_dados_pessoais',
              'ver_pacientes', 'autorizar_faturamento', 'liberar_faturamento', 'baixar_ativo', 'ver_doc_socio'],
      modulos: TODOS_MODULOS },
    { id: 'admin', nome: 'Administração', sistema: true,
      acoes: ACOES.map(function (a) { return a.id; }),
      modulos: TODOS_MODULOS },
    { id: 'consulta', nome: 'Consulta', sistema: true,
      acoes: ['ver_custo'],
      modulos: ['financeiro', 'faturamento', 'contratos', 'habilitacao'] },

    /* Perfis operacionais: material sim, dinheiro não. */
    { id: 'estoquista', nome: 'Controle de estoque',
      acoes: ['estoque', 'requisitar', 'receber', 'ver_pacientes'],
      modulos: ['estoque', 'ativos', 'compras', 'cadastros', 'procedimentos'] },
    { id: 'comprador', nome: 'Compras',
      acoes: ['requisitar', 'comprar', 'receber', 'estoque'],
      modulos: ['estoque', 'ativos', 'compras', 'cadastros'] },
    /* Quem lança a cirurgia está no centro cirúrgico: registra
       procedimento, médico, paciente e material. Não vê dinheiro —
       sem `ver_custo`, some faturamento, repasse, imposto, resultado
       e até o custo unitário do material na tela de lançamento. */
    { id: 'operacional', nome: 'Operacional — centro cirúrgico',
      acoes: ['estoque', 'ver_pacientes'],
      modulos: ['procedimentos'] },

    /* DP vê e mexe no que é de funcionário — não em contas a pagar de
       fornecedor, compra ou conciliação. `ver_dados_pessoais` separa
       CPF/dependente/dado bancário de quem só precisa saber o valor
       da folha (a mesma lógica de `ver_custo` separar dinheiro de
       quem só move material). */
    { id: 'dp', nome: 'Departamento Pessoal',
      acoes: ['dp', 'ver_dados_pessoais'],
      modulos: ['dp', 'cadastros'] },

    /* Produtividade tem gestão própria: lança o fechamento, confirma o
       valor fidedigno, bloqueia médico e confirma o faturamento. NÃO
       paga e NÃO aprova pagamento — é a outra mão do processo. */
    { id: 'produtividade_dir', nome: 'Diretoria de produtividade',
      acoes: ['produtividade', 'lancar', 'faturar', 'autorizar_faturamento', 'ver_custo', 'receber'],
      modulos: ['produtividade', 'faturamento', 'contratos', 'cadastros'] },
    { id: 'produtividade_ger', nome: 'Gerência de produtividade',
      acoes: ['produtividade', 'lancar', 'faturar', 'autorizar_faturamento', 'ver_custo', 'receber'],
      modulos: ['produtividade', 'faturamento', 'contratos', 'cadastros'] }
  ];

  const perfil = id => perfis.find(function (p) { return p.id === id; }) || null;

  const usuarios = [
    { id: 'u1', nome: 'Dayana (assist. financeiro)',  perfil: 'assistente' },
    { id: 'u2', nome: 'Márcia (diretora financeira)', perfil: 'diretoria' },
    { id: 'u3', nome: 'Fellype (sócio)',              perfil: 'socio' },
    { id: 'u4', nome: 'Contabilidade (consulta)',     perfil: 'consulta' },
    { id: 'u5', nome: 'Administrador',                perfil: 'admin' },
    { id: 'u6', nome: 'Monique Cardoso (estoque)',    perfil: 'estoquista' },
    { id: 'u7', nome: 'Compras (a definir)',          perfil: 'comprador' },
    { id: 'u8', nome: 'Carol (DP)',                   perfil: 'dp' },
    { id: 'u9',  nome: 'Romário (assist. financeiro)', perfil: 'assistente' },
    { id: 'u10', nome: 'David (sócio)',                perfil: 'socio' },
    { id: 'u11', nome: 'Bianca (diretoria de produtividade)', perfil: 'produtividade_dir' },
    { id: 'u12', nome: 'Monique Almeida (gerência de produtividade)', perfil: 'produtividade_ger' },
    { id: 'u13', nome: 'Operacional HGB (centro cirúrgico)', perfil: 'operacional', ativo: true }
  ];

  /* CENTROS DE CUSTO.

     Estruturais (matriz, filial, geral) + um registro por LINHA DE
     PROJETO, que é a granularidade real: cada contrato ou serviço tem
     impostos e retenção próprios. "unidade" agrupa as linhas do mesmo
     hospital para leitura e para o fluxo de caixa.

     tipo_servico ... medico | locacao | venda (venda ainda não usada)
     prazo_dias ..... dias a partir do FIM da competência até o caixa
     impostos ....... alíquotas do projeto, em %
     retencao_pct ... quanto o órgão retém na fonte, em %
     prev_faturamento / prev_repasse ... estimativa mensal, que a tela
                      de Previsões usa para preencher qualquer mês */
  const centros = [
    /* Estrutura da empresa — não é projeto: é onde a despesa própria é
       lançada (matriz, filiais e o rateio geral). */
    { id: 'cc100', curto: 'Matriz SP', codigo: '100', nome: 'Matriz — Barueri/SP', tipo: 'matriz', ativo: true,
      cnpj: '34958609000190', cidade: 'Barueri', uf: 'SP' },
    { id: 'cc200', curto: 'Filial RJ', codigo: '200', nome: 'Filial — Petrópolis/RJ', tipo: 'filial', ativo: true,
      cidade: 'Petrópolis', uf: 'RJ' },
    { id: 'cc300', curto: 'Filial CE', codigo: '300', nome: 'Filial — Fortaleza/CE', tipo: 'filial', ativo: true,
      cidade: 'Fortaleza', uf: 'CE' },
    { id: 'cc900', curto: 'Geral', codigo: '900', nome: 'Geral (sem projeto)', tipo: 'geral', ativo: true },

    { id: 'pj01', codigo: '001', curto: 'PRISIONAL', nome: 'PRISIONAL', unidade: 'Fortaleza', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 30, produtividade: true, impostos: { iss: 2, iss_ce: 3, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 7.8, prev_faturamento: 22868.84, prev_repasse: 16646.0, aliases: ['PRISIONAL'], aliases_linha: [], cliente: 'cl08' },
    { id: 'pj02', codigo: '002', curto: 'CIDH', nome: 'CIDH', unidade: 'Fortaleza', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 30, produtividade: true, impostos: { iss: 2, iss_ce: 3, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 7.8, prev_faturamento: 21562.05, prev_repasse: 32883.4, aliases: ['CIDH'], aliases_linha: [], cliente: 'cl16' },
    { id: 'pj03', codigo: '003', curto: 'CDERM', nome: 'CDERM', unidade: 'Fortaleza', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 30, produtividade: true, impostos: { iss: 2, iss_ce: 3, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 7.8, prev_faturamento: 4900.47, prev_repasse: 4500.0, aliases: ['CDERM'], aliases_linha: [], cliente: 'cl17' },
    { id: 'pj04', codigo: '004', curto: 'CCAD', nome: 'CCAD', unidade: 'Fortaleza', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 30, produtividade: true, impostos: { iss: 2, iss_ce: 3, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 7.8, prev_faturamento: 11761.12, prev_repasse: 9600.78, aliases: ['CCAD'], aliases_linha: [], cliente: 'cl18' },
    { id: 'pj05', codigo: '005', curto: 'HSMM', nome: 'HSMM', unidade: 'Fortaleza', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 30, produtividade: true, impostos: { iss: 2, iss_ce: 3, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 7.8, prev_faturamento: 110750.54, prev_repasse: 92950.0, aliases: ['HSMM'], aliases_linha: [], cliente: 'cl19' },
    { id: 'pj06', codigo: '006', curto: 'HEMOCE', nome: 'HEMOCE', unidade: 'Fortaleza', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 30, produtividade: true, impostos: { iss: 2, iss_ce: 3, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 7.87, prev_faturamento: 29577.04, prev_repasse: 23244.7, aliases: ['HEMOCE', 'HEMATOLOGIA'], aliases_linha: [], cliente: 'cl07' },
    { id: 'pj07', codigo: '007', curto: 'IJF', nome: 'IJF', unidade: 'Fortaleza', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 30, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 5.73, prev_faturamento: 93519.84, prev_repasse: 69800.0, aliases: ['JOSE FROTA', 'JOSÉ FROTA', 'IJF'], aliases_linha: [], cliente: 'cl06' },
    { id: 'pj08', codigo: '008', curto: 'SCFORT - Tomografia', nome: 'SCFORT - Tomografia', unidade: 'Fortaleza', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 30, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 0, prev_faturamento: 358082.89, prev_repasse: 0, aliases: ['SCFORT', 'MISERICÓRDIA DE FORTALEZA', 'MISERICORDIA DE FORTALEZA'], aliases_linha: ['TOMOGRAFIA'], cliente: 'cl05' },
    { id: 'pj09', codigo: '009', curto: 'GHC - UPA', nome: 'GHC - UPA', unidade: 'POA', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 30, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 5.85, prev_faturamento: 323876.8, prev_repasse: 261183.32, aliases: [], aliases_linha: ['UPA'], cliente: 'cl04' },
    { id: 'pj10', codigo: '010', curto: 'GHC - ANESTESIA POA', nome: 'GHC - ANESTESIA POA', unidade: 'GHC - Anestesia POA', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 40, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 0, prev_faturamento: 0, prev_repasse: 0, aliases: ['CONCEIÇÃO', 'CONCEICAO'], aliases_linha: ['ANESTESIA', 'ANESTESIOLOGIA'], cliente: 'cl04' },
    /* As 8 especialidades do HGB são projetos separados (cada uma tem
       sua produtividade e seu repasse), mas o hospital emite UMA nota
       para todas: `grupo_faturamento` amarra isso. */
    { id: 'pj11', codigo: '011', curto: 'GHC - HGB ANESTESIA', nome: 'GHC - HGB — Anestesia', unidade: 'Bonsucesso', tipo: 'projeto', grupo_faturamento: 'GHC - HGB', tipo_servico: 'medico', ativo: true, prazo_dias: 40, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 5.85, prev_faturamento: 2043819.83, prev_repasse: 2086900.0, aliases: ['BONSUCESSO', 'HOSPITAL FEDERAL DE BONSUCESSO'], aliases_linha: [], cliente: 'cl03' },
    { id: 'pj44', codigo: '044', curto: 'GHC - HGB CARDIOLOGIA', nome: 'GHC - HGB — Cardiologia', unidade: 'Bonsucesso', tipo: 'projeto', grupo_faturamento: 'GHC - HGB', tipo_servico: 'medico', ativo: true, prazo_dias: 40, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 5.85, prev_faturamento: 0, prev_repasse: 0, aliases: ['BONSUCESSO', 'HOSPITAL FEDERAL DE BONSUCESSO'], aliases_linha: ['CARDIOLOGIA'], cliente: 'cl03' },
    { id: 'pj45', codigo: '045', curto: 'GHC - HGB CTI PEDIATRICA', nome: 'GHC - HGB — CTI Pediátrica', unidade: 'Bonsucesso', tipo: 'projeto', grupo_faturamento: 'GHC - HGB', tipo_servico: 'medico', ativo: true, prazo_dias: 40, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 5.85, prev_faturamento: 0, prev_repasse: 0, aliases: ['BONSUCESSO', 'HOSPITAL FEDERAL DE BONSUCESSO'], aliases_linha: ['CTI PEDIÁTRICA'], cliente: 'cl03' },
    { id: 'pj46', codigo: '046', curto: 'GHC - HGB EMERGENCIA ADULTO', nome: 'GHC - HGB — Emergência adulto', unidade: 'Bonsucesso', tipo: 'projeto', grupo_faturamento: 'GHC - HGB', tipo_servico: 'medico', ativo: true, prazo_dias: 40, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 5.85, prev_faturamento: 0, prev_repasse: 0, aliases: ['BONSUCESSO', 'HOSPITAL FEDERAL DE BONSUCESSO'], aliases_linha: ['EMERGÊNCIA ADULTO'], cliente: 'cl03' },
    { id: 'pj47', codigo: '047', curto: 'GHC - HGB EMERGENCIA PEDIATRICA', nome: 'GHC - HGB — Emergência pediátrica', unidade: 'Bonsucesso', tipo: 'projeto', grupo_faturamento: 'GHC - HGB', tipo_servico: 'medico', ativo: true, prazo_dias: 40, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 5.85, prev_faturamento: 0, prev_repasse: 0, aliases: ['BONSUCESSO', 'HOSPITAL FEDERAL DE BONSUCESSO'], aliases_linha: ['EMERGÊNCIA PEDIÁTRICA'], cliente: 'cl03' },
    { id: 'pj48', codigo: '048', curto: 'GHC - HGB MEDICINA INTERNA', nome: 'GHC - HGB — Medicina interna', unidade: 'Bonsucesso', tipo: 'projeto', grupo_faturamento: 'GHC - HGB', tipo_servico: 'medico', ativo: true, prazo_dias: 40, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 5.85, prev_faturamento: 0, prev_repasse: 0, aliases: ['BONSUCESSO', 'HOSPITAL FEDERAL DE BONSUCESSO'], aliases_linha: ['MEDICINA INTERNA'], cliente: 'cl03' },
    { id: 'pj49', codigo: '049', curto: 'GHC - HGB CORONARIANA', nome: 'GHC - HGB — Coronariana', unidade: 'Bonsucesso', tipo: 'projeto', grupo_faturamento: 'GHC - HGB', tipo_servico: 'medico', ativo: true, prazo_dias: 40, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 5.85, prev_faturamento: 0, prev_repasse: 0, aliases: ['BONSUCESSO', 'HOSPITAL FEDERAL DE BONSUCESSO'], aliases_linha: ['CORONARIANA'], cliente: 'cl03' },
    /* O mutirão fatura em nota própria: não entra no faturamento único
       das especialidades do HGB. */
    { id: 'pj50', codigo: '050', curto: 'GHC - HGB MUTIRAO', nome: 'GHC - HGB — Mutirão', unidade: 'Bonsucesso', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 40, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 5.85, prev_faturamento: 0, prev_repasse: 0, aliases: ['BONSUCESSO', 'HOSPITAL FEDERAL DE BONSUCESSO'], aliases_linha: ['MUTIRÃO'], cliente: 'cl03' },
    /* Subprojetos do mutirão, um por especialidade — mesmo desenho do
       GHC - HGB: a nota é uma só (o grupo), mas o faturamento e o
       repasse de cada especialidade ficam separados, que é como o
       resultado é lido e como o médico é pago. Os procedimentos
       lançados alimentam a previsão de cada um. */
    { id: 'pj51', codigo: '050.1', curto: 'HGB MUTIRAO OFTALMO', nome: 'GHC - HGB Mutirão — Oftalmologia', unidade: 'Bonsucesso', especialidade_pate: 'OFTALMO', tipo: 'projeto', grupo_faturamento: 'GHC - HGB MUTIRAO', tipo_servico: 'medico', ativo: true, prazo_dias: 40, produtividade: false, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 5.85, prev_faturamento: 0, prev_repasse: 0, aliases: ['BONSUCESSO', 'HOSPITAL FEDERAL DE BONSUCESSO'], aliases_linha: [], cliente: 'cl03' },
    { id: 'pj52', codigo: '050.2', curto: 'HGB MUTIRAO CIR GERAL', nome: 'GHC - HGB Mutirão — Cirurgia geral', unidade: 'Bonsucesso', especialidade_pate: 'CIRURGIA GERAL', tipo: 'projeto', grupo_faturamento: 'GHC - HGB MUTIRAO', tipo_servico: 'medico', ativo: true, prazo_dias: 40, produtividade: false, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 5.85, prev_faturamento: 0, prev_repasse: 0, aliases: ['BONSUCESSO', 'HOSPITAL FEDERAL DE BONSUCESSO'], aliases_linha: [], cliente: 'cl03' },
    { id: 'pj53', codigo: '050.3', curto: 'HGB MUTIRAO UROLOGIA', nome: 'GHC - HGB Mutirão — Urologia', unidade: 'Bonsucesso', especialidade_pate: 'UROLOGIA', tipo: 'projeto', grupo_faturamento: 'GHC - HGB MUTIRAO', tipo_servico: 'medico', ativo: true, prazo_dias: 40, produtividade: false, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 5.85, prev_faturamento: 0, prev_repasse: 0, aliases: ['BONSUCESSO', 'HOSPITAL FEDERAL DE BONSUCESSO'], aliases_linha: [], cliente: 'cl03' },
    { id: 'pj54', codigo: '050.4', curto: 'HGB MUTIRAO OTORRINO', nome: 'GHC - HGB Mutirão — Otorrinolaringologia', unidade: 'Bonsucesso', especialidade_pate: 'OTORRINO', tipo: 'projeto', grupo_faturamento: 'GHC - HGB MUTIRAO', tipo_servico: 'medico', ativo: true, prazo_dias: 40, produtividade: false, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 5.85, prev_faturamento: 0, prev_repasse: 0, aliases: ['BONSUCESSO', 'HOSPITAL FEDERAL DE BONSUCESSO'], aliases_linha: [], cliente: 'cl03' },
    { id: 'pj55', codigo: '050.5', curto: 'HGB MUTIRAO GINECO', nome: 'GHC - HGB Mutirão — Ginecologia', unidade: 'Bonsucesso', especialidade_pate: 'GINECO', tipo: 'projeto', grupo_faturamento: 'GHC - HGB MUTIRAO', tipo_servico: 'medico', ativo: true, prazo_dias: 40, produtividade: false, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 5.85, prev_faturamento: 0, prev_repasse: 0, aliases: ['BONSUCESSO', 'HOSPITAL FEDERAL DE BONSUCESSO'], aliases_linha: [], cliente: 'cl03' },
    { id: 'pj56', codigo: '050.6', curto: 'HGB MUTIRAO RISCO CX', nome: 'GHC - HGB Mutirão — Risco cirúrgico', unidade: 'Bonsucesso', especialidade_pate: 'RISCO CX', tipo: 'projeto', grupo_faturamento: 'GHC - HGB MUTIRAO', tipo_servico: 'medico', ativo: true, prazo_dias: 40, produtividade: false, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 5.85, prev_faturamento: 0, prev_repasse: 0, aliases: ['BONSUCESSO', 'HOSPITAL FEDERAL DE BONSUCESSO'], aliases_linha: [], cliente: 'cl03' },
    { id: 'pj12', codigo: '012', curto: 'IRON TRAINERS - Enfermagem', nome: 'IRON TRAINERS - Enfermagem', unidade: 'Iron Trainers', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 20, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 0, prev_faturamento: 58545.58, prev_repasse: 32907.6, aliases: ['IRON'], aliases_linha: ['ENFERMAGEM'], cliente: 'cl12' },
    { id: 'pj13', codigo: '013', curto: 'IRON TRAINERS - FUP', nome: 'IRON TRAINERS - FUP', unidade: 'Iron Trainers', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 20, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 6.73, prev_faturamento: 97.6, prev_repasse: 188.3, aliases: [], aliases_linha: ['FUP'], cliente: 'cl12' },
    { id: 'pj14', codigo: '014', curto: 'IRON TRAINERS - Psicólogo', nome: 'IRON TRAINERS - Psicólogo', unidade: 'Iron Trainers', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 20, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 0, prev_faturamento: 4698.56, prev_repasse: 3876.31, aliases: [], aliases_linha: ['PSICOLOG'], cliente: 'cl12' },
    { id: 'pj15', codigo: '015', curto: 'IRON TRAINERS - AGP', nome: 'IRON TRAINERS - AGP', unidade: 'Iron Trainers', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 20, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 0, prev_faturamento: 1272.73, prev_repasse: 602.8, aliases: [], aliases_linha: ['AGP'], cliente: 'cl12' },
    { id: 'pj16', codigo: '016', curto: 'HMTSM - PJ', nome: 'HMTSM - PJ', unidade: 'HMTSM', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 30, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 6.8, prev_faturamento: 216000.51, prev_repasse: 113587.5, aliases: ['HMTSM', 'MADRE MICHEL'], aliases_linha: [], cliente: 'cl15' },
    { id: 'pj17', codigo: '017', curto: 'HMTSM - Multidisciplinares', nome: 'HMTSM - Multidisciplinares', unidade: 'HMTSM', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 30, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 15.8, prev_faturamento: 0, prev_repasse: 0, aliases: [], aliases_linha: ['MULTIDISCIPLINAR'], cliente: 'cl15' },
    { id: 'pj18', codigo: '018', curto: 'AGIR - HMSA - CIR GERAL', nome: 'AGIR - HMSA - CIR GERAL', unidade: 'Sant\'ana', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 35, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 6.15, prev_faturamento: 0, prev_repasse: 0, aliases: [], aliases_linha: ['CIRURGIA GERAL', 'CIR GERAL'], cliente: 'cl01' },
    { id: 'pj19', codigo: '019', curto: 'AGIR - HMSA - GO', nome: 'AGIR - HMSA - GO', unidade: 'Sant\'ana', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 35, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 6.15, prev_faturamento: 213427.2, prev_repasse: 157250.0, aliases: ['AGIR', 'HMSA', 'SANTA ANA'], aliases_linha: ['GINECOLOGIA', 'OBSTETRICIA'], cliente: 'cl01' },
    { id: 'pj20', codigo: '020', curto: 'AGIR - HMSA - ANESTESIA', nome: 'AGIR - HMSA - ANESTESIA', unidade: 'Sant\'ana', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 35, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 6.15, prev_faturamento: 355713.6, prev_repasse: 256400.0, aliases: [], aliases_linha: ['ANESTESIA', 'ANESTESIOLOGIA'], cliente: 'cl01' },
    { id: 'pj21', codigo: '021', curto: 'AGIR - HMSA - NEO', nome: 'AGIR - HMSA - NEO', unidade: 'Sant\'ana', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 35, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 6.15, prev_faturamento: 327600, prev_repasse: 256400.0, aliases: [], aliases_linha: ['NEONATOLOGIA', 'NEONATAL'], cliente: 'cl01' },
    { id: 'pj22', codigo: '022', curto: 'IBD SOCIAL - SAMU', nome: 'IBD SOCIAL - SAMU', unidade: 'Petrópolis', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 30, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 6.15, prev_faturamento: 387223.52, prev_repasse: 289600.0, aliases: ['IBDSOCIAL', 'SAMU', 'CIS-SERRA'], aliases_linha: [], cliente: 'cl09' },
    { id: 'pj23', codigo: '023', curto: 'SCBM - ANESTESIA', nome: 'SCBM - ANESTESIA', unidade: 'SCBM', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 40, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 6.15, prev_faturamento: 435765.29, prev_repasse: 321200.0, aliases: ['BARRA MANSA'], aliases_linha: ['ANESTESIA', 'ANESTESIOLOGIA'], cliente: 'cl02' },
    { id: 'pj24', codigo: '024', curto: 'SCBM - NEO', nome: 'SCBM - NEO', unidade: 'SCBM', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 40, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 6.15, prev_faturamento: 265036.5, prev_repasse: 190800.0, aliases: [], aliases_linha: ['NEONATOLOGIA', 'NEONATAL'], cliente: 'cl02' },
    { id: 'pj25', codigo: '025', curto: 'SCBM - CIR GERAL', nome: 'SCBM - CIR GERAL', unidade: 'SCBM', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 40, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 6.15, prev_faturamento: 177696.23, prev_repasse: 132000.0, aliases: [], aliases_linha: ['CIRURGIA GERAL', 'CIR GERAL'], cliente: 'cl02' },
    { id: 'pj26', codigo: '026', curto: 'SCBM - ANESTESIA PARTICULARES/CONVÊNIOS', nome: 'SCBM - ANESTESIA PARTICULARES/CONVÊNIOS', unidade: 'SCBM', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 40, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 6.73, prev_faturamento: 0, prev_repasse: 0, aliases: [], aliases_linha: ['PARTICULARES', 'CONVENIO'], cliente: 'cl02' },
    { id: 'pj27', codigo: '027', curto: 'SCBM - PEDIATRIA', nome: 'SCBM - PEDIATRIA', unidade: 'SCBM', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 40, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 6.15, prev_faturamento: 84000, prev_repasse: 77000.0, aliases: [], aliases_linha: ['PEDIATRIA'], cliente: 'cl02' },
    { id: 'pj28', codigo: '028', curto: 'HMSM - POA', nome: 'HMSM - POA', unidade: 'HMSM', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 20, produtividade: true, impostos: { iss: 2, iss_ce: 0, pis_cofins: 3.65, irpj: 2.0, csll: 1.08 }, retencao_pct: 0, prev_faturamento: 94399.2, prev_repasse: 73400.0, aliases: ['SALDANHA MARINHO'], aliases_linha: [], cliente: 'cl20' },
    { id: 'pj29', codigo: '029', curto: 'HNSN - Navegantes', nome: 'HNSN - Navegantes', unidade: 'HNSN', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 60, produtividade: true, impostos: { iss: 2, iss_ce: 0, pis_cofins: 3.65, irpj: 2.0, csll: 1.08 }, retencao_pct: 0, prev_faturamento: 190800, prev_repasse: 140400.0, aliases: ['NAVEGANTES', 'NOSSA SENHORA'], aliases_linha: [], cliente: 'cl10' },
    { id: 'pj30', codigo: '030', curto: 'Dr. Consulta - USG', nome: 'Dr. Consulta - USG', unidade: 'Dr. Consulta', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 30, produtividade: true, impostos: { iss: 2, iss_ce: 0, pis_cofins: 3.65, irpj: 2.0, csll: 1.08 }, retencao_pct: 6.15, prev_faturamento: 35122.25, prev_repasse: 21251.67, aliases: ['CONSULTA', 'DRCONSULTA'], aliases_linha: ['ULTRASSO', 'USG'], cliente: 'cl14' },
    { id: 'pj31', codigo: '031', curto: 'SPDM - Lusmar', nome: 'SPDM - Lusmar', unidade: 'SPDM', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 30, produtividade: true, impostos: { iss: 2, iss_ce: 0, pis_cofins: 3.65, irpj: 2.0, csll: 1.08 }, retencao_pct: 9.8, prev_faturamento: 5490, prev_repasse: 5428.0, aliases: ['SPDM', 'PAIS'], aliases_linha: ['LUSMAR'], cliente: 'cl13' },
    { id: 'pj32', codigo: '032', curto: 'SPDM - Randal', nome: 'SPDM - Randal', unidade: 'SPDM', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 30, produtividade: true, impostos: { iss: 2, iss_ce: 0, pis_cofins: 3.65, irpj: 2.0, csll: 1.08 }, retencao_pct: 9.8, prev_faturamento: 7680, prev_repasse: 6986.0, aliases: [], aliases_linha: ['RANDAL'], cliente: 'cl13' },
    { id: 'pj33', empresa: 'emp3', codigo: '033', curto: 'CETHID - NOVAPED', nome: 'CETHID - NOVAPED', unidade: 'Maternidade Queimados', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 30, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 6.73, prev_faturamento: 289293.88, prev_repasse: 235735.6, aliases: ['CETHID'], aliases_linha: ['CETHID'], cliente: 'cl21' },
    { id: 'pj34', empresa: 'emp3', codigo: '034', curto: 'HMMQ - NOVAPED', nome: 'HMMQ - NOVAPED', unidade: 'Maternidade Queimados', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 30, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 6.73, prev_faturamento: 720575.78, prev_repasse: 551200.0, aliases: ['HMMQ', 'QUEIMADOS'], aliases_linha: ['HMMQ'], cliente: 'cl22' },
    { id: 'pj35', empresa: 'emp3', codigo: '035', curto: 'HMMQ MULTI - NOVAPED', nome: 'HMMQ MULTI - NOVAPED', unidade: 'Maternidade Queimados', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 30, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 6.73, prev_faturamento: 506248.78, prev_repasse: 244586.93, aliases: [], aliases_linha: ['MULTIDISCIPLINAR', 'MULTI'], cliente: 'cl22' },
    { id: 'pj36', codigo: '036', curto: 'IPADE/UNICRISTUS', nome: 'IPADE/UNICRISTUS', unidade: 'Fortaleza', tipo: 'projeto', tipo_servico: 'locacao', ativo: true, prazo_dias: 30, produtividade: false, impostos: { pis_cofins: 3.65, irpj: 8.0, csll: 2.88 }, retencao_pct: 0, prev_faturamento: 0, prev_repasse: 0, aliases: ['UNICRISTUS', 'IPADE'], aliases_linha: [], cliente: 'cl23' },
    { id: 'pj37', codigo: '037', curto: 'Fund. Edson Queiroz/UNIFOR', nome: 'Fund. Edson Queiroz/UNIFOR', unidade: 'Fortaleza', tipo: 'projeto', tipo_servico: 'locacao', ativo: true, prazo_dias: 30, produtividade: false, impostos: { pis_cofins: 3.65, irpj: 8.0, csll: 2.88 }, retencao_pct: 0, prev_faturamento: 104700, prev_repasse: 0, aliases: ['UNIFOR', 'EDSON QUEIROZ'], aliases_linha: [], itens_locacao: [{ descricao: 'Cama hospitalar Fowler', qtd: 30, valor_unit: 2200 }, { descricao: 'Berço aquecido', qtd: 6, valor_unit: 3400 }, { descricao: 'Bomba de infusão', qtd: 12, valor_unit: 950 }], cliente: 'cl24' },
    { id: 'pj38', codigo: '038', curto: 'SCFORT - Intensificador', nome: 'SCFORT - Intensificador', unidade: 'Fortaleza', tipo: 'projeto', tipo_servico: 'locacao', ativo: true, prazo_dias: 30, produtividade: false, impostos: { pis_cofins: 3.65, irpj: 8.0, csll: 2.88 }, retencao_pct: 0, prev_faturamento: 14000, prev_repasse: 0, aliases: [], aliases_linha: ['INTENSIFICADOR'], itens_locacao: [{ descricao: 'Intensificador de imagem (arco cirúrgico)', qtd: 1, valor_unit: 14000 }], cliente: 'cl05' },
    { id: 'pj39', codigo: '039', curto: 'SCFORT - Intensificador GE OEC', nome: 'SCFORT - Intensificador GE OEC', unidade: 'Fortaleza', tipo: 'projeto', tipo_servico: 'locacao', ativo: true, prazo_dias: 30, produtividade: false, impostos: { pis_cofins: 3.65, irpj: 8.0, csll: 2.88 }, retencao_pct: 0, prev_faturamento: 0, prev_repasse: 0, aliases: [], aliases_linha: ['GE OEC'], cliente: 'cl05' },
    { id: 'pj40', codigo: '040', curto: 'SCFORT - Mesa Cirúrgica', nome: 'SCFORT - Mesa Cirúrgica', unidade: 'Fortaleza', tipo: 'projeto', tipo_servico: 'locacao', ativo: true, prazo_dias: 30, produtividade: false, impostos: { pis_cofins: 3.65, irpj: 8.0, csll: 2.88 }, retencao_pct: 0, prev_faturamento: 5000, prev_repasse: 0, aliases: [], aliases_linha: ['MESA CIRURGICA'], cliente: 'cl05' },
    { id: 'pj41', codigo: '041', curto: 'Nilópolis - Santa Casa', nome: 'Nilópolis - Santa Casa', unidade: 'Nilópolis', tipo: 'projeto', tipo_servico: 'locacao', ativo: true, prazo_dias: 25, produtividade: false, impostos: { pis_cofins: 3.65, irpj: 8.0, csll: 2.88 }, retencao_pct: 0, prev_faturamento: 227343.74, prev_repasse: 0, aliases: ['NILÓPOLIS', 'NILOPOLIS'], aliases_linha: [], cliente: 'cl25' },
    { id: 'pj42', codigo: '042', curto: 'Moacyr do Carmo - Diálise', nome: 'Moacyr do Carmo - Diálise', unidade: 'Duque de Caxias', tipo: 'projeto', tipo_servico: 'locacao', ativo: true, prazo_dias: 30, produtividade: false, impostos: { pis_cofins: 3.65, irpj: 8.0, csll: 2.88 }, retencao_pct: 0, prev_faturamento: 21600, prev_repasse: 0, aliases: ['MOACYR', 'CAXIAS'], aliases_linha: [], cliente: 'cl26' },
    /* Contrato novo — sem histórico de faturamento ainda. Impostos e
       retenção replicam o outro contrato de SAMU (pj22, Petrópolis) só
       como ponto de partida; confirmar os números reais deste
       contrato específico de Nova Friburgo antes do primeiro
       faturamento. */
    { id: 'pj43', codigo: '043', curto: 'SAMU - Nova Friburgo', nome: 'SAMU - Nova Friburgo', unidade: 'Nova Friburgo', tipo: 'projeto', tipo_servico: 'medico', ativo: true, prazo_dias: 30, produtividade: true, impostos: { iss: 2, pis_cofins: 3.65, irpj: 2.2, csll: 1.19 }, retencao_pct: 6.15, prev_faturamento: 0, prev_repasse: 0, aliases: ['NOVA FRIBURGO'], aliases_linha: [], cliente: 'cl27' }
  ];

  const TIPOS_SERVICO = { medico: 'Serviços médicos', locacao: 'Locações', venda: 'Venda de material' };
  const unidades = () => Array.from(new Set(centros.filter(function (c) { return c.unidade; })
    .map(function (c) { return c.unidade; }))).sort();

  /* Plano de contas — estrutura do DRE gerencial da empresa.
     Nível 1 = grupo (não recebe lançamento), nível 2 = subgrupo. */
  const plano = [
{ cod: '1', nome: 'Receita operacional', nivel: 1, tipo: 'receita' },
    { cod: '1.01', nome: 'Serviços médicos', nivel: 2, pai: '1' },
    { cod: '1.02', nome: 'Locação de equipamentos', nivel: 2, pai: '1' },
    { cod: '1.03', nome: 'Outras receitas', nivel: 2, pai: '1' },
    /* Venda de equipamento não é receita de serviço: no Lucro
       Presumido é tributada à parte, sobre o ganho de capital. Deixar
       na 1.01 inflava a receita operacional no DRE e puxava PIS,
       COFINS e ISS indevidos. */
    { cod: '1.04', nome: 'Alienação de imobilizado', nivel: 2, pai: '1', nao_operacional: true },

    { cod: '2', nome: 'Impostos de venda', nivel: 1, tipo: 'deducao' },
    { cod: '2.01', nome: 'ISS', nivel: 2, pai: '2' },
    { cod: '2.02', nome: 'PIS', nivel: 2, pai: '2' },
    { cod: '2.03', nome: 'COFINS', nivel: 2, pai: '2' },
    { cod: '2.04', nome: 'IRPJ', nivel: 2, pai: '2' },
    { cod: '2.05', nome: 'CSLL', nivel: 2, pai: '2' },
    { cod: '2.06', nome: 'ICMS', nivel: 2, pai: '2' },
    { cod: '2.07', nome: 'Parcelamentos de impostos', nivel: 2, pai: '2' },
    { cod: '2.08', nome: 'Outros impostos', nivel: 2, pai: '2' },

    { cod: '3', nome: 'Custos diretos', nivel: 1, tipo: 'custo' },
    { cod: '3.01', nome: 'Serviços médicos — produção', nivel: 2, pai: '3' },
    { cod: '3.02', nome: 'Custos de locações', nivel: 2, pai: '3' },
    { cod: '3.03', nome: 'Outros custos diretos', nivel: 2, pai: '3' },

    { cod: '4', nome: 'Despesas com pessoal', nivel: 1, tipo: 'despesa' },
    { cod: '4.01', nome: 'Folha de pagamento', nivel: 2, pai: '4' },
    { cod: '4.02', nome: 'Benefícios', nivel: 2, pai: '4' },
    { cod: '4.03', nome: 'FGTS', nivel: 2, pai: '4' },
    { cod: '4.04', nome: 'INSS', nivel: 2, pai: '4' },
    { cod: '4.05', nome: 'Férias', nivel: 2, pai: '4' },
    { cod: '4.06', nome: '13º salário', nivel: 2, pai: '4' },
    { cod: '4.07', nome: 'Rescisões', nivel: 2, pai: '4' },
    { cod: '4.08', nome: 'Outros encargos', nivel: 2, pai: '4' },

    { cod: '5', nome: 'Despesas com P&D', nivel: 1, tipo: 'despesa' },
    { cod: '5.01', nome: 'Desenvolvimento de software — telemedicina', nivel: 2, pai: '5' },

    { cod: '6', nome: 'Despesas administrativas', nivel: 1, tipo: 'despesa' },
    { cod: '6.01', nome: 'Aluguéis', nivel: 2, pai: '6' },
    { cod: '6.02', nome: 'Certificações', nivel: 2, pai: '6' },
    { cod: '6.03', nome: 'Honorários contábeis', nivel: 2, pai: '6' },
    { cod: '6.04', nome: 'Honorários de consultoria', nivel: 2, pai: '6' },
    { cod: '6.05', nome: 'Despesas com viagens', nivel: 2, pai: '6' },
    { cod: '6.06', nome: 'Reembolsos', nivel: 2, pai: '6' },
    { cod: '6.07', nome: 'Manutenção e conservação', nivel: 2, pai: '6' },
    { cod: '6.08', nome: 'Segurança e rastreamento', nivel: 2, pai: '6' },
    { cod: '6.09', nome: 'Cartão corporativo', nivel: 2, pai: '6' },
    { cod: '6.10', nome: 'Ativo fixo', nivel: 2, pai: '6' },
    { cod: '6.11', nome: 'Outros', nivel: 2, pai: '6' },

    { cod: '7', nome: 'Tecnologia da informação', nivel: 1, tipo: 'despesa' },
    { cod: '7.01', nome: 'Sistemas de gestão (ERP)', nivel: 2, pai: '7' },
    { cod: '7.02', nome: 'Software médico', nivel: 2, pai: '7' },
    { cod: '7.03', nome: 'Sistemas / TI', nivel: 2, pai: '7' },
    { cod: '7.04', nome: 'Telecomunicações', nivel: 2, pai: '7' },

    { cod: '8', nome: 'Despesas operacionais', nivel: 1, tipo: 'despesa' },
    { cod: '8.01', nome: 'Locação de veículos', nivel: 2, pai: '8' },
    { cod: '8.02', nome: 'Financiamentos', nivel: 2, pai: '8' },
    { cod: '8.03', nome: 'Energia elétrica', nivel: 2, pai: '8' },
    { cod: '8.04', nome: 'Material médico-hospitalar', nivel: 2, pai: '8' },
    { cod: '8.05', nome: 'Frete e logística', nivel: 2, pai: '8' },
    { cod: '8.06', nome: 'Outros', nivel: 2, pai: '8' },

    { cod: '9', nome: 'Despesas financeiras', nivel: 1, tipo: 'despesa' },
    { cod: '9.01', nome: 'Despesa bancária', nivel: 2, pai: '9' },
    { cod: '9.02', nome: 'Empréstimos e financiamentos', nivel: 2, pai: '9' },
    { cod: '9.03', nome: 'Encargos financeiros', nivel: 2, pai: '9' },
    { cod: '9.04', nome: 'Juros de atraso', nivel: 2, pai: '9' },

    { cod: '10', nome: 'Aportes e retiradas', nivel: 1, tipo: 'nao_operacional' },
    { cod: '10.01', nome: 'Retiradas de sócios', nivel: 2, pai: '10' },
    { cod: '10.02', nome: 'Aportes de sócios', nivel: 2, pai: '10' }
  ];

  // conta para onde juros e multa de atraso vão automaticamente na baixa
  const contaJuros = '9.04';
  /* Cadastro de clientes. É AQUI que o sistema decide o projeto e o
     prazo de recebimento de cada nota — por CNPJ, não por palpite no
     nome. E é aqui que ficam as alíquotas de retenção: o que vem
     destacado na NF costuma não refletir o contrato.
     prazo_dias vazio herda o prazo do projeto. */
  const clientes = [
    { id: 'cl01', documento: '05029600000287', nome: 'AGIR — Ass. de Gestão, Inovação e Resultados em Saúde',
      centro_padrao: 'pj19', prazo_dias: 35,
      endereco: 'AV DAS AMERICAS', numero: '3500', bairro: 'BARRA DA TIJUCA',
      cidade: 'RIO DE JANEIRO', uf: 'RJ', cep: '22640102', codigo_ibge: '3304557',
      email: 'faturamento@agir.org.br',
      retencoes: [{ tributo: 'IRRF', aliquota: 1.5 }, { tributo: 'PIS', aliquota: 0.65 },
                  { tributo: 'COFINS', aliquota: 3 }, { tributo: 'CSLL', aliquota: 1 }] },
    { id: 'cl02', documento: '28683712000171', nome: 'Santa Casa de Misericórdia de Barra Mansa',
      centro_padrao: 'pj23', prazo_dias: 40, retencoes: [] },
    { id: 'cl03', documento: '92787118002416', nome: 'Grupo Hospitalar Conceição — Hospital Federal de Bonsucesso',
      centro_padrao: 'pj11', prazo_dias: 40, retencoes: [] },
    { id: 'cl04', documento: '92787118000553', nome: 'Grupo Hospitalar Conceição S.A.',
      centro_padrao: 'pj10', prazo_dias: 40, retencoes: [] },
    { id: 'cl05', documento: '07273592000164', nome: 'Irmandade Beneficente da Santa Casa da Misericórdia de Fortaleza',
      centro_padrao: 'pj08', prazo_dias: 30, retencoes: [] },
    { id: 'cl06', documento: '07835044000180', nome: 'Instituto Dr. José Frota — IJF',
      centro_padrao: 'pj07', prazo_dias: 30, retencoes: [] },
    { id: 'cl07', documento: '07954571011491', nome: 'Centro de Hematologia e Hemoterapia do Ceará — HEMOCE',
      centro_padrao: 'pj06', prazo_dias: 30, retencoes: [] },
    { id: 'cl08', documento: '01790944003350', nome: 'Polícia Militar do Ceará',
      centro_padrao: 'pj01', prazo_dias: 30, retencoes: [] },
    { id: 'cl09', documento: '05843874000124', nome: 'IBDSOCIAL',
      centro_padrao: 'pj22', prazo_dias: 30, retencoes: [] },
    { id: 'cl10', documento: '07836454000146', nome: 'Instituto Brasileiro de Saúde, Ensino, Pesquisa e Extensão',
      centro_padrao: 'pj29', prazo_dias: 60, retencoes: [] },
    { id: 'cl11', documento: '07836454002009', nome: 'Inst. Bras. de Saúde, Ensino, Pesq. e Extensão (filial)',
      centro_padrao: 'pj29', prazo_dias: 60, retencoes: [] },
    { id: 'cl12', documento: '21298287000158', nome: 'Iron Trainers do Brasil Ltda',
      centro_padrao: 'pj12', prazo_dias: 20, retencoes: [] },
    { id: 'cl13', documento: '61699567009300', nome: 'SPDM/PAIS — Ass. Paulista para o Desenvolvimento da Medicina',
      centro_padrao: 'pj31', prazo_dias: null, retencoes: [] },
    { id: 'cl14', documento: '14245016000179', nome: 'Dr. Consulta Centro Médico Ltda',
      centro_padrao: 'pj30', prazo_dias: null, retencoes: [] },
    { id: 'cl15', documento: '22351316000160', nome: 'Sociedade de Caridade — Santa Casa de Misericórdia Madre Michel',
      centro_padrao: 'pj16', prazo_dias: null, retencoes: [] },
    /* Clientes criados a partir do NOME DO PROJETO: contratos cujo
       tomador não tinha cadastro próprio. Sem CNPJ por enquanto — o
       financeiro completa quando for emitir nota para eles. */
    { id: 'cl16', documento: '', nome: 'CIDH',
      centro_padrao: 'pj02', prazo_dias: null, retencoes: [] },
    { id: 'cl17', documento: '', nome: 'CDERM',
      centro_padrao: 'pj03', prazo_dias: null, retencoes: [] },
    { id: 'cl18', documento: '', nome: 'CCAD',
      centro_padrao: 'pj04', prazo_dias: null, retencoes: [] },
    { id: 'cl19', documento: '', nome: 'HSMM',
      centro_padrao: 'pj05', prazo_dias: null, retencoes: [] },
    { id: 'cl20', documento: '', nome: 'HMSM - POA',
      centro_padrao: 'pj28', prazo_dias: null, retencoes: [] },
    { id: 'cl21', documento: '', nome: 'CETHID',
      centro_padrao: 'pj33', prazo_dias: null, retencoes: [] },
    { id: 'cl22', documento: '', nome: 'HMMQ',
      centro_padrao: 'pj34', prazo_dias: null, retencoes: [] },
    { id: 'cl23', documento: '', nome: 'IPADE/UNICRISTUS',
      centro_padrao: 'pj36', prazo_dias: null, retencoes: [] },
    { id: 'cl24', documento: '', nome: 'Fundação Edson Queiroz / UNIFOR',
      centro_padrao: 'pj37', prazo_dias: null, retencoes: [] },
    { id: 'cl25', documento: '', nome: 'Santa Casa de Nilópolis',
      centro_padrao: 'pj41', prazo_dias: null, retencoes: [] },
    { id: 'cl26', documento: '', nome: 'Hospital Moacyr do Carmo',
      centro_padrao: 'pj42', prazo_dias: null, retencoes: [] },
    { id: 'cl27', documento: '', nome: 'SAMU Nova Friburgo',
      centro_padrao: 'pj43', prazo_dias: null, retencoes: [] }
  ];

  /* Contratos. Um contrato cobre uma ou mais LINHAS de projeto, cada
     uma com seu valor mensal — é assim no mundo real: o contrato de
     gestão do AGIR cobre anestesia, GO e neo, com valores distintos.
     Dados tirados das discriminações das notas de agosto/2026. */
  const contratosSeed = [
    { exemplo: true, numero: '001/2025', tipo: 'contrato_gestao', cliente: 'cl01',
      objeto: 'Prestação de serviços médicos no Hospital Maternidade Santa Ana — HMSA',
      processo: 'CTS88.2025.OUT.00149', vigencia_ini: '2025-10-01', vigencia_fim: '2026-09-30',
      renovacao: 'prorrogavel', indice: 'IPCA', reajuste_mes: '2026-10',
      itens: [{ centro: 'pj18', valor: 0 }, { centro: 'pj19', valor: 213427.20 },
              { centro: 'pj20', valor: 355713.60 }, { centro: 'pj21', valor: 327600.00 }] },
    { exemplo: true, numero: '2805/2025', tipo: 'licitacao', cliente: 'cl13',
      objeto: 'Emissão de laudos de mamografia — Policlínicas Randal e Lusmar',
      processo: '2805/2025', vigencia_ini: '2025-11-01', vigencia_fim: '2026-10-31',
      renovacao: 'prorrogavel', indice: 'IPCA', reajuste_mes: '2026-11',
      itens: [{ centro: 'pj31', valor: 5490.00 }, { centro: 'pj32', valor: 7680.00 }] },
    { exemplo: true, numero: 'NE 1438', tipo: 'licitacao', cliente: 'cl07',
      objeto: 'Mão de obra terceirizada de médicos especialistas — HEMOCE',
      processo: 'NE 1438', vigencia_ini: '2026-01-21', vigencia_fim: '2026-12-20',
      renovacao: 'prorrogavel', indice: 'IPCA', reajuste_mes: '',
      itens: [{ centro: 'pj06', valor: 29577.04 }] },
    { exemplo: true, numero: 'CIS-SERRA/2026', tipo: 'contrato_gestao', cliente: 'cl09',
      objeto: 'Serviços médicos na CRU e USAs do SAMU CIS-SERRA',
      processo: '', vigencia_ini: '2026-02-01', vigencia_fim: '2026-11-30',
      renovacao: 'prorrogavel', indice: 'INPC', reajuste_mes: '',
      itens: [{ centro: 'pj22', valor: 387223.52 }] },
    { exemplo: true, numero: 'SCBM/2024-07', tipo: 'privado', cliente: 'cl02',
      objeto: 'Serviços médicos de anestesiologia, neonatologia, cirurgia geral e pediatria',
      processo: '', vigencia_ini: '2024-07-01', vigencia_fim: '2027-06-30',
      renovacao: 'automatica', indice: 'IGPM', reajuste_mes: '2026-07',
      itens: [{ centro: 'pj23', valor: 435765.29 }, { centro: 'pj24', valor: 265036.50 },
              { centro: 'pj25', valor: 177696.23 }, { centro: 'pj27', valor: 84000.00 }] }
  ];

  const TIPOS_CONTRATO = { licitacao: 'Licitação', dispensa: 'Dispensa', credenciamento: 'Credenciamento',
                           contrato_gestao: 'Contrato de gestão', privado: 'Contrato privado' };

  /* MATERIAIS DE CONSUMO. O estoque é por projeto: cada unidade tem o
     seu, e a farmacêutica do projeto dá a saída. "minimo" é o ponto de
     pedido — abaixo dele o sistema pede reposição. */
  const produtos = [
    { id: 'pr01', codigo: 'MT-001', descricao: 'Luva cirúrgica estéril 7,5', unidade: 'CX',
      ncm: '40151200', minimo: 20, ideal: 60, custo: 128.00, conta: '8.04', ativo: true },
    { id: 'pr02', codigo: 'MT-002', descricao: 'Seringa 20ml', unidade: 'CX',
      ncm: '90183110', minimo: 15, ideal: 40, custo: 140.80, conta: '8.04', ativo: true },
    { id: 'pr03', codigo: 'MT-003', descricao: 'Cateter venoso periférico 20G', unidade: 'CX',
      ncm: '90183919', minimo: 10, ideal: 30, custo: 96.50, conta: '8.04', ativo: true },
    { id: 'pr04', codigo: 'MT-004', descricao: 'Máscara cirúrgica tripla', unidade: 'CX',
      ncm: '63079090', minimo: 30, ideal: 100, custo: 22.40, conta: '8.04', ativo: true },
    { id: 'pr05', codigo: 'MT-005', descricao: 'Gaze estéril 7,5x7,5', unidade: 'PCT',
      ncm: '30059011', minimo: 40, ideal: 120, custo: 8.90, conta: '8.04', ativo: true },
    { id: 'pr06', codigo: 'MT-006', descricao: 'Soro fisiológico 0,9% 500ml', unidade: 'UN',
      ncm: '30049099', minimo: 60, ideal: 200, custo: 6.75, conta: '8.04', ativo: true },
    { id: 'pr07', codigo: 'MT-007', descricao: 'Equipo macrogotas', unidade: 'UN',
      ncm: '90183290', minimo: 50, ideal: 150, custo: 3.20, conta: '8.04', ativo: true },
    { id: 'pr08', codigo: 'MT-008', descricao: 'Álcool 70% 1L', unidade: 'UN',
      ncm: '22072019', minimo: 25, ideal: 80, custo: 11.30, conta: '8.04', ativo: true },
    { id: 'pr09', codigo: 'MT-009', descricao: 'Agulha 40x12', unidade: 'CX',
      ncm: '90183220', minimo: 12, ideal: 40, custo: 18.60, conta: '8.04', ativo: true },
    { id: 'pr10', codigo: 'MT-010', descricao: 'Fio de sutura nylon 3-0', unidade: 'CX',
      ncm: '30061010', minimo: 8, ideal: 24, custo: 210.00, conta: '8.04', ativo: true },
    { id: 'pr11', codigo: 'MT-011', descricao: 'Papel para eletrocardiógrafo', unidade: 'RL',
      ncm: '48239099', minimo: 10, ideal: 30, custo: 14.50, conta: '8.04', ativo: true },
    { id: 'pr12', codigo: 'MT-012', descricao: 'Eletrodo descartável ECG', unidade: 'PCT',
      ncm: '90181910', minimo: 15, ideal: 50, custo: 32.00, conta: '8.04', ativo: true }
  ];

  /* ARMAZÉNS. O material fica em armazém, não em projeto: o armazém é
     que aponta para o projeto, e é por ele que o consumo chega ao DRE.
     Um projeto pode ter vários (farmácia central e satélite) e um
     armazém pode ser externo (material que foi direto para a unidade). */
  const armazens = [
    { id: 'am01', codigo: 'ALM-SEDE', nome: 'Almoxarifado central — Barueri', centro: 'cc100',
      tipo: 'sede', responsavel: '', ativo: true },
    { id: 'am02', codigo: 'FARM-SCBM', nome: 'Farmácia SCBM — Barra Mansa', centro: 'pj23',
      tipo: 'externo', responsavel: 'Farmacêutica do projeto', ativo: true },
    { id: 'am03', codigo: 'FARM-HMMQ', nome: 'Farmácia HMMQ — Queimados', centro: 'pj34',
      tipo: 'externo', responsavel: 'Farmacêutica do projeto', ativo: true },
    { id: 'am04', codigo: 'FARM-CETHID', nome: 'Farmácia CETHID — Queimados', centro: 'pj33',
      tipo: 'externo', responsavel: '', ativo: true },
    /* Bonsucesso: o material da compra entra no almoxarifado do
       hospital e de lá é distribuído para os setores. Setor é armazém
       filho — tem saldo próprio e custo médio próprio, mas herda o
       projeto do pai, para o consumo chegar ao DRE no lugar certo. */
    { id: 'am05', codigo: 'ALM-HGB', nome: 'Almoxarifado HGB — Bonsucesso', centro: 'pj11',
      tipo: 'externo', responsavel: '', ativo: true },
    /* Um armazém por especialidade do mutirão. Cada sala guarda o que
       usa — a lente intraocular fica na oftalmo, a tela de hérnia na
       cirurgia geral — e é isso que faz a tela de lançamento oferecer
       só o material daquela cirurgia, sem o operador escolher nada. */
    { id: 'am06', codigo: 'HGB-CC-OFTALMO', nome: 'HGB · CC Oftalmologia', centro: 'pj50',
      tipo: 'setor', pai: 'am05', especialidade: 'OFTALMO', responsavel: '', ativo: true },
    { id: 'am07', codigo: 'HGB-CC-GERAL', nome: 'HGB · CC Cirurgia geral', centro: 'pj50',
      tipo: 'setor', pai: 'am05', especialidade: 'CIRURGIA GERAL', responsavel: '', ativo: true },
    { id: 'am08', codigo: 'HGB-AMBULATORIO', nome: 'HGB · Ambulatório', centro: 'pj50',
      tipo: 'setor', pai: 'am05', especialidade: 'RISCO CX', responsavel: '', ativo: true },
    { id: 'am09', codigo: 'HGB-CC-URO', nome: 'HGB · CC Urologia', centro: 'pj50',
      tipo: 'setor', pai: 'am05', especialidade: 'UROLOGIA', responsavel: '', ativo: true },
    { id: 'am10', codigo: 'HGB-CC-OTORRINO', nome: 'HGB · CC Otorrinolaringologia', centro: 'pj50',
      tipo: 'setor', pai: 'am05', especialidade: 'OTORRINO', responsavel: '', ativo: true },
    { id: 'am11', codigo: 'HGB-CC-GINECO', nome: 'HGB · CC Ginecologia', centro: 'pj50',
      tipo: 'setor', pai: 'am05', especialidade: 'GINECO', responsavel: '', ativo: true }
  ];

  const TIPOS_ARMAZEM = { sede: 'Sede / almoxarifado', externo: 'Unidade externa',
                          setor: 'Setor interno', transito: 'Em trânsito' };

  /* ── hierarquia de armazéns ─────────────────────────────
     Um nível só, de propósito: almoxarifado do hospital e os setores
     que consomem dele. Setor de setor viraria uma árvore que ninguém
     consegue conferir no fim do mês. */
  const setoresDe = paiId => armazens.filter(function (a) {
    return a.pai === paiId && a.ativo; });
  const ehSetor = id => !!(armazem(id) || {}).pai;
  const paiDe = id => armazem((armazem(id) || {}).pai) || null;
  /* o próprio armazém mais os setores dele — a "casa inteira" */
  const comSetores = id => [id].concat(setoresDe(id).map(function (a) { return a.id; }));
  const principais = () => armazens.filter(function (a) { return a.ativo && !a.pai; });

  /* Inventário inicial: armazém, produto, quantidade e o custo da
     camada — é a primeira camada de cada material. */
  /* Materiais do mutirão do HGB. Os três armazéns do HGB (oftalmo,
     centro cirúrgico e ambulatório) consomem por procedimento, então o
     cadastro precisa dos itens que a cirurgia usa de verdade — lente
     intraocular, viscoelástico, tela de hérnia, clipador. */
  produtos.push(
    { id: 'pr20', codigo: 'CIR-001', descricao: 'Lente intraocular dobrável', unidade: 'UN',
      ncm: '90213910', minimo: 20, ideal: 120, custo: 185.00, conta: '8.04', ativo: true },
    { id: 'pr21', codigo: 'CIR-002', descricao: 'Viscoelástico 1,0ml', unidade: 'UN',
      ncm: '30049099', minimo: 20, ideal: 120, custo: 96.50, conta: '8.04', ativo: true },
    { id: 'pr22', codigo: 'CIR-003', descricao: 'Kit facoemulsificação descartável', unidade: 'UN',
      ncm: '90183990', minimo: 10, ideal: 60, custo: 240.00, conta: '8.04', ativo: true },
    { id: 'pr23', codigo: 'CIR-004', descricao: 'Tela de polipropileno 15x15', unidade: 'UN',
      ncm: '30059090', minimo: 8, ideal: 40, custo: 152.00, conta: '8.04', ativo: true },
    { id: 'pr24', codigo: 'CIR-005', descricao: 'Clipador laparoscópico descartável', unidade: 'UN',
      ncm: '90183219', minimo: 5, ideal: 25, custo: 410.00, conta: '8.04', ativo: true },
    { id: 'pr25', codigo: 'CIR-006', descricao: 'Trocarte descartável 10mm', unidade: 'UN',
      ncm: '90183219', minimo: 10, ideal: 50, custo: 118.00, conta: '8.04', ativo: true },
    { id: 'pr26', codigo: 'CIR-007', descricao: 'Fio de sutura vicryl 2-0', unidade: 'CX',
      ncm: '30061010', minimo: 6, ideal: 30, custo: 178.00, conta: '8.04', ativo: true },
    { id: 'pr27', codigo: 'CIR-008', descricao: 'Campo cirúrgico estéril descartável', unidade: 'PCT',
      ncm: '63079090', minimo: 15, ideal: 80, custo: 64.00, conta: '8.04', ativo: true },
    { id: 'pr28', codigo: 'CIR-009', descricao: 'Avental cirúrgico estéril', unidade: 'UN',
      ncm: '62101000', minimo: 20, ideal: 100, custo: 22.50, conta: '8.04', ativo: true },
    { id: 'pr29', codigo: 'CIR-010', descricao: 'Lâmina de bisturi 15', unidade: 'CX',
      ncm: '82121020', minimo: 5, ideal: 25, custo: 46.00, conta: '8.04', ativo: true }
  );

  const estoqueSeed = [
    { produto: 'pr01', armazem: 'am02', qtd: 12 }, { produto: 'pr01', armazem: 'am03', qtd: 34 },
    { produto: 'pr02', armazem: 'am02', qtd: 8 },  { produto: 'pr02', armazem: 'am03', qtd: 22 },
    { produto: 'pr03', armazem: 'am02', qtd: 26 }, { produto: 'pr04', armazem: 'am02', qtd: 18 },
    { produto: 'pr05', armazem: 'am02', qtd: 95 }, { produto: 'pr05', armazem: 'am03', qtd: 30 },
    { produto: 'pr06', armazem: 'am02', qtd: 140 },{ produto: 'pr06', armazem: 'am03', qtd: 45 },
    { produto: 'pr07', armazem: 'am02', qtd: 40 }, { produto: 'pr08', armazem: 'am02', qtd: 60 },
    { produto: 'pr09', armazem: 'am02', qtd: 9 },  { produto: 'pr10', armazem: 'am02', qtd: 14 },
    { produto: 'pr11', armazem: 'am03', qtd: 6 },  { produto: 'pr12', armazem: 'am03', qtd: 11 },
    /* HGB · Oftalmologia — mutirão de catarata */
    { produto: 'pr20', armazem: 'am06', qtd: 140 }, { produto: 'pr21', armazem: 'am06', qtd: 150 },
    { produto: 'pr22', armazem: 'am06', qtd: 90 },  { produto: 'pr27', armazem: 'am06', qtd: 120 },
    { produto: 'pr28', armazem: 'am06', qtd: 160 }, { produto: 'pr01', armazem: 'am06', qtd: 25 },
    { produto: 'pr05', armazem: 'am06', qtd: 60 },
    /* CC Cirurgia geral — colecistectomia e hérnias */
    { produto: 'pr23', armazem: 'am07', qtd: 45 },  { produto: 'pr24', armazem: 'am07', qtd: 18 },
    { produto: 'pr25', armazem: 'am07', qtd: 60 },  { produto: 'pr26', armazem: 'am07', qtd: 35 },
    { produto: 'pr27', armazem: 'am07', qtd: 140 }, { produto: 'pr28', armazem: 'am07', qtd: 180 },
    { produto: 'pr29', armazem: 'am07', qtd: 20 },  { produto: 'pr01', armazem: 'am07', qtd: 40 },
    { produto: 'pr05', armazem: 'am07', qtd: 110 }, { produto: 'pr06', armazem: 'am07', qtd: 80 },
    { produto: 'pr10', armazem: 'am07', qtd: 22 },
    /* CC Urologia — vasectomia, postectomia, hidrocele, varicocele */
    { produto: 'pr26', armazem: 'am09', qtd: 30 },  { produto: 'pr27', armazem: 'am09', qtd: 90 },
    { produto: 'pr28', armazem: 'am09', qtd: 110 }, { produto: 'pr29', armazem: 'am09', qtd: 18 },
    { produto: 'pr01', armazem: 'am09', qtd: 35 },  { produto: 'pr05', armazem: 'am09', qtd: 70 },
    { produto: 'pr09', armazem: 'am09', qtd: 16 },  { produto: 'pr10', armazem: 'am09', qtd: 24 },
    { produto: 'pr06', armazem: 'am09', qtd: 40 },
    /* CC Otorrino — septo, sinusotomia, timpano, amígdalas */
    { produto: 'pr26', armazem: 'am10', qtd: 26 },  { produto: 'pr27', armazem: 'am10', qtd: 95 },
    { produto: 'pr28', armazem: 'am10', qtd: 120 }, { produto: 'pr29', armazem: 'am10', qtd: 22 },
    { produto: 'pr01', armazem: 'am10', qtd: 38 },  { produto: 'pr05', armazem: 'am10', qtd: 85 },
    { produto: 'pr06', armazem: 'am10', qtd: 45 },  { produto: 'pr10', armazem: 'am10', qtd: 20 },
    /* CC Ginecologia — laqueadura e histerectomia */
    { produto: 'pr24', armazem: 'am11', qtd: 12 },  { produto: 'pr25', armazem: 'am11', qtd: 40 },
    { produto: 'pr26', armazem: 'am11', qtd: 28 },  { produto: 'pr27', armazem: 'am11', qtd: 100 },
    { produto: 'pr28', armazem: 'am11', qtd: 130 }, { produto: 'pr29', armazem: 'am11', qtd: 16 },
    { produto: 'pr01', armazem: 'am11', qtd: 42 },  { produto: 'pr05', armazem: 'am11', qtd: 90 },
    { produto: 'pr06', armazem: 'am11', qtd: 50 },
    /* Ambulatório — curativos e material leve das diárias */
    { produto: 'pr27', armazem: 'am08', qtd: 70 },  { produto: 'pr28', armazem: 'am08', qtd: 80 },
    { produto: 'pr01', armazem: 'am08', qtd: 30 },  { produto: 'pr05', armazem: 'am08', qtd: 55 },
    { produto: 'pr09', armazem: 'am08', qtd: 14 },  { produto: 'pr10', armazem: 'am08', qtd: 16 }
  ];


  /* ── Tabela PATE HGB 2026 ────────────────────────────────
     Vem da planilha do mutirão. Cada procedimento tem o valor SIGTAP
     (SH + SP), um múltiplo negociado, o total, o faturamento de 95%
     desse total e o repasse ao médico. Linhas de ambulatório e mapa
     cirúrgico não faturam por procedimento: são diárias, com repasse
     fixo e faturamento zero. */
  const ESPECIALIDADES_PATE = ['CIRURGIA GERAL', 'UROLOGIA', 'OFTALMO', 'OTORRINO', 'GINECO', 'RISCO CX'];

  const tabelaPate = [
    { id: 'pa01', area: 'CIRURGIA GERAL', nome: 'COLECISTECTOMIA VIDEOLAPAROSCOPICA', codigo: '04.07.03.003-4',
      sh: 746.46, sp: 245.99, sigtap: 992.45, multiplo: 4, total: 3969.80, faturamento: 3771.31, repasse: 688.77, tipo: 'cirurgia' },
    { id: 'pa02', area: 'CIRURGIA GERAL', nome: 'HERNIOPLASTIA INGUINAL (BILATERAL)', codigo: '04.07.04.009-9',
      sh: 399.57, sp: 210.49, sigtap: 610.06, multiplo: 4, total: 2440.24, faturamento: 2318.23, repasse: 589.37, tipo: 'cirurgia' },
    { id: 'pa03', area: 'CIRURGIA GERAL', nome: 'HERNIOPLASTIA UMBILICAL', codigo: '04.07.04.012-9',
      sh: 298.55, sp: 136.44, sigtap: 434.99, multiplo: 4, total: 1739.96, faturamento: 1652.96, repasse: 382.03, tipo: 'cirurgia' },
    { id: 'pa04', area: 'UROLOGIA', nome: 'VASECTOMIA (AMBULATORIAL)', codigo: '04.09.04.024-0',
      sh: 190.92, sp: 247.95, sigtap: 438.87, multiplo: 2, total: 877.74, faturamento: 833.85, repasse: 347.13, tipo: 'cirurgia' },
    { id: 'pa05', area: 'UROLOGIA', nome: 'POSTECTOMIA (AMBULATORIAL)', codigo: '04.09.05.008-3',
      sh: 97.92, sp: 121.40, sigtap: 219.32, multiplo: 2, total: 438.64, faturamento: 416.71, repasse: 169.96, tipo: 'cirurgia' },
    { id: 'pa06', area: 'UROLOGIA', nome: 'TRATAMENTO CIRURGICO DE HIDROCELE', codigo: '04.09.04.021-5',
      sh: 181.85, sp: 75.12, sigtap: 256.97, multiplo: 4, total: 1027.88, faturamento: 976.49, repasse: 210.34, tipo: 'cirurgia' },
    { id: 'pa07', area: 'UROLOGIA', nome: 'TRATAMENTO CIRURGICO DE VARICOCELE', codigo: '04.09.04.023-1',
      sh: 173.24, sp: 84.32, sigtap: 257.56, multiplo: 4, total: 1030.24, faturamento: 978.73, repasse: 236.10, tipo: 'cirurgia' },
    { id: 'pa08', area: 'OFTALMO', nome: 'FACOEMULSIFICACAO C/ IMPLANTE DE LENTE INTRA-OCULAR DOBRAVEL', codigo: '04.05.05.037-2',
      sh: 642.96, sp: 128.64, sigtap: 771.60, multiplo: 2, total: 1543.20, faturamento: 1466.04, repasse: 0, tipo: 'cirurgia' },
    { id: 'pa09', area: 'OFTALMO', nome: 'EXERESE DE CALAZIO E OUTRAS PEQUENAS LESOES DA PALPEBRA E SUPERCILIOS', codigo: '04.05.01.007-9',
      sh: 55.30, sp: 23.45, sigtap: 78.75, multiplo: 2, total: 157.50, faturamento: 149.62, repasse: 0, tipo: 'cirurgia' },
    { id: 'pa10', area: 'OTORRINO', nome: 'SEPTOPLASTIA PARA CORRECAO DE DESVIO', codigo: '04.04.01.048-2',
      sh: 686.36, sp: 303.48, sigtap: 989.84, multiplo: 1, total: 989.84, faturamento: 940.35, repasse: null, tipo: 'cirurgia' },
    { id: 'pa11', area: 'OTORRINO', nome: 'SINUSOTOMIA BILATERAL', codigo: '04.04.01.032-6',
      sh: 616.28, sp: 571.13, sigtap: 1187.41, multiplo: 1, total: 1187.41, faturamento: 1128.04, repasse: null, tipo: 'cirurgia' },
    { id: 'pa12', area: 'OTORRINO', nome: 'TIMPANOPLASTIA (UNI/BILATERAL)', codigo: '04.04.01.035-0',
      sh: 885.96, sp: 968.49, sigtap: 1854.45, multiplo: 1, total: 1854.45, faturamento: 1761.73, repasse: null, tipo: 'cirurgia' },
    { id: 'pa13', area: 'OTORRINO', nome: 'ADENOIDECTOMIA', codigo: '04.04.01.001-6',
      sh: 490.59, sp: 588.51, sigtap: 1079.10, multiplo: 1, total: 1079.10, faturamento: 1025.14, repasse: null, tipo: 'cirurgia' },
    { id: 'pa14', area: 'OTORRINO', nome: 'AMIGDALECTOMIA', codigo: '04.04.01.002-4',
      sh: 521.22, sp: 551.78, sigtap: 1073.00, multiplo: 1, total: 1073.00, faturamento: 1019.35, repasse: null, tipo: 'cirurgia' },
    { id: 'pa15', area: 'OTORRINO', nome: 'TURBINECTOMIA', codigo: '04.04.01.041-5',
      sh: 624.38, sp: 448.83, sigtap: 1073.21, multiplo: 1, total: 1073.21, faturamento: 1019.55, repasse: null, tipo: 'cirurgia' },
    { id: 'pa16', area: 'GINECO', nome: 'LAQUEADURA TUBARIA', codigo: '04.09.06.018-6',
      sh: 286.47, sp: 199.01, sigtap: 485.48, multiplo: 2, total: 970.96, faturamento: 922.41, repasse: 278.61, tipo: 'cirurgia' },
    { id: 'pa17', area: 'GINECO', nome: 'HISTERECTOMIA VIDEOLAPAROSCOPICA', codigo: '04.09.06.015-1',
      sh: 400.24, sp: 265.08, sigtap: 665.32, multiplo: 2, total: 1330.64, faturamento: 1264.11, repasse: 371.11, tipo: 'cirurgia' },
    /* Diárias: repasse fixo, sem faturamento por procedimento. */
    { id: 'pa18', area: 'RISCO CX', nome: 'RISCO CIRURGICO 6 HORAS - 30 A 35 AGENDAMENTOS', codigo: '',
      sh: 0, sp: 0, sigtap: 0, multiplo: 1, total: 0, faturamento: 0, repasse: 1000, tipo: 'diaria' },
    { id: 'pa19', area: 'OTORRINO', nome: 'AMBULATORIO OTORRINO 6 HORAS - 20 A 25 AGENDAMENTOS', codigo: '',
      sh: 0, sp: 0, sigtap: 0, multiplo: 1, total: 0, faturamento: 0, repasse: 1000, tipo: 'diaria' },
    { id: 'pa20', area: 'OTORRINO', nome: 'MAPA CIRURGICO DE OTORRINO 12 HORAS - 4 A 5 CIRURGIAS', codigo: '',
      sh: 0, sp: 0, sigtap: 0, multiplo: 1, total: 0, faturamento: 0, repasse: 2000, tipo: 'diaria' },
    { id: 'pa21', area: 'GINECO', nome: 'AMBULATORIO GINECO 6 HORAS - 20 A 25 AGENDAMENTOS', codigo: '',
      sh: 0, sp: 0, sigtap: 0, multiplo: 1, total: 0, faturamento: 0, repasse: 1000, tipo: 'diaria' }
  ];
  const pateP = id => tabelaPate.find(function (p) { return p.id === id; }) || null;

  /* Projeto e armazéns do mutirão. O setor é o armazém: cada um tem o
     seu estoque e é de lá que sai o material da cirurgia. */
  const PATE_CENTRO = 'pj50';
  const PATE_ARMAZENS = ['am06', 'am07', 'am09', 'am10', 'am11', 'am08'];

  /* A especialidade decide o armazém: escolhida a cirurgia, o material
     que aparece é o daquela sala, e o operador não tem o que errar. O
     vínculo mora no próprio armazém (campo `especialidade`), então
     abrir uma sala nova em outra unidade é cadastro, não código. */
  /* Subprojeto da especialidade dentro do mutirão. */
  function centroDaEspecialidade(esp) {
    if (!esp) return null;
    const c = centros.find(function (x) { return x.especialidade_pate === esp && x.ativo; });
    return c ? c.id : null;
  }

  function armazemDaEspecialidade(esp, centro) {
    if (!esp) return null;
    /* Procura PRIMEIRO a sala do centro pedido. O fallback para o
       projeto do mutirão do HGB só vale quando não há nenhuma sala
       cadastrada para aquele centro — antes a condição com `||`
       devolvia a sala do HGB para qualquer hospital, e a cirurgia de
       outra unidade baixava a lente do estoque de Bonsucesso. */
    if (centro) {
      const doCentro = armazens.find(function (x) {
        return x.ativo && x.especialidade === esp && x.centro === centro;
      });
      if (doCentro) return doCentro.id;
      /* O centro tem salas próprias (de outras especialidades)? Então
         é outro hospital, e a falta desta especialidade é cadastro
         faltando — não se pega a sala alheia. */
      const temSalasProprias = armazens.some(function (x) {
        return x.ativo && x.especialidade && x.centro === centro;
      });
      if (temSalasProprias) return null;
    }
    const a = armazens.find(function (x) {
      return x.ativo && x.especialidade === esp && x.centro === PATE_CENTRO;
    });
    return a ? a.id : null;
  }

  /* Imposto estimado sobre o faturamento dos procedimentos, aberto por
     tributo — ESTIMATIVA, a confirmar com a contabilidade. Cada
     alíquota é editável em Administração.

     Os valores abaixo são do Lucro Presumido de serviços em geral
     (presunção de 32%: IRPJ 32%×15% = 4,8 e CSLL 32%×9% = 2,88). Se a
     contabilidade entender que o serviço é equiparado a hospitalar, a
     presunção cai para 8% e 12%, e esses dois viram 1,2 e 1,08 — daí
     a importância de separar por tributo em vez de um número só. */
  const IMPOSTOS_PROCEDIMENTOS_PADRAO = [
    { id: 'iss',    nome: 'ISS',    aliquota: 5,    obs: 'varia por município' },
    { id: 'pis',    nome: 'PIS',    aliquota: 0.65, obs: 'cumulativo' },
    { id: 'cofins', nome: 'COFINS', aliquota: 3,    obs: 'cumulativo' },
    { id: 'irpj',   nome: 'IRPJ',   aliquota: 4.8,  obs: 'presunção 32%' },
    { id: 'csll',   nome: 'CSLL',   aliquota: 2.88, obs: 'presunção 32%' }
  ];
  const PATE_IMPOSTO_PADRAO = IMPOSTOS_PROCEDIMENTOS_PADRAO
    .reduce(function (s, i) { return s + i.aliquota; }, 0);

  /* Plantão do mutirão: quando o procedimento não tem repasse na
     tabela, o médico não é pago por cirurgia — recebe plantão fixo, que
     vem do PegaPlantão. Até o fechamento chegar, o sistema ESTIMA:
     cada médico que lançou procedimento num dia fez um plantão de 6
     horas. */
  const PLANTAO_HORAS = 6;
  const PLANTAO_VALOR = 1000;

  const MOTIVOS_SAIDA = ['Consumo assistencial', 'Perda / vencimento', 'Devolução ao fornecedor',
                         'Ajuste de inventário', 'Uso administrativo'];
  /* Fluxo de compra em duas aprovações: a diretoria aprova primeiro a
     NECESSIDADE (com valor estimado, item a item) e depois o PREÇO, já
     com a cotação real na frente. */
  const STATUS_COMPRA = { requisicao: 'Requisição', aprovada: 'Aprovada — em cotação',
                          cotada: 'Cotação para aprovar', compra_aprovada: 'Compra aprovada',
                          pedido: 'Aguardando entrega',
                          recebido_parcial: 'Entrega parcial', recebido: 'Recebido', cancelada: 'Cancelada' };
  const armazem = id => armazens.find(function (a) { return a.id === id; }) || null;

  const bancos = [
    /* Convênio de pagamento do Bradesco (Multipag CNAB 240, PIX forma 45).
       Os dados abaixo foram lidos do header do arquivo bra.rem que o
       Protheus gerou e o banco aceitou. No sistema real isso vira o
       cadastro da conta bancária. */
    { id: 'b1', empresa: 'emp1', apelido: 'Bradesco — movimento', banco: '237', ativo: true,
      layout_remessa: 'cnab240', convenio: '472572',
      agencia: '01785', agencia_dv: '0', conta: '000000039464', conta_dv: '5',
      cnpj: '34958609000190', razao_social: 'HJM GESTAO E SERVICOS LTDA',
      endereco: 'RUA DEZESSEIS DE MARCO, 325', numero_endereco: 0, complemento: 'Sala 09',
      cidade: 'PETROPOLIS', cep: '25620', cep_compl: '040', uf: 'RJ',
      saldo_inicial: 412870.55, saldo_inicial_em: '2026-06-30',
      versao_layout: '089', versao_lote: '045', tipo_servico: '10',
      camara: '009', finalidade_doc: '07', indicador_lote: '01',
      proximo_arquivo: 49, proximo_seu_numero: 16 },
    { id: 'b2', empresa: 'emp1', cnpj: '34958609000190', apelido: 'Santander — movimento', banco: '033', ativo: true, layout_remessa: '',
      saldo_inicial: 96540.18, saldo_inicial_em: '2026-06-30' },
    /* Uma conta por empresa, fora as duas da matriz: é a conta que diz
       de quem é o movimento, tanto no extrato quanto na remessa. */
    { id: 'b3', empresa: 'emp2', apelido: 'Santander — filial CE', banco: '033', ativo: true,
      layout_remessa: '', convenio: '', agencia: '01234', agencia_dv: '', conta: '000013000567', conta_dv: '',
      cnpj: '34958609000351', razao_social: 'HJM DOM PEDRO GESTAO E SERVICOS EM SAUDE LTDA',
      proximo_seu_numero: 1 },
    { id: 'b4', empresa: 'emp3', apelido: 'Itaú — Novaped', banco: '341', ativo: true,
      layout_remessa: '', convenio: '', agencia: '00456', agencia_dv: '', conta: '000000077889', conta_dv: '',
      cnpj: '34015981000162', razao_social: 'NOVAPED PROFISSIONAIS ESPECIALIZADOS DE SAUDE LTDA',
      proximo_seu_numero: 1 }
  ];

  /* Formas de pagamento: a forma vem do CADASTRO DO CREDOR, não é
     escolhida a cada pagamento. Credor sem forma trava o pagamento. */
  const formasPagamento = {
    pix:          { nome: 'PIX',             remessa: 'pix',    exige: 'chave PIX' },
    boleto:       { nome: 'Boleto',          remessa: 'boleto', exige: 'código de barras' },
    ted:          { nome: 'TED',             remessa: 'ted',    exige: 'banco, agência e conta' },
    debito_conta: { nome: 'Débito em conta', remessa: null,     exige: null },
    guia:         { nome: 'Guia / tributo',  remessa: 'tributo', exige: 'código de barras' },
    dinheiro:     { nome: 'Dinheiro',        remessa: null,     exige: null }
  };
  const formas = Object.keys(formasPagamento).map(function (k) { return formasPagamento[k].nome; });

  /* Fornecedores, médicos e órgãos. Médico é tipo 'medico' e ganha aba
     própria no cadastro; os dados bancários vêm do arquivo de
     produtividade e alimentam a remessa. */
  const credores = [
    { id: 'cr1', ativo: true, nome: 'Dra. Marina Alves', tipo: 'medico', conta_padrao: '3.01', forma_pagamento: 'pix',
      documento: '41.222.333/0001-70', pix: '41.222.333/0001-70', tipo_chave: 'CNPJ' },
    { id: 'cr2', ativo: true, nome: 'Dr. João Silva', tipo: 'medico', conta_padrao: '3.01', forma_pagamento: 'pix',
      documento: '123.456.789-09', pix: '(11) 98888-7777', tipo_chave: 'Telefone' },
    { id: 'cr3', ativo: true, nome: 'MedTech Locações Ltda', tipo: 'fornecedor', conta_padrao: '3.02', forma_pagamento: 'pix',
      documento: '55.444.333/0001-22', pix: 'financeiro@medtech.com.br', tipo_chave: 'Email' , email: 'comercial@medtech.com.br', contato: 'Comercial'},
    { id: 'cr4', ativo: true, nome: 'Imobiliária Centro RJ',  tipo: 'fornecedor', conta_padrao: '6.01' },
    { id: 'cr5', ativo: true, nome: 'Escritório Contábil',    tipo: 'fornecedor', conta_padrao: '6.03' , email: 'contato@escritoriocontabil.com.br', contato: 'Comercial'},
    { id: 'cr6', ativo: true, nome: 'Receita Federal',        tipo: 'orgao',      conta_padrao: '2.07', forma_pagamento: 'guia' },
    { id: 'cr6b', ativo: true, nome: 'Caixa Econômica Federal — FGTS', tipo: 'orgao', conta_padrao: '4.03', forma_pagamento: 'guia' },
    { id: 'cr7', ativo: true,  nome: 'Dr. Paulo Meireles', tipo: 'medico', conta_padrao: '3.01', forma_pagamento: 'pix',
      documento: '31.884.207/0001-45', pix: '31.884.207/0001-45', tipo_chave: 'CNPJ' },
    { id: 'cr8', ativo: true,  nome: 'Dra. Helena Coutinho', tipo: 'medico', conta_padrao: '3.01', forma_pagamento: 'pix',
      documento: '842.117.330-52', pix: 'helena.coutinho@gmail.com', tipo_chave: 'Email' },
    { id: 'cr91', nome: 'Dr. Rafael Amorim', tipo: 'medico', documento: '01234567890', crm: 'CRM-RJ 71.204',
      forma_pagamento: 'PIX', pix: 'medico1@exemplo.com.br', ativo: true },    { id: 'cr92', nome: 'Dra. Beatriz Nunes', tipo: 'medico', documento: '78901234567', crm: 'CRM-RJ 88.120',
      forma_pagamento: 'PIX', pix: 'medico2@exemplo.com.br', ativo: true },    { id: 'cr93', nome: 'Dr. Sérgio Tavares', tipo: 'medico', documento: '45678901234', crm: 'CRM-RJ 64.331',
      forma_pagamento: 'PIX', pix: 'medico3@exemplo.com.br', ativo: true },    { id: 'cr94', nome: 'Dra. Camila Rocha', tipo: 'medico', documento: '12345678901', crm: 'CRM-RJ 90.552',
      forma_pagamento: 'PIX', pix: 'medico4@exemplo.com.br', ativo: true },    { id: 'cr95', nome: 'Dr. Otávio Lins', tipo: 'medico', documento: '89012345678', crm: 'CRM-RJ 55.907',
      forma_pagamento: 'PIX', pix: 'medico5@exemplo.com.br', ativo: true },    { id: 'cr96', nome: 'Dra. Renata Peixoto', tipo: 'medico', documento: '56789012345', crm: 'CRM-RJ 77.418',
      forma_pagamento: 'PIX', pix: 'medico6@exemplo.com.br', ativo: true },
    { id: 'cr9', ativo: true,  nome: 'Dr. Sérgio Bastos', tipo: 'medico', conta_padrao: '3.01', forma_pagamento: 'pix',
      documento: '19.457.882/0001-08', pix: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', tipo_chave: 'Aleatoria' },
    { id: 'cr10', ativo: true, nome: 'Imobiliária Alphaville', tipo: 'fornecedor', conta_padrao: '6.01', forma_pagamento: 'pix',
      documento: '08.221.664/0001-31', pix: '08.221.664/0001-31', tipo_chave: 'CNPJ' },
    { id: 'cr11', ativo: true, nome: 'Enel Distribuição', tipo: 'fornecedor', conta_padrao: '8.03', forma_pagamento: 'boleto',
      documento: '33.050.071/0001-58' },
    { id: 'cr12', ativo: true, nome: 'Cirúrgica Nordeste Materiais', tipo: 'fornecedor', conta_padrao: '8.04', forma_pagamento: 'pix',
      documento: '22.905.113/0001-77', pix: '22.905.113/0001-77', tipo_chave: 'CNPJ' },
    { id: 'cr13', ativo: true, nome: 'TOTVS S.A.', tipo: 'fornecedor', conta_padrao: '7.01',
      documento: '53.113.791/0001-22', forma_pagamento: 'boleto' },
    { id: 'cr14', ativo: true, nome: 'Vivo Empresas', tipo: 'fornecedor', conta_padrao: '7.04', forma_pagamento: 'boleto',
      documento: '02.558.157/0001-62' },
    { id: 'cr15', ativo: true, nome: 'Localiza Frotas', tipo: 'fornecedor', conta_padrao: '8.01', forma_pagamento: 'pix',
      documento: '18.334.442/0001-90', pix: '18.334.442/0001-90', tipo_chave: 'CNPJ' },
    { id: 'cr16', ativo: true, nome: 'Advocacia Ribeiro & Sá', tipo: 'fornecedor', conta_padrao: '6.04', forma_pagamento: 'pix',
      documento: '27.660.004/0001-13', pix: 'financeiro@ribeirosa.adv.br', tipo_chave: 'Email' },
    { id: 'cr17', ativo: true, nome: 'Prefeitura de Barueri — ISS', tipo: 'orgao', conta_padrao: '2.01', forma_pagamento: 'guia',
      documento: '46.523.015/0001-70' },
    { id: 'cr18', ativo: true, nome: 'Banco Bradesco — empréstimo', tipo: 'fornecedor', conta_padrao: '9.02', forma_pagamento: 'debito_conta' },
    { id: 'cr19', ativo: true, nome: 'Folha de pagamento', tipo: 'outro', conta_padrao: '4.01', forma_pagamento: 'ted' },
    { id: 'cr20', ativo: true, nome: 'Sócios — retirada', tipo: 'socio', conta_padrao: '10.01', forma_pagamento: 'ted' },
    { id: 'cr21', ativo: true, nome: 'Ar Puro Climatização', tipo: 'fornecedor', conta_padrao: '6.07', forma_pagamento: 'pix',
      documento: '39.775.201/0001-64', pix: '(11) 97744-2210', tipo_chave: 'Telefone' },
    { id: 'cr22', ativo: true, nome: 'Azul Linhas Aéreas', tipo: 'fornecedor', conta_padrao: '6.05' },
    { id: 'cr23', ativo: true, nome: 'Certisign Certificadora', tipo: 'fornecedor', conta_padrao: '6.02', forma_pagamento: 'pix',
      documento: '01.554.285/0001-75', pix: '01.554.285/0001-75', tipo_chave: 'CNPJ' },
    /* O banco como fornecedor de tarifa, IOF e débito em conta. Existe
       separado do cr18 (empréstimo) de propósito: tarifa não é parcela
       de empréstimo, e misturar os dois suja o 9.01 e o 9.02. */
    { id: 'cr24', ativo: true, nome: 'Banco Bradesco', tipo: 'fornecedor',
      conta_padrao: '9.01', forma_pagamento: 'debito_conta' },
    { id: 'cr25', ativo: true, nome: 'Banco Santander', tipo: 'fornecedor',
      conta_padrao: '9.01', forma_pagamento: 'debito_conta' },
    /* Credor-espelho dos 3 funcionários semeados (fn01/fn02/fn03) —
       o mesmo que `criarFuncionario` cria sozinho pra qualquer
       funcionário novo cadastrado pela tela. Sem isso, fechar a folha
       destes três dava "Informe o fornecedor/credor" — o único jeito
       de ligar salário a um pagamento de verdade é por um credor. */
    { id: 'crfn01', ativo: true, nome: 'Camila Rodrigues Alves', tipo: 'funcionario',
      documento: '111.222.333-44', forma_pagamento: 'pix', pix: '111.222.333-44', tipo_chave: 'CPF',
      conta_padrao: '4.01', origem: 'dp' },
    { id: 'crfn02', ativo: true, nome: 'Roberto Nascimento Lima', tipo: 'funcionario',
      documento: '222.333.444-55', forma_pagamento: 'pix', pix: '222.333.444-55', tipo_chave: 'CPF',
      conta_padrao: '4.01', origem: 'dp' },
    { id: 'crfn03', ativo: true, nome: 'Juliana Ferreira Costa', tipo: 'funcionario',
      documento: '333.444.555-66', forma_pagamento: 'ted', pix: '',
      conta_padrao: '4.01', origem: 'dp' }
  ];

  /* Lançamentos-semente: cobrem os casos que precisam ser testados —
     parcelamento, competência diferente do vencimento, projeto encerrado,
     pagamento parcial, pendente de aprovação. */
  const titulosSeed = [
    {
      descricao: 'Produtividade médica — julho', credor: 'cr1', conta: '3.01', centro: 'pj11',
      origem: 'produtividade', doc: 'FECH-CETHID-07', tipo: 'medicao', emissao: '2026-07-31',
      parcelas: [{ comp: '2026-07', venc: '2026-08-05', valor: 12400 }],
      aprovacao: 'aprovado'
    },
    {
      descricao: 'Aluguel equipamento — arco cirúrgico', credor: 'cr3', conta: '3.02',
      rateio: [{ centro: 'pj02', pct: 60 }, { centro: 'pj11', pct: 40 }],
      origem: 'nota_fiscal', doc: '4471', tipo: 'nf', emissao: '2026-06-05',
      parcelas: [
        { comp: '2026-06', venc: '2026-07-10', valor: 3200 },
        { comp: '2026-07', venc: '2026-08-10', valor: 3200 },
        { comp: '2026-08', venc: '2026-09-10', valor: 3200 }
      ],
      aprovacao: 'aprovado',
      pagos: [{ parcela: 1, data: '2026-07-10', valor: 3200, juros: 0, multa: 0, banco: 'b1', forma: 'PIX' }]
    },
    {
      descricao: 'Rescisão de contrato — saldo de plantões', credor: 'cr2', conta: '3.01', centro: 'pj22',
      origem: 'manual', doc: 'ACORDO-12/2026', tipo: 'recibo', emissao: '2026-07-15',
      parcelas: [{ comp: '2026-05', venc: '2026-08-20', valor: 8750 }],
      aprovacao: 'aprovado'
    },
    {
      descricao: 'Honorários contábeis — agosto', credor: 'cr5', conta: '6.03', centro: 'cc100',
      origem: 'manual', doc: '118', tipo: 'nf', emissao: '2026-08-28',
      parcelas: [{ comp: '2026-08', venc: '2026-09-05', valor: 6900 }],
      aprovacao: 'pendente'
    },
    {
      descricao: 'Parcelamento tributário — 3/60', credor: 'cr6', conta: '2.07', centro: 'cc900',
      origem: 'manual', doc: 'DARF-003', tipo: 'guia', emissao: '2026-08-10',
      parcelas: [{ comp: '2026-08', venc: '2026-08-31', valor: 18300 }],
      aprovacao: 'aprovado',
      pagos: [{ parcela: 1, data: '2026-09-03', valor: 9000, juros: 142.35, multa: 366, banco: 'b2', forma: 'Boleto' }]
    },
    /* ── base de simulação: mistura de estados, naturezas, projetos,
       parcelamentos, rateios, vencidos, a vencer, pagos, parciais,
       aguardando autorização, pendentes de aprovação e cancelados ── */
    { descricao: 'Aluguel matriz — setembro', credor: 'cr10', conta: '6.01', centro: 'cc100',
      origem: 'recorrente', doc: 'CONTR-2024/11', tipo: 'boleto', emissao: '2026-08-25',
      parcelas: [{ comp: '2026-09', venc: '2026-09-05', valor: 14800 }], aprovacao: 'aprovado',
      pagos: [{ parcela: 1, data: '2026-09-05', valor: 14800, juros: 0, multa: 0, banco: 'b1', forma: 'PIX' }] },

    { descricao: 'Aluguel matriz — outubro', credor: 'cr10', conta: '6.01', centro: 'cc100',
      origem: 'recorrente', doc: 'CONTR-2024/11', tipo: 'boleto', emissao: '2026-09-25',
      parcelas: [{ comp: '2026-10', venc: '2026-10-05', valor: 14800 }], aprovacao: 'aprovado' },

    { descricao: 'Energia elétrica — Filial RJ', credor: 'cr11', conta: '8.03', centro: 'cc200',
      origem: 'manual', doc: '77120945', tipo: 'boleto', emissao: '2026-08-20',
      parcelas: [{ comp: '2026-08', venc: '2026-09-08', valor: 2317.44 }], aprovacao: 'aprovado' },

    { descricao: 'Telefonia e dados — 12 linhas', credor: 'cr14', conta: '7.04', centro: 'cc900',
      origem: 'manual', doc: '2026090031', tipo: 'fatura', emissao: '2026-09-01',
      parcelas: [{ comp: '2026-09', venc: '2026-09-15', valor: 1890.7 }], aprovacao: 'aprovado' },

    { descricao: 'Licença TOTVS Protheus — anuidade', credor: 'cr13', conta: '7.01', centro: 'cc100',
      origem: 'nota_fiscal', doc: '884512', tipo: 'nf', emissao: '2026-07-10',
      parcelas: [{ comp: '2026-07', venc: '2026-08-10', valor: 3400 },
                 { comp: '2026-08', venc: '2026-09-10', valor: 3400 },
                 { comp: '2026-09', venc: '2026-10-10', valor: 3400 }],
      aprovacao: 'aprovado',
      pagos: [{ parcela: 1, data: '2026-08-12', valor: 3400, juros: 18.7, multa: 68, banco: 'b1', forma: 'Boleto' }] },

    { descricao: 'Material médico-hospitalar — reposição', credor: 'cr12', conta: '8.04',
      rateio: [{ centro: 'pj02', pct: 50 }, { centro: 'pj02', pct: 50 }],
      origem: 'nota_fiscal', doc: '19022', tipo: 'nf', emissao: '2026-08-28',
      parcelas: [{ comp: '2026-08', venc: '2026-09-27', valor: 8640.9 }], aprovacao: 'aprovado' },

    { descricao: 'Locação de frota — 4 veículos', credor: 'cr15', conta: '8.01', centro: 'cc900',
      origem: 'recorrente', doc: 'FROTA-0921', tipo: 'fatura', emissao: '2026-09-01',
      parcelas: [{ comp: '2026-09', venc: '2026-09-20', valor: 9600 },
                 { comp: '2026-10', venc: '2026-10-20', valor: 9600 },
                 { comp: '2026-11', venc: '2026-11-20', valor: 9600 },
                 { comp: '2026-12', venc: '2026-12-20', valor: 9600 }], aprovacao: 'aprovado' },

    { descricao: 'Honorários de consultoria trabalhista', credor: 'cr16', conta: '6.04', centro: 'cc100',
      origem: 'nota_fiscal', doc: '441', tipo: 'nf', emissao: '2026-08-30',
      parcelas: [{ comp: '2026-08', venc: '2026-09-09', valor: 7500 }], aprovacao: 'aprovado',
      pagos: [{ parcela: 1, data: '2026-09-09', valor: 3750, juros: 0, multa: 0, banco: 'b2', forma: 'TED' }] },

    { descricao: 'ISS retido — competência agosto', credor: 'cr17', conta: '2.01', centro: 'cc100',
      origem: 'manual', doc: 'GUIA-ISS-08', tipo: 'guia', emissao: '2026-09-02',
      parcelas: [{ comp: '2026-08', venc: '2026-09-10', valor: 5412.33 }], aprovacao: 'aprovado' },

    { descricao: 'Empréstimo capital de giro — 14/36', credor: 'cr18', conta: '9.02', centro: 'cc900',
      origem: 'recorrente', doc: 'CCB-778120', tipo: 'boleto', emissao: '2026-09-01',
      parcelas: [{ comp: '2026-09', venc: '2026-09-25', valor: 22450 },
                 { comp: '2026-10', venc: '2026-10-25', valor: 22450 },
                 { comp: '2026-11', venc: '2026-11-25', valor: 22450 },
                 { comp: '2026-12', venc: '2026-12-25', valor: 22450 },
                 { comp: '2027-01', venc: '2027-01-25', valor: 22450 },
                 { comp: '2027-02', venc: '2027-02-25', valor: 22450 }], aprovacao: 'aprovado' },

    { descricao: 'Folha de pagamento — agosto', credor: 'cr19', conta: '4.01', centro: 'cc100',
      origem: 'manual', doc: 'FOLHA-08/2026', tipo: 'recibo', emissao: '2026-08-31',
      parcelas: [{ comp: '2026-08', venc: '2026-09-05', valor: 38720.15 }], aprovacao: 'aprovado',
      pagos: [{ parcela: 1, data: '2026-09-04', valor: 38720.15, juros: 0, multa: 0, banco: 'b1', forma: 'TED' }] },

    { descricao: 'FGTS — competência agosto', credor: 'cr19', conta: '4.03', centro: 'cc100',
      origem: 'manual', doc: 'FGTS-08/2026', tipo: 'guia', emissao: '2026-09-01',
      parcelas: [{ comp: '2026-08', venc: '2026-09-07', valor: 3097.61 }], aprovacao: 'aprovado',
      pagos: [{ parcela: 1, data: '2026-09-07', valor: 3097.61, juros: 0, multa: 0, banco: 'b1', forma: 'Débito em conta' }] },

    { descricao: 'INSS patronal — competência agosto', credor: 'cr19', conta: '4.04', centro: 'cc100',
      origem: 'manual', doc: 'GPS-08/2026', tipo: 'guia', emissao: '2026-09-01',
      parcelas: [{ comp: '2026-08', venc: '2026-09-20', valor: 10634.2 }], aprovacao: 'aprovado' },

    { descricao: 'Retirada de sócios — setembro', credor: 'cr20', conta: '10.01', centro: 'cc900',
      origem: 'manual', doc: 'RET-09/2026', tipo: 'recibo', emissao: '2026-09-01',
      parcelas: [{ comp: '2026-09', venc: '2026-09-10', valor: 30000 }], aprovacao: 'aprovado',
      pagos: [{ parcela: 1, data: '2026-09-10', valor: 30000, juros: 0, multa: 0, banco: 'b2', forma: 'PIX', situacao: 'aguardando' }] },

    { descricao: 'Manutenção de ar-condicionado — CETHID', credor: 'cr21', conta: '6.07', centro: 'pj11',
      origem: 'nota_fiscal', doc: '3391', tipo: 'nf', emissao: '2026-08-18',
      parcelas: [{ comp: '2026-08', venc: '2026-08-28', valor: 1740 }], aprovacao: 'aprovado' },

    { descricao: 'Passagens — equipe Fortaleza', credor: 'cr22', conta: '6.05', centro: 'pj02',
      origem: 'manual', doc: 'LOC-8871', tipo: 'recibo', emissao: '2026-09-03',
      parcelas: [{ comp: '2026-09', venc: '2026-09-12', valor: 4382.6 }], aprovacao: 'pendente' },

    { descricao: 'Certificado digital e-CNPJ A1', credor: 'cr23', conta: '6.02', centro: 'cc100',
      origem: 'nota_fiscal', doc: '90114', tipo: 'nf', emissao: '2026-09-05',
      parcelas: [{ comp: '2026-09', venc: '2026-09-19', valor: 389 }], aprovacao: 'aprovado' },

    { descricao: 'Desenvolvimento telemedicina — sprint 12', credor: 'cr16', conta: '5.01', centro: 'cc900',
      origem: 'nota_fiscal', doc: '452', tipo: 'nf', emissao: '2026-09-01',
      parcelas: [{ comp: '2026-09', venc: '2026-09-30', valor: 18000 }], aprovacao: 'pendente' },

    { descricao: 'Produtividade médica — agosto', credor: 'cr7', conta: '3.01', centro: 'pj11',
      origem: 'produtividade', doc: 'FECH-GHC-08', tipo: 'medicao', emissao: '2026-08-31',
      parcelas: [{ comp: '2026-08', venc: '2026-09-25', valor: 21600 }], aprovacao: 'aprovado',
      itens: [{ setor: 'GHC - Clínica Médica', tipo: 'Diurno 12h', qtd: 12, minutos: 8640, valor: 18000 },
              { setor: 'GHC - Clínica Médica', tipo: 'Feriado', qtd: 2, minutos: 1440, valor: 3600 }] },

    { descricao: 'Produtividade médica — agosto', credor: 'cr8', conta: '3.01', centro: 'pj11',
      origem: 'produtividade', doc: 'FECH-GHC-08', tipo: 'medicao', emissao: '2026-08-31',
      parcelas: [{ comp: '2026-08', venc: '2026-09-25', valor: 13200 }], aprovacao: 'aprovado',
      itens: [{ setor: 'GHC - Pediatria', tipo: 'Noturno 12h', qtd: 8, minutos: 5760, valor: 13200 }] },

    { descricao: 'Produtividade médica — agosto', credor: 'cr9', conta: '3.01', centro: 'pj34',
      origem: 'produtividade', doc: 'FECH-HMMQ-08', tipo: 'medicao', emissao: '2026-08-31',
      parcelas: [{ comp: '2026-08', venc: '2026-09-15', valor: 17400 }], aprovacao: 'aprovado',
      pagos: [{ parcela: 1, data: '2026-09-08', valor: 17400, juros: 0, multa: 0, banco: 'b1', forma: 'PIX' }],
      itens: [{ setor: 'HMMQ - Obstetrícia', tipo: 'Plantão 24h', qtd: 6, minutos: 8640, valor: 17400 }] },

    { descricao: 'Produtividade médica — agosto', credor: 'cr91', conta: '3.01', centro: 'pj11',
      origem: 'produtividade', doc: 'FECH-GHC-08', tipo: 'medicao', emissao: '2026-08-31',
      parcelas: [{ comp: '2026-08', venc: '2026-09-25', valor: 14400 }], aprovacao: 'aprovado',
      itens: [{ setor: 'GHC - Anestesiologia', tipo: '2 plantões diurnos', qtd: 4, minutos: 2880, valor: 14400 }] },
    { descricao: 'Produtividade médica — agosto', credor: 'cr92', conta: '3.01', centro: 'pj11',
      origem: 'produtividade', doc: 'FECH-GHC-08', tipo: 'medicao', emissao: '2026-08-31',
      parcelas: [{ comp: '2026-08', venc: '2026-09-25', valor: 16800 }], aprovacao: 'aprovado',
      itens: [{ setor: 'GHC - Anestesiologia', tipo: 'plantões noturnos', qtd: 4, minutos: 2880, valor: 16800 }] },
    { descricao: 'Produtividade médica — agosto', credor: 'cr93', conta: '3.01', centro: 'pj11',
      origem: 'produtividade', doc: 'FECH-GHC-08', tipo: 'medicao', emissao: '2026-08-31',
      parcelas: [{ comp: '2026-08', venc: '2026-09-25', valor: 9600 }], aprovacao: 'aprovado',
      itens: [{ setor: 'GHC - Anestesiologia', tipo: 'sobreaviso', qtd: 4, minutos: 2880, valor: 9600 }] },
    { descricao: 'Produtividade médica — agosto', credor: 'cr94', conta: '3.01', centro: 'pj11',
      origem: 'produtividade', doc: 'FECH-GHC-08', tipo: 'medicao', emissao: '2026-08-31',
      parcelas: [{ comp: '2026-08', venc: '2026-09-25', valor: 12300 }], aprovacao: 'aprovado',
      itens: [{ setor: 'GHC - Anestesiologia', tipo: 'plantões de feriado', qtd: 4, minutos: 2880, valor: 12300 }] },
    { descricao: 'Produtividade médica — agosto', credor: 'cr95', conta: '3.01', centro: 'pj11',
      origem: 'produtividade', doc: 'FECH-GHC-08', tipo: 'medicao', emissao: '2026-08-31',
      parcelas: [{ comp: '2026-08', venc: '2026-09-25', valor: 18900 }], aprovacao: 'aprovado',
      itens: [{ setor: 'GHC - Anestesiologia', tipo: 'plantões diurnos', qtd: 4, minutos: 2880, valor: 18900 }] },
    { descricao: 'Produtividade médica — agosto', credor: 'cr96', conta: '3.01', centro: 'pj11',
      origem: 'produtividade', doc: 'FECH-GHC-08', tipo: 'medicao', emissao: '2026-08-31',
      parcelas: [{ comp: '2026-08', venc: '2026-09-25', valor: 15600 }], aprovacao: 'aprovado',
      itens: [{ setor: 'GHC - Anestesiologia', tipo: 'plantões noturnos', qtd: 4, minutos: 2880, valor: 15600 }] },

    { descricao: 'Produtividade médica — julho (retroativo)', credor: 'cr7', conta: '3.01', centro: 'pj11',
      origem: 'produtividade', doc: 'FECH-GHC-07-COMP', tipo: 'medicao', emissao: '2026-09-08',
      parcelas: [{ comp: '2026-07', venc: '2026-09-18', valor: 3600 }], aprovacao: 'pendente',
      itens: [{ setor: 'GHC - Clínica Médica', tipo: 'Diurno 12h', qtd: 2, minutos: 1440, valor: 3600 }] },

    { descricao: 'Locação de ventiladores pulmonares', credor: 'cr3', conta: '3.02', centro: 'pj02',
      origem: 'nota_fiscal', doc: '4610', tipo: 'nf', emissao: '2026-08-05',
      parcelas: [{ comp: '2026-08', venc: '2026-09-05', valor: 5400 },
                 { comp: '2026-09', venc: '2026-10-05', valor: 5400 },
                 { comp: '2026-10', venc: '2026-11-05', valor: 5400 }], aprovacao: 'aprovado' },

    { descricao: 'Deslocamento e hospedagem — plantonistas SCFORT', credor: 'cr22', conta: '3.04', centro: 'pj02',
      origem: 'manual', doc: 'REEMB-0912', tipo: 'recibo', emissao: '2026-09-06',
      parcelas: [{ comp: '2026-09', venc: '2026-09-16', valor: 2870.4 }], aprovacao: 'aprovado' },

    { descricao: 'Reembolso de despesas — coordenação médica', credor: 'cr7', conta: '6.06', centro: 'pj11',
      origem: 'manual', doc: 'REEMB-0908', tipo: 'recibo', emissao: '2026-09-08',
      parcelas: [{ comp: '2026-09', venc: '2026-09-14', valor: 640.25 }], aprovacao: 'pendente' },

    { descricao: 'Cartão corporativo — fatura setembro', credor: 'cr18', conta: '6.09', centro: 'cc100',
      origem: 'manual', doc: 'CARTAO-09', tipo: 'fatura', emissao: '2026-09-02',
      parcelas: [{ comp: '2026-09', venc: '2026-09-11', valor: 6712.88 }], aprovacao: 'aprovado' },

    { descricao: 'Tarifas bancárias — agosto', credor: 'cr18', conta: '9.01', centro: 'cc900',
      origem: 'manual', doc: 'TAR-08/2026', tipo: 'fatura', emissao: '2026-09-01',
      parcelas: [{ comp: '2026-08', venc: '2026-09-02', valor: 418.9 }], aprovacao: 'aprovado',
      pagos: [{ parcela: 1, data: '2026-09-02', valor: 418.9, juros: 0, multa: 0, banco: 'b1', forma: 'Débito em conta' }] },

    { descricao: 'Parcelamento tributário — 4/60', credor: 'cr6', conta: '2.07', centro: 'cc900',
      origem: 'recorrente', doc: 'DARF-004', tipo: 'guia', emissao: '2026-09-05',
      parcelas: [{ comp: '2026-09', venc: '2026-09-30', valor: 18300 }], aprovacao: 'aprovado' },

    { descricao: 'PIS e COFINS — competência agosto', credor: 'cr6', conta: '2.03', centro: 'cc900',
      origem: 'manual', doc: 'DARF-PC-08', tipo: 'guia', emissao: '2026-09-08',
      parcelas: [{ comp: '2026-08', venc: '2026-09-25', valor: 8944.7 }], aprovacao: 'aprovado' },

    { descricao: 'IRPJ e CSLL — 2º trimestre', credor: 'cr6', conta: '2.04', centro: 'cc900',
      origem: 'manual', doc: 'DARF-IR-2T', tipo: 'guia', emissao: '2026-07-25',
      parcelas: [{ comp: '2026-06', venc: '2026-07-31', valor: 15208.4 }], aprovacao: 'aprovado',
      pagos: [{ parcela: 1, data: '2026-08-03', valor: 15208.4, juros: 152.08, multa: 304.17, banco: 'b2', forma: 'Boleto' }] },

    { descricao: 'Aquisição de 3 notebooks', credor: 'cr13', conta: '6.10', centro: 'cc100',
      origem: 'nota_fiscal', doc: '556201', tipo: 'nf', emissao: '2026-09-04',
      parcelas: [{ comp: '2026-09', venc: '2026-10-04', valor: 4200 },
                 { comp: '2026-09', venc: '2026-11-04', valor: 4200 },
                 { comp: '2026-09', venc: '2026-12-04', valor: 4200 }], aprovacao: 'pendente' },

    { descricao: 'Software de laudos — mensalidade', credor: 'cr13', conta: '7.02', centro: 'pj02',
      origem: 'recorrente', doc: 'LAUDO-0926', tipo: 'fatura', emissao: '2026-09-01',
      parcelas: [{ comp: '2026-09', venc: '2026-09-22', valor: 2750 }], aprovacao: 'aprovado' },

    { descricao: 'Vigilância patrimonial — Filial RJ', credor: 'cr21', conta: '6.08', centro: 'cc200',
      origem: 'recorrente', doc: 'VIG-0926', tipo: 'fatura', emissao: '2026-09-01',
      parcelas: [{ comp: '2026-09', venc: '2026-09-18', valor: 3180 }], aprovacao: 'aprovado' },

    { descricao: 'Rescisão de plantonista — SAMU Petrópolis', credor: 'cr9', conta: '4.07', centro: 'pj22',
      origem: 'manual', doc: 'RESC-04/2026', tipo: 'recibo', emissao: '2026-09-07',
      parcelas: [{ comp: '2026-06', venc: '2026-09-17', valor: 6890 }], aprovacao: 'pendente' },

    { descricao: 'Frete de equipamentos — SP para CE', credor: 'cr12', conta: '8.05', centro: 'pj02',
      origem: 'nota_fiscal', doc: '77410', tipo: 'nf', emissao: '2026-08-22',
      parcelas: [{ comp: '2026-08', venc: '2026-09-01', valor: 1980.35 }], aprovacao: 'aprovado' },

    { descricao: 'Materiais de consumo — duplicidade', credor: 'cr12', conta: '3.03', centro: 'pj11',
      origem: 'nota_fiscal', doc: '19022-DUP', tipo: 'nf', emissao: '2026-08-28',
      parcelas: [{ comp: '2026-08', venc: '2026-09-27', valor: 8640.9 }], aprovacao: 'aprovado',
      cancelado: 'Lançado em duplicidade com a NF 19022' },

    { descricao: 'Consultoria de licitações — jul a dez', credor: 'cr16', conta: '6.04',
      rateio: [{ centro: 'cc100', pct: 40 }, { centro: 'cc200', pct: 30 }, { centro: 'pj02', pct: 30 }],
      origem: 'nota_fiscal', doc: '398', tipo: 'nf', emissao: '2026-07-01',
      parcelas: [{ comp: '2026-07', venc: '2026-07-20', valor: 4500 },
                 { comp: '2026-08', venc: '2026-08-20', valor: 4500 },
                 { comp: '2026-09', venc: '2026-09-20', valor: 4500 },
                 { comp: '2026-10', venc: '2026-10-20', valor: 4500 },
                 { comp: '2026-11', venc: '2026-11-20', valor: 4500 },
                 { comp: '2026-12', venc: '2026-12-20', valor: 4500 }], aprovacao: 'aprovado',
      pagos: [{ parcela: 1, data: '2026-07-20', valor: 4500, juros: 0, multa: 0, banco: 'b1', forma: 'PIX' },
              { parcela: 2, data: '2026-08-21', valor: 4500, juros: 12.4, multa: 90, banco: 'b1', forma: 'PIX' }] }
  ];

  /* ── Departamento Pessoal ──────────────────────────────────
     Tabelas fiscais (INSS e IRRF) são o tipo de dado que muda por lei,
     quase sempre em janeiro — por isso ficam em cadastro editável (tela
     de Tabelas em Pessoal), não hardcoded dentro da fórmula de cálculo.
     Os valores abaixo são de referência (tabela vigente até o reajuste
     mais recente que peguei) — confirme com o contador antes de rodar
     a primeira folha real, e atualize aqui assim que a tabela de 2026
     for publicada. */
  const tabelaINSS = {
    vigencia: '2026-01',   // Portaria Interministerial MPS/MF nº 13, de 9/1/2026
    faixas: [
      { ate: 1621.00, aliquota: 7.5,  deduzir: 0 },
      { ate: 2902.84, aliquota: 9,    deduzir: 24.32 },
      { ate: 4354.27, aliquota: 12,   deduzir: 111.40 },
      { ate: 8475.55, aliquota: 14,   deduzir: 198.49 }
    ],
    teto_contribuicao: 988.09   // salário acima do teto paga este valor fixo
  };

  const tabelaIRRF = {
    vigencia: '2026-01',   // tabela sem mudança desde maio/2025; redutor da Lei 15.270/2025 é novo em 2026
    deducao_por_dependente: 189.59,
    desconto_simplificado: 607.20,   // Lei 13.149/2015 — usado em calcularIRRF quando é mais vantajoso que a dedução por dependente
    faixas: [
      { ate: 2428.80, aliquota: 0,    deduzir: 0 },
      { ate: 2826.65, aliquota: 7.5,  deduzir: 182.16 },
      { ate: 3751.05, aliquota: 15,   deduzir: 394.16 },
      { ate: 4664.68, aliquota: 22.5, deduzir: 675.49 },
      { ate: Infinity, aliquota: 27.5, deduzir: 908.73 }
    ],
    /* Redutor da Lei 15.270/2025 — aplicado DEPOIS do IR apurado pela
       tabela acima, sobre o RENDIMENTO BRUTO (não a base já líquida de
       INSS/dependentes — são duas bases diferentes na mesma conta).
       Até R$5.000 brutos, o redutor zera o imposto; entre R$5.000 e
       R$7.350, reduz parcialmente pela fórmula; acima de R$7.350, nulo. */
    redutor: { limite_zera: 5000.00, limite_fim: 7350.00, formula_a: 978.62, formula_b: 0.133145 }
  };

  /* Parâmetros de manutenção: o prazo de SLA era fixo em 5 dias no
     código. */
  const parametrosManutencao = { sla_dias: 5, validade_laudo_padrao_meses: 12 };

  const parametrosDP = {
    aliquota_fgts: 8,               // sobre a remuneração, encargo da empresa — não desconta do funcionário
    aliquota_multa_fgts_rescisao: 40, // sobre o saldo de FGTS do contrato, na rescisão sem justa causa
    /* INSS patronal — a parte que a EMPRESA recolhe, separada do que
       desconta do funcionário. 20% é a regra geral do Regime Geral;
       algumas atividades têm desoneração (CPRB) ou alíquota reduzida —
       confirme com o contador se a Dom Pedro se enquadra em alguma
       delas antes de usar este número num relatório de verdade. */
    aliquota_inss_patronal: 20,
    /* RAT (Risco Ambiental do Trabalho), já com o FAP (Fator
       Acidentário de Prevenção) aplicado — varia de 0,5% a 6% conforme
       o grau de risco da atividade e o histórico de acidentes da
       empresa; 1% é o piso (grau de risco leve, comum em atividade
       administrativa/prestação de serviço). "Terceiros" é a
       contribuição pra Sistema S (SESI/SENAI/SEBRAE etc.), INCRA e
       salário-educação — 5,8% é uma média de mercado pra prestadoras
       de serviço, mas o percentual exato depende do CNAE. Confirme os
       dois com o contador antes de usar num relatório de verdade — são
       os que mais variam de empresa pra empresa neste cálculo inteiro. */
    aliquota_rat_fap: 1,
    aliquota_terceiros: 5.8,
    terco_constitucional_ferias: 1 / 3,
    salario_minimo: 1621.00,        // 2026 — confirme o valor vigente
    /* Salário-família 2026 (Portaria MPS/MF nº 13/2026, mesma que
       atualiza a tabela de INSS) — confirme o valor vigente com o
       contador antes de usar num pagamento de verdade. */
    teto_salario_familia: 1980.38,
    valor_salario_familia: 67.54,
    percentual_vt_max_desconto: 6,  // % do salário base — desconto de VT nunca passa disso
    divisor_hora_padrao: 220        // jornada 44h/semana; outras jornadas usam jornada_semanal_horas*5
  };

  /* Rubricas que o cálculo de folha (`calcularHolerite`, em store.js)
     produz hoje. IMPORTANTE: isto é documentação, não configuração —
     é uma cópia escrita à mão do que o código já faz, pra a analista
     de DP conferir contra o que ela conhece. Mudar um valor aqui NÃO
     muda o cálculo; pra isso ainda é preciso mexer na função. Uma
     rubrica cadastrável de verdade (que o cálculo lê daqui, incidência
     por incidência) é a evolução natural disto, se fizer sentido depois
     da conferência dela. */
  const rubricasPadrao = [
    { codigo: '001', nome: 'Salário', tipo: 'provento', natureza: '4.01',
      inss: true, irrf: true, fgts: true, obs: 'Proporcional aos dias trabalhados no mês.' },
    { codigo: '101', nome: 'Horas extras 50%', tipo: 'provento', natureza: '4.01',
      inss: true, irrf: true, fgts: true, obs: 'Hora normal × 1,5, pelo divisor de hora do funcionário.' },
    { codigo: '102', nome: 'Horas extras 100%', tipo: 'provento', natureza: '4.01',
      inss: true, irrf: true, fgts: true, obs: 'Hora normal × 2.' },
    { codigo: '103', nome: 'Adicional noturno', tipo: 'provento', natureza: '4.01',
      inss: true, irrf: true, fgts: true, obs: '20% da hora normal. Não usa a hora noturna reduzida (52min30s).' },
    { codigo: '104', nome: 'DSR sobre variáveis', tipo: 'provento', natureza: '4.01',
      inss: true, irrf: true, fgts: true, obs: 'Só quando há hora extra ou noturno no mês. Proporção fixa de referência (5/25), não o calendário real.' },
    { codigo: '105', nome: 'Insalubridade', tipo: 'provento', natureza: '4.02',
      inss: true, irrf: true, fgts: true, obs: '10/20/40% sobre o salário mínimo (não sobre o salário do funcionário).' },
    { codigo: '106', nome: 'Periculosidade', tipo: 'provento', natureza: '4.02',
      inss: true, irrf: true, fgts: true, obs: '30% sobre o salário base.' },
    { codigo: '19x', nome: 'Provento avulso', tipo: 'provento', natureza: '4.02',
      inss: true, irrf: true, fgts: true, obs: 'Lançado à mão na tela de Folha pra um mês específico (prêmio, ajuda de custo etc.).' },
    { codigo: '901', nome: 'INSS', tipo: 'desconto', natureza: '4.04',
      inss: false, irrf: false, fgts: false, obs: 'Tabela progressiva sobre o total de proventos do mês.' },
    { codigo: '902', nome: 'IRRF', tipo: 'desconto', natureza: '4.04',
      inss: false, irrf: false, fgts: false, obs: 'Tabela progressiva sobre (proventos − INSS − dependentes − pensão).' },
    { codigo: '903', nome: 'Vale-transporte', tipo: 'desconto', natureza: '4.02',
      inss: false, irrf: false, fgts: false, obs: 'Menor valor entre o gasto real e 6% do salário base.' },
    { codigo: '904', nome: 'Pensão alimentícia', tipo: 'desconto', natureza: '4.02',
      inss: false, irrf: false, fgts: false, obs: 'Reduz a base de IRRF antes de calcular; só entra se informada na folha do mês.' },
    { codigo: '905', nome: 'Faltas', tipo: 'desconto', natureza: '4.01',
      inss: false, irrf: false, fgts: false, obs: 'Salário/30 × dias de falta informados na folha do mês.' },
    { codigo: '99x', nome: 'Desconto avulso', tipo: 'desconto', natureza: '4.02',
      inss: false, irrf: false, fgts: false, obs: 'Lançado à mão na tela de Folha (empréstimo consignado, dano a equipamento etc.).' }
  ];

  const cargos = [
    { id: 'cg01', nome: 'Assistente administrativo', cbo: '4110-05', salario_piso: 1800.00 },
    { id: 'cg02', nome: 'Analista financeiro', cbo: '2524-05', salario_piso: 3200.00 },
    { id: 'cg03', nome: 'Auxiliar de escritório', cbo: '4110-10', salario_piso: 1600.00 },
    { id: 'cg04', nome: 'Enfermeiro', cbo: '2235-05', salario_piso: 4200.00 },
    { id: 'cg05', nome: 'Técnico de enfermagem', cbo: '3222-05', salario_piso: 2400.00 }
  ];

  /* Funcionário CLT — nada a ver com o cadastro de credor (médico PJ/
     SCP). Rateio segue o mesmo formato de parcela: um funcionário
     alocado num contrato específico (o caso da Iron Trainers) rateia
     o custo pro centro daquele projeto, não só pro estrutural. */
  const funcionarios = [
    { id: 'fn01', matricula: '0001', nome: 'Camila Rodrigues Alves',
      cpf: '111.222.333-44', pis: '120.12345.67-8', nascimento: '1992-03-14',
      admissao: '2022-06-01', cargo: 'cg02', tipo_contrato: 'clt',
      salario_base: 4200.00, jornada_semanal_horas: 44, dependentes_irrf: 1,
      centro: 'cc100', rateio: [{ centro: 'cc100', pct: 100 }], credor_id: 'crfn01',
      banco: 'Bradesco', agencia: '1234-5', conta_bancaria: '00012345-6', pix: '111.222.333-44',
      vale_transporte: true, vt_dia: 8.80, vale_refeicao: true, vr_dia: 35.00,
      insalubridade_pct: 0, periculosidade: false,
      ativo: true, desligado_em: null, motivo_desligamento: null,
      historico_salarial: [
        { vigencia: '2022-06-01', salario: 3600.00, motivo: 'Admissão' },
        { vigencia: '2024-01-01', salario: 4200.00, motivo: 'Reajuste anual' }
      ],
      /* Admitida 2022-06-01. Períodos anteriores já foram gozados
         normalmente; o de 2024-06 a 2025-05 ficou pendente de
         propósito (e já está vencido a partir de 2026-05-31, pra
         testar o alerta). O que fechou em 2026-05-31 (2025-06 a
         2026-05) também já foi gozado. */
      ferias: [
        { id: 'fer01a', aquisitivo_inicio: '2022-06-01', aquisitivo_fim: '2023-05-31',
          dias_direito: 30, dias_gozados: 30, limite: '2024-05-31' },
        { id: 'fer01b', aquisitivo_inicio: '2023-06-01', aquisitivo_fim: '2024-05-31',
          dias_direito: 30, dias_gozados: 30, limite: '2025-05-31' },
        { id: 'fer01', aquisitivo_inicio: '2024-06-01', aquisitivo_fim: '2025-05-31',
          dias_direito: 30, dias_gozados: 0, limite: '2026-05-31' },
        { id: 'fer01c', aquisitivo_inicio: '2025-06-01', aquisitivo_fim: '2026-05-31',
          dias_direito: 30, dias_gozados: 30, limite: '2027-05-31' }
      ] },
    { id: 'fn02', matricula: '0002', nome: 'Roberto Nascimento Lima',
      cpf: '222.333.444-55', pis: '130.23456.78-9', nascimento: '1988-11-02',
      admissao: '2021-02-15', cargo: 'cg04', tipo_contrato: 'clt',
      salario_base: 4800.00, jornada_semanal_horas: 40, dependentes_irrf: 2,
      centro: 'pj12', rateio: [{ centro: 'pj12', pct: 100 }], credor_id: 'crfn02',
      banco: 'Bradesco', agencia: '1234-5', conta_bancaria: '00023456-7', pix: '222.333.444-55',
      vale_transporte: false, vt_dia: 0, vale_refeicao: true, vr_dia: 35.00,
      insalubridade_pct: 20, periculosidade: false,
      ativo: true, desligado_em: null, motivo_desligamento: null,
      historico_salarial: [
        { vigencia: '2021-02-15', salario: 3900.00, motivo: 'Admissão' },
        { vigencia: '2023-03-01', salario: 4400.00, motivo: 'Reajuste anual' },
        { vigencia: '2025-01-01', salario: 4800.00, motivo: 'Promoção' }
      ],
      /* Admitido 2021-02-15. Três períodos anteriores já gozados; o de
         2025-02 a 2026-02 é o pendente atual (ainda não vencido em
         21/09/2026, pra mostrar o alerta de "vencendo"). */
      ferias: [
        { id: 'fer02a', aquisitivo_inicio: '2021-02-15', aquisitivo_fim: '2022-02-14',
          dias_direito: 30, dias_gozados: 30, limite: '2023-02-14' },
        { id: 'fer02b', aquisitivo_inicio: '2022-02-15', aquisitivo_fim: '2023-02-14',
          dias_direito: 30, dias_gozados: 30, limite: '2024-02-14' },
        { id: 'fer02c', aquisitivo_inicio: '2023-02-15', aquisitivo_fim: '2024-02-14',
          dias_direito: 30, dias_gozados: 30, limite: '2025-02-14' },
        { id: 'fer02d', aquisitivo_inicio: '2024-02-15', aquisitivo_fim: '2025-02-14',
          dias_direito: 30, dias_gozados: 30, limite: '2026-02-14' },
        { id: 'fer02', aquisitivo_inicio: '2025-02-15', aquisitivo_fim: '2026-02-14',
          dias_direito: 30, dias_gozados: 0, limite: '2027-02-14' }
      ] },
    { id: 'fn03', matricula: '0003', nome: 'Juliana Ferreira Costa',
      cpf: '333.444.555-66', pis: '140.34567.89-0', nascimento: '1995-07-22',
      admissao: '2024-01-08', cargo: 'cg01', tipo_contrato: 'clt',
      salario_base: 1900.00, jornada_semanal_horas: 44, dependentes_irrf: 0,
      centro: 'cc100', rateio: [{ centro: 'cc100', pct: 100 }], credor_id: 'crfn03',
      banco: 'Caixa Econômica', agencia: '4321', conta_bancaria: '00098765-4', pix: '',
      vale_transporte: true, vt_dia: 8.80, vale_refeicao: true, vr_dia: 35.00,
      insalubridade_pct: 0, periculosidade: false,
      ativo: true, desligado_em: null, motivo_desligamento: null,
      historico_salarial: [
        { vigencia: '2024-01-08', salario: 1900.00, motivo: 'Admissão' }
      ],
      /* Admitida 2024-01-08. O período 2024-01 a 2025-01 ficou
         pendente de propósito e já venceu (limite 2026-01-07, antes de
         21/09/2026) — mesmo caso da Camila, pra testar o alerta de
         vencida. O que fechou em 2026-01-07 já foi gozado. */
      ferias: [
        { id: 'fer03', aquisitivo_inicio: '2024-01-08', aquisitivo_fim: '2025-01-07',
          dias_direito: 30, dias_gozados: 0, limite: '2026-01-07' },
        { id: 'fer03b', aquisitivo_inicio: '2025-01-08', aquisitivo_fim: '2026-01-07',
          dias_direito: 30, dias_gozados: 30, limite: '2027-01-07' }
      ] }
  ];

  // atalhos de consulta
  const centro = id => centros.find(c => c.id === id) || null;
  /* O cliente agora mora NO PROJETO (centro.cliente). O campo antigo
     cliente.centro_padrao continua sendo lido pra não quebrar o que já
     estava cadastrado, mas ele só aguentava UM projeto por cliente — e
     salvar um cadastro desligava o vínculo do outro projeto da mesma
     empresa. A migração roda uma vez, na carga. */
  function migrarVinculoCliente() {
    clientes.forEach(function (cl) {
      if (!cl.centro_padrao) return;
      const pj = centros.find(function (c) { return c.id === cl.centro_padrao; });
      if (pj && !pj.cliente) pj.cliente = cl.id;
    });
  }
  const clienteDoCentro = centroId => {
    const c = centros.find(function (x) { return x.id === centroId; });
    if (c && c.cliente) return clientes.find(function (x) { return x.id === c.cliente; }) || null;
    return clientes.find(function (x) { return x.centro_padrao === centroId; }) || null;
  };
  const projetosDoCliente = clienteId => centros.filter(function (c) {
    return c.tipo === 'projeto' && (c.cliente === clienteId ||
      (!c.cliente && (clientes.find(function (x) { return x.id === clienteId; }) || {}).centro_padrao === c.id));
  });

  /* Base real do controle de equipamentos que a empresa mantinha em
     planilha (27 itens, R$ 3,5 mi). O de/para é quase 1:1: Status,
     Projeto, Local de Alocação e Custodiante viram campos do ativo;
     a localização passa a ser consulta do último evento. */
  const ativosSeed = [
    {
      "id": "at001",
      "tag": "PAT-001",
      "categoria": "Camas e macas",
      "descricao": "5 camas leito",
      "qtd": 5,
      "valor": 0,
      "status": "alocado",
      "projeto_nome": "Nilópolis - Santa Casa",
      "local": "Hospital Nilópolis",
      "fornecedor_nome": "",
      "condicao": "Novo",
      "nf": "",
      "custodiante": "Enf. chefe da unidade",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2023-03-14"
    },
    {
      "id": "at002",
      "tag": "PAT-002",
      "categoria": "Materiais e equipamentos (geral)",
      "descricao": "MAT EQTO",
      "qtd": 1,
      "valor": 19500.0,
      "status": "alocado",
      "projeto_nome": "Nilópolis - Santa Casa",
      "local": "Hospital Nilópolis",
      "fornecedor_nome": "",
      "condicao": "Novo",
      "nf": "",
      "custodiante": "Coordenação de enfermagem",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2022-08-02"
    },
    {
      "id": "at003",
      "tag": "PAT-003",
      "categoria": "Materiais e equipamentos (geral)",
      "descricao": "MAT EQTO",
      "qtd": 1,
      "valor": 60000.0,
      "status": "alocado",
      "projeto_nome": "Nilópolis - Santa Casa",
      "local": "Hospital Nilópolis",
      "fornecedor_nome": "",
      "condicao": "Novo",
      "nf": "",
      "custodiante": "Supervisão técnica",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2024-01-19"
    },
    {
      "id": "at004",
      "tag": "PAT-004",
      "categoria": "Ventilação / Respiradores",
      "descricao": "2 respiradores KTK seminovos",
      "qtd": 2,
      "valor": 30000.0,
      "status": "alocado",
      "projeto_nome": "Nilópolis - Santa Casa",
      "local": "Hospital Nilópolis",
      "fornecedor_nome": "KTK",
      "condicao": "Seminovo",
      "nf": "",
      "custodiante": "Gerência de patrimônio",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2021-11-05"
    },
    {
      "id": "at005",
      "tag": "PAT-005",
      "categoria": "Monitorização",
      "descricao": "Monitores",
      "qtd": 1,
      "valor": 100000.0,
      "status": "devolucao",
      "projeto_nome": "Nilópolis - Santa Casa",
      "local": "Hospital Nilópolis",
      "fornecedor_nome": "PRIOM",
      "condicao": "Novo",
      "nf": "",
      "custodiante": "",
      "observacao": "DEVOLUÇÃO MONITORES",
      "exemplo": true,
      "aquisicao": "2024-06-27"
    },
    {
      "id": "at006",
      "tag": "PAT-006",
      "categoria": "Materiais e equipamentos (geral)",
      "descricao": "Equipamentos FPMED",
      "qtd": 1,
      "valor": 93593.85,
      "status": "alocado",
      "projeto_nome": "Nilópolis - Santa Casa",
      "local": "Hospital Nilópolis",
      "fornecedor_nome": "FPMED",
      "condicao": "Novo",
      "nf": "",
      "custodiante": "Coordenação de enfermagem",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2023-09-30"
    },
    {
      "id": "at007",
      "tag": "PAT-007",
      "categoria": "Camas e macas",
      "descricao": "Macas",
      "qtd": 1,
      "valor": 47343.33,
      "status": "alocado",
      "projeto_nome": "Nilópolis - Santa Casa",
      "local": "Hospital Nilópolis",
      "fornecedor_nome": "",
      "condicao": "Novo",
      "nf": "",
      "custodiante": "Supervisão técnica",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2025-02-11"
    },
    {
      "id": "at008",
      "tag": "PAT-008",
      "categoria": "Endoscopia / Vídeo",
      "descricao": "Torres de vídeo",
      "qtd": 1,
      "valor": 26688.0,
      "status": "alocado",
      "projeto_nome": "Nilópolis - Santa Casa",
      "local": "Hospital Nilópolis",
      "fornecedor_nome": "Confiance",
      "condicao": "Novo",
      "nf": "",
      "custodiante": "Gerência de patrimônio",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2022-04-08"
    },
    {
      "id": "at009",
      "tag": "PAT-009",
      "categoria": "Centro cirúrgico",
      "descricao": "Mesa cirúrgica",
      "qtd": 1,
      "valor": 55000.0,
      "status": "alocado",
      "projeto_nome": "SCFORT",
      "local": "Hospital SCFORT",
      "fornecedor_nome": "",
      "condicao": "Novo",
      "nf": "",
      "custodiante": "Enf. chefe da unidade",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2023-03-14"
    },
    {
      "id": "at010",
      "tag": "PAT-010",
      "categoria": "Diálise / Nefrologia",
      "descricao": "2 máquinas de osmose reversa",
      "qtd": 2,
      "valor": 51059.87,
      "status": "alocado",
      "projeto_nome": "Moacyr do Carmo",
      "local": "Hospital Moacyr do Carmo",
      "fornecedor_nome": "Fresenius / Saubern",
      "condicao": "Novo",
      "nf": "52349",
      "custodiante": "Coordenação de enfermagem",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2022-08-02"
    },
    {
      "id": "at011",
      "tag": "PAT-011",
      "categoria": "Diálise / Nefrologia",
      "descricao": "10 filtros máquinas de diálise",
      "qtd": 10,
      "valor": 4478.4,
      "status": "alocado",
      "projeto_nome": "Moacyr do Carmo",
      "local": "Hospital Moacyr do Carmo",
      "fornecedor_nome": "Nipro",
      "condicao": "Novo",
      "nf": "158675",
      "custodiante": "Supervisão técnica",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2024-01-19"
    },
    {
      "id": "at012",
      "tag": "PAT-012",
      "categoria": "Diálise / Nefrologia",
      "descricao": "10 máquinas de diálise",
      "qtd": 10,
      "valor": 576000.0,
      "status": "alocado",
      "projeto_nome": "Moacyr do Carmo",
      "local": "Hospital Moacyr do Carmo",
      "fornecedor_nome": "Nipro",
      "condicao": "Novo",
      "nf": "158677",
      "custodiante": "Gerência de patrimônio",
      "observacao": "23J317: 05P 78P 79P 80P 81P 82P 83P 86P 87P 88P",
      "exemplo": true,
      "aquisicao": "2021-11-05"
    },
    {
      "id": "at013",
      "tag": "PAT-013",
      "categoria": "Diálise / Nefrologia",
      "descricao": "3 máquinas de diálise",
      "qtd": 3,
      "valor": 172800.0,
      "status": "terceiro",
      "projeto_nome": "Itaboraí",
      "local": "Unidade de Itaboraí (em poder de terceiro)",
      "fornecedor_nome": "Nipro",
      "condicao": "Novo",
      "nf": "158678",
      "custodiante": "Enf. chefe da unidade",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2024-06-27"
    },
    {
      "id": "at014",
      "tag": "PAT-014",
      "categoria": "Diálise / Nefrologia",
      "descricao": "3 filtros máquinas de diálise",
      "qtd": 3,
      "valor": 1343.52,
      "status": "terceiro",
      "projeto_nome": "Itaboraí",
      "local": "Unidade de Itaboraí (em poder de terceiro)",
      "fornecedor_nome": "Nipro",
      "condicao": "Novo",
      "nf": "158676",
      "custodiante": "Coordenação de enfermagem",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2023-09-30"
    },
    {
      "id": "at015",
      "tag": "PAT-015",
      "categoria": "Diálise / Nefrologia",
      "descricao": "9 máquinas de diálise",
      "qtd": 9,
      "valor": 518400.0,
      "status": "terceiro",
      "projeto_nome": "Sem projeto",
      "local": "Depósito de terceiros",
      "fornecedor_nome": "Nipro",
      "condicao": "Novo",
      "nf": "158678",
      "custodiante": "Supervisão técnica",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2025-02-11"
    },
    {
      "id": "at016",
      "tag": "PAT-016",
      "categoria": "Diálise / Nefrologia",
      "descricao": "9 filtros máquinas de diálise",
      "qtd": 9,
      "valor": 4030.56,
      "status": "terceiro",
      "projeto_nome": "Sem projeto",
      "local": "Depósito de terceiros",
      "fornecedor_nome": "Nipro",
      "condicao": "Novo",
      "nf": "158676",
      "custodiante": "Gerência de patrimônio",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2022-04-08"
    },
    {
      "id": "at017",
      "tag": "PAT-017",
      "categoria": "Camas e macas",
      "descricao": "50 camas",
      "qtd": 50,
      "valor": 274000.0,
      "status": "terceiro",
      "projeto_nome": "Sem projeto",
      "local": "Depósito de terceiros",
      "fornecedor_nome": "Desematec",
      "condicao": "Novo",
      "nf": "",
      "custodiante": "Enf. chefe da unidade",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2023-03-14"
    },
    {
      "id": "at018",
      "tag": "PAT-018",
      "categoria": "Materiais e equipamentos (geral)",
      "descricao": "Equipamentos FPMED",
      "qtd": 1,
      "valor": 72993.85,
      "status": "terceiro",
      "projeto_nome": "Sem projeto",
      "local": "Depósito de terceiros",
      "fornecedor_nome": "FPMED",
      "condicao": "Novo",
      "nf": "",
      "custodiante": "Coordenação de enfermagem",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2022-08-02"
    },
    {
      "id": "at019",
      "tag": "PAT-019",
      "categoria": "Endoscopia / Vídeo",
      "descricao": "Endoscópio",
      "qtd": 2,
      "valor": 35800.0,
      "status": "terceiro",
      "projeto_nome": "Sem projeto",
      "local": "Depósito de terceiros",
      "fornecedor_nome": "Emporio Medical",
      "condicao": "Novo",
      "nf": "401",
      "custodiante": "Supervisão técnica",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2024-01-19"
    },
    {
      "id": "at020",
      "tag": "PAT-020",
      "categoria": "Materiais e equipamentos (geral)",
      "descricao": "Afastador, caixa, Pinça, etc",
      "qtd": 1,
      "valor": 91180.08,
      "status": "terceiro",
      "projeto_nome": "Sem projeto",
      "local": "Depósito de terceiros",
      "fornecedor_nome": "Emporio Medical",
      "condicao": "Novo",
      "nf": "379",
      "custodiante": "Gerência de patrimônio",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2021-11-05"
    },
    {
      "id": "at021",
      "tag": "PAT-021",
      "categoria": "Camas e macas",
      "descricao": "Camas fowler",
      "qtd": 1,
      "valor": 18845.19,
      "status": "terceiro",
      "projeto_nome": "Sem projeto",
      "local": "Depósito de terceiros",
      "fornecedor_nome": "Max Soluções",
      "condicao": "Novo",
      "nf": "",
      "custodiante": "Enf. chefe da unidade",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2024-06-27"
    },
    {
      "id": "at022",
      "tag": "PAT-022",
      "categoria": "Endoscopia / Vídeo",
      "descricao": "4 Vídeo processadores",
      "qtd": 4,
      "valor": 340000.0,
      "status": "aguardando",
      "projeto_nome": "Sem projeto",
      "local": "Aguardando produção",
      "fornecedor_nome": "Endoshopping",
      "condicao": "Novo",
      "nf": "Contrato",
      "custodiante": "",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2023-09-30"
    },
    {
      "id": "at023",
      "tag": "PAT-023",
      "categoria": "Centro cirúrgico",
      "descricao": "2 mesas de centro cirúrgico",
      "qtd": 2,
      "valor": 50000.0,
      "status": "terceiro",
      "projeto_nome": "Sem projeto",
      "local": "Depósito de terceiros",
      "fornecedor_nome": "",
      "condicao": "Novo",
      "nf": "",
      "custodiante": "Supervisão técnica",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2025-02-11"
    },
    {
      "id": "at024",
      "tag": "PAT-024",
      "categoria": "Iluminação (focos)",
      "descricao": "1 foco e teto",
      "qtd": 1,
      "valor": 30000.0,
      "status": "terceiro",
      "projeto_nome": "Sem projeto",
      "local": "Depósito de terceiros",
      "fornecedor_nome": "",
      "condicao": "Novo",
      "nf": "",
      "custodiante": "Gerência de patrimônio",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2022-04-08"
    },
    {
      "id": "at025",
      "tag": "PAT-025",
      "categoria": "Iluminação (focos)",
      "descricao": "1 foco e teto usado",
      "qtd": 1,
      "valor": 12000.0,
      "status": "terceiro",
      "projeto_nome": "Sem projeto",
      "local": "Depósito de terceiros",
      "fornecedor_nome": "",
      "condicao": "Usado",
      "nf": "",
      "custodiante": "Enf. chefe da unidade",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2023-03-14"
    },
    {
      "id": "at026",
      "tag": "PAT-026",
      "categoria": "Iluminação (focos)",
      "descricao": "1 foco auxiliar",
      "qtd": 1,
      "valor": 12000.0,
      "status": "terceiro",
      "projeto_nome": "Sem projeto",
      "local": "Depósito de terceiros",
      "fornecedor_nome": "",
      "condicao": "Novo",
      "nf": "",
      "custodiante": "Coordenação de enfermagem",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2022-08-02"
    },
    {
      "id": "at027",
      "tag": "PAT-027",
      "categoria": "Diagnóstico por imagem",
      "descricao": "Tomógrafo",
      "qtd": 1,
      "valor": 868000.0,
      "status": "alocado",
      "projeto_nome": "SCFORT",
      "local": "Hospital SCFORT",
      "fornecedor_nome": "GE Healthcare",
      "condicao": "Novo",
      "nf": "20444",
      "custodiante": "Supervisão técnica",
      "observacao": "",
      "exemplo": true,
      "aquisicao": "2024-01-19"
    }
  ];

  const STATUS_ATIVO = [
    { id: 'sede', nome: 'Em estoque (sede)' },
    { id: 'terceiro', nome: 'Em estoque (terceiros)' },
    { id: 'alocado', nome: 'Alocado em projeto' },
    { id: 'transito', nome: 'Em trânsito' },
    { id: 'manutencao', nome: 'Em manutenção' },
    { id: 'devolucao', nome: 'Em devolução' },
    { id: 'aguardando', nome: 'Aguardando produção' },
    { id: 'baixado', nome: 'Baixado' }
  ];
  const nomeStatusAtivo = id => (STATUS_ATIVO.find(function (s) { return s.id === id; }) || {}).nome || id;

  const clientePorDoc = doc => clientes.find(function (c) {
    return String(c.documento || '').replace(/\D/g, '') === String(doc || '').replace(/\D/g, '');
  }) || null;
  const credor = id => credores.find(c => c.id === id) || null;
  const conta = cod => plano.find(p => p.cod === cod) || null;
  const banco = id => bancos.find(b => b.id === id) || null;
  const usuario = id => usuarios.find(u => u.id === id) || null;
  const cargo = id => cargos.find(c => c.id === id) || null;
  const funcionario = id => funcionarios.find(f => f.id === id) || null;
  const grupoDe = cod => {
    const c = conta(cod);
    return c && c.pai ? conta(c.pai) : c;
  };
  const tipoDre = cod => {
    const g = grupoDe(cod);
    return g ? g.tipo : null;
  };

  return { empresa, usuarios, perfis, perfil, ACOES, MODULOS, centros, TIPOS_SERVICO, unidades, contratosSeed, TIPOS_CONTRATO,
           clienteDoCentro, projetosDoCliente, migrarVinculoCliente,
           ativosSeed, STATUS_ATIVO, nomeStatusAtivo, parametrosManutencao,
           empresas, empresaPor,
           NIVEIS_ACESSO, MATRIZ_PADRAO, APROVACAO_POR_MODULO,
           NIVEIS_DO_MODULO, niveisDoModulo,
           tabelaPate, pateP, ESPECIALIDADES_PATE, PATE_CENTRO, PATE_ARMAZENS, PATE_IMPOSTO_PADRAO,
           armazemDaEspecialidade, centroDaEspecialidade,
           PLANTAO_HORAS, PLANTAO_VALOR, IMPOSTOS_PROCEDIMENTOS_PADRAO,
           produtos, armazens, armazem, TIPOS_ARMAZEM, setoresDe, ehSetor, paiDe, comSetores, principais, estoqueSeed, MOTIVOS_SAIDA, STATUS_COMPRA, plano, contaJuros, clientes, clientePorDoc, bancos, formas, formasPagamento, credores, titulosSeed,
           tabelaINSS, tabelaIRRF, parametrosDP, rubricasPadrao, cargos, funcionarios,
           centro, credor, conta, banco, usuario, cargo, funcionario, grupoDe, tipoDre };
})();
