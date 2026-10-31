---
paths:
  - "src/lib/pipelines/motivo-da-etapa*"
  - "src/components/pipelines/motivo-da-etapa-config*"
  - "src/components/pipelines/janela-do-motivo*"
  - "src/components/inbox/painel/avancar-etapa.tsx"
  - "src/lib/automations/motivo-do-passo*"
  - "supabase/migrations/1112_cb_campo_do_motivo_da_etapa.sql"
  - "supabase/migrations/campo-do-motivo-1112.test.ts"
  - "supabase/migrations/1113_cb_motivos_do_funil.sql"
  - "supabase/migrations/motivos-do-funil-1113.test.ts"
  - "src/lib/funil/motivos*"
  - "src/hooks/use-motivos-do-funil*"
  - "src/components/funil/motivos-do-periodo.tsx"
---

# Motivos de desqualificação e de perda — regras

Plano vivo: `docs/PLANO-motivos-de-perda.md` (fases, medições, listas). O
resto do Gerenciar funil e do quadro está em `.claude/rules/funil.md`; o
campo que salva sozinho na ficha, em `.claude/rules/campos-e-nome.md`.

### Decisões do operador (26/10/2026)

- **Dois campos Lista por área** (motivo da DESQUALIFICAÇÃO e motivo da
  PERDA), no bloco de cada área, com a área no nome ("Motivo da perda
  (Bancário)"): o passo "Atualizar campo" e o catálogo do agente de IA
  listam os campos sem o bloco. Regra entre as etapas: Desqualificado = fora
  do perfil; Perdido = tinha caso (ou sem saber) e não avançou.
- **3 ou 4 motivos + "Outro"**, que abre texto livre gravado no PRÓPRIO
  campo (a ficha mostra valor fora da lista; o relatório agrupa como
  "Outro").
- **Obrigatório para PESSOAS** que levam o card à etapa (Fase 2); automação,
  robô, IA e API nunca abrem janela — a automação grava o motivo no próprio
  passo "Mover card de etapa" (Fase 3). O botão "Perdido" passa a escolher
  etapa + motivo e mover (Fase 2).

### Qual campo a etapa pergunta (1112)

`pipeline_stages.campo_do_motivo_id` (FK `ON DELETE SET NULL`),
`motivo-da-etapa.ts` (puro) e a seção `MotivoDaEtapaConfig` do Gerenciar
funil.

- ⚠️ **Quem decide é a CONFIGURAÇÃO da etapa, não o `resultado`**: o
  operador pode ligar o motivo numa etapa neutra ("Não Respondeu" do
  Trabalhista é degrau perda e etapa neutra).
- ⚠️⚠️ **O gatilho confere só a CONTA, nunca o tipo.** O upsert do Gerenciar
  funil regrava TODAS as etapas a cada "Salvar", e o BEFORE INSERT do upsert
  roda até para a linha que vira UPDATE: conferir o tipo travaria qualquer
  salvamento do funil depois de o tipo do campo mudar. O tipo é conferido
  por quem LÊ (`motivoDaEtapa`/`campoDoMotivo`): Lista com ao menos uma
  opção. Pino `campo-do-motivo-1112.test.ts`.
- ⚠️ **Campo que não serve nunca vira "Não pergunta" na tela**:
  `motivoDaEtapa` separa `nao_serve` (deixou de ser Lista ou ficou sem
  opção) e `sumiu` (fora do catálogo) de `nenhum`; o seletor mostra o valor
  com aviso e trava enquanto o catálogo carrega ou falhou. O "Salvar"
  regrava o valor lido do banco.
- **O catálogo do seletor é da conta DO FUNIL** (`account_id` lido com o
  nome do funil), nunca só pela RLS da 1032, que devolve os campos de toda
  conta da pessoa — o gatilho recusaria no "Salvar".
- **Seção própria, não quinta caixa na linha da etapa**: a linha já tem
  quatro seletores de largura fixa e só deixa de quebrar em `lg`.
- **ADITIVA**: o app novo manda a coluna no upsert; sem a 1112 aplicada o
  PostgREST recusa o "Salvar" do Gerenciar funil inteiro. Aplicar ANTES do
  deploy.

### A janela "Por que…?" (Fase 2)

`janela-do-motivo.tsx` (`useJanelaDoMotivo` → `pedirMotivo` + `janela`).
Pino `janela-do-motivo.chamadores.test.ts` com a lista dos caminhos de gente.

- ⚠️⚠️ **Caminho de GENTE que move card passa por `pedirMotivo`**: o quadro
  (a página), a lista do funil, o painel (seletor de etapa e "Perdido"), o
  "avançar" e o formulário do negócio. Caminho novo entra no pino. Fora, por
  escrito: a pauta de reuniões (só etapas de reunião) e os caminhos que não
  são de gente.
- ⚠️ **O motivo é gravado ANTES de mover, e o card só sai da coluna depois
  da confirmação**: na lista, o seletor é controlado pela etapa gravada;
  cancelar não grava nada. Falha ao gravar o campo NÃO move.
- ⚠️⚠️ **No quadro, o card movido pela janela também é marcado como
  recém-solto** (`onDealMoved(…, marcarSolto)`, chamado pelo `mover` da
  página na hora em que o card se move): as etapas que pedem motivo são as de
  perda, as colunas mais cheias, e sem a marca o card de meses atrás sumia
  atrás do "carregar mais" (`cardsDaColuna`). Cancelada, nada se marca.
- **Limite aceito: motivo gravado e card não movido** quando o movimento
  falha DEPOIS da janela ("avançar" que volta "já tinha mudado", `salvar()`
  do formulário que falha, update com 0 linhas). A ficha fica com o motivo e
  a próxima janela abre com ele marcado.
- ⚠️ **"Perdido" no painel com as etapas do funil desconhecidas** (a
  leitura falhou) avisa e não faz nada: "não sei" nunca vira "funil sem
  etapa de perda", que marcaria perdido sem mover e sem perguntar.
- **No "avançar", o "Desfazer" vem depois da janela**: desfazer o movimento
  não apaga o motivo já gravado na ficha (limite aceito).
- ⚠️ **"Perdido" (painel e formulário) escolhe a etapa de perda
  (`etapasDePerda`) e manda `status: 'lost'` JUNTO com a etapa**: etapa
  igual não passa pelo gatilho da 950, e o card reaberto parado na própria
  etapa de perda ficaria aberto. Funil sem etapa de perda: o botão segue
  marcando perdido sem mover.
- **Configuração quebrada não trava o trabalho** (campo que deixou de ser
  Lista, sumiu ou ficou sem opção): move SEM motivo, com aviso. Leitura que
  falhou trava ("Tentar de novo" ou cancelar). Card sem contato (ficha na
  Lixeira) move sem janela, com aviso.
- **"Outro"** é a opção cujo rótulo é "Outro" (`ehOutro`, sem caixa nem
  acento) e só existe se a lista a tiver; o texto digitado vai para o campo.
  A janela abre marcada com o que a ficha já tem (`escolhaInicial`).
- **O painel espelha o motivo na ficha** (`espelharMotivo`, cerca do
  contato), com UMA janela por painel — o "avançar" recebe `pedirMotivo`
  por prop, e o formulário do negócio aberto pelo painel avisa por
  `aoGravarMotivo` (com o contato do formulário, que pode ter sido trocado). ⚠️ Espelhar no estado NÃO basta: o campo que salva sozinho não
  persegue `valorSalvo` (`campos-e-nome.md`) e seguia mostrando "—" (e2e de
  26/10). A versão do campo (`versaoDoCampo`) entra na `key` e o remonta.
- **Botões de opção pelo `RadioGroup` do projeto**, nunca `<input
  type="radio">`: o nativo saía pintado de preto mesmo desmarcado na tela
  (e2e de 26/10).
- ⚠️ No formulário (que veio do upstream), `{janelaDoMotivo}` fica DENTRO do
  `<Sheet>`: embrulhar num fragmento reindenta o JSX inteiro (349 linhas de
  ruído no diff e conflito garantido no próximo merge).

### O passo "Mover card de etapa" grava o motivo (Fase 3)

`motivo-do-passo.ts` (I/O + puro, testado), `MotivoDoPassoField` no
construtor, o aviso `mover_card_sem_motivo` (`pendencias.ts`).

- ⚠️⚠️ **Grava DEPOIS da RPC aceita e do card fixado**: movimento recusado
  (o status mudou no meio) não deixa motivo solto. Pino lendo a ordem no
  `engine.ts` (`motivo-do-passo.test.ts`).
- ⚠️ **Falha ao gravar NÃO falha o passo**: o card já se moveu, e parar a
  execução calaria as mensagens seguintes ao cliente por um dado de
  relatório. Vira nota no registro (`— motivo não gravado (…)`), que o "Já
  rodou" traduz (`cardMovidoSemMotivo`, padrão ANTES do genérico em
  `texto-do-motor.ts`).
