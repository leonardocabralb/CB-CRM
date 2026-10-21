---
paths:
  - "src/lib/inbox/rascunho-da-conversa*"
  - "src/hooks/use-rascunho-da-conversa*"
  - "src/lib/inbox/anexos-da-conversa*"
  - "src/hooks/use-anexos-da-conversa*"
  - "src/components/inbox/message-composer.tsx"
---

# Rascunho por conversa — regras

Pedido do operador (15/10/2026): como no WhatsApp, cada conversa guarda o seu
rascunho — trocar de conversa mostra o da conversa aberta, e voltar devolve o
que ficou. Antes, o compositor (que NÃO remonta na troca) levava o texto
escrito para um cliente à caixa do próximo. Regra pura em
`src/lib/inbox/rascunho-da-conversa.ts` (pino `rascunho-da-conversa.test.ts`);
o hook é `useRascunhoDaConversa`; pinos estruturais em
`rascunho-da-conversa.chamadores.test.ts`. O resto do compositor está em
`.claude/rules/inbox-conversa.md`.

- ⚠️⚠️ **Sem banco, por decisão do operador**: `localStorage`, chave
  `cb-rascunho:<user.id do login>:<conversa>`. Outra pessoa no mesmo navegador
  não vê o rascunho de quem saiu, e por isso "Sair" não o apaga (o texto fica
  legível nas ferramentas do navegador, como o cache das páginas). Login ainda
  desconhecido = só na memória da aba, nunca sob chave sem dono.
- ⚠️⚠️ **O `setText` do compositor é PRESO à conversa do render** (muda de
  identidade com ela). Quem escreve DEPOIS de uma espera — a sugestão da IA, o
  agendamento que limpa o campo — escreve no rascunho da conversa de ORIGEM:
  antes, a sugestão pedida para A caía na caixa de B. Todo `useCallback` que o
  chama o leva nas dependências; a diretiva no topo do compositor faz o
  `react-hooks/exhaustive-deps` ser ERRO ali (no resto do projeto é aviso, e
  aviso não reprova o CI). Um `setText` estável, lendo a conversa por ref,
  devolveria o defeito.
