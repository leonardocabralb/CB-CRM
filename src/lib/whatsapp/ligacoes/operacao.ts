// ============================================================
// A operação do computador de ligações pelo CRM (4e,
// `docs/PLANO-ligar-pelo-crm.md` §8.17): o que a seção "Ligações pelo CRM"
// da tela Conexões faz, só para o admin.
//
//  - a lista dos computadores da conta, com o interruptor e a situação;
//  - o INTERRUPTOR (1137, D16): ligado, o CRM liga, atende, toca e alarma;
//    desligado, nada disso (a régua é `computadorPronto`);
//  - o QR AO VIVO (a máquina o tira da própria tela, `GET /qr`), para ler
//    com o celular do número;
//  - o REPAREAR: o "Desconectar" do WhatsApp Web da máquina, para um QR novo.
//
// ⚠️ D17: só onde já há computador. Criar um para outro número é operação na
// VPS (`docs/INFRA-VPS.md` §4) — nenhum caminho daqui cria contêiner.
//
// `cb_computadores_de_ligacao` é FECHADA ao navegador (1134): tudo aqui roda
// com a service role, cercado pela conta da sessão, e nunca devolve o
// endereço nem o nome do contêiner (infraestrutura interna). Nunca lança.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  COLUNAS_DO_COMPUTADOR,
  pedirAoComputador,
  situacaoDaMaquina,
  type Computador,
  type SituacaoDaMaquina,
} from './computador';

/** Um computador como a tela Conexões o vê. */
export interface ComputadorDaConexao {
  channel_id: string;
  ligado: boolean;
  /** Quando o admin ligou (nulo = desligado). */
  ligado_em: string | null;
  /** Só do ligado: o que a tela diz dele. Desligado, nulo. */
  situacao: SituacaoDaMaquina | null;
  /** O último sinal de vida (a máquina manda um por minuto, ligada ou não). */
  sinal_em: string | null;
}

export function comoNaTela(c: Computador, agoraMs: number): ComputadorDaConexao {
  const ligado = typeof c.ligado_em === 'string';
  return {
    channel_id: c.channel_id,
    ligado,
    ligado_em: c.ligado_em,
    situacao: ligado ? situacaoDaMaquina(c, agoraMs) : null,
    sinal_em: c.ultimo_sinal_em,
  };
}

/** Os computadores da conta. `'falhou'` = a leitura falhou (nunca a lista vazia). */
export async function computadoresDaConta(
  db: SupabaseClient,
  accountId: string,
  agoraMs: number,
): Promise<ComputadorDaConexao[] | 'falhou'> {
  const { data, error } = await db
    .from('cb_computadores_de_ligacao')
    .select(COLUNAS_DO_COMPUTADOR)
    .eq('account_id', accountId);
  if (error) {
    console.error('[ligacoes] ler os computadores da conta falhou:', error.message);
    return 'falhou';
  }
  return ((data ?? []) as Computador[]).map((c) => comoNaTela(c, agoraMs));
}

async function computadorDaConexao(
  db: SupabaseClient,
  accountId: string,
  canal: string,
): Promise<Computador | null | 'falhou'> {
  const { data, error } = await db
    .from('cb_computadores_de_ligacao')
    .select(COLUNAS_DO_COMPUTADOR)
    .eq('account_id', accountId)
    .eq('channel_id', canal)
    .maybeSingle();
  if (error) {
    console.error('[ligacoes] ler o computador da conexão falhou:', error.message);
    return 'falhou';
  }
  return (data as Computador | null) ?? null;
}

export type Recusa = { ok: false; status: number; erro: string };
const recusa = (status: number, erro: string): Recusa => ({ ok: false, status, erro });

/**
 * O interruptor. Ligar de novo o que já está ligado mantém o `ligado_em` de
 * antes (o "ligado desde"). Desligar não derruba a ligação em curso (o
 * desligar e a gravação não dependem dele); os alarmes do computador somem —
 * a sonda só olha o ligado, e o ciclo apaga a linha deles calado. ⚠️ E apaga
 * o toque AINDA NÃO ATENDIDO da conexão (`tocando`; o reivindicado já não é
 * `tocando`): sem isso, a equipe seguia ouvindo o toque, com um "Atender" que
 * o interruptor já recusa, até o cliente desistir (Codex, #506). O toque que
 * nascer entre o desligar e esta limpeza (o `offer` que leu o computador
 * ligado um instante antes) dura até o fim da chamada: limite aceito.
 */
