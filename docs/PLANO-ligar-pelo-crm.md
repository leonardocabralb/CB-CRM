# Ligar pelo CRM: WhatsApp Web numa máquina central (plano vivo)

Documento interno. Pedido do operador (10/11/2026): ligar pelo WhatsApp a
partir do CRM, com solução NÃO oficial. No Brasil o cliente atende mais a
ligação de WhatsApp do que a telefônica. Vizinho deste plano:
`docs/PLANO-ligacoes-do-whatsapp.md` (a ligação RECEBIDA já vira faixa no fio,
1044; a seção 8 de lá é o estudo da Wavoip).

## Estado

| Fase | O quê                                                      | Estado                 |
| ---- | ---------------------------------------------------------- | ---------------------- |
| 0    | Remover o OpenClaw da VPS (memória para o teste)           | ✅ 10/11/2026          |
| 1    | Teste A: a máquina liga, com áudio de arquivo              | pendente (espera a D5) |
| 2    | Teste B: o áudio no navegador do atendente                 | pendente               |
| 3    | Decidir a máquina: upgrade para a KVM 4 × segunda VPS      | pendente               |
| 4    | Ligar pelo CRM: botão, faixa no fio, gravação, transcrição | pendente               |
| 5    | Atender pelo CRM (ligação recebida)                        | pendente               |

## 1. Por que uma máquina central (o que foi descartado)

- **API oficial de ligações da Meta:** descartada pelo operador (D1). Além
  disso, só vale para número oficial, e as 4 conexões são por QR code.
- **Wavoip pelo `wavoipToken` da Evolution:** descartada.
  - A ponte da Wavoip exige um ajuste na Baileys (o `validate-connection.js`
    deles faz o cliente se apresentar como Windows/UWP), que a Evolution não
    aplica. Sem ele, o provável é tocar sem áudio.
  - Aplicar o ajuste mudaria a identidade das 4 conexões de produção, com
    risco de pedir QR de novo.
  - O servidor da Wavoip passa a comandar a sessão (envia nós, decifra,
    renova sessões).
  - Relatos públicos de problema: evolution-api #968 (tocou duas vezes e
    caiu), Whazing #212 (mensagens pararam de chegar depois de uma ligação),
    evolution-api #2012 (o suporte nunca confirmou). Nenhum relato na
    2.4/rc13, a nossa versão.
- **Wavoip pelo QR code próprio:** funcionaria, mas um terceiro recebe TODAS
  as mensagens do número.
- **Extensão do Chrome no computador de cada atendente:** descartada pelo
  operador (D2).
  - Cada computador ocupa uma vaga de aparelho conectado: 4 por número, e a
    Evolution já usa 1. Seriam no máximo 3 atendentes por número.
  - Cada máquina teria um WhatsApp Web próprio para manter conectado.
- **Aplicativo de computador (Mac e Windows):** a mesma limitação de vagas,
  mais dois robôs diferentes. O de Windows é o WhatsApp Web embrulhado
  (WebView2); o de Mac é nativo (Catalyst). E ainda um programa nosso
  instalado em cada máquina.
- **Pelo protocolo, sem navegador** (ex.: baileys-caller, que embrulha o
  VoIP do WhatsApp Web no Node): engenharia reversa frágil.
- **Escolhido:** uma máquina central com um Chrome por número, e o atendente
  fala pela própria aba do CRM. Ocupa UMA vaga por número, não importa
  quantos atendentes.

## 2. Como funciona (o alvo)

```
Atendente (aba do CRM, fone) ⇄ WebRTC ⇄ máquina de ligações
                                         └ Chrome do número (WhatsApp Web) ⇄ WhatsApp ⇄ cliente
```

- **Um Chrome por número.** Cada um tem perfil próprio, onde a sessão do
  WhatsApp fica guardada, numa tela virtual (Xvfb). O áudio também é virtual
  (PulseAudio): um microfone e um alto-falante por Chrome.
- **O robô** (Playwright pelo protocolo de depuração do Chrome, sem as marcas
  de automação) abre a conversa e aperta "Ligar".
- **A ponte de áudio.** O navegador do atendente abre uma conexão WebRTC com
  a máquina, a mesma tecnologia do Google Meet. A voz do atendente entra no
  microfone virtual do Chrome do número. O alto-falante virtual volta para o
  fone do atendente.
- **Gravação.** A máquina ouve os dois lados: grava, guarda no Storage e
  transcreve com o módulo que já existe.
