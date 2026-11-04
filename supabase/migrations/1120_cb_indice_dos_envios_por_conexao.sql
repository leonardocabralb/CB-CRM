-- ============================================================
-- 1120 — Índice das mensagens por conexão e data: "os últimos envios desta
-- conexão", a leitura do alarme "envios sem recibo" (`sem-recibo.ts`, nível
-- 4 da saúde das conexões; `docs/PLANO-alarmes-de-conexao.md`, Fase 1).
--
-- A sonda da saúde lê, por conexão de WhatsApp e no máximo a cada minuto por
-- conta, os envios das últimas 24 h (teto de 100). Os índices de `messages`
-- que tocam conexão ou data eram só `(channel_id)` e `(conversation_id,
-- created_at)`. MEDIDO na instalação de referência (04/11/2026, EXPLAIN
-- ANALYZE): sem este, a leitura da conexão mais movimentada levou 973 ms,
-- cruzando as 25 mil mensagens dela com as do dia. Com ele, é um intervalo do
-- índice, já na ordem (conferido no replay local).
--
-- Índice inteiro (só sem as linhas sem conexão), e não parcial pelo tipo de
-- remetente: a tabela é pequena (128 mil linhas, 43 MB em 04/11/2026), e o
-- mesmo índice serve qualquer pergunta "desta conexão, neste período". O
-- `channel_id IS NOT NULL` é implicado por todo `channel_id = …`.
--
-- Aditiva e idempotente. ⚠️ Aplicar ANTES do deploy: o app funciona sem ela,
-- mas cada conta pagaria ~1 s de banco por conexão a cada minuto, num banco
-- que já satura. O CREATE INDEX segura as escritas em `messages` enquanto lê
-- a tabela (não há CONCURRENTLY dentro da transação da migration), como a
-- 1006.
-- ============================================================

SET LOCAL lock_timeout = '5s';

create index if not exists messages_canal_e_data_idx
  on public.messages (channel_id, created_at desc)
  where channel_id is not null;

-- ============================================================
-- Conferência — verdade em banco VAZIO: o índice existe, nas colunas certas.
-- ============================================================
do $$
declare
  v_def text;
begin
  select indexdef into v_def
    from pg_indexes
   where schemaname = 'public' and indexname = 'messages_canal_e_data_idx';
  if v_def is null then
    raise exception '1120: o índice messages_canal_e_data_idx não existe.';
  end if;
  if v_def not like '%(channel_id, created_at DESC)%' then
    raise exception '1120: o índice nasceu com outras colunas (def=%)', v_def;
  end if;
  raise notice '1120: índice dos envios por conexão no lugar.';
end $$;
