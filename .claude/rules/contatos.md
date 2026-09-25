---
paths:
  - "src/lib/contacts/**"
  - "src/components/contacts/**"
  - "src/app/*/contacts/**"
  - "src/app/api/contacts/**"
  - "src/app/api/v1/contacts/**"
  - "src/lib/api/v1/contacts*"
  - "src/lib/api/v1/custom-fields*"
  - "src/components/settings/custom-fields-settings.tsx"
  - "src/components/settings/fields-and-tags-panel.tsx"
  - "src/components/settings/tag-manager.tsx"
  - "src/lib/whatsapp/phone-utils*"
---

# Contatos — regras

Vale para a ficha, a lista e a importação de contatos, o telefone, as
etiquetas e a exclusão. Campo personalizado que salva sozinho, blocos de
campos, e-mail espelhado e nome escrito à mão → `campos-e-nome.md`. Dono
durável (`user_id` = dono da conta) → raiz, seção 8. Apagar e fundir fichas no
banco → `supabase.md`. Recarga ao voltar ao app → `ao-voltar.md`. Abas e painel
lateral da ficha (armadilha do tailwind-merge) → `ui.md`.

### Chave única do telefone (1024)
`contacts.telefone_canonico` (coluna gerada: dígitos, e o celular brasileiro
de 12 dígitos ganha o nono dígito) + índice único `(account_id,
telefone_canonico)`. `telefoneCanonico`/`chaveDePessoa` são o espelho em TS,
com teste lendo a migration. O índice da 0022 (grafia exata) continua, mas não
decide mais "mesma pessoa".

- ⚠️⚠️ **Todo INSERT em `contacts` sabe o que fazer com o 23505.** No servidor
  o trato é `fichaQueVenceu` (`dedupe.ts`): relê a ficha que venceu, com nova
  tentativa se a LEITURA falhar — na ingestão, desistir é perder a mensagem do
  cliente. Pino default-deny `chave-canonica.chamadores.test.ts`: escritor novo
  reprova até declarar o trato.
- ⚠️⚠️ **`findExistingContact` busca pelos DÍGITOS (`phone_normalized`),
  nunca pelo texto cru, e prefere a IRMÃ do nono dígito** ao casamento pelos 8
  finais. Pelo texto, "+55 83 98000-0016" não casava e a mensagem sumia; a
  tolerante sozinha devolve a ficha mais antiga com o mesmo final — outro DDD,
  outra pessoa. Nunca passe JID de grupo, LID ou IGSID por ela (fundiria com o
  celular de um cliente) — e ela RECUSA sem consultar texto com letra (BSUID,
  LID, JID), cujos dígitos casariam pelos 8 finais (Fase 11.2).
- ⚠️ **Lote casa por PESSOA** (`chaveDePessoa`), nunca por grafia: dedupe por
  grafia derruba o lote inteiro no 23505. O CSV do disparo busca as DUAS
  grafias (`variantesDoNonoDigito`) em fatias, abaixo do teto de 1000 linhas.
- Coluna gerada não lê outra gerada: a canônica sai de `phone`, repetindo o
  `regexp_replace`.
- Ficha só do Instagram: `phone` nulo, canônica nula, fora do índice parcial.
- Ficha só-BSUID (a Meta sem telefone; 1041): `phone` nulo, identidade em
  `wa_user_id`, único POR CONTA (índice parcial da 1038). O BSUID nunca passa
  por `findExistingContact`: casamento EXATO, `buscarPorBsuid`/
  `fichaQueVenceuPorBsuid` (`src/lib/contacts/bsuid.ts`).
- Fundir fichas NÃO é `merge_duplicate_contacts` (apaga tarefas do perdedor e
  agrupa por grafia exata): a receita está em `supabase.md`.

### Telefone digitado — a nossa régua
- ⚠️⚠️ **Todo telefone que uma PESSOA ou um INTEGRADOR digita passa por
  `telefoneDigitado`/`escritaDoTelefone` (`telefone.ts`)**: brasileiro sem DDI
  ganha o 55 (10 dígitos, ou 11 com 9 na 3ª posição — é assim que se separa de
  um número dos EUA); letra (o `@g.us`) e mais de 15 dígitos são recusados; a
  linha do CSV sai normalizada. O original resolveu o mesmo defeito EXIGINDO o
  `+` (`parseInternationalPhone`, APAGADO daqui) — o contrário do que o
  escritório digita. Pino `telefone-digitado.chamadores.test.ts`: cobra as
  telas (formulário, ficha, `dedupeByPhone`) e as portas (API v1 de contatos,
  mensagens e disparo, "Nova conversa", webhook de entrada) e reprova o nome
  `parseInternationalPhone` em `src/`.
- Nunca `sanitizePhoneForMeta` + `isValidE164` sobre o que foi DIGITADO:
  "(81) 98874-5316" virava a ficha +81, e um JID colado virava telefone.
- Custo escrito na doc pública: número estrangeiro com código do país, SEM `+`,
  de 10 dígitos (ou 11 com 9 na 3ª posição) é lido como brasileiro.
- Na edição, telefone que não mudou não é conferido nem regravado.
- `ContactInput.phone` é o texto CRU: o disparo manda `to`, nunca os dígitos já
  lidos ("+41 55 555 12 12" relido sem o `+` ganharia o 55).

### Exclusão de contato — só admin (981)
Apagar leva a conversa e TODAS as mensagens (CASCADE), e isso é do escritório.
- ⚠️⚠️ **Admin nos DOIS lados**: `canDeleteContacts` na tela e a policy
  `contacts_delete` (981). Só o DELETE: `contacts_insert`/`contacts_update`
  continuam em `agent` (cadastrar e corrigir é atendimento; a 981 confere). Ela
  é restritiva: foi aplicada DEPOIS do deploy.
