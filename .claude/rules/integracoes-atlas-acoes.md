---
paths:
  - "src/lib/atlas/acoes*"
  - "src/lib/atlas/passos-do-atlas*"
  - "src/components/automations/automation-builder.tsx"
  - "src/components/automations/passo-de-integracao*"
---

# O nó "Atlas" das automações — regras

Vale no nó "Atlas" do construtor e nas quatro ações NOVAS de escrita da API
do Atlas (decisão do operador, 30/09/2026): "Atualizar cliente", "Criar
tarefa", "Enviar transcrição" e "Atualizar item do onboarding". O "Criar
cliente" (`criar-cliente.ts`), a conexão, o vínculo, a leitura e o gatilho
estão em `.claude/rules/integracoes-atlas.md`; o motor, em
`.claude/rules/automacoes.md`. Plano: `docs/PLANO-integracao-atlas.md`,
Fase 5.

### Um nó na tela, um `step_type` por ação

- **Cada ação é um `step_type` próprio** (`PASSOS_DO_ATLAS`,
  `passos-do-atlas.ts`): `atlas_criar_cliente` fica, e entram
  `atlas_atualizar_cliente`, `atlas_criar_tarefa`, `atlas_enviar_transcricao`
  e `atlas_atualizar_onboarding`. Sem migration (`automation_steps.step_type`
  não tem CHECK). ⚠️ Rollback do deploy com automação ligada nos tipos novos:
  o `default` do motor antigo devolve `unknown step` como SUCESSO.
- ⚠️⚠️ **O "Criar cliente" está LIGADO em produção** (o último do ramo NÃO
  do "Contrato fechado", com os três campos de data): o `case` dele, a
  config, `criar-cliente.ts`, `decisao.ts` e `formatar.ts` NÃO mudam, e nada
  é extraído dele para "compartilhar" (`acoes.ts` copia as ~20 linhas de
  conexão e vínculo). Pinos com a config EXATA de produção:
  `passo-de-integracao.test.ts`, `validate.test.ts` e `engine.test.ts`.
- **UMA entrada no menu** ("Atlas", `t("atlas.no")`): `ADDABLE_STEPS` tem só
  `atlas_criar_cliente`; o nó nasce "Criar cliente" — ou "Criar tarefa" na
  automação do gatilho do Atlas. A ação se escolhe DENTRO do passo
  (`AtlasPassoFields`), e os cinco têm a borda laranja, o ícone tingido e o
  selo "Integração Atlas" (`ehPassoDeIntegracao` = `ehPassoDoAtlas`; nenhum
  outro tipo usa laranja).
- ⚠️⚠️ **Trocar de ação troca o tipo e a config, e MANTÉM `cid` e `id`** (a
  espera parada num ramo guarda o id do passo). A config de cada ação fica
  numa memória da tela por `cid` (`trocarAcao`, `MEMORIA_DO_NO_ATLAS`):
  voltar à ação anterior a DEVOLVE. Sem ela, "Criar → Atualizar → Criar" no
  "Contrato fechado" gravava `{tipo_de_contrato:'fixo'}` sem pedir nada, e o
  Atlas passava a receber as RESERVAS (criação do card, hoje) como se fossem
  as datas certas. Sair de uma config que não é a vazia pede `confirm`.
- ⚠️ **Nenhum formulário do nó escreve ao MONTAR** (sem efeito que chame
  `set`/`onChange`): abrir o passo de produção não pode mudá-lo. Padrões só
  do `blankConfig` e da leitura (`=== true`, `?? padrão`). Pino que lê o
  fonte.

### O que as quatro repartem (`acoes.ts`)

- **O cliente é o do VÍNCULO** (`cb_atlas_clientes` pela cerca `noAmbiente` e
  pelo `atlas_tenant_id` da conexão; de outro escritório = sem vínculo). Erro
  de leitura LANÇA, nunca "sem vínculo". Sem vínculo, atualizar, transcrição
  e onboarding FALHAM sem chamar o Atlas (`MOTIVO_SEM_VINCULO`: rodar "Criar
  cliente", pedir a um admin que vincule, juntar fichas se o "Criar" disse
  "ligado a outra ficha").
- **Lixeira**: o `not_found` do Atlas numa ação com cliente marca
  `excluido_no_atlas_em` (o vínculo NUNCA sai) e falha. A marca sozinha não
  barra atualizar, transcrição nem onboarding (pode estar velha: quem decide
  é o 404); barra a TAREFA, que não tem 404 (a API liga a tarefa ao cliente
  da lixeira) — a ajuda do passo e a INSTALACAO dizem. ⚠️ O SUCESSO dessas
  três TIRA a marca (`tirarMarcaDaLixeira`: a edge só escreve com
  `deleted_at IS NULL`; só a marca, como o "Conferir no Atlas"): restaurar
  não muda o `status_changed_at`, e a tarefa seguinte falharia até a
  listagem completa.
