# Plano — Lixeira de contatos (90 dias) e a mídia de quem sai

> **O que é este arquivo.** Guia retomável do pedido do operador de
> 22/10/2026: excluir contato continua só de admin; a ficha excluída vai para
> uma Lixeira por 90 dias, de onde pode voltar; quando sai de vez (prazo
> vencido ou "Excluir agora"), sai o que a exclusão de hoje já leva MAIS os
> arquivos de mídia do armazenamento (o que fica, e o que só o pedido de
> exclusão tira, está em B3). Editado a cada fase: ao iniciar uma, registra-se
> aqui a anterior (objetivo, arquivos, resultado MEDIDO).
>
> ⚠️ **Este documento envelhece.** Antes de decidir com base nele, confirme
> contra o código e o banco; divergência se corrige no mesmo PR.

- **Criado:** 2026-10-22 · **Medido contra:** `main` @ `1ce13937`, produção
  `hxnhakmyxyhalbsktzwe` (só leitura)
- **Fluxo:** decisões em aberto → worktree a partir de `main` → implementar →
  typecheck/lint/test (Node 22) → replay da migration no CI → prova de ida e
  volta num Postgres descartável com dado → aplicar com autorização do
  operador → preview 1440×900+ e 375 px → revisar 2× → PR.
- **Regras a abrir pela Read antes de mexer:** `contatos.md`, `supabase.md`
  (APAGAR CONTATO, carga em lote, SECURITY DEFINER, 1067), `midia.md`,
  `ingestao.md`, `automacoes-esperas.md`, `agendadas.md`, `inbox-lista.md`,
  `meu-dia.md`, `perfis.md`, `auth.md`, `deploy.md`, `api-v1.md`, `ui.md`,
  `i18n.md`.
- **Plano irmão:** `docs/PLANO-anotacao-com-anexos-e-edicao.md`. Peças
  COMPARTILHADAS (quem chegar primeiro ao `main` cria TODAS; o segundo só
  acrescenta os próprios citadores e a própria origem): a fila
  `cb_arquivos_a_apagar`, a função `cb_caminho_no_chat_media` (SQL + espelho
  TS + pino dos dois lados), a conferência universal "ninguém mais cita", o
  pino `arquivos-do-chat-media.chamadores.test.ts`, a drenagem no `after()`
  de `/api/cb/scheduled/cron` e a nota em `.claude/rules/supabase.md`.
- **Como foi revisado (22/10/2026):** o rascunho passou por seis frentes
  independentes (o que a restauração dispara, mecânica SQL, mídia
  compartilhada, integrações que recriam a ficha, permissões e telas, LGPD e
  operação), cada uma com um cético: 61 achados confirmados e 12 lacunas de um
  crítico de completude. O texto reescrito passou por mais três revisores
  (fatos contra o código, cobertura dos achados, coerência com o plano irmão):
  39 correções, todas incorporadas.

---

## Estado

| Fase | Escopo | Estado | Migration | PR |
| --- | --- | --- | --- | --- |
| **0** | Estudo, medição, revisão adversarial, decisões | ✅ 22/10/2026 (este arquivo) | — | — |
| **1** | Portas dos fundos: o atendente deixa de apagar conversa e mensagem pelo navegador | ✅ aplicada em 23/10/2026 e mesclada | `1096_cb_atendente_nao_apaga_conversa` (RESTRITIVA, mas nada do app usa o que tira: vale antes ou depois do deploy) | #428 |
| **2** | A Lixeira: banco (mover, prévia, restaurar, excluir agora, vencimento, fila de arquivos), tela (prévia, Lixeira, Desfazer) e a doc do B6 (`docs/public-api.md` e Configurações → API → Documentação) | ✅ aplicada em 23/10/2026 (antes do deploy); e2e no preview com fichas fictícias | `1097_cb_lixeira_de_contatos` (ADITIVA) e `1098_cb_lixeira_conferencia` (a prova de ida e volta) | #429 |
| **3** | Depois do deploy da 2: derrubar a policy `contacts_delete` e o privilégio (só a Lixeira, as funções e o service role apagam) | ⏳ rascunho provado no descartável | `1099_cb_so_a_lixeira_apaga_contato` (RESTRITIVA: DEPOIS do deploy) | — |
| **4** | Ficha nova da mesma pessoa: faixa "há uma ficha desta pessoa na Lixeira" e "Restaurar e unir" | ⏳ em implementação (desenho abaixo) | ADITIVA, `1100` | — |
| **5** | O 410 da API e o roteiro interno de pedido de exclusão (LGPD) | ✅ o roteiro está abaixo; o 410 NÃO se aplica: B6 escolheu a volta com o MESMO id (a doc da API diz) | — | — |

### Fase 1 — registro (22/10/2026)

- **Objetivo:** tirar do navegador o DELETE de `conversations` e `messages`.
- **Arquivos:** `supabase/migrations/1096_cb_atendente_nao_apaga_conversa.sql`
  (sai `conversations_delete`; `messages_modify` FOR ALL vira `messages_insert`
  + `messages_update` com o mesmo predicado da 1032; REVOKE DELETE de
  `authenticated` e `anon`; conferência pelo catálogo), o pino
  `supabase/migrations/portas-dos-fundos-1096.test.ts`, a nota em
  `.claude/rules/contatos.md` e o item 16 da §6 de `docs/MERGE-UPSTREAM.md`.
- **Medido no Postgres 16 descartável** (dono das tabelas sem superusuário e
  sem BYPASSRLS, as policies vigentes da produção): ANTES, o atendente apagava
  a conversa; DEPOIS, atendente e admin recebem 42501 ao apagar conversa ou
  mensagem direto, o atendente segue inserindo, editando e lendo mensagem, o
  admin apaga a FICHA e o CASCADE leva conversa e mensagens, o service role
  segue apagando; a migration aplicada duas vezes dá o mesmo resultado.
