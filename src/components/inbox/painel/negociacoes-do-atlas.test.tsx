import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";

import en from "../../../../messages/en.json";
import ptBR from "../../../../messages/pt-BR.json";
import {
  ERROS_DAS_NEGOCIACOES,
  lerNegociacoes,
  SITUACOES_DA_PROPOSTA,
  SITUACOES_DO_CONTRATO,
  TIPOS_DE_PROPOSTA,
  type NegociacoesDoAtlas as Negociacoes,
} from "@/lib/atlas/negociacoes";

import {
  descontoOuTraco,
  dinheiroOuTraco,
  ESTADO_INICIAL,
  estadoVisivel,
  NegociacoesDoAtlas,
  PainelDasNegociacoes,
  proximoEstado,
  type EstadoDasNegociacoes,
} from "./negociacoes-do-atlas";

// ============================================================
// A seção "Negociação no Atlas" (Fase 3). Dados FICTÍCIOS.
// ============================================================

/** O ATRIBUTO `disabled` (a classe `disabled:pointer-events-none` do botão casaria com um `/disabled/` solto). */
const BOTAO_TRAVADO = /<button[^>]*\sdisabled=""/;

const FICHA_A = "00000000-0000-4000-8000-0000000000a1";
const FICHA_B = "00000000-0000-4000-8000-0000000000b1";

function desenhar(no: React.ReactNode, messages: unknown = ptBR, locale = "pt-BR") {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages as AbstractIntlMessages} timeZone="America/Sao_Paulo">
      {no}
    </NextIntlClientProvider>,
  );
}

const painel = (estado: Partial<EstadoDasNegociacoes>, extra: { carregando?: boolean; esperando?: boolean } = {}, messages?: unknown, locale?: string) =>
  desenhar(
    <PainelDasNegociacoes
      estado={{ ...ESTADO_INICIAL, de: FICHA_A, ...estado }}
      carregando={extra.carregando ?? false}
      atualizando={false}
      esperando={extra.esperando ?? false}
      onAtualizar={() => {}}
    />,
    messages,
    locale,
  );

const NEGOCIACAO: Negociacoes = lerNegociacoes({
  truncated: false,
  totals: { banks: 1, contracts: 1, proposals: 2 },
  banks: [
    {
      id: "b1",
      bank_name: "Banco Exemplo",
      original_debt: 10000,
      updated_debt: 12500,
      contracts: [
        {
          id: "c1",
          contract_ref: "123456",
          titular: "Cliente Exemplo",
          debt_type: "Crédito Consignado",
          is_judicializado: true,
          status: "quitado",
          settled_date: "2026-08-10",
          settlement: { total_debt_at_settlement: 12000, total_settled_amount: 6000, discount_pct: 50 },
        },
      ],
      proposals: [
        { id: "p1", date: "2026-07-01", proposed_amount: 6000, base_debt: 12000, discount_pct: 50, status: "aceita", proposal_type: "a_vista" },
        { id: "p2", date: null, proposed_amount: 14000, base_debt: null, discount_pct: null, status: "contraproposta", proposal_type: "misto" },
      ],
    },
  ],
})!;

describe("o carimbo { de } — nada do contato anterior", () => {
  it("antes da resposta: carregando, e nada de dado", () => {
    expect(estadoVisivel(ESTADO_INICIAL, FICHA_A)).toEqual({ carregando: true, estado: ESTADO_INICIAL });
  });

  it("a resposta de A NÃO aparece quando a prop já é B (efeito passivo)", () => {
    const deA = proximoEstado(ESTADO_INICIAL, FICHA_A, { tipo: "ok", negociacoes: NEGOCIACAO });
    expect(estadoVisivel(deA, FICHA_A)).toEqual({ carregando: false, estado: deA });
    const v = estadoVisivel(deA, FICHA_B);
    expect(v.carregando).toBe(true);
    expect(v.estado.negociacoes).toBeNull();
  });

  it("429 depois de ler: a negociação DESTE contato fica; a de outro nunca", () => {
    const deA = proximoEstado(ESTADO_INICIAL, FICHA_A, { tipo: "ok", negociacoes: NEGOCIACAO });
    const espera = { segundos: 9, origem: "atlas" } as const;
    expect(proximoEstado(deA, FICHA_A, { tipo: "limite", espera })).toEqual({ de: FICHA_A, negociacoes: NEGOCIACAO, erro: null, espera });
    expect(proximoEstado(deA, FICHA_B, { tipo: "limite", espera })).toEqual({ de: FICHA_B, negociacoes: null, erro: null, espera });
  });

  it("429 depois de um ERRO: o erro velho sai (a última resposta só disse 'espere')", () => {
    const comErro = proximoEstado(ESTADO_INICIAL, FICHA_A, { tipo: "erro", erro: "sem_permissao" });
    const espera = { segundos: 30, origem: "crm" } as const;
    expect(proximoEstado(comErro, FICHA_A, { tipo: "limite", espera })).toEqual({ de: FICHA_A, negociacoes: null, erro: null, espera });
  });

  it("erro troca a negociação (a lixeira não mostra a lista velha como atual)", () => {
    const deA = proximoEstado(ESTADO_INICIAL, FICHA_A, { tipo: "ok", negociacoes: NEGOCIACAO });
    expect(proximoEstado(deA, FICHA_A, { tipo: "erro", erro: "nao_encontrado" })).toEqual({ de: FICHA_A, negociacoes: null, erro: "nao_encontrado", espera: null });
  });

  it("montada, o primeiro desenho é o spinner (a busca roda no efeito)", () => {
    const html = desenhar(<NegociacoesDoAtlas contactId={FICHA_A} />);
    expect(html).toContain("animate-spin");
    expect(html).not.toContain("Nenhum banco");
  });
});

