---
paths:
  - "src/lib/marca*"
  - "src/components/marca/**"
  - "public/marca/**"
  - "src/app/icon.tsx"
  - "src/app/apple-icon.tsx"
  - "src/app/manifest.ts"
  - "src/app/layout.tsx"
  - "src/app/api/cb/marca/**"
  - "src/components/settings/marca-panel.tsx"
  - "src/components/settings/marca/**"
  - "supabase/migrations/1094_cb_marca.sql"
---

# Marca da instalação — regras

O CRM é vendido: quem compra troca nome e logo em Configurações → Marca, sem
código nem imagem nova. Padrão do produto: **Atlas CRM**. Plano e decisões
(19/10/2026): `docs/PLANO-marca-configuravel.md`. Puro em `src/lib/marca.ts`;
servidor em `src/lib/marca-servidor.ts`; navegador em `src/components/marca/`.
A regra transversal (nunca literal, `{appName}`) está na raiz, seção 8f; o app
instalado, em `.claude/rules/celular.md`.

### A marca é DADO
- ⚠️⚠️ **Uma linha por instalação em `cb_marca` (1094), FECHADA ao
  navegador** (RLS sem policy, `REVOKE` de anon e authenticated): só o
  servidor lê e grava. O login precisa da marca antes de haver sessão, por
  isso ela chega PRONTA do layout raiz (`MarcaProvider` → `useMarca()`).
  Policy de leitura "para facilitar" abre a linha a qualquer login.
- ⚠️ **`obterMarca()` nunca lança e não cacheia FALHA:** a função cacheada
  (`unstable_cache`, etiqueta `TAG_DA_MARCA`) lança no erro, e quem chama cai
  no padrão só daquela vez. Guardar o padrão no cache faria uma marca própria
  se apresentar como Atlas CRM por uma hora por um soluço do banco.
- **Sem linha, ou com nome vazio, vale o padrão** (`resolverMarca`). Nome de
  produto nunca é literal nem `process.env`: os build-args de nome e logo
  acabaram, e a mesma imagem serve a qualquer marca. Na frase de tela, o nome
  entra por `{appName}` com `useMarca().nome` (navegador) ou `obterMarca()`
  (servidor).

### Quem grava
- ⚠️⚠️ **Só o ADMIN da conta mais ANTIGA** (`contaDaInstalacao()`, D1 do
  plano): o cadastro dá a todo login novo uma conta avulsa em que ele é
  admin, e "qualquer admin" deixaria essa gente trocar o logo de todos.
  Falha ao ler a conta = 500, nunca "não é você". Na aba, só o 403 que DIZ
  isso vira "sem permissão" (`ehRecusaDePermissao`): o `requireRole` também
  responde 403 quando a leitura do perfil falha no banco.
- ⚠️ **Empate na "mais antiga" é sorteio:** o desempate é pelo `id` (uuid).
  A carga da 0017 criou as contas dos logins de então num INSERT só, com o
  MESMO `created_at`; instalação daquele tempo pode ter o primeiro lugar
  empatado (como conferir: `docs/ATUALIZAR.md`). Critério no empate é
  decisão do operador (fase 5 do plano).
- Bucket `marca` público e SEM policy em `storage.objects`: só a rota
  (service role) escreve. A URL da peça é DERIVADA do caminho gravado
  (`urlPublicaDaMarca`), nunca aceita do cliente.

### Gravar
- ⚠️⚠️ **Nome de arquivo ÚNICO a cada gravação, na ordem subir → gravar a
  linha → apagar os substituídos (melhor esforço).** O mesmo caminho
  sobrescrito seria servido velho por quem o guardou (navegador, CDN, a
  memória do símbolo em `marca-icone.ts`, que usa o caminho como chave);
  apagar antes de gravar deixaria a linha apontando para o nada se a
  gravação falhasse.
- ⚠️ **`revalidateTag(TAG_DA_MARCA, { expire: 0 })` depois de gravar e de
  voltar ao padrão.** Com `'max'` (o recomendado da doc do Next) a próxima
  página ainda sairia com a marca velha (stale-while-revalidate); a forma de
  um argumento só está deprecada. A tela chama `router.refresh()` para o
  provedor receber a nova.