- **Revisão adversarial (2 revisores):** a migration passou a travar
  `messages` ANTES de `conversations` (`LOCK TABLE`, a ordem da ingestão: na
  inversa, um INSERT de mensagem em voo seria abortado pelo detector de
  deadlock); o `supabase/ci/verify-schema.sql` confere o catálogo no FIM do
  replay (provado verde no banco migrado e vermelho com o DELETE devolvido);
  o pino aceita nomes entre aspas (`"public"."messages"`).
- **Testes:** suíte inteira verde no Node 22 (735 arquivos, 11.401 testes),
  lint e typecheck limpos.

### Fase 2 — registro (23/10/2026)

- **Objetivo:** a Lixeira de 90 dias inteira (B1–B6): mover com prévia,
  "Desfazer", restaurar (com identidade ocupada bloqueando), excluir agora
  (com a marca de pedido de exclusão), vencimento e a fila de arquivos.
- **Migrations:** `1097_cb_lixeira_de_contatos` (ADITIVA: antes do deploy;
  tabelas, RPCs, gatilhos calados por `WHEN`, default-deny, conferência de
  catálogo) e `1098_cb_lixeira_conferencia` (só a prova de ida e volta,
  separada para não rodar sob a trava exclusiva das ALTERs).
- **App:** `src/lib/contacts/lixeira.ts` (puro), `use-lixeira.ts`,
  `mover-para-lixeira-dialog.tsx`, `/contacts/lixeira`, a marca B4 no quadro
  e no formulário do funil, a régua `restaurada_em` no tempo real, a trilha,
  a fila (`src/lib/storage/arquivos-a-apagar.ts`, espelho
  `caminho-no-chat-media.ts`) e o ciclo de manutenção do cron.
- **Medido** no Postgres 16 descartável com o esquema da produção: ida e
  volta idêntica (800 mensagens, uma linha em cada tabela do fecho e em cada
  ponteiro); recusas, portas, pares, "Desfazer" pelo lote, exclusão com
  pedido, fila e vencimento; 25 fichas com 3.000 mensagens em 1,3 s para
  mover e 0,3 s para restaurar, com o volume da produção.
- **Revisão independente:** nenhum P0/P1; 7 P2 corrigidos (a régua do tempo
  real com `gravada_em` nulo — 72% da produção —, o pedido de exclusão mais
  completo, a linha engolida por conflito como ressalva, o pino de gatilho
  novo, a prova fora da trava, a corrida de conta no mover).
- **Achado de hoje:** a exclusão crua estoura 23503 com robô parado numa
  pergunta da conversa (o CASCADE anula `flow_runs` em três passos); a
  Lixeira anula os ponteiros antes do DELETE (`cb_lixeira_anular`).
- **Aplicada** em 23/10/2026, antes do deploy (1097 e 1098; a 1098 passou na
  produção sem deixar linha). **e2e no preview** com duas fichas fictícias
  (a produção, pelo `.env.local`): prévia com a tarefa aberta, mover pelo menu
  e pela seleção, "Desfazer" do toast, restaurar pela Lixeira (ficha, tarefa e
  os eventos da trilha de volta), identidade ocupada bloqueando o Restaurar
  (B2) e "Excluir agora" com e sem o pedido (com ele, a trilha perde o nome).
  Falta o e2e com conversa e mensagens, depois do deploy.
- **PR:** #429.

### Fase 4 — desenho ("Restaurar e unir")

- **Faixa (só admin)** na conversa e na ficha nova cujo telefone canônico,
  BSUID ou `instagram_id` casa com um item da Lixeira (os índices da 1097
  nessas três colunas): "Há uma ficha deste número na Lixeira, movida em …
  por …, com N mensagens" + "Ver na Lixeira" + "Restaurar e unir".
- **Restaurar e unir**, numa transação, admin: (1) trava o item; (2) dá à
  fotografia uma identidade PROVISÓRIA que não colide (BSUID de reserva,
  telefone e Instagram nulos — o `contacts_identidade_ck` exige uma); (3)
  restaura pelo miolo de sempre; (4) `cb_unir_fichas(fica = a nova, sai = a
  restaurada)`, com a prévia da união antes do botão; (5) limpa a reserva se
  ela tiver passado para a nova (a união leva o BSUID da que sai quando uma
  não tem telefone). A trilha conta as duas coisas (`contact_restored` e
  `contacts_merged`).
- **Riscos a provar no descartável:** o BSUID de reserva nunca ficar na ficha
  nova; a regra D7 de cards da união (o card repetido no mesmo funil é
  apagado) — a prévia mostra; conversa nas duas → mensagens mescladas.

### Fase 5 — roteiro interno do pedido de exclusão (LGPD)

Para quem recebe o pedido do titular. Não é parecer jurídico: a lista de B3
continua PROPOSTA até quem responde pela LGPD no escritório confirmar.

1. **Registrar o pedido** fora do CRM (quem pediu, quando, por qual canal),
   sem copiar dado pessoal para o registro além do necessário.
2. **Achar todas as fichas da pessoa:** busca por telefone (as duas grafias do
   nono dígito), e-mail e nome; o aviso de possível duplicata; fichas unidas
   (o histórico da ficha mostra "fichas unidas"); a Lixeira.
3. **Mover cada ficha para a Lixeira** e, na Lixeira, **Excluir agora** com a
   caixa "É pedido de exclusão do titular". Sai: a ficha, a conversa, as
   mensagens, tarefas, anotações, os arquivos (no ciclo seguinte do servidor,
   ~15 min), os dados dela nos eventos de webhook e do Calendly, o conteúdo
   das execuções, as ligações e mensagens retidas do telefone, e o nome no
   histórico.
4. **O que FICA no CRM** (dado do escritório ou obrigação, a confirmar):
   negócios com o título, cobranças e cadastro do Asaas, documentos do
   ZapSign, reuniões e transcrições, falas da pessoa em grupos. Decidir caso a
   caso; apagar à mão pela tela de cada módulo, se for o caso.
5. **Fora do alcance do CRM:** cópias de segurança do Supabase (somem quando o
   período de retenção vence), a Evolution (conversas no aparelho e na
   instância das conexões por QR code), e o que terceiros já receberam
   (Asaas, ZapSign, Calendly, Atlas, tl;dv, n8n/Make, e-mails, planilhas).
   Pedir a exclusão em cada um que tiver o dado.
