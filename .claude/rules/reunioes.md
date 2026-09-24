---
paths:
  - "src/lib/agenda/**"
  - "src/app/api/cb/agenda/**"
  - "src/app/*/agenda/**"
  - "src/components/agenda/**"
  - "src/lib/tldv/**"
  - "src/app/api/cb/tldv/**"
  - "src/components/settings/tldv-card.tsx"
  - "src/lib/reunioes-transcritas/**"
  - "src/app/api/cb/reunioes-transcritas/**"
  - "src/components/transcricoes/**"
  - "src/hooks/use-reunioes*"
  - "src/app/api/v1/meetings/**"
  - "src/lib/api/v1/meetings*"
---

# Reuniões — regras

Vale ao mexer na agenda de reuniões (`/agenda`, `cb_meetings`,
`cb_availability`), na integração com o tl;dv e nas transcrições da ficha e do
painel da conversa. O agendamento que chega do Calendly está em
`.claude/rules/integracoes-calendly.md`. Plano do tl;dv:
`docs/PLANO-integracao-tldv.md`.

### Agenda de reuniões (945)

`src/lib/agenda/` (`fuso.ts`, `vagas.ts`, `grade.ts`, `validar.ts`, puros e
testados); a tela é `/agenda`, a escrita passa por `/api/cb/agenda`.

- ⚠️ **A SOBREPOSIÇÃO é barrada pelo BANCO** (`EXCLUDE USING gist` sobre
  `tstzrange(starts_at, ends_at)` por advogado, com `btree_gist`). Conferir
  "está livre?" antes de inserir não resolve: dois operadores marcando ao
  mesmo tempo passam os dois. Caminho novo de escrita traduz o **`23P01`**
  numa frase — cru, chega como "conflicting key value violates exclusion
  constraint".
- ⚠️ **O `EXCLUDE` ignora `status = 'cancelada'`**, senão desmarcar não
  liberaria o horário. `realizada` e `falta` continuam ocupando.
- ⚠️ **`cb_availability` guarda `time` + `timezone`, NUNCA `timestamptz`**:
  "nove da manhã" é regra, não instante. O fuso é validado por `fusoValido()`
  (o banco não consegue: CHECK exige IMMUTABLE), que recusa deslocamento fixo
  (`-03:00`) — constante não sabe horário de verão.
- ⚠️ **Mover reunião de dia RECONSTRÓI pela hora de parede**, nunca soma dias
  em milissegundos: somar preserva o instante e, numa virada de horário de
  verão, a reunião das 14h vira 13h.
- ⚠️ **`/agenda` no `protectedPaths` cobre `/agendadas` de graça** (o teste é
  `startsWith`): a página pública de auto-agendamento tem de ser
  **`/marcar/<token>`**, nunca `/agendar/<token>` — o cliente sem login cairia
  na tela de login.
- **`contact_id` é anulável e fica fora de CHECK de forma**: apagar contato
  faz SET NULL, que é UPDATE e revalida o CHECK — a exclusão do contato
  falharia.
- **A tela LÊ sob RLS; a escrita passa pela rota**, que carimba
  `autor_nome`/`owner_nome` e confere o responsável contra a CONTA
  (`auth.users` é global: a FK sozinha deixa marcar na agenda de outro
  escritório).
- **Fora da v1, por decisão: recorrência.** Reunião que repete é marcada de
  novo.

### tl;dv → transcrições (987)

`src/lib/tldv/` (`cliente`, `leitura`, `texto`, `vinculo`, `janela`, `cartao`
puros; `sincronizar` e `conexao` com I/O), `src/lib/reunioes-transcritas/`,
rotas em `/api/cb/tldv/*` e `/api/cb/reunioes-transcritas/*`, cartão em
Integrações. A reunião vem pela API; o cliente vem pelo E-MAIL.

- ⚠️⚠️ **O webhook do tl;dv NÃO é assinado: o corpo é AVISO, nunca dado.**
  `/api/cb/tldv/webhook/[token]` lê SÓ o id da reunião e a busca na API com a
  NOSSA chave (`importarReuniaoDoTldv`). Gravar algo do corpo deixaria o token
  da URL como única barreira até a ficha do cliente.
