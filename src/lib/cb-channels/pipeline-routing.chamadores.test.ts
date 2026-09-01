import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// QUEM abre negócio — a decisão de produto, travada estruturalmente.
//
// A regra é "entrou no funil quem CONVERSOU com o escritório, nos dois
// sentidos, desde que a decisão de falar tenha sido de GENTE". O que a
// sustenta não é uma guarda dentro do roteador: é onde o gancho foi
// pendurado. Compositor, ficha, agendada e API pública passam pelo núcleo
// `sendMessageToConversation`; broadcast e automação/fluxo têm caminho
// próprio e por isso ficam de fora sem custar uma linha.
//
// Isso é frágil da maneira que este teste conserta: basta alguém "unificar"
// o broadcast no núcleo de envio para que um disparo de 500 contatos abra
// 500 cards de uma vez — sem erro, sem revisão que acuse, e descoberto só
// quando o funil amanhecer inundado. Teste de comportamento com mock não
// pegaria; ler o fonte pega.
// ============================================================

const raiz = path.join(__dirname, '..', '..');

/** Fonte sem comentários — o arquivo EXPLICA as decisões citando os nomes,
 *  e checar prosa faria o teste acusar a própria documentação. */
function fonte(relativo: string): string {
  return fs
    .readFileSync(path.join(raiz, relativo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('abre negócio: os caminhos decididos por gente', () => {
  const DEVEM_ROTEAR = [
    { arquivo: 'lib/whatsapp/inbound-store.ts', quem: 'ingestão + celular pareado (Evolution)' },
    { arquivo: 'app/api/whatsapp/webhook/route.ts', quem: 'ingestão (Meta)' },
    { arquivo: 'lib/whatsapp/send-message.ts', quem: 'núcleo de envio (compositor, ficha, agendada, API v1)' },
  ];

  for (const { arquivo, quem } of DEVEM_ROTEAR) {
    it(`${quem} chama o roteador de funil`, () => {
      expect(fonte(arquivo)).toContain('routeContactToPipeline');
    });
  }

  // O bug de origem (2026-08-31): `persistDeviceMessage` existia justamente
  // para NÃO disparar motor nenhum, e o roteador de funil foi junto no
  // pacote. Como o escritório trabalha pelo celular — 1.041 mensagens contra
  // 8 pelo CRM —, o caminho dominante nunca abriu negócio. Afirmar sobre o
  // ARQUIVO não pegaria isso: a outra função do mesmo arquivo já roteava.
  it('a função do celular pareado roteia — não só a da ingestão', () => {
    const src = fonte('lib/whatsapp/inbound-store.ts');
    const inicio = src.indexOf('export async function persistDeviceMessage');
    const fim = src.indexOf('export async function persistInboundMessage');
    expect(inicio).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(inicio);

    const corpoDoCelular = src.slice(inicio, fim);
    expect(corpoDoCelular).toContain('routeContactToPipeline');
    // E aponta a conversa para o número por onde a equipe falou — sem isto a
    // conversa nasce sem canal e o CRM responde pelo canal PADRÃO, trocando
    // a identidade do escritório no meio do atendimento.
    expect(corpoDoCelular).toContain('followConversationChannel');
  });
});

describe('NÃO abre negócio: disparo em massa e resposta de robô', () => {
  // Não são omissões: são a decisão. Um broadcast não é o escritório
  // decidindo abordar 500 pessoas uma a uma, e um fluxo respondendo não é
  // ninguém decidindo nada.
  //
  // ⚠️ Há DOIS `meta-send.ts` no repo, e o achado #14 do plano de 31/08 é
  // exatamente esta lista ter vigiado o de `lib/automations/` — o WRAPPER —
  // enquanto fluxo, resposta de IA e mídia de automação saem por
  // `lib/flows/meta-send.ts`, que ficou descoberto: trocar `engineSendText`
  // por `sendMessageToConversation` lá abria card para toda resposta de robô
  // com a suíte verde.
  const NAO_PODEM_ROTEAR = [
    { arquivo: 'lib/whatsapp/broadcast-core.ts', quem: 'broadcast' },
    { arquivo: 'lib/whatsapp/broadcast-resume.ts', quem: 'retomada de broadcast' },
    { arquivo: 'lib/flows/meta-send.ts', quem: 'fluxo/IA/automação (o sender REAL)' },
    { arquivo: 'lib/automations/meta-send.ts', quem: 'automação (wrapper que delega ao de cima)' },
    { arquivo: 'lib/cb-channels/engine-send.ts', quem: 'resolução de canal do motor' },
  ];

  for (const { arquivo, quem } of NAO_PODEM_ROTEAR) {
    it(`${quem} não chama o roteador de funil`, () => {
      expect(fonte(arquivo)).not.toContain('routeContactToPipeline');
    });

    // A porta dos fundos, e a que de fato corre risco: ninguém vai
    // acrescentar o roteador ao broadcast de propósito — mas "reusar o núcleo
    // de envio" parece limpeza de código, e traz o roteador junto, escondido.
    it(`${quem} não passa pelo núcleo de envio (que roteia)`, () => {
      expect(fonte(arquivo)).not.toContain('sendMessageToConversation');
    });
  }
});

// ============================================================
// A varredura DEFAULT-DENY (a correção estrutural do #14).
//
// Lista de negados envelhece a cada sender novo — foi assim que o
// `lib/flows/meta-send.ts` ficou de fora. A varredura inverte o ônus: anda
// `src/` inteiro e afirma que o conjunto de arquivos que CITAM o roteador ou
// o núcleo de envio é EXATAMENTE a allowlist. Um caminho novo (ou um "reuso"
// que traga o núcleo para um caminho de máquina) reprova POR PADRÃO, e
// entrar na allowlist é uma decisão de produto visível no diff DESTE
// arquivo. A igualdade é nos dois sentidos: sumir um chamador esperado (ex.:
// desligar o roteador da ingestão) também reprova.
// ============================================================

function todosOsFontes(dir: string, acc: string[] = []): string[] {
  for (const nome of fs.readdirSync(dir)) {
    const p = path.join(dir, nome);
    if (fs.statSync(p).isDirectory()) todosOsFontes(p, acc);
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\./.test(nome)) acc.push(p);
  }
  return acc;
}

describe('varredura default-deny: quem cita o roteador e o núcleo', () => {
  const PODEM_CITAR: Record<string, string[]> = {
    routeContactToPipeline: [
      'lib/cb-channels/pipeline-routing.ts', // a definição
      'lib/whatsapp/inbound-store.ts', // ingestão + celular pareado (Evolution)
      'app/api/whatsapp/webhook/route.ts', // ingestão (Meta)
      'lib/whatsapp/send-message.ts', // núcleo de envio
    ],
    sendMessageToConversation: [
      'lib/whatsapp/send-message.ts', // a definição
      'app/api/whatsapp/send/route.ts', // compositor + primeiro contato pela ficha
      'lib/scheduled/dispatch.ts', // agendada
      'app/api/v1/messages/route.ts', // API pública (decisão fixada — ver R3 do plano)
    ],
  };

  for (const [simbolo, allowlist] of Object.entries(PODEM_CITAR)) {
    it(`só a allowlist cita ${simbolo}`, () => {
      const citam = todosOsFontes(raiz)
        .map((p) => path.relative(raiz, p).split(path.sep).join('/'))
        .filter((rel) => fonte(rel).includes(simbolo))
        .sort();
      expect(citam).toEqual([...allowlist].sort());
    });
  }
});
