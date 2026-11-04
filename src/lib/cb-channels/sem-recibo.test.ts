import { describe, expect, it } from 'vitest';

import {
  ENVIOS_LIDOS_POR_CONEXAO,
  IDADE_MINIMA_DO_ENVIO_MS,
  JANELA_DOS_ENVIOS_MS,
  envioConfirmado,
  lerEnviosRecentes,
  semRecibo,
  type EnvioRecente,
} from './sem-recibo';

const AGORA = Date.parse('2026-11-03T13:30:00.000Z');
const MIN = 60_000;

/** Um envio feito há `minutos`, na conversa `conversa`, com o `status`. */
function envio(minutos: number, conversa: string, status = 'sent'): EnvioRecente {
  return { criadoEm: new Date(AGORA - minutos * MIN).toISOString(), status, conversaId: conversa };
}

describe('semRecibo — a régua (decisão do operador, 04/11/2026)', () => {
  it('03/11 09h na conexão travada: 5 envios em 3 conversas, nenhum recibo = acende', () => {
    const envios = [
      envio(20, 'a'),
      envio(25, 'b'),
      envio(30, 'c'),
      envio(35, 'a'),
      envio(40, 'b'),
    ];
    expect(semRecibo(envios, AGORA)).toEqual({ desdeIso: envios[4].criadoEm });
  });

  it('a conexão sadia: o envio mais recente com recibo não acende nada', () => {
    const envios = [
      envio(20, 'a', 'delivered'),
      envio(25, 'b'),
      envio(30, 'c'),
      envio(35, 'd'),
      envio(40, 'e'),
      envio(45, 'f'),
    ];
    expect(semRecibo(envios, AGORA)).toBeNull();
  });

  it('APAGA NO 1º RECIBO: um envio novo (menos de 15 min) confirmado encerra a sequência', () => {
    const envios = [
      envio(2, 'z', 'read'),
      envio(20, 'a'),
      envio(25, 'b'),
      envio(30, 'c'),
      envio(35, 'd'),
      envio(40, 'e'),
    ];
    expect(semRecibo(envios, AGORA)).toBeNull();
  });

  it('um recibo VELHO, de antes de travar, não segura o alarme', () => {
    // Na manhã de 04/11 os recibos voltaram em lotes, dos envios mais velhos
    // primeiro: o envio confirmado mais recente era de horas antes.
    const envios = [
      envio(20, 'a'),
      envio(25, 'b'),
      envio(30, 'c'),
      envio(35, 'a'),
      envio(40, 'b'),
      envio(60, 'x', 'delivered'),
    ];
    expect(semRecibo(envios, AGORA)).toEqual({ desdeIso: envios[4].criadoEm });
  });

  it('a rajada para UM cliente com o celular desligado não acende (só 2 conversas)', () => {
    const envios = [
      envio(20, 'a'),
      envio(21, 'a'),
      envio(22, 'a'),
      envio(23, 'b'),
      envio(24, 'a'),
    ];
    expect(semRecibo(envios, AGORA)).toBeNull();
  });

  it('as 3 conversas contam nos 5 mais recentes, não na sequência inteira', () => {
    const envios = [
      envio(20, 'a'),
      envio(21, 'a'),
      envio(22, 'b'),
      envio(23, 'a'),
      envio(24, 'b'),
      envio(30, 'c'),
      envio(31, 'd'),
    ];
    expect(semRecibo(envios, AGORA)).toBeNull();
  });

  it('4 envios sem recibo é a maior sequência medida em 7 semanas: não acende', () => {
    expect(semRecibo([envio(20, 'a'), envio(25, 'b'), envio(30, 'c'), envio(35, 'd')], AGORA)).toBeNull();
  });

  it('envio com menos de 15 min ainda pode estar a caminho: não conta', () => {
    const envios = [
      envio(1, 'a'),
      envio(5, 'b'),
      envio(10, 'c'),
      envio(14, 'd'),
      envio(IDADE_MINIMA_DO_ENVIO_MS / MIN + 1, 'e'),
    ];
    expect(semRecibo(envios, AGORA)).toBeNull();
  });

  it('só os envios das últimas 3 h acendem; o resto da sequência dá o `desde`', () => {
    const tres = JANELA_DOS_ENVIOS_MS / MIN;
    // Quatro dentro da janela e um fora: não acende.
    expect(
      semRecibo([envio(20, 'a'), envio(25, 'b'), envio(30, 'c'), envio(35, 'd'), envio(tres + 5, 'e')], AGORA),
    ).toBeNull();
    // Cinco dentro e a sequência começando antes: acende, desde o mais velho.
    const envios = [
      envio(20, 'a'),
      envio(25, 'b'),
      envio(30, 'c'),
      envio(35, 'd'),
      envio(40, 'e'),
      envio(tres + 30, 'f'),
      envio(tres + 90, 'g', 'delivered'),
    ];
    expect(semRecibo(envios, AGORA)).toEqual({ desdeIso: envios[5].criadoEm });
  });

  it('a ordem de chegada não importa', () => {
    const envios = [envio(40, 'b'), envio(20, 'a'), envio(35, 'a'), envio(30, 'c'), envio(25, 'b')];
    expect(semRecibo(envios, AGORA)).toEqual({ desdeIso: envios[0].criadoEm });
  });

  it('sem envio nenhum, nada a afirmar', () => {
    expect(semRecibo([], AGORA)).toBeNull();
  });

  it('`sent` não é recibo: é o aceite do provedor, não do aparelho', () => {
    expect(envioConfirmado('sent')).toBe(false);
    expect(envioConfirmado('delivered')).toBe(true);
    expect(envioConfirmado('read')).toBe(true);
  });
});

