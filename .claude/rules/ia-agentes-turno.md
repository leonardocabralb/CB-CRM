---
paths:
  - "src/lib/ia-agentes/turno*"
  - "src/lib/ia-agentes/acoes*"
  - "src/lib/ia-agentes/horario*"
  - "src/lib/ia-agentes/pedido*"
  - "src/lib/ia-agentes/retomada-resposta*"
  - "src/lib/ia-agentes/textos-do-servidor*"
  - "src/components/agentes-de-ia/turnos-do-agente.tsx"
  - "src/components/agentes-de-ia/playground-do-agente.tsx"
  - "supabase/migrations/1109_cb_encerrar_nao_apaga_turno_que_ja_respondeu.sql"
---

# Turno do agente: ação prometida, passagem com ações, horário, encerrar

Validação de 25/10/2026 (`docs/PLANO-agentes-de-ia.md`). O geral do turno e
das ações está em `ia.md` e `ia-agentes.md`.

### Ação PROMETIDA sem a ação = RETIDA e transfere

- ⚠️⚠️ Medido: "Criar tarefa" desligada e "Criei o lembrete…" — nada criado.
  `acaoPrometida` (`acoes.ts`): verbo na 1ª pessoa do passado + o objeto
  ("criei o lembrete", "registrei suas informações", "etiquetei", "movi seu
  card", "encerrei o atendimento"), particípio com auxiliar ("o lembrete foi
  criado") ou no começo da frase ("Tarefa criada ✅"); em inglês só com
  "I/we". As guardas das outras travas valem (negação, futuro, oferta,
  condição, pergunta), e a negação DENTRO da forma. ⚠️ O trecho entre o verbo
  e o objeto NÃO atravessa outra oração (`ABRE_OUTRA_ORACAO`: "e", "que",
  "vou"…): "anotei tudo e vou passar as informações" era retido (revisão).
  "Conversa" não é objeto do encerramento ("fechamos aqui a conversa" é
  despedida). A reunião entra só na 1ª pessoa ("agendei sua reunião"): "sua
  reunião está marcada" pode ser verdade (o cliente agendou pelo link).
- **Cumpre a ação ACEITA do tipo** (tarefa → `criar_tarefa`; campo/dados/
  anotação → `preencher_campo`; etiqueta → `etiquetar`/`tirar_etiqueta`;
  card/etapa → `mover_etapa`); `executar_automacao` e `marcar_reuniao`
  cumprem QUALQUER uma. Repetir o que uma resposta ANTERIOR do escritório já
  disse não é novo — mas só quando a frase se APRESENTA como repetição ("já"
  nas três palavras antes, "como eu disse"): sem isso, o lembrete NOVO passava
  porque um antigo foi criado. "Anotado!" sem objeto não afirma nada.
  "etapa" só conta como a do FUNIL (verbo no singular, nunca "próxima/nesta
  etapa": é palavra do roteiro).
- Vem DEPOIS da reunião prometida e vence o `[[TRANSFERIR]]`. Código
  `acao_prometida` (`MOTIVOS_DE_TRANSFERENCIA`), texto no `erro` do turno
  ("ação prometida sem fazer (<tipo>): …"); o Playground avisa.
- **Na RETOMADA nada executa**: toda afirmação de ação PARA a série
  (`lerRespostaDaRetomada`, parada `acao_prometida`), com as respostas
  anteriores do escritório como no turno.
- **Limites aceitos**: "anotei suas informações" num agente SEM "Preencher
  campo" é retido (se medir muita retenção, restringir o registro a agentes
  com o campo); ação aceita que FALHA na execução não é coberta (a resposta
  já saiu).
- **O pedido diz SEMPRE** que só o marcador muda o sistema e que o que não dá
  para fazer vai para a equipe com `[[TRANSFERIR]]` (trecho em
  `TRECHOS_DO_PEDIDO`). A defesa da TELA é o aviso instruções × ferramentas
  (`ia-tela-do-agente.md`).

### A PASSAGEM roda campo, etiqueta e tarefa ANTES de mover

- ⚠️⚠️ Medido: a qualificação passava sem gravar o campo. Com a passagem
  VÁLIDA, `ACOES_COM_A_PASSAGEM` (campo, etiqueta, tirar etiqueta, tarefa)
  rodam antes de o card ir para a etapa do destino, com a reserva (o `teto`
  não segura: a passagem não fala com o cliente) e a posse. Mover, automação e
  reunião ficam `passagem` (a passagem já move o card). Passagem inválida
  (transfere) = nenhuma ação. O pedido manda pôr esses marcadores depois do
  `[[PASSAR:n]]` (não diz mais "e nada mais").
- **Limite aceito**: a etiqueta dispara as automações de `tag_added` na hora —
  se uma MOVER o card, o UPDATE da passagem não casa e ela transfere; se uma
  FALAR, o destino se cala nesta mensagem (E4).

### FORA DO HORÁRIO o turno ESPERA a abertura

- ⚠️⚠️ Antes terminava `fora_do_horario` e a mensagem da noite nunca era
  respondida (decisão do operador, 25/10/2026). Volta a `aguardando` com
  `executar_apos` = `proximaAbertura` (o cálculo de `dentroDaJanela`, no fuso
  do escritório) e `erro` = `ERRO_DA_ESPERA_DO_HORARIO`, sem `after()` (a rede
  é o cron). Na hora, TUDO é conferido de novo (pausa por gente, card,
  mensagem mais nova, D27). A mensagem nova empurra o pendente (rajada de 8 s)
  e ele volta a esperar a mesma abertura — sem laço.
- ⚠️ **Conexão OFICIAL**: se a janela de 24 h da Meta fecha antes da abertura
  (+ `FOLGA_NA_JANELA_META_MS`), termina `fora_do_horario` como antes — sábado
  de manhã só seria respondido na segunda, com texto livre recusado.
- ⚠️ No turno que esperou, a janela do áudio, a da leitura e o
  `TETO_DA_ESPERA_DAS_MIDIAS_MS` contam da abertura de hoje (`aberturaDeHoje`):
  contados da madrugada, a foto nunca seria lida.
- ⚠️ O teto da conta por minuto (`aiAutoReplyAccount`, 30) DEVOLVE à fila o
  turno cujo gatilho é anterior à abertura, em vez de `sem_resposta`: a fila
  da noite vence toda junta e o cron roda até 40 por minuto.
- A aba Turnos mostra "Aguardando · aguardando o horário do agente · abre
  <quando>" (reconhece o `erro`; nunca cru). `fora_do_horario` só sobra nos
  registros antigos. `horario.ts` pega o fuso de `campo-data` (não de
  `pedido.ts`, que levaria o pedido ao navegador); teste amarra as duas.

### Falha PASSAGEIRA do provedor tenta UMA vez mais

- Prazo, limite de taxa e 5xx (`falhaPassageira`) reagendam o turno para daqui
  a `REPETIR_A_GERACAO_MS` com a marca `ERRO_DA_REPETICAO` (lida na linha
  reivindicada); a segunda falha é `falhou`, como antes (E8, não transfere).
  Medido na simulação de 25/10/2026: 2 de 59 pedidos ao Gemini passaram de
  30 s, e o cliente ficava sem resposta até escrever de novo. Falha de
  configuração (chave, modelo, 404) não repete.

### Encerrar NÃO descarta o turno que já respondeu (1109)

- ⚠️ A automação que o próprio agente executa pode encerrar a conversa no meio
  do turno; o descarte apagava o desfecho e as ações (medido). Desde a 1109,
  `cb_encerrar_limpa_ia` descarta só o que ainda não tem
  `mensagem_enviada_id`; o que respondeu grava `respondeu` com as ações e NÃO
  arma retomada (`armarRetomada` relê a conversa). Pino
  `encerrar-nao-apaga-turno-1109.test.ts`.
