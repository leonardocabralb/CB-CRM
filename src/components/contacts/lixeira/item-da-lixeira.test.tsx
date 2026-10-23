import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import ptBR from '../../../../messages/pt-BR.json';
import type { ItemDaLixeira } from '@/lib/contacts/lixeira';

import { ItemDaLixeiraLinha } from './item-da-lixeira';

// ============================================================
// O item da Lixeira bloqueado por identidade ocupada (B2) oferece "Restaurar
// e unir" com a ficha que ocupa (1101) — salvo com Instagram, em que a união
// recusa sempre: aí a frase, sem botão. Dados fictícios.
// ============================================================

const ITEM: ItemDaLixeira = {
  id: '00000000-0000-4000-8000-0000000000a1',
  contactId: '00000000-0000-4000-8000-0000000000c1',
  loteId: '00000000-0000-4000-8000-0000000000b1',
  nome: 'Fulana Teste',
  telefone: '5500900000000',
  email: null,
  instagramUsername: null,
  waUsername: null,
  movidaEm: '2026-10-20T12:00:00+00:00',
  movidaPorNome: 'Admin Teste',
  venceEm: '2027-01-18T12:00:00+00:00',
  contagens: { messages: 3 },
  ocupadaPor: null,
  ocupadaPorNome: null,
  loteTotal: 1,
  ocupadaComInstagram: false,
};

function desenhar(item: ItemDaLixeira) {
  const erros: string[] = [];
  const html = renderToStaticMarkup(
    <NextIntlClientProvider
      locale="pt-BR"
      messages={ptBR as unknown as AbstractIntlMessages}
      timeZone="America/Sao_Paulo"
      onError={(e) => erros.push(`${e.code}: ${e.message}`)}
    >
      <ItemDaLixeiraLinha
        item={item}
        agora={Date.parse('2026-10-23T12:00:00Z')}
        fichasNoLote={1}
        ocupado={false}
        emAcao={false}
        aoRestaurar={() => {}}
        aoRestaurarLote={() => {}}
        aoRestaurarEUnir={() => {}}
        aoExcluir={() => {}}
      />
    </NextIntlClientProvider>,
  );
  return { html, erros };
}

const textos = ptBR.Contacts.lixeira;

describe('ItemDaLixeiraLinha — Restaurar e unir no item bloqueado', () => {
  it('sem identidade ocupada: só os botões de sempre', () => {
    const { html, erros } = desenhar(ITEM);
    expect(erros).toEqual([]);
    expect(html).not.toContain(textos.mesmaPessoa.restaurarEUnir);
  });

  it('bloqueado (B2): o botão, e o texto aponta para ele', () => {
    const { html, erros } = desenhar({
      ...ITEM,
      ocupadaPor: '00000000-0000-4000-8000-0000000000c2',
      ocupadaPorNome: 'Fulana Nova',
    });
    expect(erros).toEqual([]);
    expect(html).toContain(`${textos.mesmaPessoa.restaurarEUnir}</button>`);
    // O texto do bloqueio cita o botão, com as aspas escapadas no HTML.
    expect(html).toContain('Restaurar e unir&quot; para trazê-la unida');
    expect(html).not.toContain(textos.mesmaPessoa.instagram);
  });

  it('bloqueado com Instagram: sem o botão, com a frase de que ainda não dá', () => {
    const { html } = desenhar({
      ...ITEM,
      ocupadaPor: '00000000-0000-4000-8000-0000000000c2',
      ocupadaPorNome: 'Fulana Nova',
      ocupadaComInstagram: true,
    });
    expect(html).not.toContain(`${textos.mesmaPessoa.restaurarEUnir}</button>`);
    expect(html).toContain(textos.mesmaPessoa.instagram);
  });
});
