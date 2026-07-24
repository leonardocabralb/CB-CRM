// ============================================================
// /api/cb/channels
//
//   GET  — lista os canais de WhatsApp da conta (sem segredos).
//   POST — cria um canal. body.kind='evolution' (padrão): nova instância no
//          servidor compartilhado + QR. body.kind='meta': assistente por token
//          (verify → register → subscribe), grava em cb_channels.
//
// Rota NOSSA (prefixo /api/cb/), fora de /api/whatsapp/ do upstream/Gabriel.
//
// MODELO (ver evolution-admin.ts): um servidor Evolution só para todo o CRM
// (env). Um canal Evolution adicional é uma instância nova nesse servidor —
// o operador só dá um rótulo; nada de URL/chave por canal.
//
// PRIMEIRO CANAL DA CONTA (greenfield): além de gravar em cb_channels como
// padrão, faz ESCRITA DUPLA em whatsapp_config, para os ~20 pontos herdados
// que fazem `.eq('account_id').single()` continuarem achando o número. Contas
// que já têm um padrão (a 901 espelhou de whatsapp_config) recebem o novo
// canal como NÃO-padrão.
// ============================================================

import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { encrypt } from '@/lib/whatsapp/encryption';
import {
  listChannels,
  countChannels,
  CB_CHANNEL_SAFE_COLUMNS,
} from '@/lib/cb-channels/repo';
import {
  buildChannelInstanceName,
  deleteChannelInstance,
  evolutionWebhookConfig,
  provisionChannelInstance,
} from '@/lib/cb-channels/evolution-admin';
import { provisionMetaChannel } from '@/lib/cb-channels/meta-admin';

const MAX_LABEL_LEN = 60;

type AdminCtx = Awaited<ReturnType<typeof requireRole>>;

function asStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function asStrOrNull(v: unknown): string | null {
  const s = asStr(v);
  return s || null;
}

/** Criar canal cria estado remoto (instância + webhook) — mais apertado
 *  que uma ação de admin comum. */
