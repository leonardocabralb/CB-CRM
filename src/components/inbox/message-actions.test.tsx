import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import ptBR from '../../../messages/pt-BR.json';
import type { Message } from '@/types';

// ============================================================
// A barra de ações da mensagem no CELULAR (relato do operador, 05/10/2026):
// no iPhone não havia como responder, copiar nem reagir. O Safari do iPhone
// não dispara `contextmenu` no toque longo, e o `hover:` do Tailwind 4 só vale
// com `(hover: hover)` — a barra dependia só desses dois. O gesto em si se
// confere no aparelho; aqui ficam o desenho e os contratos entre arquivos.
// ============================================================

vi.mock('@/hooks/use-can', () => ({ useCan: () => true }));

import { MessageActions } from './message-actions';

function desenhar() {
  const m = {
    id: 'm1',
    conversation_id: 'c1',
    sender_type: 'customer',
    content_type: 'text',
    content_text: 'Bom dia',
    status: 'delivered',
    created_at: '2026-10-05T12:00:00Z',
  } as Message;
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="pt-BR"
      messages={ptBR as unknown as AbstractIntlMessages}
      timeZone="America/Sao_Paulo"
    >
      <MessageActions message={m} onReply={() => {}} onReact={() => {}}>
        <p>Bom dia</p>
      </MessageActions>
    </NextIntlClientProvider>,
  );
}

const fonte = (arquivo: string) => readFileSync(join(__dirname, arquivo), 'utf8');

describe('MessageActions — no toque', () => {
  it('a linha desliga a seleção de texto e o menu do iPhone só no toque', () => {
    const [linha] = desenhar().match(/<div [^>]*>/) ?? [];
    expect(linha).toContain('pointer-coarse:select-none');
    expect(linha).toContain('pointer-coarse:[-webkit-touch-callout:none]');
    // No computador nada muda: selecionar um trecho com o mouse continua.
    expect(linha).not.toMatch(/(^|\s)select-none/);
  });

  it('a barra invisível não recebe toque; aberta, recebe', () => {
    const barra = desenhar().match(/<div [^>]*absolute[^>]*>/)?.[0] ?? '';
    expect(barra).toMatch(/(^|\s|")pointer-events-none(\s|")/);
    expect(barra).toContain('data-[touch-open=true]:pointer-events-auto');
    expect(barra).toContain('group-hover/actions:pointer-events-auto');
    expect(barra).toContain('group-focus-within/actions:pointer-events-auto');
  });

  it('os botões crescem no toque', () => {
    const html = desenhar();
    for (const rotulo of [ptBR.Inbox.actions.react, ptBR.Inbox.actions.reply, ptBR.Inbox.actions.copyText]) {
      const botao = html.match(new RegExp(`<button [^>]*aria-label="${rotulo}"[^>]*>`))?.[0] ?? '';
      expect(botao, rotulo).toContain('pointer-coarse:h-8');
    }
  });

  it('o toque longo é medido pela linha, não só pelo `contextmenu`', () => {
    const src = fonte('message-actions.tsx');
    for (const ouvinte of ['onTouchStart=', 'onTouchMove=', 'onTouchEnd=', 'onTouchCancel=']) {
      expect(src, ouvinte).toContain(ouvinte);
    }
    // O mesmo prazo do player de áudio: com o da barra menor, soltar o dedo
    // entre os dois abria a barra E pulava o áudio.
    expect(src).toContain('import { TOQUE_LONGO_MS } from "./player-de-audio"');
  });

  it('a posição acima do dedo não depende de `touchOpen`', () => {
    // O toque no emoji (no popover, fora da linha) fecha o `touchOpen`: preso
    // a ele, o `top` sumiria, a barra pularia com o seletor ancorado nela e o
    // dedo erraria o emoji.
    expect(fonte('message-actions.tsx')).toContain(
      'style={topoNoToque !== null ? { top: topoNoToque } : undefined}',
    );
  });

  it('o link do texto e a linha falam da MESMA marca', () => {
    // Renomear um lado sem o outro faz o toque longo no link abrir a barra.
    expect(fonte('message-actions.tsx')).toContain('closest("[data-menu-do-navegador]")');
    expect(fonte('texto-com-links.tsx')).toContain('data-menu-do-navegador=""');
  });
});
