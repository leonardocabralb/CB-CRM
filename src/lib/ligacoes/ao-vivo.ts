// ============================================================
// A ligação pelo CRM na TELA (4c, `docs/PLANO-ligar-pelo-crm.md` §8.15): as
// regras puras do botão "Ligar", do cartão que toca e do painel da ligação.
// O servidor é `src/lib/whatsapp/ligacoes/pelo-crm.ts` (4b); a tela lê
// `cb_ligacoes_ao_vivo` (1134) pelo tempo real.
//
// ⚠️ A linha do tempo real é JSON de fora: lida campo a campo
// (`lerLigacaoAoVivo`), nunca `as`.
// ⚠️ O DELETE do tempo real traz SÓ a chave (a tabela tem RLS): a linha some
// pelo id, e o id apagado não volta numa releitura que saiu antes dele
// (`apagadas`).
// ============================================================

/** A situação do computador de ligações de uma conexão (rota `computadores`). */
export type SituacaoDoComputador = "pronto" | "fora" | "sem_whatsapp";

export type EstadoAoVivo = "tocando" | "conectando" | "chamando" | "em_ligacao";
const ESTADOS: readonly EstadoAoVivo[] = ["tocando", "conectando", "chamando", "em_ligacao"];

export interface LigacaoAoVivo {
  id: string;
  account_id: string;
  channel_id: string;
  direcao: "recebida" | "feita";
  estado: EstadoAoVivo;
  /** O número da ligação: a tela mostra quem é antes de haver ficha. */
  telefone: string | null;
  conversation_id: string | null;
  contact_id: string | null;
  /** Quem ligou ou atendeu pelo CRM (nulo enquanto toca). */
  atendente_id: string | null;
  desde: string;
  atualizada_em: string;
}

/**
 * O toque sem fim há mais de 3 min é lixo (a máquina o apaga no sinal
 * seguinte; `TOQUE_VELHO_MS` de `pelo-crm.ts`): a tela não toca por ele.
 */
export const TOQUE_VELHO_MS = 3 * 60_000;

/** O aviso antes do fim (D13: a máquina encerra sozinha aos 30 min). */
export const AVISO_DO_FIM_SEG = 28 * 60;

const texto = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export function lerLigacaoAoVivo(x: unknown): LigacaoAoVivo | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const id = texto(o.id);
  const conta = texto(o.account_id);
  const canal = texto(o.channel_id);
  const desde = texto(o.desde);
  const estado = ESTADOS.find((e) => e === o.estado);
  const direcao = o.direcao === "feita" || o.direcao === "recebida" ? o.direcao : null;
  if (!id || !conta || !canal || !desde || !estado || !direcao) return null;
  return {
    id,
    account_id: conta,
    channel_id: canal,
    direcao,
    estado,
    telefone: texto(o.telefone),
    conversation_id: texto(o.conversation_id),
    contact_id: texto(o.contact_id),
    atendente_id: texto(o.atendente_id),
    desde,
    atualizada_em: texto(o.atualizada_em) ?? desde,
  };
}

export type MudancaAoVivo =
  | { tipo: "INSERT" | "UPDATE"; linha: LigacaoAoVivo }
  | { tipo: "DELETE"; id: string };

/** Um evento do tempo real sobre a lista em memória. */
export function juntarAoVivo(
  atuais: readonly LigacaoAoVivo[],
  mudanca: MudancaAoVivo,
  apagadas: ReadonlySet<string>,
): LigacaoAoVivo[] {
  if (mudanca.tipo === "DELETE") return atuais.filter((l) => l.id !== mudanca.id);
  const { linha } = mudanca;
  // UPDATE atrasado de uma ligação que já acabou não a ressuscita.
  if (apagadas.has(linha.id)) return [...atuais];
  const sem = atuais.filter((l) => l.id !== linha.id);
  return [...sem, linha];
}

