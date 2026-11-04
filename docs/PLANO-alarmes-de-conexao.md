# Plano — alarmes de conexão: ver a conexão travada em minutos

Documento INTERNO (não vai para quem instala). Estudo e plano, sem código.
As decisões do operador (04/11/2026) estão logo depois do resumo; as
perguntas que as pediram, na seção 7. Medido em 04/11/2026, só leitura: o
conector de leitura do Supabase (banco e logs da plataforma) e os relatórios
semanais da sentinela. A VPS não foi lida.

Legenda: B-Com = Bancário - Comercial, B-Jur = Bancário - Jurídico, T-Com =
Trabalhista - Comercial, T-Jur = Trabalhista e Previdenciário - Jurídico.
Horários em Brasília.

## Por quê

De 02/11 13h a 04/11 10:04, a T-Jur (Evolution 2.4) caiu a cada ~50 min e a
entrada congelou. O WhatsApp passou a mandar a essa conta o Status dos
contatos num stanza `<status>` que a Baileys não confirmava. Causa e conserto:
`docs/INFRA-VPS.md` §8 (04/11). A entrada chegou a 24 h de atraso. Os envios do CRM ficaram em 1 ✓: as mensagens
tinham chegado aos clientes, mas o recibo estava preso na mesma fila.

Os sinais existiam: a sentinela avisou "WhatsApp sem receber" em 03/11 10:05,
e o cabeçalho mostrou o âmbar da 1002 ("Entregando com N h de atraso") em
parte do tempo. Mesmo assim, ninguém agiu por ~24 h. O operador pediu o que
fazer para não se repetir, e esta frente é a da detecção: o que cada sinal
mostrou, o que cada alarme proposto teria mostrado e onde o aviso precisa
aparecer para ser visto.

## Resumo

1. **O que falhou foi o aviso chegar a alguém, mais do que a detecção.** O
   aviso de 03/11 10:05 foi a 2 administradores e segue sem leitura. Dos 5
   avisos de problema da sentinela desde 13/10, 2 foram lidos, 3,7 h e 31 h
   depois; nenhum dos 6 avisos desde 25/10 foi lido. Um alarme novo no mesmo
   sino teria o mesmo destino.
2. **O âmbar da 1002 ficou apagado o dia útil inteiro de 03/11** (03:52 →
   20:52), porque nenhuma mensagem chegou e a medição vale 1 h. É o limite que
   `canais.md` já declara: o eixo do atraso não vê a conexão que para de
   receber.
3. **"Envios sem recibo" (c) é o sinal mais forte que o CRM pode medir.** De
   17/09 a 02/11, nenhuma sequência de 5 envios seguidos em 3 conversas ficou
   sem recibo. Numa hora normal, 83 de 85 envios das conexões sadias tiveram
   recibo em até 5 min, com mediana de ~1 s. Na T-Jur, 0 de 20 em 1 h. Teria
   acendido em 03/11 por volta de 09:30, na tela de quem estava enviando.
4. **As quedas repetidas (a) só separam o incidente pela CLASSE do
   `stream:error`.** Pela contagem, uma noite sadia teve 8 quedas em 6 h na
   mesma conexão. O incidente teve ao menos 1 queda por hora durante ~45 h.
   Com a classe `ack`, o aviso sairia em 02/11 entre 14h e 15h (feriado), se
   as quedas desse dia tinham a classe das medidas em 03/11.
5. **O atraso no sino (b) não teve falso positivo com 30 min.** Os 4
   episódios fora do incidente vieram de reinícios da Evolution e duraram
   menos de 30 min. No incidente, acenderia às ~03:30 de 03/11, de madrugada.
   Só serve se ficar aceso até haver prova de que normalizou.

**Recomendação:** primeiro o (c), como eixo da saúde (cabeçalho e faixa da
conversa) e com aviso no sino, mais uma faixa persistente enquanto houver
alarme. Depois a classe na sentinela (a) e o (b) como complemento.

## Decisões do operador (04/11/2026)

- **D1 (P1): o aviso aparece na faixa fixa do topo (E1) e na faixa da
  conversa (E2)**, além do sino. O Meu dia (E5) e o celular dos
  administradores (E3) ficam de fora.
- **D2 (P2): recebem os owner/admin E os membros cujo perfil vê a conexão.**
  Vale para os avisos de UMA conexão, do CRM e da sentinela (Fase 4). Os
  avisos do servidor (réplica, disco, memória…) seguem só para owner/admin.