- **Registro no fio.** A ligação FEITA pelo escritório não gera o aviso
  `CALL` na Evolution (medido em 26/09/2026, `.claude/rules/ligacoes.md`).
  Quem registra é o CRM, a partir do pedido de ligar.
- **Recebida.** Todo aparelho conectado toca, o Chrome da máquina também.
  Isso abre caminho para "Atender pelo CRM" (Fase 5).

## 3. Medido em 10/11/2026 (só leitura)

- **A VPS é a KVM 2 da Hostinger** (`srv725771.hstgr.cloud`): 2 núcleos (AMD
  EPYC 9354P), 7,8 GB **sem swap**, 97 GB de disco.
- **Fica em São Paulo:** 1,7 ms até o NIC.br de São Paulo e 60 ms do Mac do
  operador. Bom para o áudio.
- **Antes da Fase 0:** 3,7 GB disponíveis, carga 0,2. O maior consumidor era
  o OpenClaw (1,2 GB), seguido do Postgres (566 MB), do Typebot (405 MB), da
  Evolution (332 MB) e do CRM (236 MB).
- **Depois da Fase 0:** 4,9 GB disponíveis; o disco caiu de 36 GB para 32 GB
  usados.
- **A KVM 4** tem 4 núcleos, 16 GB e 200 GB (fonte de terceiros; o preço varia
  por promoção).
- **Estimativa, a medir na Fase 1:** cada Chrome com WhatsApp Web deve gastar
  de 0,5 a 1 GB (o app de Windows, que é o Web embrulhado, passa de 1,2 GB).
  Os 4 números somariam de 2 a 4 GB.

## 4. Fase 0: remoção do OpenClaw (feita em 10/11/2026)

O operador confirmou que não usa o OpenClaw e pediu a remoção, para liberar
memória para o teste.

**O que havia:**

- Um gateway de agente de IA instalado em 07–08/04/2026, como stack
  `openclaw`, em `openclaw.cbadvogados.com`, com os arquivos em
  `/opt/openclaw`.
- Um canal de WhatsApp habilitado, mas NUNCA pareado: sem credencial, ele se
  reiniciava a cada poucos minutos ("stopped"). Não ocupava vaga de aparelho
  em nenhum número.
- Um agente pelo OpenRouter que rodava ~50 vezes por dia e falhava por falta
  de crédito (`reason=billing`).
- Nenhum dos 26 fluxos do n8n o cita, e o repositório só o cita no
  `INFRA-VPS.md`.

**O que foi feito:**

- Cópia em `/root/backups/openclaw-20261110T172838Z.tar.gz` (1,3 MB, só root):
  config, workspace, os dois arquivos de stack, o `.env` e o
  `auto-approve.sh`. O resto de `/opt/openclaw` era um clone do código
  público (commit `fdf60c06b0`), sem mudança local.
- `docker stack rm openclaw`, a remoção das imagens (3,17 GB) e
  `rm -rf /opt/openclaw`.
- **Conferido depois:** os 15 serviços em 1/1. O CRM respondeu 307 (o
  redirecionamento para o login), a Evolution 200, o cron 401 (segredo no
  lugar) e `openclaw.cbadvogados.com` 404.

**Falta, com o operador:**

- [ ] Apagar o registro DNS `openclaw` (hoje ele dá 404 no Traefik).
- [ ] Revogar a chave do OpenRouter no site do OpenRouter: ela está dentro
      da cópia.
- [ ] Apagar a cópia quando quiser (`rm /root/backups/openclaw-20261110T172838Z.tar.gz`).

## 5. Fase 1: Teste A, na VPS atual, com um número

**Objetivo:** responder P1–P5 antes de escrever qualquer coisa no CRM.

**Montagem:**

- **Contêiner avulso** (`docker run`, fora do Swarm; a `CBAdvNet` nem aceita
  contêiner avulso), chamado `ligacoes-teste`.
  - Teto: `--memory 1.5g --memory-swap 1.5g --cpus 1`. Sem swap na VPS, um
    pico sem teto faz o sistema matar o processo maior, que pode ser o
    Postgres da Evolution; com teto, quem cai é só o Chrome.
  - Sem `--restart`: se cair, fica caído.
- **Dentro:** Google Chrome estável, Xvfb, PulseAudio e Playwright ligado ao
  Chrome pelo protocolo de depuração.
