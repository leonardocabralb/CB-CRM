# Computador de ligações

Um contêiner por número de WhatsApp (conexão por QR Code): o Chrome com o
WhatsApp Web, numa tela e com áudio virtuais, comandado por um orquestrador em
Node. O CRM pede para ligar, atender e desligar pela API interna; o atendente
fala pela aba do CRM (WebRTC, pela página-ponte); a máquina grava os dois
lados e manda ao CRM os avisos e as gravações.

Desenho, medições e decisões: `docs/PLANO-ligar-pelo-crm.md` (§8). Regras:
`.claude/rules/ligacoes.md`. Operação na VPS: `docs/INFRA-VPS.md` (§4) e
`ops/vps/ligacoes/criar-maquina.sh`.

## Peças

- `iniciar.sh`: tela virtual (Xvfb), áudio virtual (PulseAudio) e o Chrome
  COM a caixa de areia; depois entrega o processo ao orquestrador.
- `src/`: o orquestrador. `ligacao.ts` é a máquina de estados; `whatsapp.ts`,
  a tela do WhatsApp (todos os seletores em `SELETORES`); `servidor.ts`, a API
  interna; `avisos.ts` e `gravacao.ts`, o que vai ao CRM; `ponte.ts` com
  `ponte.html`, a ponte de áudio.
- `politica.json`: a política do Chrome (microfone liberado só para o
  WhatsApp e a ponte; sem câmera; sem download).
- `seccomp/chrome.json`: o perfil seccomp padrão da Docker 28.0.1
  (`moby/profiles/seccomp/default.json`) com UMA regra a mais, que libera
  `clone`, `unshare` e `setns` — o que a caixa de areia do Chrome precisa
  para criar os namespaces de usuário (medido em 10/11/2026). Junto com
  `no-new-privileges` e só `SYS_CHROOT` das capacidades.

## Testes

Rodam no `vitest` da raiz (`npm run test`), sem passo próprio no CI. O
`playwright-core`, o `typescript` e o `@types/node` têm a mesma versão aqui e
na raiz (há um teste que confere).

## A imagem

Montada na própria VPS a partir desta pasta (`docker build`), nunca por
registro de imagens. A major do Node é a do `.nvmrc`.
