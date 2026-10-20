# Plano — Avisos do sino no navegador (pop-up e som)

> **O que é este arquivo.** Guia retomável do pedido do operador de 20/10/2026:
> menção em anotação e tarefa acendiam só o sino; passam a gerar também o
> aviso do navegador (pop-up), com som. Editado a cada fase: ao iniciar uma,
> registra-se aqui a anterior (objetivo, arquivos, resultado MEDIDO).
>
> ⚠️ **Este documento envelhece.** Antes de decidir com base nele, confirme
> contra o código e o banco; divergência se corrige no mesmo PR.

- **Criado:** 2026-10-20 · **Medido contra:** `main` @ `142da14b`, produção `hxnhakmyxyhalbsktzwe`
- **Fluxo:** implementar → typecheck/lint/test (Node 22) → preview 1440×900+ →
  revisar 2× → PR.

---

## Estado

| Fase | Escopo | Estado | Migration | PR |
| --- | --- | --- | --- | --- |
| **1** | Ouvinte do sino no navegador, som do CRM, cartão com as chaves novas | ✅ implementada e testada no preview (20/10/2026); falta o PR | nenhuma | — |

## Como era (20/10/2026)

- O aviso do navegador (`use-browser-notifications.ts`) ouvia só INSERT em
  `messages` de cliente. O sino (`use-unread-notifications.ts`) ouvia
  `notifications` e só somava o número da barra lateral.
- O CRM não tocava som nenhum. O pop-up de mensagem saía sem `silent`: o som,
  se houver, é o padrão do sistema para o Chrome.

## Medido em produção (30 dias até 20/10/2026, só leitura)

| Aviso | Total | Pessoas | Pico por pessoa |
| --- | --- | --- | --- |
| `note_mention` | 104 | 9 | 10/dia, 2/minuto |
| `task_assigned` | 30 | 5 | 6/dia |
| `note_reply` | 17 | 5 | 3/dia |
| `conversation_assigned` | 7 | 3 | 1/dia (6 por automação) |
| `whatsapp_alert` | 6 | 2 | 2/dia |
| `task_reply` | 1 | 1 | 1/dia |

- Mediana até o CLIQUE no sino: menção ~24 h, tarefa ~17 h; 15 menções e 5
  tarefas sem clique há mais de 2 dias. "Lido" = clicou no sino ou no Meu dia
  (ler a anotação no fio não marca).
- Mensagens de cliente: ~620 por dia útil na conta, antes do recorte do perfil.

## Decisões do operador (20/10/2026, as seis recomendações aceitas)

- **D1.** Chave PRÓPRIA "Menções e tarefas" no cartão, separada da de
  mensagens. Nasce LIGADA (`sino: true` no padrão): vale para quem já deu a
  permissão do navegador; para quem não deu, ligar pede a permissão.
- **D2.** Todo tipo do sino vira pop-up: menção, resposta à anotação, tarefa,
  resposta da tarefa, conversa atribuída e o alerta do WhatsApp (só admins o
  recebem).
- **D3.** "Conexões que avisam", "quais conversas" e o recorte do perfil NÃO
  calam o aviso do sino (o sino também não recorta). A menção numa conversa
  fora do perfil leva à tela "fora da sua área", como o clique no sino.
- **D4.** Som do CRM com chave por tipo: ligada em menções e tarefas,
  desligada em mensagens de cliente (volume). Desligada = como antes (o
  sistema decide), nunca `silent` forçado: quem ouvia o som do Windows nas
  mensagens continua ouvindo.
- **D5.** "Mostrar o texto" vale para os dois tipos de aviso.
- **D6.** Clicar no pop-up marca o aviso como lido no sino.

## Desenho

