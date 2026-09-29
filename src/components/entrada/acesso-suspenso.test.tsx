import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import ptBR from '../../../messages/pt-BR.json';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: {} }) }));

import { AcessoSuspenso } from './acesso-suspenso';

// ============================================================
// A tela de quem teve o acesso suspenso (1067). Ela substitui o app inteiro e
// só aparece a quem está suspenso — o navegador de teste não chega nela sem
// entrar como alguém suspenso, então o desenho é conferido aqui, com o
// dicionário de verdade.
// ============================================================

const t = ptBR.AcessoSuspenso;

function desenhar(suspensoEm: string | null) {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="pt-BR"
      messages={ptBR as unknown as AbstractIntlMessages}
      timeZone="America/Sao_Paulo"
    >
      <AcessoSuspenso suspensoEm={suspensoEm} aoTentarDeNovo={async () => {}} />
    </NextIntlClientProvider>,
  );
}

describe('AcessoSuspenso', () => {
  it('diz o que houve, desde quando, e oferece verificar de novo e sair', () => {
    const html = desenhar('2026-09-29T15:00:00Z');
    expect(html).toContain(t.titulo);
    expect(html).toContain(t.comoVoltar);
    expect(html).toContain(t.tentarDeNovo);
    expect(html).toContain(t.sair);
    // A data sai no formato do navegador; o que importa é que a frase com data
    // foi a escolhida (e não a sem data) e que o ano aparece.
    expect(html).toContain('2026');
    expect(html).not.toContain(t.descricao);
  });

  it('sem a data, usa a frase sem data em vez de "Invalid Date"', () => {
    const html = desenhar(null);
    expect(html).toContain(t.descricao);
    expect(html).not.toContain('Invalid');
  });
});
