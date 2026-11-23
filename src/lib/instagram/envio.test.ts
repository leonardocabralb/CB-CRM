import { describe, expect, it } from 'vitest';

import {
  FRASES_DO_DIRECT,
  TETO_DA_IMAGEM_DO_DIRECT,
  arquivoCabeNoDirect,
  bytesDoTexto,
  conferirParaODirect,
  extensaoDoArquivo,
  faixaDaJanelaDoDirect,
  janelaDoDirectAberta,
  MIMES_DO_DIRECT,
  nomeComExtensaoDoDirect,
  type RecusaDoDirect,
} from './envio';

describe('bytesDoTexto — a medida da Meta é BYTE, não caractere', () => {
  it('acento e emoji pesam mais de um', () => {
    expect(bytesDoTexto('abc')).toBe(3);
    expect(bytesDoTexto('ção')).toBe(5);
    expect(bytesDoTexto('👍')).toBe(4);
  });
});

describe('conferirParaODirect', () => {
  it('texto até 1000 bytes passa; 1001 não', () => {
    expect(
      conferirParaODirect({ tipo: 'text', texto: 'a'.repeat(1000) })
    ).toEqual({
      ok: true,
      anexo: null,
    });
    expect(
      conferirParaODirect({ tipo: 'text', texto: 'a'.repeat(1001) })
    ).toEqual({
      ok: false,
      recusa: 'texto_longo',
    });
    // 500 caracteres de 2 bytes = 1000 bytes: passa; 501 = 1002: não.
    expect(
      conferirParaODirect({ tipo: 'text', texto: 'é'.repeat(500) }).ok
    ).toBe(true);
    expect(
      conferirParaODirect({ tipo: 'text', texto: 'é'.repeat(501) }).ok
    ).toBe(false);
  });

  it('modelo e interativa não existem no Direct', () => {
    expect(conferirParaODirect({ tipo: 'template', texto: null })).toEqual({
      ok: false,
      recusa: 'tipo',
    });
    expect(conferirParaODirect({ tipo: 'interactive', texto: 'x' })).toEqual({
      ok: false,
      recusa: 'tipo',
    });
  });

  it('anexo NÃO leva legenda (decisão de 21/11/2026)', () => {
    expect(
      conferirParaODirect({
        tipo: 'image',
        texto: 'veja',
        mediaUrl: 'https://x/a.jpg',
      })
    ).toEqual({ ok: false, recusa: 'legenda' });
    // Legenda só de espaço não é legenda.
    expect(
      conferirParaODirect({
        tipo: 'image',
        texto: '  ',
        mediaUrl: 'https://x/a.jpg',
      }).ok
    ).toBe(true);
  });

  it('cada classe com os formatos da doc, pela extensão', () => {
    const caso = (tipo: string, arquivo: string) =>
      conferirParaODirect({ tipo, texto: null, filename: arquivo });
    expect(caso('image', 'foto.PNG')).toEqual({ ok: true, anexo: 'image' });
    expect(caso('image', 'foto.webp')).toEqual({
      ok: false,
      recusa: 'formato_imagem',
    });
    expect(caso('video', 'video.mov')).toEqual({ ok: true, anexo: 'video' });
    expect(caso('audio', 'voice-1.wav')).toEqual({ ok: true, anexo: 'audio' });
    expect(caso('audio', 'voice-1.ogg')).toEqual({
      ok: false,
      recusa: 'formato_audio',
    });
    expect(caso('document', 'contrato.pdf')).toEqual({
      ok: true,
      anexo: 'file',
    });
    expect(caso('document', 'contrato.docx')).toEqual({
      ok: false,
      recusa: 'formato_documento',
    });
  });

  it('sem extensão reconhecível é recusado — não há como saber se é PDF', () => {
    expect(
      conferirParaODirect({
        tipo: 'document',
        texto: null,
        filename: 'contrato',
      })
    ).toEqual({
      ok: false,
      recusa: 'formato_documento',
    });
  });
});

describe('extensaoDoArquivo', () => {
  it('do nome; senão da URL; senão do caminho no bucket', () => {
    expect(extensaoDoArquivo('Contrato Final.PDF', null)).toBe('pdf');
    expect(
      extensaoDoArquivo(
        null,
        'https://x.supabase.co/storage/v1/object/public/chat-media/account-1/a%20b.jpeg'
      )
    ).toBe('jpeg');
    expect(extensaoDoArquivo(null, 'account-1/2026/arquivo.wav')).toBe('wav');
    expect(extensaoDoArquivo('sem-extensao', null)).toBeNull();
    expect(extensaoDoArquivo(null, null)).toBeNull();
  });
});

describe('arquivoCabeNoDirect — antes de subir', () => {
  it('pelo MIME do navegador (com parâmetro) e o teto de 8 MB da imagem', () => {
    expect(arquivoCabeNoDirect('image', 'image/jpeg', 1000)).toBeNull();
    expect(
      arquivoCabeNoDirect('image', 'image/png; charset=binary', 1000)
    ).toBeNull();
    expect(arquivoCabeNoDirect('image', 'image/webp', 1000)).toBe(
      'formato_imagem'
    );
    expect(
      arquivoCabeNoDirect('image', 'image/jpeg', TETO_DA_IMAGEM_DO_DIRECT + 1)
    ).toBe('imagem_grande');
    expect(arquivoCabeNoDirect('audio', 'audio/wav', 1000)).toBeNull();
    expect(arquivoCabeNoDirect('audio', 'audio/ogg', 1000)).toBe(
      'formato_audio'
    );
    expect(arquivoCabeNoDirect('document', 'application/pdf', 1000)).toBeNull();
    expect(arquivoCabeNoDirect('document', 'application/msword', 1000)).toBe(
      'formato_documento'
    );
  });
});

