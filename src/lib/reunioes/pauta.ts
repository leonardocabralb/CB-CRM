import { alcancaProposta, marcaDaReuniaoQueVale } from '@/lib/funil/degraus';

/**
 * A PAUTA DE REUNIÕES (`/reunioes`): o que aconteceu com cada reunião e para
 * qual etapa cada botão leva o card. Plano: `docs/PLANO-pauta-de-reunioes.md`.
 *
 * Pedido do operador (28/09/2026): antes da reunião, "Reunião qualificada"
 * leva o card para a etapa marcada como tal (a MQL 2 do Bancário - Comercial);
 * depois que ela COMEÇA, o resultado — com proposta (pede o valor), sem
 * proposta ou no show. A etapa funciona como REDE DE SEGURANÇA: toda reunião
 * que já começou tem de terminar com resultado.
 *
 * Puro. Quem junta os dados é a rota `/api/cb/reunioes`; quem escreve é a
 * tela (a mudança de etapa vai do navegador, sob RLS, para a trilha e as
 * automações verem GENTE — ver `mover.ts`).
 *
 * ⚠️ O resultado vem de DUAS fontes, e vence a mais recente:
 * - o MARCO gravado pela tela (`cb_reunioes_marcos`, 1063), por reunião;
 * - a TRILHA do card (`cb_lead_events`): a equipe pode mover o card pelo
 *   quadro, pela lista ou pelo painel da conversa, e isso também conta. Só as
 *   entradas DEPOIS do início da reunião.
 * Sem a trilha, a reunião resolvida no Kanban ficaria "sem resultado" para
 * sempre; sem o marco, a reunião cujo card JÁ estava na etapa do resultado não
 * teria como ser resolvida (mover para a mesma etapa não grava trilha).
 */

export type OrigemDaReuniao = 'calendly' | 'agenda';
export type Resultado = 'proposta' | 'sem_proposta' | 'no_show';
export type Marco = 'qualificada' | 'resultado';
export type MarcaDaEtapa = 'qualificada' | 'compareceu' | 'faltou';
export type Acao = 'qualificada' | Resultado;

export const RESULTADOS: readonly Resultado[] = ['proposta', 'sem_proposta', 'no_show'];

export function ehResultado(v: unknown): v is Resultado {
  return typeof v === 'string' && (RESULTADOS as readonly string[]).includes(v);
}

/** A etapa como a pauta precisa dela: posição, degrau e a marca da 1058/1063. */
export interface EtapaDoFunil {
  id: string;
  pipelineId: string;
  nome: string;
  posicao: number;
  degrau: string | null;
  marca: MarcaDaEtapa | null;
}

/** Uma entrada do card numa etapa, pela trilha (`cb_lead_events`). */
export interface EntradaDaTrilha {
  em: string;
  /** O card que entrou (a trilha é do CONTATO; um contato pode ter card em outro funil). */
  dealId: string | null;
  etapaId: string;
  /** O nome gravado na trilha (sobrevive a renomear a etapa). */
  etapa: string | null;
  /** Quem moveu (`actor_label`); nulo quando foi sistema. */
  por: string | null;
}

/** Uma linha de `cb_reunioes_marcos`. */
export interface LinhaDoMarco {
  origem: OrigemDaReuniao;
  reuniao_id: string;
  marco: Marco;
  resultado: Resultado | null;
  valor: number | null;
  registrado_por_nome: string | null;
  registrado_em: string;
}

/** Qualificação ou resultado já registrados, e por onde. */
export interface Registro {
  em: string;
  por: string | null;
  /** `tela` = marcado aqui; `funil` = o card entrou na etapa por outro caminho. */
  fonte: 'tela' | 'funil';
  /** Nome da etapa em que o card entrou (só `funil`). */
  etapa: string | null;
}

export interface RegistroDoResultado extends Registro {
  tipo: Resultado;
  /** O valor informado na tela (só `proposta` marcada aqui). */
  valor: number | null;
}

