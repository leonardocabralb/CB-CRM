# Plano — as ações da IA como faixas cinzas no fio (1141)

Pedido do operador em 12/11/2026, com os agentes do Trabalhista ligados desde
as 11:04: "ela está fazendo muitas anotações de notas. Isso está poluindo muita
conversa. Tudo que ela decide fazer, ela está colocando como nota, quando, na
verdade, isso deveria ficar apenas como execução de etapa ou alguma coisa que
foi feita, como essas barrazinhas cinzas" (a faixa "Avançou de Entrada Avulsa
para Pendências da IA · pelo sistema"). Vale para todos os agentes da conta
(Previdenciário inclusive): é código, não texto de agente.

## Decisões do operador (12/11/2026)

- **D1 — O que a IA FEZ vira faixa cinza; os AVISOS ficam anotação.** Avisos =
  os que pedem algo da equipe: não ouviu o áudio, chegou ao limite, resposta
  retida (link inventado, pedido vazado, ação ou reunião prometida), reunião não
  marcada, entrega incerta, o cliente que precisa de alguém.
- **D2 — A automação "Trabalhista · Pendências da IA · nota interna"
  (`dc9029b4`) foi DESLIGADA** (pela rota da tela, 12/11/2026): a faixa cinza
  com o motivo e o aviso na tela (1139) já cobrem.
- **D3 — "Pode implementar, gravar e mesclar"** (migration e merge
  autorizados).

## Como ficou

1. **Mover o card, pôr e tirar etiqueta e a passagem entre agentes** não anotam:
   a faixa da trilha (912) que já existia passa a dizer "pelo agente de IA
   <nome>" em vez de "pelo sistema". O agente escreve com um cliente próprio
   (`clienteDoAgente`, cabeçalhos `x-cb-via: agente` e `x-cb-ref`); os gatilhos
   de `deals` e `contact_tags`, recriados na 1141, leem o cabeçalho pela
   `cb_quem_mexeu_na_conversa` (1083) e gravam `details.via`/`ref_nome` — só a
   via `agente`, só sem sessão.
2. **"Respondeu e passou a conversa"** não anota: a faixa "Conversa marcada
   como pendente · pelo agente de IA <nome>" (1083) já existia.
3. **Preencheu campo, criou tarefa, executou automação, marcou reunião** (sem
   faixa na trilha) anotam com `cb_conversation_notes.tipo = 'acao_da_ia'`: o
   fio desenha uma faixa cinza (`AcaoDaIaLine`, ✨), a aba Notas e a ficha de
   /contatos não a listam. Continua ANOTAÇÃO de propósito: some com a conversa
   e vai à Lixeira (o valor do campo é dado da cliente; na trilha ficaria
   depois da exclusão da ficha).
4. **As 23 anotações de ação já escritas** (todas de 12/11) viraram
   `acao_da_ia` na própria migration, pelo texto pt-BR do dicionário.

## Limites

- O webhook `deal.*` segue dizendo `system` para o card movido pela IA (a 1040
  lê outro cabeçalho, `x-cb-origem`).
- Transferência com a conversa JÁ pendente não gera a faixa "marcada como
  pendente" (a situação não muda): a faixa amarela da IA ("IA pausada — a IA
  passou a conversa para uma pessoa") continua dizendo.
- A API v1 (`GET /notes`) devolve a ação da IA como anotação, como antes (sem
  campo novo no contrato).

## Estado

- 12/11/2026: migration 1141 e PR em `feat/ia-acoes-na-trilha`. Provas:
  replay local do zero (265 migrations + `verify-schema`), 8 cenários com dado
  fictício (`~/Downloads/CB-CRM/ferramentas/pg-replay/cenarios-1141/`), testes.
- 12/11/2026 15:49 BRT: 1141 APLICADA na produção (32 ações antigas viraram
  faixa cinza). PR #514 com CI verde e Codex sem achados.
