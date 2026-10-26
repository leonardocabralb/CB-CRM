import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LeadEvent } from "@/types";

// ============================================================
// O painel da conversa ficava com a etapa antiga quando o agente de IA (ou
// uma automação, ou um colega no quadro) movia o card com a conversa aberta.
// O aviso vem da trilha do lead (cb_lead_events, realtime desde a 1059).
//
// Sem DOM no ambiente de teste: o React é trocado por um dublê que roda o
// efeito na hora e guarda a limpeza, e o cliente do Supabase por um canal
// falso que entrega o payload que o teste mandar.
// ============================================================

const efeito = vi.hoisted(() => ({ limpezas: [] as Array<() => void> }));

vi.mock("react", () => ({
  useRef: <T,>(v: T) => ({ current: v }),
  useEffect: (fn: () => void | (() => void)) => {
    const limpar = fn();
    if (typeof limpar === "function") efeito.limpezas.push(limpar);
  },
}));

interface CanalFalso {
  topico: string;
  filtro: Record<string, string> | null;
  entregar: ((p: { new: Partial<LeadEvent> }) => void) | null;
  inscrito: boolean;
  removido: boolean;
}
const canais = vi.hoisted(() => [] as CanalFalso[]);

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel(topico: string) {
      const c: CanalFalso = { topico, filtro: null, entregar: null, inscrito: false, removido: false };
      canais.push(c);
      const api = {
        on(_tipo: string, filtro: Record<string, string>, cb: CanalFalso["entregar"]) {
          c.filtro = filtro;
          c.entregar = cb;
          return api;
        },
        subscribe() {
          c.inscrito = true;
          return c;
        },
      };
      return api;
    },
    removeChannel(c: CanalFalso) {
      c.removido = true;
      return Promise.resolve("ok");
    },
  }),
}));

import { mudaONegocio, TIPOS_QUE_MUDAM_O_NEGOCIO, useMudancaNoNegocio } from "./use-mudanca-no-negocio";

const evento = (event_type: string, contact_id: string | null = "c-ana"): { new: Partial<LeadEvent> } => ({
  new: { id: `e-${event_type}`, event_type: event_type as LeadEvent["event_type"], contact_id },
});

beforeEach(() => {
  canais.length = 0;
  efeito.limpezas.length = 0;
});
afterEach(() => {
  for (const limpar of efeito.limpezas) limpar();
});

describe("mudaONegocio — só o que muda o card", () => {
  it("nascer, etapa, funil, status e apagar mudam o negócio", () => {
    for (const t of ["deal_created", "stage_changed", "pipeline_changed", "status_changed", "deal_deleted"]) {
      expect(mudaONegocio({ event_type: t as LeadEvent["event_type"] })).toBe(true);
    }
    expect(TIPOS_QUE_MUDAM_O_NEGOCIO.size).toBe(5);
  });

  it("etiqueta, situação da conversa, união de fichas e Lixeira não (deal_id nulo)", () => {
    for (const t of [
      "tag_added",
      "tag_removed",
      "conversation_status_changed",
      "conversation_assigned",
      "contacts_merged",
      "contact_trashed",
      "contact_restored",
    ]) {
      expect(mudaONegocio({ event_type: t as LeadEvent["event_type"] })).toBe(false);
    }
    expect(mudaONegocio(null)).toBe(false);
  });
});

