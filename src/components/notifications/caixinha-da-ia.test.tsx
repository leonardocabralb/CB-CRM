import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';

import { CaixinhaDaIa } from './caixinha-da-ia';

// ============================================================
// A caixinha dentro do CRM quando a IA passa a conversa (1139, D3/D4 do
// operador): o cartão inteiro é UM botão que abre a conversa, e o X é outro,
// irmão (botão dentro de botão é HTML inválido), que só fecha.
// ============================================================

function desenhar(corpo: string | null, mensagens: AbstractIntlMessages = ptBR as unknown as AbstractIntlMessages) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-BR" messages={mensagens}>
      <CaixinhaDaIa titulo="IA passou Fulana para a equipe" corpo={corpo} onAbrir={() => {}} onFechar={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe('CaixinhaDaIa', () => {
  it('título, corpo (a pendência) e o convite a abrir, num botão; o X irmão, com rótulo para leitor de tela', () => {
    const html = desenhar('Pendência da IA: Pediu ligação');
    expect(html).toContain('IA passou Fulana para a equipe');
    expect(html).toContain('Pendência da IA: Pediu ligação');
    expect(html).toContain('Abrir a conversa');
    expect(html).toContain('aria-label="Fechar o aviso"');
    expect(html.match(/<button/g)).toHaveLength(2);
    // Os dois botões são IRMÃOS: o primeiro fecha antes do segundo abrir.
    expect(html.indexOf('</button>')).toBeLessThan(html.lastIndexOf('<button'));
    // O anúncio ao leitor de tela é o do próprio sonner (sem anunciar duas vezes).
    expect(html).not.toContain('role="alert"');
  });

  it('D5: destaque ÂMBAR (borda grossa, véu âmbar e o ícone cheio), nunca vermelho; cores que valem nos dois temas', () => {
    const html = desenhar('Pendência da IA: Pediu ligação');
    expect(html).toContain('border-2 border-amber-500');
    expect(html).toContain('bg-amber-500/10');
    expect(html).toContain('bg-amber-500 text-white');
    expect(html).not.toMatch(/\b(bg|border|text)-red-/);
    // O texto âmbar é o -700: o `dark:` está inerte e ele passa nos dois temas (`ui.md`).
    expect(html).toContain('text-amber-700');
  });

  it('sem corpo, sem o parágrafo vazio', () => {
    const html = desenhar(null);
    expect(html).not.toContain('line-clamp-3');
  });

  it('o texto existe nos DOIS dicionários', () => {
    const html = desenhar('x', en as unknown as AbstractIntlMessages);
    expect(html).toContain('Open the conversation');
    expect(html).toContain('aria-label="Dismiss the notice"');
  });
});