export interface AlvoDaAcao {
  id: string;
  nome: string;
}

/** A etapa para onde cada botão leva o card, num funil. */
export type AlvosDoFunil = Record<Acao, AlvoDaAcao | null>;

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const v = Date.parse(iso);
  return Number.isNaN(v) ? null : v;
}

/**
 * O resultado que ENTRAR nesta etapa quer dizer. Degrau de proposta ou
 * depois (contrato, pasta) → com proposta, e ele VENCE a marcação "Reunião"
 * da etapa (`marcaDaReuniaoQueVale`); `faltou` → no show; `compareceu` → sem
 * proposta. É a mesma régua de "avançou" do aviso de possível no-show
 * (`aviso-de-no-show.ts`), e pelo mesmo motivo a MQL 2 NÃO conta: medido em
 * 27/09/2026, 28 das 30 entradas nela acontecem ANTES da reunião.
 */
export function resultadoDaEtapa(etapa: Pick<EtapaDoFunil, 'degrau' | 'marca'> | undefined): Resultado | null {
  if (!etapa) return null;
  if (alcancaProposta(etapa.degrau)) return 'proposta';
  const marca = marcaDe(etapa);
  if (marca === 'faltou') return 'no_show';
  if (marca === 'compareceu') return 'sem_proposta';
  return null;
}

/** A marcação "Reunião" que vale para a etapa: nula da proposta em diante. */
function marcaDe(etapa: Pick<EtapaDoFunil, 'degrau' | 'marca'> | undefined): MarcaDaEtapa | null {
  return etapa ? marcaDaReuniaoQueVale(etapa.degrau, etapa.marca) : null;
}

/**
 * Para qual etapa cada botão leva o card neste funil. Com duas etapas da mesma
 * marca, vale a de MENOR posição (a primeira do funil). Sem a etapa, o botão
 * não tem para onde levar e a tela o desliga com a explicação — nunca pelo
 * NOME da etapa: renomear "No Show" desligaria o botão em silêncio.
 *
 * A proposta é a primeira etapa com degrau `proposta` (975): o operador já
 * marcou "Proposta Realizada" assim para o Desempenho.
 */
export function alvosDoFunil(etapas: EtapaDoFunil[], pipelineId: string): AlvosDoFunil {
  const doFunil = etapas.filter((e) => e.pipelineId === pipelineId).sort((a, b) => a.posicao - b.posicao);
  const primeira = (casa: (e: EtapaDoFunil) => boolean): AlvoDaAcao | null => {
    const e = doFunil.find(casa);
    return e ? { id: e.id, nome: e.nome } : null;
  };
  return {
    qualificada: primeira((e) => marcaDe(e) === 'qualificada'),
    proposta: primeira((e) => e.degrau === 'proposta'),
    sem_proposta: primeira((e) => marcaDe(e) === 'compareceu'),
    no_show: primeira((e) => marcaDe(e) === 'faltou'),
  };
}

/** O mais recente de uma lista de registros (por `em`); nulo se vazia. */
function maisRecente<T extends { em: string }>(lista: T[]): T | null {
  let melhor: T | null = null;
  let melhorMs = -Infinity;
  for (const r of lista) {
    const v = ms(r.em);
    if (v === null) continue;
    if (v >= melhorMs) {
      melhor = r;
      melhorMs = v;
    }
  }
  return melhor;
}

/**
 * As entradas que falam DESTA reunião: do card dela (quando há card) e dentro
 * da janela `[desde, ate)`.
 *
 * ⚠️ O limite de cima é o INÍCIO DA PRÓXIMA reunião do mesmo contato: a
 * trilha é do contato inteiro, e sem o teto a entrada que resolveu a reunião
 * B resolveria também a A, anterior — a A (um no show sem registro) sairia da
 * rede de segurança com o resultado da B (revisão do PR #339). O filtro pelo
 * card tira a entrada de um card de OUTRO funil do mesmo contato.
 *
 * ⚠️ Reunião SEM card não aceita trilha nenhuma: sem card, só o marco da
 * tela a resolve. Aceitar "qualquer card" deixava um card criado DEPOIS da
 * reunião (que `negocioDoContato` recusa de propósito) resolvê-la ao entrar
 * numa etapa de resultado (Codex, PR #339).
 */
