import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PASSOS_DO_ATLAS, ehPassoDoAtlas, trocarAcao, type PassoDoAtlas } from "@/lib/atlas/passos-do-atlas";

// ============================================================
// O nó "Atlas" no construtor (decisão do operador, 30/09/2026): UMA entrada
// no menu, as cinco ações (cada uma um `step_type`) com destaque de
// integração — borda laranja, ícone tingido e o selo "Integração Atlas" — e
// um seletor de ação dentro do passo. O construtor veio do upstream: um
// merge que o traga cru apaga o nó sem conflito nenhum. Este pino lê o fonte.
// ============================================================

const raiz = path.join(__dirname, "../../..");
const ler = (arquivo: string) => fs.readFileSync(path.join(raiz, arquivo), "utf8");
const construtor = ler("src/components/automations/automation-builder.tsx");

/** O corpo de uma função do construtor (até a próxima função de topo). */
function corpoDe(nome: string): string {
  const inicio = construtor.indexOf(`function ${nome}(`);
  expect(inicio, nome).toBeGreaterThan(-1);
  const fim = construtor.indexOf("\nfunction ", inicio + 1);
  return construtor.slice(inicio, fim === -1 ? undefined : fim);
}

/** O `step_config` do "Criar cliente no Atlas" LIGADO em produção (o "Contrato fechado"). */
const CONFIG_DE_PRODUCAO = {
  tipo_de_contrato: "fixo",
  campo_primeiro_contato: "data_do_primeiro_contato",
  campo_proposta: "data_da_proposta",
  campo_fechamento: "data_de_fechamento_do_contrato",
};

