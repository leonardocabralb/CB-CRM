import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';
import type { SituacaoNaFaixa } from '@/lib/atlas/situacao-na-faixa';

import { FaixaDeSituacaoDoCliente } from './faixa-de-situacao-do-cliente';

// ============================================================
// A faixa "Cliente rescindido / finalizado / suspenso / inativo" (1070 +
// Fase 2 do Atlas): bem visível, só informa, cala quando não sabe, e cada
// linha diz a FONTE (o funil ou o Atlas). Texto em `text-foreground`
// (legível nos dois modos, com o `dark:` inerte); a cor mora na borda, no
// ícone e na pastilha.
// ============================================================

function desenhar(situacoes: SituacaoNaFaixa[] | null, messages: unknown = ptBR, locale = 'pt-BR') {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages as AbstractIntlMessages} timeZone="America/Sao_Paulo">
      <FaixaDeSituacaoDoCliente situacoes={situacoes} />
    </NextIntlClientProvider>,
  );
}

const RESCINDIDO: SituacaoNaFaixa = { fonte: 'funil', situacao: 'rescindido', funil: 'Bancário - Jurídico', etapa: 'Cliente Rescindido' };
const FINALIZADO: SituacaoNaFaixa = { fonte: 'funil', situacao: 'finalizado', funil: 'Trabalhista - Jurídico', etapa: 'Encerrado' };
const DESDE = '2026-08-12T13:00:00.000Z';
const doAtlas = (situacao: 'rescindido' | 'finalizado' | 'suspenso' | 'inativo', parcial: Partial<SituacaoNaFaixa> = {}): SituacaoNaFaixa =>
  ({ fonte: 'atlas', situacao, desde: DESDE, lidaEm: '2026-09-30T14:45:00.000Z', velha: false, ...parcial }) as SituacaoNaFaixa;
const dia = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });

describe('FaixaDeSituacaoDoCliente', () => {
  it('cala com null ("não sei") e com lista vazia — nunca afirma "ativo"', () => {
    expect(desenhar(null)).toBe('');
    expect(desenhar([])).toBe('');
  });

  it('rescindido pelo funil: pastilha vermelha opaca, "no funil …, etapa “…”"', () => {
    const html = desenhar([RESCINDIDO]);
    expect(html).toMatch(/Cliente <span[^>]*bg-red-600[^>]*text-white[^>]*>Rescindido<\/span>/);
    expect(html).toContain('Contrato rescindido no funil Bancário - Jurídico, etapa “Cliente Rescindido”.');
    expect(html).toContain('role="status"');
    expect(html).toContain('data-situacao="rescindido"');
    expect(html).toContain('data-fonte="funil"');
  });

  it('finalizado: azul, não vermelha (finalizado não é "mau")', () => {
    const html = desenhar([FINALIZADO]);
    expect(html).toMatch(/Cliente <span[^>]*bg-sky-700[^>]*text-white[^>]*>Finalizado<\/span>/);
    expect(html).toContain('Contrato finalizado no funil Trabalhista - Jurídico, etapa “Encerrado”.');
    expect(html).not.toContain('red-');
  });

  it('pelo Atlas: "no Atlas desde <data>", e a variante sem a data quando ela é desconhecida', () => {
    expect(desenhar([doAtlas('rescindido')])).toContain(`Contrato rescindido no Atlas desde ${dia(DESDE)}.`);
    const semData = desenhar([doAtlas('finalizado', { desde: null })]);
    expect(semData).toContain('Contrato finalizado no Atlas.');
    expect(semData).not.toContain('desde');
    expect(semData).toContain('data-fonte="atlas"');
  });

  it('suspenso (âmbar) e inativo (cinza), só do Atlas', () => {
    const suspenso = desenhar([doAtlas('suspenso')]);
    expect(suspenso).toMatch(/Cliente <span[^>]*bg-amber-700[^>]*text-white[^>]*>Suspenso<\/span>/);
    expect(suspenso).toContain('border-amber-500/50');
    expect(suspenso).toContain(`Cliente suspenso no Atlas desde ${dia(DESDE)}.`);
    const inativo = desenhar([doAtlas('inativo', { desde: null })]);
    expect(inativo).toMatch(/Cliente <span[^>]*bg-slate-600[^>]*text-white[^>]*>Inativo<\/span>/);
    expect(inativo).toContain('border-slate-500/50');
    expect(inativo).toContain('Cliente inativo no Atlas.');
  });

  it('leitura velha: a linha discreta "Situação lida no Atlas em …"; fresca, nada', () => {
    expect(desenhar([doAtlas('rescindido', { velha: true })])).toContain('Situação lida no Atlas em');
    expect(desenhar([doAtlas('rescindido')])).not.toContain('Situação lida no Atlas em');
    // Velha sem saber quando: não inventa data.
    expect(desenhar([doAtlas('rescindido', { velha: true, lidaEm: null })])).not.toContain('Situação lida no Atlas em');
  });

  it('o texto nunca é colorido (contraste nos dois modos): a cor de texto só vai no ícone', () => {
    for (const html of [desenhar([RESCINDIDO]), desenhar([FINALIZADO]), desenhar([doAtlas('suspenso')]), desenhar([doAtlas('inativo')])]) {
      expect(html).toMatch(/<svg[^>]*class="[^"]*text-(red|sky|amber|slate)-600/);
      expect(html).not.toMatch(/<(?!svg)[a-z]+[^>]*class="[^"]*text-(red|sky|amber|slate)-[0-9]{3}/);
    }
  });

  it('duas fontes: a primeira (a mais grave) dá cor e título, e as duas aparecem com a fonte', () => {
    const html = desenhar([doAtlas('rescindido'), RESCINDIDO, FINALIZADO]);
    expect(html).toContain('data-situacao="rescindido"');
    expect(html).toContain('data-fonte="atlas"');
    expect(html).toContain('no Atlas desde');
    expect(html).toContain('Bancário - Jurídico');
    expect(html).toContain('Trabalhista - Jurídico');
  });

  it('não tem botão nem link: só informa (D7)', () => {
    const html = desenhar([doAtlas('rescindido'), RESCINDIDO]);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<a ');
  });

  it('os dois dicionários têm as chaves (fallback do next-intl é por arquivo)', () => {
    expect(desenhar([RESCINDIDO], en, 'en')).toMatch(/Client <span[^>]*>Terminated<\/span>/);
    expect(desenhar([FINALIZADO], en, 'en')).toMatch(/Client <span[^>]*>Closed out<\/span>/);
    expect(desenhar([doAtlas('suspenso', { velha: true })], en, 'en')).toMatch(/Client <span[^>]*>Suspended<\/span>[\s\S]*in Atlas since[\s\S]*Status read from Atlas on/);
    expect(desenhar([doAtlas('inativo', { desde: null })], en, 'en')).toContain('Client inactive in Atlas.');
    expect(desenhar([RESCINDIDO], en, 'en')).toContain('in the Bancário - Jurídico pipeline, stage “Cliente Rescindido”.');
  });
});
