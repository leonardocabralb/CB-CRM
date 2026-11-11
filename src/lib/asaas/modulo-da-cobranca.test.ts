import { describe, expect, it } from "vitest";

import { blocoDaLigacao, derivarEstado, lerBlocoDaLigacao, nomeDoEscritorio, patchesDoModulo, type AutomacaoDoModulo, type LigacaoDaRegua, type PassoDoModulo } from "./modulo-da-cobranca";

const CANAL_A = "11111111-1111-4111-8111-111111111111";
const CANAL_B = "22222222-2222-4222-8222-222222222222";
const TAG = "33333333-3333-4333-8333-333333333333";
const MEMBRO = "44444444-4444-4444-8444-444444444444";

const msg = (texto: string, canal: string | null = CANAL_A, id?: string): PassoDoModulo => ({ id, step_type: "send_message", step_config: canal ? { text: texto, channel_id: canal } : { text: texto } });

function automacao(p: Partial<AutomacaoDoModulo> & Pick<AutomacaoDoModulo, "id" | "trigger_type">): AutomacaoDoModulo {
  return { name: p.id, trigger_config: {}, is_active: false, assinatura_personalizada: null, steps: [msg("Olá")], ...p };
}

const LIGACAO: LigacaoDaRegua = { parcelas: 2, dias: 15, mencionados: [MEMBRO], tagId: TAG, texto: "Ligar para o cliente." };

const cobranca = (dias: number, extra: Partial<AutomacaoDoModulo> = {}) =>
  automacao({ id: `c${dias}`, name: `Cobrança · ${dias} dias`, trigger_type: "asaas_cobranca_vencida", trigger_config: { dias_de_atraso: dias, hora_envio: "09:00", somente_dias_uteis: true }, ...extra });
const lembrete = (hora: string, extra: Partial<AutomacaoDoModulo> = {}) =>
  automacao({ id: `l${hora}`, name: `Lembrete ${hora}`, trigger_type: "asaas_cobranca_vence_hoje", trigger_config: { hora_envio: hora, somente_dias_uteis: true }, ...extra });

describe("derivarEstado", () => {
  it("ordena lembrete do dia, da noite e as cobranças pelos dias; ignora outras automações", () => {
    const e = derivarEstado([cobranca(30), lembrete("20:00"), cobranca(1), automacao({ id: "x", trigger_type: "keyword_match" }), lembrete("09:00"), cobranca(5)]);
    expect(e.etapas.map((x) => [x.tipo, x.turno, x.dias])).toEqual([
      ["lembrete", "dia", null],
      ["lembrete", "noite", null],
      ["cobranca", null, 1],
      ["cobranca", null, 5],
      ["cobranca", null, 30],
    ]);
  });

  it("um número só, vários, ou envio sem número", () => {
    expect(derivarEstado([cobranca(1), lembrete("09:00")]).canal).toEqual({ tipo: "um", id: CANAL_A });
    expect(derivarEstado([cobranca(1), lembrete("09:00", { steps: [msg("x", CANAL_B)] })]).canal).toEqual({ tipo: "varios", ids: [CANAL_A, CANAL_B] });
    const semCanal = derivarEstado([cobranca(1, { steps: [msg("x", null)] })]);
    expect(semCanal.canal).toEqual({ tipo: "nenhum" });
    expect(semCanal.etapas[0].envioSemCanal).toBe(true);
  });

  it("a assinatura comum ignora o lembrete da noite", () => {
    const e = derivarEstado([cobranca(1, { assinatura_personalizada: "Carol - Financeiro" }), lembrete("09:00", { assinatura_personalizada: "Carol - Financeiro" }), lembrete("20:00", { assinatura_personalizada: "Mensagem automática" })]);
    expect(e.assinatura).toEqual({ tipo: "uma", valor: "Carol - Financeiro" });
    expect(derivarEstado([cobranca(1, { assinatura_personalizada: "A" }), cobranca(5, { assinatura_personalizada: "B" })]).assinatura).toEqual({ tipo: "varias" });
  });

  it("dias úteis: igual em todas ou misto", () => {
    expect(derivarEstado([cobranca(1), cobranca(5)]).somenteDiasUteis).toBe(true);
    expect(derivarEstado([cobranca(1), cobranca(5, { trigger_config: { dias_de_atraso: 5, hora_envio: "09:00", somente_dias_uteis: false } })]).somenteDiasUteis).toBe("misto");
  });

  it("o pedido de ligação: igual em todas as cobranças, diferente, à mão, ou desligado", () => {
    const comBloco = (d: number, l: LigacaoDaRegua = LIGACAO) => cobranca(d, { steps: [msg("x"), blocoDaLigacao(l)] });
    expect(derivarEstado([comBloco(1), comBloco(5), lembrete("09:00")]).ligacao).toEqual({ tipo: "igual", config: LIGACAO });
    expect(derivarEstado([comBloco(1), cobranca(5)]).ligacao).toEqual({ tipo: "diferente" });
    expect(derivarEstado([comBloco(1), comBloco(5, { ...LIGACAO, dias: 30 })]).ligacao).toEqual({ tipo: "diferente" });
    expect(derivarEstado([cobranca(1), cobranca(5)]).ligacao).toEqual({ tipo: "desligada" });
    const aMao = cobranca(1, { steps: [msg("x"), { step_type: "condition", step_config: { subject: "asaas_situacao", cobranca_parcelas: 2 }, branches: { yes: [{ step_type: "add_tag", step_config: { tag_id: TAG } }], no: [] } }] });
    const e = derivarEstado([aMao]);
    expect(e.etapas[0].ligacaoAMao).toBe(true);
    expect(e.ligacao).toEqual({ tipo: "diferente" });
  });

  it("marcos e turnos repetidos", () => {
    const e = derivarEstado([cobranca(5), { ...cobranca(5), id: "c5b" }, lembrete("09:00"), lembrete("10:00")]);
    expect(e.marcosRepetidos).toEqual([5]);
    expect(e.turnosRepetidos).toEqual(["dia"]);
  });

  it("lê as automações antigas da produção (texto e canal no primeiro passo)", () => {
    const antiga = cobranca(1, { steps: [msg("Olá, {{vars.cliente_primeiro_nome}}!", CANAL_B, "a1")] });
    const e = derivarEstado([antiga]);
    expect(e.etapas[0].texto).toBe("Olá, {{vars.cliente_primeiro_nome}}!");
    expect(e.etapas[0].canais).toEqual([CANAL_B]);
  });
});

