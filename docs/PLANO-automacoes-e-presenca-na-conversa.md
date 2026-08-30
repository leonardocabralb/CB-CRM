# Plano — Automações na conversa + presença de membros

> **O que é este arquivo.** Guia retomável das três features pedidas pelo
> operador em 2026-08-30 (referência: print do Kommo): a aba de **automações
> ativas** do cliente com botão de parar, a **execução manual** de
> automação/robô de dentro da conversa, e a **presença** ("quem mais está com
> esta conversa aberta"). **Ele é editado a cada fase**: ao INICIAR uma fase,
> registra-se que a anterior foi concluída — objetivo, arquivos tocados e
> resultado medido — para que qualquer agente pegue o plano e saiba onde parou.
>
> ⚠️ **Este documento envelhece.** Antes de decidir com base em algo aqui,
> confirme contra a realidade (grep, leitura do arquivo, query no banco). Ao
> achar divergência, corrija este arquivo no mesmo PR.

- **Criado:** 2026-08-30 · **Medido contra:** `main` @ `329e743`, produção `hxnhakmyxyhalbsktzwe`
- **Worktree:** `/Users/leonardocabralb/cb-crm-worktrees/automacoes-e-presenca`
  · branch `feat/automacoes-e-presenca-na-conversa` (criada de `origin/main`).
  ⚠️ Este worktree existe para NÃO atropelar as outras sessões — conferir
  `git branch --show-current` antes de todo commit (lição do PR #42).
- **Fluxo por fase:** executar → typecheck/lint/test/i18n-parity → **testar no
  preview em resolução de monitor de verdade (1440×900+)** → revisar 2× →
  PR → **revisar ESTE plano antes da fase seguinte**.

---

## Estado

| Fase | Escopo | Estado | Migration | PR |
| --- | --- | --- | --- | --- |
| **1** | Aba **Automações** no painel da conversa: robô ativo + esperas pendentes, com "Parar" | ⬜ pendente | M-robo (CHECK `stopped_by_agent`) | — |
| **2** | **Executar** automação/robô pelo menu **+** do compositor (popup com busca e confirmação) | ⬜ pendente | nenhuma | — |
| **3** | **Presença por conversa**: avatares discretos de quem mais está com o chat aberto | ⬜ pendente | M-presenca (`cb_conversa_aberta`) | — |
| **4** | Revisão final: CLAUDE.md (tabela de merge), i18n-parity, preview, limpeza | ⬜ pendente | nenhuma | — |

⚠️ **Números de migration NÃO estão fixados aqui de propósito.** Há sessões
paralelas criando migrations (a 953 nasceu ontem). Na hora de criar o arquivo:
`ls supabase/migrations/` **e** `list_migrations` no MCP do Supabase, os dois.

## Decisões a travar com o operador (recomendações já embutidas nas fases)

1. **Parar espera de automação**: por **automação+contato** (cancela todas as
   esperas pendentes daquela automação para aquele cliente — espelha o passo
   `stop_automation` do motor). Alternativa descartada: por espera individual
   (granularidade que o operador não pediu). **Recomendado: automação+contato.**
2. **Robôs (flows) no popup de execução**: incluir, em grupo separado
   ("Automações" / "Robôs"), como o Kommo separa Salesbot. **Recomendado: sim.**
3. **Papel mínimo para executar/parar**: `agent` — o mesmo de enviar mensagem
   (`requireRole('agent')`, como em `whatsapp/send`). Viewer só vê a aba.
4. **Fora da v1** (anotar, não fazer): presença na LISTA de conversas; histórico
   de execuções (`automation_logs`) dentro da aba; executar automação para
   vários clientes de uma vez.

## O que JÁ existe (verificado em 2026-08-30 contra `329e743`)

- **Esperas futuras** de automação (passo "Aguardar") viram linhas em
  `automation_pending_executions` (`status='pending'`, `run_at`, `context`
  JSONB com `channel_id`). O status **`cancelled` já existe** (936) e o cron
  já o produz quando a automação é desativada. A tabela é **service-role only**
  (sem policy de SELECT para o navegador, sem realtime) e tem `account_id`
  NOT NULL (017).
- **Robô em andamento** é `flow_runs` (`status='active'`, no máx. 1 por
  contato — índice parcial), **legível sob RLS** e **já publicado no
  realtime** (010: "inbox pode mostrar em qual robô o contato está").
  Parar = `abortActiveRunsForContact` (`src/lib/flows/parar-run.ts`), que hoje
  só aceita `MotivoDeParada = 'paused_by_agent' | 'stopped_by_automation'`.
- **Acionar por fora do gatilho já existe no motor** (936):
  `runAutomationById` (exige `is_active` e mesma conta; pula `triggerMatches`
  e recortes DE PROPÓSITO) e `startFlowForContact` (exige flow ativo,
  substitui run ativa via `abortActiveRunsForContact`). O passo
  `stop_automation` cancela por automação+conta+**contato**+`status='pending'`.
- **Presença global** (upstream 024): `member_presence` online/away com
  heartbeat de 30 s via RPC `touch_presence` SECURITY DEFINER, realtime, e a
  derivação de offline por staleness em `src/lib/presence.ts`
  (`OFFLINE_AFTER_MS = 75s`). O fio já usa `PresenceDot` no dropdown de
  atribuição. **Nada é por conversa.**
- **Menu + do compositor** (`message-composer.tsx` ~linha 1295): itens
  "Mensagem interativa" e "Respostas rápidas". É ali que entra o item novo.
- **Painel da conversa** é NOSSO (`src/components/inbox/painel/painel-do-contato.tsx`),
  com 5 abas só-ícone: Principal, Notas, Tarefas (badge), Traqueamento,
  Histórico. A aba nova é a 6ª `AbaDeIcone`.
- **Escopo de canal**: `automations.channel_ids` é ARRAY (vazio/null = todos);
  `flows.channel_id` é SINGULAR (903; null = todos). `channelInScope` é
  exportado pelo engine.
- `automation_logs.trigger_event` é TEXT **sem CHECK** → `'manual'` entra sem
  migration.

---

## ⬜ Fase 1 — Aba "Automações" no painel da conversa

**Objetivo:** o operador abre a conversa e vê o que está rodando para aquele
cliente — o robô ativo e as esperas futuras de automação — e consegue PARAR
cada um sem esperar terminar (o pedido literal: cancelar um follow-up semanal
no meio).

**Migration `9XX_cb_parada_manual_do_robo.sql`** (número na hora):
`flow_runs_status_check` ganha `'stopped_by_agent'` — DROP CONSTRAINT + ADD,
no formato da 936, preservando os 7 status existentes na conferência. Motivo:
a 936 registrou que "teve gente ou foi regra?" é a pergunta da auditoria;
gravar parada humana como `stopped_by_automation` mentiria para o investigador.
(`end_reason` é texto livre, sem migration.)

**Backend (módulo novo `src/lib/execucoes/` + rotas `/api/cb/execucoes`):**

| Peça | Conteúdo |
| --- | --- |
| `src/lib/execucoes/agrupar.ts` (puro, com teste) | agrupa esperas por automação (nome, próxima `run_at`, contagem), ordena por `run_at`; formata "acorda em X" fica na tela via `Intl` |
| `GET /api/cb/execucoes?contactId=` | `requireRole('viewer')`; service-role: esperas `pending` do contato (`.eq(account_id)`, `.eq(contact_id)`, `.eq(status,'pending')` + nome via embed `automations(name)`) — a tabela não tem policy de SELECT, por isso rota e não RLS |
| `POST /api/cb/execucoes/parar-automacao` | `requireRole('agent')`; corpo `{contactId, automationId}`; UPDATE → `cancelled` com as MESMAS cercas do passo `stop_automation` (automação+conta+contato+`status='pending'`) |
| `POST /api/cb/execucoes/parar-robo` | `requireRole('agent')`; corpo `{contactId}`; `abortActiveRunsForContact({status:'stopped_by_agent', reason:'stopped_by_agent'})`; alargar o union `MotivoDeParada` em `parar-run.ts` |

**Tela (aba nova no painel):**

- 6ª `AbaDeIcone` `value="automacoes"` (ícone `Zap`), badge = robô ativo (0/1)
  + nº de automações com espera pendente. Robô: consulta `flow_runs` sob RLS
  (client) com embed `flows(name)` + assinatura realtime (já publicado).
  Esperas: `GET /api/cb/execucoes` ao selecionar a conversa; **refetch após
  toda ação** (a tabela não tem realtime — documentar no código).
- Cada linha: nome, "próximo passo em <relativo>", botão Parar com confirmação
  inline (o que se perde: "as mensagens futuras desta automação para este
  cliente não sairão").
- **Grupo**: aba mostra estado explicativo ("Automações não valem para
  grupos") — `contact_id` é nulo e automação não roda em grupo (garantia
  estrutural em `cb-groups/persist.ts`).
- i18n nos DOIS dicionários na mesma passada.

**Armadilhas herdadas (releia antes de codar):** `overflow-y-auto` +
`min-h-0` no `TabsContent` (padrão das outras abas); estado velho de efeito
passivo — sinalizador "carregou uma vez" e comparação contra o
`conversationId` do render atual (mordeu 2× em 2026-08-30); a rota GET trata
erro de banco ANTES de vazio (erro ≠ "não há esperas").

## ⬜ Fase 2 — Executar automação/robô pelo menu +

**Objetivo:** sem esperar gatilho, o operador dispara uma automação ou um robô
para O cliente da conversa aberta. Fica no menu **+** (decisão do operador:
nada de `/` no texto), num popup com busca — como o print do Kommo, mas por
botão.

**Backend:**

- `POST /api/cb/execucoes/executar` — `requireRole('agent')`; corpo
  `{conversationId, tipo: 'automacao'|'robo', id}`. A rota: valida conversa da
  conta e **recusa grupo**; resolve canal = `conversations.channel_id`;
  **checa escopo de canal** (`channelInScope` para automação; para robô,
  `flows.channel_id` nulo ou igual ao da conversa) — `runAutomationById` pula
  esse recorte de propósito (o chamador explícito é quem decide), então a
  guarda mora AQUI; monta `AutomationContext = {conversation_id, channel_id}`
  e chama `runAutomationById` / `startFlowForContact`.
- **Duas mudanças pequenas e aditivas no motor** (arquivos já são "nossos" na
  tabela de merge do CLAUDE.md):
  1. `runAutomationById` ganha parâmetro opcional `rotuloDoDisparo` (default
     `'run_automation'`); a rota passa `'manual'` — senão o log diria que
     outra automação chamou, e a diferença é tudo ao investigar (comentário do
     próprio engine).
  2. `startFlowForContact` ganha opcional `{status, reason}` da substituição
     (default atual `stopped_by_automation`/`replaced_by_automation`); a rota
     passa `stopped_by_agent`/`replaced_by_agent` — mesma honestidade da 936.
- Conferir se alguma tela formata `trigger_event` por chave fixa — se sim,
  rótulo para `'manual'` nos dois dicionários.

**Tela:**

- Item "Executar automação" (ícone `Zap`) no menu + do compositor, escondido
  em conversa de grupo. Abre `<ExecutarAutomacaoDialog>` (componente novo em
  `src/components/inbox/`): busca + dois grupos (Automações `is_active`;
  Robôs `status='active'`), consulta client-side sob RLS. Item fora do escopo
  de canal da conversa: visível porém desabilitado com o motivo ("vale só
  para <canal>") — esconder faria o operador achar que a automação sumiu.
- Clique → confirmação ("Executar 'X' para <contato>? Pode enviar mensagens
  reais.") → POST → toast com o `detail` do motor ("robô iniciado (substituiu
  o anterior)" etc.) → aba da Fase 1 refaz a carga.

**Armadilhas:** conversa antiga sem `channel_id` (pré-903): só entra o que
não tem recorte de canal — decidir mostrar aviso; dialog com sinalizador
"carregou" (não afirmar "nenhuma automação" antes da 1ª resposta — lição do
acervo); contexto fresco não carrega `_cadeia` (ciclo é impossível no 1º
nível; a guarda anti-ciclo existente cobre o resto).

## ⬜ Fase 3 — Presença "quem está nesta conversa"

**Objetivo:** avatarzinho discreto no cabeçalho do fio quando OUTRO membro está
com a mesma conversa aberta, com nome no tooltip.

**Migration `9XX_cb_conversa_aberta.sql`** — clone deliberado do padrão 024:

- Tabela `cb_conversa_aberta(user_id uuid PK → auth.users CASCADE,
  account_id uuid NOT NULL → accounts CASCADE, conversation_id uuid NULL →
  conversations CASCADE, visto_em timestamptz NOT NULL DEFAULT now())` — uma
  linha por membro, a ÚLTIMA conversa aberta; NULL = fora de conversa.
- RLS: SELECT para `is_account_member(account_id)`; **nenhuma** policy de
  escrita (tudo pela RPC). `REVOKE ALL FROM anon` + **GRANT SELECT a
  authenticated e ALL a service_role POR ESCRITO** (banco vazio não tem o
  default privilege do Supabase — regra das nove reprovadas).
- RPC `cb_marcar_conversa_aberta(p_conversation_id uuid)` SECURITY DEFINER,
  conta derivada do profile do chamador (nunca do cliente), upsert por PK
  (índice TOTAL — a armadilha de `onConflict` da 903 é só para parciais).
  REVOKE de PUBLIC/anon + **GRANT a authenticated** (é o navegador que chama)
  e service_role. Conferências `has_*_privilege` nas duas metades.
- Realtime: `ALTER PUBLICATION supabase_realtime ADD TABLE cb_conversa_aberta`
  **SEM lista de colunas** (lição da 909: lista fixa congela o payload).

**Código:**

| Peça | Conteúdo |
| --- | --- |
| `src/lib/presenca-na-conversa.ts` (puro, com teste) | deriva "está vendo agora": mesma conversa + `visto_em` fresco (reusa `OFFLINE_AFTER_MS` de `lib/presence`) + não sou eu; dedupe por user |
| `src/hooks/use-conversa-aberta.ts` | **escritor**: RPC na troca de conversa selecionada + batida a cada `HEARTBEAT_MS` + RPC(null) ao desmontar; guarda contra StrictMode dobrando o efeito (padrão `disparouRef` das Integrações). **leitor**: fetch inicial + `postgres_changes` filtrado por `account_id` (espelho de `use-presence`) |
| `src/components/inbox/avatares-na-conversa.tsx` | fileira de avatares 20px sobrepostos (foto de `profiles`, iniciais como fallback), tooltip "Fulano também está com esta conversa aberta"; some quando vazio |
| `message-thread.tsx` | monta o componente no cabeçalho, ao lado do dropdown de atribuição |

**Armadilhas:** a conta tem **UM membro** hoje (memória: o "Gabriel" é de
outra conta) — testar em dev inserindo linha via service-role; em produção a
feature fica dormente até o convite real. Duas abas do mesmo usuário: linha
única por PK, e o filtro "não sou eu" já esconde. Fechar aba sem RPC(null):
staleness de 75 s resolve (mesma filosofia da 024 — nunca confiar em unload).

## ⬜ Fase 4 — Revisão final

- Atualizar a tabela **"arquivos com mudanças NOSSAS"** do CLAUDE.md:
  `engine.ts` (rótulo manual), `flows/engine.ts` (motivo de substituição),
  `parar-run.ts` (union), `message-composer.tsx` (item Executar),
  `message-thread.tsx` (avatares), `painel-do-contato.tsx` (aba Automações).
- `node scripts/i18n-parity.mjs` · `npm run typecheck` · `npm run lint` ·
  `npm run test` · preview 1440×900+ com evidência (screenshot).
- Revisar 2×: bugs/edge cases; consistência com convenções e objetivo.
- Migrations aplicadas via MCP (`apply_migration`) em ordem, número conferido
  na hora; `supabase db start` se houver dúvida do replay em banco vazio.

## Cortes deliberados (anti-overengineering)

- Nada de cron novo, nada de tabela de "execuções ativas" própria: a verdade
  já mora em `automation_pending_executions` + `flow_runs`.
- Sem realtime para esperas (tabela service-only): refetch após ação basta
  para a v1.
- Sem coluna "quem parou/cancelou" (nem o upstream registra quem pausou);
  registrado como limitação, não como dívida.
- Sem presença na lista de conversas, sem histórico de logs na aba (v2).
- Não fundir com `member_presence` do upstream: tabela nova isolada = zero
  conflito de merge.
