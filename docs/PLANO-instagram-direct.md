# Plano — Instagram Direct como Conexão do CRM

> **Nasce em:** 2026-09-10 · **Base:** `docs/ESTUDO-instagram-direct.md` (Fase 0
> concluída em 09/09 — App Review não é exigido; tudo abaixo é código nosso).
> **Objetivo do operador, nas palavras dele:** *"visualizar e responder as
> mensagens de Direct que as pessoas mandarem"*. Nada de iniciar conversa,
> disparo ou modelo.
>
> Plano vivo: cada fase é UMA branch a partir de `main` e UM PR; a caixa marca
> quando o PR entrou. Migration é aplicada em produção pelo conector ANTES do
> merge, com autorização do operador a cada uma (regra da casa).

## Decisões de escopo (v1)

| # | Decisão | Motivo |
| --- | --- | --- |
| D1 | **Automações, fluxos e IA NÃO respondem no Instagram na v1.** Os motores pulam canal Instagram com uma linha de log; os senders do robô falham FECHADO. O roteamento para o funil (card no primeiro contato) **entra**. | O objetivo é gente respondendo. Ligar o robô é uma decisão de produto à parte, com a janela de 24h no meio. |
| D2 | **Janela de resposta: 24h.** Opção por canal `ig_human_agent` (desligada) que estende para **7 dias** e envia a tag `HUMAN_AGENT` fora das 24h — só depois de o operador **solicitar a feature "Human Agent"** no painel da Meta. | A feature exige aprovação própria; sem ela a tag é recusada. |
| D3 | **Token colado na tela**, gerado pelo botão do painel da Meta (60 dias). Sem OAuth. Renovação por cron semanal, comparando `expires_in`. | Desenho do estudo (§2.2); a Meta dispensa o login flow para conta própria. |
| D4 | **Contato do Instagram é uma FICHA PRÓPRIA**, identificada por `contacts.instagram_id` (IGSID). Quem fala pelo WhatsApp e pelo Direct tem duas fichas. | Não há como saber que é a mesma pessoa; e IGSID em `contacts.phone` funde ficha com cliente real (§4.3 do estudo). |
| D5 | **Sem reação, sem citação, sem apagar-para-todos, sem nota de voz gravada** no Instagram na v1. Cada um falha fechado com aviso claro. | A API não cobre (citação, apagar) ou cobre com formato que o gravador não produz (voz). |
| D6 | **Uma fase = um PR = um deploy**, mesclado com o CI verde, avisando o operador. | Fluxo do projeto. |

## O que muda no banco — migration `987_cb_instagram`

- `cb_channels.kind` aceita `'instagram'`; `cb_channels_required_by_kind` ganha o
  3º ramo: `ig_user_id IS NOT NULL AND access_token IS NOT NULL AND ig_app_secret
  IS NOT NULL`.
- Colunas novas em `cb_channels`: `ig_user_id text`, `ig_username text`,
  `ig_app_secret text` (cifrado — **quem assina o webhook**, medido no Teste B),
  `ig_token_expires_at timestamptz`, `ig_token_refreshed_at timestamptz`,
  `ig_human_agent boolean NOT NULL DEFAULT false`.
- Índice único global de roteamento de ENTRADA: `cb_channels(ig_user_id) WHERE
  kind='instagram' AND ig_user_id IS NOT NULL` — o `entry.id` do webhook.
- `contacts.instagram_id text`, `contacts.instagram_username text`; índice único
  parcial `(account_id, instagram_id) WHERE instagram_id IS NOT NULL`.
- ⚠️ `contacts.phone` **vira NULLABLE**, com `CHECK (phone IS NOT NULL OR
  instagram_id IS NOT NULL)`. O `phone_normalized` (gerado) vira NULL junto;
  o único de 022 não colide (NULL é distinto de NULL).
- Sem backfill. `REVOKE … FROM anon` já vale (tabelas antigas, 931). Replay em
  banco vazio conferido com `supabase db start`.

## Fases

### Fase 1 — Alicerce: o terceiro tipo existe e o compilador passa a ajudar
- [ ] Migration 987 (acima), aplicada em produção antes do merge.
- [ ] `CbChannelKind`/`ResolvedChannel.provider` ganham `'instagram'`;
      `ResolvedChannel` ganha `ig_user_id`, `ig_app_secret`, `ig_human_agent`.
- [ ] `src/lib/cb-channels/transporte.ts` (puro, testado): `ehMeta`,
      `ehEvolution`, `ehInstagram` e `providerDoKind` com `switch` exaustivo
      que **lança** em kind desconhecido — some o ternário de `resolve.ts:70`/`:134`.
