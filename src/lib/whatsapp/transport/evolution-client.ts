// ============================================================
// Evolution API (v2) low-level HTTP client.
//
// Evolution is the self-hosted, Baileys-based unofficial WhatsApp API
// (github.com/evolution-foundation/evolution-api). This client is the
// direct analogue of meta-api.ts's per-helper `fetch`, but for one
// self-hosted host instead of graph.facebook.com.
//
// URL layout is `${baseUrl}/${controller}/${action}/${instance}`, e.g.
//   POST {baseUrl}/message/sendText/{instance}
//   GET  {baseUrl}/instance/connectionState/{instance}
//
// Auth is a single custom header `apikey` (NOT Authorization/Bearer).
// Two tiers of key exist server-side:
//   * GLOBAL key (server env AUTHENTICATION_API_KEY) — provisioning:
//     /instance/create, /instance/fetchInstances.
//   * INSTANCE key (the `hash` returned at instance creation) — scoped
//     to one instance's /message, /chat, /webhook calls.
// Construct with the instance key for messaging so a leak is contained;
// use the global key only for provisioning. The header is identical
// either way — the caller picks which key to pass.
//
// Recipient `number` for sends is digits only (DDI+DDD+number, e.g.
// 5511999999999) — no `+`, spaces, or `@s.whatsapp.net`. The JID form
// appears only inside inbound webhook payloads.
// ============================================================

export interface EvolutionClientConfig {
  /** Evolution server origin, no trailing slash, e.g. `https://evo.example.com`. */
  baseUrl: string;
  /** The `apikey` header value — instance key for messaging, global key for provisioning. */
  apikey: string;
  /** Instance name (the `{instance}` path segment). */
  instance: string;
}

/** A Baileys message key, as it appears in webhook payloads and reaction/read calls. */
export interface EvolutionMessageKey {
  remoteJid: string;
  fromMe: boolean;
  id: string;
  participant?: string;
}

interface EvolutionErrorBody {
  message?: string | string[];
  error?: string;
  response?: { message?: string | string[] };
}

/**
 * Resposta do apagar-para-todos. A Evolution devolve a MENSAGEM DE
 * REVOGAÇÃO que acabou de enviar: um `protocolMessage` cujo `key.id` é o id
 * da mensagem ALVO. É só isso que dá para verificar do nosso lado.
 */
export interface EvolutionRevokeResponse {
  message?: {
    protocolMessage?: { key?: { id?: string }; type?: string | number };
  } | null;
  key?: { id?: string };
}

/** A send returns the created message; we only need its `key.id`. */
interface EvolutionSendResponse {
  key?: { id?: string; remoteJid?: string; fromMe?: boolean };
  messageId?: string;
}

export class EvolutionApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'EvolutionApiError';
    this.status = status;
  }
}

/**
 * Teto para uma chamada normal (envio, estado, webhook). Folgado o bastante
 * para a Evolution acordar sob carga, curto o bastante para caber várias
 * vezes no `maxDuration` de uma rota.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Mídia é a exceção nos DOIS sentidos: a Evolution move um binário inteiro
 * antes de responder, então demora legitimamente mais que o resto. Os dois
 * tetos abaixo existem porque os orçamentos de quem chama são diferentes —
 * não são o mesmo número escrito duas vezes.
 *
 * ENTRADA (`getBase64FromMediaMessage`): a Evolution baixa do WhatsApp e
 * devolve base64. Roda dentro do `after()` do webhook, que tem
 * `maxDuration = 60` para o lote inteiro; por isso o teto é o menor dos dois.
 */
const MEDIA_DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * SAÍDA (`sendMedia` / `sendWhatsAppAudio`): mais pesado que a entrada — a
 * Evolution BAIXA o arquivo do nosso bucket (até 16 MB) e SOBE para o
 * WhatsApp na mesma requisição, sendo o upload o sentido tipicamente mais
 * lento numa VPS. A rota de envio não declara `maxDuration`, então aqui cabe
 * mais folga.
 *
 * ⚠️ O valor é deliberadamente FOLGADO, e não o "aperto certo". Abortar do
 * nosso lado NÃO cancela a Evolution: ela conclui, o cliente RECEBE o
 * arquivo, e o CRM devolve erro sem gravar mensagem nenhuma — o operador
 * reenvia e o cliente recebe duas vezes. Um teto apertado aqui troca uma
 * espera longa por corrupção silenciosa do histórico, que é bem pior.
 *
 * Antes não havia teto algum (na prática o padrão do undici, ~300s). 90s
 * cobre com folga qualquer transferência legítima de 16 MB e ainda impede o
 * caso que motivou o timeout: servidor mudo prendendo a invocação para
 * sempre.
 */
