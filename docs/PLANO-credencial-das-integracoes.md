# Plano — a chave de cada integração na tela (vivo e checável)

> **O que é este arquivo.** Guia retomável do bloco "Chave guardada" dos
> cartões de Configurações → Integrações, pedido pelo operador em
> 06/11/2026. ⚠️ Envelhece: confirme contra o código antes de decidir.

## Por que

A conta do tl;dv do escritório foi trocada e a integração parou em
04/11/2026 (o tl;dv passou a recusar a chave antiga). O operador não achou
onde colar a chave nova: em TODOS os cartões o campo só aparecia com a
integração desconectada, e conectada não havia como saber QUAL chave estava
guardada, desde quando, nem testá-la. Trocar exigia "Desconectar", que em
algumas integrações refaz o webhook.

## O que foi feito (branch `fix/tldv-trocar-chave`)

| Peça | Onde |
| --- | --- |
| Migration ADITIVA: `conectado_em` e `conferido_em` em tl;dv, Calendly, Meta Ads e Asaas (Atlas e ZapSign já tinham) | `supabase/migrations/1127_cb_credencial_das_integracoes.sql` + pino |
| Os 4 últimos caracteres, quem gravou, a régua do teste | `src/lib/integracoes/credencial.ts` (+ teste) |
| "Testar agora" com a chave guardada, por integração | `conferirTldv`, `conferirToken` (Calendly e ZapSign), `conferirChave` (Asaas), `conferirMetaAds` (`src/lib/meta-ads/conexao.ts`, novo), `conferirConexao` (Atlas, já existia) |
| Rota única: GET (a credencial) e POST (o teste) | `src/app/api/cb/integracoes/credencial/route.ts` |
| Chaves de IA: os 4 finais, quando e por quem | `credencialDoProvedor` em `src/lib/ia-chaves/repo.ts` |
| O bloco na tela | `src/components/settings/credencial-da-integracao.tsx`, nos seis cartões e no formulário das chaves de IA |
| "Trocar chave" sem desconectar | o formulário de conectar de cada cartão, aberto por "Trocar chave" ou sozinho com o erro DA CHAVE |
| O PATCH "Conferir de novo" do Atlas saiu | virou o "Testar agora" do bloco |
| Regras | `.claude/rules/credencial-das-integracoes.md`; linhas atualizadas em `ia.md`, `funil-metricas.md`, `integracoes-atlas.md`; decisão em `docs/DECISOES-DO-OPERADOR.md` |

## Decisões (06/11/2026)

- **D1 — mostrar os 4 últimos caracteres** (decisão do operador). Calculados
  no servidor; chave com menos de 16 caracteres não mostra nada. Antes, o
  código seguia "nenhuma rota devolve a chave, nem mascarada".
- **D2 — Meta Ads e chaves de IA entram junto** (decisão do operador).
- **D3 — data de quem já está conectado**: `NULL`, "data não registrada". A
  data da chave atual não existe em lugar nenhum (`created_at` é a da
  primeira conexão).
- **D4 — o teste só limpa o erro que prova resolvido** (ver a regra).

## Falta

- [ ] Replay verde do CI no commit exato, depois APLICAR a 1127 na produção
  (com o "pode gravar" do operador) ANTES do merge — é aditiva.
- [ ] Conferir o bloco na tela de produção depois do deploy (as seis
  integrações + IA) e colar a chave nova do tl;dv pelo "Trocar chave".
- [ ] Levar para o Atlas CRM (dev e distribuição) e para a instalação do
  Daniel, junto com a marcação de ICP e o cliente ideal por funil (pedido do
  operador, 06/11/2026).
