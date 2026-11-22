// ============================================================
// Cliente mínimo da API do Instagram (Instagram API com login do Instagram).
//
// Host: `graph.instagram.com` — NÃO é o `graph.facebook.com` do WhatsApp
// Cloud API nem do Meta Ads. O token é o de LONGA DURAÇÃO (60 dias), vindo
// do login do Instagram (`oauth.ts`) ou colado do painel da Meta (D3 do
// plano), e viaja SÓ no cabeçalho
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
//
// ⚠️ É o ÚNICO ponto que conhece o host e a forma do token (Fase 4,
// 21/11/2026). O núcleo de envio, a renovação e a saúde falam com este
// módulo, nunca com a URL.
//
// O LOGIN UNIFICADO (1153, docs/ESTUDO-instagram-login-unificado.md) é a
// segunda forma, escolhida por conexão (`ContaDoToken`):
//   · host `graph.facebook.com`, na `v27.0` (a doc de 22/11: "graph.instagram.com
//     não funciona com o login unificado");
//   · o token é do USUÁRIO DO SISTEMA do portfólio do cliente e nunca vence;
//     `/me` é esse usuário, NÃO a conta — toda chamada leva o ID da conta no
//     caminho (`{ig-id}/messages`, `{ig-id}/subscribed_apps`);
//   · as contas que o login trouxe saem de `/me/assigned_instagram_accounts`
//     (`lerContasDoToken`).
// ============================================================

export const INSTAGRAM_GRAPH = 'https://graph.instagram.com';
export const INSTAGRAM_API_VERSION = 'v26.0';

/** O host do login unificado (o mesmo da Cloud API do WhatsApp, outro token). */
export const FACEBOOK_GRAPH = 'https://graph.facebook.com';
export const FACEBOOK_API_VERSION = 'v27.0';

/** Por qual login a conexão entrou (`cb_channels.ig_login`, 1153). */
export const LOGINS_DA_CONEXAO = ['instagram', 'unificado', 'central'] as const;
export type LoginDaConexao = (typeof LOGINS_DA_CONEXAO)[number];

/**
 * O que o cliente precisa saber do token para falar com a Meta. No login do
 * Instagram o token É da conta (`/me` diz qual); no unificado é do usuário do
 * sistema, e a conta vai no caminho de cada chamada. A conexão pela central
 * (U-3) usa o mesmo token e o mesmo host do unificado.
 */
export type ContaDoToken =
  | { login: 'instagram' }
  | { login: 'unificado'; igUserId: string };

/**
 * A `ContaDoToken` de uma linha de `cb_channels`. ⚠️ Quem lê a conexão
 * seleciona `ig_login` E `ig_user_id`: sem a coluna, a conexão do unificado
 * cairia no host do Instagram e toda chamada voltaria 190.
 */
export function contaDaConexao(c: {
  ig_login?: string | null;
  ig_user_id?: string | null;
}): ContaDoToken {
  if (c.ig_login === 'unificado' || c.ig_login === 'central') {
    // O CHECK da 989 exige `ig_user_id` em toda conexão do Instagram.
    if (!c.ig_user_id) {
      throw new InstagramApiError(
        'meta_error',
        'Conexão do login unificado sem o ID da conta'
      );
    }
    return { login: 'unificado', igUserId: c.ig_user_id };
  }
  return { login: 'instagram' };
}

/** Curto de propósito: as chamadas daqui rodam no caminho de uma tela
 *  (cadastro, saúde) — segurar o cabeçalho é pior que responder "não sei". */
const TIMEOUT_MS = 10_000;

/**
 * O ENVIO espera mais: com anexo, a Meta baixa o arquivo da nossa URL antes de
 * responder. Estourar aqui é "pode ter saído" (o núcleo não reenvia), então o
 * prazo curto da tela custaria um "não sei" a cada PDF grande.
 */
const TIMEOUT_DO_ENVIO_MS = 30_000;

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

/** Só o host do login unificado, sempre por HTTPS. */
export function doGraphDoFacebook(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.host === 'graph.facebook.com';
  } catch {
    return false;
  }
}

