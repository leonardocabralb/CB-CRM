# Plano — Instagram Direct como Conexão do CRM

> **Nasce em:** 2026-09-10 · **Base:** `docs/ESTUDO-instagram-direct.md` (Fase 0
> concluída em 09/09 — App Review não é exigido; tudo abaixo é código nosso).
> **Objetivo do operador, nas palavras dele:** *"visualizar e responder as
> mensagens de Direct que as pessoas mandarem"*. Nada de iniciar conversa,
> disparo ou modelo.
>
> Plano vivo: cada fase é UMA branch a partir de `main` e UM PR; a caixa marca
> quando o PR entrou. Migration é aplicada em produção ANTES do merge da fase
> que a usa, com autorização do operador (regra da casa).
> ⚠️ **O conector MCP do Supabase está SEM autenticação nas sessões de
> 09–10/09** (mesmo estado registrado pela tl;dv): quem aplica a 989 é o
> operador, colando o SQL no SQL Editor, ou uma sessão com o conector
> autorizado. Enquanto isso, nenhuma fase pode DEPENDER da coluna nova em
> produção — ver "O que muda no banco".

## Decisões de escopo (v1)

| # | Decisão | Motivo |
| --- | --- | --- |
| D1 | **Automações, fluxos e IA NÃO respondem no Instagram na v1.** Os motores pulam canal Instagram com uma linha de log; os senders do robô falham FECHADO. O roteamento para o funil (card no primeiro contato) **entra**. | O objetivo é gente respondendo. Ligar o robô é uma decisão de produto à parte, com a janela de 24h no meio. |
| D2 | **Janela de resposta: 24h.** Opção por canal `ig_human_agent` (desligada) que estende para **7 dias** e envia a tag `HUMAN_AGENT` fora das 24h — só depois de o operador **solicitar a feature "Human Agent"** no painel da Meta. | A feature exige aprovação própria; sem ela a tag é recusada. |
| D3 | **Token colado na tela**, gerado pelo botão do painel da Meta (60 dias). Sem OAuth. Renovação por cron semanal, comparando `expires_in`. | Desenho do estudo (§2.2); a Meta dispensa o login flow para conta própria. |
| D4 | **Contato do Instagram nasce como FICHA PRÓPRIA**, identificada por `contacts.instagram_id` (IGSID) — e o operador pode **UNIFICAR à mão** com a ficha de WhatsApp do mesmo cliente (Fase 5). Sem unificação automática. | Decisão do operador em 10/09 ("abrir possibilidade para unificar manualmente"). Não há como saber sozinho que é a mesma pessoa; e IGSID em `contacts.phone` funde ficha com cliente real (§4.3 do estudo). |
| D5 | **MEDIDO em 10/09 na doc da API de mensagens do Instagram.** Cabe: **nota de voz** (a API aceita `aac, m4a, wav, mp4` até 25 MB — o gravador produz ogg/opus, então em conversa Instagram a gravação é convertida para **WAV no navegador**); **PDF** até 25 MB; reação (`sender_action: react`) — que fica FORA da v1 mesmo assim (o emoji livre daqui não se traduz na reação única de lá). NÃO cabe: **apagar-para-todos** (não existe endpoint de unsend; só o webhook `message_deletions`, quando o CLIENTE apaga), **responder citando** (o `POST /messages` não aceita `reply_to`; na ENTRADA a Meta manda `reply_to`, então o CRM MOSTRA "em resposta a…" mas não ENVIA citação), **documento que não seja PDF**, editar mensagem, modelo, interativa. Regra do operador: o que não cabe fica **inacessível quando o canal ativo da conversa é Instagram** — some da tela, e a rota recusa com frase clara. | Pedido do operador em 10/09: "veja se é possível colocar o apagar para todos e a nota de voz; se não conseguir, seguiremos sem, deixando essas opções inacessíveis". |
| D6 | **Uma fase = um PR = um deploy**, mesclado com o CI verde, avisando o operador — **sem esperar aprovação a cada PR** (autorização de 10/09). | Fluxo do projeto. |

## O que muda no banco — migration `989_cb_instagram` (entra com a Fase 2)

