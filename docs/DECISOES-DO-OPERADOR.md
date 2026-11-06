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
- Motivos de perda (26/10/2026): dois campos Lista por área
  (desqualificação × perda) com "Outro" em texto livre; a ETAPA diz qual
  pergunta; obrigatório para quem move o card, a automação grava no próprio
  passo; o botão "Perdido" escolhe etapa e motivo e move.
- Cliente ideal (ICP, 05/11/2026): perfis com nome por conta, sobre campos
  personalizados (todos os critérios casam; em cada um, basta uma resposta
  marcada); "ICP?" quando o principal casa e os outros estão em branco; selo
  em qualquer card, perdido inclusive, e borda dourada só no ICP; "respondeu"
  NÃO é critério, vira retrato no painel; o perfil escolhe em que funis vale
  (nenhum = todos; só conta quem tem negócio num deles, 06/11/2026); no
  painel, o bloco nasce RECOLHIDO (selo, título e perfil; o porquê abre no
  clique, 06/11/2026)
  (`cliente-ideal.md`).
- Funil comercial: "por período" é o padrão (18/09/2026); taxa acima de 100%
  aparece como é; transferido conta no funil de origem. Degrau `pasta` depois
  do contrato, opcional, e "fechado" o inclui; painel por funil; "custo por
  contrato assinado" ao lado do CAC em pé (26/09/2026).
- Grupos (29/10/2026): renomear no WhatsApp vale também quando o grupo deixa
  qualquer participante mudar os dados (não só para admin); quem vê o grupo
  vê os telefones dos participantes, lidos na hora e nunca guardados.
  Em 30/10/2026: o participante com conversa no CRM abre a conversa pelo
  grupo, e o grupo aparece (e abre) na ficha do cliente que está nele, com a
  faixa de volta; guarda-se só o vínculo com a FICHA (`grupos.md`, 1117).
- Grupos (06/11/2026): o apelido interno é o título, mas o nome do WhatsApp
  fica à vista sob ele (cabeçalho, painel, `title` da linha); a busca acha o
  grupo pelo nome de quem está nele, só pelos nomes que o CRM guarda
  (`grupos.md`, 1126).
- "Não entregue" da Evolution: o ERROR de reenvio a aparelho secundário do
  cliente (05/10/2026) e o ERROR de mensagem de GRUPO (04/11/2026) não pintam
  a bolha de vermelho; custo aceito, a falha real de grupo fica em ✓
  (`whatsapp-evolution.md`, Recibos).
- Recibo de grupo (04/11/2026): ✓✓ e azul só quando TODOS os participantes
  de fora da conta receberam e leram, como o WhatsApp (nunca "alguém": o azul
  poderia ser de um colega); "Dados da mensagem" mostra quem recebeu e quem
  leu, do banco, sem ler o grupo ao vivo; o `message.status_updated` passa a
  sair para mensagem de grupo; sem teto para grupo grande (`grupos.md`).
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
  tem login é BLOQUEAR no Supabase (reversível; desde a 1116, 29/10/2026,
  apagar o login não leva mais o que ele criou — fica sem autor).
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
  edita, sem prazo, com marca "editada" (23/10/2026); o clique no aviso de
  menção ou resposta abre a conversa NO TRECHO da anotação (27/10/2026).
- Avisos (sino e Meu dia): cada um diz o cliente (ou o grupo); a conversa
  aberta por eles tem a faixa de volta à tela de origem; os avisos antigos
  sem a anotação ficam como estão, sem religação (28/10/2026).
- Arquivo recebido: todo formato entra (ZIP, RAR, MSG…); o que o navegador
  não mostra fica para baixar, com o nome real (27/10/2026).
- Quem mais está com a conversa aberta: frase acima do compositor, além dos
  avatares do cabeçalho (29/09/2026).
- Modo anônimo, só de admin, no menu do nome: abrir não zera as não lidas nem
  mostra a presença; responder zera; dura até desligar (01/10/2026).
- Aba escondida não lê: a conversa aberta numa aba atrás de outra (ou com a
  janela minimizada) não zera as não lidas nem marca presença; voltar para a
  aba zera (30/10/2026).
- Notificação do navegador: conexões que avisam por pessoa (todas marcadas);
  filtro salvo não decide; o sino também avisa, com som do CRM (20/10/2026).
- Canal: a faixa de divergência só informa, não bloqueia; cor derivada; anel
  no avatar e trilha colorida foram descartados.
- Envios sem recibo (04/11/2026): acende no cabeçalho e na faixa da conversa
  quando os 5 envios do CRM mais recentes com mais de 15 min, das últimas 3 h,
  em pelo menos 3 conversas, não têm recibo; só avisa, não trava, e diz para
  não reenviar; o Meu dia fica de fora; ligado em toda instalação, sem chave
  para desligar (`canais.md`; o resto em `docs/PLANO-alarmes-de-conexao.md`).
