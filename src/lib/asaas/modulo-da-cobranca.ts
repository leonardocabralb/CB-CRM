/**
 * O módulo "Cobrança automática" (1135): a tela que configura de um lugar só
 * a régua do Asaas (998). É uma FACHADA sobre as automações da régua — o
 * motor continua o mesmo, e cada etapa continua sendo uma automação que o
 * construtor também abre (decisão do operador, 11/11/2026: lá ele só AVISA).
 *
 * Por isso o estado é sempre DERIVADO do que está gravado (`derivarEstado`),
 * nunca guardado à parte: quem mexer no construtor vê a mudança aqui, e nada
 * fica dessincronizado. Salvar vira um PATCH por automação
 * (`patchesDoModulo`), pela MESMA rota do construtor — a validação de ligar
 * (conexão, condição, recusas da régua) é uma só.
 *
 * Puro, sem I/O: a tela e os testes importam daqui.
 */

import { GATILHOS_DA_REGUA, lerAutomacaoDaRegua } from "./regua";

export interface PassoDoModulo {
  id?: string;
  step_type: string;
  step_config: Record<string, unknown>;
  branches?: { yes?: PassoDoModulo[]; no?: PassoDoModulo[] };
}

export interface AutomacaoDoModulo {
  id: string;
  name: string;
  trigger_type: string;
  trigger_config: Record<string, unknown> | null;
  is_active: boolean;
  assinatura_personalizada: string | null;
  steps: PassoDoModulo[];
}

/** "Pedir ligação à equipe": a condição "Situação da cobrança" + a anotação marcando quem liga + a etiqueta. */
export interface LigacaoDaRegua {
  /** "N parcelas vencidas ou mais"; `null` = não olha */
  parcelas: number | null;
  /** "N dias de atraso ou mais"; `null` = não olha */
  dias: number | null;
  /** ids de LOGIN marcados na anotação */
  mencionados: string[];
  tagId: string;
  texto: string;
}

export type TurnoDaEtapa = "dia" | "noite";

export interface EtapaDoModulo {
  automacaoId: string;
  nome: string;
  tipo: "lembrete" | "cobranca";
  /** só no lembrete */
  turno: TurnoDaEtapa | null;
  /** só na cobrança */
  dias: number | null;
  hora: string;
  somenteDiasUteis: boolean;
  ligada: boolean;
  /** o texto do PRIMEIRO "Enviar mensagem" do escopo de fora — `null` sem nenhum */
  texto: string | null;
  /** as conexões de todo envio da automação (em qualquer escopo), sem repetição */
  canais: string[];
  /** algum envio sem conexão (a ativação recusa) */
  envioSemCanal: boolean;
  assinatura: string | null;
  /** o bloco do "Pedir ligação" na forma do módulo; `null` sem ele */
  ligacao: LigacaoDaRegua | null;
  /** tem a condição "Situação da cobrança", mas montada à mão noutra forma: o módulo não a reescreve sem avisar */
  ligacaoAMao: boolean;
}

export type CanalDoModulo = { tipo: "nenhum" } | { tipo: "um"; id: string } | { tipo: "varios"; ids: string[] };
export type AssinaturaDoModulo = { tipo: "uma"; valor: string | null } | { tipo: "varias" };
export type LigacaoDoModulo = { tipo: "desligada" } | { tipo: "igual"; config: LigacaoDaRegua } | { tipo: "diferente" };

export interface EstadoDoModulo {
  etapas: EtapaDoModulo[];
  canal: CanalDoModulo;
  /** a de todas as etapas, MENOS o lembrete da noite (que assina "Mensagem automática") */
  assinatura: AssinaturaDoModulo;
  somenteDiasUteis: boolean | "misto";
  /** entre as COBRANÇAS (o lembrete não tem vencidas para a condição ler) */
  ligacao: LigacaoDoModulo;
  /** dias de atraso que aparecem em mais de uma cobrança */
  marcosRepetidos: number[];
  /** mais de um lembrete no mesmo turno */
  turnosRepetidos: TurnoDaEtapa[];
}

const PASSOS_COM_CANAL = new Set(["send_message", "send_media"]);

function percorrer(passos: readonly PassoDoModulo[], f: (p: PassoDoModulo) => void): void {
  for (const p of passos) {
    f(p);
    if (p.branches) {
      percorrer(p.branches.yes ?? [], f);
      percorrer(p.branches.no ?? [], f);
    }
  }
}

