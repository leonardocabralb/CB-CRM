# Plano — Filtros salvos no inbox + campos personalizados que salvam sozinhos

> **O que é este arquivo.** Guia retomável dos dois ajustes pedidos pelo
> operador em 2026-08-31. **Ele é editado a cada fase**: ao INICIAR uma fase,
> registra-se aqui que a anterior foi concluída — objetivo, arquivos tocados e
> resultado medido — para que qualquer agente possa pegar o plano e saber o que
> foi feito, o que mudou e onde tudo parou.
>
> ⚠️ **Este documento envelhece.** Antes de decidir com base em algo aqui,
> confirme contra a realidade (grep, leitura do arquivo, query no banco). Ao
> achar divergência, corrija este arquivo no mesmo PR.

- **Criado:** 2026-08-31 · **Medido contra:** `main` @ `36ba542`, produção `hxnhakmyxyhalbsktzwe`
- **Fluxo por fase:** executar → `typecheck`/`lint`/`test`/`i18n-parity` →
  **testar no preview em resolução de monitor de verdade (1440×900+)** →
  revisar 2× → PR → **revisar ESTE plano antes da fase seguinte**.

---

## Estado

| Fase | Escopo | Estado | Migration | PR |
| --- | --- | --- | --- | --- |
| **A1** | Banco dos filtros salvos + módulo puro (parse defensivo, resumo, ids órfãos) | ⬜ a fazer | `967` (a confirmar) | — |
| **A2** | Menu no botão "Filtros": aplicar · salvar o atual · renomear · apagar | ⬜ a fazer | nenhuma | — |
| **A3** | Filtro **padrão** por pessoa + a faixa que explica o inbox recortado | ⬜ a fazer | `968` (a confirmar) | — |
| **B1** | Campos personalizados salvam ao sair do campo (painel do inbox + ficha `/contatos`) | ⬜ a fazer | nenhuma | — |

**Decisões travadas com o operador (2026-08-31):**

1. Filtros salvos são **da equipe**: `admin`+ cria/edita/apaga, qualquer membro
   aplica. (No print do Kommo os recortes são do escritório — "SDR",
   "Jurídico", "Bancario" —, não de uma pessoa.)
2. O **filtro padrão é escolha de cada um**, mesmo sendo o filtro compartilhado.
   O "SDR" pode ser o padrão do Fulano e não ser o de mais ninguém.
3. Os filtros salvos aparecem num **menu no próprio botão "Filtros"**, não em
   coluna nova nem em faixa fixa: a coluna do inbox tem 320px e já está cheia.
4. Item B é **só os campos personalizados** — ver "O que já funciona" abaixo.

**Cortes deliberados (anti-overengineering):** filtro pessoal além do
compartilhado (duas naturezas na mesma tabela por uma conta de um membro) ·
salvar o **texto da busca** dentro do filtro (busca responde "onde está aquela
conversa", filtro responde "quais conversas se parecem com X" — a separação está
escrita em `conversation-list.tsx` e não se inverte agora) · arrastar para
reordenar (ordem alfabética resolve com meia dúzia de filtros) · filtro salvo em
outras telas (funis, tarefas, agendadas) · compartilhar filtro por link · **persistir o filtro aplicado à mão**: só o
padrão sobrevive ao reload, e um filtro escolhido no menu se perde igual aos
filtros de hoje (o pedido é "aciono sob demanda", não "fica grudado").

---

## ⚠️ O que JÁ funciona hoje (medido no código e na tela, 2026-08-31)

Antes de planejar o item B, foi medido o que o painel direito já faz. **Duas das
três coisas pedidas já salvam sozinhas** — o botão "Salvar campos" governa
apenas a seção de baixo, e é a vizinhança dele que faz parecer que governa tudo:

