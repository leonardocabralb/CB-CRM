# Plano — Anúncios da Meta × CRM: estrutura para análise sob demanda

> Plano vivo. Pedido do operador (13/10/2026): poder comparar, quando
> quiser, os dados da Meta com os do CRM — CAC sobre o valor investido,
> custo por reunião, por qualificado, por desqualificado, e qual campanha ou
> conjunto traz mais desqualificados e precisa de ajuste. O detalhe é
> **análise sob demanda** (pedida a quem tem acesso à API e ao banco); a
> **tela fica simples**, nos moldes do Desempenho e da Saúde. A prioridade é
> deixar o ACESSO aos dados pré-configurado, sem cruzar informação quando a
> conta de anúncios muda. Continua a Fase 4 (Meta Ads em Integrações) e a 5a
> (anúncio de origem) de `docs/PLANO-funil-comercial.md`.

## Estado

| Fase | O quê | Estado |
|---|---|---|
| 0 | Medir a conta pela API (token local) e uma mensagem de anúncio na Evolution | ⏳ esperando o token local (`~/.config/meta-ads/token.env`) |
| 1 | Catálogo dos anúncios por ID (anúncio → conjunto → campanha) e conserto das duas armadilhas da sincronização | — |
| 2 | Origem do lead por card: registro da chegada, pelos caminhos de hoje, e carga das fichas | — |
| 3 | Origem nas conexões por QR code (Evolution) | depois da medição |
| 4 | Custo por desqualificado no Desempenho e na Saúde | — |

Base: PR #407 (cartão pede só o token; selo Ativa/Pausada), mesclado em
13/10/2026 (`19c8bd35`).

## Decisões do operador (13/10/2026)

- **D1 — Sem tela nova.** O que aparece em tela fica no Desempenho e na
  Saúde dos funis; o resto é análise sob demanda.
- **D2 — Só admin** (o Desempenho e a Saúde já são de admin).
- **D3 — Lead do anúncio = card que entrou no funil no período** (a regra do
  Desempenho).
- **D4 — Público e recortes: sob demanda, pela API.** Nada disso é guardado
  no CRM (revista no mesmo dia: a primeira resposta era "entram agora").
- **D5 — Resolver a origem nas conexões por QR code** (Evolution).
- **D6 — Janela de atribuição: 7 dias.** O card leva a chegada por anúncio
  mais recente do contato nos 7 dias antes de ele nascer.
- **D7 — Lead de anúncio de uma área que entra no funil de outra:** conta no
  anúncio que o gerou, marcado "em outro funil"; entra como lead do funil em
  que entrou, sem levar o gasto junto.
- **Estrutura da conta (premissa):** UMA conta de anúncios; campanhas por
  área do escritório; conjuntos separados dentro delas. Campanhas, conjuntos
  e anúncios mudam com o tempo.

## Quem responde o quê

| Pergunta | Onde |
|---|---|
| CAC, custo por lead, por qualificado (MQL), por reunião, por no-show, por contrato assinado, dos perdidos — por funil e período | **Tela**, já existe (cartões de custo do Desempenho e da Saúde; cada funil escolhe os seus) |
| Custo por desqualificado | **Tela**, Fase 4 |
| Qual campanha / conjunto / anúncio traz mais desqualificados, custo por etapa por campanha ou conjunto, público, recortes, o que mudou na conta | **Sob demanda**: API da Meta (gasto, entrega, público, recortes, registro de atividades da conta) + banco do CRM (cards, etapas, origem por card) |

O que o CRM PRECISA guardar é só o que a Meta não sabe: **de qual anúncio
veio cada card**, pelo ID. Gasto e entrega por conjunto ou anúncio, público e
recortes a Meta guarda e devolve pela API quando a análise pedir.

⚠️ **Antes de tudo (operador):** as 14 campanhas estão "sem funil" no cartão
do Meta Ads. Enquanto não forem ligadas, nenhum custo aparece no Desempenho
nem na Saúde.

## O que existe hoje (medido em 13/10/2026)

- **Conexão:** Meta Ads conectado (token de usuário de sistema, `ads_read`,
  cifrado); o CRM lê as campanhas (nome, status) e o gasto por dia por
  campanha. 14 campanhas, 4 ativas; gasto desde 16/07.
- **Degraus:** Bancário, Previdenciário e Trabalhista - Comercial mapeados.
  As etapas "Desqualificado" estão no degrau `perda`, junto com "Perdido",
  "Não Respondeu" e "Contrato sem pasta" — por isso o "custo dos perdidos"
  não é o custo por desqualificado.
- **Origem na ficha (campos de traqueamento, 949):** 574 fichas com nome da
  campanha, do conjunto e do anúncio (dos formulários); 543 com o nome da
  campanha igual ao de uma campanha sincronizada; 278 com `id_do_anuncio`
  (o ID da Meta); 127 com um número no `utm_term` (provável ID do conjunto —
  confirmar na Fase 0); `ctwa_clid` em 0. São campos da FICHA (primeira
  origem e último clique, para o cliente inteiro): um cliente que volta por
  anúncio de outra área não ganha origem nova.
- **Buraco:** a campanha de mensagem do Trabalhista leva a números por QR
  code, que não leem o anúncio de origem.

