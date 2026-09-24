---
paths:
  - "src/lib/perfis/**"
  - "src/components/settings/perfis-panel.tsx"
  - "src/components/settings/poderes-do-papel.tsx"
  - "src/components/settings/areas-do-perfil.tsx"
  - "src/components/settings/perfil-resumo.tsx"
  - "src/components/settings/settings-sections.ts"
  - "src/components/settings/members-tab.tsx"
  - "src/components/auth/**"
  - "src/components/layout/**"
  - "src/hooks/use-can*"
  - "src/lib/auth/roles*"
  - "src/app/api/cb/perfis/**"
  - "src/app/api/account/**"
  - "src/lib/account/**"
  - "src/hooks/use-membros*"
  - "src/components/settings/invite-member-dialog.tsx"
  - "src/components/settings/settings-*.tsx"
---

# Perfis, papéis e menu — regras

Vale para perfis de acesso (Configurações → Perfis), a lente "Ver como", o
editor que descreve o papel, as seções só de admin, o menu e o cabeçalho, e
membros/posse da conta. Quem DECIDE permissão continua sendo `requireRole` na
rota, `useCan`/`RequireRole` no botão e a policy no banco; o que mora aqui
DESCREVE ou RECORTA a tela. Perfil é restrição de VISUALIZAÇÃO (956).

### Simulação de perfil ("Ver como")
Troca de LENTE no navegador, e só nele (`simulacao.ts`, o override no
`AuthProvider`, a faixa `faixa-de-simulacao.tsx`).
- ⚠️⚠️ **O servidor não participa**: `requireRole` e a RLS continuam vendo o
  admin real. Responde "o que este perfil VÊ e quais botões perde" — não é
  teste de segurança, e a faixa diz isso.
- ⚠️ **Nunca escala**: `resolverAcesso` só honra a lente quando o papel REAL
  administra (`podeSimular`) e o alvo é desta conta; chave plantada à mão por
  um agent é ignorada. O dono que simula perde o curto-circuito de dono.
- ⚠️ **Tudo no provider deriva do acesso EFETIVO** (`accountRole`, `acesso`,
  `isX`, `canX`): menu, seções, tela bloqueada, recortes e botões seguem
  juntos. Gate de UI que lê `profile.account_role` direto fura a lente.
- ⚠️ A simulação PENDENTE entra em `profileLoading` (o shell remonta já na
  lente, sem flash da visão do admin). Perfil apagado, erro ou 8 s sem resposta
  DERRUBAM a simulação e limpam a chave.
- Por ABA (`sessionStorage`) e amarrada ao `user.id` que a ligou; todo caminho
  de saída a limpa (o `signOut` e o SIGNED_OUT do listener) — senão outra
  pessoa na mesma aba herdaria a lente.
- A SAÍDA mora na faixa (o perfil simulado pode esconder Perfis); começar leva à
  primeira tela que o perfil enxerga. Presença, heartbeat e escritas continuam
  como o admin real.

### O editor de perfis DESCREVE o papel, e a descrição pode mentir
`poderes.ts` e `poderes-do-papel.tsx`.
- ⚠️⚠️ **`ESCRITA_DA_TELA` e `ESCRITA_DA_SECAO` são ESPELHO das guardas, não
  guarda nenhuma.** Mudou `requireRole`, `useCan`/`RequireRole` ou a policy de
  escrita de uma tela/seção? Mude o mapa no MESMO PR — sem isso o editor
  AFIRMA um poder que a pessoa não tem, e nenhum teste acusa. Os dois são
  `Record<…>`: tela/seção nova não compila sem entrada, mas o VALOR é de quem
  mexe na guarda.
- ⚠️ **`ESCRITA_DA_TELA.inbox` e `.contacts` são `viewer`**, de propósito: a
  régua é "há ALGUMA operação para este papel?", e a anotação interna conta
  (`canWriteNotes` aceita viewer). Não "simplificar" para `agent`. Quem levar o
  `InternalNoteBox` para outra tela rebaixa a entrada dela.
- ⚠️ `PODERES` delega aos predicados de `roles.ts`, nunca compara papel na mão
  (há teste comparando os dois lados).
- ⚠️ Id órfão é IGNORADO (o perfil "Administrador" desta conta guarda
  `"deals"`, seção que nunca existiu): sem o filtro, `roleRank` devolve
  `undefined` e o aviso diria "só para leitura" num Administrador.
- ⚠️ **Somente-leitura ≠ oculta.** Somente-leitura é o grupo "Só leitura para
  este papel" (aparece sem botões). Oculta é seção de `SECOES_SO_DE_ADMIN` num
  perfil não-admin: não é OFERECIDA e é DESCARTADA do rascunho
  (`semSecoesOcultas`) ao abrir o editor e ao descer o papel — sem caixa, o
  salvar a devolveria ao banco para sempre.
- A lista de poderes fica SEMPRE visível, nunca atrás de um "?".
- `ROTULO_DA_TELA` mora em `catalogo.ts`: cópia de mapa exaustivo diverge sem o
  typecheck ver.
- O `adminOnly` citado no docstring de `settings-sections.ts` não existe; quem
  recorta a seção é `podeVerSecao`.

