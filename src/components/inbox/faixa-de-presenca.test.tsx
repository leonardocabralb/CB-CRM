import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';
import type { Profile } from '@/types';

import { FaixaDePresenca, nomesDeQuemVe } from './faixa-de-presenca';

// ============================================================
// Quem MAIS está com a conversa aberta, em frase acima do compositor (pedido
// do operador, 29/09/2026): os avatares do cabeçalho eram discretos demais.
// ============================================================

function perfil(user_id: string, full_name: string | null, email = `${user_id}@x.com`): Profile {
  return { user_id, full_name, email } as Profile;
}

const ROSTER = [
  perfil('u-fulana', 'Fulana Souza'),
  perfil('u-beltrano', 'Beltrano Lima'),
  perfil('u-ciclana', 'Ciclana Reis'),
  perfil('u-sem-nome', null, 'contato@example.com'),
];

function desenhar(userIds: string[], messages: unknown = ptBR, locale = 'pt-BR') {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={messages as AbstractIntlMessages}
      timeZone="America/Sao_Paulo"
    >
      <FaixaDePresenca userIds={userIds} profiles={ROSTER} />
    </NextIntlClientProvider>
  );
}

describe('FaixaDePresenca', () => {
  it('uma pessoa: o nome inteiro, na frase', () => {
    expect(desenhar(['u-fulana'])).toContain('Fulana Souza também está nesta conversa');
  });

  it('duas pessoas: os dois nomes', () => {
    expect(desenhar(['u-fulana', 'u-beltrano'])).toContain(
      'Fulana Souza e Beltrano Lima também estão nesta conversa'
    );
  });

  it('três ou mais: o primeiro e a contagem, no plural certo', () => {
    expect(desenhar(['u-fulana', 'u-beltrano', 'u-ciclana'])).toContain(
      'Fulana Souza e mais 2 pessoas estão nesta conversa'
    );
  });

  it('ninguém — ou só quem ainda não tem perfil carregado — não desenha nada', () => {
    expect(desenhar([])).toBe('');
    expect(desenhar(['u-desconhecido'])).toBe('');
  });

  it('sem nome completo, o e-mail (como nos avatares do cabeçalho)', () => {
    expect(nomesDeQuemVe(['u-sem-nome', 'u-desconhecido'], ROSTER)).toEqual(['contato@example.com']);
  });

  it('é anunciada ao leitor de tela', () => {
    expect(desenhar(['u-fulana'])).toContain('role="status"');
  });

  it('as três frases existem nos DOIS dicionários (inglês também desenha)', () => {
    expect(desenhar(['u-fulana', 'u-beltrano', 'u-ciclana'], en, 'en')).toContain(
      'Fulana Souza and 2 other people are also in this conversation'
    );
    for (const chave of ['presencaUm', 'presencaDois', 'presencaMais'] as const) {
      expect(ptBR.Inbox.messageThread[chave]).toBeTruthy();
      expect(en.Inbox.messageThread[chave]).toBeTruthy();
    }
  });

  it('⚠️ o fio monta a faixa entre as agendadas e o compositor', () => {
    const fio = readFileSync(join(__dirname, 'message-thread.tsx'), 'utf8');
    const agendadas = fio.indexOf('<ScheduledBar');
    const faixa = fio.indexOf('<FaixaDePresenca');
    const compositor = fio.indexOf('<MessageComposer');
    expect(agendadas).toBeGreaterThan(-1);
    expect(faixa).toBeGreaterThan(agendadas);
    expect(compositor).toBeGreaterThan(faixa);
  });
});
