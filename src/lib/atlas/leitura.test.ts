import { describe, expect, it } from "vitest";

import { RECOLHER_CLAIM_MS } from "@/lib/calendly/claim";

import {
  appUrlSegura,
  candidatosPeloLink,
  decidirMudanca,
  desdeDasMudancas,
  JANELA_RECENTE_MS,
  leituraVelha,
  lidaEm,
  modoDaLeitura,
  ORCAMENTO_DO_CICLO_MS,
  PRAZO_DO_LER_AGORA_MS,
  RECOLHER_LEITURA_MS,
  semDescartados,
  SITUACOES_NA_FAIXA,
  SOBREPOSICAO_MS,
  telefoneForte,
  telefonesUnicos,
  uuidsDoLink,
  vinculosParaConferirNaLixeira,
  viraEvento,
  type EstadoDaLeitura,
  type VinculoLido,
} from "./leitura";

// ============================================================
// As regras puras da leitura das situações do Atlas (Fase 2). Dados fictícios.
// ============================================================

const AGORA = new Date("2026-09-30T15:00:00.000Z");
const ID = "00000000-0000-4000-8000-000000000011";
const URL_DO_CLIENTE = `https://app.example.com/#/clients/${ID}`;

const vinculo = (p: Partial<VinculoLido> = {}): VinculoLido => ({
  id: "v1",
  atlas_client_id: ID,
  contact_id: "ficha-1",
  situacao: "ativo",
  situacao_desde: "2026-06-01T12:00:00.000Z",
  situacao_lida_em: "2026-09-30T14:00:00.000Z",
  app_url: URL_DO_CLIENTE,
  created_at: "2026-07-01T12:00:00.000Z",
  crm_escreveu_em: null,
  excluido_no_atlas_em: null,
  visto_na_listagem_em: null,
  ...p,
});
const cliente = (status: string | null, situacaoDesde: string | null, appUrl: string | null = URL_DO_CLIENTE) => ({ id: ID, status, situacaoDesde, appUrl });

describe("decidirMudanca — a tabela inteira", () => {
  it("ignorar: a situação veio nula", () => {
    expect(decidirMudanca(vinculo(), cliente(null, null), AGORA)).toEqual({ tipo: "ignorar", grava: false });
  });

  it("recente: mudou há menos de 2 min — não grava (a sobreposição relê; fecha a corrida com o passo)", () => {
    expect(decidirMudanca(vinculo(), cliente("rescindido", "2026-09-30T14:59:00.000Z"), AGORA)).toEqual({ tipo: "recente", grava: false });
    expect(decidirMudanca(vinculo(), cliente("rescindido", "2026-09-30T14:57:59.000Z"), AGORA).tipo).toBe("mudou");
  });

  it("antiga: data anterior à guardada (página velha) — nada", () => {
    expect(decidirMudanca(vinculo({ situacao_desde: "2026-08-01T00:00:00.000Z" }), cliente("rescindido", "2026-07-01T00:00:00.000Z"), AGORA)).toEqual({
      tipo: "antiga",
      grava: false,
    });
  });

  it("primeira: o vínculo não tinha situação — grava, nunca é evento", () => {
    const d = decidirMudanca(vinculo({ situacao: null, situacao_desde: null }), cliente("rescindido", "2026-09-01T00:00:00.000Z"), AGORA);
    expect(d).toEqual({ tipo: "primeira", grava: true });
    expect(viraEvento(d)).toBe(false);
  });

  it("importado → ativo é o cadastro inicial (decisão do operador): primeira, nunca evento", () => {
    const d = decidirMudanca(vinculo({ situacao: "importado" }), cliente("ativo", "2026-09-10T00:00:00.000Z"), AGORA);
    expect(d).toEqual({ tipo: "primeira", grava: true });
    expect(viraEvento(d)).toBe(false);
  });

  it("igual: sem diferença de maiúsculas; em_negociacao vale ativo — grava só o que mudou", () => {
    expect(decidirMudanca(vinculo(), cliente("ATIVO", "2026-06-01T12:00:00.000Z"), AGORA)).toEqual({ tipo: "igual", grava: false });
    expect(decidirMudanca(vinculo(), cliente("ativo", "2026-06-01T12:00:00.000Z"), AGORA)).toEqual({ tipo: "igual", grava: false });
    // Gravada como veio: a grafia muda o que está no banco.
    expect(decidirMudanca(vinculo(), cliente("em_negociacao", "2026-06-01T12:00:00.000Z"), AGORA)).toEqual({ tipo: "igual", grava: true });
    expect(decidirMudanca(vinculo({ situacao: "em_negociacao" }), cliente("ativo", "2026-06-01T12:00:00.000Z"), AGORA).tipo).toBe("igual");
    // A data, o app_url ou a lixeira fazem gravar.
    expect(decidirMudanca(vinculo(), cliente("ativo", "2026-06-02T12:00:00.000Z"), AGORA).grava).toBe(true);
    expect(decidirMudanca(vinculo({ app_url: null }), cliente("ativo", "2026-06-01T12:00:00.000Z"), AGORA).grava).toBe(true);
    expect(decidirMudanca(vinculo({ excluido_no_atlas_em: "2026-09-29T00:00:00.000Z" }), cliente("ativo", "2026-06-01T12:00:00.000Z"), AGORA).grava).toBe(true);
    // app_url inseguro não conta como mudança (nem é gravado).
    expect(decidirMudanca(vinculo(), cliente("ativo", "2026-06-01T12:00:00.000Z", "javascript:alert(1)"), AGORA).grava).toBe(false);
  });

  it("mudou_sem_data: mudou e o Atlas não sabe quando — grava, nunca é evento", () => {
    const d = decidirMudanca(vinculo(), cliente("rescindido", null), AGORA);
    expect(d).toEqual({ tipo: "mudou_sem_data", grava: true });
    expect(viraEvento(d)).toBe(false);
  });

  it("corrigida: mudou ANTES de o vínculo existir (o CRM só não tinha lido) — grava, nunca é evento", () => {
    const d = decidirMudanca(vinculo({ situacao_desde: null }), cliente("rescindido", "2026-06-15T00:00:00.000Z"), AGORA);
    expect(d).toEqual({ tipo: "corrigida", grava: true });
    expect(viraEvento(d)).toBe(false);
  });

  it("mudou: situação diferente, depois do vínculo — grava e é o evento da Fase 4", () => {
    const d = decidirMudanca(vinculo(), cliente("rescindido", "2026-09-20T00:00:00.000Z"), AGORA);
    expect(d).toEqual({ tipo: "mudou", grava: true });
    expect(viraEvento(d)).toBe(true);
    // em_negociacao → rescindido é mudança de verdade.
    expect(decidirMudanca(vinculo({ situacao: "em_negociacao" }), cliente("rescindido", "2026-09-20T00:00:00.000Z"), AGORA).tipo).toBe("mudou");
  });
});

