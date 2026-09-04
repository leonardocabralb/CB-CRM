import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  SECOES_PESSOAIS,
  TODAS_AS_SECOES,
  TODAS_AS_TELAS,
  type SecaoId,
  type TelaId,
} from "./catalogo";
import {
  AREA_DA_TELA,
  ORDEM_DAS_AREAS,
  alternarGrupo,
  estadoDoGrupo,
  gruposAbertosDeInicio,
  gruposDoEditor,
  itemTravado,
  modelosDePartida,
  type GrupoDoEditor,
  type ItemDoEditor,
} from "./editor";
import { PERFIS_DE_FABRICA } from "./padroes";
import { areasQueNaoOperam } from "./poderes";
import type { PapelBase } from "./tipos";

const PAPEIS: PapelBase[] = ["admin", "agent", "viewer"];

const chaves = (itens: ItemDoEditor[]) => itens.map((i) => `${i.tipo}:${i.id}`);
const telasDe = (itens: ItemDoEditor[]) =>
  itens.filter((i) => i.tipo === "tela").map((i) => i.id as TelaId);
const secoesDe = (itens: ItemDoEditor[]) =>
  itens.filter((i) => i.tipo === "secao").map((i) => i.id as SecaoId);
const grupo = (papel: PapelBase, area: GrupoDoEditor["area"]) =>
  gruposDoEditor(papel).find((g) => g.area === area);
const VAZIO = { telas: [] as TelaId[], secoes_config: [] as SecaoId[] };

describe("gruposDoEditor — cobertura", () => {
  it("CRÍTICO: todo item do catálogo aparece UMA vez, em qualquer papel", () => {
    // Fora: as três seções pessoais (aparecem sempre) e, fora do admin,
    // `perfis` (oferecê-la marcaria uma caixa inerte).
    for (const papel of PAPEIS) {
      const itens = gruposDoEditor(papel).flatMap((g) => g.itens);
      expect(new Set(chaves(itens)).size).toBe(itens.length);
      expect([...telasDe(itens)].sort()).toEqual([...TODAS_AS_TELAS].sort());
      const esperadas = TODAS_AS_SECOES.filter(
        (s) => !SECOES_PESSOAIS.includes(s) && (papel === "admin" || s !== "perfis"),
      );
      expect([...secoesDe(itens)].sort()).toEqual([...esperadas].sort());
    }
  });

  it("`AREA_DA_TELA` põe Configurações na área de Configurações", () => {
    expect(AREA_DA_TELA.settings).toBe("configuracoes");
    for (const tela of TODAS_AS_TELAS) expect(AREA_DA_TELA[tela]).toBeDefined();
  });

  it("os grupos saem na ordem fixa e grupo vazio some", () => {
    for (const papel of PAPEIS) {
      const areas = gruposDoEditor(papel).map((g) => g.area);
      const posicoes = areas.map((a) => ORDEM_DAS_AREAS.indexOf(a));
      expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
      expect(new Set(areas).size).toBe(areas.length);
    }
    // Para o Visualizador nenhuma tela de disparo é operável — o grupo não
    // pode aparecer vazio, com uma caixa de grupo que não liga nada.
    expect(grupo("viewer", "disparos")).toBeUndefined();
    expect(grupo("agent", "disparos")?.itens).toEqual([{ tipo: "tela", id: "agendadas" }]);
  });
});

describe("gruposDoEditor — 'só leitura para este papel'", () => {
  it("admin não tem o grupo: opera tudo", () => {
    expect(grupo("admin", "so-leitura")).toBeUndefined();
  });

  it("CRÍTICO: o grupo é EXATAMENTE o que `areasQueNaoOperam` apontaria com tudo marcado", () => {
    // Duas réguas para a mesma pergunta divergem na primeira mudança de
    // piso: a tela agruparia um item como operável e o aviso o chamaria de
    // somente-leitura. Uma fonte só (ESCRITA_DA_*), conferida aqui.
    for (const papel of ["agent", "viewer"] as PapelBase[]) {
      const so = grupo(papel, "so-leitura")!;
      const aviso = areasQueNaoOperam(papel, TODAS_AS_TELAS, TODAS_AS_SECOES);
      expect([...telasDe(so.itens)].sort()).toEqual([...aviso.telas].sort());
      expect([...secoesDe(so.itens)].sort()).toEqual([...aviso.secoes].sort());
    }
  });

  it("os casos que motivaram a feature: Gestor = agent com Conexões e Automações", () => {
    const so = grupo("agent", "so-leitura")!;
    const ids = chaves(so.itens);
    expect(ids).toContain("secao:channels");
    expect(ids).toContain("secao:members");
    expect(ids).toContain("tela:automations");
    expect(ids).toContain("tela:broadcasts");
    // E o que o agent OPERA não está lá.
    expect(ids).not.toContain("tela:inbox");
    expect(ids).not.toContain("secao:quick-replies");
    expect(ids).not.toContain("tela:agendadas");
  });

  it("`perfis` nunca é oferecida fora do admin — nem no grupo de só leitura", () => {
    for (const papel of ["agent", "viewer"] as PapelBase[]) {
      const itens = gruposDoEditor(papel).flatMap((g) => g.itens);
      expect(chaves(itens)).not.toContain("secao:perfis");
    }
    expect(chaves(grupo("admin", "configuracoes")!.itens)).toContain("secao:perfis");
  });
});

