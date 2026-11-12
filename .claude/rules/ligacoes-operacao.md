---
paths:
  - "src/lib/whatsapp/ligacoes/operacao*"
  - "src/lib/whatsapp/ligacoes/computador*"
  - "src/app/api/cb/ligacoes/conexoes/**"
  - "src/components/settings/ligacoes-da-conexao.tsx"
  - "supabase/migrations/*1137*"
---

# Ligações pelo CRM: o interruptor e a operação (4e, 1137)

Plano: `docs/PLANO-ligar-pelo-crm.md` §8.17. A máquina, a faixa e a tela de
ligar: `ligacoes.md`. Vale ao mexer no interruptor, na seção "Ligações pelo
CRM" da tela Conexões, no QR e no Reparear do computador, nos alarmes dele e
na sentinela que vigia o contêiner.

- ⚠️⚠️ **D16 — um INTERRUPTOR por conexão** (`cb_computadores_de_ligacao.ligado_em`,
  nulo = desligado; nasce DESLIGADO). A régua é `computadorPronto`
  (`computador.ts`): ligado + sinal de menos de 3 min + WhatsApp conectado —
  o botão "Ligar", o toque (o `offer` em `registrar.ts`), o ligar e o atender
  passam por ela, e a lista do botão (`GET /api/cb/ligacoes/computadores`) só
  traz os ligados. ⚠️ Falha FECHADA: `typeof ligado_em === 'string'`, nunca
  `!== null` — a consulta que esqueceu de pedir a coluna (`undefined`)
  ligaria tudo sem erro nenhum. Consulta nova que alimenta a régua pede a
  coluna. Desligar NÃO derruba a ligação em curso: o desligar, os avisos e a
  gravação não dependem dele. ⚠️ Mas apaga o toque AINDA NÃO ATENDIDO da
  conexão (`cb_ligacoes_ao_vivo`, `tocando`): sem isso a equipe seguia
  ouvindo, com um "Atender" já recusado (Codex, #506).
- ⚠️ **D17 — só onde já há computador.** A tela mostra a seção em toda conexão
  por QR; sem computador, "este número ainda não tem computador de ligações".
  Nenhum caminho do CRM cria contêiner (o CRM não manda no Docker do
  servidor): criar é a receita do `docs/INFRA-VPS.md` §4.
- **As rotas do admin** (`/api/cb/ligacoes/conexoes`, lógica em
  `operacao.ts`): a lista (sem endereço nem nome do contêiner), o PATCH do
  interruptor (booleano de VERDADE; ligar o ligado mantém o "ligado desde"),
  o QR ao vivo (`GET /estado` e `GET /qr` na máquina, só do LIGADO; o QR só
  passa se for PNG em data URL) e o Reparear (`POST /desconectar`; 409 em
  ligação). Lista que falha é 500, nunca vazia.
- **A tela** (`ligacoes-da-conexao.tsx`): só o admin (a lista nem é pedida
  para os outros). Carregando ou falhou nunca vira "não tem computador". O QR
  aparece SOZINHO quando a lista diz `qr` (ou logo depois do Reparear): laço
  ENCADEADO de 4 s, só com a seção na tela (o `aoConectar` por ref: trocá-lo
  não reinicia o laço). "Conectou" fica preso ao `sinal_em` da lista, e o
  sinal seguinte o aposenta — a máquina manda o sinal NA HORA em que o
  WhatsApp dela muda (`aoMudarOWhatsapp`). O Reparear que deu certo mantém o
  QR até alguém ler, nunca preso ao sinal do clique (o pedido leva até 75 s e
  a lista se renova no meio).
- ⚠️ **O Reparear derruba as ligações do número** até alguém ler o QR com o
  celular dele: confirmação na tela, linha LIVRE na máquina (a máquina segura
  `pedidoEmCurso` durante o desconectar). Os seletores do "Desconectar" e do QR
  vencido (`SELETORES` da máquina) foram escritos sem medição: medir no
  primeiro teste ao vivo. Falha antes do clique final = a sessão segue; depois
  dele, só "não desconectou" com a sessão AINDA aberta (o QR que demora não é
  falha).
- **Os alarmes** (tipos `computador_fora` e `computador_qr` da 1122, régua
  `alarmes-no-sino.ts`, o mesmo passo do ciclo): `computador_fora` acende com o
  último sinal de mais de 10 min (cobre o contêiner parado e a troca semanal
  da imagem que demorar; "desde" = o último sinal); `computador_qr`, com sinal
  fresco e o WhatsApp pedindo o QR há 10 min (conta a DURAÇÃO, como o atraso:
  o admin pareando não vira alarme), mas só avisa ACESO — com a máquina
  carregando ou parada não é "pede o QR" (só o atraso avisa por duração sem
  medição). Horário útil e destinatários como o (c).
  ⚠️ Desligado: o ciclo apaga a linha CALADA (sem "Normalizou") e a sonda só
  olha os ligados — "essas informações somem" (D16). Os tipos do CHECK e o
  espelho `TIPOS_DO_ALARME` andam juntos (pino `ligacoes-interruptor-1137.test.ts`).
- **No botão das conexões**: a ficha da conexão com as ligações LIGADAS ganha
  um telefone ao lado do nome e a etiqueta colorida "Ligações pelo CRM: …"
  (`ligacoes` da sonda, só do ligado; leitura que falha = sem etiqueta) —
  verde prontas, cor do tema em ligação, âmbar pedindo o QR ou fora do ar
  (`COR_DAS_LIGACOES`; pedido do operador, 11/11/2026: em texto cinza não se
  via qual conexão tinha as ligações). Os dois alarmes são os mais leves da
  conexão (`GRAVIDADE`); na ficha eles não ganham linha própria (a etiqueta já
  diz).
- **A sentinela da VPS** (`maquina:<nome>`): o contêiner do computador LIGADO
  que não está rodando, conferido de novo 60 s depois, só aos owner/admin da
  conta DONA (`PREFIXOS_DA_CONTA`, nunca a união das contas do servidor). As
  chaves vigiadas entram em `vigiaveis` (sem isso o episódio era esquecido e
  o "Normalizou" nunca saía); a checagem que falha mantém os abertos; o Docker
  que não responde LANÇA ("não sei"), só "No such" é contêiner ausente.
  Desligado no CRM, o episódio sai calado.
