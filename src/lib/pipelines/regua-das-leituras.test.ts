import { describe, expect, it } from "vitest";

import { criarReguaDasLeituras } from "./regua-das-leituras";

// ============================================================
// O painel da conversa relê os negócios quando o card muda por outro caminho
// (o agente de IA, uma automação, um colega no quadro). As leituras ficam
// concorrentes, e as escritas do próprio painel entram na mesma fila.
// ============================================================

describe("criarReguaDasLeituras — leitura contra leitura", () => {
  it("em ordem, as duas gravam", () => {
    const r = criarReguaDasLeituras();
    const a = r.pedir();
    expect(r.podeGravar(a)).toBe(true);
    const b = r.pedir();
    expect(r.podeGravar(b)).toBe(true);
  });

  it("CRÍTICO: a carga do contato que volta DEPOIS da releitura do evento não grava a foto velha", () => {
    const r = criarReguaDasLeituras();
    const carga = r.pedir(); // abriu a conversa
    const releitura = r.pedir(); // o agente moveu o card no meio da carga
    expect(r.podeGravar(releitura)).toBe(true);
    expect(r.podeGravar(carga)).toBe(false);
  });

  it("a leitura que FALHA não cala a mais velha que deu certo (a régua é a última que gravou)", () => {
    const r = criarReguaDasLeituras();
    const velha = r.pedir();
    r.pedir(); // falhou: ninguém chama podeGravar
    expect(r.podeGravar(velha)).toBe(true);
  });

  it("a mesma leitura não grava duas vezes", () => {
    const r = criarReguaDasLeituras();
    const a = r.pedir();
    expect(r.podeGravar(a)).toBe(true);
    expect(r.podeGravar(a)).toBe(false);
  });
});

describe("criarReguaDasLeituras — a escrita do painel", () => {
  it("CRÍTICO: leitura pedida antes da escrita não desfaz na tela o que foi salvo", () => {
    const r = criarReguaDasLeituras();
    const antes = r.pedir(); // chegou evento: relendo…
    r.escreveu(); // …e o operador salvou o valor nesse meio-tempo
    expect(r.podeGravar(antes)).toBe(false);
  });

  it("com leitura no ar, avisa para reler (o motivo dela — outro caminho mexeu — não pode se perder)", () => {
    const r = criarReguaDasLeituras();
    r.pedir();
    expect(r.escreveu()).toBe(true);
  });

  it("sem leitura no ar, não pede releitura", () => {
    const r = criarReguaDasLeituras();
    const a = r.pedir();
    r.podeGravar(a);
    expect(r.escreveu()).toBe(false);
    expect(r.escreveu()).toBe(false);
  });

  it("a releitura pedida DEPOIS da escrita grava", () => {
    const r = criarReguaDasLeituras();
    r.pedir();
    r.escreveu();
    const depois = r.pedir();
    expect(r.podeGravar(depois)).toBe(true);
  });

  it("uma leitura que falhou pede no máximo UMA releitura a mais, nunca um laço", () => {
    const r = criarReguaDasLeituras();
    r.pedir(); // falhou
    expect(r.escreveu()).toBe(true);
    expect(r.escreveu()).toBe(false);
  });
});
