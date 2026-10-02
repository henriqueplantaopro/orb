/* barueri-ws.js — conversa com o web service de RPS da Prefeitura de
   Barueri.

   Este arquivo é o NÚCLEO e não sabe nada sobre linha de comando, tela
   ou banco: recebe dados, devolve dados. É de propósito — quando o ERP
   sair do arquivo local e virar serviço na nuvem, este mesmo módulo vai
   junto, sem reescrita. Só muda quem o chama.

   Como a prefeitura fez (manual "Solução Web Services — Envio de
   Arquivo RPS", v1.00):
   - SOAP sobre HTTPS, autenticação pelo CERTIFICADO do cliente
     (ICP-Brasil, e-CNPJ). Não há usuário nem senha.
   - Todo método recebe dois parâmetros: VersaoSchema (inteiro) e
     MensagemXML (string, dentro de CDATA).
   - O arquivo de RPS vai em base64 — é o mesmo .txt posicional que o
     ERP já gera.
   - O processamento é ASSÍNCRONO: envia → recebe protocolo → consulta
     situação → baixa o retorno.

   Situações do arquivo: -2 aguardando · -1 processando · 0 validado ·
   1 importado · 2 com erros.  */
'use strict';

const https = require('https');
const fs = require('fs');

const ENDPOINTS = {
  producao: 'https://www.barueri.sp.gov.br/nfeservice/wsrps.asmx',
  homologacao: 'https://testeeiss.barueri.sp.gov.br/nfeservice/wsrps.asmx'
};
/* Confirmado na própria página do serviço
   (wsrps.asmx?op=NFeLoteEnviarArquivo): o namespace NÃO é o tempuri
   padrão do .asmx, e o SOAPAction segue o mesmo endereço. Errar isto
   dá "Mensagem XML não compatível" sem explicar por quê. */
const NAMESPACE = 'http://www.barueri.sp.gov.br/nfe';
const VERSAO_SCHEMA = 1;

const SITUACAO = {
  '-2': 'aguardando processamento',
  '-1': 'em processamento',
  '0': 'arquivo validado',
  '1': 'arquivo importado (NF-e geradas)',
  '2': 'arquivo com erros'
};

const esc = s => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* A MensagemXML vai escapada dentro de CDATA, como o manual pede. */
function envelope(metodo, mensagemXml) {
  return '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' +
    ' xmlns:xsd="http://www.w3.org/2001/XMLSchema"' +
    ' xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
    '<' + metodo + ' xmlns="' + NAMESPACE + '">' +
    '<VersaoSchema>' + VERSAO_SCHEMA + '</VersaoSchema>' +
    '<MensagemXML><![CDATA[' + mensagemXml + ']]></MensagemXML>' +
    '</' + metodo + '></soap:Body></soap:Envelope>';
}

/* Extrai o conteúdo de uma tag, ignorando prefixo de namespace. Um
   parser XML completo seria exagero: as respostas são planas. */
function tag(xml, nome) {
  const m = new RegExp('<(?:\\w+:)?' + nome + '[^>]*>([\\s\\S]*?)</(?:\\w+:)?' + nome + '>', 'i').exec(xml || '');
  return m ? m[1].trim() : null;
}
function todasAsTags(xml, nome) {
  const re = new RegExp('<(?:\\w+:)?' + nome + '[^>]*>([\\s\\S]*?)</(?:\\w+:)?' + nome + '>', 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml || ''))) out.push(m[1]);
  return out;
}

/* A resposta vem com o XML interno escapado (&lt;...&gt;). */
function desescapar(s) {
  return String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function credenciais(config) {
  if (!config.certificado) throw new Error('Informe o caminho do certificado A1 (.pfx).');
  if (!fs.existsSync(config.certificado)) throw new Error('Certificado não encontrado: ' + config.certificado);
  return { pfx: fs.readFileSync(config.certificado), passphrase: config.senha || '' };
}

function chamar(config, metodo, mensagemXml) {
  const url = new URL(config.endpoint || ENDPOINTS[config.ambiente || 'homologacao']);
  const corpo = envelope(metodo, mensagemXml);
  const cred = credenciais(config);
  return new Promise(function (resolve, reject) {
    const req = https.request({
      host: url.hostname, path: url.pathname + (url.search || ''), method: 'POST',
      /* A porta vem da URL: fixar 443 quebrava qualquer endpoint
         alternativo (inclusive o de teste). */
      port: url.port || 443,
      pfx: cred.pfx, passphrase: cred.passphrase,
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(corpo),
        /* .asmx exige o SOAPAction com o namespace + nome do método. */
        SOAPAction: '"' + NAMESPACE + '/' + metodo + '"'
      },
      timeout: config.timeout || 120000
    }, function (res) {
      let dados = '';
      res.setEncoding('utf8');
      res.on('data', function (d) { dados += d; });
      res.on('end', function () {
        const interno = desescapar(dados);
        const retorno = {
          http: res.statusCode,
          codigo: tag(interno, 'Codigo'),
          mensagem: tag(interno, 'Mensagem'),
          correcao: tag(interno, 'Correcao'),
          xml: interno, bruto: dados
        };
        if (res.statusCode !== 200) {
          retorno.erro = 'HTTP ' + res.statusCode + (tag(dados, 'faultstring') ? ' · ' + tag(dados, 'faultstring') : '');
        } else if (retorno.codigo && retorno.codigo !== 'OK200') {
          retorno.erro = retorno.codigo + ' · ' + (retorno.mensagem || '');
        }
        resolve(retorno);
      });
    });
    req.on('timeout', function () { req.destroy(new Error('tempo esgotado na chamada ao web service')); });
    req.on('error', reject);
    req.write(corpo);
    req.end();
  });
}