6. **Cache do armazenamento:** conferir no painel do Supabase se o Smart CDN
   invalida ao apagar antes de afirmar prazo ao titular.
7. **Responder ao titular** dizendo o que foi apagado e o que ficou (e por
   quê), sem afirmar eliminação total.

## O pedido (22/10/2026)

"Apagar a mídia do contato apagado, porém só permitir o administrador excluir
contato. E ainda assim manter o contato em uma Lixeira por 90 dias contra
exclusões sem querer."

## Como é hoje (medido em 22/10/2026)

**Quem apaga contato**
- Só admin, desde a 981: `useCan('delete-contacts')` (`canDeleteContacts`) na
  tela e a policy `contacts_delete` = `is_account_member(account_id,
  'admin')` (conferida na produção).
- O único caminho do app é a tela de Contatos, arquivo do upstream: uma ficha
  (`.delete().eq('id')`) e a seleção múltipla (`.in('id', ids)`, 25 por
  página). O resultado se mede por `lerExclusao` (`src/lib/contacts/exclusao.ts`)
  e pela conferência `aindaExistentes`, local da página
  (`src/app/(dashboard)/contacts/page.tsx`). A confirmação diz só "Esta ação
  não pode ser desfeita".
- Não apagam contato: o painel do inbox, a ficha de `/contatos`, a API v1
  (só GET/POST/PATCH), o `mcp-server` e as rotas de servidor.
- Funções SQL que apagam: `cb_unir_fichas` (a ficha que sai, depois de mover
  tudo para a que fica), `cb_kommo_desfazer` (só a ficha intocada da carga,
  SQL manual), `merge_duplicate_contacts` (do upstream, recriada na 0922; sem
  chamador e fechada ao navegador na 0915, mas executável por service_role) e
  o CASCADE de conta apagada.
- ⚠️ **Portas dos fundos (conferidas na produção):** `conversations_delete`
  deixa o perfil ATENDENTE (`agent`) apagar conversa, e com ela todas as
  mensagens, pelo navegador; `messages_modify` (FOR ALL, `agent`) deixa
  apagar mensagem. Nenhuma tela faz isso, mas o banco permite.

**O que uma exclusão leva** (FKs conferidas na produção)
- Some junto (CASCADE), a partir da ficha (13 FKs): `conversations`,
  `contact_tags`, `contact_custom_values`, `cb_tasks`,
  `cb_conversation_notes`, `cb_automation_reminders`,
  `cb_contatos_relacionados` (as duas pontas), `cb_atlas_recusas`,
  `cb_duplicatas_descartadas` (as duas pontas), `cb_contatos_antigos` e
  `cb_fichas_unidas`. A partir da conversa (9): `messages`, `notifications`,
  `cb_scheduled_messages`, `cb_conversation_notes`, `cb_ia_turnos`,
  `cb_conversa_aberta`, `cb_conversation_favorites`,
  `cb_conversation_insights`, `message_reactions`. A partir da mensagem (2):
  `cb_message_media_ref`, `message_reactions`. Segundo nível:
  `notifications` também some pela tarefa.
- Fica com ponteiro NULO (SET NULL): 18 FKs para a ficha (`deals`,
  `cb_meetings`, `cb_lead_events`, `notifications`, `automation_logs`,
  `automation_pending_executions`, `flow_runs`, `broadcast_recipients`,
  `cb_automation_events`, `cb_webhook_eventos`, `cb_calendly_eventos`,
  `cb_asaas_clientes`, `cb_asaas_regua_envios`, `cb_atlas_clientes`,
  `cb_zapsign_documentos`, `cb_zapsign_eventos`, `cb_reunioes_da_kommo`,
  `cb_reunioes_transcritas`), 5 para a conversa (`deals`, `cb_meetings`,
  `cb_ligacoes`, `flow_runs`, `ai_usage_log`), 6 para a mensagem
  (`messages.reply_to_message_id`, `cb_ia_turnos` ×2, `cb_ligacoes`,
  `cb_mensagens_sem_telefone`, `flow_runs`) e, no segundo nível,
  `cb_contatos_antigos.fusao_id` e `ai_usage_log.turno_id`.
- A conversa de GRUPO nunca tem `contact_id` (CHECK): não entra no CASCADE da
  ficha, nem sai nem volta com ela.
- ⚠️ **Defeito de hoje:** as esperas de automação da ficha apagada NÃO param.
  O cron de 15 s as retoma com `contact_id` nulo: os passos de mensagem
  falham, mas mover card, chamar webhook e mandar para número fixo rodam. A
  união já resolve isso para si (`interrompida_por = 'fusao'`, 1093). Na
  produção: 150 esperas pendentes, nenhuma sem contato hoje.

**Mídia e armazenamento**
- Nada apaga arquivo: `remove()` do `chat-media` só existe no acervo e no
  descarte do compositor e da agendada (a marca usa outro bucket); nada
  varre o bucket.
- As 6.513 mensagens com arquivo apontam para o `chat-media` público da
  própria conta, na raiz `account-<conta>/` (e 1 em `inbound/`). Nenhum
  caminho é citado por duas MENSAGENS, nem por passo de automação, nem por
  modelo; a agendada enviada cita o mesmo objeto da mensagem que gerou. O
  bucket tem 6.946 objetos, 1,72 GB.
- Outras citações ligadas à ficha: `cb_scheduled_messages.media_path` e a
  foto (`contacts.avatar_url`, em `account-<conta>/avatares/`; numa ficha que
  ficou de uma união, o nome do arquivo pode ser o id da que saiu). Nem toda
  `media_url` é do bucket: a API v1 e o envio aceitam URL externa, e o robô
  usa o `flow-media`.

**Escala e limites**
- 6.292 contatos; mensagens por conversa: média 42, p99 469, máximo 797.
- `statement_timeout` de 8 s para `authenticated` (o navegador); sem teto para
  `service_role`.
