# Plano — Anúncios da Meta dentro do CRM

> Plano vivo. Pedido do operador em 13/10/2026: além do gasto por campanha,
> o CRM mostrar conjuntos, anúncios, métricas de entrega e público, para
> analisar o que for preciso, sem cruzar informação errada quando a conta de
> anúncios muda (campanha desligada, conjunto renomeado ou alterado, anúncio
> desativado). Continua a Fase 4 (Meta Ads em Integrações) e a Fase 5a
> (anúncio de origem) de `docs/PLANO-funil-comercial.md`.

## Estado

| Fase | O quê | Estado |
|---|---|---|
| 0 | Medir a conta pela API e a mensagem de anúncio na Evolution; decisões D1, D6, D7 | ⏳ esperando o token local (`~/.config/meta-ads/token.env`) e as respostas |
| 1 | Objetos da Meta por ID, trilha de mudanças, métricas por anúncio e dia; conserto das duas armadilhas | — |
| 2 | Registro da origem do lead (fotografia na chegada), pelos três caminhos, e carga das fichas de hoje | — |
| 3 | Público: versões da segmentação por conjunto e recortes por dia | — |
| 4 | A tela (só admin): campanha → conjunto → anúncio, números da Meta e do CRM | — |

Base: PR #407 (cartão pede só o token; selo Ativa/Pausada), mesclado em
13/10/2026 (`19c8bd35`).

## Decisões do operador

Registradas em 13/10/2026:

- **D2 — Só admin** vê a tela e os números dela.
- **D3 — Lead do anúncio = card que entrou no funil no período** (a mesma
  regra do Desempenho).
- **D4 — Público e recortes entram agora** (idade, gênero, região,
  posicionamento; a segmentação de cada conjunto).
- **D5 — Resolver a origem nas conexões por QR code** (Evolution): sem isso, a
  campanha de mensagem do Trabalhista fica sem custo por lead.
- **Estrutura da conta (premissa):** uma conta de anúncios; campanhas
  separadas por área do escritório; cada campanha pode ter conjuntos
  separados. Campanhas, conjuntos e anúncios mudam com o tempo.

Pendentes:

- **D1 — Onde fica a tela:** página nova no menu, aba em Funis ou dentro do
  Desempenho. Decidir vendo um esboço.
- **D6 — Janela de atribuição:** quanto tempo antes de o card nascer a
  chegada pelo anúncio ainda conta. Recomendação: 7 dias (a janela de clique
  padrão da Meta).
- **D7 — Lead de anúncio de uma área que entra no funil de outra:** conta no
  anúncio que o gerou, marcado "em outro funil", e entra como lead do funil em
  que entrou (sem levar o gasto junto). Recomendação: assim.

## O que existe hoje (medido em 13/10/2026)

- **Conexão:** Meta Ads conectado (token de usuário de sistema, `ads_read`,
  cifrado). O CRM lê só: as contas que o token enxerga, nome e status das
  campanhas, e o gasto por dia por campanha (`cb_meta_ads_gastos`). 14
  campanhas, 4 ativas; gasto desde 16/07.
- **No Desempenho do funil:** investimento, custo por lead, CAC e custo dos
  perdidos, somando o gasto das campanhas ligadas àquele funil. A ligação
  campanha → funil vale para o histórico inteiro.
- **Origem do lead na ficha (campos de traqueamento, 949):**
  - 574 fichas com `nome_da_campanha`, `nome_do_conjunto` e `nome_do_anuncio`
    (10, 38 e 23 valores distintos), dos formulários;
  - 543 com o nome da campanha IGUAL ao de uma campanha sincronizada (as 3
    principais); 31 com campanhas antigas de blog, fora da lista;
  - 278 com `id_do_anuncio` (só números: o ID da Meta; 15 distintos); 127
    com um número no `utm_term` (15 distintos — parece o ID do conjunto,
    confirmar na Fase 0); `utm_campaign` e `utm_content` trazem NOMES;
  - `ctwa_clid` em 0 fichas: nenhum clique-para-WhatsApp chegou pelo número
    oficial.
  - ⚠️ Esses campos são da FICHA: a primeira origem e o último clique, para
    o cliente inteiro. Um cliente que volta por anúncio de outra área não
    ganha origem nova — é o cruzamento errado que o registro da Fase 2
    resolve.
