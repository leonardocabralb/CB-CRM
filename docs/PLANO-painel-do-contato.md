# Plano — Painel do contato no inbox (vivo e checável)

> **O que é este arquivo.** Guia retomável da reformulação do painel direito da
> caixa de entrada, pedida pelo operador em 2026-08-29. **Ele é editado a cada
> fase**: ao INICIAR uma fase, registra-se aqui que a anterior foi concluída —
> objetivo, arquivos tocados e resultado medido — para que qualquer agente possa
> pegar o plano e saber o que foi feito, o que mudou e onde tudo parou.
>
> ⚠️ **Este documento envelhece.** Antes de decidir com base em algo aqui,
> confirme contra a realidade (grep, leitura do arquivo, query no banco). Ao
> achar divergência, corrija este arquivo no mesmo PR.

- **Criado:** 2026-08-29 · **Medido contra:** `main` @ `8c5fc06`, produção `hxnhakmyxyhalbsktzwe`
- **Fluxo por fase:** executar → typecheck/lint/test/i18n-parity → **testar no
  preview em resolução de monitor de verdade (1440×900+, nunca no tamanho
  nativo do painel)** → revisar 2× → PR → **revisar ESTE plano antes da fase
  seguinte** (confirmar que o que está planejado ainda é necessário).

---

## Estado

| Fase | Escopo | Estado | Migration | PR |
| --- | --- | --- | --- | --- |
| **1** | Casca: largura 360px, sempre montado, botão junto, abas só-ícone | ✅ **feita** (2026-08-29) | nenhuma | `feat/painel-do-contato-fase-1` |
| **2** | Edição: nome, etiquetas, campos personalizados (+ tipos novos, `field_key`) | ⬜ pendente | `9NN_cb_campos_personalizados` | — |
| **3** | Negócio dentro da conversa (etapa/valor/ganho-perdido) | ⬜ pendente | nenhuma | — |

**Decisões travadas com o operador (2026-08-29):** uma aba "Principal" com
contato + negócio juntos · campos personalizados continuam no CONTATO, editáveis
da conversa · tipos novos: Lista e Número/Moeda (mantendo Texto/Data) ·
`field_key` estável para a API futura · **mudar etapa pela conversa = efeito
idêntico ao arrasto no quadro** (garantido pelos triggers 912/933 — ver Fase 3)
· entrega em fases, um PR por fase.

**Cortes deliberados (anti-overengineering, decididos na revisão do plano):**
redimensionar por arrasto (o pedido era abrir/fechar por botão) · abas
Mídia/Reuniões (não pedidas) · hooks novos para tags/negócios (busca fica no
topo do painel; trocar de aba não refaz query) · rota/RPC nova para mover etapa
(o painel usa o MESMO caminho do quadro) · `UNIQUE(account_id, field_name)` ·
superfície mobile (dívida registrada: no celular a ficha segue inalcançável).

---

## ✅ Fase 1 — Casca (concluída em 2026-08-29)

**Objetivo:** o painel muda de forma sem ganhar escrita nova: mais largo
(280→360px), abrir/fechar sem desmontar, botão de fechar JUNTO do painel (morava
no cabeçalho do fio, atrás de 4 outros controles), conteúdo reorganizado em 4
abas só-ícone, identidade compacta (avatar 64→40px).

**Arquivos tocados:**

