import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MOTIVOS_DO_BOTAO,
  RECUSAS,
  TOQUE_VELHO_MS,
  decidirBotaoLigar,
  faseDoEstado,
  faseSeguinte,
  juntarAoVivo,
  lerLigacaoAoVivo,
  partesDaDuracao,
  recusaConhecida,
  releituraAoVivo,
  relogioDaLigacao,
  toquesVisiveis,
  type LigacaoAoVivo,
  type SituacaoDoComputador,
} from "./ao-vivo";

// Dados fictícios: nenhum id, número ou nome real.
const CANAL = "canal-a";
const AGORA = Date.parse("2026-11-11T15:00:00.000Z");

function linha(extra: Partial<LigacaoAoVivo> = {}): LigacaoAoVivo {
  return {
    id: "lig-1",
    account_id: "conta-1",
    channel_id: CANAL,
    direcao: "recebida",
    estado: "tocando",
    telefone: "5596990000016",
    conversation_id: "conversa-1",
    contact_id: "contato-1",
    atendente_id: null,
    desde: new Date(AGORA - 5_000).toISOString(),
    atualizada_em: new Date(AGORA - 5_000).toISOString(),
    ...extra,
  };
}

describe("lerLigacaoAoVivo — a linha do tempo real é lida campo a campo", () => {
  it("aceita a linha completa", () => {
    expect(lerLigacaoAoVivo(linha())).toEqual(linha());
  });

  it("recusa estado ou direção desconhecidos e campos obrigatórios ausentes", () => {
    expect(lerLigacaoAoVivo({ ...linha(), estado: "pendurada" })).toBeNull();
    expect(lerLigacaoAoVivo({ ...linha(), direcao: "lateral" })).toBeNull();
    expect(lerLigacaoAoVivo({ ...linha(), channel_id: null })).toBeNull();
    expect(lerLigacaoAoVivo(null)).toBeNull();
    expect(lerLigacaoAoVivo("texto")).toBeNull();
  });

  it("sem atualizada_em, usa o desde (e opcionais vazios viram nulo)", () => {
    const lida = lerLigacaoAoVivo({ ...linha(), atualizada_em: undefined, telefone: "" });
    expect(lida?.atualizada_em).toBe(linha().desde);
    expect(lida?.telefone).toBeNull();
  });
});

describe("juntarAoVivo e releituraAoVivo", () => {
  it("INSERT/UPDATE trocam a linha pelo id; DELETE a tira", () => {
    const apagadas = new Set<string>();
    let lista = juntarAoVivo([], { tipo: "INSERT", linha: linha() }, apagadas);
    lista = juntarAoVivo(lista, { tipo: "UPDATE", linha: linha({ estado: "conectando", atendente_id: "u1" }) }, apagadas);
    expect(lista).toHaveLength(1);
    expect(lista[0].estado).toBe("conectando");
    lista = juntarAoVivo(lista, { tipo: "DELETE", id: "lig-1" }, apagadas);
    expect(lista).toEqual([]);
  });

  it("⚠️ UPDATE atrasado de uma ligação já apagada não a ressuscita", () => {
    const apagadas = new Set(["lig-1"]);
    expect(juntarAoVivo([], { tipo: "UPDATE", linha: linha() }, apagadas)).toEqual([]);
  });

  it("⚠️ a releitura que saiu antes de um DELETE não devolve a linha apagada", () => {
    const apagadas = new Set(["lig-1"]);
    const outra = linha({ id: "lig-2" });
    expect(releituraAoVivo([linha(), outra], [], apagadas, new Set())).toEqual([outra]);
  });

  it("⚠️ a releitura que saiu antes de um INSERT não apaga o toque que acabou de chegar", () => {
    const chegou = linha({ id: "lig-3" });
    expect(releituraAoVivo([], [chegou], new Set(), new Set(["lig-3"]))).toEqual([chegou]);
    // Sem evento depois da consulta, vale o que a consulta leu (a linha sumiu).
    expect(releituraAoVivo([], [chegou], new Set(), new Set())).toEqual([]);
  });

  it("o UPDATE que chegou depois da consulta vale mais que a linha lida", () => {
    const lida = linha({ estado: "tocando" });
    const nova = linha({ estado: "conectando", atendente_id: "u2" });
    expect(releituraAoVivo([lida], [nova], new Set(), new Set(["lig-1"]))).toEqual([nova]);
  });
});

describe("toquesVisiveis — quem vê o toque (D9)", () => {
  const todos = () => true;

  it("só recebidas TOCANDO, nas conexões do perfil", () => {
    const lista = [
      linha(),
      linha({ id: "lig-2", estado: "em_ligacao", atendente_id: "u2" }),
      linha({ id: "lig-3", direcao: "feita", estado: "chamando" }),
      linha({ id: "lig-4", channel_id: "canal-fora" }),
    ];
    const vistos = toquesVisiveis(lista, {
      podeAtender: true,
      canalNoEscopo: (id) => id === CANAL,
      agoraMs: AGORA,
    });
    expect(vistos.map((l) => l.id)).toEqual(["lig-1"]);
  });

  it("quem não atende não vê toque nenhum", () => {
    expect(toquesVisiveis([linha()], { podeAtender: false, canalNoEscopo: todos, agoraMs: AGORA })).toEqual([]);
  });

  it("⚠️ o toque mais velho que 3 min não toca (a máquina o apaga no sinal)", () => {
    const velho = linha({ desde: new Date(AGORA - TOQUE_VELHO_MS - 1_000).toISOString() });
    expect(toquesVisiveis([velho], { podeAtender: true, canalNoEscopo: todos, agoraMs: AGORA })).toEqual([]);
  });
});

