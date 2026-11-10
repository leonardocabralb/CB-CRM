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
| 4    | Ligar e atender pelo CRM: botão, toque, gravação, transcrição | desenho pronto (§8); espera D6, D7, D9–D15 |
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
Fase 5 (atender) entrou aqui. Nada disto está construído; as decisões D6, D7
e D9–D13 (§8.10) são do operador.

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
- Quem vê o toque: D9 (recomendado: quem tem o poder e cujo perfil vê a
  conexão, com o CRM aberto). Com a aba em segundo plano, sai também a
  notificação do navegador que o CRM já usa.
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
parear.

**Quem pode:** neste CRM o "poder" sai do PAPEL (`roles.ts`, `useCan`,
`requireRole`) e o perfil recorta as telas e as CONEXÕES que a pessoa vê.
Então: ligar e atender a partir do papel de atendente (como enviar
mensagem), e só nas conexões que o perfil da pessoa vê (`canalNoEscopo`). Se
o operador quiser ligar/desligar por pessoa, isso vira uma seção no catálogo
de perfis (`catalogo.ts`), decisão à parte.

### 8.2 As peças

```
 navegador do atendente ──(rotas do CRM, com login)──► CRM ──(rede interna do Swarm, segredo)──► computador de ligações
        ▲  │ áudio WebRTC (direto, STUN)                ▲                                         (1 por número)
        │  └──────────────────────────────────────────────────────────────────────────────────► Chrome + WhatsApp Web
        └── tempo real (Supabase) ◄── eventos ◄─────────┴──────────────── eventos (chamando, atendida, encerrada…)
```

- **Computador de ligações** (serviço novo, um por número; começa só na
  Previdenciario - Comercial, D10). Subprojeto `maquina-de-ligacoes/` no
  repositório, com `package.json` próprio (como o `mcp-server/`), imagem
  montada por workflow e publicada no GHCR (como a da Evolution), e stack
  versionada em `ops/vps/`. Dentro: Xvfb, PulseAudio, Chrome e um
  **orquestrador em Node** que:
  - comanda o Chrome pelo protocolo de depuração (`playwright-core`,
    `connectOverCDP`): ligar para um número, atender, desligar, ler o estado
    da chamada na tela, capturar o QR;
  - mantém a **ponte** (a página-ponte do Teste B, agora comandada por ele,
    sem o `sinal.py`): recebe a oferta WebRTC do CRM e devolve a resposta;
  - **grava** os dois lados (o monitor do alto-falante = cliente; o da
    entrada = atendente) do "atendeu" ao "desligou";
  - manda **eventos** ao CRM e responde à **API interna** (`/ligar`,
    `/atender`, `/desligar`, `/audio`, `/estado`, `/qr`), só numa rede
    overlay PRÓPRIA entre o CRM e ele (nunca a `CBAdvNet`, §8.7), com segredo
    no cabeçalho;
  - manda um **sinal de vida** por minuto (WhatsApp conectado? botões
    esperados na tela?). Sinal parado = "fora do ar" na tela e aviso.
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
   ao vivo, e pede à máquina a ponte (`/audio`) e a discagem (`/ligar`).
   Devolve a resposta WebRTC: o atendente passa a ouvir o "chamando".
3. A máquina disca pela aba **Ligações → Nova ligação → número**, SEM abrir a
   conversa (abrir marca as mensagens do cliente como lidas — achado do
   Teste A). Se essa via não existir, abre a conversa pelo número (a medir na
   4a).
4. Eventos: chamando → atendida (o cliente atendeu: começa o cronômetro e a
   gravação) → encerrada (quem desligou, duração). Também: não atendida,
   ocupado, número sem WhatsApp, falhou.
5. Ao encerrar: a faixa "feita" entra no fio (o WhatsApp não avisa a Evolution
   das ligações feitas: quem registra é o CRM), a linha ao vivo sai, a máquina
   envia a gravação e o CRM põe a transcrição na fila.
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
   gravação enviada, transcrição na fila.

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
- Envio direto ao Storage por **URL de envio assinada** que o CRM gera para
  aquela ligação (a máquina nunca guarda a chave de serviço do Supabase).
  **Bucket PRIVADO** novo (`ligacoes`): o `chat-media` é público e uma
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
- **Prazo e exclusão** (D7): a gravação e a transcrição saem quando a ficha
  for excluída de vez (Lixeira, "Excluir agora") — a fila de arquivos de
  hoje só conhece o `chat-media`, e o bucket novo entra nela.

### 8.6 Dados (migration a partir da 1133)

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
  - **Chrome COM a caixa de areia** (sem `--no-sandbox`): um perfil seccomp
    que libere o que ela precisa; medir se o serviço do Swarm aceita (§8.12).
  - **Imagem remontada toda semana** (workflow agendado) com o Chrome do
    dia, a versão registrada; nada de imagem velha no ar.
  - **Contêiner sem privilégios:** `cap_drop: ALL`, `no-new-privileges`,
    usuário comum, o mínimo de escrita fora do perfil.
  - **Rede própria:** uma rede overlay SÓ entre o CRM e o computador de
    ligações — nunca a `CBAdvNet`, onde ficam o Postgres e o Redis com as
    chaves das conexões da Evolution.
  - **Sem tela remota em produção** (o QR vem pelo CRM) e sem porta
    publicada.
  - Mesmo assim o risco não é zero: decisão do operador (D15).