⚠️ **989, não 987**: a `987_cb_tldv` (branch `feat/integracao-tldv`) e a
`988_cb_rodizio_do_cron_do_meta_ads` (branch `fix/rodizio-do-cron-do-meta-ads`)
existem em branches paralelas ainda não mescladas — é o quarto caso de
colisão por sessão paralela que o CLAUDE.md registra (906, 963, 966). Conferir
de novo com `git ls-tree` em TODAS as branches na hora de criar o arquivo.

A migration viaja no PR da **Fase 2**, que é a primeira a precisar dela em
produção (o cadastro grava as colunas novas). A Fase 1 não lê coluna nova
nenhuma — é por isso que pôde entrar sem a migration aplicada.

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
- ⚠️ Um canal Instagram NUNCA é `is_default` (o padrão é o número de WhatsApp
  que responde conversa sem canal e alimenta o espelho `whatsapp_config`):
  `set-default.ts` já recusa (Fase 1); a criação (Fase 2) não o promove nem
  quando é a primeira conexão da conta.

## Fases

### Fase 1 — Alicerce: o terceiro tipo existe e o compilador passa a ajudar
Branch `feat/instagram-1-transporte`. Sem migration (ver acima).
- [x] `src/lib/cb-channels/transporte.ts` (puro, testado): `Transporte`,
      `TRANSPORTES`, `transporteValido`, `transporteDe` (**lança** em valor
      desconhecido — some o ternário de `resolve.ts:70`/`:134`), `ehMeta`,
      `ehEvolution`, `ehInstagram`, `ehWhatsApp`. Aceitam string, `{kind}` ou
      `{provider}`.
- [x] **Teste estrutural** `transporte.chamadores.test.ts`: comparação crua
      `kind === '…'`/`provider !== '…'` (qualquer identificador terminado em
      kind/provider, sem distinção de caixa) **proibida** em `src/**` fora de
      `transporte.ts`. Os ~45 call sites em 30 arquivos foram convertidos —
      cada `else` que era "Meta" virou `ehMeta(...)` explícito.
- [x] `CbChannelKind = Transporte`; `ResolvedChannel.provider: Transporte`;
      os tipos locais de painel, compositor, ações da mensagem, saúde e
      validadores passaram a importar `CbChannelKind`.
- [x] **Guardas de Instagram já valendo** (nenhum canal existe ainda, mas o
      caminho não pode cair no ramo Meta): `sendMessageToConversation` lança
      `not_supported`; `flows/meta-send.ts` (`exigirWhatsApp`) e
      `automations/meta-send.ts` lançam (D1); reação → 400; apagar/editar →
      frase do Instagram; `set-default` recusa promover; `POST /api/cb/channels`
      recusa `kind: 'instagram'` até a Fase 2; nova conversa não oferece a
      conexão; compositor esconde modelo e interativa; saúde não sonda.
- [x] i18n: `kind_instagram`/`kindInstagram` nos três namespaces dos dois
      dicionários, cobrados por `transporte.test.ts` (chave montada, fora do
      portão do CI); `InstagramGlyph` + `IconeDoTransporte` (switch exaustivo:
      transporte sem ícone não compila) no painel, no seletor do fio e no
      indicador de saúde.
- [x] **PR #166 mesclado em 10/09/2026** (deploy de produção junto).

### Fase 1b — Identidade do contato sem telefone
Branch própria, ainda sem migration (o tipo fica mais largo que o banco; nada
grava NULL antes da Fase 3).
- [ ] `Contact.phone: string | null` no tipo; o `tsc` aponta cada uso que
      assume string; `src/lib/contacts/identidade.ts` (puro, testado):
      `identidadeDoContato(c)` → telefone formatado, senão `@username`, senão
      nome — usado onde a UI mostra telefone (lista, painel, ficha, card do
      funil, busca, CSV).
- [ ] API v1: `phone` nullable nos serializers + `instagram_id`/`instagram_username`
      expostos; `docs/public-api.md` avisa o integrador.

### Fase 2 — Conexão: cadastrar o canal na tela
Branch `feat/instagram-2-conexao` (construída em 10/09; PR aberto).
- [ ] Migration 989 (acima) — **aplicada em produção antes do merge** (pelo
      operador ou por sessão com o conector autorizado), conferida por leitura.
      ⚠️ É o ÚNICO bloqueio do merge: `CB_CHANNEL_SAFE_COLUMNS` passa a pedir
      as colunas novas, e sem elas o GET de canais cai no aviso de
      "migration ausente" e o painel inteiro trava.
