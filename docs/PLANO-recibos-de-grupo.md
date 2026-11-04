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
| 1 | O ERROR de grupo não vira "não entregue" | Implementada na branch `fix/erro-de-grupo-nao-e-falha` (04/11/2026); falta PR, CI e merge |
| 2 | ✓✓ e azul em grupo, e "Dados da mensagem" (quem recebeu e quem leu) | Planejada; decisões D1–D5 pendentes |

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
   - `cb_recibos_do_grupo`: conta, `message_id` do WhatsApp, participante (a
     chave de pessoa do telefone quando há; senão o LID), `entregue_em`,
     `lida_em`; PK (conta, `message_id`, participante). Só o servidor
     escreve; leitura por membro na forma da 1032; nada para `anon`.
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
   pela equipe: "Lida por" e "Entregue a", com nome e hora. O nome segue
   `nomes-dos-participantes.ts` (a ficha pelo telefone; senão o nome com que a
   pessoa escreveu no grupo; senão o telefone; sem telefone, "Número oculto").
   Rota de leitura por mensagem, recortada pela conta. "Ainda não recebeu"
   pede a lista ao vivo (`findGroupInfos`, ~0,8 s) — D2.
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
  conferência (até 24 h, ou até alguém abrir o painel) não conta, e o ✓✓ pode
  sair antes de ele receber; quem saiu conta, e a bolha fica em ✓ até a
  conferência seguinte. O detalhe nunca afirma nada de quem não mandou recibo.
- **Nosso outro número contado como de fora** (sem `own_lid` e sem o par do
  LID) anteciparia o ✓✓. A cobertura é o `participantAlt`; medir no grupo de
  teste antes de ligar.
- **Volume:** até 2 avisos por participante por mensagem. Os grupos do
  escritório têm de 3 a 6 pessoas; um grupo de 200 seriam 400 avisos por
  mensagem (D5).
- **Versões cruzadas:** o CRM de antes do PR ignora o aviso novo (sem
  `status`); a imagem de antes do patch não manda nada (como hoje). O
  rollback da imagem devolve o comportamento da Fase 1.

### Decisões pendentes do operador

- **D1. Semântica.** Recomendado: ✓✓ e azul quando TODOS de fora, como o
  WhatsApp, com o limite do denominador. Alternativa mais simples: "alguém de
  fora recebeu/leu" — mas o azul pode ser de um colega, não do cliente.
- **D2. "Dados da mensagem".** Recomendado: só quem recebeu e quem leu, do
  banco. Alternativa: também "ainda não recebeu", lendo o grupo ao vivo.
- **D3. Integradores.** Recomendado: o `message.status_updated` passa a sair
  para mensagem de grupo, documentado.
- **D4. As 10 vermelhas antigas.** Voltar para `sent`: escrita em produção,
  só com o "pode gravar".
- **D5. Grupo grande.** Recomendado: sem teto agora; registrar o volume para
  quem instala.