/**
 * A releitura da tabela inteira (ao assinar, ao reconectar, de tempos em
 * tempos com ligação na tela). ⚠️ A consulta pode ter saído ANTES de um evento
 * que já chegou: o id apagado fica de fora, e a linha que o tempo real trouxe
 * DEPOIS de a consulta sair (`recentes`) vale mais que a lida — senão o toque
 * que acabou de chegar sumiria da tela até o próximo evento.
 */
export function releituraAoVivo(
  lidas: readonly LigacaoAoVivo[],
  atuais: readonly LigacaoAoVivo[],
  apagadas: ReadonlySet<string>,
  recentes: ReadonlySet<string>,
): LigacaoAoVivo[] {
  const resultado = new Map<string, LigacaoAoVivo>();
  for (const l of lidas) if (!apagadas.has(l.id)) resultado.set(l.id, l);
  for (const l of atuais) if (recentes.has(l.id) && !apagadas.has(l.id)) resultado.set(l.id, l);
  return [...resultado.values()];
}

/**
 * Os toques que ESTA pessoa vê (D9): recebidas tocando, nas conexões que o
 * perfil dela vê, recentes. Quem não atende (papel abaixo de atendente) não
 * vê toque nenhum.
 */
export function toquesVisiveis(
  linhas: readonly LigacaoAoVivo[],
  args: { podeAtender: boolean; canalNoEscopo: (channelId: string) => boolean; agoraMs: number },
): LigacaoAoVivo[] {
  if (!args.podeAtender) return [];
  return linhas.filter((l) => {
    if (l.direcao !== "recebida" || l.estado !== "tocando") return false;
    const desde = Date.parse(l.desde);
    if (Number.isFinite(desde) && args.agoraMs - desde > TOQUE_VELHO_MS) return false;
    return args.canalNoEscopo(l.channel_id);
  });
}

// ------------------------------------------------------------
// O botão "Ligar" do cabeçalho da conversa (§8.1)
// ------------------------------------------------------------

/** Cada motivo é chave do dicionário (`Ligacoes.botao.<motivo>`), cobrada por teste. */
export const MOTIVOS_DO_BOTAO = [
  "grupo",
  "sem_telefone",
  "sem_poder",
  "computador_fora",
  "sem_whatsapp",
  "em_outra_ligacao",
  "linha_ocupada",
  "tocando_agora",
] as const;
export type MotivoDoBotao = (typeof MOTIVOS_DO_BOTAO)[number];

export type BotaoLigar =
  | { mostra: false }
  /** `motivo` nulo = ligado; `quem` = o atendente da ligação que ocupa a linha. */
  | { mostra: true; motivo: MotivoDoBotao | null; quem: string | null };

/**
 * O botão aparece só onde a conexão da conversa tem computador de ligações,
 * e fica desligado com o porquê. ⚠️ A lista de computadores carregando ou que
 * FALHOU (`null`) não mostra nada: um botão desligado ali afirmaria um "fora
 * do ar" que ninguém mediu.
 *
 * O número é o `conversations.channel_id` CRU — o mesmo que a rota de ligar
 * usa (sem ele, ela recusa `conversa_sem_numero`).
 */