- No tempo real: `messages`, `conversations`, `cb_conversation_notes`,
  `cb_tasks`, `message_reactions`, `cb_lead_events`, `cb_meetings`,
  `notifications`, `flow_runs`, `cb_conversa_aberta`, `cb_channels` e
  `member_presence`. Calar gatilho NÃO cala o tempo real.
- Registros que precisam voltar, por tamanho: 433 travas de lembrete, 8
  vínculos de relacionados, 3 uniões, 1 contato antigo; agendadas: 2
  pendentes (1 com arquivo) e 35 enviadas; 1 tarefa recorrente com contato.
- Zero negócios sem contato: nenhuma exclusão recente levou card.
- Quando o cliente escreve depois da exclusão, a ingestão cria ficha NOVA
  (Evolution `findOrCreateContact`, Meta pelo BSUID e pelo telefone,
  Instagram pelo `instagram_id`), com conversa e card novos. A identidade é
  única por conta: chave canônica do telefone (1024), BSUID (1038),
  Instagram (0989).

## Decisões do operador (22/10/2026)

- **L1.** Excluir contato continua SÓ de admin. Já é assim; os caminhos novos
  seguem a mesma régua, e as portas dos fundos se fecham.
- **L2.** A ficha excluída vai para uma Lixeira por 90 dias, de onde pode ser
  restaurada.
- **L3.** Quando sai de vez, a mídia das mensagens dela sai do armazenamento.

## Decisões B1–B6 (22/10/2026: as seis recomendações ACEITAS pelo operador)

Ficam escritas como foram propostas; o "Recomendado" de cada uma é o
decidido.

- **B1. Como a Lixeira guarda.** *Recomendado: FOTOGRAFIA.* Ao mover, uma
  função copia a ficha e tudo o que a exclusão levaria para uma linha da
  Lixeira, anota os ponteiros que ficariam nulos e só então apaga, como hoje.
  Para o resto do CRM a ficha não existe: automação, robô, agendada, disparo,
  IA, API e integrações seguem sem mudança. A alternativa (MARCAR e esconder)
  obrigaria CADA leitura do CRM a filtrar, e a ficha marcada continuaria
  ocupando o telefone nos índices únicos: a mensagem do cliente cairia nela,
  ou, filtrada, bateria no 23505 e poderia se perder. O custo da fotografia
  está na restauração, e a revisão o mapeou inteiro (Desenho).
- **B2. A identidade já está em uso por outra ficha.** É o caso MAIS COMUM,
  não a exceção: a equipe escrevendo pelo celular, o cliente, o Calendly, o
  webhook de entrada e a API recriam a ficha em horas. *Recomendado nesta
  fase: restaurar BLOQUEIA, e o item da Lixeira mostra "identidade ocupada
  pela ficha X", com link; o operador decide se o vencimento desse item
  espera ou segue.* ⚠️ Até a Fase 4 ("Restaurar e unir"), nesse caso a
  Lixeira NÃO devolve o histórico: nenhuma tela mostra a fotografia, e a
  única saída é mandar a ficha nova também para a Lixeira (o que esconde as
  mensagens recentes) e restaurar a antiga.
- **B3. "Excluir agora" e pedido de exclusão (LGPD).** *Recomendado: o admin
  tem "Excluir agora", com confirmação forte e uma marca "é pedido de
  exclusão".* Sem a marca, e no vencimento, sai o que a exclusão de hoje
  leva mais os arquivos. Com a marca, sai também o que a lista abaixo disser.
  Proposta, a confirmar com quem responde pela LGPD no escritório:
  - **apagar:** os payloads de `cb_webhook_eventos` e `cb_calendly_eventos`
    da ficha, `automation_logs` (contexto), `cb_ligacoes` e
    `cb_mensagens_sem_telefone` pelo telefone e pelos LIDs da fotografia;
  - **anonimizar, sem apagar linhas:** `cb_lead_events` da ficha
    (`contact_label` e o nome ou telefone do payload). Apagar contrariaria a
    912, que preserva o rastro para que "apagar contato não vire o jeito de
    apagar o rastro", e tiraria dos negócios mantidos a trajetória que o funil
    por período conta;
  - **manter (obrigação ou dado do escritório):** negócios (sem contato),
    cobranças do Asaas (o Asaas regrava os dados a cada ciclo; anonimizar
    aqui não adianta), documentos do ZapSign;
  - **decidir:** reuniões, transcrições de reunião e as falas do cliente em
    grupos (8 conversas, 572 mensagens com remetente, achadas pelo
    `group_sender_jid`; não saem nem voltam com a ficha).
  O "Excluir agora" nunca afirma eliminação total: backups, a Evolution e o
  que terceiros já baixaram ficam fora do alcance do CRM.
- **B4. Negócios da ficha.** *Recomendado: ficam no funil sem contato, como
  hoje, com a marca "contato na Lixeira" no card, e voltam a apontar para a
  ficha na restauração.* Durante a Lixeira, mover o card em branco dispara
  `deal.*` sem contato, e a automação de etapa que precisa de contato não
  roda; a marca avisa, e o relatório da restauração lista os movimentos cuja
  automação não rodou (`cb_automation_events` dos negócios reapontados, entre
  o mover e o restaurar), para o "Executar automação", e as assinaturas do
  ZapSign em `sem_contato`, para o "Processar de novo". Alternativa: os
  negócios vão junto para a Lixeira (some o card; reinserir exige calar a fila
  do funil).
- **B5. "Desfazer" no aviso.** *Recomendado: sim.* É a defesa mais barata
  contra o engano percebido na hora: o aviso de "movida para a Lixeira" tem
  "Desfazer" por alguns segundos, só para quem moveu, e chama a MESMA
  restauração (no lote, desfaz a chamada inteira).
- **B6. API v1 para o id de uma ficha na Lixeira.** *Recomendado: continua
  404, e a doc diz que a ficha pode voltar com o mesmo id em até 90 dias.* Um
  410 próprio (`contact_in_trash`) evitaria a recriação, mas é código novo no
  contrato publicado: o cenário do Make da agência não o trata e desliga no
  primeiro erro inesperado, e o 404 é o que ele já recebe hoje para ficha
  apagada. A doc muda na Fase 2, quando o contrato muda.

