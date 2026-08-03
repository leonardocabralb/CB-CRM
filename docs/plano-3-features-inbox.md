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
| **A** | Busca salta para a mensagem, e percorre os achados | ✅ **feita** (2026-08-03) | **nenhuma** |
| **C** | Tela global de agendadas | ✅ **feita** (2026-08-03) | **nenhuma** |
| **B** | Agendar mídia e levar citação | ⬜ pendente | `932` |

⚠️ **Feitas, mas ainda NÃO em produção.** As duas estão em `main` local; `origin/main`
segue em `c4384c9`. Empurrar dispara o deploy.

✅ **Decisões do operador (2026-08-03):** percorrer os achados com ↑/↓ · tela global mostra
tudo com filtro · anexo sumido **falha e espera gente** · citação apagada **sai sem a
citação, com aviso**.

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

### ⚠️ Percorrer os achados NÃO custa uma segunda consulta — e isso mudou o desenho

O operador escolheu ↑/↓ com contador ("2 de 5"), e a leitura óbvia disso seria "uma RPC
nova que devolve todos os ids que casaram na conversa". **Não precisa, e a razão vale
registrar:**

- o fio **já tem todas as mensagens da conversa carregadas** (sem `limit`);
- a regra de casamento do banco é `lower(unaccent(x))` — e o `semAcento()` que a Fase 5
  criou em `busca-em-mensagens.ts` faz **exatamente a mesma coisa**, com teste de
  equivalência já escrito.

Então a lista de achados **dentro** da conversa se calcula em JS, sobre dados completos, e
o ↑/↓ fica instantâneo em vez de ir ao banco a cada passo. **A Fase A não precisa de
migration nenhuma.**

⚠️ **Isto não é "meio a meio".** Quais CONVERSAS casam continua vindo do banco, completo.
O que roda em JS é só a enumeração dentro de uma conversa inteiramente carregada — as duas
pontas enxergam o mesmo universo, que é a regra que a Fase 5 fixou.

⚠️ **Duas guardas obrigatórias:**
- **Excluir mensagem apagada**, como a RPC faz (`deleted_at IS NULL`) — o fio renderiza a
  apagada como "mensagem apagada", e sem a guarda o ↑/↓ pararia nela.
- **Se o JS não achar nada** onde o banco achou, não mostrar a barra com "0 de 0": esconder.
  É a divergência improvável (caractere exótico) falhando para o lado silencioso.

### Peças — o que foi construído de fato

| Onde | O quê |
| --- | --- |
| `src/lib/inbox/achados-no-fio.ts` | função PURA: mensagens + termo → ids que casam, em ordem. É onde moram as três guardas da RPC. 15 testes |
| `message-thread.tsx` | âncora `data-message-id` em cada bolha (via `LinhaDaMensagem`); faixa "2 de 5" com ↑/↓; efeito de salto; supressão do auto-scroll **até o operador agir**; destaque enquanto for o achado corrente |
| `use-busca-em-mensagens.ts` | passou a expor `termoAplicado` — o termo que produziu os achados vigentes |
| `inbox/page.tsx` | espelha o termo da lista para o fio (são irmãos; a página é o único caminho entre eles) |
| `conversation-list.tsx` | avisa a página quando o termo assenta (`onTermoDeBusca`) |

⚠️ **Três coisas saíram diferentes do previsto acima**, e vale saber por quê:

- **Não existe sinal de "abriu pela busca".** Com a busca ativa a lista já está
  recortada, então toda conversa aberta ali É um resultado — o gatilho é a mudança do
  alvo, e ele cobre também "digitei o termo com a conversa já aberta".
- **O destaque não é temporário.** Com ↑/↓ é ele que responde "em qual dos onze eu
  estou"; apagar depois de alguns segundos deixaria a pergunta sem resposta.
- **O termo que chega ao fio é o ASSENTADO**, não o texto cru da caixa. Com o cru, a
  lista mostraria o resultado de "contrato" enquanto o fio destacava "contratos", e a
  página inteira re-renderizaria a cada tecla.

### O que a revisão pegou depois de pronto

Cinco lentes independentes sobre o commit, cada achado passando por um refutador e um
verificador que **mede** em vez de argumentar. Nenhum achado caiu; os que mordiam:

- ⚠️ **A supressão do auto-scroll não podia ser permanente.** O primeiro desenho a
  mantinha por toda a vida da busca — e a caixa de busca é da LISTA, do outro lado da
  tela, então não há por que apagá-la para responder ao cliente. Resultado: a mensagem
  recém-enviada e a anotação recém-escrita nasciam abaixo da dobra e **nada rolava até
  elas**. Agora o salto solta a rolagem quando o operador age.
