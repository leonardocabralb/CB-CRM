import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mencionaNos } from './persist';

describe('grupo NÃO dispara automação, flow nem IA', () => {
  // Este é o teste mais importante do recurso. A regra de produto é "grupo não
  // aciona nenhum motor", e a garantia escolhida foi estrutural: o arquivo
  // simplesmente NÃO IMPORTA os motores. Um teste de comportamento com mocks
  // passaria mesmo depois de alguém acrescentar a chamada por engano; este
  // quebra na hora.
  // Sem os comentários. O arquivo EXPLICA por que não chama cada motor, e
  // citar o nome na explicação faria o teste acusar a própria documentação.
  // Checar código, não prosa.
  const fonte = fs
    .readFileSync(path.join(__dirname, 'persist.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

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

  it('não faz a conversa "seguir o cliente"', () => {
    // Esse helper move o canal da conversa para o da última mensagem
    // recebida. Num grupo isso trocaria a identidade de resposta toda vez
    // que um participante diferente escrevesse.
    expect(fonte).not.toContain('followConversationChannel');
  });
});

describe('mencionaNos', () => {
  it('acende quando o nosso lid está na lista', () => {
    expect(mencionaNos(['111@lid', '222@lid'], '222@lid')).toBe(true);
  });

  it('não acende para menção a outra pessoa', () => {
    expect(mencionaNos(['111@lid'], '222@lid')).toBe(false);
  });

  it('sem nosso lid conhecido responde false, não chuta', () => {
    // Degradação honesta: enquanto `cb_channels.own_lid` for NULL o destaque
    // não acende. Passa a funcionar sozinho depois da 1a mensagem nossa no
    // grupo, ou da sincronização — ver 916_cb_lid_do_canal.
    expect(mencionaNos(['111@lid'], null)).toBe(false);
  });

  it('lista vazia não acende', () => {
    expect(mencionaNos([], '222@lid')).toBe(false);
  });
});
