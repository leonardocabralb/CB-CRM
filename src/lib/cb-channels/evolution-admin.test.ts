import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  buildChannelInstanceName,
  evolutionWebhookConfig,
  slugDoRotulo,
} from './evolution-admin';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('slugDoRotulo', () => {
  it('minúsculas, sem acento, separado por hífen', () => {
    expect(slugDoRotulo('Dr. Leonardo — Trabalhista')).toBe('dr-leonardo-trabalhista');
    expect(slugDoRotulo('Atendimento Ação')).toBe('atendimento-acao');
  });

  it('não deixa hífen nas pontas', () => {
    expect(slugDoRotulo('  Comercial 2!  ')).toBe('comercial-2');
  });

  it('devolve vazio quando não sobra caractere aproveitável', () => {
    expect(slugDoRotulo('🙂🙂')).toBe('');
    expect(slugDoRotulo('...')).toBe('');
  });

  it('corta em 32 caracteres sem deixar hífen solto no fim', () => {
    // 60 é o teto do rótulo na rota; o nome da instância não precisa dele todo.
    const s = slugDoRotulo('a'.repeat(32) + ' sobra');
    expect(s).toBe('a'.repeat(32));
    expect(s).not.toMatch(/-$/);
  });
});

describe('buildChannelInstanceName', () => {
  it('deriva do RÓTULO, com sufixo aleatório', () => {
    const name = buildChannelInstanceName('11111111-2222-3333-4444-555555555555', 'CBAdv');
    expect(name).toMatch(/^cbadv-[0-9a-f]{6}$/);
  });

  it('cai no accountId quando o rótulo não vira slug', () => {
    const acct = '11111111-2222-3333-4444-555555555555';
    expect(buildChannelInstanceName(acct, '🙂')).toMatch(
      new RegExp(`^cbcrm-${acct}-[0-9a-f]{6}$`),
    );
  });

  it('não colide com o nome do canal padrão (cbcrm-<accountId>)', () => {
    const acct = 'acct-1';
    // O padrão single-channel do Gabriel usa exatamente `cbcrm-<accountId>`.
    expect(buildChannelInstanceName(acct, 'cbcrm')).not.toBe(`cbcrm-${acct}`);
    expect(buildChannelInstanceName(acct, '🙂')).not.toBe(`cbcrm-${acct}`);
  });

  it('gera nomes distintos para o MESMO rótulo', () => {
    // O sufixo é o que separa dois canais de mesmo nome — e o que impede o
    // create-or-adopt de assumir instância alheia de nome igual.
    const a = buildChannelInstanceName('acct-1', 'Comercial');
    const b = buildChannelInstanceName('acct-1', 'Comercial');
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
