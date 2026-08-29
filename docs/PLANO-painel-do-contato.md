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
| **1** | Casca: largura 360px, sempre montado, botão junto, abas só-ícone | ✅ **feita e mesclada** (PR #54, em produção 2026-08-29) | nenhuma | #54 |
| **2** | Edição: nome, etiquetas, campos personalizados (+ tipos novos, `field_key`) | ✅ **feita e mesclada** (PR #55, em produção 2026-08-29) | `948` aplicada | #55 |
| **3** | Abas reordenadas + aba de **Traqueamento** (campos de anúncio) | ✅ **feita** (2026-08-29) | `949` **aplicada** | `feat/painel-do-contato-fase-3` |
| **4** | Negócio dentro da conversa (etapa/valor/ganho-perdido) | ⬜ pendente | nenhuma | — |

**Decisões travadas com o operador (2026-08-29):** ordem das abas =
Principal · Notas · Tarefas · Traqueamento · Histórico (Histórico por último;
Traqueamento é aba nova, pedida em 2026-08-29) · o webhook "CB OS - Atlas"
(única automação viva, `deal_stage_changed`) é **FAKE** — pode ser disparado
sem medo no teste da Fase 4 · uma aba "Principal" com
contato + negócio juntos · campos personalizados continuam no CONTATO, editáveis
da conversa · tipos novos: Lista e Número/Moeda (mantendo Texto/Data) ·
`field_key` estável para a API futura · **mudar etapa pela conversa = efeito
idêntico ao arrasto no quadro** (garantido pelos triggers 912/933 — ver Fase 4)
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

---

## ✅ Fase 2 — Edição (concluída em 2026-08-29)

**Objetivo:** o painel deixa de ser só-leitura — nome, etiquetas e campos
personalizados editáveis de dentro da conversa, com identificador estável
(`field_key`) e os tipos Lista/Número no catálogo.

**Migration `948_cb_campos_personalizados` — APLICADA em produção
(2026-08-29):** `field_key` NOT NULL + UNIQUE por conta; gatilho BEFORE INSERT
gera a chave quando ausente (⚠️ deliberado: entre aplicar e o deploy, o código
VELHO de produção insere campo sem chave — o gatilho cobre a janela, e cobre
também merges futuros do upstream); CHECK de `field_type` em
(text, datetime, select, number); opções do `select` na `field_options` JSONB
(existia desde a 001, nunca usada). Backfill deu chave aos 3 campos reais;
gatilho testado em produção com rollback proposital (gera, dedupa `_2`,
normaliza chave explícita).

**Arquivos:**

| Arquivo | O que |
| --- | --- |
| `supabase/migrations/948_cb_campos_personalizados.sql` | acima |
| `src/lib/contacts/chave-do-campo.ts` (+ teste) | gêmeo TS do gerador SQL — 7 pares medidos NO banco fixados em teste de paridade |
| `src/lib/contacts/custom-values.ts` | `salvarValoresDoContato`: **upsert + delete dos esvaziados** — substitui o delete-all+insert destrutivo |
| `src/components/contacts/campo-personalizado-input.tsx` | input por tipo (text/datetime/select/number), compartilhado ficha↔painel; `opcoesDoCampo` tolerante a lixo; valor herdado fora da lista continua selecionável |
| `src/components/contacts/custom-fields-manager.tsx` | chave sugerida em tempo real (para de seguir o nome quando tocada), tipos Lista/Número, editor de opções na criação E por linha, chave copiável por linha, 23505→"identificador já em uso" |
| `src/components/contacts/contact-detail-view.tsx` | aba de campos usa o input compartilhado + o save por upsert |
| `src/components/inbox/painel/painel-do-contato.tsx` | nome editável no cabeçalho (clique no nome; gate `send-messages`), etiquetas com popover aplicar/remover (SÓ via `tag-api` — automação `tag_added` preservada), seção CAMPOS com save e "Gerenciar" (admin) abrindo o MESMO diálogo do catálogo (fechar refaz a busca) |
| `src/components/inbox/painel/linha-de-edicao.tsx` | extraída do group-sidebar (+ Enter/Escape); grupo importa em vez de duplicar |
| `src/app/(dashboard)/inbox/page.tsx` | `handleContactUpdated` espelha o rename no contato ativo, no fio e na lista sem refetch |
| `messages/{en,pt-BR}.json` | 12 chaves `Inbox.sidebar.*` + 10 `Contacts.customFields.*` |

**Resultado medido (produção via preview 1440×900, tudo revertido depois):**
rename propagou às 3 superfícies na hora e foi revertido · etiqueta aplicada →
`tag_added` origem `usuario` na trilha (trigger 912) → removida · valor salvo
por upsert e a linha DELETADA ao limpar+salvar · campo Lista criado com chave
`campo_teste_948` + opções `{Alfa,Beta,Gama}` → apareceu no painel como Select
→ "Beta" salvo → campo de teste excluído · console limpo pós-restart ·
typecheck limpo · lint 0 erros (40 avisos, baseline) · **1936 testes** (9 novos)
· i18n-parity OK.

**Não coberto / notas:** replay local em banco vazio não rodou (Docker
inexistente nesta máquina) — o CI replaya; a migration só afirma schema e pula
dados com NOTICE · ⚠️ os 3 campos de data reais são tipados `text` (nasceram
antes da 935) — o painel os mostra como texto livre, e o gatilho de LEMBRETE
por data não os enxerga; retipar é decisão do operador (não há editor de tipo,
de propósito) · única automação viva é `deal_stage_changed` (webhook CB OS) —
nenhuma em etiqueta, teste de tag foi seguro.

## ✅ Fase 3 — Abas reordenadas + Traqueamento (concluída em 2026-08-29)

**Objetivo:** Histórico vai para o fim da fileira e nasce a aba de
**Traqueamento** — os campos que o clique no anúncio produz (UTMs, fbclid,
ctwa_clid, nomes de campanha/conjunto/anúncio), recebidos hoje por
preenchimento manual/automação e, no futuro, devolvidos à API de Conversões
da Meta.

**Decisão de desenho:** campo de traqueamento É campo personalizado comum
(mesma tabela/RLS/valores TEXT), separado por `custom_fields.categoria`
(`'geral' | 'tracking'`, migration **949, aplicada**). O que isso compra de
graça: a ação de automação `update_contact_field` já os preenche, filtros de
broadcast já os enxergam, e a futura API os lê pelo `field_key` da 948. **Sem
seed em migration** — o catálogo padrão (10 campos) nasce pelo botão "Criar os
10 campos padrão" na aba (admin), por conta.

**Arquivos:** `supabase/migrations/949_cb_categoria_do_campo.sql` ·
`src/lib/contacts/campos-de-traqueamento.ts` (+ teste: catálogo é ponto-fixo
do gerador de chave da 948 — senão o seed divergiria do gatilho — e faltantes
comparados por CHAVE em qualquer categoria) · `painel-do-contato.tsx` (ordem
nova, aba com seed/save por SUBCONJUNTO — o Salvar da Principal não arrasta
edição meio-feita do Traqueamento e vice-versa) · `custom-fields-manager.tsx`
(seletor de categoria + etiqueta na linha) · `contact-detail-view.tsx` (aba de
campos agrupada: gerais, depois subtítulo Traqueamento) · tipos + 10 chaves
i18n.

**Resultado medido (produção via preview 1440×900):** ordem das abas exata ·
seed criou os 10 campos (**ficaram — são a entrega**) · "Nome da campanha"
preenchido → salvo → conferido no banco pela chave `nome_da_campanha` →
revertido · Principal continua só com os 3 gerais · 1940 testes (4 novos) ·
typecheck limpo · lint 0 erros · i18n-parity OK. Rótulos técnicos
(utm_source/fbclid) sem `capitalize` de propósito.

**Fora do escopo desta fase (futuro):** captura AUTOMÁTICA do `referral` de
click-to-WhatsApp no webhook (preencher ctwa_clid/utm sozinho na entrada) e o
envio à API de Conversões — a aba é o depósito que essas duas pontas vão usar.

---

## ⬜ Fase 4 — O negócio dentro da conversa

> **Antes de começar: revisar esta seção** — confirmar com o operador o formato
> da seção NEGÓCIO e se o quadro de funis ganhou mudanças no meio-tempo.
> ✅ Nota do operador (2026-08-29): o webhook "CB OS - Atlas" é FAKE — o teste
> de "mesmo efeito que o arrasto" pode dispará-lo sem medo.

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
