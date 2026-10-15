---
paths:
  - "src/lib/inbox/rascunho-da-conversa*"
  - "src/hooks/use-rascunho-da-conversa*"
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
  ainda for a de origem (`conversaAnteriorRef.current === origem`): o foco da
  sugestão da IA cairia na caixa do cliente aberto (até no meio de uma
  anotação), e limpar a hora escolhida lá faria o próximo Enter sair NA HORA.
  O agendamento só esvazia o rascunho que ainda for o texto agendado.
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
- **Fica de fora, de propósito:** a fila de anexos (segue recolhida na troca:
  o arquivo de um caso não monta no compositor de outro), a anotação interna
  (fecha na troca, pelo mesmo motivo), a citação e a mensagem retida na
  janela de desfazer (a troca a ENVIA, `liberarPendente`).
- Não há marca "Rascunho" na lista de conversas (o WhatsApp tem): seria a
  lista assinando o mesmo repositório.