- A sinalização passa pelo CRM, com login e o recorte do perfil; a máquina só
  aceita o CRM (segredo no cabeçalho). O áudio vai direto entre o navegador e
  a máquina, cifrado (WebRTC).
- Gravação e transcrição são dado sensível: bucket privado, URL assinada
  curta, leitura só por rota com o recorte do perfil, saída junto com a
  ficha (§8.5), aviso de gravação (D7).

### 8.8 Regras de uso

- **Uma ligação por vez por número** (um Chrome por número, e a KVM 2 dá
  conta de uma por vez, D8). A segunda tentativa vê "linha ocupada".
- **Anti-bloqueio** (D13): ligar só de conversa existente e com teto por
  número por hora; nunca discagem automática (só clique de gente).
- **O que NÃO roda** continua valendo (`.claude/rules/ligacoes.md`): robô,
  automações e IA não reagem a ligação, e a ligação não para as sequências
  "parar se o cliente responder".
- **O celular do escritório continua tocando** e pode atender: o CRM é mais
  um aparelho.

### 8.9 Entregas, nesta ordem (cada uma com teste e conferência no preview
antes do merge; merge = deploy, com o operador ciente)

- **4a — Computador de ligações** (serviço): orquestrador, imagem, stack,
  API interna, eventos, gravação, QR, sinal de vida. Pronto quando: por
  comando, ele liga e atende com a ponte, grava os dois lados e mostra o QR;
  e o contêiner do teste é desligado.
- **4b — Banco e servidor:** migration, rotas, eventos, linha ao vivo,
  bucket privado, o conserto do "perdida".
- **4c — Tela:** botão, painel, cartão com toque, faixa estendida com ▶,
  poder no perfil, textos nos dois dicionários. Pronto quando: ligar e
  atender de ponta a ponta pelo CRM, com o lead de teste.
- **4d — Transcrição e resumo:** a fila, o diálogo na faixa.
- **4e — Conexões e operação:** estado e QR do computador na tela Conexões;
  a sentinela vigia o sinal de vida; doc e ajuda na tela.

### 8.10 Decisões do operador pendentes (com a recomendação)

- **D6 — a ligação FEITA pelo CRM no fio.** Recomendado: conta como resposta
  de gente (apaga o "em atraso" e pausa o agente de IA da conversa), reabre a
  conversa encerrada com quem ligou como responsável, e NÃO para as
  sequências; a não atendida entra no fio como tentativa, sem esses efeitos.
- **D7 — gravação.** Recomendado: gravar toda ligação feita ou atendida pelo
  CRM, com um aviso falado no começo ("esta ligação pode ser gravada"),
  tocado pela máquina; guardar enquanto a ficha existir; ouve quem vê a
  conversa.
- **D9 — quem vê o toque.** Recomendado: quem tem o poder "Ligações pelo CRM"
  e cujo perfil vê a conexão, com o CRM aberto.
- **D10 — quais números.** Recomendado: só a Previdenciario - Comercial
  agora; cada número a mais custa ~0,6–1 GB de memória parado e uma vaga de
  aparelho.
- **D11 — transcrição.** Recomendado: automática em toda ligação gravada, com
  resumo curto; fora do contexto do agente de IA por enquanto.
- **D12 — recusar.** Recomendado: sem "Recusar", só "Silenciar".
- **D13 — anti-bloqueio.** Recomendado: só de conversa existente, até 20
  ligações por hora por número.
- **D14 — quem transcreve.** Recomendado: o provedor de IA da conta (Gemini,
  senão OpenAI), como as notas de voz; transcrição local na VPS só com
  máquina maior.
- **D15 — o computador de ligações na VPS de produção.** A D8 pesou
  processador e memória; a revisão a frio mostrou o risco de segurança
  (§8.7): um Chrome que abre conteúdo de qualquer pessoa, rodando ao lado do
  CRM e da Evolution. Com as defesas do §8.7 o risco fica baixo, não zero.
  Recomendado: seguir na VPS atual COM as defesas, e levar o computador para
  uma VPS só dele se a caixa de areia não funcionar dentro do Swarm (§8.12)
  ou se o número de computadores crescer.

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
- **Serviço:** stack própria em `ops/vps/` (como a da Evolution), numa rede
  overlay PRÓPRIA que só o CRM e o computador de ligações compartilham — não
  a `CBAdvNet` (§8.7); o CRM o chama pelo nome do serviço nessa rede. A rede
  nova no serviço do CRM e a variável nova exigem `docker stack deploy` do
  CRM com as três linhas (`CLAUDE.md`, seção 10), com o operador ciente.

### 8.12 A medir no começo da 4a (riscos)

- O Chrome com a **caixa de areia** dentro do serviço do Swarm (perfil
  seccomp; o Swarm não aceita todas as opções de segurança do `docker run`).
  Se não der, vale a D15.

- A via **"Nova ligação"** do WhatsApp Web (sem abrir a conversa) existe e é
  comandável; senão, como abrir a conversa sem marcar como lida.
- O WebRTC sai de um **serviço do Swarm** (NAT pela `docker_gwbridge`) como
  saiu do contêiner avulso; e o Swarm não tem o peso de processador
  (`--cpu-shares`) do teste — o teto fica só em `limits.cpus`.
- Ler o estado da chamada na tela (chamando, atendida, encerrada, quem
  desligou) com seletores estáveis, e testá-los contra telas salvas.
- P8 (a rede do escritório) — se barrar, o TURN entra antes da 4c.

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
