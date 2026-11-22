import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// O login pela central do Instagram (U-3), neste CRM: com as
// `INSTAGRAM_CENTRAL_*` no ambiente, o começo vai à central (sem ler o app
// da conta), e a volta troca o tíquete pelo token e grava cada conta como
// conexão `central`, com o segredo das entregas da central e sem assinar o
// webhook de novo. O `state` e o nonce valem como sempre. Valores fictícios.
// ============================================================

const CONTA = '00000000-0000-4000-8000-00000000c0a1';
const ADMIN = '00000000-0000-4000-8000-0000000000ad';
const INSTANCIA = '00000000-0000-4000-8000-0000000000a1';
const CHAVE = 'ChaveFicticiaDaInstancia0123456789abcdefghi';

const h = vi.hoisted(() => ({
  /** O cliente da SESSÃO que o `requireRole` devolve: a escrita vai por ele. */
  sessao: { sou: 'a sessão' },
  appLido: 0,
  resgates: [] as string[],
  resgate: null as null | (() => Promise<unknown>),
  conectando: null as null | { db: unknown; args: Record<string, unknown> },
  desconectadas: [] as string[],
  /** As contas que não entram no CRM (a gravação falhou). */
  naoEntram: [] as string[],
  /** As que já são conexão de alguma conta deste CRM (`cb_channels`). */
  existentes: [] as string[],
}));

vi.mock('@/lib/auth/account', async (original) => ({
  ...(await original<typeof import('@/lib/auth/account')>()),
  requireRole: vi.fn(async () => ({
    userId: '00000000-0000-4000-8000-0000000000ad',
    accountId: '00000000-0000-4000-8000-00000000c0a1',
    role: 'admin',
    supabase: h.sessao,
  })),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => null,
  RATE_LIMITS: { adminAction: {} },
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const cadeia: Record<string, unknown> = {
        select: () => cadeia,
        eq: () => cadeia,
        in: () => cadeia,
        then: (ok: (v: unknown) => unknown) =>
          ok({ data: h.existentes.map((ig_user_id) => ({ ig_user_id })), error: null }),
      };
      return cadeia;
    },
  }),
}));
vi.mock('@/lib/instagram/app', async (original) => ({
  ...(await original<typeof import('@/lib/instagram/app')>()),
  lerAppDoInstagram: vi.fn(async () => {
    h.appLido += 1;
    return null;
  }),
}));
vi.mock('@/lib/instagram/central/cliente', async (original) => {
  const real = await original<typeof import('@/lib/instagram/central/cliente')>();
  return {
    ...real,
    resgatarNaCentral: vi.fn(async (_c: unknown, tiquete: string) => {
      h.resgates.push(tiquete);
      return h.resgate!();
    }),
    avisarDesconexao: vi.fn(async (_c: unknown, ig: string) => {
      h.desconectadas.push(ig);
      return true;
    }),
  };
});
vi.mock('@/lib/instagram/conectar-unificado', () => ({
  conectarContasDoUnificado: vi.fn(async (db: unknown, args: Record<string, unknown>) => {
    h.conectando = { db, args };
    const contas = (args.alcance as { contas: { igUserId: string; username: string | null }[] }).contas;
    return {
      conectadas: contas
        .filter((c) => !h.naoEntram.includes(c.igUserId))
        .map((c) => ({ canalId: `canal-${c.igUserId}`, username: c.username ?? c.igUserId, reconectado: false })),
      naoEntraram: contas
        .filter((c) => h.naoEntram.includes(c.igUserId))
        .map((c) => ({ conta: `@${c.username}`, igUserId: c.igUserId, motivo: 'erro', detalhe: null })),
    };
  }),
}));

import { CentralError } from '@/lib/instagram/central/cliente';
import { segredoDoRepasse } from '@/lib/instagram/central/chave';
import { COOKIE_DO_OAUTH, criarEstado } from '@/lib/instagram/oauth';

import { GET as app } from '../app/route';
import { GET as callback } from './callback/route';
import { GET as start } from './start/route';

