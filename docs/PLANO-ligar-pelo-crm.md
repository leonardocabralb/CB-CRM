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
| 1    | Teste A: a máquina liga, com áudio de arquivo              | em curso (10/11/2026)  |
| 2    | Teste B: o áudio no navegador do atendente                 | ✅ 10/11/2026 (falta P8) |
| 3    | Decidir a máquina: upgrade para a KVM 4 × segunda VPS      | ✅ 10/11/2026: fica na VPS atual (D8) |
| 4    | Ligar e atender pelo CRM: botão, toque, gravação, transcrição | desenho pronto (§8), decisões tomadas (§8.10); ✅ 4a pronta e testada em 10/11/2026 (§8.13); 4b em curso (§8.14) |
| 5    | Atender pelo CRM (ligação recebida)                        | incorporada à Fase 4   |

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

**Montagem** (arquivos em `ops/vps/ligacoes-teste/`; no ar desde 10/11/2026):

- **Contêiner avulso** (`docker run`, fora do Swarm; a `CBAdvNet` nem aceita
  contêiner avulso), chamado `ligacoes-teste`.
  - Teto de memória `--memory 1536m --memory-swap 1536m`. Sem swap na VPS,
    um pico sem teto faz o sistema matar o processo maior, que pode ser o
    Postgres da Evolution; com teto, quem cai é só o Chrome.
  - Processador: começou com `--cpus 1` e cortou a voz (registro abaixo); vale
    `--cpus 2 --cpu-shares 256` (o CRM e a Evolution, com peso 1024, passam
    na frente). O comando inteiro, vigente, está no `INFRA-VPS.md` (§4).
  - Sem `--restart`: se cair, fica caído.
- **Dentro:** Google Chrome estável, Xvfb e PulseAudio. O Chrome é comandado
  pela porta de depuração (9222, só no loopback do contêiner), pelas rotas
  HTTP dela (`/json/new`, `/json/close`, `/json/activate`).
- **Perfil do Chrome** em `/root/ligacoes-teste/perfil` (sobrevive a recriar
  o contêiner). Esse perfil é a sessão do WhatsApp: protegê-lo como o
  `postgres_data`.
- **Nenhuma porta pública nesta fase.** A tela (para ler o QR) sai por noVNC
  publicado só no `127.0.0.1` da VPS, com acesso por túnel SSH. ⚠️ Mas o
  noVNC e a sinalização escutam em todas as interfaces DENTRO do contêiner e
  não têm senha: qualquer processo da VPS chega neles pela bridge da Docker
  (medido; os serviços do Swarm não chegam). Somado ao Chrome sem caixa de
  areia, é o motivo de o contêiner ficar PARADO entre as sessões (revisão a
  frio, 10/11/2026; detalhe no `INFRA-VPS.md`, §4).
- **Origem:** a da D5, a conexão Previdenciario - Comercial. (A recomendação
  inicial era um chip fora do CRM, para o risco de bloqueio não cair sobre um
  número que atende cliente; o operador escolheu assim.)
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
  aparelhos conectados? Precisa de um segundo Chrome com perfil PRÓPRIO
  (nunca o mesmo `/perfil`) e de mais uma vaga de aparelho no número.
  Pendente, e não é necessária: o desenho da Fase 4 é uma ligação por vez
  por número.

**Parar o contêiner se:** a memória disponível da VPS cair abaixo de 1 GB,
ou acender o aviso de memória da sentinela (`MemAvailable` < 300 MB). Antes
do teste há 4,9 GB disponíveis.

**Na VPS:** enquanto o contêiner existir, ele tem uma linha no
`docs/INFRA-VPS.md` (§4). Remover = `docker rm -f ligacoes-teste` e apagar
`/root/ligacoes-teste`, e no celular do número tirar o aparelho em
"Aparelhos conectados".

### Registro do Teste A (10/11/2026)

Montagem como acima: imagem de 1,35 GB, montada em 2 min 49 s na própria VPS,
com o Google Chrome 157.0.8103.50 (a versão "atual" do dia; a imagem não se
atualiza sozinha).
O QR foi lido pelo celular da Previdenciario - Comercial, e o WhatsApp Web
abriu já com o aviso "As ligações de voz e vídeo já estão disponíveis".

- ⚠️ **Teclado pela tela remota (noVNC) não serve para digitar**: o texto
  não chegou e o Chrome buscou "a" no Google. Abrir a conversa pelo controle
  do Chrome (porta de depuração, `PUT /json/new?<url>` e fechar a aba velha)
  funcionou. A Fase 4 dirige o Chrome por esse controle, nunca pela tela.
- ⚠️ **Abrir a conversa de um cliente no Chrome da máquina marca as
  mensagens como LIDAS para o cliente** — por qualquer caminho, inclusive o
  link do número (`/send?phone=`). No teste, a conversa se abriu SÓ pelo link
  do número do lead (que também a marca como lida), nunca clicando na lista,
  que abriria a de outra pessoa. Durante o teste, uma conversa da lista foi
  aberta pela tela e ficou lida. Na produção, a discagem não abre a conversa
  (§8.3).
- **Ligação 1 (a máquina liga para o lead), teto de 1 núcleo:** completou
  (40 s no WhatsApp); a fala do lead voltou gravada. **A voz que sai da
  máquina chegou CORTANDO** (relato do operador). Causa medida: o Chrome
  ficou em 96–125% do núcleo, e o sistema FREOU o contêiner em 14% dos
  intervalos (91 s no total). Sem placa de vídeo, o Chrome desenha a tela
  no processador; parado, a aba do WhatsApp gasta 35% de um núcleo.
  Memória: ~1 GB parado e 1,05 GB em ligação.
- **Ligação 2 (o lead liga, a máquina atende), teto de 2 núcleos com peso
  256** (`docker update --cpus 2 --cpu-shares 256`; o CRM e a Evolution têm
  1024 e passam na frente): o Chrome usou 85–107% (cerca de 1 núcleo), sem
  NENHUM freio (`nr_throttled` não mudou). Carga da VPS 1,87 em 2 núcleos.
  O toque da chamada também sai pelo alto-falante virtual e entra na
  gravação.
- ⚠️ **A ligação atendida pela máquina entra no CRM como PERDIDA.** A
  Evolution viu o `offer` e o `terminate` (15 s depois: o fim do toque nos
  outros aparelhos) e nenhum `accept`, porque quem atendeu foi um aparelho
  conectado. A faixa saiu como perdida, a conversa reabriu, contou como não
  lida e acendeu o "em atraso". Na Fase 5, quem atende pela máquina tem de
  registrar o atendimento (ou corrigir o desfecho), senão toda ligação
  atendida pelo CRM vira "perdida".
- **Ligações 3 e 4: janela 800×600, sem animações, e a tela remota ligada
  ou desligada** (pedido do operador: o ajuste economiza? atrapalha?). O
  contêiner foi recriado (`-e TELA=800x600 -e CHROME_EXTRA="--force-prefers-
  reduced-motion --disable-smooth-scrolling"`, imagem `ligacoes-teste:2`); o
  WhatsApp voltou sem QR. Medido pela média do `cpuacct` do contêiner (as
  leituras pontuais do `docker stats` da ligação 2 são menos precisas):

  | Situação | Processador | Memória |
  | --- | --- | --- |
  | Parado, 1280×800, tela remota conectada | 0,08 núcleo | 1.015 MB |
  | Parado, 1280×800, tela remota desligada | 0,05 núcleo | 1.002 MB |
  | Parado, 800×600 sem animações, tela desligada | 0,08 núcleo | 602 MB¹ |
  | Ligação 2: 1280×800, tela conectada, início da chamada | ~1,0 núcleo² | 1,03 GB |
  | Ligação 3: 800×600, tela conectada, início da chamada (20 s) | 0,78 núcleo | 0,80 GB |
  | Ligação 4: 800×600, tela DESLIGADA, meio da chamada (30 s) | 0,64 núcleo | 0,81 GB |
  | Ligação 4: 800×600, tela conectada, fim da chamada (15 s) | 0,59 núcleo | 0,82 GB |

  ¹ Chrome recém-aberto; a de antes vinha de 1 h de uso. ² Quatro leituras
  pontuais (85–107%). Nenhum freio nas ligações 2, 3 e 4.

  **Conclusões:** (1) a janela menor sem animações corta ~20–40% do
  processador da chamada (de ~1,0 para 0,6–0,8 núcleo) e não atrapalhou
  nada: o layout em duas colunas, o botão de ligar, o atender e o áudio
  funcionaram. Relato do operador sobre a voz que SAI da máquina: ligação 2,
  cortes que não atrapalharam a conversa; ligação 3, cortes quase
  imperceptíveis; ligação 4, nenhum corte. Custa só duas opções no início:
  **fica como padrão**.
  (2) A tela remota NÃO pesa: na mesma ligação, 0,59 conectada × 0,64
  desligada (ruído), e 0,03 núcleo parado. Mas a média não vê picos: a
  ligação 3 (tela conectada) teve cortes quase imperceptíveis e a 4 (tela
  desligada na maior parte) nenhum. Pode ser a tela ou só a rede; com uma
  ligação de cada, não dá para separar. Ela fica desligada durante a
  chamada, de todo jeito: na produção ninguém olha a tela (o robô usa o
  controle do Chrome).
  (3) As medições são de uma ligação cada; o começo da chamada gasta mais
  que o meio.
- **P1:** ✅ sim, nos dois sentidos. **P2:** ✅ a volta chegou inteira nas
  quatro; a ida cortou com o teto de 1 núcleo, deixou de atrapalhar com o
  teto de 2 e não cortou nada na ligação 4 (janela menor, tela desligada).
  **P3:** com o ajuste, ~0,8 GB e 0,6–0,8 núcleo por ligação. Para 4
  números ligando ao mesmo tempo, ~2,5–3 núcleos só para os Chromes: na KVM 4
  dividida com o CRM fica APERTADO (o CRM e a Evolution precisam passar na
  frente, peso 256 contra 1024); com 2 ligações ao mesmo tempo, folgado.

## 6. Fase 2: Teste B, o áudio no navegador do atendente

