import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConversationsSeries, loadResponseTime } from "./queries";
import { daysAgoStart, lastNDayKeys, localDayKey, mondayIndex } from "./date-utils";

/**
 * A série "Conversas ao longo do tempo" e o "Tempo de resposta" baixavam as
 * LINHAS de `messages` e somavam no navegador. O PostgREST corta em 1000 sem
 * avisar: em 19/10/2026 o gráfico de 30 dias desenhava os dois primeiros dias
 * (o segundo pela metade, 815 de 1.339) e ZERO nos outros 28, e a média de
 * resposta saía de ~80 das ~1.000 conversas da quinzena.
 *
 * Desde a 1095 as duas somam no banco e devolvem uma linha por dia. Estes
 * testes pinam a metade do NAVEGADOR: o que se pede à RPC (janela, fuso do
 * navegador, canal) e como a resposta vira a tela. A metade do SQL tem pino
 * em `supabase/migrations/painel-por-dia-1095.test.ts`.
 */

interface Chamada {
  funcao: string;
  args: Record<string, unknown>;
}

function dubleDeBanco(resposta: { data: unknown[] | null; error: { message: string } | null }) {
  const chamadas: Chamada[] = [];
  const db = {
    rpc(funcao: string, args: Record<string, unknown>) {
      chamadas.push({ funcao, args });
      return Promise.resolve(resposta);
    },
    // Nenhuma das duas pode voltar a baixar linhas: um `.from()` aqui estoura.
    from() {
      throw new Error("o painel voltou a ler messages pelo PostgREST");
    },
  };
  return { db: db as unknown as Parameters<typeof loadConversationsSeries>[0], chamadas };
}

const FUSO = Intl.DateTimeFormat().resolvedOptions().timeZone;

beforeEach(() => {
  vi.useFakeTimers();
  // Uma terça-feira à tarde: a semana atual começou ontem.
  vi.setSystemTime(new Date(2026, 9, 20, 15, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("série: o que se pede à RPC", () => {
  it("janela do primeiro dia da série, no fuso do navegador, conta inteira", async () => {
    const { db, chamadas } = dubleDeBanco({ data: [], error: null });
    await loadConversationsSeries(db, 30);
    expect(chamadas).toEqual([
      {
        funcao: "cb_painel_mensagens_por_dia",
        args: { p_desde: daysAgoStart(29).toISOString(), p_fuso: FUSO, p_canal: null },
      },
    ]);
  });

  it("o filtro de canal vai como p_canal; string vazia é a conta inteira (como porCanal)", async () => {
    const comCanal = dubleDeBanco({ data: [], error: null });
    await loadConversationsSeries(comCanal.db, 7, "canal-1");
    expect(comCanal.chamadas[0].args.p_canal).toBe("canal-1");

    const vazio = dubleDeBanco({ data: [], error: null });
    await loadConversationsSeries(vazio.db, 7, "");
    expect(vazio.chamadas[0].args.p_canal).toBeNull();
  });
});

describe("série: a resposta vira a tela", () => {
  it("um ponto por dia da janela, em ordem; dia que a função não devolve é zero", async () => {
    const dias = lastNDayKeys(30);
    const { db } = dubleDeBanco({
      data: [
        { dia: dias[1], recebidas: 1339, enviadas: 1200 },
        { dia: dias[29], recebidas: 158, enviadas: 175 },
      ],
      error: null,
    });
    const serie = await loadConversationsSeries(db, 30);
    expect(serie.map((p) => p.day)).toEqual(dias);
    // Mais de mil num dia só: era exatamente o que o corte escondia.
    expect(serie[1]).toEqual({ day: dias[1], incoming: 1339, outgoing: 1200 });
    expect(serie[29]).toEqual({ day: dias[29], incoming: 158, outgoing: 175 });
    expect(serie.filter((p) => p.incoming === 0 && p.outgoing === 0)).toHaveLength(28);
  });

  it("dia fora da janela que a função devolva não entra", async () => {
    const { db } = dubleDeBanco({
      data: [{ dia: "1999-01-01", recebidas: 5, enviadas: 5 }],
      error: null,
    });
    const serie = await loadConversationsSeries(db, 7);
    expect(serie).toHaveLength(7);
    expect(serie.every((p) => p.incoming === 0 && p.outgoing === 0)).toBe(true);
  });

  it("RPC que falha LANÇA — nunca vira gráfico zerado com cara de 'sem atividade'", async () => {
    const { db } = dubleDeBanco({ data: null, error: { message: "boom" } });
    await expect(loadConversationsSeries(db, 30)).rejects.toEqual({ message: "boom" });
  });
});

describe("tempo de resposta", () => {
  it("pede 14 dias no fuso do navegador, com o canal", async () => {
    const { db, chamadas } = dubleDeBanco({ data: [], error: null });
    await loadResponseTime(db, "canal-1");
    expect(chamadas).toEqual([
      {
        funcao: "cb_painel_tempo_de_resposta",
        args: { p_desde: daysAgoStart(13).toISOString(), p_fuso: FUSO, p_canal: "canal-1" },
      },
    ]);
  });

  it("média = minutos somados ÷ amostras, por dia da semana e por semana", async () => {
    const agora = new Date();
    const segundaAtual = daysAgoStart(mondayIndex(agora));
    const diaDe = (deslocamento: number) => {
      const d = new Date(segundaAtual);
      d.setDate(d.getDate() + deslocamento);
      return localDayKey(d);
    };
    const { db } = dubleDeBanco({
      data: [
        // Segunda da semana passada e segunda desta: a barra de segunda junta
        // as duas (3 amostras, 40 min → 13,33).
        { dia: diaDe(-7), amostras: 1, soma_minutos: 10 },
        { dia: diaDe(0), amostras: 2, soma_minutos: 30 },
        // Terça desta semana (hoje).
        { dia: diaDe(1), amostras: 4, soma_minutos: 8 },
        // Antes da semana passada: entra na barra do dia, não nas semanas.
        { dia: diaDe(-8), amostras: 1, soma_minutos: 100 },
      ],
      error: null,
    });
    const r = await loadResponseTime(db);

    expect(r.buckets).toHaveLength(7);
    expect(r.buckets[0]).toEqual({ dow: 0, avgMinutes: 40 / 3, samples: 3 });
    expect(r.buckets[1]).toEqual({ dow: 1, avgMinutes: 2, samples: 4 });
    // O domingo da semana retrasada (diaDe(-8)).
    expect(r.buckets[6]).toEqual({ dow: 6, avgMinutes: 100, samples: 1 });
    // Dia sem amostra: média nula (barra apagada), nunca zero minuto.
    expect(r.buckets[3]).toEqual({ dow: 3, avgMinutes: null, samples: 0 });

    expect(r.thisWeekAvg).toBe(38 / 6);
    expect(r.lastWeekAvg).toBe(10);
  });

  it("sem amostra nenhuma, as médias são nulas", async () => {
    const { db } = dubleDeBanco({ data: [], error: null });
    const r = await loadResponseTime(db);
    expect(r.thisWeekAvg).toBeNull();
    expect(r.lastWeekAvg).toBeNull();
    expect(r.buckets.every((b) => b.avgMinutes === null && b.samples === 0)).toBe(true);
  });

  it("RPC que falha LANÇA", async () => {
    const { db } = dubleDeBanco({ data: null, error: { message: "boom" } });
    await expect(loadResponseTime(db)).rejects.toEqual({ message: "boom" });
  });
});
