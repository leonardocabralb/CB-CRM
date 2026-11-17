import { describe, expect, it } from 'vitest';

import { resolveVariables } from './use-broadcast-sending';
import { buildSendComponents } from '@/lib/whatsapp/template-send-builder';
import { extractTemplateVariables } from '@/lib/whatsapp/template-validators';
import type { Contact, MessageTemplate } from '@/types';

// ============================================================
// Disparo pela tela com modelo de variáveis NOMEADAS (D3 do porte do
// upstream, 17/11/2026). A lista de valores de cada destinatário é montada no
// navegador e casada com os nomes no servidor (`buildSendComponents`): a ordem
// tem de ser a das chaves do MODELO. O assistente não zera `variables` ao
// trocar de modelo — uma chave que sobrou do anterior não pode deslocar os
// valores (o cliente receberia o de outra variável).
// ============================================================

const contato = {
  id: 'c1',
  user_id: 'u1',
  account_id: 'a1',
  name: 'Maria',
  phone: '+5583999990000',
  email: 'maria@exemplo.test',
  created_at: '2026-11-17T00:00:00Z',
  updated_at: '2026-11-17T00:00:00Z',
} as Contact;

const modelo = (body_text: string) =>
  ({
    id: 't1',
    user_id: 'u1',
    name: 'aviso',
    category: 'Utility',
    language: 'pt_BR',
    body_text,
    created_at: '2026-11-17T00:00:00Z',
  }) as MessageTemplate;

describe('resolveVariables — modelo nomeado', () => {
  const nomeado = modelo('Olá {{nome}}, sua reunião é {{data}}.');

  it('segue a ordem das chaves do modelo; a chave que sobrou não desloca nada', () => {
    const valores = resolveVariables(
      {
        // Do modelo escolhido antes, e nunca apagadas pelo assistente:
        aaa_antiga: { type: 'static', value: 'NÃO' },
        zzz_antiga: { type: 'static', value: 'NÃO' },
        nome: { type: 'field', value: 'name' },
        data: { type: 'static', value: 'segunda' },
      },
      contato,
      undefined,
      extractTemplateVariables(nomeado.body_text),
    );
    expect(valores).toEqual(['segunda', 'Maria']);
    expect(buildSendComponents(nomeado, { body: valores })).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', parameter_name: 'data', text: 'segunda' },
          { type: 'text', parameter_name: 'nome', text: 'Maria' },
        ],
      },
    ]);
  });

  it('o posicional fica como era (ordem numérica das chaves de `variables`)', () => {
    const variaveis = {
      '10': { type: 'static' as const, value: 'dez' },
      '2': { type: 'static' as const, value: 'dois' },
      '1': { type: 'static' as const, value: 'um' },
    };
    const posicional = modelo('{{1}} {{2}} … {{10}}');
    expect(
      resolveVariables(variaveis, contato, undefined, extractTemplateVariables(posicional.body_text)),
    ).toEqual(['um', 'dois', 'dez']);
    expect(resolveVariables(variaveis, contato)).toEqual(['um', 'dois', 'dez']);
  });
});