- **Símbolo só PNG** (`TIPOS_DA_PECA`), conferido pela ASSINATURA, não pelo
  tipo declarado: o `next/og`, que desenha o ícone da aba e do app, não lê
  WebP. Quase quadrado, de 192 px (o ícone do Android sai dele) a 2048 px
  de lado: o `next/og` decodifica a imagem INTEIRA a cada ícone, e o teto de
  bytes não segura um PNG chapado de 10000 px (~400 MB na memória).
  As outras peças aceitam PNG, WebP e SVG; **SVG passa por validação** (nada
  que execute ou aponte para fora — link, `url(` e `@import` do CSS —,
  conferido também com as entidades do XML e os escapes do CSS
  decodificados): servido do bucket público, o arquivo aberto pela URL
  executaria o que trouxesse. Tudo isso é puro, em
  `src/lib/marca-validacao.ts`.
- Teto por imagem `TETO_DE_BYTES_DA_MARCA` = o `file_size_limit` do bucket
  na 1094: mudou um, muda o outro. Nome e símbolo são obrigatórios para a
  marca própria.

### Desenhar
- ⚠️⚠️ **Marca própria NUNCA herda imagem do Atlas** (`resolverMarca`): peça
  não enviada fica `null`, e a tela cai em símbolo + nome em texto. `logoPara`:
  vertical que falta → horizontal do MESMO fundo; nunca troca de fundo (logo
  de texto branco em fundo claro some). O Atlas aparece inteiro ou não
  aparece.
- ⚠️ **`LogoDaMarca` põe as DUAS versões no HTML e o CSS esconde a do outro
  modo** (`.marca-so-no-escuro` / `.marca-so-no-claro`, FORA de camada no fim
  do `globals.css`): `dark:` está inerte (raiz, 8c), e ler o modo num hook
  trocaria a imagem só depois da hidratação. `fundo` força um lado (as
  prévias da aba); `marca` desenha o rascunho ainda não gravado.
- ⚠️ **Nome em texto (símbolo + nome) tem `max-w-full`, e o invólucro do
  logo nas telas de entrada (item da grade do `CardHeader`) tem `min-w-0`.**
  Sem os dois, o `truncate` não corta e um nome comprido alarga a coluna do
  cartão: no celular, título e descrição saem cortados (raiz, 8c).
- `<img>`, não `next/image`: a origem (o Storage de cada instalação) não está
  em allow-list nenhuma.

### Nada assado no build
- ⚠️⚠️ **O layout raiz (`generateMetadata` e o layout) chama `connection()`
  antes de `obterMarca()`; `icon.tsx`, `apple-icon.tsx` e `manifest.ts` são
  dinâmicos.** Prerenderizados no `next build` (sem service role no CI),
  levariam o padrão para sempre e a marca gravada nunca chegaria. Os ícones
  rodam em `nodejs`, não no edge do original: o símbolo padrão é lido do
  disco (`public/`).
- Os ícones gerados nunca respondem erro: falha no símbolo → o desenho
  genérico (`marca-icone.ts`). Ícone em 500 some da aba e da Tela de Início
  sem aviso.
- Os EXEMPLOS da aba são `ARQUIVOS_PADRAO` (`public/marca/atlas-*.png`), os
  mesmos do padrão: trocar o original do Atlas CRM é substituir os arquivos
  ali. `marca/` está na exceção de cache do `next.config.ts` (`deploy.md`).

### Fora da tela
- **O Asaas e o Atlas Gestor recebem o nome ATUAL**, lido por `obterMarca()`
  em tempo de execução (o `User-Agent` do Asaas, uma vez por cliente do
  ciclo) — nunca constante de módulo: a marca muda sem deploy.
- ⚠️ **O iPhone guarda nome e ícone NA INSTALAÇÃO:** gravar a marca não muda
  o app já instalado — apagar o ícone e adicionar de novo. O navegador guarda
  o ícone da aba (recarregar). O e-mail de recuperação de senha é modelo do
  painel do Supabase: a aba não chega nele.
