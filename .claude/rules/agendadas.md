---
paths:
  - "src/lib/scheduled/**"
  - "src/app/api/cb/scheduled/**"
  - "src/components/scheduled/**"
  - "src/app/*/agendadas/**"
  - "src/hooks/use-agendadas*"
  - "src/hooks/use-acoes-da-agendada*"
  - "src/hooks/use-citadas-da-agendada*"
  - "src/hooks/use-agendador-saude*"
  - "src/components/inbox/scheduled-bar.tsx"
  - "src/app/api/v1/scheduled-messages/**"
  - "src/lib/api/v1/scheduled*"
---

# Agendadas — regras

Vale ao mexer em mensagem agendada: `cb_scheduled_messages`, o disparador
(`src/lib/scheduled/dispatch.ts` e o cron), a rota `/api/cb/scheduled`, a faixa
do fio (`ScheduledBar`), a tela `/agendadas` e a API v1 de agendadas. O
compositor que agenda está em `.claude/rules/inbox-conversa.md`; o bucket de
anexos, em `.claude/rules/midia.md`. O texto antigo, com a história, está em
`git show f5879b3f:CLAUDE.md`.

### Mensagem agendada (925/926): NADA dispara sozinho

- ⚠️ **Quem transforma a linha em mensagem é um agendador EXTERNO** batendo em
  `/api/cb/scheduled/cron` (laço do `docker-stack.yml`). Sem ele a tabela só
  enche — o destino de `broadcasts.scheduled_at`, viva e sem leitor desde a
  001.
- **Agendar não passa pela janela de desfazer.** O desvio é a primeira coisa do
  `handleSend` (e do `sendDraft`, para anexo), antes de qualquer
  `setPendente`: a janela tem três saídas que disparam na hora (trocar de
  conversa, desmontar, Enter de novo) e mandaria em 3 s a mensagem marcada
  para amanhã.
- ⚠️ **`failed` NÃO quer dizer "não saiu".** `db_error` e tempo esgotado da
  Evolution estouram DEPOIS de o WhatsApp aceitar — daí `entrega_incerta`
  (`CODIGOS_POS_ENTREGA` = `db_error` + `evolution_error`). `evolution_rejected`
  (4xx: a Evolution recusou) fica DE FORA — nada saiu, e é por isso que a 932
  separou os dois. Nada reenvia a partir de incerta nem de `sending`: retentar
  manda duas vezes ao cliente. Todo caminho novo de reenvio usa a mesma
  guarda (`podeDispararAgora`).
- ⚠️ **`failed` e `entrega_incerta` se contam SEPARADAS e DISJUNTAS.** A
  incerta vem sempre junto de `failed`: somar as duas cruas conta a mesma linha
  duas vezes, e as ações são opostas (reenviar o que falhou é seguro; o incerto
  chega em dobro).
- **O canal é FIXADO no agendamento e falha fechado** (`channelId` do núcleo).
  O núcleo degrada em silêncio para o padrão da conta, e numa agendada isso é a
  mensagem saindo pelo número errado, de madrugada, sem ninguém na tela.
- ⚠️ **Grupo lê `cb_groups.channel_id`**, nunca `conversations.channel_id`,
  que é sempre NULO em grupo. Vale na rota interna e na API v1.
- **Guarda de atraso de 1 h no worker.** Agendador dias fora do ar + conserto
  despejaria a fila inteira de uma vez, às 2 da manhã. Passado o prazo a linha
  vira `failed` com o motivo escrito e espera decisão de gente.
- ⚠️ **A agendada sai COM `sender_id`** (o `created_by` de quem a criou, dias
  antes). Quem medir "resposta de gente" a exclui pela proveniência
  `cb_scheduled_messages.message_id` (índice da 970) — pela coluna sozinha ela
  conta como resposta humana (é o que o Radar faz).
- Conexão com agendada na FILA não se apaga: o `DELETE /api/cb/channels/[id]`
  barra, porque a FK da 925 é RESTRICT.
- API v1: `scheduled_for` exige OFFSET escrito (`Z` ou `±HH:MM`). Sem ele o
  Postgres lê como UTC e a mensagem sai 3 h fora, sem erro nenhum.
- `useAgendadorSaude`: batimento ilegível cai em `nuncaRodou`, que ACENDE o
  aviso — a sonda do agendador nunca afirma "em ordem" sem batimento.

### Agendada com ANEXO e CITAÇÃO (932)