function texto(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function inteiroOuNulo(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * O bloco na forma do módulo, ou `null`:
 *
 * condição "Situação da cobrança" (Sim) → condição "tem a etiqueta X"
 * (Não) → [anotação marcando, pôr a etiqueta X]
 *
 * A etiqueta é o "até resolver": quem liga a tira, e a régua volta a pedir.
 */
export function lerBlocoDaLigacao(p: PassoDoModulo): LigacaoDaRegua | null {
  if (p.step_type !== "condition" || p.step_config.subject !== "asaas_situacao") return null;
  const sim = p.branches?.yes ?? [];
  const nao = p.branches?.no ?? [];
  if (sim.length !== 1 || nao.length !== 0) return null;
  const temEtiqueta = sim[0];
  if (temEtiqueta.step_type !== "condition" || temEtiqueta.step_config.subject !== "tag_presence") return null;
  const tagId = texto(temEtiqueta.step_config.operand);
  if (!tagId) return null;
  if ((temEtiqueta.branches?.yes ?? []).length !== 0) return null;
  const acoes = temEtiqueta.branches?.no ?? [];
  if (acoes.length !== 2 || acoes[0].step_type !== "add_note" || acoes[1].step_type !== "add_tag") return null;
  if (acoes[1].step_config.tag_id !== tagId) return null;
  const mencionados = Array.isArray(acoes[0].step_config.mencionados) ? (acoes[0].step_config.mencionados as unknown[]).filter((m): m is string => typeof m === "string") : [];
  return {
    parcelas: inteiroOuNulo(p.step_config.cobranca_parcelas),
    dias: inteiroOuNulo(p.step_config.cobranca_dias),
    mencionados,
    tagId,
    texto: texto(acoes[0].step_config.texto) ?? "",
  };
}

/** O bloco do "Pedir ligação" a gravar. Sem `id`: passos novos (os de antes saem inteiros). */
export function blocoDaLigacao(l: LigacaoDaRegua): PassoDoModulo {
  return {
    step_type: "condition",
    step_config: {
      subject: "asaas_situacao",
      ...(l.parcelas !== null ? { cobranca_parcelas: l.parcelas } : {}),
      ...(l.dias !== null ? { cobranca_dias: l.dias } : {}),
    },
    branches: {
      yes: [
        {
          step_type: "condition",
          step_config: { subject: "tag_presence", operand: l.tagId },
          branches: {
            yes: [],
            no: [
              { step_type: "add_note", step_config: { texto: l.texto, mencionados: [...l.mencionados] } },
              { step_type: "add_tag", step_config: { tag_id: l.tagId } },
            ],
          },
        },
      ],
      no: [],
    },
  };
}

function mesmaLigacao(a: LigacaoDaRegua, b: LigacaoDaRegua): boolean {
  return (
    a.parcelas === b.parcelas &&
    a.dias === b.dias &&
    a.tagId === b.tagId &&
    a.texto === b.texto &&
    a.mencionados.length === b.mencionados.length &&
    [...a.mencionados].sort().every((m, i) => m === [...b.mencionados].sort()[i])
  );
}

function etapaDe(a: AutomacaoDoModulo): EtapaDoModulo | null {
  const regua = lerAutomacaoDaRegua({ id: a.id, name: a.name, trigger_type: a.trigger_type, trigger_config: a.trigger_config });
  if (!regua) return null;
  const canais = new Set<string>();
  let envioSemCanal = false;
  let ligacaoAMao = false;
  percorrer(a.steps, (p) => {
    if (PASSOS_COM_CANAL.has(p.step_type)) {
      const c = texto(p.step_config.channel_id);
      if (c) canais.add(c);
      else envioSemCanal = true;
    }
  });
  let ligacao: LigacaoDaRegua | null = null;
  for (const p of a.steps) {
    if (p.step_type === "condition" && p.step_config.subject === "asaas_situacao") {
      const lido = lerBlocoDaLigacao(p);
      if (lido && !ligacao) ligacao = lido;
      else ligacaoAMao = true;
    }
  }
  // condição da situação DENTRO de outro ramo também é "à mão"
  percorrer(
    a.steps.flatMap((p) => [...(p.branches?.yes ?? []), ...(p.branches?.no ?? [])]),
    (p) => {
      if (p.step_type === "condition" && p.step_config.subject === "asaas_situacao") ligacaoAMao = true;
    },
  );
  const primeiro = a.steps.find((p) => p.step_type === "send_message");
  return {
    automacaoId: a.id,
    nome: a.name,
    tipo: regua.tipo === "vence_hoje" ? "lembrete" : "cobranca",
    turno: regua.tipo === "vence_hoje" ? (regua.marco === 1 ? "noite" : "dia") : null,
    dias: regua.tipo === "atraso" ? regua.marco : null,
    hora: regua.horaEnvio,
    somenteDiasUteis: regua.somenteDiasUteis,
    ligada: a.is_active,
    texto: primeiro ? texto(primeiro.step_config.text) : null,
    canais: [...canais].sort(),
    envioSemCanal,
    assinatura: a.assinatura_personalizada,
    ligacao,
    ligacaoAMao,
  };
}

/** A ordem da tela: lembrete do dia, da noite, e as cobranças pelos dias. */
function ordem(e: EtapaDoModulo): number {
  if (e.tipo === "lembrete") return e.turno === "noite" ? -1 : -2;
  return e.dias ?? 0;
}

export function derivarEstado(automacoes: readonly AutomacaoDoModulo[]): EstadoDoModulo {
  const etapas = automacoes
    .filter((a) => (GATILHOS_DA_REGUA as readonly string[]).includes(a.trigger_type))
    .map(etapaDe)
    .filter((e): e is EtapaDoModulo => e !== null)
    .sort((a, b) => ordem(a) - ordem(b) || a.automacaoId.localeCompare(b.automacaoId));

  const todosOsCanais = new Set<string>();
  for (const e of etapas) for (const c of e.canais) todosOsCanais.add(c);
  const canal: CanalDoModulo =
    todosOsCanais.size === 0 ? { tipo: "nenhum" } : todosOsCanais.size === 1 ? { tipo: "um", id: [...todosOsCanais][0] } : { tipo: "varios", ids: [...todosOsCanais].sort() };

  const assinadas = etapas.filter((e) => e.turno !== "noite");
  const valores = new Set(assinadas.map((e) => e.assinatura ?? ""));
  const assinatura: AssinaturaDoModulo = valores.size <= 1 ? { tipo: "uma", valor: assinadas[0]?.assinatura ?? null } : { tipo: "varias" };

  const uteis = new Set(etapas.map((e) => e.somenteDiasUteis));
  const somenteDiasUteis: boolean | "misto" = uteis.size === 0 ? true : uteis.size === 1 ? [...uteis][0] : "misto";

  const cobrancas = etapas.filter((e) => e.tipo === "cobranca");
  let ligacao: LigacaoDoModulo = { tipo: "desligada" };
  if (cobrancas.some((e) => e.ligacao || e.ligacaoAMao)) {
    const primeira = cobrancas[0]?.ligacao ?? null;
    const iguais = primeira !== null && cobrancas.every((e) => !e.ligacaoAMao && e.ligacao !== null && mesmaLigacao(e.ligacao, primeira));
    ligacao = iguais ? { tipo: "igual", config: primeira } : { tipo: "diferente" };
  }

  const contagemDias = new Map<number, number>();
  for (const e of cobrancas) if (e.dias !== null) contagemDias.set(e.dias, (contagemDias.get(e.dias) ?? 0) + 1);
  const marcosRepetidos = [...contagemDias].filter(([, n]) => n > 1).map(([d]) => d).sort((a, b) => a - b);
  const turnos = new Map<TurnoDaEtapa, number>();
  for (const e of etapas) if (e.turno) turnos.set(e.turno, (turnos.get(e.turno) ?? 0) + 1);
  const turnosRepetidos = [...turnos].filter(([, n]) => n > 1).map(([t]) => t);

  return { etapas, canal, assinatura, somenteDiasUteis, ligacao, marcosRepetidos, turnosRepetidos };
}

// ------------------------------------------------------------------
// Salvar: o que a tela mudou → um PATCH por automação
// ------------------------------------------------------------------

export interface MudancaDaEtapa {
  hora?: string;
  ligada?: boolean;
  texto?: string;
  /** só o lembrete da noite tem a sua; nas outras vale a de "Quem manda" */
  assinatura?: string | null;
}

export interface MudancasDoModulo {
  /** a conexão de TODO envio de todas as etapas */
  canalId?: string;
  /** "Quem assina": todas as etapas menos o lembrete da noite */
  assinatura?: string | null;
  somenteDiasUteis?: boolean;
  /** `null` tira o bloco de todas as cobranças */
  ligacao?: LigacaoDaRegua | null;
  etapas?: Record<string, MudancaDaEtapa>;
}

export interface CorpoDoPatch {
  trigger_config?: Record<string, unknown>;
  is_active?: boolean;
  assinatura_personalizada?: string | null;
  steps?: PassoDoModulo[];
}

export interface PatchDaAutomacao {
  id: string;
  nome: string;
  corpo: CorpoDoPatch;
}

function trocarCanal(passos: readonly PassoDoModulo[], canalId: string): PassoDoModulo[] {
  return passos.map((p) => ({
    ...p,
    step_config: PASSOS_COM_CANAL.has(p.step_type) ? { ...p.step_config, channel_id: canalId } : p.step_config,
    ...(p.branches ? { branches: { yes: trocarCanal(p.branches.yes ?? [], canalId), no: trocarCanal(p.branches.no ?? [], canalId) } } : {}),
  }));
}

function trocarTexto(passos: readonly PassoDoModulo[], novo: string): PassoDoModulo[] {
  const i = passos.findIndex((p) => p.step_type === "send_message");
  if (i < 0) return [...passos];
  return passos.map((p, j) => (j === i ? { ...p, step_config: { ...p.step_config, text: novo } } : p));
}

/**
 * Tira o bloco do módulo (só o que está na FORMA dele, no escopo de fora) e,
 * com `l`, põe o novo no fim. Condição montada à mão fica onde está — a tela
 * avisa antes (`ligacaoAMao`).
 */
function trocarLigacao(passos: readonly PassoDoModulo[], l: LigacaoDaRegua | null): PassoDoModulo[] {
  const sem = passos.filter((p) => lerBlocoDaLigacao(p) === null);
  return l ? [...sem, blocoDaLigacao(l)] : sem;
}

export function patchesDoModulo(automacoes: readonly AutomacaoDoModulo[], m: MudancasDoModulo): PatchDaAutomacao[] {
  const saida: PatchDaAutomacao[] = [];
  for (const a of automacoes) {
    const e = etapaDe(a);
    if (!e) continue;
    const corpo: CorpoDoPatch = {};
    const daEtapa = m.etapas?.[a.id] ?? {};
    const cfg = { ...(a.trigger_config ?? {}) };
    let mudouCfg = false;
    if (daEtapa.hora !== undefined && daEtapa.hora !== e.hora) {
      cfg.hora_envio = daEtapa.hora;
      mudouCfg = true;
    }
    if (m.somenteDiasUteis !== undefined && m.somenteDiasUteis !== e.somenteDiasUteis) {
      cfg.somente_dias_uteis = m.somenteDiasUteis;
      mudouCfg = true;
    }
    if (mudouCfg) corpo.trigger_config = cfg;
    if (daEtapa.ligada !== undefined && daEtapa.ligada !== a.is_active) corpo.is_active = daEtapa.ligada;

    const assinaturaNova = e.turno === "noite" ? daEtapa.assinatura : m.assinatura !== undefined ? m.assinatura : daEtapa.assinatura;
    if (assinaturaNova !== undefined && (assinaturaNova ?? null) !== (a.assinatura_personalizada ?? null)) corpo.assinatura_personalizada = assinaturaNova;

    let passos: PassoDoModulo[] = a.steps;
    let mudouPassos = false;
    if (daEtapa.texto !== undefined && daEtapa.texto !== e.texto) {
      passos = trocarTexto(passos, daEtapa.texto);
      mudouPassos = true;
    }
    if (m.ligacao !== undefined && e.tipo === "cobranca") {
      const atual = e.ligacao;
      const igual = m.ligacao === null ? atual === null : atual !== null && mesmaLigacao(atual, m.ligacao);
      if (!igual) {
        passos = trocarLigacao(passos, m.ligacao);
        mudouPassos = true;
      }
    }
    // a conexão por último: alcança também os envios do bloco novo
    if (m.canalId !== undefined && (e.envioSemCanal || e.canais.length !== 1 || e.canais[0] !== m.canalId)) {
      passos = trocarCanal(passos, m.canalId);
      mudouPassos = true;
    }
    if (mudouPassos) corpo.steps = passos;
    if (Object.keys(corpo).length > 0) saida.push({ id: a.id, nome: a.name, corpo });
  }
  // Ligar por último: a etapa que liga numa leva em que outra muda de conexão
  // é validada já com a conexão nova (cada PATCH é conferido sozinho).
  return saida.sort((x, y) => Number(x.corpo.is_active === true) - Number(y.corpo.is_active === true));
}

// ------------------------------------------------------------------
// O nome do escritório que vai em {{vars.escritorio_nome}}
// ------------------------------------------------------------------

/** O do módulo (1135), senão o automático da assinatura, senão o da conta — a mesma ordem da varredura. */
export function nomeDoEscritorio(doModulo: string | null | undefined, automatico: string | null | undefined, daConta: string | null | undefined): string {
  return doModulo?.trim() || automatico?.trim() || daConta?.trim() || "";
}

export const TETO_DO_NOME_DO_ESCRITORIO = 120;
