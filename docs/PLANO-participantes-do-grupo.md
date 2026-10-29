# Plano — Participantes do grupo e grupo novo que se detalha sozinho

Pedido do operador (29/10/2026): poder editar o nome de um grupo de WhatsApp
pelo CRM e ver todos os participantes dele.

## Estado

| Fase | O quê | Estado |
| --- | --- | --- |
| 0 | Medir a resposta do `findGroupInfos` e do `findChats` na 2.4 (só leitura) | ✅ 29/10 pelo FONTE e no preview: a 2.4 RECUSAVA todo GET de grupo sem corpo (abaixo) |
| 1 | Grupo sem detalhe se detalha sozinho na chegada da mensagem | ✅ 29/10: commit `2d03c6d8` na branch |
| 1b | GET de grupo COM corpo (a causa de nenhum grupo ser detalhado desde a 2.4) | ✅ 29/10: medido no preview com o grupo do print (502 → 200) |
| 2 | Participantes no painel do grupo, lidos do WhatsApp ao abrir | ✅ 29/10: aba "Participantes" (D1 a confirmar vendo a tela) |
| 3 | Renomear confere ao vivo (admin, ou grupo aberto a todos) | ✅ 29/10 |
| 4 | "Conversar" com um participante | ✅ 29/10 (pedido do operador: "faça todas as fases aqui") |

Sem migration: nada novo é guardado no banco.

Decisões respondidas em 29/10/2026: D2 e D4 como recomendado; D3 feita;
D1 implementada como aba própria, para o operador confirmar vendo a tela.

## O que o preview mediu (29/10/2026, grupo do print, com autorização)

Aberto em modo anônimo pelo link direto (as não lidas não zeraram: uma
mensagem que chegou durante o teste ficou contada).

- ⚠️⚠️ **A 1ª leitura deu 502**: a Evolution respondeu "Cannot convert
  undefined or null to object" ao `findGroupInfos`. No fonte de `e273b904`:
  Express 5 (`"express": "^5.2.1"`) deixa `req.body` INDEFINIDO no GET sem
  corpo, e o `groupValidate` faz `Object.assign(body, { groupJid })`. Era
  por isso que o botão "Sincronizar" não detalhava grupo nenhum desde a 2.4
  (os 12 detalhados da Bancário - Jurídico são de 01/09) e que a Fase 1, sem
  isto, também falharia sempre.
- O `fetch` do Node recusa corpo em GET e descarta o `Content-Length`
  (medido num servidor local, Node 22). Conserto: `getComCorpo` no
  `EvolutionClient`, pelo `node:http(s)`, com o `groupJid` no corpo e na
  query. Depois dele: 200 em ~2 s.
- Gravado no grupo: nome (o real do WhatsApp), 3 participantes,
  `we_are_admin = true` — o "Renomear no WhatsApp" ficou liberado. A aba
  mostrou os três (este número como criador; um com ficha no CRM), e o
  "Conversar" abriu a Nova conversa preenchida (cancelada, nada criado).
- Não exercitado: o renomear de verdade (mudaria o nome para todos no grupo
  real) e a Fase 1 com mensagem real (só depois do deploy).

## O que foi medido (29/10/2026, produção, só leitura)

- O grupo do print nasceu em 27/10 pela primeira mensagem
  (`findOrCreateGroup`, `cb-groups/persist.ts`). Essa linha nasce só com
  `jid` e `channel_id`: a mensagem de grupo não traz o nome, os participantes
  nem quem é admin. Está com `subject`, `participant_count`, `we_are_admin` e
  `synced_at` NULOS.
- A conexão dele (Bancário - Jurídico) tem 13 grupos; a última sincronização
  foi em 01/09/2026. Os outros 12 estão detalhados (7 com `we_are_admin`).
  Só este nunca foi sincronizado.
- Por isso o painel mostra "Grupo sem nome" e o "Renomear no WhatsApp" fica
  desabilitado: `podeRenomearNoWhatsApp` só libera com `we_are_admin ===
  true` (`null` = "não sei", e não destrava, de propósito).