describe("o bloco da ligação", () => {
  it("lê de volta o que grava", () => {
    expect(lerBlocoDaLigacao(blocoDaLigacao(LIGACAO))).toEqual(LIGACAO);
    expect(lerBlocoDaLigacao(blocoDaLigacao({ ...LIGACAO, parcelas: null }))).toEqual({ ...LIGACAO, parcelas: null });
  });

  it("forma diferente não é o bloco do módulo", () => {
    const b = blocoDaLigacao(LIGACAO);
    expect(lerBlocoDaLigacao({ ...b, branches: { yes: b.branches?.yes, no: [msg("x")] } })).toBeNull();
    expect(lerBlocoDaLigacao({ step_type: "condition", step_config: { subject: "tag_presence", operand: TAG } })).toBeNull();
  });
});

describe("patchesDoModulo", () => {
  it("sem mudança, nenhum PATCH", () => {
    expect(patchesDoModulo([cobranca(1), lembrete("09:00")], { etapas: {} })).toEqual([]);
  });

  it("a conexão troca em TODO envio, inclusive dentro dos ramos, e preserva os ids", () => {
    const comRamo = cobranca(1, { steps: [msg("x", CANAL_A, "p1"), { id: "p2", step_type: "condition", step_config: { subject: "tag_presence", operand: TAG }, branches: { yes: [msg("y", CANAL_A, "p3")], no: [] } }] });
    const [p] = patchesDoModulo([comRamo], { canalId: CANAL_B });
    expect(p.corpo.steps?.[0]).toMatchObject({ id: "p1", step_config: { channel_id: CANAL_B } });
    expect(p.corpo.steps?.[1].branches?.yes?.[0]).toMatchObject({ id: "p3", step_config: { channel_id: CANAL_B } });
    expect(patchesDoModulo([comRamo], { canalId: CANAL_A })).toEqual([]);
  });

  it("o texto troca só o PRIMEIRO \"Enviar mensagem\"", () => {
    const a = cobranca(1, { steps: [msg("um", CANAL_A, "p1"), msg("dois", CANAL_A, "p2")] });
    const [p] = patchesDoModulo([a], { etapas: { c1: { texto: "novo" } } });
    expect(p.corpo.steps?.map((s) => s.step_config.text)).toEqual(["novo", "dois"]);
  });

  it("quem assina vale para todas MENOS o lembrete da noite; nulo tira a assinatura", () => {
    const noite = lembrete("20:00", { assinatura_personalizada: "Mensagem automática" });
    const ps = patchesDoModulo([cobranca(1), lembrete("09:00"), noite], { assinatura: "Carol - Financeiro" });
    expect(ps.map((p) => [p.id, p.corpo.assinatura_personalizada])).toEqual([
      ["c1", "Carol - Financeiro"],
      ["l09:00", "Carol - Financeiro"],
    ]);
    const tirar = patchesDoModulo([cobranca(1, { assinatura_personalizada: "Carol" })], { assinatura: null });
    expect(tirar[0].corpo).toEqual({ assinatura_personalizada: null });
    expect(patchesDoModulo([noite], { etapas: { "l20:00": { assinatura: "Robô" } } })[0].corpo).toEqual({ assinatura_personalizada: "Robô" });
  });

  it("dias úteis e horário vão no trigger_config, sem perder o resto", () => {
    const [p] = patchesDoModulo([cobranca(5)], { somenteDiasUteis: false, etapas: { c5: { hora: "10:30" } } });
    expect(p.corpo.trigger_config).toEqual({ dias_de_atraso: 5, hora_envio: "10:30", somente_dias_uteis: false });
  });

  it("o pedido de ligação vai SÓ nas cobranças, no fim, e é trocado inteiro", () => {
    const ps = patchesDoModulo([cobranca(1), lembrete("09:00")], { ligacao: LIGACAO });
    expect(ps.map((p) => p.id)).toEqual(["c1"]);
    expect(ps[0].corpo.steps?.map((s) => s.step_type)).toEqual(["send_message", "condition"]);
    expect(lerBlocoDaLigacao(ps[0].corpo.steps![1])).toEqual(LIGACAO);

    const ja = cobranca(1, { steps: [msg("x"), blocoDaLigacao(LIGACAO)] });
    expect(patchesDoModulo([ja], { ligacao: LIGACAO })).toEqual([]);
    const trocado = patchesDoModulo([ja], { ligacao: { ...LIGACAO, dias: 30 } });
    expect(trocado[0].corpo.steps).toHaveLength(2);
    expect(lerBlocoDaLigacao(trocado[0].corpo.steps![1])?.dias).toBe(30);
    expect(patchesDoModulo([ja], { ligacao: null })[0].corpo.steps?.map((s) => s.step_type)).toEqual(["send_message"]);
  });

  it("a condição montada à mão fica onde está", () => {
    const aMao: PassoDoModulo = { step_type: "condition", step_config: { subject: "asaas_situacao", cobranca_dias: 10 }, branches: { yes: [{ step_type: "add_tag", step_config: { tag_id: TAG } }], no: [] } };
    const [p] = patchesDoModulo([cobranca(1, { steps: [msg("x"), aMao] })], { ligacao: LIGACAO });
    expect(p.corpo.steps).toHaveLength(3);
    expect(p.corpo.steps?.[1]).toBe(aMao);
  });

  it("a conexão nova alcança também os envios do bloco novo (sem envio, nada a trocar)", () => {
    const [p] = patchesDoModulo([cobranca(1)], { ligacao: LIGACAO, canalId: CANAL_B });
    expect(p.corpo.steps?.[0].step_config.channel_id).toBe(CANAL_B);
  });

  it("ligar vem por ÚLTIMO na leva", () => {
    const ps = patchesDoModulo([cobranca(1), cobranca(5)], { etapas: { c1: { ligada: true } }, canalId: CANAL_B });
    expect(ps.map((p) => [p.id, p.corpo.is_active])).toEqual([
      ["c5", undefined],
      ["c1", true],
    ]);
  });
});

describe("nomeDoEscritorio", () => {
  it("o do módulo, senão o automático da assinatura, senão o da conta", () => {
    expect(nomeDoEscritorio("CB Advogados", "Outro", "Conta")).toBe("CB Advogados");
    expect(nomeDoEscritorio("  ", "Automático", "Conta")).toBe("Automático");
    expect(nomeDoEscritorio(null, null, "Conta")).toBe("Conta");
    expect(nomeDoEscritorio(null, null, null)).toBe("");
  });
});
