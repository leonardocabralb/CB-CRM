import { describe, expect, it, beforeEach } from 'vitest';

import { toneFor, piorTom, comCache, STALE_MS, __limparCacheDeSaude } from './health';

const BASE = {
  status: 'connected' as const,
  estadoVivo: null,
  checkedAt: null,
  lastError: null,
  incompleto: false,
  webhookOk: null,
  agoraMs: 1_000_000_000_000,
};

const agora = (msAtras: number) => new Date(BASE.agoraMs - msAtras).toISOString();

describe('toneFor — a regra que o indicador carrega', () => {
  it('conectado E confirmado agora = verde', () => {
    expect(toneFor({ ...BASE, estadoVivo: 'open' })).toEqual({ tone: 'ok', detail: null });
  });

  it('LINHA DIZ CONECTADO, MAS NINGUÉM CONFIRMOU HÁ MUITO = amarelo', () => {
    // É o caso que motivou o módulo inteiro: em produção havia um canal
    // marcado `connected` com a última atualização de 23h antes. Verde ali
    // seria a mentira mais cara possível.
    const r = toneFor({ ...BASE, estadoVivo: null, checkedAt: agora(24 * 3600_000) });
    expect(r).toEqual({ tone: 'warn', detail: 'stale' });
  });

  it('conectado, sem resposta agora, mas verificado há pouco = verde', () => {
    const r = toneFor({ ...BASE, estadoVivo: null, checkedAt: agora(STALE_MS / 2) });
    expect(r.tone).toBe('ok');
  });

  it('nunca verificado e sem resposta = amarelo, não verde', () => {
    expect(toneFor({ ...BASE, estadoVivo: null, checkedAt: null }).tone).toBe('warn');
  });

  it('provedor diz que fechou = vermelho', () => {
    expect(toneFor({ ...BASE, estadoVivo: 'close' })).toEqual({
      tone: 'down',
      detail: 'closed',
    });
  });

  it('pareando = amarelo', () => {
    expect(toneFor({ ...BASE, estadoVivo: 'connecting' }).tone).toBe('warn');
  });

  it('conectado no provedor mas webhook apontando para fora = amarelo', () => {
    // WhatsApp de pé e CRM surdo — o único motivo do nível 2 existir.
    expect(toneFor({ ...BASE, estadoVivo: 'open', webhookOk: false })).toEqual({
      tone: 'warn',
      detail: 'webhook',
    });
  });

  it('webhook indeterminado NÃO acusa nada', () => {
    // "Não consegui ler" não é "está errado".
    expect(toneFor({ ...BASE, estadoVivo: 'open', webhookOk: null }).tone).toBe('ok');
  });

  it('configuração incompleta é cinza, não vermelho', () => {
    // Nunca pareado ≠ caiu. Vermelho mandaria procurar uma queda que não houve.
    expect(toneFor({ ...BASE, incompleto: true })).toEqual({
      tone: 'unknown',
      detail: 'incomplete',
    });
  });

  it('erro registrado rebaixa verde para amarelo', () => {
    expect(toneFor({ ...BASE, estadoVivo: 'open', lastError: 'algo' }).tone).toBe('warn');
  });

  it('sem resposta e linha desconectada = vermelho', () => {
    expect(toneFor({ ...BASE, status: 'disconnected', estadoVivo: null }).tone).toBe('down');
  });
});

describe('piorTom', () => {
  it('vermelho ganha de tudo', () => {
    expect(piorTom(['ok', 'warn', 'down', 'unknown'])).toBe('down');
  });
  it('amarelo ganha de cinza e verde', () => {
    expect(piorTom(['ok', 'unknown', 'warn'])).toBe('warn');
  });
  it('tudo verde é verde', () => {
    expect(piorTom(['ok', 'ok'])).toBe('ok');
  });
  it('lista vazia é verde (não há canal para estar doente)', () => {
    expect(piorTom([])).toBe('ok');
  });
});

describe('comCache — single-flight', () => {
  beforeEach(() => __limparCacheDeSaude());

  it('não repete a chamada dentro do TTL', async () => {
    let chamadas = 0;
    const produzir = async () => {
      chamadas++;
      return 'x';
    };
    await comCache('k', 10_000, produzir);
    await comCache('k', 10_000, produzir);
    expect(chamadas).toBe(1);
  });

  it('chamadas concorrentes colapsam numa só', async () => {
    // É o que impede dez abas atualizando juntas de virarem dez requisições
    // ao servidor Evolution.
    let chamadas = 0;
    const produzir = async () => {
      chamadas++;
      await new Promise((r) => setTimeout(r, 10));
      return 'x';
    };
    await Promise.all([
      comCache('k', 10_000, produzir),
      comCache('k', 10_000, produzir),
      comCache('k', 10_000, produzir),
    ]);
    expect(chamadas).toBe(1);
  });

  it('falha não fica cacheada — a próxima tentativa refaz', async () => {
    let chamadas = 0;
    const produzir = async () => {
      chamadas++;
      throw new Error('servidor mudo');
    };
    await expect(comCache('k', 10_000, produzir)).rejects.toThrow();
    await expect(comCache('k', 10_000, produzir)).rejects.toThrow();
    expect(chamadas).toBe(2);
  });
});
