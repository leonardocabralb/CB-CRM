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
    // O agente de IA (F2a, 1049) entra por aqui nas duas ingestões de cliente.
    'aoChegarMensagemDoCliente',
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
        // Ligar e atender pelo CRM (1134): a máquina e a faixa de registro.
        `${MODULO}/computador.ts`,
        `${MODULO}/desfecho.ts`,
        `${MODULO}/evento.ts`,
        // A operação do computador pela tela Conexões (4e, 1137).
        `${MODULO}/operacao.ts`,
        `${MODULO}/pelo-crm.ts`,
        `${MODULO}/previa.ts`,
        `${MODULO}/registrar.ts`,
        `${MODULO}/telefone.ts`,
        // A transcrição, o resumo e a poda das gravações (4d, 1136).
        `${MODULO}/dialogo.ts`,
        `${MODULO}/dialogos-gravados.ts`,
        `${MODULO}/poda.ts`,
        `${MODULO}/transcricao.ts`,
      ].sort(),
    );
  });

  // ⚠️ Exceção ESCRITA (4d, 1136): a transcrição usa o ENCANAMENTO dos
  // provedores — o endereço do Gemini (`ai/providers/`), o esquema da saída
  // JSON (`ai/structured`), os tipos e o registro de custo (`ai/usage`) —
  // para transcrever e resumir (D11, D14). Nunca o gerador de resposta
  // (`ai/generate`), o assistente nem o agente (`ia-agentes/`): a ligação
  // continua sem responder ninguém.
  const IMPORTA_MOTOR =
    /from '@\/lib\/(automations\/engine|flows\/|ai\/(?!providers\/|structured'|types'|usage')|ia-agentes\/|webhooks\/deliver)/;

  it('a exceção da transcrição não abre o gerador de resposta', () => {
    expect(`from '@/lib/ai/generate'`).toMatch(IMPORTA_MOTOR);
    expect(`from '@/lib/ai/auto-reply'`).toMatch(IMPORTA_MOTOR);
    expect(`from '@/lib/ia-agentes/turno'`).toMatch(IMPORTA_MOTOR);
    expect(`from '@/lib/ai/providers/gemini'`).not.toMatch(IMPORTA_MOTOR);
    expect(`from '@/lib/ai/usage'`).not.toMatch(IMPORTA_MOTOR);
  });

  for (const arquivo of ARQUIVOS) {
    it(`${arquivo} não cita motor, ingestão de mensagem nem envio`, () => {
      const f = fonte(arquivo);
      for (const nome of PROIBIDOS) expect(f).not.toContain(nome);
      expect(f).not.toMatch(IMPORTA_MOTOR);
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
  it('o Painel não conta a ligação como mensagem (a atendida é `agent`)', () => {
    const filtro = /\.neq\('content_type', 'call'\)/g;
    // Enviadas hoje e ontem e o feed de atividade. A série de conversas soma
    // no banco (1095) e filtra lá — pino em `painel-por-dia-1095.test.ts`.
    expect(fonte('lib/dashboard/queries.ts').match(filtro) ?? []).toHaveLength(3);
  });

  it('o Meu dia não conta mensagem nenhuma desde a v2 — quem voltar a contar repete o filtro', () => {
    // "O dia até agora" (mensagens enviadas hoje) saiu a pedido do operador
    // (29/09/2026). Se `messages` voltar a este hook, este teste acende para
    // lembrar do `.neq('content_type', 'call')`.
    expect(fonte('hooks/use-area-de-trabalho.ts')).not.toMatch(/from\('messages'\)/);
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
