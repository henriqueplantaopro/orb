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

  async function carregar() {
    const c = ERP.auth && ERP.auth.cliente && ERP.auth.cliente();
    if (!c) return { erro: 'Sem conexão com o banco.' };
    const D = ERP.dados;
    const vazias = [];

    for (const item of MAPA) {
      const { data, error } = await c.from(item.tabela).select('*').order(item.ordem);
      if (error) {
        return { erro: 'Não foi possível ler ' + item.tabela + ': ' + error.message };
      }
      if (!data.length) {
        if (item.essencial) vazias.push(item.tabela);
        /* Tabela não essencial vazia: esvazia a lista local também.
           Deixar o cadastro de exemplo seria pior — a pessoa
           escolheria um produto que não existe no banco. */
        const a = D[item.destino];
        if (Array.isArray(a)) a.length = 0;
        continue;
      }
      const alvo = D[item.destino];
      if (!Array.isArray(alvo)) continue;
      alvo.length = 0;
      data.slice()
        .sort(function (x, y) { return compararNatural(x[item.ordem], y[item.ordem]); })
        .forEach(function (l) { alvo.push(limpar(l)); });
    }

    /* Tabela vazia é sinal de carga incompleta, não de cadastro
       inexistente: o seed preenche todas. Parar aqui é melhor que
       deixar o sistema subir sem centros de custo. */
    if (vazias.length) {
      return { erro: 'Cadastro essencial faltando no banco: ' + vazias.join(', ') +
        ' sem nenhuma linha. Rode o 03-seed.sql.' };
    }

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
    });

    return { ok: true, tabelas: MAPA.length, matriz: (mz || []).length };
  }

  return { carregar: carregar };
})();