## Como não cruzar informação quando a conta muda

1. **O ID da Meta é a identidade; o nome é rótulo.** Na Meta o ID não muda nem
   é reaproveitado, um anúncio não troca de conjunto e um conjunto não troca
   de campanha (mover = duplicar = ID novo). Toda ligação é pelo ID.
2. **A origem é resolvida para ID NA HORA da chegada.** Chegou com o ID do
   anúncio: conjunto e campanha saem do catálogo. Chegou só com nomes: casa
   com o catálogo daquele momento (sincronizado a cada ~15 min), quando o
   nome ainda é o de então. Renomear depois não mexe em nada — por isso não
   é preciso guardar o histórico de nomes.
3. **A chegada é uma fotografia que não muda.** Cada chegada por anúncio vira
   um registro só de inserção (IDs, os nomes como vieram, canal, hora). O
   cliente que volta por outro anúncio gera outro registro, para o card novo.
4. **Nada se apaga.** Anúncio, conjunto ou campanha pausado, arquivado ou
   excluído continua no catálogo, com o status e "removido em …" quando
   some da Meta.
5. **Na dúvida, não chuta.** Nome que casa com mais de um anúncio, ou com
   nenhum, deixa a origem "incerta" — fora da conta daquele anúncio, nunca
   no errado.
6. **Daqui para frente, os formulários mandam o ID** (pedido operacional à
   iMotion e ao Typebot): parâmetros de URL da Meta `{{ad.id}}`,
   `{{adset.id}}`, `{{campaign.id}}`.
7. **Campanha nova para área nova.** A ligação campanha → funil vale para o
   histórico da campanha; se uma campanha mudar de área, o passado iria
   junto. Em vez de construir vigência, a regra é operacional; o caso
   isolado se trata na análise sob demanda.

### Duas armadilhas da sincronização de hoje (Fase 1)

- **Campanha excluída fica "Ativa" no CRM.** Se a Meta deixa de listá-la
  (medir), a linha fica com o último status visto. Conserto: pedir também
  as excluídas e arquivadas, e marcar "removida" o que não vier.
- **A limpeza da janela de 3 dias pode apagar gasto real.** Ela apaga o que
  não voltou na resposta; se o gasto de campanha excluída deixar de vir
  (medir), o gasto dos últimos dias dela some e os custos caem. Conserto:
  pedir o gasto incluindo excluídas e arquivadas.

## Desenho por fase

**Fase 0 — medir.** Com o token local: (a) se a lista de campanhas e o gasto
trazem excluídas/arquivadas por padrão; (b) a forma de `/act_…/ads` com
conjunto e campanha; (c) o que o `utm_term` das fichas guarda; (d) quantas
das 574 fichas casam por ID e por nome. Na VPS (`docs/INFRA-VPS.md` antes):
uma mensagem real de anúncio no banco da Evolution (`ctwaClid`,
`conversionSource`, `externalAdReply`), pelo critério da Fase 5a — nunca a
simples presença de `externalAdReply`.

**Fase 1 — catálogo.** Uma tabela, `cb_meta_ads_anuncios`: um registro por
anúncio (ID), com conjunto e campanha (IDs e nomes atuais), status, visto em
e removido em. Sincronizada pelo cron de hoje, incluindo excluídos e
arquivados; as duas armadilhas consertadas no mesmo passo.

**Fase 2 — origem por card.** Tabela `cb_lead_origens`, só de inserção
(contato, conversa, canal, IDs de anúncio/conjunto/campanha, nomes recebidos,
como foi resolvida — por ID, por nome, incerta —, hora). Alimentada pelo
webhook da Meta (já lê o anúncio do clique), pelos webhooks de entrada
(formulários) e pela API v1 (quem grava traqueamento por ela). Carga das 574
fichas de hoje, com a hora do valor gravado. O card leva a chegada mais
recente do contato nos 7 dias antes de nascer (D6), numa consulta pronta
para a análise. Os campos da ficha continuam (são contrato com n8n e API).
Ler `.claude/rules/ingestao.md`, `.claude/rules/webhooks.md` e
`.claude/rules/api-v1.md` antes.

**Fase 3 — Evolution.** Ler o anúncio de origem na mensagem que chega pelas
conexões por QR code, pelo critério medido na Fase 0, e registrar a chegada.
Ler `.claude/rules/whatsapp-evolution.md` antes.

**Fase 4 — custo por desqualificado.** As etapas de desqualificação passam a
ser MARCADAS em Gerenciar funil, como as etapas "Faltou" do no-show; o
cartão "Custo por desqualificado" (investimento ÷ entradas nessas etapas no
período) entra na lista de cartões de cada funil, no Desempenho e na Saúde.

## Limites conhecidos

- O CRM lê UMA conta de anúncios; campanha de outra conta não aparece (as 31
  fichas das campanhas antigas de blog).
- Ficha antiga que chegou só com nome é casada pelos nomes de HOJE (a carga
  da Fase 2); o que não casar fica "incerta".
- Campanha que mudar de área leva o passado junto (item 7).
- A Meta reprocessa métricas por até 48 h; a janela de 3 dias cobre.
