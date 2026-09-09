import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// D1 do plano do Instagram: automação, fluxo e IA NÃO respondem no Direct
// na v1. A garantia é ESTRUTURAL, no molde de `cb-groups/persist.ts`: o
// módulo simplesmente não importa os motores. Um teste de comportamento com
// mocks passaria depois de alguém acrescentar a chamada por engano; este
// quebra na hora. Sem comentários — o arquivo explica a regra citando os
// nomes, e checar prosa acusaria a própria documentação.
// ============================================================

const fonte = fs
  .readFileSync(path.join(__dirname, 'persistir.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('Instagram NÃO dispara automação, fluxo nem IA (D1)', () => {
  const MOTORES = [
    { modulo: '@/lib/automations/engine', o_que: 'automações' },
    { modulo: '@/lib/flows/engine', o_que: 'flows' },
    { modulo: '@/lib/ai/auto-reply', o_que: 'resposta automática de IA' },
  ];
  for (const { modulo, o_que } of MOTORES) {
    it(`não importa ${o_que} (${modulo})`, () => {
      expect(fonte).not.toContain(modulo);
    });
  }

  it('não chama nenhum dos despachantes, nem por outro caminho', () => {
    for (const chamada of [
      'runAutomationsForTrigger',
      'dispatchInboundToFlows',
      'dispatchInboundToAiReply',
    ]) {
      expect(fonte).not.toContain(chamada);
    }
  });
});

describe('Instagram FAZ o que gente decide', () => {
  it('roteia para o funil, reabre a conversa e segue o canal', () => {
    // Não são omissões da D1: card no primeiro contato e reabertura são
    // decisões de gente (o cliente escrevendo), como na Evolution.
    expect(fonte).toContain('routeContactToPipeline');
    expect(fonte).toContain('reopenClosedConversation');
    expect(fonte).toContain('followConversationChannel');
  });

  it('a ficha nasce pelo IGSID, nunca pelo telefone', () => {
    expect(fonte).not.toContain('findExistingContact');
    expect(fonte).toContain('instagram_id: igsid');
    expect(fonte).toContain('phone: null');
  });
});
