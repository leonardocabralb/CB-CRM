# Plano — marca configurável (Configurações → Marca)

Plano vivo: cada fase registra objetivo, arquivos, resultado MEDIDO e o que
ficou. Decisões do operador em 19/10/2026.

## Objetivo

O CRM vai ser vendido. Quem comprar troca o NOME e o LOGO pela tela
(Configurações → Marca), sem mexer em código nem gerar outra imagem. O padrão
do produto é o **Atlas CRM**. Vale para PC e celular.

## Decisões do operador (19/10/2026)

- D1. Só o ADMIN da conta mais ANTIGA da instalação troca a marca. A
  instalação tem várias contas (o cadastro dá a todo login novo uma conta
  avulsa em que ele é admin); "qualquer admin" deixaria essas pessoas
  trocarem o logo de todos.
- D2. A nossa produção passa a ser Atlas CRM (o padrão; nada a gravar).
- D3. O padrão Atlas entra já, com o repositório ainda público.
- D4. "Atlas" como nome da integração com o Atlas Gestor vira "Atlas Gestor"
  em todo texto de tela — PR próprio (fase 4).
- D5. A aba mostra os EXEMPLOS (as peças do Atlas CRM, para baixar), para
  quem troca saber formato, proporção e fundo de cada peça.

## Estado