export function decidirBotaoLigar(args: {
  canalId: string | null;
  computadores: ReadonlyMap<string, SituacaoDoComputador> | null;
  ehGrupo: boolean;
  temTelefone: boolean;
  podeLigar: boolean;
  /** Esta aba já tem uma ligação (uma por vez por atendente). */
  emLigacao: boolean;
  aoVivo: readonly LigacaoAoVivo[];
}): BotaoLigar {
  if (!args.canalId || !args.computadores) return { mostra: false };
  const situacao = args.computadores.get(args.canalId);
  if (!situacao) return { mostra: false };
  const desligado = (motivo: MotivoDoBotao, quem: string | null = null): BotaoLigar => ({
    mostra: true,
    motivo,
    quem,
  });
  if (args.ehGrupo) return desligado("grupo");
  if (!args.temTelefone) return desligado("sem_telefone");
  if (!args.podeLigar) return desligado("sem_poder");
  if (situacao === "fora") return desligado("computador_fora");
  if (situacao === "sem_whatsapp") return desligado("sem_whatsapp");
  if (args.emLigacao) return desligado("em_outra_ligacao");
  const doNumero = args.aoVivo.filter((l) => l.channel_id === args.canalId);
  const ocupando = doNumero.find((l) => l.estado !== "tocando");
  if (ocupando) return desligado("linha_ocupada", ocupando.atendente_id);
  if (doNumero.some((l) => l.estado === "tocando")) return desligado("tocando_agora");
  return { mostra: true, motivo: null, quem: null };
}

// ------------------------------------------------------------
// O painel da ligação
// ------------------------------------------------------------

/**
 * `microfone`: pedindo o microfone; `conectando`: a ponte de áudio com o
 * computador (a rota leva ~5 s, medido na 4b); depois o que a linha ao vivo
 * diz; `encerrada` e `falhou` ficam na tela até fechar.
 */
export type FaseDaLigacao =
  | "microfone"
  | "conectando"
  | "chamando"
  | "em_ligacao"
  | "encerrada"
  | "falhou";

/** A fase que a linha ao vivo da MINHA ligação manda mostrar. */
export function faseDoEstado(estado: EstadoAoVivo): FaseDaLigacao {
  switch (estado) {
    case "em_ligacao":
      return "em_ligacao";
    case "chamando":
      return "chamando";
    case "tocando":
    case "conectando":
      return "conectando";
    default: {
      const nunca: never = estado;
      return nunca;
    }
  }
}

/** A fase só ANDA: um UPDATE atrasado não devolve "Em ligação" a "Chamando". */
const ORDEM_DA_FASE: Record<FaseDaLigacao, number> = {
  microfone: 0,
  conectando: 1,
  chamando: 2,
  em_ligacao: 3,
  encerrada: 4,
  falhou: 4,
};

export function faseSeguinte(atual: FaseDaLigacao, nova: FaseDaLigacao): FaseDaLigacao {
  return ORDEM_DA_FASE[nova] > ORDEM_DA_FASE[atual] ? nova : atual;
}

/**
 * As recusas que a tela sabe dizer — as da rota (`pelo-crm.ts`), as que a
 * máquina devolve e as do próprio navegador. Código desconhecido vira
 * `desconhecida` (o texto genérico), nunca a chave crua na tela.
 */
export const RECUSAS = [
  // da rota
  "grupo",
  "conversa_nao_encontrada",
  "conversa_sem_numero",
  "sem_computador",
  "computador_fora",
  "sem_telefone",
  "tocando_agora",
  "ocupada",
  "limite_por_hora",
  "ja_atendida",
  "ja_encerrada",
  "nao_esta_tocando",
  "sem_resposta_webrtc",
  "ligacoes_nao_configuradas",
  // da máquina
  "whatsapp_desconectado",
  "outra_chamada",
  "nada_tocando",
  "sem_resposta",
  // do navegador
  "microfone_negado",
  "microfone_indisponivel",
  "audio_falhou",
  "rede",
] as const;
export type Recusa = (typeof RECUSAS)[number] | "desconhecida";

export function recusaConhecida(codigo: string | null | undefined): Recusa {
  return RECUSAS.find((r) => r === codigo) ?? "desconhecida";
}

/** "02:13" (ou "1:02:13" acima de uma hora). */
export function relogioDaLigacao(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

/** As partes da duração para o texto "4 min 21 s" / "21 s". */
export function partesDaDuracao(segundos: number): { minutos: number; segundos: number } {
  const s = Math.max(0, Math.round(segundos));
  return { minutos: Math.floor(s / 60), segundos: s % 60 };
}