- ⚠️ **Voltar para a aba jogava o operador para o TOPO da conversa.** O `resyncToken`
  troca o fio por um spinner, o `scrollHeight` desaba e o navegador grampeia o
  `scrollTop` em zero; como o `alvoId` continua o mesmo, nada re-centralizava — e a
  faixa seguia dizendo "11 de 11" sobre uma bolha a meses de rolagem. Corrigido pondo
  `messages` nas dependências do efeito que centraliza.
- ⚠️ **`semAcento` apagava `^`, `` ` ``, `´` e `¨` inteiros** (`\p{Diacritic}` inclui o
  acento que existe sozinho). Buscar `^^^` virava agulha VAZIA, e `includes("")` é
  verdadeiro para tudo: acendia **todas** as bolhas da conversa. Virou `\p{Mn}`.
- **O piso de 3 letras era medido no texto cru**, e o banco mede no normalizado.
- **`btrim` do Postgres apara só o espaço U+0020**; o `.trim()` do JS apara NBSP e
  quebra de linha também. Agora o termo vai aparado para as duas pontas.
- **Um byte U+0000 cru no fonte** deixava `message-thread.tsx` **binário** para o `grep`
  e o `file` — as buscas devolviam zero linhas em silêncio.

### Armadilhas

- **Destacar é obrigatório, não enfeite.** Rolar sem destacar deixa o operador olhando uma
  tela cheia de balões sem saber qual era.
- **Salto para conversa JÁ aberta** não remonta o fio — o efeito precisa disparar por
  mudança do id-alvo, não por montagem.
- **Grupo usa o mesmo caminho** (a conversa é a mesma estrutura), mas segue sem poder ser
  testado enquanto `groups_enabled` estiver desligado.
- **A âncora é `messages.id`**, nunca `message_id` (o wamid do WhatsApp) — os dois existem
  na mesma tabela e confundi-los daria salto para lugar nenhum.
- **Apagar a busca com a conversa aberta tem de sumir com a barra.** Um "2 de 5" pendurado
  sobre um termo que não está mais na caixa é pior que não ter contador.
- **Chegar ao fim da lista:** dar a volta ou parar? Parar, com as setas desabilitadas — dar
  a volta em silêncio faz parecer que há mais achados do que há.

✅ **Decidido:** entra na mais recente e permite percorrer todas com ↑/↓ e contador.

### O que fica sabido, e não foi consertado

- ⚠️ **As duas normalizações não são idênticas, nos DOIS sentidos.** O `unaccent` do
  Postgres dobra `…`, `–` e `×`; o `semAcento` não. Replicar a tabela do `unaccent` (são
  centenas de entradas) faria o código AFIRMAR uma equivalência que não teria — pior que
  a diferença medida e escrita. Exposição: 5 mensagens em 784, e ainda é preciso que o
  trecho procurado contenha o caractere.
- ⚠️ **O teto de 1000 linhas do PostgREST chega sozinho.** A busca de mensagens do fio não
  tem `limit`, mas a resposta é cortada em 1000 sem erro e sem aviso. A maior conversa tem
  158 mensagens hoje; passando disso, o contador começa a mentir por crescimento de dados,
  sem ninguém mudar código.
- **Mensagem nova do cliente não puxa mais a tela enquanto o salto vale.** É melhor que o
  contrário (perder o lugar que se estava lendo), mas é mudança de comportamento.
- **Conversa de grupo segue sem poder ser exercitada** — `groups_enabled` desligado.

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

### O que a implementação mudou em relação a este plano

- ⚠️ **`canalDaConversa()` seria ERRADO aqui**, ao contrário do que a armadilha acima
  manda. Aquela regra existe porque conversa de grupo tem `conversations.channel_id`
  nulo — mas a agendada tem `channel_id` **próprio, NOT NULL**, fixado no agendamento
  justamente para não seguir a conversa (P4.3). A tela mostra o canal *da agendada*.
- **São TRÊS consultas, não uma.** Fila e acervo têm ordens opostas; numa consulta só
  com teto, o `ORDER BY` teria de escolher uma — e a errada engoliria a outra inteira.
- **Só as enviadas paginam.** Fila e falhas vêm completas: uma falha de seis meses
  atrás continua esperando decisão, e é ela que a paginação empurraria para fora.
- **A ordenação não foi reescrita.** `ordenarParaTela` já existia e é testada; ganhou
  só o `sent_at` no acervo — sem isso, uma mensagem antecipada pelo "Executar agora"
  aparecia no acervo com data futura.
- **As contagens das abas vêm do banco** (`count: 'exact'`), não de contar a lista
  carregada. Contando em JS, a aba "Enviadas" diria 50 numa conta com 300.

### O que a revisão pegou depois de pronto

- ⚠️ **O aviso "o cliente escreveu depois" (P4.4) tinha ficado de fora** — e ele pesa
  MAIS aqui que na faixa: quem está nesta tela decide "Executar agora" sem ver a
  conversa. Sem ele, mandaria "confirmo nosso horário de amanhã" para quem cancelou
  de madrugada.
- **Linha enviada mostrava a hora MARCADA**, não a hora em que saiu.
- **As abas afirmavam "Falhas 0" enquanto a carga falhava** — quatro zeros logo acima
  da caixa que admite não saber de nada.
- **A faixa de saúde não recarregava com as ações**: cancelar a última falha zerava a
  aba e a faixa seguia dizendo que havia uma esperando decisão.
- **A saúde contava só `pending`**, então dizia "não há nada na fila" com uma linha
  travada em `sending` visível logo abaixo.
- **`temMaisEnviadas` comparava com o limite pedido**, e morria no teto de 1000 linhas
  do PostgREST — o acervo além disso ficaria inalcançável, em silêncio.
- **`temMais` e `contarPorSituacao` nasceram com teste e sem chamador** (a regra viva
  estava inline no hook). Saíram.

✅ **Decidido: tudo — fila em cima, com filtro de situação.** Consequências a respeitar:

- **Ordenação é por situação primeiro, não por data.** A fila ordena por `scheduled_for`
  crescente ("o que sai primeiro"); o histórico, por `sent_at` decrescente ("o que saiu por
  último"). Uma ordem só para as duas responde mal a uma das perguntas.
- **A tela cresce sem teto.** Hoje é 1 linha, mas histórico só acumula. Nasce com um teto
  de linhas e um "carregar mais" — diferente da lista de conversas, aqui não há motivo para
  carregar tudo.
- **Falha antiga não é falha nova.** A contagem que o cabeçalho já usa não distingue; a
  tela precisa deixar claro o que ainda espera decisão.

---

## Fase B — Agendar mídia e levar citação

É a maior e a única que **cria dado que pode apodrecer** entre o agendamento e o envio.

### Schema — `932_cb_agendada_com_midia_e_citacao.sql`

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
| `932_cb_...sql` | colunas + CHECK relaxado + FK da citação com `ON DELETE SET NULL` |
| `message-composer.tsx` | o relógio passa a valer com anexo e com citação na tela |
| `api/cb/scheduled/route.ts` | aceita mídia e citação; valida o teto certo |
| `scheduled/dispatch.ts` | envia mídia; confere objeto e citação antes |
| `scheduled-bar.tsx` | miniatura do anexo e marca de citação na linha |

### ✅ Decidido, e o que cada escolha obriga

**1. Arquivo sumido → falha e espera uma pessoa.** Nada sai pela metade. Obriga:

- conferência do objeto **antes** de reivindicar a linha, com motivo legível
  (`anexo_sumiu`), e não a mensagem crua do storage;
- a falha entra na contagem que acende o aviso do cabeçalho — senão "falhou às 3h" só se
  descobre abrindo a conversa.

**2. Citação apagada → sai sem a citação, com aviso na faixa.** Obriga:

- FK `ON DELETE SET NULL` (nunca RESTRICT: apagar mensagem não pode falhar por causa de uma
  agendada);
- ⚠️ **uma coluna própria para "havia citação e ela sumiu"**. Só o `NULL` não distingue
  "nunca citou" de "citava e perdeu" — e sem essa distinção o aviso na faixa é impossível
  de escrever. É a mesma lição da `entrega_incerta` (926): `failed` sozinho não dizia se a
  mensagem tinha saído.

### 🚧 Pendente

**Áudio gravado na hora entra?** Ele não tem legenda e é o caso mais estranho de "gravei
agora para mandar semana que vem". Fica para decidir na hora de codar a fase — não muda
nada nas outras duas.

---

## O que este plano NÃO cobre

- **Paginação da lista de conversas** e o painel de filtros no servidor — cortados na Fase
  5 das 4 features, com medição registrada lá.
- **Busca nas anotações internas.**
- **O auto-scroll que puxa para o fim** enquanto se lê histórico (defeito pré-existente,
  citado na Fase A).
- **Conversa de grupo**, que segue sem poder ser exercitada enquanto `groups_enabled`
  estiver desligado.
