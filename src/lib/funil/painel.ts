import {
  type Classificacao,
  type Degrau,
  DEGRAUS,
  DEGRAUS_OPCIONAIS,
  ehDegrau,
} from "./degraus";

/**
 * A CONFIGURAÇÃO DO PAINEL de cada funil — o "painel editável" da C2 do plano
 * do previdenciário (26/09/2026): `pipelines.painel` (jsonb, migration 1054),
 * editada em Gerenciar funil (só admin, como o resto do funil). Três coisas,
 * e só elas:
 *
 *  - RÓTULO LIVRE por degrau ("Assinatura enviada" para `proposta`, "Pasta
 *    fechada" ou "Processo protocolado" para `pasta`). ⚠️ Não passa pelo
 *    dicionário: é texto do escritório, igual em qualquer idioma. Vazio =
 *    o rótulo padrão, que É do dicionário (`Pipelines.funil.degraus.<d>`).
 *  - Degraus que NÃO SE APLICAM àquele funil (a reunião no Trabalhista e no
 *    previdenciário): sem etapa, o cartão some em vez de sair tracejado com
 *    "Configurar etapas". ⚠️ Só a MARCA esconde: o funil que não marcou
 *    continua vendo o tracejado — é o aviso de que esqueceu de mapear, e
 *    esconder por padrão apagaria esse aviso de todo funil de uma vez. E a
 *    etapa MAPEADA vence a marca: com etapa no degrau, o cartão aparece.
 *  - Quais CARTÕES DE CUSTO aparecem no Desempenho e na Saúde. Guarda-se o
 *    que o operador ESCONDEU, nunca o que mostra: cartão novo nasce visível
 *    em todo funil já configurado.
 *
 * ⚠️ PARSE, nunca `as`: o jsonb é escrito pela tela, mas pode ter sido gravado
 * por uma versão que não conhecia um degrau ou um cartão de hoje (ou à mão).
 * Chave desconhecida é ignorada; tipo errado vira o padrão.
 */

/**
 * Os cartões de custo, na ordem da tela. `contrato` é o "custo por contrato
 * ASSINADO" (investimento ÷ quem alcançou contrato — C1), e fica ao lado do
 * `cac` de sempre, que divide pelo contrato EM PÉ: num funil com "Contrato
 * sem pasta" os dois se separam com o tempo.
 */
export const CARTOES_DE_CUSTO = [
  "investimento",
  "lead",
  "mql",
  "reuniao",
  "no_show",
  "proposta",
  "contrato",
  "cac",
  "pasta",
  "perdidos",
] as const;
export type CartaoDeCusto = (typeof CARTOES_DE_CUSTO)[number];

/** O cartão de custo que depende de um degrau MAPEADO para fazer sentido. */
const DEGRAU_DO_CARTAO: Partial<Record<CartaoDeCusto, Degrau>> = {
  lead: "lead",
  mql: "mql",
  reuniao: "reuniao",
  proposta: "proposta",
  contrato: "contrato",
  pasta: "pasta",
};

export function degrauDoCartao(cartao: CartaoDeCusto): Degrau | null {
  return DEGRAU_DO_CARTAO[cartao] ?? null;
}

/** Teto do rótulo livre: ele entra em título de cartão e em cabeçalho de linha. */
export const ROTULO_MAX = 40;

export interface PainelDoFunil {
  /** só os preenchidos, aparados; ausente = o rótulo padrão do dicionário */
  rotulos: Partial<Record<Degrau, string>>;
  /** na ordem fixa dos degraus, sem repetição */
  naoSeAplica: Degrau[];
  /** na ordem de `CARTOES_DE_CUSTO`, sem repetição */
  custosOcultos: CartaoDeCusto[];
}

