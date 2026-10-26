# Plano — Motivos de desqualificação e de perda

Pedido do operador (26/10/2026): controlar POR QUE os leads são
desqualificados e os negócios são perdidos, com preenchimento fácil para a
equipe e, no futuro, pela IA que atende os leads. O lugar é o campo
personalizado (a IA já preenche campo).

## Estado

| Fase | O quê | Estado |
| --- | --- | --- |
| 0 | Listas de motivos aprovadas; campos criados nos blocos | listas aprovadas (26/10); campos a criar |
| 1 | Migration: campo do motivo por etapa; seletor no Gerenciar funil | — |
| 2 | Janela "Por que…?" nos caminhos de gente; botão Perdido escolhe etapa | — |
| 3 | Passo "Mover card de etapa" grava o motivo | — |
| 4 | Relatório de motivos no Desempenho | — |
| 5 | Agente de IA que leva o card à perda grava o motivo | depois (agentes desligados) |

## Decisões do operador (26/10/2026)

- **D1 — Dois campos por área**, tipo Lista, no bloco de cada área:
  "Motivo da desqualificação" (o lead não servia: fala com anúncio e entrada)
  e "Motivo da perda" (servia e não fechou: fala com o comercial).
- **D2 — 3 ou 4 motivos pré-montados + "Outro"**, que abre texto livre. O
  texto vai para o PRÓPRIO campo (a ficha já mostra valor fora da lista,
  `campo-personalizado-input.tsx`, `foraDaLista`); o relatório agrupa o que
  está fora da lista como "Outro" e lista os textos.
- **D3 — Obrigatório para PESSOAS na tela**: sem motivo o card não vai para a
  etapa; cancelar a janela devolve o card para onde estava.
- **D4 — Automação grava o motivo NO PRÓPRIO PASSO** "Mover card de etapa"
  quando o destino pede motivo; o validador avisa se ficar vazio. Automação,
  robô, IA e API nunca abrem janela (não há ninguém para responder).
- **D5 — O botão "Perdido"** (painel e formulário do negócio) passa a
  perguntar a etapa de perda + o motivo e MOVE o card para a etapa. Muda o
  comportamento do botão (hoje marca perdido sem trocar a etapa).
- **D6 — Três níveis**: campos, janela e relatório.
- **D7 — Listas e regra entre as etapas aprovadas** (abaixo), tiradas da
  leitura das conversas, anotações e fichas dos cards movidos por gente em
  30 dias. A análise com as contagens e os achados de negócio fica FORA do
  repositório (`~/Downloads/CB-CRM/motivos-de-perda-2026-10-26/`).

## Medições técnicas (26/10/2026, produção, só leitura)

- **≈ 9 perdas por dia feitas por pessoas** nos funis comerciais do Bancário
  e do Trabalhista (`cb_lead_events` `status_changed` → `lost`, com
  `actor_user_id`).
- **Todas por troca de etapa**: nenhuma perda pelo botão "Perdido" sem
  trocar a etapa em 30 dias. Por isso a janela se ancora na ETAPA.
- **Automações que levam a etapa de perda**: 6 ATIVAS, todas do
  Previdenciário → "Desqualificado" (lembretes e reengajamento sem
  resposta); 2 desligadas ("(RASCUNHO) Trabalhista · Recuperação" →
  Perdido; "Typebot · Desqualificado" → Bancário). Nenhum robô (`flow_nodes`)
  leva a etapa de perda.
- **Etapas de perda** (`resultado = 'perdido'`): Bancário "Desqualificado"
  (marca `desqualificacao`) e "Perdido"; Trabalhista "Desqualificado - Sem
  Direito" (marca) e "Perdido"; Previdenciário "Desqualificado" (marca) e
  "Contrato sem pasta". ⚠️ "Não Respondeu" do Trabalhista é degrau `perda`
  mas etapa NEUTRA: não pede motivo, salvo se o operador ligar.
- **Campo que já existe**: Previdenciário "Motivo da desqualificação"
  (`aa_motivo_desqualificacao`, Lista), com 0 valores preenchidos — livre
  para reorganizar.
- **Nenhum card tinha o motivo registrado** (quase nenhuma anotação; nenhum
  campo).
- **A IA já preenche Lista**: o pedido do agente diz "exactly one of: …"
  (`src/lib/ia-agentes/pedido.ts`) e a passagem grava campo antes de mover
  (`.claude/rules/ia-agentes-turno.md`).

## Listas de motivos aprovadas (Fase 0)

Toda lista termina com **"Outro"** (texto livre na janela).

| Área | Motivo da desqualificação | Motivo da perda |
| --- | --- | --- |
| Bancário | Dívida abaixo do valor mínimo · Só Pronampe/FGI (linha do governo) · Consignado ou dívida com garantia · Não é dívida bancária / spam | Desistiu / não quis seguir · Fechou com outro escritório · Parou de responder · Sem condição de pagar a proposta |
| Trabalhista | Não estava grávida na saída · Contato por engano / sem caso · Prazo de 2 anos vencido · Justa causa ou demissão homologada | Número inválido / sem WhatsApp · Parou de responder / bloqueou · Já tem ou escolheu outro advogado |
| Previdenciário | Sem sequela · Sem direito · Contato por engano / sem caso | Não respondeu · Não reengajou · Já tem advogado |