- ⚠️ **O TEXTO vai para a origem; o resto é da TELA.** O que termina depois
  de uma espera só mexe em foco, hora agendada e citação se a conversa aberta
  ainda for a de origem (`conversaNaTelaRef.current === origem`): o foco da
  sugestão da IA cairia na caixa do cliente aberto (até no meio de uma
  anotação), e limpar a hora escolhida lá faria o próximo Enter sair NA HORA.
  O agendamento só esvazia o rascunho que ainda for o texto agendado.
  ⚠️ `conversaNaTelaRef` anda num efeito de LAYOUT (vale também para as
  guardas de upload): o efeito de troca é passivo, e a continuação de um
  `fetch` entre o commit e ele leria a conversa anterior (Codex, PR #414).
- **Cota cheia**: o `setItem` falha e a versão VELHA é removida — ficaria no
  armazenamento e ressuscitaria ao recarregar (Codex, PR #414).
- ⚠️ **O render lê por `useSyncExternalStore`, nunca por efeito**: por efeito,
  o primeiro render depois da troca mostraria o texto da conversa anterior
  (efeito passivo, seção 8c da raiz). O repositório é de MÓDULO (memória da
  aba + armazenamento); o evento `storage` traz o que outra aba escreveu.
- **Vazio ou só espaços não fica guardado**; enviar esvazia o campo e apaga a
  chave. Vence em `DIAS_DO_RASCUNHO` (30) — a leitura apaga o vencido, e uma
  varredura por carga de página apaga o das conversas que nunca mais abrem.
  Armazenamento bloqueado ou cheio = vale só na memória da aba.
- **A altura é `acertarAltura`, em dois lugares só**: o `useLayoutEffect`
  sobre `text` (o texto muda sem digitação na troca; o `handleChange` NÃO
  mede, senão são dois recálculos de layout por tecla) e o ref de callback
  `refDaCaixa` (a caixa volta MONTANDO depois da prévia de anexo ou da
  gravação, sem o `text` mudar). Vazia volta ao `auto`, como depois de enviar
  — medida, cresceria até o placeholder, que quebra numa coluna estreita.
- **Fica de fora, de propósito:** a anotação interna (fecha na troca: o texto
  de um caso não pode ser salvo na conversa de outro), a citação e a mensagem
  retida na janela de desfazer (a troca a ENVIA, `liberarPendente`).
- Não há marca "Rascunho" na lista de conversas (o WhatsApp tem): seria a
  lista assinando o mesmo repositório.

### Os ANEXOS em rascunho (21/10/2026)

Pedido do operador: o anexo subido e não enviado fica na conversa em que foi
anexado, com a legenda, e volta com ela. Antes, a troca o APAGAVA — era a
única defesa contra o documento de um caso montado no compositor de outro.
Regra pura em `src/lib/inbox/anexos-da-conversa.ts` (pino
`anexos-da-conversa.test.ts`); o hook é `useAnexosDaConversa`; pinos
estruturais em `anexos-da-conversa.chamadores.test.ts`.

- ⚠️⚠️ **Só na MEMÓRIA da aba, por decisão do operador** ("como o WhatsApp"):
  recarregar ou fechar a aba perde os anexos (o texto continua, no
  `localStorage`). Repositório de MÓDULO no compositor
  (`anexosDaConversa`), chave `<user.id>:<conversa>`: o compositor que
  remonta (saiu da caixa de entrada e voltou, ou o painel da pauta) lê a
  mesma fila, e outra pessoa na mesma aba não vê a de quem saiu.
- ⚠️⚠️ **O `setDrafts` é PRESO à conversa, como o `setText`**, e pela mesma
  diretiva de lint: o upload, a cópia do acervo e a nota de voz que pousam
  DEPOIS da troca vão para a fila da ORIGEM (antes eram apagados); o
  desfeito volta para a fila guardada na retenção (`Retida.rascunho`). A
  SELEÇÃO é da tela: só muda com `conversaNaTelaRef.current === origem`.
- ⚠️⚠️ **Falha FORA da tela devolve só o que nem COMEÇOU** (com o aviso
  `anexosNaoSairam`); o que falhou fica marcado e fora da fila: tempo
  esgotado e 5xx também chegam como falha (entrega incerta), e sem a bolha à
  vista, oferecê-lo na prévia o mandaria em dobro. Na tela volta tudo.
- ⚠️⚠️ **O laço de AGENDAR para no desmonte, como na troca** (a posse zerada
  nos dois), **tira da fila cada anexo assim que ele É agendado e pula o que
  já está marcado ou saiu da fila**: vivo depois do desmonte, ele agendaria a
  fila que o compositor remontado oferece de novo — Enviar ou Agendar outra
  vez mandaria em dobro. O "X" não trava durante o laço.
- ⚠️ **A marca "já é de uma mensagem" (`entreguesRef`) é o Set de MÓDULO
  `caminhosEntregues`**: o compositor que remonta com um agendamento no ar
  mostra o anexo na fila, e sem a marca do que desmontou o "X" apagaria o
  arquivo da agendada.
- ⚠️ **A gravação vence a prévia** (`drafts.length > 0 && !recording`): um
  anexo que pousa com o microfone ligado esconderia a barra de parar.
- ⚠️ **`onSendRef`/`onSendMediaRef` andam num efeito de LAYOUT**: a fila da
  conversa nova aparece no primeiro quadro, e o envio nesse quadro levaria o
  despachante da anterior.
- ⚠️ **Só o descarte da PESSOA apaga objeto do bucket** (o "X" e o descartar
  tudo; o pino conta as chamadas de `removeStaged`). O preço da memória:
  quem recarrega com anexo em rascunho deixa o arquivo ÓRFÃO no `chat-media`.
  Se crescer, a saída é varrer — decisão do operador, porque apaga.
- `busy` (upload em curso) continua um só: subindo em A, o clipe de B espera.