- **D3 (P3): a régua do (c) fica como proposta:** os 5 envios mais recentes
  com mais de 15 min, das últimas 3 h, em pelo menos 3 conversas, sem
  recibo. **P3b: o sino do (c) avisa só em horário útil**: segunda a sexta,
  das 8h às 20h de Brasília, a mesma janela da sentinela. Aceso fora dela, a
  faixa da tela mostra na hora, e o sino recebe na abertura do horário, se o
  alarme ainda estiver aceso. O (b) não muda: a pergunta era só do (c).
- **D4 (P4): o (c) aparece também no cabeçalho e na faixa da conversa** (o
  motivo novo na saúde da conexão), além do sino.
- **D5 (P5, "siga sua orientação"): o (b) entra no sino** como complemento
  do (c), com 30 min e "expirar não normaliza".
- **D6 (P6): lembrete a cada 24 h, sem modo sombra:** os alarmes ligam
  direto.
- **D7 (P7): autorizada a leitura, só leitura, do log guardado do incidente
  na VPS**, para conferir o formato da linha. Depois, a1 + a2. O a3 e o a4
  ficam para depois de 2 semanas da coleta nova.
- **D8 (P8): os alarmes do CRM nascem ligados em toda instalação**, sem
  chave para desligar.

## Estado

| Fase | O quê | Estado |
|---|---|---|
| 0 | Estudo e medição (este documento) | Feito em 04/11/2026 |
| 1 | (c) no CRM: régua, índice e motivo novo na saúde da conexão (cabeçalho e faixa da conversa) | Decidida (D3, D4, D8); a implementar |
| 2 | Avisos do próprio CRM no sino, com estado: (c) e (b) | Decidida (D2, D3, D5, D6, D8); a implementar |
| 3 | Faixa fixa no topo enquanto houver alarme (E1) | Decidida (D1, D2); a implementar |
| 4 | Sentinela: instância e classe na coleta, aviso `quedas:` | Decidida (D2, D7); começa pela leitura do log do incidente |
| 5 | Aviso no celular dos administradores (E3) | Fora (D1) |

## 1. A linha do tempo, sinal por sinal

| Quando | O que aconteceu na T-Jur | O que os sinais mostravam |
|---|---|---|
| 02/11 13h | Começam as quedas de hora em hora (feriado) | Coleta da sentinela: quedas de hora em hora desde a janela das 13:05 (lido pela sessão do incidente), sem dizer a conexão |
| 02/11 15:37 | Última mensagem recebida em dia | — |
| 02/11 15:37 → 03/11 02:52 | Nada chega | Âmbar apagado (última medição em dia) |
| 03/11 02:52 | Chega 1 mensagem de 02/11 17:06 (9,8 h de atraso) | Âmbar aceso por 1 h, apagado às 03:52 pela validade |
| 03/11 08h → 17h | 90 envios do CRM; dos de 09h em diante, nenhum teve recibo no dia; nada chega | Âmbar apagado; a bolha mostra 1 ✓, como em qualquer cliente com o celular desligado |
| 03/11 10:05 | Sentinela: "WhatsApp sem receber: T-Jur" | 2 destinatários, 0 leituras até hoje |
| 03/11 20:52 → 04/11 02:03 | Lotes de 1 a 6 mensagens por hora, 13–16 h atrasadas | Âmbar aceso ("Entregando com N h de atraso") |
| 04/11 07:28 → 09:59 | Lotes de 2 a 12 por hora, 22–24 h atrasadas | Âmbar aceso; lembrete da sentinela às 10:05, sem leitura |
| 04/11 10:04 | Troca da imagem (4º patch) | 192 mensagens entre 10h e 11h; os recibos voltam |

Medido no banco: entrada por hora em `messages.gravada_em` e envios por hora.
O âmbar foi reconstruído com a régua da 1002 (seção 8). As quedas vêm dos logs
da plataforma (seção 3a).

## 2. Por que ninguém viu