| Arquivo | O que mudou |
| --- | --- |
| `src/components/inbox/painel/painel-do-contato.tsx` | **NOVO — o painel de verdade.** Cabeçalho compacto (fechar + avatar 40px + nome/telefone), abas `Principal / Histórico / Notas / Tarefas` (User/History/StickyNote/ListTodo, cada uma com `title`+`aria-label`), buscas de deals/tags e o realtime de notas no TOPO (trocar de aba não refaz query). Exporta `TituloDeSecao` (tipografia única das duas fichas). Valor do negócio via `formatCurrency` (antes imprimia `BRL1500`). |
| `src/components/inbox/contact-sidebar.tsx` | Virou **re-export fino** de `painel/painel-do-contato` — é arquivo do upstream; a evolução acontece no módulo novo (menos conflito de merge). |
| `src/components/inbox/group-sidebar.tsx` | Mesma casca (cabeçalho com fechar, avatar 40px em linha, `w-full`, `min-h-0` no ScrollArea), **sem abas** (pouco conteúdo). `Secao` agora usa `TituloDeSecao`. |
| `src/app/(dashboard)/inbox/page.tsx` | Painel **sempre montado**: o `{open && …}` virou wrapper com `w-[360px]`/`w-0` + `transition-[width]` + `inert` quando fechado (preserva o realtime das notas, permite animar, tira o painel fechado da ordem de tabulação). Tira fina de reabertura (28px) na borda direita quando fechado. Passa `onClose` e `resyncToken` aos painéis. |
| `src/components/inbox/message-thread.tsx` | Toggle do painel REMOVIDO do cabeçalho do fio (props `contactPanelOpen`/`onToggleContactPanel` extintas; comentário aponta a nova casa). |
| `messages/en.json` + `messages/pt-BR.json` | 4 chaves novas: `Inbox.sidebar.tabMain/tabHistory/tabNotes/tabTasks`. As chaves do abrir/fechar continuam em `Inbox.messageThread` (o botão mudou de casa; as chaves ficaram — comentado na page). |

**Resultado medido (2026-08-29, preview em 1440×900 e 1281px):**
painel 360px · 4 abas com aria-label correto · cada aba monta o conteúdo certo
(Histórico com evento retroativo, Notas com a nota real, Tarefas com o botão
"Nova tarefa") · fechar → classe `w-0` + `inert` + **painel continua no DOM**
(o realtime das notas sobrevive) + `localStorage` persiste · tira de 28px reabre
· estado vazio ("Selecione uma conversa") também tem o botão de fechar · sem
rolagem horizontal · `typecheck` limpo · lint 0 erros (40 avisos vs 43 do
baseline — reduziu) · 1927 testes · `i18n-parity` OK · console limpo (os
`MISSING_MESSAGE` vistos durante o dev eram cache do servidor; sumiram no
restart).

**O que NÃO foi verificado:** painel de grupo na tela (não há conversa de grupo
nesta conta — mudança é mecânica e idêntica à da ficha) · animação da transição
(o painel do navegador estava oculto e congela frames; a classe alvo está
correta) · **a tela em produção** (o PR ainda não foi mesclado).

**Custo aceito:** com painel aberto a 1281px, o fio fica com ~360px (antes 441).
É a troca que "painel mais largo" implica; fechar para recuperar espaço agora é
um clique visível. Se incomodar no uso real, reduzir para `w-[340px]` é mudar
duas classes na page.

---

## ⬜ Fase 2 — Edição: nome, etiquetas, campos personalizados

> **Antes de começar: revisar esta seção contra o uso real da Fase 1** e
> confirmar com o operador que tudo abaixo ainda é necessário.

1. **Nome editável** no cabeçalho do painel: extrair `LinhaDeEdicao` de
   `group-sidebar.tsx` (já pronta) e gravar `contacts.name` sob RLS.
2. **Etiquetas editáveis** na aba Principal: chips liga/desliga escrevendo **só**
   por `addContactTag`/`deleteContactTag` (`src/lib/contacts/tag-api.ts`) — é o
   único caminho que dispara a automação `tag_added` e valida posse. "Criar
   etiqueta nova" atrás de `useCan` (RLS: `contact_tags`=agent, `tags`=admin).
