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
  const MAPA = [
    { tabela: 'empresas', destino: 'empresas', ordem: 'id' },
    { tabela: 'perfis', destino: 'perfis', ordem: 'id' },
    { tabela: 'usuarios', destino: 'usuarios', ordem: 'id' },
    { tabela: 'centros', destino: 'centros', ordem: 'id' },
    { tabela: 'plano_contas', destino: 'plano', ordem: 'cod' },
    { tabela: 'clientes', destino: 'clientes', ordem: 'id' },
    { tabela: 'produtos', destino: 'produtos', ordem: 'id' },
    { tabela: 'armazens', destino: 'armazens', ordem: 'id' },
    { tabela: 'bancos', destino: 'bancos', ordem: 'id' },
    { tabela: 'credores', destino: 'credores', ordem: 'id' },
    { tabela: 'cargos', destino: 'cargos', ordem: 'id' }
  ];

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
      if (!data.length) { vazias.push(item.tabela); continue; }
      const alvo = D[item.destino];
      if (!Array.isArray(alvo)) continue;
      alvo.length = 0;
      data.forEach(function (l) { alvo.push(limpar(l)); });
    }

    /* Tabela vazia é sinal de carga incompleta, não de cadastro
       inexistente: o seed preenche todas. Parar aqui é melhor que
       deixar o sistema subir sem centros de custo. */
    if (vazias.length) {
      return { erro: 'Cadastro incompleto no banco: ' + vazias.join(', ') +
        ' sem nenhuma linha. Rode o 03-seed.sql.' };
    }

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
