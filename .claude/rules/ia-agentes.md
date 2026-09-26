---
paths:
  - "src/lib/ia-agentes/acesso*"
  - "src/lib/ia-agentes/conhecimento*"
  - "src/lib/ia-agentes/pedido*"
  - "src/app/api/cb/ia/agentes/**"
  - "src/components/agentes-de-ia/acesso-do-agente.tsx"
  - "src/components/agentes-de-ia/base-do-agente.tsx"
  - "src/components/agentes-de-ia/playground-do-agente.tsx"
  - "supabase/migrations/1052_cb_ia_agente_documentos.sql"
---

# Agentes de IA — o que cada agente vê (F3, 1052)

Plano: `docs/PLANO-agentes-de-ia.md` (5.5, D20, F3). O motor, a fila e a pausa
estão em `.claude/rules/ia.md`.

- ⚠️⚠️ **Nada marcado = o agente vê SÓ a conversa** (`cb_ia_agentes.acesso`,
  `lerAcesso`: só o booleano `true` liga; `campos` = ids de `custom_fields`,
  até 50). É dado de cliente indo a provedor externo: fechado por padrão,
  como o `radar_enabled`. Bloco NÃO marcado não é nem LIDO.
- ⚠️ **Os blocos são para o MODELO** (inglês, como o texto-base), com teto de
  1.500 caracteres por bloco e corte declarado. Leitura que falha vira
  "unavailable right now" — nunca "sem dívida", "sem card" ou "nenhuma
  reunião" sem a leitura (`blocoIndisponivel`; o Playground não conta esse
  bloco como visto). ⚠️ Nas cobranças, as RESSALVAS (dado velho, parcelas
  em conferência) e o total vêm ANTES das parcelas: o teto corta pelo fim.
- **Reunião**: o próximo `invitee.created` sem `invitee.canceled` para o
  mesmo `invitee_uri` (reagendar cancela o antigo), com o link de remarcar.
- **Negócio**: o card do turno (`turno.deal_id`); no Playground, o aberto
  mais recente do contato. Valor 0 não é mostrado (é o DEFAULT de `deals`).
- ⚠️⚠️ **Base por agente (D20)**: `cb_ia_agente_documentos` (fechada ao
  navegador; FKs compostas pela conta; CASCADE dos dois lados; arquivar o
  agente NÃO apaga o vínculo). A busca é pelas funções NOVAS
  `cb_ia_buscar_conhecimento_semantico`/`_fts` — agente nulo ou sem documento
  = NADA. As `match_ai_knowledge_*` (0903, "nulo = sem recorte") ficam para o
  rascunho ✨; o agente nunca passa por elas.
- ⚠️ **A busca por palavras é OU** (qualquer palavra de 3+ letras da
  pergunta, ordenado por `ts_rank`): `plainto_tsquery` da mensagem inteira
  exigia TODAS as palavras, e com o dicionário `simple` a base quase nunca
  entrava. Sem acento tirado: "horario" não casa "horário" (limite).
- **O embedding da pergunta tem teto** (`PRAZO_DO_EMBEDDING_MS`, 8 s): a base
  é melhor esforço e não pode tirar a resposta do prazo do turno.
- **Agente sem documento custa UMA leitura**: a chave de embeddings chega
  como função e só é lida quando há o que buscar.
- ⚠️ **Ordem no turno**: o teto por conta (`checkRateLimit`) vem ANTES de
  ler blocos e base — turno barrado não lê dado do cliente nem paga busca.
- **O retrato** (`cb_ia_turnos.contexto`: blocos renderizados, ids dos
  documentos e o TEXTO de cada trecho — o documento pode mudar depois) é
  gravado numa escrita separada, com a cerca de posse (zero linhas = posse
  perdida: abandona antes de gerar), e ZERADO ao reagendar. "Documento
  apagado" só com a lista de documentos completa (abaixo de 1.000). A sub-aba Turnos o mostra; ⚠️ deploy antes da 1052 =
  a aba Turnos em 500 (ela pede a coluna).
- **Playground**: `contactId` opcional (conferido na conta; fora = 404
  `contato_nao_encontrado`) e `vistos: { blocos, trechos }` — TRECHOS, não
  documentos.
- **Limite conhecido**: dois PUT simultâneos de documentos do mesmo agente
  podem deixá-lo sem documento (insere e depois apaga, sem trava).
