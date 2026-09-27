// ============================================================
// Ativar o robô confere se o que ele APONTA ainda existe (CB, 26/09/2026).
//
// O validador (`validate.ts`) é estrutural: roda no navegador, sem banco, e
// não sabe se o arquivo do ACERVO de um "Enviar mídia" (`acervo_id`) ou o
// campo da ficha de um "Salvar a resposta" (`salvar_em`) ainda existem. A
// tela avisa quando alguém ABRE o nó; um robô ativado sem ninguém abrir o nó
// falharia em TODA execução (item apagado) ou deixaria de gravar calado (campo
// apagado). Esta conferência roda na ROTA de ativação, com o banco.
//
// Desde a 1053, também o "Mover card" (`move_deal_stage`): o funil e a etapa
// de destino existem NESTA conta, a etapa é DAQUELE funil, e as etapas de
// origem marcadas ainda existem. Sem isto, a etapa apagada viraria "etapa nao
// existe" da RPC em toda execução, e a origem apagada nunca casaria calada.
//
// E o "Atribuir a" do "Transferir para atendente" (2.7): o membro escolhido
// é desta conta. `conversations.assigned_agent_id` não tem chave estrangeira,
// e o motor, que confere de novo na hora, não atribuiria — o robô ativo com
// um nome na tela e ninguém recebendo nada. A leitura é por `profiles.user_id`
// (o id de LOGIN), nunca `profiles.id`.
//
// Todos são ERRO (bloqueiam a ativação), e não aviso: a rota só devolve a
// lista de problemas quando RECUSA, e o editor mostra só a frase do erro — um
// aviso aqui não chegaria a ninguém. E gravar a resposta é o ponto do robô de
// pré-qualificação: o closer lê a ficha, não o log do run.
//
// ⚠️ Leitura que FALHA não vira "apagado" (regra da casa: erro de banco não é
// "não encontrado") — a conferência é pulada e o motor continua sendo a
// guarda de verdade (item apagado = run `failed` com o motivo escrito).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { membroEscolhidoNoHandoff } from './atribuir-no-handoff';
import { campoServeAoNo, destinoDaResposta } from './resposta-na-ficha';
import type { ValidationIssue } from './validate';

interface NoDoRobo {
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
}

export interface CampoExistente {
  field_type: string;
  espelho?: string | null;
}

export interface ReferenciasExistentes {
  acervo: ReadonlySet<string>;
  campos: ReadonlyMap<string, CampoExistente>;
  /** Funis DESTA conta entre os que os nós apontam. */
  funis: ReadonlySet<string>;
  /** Etapa → funil, só das etapas de funis DESTA conta. */
  etapas: ReadonlyMap<string, string>;
  /** `user_id` dos membros DESTA conta entre os que os "Transferir" apontam. */
  membros: ReadonlySet<string>;
}

