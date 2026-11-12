# Plano — alarme quando a IA para de responder (1140)

Pergunta do operador (12/11/2026), com os agentes do Trabalhista ligados: "se
os nossos tokens de IA acabarem ou a IA, por algum motivo, falhar, travar,
como a gente recebe esse aviso para saber que precisa recolocar os tokens?"

**Como estava (verificado no código):** ninguém era avisado. Créditos
esgotados, chave recusada, modelo retirado ou provedor fora do ar terminavam o
turno `falhou` (E8: sem pausar, sem transferir, sem anotação) — a falha
passageira (prazo, 429, 5xx) tentava UMA vez mais e depois também `falhou`. A
cliente ficava sem resposta, só "em atraso" na caixa de entrada, e o motivo
aparecia apenas na aba Turnos da tela do agente, que ninguém olha. O
`ai_usage_log` não registra a falha, e o alarme de conexão (1122) é do
WhatsApp, não da IA.

## Decisões do operador (12/11/2026, todas as recomendações)

- **F1 — Alarme no sino e na tela**: UM alarme por problema (não um por
  mensagem): abre na 1ª resposta que não sai, LEMBRA a cada 6 h enquanto
  durar e avisa quando normalizou. Abre a caixinha VERMELHA dentro do CRM (a
  mesma da 1139, em vermelho: vermelho no CRM é falha) e o pop-up do
  navegador de quem o ligou.
- **F2 — Não pausar a IA**: a E8 continua (a falha não pausa nem transfere).
  O alarme leva às conversas "Em atraso" (as clientes que ficaram sem
  resposta), e a IA volta sozinha quando o problema for resolvido.
- **F3 — Quem recebe**: o dono, os administradores e as pessoas marcadas em
  "Avisar quando passar para a equipe" nos agentes daquele provedor.

## Como ficou

- **O episódio é por (conta, PROVEDOR)** (`cb_ia_alarmes`): a chave e os
  créditos são do provedor, e todos os agentes dele param juntos. A decisão
  "abre / lembra / só conta" é do banco, SOB TRAVA
  (`cb_ia_registrar_falha`): duas falhas simultâneas abrem UM aviso (provado
  com duas sessões no Postgres local).
- **O que conta como "a IA parou"** (`motivoDaFalhaDaIa`): sem chave que
  sirva (ausente, que não decifra, só da base), créditos ou cota esgotados,
  chave recusada, modelo que sumiu (404), limite por minuto, provedor fora do
  ar (prazo, 5xx), resposta cortada, outro erro da geração. A leitura da
  chave que FALHOU (rede, banco) não é da IA e não abre alarme.
- **Normalizou** = a 1ª geração que deu certo naquele provedor (mesmo que o
  envio ao WhatsApp falhe depois: o provedor respondeu). O episódio fecha, os
  alarmes dele saem como lidos (a caixinha vermelha some) e quem recebe ganha
  o "A IA voltou a responder", só no sino, com o intervalo e quantas
  respostas não saíram.
- **O lembrete substitui o anterior**: o alarme anterior do mesmo episódio e
  provedor sai como lido (pelo título, que carrega o provedor) — senão um dia
  de problema empilharia quatro caixinhas vermelhas iguais ao abrir o CRM.
- **O clique** leva a `/inbox?ver=em-atraso` (o chip "Em atraso" aceso, em
  todas as conexões do perfil); com a caixa de entrada já aberta, um evento
  acende o chip.
- **Melhor esforço**: o alarme que falha vira log e nunca muda o desfecho do
  turno. O Playground não dispara alarme (pino `sandbox-sem-efeito.test.ts`).

### Os textos

- Título: "A IA parou de responder (Anthropic)"; lembrete: "A IA continua
  parada (Anthropic)"; volta: "A IA voltou a responder (Anthropic)".
- Corpo: o motivo com o conserto ("Créditos ou cota de Anthropic esgotados
  (ou limite de gasto atingido): confira o saldo no painel do provedor.") e
  "Parada desde 10:05 · 3 respostas não saíram." A volta: "Parada de 10:05 a
  12:00 · 3 respostas não saíram. Confira as conversas em atraso."
- ⚠️ O Gemini escreve "quota" também no limite POR MINUTO: por isso o texto
  diz "créditos OU cota".

## Limites aceitos

- Uma falha isolada (duas tentativas estouradas do Gemini) abre o alarme e,
  na próxima geração boa, o "voltou" — é verdade (uma cliente ficou sem
  resposta), e o par some sozinho. Se gerar ruído, a medida é exigir duas
  falhas seguidas para os motivos passageiros (limite por minuto, fora do ar,
  cortada, outro) — decisão do operador.
- O alarme não diz QUAIS clientes: leva ao filtro "Em atraso", que mostra
  também quem espera a equipe.
- Créditos que acabam numa conta sem agente ligado não avisam (só o turno
  registra). Radar, transcrição e rascunho não alimentam o alarme.

## Estado

- Código, testes, replay local até a 1140 (com e sem conta), cenários no
  Postgres local (`~/Downloads/CB-CRM/ferramentas/pg-replay/cenarios-1140`).
- **Falta**: aplicar a 1140 na produção (ADITIVA, antes do merge) e ver o 1º
  alarme real.
