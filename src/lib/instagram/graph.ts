// ============================================================
// Cliente mínimo da API do Instagram (Instagram API com login do Instagram).
//
// Host: `graph.instagram.com` — NÃO é o `graph.facebook.com` do WhatsApp
// Cloud API nem do Meta Ads. O token é o de LONGA DURAÇÃO (60 dias) gerado
// pelo botão do painel da Meta (D3 do plano), e viaja SÓ no cabeçalho
// `Authorization: Bearer`, nunca em `?access_token=` (vaza em log de proxy —
// a mesma regra da chave do Gemini e do token do Meta Ads).
//
// Duas defesas herdadas do cliente do Meta Ads (`src/lib/meta-ads/cliente.ts`),
// porque o problema é o mesmo:
//   · `semSegredo`: a mensagem de erro da Meta ECOA o token ("Malformed
//     access token EAAB…", medido em 04/09) e ela vai para o log. Tudo que
//     vira `InstagramApiError.message` passa por aqui.
//   · `doGraphDoInstagram`: recusa qualquer URL fora do host antes do pedido.
//     O token vai no cabeçalho; seguir uma URL vinda da RESPOSTA (paging)
//     para outro host entregaria o token àquele host.
//
// Os métodos entram conforme as fases do plano precisam deles — este
// arquivo não antecipa endpoint que nenhuma tela chama ainda.
// ============================================================

export const INSTAGRAM_GRAPH = 'https://graph.instagram.com';
export const INSTAGRAM_API_VERSION = 'v26.0';

/** Curto de propósito: as chamadas daqui rodam no caminho de uma tela
 *  (cadastro, saúde) — segurar o cabeçalho é pior que responder "não sei". */
const TIMEOUT_MS = 10_000;

export const MARCA_DE_TOKEN = '«token»';

/** Só o host da API do Instagram, sempre por HTTPS. */
export function doGraphDoInstagram(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.host === 'graph.instagram.com';
  } catch {
    return false;
  }
}

/** Tira o token de qualquer texto que possa ir para log ou para a tela. */
export function semSegredo(texto: string, token: string): string {
  let saida = texto.replaceAll(
    /access_token=[^&\s"']+/gi,
    `access_token=${MARCA_DE_TOKEN}`
  );
  if (token.length >= 8) saida = saida.replaceAll(token, MARCA_DE_TOKEN);
  return saida;
}

export type CodigoDoErroInstagram =
  /** 190: token vencido, revogado ou malformado — o canal precisa de token novo. */
  | 'token_invalido'
  /** 10/200/803: o token não tem a permissão, ou a conta não pode receber. */
  | 'sem_permissao'
  /** 4/17/32/613: limite de chamadas. */
  | 'limite'
  /** Subcódigo 2534022: fora da janela de 24h (ou 7 dias com HUMAN_AGENT). */
  | 'janela_fechada'
  /** Tempo esgotado ou falha de rede — pode ter chegado, pode não. */
  | 'rede'
  /** Qualquer outro erro da Meta, com a mensagem dela (sem o token). */
  | 'meta_error';

export class InstagramApiError extends Error {
  constructor(
    public readonly codigo: CodigoDoErroInstagram,
    message: string,
    public readonly status: number | null = null,
    public readonly codigoDaMeta: number | null = null,
    public readonly subcodigoDaMeta: number | null = null
  ) {
    super(message);
    this.name = 'InstagramApiError';
  }
}

interface ErroDaMeta {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function codigoDoErro(
  status: number,
  erro: ErroDaMeta | null
): CodigoDoErroInstagram {
  if (erro?.error_subcode === 2534022) return 'janela_fechada';
  if (erro?.code === 190 || status === 401) return 'token_invalido';
  if (
    erro?.code === 10 ||
    erro?.code === 200 ||
    erro?.code === 803 ||
    status === 403
  )
    return 'sem_permissao';
  if (
    erro?.code === 4 ||
    erro?.code === 17 ||
    erro?.code === 32 ||
    erro?.code === 613 ||
    status === 429
  )
    return 'limite';
  return 'meta_error';
}

/** O que `GET /me` devolve para a conta profissional dona do token. */
export interface PerfilDaConta {
  /** O IG user id — o `entry.id` do webhook e o `{IG_ID}` de `/messages`. */
  igUserId: string;
  username: string;
  nome: string | null;
}

export interface ClienteInstagram {
  me(): Promise<PerfilDaConta>;
}

type Fetch = typeof fetch;

export function criarClienteInstagram(
  token: string,
  fetchFn: Fetch = fetch
): ClienteInstagram {
  async function pedir(caminho: string): Promise<Record<string, unknown>> {
    const url = `${INSTAGRAM_GRAPH}/${INSTAGRAM_API_VERSION}/${caminho}`;
    if (!doGraphDoInstagram(url)) {
      throw new InstagramApiError(
        'meta_error',
        'URL fora do graph.instagram.com'
      );
    }
    let resposta: Response;
    try {
      resposta = await fetchFn(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new InstagramApiError(
        'rede',
        semSegredo(e instanceof Error ? e.message : String(e), token)
      );
    }
    const corpo: unknown = await resposta.json().catch(() => null);
    if (!resposta.ok) {
      const erro =
        ehObjeto(corpo) && ehObjeto(corpo.error)
          ? (corpo.error as ErroDaMeta)
          : null;
      throw new InstagramApiError(
        codigoDoErro(resposta.status, erro),
        semSegredo(erro?.message ?? `HTTP ${resposta.status}`, token),
        resposta.status,
        erro?.code ?? null,
        erro?.error_subcode ?? null
      );
    }
    if (!ehObjeto(corpo)) {
      throw new InstagramApiError('meta_error', 'Resposta sem corpo JSON');
    }
    return corpo;
  }

  return {
    async me() {
      const r = await pedir('me?fields=user_id,username,name');
      const igUserId = r.user_id;
      const username = r.username;
      if (typeof igUserId !== 'string' && typeof igUserId !== 'number') {
        throw new InstagramApiError('meta_error', '/me veio sem user_id');
      }
      if (typeof username !== 'string' || !username) {
        throw new InstagramApiError('meta_error', '/me veio sem username');
      }
      return {
        igUserId: String(igUserId),
        username,
        nome: typeof r.name === 'string' && r.name ? r.name : null,
      };
    },
  };
}
