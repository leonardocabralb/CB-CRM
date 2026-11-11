// ============================================================
// O computador de ligações (`maquina-de-ligacoes/`, 4a) visto do CRM (4b,
// `docs/PLANO-ligar-pelo-crm.md` §8.14): o segredo de cada um, o pedido à API
// dele e a conferência de quem fala com o CRM.
//
// ⚠️ O SEGREDO É POR COMPUTADOR: HMAC-SHA256 do segredo do CRM
// (`LIGACOES_SEGREDO`) com o nome do computador, em hex. O Chrome da máquina
// abre o que qualquer pessoa manda ao número (o risco principal, §8.7): quem
// tirar de lá o segredo de UM computador não fala pelo outro nem chega ao do
// CRM. Na VPS, `ops/vps/ligacoes/criar-maquina.sh` grava o derivado no
// ambiente do contêiner; o do CRM fica só no `crm.env`.
//
// O endereço de cada computador mora no banco (`cb_computadores_de_ligacao`),
// nunca no código: é configuração da instalação.
// ============================================================

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

export interface Computador {
  id: string;
  account_id: string;
  channel_id: string;
  nome: string;
  endereco: string;
  whatsapp: string | null;
  ligacao_em_curso: string | null;
  ultimo_sinal_em: string | null;
}

export const COLUNAS_DO_COMPUTADOR =
  'id, account_id, channel_id, nome, endereco, whatsapp, ligacao_em_curso, ultimo_sinal_em';

/** O sinal de vida vem a cada minuto: três minutos sem ele, o computador está fora. */
export const SINAL_VELHO_MS = 3 * 60_000;

/** O tamanho mínimo do segredo (o mesmo que a máquina exige do dela). */
const SEGREDO_MINIMO = 32;

/** O segredo do CRM, ou nulo quando a instalação não configurou as ligações. */
export function segredoDoCrm(): string | null {
  const segredo = process.env.LIGACOES_SEGREDO?.trim() ?? '';
  return segredo.length >= SEGREDO_MINIMO ? segredo : null;
}

/** O segredo de UM computador (o `LIGACOES_SEGREDO` do contêiner dele). */
export function segredoDoComputador(segredoDoCrm: string, nome: string): string {
  return createHmac('sha256', segredoDoCrm).update(nome).digest('hex');
}

/** Sem sinal recente, o computador está fora, diga o último sinal o que disser. */
export function computadorFora(
  computador: Pick<Computador, 'ultimo_sinal_em'>,
  agoraMs: number,
): boolean {
  const sinal = Date.parse(computador.ultimo_sinal_em ?? '');
  return !Number.isFinite(sinal) || agoraMs - sinal > SINAL_VELHO_MS;
}

/** Pronto para ligar e atender: com sinal recente e o WhatsApp conectado. */
export function computadorPronto(
  computador: Pick<Computador, 'ultimo_sinal_em' | 'whatsapp'>,
  agoraMs: number,
): boolean {
  return computador.whatsapp === 'conectado' && !computadorFora(computador, agoraMs);
}

const resumo = (texto: string) => createHash('sha256').update(texto).digest();

/**
 * Quem está falando com o CRM: o computador cujo segredo é o do cabeçalho
 * `Authorization: Bearer …`. Nulo = 401. Compara com TODOS (são poucos), em
 * tempo constante por comparação.
 */
export function computadorDoCabecalho<T extends { nome: string }>(
  cabecalho: string | null,
  computadores: readonly T[],
  segredoDoCrm: string,
): T | null {
  if (!cabecalho?.startsWith('Bearer ')) return null;
  const recebido = resumo(cabecalho.slice('Bearer '.length));
  let achado: T | null = null;
  for (const c of computadores) {
    if (timingSafeEqual(recebido, resumo(segredoDoComputador(segredoDoCrm, c.nome)))) achado = c;
  }
  return achado;
}

