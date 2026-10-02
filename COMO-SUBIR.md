# Subir no GitHub e publicar — passo a passo

Cinco minutos. Não precisa de build nem de instalação.

## 1. Criar o repositório

No GitHub, **New repository**:

- Nome: `erp-dom-pedro`
- **Private.** O código tem a estrutura de acesso da empresa e os
  cadastros de clientes, credores e centros de custo. Não é segredo
  de Estado, mas também não é coisa para ficar aberta.
- Não marque "Add a README" — já existe um aqui.

## 2. Subir

Na pasta do projeto, no terminal:

```bash
git init
git add .
git commit -m "ERP Dom Pedro — versão 31"
git branch -M main
git remote add origin https://github.com/<sua-conta>/erp-dom-pedro.git
git push -u origin main
```

Se o Git pedir identificação na primeira vez:

```bash
git config --global user.name "Henrique Magalhães"
git config --global user.email "seu-email@dompedrosaude.com.br"
```

## 3. Publicar na Vercel

1. Em `vercel.com`, **Add New › Project**.
2. Importar `erp-dom-pedro`.
3. Framework Preset: **Other**. Build Command: deixar **vazio**.
   Output Directory: deixar **vazio**. Não há build — são arquivos
   estáticos.
4. Deploy.

Em um minuto você tem um endereço `...vercel.app` que abre o
sistema.

## O que a equipe vai encontrar nesse endereço

O sistema inteiro, funcionando, **sem guardar nada**: ao recarregar
a página, tudo volta ao estado inicial. Serve para conhecer, treinar
e criticar. Não serve para operar.

Diga isso a quem receber o link. Alguém lançar meio dia de trabalho
e perder ao fechar a aba é o jeito mais rápido de o sistema ganhar
má fama antes de existir.

A persistência vem com a migração do banco
(`docs-projeto/PLANO-MIGRACAO.md`). O código já está no repositório
pronto para recebê-la — é a camada de baixo do `store.js` que muda,
não as regras.

## Versões daqui para a frente

Com o repositório de pé, não precisa mais de pasta `v32`, `v33`. O
Git guarda o histórico. Para marcar uma entrega:

```bash
git tag -a v31 -m "auditoria 4 fechada, matriz de acesso nova"
git push --tags
```
