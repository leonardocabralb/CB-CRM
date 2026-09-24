// ============================================================
// Por que a conexão com a Meta falhou — o pacote que a tela traduz.
//
// O original (#505) explica a falha em INGLÊS, dentro da rota legada
// `/api/whatsapp/config`, que o fork não monta. Aqui a conexão oficial nasce
// por `POST /api/cb/channels` (Configurações → Conexões): a rota devolve este
// pacote, com um MOTIVO de lista fechada, e o painel o traduz pelo dicionário
// (`Settings.channels.metaErro.<motivo>`) — o padrão dos cartões do Calendly,
// do tl;dv e do Meta Ads. A classificação é UMA só: `explainMetaError`, do
// original, ganhou o campo `motivo`; este módulo não reclassifica nada.
//
// Puro: é lido pela rota (servidor) e pelo painel (navegador).
// ============================================================

import {
  MOTIVOS_DO_ERRO_DA_META,
  type MetaConnectStep,
  type MetaErrorExplanation,
  type MetaErrorField,
} from '@/lib/whatsapp/meta-error-explain';
import type { WabaPhoneNumber } from '@/lib/whatsapp/meta-api';

/**
 * Os motivos que a tela conhece: os da classificação do original, mais os
 * dois que a conexão confere ANTES da Meta responder a pergunta errada.
 */
export const MOTIVOS_DA_CONEXAO_META = [
  ...MOTIVOS_DO_ERRO_DA_META,
  /** O id colado não é só dígitos (telefone, nome, URL colados no lugar). */
  'id_nao_numerico',
  /** O número existe, mas não mora na WABA informada (#505). */
  'numero_fora_da_waba',
] as const;

export type MotivoDaConexaoMeta = (typeof MOTIVOS_DA_CONEXAO_META)[number];

/** Até quantos números da WABA a frase cita (o resto vira "e mais N"). */
export const NUMEROS_CITADOS = 5;

export interface FalhaDaMeta {
  motivo: MotivoDaConexaoMeta;
  /** O campo do formulário a conferir (ou null: nada no formulário resolve). */
  campo: MetaErrorField;
  /** Quem tem de mudar algo: quem preenche o formulário, ou a Meta. */
  lado: 'user' | 'meta';
  /** A chamada que falhou — null quando a falha é anterior à Meta. */
  etapa: MetaConnectStep | null;
  codigo: number | null;
  subcodigo: number | null;
  /** O que citar ao suporte da Meta. */
  fbtraceId: string | null;
  /** A mensagem da própria Meta, SEM o token (`semTokenDaMeta`). */
  mensagemDaMeta: string | null;
  /** O id que a etapa endereçava — a frase o cita de volta. */
  id: string | null;
  /** Só em `numero_fora_da_waba`. */
  waba?: string;
  numerosDaWaba?: { total: number; citados: string[] };
}

const MARCA_DE_TOKEN = '«token»';

/**
 * A mensagem da Meta ECOA o token ("Malformed access token EAAB…", medido
 * em 04/09 no Meta Ads — CLAUDE.md), e ela vai para a tela e para o log.
 * Três redes: o token inteiro, `access_token=` de qualquer URL citada, e
 * qualquer sequência com cara de token da Meta (`EAA…`) — a Meta pode ecoar
 * só um pedaço dele.
 */
