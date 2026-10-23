# Decisões do operador — não reverter sem perguntar

Escolhas de produto do operador que parecem "erradas" a quem não conhece o
motivo. O detalhe de cada uma mora na regra da área (`.claude/rules/`); mudar
qualquer uma é pergunta ao operador.

- **Quando ler:** antes de propor mudança de comportamento de produto
  (`CLAUDE.md`, seção 0e) e antes de "consertar" algo que parece errado de
  propósito.
- **Decisão nova:** uma linha aqui e o detalhe na regra da área, no mesmo PR.

## As decisões

- Radar: sem aba "Todos"; falso negativo da IA não ganha botão.
- Funil: ganho que sai para etapa neutra segue ganho; perdido que entra em
  neutra volta aberto (21/09/2026).
- Funil comercial: "por período" é o padrão (18/09/2026); taxa acima de 100%
  aparece como é; transferido conta no funil de origem. Degrau `pasta` depois
  do contrato, opcional, e "fechado" o inclui; painel por funil; "custo por
  contrato assinado" ao lado do CAC em pé (26/09/2026).
- Card: título = nome da pessoa, sem prefixo de conexão; o Calendly renomeia
  até título escrito à mão e fixa o nome da ficha.
- Reuniões: "Data e Hora Reunião" mais nova que todo agendamento remarca a
  última reunião do Calendly na pauta (03/10/2026). Reagendar é fila de
  trabalho, não falta nem métrica: botão antes e depois do horário, sem faixa
  de no-show; no-show = cada entrada em etapa "Faltou" (09/10/2026).
- Abrir conversa não cria negócio (o card nasce no primeiro envio).
- Número de empresa (mandou mensagem de sistema, `template`) não vira card
  sozinho, nem pela resposta da equipe; cliente assim, card à mão (29/09/2026).
- Encerrar conversa SOLTA o responsável; quem reabre enviando fica
  responsável; cliente, celular e API reabrem sem responsável (02/09/2026).
- De ADMIN: "Gerenciar funil" e as abas Lista/Desempenho/Saúde
  (08/09/2026). A automação é da CONTA: qualquer admin edita, ativa,
  duplica e apaga, nunca só o autor (23/09/2026).
- Lixeira (B1–B6, 22/10/2026): excluir é de admin, 90 dias; restaurar volta
  o mesmo id; identidade ocupada → "Restaurar e unir": fica a ficha aberta,
  a conversa velha vira histórico (23/10).
- Cadastro só por convite (22/09/2026); a saída para ex-membro que ainda
  tem login é BLOQUEAR no Supabase (apagar o login leva por CASCADE o que ele
  criou: etiquetas, modelos, automações).
- Webhook de saída `conversation.created` = SÓ "o cliente abriu a conversa"
  (entrada; 23/09/2026) — emitir noutro caminho muda o contrato publicado.
- Retentativa de passo de automação só na Evolution; na Meta fica de fora
  (24/09/2026).
- Calendly: a ficha do cliente nasce do agendamento (08/09/2026).
- Caixa de entrada: filtro salvo é de cada membro; Encerradas não é filtro
  nem vai na visão salva; busca no corpo das mensagens desligada por padrão.
- Ficha: um bloco de campos por vez, em menu horizontal, na ordem de cada
  pessoa (12/10/2026).
- Anotação: caixa ANTES da fixada, que nasce recolhida (29/09/2026);
  anexos de todo tipo, vários, sem transcrição nem aba Arquivos; só o autor
  edita, sem prazo, com marca "editada" (23/10/2026).
- Quem mais está com a conversa aberta: frase acima do compositor, além dos
  avatares do cabeçalho (29/09/2026).
- Modo anônimo, só de admin, no menu do nome: abrir não zera as não lidas nem
  mostra a presença; responder zera; dura até desligar (01/10/2026).
- Notificação do navegador: conexões que avisam por pessoa (todas marcadas);
  filtro salvo não decide; o sino também avisa, com som do CRM (20/10/2026).
- Canal: a faixa de divergência só informa, não bloqueia; cor derivada; anel
  no avatar e trilha colorida foram descartados.
- IA: chave por PROVEDOR, uma para a conta toda — nunca por conexão
  (28/08/2026; 1047). O modelo é do módulo (Radar) e, com os agentes, de
  cada agente (D1 de `docs/PLANO-agentes-de-ia.md`).
- Automação presa à etapa: caixa por automação, marcada só nas criadas pela
  grade; as antigas não mudam (18/09/2026).
- Asaas: o CRM cria a ficha, com nome fixado; ligar a régua não é
  retroativo.
- Atlas: vincular/desvincular à mão só admin; a faixa acende também com
  suspenso e inativo; a linha do Atlas aparece a todos (sem recorte de
  perfil); o Atlas "ativo" NÃO apaga a linha do funil (30/09/2026).
- Cartão de contato com Copiar e Conversar; `.html` recebido só baixa e só
  se ENVIA por QR code (02/10/2026). Documento e cartão em destaque na
  bolha; fundo do fio a 15% (01/10/2026).
- Instagram: robô não responde no Direct; unificar fichas é manual; o que a
  API não cobre fica inacessível na conversa.
- Conversa ENCERRADA quando nasce sem o cliente ter escrito: webhook de
  entrada (21/09/2026) e passo de envio da automação para ficha sem conversa
  (27/09/2026). Calendly e `send_to_number` a criam aberta.
- Evolution: voltar de versão da imagem está descartado. Trocar o chip é
  "Reparear" a conexão, nunca remover e recriar (03/10/2026).
- Celular: no toque o Enter pula linha; o app instalado abre em `/inbox`.
- "Sair" do menu sai só deste aparelho; 4 h inativo reabre o Meu dia, sem
  senha.
- Celular do membro: EXIGIDO ao abrir o CRM, não só no login (26/09/2026).
- Contatos relacionados: vínculo PAR A PAR, visto dos dois lados, com
  descrição opcional; quem edita contato vincula; faixa "Voltar para" de um
  nível só (29/09/2026).
- Possível duplicata: todos veem, só admin decide e une; só sinais fortes;
  sem lista; unir: D6–D11 de `docs/PLANO-fichas-duplicadas.md` (13/10).
- Tarefa recorrente: PELO CALENDÁRIO (nasce no dia do prazo, concluída ou
  não a anterior), contando do prazo anterior; só no formulário; avisa no
  sino (30/09/2026).