describe("decidirBotaoLigar — aparece só onde há computador, desligado com o porquê", () => {
  const pronto = new Map<string, SituacaoDoComputador>([[CANAL, "pronto"]]);
  const base = {
    canalId: CANAL,
    computadores: pronto,
    ehGrupo: false,
    temTelefone: true,
    podeLigar: true,
    emLigacao: false,
    aoVivo: [] as LigacaoAoVivo[],
  };

  it("ligado no caso feliz", () => {
    expect(decidirBotaoLigar(base)).toEqual({ mostra: true, motivo: null, quem: null });
  });

  it("⚠️ computadores carregando ou que falharam (null): nada — nunca desligado afirmando", () => {
    expect(decidirBotaoLigar({ ...base, computadores: null })).toEqual({ mostra: false });
  });

  it("número sem computador, ou conversa sem número: nada", () => {
    expect(decidirBotaoLigar({ ...base, computadores: new Map() })).toEqual({ mostra: false });
    expect(decidirBotaoLigar({ ...base, canalId: null })).toEqual({ mostra: false });
  });

  it.each([
    [{ ehGrupo: true }, "grupo"],
    [{ temTelefone: false }, "sem_telefone"],
    [{ podeLigar: false }, "sem_poder"],
    [{ computadores: new Map([[CANAL, "fora" as const]]) }, "computador_fora"],
    [{ computadores: new Map([[CANAL, "sem_whatsapp" as const]]) }, "sem_whatsapp"],
    [{ emLigacao: true }, "em_outra_ligacao"],
    [{ aoVivo: [linha()] }, "tocando_agora"],
  ])("desligado: %o → %s", (extra, motivo) => {
    expect(decidirBotaoLigar({ ...base, ...extra })).toMatchObject({ mostra: true, motivo });
  });

  it("linha ocupada diz QUEM está na ligação", () => {
    const ocupando = linha({ estado: "em_ligacao", direcao: "feita", atendente_id: "u9" });
    expect(decidirBotaoLigar({ ...base, aoVivo: [ocupando] })).toEqual({
      mostra: true,
      motivo: "linha_ocupada",
      quem: "u9",
    });
  });

  it("a ligação de OUTRO número não ocupa este", () => {
    const outra = linha({ channel_id: "canal-b", estado: "em_ligacao" });
    expect(decidirBotaoLigar({ ...base, aoVivo: [outra] }).mostra).toBe(true);
    expect(decidirBotaoLigar({ ...base, aoVivo: [outra] })).toMatchObject({ motivo: null });
  });
});

describe("a fase do painel", () => {
  it("o estado da linha vira fase", () => {
    expect(faseDoEstado("conectando")).toBe("conectando");
    expect(faseDoEstado("tocando")).toBe("conectando");
    expect(faseDoEstado("chamando")).toBe("chamando");
    expect(faseDoEstado("em_ligacao")).toBe("em_ligacao");
  });

  it("⚠️ a fase só ANDA: UPDATE atrasado não volta 'em ligação' para 'chamando'", () => {
    expect(faseSeguinte("em_ligacao", "chamando")).toBe("em_ligacao");
    expect(faseSeguinte("conectando", "em_ligacao")).toBe("em_ligacao");
    expect(faseSeguinte("encerrada", "em_ligacao")).toBe("encerrada");
  });
});

describe("textos do painel", () => {
  it("o relógio e a duração", () => {
    expect(relogioDaLigacao(0)).toBe("00:00");
    expect(relogioDaLigacao(133)).toBe("02:13");
    expect(relogioDaLigacao(3_725)).toBe("1:02:05");
    expect(partesDaDuracao(261)).toEqual({ minutos: 4, segundos: 21 });
    expect(partesDaDuracao(21.4)).toEqual({ minutos: 0, segundos: 21 });
  });

  it("código desconhecido vira 'desconhecida', nunca a chave crua", () => {
    expect(recusaConhecida("limite_por_hora")).toBe("limite_por_hora");
    expect(recusaConhecida("http_418")).toBe("desconhecida");
    expect(recusaConhecida(null)).toBe("desconhecida");
  });
});

describe("⚠️ as chaves MONTADAS estão nos dois dicionários", () => {
  const raiz = path.resolve(__dirname, "../../..");
  const dicionarios = ["en.json", "pt-BR.json"].map((nome) => ({
    nome,
    json: JSON.parse(fs.readFileSync(path.join(raiz, "messages", nome), "utf8")) as {
      Ligacoes: Record<string, Record<string, string>>;
    },
  }));

  it.each(dicionarios)("$nome: Ligacoes.botao.<motivo> e Ligacoes.recusa.<código>", ({ json }) => {
    for (const motivo of MOTIVOS_DO_BOTAO) expect(json.Ligacoes.botao[motivo], motivo).toBeTruthy();
    expect(json.Ligacoes.botao.linha_ocupadaCom).toContain("{nome}");
    for (const codigo of [...RECUSAS, "desconhecida"]) {
      expect(json.Ligacoes.recusa[codigo], codigo).toBeTruthy();
    }
  });
});
