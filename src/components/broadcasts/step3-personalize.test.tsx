import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import ptBR from '../../../messages/pt-BR.json';
import type { MessageTemplate } from '@/types';

// O passo só lê o banco num efeito (que não roda no desenho estático).
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));

import { Step3Personalize } from './step3-personalize';

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
