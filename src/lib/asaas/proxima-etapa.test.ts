import { describe, expect, it } from "vitest";

import type { ParcelaDoEspelho } from "./inadimplencia";
import { proximaEtapaPrevista, type EntradaDaProxima } from "./proxima-etapa";

const FUSO = "America/Sao_Paulo";

function parcela(p: Partial<ParcelaDoEspelho> & Pick<ParcelaDoEspelho, "vencimento">): ParcelaDoEspelho {
  return {
    id: "p1",
    asaas_payment_id: "pay_1",
    asaas_customer_id: "cus_1",
    status: "OVERDUE",
    deleted: false,
    valor: 100,
    juros_e_multa: null,
    vencimento_original: null,
    vista_vencida_em: null,
    pago_em: null,
    forma: "BOLETO",
    pode_pagar_apos_vencimento: true,
    dias_ate_cancelar_registro: null,
    descricao: null,
    parcelamento_id: null,
    parcela_numero: null,
    parcela_total: null,
    link_fatura: null,
    link_boleto: null,
    visto_em: "2026-11-01T12:00:00Z",
    ...p,
  };
}

const cobranca = (marco: number) => ({ tipo: "atraso" as const, marco, horaEnvio: "09:00", somenteDiasUteis: true });
const lembrete = (marco: 0 | 1, hora: string) => ({ tipo: "vence_hoje" as const, marco, horaEnvio: hora, somenteDiasUteis: true });

// terça-feira, 10/11/2026, 10:00 em Brasília
const base: EntradaDaProxima = {
  parcelas: [],
  clientesDesligados: new Set(),
  etapasLigadas: [cobranca(1), cobranca(5), cobranca(15), cobranca(30)],
  travas: [],
  reguaAtivadaEm: "2026-10-01T00:00:00Z",
  intervaloDias: 3,
  hoje: "2026-11-10",
  agora: new Date("2026-11-10T13:00:00Z"),
  fuso: FUSO,
  ultimaCobrancaDia: null,
};

describe("proximaEtapaPrevista", () => {
  it("o primeiro marco ainda não travado da parcela vencida", () => {
    const p = parcela({ vencimento: "2026-11-06", vista_vencida_em: "2026-11-07T03:00:00Z" });
    const travas = [{ tipo: "atraso" as const, marco: 1, vencimento: "2026-11-06", resultado: "enviado", criadoEm: "2026-11-09T12:00:00Z" }];
    expect(proximaEtapaPrevista({ ...base, parcelas: [p], travas })).toEqual({ dia: "2026-11-11", hora: "09:00", tipo: "atraso", marco: 5 });
  });

  it("o marco dentro do intervalo mínimo é ABSORVIDO pela varredura: a próxima é o marco seguinte", () => {
    const p = parcela({ vencimento: "2026-11-06", vista_vencida_em: "2026-11-07T03:00:00Z" });
    const travas = [{ tipo: "atraso" as const, marco: 1, vencimento: "2026-11-06", resultado: "enviado", criadoEm: "2026-11-10T12:00:00Z" }];
    // o de 5 dias (11/11) cai dentro dos 3 dias; o de 15 (21/11, sábado) vai para segunda, 23/11
    expect(proximaEtapaPrevista({ ...base, parcelas: [p], travas, ultimaCobrancaDia: "2026-11-10" })).toEqual({ dia: "2026-11-23", hora: "09:00", tipo: "atraso", marco: 15 });
  });

  it("antes da ativação (D13), cliente fora da régua e etapa desligada: nada", () => {
    const antiga = parcela({ vencimento: "2026-09-06", vista_vencida_em: "2026-09-07T03:00:00Z" });
    expect(proximaEtapaPrevista({ ...base, parcelas: [antiga] })).toBeNull();
    const nova = parcela({ vencimento: "2026-11-09", vista_vencida_em: "2026-11-10T03:00:00Z" });
    expect(proximaEtapaPrevista({ ...base, parcelas: [nova], clientesDesligados: new Set(["cus_1"]) })).toBeNull();
    expect(proximaEtapaPrevista({ ...base, parcelas: [nova], etapasLigadas: [] })).toBeNull();
  });

  it("o lembrete da parcela a vencer: o do dia e, passada a janela, o da noite", () => {
    const aVencer = parcela({ status: "PENDING", vencimento: "2026-11-10" });
    const etapas = [lembrete(0, "09:00"), lembrete(1, "20:00")];
    expect(proximaEtapaPrevista({ ...base, etapasLigadas: etapas, parcelas: [aVencer] })).toEqual({ dia: "2026-11-10", hora: "09:00", tipo: "vence_hoje", marco: 0 });
    const travas = [{ tipo: "vence_hoje" as const, marco: 0, vencimento: "2026-11-10", resultado: "enviado", criadoEm: "2026-11-10T12:00:00Z" }];
    expect(proximaEtapaPrevista({ ...base, etapasLigadas: etapas, parcelas: [aVencer], travas })).toEqual({ dia: "2026-11-10", hora: "20:00", tipo: "vence_hoje", marco: 1 });
    // às 21:30 a janela da noite também fechou
    expect(proximaEtapaPrevista({ ...base, etapasLigadas: etapas, parcelas: [aVencer], travas, agora: new Date("2026-11-11T00:30:00Z") })).toBeNull();
  });

  it("na segunda, o lembrete da parcela de sábado ainda está por vir — a vencer OU já marcada vencida (Codex, PR #499)", () => {
    const segunda = { ...base, hoje: "2026-11-16", agora: new Date("2026-11-16T10:00:00Z") };
    const etapas = [lembrete(0, "09:00")];
    expect(proximaEtapaPrevista({ ...segunda, etapasLigadas: etapas, parcelas: [parcela({ status: "PENDING", vencimento: "2026-11-14" })] })).toEqual({ dia: "2026-11-16", hora: "09:00", tipo: "vence_hoje", marco: 0 });
    expect(proximaEtapaPrevista({ ...segunda, etapasLigadas: etapas, parcelas: [parcela({ status: "OVERDUE", vencimento: "2026-11-14" })] })?.tipo).toBe("vence_hoje");
    // a vencida de dia útil já passado não volta a ter lembrete
    expect(proximaEtapaPrevista({ ...segunda, etapasLigadas: etapas, parcelas: [parcela({ status: "OVERDUE", vencimento: "2026-11-13" })] })).toBeNull();
  });

  it("vencimento no sábado: o lembrete vai para a segunda", () => {
    const sabado = parcela({ status: "PENDING", vencimento: "2026-11-14" });
    expect(proximaEtapaPrevista({ ...base, etapasLigadas: [lembrete(0, "09:00")], parcelas: [sabado] })?.dia).toBe("2026-11-16");
  });
});
