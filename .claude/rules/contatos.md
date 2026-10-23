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
  - "src/hooks/use-contatos-relacionados*"
  - "src/hooks/use-possiveis-duplicatas*"
  - "src/hooks/use-comparacao-de-fichas*"
  - "src/hooks/use-uniao-de-fichas*"
  - "src/hooks/use-lixeira*"
---

# Contatos — regras

Vale para a ficha, a lista e a importação de contatos, o telefone, as
etiquetas e a Lixeira. Campo personalizado que salva sozinho, blocos de
campos, e-mail espelhado e nome escrito à mão → `campos-e-nome.md`. Dono
durável (`user_id` = dono da conta) → raiz, seção 8. Apagar e fundir fichas no
banco → `supabase.md`. Recarga ao voltar ao app → `ao-voltar.md`. Abas e painel
lateral da ficha (armadilha do tailwind-merge) → `ui.md`. Anúncio de origem nos
campos de traqueamento (`anuncio-de-origem.ts`) → `ingestao.md`.

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
  `fichaQueVenceuPorBsuid` (`src/lib/contacts/bsuid.ts`). Na tela ela aparece
  pelo `@` do WhatsApp (`identidadeDoContato`, nunca o BSUID); o telefone é
  apagável quando há outra identidade (`podeFicarSemTelefone`: Instagram OU
  BSUID). As três buscas (`casaComABusca`, `casaComContato`,
  `ramosDaBuscaDeContato` — que o seletor da agenda também usa) casam pelos
  dois `@`; "@" sozinho não casa nada (agulha vazia). Limite escrito: a busca
  de /contatos (RPC 025) e o `?search=` da v1 não olham o `@`.
- Fundir fichas NÃO é `merge_duplicate_contacts` (apaga tarefas do perdedor e
  agrupa por grafia exata): é `cb_unir_fichas` (1092, abaixo).
- ⚠️ **Busca por texto livre casa LITERALMENTE** (`src/lib/postgrest/literal.ts`):
  a de /contatos, o `?search=` da v1 e os seletores de cliente
  (`busca-remota.ts`) montam o `.or()` com `ramoContem` (`imatch` com o termo
  escapado, entre aspas), e o termo da RPC 025 vai por `escaparLike`. Cru,
  vírgula e parêntese quebravam o `.or()` (400, "falha ao carregar") e `%`,
  `_` e `*` viravam curingas — o PostgREST troca TODO `*` de um
  `like`/`ilike` por `%`, sem escape possível ("L*K*A", um cliente real,
  trazia 37 fichas). Busca nova usa o mesmo módulo, nunca `ilike` com texto
  de fora. Pino `src/lib/postgrest/literal.chamadores.test.ts`.

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

### Lixeira de contatos (1097): excluir é MOVER, e é de admin
Decisões do operador (22/10/2026, B1–B6): `docs/PLANO-lixeira-de-contatos.md`.
`src/lib/contacts/lixeira.ts` (puro: leituras, motivos, fatias),
`src/hooks/use-lixeira.ts` (as chamadas às RPCs da 1097),
`mover-para-lixeira-dialog.tsx` (prévia, mover e "Desfazer") e a tela
`/contacts/lixeira` (`src/components/contacts/lixeira/`). A receita no banco
(fotografia, sinal, default-deny): `supabase.md`, "APAGAR CONTATO".
- ⚠️⚠️ **Excluir = mover (B1)**: `cb_mover_contatos_para_lixeira` fotografa
  a ficha e tudo o que o CASCADE levaria, ENCERRA execuções, esperas e robô
  dela (restaurar não religa) e apaga a ficha como antes: para o resto do CRM
  (automação, IA, API, integrações) ela não existe. Em 90 dias o servidor a
  exclui de vez.
