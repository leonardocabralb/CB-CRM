---
paths:
  - "src/lib/execucoes/detalhe*"
  - "src/lib/execucoes/texto-do-motor*"
  - "src/lib/execucoes/nomes-dos-passos*"
  - "src/lib/execucoes/desfecho*"
  - "src/app/api/cb/execucoes/detalhe/**"
  - "src/components/inbox/painel/aba-automacoes.tsx"
  - "src/components/inbox/painel/detalhe-da-execucao.tsx"
  - "src/hooks/use-execucoes-do-fio*"
  - "src/components/inbox/aviso-de-execucao.tsx"
---

# Automações — o "Já rodou" expansível (a mini-auditoria)

A seção "Já rodou" da aba Automações da conversa: cada execução encerrada
abre o REGISTRO — o que disparou, o que rodou na ordem, onde parou e por quê,
e o que não chegou a rodar (pedido do operador, 29/09/2026). O desfecho, o fio
e a aba em geral: `.claude/rules/automacoes.md` ("Execuções na conversa",
"Desfecho da execução"); as interrupções: `automacoes-esperas.md`.

- ⚠️⚠️ **A INTERROMPIDA entra no "Já rodou" da ABA, e SÓ nela** (decisão do
  operador): o fio continua com `itensDoFio`, que a descarta. Sem 4º
  desfecho nem migration — a régua da aba (`itensDoHistorico`) usa a marca
  durável `interrompida_em`/`_por` (1005). O desfecho VENCE a marca: a
  interrompida que já tinha falhado num ramo é falha. Motivo fora do CHECK
  vira "Interrompida", nunca um motivo inventado.
- ⚠️ **Duas consultas no hook da aba (`useHistoricoDeExecucoes`), nunca um
  `or`**: a interrompida tem `finalizado_em` nulo, e ordenar a consulta do fio
  por ele (DESC põe os nulos primeiro) mudaria o plano medido no índice
  `(account_id, contact_id, finalizado_em DESC)`.
- ⚠️ **O registro é lido ao ABRIR a linha** (`/api/cb/execucoes/detalhe`),
  nunca no carregamento do painel. É rota porque o "onde parou" da
  interrompida sai da FILA (service-role only: não abrir policy); o `context`
  da fila nunca vai para a resposta. Qualquer membro lê, como a rota irmã;
  toda consulta cercada pela conta (id de outra conta = 404); leitura que
  falha = 500 (a tela diria "nada ficou para trás" sobre o que não leu).
- ⚠️⚠️ **A ordem GRAVADA não é a ordem em que rodou** quando há ramo cheio:
  o ramo grava o array dele ANTES do escopo de fora gravar a condição
  (`[A, C, D]` com ramo `[B]` sai `[B, A, C, D]`). `emOrdem` põe o trecho do
  ramo gravado antes da condição logo depois dela; o gravado depois (a
  retomada) fica onde está. Teste com a ordem REAL do motor, nunca a
  idealizada.
- ⚠️⚠️ **"Não rodaram" = o plano DEPOIS do ponto de parada, MENOS o que o
  registro diz que rodou** (`montarDetalhe`). Aviso de retentativa NÃO conta
  como rodou: o envio recusado, reagendado e cancelado não saiu. Os dois
  recortes são necessários: falha num ramo encerra a execução inteira (sobe até a raiz),
  mas "Aguardar" num ramo não segura o escopo de fora (o que vinha depois da
  condição pode já ter rodado). Ramo de condição não rodada não é afirmado.
  O ponto de parada é o passo `failed` que não é aviso de retentativa, ou a
  espera `cancelled`/`failed` da fila pela MESMA régua da retomada
  (`decidirRetomada`), SOMADA aos passos `skipped` que não são condição
  ("não executado", a guarda "saiu da etapa"). Os motivos da retomada
  (`MOTIVOS_DA_RETOMADA`) são linha do MOTOR, como `step_id` vazio: o ponto de
  parada é a fila, nunca o escopo onde o passo está hoje. Ponto que sumiu da
  automação (editada depois) → `naoRodaramDesconhecido`, nunca uma lista.
- ⚠️ **Não há sinal de "a automação foi editada depois da execução"**:
  `automations.updated_at` muda a CADA execução (o contador passa pelo gatilho
  `set_updated_at`) e `automation_steps` não tem carimbo de edição. Aviso
  baseado nele apareceria sempre. Nomes dos PASSOS em modo estrito na rota:
  falha = 500, nunca "(apagado)" sobre alvo vivo.
- ⚠️ **O texto do motor é traduzido NA TELA** (`lerTextoDoMotor`), depois da
  troca de id por nome (`textoComNomes`, a régua da tela de registros): vale
  para os registros já gravados. Texto desconhecido volta CRU, nunca some;
  o original fica no `title`. Frase nova do motor que mereça tradução: um
  padrão na tabela + a chave em `CHAVES_DO_MOTOR` + os dois dicionários
  (`Inbox.execucoes.motor.*`, chave montada — o teste cobra).
- **O rótulo do passo vem da automação de HOJE** (`descreverPasso`); o texto
  do motor é a fotografia (a etapa e a etiqueta que o passo USOU). Linha do
  motor tem rótulo próprio (`doMotor`); passo que saiu da automação usa o
  rótulo do TIPO (`removido`). Só com o tipo — a linha fechada da aba e o
  cartão do fio — o rótulo é `Automations.builder.steps.<tipo>`, nunca
  `descreverPasso` sem config (escolhe variante: "Reabrir o negócio" para um
  "Marcar como ganho", "Aguardar 0 h"). `falhaQueEncerrou` ignora aviso de
  retentativa.
- **As anotações de interrupção não viram passo** (o rodapé diz o motivo por
  `interrompida_por`); a lista as filtra pelas constantes exportadas
  (`DETALHE_DA_INTERRUPCAO`, `DETALHE_SAIU_DA_ETAPA`) — texto novo de
  anotação entra lá também.
