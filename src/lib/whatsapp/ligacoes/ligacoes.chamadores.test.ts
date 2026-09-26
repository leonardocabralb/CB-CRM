import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { WEBHOOK_EVENTS } from '@/lib/whatsapp/transport/evolution-provision';

// ============================================================
// Pinos ESTRUTURAIS da ligação de WhatsApp (1044). O teste de comportamento
// (`registrar.test.ts`) mocka as peças; estes leem o FONTE, porque "esqueci
// de chamar" e "alguém acrescentou um motor" só se pegam lendo o arquivo — o
// mesmo desenho de `historica.chamadores.test.ts` e `cb-groups/persist.ts`.
// ============================================================

const src = path.resolve(__dirname, '../../..');

/** Fonte sem comentários: os arquivos citam os nomes ao EXPLICAR a decisão. */
function fonte(relativo: string): string {
  return fs
    .readFileSync(path.join(src, relativo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/ .*$/gm, '');
}

const MODULO = 'lib/whatsapp/ligacoes';
const ARQUIVOS = fs
  .readdirSync(path.join(src, MODULO))
  .filter((n) => /\.ts$/.test(n) && !/\.test\./.test(n))
  .map((n) => `${MODULO}/${n}`);

describe('a ligação NÃO aciona motor nenhum', () => {
  // A ligação não tem texto a responder. Um robô que respondesse a uma
  // chamada, uma automação de "mensagem recebida" disparada por ela, a IA
  // gerando resposta para nada, ou o webhook `message.received` saindo com
  // texto nulo para o n8n — cada um é um defeito, e só a leitura do fonte
  // garante que nenhum entra por "reuso".
  const PROIBIDOS = [
    'runAutomationsForTrigger',
    'dispararAutomacoes',
    'dispatchInboundToFlows',
    'dispatchInboundToAiReply',
    'dispatchWebhookEvent',
    'registrarEntrega',
    'persistInboundMessage',
    'persistDeviceMessage',
    'sendMessageToConversation',
    'engineSendText',
    // Decisão do operador (26/09/2026): ligação não para a sequência "parar se
    // o cliente responder" — só mensagem escrita é resposta.
    'cancelarEsperasPorResposta',
  ];

  it('o módulo tem os arquivos esperados', () => {
    expect(ARQUIVOS.sort()).toEqual(
      [
        `${MODULO}/desfecho.ts`,
        `${MODULO}/evento.ts`,
        `${MODULO}/previa.ts`,
        `${MODULO}/registrar.ts`,
        `${MODULO}/telefone.ts`,
      ].sort(),
    );
  });

  for (const arquivo of ARQUIVOS) {
    it(`${arquivo} não cita motor, ingestão de mensagem nem envio`, () => {
      const f = fonte(arquivo);
      for (const nome of PROIBIDOS) expect(f).not.toContain(nome);
      expect(f).not.toMatch(/from '@\/lib\/(automations\/engine|flows\/|ai\/|webhooks\/deliver)/);
    });
  }
});

describe('a ligação faz o que o cliente (ou a equipe pelo celular) faria', () => {
  const f = fonte(`${MODULO}/registrar.ts`);

  it('ficha e conversa pelo helper do dono durável; bolha pelo gravarComCanal', () => {
    expect(f).toContain('resolverDestinatario(');
    expect(f).toContain('gravarComCanal(');
  });

  it('reabre LOGO DEPOIS de gravar a bolha, antes da prévia (ver reopen.ts)', () => {
    const insert = f.indexOf(".from('messages')");
    const reabre = f.indexOf('reopenClosedConversation(');
    const previa = f.indexOf('bump_conversation_on_inbound');
    expect(insert).toBeGreaterThan(-1);
    expect(reabre).toBeGreaterThan(insert);
    expect(previa).toBeGreaterThan(reabre);
  });

  it('segue o canal e abre o card (e NÃO cancela as esperas: ligação não é resposta)', () => {
    expect(f).toContain('followConversationChannel(');
    expect(f).toContain('routeContactToPipeline(');
    // A retomada também ignora a ligação — senão a perdida, linha do cliente,
    // pararia a sequência quando a espera acordasse.
    expect(fonte('lib/automations/parar-se-responder.ts')).toMatch(
      /\.is\('deleted_at', null\)\s*\.neq\('content_type', 'call'\)\s*\.gt\('gravada_em', desde\)/,
    );
  });

  it('⚠️ o LID nunca vira telefone: só o JID de telefone, o acervo ou o callerPn conferido', () => {
    expect(f).toContain('consultarTelefoneDoLid(');
    expect(f).toContain('telefoneDoCallerPn(');
    expect(f).not.toMatch(/quem_ligou[^;\n]*\.split\('@'\)/);
  });
});

describe('o webhook da Evolution entrega a ligação', () => {
  it('a lista de eventos assinados tem CALL', () => {
    expect(WEBHOOK_EVENTS).toContain('CALL');
  });

  it('a rota registra o aviso DENTRO do after() (a Evolution recebe 200 na hora)', () => {
    const rota = fonte('app/api/whatsapp/evolution/webhook/route.ts');
    expect(rota).toMatch(/event === 'call'[\s\S]{0,400}after\(\(\) =>\s*registrarEventoDeLigacao\(/);
  });
});

describe('na tela, a ligação é faixa — sem ações', () => {
  it('o fio a desenha fora do MessageActions (nada de responder, reagir ou apagar)', () => {
    expect(fonte('components/inbox/message-thread.tsx')).toContain(
      'msg.content_type === "system" || msg.content_type === "call"',
    );
  });

  it('a bolha desvia para o AvisoDeLigacao', () => {
    expect(fonte('components/inbox/message-bubble.tsx')).toMatch(
      /content_type === "call"\)\s*\{\s*return <AvisoDeLigacao/,
    );
  });

  it('a lista e o card do funil traduzem o marcador da prévia', () => {
    for (const arquivo of ['components/inbox/conversation-list.tsx', 'components/pipelines/deal-card.tsx']) {
      expect(fonte(arquivo)).toContain('ehPreviaDeLigacao(');
    }
  });
});

describe('quem lê content_type trata a ligação', () => {
  it('Painel e Meu dia não contam a ligação como mensagem (a atendida é `agent`)', () => {
    const filtro = /\.neq\('content_type', 'call'\)/g;
    // Enviadas hoje e ontem, a série de conversas e o feed de atividade.
    expect(fonte('lib/dashboard/queries.ts').match(filtro) ?? []).toHaveLength(4);
    expect(fonte('hooks/use-area-de-trabalho.ts').match(filtro) ?? []).toHaveLength(1);
  });

  it('o Radar lê a ligação como linha do transcrito (senão ela viraria "mídia sem texto")', () => {
    expect(fonte('lib/cb-radar/worker.ts')).toMatch(/content_type === 'call'/);
  });

  it('o núcleo de envio recusa citar uma ligação (o `call:<id>` não existe no WhatsApp)', () => {
    const envio = fonte('lib/whatsapp/send-message.ts');
    expect(envio).toMatch(/\.select\('message_id, conversation_id, remote_jid, from_me, content_type'\)/);
    expect(envio).toMatch(/parent\.content_type === 'call'\)\s*\{\s*throw new SendMessageError\(/);
  });

  it('o aviso do navegador da perdida tem corpo (a bolha não tem texto)', () => {
    expect(fonte('lib/notifications/browser-notify.ts')).toMatch(/case "call":\s*body = labels\.call;/);
    expect(fonte('hooks/use-browser-notifications.ts')).toContain('call: t("call")');
  });
});
