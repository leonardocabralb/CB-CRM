---
paths:
  - "src/app/api/v1/**"
  - "src/lib/api/**"
  - "src/lib/api-keys/**"
  - "src/lib/auth/api-context*"
  - "src/components/settings/api-*.tsx"
  - "src/components/settings/ids-da-conta.tsx"
  - "src/components/settings/documentacao*"
  - "src/components/settings/documentacao/**"
  - "src/components/settings/sub-abas.tsx"
  - "src/lib/integracoes/ids-da-conta*"
  - "src/lib/integracoes/exemplos-de-requisicao*"
  - "docs/public-api.md"
  - "docs/mcp.md"
  - "mcp-server/**"
  - "src/app/*/settings/**"
  - "src/lib/rate-limit*"
  - "src/app/api/account/api-keys/**"
---

# API pública (v1) e Configurações → API — regras

Vale ao mexer nas rotas `/api/v1`, nas chaves e escopos, na doc pública (`docs/public-api.md`, `docs/mcp.md`, `mcp-server/`) e na seção API de Configurações. A régua de "mesma etiqueta" (`chaveDeTag`) e a criação de etiqueta sem duplicata estão em `.claude/rules/contatos.md`; os avisos de saída `deal.*`, em `.claude/rules/webhooks.md`. Mudou o comportamento de uma rota? A doc pública muda no mesmo PR — o integrador lê a doc, não o código.

### API pública: escopo E rota, sempre em par

- ⚠️ **Escopo sem endpoint não faz nada; endpoint sem escopo é buraco.** Os escopos moram em `src/lib/api-keys/scopes.ts` (sem migration: a coluna é `text[]`). O upstream tem 7; `channels:read` e os doze das features do fork (`tasks|scheduled|deals|meetings|notes|custom_fields` × `read|write`) são NOSSOS — num merge, fica a nossa lista (com a dele crua, as rotas do fork nem compilam).
- ⚠️ **Toda rota v1 roda em SERVICE-ROLE e ignora RLS:** cada consulta leva `.eq('account_id', ctx.accountId)` explícito, inclusive os lookups secundários (`profiles`, `contacts`, `conversations`, `pipelines`).
- ⚠️⚠️ **Rota v1 escreve pelo `ctx.supabase`, nunca por `supabaseAdmin()`.** `requireApiKey` devolve `clienteDaApi()` (`src/lib/api/v1/cliente-da-api.ts`), que manda o cabeçalho `x-cb-origem: api`; o gatilho da fila do funil o lê e grava a ORIGEM `api` no movimento (a ordem completa da origem está em `webhooks.md`). Pelo cliente compartilhado, o movimento sai `system` sem erro nenhum, e o integrador perde o filtro que corta o laço do fluxo que reage a `deal.stage_changed`. Pino: `cliente-da-api.test.ts`. Mexeu no cliente da API, mede de novo contra o PostgREST real (a marca é rótulo, não credencial).
- ⚠️⚠️ **Erro de banco NÃO é "não encontrado".** `maybeSingle()` que descarta o `error` transforma timeout em `404 Contact not found`, e o integrador recria o contato, duplicando. `getContactById` ESTOURA em erro de banco — no `PATCH` o 404 falso vinha DEPOIS da escrita bem-sucedida.
- ⚠️ **Instante vindo da API exige OFFSET escrito** (`Z` ou `±HH:MM`) em `scheduled_for` e na janela `from`/`to` das reuniões: sem offset o Postgres lê como UTC, 3 h de erro que não estouram em lugar nenhum.
- ⚠️ **Telefone pela régua das telas (`telefoneDigitado`)** em contatos (`phone`) e mensagens (`to`), com a frase do 400 por `mensagemDoTelefoneDaApi`. Brasileiro sem DDI ganha o 55; JID colado (`…@lid`, `@g.us`) é recusado — apagar o que não é dígito gravaria o LID como telefone de ficha. Custo escrito na doc (`docs/public-api.md#phone-numbers`): número ESTRANGEIRO sem `+` com cara de brasileiro é lido como brasileiro. `ContactInput.phone` é o texto CRU: relido sem o `+`, "+41 55 …" ganharia o 55.
- ⚠️ **`POST /api/v1/deals` exige `stage_id` e recusa segundo card do mesmo contato** (409 `contact_already_has_deal`): etapa por `MIN(position)` despeja o lead na faixa de estacionamento, e o índice único da 911 só cobre `source='channel'`.
- **Escrita de negócio chama `drenarEventosDeFunil()`** (fire-and-forget), como a tela: sem isso a automação de etapa espera o próximo batimento do agendador.
- ⚠️ **O autor da v1 é o DONO DA CONTA, e só ele** (`resolveAuditUserId`, 500 sem dono): é o `user_id` das fichas e conversas que a API cria, e o original lia `whatsapp_config.user_id` (quem conectou o número, cujo login CASCADEia as linhas). O nome carimbado vem de `resolveApiAuthor` (`authorship.ts`), com `membro: false` quando o dono não tem perfil na conta. Quem exige um membro de verdade (dono de reunião) confere o sinalizador.
- **Grupo fica fora da v1** (`.is('group_id', null)` nas conversas); a agendada resolve o canal por `cb_groups` quando a conversa é de grupo.
- **O contato da v1 traz `whatsapp_user_id` e `whatsapp_username`** (só leitura, decisão 5 do operador), no GET de contatos, no contato embutido na conversa e no contato dos avisos `deal.*` (`serializeContact`).
- ⚠️ **A ficha só-BSUID (sem telefone; Fase 11.3) só é alcançável por `POST /v1/scheduled-messages`** (`POST /v1/messages` endereça por telefone), e só pela API oficial: com o canal resolvido numa conexão por QR Code, 409 `not_supported` e nada entra na fila — espelho de `/api/cb/scheduled`. Pino `src/app/api/v1/scheduled-messages/route.test.ts`.
- ⚠️ **O que a doc pública promete, a rota cumpre:** `POST /api/v1/broadcasts` leva o `channel_id` do corpo até `createBroadcast` (a rota do upstream o descarta; com dois números oficiais a campanha sairia por um escolhido ao acaso). Canal inválido = 400 `meta_channel_required`, nada enviado. Pino: `src/app/api/v1/broadcasts/route.test.ts`.
- ⚠️ **`src/lib/rate-limit.ts` é um `Map` em memória POR PROCESSO.** No deploy `start-first` há dois processos vivos: o limite não serializa nada. Idempotência de verdade (não pagar duas vezes, não enviar duas vezes) mora no banco, por cadeado.