3. **Campos personalizados** na aba Principal + tipos novos:
   - Migration `9NN_cb_campos_personalizados.sql` (número conferido NA HORA com
     `ls supabase/migrations/` **e** `list_migrations`): `field_key TEXT` com
     backfill de `field_name` (minúsculas, sem acento, `_`, dedupe por sufixo) +
     `UNIQUE (account_id, field_key)`; CHECK de `field_type` em
     `('text','datetime','select','number')`. Opções da Lista na coluna
     `field_options JSONB` (existe desde a 001, nunca usada). Todo REVOKE com
     GRANT de volta; nenhuma conferência que exija dado (regra do banco vazio).
   - **`value` continua TEXT** para todos os tipos — número/opção são convenção
     de UI; é o que mantém automações e broadcasts intactos.
   - Trocar `saveCustomFields` (delete-all + insert, destrutivo,
     `contact-detail-view.tsx`) por **upsert + delete dos esvaziados** (padrão
     do motor, `engine.ts:690`).
   - Campo `datetime` SEMPRE via `paraEntradaLocal`/`deEntradaLocal`
     (`src/lib/contacts/campo-data.ts`) — senão o lembrete da 935 erra 3h.
   - Gerenciar campos: o painel abre o MESMO `CustomFieldsManager` num Sheet;
     ele ganha o campo de chave e o editor de opções.
   - ⚠️ `field_key` é ADITIVO: automações (`custom:<uuid>`), lembrete e
     broadcast continuam por UUID. Nenhum consumidor migra.
4. **Revisão + teste no preview** (1440×900): editar nome, aplicar/remover
   etiqueta (conferir o evento em `cb_lead_events` via trigger), preencher campo
   de cada tipo, criar campo com opções. Migration aplicada em **banco vazio**
   (`supabase db start`) antes do PR; em produção via MCP.
5. **Atualizar este plano** (mover Fase 2 para ✅ com arquivos/resultado) e
   revisar a Fase 3 antes de a iniciar.

## ⬜ Fase 3 — O negócio dentro da conversa

> **Antes de começar: revisar esta seção** — confirmar com o operador o formato
> da seção NEGÓCIO e se o quadro de funis ganhou mudanças no meio-tempo.

Seção "NEGÓCIO" no topo da aba Principal (gate `useCan("send-messages")`, o
mesmo `canCreateDeals` de `pipelines/page.tsx`):

- **Funil** (`Select`, só com 2+ funis) e **Etapa** (`Select` com a cor).
  Escrita ESPELHANDO o quadro (`pipelines/page.tsx:334-357`): update direto sob
  RLS + `avisarDrenagemDeFunil()` logo depois.
  - ⚠️ Troca de funil = **UM update só** (`pipeline_id`+`stage_id` juntos).
  - ⚠️ Nunca escrever em `cb_lead_events`/`cb_automation_events` (42501; os
    triggers 912/933 cuidam — é ISSO que garante "mesmo efeito que o arrasto").
- **Valor** (blur, `formatCurrency`) e **fechamento previsto**.
- **Ganho / Perdido / Reabrir** — mesmos updates de `deal-form.tsx:243-262`.
- **"Abrir negócio completo"** e **"Criar negócio"** → o `<DealForm>` existente
  num Sheet (carrega funis/etapas sozinho; i18n pronto). Zero caminho novo de
  criação. `conversation_id` grava **só no nascimento**, nunca no update.
- `deals` não tem realtime → atualizar estado local após escrever.
- **Teste que fecha o requisito:** mover o MESMO negócio de etapa pelo painel e
  pelo arrasto e comparar no banco — linha `stage_changed` nos dois, evento
  enfileirado nos dois, automação da etapa rodando nos dois.
- **Atualizar este plano** ao concluir.

---

## Referências de exploração (2026-08-29)

- 117 contatos · 107 negócios (~1/contato), todos em "Contato Avulso", 0
  ganhos/perdidos — o funil nunca foi trabalhado; é o problema que a Fase 3 ataca.
- `custom_fields` NÃO tem slug (só UUID + `field_name` livre); `field_options`
  JSONB existe desde a 001 e nunca foi usada; tipos hoje: `text`, `datetime`
  (universo fechado só na UI).
- Fluxos e Agentes de IA/Radar: **zero ponto de contato** com o painel.
- Broadcasts: leem campos por UUID e tratam valor como texto — intactos.
