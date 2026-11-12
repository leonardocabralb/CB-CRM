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

function desenhar(
  corpo: string | null,
  mensagens: AbstractIntlMessages = ptBR as unknown as AbstractIntlMessages,
  tom?: 'aviso' | 'falha',
) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-BR" messages={mensagens}>
      <CaixinhaDaIa tom={tom} titulo="IA passou Fulana para a equipe" corpo={corpo} onAbrir={() => {}} onFechar={() => {}} />
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
    expect(desenhar('x', en as unknown as AbstractIntlMessages, 'falha')).toContain('See the overdue conversations');
  });

  it('1140 (F1): o ALARME de que a IA parou é VERMELHO e convida às conversas em atraso — nada de âmbar', () => {
    const html = desenhar('Gemini recusou a chave: troque-a em Integrações.', undefined, 'falha');
    expect(html).toContain('border-2 border-red-500');
    expect(html).toContain('bg-red-500/10');
    expect(html).toContain('bg-red-600 text-white');
    // O texto vermelho é o -600: passa nos dois temas (o `dark:` está inerte).
    expect(html).toContain('text-red-600');
    expect(html).toContain('Ver as conversas em atraso');
    expect(html).not.toContain('Abrir a conversa');
    expect(html).not.toMatch(/\b(bg|border|text)-amber-/);
    expect(html.match(/<button/g)).toHaveLength(2);
  });
});
