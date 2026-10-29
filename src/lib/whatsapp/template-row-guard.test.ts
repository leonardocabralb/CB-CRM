import { describe, expect, it } from 'vitest';
import { assertMessageTemplate, isMessageTemplate } from './template-row-guard';

const MODELO = { id: 'tpl-1', name: 'boas_vindas', language: 'pt_BR', body_text: 'Olá' };

describe('isMessageTemplate', () => {
  // 1116: `message_templates.user_id` é autoria com ON DELETE SET NULL. O
  // modelo de quem teve o login apagado continua enviável — exigir o autor
  // recusava o disparo (tela, API v1, retomada) como "malformado".
  it('aceita o modelo sem autor', () => {
    expect(isMessageTemplate({ ...MODELO, user_id: null })).toBe(true);
    expect(assertMessageTemplate({ ...MODELO, user_id: null }, 'teste').id).toBe('tpl-1');
  });

  it('continua recusando o que o envio precisa e não veio', () => {
    expect(isMessageTemplate({ ...MODELO, body_text: null })).toBe(false);
    expect(() => assertMessageTemplate({ id: 'tpl-2' }, 'teste')).toThrow(/tpl-2/);
  });
});
