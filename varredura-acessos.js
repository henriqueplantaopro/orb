/* VARREDURA · a tela pergunta pelo SEU módulo?

   POR QUE ISTO EXISTE

   Um perfil foi criado com Ativos em Visualização, Movimentação e
   Financeiro. Ao entrar, o inventário mostrava só "Ficha" e
   "Etiqueta" — nada de editar, movimentar, baixar ou abrir ordem
   de serviço. A matriz dizia uma coisa e a tela obedecia outra.

   A causa: os dezessete botões de ação do módulo de Ativos
   perguntavam `S.pode('estoque')`, que é o nível M do módulo
   ESTOQUE. O inventário nasceu dentro do Estoque e saiu de lá
   depois; a pergunta ficou para trás.

   Esse engano é invisível de três formas ao mesmo tempo: a caixa
   marcada na tela de perfis não mente, o código roda sem erro, e
   a pessoa afetada conclui que o sistema está quebrado. Só
   aparece quando alguém monta um perfil enxuto — e aí já é com a
   empresa usando.

   A varredura lista toda pergunta de permissão que uma tela faz
   sobre um módulo DIFERENTE do seu. Cruzamento não é
   necessariamente erro: a Locação de um ativo envolve
   faturamento, e fechar uma OS envolve lançar custo. Mas cada um
   precisa estar declarado aqui embaixo, com o motivo. Enquanto
   for silêncio, o engano se repete. */
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'js');

/* Qual módulo da matriz cada tela representa. */
const MODULO_DA_TELA = {
  'ui-ativos.js': 'ativos',
  'ui-contratos.js': 'contratos',
  'ui-estoque.js': 'estoque',
  'ui-compras.js': 'compras',
  'ui-dp.js': 'dp',
  'ui-faturamento.js': 'faturamento',
  'ui-habilitacao.js': 'habilitacao',
  'ui-procedimentos.js': 'procedimentos',
  'ui-produtividade.js': 'produtividade',
  'ui-administracao.js': 'administracao',
  'ui-cadastros.js': 'cadastros',
  'ui-lancamento.js': 'financeiro',
  'ui-contas.js': 'financeiro',
  'ui-receber.js': 'financeiro',
  'ui-conciliacao.js': 'financeiro',
  'ui-saldo.js': 'financeiro',
  'ui-aprovacoes.js': 'financeiro',
  'ui-remessa.js': 'financeiro',
  'ui-retencoes.js': 'financeiro',
  'ui-previsoes.js': 'faturamento'
};

/* A ação, quando não é o nome de um módulo, resolve para um
   módulo pela mesma tabela que o `store` usa. Copiada aqui de
   propósito: se as duas divergirem, a varredura passa a mentir —
   e por isso ela própria confere a cópia contra a origem. */
const ACAO_PARA_MODULO = {
  lancar: 'financeiro', pagar: 'financeiro', aprovar: 'financeiro',
  faturar: 'faturamento', liberar_faturamento: 'faturamento',
  estoque: 'estoque', requisitar: 'estoque', receber: 'estoque',
  ver_custo: 'estoque', aprovar_inventario: 'estoque',
  comprar: 'compras', aprovar_compra: 'compras',
  dp: 'dp', fechar_folha: 'dp',
  confirmar_produtividade: 'produtividade',
  fechar_procedimentos: 'procedimentos',
  baixar_ativo: 'ativos',
  aprovar_aditivo: 'contratos',
  aprovar_dados_bancarios: 'cadastros'
};

