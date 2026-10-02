# ERP Dom Pedro Saúde

Sistema de gestão financeira, estoque, procedimentos, faturamento e
pessoal da HJM Dom Pedro. Sem framework, sem build: é HTML, CSS e
JavaScript que roda abrindo o `index.html`.

## Como rodar agora

Abra o `index.html` no navegador. Não precisa de servidor, nem de
`npm install`, nem de nada instalado.

**Os dados não persistem.** Recarregar a página volta ao estado
inicial. É assim de propósito até a migração para o banco (veja
`docs-projeto/PLANO-MIGRACAO.md`) — o sistema hoje serve para
operar, treinar e conferir regra, não para guardar.

## Testes

```bash
node teste-fumaca.js          # 1321 verificações
node varredura-permissoes.js  # 32 funções de escrita × 11 perfis
node varredura-duplicatas.js  # função definida duas vezes = erro
node varredura-formato.js     # número e data fora do padrão = erro
```

As quatro precisam passar antes de qualquer entrega. A bateria roda
em segundos e é a rede que segurou quatro auditorias externas.

## Como está organizado

```
index.html          a aplicação inteira, uma página
css/erp.css
js/store.js         toda a lógica de negócio e o estado
js/dados.js         cadastros e dados de exemplo
js/ui-*.js          uma tela por módulo
supabase/           o banco: esquema, políticas de acesso e carga
docs-projeto/       plano de migração, auditorias e decisões
```

**A regra de negócio vive no `store.js`.** As telas não decidem
nada: elas chamam o store e mostram o que ele responde. Regra que
só existe na tela é defeito, e foi o achado mais recorrente das
auditorias.

## Publicar

O projeto é estático, então qualquer hospedagem serve. Na Vercel,
importar o repositório e publicar — não há passo de build.

Enquanto a migração do banco não terminar, o que for publicado é a
versão sem persistência. Serve para a equipe conhecer o sistema;
não serve para operar.

## O banco

Os três arquivos de `supabase/` sobem o Postgres completo: 43
tabelas, as políticas de acesso derivadas da matriz de perfis, e os
cadastros reais. O roteiro de execução está em
`docs-projeto/INSTRUCOES-AGENTE.md`.

A matriz de acesso vale **dentro do banco**, não só na tela: no
Supabase o navegador fala direto com o Postgres, e esconder o botão
não esconde o dado.

## Decisões que parecem bug e não são

Estão listadas em `docs-projeto/BRIEFING-AUDITORIA.md`. Vale ler
antes de "consertar" algo: material consumido de outro armazém do
mesmo hospital, imposto retroativo, plantão estimado, um médico por
cirurgia e editar procedimento como substituição são todas
deliberadas, com o porquê escrito.
