---
paths:
  - "src/lib/cb-groups/**"
  - "src/app/api/cb/groups/**"
  - "src/components/inbox/group-sidebar.tsx"
  - "src/components/inbox/painel/participantes-do-grupo.tsx"
  - "src/hooks/use-participantes-do-grupo.ts"
---

# Grupos de WhatsApp — regras

Vale para a ingestão de grupo (`cb-groups/persist.ts`), a sincronização e o
detalhamento (`sync.ts`, `detalhar-na-chegada.ts`), as rotas
`/api/cb/groups/**` e o painel do grupo (`group-sidebar.tsx`, aba
Participantes). Grupo não é contato: a regra geral está na raiz (8d); o que
a ingestão de grupo NÃO faz (reabrir, motores, entrega), em `ingestao.md`; o
transporte da Evolution em geral, em `whatsapp-evolution.md`. Plano e
medições: `docs/PLANO-participantes-do-grupo.md`.

### O transporte (906/916)

- ⚠️ **A regra do `@lid` do 1:1 NÃO vale em grupo.** O remetente vai
  desnormalizado em `messages.group_sender_*`, sem FK e sem criar contato.
  Quase todo participante chega em `@lid`: a regra do 1:1 esvaziaria o recurso.
- **Grupo não dispara automação, fluxo nem IA**: `cb-groups/persist.ts` não
  importa os motores, e um teste lê o fonte. Grupo nas automações = import
  visível ali, nunca uma flag. `persist.ts` também não chama a Evolution:
  quem detalha é a rota do webhook.
- ⚠️ **`persist.ts` não reabre conversa encerrada.** Grupo encerrado some da
  caixa enquanto as mensagens continuam chegando; só um envio da equipe o
  reabre. Por isso o encerramento em lote (1018) deixa grupo de fora por padrão.
- ⚠️ **`group/fetchAllGroups` estoura** (mais de 90 s). Use `chat/findChats`
  filtrando `@g.us` (traz nome e foto). `findGroupInfos` (~650–850 ms por
  grupo) só para participantes, announce, admin, `restrict` e o nosso LID.
- ⚠️⚠️ **Na 2.4, todo `GET /group/…` exige CORPO** (`getComCorpo` em
  `evolution-client.ts`, pino `evolution-client.get-com-corpo.test.ts`): ela
  roda no Express 5, que deixa `req.body` INDEFINIDO no pedido sem corpo, e o
  `groupValidate` faz `Object.assign(body, …)` em cima dele — "Cannot convert
  undefined or null to object". Medido em 29/10/2026: nenhum grupo era
  detalhado desde a troca de versão (os 12 detalhados eram de 01/09). O
  `fetch` do Node recusa corpo em GET e descarta o `Content-Length`; por isso
  o `node:http(s)`. GET de grupo novo passa pelo mesmo método.
- ⚠️ **Um evento desconhecido faz a Evolution recusar a lista INTEIRA de
  eventos do webhook.** `GROUPS_UPDATE` não existe. `GROUP_UPDATE` existe na
  2.4, mas ainda não está na lista do CRM (pendente em `PLANO-baileys-7.md`,
  ajuste 5: conferir o enum e "Ressincronizar" as conexões).
- **Ligar `groups_enabled` não basta**: instância já conectada só recebe os
  eventos novos depois do "Ressincronizar".
- **Menção chega em `@lid`**: `cb_channels.own_lid` (916) é aprendido na
  primeira mensagem nossa num grupo; sem ele, `mentions_us` fica sempre falso.
- **Insert em BLOCO preenche coluna ausente com NULL**: `from_device` e
  `mentions_us` (NOT NULL) estouram com linhas não uniformes no lote.

### Detalhe do grupo: nome, contagem, "somos admin?"

