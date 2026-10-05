-- ERP Dom Pedro — a trilha não se altera
-- Etapa 20.
--
-- A auditoria apontou com razão: UPDATE e DELETE em `eventos`
-- voltavam 204 com zero linha, não 42501. Ou seja, o privilégio
-- estava concedido e o que segurava era a AUSÊNCIA de política
-- permissiva. Funciona hoje; deixa de funcionar no dia em que
-- alguém criar uma política ampla ali — e ninguém vai lembrar de
-- conferir, porque ninguém decidiu.
--
-- "Nem o administrador altera a trilha" tem de ser verdade por
-- decisão. Trilha que o administrador reescreve não prova nada:
-- num questionamento, a defesa seria exatamente essa.

revoke update, delete, truncate on eventos from authenticated, anon;

-- Inserir continua liberado: é o que a aplicação faz o tempo todo.
grant insert on eventos to authenticated;

-- A leitura permanece como está: só quem tem Administração ou a
-- ação `admin` lê a trilha (política `ver_eventos`, da etapa 02).

-- Conferência (como qualquer perfil, pela API):
--   PATCH  /rest/v1/eventos?id=eq.1  → 42501, não 204
--   DELETE /rest/v1/eventos?id=eq.1  → 42501, não 204
