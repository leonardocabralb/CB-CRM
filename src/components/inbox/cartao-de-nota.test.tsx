import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import ptBR from '../../../messages/pt-BR.json';
import type { ConversationNote } from '@/types';

import { CartaoDeNota } from './cartao-de-nota';

// ============================================================
// Leitura das anotações nas abas (pedido do operador, 29/09/2026):
//   - o texto sai em `text-sm`, na cor do texto — em `text-xs` cinza sobre
//     cinza a anotação era difícil de ler e de achar na lista;
//   - a FIXADA nasce RECOLHIDA: presa no topo da aba e inteira, uma anotação
//     longa cobria a rolagem da lista toda;
//   - no painel, a caixa de escrever vem ANTES da fixada.
// ============================================================

const TEXTO = 'Cliente enviou os documentos pelos links abaixo';

const NOTA: ConversationNote = {
  id: 'nota-1',
  account_id: 'conta-1',
  conversation_id: 'conversa-1',
  contact_id: 'contato-1',
  author_user_id: 'autor-1',
  autor_nome: 'Fulana de Tal',
  texto: TEXTO,
  resposta_de: null,
  mencionados: [],
  fixada_em: null,
  anexos: [],
  editada_em: null,
  created_at: '2026-09-29T15:42:00Z',
};

function desenhar(destaque: boolean) {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="pt-BR"
      messages={ptBR as unknown as AbstractIntlMessages}
      timeZone="America/Sao_Paulo"
    >
      <CartaoDeNota
        nota={destaque ? { ...NOTA, fixada_em: '2026-09-29T16:00:00Z' } : NOTA}
        podeApagar
        onApagar={() => {}}
        destaque={destaque}
        fixada={destaque}
        onFixar={() => {}}
      />
    </NextIntlClientProvider>
  );
}

/** As classes do parágrafo que carrega o texto da anotação. */
function classesDoCorpo(html: string): string[] {
  const achado = html.match(new RegExp(`<p class="([^"]*)">${TEXTO}</p>`));
  expect(achado, 'o corpo da anotação não foi desenhado').not.toBeNull();
  return achado![1].split(/\s+/);
}

describe('CartaoDeNota — leitura', () => {
  it('nota comum: texto legível (text-sm, cor do texto) e INTEIRO', () => {
    const corpo = classesDoCorpo(desenhar(false));
    expect(corpo).toContain('text-sm');
    expect(corpo).toContain('text-foreground');
    expect(corpo).not.toContain('text-muted-foreground');
    expect(corpo.some((c) => c.startsWith('line-clamp'))).toBe(false);
  });

  it('nota comum: o autor aparece, com a frase das quatro telas', () => {
    expect(desenhar(false)).toContain(
      ptBR.Inbox.note.wrote.replace('{autor}', 'Fulana de Tal')
    );
  });

  it('⚠️ fixada: nasce RECOLHIDA em duas linhas', () => {
    const corpo = classesDoCorpo(desenhar(true));
    expect(corpo).toContain('line-clamp-2');
    expect(corpo).toContain('text-sm');
    expect(corpo).toContain('text-foreground');
  });

  it('fixada: o rótulo "Fixada" e o autor aparecem — fixar não apaga o dono', () => {
    const html = desenhar(true);
    expect(html).toContain(ptBR.Inbox.sidebar.pinnedNote);
    expect(html).toContain(
      ptBR.Inbox.note.wrote.replace('{autor}', 'Fulana de Tal')
    );
  });
});

describe('painel do contato — aba Notas', () => {
  const fonte = readFileSync(
    join(__dirname, 'painel', 'painel-do-contato.tsx'),
    'utf8'
  );
  // O CONTEÚDO da aba, não o gatilho (`<AbaDeIcone value="notas">` vem antes).
  const inicio = fonte.search(/<TabsContent\s+value="notas"/);
  const aba = fonte.slice(inicio, fonte.indexOf('</TabsContent>', inicio));

  it('⚠️ a caixa de escrever vem ANTES da nota fixada', () => {
    expect(inicio).toBeGreaterThan(-1);
    const caixa = aba.indexOf('<InternalNoteBox');
    const fixada = aba.indexOf('nota={notaFixada}');
    expect(caixa).toBeGreaterThan(-1);
    expect(fixada).toBeGreaterThan(-1);
    expect(caixa).toBeLessThan(fixada);
  });

  it('⚠️ o cartão fixado remonta por NOTA (aberta/recolhida é desta anotação)', () => {
    expect(aba).toContain('key={notaFixada.id}');
  });
});

// ============================================================
// Fase 3 — a marca "editada" e o lápis (A2, A4 do operador).
// ============================================================

function desenharNota(nota: ConversationNote, onEditar?: () => void) {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="pt-BR"
      messages={ptBR as unknown as AbstractIntlMessages}
      timeZone="America/Sao_Paulo"
    >
      <CartaoDeNota nota={nota} podeApagar onApagar={() => {}} onEditar={onEditar} />
    </NextIntlClientProvider>
  );
}

describe('CartaoDeNota — edição', () => {
  it('editada: a marca mostra a hora da edição AO LADO (no celular não há title), e a data completa no title', () => {
    const html = desenharNota({ ...NOTA, editada_em: '2026-09-30T13:05:00Z' });
    const marca = html.match(/<span title="([^"]*)" class="italic">([^<]*)<\/span>/);
    expect(marca, 'a marca, com o title').not.toBeNull();
    // Locale e fuso são os do runtime (na tela, os do navegador): o teste
    // cobra a FORMA — "editada <quando>" com uma hora —, não o texto exato,
    // que está em `quandoFoiEditada` (edicao.test.ts, com fuso fixo).
    expect(marca![2].startsWith(ptBR.Inbox.note.editada.replace('{quando}', ''))).toBe(true);
    expect(marca![2]).toMatch(/\d{1,2}:\d{2}/);
    expect(marca![1].startsWith(ptBR.Inbox.note.editadaEm.replace('{quando}', ''))).toBe(true);
  });

  it('nunca editada: sem marca', () => {
    expect(desenharNota(NOTA)).not.toContain(ptBR.Inbox.note.editadaEm.replace('{quando}', ''));
  });

  it('o lápis só existe com onEditar (quem monta o passa só ao autor)', () => {
    const rotulo = `aria-label="${ptBR.Inbox.note.edit}"`;
    expect(desenharNota(NOTA)).not.toContain(rotulo);
    expect(desenharNota(NOTA, () => {})).toContain(rotulo);
  });
});
