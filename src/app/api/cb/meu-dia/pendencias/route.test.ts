import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// O webhook cujo telefone CHEGOU e não passou pela régua (Fase 3-III) conta
// como entrada parada no Meu dia — o lead existe no log e, sem a contagem,
// sumiria em silêncio. O que NÃO veio continua fora, e a contagem tem janela
// (a linha não sai sozinha: "Processar de novo" daria o mesmo resultado).
// ============================================================

type Filtro = [string, ...unknown[]];
interface Consulta {
  tabela: string;
  filtros: Filtro[];
}

const estado = vi.hoisted(() => ({
  consultas: [] as { tabela: string; filtros: [string, ...unknown[]][] }[],
  contagens: {} as Record<string, number>,
  erro: null as null | { message: string },
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from(tabela: string) {
      const consulta: Consulta = { tabela, filtros: [] };
      estado.consultas.push(consulta);
      const registra =
        (nome: string) =>
        (...args: unknown[]) => {
          consulta.filtros.push([nome, ...args]);
          return b;
        };
      const b: Record<string, unknown> = {
        select: registra('select'),
        eq: registra('eq'),
        in: registra('in'),
        or: registra('or'),
        not: registra('not'),
        gte: registra('gte'),
        order: registra('order'),
        limit: registra('limit'),
        then: (f: (v: unknown) => unknown) => {
          const ilegivel = consulta.filtros.some(
            ([n, c, v]) => n === 'eq' && c === 'resultado' && v === 'sem_telefone'
          );
          const chave = ilegivel ? `${tabela}:ilegivel` : tabela;
          return Promise.resolve({
            data: [],
            count: estado.contagens[chave] ?? 0,
            error: ilegivel ? estado.erro : null,
          }).then(f);
        },
      };
      return b;
    },
  }),
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => ({ accountId: 'conta-1', userId: 'u1' }),
  toErrorResponse: (e: unknown) => {
    throw e;
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => null,
}));

import { GET } from './route';

beforeEach(() => {
  estado.consultas = [];
  estado.contagens = {};
  estado.erro = null;
});

describe('GET /api/cb/meu-dia/pendencias — telefone ilegível do webhook', () => {
  it('soma à contagem dos webhooks o sem_telefone COM telefone, na janela das retidas', async () => {
    estado.contagens = { cb_webhook_eventos: 2, 'cb_webhook_eventos:ilegivel': 3, cb_calendly_eventos: 1 };

    const r = await GET();
    const corpo = await r.json();

    expect(r.status).toBe(200);
    expect(corpo.naoProcessadas).toEqual({ calendly: 1, webhooks: 5 });

    const ilegivel = estado.consultas.find(
      (c) =>
        c.tabela === 'cb_webhook_eventos' &&
        c.filtros.some(([n, c2, v]) => n === 'eq' && c2 === 'resultado' && v === 'sem_telefone')
    );
    expect(ilegivel).toBeDefined();
    const f = ilegivel!.filtros;
    // Da conta, só com telefone preenchido (o campo que não veio é desfecho
    // legítimo) e com janela (sem ela o aviso ficaria aceso para sempre).
    expect(f).toContainEqual(['eq', 'account_id', 'conta-1']);
    expect(f).toContainEqual(['not', 'telefone', 'is', null]);
    // A MESMA janela das retidas (o texto da tela e a doc dizem "7 dias"):
    // um prazo diferente num lado só tem de reprovar aqui.
    const janela = f.find(([n, c2]) => n === 'gte' && c2 === 'recebido_em');
    const retidas = estado.consultas.find((c) => c.tabela === 'cb_mensagens_sem_telefone');
    const janelaDasRetidas = retidas?.filtros.find(([n, c2]) => n === 'gte' && c2 === 'recebida_em');
    expect(janela).toBeDefined();
    expect(janelaDasRetidas).toBeDefined();
    expect(janela![2]).toBe(janelaDasRetidas![2]);
  });

  it('o Calendly NÃO ganha a contagem nova (lê o telefone por outra régua)', async () => {
    await GET();
    const doCalendly = estado.consultas.filter((c) => c.tabela === 'cb_calendly_eventos');
    expect(doCalendly).toHaveLength(1);
    expect(
      doCalendly[0].filtros.some(([n, c2, v]) => n === 'eq' && c2 === 'resultado' && v === 'sem_telefone')
    ).toBe(false);
  });

  it('a coluna que esta contagem lê é gravada SEM o em-branco (a rota de entrada)', () => {
    // "Telefone preenchido" tem de querer dizer "veio algo": em branco a régua
    // diz "vazio", e contar como "veio e não serve" contradiria o log.
    const entrada = fs
      .readFileSync(path.join(__dirname, '..', '..', 'entrada', '[token]', 'route.ts'), 'utf8')
      .replace(/\/\/.*$/gm, '');
    expect(entrada).toMatch(/telefone: comAlgoVisivel\(valorDoCampo\(variaveis, webhook\.campo_telefone\)\)/);
  });

  it('falha da contagem nova é 500, nunca zero', async () => {
    estado.erro = { message: 'timeout' };
    const r = await GET();
    expect(r.status).toBe(500);
  });
});
