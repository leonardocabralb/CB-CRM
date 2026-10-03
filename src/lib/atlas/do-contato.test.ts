import { describe, expect, it } from "vitest";

import en from "../../../messages/en.json";
import ptBR from "../../../messages/pt-BR.json";

import { abaAtlasNoPainel, ERROS_DO_VINCULO, leituraParaOContato, lerAtlasDoContato, respostaDoContato, situacaoConhecida, SITUACOES_DO_ATLAS, type ConfigDaTela, type VinculoDaFicha } from "./do-contato";
import { CASOU_POR, LEITURA_VELHA_MS, ORIGENS_DO_VINCULO } from "./leitura";

// ============================================================
// O Atlas de um contato como a tela o vê (Fase 2, PR B): o que a rota monta
// no servidor e o navegador lê. Dados fictícios.
// ============================================================

const CLIENTE = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
const AGORA = new Date("2026-09-30T15:00:00.000Z");
const STAGING = "https://staging.example.com/functions/v1/client-webhook";

const config = (parcial: Partial<ConfigDaTela> = {}): ConfigDaTela => ({
  api_url: null,
  atlas_tenant_id: "t1",
  last_sync_at: "2026-09-30T14:50:00.000Z",
  situacoes_lidas_ate: "2026-09-30T14:45:00.000Z",
  sync_erro: null,
  ...parcial,
});

const vinculo = (parcial: Partial<VinculoDaFicha> = {}): VinculoDaFicha => ({
  atlas_client_id: CLIENTE,
  app_url: `https://app.example.com/#/clients/${CLIENTE}`,
  situacao: "rescindido",
  situacao_desde: "2026-08-12T13:00:00.000Z",
  situacao_lida_em: "2026-09-30T14:30:00.000Z",
  origem: "automatica",
  casou_por: "chat_link",
  excluido_no_atlas_em: null,
  ...parcial,
});

describe("respostaDoContato", () => {
  it("sem conexão, ou com a conexão de OUTRO ambiente: desconectado, sem vínculo", () => {
    expect(respostaDoContato(null, null, null, AGORA)).toEqual({ conectado: false, vinculo: null, erroDaLeitura: null });
    expect(respostaDoContato(config({ api_url: STAGING }), vinculo(), null, AGORA)).toEqual({ conectado: false, vinculo: null, erroDaLeitura: null });
    expect(respostaDoContato(config(), vinculo(), STAGING, AGORA).conectado).toBe(false);
  });

  it("conectado sem vínculo: a resposta (nunca 'não sei')", () => {
    expect(respostaDoContato(config(), null, null, AGORA)).toEqual({ conectado: true, vinculo: null, erroDaLeitura: null });
  });

  it("o vínculo: lidaEm = a mais recente entre a linha e a varredura; fresca", () => {
    const r = respostaDoContato(config(), vinculo(), null, AGORA);
    expect(r.vinculo).toEqual({
      atlasClientId: CLIENTE,
      appUrl: `https://app.example.com/#/clients/${CLIENTE}`,
      situacao: "rescindido",
      situacaoDesde: "2026-08-12T13:00:00.000Z",
      origem: "automatica",
      casouPor: "chat_link",
      excluidoEm: null,
      lidaEm: "2026-09-30T14:45:00.000Z",
      velha: false,
    });
  });

  it("velha: há mais de 60 min, ou a leitura com erro (o erro vai junto)", () => {
    const antiga = new Date(AGORA.getTime() - LEITURA_VELHA_MS - 60_000).toISOString();
    expect(respostaDoContato(config({ situacoes_lidas_ate: null }), vinculo({ situacao_lida_em: antiga }), null, AGORA).vinculo?.velha).toBe(true);
    const comErro = respostaDoContato(config({ sync_erro: "fora_do_ar" }), vinculo(), null, AGORA);
    expect(comErro.vinculo?.velha).toBe(true);
    expect(comErro.erroDaLeitura).toBe("fora_do_ar");
  });

  it("⚠️ appUrl só https e com o id do cliente — vira href", () => {
    expect(respostaDoContato(config(), vinculo({ app_url: "javascript:alert(1)" }), null, AGORA).vinculo?.appUrl).toBeNull();
    expect(respostaDoContato(config(), vinculo({ app_url: "http://app.example.com/#/clients/" + CLIENTE }), null, AGORA).vinculo?.appUrl).toBeNull();
    expect(respostaDoContato(config(), vinculo({ app_url: "https://app.example.com/#/clients/outro" }), null, AGORA).vinculo?.appUrl).toBeNull();
  });
});

