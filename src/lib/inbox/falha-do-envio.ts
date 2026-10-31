import { ehOtimista } from '@/lib/inbox/bolhas-otimistas';
import { naOrdemDoFio } from '@/lib/inbox/ordem-do-fio';
import type { Message } from '@/types';

// ============================================================
// O envio do ROBÔ que NUNCA SAIU (decisão do operador, 06/10/2026).
//
// A automação, o robô e o agente de IA tentam mandar por uma conexão, o
// provedor recusa (conexão fora do ar, número sem WhatsApp) e, até aqui, nada
// ficava no fio: a falha só aparecia no histórico da execução. Agora a
// tentativa vira uma linha em `messages` — `sender_type = 'bot'`,
// `status = 'failed'`, `nao_saiu = true` (1080), sem `message_id` — e o
// motivo em `error_title`, como CÓDIGO nosso (traduzido na tela).
//
// ⚠️ `nao_saiu` é o que separa esta linha da falha de RECIBO: aquela saiu
// (tem o id do provedor) e o WhatsApp avisou depois que não entregou — a
// bolha "Não entregue" de sempre, com o texto da Meta (`motivo-da-falha.ts`).
//
// A bolha OTIMISTA do envio da equipe (19/10/2026) usa as mesmas frases: na
// falha, o fio lhe dá `nao_saiu` + o motivo (`falhaDaResposta`, abaixo). Antes
// ela só ficava `failed` e dizia "não entregue — envie de novo", inclusive a
// número sem WhatsApp. Desde 31/10/2026 a falha do PROVEDOR também é GRAVADA
// (`agent` + o `sender_id` de quem tentou, `registrarTentativaDaEquipe`): a
// rota devolve o id e o fio troca a otimista pela linha, que todos veem.
// ============================================================

/**
 * Por que não saiu. `incerto` é o único que NÃO afirma "não saiu": tempo
 * esgotado, 5xx, erro de rede — a mensagem PODE ter chegado (a lição do
 * `entrega_incerta`, 932), e a frase manda conferir antes de reenviar.
 * `barrado` é o envio da equipe que parou NO CRM, antes de chegar a qualquer
 * conexão (conversa, conexão sem configuração, janela de 24 h, número trocado
 * no meio, limite, sessão): "o WhatsApp recusou" seria falso ali.
 */
export const MOTIVOS_DO_ENVIO = [
  'conexao_fora_do_ar',
  'sem_whatsapp',
  'recusado',
  'barrado',
  'incerto',
] as const;

export type MotivoDoEnvio = (typeof MOTIVOS_DO_ENVIO)[number];

type Campos = Pick<Message, 'nao_saiu' | 'error_title'>;

/** O que a bolha otimista mostra quando o envio da equipe falhou. */
export interface FalhaDoEnvio {
  motivo: MotivoDoEnvio;
  /** O porquê do provedor ou do CRM, na linha "Motivo:" e no `title`. */
  detalhe: string | null;
  /**
   * O botão "Tentar de novo". Só com recusa COMPROVADA e que pode mudar:
   * reenviar o que pode ter saído manda em dobro ao cliente (CLAUDE.md, 8e), e
   * reenviar a número sem WhatsApp falha igual.
   */
  podeTentarDeNovo: boolean;
  /**
   * A tentativa ficou GRAVADA (31/10/2026): o id da linha, que a rota devolve
   * em `mensagem_id`. O fio troca a otimista por ela.
   */
  mensagemId?: string | null;
}

/**
 * A recusa comprovada que PODE mudar: só nela reenviar faz sentido. Número
 * sem WhatsApp falha igual; o incerto pode ter saído.
 */
const MOTIVOS_QUE_REENVIAM: readonly MotivoDoEnvio[] = ['recusado', 'conexao_fora_do_ar'];

/** O `fetch` lançou (rede, aba, proxy): o servidor pode ter enviado. */
export const FALHA_SEM_RESPOSTA: FalhaDoEnvio = {
  motivo: 'incerto',
  detalhe: null,
  podeTentarDeNovo: false,
};

const TETO_DO_DETALHE = 300;

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, TETO_DO_DETALHE) : null;
}