/** A forma gravada no banco (chaves em snake_case, como os outros jsonb). */
export interface PainelGravado {
  rotulos: Partial<Record<Degrau, string>>;
  nao_se_aplica: Degrau[];
  custos_ocultos: CartaoDeCusto[];
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function ehCartao(v: unknown): v is CartaoDeCusto {
  return typeof v === "string" && (CARTOES_DE_CUSTO as readonly string[]).includes(v);
}

/** Aparado e cortado no teto; vazio = sem rótulo. */
export function normalizarRotulo(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const aparado = v.trim().slice(0, ROTULO_MAX).trim();
  return aparado === "" ? null : aparado;
}

/** Parse do jsonb (qualquer lixo). `lerPainel(null)` é o painel padrão: nada escondido, rótulos do dicionário. */
export function lerPainel(cru: unknown): PainelDoFunil {
  if (!ehObjeto(cru)) return { rotulos: {}, naoSeAplica: [], custosOcultos: [] };

  const rotulos: Partial<Record<Degrau, string>> = {};
  if (ehObjeto(cru.rotulos)) {
    for (const d of DEGRAUS) {
      const r = normalizarRotulo(cru.rotulos[d]);
      if (r) rotulos[d] = r;
    }
  }

  const marcados = new Set(Array.isArray(cru.nao_se_aplica) ? cru.nao_se_aplica.filter(ehDegrau) : []);
  const ocultos = new Set(Array.isArray(cru.custos_ocultos) ? cru.custos_ocultos.filter(ehCartao) : []);

  return {
    rotulos,
    naoSeAplica: DEGRAUS.filter((d) => marcados.has(d)),
    custosOcultos: CARTOES_DE_CUSTO.filter((c) => ocultos.has(c)),
  };
}

/** O que a tela grava em `pipelines.painel` — já normalizado. */
export function escreverPainel(painel: PainelDoFunil): PainelGravado {
  const limpo = lerPainel({
    rotulos: painel.rotulos,
    nao_se_aplica: painel.naoSeAplica,
    custos_ocultos: painel.custosOcultos,
  });
  return {
    rotulos: limpo.rotulos,
    nao_se_aplica: limpo.naoSeAplica,
    custos_ocultos: limpo.custosOcultos,
  };
}

/** O rótulo do degrau NESTE funil: o livre, senão o padrão (do dicionário). */
export function rotuloDoDegrau(
  painel: PainelDoFunil,
  degrau: Degrau,
  padrao: (d: Degrau) => string,
): string {
  return painel.rotulos[degrau] ?? padrao(degrau);
}

export type EstadoDoDegrau =
  /** tem etapa: o cartão aparece, com número */
  | "mapeado"
  /** sem etapa e opcional (a pasta) ou marcado "não se aplica": o cartão some */
  | "nao_se_aplica"
  /** sem etapa e sem marca: o cartão sai tracejado, com "Configurar etapas" */
  | "faltando";

export function estadoDoDegrau(
  degrau: Degrau,
  classificacao: Classificacao,
  painel: PainelDoFunil,
): EstadoDoDegrau {
  if (classificacao.porClasse[degrau].length > 0) return "mapeado";
  if (DEGRAUS_OPCIONAIS.includes(degrau) || painel.naoSeAplica.includes(degrau)) return "nao_se_aplica";
  return "faltando";
}

/** Os degraus que o funil de eficiência DESENHA, na ordem fixa. */
export function degrausNaTela(classificacao: Classificacao, painel: PainelDoFunil): Degrau[] {
  return DEGRAUS.filter((d) => estadoDoDegrau(d, classificacao, painel) !== "nao_se_aplica");
}

/**
 * Os cartões de custo que aparecem, na ordem da tela: os que o operador não
 * escondeu e, os de degrau, só com o degrau MAPEADO — custo por reunião num
 * funil sem reunião seria sempre "—", e o tracejado do funil já avisa o
 * esquecimento. Investimento, CAC e custo dos perdidos não dependem de
 * degrau; o custo por no-show depende de `funilMedeNoShow`.
 */
/**
 * O funil mede no-show? Etapa marcada "Faltou" (`etapasDeFalta`) E o degrau
 * reunião MAPEADO — os agendamentos são quem o alcançou; sem ele, o número
 * viria só de quem pulou para a proposta, com cara de agendamento. Vale para
 * a seção do Desempenho, a tabela da Saúde e o custo por no-show.
 */
export function funilMedeNoShow(classificacao: Classificacao, painel: PainelDoFunil): boolean {
  return classificacao.etapasDeFalta.size > 0 && estadoDoDegrau("reuniao", classificacao, painel) === "mapeado";
}

export function cartoesDeCustoNaTela(classificacao: Classificacao, painel: PainelDoFunil): CartaoDeCusto[] {
  return CARTOES_DE_CUSTO.filter((c) => {
    if (painel.custosOcultos.includes(c)) return false;
    // Custo por no-show só no funil que mede no-show: nos outros seria
    // sempre "—".
    if (c === "no_show") return funilMedeNoShow(classificacao, painel);
    const degrau = degrauDoCartao(c);
    return degrau === null || estadoDoDegrau(degrau, classificacao, painel) === "mapeado";
  });
}
