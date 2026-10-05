import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import ptBR from '../../../messages/pt-BR.json';
import type { ScheduledMessage } from '@/types';

import { AnexoECitacao } from './anexo-e-citacao';

// ============================================================
// A prévia do anexo da agendada (pedido do operador, 05/10/2026): conferir
// O QUE vai sair, não só o tipo. O áudio toca, o documento abre, foto e
// vídeo ampliam.
// ============================================================

const URL_DO_BUCKET =
  'https://exemplo.supabase.co/storage/v1/object/public/chat-media/account-1/123-arquivo';

function desenhar(
  kind: NonNullable<ScheduledMessage['media_kind']>,
  media_filename: string | null = null,
  ext = '',
) {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="pt-BR"
      messages={ptBR as unknown as AbstractIntlMessages}
      timeZone="America/Sao_Paulo"
    >
      <AnexoECitacao
        agendada={{
          status: 'pending',
          media_url: `${URL_DO_BUCKET}${ext}`,
          media_kind: kind,
          media_filename,
          reply_to_message_id: null,
          citacao_perdida: false,
        }}
        citada={undefined}
        citadaCarregada
      />
    </NextIntlClientProvider>,
  );
}

describe('AnexoECitacao — prévia do anexo', () => {
  it('áudio: o player do fio, tocando o arquivo da agendada', () => {
    const html = desenhar('audio', null, '.ogg');
    expect(html).toContain('<audio');
    expect(html).toContain(`src="${URL_DO_BUCKET}.ogg"`);
    expect(html).toContain('aria-label="Reproduzir áudio"');
  });

  it('documento: abre o arquivo numa aba, com o nome e o selo do tipo', () => {
    const html = desenhar('document', 'Contrato.pdf', '.pdf');
    expect(html).toContain(`href="${URL_DO_BUCKET}.pdf"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('Contrato.pdf');
    expect(html).toContain('>PDF<');
  });

  it('página .html vai para BAIXAR, nunca abrir a partir do nosso Storage', () => {
    const html = desenhar('document', 'pagina.html', '.html');
    expect(html).toContain(`href="${URL_DO_BUCKET}.html?download=pagina.html"`);
  });

  it('página .html sem nome (API v1) também vai para baixar, pelo caminho', () => {
    const html = desenhar('document', null, '.html');
    expect(html).toMatch(/href="[^"]*\.html\?download=[^"]+"/);
  });

  it('nome de PDF sobre um .html no bucket: quem decide é o caminho', () => {
    const html = desenhar('document', 'contrato.pdf', '.html');
    expect(html).toMatch(/href="[^"]*\.html\?download=[^"]+"/);
  });

  it('documento sem nome mostra o nome do caminho, não "Documento"', () => {
    const html = desenhar('document', null, '.pdf');
    expect(html).toContain('arquivo.pdf');
    expect(html).toContain(`href="${URL_DO_BUCKET}.pdf"`);
  });

  it('foto: miniatura num botão que amplia', () => {
    const html = desenhar('image', null, '.jpg');
    expect(html).toMatch(/<button[^>]*aria-label="Ampliar imagem"/);
    expect(html).toContain(`src="${URL_DO_BUCKET}.jpg"`);
  });

  it('vídeo: botão que abre o visualizador', () => {
    const html = desenhar('video', null, '.mp4');
    expect(html).toMatch(/<button[^>]*aria-label="Assistir ao vídeo"/);
  });
});