/** Um banco falso que registra a consulta e devolve as linhas dadas. */
function bancoFalso(resposta: { data: unknown; error: { message: string } | null }) {
  const chamadas: [string, unknown[]][] = [];
  const consulta: Record<string, unknown> = {};
  for (const metodo of ['select', 'eq', 'in', 'neq', 'gte', 'order']) {
    consulta[metodo] = (...args: unknown[]) => {
      chamadas.push([metodo, args]);
      return consulta;
    };
  }
  consulta.limit = (...args: unknown[]) => {
    chamadas.push(['limit', args]);
    return Promise.resolve(resposta);
  };
  const db = { from: (tabela: string) => (chamadas.push(['from', [tabela]]), consulta) };
  return { db: db as never, chamadas };
}

describe('lerEnviosRecentes — o que a leitura deixa de fora', () => {
  it('só envios do CRM pela conexão, sem celular, sem falha, sem tentativa que não saiu', async () => {
    const { db, chamadas } = bancoFalso({ data: [], error: null });
    await lerEnviosRecentes(db, 'canal-1', AGORA);
    expect(chamadas).toContainEqual(['from', ['messages']]);
    expect(chamadas).toContainEqual(['eq', ['channel_id', 'canal-1']]);
    expect(chamadas).toContainEqual(['in', ['sender_type', ['agent', 'bot']]]);
    expect(chamadas).toContainEqual(['eq', ['from_device', false]]);
    expect(chamadas).toContainEqual(['eq', ['nao_saiu', false]]);
    expect(chamadas).toContainEqual(['neq', ['status', 'failed']]);
    expect(chamadas).toContainEqual(['order', ['created_at', { ascending: false }]]);
    expect(chamadas).toContainEqual(['limit', [ENVIOS_LIDOS_POR_CONEXAO]]);
  });

  it('grupo (conversa sem contato) sai; o embutido vem como objeto ou lista', async () => {
    const { db } = bancoFalso({
      data: [
        { created_at: '2026-11-03T13:00:00.000Z', status: 'sent', conversation_id: 'c1', conversations: { contact_id: 'k1' } },
        { created_at: '2026-11-03T12:59:00.000Z', status: 'sent', conversation_id: 'g1', conversations: { contact_id: null } },
        { created_at: '2026-11-03T12:58:00.000Z', status: 'read', conversation_id: 'c2', conversations: [{ contact_id: 'k2' }] },
        { created_at: '2026-11-03T12:57:00.000Z', status: 'sent', conversation_id: 'c3', conversations: null },
      ],
      error: null,
    });
    expect(await lerEnviosRecentes(db, 'canal-1', AGORA)).toEqual([
      { criadoEm: '2026-11-03T13:00:00.000Z', status: 'sent', conversaId: 'c1' },
      { criadoEm: '2026-11-03T12:58:00.000Z', status: 'read', conversaId: 'c2' },
    ]);
  });

  it('leitura que falha é "não sei" (null), nunca lista vazia', async () => {
    const { db } = bancoFalso({ data: null, error: { message: 'boom' } });
    expect(await lerEnviosRecentes(db, 'canal-1', AGORA)).toBeNull();
  });

  it('o que o supabase-js LANÇA também vira null', async () => {
    const db = {
      from: () => {
        throw new TypeError('fetch failed');
      },
    } as never;
    expect(await lerEnviosRecentes(db, 'canal-1', AGORA)).toBeNull();
  });
});
