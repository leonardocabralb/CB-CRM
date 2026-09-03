import { describe, it, expect } from "vitest";
import { FILTROS_VAZIOS } from "./filtros";
import type { CatalogosDoFiltro, FiltroSalvo } from "./filtros-salvos";
import { estadoDasVisoes } from "./visoes";

const cat = {
  canais: [{ id: "c1", label: "Comercial" }, { id: "c2", label: "Jurídico" }],
  responsaveis: [],
  etapas: [],
  funis: new Map(),
  etiquetas: [{ id: "t1", name: "VIP", color: "#000" }],
} as unknown as CatalogosDoFiltro;

const salvo = (id: string, nome: string, patch: Partial<FiltroSalvo["filtros"]>): FiltroSalvo => ({
  id,
  nome,
  filtros: { ...FILTROS_VAZIOS, ...patch },
});
const comercial = salvo("f1", "Comercial", { canalIds: ["c1"] });
const vip = salvo("f2", "VIP", { etiquetaIds: ["t1"] });
const morto = salvo("f3", "Antigo", { canalIds: ["sumiu"] });

describe("estadoDasVisoes", () => {
  it("sem recorte: 'Todas' ativa, nenhum chip aceso, nada a salvar", () => {
    const e = estadoDasVisoes({ salvos: [comercial, vip], padraoId: null, atual: FILTROS_VAZIOS, baseId: null, catalogos: cat });
    expect(e.todasAtiva).toBe(true);
    expect(e.chips.map((c) => c.ativa)).toEqual([false, false]);
    expect(e.podeSalvar).toBe(false);
  });

  it("a aba Encerradas não tira 'Todas' de ativa (situação fica fora da conta)", () => {
    const e = estadoDasVisoes({ salvos: [comercial], padraoId: null, atual: { ...FILTROS_VAZIOS, status: "closed" }, baseId: null, catalogos: cat });
    expect(e.todasAtiva).toBe(true);
  });

  it("recorte igual a um salvo acende o chip; o padrão vem primeiro", () => {
    const e = estadoDasVisoes({ salvos: [comercial, vip], padraoId: "f2", atual: { ...FILTROS_VAZIOS, canalIds: ["c1"] }, baseId: null, catalogos: cat });
    expect(e.chips.map((c) => c.nome)).toEqual(["VIP", "Comercial"]);
    expect(e.chips.find((c) => c.id === "f1")?.ativa).toBe(true);
    expect(e.todasAtiva).toBe(false);
    expect(e.podeSalvar).toBe(false);
  });

  it("recorte que não é nenhum salvo: pode salvar como novo", () => {
    const e = estadoDasVisoes({ salvos: [comercial], padraoId: null, atual: { ...FILTROS_VAZIOS, canalIds: ["c2"] }, baseId: null, catalogos: cat });
    expect(e.podeSalvar).toBe(true);
    expect(e.mexida).toBe(false);
  });

  it("partiu de um salvo e mexeu: base + mexida (salvar alterações)", () => {
    const e = estadoDasVisoes({ salvos: [comercial], padraoId: null, atual: { ...FILTROS_VAZIOS, canalIds: ["c1"], favoritas: true }, baseId: "f1", catalogos: cat });
    expect(e.base?.id).toBe("f1");
    expect(e.mexida).toBe(true);
    expect(e.chips[0].ativa).toBe(false);
  });

  it("filtro cujas conexões estão todas fora do escopo some da fileira; com catálogo vazio, fica", () => {
    expect(
      estadoDasVisoes({ salvos: [morto], padraoId: null, atual: FILTROS_VAZIOS, baseId: null, catalogos: cat }).chips,
    ).toHaveLength(0);
    expect(
      estadoDasVisoes({ salvos: [morto], padraoId: null, atual: FILTROS_VAZIOS, baseId: null, catalogos: { ...cat, canais: [] } }).chips,
    ).toHaveLength(1);
  });

  it("filtro salvo que virou vazio depois da limpeza nunca acende", () => {
    const soEtiquetaMorta = salvo("f4", "Órfão", { etiquetaIds: ["sumiu"] });
    const e = estadoDasVisoes({ salvos: [soEtiquetaMorta], padraoId: null, atual: FILTROS_VAZIOS, baseId: null, catalogos: cat });
    expect(e.chips[0].ativa).toBe(false);
    expect(e.todasAtiva).toBe(true);
  });
});