- **Uma página simples,** servida pela máquina e ainda fora do CRM: o
  atendente fala e ouve o cliente pelo fone.
- **O WebRTC precisa de caminho de rede até a máquina.** No teste ele passou
  DIRETO (registro abaixo), sem abrir porta. Se a rede do escritório barrar
  (P8), a saída é um servidor TURN (abrir porta na VPS): mudança que ganha
  linha no `INFRA-VPS.md`.
- **Perguntas:**
  - **P6** — O atraso deixa a conversa natural, sem um atropelar o outro?
  - **P7** — Há eco ou ruído com fone de ouvido?
  - **P8** — Funciona na rede do escritório (firewall do roteador)?

### Registro do Teste B (10/11/2026)

**Montagem** (`ops/vps/ligacoes-teste/ponte/`, imagem `ligacoes-teste:4`):

- `sinal.py` (Python, só biblioteca padrão, na 8090 do contêiner, publicada
  só em `127.0.0.1` da VPS): troca UMA oferta e UMA resposta WebRTC por HTTP,
  serve as duas páginas e põe no log do contêiner as linhas de diagnóstico
  delas.
- `ponte.html`, numa SEGUNDA aba do Chrome da máquina (aberta pelo controle
  do Chrome, com a aba do WhatsApp devolvida à frente): captura a fonte
  `VozDoCliente` e manda ao atendente; toca a voz do atendente na saída
  `EntradaMic` (`setSinkId`), cujo monitor é o "Microfone" do WhatsApp. Sem
  cancelamento de eco nem ajuste de volume do lado da máquina.
- `atendente.html`, no navegador do atendente, aberta pelo túnel SSH
  (`http://localhost:8090`: localhost conta como seguro e o navegador libera
  o microfone): microfone com cancelamento de eco, mostra ida e volta,
  variação e perda.
- STUN público do Google, só para cada lado descobrir o próprio endereço.
  Nenhuma porta aberta na VPS.

**Achados:**

- ⚠️ **O Chrome ESCONDE os monitores do PulseAudio** da lista de
  dispositivos (só mostrou "Padrão" e "Microfone"): a ponte parou sem achar a
  voz do cliente. Conserto: remapear o monitor do alto-falante numa fonte
  comum (`voz_cliente`, "VozDoCliente"), o mesmo truque do "Microfone".
- **A rede passou direto** (`srflx↔srflx`: os dois lados atrás de tradução
  de endereço, sem servidor de passagem), do Mac do operador à VPS: ida e
  volta de ~60 ms, variação de 5–8 ms, 19 pacotes perdidos em ~39 mil (0,05%)
  em 13 min conectado, espera no buffer de 55–82 ms do lado do atendente e
  60–80 ms do lado da ponte.
- **Sem ligação** (a fala tocada no alto-falante virtual, como se fosse o
  cliente): o operador ouviu no fone, e a voz dele chegou ao microfone do
  WhatsApp (fala a −25 dB, fundo a −53 dB).
- **Ligação de verdade** (a máquina ligou para o lead; o operador falou como
  atendente pelo navegador): **"funcionou áudio e microfone"** (relato do
  operador). 23 s de chamada.
- **Gravação dos dois lados de graça:** a máquina tem a voz do cliente
  (monitor do alto-falante) e a do atendente (monitor da entrada) em
  separado; `sox -M … remix` as junta num arquivo, cliente num canal e
  atendente no outro. É a base da gravação e da transcrição da Fase 4.
- **Processador:** a chamada pela ponte fica perto de 1 núcleo (estimado:
  0,68 de média em 30 s, dos quais ~18 s de chamada e ~12 s parado), contra
  0,6–0,8 sem a ponte. A ponte acrescenta a segunda conexão de áudio
  (codificar e decodificar) e o PulseAudio (~8% de um núcleo).
- **Cuidados para a Fase 4:** a ponte do teste fica conectada o tempo todo
  (13 min mandando o ambiente do atendente) e grava também depois que a
  chamada acaba. Na versão final, conecta por ligação e grava só da hora em
  que atende até a hora em que desliga.
- **P6:** ✅ "a ligação atravessou naturalmente, não teve muito atraso"
  (operador, 10/11/2026). **P7:** com fone, nenhum eco
  relatado; o ambiente do atendente chega a −50 dB. **P8:** pendente (o teste
  foi da rede do operador, não da do escritório).

## 7. Fase 3: decidir a máquina

**Decidido (D8, 10/11/2026): a máquina de ligações fica na VPS atual (KVM 2,
2 núcleos, 7,8 GB).** Upgrade ou segunda VPS só se der problema. Com ~1
núcleo por ligação pela ponte, a KVM 2 comporta UMA ligação por vez com
folga; a vigia é a carga e a memória da VPS (a sentinela já avisa
`MemAvailable` < 300 MB). As opções avaliadas ficam abaixo, para quando for
preciso:

- **Upgrade para a KVM 4** (a opção para quando a VPS atual não der conta):
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

## 8. Fase 4: ligar e atender pelo CRM (desenho, 10/11/2026)

Pedido do operador: desenhar JÁ a estrutura inteira, nos dois sentidos — como
a ligação toca na tela, a gravação, a transcrição e as informações. A antiga
Fase 5 (atender) entrou aqui. Nada disto está construído; as decisões do
operador (D6, D7, D9–D15) foram tomadas em 10/11/2026 (§8.10).

### 8.1 O que o atendente vê

**Ligar.**
- Botão **"Ligar"** (ícone de telefone) no cabeçalho da conversa aberta, ao
  lado das ações que já existem. Aparece só se a conexão da conversa tem
  computador de ligações; fica desligado, com a dica do porquê, quando: é
  grupo, o contato não tem telefone (Instagram), o computador está fora ou
  sem WhatsApp, a linha já está em ligação ("Em ligação com Ana"), ou o
  perfil da pessoa não tem o poder.
- O clique pede o microfone (só na primeira vez) e abre o **painel da
  ligação**: flutuante no canto da tela, montado no layout do painel — trocar
  de tela NÃO derruba a ligação. Mostra a foto e o nome do cliente, a conexão
  (com a cor dela), o estado ("Conectando o áudio…" → "Chamando…" → "Em
  ligação 02:13" → "Encerrada · 4 min 21 s"), e os botões **Mudo** e
  **Desligar**, o selo **"Gravando"** (D7) e o atalho "Abrir conversa".
  Recarregar a página com a ligação aberta pede confirmação.

**Receber.**
- Quando um cliente liga para um número com computador de ligações, aparece
  um **cartão de ligação recebida** no topo da tela, em qualquer tela do CRM,
  com **toque em laço**: nome da ficha (ou o telefone), a conexão e "tocando
  também no celular do escritório". Botões **Atender** e **Silenciar** (só
  para mim; não recusa — recusar num aparelho derruba a chamada em todos,
  D12).
- Quem vê o toque (D9): os atendentes cujo perfil vê a conexão, com o CRM
  aberto. Com a aba em segundo plano, sai também a notificação do navegador
  que o CRM já usa.
- O primeiro que clica em Atender fica com a ligação; para os outros o cartão
  vira "Atendida por Ana" e some. Se o celular do escritório atender antes,
  vira "Atendida no celular". Se o cliente desistir, some e a ligação
  perdida entra no fio, como hoje.

**No fio da conversa** (a faixa `aviso-de-ligacao.tsx`, estendida):
- Ícone pela direção (feita ↗, recebida ↙) e a frase: "Ligação feita por
  Ana · 4 min 21 s", "Ligação feita por Ana · não atendida", "Ligação
  recebida · atendida por Ana pelo CRM · 3 min", e as de hoje (perdida,
  atendida no celular).
- **▶ Ouvir** (o player de áudio do fio, com a gravação dos dois lados),
  **"Ver transcrição"** (diálogo Cliente/Atendente com os horários) e o
  **resumo** em 2–3 linhas (D11). Enquanto a transcrição roda: "Transcrevendo…".

**Na tela Conexões**, na ficha da conexão: a seção **"Ligações pelo CRM"**,
com o estado do computador de ligações (conectado ao WhatsApp, último sinal,
em ligação agora) e o botão **"Parear"**, que mostra o QR do WhatsApp Web do
computador (capturado da tela dele e renovado a cada poucos segundos, como o
QR da Evolution). Ninguém mais precisa de túnel nem de tela remota para
parear. A captura do QR já funciona na máquina (4a, `GET /qr`).

**Pedidos do operador (10/11/2026, depois do teste da 4a), para a 4e:**
- **No botão das conexões do cabeçalho**, ao lado de cada conexão que tem
  computador de ligações, o estado das LIGAÇÕES dela (pronto, em ligação,
  pedindo QR, fora do ar), além do estado do WhatsApp que já aparece ali.
- **Reconectar pelo CRM, do começo ao fim:** o QR aparece no CRM sozinho
  quando a sessão da máquina cai, e um botão **"Reparear"** desconecta a
  máquina do WhatsApp (a opção "Desconectar" do WhatsApp Web dela) para gerar
  um QR novo — a medir na 4e. Sem túnel e sem tela remota.
- **A sentinela vigia a máquina:** o sinal de vida (a cada minuto) parado,
  o WhatsApp da máquina pedindo QR e o contêiner parado viram aviso no sino e
  no botão das conexões, como os alarmes de conexão de hoje (1123). O
  contêiner avulso não entra no `replica:` de hoje (só serviço do Swarm):
  precisa de conferência própria.

**Quem pode:** neste CRM o "poder" sai do PAPEL (`roles.ts`, `useCan`,
`requireRole`) e o perfil recorta as telas e as CONEXÕES que a pessoa vê.
Então: ligar e atender a partir do papel de atendente (como enviar
mensagem), e só nas conexões que o perfil da pessoa vê (`canalNoEscopo`). Se
o operador quiser ligar/desligar por pessoa, isso vira uma seção no catálogo
de perfis (`catalogo.ts`), decisão à parte.

### 8.2 As peças

```
 navegador do atendente ──(rotas do CRM, com login)──► CRM ──(rede LigacoesNet, segredo)────────► computador de ligações
        ▲  │ áudio WebRTC (direto, STUN)                ▲                                         (1 por número)
        │  └──────────────────────────────────────────────────────────────────────────────────► Chrome + WhatsApp Web
        └── tempo real (Supabase) ◄── eventos ◄─────────┴──────────────── eventos (chamando, atendida, encerrada…)
```

