---
paths:
  - "src/lib/whatsapp/ligacoes/transcricao*"
  - "src/lib/whatsapp/ligacoes/dialogo*"
  - "src/lib/whatsapp/ligacoes/poda*"
  - "supabase/migrations/*1136*"
  - "src/components/inbox/aviso-de-ligacao.tsx"
---

# A transcrição da ligação pelo CRM (4d, 1136)

Plano: `docs/PLANO-ligar-pelo-crm.md` §8.5 e §8.16. A ligação em si (máquina,
faixa, gravação): `ligacoes.md`. Vale ao mexer na transcrição, no resumo, no
diálogo da faixa, na poda dos 180 dias ou na limpeza da Lixeira das gravações.

- ⚠️⚠️ **Cada LADO se transcreve à parte** (`cliente.ogg`, `atendente.ogg`,
  mono), com o instante em que cada trecho COMEÇA, e o diálogo sai da
  intercalação pelo horário (`intercalar`): os canais separados dizem quem
  falou, sem adivinhação. Os dois lados começam no mesmo instante (o corte erra
  ~0,3 s), e é isso que deixa comparar um com o outro. O estéreo é só para
  OUVIR (o Gemini mistura os canais).
- **Provedor (D14)**: o da transcrição de hoje, pela CHAVE (`escolherLeitor`,
  Gemini → OpenAI). Gemini: `MODELO_TRANSCRICAO` com saída JSON
  (`responseSchema`, `inicio` "MM:SS"). OpenAI: SÓ o `whisper-1`
  (`verbose_json` + `timestamp_granularities[]=segment`) dá horário; os
  `gpt-*-transcribe` respondem só texto.
- ⚠️ **O contrato é o das notas de voz (`transcrever.ts`)**: cadeado `UPDATE …
  RETURNING` com o teto de 3 tentativas no WHERE, amarrado ao valor lido;
  travada de 15 min recolhida; a cerca do carimbo em toda escrita depois dele;
  SEM CHAVE não grava (o laço tenta de novo por 7 dias); o custo vai a
  `ai_usage_log` (modo `transcricao`) antes de julgar a resposta. Diferenças,
  de propósito: a 3ª falha vira `recusada` NA HORA (a faixa nunca fica em
  "Transcrevendo…" para sempre — `falhou` nela quer dizer "vai repetir"), o
  teto de tokens é `recusada` (determinístico) e o resumo que falha não
  derruba o diálogo (grava sem resumo).