const destino = (r: Response) => new URL(r.headers.get('location') ?? '');

beforeEach(() => {
  vi.stubEnv('INSTAGRAM_CENTRAL_URL', 'https://central.exemplo.com.br');
  vi.stubEnv('INSTAGRAM_CENTRAL_INSTANCIA', INSTANCIA);
  vi.stubEnv('INSTAGRAM_CENTRAL_CHAVE', CHAVE);
  h.appLido = 0;
  h.resgates = [];
  h.resgate = async () => ({
    versao: 1,
    token: 'EAAtokenFicticio',
    expiraEmSeg: null,
    clientBusinessId: '300000000000003',
    contas: [
      { igUserId: '17841400000000001', username: 'principal' },
      { igUserId: '17841400000000002', username: 'segunda' },
    ],
    recusadas: ['@alheia'],
    falharam: [],
  });
  h.conectando = null;
  h.desconectadas = [];
  h.naoEntram = [];
  h.existentes = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function voltar(params: string, comCookie = true) {
  const nonce = 'nonce-de-teste';
  const estado = criarEstado({ accountId: CONTA, userId: ADMIN, nonce });
  return callback(
    new NextRequest(
      `http://localhost:3000/api/cb/instagram/oauth/callback?${params}&state=${encodeURIComponent(estado)}`,
      comCookie ? { headers: { cookie: `${COOKIE_DO_OAUTH}=${nonce}` } } : {},
    ),
  );
}

describe('o começo pela central', () => {
  it('vai à central com a instância, o retorno e o state; o app da conta não é lido', async () => {
    const r = await start(new NextRequest('http://localhost:3000/api/cb/instagram/oauth/start'));
    const u = destino(r);
    expect(u.origin + u.pathname).toBe('https://central.exemplo.com.br/api/cb/instagram/central/entrar');
    expect(u.searchParams.get('instancia')).toBe(INSTANCIA);
    expect(u.searchParams.get('retorno')).toBe('http://localhost:3000/api/cb/instagram/oauth/callback');
    expect(u.searchParams.get('estado')).toBeTruthy();
    expect(u.toString()).not.toContain(CHAVE);
    expect(h.appLido).toBe(0);
    expect(r.headers.get('set-cookie')).toContain(COOKIE_DO_OAUTH);
  });

  it('a central pela metade no ambiente: volta com erro, sem sair do CRM', async () => {
    vi.stubEnv('INSTAGRAM_CENTRAL_CHAVE', 'curta');
    const u = destino(await start(new NextRequest('http://localhost:3000/api/cb/instagram/oauth/start')));
    expect(u.pathname).toBe('/settings');
    expect(u.searchParams.get('motivo')).toBe('erro');
    expect(h.appLido).toBe(0);
  });

  it('sem a central no ambiente, o começo segue pelo app da conta', async () => {
    vi.stubEnv('INSTAGRAM_CENTRAL_URL', '');
    const u = destino(await start(new NextRequest('http://localhost:3000/api/cb/instagram/oauth/start')));
    // O dublê do app devolve "sem app": o caminho de sempre.
    expect(u.searchParams.get('motivo')).toBe('sem_app');
    expect(h.appLido).toBe(1);
  });
});

describe('a volta pela central', () => {
  it('o tíquete vira conexões `central`, com o segredo das entregas e sem assinar o webhook de novo', async () => {
    const u = destino(await voltar(`tiquete=${'t'.repeat(43)}`));
    expect(h.resgates).toEqual(['t'.repeat(43)]);
    expect(h.conectando?.args).toMatchObject({
      accountId: CONTA,
      userId: ADMIN,
      appSecret: segredoDoRepasse(CHAVE),
      token: 'EAAtokenFicticio',
      login: 'central',
      assinar: false,
    });
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      tab: 'channels',
      instagram: 'conectado',
      canal: 'canal-17841400000000001',
      username: 'principal',
      outras: '1',
      falharam: '@alheia',
    });
    // O webhook é o da central: o diálogo dele nunca abre.
    expect(u.searchParams.get('primeira')).toBeNull();
    expect(h.appLido).toBe(0);
  });

  it('a conexão é gravada pelo cliente da SESSÃO, como no unificado deste CRM', async () => {
    await voltar(`tiquete=${'t'.repeat(43)}`);
    expect(h.conectando?.db).toBe(h.sessao);
  });

  it('sem o nonce do cookie, o tíquete nem é resgatado', async () => {
    const u = destino(await voltar(`tiquete=${'t'.repeat(43)}`, false));
    expect(u.searchParams.get('motivo')).toBe('estado');
    expect(h.resgates).toEqual([]);
  });

  it('com a central ligada, a volta com `code` (sem tíquete) é "comece de novo"', async () => {
    const u = destino(await voltar('code=codigo-ficticio'));
    expect(u.searchParams.get('motivo')).toBe('estado');
    expect(h.resgates).toEqual([]);
    expect(h.appLido).toBe(0);
  });

  it('o erro da central vira o motivo da tela, com o detalhe', async () => {
    const u = destino(await voltar('erro=outro_escritorio&detalhe=%40alheia'));
    expect(u.searchParams.get('motivo')).toBe('outro_escritorio');
    expect(u.searchParams.get('detalhe')).toBe('@alheia');
    expect(destino(await voltar('erro=inventado')).searchParams.get('motivo')).toBe('erro');
    expect(h.resgates).toEqual([]);
  });

  it('tíquete vencido ou usado: "comece de novo"; central fora: o motivo dela', async () => {
    h.resgate = async () => {
      throw new CentralError('tiquete_invalido', 'venceu');
    };
    expect(destino(await voltar(`tiquete=${'t'.repeat(43)}`)).searchParams.get('motivo')).toBe('estado');
    h.resgate = async () => {
      throw new CentralError('indisponivel', 'HTTP 503');
    };
    expect(destino(await voltar(`tiquete=${'t'.repeat(43)}`)).searchParams.get('motivo')).toBe('central');
  });
});

