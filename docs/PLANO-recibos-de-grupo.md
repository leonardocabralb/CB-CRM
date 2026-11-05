# Plano — recibos de mensagem em GRUPO (o ✓✓ e o falso "não entregue")

Documento INTERNO (não vai para quem instala). Plano vivo: a tabela de Estado
muda a cada fase.

## Por quê

04/11/2026: o operador mostrou uma conversa de grupo do Bancário em que (a)
nenhuma mensagem da equipe passava de ✓ e (b) uma delas estava vermelha, "Não
entregue — o destinatário não recebeu. Envie de novo.", embora todas tivessem
chegado (ele conferiu no WhatsApp).

## O que foi medido (04/11/2026, só leitura)

- **Banco, 30 dias, conexões da Evolution, mensagens da equipe e do robô:**
  grupo 83 `sent` + 10 `failed` + ZERO entregue ou lida; 1:1 7.614 entregues,
  9.897 lidas, 491 `sent` e 4 `failed`. Os 10 `failed` de grupo: todos texto,
  todos nas duas conexões do Bancário.
- **Código** (Baileys `v7.0.0-rc13`, Evolution `e273b904`):
  - `handleReceipt` manda o recibo de GRUPO como `message-receipt.update`, um
    por participante (`userJid` + `receiptTimestamp`/`readTimestamp`), nunca
    como `messages.update` — inclusive o `sender` dos nossos aparelhos, que
    vira `readTimestamp`.
  - A Evolution usa o `message-receipt.update` só para marcar como lidas, no
    banco DELA, as mensagens RECEBIDAS (`updateMessagesReadedByTimestamp`).
    Não repassa nada ao webhook e não escreve no log.
  - `handleBadAck` monta a chave do ack de erro só com `attrs.from`: num grupo,
    o JID do grupo, sem participante.
  - O webhook de `messages.update` da Evolution não leva o
    `messageStubParameters` (o código do erro); só o log o tem.
- **Log da Evolution** (três janelas: 04/11 14:08–19:18Z, 16/10 12:20–19:54Z,
  03/11 16:03Z–04/11 13:03Z): 16 envios a grupo pelo CRM e só 2 recibos, os
  dois `ERROR` com `["479"]`, o JID do grupo e nenhum participante, 0,8–1,2 s
  depois do envio. Nenhum "enviado pelo servidor", entregue ou lido de grupo.
  No mesmo período, o 1:1 teve ~900 `SERVER_ACK`, 500–700 entregues e ~250
  lidos por janela.
- **A mensagem chegou e o recibo não veio:** a outra conexão da conta, membro
  do mesmo grupo, recebeu cada um dos 4 envios de 04/11 ~0,4 s depois — e o de
  vermelho, quase 1 s ANTES do `479`.
- **Não provado:** qual aparelho pediu o reenvio que o servidor recusou (a
  Baileys só escreve erro no log). "Reenvio recusado a um aparelho de alguém
  do grupo" é a explicação mais provável (o mesmo `479` dos casos 1:1
  provados em 05/10/2026), não provada. A troca de sessão da libsignal vista
  entre o envio e o erro aparece também depois de 2 de 13 envios sem erro:
  não serve de marca.
- **Nosso LID aprendido** (`cb_channels.own_lid`): só 1 das 4 conexões de
  produção. Ele só se aprende com mensagem nossa vinda do CELULAR num grupo;
  o envio pelo CRM não ensina.

## Estado

| Fase | O quê | Estado |
|---|---|---|
| 1 | O ERROR de grupo não vira "não entregue" | Mesclada no PR #456 (04/11/2026) |
| 2 | ✓✓ e azul em grupo, e "Dados da mensagem" (quem recebeu e quem leu) | Decidida (D1–D3 e D5, 04/11/2026); revisão independente e duas rodadas do Codex no PR #457 (abaixo); 1119 aplicada em produção em 04/11/2026; o CRM no ar com o PR #457 (04/11/2026); a imagem com o 5º patch no ar desde 05/11/2026 09:20 BRT (`docs/INFRA-VPS.md` §8). Falta: a prova num grupo de teste. D4 e D6 pendentes |

## Fase 1 — o ERROR de grupo não vira falha