describe("lerAtlasDoContato", () => {
  it("lê de volta o que a rota monta", () => {
    const r = respostaDoContato(config(), vinculo(), null, AGORA);
    expect(lerAtlasDoContato(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it("ilegível = null (a tela diz que falhou, nunca 'sem vínculo')", () => {
    expect(lerAtlasDoContato(null)).toBeNull();
    expect(lerAtlasDoContato({ error: "db_error" })).toBeNull();
    expect(lerAtlasDoContato({ conectado: true, vinculo: { situacao: "ativo" } })).toBeNull();
    expect(lerAtlasDoContato({ conectado: true, vinculo: "x" })).toBeNull();
  });

  it("sem o booleano, velha (nunca afirma leitura fresca); href conferido de novo", () => {
    const lido = lerAtlasDoContato({ conectado: true, vinculo: { atlasClientId: CLIENTE, appUrl: "javascript:x" } });
    expect(lido?.vinculo).toMatchObject({ velha: true, appUrl: null });
  });

  it("desconectado nunca carrega vínculo", () => {
    expect(lerAtlasDoContato({ conectado: false, vinculo: { atlasClientId: CLIENTE } })?.vinculo).toBeNull();
  });
});

describe("abaAtlasNoPainel (360 px: a aba some para quem não vincula e a ficha sem vínculo)", () => {
  const agente = (ultimaLeitura: Parameters<typeof abaAtlasNoPainel>[0]["ultimaLeitura"], conectado: boolean | null = true) =>
    abaAtlasNoPainel({ conectado, podeVincular: false, ultimaLeitura });

  it("conta sem Atlas: nunca, nem para o admin", () => {
    expect(abaAtlasNoPainel({ conectado: false, podeVincular: true, ultimaLeitura: "vinculo" })).toBe(false);
  });

  it("quem vincula (admin): sempre, inclusive antes da primeira leitura", () => {
    expect(abaAtlasNoPainel({ conectado: null, podeVincular: true, ultimaLeitura: null })).toBe(true);
    expect(abaAtlasNoPainel({ conectado: true, podeVincular: true, ultimaLeitura: "sem_vinculo" })).toBe(true);
  });

  it("os outros: com vínculo sim, sem vínculo não", () => {
    expect(agente("vinculo")).toBe(true);
    expect(agente("sem_vinculo")).toBe(false);
  });

  it("⚠️ a FALHA aparece como falha (a aba fica, com 'Tentar de novo') — nunca some mandando o painel à Principal", () => {
    expect(agente("falhou")).toBe(true);
    expect(agente("falhou", null)).toBe(true);
  });

  it("⚠️ troca entre duas fichas vinculadas: durante a carga vale a leitura ANTERIOR — a aba não pisca", () => {
    const deA = { de: "ficha-a", dados: respostaDoContato(config(), vinculo(), null, AGORA), falhou: false };
    // O render logo depois da troca: contato B, leitura ainda a de A.
    const naCarga = leituraParaOContato(deA, "ficha-b");
    expect(naCarga).toMatchObject({ dados: null, carregando: true, falhou: false, ultimaLeitura: "vinculo" });
    expect(agente(naCarga.ultimaLeitura)).toBe(true);
    // (Pelo vínculo do contato atual — nulo na carga — a aba sumia aqui.)
    expect(!!naCarga.dados?.vinculo).toBe(false);
  });

  it("uma releitura que FALHA mantém a aba (com a falha), e a ficha sem vínculo a tira depois da carga", () => {
    const falhou = leituraParaOContato({ de: "ficha-a", dados: null, falhou: true }, "ficha-a");
    expect(falhou).toMatchObject({ carregando: false, falhou: true, ultimaLeitura: "falhou" });
    expect(agente(falhou.ultimaLeitura)).toBe(true);
    const semVinculo = leituraParaOContato({ de: "ficha-b", dados: respostaDoContato(config(), null, null, AGORA), falhou: false }, "ficha-b");
    expect(semVinculo.ultimaLeitura).toBe("sem_vinculo");
    expect(agente(semVinculo.ultimaLeitura)).toBe(false);
    expect(leituraParaOContato({ de: null, dados: null, falhou: false }, "ficha-a")).toMatchObject({ carregando: true, ultimaLeitura: null });
  });
});

describe("situacaoConhecida", () => {
  it("sem diferença de maiúsculas; em_negociacao vale ativo; outra = null (reserva)", () => {
    expect(situacaoConhecida("Rescindido")).toBe("rescindido");
    expect(situacaoConhecida("em_negociacao")).toBe("ativo");
    expect(situacaoConhecida("arquivado")).toBeNull();
    expect(situacaoConhecida(null)).toBeNull();
  });
});

// Chaves MONTADAS da aba (`situacao.<s>`, `origem.<o>`, `casouPor.<x>`,
// `erro.<código>`) escapam do portão de i18n: colhidas das constantes do
// código, cobradas nos DOIS dicionários (o fallback do next-intl é por arquivo).
describe("chaves montadas de Inbox.atlas nos dois dicionários", () => {
  const grupos: [string, readonly string[]][] = [
    ["situacao", SITUACOES_DO_ATLAS],
    ["origem", ORIGENS_DO_VINCULO],
    ["casouPor", CASOU_POR],
    ["erro", ERROS_DO_VINCULO],
  ];
  for (const [nome, dic] of [
    ["pt-BR", ptBR],
    ["en", en],
  ] as const) {
    it(`${nome}: toda chave colhida existe, e nenhuma sobra`, () => {
      const atlas = (dic as unknown as { Inbox: { atlas: Record<string, unknown> } }).Inbox.atlas;
      for (const [grupo, chaves] of grupos) {
        const obj = atlas[grupo] as Record<string, unknown>;
        for (const c of chaves) expect(typeof obj?.[c], `${nome}: Inbox.atlas.${grupo}.${c}`).toBe("string");
        expect(Object.keys(obj).sort(), `${nome}: Inbox.atlas.${grupo} com chave órfã`).toEqual([...chaves].sort());
      }
      for (const reserva of ["situacaoOutra", "situacaoNaoLida", "origemOutra", "erroGenerico"]) {
        expect(typeof atlas[reserva], `${nome}: Inbox.atlas.${reserva}`).toBe("string");
      }
    });
  }
});