describe('janelaDoDirectAberta', () => {
  const agora = new Date('2026-11-21T20:00:00Z');
  it('aberta até 24 h depois da última mensagem da pessoa', () => {
    expect(janelaDoDirectAberta('2026-11-20T20:00:01Z', agora)).toBe(true);
    expect(janelaDoDirectAberta('2026-11-20T20:00:00Z', agora)).toBe(false);
  });
  it('sem mensagem da pessoa (ou data ilegível): fechada', () => {
    expect(janelaDoDirectAberta(null, agora)).toBe(false);
    expect(janelaDoDirectAberta('não é data', agora)).toBe(false);
  });
});

describe('faixaDaJanelaDoDirect — a janela de 7 dias do Human Agent (22/11/2026)', () => {
  const agora = new Date('2026-11-21T20:00:00Z');
  it('dentro das 24 h: aberta, com ou sem o Human Agent (a tag não vai)', () => {
    expect(faixaDaJanelaDoDirect('2026-11-20T20:00:01Z', agora, true)).toBe('aberta');
    expect(faixaDaJanelaDoDirect('2026-11-20T20:00:01Z', agora, false)).toBe('aberta');
  });
  it('de 24 h a 7 dias: `human_agent` SÓ com ele; sem ele, fechada', () => {
    expect(faixaDaJanelaDoDirect('2026-11-20T20:00:00Z', agora, true)).toBe('human_agent');
    expect(faixaDaJanelaDoDirect('2026-11-14T20:00:01Z', agora, true)).toBe('human_agent');
    expect(faixaDaJanelaDoDirect('2026-11-20T20:00:00Z', agora, false)).toBe('fechada');
  });
  it('7 dias ou mais: fechada também com o Human Agent', () => {
    expect(faixaDaJanelaDoDirect('2026-11-14T20:00:00Z', agora, true)).toBe('fechada');
  });
  it('sem mensagem da pessoa (ou data ilegível): fechada, com ou sem ele', () => {
    expect(faixaDaJanelaDoDirect(null, agora, true)).toBe('fechada');
    expect(faixaDaJanelaDoDirect('não é data', agora, true)).toBe('fechada');
  });
});

describe('FRASES_DO_DIRECT', () => {
  it('toda recusa tem frase', () => {
    const recusas: RecusaDoDirect[] = [
      'tipo',
      'texto_longo',
      'legenda',
      'formato_imagem',
      'formato_video',
      'formato_audio',
      'formato_documento',
      'imagem_grande',
    ];
    for (const r of recusas) expect(FRASES_DO_DIRECT[r]).toMatch(/\S/);
  });
});

describe('JPEG com outra extensão (revisão do PR #539)', () => {
  it('`.jfif` e `.jpe` são JPEG: o servidor aceita o que o compositor aceitou pelo MIME', () => {
    expect(conferirParaODirect({ tipo: 'image', texto: null, filename: 'foto.jfif' }).ok).toBe(true);
    expect(conferirParaODirect({ tipo: 'image', texto: null, filename: 'foto.JPE' }).ok).toBe(true);
  });
});

describe('nomeComExtensaoDoDirect — arquivo sem extensão (revisão do PR #539)', () => {
  it('nome sem extensão ganha a do MIME, e o servidor passa a aceitá-lo', () => {
    const nome = nomeComExtensaoDoDirect('image', 'foto', 'image/jpeg');
    expect(nome).toBe('foto.jpg');
    // O caminho no Storage sai do nome (`buildMediaPath`): sem a extensão
    // ele terminava em `.bin`, e o servidor recusava o que o compositor aceitou.
    expect(
      conferirParaODirect({ tipo: 'image', texto: null, mediaUrl: `account-x/1-${nome}` }).ok
    ).toBe(true);
    expect(nomeComExtensaoDoDirect('document', 'contrato', 'application/pdf')).toBe('contrato.pdf');
    expect(nomeComExtensaoDoDirect('audio', 'voz', 'audio/mp4')).toBe('voz.m4a');
  });

  it('nome com extensão aceita fica como está', () => {
    expect(nomeComExtensaoDoDirect('image', 'foto.JPEG', 'image/jpeg')).toBe('foto.JPEG');
    expect(nomeComExtensaoDoDirect('document', 'a.pdf', 'application/pdf')).toBe('a.pdf');
  });

  it('extensão que o Direct não aceita na classe ganha a do MIME no fim', () => {
    expect(nomeComExtensaoDoDirect('image', 'foto.final', 'image/png')).toBe('foto.final.png');
  });

  it('MIME fora da régua ou classe desconhecida não mexe no nome (quem recusa é a régua)', () => {
    expect(nomeComExtensaoDoDirect('image', 'foto', 'image/gif')).toBe('foto');
    expect(nomeComExtensaoDoDirect('sticker', 'foto', 'image/png')).toBe('foto');
  });

  it('todo MIME aceito tem extensão aceita na MESMA classe', () => {
    for (const [classe, mimes] of Object.entries(MIMES_DO_DIRECT)) {
      for (const mime of mimes) {
        const nome = nomeComExtensaoDoDirect(classe, 'x', mime);
        expect(nome, `${classe} ${mime}`).not.toBe('x');
        expect(
          conferirParaODirect({ tipo: classe, texto: null, filename: nome }).ok,
          `${classe} ${mime}`
        ).toBe(true);
      }
    }
  });
});