Decisão do operador (04/11/2026), com o custo dito: uma falha real de grupo
fica em ✓, sem aviso.

- `ehErroDeGrupo` na rota da Evolution: ERROR com `remoteJid` em `@g.us` é
  descartado antes do UPDATE, com log (`ERROR de grupo ignorado`). Nenhum
  `message.status_updated` sai para ele.
- Pinos: 4 testes em `route.recibo.test.ts` (os 2 centrais reprovam sem a
  regra); o ERROR de 1:1 com "@" segue marcando falha.
- Notas: `whatsapp-evolution.md` (Recibos), `grupos.md`, `ingestao.md`
  (Recibo de status) e `docs/DECISOES-DO-OPERADOR.md`.
- Não muda contrato documentado (`docs/webhooks.md` não fala de falha nem de
  grupo; o portão `doc-acompanha` não cobra a rota).
- **Fica para decisão (D4):** as 10 de grupo já `failed` dos últimos 30 dias
  continuam vermelhas. Voltar para `sent` é escrita em produção.

## Fase 2 — ✓✓ e azul em grupo

**Pronto quando:** a bolha de grupo da equipe mostra ✓✓ quando todos os
participantes de fora (sem os números da conta) receberam e azul quando todos
leram, e "Dados da mensagem" diz quem recebeu e quem leu, com hora.

### Peças

1. **5º patch na imagem da Evolution** (`docker/evolution-cb/`, no fonte do
   `whatsapp.baileys.service.ts`):
   - No `message-receipt.update`: para recibo de mensagem NOSSA
     (`key.fromMe`) em `@g.us`, que não seja do próprio número (o `sender` e o
     `read-self` dos nossos aparelhos chegam como `readTimestamp`) e
     respeitando o `groupsIgnore`, mandar ao webhook o evento
     `messages.update` com `{ keyId, remoteJid, fromMe: true, participant,
     participantAlt, reciboDoGrupo: 'DELIVERY_ACK' | 'READ', instante }`.
     - `messages.update` porque o CRM já o assina: um evento NOVO na lista do
       webhook faz a Evolution sem o patch recusar a lista INTEIRA
       (`grupos.md`).
     - SEM o campo `status`: o CRM de antes do PR não acha `status` e ignora
       o aviso, em vez de pintar ✓✓ no primeiro recibo (que pode ser o do
       nosso outro número).
     - `participantAlt` = o telefone do participante quando a Evolution
       conhece o par do LID (`lidMapping.getPNForLID`). É ele que acha o
       NOSSO outro número quando o `own_lid` não foi aprendido (acima).
   - No `messages.update` de ERROR: repassar o `messageStubParameters`.
   - Imagem nova pelo `evolution-cb.yml`; o README da pasta, o
     `docs/INSTALACAO.md` §3.1 e o `docker-compose.evolution.yml` mudam no
     mesmo PR (`deploy.md`).
2. **Migration** (número = maior do `main` + 1 na hora; ADITIVA, antes do
   deploy):
   - `cb_recibos_do_grupo`: conta, grupo, `message_id` do WhatsApp,
     participante (o JID como chegou, sem o aparelho: quase sempre o LID), a
     ficha (`contact_id`, sem FK, achada pelo telefone da chegada),
     `entregue_em`, `lida_em`; PK (conta, `message_id`, participante). Nunca
     o telefone à parte (a D4 de 29/10, `grupos.md`). Só o servidor escreve;
     leitura por membro na forma da 1032; nada para `anon`.
   - `cb_groups.participantes_de_fora` (int, nulo = não sei): quantos
     participantes NÃO são números da conta, gravado na mesma conferência que
     já grava `participant_count` e as fichas (`fichasParaGravar` e
     `chavesDasConexoes` já separam os números do escritório). Não guarda a
     LISTA (`grupos.md`: a lista não é guardada).