- [ ] **Teste estrutural** `transporte.chamadores.test.ts`: comparação crua
      `provider === '…'`/`kind === '…'` fica **proibida** em `src/**` fora de
      `transporte.ts`. Os 20 call sites são convertidos para os predicados —
      cada `else` que era "Meta" vira `ehMeta(...)` explícito. É a rede que o
      `tsc` não dá (§4.2 do estudo).
- [ ] `Contact.phone: string | null` no tipo; o `tsc` aponta cada uso que
      assume string; `src/lib/contacts/identidade.ts` (puro, testado):
      `identidadeDoContato(c)` → telefone formatado, senão `@username`, senão
      nome — usado onde a UI mostra telefone (lista, painel, ficha, card do
      funil, busca).
- [ ] `CB_CHANNEL_SAFE_COLUMNS` + `CbChannel` com `ig_user_id`, `ig_username`,
      `ig_token_expires_at`, `ig_human_agent` (nunca o token/segredo).
- [ ] i18n: `kind_instagram` nos dois dicionários; `ChannelBadge` com o glyph
      do Instagram; `nova-conversa-dialog` não oferece canal Instagram (não se
      inicia conversa); broadcast já filtra por `metaChannels()`.
- [ ] API v1: `phone` nullable nos serializers + `instagram_id`/`instagram_username`
      expostos; `docs/public-api.md` avisa o integrador.

### Fase 2 — Conexão: cadastrar o canal na tela
- [ ] `POST /api/cb/channels` com `kind: 'instagram'` (rótulo, token, Instagram
      App Secret, `ig_human_agent`): o servidor chama
      `GET graph.instagram.com/v26.0/me?fields=user_id,username,name` para
      **descobrir** `ig_user_id`/`ig_username` (o operador não digita ID),
      gera `verify_token` aleatório, cifra token e segredo, grava
      `ig_token_expires_at = now()+60d`, `status='connected'`.
- [ ] Resposta e cartão mostram a **URL de callback**
      (`/api/cb/instagram/webhook`) e o verify token para o operador colar no
      painel da Meta (passo 3 do caso de uso) — e a instrução de ligar a
      *Assinatura do webhook* da conta lá.
- [ ] `PATCH` allowlist: `ig_human_agent`; `DELETE` já limpa acervo/agendadas.
- [ ] `cb-channels-panel.tsx`: `AddStep = 'choose'|'evolution'|'meta'|'instagram'`,
      formulário, cartão (username, validade do token, botão **Renovar token**
      que recebe um token novo colado).
- [ ] `health.ts`: `GET /me` com o token, com cache TTL, → `connected`/`disconnected`
      + `last_error` (token expirado aparece na tela, não no log).
- [ ] `src/lib/instagram/graph.ts`: cliente mínimo (`me`, `perfil(igsid)`,
      `enviar`, `refresh`), erros tipados, **token nunca em URL** (só header),
      **mensagens de erro da Meta sem o token** (`semSegredo`, lição do Meta Ads).

### Fase 3 — Entrada: a DM vira mensagem na caixa
- [ ] `src/lib/instagram/webhook.ts` (puro, testado): parse do payload →
      eventos tipados: `mensagem` (texto/anexos, `is_echo`, `is_deleted`,
      `reply_to`), `edicao` (só `num_edit ≥ 1` — o `num_edit: 0` que chega
      com toda DM é **ignorado**), `reacao`, `postback`, `outro`.
- [ ] Rota real `GET/POST /api/cb/instagram/webhook` (substitui o receptor):
      GET varre `verify_token` dos canais Instagram; POST lê corpo CRU, acha o
      canal por `entry.id`, confere HMAC com o **`ig_app_secret` daquele
      canal** (401 se não casa; 200 e ignora `object ≠ instagram` e canal
      desconhecido — 4xx repetido faz a Meta desativar a assinatura).
- [ ] `src/lib/instagram/persistir.ts`: contato por `instagram_id` (criação
      com `user_id = accounts.owner_user_id` — **dono durável**, allowlist de
      `dono-duravel.test.ts`), conversa (`channel_id` do canal, `follow`),
      mensagem (`message_id` = mid; `UNIQUE (conversation_id, message_id)`
      descarta o eco do que NÓS enviamos), eco do app do Instagram →
      `sender_type='agent'`, `from_device=true`; `is_deleted` → `deleted_at`;
      edição → `content_text`/`text_before_edit`/`edited_at`; reação →
      ignorada na v1.
- [ ] `reopenConversation` (gente reabre) e `routeContactToPipeline` (card)
      — **allowlists** de `reopen.chamadores.test.ts` e
      `pipeline-routing.chamadores.test.ts` ganham o caminho novo.
