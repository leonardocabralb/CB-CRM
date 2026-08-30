// ============================================================
// Quais informações o card do funil exibe — escolha POR DISPOSITIVO.
//
// Decisão do operador (2026-08-30): preferência pessoal, em localStorage,
// como o tema e o painel do inbox — sem migration, sem rota. A chave usa o
// prefixo `wacrm:` com dois-pontos, seguindo `wacrm:inbox:contact-panel-open`.
//
// ⚠️ Não há número de versão no registro: `normalizarCampos` É a migração.
// Campo novo adicionado no futuro fica ausente no registro salvo e cai no
// PADRÃO (ligado) — nunca em `undefined`, que renderizaria como desligado
// sem ninguém ter pedido.
// ============================================================

export const CHAVE_CAMPOS_DO_CARD = "wacrm:pipelines:card-fields";

export interface CamposDoCard {
  valor: boolean;
  dataPrevista: boolean;
  responsavel: boolean;
  canal: boolean;
  etiquetas: boolean;
  ultimaMensagem: boolean;
  naoLidas: boolean;
}

/**
 * Tudo ligado. O operador pediu explicitamente tags e última mensagem nos
 * cards — nascer desligado esconderia o pedido atrás de um popover que ele
 * ainda não conhece. Quem achar o card alto demais desliga.
 */
export const CAMPOS_PADRAO: CamposDoCard = {
  valor: true,
  dataPrevista: true,
  responsavel: true,
  canal: true,
  etiquetas: true,
  ultimaMensagem: true,
  naoLidas: true,
};

/**
 * Aceita qualquer lixo (JSON corrompido já parseado, tipo errado, chave
 * desconhecida) e devolve preferências válidas. Só um boolean de verdade
 * sobrescreve o padrão do campo.
 */
export function normalizarCampos(cru: unknown): CamposDoCard {
  const resultado = { ...CAMPOS_PADRAO };
  if (typeof cru !== "object" || cru === null || Array.isArray(cru)) {
    return resultado;
  }
  const objeto = cru as Record<string, unknown>;
  for (const chave of Object.keys(CAMPOS_PADRAO) as (keyof CamposDoCard)[]) {
    const valor = objeto[chave];
    if (typeof valor === "boolean") resultado[chave] = valor;
  }
  return resultado;
}