- **O sino não é lido.** Avisos `whatsapp_alert` da conta do escritório:
  11 desde 13/10, cada um para os 2 owner/admin. São 1 de teste, 5 de
  problema, 4 "Normalizou" e o lembrete de 04/11.
  - Só 5 foram lidos, sempre por 1 dos 2: o de teste, 6 h depois; o par de
    14/10 (problema e "Normalizou"), 31 h depois do problema; o par de 22/10,
    3,7 h depois do problema.
  - Nenhum dos 6 desde 25/10 foi lido, inclusive o do incidente e o lembrete
    de 04/11.
  - O relatório semanal de 02/11 já apontava: "nenhum dos 4 avisos das duas
    últimas semanas foi lido por ninguém".
- **O âmbar apaga quando nada chega.** A fronteira da 1002 só mede quando
  chega mensagem mais nova que a última. Na T-Jur, o dia útil de 03/11 não
  trouxe nenhuma, e a medição de 02:52 expirou às 03:52. O cabeçalho, a faixa
  da conversa e o Meu dia leem o mesmo `detail === 'lagging'`, e os três
  mostraram a conexão em dia.
- **Quem sentiu o problema não recebe aviso.** A equipe da T-Jur mandou 90
  mensagens em 03/11, e as de 09h em diante não ganharam ✓✓ no dia. A faixa
  âmbar da conversa
  (`aviso-da-conexao.ts`) acende com `webhook` ou `lagging`, e os dois
  estavam apagados. O aviso da sentinela vai só a owner/admin (§12 da
  INFRA-VPS).

## 3. As opções, medidas

### (a) Sentinela: quedas repetidas e a classe do `stream:error`

**O que a coleta guarda hoje.** As assinaturas por hora desde 13/10
(`coleta/AAAA-MM-DD.jsonl`) não dizem a conexão, e não dá para atribuir o
passado.
- A linha de ERROR/WARN da Evolution vira "componente: texto", e o prefixo
  com a instância fica de fora.
- A linha da Baileys vira só o `msg` ("stream errored out"): `assinatura()`
  corta no primeiro `{`, e é por ali que vem o `reasonNode` com a classe.
- A heurística das `descartadas` (o prefixo mais próximo antes da linha) não
  serve aqui: com 4 instâncias intercaladas no mesmo log, a linha anterior é
  de qualquer uma.
- O relatório semanal de 02/11 já pedia isso (parte livre F): "guardar a
  instância nessa assinatura".

**Medido por outro caminho.** Cada aviso `connection.update` da Evolution
faz o CRM gravar `cb_channels` por `instance_name`. Nos logs da plataforma
(`edge_logs`, ~7 dias) são ~3 PATCH por queda (close, connecting, open), e
isso vale como contagem de quedas por conexão de 28/10 a 04/11:

| | Quedas por dia | Pior hora | Pior sequência |
|---|---|---|---|
| B-Com, B-Jur, T-Com (7 dias) e T-Jur antes de 02/11 13h | 0 a 12 | 4 na mesma hora (T-Jur, 29/10 00h) | 8 em 6 h (T-Jur, 28/10 19h → 29/10 01h); 7 horas seguidas com queda (T-Com, 28/10 18h → 29/10 00h) |
| T-Jur no incidente | ~27 (02→03/11) e ~30 (03→04/11) | 3 | ao menos 1 por hora durante ~45 h |
| T-Jur depois da troca | 1 (a própria troca, 10:04), depois nenhuma | — | — |

Em 29/10 às 21h, as 4 conexões caíram juntas (reconexão geral). A sessão do
incidente leu o log do contêiner (03/11 13h → 04/11) e mediu a classe: 19 das
22 quedas da T-Jur eram `stream:error` com `<ack class="status">`, e as outras
3 conexões só tiveram 428/503 comuns (10 no período).

**Leitura.** A contagem sozinha não separa o incidente de uma noite ruim: em
6 h, a noite sadia (8 quedas) empata com o incidente (7 a 9). Só em 24 h os
dois se separam (12 × ~27), e um limiar ali (≥ 18 em 24 h, ou ≥ 10 horas
seguidas) acenderia entre 22h de 02/11 e 02h de 03/11, com margem medida em
uma semana só. A classe muda o quadro: `ack` no `stream:error` quer dizer que o
servidor cobrou uma confirmação que a biblioteca não deu. É defeito de
protocolo, e nas conexões sadias foi zero.