**Padrões propostos** (valem enquanto o operador não disser o contrário):
- Tela própria `/contacts/lixeira`, só admin, com botão no cabeçalho de
  Contatos.
- Sem aviso de vencimento; a tela mostra os dias restantes e "vencida,
  aguardando limpeza".
- A conversa restaurada volta COMO ESTAVA (aberta ou encerrada; precedente
  do desfazer da 1018), sem aviso de atribuição; responsável que saiu da conta
  ou está suspenso volta nulo.
- Agendada `pending` volta como `failed` (`entrega_incerta = false`), com o
  motivo "voltou da Lixeira — envie ou cancele". Agendada `sending` (o worker
  já a reivindicou: PODE ter saído) volta como `failed` com
  `entrega_incerta = true` e o motivo "estava saindo quando a ficha foi para a
  Lixeira: pode ter chegado ao cliente; confira a conversa", sem reenvio
  (`podeDispararAgora` a recusa). Nada sai sozinho, e ninguém perde o que
  agendou.
- Tarefa recorrente volta ativa; o gerador cria a ocorrência do último prazo
  vencido, como faz com qualquer atraso.
- Rastro na trilha: `contact_trashed`, `contact_restored` e `contact_purged`,
  gravados por GATILHO na tabela da Lixeira (o app nunca escreve em
  `cb_lead_events`), com `cb_lead_events_event_type_check` e
  `cb_lead_events_shape` alargados ANTES e rótulos nos dois dicionários e na
  aba Histórico. O `contact_purged` vai sem dado pessoal (id, quem, quando,
  contagens).
- Exclusão em lote ganha um `lote_id`: "Restaurar o lote" na Lixeira e no
  "Desfazer"; a Lixeira tem busca.
- Os arquivos continuam abrindo pelo link nos 90 dias (a ficha some da tela,
  o link público não); fechar isso é o bucket privado, decisão própria.

## Desenho

### Regra de ouro: restaurar nunca manda nada ao cliente

E faz o mínimo de barulho na equipe. Cada tabela tem destino declarado, e o
pino cobra que toda FK do fecho tenha um:

| Destino | Tabelas |
| --- | --- |
| **Volta** (registro) | ficha, conversa (como estava), `messages`, `message_reactions`, `cb_conversation_notes`, `cb_tasks`, `contact_tags`, `contact_custom_values`, `cb_conversation_insights`, `cb_conversation_favorites`, `cb_message_media_ref`, `cb_atlas_recusas` (decisão de gente: sem ela, a leitura do Atlas religa o par desvinculado à mão), `cb_duplicatas_descartadas`, `cb_contatos_relacionados`, `cb_contatos_antigos`, `cb_fichas_unidas` |
| **Volta, porque TRAVA** | `cb_automation_reminders`: é o "já mandei" do lembrete (o INSERT é a reivindicação; o 23505 quer dizer "já disparou"). Sem ela, o lembrete dentro da janela (no máximo 1 h) sai de novo |
| **Volta com outro estado** | `cb_scheduled_messages` `pending` e `sending` → `failed` (padrões propostos) |
| **Não volta** | `notifications`, `cb_conversa_aberta`, `cb_ia_turnos` |
| **Reaponta** (UPDATE só da coluna do ponteiro, preservando `updated_at`, e só se ainda nulo) | `deals` (contato e conversa), `cb_meetings`, `cb_lead_events`, `cb_calendly_eventos` (mais o `invitee.canceled` chegado durante a Lixeira, religado pelo `invitee_uri`), `cb_atlas_clientes`, `cb_zapsign_*`, `cb_reunioes_*`, `cb_webhook_eventos`, `automation_logs`, `cb_ligacoes`, `ai_usage_log`, `cb_mensagens_sem_telefone` (e a religação dos LIDs retidos) |
| **Reaponta com condição** | `cb_asaas_clientes`: só se `vinculo_origem` for o da fotografia (não atropela decisão tomada durante a Lixeira); `cb_asaas_regua_envios`: só quando o `cb_asaas_clientes` do mesmo `asaas_customer_id` voltou para a ficha; `broadcast_recipients`: só o histórico (enviado, entregue, lido) |
| **Não reaponta** | `notifications.contact_id` (baixaria o número do sino), `automation_pending_executions` e `flow_runs` (encerradas ao mover), `cb_automation_events` (fila já drenada) |

### Mover para a Lixeira — `cb_mover_contatos_para_lixeira`

- **Porta do admin:** SECURITY DEFINER com `search_path` fixo; confere admin e
  suspensão (1067) e a conta de CADA ficha, recusando o lote inteiro se um id
  for de outra conta (membro de várias contas).
- **Travas antes da fotografia:** `FOR UPDATE` nas conversas da ficha, depois
  na ficha, e de novo nas conversas criadas entre as duas; no lote, ids em
  ordem. Sem isso, o que for gravado entre a fotografia e o DELETE some sem
  entrar na Lixeira.
- **Interromper o que está vivo**, no molde da `fusao` (1093): marcar as
  execuções com `interrompida_por = 'lixeira'` (alargar o CHECK da 1092 e o
  espelho TS), cancelar as `pending`, encerrar os `flow_runs`. Restaurar não
  religa nada. Isso corrige também o defeito de hoje.
- **Fotografia:** o fecho TRANSITIVO calculado pelo catálogo (toda tabela
  alcançada por CASCADE vira raiz da volta seguinte), por tabela, com
  `DISTINCT` pela PK; os ponteiros SET NULL do fecho inteiro; o `updated_at`
  dos negócios.
- **Varredura antes de apagar:** o fecho do catálogo tem de bater com a lista
  declarada; tabela desconhecida recusa com `lixeira_sem_tratamento`, como a
  `uniao_sem_tratamento`. Tabela nova com FK para QUALQUER tabela do fecho
  (ficha, conversa, mensagem, anotação, tarefa…) entra na União E na Lixeira
  no mesmo PR.
- **Sinal `cb.lixeira = 'movendo'`** (`set_config(…, true)`): o gatilho de
  anexos do plano irmão não enfileira (o CASCADE roda na mesma transação e vê
  o sinal). Depois, o `DELETE FROM contacts`, como hoje.
