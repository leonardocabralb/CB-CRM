import { describe, expect, it } from "vitest";
import type { ContextoDeAcesso, PerfilDeAcesso } from "@/lib/perfis/tipos";
import {
  LIMITE_DE_ATRASO_MS,
  PREFERENCIA_PADRAO,
  chaveDaPreferencia,
  dependeDoResponsavel,
  lerPreferencia,
  silencioDoAviso,
  type ConversaDoAviso,
  type QuaisConversas,
} from "./aviso-no-navegador";

const EU = "u-eu";
const OUTRO = "u-outro";
const AGORA = Date.parse("2026-09-24T15:00:00Z");

function perfil(over: Partial<PerfilDeAcesso> = {}): PerfilDeAcesso {
  return {
    id: "p1",
    account_id: "a1",
    nome: "Atendente",
    papel_base: "agent",
    telas: ["inbox"],
    secoes_config: [],
    channel_ids: ["canal-a"],
    pipeline_ids: [],
    sistema: false,
    ...over,
  };
}

const RESTRITO: ContextoDeAcesso = { papel: "agent", perfil: perfil() };
const DONO: ContextoDeAcesso = { papel: "owner", perfil: null };

function conversa(over: Partial<ConversaDoAviso> = {}): ConversaDoAviso {
  return { id: "c1", channel_id: "canal-a", group_id: null, group: null, assigned_agent_id: undefined, ...over };
}

function decide(over: {
  conversa?: Partial<ConversaDoAviso>;
  ctx?: ContextoDeAcesso;
  quais?: QuaisConversas;
  created_at?: string;
  gravada_em?: string | null;
  canalDaMensagem?: string | null;
} = {}) {
  return silencioDoAviso({
    mensagem: {
      created_at: over.created_at ?? new Date(AGORA - 5_000).toISOString(),
      gravada_em: over.gravada_em === undefined ? new Date(AGORA).toISOString() : over.gravada_em,
      channel_id: over.canalDaMensagem ?? null,
    },
    conversa: conversa(over.conversa),
    ctx: over.ctx ?? RESTRITO,
    userId: EU,
    quais: over.quais ?? "todas",
    agoraMs: AGORA,
  });
}

describe("lerPreferencia — parse, nunca `as`", () => {
  it("ausente, JSON quebrado, array ou valor solto viram o padrão (desligado)", () => {
    for (const t of [null, "", "{", "[]", "1", "true", '"x"']) {
      expect(lerPreferencia(t)).toEqual(PREFERENCIA_PADRAO);
    }
    expect(PREFERENCIA_PADRAO.ativo).toBe(false);
  });

  it("só o booleano `true` liga; `\"true\"` e `1` não", () => {
    expect(lerPreferencia('{"ativo":true}').ativo).toBe(true);
    expect(lerPreferencia('{"ativo":"true"}').ativo).toBe(false);
    expect(lerPreferencia('{"ativo":1}').ativo).toBe(false);
  });

  it("quais desconhecido cai no padrão; mostrarTexto só aceita booleano", () => {
    expect(lerPreferencia('{"ativo":true,"quais":"grupos"}').quais).toBe("todas");
    expect(lerPreferencia('{"quais":"minhas"}').quais).toBe("minhas");
    expect(lerPreferencia('{"mostrarTexto":false}').mostrarTexto).toBe(false);
    expect(lerPreferencia('{"mostrarTexto":0}').mostrarTexto).toBe(true);
  });

  it("a chave é POR PESSOA (a do original era global)", () => {
    expect(chaveDaPreferencia("a")).not.toBe(chaveDaPreferencia("b"));
    expect(chaveDaPreferencia("a")).not.toContain("wacrm");
  });
});