**Proposta.**
- **a1, coleta:** guardar a instância (o prefixo `[Evolution API]
  [<instância>]`) e, na queda, só a TAG do `reasonNode` e os atributos
  `class` e `type`. Nunca `id`, `to`, `from` nem conteúdo: o nó do ack traz
  endereços. Antes, conferir o formato exato da linha no log guardado do
  incidente (`/root/backups/*20261104T130147Z*`, só leitura, com o operador).
- **a2, aviso `quedas:<instância>` pela classe:** 2 quedas com nó `ack` em
  6 h, dizendo a classe ("o servidor cobrou a confirmação de um aviso do tipo
  status"). No incidente, sairia às 14:05 ou 15:05 de 02/11, se as quedas
  desse dia tinham a classe das medidas em 03/11 (a causa é a mesma). Vai à
  conta dona da conexão, como os outros avisos de conexão.
- **a3, aviso pela contagem (opcional):** ≥ 18 quedas em 24 h. Calibrar com
  2 semanas da coleta nova antes de ligar.
- **a4, envios sem nenhum ack (a medir):** mensagens `fromMe` das últimas
  2 h, com mais de 10 min, sem nenhuma linha em `MessageUpdate` (nem o
  `SERVER_ACK`), por instância. No incidente, os 73 envios de 03/11 10h em
  diante estavam assim. Numa conexão sadia, o `SERVER_ACK` chega em segundos,
  mas não foi medido no banco da Evolution: precisa de uma semana de
  `--simular` antes de ligar.
- Alternativa sem log: a tabela `Instance` que a sentinela já lê
  (`disconnectionAt`, `disconnectionReasonCode`) mostraria "caiu de novo nesta
  hora". A confirmar se a imagem com o patch grava os dois a cada reconexão.

Mudou limiar ou aviso: a tabela da §12 da INFRA-VPS muda no mesmo PR. O CI não
publica a sentinela: copiar o arquivo e conferir com `--simular`
(`deploy.md`).

### (b) CRM: aviso no sino quando a conexão fica atrasada além de X min

**Medido.** Reconstruí a fronteira da 1002 mensagem a mensagem, de 17/09 (a
1003) a 04/11: 26.495 amostras nas 5 conexões. São as mensagens 1:1 de
cliente e do celular, sem as retidas sem telefone e sem ligação.

| Episódio de atraso (> 5 min) | Duração | Atraso máximo | Amostras |
|---|---|---|---|
| 17/09 12:39, B-Com (troca da imagem) | 2 min | 27 min | 1 |
| 16/10 17:36, T-Com (volta da VPS desligada) | 12 min | 18 min | 1 |
| 16/10 17:36, B-Com (idem) | 13 min | 16 min | 3 |
| 16/10 17:36, T-Jur (idem) | 25 min | 41 min | 3 |
| 03/11 02:52, T-Jur (incidente) | 60 min (expirou) | 9,8 h | 1 |
| 03/11 20:52, T-Jur (incidente) | 5 h 11 min | 16 h | 17 |
| 04/11 07:28, T-Jur (incidente, até a drenagem) | 3 h 2 min | 24 h | 230 |

**Leitura.** Com X = 30 min, nenhum falso positivo em 7 semanas: tudo fora
do incidente foi reinício da Evolution e passou em menos de 30 min. No
incidente, o (b) acenderia às ~03:30 de 03/11. Mas a régua da tela
(`alarmeDeAtraso`, atraso E frescor) apagou às 03:52 e só voltou às 20:52.

**Restrições de desenho.**
- **Expirar não é normalizar.** O aviso só encerra com uma amostra FRESCA
  e em dia (até 1 h, atraso ≤ 5 min). Medição vencida é "não sei", como na
  sentinela, onde só a prova encerra. Com isso, o aviso das 03:30 continuaria
  ativo no dia 03/11 inteiro, dizendo o que se sabe: "última entrega com
  9,8 h de atraso às 02:52; nada recebido desde então". Nunca "está atrasada
  agora": afirmar o presente a partir de uma amostra velha é o que a régua da
  1002 proíbe.
- **O estado do aviso não mora em `cb_channels`.** Todo UPDATE ali faz cada
  aba refazer a sonda (o espaçamento de 1 min da 1002 existe por isso). Uma
  tabela própria, fora da publicação de realtime, guarda quando foi visto,
  avisado e normalizado: o `estado.json` da sentinela, só que no banco.
- **A régua é a mesma** (`alarmeDeAtraso`, `atraso-de-entrega.ts`). O cron
  chama a função pura, sem recalcular por conta própria.

### (c) CRM: envios sem recibo

**Medido.** Envios do CRM: `sender_type` agent/bot, fora do celular, 1:1 e
sem `nao_saiu`.
- **Estado final, de 06/10 a 04/11, fora da janela do incidente (14.437
  envios):** os que nunca passaram de 1 ✓ foram 0,3% na B-Com, 0,1% na B-Jur,
  3,7% na T-Com e 1,4% na T-Jur. O pior dia teve 8,5% (T-Com, que manda mais
  mensagem fria).
- **Sequências, 17/09 → 02/11, fora as falhas:** a maior sequência de envios
  seguidos sem recibo nenhum teve 4 envios, em no máximo 2 conversas. Nenhuma
  chegou a 5 envios em 3 conversas.
- **Tempo até o 1º recibo:** pelos PATCH de recibo nos logs do PostgREST,
  nos 105 envios de 03/11 entre 09h e 10h.
  - Nas 3 conexões sadias (85 envios), 83 tiveram recibo em até 5 min: 80 em
    até 10 s, mediana de 0 a 1 s, p90 de até 4 s e máximo de 4,6 min. Os
    outros 2 não tiveram recibo em 24 h.
  - Na T-Jur, nenhum dos 20 teve recibo em 1 h. Onze tiveram o 1º recibo 22 a
    23 h depois, nos lotes das 07:29 e das 08:19 de 04/11. Os outros 9 não
    tinham recibo às 09h de 04/11: 7 deles tiveram depois, e 2 seguem em 1 ✓.
- **Hoje, o estado final do incidente** já não mostra nada: 82 dos 97 envios
  da janela estão entregues. O histórico só guarda o status ATUAL, sem o
  instante de cada recibo.

**A régua proposta.** Os 5 envios mais recentes com mais de 15 min, todos das
últimas 3 h e em pelo menos 3 conversas, sem nenhum recibo de entrega ou de
leitura.
- "Os 5 mais recentes", e não "todos da janela": um recibo velho, de antes de
  travar, não segura o alarme.
- As 3 conversas protegem contra a rajada para um cliente só, com o celular
  desligado.
- No incidente: em 03/11 às 09h foram 20 envios em 13 conversas, sem recibo.
  O alarme acenderia entre 09:25 e 09:40, antes do `sem_entrada` das 10:05.
- Fora do incidente: zero no histórico. A chance de um envio sadio passar de
  15 min sem recibo foi ~2%, e precisariam ser 5 seguidos, em 3 conversas.
- "Enquanto as outras recebem recibo" serve ao TEXTO, não à condição. Se
  todas as conexões param juntas, o problema é a entrega ao CRM (webhook,
  servidor), o que é pior, e o aviso diz isso. Numa instalação de um número
  só, não há com quem comparar.

**Por que é o mais forte.** Ele vê exatamente o "envia e nada volta":
- vale para a fila de entrada parada (este incidente);
- vale para o webhook que não chega (o recibo vem pelo mesmo webhook que a
  mensagem do cliente);
- vale, nas duas, para Evolution e Meta (o recibo da Meta também vem por
  webhook);
- não depende de o cliente escrever, só de a equipe ou o robô enviarem.

**Restrições de desenho.**
- **Instagram fica fora:** o Direct não manda recibo de entrega, e o aviso de
  leitura o CRM não grava (`persistir.ts`): o envio fica em `sent` para
  sempre.
- **Grupo fica fora:** em grupo o recibo não passa de ✓.
- **O celular fica fora:** a mensagem que a equipe manda pelo aparelho chega
  ao CRM pela mesma fila parada. No incidente, nenhuma chegou.
- **Índice novo.** Os índices de `messages` que tocam conexão ou data são só
  `(channel_id)` e `(conversation_id, created_at)`. A consulta "os últimos
  envios desta conexão" pede um índice parcial `(channel_id, created_at desc)`
  com o predicado espelhando o filtro (agent/bot, fora do celular), com pino
  como o da 1006. Ele segura as escritas em `messages` por alguns segundos ao
  nascer, como a 1006 já fez.
- **A mesma régua em dois lugares.** Na SONDA da saúde (`probeChannels`, ao
  vivo, com cache), vira um motivo novo do `toneFor` (`sem_recibo`). Assim o
  cabeçalho e a faixa âmbar da conversa (`aviso-da-conexao.ts`) mostram o
  alarme sem tela nova, e ele apaga no 1º recibo. O Meu dia fica como está
  (D1): `conexoesAtrasadas` só lê `lagging`. No CRON, a régua alimenta o
  sino. Uma função pura, dois chamadores.
- **Amarelo novo decide de que lado fica** (`canais.md`): `sem_recibo` fala
  da ENTRADA e entra em `ENVIA_MESMO_EM_AMARELO` (`viva-para-enviar.ts`).
  Senão uma fila de recibos parada adiaria as cobranças do Asaas e a troca de
  número da conversa.
- **O texto não pode mandar reenviar.** As mensagens provavelmente chegaram:
  o que parou foi a volta. Por exemplo: "Esta conexão não confirma entrega
  desde 09:10: as respostas dos clientes podem estar presas. Não reenvie."
  Reenviar mandaria em dobro (raiz, 8e).
- **Chaves de i18n montadas** (`tone_*`/`detail_*`): nos dois dicionários,
  com o pino `rotulo-da-saude.test.ts`, que colhe os motivos do `toneFor`.

### (d) Onde o aviso aparece

A medição da seção 2 decide aqui: aviso que só entra no sino não é visto.

| | O quê | Quem vê | Custo |
|---|---|---|---|
| E1 | Faixa no topo do CRM, em toda tela, enquanto houver alarme ativo de conexão (do CRM ou da sentinela), com o que se sabe e desde quando | owner/admin e os membros cujo perfil vê a conexão (D2) | Tela nova na casca; lê o estado pela sonda da saúde, sem realtime novo |
| E2 | Faixa âmbar na conversa da conexão afetada | Quem atende | Quase zero com o (c) no `toneFor`: a faixa já existe |
| E3 | Mensagem de WhatsApp no celular dos administradores (1046), por OUTRA conexão sadia | owner/admin, fora do CRM, no feriado e à noite | Desenho próprio: todo caminho de envio grava a conversa, e o núcleo abre card (`routeContactToPipeline`). O número do administrador viraria "cliente" no funil |
| E4 | Pop-up do navegador para o aviso do sino | Quem está com o CRM aberto e deu permissão | Já existe (#425); a leitura medida mostra que não basta |
| E5 | Bloco "o que precisa ser corrigido" do Meu dia | Admin, na 1ª entrada do dia | Pequeno: mais uma fonte |

Com E1, o aviso do feriado (a2) ou o da madrugada (b) estaria na tela às 08h
de 03/11, e o (c) com E2 chegaria à equipe da T-Jur por volta de 09:30, na
conversa em que ela digitava. Com o sino de hoje, os dois teriam o destino do
aviso das 10:05.

**Decidido (D1 e D2):** E1 e E2. A faixa do topo aparece para os owner/admin
e para os membros cujo perfil vê a conexão. O E3 e o E5 ficam de fora.

## 4. O que viaja para quem instala (Atlas CRM)

(b), (c), E1 e E2 moram no CRM e chegam a toda instalação, que não tem a
sentinela (só a nossa VPS tem). Nascem ligados, sem chave para desligar (D8).
- **Textos** nos dois dicionários (en e pt-BR), sem nome de produto (o
  `{appName}`) e sem a nossa infraestrutura. Falam de "conexão" e
  "confirmação de entrega", nunca de Evolution, Baileys ou VPS.
- **Meta:** o (c) funciona igual (o recibo vem por webhook). O (b) também,
  porque a Meta passa pelo `registrarEntrega`.
- **Instagram:** fica fora do (c).
- **Limite:** uma instalação que só fala pelo celular pareado quase não tem
  envio do CRM, e o (c) não acende lá. Fica escrito como limite.
- **O aviso no sino** é gravado pelo próprio CRM, com a service role e no
  idioma da instalação (o locale é global e fixo). Reaproveitar o tipo
  `whatsapp_alert` evita mexer no CHECK e na tela: o ícone, as 3 linhas e a
  exclusão das contagens do resumo já existem. O comentário de
  `src/types/index.ts` e o da 1085 passam a dizer que o tipo também é gravado
  pelo CRM. Tipo próprio (CHECK novo) só se o operador quiser separar os dois.
- **Cadência:** um passo no `rodarManutencaoDoCiclo` (laço lento, ~15 min),
  isolado como os outros. Rota nova no agendador exigiria `docker stack
  deploy` à mão (`deploy.md`), e cada instalação teria de mudar a stack. O
  passo lê `cb_channels` de todas as contas com a service role, sempre
  cercado pela conta. O aviso sai só para quem ganha o UPDATE cercado do
  estado (raiz, 8e). O horário útil do (c) (D3) sai de `agenda/fuso.ts`
  (`diaNoFuso`/`paraInstante`): o servidor roda em UTC. Feriado em dia útil
  não está no calendário, o mesmo limite da sentinela.
- **Quem recebe (D2):** owner/admin e os membros cujo perfil vê a conexão,
  com o contexto REAL de cada um (o recorte das conexões do perfil,
  `.claude/rules/perfis.md`), nunca o do "Ver como".
- **Uma decisão nova por alarme** em `DECISOES-DO-OPERADOR.md`, com o
  detalhe em `canais.md`, no PR de cada fase.

## 5. Recomendação e ordem

1. **Fase 1 — (c) na saúde da conexão.** Dos alarmes propostos, é o único
   que acenderia no horário de trabalho, o único que chega a quem estava
   enviando e um dos que viajam para toda instalação.
   - Pronto quando: o cabeçalho e a faixa da conversa mostram "não confirma
     entrega" na conexão em que os 5 últimos envios com mais de 15 min não
     tiveram recibo, e apagam no 1º recibo.
   - Testes da régua pura cobrem os casos medidos: a rajada para um cliente
     só, o recibo velho, o grupo, o Instagram e o celular.
2. **Fase 2 — o sino, com estado.** O (c), só em horário útil (D3), e o (b)
   (D5), com as regras da sentinela: um aviso por episódio, lembrete a cada
   24 h (D6), "Normalizou"
   só com prova e "Aconteceu e já normalizou" quando o aviso não entrou a
   tempo. Recebem owner/admin e os membros cujo perfil vê a conexão (D2).
3. **Fase 3 — a faixa E1**, para os mesmos destinatários. É ela que faz um
   aviso de madrugada ser visto às 8h.
4. **Fase 4 — a sentinela (a1 + a2, D7).** Primeiro conferir o formato da
   linha no log do incidente. Depois a coleta com instância e classe, e então
   o aviso `quedas:`. Os avisos de conexão passam a ir também aos membros
   (D2), e a tabela da §12 muda junto. O a3 e o a4 ficam para depois de
   2 semanas da coleta nova.
5. **Fase 5 — E3 (celular): fora** (D1).

Sem modo sombra (D6): os alarmes ligam direto. O histórico não mostrou falso
positivo para o (b) nem para o (c) com estes limiares, mas o tempo até o
recibo foi medido numa hora só: a primeira semana no ar vale como conferência.

## 6. Custos e riscos

- **Banco:** o passo do cron faz uma consulta por conexão, a cada ~15 min,
  pelo índice novo. A sonda da saúde ganha a mesma consulta, com cache (ela
  já guarda a resposta da Evolution por 15 s). O banco está perto do teto de
  conexões: nada aqui abre conexão própria, tudo passa pelo PostgREST.
- **Falso positivo do (c) à noite:** quem envia à noite é o robô, para lead
  frio, e o celular desligado atrasa o recibo. O histórico não teve
  sequência de 5, mas o risco é maior do que de dia. Decidido (P3b): o sino
  do (c) só em horário útil; a faixa da tela vale sempre.
- **Aviso em dobro:** no nosso servidor, a sentinela e o CRM avisariam o mesmo
  incidente com textos diferentes (`sem_entrada` da sentinela e "não confirma
  entrega" do CRM). É aceitável, e com o E1 os dois ficam na mesma faixa.
- **Quedas vistas pelo CRM** (alternativa ao a2 que viaja): o CRM já recebe
  cada `connection.update`. Gravá-los numa tabela permitiria contar as quedas
  em toda instalação. Não é recomendado agora: a contagem não separa o
  incidente (seção 3a), e o aviso não traz a classe, só o código. O
  `statusReason` no corpo do aviso está a confirmar num aviso real, porque o
  CRM ainda não lê o campo.

## 7. Perguntas ao operador (respondidas em 04/11/2026)

- **P1. Onde o aviso aparece?** Recomendado: E1 + E2 + E5 agora e E3 só com
  plano próprio. → **E1 e E2** (D1).
- **P2. Quem recebe?** Hoje só owner/admin (2 pessoas). Incluir os membros
  cujo perfil vê a conexão: eles viram os 90 envios sem ✓✓ e não tinham
  aviso. → **Incluir os membros** (D2).
- **P3. A régua do (c)** (5 envios, 3 conversas, 15 min, janela de 3 h) está
  boa? → **Está boa** (D3). **P3b**, o sino avisa 24 h por dia ou só em
  horário útil? → **Só em horário útil** (D3).
- **P4. O (c) entra também na faixa da conversa e no cabeçalho** (Fase 1)
  ou só no sino? → **Também no cabeçalho e na faixa** (D4).
- **P5. Ligar o (b) no sino** com X = 30 min e "expirar não normaliza"? →
  **"Siga sua orientação"**: ligar, como complemento (D5).
- **P6. Lembrete e modo sombra:** lembrete a cada 24 h, como a sentinela, ou
  mais curto em horário útil (ex.: 4 h)? Uma semana em modo sombra antes de
  avisar, ou ligar direto? → **A cada 24 h; ligam direto** (D6).
- **P7. Sentinela:** autoriza a leitura (só leitura) do log guardado do
  incidente para conferir o formato da linha, e então a1 + a2? O a3 e o a4
  depois de 2 semanas? → **Sim, leitura autorizada** (D7).
- **P8. Atlas CRM:** os alarmes do CRM nascem ligados em toda instalação, sem
  chave para desligar? → **Sim, já vêm ligados** (D8).

## 8. Como foi medido

Só leitura, uma consulta por vez (o banco anda perto do teto de conexões).
Recorte pela conta do escritório. Nenhum dado de cliente neste documento.

- **Entrada e atraso (b).** `messages` com `gravada_em` (desde a 1003) em
  conversas com contato (1:1), `sender_type = 'customer'` ou `from_device`,
  fora `content_type = 'call'`, fora `cb_mensagens_sem_telefone.message_id`,
  fora o carimbo mais de 120 s no futuro.
  - Por conexão, em ordem de `gravada_em`: é amostra a mensagem cujo carimbo
    passa do maior já visto (a fronteira só avança).
  - O atraso é `gravada_em − created_at`. O alarme fica aceso da amostra até
    a seguinte, ou por no máximo 1 h, quando passa de 300 s.
  - Episódio = alarmes acesos encadeados.
  - O espaçamento de 1 min para acender foi ignorado: erra no máximo esse
    minuto.
- **Envios (c).** `messages` 1:1 com `sender_type` agent/bot, `from_device`
  falso, sem `nao_saiu`, por conexão.
  - O estado final é por dia. As sequências foram contadas como "ilhas" de
    envios seguidos com `status = 'sent'`.
  - O tempo até o recibo vem dos `edge_logs`: o 1º PATCH em
    `/rest/v1/messages?message_id=eq.<id>` com o filtro de status de entrega
    (`in.(sending,sent)`) ou de leitura (`in.(sending,sent,delivered,failed)`).
    O 1º é o instante em que o recibo chegou ao CRM, mesmo antes de a linha
    existir.
  - Foram os 105 envios de 03/11 entre 09h e 10h, com 24 h de logs.
- **Quedas (a).** `edge_logs`, PATCH em
  `/rest/v1/cb_channels?instance_name=eq.<instância>` por hora, de 28/10 12h
  UTC a 04/11. São ~3 por queda: o webhook
  `connection.update` grava close, connecting e open. A sonda da saúde grava
  pelo `id` e não entra na conta.
- **Sino.** `notifications` do tipo `whatsapp_alert` da conta: criação,
  destinatários e `read_at`.
- **Relatório da rotina semanal** de 02/11 (no Mac do operador): itens 9 e
  13 e parte livre F.

**Limites.**
- O tempo até o recibo é de UMA hora de um dia útil.
- As quedas são de 7 dias: a retenção dos logs não alcança mais.
- A classe das quedas vem da sessão do incidente, que leu o log na VPS. Esta
  medição não leu a VPS.
- A medição do (b) começa em 17/09, porque antes não havia `gravada_em`. O
  episódio de 16/09, que motivou a 1002, fica de fora.
- O estado final dos envios subestima o incidente, porque os recibos chegaram
  depois da troca.