- ⚠️⚠️ **Grupo sem `participant_count` é detalhado na CHEGADA**
  (`detalhar-na-chegada.ts`): a gravação devolve `grupoSemDetalhe`, a rota do
  webhook junta os jids num `Set` e detalha UMA vez por grupo DEPOIS dos
  itens, dos anexos e das fotos (dentro do laço, ~0,8 s por grupo atrasaria —
  e num corte do `after()` perderia — as mensagens seguintes). Freio de 15
  min por `<conta>:<jid>` no processo, carimbado ANTES da chamada (vale também
  na falha). Pino `route.grupo-sem-detalhe.test.ts`.
- ⚠️ **O sinal é `participant_count` nulo, nunca o `synced_at`**: a parte
  rápida da sincronização e o `groups.upsert` carimbam o `synced_at` sem
  participantes nem admin, e o grupo cujo detalhamento falhou ficaria travado
  para sempre.
- ⚠️⚠️ **Só pela conexão DO grupo** (`channel_id` igual ao do webhook): com
  dois números nossos no mesmo grupo, o "somos admin?" do outro número seria
  gravado, e o renomear sai pela `channel_id` do grupo. Grupo sem conexão (a
  dele foi apagada) não é detalhado por ninguém.
- **`camposDoDetalhe` é a lista ÚNICA do que o detalhe grava** (o lote da
  sincronização e a leitura do painel): nome, descrição, foto e dono só
  quando vieram — nunca NULL por cima.
- ⚠️ **A nossa linha entre os participantes se acha pela chave de pessoa**
  (`chaveDePessoa`), nunca pela grafia: o canal gravado sem o nono dígito e o
  WhatsApp entregando com ele davam "não admin" ao próprio admin.

### Participantes e renomear: AO VIVO

Decisões do operador (29/10/2026): D2 (renomear também quando o grupo deixa
qualquer participante mudar os dados) e D4 (quem vê o grupo vê os telefones,
como no próprio WhatsApp).

- ⚠️⚠️ **A lista não é guardada**: `GET /api/cb/groups/[id]/participantes`
  lê o `findGroupInfos` na hora e devolve; telefone de participante só existe
  nessa resposta. Guardar exigiria acompanhar cada entrada e saída, e a lista
  envelheceria sem aviso. A mesma leitura grava o espelho
  (`camposDoDetalhe`) e devolve `podeRenomear`.
- ⚠️ **Lista vazia é FALHA (502), nunca "nenhum participante"**: o número da
  conexão está no grupo, senão a Evolution nem leria os dados. Conexão
  ausente ou que não é da Evolution = 409 `SEM_CONEXAO`.
- **Nome, nesta ordem** (`nomes-dos-participantes.ts`): a ficha do CRM pelo
  `telefone_canonico` (em fatias); senão o nome mais recente com que a pessoa
  escreveu NESTE grupo (as últimas 1000 mensagens, pelo telefone ou pelo LID);
  senão o telefone; sem telefone, "Número oculto" — nunca o LID cru. O
  `findGroupInfos` não traz nome, e o da Evolution vem dos contatos do
  celular, não do grupo.
- ⚠️⚠️ **Renomear vale para admin OU grupo com `restrict === false`**
  (`podeRenomearAoVivo`), conferido AO VIVO também no `PATCH`: o
  `we_are_admin` gravado envelhece (o número rebaixado), e o `restrict` nem é
  guardado. Só sem resposta legível vale o gravado. `null` não destrava.
- **O painel lê o grupo assim que o mostra** (`useParticipantesDoGrupo`, não
  só com a aba aberta): o renomear depende da leitura. Até ela voltar (ou se
  falhar), vale o `we_are_admin` gravado, com a frase "Conferindo…".
- ⚠️⚠️ **`onGrupoAtualizado` da página aplica o patch na conversa ABERTA**,
  não pelo id do grupo: o hook só o chama com o grupo ainda NA TELA
  (`grupoNaTelaRef`, efeito de LAYOUT) — a resposta de A que pousa entre a
  troca e a limpeza do efeito gravaria a contagem de A em B.
- **"Conversar" com um participante** abre a Nova conversa da lista
  (`pedirConversaComContato`), só para `send-messages` e só com telefone.
