import { describe, expect, it } from "vitest";

import { matchesTypeFilter } from "./conversations";
import {
  aplicarFiltros,
  casaComABusca,
  casaComAEtapa,
  casaComOResponsavel,
  contarFiltrosAtivos,
  FILTROS_VAZIOS,
  mapaDeEtapasPorContato,
  SEM_ETAPA,
  SEM_RESPONSAVEL,
  type ContextoDosFiltros,
} from "./filtros";
import type { Conversation, Tag } from "@/types";

const etiqueta = (id: string): Tag => ({
  id,
  user_id: "u1",
  name: id,
  color: "#fff",
  created_at: "",
});

function conversa(patch: Partial<Conversation> = {}): Conversation {
  return {
    id: "c1",
    user_id: "u1",
    contact_id: "ct1",
    status: "open",
    unread_count: 0,
    created_at: "",
    updated_at: "",
    contact: {
      id: "ct1",
      user_id: "u1",
      account_id: "a1",
      phone: "5511999999999",
      name: "Ana Souza",
      created_at: "",
      updated_at: "",
    },
    ...patch,
  };
}

/** Conversa de grupo: sem contato, com `group_id` — o XOR da 906. */
function grupo(patch: Partial<Conversation> = {}): Conversation {
  return conversa({
    id: "g1",
    contact_id: null,
    contact: null,
    group_id: "grp1",
    group: {
      id: "grp1",
      account_id: "a1",
      channel_id: "ch1",
      jid: "123@g.us",
      subject: "Condomínio Rio Tucumã",
      alias: null,
      description: null,
      picture_url: null,
      owner_jid: null,
      participant_count: null,
      is_announce: null,
      we_are_admin: null,
      synced_at: null,
      created_at: "",
      updated_at: "",
    },
    ...patch,
  });
}

const ctx = (patch: Partial<ContextoDosFiltros> = {}): ContextoDosFiltros => ({
  favoritas: new Set<string>(),
  etapaPorContato: new Map<string, Set<string>>(),
  busca: "",
  ...patch,
});

describe("matchesTypeFilter", () => {
  // A revisão prévia achou que esta função do multi-canal/grupos nunca teve
  // teste, apesar de o plano dizer que as funções puras eram testadas.
  it("'todas' deixa passar os dois", () => {
    expect(matchesTypeFilter(conversa(), "todas")).toBe(true);
    expect(matchesTypeFilter(grupo(), "todas")).toBe(true);
  });

  it("'diretas' tira grupo, 'grupos' tira 1:1", () => {
    expect(matchesTypeFilter(conversa(), "diretas")).toBe(true);
    expect(matchesTypeFilter(grupo(), "diretas")).toBe(false);
    expect(matchesTypeFilter(conversa(), "grupos")).toBe(false);
    expect(matchesTypeFilter(grupo(), "grupos")).toBe(true);
  });
});

describe("casaComABusca", () => {
  it("busca vazia deixa tudo passar", () => {
    expect(casaComABusca(conversa(), "")).toBe(true);
    expect(casaComABusca(conversa(), "   ")).toBe(true);
  });

  it("acha por nome e por telefone, sem diferenciar maiúscula", () => {
    expect(casaComABusca(conversa(), "ana")).toBe(true);
    expect(casaComABusca(conversa(), "SOUZA")).toBe(true);
    expect(casaComABusca(conversa(), "99999")).toBe(true);
  });

  it("acha GRUPO pelo nome — grupo não tem contato", () => {
    // Sem este ramo, buscar não acharia grupo nenhum: nome e telefone são
    // ambos vazios numa conversa de grupo.
    expect(casaComABusca(grupo(), "tucumã")).toBe(true);
    expect(casaComABusca(grupo(), "ana")).toBe(false);
  });

  it("acha pelo texto da última mensagem, sem os marcadores do WhatsApp", () => {
    const c = conversa({ last_message_text: "O *contrato* foi assinado" });
    expect(casaComABusca(c, "contrato foi")).toBe(true);
  });
});

describe("casaComOResponsavel", () => {
  it("null não filtra nada", () => {
    expect(casaComOResponsavel(conversa(), null)).toBe(true);
    expect(
      casaComOResponsavel(conversa({ assigned_agent_id: "u9" }), null),
    ).toBe(true);
  });

  it("casa com a pessoa escolhida", () => {
    const c = conversa({ assigned_agent_id: "u9" });
    expect(casaComOResponsavel(c, "u9")).toBe(true);
    expect(casaComOResponsavel(c, "u1")).toBe(false);
  });

  it("SEM_RESPONSAVEL acha justamente quem não foi distribuído", () => {
    // É a pergunta da manhã: "o que ninguém pegou ainda?". Sem esta opção,
    // 63 das 64 conversas sumiriam de qualquer recorte por responsável.
    expect(casaComOResponsavel(conversa(), SEM_RESPONSAVEL)).toBe(true);
    expect(
      casaComOResponsavel(
        conversa({ assigned_agent_id: "u9" }),
        SEM_RESPONSAVEL,
      ),
    ).toBe(false);
  });
});