- **Motivo LITERAL do passo** (`step_config.motivo`), escolhido entre as
  opções do campo da etapa; trocar a etapa no construtor o limpa. Etapa que
  deixou de pedir motivo: o motor ignora e a tela avisa
  (`stages.motivoIgnorado`).
- **O aviso não barra a ativação** e conta como motivo um "Atualizar campo"
  no MESMO campo, em qualquer ramo — o jeito das automações de lembrete do
  Previdenciário. Etapas não carregadas: nada se afirma.
- Fora, por escrito: o nó "Mover card" do ROBÔ (`flows/mover-card.ts`), o
  `set_deal_status` (marca perdido sem mudar a etapa) e o `create_deal` que
  cria o card direto numa etapa que pede motivo não gravam motivo nem
  recebem o aviso; o agente de IA é a Fase 5.

### O relatório no Desempenho (Fase 4, 1113)

`cb_motivos_do_funil` (soma no banco), `motivos.ts` (leitura e
`agruparMotivos`, puros), `carregarMotivos` em `carregar.ts`,
`useMotivosDoFunil` e a seção `MotivosDoPeriodo`.

- ⚠️ **Conta CARDS que ENTRARAM na etapa no período** (a última entrada de
  cada card em cada etapa; `deal_created`, `stage_changed` e
  `pipeline_changed`, retroativo inclusive) — o jeito do cartão
  "Desqualificados" (1091), não o da linha de perda dos "Negativos" (que é
  quem ESTÁ perdido hoje): os números das duas seções podem diferir. Pelo
  período nos DOIS modos do Desempenho, e a nota diz isso.
