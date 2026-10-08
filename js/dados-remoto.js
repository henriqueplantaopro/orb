/* Cadastros vindos do banco.

   O `dados.js` traz os cadastros embutidos no código — foi assim
   que o sistema funcionou até aqui. Com banco configurado e sessão
   aberta, estes mesmos arrays passam a ser preenchidos pelo
   Postgres, ANTES de o sistema montar.

   Por que substituir o conteúdo dos arrays em vez de trocar os
   arrays: o resto do sistema guarda referência a eles
   (`D.centros`, `D.credores`…) em dezenas de lugares. Trocar a
   referência deixaria metade do código olhando para a lista velha.
   Então o array é o mesmo objeto, esvaziado e repreenchido.

   Se qualquer coisa falhar — rede fora, tabela vazia, sessão sem
   permissão —, o sistema NÃO sobe com cadastro pela metade: avisa e
   para. Meio cadastro é pior que cadastro nenhum, porque o
   lançamento sai com centro de custo errado e ninguém percebe. */
window.ERP = window.ERP || {};
ERP.dadosRemoto = (function () {

  /* Cada entrada: a tabela no banco, o array em `D`, e como virar o
     formato que o sistema espera. A tradução existe porque no banco
     a coluna é `cod` e no sistema é `cod`, mas em outros casos o
     nome mudou — e porque o banco devolve `null` onde o sistema
     espera ausência. */
  /* `essencial` marca o que o sistema não consegue funcionar sem:
     sem empresa, perfil, usuário, centro de custo ou plano de
     contas, qualquer lançamento sai errado. Os demais podem estar
     legitimamente vazios — uma empresa que ainda não cadastrou
     produto não deveria ficar impedida de abrir o financeiro. */
  const MAPA = [
    { tabela: 'empresas', destino: 'empresas', ordem: 'id', essencial: true },
    { tabela: 'perfis', destino: 'perfis', ordem: 'id', essencial: true },
    { tabela: 'usuarios', destino: 'usuarios', ordem: 'id', essencial: true },
    { tabela: 'centros', destino: 'centros', ordem: 'id', essencial: true },
    { tabela: 'plano_contas', destino: 'plano', ordem: 'cod', essencial: true },
    { tabela: 'clientes', destino: 'clientes', ordem: 'id' },
    { tabela: 'produtos', destino: 'produtos', ordem: 'id' },
    { tabela: 'armazens', destino: 'armazens', ordem: 'id' },
    { tabela: 'bancos', destino: 'bancos', ordem: 'id' },
    { tabela: 'credores', destino: 'credores', ordem: 'id' },
    { tabela: 'cargos', destino: 'cargos', ordem: 'id' }
  ];

  /* FUNCIONÁRIOS é cadastro, e vai à parte porque a FONTE depende
     de quem está lendo. Quem tem `ver_dados_pessoais` lê a tabela,
     com CPF, salário e conta; quem não tem lê a visão
     `funcionarios_publico`, que traz a lista utilizável sem nada
     disso.

     Este módulo ficou para trás na migração: seguia vindo da
     semente do código, e por isso um perfil de Consulta via
     salário e CPF de todo mundo. O mascaramento mora no banco, e
     quem não chega ao banco não é mascarado. */
  async function carregarFuncionarios(c, D) {
    const completo = ERP.store.pode('ver_dados_pessoais');
    const fonte = completo ? 'funcionarios' : 'funcionarios_publico';
    const { data, error } = await c.from(fonte).select('*');
    if (error) {
      /* Sem a visão no banco (SQL antigo), esvazia em vez de cair
         na semente: mostrar dado de demonstração como se fosse da
         empresa é pior que mostrar nada. */
      D.funcionarios.length = 0;
      return 'não foi possível ler ' + fonte + ': ' + error.message;
    }
    D.funcionarios.length = 0;
    (data || []).forEach(function (f) { D.funcionarios.push(limpar(f)); });
    /* Marca o que veio do banco como já gravado, para a primeira
       sincronização não reenviar a lista inteira. */
    if (ERP.persistencia && ERP.persistencia.fotoFuncionarios) {
      ERP.persistencia.fotoFuncionarios();
    }
    return null;
  }

  /* Ordem NATURAL, não alfabética. O banco ordena texto, e em texto
     "10" vem antes de "2" — foi o que embaralhou o plano de contas,
     que passou a listar "10 · Aportes" no topo e "2 · Impostos"
     depois. O mesmo valeria para centro pj10 e conta 6.07 contra
     6.1.

     A comparação quebra o código em pedaços de número e de texto, e
     compara número com número. */
  function compararNatural(a, b) {
    const pa = String(a === undefined || a === null ? '' : a).match(/(\d+|\D+)/g) || [];
    const pb = String(b === undefined || b === null ? '' : b).match(/(\d+|\D+)/g) || [];
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i], y = pb[i];
      if (x === undefined) return -1;
      if (y === undefined) return 1;
      const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
      if (nx && ny) {
        const d = parseInt(x, 10) - parseInt(y, 10);
        if (d) return d;
      } else if (x !== y) {
        return x.localeCompare(y, 'pt-BR');
      }
    }
    return 0;
  }

  /* O banco guarda `null`; o sistema, em vários pontos, testa
     `if (x.campo)` e trata string vazia e ausência igual. Tirar os
     nulos evita que um `null` vire o texto "null" numa tela. */
  function limpar(linha) {
    const o = {};
    Object.keys(linha).forEach(function (k) {
      if (linha[k] !== null) o[k] = linha[k];
    });
    return o;
  }

  /* A matriz vem como uma linha por cruzamento e vira o formato do
     sistema: { perfil: { modulo: 'VMFA' } }. */
  function montarMatriz(linhas) {
    const m = {};
    linhas.forEach(function (l) {
      m[l.perfil] = m[l.perfil] || {};
      if (l.niveis) m[l.perfil][l.modulo] = l.niveis;
    });
    return m;
  }

  /* Quando os dados na tela foram lidos do banco. Sem isso, a
     sessão trabalha para sempre com o retrato do momento em que
     entrou — e duas pessoas no sistema ao mesmo tempo veem coisas
     diferentes sem nenhum aviso. */
  let lidoEm = null;

  /* A política lida do banco, guardada até o store existir. */
  let politicaLida = null;
  function aplicarPolitica() {
    if (!politicaLida) return false;
    const p = ERP.store && ERP.store.st && ERP.store.st.parametros;
    if (!p) return false;
    Object.assign(p, politicaLida);
    return true;
  }

  function minutosDesdeALeitura() {
    if (!lidoEm) return null;
    return Math.floor((Date.now() - lidoEm) / 60000);
  }

  /* RECARGA EM SEGUNDO PLANO.

     O estoque, os lançamentos e as compras mudam enquanto a pessoa
     está com a tela aberta: a compradora dá entrada, o financeiro
     lança um título, e quem está do outro lado não vê nada até
     recarregar a página. No estoque isso é pior que inconveniente —
     a pessoa decide uma compra olhando um saldo que não existe
     mais.

     Recarrega sozinho a cada poucos minutos e quando a aba volta a
     ficar visível, que é quando a pessoa realmente vai olhar. */
  let recarregando = false;

  async function recarregar(silencioso) {
    if (recarregando) return { ok: false, motivo: 'já em andamento' };
    /* Nunca no meio de uma gravação. O que está sendo enviado ainda
       não está na foto nem no banco, e recarregar por cima disso é
       trocar o chão enquanto alguém anda nele. A recarga seguinte
       pega tudo — são cinco minutos, ou o próximo aviso de tempo
       real, que chega assim que a gravação terminar. */
    if (ERP.persistencia && ERP.persistencia.gravando && ERP.persistencia.gravando()) {
      return { ok: false, motivo: 'gravação em andamento' };
    }
    recarregando = true;
    try {
      const r = await carregar();
      if (!r.erro && !silencioso && ERP.app && ERP.app.aviso) {
        ERP.app.aviso('Dados atualizados.', 'ok');
      }
      /* Redesenha o módulo aberto: recarregar os dados sem
         redesenhar deixaria a tela mostrando o que já não vale. */
      if (!r.erro && ERP.app && ERP.app.redesenharModulo) ERP.app.redesenharModulo();
      return r;
    } finally {
      recarregando = false;
    }
  }

  /* TEMPO REAL.

     O banco avisa o navegador quando uma linha muda, e a tela se
     atualiza em segundos — sem esperar os cinco minutos da recarga
     periódica nem a pessoa trocar de módulo.

     A recarga periódica CONTINUA valendo: o aviso em tempo real
     depende de uma conexão aberta, que cai em rede de hospital,
     celular trocando de torre, aba hibernando. Quando ela cai,
     ninguém é avisado — e é a recarga periódica que segura a
     diferença. Uma não substitui a outra.

     Agrupa os avisos: uma entrada de nota com trinta itens dispara
     trinta eventos, e recarregar trinta vezes seguidas travaria a
     tela. Espera um segundo e recarrega uma vez só. */
  let canal = null;
  let agendado = null;

  function ligarTempoReal() {
    const c = ERP.auth && ERP.auth.cliente && ERP.auth.cliente();
    if (!c || !c.channel) return false;
    if (canal) return true;

    const aoMudar = function () {
      if (agendado) clearTimeout(agendado);
      agendado = setTimeout(function () {
        agendado = null;
        recarregar(true);
      }, 1000);
    };

    try {
      canal = c.channel('erp-mudancas')
        .on('postgres_changes', { event: '*', schema: 'public' }, aoMudar)
        .subscribe();
      return true;
    } catch (e) {
      /* Sem tempo real a vida segue: a recarga periódica cobre. */
      canal = null;
      return false;
    }
  }

  function ligarRecargaAutomatica() {
    ligarTempoReal();

    /* Cinco minutos: curto o bastante para o saldo não envelhecer
       no meio de uma decisão, longo o bastante para não pesar na
       conexão de quem está num hospital com internet ruim. */
    setInterval(function () {
      if (document.visibilityState === 'visible') recarregar(true);
    }, 5 * 60 * 1000);

    /* Voltar para a aba é o momento em que a pessoa vai olhar de
       verdade — e costuma ser depois de um tempo longe. */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      const m = minutosDesdeALeitura();
      if (m === null || m >= 2) recarregar(true);
    });
  }

  async function carregar() {
    const c = ERP.auth && ERP.auth.cliente && ERP.auth.cliente();
    if (!c) return { erro: 'Sem conexão com o banco.' };
    const D = ERP.dados;
    const vazias = [];

    /* O QUE AINDA NÃO FOI GRAVADO SOBREVIVE À RECARGA.

       Trocar a lista pelo que está no banco apagava o cadastro
       recém-criado que ainda não tinha sido gravado. Com a recarga
       em tempo real — que dispara um segundo depois de QUALQUER
       mudança, inclusive de outra pessoa — a janela é grande: a
       compradora cadastra o material na requisição, alguém do
       financeiro lança um título, o aviso chega, a lista é
       substituída e o material some. A requisição fica apontando
       para um produto que não existe mais, e é assim que nasce o
       "material fora do cadastro · pr8802".

       O cadastro local é reposto DEPOIS da troca, e só se o banco
       não o trouxe — se trouxe, a versão do banco é a boa. */
    const segurar = {};
    if (ERP.persistencia && ERP.persistencia.aindaNaoGravados) {
      MAPA.forEach(function (item) {
        const pendentes = ERP.persistencia.aindaNaoGravados(item.destino);
        if (pendentes.length) segurar[item.destino] = pendentes;
      });
    }

    for (const item of MAPA) {
      const { data, error } = await c.from(item.tabela).select('*').order(item.ordem);
      if (error) {
        return { erro: 'Não foi possível ler ' + item.tabela + ': ' + error.message };
      }
      const guardados = segurar[item.destino] || [];
      if (!data.length) {
        if (item.essencial) vazias.push(item.tabela);
        /* Tabela não essencial vazia: esvazia a lista local também.
           Deixar o cadastro de exemplo seria pior — a pessoa
           escolheria um produto que não existe no banco. */
        const a = D[item.destino];
        if (Array.isArray(a)) {
          a.length = 0;
          guardados.forEach(function (x) { a.push(x); });
        }
        continue;
      }
      const alvo = D[item.destino];
      if (!Array.isArray(alvo)) continue;
      alvo.length = 0;
      data.slice()
        .sort(function (x, y) { return compararNatural(x[item.ordem], y[item.ordem]); })
        .forEach(function (l) { alvo.push(limpar(l)); });
      guardados.forEach(function (x) {
        if (!alvo.some(function (y) { return y.id === x.id; })) alvo.push(x);
      });
    }

    /* Tabela vazia é sinal de carga incompleta, não de cadastro
       inexistente: o seed preenche todas. Parar aqui é melhor que
       deixar o sistema subir sem centros de custo. */
    if (vazias.length) {
      return { erro: 'Cadastro essencial faltando no banco: ' + vazias.join(', ') +
        ' sem nenhuma linha. Rode o 03-seed.sql.' };
    }

    /* Cada sala de centro cirúrgico é ligada a uma especialidade —
       é o que faz o sistema saber de qual estoque baixar o material
       da cirurgia. Sem isso, Procedimentos calcula o repasse e não
       deixa lançar material. Se o banco ainda não tiver a coluna
       (10-modulos não rodado), deduz pelo código da sala. */
    const PELO_CODIGO = [
      ['OFTALMO', /OFTALMO/i], ['CIRURGIA GERAL', /CIRURGIA.?GERAL|CIR.?GERAL/i],
      ['UROLOGIA', /UROLOG/i], ['OTORRINO', /OTORRINO/i],
      ['GINECO', /GINECO/i], ['RISCO CX', /RISCO/i]
    ];
    D.armazens.forEach(function (a) {
      if (a.especialidade || a.tipo !== 'setor') return;
      const alvo = (a.codigo || '') + ' ' + (a.nome || '');
      const achou = PELO_CODIGO.find(function (p) { return p[1].test(alvo); });
      if (achou) a.especialidade = achou[0];
    });

    /* O plano de contas é hierárquico, e o sistema agrupa pelo
       campo `pai`. Se o banco ainda não tiver a coluna (08-plano-pai
       não rodado), deriva do próprio código: 6.07 pertence ao 6.
       Sem isso, o combo de natureza mostra os grupos vazios e não
       dá para lançar nada. */
    D.plano.forEach(function (p) {
      if (p.nivel > 1 && !p.pai) {
        const raiz = String(p.cod).split('.')[0];
        if (raiz && raiz !== p.cod) p.pai = raiz;
      }
    });

    const { data: mz, error: errMz } = await c.from('matriz_acesso').select('*');
    if (errMz) return { erro: 'Não foi possível ler a matriz de acesso: ' + errMz.message };
    if (mz && mz.length) {
      const nova = montarMatriz(mz);
      Object.keys(D.MATRIZ_PADRAO).forEach(function (k) { delete D.MATRIZ_PADRAO[k]; });
      Object.keys(nova).forEach(function (k) { D.MATRIZ_PADRAO[k] = nova[k]; });
    }

    /* Parâmetros do DP (tabelas de INSS e IRRF, alíquotas): vivem em
       chave/valor porque mudam por lei, não por versão do sistema. */
    const { data: par } = await c.from('parametros').select('chave, valor');
    (par || []).forEach(function (p) {
      if (p.chave === 'tabela_inss' && p.valor) Object.assign(D.tabelaINSS, p.valor);
      if (p.chave === 'tabela_irrf' && p.valor) Object.assign(D.tabelaIRRF, p.valor);
      if (p.chave === 'parametros_dp' && p.valor) Object.assign(D.parametrosDP, p.valor);
      /* Política: alçada, segregação, trava de competência. Era lida
         do código e nunca do banco — o que a Administração ajustava
         valia só naquela sessão.

         GUARDA em vez de aplicar direto, porque esta carga roda
         ANTES de `store.init()`, que recria `st.parametros` com o
         padrão do código. Aplicar aqui seria escrever num objeto
         que será jogado fora segundos depois — e o efeito seria
         idêntico ao defeito que estou corrigindo. */
      if (p.chave === 'parametros_gerais' && p.valor) politicaLida = p.valor;
    });
    aplicarPolitica();

    /* A sombra tem de acompanhar a recarga. Sem isto, o que veio do
       banco é comparado com a foto anterior e a diferença de
       formato (o banco devolve `0` onde o sistema tinha `null`,
       devolve a data como texto) faz o sistema reenviar cadastro
       que nunca mudou — a cada cinco minutos, por tempo
       indeterminado.

       O que foi segurado acima fica FORA da foto de propósito: ele
       ainda não está no banco, e é justamente isso que o faz ser
       gravado no próximo ciclo. */
    if (ERP.persistencia && ERP.persistencia.refotografar) {
      MAPA.forEach(function (item) {
        if (ERP.store.st && Array.isArray(ERP.store.st[item.destino])) {
          ERP.persistencia.refotografar(item.destino);
        }
      });
      /* E então tira da foto o que foi segurado, que a linha acima
         acabou de fotografar junto. */
      Object.keys(segurar).forEach(function (nome) {
        segurar[nome].forEach(function (x) { ERP.persistencia.esquecerDaFoto(nome, x.id); });
      });
    }

    lidoEm = Date.now();
    return { ok: true, tabelas: MAPA.length, matriz: (mz || []).length };
  }

  /* Chamada à parte, DEPOIS de o usuário da sessão estar definido:
     a fonte depende da permissão dele, e na carga dos cadastros
     ainda não se sabe quem é. */
  async function funcionarios() {
    const c = ERP.auth && ERP.auth.cliente && ERP.auth.cliente();
    if (!c) return 'sem conexão';
    return carregarFuncionarios(c, ERP.dados);
  }

  return { carregar: carregar, funcionarios: funcionarios,
           recarregar: recarregar, ligarRecargaAutomatica: ligarRecargaAutomatica,
           ligarTempoReal: ligarTempoReal,
           minutosDesdeALeitura: minutosDesdeALeitura,
           aplicarPolitica: aplicarPolitica };
})();