export async function trocarInterruptor(
  db: SupabaseClient,
  accountId: string,
  canal: string,
  ligado: boolean,
  agoraIso: string,
): Promise<{ ok: true; ligado_em: string | null } | Recusa> {
  let consulta = db
    .from('cb_computadores_de_ligacao')
    .update({ ligado_em: ligado ? agoraIso : null })
    .eq('account_id', accountId)
    .eq('channel_id', canal);
  if (ligado) consulta = consulta.is('ligado_em', null);
  const { data, error } = await consulta.select('ligado_em');
  if (error) {
    console.error('[ligacoes] o interruptor não gravou:', error.message);
    return recusa(500, 'falhou');
  }
  const linha = (data ?? [])[0] as { ligado_em: string | null } | undefined;
  if (linha) {
    if (!ligado) {
      const { error: erroDoToque } = await db
        .from('cb_ligacoes_ao_vivo')
        .delete()
        .eq('account_id', accountId)
        .eq('channel_id', canal)
        .eq('estado', 'tocando');
      if (erroDoToque) console.error('[ligacoes] o toque da conexão desligada ficou:', erroDoToque.message);
    }
    return { ok: true, ligado_em: linha.ligado_em };
  }
  // Zero linhas: sem computador (404), ou ligar o que já estava ligado.
  const atual = await computadorDaConexao(db, accountId, canal);
  if (atual === 'falhou') return recusa(500, 'falhou');
  if (!atual) return recusa(404, 'sem_computador');
  if (ligado && atual.ligado_em !== null) return { ok: true, ligado_em: atual.ligado_em };
  return recusa(500, 'falhou');
}

/** O QR é uma imagem PNG em data URL, nada além (vai direto num `<img>`). */
const QR_PNG = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const PRAZO_DO_ESTADO_MS = 8_000;
/** O QR vencido é recarregado na máquina antes da foto. */
const PRAZO_DO_QR_MS = 25_000;
/** Configurações → Desconectar → confirmar → o QR novo na tela (até ~60 s lá dentro). */
const PRAZO_DO_REPAREAR_MS = 75_000;

/**
 * O estado AO VIVO do WhatsApp da máquina e, quando ela pede, o QR. Só do
 * computador LIGADO (D16: "habilitou, aparece o QR").
 */
export async function qrDaConexao(
  db: SupabaseClient,
  accountId: string,
  canal: string,
  segredo: string,
  enviar: typeof fetch = fetch,
): Promise<{ ok: true; whatsapp: string | null; qr: string | null } | Recusa> {
  const computador = await computadorDaConexao(db, accountId, canal);
  if (computador === 'falhou') return recusa(500, 'falhou');
  if (!computador) return recusa(404, 'sem_computador');
  if (typeof computador.ligado_em !== 'string') return recusa(409, 'desligado');

  const estado = await pedirAoComputador(computador, segredo, '/estado', undefined, enviar, PRAZO_DO_ESTADO_MS);
  if (!estado.ok) return recusa(502, 'sem_resposta');
  const whatsapp = typeof estado.corpo.whatsapp === 'string' ? estado.corpo.whatsapp : null;
  if (whatsapp !== 'qr') return { ok: true, whatsapp, qr: null };

  const foto = await pedirAoComputador(computador, segredo, '/qr', undefined, enviar, PRAZO_DO_QR_MS);
  const qr = foto.ok && typeof foto.corpo.qr === 'string' && QR_PNG.test(foto.corpo.qr) ? foto.corpo.qr : null;
  return { ok: true, whatsapp, qr };
}

/**
 * O Reparear: a máquina desconecta o WhatsApp Web dela (só com a linha livre)
 * e passa a mostrar um QR novo. ⚠️ Derruba as ligações pelo CRM deste número
 * até alguém ler o QR com o celular dele: a tela pede confirmação.
 */
export async function reparearConexao(
  db: SupabaseClient,
  accountId: string,
  canal: string,
  segredo: string,
  enviar: typeof fetch = fetch,
): Promise<{ ok: true } | Recusa> {
  const computador = await computadorDaConexao(db, accountId, canal);
  if (computador === 'falhou') return recusa(500, 'falhou');
  if (!computador) return recusa(404, 'sem_computador');
  if (typeof computador.ligado_em !== 'string') return recusa(409, 'desligado');

  const r = await pedirAoComputador(computador, segredo, '/desconectar', {}, enviar, PRAZO_DO_REPAREAR_MS);
  if (r.ok) return { ok: true };
  if (r.erro === 'ocupada') return recusa(409, 'em_ligacao');
  if (r.erro === 'whatsapp_desconectado') return recusa(409, 'ja_pede_qr');
  return recusa(502, r.status === null ? 'sem_resposta' : 'nao_desconectou');
}