- **Computador de ligações** (um CONTÊINER AVULSO por número, não serviço do
  Swarm — medido no §8.12; começa só na Previdenciario - Comercial, D10).
  Subprojeto `maquina-de-ligacoes/` no repositório, com `package.json`
  próprio (como o `mcp-server/`), imagem montada na própria VPS a partir do
  subprojeto (como a do teste), e os scripts em `ops/vps/ligacoes/` (§8.13).
  Dentro: Xvfb, PulseAudio, Chrome e um **orquestrador em Node** que:
  - comanda o Chrome pelo protocolo de depuração (`playwright-core`,
    `connectOverCDP`): ligar para um número, atender, desligar, ler o estado
    da chamada na tela, capturar o QR;
  - mantém a **ponte** (a página-ponte do Teste B, agora comandada por ele,
    sem o `sinal.py`): recebe a oferta WebRTC do CRM e devolve a resposta;
  - **grava** os dois lados (o monitor do alto-falante = cliente; o da
    entrada = atendente) do "atendeu" ao "desligou";
  - manda **eventos** ao CRM e responde à **API interna** (`/ligar` e
    `/atender` já levam a oferta WebRTC e devolvem a resposta; `/desligar`,
    `/estado`, `/qr`), só numa rede overlay PRÓPRIA entre o CRM e ele (nunca a
    `CBAdvNet`, §8.7), com segredo no cabeçalho;
  - manda um **sinal de vida** por minuto (o estado do WhatsApp e a ligação
    em curso). Sinal parado = "fora do ar" na tela e aviso (4e).
- **CRM — servidor:** as rotas de ligar, atender, desligar e de áudio (que
  repassam a oferta WebRTC à máquina e devolvem a resposta), a rota que
  recebe os eventos da máquina, a de ouvir a gravação (URL assinada curta) e
  a fila de transcrição.
- **CRM — tela:** o botão, o painel, o cartão de ligação recebida com toque,
  a faixa estendida, a seção da conexão e o poder no perfil.
- **Tempo real:** uma tabela pequena de **ligações ao vivo** (só enquanto a
  ligação existe), assinada pelo navegador, é o que faz tocar, sumir e
  mostrar o estado.

### 8.3 Ligação feita, passo a passo

1. O atendente clica em Ligar. O navegador pega o microfone e monta a oferta
   WebRTC com os candidatos de rede.
2. `POST` ao CRM com a conversa e a oferta. O CRM confere tudo (§8.1, D13),
   cria a ligação (direção "feita", atendente, estado "iniciando") e a linha
   ao vivo, e pede à máquina a ponte e a discagem num pedido só (`/ligar`).
   Devolve a resposta WebRTC: o atendente passa a ouvir o "chamando".
3. A máquina disca pela aba **Ligações → Nova ligação → número**, SEM abrir a
   conversa (abrir marca as mensagens do cliente como lidas — achado do
   Teste A). Se essa via não existir, abre a conversa pelo número (a medir na
   4a).
4. Eventos: chamando → atendida (o cliente atendeu: começa o cronômetro e a
   gravação) → encerrada (quem desligou, duração). Também: não atendida,
   ocupado, número sem WhatsApp, falhou.
5. Ao encerrar: a faixa "feita" entra no fio (o WhatsApp não avisa a Evolution
   das ligações feitas: quem registra é o CRM) como SÓ REGISTRO (D6: não
   reabre, não mexe nas não lidas nem no "em atraso", não pausa a IA), a
   linha ao vivo sai, a máquina envia a gravação e o CRM a transcreve.
   A máquina encerra sozinha aos 30 minutos (D13).
6. Se a ponte cair por mais de 15 s (o atendente fechou a aba, a rede caiu),
   a máquina DESLIGA: o cliente não fica falando com o vazio.

### 8.4 Ligação recebida, passo a passo

1. O cliente liga. A Evolution já manda o aviso `CALL` (`offer`), que hoje
   cria a linha em `cb_ligacoes`; a máquina vê o toque na tela dela.
2. Se a conexão tem computador de ligações conectado e livre, o CRM cria a
   linha ao vivo "tocando": o cartão toca para quem pode atender (D9).
3. O primeiro "Atender" REIVINDICA a linha (`UPDATE … WHERE atendente IS NULL
   RETURNING`, a regra do trabalho reivindicado); os outros recebem "já
   atendida". O navegador manda a oferta; o CRM pede a ponte e o `/atender`;
   a máquina clica em Aceitar e confere que é a chamada daquele número.
4. ⚠️ **O conserto do "atendida pelo CRM vira perdida"** (achado do Teste A):
   NÃO dá para depender de a confirmação da máquina chegar dentro da folga de
   10 s — o próprio atendimento dispara o `terminate` da Evolution, e o
   `registrar.ts` decide aos ~11 s e reivindica a linha (`desfecho IS NULL`);
   um `atendida_em` gravado depois não muda mais a faixa (revisão a frio).
   Então: no instante do "Atender" (a reivindicação), o CRM grava na linha de
   `cb_ligacoes` que há um **atendimento pelo CRM em curso**, e
   `desfechoDaLigacao` passa a NÃO decidir "perdida" enquanto ele estiver em
   curso (com teto, ex. 60 s). A confirmação da máquina grava `atendida_em`
   (e o atendente) e chama a mesma decisão: a faixa sai "atendida", com o
   nome. A falha (a máquina não conseguiu atender) apaga o "em curso" e chama
   a decisão: a regra de hoje vale. A rede de segurança é o laço lento, que
   decide as linhas paradas além do teto. Esses casos entram nos testes de
   `desfecho.ts`.
5. Se o celular do escritório atender antes, a Evolution manda o `accept` do
   próprio aparelho (como hoje) e o cartão some com "Atendida no celular".
6. Daí em diante, igual à feita: cronômetro, gravação, encerrada, faixa,
   gravação enviada, transcrição na fila. E, como a feita, a faixa da
   recebida atendida PELO CRM é só registro (D6b): não apaga o "em atraso",
   não pausa a IA, não reabre, não mexe nas não lidas.

### 8.5 Gravação e transcrição

- **Onde fica (pergunta do operador, 10/11/2026):** no **Storage do
  Supabase** (arquivos), nunca no banco (ele guarda só o caminho e o texto da
  transcrição) e nunca no disco da VPS (sem backup, 97 GB divididos com tudo,
  e a VPS é o ponto único de falha). A máquina guarda o arquivo só até o envio
  ser confirmado e então o apaga. Medido em 10/11: o Storage tem 2,6 GB
  (`chat-media`, 1,3 GB nos últimos 30 dias).
- **Formato (medido com a ligação do Teste B, 1 min 29 s):** o WAV do teste
  ocupa ~10,6 MB por minuto; **Opus estéreo a 24 kbps, cliente num canal e
  atendente no outro, ~160 KB por minuto (66× menor)** — é o que fica
  guardado. Opus é o formato de voz do próprio WhatsApp. (Opus mono a 16 kbps
  com os dois lados misturados daria ~82 KB/min, mas perde a separação de
  quem falou.) Conta de ordem de grandeza: 20 ligações de 5 min por dia ≈
  16 MB/dia ≈ 0,5 GB por mês.
- Para a transcrição, a máquina manda também os dois lados SEPARADOS (mono,
  baixa taxa), que saem do Storage assim que o texto fica pronto: no estéreo
  comprimido os canais podem vazar um no outro, e o lado limpo é o que diz
  quem falou. (Conferir o vazamento na 4a; se não houver, basta o estéreo.)
- A máquina manda cada arquivo ao CRM (rota interna, com o segredo), e o CRM
  o guarda no Storage: a chave de serviço do Supabase nunca vai à máquina.
  São no máximo ~13 MB por ligação (30 min). **Bucket PRIVADO** novo
  (`ligacoes`): o `chat-media` é público e uma
  gravação de ligação nunca pode ter endereço aberto. Para ouvir, a rota
  confere o acesso à conversa e devolve uma URL assinada de vida curta.
- **Quem transcreve (pergunta do operador, 10/11/2026):** o SERVIDOR DO CRM,
  pela função que já existe (`transcrever.ts`: Gemini, senão OpenAI, com a
  chave da conta — o mesmo caminho das notas de voz de hoje). O áudio vai ao
  provedor de IA, que devolve o texto; o CRM organiza (quem falou, horários,
  resumo) e guarda o texto no banco. Alternativa (D14): transcrever NA VPS com
  um modelo aberto (Whisper), sem mandar o áudio a terceiros e sem custo por
  minuto, mas disputando os 2 núcleos com as próprias ligações (D8) e mais
  lento; só faz sentido com máquina maior. A função é estendida para receber
  um arquivo em vez de uma mensagem, uma vez por lado. Os trechos com horário dos dois lados se
  intercalam num diálogo "Cliente / Atendente" — os canais separados resolvem
  quem falou, sem adivinhação. Com a trava `UPDATE…RETURNING` e o teto de
  tentativas de hoje; falta de chave devolve "sem chave" sem gravar.
  - ⚠️ A função de hoje manda o áudio inteiro de uma vez (até 15 MB) e corta a
    resposta em `MAX_TOKENS_TRANSCRICAO` (4.096): uma ligação longa estoura
    ("áudio longo demais"). A da ligação corta o áudio em PEDAÇOS (ex.: 10
    min, por lado) e junta os textos.
  - Quando roda: logo que a gravação chega (no `after()` da rota dos
    eventos), sem esperar o laço lento; o laço lento (`rodarManutencaoDoCiclo`)
    só repete o que falhou. Esperar o laço deixaria a transcrição até 15 min
    atrasada.
- **Resumo** (D11): 2–3 linhas pela IA da conta, sobre a transcrição.
- **No contexto da IA** (D11): a transcrição entra no que o agente de IA lê da
  conversa, como o áudio transcrito (com o mesmo teto por linha), e a
  ligação continua sem abrir turno. Depois dos 180 dias, entra só o resumo. Mexe em `ia-agentes/contexto.ts` e na
  regra `ligacoes.md` ("sem texto, fica fora do contexto" deixa de valer
  para a ligação transcrita).