- ⚠️⚠️ **A soma é do banco**, e a resposta que bate no teto do PostgREST é
  `null` ("não confie"), nunca meia soma. A seção que falha diz que não sabe;
  nunca "nenhum card".
- **Motivo = valor ATUAL do campo da etapa na ficha do contato ATUAL do
  card** (limite aceito: o motivo é do contato). Opção da lista → a linha
  dela; fora da lista (texto do "Outro", opção renomeada, o "Outro" literal
  do passo) → "Outro" com os textos; campo que deixou de ser Lista ou sumiu
  → tudo em "Outro", nada some.
- ⚠️ **"Sem motivo" separa só PESSOA de "sem pessoa"**: a trilha (912) grava
  automação, robô, IA e API todos como `sistema`; `retroativo` é o histórico
  importado. Separar mais pede mudar o gatilho da trilha — não prometer na
  tela.
- **A etapa que deixa de pedir motivo some do relatório**, com o passado
  dela: a função lê a configuração ATUAL das etapas.
- O valor vem por SUBCONSULTA (contato + campo casam o índice único): a
  junção solta lia a ficha inteira (medido: ~400 ms → ~7 ms num ano do
  Bancário).

### O Previdenciário ainda tem UM campo só

- ⚠️ `aa_motivo_desqualificacao` mistura desqualificação e perda, e as 6
  automações de lembrete GRAVAM nele (`update_contact_field`: "Não
  respondeu", "Não reengajou", "Outro") e uma desligada DECIDE por ele
  (condição `equals "Não respondeu"`). Dividir o campo exige repontar as 7
  automações junto, e espera a decisão da etapa "Perdido" do Previdenciário
  (plano, "Em aberto").