- ⚠️⚠️ **Admin POR DENTRO**: toda RPC da Lixeira confere admin e suspensão
  (1067) e recusa o LOTE inteiro com um id de conta onde quem chama não é
  admin. Na tela os caminhos SOMEM juntos para quem não é admin (menu da
  linha e seleção múltipla; nunca um `GatedButton` desabilitado); cadastrar
  e corrigir seguem de `agent`.
- ⚠️⚠️ **Só a Lixeira apaga (1100)**: sem a policy `contacts_delete` e sem o
  privilégio, um DELETE do navegador dá 42501 — a página crua do upstream
  num merge passa a FALHAR, nunca a apagar sem fotografia. Apagam ainda as
  funções SECURITY DEFINER (Lixeira, união, desfazer da Kommo), o CASCADE da
  conta e o service role. Pino `so-a-lixeira-apaga-1100.test.ts` (os `.sql`
  e nenhum `.from('contacts')…delete()` em `src/`) e item 18 da §6 de
  `docs/MERGE-UPSTREAM.md`.
- ⚠️ **Prévia ANTES de mover** (`cb_previa_da_lixeira` → `lerPrevia`,
  `previaTemAviso`): o que o mover cancela de COLEGAS — agendadas (com o
  autor), esperas, robôs, tarefas abertas (com o responsável), negócios
  abertos e a conversa aberta com responsável. Prévia que não leu (`null`)
  nunca vira "nada a perder".
- ⚠️⚠️ **Em fatias de `FICHAS_POR_CHAMADA` com o MESMO lote** (`fatiar`; a
  função recusa mais de 100): o "Desfazer" restaura a ação inteira. O
  resultado é POR FICHA (`lerMover`: `movida`/`sumiu`/`recusada` com o
  motivo): o toast conta as que SAÍRAM, e a seleção perde só as resolvidas
  (`resolvidosDoMover`, a régua de `selecaoRestante`, com
  `fetchContacts({ preservarSelecao })` — a recarga zeraria a seleção). A
  recusada (trava, impasse, tabela sem tratamento) fica marcada.
- **"Desfazer" no toast (10 s), só para quem moveu (B5)**:
  `cb_restaurar_da_lixeira` pelo lote — a MESMA restauração da tela.
- ⚠️⚠️ **Restaurar volta com o MESMO id (B6, a doc da API diz)** e traz
  conversas, mensagens, etiquetas, campos, tarefas e anotações como estavam;
  a conversa ganha `restaurada_em` (a régua do aviso e da não lida:
  `meu-dia.md`, `inbox-lista.md`). Nada sai ao cliente: agendada pendente
  volta como FALHA (a que estava saindo, como entrega incerta). O que voltou
  com ressalva (`lerRessalvas`: linha cujo alvo sumiu nos 90 dias, agendadas
  em falha, movimento de card sem automação, ZapSign sem contato, par ainda
  na Lixeira, coluna que sumiu) aparece com o número.
- ⚠️⚠️ **Identidade ocupada BLOQUEIA (B2)**: telefone, BSUID ou Instagram que
  já é de outra ficha → `identidade_ocupada`, e a lista mostra "ocupada pela
  ficha X" com link (`ocupada_por` de `cb_lixeira_da_conta`). Nunca fundir
  nem sobrescrever na volta: une-se depois, por `cb_unir_fichas`.
- ⚠️ **"Excluir agora" (B3)**, com confirmação forte e a marca "é pedido de
  exclusão (LGPD)" (`cb_excluir_da_lixeira`): sem volta; os arquivos vão para
  a fila (`midia.md`); com a marca, saem também ligações e retidas, e o dado
  pessoal dos eventos e da trilha. ⚠️ A tela NUNCA afirma eliminação total:
  backups, a Evolution e o que terceiros baixaram ficam fora do CRM.
- **`/contacts/lixeira`** lê `cb_lixeira_da_conta` (só contas em que a
  pessoa é admin; nunca a fotografia). Dias por `diasRestantes` com o
  relógio por tique: 0 é "vencida, aguardando a limpeza", nunca "excluída".
  Arquivos que a fila não apagou: `cb_arquivos_da_lixeira_parados`. Cada
  recusa tem a sua frase (`motivoDoErro`/`motivoDoCodigo`).
