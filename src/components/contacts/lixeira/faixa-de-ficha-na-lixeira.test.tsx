import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import en from '../../../../messages/en.json';
import ptBR from '../../../../messages/pt-BR.json';
import type { ItemDaMesmaPessoa } from '@/lib/contacts/restaurar-e-unir';

import { FaixaDeFichaNaLixeira } from './faixa-de-ficha-na-lixeira';

// ============================================================
// A faixa "Há uma ficha desta pessoa na Lixeira" (1101). Cala com nulo
// (carregando, falhou, quem não é admin — o aviso nem monta a faixa) e com
// lista vazia; com item, diz quando e quem moveu, quantas mensagens, e
// oferece "Restaurar e unir" e o link da Lixeira. Dados fictícios.
// ============================================================

const ITEM: ItemDaMesmaPessoa = {
  id: '00000000-0000-4000-8000-0000000000a1',
  contactId: '00000000-0000-4000-8000-0000000000c1',
  nome: 'Fulana Teste',
  telefone: '5500900000000',
  waUsername: null,
  instagramUsername: null,
  movidaEm: '2026-10-20T12:00:00+00:00',
  movidaPorNome: 'Admin Teste',
  mensagens: 12,
  comInstagram: false,
};

function desenhar(itens: ItemDaMesmaPessoa[] | null, messages: unknown = ptBR, locale = 'pt-BR') {
  const erros: string[] = [];
  const html = renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={messages as AbstractIntlMessages}
      timeZone="America/Sao_Paulo"
      onError={(e) => erros.push(`${e.code}: ${e.message}`)}
    >
      <FaixaDeFichaNaLixeira itens={itens} aoRestaurarEUnir={() => {}} />
    </NextIntlClientProvider>,
  );
  return { html, erros };
}

describe('FaixaDeFichaNaLixeira', () => {
  it('nula (carregando ou falhou) ou vazia: não desenha nada — nunca afirma "nada na Lixeira"', () => {
    expect(desenhar(null).html).toBe('');
    expect(desenhar([]).html).toBe('');
  });

  it('com um item: quem moveu, as mensagens, "Restaurar e unir" e o link da Lixeira', () => {
    const { html, erros } = desenhar([ITEM]);
    expect(erros).toEqual([]);
    expect(html).toContain('data-faixa="ficha-na-lixeira"');
    expect(html).toContain('Há uma ficha desta pessoa na Lixeira');
    expect(html).toContain('Fulana Teste');
    expect(html).toContain('por Admin Teste');
    expect(html).toContain('12 mensagens');
    expect(html).toContain('Restaurar e unir');
    expect(html).toContain('href="/contacts/lixeira"');
    expect(html).toContain('Ver na Lixeira');
    // O texto fica na cor do tema; o âmbar só na borda, no fundo e no ícone.
    expect(html).toContain('text-foreground');
  });

  it('sem quem moveu (login apagado) e sem mensagem: frase própria, no singular certo', () => {
    const { html } = desenhar([{ ...ITEM, movidaPorNome: null, mensagens: 0 }]);
    expect(html).not.toContain(' por ');
    expect(html).toContain('nenhuma mensagem');
    expect(desenhar([{ ...ITEM, mensagens: 1 }]).html).toContain('1 mensagem.');
  });

  it('duas fichas da mesma pessoa: o título no plural e um botão por ficha', () => {
    const { html } = desenhar([ITEM, { ...ITEM, id: '00000000-0000-4000-8000-0000000000a2', nome: 'Fulana' }]);
    expect(html).toContain('Há 2 fichas desta pessoa na Lixeira');
    expect(html.match(/>Restaurar e unir<\/button>/g)).toHaveLength(2);
  });

  it('a ficha só do WhatsApp (sem telefone) aparece pelo @, nunca pelo BSUID', () => {
    const { html } = desenhar([{ ...ITEM, nome: null, telefone: null, waUsername: 'fulana_wa' }]);
    expect(html).toContain('@fulana_wa');
  });

  it('com Instagram: sem o botão, com a frase de que ainda não dá — e o link da Lixeira fica', () => {
    const { html, erros } = desenhar([{ ...ITEM, comInstagram: true }]);
    expect(erros).toEqual([]);
    expect(html).not.toContain('>Restaurar e unir</button>');
    expect(html).toContain(ptBR.Contacts.lixeira.mesmaPessoa.instagram);
    expect(html).toContain('href="/contacts/lixeira"');
  });

  it('em inglês, sem chave faltando', () => {
    const { html, erros } = desenhar([ITEM], en, 'en');
    expect(erros).toEqual([]);
    expect(html).toContain('There is a record of this person in the Trash');
    expect(html).toContain('Restore and merge');
  });
});
