import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';
import type { SituacaoNoFunil } from '@/lib/pipelines/situacao-do-cliente';

import { FaixaDeSituacaoDoCliente } from './faixa-de-situacao-do-cliente';

// ============================================================
// A faixa "Cliente rescindido / finalizado" (1070): bem visível, só informa,
// e cala quando não sabe.
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

  it('rescindido: vermelha, com o título, o funil e a etapa', () => {
    const html = desenhar([RESCINDIDO]);
    expect(html).toContain('Cliente RESCINDIDO');
    expect(html).toContain('Contrato rescindido — Bancário - Jurídico, etapa “Cliente Rescindido”.');
    expect(html).toContain('text-red-700');
    expect(html).toContain('role="status"');
  });

  it('finalizado: azul, não vermelha (finalizado não é "mau")', () => {
    const html = desenhar([FINALIZADO]);
    expect(html).toContain('Cliente FINALIZADO');
    expect(html).toContain('Contrato finalizado — Trabalhista - Jurídico, etapa “Encerrado”.');
    expect(html).toContain('text-sky-600');
    expect(html).not.toContain('text-red-700');
  });

  it('dois funis: a mais grave dá cor e título, e as duas aparecem', () => {
    const html = desenhar([RESCINDIDO, FINALIZADO]);
    expect(html).toContain('Cliente RESCINDIDO');
    expect(html).toContain('Bancário - Jurídico');
    expect(html).toContain('Trabalhista - Jurídico');
    expect(html).toContain('text-red-700');
  });

  it('não tem botão: só informa', () => {
    expect(desenhar([RESCINDIDO])).not.toContain('<button');
  });

  it('os dois dicionários têm as chaves (fallback do next-intl é por arquivo)', () => {
    expect(desenhar([RESCINDIDO], en, 'en')).toContain('Client TERMINATED');
    expect(desenhar([FINALIZADO], en, 'en')).toContain('Client CLOSED OUT');
  });
});
