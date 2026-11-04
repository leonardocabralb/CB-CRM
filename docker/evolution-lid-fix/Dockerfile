# ============================================================
# Evolution API 2.3.x + dois consertos na Baileys 6.7.19 que ela embarca: o
# do eco do celular (@lid, uma linha, logo abaixo) e o ack do stanza
# <status> (o segundo RUN, mais abaixo).
#
# ⚠️ Esta NÃO é a versão recomendada. A recomendada é a imagem 2.4 de
# `docker/evolution-cb/` (o porquê está no README de lá). Esta só serve a
# quem ainda roda a 2.3.x e não pode trocar agora, e não resolve o
# "Aguardando mensagem" do cliente: a Baileys 6 não conhece o LID e mantém
# duas sessões de criptografia por aparelho, o que a Baileys 7 resolve (sem
# o 463, só a partir da 7.0.0-rc13).
#
# ── O problema (o eco do celular) ───────────────────────────
# O WhatsApp migrou o endereçamento das conversas de telefone
# (`5511999999999@s.whatsapp.net`) para um identificador interno
# (`100000000000102@lid`). Medido na instância do escritório em 27/07/2026:
# 263 dos 551 chats já migraram.
#
# Quando o operador manda mensagem pelo CELULAR pareado, o eco chega ao
# webhook endereçado por `@lid` e SEM telefone em campo nenhum da chave. O CRM
# não tem como saber de qual conversa é e descarta. Medido: 119 de 143 ecos
# perdidos em ~29h — 83%. Mensagem de cliente: nenhuma perdida (a entrada
# chega com telefone).
#
# ── A causa, com data ───────────────────────────────────────
# Em mensagem `fromMe` de conversa 1:1 o telefone da outra ponta vem no
# atributo `peer_recipient_pn`, e a Baileys 6.7.19 lê apenas `sender_pn`.
# O conserto é o PR WhiskeySockets/Baileys#1654, aceito em 2025-09-07 — SETE
# DIAS depois da 6.7.19 (2025-08-31) —, e nunca trazido de volta para a linha
# 6.x (conferido nos tarballs publicados: `peer_recipient_pn` aparece 0 vezes
# na 6.7.19 e na 6.7.23).
#
# ── Por que UMA linha basta ─────────────────────────────────
# A Evolution 2.3.2 já consome `key.senderPn` e troca o `@lid` pelo telefone
# sozinha, em três lugares (`messages.set`, `messages.upsert`,
# `messages.update`). E o CB CRM já lê esse campo em `phoneJidFromKey`. Ou
# seja: assim que a Baileys preencher `senderPn` no eco, o conserto se fecha
# pelos dois lados, sem UMA linha de mudança no CRM.
#
# ── Por que imagem DERIVADA, e não rebuild do fonte ─────────
# ⚠️ A Evolution 2.3.2 declara `"baileys": "github:WhiskeySockets/Baileys"` —
# dependência git sem tag nem commit. Estarmos na 6.7.19 é acidente da data em
# que a imagem foi construída. Quem reconstruir a 2.3.2 do fonte HOJE puxa o
# master (linha 7.x), que removeu `isJidUser` — a Evolution 2.3.2 importa essa
# função e o container entra em crash-loop.
#
# Por isso: `FROM` a imagem EXATA que já está rodando (de preferência por
# digest) e patch por cima. Funciona porque o `tsup` da Evolution não embute a
# baileys no bundle — ela fica em `node_modules/`, carregada em runtime.
#
# ── Como construir ──────────────────────────────────────────
# Passe como BASE_IMAGE a imagem OFICIAL da 2.3.x, com o digest — por
# exemplo
#   evoapicloud/evolution-api:v2.3.2@sha256:c9cfcc5340d7e872062fe853e7ca8236883654d6dd06e8fe820ad8b95d3c376b
# (o workflow evolution-lid-fix.yml faz isso). Nunca uma -lidfix que já
# esteja rodando: o build recusa base já patcheada. Se o serviço ainda roda
# a oficial, ela é a que sai de:
#   docker service inspect evolution_evolution \
#     --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'
# Ver docs/EVOLUTION-LID-FIX.md para o procedimento completo.
# ============================================================

ARG BASE_IMAGE
FROM ${BASE_IMAGE}

