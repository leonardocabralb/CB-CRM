---
paths:
  - "src/lib/ia-agentes/pedido*"
  - "src/lib/ai/providers/**"
  - "src/lib/ai/generate.ts"
  - "src/lib/ai/usage.ts"
  - "src/lib/ai/types.ts"
  - "src/lib/ia-agentes/precos*"
  - "src/lib/ia-agentes/uso*"
  - "supabase/migrations/1129_cb_ia_uso_com_cache.sql"
---

# O pedido do agente de IA e o CACHE do provedor (1129, 09/11/2026)

Relatório de custo de 09/11/2026 (a análise de tokens): ~85% da entrada de
uma resposta é o "manual" do agente, igual para todo cliente. O provedor
cobra ~10% pelo que já leu, mas SÓ reaproveita o COMEÇO idêntico do pedido.

- ⚠️⚠️ **O pedido sai em TRÊS pedaços** (`partesDoPedidoDoAgente`, `pedido.ts`):
  1) FIXO do agente — papel, regras do sistema, texto-base, instruções,
  regras; 2) FIXO do turno — passagens e ações (sem os horários); 3)
  VARIÁVEL — data e hora, blocos do cliente, base, horários e nota da agenda
  (e, na retomada, a seção dela). Juntos (`juntarPartes`) são o pedido que o
  Playground mostra e que as travas leem (pedido vazado, link inventado).
- ⚠️⚠️ **Nada que muda de turno em turno entra num pedaço fixo.** A data tem
  minuto: no meio do pedido, ela fazia todo o resto parecer novo a cada
  chamada, e o cache errava SEMPRE, sem erro nenhum. Dado novo do turno vai
  para a parte VARIÁVEL; pino `pedido.partes.test.ts` (as fixas não mudam com
  hora, cliente, base nem agenda).
- ⚠️ **A retomada divide o pedaço 1 com o turno** (o mesmo cache): mudar a
  parte fixa do agente só num dos dois separa o cache. Modelo diferente
  também separa (o cache é por modelo).
- **Anthropic**: `system` em blocos com `cache_control: { type: 'ephemeral',
  ttl: '1h' }` nos fixos (`sistemaDaAnthropic`, `TTL_DO_CACHE`). Gravar custa
  2× a entrada e ler 0,1×; o 1 h acerta ~93% no volume do Trabalhista (o
  5 min, ~65%). Abaixo de ~2 chamadas por hora do mesmo agente, o 5 min sai
  mais barato. Mínimo cacheável: 512 tokens (Sonnet e Haiku 5.5).
- **Gemini**: cache IMPLÍCITO, sozinho, a partir de 4.096 tokens iguais no
  começo — o Bancário (~3.800) fica abaixo. Nada a ligar; o lido vem em
  `cachedContentTokenCount`, já DENTRO de `promptTokenCount`.
- ⚠️⚠️ **O uso soma a entrada INTEIRA.** Com cache, o `input_tokens` da
  Anthropic é só o RESTO; `usoDaAnthropic` soma resto + gravado + lido em
  `promptTokens` e põe as partes em `cacheReadTokens`/`cacheWriteTokens`.
  Sem isso, o custo registrado cairia para ~3% do real.
- ⚠️ **`ai_usage_log.cache_leitura_tokens`/`cache_escrita_tokens` (1129)**:
  `logAiUsage` grava só quando há; `cb_ia_uso` soma (`tokens_cache_*`);
  `custoEmDolar` cobra o lido a `cacheLeitura` e o gravado a `cacheEscrita`
  (`precos.ts`). Linha SEM esses preços cobra cheio e 2× — erra para cima.
  Modelo novo da Anthropic ou do Gemini na tabela leva os dois preços.
- **Medido em 09/11/2026** (o comparativo de 108 casos, Sonnet 5.5): 89–97%
  da entrada lida do cache; US$ por chamada de 0,0261 para 0,0107. Qualidade
  igual: 98,0% das checagens contra 97,9% na ordem antiga; no Previdenciário,
  A/B no mesmo dia, 98,0% contra 97,6%.
- **Como conferir em produção**: `ai_usage_log` do modo `agente` com
  `cache_leitura_tokens` nulo em chamadas seguidas do mesmo agente (menos de
  1 h entre elas) = algo variável entrou num pedaço fixo.
