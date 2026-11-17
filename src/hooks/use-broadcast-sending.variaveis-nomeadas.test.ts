import { describe, expect, it } from 'vitest';

import { resolveVariables } from './use-broadcast-sending';
import { variaveisDoModelo } from '@/components/broadcasts/step3-personalize';
import { buildSendComponents } from '@/lib/whatsapp/template-send-builder';
import { extractTemplateVariables } from '@/lib/whatsapp/template-validators';
import type { Contact, MessageTemplate } from '@/types';

// ============================================================
// Disparo pela tela com modelo de variáveis NOMEADAS (D3 do porte do
// upstream, 17/11/2026). A lista de valores de cada destinatário é montada no
// navegador (`resolveVariables`) e casada com os nomes no servidor
// (`buildSendComponents`, pela ordem de `extractTemplateVariables`): as duas
// ordens têm de ser a MESMA, em qualquer idioma de navegador. E o assistente
// não zera `variables` ao trocar de modelo — a chave que sobrou sai no passo 3
// (`variaveisDoModelo`), senão deslocaria os valores.
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

const fixo = (value: string) => ({ type: 'static' as const, value });

describe('resolveVariables — modelo nomeado', () => {
  it('ordena os nomes como o servidor (código do caractere, não o idioma)', () => {
    // `localeCompare` poria `data_1` antes de `data1`; o servidor, depois.
    const nomeado = modelo('{{data_1}} {{data1}} {{b}} {{a_b}} {{ab}}');
    const variaveis = Object.fromEntries(
      extractTemplateVariables(nomeado.body_text).map((k) => [k, fixo(`valor de ${k}`)]),
    );
    const valores = resolveVariables(variaveis, contato);
    const [corpo] = buildSendComponents(nomeado, { body: valores });
    for (const p of (corpo as { parameters: { parameter_name: string; text: string }[] }).parameters) {
      expect(p.text).toBe(`valor de ${p.parameter_name}`);
    }
  });

  it('a chave de OUTRO modelo sai no passo 3 e não desloca nada', () => {
    const nomeado = modelo('Olá {{nome}}, sua reunião é {{data}}.');
    const doAssistente = {
      // Do modelo escolhido antes, e nunca apagadas pelo assistente:
      aaa_antiga: fixo('NÃO'),
      zzz_antiga: fixo('NÃO'),
      nome: { type: 'field' as const, value: 'name' },
      data: fixo('segunda'),
    };
    // Sem a poda, o valor de `aaa_antiga` iria como `data`:
    expect(resolveVariables(doAssistente, contato)[0]).toBe('NÃO');

    const valores = resolveVariables(variaveisDoModelo(doAssistente, nomeado.body_text), contato);
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

  it('o posicional fica como era (ordem numérica; a chave que sobra não é podada)', () => {
    const variaveis = { '10': fixo('dez'), '2': fixo('dois'), '1': fixo('um'), '11': fixo('sobra') };
    const posicional = modelo('{{1}} {{2}} … {{10}}');
    expect(variaveisDoModelo(variaveis, posicional.body_text)).toBe(variaveis);
    expect(resolveVariables(variaveis, contato)).toEqual(['um', 'dois', 'dez', 'sobra']);
  });

  it('posição e nome misturados (o modelo não os mistura): posições primeiro, ordem que fecha', () => {
    // Pelo código do caractere, "1a" < "2" — e "2" < "10" < "1a" pela régua
    // numérica: uma ordem que dá voltas, e o resultado dependeria da entrada.
    expect(resolveVariables({ '1a': fixo('nome'), '2': fixo('dois') }, contato)).toEqual(['dois', 'nome']);
    expect(
      resolveVariables({ '1a': fixo('nome'), '10': fixo('dez'), '2': fixo('dois') }, contato),
    ).toEqual(['dois', 'dez', 'nome']);
  });
});
