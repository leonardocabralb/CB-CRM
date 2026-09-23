// ============================================================
// O resultado de `POST /api/cb/webhooks-de-saida/{id}/teste`, como a TELA o
// lê (Configurações → Webhooks → Enviados → "Enviar teste").
//
// Campo a campo, nunca `as`: um corpo inesperado vira "não foi possível
// enviar", e não um "Entregue" inventado; um motivo que esta tela não
// conhece (a rota ganhou um novo) vira `null`, com texto genérico, em vez de
// chave crua; e um trecho de resposta malformado some — nunca vira "resposta
// sem corpo", que seria uma afirmação sobre o que o endereço respondeu.
//
// Módulo PURO e seguro para o navegador. `import type`: `enviar-teste.ts`
// arrasta `node:crypto`, e só o tipo atravessa (é apagado na compilação).
// ============================================================

import type { MotivoDaFalhaDoTeste } from './enviar-teste';

/**
 * Quantos bytes do corpo da resposta o teste lê e a tela mostra, no máximo.
 * Mora AQUI, e não em `enviar-teste.ts`, porque a tela também o cita (o
 * aviso de "cortado em 2 KB") e aquele módulo não entra no navegador.
 */
export const TETO_DO_TRECHO = 2048;

const MOTIVOS_DE_FALHA = [
  'http',
  'redirecionamento',
  'tempo',
  'rede',
  'endereco_bloqueado',
  'segredo_ilegivel',
] as const satisfies readonly MotivoDaFalhaDoTeste[];

/**
 * O começo do corpo que o endereço respondeu. `corpo: ""` = sem corpo;
 * `binario` = o corpo não era texto e não foi lido.
 */
export type RespostaDoEndereco =
  | { binario: false; corpo: string; cortado: boolean }
  | { binario: true };

export type ResultadoLidoDoTeste =
  | { ok: true; status: number; ms: number; resposta: RespostaDoEndereco | null }
  | {
      ok: false;
      status: number | null;
      motivo: MotivoDaFalhaDoTeste | null;
      ms: number;
      resposta: RespostaDoEndereco | null;
    };

function lerResposta(valor: unknown): RespostaDoEndereco | null {
  if (typeof valor !== 'object' || valor === null) return null;
  const r = valor as Record<string, unknown>;
  if (r.binario === true) return { binario: true };
  if (typeof r.corpo !== 'string') return null;
  return { binario: false, corpo: r.corpo, cortado: r.cortado === true };
}

export function lerResultadoDoTeste(corpo: unknown): ResultadoLidoDoTeste | null {
  if (typeof corpo !== 'object' || corpo === null) return null;
  const c = corpo as Record<string, unknown>;
  // Arredondado: "312.4471 ms" na tela é ruído, e a rota pode medir com
  // `performance.now()`.
  const ms = typeof c.ms === 'number' && Number.isFinite(c.ms) ? Math.round(c.ms) : 0;
  const resposta = lerResposta(c.resposta);
  if (c.ok === true && typeof c.status === 'number') {
    return { ok: true, status: c.status, ms, resposta };
  }
  if (c.ok === false) {
    const motivo = (MOTIVOS_DE_FALHA as readonly unknown[]).includes(c.motivo)
      ? (c.motivo as MotivoDaFalhaDoTeste)
      : null;
    return {
      ok: false,
      status: typeof c.status === 'number' ? c.status : null,
      motivo,
      ms,
      resposta,
    };
  }
  return null;
}
