import { describe, expect, it } from "vitest";

import type { Conversation } from "@/types";
import {
  ROTA_DA_TELA,
  TODAS_AS_SECOES,
  TODAS_AS_TELAS,
  ehSecaoConhecida,
  ehTelaConhecida,
} from "./catalogo";
import {
  canaisVisiveis,
  canalNoEscopo,
  conversaNoEscopo,
  funilNoEscopo,
  funisVisiveis,
  recorteDeCanais,
  resumoDoEscopo,
} from "./escopo";
import { PERFIS_DE_FABRICA } from "./padroes";
import type { ContextoDeAcesso, PerfilDeAcesso } from "./tipos";
import { podeVerSecao, podeVerTela, telaDoCaminho } from "./visibilidade";

function perfil(patch: Partial<PerfilDeAcesso> = {}): PerfilDeAcesso {
  return {
    id: "p1",
    account_id: "a1",
    nome: "Advogado Trabalhista",
    papel_base: "agent",
    telas: ["inbox", "contacts"],
    secoes_config: [],
    channel_ids: [],
    pipeline_ids: [],
    sistema: false,
    ...patch,
  };
}

const DONO: ContextoDeAcesso = { papel: "owner", perfil: null };
const SEM_PERFIL: ContextoDeAcesso = { papel: "agent", perfil: null };

function ctx(p: Partial<PerfilDeAcesso> = {}): ContextoDeAcesso {
  const pf = perfil(p);
  return { papel: pf.papel_base, perfil: pf };
}

function conversa(patch: Partial<Conversation> = {}): Conversation {
  return {
    id: "c1",
    user_id: "u1",
    contact_id: "ct1",
    status: "open",
    unread_count: 0,
    created_at: "",
    updated_at: "",
    ...patch,
  } as Conversation;
}

