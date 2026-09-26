import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// QUEM pode chamar o caminho NORMAL de ingestão da Evolution.
//
// `persistInboundMessage` e `persistDeviceMessage` não são "gravar uma
// mensagem": são o pacote inteiro — robô, automações, IA, funil, reabertura,
// canal da conversa, atraso de entrega, cancelamento de esperas. Quem os chama
// dispara TUDO isso por indireção, sem que nenhuma das outras allowlists da
// casa perceba (elas vigiam os motores, e o chamador novo não cita motor
// nenhum: cita só estas duas funções).
//
// Default-deny: arquivo novo que as chame reprova aqui até entrar na lista,
// por decisão visível no diff. (Nasceu com a 1010: `sem-telefone/entregar.ts`
// virou o primeiro chamador fora da rota — achado da revisão por duas lentes.)
// ============================================================

const SRC = path.join(__dirname, '..', '..');

const PERMITIDOS: Record<string, string> = {
  'lib/whatsapp/inbound-store.ts': 'a definição',
  'app/api/whatsapp/evolution/webhook/route.ts': 'a rota do webhook — o chamador de sempre',
  'lib/whatsapp/sem-telefone/entregar.ts':
    'mensagem recuperada sem telefone, SÓ no modo `nova` (ainda é a última da conversa e acabou de chegar)',
};

function semComentarios(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
}

function arquivosDeProducao(dir: string, achados: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) arquivosDeProducao(p, achados);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.|\.test-helper\./.test(e.name)) achados.push(p);
  }
  return achados;
}

describe('caminho normal de ingestão: só quem está na lista o chama', () => {
  const citam = arquivosDeProducao(SRC)
    .filter((arquivo) => /\bpersist(Inbound|Device)Message\b/.test(semComentarios(fs.readFileSync(arquivo, 'utf8'))))
    .map((arquivo) => path.relative(SRC, arquivo).split(path.sep).join('/'))
    .sort();

  it('o conjunto de chamadores é EXATAMENTE o permitido', () => {
    expect(citam).toEqual(Object.keys(PERMITIDOS).sort());
  });

  it('a recuperada só chega ao caminho normal pelo modo `nova`', () => {
    const f = semComentarios(
      fs.readFileSync(path.join(SRC, 'lib/whatsapp/sem-telefone/entregar.ts'), 'utf8'),
    );
    // Tudo que não é `nova` sai ANTES das duas chamadas.
    const saida = f.indexOf("if (modo !== 'nova')");
    const chamada = f.search(/await persist(Device|Inbound)Message\(/);
    expect(saida).toBeGreaterThan(-1);
    expect(chamada).toBeGreaterThan(saida);
    const bloco = f.slice(saida, chamada);
    expect(bloco).toMatch(/return\s/);
  });
});

// ============================================================
// A PORTA do agente de IA (F2 do docs/PLANO-agentes-de-ia.md, 5.3): só as
// duas ingestões de mensagem DO CLIENTE no WhatsApp chamam
// `aoChegarMensagemDoCliente`. Grupo, Instagram, histórica e tardia têm pino
// próprio (não importam o motor); o celular pareado é conferido aqui, porque
// mora no MESMO arquivo que a ingestão do cliente — um import não o pegaria.
// A resposta automática antiga (`ai/auto-reply`) foi apagada (E2): esta é a
// única entrada.
// ============================================================
describe('a entrada do agente de IA: só as duas ingestões do cliente', () => {
  const PORTA = 'aoChegarMensagemDoCliente';
  const CHAMADORES_DA_PORTA = [
    'app/api/whatsapp/webhook/route.ts',
    'lib/whatsapp/inbound-store.ts',
  ];

  it('DEFAULT-DENY: o conjunto de chamadores é EXATAMENTE este', () => {
    const citam = arquivosDeProducao(SRC)
      .map((arquivo) => path.relative(SRC, arquivo).split(path.sep).join('/'))
      .filter((rel) => rel !== 'lib/ia-agentes/entrada.ts')
      .filter((rel) => semComentarios(fs.readFileSync(path.join(SRC, rel), 'utf8')).includes(PORTA))
      .sort();
    // Caminho novo que abra turno entra aqui por decisão visível no diff —
    // "a mensagem de QUEM o agente responde?" é decisão de produto.
    expect(citam).toEqual([...CHAMADORES_DA_PORTA].sort());
  });

  for (const arquivo of CHAMADORES_DA_PORTA) {
    it(`${arquivo}: DEPOIS das automações e do funil, ANTES do message.received`, () => {
      const f = semComentarios(fs.readFileSync(path.join(SRC, arquivo), 'utf8'));
      const porta = f.indexOf(`${PORTA}(`);
      expect(porta).toBeGreaterThan(-1);
      // E4: o agente precisa do resultado de TODAS as automações da mensagem.
      expect(porta).toBeGreaterThan(f.lastIndexOf('dispararAutomacoes('));
      expect(porta).toBeGreaterThan(f.lastIndexOf('routeContactToPipeline('));
      expect(porta).toBeLessThan(f.indexOf("'message.received'"));
      // O despacho antigo (`void`) não diria se alguma automação falou.
      expect(f).not.toContain('runAutomationsForTrigger(');
    });
  }

  it('⚠️ o celular pareado (`persistDeviceMessage`) NÃO abre turno', () => {
    // Mensagem da EQUIPE não é pergunta para o agente — ela o PAUSA (o
    // gatilho da 1049, no banco).
    const f = semComentarios(fs.readFileSync(path.join(SRC, 'lib/whatsapp/inbound-store.ts'), 'utf8'));
    const inicio = f.indexOf('export async function persistDeviceMessage');
    const fim = f.indexOf('export async function persistInboundMessage');
    expect(inicio).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(inicio);
    expect(f.slice(inicio, fim)).not.toContain(PORTA);
    expect(f.slice(fim)).toContain(`${PORTA}(`);
  });
});