- **Buraco:** a campanha de MENSAGEM do Trabalhista leva a números por QR
  code (Evolution), que não leem o anúncio de origem (Fase 5a, pendência 3).

## Como não cruzar informação quando a conta muda

A pergunta do operador (13/10): campanha desligada, anúncio desativado,
conjunto renomeado ou modificado — como guardar sem cruzar errado?

1. **O ID da Meta é a identidade; o nome é rótulo.** Toda ligação (lead →
   anúncio, anúncio → conjunto → campanha, campanha → área, número → dia) é
   pelo ID. Na Meta o ID não muda nem é reaproveitado, um anúncio não troca
   de conjunto e um conjunto não troca de campanha (mover = duplicar = ID
   novo). Renomear não mexe em nada no CRM: a tela mostra o nome atual e o
   anterior.
2. **Nada se apaga; o que muda fica com data.** Pausado, arquivado ou
   excluído continua no CRM, com o status e quando mudou. A cada
   sincronização o CRM compara o que veio com o que tinha e grava a mudança
   (nome, status, orçamento, público, criativo) numa trilha datada. O que
   SUMIU da resposta da Meta é marcado "removido em …" — nunca apagado, nunca
   deixado com o último status visto.
3. **Os números são fatos por anúncio e por dia.** Gasto, impressões,
   cliques e resultados do dia D são do anúncio X no dia D, para sempre;
   conjunto, campanha e área somam a partir do anúncio.
4. **A origem do lead é uma fotografia da chegada.** Cada chegada por anúncio
   (clique no número oficial, clique nas conexões por QR code, formulário)
   vira um registro que não muda depois: IDs de anúncio, conjunto e campanha,
   os nomes como vieram, o canal e a hora. O card leva a chegada mais recente
   do contato antes de ele nascer, dentro da janela (D6). O cliente que volta
   por outro anúncio gera outro registro, sem reescrever o anterior.
5. **A ligação campanha → área tem vigência.** Trocar a área de uma campanha
   vale "a partir de [data]"; o gasto anterior fica na área antiga. Na
   operação, o recomendado é campanha nova para área nova (ID novo); a
   vigência é a rede de proteção.
6. **Na dúvida, não chuta.** Chegada só com nomes é casada pelo nome que
   valia NAQUELE DIA (a trilha do item 2). Nome que casa com mais de um
   objeto, ou com nenhum, deixa a origem "incerta" — visível como tal e fora
   do custo por lead do anúncio, nunca no anúncio errado.
7. **Daqui para frente, os formulários mandam o ID.** Parâmetros de URL da
   Meta: `{{ad.id}}`, `{{adset.id}}`, `{{campaign.id}}`. Parte das fichas já
   chega com eles; falta padronizar em todos os formulários (iMotion,
   Typebot) — pedido operacional, não código.

| O que acontece na Meta | O que o CRM faz |
|---|---|
| Conjunto renomeado | mesmo registro (mesmo ID); nome novo na tela, com "antes: …" e a data; leads e números antigos não mudam |
| Anúncio pausado ou desativado | status muda com data; histórico e leads continuam dele |
| Campanha excluída | marcada "excluída em …"; gasto e leads ficam; sai da lista de ativas |
| Público ou orçamento do conjunto alterado | mudança gravada com data; a tela separa antes × depois |
| Anúncio duplicado para outro conjunto | é outro anúncio (ID novo), com histórico próprio |
| Campanha passa a servir outra área | área nova "a partir de" uma data; o passado fica na antiga |
| Lead chega só com nome, e o nome mudou depois | casado pelo nome que valia no dia; se ambíguo, "origem incerta" |
| Cliente antigo volta por anúncio de outra área | origem nova para o card novo; a do card antigo não muda |

