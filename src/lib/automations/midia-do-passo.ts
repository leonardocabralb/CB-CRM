// ============================================================
// Passo "Enviar arquivo" (`send_media`) das automações — QUAL arquivo sai
// (CB, 09/11/2026).
//
// Pedido do operador: a automação que o agente de IA executa depois de mandar
// o link do ZapSign manda às gestantes o vídeo que já está no ACERVO de
// mídias. O construtor só subia arquivo; agora escolhe também um item do
// acervo (`acervo_id`), como o nó "Enviar mídia" do robô
// (`src/lib/flows/midia-do-no.ts`, o mesmo nome de campo).
//
// Duas origens, e o passo antigo continua valendo sem mudança nenhuma:
//   · `acervo_id` — o item do acervo, COPIADO a cada envio;
//   · `url` — o arquivo subido no próprio passo, mandado como está.
//
// ⚠️⚠️ POR QUE COPIAR (a regra do acervo, `.claude/rules/midia.md`): o que foi
// enviado não pode mudar nem sumir com o item. A mensagem gravada no fio
// aponta para a URL que saiu; referenciando o original, apagar o item do
// acervo (a rota remove o objeto do bucket) deixaria "indisponível" toda
// conversa que a automação atendeu. Com a cópia, o histórico fica de pé, e o
// passo falha VISÍVEL quando o item foi apagado — nunca um link morto ao
// WhatsApp.
//
// ⚠️ A cópia NÃO é apagada quando o envio falha, como no robô: a Meta baixa a
// mídia DEPOIS de aceitar o pedido, e um erro tardio com a cópia apagada
// quebraria a mídia no celular do cliente. O preço é um objeto órfão no
// bucket — um por tentativa, porque a retentativa (recusa 4xx da Evolution)
// roda o passo de novo e copia de novo.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { copiarDoAcervo } from '@/lib/acervo/copiar';
import type { SendMediaStepConfig } from '@/types';
import type { PassoComRamos } from './condicao-por-campo';

/**
 * O motivo gravado quando o item do acervo foi apagado — o "Já rodou" e a
 * tela de registros o mostram como está, ao lado do nome do passo (em
 * português, como os outros motivos deste passo).
 */
export const MOTIVO_ITEM_DO_ACERVO_APAGADO =
  'o arquivo do acervo escolhido neste passo foi apagado — escolha outro arquivo no passo';

/**
 * Puro: de onde vem o arquivo do passo. `acervo_id` VENCE `url`: com o item
 * escolhido, a URL guardada é só a da tela. `null` = o passo não tem arquivo
 * — a validação já barra isso na ativação; o motor falha visível se chegar.
 */
export function origemDaMidiaDoPasso(
  cfg: Partial<SendMediaStepConfig> | null | undefined,
): { origem: 'acervo'; acervoId: string } | { origem: 'url'; link: string } | null {
  if (!cfg) return null;
  const acervoId = typeof cfg.acervo_id === 'string' ? cfg.acervo_id.trim() : '';
  if (acervoId) return { origem: 'acervo', acervoId };
  const link = typeof cfg.url === 'string' ? cfg.url.trim() : '';
  return link ? { origem: 'url', link } : null;
}

export interface MidiaDoPasso {
  /** Com o acervo, o tipo do ITEM (o `kind` do passo é só a foto da escolha). */
  kind: SendMediaStepConfig['kind'];
  /** A URL que vai ao WhatsApp e ao fio — a da CÓPIA, quando vem do acervo. */
  link: string;
  /** Só documento leva nome; o WhatsApp ignora nos outros tipos. */
  filename?: string;
}

/**
 * I/O: o arquivo que vai sair. Com `acervo_id`, copia o item AGORA, pela
 * conta da automação (`copiarDoAcervo` cerca por `account_id`: o id de um item
 * de outra conta não é copiado daqui).
 *
 * Lança com motivo legível — o motor grava no registro e encerra a execução,
 * como todo passo que falha. ⚠️ Erro de banco é `leitura`, nunca "apagado":
 * dizer "apagado" sobre o item que só não foi lido mandaria alguém cadastrar
 * o arquivo de novo.
 */
export async function prepararMidiaDoPasso(
  db: SupabaseClient,
  accountId: string,
  cfg: Partial<SendMediaStepConfig>,
): Promise<MidiaDoPasso> {
  const origem = origemDaMidiaDoPasso(cfg);
  if (!origem) throw new Error('send_media precisa de um arquivo');

  if (origem.origem === 'url') {
    const kind = cfg.kind as SendMediaStepConfig['kind'];
    return {
      kind,
      link: origem.link,
      filename: kind === 'document' ? cfg.filename : undefined,
    };
  }

  const copia = await copiarDoAcervo(db, accountId, origem.acervoId);
  if (!copia.ok) {
    if (copia.erro === 'nao_encontrado') throw new Error(MOTIVO_ITEM_DO_ACERVO_APAGADO);
    if (copia.erro === 'leitura') {
      throw new Error(`a leitura do acervo falhou (${copia.detalhe}); nada foi enviado`);
    }
    throw new Error(`a cópia do arquivo do acervo falhou (${copia.detalhe}); nada foi enviado`);
  }
  return {
    // O TIPO vem do item: ele não troca de arquivo (trocar é apagar e
    // cadastrar de novo), e o `kind` gravado no passo é só a foto da escolha.
    kind: copia.tipo,
    link: copia.mediaUrl,
    // O nome editado no passo (documento) vence; senão o do item.
    filename: copia.tipo === 'document' ? cfg.filename?.trim() || copia.filename : undefined,
  };
}

const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Puro: os itens do acervo que os passos "Enviar arquivo" apontam, ramos
 * inclusive. Id sem forma de UUID fica de fora da CONSULTA (ele não existe
 * em tabela nenhuma, e derrubaria a consulta inteira com 22P02, escondendo os
 * outros) — e por isso nunca está entre os existentes: a ativação o acusa
 * como apagado.
 */
export function acervoDosPassos(steps: ReadonlyArray<PassoComRamos>): string[] {
  const ids = new Set<string>();
  const andar = (lista: ReadonlyArray<PassoComRamos> | undefined) => {
    for (const s of lista ?? []) {
      const id =
        s.step_type === 'send_media' && typeof s.step_config?.acervo_id === 'string'
          ? s.step_config.acervo_id.trim()
          : '';
      if (FORMA_DE_UUID.test(id)) ids.add(id);
      andar(s.branches?.yes);
      andar(s.branches?.no);
    }
  };
  andar(steps);
  return [...ids];
}

/**
 * I/O: os itens DESTA conta entre os que os passos apontam (service role na
 * rota — o `.eq('account_id')` é a cerca). Alimenta
 * `validateAcervoForActivation` (`validate.ts`), a conferência que o robô faz
 * na ativação (`referencias-do-robo.ts`). `null` = a leitura falhou: quem
 * chama pula a conferência, e o motor continua sendo a guarda (item apagado =
 * o passo falha com o motivo).
 */
export async function carregarAcervoDosPassos(
  db: SupabaseClient,
  accountId: string,
  steps: ReadonlyArray<PassoComRamos>,
): Promise<Set<string> | null> {
  const ids = acervoDosPassos(steps);
  if (ids.length === 0) return new Set();
  const { data, error } = await db
    .from('cb_media_library')
    .select('id')
    .eq('account_id', accountId)
    .in('id', ids);
  if (error) return null;
  return new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
}