- `src/lib/notifications/aviso-do-sino.ts` (puro): do `payload.new` ao pop-up
  (título, corpo, `tag` `sino:<id>`, destino por `rotaDoAviso`) ou ao motivo
  do silêncio (sem a Caixa de entrada, outra pessoa, já lido, repetido,
  conversa à vista). Sem a Caixa de entrada o cartão nem aparece, então não
  há pop-up: a pessoa não teria onde desligá-lo (achado da revisão).
- `src/lib/notifications/som-do-aviso.ts`: toque curto gerado pelo Web Audio
  (sem arquivo). O Chrome só deixa tocar depois de um clique na aba: sem ele
  (ou sem a API que o confirma), devolve false e o pop-up sai sem `silent` (o
  sistema decide). Uma vez por 10 s no máximo, ENTRE ABAS (`navigator.locks`
  + carimbo no `localStorage`; a trava se solta na hora): duas abas recebem o
  mesmo INSERT.
- `src/hooks/use-avisos-do-sino-no-navegador.ts`: ouve INSERT em
  `notifications` com `user_id=eq.<login>` (a RLS já recorta), num tópico
  novo a cada inscrição. Montado no `BrowserNotificationsListener`, dentro da
  porta de entrada, como o de mensagens.
- Aceito: com duas abas e só uma clicada, a outra deixa o som com o sistema —
  no Windows podem tocar os dois. O som do CRM ignora o "Não perturbe" do
  sistema (é áudio da página); quem não quiser desmarca a caixa.
- `use-browser-notifications.ts`: o som do CRM nas mensagens, quando ligado.
- Cartão: duas chaves (mensagens, com as opções de hoje; menções e tarefas),
  "Mostrar o texto" para as duas, "Tocar o som do CRM" por tipo com "Ouvir".

## Fora deste plano

- Aviso com o CRM fechado ou no celular (Web Push + service worker): Fase 2
  de `docs/PLANO-app-no-celular.md`.
- Convidar a equipe a ligar os avisos (a preferência é do navegador de cada
  um; não há como medir quem ligou).

## Teste de ponta a ponta (preview)

Pop-up e som com uma linha de teste em `notifications` para o login do
operador, gravada e apagada com o "pode gravar" dele, e a limpeza conferida
por contagem.

### Medido em 20/10/2026 (preview da branch, porta 3107, sem escrita)

O navegador interno nega a permissão: `Notification` trocado por um
registrador (memória do método: o cartão lido por navegação do cliente).

- Cartão: porta nova (preferência vazia) abre com "Mensagens" desligada e
  "Menções e tarefas" LIGADA (D1); ligar as mensagens grava
  `{"ativo":true,…,"sino":true,"somNoSino":true,"somNasMensagens":false}`.
- Tráfego REAL de clientes, som das mensagens desligado: 2 avisos com
  `silent: false` (o sistema decide). Som ligado depois de um clique real na
  aba: 2 avisos com `silent: true` e o carimbo `cb-som-do-aviso` gravado
  (14 s entre eles, acima dos 10 s do intervalo).
- `.click()` por JS não conta como ativação (`hasBeenActive` falso): só o
  clique real libera o som — o mesmo que a pessoa faz.
- **Sino, com o "pode gravar" do operador:** uma linha `note_mention` de
  teste (id `e2e0aaaa-…-000000000420`, conversa do lead de teste) gravada às
  18:08:23 UTC. O pop-up saiu 0,2 s depois, com título e corpo do aviso,
  `tag` `sino:<id>` e `silent: true`, e o som do CRM carimbado no mesmo
  instante; o número do sino foi de 1 para 2. O clique abriu a conversa do
  lead de teste no inbox, disparou `cb:abrir-conversa`, fechou o pop-up e
  marcou o aviso como lido (`read_at` 18:08:36; o sino voltou a 1). A linha
  foi apagada e a contagem conferida em 0.
- Depois da revisão (porta da Caixa de entrada, tópico novo por inscrição,
  som só com a ativação confirmada e trava que se solta na hora): testes,
  typecheck e lint verdes; o ponta a ponta não foi repetido (seria outra
  escrita em produção).
