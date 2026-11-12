import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { CartaoDoAsaas, ReguaDoCartao } from "./cartao";
import type { ResumoDoEspelho } from "./listas";
import { CASOS_DA_PREVIA } from "./previa-da-regua";
import { PASSOS_DO_ASAAS, primeirosPassos } from "./primeiros-passos";

const cartao = (p: Partial<CartaoDoAsaas> = {}): CartaoDoAsaas =>
  ({
    estado: "conectado",
    nuncaSincronizado: false,
    webhook: { estado: "ativo", erro: null, email: null, religadoPeloCrm: false, conferidoEm: null, ultimoEvento: null, registrado: true },
    ...p,
  }) as CartaoDoAsaas;
const regua = (p: Partial<ReguaDoCartao> = {}): ReguaDoCartao => ({ ativa: false, ativadaEm: null, intervaloDias: 3, automacoesTotal: 6, automacoesLigadas: 0, marcosRepetidos: [], lembreteRepetido: false, ...p });
const resumo = (p: Partial<ResumoDoEspelho> = {}) => ({ clientes: 412, confirmar: 7, ...p }) as ResumoDoEspelho;

describe("primeirosPassos", () => {
  it("diz o que falta, na ordem", () => {
    const passos = primeirosPassos(cartao(), resumo(), regua());
    expect(passos.map((p) => [p.passo, p.situacao, p.n])).toEqual([
      ["conectar", "feito", null],
      ["webhook", "feito", null],
      ["primeira_leitura", "feito", 412],
      ["vinculos", "falta", 7],
      ["cobranca", "falta", null],
    ]);
  });

  it("resumo nulo não afirma nada sobre leitura e vínculos", () => {
    const passos = primeirosPassos(cartao(), null, regua({ ativa: true, automacoesLigadas: 2 }));
    expect(passos.find((p) => p.passo === "vinculos")?.situacao).toBe("nao_sei");
    expect(passos.find((p) => p.passo === "primeira_leitura")?.situacao).toBe("nao_sei");
    expect(passos.find((p) => p.passo === "cobranca")?.situacao).toBe("feito");
  });

  it("ligada sem etapa ligada não está feita", () => {
    expect(primeirosPassos(cartao(), resumo({ confirmar: 0 }), regua({ ativa: true })).find((p) => p.passo === "cobranca")?.situacao).toBe("falta");
  });
});

// As chaves MONTADAS das telas do módulo (1135) escapam dos portões de i18n:
// este teste as cobra nos dois dicionários.
describe("as chaves montadas do módulo nos dois dicionários", () => {
  const ler = (arq: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", arq), "utf8")) as Record<string, unknown>;
  const pegar = (d: Record<string, unknown>, chave: string): unknown => chave.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), d);
  const chaves = [
    ...CASOS_DA_PREVIA.flatMap((c) => [`Settings.integracoes.cobranca.texto.caso.${c}`, `Settings.integracoes.cobranca.texto.legenda.${c}`]),
    ...PASSOS_DO_ASAAS.flatMap((p) => [`Settings.integracoes.modulo.passos.${p}.titulo`, `Settings.integracoes.modulo.passos.${p}.desc`]),
    ...["feito", "falta", "nao_sei"].map((s) => `Settings.integracoes.modulo.passos.situacao.${s}`),
    ...["vinculo", "aviso", "filtro", "excecao", "cobranca"].flatMap((f) => ["titulo", "desc", "onde"].map((k) => `Settings.integracoes.modulo.funcoes.${f}.${k}`)),
  ];
  for (const arq of ["pt-BR.json", "en.json"]) {
    it(arq, () => {
      const d = ler(arq);
      expect(chaves.filter((c) => typeof pegar(d, c) !== "string")).toEqual([]);
    });
  }
});