# ── A imagem base, medida em 28/07/2026 no registro ─────────
#
#   evoapicloud/evolution-api:latest
#   @sha256:3e30bb3dd00d0347430f3609722db6e50e5cd66df4acfbc3777ff8330f2bc2d7
#   criada 2025-09-02 (o dia da tag 2.3.2) · revision c2085b59
#   Alpine · node 20.19.4 · WorkingDir /evolution · User "" (root)
#
# ⚠️ NÃO existe `USER root` aqui de propósito. A base já roda como root, então
# a linha seria redundante — e, no dia em que a base virar não-root, ela faria
# a imagem patcheada rodar como root em silêncio, trocando o usuário do
# serviço sem ninguém decidir isso. Sem ela, esse dia vira um "permission
# denied" no build, que é uma decisão humana e não um efeito colateral.
#
# ⚠️ A tag `:latest` JÁ ANDOU: em 28/07/2026 ela apontava para
# sha256:966625…, diferente do digest acima. Por isso o `BASE_IMAGE` deve vir
# sempre COM digest, e da imagem OFICIAL — nunca `:latest` solto.

# ⚠️ CADA `grep` ABAIXO É UMA TRAVA, NÃO ENFEITE.
#
# `sed` que não casa nada sai com status 0 — sem as travas o build "passa"
# sem ter aplicado patch nenhum, e a imagem publicada seria idêntica à
# original. Já aconteceu com gente que documentou este mesmo conserto.
#
# A trava do ANTES é a que importa mais: ela garante que a base é mesmo uma
# 6.x não-patcheada. Se a imagem já vier com Baileys 7 (que tem
# `peer_recipient_pn` de fábrica), o build falha em vez de publicar uma imagem
# que ninguém sabe o que é.
#
# Tudo em `if ... fi`, nunca `cmd && { erro; }`: sob `set -e`, um `&&` cujo
# lado esquerdo falha devolve status 1 para a lista inteira, e o comportamento
# nesse caso VARIA entre bash, dash e o ash do busybox. Como não se sabe qual
# shell a imagem base traz, a forma explícita é a única sem ambiguidade — e
# aqui um falso "passou" publicaria uma imagem sem patch nenhum.
RUN set -eu; \
    alvos="$(find / -type f -path '*/node_modules/baileys/lib/Utils/decode-wa-message.js' 2>/dev/null || true)"; \
    if [ -z "$alvos" ]; then \
      echo 'ERRO: não achei decode-wa-message.js da baileys na imagem base.'; \
      exit 1; \
    fi; \
    n=0; \
    for f in $alvos; do \
      echo "alvo: $f"; \
      if grep -q 'peer_recipient_pn' "$f"; then \
        echo "ERRO: $f já contém peer_recipient_pn — base já patcheada (uma -lidfix? use a imagem OFICIAL como BASE_IMAGE), ou já é linha 7.x."; \
        exit 1; \
      fi; \
      if ! grep -q 'senderPn: stanza?.attrs?.sender_pn,' "$f"; then \
        echo "ERRO: linha original ausente em $f — versão inesperada da baileys."; \
        exit 1; \
      fi; \
      sed -i 's|senderPn: stanza?\.attrs?\.sender_pn,|senderPn: stanza?.attrs?.sender_pn \|\| stanza?.attrs?.peer_recipient_pn,|' "$f"; \
      if ! grep -q 'senderPn: stanza?.attrs?.sender_pn || stanza?.attrs?.peer_recipient_pn,' "$f"; then \
        echo "ERRO: o patch não aplicou em $f."; \
        exit 1; \
      fi; \
      if ! node --check "$f"; then \
        echo "ERRO: $f não parseia depois do patch."; \
        exit 1; \
      fi; \
      n=$((n+1)); \
    done; \
    echo "patch aplicado e verificado em $n arquivo(s)."