- **Perfil do Chrome** em `/root/ligacoes-teste/perfil` (sobrevive a recriar
  o contêiner). Esse perfil é a sessão do WhatsApp: protegê-lo como o
  `postgres_data`.
- **Nenhuma porta pública nesta fase.** A tela (para ler o QR) sai por noVNC
  em `127.0.0.1`, com acesso por túnel SSH.
- **Origem:** o número da D5. Recomendado: um chip que NÃO é conexão do CRM
  (o risco de bloqueio não deve cair sobre um número que atende cliente).
- **Destino:** celular pessoal do operador, nunca outra conexão do CRM (a
  outra conexão grava a chamada como cliente).
- **A ligação:** o microfone virtual toca um arquivo de áudio, e o que volta
  do alto-falante virtual é gravado.

**Perguntas:**

- **P1** — O botão de ligar aparece e a ligação completa no Chrome do Linux?
  A imprensa diz que funciona em qualquer navegador com WebRTC, inclusive no
  Linux, sem confirmação oficial. A liberação foi gradual (28/07/2026).
- **P2** — O áudio vai e volta inteiro, sem cortes?
- **P3** — Memória e processador: Chrome parado e Chrome em ligação.
- **P4** — O número segue bem? Sem aviso de bloqueio, e o celular e a
  Evolution seguem normais.
- **P5** — Dá para ter duas ligações ao mesmo tempo no mesmo número, de dois
  aparelhos conectados? Precisa de dois Chromes (duas vagas), então só com o
  chip de teste.

**Parar o contêiner se:** a memória disponível da VPS cair abaixo de 1 GB,
ou acender o aviso de memória da sentinela (`MemAvailable` < 300 MB). Antes
do teste há 4,9 GB disponíveis.

**Na VPS:** enquanto o contêiner existir, ele tem uma linha no
`docs/INFRA-VPS.md` (§4). Remover = `docker rm -f ligacoes-teste` e apagar
`/root/ligacoes-teste`, e no celular do número tirar o aparelho em
"Aparelhos conectados".

## 6. Fase 2: Teste B, o áudio no navegador do atendente

- **Uma página simples,** servida pela máquina e ainda fora do CRM: o
  atendente fala e ouve o cliente pelo fone.
- **O WebRTC precisa de caminho de rede até a máquina.** Ou se abre uma faixa
  de portas UDP na VPS, ou se usa um servidor TURN pela porta 443. A escolha
  é mudança na VPS e ganha linha no `INFRA-VPS.md`.
- **Perguntas:**
  - **P6** — O atraso deixa a conversa natural, sem um atropelar o outro?
  - **P7** — Há eco ou ruído com fone de ouvido?
  - **P8** — Funciona na rede do escritório (firewall do roteador)?

## 7. Fase 3: decidir a máquina

- **Upgrade para a KVM 4** (recomendado se a Fase 1 e a Fase 2 passarem):
  mesmo servidor, mesmo endereço, mesma operação. Com teto por Chrome, o
  risco de derrubar o CRM fica controlado. O ponto único de falha não piora:
  com a VPS fora, a Evolution e o CRM já caem juntos.
  - ⚠️ A troca de plano provavelmente reinicia a máquina (não há
    confirmação oficial da Hostinger). Depois de um reinício, a Evolution e o
    n8n já ficaram 1 h em laço (`INFRA-VPS.md`, §5.1).
  - Então: fazer fora do expediente, com a fila da Evolution em ~0 s em
    todas as conexões (a consulta da §9) e com a receita da §5.1 à mão.
  - Perguntar antes à Hostinger se reinicia e se dá para voltar de plano.
- **Segunda VPS:** isola as ligações do resto. Em troca, é mais um servidor
  para manter, atualizar e vigiar.

## 8. Fase 4: ligar pelo CRM (esboço, detalhar depois dos testes)

- **Botão "Ligar"** no cabeçalho da conversa: só 1:1 (nunca grupo), e só em
  conexão por QR que tem Chrome na máquina.
- **Rota do servidor do CRM** que fala com a máquina. O segredo vai no
  cabeçalho, e a máquina só aceita o CRM.
- **Fila:** um número = uma ligação por vez (até a P5 dizer o contrário). O
  segundo atendente vê "linha ocupada".
- **Faixa no fio:** a ligação feita vira bolha `content_type = 'call'`. Rever
  a `.claude/rules/ligacoes.md` inteira (hoje ela parte de que a feita não
  existe no CRM) e a lista de quem lê `content_type`.
