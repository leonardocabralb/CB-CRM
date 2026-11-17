import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import ptBR from '../../../messages/pt-BR.json';
import type { MessageTemplate } from '@/types';

// O passo só lê o banco num efeito (que não roda no desenho estático).
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));

import { Step3Personalize, variaveisDoModelo } from './step3-personalize';

// ============================================================
// Passo 3 do disparo com modelo de variáveis NOMEADAS (D3 do porte do
// upstream, 17/11/2026): lendo só `{{1}}`, o passo dizia que o modelo não
// tinha variável, e a campanha saía sem valores — a Meta recusava cada envio.
// ============================================================

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

function desenhar(template: MessageTemplate) {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="pt-BR"
      messages={ptBR as unknown as AbstractIntlMessages}
      timeZone="America/Sao_Paulo"
    >
      <Step3Personalize
        template={template}
        variables={{}}
        onUpdate={() => {}}
        headerMediaUrl=""
        onHeaderMediaUrlChange={() => {}}
        onNext={() => {}}
        onBack={() => {}}
      />
    </NextIntlClientProvider>,
  );
}

const ordemDasMarcas = (html: string) =>
  [...html.matchAll(/>(\{\{[A-Za-z0-9_]+\}\})</g)].map((m) => m[1]);

describe('Step3Personalize', () => {
  it('modelo nomeado: um cartão por NOME, na ordem do envio', () => {
    const html = desenhar(modelo('Olá {{nome}}, sua reunião é {{data}}.'));
    expect(ordemDasMarcas(html).slice(0, 2)).toEqual(['{{data}}', '{{nome}}']);
    expect(html).not.toContain(ptBR.Broadcasts.wizard.personalize.noPreview);
  });

  it('posicional: os mesmos cartões de antes', () => {
    const html = desenhar(modelo('Oi {{1}}, pedido {{2}}.'));
    expect(ordemDasMarcas(html).slice(0, 2)).toEqual(['{{1}}', '{{2}}']);
  });
});

describe('variaveisDoModelo — o que o "Avançar" deixa para o envio', () => {
  const fixo = (value: string) => ({ type: 'static' as const, value });

  it('nomeado: só as chaves DESTE modelo', () => {
    expect(
      variaveisDoModelo(
        { antiga: fixo('x'), '1': fixo('y'), nome: fixo('Ana') },
        'Olá {{nome}}',
      ),
    ).toEqual({ nome: fixo('Ana') });
  });

  it('nada a podar, ou posicional: o MESMO objeto (o assistente não regrava)', () => {
    const nomeado = { nome: fixo('Ana') };
    expect(variaveisDoModelo(nomeado, 'Olá {{nome}}')).toBe(nomeado);
    const posicional = { '1': fixo('a'), '7': fixo('sobra') };
    expect(variaveisDoModelo(posicional, 'Oi {{1}}')).toBe(posicional);
  });
});

describe('o "Avançar" do passo 3 poda antes de seguir', () => {
  // Sem a poda, a chave que sobrou de OUTRO modelo (o assistente não zera
  // `variables` ao trocar de modelo) deslocaria os valores no envio.
  it('chama `variaveisDoModelo`, grava o podado e só então segue', () => {
    const fonte = readFileSync(
      join(process.cwd(), 'src/components/broadcasts/step3-personalize.tsx'),
      'utf8',
    );
    const poda = fonte.indexOf(
      'const doModelo = variaveisDoModelo(variables, template.body_text);',
    );
    const grava = fonte.indexOf('if (doModelo !== variables) onUpdate(doModelo);', poda);
    const segue = fonte.indexOf('onNext();', grava);
    expect(poda).toBeGreaterThan(0);
    expect(grava).toBeGreaterThan(poda);
    expect(segue).toBeGreaterThan(grava);
  });
});