/**
 * As rotas da máquina são da rede interna (a máquina chama o CRM pelo nome do
 * serviço na `LigacoesNet`): pedido que chega pelo domínio público do site
 * (pelo Traefik) é recusado antes do segredo. Defesa a mais — o segredo é a
 * tranca. ⚠️ Não serve olhar `x-forwarded-for`: o próprio Next o preenche
 * em todo pedido (`base-server.js`).
 */
export function veioPeloDominioPublico(pedido: Request): boolean {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!site) return false;
  let publico: string;
  try {
    publico = new URL(site).host.toLowerCase();
  } catch {
    return false;
  }
  return (pedido.headers.get('host') ?? '').toLowerCase() === publico;
}

export async function computadorDoCanal(
  db: SupabaseClient,
  accountId: string,
  channelId: string,
): Promise<Computador | null | 'falhou'> {
  const { data, error } = await db
    .from('cb_computadores_de_ligacao')
    .select(COLUNAS_DO_COMPUTADOR)
    .eq('account_id', accountId)
    .eq('channel_id', channelId)
    .maybeSingle();
  if (error) {
    console.error('[ligacoes] ler o computador da conexão falhou:', error.message);
    return 'falhou';
  }
  return (data as Computador | null) ?? null;
}

export async function todosOsComputadores(db: SupabaseClient): Promise<Computador[] | 'falhou'> {
  const { data, error } = await db.from('cb_computadores_de_ligacao').select(COLUNAS_DO_COMPUTADOR);
  if (error) {
    console.error('[ligacoes] ler os computadores falhou:', error.message);
    return 'falhou';
  }
  return (data ?? []) as Computador[];
}

export type RespostaDoComputador =
  | { ok: true; corpo: Record<string, unknown> }
  /** `status` nulo: a máquina não respondeu (rede, prazo). */
  | { ok: false; status: number | null; erro: string };

/** A ponte leva ~4 s (até 15 s de teto lá dentro); o pedido espera um pouco mais. */
const PRAZO_DO_PEDIDO_MS = 25_000;
/** As respostas da máquina são JSON pequeno; o teto só barra o absurdo. */
const TETO_DA_RESPOSTA = 64 * 1024;

/**
 * Um pedido à API interna do computador (`/ligar`, `/atender`, `/desligar`),
 * com o segredo DELE. Nunca lança. O endereço vem do banco (configuração da
 * instalação, rede interna), não de fora: sem `isDeliverableUrl` — ele
 * recusaria justamente o endereço privado. Sem seguir redirecionamento.
 */
export async function pedirAoComputador(
  computador: Pick<Computador, 'nome' | 'endereco'>,
  segredoDoCrm: string,
  caminho: '/ligar' | '/atender' | '/desligar',
  corpo: unknown,
  enviar: typeof fetch = fetch,
): Promise<RespostaDoComputador> {
  let resposta: Response;
  try {
    resposta = await enviar(`${computador.endereco}${caminho}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${segredoDoComputador(segredoDoCrm, computador.nome)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(corpo),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(PRAZO_DO_PEDIDO_MS),
    });
  } catch (err) {
    console.error('[ligacoes] o computador não respondeu:', computador.nome, caminho, String(err).slice(0, 160));
    return { ok: false, status: null, erro: 'sem_resposta' };
  }
  let json: Record<string, unknown> = {};
  try {
    const texto = await resposta.text();
    if (texto.length <= TETO_DA_RESPOSTA) {
      const lido: unknown = JSON.parse(texto);
      if (lido && typeof lido === 'object') json = lido as Record<string, unknown>;
    }
  } catch {
    // Corpo que não é JSON: fica o status.
  }
  if (resposta.ok) return { ok: true, corpo: json };
  const erro = typeof json.erro === 'string' && /^[a-z_]{1,40}$/.test(json.erro) ? json.erro : `http_${resposta.status}`;
  return { ok: false, status: resposta.status, erro };
}
