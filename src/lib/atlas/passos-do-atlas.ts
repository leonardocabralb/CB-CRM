/**
 * Puro: o nó "Atlas" do construtor de automações (decisão do operador,
 * 30/09/2026) — UM nó na tela, com um seletor de AÇÃO, e um `step_type`
 * próprio por ação (sem migration: `automation_steps.step_type` não tem
 * CHECK). O construtor, `validate.ts`, `descrever-passo.ts` e a D5 dos
 * agentes de IA importam este arquivo; nada de servidor entra aqui.
 *
 * O I/O das ações novas mora em `acoes.ts`; o "Criar cliente" continua em
 * `criar-cliente.ts`, INTOCADO (está ligado em produção no "Contrato
 * fechado"). Regras: `.claude/rules/integracoes-atlas-acoes.md`.
 */

import type { AutomationStepType, SituacaoDoAtlas } from "@/types";

/** As cinco ações do nó, na ordem do seletor. "Criar cliente" é a primeira: as outras pressupõem o vínculo. */
export const PASSOS_DO_ATLAS = [
  "atlas_criar_cliente",
  "atlas_atualizar_cliente",
  "atlas_criar_tarefa",
  "atlas_enviar_transcricao",
  "atlas_atualizar_onboarding",
] as const satisfies readonly AutomationStepType[];

export type PassoDoAtlas = (typeof PASSOS_DO_ATLAS)[number];

export function ehPassoDoAtlas(tipo: string): tipo is PassoDoAtlas {
  return (PASSOS_DO_ATLAS as readonly string[]).includes(tipo);
}

/**
 * Os passos que a automação do gatilho "Situação mudou no Atlas" não pode ter
 * (D2: o Atlas manda na situação; escrever no cadastro por reflexo de uma
 * mudança feita lá desfaria a decisão da equipe e pode virar laço). O
 * construtor os esconde do seletor de ação; `validate.ts` os recusa.
 */
export const PASSOS_FORA_DO_GATILHO_DO_ATLAS: readonly PassoDoAtlas[] = ["atlas_criar_cliente", "atlas_atualizar_cliente"];

/**
 * As situações que o "Atualizar cliente" pode escrever: a lista do contrato
 * §8, SEM `em_negociacao` (o contrato manda o CRM usar `ativo`). É a MESMA
 * lista do gatilho (`SITUACOES_DO_GATILHO`, pino em `passos-do-atlas.test.ts`),
 * por decisão do operador.
 */
export const SITUACOES_ESCREVIVEIS = ["ativo", "importado", "finalizado", "rescindido", "inativo", "suspenso"] as const satisfies readonly SituacaoDoAtlas[];

/**
 * ⚠️ As que REABREM o cadastro. O "Criar cliente" recusa reativar o SUSPENSO
 * (a equipe suspendeu lá, de propósito); escrever `ativo`/`importado` pelo
 * "Atualizar" contornaria essa trava. Por isso o passo relê o cliente antes
 * (`get_client`, uma chamada a mais na cota) e PARA quando ele está suspenso.
 */
export const SITUACOES_QUE_REABREM: readonly string[] = ["ativo", "importado"];

/** `ONBOARDING_STATUSES` da API do Atlas. */
export const SITUACOES_DO_ONBOARDING = ["pending", "done", "blocked", "skipped"] as const;
export type SituacaoDoOnboarding = (typeof SITUACOES_DO_ONBOARDING)[number];

/** `Task.priority` do Atlas (a API não valida: o CRM recusa outro valor). */
export const PRIORIDADES_DA_TAREFA = ["normal", "urgent"] as const;

/** A permissão do Atlas que cada ação nova usa (os nomes do `whoami`). */
export const PERMISSAO_DA_ACAO = {
  atlas_atualizar_cliente: "update_client",
  atlas_criar_tarefa: "create_task",
  atlas_enviar_transcricao: "create_transcript",
  atlas_atualizar_onboarding: "update_onboarding",
} as const satisfies Record<Exclude<PassoDoAtlas, "atlas_criar_cliente">, string>;

/**
 * ⚠️ OPCIONAIS no escritório (fora de `PERMISSOES_NECESSARIAS`, senão as
 * conexões atuais seriam recusadas): desligada, só o passo que a usa falha,
 * com o nome dela no motivo, e a conexão NÃO vai a erro (como o
 * `read_negotiations` da Fase 3).
 */
export const PERMISSOES_OPCIONAIS = ["create_task", "create_transcript", "update_onboarding"] as const;

/**
 * O rótulo EXATO da permissão na tela do Atlas (para o motivo da falha dizer
 * o que procurar lá) — só os CONFIRMADOS, os mesmos do cartão.
 */
export const ROTULO_DA_PERMISSAO: Readonly<Record<string, string>> = {
  read_client: "Consultar Clientes",
  create_client: "Criar Clientes",
  update_client: "Atualizar Clientes",
};

