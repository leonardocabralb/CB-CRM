# Plano — 3 features do inbox (continuação das 4 de 27/07)

> **O que é este arquivo.** Guia retomável das três funções que ficaram
> registradas como "o que o sistema não faz" no fim de `docs/plano-4-features.md`,
> e que o operador pediu para implementar em 2026-08-03.
>
> ⚠️ **Este documento envelhece.** Antes de decidir com base em algo aqui,
> confirme contra a realidade (grep, leitura do arquivo, query no banco). Ao
> achar divergência, corrija este arquivo no mesmo PR.

- **Criado:** 2026-08-03 · **Medido contra:** `main` @ `c4384c9`, produção `hxnhakmyxyhalbsktzwe`
- **Fluxo de trabalho:** o mesmo de `docs/plano-4-features.md` (revisar → executar →
  testar → fria → morna → corrigir → próxima)

---

## Estado

| Fase | Escopo | Estado | Migration |
| --- | --- | --- | --- |
| **A** | Busca salta para a mensagem | ⬜ pendente | `932` (1 coluna na RPC) |
| **B** | Agendar mídia e levar citação | ⬜ pendente | `933` |
| **C** | Tela global de agendadas | ⬜ pendente | nenhuma |

**Ordem recomendada: A → C → B.** A é a menor e a mais contida. C não precisa de
migration nenhuma e responde de quebra a uma pergunta que o operador já fez ("como eu
confiro que o agendador está vivo?"). **B é a maior e a mais arriscada** — é a única que
cria dado que pode apodrecer entre o agendamento e o envio.

---

## Ground truth (medido em 2026-08-03)

| Métrica | Valor | Consequência |
| --- | --- | --- |
| **O fio carrega TODAS as mensagens da conversa** | sem `limit` | **A fatia A não precisa de paginação nem de "carregar ao redor"** — o alvo do salto já está no DOM |
| Maior conversa | **158 mensagens** | idem; o DOM aguenta |
| Média por conversa | 15 | |
| Conversas com **mais de um** achado num termo comum | **2** | "para qual das 3 eu salto?" é pergunta real, não hipótese |
| Mensagens com mídia | 188 | o caminho de mídia é usado de verdade |
| **Mensagens que citam outra** | **0** | ⚠️ ver abaixo |
| Agendadas no banco | 1 | a tela global nasce quase vazia |
| Teto de legenda de mídia | **1024**, com a assinatura contada | ⚠️ ver Fase B |

⚠️ **A citação existe no código e nunca foi usada.** `reply_to_message_id` está ligado de
ponta a ponta — compositor → `send-message.ts` → `quoted` do transporte Evolution — e há
**zero linhas** em produção com a coluna preenchida. Ou seja: "a agendada não leva
citação" é uma lacuna numa função que o escritório ainda não adotou. Não é motivo para
cortar, mas é motivo para **não** pagar preço alto por ela.

---

## Fase A — A busca salta para a mensagem

**O que muda para o operador:** hoje, clicar num resultado da busca abre a conversa **no
fim**, e ele tem de rolar procurando o trecho que a lista acabou de mostrar. Passa a abrir
já parado na mensagem, com ela destacada.

### O que a medição mudou no desenho

O plano intuitivo seria "carregar as mensagens ao redor do alvo". **Não é preciso**: o fio
já busca `.eq('conversation_id').order('created_at')` **sem `limit`**. Toda mensagem da
conversa está renderizada. O problema é puramente de rolagem e âncora.

### ⚠️ O obstáculo real, e ele não é o scroll

`message-thread.tsx:651` tem um efeito que faz `el.scrollTop = el.scrollHeight`
**incondicionalmente**, com dependências `[messages, leadEvents, notas]`. As anotações e
os eventos do lead chegam em **buscas próprias, depois das mensagens** — então qualquer
salto seria desfeito uma ou duas vezes, alguns milissegundos depois, e o sintoma seria
"às vezes funciona".

→ Suprimir o auto-scroll enquanto houver salto pendente, com sinalizador em `ref`, e
liberar depois que o alvo entrar em quadro.

⚠️ **Registrado e fora do escopo:** esse mesmo efeito hoje **puxa o operador para o fim
sempre que chega mensagem nova**, mesmo que ele esteja lendo histórico. É defeito
pré-existente e independente; consertar junto misturaria duas coisas.

### Peças

| Onde | O quê |
| --- | --- |
| `932_cb_id_da_mensagem_achada.sql` | `CREATE OR REPLACE` da RPC devolvendo também `message_id` do achado mais recente. Uma coluna; índice e privilégios intactos |
| `message-thread.tsx` | âncora `data-message-id` em cada bolha; efeito de salto; supressão do auto-scroll; destaque temporário |
| `conversation-list.tsx` | o clique num resultado leva o `message_id` junto |
| `inbox/page.tsx` | estado `saltarParaMensagemId`, limpo depois de usado |
| `busca-em-mensagens.ts` | `AchadoNoTexto` ganha `mensagemId` |

### Armadilhas

- **Destacar é obrigatório, não enfeite.** Rolar sem destacar deixa o operador olhando uma
  tela cheia de balões sem saber qual era.
- **Salto para conversa JÁ aberta** não remonta o fio — o efeito precisa disparar por
  mudança do id-alvo, não por montagem.
- **Grupo usa o mesmo caminho** (a conversa é a mesma estrutura), mas segue sem poder ser
  testado enquanto `groups_enabled` estiver desligado.
- **A âncora é `messages.id`**, nunca `message_id` (o wamid do WhatsApp) — os dois existem
  na mesma tabela e confundi-los daria salto para lugar nenhum.

### 🚧 Decisão pendente

**Com 3 mensagens casando na mesma conversa, salta para qual?** A recomendação é **a mais
recente**, que é o que a lista já mostra no trecho — e é o menor caminho. Percorrer os
achados (↑/↓ como no WhatsApp) exige uma segunda RPC e navegação própria.

---

## Fase C — Tela global de agendadas

**O que muda para o operador:** hoje as agendadas só existem dentro da conversa. Não há
como perguntar "o que vai sair esta semana?" sem abrir conversa por conversa.

### Por que esta vem antes da B

Não precisa de migration nenhuma — a política `cb_scheduled_messages_select` já recorta
por conta — e **responde de quebra a uma pergunta que o operador já fez**: "como eu
confiro que o agendador está vivo, se o aviso só aparece quando dá problema?". A tela
global é o lugar natural para mostrar, sob demanda, "último ciclo há N minutos", sem
transformar o cabeçalho em papel de parede.

### Peças

| Onde | O quê |
| --- | --- |
| `src/app/(dashboard)/agendadas/page.tsx` | rota nova |
| `src/components/layout/sidebar.tsx` | entrada no menu |
| `src/hooks/use-agendadas-da-conta.ts` | busca da conta inteira |
| `src/components/scheduled/` | linha da lista e filtros, reusando o que a faixa já tem |

Colunas: **quando · para quem · canal · quem agendou · situação · prévia**.
Ações por linha: **abrir a conversa · executar agora · excluir** — os dois últimos já
existem na faixa e devem ser extraídos, não reescritos.

### Armadilhas

- ⚠️ **Conversa de grupo não tem contato.** `conversations.contact_id` é anulável; a
  coluna "para quem" precisa de `tituloDaConversa()`, senão grupo aparece em branco.
- ⚠️ **Canal de conversa de grupo é NULO** — vale a mesma regra de sempre: quem sabe o
  número é `cb_groups.channel_id`, via `canalDaConversa()`.
- ⚠️ **Não filtrar por campo do contato NA CONSULTA** — mesma armadilha da Fase 3: o embed
  LEFT filtra só o recurso embutido e as linhas que não casam continuam vindo.
- **Situação `sending` e `entrega_incerta` não podem oferecer "tentar de novo"** — a mesma
  guarda `podeDispararAgora` da faixa, senão o cliente recebe duas vezes.
- **A tela nasce com 1 linha.** Não aceitar "abri e funcionou" como teste.

### 🚧 Decisão pendente

**A tela mostra só a fila, ou também o histórico (enviadas e falhas)?** Recomendação:
**tudo, com a fila em cima e filtro de situação** — "o que saiu ontem?" é a segunda
pergunta natural de quem abre essa tela.

---

## Fase B — Agendar mídia e levar citação

É a maior e a única que **cria dado que pode apodrecer** entre o agendamento e o envio.

### Schema — `933_cb_agendada_com_midia_e_citacao.sql`

- `media_url`, `media_path`, `media_kind`, `media_filename`
- `reply_to_message_id`
- ⚠️ **Relaxar o CHECK do corpo.** Hoje é
  `length(btrim(body)) > 0 AND length(body) <= 4000`; mídia sem legenda é legítima e
  quebraria isso. Vira `media_url IS NOT NULL OR length(btrim(body)) > 0`.

### ⚠️ Os três riscos que só existem porque há horas entre agendar e enviar

**1. O arquivo pode sumir.** A mídia é enviada ao bucket no momento do agendamento e fica
lá até 365 dias. Se o objeto for removido, o envio falha às 3 da manhã. →

- o worker confere o objeto **antes** de disparar e falha com motivo legível;
- excluir a agendada tem de **apagar o objeto**, senão o bucket acumula órfão para sempre.

**2. A mensagem citada pode ser apagada.** O CRM já apaga/revoga mensagem. Uma resposta
agendada a uma mensagem que não existe mais é uma frase solta — e num escritório de
advocacia "Sim, pode ser" sem o que estava sendo respondido é pior que não enviar.

**3. ⚠️ O teto da legenda é 1024, não 4000 — e a assinatura entra só no envio.** Esta é a
armadilha mais afiada das três: hoje a agendada aceita 4000 caracteres porque é texto puro
(teto do WhatsApp: 4096). **Legenda de mídia tem teto de 1024, e a 923 valida esse teto
com a assinatura já somada.** Uma legenda de 1020 caracteres agendada hoje pode estourar no
envio de amanhã se a assinatura for ligada nesse meio-tempo. →

- validar **1024 menos o custo da assinatura atual** já no agendamento;
- **revalidar no envio**, falhando com motivo escrito em vez de mandar truncado.

### Peças

| Onde | O quê |
| --- | --- |
| `933_cb_...sql` | colunas + CHECK relaxado + FK da citação |
| `message-composer.tsx` | o relógio passa a valer com anexo e com citação na tela |
| `api/cb/scheduled/route.ts` | aceita mídia e citação; valida o teto certo |
| `scheduled/dispatch.ts` | envia mídia; confere objeto e citação antes |
| `scheduled-bar.tsx` | miniatura do anexo e marca de citação na linha |

### 🚧 Decisões pendentes

1. **Se o arquivo sumiu na hora do envio:** falhar e esperar gente (recomendado), ou enviar
   só a legenda?
2. **Se a mensagem citada foi apagada:** enviar sem a citação, ou falhar? Recomendação:
   **enviar sem a citação, com aviso visível na faixa** — o texto que a pessoa escreveu
   continua valendo por si.
3. **Áudio gravado na hora entra?** Ele não tem legenda e é o caso mais estranho de
   "gravei agora para mandar semana que vem".

---

## O que este plano NÃO cobre

- **Paginação da lista de conversas** e o painel de filtros no servidor — cortados na Fase
  5 das 4 features, com medição registrada lá.
- **Busca nas anotações internas.**
- **O auto-scroll que puxa para o fim** enquanto se lê histórico (defeito pré-existente,
  citado na Fase A).
- **Conversa de grupo**, que segue sem poder ser exercitada enquanto `groups_enabled`
  estiver desligado.