- Alarmes de conexão no sino (04/11/2026): o CRM grava o aviso do envio sem
  recibo só em horário útil (segunda a sexta, 8h–20h de Brasília; o que
  acendeu e apagou à noite não vai ao sino) e o do atraso quando a conexão
  fica 30 min recebendo com atraso, a qualquer hora; um aviso por episódio,
  "Continua" a cada 24 h, "Normalizou" só com prova; recebem owner/admin e os
  membros cujo perfil vê a conexão; ligados em toda instalação, sem chave
  (`canais.md`, 1122).
- Alarme de conexão na tela (05/11/2026): sem faixa fixa no topo (o operador
  achou feia); o botão das conexões do cabeçalho se ALARGA, com a cor do
  alarme e qual conexão e o quê; no popover, cada alarme fica na ficha da
  própria conexão, como os outros avisos dela (sem cartões no topo).
  O atraso só aparece ali quando dura 30 min, como no sino. Os alarmes de
  conexão da sentinela da VPS também aparecem no botão (1123) e vão, no sino,
  aos owner/admin e aos membros cujo perfil vê a conexão (D2); ela avisa as
  quedas seguidas pela classe do `stream:error` (`canais.md`, `deploy.md`).
- Agentes de IA: o Playground testa o RASCUNHO da tela, conferido como o
  salvar, e compara com o salvo; a conversa não zera ao salvar. Versão
  publicada separada só depois do piloto (DC4, 26/10/2026).
- IA: chave por PROVEDOR, uma para a conta toda — nunca por conexão
  (28/08/2026; 1047). O modelo é do módulo (Radar) e, com os agentes, de
  cada agente (D1 de `docs/PLANO-agentes-de-ia.md`).
- Agente de IA fora do horário: a mensagem espera e ele responde quando o
  horário abrir, se ninguém da equipe respondeu antes; o padrão da Anthropic
  é o Haiku 5.5, e o seletor mostra os modelos da chave (25/10/2026).
- Registro dos agentes de IA (DC1–DC3 de `docs/PLANO-central-dos-agentes.md`,
  26/10/2026): o turno sobrevive à conversa e à Lixeira (restaurar o religa);
  o texto do cliente sai em 90 dias e em TODA exclusão definitiva da ficha
  (prazo ou "Excluir agora"); o esqueleto fica, sem prazo.
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
- Envio que não saiu fica no fio como bolha "não enviada", PARA TODOS: a do
  robô (06/10/2026) e a da equipe (31/10/2026), inclusive a incerta ("pode
  ter saído"). A da equipe — a incerta também — não pausa a IA nem para a
  retomada; "Tentar de novo" só para quem tentou, e a vermelha fica como registro
  (`whatsapp-envio.md`).
- Instagram: robô não responde no Direct; unificar fichas é manual; o que a
  API não cobre fica inacessível na conversa.
- Conversa ENCERRADA quando nasce sem o cliente ter escrito: webhook de
  entrada (21/09/2026) e passo de envio da automação para ficha sem conversa
  (27/09/2026). Calendly e `send_to_number` a criam aberta.
- Evolution: voltar de versão da imagem está descartado. Trocar o chip é
  "Reparear" a conexão, nunca remover e recriar (03/10/2026). O guia de
  instalação recomenda a versão da nossa imagem (2.4 `e273b904` com os
  patches de `docker/evolution-cb/`), com o porquê no guia e junto do código,
  e quem instala MONTA a própria pelo workflow: o guia nunca aponta para a
  nossa imagem pública (04/11/2026; `deploy.md`).
- Celular: no toque o Enter pula linha; o app instalado abre em `/inbox`.
- "Sair" do menu sai só deste aparelho; 4 h inativo reabre o Meu dia, sem
  senha.
- Sessão conferida pela assinatura no middleware: "Sair de todos os
  aparelhos" e login apagado tiram as TELAS dos outros aparelhos em até 1 h
  (o vencimento do token), não no próximo clique; as rotas recusam na hora.
  Encurtar o token para 15 min foi oferecido e recusado (03/11/2026).
- Celular do membro: EXIGIDO ao abrir o CRM, não só no login (26/09/2026).
- Contatos relacionados: vínculo PAR A PAR, visto dos dois lados, com
  descrição opcional; quem edita contato vincula; faixa "Voltar para" de um
  nível só (29/09/2026).
- Possível duplicata: todos veem, só admin decide e une; só sinais fortes;
  sem lista; unir: D6–D11 de `docs/PLANO-fichas-duplicadas.md` (13/10).
- Tarefa recorrente: PELO CALENDÁRIO (nasce no dia do prazo, concluída ou
  não a anterior), contando do prazo anterior; só no formulário; avisa no
  sino (30/09/2026).
- Chave de API do funcionário (04/11/2026): pertence a um membro (suspender
  ou remover corta); recorte por FUNIL, nunca por conexão; a de funcionário
  e a recortada são SÓ DE LEITURA (o admin as edita, mas não lhes dá
  escrita); cliente sem card não aparece e o card que sai do funil some para
  a chave; validade sugerida de 90 dias só com funcionário (a de integração
  sugere "sem validade"); sem registro das chamadas por enquanto; sem MCP
  (`api-v1.md`).