describe("os estados da seção", () => {
  it("carregando: spinner, sem 'sem negociação' e sem botão", () => {
    const html = painel({ de: null }, { carregando: true });
    expect(html).toContain("animate-spin");
    expect(html).not.toContain("Nenhum banco");
    expect(html).not.toContain("<button");
  });

  it("sem banco nenhum: 'sem negociação' (só com resposta)", () => {
    expect(painel({ negociacoes: { truncated: false, totals: { banks: 0, contracts: 0, proposals: 0 }, banks: [] } })).toContain(
      "Nenhum banco cadastrado para este cliente no Atlas.",
    );
  });

  it("cada erro tem a sua frase, com 'Tentar de novo', e nenhum vira 'sem negociação'", () => {
    const esperado: Record<string, string> = {
      sem_permissao: "A leitura das negociações está desligada no Atlas.",
      nao_encontrado: "O cliente não foi encontrado no Atlas (pode estar na lixeira).",
      falhou: "Não foi possível ler as negociações no Atlas.",
    };
    for (const erro of ERROS_DAS_NEGOCIACOES) {
      const html = painel({ erro });
      expect(html, erro).toContain("Tentar de novo");
      expect(html, erro).not.toContain("Nenhum banco");
      if (esperado[erro]) expect(html, erro).toContain(esperado[erro]);
    }
    expect(painel({ erro: "sem_permissao" })).toContain("“Ler negociações”");
  });

  it("429 do Atlas: a espera pedida, e o botão travado enquanto dura", () => {
    const html = painel({ espera: { segundos: 17, origem: "atlas" } }, { esperando: true });
    expect(html).toContain("O Atlas pediu para esperar 17 s antes de ler de novo.");
    expect(html).toMatch(BOTAO_TRAVADO);
    expect(html).not.toContain("Nenhum banco");
  });

  it("429 do balde do CRM: nunca atribui ao Atlas (nenhuma chamada foi feita)", () => {
    const html = painel({ espera: { segundos: 17, origem: "crm" } }, { esperando: true });
    expect(html).toContain("Muitas leituras em pouco tempo; aguarde 17 s antes de ler de novo.");
    expect(html).not.toContain("O Atlas pediu");
    expect(desenhar(<PainelDasNegociacoes estado={{ ...ESTADO_INICIAL, de: FICHA_A, espera: { segundos: 5, origem: "crm" } }} carregando={false} atualizando={false} esperando onAtualizar={() => {}} />, en, "en")).toContain(
      "Too many reads in a short time; wait 5 s",
    );
  });

  it("espera vencida: o aviso com os segundos velhos sai; fica o 'Tentar de novo' destravado", () => {
    for (const origem of ["atlas", "crm"] as const) {
      const html = painel({ espera: { segundos: 17, origem } }, { esperando: false });
      expect(html, origem).not.toContain("17 s");
      expect(html, origem).toContain("Tentar de novo");
      expect(html, origem).not.toMatch(BOTAO_TRAVADO);
    }
    // Com a negociação já mostrada, ela continua lá, sem o aviso.
    const comLista = painel({ negociacoes: NEGOCIACAO, espera: { segundos: 17, origem: "atlas" } }, { esperando: false });
    expect(comLista).toContain("Banco Exemplo");
    expect(comLista).not.toContain("O Atlas pediu");
  });

  it("a negociação: banco, dívidas, contrato (titular, judicializado, quitado, acordo) e propostas", () => {
    const html = painel({ negociacoes: NEGOCIACAO });
    expect(html).toContain("Banco Exemplo");
    expect(html).toContain(`Dívida original ${dinheiroOuTraco(10000)}`);
    expect(html).toContain(`atualizada ${dinheiroOuTraco(12500)}`);
    expect(html).toContain("Contratos (1)");
    expect(html).toContain("123456");
    expect(html).toContain("Titular: Cliente Exemplo · Quitado · Judicializado · quitado em 10/08/2026");
    expect(html).toContain(`Acordo: ${dinheiroOuTraco(6000)} sobre ${dinheiroOuTraco(12000)} (desconto de ${descontoOuTraco(50)})`);
    expect(html).toContain("Propostas (2)");
    expect(html).toContain(`01/07/2026 · ${dinheiroOuTraco(6000)}`);
    expect(html).toContain("Aceita · À vista");
    // desconhecidos: texto de reserva, nunca a chave crua nem o valor cru
    expect(html).toContain("Situação não reconhecida · Outro tipo");
    expect(html).not.toContain("situacaoDaProposta.");
    expect(html).not.toContain("contraproposta");
    // nulos: travessão
    expect(html).toContain(`— · ${dinheiroOuTraco(14000)}`);
    expect(html).toContain("Dívida base — · desconto —");
  });

  it("lista cortada: a nota com os totais reais", () => {
    const html = painel({ negociacoes: { ...NEGOCIACAO, truncated: true, totals: { banks: 1, contracts: 1200, proposals: null } } });
    expect(html).toContain("A lista veio cortada pelo Atlas. No total: 1 bancos, 1200 contratos e — propostas.");
  });


  it("os dois dicionários desenham (fallback do next-intl é por arquivo)", () => {
    const html = painel({ negociacoes: NEGOCIACAO }, {}, en, "en");
    expect(html).toContain("Negotiation in Atlas");
    expect(html).toContain("Accepted · Lump sum");
  });
});

