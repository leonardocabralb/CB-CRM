import { describe, expect, it } from "vitest";

import type { Tag } from "@/types";
import {
  conversaDoCard,
  destinoDoCard,
  normalizarDealDoQuadro,
  type RawDealDoQuadro,
  type ResumoDaConversa,
} from "./cartao";

function resumo(id: string, at: string | null = null): ResumoDaConversa {
  return { id, unread_count: 0, last_message_text: null, last_message_at: at };
}

function tag(id: string): Tag {
  return { id, user_id: "u1", name: `tag-${id}`, color: "#3b82f6", created_at: "2026-01-01" };
}

function contato(
  extras: Partial<NonNullable<RawDealDoQuadro["contact"]>> = {},
): NonNullable<RawDealDoQuadro["contact"]> {
  return {
    id: "c1",
    user_id: "u1",
    account_id: "a1",
    phone: "5511999990000",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...extras,
  };
}

function dealCru(extras: Partial<RawDealDoQuadro> = {}): RawDealDoQuadro {
  return {
    id: "d1",
    user_id: "u1",
    pipeline_id: "p1",
    stage_id: "s1",
    contact_id: "c1",
    title: "Negócio",
    value: 0,
    created_at: "2026-08-30T00:00:00+00:00",
    ...extras,
  };
}

describe("normalizarDealDoQuadro — formas do embed", () => {
  it("conversations como ARRAY vira `conversa`", () => {
    const deal = normalizarDealDoQuadro(
      dealCru({ contact: contato({ conversations: [resumo("cv1")] }) }),
    );
    expect(deal.conversa?.id).toBe("cv1");
  });

  it("conversations como OBJETO (caso o PostgREST detecte 1:1) também vira", () => {
    const deal = normalizarDealDoQuadro(
      dealCru({ contact: contato({ conversations: resumo("cv1") }) }),
    );
    expect(deal.conversa?.id).toBe("cv1");
  });

  it("array vazio / campo ausente → conversa null", () => {
    expect(
      normalizarDealDoQuadro(dealCru({ contact: contato({ conversations: [] }) }))
        .conversa,
    ).toBeNull();
    expect(
      normalizarDealDoQuadro(dealCru({ contact: contato() })).conversa,
    ).toBeNull();
  });

  it("negócio sem contato passa limpo (contato apagado continua no quadro)", () => {
    const deal = normalizarDealDoQuadro(dealCru({ contact: null, contact_id: null }));
    expect(deal.contact).toBeUndefined();
    expect(deal.conversa).toBeNull();
  });

  it("achata contact_tags em contact.tags, descartando join órfão (tags: null)", () => {
    const deal = normalizarDealDoQuadro(
      dealCru({
        contact: contato({
          contact_tags: [{ tags: tag("t1") }, { tags: null }, { tags: tag("t2") }],
        }),
      }),
    );
    expect(deal.contact?.tags?.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(
      (deal.contact as unknown as Record<string, unknown>).contact_tags,
    ).toBeUndefined();
  });

  it("várias conversas: vence a que casa com deal.conversation_id", () => {
    const deal = normalizarDealDoQuadro(
      dealCru({
        conversation_id: "cv2",
        contact: contato({
          conversations: [resumo("cv1", "2026-08-30T10:00:00+00:00"), resumo("cv2")],
        }),
      }),
    );
    expect(deal.conversa?.id).toBe("cv2");
  });

  it("sem casar com o vínculo, vence a de last_message_at mais recente; nulo perde da preenchida", () => {
    const deal = normalizarDealDoQuadro(
      dealCru({
        contact: contato({
          conversations: [
            resumo("parada"),
            resumo("antiga", "2026-08-01T10:00:00+00:00"),
            resumo("recente", "2026-08-30T10:00:00+00:00"),
          ],
        }),
      }),
    );
    expect(deal.conversa?.id).toBe("recente");
  });
});

describe("conversaDoCard — precedência do deal-form", () => {
  it("deal.conversation_id vence a conversa do contato", () => {
    const deal = normalizarDealDoQuadro(
      dealCru({
        conversation_id: "cv1",
        contact: contato({ conversations: [resumo("cv1")] }),
      }),
    );
    expect(conversaDoCard(deal)).toEqual({ id: "cv1", resumo: resumo("cv1") });
  });

  it("sem vínculo gravado, cai na conversa do contato (negócio pré-910)", () => {
    const deal = normalizarDealDoQuadro(
      dealCru({ contact: contato({ conversations: [resumo("cv1")] }) }),
    );
    expect(conversaDoCard(deal)?.id).toBe("cv1");
  });

  it("nenhuma conversa → null", () => {
    const deal = normalizarDealDoQuadro(dealCru({ contact: contato() }));
    expect(conversaDoCard(deal)).toBeNull();
  });

  it("⚠️ vínculo divergente da conversa do contato: navega para o GRAVADO e resumo null (não pintar a prévia de uma conversa e abrir outra)", () => {
    const deal = normalizarDealDoQuadro(
      dealCru({
        conversation_id: "cv-historica",
        contact: contato({ conversations: [resumo("cv-do-contato")] }),
      }),
    );
    expect(conversaDoCard(deal)).toEqual({ id: "cv-historica", resumo: null });
  });
});

describe("destinoDoCard", () => {
  it("com conversa → abre a conversa", () => {
    const deal = normalizarDealDoQuadro(
      dealCru({ conversation_id: "cv1", contact: contato() }),
    );
    expect(destinoDoCard(deal)).toEqual({ tipo: "conversa", conversationId: "cv1" });
  });

  it("sem conversa nenhuma → formulário (o comportamento de sempre)", () => {
    const deal = normalizarDealDoQuadro(dealCru({ contact: null, contact_id: null }));
    expect(destinoDoCard(deal)).toEqual({ tipo: "formulario" });
  });
});