- O card do negócio cuja ficha está na Lixeira (B4): `funil.md`.
- `lerExclusao` (`exclusao.ts`) segue para DELETE do navegador que confere
  ROWCOUNT (etiquetas): RLS que barra devolve 0 linhas com `error: null`, e
  o motivo de zero linhas é MEDIDO (a linha ainda existe?), nunca inferido
  do papel em cache — um admin rebaixado com a página aberta ainda "pode" em
  memória.
- ⚠️ **Conversa e mensagem não se apagam pelo navegador (1096)**: a 0017 dava
  ao `agent` o DELETE de `conversations` e de `messages` (a conversa inteira,
  contornando a 981). Sem policy e sem o privilégio, elas saem só com a
  ficha (a Lixeira; o CASCADE roda como o dono da tabela), pelas funções
  SECURITY DEFINER e pelo service role. As policies são do upstream: pino
  `portas-dos-fundos-1096.test.ts` e item 16 da §6 de `docs/MERGE-UPSTREAM.md`.

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

### Contatos relacionados (1069)
`cb_contatos_relacionados`, `src/lib/contacts/relacionados.ts` (puro, testado),
`use-contatos-relacionados.ts` e `contatos-relacionados.tsx` — a aba
"Relacionados" do painel da conversa e da ficha. Decisões do operador
(29/09/2026) e plano: `docs/PLANO-contatos-relacionados.md`.
- ⚠️ **UM vínculo é UMA linha e vale para os dois lados**: a leitura procura o
  contato nas DUAS colunas (`.or(a.eq,b.eq)`) e mostra a outra ponta
  (`outroLado`). O índice único sobre `LEAST/GREATEST` recusa o par repetido
  em qualquer ordem (23505 → "já vinculados"); nunca gravar A→B e B→A.
- **Par a par**: três pessoas no mesmo caso = três vínculos. Sem "grupo de
  caso" (decisão do operador).
- **FKs compostas com CASCADE**: apagar uma das fichas desfaz o vínculo; a
  fusão de fichas reaponta os vínculos (receita em `supabase.md`).
- ⚠️ **Os dados vêm por PROP e são carimbados (`{ de, itens }`)**: o painel
  não remonta ao trocar de cliente, e a lista do anterior abriria a conversa
  errada. Quem monta a aba passa `key` com o contato (o formulário de vincular
  é rascunho). Escrita: `agent`; UPDATE/DELETE com zero linhas MEDE o motivo
  (a linha ainda existe?).
- **Na ficha de /contatos o nome é link para `/inbox?c=`; no inbox, a página
  abre a conversa e liga a faixa "Voltar para"** (`inbox-conversa.md`). O
  "Conversar" (contato sem conversa) só existe no inbox: o diálogo mora lá.

### Possível duplicata (1088)
A mesma pessoa em duas fichas (formulário com um telefone, agendamento com
outro). `cb_possiveis_duplicatas` (RPC), `src/lib/contacts/duplicatas.ts`
(puro, testado), `use-possiveis-duplicatas.ts`, `use-comparacao-de-fichas.ts`,
`aviso-de-possivel-duplicata.tsx` (a faixa + o "Comparar"),
`faixa-de-possivel-duplicata.tsx` e `comparar-fichas-dialog.tsx`. Decisões do
operador, medição e fases: `docs/PLANO-fichas-duplicadas.md`.
- ⚠️⚠️ **Conferida NA HORA, nunca guardada**: a RPC calcula os pares da ficha
  aberta. Nada de gatilho em `contacts` (a ingestão não paga) nem lista que
  envelhece. É `SECURITY INVOKER`: a RLS de `contacts` é a cerca.
