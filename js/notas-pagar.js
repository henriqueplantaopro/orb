/* ERP · notas-pagar.js — o arquivo da nota fiscal do contas a pagar.

   Guardar (balde privado `notas-pagar`), baixar UM arquivo exatamente
   como foi anexado, e a aba "Baixar NFs", que junta num .zip todos os
   arquivos de um período.

   O título guarda só { nome, path }: o arquivo fica no balde, como os
   documentos do faturamento, dos contratos e da habilitação. Sem
   conexão com o banco (modo local, demonstração) ele fica no próprio
   registro, em base64, como era antes — para a tela continuar
   funcionando, não para durar. */
window.ERP = window.ERP || {};

ERP.notasPagar = (function () {
  const U = ERP.util, D = ERP.dados, S = ERP.store;
  const BALDE = 'notas-pagar';
  const cliente = () => (ERP.auth && ERP.auth.cliente && ERP.auth.cliente()) || null;

  /* ── guardar ────────────────────────────────────────────── */
  function lerComoDataURL(file) {
    return new Promise(function (ok, falha) {
      const fr = new FileReader();
      fr.onload = function () { ok(fr.result); };
      fr.onerror = function () { falha(fr.error || new Error('não leu o arquivo')); };
      fr.readAsDataURL(file);
    });
  }

  async function guardar(file) {
    if (!file) return { anexo: null };
    const cli = cliente();
    if (!cli) {
      try { return { anexo: { nome: file.name, dados: await lerComoDataURL(file) } }; }
      catch (e) { return { erro: 'Não consegui ler o arquivo ' + file.name + '.' }; }
    }
    /* Nome limpo no caminho: acento, espaço e barra em nome de objeto
       são fonte certa de arquivo que sobe e não abre. O nome ORIGINAL
       fica no registro — é com ele que o arquivo volta a ser baixado. */
    const limpo = String(file.name || 'nota').replace(/[^\w.\-]+/g, '_').slice(-80);
    const caminho = U.hoje().slice(0, 7) + '/' + Date.now() + '-' +
      Math.random().toString(36).slice(2, 6) + '-' + limpo;
    try {
      const r = await cli.storage.from(BALDE)
        .upload(caminho, file, { contentType: file.type || 'application/octet-stream' });
      if (r.error) return { erro: 'O arquivo não foi para o servidor: ' + r.error.message };
    } catch (e) {
      return { erro: 'O arquivo não foi para o servidor: ' + (e.message || e) };
    }
    return { anexo: { nome: file.name, path: caminho, tamanho: file.size, tipo_arquivo: file.type || '' } };
  }

  /* ── ler de volta ───────────────────────────────────────── */
  function blobDoDataURL(dados) {
    const i = dados.indexOf(',');
    const cab = dados.slice(0, i);
    const corpo = dados.slice(i + 1);
    const tipo = (cab.match(/^data:([^;,]+)/) || [])[1] || 'application/octet-stream';
    let bytes;
    if (/;base64/i.test(cab)) {
      const bin = atob(corpo);
      bytes = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(corpo));
    }
    return new Blob([bytes], { type: tipo });
  }

  /* Devolve { blob } ou { erro }. */
  async function conteudo(an) {
    if (!an) return { erro: 'Sem arquivo anexado.' };
    if (an.so_nome) {
      return { erro: '"' + an.nome + '" foi lançado antes da v179, quando o lançamento guardava só o nome ' +
        'do arquivo. Anexe de novo pela Nota fiscal do título.' };
    }
    if (an.dados) {
      try { return { blob: blobDoDataURL(an.dados) }; }
      catch (e) { return { erro: 'O arquivo guardado está corrompido.' }; }
    }
    const cli = cliente();
    if (!cli) return { erro: 'Sem conexão com o banco — o arquivo fica no servidor.' };
    try {
      const r = await cli.storage.from(BALDE).download(an.path);
      if (r.error || !r.data) return { erro: 'Não baixou: ' + ((r.error && r.error.message) || 'sem resposta') };
      return { blob: r.data };
    } catch (e) {
      return { erro: 'Não baixou: ' + (e.message || e) };
    }
  }

  function entregar(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 20000);
  }

  /* Baixar UM arquivo exatamente como foi anexado: mesmo nome, mesmo
     conteúdo, byte a byte. É o que o contador importa no sistema
     dele — a visualização em PDF não serve para isso. */
  async function baixarOriginal(p) {
    const an = S.anexoDaParcela(p);
    const r = await conteudo(an);
    if (r.erro) return ERP.app.aviso(r.erro, 'erro');
    entregar(r.blob, an.nome);
  }

  /* ── a aba "Baixar NFs" ─────────────────────────────────── */
  const CAMPO_DATA = { emissao: 'Emissão', venc: 'Vencimento', pago_em: 'Pagamento' };
  const CAMPO_ARQ = { emissao: 'emissao', venc: 'vencimento', pago_em: 'pagamento' };
  let ultimo = null;   // a última procura: o que o botão de baixar vai juntar

  function mesAnterior() {
    const ini = U.addMeses(U.hoje().slice(0, 7) + '-01', -1);
    return { de: ini, ate: U.addDias(U.addMeses(ini, 1), -1) };
  }

  function montarFiltros() {
    const sel = U.el('bn-empresa');
    if (sel && !sel.dataset.pronto) {
      sel.innerHTML = '<option value="">todas</option>' +
        D.empresas.filter(function (e) { return e.ativo; }).map(function (e) {
          return '<option value="' + e.id + '">' + U.esc(e.apelido) + '</option>';
        }).join('');
      sel.dataset.pronto = '1';
    }
    if (!U.val('bn-de') && !U.val('bn-ate')) {
      const m = mesAnterior();
      U.setVal('bn-de', m.de); U.setVal('bn-ate', m.ate);
    }
  }

  const ext = nome => ((String(nome || '').match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
  const tipoDoArquivo = nome => ext(nome) === 'xml' ? 'xml' : ext(nome) === 'pdf' ? 'pdf' : 'outro';

  /* As notas que o filtro pega. Uma nota é do TÍTULO, não da parcela
     (todas as parcelas compartilham o mesmo arquivo): um título
     parcelado em três vira UMA nota, e entra se qualquer parcela
     cair no período. */
  function procurar(f) {
    const campo = CAMPO_DATA[f.campo] ? f.campo : 'pago_em';
    const busca = String(f.fornecedor || '').trim().toLowerCase();
    const porTitulo = {};
    let sigilosos = 0, medicosFora = 0;
    S.todasParcelas().forEach(function (p) {
      if (p.status === 'cancelado' || p.status === 'substituido' || p.status === 'previsto') return;
      const dt = String(p[campo] || '').slice(0, 10);
      if (!dt || (f.de && dt < f.de) || (f.ate && dt > f.ate)) return;
      /* Só o que já foi PAGO: o .zip é o lastro do que saiu do caixa
         (é o que o contador pede); conta em aberto ainda pode mudar. */
      if (p.status !== 'pago') return;
      if (f.empresa && S.empresaDaParcela(p) !== f.empresa) return;
      if (S.tituloSigiloso(p)) { sigilosos++; return; }
      const cred = D.credor(p.credor) || {};
      /* Médico só entra se o cadastro diz PJ (emite nota). O de SCP
         recebe distribuição de resultado, não tem nota — e são
         centenas por mês: listá-los afogaria as poucas notas reais. */
      if (cred.tipo === 'medico' && cred.regime !== 'pj') { medicosFora++; return; }
      const nomeCred = ERP.lancamento.nomeCredor(p.credor) || '';
      if (busca) {
        const doc = String(cred.documento || '').replace(/\D/g, '');
        const alvo = (nomeCred + ' ' + (p.doc || '') + ' ' + doc).toLowerCase();
        const buscaDig = busca.replace(/\D/g, '');
        if (alvo.indexOf(busca) < 0 && !(buscaDig.length >= 4 && doc.indexOf(buscaDig) > -1)) return;
      }
      const k = p.titulo_id || p.id;
      const ja = porTitulo[k];
      if (ja) {
        ja.valor = Math.round((ja.valor + (Number(p.valor) || 0)) * 100) / 100;
        /* O arquivo trocado pelo Editar fica só naquela parcela: vale
           o que tiver conteúdo, não o da primeira parcela que aparecer. */
        const an = S.anexoDaParcela(p);
        if (an && !an.so_nome && (!ja.anexo || ja.anexo.so_nome)) ja.anexo = an;
        else if (an && !ja.anexo) ja.anexo = an;
        return;
      }
      porTitulo[k] = { p: p, credor: nomeCred, documento: cred.documento || '',
        valor: Number(p.valor) || 0, anexo: S.anexoDaParcela(p) };
    });
    let linhas = Object.keys(porTitulo).map(function (k) { return porTitulo[k]; });
    if (f.tipo && f.tipo !== 'todos') {
      linhas = linhas.filter(function (l) { return l.anexo && !l.anexo.so_nome && tipoDoArquivo(l.anexo.nome) === f.tipo; });
    }
    linhas.sort(function (a, b) {
      return String(a.p[campo] || '').localeCompare(String(b.p[campo] || '')) ||
        a.credor.localeCompare(b.credor, 'pt-BR');
    });
    const comArquivo = linhas.filter(function (l) { return l.anexo && !l.anexo.so_nome; });
    return {
      campo: campo, linhas: linhas, comArquivo: comArquivo,
      soNome: linhas.filter(function (l) { return l.anexo && l.anexo.so_nome; }),
      semArquivo: linhas.filter(function (l) { return !l.anexo; }),
      sigilosos: sigilosos, medicosFora: medicosFora,
      xml: comArquivo.filter(function (l) { return tipoDoArquivo(l.anexo.nome) === 'xml'; }).length,
      pdf: comArquivo.filter(function (l) { return tipoDoArquivo(l.anexo.nome) === 'pdf'; }).length
    };
  }

  function filtrosDaTela() {
    return { campo: U.val('bn-campo'), de: U.val('bn-de'), ate: U.val('bn-ate'),
      empresa: U.val('bn-empresa'),
      tipo: U.val('bn-tipo'), fornecedor: U.val('bn-fornecedor') };
  }

  function render() {
    montarFiltros();
    const f = filtrosDaTela();
    const saida = U.el('bn-saida');
    if (!saida) return;
    if (f.de && f.ate && f.de > f.ate) {
      ultimo = null;
      saida.innerHTML = '<div class="ajuda erro">A data inicial é depois da final.</div>';
      return;
    }
    const r = procurar(f);
    ultimo = { r: r, f: f };
    const rotCampo = CAMPO_DATA[r.campo].toLowerCase();
    const sit = l => l.anexo && !l.anexo.so_nome ? U.esc(l.anexo.nome)
      : l.anexo ? '<span class="sub">só o nome — arquivo não guardado</span>'
        : '<span class="sub">sem arquivo</span>';
    saida.innerHTML =
      '<div class="resumo-linha" id="bn-resumo"><span><b>' + r.comArquivo.length + '</b> arquivo(s) para baixar' +
        (r.comArquivo.length ? ' (' + r.xml + ' XML · ' + r.pdf + ' PDF' +
          (r.comArquivo.length - r.xml - r.pdf ? ' · ' + (r.comArquivo.length - r.xml - r.pdf) + ' outro(s)' : '') + ')' : '') +
        ' · ' + r.linhas.length + ' pagamento(s) com ' + rotCampo + ' no período</span>' +
        '<span class="v"><button class="btn-aprovar" id="bn-baixar"' + (r.comArquivo.length ? '' : ' disabled') +
        '>Baixar .zip</button></span></div>' +
      (r.semArquivo.length ? '<div class="ajuda">' + r.semArquivo.length +
        ' título(s) do período sem arquivo anexado — ficam de fora do .zip e aparecem na lista abaixo.</div>' : '') +
      (r.soNome.length ? '<div class="ajuda erro">' + r.soNome.length + ' título(s) lançados antes da v179 têm só o ' +
        'NOME do arquivo: o lançamento não guardava o conteúdo. Para entrarem no .zip, anexe o arquivo de novo ' +
        'pela Nota fiscal do título.</div>' : '') +
      (r.sigilosos ? '<div class="ajuda">' + r.sigilosos + ' parcela(s) de pessoal ficaram de fora (seu perfil não ' +
        'vê dados pessoais).</div>' : '') +
      (r.linhas.length
        ? '<table class="rel"><thead><tr><th>Fornecedor</th><th>NF</th><th>Emissão</th>' +
          '<th>Vencimento</th><th class="num">Valor</th><th>Arquivo</th></tr></thead><tbody>' +
          r.linhas.map(function (l) {
            return '<tr' + (l.anexo && !l.anexo.so_nome ? '' : ' class="sub"') + '><td>' + U.esc(l.credor || '—') + '</td>' +
              '<td class="mono">' + U.esc(l.p.doc || '—') + '</td>' +
              '<td class="mono">' + (l.p.emissao ? U.fData(l.p.emissao) : '—') + '</td>' +
              '<td class="mono">' + (l.p.venc ? U.fData(l.p.venc) : '—') + '</td>' +
              '<td class="num">' + U.num(l.valor) + '</td><td style="word-break:break-all">' + sit(l) + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="ajuda">Nenhum título com ' + rotCampo + ' neste período e filtros.</div>');
    if (U.ajustarColunas) U.ajustarColunas(saida);
    if (U.el('bn-baixar')) U.el('bn-baixar').addEventListener('click', baixarLote);
  }

  /* Planilha-índice dentro do .zip: quem recebe a pasta (o contador)
     sabe de que título e de que fornecedor é cada arquivo sem abrir
     um por um. Separador ; e BOM, que é como o Excel em português
     abre sem perguntar nada. */
  function indiceCSV(itens) {
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const cab = ['Arquivo', 'Fornecedor', 'CNPJ/CPF', 'NF', 'Emissão', 'Vencimento', 'Pagamento', 'Valor', 'Situação'];
    return '﻿' + [cab.map(q).join(';')].concat(itens.map(function (x) {
      const p = x.l.p;
      return [x.nome, x.l.credor, x.l.documento, p.doc || '', p.emissao ? U.fData(p.emissao) : '',
        p.venc ? U.fData(p.venc) : '', p.pago_em ? U.fData(p.pago_em) : '', U.num(x.l.valor),
        'pago'].map(q).join(';');
    })).join('\r\n');
  }

  async function baixarLote() {
    if (!ultimo || !ultimo.r.comArquivo.length) return ERP.app.aviso('Nenhum arquivo para baixar.', 'erro');
    if (typeof JSZip === 'undefined') {
      return ERP.app.aviso('O componente de compactação não carregou — recarregue a página (Ctrl+F5).', 'erro');
    }
    const r = ultimo.r, f = ultimo.f;
    const btn = U.el('bn-baixar');
    if (btn) { btn.disabled = true; btn.textContent = 'Montando…'; }
    try {
      const zip = new JSZip();
      const usados = {};
      const entrou = [];
      const falhou = [];
      let k = 0;
      for (const l of r.comArquivo) {
        k++;
        if (btn) btn.textContent = 'Baixando ' + k + ' de ' + r.comArquivo.length + '…';
        const c = await conteudo(l.anexo);
        if (c.erro) { falhou.push(l.anexo.nome + ' (' + (l.credor || 'sem fornecedor') + ')'); continue; }
        /* O nome é o do arquivo anexado. Dois com o mesmo nome — acontece
           com "nota.pdf" — se sobrescreveriam dentro do .zip, e o pacote
           sairia com menos arquivos do que diz ter, calado. */
        let nome = String(l.anexo.nome || 'nota').replace(/[\\/:*?"<>|]+/g, '_');
        const chave = nome.toLowerCase();
        if (usados[chave]) {
          const ponto = nome.lastIndexOf('.');
          nome = (ponto > 0 ? nome.slice(0, ponto) : nome) + ' (' + (++usados[chave]) + ')' + (ponto > 0 ? nome.slice(ponto) : '');
        } else { usados[chave] = 1; }
        zip.file(nome, c.blob);
        entrou.push({ nome: nome, l: l });
      }
      if (!entrou.length) return ERP.app.aviso('Nenhum arquivo pôde ser baixado: ' + falhou.join(' · '), 'erro');
      zip.file('_indice.csv', indiceCSV(entrou));
      const nomeZip = 'notas-a-pagar-' + CAMPO_ARQ[r.campo] + '-' +
        (f.de ? U.fData(f.de).replace(/\//g, '-') : 'inicio') + '-a-' +
        (f.ate ? U.fData(f.ate).replace(/\//g, '-') : 'hoje') + '.zip';
      entregar(await zip.generateAsync({ type: 'blob' }), nomeZip);
      ERP.app.aviso(nomeZip + ' — ' + entrou.length + ' arquivo(s)' +
        (falhou.length ? '. NÃO entraram: ' + falhou.join(' · ') : '.'), falhou.length ? 'erro' : 'ok');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Baixar .zip'; }
    }
  }

  function montar() {
    ['bn-campo', 'bn-de', 'bn-ate', 'bn-empresa', 'bn-tipo'].forEach(function (id) {
      if (U.el(id)) U.el(id).addEventListener('change', render);
    });
    if (U.el('bn-fornecedor')) U.el('bn-fornecedor').addEventListener('input', render);
  }

  return { BALDE: BALDE, guardar: guardar, conteudo: conteudo, baixarOriginal: baixarOriginal,
    procurar: procurar, render: render, montar: montar, baixarLote: baixarLote };
})();
