import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (v: string) => `cifrado(${v})`,
  decrypt: (v: string) => v,
}));

import { conectarContasDoUnificado } from './conectar-unificado';
import { InstagramApiError, type ClienteInstagram, type ContaDoToken } from './graph';

// ============================================================
// Um login unificado, várias contas: cada conta vira uma conexão, com o modo
// `unificado`, o portfólio e o App Secret principal (quem assina as entregas
// do app). A falha de uma conta não derruba as outras. Valores fictícios.
// ============================================================

afterEach(() => vi.restoreAllMocks());

/** `cb_channels` de mentira: insert → select → single; o 23505 para quem pedir. */
function bancoFalso(recusar: Set<string> = new Set()) {
  const inseridas: Record<string, unknown>[] = [];
  const db = {
    from() {
      let linha: Record<string, unknown> | null = null;
      const b = {
        insert(r: Record<string, unknown>) {
          linha = r;
          return b;
        },
        select() {
          return b;
        },
        eq() {
          return b;
        },
        async single() {
          if (linha && recusar.has(String(linha.ig_user_id))) {
            return { data: null, error: { code: '23505', message: 'duplicada' } };
          }
          inseridas.push(linha!);
          return { data: { id: `canal-${inseridas.length}`, ...linha }, error: null };
        },
        // A releitura depois do 23505: a conta é de OUTRA conta do CRM.
        async maybeSingle() {
          return { data: null, error: null };
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { db, inseridas };
}

function clienteFalso(falhar: Set<string>) {
  const assinadas: string[] = [];
  const criar = ((_token: string, _f: typeof fetch, conta?: ContaDoToken): ClienteInstagram => {
    const id = conta && conta.login === 'unificado' ? conta.igUserId : 'me';
    return {
      async me() {
        if (falhar.has(id)) {
          throw new InstagramApiError('sem_permissao', '(#200) acesso às mensagens desligado', 400);
        }
        return { igUserId: id, username: `conta_${id.slice(-1)}`, nome: null };
      },
      async tirarWebhooks() {},
      async assinarWebhooks() {
        assinadas.push(id);
      },
      async perfil() {
        return { nome: null, username: null, fotoUrl: null };
      },
      async enviarMensagem() {
        return { messageId: 'x' };
      },
    };
  }) as unknown as Parameters<typeof conectarContasDoUnificado>[2];
  return { criar, assinadas };
}

const BASE = {
  accountId: 'conta-1',
  userId: 'membro-1',
  appSecret: 'segredoPrincipalFicticio',
  token: 'EAAtokenFicticio',
  expiraEmSeg: null,
};

describe('conectarContasDoUnificado', () => {
  it('cada conta vira uma conexão do unificado, com o portfólio e o segredo do app', async () => {
    const { db, inseridas } = bancoFalso();
    const { criar, assinadas } = clienteFalso(new Set());
    const r = await conectarContasDoUnificado(
      db,
      {
        ...BASE,
        alcance: {
          clientBusinessId: '100000000000001',
          contas: [
            { igUserId: '17841400000000001', username: 'conta_1' },
            { igUserId: '17841400000000002', username: 'conta_2' },
          ],
        },
      },
      criar
    );
    expect(r.conectadas.map((c) => c.username)).toEqual(['conta_1', 'conta_2']);
    expect(r.naoEntraram).toEqual([]);
    // Assina ANTES de gravar, conta por conta.
    expect(assinadas).toEqual(['17841400000000001', '17841400000000002']);
    expect(inseridas[0]).toMatchObject({
      kind: 'instagram',
      ig_user_id: '17841400000000001',
      ig_login: 'unificado',
      ig_client_business_id: '100000000000001',
      ig_app_secret: 'cifrado(segredoPrincipalFicticio)',
      access_token: 'cifrado(EAAtokenFicticio)',
      // O token do usuário do sistema não vence: sem validade, a renovação o pula.
      ig_token_expires_at: null,
      is_default: false,
    });
  });

  it('pela central (U-3): a conexão nasce `central`, com o segredo das entregas, e o webhook não é assinado de novo', async () => {
    const { db, inseridas } = bancoFalso();
    const { criar, assinadas } = clienteFalso(new Set());
    const r = await conectarContasDoUnificado(
      db,
      {
        ...BASE,
        appSecret: 'segredoDasEntregasFicticio',
        alcance: { clientBusinessId: null, contas: [{ igUserId: '17841400000000001', username: 'conta_1' }] },
        login: 'central',
        assinar: false,
      },
      criar
    );
    expect(r.conectadas).toHaveLength(1);
    expect(assinadas).toEqual([]);
    expect(inseridas[0]).toMatchObject({
      ig_login: 'central',
      ig_app_secret: 'cifrado(segredoDasEntregasFicticio)',
    });
  });

  it('a conta que a Meta recusa fica de fora, e as outras entram', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db } = bancoFalso();
    const { criar } = clienteFalso(new Set(['17841400000000001']));
    const r = await conectarContasDoUnificado(
      db,
      {
        ...BASE,
        alcance: {
          clientBusinessId: null,
          contas: [
            { igUserId: '17841400000000001', username: 'conta_1' },
            { igUserId: '17841400000000002', username: 'conta_2' },
          ],
        },
      },
      criar
    );
    expect(r.conectadas.map((c) => c.username)).toEqual(['conta_2']);
    expect(r.naoEntraram).toEqual([
      { conta: '@conta_1', igUserId: '17841400000000001', motivo: 'meta', detalhe: '(#200) acesso às mensagens desligado' },
    ]);
  });

  it('conta já conectada em OUTRA conta do CRM é recusa, com o @', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = bancoFalso(new Set(['17841400000000001']));
    const { criar } = clienteFalso(new Set());
    const r = await conectarContasDoUnificado(
      db,
      {
        ...BASE,
        alcance: { clientBusinessId: null, contas: [{ igUserId: '17841400000000001', username: null }] },
      },
      criar
    );
    expect(r.conectadas).toEqual([]);
    expect(r.naoEntraram).toEqual([{ conta: '@conta_1', igUserId: '17841400000000001', motivo: 'outra_conta', detalhe: null }]);
  });

  it('prazo medido vira vencimento gravado', async () => {
    const { db, inseridas } = bancoFalso();
    const { criar } = clienteFalso(new Set());
    await conectarContasDoUnificado(
      db,
      {
        ...BASE,
        expiraEmSeg: 3600,
        alcance: { clientBusinessId: null, contas: [{ igUserId: '17841400000000003', username: 'c' }] },
      },
      criar
    );
    expect(typeof inseridas[0].ig_token_expires_at).toBe('string');
  });
});
