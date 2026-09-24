# Handoff — plano do merge do upstream (set/2026)

> Passagem de sessão escrita em 24/09/2026, no PR da Fase 6 (#284), e
> atualizada no PR da Fase 7 (#285). Serve para
> retomar o trabalho numa sessão nova. **Fonte de verdade continua sendo o
> plano** (`docs/PLANO-merge-upstream-2026-09.md`): este arquivo resume onde
> paramos, o que foi corrigido e o que vem a seguir. Confirme tudo contra o
> código e a produção antes de agir — o `CLAUDE.md` manda.

## 1. Onde paramos

- **Fases 0, 1, 1b, 2, 3 (I a IV), 4, 5 e 6: em produção** (o pós-deploy da
  Fase 6 está no plano). Fase 7: mesclada pelo PR #285 (o que leva esta
  atualização). O resultado do rollout e da conferência pós-deploy da Fase 7
  fica na memória (`merge-upstream-2026-09-plano`) e é escrito no plano **no
  PR da Fase 8**, como manda a seção 4 do plano (o pós-deploy da fase N vai
  no PR da N+1).
- **Próxima: Fase 8.** Nenhuma branch aberta para ela.
- **Uma verificação real pendente da Fase 5** (ver seção 4).
- A worktree `.claude/worktrees/merge-upstream` **fica** até o plano fechar.
  O dev server da preview desta sessão roda nela, na porta 3130, com
  `META_APP_SECRET=segredo-teste-um` e `META_APP_ID` (o id público do app)
  por variável de ambiente — os eventos assinados de teste usam esse segredo.
  Numa sessão nova, suba de novo do mesmo jeito (o `.env.local` tem o segredo
  de produção, e a assinatura de teste daria 401).

## 2. O que foi corrigido nesta sessão (o erro → a solução)

### "Enviar para um número" — PR #282 (em produção)

- **Erro:** o passo `send_to_number` das automações lia o telefone pela régua
  dos SISTEMAS (`digitosDoTelefone`): "98000-0016" (sem DDD) virava +98, e um
  JID de contato colado (`…@lid`) virava telefone. O aviso ao advogado podia
  sair para outro número, sem erro.
- **Solução:** a régua das TELAS (`telefoneDigitado`) na validação ao ativar
  (com o motivo), no motor, no resumo do passo e no campo do construtor, que
  avisa na hora. Pino em `telefone-digitado.chamadores.test.ts`. O CHANGELOG
  traz a consulta para listar automações antigas com número que deixou de
  valer.

### Fase 5 — o motivo da falha da Meta — PR #283 (em produção)

- **Erro:** quando a Meta recusava a entrega (ex.: modelo fora da janela), o
  motivo vinha no recibo e era jogado fora; a bolha só dizia "não entregue".
- **Solução:** o webhook da Meta grava `error_code`/`error_title`/
  `error_details` (colunas da 1039) na mensagem e o motivo em
  `broadcast_recipients.error_message`, nos MESMOS updates condicionais da
  escada. O `errors[0]` é LIDO (parse), nunca `as`: código não numérico,
  fracionário ou fora do `integer`, e texto com NUL ou surrogate solto,
  derrubariam o UPDATE que pinta a falha (medido num Postgres 16). A bolha
  mostra "Motivo informado pela Meta: …" (`motivoNaBolha`).

### Fase 6 — modelos da Meta — PR #284

- **6a, erro:** a amostra do cabeçalho de vídeo/documento era lida INTEIRA
  (`arrayBuffer`) antes do teto de 100 MB — um link para um arquivo enorme
  derrubaria o processo Node de todas as contas.
  **Solução:** `content-length` conferido antes e a leitura para no teto
  (`lerComTeto`, agora em `src/lib/http/ler-com-teto.ts`).
- **6a, erro achado pela revisão:** o `catch` sem filtro dizia "maior que o
  limite da Meta" também para tempo esgotado e conexão cortada.
  **Solução:** `TetoExcedido`; os outros erros têm frase própria.
- **6b, erro:** o modelo criado direto no painel da Meta não aparecia no CRM
  até alguém clicar em Sincronizar; o porte cru do original resolvia a conta
  por `whatsapp_config` (nunca casa aqui).
  **Solução:** a conexão por `cb_channels.waba_id` (exatamente uma oficial),
  com `channel_id` e o dono da conta em `user_id`; a rota passa
  `wabaId: entry.id`.
- **6b, erro achado pela revisão (o mais sério):** o stub nascia com o corpo
  VAZIO e virava o modelo do envio — o envio pelo nome com variáveis (API v1,
  disparo) passava a mandar zero parâmetros e a Meta recusava.
  **Solução:** o webhook LÊ o modelo na Meta pelo id (token da conexão) e usa
  a MESMA conversão da sincronização (`src/lib/whatsapp/modelo-da-meta.ts`,
  extraída da rota de sincronização sem mudar o que ela grava). Leitura que
  falha = nenhum stub, só log (sem a mensagem da Meta, que pode ecoar o token).
- **6b, outros dois da revisão:** o aviso de exclusão (`PENDING_DELETION`)
  ressuscitava o modelo que o CRM acabou de apagar → evento de saída não cria
  stub; a busca "já existe" olhava só o canal, e o stub nascia ao lado da linha
  sem canal que a sincronização adota → busca por canal OU nulo.
- **Verificado:** typecheck limpo; lint 60 avisos (igual ao `main`); i18n OK;
  5.848 testes verdes no Node 22; mutantes 21/21; duas revisões (duas lentes
  com cético no commit da fase; um revisor com cético no commit das correções,
  sem P0–P2); E2E contra a Meta de verdade
  (modelo de teste criado, stub completo, qualidade na mesma linha, id
  inexistente sem stub, Sincronizar adotando, exclusão sem ressurreição, tudo
  limpo — 9 modelos na Meta e no CRM).

### Fase 7 — por que a conexão com a Meta falhou — PR #285

- **Erro:** quem conecta número oficial em *Conexões* recebia a frase crua
  da Meta ("(#100) Unsupported get request") num toast que sumia. O #505 do
  original, que explica o erro, tinha chegado pelo #259 só à rota LEGADA
  `/api/whatsapp/config` — tela não montada, e o POST dela respondia 500 a
  toda chamada desde 27/07 (defeito nosso).
  **Solução:** `explainMetaError` ganhou o `motivo` (lista fechada); a rota
  `POST /api/cb/channels` devolve `{ error, falha }` (`falha-da-meta.ts`) e o
  diálogo mostra um aviso que FICA, em português, com o campo a conferir
  destacado e a etapa, o código, o trace id e a mensagem da Meta embaixo.
- **Erro:** uma WABA válida de OUTRO número era aceita (a conexão salvava e o
  webhook nunca chegava), e a falha da assinatura da WABA era engolida (a
  conexão nascia "conectada" sem receber nada).
  **Solução:** com o WABA ID, o número tem de estar entre os que a Meta lista
  sob ela; a assinatura da WABA é fatal e nada é gravado. O registro por PIN
  continua best-effort.
- **Erro:** a mensagem da Meta ecoa o token e ia para a tela e o log;
  `paging.next` era seguido sem cerca levando o token; o início do upload de
  cabeçalho de modelo punha o token na URL.
  **Solução:** `semTokenDaMeta`; `paging.next` só em `graph.facebook.com` e
  teto que lança; o token do upload em `Authorization: OAuth`.
- **Erro achado no teste com o token REAL** (autorizado; só leituras): a WABA
  trocada volta "(#100) Tried accessing nonexisting field (phone_numbers)", e
  a tela dizia "a Meta recusou um valor".
  **Solução:** a frase entrou na regra do código 100 → "a Meta não encontra o
  WABA ID", com onde copiá-lo.
- **O POST legado foi APOSENTADO** (410, aponta para *Conexões*): consertado,
  gravaria credencial da Meta por cima do espelho Evolution. A doc do
  original apagada no #259 foi reescrita como `docs/conexao-meta.md`.
- **Verificado:** typecheck; lint 60; i18n OK; 5.956 testes no Node 22;
  mutantes 21/21; duas lentes com cético (nenhum P0–P2, quatro P3
  corrigidos) e uma revisão curta dos commits de correção; E2E na preview
  (id não numérico, token inválido na Meta de verdade, resposta atrasada,
  upload com o token no cabeçalho criando e apagando um modelo de teste, e o
  script com o token real). Nada gravado em `cb_channels`.

## 3. O que falta — as próximas fases

Cada uma passa pelo PORTÃO da seção 4 do plano (medir → implementar → verificar
→ duas lentes com cético → preview → PR → CI → `@codex review` → merge com
`--match-head-commit` → pós-deploy → registrar). Detalhes, testes e riscos de
cada fase estão na seção 7 do plano.

| Fase | O quê | Pontos de atenção já conhecidos |
| --- | --- | --- |
| **8** | Notificação do navegador (#516) | Montar o ouvinte DENTRO da `<PortaDeEntrada>`, com o recorte do perfil (contexto REAL, nunca a lente do "Ver como"), grupo fora e a mensagem histórica/recuperada fora. Decidir o destino do `wacrm:browser-notifications` de quem ligou entre 23/09 16:40Z e a correção. O cartão está escondido até lá (pino `cartao-de-notificacao.chamadores.test.ts`). |
| **9** | "Digitando…" da IA (#527) | Pelo canal DA CONVERSA e só com `ehMeta`; não adotar `loadAccountMetaCredentials`; falha nunca segura a resposta. Inerte hoje (auto-reply desligado). O teste prático depende de o operador mandar mensagem ao número oficial. |
| **10** | i18n das telas em inglês (#577–#579) | Traduzir as telas NOSSAS com texto fixo (`message-composer`, `message-thread`, `automations/page`, `invite-member-dialog`, `ai-usage`…) e tirar as ~129 chaves órfãs da união do #259. "wacrm" vira `{appName}` ou "este CRM". Pode ser fatiada. |
| **11** | BSUID (#533) — por último | Decisão P4 (`NULL` + CHECK alargado) abre a fase; subfases 11.0 a 11.5 no plano. Colunas (1038) e `wa-identity.ts` já estão no `main`; entrada, saída e tela faltam. |
| **12** | Inventário do que o #259 descartou | A tabela "O que ficou de fora" na seção do #259; a prova é `git diff aee1b01f origin/main -- <arquivo>` mostrando só divergência nossa. |

## 4. Pendências fora das fases

- **Fase 5, verificação real pendente:** provar o motivo da falha com um envio
  de modelo REAL fora da janela de 24h ao lead de teste autorizado (a janela
  dele fechava em 24/09 às 19:14Z). É efeito externo (modelo tarifado),
  delegado pela decisão P5; só o lead de teste. Registrar no plano.
- **Decisões do operador ainda abertas no plano:** P2 (notificação), P4
  (BSUID), P6 (descartar alguma fase), P9 (os 2 commits do original depois do
  alvo).
- **Registrados, não corrigidos (Fase 6):** o primeiro Sincronizar troca o
  dono do stub pelo admin que sincroniza (defeito anterior da rota de
  sincronização, M24); stub do dono e linha de outro admin no mesmo instante
  podem nascer juntos (raro); a leitura do modelo na Meta (até 10 s) roda em
  série no laço do webhook, então mensagens que a Meta mande no MESMO POST de
  um evento de modelo desconhecido esperam por ela (raro — conserto possível:
  tratar os eventos de modelo depois das mensagens, como os recibos). (O
  `access_token` na query do início do upload saiu na Fase 7.)
- **Registrado, não corrigido (Fase 7):** a sonda de saúde (`health.ts`,
  ramo Meta) loga a mensagem crua da Meta, que pode ecoar o token
  (pré-existente; `semTokenDaMeta` resolveria). Ligar a Meta à retentativa de
  automação ficou FORA do plano (régua por `code`, decisão do operador).
- **Outras pendências de sessões anteriores** — conferir na memória antes de
  agir: a conferência do cenário do Make pelo operador; a ficha da Kommo com
  14 dígitos; a tolerância de 8 dígitos do disparo (P2 refutado na 3-III,
  anterior à fase); a janela do `falhou` no Meu dia; `site_url`/SMTP e os
  logins avulsos; os 6 P3 da revisão do recibo da Meta (#277) aguardando
  decisão; os follow-ups da Fase 4 (aviso de `{{vars}}` em títulos,
  `Object.hasOwn` em `interpolateVars`, passos interativos crus).

## 5. Regras que valem na retomada (as que já morderam)

- Segredo nunca na conversa. O token da Management API só por
  `zsh -lc 'node …'`, nunca impresso. O `.env.local` não é lido nem impresso.
- WhatsApp real só para o lead de teste autorizado. No preview, abrir só a
  conversa dele pela URL (`/inbox?c=…`, o id está na memória) — abrir
  conversa zera as não lidas da conta inteira.
- PR só para `leonardocabralb/CB-CRM`; branch só a partir de `main`;
  push/merge no `main` = deploy de produção. Merge com
  `gh pr merge --merge --match-head-commit <SHA exato>`, depois de conferir
  que o `main` não andou.
- Ação destrutiva exige confirmação explícita do operador.
- Repositório PÚBLICO: nada de dado pessoal em commit.
- O guarda do Bash da worktree recusa heredoc e laço complexo: scripts no
  scratchpad, rodados por `bash`/`python3`, ou `zsh -lc 'node …'`.
- Suíte no Node do CI: `npx -y node@22 node_modules/vitest/vitest.mjs run`;
  com a máquina carregada, `--maxWorkers=4` (senão worker que não sobe e
  teste trivial estourando 5 s aparecem como falha).
- Mutante com stream SEM fim trava o teste em vez de reprovar, e o worker
  órfão fica girando depois (nesta sessão, dois ficaram 7,5 h a 200% de CPU).
  Use corpos finitos e confira `ps` depois de rodar mutantes.
- Mensagem enviada durante uma revisão por workflow INTERROMPE os agentes em
  curso (eles recomeçam). Revisões longas: rodar sem interrupção.
- `@codex review`: a cota tem estado esgotada; conferir por `gh api` se há
  revisão do HEAD — "usage limits" = sem revisão.