describe("travas", () => {
  it("Configurações (a tela) é travada para todo papel; Membros e Visão geral só para admin", () => {
    for (const papel of PAPEIS) {
      expect(itemTravado(papel, { tipo: "tela", id: "settings" })).toBe(true);
      expect(itemTravado(papel, { tipo: "tela", id: "inbox" })).toBe(false);
    }
    expect(itemTravado("admin", { tipo: "secao", id: "members" })).toBe(true);
    expect(itemTravado("admin", { tipo: "secao", id: "overview" })).toBe(true);
    expect(itemTravado("agent", { tipo: "secao", id: "overview" })).toBe(false);
    expect(itemTravado("admin", { tipo: "secao", id: "channels" })).toBe(false);
  });
});

describe("estadoDoGrupo e alternarGrupo", () => {
  const atendimento = grupo("agent", "atendimento")!;
  const configuracoes = grupo("agent", "configuracoes")!;

  it("tri-estado pelos itens livres; contagem pelos itens todos", () => {
    expect(estadoDoGrupo("agent", VAZIO, atendimento)).toEqual({
      estado: "nenhum",
      marcados: 0,
      total: 5,
    });
    expect(
      estadoDoGrupo("agent", { ...VAZIO, telas: ["inbox", "contacts"] }, atendimento).estado,
    ).toBe("alguns");
    expect(
      estadoDoGrupo(
        "agent",
        { ...VAZIO, telas: ["inbox", "contacts", "tarefas", "agenda", "notifications"] },
        atendimento,
      ).estado,
    ).toBe("todos");
    // Configurações do agent: `settings` travada (conta como marcada) +
    // overview + quick-replies. Sem nada marcado o grupo é "nenhum", mas a
    // contagem já mostra o cadeado.
    expect(estadoDoGrupo("agent", VAZIO, configuracoes)).toEqual({
      estado: "nenhum",
      marcados: 1,
      total: 3,
    });
  });

  it("ligar marca tudo que é livre, sem duplicar e sem tocar na outra lista", () => {
    const r = alternarGrupo("agent", { ...VAZIO, telas: ["inbox"] }, atendimento, true);
    expect([...r.telas].sort()).toEqual(
      ["inbox", "notifications", "tarefas", "contacts", "agenda"].sort(),
    );
    expect(r.secoes_config).toEqual([]);
  });

  it("desligar tira só os itens do grupo", () => {
    const r = alternarGrupo(
      "agent",
      { telas: ["inbox", "pipelines"], secoes_config: ["quick-replies"] },
      atendimento,
      false,
    );
    expect(r.telas).toEqual(["pipelines"]);
    expect(r.secoes_config).toEqual(["quick-replies"]);
  });

  it("⚠️ item travado nunca entra no array ao ligar o grupo", () => {
    // `settings` em `telas` daria a impressão de que dá para tirá-la
    // (padroes.ts); e `members` no admin já é forçada por `podeVerSecao`.
    const r = alternarGrupo("agent", VAZIO, configuracoes, true);
    expect(r.telas).not.toContain("settings");
    expect([...r.secoes_config].sort()).toEqual(["overview", "quick-replies"]);
    const adm = alternarGrupo("admin", VAZIO, grupo("admin", "configuracoes")!, true);
    expect(adm.secoes_config).not.toContain("members");
    expect(adm.secoes_config).not.toContain("perfis");
    expect(adm.secoes_config).toContain("channels");
  });

  it("abre de início só o grupo parcialmente marcado", () => {
    const grupos = gruposDoEditor("agent");
    expect(gruposAbertosDeInicio("agent", { ...VAZIO, telas: ["inbox"] }, grupos)).toEqual([
      "atendimento",
    ]);
    expect(gruposAbertosDeInicio("agent", VAZIO, grupos)).toEqual([]);
  });
});

describe("modelosDePartida", () => {
  it("são os três de fábrica, como cópias", () => {
    const modelos = modelosDePartida();
    expect(modelos.map((m) => [m.nome, m.papel_base])).toEqual([
      ["Administrador", "admin"],
      ["Advogado", "agent"],
      ["Observador", "viewer"],
    ]);
    for (const m of modelos) expect(m.telas.length).toBeGreaterThan(0);
    modelos[1].telas.push("broadcasts");
    expect(PERFIS_DE_FABRICA[1].telas).not.toContain("broadcasts");
  });
});

describe("dicionários", () => {
  // A mesma amarração de `poderes.test.ts`: chave montada em tempo de
  // execução (`areas.${id}`, `modelos.${papel}`) escapa do portão estático
  // de i18n, então o teste a cobra nos DOIS arquivos.
  for (const locale of ["en", "pt-BR"]) {
    it(`${locale}: uma entrada por área e por modelo`, () => {
      const dic = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
      const painel = dic.PerfisPanel;
      for (const area of ORDEM_DAS_AREAS) {
        expect(typeof painel.areas?.[area]).toBe("string");
        expect(painel.areas[area].length).toBeGreaterThan(0);
      }
      for (const papel of PAPEIS) {
        expect(typeof painel.modelos?.[papel]).toBe("string");
      }
    });
  }
});