- ⚠️⚠️ **`create_task`, `create_transcript` e `update_onboarding` são
  OPCIONAIS** (`PERMISSOES_OPCIONAIS`, fora de `PERMISSOES_NECESSARIAS`):
  desligada, o passo falha com o que ela faz e o nome TÉCNICO
  (`DESCRICAO_DA_PERMISSAO_OPCIONAL`; o rótulo da tela do Atlas não foi
  conferido e só entra em `ROTULO_DA_PERMISSAO` depois — nunca um rótulo
  inventado no motivo, no cartão ou na INSTALACAO) e a conexão
  NÃO vai a erro — também quando o Atlas não manda `permission` (vale a da
  ação). `update_client` desligada marca (é obrigatória). O cartão diz quais
  são opcionais, mas não quais estão ligadas (não guarda o `whoami`).
- **Motivo só com código** (`motivoDaAcao`): nunca `e.message` nem texto do
  corpo do Atlas; o `code` do Atlas escolhe a frase da idempotência
  (`in_progress`, `outcome_unknown`, `conflict`, `key_invalid`). Tempo
  esgotado diz o que conferir no Atlas por ação (a API não confirma tarefa
  nem transcrição: rodar de novo duplica).
- **Nunca repete sozinho** (fora de `PASSOS_DE_ENVIO`). `Idempotency-Key`
  `<logId>:<stepId>:atualizar|tarefa|transcricao|onboarding` (≤ 85 de 8–128).
  Sem `logId` o passo falha (a prévia diz o que faria).
- ⚠️ **Os textos vão ao Atlas por `interpolarParaOAtlas`** (motor, modo
  mensagem e ESTRITO): leitura do contato ou do card que falha FALHA o passo
  — o `interpolate` comum a tornaria vazio ("Preparar a pasta de ").
- Não criam conversa, não reabrem, não mexem no card. O cliente HTTP novo
  (`AcoesNoAtlas`) fica FORA de `ClienteAtlas`: o "Criar" e os dublês dele
  não mudam.

### Atualizar cliente (`update_client`)

- ⚠️⚠️ **Nunca `null` nem vazio no corpo** (no `update_client`, `null` LIMPA o
  campo lá): fonte vazia na ficha fica FORA, sem a reserva do "Criar". Card
  sem valor (`deals.value` é NOT NULL DEFAULT 0) ou sem card = sem
  `contractValue`. Data preenchida ilegível e documento que não é CPF/CNPJ
  FALHAM; campo escolhido que sumiu do catálogo (data ≠ `datetime`, documento
  ≠ `text`) falha. Tudo vazio = conclui sem chamar.
- **Situação opcional, padrão NÃO mandar** (D2). A lista é a do contrato §8
  sem `em_negociacao` (decisão do operador). ⚠️ `ativo`/`importado` REABREM:
  o passo relê o cliente (`get_client`) e PARA no suspenso — senão
  contornaria a trava do "Criar". A situação escrita vai ao VÍNCULO
  (`situacao`, `situacao_lida_em`, `crm_escreveu_em`): a leitura a vê igual e
  não gera o evento do gatilho; falhar essa escrita falha o passo dizendo que
  o Atlas já foi escrito.
- ⚠️ **O gatilho "Situação mudou no Atlas" recusa o passo INTEIRO**
  (`atlas_gatilho_com_atualizar_cliente`, com ou sem situação) e o seletor o
  esconde. Limite aceito: gatilho → "Mover card" → automação de etapa com
  "Atualizar cliente (situação)" reescreve por reflexo; não vira laço (a
  escrita atualiza o vínculo), mas contraria a D2.

### Tarefa, transcrição, onboarding

- **Tarefa**: cliente OPCIONAL (sem vínculo, nasce sem cliente e o detalhe
  diz; o alvo é a equipe do Atlas). A API a põe no admin ativo mais antigo e
  descarta em silêncio o `clientId` que não acha: o detalhe diz "pedida com o
  cliente", nunca "ligada". Prazo = `somarDias(diaNoFuso(…))` (nunca
  `toISOString().slice`); descrição vazia leva o nome da automação e o
  `NOME_DO_APP`.
- **Transcrição**: a da reunião MAIS RECENTE da ficha na janela
  (`cb_reunioes_transcritas`, padrão 72 h). Pendente, sem transcrição ou
  falha FALHA — nunca manda a anterior (seria outra reunião). ⚠️ Ligada pelo
  E-MAIL do convidado (casamento fraco) só com
  `aceitar_vinculo_por_email === true`; o motivo manda tirar a reunião da
  ficha e vincular de novo (não há botão "confirmar": só o PATCH de vincular
  grava `manual`), citando só botões que existem (pino). Acima de 300 KB falha sem cortar; as
  notas (cabeçalho no fuso do escritório + as do passo + as da reunião, só
  com `true`) cabem em 50 KB cortando só as da reunião, por bytes. O texto
  nunca vai a detalhe, log nem contexto. Rodar de novo manda outra cópia.
- **Onboarding**: o item pelo TEXTO literal (sem `{{`); observação vazia fica
  fora; teto de 2000 em unidades UTF-16 sem partir emoji. O 404 COM a lista
  de itens é `item_nao_encontrado` (nunca a lixeira); `ambiguous` pede
  renomear lá.
- **Orçamento de tempo** (não medido): cada chamada tem 15 s, e o laço rápido
  do agendador corta em 50 s; várias ações do Atlas seguidas sem "Aguardar"
  numa retomada pelo cron podem passar do teto e deixar a execução sem
  desfecho com a escrita feita. Medir antes de encadear mais de duas.