const MEDIA_SEND_TIMEOUT_MS = 90_000;

/**
 * Validate the Evolution base URL. Both http and https are accepted:
 * Evolution is expected to be co-located with the CRM on the same VPS
 * and reached over the loopback / private interface (e.g.
 * `http://127.0.0.1:8080`), so the apikey and message content never
 * leave the host and plain HTTP is fine. Only the CRM's own public
 * origin (crm.cbadvogados.com) needs TLS. If you ever expose Evolution
 * across an untrusted network, put it behind HTTPS.
 */
export function assertValidBaseUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new EvolutionApiError(`Invalid Evolution base URL: ${baseUrl}`, 400);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new EvolutionApiError(
      `Evolution base URL must be http:// or https:// (got "${parsed.protocol}//").`,
      400
    );
  }
}

export class EvolutionClient {
  private readonly baseUrl: string;
  private readonly apikey: string;
  private readonly instance: string;

  constructor(config: EvolutionClientConfig) {
    // Strip trailing slashes so path joins never double up.
    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    assertValidBaseUrl(baseUrl);
    this.baseUrl = baseUrl;
    this.apikey = config.apikey;
    this.instance = config.instance;
  }

  /**
   * POST/GET `${baseUrl}/${path}/${instance}`. `path` is the
   * controller/action pair, e.g. `message/sendText`. When `appendInstance`
   * is false the instance segment is omitted (used by global endpoints
   * like `instance/fetchInstances`).
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    appendInstance = true,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<T> {
    const url = appendInstance
      ? `${this.baseUrl}/${path}/${encodeURIComponent(this.instance)}`
      : `${this.baseUrl}/${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          apikey: this.apikey,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        // Sem isto o `fetch` espera para sempre. No webhook de entrada, que
        // roda dentro de um `after()` com `maxDuration`, um servidor mudo
        // consumia o orçamento inteiro e a plataforma matava a execução —
        // levando junto trabalho já pendente. Falhar rápido é melhor.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // 504: o problema é do outro lado, não do nosso pedido.
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new EvolutionApiError(
          `Evolution não respondeu em ${timeoutMs}ms (${method} ${path})`,
          504
        );
      }
      throw err;
    }

    if (!response.ok) {
      await this.throwError(response);
    }
    // Some endpoints (e.g. markMessageAsRead) return an empty body.
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  private async throwError(response: Response): Promise<never> {
    let message = `Evolution API error: ${response.status}`;
    try {
      const data = (await response.json()) as EvolutionErrorBody;
      const raw = data.response?.message ?? data.message ?? data.error;
      if (Array.isArray(raw)) message = raw.join('; ');
      else if (raw) message = raw;
    } catch {
      // body wasn't JSON — keep the status fallback
    }
    throw new EvolutionApiError(message, response.status);
  }

  private extractId(res: EvolutionSendResponse): string {
    const id = res.key?.id ?? res.messageId;
    if (!id) {
      throw new EvolutionApiError('Evolution send returned no message id', 502);
    }
    return id;
  }

  // ----------------------------------------------------------
  // Messaging (instance key)
  // ----------------------------------------------------------

  async sendText(args: {
    number: string;
    text: string;
    quoted?: EvolutionMessageKey;
  }): Promise<string> {
    const res = await this.request<EvolutionSendResponse>(
      'POST',
      'message/sendText',
      {
        number: args.number,
        text: args.text,
        ...(args.quoted ? { quoted: { key: args.quoted } } : {}),
      }
    );
    return this.extractId(res);
  }

  async sendMedia(args: {
    number: string;
    mediatype: 'image' | 'video' | 'document';
    media: string;
    mimetype?: string;
    caption?: string;
    fileName?: string;
    quoted?: EvolutionMessageKey;
  }): Promise<string> {
    const res = await this.request<EvolutionSendResponse>(
      'POST',
      'message/sendMedia',
      {
        number: args.number,
        mediatype: args.mediatype,
        media: args.media,
        ...(args.mimetype ? { mimetype: args.mimetype } : {}),
        ...(args.caption ? { caption: args.caption } : {}),
        ...(args.fileName ? { fileName: args.fileName } : {}),
        ...(args.quoted ? { quoted: { key: args.quoted } } : {}),
      },
      true,
      MEDIA_SEND_TIMEOUT_MS
    );
    return this.extractId(res);
  }

  /** WhatsApp voice-note / PTT. Separate endpoint from sendMedia. */
  async sendAudio(args: {
    number: string;
    audio: string;
    quoted?: EvolutionMessageKey;
  }): Promise<string> {
    const res = await this.request<EvolutionSendResponse>(
      'POST',
      'message/sendWhatsAppAudio',
      {
        number: args.number,
        audio: args.audio,
        ...(args.quoted ? { quoted: { key: args.quoted } } : {}),
      },
      true,
      MEDIA_SEND_TIMEOUT_MS
    );
    return this.extractId(res);
  }

