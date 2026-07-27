// A guarda existe por causa de um arranjo deliberado: o CRM local roda
// contra a MESMA conta de produção, para poder desenvolver com o número e as
// conversas reais. Nesse arranjo, uma reaplicação disparada do localhost
// aponta o webhook do número do escritório para a máquina do desenvolvedor,
// ou troca o segredo que a produção espera. Nos dois casos a Evolution
// aceita, responde 200, e o número para de receber mensagem sem erro nenhum.
import { describe, expect, it } from 'vitest';

import { ehUrlAlcancavel, motivoParaRecusar, segredoDoHeader } from './webhook-url';

const PUBLICA = 'https://crm.cbadvogados.com/api/whatsapp/evolution/webhook';
const LOCAL = 'http://host.docker.internal:3000/api/whatsapp/evolution/webhook';
const SEGREDO = 'segredo-de-producao';

describe('ehUrlAlcancavel', () => {
  it('aceita endereço público', () => {
    for (const url of [
      PUBLICA,
      'https://api.cbadvogados.com',
      'http://vps.cbadvogados.com:3000',
      'https://82.25.76.63/webhook',
    ]) {
      expect(ehUrlAlcancavel(url), url).toBe(true);
    }
  });

  it('recusa o que só existe dentro de uma máquina', () => {
    for (const url of [
      LOCAL,
      'http://localhost:3000',
      'https://localhost',
      'http://127.0.0.1:3000',
      'http://[::1]:3000',
      'http://meu-mac.local:3000',
      'http://app.localhost:3000',
    ]) {
      expect(ehUrlAlcancavel(url), url).toBe(false);
    }
  });

  it('recusa faixa privada — a Evolution está em outro host', () => {
    for (const url of [
      'http://10.0.0.5:3000',
      'http://192.168.1.20:3000',
      'http://172.16.0.9:3000',
      'http://172.31.255.1:3000',
      'http://169.254.1.1:3000',
    ]) {
      expect(ehUrlAlcancavel(url), url).toBe(false);
    }
  });

  // 172.32 em diante é público: a faixa privada termina em 172.31.
  it('não confunde o limite da faixa 172', () => {
    expect(ehUrlAlcancavel('http://172.15.0.1:3000')).toBe(true);
    expect(ehUrlAlcancavel('http://172.32.0.1:3000')).toBe(true);
  });

  // `new URL('localhost:3000')` não lança — vira hostname vazio.
  it('vazio ou inválido não é alcançável', () => {
    for (const url of [null, undefined, '', 'não é url', 'localhost:3000']) {
      expect(ehUrlAlcancavel(url as string), String(url)).toBe(false);
    }
  });
});

describe('motivoParaRecusar', () => {
  const atual = { url: PUBLICA, secret: SEGREDO };

  it('deixa passar a reaplicação idêntica — é o caso normal', () => {
    expect(motivoParaRecusar(atual, { url: PUBLICA, secret: SEGREDO })).toBeNull();
  });

  // O caso que motivou a guarda.
  it('BARRA trocar URL pública por local', () => {
    const motivo = motivoParaRecusar(atual, { url: LOCAL, secret: SEGREDO });
    expect(motivo).toContain('NEXT_PUBLIC_SITE_URL');
  });

  // A mesma perda de mensagem, por outra variável: a Evolution entrega e a
  // produção responde 401 em tudo.
  it('BARRA trocar o segredo de um webhook público', () => {
    const motivo = motivoParaRecusar(atual, { url: PUBLICA, secret: 'outro' });
    expect(motivo).toContain('EVOLUTION_WEBHOOK_SECRET');
  });

  // A guarda não pode virar o problema: quem apontou o webhook para a
  // própria máquina por engano precisa conseguir devolvê-lo para produção.
  it('deixa passar o caminho de conserto (local -> público)', () => {
    expect(
      motivoParaRecusar({ url: LOCAL, secret: 'local' }, { url: PUBLICA, secret: SEGREDO }),
    ).toBeNull();
  });

  it('instância sem webhook aceita qualquer registro', () => {
    for (const vazio of [null, undefined, {}, { url: null }, { url: '' }]) {
      expect(motivoParaRecusar(vazio, { url: LOCAL, secret: 'x' }), JSON.stringify(vazio)).toBeNull();
    }
  });

  // Sem segredo registrado não há o que comparar — e recusar aqui travaria a
  // primeira reaplicação de uma instância antiga.
  it('sem segredo registrado, só a URL manda', () => {
    expect(motivoParaRecusar({ url: PUBLICA }, { url: PUBLICA, secret: 'novo' })).toBeNull();
    expect(motivoParaRecusar({ url: PUBLICA }, { url: LOCAL, secret: 'novo' })).not.toBeNull();
  });
});

describe('segredoDoHeader', () => {
  it('tira o prefixo Bearer em qualquer caixa', () => {
    expect(segredoDoHeader('Bearer abc123')).toBe('abc123');
    expect(segredoDoHeader('bearer  abc123')).toBe('abc123');
    expect(segredoDoHeader('abc123')).toBe('abc123');
  });

  it('vazio vira null, para não comparar com string vazia', () => {
    for (const v of [null, undefined, '', '   ', 'Bearer ']) {
      expect(segredoDoHeader(v as string), JSON.stringify(v)).toBeNull();
    }
  });
});