- ⚠️ **Os dois caminhos SOMEM juntos para quem não é admin** (item do menu da
  linha e botão da seleção múltipla). Nunca um `GatedButton` desabilitado num
  deles.
- ⚠️⚠️ **Confira o ROWCOUNT (`lerExclusao`, `exclusao.ts`)**: RLS que barra
  DELETE devolve 0 linhas com `error: null`, e a tela diria "excluído" sobre
  contato intacto. O toast conta os que SAÍRAM, nunca os pedidos.
- ⚠️⚠️ **Zero linhas tem dois significados, e o motivo é MEDIDO**: depois de um
  DELETE incompleto, uma consulta pergunta quais pedidos AINDA EXISTEM (os que
  existem foram recusados; os que não existem, outro apagou). Nunca inferir do
  papel em cache — um admin rebaixado com a página aberta ainda "pode" em
  memória. Conferência que falha vira `falhou`, nunca palpite.
- ⚠️ **A seleção perde os RESOLVIDOS** (apagados e sumidos), e só eles:
  `fetchContacts({ preservarSelecao })` + `selecaoRestante`. A recarga da lista
  zera a seleção sozinha — sem o par, a poda não vale na prática.

### Etiquetas: UMA régua de "mesma etiqueta" (`chaveDeTag`)
- ⚠️⚠️ **`chaveDeTag` (aparado, sem acento, minúsculas) vale nas três portas
  que criam etiqueta** (API aditiva, `PATCH` substitutivo, CSV) **e no banco**,
  pela coluna gerada `tags.name_key` (983/984). Decisão do operador,
  09/09/2026: uma régua só — com duas, "bancario" criava uma segunda
  "Bancário". Toda comparação de nome passa por ela, validação incluída.
- ⚠️ **Etiqueta duplicada que já existe é RENOMEADA com sufixo, nunca
  apagada** (a 983 fez assim): `tags.id` é referenciado por JSON sem FK —
  gatilho e passos de automação, nós de fluxo, filtro salvo —, e apagar deixa
  essas regras apontando para um id morto, sem casar nunca mais, em silêncio.
- ⚠️ Os dois lados normalizam para NFD ANTES de apagar o sinal: a forma
  decomposta (macOS, geradores de CSV) viraria outra chave. No TS, `\p{Mn}`,
  nunca `\p{Diacritic}`. No SQL, o intervalo `[\u0300-\u036f]` por ESCAPE, nunca
  o caractere literal (invisível). Pino `chave-de-tag-casa-com-o-ts.test.ts`. O
  TS colapsa um pouco MAIS que o SQL, de propósito: o contrário faria o código
  pedir etiqueta nova, levar 23505 e ela sumir.
- ⚠️⚠️ **Criar é `upsert` com `ON CONFLICT DO NOTHING` + RELEITURA**, só em
  `resolveImportTagIds` (`resolve-import-tags.ts`), para as três portas
  herdarem. Ler-então-inserir deixa duas requisições criarem a mesma etiqueta
  e disparar `tag_added` duas vezes (mensagem em dobro ao cliente). O id sai da
  releitura, nunca do retorno (quem perde a corrida recebe zero linhas).
- ⚠️⚠️ **O upsert vai ORDENADO** (`toCreate`): com o índice único, duas
  requisições com as mesmas etiquetas novas em ordens diferentes fecham um
  deadlock (40P01).
- ⚠️⚠️ **`setContactTags` aplica SÓ os nomes PEDIDOS, nunca
  `tagIdByKey.values()`** (o mapa é o catálogo inteiro: o `PATCH` aplicava TODAS
  as etiquetas da conta). E ESTOURA quando um nome pedido não resolve: o verbo
  substitui, e descartar em silêncio APAGARIA a etiqueta pedida. Pino
  `set-contact-tags.test.ts`.
- Catálogo lido ORDENADO por `created_at, id` (na colisão vence a mais antiga)
  e PAGINADO (`lerCatalogoDeTags`): truncado, ele diz "não existe" sobre
  etiqueta que existe.
- Texto com forma de UUID é id, nunca nome (`pareceIdDeEtiqueta`): id não cria
  etiqueta, e `resolveImportTagIds` recusa CRIAR nome com essa forma em
  qualquer porta.
- A prévia do CSV (mapa de cores, "será criada", contagem) usa a mesma régua.
- Aplicar pelo código (`tag-events.ts`) dispara a automação `tag_added`; INSERT
  direto em `contact_tags` não (a trilha 912 grava igual). Não escreva log de
  etiqueta à mão.

### Catálogo da conta nas telas
`tag-manager`, `template-manager` e `settings-overview` leem SEM
`.eq('user_id', …)`: `user_id` ali é AUTORIA, e o recorte deixava o catálogo
VAZIO para quem não é o dono. Escrita só para admin (`useCan('edit-settings')`);
o DELETE de etiqueta confere o `count` com `lerExclusao`. Pino
`catalogo-da-conta.test.ts`. O original filtra pelo autor e mostra os botões a
todos: num merge, fica o nosso.

### API v1 de contatos
- `getContactById` ESTOURA em erro de banco: erro não é 404 (o integrador
  recriaria a ficha).
- Item de `tags` que não é string é 400, nunca descartado (o substitutivo
  apagaria tudo com 200); `tags: null` = não mexer.
- `tags_mode: "add"` é opt-in, o padrão continua `replace` (contrato publicado);
  valor desconhecido é 400, nunca queda para `replace`. Etiqueta por nome OU id,
  validada ANTES de qualquer escrita. Detalhes em `api-v1.md`.