  /** Empty `reaction` removes an existing reaction. */
  async sendReaction(args: {
    key: EvolutionMessageKey;
    reaction: string;
  }): Promise<string> {
    const res = await this.request<EvolutionSendResponse>(
      'POST',
      'message/sendReaction',
      { key: args.key, reaction: args.reaction }
    );
    return this.extractId(res);
  }

  async markMessageAsRead(readMessages: EvolutionMessageKey[]): Promise<void> {
    await this.request('POST', 'chat/markMessageAsRead', { readMessages });
  }

  /**
   * Apaga a mensagem para TODOS — o "apagar para todos" do WhatsApp.
   *
   * ⚠️ Só funciona dentro do prazo do WhatsApp (hoje ~2 dias); passado isso
   * a Evolution recusa. O prazo é regra do WhatsApp, não nossa, e quem chama
   * deve esconder o botão em vez de deixar o operador tentar e receber erro.
   *
   * É DELETE COM CORPO — é assim que o roteador da Evolution registra a rota.
   *
   * ⚠️ DEVOLVE O CORPO DA RESPOSTA, e quem chama precisa olhar para ele.
   * A Evolution responde 2xx assim que escreve o pacote no socket; isso
   * significa "aceitei o pedido", NUNCA "a mensagem sumiu do aparelho do
   * destinatário" — o WhatsApp não emite confirmação de revogação. Tratar o
   * 2xx como sucesso foi exatamente o que fez o CRM marcar "Apagada" em
   * mensagens que seguiam íntegras no celular do cliente.
   *
   * O máximo que a resposta permite verificar é se a revogação que a
   * Evolution montou aponta para a chave que pedimos. Isso pega o caso de
   * ela responder sobre OUTRA mensagem — e só isso. Resposta coerente NÃO
   * significa que o aparelho do contato aplicou a revogação; a confirmação
   * é o webhook `messages.delete` voltar.
   */
  async deleteMessageForEveryone(
    key: EvolutionMessageKey,
  ): Promise<EvolutionRevokeResponse> {
    return this.request<EvolutionRevokeResponse>(
      'DELETE',
      'chat/deleteMessageForEveryone',
      {
        id: key.id,
        remoteJid: key.remoteJid,
        fromMe: key.fromMe,
        ...(key.participant ? { participant: key.participant } : {}),
      },
    );
  }

  /**
   * Edita uma mensagem já enviada.
   *
   * ⚠️ O WhatsApp só permite editar por ~15 minutos, e só mensagem PRÓPRIA.
   * Mesma observação do apagar: o prazo é deles, e a interface deve refletir
   * isso escondendo a ação em vez de produzir um erro.
   */
  async updateMessage(args: {
    number: string;
    key: EvolutionMessageKey;
    text: string;
  }): Promise<void> {
    await this.request('POST', 'chat/updateMessage', {
      number: args.number,
      key: args.key,
      text: args.text,
    });
  }

  async sendPresence(args: {
    number: string;
    presence: 'composing' | 'recording' | 'paused';
    delay?: number;
  }): Promise<void> {
    await this.request('POST', 'chat/sendPresence', {
      number: args.number,
      presence: args.presence,
      ...(args.delay ? { delay: args.delay } : {}),
    });
  }

