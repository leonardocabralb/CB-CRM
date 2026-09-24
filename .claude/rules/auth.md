---
paths:
  - "src/lib/auth/**"
  - "src/app/auth/**"
  - "src/app/*/login/**"
  - "src/app/*/reset-password/**"
  - "src/app/*/forgot-password/**"
  - "src/app/*/signup/**"
  - "src/app/join/**"
  - "src/app/api/invitations/**"
  - "src/middleware.ts"
  - "src/hooks/use-auth*"
  - "src/hooks/use-guarda-de-inatividade*"
  - "src/components/settings/sessions-card.tsx"
  - "src/components/settings/security-panel.tsx"
---

# Login, sessão e convite — regras

Vale ao editar ou revisar login, recuperação de senha, cadastro por convite,
sair, a sessão no `useAuth`, a guarda de inatividade e o `middleware.ts`. A
lente "Ver como" (que também mora no `use-auth.tsx`) está em
`.claude/rules/perfis.md`; a tela de entrada que a inatividade reabre, em
`.claude/rules/meu-dia.md`.

### Recuperação de senha: `/auth/callback` e `/reset-password` são um par

A tela "esqueci a senha" aponta para as duas. Apagar uma apaga a recuperação
de senha inteira: o link do e-mail cai em 404.

- ⚠️ **O `next` do callback passa por `destinoSeguro`**
  (`src/lib/auth/destino-seguro.ts`), nunca cru. Com o navegador já
  autenticado, um `next` para outro host é open redirect no instante em que a
  pessoa vai digitar a senha. A régua é a ORIGEM RESOLVIDA: `//evil.com`,
  `/\evil.com`, `https://evil.com` e `javascript:` passam por
  `startsWith('/')` e morrem na comparação de origem; saída que começa com
  `//` é recusada (`/.//evil` resolve dentro da base e sairia do domínio).
  Pino: `destino-seguro.test.ts`.
- ⚠️ **O callback redireciona pela ORIGEM PÚBLICA (`origemPublica`), nunca por
  `request.url`**: o `standalone` monta a URL do pedido com `0.0.0.0:3000`.
- ⚠️ **As duas rotas ficam FORA do `protectedPaths`.** Quem chega ao callback
  ainda não tem sessão: protegê-lo mandaria a pessoa ao login levando o `code`
  embora, e o código do e-mail é de uso único.
- ⚠️ **Cada instalação cadastra `<origem>/auth/callback` nos redirects do
  Supabase** (Authentication → URL Configuration). Está no
  `docs/INSTALACAO.md`.

### Cadastro SÓ POR CONVITE

`disable_signup` ligado no Supabase (decisão do operador, 22/09/2026).
`POST /api/invitations/[token]/cadastro` confere o convite, cria o usuário pela
API de administração (que ignora a opção) e ACEITA o convite na mesma
requisição, com o `redeem_invitation` rodando com o JWT da pessoa. Pino:
`cadastro/route.test.ts`.

- ⚠️⚠️ **Criar a conta sem aceitar é o furo.** `handle_new_user` dá a todo
  usuário novo um CRM PRÓPRIO (conta avulsa, dono): um link não aceito
  criaria contas capazes de conectar WhatsApp na Evolution do escritório.
- ⚠️⚠️ **Três estados, nunca dois: `aceito`, `pendente`, `incerto`.** Leitura
  do banco que falha é `incerto`: nada é apagado (pode ser um membro) e nada é
  declarado (pode ser conta avulsa) — 503 `aceite_incerto`, e a tela leva a
  `/join/<token>`. Só `pendente` desfaz.
- ⚠️ **DELETE da conta avulsa que acha ZERO linhas não segue para o
  `deleteUser`** sem reconferir: um `redeem` em voo apaga a conta avulsa
  sozinho, e apagar o usuário ali tiraria da equipe quem acabou de entrar.
- **O cadastro fechado não tranca quem JÁ tem login** (ex-membro — remover da
  equipe não apaga o login — e contas avulsas antigas). A saída é BLOQUEAR em
  Authentication → Users (decisão do operador).

### Sair: todo `auth.signOut(` declara o escopo

- ⚠️⚠️ **O padrão da biblioteca é `'global'`** (revoga TODOS os aparelhos) e é
  invisível. Por isso todo `auth.signOut(` em `src/` escreve o escopo. Pino
  `src/lib/auth/sair.chamadores.test.ts`: é deep-equal e também reprova
  `signOut` desestruturado ou referenciado solto — chamada nova entra no
  manifesto por decisão visível no diff.
- **O "Sair" do menu sai SÓ deste aparelho** (`sairDesteAparelho`, escopo
  `local`; decisão do operador, D4, 12/09/2026). Ele devolve o erro e só
  navega com sucesso: signOut que falha por rede não apaga a sessão, e navegar
  assim forma o laço `/login` → `/dashboard`.
- **Os dois globais são declarados por escrito**: o do convite (`/join`,
  e-mail diferente) e o "Sair de todos os aparelhos" de Segurança
  (`sessions-card.tsx`).
- Todo caminho de saída limpa também a lente de simulação (ver
  `.claude/rules/perfis.md`).

### A chave "mesmo login": `sessionId`

- ⚠️ **É o `session_id` do token de acesso** (`sessionIdDoToken`, lido sem
  verificar assinatura — é chave de interface, não de autorização), publicado
  no contexto de auth no MESMO passo que `user`, no init e no listener. Ele não
  muda quando o app renova o token: "sessão nova" = login novo de verdade.
- `sessionId` nulo decide SÓ pelo dia: tratar `null === null` como "mesma
  sessão" faria um registro sem sessão valer para todo login futuro.

### Guarda de inatividade (4 h)

`src/lib/auth/inatividade.ts` (régua pura) e
`src/hooks/use-guarda-de-inatividade.ts` (encanamento). Quatro horas sem gesto
em NENHUMA aba deste navegador reabrem o Meu dia; é a ÚNICA exceção à trava de
mão única da porta. É barreira de TELA, não de dados; sem senha (decisão do
operador).

- ⚠️ **O relógio é compartilhado entre as abas** (`cb-atividade:<userId>`):
  sem ele, a aba ociosa derrubaria quem trabalha na outra. Storage que não
  grava ou `sessionId` nulo DESLIGAM a guarda pelo mesmo motivo.
- ⚠️ **O gesto que descobre a expiração é engolido** (`stopPropagation()` e
  `preventDefault()`, ouvinte em `window` na fase de captura, `keydown` e
  `pointerdown` sem `passive`): o Enter ou o clique que acorda a tela não
  chega ao app nem ativa o botão focado.
- `scroll` NÃO conta como atividade: o fio escreve `scrollTop` sozinho.
- Registro de OUTRA sessão, ou ausente, nunca expira: o carimbo de ontem
  derrubaria o login de hoje.
- Confere ANTES de gravar: mexer o mouse depois das 4 h não ressuscita a sessão.
- A aba reaberta depois de 4 h é decidida no INICIALIZADOR da porta
  (`inatividadeExpirou`), sem montar o app por um quadro.

### `middleware.ts`: `protectedPaths`

- **A conferência é por `startsWith`.** `/agenda` cobre `/agendadas` de graça
  — e por isso a futura página pública de auto-agendamento se chama
  `/marcar/<token>`, nunca `/agendar/<token>`: o cliente, sem login, cairia na
  tela de login.
- Tela nova do painel entra em `protectedPaths` (foi assim com `/meu-dia` e
  `/radar`); as rotas de senha e de convite ficam fora.
