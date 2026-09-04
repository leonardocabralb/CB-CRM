import { describe, expect, it } from "vitest";

import type { AccountRole } from "@/lib/auth/roles";
import { podeSimular, resolverAcesso } from "./simulacao";
import type { ContextoDeAcesso, PerfilDeAcesso } from "./tipos";

const CONTA = "conta-1";

const perfil = (patch: Partial<PerfilDeAcesso>): PerfilDeAcesso => ({
  id: "p1",
  account_id: CONTA,
  nome: "Advogado Trabalhista",
  papel_base: "agent",
  telas: ["inbox", "contacts"],
  secoes_config: ["quick-replies"],
  channel_ids: ["c1"],
  pipeline_ids: [],
  sistema: false,
  ...patch,
});

const real = (papel: AccountRole | null): ContextoDeAcesso => ({ papel, perfil: null });

describe("podeSimular", () => {
  it("admin e dono podem; agent, viewer e 'ainda carregando' não", () => {
    expect(podeSimular("owner")).toBe(true);
    expect(podeSimular("admin")).toBe(true);
    expect(podeSimular("agent")).toBe(false);
    expect(podeSimular("viewer")).toBe(false);
    expect(podeSimular(null)).toBe(false);
  });
});

describe("resolverAcesso", () => {
  it("admin vendo como agent: papel e perfil passam a ser os do alvo", () => {
    const alvo = perfil({});
    const r = resolverAcesso(real("admin"), alvo, CONTA);
    expect(r.simulado).toBe(alvo);
    expect(r.acesso).toEqual({ papel: "agent", perfil: alvo });
  });

  it("o dono que simula PERDE o curto-circuito de dono — é o ponto", () => {
    const alvo = perfil({ papel_base: "viewer" });
    const r = resolverAcesso(real("owner"), alvo, CONTA);
    expect(r.acesso.papel).toBe("viewer");
    expect(r.simulado).toBe(alvo);
  });

  it("CRÍTICO: nunca escala — agent/viewer com alvo admin ficam no acesso real", () => {
    const alvo = perfil({ papel_base: "admin" });
    for (const papel of ["agent", "viewer"] as AccountRole[]) {
      const r = resolverAcesso(real(papel), alvo, CONTA);
      expect(r.simulado).toBeNull();
      expect(r.acesso).toEqual(real(papel));
    }
  });

  it("sem alvo, ou ainda sem papel real (carregando), devolve o real intacto", () => {
    const r1 = resolverAcesso(real("admin"), null, CONTA);
    expect(r1.simulado).toBeNull();
    expect(r1.acesso).toEqual(real("admin"));
    const r2 = resolverAcesso(real(null), perfil({}), CONTA);
    expect(r2.simulado).toBeNull();
  });

  it("alvo de OUTRA conta é recusado", () => {
    const r = resolverAcesso(real("admin"), perfil({ account_id: "outra" }), CONTA);
    expect(r.simulado).toBeNull();
    expect(r.acesso).toEqual(real("admin"));
  });

  it("devolve o MESMO objeto real quando não simula — nada é recriado à toa", () => {
    const ctx = real("admin");
    expect(resolverAcesso(ctx, null, CONTA).acesso).toBe(ctx);
  });
});