describe("silencioDoAviso — quem recebe o aviso (P2)", () => {
  it("conversa 1:1 nova, na conexão do perfil: avisa", () => {
    expect(decide()).toBeNull();
  });

  it("GRUPO nunca avisa, nem para o dono da conta", () => {
    expect(decide({ conversa: { group_id: "g1", group: { channel_id: "canal-a" } as ConversaDoAviso["group"] } })).toBe("grupo");
    expect(decide({ ctx: DONO, conversa: { group_id: "g1" } })).toBe("grupo");
  });

  it("conexão FORA do perfil não avisa; sem recorte (dono) avisa", () => {
    expect(decide({ conversa: { channel_id: "canal-b" } })).toBe("fora_do_perfil");
    expect(decide({ ctx: DONO, conversa: { channel_id: "canal-b" } })).toBeNull();
    // Perfil com channel_ids vazio = TODAS as conexões (convenção do projeto).
    expect(
      decide({ ctx: { papel: "agent", perfil: perfil({ channel_ids: [] }) }, conversa: { channel_id: "canal-b" } }),
    ).toBeNull();
  });

  it("conversa SEM canal (anterior à 903) passa: não se esconde por ignorância", () => {
    expect(decide({ conversa: { channel_id: null } })).toBeNull();
  });

  it("conversa NOVA, ainda sem canal: vale o canal carimbado na mensagem", () => {
    // O canal chega à conversa depois do INSERT da mensagem; lida antes, a
    // coluna nula deixaria passar a conversa de outra conexão.
    expect(decide({ conversa: { channel_id: null }, canalDaMensagem: "canal-b" })).toBe("fora_do_perfil");
    expect(decide({ conversa: { channel_id: null }, canalDaMensagem: "canal-a" })).toBeNull();
    // Conversa FIXADA: manda o canal dela (a mensagem pode ser de outro número).
    expect(
      decide({ conversa: { channel_id: "canal-a", channel_pinned: true }, canalDaMensagem: "canal-b" }),
    ).toBeNull();
    // Grupo continua fora, com ou sem canal na mensagem.
    expect(decide({ conversa: { channel_id: null, group_id: "g1" }, canalDaMensagem: "canal-a" })).toBe("grupo");
  });

  it("conversa SOLTA com o canal velho: vale o da mensagem (o `follow` troca depois do INSERT)", () => {
    // O cliente escreveu pelo número B numa conversa que estava no A e não
    // tem pino: quem é do A não recebe, quem é do B recebe (Codex, PR #287).
    expect(
      decide({ conversa: { channel_id: "canal-a", channel_pinned: false }, canalDaMensagem: "canal-b" }),
    ).toBe("fora_do_perfil");
    expect(
      decide({ conversa: { channel_id: "canal-b", channel_pinned: false }, canalDaMensagem: "canal-a" }),
    ).toBeNull();
    // Sem carimbo na mensagem, fica o da conversa.
    expect(decide({ conversa: { channel_id: "canal-b" }, canalDaMensagem: null })).toBe("fora_do_perfil");
  });

  it("só as opções que leem o responsável esperam a atribuição", () => {
    expect(dependeDoResponsavel("todas")).toBe(false);
    expect(dependeDoResponsavel("minhas")).toBe(true);
    expect(dependeDoResponsavel("minhas_e_sem_responsavel")).toBe(true);
  });

  it("perfil sem a Caixa de entrada não avisa (o clique cairia na TelaBloqueada)", () => {
    expect(decide({ ctx: { papel: "agent", perfil: perfil({ telas: ["pipelines"] }) } })).toBe(
      "sem_caixa_de_entrada",
    );
  });

  it("'minhas': só a atribuída a mim", () => {
    expect(decide({ quais: "minhas", conversa: { assigned_agent_id: EU } })).toBeNull();
    expect(decide({ quais: "minhas", conversa: { assigned_agent_id: undefined } })).toBe("nao_e_sua");
    expect(decide({ quais: "minhas", conversa: { assigned_agent_id: OUTRO } })).toBe("nao_e_sua");
  });

  it("'minhas_e_sem_responsavel': a minha e a sem dono; a de outra pessoa não", () => {
    expect(decide({ quais: "minhas_e_sem_responsavel", conversa: { assigned_agent_id: EU } })).toBeNull();
    expect(decide({ quais: "minhas_e_sem_responsavel", conversa: { assigned_agent_id: undefined } })).toBeNull();
    expect(decide({ quais: "minhas_e_sem_responsavel", conversa: { assigned_agent_id: OUTRO } })).toBe(
      "nao_e_sua",
    );
  });

  it("'todas': a de outra pessoa também avisa", () => {
    expect(decide({ quais: "todas", conversa: { assigned_agent_id: OUTRO } })).toBeNull();
  });
});

describe("silencioDoAviso — mensagem ANTIGA gravada agora não avisa", () => {
  it("gravada mais de 1 h depois do carimbo (carga, recuperada tardia): silêncio", () => {
    const gravada = new Date(AGORA).toISOString();
    expect(
      decide({ created_at: new Date(AGORA - LIMITE_DE_ATRASO_MS - 1_000).toISOString(), gravada_em: gravada }),
    ).toBe("antiga");
  });

  it("atraso de entrega real (50 min) ainda avisa: o cliente está esperando", () => {
    expect(
      decide({ created_at: new Date(AGORA - 50 * 60_000).toISOString(), gravada_em: new Date(AGORA).toISOString() }),
    ).toBeNull();
  });

  it("sem gravada_em (carga antiga), a régua usa o relógio da tela", () => {
    expect(decide({ created_at: "2026-03-01T12:00:00Z", gravada_em: null })).toBe("antiga");
    expect(decide({ created_at: new Date(AGORA - 60_000).toISOString(), gravada_em: null })).toBeNull();
  });

  it("carimbo no FUTURO (relógio do aparelho adiantado) não é antiga", () => {
    expect(decide({ created_at: new Date(AGORA + 10 * 60_000).toISOString() })).toBeNull();
  });

  it("a mais antiga que a régua olha é a GRAVAÇÃO, não o relógio da tela", () => {
    // Recebida às 10:00, gravada às 10:01 e o evento processado às 14:00 (aba
    // dormindo): continua sendo mensagem nova.
    const carimbo = AGORA - 4 * 60 * 60_000;
    expect(
      decide({ created_at: new Date(carimbo).toISOString(), gravada_em: new Date(carimbo + 60_000).toISOString() }),
    ).toBeNull();
  });
});
