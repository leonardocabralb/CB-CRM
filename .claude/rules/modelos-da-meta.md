---
paths:
  - "src/lib/whatsapp/template-*"
  - "src/lib/whatsapp/modelo-da-meta*"
  - "src/lib/whatsapp/modelo-da-mensagem*"
  - "src/lib/whatsapp/linha-do-modelo*"
  - "src/hooks/use-modelos-da-conta*"
  - "src/app/api/whatsapp/templates/**"
  - "src/components/settings/template-manager.tsx"
  - "src/components/inbox/template-picker*"
  - "src/components/broadcasts/step3-personalize*"
  - "src/hooks/use-broadcast-sending*"
  - "src/lib/automations/parametros-do-modelo*"
---

# Modelos da Meta — regras

Vale ao mexer no catálogo de modelos (`message_templates`), na submissão,
edição e sincronização, no stub do webhook, no construtor do envio e nas
variáveis do modelo em qualquer caminho de envio. O resto do envio
(núcleo, Graph API, guarda de papel das rotas de modelo, disparo) está em
`.claude/rules/whatsapp-envio.md`; os valores do passo "Enviar modelo" da
automação, em `.claude/rules/automacoes-passos.md`.

- ⚠️ **O núcleo MONTA o modelo antes de tentar** (`buildSendComponents`):
  mídia de cabeçalho sem arquivo, valores a menos, variável de cabeçalho vazia
  e botão de URL sem o final são 400 `bad_request` ANTES da Meta — nunca
  `meta_error` ("pode ter saído"). Corpo VAZIO vai à Meta, que recusa. O robô
  tem a régua dele (`faltaNoModelo`).
- ⚠️⚠️ **`resolveTemplateRow` (`template-body.ts`) tem o 5º parâmetro NOSSO,
  `channelId`, e os 5 call sites o passam.** O catálogo da Meta é POR WABA: sem
  o recorte, numa conta com dois números o atendente vê o preview de um modelo
  e o cliente recebe outro. Conferir os 5 a cada merge.
- ⚠️⚠️ **`message_templates` tem índices únicos PARCIAIS, por CONTA desde a
  1150** (conta + número + nome + idioma; e conta + nome + idioma na linha sem
  número, `NULLS NOT DISTINCT`). Os da 903 eram por AUTOR: dois admins
  repetiam o modelo, e o autor nulo (1116) escapava. A linha do número e a
  global ainda convivem. `.upsert(…, { onConflict })` não funciona (42P10) —
  lookup + insert/update. E `.maybeSingle()` só com recorte de canal
  (`.is('channel_id', null)` para o padrão), senão estoura com modelo
  homônimo em outra WABA.
- ⚠️⚠️ **Apagar uma CONEXÃO solta os modelos dela**
  (`cb_channels_solta_modelos`, BEFORE DELETE, 1150): a linha que repetiria
  uma GLOBAL da conta (mesmo nome e idioma; idioma nulo conta) é APAGADA e a
  global fica; as outras viram globais ali mesmo — não só pelo SET NULL da
  FK, que roda no fim da instrução e faria colidir duas conexões apagadas
  juntas (apagar a conta). Sem isso, o índice global por conta dava 23505 e a
  remoção falhava. Nada muda na Meta; nenhuma FK aponta para
  `message_templates`. A prova da 1150 chama o gatilho; pino
  `modelos-por-conta-1150.test.ts`.
- ⚠️ **Submit e sincronização escolhem a MESMA linha** (`escolherLinhaDoModelo`,
  `linha-do-modelo.ts`): da conta, nome + idioma, a do número ou a global;
  prefere a do número, depois a vinculada (`meta_template_id`), depois a mais
  antiga. LISTA, nunca `.maybeSingle()`: com a do número e a global juntas, a
  sincronização daquele modelo falhava para sempre. O UPDATE nunca leva
  `user_id` (o AUTOR é de quem criou; só o INSERT o grava). Pinos
  `submit/route.test.ts` e `sync/route.test.ts`.
- ⚠️ **Submit** (`templates/submit/route.ts`): busca a linha ANTES de chamar a
  Meta; erro de busca é 500 sem chamar a Meta. Recusa da Meta com linha
  VINCULADA não grava nada. O rascunho da recusa é regravado com a cerca
  `.is('meta_template_id', null)` NO UPDATE (outra aba pode ter vinculado no
  meio); zero linhas ou 23505 = busca de novo. `modelo_ja_existe` só com linha
  vinculada E recusa 4xx que não é limite, nunca 5xx/rede/tempo. O upstream
  faz o `.upsert` com `onConflict` — num merge cru, toda criação aceita pela
  Meta volta 500.