describe("os sinais do vínculo automático", () => {
  it("uuidsDoLink: só os uuids, em minúsculas, sem repetir; lixo e texto não passam", () => {
    const u = "00000000-0000-4000-8000-0000000000c1";
    expect(uuidsDoLink(`https://crm.example.com/inbox?c=${u.toUpperCase()}&x=${u}`)).toEqual([u]);
    expect(uuidsDoLink("https://crm.example.com/contatos/abc")).toEqual([]);
    expect(uuidsDoLink(null)).toEqual([]);
    expect(uuidsDoLink(42)).toEqual([]);
    // Um uuid colado num hex mais longo não é uuid.
    expect(uuidsDoLink(`ff${u}`)).toEqual([]);
  });

  it("telefoneForte: a régua do digitado (ganha 55), a grafia canônica (nono dígito) e 12 dígitos ou mais", () => {
    expect(telefoneForte("11 98765-4321")).toBe("5511987654321");
    expect(telefoneForte("+55 (11) 8765-4321")).toBe("5511987654321");
    expect(telefoneForte("(11) 3456-7890")).toBe("551134567890");
    // Sem DDD, com letra, tronco, estrangeiro curto: fora.
    expect(telefoneForte("98765-4321")).toBeNull();
    expect(telefoneForte("11 9876 ramal 45")).toBeNull();
    expect(telefoneForte("011 98765-4321")).toBeNull();
    expect(telefoneForte("+1 555 123 4567")).toBeNull();
    expect(telefoneForte(null)).toBeNull();
  });

  it("appUrlSegura: só https e só se apontar para o próprio cliente", () => {
    expect(appUrlSegura(URL_DO_CLIENTE, ID)).toBe(URL_DO_CLIENTE);
    expect(appUrlSegura("http://app.example.com/#/clients/" + ID, ID)).toBeNull();
    expect(appUrlSegura("https://app.example.com/#/clients/outro", ID)).toBeNull();
    expect(appUrlSegura("javascript:alert(1)", ID)).toBeNull();
    expect(appUrlSegura(null, ID)).toBeNull();
  });

  it("candidatosPeloLink: uma ficha = candidato; conversa de grupo fora; duas fichas = ambíguo; ficha disputada derruba todos", () => {
    const conversas = new Map<string, string | null>([
      ["conv-a", "ficha-a"],
      ["conv-a2", "ficha-a"],
      ["conv-grupo", null],
      ["conv-b", "ficha-b"],
      ["conv-c", "ficha-c"],
      ["conv-d1", "ficha-d"],
      ["conv-d2", "ficha-d"],
    ]);
    const contatos = new Set(["ficha-a", "ficha-e"]);
    const r = candidatosPeloLink(
      [
        { id: "atlas-1", uuids: ["conv-a", "conv-a2", "ficha-a"] }, // a mesma ficha por três caminhos
        { id: "atlas-2", uuids: ["conv-grupo"] }, // grupo: sem ficha
        { id: "atlas-3", uuids: ["conv-b", "conv-c"] }, // duas fichas: ambíguo
        { id: "atlas-4", uuids: ["conv-d1"] }, // ficha-d disputada…
        { id: "atlas-5", uuids: ["conv-d2"] }, // …pelos dois: ambos fora
        { id: "atlas-6", uuids: ["ficha-e"] }, // o link antigo, direto na ficha
        { id: "atlas-7", uuids: ["nada"] },
      ],
      conversas,
      contatos,
    );
    expect(r.pares).toEqual([
      { atlasClientId: "atlas-1", contactId: "ficha-a" },
      { atlasClientId: "atlas-6", contactId: "ficha-e" },
    ]);
    expect(r.ambiguos).toBe(3);
    expect([...r.comAlgumaFicha].sort()).toEqual(["atlas-1", "atlas-3", "atlas-4", "atlas-5", "atlas-6"]);
  });

  it("semDescartados: ficha já ligada neste ambiente e par recusado por gente ficam fora", () => {
    const pares = [
      { atlasClientId: "a1", contactId: "f1" },
      { atlasClientId: "a2", contactId: "f2" },
      { atlasClientId: "a3", contactId: "f3" },
    ];
    expect(semDescartados(pares, new Set(["f1"]), new Set(["f2:a2", "f3:outro"]))).toEqual([{ atlasClientId: "a3", contactId: "f3" }]);
  });

  it("telefonesUnicos: só o telefone de UM cliente na listagem inteira (inclusive os já vinculados), fora das conexões e dos excluídos", () => {
    const listagem = [
      { id: "a1", telefone: "5511987654321" },
      { id: "a2", telefone: "5511911112222" },
      { id: "a3", telefone: "5511911112222" }, // repetido: nenhum dos dois
      { id: "a4", telefone: "5511933334444" }, // vinculado: fora, mas conta
      { id: "a5", telefone: "5511933334444" },
      { id: "a6", telefone: "5511955556666" }, // o número do escritório
      { id: "a7", telefone: null },
      { id: "a1", telefone: "5511987654321" }, // o cursor repete: continua um cliente só
    ];
    const r = telefonesUnicos(listagem, new Set(["a4"]), new Set(["5511955556666"]));
    expect([...r]).toEqual([["5511987654321", "a1"]]);
  });
});

