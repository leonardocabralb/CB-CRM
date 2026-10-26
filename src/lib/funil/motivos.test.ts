import { describe, expect, it } from "vitest";

import type { CustomField } from "@/types";

import { PAGINA, carregarMotivos, type ClienteDaRpc } from "./carregar";
import { agruparMotivos, lerLinhaDeMotivo, type LinhaDeMotivo } from "./motivos";

// ============================================================
// O relatório de motivos (Fase 4, 1113). Dados fictícios.
// ============================================================

const campo = (id: string, opcoes: string[], tipo = "select"): CustomField =>
  ({ id, field_name: id, field_type: tipo, field_options: { opcoes } }) as unknown as CustomField;

const PERDA = campo("campo-perda", ["Desistiu", "Fechou com outro", "Outro"]);
const DESQ = campo("campo-desq", ["Spam", "Fora do perfil", "Outro"]);

const ETAPAS = [
  { id: "perdido", name: "Perdido", position: 5, campo_do_motivo_id: "campo-perda" },
  { id: "novo", name: "Novo", position: 0, campo_do_motivo_id: null },
  { id: "desq", name: "Desqualificado", position: 4, campo_do_motivo_id: "campo-desq" },
];

const linha = (l: Partial<LinhaDeMotivo> & Pick<LinhaDeMotivo, "etapa_id" | "cards">): LinhaDeMotivo => ({
  motivo: null,
  origem: null,
  ator_id: null,
  ator_nome: null,
  ...l,
});

describe("agruparMotivos", () => {
  it("só as etapas que pedem motivo, na ordem do funil — a vazia aparece com zero", () => {
    const r = agruparMotivos([], ETAPAS, [PERDA, DESQ]);
    expect(r.map((e) => [e.nome, e.total])).toEqual([
      ["Desqualificado", 0],
      ["Perdido", 0],
    ]);
  });

  it("opção da lista é a linha dela; fora da lista é Outro com os textos; sem valor é Sem motivo por quem", () => {
    const r = agruparMotivos(
      [
        linha({ etapa_id: "perdido", motivo: "Desistiu", cards: 3 }),
        linha({ etapa_id: "perdido", motivo: "Fechou com outro", cards: 5 }),
        linha({ etapa_id: "perdido", motivo: "Mudou de cidade", cards: 1 }),
        linha({ etapa_id: "perdido", motivo: "Sem dinheiro agora", cards: 2 }),
        // o "Outro" literal (o passo da automação pode gravá-lo) também é Outro
        linha({ etapa_id: "perdido", motivo: "Outro", cards: 1 }),
        linha({ etapa_id: "perdido", origem: "usuario", ator_id: "u1", ator_nome: "Ana", cards: 2 }),
        linha({ etapa_id: "perdido", origem: "sistema", cards: 4 }),
        linha({ etapa_id: "perdido", origem: "retroativo", cards: 1 }),
        linha({ etapa_id: "desq", motivo: "Spam", cards: 1 }),
        // etapa que não está no funil (configuração mudou entre as leituras)
        linha({ etapa_id: "outra", motivo: "Desistiu", cards: 9 }),
      ],
      ETAPAS,
      [PERDA, DESQ],
    );
    const perdido = r.find((e) => e.etapaId === "perdido")!;
    expect(perdido.total).toBe(19);
    expect(perdido.motivos).toEqual([
      { rotulo: "Fechou com outro", cards: 5 },
      { rotulo: "Desistiu", cards: 3 },
    ]);
    expect(perdido.outro).toEqual({
      cards: 4,
      textos: [
        { rotulo: "Sem dinheiro agora", cards: 2 },
        { rotulo: "Mudou de cidade", cards: 1 },
        { rotulo: "Outro", cards: 1 },
      ],
    });
    expect(perdido.semMotivo).toEqual({
      cards: 7,
      porQuem: [
        { quem: { tipo: "sem_pessoa" }, cards: 4 },
        { quem: { tipo: "pessoa", id: "u1", nome: "Ana" }, cards: 2 },
        { quem: { tipo: "historico" }, cards: 1 },
      ],
    });
    // os três baldes fecham com o total
    expect(
      perdido.motivos.reduce((s, m) => s + m.cards, 0) + perdido.outro.cards + perdido.semMotivo.cards,
    ).toBe(perdido.total);
    expect(r.find((e) => e.etapaId === "desq")!.motivos).toEqual([{ rotulo: "Spam", cards: 1 }]);
  });

  it("a pessoa apagada (id nulo) se separa pelo nome; a mesma pessoa em duas linhas soma", () => {
    const r = agruparMotivos(
      [
        linha({ etapa_id: "perdido", origem: "usuario", ator_id: null, ator_nome: "Bia", cards: 1 }),
        linha({ etapa_id: "perdido", origem: "usuario", ator_id: null, ator_nome: "Caio", cards: 2 }),
        linha({ etapa_id: "perdido", origem: "usuario", ator_id: "u1", ator_nome: "Ana", cards: 1 }),
        linha({ etapa_id: "perdido", origem: "usuario", ator_id: "u1", ator_nome: "Ana Souza", cards: 1 }),
        // automação e integração também são "sem pessoa"
        linha({ etapa_id: "perdido", origem: "automacao", cards: 1 }),
        linha({ etapa_id: "perdido", origem: "conexao", cards: 1 }),
      ],
      ETAPAS,
      [PERDA, DESQ],
    );
    expect(r.find((e) => e.etapaId === "perdido")!.semMotivo.porQuem).toEqual([
      { quem: { tipo: "pessoa", id: null, nome: "Caio" }, cards: 2 },
      { quem: { tipo: "pessoa", id: "u1", nome: "Ana" }, cards: 2 },
      { quem: { tipo: "sem_pessoa" }, cards: 2 },
      { quem: { tipo: "pessoa", id: null, nome: "Bia" }, cards: 1 },
    ]);
  });

  it("campo que deixou de ser Lista ou sumiu: todo valor vai para Outro, nada some", () => {
    const linhas = [
      linha({ etapa_id: "perdido", motivo: "Desistiu", cards: 2 }),
      linha({ etapa_id: "perdido", origem: "sistema", cards: 1 }),
    ];
    for (const campos of [[campo("campo-perda", ["Desistiu"], "text")], []]) {
      const perdido = agruparMotivos(linhas, ETAPAS, campos).find((e) => e.etapaId === "perdido")!;
      expect(perdido.total).toBe(3);
      expect(perdido.motivos).toEqual([]);
      expect(perdido.outro.textos).toEqual([{ rotulo: "Desistiu", cards: 2 }]);
      expect(perdido.semMotivo.cards).toBe(1);
    }
  });
});