3. **CRM, rota da Evolution** — aviso com `reciboDoGrupo`:
   - descarta o participante que é número de QUALQUER conexão da conta
     (`own_lid`; `display_phone` pela chave de pessoa, via `participantAlt`);
   - grava o recibo só avançando (`entregue_em`/`lida_em` só se preenchem; a
     leitura preenche a entrega);
   - agrega: `delivered` quando os que receberam ≥ `participantes_de_fora`;
     `read` quando os que leram ≥. Pela ESCADA e com a espera da linha
     (`aplicarReciboQuandoAMensagemExistir`): o 1º recibo chega ~0,4 s depois
     do envio, antes de a linha existir. `participantes_de_fora` nulo = não
     agrega (fica ✓; o detalhe aparece);
   - o `message.status_updated` passa a sair para grupo (D3; `docs/webhooks.md`);
   - a Fase 1 fica mais fina: ERROR de grupo COM código diferente de `479`
     volta a marcar falha (ex.: conta restrita); sem código (imagem sem o
     patch) segue ignorado.
4. **Tela:** "Dados da mensagem" na barra de ações da bolha de grupo enviada
   pela equipe: "Lida por" e "Entregue a", com nome e hora. O nome: a ficha
   gravada com o recibo; senão `nomes-dos-participantes.ts` (o nome com que a
   pessoa escreveu no grupo); sem nenhum, "Número oculto", nunca o LID. O
   telefone só aparece quando o participante é um JID de telefone. Rota de
   leitura por mensagem, recortada pela conta. Sem leitura ao vivo (D2): não
   há "ainda não recebeu".
5. **Docs e regras:** `docs/webhooks.md`; `whatsapp-evolution.md`;
   `grupos.md`; `ingestao.md` (no teto: condensar antes de acrescentar);
   `inbox-conversa.md`; `docs/INFRA-VPS.md` (a troca de imagem);
   `docs/MIGRATIONS-APLICADAS.md`.
6. **Ordem de publicação:** migration → merge do CRM (deploy) → imagem nova →
   troca na VPS com a fila de entrada em ~0 s nas 4 conexões e o operador
   ciente (`docs/INFRA-VPS.md` §9) → conferir num grupo de TESTE com um
   celular de fora (número de conexão nunca serve de destino de teste).

### Riscos e limites

- **O denominador envelhece:** quem entrou no grupo depois da última
  conferência (até 24 h, ou até alguém abrir o painel) fica fora do
  denominador, mas o recibo dele conta: o ✓✓ pode sair com um participante
  ORIGINAL ainda sem receber (a tela esconde o "N de M" quando N passa de M).
  Quem saiu conta, e a bolha fica em ✓ até a conferência seguinte. O detalhe
  nunca afirma nada de quem não mandou recibo.
- **Recibo que chega antes da primeira conferência (Codex, PR 457, aceito):**
  gravado com o denominador nulo, ele não é reavaliado quando a conferência
  grava o número; a bolha fica em ✓ até o próximo recibo da MESMA mensagem
  (em geral a leitura), que recalcula tudo. Lado seguro: ✓ é o comportamento
  de antes. Como o CRM (com a 1119) entra antes da imagem nova, os grupos
  ativos ganham o denominador nesse intervalo; sobra o grupo parado cuja
  primeira mensagem depois da troca é nossa. Reavaliar na conferência exigiria
  tirar a aplicação do status da rota do webhook: só se aparecer no grupo de
  teste.
- **Duas conferências juntas (revisão, B5b, aceito):** o denominador é
  gravado depois da `cb_gravar_fichas_do_grupo`, fora da trava do grupo. O
  painel e a chegada conferindo ao mesmo tempo podem deixar o número da
  leitura mais velha, até a conferência seguinte.
- **A chave é o JID como chegou (B9):** num grupo migrando para LID, a
  entrega como `…@s.whatsapp.net` e a leitura como `…@lid` viram duas linhas
  da mesma pessoa, e o ✓✓ sai antes da hora. Raro; trocar a chave não
  resolveria o caso em que o par do LID só aparece depois.
- **A trava ocupa conexão (B10):** cada recibo espera a trava da mensagem
  segurando uma conexão do PostgREST, e a contagem percorre os recibos da
  mensagem (O(N) por recibo). Nos grupos de 3 a 6 pessoas não pesa; num grupo
  grande (D5, sem teto) as chamadas enfileiram num banco que vive no teto de
  conexões. Sem `lock_timeout` de propósito: o recibo recusado se perderia e
  a bolha ficaria em ✓.
