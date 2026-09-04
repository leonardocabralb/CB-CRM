import type { PipelineStage } from "@/types";

/**
 * O funil de eficiência é FIXO: lead → mql → reuniao → proposta → contrato.
 *
 * Cada funil do CRM mapeia as SUAS etapas para esses degraus
 * (`pipeline_stages.degrau`, migration 975). Várias etapas podem apontar
 * para o mesmo degrau ("Entrada Avulsa" + "Entrada Anúncios" = lead, pedido
 * do operador em 2026-09-03), e etapa SEM degrau não conta no funil de
 * eficiência. `perda` é a classe negativa (Desqualificado, No Show,
 * Perdido…): não é degrau, e na tela vira um card por etapa.
 *
 * ⚠️ `degrau` é INDEPENDENTE de `resultado` (950). `resultado` decide o
 * STATUS do negócio ao entrar na etapa (ganho/perdido, por gatilho);
 * `degrau` decide o que a etapa significa no funil de eficiência. Nada aqui
 * deriva um do outro em tempo de execução — `sugerirClasse` existe só para a
 * tela de Funis PREENCHER uma sugestão que o operador confirma ao salvar.
 * Motivo: "No Show" pode ser perda no funil de eficiência sem ser perdido
 * no status, se o escritório reagenda.
 *
 * Plano: docs/PLANO-funil-comercial.md, seção 3.
 */
export const DEGRAUS = ["lead", "mql", "reuniao", "proposta", "contrato"] as const;
export type Degrau = (typeof DEGRAUS)[number];

/** O que uma etapa pode ser no funil de eficiência: um degrau ou perda. */
export type ClasseDaEtapa = Degrau | "perda";
export const CLASSES: readonly ClasseDaEtapa[] = [...DEGRAUS, "perda"];

export function ehDegrau(v: unknown): v is Degrau {
  return typeof v === "string" && (DEGRAUS as readonly string[]).includes(v);
}

export function ehClasse(v: unknown): v is ClasseDaEtapa {
  return v === "perda" || ehDegrau(v);
}

/** Posição do degrau na ordem fixa (lead = 0 … contrato = 4). */
export function indiceDoDegrau(d: Degrau): number {
  return DEGRAUS.indexOf(d);
}

export type EtapaMinima = Pick<PipelineStage, "id" | "name" | "position" | "degrau">;

export interface Classificacao {
  /** etapa → classe, SÓ das etapas mapeadas (sem degrau = ausente). */
  classeDaEtapa: Map<string, ClasseDaEtapa>;
  /** etapas de cada classe, na ordem de posição do funil. */
  porClasse: Record<ClasseDaEtapa, EtapaMinima[]>;
  /** degraus positivos sem NENHUMA etapa correspondente (o card sai tracejado). */
  faltando: Degrau[];
  /** há ao menos uma etapa em `lead` — sem isso o painel não calcula nada. */
  configurado: boolean;
  /** todas as etapas do funil, por id (nome/posição para rótulo e ordem). */
  etapas: Map<string, EtapaMinima>;
}

/**
 * Lê o mapeamento das etapas de UM funil. Valor desconhecido na coluna
 * (não deveria existir: há CHECK) é tratado como "sem degrau", nunca como
 * erro — a tela continua de pé e o operador corrige em Funis.
 */
export function classificarEtapas(etapas: readonly EtapaMinima[]): Classificacao {
  const ordenadas = [...etapas].sort((a, b) => a.position - b.position);
  const classeDaEtapa = new Map<string, ClasseDaEtapa>();
  const porClasse: Record<ClasseDaEtapa, EtapaMinima[]> = {
    lead: [],
    mql: [],
    reuniao: [],
    proposta: [],
    contrato: [],
    perda: [],
  };
  for (const etapa of ordenadas) {
    const classe = etapa.degrau;
    if (!ehClasse(classe)) continue;
    classeDaEtapa.set(etapa.id, classe);
    porClasse[classe].push(etapa);
  }
  return {
    classeDaEtapa,
    porClasse,
    faltando: DEGRAUS.filter((d) => porClasse[d].length === 0),
    configurado: porClasse.lead.length > 0,
    etapas: new Map(ordenadas.map((e) => [e.id, e])),
  };
}

/**
 * SUGESTÃO para a tela de Funis quando o operador marca o `resultado` de uma
 * etapa ainda sem degrau: ganho → contrato, perdido → perda. Só isso — o
 * cálculo nunca lê `resultado`.
 */
export function sugerirClasse(resultado: string | null | undefined): ClasseDaEtapa | null {
  if (resultado === "ganho") return "contrato";
  if (resultado === "perdido") return "perda";
  return null;
}
