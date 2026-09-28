-- ============================================================
-- 1059 — A trilha do lead (`cb_lead_events`, 912) entra no tempo real.
-- ============================================================
--
-- A 912 deixou a trilha FORA do realtime com um argumento escrito: nenhuma
-- ação que gera evento acontecia na tela onde a trilha é lida. Deixou de
-- valer: o painel da conversa passou a mudar etapa, status e etiqueta, e
-- automações (Calendly, Typebot) e colegas no Kanban movem o card com a
-- conversa aberta. A linha "Avançou de … para …" só aparecia no fio depois de
-- atualizar (pergunta do operador em 28/09/2026). Quem assina é
-- `src/hooks/use-lead-events.ts`, só INSERT, filtrado pelo contato.
--
-- O que muda aqui: SÓ a publicação. Nenhuma coluna e nenhuma policy. O
-- realtime entrega sob a RLS de leitura que já existe (a da 1032: as contas do
-- usuário), então ninguém recebe evento de outra conta.
--
-- ⚠️ SEM lista de colunas no ADD TABLE (a lição da 909: lista fixa congela o
-- payload, e coluna acrescentada depois não viaja).
--
-- ⚠️ REPLICA IDENTITY fica a padrão: o app assina só INSERT, que chega com a
-- linha inteira. UPDATE e DELETE chegariam só com a chave e a RLS não os
-- entregaria (foi o que a 921 precisou corrigir nas anotações), mas a trilha
-- só cresce: `authenticated` nem escreve nela.
--
-- ⚠️ Carga em massa na trilha passa a atravessar o servidor de tempo real,
-- como a das mensagens já atravessava. Medido antes: fora das cargas, ~6
-- eventos por hora; a carga da Kommo de 27/09/2026 gravou 1.171 num segundo.
-- Só recebe quem está com a conversa DAQUELE contato aberta.
--
-- Aditiva e idempotente. Aplicar ANTES do deploy: o app anterior não assina
-- nada, e o novo, sem ela, só não recebe (o canal falha calado e a trilha
-- continua chegando pela busca, como antes). O ADD TABLE trava a tabela em
-- SHARE UPDATE EXCLUSIVE, que não segura leitura nem escrita da trilha — por
-- isso sem `lock_timeout`.
-- ============================================================

-- O realtime entrega sob a RLS: quem assina precisa do SELECT. A 912 já o
-- concede; repetido aqui porque a conferência abaixo o cobra (no-op em
-- produção).
GRANT SELECT ON public.cb_lead_events TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'cb_lead_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cb_lead_events;
  END IF;
END $$;

-- ---- Conferência — o resultado, nunca a intenção -------------
-- Só catálogo: vale igual em produção e no replay do CI contra banco limpo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'cb_lead_events'
  ) THEN
    RAISE EXCEPTION '1059: cb_lead_events fora da publicacao realtime';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_publication_rel pr
      JOIN pg_publication p ON p.oid = pr.prpubid
     WHERE p.pubname = 'supabase_realtime'
       AND pr.prrelid = 'public.cb_lead_events'::regclass
       AND pr.prattrs IS NOT NULL
  ) THEN
    RAISE EXCEPTION '1059: cb_lead_events publicada com lista fixa de colunas';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.cb_lead_events', 'SELECT') THEN
    RAISE EXCEPTION '1059: authenticated nao le cb_lead_events';
  END IF;

  RAISE NOTICE '1059 OK — trilha do lead no tempo real';
END $$;