- ⚠️ **A categoria do modelo APROVADO não muda** (`canEditTemplateCategory`):
  a tela trava o seletor com a frase, e o PATCH recusa com 400
  `categoria_travada` antes da Meta e do upload do cabeçalho. Nos outros
  estados a categoria nova VAI à Meta (só quando mudou) — antes era gravada só
  aqui, e a Meta cobrava pela antiga.
- ⚠️⚠️ **Variáveis NOMEADAS (`{{nome}}`, o padrão do editor da Meta)**:
  `extractTemplateVariables` lê os dois formatos; o nomeado vai com
  `parameter_name`. A LISTA de valores (seletor da caixa, passo 3 do disparo,
  API v1) segue a ordem do `sort()` do JavaScript — código do caractere, nunca
  `localeCompare` (o navegador monta, o servidor casa) —, e a doc pública a
  promete. O POSICIONAL é o código de antes, num ramo próprio (pinos
  "posicional idêntico"): não unificar. No disparo pela tela, o "Avançar" do
  passo 3 poda `variables` às chaves do MODELO (`variaveisDoModelo`: o
  assistente não as zera ao trocar de modelo, e a que sobra deslocaria os
  valores) e `resolveVariables` ordena os nomes pela mesma régua. Criar ou
  editar com `{{nome}}` pela tela é recusado antes da Meta
  (`validateTemplatePayload`; 400 com `code: 'variavel_nomeada'`, que a
  tela troca pela frase do dicionário): o nomeado nasce no
  painel da Meta e chega pela sincronização (os exemplos `*_named_params`
  viram `sample_values` na ordem das chaves).
- ⚠️⚠️ **O stub do modelo criado direto no painel da Meta
  (`template-webhook.ts`) nasce COMPLETO, com canal e DONO.** A conexão sai de
  `cb_channels.waba_id` (`kind='meta'`, exatamente UMA; duas viram só log),
  nunca de `whatsapp_config`; `channel_id` da conexão (linha sem canal valeria
  para todo número); `user_id` = dono da conta. O corpo vem de
  `lerModeloNaMeta` + `conteudoDoModeloDaMeta`, a MESMA conversão da
  sincronização: com `body_text: ''`, `buildSendComponents` contava zero
  variáveis e descartava os parâmetros, e o envio passava a ser recusado.
  Leitura que falha = nenhum stub. Não nasce com linha de mesmo nome e idioma
  no canal OU sem canal, nem para evento de SAÍDA (`PENDING_DELETION`,
  `DELETED`, `ARCHIVED` — ressuscitaria o modelo apagado). A rota passa
  `wabaId: entry.id`. Pino `template-webhook.test.ts`.
- A amostra do cabeçalho de mídia (`template-header-handle.ts`) é lida por
  `lerComTeto`, com `content-length` conferido antes: a URL é colada pelo admin
  e o corpo inteiro na memória deixava o processo derrubável. Pino
  `template-header-handle.test.ts`.
- Catálogo de modelos (`template-manager.tsx`): leitura SEM
  `.eq('user_id', …)` e escrita só para admin (`useCan('edit-settings')`). O
  upstream filtra pelo autor e devolve o catálogo vazio a todo membro que não o
  criou. Pino `src/components/settings/catalogo-da-conta.test.ts`.
- Broadcast e rotas de modelo resolvem a conexão por `resolveMetaChannel`,
  nunca pelo espelho `whatsapp_config`.
- Evento de modelo que não é troca de situação (FLAGGED, LOCKED…) não grava;
  `ARCHIVED` vira PENDING (NOSSO: sai do seletor, como na sincronização).
- ⚠️ **A bolha do modelo desenha cabeçalho de TEXTO, rodapé e botões** pela
  linha local (`modeloDaMensagem`, lida por `useModelosDaConta`): a do canal
  da mensagem, senão a sem canal, nunca a de outro número — menos a mensagem
  SEM canal (histórico; conexão apagada), que enxerga todos, como
  `resolveTemplateRow` sem canal; vários idiomas sem corpo que case = nenhum.
  Cabeçalho de mídia ou com variável fica de fora (o que saiu não é gravado):
  a bolha só afirma o que o cliente viu.