- [x] `CB_CHANNEL_SAFE_COLUMNS` + `CbChannel` com `ig_user_id`, `ig_username`,
      `ig_token_expires_at`, `ig_human_agent` (nunca o token/segredo);
      `CbChannelWithSecrets.ig_app_secret`; `countChannels` conta só WhatsApp
      (o primeiro WhatsApp nasce padrão mesmo numa conta que conectou o
      Instagram antes).
- [x] `POST /api/cb/channels` com `kind: 'instagram'` (rótulo, token, Instagram
      App Secret, `ig_human_agent`): o servidor chama `/me` para **descobrir**
      `ig_user_id`/`ig_username`, gera `verify_token` aleatório
      (`verify-token.ts`, só servidor), cifra token e segredo, grava
      `ig_token_expires_at = now()+60d`, `status='connected'`, **nunca
      `is_default`**; 23505 na MESMA conta = recadastro (token/segredo novos,
      verify token preservado); em outra conta = 409.
- [x] `GET/POST /api/cb/channels/[id]/instagram`: o verify token em claro para
      o painel da Meta (fica cifrado fora do SAFE_COLUMNS) e o token novo
      colado — conferido no `/me` como sendo da MESMA conta antes de gravar.
- [x] Diálogo "Webhook do Instagram" (URL de callback + verify token, com
      copiar), que abre sozinho depois de conectar e pelo botão do cartão; o
      texto diz para ligar a *Assinatura do webhook* da conta e publicar o app.
- [x] `PATCH` allowlist: `ig_human_agent`; `DELETE` já limpa acervo/agendadas.
- [x] `cb-channels-panel.tsx`: terceiro cartão em "Conectar", formulário
      (token e segredo com olho, Human Agent com aviso), `@username` no lugar
      do telefone (`identidadeDoCanal`, também no seletor de canal), validade
      do token (âmbar a 10 dias, vermelho vencido), botão **Renovar token**,
      textos de exclusão próprios, "Tornar padrão" escondido.
- [x] `health.ts`: `/me` com o token, com o cache TTL da Meta → verde/vermelho.
- [x] `src/lib/instagram/graph.ts`: cliente mínimo (`me` por enquanto — os
      outros métodos entram com as fases que os usam), erros tipados, **token
      nunca em URL** (só header), **mensagens da Meta sem o token**
      (`semSegredo`), host preso a `graph.instagram.com`.

### Fase 3 — Entrada: a DM vira mensagem na caixa
- [ ] `src/lib/instagram/webhook.ts` (puro, testado): parse do payload →
      eventos tipados: `mensagem` (texto/anexos, `is_echo`, `is_deleted`,
      `reply_to` — mid ou story), `edicao` (só `num_edit ≥ 1` — o `num_edit: 0`
      que chega com toda DM é **ignorado**), `reacao`, `postback`, `outro`.
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
      edição → `content_text`/`text_before_edit`/`edited_at`; `reply_to.mid`
      → `reply_to_message_id` (a citação do CLIENTE aparece no fio); reação →
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
      png/jpg ≤ 8 MB, vídeo ≤ 25 MB, áudio (`aac/m4a/wav/mp4`) ≤ 25 MB,
      **só PDF** como documento ≤ 25 MB (outro formato → `not_supported` com
      frase que diz "só PDF"), por URL pública do Storage;
      `messaging_type`/`tag HUMAN_AGENT` fora das 24h só com
      `ig_human_agent`; **janela conferida no servidor**
      (`window_closed`, traduzido); `message_id` = `message_id` da resposta.
      `reply_to_message_id` é IGNORADO no envio (a API não cita) — e a tela
      não oferece. Roteamento para funil e reabertura vêm de graça (é o núcleo).
- [ ] **Nota de voz em conversa Instagram**: o gravador (`opus-recorder`) grava
      com o `waveWorker` em vez do encoder Opus quando `ehInstagram(channelKind)`
      → arquivo `.wav`, mime `audio/wav`, teto 25 MB (avisar antes de estourar:
      WAV 48 kHz mono 16-bit ≈ 5,8 MB/min); `MIMES_POR_TIPO`/bucket já aceitam
      `audio/wav`? — conferir a 023 e alargar na 989 se preciso.
