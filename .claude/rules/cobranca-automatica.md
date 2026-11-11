---
paths:
  - "src/lib/asaas/modulo-da-cobranca*"
  - "src/lib/asaas/previa-da-regua*"
  - "src/lib/asaas/proxima-etapa*"
  - "src/lib/asaas/primeiros-passos*"
  - "src/lib/asaas/textos-da-regua.ts"
  - "src/app/api/cb/asaas/regua/**"
  - "src/components/settings/cobranca-*"
  - "src/components/settings/asaas-modulo.tsx"
  - "src/components/automations/selo-da-regua.tsx"
---

# Cobrança automática do Asaas — o módulo (1135)

A tela própria da régua (998) em Configurações › Integrações › Asaas
(`?tab=integracoes&aba=cobranca`, `&etapa=<id>` no texto), os blocos
"Primeiros passos" e "O que a integração faz" do cartão, a aba fixa em
Automações e o aviso no construtor. O motor da régua não mudou:
`.claude/rules/integracoes-asaas.md` (varredura, travas, janelas) e
`.claude/rules/automacoes.md` (validação dos gatilhos da régua). Plano e
decisões: `docs/PLANO-integracao-asaas.md` §13.

### FACHADA sobre as automações da régua

- ⚠️⚠️ **O estado é DERIVADO do que está gravado a cada carga**
  (`derivarEstado`), nunca guardado à parte: cada etapa É uma automação, e o
  construtor também as abre (decisão do operador, 11/11/2026: lá ele só
  AVISA, `AvisoDaRegua`). Coluna nova "da régua" que duplique o que a
  automação já guarda dessincroniza na primeira edição pelo construtor.
- ⚠️⚠️ **Salvar é um PATCH por automação pela rota do CONSTRUTOR**
  (`patchesDoModulo` → `PATCH /api/automations/[id]`): a validação de ligar
  (conexão, recusas da régua, condição) é uma só. Uma recusada não segura as
  outras — a tela lista quais e por quê (`chaveDaPendencia`). Ligar vem por
  ÚLTIMO na leva (cada PATCH é validado sozinho, já com a conexão nova).
- O passo trocado preserva o `id` (os nós vêm de `loadStepsTree`); o bloco
  novo do "Pedir ligação" nasce sem id (os de antes saem inteiros).
- "Quem assina" vale para todas as etapas MENOS o lembrete da noite, que tem a
  sua ("Mensagem automática"), editada no texto dele. `null` tira a assinatura.
- A conexão troca em TODO `send_message`/`send_media`, inclusive dentro dos
  ramos — a régua exige o MESMO número em todos (`validate.ts`).
- O texto editado é o do PRIMEIRO "Enviar mensagem" do escopo de fora.
- Etapa que a tela CRIA ("Adicionar cobrança", "Criar as etapas padrão")
  nasce com "Quem manda", a regra de dias úteis salva e o "Pedir ligação" das
  cobranças: o POST da régua recebe os três; sem eles, a tela voltava em
  "vários"/"misto" e a etapa ligada fugia da regra.
- Sem etapa nenhuma, número, quem assina, dias úteis e o "Pedir ligação"
  ficam DESABILITADOS: salvar faria zero PATCHes e diria "salvo". Escolhem-se
  depois de criar as etapas.

### "Pedir ligação à equipe"

- ⚠️⚠️ **A forma do módulo é UMA** (`blocoDaLigacao`/`lerBlocoDaLigacao`):
  condição "Situação da cobrança" (Sim) → "tem a etiqueta X" (Não) →
  [anotação marcando, pôr a etiqueta X]. A etiqueta é o "até resolver".
  Trocar remove SÓ o bloco nessa forma, no escopo de fora; a condição montada
  à mão fica onde está e a tela avisa (`ligacaoAMao`).
- Só nas COBRANÇAS: no lembrete a condição não tem vencidas para ler (e a
  ativação recusa).
- A "Ligação pedida" da aba Cobranças e o "N esperando ligação" da tela leem a
  etiqueta que a condição PERGUNTA e o passo PÕE nas cobranças — sem coluna.
  Limite conhecido: a aba não lê a árvore, então uma régua montada à mão com
  uma etiqueta perguntada num ramo e posta em outro também conta. Na forma do
  módulo isso não acontece.

### Nome do escritório e aviso de inadimplência (1135)

- `{{vars.escritorio_nome}}` = `cb_asaas_config.regua_escritorio_nome`, senão
  o nome automático da assinatura, senão `accounts.name` — `nomeDoEscritorio`,
  a MESMA ordem na varredura, na tela e na prévia por caso. Vazio grava NULO.
- ⚠️⚠️ **Aviso desligado (`aviso_inadimplencia_ativo = false`)**: o resumo
  responde `avisoDesligado: true` com os contatos VAZIOS de propósito, e o
  navegador neutraliza o filtro (`aviso_desligado` em
  `motivoDaNeutralizacao`), cala o ícone e a faixa — nunca lê "ninguém
  deve". A aba Cobranças da conversa continua.
- ⚠️ As duas colunas são lidas por NOME (`lerConfigDoEspelho`, resumo, card,
  varredura, a rota do módulo): migration aplicada ANTES do deploy.

### O que a tela mostra

- ⚠️ "Próxima (prevista)" na aba Cobranças é ESTIMATIVA
  (`proximaEtapaPrevista`): etapas ligadas, trava, dia-alvo, D13, janela e
  intervalo. Na hora a varredura relê no Asaas — a tela diz isso. As travas
  vêm de uma leitura própria, SEM o teto de 30 do histórico (um envio a
  cliente com muitas parcelas passa disso); no teto dela, a previsão some.
  Quem tem marco de cobrança no dia não tem o lembrete do DIA naquele dia (a
  cobrança absorve, `agruparLembretes`): as cobranças são calculadas primeiro.
- Números que falham (`envios7d`, `ligacoesPendentes`) vêm `null` e SOMEM,
  nunca 0. A prévia por caso usa `montarVariaveis` com parcelas fictícias
  (`previa-da-regua.ts`); a com cliente real é a do construtor.
- A aba fixa "Cobrança automática" de Automações (`ABA_DA_COBRANCA`) vence a
  área gravada, pelo GATILHO, e só aparece com alguma automação nela.
- Chaves montadas (`texto.caso.*`, `texto.legenda.*`, `passos.*`,
  `funcoes.*`): cobradas em `primeiros-passos.test.ts`.