- **Contrato:** por id, `movida`, `sumiu` ou `recusada`, com os códigos que a
  tela já trata na união (42501, 55P03, 40P01) mais o 57014. A seleção poda
  só os resolvidos.
- **Teto de 8 s:** medir no descartável, com `SET ROLE authenticated`, a
  maior ficha (797 mensagens) e um lote de 25. Se não couber, a tela chama
  uma ficha por vez, com progresso e resultado por ficha.
- **Os outros caminhos que apagam** seguem sem Lixeira, por decisão:
  `cb_unir_fichas` (já levou o conteúdo para a que fica), `cb_kommo_desfazer`
  (só ficha intocada da carga) e `merge_duplicate_contacts` (sem chamador;
  documentada como fora).

### Restaurar — `cb_restaurar_contato`

- **Tudo o que pode recusar vem ANTES de escrever:** o item existe
  (`FOR UPDATE NOWAIT`: "em processamento"); a identidade está livre (chave
  canônica, BSUID, `instagram_id`; B2); o schema é compatível.
- **Schema que mudou em 90 dias:** a lista de cada INSERT é (colunas não
  geradas do catálogo) ∩ (chaves do JSON), por `EXECUTE format`; nunca
  `SELECT *` nem `jsonb_populate_record` cru (as duas colunas GERADAS de
  `contacts` fariam 100% das restaurações falharem; coluna nova perderia o
  DEFAULT). Tabela da fotografia que não existe mais é pulada e relatada;
  chave do JSON sem coluna (renomeada) entra no relatório; coluna NOT NULL
  sem default criada depois, tipo ou CHECK que recusa o valor antigo viram
  `lixeira_schema_mudou:<tabela>.<coluna>`, nunca o 23502 cru. Pino: migration
  com ADD COLUMN NOT NULL, ALTER TYPE, CHECK novo ou backfill numa tabela do
  fecho declara o que faz com as fotografias.
- **Gatilhos calados por SINAL, não por DDL:** `cb.lixeira = 'restaurando'`,
  lido no topo de cada função de gatilho que reagiria SEMPRE como
  `nullif(current_setting('cb.lixeira', true), '')` (como o `cb.cadeia`,
  gravado pela 0934/1031 e lido pela 1040): sem o `missing_ok` estoura em toda
  sessão que nunca o definiu, e sem o `nullif` a sessão do pool guarda `''`;
  um pino lendo o SQL cobra a forma. Nada de `ALTER TABLE … DISABLE
  TRIGGER`: ele trava `messages` e `conversations` (a gravação de mensagens de
  TODAS as contas espera) e, numa saída no meio, confirmaria com o gatilho
  desligado na produção. O inventário é pelo CATÁLOGO, default-deny: todo
  gatilho das tabelas do fecho e das reapontadas, declarado "calado" ou "pode
  disparar". Hoje, no INSERT: e-mail ×4 (1000/1001), atribuição (0027, aviso
  no sino), trilha da conversa criada (1083, por instrução), espera (972),
  janela da Meta (993), pausa da IA (1049), trilha das etiquetas (912) e
  trilha da união (1092, senão a união aparece duas vezes). Nas UPDATEs
  (reapontar e o UPDATE final da conversa): `set_updated_at` (a função do
  upstream `update_updated_at_column`, usada por ~12 tabelas → linha no
  MERGE-UPSTREAM) e `cb_conversa_mudou_na_trilha`. O título do card (1008) só
  reage a `UPDATE OF name` e não é tocado.
- **Alvo que sumiu em 90 dias** (canal, etapa, membro, etiqueta, campo): cada
  FK que sai do fecho segue o próprio ON DELETE: `n` anula só as colunas de
  `confdelsetcols` (nunca o `account_id`), `c` descarta a linha, `r`/`a`
  descarta e relata.
- **Posse:** `user_id` = `accounts.owner_user_id` na ficha e na conversa (dono
  durável, falha fechada); autor ou responsável que saiu da conta volta nulo.
- **Ordem:** ficha → conversa → mensagens → o resto; no fim, UM UPDATE da
  conversa com os próprios valores e `restaurada_em = now()` (coluna nova,
  para o tempo real; abaixo), que reassenta a linha nas abas abertas; e
  `contacts.updated_at = now()`, para a ficha restaurada não passar por
  "intocada" no `cb_kommo_desfazer`.
- **Pares** (relacionados, duplicata descartada): a outra ponta viva →
  reinsere; unida → segue o livro; ainda na Lixeira → a linha passa para a
  fotografia daquele item; apagada de vez → descarta e relata.
  `cb_contatos_antigos` que colide com outra ficha → pula e relata.
- **No fim:** a linha da Lixeira é APAGADA (o rastro fica na trilha), e a
  função devolve o relatório do que ficou de fora (inclusive o de B4); a tela
  o mostra, com os motivos traduzidos (teste lendo os dois dicionários).

### Tempo real: não se cala, e se trata na tela

- Reinserir uma conversa de 400 mensagens atravessa o tempo real para todas
  as abas abertas: a lista (`comMensagemNova`) soma +1 de não lida a cada
  INSERT, e o aviso do navegador dispara para a fala do cliente (um por
  conversa, pela `tag`). A régua de "antiga" de hoje
  (`(gravada_em ?? agora) − created_at > 1 h`) não pega a fala restaurada.
- **Mudança a fazer no navegador:** o ouvinte lê `conversations.restaurada_em`
  (o `SELECT_DA_CONVERSA`), e `silencioDoAviso` dá como antiga a mensagem com
  `gravada_em` anterior a ele; `comMensagemNova` usa a mesma régua para não
  somar não lida. Nunca comparar com o relógio do navegador (adiantado, ele
  calaria todos os avisos de toda conta) e nunca regravar `gravada_em = now()`
  (`clienteRespondeuDesde` leria a fala velha como resposta nova). Atualizar
  a nota em `.claude/rules/meu-dia.md` e o pino `aviso-no-navegador.test.ts`.