function entradasDaReuniao(
  entradas: EntradaDaTrilha[],
  desde: number | null,
  ate: number | null,
  dealId: string | null,
): EntradaDaTrilha[] {
  if (dealId === null) return [];
  return entradas.filter((e) => {
    const em = ms(e.em);
    if (em === null) return false;
    if (desde !== null && em < desde) return false;
    if (ate !== null && em >= ate) return false;
    return e.dealId === null || e.dealId === dealId;
  });
}

/**
 * O resultado da reunião: o mais recente entre o marco gravado pela tela e as
 * entradas do card, DEPOIS do início (e antes da próxima reunião do contato),
 * numa etapa que diz resultado. Nulo = sem resultado (a rede de segurança
 * acende quando a reunião já começou).
 */
export function resultadoDaReuniao(args: {
  inicio: string;
  /** Início da próxima reunião do mesmo contato; nulo = não há. */
  ate: string | null;
  dealId: string | null;
  marcos: LinhaDoMarco[];
  entradas: EntradaDaTrilha[];
  etapas: ReadonlyMap<string, EtapaDoFunil>;
}): RegistroDoResultado | null {
  const inicio = ms(args.inicio);
  if (inicio === null) return null;
  const candidatos: RegistroDoResultado[] = [];

  for (const m of args.marcos) {
    if (m.marco !== 'resultado' || !ehResultado(m.resultado)) continue;
    // Resultado registrado ANTES do início não é desta reunião: a da agenda do
    // CRM pode ter mudado de data depois de marcada (a tela só oferece o
    // resultado a partir do início).
    const em = ms(m.registrado_em);
    if (em === null || em < inicio) continue;
    candidatos.push({
      tipo: m.resultado,
      em: m.registrado_em,
      por: m.registrado_por_nome,
      fonte: 'tela',
      etapa: null,
      valor: m.resultado === 'proposta' ? m.valor : null,
    });
  }
  for (const e of entradasDaReuniao(args.entradas, inicio, ms(args.ate), args.dealId)) {
    const tipo = resultadoDaEtapa(args.etapas.get(e.etapaId));
    if (!tipo) continue;
    candidatos.push({ tipo, em: e.em, por: e.por, fonte: 'funil', etapa: e.etapa, valor: null });
  }
  return maisRecente(candidatos);
}

/**
 * A reunião foi marcada como QUALIFICADA? O marco da tela, ou o card ter
 * entrado numa etapa marcada "Reunião qualificada" a partir do agendamento
 * (`desde`: quando o Calendly avisou, ou quando a reunião foi criada na
 * agenda). Entrada ANTERIOR ao agendamento é de outra reunião.
 */
export function qualificacaoDaReuniao(args: {
  desde: string | null;
  /** Início da próxima reunião do mesmo contato; nulo = não há. */
  ate: string | null;
  dealId: string | null;
  marcos: LinhaDoMarco[];
  entradas: EntradaDaTrilha[];
  etapas: ReadonlyMap<string, EtapaDoFunil>;
}): Registro | null {
  const candidatos: Registro[] = [];
  for (const m of args.marcos) {
    if (m.marco !== 'qualificada') continue;
    candidatos.push({ em: m.registrado_em, por: m.registrado_por_nome, fonte: 'tela', etapa: null });
  }
  for (const e of entradasDaReuniao(args.entradas, ms(args.desde), ms(args.ate), args.dealId)) {
    if (marcaDe(args.etapas.get(e.etapaId)) !== 'qualificada') continue;
    candidatos.push({ em: e.em, por: e.por, fonte: 'funil', etapa: e.etapa });
  }
  return maisRecente(candidatos);
}

