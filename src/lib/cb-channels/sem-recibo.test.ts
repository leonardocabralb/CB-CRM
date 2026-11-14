import { describe, expect, it } from 'vitest';

import { medirSemRecibo } from './alarmes-no-sino';

import {
  ENVIOS_LIDOS_POR_CONEXAO,
  IDADE_MINIMA_DO_ENVIO_MS,
  JANELA_DOS_ENVIOS_MS,
  envioConfirmado,
  lerEnviosRecentes,
  semRecibo,
  type EnvioRecente,
  JANELA_DA_LEITURA_MS,
} from './sem-recibo';

const AGORA = Date.parse('2026-11-03T13:30:00.000Z');
const MIN = 60_000;

/** Um envio feito há `minutos`, na conversa `conversa`, com o `status`. */
function envio(
  minutos: number,
  conversa: string,
  status = 'sent'
): EnvioRecente {
  return {
    criadoEm: new Date(AGORA - minutos * MIN).toISOString(),
    status,
    conversaId: conversa,
  };
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
    expect(
      semRecibo(
        [envio(20, 'a'), envio(25, 'b'), envio(30, 'c'), envio(35, 'd')],
        AGORA
      )
    ).toBeNull();
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
      semRecibo(
        [
          envio(20, 'a'),
          envio(25, 'b'),
          envio(30, 'c'),
          envio(35, 'd'),
          envio(tres + 5, 'e'),
        ],
        AGORA
      )
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
    const envios = [
      envio(40, 'b'),
      envio(20, 'a'),
      envio(35, 'a'),
      envio(30, 'c'),
      envio(25, 'b'),
    ];
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

type Resposta = { data: unknown; error: { message: string } | null };

/**
 * Um banco falso: cada `from()` abre uma consulta própria, que registra as
 * chamadas; o `limit` de cada uma devolve a próxima resposta da fila.
 */
function bancoFalso(...respostas: Resposta[]) {
  const consultas: [string, unknown[]][][] = [];
  const db = {
    from: (tabela: string) => {
      const chamadas: [string, unknown[]][] = [['from', [tabela]]];
      consultas.push(chamadas);
      const consulta: Record<string, unknown> = {};
      for (const metodo of [
        'select',
        'eq',
        'in',
        'neq',
        'not',
        'gte',
        'lt',
        'order',
      ]) {
        consulta[metodo] = (...args: unknown[]) => {
          chamadas.push([metodo, args]);
          return consulta;
        };
      }
      consulta.limit = (...args: unknown[]) => {
        chamadas.push(['limit', args]);
        return Promise.resolve(respostas.shift() ?? { data: [], error: null });
      };
      return consulta;
    },
  };
  return { db: db as never, consultas };
}

const CORTE_DO_MADURO = new Date(
  AGORA - IDADE_MINIMA_DO_ENVIO_MS
).toISOString();

describe('lerEnviosRecentes — duas leituras, e o teto só nos maduros', () => {
  it('as duas: só envio do CRM, 1:1 NA CONSULTA, sem celular, falha nem tentativa que não saiu', async () => {
    const { db, consultas } = bancoFalso();
    await lerEnviosRecentes(db, 'canal-1', AGORA);
    expect(consultas).toHaveLength(2);
    for (const chamadas of consultas) {
      expect(chamadas).toContainEqual(['from', ['messages']]);
      expect(chamadas).toContainEqual([
        'select',
        [
          'created_at, status, conversation_id, conversations!inner(contact_id)',
        ],
      ]);
      expect(chamadas).toContainEqual([
        'not',
        ['conversations.contact_id', 'is', null],
      ]);
      expect(chamadas).toContainEqual(['eq', ['channel_id', 'canal-1']]);
      expect(chamadas).toContainEqual([
        'in',
        ['sender_type', ['agent', 'bot']],
      ]);
      expect(chamadas).toContainEqual(['eq', ['from_device', false]]);
      expect(chamadas).toContainEqual(['eq', ['nao_saiu', false]]);
      expect(chamadas).toContainEqual(['neq', ['status', 'failed']]);
      expect(chamadas).toContainEqual([
        'order',
        ['created_at', { ascending: false }],
      ]);
    }
  });

  it('a 1ª busca só o envio CONFIRMADO mais novo dos últimos 15 min', async () => {
    const { db, consultas } = bancoFalso();
    await lerEnviosRecentes(db, 'canal-1', AGORA);
    expect(consultas[0]).toContainEqual([
      'gte',
      ['created_at', CORTE_DO_MADURO],
    ]);
    expect(consultas[0]).toContainEqual([
      'in',
      ['status', ['delivered', 'read']],
    ]);
    expect(consultas[0]).toContainEqual(['limit', [1]]);
  });

  it('a 2ª busca só os MADUROS das 24 h: rajada recente não ocupa o teto', async () => {
    const { db, consultas } = bancoFalso();
    await lerEnviosRecentes(db, 'canal-1', AGORA);
    expect(consultas[1]).toContainEqual([
      'lt',
      ['created_at', CORTE_DO_MADURO],
    ]);
    expect(consultas[1]).toContainEqual(['limit', [ENVIOS_LIDOS_POR_CONEXAO]]);
  });

  it('junta as duas, o confirmado novo na frente: ele apaga o alarme', async () => {
    const maduros = [
      envio(20, 'a'),
      envio(25, 'b'),
      envio(30, 'c'),
      envio(35, 'a'),
      envio(40, 'b'),
    ];
    const linha = (e: EnvioRecente) => ({
      created_at: e.criadoEm,
      status: e.status,
      conversation_id: e.conversaId,
    });
    const { db } = bancoFalso(
      { data: [linha(envio(3, 'z', 'delivered'))], error: null },
      { data: maduros.map(linha), error: null }
    );
    const lidos = await lerEnviosRecentes(db, 'canal-1', AGORA);
    expect(lidos?.map((e) => e.conversaId)).toEqual([
      'z',
      'a',
      'b',
      'c',
      'a',
      'b',
    ]);
    expect(semRecibo(lidos!, AGORA)).toBeNull();
    // Sem o confirmado novo, os mesmos maduros acendem.
    expect(semRecibo(lidos!.slice(1), AGORA)).not.toBeNull();
  });

  it('leitura que falha é "não sei" (null), nunca lista vazia — em qualquer das duas', async () => {
    expect(
      await lerEnviosRecentes(
        bancoFalso({ data: null, error: { message: 'boom' } }).db,
        'canal-1',
        AGORA
      )
    ).toBeNull();
    expect(
      await lerEnviosRecentes(
        bancoFalso(
          { data: [], error: null },
          { data: null, error: { message: 'boom' } }
        ).db,
        'canal-1',
        AGORA
      )
    ).toBeNull();
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

describe('lerEnviosRecentes — a PROVA do episódio mais velho que a janela', () => {
  const INICIO_DA_JANELA = new Date(AGORA - JANELA_DA_LEITURA_MS).toISOString();
  const SEXTA = new Date(AGORA - 3 * 24 * 60 * 60_000).toISOString();

  it('episódio aberto há mais de 24 h: a 3ª leitura busca o confirmado desde o começo dele', async () => {
    const { db, consultas } = bancoFalso();
    await lerEnviosRecentes(db, 'canal-1', AGORA, SEXTA);
    expect(consultas).toHaveLength(3);
    expect(consultas[2]).toContainEqual(['gte', ['created_at', SEXTA]]);
    expect(consultas[2]).toContainEqual([
      'lt',
      ['created_at', INICIO_DA_JANELA],
    ]);
    expect(consultas[2]).toContainEqual([
      'in',
      ['status', ['delivered', 'read']],
    ]);
    expect(consultas[2]).toContainEqual(['limit', [1]]);
    // As mesmas cercas das outras: só envio do CRM, 1:1, que saiu.
    expect(consultas[2]).toContainEqual([
      'not',
      ['conversations.contact_id', 'is', null],
    ]);
    expect(consultas[2]).toContainEqual(['eq', ['nao_saiu', false]]);
  });

  it('episódio dentro da janela, ou nenhum: só as duas de sempre', async () => {
    const recente = new Date(AGORA - 2 * 60 * 60_000).toISOString();
    expect(
      await (async () => {
        const b = bancoFalso();
        await lerEnviosRecentes(b.db, 'canal-1', AGORA, recente);
        return b.consultas;
      })()
    ).toHaveLength(2);
    expect(
      await (async () => {
        const b = bancoFalso();
        await lerEnviosRecentes(b.db, 'canal-1', AGORA, null);
        return b.consultas;
      })()
    ).toHaveLength(2);
  });

  it('⚠️ os recibos da sexta chegam na segunda, sem envio novo: a prova antiga normaliza', async () => {
    // Sexta: o envio que ganhou o recibo agora; nada nas últimas 24 h.
    const daSexta = {
      created_at: new Date(
        AGORA - 3 * 24 * 60 * 60_000 + 60 * 60_000
      ).toISOString(),
      status: 'read',
      conversation_id: 'a',
    };
    const { db } = bancoFalso(
      { data: [], error: null },
      { data: [], error: null },
      { data: [daSexta], error: null }
    );
    const lidos = await lerEnviosRecentes(db, 'canal-1', AGORA, SEXTA);
    expect(lidos).toHaveLength(1);
    expect(medirSemRecibo(lidos, SEXTA, AGORA).tipo).toBe('normal');
    // Sem a 3ª leitura, a mesma segunda-feira era "não sei" (e o "Continua").
    expect(medirSemRecibo([], SEXTA, AGORA).tipo).toBe('nao_sei');
  });

  it('a 3ª leitura que falha é "não sei" (null), como as outras', async () => {
    const { db } = bancoFalso(
      { data: [], error: null },
      { data: [], error: null },
      { data: null, error: { message: 'boom' } }
    );
    expect(await lerEnviosRecentes(db, 'canal-1', AGORA, SEXTA)).toBeNull();
  });
});