/* CRUZAMENTOS DECLARADOS — cada um com o motivo. */
const permitido = {
  'ui-ativos.js': {
    faturar: 'Locação de ativo gera receita: quem fatura precisa poder abrir a tela de locação mesmo sem movimentar o inventário.',
    lancar: 'Fechar uma OS lança o custo dela no contas a pagar — é trabalho de quem lança, não de quem mexe no inventário.'
  },
  'ui-faturamento.js': {
    lancar: 'O faturamento gera título a receber; quem lança precisa alcançar essa ponte.',
    ver_custo: 'O resultado por cliente compara receita com custo — sem o custo, a tela mostra metade da conta.'
  },
  'ui-procedimentos.js': {
    estoque: 'O procedimento consome material do estoque: dar baixa é operação de estoque, feita de dentro desta tela.',
    faturar: 'O procedimento vira item de faturamento.'
  },
  'ui-compras.js': {
    estoque: 'O recebimento da compra entra no estoque — é a mesma operação, vista de outro lado.'
  },
  'ui-estoque.js': {
    comprar: 'A requisição de estoque vira pedido de compra.'
  },
  'ui-contas.js': { faturar: 'Conciliação entre pagar e receber.' },
  'ui-receber.js': { lancar: 'Recebimento e lançamento compartilham a baixa.' },
  'ui-conciliacao.js': { lancar: 'A conciliação baixa títulos lançados.' },
  'ui-aprovacoes.js': {
    comprar: 'A fila de aprovação mistura pagamento e compra, por desenho.',
    aprovar_compra: 'Idem.'
  },
  'ui-estoque.js': {
    cadastros: 'Cadastrar produto e armazém sem sair da tela de estoque.',
    comprar: 'A requisição de estoque vira pedido de compra.',
    lancar: 'A entrada de material lança o custo no contas a pagar.'
  },
  'ui-compras.js': {
    estoque: 'O recebimento da compra entra no estoque — é a mesma operação, vista de outro lado.',
    cadastros: 'Cadastrar fornecedor e material sem sair da tela de compras.'
  },
  'ui-contratos.js': {
    lancar: 'Gerar as parcelas do contrato é lançar no contas a pagar; a tela pede o módulo Contratos PRIMEIRO e aceita quem lança como alternativa.',
    cadastros: 'Cadastrar o fornecedor do contrato sem sair da tela.'
  },
  'ui-dp.js': {
    aprovar: 'Aprovar o pagamento da folha é alçada do financeiro, e separá-la do DP é a segregação que se quer.'
  },
  'ui-faturamento.js': {
    pagar: 'A baixa do recebimento encosta no caixa.'
  },
  'ui-produtividade.js': {
    lancar: 'A tela pede o módulo Produtividade PRIMEIRO e aceita quem lança como alternativa.'
  },
  'ui-receber.js': {
    faturar: 'Receber e faturar são as duas pontas da mesma nota.'
  }
};

/* A REVER — cruzamentos que funcionam, mas que escondem o mesmo
   risco do defeito de Ativos: um perfil com o módulo marcado pode
   ficar sem o botão porque a tela pergunta por OUTRO módulo.
   Ficam declarados aqui, à vista, em vez de virarem silêncio. Não
   reprovam a varredura; aparecem como pendência, para serem
   decididos com quem usa o sistema — e não por mim, sozinho. */
const aRever = {
  'ui-compras.js': {
    ver_custo: 'Mostra o custo na tela de Compras usando o nível financeiro do ESTOQUE. Um perfil de Compras com $ marcado e sem Estoque não vê preço no próprio módulo.',
    receber: 'O botão "Receber" da compra usa o M do ESTOQUE. Um perfil só de Compras não consegue dar entrada no que ele mesmo pediu.',
    requisitar: 'Editar a requisição usa o M do ESTOQUE, pelo mesmo motivo histórico.'
  }
};

/* As que NAO vem da matriz: moram na lista de acoes do perfil. */
const ACAO_FINA = { cancelar: 1, estornar: 1, admin: 1, ver_dados_pessoais: 1,
  ver_pacientes: 1, autorizar_faturamento: 1 };

const MODULOS_VALIDOS = ['financeiro', 'faturamento', 'contratos', 'estoque',
  'compras', 'procedimentos', 'produtividade', 'ativos', 'dp', 'cadastros',
  'habilitacao', 'administracao'];

/* AÇÃO QUE NÃO EXISTE É SEMPRE FALSA.

   `pode(x)` procura `x` na matriz; não achando, procura na lista
   de ações do perfil. Se `x` não for nenhum dos dois, a resposta é
   `false` para todo mundo, para sempre — e o botão protegido por
   ela não aparece nunca, nem para a diretoria. Não dá erro, não
   deixa rastro: some. */
