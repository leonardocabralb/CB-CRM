// ============================================================
// Condição "Situação da cobrança" (`asaas_situacao`) — SÓ na régua de
// cobrança do Asaas (10/11/2026, pedido do operador: "cliente com mais de
// 15 dias de atraso ou mais de uma parcela em atraso" → anotação marcando
// quem liga para negociar).
//
// O motor não tinha condição sobre a situação da dívida: as que existem
// olham etiqueta, campo, etapa, hora e canal. Esta lê o que a VARREDURA
// passa no contexto (`montarVariaveis`, `asaas/regua.ts`):
// `vars.vencidas_quantidade` (quantas vencidas o cliente tem, todas, não só
// a do marco) e `vars.dias_de_atraso_maior` (a mais antiga, em dias de
// calendário no fuso do escritório). Nada é lido do banco: é a foto que a
// varredura acabou de RECONFERIR no Asaas, a mesma que vai na mensagem.
//
// Responde SIM quando QUALQUER limite preenchido é alcançado ("a partir
// de": 2 parcelas = duas ou mais; 15 dias = o próprio dia 15 conta, para o
// marco de 15 dias pegar quem atrasou uma parcela só). Limite em branco não
// é olhado; os dois em branco a ativação recusa.
//
// ⚠️ Fora da régua não há `vars` da cobrança, e no LEMBRETE do vencimento a
// varredura não passa vencida nenhuma: nos dois responde NÃO (fora da régua,
// dizendo isso no registro) — e a ativação recusa a condição em todo gatilho
// que não seja a cobrança de atraso (`validateAsaasReguaForActivation`), para
// não haver ramo morto em silêncio.
// ============================================================

export const TETO_DE_PARCELAS = 99;
export const TETO_DE_DIAS = 365;

export interface LimitesDaCobranca {
  /** a partir de quantas parcelas vencidas; `null` = não olha */
  parcelas: number | null;
  /** a partir de quantos dias de atraso da mais antiga; `null` = não olha */
  dias: number | null;
}

/** `ConditionStepConfig` ou o `step_config` cru do construtor. */
type ConfigDaCobranca = { cobranca_parcelas?: unknown; cobranca_dias?: unknown };

function inteiroNaFaixa(v: unknown, teto: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= teto ? v : null;
}

export function lerLimitesDaCobranca(cfg: ConfigDaCobranca): LimitesDaCobranca {
  return {
    parcelas: inteiroNaFaixa(cfg.cobranca_parcelas, TETO_DE_PARCELAS),
    dias: inteiroNaFaixa(cfg.cobranca_dias, TETO_DE_DIAS),
  };
}

/**
 * O problema da FORMA, para a ativação: limite presente que não é inteiro na
 * faixa (o motor o ignoraria, e o operador acharia que vale), ou nenhum
 * limite (a condição responderia sempre "não"). `null` = está certa.
 */
export function problemaDosLimites(
  cfg: Record<string, unknown>,
): { codigo: 'limite_invalido'; campo: 'cobranca_parcelas' | 'cobranca_dias' } | { codigo: 'sem_limite' } | null {
  const presente = (v: unknown) => v !== undefined && v !== null && v !== '';
  if (presente(cfg.cobranca_parcelas) && inteiroNaFaixa(cfg.cobranca_parcelas, TETO_DE_PARCELAS) === null) return { codigo: 'limite_invalido', campo: 'cobranca_parcelas' };
  if (presente(cfg.cobranca_dias) && inteiroNaFaixa(cfg.cobranca_dias, TETO_DE_DIAS) === null) return { codigo: 'limite_invalido', campo: 'cobranca_dias' };
  const l = lerLimitesDaCobranca(cfg);
  return l.parcelas === null && l.dias === null ? { codigo: 'sem_limite' } : null;
}

/** "3" ou 3 → 3; o resto → null. As `vars` da varredura são texto. */
function numeroDaVariavel(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

/**
 * Puro: a resposta e a NOTA do registro (o que foi lido), como a hora do dia
 * e a janela de 24h — sem ela, o ramo "não" não teria como ser conferido
 * depois.
 */
export function avaliarSituacaoDaCobranca(
  cfg: ConfigDaCobranca,
  vars: Record<string, unknown> | undefined,
): { sim: boolean; nota: string } {
  const vencidas = numeroDaVariavel(vars?.vencidas_quantidade);
  const dias = numeroDaVariavel(vars?.dias_de_atraso_maior);
  if (vencidas === null || dias === null) {
    return { sim: false, nota: 'sem a situação da cobrança: só a régua do Asaas a entrega' };
  }
  const limites = lerLimitesDaCobranca(cfg);
  const porParcelas = limites.parcelas !== null && vencidas >= limites.parcelas;
  // Sem vencida não há atraso: `dias_de_atraso_maior` é "0" no lembrete.
  const porDias = limites.dias !== null && vencidas > 0 && dias >= limites.dias;
  const nota =
    vencidas === 0
      ? 'nenhuma parcela vencida'
      : `${vencidas} ${vencidas === 1 ? 'parcela vencida' : 'parcelas vencidas'}, a mais antiga com ${dias} ${dias === 1 ? 'dia' : 'dias'} de atraso`;
  return { sim: porParcelas || porDias, nota };
}