### Tag ADITIVA na API v1: `POST /api/v1/contacts/{id}/tags`

`src/lib/api/v1/tags-do-contato.ts` (parse puro) e `src/lib/api/v1/contacts.ts`.

- ⚠️ **O `PATCH` com `tags` continua SUBSTITUTIVO — é contrato publicado.** O aditivo é o endpoint próprio (por nome) e o opt-in `tags_mode: "add"` em `POST /contacts` e `PATCH /contacts/{id}`. O PADRÃO segue `replace`: trocá-lo é decisão de produto.
- ⚠️⚠️ **`tags_mode` vale nos DOIS verbos, e valor desconhecido (`"append"`, `"ADD"`) é 400, NUNCA queda para `replace`** — quem pediu para não apagar não pode ter apagado. Só no POST, o campo aprendido lá e mandado no PATCH seria ignorado e o PATCH apagaria as outras com 200. O modo é lido PURO (`lerModoDasTags`) antes de qualquer consulta; o aditivo é `setContactTags(…, { somenteAcrescentar: true })` sobre o que já foi resolvido — nunca `aplicarMudancaDeTags`, que relê o catálogo e poderia dar 400 DEPOIS de criar o contato.
- ⚠️⚠️ **Aceita NOME OU ID, e a régua é a FORMA do texto** (`pareceIdDeEtiqueta`): UUID canônico é SEMPRE id; o resto é nome. Sem isso, o integrador que copiou o `id` criou uma etiqueta NOVA chamada "32f2da4f-…" e disparou `tag_added`. Id NUNCA cria etiqueta (nem com `create_missing`); id que não é da conta, em `add` ou `remove`, é 400 `unknown_tag_ids` ANTES de qualquer escrita (inclusive antes de criar o contato no POST — por isso `lerTagsPedidas` só lê e a escrita vem depois); nenhuma porta cria nome com forma de UUID (CSV incluso). Os baldes da resposta trazem o nome GRAVADO. O filtro `?tag=` de `GET /contacts` continua só por id.
- ⚠️ **Item de `tags` que não é string é 400, nunca descartado** (`lerTagsDoCorpo`): o filtro antigo transformava os objetos `{id,name,color}` que o próprio GET devolve em lista VAZIA, e o substitutivo APAGAVA todas as etiquetas com 200. `tags: null` continua "não mexer".
- ⚠️⚠️ **`setContactTags` ESTOURA quando um nome pedido não resolve:** o verbo SUBSTITUI, e descartar o irresolvido apagaria justamente a etiqueta que o chamador pediu para manter.
- ⚠️ **Toda comparação de nome de etiqueta passa por `chaveDeTag` — validação incluída.** Com a validação em `toLowerCase()`, `{add:["Bancário"], remove:["bancario"]}` passava pela recusa de "mesmo nome nos dois lados", tirava e reinseria a MESMA etiqueta e disparava `tag_added` de novo.
- ⚠️ **`skippedNames` PRECISA chegar à resposta do aditivo:** sem isso, o nome que pediu criação e não resolveu não caía em balde nenhum — 200, e nada dizendo que não foi aplicado.
- ⚠️ **`removeContactTag` devolve `boolean`** (o `count` do delete): sem ele, "removi" e "não estava lá" são indistinguíveis na resposta.
- ⚠️ **`ContactTagWriteError` e `TagReferenceError` NÃO são `ApiError`:** sem o ramo explícito no catch, o 404/400 sai como 500 genérico.
- ⚠️ **Os 400 de etiqueta vão para o log** (`avisarRecusaDeEtiqueta`: rota, código e `keyId` — nunca o corpo, que tem nome e telefone, nem a chave). A API não guarda respostas; o log do contêiner some a cada deploy — é sinal, não registro.
- **Escopo reusa `contacts:write`/`contacts:read`:** a chave precisa de `contacts:write` para criar o contato de qualquer jeito; um `tags:*` não reduziria privilégio.
- **A auditoria sai de graça:** o gatilho da 912 grava `tag_added`/`tag_removed` (com `origin = 'sistema'` vindo de service role). Não escrever log à mão.
- Pinos: `tags-do-contato.test.ts`, `set-contact-tags.test.ts`, `id-de-etiqueta.test.ts` e os `route.test.ts` de `src/app/api/v1/contacts/`.

