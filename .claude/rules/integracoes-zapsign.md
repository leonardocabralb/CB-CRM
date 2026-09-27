---
paths:
  - "src/lib/zapsign/**"
  - "src/app/api/cb/zapsign/**"
  - "src/components/settings/zapsign-card*"
  - "src/components/automations/zapsign-trigger-config.tsx"
  - "supabase/migrations/1057_cb_zapsign.sql"
  - "supabase/migrations/zapsign-1057.test.ts"
---

# ZapSign — regras

Vale ao mexer na integração com o ZapSign (assinatura eletrônica): a conexão
e o webhook (`src/lib/zapsign/conexao.ts`, `cliente.ts`), o processamento de
uma assinatura (`processar.ts`, `casamento.ts`, `buscar.ts`), o cartão em
Integrações (`zapsign-card.tsx`) e o gatilho `zapsign_documento_assinado`. O
motor (`dispararAutomacoes`, `negocioAlvo`, condições) está em
`.claude/rules/automacoes.md`; os moldes são o Calendly
(`integracoes-calendly.md`: cadeado, log, "Processar de novo") e o Asaas
(`integracoes-asaas.md`: webhook autenticado pelo cabeçalho, criado só do host
público).

### Entrega 1 (1057): contrato assinado move o card

Decisão do operador (27/09/2026): o contrato nasce de DOIS jeitos, e os dois
movem o card — gerado pelo CRM pela API (o passo "Gerar contrato" vem depois,
com `external_id` = id do negócio) e assinado pelo link PÚBLICO do modelo (o
robô sem os dados completos, ou o funcionário mandando o link). A automação
que move o card é CONFIGURAÇÃO, criada pela aba Automações do funil: gatilho
"Documento assinado (ZapSign)" → condição "Negócio está na etapa…" → "Mover
card".

### O webhook

- ⚠️⚠️ **O ZapSign não assina com HMAC: a credencial é o cabeçalho
  `Authorization: Bearer <segredo>` que o CRM gera e informa ao criar o
  webhook** (`webhook_secret`, cifrado), comparado em TEMPO CONSTANTE
  (`tokenConfere`). O token da URL (`webhook_url_token`) só diz de QUAL conta é
  a entrega. 404 e 401 são as únicas recusas; o resto responde 200 com log e
  trabalha em `after()` (o ZapSign repete tudo o que não é 200).
- ⚠️⚠️ **O corpo é AVISO.** Dele saem o documento, o evento, quem assinou (só
  para a idempotência e o log) e as respostas do formulário. O que DECIDE —
  está completo? quem são os signatários? qual o negócio? — vem da RELEITURA
  `GET /docs/{token}/` com a nossa chave. As respostas são a exceção, e só como
  queda (a doc do "detalhar documento" não mostra `answers`): alimentam
  variável, nunca o casamento.
- ⚠️ **`doc_signed` chega a CADA signatário.** O documento só está completo
  com `status === "signed"` no DOCUMENTO; antes disso a entrega termina
  `incompleto` (não é erro — a assinatura seguinte completa).
- ⚠️⚠️ **Idempotência = `UNIQUE (account_id, doc_token, event_type,
  signer_token)` com `ignoreDuplicates`** (`signer_token` NOT NULL DEFAULT '':
  só índice TOTAL serve de `ON CONFLICT`). E há um SEGUNDO cadeado, o do
  DISPARO (`cb_zapsign_documentos.disparo_evento_id`, UPDATE `… IS NULL`): duas
  assinaturas quase simultâneas releem o MESMO documento já completo, e só a
  que o escreve dispara (a outra termina `ignorado`). Nenhuma automação rodou
  (escopo barrou tudo) = o cadeado volta.