const CREATE_LIMIT = { limit: 10, windowMs: 60_000 };

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const channels = await listChannels(ctx.supabase, ctx.accountId);
    return NextResponse.json({ channels });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(`cb:channelCreate:${ctx.userId}`, CREATE_LIMIT);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const label = asStr(body?.label);
    // 'evolution' por padrão (o painel antigo mandava só { label }).
    const kind = body?.kind === 'meta' ? 'meta' : 'evolution';

    if (!label) {
      return NextResponse.json(
        { error: 'Dê um nome ao canal (ex.: "Comercial").' },
        { status: 400 },
      );
    }
    if (label.length > MAX_LABEL_LEN) {
      return NextResponse.json(
        { error: `O nome do canal deve ter no máximo ${MAX_LABEL_LEN} caracteres.` },
        { status: 400 },
      );
    }

    // Conta os canais ANTES de criar qualquer estado remoto (instância
    // Evolution / registro na Meta). Se o banco não estiver pronto (tabela
    // cb_channels ausente na janela pré-migration) ou a leitura falhar,
    // retornamos SEM ter tocado em nada externo.
    let existingCount: number;
    try {
      existingCount = await countChannels(ctx.supabase, ctx.accountId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const tableMissing = /cb_channels|does not exist|42P01/i.test(message);
      console.error('[cb/channels] contagem falhou (nada provisionado):', message);
      return NextResponse.json(
        {
          error: tableMissing
            ? 'Os canais ainda não estão disponíveis — aplique a migration 901 no banco.'
            : 'Não foi possível preparar o canal. Tente novamente.',
        },
        { status: tableMissing ? 503 : 500 },
      );
    }
    const isDefault = existingCount === 0;

    // ---- Canal Meta (API oficial): assistente por token ----
    if (kind === 'meta') {
      return createMetaChannel(ctx, {
        label,
        isDefault,
        phoneNumberId: asStr(body?.phone_number_id),
        wabaId: asStrOrNull(body?.waba_id),
        accessToken: asStr(body?.access_token),
        verifyToken: asStrOrNull(body?.verify_token),
        pin: asStrOrNull(body?.pin),
      });
    }

    // ---- Canal Evolution (QR): instância nova no servidor compartilhado ----
    // Webhook global + nome de instância único.
    let webhook;
    try {
      webhook = evolutionWebhookConfig(new URL(request.url).origin);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Evolution não configurada.' },
        { status: 500 },
      );
    }

    const instanceName = buildChannelInstanceName(ctx.accountId);

    // Só agora cria estado remoto. Servidor fora do ar / mal configurado
    // vira 502 sem ter tocado o banco.
    let result;
    try {
      result = await provisionChannelInstance({
        accountId: ctx.accountId,
        instanceName,
        webhook,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      console.error('[cb/channels] provisionamento falhou:', message);
      return NextResponse.json(
        { error: `Erro da Evolution: ${message}` },
        { status: 502 },
      );
    }

    const connected = result.state === 'open';
    const nowIso = new Date().toISOString();

    const { data: channel, error } = await ctx.supabase
      .from('cb_channels')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        kind: 'evolution',
        label,
        is_default: isDefault,
        status: connected ? 'connected' : 'connecting',
        connected_at: connected ? nowIso : null,
        server_url: result.baseUrl,
        instance_name: result.instanceName,
        api_key: encrypt(result.instanceApiKey),
      })
      .select(CB_CHANNEL_SAFE_COLUMNS)
      .single();

    if (error) {
      // Persistência falhou DEPOIS de provisionar (ex.: corrida do índice
      // único de canal-padrão, 23505) — remove a instância órfã do servidor
      // compartilhado antes de responder. deleteChannelInstance é best-effort
      // (engole os próprios erros).
      await deleteChannelInstance(instanceName);
      console.error('[cb/channels] erro ao inserir canal:', error.code, error.message);
      const hint =
        error.code === '23505'
          ? ' Outro canal padrão foi criado ao mesmo tempo — tente novamente.'
          : '';
      return NextResponse.json(
        { error: `Não foi possível salvar o canal.${hint}` },
        { status: 500 },
      );
    }

    // Escrita dupla do PADRÃO (só no primeiro canal / conta greenfield).
    if (isDefault) {
      const { error: wcErr } = await ctx.supabase.from('whatsapp_config').upsert(
        {
          account_id: ctx.accountId,
          user_id: ctx.userId,
          provider: 'evolution',
          base_url: result.baseUrl,
          instance_name: result.instanceName,
          api_key: encrypt(result.instanceApiKey),
          instance_state: result.state,
          status: connected ? 'connected' : 'disconnected',
          connected_at: connected ? nowIso : null,
          last_connected_at: connected ? nowIso : null,
          updated_at: nowIso,
        },
        { onConflict: 'account_id' },
      );
      if (wcErr) {
        // Não aborta: o canal foi criado. Mas avisa — o espelho é o que o
        // código herdado lê, então a dessincronia precisa ser vista.
        console.error(
          '[cb/channels] escrita dupla em whatsapp_config falhou (canal criado):',
          wcErr.message,
        );
      }
    }

    return NextResponse.json(
      { channel, qr: result.qrBase64 ?? null, pairingCode: result.pairingCode ?? null },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

// ============================================================
// Criação de canal Meta (API oficial). Espelha o pipeline de
// /api/whatsapp/config (verify → register → subscribe), gravando em
// cb_channels em vez de whatsapp_config. NÃO cria estado remoto irreversível:
// register/subscribe são idempotentes na Meta, então uma falha de insert não
// deixa órfão (diferente da instância Evolution).
// ============================================================
async function createMetaChannel(
  ctx: AdminCtx,
  args: {
    label: string;
    isDefault: boolean;
    phoneNumberId: string;
    wabaId: string | null;
    accessToken: string;
    verifyToken: string | null;
    pin: string | null;
  },
): Promise<NextResponse> {
  const { label, isDefault, phoneNumberId, wabaId, accessToken, verifyToken, pin } =
    args;

  if (!accessToken || !phoneNumberId) {
    return NextResponse.json(
      { error: 'Access Token e Phone Number ID são obrigatórios.' },
      { status: 400 },
    );
  }
  if (pin && !/^\d{6}$/.test(pin)) {
    return NextResponse.json(
      { error: 'O PIN deve ter exatamente 6 dígitos.' },
      { status: 400 },
    );
  }

  // Valida na Meta ANTES de gravar (verify lança → 400). register/subscribe
  // são best-effort dentro de provisionMetaChannel.
  let prov;
  try {
    prov = await provisionMetaChannel({
      phoneNumberId,
      wabaId,
      accessToken,
      pin,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json(
      { error: `Erro da Meta: ${message}` },
      { status: 400 },
    );
  }

  const registrationError = prov.registrationError;
  const nowIso = new Date().toISOString();
  const encAccess = encrypt(accessToken);
  const encVerify = verifyToken ? encrypt(verifyToken) : null;

  const { data: channel, error } = await ctx.supabase
    .from('cb_channels')
    .insert({
      account_id: ctx.accountId,
      created_by: ctx.userId,
      kind: 'meta',
      label,
      is_default: isDefault,
      display_phone:
        (prov.phoneInfo as { display_phone_number?: string } | null)
          ?.display_phone_number ?? null,
      status: registrationError ? 'disconnected' : 'connected',
      connected_at: registrationError ? null : nowIso,
      last_error: registrationError,
      phone_number_id: phoneNumberId,
      waba_id: wabaId,
      access_token: encAccess,
      verify_token: encVerify,
    })
    .select(CB_CHANNEL_SAFE_COLUMNS)
    .single();

  if (error) {
    console.error('[cb/channels] erro ao inserir canal Meta:', error.code, error.message);
    // O índice único global de phone_number_id (901) barra número repetido.
    const claimed = error.code === '23505';
    return NextResponse.json(
      {
        error: claimed
          ? 'Esse número Meta já está vinculado a uma conexão.'
          : 'Não foi possível salvar o canal.',
      },
      { status: claimed ? 409 : 500 },
    );
  }

  // Escrita dupla do PADRÃO (só no primeiro canal / conta greenfield): o
  // espelho whatsapp_config é o que o código herdado (envio, mídia, templates)
  // lê. provider='meta'.
  if (isDefault) {
    const { error: wcErr } = await ctx.supabase.from('whatsapp_config').upsert(
      {
        account_id: ctx.accountId,
        user_id: ctx.userId,
        provider: 'meta',
        phone_number_id: phoneNumberId,
        waba_id: wabaId,
        access_token: encAccess,
        verify_token: encVerify,
        status: registrationError ? 'disconnected' : 'connected',
        connected_at: registrationError ? null : nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'account_id' },
    );
    if (wcErr) {
      console.error(
        '[cb/channels] escrita dupla Meta em whatsapp_config falhou (canal criado):',
        wcErr.message,
      );
    }
  }

  return NextResponse.json(
    {
      channel,
      registration: {
        registered: prov.registeredAt != null,
        skipped: prov.registrationSkipped,
        error: registrationError,
      },
    },
    { status: 201 },
  );
}
