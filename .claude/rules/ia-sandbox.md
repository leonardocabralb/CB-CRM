---
paths:
  - "src/app/api/cb/ia/agentes/*/playground/**"
  - "src/components/agentes-de-ia/playground-do-agente.tsx"
  - "src/components/agentes-de-ia/detalhe-do-agente*"
  - "src/components/agentes-de-ia/rascunho*"
  - "src/lib/ia-agentes/sandbox-sem-efeito*"
---

# Sandbox dos agentes de IA: o Playground testa o RASCUNHO (DC4)

Decisão do operador (DC4 da central dos agentes, 26/10/2026; linha em
`docs/DECISOES-DO-OPERADOR.md`): o Playground testa o que está NA TELA, sem
salvar, validado como no salvar, e compara com a versão salva. Versão salva
separada da publicada (botão "Publicar") fica para depois do piloto, e só se
salvar um agente ligado por engano virar problema. Plano: C2 em
`docs/PLANO-central-dos-agentes.md` (S1 do anexo; o plano entra no `main`
com a C1). O resto do Playground (o
que o agente vê, ações simuladas, travas, retomada) está em `ia-agentes.md`,
`ia-agentes-turno.md` e `ia-retomada.md`.

### O que é o rascunho, e como se confere

- ⚠️⚠️ **O rascunho é o corpo PARCIAL do `PATCH` do agente** — o MESMO que o
  Salvar de cada aba mandaria agora: Configuração (`alteracoes`), Acesso
  (`acessoParaSalvar`), Ferramentas (`ferramentasParaSalvar`) e Retomada (o
  objeto inteiro). Cada aba o avisa ao detalhe por `aoMudarRascunho`,
  CARIMBADO com o `updatedAt` do agente; `juntarRascunhos` descarta o carimbo
  velho (efeito passivo: logo depois de salvar, a aba ainda não reavisou).
  Aba não visitada não tem rascunho. Aba NOVA com Salvar próprio avisa
  também, senão o teste mente sobre ela.
- ⚠️⚠️ **Conferido COMO o salvar**: `lerAlteracao` + `conferirRascunho`
  (`repo.ts`: a MESMA `conferirReferencias` do `atualizarAgente`, sem gravar;
  o provedor do rascunho, ou o salvo quando o rascunho LIGA). A recusa é o
  mesmo 400 do `PATCH`, com o código e os `itens` — a tela diz que o rascunho
  não passaria no Salvar. Regra nova de validação do salvar entra em
  `conferirReferencias` (vale para os dois), nunca só em `atualizarAgente`.
  As etapas NÃO são conferidas: não mudam a resposta, e a etapa tomada por
  outro agente continua sendo o 409 do salvar.
- **`aplicarAlteracao` (pura, `agente.ts`)**: o rascunho por cima do salvo;
  `ativo`, conexões e etapas ficam os SALVOS (decidem SE o agente atende, não
  o que ele responde — é o diagnóstico que os lerá). A tela lista à parte o
  que não muda a resposta (`NAO_MUDAM_A_RESPOSTA`, `rascunho.ts`; há teste
  amarrando a lista ao `aplicarAlteracao`): mudou o que o pedido lê, muda a
  lista junto.
- **A Base é sempre a SALVA** (a busca é pelo id do agente): o aviso âmbar é
  só dela.
- **O uso** continua `agente_teste` (D13), com o id e o NOME salvos: o nome
  do rascunho não vira nome no uso.
- Mudar o tipo de evento do Calendly no rascunho faz cada chamada ler a API
  do Calendly (é a conferência do salvar).

### A conversa NÃO zera ao salvar

- ⚠️ A `key` do Playground é só o id do agente (até 26/10 o salvamento a
  zerava, Codex #295: a conversa da versão anterior, mandada à nova, não
  testava versão nenhuma). Agora cada resposta leva o selo da versão que a
  gerou — "salvo às HH:MM" (`toLocaleTimeString(undefined, …)` do
  `updatedAt`) ou "rascunho" —, e nenhum efeito do Playground mexe na
  conversa (pino em `detalhe-do-agente.abas.test.ts`).
- **"Comparar com o salvo"**: a resposta à última mensagem do cliente pelas
  duas versões, lado a lado (2 chamadas: sem e com `rascunho`). É retrato:
  some a cada envio, retomada, roteiro, recomeço ou troca de cliente.
- **"Rodar o roteiro de novo"**: só as mensagens do CLIENTE, uma a uma, com
  as respostas NOVAS como contexto e a versão escolhida no clique (fixa na
  rodada). A contagem de chamadas aparece ANTES. ⚠️ O 429 PAUSA até o
  `retry_after_seconds` (o do provedor, 20 s) e retoma — não é erro; parar ou
  falhar devolve a conversa de antes. O teto da rota (20/min por pessoa,
  60/min por conta) é POR PROCESSO: dois no deploy.
- **"Mostrar o pedido enviado ao modelo"**: `verPedido: true` devolve
  `pedido`, o texto EXATO daquela resposta. Sob demanda: o pedido leva dado
  do cliente (ficha, cobranças) e não vai em toda resposta. O Playground é só
  de administrador (D14).
- **"Simular retomada"**: a cadência da versão testada; a rota devolve
  `desligada` quando a retomada está desligada nela — a simulação roda e a
  bolha avisa que na produção nada sairia.

### Nada do Playground escreve

- ⚠️⚠️ **A única escrita é a linha de custo em `ai_usage_log`
  (`agente_teste`).** Pino DEFAULT-DENY `src/lib/ia-agentes/sandbox-sem-efeito.test.ts`:
  os imports da rota são lista FECHADA (import novo reprova até a decisão ser
  escrita lá, com o motivo); nenhum nome de envio ou execução
  (`engineSendText`, `executarAcoes`, `marcarNoCalendly`, `anotarNaConversa`,
  `transferirParaGente`, `armarRetomada`, `cb_ia_reservar_envio`… — a lista
  confere que cada um ainda existe); a rota sem insert/update/upsert/delete/
  rpc; e `conferirRascunho`, `conferirReferencias` e `ferramentas.ts` só
  leem. A prova pelo comportamento é `route.escritas.test.ts`: o dublê anota
  TODA escrita e RPC, com as leituras REAIS (repo, acesso, base,
  ferramentas, agenda). As RPCs da busca da base
  (`cb_ia_buscar_conhecimento_*`) são leitura.
- **Limite aceito**: num agente LIGADO, salvar continua valendo na resposta
  seguinte. O rascunho permite PROVAR antes de salvar; não impede o salvar.