const identificacao = config =>
  '<InscricaoMunicipal>' + esc(config.inscricao_municipal) + '</InscricaoMunicipal>' +
  '<CPFCNPJContrib>' + esc(String(config.cnpj || '').replace(/\D/g, '')) + '</CPFCNPJContrib>';

/* ── os quatro serviços ───────────────────────────────────*/

/* Envia o arquivo. Com `apenasValidar`, a prefeitura só confere o
   layout e NÃO gera nota — é assim que se testa sem consequência. */
async function enviarArquivo(config, caminhoArquivo, apenasValidar) {
  const conteudo = fs.readFileSync(caminhoArquivo);
  const nome = caminhoArquivo.split(/[\\/]/).pop();
  const msg = '<NFeLoteEnviarArquivo>' + identificacao(config) +
    '<NomeArquivoRPS>' + esc(nome) + '</NomeArquivoRPS>' +
    '<ApenasValidaArq>' + (apenasValidar ? 'true' : 'false') + '</ApenasValidaArq>' +
    '<ArquivoRPSBase64>' + conteudo.toString('base64') + '</ArquivoRPSBase64>' +
    '</NFeLoteEnviarArquivo>';
  const r = await chamar(config, 'NFeLoteEnviarArquivo', msg);
  r.protocolo = tag(r.xml, 'ProtocoloRemessa');
  r.arquivo = nome;
  r.apenas_validacao = !!apenasValidar;
  return r;
}

async function statusArquivo(config, protocolo) {
  const msg = '<NFeLoteStatusArquivo>' + identificacao(config) +
    '<ProtocoloRemessa>' + esc(protocolo) + '</ProtocoloRemessa>' +
    '</NFeLoteStatusArquivo>';
  const r = await chamar(config, 'NFeLoteStatusArquivo', msg);
  r.situacao = tag(r.xml, 'SituacaoArq');
  r.situacao_texto = SITUACAO[r.situacao] || r.situacao;
  r.arquivo_retorno = tag(r.xml, 'NomeArqRetorno');
  r.codigo_remessa = tag(r.xml, 'CodigoRemessa');
  return r;
}

async function listarArquivos(config, data, situacao) {
  const msg = '<NFeLoteListarArquivos>' + identificacao(config) +
    '<DataEnvioArq>' + esc(data) + '</DataEnvioArq>' +
    '<SituacaoArq>' + esc(situacao || 'TODAS') + '</SituacaoArq>' +
    '</NFeLoteListarArquivos>';
  const r = await chamar(config, 'NFeLoteListarArquivos', msg);
  r.arquivos = todasAsTags(r.xml, 'ListaNfeArquivosRPS').map(function (bloco) {
    return {
      nome: tag(bloco, 'NomeArquivoOrginal'),
      enviado_em: tag(bloco, 'DataEnvioArq'),
      remessa: tag(bloco, 'CodigoRemessa'),
      apenas_validacao: tag(bloco, 'ApenasValidaArq') === 'true',
      situacao: tag(bloco, 'SituacaoArq'),
      situacao_texto: SITUACAO[tag(bloco, 'SituacaoArq')] || tag(bloco, 'SituacaoArq'),
      arquivo_retorno: tag(bloco, 'NomeArqRetorno')
    };
  });
  return r;
}

/* O retorno pode ser o resultado da conversão (com os números das
   NF-e) ou o arquivo de crítica, quando há erro. */
async function baixarRetorno(config, nomeArquivoRetorno) {
  const msg = '<NFeLoteBaixarArquivo>' + identificacao(config) +
    '<NomeArqRetorno>' + esc(nomeArquivoRetorno) + '</NomeArqRetorno>' +
    '</NFeLoteBaixarArquivo>';
  const r = await chamar(config, 'NFeLoteBaixarArquivo', msg);
  const b64 = tag(r.xml, 'ArquivoRPSBase64');
  /* O retorno também é texto posicional em ISO-8859-1. */
  r.conteudo = b64 ? Buffer.from(b64, 'base64').toString('latin1') : null;
  return r;
}

/* Envia e acompanha até terminar — é o que o serviço na nuvem vai
   chamar quando a liberação acontecer na esteira. */
async function enviarEAcompanhar(config, caminhoArquivo, opcoes) {
  opcoes = opcoes || {};
  const envio = await enviarArquivo(config, caminhoArquivo, opcoes.apenasValidar);
  if (envio.erro || !envio.protocolo) return { etapa: 'envio', ...envio };
  const limite = opcoes.tentativas || 20;
  const espera = opcoes.intervalo_ms || 6000;
  for (let i = 0; i < limite; i++) {
    await new Promise(function (r) { setTimeout(r, espera); });
    const st = await statusArquivo(config, envio.protocolo);
    if (st.erro) return { etapa: 'status', protocolo: envio.protocolo, ...st };
    if (st.situacao === '-2' || st.situacao === '-1') continue;
    let retorno = null;
    if (st.arquivo_retorno) retorno = await baixarRetorno(config, st.arquivo_retorno);
    return { etapa: 'concluido', protocolo: envio.protocolo, situacao: st.situacao,
      situacao_texto: st.situacao_texto, arquivo_retorno: st.arquivo_retorno,
      retorno: retorno ? retorno.conteudo : null };
  }
  return { etapa: 'timeout', protocolo: envio.protocolo,
    erro: 'o lote seguia em processamento depois de ' + limite + ' consultas' };
}

module.exports = {
  ENDPOINTS, SITUACAO,
  enviarArquivo, statusArquivo, listarArquivos, baixarRetorno, enviarEAcompanhar,
  /* expostos para teste sem rede */
  _envelope: envelope, _tag: tag, _desescapar: desescapar
};