| Fase | O quê | Estado |
|---|---|---|
| 1 | Banco (1094), rota, aba Marca com exemplos | feito (#420) |
| 2 | A marca em todo lugar (PC e celular) | feito (#420) |
| 3 | Padrão Atlas, fim dos build-args, docs | feito (#420) |
| 4 | "Atlas" → "Atlas Gestor" nos textos (PR próprio) | feito (#421), mesclar depois do #420 |
| 5 | Aplicar a 1094 (com "pode gravar"), deploy, conferir | 1094 aplicada e e2e feito (20/10); falta merge e conferir no ar |

## As peças e onde aparecem

| Peça | Formato | PC | Celular |
|---|---|---|---|
| Nome | 1–60 caracteres | título da aba, barra lateral (sem logo), textos | o mesmo |
| Nome curto | até 20 | — | embaixo do ícone do app instalado |
| Símbolo | PNG quadrado, 512 px recomendado, fundo transparente | aba do navegador, notificação, app instalado no Chrome/Edge | ícone da tela de início (sobre a cor de fundo), notificação do Android |
| Horizontal p/ fundo escuro | PNG, WebP ou SVG; texto claro | barra lateral no modo escuro | menu lateral no modo escuro |
| Horizontal p/ fundo claro | idem; texto escuro | barra lateral no modo claro | menu lateral no modo claro |
| Vertical p/ fundo escuro (opcional) | idem | login, convite, senha (modo escuro) | o mesmo, menor |
| Vertical p/ fundo claro (opcional) | idem | login etc. (modo claro) | o mesmo, menor |
| Cor de fundo do ícone | `#rrggbb` | — | fundo do ícone da tela de início |

O cabeçalho do celular continua sem logo (menu + título da tela).

**Faltas, na marca PRÓPRIA:** sem horizontal para o fundo → símbolo + nome
em texto; sem vertical → a horizontal do mesmo fundo → símbolo + nome. Uma
marca própria NUNCA herda imagem do Atlas (`resolverMarca`). Nome e símbolo
são obrigatórios para gravar a marca própria.

## Contrato técnico (o que as frentes compartilham)

Base, escrita antes das frentes — não reescrever, só estender:

- `src/lib/marca.ts` (puro): `NOME_PADRAO`, `NOME_CURTO_PADRAO`,
  `COR_DO_ICONE_PADRAO`, `TAMANHOS_DO_ICONE`, `PECAS_DA_MARCA`,
  `COLUNA_DA_PECA`, `ARQUIVOS_PADRAO`, `BUCKET_DA_MARCA`,
  `TETO_DE_BYTES_DA_MARCA`, `TIPOS_DA_PECA`, `LIMITE_DO_NOME(_CURTO)`,
  tipos `Marca`/`LinhaDaMarca`, `marcaPadrao()`, `resolverMarca()`,
  `logoPara()`, `corValida()`.
- `src/lib/marca-servidor.ts`: `obterMarca()` (cache com etiqueta
  `TAG_DA_MARCA`; nunca lança), `lerLinhaDaMarca()`, `urlPublicaDaMarca()`,
  `contaDaInstalacao()`, `COLUNAS_DA_MARCA`.
- `src/components/marca/marca-provider.tsx`: `MarcaProvider`, `useMarca()`.
- `src/components/marca/logo-da-marca.tsx`: `LogoDaMarca` (forma
  horizontal/vertical; `fundo` força um lado; `marca` desenha um rascunho),
  `SimboloDaMarca`.
- `globals.css`: `.marca-so-no-escuro` / `.marca-so-no-claro` (as duas
  versões vão no HTML; o CSS esconde a do outro modo — `dark:` está inerte).
- `public/marca/atlas-*.png`: as cinco peças do Atlas (padrão e exemplos).

### Banco — `1094_cb_marca.sql`

`cb_marca`: UMA linha por instalação (`id boolean PRIMARY KEY DEFAULT true
CHECK (id)`), colunas `nome`, `nome_curto`, `cor_do_icone`, `simbolo_path`,
`horizontal_escuro_path`, `horizontal_claro_path`, `vertical_escuro_path`,
`vertical_claro_path`, `atualizado_em`, `atualizado_por`. RLS ligada, ZERO
policy, `REVOKE ALL` de anon e authenticated, `GRANT` a service_role. Bucket
público `marca` (1 MB; PNG, WebP, SVG), sem policy de escrita (só a rota, com
service role). ADITIVA: aplicar ANTES do deploy.

### Rota — `/api/cb/marca`

- `GET` (qualquer membro): `{ marca, linha, podeEditar, motivo? }`.
- `POST` multipart (admin da conta da instalação): `nome`, `nome_curto`,
  `cor_do_icone`, arquivos `simbolo`, `horizontal_escuro`, `horizontal_claro`,
  `vertical_escuro`, `vertical_claro`, e `remover` (repetível, nome da peça).
  Valida tipo, tamanho, PNG pela assinatura, SVG sem script. Sobe com nome
  ÚNICO por gravação, grava a linha, apaga os arquivos substituídos (melhor
  esforço), `revalidateTag(TAG_DA_MARCA, { expire: 0 })`.
- `DELETE` (idem): volta ao padrão — apaga a linha e os arquivos.

### Leitura

O layout raiz chama `obterMarca()` (com `connection()`: a marca nunca é
assada no build) e entrega ao `MarcaProvider`. `icon.tsx`, `apple-icon.tsx`
e `manifest.ts` passam a dinâmicos e leem `obterMarca()`.

## Fases

### Fase 1 — banco, rota, aba (feita)
Arquivos: `supabase/migrations/1094_cb_marca.sql`,
`src/app/api/cb/marca/route.ts`, seção `marca` em Configurações
(`settings-sections.ts`, `catalogo.ts`, `poderes.ts`, a página), o painel
`marca-panel.tsx`, chaves `Settings.marca.*` nos dois dicionários.

### Fase 2 — a marca em todo lugar (feita)
Barra lateral (PC e menu do celular), login/cadastro/esqueci/redefinir
senha/convite, ícone da aba, ícone do app instalado, manifesto, título da
aba, textos (`{appName}`), Asaas e Atlas (nome do sistema que vai para eles).

### Fase 3 — padrão Atlas e limpeza (feita)
Sai `NEXT_PUBLIC_APP_NAME`/`_SHORT_NAME`/`_LOGO_URL` (Dockerfile,
`pipeline.yml`, compose, `.env.local.example`). Docs de instalação e de
atualização. Regras (`CLAUDE.md` 8f, `deploy.md`, `celular.md`,
`marca.md`). Exceção de cache para `public/marca/`.

### Fase 4 — "Atlas Gestor" (PR próprio, #421)
Só TEXTO de tela, ajuda e docs entregues. Chaves de dicionário,
identificadores, URLs e nomes de coluna ficam.

### Fase 5 — publicar
Conferir número da migration contra as outras worktrees e o banco; ler as
contas da produção (`select id, name, created_at from accounts order by
created_at, id`) e conferir que a PRIMEIRA é a do escritório e que o
`created_at` dela não empata com o da segunda (a carga da 0017 criou as
contas de então num INSERT só; no empate, quem troca a marca é sorteado
pelo uuid — critério explícito é decisão do operador); aplicar a 1094 com
"pode gravar"; `docs/MIGRATIONS-APLICADAS.md`; merge; conferir na produção
(aba do navegador, barra lateral nos dois modos, login, ícone, manifesto).

## Integração das fases 1–3 (19/10/2026, sem commit)

Medido na worktree, com tudo no índice do Git (sem commit):

- `tsc --noEmit`: 0 erros. `npm run lint`: `✖ 59 problems (0 errors, 59
  warnings)`; dos arquivos do PR, só `signup` e `join/[token]` aparecem, com
  o `window.location.href` que já existia.
- Vitest na Node 22, suíte inteira: 728 arquivos, 11290 testes, todos
  verdes (inclui `instrucoes.test.ts`, que cobra os globs de `marca.md`).
- `i18n-parity` e `i18n-chaves-usadas`: OK. `doc-acompanha origin/main`:
  nenhum contrato de integração mudou.
- `next build`: 231 rotas, todas dinâmicas (ƒ), nenhuma estática;
  `/icon`, `/apple-icon/[id]` e `/manifest.webmanifest` dinâmicos; nenhuma
  leitura da marca no build.
- A 1094 num Postgres 16 descartável (esqueleto mínimo de papéis, `auth` e
  `storage`): três aplicações (vazia, de novo, com linha) passaram; os
  CHECKs, a PK de uma linha, o `permission denied` de anon/authenticated e o
  SET NULL da autoria se comportaram como o esperado. O replay completo
  (`supabase db start`) fica com o CI.

Decisões tomadas na integração (a conferir):

- O POST com corpo que não é multipart responde 400 `corpo_invalido`,
  código que a aba não conhece: cai na frase genérica. A aba nunca manda
  esse corpo (só se o limite de 10 MB do middleware cortar o pedido, e cada
  imagem tem 1 MB).
- A aba conta o nome em unidades UTF-16 (`maxLength` e `.length`); a rota e
  o CHECK, em caracteres. Só a aba fica mais rígida, e só com emoji.

Decisões tomadas na correção da revisão (19/10/2026, a conferir):

- Teto de DIMENSÃO do símbolo: 2048 px no lado maior (`simbolo_grande`,
  `LADO_MAXIMO_DO_SIMBOLO`). Um PNG chapado de 10000×10000 px cabe em 1 MB, e
  o `next/og` decodifica a imagem inteira (~400 MB) a cada ícone gerado; o
  maior ícone tem 512 px, e 2048 dá folga de 4× (~16 MB). Os códigos 400 da
  rota passam a 13.
- SVG: `@import`, `image-set(` e `url(` que não aponta para `#…` são
  recusados, também escritos com escapes do CSS (`\75 rl(`) — antes a
  frase "nada aponta para fora" não valia para o CSS.
- A aba só diz "sem permissão" no 403 com o motivo da rota ou o papel
  insuficiente (`ehRecusaDePermissao`); o 403 de perfil ilegível
  (`requireRole` quando o banco falha) cai na frase genérica.
- Telas de entrada: `min-w-0` no invólucro do logo e `max-w-full` no nome
  em texto (medido no Chromium com um nome de 58 caracteres em 375 px: a
  coluna do cartão ia a 519 px; com os dois, 311 px e reticências).
- Empate na conta mais antiga (`contaDaInstalacao` desempata pelo uuid):
  sem mudança de código — recusar a escrita no empate trancaria a aba
  também na nossa produção, se ela empatar; a leitura e a decisão ficam na
  fase 5. `docs/ATUALIZAR.md` diz a quem atualiza como conferir.

## Fase 5 — o que foi feito (20/10/2026)

- Contas da produção lidas (19/10): 5 contas; a mais antiga é a do
  escritório (21/07, 16 membros), sem empate — a seguinte é de 23/07. As
  outras 4 são avulsas de 1 pessoa.
- Número conferido contra o `main`, as worktrees, as branches remotas e o
  histórico do banco: 1094 livre. CI verde no `a1200685` (replay incluso).
- 1094 aplicada pela Management API com "pode gravar a 1094 na produção" do
  operador; conferida (ver `docs/MIGRATIONS-APLICADAS.md`).
- e2e no preview (dev da branch, banco de produção, app no ar sem ler a
  tabela) com a marca fictícia "Marca Teste": símbolo de 100 px recusado na
  tela com a frase do lado mínimo e o Salvar desligado; com as peças
  válidas, a prévia (login cai na horizontal sem a vertical); salvar →
  barra lateral, título "Marca Teste", `/icon` e `/apple-icon/180` com o
  símbolo enviado sobre a cor escolhida, manifesto com `?v=` novo, login sem
  sessão (127.0.0.1) com a marca; "Voltar ao padrão" com a confirmação →
  Atlas de volta, 0 linhas e 0 arquivos no bucket. A aba a 375 px sem
  rolagem lateral. Ajuste feito no e2e: a frase da prévia dizia "depois de
  salvar" logo após salvar.

Pendências:

- `marca` nasce invisível para perfil já gravado (seção nova do catálogo);
  ficou fora de `SECOES_TRAVADAS_PARA_ADMIN`. Decisão do operador.
- Merge do #420 (publica) e conferir no ar: barra lateral nos dois modos,
  login, ícone da aba e do app, manifesto; o iPhone (apagar e instalar de
  novo).
- O 403 para quem não é admin da conta mais antiga só foi provado nos
  testes da rota (não há outro login no preview).

## Limites conhecidos

- O iPhone guarda nome e ícone NA INSTALAÇÃO: quem já instalou precisa
  apagar o ícone e adicionar de novo.
- O navegador guarda o ícone da aba; pode exigir recarregar.
- O e-mail de recuperação de senha é do painel do Supabase: a aba não chega
  nele.
- As peças do Atlas vieram em PNG pequeno (símbolo com 117 px, ampliado para
  512): trocar pelos originais (SVG ou PNG ≥ 1024 px) quando chegarem —
  basta substituir os arquivos de `public/marca/`.