### Regra entre as duas etapas (aprovada, nas três áreas)

- **Desqualificado** = fora do perfil: o que o lead disse mostra que não há
  caso (decidido antes da proposta).
- **Perdido** = tinha o caso, ou não deu para saber, e não avançou: parou
  de responder, número inválido, escolheu outro advogado, desistiu, sem
  condição de pagar.

### Em aberto

- ⚠️ **Previdenciário não tem etapa "Perdido"**: as 6 automações de
  lembrete levam quem não responde para "Desqualificado", o que pela regra
  é perda. Decidir antes da Fase 3: criar a etapa "Perdido" no
  Previdenciário, ou o "Desqualificado" de lá perguntar uma lista que
  inclua "Não respondeu".
- O rótulo do valor mínimo do Bancário fica sem número até o operador
  confirmar o valor.

## Desenho

### Fase 0 — os campos

- Seis campos Lista (dois por bloco: Bancário, Trabalhista,
  Previdenciário). O Previdenciário reaproveita o campo existente para a
  desqualificação (troca as opções; 0 valores) e ganha o da perda.
- Dono durável: `custom_fields.user_id` CASCADEia de `auth.users` → grava
  `accounts.owner_user_id`, nunca o login de quem cria (CLAUDE.md, 8a).
- A chave (`field_key`) nasce do nome pelo gatilho da 948.

### Fase 1 — qual campo cada etapa pergunta

- `pipeline_stages.campo_do_motivo_id uuid NULL` → `custom_fields(id)`
  `ON DELETE SET NULL`. A etapa sem campo não pergunta nada (comportamento
  de hoje). Quem decide é a CONFIGURAÇÃO da etapa, não o `resultado`: o
  operador pode ligar também numa etapa neutra como "Não Respondeu".
- `pipeline_stages` não tem `account_id`: FK simples só garante "existe um
  id". Gatilho BEFORE confere que o campo é da conta do funil e do tipo
  `select`.
- Gerenciar funil: seletor "Motivo" na linha da etapa (só campos Lista). O
  diálogo já tem quatro seletores de largura fixa (`.claude/rules/funil.md`,
  "Trechos nossos no quadro e na página"): mostrar a tela antes de decidir o
  layout.
- Banco vazio: a migration aplica sem dado; conferência pula com
  `RAISE NOTICE` (`.claude/rules/supabase.md`).

### Fase 2 — a janela, nos caminhos de GENTE

- Caminhos: arrastar no quadro (`pipeline-board.tsx`, `handleDragEnd`),
  seletor de etapa do painel (`seletor-funil-etapa.tsx`), botão "avançar"
  (`avancar-etapa.tsx`, quando o destino é etapa com motivo), lista do funil
  (`lista-de-leads.tsx`), formulário do negócio (`deal-form.tsx`) e o botão
  "Perdido" (painel `painel-do-contato.tsx` e `deal-form.tsx`).
- A janela mostra os motivos do campo como seletor, pré-marca o valor atual
  da ficha, e "Outro" abre texto livre. Confirmar grava o CAMPO e só depois
  move o card; cancelar não grava nada e o card fica (no quadro, volta à
  coluna — `movidosRef` desmarca).
- Botão "Perdido": a janela pergunta a etapa (as de `resultado = 'perdido'`
  do funil) e o motivo dela, e move.
- Card cujo contato está na Lixeira (`contact_id` nulo): não há ficha para
  gravar. A decidir na implementação: mover sem motivo com aviso.
- Gravação do campo: um campo por gravação, confere retorno (RLS que barra
  devolve 0 linhas); erro ALTO nomeando campo e cliente.

### Fase 3 — automações

- `move_deal_stage.step_config.motivo` (texto). O motor grava o motivo no
  campo da etapa de destino quando o movimento acontece. Validador avisa
  quando o destino pede motivo e o passo não tem. Descrição do passo e
  ajuda na tela mudam junto (doc acompanha, CLAUDE.md seção 11).
- As 6 automações do Previdenciário recebem o motivo (ex.: "Não
  respondeu") — edição em produção só com o "pode gravar", ou pelo
  operador na tela.

### Fase 4 — relatório

- No Desempenho: por funil e período, os CARDS que entraram em etapa com
  motivo, agrupados pelo motivo ATUAL da ficha (fora da lista → "Outro",
  com os textos), e "Sem motivo" separado por quem moveu (pessoa,
  automação, IA, API). Agregação no banco (RPC), nunca contar no navegador
  (corte de 1000 linhas do PostgREST).

### Fase 5 — IA (depois)

- O agente que move para etapa com motivo grava o campo da etapa na
  passagem. Hoje já dá pela configuração da passagem (campo + mover).

## Limites aceitos

- **O motivo é do CONTATO, não do negócio.** Lead que volta e é perdido de
  novo sobrescreve; o relatório mostra o motivo atual.
- API e integrações (Make, n8n) não são obrigadas a mandar motivo: aparecem
  em "Sem motivo — API".