- **A decidir com o operador (D6):** a ligação feita reabre a conversa? Apaga
  o "em atraso"? Pausa a IA? Para as sequências "parar se o cliente
  responder"? Hoje a RECEBIDA atendida pausa a IA e não para as sequências.
- **Gravação e transcrição (D7):** gravar sempre, nunca ou por escolha? O
  cliente é avisado? Quem ouve a gravação e por quanto tempo ela fica?
- **Permissão:** quem pode ligar (perfil). Se entrar no catálogo de perfis,
  atualizar `ESCRITA_DA_TELA`/`ESCRITA_DA_SECAO` (`CLAUDE.md`, 8e).
- **Doc:** se a API v1, o webhook de saída ou a ajuda na tela mudarem, a doc
  vai junto (`CLAUDE.md`, seção 11).

## 9. Fase 5: atender pelo CRM

- O Chrome da máquina toca junto com o celular. O CRM mostra "Atender", e
  quem atende primeiro (celular ou CRM) fica com a chamada.
- O aviso `CALL` da Evolution continua gravando a faixa da recebida como
  hoje. Juntar as duas pontas (a mesma ligação vista pela Evolution e pela
  máquina) é desenho desta fase.

## 10. Riscos

- **Bloqueio do número.** O WhatsApp Web automatizado é o que bibliotecas
  como a whatsapp-web.js fazem há anos, e uma ligação por clique de gente
  parece uso normal. O risco cresce com volume, principalmente ligações para
  quem nunca conversou com o número.
- **A tela do WhatsApp muda e o robô do clique quebra.** O conserto é num
  lugar só, mas precisa de vigia (a sentinela pode medir isso na Fase 4).
- **A máquina recebe todas as mensagens do número**, porque é aparelho
  conectado. Ela fica fechada (só o CRM fala com ela), e o perfil do Chrome no
  disco vale tanto quanto a sessão da Evolution.
- **Vagas:** a máquina usa 1 das 3 vagas que sobram em cada número. Depois de
  um "Reparear", conferir "Aparelhos conectados" no celular (`INFRA-VPS.md`,
  §9).
- **Sem swap na VPS:** o teto de memória do contêiner é obrigatório, em todo
  lugar onde a máquina rodar junto com o CRM.

## 11. Decisões do operador

- **D1 (10/11/2026):** sem solução oficial da Meta para ligar; a solução é não
  oficial.
- **D2 (10/11/2026):** a extensão do Chrome por atendente está descartada (um
  WhatsApp Web por computador e o limite de 4 aparelhos por número). O
  caminho é a máquina central.
- **D3 (10/11/2026):** testar primeiro na VPS atual, com um número; validado,
  migrar (upgrade para a KVM 4 ou segunda VPS).
- **D4 (10/11/2026):** o OpenClaw não é usado: removido (Fase 0).
- **D5 (pendente):** qual número faz o teste. Recomendado: chip fora do CRM.
- **D6 (pendente, Fase 4):** os efeitos da ligação feita no fio.
- **D7 (pendente, Fase 4):** gravação: quando, aviso ao cliente, acesso e
  prazo.

Quando a Fase 4 sair, as decisões de produto viram linha em
`docs/DECISOES-DO-OPERADOR.md` e detalhe em `.claude/rules/ligacoes.md`.

## 12. Fontes

- Ligação no WhatsApp Web: [Smartprix](https://www.smartprix.com/bytes/whatsapp-web-finally-gets-voice-and-video-calls-in-your-browser-no-desktop-app-needed/),
  [TechRepublic](https://www.techrepublic.com/article/news-whatsapp-web-browser-voice-video-calling/),
  [91mobiles](https://www.91mobiles.com/hub/whatsapp-web-voice-video-calling-call-transfer-support/).
- App de Windows em WebView2: [Notebookcheck](https://www.notebookcheck.net/WhatsApp-ditches-native-Windows-11-app-in-favor-of-Microsoft-WebView2.1063682.0.html);
  app de Mac em Catalyst: [WABetaInfo](https://wabetainfo.com/whatsapp-is-releasing-a-native-app-built-with-mac-catalyst/).
- Várias contas: [blog do WhatsApp](https://blog.whatsapp.com/multiple-accounts-coming-to-whatsapp)
  (sem suporte oficial no Web nem no computador até 11/2026).
- KVM 4: [vpsbenchmarks](https://www.vpsbenchmarks.com/hosters/hostinger/plans/kvm-4).
