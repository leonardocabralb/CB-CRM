import { describe, expect, it } from 'vitest';
import type { Automation } from '@/types';

import { channelInScope } from './engine';
import { validateChannelScopeForActivation } from './validate';

const auto = (channel_ids: string[] | null | undefined): Automation =>
  ({ id: 'a1', channel_ids }) as unknown as Automation;

describe('channelInScope', () => {
  it('sem escopo dispara em qualquer canal (comportamento pré-multi-canal)', () => {
    expect(channelInScope(auto(null), { channel_id: 'ch-1' })).toBe(true);
    expect(channelInScope(auto(undefined), { channel_id: 'ch-1' })).toBe(true);
  });

  it('CRÍTICO: automação restrita NÃO dispara em canal fora do escopo', () => {
    // O bug original: a triagem do número Comercial respondia também quem
    // escrevesse no WhatsApp pessoal do sócio, pelo próprio número dele.
    expect(channelInScope(auto(['ch-comercial']), { channel_id: 'ch-pessoal' })).toBe(
      false,
    );
  });

  it('dispara no canal listado', () => {
    expect(
      channelInScope(auto(['ch-comercial', 'ch-juridico']), {
        channel_id: 'ch-juridico',
      }),
    ).toBe(true);
  });

  it('array vazio é tratado como "todos" — estado inválido não silencia a automação', () => {
    // A 903 impede que exista (normaliza para NULL e desativa), mas se
    // chegasse aqui, calar a automação seria pior que o excesso.
    expect(channelInScope(auto([]), { channel_id: 'ch-1' })).toBe(true);
  });

  it('disparo SEM canal passa em qualquer escopo', () => {
    // tag_added, conversation_assigned e gatilhos por tempo não têm canal.
    // Barrá-los faria a automação restrita parar de funcionar neles.
    expect(channelInScope(auto(['ch-1']), { channel_id: null })).toBe(true);
    expect(channelInScope(auto(['ch-1']), {})).toBe(true);
    expect(channelInScope(auto(['ch-1']), undefined)).toBe(true);
  });
});

describe('validateChannelScopeForActivation', () => {
  const CANAIS = [
    { id: 'ch-meta', label: 'Comercial', kind: 'meta' as const },
    { id: 'ch-evo', label: 'Dr. Leonardo', kind: 'evolution' as const },
  ];
  const passoBotoes = [{ step_type: 'send_buttons', step_config: {} }];

  it('recusa passo exclusivo da Meta num escopo só de Evolution', () => {
    // Antes: ativava sem aviso e funcionava para METADE dos clientes, com
    // logs alternando failed/success sem explicar a causa.
    const issues = validateChannelScopeForActivation(
      passoBotoes,
      ['ch-evo'],
      CANAIS,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('Dr. Leonardo');
  });

  it('aceita quando o escopo inclui ao menos um canal Meta', () => {
    expect(
      validateChannelScopeForActivation(passoBotoes, ['ch-evo', 'ch-meta'], CANAIS),
    ).toHaveLength(0);
  });

  it('sem escopo não bloqueia — senão toda automação existente pararia', () => {
    expect(validateChannelScopeForActivation(passoBotoes, null, CANAIS)).toHaveLength(0);
    expect(validateChannelScopeForActivation(passoBotoes, [], CANAIS)).toHaveLength(0);
  });

  it('ids órfãos (canal apagado entre editar e salvar) não travam a ativação', () => {
    expect(
      validateChannelScopeForActivation(passoBotoes, ['ch-que-sumiu'], CANAIS),
    ).toHaveLength(0);
  });

  it('passo de texto puro passa em escopo Evolution', () => {
    expect(
      validateChannelScopeForActivation(
        [{ step_type: 'send_message', step_config: { text: 'oi' } }],
        ['ch-evo'],
        CANAIS,
      ),
    ).toHaveLength(0);
  });

  it('desce nos ramos da condição', () => {
    const issues = validateChannelScopeForActivation(
      [
        {
          step_type: 'condition',
          step_config: {},
          branches: { yes: passoBotoes, no: [] },
        },
      ],
      ['ch-evo'],
      CANAIS,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toContain('yes');
  });
});