/**
 * ⚠️ As OPCIONAIS ainda não têm o rótulo da tela do Atlas conferido
 * (pendência 3 da Fase 5 de `docs/PLANO-integracao-atlas.md`): o motivo, o
 * cartão e a INSTALACAO dizem o que ela faz e o nome TÉCNICO (o do `whoami`),
 * nunca um rótulo que o admin do Atlas pode não achar. Conferido, o rótulo
 * passa para `ROTULO_DA_PERMISSAO` (há pino para as duas listas não se
 * cruzarem).
 */
export const DESCRICAO_DA_PERMISSAO_OPCIONAL: Readonly<Record<(typeof PERMISSOES_OPCIONAIS)[number], string>> = {
  create_task: "criar tarefas",
  create_transcript: "criar transcrições",
  update_onboarding: "atualizar o onboarding",
};

/** A janela da transcrição (horas): padrão e teto. */
export const IDADE_PADRAO_DA_TRANSCRICAO_H = 72;
export const IDADE_MAXIMA_DA_TRANSCRICAO_H = 720;
/** Os tetos da API do Atlas (os CHECKs da tabela de transcrições, em BYTES UTF-8). */
export const TETO_TRANSCRICAO_BYTES = 300_000;
export const TETO_NOTAS_BYTES = 50_000;
/** O teto da observação do item do onboarding: `observation.length` do JS, em UNIDADES UTF-16. */
export const TETO_OBSERVACAO = 2000;
/** Prazo da tarefa: dias a partir de hoje. */
export const PRAZO_MAXIMO_DA_TAREFA = 365;

/** O `field_type` de campo de TEXTO (CHECK da 0948: text, datetime, select, number). */
export const TIPO_TEXTO = "text";

/**
 * Corta o texto para caber em `max` unidades UTF-16 (o `.length` do JS),
 * contando o "…", sem partir um par substituto (emoji). Texto que cabe volta
 * igual.
 */
export function recortarUtf16(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  let fim = Math.max(0, max - 1);
  const ultimo = texto.charCodeAt(fim - 1);
  if (fim > 0 && ultimo >= 0xd800 && ultimo <= 0xdbff) fim -= 1;
  return `${texto.slice(0, fim)}…`;
}

const codificador = new TextEncoder();

export function bytesUtf8(texto: string): number {
  return codificador.encode(texto).length;
}

/**
 * Corta o texto para caber em `maxBytes` bytes UTF-8, com o `sufixo` já
 * contado, sem partir caractere. Texto que cabe volta igual; sem espaço nem
 * para o sufixo, volta vazio.
 */
export function recortarBytes(texto: string, maxBytes: number, sufixo = " […]"): string {
  if (bytesUtf8(texto) <= maxBytes) return texto;
  const espaco = maxBytes - bytesUtf8(sufixo);
  if (espaco <= 0) return "";
  let usados = 0;
  let saida = "";
  // Por code point (o `for…of` não parte o par substituto).
  for (const c of texto) {
    const b = bytesUtf8(c);
    if (usados + b > espaco) break;
    usados += b;
    saida += c;
  }
  return `${saida}${sufixo}`;
}

/**
 * A config de cada ação que o passo já teve NESTA tela (por `cid`): trocar de
 * ação e voltar devolve a config de antes, nunca a vazia. ⚠️ Sem isso, o
 * "Contrato fechado" (em produção) trocado para "Atualizar" e de volta para
 * "Criar" perdia os três campos de data em silêncio — e o Atlas passava a
 * receber as RESERVAS (criação do card, hoje) como se fossem as datas certas.
 */
export type MemoriaDasAcoes = Partial<Record<PassoDoAtlas, Record<string, unknown>>>;

/** Trocar sai de uma config que não é a vazia da ação (a tela pede confirmação). */
export function trocaApagaAlgo(config: Record<string, unknown>, vazia: Record<string, unknown>): boolean {
  return JSON.stringify(config) !== JSON.stringify(vazia);
}

/**
 * A troca de ação: guarda a config atual na memória e devolve a da ação nova
 * (a que ela já teve, ou a vazia). Mantém a identidade do passo (`cid`/`id`,
 * quem chama): a espera parada num ramo guarda o id do passo.
 */
export function trocarAcao(
  atual: { tipo: PassoDoAtlas; config: Record<string, unknown> },
  novo: PassoDoAtlas,
  memoria: MemoriaDasAcoes,
  vazia: (tipo: PassoDoAtlas) => Record<string, unknown>,
): { config: Record<string, unknown>; memoria: MemoriaDasAcoes } {
  return {
    config: memoria[novo] ?? vazia(novo),
    memoria: { ...memoria, [atual.tipo]: atual.config },
  };
}