- ⚠️⚠️ **Sem varrer a conta** (1089): candidatas por índice atrás de CTE
  `MATERIALIZED`, o telefone vizinho por IGUALDADE (`unnest`, nunca `= ANY
  (lista)`), a janela calculada na ficha (sob RLS, conta com função não
  LEAKPROOF não vira condição de índice). A 1088, com o nome numa junção,
  levava 289 ms em produção a cada conversa aberta (a 1089, 16 ms).
- ⚠️⚠️ **Ficha de LOTE não busca par pelo horário** (1090): 2/3 da base
  nasceram numa importação (3,9 mil fichas em 3 min), e a 1089 trazia o lote
  inteiro para concluir "lote" (177 ms por ficha; a 1090, 9 ms). A ficha conta as fichas em
  volta DELA (±1 min, parando na 11ª): toda janela de par a contém, então
  mais de 10 ali reprova qualquer par. Quem mexer na régua do lote mexe nas
  duas contagens juntas.
- ⚠️⚠️ **Só sinais fortes, com os números da medição** (pino
  `possiveis-duplicatas-1088.test.ts`): mesmo e-mail (em até 3 fichas);
  telefone a um dígito + mesmo primeiro nome; criadas em até 2 min + mesmo
  primeiro nome, FORA de lote (> 10 fichas em volta = importação, 12,5 mil
  pares falsos). Nome SOZINHO nunca — 385 nomes repetidos na base.
- **Todos veem, só admin decide** (D1): `canDecideDuplicates`/
  `useCan('decide-duplicates')` na tela, policy de INSERT/DELETE de
  `cb_duplicatas_descartadas` no banco, e o poder no editor de perfis
  (`PODERES`). "Pessoas diferentes, mas ligadas" grava o vínculo da 1069; o
  par ligado ou descartado sai do aviso. ⚠️ Limite: o vínculo é de `agent`
  (1069, "quem edita contato vincula") — o atendente que liga as fichas pela
  aba Relacionados também tira o par do aviso. Só o botão é de admin.
- **Faixa e aba Relacionados conversam por `EVENTO_RELACIONADOS`**
  (`aviso-de-relacionados.ts`): quem grava vínculo avisa, os dois hooks
  relêem. Sem isso, o "Ligar as fichas" dizia "ligadas em Relacionados" com
  a aba vazia, e desvincular não devolvia o aviso.
- **As escritas recebem as DUAS fichas** (o "Desfazer" do toast pode chegar
  com o operador noutra conversa). O par descartado é ORDENADO em
  minúsculas (`parOrdenado`): o uuid do banco ordena pelo hexadecimal.
- **A faixa mora no fio** (bloco de faixas, depois do no-show) **e no
  formulário do card aberto pelo QUADRO** (`origemFunil`): o card sem conversa
  abre o formulário. No painel do inbox o formulário não a mostra (o fio já
  mostra). Os dois montam só `AvisoDePossivelDuplicata`, que REMONTA a cada
  ficha (`key` por dentro): carimbar o "Comparar" aberto com o contato não
  bastava — trocar de conversa com ele aberto e voltar o reabria sozinho. O
  "Comparar" respeita o PERFIL: card de funil e conversa de conexão fora do
  escopo não aparecem; a falha de envio segue `envioQueNaoSaiu` (o incerto
  pode ter chegado; `failed` sem `nao_saiu` é "não entregue").
- **Sinal 4 (1092): contato de uma ficha unida**, nos dois sentidos (o
  telefone/e-mail desta é contato antigo de outra, ou o contrário), SEM o
  nome: o valor já foi da pessoa.

### Unir fichas (1092/1093)
A fase 2 (decisões D6–D11 e desenho: `docs/PLANO-fichas-duplicadas.md`).
`cb_previa_da_uniao`/`cb_unir_fichas` (a receita vigente é a da 1093),
`src/lib/contacts/uniao.ts` (puro), `use-uniao-de-fichas.ts`,
`revisao-da-uniao.tsx` (no "Comparar"), `contatos-antigos.ts`.
- ⚠️⚠️ **A receita de fusão MORA na função** (uma transação, SECURITY
  DEFINER, admin sem suspensão). No fim ela percorre pelo CATÁLOGO toda FK
  para `contacts` e para a conversa que sai, e RECUSA (`uniao_sem_tratamento`)
  se sobrar linha numa tabela que não conhece: tabela nova com `contact_id`
  (ou FK para `conversations`) entra na função no MESMO PR, senão toda união
  passa a falhar — nunca a apagar calada.