  /**
   * Decode an inbound media message to base64 on demand. `message` is the
   * webhook `data` message object. `convertToMp4` optionally transcodes
   * audio/video.
   */
  async getBase64FromMediaMessage(args: {
    /**
     * O registro COMPLETO do webhook (`{key, message, …}`). A Evolution faz
     * `m?.message ? m : getMessage(m.key)` — mandar só o conteúdo interno
     * quebra os dois caminhos e devolve 400.
     */
    message: unknown;
    convertToMp4?: boolean;
  }): Promise<{ base64: string; mimetype: string; fileName?: string }> {
    return this.request(
      'POST',
      'chat/getBase64FromMediaMessage',
      {
        message: args.message,
        ...(args.convertToMp4 ? { convertToMp4: true } : {}),
      },
      true,
      MEDIA_DOWNLOAD_TIMEOUT_MS
    );
  }

  // ----------------------------------------------------------
  // Webhook + instance lifecycle (instance key, except where noted)
  // ----------------------------------------------------------

  /**
   * Configure the per-instance webhook. v2 wraps the config in a
   * `{ webhook: {...} }` object. Event names here are UPPERCASE_SNAKE_CASE
   * (the emitted `event` field is lowercase dot-notation). Set an auth
   * header so the receiver can verify authenticity — Evolution does NOT
   * HMAC-sign webhooks.
   */
  async setWebhook(args: {
    url: string;
    events: string[];
    headers?: Record<string, string>;
    byEvents?: boolean;
    base64?: boolean;
  }): Promise<unknown> {
    return this.request('POST', 'webhook/set', {
      webhook: {
        enabled: true,
        url: args.url,
        byEvents: args.byEvents ?? false,
        base64: args.base64 ?? false,
        ...(args.headers ? { headers: args.headers } : {}),
        events: args.events,
      },
    });
  }

  async findWebhook(): Promise<unknown> {
    return this.request('GET', 'webhook/find');
  }

  /** `open` = connected/ready. */
  async connectionState(): Promise<{
    instance?: { state?: string };
    state?: string;
  }> {
    return this.request('GET', 'instance/connectionState');
  }

  /** Returns fresh pairing data `{ base64, code, pairingCode }` (QR). */
  async connect(): Promise<{
    base64?: string;
    code?: string;
    pairingCode?: string;
  }> {
    return this.request('GET', 'instance/connect');
  }

  async logout(): Promise<void> {
    await this.request('DELETE', 'instance/logout');
  }

  /** Remove the instance entirely (logs out first if connected). */
  async deleteInstance(): Promise<void> {
    await this.request('DELETE', 'instance/delete');
  }

  // ----------------------------------------------------------
  // Provisioning (GLOBAL key — construct the client with it)
  // ----------------------------------------------------------

  /**
   * Create a new Baileys instance. Response includes `hash` = the
   * instance's apikey — STORE IT (encrypted) as the per-instance key.
   * With `qrcode: true`, the response also carries a QR to render.
   */
  async createInstance(args: {
    instanceName: string;
    number?: string;
    qrcode?: boolean;
    token?: string;
    webhook?: {
      url: string;
      events: string[];
      headers?: Record<string, string>;
    };
  }): Promise<{
    hash?: string;
    instance?: { instanceName?: string; status?: string };
    qrcode?: { base64?: string; code?: string; pairingCode?: string };
  }> {
    return this.request(
      'POST',
      'instance/create',
      {
        instanceName: args.instanceName,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: args.qrcode ?? true,
        ...(args.number ? { number: args.number } : {}),
        ...(args.token ? { token: args.token } : {}),
        ...(args.webhook ? { webhook: args.webhook } : {}),
      },
      /* appendInstance */ false
    );
  }

  /**
   * `timeoutMs` opcional para a sonda de saúde: ela roda no caminho da tela
   * e a cada 30s, então o teto padrão de 15s a faria segurar o cabeçalho por
   * quinze segundos toda vez que o servidor engasgasse.
   */
  async fetchInstances(timeoutMs?: number): Promise<unknown[]> {
    return this.request('GET', 'instance/fetchInstances', undefined, false, timeoutMs);
  }
}