- ⚠️ **O upsert da sincronização leva SÓ metadados** (nome, data, duração,
  participantes). `status`, `contact_id`, `vinculo_origem` e `texto` ficam
  fora: `status: 'pendente'` ali "para garantir" apagaria a transcrição a cada
  ciclo.
- ⚠️ **Vínculo automático só com `vinculo_origem IS NULL`, e o UPDATE é
  cercado por `contact_id IS NULL`.** `desvinculada` impede religar o que uma
  pessoa desligou; a cerca impede atropelar vínculo manual feito no meio.
- ⚠️⚠️ **O vínculo tem DUAS fontes: o e-mail da FICHA e, quando ela não acha
  ninguém, o e-mail do AGENDAMENTO do Calendly** (`cb_calendly_eventos`, que
  já resolveu o contato pelo telefone). O convidado chega do tl;dv só com o
  e-mail, e quase nenhuma ficha tem e-mail: tirar a ponte zera o vínculo
  automático, sem erro nenhum.
- ⚠️ **`happenedAt` NÃO vem em ISO**, e sim no formato de `Date.toString()`
  ("Wed Sep 09 2026 19:19:07 GMT+0000 (…)"): `lerReuniao` normaliza por
  `Date.parse` (há pino com a forma real). `template` não vem na listagem.
- ⚠️ **A janela é 7 dias SEMPRE**, nunca "desde a última sincronização": o
  tl;dv processa depois, e `happenedAt` é a hora da reunião. A idempotência é
  o UNIQUE `(account_id, tldv_meeting_id)`.
- ⚠️ **204 sem corpo ou 404 na transcrição = "ainda não pronta"** (conta
  tentativa; 12 → `sem_transcricao`); ler o corpo vazio como erro pintava
  reunião recém-gravada de vermelho. **403 vira `falhou` na hora** (depende do
  plano de quem organizou; insistir não muda). Chave inválida, limite e rede
  param o CICLO.
- ⚠️ **O prazo do ciclo é medido por `Date.now()`, nunca por `agora`**:
  `agora` é carimbo injetável; o prazo é quanto a chamada ainda pode gastar.
- ⚠️ **A lista da ficha NÃO seleciona `texto`/`segmentos`/`notas`**
  (`COLUNAS_DA_LISTA`): ~80 KB por hora de reunião. Só o visualizador busca a
  linha inteira.
- ⚠️ **A importada do tl;dv não se apaga; dela se tira o cliente** (a
  varredura de 7 dias a traria de volta). `DELETE` só na `manual`, pelo autor
  ou admin.
- ⚠️ **A chave vai no cabeçalho `x-api-key`, nunca na URL**, e todo erro passa
  por `semSegredo()`.
- ⚠️ **O cron ordena as contas por `last_sync_attempt_at` (nunca tentada
  primeiro) e a varredura carimba essa coluna ANTES de qualquer trabalho,
  dê certo ou não.** É o rodízio: ordenar por `account_id` deixava a mesma
  cauda de fora em todo ciclo; carimbar só no sucesso poria a conta que falha
  sempre na frente.
- **`cb/tldv` está no laço LENTO do agendador**, e o CI não relê o `command`
  dele: só vale depois de `docker stack deploy` manual.

### Transcrições na ficha e no painel da conversa

- ⚠️ **`<ReunioesTranscritasDoContato>` mora na aba Reuniões, abaixo de
  `<ReunioesDoContato>`, nos DOIS lugares**: a ficha de Contatos e a aba
  `reunioes` do painel da conversa (a pedido do operador, para a transcrição
  estar à mão no atendimento). Um merge que traga a aba crua do upstream apaga
  o histórico de transcrições.
- ⚠️ **Os hooks `use-reunioes.ts` e `use-reunioes-transcritas.ts` carimbam o
  DONO da lista (`{ de, reunioes }`) e DERIVAM `carregando` de
  `de !== contactId`.** O painel não remonta ao trocar de cliente: sem o
  carimbo, as reuniões do cliente anterior ficavam clicáveis sob o nome do
  novo até a resposta chegar (armadilha do efeito passivo).