| Coisa | Onde | Salva sozinho? |
| --- | --- | --- |
| **Etapa do negócio** | `SeletorFunilEtapa` → `moverPara` → `atualizarNegocio` | ✅ no clique, com `UPDATE` único (funil+etapa juntos, regra da trilha 912) |
| **Valor do negócio** | `ValorInput` → `aoConfirmar` → `atualizarNegocio` | ✅ ao sair do campo, e **só quando mudou** |
| **Data prevista** (na expansão) | `onBlur` → `atualizarNegocio` | ✅ ao sair do campo |
| **Etiquetas** | `toggleTag` → rota `/api/contacts/[id]/tags` | ✅ no clique |
| **Campos personalizados** | `salvarCampos(gerais)` / `salvarCampos(tracking)` | ❌ **exige o botão** — é o item B |

O mesmo botão existe na aba "Campos personalizados" da ficha de `/contatos`
(`contact-detail-view.tsx`, `saveCustomFields`). A aba **Negócios** daquela ficha
é só leitura, e o `DealForm` (o Sheet com "Salvar alterações") é um formulário
inteiro — **fica fora**, por decisão: ali o Salvar é o gesto que o operador
espera.

---

# Parte A — Filtros salvos na caixa de entrada

## Como é hoje

- O recorte é **puro e mora fora da tela**: `src/lib/inbox/filtros.ts`
  (`FiltrosDoInbox`, `FILTROS_VAZIOS`, `aplicarFiltros`, testado).
- O **estado** vive em `conversation-list.tsx` (`useState`), nasce em
  `FILTROS_VAZIOS` e **morre no reload**. Não há persistência de nenhum tipo.