- O CRM nunca guardou a LISTA de participantes, só a contagem
  (`detalharGrupos`, `sync.ts`). O `findGroupInfos` já devolve a lista
  inteira; ela é lida e jogada fora.

## O que existe e será reaproveitado

- `EvolutionClient.findGroupInfos(jid)`: ~650–850 ms por grupo (medido em
  2026-07). `parseGroupInfo` já lê o participante nas três formas (`{id: lid,
  jid}`, `{id: lid, phoneNumber}` e `{id: telefone, lid}`, Baileys 7).
- `detalharGrupos(db, { jids })`: detalha uma lista de grupos e grava; serve
  para UM grupo sem mudança.
- `nomesConhecidos` (`system-events.ts`): nome do participante pelo
  `group_sender_name` que ele deixou ao escrever (recortado pela conta).
- `contacts.telefone_canonico` + `chaveDePessoa`: casar o telefone do
  participante com a ficha do cliente, por pessoa e não por grafia.
- O evento `groups.upsert` já atualiza o nome de grupo conhecido quando muda
  no WhatsApp; `group.participants.update` já vira aviso no fio.

## Decisões do operador

- **D1 — Onde a lista mora**: aba própria "Participantes" (recomendado: um
  grupo de 200 pessoas empurraria apelido, nome e conexão para longe) ou
  seção na aba Informações. Decidir VENDO a tela, na Fase 2.
- **D2 — Liberar o renomear quando o grupo deixa QUALQUER participante mudar
  os dados** (configuração do WhatsApp "Editar dados do grupo: todos"; na
  Baileys, `restrict === false`). Hoje o CRM exige ser admin e ignora essa
  configuração. Recomendado: liberar, conferindo AO VIVO na hora de renomear.
- **D3 — Botão "Conversar" ao lado de cada participante com telefone**, que
  abre a Nova conversa com ele (o mesmo evento do cartão de contato, só para
  quem pode enviar). Recomendado, mas fica para depois das Fases 1–3.
- **D4 — Quem vê os telefones**: todo membro que vê o grupo (é o que
  qualquer participante já vê no próprio WhatsApp). Recomendado.

## Fase 0 — Medir antes de escrever (só leitura)

Forma nova de resposta se MEDE (raiz, 8b). Uma chamada de cada, num grupo da
conta, com as credenciais do canal:

- `findGroupInfos`: existem `restrict`, `size` e `subject`? Cada participante
  traz `id`, `phoneNumber`/`lid`, `admin` (`admin`/`superadmin`/null)? Vem
  algum NOME (`name`, `notify`)? Quantos participantes vêm sem telefone?
- `findChats`: o grupo que nasceu pela mensagem aparece? (Se não aparecer, o
  botão "Sincronizar dados do grupo" nunca o detalharia: o detalhamento só
  percorre os grupos que o `findChats` devolve.)

O clique em "Sincronizar dados do grupo" no grupo do print já mede o segundo
ponto: `synced_at` preenchido = o `findChats` o trouxe.

### Resultado (29/10/2026)

Lido no fonte do commit em produção (`e273b904`,
`whatsapp.baileys.service.ts`), sem chamar a Evolution:

- `findGroup` (o `group/findGroupInfos`) devolve `id`, `subject`,
  `pictureUrl`, `size` (= `participants.length`, sempre número), `owner`,
  `desc`, **`restrict`**, **`announce`** e `participants` CRU da Baileys
  (`GroupParticipant`: `id`, `phoneNumber`/`lid`, `admin`). Sem nome.
- `findParticipants` (`GET /group/participants`) devolve os mesmos
  participantes com `name` (o `pushName` que a Evolution guardou do contato,
  casado pelo `id`) e `imgUrl`. É uma 2ª fonte de nome para a Fase 2 (mais
  uma chamada de ~0,8 s; medir na tela se vale).