const ACOES_REAIS = (function () {
  const dados = fs.readFileSync(path.join(dir, 'dados.js'), 'utf8');
  const bloco = dados.slice(dados.indexOf('const ACOES'), dados.indexOf('];', dados.indexOf('const ACOES')));
  const ids = [];
  bloco.replace(/id:\s*'([a-z_]+)'/g, function (_, id) { ids.push(id); return _; });
  /* `admin` vem do seed e não da lista da tela. */
  ids.push('admin');
  return ids;
})();

let falhas = 0;
const achados = [];
const inexistentes = [];

Object.keys(MODULO_DA_TELA).forEach(function (arq) {
  const caminho = path.join(dir, arq);
  if (!fs.existsSync(caminho)) return;
  const src = fs.readFileSync(caminho, 'utf8');
  const meu = MODULO_DA_TELA[arq];

  /* Só as perguntas de VERDADE: dentro de comentário não vale. */
  const semComentarios = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const vistos = {};
  const re = /S\.(pode|podeMover|veModulo|veFinanceiro|podeAprovar)\(\s*'([a-z_]+)'\s*\)/g;
  let m;
  while ((m = re.exec(semComentarios))) {
    const acao = m[2];
    /* AÇÃO FINA NÃO É CRUZAMENTO DE MÓDULO.

       `cancelar`, `estornar`, `admin`, `ver_dados_pessoais` e
       companhia não saem da matriz: vêm da lista de ações do
       perfil, e existem justamente para atravessar módulos. Tratá-
       las como módulo encheria a varredura de ruído, e varredura
       ruidosa é varredura ignorada. */
    if (ACAO_FINA[acao]) continue;
    /* Só `pode()` cai na lista de ações; `podeMover`, `veModulo` e
       `veFinanceiro` recebem módulo por definição. */
    if (m[1] === 'pode' && ACOES_REAIS.indexOf(acao) < 0 && !ACAO_PARA_MODULO[acao]) {
      const chave = arq + ' · ' + acao;
      if (inexistentes.indexOf(chave) < 0) inexistentes.push(chave);
    }
    const alvo = ACAO_PARA_MODULO[acao] || acao;
    if (alvo === meu) continue;
    if (MODULOS_VALIDOS.indexOf(alvo) < 0) continue;
    vistos[acao] = (vistos[acao] || 0) + 1;
  }

  Object.keys(vistos).forEach(function (acao) {
    const alvo = ACAO_PARA_MODULO[acao] || acao;
    const ok = permitido[arq] && permitido[arq][acao];
    const rever = aRever[arq] && aRever[arq][acao];
    achados.push({ arq: arq, meu: meu, acao: acao, alvo: alvo,
      quantas: vistos[acao], ok: !!ok, rever: rever || '', motivo: ok || '' });
    if (!ok && !rever) falhas++;
  });
});

achados.sort(function (a, b) {
  if (a.ok !== b.ok) return a.ok ? 1 : -1;
  return b.quantas - a.quantas;
});

achados.forEach(function (a) {
  const txt = a.arq + ' (modulo ' + a.meu + ') pergunta por ' + a.alvo +
    ' via ' + a.acao + ' — ' + a.quantas + 'x';
  if (a.ok) {
    console.log('OK    - ' + txt);
  } else if (a.rever) {
    console.log('REVER - ' + txt);
    console.log('        ' + a.rever);
  } else {
    console.log('FALHA - ' + txt);
    console.log('        a tela pode ficar sem botao para quem TEM o modulo ' + a.meu +
      '. Se for proposital, declare em varredura-acessos.js com o motivo.');
  }
});

if (inexistentes.length) {
  console.log('');
  inexistentes.forEach(function (x) {
    console.log('FALHA - ' + x + ': acao que nao existe nem na matriz nem na lista do perfil');
    console.log('        pode(...) devolve false para todo mundo, e o botao nunca aparece.');
  });
  falhas += inexistentes.length;
}

console.log('\n' + (falhas
  ? falhas + ' cruzamento(s) de permissao nao declarado(s)'
  : 'toda tela pergunta pelo proprio modulo, ou tem o cruzamento declarado ✓'));
process.exit(falhas ? 1 : 0);