- ⚠️⚠️ **O webhook só é criado (e reativado) a partir do PRÓPRIO host público**
  (`podeCriarDaqui` do Asaas): o `.env.local` do preview carrega a URL da
  produção, e criar dali registraria no ZapSign um endereço que só atende
  depois do deploy. Conectado de outro lugar, o webhook fica `ausente` e o
  cartão fica vermelho, com "Reativar". O ZapSign NÃO tem rota de listar
  webhooks: o `webhook_id` guardado é a única memória — reconectar com o MESMO
  token mantém o webhook; token de outra conta apaga o antigo com o token
  ANTIGO. Desconectar apaga no ZapSign (`webhookNaoApagado` manda apagar pelo
  painel).
- A entrega além do balde por conta é GRAVADA sem processar (`recebido`), não
  descartada: não há ciclo que a reconcilie depois.

### O casamento (`casamento.ts`, puro; `buscar.ts`, I/O)

- **Ordem**: o negócio do `external_id` (uuid de um negócio DESTA conta) → o
  negócio que o CRM registrou para o documento (`cb_zapsign_documentos.deal_id`,
  o passo futuro) → a cascata pelos SIGNATÁRIOS: telefone → e-mail → CPF.
  Id de negócio de outra conta cai na cascata.
- ⚠️⚠️ **NUNCA cria contato.** Sem casamento, `sem_contato` com o motivo; o
  operador arruma a ficha e clica em "Processar de novo". Assinatura não é lead.
- ⚠️⚠️ **Ambíguo é "não sei"**: dois contatos DIFERENTES no mesmo nível (o
  cliente e o advogado assinando, os dois com ficha) param a cascata em
  `sem_contato` — descer para o e-mail escolheria um deles por um critério mais
  fraco, e mover o card errado manda a mensagem ao cliente errado.
- ⚠️ **Telefone pela régua das telas** (`telefoneDigitado`) e casado pela
  grafia CANÔNICA (`contacts.telefone_canonico`, a chave única da 1024) — nunca
  pelos 8 finais. O número de uma CONEXÃO da conta não casa (a cerca do Asaas).
- **E-mail** sem caixa (ILIKE escapado + conferência exata em JS). **CPF** só
  na conta que tem o campo `field_key = 'cpf'`, dígitos contra dígitos.
- ⚠️ **Só no casamento EXATO o card vai no contexto** (`deal_id` +
  `deal_status_fixado` = o status visto, que a escrita confere). Na cascata, o
  motor escolhe o card por `negocioAlvo`, como sempre — por isso a condição de
  etapa antes do "Mover card" é o que protege os outros cards do contato.

### O processamento e o log

- **Cadeado da entrega**: gêmeo do Calendly (`src/lib/zapsign/claim.ts`, de
  propósito não fatorado) — `UPDATE … RETURNING`, cerca de posse em toda
  escrita, teto (4 min) menor que o recolhimento (10 min), com teste da margem.
- ⚠️ **Falha ANTES do disparo grava `recebido`** (reprocessável), com o motivo:
  releitura que falhou, banco fora, automação não lida. `falhou` fica para o
  que pode ter rodado. "Processar de novo" só aceita `RESULTADOS_REPROCESSAVEIS`
  (`recebido`, `sem_contato`, `incompleto`, `sem_automacao`) e RELÊ o documento.
- ⚠️⚠️ **Nenhum número de documento pessoal vira variável nem vai ao log**
  (`pareceDocumentoPessoal`: rótulo de CPF/RG/CNPJ/CNH… ou valor com forma de
  CPF/CNPJ, menos quando o rótulo diz telefone). As variáveis vão a mensagem,
  campo e webhook de saída.
- `RESULTADOS_DO_EVENTO` e `CASADO_POR` (`log.ts`) são ESPELHO dos CHECKs da
  1057 (pino `supabase/migrations/zapsign-1057.test.ts`); código de erro novo
  entra em `CODIGOS_CONHECIDOS` do cartão e nos dois dicionários (pino
  `zapsign-card.test.ts`, que colhe os códigos dos tipos).
- **Sandbox do ZapSign é outra conta** (outra URL e outro token): não é
  suportado, e nunca neste banco (o `.env.local` é a produção).