describe("useMudancaNoNegocio — a assinatura", () => {
  it("assina INSERT da trilha filtrado pelo contato", () => {
    useMudancaNoNegocio("c-ana", () => {});
    expect(canais).toHaveLength(1);
    expect(canais[0].inscrito).toBe(true);
    expect(canais[0].filtro).toEqual({
      event: "INSERT",
      schema: "public",
      table: "cb_lead_events",
      filter: "contact_id=eq.c-ana",
    });
  });

  it("CRÍTICO: o agente moveu o card → avisa quem ouve", () => {
    const aoMudar = vi.fn();
    useMudancaNoNegocio("c-ana", aoMudar);
    canais[0].entregar?.(evento("stage_changed"));
    canais[0].entregar?.(evento("status_changed"));
    expect(aoMudar).toHaveBeenCalledTimes(2);
  });

  it("evento que não muda negócio (etiqueta) não relê", () => {
    const aoMudar = vi.fn();
    useMudancaNoNegocio("c-ana", aoMudar);
    canais[0].entregar?.(evento("tag_added"));
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("evento de OUTRO contato nunca avisa (o painel não relê pelo cliente errado)", () => {
    const aoMudar = vi.fn();
    useMudancaNoNegocio("c-ana", aoMudar);
    canais[0].entregar?.(evento("stage_changed", "c-outro"));
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("depois da troca de contato, o evento atrasado do canal que sai não avisa", () => {
    const aoMudar = vi.fn();
    useMudancaNoNegocio("c-ana", aoMudar);
    const canal = canais[0];
    for (const limpar of efeito.limpezas.splice(0)) limpar();
    expect(canal.removido).toBe(true);
    canal.entregar?.(evento("stage_changed"));
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("um tópico por ASSINATURA, nunca repetido (o canal que está saindo não volta)", () => {
    useMudancaNoNegocio("c-ana", () => {});
    useMudancaNoNegocio("c-ana", () => {});
    expect(canais).toHaveLength(2);
    expect(canais[0].topico).not.toBe(canais[1].topico);
    expect(canais[0].topico.startsWith("negocios:c-ana:")).toBe(true);
  });

  it("sem contato (grupo), nenhuma assinatura", () => {
    useMudancaNoNegocio(null, () => {});
    useMudancaNoNegocio(undefined, () => {});
    expect(canais).toHaveLength(0);
  });
});

// O painel é um componente grande do React sem teste de comportamento: o
// "esqueci de reler" ou "relê o contato errado" só se pega lendo o fonte.
describe("pino: o painel da conversa relê os negócios quando o card muda por fora", () => {
  const fonte = readFileSync(
    join(process.cwd(), "src/components/inbox/painel/painel-do-contato.tsx"),
    "utf8",
  );

  it("assina a mudança do contato do painel e relê só os negócios", () => {
    expect(fonte).toMatch(/useMudancaNoNegocio\(contatoDoPainel,/);
    expect(fonte).toMatch(/const recarregarNegocios = useCallback\(/);
  });

  it("a releitura confere o contato da tela antes de gravar e passa pela régua", () => {
    const corpo = fonte.slice(fonte.indexOf("const recarregarNegocios = useCallback("));
    const ate = corpo.slice(0, corpo.indexOf("}, [contatoDoPainel"));
    expect(ate).toMatch(/if \(contactIdRef\.current !== contatoDoPainel\) return;/);
    expect(ate).toMatch(/reguaDosNegocios\.podeGravar\(leitura\)/);
    // Mesmo recorte por perfil da carga do contato.
    expect(ate).toMatch(/funilNoEscopo\(acesso, d\.pipeline_id\)/);
  });

  it("a carga do contato também passa pela régua", () => {
    expect(fonte).toMatch(/const leituraDosNegocios = reguaDosNegocios\.pedir\(\);/);
    expect(fonte).toMatch(/reguaDosNegocios\.podeGravar\(leituraDosNegocios\)/);
  });

  it("as escritas do painel avisam a régua, só para o contato que está na tela", () => {
    expect(
      fonte.match(/contact_id === contactIdRef\.current && reguaDosNegocios\.escreveu\(\)/g)?.length,
    ).toBe(2);
  });

  it("a volta à aba e a reconexão (resyncToken) também releem", () => {
    expect(fonte).toMatch(/resyncVistoRef\.current = resyncToken;\s*void recarregarNegocios\(\);/);
  });
});