- **Quando**: no `after()` da rota da gravação, quando chega um LADO (a função
  confere no bucket se os dois estão lá; o cadeado segura a corrida). O laço
  lento (`retomarTranscricoes`, o ÚLTIMO passo de `rodarManutencaoDoCiclo`)
  repete o que falhou: até 3 por ciclo, as que falharam antes das nunca
  tentadas e as mais novas primeiro, só com o prazo de um lado inteiro
  sobrando. ⚠️ Ele lê TODAS as pendentes da janela (página de chave), nunca um
  lote fixo: a que não anda (conta sem chave, lados chegando) não muda de
  estado e tomaria todo ciclo (Codex, #504); a conta sem chave é pulada no
  resto do ciclo. Lados que não chegaram em 1 h = `recusada`.
  Passados os 7 dias, o que ficou em `falhou` (sem chave para repetir) ou
  travado vira `recusada`: senão a faixa diria "Transcrevendo…" até a poda.
- **Os dois lados saem do Storage quando o diálogo fica pronto**; o estéreo
  fica até a poda. ⚠️ O REENVIO da máquina (o 2xx se perdeu) volta
  `descartada` para a ligação podada ou excluída (a poda e a fila pulam a
  linha expirada: o arquivo ficaria para sempre) e para o lado de uma
  transcrição pronta (`receberGravacao`), e o descarte da expirada apaga o
  arquivo do caminho; a ligação é RELIDA depois do upload (a poda ou a
  exclusão que cruza o envio: o arquivo recém-guardado sai — Codex, #506).
  A espera de 1 h pelos lados conta
  do FIM da ligação (`desfecho_em`). Lado com fala e nenhum horário legível
  é falha, nunca "sem fala" (`validosOuFalha`).
- ⚠️⚠️ **A faixa só muda por `sincronizarFaixa(ligação)`**
  (`cb_ligacao_sincronizar_faixa`): lê a ligação com `FOR UPDATE` e funde
  (`||`) `gravacao`, `transcricao`, `resumo` e `expirada` numa escrita.
  Chamar DEPOIS de gravar o estado em `cb_ligacoes` (a gravação, cada passo
  da transcrição, a poda, o vínculo da faixa em `gravarFaixa`). Nunca marcar
  pelo `message_id` lido antes: a faixa pode ser ligada no meio da
  transcrição, e ler-mudar-gravar o jsonb deixava uma marca apagar a outra.
- **O diálogo mora em `cb_ligacoes.transcricao`** (fechada ao navegador); a
  tela o pede por `GET /api/cb/ligacoes/[id]/transcricao`, que confere a
  conversa (a régua do ▶).
- **Na tela, a ligação pelo CRM com o que ouvir ou ler** (gravação,
  transcrição, resumo ou a situação dela) é um CARTÃO no fio, com "Ouvir" e
  "Ver transcrição" como botões (pedido do operador, 11/11/2026); o resto
  (celular, não atendida, as da 4b) segue pílula.
- ⚠️⚠️ **O Gemini INVENTA fala sobre áudio sem voz** (medido em 11/11/2026: um
  lado só com bipe virou um monólogo inteiro, e o resumo o repetiu), apesar do
  "sem fala, lista vazia" no pedido. A proteção é MÍNIMA, por decisão do
  operador: a máquina mede onde há som em cada lado (`silencedetect`, −40 dB)
  e grava a etiqueta `CB_SOM` no cabeçalho do Opus; o CRM (`somDaGravacao`,
  `soComSom`) descarta o trecho que não começa perto de som (2 s antes, 3 s
  depois) — o lado mudo fica sem trecho. Sem a etiqueta (máquina antiga,
  medição que falhou), nada se filtra. Detecta SOM, não voz: som sem voz com
  ritmo (o bipe do teste) ainda passa.
- ⚠️⚠️ **No contexto do agente de IA (D11), a ligação transcrita é NOTA no
  papel de USUÁRIO** ("not a message from the customer"): o diálogo tem as
  duas vozes, e no papel do assistente o modelo o tomaria por fala própria.
  Resumo primeiro, diálogo cortado em 4.000 caracteres; expirada, só o resumo;
  a leitura que falha deixa a ligação fora (melhor esforço). Continua sem
  abrir turno. A leitura vem de `dialogos-gravados.ts`, leve: o contexto não
  puxa os provedores. ⚠️ Quem procura o que o CLIENTE disse tira as notas
  (`ehNotaDoSistema`): a da ligação traz a fala da empresa e o resumo da IA, e
  viraria "origem" do nome da reunião (`nomeComOrigem`, `turno.ts`).
- **Poda dos 180 dias (§8.10)**: `podarGravacoesDeLigacao`, antes da drenagem
  da fila, em toda ligação ATENDIDA (os lados chegam mesmo sem o estéreo): os
  três arquivos saem do Storage e o diálogo do banco, e a linha ganha
  `gravacao_expirada_em`; fica o resumo (a faixa diz "Gravação expirada"). O
  arquivo sai ANTES da marca; erro do Storage para o ciclo.
- ⚠️ **Exclusão definitiva da Lixeira** (prazo ou "Excluir agora", com ou sem o
  pedido do titular): `cb_ligacoes_sem_gravacao` põe os três arquivos de cada
  ligação pelo CRM da ficha (pelos ponteiros; com o pedido, também as do mesmo
  telefone) na fila, bucket `ligacoes`, e apaga o diálogo e o RESUMO; a linha
  fica (só o pedido a apaga). A reivindicação guarda POR BUCKET: o
  `chat-media` pela função dele e pelas citações; as gravações pela forma do
  caminho (`ehCaminhoDaGravacao`, o espelho TS). O pino
  `ligacoes-transcricao-1136.test.ts` faz os dois lados responderem aos
  mesmos exemplos e prova que a exclusão recriada é a da 1110 mais só o
  acréscimo.
- **Limite conhecido (revisão da 4d)**: restaurar da Lixeira traz a faixa
  com a marca da FOTOGRAFIA — transcrição concluída ou poda feita enquanto a
  ficha estava lá não aparecem nela até a próxima sincronização. O ▶ da
  expirada responde 404 (`enderecoDaGravacao` confere a marca) e "Ver
  transcrição", "Sem transcrição".
- **Radar**: a faixa pelo CRM tem rótulo próprio (feita ou recebida pelo CRM,
  com o resumo), nunca "atendida pelo celular do escritório".
- **Pino** `ligacoes.chamadores.test.ts`: do `@/lib/ai/` o módulo só usa o
  encanamento (`providers/`, `structured`, `types`, `usage`), nunca o gerador
  de resposta nem `ia-agentes/`.