### O editor nasce preenchido e agrupa por área
`editor.ts` e `areas-do-perfil.tsx`.
- ⚠️ "Novo perfil" abre primeiro a escolha do MODELO (`modelosDePartida`: os
  três de fábrica + "Começar em branco"). Ligar o botão direto ao formulário
  devolve o perfil que só serve depois de 14 caixas marcadas.
- Nome e descrição dos modelos vêm do DICIONÁRIO (`modelos.<papel>.*`), nunca do
  `nome` de `PERFIS_DE_FABRICA` (dado em português, sairia cru em inglês).
- ⚠️ A partição "só leitura" sai de `areasQueNaoOperam` (a régua única), nunca
  de uma segunda leitura de `ESCRITA_DA_*` — há teste.
- ⚠️ O grupo "Só leitura para este papel" existe DE PROPÓSITO e fica recolhido,
  tracejado, com o olho. Esconder o item apagaria configuração legítima (os
  perfis "Gestor" são `agent` com áreas só de leitura marcadas); misturá-lo aos
  operáveis era justamente a queixa.
- `AREA_DA_TELA` é `Record<TelaId, …>`: tela nova não compila sem área. Seção
  (fora as pessoais) cai sempre na área Configurações. Grupo vazio some.
- A caixa do grupo mexe SÓ no que é livre (`alternarGrupo`): item travado não
  entra no array. A contagem do cabeçalho conta TODOS (travado = marcado); o
  tri-estado da caixa olha só os livres.
- Abre expandido só o grupo PARCIAL (`gruposAbertosDeInicio`), semeado na
  MONTAGEM: o diálogo desmonta ao fechar, e cada abertura recomeça pela regra.
- Chaves montadas (`areas.<id>`, `modelos.<papel>.*`, `poderes.<id>`) escapam do
  portão de i18n: `editor.test.ts` e `poderes.test.ts` as cobram nos dois
  dicionários.

### Seções só de admin
- ⚠️⚠️ Seção cujas rotas são todas `requireRole('admin')` entra em
  `SECOES_SO_DE_ADMIN` (`catalogo.ts`; hoje `perfis` e `webhooks`). Marcar
  `admin` em `ESCRITA_DA_SECAO` NÃO basta: `podeVerSecao` tem fail-open para
  membro sem perfil, e um admin poderia marcar a caixa num perfil `agent` — a
  seção apareceria e não funcionaria. `api` está no mesmo caso e ficou como
  está, de propósito (decisão própria, não carona).
- `editor.test.ts` deriva de `SECOES_SO_DE_ADMIN` — nunca crave nomes de seção
  no teste.

### Funil e Contatos: o que é de admin (decisão do operador, 08/09/2026)
- "Gerenciar funil" SOME para quem não é admin (as policies exigem admin; RLS
  que barra escrita devolve 0 linhas sem erro). Esconder, não desabilitar.
- Lista, Desempenho e Saúde do funil são de admin (`canViewReports`) — recorte
  de TELA, não barreira (`deals` e `cb_lead_events` são legíveis por qualquer
  membro). A aba vigente é resolvida no RENDER (`vistaVigente`). Detalhes em
  `funil.md`.
- Apagar contato é admin nos dois lados (981) — `contatos.md`.
- Os poderes que separam `agent` de `admin` aparecem no editor (`PODERES`).
  Tarefa: `podeNaTarefa` dá apagar ao criador e ao admin (tarefa órfã).

### Menu, cabeçalho e catálogo de telas
- ⚠️ Tela nova no catálogo de perfis nasce INVISÍVEL para todo perfil já
  gravado. `/meu-dia` fica fora do catálogo (`telaDoCaminho` devolve null).
- ⚠️ Configurações é SEMPRE visível: `podeVerTela(ctx, 'settings')` é
  verdadeiro para todo perfil — nunca serve de gate para link. O parâmetro da
  página é `?tab=`.
- ⚠️ `pageTitles` (cabeçalho) casa por `startsWith` na ORDEM de inserção:
  `/agenda` vem DEPOIS de `/agendadas`. O `protectedPaths` do middleware também
  é `startsWith`: página pública não pode começar com prefixo protegido.
- Rótulo do menu e do cabeçalho é chave montada: pino `rotulo-do-menu.test.ts`
  cobra `Sidebar.<labelKey>` e `Header.<título>` nos dois dicionários.

### Membros e posse da conta
- Com perfil atribuído, o papel SEGUE o `papel_base` do perfil (962):
  `set_member_role` recusa membro com perfil. Mudar o papel = trocar o perfil.
- ⚠️ `accounts.owner_user_id` é `ON DELETE RESTRICT` (o dono vigente não se
  apaga), e `transfer_account_ownership` reparenta `contacts`, `conversations`
  e `custom_fields` para o novo dono (971) e limpa o `perfil_id` dele (965) —
  senão, apagado o login do ex-dono, o acervo iria junto pelo CASCADE. SÓ
  essas três: as outras guardam quem CRIOU, e mover é decisão pendente.
- `remove_account_member` só realoca o perfil; o que dispara o CASCADE de
  `user_id` é apagar o LOGIN fora do app (painel do Supabase, admin API).