describe("o modo do ciclo e o cadeado", () => {
  const vazio: EstadoDaLeitura = {
    situacoes_lidas_ate: null,
    mudancas_desde: null,
    mudancas_cursor: null,
    mudancas_iniciada_em: null,
    listagem_completa_em: null,
    listagem_iniciada_em: null,
    listagem_cursor: null,
  };
  const FUSO = "America/Sao_Paulo";

  it("primeira vez: só a listagem completa, do zero", () => {
    expect(modoDaLeitura(vazio, AGORA, FUSO, false)).toEqual({ mudancas: false, listagem: true, recomecar: true });
  });

  it("depois da primeira: as mudanças sempre; a listagem só a diária (03:00 no fuso), a em curso ou a pedida", () => {
    const lido = { ...vazio, situacoes_lidas_ate: "2026-09-30T14:40:00.000Z", listagem_completa_em: "2026-09-30T07:00:00.000Z" };
    expect(modoDaLeitura(lido, AGORA, FUSO, false)).toEqual({ mudancas: true, listagem: false, recomecar: true });
    // Virou o dia no fuso, antes das 03:00: ainda não; depois: sim.
    const ontem = { ...lido, listagem_completa_em: "2026-09-29T07:00:00.000Z" };
    expect(modoDaLeitura(ontem, new Date("2026-09-30T05:30:00.000Z"), FUSO, false).listagem).toBe(false);
    expect(modoDaLeitura(ontem, new Date("2026-09-30T06:30:00.000Z"), FUSO, false).listagem).toBe(true);
    // Em curso: continua de onde parou.
    const emCurso = { ...lido, listagem_iniciada_em: "2026-09-30T14:00:00.000Z", listagem_cursor: "c" };
    expect(modoDaLeitura(emCurso, AGORA, FUSO, false)).toEqual({ mudancas: true, listagem: true, recomecar: false });
    // Pedida no "Ler agora": recomeça.
    expect(modoDaLeitura(emCurso, AGORA, FUSO, true)).toEqual({ mudancas: true, listagem: true, recomecar: true });
  });

  it("o statusChangedSince recua a sobreposição; a sobreposição cobre a janela 'recente'", () => {
    expect(desdeDasMudancas("2026-09-30T15:00:00.000Z")).toBe("2026-09-30T14:55:00.000Z");
    expect(SOBREPOSICAO_MS).toBeGreaterThan(JANELA_RECENTE_MS);
  });

  it("CRÍTICO: o recolhimento do cadeado é maior que o prazo mais o timeout de uma chamada (sem dois ciclos juntos)", () => {
    const TIMEOUT_DA_CHAMADA_MS = 15_000; // `cliente.ts`
    // Pior caso: o prazo passa com uma chamada em voo, e ainda sobram as escritas.
    expect(RECOLHER_LEITURA_MS).toBeGreaterThan(ORCAMENTO_DO_CICLO_MS + TIMEOUT_DA_CHAMADA_MS * 2);
    expect(RECOLHER_LEITURA_MS).toBeGreaterThan(PRAZO_DO_LER_AGORA_MS + TIMEOUT_DA_CHAMADA_MS * 2);
    // O mesmo prazo dos cadeados irmãos.
    expect(RECOLHER_LEITURA_MS).toBe(RECOLHER_CLAIM_MS);
  });
});