describe('o que não entrou e o app antigo', () => {
  it('a conta que não virou conexão e não é de ninguém aqui sai da central; a que já é conexão fica', async () => {
    h.resgate = async () => ({
      versao: 1,
      token: 'EAAtokenFicticio',
      expiraEmSeg: null,
      clientBusinessId: null,
      contas: [
        { igUserId: '17841400000000001', username: 'entrou' },
        { igUserId: '17841400000000002', username: 'falhou_nova' },
        { igUserId: '17841400000000003', username: 'falhou_ja_conectada' },
      ],
      recusadas: [],
      falharam: [],
    });
    h.naoEntram = ['17841400000000002', '17841400000000003'];
    h.existentes = ['17841400000000003'];
    const u = destino(await voltar(`tiquete=${'t'.repeat(43)}`));
    expect(u.searchParams.get('instagram')).toBe('conectado');
    expect(h.desconectadas).toEqual(['17841400000000002']);
    expect(u.searchParams.get('falharam')).toBe('@falhou_nova, @falhou_ja_conectada');
  });

  it('nenhuma conta entrou: volta com o motivo, e a rota da que não é de ninguém sai', async () => {
    h.resgate = async () => ({
      versao: 1,
      token: 'EAAtokenFicticio',
      expiraEmSeg: null,
      clientBusinessId: null,
      contas: [{ igUserId: '17841400000000002', username: 'falhou_nova' }],
      recusadas: [],
      falharam: [],
    });
    h.naoEntram = ['17841400000000002'];
    const u = destino(await voltar(`tiquete=${'t'.repeat(43)}`));
    expect(u.searchParams.get('motivo')).toBe('erro');
    expect(h.desconectadas).toEqual(['17841400000000002']);
  });

  it('pela central, a rota do app responde sem ler o app antigo da conta', async () => {
    const r = await app(new Request('http://localhost:3000/api/cb/instagram/app'));
    expect(await r.json()).toMatchObject({ central: true, configurado: false });
    expect(h.appLido).toBe(0);
  });
});