- `updateGroupSubject` chama `groupUpdateSubject` direto: quem decide se
  podemos é o WhatsApp (500 cru na recusa).

No banco (só leitura): 67 grupos na conta, 50 sem `participant_count`; 49
deles são de uma conexão que já foi apagada (`channel_id` nulo, sincronizados
em 28/07) e ficam fora da Fase 1, que exige a conexão do grupo. Na Bancário -
Jurídico, 12 de 13 detalhados; o 13º é o do print.

## Fase 1 — Grupo sem detalhe se detalha sozinho

Hoje o grupo novo fica "sem nome" até alguém clicar em sincronizar, o que
pode levar semanas.

- `findOrCreateGroup` passa a dizer se o grupo está SEM DETALHE
  (`synced_at IS NULL`: nasceu agora ou nunca foi detalhado).
- A rota do webhook da Evolution junta esses grupos durante o laço dos itens
  e os detalha DEPOIS de todos os itens gravados (como `paraReligar`): a
  chamada de ~0,8 s dentro do laço atrasaria, e num corte do `after()`
  perderia, as mensagens seguintes do lote.
- Reusa `detalharGrupos` com os jids do canal. O cliente da Evolution sai de
  `getChannelWithSecrets` (traz `display_phone` e `own_lid`, sem os quais
  `we_are_admin` e o nosso LID ficam nulos).
- Freio por processo: um grupo não é tentado de novo antes de 15 min. Sem
  ele, uma Evolution que falha no `findGroupInfos` levaria uma chamada a CADA
  mensagem do grupo.
- `persist.ts` continua sem chamar a Evolution e sem importar motor: quem
  detalha é a rota.
- Testes: grupo novo dispara UM detalhamento depois dos itens; grupo já
  detalhado não dispara; o freio segura a segunda tentativa; falha do
  detalhamento não derruba a gravação.

Efeito: "Grupo sem nome" dura segundos; o grupo do print se conserta sozinho
na próxima mensagem (ou agora, pelo botão).

### Como ficou (29/10/2026)

- O sinal de "falta o detalhe" é `participant_count` NULO, não o
  `synced_at`: a parte rápida da sincronização e o `groups.upsert` carimbam
  o `synced_at` sem participantes. `findOrCreateGroup` lê `channel_id` e
  `participant_count`; `persistGroupMessage` e `persistGroupDeviceMessage`
  devolvem `grupoSemDetalhe` (só com a conexão do grupo igual à do webhook).
- `src/lib/cb-groups/detalhar-na-chegada.ts`: freio de 15 min por
  `<conta>:<jid>` no processo, carimbado ANTES da chamada (vale também
  quando a tentativa falha); canal por `getChannelWithSecrets`; reusa
  `detalharGrupos`. Nunca lança.
- A rota junta os jids num `Set` no laço e chama depois das fotos de
  perfil, no fim da entrega.
- Testes: `persist.sem-detalhe.test.ts` (6), `detalhar-na-chegada.test.ts`
  (7), `route.grupo-sem-detalhe.test.ts` (3: depois de TODAS as gravações,
  um por jid, nada com grupo detalhado). Typecheck e lint sem erro; suíte
  inteira em Node 22: 808 arquivos, 12.650 testes.
- Regra: nota em `.claude/rules/whatsapp-evolution.md` (grupos).
- Não exercitado: uma mensagem real de grupo chegando em produção. Só se
  confirma depois do deploy (o grupo do print ganha nome na mensagem
  seguinte).

## Fase 2 — Participantes no painel

- Rota nova `GET /api/cb/groups/[id]/participantes` (`requireRole('viewer')`;
  o grupo lido com `account_id`): chama `findGroupInfos` AO VIVO e devolve a
  lista. Ao vivo de propósito: guardar exigiria tabela nova e acompanhar cada
  entrada e saída, e a lista envelheceria sem aviso. As credenciais do canal
  saem por service role com `account_id` (conferir se a RLS de um `viewer`
  alcança as colunas de segredo; hoje só o `PATCH`, de `agent`, as lê).
