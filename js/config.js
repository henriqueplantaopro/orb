/* Ligação com o banco.

   A chave `anon` é pública por natureza: ela identifica o projeto,
   não a pessoa. Quem decide o que cada um lê é a matriz de acesso
   dentro do Postgres — por isso ela pode viver aqui, no código que
   vai para o navegador.

   A outra chave do painel, a `service_role`, NUNCA entra aqui nem
   em lugar nenhum do repositório: ela ignora toda a segurança.

   Deixando `url` em branco, o sistema roda no modo local de sempre,
   com o seletor de usuário e sem guardar nada. É assim que a
   bateria de testes continua rodando. */
window.ERP = window.ERP || {};
ERP.config = {
  url: 'https://jsdyowuqehryfwqyklax.supabase.co',
  anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzZHlvd3VxZWhyeWZ3cXlrbGF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5NDM4ODIsImV4cCI6MjEwNjUxOTg4Mn0.UPFhyMPwmM9DzyiRnjTg3EQGPg9KvcIQcP6wHM5WRSg'
};
