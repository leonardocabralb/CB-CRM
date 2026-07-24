import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  buildChannelInstanceName,
  evolutionWebhookConfig,
} from './evolution-admin';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildChannelInstanceName', () => {
  it('deriva do accountId com prefixo cbcrm- e sufixo aleatório', () => {
    const acct = '11111111-2222-3333-4444-555555555555';
    const name = buildChannelInstanceName(acct);
    expect(name).toMatch(new RegExp(`^cbcrm-${acct}-[0-9a-f]{6}$`));
  });

  it('não colide com o nome do canal padrão (cbcrm-<accountId>)', () => {
    const acct = 'acct-1';
    // O padrão single-channel do Gabriel usa exatamente `cbcrm-<accountId>`.
    expect(buildChannelInstanceName(acct)).not.toBe(`cbcrm-${acct}`);
  });

  it('gera nomes distintos em chamadas seguidas', () => {
    const a = buildChannelInstanceName('acct-1');
    const b = buildChannelInstanceName('acct-1');
    expect(a).not.toBe(b);
  });
});

describe('evolutionWebhookConfig', () => {
  it('lança sem EVOLUTION_WEBHOOK_SECRET', () => {
    vi.stubEnv('EVOLUTION_WEBHOOK_SECRET', '');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com');
    expect(() => evolutionWebhookConfig()).toThrow(/EVOLUTION_WEBHOOK_SECRET/);
  });

  it('monta a URL do webhook a partir de NEXT_PUBLIC_SITE_URL (sem barra dupla)', () => {
    vi.stubEnv('EVOLUTION_WEBHOOK_SECRET', 'segredo');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com/');
    const cfg = evolutionWebhookConfig();
    expect(cfg.secret).toBe('segredo');
    expect(cfg.url).toBe('https://crm.example.com/api/whatsapp/evolution/webhook');
  });

  it('usa o requestOrigin de fallback quando SITE_URL não está setado', () => {
    vi.stubEnv('EVOLUTION_WEBHOOK_SECRET', 'segredo');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    const cfg = evolutionWebhookConfig('http://localhost:3000');
    expect(cfg.url).toBe('http://localhost:3000/api/whatsapp/evolution/webhook');
  });
});