describe("a lixeira", () => {
  const COMPLETA = "2026-09-30T06:00:00.000Z";
  it("só os com ficha, fora da lixeira, criados antes da listagem e que ela não viu; os de leitura mais antiga primeiro, no máximo 5", () => {
    const vs = [
      vinculo({ id: "visto", visto_na_listagem_em: COMPLETA }),
      vinculo({ id: "orfa", contact_id: null }),
      vinculo({ id: "ja-na-lixeira", excluido_no_atlas_em: "2026-09-29T00:00:00.000Z" }),
      vinculo({ id: "novo", created_at: "2026-09-30T10:00:00.000Z" }),
      vinculo({ id: "c", situacao_lida_em: "2026-09-30T03:00:00.000Z", visto_na_listagem_em: "2026-09-29T06:00:00.000Z" }),
      vinculo({ id: "a", situacao_lida_em: null }),
      vinculo({ id: "b", situacao_lida_em: "2026-09-01T00:00:00.000Z" }),
      vinculo({ id: "d", situacao_lida_em: "2026-09-30T04:00:00.000Z" }),
      vinculo({ id: "e", situacao_lida_em: "2026-09-30T05:00:00.000Z" }),
      vinculo({ id: "f", situacao_lida_em: "2026-09-30T05:30:00.000Z" }),
    ];
    expect(vinculosParaConferirNaLixeira(vs, COMPLETA).map((v) => v.id)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("frescor e faixa", () => {
  it("lidaEm: a mais recente entre a linha e a varredura", () => {
    expect(lidaEm("2026-09-30T10:00:00.000Z", "2026-09-30T11:00:00.000Z")).toBe("2026-09-30T11:00:00.000Z");
    expect(lidaEm("2026-09-30T12:00:00.000Z", "2026-09-30T11:00:00.000Z")).toBe("2026-09-30T12:00:00.000Z");
    expect(lidaEm(null, null)).toBeNull();
  });

  it("leituraVelha: sem leitura, com erro, ou há mais de uma hora", () => {
    expect(leituraVelha("2026-09-30T14:30:00.000Z", null, AGORA)).toBe(false);
    expect(leituraVelha("2026-09-30T13:30:00.000Z", null, AGORA)).toBe(true);
    expect(leituraVelha("2026-09-30T14:30:00.000Z", "limite", AGORA)).toBe(true);
    expect(leituraVelha(null, null, AGORA)).toBe(true);
  });

  it("as situações que acendem a faixa (decisão do operador, 30/09)", () => {
    expect([...SITUACOES_NA_FAIXA]).toEqual(["rescindido", "finalizado", "suspenso", "inativo"]);
  });
});