// ============================================================
describe("catálogo", () => {
  it("toda tela tem rota", () => {
    for (const tela of TODAS_AS_TELAS) {
      expect(ROTA_DA_TELA[tela]).toMatch(/^\//);
    }
  });

  it("não há rota duplicada — duas telas na mesma rota tornam a guarda ambígua", () => {
    const rotas = Object.values(ROTA_DA_TELA);
    expect(new Set(rotas).size).toBe(rotas.length);
  });

  it("os type guards recusam id desconhecido", () => {
    expect(ehTelaConhecida("inbox")).toBe(true);
    expect(ehTelaConhecida("tela-que-nao-existe")).toBe(false);
    expect(ehSecaoConhecida("members")).toBe(true);
    expect(ehSecaoConhecida("nope")).toBe(false);
  });
});

// ============================================================
describe("podeVerTela", () => {
  it("o dono vê tudo, inclusive tela fora de qualquer perfil", () => {
    for (const tela of TODAS_AS_TELAS) {
      expect(podeVerTela(DONO, tela)).toBe(true);
    }
  });

  it("perfil nulo = SEM RESTRIÇÃO, nunca 'não vê nada'", () => {
    // É o estado de todo mundo antes da Fase 5 e de quem teve o perfil
    // apagado (ON DELETE SET NULL). Inverter isto faria apagar um perfil
    // deixar a equipe olhando telas vazias.
    for (const tela of TODAS_AS_TELAS) {
      expect(podeVerTela(SEM_PERFIL, tela)).toBe(true);
    }
  });

  it("com perfil, só as telas listadas", () => {
    const c = ctx({ telas: ["inbox", "contacts"] });
    expect(podeVerTela(c, "inbox")).toBe(true);
    expect(podeVerTela(c, "contacts")).toBe(true);
    expect(podeVerTela(c, "pipelines")).toBe(false);
    expect(podeVerTela(c, "radar")).toBe(false);
  });

  it("NENHUM perfil consegue esconder Configurações", () => {
    // ⚠️ Achado da revisão: garantir as seções pessoais (trocar a própria
    // senha) não serve de nada se a TELA que as contém puder ser desmarcada —
    // a pessoa fica sem porta de entrada e a garantia vira letra morta.
    // Vale para todo papel, não só admin.
    for (const papel of ["admin", "agent", "viewer"] as const) {
      const c = ctx({ papel_base: papel, telas: ["inbox"] });
      expect(podeVerTela(c, "settings")).toBe(true);
    }
  });

  it("Configurações vazia ainda dá acesso ao próprio cadastro e senha", () => {
    // O par que fecha o buraco: a tela abre, e dentro dela sobram as
    // seções pessoais mesmo com `secoes_config` vazio.
    const c = ctx({ papel_base: "agent", telas: ["inbox"], secoes_config: [] });
    expect(podeVerTela(c, "settings")).toBe(true);
    expect(podeVerSecao(c, "security")).toBe(true);
    expect(podeVerSecao(c, "channels")).toBe(false);
  });
});

// ============================================================
describe("podeVerSecao", () => {
  it("seções pessoais aparecem para qualquer perfil, mesmo não listadas", () => {
    // Sem isto, alguém fica sem caminho para trocar a própria senha no app.
    const c = ctx({ secoes_config: [] });
    expect(podeVerSecao(c, "profile")).toBe(true);
    expect(podeVerSecao(c, "security")).toBe(true);
    expect(podeVerSecao(c, "appearance")).toBe(true);
  });

  it("seções de conta ficam de fora quando não listadas", () => {
    const c = ctx({ secoes_config: ["quick-replies"] });
    expect(podeVerSecao(c, "quick-replies")).toBe(true);
    expect(podeVerSecao(c, "channels")).toBe(false);
    expect(podeVerSecao(c, "api")).toBe(false);
    expect(podeVerSecao(c, "members")).toBe(false);
  });

  it("admin nunca perde Membros, Perfis nem a visão geral", () => {
    // `perfis` está aqui pelo mesmo motivo de `members`: é a tela que
    // conserta perfil mal configurado. Sem ela, o erro que se quer desfazer é
    // justamente o que tranca a porta.
    const c = ctx({ papel_base: "admin", secoes_config: [] });
    expect(podeVerSecao(c, "members")).toBe(true);
    expect(podeVerSecao(c, "overview")).toBe(true);
    expect(podeVerSecao(c, "perfis")).toBe(true);
  });

  it("a seção de perfis NÃO vaza para agent nem viewer", () => {
    for (const papel of ["agent", "viewer"] as const) {
      expect(podeVerSecao(ctx({ papel_base: papel, secoes_config: [] }), "perfis")).toBe(false);
    }
  });

  it("⚠️ nem com a caixa 'perfis' MARCADA no perfil", () => {
    // O teste acima só exercitava `secoes_config` vazio, e o furo estava
    // exatamente no outro caso: o editor oferece a caixa para perfil de
    // qualquer papel, e marcá-la entregava a tela inteira de gestão de
    // permissões — leitura funcionando (a policy da 956 dá SELECT a
    // qualquer membro), escrita quebrando com 403 genérico.
    for (const papel of ["agent", "viewer"] as const) {
      const c = ctx({ papel_base: papel, secoes_config: ["perfis", "quick-replies"] });
      expect(podeVerSecao(c, "perfis")).toBe(false);
      // E o resto da caixa continua valendo — a trava é só da seção de perfis.
      expect(podeVerSecao(c, "quick-replies")).toBe(true);
    }
  });

  it("⚠️ a trava segue o PAPEL REAL, não o papel_base do perfil", () => {
    // Achado da revisão: as duas colunas podem divergir (a rota da Fase 5 as
    // sincroniza, um UPDATE à mão no banco não). Quem decide o que a pessoa
    // PODE fazer é `account_role` — foi o que a própria migration documentou.
    // Lendo o perfil aqui, um admin de verdade cujo perfil dissesse "agent"
    // perderia a tela de Membros: o auto-bloqueio que a trava existe para
    // impedir.
    const divergente: ContextoDeAcesso = {
      papel: "admin", // fonte da verdade
      perfil: perfil({ papel_base: "agent", secoes_config: [] }),
    };
    expect(podeVerSecao(divergente, "members")).toBe(true);

    // E o inverso: perfil dizendo "admin" NÃO promove quem é agent de fato.
    const inverso: ContextoDeAcesso = {
      papel: "agent",
      perfil: perfil({ papel_base: "admin", secoes_config: [] }),
    };
    expect(podeVerSecao(inverso, "members")).toBe(false);
  });
});

// ============================================================
describe("telaDoCaminho", () => {
  it("casa a rota exata e as rotas filhas", () => {
    expect(telaDoCaminho("/inbox", ROTA_DA_TELA)).toBe("inbox");
    expect(telaDoCaminho("/pipelines/abc-123", ROTA_DA_TELA)).toBe("pipelines");
    expect(telaDoCaminho("/automations/new", ROTA_DA_TELA)).toBe("automations");
  });

  it("⚠️ /agendadas NÃO é engolida por /agenda", () => {
    // A mesma armadilha de `startsWith` que o middleware tem no
    // `protectedPaths` — lá é conveniente, aqui seria bug: quem não vê
    // "agenda" perderia "agendadas" junto, sem nada dizendo por quê.
    expect(telaDoCaminho("/agendadas", ROTA_DA_TELA)).toBe("agendadas");
    expect(telaDoCaminho("/agenda", ROTA_DA_TELA)).toBe("agenda");
  });

  it("caminho fora do catálogo não resolve para tela nenhuma", () => {
    expect(telaDoCaminho("/join/abc", ROTA_DA_TELA)).toBeNull();
    expect(telaDoCaminho("/", ROTA_DA_TELA)).toBeNull();
  });
});

// ============================================================
describe("escopo — vazio significa TUDO", () => {
  const canais = [{ id: "ch1" }, { id: "ch2" }, { id: "ch3" }];
  const funis = [{ id: "pp1" }, { id: "pp2" }];

  it("lista vazia devolve tudo (convenção do projeto)", () => {
    expect(canaisVisiveis(ctx({ channel_ids: [] }), canais)).toHaveLength(3);
    expect(funisVisiveis(ctx({ pipeline_ids: [] }), funis)).toHaveLength(2);
  });

  it("sem perfil devolve tudo", () => {
    expect(canaisVisiveis(SEM_PERFIL, canais)).toHaveLength(3);
  });

  it("o dono ignora o recorte mesmo com perfil marcado", () => {
    const comoDono: ContextoDeAcesso = {
      papel: "owner",
      perfil: perfil({ channel_ids: ["ch1"] }),
    };
    expect(canaisVisiveis(comoDono, canais)).toHaveLength(3);
  });

  it("com lista, filtra", () => {
    const c = ctx({ channel_ids: ["ch1", "ch3"] });
    expect(canaisVisiveis(c, canais).map((x) => x.id)).toEqual(["ch1", "ch3"]);
    expect(canalNoEscopo(c, "ch1")).toBe(true);
    expect(canalNoEscopo(c, "ch2")).toBe(false);
  });

  it("id órfão (conexão apagada) some sem erro", () => {
    // Arrays não têm FK; a leitura resolve contra a lista viva.
    const c = ctx({ channel_ids: ["ch1", "ja-foi-apagado"] });
    expect(canaisVisiveis(c, canais).map((x) => x.id)).toEqual(["ch1"]);
  });

  it("funis seguem a mesma regra", () => {
    const c = ctx({ pipeline_ids: ["pp2"] });
    expect(funisVisiveis(c, funis).map((x) => x.id)).toEqual(["pp2"]);
    expect(funilNoEscopo(c, "pp2")).toBe(true);
    expect(funilNoEscopo(c, "pp1")).toBe(false);
  });
});

// ============================================================
describe("conversaNoEscopo", () => {
  it("conversa 1:1 casa pelo channel_id", () => {
    const c = ctx({ channel_ids: ["ch1"] });
    expect(conversaNoEscopo(c, conversa({ channel_id: "ch1" }))).toBe(true);
    expect(conversaNoEscopo(c, conversa({ channel_id: "ch2" }))).toBe(false);
  });

  it("⚠️ GRUPO casa por cb_groups.channel_id, não pela coluna da conversa", () => {
    // Conversa de grupo tem `conversations.channel_id` SEMPRE NULO. Ler a
    // coluna crua aqui apagaria TODOS os grupos da caixa de entrada de quem
    // tem perfil restrito, em silêncio. Este teste é a rede dessa armadilha.
    const grupoDoCh1 = conversa({
      contact_id: null,
      group_id: "g1",
      channel_id: null,
      group: { channel_id: "ch1" },
    } as Partial<Conversation>);

    expect(conversaNoEscopo(ctx({ channel_ids: ["ch1"] }), grupoDoCh1)).toBe(true);
    expect(conversaNoEscopo(ctx({ channel_ids: ["ch2"] }), grupoDoCh1)).toBe(false);
  });

  it("conversa sem canal nenhum (anterior à 903) passa", () => {
    // Não sabemos por qual número veio; escondê-la faria sumir histórico
    // legítimo para afirmar algo que ninguém sabe.
    const antiga = conversa({ channel_id: null });
    expect(conversaNoEscopo(ctx({ channel_ids: ["ch1"] }), antiga)).toBe(true);
  });

  it("escopo vazio deixa passar qualquer conversa", () => {
    expect(conversaNoEscopo(ctx({ channel_ids: [] }), conversa({ channel_id: "x" }))).toBe(true);
  });
});

// ============================================================
describe("recorteDeCanais", () => {
  it("null quando não há recorte — dono, sem perfil, ou lista vazia", () => {
    expect(recorteDeCanais(DONO)).toBeNull();
    expect(recorteDeCanais(SEM_PERFIL)).toBeNull();
    expect(recorteDeCanais(ctx({ channel_ids: [] }))).toBeNull();
  });

  it("devolve a lista quando há recorte (para .in() na consulta)", () => {
    expect(recorteDeCanais(ctx({ channel_ids: ["ch1", "ch2"] }))).toEqual([
      "ch1",
      "ch2",
    ]);
  });
});

describe("resumoDoEscopo", () => {
  it("perfil nulo é 'tudo'", () => {
    expect(resumoDoEscopo(null)).toEqual({
      todasAsConexoes: true,
      todosOsFunis: true,
      conexoes: 0,
      funis: 0,
    });
  });

  it("conta o que está marcado", () => {
    const r = resumoDoEscopo(perfil({ channel_ids: ["a", "b"], pipeline_ids: ["x"] }));
    expect(r).toEqual({
      todasAsConexoes: false,
      todosOsFunis: false,
      conexoes: 2,
      funis: 1,
    });
  });
});

// ============================================================
describe("perfis de fábrica", () => {
  it("nenhum é owner — o CHECK da 956 barra isso no banco", () => {
    for (const p of PERFIS_DE_FABRICA) {
      expect(p.papel_base).not.toBe("owner");
    }
  });

  it("todos os ids citados existem no catálogo", () => {
    // Sem este teste, um id digitado errado vira tela invisível para sempre,
    // e o sintoma aparece longe da causa.
    for (const p of PERFIS_DE_FABRICA) {
      for (const t of p.telas) expect(ehTelaConhecida(t)).toBe(true);
      for (const s of p.secoes_config) expect(ehSecaoConhecida(s)).toBe(true);
    }
  });

  it("o Administrador enxerga todas as telas e seções", () => {
    const admin = PERFIS_DE_FABRICA.find((p) => p.nome === "Administrador")!;
    expect(admin.telas).toHaveLength(TODAS_AS_TELAS.length);
    expect(admin.secoes_config).toHaveLength(TODAS_AS_SECOES.length);
    expect(admin.sistema).toBe(true);
  });

  it("o Advogado não vê gestão nem disparo em massa", () => {
    const adv = PERFIS_DE_FABRICA.find((p) => p.nome === "Advogado")!;
    const c: ContextoDeAcesso = {
      papel: adv.papel_base,
      perfil: perfil({ ...adv, id: "p", account_id: "a", channel_ids: [], pipeline_ids: [] }),
    };
    for (const proibida of [
      "dashboard",
      "radar",
      "broadcasts",
      "automations",
      "flows",
      "agents",
    ] as const) {
      expect(podeVerTela(c, proibida)).toBe(false);
    }
    expect(podeVerTela(c, "inbox")).toBe(true);
    expect(podeVerTela(c, "pipelines")).toBe(true);
  });

  it("o Advogado não lista Configurações — ela é sempre visível", () => {
    const adv = PERFIS_DE_FABRICA.find((p) => p.nome === "Advogado")!;
    expect(adv.telas).not.toContain("settings");
  });

  it("o Advogado é duplicável por área: nasce sem recorte", () => {
    const adv = PERFIS_DE_FABRICA.find((p) => p.nome === "Advogado")!;
    expect(adv.sistema).toBe(false); // editável e duplicável
  });

  it("o Observador não alcança as agendadas", () => {
    const obs = PERFIS_DE_FABRICA.find((p) => p.nome === "Observador")!;
    expect(obs.telas).not.toContain("agendadas");
    expect(obs.papel_base).toBe("viewer");
  });

  it("SÓ o Administrador é sistema — os demais são editáveis", () => {
    // Decisão do operador: as telas de cada perfil são configuráveis. O
    // cadeado (`sistema`) contradiria isso, e só se justifica no
    // Administrador ("vê tudo" por definição + saída anti-auto-bloqueio).
    const travados = PERFIS_DE_FABRICA.filter((p) => p.sistema).map((p) => p.nome);
    expect(travados).toEqual(["Administrador"]);
  });
});