- **Conexão com grupos desligados (M1):** não grava recibo nenhum; o envio
  do CRM a um grupo por ela (configuração incoerente) fica em ✓.
- **Guardado sem prazo (M2):** os recibos ficam enquanto o grupo existir
  (CASCADE com o grupo e a conta). O "Excluir agora" da Lixeira (1097) não os
  alcança: a ficha apagada deixa o `contact_id` solto (a tela cai para o nome
  do grupo) e o JID do participante fica, como já ficam as mensagens dele no
  grupo (`messages.group_sender_jid`). No grupo endereçado por telefone
  (raro), esse JID é o número. Prazo e exclusão: D6.
- **Nosso outro número contado como de fora** (sem `own_lid` e sem o par do
  LID) anteciparia o ✓✓. A cobertura é o `participantAlt`; medir no grupo de
  teste antes de ligar.
- **Volume:** um aviso por recibo, sem juntar — a entrega e a leitura de cada
  participante, mais uma quando ele ouve uma mensagem de voz (o `played` também
  chega como leitura). Se o WhatsApp manda um recibo por APARELHO do
  participante, não foi medido (o CRM conta a pessoa uma vez de qualquer
  jeito). Os grupos do escritório têm de 3 a 6 pessoas; um grupo de 200 seriam
  centenas de avisos por mensagem (D5).
- **Versões cruzadas:** o CRM de antes do PR ignora o aviso novo (sem
  `status`); a imagem de antes do patch não manda nada (como hoje). O
  rollback da imagem devolve o comportamento da Fase 1.
- **No patch, o repasse vem DEPOIS do que a Evolution já fazia no evento:** se
  aquele UPDATE dela lançar, os avisos de grupo do lote se perdem junto com o
  resto do lote, como já acontecia com os outros eventos.

### Decisões do operador (04/11/2026, "Sim, como recomendado")

- **D1. Semântica — DECIDIDA:** ✓✓ e azul quando TODOS de fora, como o
  WhatsApp, com o limite do denominador. (A alternativa "alguém de fora"
  ficou de fora: o azul poderia ser de um colega, não do cliente.)
- **D2. "Dados da mensagem" — DECIDIDA:** só quem recebeu e quem leu, do
  banco, sem ler o grupo ao vivo.
- **D3. Integradores — DECIDIDA:** o `message.status_updated` passa a sair
  para mensagem de grupo, documentado (`docs/webhooks.md`,
  `docs/public-api.md`).
- **D4. As 10 vermelhas antigas — PENDENTE:** voltar para `sent` é escrita em
  produção, só com o "pode gravar".
- **D5. Grupo grande — DECIDIDA:** sem teto agora; o volume está registrado
  no README da imagem e no guia de instalação (um aviso por recibo).
- **D6. Prazo dos recibos e o "Excluir agora" — PENDENTE** (revisão de
  04/11/2026): podar `cb_recibos_do_grupo` depois de N dias? Apagar os
  recibos da ficha no "Excluir agora"? Nada disso foi decidido; hoje ficam.

## Fase 2 — o que foi feito (04/11/2026)

- **Migration `1119_cb_recibos_do_grupo.sql`:** `cb_groups.participantes_de_fora`
  (CHECK ≥ 0), `cb_recibos_do_grupo` (PK conta + mensagem + participante; a
  ficha sem FK; FK composta e CASCADE para `cb_groups`; leitura na forma da
  1032; escrita só do servidor) e `cb_registrar_recibo_do_grupo` (grava só avançando por `LEAST`,
  trava por mensagem com `pg_advisory_xact_lock`, devolve a contagem e o
  denominador). Pino `recibos-do-grupo-1119.test.ts`.
- **CRM:** `src/lib/cb-groups/recibos-do-grupo.ts` (ler o aviso, número da
  conta, status agregado, gravar); a rota da Evolution ganha o caminho do
  recibo de grupo e o código no ERROR de grupo (`ehErroDeGrupo`), e o trecho
  da escada + espera da linha + aviso ao integrador virou
  `aplicarStatusDoRecibo`, usado pelos dois caminhos; a conferência das
  fichas grava `participantes_de_fora` (detalhe e painel).