- **Prazo** (decidido): 180 dias depois da ligação saem o ÁUDIO (do Storage)
  e a TRANSCRIÇÃO (do banco); fica SÓ o resumo, que segue no contexto da IA.
  Um passo novo no laço lento (`rodarManutencaoDoCiclo`) faz a poda, e a
  faixa passa a mostrar só o resumo, com "gravação expirada".
- **Exclusão:** a ficha excluída de vez (Lixeira, "Excluir agora") leva tudo
  antes do prazo, inclusive o resumo — a fila de arquivos de hoje só conhece
  o `chat-media`, e o bucket novo entra nela.

### 8.6 Dados (migration a partir da 1134: a 1133 é do Asaas)

- **`cb_ligacoes`** (já existe, fechada ao navegador) ganha: `direcao`
  (`recebida`|`feita`), `pelo_crm`, `atendente_id` (autoria: `ON DELETE SET
  NULL`), `estado`, `atendida_pelo_crm_em`, `duracao_seg`, as colunas da
  gravação (`gravacao_caminho`, `gravacao_situacao`) e da transcrição
  (`transcricao` jsonb com os trechos, `transcricao_situacao`,
  `transcricao_tentativas`, `transcricao_desde`, `resumo`). A feita pelo CRM
  usa `call_id = 'crm:<uuid>'` (a chave `(account_id, call_id)` continua).
- **`cb_ligacoes_ao_vivo`** (nova): uma linha por ligação em curso (conexão,
  conversa, contato, direção, estado, atendente, desde). Leitura por membro
  na forma da 1032, na publicação do tempo real; escrita só pelo servidor.
- **`cb_computadores_de_ligacao`** (nova, fechada ao navegador): conexão,
  endereço interno, situação, último sinal, ligação em curso. Fica fora de
  `cb_channels` de propósito: toda escrita lá refaz a sonda de saúde em cada
  aba, e o sinal de vida seria uma escrita por minuto.
- **`messages.ligacao`** (já existe) leva direção, atendente, duração e se há
  gravação/transcrição, para a faixa desenhar sem ler `cb_ligacoes`.
- **Bucket privado `ligacoes`**, caminho
  `account-<conta>/ligacoes/<ligacao>/{estereo,cliente,atendente}.ogg`.
- **Ambiente:** `LIGACOES_SEGREDO` (CRM e máquina) e, opcional,
  `LIGACOES_SERVIDORES_ICE` (STUN/TURN), no `crm.env`, no `environment:` da
  stack e no `.env.local.example` (os pinos `stack-env` e
  `env-documentado`). O endereço interno de cada computador mora no banco,
  nunca no código (`produto-gate`).

### 8.7 Segurança e privacidade

- ⚠️ **O risco principal (revisão a frio, 10/11/2026): o Chrome da máquina
  abre o que QUALQUER pessoa manda ao número** (fotos, figurinhas, fotos de
  perfil). Uma falha no Chrome vira código rodando dentro do contêiner, que
  guarda a sessão do WhatsApp do número; e, na VPS de produção, perto do
  resto (o kernel da VPS é o 5.4, fora de suporte, `INFRA-VPS.md` §2). Uma
  lista de endereços permitidos NÃO protege disso: o conteúdo vem de dentro
  do próprio WhatsApp Web. As defesas, todas obrigatórias na 4a:
  - **Chrome COM a caixa de areia** (sem `--no-sandbox`), por um perfil
    seccomp próprio (o padrão da Docker + `clone`, `unshare` e `setns`
    liberados). MEDIDO em 10/11 (§8.12): funciona, mas só em contêiner
    avulso — serviço do Swarm não aceita perfil seccomp.
  - **Imagem remontada toda semana**, na própria VPS (cron, a partir da 4c),
    com o Chrome do dia: o Chrome de uma imagem não se atualiza sozinho, e o
    Google corrige falhas de segurança toda semana.
  - **Contêiner sem privilégios:** `--cap-drop ALL --cap-add SYS_CHROOT`
    (o único que a caixa de areia precisa, medido) e `no-new-privileges`,
    usuário comum, o mínimo de escrita fora do perfil.
  - **Rede própria:** uma rede overlay SÓ entre o CRM e o computador de
    ligações — nunca a `CBAdvNet`, onde ficam o Postgres e o Redis com as
    chaves das conexões da Evolution.
  - **Sem tela remota em produção** (o QR vem pelo CRM) e sem porta
    publicada.
  - Mesmo assim o risco não é zero: decisão do operador (D15), que a medição
    resolveu sem VPS nova (a caixa de areia funciona aqui, §8.12).
- A sinalização passa pelo CRM, com login e o recorte do perfil; a máquina só
  aceita o CRM (segredo no cabeçalho). O áudio vai direto entre o navegador e
  a máquina, cifrado (WebRTC).
- Gravação e transcrição são dado sensível: bucket privado, URL assinada
  curta, leitura só por rota com o recorte do perfil, áudio por 180 dias e
  saída junto com a ficha (§8.5). Sem aviso falado de gravação (D7,
  decisão do operador).

### 8.8 Regras de uso

- **Uma ligação por vez por número** (um Chrome por número, e a KVM 2 dá
  conta de uma por vez, D8). A segunda tentativa vê "linha ocupada".
- **Anti-bloqueio** (D13): ligar só de conversa existente, até 20 ligações
  por hora por número; nunca discagem automática (só clique de gente).
- **Duração máxima** (D13): a máquina encerra sozinha aos 30 minutos; o
  painel avisa o atendente aos 28.
- **O que NÃO roda** continua valendo (`.claude/rules/ligacoes.md`): robô,
  automações e IA não reagem a ligação, e a ligação não para as sequências
  "parar se o cliente responder".
- **O celular do escritório continua tocando** e pode atender: o CRM é mais
  um aparelho.

### 8.9 Entregas, nesta ordem (cada uma com teste e conferência no preview
antes do merge; merge = deploy, com o operador ciente)

- **4a — Computador de ligações** (contêiner avulso): orquestrador, imagem,
  script de criação, API interna, eventos, gravação, QR, sinal de vida.
  Pronto quando: por comando, ele liga e atende com a ponte, grava os dois
  lados e mostra o QR; e o contêiner do teste é removido. Plano no §8.13.
- **4b — Banco e servidor:** migration, rotas, eventos, linha ao vivo,
  bucket privado, o conserto do "perdida".
- **4c — Tela:** botão, painel, cartão com toque, faixa estendida com ▶,
  poder no perfil, textos nos dois dicionários. Pronto quando: ligar e
  atender de ponta a ponta pelo CRM, com o lead de teste.
- **4d — Transcrição e resumo:** a fila, o diálogo na faixa, a transcrição
  no contexto do agente de IA (D11) e a poda aos 180 dias (saem o áudio e a
  transcrição, fica o resumo).
- **4e — Conexões e operação:** estado e QR do computador na tela Conexões
  e o estado das ligações no botão das conexões do cabeçalho; "Parear" e
  "Reparear" pelo CRM; a sentinela vigia o sinal de vida, o QR e o contêiner
  (os pedidos do operador de 10/11, §8.1); doc e ajuda na tela.

### 8.10 Decisões do operador (tomadas em 10/11/2026)

