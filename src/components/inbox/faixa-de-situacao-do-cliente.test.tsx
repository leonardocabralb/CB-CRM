import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';
import type { SituacaoNoFunil } from '@/lib/pipelines/situacao-do-cliente';

import { FaixaDeSituacaoDoCliente } from './faixa-de-situacao-do-cliente';

// ============================================================
// A faixa "Cliente rescindido / finalizado" (1070): bem visível, só informa,
// e cala quando não sabe. Texto em `text-foreground` (legível nos dois
// modos, com o `dark:` inerte); a cor mora na borda, no ícone e na pastilha.
// ============================================================

function desenhar(situacoes: SituacaoNoFunil[] | null, messages: unknown = ptBR, locale = 'pt-BR') {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages as AbstractIntlMessages} timeZone="America/Sao_Paulo">
      <FaixaDeSituacaoDoCliente situacoes={situacoes} />
    </NextIntlClientProvider>,
  );
}

const RESCINDIDO: SituacaoNoFunil = { situacao: 'rescindido', funil: 'Bancário - Jurídico', etapa: 'Cliente Rescindido' };
const FINALIZADO: SituacaoNoFunil = { situacao: 'finalizado', funil: 'Trabalhista - Jurídico', etapa: 'Encerrado' };

describe('FaixaDeSituacaoDoCliente', () => {
  it('cala com null ("não sei") e com lista vazia — nunca afirma "ativo"', () => {
    expect(desenhar(null)).toBe('');
    expect(desenhar([])).toBe('');
  });

  it('rescindido: pastilha vermelha opaca, com o funil e a etapa', () => {
    const html = desenhar([RESCINDIDO]);
    expect(html).toMatch(/Cliente <span[^>]*bg-red-600[^>]*text-white[^>]*>Rescindido<\/span>/);
    expect(html).toContain('Contrato rescindido — Bancário - Jurídico, etapa “Cliente Rescindido”.');
    expect(html).toContain('role="status"');
    expect(html).toContain('data-situacao="rescindido"');
  });

  it('finalizado: azul, não vermelha (finalizado não é "mau")', () => {
    const html = desenhar([FINALIZADO]);
    expect(html).toMatch(/Cliente <span[^>]*bg-sky-700[^>]*text-white[^>]*>Finalizado<\/span>/);
    expect(html).toContain('Contrato finalizado — Trabalhista - Jurídico, etapa “Encerrado”.');
    expect(html).not.toContain('red-');
  });

  it('o texto nunca é colorido (contraste nos dois modos): a cor de texto só vai no ícone', () => {
    for (const html of [desenhar([RESCINDIDO]), desenhar([FINALIZADO])]) {
      expect(html).toMatch(/<svg[^>]*class="[^"]*text-(red|sky)-600/);
      expect(html).not.toMatch(/<(?!svg)[a-z]+[^>]*class="[^"]*text-(red|sky)-[0-9]{3}/);
    }
  });

  it('dois funis: a mais grave dá cor e título, e as duas aparecem', () => {
    const html = desenhar([RESCINDIDO, FINALIZADO]);
    expect(html).toContain('data-situacao="rescindido"');
    expect(html).toContain('Bancário - Jurídico');
    expect(html).toContain('Trabalhista - Jurídico');
  });

  it('não tem botão: só informa', () => {
    expect(desenhar([RESCINDIDO])).not.toContain('<button');
  });

  it('os dois dicionários têm as chaves (fallback do next-intl é por arquivo)', () => {
    expect(desenhar([RESCINDIDO], en, 'en')).toMatch(/Client <span[^>]*>Terminated<\/span>/);
    expect(desenhar([FINALIZADO], en, 'en')).toMatch(/Client <span[^>]*>Closed out<\/span>/);
  });
});
