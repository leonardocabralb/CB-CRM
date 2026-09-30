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
- ⚠️ **Chave de outro escritório não herda os vínculos** (`outro_escritorio`):
  os ids de cliente são do escritório anterior. Desconectar apaga só a
  conexão; os vínculos ficam para o mesmo escritório reconectado.
- **O endereço é constante do produto** (`API_DO_ATLAS`); `ATLAS_API_URL`
  (servidor, só https) aponta para outro ambiente do Atlas. ⚠️ O preview
  grava no banco da PRODUÇÃO: conexão feita lá contra o staging do Atlas fica
  na conta real e é desconectada antes do deploy.

### O passo "Criar cliente no Atlas" (`criar-cliente.ts`)

- ⚠️⚠️ **Procura antes de escrever** (o n8n criava sempre): o vínculo que já
  existe manda (relê o cliente); sem ele, `find_clients` pelo link das
  conversas do CRM + o id da ficha, pelo telefone e pelo e-mail.
  `decisao.ts`: nada → criar; UM encerrado (rescindido, finalizado,
  inativo, suspenso) → REATIVAR o mesmo cadastro (decisão do operador: nunca
  criar outro para quem volta); UM em curso → só vincular (o Atlas manda no
  contrato); mais de um, ou lista cortada → PARA com motivo.
- **Nunca repete sozinho**: fica FORA de `PASSOS_DE_ENVIO` (criar pode ter
  acontecido com tempo esgotado). As escritas levam `Idempotency-Key`
  `<logId>:<stepId>:criar|reativar`; rodar de novo por gente acha o cliente
  pelo link da conversa e não duplica.
- **O formato é o do n8n** (`formatar.ts`): telefone com DDI e o nono dígito
  (`telefoneCanonico`), estado pelo DDD SÓ de número brasileiro, datas
  `aaaa-mm-dd` no fuso do escritório (nunca `toISOString().slice`), valor do
  card (0 sem card), "fixo" por padrão, vazio vai `null`. A nota leva o nome
  do app de `marca.ts`, nunca literal. A reativação não mexe em nome,
  telefone, e-mail nem nota que a equipe cuida no Atlas.
- **O motivo da falha vai para o fio e o "Já rodou"** (qualquer membro lê):
  só o código traduzido (`motivoDaFalha`), nunca texto da resposta do Atlas.
  Chave recusada marca a conexão em erro (`registrarConferencia`).
- **Vínculo 1:1** (`cb_atlas_clientes`): o cliente do Atlas já ligado a
  OUTRA ficha não é roubado (`ligado_a_outra_ficha`). Lido por membro (forma
  da 1032), escrito só pelo servidor; `contact_id` SET NULL — a tabela está
  na receita de fusão (`.claude/rules/supabase.md`).