- O e2e confere isso numa SEGUNDA sessão com o inbox aberto e o aviso ligado.

### Excluir agora e vencimento

- **Duas portas, um miolo:** a do admin (`authenticated`, confere papel e
  1067) e a do vencimento (só `service_role`: REVOKE de PUBLIC, `anon` e
  `authenticated`, senão qualquer membro anteciparia o vencimento; autor
  "sistema").
- A linha da Lixeira só existe enquanto a ficha está nela (restaurar e excluir
  de vez a APAGAM): índice único TOTAL em `(account_id, contact_id)`; o item é
  travado (`FOR UPDATE SKIP LOCKED` no vencimento, `NOWAIT` na tela).
- Enfileira os arquivos da fotografia: mensagens, agendadas, foto pelo
  `avatar_url` e os anexos de anotação (`anexos[].caminho` das anotações da
  fotografia; ausente enquanto o plano irmão não estiver no `main`). Aplica
  B3 quando é pedido de exclusão, apaga a linha e deixa o rastro sem dado
  pessoal.
- **No `after()` de `/api/cb/scheduled/cron`, em sequência:**
  `gerarTarefasRecorrentes`, o vencimento (a função trata UM item da Lixeira
  por chamada, e o servidor a repete) e por último a drenagem (que já pega o
  que o vencimento enfileirou), sob UM prazo comum, definido num lugar só (o
  `after()` não tem o teto de 120 s do curl). Sem mudar o `command` do
  agendador.

### Arquivos: fila e conferência universal (as mesmas do plano irmão)

- **Fila `cb_arquivos_a_apagar`:** `account_id uuid NOT NULL` SEM FK para
  `accounts` (a linha sobrevive à conta apagada, para o arquivo sair),
  `origem` (`anotacao` | `lixeira`), `CHECK (bucket = 'chat-media')`, `CHECK
  (caminho LIKE 'account-' || account_id || '/%')`, índice único `(bucket,
  caminho)` com `ON CONFLICT DO NOTHING` em todo escritor (a mensagem e a
  agendada enviada citam o mesmo objeto). Fechada ao navegador.
- **`cb_caminho_no_chat_media(p_url, p_conta)`**, SQL IMMUTABLE com espelho
  em TS (pino lendo os dois lados): o que vem depois de
  `/object/public/chat-media/`, cortado no `?` e no `#`; NULL fora da guarda
  (`account-<p_conta>/`, sem `..` nem `%`, fora de `acervo/`). URL externa e
  `flow-media` ficam de fora. As colunas que já guardam CAMINHO
  (`media_path`, `anexos[].caminho`) se comparam direto.
- **Drenagem:** aplica a MESMA guarda ao `caminho` da fila, com o
  `account_id` da linha, antes do `remove()`; só apaga sob `account-<conta>/`,
  fora de `acervo/`, e só o que NINGUÉM cita na hora: `messages` (inclusive
  grupos, pelo caminho derivado), `cb_scheduled_messages.media_path`,
  `cb_media_library.media_path`, os passos de automação, os modelos, os
  anexos de anotação, `contacts.avatar_url` e as fotografias da própria
  Lixeira. O prefixo de cada origem (`notas/`, raiz, `avatares/`) é conferido
  na ENTRADA, não na drenagem compartilhada. Sem índice novo nos citadores por
  enquanto (medir de novo se crescer).
- Posse cercada (carimbo antes do trabalho), lote pequeno; erro soma
  tentativa e a linha para em 10 (a mesma regra do plano irmão). A linha some
  da fila quando o arquivo sai ou quando outro registro ainda o cita (quem
  cita enfileira de novo ao sair). A tela da Lixeira lê POR ROTA (a fila é
  fechada ao navegador) os arquivos parados da conta com `origem = 'lixeira'`.
- **Pino** `arquivos-do-chat-media.chamadores.test.ts` (default-deny), que
  acha a constante E o literal `'chat-media'`: quem grava URL ou caminho do
  bucket declara (1) a coluna que a drenagem confere como citação e (2), se a
  tabela está no fecho, que o purgar enfileira o arquivo.

### Portas fechadas (Fases 1 e 3)

- **Fase 1 (RESTRITIVA):** tirar o DELETE de `conversations` e de `messages`
  do navegador (a conversa só some pela ficha; mensagem, nenhuma tela apaga),
  depois de conferir no código que nada do app usa.
- **Fase 3 (RESTRITIVA, DEPOIS do deploy da Lixeira):** `DROP POLICY
  contacts_delete`. Uma aba aberta com o app antigo recebe 0 linhas, e o
  `lerExclusao` já diz "recusado". O pino reprova `.from('contacts').delete()`
  em `src/`.
- A lógica da tela mora num módulo nosso (`src/lib/contacts/lixeira.ts` + um
  hook); a página do upstream só o chama, com a linha na tabela do
  MERGE-UPSTREAM. Sem a policy, um merge que traga a página crua passa a
  dizer "recusado", nunca a apagar de vez.

### Tela

- **Mover para a Lixeira** (menu da linha e seleção, só admin): antes do
  botão, uma PRÉVIA (`cb_previa_da_lixeira`, só leitura) do que a exclusão
  cancela de COLEGAS: agendadas pendentes (de quem), esperas de automação,
  tarefas abertas (de quem), negócios abertos (funil e etapa), conversa aberta
  com responsável. Confirmação nova (sai o "não pode ser desfeita"); aviso
  com Desfazer (B5).
- **`/contacts/lixeira`** (já cai no `protectedPaths`, `startsWith('/contacts')`):
  lista por colunas próprias, com GRANT só delas para `authenticated` (a
  fotografia nunca vai à lista); identidade montada na tela com os campos
  crus (`identidadeDoContato`, nunca o BSUID); dias restantes por tique, com
  plural ICU; vazio ≠ carregando; busca literal (`ramoContem`); o aviso de
  identidade ocupada (B2); Restaurar, Restaurar o lote e Excluir agora.
- **Botão "Lixeira"** no cabeçalho de Contatos, só com `delete-contacts`:
  medir a 375 px (a fileira já tem três botões).