- **Tela:** "Dados da mensagem" na barra de ações
  (`dados-da-mensagem-do-grupo.tsx`) e a rota `GET /api/cb/groups/[id]/recibos`.
- **Imagem:** o 5º patch (`docker/evolution-cb/recibo-de-grupo.patch`), o
  workflow e o README da pasta, o guia de instalação e o compose.
- **Medido antes do PR:** replay completo num Postgres 16 descartável (243
  migrations até a 1119, `verify-schema.sql` OK); a 1119 reaplicada com dado
  fictício (a prova do bloco DO roda e se desfaz); corrida de duas sessões na
  MESMA mensagem: a segunda esperou ~1,5 s pela trava e contou 2; mensagens
  diferentes não esperam uma pela outra; só o `service_role` executa; pela
  RLS, o membro da conta vê os recibos e o de outra conta não. Testes da
  rota (o recibo antes da linha, o número da conta, o denominador nulo, a
  função ausente, o código 479 × outro); a exclusão do número da conta
  reprova o teste quando desligada.
- **Medido no patch (fonte do upstream, fora da VPS):** os 4 patches de fonte
  aplicam limpos na ordem num checkout novo do `e273b904`; as 6 travas novas
  do workflow passam com o patch e reprovam sem ele; `tsc --noEmit` com 0
  erros com e sem o patch (saída idêntica) e o `npm run build` passa nos dois;
  numa bancada com o código real do serviço e dublês (JIDs fictícios), 14
  recibos viraram os 4 avisos esperados (o nosso número, 1:1,
  `status@broadcast`, `fromMe` falso e carimbo inválido ficam de fora; com
  `groupsIgnore`, nenhum), e o `479` vai ao webhook e nunca ao Prisma. Não
  rodado: o build Docker (a máquina não tem Docker; roda no workflow).
- **Revisão independente (04/11/2026; nenhum achado alto), corrigido no
  mesmo PR:** M1, o recibo só com `groups_enabled` e espera da linha mais
  curta no grupo (1 + 2 + 4 s; a do 1:1 segue em 30 s); M2, a tabela guarda a
  ficha, nunca o telefone; B1, a regra `grupos.md` carrega para o balão e a
  1119; B2, a linha do MERGE-UPSTREAM; B3, o pino conta as instruções da
  função (a trava sozinha na primeira); B4, a prova escolhe uma conta sem o
  mesmo `jid`; B5a, o grupo sem denominador é detalhado na chegada; B6, o
  `total` pelo `count` e o aviso de lista cortada; B7, sem "N de M" com N
  maior que M; B8, a dica da lista vazia não afirma o estado. B5b, B9 e B10
  ficaram como limites (acima). Medido de novo depois das correções: replay
  do zero (243 migrations, `verify-schema.sql` OK); a tabela sem coluna de
  telefone; a ficha gravada na entrega não some com a leitura sem ficha; com
  o mesmo `jid` na outra conta, a prova pula com aviso em vez de abortar; o
  corpo que o supabase-js manda, pelo `json_to_recordset` com os tipos da
  função (a forma do PostgREST), grava e devolve a contagem; a suíte inteira
  no Node 22 verde.
- **Codex (PR 457, 1ª rodada, dois P2):** a lista do "Dados da mensagem"
  passou a rolar dentro de um teto pela altura medida na tela
  (`--available-height` do base-ui, piso de 12rem); a reavaliação do recibo
  que chega antes do denominador ficou como limite (acima).

## Conferência no grupo de TESTE (depois da troca na VPS)

1. Um grupo de teste com a conexão e UM celular de fora (número de conexão
   nunca serve de destino de teste).
2. Enviar pelo CRM: ✓; o celular de fora recebe → ✓✓; lê → azul.
3. `cb_recibos_do_grupo` dessa mensagem: só a linha do celular de fora. O
   `sender`/`read-self` do PRÓPRIO celular da conexão não pode virar linha (a
   bancada usou um `me.lid` fictício; sem `me.lid` e sem `own_lid`, ele
   contaria como leitura de fora a cada envio).
4. "Dados da mensagem": o nome (a ficha, se houver) e as horas.
5. Com um segundo celular de fora: ✓✓ só depois do segundo.