# ── O segundo conserto: o ack do stanza <status> (04/11/2026) ─
#
# O WhatsApp passou a entregar o Status (stories) dos contatos a ALGUMAS
# contas como um stanza `<status>` de topo, em vez de
# `<message from="status@broadcast">`: mudança gradual, conta por conta
# (WhiskeySockets/Baileys#2858). A Baileys 6.7.19 só registra handler para
# `message`, `call`, `receipt`, `notification` e `ack,class:message`, então o
# `<status>` nunca recebe ack, e ~50 min depois o servidor encerra o stream
# cobrando-o (`stream:error` com `<ack class="status" type="media|text">`, que
# a Baileys mapeia para 500). Na reconexão ele reentrega o mesmo `<status>`,
# e a entrada da conta fica represada atrás dele. Reiniciar a instância,
# parear de novo pelo QR e o `readStatus` não resolvem.
#
# O conserto é o do PR WhiskeySockets/Baileys#2866, o mesmo da imagem 2.4
# (`docker/evolution-cb/baileys+7.0.0-rc13.patch`): confirmar o stanza pelo
# `sendMessageAck` que já existe, SEM código de erro (um NACK o deixaria
# pendente no servidor). O stanza não é decodificado: o CRM não lê Status.
#
# Na 6.7.19, `lib/Socket/messages-recv.js` é o mesmo arquivo, byte a byte, na
# variante amd64 da imagem base medida acima, na da tag oficial `v2.3.2`
# (sha256:c9cfcc53…) e no tarball do npm (SHA-256 3b741db7…, conferido em
# 04/11/2026). Nele, `sendMessageAck` (linha 35) e
# `onUnexpectedError` (tirado do socket na linha 16) estão no escopo dos
# `ws.on('CB:…')` (linhas 1023–1037). O handler entra na MESMA linha da
# âncora, antes dela: assim o texto novo não precisa de quebra de linha (o
# `\n` na substituição não se comporta igual em todo `sed`), e a ordem de
# registro não importa, porque cada handler é de um evento.
#
# As travas: a âncora está lá UMA vez; `CB:status` não existe antes (base já
# patcheada, ou Baileys que já confirma o `<status>`); as duas funções que o
# handler chama estão no arquivo (sem elas, o primeiro `<status>` lançaria
# ReferenceError dentro do listener); depois, o handler está lá UMA vez, colado
# na âncora, e o arquivo parseia.
RUN set -eu; \
    alvos="$(find / -type f -path '*/node_modules/baileys/lib/Socket/messages-recv.js' 2>/dev/null || true)"; \
    if [ -z "$alvos" ]; then \
      echo 'ERRO: não achei messages-recv.js da baileys na imagem base.'; \
      exit 1; \
    fi; \
    n=0; \
    for f in $alvos; do \
      echo "alvo: $f"; \
      if [ "$(grep -c -F "ws.on('CB:notification', async (node) => {" "$f")" != 1 ]; then \
        echo "ERRO: a âncora ws.on('CB:notification' não está UMA vez em $f — versão inesperada da baileys."; \
        exit 1; \
      fi; \
      if grep -q -F 'CB:status' "$f"; then \
        echo "ERRO: $f já tem CB:status — base já patcheada, ou Baileys que já confirma o <status>."; \
        exit 1; \
      fi; \
      if ! grep -q -F 'const sendMessageAck = async ({ tag, attrs, content }, errorCode) => {' "$f"; then \
        echo "ERRO: sendMessageAck ausente em $f — versão inesperada da baileys."; \
        exit 1; \
      fi; \
      if ! grep -q -F ' onUnexpectedError, ' "$f"; then \
        echo "ERRO: onUnexpectedError ausente em $f — versão inesperada da baileys."; \
        exit 1; \
      fi; \
      sed -i "s|ws\.on('CB:notification', async (node) => {|ws.on('CB:status', (node) => { sendMessageAck(node).catch(error => onUnexpectedError(error, 'acking status')); }); &|" "$f"; \
      if [ "$(grep -c -F "ws.on('CB:status', (node) => { sendMessageAck(node).catch(error => onUnexpectedError(error, 'acking status')); }); ws.on('CB:notification', async (node) => {" "$f")" != 1 ]; then \
        echo "ERRO: o handler do <status> não entrou em $f."; \
        exit 1; \
      fi; \
      if ! node --check "$f"; then \
        echo "ERRO: $f não parseia depois do patch."; \
        exit 1; \
      fi; \
      n=$((n+1)); \
    done; \
    echo "ack do <status> aplicado e verificado em $n arquivo(s)."

# Marca de origem: sem isto não há como saber, olhando a imagem em execução,
# se ela é a original ou a patcheada. O ARG declarado antes do FROM não vale
# dentro do estágio: sem repeti-lo aqui, o rótulo da base saía vazio.
ARG BASE_IMAGE
LABEL br.com.cbadvogados.lid-fix="baileys PR#1654 (sender_pn || peer_recipient_pn)"
LABEL br.com.cbadvogados.status-ack="baileys PR#2866 (ack do <status>, issue #2858)"
LABEL br.com.cbadvogados.lid-fix.base="${BASE_IMAGE}"