- ⚠️⚠️ **Sem prévia, sem botão**: a tela só une depois de ler o que a união
  vai fazer (`lerPrevia`; bloqueio que o app não conhece BLOQUEIA). Sem
  desfazer: o livro `cb_fichas_unidas` guarda a foto, e a trilha
  (`contacts_merged`, escrita pelo gatilho do livro) diz no fio e no
  Histórico quem saiu e o que ficou de fora.
- ⚠️ **Depois de unir, a página RECARREGA na conversa que ficou**
  (`recarregarNaFichaQueFicou`): a ficha aberta pode ter sido a que saiu, e as
  mensagens que mudaram de conversa chegam por UPDATE (o fio só ouve INSERT).
- ⚠️⚠️ **Contato antigo só nos CADASTROS e só o TELEFONE (D9')**:
  `fichaPorContatoAntigo` roda DEPOIS da busca normal não achar, com o MESMO
  primeiro nome, na API v1 (`findOrCreateContact`), no Calendly, no webhook
  de entrada (`resolverDestinatario({ contatoAntigo: true })`) e na ficha do
  Asaas. O e-mail antigo NÃO casa (nenhum cadastro procura pelo e-mail
  atual): só acende o sinal 4. NUNCA na ingestão, no envio, na ligação nem no
  `send_to_number`: a mensagem do número antigo abre ficha própria, e o sinal
  4 a mostra. Erro da busca é falha (500; `sem_contato` no Calendly, que
  reprocessa), nunca "criar" — seria a duplicata desfeita de volta. A busca
  `?search=` da API acha pelo telefone antigo (D11, `api-v1.md`).
- ⚠️⚠️ **As execuções SEGUEM O CARD (D8', 1093)**: `cb_execucoes_da_uniao`
  decide na prévia e na união — card que fica, continua (o contexto ganha a
  conversa nova; a retomada recusa a que não existe); card que a D7 apaga,
  `fusao`; sem card, a da ficha que sai termina. Limite: a execução rodando
  NO INSTANTE (espera `running`, primeiros passos) cai na regra da ficha.
- ⚠️ **Identidade e janela pelas fichas COMO ESTAVAM**: o BSUID da que sai só
  passa quando uma das duas não tem telefone (com os dois, o webhook da Meta
  casaria o número antigo na conversa unida pelo BSUID e a resposta sairia
  para o outro número); a janela da Meta é a do número para o qual a conversa
  ENVIA; a espera não ressuscita fala de conversa encerrada.
- **D10**: "Data e Hora Reunião" (`data_e_hora_reuniao`) nas duas fica a MAIS
  NOVA (`cb_instante_do_valor`: ISO com fuso; valor torto vira nulo e fica o
  da que fica). Travas: conversas ANTES das fichas.
- **Id antigo na API v1**: `idAtualDaFicha` (`api-v1.md`).
- **Instagram fica de fora** (bloqueio): a conversa mista é a Fase 5 de
  `docs/PLANO-instagram-direct.md`.

### API v1 de contatos
- `getContactById` ESTOURA em erro de banco: erro não é 404 (o integrador
  recriaria a ficha).
- Item de `tags` que não é string é 400, nunca descartado (o substitutivo
  apagaria tudo com 200); `tags: null` = não mexer.
- `tags_mode: "add"` é opt-in, o padrão continua `replace` (contrato publicado);
  valor desconhecido é 400, nunca queda para `replace`. Etiqueta por nome OU id,
  validada ANTES de qualquer escrita. Detalhes em `api-v1.md`.
