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
  - "src/components/inbox/faixa-de-no-show.tsx"
  - "src/app/api/v1/meetings/**"
  - "src/lib/api/v1/meetings*"
  - "src/lib/reunioes/**"
  - "src/app/api/cb/reunioes/**"
  - "src/app/*/reunioes/**"
  - "src/components/reunioes/**"
  - "src/hooks/use-pauta-de-reunioes.ts"
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

### Reuniões do Calendly e da Kommo na aba Reuniões

`src/lib/agenda/reunioes-externas.ts` (puro, testado), rota
`GET /api/cb/agenda/contato/[contactId]`, hook `useReunioesExternasDoContato`.
Plano: `docs/PLANO-reunioes-e-no-show.md`.

- ⚠️ **Por ROTA, nunca SELECT do navegador.** `cb_calendly_eventos` e
  `cb_reunioes_da_kommo` são fechadas (guardam telefone, e-mail e respostas do
  formulário): do cliente voltariam vazias com `error: null`, e a aba
  afirmaria "nenhuma reunião". A rota devolve só data, evento, link e situação.
- ⚠️ **A reunião da Kommo some quando o Calendly tem uma no MESMO instante**
  (a integração antiga gravava nos dois). Compara por INSTANTE, nunca texto.
- ⚠️⚠️ **O convite que um reagendamento substituiu vira `reagendada` por
  INFERÊNCIA** (`convitesSubstituidos`): o cancelamento só chega desde a 1013
  (com a assinatura refeita) e a 977 não guarda `old_invitee`. Candidatos: os
  que chegaram antes, do mesmo tipo de evento, cuja reunião ainda não tinha
  acontecido. Só marca com resposta ÚNICA (um candidato, ou o único
  cancelado); ambíguo não marca — marcar o errado esconderia reunião de pé.
  Sem a inferência, o reagendamento antigo aparece como reunião que aconteceu
  (e contaria como "reunião anterior" num aviso de no-show).
- **Depois que TERMINA (pelo fim, não pelo início), a reunião externa fica SEM
  situação** (`reuniaoTerminou`): o Calendly não diz se o cliente compareceu,
  e "Realizada" afirmaria o que ninguém registrou. Durante a reunião ela segue
  marcada, com o link.
- A lista só aparece com as DUAS fontes respondidas; falha das externas é dita
  (`erroExternas`), nunca "nenhuma reunião".

### Aviso de possível no-show (1058)

`src/lib/agenda/aviso-de-no-show.ts` (puro, testado), calculado pela MESMA
rota e mostrado SÓ na faixa do fio (`faixa-de-no-show.tsx`; decisão do
operador: nada no card, na lista nem na aba).

- ⚠️⚠️ **O comparecimento vem de uma MARCAÇÃO na etapa, nunca do degrau nem
  do nome**: `pipeline_stages.desfecho_da_reuniao` ('compareceu' | 'faltou'),
  escolhida em Gerenciar funil. MQL 2 é degrau `reuniao` e acontece ANTES da
  reunião (28 de 30 entradas, medido em 27/09/2026); deduzir pelo nome
  desligaria o aviso ao renomear "No Show".
- ⚠️⚠️ **Da proposta em diante o DEGRAU vence a marcação**
  (`marcaDaReuniaoQueVale`, `src/lib/funil/degraus.ts`): etapa com degrau
  proposta, contrato ou pasta conta como "compareceu, com proposta" e a
  marcação dela é ignorada por TODO leitor (tela Reuniões: resultado, destino
  dos botões, qualificação, falta anterior; aviso de no-show). Em 29/09/2026 o
  operador marcou "Proposta Realizada" como "Compareceu" (a intuição natural)
  e a tela Reuniões passou a ler a entrada nela como "SEM proposta" —
  "Compareceu" é a marca da "Reunião Sem Proposta". Gerenciar funil trava o
  campo nessas etapas e limpa a marca ao salvar (no rascunho ela fica: voltar
  o degrau a devolve).
  Leitor novo da marcação passa pela mesma função.
- **Só com reunião FUTURA** (Calendly, Kommo ou agenda, não desmarcada), e
  some quando ela termina. Motivo `faltou`: entrou numa etapa "Faltou" (a
  qualquer tempo) ou a agenda registrou a falta. Motivo `sem_avanco`: teve
  reunião que já terminou e NUNCA avançou (degrau proposta/contrato/pasta,
  etapa "Compareceu", agenda "Realizada" ou card com valor).
- ⚠️ **O aviso é tão bom quanto o funil**: enquanto a equipe move os cards na
  Kommo, o CRM não vê as faltas recentes e `sem_avanco` pode acusar quem
  compareceu. Por isso o texto é FACTUAL ("foi para No Show em…"), nunca
  "vai faltar".