- [ ] `src/lib/instagram/midia.ts`: baixa a URL assinada do CDN **na hora**
      (expira), sobe no `chat-media` com `uploadAccountMedia`; **mime pelo
      `type` do webhook** (`audio` → `audio/mp4`), nunca pelo content-type
      (`video/mp4`, medido); `media_filename` do `content-disposition`.
      Teto: `MEDIA_MAX_BYTES_ENTRADA`.
- [ ] `src/lib/instagram/perfil.ts`: na criação do contato,
      `GET /{igsid}?fields=name,username,profile_pic` → nome, `@username`,
      avatar salvo como em `foto-do-contato` (revalidação em 30 dias). Falha
      não derruba a ingestão.
- [ ] D1 na prática: **nenhum** `runAutomationsForTrigger`/`findEntryFlow`/
      auto-reply chamado neste caminho — com teste estrutural no molde de
      `cb-groups/persist.ts` (o módulo não importa os motores).
- [ ] Deploy → trocar a URL de callback no painel da Meta para a de produção
      e re-verificar; conferir com uma DM real; desligar o túnel.

### Fase 4 — Saída: responder pela caixa
- [ ] `sendMessageToConversation` ganha o ramo `ehInstagram`: destinatário =
      `contact.instagram_id`; texto (**1000 bytes**, `text_too_long`); imagem
      png/jpg ≤ 8 MB, vídeo/áudio ≤ 25 MB, **PDF ≤ 25 MB** por URL pública do
      Storage; `messaging_type`/`tag HUMAN_AGENT` fora das 24h só com
      `ig_human_agent`; **janela conferida no servidor**
      (`window_closed`, traduzido); `message_id` = `message_id` da resposta.
      Roteamento para funil e reabertura vêm de graça (é o núcleo).
- [ ] Senders do robô (`flows/meta-send.ts`, `automations/meta-send.ts`),
      `react`, apagar-para-todos: `ehInstagram` → erro claro, nunca "Meta".
- [ ] `janela-24h.ts` recebe `horas` (24 ou 168) e o fio/compositor ganham o
      estado **"janela fechada — só a pessoa pode reabrir"** (sem "use um
      modelo"), chaves novas nos dois dicionários; contador de 1000 bytes;
      mic, modelo, reação e citação escondidos em conversa Instagram.
- [ ] Agendada: passa pelo núcleo; fora da janela vira `failed` com motivo
      traduzido (nada muda no disparador).

### Fase 5 — Token: o canal não pode morrer sozinho
- [ ] `GET /api/cb/instagram/cron` (`x-cron-secret`): renova tokens com
      `ig_token_refreshed_at` > 7 dias e idade > 24h; **compara `expires_in`**,
      não o status HTTP (200 com o mesmo token não é renovação); falha →
      `status='disconnected'` + `last_error`. Alerta na tela de Conexões
      quando faltam < 10 dias.
- [ ] `docker-stack.yml`: `cb/instagram` no laço lento — ⚠️ vale só depois de
      `docker stack deploy` manual na VPS (o CI não relê o `command`).
- [ ] Teste do cron contra a Meta com o canal real.

### Fase 6 — Fechamento
- [ ] `CLAUDE.md`: seção "Instagram Direct" com o que morde código novo
      (segredo por canal, IGSID fora de `phone`, `num_edit: 0`, mime do áudio,
      predicados de transporte, D1).
- [ ] `docs/INSTALACAO.md` (passo a passo do app na Meta, com o que foi medido)
      e `docs/public-api.md`; estudo atualizado; i18n parity; suíte verde no
      Node 22.
- [ ] Apagar o receptor de teste (branch `feat/instagram-receptor-de-teste`
      fica só como histórico) e o túnel.
- [ ] ⚠️ **Apagar TODAS as worktrees criadas para este trabalho** (pedido do
      operador em 10/09): `~/cb-crm-worktrees/instagram-direct`,
      `~/cb-crm-worktrees/instagram-receptor` e qualquer outra que as fases
      criarem — `git worktree remove` + `git worktree prune`, e a entrada
      `cb-crm-instagram` do `.claude/launch.json`. Cada uma carrega um
      `node_modules` clonado; esquecidas, ocupam disco.

## Riscos conhecidos

- **Transcrição de nota de voz**: o Gemini pode recusar `audio/mp4`; medir na
  Fase 3 com o áudio real e, se recusar, mandar como `video/mp4` (ele
  transcreve a trilha) — decisão registrada no módulo.
- **Dois apps Meta um dia** (WhatsApp Cloud + Instagram): o segredo por canal
  já cobre; `META_APP_SECRET` global fica só para o WhatsApp.
- **`contacts.phone` nulo** atravessa 53 arquivos: o `tsc` guia, mas exibição
  é medida na tela (lista, painel, ficha, funil, busca, CSV).
- **`:latest` da Evolution** não tem relação — registrado no estudo (§9).
