import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/whatsapp/meta-api', () => ({
  verifyPhoneNumber: vi.fn(),
  registerPhoneNumber: vi.fn(),
  subscribeWabaToApp: vi.fn(),
}));

import {
  verifyPhoneNumber,
  registerPhoneNumber,
  subscribeWabaToApp,
} from '@/lib/whatsapp/meta-api';
import { provisionMetaChannel } from './meta-admin';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const verify = verifyPhoneNumber as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const register = registerPhoneNumber as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const subscribe = subscribeWabaToApp as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  verify.mockResolvedValue({ display_phone_number: '+55 11 90000-0000' });
});

describe('provisionMetaChannel', () => {
  it('verify inválido → LANÇA (a rota devolve 400) e nem tenta registrar', async () => {
    verify.mockRejectedValue(new Error('Invalid OAuth token'));
    await expect(
      provisionMetaChannel({ phoneNumberId: 'pn', accessToken: 'tok' }),
    ).rejects.toThrow('Invalid OAuth token');
    expect(register).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('sem PIN → pula o register (registrationSkipped, registeredAt null)', async () => {
    const r = await provisionMetaChannel({ phoneNumberId: 'pn', accessToken: 'tok' });
    expect(r.registrationSkipped).toBe(true);
    expect(r.registeredAt).toBeNull();
    expect(r.registrationError).toBeNull();
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

  it('register falha → registrationError preenchido, NÃO lança', async () => {
    register.mockRejectedValue(new Error('PIN incorreto'));
    const r = await provisionMetaChannel({
      phoneNumberId: 'pn',
      accessToken: 'tok',
      pin: '123456',
    });
    expect(r.registrationError).toBe('PIN incorreto');
    expect(r.registeredAt).toBeNull();
  });

  it('sem wabaId → não chama subscribe', async () => {
    await provisionMetaChannel({ phoneNumberId: 'pn', accessToken: 'tok' });
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('com wabaId → chama subscribe; falha é não-fatal (não lança)', async () => {
    subscribe.mockRejectedValue(new Error('sem permissão'));
    const r = await provisionMetaChannel({
      phoneNumberId: 'pn',
      accessToken: 'tok',
      wabaId: 'waba1',
    });
    expect(subscribe).toHaveBeenCalledWith({ wabaId: 'waba1', accessToken: 'tok' });
    expect(r.subscribedAppsAt).toBeNull();
    expect(r.phoneInfo).toEqual({ display_phone_number: '+55 11 90000-0000' });
  });
});