const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function acervoDoNo(no: NoDoRobo): string | null {
  if (no.node_type !== 'send_media') return null;
  const id = (no.config as { acervo_id?: unknown }).acervo_id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

interface MovimentoDoNo {
  funilId: string;
  etapaId: string;
  origens: string[];
}

/** O "Mover card" do nó, lido campo a campo (é JSONB). */
function movimentoDoNo(no: NoDoRobo): MovimentoDoNo | null {
  if (no.node_type !== 'move_deal_stage') return null;
  const c = no.config as { pipeline_id?: unknown; stage_id?: unknown; origem_stage_ids?: unknown };
  const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const origens = Array.isArray(c.origem_stage_ids)
    ? c.origem_stage_ids.map(texto).filter(Boolean)
    : [];
  return { funilId: texto(c.pipeline_id), etapaId: texto(c.stage_id), origens };
}

function membroDoNo(no: NoDoRobo): string | null {
  if (no.node_type !== 'handoff') return null;
  return membroEscolhidoNoHandoff(no.config);
}

function campoDoNo(no: NoDoRobo): string | null {
  const destino = destinoDaResposta(no.node_type, (no.config as { salvar_em?: unknown }).salvar_em);
  return destino?.tipo === 'campo' ? destino.campoId : null;
}

/**
 * Puro: os ids que o robô aponta. Id que nem tem forma de UUID fica de fora
 * — ele não existe em tabela nenhuma, e mandado à consulta derrubaria a
 * consulta INTEIRA (22P02), escondendo os outros.
 */
export function referenciasDoRobo(nos: readonly NoDoRobo[]): {
  acervoIds: string[];
  campoIds: string[];
  funilIds: string[];
  etapaIds: string[];
  membroIds: string[];
} {
  const acervo = new Set<string>();
  const membros = new Set<string>();
  const campos = new Set<string>();
  const funis = new Set<string>();
  const etapas = new Set<string>();
  for (const no of nos) {
    const a = acervoDoNo(no);
    if (a && FORMA_DE_UUID.test(a)) acervo.add(a);
    const c = campoDoNo(no);
    if (c && FORMA_DE_UUID.test(c)) campos.add(c);
    const m = movimentoDoNo(no);
    if (m) {
      if (FORMA_DE_UUID.test(m.funilId)) funis.add(m.funilId);
      for (const id of [m.etapaId, ...m.origens]) if (FORMA_DE_UUID.test(id)) etapas.add(id);
    }
    const quem = membroDoNo(no);
    if (quem && FORMA_DE_UUID.test(quem)) membros.add(quem);
  }
  return {
    acervoIds: [...acervo],
    campoIds: [...campos],
    funilIds: [...funis],
    etapaIds: [...etapas],
    membroIds: [...membros],
  };
}

/** Puro: os problemas, um por nó, a partir do que existe na conta. */
export function problemasDasReferencias(
  nos: readonly NoDoRobo[],
  existentes: ReferenciasExistentes,
): ValidationIssue[] {
  const problemas: ValidationIssue[] = [];
  for (const no of nos) {
    const a = acervoDoNo(no);
    if (a && !existentes.acervo.has(a)) {
      problemas.push({
        severity: 'error',
        scope: 'node',
        node_key: no.node_key,
        field: 'acervo_id',
        message: `O arquivo do acervo escolhido no passo "${no.node_key}" foi apagado — escolha outro arquivo, senão o robô falha nesse passo.`,
      });
    }
    const c = campoDoNo(no);
    if (c) {
      const campo = existentes.campos.get(c);
      if (!campo || !campoServeAoNo(no.node_type, campo)) {
        problemas.push({
          severity: 'error',
          scope: 'node',
          node_key: no.node_key,
          field: 'salvar_em',
          message: `O campo da ficha escolhido em "Salvar a resposta" no passo "${no.node_key}" não existe mais (ou não serve a esse passo) — escolha outro campo ou "Não salvar".`,
        });
      }
    }
    const m = movimentoDoNo(no);
    // Funil ou etapa VAZIOS são do validador estrutural (`validate.ts`), que
    // já recusa — aqui só o que ele não enxerga: existir nesta conta.
    if (m && m.funilId && m.etapaId) {
      if (!existentes.funis.has(m.funilId)) {
        problemas.push({
          severity: 'error',
          scope: 'node',
          node_key: no.node_key,
          field: 'pipeline_id',
          message: `O funil escolhido em "Mover card" no passo "${no.node_key}" não existe mais nesta conta — escolha outro funil e etapa.`,
        });
      } else {
        const funilDaEtapa = existentes.etapas.get(m.etapaId);
        if (funilDaEtapa === undefined) {
          problemas.push({
            severity: 'error',
            scope: 'node',
            node_key: no.node_key,
            field: 'stage_id',
            message: `A etapa escolhida em "Mover card" no passo "${no.node_key}" não existe mais nesta conta — escolha outra etapa.`,
          });
        } else if (funilDaEtapa !== m.funilId) {
          problemas.push({
            severity: 'error',
            scope: 'node',
            node_key: no.node_key,
            field: 'stage_id',
            message: `A etapa escolhida em "Mover card" no passo "${no.node_key}" não é do funil escolhido — escolha a etapa de novo.`,
          });
        }
      }
      const apagadas = m.origens.filter((id) => !existentes.etapas.has(id)).length;
      if (apagadas > 0) {
        problemas.push({
          severity: 'error',
          scope: 'node',
          node_key: no.node_key,
          field: 'origem_stage_ids',
          message: `${apagadas === 1 ? 'Uma etapa de origem marcada' : `${apagadas} etapas de origem marcadas`} em "Mover card" no passo "${no.node_key}" ${apagadas === 1 ? 'não existe' : 'não existem'} mais nesta conta — abra o passo e use "${apagadas === 1 ? 'Tirar a etapa apagada' : `Tirar as ${apagadas} etapas apagadas`}", senão o card nunca sai dela.`,
        });
      }
    }
    const quem = membroDoNo(no);
    if (quem && !existentes.membros.has(quem)) {
      problemas.push({
        severity: 'error',
        scope: 'node',
        node_key: no.node_key,
        field: 'assign_to',
        message: `A pessoa escolhida em "Atribuir a" no passo "${no.node_key}" não é membro desta conta (ou saiu dela) — escolha outra pessoa ou "Ninguém".`,
      });
    }
  }
  return problemas;
}

/**
 * I/O: o que existe NA CONTA (service role — o `.eq('account_id')` é a cerca).
 * `null` = a leitura falhou; quem chama pula a conferência.
 */
export async function carregarReferenciasExistentes(
  db: SupabaseClient,
  accountId: string,
  nos: readonly NoDoRobo[],
): Promise<ReferenciasExistentes | null> {
  const { acervoIds, campoIds, funilIds, etapaIds, membroIds } = referenciasDoRobo(nos);
  const [acervo, campos, etapasLidas, membrosLidos] = await Promise.all([
    acervoIds.length
      ? db.from('cb_media_library').select('id').eq('account_id', accountId).in('id', acervoIds)
      : Promise.resolve({ data: [], error: null }),
    campoIds.length
      ? db
          .from('custom_fields')
          .select('id, field_type, espelho')
          .eq('account_id', accountId)
          .in('id', campoIds)
      : Promise.resolve({ data: [], error: null }),
    // `pipeline_stages` não tem `account_id` (a tenancy é pelo funil): lê a
    // etapa com o funil dela e confere o funil na consulta seguinte.
    etapaIds.length
      ? db.from('pipeline_stages').select('id, pipeline_id').in('id', etapaIds)
      : Promise.resolve({ data: [], error: null }),
    membroIds.length
      ? db.from('profiles').select('user_id').eq('account_id', accountId).in('user_id', membroIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (acervo.error || campos.error || etapasLidas.error || membrosLidos.error) return null;

  const etapasBrutas = (etapasLidas.data ?? []) as Array<{ id: string; pipeline_id: string }>;
  const funisPedidos = [...new Set([...funilIds, ...etapasBrutas.map((e) => e.pipeline_id)])];
  const funisLidos = funisPedidos.length
    ? await db.from('pipelines').select('id').eq('account_id', accountId).in('id', funisPedidos)
    : { data: [], error: null };
  if (funisLidos.error) return null;
  const funisDaConta = new Set(((funisLidos.data ?? []) as Array<{ id: string }>).map((f) => f.id));

  return {
    acervo: new Set(((acervo.data ?? []) as Array<{ id: string }>).map((r) => r.id)),
    campos: new Map(
      ((campos.data ?? []) as Array<{ id: string } & CampoExistente>).map((r) => [
        r.id,
        { field_type: r.field_type, espelho: r.espelho ?? null },
      ]),
    ),
    funis: funisDaConta,
    etapas: new Map(
      etapasBrutas.filter((e) => funisDaConta.has(e.pipeline_id)).map((e) => [e.id, e.pipeline_id]),
    ),
    membros: new Set(((membrosLidos.data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)),
  };
}