export function semTokenDaMeta(texto: string, token: string): string {
  let saida = texto.replaceAll(/access_token=[^&\s"']+/gi, `access_token=${MARCA_DE_TOKEN}`);
  if (token.length >= 8) saida = saida.replaceAll(token, MARCA_DE_TOKEN);
  return saida.replaceAll(/EAA[A-Za-z0-9]{10,}/g, MARCA_DE_TOKEN);
}

/** O id que cada etapa endereça (a mesma régua de `objectForStep`). */
function idDaEtapa(
  etapa: MetaConnectStep,
  ids: { phoneNumberId: string; wabaId: string | null },
): string | null {
  return etapa === 'verify_number' || etapa === 'register' ? ids.phoneNumberId : ids.wabaId;
}

export function falhaDaExplicacao(
  x: MetaErrorExplanation,
  ids: { phoneNumberId: string; wabaId: string | null },
  token: string,
): FalhaDaMeta {
  return {
    motivo: x.motivo,
    campo: x.field,
    lado: x.side,
    etapa: x.step,
    codigo: x.code,
    subcodigo: x.subcode,
    fbtraceId: x.fbtraceId,
    mensagemDaMeta: semTokenDaMeta(x.metaMessage, token),
    id: idDaEtapa(x.step, ids),
  };
}

export function falhaDeIdNaoNumerico(campo: 'phone_number_id' | 'waba_id'): FalhaDaMeta {
  return {
    motivo: 'id_nao_numerico',
    campo,
    lado: 'user',
    etapa: null,
    codigo: null,
    subcodigo: null,
    fbtraceId: null,
    mensagemDaMeta: null,
    id: null,
  };
}

export function falhaDeNumeroForaDaWaba(
  numeros: readonly WabaPhoneNumber[],
  phoneNumberId: string,
  wabaId: string,
): FalhaDaMeta {
  return {
    motivo: 'numero_fora_da_waba',
    campo: 'waba_id',
    lado: 'user',
    etapa: 'waba_phone_numbers',
    codigo: null,
    subcodigo: null,
    fbtraceId: null,
    mensagemDaMeta: null,
    id: phoneNumberId,
    waba: wabaId,
    numerosDaWaba: {
      total: numeros.length,
      citados: numeros
        .slice(0, NUMEROS_CITADOS)
        .map((n) => (n.display_phone_number ? `${n.display_phone_number} (${n.id})` : n.id)),
    },
  };
}

/** 400 quando quem preenche resolve; 502 quando é a Meta (a régua do #505). */
export function statusDaFalha(f: FalhaDaMeta): 400 | 502 {
  return f.lado === 'user' ? 400 : 502;
}

/**
 * O `error` em texto da resposta, para quem chama a rota sem o painel. O
 * painel lê o `falha` e traduz. Sem id nem token.
 */
export function textoCurtoDaFalha(f: FalhaDaMeta): string {
  if (f.motivo === 'id_nao_numerico') {
    return f.campo === 'waba_id'
      ? 'O WABA ID deve ter só dígitos.'
      : 'O Phone Number ID deve ter só dígitos.';
  }
  if (f.motivo === 'numero_fora_da_waba') {
    return 'O Phone Number ID não pertence a essa WABA.';
  }
  return `Erro da Meta: ${f.mensagemDaMeta ?? f.motivo}`;
}

/** Leitura defensiva do `falha` que veio da rota (o painel não confia no corpo). */
export function lerFalhaDaMeta(v: unknown): FalhaDaMeta | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!(MOTIVOS_DA_CONEXAO_META as readonly unknown[]).includes(o.motivo)) return null;
  const numero = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const texto = (x: unknown) => (typeof x === 'string' && x ? x : null);
  const campos: readonly unknown[] = ['access_token', 'phone_number_id', 'waba_id', 'pin', 'meta_account'];
  const etapas: readonly unknown[] = [
    'verify_number',
    'waba_phone_numbers',
    'register',
    'subscribe_waba',
    'subscribed_apps',
  ];
  const nums = o.numerosDaWaba as Record<string, unknown> | undefined;
  const numerosDaWaba =
    nums && typeof nums === 'object' && Array.isArray(nums.citados)
      ? {
          total: numero(nums.total) ?? nums.citados.length,
          citados: nums.citados.filter((c): c is string => typeof c === 'string'),
        }
      : undefined;
  return {
    motivo: o.motivo as MotivoDaConexaoMeta,
    campo: campos.includes(o.campo) ? (o.campo as MetaErrorField) : null,
    lado: o.lado === 'meta' ? 'meta' : 'user',
    etapa: etapas.includes(o.etapa) ? (o.etapa as MetaConnectStep) : null,
    codigo: numero(o.codigo),
    subcodigo: numero(o.subcodigo),
    fbtraceId: texto(o.fbtraceId),
    mensagemDaMeta: texto(o.mensagemDaMeta),
    id: texto(o.id),
    ...(texto(o.waba) ? { waba: texto(o.waba) as string } : {}),
    ...(numerosDaWaba ? { numerosDaWaba } : {}),
  };
}
