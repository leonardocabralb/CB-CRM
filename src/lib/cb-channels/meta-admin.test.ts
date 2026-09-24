import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/whatsapp/meta-api', () => ({
  verifyPhoneNumber: vi.fn(),
  registerPhoneNumber: vi.fn(),
  subscribeWabaToApp: vi.fn(),
  listWabaPhoneNumbers: vi.fn(),
}));

import {
  verifyPhoneNumber,
  registerPhoneNumber,
  subscribeWabaToApp,
  listWabaPhoneNumbers,
} from '@/lib/whatsapp/meta-api';
import { ErroNaConexaoMeta, provisionMetaChannel } from './meta-admin';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const verify = verifyPhoneNumber as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const register = registerPhoneNumber as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const subscribe = subscribeWabaToApp as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const listar = listWabaPhoneNumbers as any;

/** A forma do `MetaApiError` (meta-api.ts) que `explainMetaError` lê. */
function erroDaMeta(code: number, message: string, subcode: number | null = null) {
  return Object.assign(new Error(message), {
    code,
    subcode,
    type: 'OAuthException',
    fbtraceId: 'TRACE9',
    httpStatus: 400,
    details: null,
  });
}

async function falhaDe(promessa: Promise<unknown>) {
  try {
    await promessa;
  } catch (err) {
    expect(err).toBeInstanceOf(ErroNaConexaoMeta);
    return (err as ErroNaConexaoMeta).falha;
  }
  throw new Error('não lançou');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  verify.mockResolvedValue({ display_phone_number: '+55 11 90000-0000' });
  listar.mockResolvedValue([{ id: 'pn', display_phone_number: '+55 11 90000-0000' }]);
  subscribe.mockResolvedValue(undefined);
});

describe('provisionMetaChannel', () => {
  it('verify inválido → LANÇA com a falha explicada, e nem tenta o resto', async () => {
    verify.mockRejectedValue(erroDaMeta(190, 'Invalid OAuth access token.'));
    const f = await falhaDe(provisionMetaChannel({ phoneNumberId: 'pn', accessToken: 'tok' }));
    expect(f).toMatchObject({
      motivo: 'token_invalido',
      campo: 'access_token',
      lado: 'user',
      etapa: 'verify_number',
      codigo: 190,
      fbtraceId: 'TRACE9',
    });
    expect(listar).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('a mensagem da Meta sai SEM o token (ela ecoa o token malformado)', async () => {
    const token = 'EAAGm0PX4ZCpsBAKZCZBtestetestetestetoken123';
    verify.mockRejectedValue(erroDaMeta(190, `Malformed access token ${token}`));
    const f = await falhaDe(provisionMetaChannel({ phoneNumberId: 'pn', accessToken: token }));
    expect(f.mensagemDaMeta).toBe('Malformed access token «token»');
    for (const chamada of (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls) {
      expect(JSON.stringify(chamada)).not.toContain('EAAG');
    }
  });

  it('"(#100) Unsupported get request" no verify → o Phone Number ID não foi achado', async () => {
    verify.mockRejectedValue(erroDaMeta(100, 'Unsupported get request.', 33));
    const f = await falhaDe(
      provisionMetaChannel({ phoneNumberId: 'pn', accessToken: 'tok', wabaId: 'waba1' }),
    );
    expect(f).toMatchObject({ motivo: 'id_nao_encontrado', campo: 'phone_number_id', id: 'pn' });
  });

  it('sem WABA → não lista números nem assina', async () => {
    const r = await provisionMetaChannel({ phoneNumberId: 'pn', accessToken: 'tok' });
    expect(listar).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(r.subscribedAppsAt).toBeNull();
  });

  it('número fora da WABA → LANÇA citando os números dela, ANTES de registrar ou assinar', async () => {
    listar.mockResolvedValue([{ id: 'outro', display_phone_number: '+1 555 0100' }]);
    const f = await falhaDe(
      provisionMetaChannel({ phoneNumberId: 'pn', accessToken: 'tok', wabaId: 'waba1', pin: '123456' }),
    );
    expect(f).toMatchObject({
      motivo: 'numero_fora_da_waba',
      campo: 'waba_id',
      id: 'pn',
      waba: 'waba1',
      numerosDaWaba: { total: 1, citados: ['+1 555 0100 (outro)'] },
    });
    expect(register).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('a listagem dos números falha → LANÇA na etapa da listagem', async () => {
    listar.mockRejectedValue(erroDaMeta(200, 'Permissions error'));
    const f = await falhaDe(
      provisionMetaChannel({ phoneNumberId: 'pn', accessToken: 'tok', wabaId: 'waba1' }),
    );
    expect(f).toMatchObject({ motivo: 'sem_permissao', etapa: 'waba_phone_numbers' });
  });

  it('sem PIN → pula o register (registrationSkipped, registeredAt null)', async () => {
    const r = await provisionMetaChannel({ phoneNumberId: 'pn', accessToken: 'tok' });
    expect(r.registrationSkipped).toBe(true);
    expect(r.registeredAt).toBeNull();
    expect(r.registrationError).toBeNull();
    expect(r.registrationFalha).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it('com PIN → chama register e marca registeredAt', async () => {
    register.mockResolvedValue(undefined);
    const r = await provisionMetaChannel({
      phoneNumberId: 'pn',
      accessToken: 'tok',
      pin: '123456',
    });
    expect(register).toHaveBeenCalledWith({
      phoneNumberId: 'pn',
      accessToken: 'tok',
      pin: '123456',
    });
    expect(r.registeredAt).not.toBeNull();
    expect(r.registrationError).toBeNull();
    expect(r.registrationSkipped).toBe(false);
  });

  it('register falha → NÃO lança: a mensagem e a falha classificada voltam no resultado', async () => {
    register.mockRejectedValue(erroDaMeta(133005, 'Two step verification PIN Mismatch'));
    const r = await provisionMetaChannel({
      phoneNumberId: 'pn',
      accessToken: 'tok',
      wabaId: 'pn-waba',
      pin: '123456',
    });
    expect(r.registrationError).toBe('Two step verification PIN Mismatch');
    expect(r.registrationFalha).toMatchObject({ motivo: 'pin_errado', campo: 'pin', etapa: 'register' });
    expect(r.registeredAt).toBeNull();
    // A WABA ainda é assinada: o register errado não impede gravar a conexão.
    expect(subscribe).toHaveBeenCalled();
  });

  it('com WABA → assina a WABA e marca subscribedAppsAt', async () => {
    const r = await provisionMetaChannel({
      phoneNumberId: 'pn',
      accessToken: 'tok',
      wabaId: 'waba1',
    });
    expect(subscribe).toHaveBeenCalledWith({ wabaId: 'waba1', accessToken: 'tok' });
    expect(r.subscribedAppsAt).not.toBeNull();
    expect(r.phoneInfo).toEqual({ display_phone_number: '+55 11 90000-0000' });
  });

  it('a assinatura da WABA falha → LANÇA (era engolida: a conexão nascia "conectada" sem receber nada)', async () => {
    subscribe.mockRejectedValue(erroDaMeta(200, 'Permissions error'));
    const f = await falhaDe(
      provisionMetaChannel({ phoneNumberId: 'pn', accessToken: 'tok', wabaId: 'waba1' }),
    );
    expect(f).toMatchObject({ motivo: 'sem_permissao', etapa: 'subscribe_waba', lado: 'user' });
  });
});