Tudo aqui existe porque passam HORAS entre escrever e enviar.
`src/lib/scheduled/midia.ts` (puro, com teste), `dispatch.ts`, a rota
`api/cb/scheduled` e `src/components/scheduled/anexo-e-citacao.tsx`.

- ⚠️ **Áudio NÃO leva legenda.** A nota de voz sai por `sendWhatsAppAudio`, sem
  campo de legenda: o texto seria gravado em `content_text`, apareceria no fio
  para a equipe e não viajaria. A regra está em TRÊS lugares de propósito
  (CHECK da 932, rota, tela) — não "enxugar" para um só.
- ⚠️ **O arquivo é conferido ANTES de reivindicar a linha.** Reivindicar põe em
  `sending`, de onde nada é reenviado: a linha ficaria presa até o recolhimento
  de 10 min e sairia como "entrega incerta", que seria mentira. E **Storage
  fora do ar não conta como "sumiu"** — falso negativo cancelaria uma mensagem
  perfeita. `anexoAindaExiste` segue a regra do `storage.exists()` da raiz
  (`data === false` antes do `error`; try/catch, porque 5xx é LANÇADO).
- ⚠️ **A URL do anexo é DERIVADA do caminho (`getPublicUrl`), nunca aceita do
  cliente.** Aceitando-a, a posse seria conferida em `media_path` e o envio
  usaria `media_url`: daria para casar caminho legítimo da conta com URL de
  fora, e o CRM entregaria aquilo ao cliente.
- ⚠️ **Cancelar apaga o objeto do bucket — MENOS quando há `message_id`.** O
  teste é a COLUNA, e ela vem do RETORNO do `delete`, não da lista da tela: o
  worker pode ter enviado entre a carga e o clique, e aí o arquivo é da
  mensagem que está no fio do cliente. No compositor, `entreguesRef` impede a
  limpeza de desmonte de apagar arquivo que já é de uma agendada.
- Vários anexos agendados = uma linha por anexo; só o que falhou fica na tela.
- ⚠️ **`reply_to_message_id` não tem FK, de propósito**: `RESTRICT` faria apagar
  mensagem falhar, `CASCADE` apagaria a agendada, `SET NULL` apagaria a
  informação de que houve citação. Sem FK o PostgREST não embute: a citada é
  buscada por id (`useCitadas`) e precisa do sinalizador de "já carregou",
  senão a tela avisa "citação apagada" sobre citação viva.
- ⚠️ **Apagar mensagem é apagar MOLE** (`deleted_at`): citar exige conferir a
  coluna, e o núcleo (`send-message.ts`) não confere — ver
  `.claude/rules/whatsapp-envio.md`.
- **O teto da legenda é 1024 MENOS a assinatura**, e a validação do agendamento
  não garante nada: a assinatura pode ser ligada depois, ou quem agendou sai da
  conta e passa a assinar o nome do escritório. Por isso o núcleo revalida e o
  disparador **traduz** — `SendMessageError.message` é inglês e cairia cru na
  coluna que as duas telas mostram.

### A tela global de agendadas (`/agendadas`)

Irmã da faixa do fio, não substituta. `src/hooks/use-agendadas-da-conta.ts`,
`src/lib/scheduled/tela-global.ts` (puro, com teste) e
`src/hooks/use-acoes-da-agendada.ts`.

- ⚠️ **"Executar agora" e "Cancelar" moram no HOOK, não na tela.** Elas mandam
  mensagem a cliente e apagam registro; duas cópias divergindo na guarda
  (`podeDispararAgora`) fazem o cliente receber duas vezes.
- ⚠️ **São TRÊS consultas.** Fila e acervo têm ordens opostas, e numa consulta
  só com teto o `ORDER BY` errado engoliria um dos dois inteiro. **Só as
  enviadas paginam**: a falha de meses atrás ainda espera decisão, e a
  paginação a empurraria para fora da tela.
- ⚠️ **O acervo ordena por `sent_at`**, não por `scheduled_for`: depois de um
  "Executar agora" as duas se separam de vez.
- ⚠️ **O canal exibido é o `channel_id` DA AGENDADA**, fixado no agendamento —
  aqui `canalDaConversa()` seria ERRADO, ao contrário do resto do projeto.
- **Contagem de aba vem do `count: 'exact'`**, nunca de contar a lista
  carregada: com o acervo paginado, "Enviadas" diria 50 numa conta com 300.
- **Os números somem enquanto a carga falha.** Zeros ao lado das abas
  afirmariam "não há nada" logo acima da caixa que admite não saber de nada.
