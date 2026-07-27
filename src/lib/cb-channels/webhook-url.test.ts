// A guarda existe por causa de um arranjo deliberado: o CRM local roda
// contra a MESMA conta de produção, para poder desenvolver com o número e as
// conversas reais. Nesse arranjo, uma reaplicação disparada do localhost
// aponta o webhook do número do escritório para a máquina do desenvolvedor,
// ou troca o segredo que a produção espera. Nos dois casos a Evolution
// aceita, responde 200, e o número para de receber mensagem sem erro nenhum.
//
// Metade destes casos protege as ISENÇÕES, não as regras: uma guarda que
// tranca o operador para fora do conserto é pior que a falha que ela evita.
import { describe, expect, it } from 'vitest';

import { ehUrlAlcancavel, motivoParaRecusar, segredoDoHeader } from './webhook-url';

const PROD_ORIGEM = 'https://crm.cbadvogados.com';
const PUBLICA = `${PROD_ORIGEM}/api/whatsapp/evolution/webhook`;
const LOCAL = 'http://host.docker.internal:3000/api/whatsapp/evolution/webhook';
const SEGREDO = 'segredo-de-producao';

describe('ehUrlAlcancavel', () => {
  it('aceita endereço público', () => {
    for (const url of [
      PUBLICA,
      'https://api.cbadvogados.com',
      'http://vps.cbadvogados.com:3000',
      'https://82.25.76.63/webhook',
      'https://crm.cbadvogados.com.', // FQDN absoluto continua público
      'https://a1b2c3.trycloudflare.com/webhook',
    ]) {
      expect(ehUrlAlcancavel(url), url).toBe(true);
    }
  });

  it('recusa o que só existe dentro de uma máquina', () => {
    for (const url of [
      LOCAL,
      'http://localhost:3000',
      'https://localhost',
      'http://localhost.:3000', // ponto final é o mesmo host
      'http://host.docker.internal.:3000',
      'http://127.0.0.1:3000',
      'http://meu-mac.local:3000',
      'http://app.localhost:3000',
    ]) {
      expect(ehUrlAlcancavel(url), url).toBe(false);
    }
  });

  it('recusa faixa privada IPv4 — a Evolution está em outro host', () => {
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

  it('recusa IPv6 local, ULA e link-local', () => {
    for (const url of [
      'http://[::1]:3000',
      'http://[::]:3000',
      'http://[fd12:3456::1]:3000',
      'http://[fc00::1]:3000',
      'http://[fe80::1]:3000',
      'http://[::ffff:7f00:1]:3000',
    ]) {
      expect(ehUrlAlcancavel(url), url).toBe(false);
    }
  });

  it('aceita IPv6 público', () => {
    expect(ehUrlAlcancavel('http://[2001:db8::1]:3000')).toBe(true);
  });

  // 172.32 em diante é público: a faixa privada termina em 172.31.
  it('não confunde o limite da faixa 172', () => {
    expect(ehUrlAlcancavel('http://172.15.0.1:3000')).toBe(true);
    expect(ehUrlAlcancavel('http://172.32.0.1:3000')).toBe(true);
  });

  // Nome de uma palavra só resolve dentro de uma LAN.
  it('recusa hostname de rótulo único', () => {
    expect(ehUrlAlcancavel('http://meu-linux:3000')).toBe(false);
    expect(ehUrlAlcancavel('http://crm:3000')).toBe(false);
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
  const daProducao = { origemDoPedido: PROD_ORIGEM };
  const doLocal = { origemDoPedido: 'http://localhost:3000' };

  // O clique que o operador precisa dar HOJE, para registrar
  // MESSAGES_DELETE/MESSAGES_EDITED. Não pode ser barrado por nada.
  it('deixa passar a reaplicação idêntica', () => {
    expect(motivoParaRecusar(atual, { url: PUBLICA, secret: SEGREDO }, daProducao)).toBeNull();
    expect(motivoParaRecusar(atual, { url: PUBLICA, secret: SEGREDO }, doLocal)).toBeNull();
  });

  it('BARRA trocar URL pública por local', () => {
    expect(motivoParaRecusar(atual, { url: LOCAL, secret: SEGREDO }, doLocal)).toContain(
      'NEXT_PUBLIC_SITE_URL',
    );
  });

  it('BARRA trocar o segredo a partir de OUTRO host', () => {
    expect(motivoParaRecusar(atual, { url: PUBLICA, secret: 'outro' }, doLocal)).toContain(
      'EVOLUTION_WEBHOOK_SECRET',
    );
  });

  // ISENÇÃO CRÍTICA: rotação de segredo. Quando o `crm.env` da VPS muda, a
  // produção passa a responder 401 a tudo e o conserto é reaplicar com o
  // segredo novo. Barrar aqui mandava DESFAZER a rotação — sem saída pela
  // interface.
  it('deixa a PRODUÇÃO reaplicar o próprio segredo (rotação)', () => {
    expect(motivoParaRecusar(atual, { url: PUBLICA, secret: 'novo' }, daProducao)).toBeNull();
  });

  it('sem saber de onde veio o pedido, o segredo continua protegido', () => {
    expect(motivoParaRecusar(atual, { url: PUBLICA, secret: 'novo' }, {})).not.toBeNull();
  });

  // A guarda não pode virar o problema: quem apontou o webhook para a
  // própria máquina por engano precisa conseguir devolvê-lo para produção.
  it('deixa passar o caminho de conserto (local -> público)', () => {
    expect(
      motivoParaRecusar({ url: LOCAL, secret: 'local' }, { url: PUBLICA, secret: SEGREDO }, doLocal),
    ).toBeNull();
  });

  it('instância sem webhook aceita qualquer registro', () => {
    for (const vazio of [null, undefined, {}, { url: null }, { url: '' }]) {
      expect(
        motivoParaRecusar(vazio, { url: LOCAL, secret: 'x' }, doLocal),
        JSON.stringify(vazio),
      ).toBeNull();
    }
  });

  it('sem segredo registrado, só a URL manda', () => {
    expect(motivoParaRecusar({ url: PUBLICA }, { url: PUBLICA, secret: 'novo' }, doLocal)).toBeNull();
    expect(motivoParaRecusar({ url: PUBLICA }, { url: LOCAL, secret: 'novo' }, doLocal)).not.toBeNull();
  });

  // ⚠️ O valor que a PRODUÇÃO realmente produz. O servidor standalone do
  // Next escuta em HOSTNAME=0.0.0.0, então `new URL(request.url).origin` dá
  // `http://0.0.0.0:3000` — foi assim que a isenção de rotação nasceu morta.
  // Hoje a origem vem do header Host; este caso trava a regressão.
  it('origem 0.0.0.0 NÃO conta como produção', () => {
    expect(
      motivoParaRecusar(atual, { url: PUBLICA, secret: 'novo' }, { origemDoPedido: 'http://0.0.0.0:3000' }),
    ).not.toBeNull();
  });

  // Leitura falhada não pode desarmar a guarda: o GET tem teto de 15s e o
  // laço do QR consulta a cada 5s, então "timeout" é evento corriqueiro.
  describe('quando não foi possível ler o webhook atual', () => {
    const doLocalCego = { leituraFalhou: true, origemDoPedido: 'http://localhost:3000' };
    const daProducaoCego = { leituraFalhou: true, origemDoPedido: PROD_ORIGEM };

    it('BARRA registrar URL local', () => {
      expect(motivoParaRecusar(null, { url: LOCAL, secret: 'x' }, doLocalCego)).not.toBeNull();
    });

    // Sem saber o segredo registrado, não dá para compará-lo — o único sinal
    // que resta é de onde veio o clique.
    it('BARRA pedido vindo de fora, mesmo com URL pública', () => {
      expect(motivoParaRecusar(null, { url: PUBLICA, secret: 'x' }, doLocalCego)).not.toBeNull();
    });

    it('deixa a produção reaplicar a si mesma', () => {
      expect(motivoParaRecusar(null, { url: PUBLICA, secret: SEGREDO }, daProducaoCego)).toBeNull();
    });
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