- **Card do funil** com a ficha na Lixeira: a marca de B4.
- **Textos que passam a mentir:** o poder no editor de perfis ("apagar a
  ficha leva a conversa…") e as duas confirmações.

### Faixa e "Restaurar e unir" (Fase 4)

- Faixa para admin na ficha nova cuja chave canônica do telefone, BSUID
  (`wa_user_id`) ou `instagram_id` casa com um item da Lixeira (as mesmas três
  chaves únicas de B2), por índice nessas colunas da Lixeira. Nunca pelo `@`,
  que muda e não é único.
- "Restaurar e unir": a identidade ocupada impede reinserir a antiga como
  está; o desenho (trazer as linhas para dentro da nova pela receita da
  `cb_unir_fichas`, com a prévia): "Fase 4 — desenho", no começo deste
  arquivo.

### Prova

- **Na migration:** a conferência CHAMA, num subbloco desfeito por SQLSTATE
  próprio (molde da 1093), cada função nova (mover, prévia, restaurar,
  excluir agora, vencimento) sobre uma ficha fictícia com conversa, mensagem,
  etiqueta e lembrete, numa conta que já existe, conferindo a ida e a volta;
  no banco vazio do replay, pula com `RAISE NOTICE`. Exercita cada função de
  gatilho recriada para ler `cb.lixeira`, com e sem o sinal. Confere por
  `has_function_privilege` que a porta do vencimento é só de `service_role`,
  e que o fecho do catálogo bate com a lista declarada.
- **No descartável, com dado:** IDA E VOLTA com pelo menos uma linha em cada
  tabela do fecho, comparando o `to_jsonb` de cada linha antes e depois; os
  tempos sob o teto de 8 s; duas sessões, inserindo uma mensagem durante o
  mover (ela espera e não some fora da fotografia sem relato); um
  `invitee.canceled` gravado durante a Lixeira e a restauração antes do
  horário (nenhum lembrete da reunião cancelada sai).

## Riscos e a resposta do desenho

| Risco | Resposta |
| --- | --- |
| Restaurar mandar mensagem ao cliente (agendada, lembrete, espera, fluxo, IA) | Regra de ouro; travas de lembrete voltam; agendada volta como falha (a incerta sem reenvio); esperas encerradas ao mover |
| Calar gatilho travar a gravação de todas as contas ou ficar desligado | Sinal com `nullif(current_setting(…, true), '')`, nunca DDL; conferências antes de escrever |
| Tabela, coluna ou gatilho novo fora do tratamento | Varredura pelo catálogo + pinos default-deny (FKs, gatilhos, schema, citadores de arquivo) |
| A identidade é reocupada e restaurar bloqueia | B2: aviso na Lixeira + faixa; "Restaurar e unir" na Fase 4 |
| Arquivo de outro registro apagado | Guarda do caminho na drenagem + "ninguém mais cita" universal na hora |
| Anexo de anotação apagado no mover | Sinal `cb.lixeira = 'movendo'` respeitado pelo gatilho do plano irmão |
| Porta dos fundos (DELETE direto) | Fases 1 e 3 |
| Lixeira guardando dado pessoal | Só admin; tabela fechada; "Excluir agora" com a marca de pedido (B3) |
| Agendador parado segurando dados além dos 90 dias | A tela mostra "vencida, aguardando limpeza" e os arquivos parados |

## Fora deste plano

- Lixeira de conversa de grupo, negócio ou tarefa.
- Os arquivos das fichas apagadas ANTES da Lixeira (órfãos antigos): uma
  varredura única, com a mesma lista universal de citadores e uma margem de
  idade (nunca pela pasta nem só pelas mensagens).
- Bucket privado.

## Limites conhecidos

- O anexo da Evolution baixado segundos depois da mensagem, ou a foto que
  chega na mesma janela, pode ficar fora da fotografia se a ficha for movida
  nesse intervalo.
- A mensagem do cliente que chega durante o mover espera a trava e, depois do
  commit, recebe 23503 e se perde (já é assim hoje na exclusão).
- Os arquivos seguem públicos pelo link durante os 90 dias. O "Excluir agora"
  leva até um ciclo do laço lento (~15 min) para tirá-los do bucket, mais o
  cache do CDN enquanto durar (conferir no painel se o Smart CDN invalida ao
  apagar, antes de afirmar prazo a quem pediu a exclusão).

## Teste de ponta a ponta (preview)

- ⚠️ O preview grava na PRODUÇÃO (`.env.local`): ficha de teste autorizada
  pelo operador, com conversa, anotação, tarefa, etiqueta, uma agendada
  pendente e um lembrete disparado pouco antes de mover; nada de número que
  seja conexão do CRM.
- Mover (com a prévia) → some de Contatos, do inbox e do funil (card marcado);
  Desfazer → volta. Mover de novo e restaurar pela Lixeira DENTRO da janela do
  lembrete (no máximo 1 h; num "10 min antes", em até 10 min), com uma 2ª
  sessão de inbox aberta e aviso ligado: tudo volta, a agendada como falha,
  nenhum lembrete sai de novo, nenhuma mensagem sai, nenhum pop-up de fala
  antiga, nenhuma não lida inflada. Mover e "Excluir agora" → a fila apaga os
  arquivos no ciclo seguinte. Perfil não-admin não vê a tela nem o botão.

## Docs que mudam junto

- Fase 2: `.claude/rules/contatos.md` (exclusão → Lixeira),
  `.claude/rules/supabase.md` (APAGAR CONTATO; tabela nova entra na União E na
  Lixeira; o sinal `cb.lixeira`; a fila e a guarda do caminho, se este PR
  chegar antes do irmão), `.claude/rules/meu-dia.md` (a régua do aviso),
  `.claude/rules/deploy.md` (o `after()` do `cb/scheduled/cron`), CLAUDE.md
  seções 8a e 12, `docs/MERGE-UPSTREAM.md`, `docs/public-api.md` e a aba
  Configurações → API → Documentação (B6), `docs/MIGRATIONS-APLICADAS.md` (ao
  aplicar).
- Fase 5: o roteiro interno de pedido de exclusão.
