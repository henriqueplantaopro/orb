#!/usr/bin/env node
/* enviar-rps.js — utilitário de linha de comando.

   Roda na máquina que tem o certificado A1. O ERP gera o arquivo de
   RPS; este programa envia ao web service da prefeitura, acompanha o
   processamento e baixa o retorno.

   A regra que vale a pena respeitar: PRIMEIRO em homologação, depois
   com --validar em produção (que confere o layout sem gerar nota), e
   só então o envio de verdade. Nota emitida errada dá trabalho pra
   cancelar.

   Uso:
     node enviar-rps.js validar  arquivo.txt
     node enviar-rps.js enviar   arquivo.txt [--producao]
     node enviar-rps.js status   PROTOCOLO
     node enviar-rps.js listar   2026-09-25 [TODAS|-2|-1|0|1|2]
     node enviar-rps.js baixar   NOME_DO_ARQUIVO_DE_RETORNO
     node enviar-rps.js envelope arquivo.txt     (mostra o XML, sem enviar)

   Configuração: copie config.exemplo.json para config.json e preencha.
   O config.json guarda a senha do certificado — mantenha fora de
   qualquer pasta sincronizada e fora do controle de versão. */
'use strict';

const fs = require('fs');
const path = require('path');
const ws = require('./barueri-ws');

const args = process.argv.slice(2);
const comando = args[0];
const alvo = args[1];
const producao = args.indexOf('--producao') > -1;

function carregarConfig() {
  const caminho = path.join(__dirname, 'config.json');
  if (!fs.existsSync(caminho)) {
    console.error('Falta o config.json. Copie config.exemplo.json, preencha e rode de novo.');
    process.exit(1);
  }
  const c = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  c.ambiente = producao ? 'producao' : (c.ambiente || 'homologacao');
  c.endpoint = ws.ENDPOINTS[c.ambiente];
  if (!c.certificado || !c.inscricao_municipal || !c.cnpj) {
    console.error('config.json incompleto: certificado, inscricao_municipal e cnpj são obrigatórios.');
    process.exit(1);
  }
  return c;
}

function registrar(nome, conteudo) {
  const dir = path.join(__dirname, 'retornos');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const caminho = path.join(dir, nome);
  fs.writeFileSync(caminho, conteudo, 'latin1');
  return caminho;
}

/* Registro do que foi enviado: sem isto, ninguém sabe qual arquivo
   gerou qual protocolo — e é essa a pergunta quando algo dá errado. */
function anotar(linha) {
  fs.appendFileSync(path.join(__dirname, 'envios.log'),
    new Date().toISOString() + ' ' + linha + '\n', 'utf8');
}

async function principal() {
  if (!comando || comando === 'ajuda' || comando === '--help') {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].split('Uso:')[1].trim());
    return;
  }

  if (comando === 'envelope') {
    /* Só mostra o que seria enviado — serve pra conferir o XML antes de
       ter certificado em mãos. */
    const conteudo = fs.readFileSync(alvo);
    console.log(ws._envelope('NFeLoteEnviarArquivo',
      '<NFeLoteEnviarArquivo><ArquivoRPSBase64>' +
      conteudo.toString('base64').slice(0, 60) + '…</ArquivoRPSBase64></NFeLoteEnviarArquivo>'));
    return;
  }

  const config = carregarConfig();
  console.log('Ambiente: ' + config.ambiente.toUpperCase() +
    (config.ambiente === 'producao' ? '  ← gera nota de verdade' : '  (teste, não gera nota)'));

  if (comando === 'validar' || comando === 'enviar') {
    if (!alvo || !fs.existsSync(alvo)) { console.error('Informe o arquivo de RPS.'); process.exit(1); }
    const apenasValidar = comando === 'validar';
    const r = await ws.enviarEAcompanhar(config, alvo, { apenasValidar: apenasValidar });
    anotar(comando + ' ' + alvo + ' ambiente=' + config.ambiente +
      ' protocolo=' + (r.protocolo || '-') + ' situacao=' + (r.situacao || '-') +
      (r.erro ? ' ERRO=' + r.erro : ''));
    if (r.erro) { console.error('Falhou na etapa "' + r.etapa + '": ' + r.erro); process.exit(2); }
    console.log('Protocolo: ' + r.protocolo);
    console.log('Situação:  ' + (r.situacao_texto || '—'));
    if (r.retorno) {
      const nome = (r.arquivo_retorno || ('retorno-' + r.protocolo + '.txt'));
      console.log('Retorno salvo em: ' + registrar(nome, r.retorno));
      console.log('--- primeiras linhas do retorno ---');
      console.log(r.retorno.split(/\r?\n/).slice(0, 5).join('\n'));
    }
    if (r.situacao === '2') {
      console.log('\nO arquivo voltou COM ERROS. O retorno acima é a crítica: corrija e reenvie ' +
        'com uma nova identificação de remessa (reenviar a mesma dá erro de duplicidade).');
    }
    if (apenasValidar) console.log('\nValidação apenas — nenhuma nota foi gerada.');
    return;
  }

  if (comando === 'status') {
    const r = await ws.statusArquivo(config, alvo);
    if (r.erro) { console.error(r.erro); process.exit(2); }
    console.log('Remessa:  ' + (r.codigo_remessa || '—'));
    console.log('Situação: ' + r.situacao_texto);
    if (r.arquivo_retorno) console.log('Retorno:  ' + r.arquivo_retorno);
    return;
  }

  if (comando === 'listar') {
    const r = await ws.listarArquivos(config, alvo || new Date().toISOString().slice(0, 10), args[2]);
    if (r.erro) { console.error(r.erro); process.exit(2); }
    if (!r.arquivos.length) { console.log('Nenhum arquivo nessa data.'); return; }
    r.arquivos.forEach(function (a) {
      console.log([a.enviado_em, a.remessa, a.nome, a.situacao_texto,
        a.apenas_validacao ? '(só validação)' : ''].join('  '));
    });
    return;
  }

  if (comando === 'baixar') {
    const r = await ws.baixarRetorno(config, alvo);
    if (r.erro) { console.error(r.erro); process.exit(2); }
    console.log('Salvo em: ' + registrar(alvo, r.conteudo || ''));
    return;
  }

  console.error('Comando desconhecido: ' + comando);
  process.exit(1);
}

principal().catch(function (e) {
  console.error('Erro: ' + e.message);
  process.exit(3);
});