describe("mapaDeEtapasPorContato", () => {
  it("junta os negócios do mesmo contato num CONJUNTO de etapas", () => {
    // O índice único da 911 só cobre `source='channel'` — negócio manual ou
    // de automação duplica o contato, e ele fica em duas etapas ao mesmo
    // tempo. Tratar como valor único sumiria com o segundo.
    const mapa = mapaDeEtapasPorContato([
      { contact_id: "ct1", stage_id: "s1" },
      { contact_id: "ct1", stage_id: "s2" },
      { contact_id: "ct2", stage_id: "s1" },
    ]);
    expect(mapa.get("ct1")).toEqual(new Set(["s1", "s2"]));
    expect(mapa.get("ct2")).toEqual(new Set(["s1"]));
  });

  it("ignora negócio sem contato ou sem etapa", () => {
    // `deals.contact_id` é anulável desde a 004 (SET NULL ao apagar contato).
    const mapa = mapaDeEtapasPorContato([
      { contact_id: null, stage_id: "s1" },
      { contact_id: "ct1", stage_id: null },
    ]);
    expect(mapa.size).toBe(0);
  });
});

describe("casaComAEtapa", () => {
  const mapa = new Map([["ct1", new Set(["s1"])]]);

  it("null não filtra nada", () => {
    expect(casaComAEtapa(conversa(), null, mapa)).toBe(true);
  });

  it("casa com a etapa do negócio do contato", () => {
    expect(casaComAEtapa(conversa(), "s1", mapa)).toBe(true);
    expect(casaComAEtapa(conversa(), "s2", mapa)).toBe(false);
  });

  it("SEM_ETAPA acha quem não tem negócio nenhum", () => {
    expect(casaComAEtapa(conversa({ contact_id: "ct9" }), SEM_ETAPA, mapa)).toBe(
      true,
    );
    expect(casaComAEtapa(conversa(), SEM_ETAPA, mapa)).toBe(false);
  });

  it("grupo cai em SEM_ETAPA — não tem contato, logo não tem negócio", () => {
    expect(casaComAEtapa(grupo(), SEM_ETAPA, mapa)).toBe(true);
    expect(casaComAEtapa(grupo(), "s1", mapa)).toBe(false);
  });
});

describe("contarFiltrosAtivos", () => {
  it("zero quando nada foi escolhido", () => {
    expect(contarFiltrosAtivos(FILTROS_VAZIOS)).toBe(0);
  });

  it("o modo da etiqueta NÃO conta como filtro", () => {
    // Ele não recorta nada sozinho — só muda como as etiquetas já escolhidas
    // se combinam. Contá-lo faria o distintivo mostrar "1" com a lista inteira
    // aparecendo.
    expect(
      contarFiltrosAtivos({ ...FILTROS_VAZIOS, modoDeEtiqueta: "todas" }),
    ).toBe(0);
  });

  it("conta 'não lidas' como faceta própria", () => {
    expect(contarFiltrosAtivos({ ...FILTROS_VAZIOS, naoLidas: true })).toBe(1);
  });

  it("soma um por faceta escolhida", () => {
    expect(
      contarFiltrosAtivos({
        ...FILTROS_VAZIOS,
        status: "closed",
        favoritas: true,
        etiquetaIds: ["t1", "t2"],
      }),
    ).toBe(3);
  });
});

