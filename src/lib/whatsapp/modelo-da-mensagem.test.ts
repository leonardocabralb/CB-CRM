import { describe, expect, it } from 'vitest';

import {
  corpoExplicaOTexto,
  modeloDaMensagem,
  partesDoModelo,
  type ModeloDoCatalogo,
} from './modelo-da-mensagem';

// Canais e modelos fictícios.
const CANAL_A = 'canal-a';
const CANAL_B = 'canal-b';

function modelo(p: Partial<ModeloDoCatalogo> = {}): ModeloDoCatalogo {
  return {
    name: 'retorno_do_processo',
    language: 'pt_BR',
    channel_id: CANAL_A,
    header_type: null,
    header_content: null,
    footer_text: null,
    buttons: null,
    body_text: 'Olá {{1}}, o seu processo teve uma movimentação.',
    ...p,
  };
}

const mensagem = (
  p: {
    template_name?: string;
    channel_id?: string | null;
    content_text?: string;
  } = {}
) => ({
  template_name: 'retorno_do_processo',
  channel_id: CANAL_A,
  content_text: 'Olá Maria, o seu processo teve uma movimentação.',
  ...p,
});

describe('modeloDaMensagem — qual linha do catálogo', () => {
  it('sem nome de modelo, nenhuma', () => {
    expect(
      modeloDaMensagem(mensagem({ template_name: undefined }), [modelo()])
    ).toBeNull();
  });

  it('o modelo do MESMO canal da mensagem', () => {
    const doA = modelo({ footer_text: 'do A' });
    const doB = modelo({ channel_id: CANAL_B, footer_text: 'do B' });
    expect(modeloDaMensagem(mensagem(), [doB, doA])).toBe(doA);
    expect(
      modeloDaMensagem(mensagem({ channel_id: CANAL_B }), [doA, doB])
    ).toBe(doB);
  });

  it('o canal vence o global; sem o do canal, vale o global', () => {
    const global = modelo({ channel_id: null, footer_text: 'global' });
    const doA = modelo({ footer_text: 'do A' });
    expect(modeloDaMensagem(mensagem(), [global, doA])).toBe(doA);
    expect(modeloDaMensagem(mensagem(), [global])).toBe(global);
  });

  it('o de OUTRO canal nunca (o catálogo é por WABA)', () => {
    expect(
      modeloDaMensagem(mensagem({ channel_id: CANAL_B }), [modelo()])
    ).toBeNull();
  });

  it('mensagem sem canal (histórico) enxerga todos, como o envio sem canal', () => {
    const doA = modelo();
    expect(modeloDaMensagem(mensagem({ channel_id: null }), [doA])).toBe(doA);
  });

  it('outro nome não casa', () => {
    expect(
      modeloDaMensagem(mensagem(), [modelo({ name: 'boas_vindas' })])
    ).toBeNull();
  });

  it('vários idiomas: decide o CORPO', () => {
    const pt = modelo();
    const en = modelo({
      language: 'en_US',
      body_text: 'Hello {{1}}, your case has a new update.',
    });
    expect(modeloDaMensagem(mensagem(), [en, pt])).toBe(pt);
    expect(
      modeloDaMensagem(
        mensagem({ content_text: 'Hello John, your case has a new update.' }),
        [pt, en]
      )
    ).toBe(en);
  });

  it('vários idiomas e nenhum corpo que case (ou sem texto): nenhuma — nunca a primeira', () => {
    const pt = modelo();
    const en = modelo({
      language: 'en_US',
      body_text: 'Hello {{1}}, your case has a new update.',
    });
    expect(
      modeloDaMensagem(mensagem({ content_text: 'Texto livre' }), [pt, en])
    ).toBeNull();
    expect(
      modeloDaMensagem(mensagem({ content_text: undefined }), [pt, en])
    ).toBeNull();
  });
});