describe("lerLinhaDeMotivo", () => {
  it("aceita a forma da 1113", () => {
    expect(
      lerLinhaDeMotivo({ etapa_id: "e", motivo: null, origem: "sistema", ator_id: null, ator_nome: null, cards: 2 }),
    ).toEqual({ etapa_id: "e", motivo: null, origem: "sistema", ator_id: null, ator_nome: null, cards: 2 });
  });

  it("recusa forma inesperada (não confie, nunca meia soma)", () => {
    const boa = { etapa_id: "e", motivo: "x", origem: null, ator_id: null, ator_nome: null, cards: 1 };
    for (const ruim of [
      null,
      [],
      { ...boa, etapa_id: 1 },
      { ...boa, cards: "1" },
      { ...boa, cards: 1.5 },
      { ...boa, cards: 0 },
      { ...boa, motivo: 3 },
      { ...boa, origem: undefined },
    ]) {
      expect(lerLinhaDeMotivo(ruim), JSON.stringify(ruim)).toBeNull();
    }
  });
});

describe("carregarMotivos", () => {
  const servidor = (resposta: { data: unknown[] | null; error: { message: string } | null }) => {
    const chamadas: { fn: string; args: Record<string, unknown> }[] = [];
    const db: ClienteDaRpc = {
      rpc(fn, args) {
        chamadas.push({ fn, args });
        return { order: () => Promise.resolve(resposta) };
      },
    };
    return { db, chamadas };
  };
  const boa = { etapa_id: "e", motivo: "x", origem: null, ator_id: null, ator_nome: null, cards: 1 };

  it("chama a 1113 com o período em ISO e devolve as linhas", async () => {
    const { db, chamadas } = servidor({ data: [boa], error: null });
    const desde = new Date("2026-10-01T03:00:00.000Z");
    expect(await carregarMotivos(db, { pipelineId: "f", desde, ate: null })).toEqual([boa]);
    expect(chamadas).toEqual([
      {
        fn: "cb_motivos_do_funil",
        args: { p_pipeline_id: "f", p_desde: "2026-10-01T03:00:00.000Z", p_ate: null },
      },
    ]);
  });

  it("erro, linha estranha ou resposta no teto do PostgREST → null", async () => {
    const pedido = { pipelineId: "f", desde: null, ate: null };
    expect(await carregarMotivos(servidor({ data: null, error: { message: "boom" } }).db, pedido)).toBeNull();
    expect(await carregarMotivos(servidor({ data: [boa, { ...boa, cards: "2" }], error: null }).db, pedido)).toBeNull();
    const cheia = Array.from({ length: PAGINA }, () => boa);
    expect(await carregarMotivos(servidor({ data: cheia, error: null }).db, pedido)).toBeNull();
  });
});