describe("o nó Atlas no construtor", () => {
  it("os cinco passos do Atlas são de integração e usam uma borda que nenhum outro passo usa", () => {
    expect(construtor).toMatch(/function ehPassoDeIntegracao\([^)]*\)[^{]*\{\s*return ehPassoDoAtlas\(tipo\)/);
    const bordas = [...construtor.matchAll(/^\s+(\w+): \{ label: "\w+", icon: \w+, border: "([^"]+)" \},?$/gm)].map((m) => [m[1], m[2]]);
    const laranjas = bordas.filter(([, borda]) => borda === "border-l-orange-500").map(([tipo]) => tipo);
    expect(laranjas.sort()).toEqual([...PASSOS_DO_ATLAS].sort());
    for (const tipo of PASSOS_DO_ATLAS) expect(ehPassoDoAtlas(tipo)).toBe(true);
    expect(ehPassoDoAtlas("create_task")).toBe(false);
  });

  it("UMA entrada do Atlas no menu de adicionar, com o nome do nó e o selo", () => {
    const lista = construtor.match(/const ADDABLE_STEPS: AutomationStepType\[\] = \[([\s\S]*?)\]/)?.[1] ?? "";
    const tipos = [...lista.matchAll(/"(\w+)"/g)].map((m) => m[1]);
    expect(tipos.filter((t) => ehPassoDoAtlas(t))).toEqual(["atlas_criar_cliente"]);
    expect(construtor).toMatch(/ehPassoDoAtlas\(tp\) \? t\("atlas\.no"\) : t\(`steps\.\$\{STEP_META\[tp\]\.label\}`\)/);
    // No gatilho do Atlas, o nó nasce "Criar tarefa" (o "Criar cliente" seria recusado).
    expect(construtor).toMatch(/ehPassoDoAtlas\(tp\) && gatilhoDoAtlas \? "atlas_criar_tarefa" : tp/);
  });

  it("o selo aparece no cartão e no menu de adicionar, com a chave nos dois dicionários", () => {
    expect(construtor.match(/ehPassoDeIntegracao\(step\.step_type\) && <span className=\{SELO_DE_INTEGRACAO\}>\{t\("integracaoAtlas"\)\}/g)).toHaveLength(1);
    expect(construtor).toMatch(/ehPassoDeIntegracao\(tp\) && <span className=\{cn\(SELO_DE_INTEGRACAO, "ml-auto"\)\}>\{t\("integracaoAtlas"\)\}/);
  });

  it("as cinco ações caem no editor do nó, e o seletor oferece as cinco com chave LITERAL nos dois dicionários", () => {
    for (const tipo of PASSOS_DO_ATLAS) expect(construtor).toContain(`case "${tipo}":`);
    expect(construtor).toMatch(/return <AtlasPassoFields step=\{step\} onChange=\{onChange\} t=\{t\} \/>/);
    const editor = corpoDe("AtlasPassoFields");
    const acoes = ["criarCliente", "atualizarCliente", "criarTarefa", "enviarTranscricao", "atualizarOnboarding"];
    for (const a of acoes) expect(editor).toContain(`t("atlas.acao.${a}")`);
    for (const arquivo of ["messages/pt-BR.json", "messages/en.json"]) {
      const builder = JSON.parse(ler(arquivo)).Automations.builder;
      expect(typeof builder.integracaoAtlas, arquivo).toBe("string");
      expect(typeof builder.atlas.no, arquivo).toBe("string");
      expect(typeof builder.atlas.trocarAcaoConfirma, arquivo).toBe("string");
      for (const a of acoes) expect(typeof builder.atlas.acao[a], `${arquivo}: atlas.acao.${a}`).toBe("string");
    }
  });

  it("CRÍTICO: trocar de ação passa pela confirmação e pela memória, e MANTÉM a identidade do passo", () => {
    const editor = corpoDe("AtlasPassoFields");
    expect(editor).toMatch(/trocaApagaAlgo\(cfg, blankConfig\(acao\)\) && !window\.confirm\(t\("atlas\.trocarAcaoConfirma"\)\)/);
    expect(editor).toMatch(/trocarAcao\(\{ tipo: acao, config: cfg \}, novo, MEMORIA_DO_NO_ATLAS\.get\(step\.cid\) \?\? \{\}, blankConfig\)/);
    // `...step` leva `cid` e `id` (a espera parada num ramo guarda o id do passo).
    expect(editor).toMatch(/onChange\(\{ \.\.\.step, step_type: novo, step_config: r\.config \}\)/);
  });

  it("CRÍTICO: a config de PRODUÇÃO do 'Criar cliente' volta idêntica depois de trocar de ação e voltar", () => {
    const vazia = (t: PassoDoAtlas): Record<string, unknown> => (t === "atlas_criar_cliente" ? { tipo_de_contrato: "fixo" } : {});
    const ida = trocarAcao({ tipo: "atlas_criar_cliente", config: CONFIG_DE_PRODUCAO }, "atlas_atualizar_cliente", {}, vazia);
    expect(ida.config).toEqual({});
    const volta = trocarAcao({ tipo: "atlas_atualizar_cliente", config: { situacao: "finalizado" } }, "atlas_criar_cliente", ida.memoria, vazia);
    expect(volta.config).toBe(CONFIG_DE_PRODUCAO);
    // E a do "Atualizar" também volta, se o operador voltar a ele.
    expect(trocarAcao({ tipo: "atlas_criar_cliente", config: volta.config }, "atlas_atualizar_cliente", volta.memoria, vazia).config).toEqual({
      situacao: "finalizado",
    });
  });

  it("CRÍTICO: nenhum formulário do nó escreve na config ao MONTAR (sem efeito que chame set/onChange)", () => {
    for (const nome of [
      "AtlasPassoFields",
      "AtlasCriarClienteFields",
      "AtlasAtualizarClienteFields",
      "AtlasCriarTarefaFields",
      "AtlasEnviarTranscricaoFields",
      "AtlasAtualizarOnboardingFields",
      "CampoDeDataDoAtlas",
      "CaixaDoAtlas",
    ]) {
      expect(corpoDe(nome), nome).not.toMatch(/use(Layout)?Effect\(/);
    }
  });

  it("na automação do gatilho do Atlas, o seletor esconde as ações que a ativação recusa (a já escolhida fica)", () => {
    const editor = corpoDe("AtlasPassoFields");
    expect(editor).toMatch(/a === acao \|\| !gatilhoDoAtlas \|\| !PASSOS_FORA_DO_GATILHO_DO_ATLAS\.includes\(a\)/);
    expect(construtor).toMatch(/gatilhoDoAtlas: state\.trigger_type === GATILHO_DO_ATLAS/);
  });
});

// ------------------------------------------------------------
// O contraste do destaque (a regra do `dark:` inerte, `.claude/rules/ui.md`):
// a MESMA cor vale nos dois temas, então se MEDE nos dois. As cores saem do
// tema do Tailwind e do `globals.css` (nunca digitadas aqui); a fórmula é a
// da WCAG 2 sobre o sRGB convertido do OKLCH.
// ------------------------------------------------------------

type Rgb = [number, number, number];

function deOklch(l: number, c: number, h: number): Rgb {
  const r = (h * Math.PI) / 180;
  const a = c * Math.cos(r);
  const b = c * Math.sin(r);
  const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ].map((x) => Math.min(1, Math.max(0, x)));
  return lin.map((x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)) as Rgb;
}
function lerOklch(texto: string): Rgb {
  const m = texto.match(/oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)/);
  if (!m) throw new Error(`não é oklch: ${texto}`);
  return deOklch(Number(m[1]) / (m[2] ? 100 : 1), Number(m[3]), Number(m[4]));
}
const luminancia = (c: Rgb) => {
  const [r, g, b] = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a: Rgb, b: Rgb) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const sobre = (frente: Rgb, fundo: Rgb, alfa: number) => frente.map((v, i) => v * alfa + fundo[i] * (1 - alfa)) as Rgb;

const temaDoTailwind = fs.readFileSync(require.resolve("tailwindcss/theme.css"), "utf8");
const corDoTailwind = (nome: string): Rgb => {
  if (nome === "white") return [1, 1, 1];
  const m = temaDoTailwind.match(new RegExp(`--color-${nome}:\\s*(oklch\\([^)]*\\))`));
  if (!m) throw new Error(`cor ${nome} fora do tema`);
  return lerOklch(m[1]);
};
const globais = ler("src/app/globals.css");
function superficie(modo: "dark" | "light", variavel: string): Rgb {
  const bloco = globais.match(new RegExp(`html\\[data-mode="${modo}"\\] \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
  const m = bloco.match(new RegExp(`--${variavel}:\\s*(oklch\\([^)]*\\))`));
  if (!m) throw new Error(`--${variavel} fora do modo ${modo}`);
  return lerOklch(m[1]);
}
const constante = (nome: string) => construtor.match(new RegExp(`const ${nome} =\\s*"([^"]+)"`))?.[1] ?? "";

describe("o destaque do nó Atlas lê nos dois temas", () => {
  const modos = ["light", "dark"] as const;

  it("CRÍTICO: o selo (texto de 10 px) passa 4,5:1 nos DOIS temas", () => {
    const classes = constante("SELO_DE_INTEGRACAO").split(/\s+/);
    const texto = classes.find((c) => /^text-(white|[a-z]+-\d+)$/.test(c))?.slice("text-".length);
    const fundo = classes.find((c) => /^bg-[a-z]+-\d+(\/\d+)?$/.test(c))?.slice("bg-".length);
    expect(texto, "cor do texto do selo").toBeTruthy();
    expect(fundo, "fundo do selo").toBeTruthy();
    const [corDoFundo, opacidade] = (fundo as string).split("/");
    for (const modo of modos) {
      const cartao = superficie(modo, "card");
      const atras = opacidade ? sobre(corDoTailwind(corDoFundo), cartao, Number(opacidade) / 100) : corDoTailwind(corDoFundo);
      expect(contraste(corDoTailwind(texto as string), atras), modo).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("o ícone tingido (gráfico) passa 3:1 nos dois temas, no cartão e no menu", () => {
    const classes = constante("ICONE_DE_INTEGRACAO").split(/\s+/);
    const texto = classes.find((c) => /^text-[a-z]+-\d+$/.test(c))?.slice("text-".length) as string;
    const [corDoFundo, opacidade] = (classes.find((c) => /^bg-[a-z]+-\d+\/\d+$/.test(c))?.slice("bg-".length) as string).split("/");
    const doMenu = construtor.match(/ehPassoDeIntegracao\(tp\) && "text-([a-z]+-\d+)"/)?.[1] as string;
    expect(doMenu).toBeTruthy();
    for (const modo of modos) {
      const noCartao = sobre(corDoTailwind(corDoFundo), superficie(modo, "card"), Number(opacidade) / 100);
      expect(contraste(corDoTailwind(texto), noCartao), `cartão ${modo}`).toBeGreaterThanOrEqual(3);
      for (const fundo of ["popover", "accent"]) {
        expect(contraste(corDoTailwind(doMenu), superficie(modo, fundo)), `menu ${fundo} ${modo}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