describe("aplicarFiltros", () => {
  it("sem filtro nenhum devolve tudo", () => {
    const lista = [conversa(), grupo()];
    expect(aplicarFiltros(lista, FILTROS_VAZIOS, ctx())).toHaveLength(2);
  });

  it("combina os filtros com E, nunca com OU", () => {
    // A decisão do operador: marcar responsável e depois favoritas mostra AS
    // FAVORITAS DAQUELE responsável, não a soma das duas listas.
    const minha = conversa({ id: "c1", assigned_agent_id: "u9" });
    const dela = conversa({ id: "c2", assigned_agent_id: "u9" });
    const outra = conversa({ id: "c3", assigned_agent_id: "u1" });

    const saida = aplicarFiltros(
      [minha, dela, outra],
      { ...FILTROS_VAZIOS, responsavelId: "u9", favoritas: true },
      ctx({ favoritas: new Set(["c1", "c3"]) }),
    );
    expect(saida.map((c) => c.id)).toEqual(["c1"]);
  });

  it("etiqueta em modo 'todas' exige as duas; 'qualquer' basta uma", () => {
    const vip = conversa({
      id: "c1",
      contact: { ...conversa().contact!, tags: [etiqueta("t1")] },
    });
    const ambas = conversa({
      id: "c2",
      contact: { ...conversa().contact!, tags: [etiqueta("t1"), etiqueta("t2")] },
    });

    const qualquer = aplicarFiltros(
      [vip, ambas],
      { ...FILTROS_VAZIOS, etiquetaIds: ["t1", "t2"], modoDeEtiqueta: "qualquer" },
      ctx(),
    );
    expect(qualquer.map((c) => c.id)).toEqual(["c1", "c2"]);

    const todas = aplicarFiltros(
      [vip, ambas],
      { ...FILTROS_VAZIOS, etiquetaIds: ["t1", "t2"], modoDeEtiqueta: "todas" },
      ctx(),
    );
    expect(todas.map((c) => c.id)).toEqual(["c2"]);
  });

  it("filtro de canal não engole conversa 1:1 sem carimbo", () => {
    // Conversa anterior à 903 tem `channel_id` nulo. Ela só aparece em
    // "Todos" — incluí-la em todo canal faria o filtro mentir sobre por qual
    // número aquela conversa correu.
    const semCarimbo = conversa({ id: "c1" });
    const doCanal = conversa({ id: "c2", channel_id: "ch1" });
    const saida = aplicarFiltros(
      [semCarimbo, doCanal],
      { ...FILTROS_VAZIOS, canalId: "ch1" },
      ctx(),
    );
    expect(saida.map((c) => c.id)).toEqual(["c2"]);
  });

  it("⚠️ GRUPO tem o número em cb_groups, não na conversa", () => {
    // Este teste existe por causa de um achado da revisão: a versão anterior
    // lia `conversations.channel_id` direto, e `persist.ts` NUNCA grava essa
    // coluna em conversa de grupo. Resultado: escolher um número APAGAVA
    // TODOS OS GRUPOS daquele número, em silêncio — e o teste antigo dizia,
    // errado, que o nulo era coisa de conversa pré-903.
    const doCanal = grupo({ id: "g1" }); // group.channel_id = 'ch1'
    const deOutro = grupo({
      id: "g2",
      group: { ...grupo().group!, channel_id: "ch2" },
    });

    const saida = aplicarFiltros(
      [doCanal, deOutro],
      { ...FILTROS_VAZIOS, canalId: "ch1" },
      ctx(),
    );
    expect(saida.map((c) => c.id)).toEqual(["g1"]);
  });

  it("grupo sem número conhecido não entra em recorte por número", () => {
    const semNumero = grupo({
      id: "g1",
      group: { ...grupo().group!, channel_id: null },
    });
    expect(
      aplicarFiltros([semNumero], { ...FILTROS_VAZIOS, canalId: "ch1" }, ctx()),
    ).toHaveLength(0);
  });

  it("grupo some do filtro de etiqueta, e isso é a resposta honesta", () => {
    const saida = aplicarFiltros(
      [conversa(), grupo()],
      { ...FILTROS_VAZIOS, etiquetaIds: ["t1"] },
      ctx(),
    );
    expect(saida).toHaveLength(0);
  });

  it("'não lidas' SOMA com a situação, em vez de substituí-la", () => {
    // Este é o teste da mudança de comportamento do commit 3. Antes, escolher
    // "não lidas" no menu de situação substituía o status — a encerrada não
    // lida aparecia junto. Agora os dois se aplicam, e sobra só a aberta e
    // não lida.
    const abertaNaoLida = conversa({ id: "c1", status: "open", unread_count: 3 });
    const abertaLida = conversa({ id: "c2", status: "open", unread_count: 0 });
    const encerradaNaoLida = conversa({
      id: "c3",
      status: "closed",
      unread_count: 5,
    });

    const so = aplicarFiltros(
      [abertaNaoLida, abertaLida, encerradaNaoLida],
      { ...FILTROS_VAZIOS, naoLidas: true },
      ctx(),
    );
    expect(so.map((c) => c.id)).toEqual(["c1", "c3"]);

    const comSituacao = aplicarFiltros(
      [abertaNaoLida, abertaLida, encerradaNaoLida],
      { ...FILTROS_VAZIOS, naoLidas: true, status: "open" },
      ctx(),
    );
    expect(comSituacao.map((c) => c.id)).toEqual(["c1"]);
  });

  it("a busca continua valendo junto com os filtros", () => {
    const ana = conversa({ id: "c1", status: "open" });
    const outro = conversa({
      id: "c2",
      status: "open",
      contact: { ...conversa().contact!, name: "Bruno Lima" },
    });
    const saida = aplicarFiltros(
      [ana, outro],
      { ...FILTROS_VAZIOS, status: "open" },
      ctx({ busca: "bruno" }),
    );
    expect(saida.map((c) => c.id)).toEqual(["c2"]);
  });
});