- **Formato da gravação:** Opus estéreo 24 kbps, cliente num canal e
  atendente no outro ("pra manter quem falou"). **Guarda: 180 dias**, e aí
  saem o áudio E a transcrição; fica SÓ o resumo ("sai o áudio e fica apenas
  o resumo").
- **D6 — a ligação FEITA pelo CRM no fio: só REGISTRO.** Nas palavras do
  operador: "não pausa a IA, não reabre a conversa e não marca como lida a
  conversa nem retira o 'em atraso'". Também não para as sequências.
- **D6b — a RECEBIDA atendida pelo CRM: a mesma regra da feita** ("o ideal é
  não apagar. Siga a mesma orientação da ligação feita"): só registro, sem
  apagar o "em atraso", sem pausar a IA, sem reabrir, sem mexer nas não
  lidas. A atendida no CELULAR do escritório segue a regra de hoje (1044),
  que ninguém mandou mudar.
- ⚠️ Para a D6 e a D6b: hoje toda linha `agent` inserida aciona o gatilho da
  972 (apaga o "em atraso") e a pausa da IA (`cb_pausar_ia_por_gente`) — é
  assim que a atendida no celular faz as duas coisas. As faixas da feita e
  da recebida atendida PELO CRM têm de ficar FORA desses gatilhos e de
  qualquer caminho que mexa nas não lidas, com teste provando cada um (4b).
- **D7 — gravação:** gravar TODA ligação feita ou atendida pelo CRM, SEM
  aviso falado no começo. Ouve quem vê a conversa.
- **D9 — quem vê o toque:** os atendentes cujo perfil vê a conexão, com o CRM
  aberto.
- **D10 — quais números:** o desenho vale para TODA conexão por QR ("todos
  possíveis"); ligado agora só na Previdenciario - Comercial.
- **D11 — transcrição:** automática, com resumo curto, e DENTRO do contexto
  do agente de IA (como o áudio transcrito; a ligação continua sem abrir
  turno — o agente não "responde" a uma ligação).
- **D12 — recusar:** sem "Recusar", só "Silenciar".
- **D13 — anti-bloqueio e duração:** ligar só de conversa existente, até 20
  ligações por hora por número; e a máquina ENCERRA SOZINHA a ligação aos 30
  minutos (o painel avisa aos 28).
- **D14 — quem transcreve:** o provedor de IA da conta (Gemini, senão
  OpenAI), como as notas de voz.
- **D15 — segurança:** seguir na VPS atual com TODAS as defesas do §8.7; se a
  caixa de areia não funcionar dentro do Swarm (§8.12), a máquina vai para uma
  VPS só dela. Resolvida pela medição de 10/11: a caixa de areia funciona
  NESTA VPS em contêiner avulso (não no Swarm), então a máquina fica aqui,
  como contêiner avulso (§8.13).

As duas suposições que estavam aqui foram respondidas pelo operador em
10/11/2026 e viraram a D6b e o prazo do formato, acima.

### 8.11 Onde encaixa no código (mapa de 10/11/2026)

- **Botão Ligar:** o cabeçalho é JSX dentro de `message-thread.tsx`
  (`MessageThread`), no bloco direito das ações (onde ficam lupa, atualizar,
  seletor de número e a pastilha de situação). O canal ali é o
  `activeChannel` (`useChannels` + `resolveChannelForConversation`), com
  `ehEvolution`/`ehGrupo` já calculados. O fio também é montado no painel da
  pauta (`conversa-em-painel.tsx`): o botão vale lá também, ou some lá — a
  decidir na 4c.
- **Painel da ligação e cartão de recebida:** na casca do painel
  (`src/app/(dashboard)/dashboard-shell.tsx`), ao lado do
  `BrowserNotificationsListener` e com a mesma condição (`!entradaPendente`):
  é o único lugar montado em todas as telas que não remonta ao navegar. A
  casca não usa `transform`, então `fixed` posiciona pela janela.
- **Toque:** `som-do-aviso.ts` toca DUAS notas, uma vez a cada 10 s entre as
  abas; o toque de ligação é um laço novo, com a mesma coordenação entre abas
  (`navigator.locks`), parado quando a ligação sai do estado "tocando". Aba
  em segundo plano: os hooks de notificação do navegador
  (`use-browser-notifications.ts`, que já tem o rótulo da ligação perdida).
- **Tempo real:** só `postgres_changes` existe no CRM (sem broadcast); a
  tabela ao vivo segue o molde de `use-realtime.ts`/`use-lead-events.ts`.
- **Faixa no fio:** `aviso-de-ligacao.tsx` (entra por retorno cedo em
  `message-bubble.tsx`); o tipo `DetalhesDaLigacao` (`src/types/index.ts`)
  ganha direção, atendente, duração e gravação. O player é o `PlayerDeAudio`,
  que recebe uma URL: a gravação entra por uma ROTA estável do CRM que confere
  o acesso e redireciona para uma URL assinada nova (assim a onda e o play
  funcionam com o link que expira).
- **Pinos de quem escreve mensagem:** `ligacoes.chamadores.test.ts` e
  `canal-da-conversa.chamadores.test.ts` (default-deny) pegam o escritor novo
  da faixa "feita": entra neles com o motivo.
- **Transcrição:** `src/lib/transcricao/transcrever.ts` (`transcreverAudio`,
  chave por provedor em `cb_ia_chaves`, `escolherLeitor`); custo em
  `ai_usage_log` (modo novo, ex. `transcricao_ligacao`).
- **Storage:** os quatro buckets são PÚBLICOS e nada usa URL assinada
  (`createSignedUrl`/`createSignedUploadUrl` não aparecem em `src/`): o
  bucket privado e as URLs assinadas são padrão novo, com teste próprio.
- **Rotas:** o molde é `src/app/api/ai/autoreply/[conversationId]/route.ts`
  (`requireRole('agent')`, limite de chamadas, 400/404/409, `toErrorResponse`);
  a escrita em service role cercada por `.eq('account_id', …)`.
- **Papel:** um `CanAction` novo em `use-can.ts`, o predicado em `roles.ts`,
  a entrada em `PODERES` (`poderes.ts`) e a chave
  `PerfisPanel.poderes.<id>` nos dois dicionários (cobrada por
  `poderes.test.ts`).
- **Conexões:** a seção "Ligações pelo CRM" entra em `cb-channels-panel.tsx`,
  e o QR do computador segue o laço do QR da Evolution que já existe lá
  (`setTimeout` encadeado, 5 s). O estado do computador pode viajar na sonda
  de saúde (`/api/cb/channels/health`), como os alarmes da sentinela (1123).
- **Painel lateral:** uma aba "Ligações" (opcional) em `painel-do-contato.tsx`,
  antes do Histórico, que é sempre a última.
- **Onde roda:** contêiner AVULSO (o Swarm não aceita o perfil seccomp da
  caixa de areia, §8.12) com `--restart unless-stopped`, numa rede overlay
  ANEXÁVEL PRÓPRIA (`LigacoesNet`) que só o CRM e os computadores de
  ligações compartilham — não a `CBAdvNet` (§8.7); o CRM o chama pelo nome do
  contêiner nessa rede. A rede nova no serviço do CRM e a variável nova
  exigem `docker stack deploy` do CRM com as três linhas (`CLAUDE.md`, seção
  10), com o operador ciente (4b).

### 8.12 A medir no começo da 4a (riscos)

- ✅ **MEDIDO em 10/11/2026: a caixa de areia do Chrome.** O serviço do Swarm
  (Docker 28.0.1) aceita `--cap-add`/`--cap-drop`, mas NÃO `--security-opt`
  (sem perfil seccomp próprio nem `no-new-privileges`). Kernel 5.4 com
  `kernel.unprivileged_userns_clone = 1`. Com um perfil de Chrome VAZIO
  (nada da sessão do WhatsApp), o Chrome 157 abrindo uma página, e a prova
  pelos namespaces (a página roda noutro namespace de usuário e de processos
  que o navegador):

  | Configuração | Caixa de areia |
  | --- | --- |
  | Padrão da Docker (o que o serviço do Swarm teria) | ❌ o Chrome nem abre ("setuid sandbox: failed to move to new namespaces") |
  | + `CAP_SYS_ADMIN` (o que o Swarm aceita) | ✅ ativa — mas o privilégio é amplo demais (rejeitado) |
  | Perfil seccomp do Chrome (só contêiner avulso) | ✅ ativa |
  | Perfil + `--cap-drop ALL` | ❌ o Chrome não abre |
  | **Perfil + `no-new-privileges` + `--cap-drop ALL --cap-add SYS_CHROOT`** | ✅ **ativa: é o alvo** |

  O perfil é o padrão da Docker 28.0.1 (`moby/profiles/seccomp/default.json`)
  mais UMA regra que libera `clone`, `unshare` e `setns`; está em
  `/root/ligacoes-teste/seccomp/` e vai para o repositório na 4a.
- A via **"Nova ligação"** do WhatsApp Web (sem abrir a conversa) existe e é
  comandável; senão, como abrir a conversa sem marcar como lida.
- O WebRTC sai de um contêiner na rede overlay anexável (NAT pela
  `docker_gwbridge`) como saiu do contêiner na bridge padrão; e a rede
  overlay volta depois de um reinício da VPS (o §5.1 do `INFRA-VPS.md`
  mostra a overlay voltando pela metade).
- Ler o estado da chamada na tela (chamando, atendida, encerrada, quem
  desligou) com seletores estáveis, e testá-los contra telas salvas.
- P8 (a rede do escritório) — se barrar, o TURN entra antes da 4c.

### 8.13 Plano de implementação da 4a (10/11/2026)

**Objetivo:** o computador de ligações de PRODUÇÃO, ainda sem o CRM. Por
comando, ele liga e atende com a ponte, grava os dois lados, mostra o QR e
avisa o que acontece. Nada muda no CRM nem no banco (isso é a 4b).

**Onde roda** (decidido pela medição do §8.12):

- Contêiner avulso `ligacoes-<número>`; o primeiro é `ligacoes-previdenciario`.
  - Segurança: `--security-opt seccomp=<perfil do Chrome>`,
    `--security-opt no-new-privileges`, `--cap-drop ALL --cap-add SYS_CHROOT`.
  - Recursos: os tetos do teste (`--memory 1536m --memory-swap 1536m
    --cpus 2 --cpu-shares 256 --shm-size 256m`) e um teto de processos
    medido na 4a.
  - `--init`, `--restart unless-stopped`, log com teto e NENHUMA porta
    publicada.
- **Rede `LigacoesNet`:** overlay ANEXÁVEL, criada uma vez. Na 4a só entram
  a máquina e a bancada (abaixo); o CRM entra na 4b.
- **Pastas na VPS**, em `/root/ligacoes/<número>/` (com `/root/ligacoes` em
  700):
  - `perfil`: a sessão do WhatsApp, protegida como o `postgres_data`;
  - `gravacoes`: os arquivos ficam só até o envio ser confirmado.
- **O perfil já pareado do contêiner de teste é MOVIDO** para o primeiro: sem
  QR novo e sem gastar outra vaga de aparelho. Nunca dois contêineres no
  mesmo perfil.
- ⚠️ **Entre a 4a e a 4c ele fica PARADO fora das sessões de teste.**
  Ninguém o usa, e nada o vigia ainda: o sinal de vida só chega ao CRM na 4b.
  O `--restart unless-stopped` respeita o `docker stop`, inclusive depois de
  reiniciar a VPS.

**O subprojeto `maquina-de-ligacoes/`** (Node 22, TypeScript, com
`package.json` próprio, como o `mcp-server/`):

- `config.ts` — lê o ambiente:
  - `LIGACOES_SEGREDO` (obrigatório);
  - `LIGACOES_URL_DO_CRM`: para onde vão os eventos (vazio = só no log);
  - `LIGACOES_COMPUTADOR`: o nome dele nos eventos;
  - o tamanho da tela.

  Nenhum endereço nosso fica no código: o portão `produto-gate` passa a
  cobrir a pasta.
- `index.ts` — o processo principal (o `iniciar.sh` abre o Chrome, COM a
  caixa de areia e SEM o segredo no ambiente, e entrega o processo a ele):
  - liga-se ao Chrome pelo controle de depuração (`playwright-core`,
    `connectOverCDP`), espera a aba do WhatsApp (nunca abre uma segunda no
    mesmo perfil) e abre a da ponte.

  Se o Chrome fecha, uma aba trava ou fecha, a API cai, ou a aba do WhatsApp
  fica ~60 s sem responder, ele sai com erro e a Docker reinicia o
  contêiner: um caminho só de recuperação. (O PulseAudio e a tela virtual não
  são vigiados à parte: sem a tela, o Chrome cai junto.)
- `servidor.ts` — a API interna, na porta 8080, só na `LigacoesNet`.
  Segredo no cabeçalho, comparado em tempo constante, e teto no tamanho do
  corpo. As rotas:
  - `GET /estado` → o estado do WhatsApp (`carregando`|`qr`|`conectado`), a
    ligação em curso e a versão do Chrome;
  - `GET /qr` → o QR como imagem, recortado da tela e renovado sozinho;
  - `POST /ligar` `{ligacao, numero, oferta, ice}` → `{resposta}`: monta a
    ponte e devolve na hora a resposta WebRTC (o atendente já ouve o
    "chamando"), depois disca;
  - `POST /atender` `{ligacao, numero, oferta, ice}` → `{resposta}`: confere
    que a chamada que toca é desse número e aceita;
  - `POST /desligar` `{ligacao}`.

  As recusas:
  - 401 sem o segredo;
  - 409 linha ocupada, ou nada tocando;
  - 503 com o WhatsApp desconectado.

  O limite de 20 por hora (D13) mora só no CRM (4b), onde está a regra.

  O número chega como o WhatsApp o conhece (o JID da conversa, com ou sem o
  nono dígito), nunca na grafia digitada: quem resolve isso é o CRM (4b).
- `whatsapp.ts` — a tela do WhatsApp:
  - TODOS os seletores em `SELETORES`: é o único conserto quando a tela do
    WhatsApp mudar (medidos: `aria-label` em português e `data-testid`; a
    tela não tem mais `data-icon`);
  - uma consulta tira um RETRATO da tela (há QR? a barra da sessão? o quadro
    da chamada, com o texto e os botões?), e a função PURA `decidir` diz o
    estado a partir dele. Os testes usam retratos escritos à mão, fictícios:
    nunca a tela real copiada (ela tem nomes e mensagens de clientes);
  - as ações: discar pelo discador (sem abrir a conversa, §8.3), aceitar,
    desligar e recortar o QR.
- `ponte.ts` + `ponte.html` — a página-ponte do Teste B, agora comandada pelo
  orquestrador: `conectar(oferta)` devolve a resposta, e a página avisa
  quando a rede cai.
  - Servida só no `127.0.0.1` do contêiner.
  - Sai o `sinal.py`.
- `ligacao.ts` — a máquina de estados: livre → discando ou tocando →
  chamando → em ligação → encerrada.
  - UMA ligação por vez.
  - Desliga sozinha aos 30 min (D13) e quando a ponte fica caída por mais de
    15 s.
  - O motivo do fim vai no evento: `cliente_desligou`, `atendente_desligou`,
    `nao_atendida`, `ocupado`, `sem_whatsapp`, `teto_30min`, `ponte_caiu`
    ou `falhou`.
- `gravacao.ts` — do "atendeu" ao "desligou", um `ffmpeg` lê as duas fontes
  do PulseAudio (o cliente, pelo monitor do alto-falante; o atendente, pelo
  monitor da entrada). Ele escreve três arquivos: o estéreo Opus de 24 kbps
  e os dois monos (§8.5).
  - O Ogg sai escrito aos pedaços: se o contêiner cair no meio, a gravação
    até ali fica.
- `avisos.ts` — os avisos ao CRM: um `POST` com o segredo; se falha, tenta
  de novo com espera crescente (o CRM fica fora uns segundos a cada deploy).
  Repetir um aviso não estraga nada: o CRM grava cada informação uma vez só
  ("só se vazia"), como já faz com os avisos de ligação da Evolution. Os
  avisos: `sinal` (a cada minuto), `chamando`, `atendida` e `encerrada`. O
  toque da RECEBIDA o CRM já sabe pelo aviso `CALL` da Evolution (o `offer`):
  a máquina não o repete.
- **Envio da gravação:** a máquina manda cada arquivo ao CRM, que o guarda no
  Storage (§8.5); com o "recebido", apaga a cópia dela. Ao subir, reenvia o
  que tiver sobrado em `/gravacoes`.
- **Logs:** nunca o número, o segredo nem o corpo dos pedidos; a API anota o
  método, o caminho e o status de todo pedido que muda algo e de toda recusa.

**A imagem:**

- `maquina-de-ligacoes/Dockerfile`:
  - base `node:22-bookworm-slim`: a major do `.nvmrc`, por
    `ARG NODE_VERSION`, como o `Dockerfile` da raiz;
  - Chrome estável, Xvfb, PulseAudio, ffmpeg e as fontes;
  - SEM noVNC nem x11vnc;
  - usuário comum.

  A política do Chrome é a de hoje, mais `VideoCaptureAllowed: false` (sem
  câmera) e `DownloadRestrictions: 3` (nenhum download).
- `maquina-de-ligacoes/seccomp/chrome.json` — o perfil medido, versionado. A
  origem dele e a regra acrescentada ficam no README do subprojeto.
- **Montada na própria VPS** (como a do teste: 2 min 49 s), a partir de uma
  cópia do subprojeto em `/root/ligacoes/imagem/`, com o commit anotado.
  Sem workflow e sem registro de imagens: uma peça só (decisão do operador,
  10/11/2026, pela versão enxuta).
- **Na VPS, em `ops/vps/ligacoes/`:**
  - `criar-maquina.sh <número>`: o `docker run` inteiro, com os volumes;
  - **a partir da 4c** (quando a máquina passa a ficar ligada de vez), um
    cron semanal em `/etc/cron.d/`, como o da sentinela do WhatsApp:
    remonta a imagem com o Chrome do dia, troca o contêiner FORA de ligação
    e, se o WhatsApp não voltar conectado, volta o anterior sozinho. Sem
    ação de ninguém; se a montagem falhar, o contêiner antigo segue no ar.

  O cron `docker image prune -af` da VPS não apaga imagem de contêiner que
  existe.

**A bancada** (`ops/vps/ligacoes/bancada/`) — para testar a máquina antes
de mexer no CRM; sai quando o CRM assumir (4c):

- um contêiner temporário na `LigacoesNet` que faz o papel do CRM: guarda o
  segredo e recebe os eventos e as gravações;
- serve a página do atendente do Teste B, crescida: Ligar, Atender,
  Desligar, o estado e o QR;
- publicada só no `127.0.0.1` da VPS, e usada pelo túnel SSH;
- o segredo mora num arquivo da VPS (`/root/ligacoes/segredo.env`, em 600),
  nunca na conversa nem no navegador.

**Testes** (sem dado real: números fictícios e retratos de tela escritos à
mão):

- **Rodam na raiz**, para o `verificar` cobrir sem passo novo no CI:
  - o `vitest` passa a incluir `maquina-de-ligacoes/src/**/*.test.ts`;
  - o `playwright-core` entra nas dependências de desenvolvimento da raiz,
    na mesma versão do subprojeto (é o que o `mcp-server/` já faz com o SDK
    dele);
  - a imagem do CRM não leva a pasta (`.dockerignore`).
- **O que cobrem:**
  - a máquina de estados: os 30 min com relógio falso, a ponte caída, uma
    ligação por vez e os motivos do fim;
  - as decisões da tela, pelos retratos;
  - o servidor: segredo, teto do corpo, 409 e 503;
  - a fila de avisos: tenta de novo e desiste com teto;
  - o envio da gravação, contra um servidor local de teste.

**Medir primeiro, na imagem nova, antes do código que depende disso:**

1. **A caixa de areia COM o WhatsApp** (a medição do §8.12 foi com o perfil
   vazio): a página do WhatsApp roda noutro namespace? Medir também a
   memória, o processador e o número de processos numa ligação; o
   `--pids-limit` sai daqui.
2. **A via Nova ligação:**
   - acha um número que conversa com a conexão mas não está na agenda do
     celular?
   - disca sem abrir a conversa?

   Se não houver jeito sem abrir a conversa, a pergunta volta ao operador:
   abrir manda ao cliente a confirmação de leitura.
3. **Os seletores** de cada situação da chamada: saindo, tocando, em curso,
   encerrada (e quem desligou), não atendida e ocupado. E o que a chamada
   recebida mostra (o nome da agenda do celular, ou o número?), para o
   `/atender` conferir o número.
4. **A rede:** o WebRTC sai direto (`srflx`) com a máquina na
   `LigacoesNet`, e a bancada funciona publicada no `127.0.0.1`.
5. **A gravação:** os dois lados alinhados no tempo e, no estéreo, sem vazar
   um no outro (§8.5).

**Medido em 10/11/2026** (imagem nova, `maquina-de-ligacoes:20261110`, com o
perfil movido do teste; o WhatsApp abriu conectado, sem QR):

- ✅ **1. Caixa de areia com o WhatsApp:** as 4 páginas rodam noutro
  namespace de usuário e de processos que o navegador (contados pelo
  `/proc` da VPS). Parado: 835–870 MiB, 168–173 processos (o teto de 1.024
  sobra), 3–10% de um núcleo. Chrome 157.0.8103.50.
- ✅ **2. Discar sem abrir a conversa: pelo DISCADOR.** Aba "Ligações" →
  "Ligar para um telefone" → o número no campo (com ou sem o `+`). Com
  WhatsApp, aparece a pessoa com os botões "Ligação de voz" e "Ligação de
  vídeo" (`[data-testid=dialer_contact_call_buttons]`); sem WhatsApp,
  "Nenhum resultado encontrado" (`[data-testid=no-search-results]`). A
  busca da aba Ligações ("Pesquisar nome, número ou @nomedeusuário") também
  mostra os botões, mas na seção "Contatos". A tela não tem mais
  `data-icon`: os seletores são `aria-label` e `data-testid`, e o
  `aria-label` está em português (o Chrome abre com `--lang=pt-BR`).
- ✅ **3. A tela da chamada** (5 ligações com o lead de teste, 20:53–20:58
  BRT): a chamada, nos dois sentidos, é um QUADRO flutuante dentro da própria
  página (`role=application`, "Picture-in-picture"), nunca outra janela.
  - Feita: "Ligando…" → "Chamando…" → atendida (aparecem "Opções da
    ligação" e, 1 s depois, o cronômetro `0:00`) → o cliente desliga:
    "Ligação encerrada" por 3 s e o quadro some. Desligada pela máquina
    (`Desligar` no quadro): o quadro some na hora.
  - A recusa do cliente sai como "Não atendida" (3 s), igual a não atender.
  - Recebida: o quadro mostra o NOME da agenda do celular do escritório (ou o
    número, se não estiver nela), "Ligação de voz" e os botões "Ignorar",
    "Recusar" e "Aceitar". Depois de "Aceitar": cronômetro e "Desligar".
    ⚠️ "Recusar" recusa também nos celulares do escritório: a máquina nunca
    o toca.
  - Como a tela mostra o nome, o `/atender` só confere o número quando a
    tela mostra dígitos.
- ✅ **4. A rede:** a ponte ligou em ~4 s nas 5 ligações da bancada, com a
  máquina na `LigacoesNet` e o STUN público; a bancada publicada no
  `127.0.0.1` da VPS, pelo túnel SSH do Mac do operador.
- ✅ **5. A gravação** (as 4 ligações atendidas): os três arquivos chegam ao
  CRM (a bancada) e a máquina apaga a cópia dela. No estéreo, o canal
  esquerdo tem o mesmo nível do arquivo do cliente e o direito, o do
  atendente; o "esquerdo menos direito" soma as duas energias (−30 dB com
  −32,6 e −32,3 de cada lado), ou seja, um lado não vaza no outro. ~142 KB por
  minuto de estéreo e ~65 KB por minuto de cada lado. Na recebida, o ffmpeg
  avisou "Thread message queue blocking" sem perder nada medível (os três
  arquivos com a mesma duração): a fila de cada entrada subiu para 512 (ainda
  sem ligação depois disso).
- Falta: o número que conversa com a conexão mas NÃO está na agenda do
  celular (o lead de teste está na agenda), e o processador numa ligação com
  a ponte e a gravação.

**Registro das ligações pela bancada (10/11/2026, 21:09–21:16 BRT, o
operador nos dois papéis: atendente no navegador do Mac, cliente no celular):**

| | Chamou | Atendeu | Fim | Duração |
| --- | --- | --- | --- | --- |
| A, feita, o cliente desliga | 21:09:29 | +9 s | `cliente_desligou` | 24 s |
| B, feita, Desligar da bancada | 21:10:14 | +4 s | `atendente_desligou` | 10 s |
| C, feita, a aba do atendente fecha | 21:10:42 | +7 s | `ponte_caiu` (18 s depois da queda) | 27 s |
| D, recebida, Atender da bancada | — | 1 s depois da ponte | `cliente_desligou` | 14 s |
| E, feita, não atende | 21:15:22 | — | `nao_atendida` (68 s tocando) | — |

- A 1ª tentativa da E não chegou à máquina; o mais provável é ter sido
  recusada como "ocupada" (clicada nos 18 s em que a C ainda encerrava). Daí
  a API passou a anotar no log todo pedido e toda recusa. Para a 4c: o painel
  mostra "encerrando a ligação anterior…" em vez de deixar o botão mudo.
- Antes, a página da bancada ficou presa pedindo o microfone ao navegador
  sem dizer nada: ela passou a mostrar cada etapa e a desistir em 20 s. O
  painel da 4c precisa do mesmo cuidado.
- A D (e a 4ª da sessão de medição) entrou no CRM como "perdida" no fio do
  lead de teste, como previsto (conferido no banco): o `terminate` da
  Evolution chega no instante em que a máquina atende (o toque para nos
  outros aparelhos), e a decisão sai ~12 s depois. É o caso que o conserto da
  4b cobre (§8.4, passo 4).

**Revisão a frio da 4a (10/11/2026, um agente; 15 achados).** Corrigidos
depois do teste ao vivo, com teste para cada um (62 testes):

- **(alta) chamada sem dono na tela:** um "Desligar" que não pegava (o
  botão ainda não desenhado logo depois do aceite, a tela travada) deixava a
  chamada viva, muda e sem teto. Agora a chamada feita ou em curso sem
  ligação aqui é desligada de novo a cada leitura da tela; o passo que falha
  depois do clique desliga o que saiu; o `aceitar` só volta com o "Desligar"
  na tela.
- **o "Atender" relê a tela** antes do clique e só aceita o mesmo `quem`.
- **o segredo saiu do ambiente do Chrome** (`env -u` no `iniciar.sh`).
- **a linha só fica livre depois da limpeza** (gravação e ponte): antes, uma
  ligação nova podia nascer com a ponte da anterior fechando e ter a
  gravação apagada no envio.
- o quadro da chamada ancorado no "Picture-in-picture"; o cronômetro só no
  fim do texto (um "14:30" no nome não é atendimento); o número na tela
  comparado por DDI, DDD e os 8 últimos; prazo nas leituras da tela e na
  ponte (a aba que trava faz o contêiner reiniciar); um teto também desde o
  pedido; a duração até a hora em que a tela largou a chamada; erros curtos
  no log (o do Playwright pode trazer pedaços da tela); a ponte avisa pelo
  estado da conexão inteira e põe no log a falha ao tocar a voz do atendente;
  a bancada só aceita pedido pelo túnel e em JSON; versões do subprojeto
  iguais às da raiz, com pino.
- **Ficam para a 4b:** o segredo POR MÁQUINA e as rotas da máquina no CRM
  fora do domínio público (pelo Traefik toda rota do Next é pública: recusar
  o pedido que chega com `x-forwarded-for`, que só o Traefik põe); a fila de
  avisos só na memória (o CRM confere pelo `/estado`).
- **Limites aceitos:** sem tratamento de `SIGTERM` (parar o contêiner no
  meio de uma ligação a derruba sem o aviso de fim; a troca semanal da 4c só
  troca fora de ligação); o campo do discador não é ancorado no próprio
  discador (falha com segurança; a máquina nunca abre conversa).

**Codex no PR #496 (4 achados, corrigidos):** desligar no meio do
discar/aceitar soltava a linha com o Playwright ainda clicando — a ligação
seguinte mexeria na mesma tela e o desligar do passo cancelado derrubaria a
chamada dela; e o "Atender" cancelado durante a leitura da tela apagava a
ligação que nascesse nesse meio-tempo. Agora a linha fica ocupada do começo
ao fim de cada pedido (`pedidoEmCurso`). A montagem da ponte que estoura o
prazo (15 s) seguia rodando na página e podia atropelar a da ligação seguinte:
agora a falha encerra a ponte antes de soltar a linha, e a `ponte.html`
descarta a montagem vencida (um número de geração conferido a cada espera). E
a aba travada contava LEITURAS (85 × 5,7 s ≈ 8 min), não tempo (agora 60 s de
relógio, `TELA_SEM_RESPOSTA_MS`).

**Pronto quando** (com o operador e o lead de teste, ~30 min de ligações):

- [x] **Feita para o lead:**
  - chama e a fala passa nos dois sentidos;
  - termina pelo cliente e também pela bancada;
  - não atendida;
  - fechar a aba do atendente no meio desliga em ~15 s (18 s).
- [x] **Recebida do lead:** toca na bancada, atende, a fala passa e termina.
  ⚠️ Até a 4b, o CRM ainda grava essa ligação como "perdida" no fio do lead
  de teste (já aceito no Teste A).
- [ ] A gravação dos dois lados chega à bancada (✅ medido), e o operador a
      ouve.
- [x] O `/qr` mostra o QR num perfil vazio: num segundo contêiner,
      descartável, sem ler o QR (6 s; o contêiner e o perfil foram apagados
      em seguida).
- [x] Depois de recriar o contêiner (mais forte que o `docker restart`; 4
      vezes em 10/11), volta conectado e sem QR.
- [x] A imagem nova está no ar, com a caixa de areia ativa, e nada fica
      publicado além da bancada no loopback.
- [x] O contêiner de teste, a imagem dele e `/root/ligacoes-teste` são
      removidos (com o "pode" do operador, na hora), e o `INFRA-VPS.md` é
      atualizado (10/11/2026).
- [ ] As notas ficam no lugar: as regras da máquina no `ligacoes.md`; no
      `CLAUDE.md`, o subprojeto (§3) e o número de Node a mais (§5).

**Autorizado pelo operador em 10/11/2026** ("Enxuta e começa"):

1. Criar na VPS a rede, o contêiner (parado fora dos testes até a 4c) e
   `/root/ligacoes`.
2. Mover a sessão do WhatsApp do contêiner de teste para o novo.
3. A sessão de ligações de teste.

Apagar o contêiner de teste pede o "pode" na hora. O cron semanal entra na
4c.

### 8.14 Plano de implementação da 4b (10/11/2026)

**Objetivo:** o CRM passa a ser o dono da ligação: o banco guarda a ligação
feita e a recebida pelo CRM, o servidor fala com a máquina (no lugar da
bancada) e grava as gravações num bucket privado. Ainda sem tela (4c): a
prova é por chamada direta às rotas, com o lead de teste.

**Autorizado pelo operador em 10/11/2026** ("pode, tudo já autorizado"): a
migration em produção, o `docker stack deploy` do CRM com o `crm.env` (para
entrar na `LigacoesNet`) e o merge.

**A migration (`NNNN_cb_ligacoes_pelo_crm.sql`, número = maior do `main` e do
banco + 1; a 1133 é do Asaas):**

- `cb_ligacoes` (fechada ao navegador, como na 1044) ganha:
  - `direcao` (`recebida`|`feita`, padrão `recebida`) e `pelo_crm` (bool);
  - `atendente_id` (o login de quem ligou ou atendeu; autoria: `ON DELETE SET
    NULL`, 1116);
  - `atendimento_pelo_crm_desde` — a marca do "atendimento pelo CRM em curso"
    (§8.4, passo 4), gravada na reivindicação do "Atender" e apagada na falha;
  - `atendida_pelo_crm_em`, `duracao_seg`, `motivo_do_fim` (o motivo da
    máquina) e `gravacao_recebida_em`.
  - A feita usa `call_id = 'crm:<uuid>'`: a chave `(account_id, call_id)`
    continua. Conferir na 1044 o que é `NOT NULL` (a feita não tem `offer`).
- `cb_computadores_de_ligacao` (FECHADA: RLS sem policy, REVOKE de `anon` e
  `authenticated`): `channel_id` (FK para `cb_channels`, `ON DELETE CASCADE`,
  única), `account_id`, `nome` (o do contêiner), `endereco` (URL interna),
  `whatsapp`, `ultimo_sinal_em`, `ligacao_em_curso`, `chrome`. Fora de
  `cb_channels` de propósito (§8.6).
- `cb_ligacoes_ao_vivo` (LEITURA por membro na forma da 1032; escrita só pelo
  servidor; na publicação do tempo real): `id` (= `cb_ligacoes.id`),
  `account_id`, `channel_id`, `conversation_id` e `contact_id` SEM FK (a
  linha é passageira; FK para conversa ou contato cairia no default-deny da
  Lixeira e da união), `direcao`, `estado` (`tocando`, `conectando`,
  `chamando`, `em_ligacao`), `atendente_id`, `desde`, `atualizada_em`.
- Bucket PRIVADO `ligacoes`, sem policy para o navegador: só o servidor
  escreve e lê (URL assinada curta para ouvir).
- Conferências no banco vazio (seção 7 do `CLAUDE.md`): as concessões
  conferidas nas duas metades, a policy na forma da 1032 (pino), a tabela na
  publicação e o bucket privado.

**A faixa no fio (D6 e D6b: só REGISTRO):**

- A feita e a recebida atendida PELO CRM viram `messages` com `content_type
  = 'call'`, `sender_type = 'agent'`, `sender_id` NULO e `from_device` falso:
  para a 972 e para a pausa da IA (1118) só é "gente" o `agent` COM autor ou
  do celular — então não apaga o "em atraso" e não pausa a IA. Não reabre, não
  sobe a conversa, não mexe nas não lidas (o código não chama nada disso).
  Quem ligou vai em `messages.ligacao.atendente`.
- ⚠️ A retomada da IA (`cb_ia_reservar_envio`) para quando o `agent` fala
  depois da âncora ("equipe_respondeu"): a faixa a pararia. Pela D6 ("não
  pausa a IA") e pela decisão de 26/09 (a ligação não para as sequências), a
  ligação fica fora dessa conta — conferir a última definição da função antes
  de recriá-la.
- Os pinos de quem escreve mensagem (`ligacoes.chamadores.test.ts`,
  `canal-da-conversa.chamadores.test.ts`) ganham o escritor novo, com o
  motivo.

**O conserto do "atendida pelo CRM vira perdida" (§8.4, passo 4):**
`desfechoDaLigacao` não decide "perdida" enquanto `atendimento_pelo_crm_desde`
estiver de pé (teto de 60 s); a confirmação da máquina grava
`atendida_pelo_crm_em` e decide "atendida" com a faixa de registro; a falha
apaga a marca e decide pela regra de hoje. Rede de segurança: o laço lento
decide a linha parada além do teto. Testes em `desfecho.test`/`registrar.test`.

**As rotas (`src/app/api/cb/ligacoes/`):**

- Do atendente (login, `requireRole('agent')`, só nas conexões que o perfil
  vê, 400/404/409 no molde de `ai/autoreply`):
  - `POST ligar` (conversa + oferta): só de conversa existente, 1:1, com
    telefone; a conexão tem computador conectado e livre; até 20 por hora
    por número (D13). Cria a ligação (`feita`, `crm:<uuid>`) e a linha ao
    vivo, pede à máquina e devolve a resposta WebRTC.
  - `POST [id]/atender` (oferta): reivindica a linha ao vivo (`UPDATE …
    WHERE atendente_id IS NULL RETURNING`), grava a marca do atendimento e
    pede à máquina.
  - `POST [id]/desligar`.
  - `GET [id]/gravacao`: confere o acesso à conversa e redireciona para uma
    URL assinada curta.
- Da máquina (segredo no cabeçalho; chegam pela `LigacoesNet`):
  - `POST eventos`: `sinal` atualiza `cb_computadores_de_ligacao`;
    `chamando`/`atendida`/`encerrada` andam a ligação e a linha ao vivo;
    `encerrada` grava a faixa e apaga a linha ao vivo. Cada informação é
    gravada uma vez só ("só se vazia").
  - `PUT gravacao/[ligacao]/[arquivo]`: guarda no bucket privado e carimba
    `gravacao_recebida_em`.
- O número que vai à máquina é o do JID da conversa (o nono dígito do jeito
  que o WhatsApp o conhece), nunca o digitado.
- `LIGACOES_SEGREDO` no `.env.local.example`, no `environment:` da stack e no
  `crm.env` (copiado na VPS, nunca pela conversa); os pinos `env-documentado`
  e `stack-env`.

**Na VPS:** o `crm_crm` entra na `LigacoesNet` (rede externa no
`docker-stack.yml`, deploy pelas três linhas) e a máquina é recriada com a URL
interna do CRM. A migration (aditiva) entra ANTES do deploy.

**Pronto quando:** pelas rotas (sem tela), com o lead de teste: a feita liga,
fala, grava e vira faixa de registro no fio (sem mexer no "em atraso", nas não
lidas nem na IA); a recebida atendida pelo CRM sai "atendida" (não mais
"perdida"); a gravação fica no bucket privado e toca pela URL assinada; o
sinal de vida atualiza o computador; a bancada sai de cena.

**Feito (10–11/11/2026), e o que mudou em relação ao desenho acima:**

- Código: `src/lib/whatsapp/ligacoes/pelo-crm.ts` (ligar, atender, desligar,
  os avisos, a faixa, a gravação) e `computador.ts` (o segredo, o pedido à
  máquina, quem fala com o CRM); as seis rotas em `src/app/api/cb/ligacoes/`;
  a régua com a marca em `desfecho.ts` e o toque ao vivo em `registrar.ts`.
  Regras: `.claude/rules/ligacoes.md`, "O CRM, dono da ligação".
- **O segredo é POR computador** (o item da revisão a frio): HMAC-SHA256 do
  `LIGACOES_SEGREDO` do CRM com o nome do computador. Só o do CRM vai ao
  `crm.env`; `criar-maquina.sh` deriva o da máquina na VPS.
- **"Fora do domínio público" não pode ser por `x-forwarded-for`**: o Next
  16 o preenche em TODO pedido (`base-server.js`), e a recusa barraria a
  própria máquina. A rota da máquina recusa o `host` do site público.
- **A rede de segurança é o sinal, não o laço lento:** a fila de avisos da
  máquina é FIFO, então o sinal que chega depois do fim sabe o que ela ainda
  tem; a ligação do CRM que ela não tem mais (60 s depois do pedido) fecha
  como `sumiu`. O toque sem fim gravado por 3 min também sai no sinal.
- A recebida atendida pelo CRM: a ficha e a conversa por
  `resolverDestinatario` e o card por `routeContactToPipeline`, como em toda
  ligação (a D6b fala da conversa, não do funil).
- O recorte de conexões do perfil NÃO é conferido nas rotas — convenção do
  projeto (`cb/conversas/abrir`): o botão da 4c aparece só onde o perfil vê.
- Recusas que o desenho não previa: ligar com uma recebida TOCANDO no mesmo
  número (`tocando_agora`); desligar a que ainda toca (`ainda_tocando`, D12);
  chamada de vídeo não toca no CRM (a máquina só tem áudio).
- A faixa ganhou texto próprio JÁ na 4b ("Ligação feita pelo CRM · por Ana ·
  4 min 21 s"; "não atendida"): a de hoje diria "atendida no celular".
- A prova da migration num Postgres com dado: `cenarios-1134` (a reserva
  chamada, a faixa sem efeito na espera e na pausa, a trava de uma por
  número, a RLS) e um mutante sem a cerca nova, que a conferência reprova.

## 9. Fase 5: atender pelo CRM

Incorporada à Fase 4 (§8), a pedido do operador (10/11/2026).

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
- **D5 (10/11/2026):** o teste usa a conexão **Previdenciario - Comercial**
  (QR code, criada em 09/11/2026, com robô, automações e agentes
  desligados), e não um chip fora do CRM: o risco de bloqueio fica aceito
  nesse número. O destino é o lead de teste autorizado (o celular pessoal do
  operador, que não é conexão do CRM), nos dois sentidos. Conferido antes: a
  ligação RECEBIDA pela Previdenciário reabre a conversa de teste e grava a
  faixa "Ligação", mas não abre card (o lead já tem card, perdido, no
  Bancário; o roteador olha qualquer funil) e não troca o número da conversa
  (fixado). A FEITA pela máquina não aparece no CRM.
- **D8 (10/11/2026):** depois dos testes A e B, a máquina fica na VPS atual,
  sem upgrade; migrar (KVM 4 ou segunda VPS) só se der problema. Substitui o
  "validado, migrar" da D3.
- **D6, D6b, D7 e D9–D15 (10/11/2026):** as decisões da Fase 4, no §8.10
  (gravação em Opus estéreo, sem aviso; aos 180 dias saem o áudio e a
  transcrição e fica só o resumo; a ligação feita e a recebida atendida pelo
  CRM são só registro; transcrição automática com resumo, dentro do contexto
  da IA; encerrar aos 30 min; e as demais).

As decisões de produto da Fase 4 já têm linha em
`docs/DECISOES-DO-OPERADOR.md`; o detalhe vai para `.claude/rules/ligacoes.md`
quando cada entrega sair.

## 12. Fontes

- Ligação no WhatsApp Web: [Smartprix](https://www.smartprix.com/bytes/whatsapp-web-finally-gets-voice-and-video-calls-in-your-browser-no-desktop-app-needed/),
  [TechRepublic](https://www.techrepublic.com/article/news-whatsapp-web-browser-voice-video-calling/),
  [91mobiles](https://www.91mobiles.com/hub/whatsapp-web-voice-video-calling-call-transfer-support/).
- App de Windows em WebView2: [Notebookcheck](https://www.notebookcheck.net/WhatsApp-ditches-native-Windows-11-app-in-favor-of-Microsoft-WebView2.1063682.0.html);
  app de Mac em Catalyst: [WABetaInfo](https://wabetainfo.com/whatsapp-is-releasing-a-native-app-built-with-mac-catalyst/).
- Várias contas: [blog do WhatsApp](https://blog.whatsapp.com/multiple-accounts-coming-to-whatsapp)
  (sem suporte oficial no Web nem no computador até 11/2026).
- KVM 4: [vpsbenchmarks](https://www.vpsbenchmarks.com/hosters/hostinger/plans/kvm-4).
