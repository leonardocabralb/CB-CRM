import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// ============================================================
// D16 (regra do operador, 12/09/2026): a mensagem da régua de cobrança NÃO
// reabre conversa encerrada, NÃO zera o contador de espera e NÃO conta
// como não lida. As três saem de graça do MESMO lugar — a régua manda pelo
// caminho do ROBÔ (`engineSendText`, via `dispararAutomacoes`), nunca por
// `sendMessageToConversation`, que é quem reabre (os quatro caminhos da
// 972/reopen) e grava com `sender_id`.
//
// "Reusar o núcleo de envio" parece limpeza de código e traz as três
// regressões de uma vez — e as duas primeiras são invisíveis na tela de quem
// manda: quem paga é o atendente, que perde o alerta de atraso, e o cliente,
// cuja conversa encerrada volta para a caixa. Por isso isto é DEFAULT-DENY
// sobre `src/lib/asaas/**`, com allowlist VAZIA (o molde é
// `pipeline-routing.chamadores.test.ts`).
// ============================================================

const RAIZ = path.join(__dirname);
const PROIBIDOS = ["sendMessageToConversation", "reopenConversation", "routeContactToPipeline"];

function* fontes(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* fontes(p);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/test-helper/.test(e.name)) yield p;
  }
}

describe("a régua do Asaas sai pelo caminho do robô (D16)", () => {
  it("nenhum arquivo de src/lib/asaas cita o núcleo de envio, o reabrir ou o roteador de funil", () => {
    const citam: string[] = [];
    for (const arquivo of fontes(RAIZ)) {
      const texto = fs.readFileSync(arquivo, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const nome of PROIBIDOS) if (texto.includes(nome)) citam.push(`${path.relative(RAIZ, arquivo)} → ${nome}`);
    }
    expect(citam).toEqual([]);
  });

  it("a varredura dispara pelo motor de automações — e é o único envio do módulo", () => {
    const varredura = fs.readFileSync(path.join(RAIZ, "varrer-regua.ts"), "utf8");
    expect(varredura).toContain("dispararAutomacoes");
    expect(varredura).not.toContain("engineSendText(");
    expect(varredura).not.toContain("from(\"messages\")");
  });

  // ⚠️ "A ficha tem telefone?" na varredura é o MESMO predicado do remetente
  // do robô: telefone que passa lá e é recusado aqui grava a trava do marco e
  // termina `falhou` sem nova chance (Codex, 4ª rodada do PR #206). Se o
  // remetente mudar de régua, este pino avisa que a varredura acompanha.
  // ⚠️ Lido SEM comentários, e casando a FORMA do uso: o docstring de
  // `lerClientesLigados` cita o predicado por extenso, e um `toContain` sobre
  // o fonte cru ficava verde com a régua própria de volta no código (revisão
  // da 4ª rodada do PR #206).
  // ⚠️ O remetente da régua é o das AUTOMAÇÕES (`sendViaMeta`, em
  // `automations/meta-send.ts`: a mensagem sai por `send_message`), e não o
  // dos fluxos — este pino lia o arquivo errado e só passava porque os dois
  // tinham o mesmo trecho (Fase 11.3). Desde a 11.3 o remetente decide o alvo
  // por `alvoDoRobo` → `alvoDeEnvio` → `resolveContactSendTarget`, e a cadeia
  // inteira é conferida aqui; a EQUIVALÊNCIA, amostra por amostra, está em
  // `src/lib/whatsapp/alvo-de-envio.test.ts`.
  it("a varredura confere o telefone com o predicado do remetente do robô", () => {
    const semComentarios = (arquivo: string) => fs.readFileSync(arquivo, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const varredura = semComentarios(path.join(RAIZ, "varrer-regua.ts"));
    const remetente = semComentarios(path.join(RAIZ, "..", "automations", "meta-send.ts"));
    const alvo = semComentarios(path.join(RAIZ, "..", "whatsapp", "alvo-de-envio.ts"));
    const identidade = semComentarios(path.join(RAIZ, "..", "whatsapp", "wa-identity.ts"));
    expect(varredura).toMatch(/!isValidE164\(sanitizePhoneForMeta\(telefone\)\)/);
    expect(varredura).not.toMatch(/telefone\.replace\(/);
    // O remetente da régua: alvo decidido pelo canal, e o ramo Evolution manda
    // esse alvo (telefone — o BSUID é recusado fora da Meta).
    expect(remetente).toMatch(/const \{ alvo, ehTelefone \} = alvoDoRobo\(contact, channel\)/);
    expect(remetente).toMatch(/transport\.sendText\(\{ to: alvo,/);
    // A cadeia até o predicado.
    expect(alvo).toMatch(/const alvo = resolveContactSendTarget\(contato\)/);
    expect(alvo).toMatch(/if \(alvo\.isPhone\) return \{ ok: true, alvo: alvo\.target, ehTelefone: true \}/);
    expect(identidade).toMatch(/const sanitized = sanitizePhoneForMeta\(contact\?\.phone \?\? ''\)/);
    expect(identidade).toMatch(/if \(isValidE164\(sanitized\)\) return \{ target: sanitized, isPhone: true \}/);
  });
});