- A trilha lida é a das ENTRADAS em etapa (`stage_changed`, `deal_created`,
  `pipeline_changed`); `status_changed` repete a etapa em que o card já estava.
  `pipeline_stages` não tem `account_id`: a cerca é pelo funil, com `!inner`.
- **O aviso é calculado quando a conversa abre** (e no `resyncToken`): com
  duas reuniões futuras, o fim da primeira não o recalcula com a conversa
  aberta. Limite aceito (Codex, PR #332): o aviso atrasa, não mente.

### Pauta de reuniões (1063)

`/reunioes`; `src/lib/reunioes/` (`pauta.ts` e `montar.ts` puros, testados),
a rota `/api/cb/reunioes`, `src/components/reunioes/`. Plano:
`docs/PLANO-pauta-de-reunioes.md`.

- ⚠️⚠️ **O resultado tem DUAS fontes e vence a mais recente**: o marco da
  tela (`cb_reunioes_marcos`, por reunião) e a TRILHA do card (entrada numa
  etapa "faltou"/"compareceu" ou de proposta em diante, DEPOIS do início). Sem
  a trilha, a reunião resolvida no quadro fica "sem resultado" para sempre;
  sem o marco, a do card que JÁ estava na etapa não se resolve (mover para a
  mesma etapa não grava trilha).
- ⚠️⚠️ **A trilha de cada reunião é recortada pelo CARD dela e pela janela
  `[início, início da próxima reunião do contato)`** (`proximaEm`, de QUALQUER
  data — a rota lê a agenda e o Calendly inteiros dos contatos). Sem o teto, o
  resultado da reunião B resolvia a A, anterior.
- ⚠️⚠️ **O botão move o card pelo NAVEGADOR, sob RLS** (`executar.ts`), e a
  escrita é CERCADA pela etapa vista E pelo status aberto: por rota de
  servidor a trilha e os webhooks `deal.*` diriam `system`; sem a cerca, o
  clique levaria para trás um card que o Calendly acabou de mover, ou
  reabriria o perdido marcado depois da carga.
- ⚠️⚠️ **Toda reunião pode ser resolvida; nem toda move o card**
  (`comoMarcar`): só card ABERTO anda, e o resultado de reunião ANTIGA de quem
  já tem reunião mais nova só registra (o card é da nova, e dos lembretes
  dela). Sem card, card fechado ou funil sem a marca: só registra.
- ⚠️ **O card da reunião é o que JÁ EXISTIA no início dela**
  (`negocioDoContato(…, inicio)`): card criado depois (outra área) não é
  movido pelo botão. E o card que a tela viu já na etapa do botão passa pela
  MESMA cerca, por leitura, antes do registro (`executarAcao`).
- ⚠️ **Os lembretes de reunião valem em "Reunião Agendada" E na MQL 2**
  (escopo gravado em 29/09/2026, decisão do operador): o botão "Reunião
  qualificada" leva o card para a MQL 2 antes da reunião. Lembrete de reunião
  novo com escopo só na primeira se cala para o lead qualificado.
- ⚠️ **Valor e etapa na MESMA escrita** ("com proposta"): o Make da iMotion
  manda à TinTim o `deal.value` do instante da entrada em Proposta Realizada.
  Por isso o campo do valor nasce VAZIO (nunca o valor antigo do card) e
  `executarAcao` recusa "com proposta" sem valor maior que zero, sem gravar
  nada — o card só anda com o valor digitado (pedido do operador).
- ⚠️ **Para onde cada botão leva é MARCA, nunca nome**: `qualificada`
  (desfecho da 1063), `compareceu`, `faltou` e o primeiro degrau `proposta`
  do funil do card — marca em etapa de proposta em diante não vira destino.
  Funil sem a marca desliga o botão com a explicação. O
  aviso de possível no-show lê só `compareceu`/`faltou` — `qualificada` não
  é comparecimento.
- ⚠️ **A montagem do Calendly é POR CONTATO e com TODOS os agendamentos
  dele** (`montarReunioesExternas`): a inferência do convite substituído por
  reagendamento compara com agendamentos fora da janela, e misturar contatos
  casaria o reagendamento de um com o convite de outro.
- **Quem marcou é carimbado por gatilho** (`auth.uid()` e o nome do perfil),
  nunca aceito do navegador; sem DELETE (corrigir é marcar de novo: o upsert
  troca a linha do mesmo marco).
- **"Desfazer" de 5 s antes de gravar; sair da tela no meio GRAVA** — quem
  clica "No show" e abre a conversa em seguida conta com o card movido. O
  disparo é único por (reunião, prazo) (`disparadasRef`): o efeito roda a cada
  tique e duas vezes no modo estrito.
- **Fora do catálogo de perfis** (visível a todos, como o Meu dia) e recortada
  por FUNIL do perfil, pela lente (`acesso`).

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