/**
 * A resposta NÃO-ok da rota de envio (`/api/whatsapp/send`) → a bolha.
 *
 * O `motivo` vem do servidor (`motivoDaFalhaDoNucleo`). Sem ele — o 401 do
 * middleware, o 429 do limite, as recusas da própria rota antes do núcleo, o
 * 500 genérico —, decide o status: 4xx parou antes de qualquer conexão
 * (`barrado`); o resto é `incerto`, porque um 500 pode vir DEPOIS de o
 * provedor aceitar.
 */
export function falhaDaResposta(status: number, corpo: unknown): FalhaDoEnvio {
  const c = corpo && typeof corpo === 'object' ? (corpo as Record<string, unknown>) : {};
  const doServidor = (MOTIVOS_DO_ENVIO as readonly unknown[]).includes(c.motivo)
    ? (c.motivo as MotivoDoEnvio)
    : null;
  const motivo: MotivoDoEnvio =
    doServidor ?? (status >= 400 && status < 500 ? 'barrado' : 'incerto');
  const detalhe = doServidor ? texto(c.detalhe) : motivo === 'barrado' ? texto(c.error) : null;
  const podeTentarDeNovo =
    MOTIVOS_QUE_REENVIAM.includes(motivo) ||
    // Barrado só vale de novo quando a barreira passa: a sessão que caiu um
    // instante (o login fora do ar, 19/10) e o limite de envios.
    (motivo === 'barrado' && (status === 401 || status === 429));
  const gravada = typeof c.mensagem_id === 'string' && c.mensagem_id ? c.mensagem_id : null;
  return { motivo, detalhe, podeTentarDeNovo, ...(gravada ? { mensagemId: gravada } : {}) };
}

/** Os campos que pintam a bolha otimista como "não enviada" com o motivo. */
export function naBolha(f: FalhaDoEnvio): Pick<
  Message,
  'status' | 'nao_saiu' | 'error_title' | 'error_details'
> {
  return { status: 'failed', nao_saiu: true, error_title: f.motivo, error_details: f.detalhe };
}

/**
 * O motivo, quando a linha é uma tentativa que não saiu; `null` em qualquer
 * outra (inclusive a falha de recibo). Só o booleano `true` liga (CLAUDE.md,
 * 8c). Código que esta versão não conhece vira `incerto`: a frase que não
 * afirma nada.
 */
export function envioQueNaoSaiu(m: Campos): MotivoDoEnvio | null {
  if (m.nao_saiu !== true) return null;
  const codigo = m.error_title ?? '';
  return (MOTIVOS_DO_ENVIO as readonly string[]).includes(codigo)
    ? (codigo as MotivoDoEnvio)
    : 'incerto';
}

/**
 * A tentativa GRAVADA da equipe que ganha "Tentar de novo" (31/10/2026), ou
 * `null`. Decisão do operador: só QUEM TENTOU reenvia (os colegas veem a falha
 * e o motivo) — dois atendentes reenviando a mesma bolha mandariam em dobro.
 *
 * - de texto, com recusa que pode mudar (`MOTIVOS_QUE_REENVIAM`);
 * - a ÚLTIMA nossa do fio: qualquer mensagem nossa depois dela (a reenviada
 *   que saiu ou está saindo, outra tentativa, o robô, um colega) tira o botão.
 *   A bolha que falhou fica como registro (decisão do operador), e reenviá-la
 *   depois de a conversa andar mandaria fora de ordem. A ligação não conta:
 *   não é mensagem.
 *
 * A otimista (`temp-`) fica de fora: o fio cuida dela pelo próprio mapa
 * (`reenviaveis`). Ordem pelo DESENHO (`naOrdemDoFio`).
 */
export function tentativaReenviavel(
  mensagens: readonly Message[],
  eu: string | null,
): string | null {
  if (!eu) return null;
  const fio = naOrdemDoFio(mensagens);
  for (let i = fio.length - 1; i >= 0; i--) {
    const m = fio[i];
    if (m.sender_type === 'customer' || m.content_type === 'call') continue;
    // A ÚLTIMA nossa decide, e só ela.
    const motivo = envioQueNaoSaiu(m);
    const reenvia =
      motivo !== null &&
      MOTIVOS_QUE_REENVIAM.includes(motivo) &&
      m.sender_type === 'agent' &&
      m.sender_id === eu &&
      m.content_type === 'text' &&
      !ehOtimista(m) &&
      !m.deleted_at &&
      !!m.content_text?.trim();
    return reenvia ? m.id : null;
  }
  return null;
}