/**
 * O lead já foi para uma etapa marcada "Faltou" ANTES desta reunião? É o
 * mesmo fato que o aviso de possível no-show da conversa mostra (1058), aqui
 * por reunião.
 */
export function faltouAntes(args: {
  inicio: string;
  entradas: EntradaDaTrilha[];
  etapas: ReadonlyMap<string, EtapaDoFunil>;
}): { em: string; etapa: string | null } | null {
  const inicio = ms(args.inicio);
  if (inicio === null) return null;
  const faltas = args.entradas
    .filter((e) => {
      const em = ms(e.em);
      return em !== null && em < inicio && marcaDe(args.etapas.get(e.etapaId)) === 'faltou';
    })
    .map((e) => ({ em: e.em, etapa: e.etapa }));
  return maisRecente(faltas);
}

/** A reunião, pronta para a tela. */
export interface ReuniaoDaPauta {
  /** `${origem}:${reuniaoId}` — a chave da linha na tela. */
  chave: string;
  origem: OrigemDaReuniao;
  reuniaoId: string;
  inicio: string;
  fim: string | null;
  /** Nome do evento no Calendly, ou o título na agenda do CRM. */
  evento: string | null;
  link: string | null;
  /** É o horário novo de um reagendamento. */
  reagendamento: boolean;
  /**
   * Início da PRÓXIMA reunião (não desmarcada) do mesmo contato, em qualquer
   * data; nulo = esta é a última. Com ela, o card já é da reunião seguinte.
   */
  proximaEm: string | null;
  contato: { id: string; nome: string | null } | null;
  conversaId: string | null;
  /** O card do contato: o aberto mais recente, senão o mais recente. */
  negocio: {
    id: string;
    pipelineId: string;
    pipelineNome: string | null;
    etapaId: string;
    etapaNome: string | null;
    valor: number;
    status: 'open' | 'won' | 'lost';
  } | null;
  /** O que o formulário/Kommo deixou na ficha — texto, como está. */
  qualificacao: { divida: string | null; atraso: string | null; origem: string | null };
  qualificada: Registro | null;
  resultado: RegistroDoResultado | null;
  faltouAntes: { em: string; etapa: string | null } | null;
  /** O cliente escreveu e ninguém respondeu desde (`conversations.aguardando_desde`). */
  aguardandoDesde: string | null;
}

/** Em que ponto a reunião está, AGORA. */
export type Fase = 'antes' | 'sem_resultado' | 'com_resultado';

/**
 * ⚠️ O resultado abre no INÍCIO da reunião, não no fim (pedido do operador:
 * "após esse horário começar") — o no show se decide nos primeiros minutos.
 */
export function faseDaReuniao(r: Pick<ReuniaoDaPauta, 'inicio' | 'resultado'>, agora: Date): Fase {
  if (r.resultado) return 'com_resultado';
  const inicio = ms(r.inicio);
  if (inicio !== null && inicio > agora.getTime()) return 'antes';
  return 'sem_resultado';
}

/**
 * Janela da rede de segurança: reunião que começou há mais que isto e ficou
 * sem resultado sai da lista de pendentes (continua visível no dia dela).
 * 30 dias cobre o log do Calendly inteiro (começa em 08/09/2026) e não deixa
 * a lista crescer para sempre.
 */
export const JANELA_DA_REDE_MS = 30 * 24 * 60 * 60_000;

/** As reuniões que já começaram, dentro da janela, e estão sem resultado. */
export function pendentes(reunioes: ReuniaoDaPauta[], agora: Date): ReuniaoDaPauta[] {
  const piso = agora.getTime() - JANELA_DA_REDE_MS;
  return reunioes
    .filter((r) => {
      const inicio = ms(r.inicio);
      return inicio !== null && inicio >= piso && faseDaReuniao(r, agora) === 'sem_resultado';
    })
    .sort((a, b) => (ms(a.inicio) ?? 0) - (ms(b.inicio) ?? 0));
}