describe('corpoExplicaOTexto', () => {
  it('as variáveis valem qualquer trecho, inclusive vazio e com quebra de linha', () => {
    const corpo = 'Olá {{1}}, sua reunião é {{2}}.';
    expect(corpoExplicaOTexto(corpo, 'Olá Maria, sua reunião é amanhã.')).toBe(
      true
    );
    expect(corpoExplicaOTexto(corpo, 'Olá , sua reunião é .')).toBe(true);
    expect(
      corpoExplicaOTexto(
        corpo,
        'Olá Maria\nda Silva, sua reunião é hoje\nàs 10h.'
      )
    ).toBe(true);
    // A variável que ficou sem valor sai crua no corpo gravado: também casa.
    expect(corpoExplicaOTexto(corpo, 'Olá {{1}}, sua reunião é amanhã.')).toBe(
      true
    );
  });

  it('o literal fora do lugar não casa', () => {
    const corpo = 'Olá {{1}}, sua reunião é {{2}}.';
    expect(corpoExplicaOTexto(corpo, 'Oi Maria, sua reunião é amanhã.')).toBe(
      false
    );
    expect(corpoExplicaOTexto(corpo, 'Olá Maria, sua reunião é amanhã!')).toBe(
      false
    );
    expect(corpoExplicaOTexto(corpo, 'Olá Maria, amanhã.')).toBe(false);
  });

  it('o começo e o fim não se sobrepõem', () => {
    expect(corpoExplicaOTexto('ab{{1}}ba', 'aba')).toBe(false);
    expect(corpoExplicaOTexto('ab{{1}}ba', 'abba')).toBe(true);
  });

  it('corpo sem variável só casa com o texto igual', () => {
    expect(corpoExplicaOTexto('Bom dia!', 'Bom dia!')).toBe(true);
    expect(corpoExplicaOTexto('Bom dia!', 'Bom dia! ')).toBe(false);
  });

  it('muitas variáveis sobre um texto longo que NÃO casa: responde na hora', () => {
    const corpo =
      Array.from({ length: 12 }, (_, i) => `{{${i + 1}}}`).join(' ') + '!';
    const texto = 'a '.repeat(2000);
    const inicio = performance.now();
    expect(corpoExplicaOTexto(corpo, texto)).toBe(false);
    expect(performance.now() - inicio).toBeLessThan(200);
  });
});

describe('partesDoModelo — o que a bolha acrescenta', () => {
  it('sem modelo, ou modelo só de corpo: nada', () => {
    expect(partesDoModelo(null)).toBeNull();
    expect(partesDoModelo(modelo())).toBeNull();
  });

  it('cabeçalho de TEXTO, rodapé e botões', () => {
    const partes = partesDoModelo(
      modelo({
        header_type: 'text',
        header_content: ' Atualização do seu caso ',
        footer_text: 'Escritório Exemplo',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Quero falar' },
          {
            type: 'URL',
            text: 'Ver detalhes',
            url: 'https://exemplo.test/{{1}}',
          },
          {
            type: 'PHONE_NUMBER',
            text: 'Ligar',
            phone_number: '+5500000000000',
          },
          { type: 'COPY_CODE', text: 'Copiar código', example: 'ABC123' },
        ],
      })
    );
    expect(partes).toEqual({
      cabecalho: 'Atualização do seu caso',
      rodape: 'Escritório Exemplo',
      botoes: [
        { tipo: 'QUICK_REPLY', texto: 'Quero falar' },
        { tipo: 'URL', texto: 'Ver detalhes' },
        { tipo: 'PHONE_NUMBER', texto: 'Ligar' },
        { tipo: 'COPY_CODE', texto: 'Copiar código' },
      ],
    });
  });

  it('cabeçalho de texto COM variável fica de fora (o valor não é gravado)', () => {
    expect(
      partesDoModelo(
        modelo({ header_type: 'text', header_content: 'Olá, {{1}}' })
      )
    ).toBeNull();
    expect(
      partesDoModelo(
        modelo({
          header_type: 'TEXT',
          header_content: 'Processo {{1}}',
          footer_text: 'Rodapé',
        })
      )
    ).toEqual({ cabecalho: null, rodape: 'Rodapé', botoes: [] });
  });

  it('cabeçalho de MÍDIA não se desenha (a URL que saiu não é gravada)', () => {
    for (const tipo of ['image', 'video', 'document']) {
      expect(
        partesDoModelo(
          modelo({
            header_type: tipo,
            header_content: 'https://exemplo.test/a',
          })
        )
      ).toBeNull();
    }
  });

  it('botões vêm de JSONB: tipo desconhecido, sem rótulo ou fora de forma ficam de fora', () => {
    expect(
      partesDoModelo(
        modelo({
          buttons: [
            { type: 'quick_reply', text: 'Sim' },
            { type: 'OTP', text: 'Código' },
            { type: 'URL', text: '   ' },
            { type: 'URL' },
            null,
            'texto solto',
          ],
        })
      )
    ).toEqual({
      cabecalho: null,
      rodape: null,
      botoes: [{ tipo: 'QUICK_REPLY', texto: 'Sim' }],
    });
    expect(
      partesDoModelo(modelo({ buttons: { type: 'URL', text: 'x' } }))
    ).toBeNull();
  });
});
