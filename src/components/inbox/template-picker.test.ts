import { describe, expect, it } from 'vitest';

import { collectVariableSlots, renderBodyPreview } from './template-picker';
import { buildSendComponents } from '@/lib/whatsapp/template-send-builder';
import type { MessageTemplate } from '@/types';

// ============================================================
// O seletor de modelos da caixa de entrada com variáveis NOMEADAS (D3 do
// porte do upstream, 17/11/2026). O editor da Meta cria `{{nome_do_cliente}}`
// por padrão; lendo só `{{1}}`, o seletor achava que o modelo não tinha
// variável, mandava SEM valores e a Meta recusava (#132000).
// ============================================================

const modelo = (extra: Partial<MessageTemplate>): MessageTemplate =>
  ({
    id: 't1',
    user_id: 'u1',
    name: 'aviso',
    category: 'Utility',
    language: 'pt_BR',
    body_text: 'Sem variável',
    created_at: '2026-11-17T00:00:00Z',
    ...extra,
  }) as MessageTemplate;

describe('collectVariableSlots', () => {
  it('modelo nomeado pede um valor por NOME, na ordem do envio', () => {
    const slots = collectVariableSlots(
      modelo({
        body_text: 'Olá {{nome}}, reunião {{data}} com {{nome}}',
        header_type: 'text',
        header_content: 'Oi {{primeiro_nome}}',
      }),
    );
    expect(slots.bodyVars).toEqual(['data', 'nome']);
    expect(slots.headerVar).toBe('primeiro_nome');
    // Os valores na ordem dos campos chegam ao construtor com o nome certo.
    expect(
      buildSendComponents(
        modelo({ body_text: 'Olá {{nome}}, reunião {{data}}' }),
        { body: ['segunda', 'Ana'] },
      )[0],
    ).toEqual({
      type: 'body',
      parameters: [
        { type: 'text', parameter_name: 'data', text: 'segunda' },
        { type: 'text', parameter_name: 'nome', text: 'Ana' },
      ],
    });
  });

  it('posicional: os mesmos campos de antes', () => {
    const slots = collectVariableSlots(
      modelo({
        body_text: 'Oi {{1}}, pedido {{2}}',
        header_type: 'text',
        header_content: 'Pedido {{1}}',
        buttons: [{ type: 'URL', text: 'Ver', url: 'https://x.test/{{1}}', example: 'a' }],
      }),
    );
    expect(slots).toEqual({
      bodyVars: ['1', '2'],
      headerVar: '1',
      urlButtonSlots: [{ index: 0, text: 'Ver', url: 'https://x.test/{{1}}' }],
    });
    expect(collectVariableSlots(modelo({}))).toEqual({
      bodyVars: [],
      headerVar: null,
      urlButtonSlots: [],
    });
  });
});

describe('renderBodyPreview', () => {
  it('nomeado: troca pelo valor da chave; vazio mostra a marca', () => {
    expect(renderBodyPreview('Olá {{nome}}, até {{data}}', ['segunda', ' '])).toBe(
      'Olá {{nome}}, até segunda',
    );
  });

  it('posicional: como antes', () => {
    expect(renderBodyPreview('Oi {{1}}, pedido {{2}}', ['Ana'])).toBe('Oi Ana, pedido {{2}}');
  });
});
