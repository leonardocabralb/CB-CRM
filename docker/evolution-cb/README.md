# Imagem `evolution-api-cb` — Evolution 2.4 (develop) com a citação do cliente

Construída pelo workflow `.github/workflows/evolution-cb.yml` a partir do
**mesmo commit** da imagem `evoapicloud/evolution-api:homolog` que está em
produção (`e273b904`, build de 14/07/2026), com duas diferenças:

1. `2708-citacao.patch` — o PR upstream evolution-foundation/evolution-api#2708
   ("preserve reply metadata when flattening extendedTextMessage"): o
   `prepareMessage` da 2.4 achata `extendedTextMessage` em `conversation` e
   descartava o `contextInfo` (stanzaId/quotedMessage) — toda resposta de
   cliente citando uma mensagem nossa chegava sem a citação (issue #2713).
   O patch copia o `contextInfo` para o nível de cima antes de apagar o
   invólucro. 27 linhas, um arquivo.
2. O Dockerfile passa a copiar `prisma.config.ts` para a imagem — sem ele o
   Prisma 7 não roda `migrate deploy` (medido em 09/09/2026: a `homolog` não o
   traz e a produção sobe com um bind mount de `/root/evolution/`).

Mesmo commit = mesmas migrations: trocar entre esta imagem e a `homolog` não
mexe no banco. O rollback é só trocar a imagem de volta.

Quando o upstream mesclar o #2708 (ou publicar uma `homolog` com o arquivo),
esta imagem deixa de ser necessária. Plano vivo: `docs/PLANO-baileys-7.md`, P10.