/** Tira o token de qualquer texto que possa ir para log ou para a tela. */
export function semSegredo(texto: string, token: string): string {
  let saida = texto
    .replaceAll(/access_token=[^&\s"']+/gi, `access_token=${MARCA_DE_TOKEN}`)
    .replaceAll(/client_secret=[^&\s"']+/gi, `client_secret=${MARCA_DE_TOKEN}`);
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

/** O que `GET /{igsid}` devolve sobre a pessoa que escreveu. */
export interface PerfilDoCliente {
  nome: string | null;
  username: string | null;
  /** URL da foto — da Meta, EXPIRA: `guardarFoto` copia para o Storage. */
  fotoUrl: string | null;
}

/**
 * O tipo de anexo do Direct (`message.attachment.type`). A doc de 21/11/2026:
 * imagem png/jpeg até 8 MB; áudio aac/m4a/wav/mp4, vídeo mp4/ogg/avi/mov/webm
 * e arquivo SÓ PDF, até 25 MB. O que cabe em cada um é decidido ANTES, em
 * `envio.ts` — aqui só se monta o pedido.
 */
export type TipoDeAnexoDoDirect = 'image' | 'audio' | 'video' | 'file';

/** Uma mensagem do Direct: texto OU um anexo (o Direct não tem legenda). */
export type MensagemDoDirect = {
  /** IGSID de quem recebe (`contacts.instagram_id`). */
  para: string;
  /** `mid` da mensagem citada (`reply_to`); nulo = sem citação. */
  citando?: string | null;
} & (
  | { texto: string; anexo?: never }
  | { anexo: { tipo: TipoDeAnexoDoDirect; url: string }; texto?: never }
);

export interface ClienteInstagram {
  me(): Promise<PerfilDaConta>;
  perfil(igsid: string): Promise<PerfilDoCliente>;
  /**
   * `POST /me/subscribed_apps` (no unificado, `/{ig-id}/subscribed_apps`): a
   * conta passa a entregar estes campos ao app. A doc exige a chamada por
   * conta; o botão "Gerar token" do painel a faz por baixo, o login não — daí
   * o callback chamar aqui.
   */
  assinarWebhooks(campos: readonly string[]): Promise<void>;
  /**
   * `DELETE /{ig-id}/subscribed_apps`: a conta para de entregar ao app (a
   * conexão pela central que sai do CRM, U-3).
   */
  tirarWebhooks(): Promise<void>;
  /**
   * `POST /me/messages` (Fase 4; no unificado, `/{ig-id}/messages`, o mesmo
   * corpo). Devolve o `mid` da mensagem — o mesmo que
   * volta no eco do webhook e que o UNIQUE `(conversation_id, message_id)`
   * usa para não gravar duas vezes.
   *
   * ⚠️ O erro decide se a mensagem PODE ter saído: `status` 4xx é recusa
   * comprovada (nada saiu); `rede` (tempo esgotado), 5xx e 2xx sem `mid` são
   * "não sei" — quem chama NUNCA repete esses.
   */
  enviarMensagem(m: MensagemDoDirect): Promise<{ messageId: string }>;
}

type Fetch = typeof fetch;

/** O corpo de `POST /me/messages`, na forma da doc. */
export function corpoDaMensagem(m: MensagemDoDirect): Record<string, unknown> {
  const message = m.anexo
    ? { attachment: { type: m.anexo.tipo, payload: { url: m.anexo.url } } }
    : { text: m.texto };
  return {
    recipient: { id: m.para },
    message,
    ...(m.citando ? { reply_to: { mid: m.citando } } : {}),
  };
}

/**
 * Lê a resposta da Meta: o corpo, ou o erro tipado (sem o token). Comum ao
 * cliente e à renovação.
 */
async function lerResposta(
  resposta: Response,
  segredo: string
): Promise<Record<string, unknown>> {
  const corpo: unknown = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const erro =
      ehObjeto(corpo) && ehObjeto(corpo.error)
        ? (corpo.error as ErroDaMeta)
        : null;
    throw new InstagramApiError(
      codigoDoErro(resposta.status, erro),
      semSegredo(erro?.message ?? `HTTP ${resposta.status}`, segredo),
      resposta.status,
      erro?.code ?? null,
      erro?.error_subcode ?? null
    );
  }
  if (!ehObjeto(corpo)) {
    throw new InstagramApiError(
      'meta_error',
      'Resposta sem corpo JSON',
      resposta.status
    );
  }
  return corpo;
}

interface InitDoPedido {
  method?: 'GET' | 'POST' | 'DELETE';
  corpo?: unknown;
  prazoMs?: number;
}

/**
 * Um pedido com o token no `Bearer`, preso ao host do login: a URL é montada
 * AQUI, e a guarda recusa qualquer outro host antes de o token sair.
 */
async function pedirComToken(
  login: ContaDoToken['login'],
  token: string,
  caminho: string,
  init: InitDoPedido,
  fetchFn: Fetch
): Promise<Record<string, unknown>> {
  const unificado = login === 'unificado';
  const url = unificado
    ? `${FACEBOOK_GRAPH}/${FACEBOOK_API_VERSION}/${caminho}`
    : `${INSTAGRAM_GRAPH}/${INSTAGRAM_API_VERSION}/${caminho}`;
  if (unificado ? !doGraphDoFacebook(url) : !doGraphDoInstagram(url)) {
    throw new InstagramApiError(
      'meta_error',
      unificado ? 'URL fora do graph.facebook.com' : 'URL fora do graph.instagram.com'
    );
  }
  let resposta: Response;
  try {
    resposta = await fetchFn(url, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init.corpo !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      ...(init.corpo !== undefined ? { body: JSON.stringify(init.corpo) } : {}),
      signal: AbortSignal.timeout(init.prazoMs ?? TIMEOUT_MS),
    });
  } catch (e) {
    throw new InstagramApiError(
      'rede',
      semSegredo(e instanceof Error ? e.message : String(e), token)
    );
  }
  return lerResposta(resposta, token);
}

export function criarClienteInstagram(
  token: string,
  fetchFn: Fetch = fetch,
  conta: ContaDoToken = { login: 'instagram' }
): ClienteInstagram {
  const pedir = (caminho: string, init: InitDoPedido = {}) =>
    pedirComToken(conta.login, token, caminho, init, fetchFn);
  // Quem a chamada representa: no login do Instagram, o próprio token (`me`);
  // no unificado, a conta — o `me` dali é o usuário do sistema.
  const dono =
    conta.login === 'unificado' ? encodeURIComponent(conta.igUserId) : 'me';

  return {
    async enviarMensagem(m) {
      const r = await pedir(`${dono}/messages`, {
        method: 'POST',
        corpo: corpoDaMensagem(m),
        prazoMs: TIMEOUT_DO_ENVIO_MS,
      });
      // 2xx sem `message_id`: a Meta ACEITOU — não é recusa. Sai como erro
      // com o status 200, que quem chama lê como "não sei" (nunca repete).
      if (typeof r.message_id !== 'string' || !r.message_id) {
        throw new InstagramApiError(
          'meta_error',
          'O envio foi aceito sem message_id',
          200
        );
      }
      return { messageId: r.message_id };
    },
    async me() {
      if (conta.login === 'unificado') {
        // O nó da conta no Graph do Facebook: `id` (o mesmo `entry.id` do
        // webhook), `username` e `name`.
        const r = await pedir(`${dono}?fields=id,username,name`);
        const username = r.username;
        if (typeof r.id !== 'string' || !r.id) {
          throw new InstagramApiError('meta_error', 'A conta veio sem id');
        }
        if (typeof username !== 'string' || !username) {
          throw new InstagramApiError('meta_error', 'A conta veio sem username');
        }
        return {
          igUserId: r.id,
          username,
          nome: typeof r.name === 'string' && r.name ? r.name : null,
        };
      }
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
    async assinarWebhooks(campos) {
      const r = await pedir(
        `${dono}/subscribed_apps?subscribed_fields=${encodeURIComponent(campos.join(','))}`,
        { method: 'POST' }
      );
      if (r.success !== true) {
        throw new InstagramApiError(
          'meta_error',
          'A assinatura do webhook não confirmou (`success` ausente)'
        );
      }
    },
    async tirarWebhooks() {
      const r = await pedir(`${dono}/subscribed_apps`, { method: 'DELETE' });
      if (r.success !== true) {
        throw new InstagramApiError(
          'meta_error',
          'A retirada do webhook não confirmou (`success` ausente)'
        );
      }
    },
    async perfil(igsid) {
      const r = await pedir(
        `${encodeURIComponent(igsid)}?fields=name,username,profile_pic`
      );
      return {
        nome: typeof r.name === 'string' && r.name ? r.name : null,
        username:
          typeof r.username === 'string' && r.username ? r.username : null,
        fotoUrl:
          typeof r.profile_pic === 'string' && r.profile_pic
            ? r.profile_pic
            : null,
      };
    },
  };
}

/** O que o token do login unificado alcança. */
export interface ContasDoToken {
  /** O portfólio do cliente (`/me?fields=client_business_id`); a doc manda guardá-lo com o token. */
  clientBusinessId: string | null;
  /** As contas que a pessoa compartilhou no login — pode vir mais de uma. */
  contas: { igUserId: string; username: string | null }[];
}

/** Uma página de contas basta: um escritório não compartilha 100 contas num login. */
const TETO_DE_CONTAS = 100;

/**
 * Login unificado: quem é o portfólio e quais contas do Instagram o token
 * alcança (`/me/assigned_instagram_accounts`, doc de 22/11/2026). O `next` da
 * paginação NÃO é seguido (URL vinda da resposta, com o token no cabeçalho):
 * passou de uma página, fica o registro.
 */
export async function lerContasDoToken(
  token: string,
  fetchFn: Fetch = fetch
): Promise<ContasDoToken> {
  const me = await pedirComToken(
    'unificado',
    token,
    'me?fields=client_business_id',
    {},
    fetchFn
  );
  const lista = await pedirComToken(
    'unificado',
    token,
    `me/assigned_instagram_accounts?fields=id,username&limit=${TETO_DE_CONTAS}`,
    {},
    fetchFn
  );
  if (ehObjeto(lista.paging) && typeof lista.paging.next === 'string') {
    console.warn(
      `[instagram/graph] o login trouxe mais de ${TETO_DE_CONTAS} contas: só a primeira página entra`
    );
  }
  const contas: ContasDoToken['contas'] = [];
  for (const item of Array.isArray(lista.data) ? lista.data : []) {
    // O id vem como texto; como número JSON perderia dígitos (passa de 2^53).
    if (!ehObjeto(item) || typeof item.id !== 'string' || !item.id) continue;
    contas.push({
      igUserId: item.id,
      username:
        typeof item.username === 'string' && item.username ? item.username : null,
    });
  }
  return {
    clientBusinessId:
      typeof me.client_business_id === 'string' && me.client_business_id
        ? me.client_business_id
        : null,
    contas,
  };
}

/**
 * O que a Meta diz ser uma recusa COMPROVADA do envio (nada saiu): resposta
 * 4xx. Rede, 5xx e 2xx sem `mid` são "pode ter saído". Nada além do HTTP
 * decide: o código da Meta varia, e chamar de recusa o que não é mandaria a
 * mensagem duas vezes.
 */
export function envioRecusado(err: unknown): boolean {
  return (
    err instanceof InstagramApiError &&
    err.status !== null &&
    err.status >= 400 &&
    err.status < 500
  );
}

export interface TokenRenovado {
  token: string;
  expiraEmSeg: number;
}

/**
 * `GET /refresh_access_token?grant_type=ig_refresh_token` (Fase 6). A doc de
 * 21/11/2026: o token longo precisa ter 24 h ou mais e ainda valer; o novo
 * vale 60 dias a partir de agora (`expires_in`, em segundos).
 *
 * ⚠️ A segunda exceção à regra do `Bearer`, como a troca do login
 * (`oauth.ts`): a doc só mostra o token na QUERY. Nenhum log imprime a URL, e
 * a mensagem de erro passa por `semSegredo`.
 *
 * Quem chama compara o vencimento NOVO com o antigo: 200 com o mesmo prazo não
 * é renovação.
 */
export async function renovarTokenLongo(
  token: string,
  fetchFn: Fetch = fetch
): Promise<TokenRenovado> {
  const u = new URL(`${INSTAGRAM_GRAPH}/refresh_access_token`);
  u.searchParams.set('grant_type', 'ig_refresh_token');
  u.searchParams.set('access_token', token);
  const url = u.toString();
  if (!doGraphDoInstagram(url)) {
    throw new InstagramApiError(
      'meta_error',
      'URL fora do graph.instagram.com'
    );
  }
  let resposta: Response;
  try {
    resposta = await fetchFn(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new InstagramApiError(
      'rede',
      semSegredo(e instanceof Error ? e.message : String(e), token)
    );
  }
  const r = await lerResposta(resposta, token);
  if (typeof r.access_token !== 'string' || !r.access_token) {
    throw new InstagramApiError(
      'meta_error',
      'A renovação veio sem access_token'
    );
  }
  const expiraEmSeg = Number(r.expires_in);
  if (!Number.isFinite(expiraEmSeg) || expiraEmSeg <= 0) {
    throw new InstagramApiError(
      'meta_error',
      'A renovação veio sem expires_in'
    );
  }
  return { token: r.access_token, expiraEmSeg };
}
