/* Ligação do AMBIENTE DE TESTE com o banco.

   Este arquivo existe só no ramo `teste`: o ramo `main` tem outro,
   apontando para o banco real. Mesmo nome, conteúdos diferentes.

   É o `ambiente: teste` que pinta o topo de laranja — o aviso que
   funciona sem ninguém precisar ler nada. */
window.ERP = window.ERP || {};
ERP.config = {
  url: 'https://kwaxtnooxupqlqxcjevs.supabase.co',
  anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3YXh0bm9veHVwcWxxeGNqZXZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyODg2OTUsImV4cCI6MjEwNjg2NDY5NX0.jlOUnxoSfctwNtzTwKWsrwHtgQciwVIMNVqTdfSJNvA',
  funcaoCriarLogin: 'dynamic-responder',
  versao: 'v104 Â· 09/10/2026',
  ambiente: 'teste'
};
