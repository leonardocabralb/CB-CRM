import type { PipelineStage } from "@/types";

/**
 * O funil de eficiência é FIXO: lead → mql → reuniao → proposta → contrato
 * → pasta.
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
 * ⚠️⚠️ `pasta` (1054, C1 do plano do previdenciário, 26/09/2026) é o degrau
 * DEPOIS do contrato — "Pasta fechada" no previdenciário, "Processo
 * protocolado" no Trabalhista —, IGUAL para todos os funis e OPCIONAL: funil
 * sem etapa nele não tem nada faltando (`DEGRAUS_OPCIONAIS`). E ele é
 * FECHAMENTO: quem está em pasta está "fechado", e "alcançou contrato" é
 * alcançar contrato OU pasta (`ehFechamento`, `INDICE_DO_CONTRATO`). Sem
 * isso, remapear "Protocolado" de contrato para pasta tiraria os 677
 * protocolados do CAC do Trabalhista de uma vez — há pino em
 * `custos.test.ts` ("remapear 'Protocolado' de contrato para pasta NÃO muda
 * o CAC do Trabalhista").
 *
 * Plano: docs/PLANO-funil-comercial.md, seção 3; o degrau novo,
 * docs/PLANO-previdenciario.md, Fase 6.
 */
export const DEGRAUS = ["lead", "mql", "reuniao", "proposta", "contrato", "pasta"] as const;
export type Degrau = (typeof DEGRAUS)[number];

/**
 * Degraus que um funil pode não ter SEM que isso seja esquecimento: sem
 * etapa, o cartão dele simplesmente não aparece (os outros saem tracejados,
 * com "Configurar etapas", até o operador mapear ou dizer que não se aplica
 * — ver `src/lib/funil/painel.ts`).
 */
export const DEGRAUS_OPCIONAIS: readonly Degrau[] = ["pasta"];

/** O que uma etapa pode ser no funil de eficiência: um degrau ou perda. */
export type ClasseDaEtapa = Degrau | "perda";
export const CLASSES: readonly ClasseDaEtapa[] = [...DEGRAUS, "perda"];

export function ehDegrau(v: unknown): v is Degrau {
  return typeof v === "string" && (DEGRAUS as readonly string[]).includes(v);
}

export function ehClasse(v: unknown): v is ClasseDaEtapa {
  return v === "perda" || ehDegrau(v);
}

/** Posição do degrau na ordem fixa (lead = 0 … contrato = 4, pasta = 5). */
export function indiceDoDegrau(d: Degrau): number {
  return DEGRAUS.indexOf(d);
}

/** O contrato é o piso do FECHAMENTO: todo degrau a partir dele fecha. */
export const INDICE_DO_CONTRATO = DEGRAUS.indexOf("contrato");

/**
 * A classe é de FECHAMENTO (contrato ou pasta)? É o que decide a situação
 * "fechado" — e com ela o dinheiro e o CAC.
 */
export function ehFechamento(classe: ClasseDaEtapa | null): boolean {
  return classe !== null && classe !== "perda" && indiceDoDegrau(classe) >= INDICE_DO_CONTRATO;
}

export type EtapaMinima = Pick<PipelineStage, "id" | "name" | "position" | "degrau">;

export interface Classificacao {
  /** etapa → classe, SÓ das etapas mapeadas (sem degrau = ausente). */
  classeDaEtapa: Map<string, ClasseDaEtapa>;
  /** etapas de cada classe, na ordem de posição do funil. */
  porClasse: Record<ClasseDaEtapa, EtapaMinima[]>;
  /**
   * degraus OBRIGATÓRIOS sem nenhuma etapa correspondente (o opcional, a
   * pasta, não entra). O que a tela desenha tracejado depende também do
   * "não se aplica" do funil — `estadoDoDegrau`, em `painel.ts`.
   */
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
    pasta: [],
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
    faltando: DEGRAUS.filter((d) => porClasse[d].length === 0 && !DEGRAUS_OPCIONAIS.includes(d)),
    configurado: porClasse.lead.length > 0,
    etapas: new Map(ordenadas.map((e) => [e.id, e])),
  };
}

/**
 * O último degrau MAPEADO antes do contrato — o "pipeline ativo" do balde
 * "em andamento" (quem está em proposta, na referência). ⚠️ Contado a partir
 * do CONTRATO, nunca do fim da lista: com a pasta (1054) o último degrau
 * deixou de ser o contrato, e "o penúltimo" passaria a ser ele — e ninguém
 * em contrato está "em andamento".
 */
export function degrauAntesDoContrato(classificacao: Classificacao): Degrau | null {
  const antes = DEGRAUS.slice(0, INDICE_DO_CONTRATO).reverse();
  return antes.find((d) => classificacao.porClasse[d].length > 0) ?? null;
}

/**
 * SUGESTÃO para a tela de Funis quando o operador marca o `resultado` de uma
 * etapa ainda sem degrau: ganho → contrato, perdido → perda. Só isso — o
 * cálculo nunca lê `resultado`. (Ganho continua sugerindo contrato, e não
 * pasta: pasta é opcional, e contrato é o degrau que todo funil tem.)
 */
export function sugerirClasse(resultado: string | null | undefined): ClasseDaEtapa | null {
  if (resultado === "ganho") return "contrato";
  if (resultado === "perdido") return "perda";
  return null;
}