### Duas armadilhas que já existem (consertar na Fase 1)

- **Campanha excluída fica "Ativa" no CRM.** A sincronização relê a lista de
  campanhas e atualiza o que vem; se a Meta deixar de listar a excluída
  (medir na Fase 0), a linha fica com o último status visto para sempre.
  Conserto: pedir também as excluídas e arquivadas, e marcar "removida" o
  que não vier.
- **A limpeza da janela de 3 dias pode apagar gasto real.** Ela apaga o que
  não voltou na resposta (é o que conserta o dia reprocessado para zero).
  Se a resposta de gasto deixar de trazer campanha excluída (medir), o
  gasto dos últimos dias dela some, e custo por lead e CAC caem. Conserto:
  pedir o gasto incluindo excluídas e arquivadas.

## Desenho por fase

**Fase 0 — medir.** Com o token local: (a) se a lista e o gasto trazem
excluídas/arquivadas por padrão; (b) quantos conjuntos e anúncios, objetivos
e tipos de resultado (lead de formulário, conversa iniciada); (c) o volume dos
recortes por dia (decide se o recorte é por conjunto ou por anúncio); (d)
casar os nomes das fichas sem ID com os objetos de hoje e confirmar o que o
`utm_term` guarda. Na VPS (`docs/INFRA-VPS.md` antes): uma mensagem real de
anúncio no banco da Evolution (`contextInfo.externalAdReply`, `ctwaClid`,
`conversionSource`), seguindo o critério da Fase 5a — nunca a simples
presença de `externalAdReply`.

**Fase 1 — os objetos e os números.** Tabelas `cb_meta_ads_conjuntos` e
`cb_meta_ads_anuncios` (chave = ID da Meta, pai fixo, nome e status atuais,
`criado_na_meta`, `visto_em`, `removido_em`), `cb_meta_ads_mudancas` (objeto,
ID, campo, antes, depois, quando) e `cb_meta_ads_metricas` (anúncio × dia:
gasto, impressões, alcance, cliques, cliques no link, resultados por tipo).
A ligação campanha → área ganha vigência. Mesmo cron e mesma janela
reconciliada, com as duas armadilhas consertadas. `cb_meta_ads_gastos` fica
(o Desempenho lê dela) até a Fase 4 decidir.

**Fase 2 — a origem do lead.** Tabela de chegadas, só de inserção (contato,
conversa, IDs de anúncio/conjunto/campanha, nomes recebidos, canal, como foi
resolvida — por ID, por nome, incerta —, quando). Alimentada pelo webhook da
Meta (já lê o `referral`), pela Evolution (D5, depois da medição) e pelos
formulários (webhooks de entrada e API v1). Carga das 574 fichas de hoje, com
a hora do valor gravado. Os campos da ficha continuam (são contrato com
n8n/API); a tela lê as chegadas. Ler `.claude/rules/ingestao.md` e
`.claude/rules/whatsapp-evolution.md` antes.

**Fase 3 — público.** Versões da segmentação de cada conjunto (cada mudança
abre uma versão com data) e recortes por dia (idade e gênero, região,
posicionamento), no nível que a Fase 0 indicar.

**Fase 4 — a tela.** Onde a D1 decidir, só admin (D2): campanha → conjunto →
anúncio, com período e área; colunas da Meta (gasto, impressões, cliques, CTR,
CPC, resultados, custo por resultado) e do CRM (leads pela D3, reuniões,
contratos, custo por lead, CAC); trilha de mudanças e público de cada
conjunto. Tela nova segue `.claude/rules/perfis.md` e `.claude/rules/auth.md`.

## Limites conhecidos

- O CRM lê UMA conta de anúncios; campanha de outra conta não aparece (as 31
  fichas das campanhas antigas de blog).
- Lead antigo que chegou só com nome, de antes da trilha de mudanças existir,
  é casado pelos nomes de hoje; o que não casar fica "incerto".
- A Meta reprocessa métricas por até 48 h; a janela de 3 dias cobre.