### Configurações → API tem TRÊS abas, e a Documentação é gerada do código

`api-panel.tsx`, `sub-abas.tsx`, `ids-da-conta.tsx` + `src/lib/integracoes/ids-da-conta.ts`, `documentacao-de-integracao.tsx` + `documentacao/*` + `src/lib/integracoes/exemplos-de-requisicao.ts` (`?aba=chaves|ids|docs`).

- ⚠️ **A seção `api` NÃO é só de admin** (lê em modo leitura), e a aba IDs mostra a conta INTEIRA (funis, conexões, membros com e-mail), sem recorte de perfil: a API também enxerga tudo, e o perfil é recorte de VISUALIZAÇÃO. Os links da Documentação para Webhooks viram texto para quem não vê aquela seção.
- ⚠️ **`go()` da página de Configurações APAGA o parâmetro `aba` ao trocar de seção;** a seção Webhooks lê o MESMO parâmetro (`enviados|recebidos`), derivado da URL no render.
- ⚠️⚠️ **Os números e nomes que a Documentação afirma (prefixo da chave, limite por minuto, prazo, 15 falhas, cabeçalhos, janela da assinatura) são CONSTANTES espelhadas em `exemplos-de-requisicao.ts`**, porque o módulo roda no navegador e não pode importar `deliver.ts`/`keys.ts`/`rate-limit.ts`. O teste as amarra à fonte de servidor e EXECUTA o trecho do nó Code do n8n contra uma assinatura de `buildSignatureHeader`. Número digitado no dicionário mente na primeira mudança.
- ⚠️ **Prosa no dicionário, código fora dele:** o dicionário inteiro vai ao navegador em toda página, e JSON no ICU exige aspas em toda chave. A Documentação é CONCISA.
- ⚠️ **A seção se chama "API", e NÃO "API e integrações"** (decisão do operador): a seção `integracoes` já se chama "Integrações", e duas entradas com a palavra confundiriam. Não "completar" o nome.
- **O link da seção Webhooks para a Documentação mora no CABEÇALHO dela e SOME para quem não vê a seção API** (`podeVerSecao` sobre o acesso efetivo) — ali um rótulo solto não levaria a lugar nenhum.
- **A aba Chaves é `api-keys-settings.tsx` sem cabeçalho próprio** (o cabeçalho é do `ApiPanel`), com "Nova chave" no topo e o estado de carga que falhou.
