import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';
import { lerResultadoDoTeste, type RespostaDoEndereco } from '@/lib/webhooks/resultado-do-teste';

import { TrechoDaResposta } from './trecho-da-resposta';

// ============================================================
// O que o endereço respondeu ao "Enviar teste", como a TELA o desenha.
//
// Não há endereço de saída cadastrado nesta instalação para clicar no botão
// de verdade, e o corpo vem de um sistema de FORA — então o que estes testes
// cobram é o desenho a partir do parse real: o texto sai ESCAPADO (nunca
// HTML), e os três casos sem texto (vazio, binário, cortado) dizem o que
// houve em vez de mostrar uma caixa em branco.
// ============================================================

function desenhar(resposta: RespostaDoEndereco, messages: AbstractIntlMessages = ptBR) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-BR" messages={messages} timeZone="America/Sao_Paulo">
      <TrechoDaResposta resposta={resposta} />
    </NextIntlClientProvider>
  );
}

/** Como a rota responderia, passando pelo parse da tela. */
function daRota(resposta: unknown): RespostaDoEndereco {
  const lido = lerResultadoDoTeste({ ok: false, status: 404, motivo: 'http', ms: 90, resposta });
  if (!lido?.resposta) throw new Error('o parse descartou o trecho');
  return lido.resposta;
}

describe('TrechoDaResposta', () => {
  it('404 do n8n: o corpo aparece, recolhido, sob "O que o endereço respondeu"', () => {
    const html = desenhar(
      daRota({ corpo: '{"code":404,"message":"The requested webhook is not registered."}', cortado: false })
    );
    expect(html).toContain('<details');
    expect(html).toContain('O que o endereço respondeu');
    expect(html).toContain('<pre');
    expect(html).toContain('The requested webhook is not registered.');
    expect(html).not.toContain('KB da resposta');
  });

  it('⚠️ o corpo vem de FORA e sai como texto escapado, nunca como HTML', () => {
    const html = desenhar(daRota({ corpo: '<img src=x onerror="alert(1)"><b>oi</b>', cortado: false }));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>oi');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('cortado: o aviso diz o teto em KB', () => {
    const html = desenhar(daRota({ corpo: 'a'.repeat(2048), cortado: true }));
    expect(html).toContain('Mostrando só os primeiros 2 KB da resposta.');
  });

  it('sem corpo: diz isso, sem uma caixa em branco', () => {
    const html = desenhar(daRota({ corpo: '', cortado: false }));
    expect(html).toContain('O endereço respondeu sem corpo.');
    expect(html).not.toContain('<pre');
  });

  it('binário: diz que não é mostrado', () => {
    const html = desenhar(daRota({ corpo: null, cortado: false, binario: true }));
    expect(html).toContain('A resposta não é texto');
    expect(html).not.toContain('<pre');
  });

  it('em inglês também (as quatro chaves existem nos dois dicionários)', () => {
    expect(desenhar(daRota({ corpo: 'x', cortado: true }), en)).toContain(
      'Showing only the first 2 KB of the response.'
    );
    expect(desenhar(daRota({ corpo: '', cortado: false }), en)).toContain('The address answered with no body.');
    expect(desenhar(daRota({ corpo: null, binario: true }), en)).toContain('The response is not text');
  });
});
