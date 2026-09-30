---
paths:
  - "src/lib/atlas/**"
  - "src/app/api/cb/atlas/**"
  - "src/components/settings/atlas-card*"
  - "supabase/migrations/1071_cb_atlas.sql"
  - "supabase/migrations/atlas-1071.test.ts"
---

# Integração com o Atlas Gestor — regras

Vale no cliente da API do Atlas (`src/lib/atlas/`), no cartão "Atlas" de
Integrações e no passo de automação "Criar cliente no Atlas". Plano, fases e
decisões do operador: `docs/PLANO-integracao-atlas.md`. O motor e o
construtor: `.claude/rules/automacoes.md`.

### A chave e a conexão (1071)

- ⚠️⚠️ **Só pela API do Atlas, nunca pelo banco dele** (decisão do operador):
  o CRM é vendido a quem também usa o Atlas, e a única coisa que o escritório
  faz é colar a chave. Um endpoint só (`client-webhook`), ação no corpo
  (`{ action, data }`), chave no cabeçalho `x-api-key`, `redirect: 'manual'`,
  toda mensagem por `semSegredo`.
- **A chave é do ESCRITÓRIO**, não da pessoa: gerada pelo admin do Atlas,
  colada uma vez no cartão, guardada cifrada em `cb_atlas_config` (FECHADA ao
  navegador, sem policy — pino `atlas-1071.test.ts`). Nenhuma rota a devolve,
  nem mascarada. As permissões também são do escritório, no Atlas: conectar
  recusa (`permissoes_faltando`, com a lista) sem Consultar, Criar e
  Atualizar clientes.
- **Conectar = `whoami`**, que não grava nada no Atlas. Nunca sondar
  permissão com ação de escrita: dependeria da ordem de validação de OUTRO
  produto e, se ela mudar, cada conexão criaria um cliente vazio.
- ⚠️ **Chave de outro escritório é RECUSADA** (`outro_escritorio`) enquanto
  houver ficha ligada a cliente do escritório anterior: os ids são de lá.
  Desconectar apaga só a conexão; os vínculos ficam para o mesmo escritório
  reconectado. Trocar de escritório exige apagar os vínculos à mão (sem tela:
  pendência no plano).
- **O endereço é constante do produto** (`API_DO_ATLAS`); `ATLAS_API_URL`
  (servidor, só https) aponta para outro AMBIENTE do Atlas (o staging).
- ⚠️⚠️ **A conexão guarda o ambiente** (`cb_atlas_config.api_url`, nulo = o
  Atlas de verdade), porque o preview grava no banco da PRODUÇÃO (CLAUDE.md
  8b): a instância de teste não conecta por cima nem desconecta a conexão de
  outro ambiente (`outro_ambiente`), nenhuma lê a chave do outro, e o staging
  recusando uma chave não marca a de verdade em erro. A de verdade substitui
  ou apaga uma de teste esquecida. Vínculos criados no teste ficam (a
  produção os relê pelo `get_client`: `not_found` → procura de novo).

### O passo "Criar cliente no Atlas" (`criar-cliente.ts`)

- ⚠️⚠️ **Procura antes de escrever** (o n8n criava sempre): o vínculo que já
  existe manda (relê o cliente); sem ele, `find_clients` pelo link das
  conversas do CRM (a da execução primeiro: o Atlas aceita 10 ids) + o id da
  ficha, pelo telefone e pelo e-mail (critério que
  o Atlas recusaria — e-mail sem @, telefone com menos de 10 dígitos — fica
  fora: derrubaria a busca inteira). `decisao.ts`: nada → criar; UM
  rescindido ou finalizado → REATIVAR o mesmo cadastro (D3: nunca criar outro
  para quem volta); UM em curso → só vincular (D2: o Atlas manda no
  contrato); PARA com motivo, sem escrever, quando há mais de um (ou a lista
  veio cortada), quando está inativo ou suspenso (a equipe pausou lá), ou
  quando o casamento é FRACO.
- ⚠️⚠️ **Só casamento FORTE age sozinho** (`matched_by` com `chat_link`,
  `phone` ou `doc_id`): `phone_last8` (telefone guardado sem DDD) e `email`
  casam pessoas diferentes (cônjuge com o mesmo e-mail), e reativar gravaria
  o contrato de uma no cadastro da outra. Sem `matched_by` = fraco (falha
  fechada).
- ⚠️⚠️ **O dono se confere ANTES da escrita**: cadastro achado já ligado a
  OUTRA ficha → em curso, devolve `ligado_a_outra_ficha` sem gravar nada;
  encerrado, PARA (provável ficha duplicada: fundir pela receita). Vínculo
  órfão (a ficha antiga foi apagada) é adotado.
- ⚠️ **Só o `not_found` DO ATLAS é "apagado"** (`ler` → null, o vínculo
  velho sai). 404 do gateway (sem o código, endereço errado) e 200 sem o
  cliente LANÇAM: apagar o vínculo por eles recriaria o cliente (CLAUDE.md
  8b). 2xx sem o que se esperava é `resposta_inesperada` — pode ter gravado.
- **Nunca repete sozinho**: fica FORA de `PASSOS_DE_ENVIO` (criar pode ter
  acontecido com tempo esgotado). As escritas levam `Idempotency-Key`
  `<logId>:<stepId>:criar|reativar`; rodar de novo por gente acha o cliente
  pelo link da conversa e não duplica. Duas execuções SIMULTÂNEAS do mesmo
  contato não se enxergam e podem criar dois cadastros (a segunda falha no
  vínculo, com o motivo): conhecido, não tratado, como o `create_deal`.
- ⚠️ **Só cria o que a busca reencontra** (link da conversa, telefone ou
  e-mail válidos): sem nenhum, o passo PARA — se o vínculo falhasse depois,
  a nova execução (outra chave de idempotência) criaria um segundo cadastro.
- **O formato é o do n8n** (`formatar.ts`): telefone com DDI e o nono dígito
  (`telefoneCanonico`), estado pelo DDD SÓ de número brasileiro, datas
  `aaaa-mm-dd` no fuso do escritório (nunca `toISOString().slice`), valor do
  card (0 sem card), "fixo" por padrão, vazio vai `null`. A nota leva o nome
  do app de `marca.ts`, nunca literal. A reativação não mexe em nome,
  telefone, e-mail nem nota que a equipe cuida no Atlas.
- **O motivo da falha vai para o "Já rodou" da aba Automações e para os
  registros** (qualquer membro lê; o fio não mostra motivo cru): só o código
  traduzido (`motivoDaFalha`) e, na validação, os NOSSOS nomes de campo —
  nunca texto da resposta do Atlas. Falha depois de escrever no Atlas diz o
  que já foi escrito ("o cliente foi criado no Atlas, mas…"). Chave recusada
  marca a conexão em erro (`registrarConferencia`).
- **Vínculo 1:1** (`cb_atlas_clientes`): o cliente do Atlas já ligado a
  OUTRA ficha não é roubado (`ligado_a_outra_ficha`). Lido por membro (forma
  da 1032), escrito só pelo servidor; `contact_id` SET NULL — a tabela está
  na receita de fusão (`.claude/rules/supabase.md`).