- [ ] Senders do robô (`flows/meta-send.ts`, `automations/meta-send.ts`),
      `react`, apagar-para-todos: `ehInstagram` → erro claro, nunca "Meta"
      (já valendo desde a Fase 1; aqui viram frases traduzidas).
- [ ] `janela-24h.ts` recebe `horas` (24 ou 168) e o fio/compositor ganham o
      estado **"janela fechada — só a pessoa pode reabrir"** (sem "use um
      modelo"), chaves novas nos dois dicionários; contador de 1000 bytes.
- [ ] **Inacessível em conversa Instagram** (D5): Responder/citar, reagir,
      apagar-para-todos, editar, modelo, interativa, anexo que não seja
      imagem/vídeo/áudio/PDF — o gate é o canal ATIVO da conversa
      (`activeChannel`), como o `channelKind` do compositor já faz.
- [ ] Agendada: passa pelo núcleo; fora da janela vira `failed` com motivo
      traduzido (nada muda no disparador).

### Fase 5 — Unificação manual de fichas (D4)
- [ ] Migration própria (número conferido na hora): RPC
      `cb_unificar_fichas(p_sobrevivente uuid, p_absorvida uuid)`,
      `SECURITY DEFINER` com `REVOKE`/`GRANT` explícitos (regra do banco
      vazio), chamada só pela rota: reparenta tudo que aponta para a
      absorvida (`contact_tags` e `contact_custom_values` com guarda de
      UNIQUE — molde da 022 —, `deals`, `flow_runs`, `cb_tasks`, `cb_meetings`,
      `cb_lead_events`, `cb_calendly_eventos`, `cb_webhook_eventos`,
      `notifications`, `automation_logs`, `automation_pending_executions`),
      **move as mensagens da conversa absorvida para a conversa da
      sobrevivente** (UNIQUE `(account_id, contact_id)` da 036 — as mensagens
      já carregam `channel_id`, então o trecho do Instagram aparece sob o
      `SeparadorDeCanal`), copia `instagram_id`/`instagram_username` para a
      sobrevivente e apaga a absorvida. Uma transação; conta conferida nas
      duas fichas.
- [ ] `POST /api/cb/contatos/[id]/unificar` (admin+): sobrevivente = a ficha
      com telefone; absorvida = a ficha só-Instagram. Recusa qualquer outra
      combinação na v1.
- [ ] UI: na ficha/painel de um contato só-Instagram, botão **"Este cliente
      também está no WhatsApp"** → busca de contato (nome/telefone, reusa a
      busca de `/contacts`) → confirmação em linguagem clara ("as mensagens do
      Direct passam para a conversa de X; a ficha do Instagram some") →
      recarrega e navega para a conversa unificada.
- [ ] Depois de unificada, a conversa tem canal Instagram E WhatsApp: o
      seletor do cabeçalho oferece os dois, e o compositor segue o canal
      ATIVO (Fase 4). Entrada nova por qualquer um dos dois cai na mesma
      conversa (`follow`).

### Fase 6 — Token: o canal não pode morrer sozinho
- [ ] `GET /api/cb/instagram/cron` (`x-cron-secret`): renova tokens com
      `ig_token_refreshed_at` > 7 dias e idade > 24h; **compara `expires_in`**,
      não o status HTTP (200 com o mesmo token não é renovação); falha →
      `status='disconnected'` + `last_error`. Alerta na tela de Conexões
      quando faltam < 10 dias.
- [ ] `docker-stack.yml`: `cb/instagram` no laço lento — ⚠️ vale só depois de
      `docker stack deploy` manual na VPS (o CI não relê o `command`).
- [ ] Teste do cron contra a Meta com o canal real.

### Fase 7 — Fechamento
- [ ] `CLAUDE.md`: seção "Instagram Direct" com o que morde código novo
      (segredo por canal, IGSID fora de `phone`, `num_edit: 0`, mime do áudio,
      predicados de transporte + teste estrutural, D1, D5, unificação).
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
- **Unificação é irreversível** (a ficha absorvida some): a confirmação diz
  isso em linguagem clara, e a rota exige admin.
- **`:latest` da Evolution** não tem relação — registrado no estudo (§9).