- O painel é `inbox-filters.tsx`: botão "Filtros" com distintivo de contagem,
  pastilhas removíveis do que está ativo, e os campos Situação · Canal ·
  Responsável · Etapa · Empresa · Etiquetas (cada um com gate de "só aparece se
  decide algo").
- Já existe uma **porta de entrada semeada**: `?etapa=` do quadro de funis, com
  um ciclo de vida próprio (`seedDeEtapaRef`) que descarta a semente quando a
  jornada acaba ou a etapa some. **É o molde do filtro padrão** — mesmo
  problema, resolvido uma vez.

## O que muda

Um filtro salvo é **um nome + um `FiltrosDoInbox`**. Aplicar é `setFiltros(...)`
com o valor guardado; não há caminho novo de recorte, nada muda em
`aplicarFiltros`, e o "Limpar tudo" continua sendo a saída.

### Fase A1 — Banco + módulo puro

**Migration `967_cb_filtros_salvos.sql`** (⚠️ confirmar o número com
`ls supabase/migrations/` **e** `list_migrations` imediatamente antes de criar o
arquivo — branches em paralelo mudam isso; e o histórico do Supabase não é
fonte de verdade completa):

> ⚠️ **Este plano reservava `966`/`967`, e os dois foram corrigidos para
> `967`/`968` em 2026-08-31.** A `966_cb_grupos_de_campos` (blocos de campos
> personalizados) nasceu numa branch paralela e **já está aplicada em
> produção**. Foi a terceira colisão de número da semana — a 906, a 963 e a
> própria 966, que nasceu `965` e colidiu com a `965_cb_transferencia_limpa_perfil`.
> Reforçando o que a linha acima diz: conferir na hora, não deduzir da lista.
>
> ⚠️ **A Fase B1 encosta em código que a 966 acabou de reescrever.** "Campos
> personalizados salvam ao sair do campo" muda exatamente o botão
> `Salvar campos` do painel da conversa e da ficha — que hoje salva TODOS os
> campos, inclusive os dos blocos que não estão à vista no menu horizontal.
> Quem for fazer a B1 lê antes a seção "Blocos de campos personalizados (966)"
> do CLAUDE.md: salvar por campo isolado é compatível, mas trocar o botão por
> um save-do-bloco-visível reintroduz a perda silenciosa de digitação.

```sql
CREATE TABLE cb_inbox_saved_filters (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  nome        text NOT NULL CHECK (btrim(nome) <> '' AND length(nome) <= 60),
  filtros     jsonb NOT NULL,
  criado_por  uuid REFERENCES auth.users(id) ON DELETE SET NULL,  -- ver nota
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()   -- escrito por quem edita; sem trigger
);
CREATE UNIQUE INDEX ... ON cb_inbox_saved_filters (account_id, lower(btrim(nome)));
```

- **`criado_por` é `SET NULL`, não `CASCADE`** — ao contrário de
  `cb_conversation_favorites` (924). O favorito é marcador pessoal e não quer
  dizer nada depois que a pessoa sai; o filtro "Jurídico" é **recorte do
  escritório** e tem de sobreviver a quem o criou. Mesma lógica da anotação (918).
- **Único por nome (aparado, minúsculas)**: dois "SDR" no menu não se
  distinguem, e o operador aplicaria o errado sem nunca saber. ⚠️ O `23505`
  tem de virar pergunta na tela ("já existe um filtro 'SDR' — substituir?"), e
  não um erro cru: salvar por cima do homônimo é quase sempre a intenção.
- **RLS:** `SELECT` para qualquer membro (`is_account_member(account_id)`);
  `INSERT`/`UPDATE`/`DELETE` com `is_account_member(account_id, 'admin')` — a
  mesma forma da `964`. `REVOKE ALL … FROM anon` + `GRANT` de volta ao
  `authenticated` (convenção do CLAUDE.md: todo privilégio conferido tem de ser
  concedido por escrito, senão a migration reprova em banco vazio).
- **Bloco de conferência** ao final, no formato da 924: RLS ligada, 4 policies,
  `anon` sem `SELECT`, `authenticated` com os quatro privilégios. **Conferir o
  resultado, nunca a intenção.**

**Módulo puro `src/lib/inbox/filtros-salvos.ts`** (com teste, no molde de
`filtros.ts`):

| Função | Por que existe |
| --- | --- |
| `lerFiltroSalvo(json): FiltrosDoInbox` | ⚠️ **Parse, nunca cast.** Parte de `FILTROS_VAZIOS` e só aceita chave conhecida com o tipo certo. Sem isso, uma linha gravada antes de um campo novo existir — ou `favoritas: "sim"` de uma edição à mão — entra em `aplicarFiltros` como `undefined`/string e o recorte passa a responder qualquer coisa, sem erro. `FiltrosDoInbox` **vai** ganhar campos; a leitura tem de sobreviver a isso. |
| `escreverFiltroSalvo(f)` | O caminho inverso, explícito, para nada de fora do tipo entrar no JSONB. |
| `mesmoFiltro(a, b)` | Marcar no menu qual filtro está aplicado. Comparação por conteúdo (etiquetas ordenadas), não por identidade. |
| `idsPendurados(f, catalogos)` | Quais ids do filtro **não existem mais** (etapa/canal/etiqueta/responsável apagados). Ver a armadilha abaixo. |
| — (ver ao lado) | A linha de descrição embaixo do nome no menu ("Bancário · Reunião marcada") **não ganha função nova**: `inbox-filters.tsx` já monta exatamente essa lista para as pastilhas do filtro ativo, com `t()` e cor de etiqueta. Extrair aquele construtor e chamá-lo nos dois lugares. Uma segunda descrição divergiria do que as pastilhas dizem — e as duas ficam na mesma tela. ⚠️ Id órfão vira `(apagado)`, nunca o UUID cru, que o operador leria como se fosse o nome (regra de `descrever-passo.ts`). |

#### ⚠️ Armadilhas que mordem código novo (Parte A)

- ⚠️⚠️ **Filtro salvo apontando para id apagado devolve ZERO com cara de
  resposta certa.** Etapa removida, canal desconectado, etiqueta apagada — o
  recorte simplesmente não casa com nada, sem erro em lugar nenhum. É a mesma
  família de "o filtro cujo dado não carregou responde errado" que
  `recorteDeEtapaConfiavel` já resolve para a etapa. **Regra:** ao aplicar, se o
  catálogo correspondente **já carregou** e o id não está nele, a peça é
  descartada e o operador é avisado — nunca aplicada em silêncio. Enquanto o
  catálogo não chegou, não se descarta nada (descartar por dado ausente é o erro
  simétrico, e o pior dos dois).
- ⚠️ **`recorteDeEtapaConfiavel` já cobre a etapa, e é preciso não duplicar a
  cerca.** Um filtro salvo com etapa entra num inbox onde a consulta de `deals`
  ainda não voltou; o recorte de etapa é **neutralizado lá dentro** e o spinner
  de `aguardandoEtapas` segura a tela. Não inventar uma segunda guarda aqui.
- ⚠️ **Escopo de perfil (Fase 3 dos perfis) recorta o filtro compartilhado.** Um
  filtro salvo com `canalId` de uma conexão que o membro não enxerga devolve
  zero conversas para ele — e nada na tela explica. **Regra:** o menu **esconde**
  o filtro cujo canal está fora do escopo de quem olha (`canalNoEscopo`), como
  todo seletor do projeto esconde o campo que não decide nada.
- ⚠️ **`favoritas: true` num filtro da EQUIPE significa coisas diferentes por
  pessoa** — `cb_conversation_favorites` é por membro (924). Não é bug; é o
  comportamento certo. Mas o resumo no menu tem de dizer "minhas favoritas", e
  não "favoritas", senão um filtro compartilhado parece quebrado para quem não
  marcou nada.
- ⚠️ **Conversa de grupo tem `conversations.channel_id` NULO — sempre.** Nada
  novo aqui, mas vale repetir: quem for tocar em recorte por canal usa
  `canalDaConversa()`. O filtro salvo só transporta o id; a comparação continua
  onde já está.
- **RLS que barra escrita devolve "0 linhas", não erro.** Um `agent` tentando
  editar um filtro leva 0 linhas com `error: null`. Toda escrita do hook usa
  `.select('id')` e confere o rowcount — o molde de `atualizarNegocio` e
  `deleteNote`.

### Fase A2 — O menu no botão "Filtros"

**Hook `src/hooks/use-filtros-salvos.ts`** — busca (uma vez por montagem, como
`useChannels`) + `criar`/`renomear`/`apagar` sob RLS, com rowcount conferido.
Escrita direta do navegador, sem rota: não há efeito colateral nenhum (é o
mesmo regime das favoritas e das etiquetas; rota de servidor só se justifica
quando há efeito, como a notificação de menção).

**`inbox-filters.tsx`** ganha um `DropdownMenu` ao lado do botão "Filtros":

```
┌ Filtros salvos ────────────────┐
│ ★ SDR                          │   ← ★ = o meu padrão (Fase A3)
│   Bancário · Reunião marcada   │
│ ✓ Jurídico                     │   ← ✓ = é o que está aplicado agora
│   Trabalhista · Sem responsável│
│ ────────────────────────────── │
│ 💾 Salvar filtro atual…        │   ← só admin
│ ⚙️  Gerenciar filtros           │   ← só admin
└────────────────────────────────┘
```

- **"Salvar filtro atual" fica desabilitado com o filtro vazio** — um filtro
  salvo que não recorta nada é um item de menu que não faz nada.
- **Aplicar um filtro salvo NÃO mexe na busca.** Os dois recortam juntos (E
  lógico) e sempre recortaram; limpar a busca ao aplicar seria o filtro salvo
  atropelando o que o operador digitou.
- **Aplicar substitui o recorte inteiro**, não soma com o que estava — é o que
  "acionar um filtro pré-salvo" quer dizer. As pastilhas mostram o resultado,
  como já mostram hoje, e cada uma continua removível sozinha.
- **i18n:** chaves novas em `Inbox.conversationList`, **nos DOIS dicionários na
  mesma passada** (`en.json` é referência, `pt-BR.json` é o que o app serve; o
  fallback do next-intl é por ARQUIVO, então chave faltando vira
  `MISSING_MESSAGE` cru na tela). Rodar `node scripts/i18n-parity.mjs`.

### Fase A3 — O filtro padrão

**Migration `968_cb_filtro_padrao.sql`** — tabela minúscula, porque o padrão é
**por pessoa** e o filtro é **da conta**: uma coluna `padrao boolean` na tabela
de filtros seria uma marca compartilhada, e o padrão de um apagaria o do outro
sem nada na tela explicando (é literalmente o motivo pelo qual a 924 virou
tabela em vez de coluna em `conversations`).

```sql
CREATE TABLE cb_inbox_filtro_padrao (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id)  ON DELETE CASCADE,
  filtro_id  uuid NOT NULL REFERENCES cb_inbox_saved_filters(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, account_id)
);
```

- **`CASCADE` no `filtro_id`**: apagar o filtro tem de apagar o padrão de quem o
  escolheu. `RESTRICT` faria o admin não conseguir apagar um filtro que alguém
  usa; `SET NULL` deixaria uma linha apontando para nada.
- **RLS: as três policies com `user_id = auth.uid()`**, inclusive a de leitura —
  molde exato da 924. `is_account_member` no `AND`.

**Aplicação, e é aqui que está o risco real:**

- ⚠️⚠️ **O padrão chega DEPOIS do primeiro render.** `FiltrosDoInbox` nasce no
  `useState` inicial da lista, e o padrão vem de uma consulta. Sem cuidado, o
  inbox pinta a lista inteira, depois pula para 8 conversas — e o operador vê a
  lista "sumir". É o "efeito passivo mostra o estado velho" do CLAUDE.md, que já
  mordeu duas vezes em 2026-08-30. **Regra:** enquanto a consulta do padrão não
  resolve, a lista mostra o mesmo estado de carregamento que já usa; a semente é
  aplicada **uma vez**, num ref (`semeouPadraoRef`), e nunca reaplicada — senão o
  filtro que o operador limpou volta sozinho no próximo resync.
- ⚠️ **`?etapa=` do funil VENCE o padrão.** Chegar pelo botão da coluna do funil
  é gesto explícito, com a faixa "Voltar ao funil" na tela explicando o recorte.
  Somar o padrão por cima mostraria menos conversas do que a coluna prometeu, e
  a faixa estaria mentindo. **Com `etapaInicial` presente, o padrão não é
  aplicado** — e isso precisa de teste, porque as duas sementes moram no mesmo
  lugar.
- ⚠️ **O inbox recortado por padrão não pode parecer um inbox vazio.** Hoje o
  distintivo de contagem e as pastilhas explicam um recorte que o operador
  acabou de fazer. Um recorte que ele **não** fez naquela sessão precisa de mais:
  uma linha discreta acima da lista — "Filtro padrão: SDR · **mostrar tudo**" —
  onde "mostrar tudo" é o `FILTROS_VAZIOS` de sempre. Sem ela, "eu preciso
  remover manualmente" (que é o que o operador pediu) vira "sumiram as
  conversas".
- **Trocar o padrão é um item no menu do próprio filtro** ("Definir como meu
  padrão" / "Deixar de ser meu padrão"), disponível a **qualquer membro** — o
  filtro é da equipe, mas a escolha é de cada um.

---

# Parte B — Campos personalizados salvam ao sair do campo

## Como é hoje

- Os inputs são o `CampoPersonalizadoInput` (compartilhado entre o painel do
  inbox e a ficha de `/contatos`), tipado por `field_type`
  (texto · número · lista · data).
- O `onChange` alimenta um `customValues: Record<fieldId, string>` na tela.
- O botão chama `salvarCampos(secao)` → `salvarValoresDoContato(supabase,
  contactId, subconjunto)` — upsert dos preenchidos, DELETE dos esvaziados.
- Há **dois** botões no painel (seção "Campos" da aba Principal e aba
  "Traqueamento") e **um** na ficha de `/contatos`.

## O que muda

O botão sai; cada campo salva sozinho. **Uma peça nova, usada nos três lugares**:
`CampoComSalvamento` — embrulha o `CampoPersonalizadoInput`, guarda o rascunho
daquele campo e decide quando gravar.

| Tipo do campo | Gesto que grava | Por quê |
| --- | --- | --- |
| texto, número | sair do campo (`blur`) + `Enter` | Gravar por tecla escreveria uma linha por letra digitada |
| data (`datetime-local`) | sair do campo | O input dispara `change` a cada pedaço digitado, com valores intermediários inválidos ("0002-01-01") |
| lista (`select`) | escolher | Não há blur útil: o popover fecha e o gesto já terminou. É a mesma regra do seletor de etapa |

E um módulo puro pequeno, `src/lib/contacts/salvamento-de-campo.ts` (com teste),
com as duas perguntas que **não** podem divergir entre as três telas:
`gravaNoBlur(fieldType)` e `valorMudou(salvo, novo)`.

#### ⚠️ Armadilhas que mordem código novo (Parte B)

- ⚠️⚠️ **Salvar o campo, nunca o mapa.** Hoje o botão manda a seção inteira. Um
  auto-save que repetisse isso mandaria todos os campos a cada blur — e em
  `salvarValoresDoContato` **`""` significa DELETE**. Basta um campo ainda não
  carregado no mapa para o blur de outro apagar dado real. O gate
  `dadosProntos` (que existe justamente por isso) **continua**, e o payload passa
  a ser `{ [fieldId]: valor }`, uma linha só.
- ⚠️⚠️ **Trocar de conversa dispara o blur — e o contato já mudou.** Clicar na
  próxima conversa: o `blur` do input roda antes do clique se resolver, mas o
  `await` do save termina quando o painel já está mostrando outro cliente. **O
  `contact.id` tem de ser capturado no instante do blur**, nunca lido de um ref
  depois. É a mesma janela que o painel já documenta ("salvar nessa janela
  gravava dado do contato A no contato B"), agora alcançável sem clicar em botão
  nenhum. **Pino de teste obrigatório.**
- ⚠️ **Fechar o painel com texto digitado e sem blur perde o valor em
  silêncio.** Desmontar um componente React **não** dispara `blur`: digitar e
  clicar no ✕ do painel (ou trocar de aba) escreveria nada, sem aviso — e com o
  botão removido não há segunda chance. **Regra:** o wrapper descarrega o
  rascunho sujo na limpeza de desmonte, com o `contactId` capturado. (Molde:
  `entreguesRef` do compositor, 932.)
- ⚠️ **Não gravar o que não mudou.** Entrar e sair de um campo não pode escrever
  no banco. E a comparação é contra o valor **aparado**, porque
  `salvarValoresDoContato` grava `v.trim()`: `" a "` e `"a"` são o mesmo valor
  guardado, e sem isso o campo salvaria de novo a cada visita. Mesma regra que
  `ValorInput.aoConfirmar` já aplica ao valor do negócio.
- ⚠️ **O aviso de erro tem de dizer QUAL campo e QUAL cliente.** Com o botão, o
  erro chegava com o operador ainda olhando a tela. Com auto-save, ele já está
  em outra conversa quando o toast aparece — "não foi possível salvar" sem
  contexto é indistinguível de ruído. Toast com nome do campo + nome do contato.
- **Sucesso é discreto, erro é alto.** Um toast verde por campo é ruído (são 5+
  campos por cliente). O certo é um indicador na própria linha do campo
  (girando → ✓ que desaparece), e o toast fica só para a falha. Some com o
  `fieldsSaved` do dicionário; entra `fieldSaveError`.
- **`viewer` continua barrado** pelo `disabled` que já existe (`podeEditar`) —
  nada muda aqui, mas o wrapper não pode reintroduzir um caminho de escrita que
  ignore a prop.
- **A ficha de `/contatos` entra na mesma passada.** As duas telas editam o
  MESMO dado com o MESMO input; deixar uma com botão e outra sem é o tipo de
  divergência que vira bug no primeiro tipo de campo novo.

---

## Verificações antes de cada PR

- [ ] Branch saiu de `main` atualizado (`git pull origin main`).
- [ ] Migration na faixa `900+` com prefixo `cb_`, número conferido em
      `ls supabase/migrations/` **e** `list_migrations` (os dois já divergiram).
- [ ] A migration aplica em banco **VAZIO**: todo `REVOKE` com `GRANT` de volta,
      nenhuma conferência exigindo dado que só existe aqui. Conferir com
      `supabase db start`, que é o que o CI faz.
- [ ] `npm run typecheck && npm run lint && npm run test`.
- [ ] `node scripts/i18n-parity.mjs` — chave nova nos **dois** dicionários.
- [ ] Testado no preview em **1440×900+**, não no tamanho nativo do painel.
- [ ] Revisão 2× (bugs/edge cases; consistência com as convenções e com o
      objetivo original), com os achados reportados mesmo que seja "nada".
