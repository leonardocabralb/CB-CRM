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
- ⚠️⚠️ **"Não rodaram" = o plano DEPOIS do ponto de parada, MENOS o que o
  registro diz que rodou** (`montarDetalhe`). Os dois recortes são
  necessários: falha num ramo encerra a execução inteira (sobe até a raiz),
  mas "Aguardar" num ramo não segura o escopo de fora (o que vinha depois da
  condição pode já ter rodado). Ramo de condição não rodada não é afirmado.
  O ponto de parada é o passo `failed` que não é aviso de retentativa, ou a
  espera `cancelled`/`failed` da fila pela MESMA régua da retomada
  (`decidirRetomada`), ou o passo "não executado". Ponto que sumiu da
  automação (editada depois) → `naoRodaramDesconhecido`, nunca uma lista.
- ⚠️ **O texto do motor é traduzido NA TELA** (`lerTextoDoMotor`), depois da
  troca de id por nome (`textoComNomes`, a régua da tela de registros): vale
  para os registros já gravados. Texto desconhecido volta CRU, nunca some;
  o original fica no `title`. Frase nova do motor que mereça tradução: um
  padrão na tabela + a chave em `CHAVES_DO_MOTOR` + os dois dicionários
  (`Inbox.execucoes.motor.*`, chave montada — o teste cobra).
- **O rótulo do passo vem da automação de HOJE** (`descreverPasso`); o texto
  do motor é a fotografia (a etapa e a etiqueta que o passo USOU). Linha de
  conferência do motor (`step_id` vazio, tipo `wait`) tem rótulo próprio
  (`doMotor`): "Aguardar 0 h" seria falso.
- **As anotações de interrupção não viram passo** (o rodapé diz o motivo por
  `interrompida_por`); a lista as filtra pelas constantes exportadas
  (`DETALHE_DA_INTERRUPCAO`, `DETALHE_SAIU_DA_ETAPA`) — texto novo de
  anotação entra lá também.