/** Por que o botão só REGISTRA, sem mover o card. */
export type MotivoDeSoRegistrar = 'sem_card' | 'card_fechado' | 'reuniao_posterior' | 'sem_etapa';

/**
 * O que um botão faz nesta reunião: move o card para `alvo`, ou só registra
 * o marco (com o motivo). ⚠️ TODA reunião pode ser resolvida — a rede de
 * segurança cobra resultado de todas, e reunião sem saída ficaria acesa 30
 * dias (revisão do PR #339). O que muda é se o card anda:
 *
 * - `sem_card`: o contato não tem card.
 * - `card_fechado`: só card ABERTO anda. Ganho é cliente; o PERDIDO entrando
 *   em etapa neutra (No Show, Sem Proposta, MQL 2) seria REABERTO pela 1031 —
 *   o lead que desistiu voltaria ao funil por um registro de reunião.
 * - `reuniao_posterior`: o contato já tem reunião MAIS NOVA; o card é dela
 *   (o Calendly o levou para "Reunião Agendada"), e mover pelo resultado da
 *   reunião antiga tiraria a nova da etapa — e dos lembretes.
 * - `sem_etapa`: nenhuma etapa do funil do card tem a marca (a MQL 2 só é
 *   destino depois de marcada "Qualificada" em Gerenciar funil).
 */
export function comoMarcar(
  r: Pick<ReuniaoDaPauta, 'negocio' | 'proximaEm'>,
  acao: Acao,
  alvos: AlvosDoFunil | null,
): { alvo: AlvoDaAcao; motivo: null } | { alvo: null; motivo: MotivoDeSoRegistrar } {
  if (!r.negocio) return { alvo: null, motivo: 'sem_card' };
  if (r.negocio.status !== 'open') return { alvo: null, motivo: 'card_fechado' };
  if (acao !== 'qualificada' && r.proximaEm !== null) return { alvo: null, motivo: 'reuniao_posterior' };
  const alvo = alvos?.[acao] ?? null;
  return alvo ? { alvo, motivo: null } : { alvo: null, motivo: 'sem_etapa' };
}

/**
 * Confere a resposta da rota no navegador. Forma estranha → `null` ("não
 * sei"), nunca lista vazia: vazio seria lido como "não há reunião".
 */
export function lerPauta(json: unknown): { reunioes: ReuniaoDaPauta[]; funis: Record<string, AlvosDoFunil> } | null {
  if (!json || typeof json !== 'object') return null;
  const corpo = json as { reunioes?: unknown; funis?: unknown };
  if (!Array.isArray(corpo.reunioes)) return null;
  if (!corpo.funis || typeof corpo.funis !== 'object') return null;

  const reunioes: ReuniaoDaPauta[] = [];
  for (const item of corpo.reunioes) {
    if (!item || typeof item !== 'object') return null;
    const r = item as Record<string, unknown>;
    if (r.origem !== 'calendly' && r.origem !== 'agenda') return null;
    if (typeof r.reuniaoId !== 'string' || typeof r.inicio !== 'string' || ms(r.inicio) === null) return null;
    reunioes.push(r as unknown as ReuniaoDaPauta);
  }
  const funis: Record<string, AlvosDoFunil> = {};
  for (const [id, alvos] of Object.entries(corpo.funis as Record<string, unknown>)) {
    if (!alvos || typeof alvos !== 'object') return null;
    const a = alvos as Record<string, unknown>;
    const alvo = (v: unknown): AlvoDaAcao | null => {
      if (!v || typeof v !== 'object') return null;
      const x = v as Record<string, unknown>;
      return typeof x.id === 'string' && typeof x.nome === 'string' ? { id: x.id, nome: x.nome } : null;
    };
    funis[id] = {
      qualificada: alvo(a.qualificada),
      proposta: alvo(a.proposta),
      sem_proposta: alvo(a.sem_proposta),
      no_show: alvo(a.no_show),
    };
  }
  return { reunioes, funis };
}
