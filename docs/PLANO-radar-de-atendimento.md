# Radar de Atendimento — plano e estado da implementação

> Estudo de viabilidade completo (números medidos, custos, riscos):
> artifact "Radar de Atendimento" de 2026-08-27. Este arquivo é o recorte
> operacional que vive com o código.

## O que é

Aba **/radar**: a IA lê as conversas dos últimos 7 dias (prioridade às
últimas 72h) e aponta, por conversa — nota de atendimento (0–10), pedidos
do cliente não atendidos, insatisfação, urgência, menção a processo — com
**evidência obrigatória** (trecho + mensagem). Métricas de tempo (1ª
resposta, mediana, "cliente aguardando há X") são **determinísticas**, em
horas úteis (seg–sex 08h–19h, São Paulo), e funcionam mesmo sem chave de
IA. A IA sinaliza; **o operador decide** — daqui ele salta para o chat
(`/inbox?c=`).

## Arquitetura

```
agendador (VPS, laço lento 900s)
  → GET /api/cb/radar/cron  (x-cron-secret; maxDuration 60)
    → rodarCicloDoRadar: recolhe travadas → candidatas (canal com
      radar_enabled, 1:1, atividade em 7d, msg nova desde a última
      análise, throttle 30min) → lote de 5 → por conversa:
        métricas (SQL/JS) + regex CNJ + generateStructured (JSON) →
        UPDATE cb_conversation_insights (1 linha viva por conversa)
  → painel /radar lê a tabela (RLS), ordena por severidade+recência
```

- **Worker**: `src/lib/cb-radar/worker.ts`. Claim `status='running'` +
  `running_desde` (molde 925/928); falha vira `failed` + `tentativas`
  (retentar é seguro — nada sai para o cliente).
- **Rubrica**: `src/lib/cb-radar/rubrica.ts` — transcrito numerado,
  prompt com anti-injeção, esquema JSON, parser que **descarta sinal sem
  evidência válida** (`sinaisDescartados` mede a poda).
- **Saída estruturada**: `src/lib/ai/structured.ts` — módulo separado do
  `generateReply` de propósito (o caminho do auto-reply fica intocado).
  OpenAI `response_format` estrito · Anthropic `tools`+`tool_choice` ·
  Gemini `responseSchema`.
- **Gemini**: `src/lib/ai/providers/gemini.ts` — terceiro provedor BYO,
  disponível também para rascunho/auto-resposta/playground. Chave no
  header `x-goog-api-key`, nunca na URL. Embeddings (RAG) continuam
  exigindo chave OpenAI.
- **Ciclo de vida do sinal**: aberto → tratado | descartado (rota PATCH,
  papel `agent`+). `tratado` reabre SÓ com mensagem **do cliente**
  posterior ao tratamento (a resposta do operador não reabre, e um clique
  durante a análise não é atropelado); `descartado` **nunca** reabre
  sozinho — é o dado de calibração (falso positivo) e volta só pelo botão.
- **Migration 941**: tabela + índices, `messages (conversation_id,
  created_at)`, `cb_channels.radar_enabled` (default FALSE),
  `'gemini'`/`'radar'` nos CHECKs, `ultimo_ciclo_radar` no batimento.

## Para LIGAR em produção (runbook)

1. **Deploy normal** (merge → push main). ✅ **O passo manual da VPS JÁ
   FOI FEITO** (2026-08-27): o `agendador` foi reimplantado com `cb/radar`
   no laço lento, com a imagem do `crm_crm` pinada no digest vigente
   (conferido idêntico antes/depois). Até o merge, o curl recebe 404
   inofensivo; no instante em que o CI publicar a imagem nova, o ciclo
   passa a rodar sozinho. Backup do stack file antigo em
   `/root/docker-stack.yml.bak-2026-08-27`.
2. **Chave de IA**: Configurações → Assistente de IA → provedor Gemini
   (ou OpenAI/Anthropic), modelo (sugerido `gemini-3.7-flash`), chave do
   **tier pago** (a faixa gratuita do Google pode usar os dados) e
   **Ativar** o interruptor mestre.
3. **Ligar por canal**: Configurações → Conexões → Configurar →
   "Radar de Atendimento neste número". Nasce desligado (sigilo; há canal
   pessoal na conta).
4. Aguardar o ciclo (≤15 min) e abrir **/radar**.

## Calibração (primeiras semanas)

- Comparar sinais/nota com o julgamento do operador; **descartar** o que
  estiver errado (é o que mede o falso positivo — `sinaisDescartados` e
  os descartes ficam gravados).
- Testar `gemini-3.7-flash` vs um tier acima (Sonnet 5) nas mesmas
  conversas antes de fixar o modelo — trocar é editar um campo.
- Custo esperado no volume atual: poucos US$/mês (tabela no estudo).
  Consumo aparece em Configurações → Agentes de IA → uso (modo `radar`).

## Fora do MVP (próximas evoluções)

- Salto até a **mensagem** citada dentro do fio (`/inbox?c=…&m=…` — o
  mecanismo de salto existe; falta a entrada por URL).
- Recorte por atendente (`messages.sender_id` já é gravado nas novas).
- Notificação no sino para urgência alta.
- Tendência da nota por semana; expediente configurável por conta
  (hoje: constante em `src/lib/cb-radar/horario-comercial.ts`).
- Transcrição de áudio (docs/PLANO-transcricao-e-midia-na-ia.md) — ~20%
  das mensagens não têm texto e a análise declara essa lacuna.
- Grupos (exigiria `cb_groups.channel_id` — ver CLAUDE.md).
