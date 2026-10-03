-- ============================================================
-- 1076 — Índice dos valores de campo personalizado POR CAMPO
--        (`contact_custom_values.custom_field_id`).
--
-- A tabela só tinha a chave primária e o único `(contact_id,
-- custom_field_id)`, que começa pelo CONTATO. A pergunta "todos os valores
-- DESTE campo na conta" varria a tabela inteira. Quem a faz: a pauta de
-- reuniões (`/api/cb/reunioes`, PR #377), que lê o campo "Data e Hora
-- Reunião" de todos os contatos — a data da ficha remarca a última reunião do
-- Calendly — a cada carga da tela e do Meu dia (Codex, PR #377).
--
-- Medido em 03/10/2026 na produção: 8.663 linhas (2 MB), varredura de 1,9 ms
-- e a consulta inteira em 8,2 ms. A tabela cresce com contatos × campos, e
-- sem o índice cada carga da pauta ficaria proporcionalmente mais lenta, sem
-- erro nenhum.
--
-- Índice CHEIO em `custom_field_id`: o filtro é por campo, e o embed
-- `contacts!inner` recorta a conta pelo contato depois.
--
-- ⚠️ ADITIVA: nenhum código depende do índice — sem ele a consulta responde
-- certo, só mais devagar. Pode entrar antes ou depois do deploy. Tabela
-- escrita pela ingestão e pelas automações: `lock_timeout` curto para não
-- enfileirar escritas atrás da construção (alguns milissegundos no tamanho de
-- hoje).
-- ============================================================

SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS contact_custom_values_custom_field_id_idx
  ON public.contact_custom_values (custom_field_id);

COMMENT ON INDEX public.contact_custom_values_custom_field_id_idx IS
  'Os valores de UM campo na conta (1076): a pauta de reuniões lê "Data e Hora Reunião" de todos os contatos. Sem ele, a pergunta varria a tabela inteira.';

-- ============================================================
-- Conferência — verdade em banco VAZIO: o índice existe e começa pelo campo.
-- Sem REVOKE, logo sem GRANT a devolver; sem dado exigido.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'contact_custom_values'
       AND indexname = 'contact_custom_values_custom_field_id_idx'
       AND indexdef LIKE '%(custom_field_id)%'
  ) THEN
    RAISE EXCEPTION '1076: o índice contact_custom_values_custom_field_id_idx não foi criado';
  END IF;
  RAISE NOTICE '1076: índice por custom_field_id no lugar.';
END $$;