- Função pura nova lê os participantes (mesmas três formas de
  `parseGroupInfo`, com teste) e o nome sai, nesta ordem: ficha do cliente
  pelo `telefone_canonico` (em fatias, abaixo do teto de 1000 do PostgREST);
  senão o nome com que a pessoa escreveu em grupos da conta
  (`nomesConhecidos`, pelo JID do telefone e pelo LID); senão o telefone
  formatado (`formatarTelefone`). Sem telefone: "Número oculto", nunca o LID
  cru.
- A mesma leitura ATUALIZA o espelho do grupo (`participant_count`,
  `we_are_admin`, `is_announce`, nome), por service role com `account_id`:
  abrir o painel passa a destravar o renomear quando o número é admin.
- Falha da Evolution = 502 com frase própria e "Tentar de novo". Nunca
  "nenhum participante" (vazio por falha não vira afirmação, raiz 8c).
- Tela: lista com selo de admin (e de criador), "Este número" na nossa
  linha, busca quando passar de ~10, ordem: este número, admins, o resto por
  nome. Carimbada com o grupo (`{ de }`, efeito passivo) e lida só quando a
  aba/seção abre. A contagem do cabeçalho do painel acompanha a lista.
- Chaves novas nos DOIS dicionários (`Inbox.groupSidebar`).
- Medida na tela no preview (1440×900), com o grupo do print.

## Fase 3 — Renomear com conferência ao vivo (D2)

- A resposta da Fase 2 leva `podeRenomear` = somos admin OU o grupo deixa
  todos editarem; o painel usa esse valor (e o texto explica qual dos dois).
- O `PATCH` lê o `findGroupInfos` antes de renomear e decide pelo valor ao
  vivo: o `we_are_admin` gravado pode estar velho (o número foi rebaixado). Se
  a leitura falhar, vale o gravado (como hoje).
- Sem coluna nova: o valor vem sempre do WhatsApp.

## Riscos e limites

- Telefone de participante é dado pessoal: a lista só existe na resposta da
  rota, não é gravada, e vale a régua de quem vê o grupo (D4).
- Grupo de até 1024 pessoas: a resposta e a busca na tela têm de aguentar
  isso (fatias na consulta às fichas).
- Participante que esconde o número aparece só pelo LID: fica "Número
  oculto", com o nome se ele já escreveu.
- A Fase 1 mexe na rota do webhook da Evolution: sem caminho novo de
  ingestão, sem motor, sem reabrir, sem medir entrega (regras de
  `ingestao.md` para grupo).

## Como ficaram as Fases 2–4 (29/10/2026)

- Rota `GET /api/cb/groups/[id]/participantes` (`viewer`): grupo pela RLS,
  credenciais e o resto por service role com `account_id`; `findGroupInfos`
  ao vivo; espelho por `camposDoDetalhe`; nomes por
  `nomes-dos-participantes.ts` (ficha pela chave de pessoa, senão o nome usado
  no grupo nas últimas 1000 mensagens); `podeRenomear` = admin OU
  `restrict === false`. Falha e lista vazia = 502; sem conexão = 409.
- `PATCH` do renomear: lê o `findGroupInfos` antes e decide ao vivo; sem
  resposta legível, vale o gravado.
- `parseGroupInfo` acha a nossa linha pela chave de pessoa (o nono dígito
  dava "não admin" ao admin) e lê o `restrict` (`soAdminEdita`).
- Tela: `useParticipantesDoGrupo` (carimbo `{ de }`, `grupoNaTelaRef` contra
  o patch no grupo errado), aba Participantes em `group-sidebar.tsx`
  (`participantes-do-grupo.tsx`: busca acima de 10, papel, "tem ficha",
  "Número oculto", "Conversar"), frase "Conferindo…" no renomear.
- Regra nova `.claude/rules/grupos.md` (a seção de grupos saiu de
  `whatsapp-evolution.md`, que estava no teto); decisão em
  `docs/DECISOES-DO-OPERADOR.md`.