describe("classe do Tailwind só LITERAL (CLAUDE.md 8c)", () => {
  // Lido no FONTE: no HTML desenhado o template já foi avaliado
  // (`text-${cor}-700` sai `text-amber-700`) e nenhuma asserção o pegaria.
  const fonte = readFileSync(join(__dirname, "negociacoes-do-atlas.tsx"), "utf8");
  const MONTADA = [
    // className={`… ${…} …`}
    /className=\{\s*`[^`]*\$\{/,
    // cn(… `… ${…}` …) / clsx / twMerge
    /\b(?:cn|clsx|twMerge)\([^)]*`[^`]*\$\{/,
    // prefixo de utilitário colado numa interpolação: `bg-${cor}`, `text-${x}`
    /\b(?:text|bg|border|ring|fill|stroke|from|to|via)-\$\{/,
  ];

  it("negociacoes-do-atlas.tsx não monta classe", () => {
    for (const re of MONTADA) expect(fonte, String(re)).not.toMatch(re);
  });

  it("o pino pega as formas montadas (senão não pina nada)", () => {
    const amostras = ["<p className={`text-${cor}-700`} />", "<p className={cn(\"px-1\", `bg-${cor}-500`)} />", "const c = `border-${cor}`;"];
    for (const a of amostras) expect(MONTADA.some((re) => re.test(a)), a).toBe(true);
    // e não reprova a chave montada do i18n nem classe literal
    expect(MONTADA.some((re) => re.test("t(`${grupo}.${valor}`)"))).toBe(false);
    expect(MONTADA.some((re) => re.test('<p className="text-amber-700 dark:text-amber-300" />'))).toBe(false);
  });
});

describe("dinheiro e desconto", () => {
  it("nulo = travessão; negativo aparece negativo", () => {
    expect(dinheiroOuTraco(null)).toBe("—");
    expect(descontoOuTraco(null)).toBe("—");
    expect(descontoOuTraco(-12.5)).toMatch(/^[-−]\s?12[.,]5\s?%$/);
  });
});

describe("chaves MONTADAS nos dois dicionários (colhidas das constantes do código)", () => {
  const dicionarios = { "pt-BR": ptBR, en } as unknown as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
  for (const [nome, dic] of Object.entries(dicionarios)) {
    const ns = dic.Inbox.atlasNegociacoes as Record<string, Record<string, unknown>>;
    it(`${nome}: situação do contrato, da proposta, tipo (com a reserva) e cada erro`, () => {
      for (const s of [...SITUACOES_DO_CONTRATO, "outra"]) expect(typeof ns.situacaoDoContrato[s], `situacaoDoContrato.${s}`).toBe("string");
      for (const s of [...SITUACOES_DA_PROPOSTA, "outra"]) expect(typeof ns.situacaoDaProposta[s], `situacaoDaProposta.${s}`).toBe("string");
      for (const s of [...TIPOS_DE_PROPOSTA, "outra"]) expect(typeof ns.tipoDaProposta[s], `tipoDaProposta.${s}`).toBe("string");
      for (const e of ERROS_DAS_NEGOCIACOES) expect(typeof ns.erro[e], `erro.${e}`).toBe("string");
    });
  }
});
