import { describe, expect, it } from 'vitest';
import {
  ACEITA_FALHA,
  aceitamAvancoPara,
  aceitamORecibo,
  aplicarRecibos,
} from './escada-de-status';

describe('escada de status do recibo', () => {
  it('⚠️ a sequência medida em 09/09/2026 (Evolution 2.4) termina em delivered, não em sent', () => {
    // SERVER_ACK, DELIVERY_ACK, SERVER_ACK, DELIVERY_ACK, SERVER_ACK — o que a
    // Evolution emitiu para a mensagem 3EB02D519E5641B4C9918D em 9 s. Sem a
    // escada, o último rebaixava a bolha para um ✓.
    expect(aplicarRecibos('sent', ['sent', 'delivered', 'sent', 'delivered', 'sent'])).toBe(
      'delivered',
    );
  });

  it('read é o topo: nada depois dele rebaixa', () => {
    expect(aplicarRecibos('sent', ['delivered', 'read', 'sent', 'delivered'])).toBe('read');
  });

  it('a linha nasce "sent" no envio pelo CRM; SERVER_ACK não mexe nela', () => {
    expect(aceitamAvancoPara('sent')).toEqual(['sending']);
    expect(aplicarRecibos('sent', ['sent'])).toBe('sent');
  });

  it('delivered avança de sending e de sent; read, de qualquer degrau abaixo', () => {
    expect(aceitamAvancoPara('delivered')).toEqual(['sending', 'sent']);
    expect(aceitamAvancoPara('read')).toEqual(['sending', 'sent', 'delivered']);
  });

  it('failed nunca entra na lista de quem aceita avanço (tem regra própria)', () => {
    for (const novo of ['sent', 'delivered', 'read'] as const) {
      expect(aceitamAvancoPara(novo)).not.toContain('failed');
    }
  });
});

describe('o recibo de falha', () => {
  it('só é crível antes da entrega', () => {
    expect(aceitamORecibo('failed')).toEqual(ACEITA_FALHA);
    expect(ACEITA_FALHA).toEqual(['sending', 'sent']);
  });

  it('⚠️ falha atrasada NÃO pinta de vermelho o que já foi entregue ou lido', () => {
    expect(aplicarRecibos('sent', ['delivered', 'failed'])).toBe('delivered');
    expect(aplicarRecibos('sent', ['read', 'failed'])).toBe('read');
  });

  it('falha que chega a tempo vale, e nem o sent nem o delivered depois dela a desfazem', () => {
    expect(aplicarRecibos('sent', ['failed'])).toBe('failed');
    expect(aplicarRecibos('sent', ['failed', 'delivered', 'sent'])).toBe('failed');
    expect(aplicarRecibos('failed', ['delivered'])).toBe('failed');
  });

  it('⚠️ o read tira da falha: a sequência medida em 24–25/09/2026 termina em read', () => {
    // O ERROR gravou primeiro, junto com os outros recibos, e o READ chegou
    // segundos depois. Com a falha final, a bolha dizia "não entregue, envie
    // de novo" sobre mensagem que o cliente leu e respondeu.
    expect(aplicarRecibos('sent', ['sent', 'failed', 'delivered', 'sent', 'read'])).toBe('read');
    expect(aplicarRecibos('failed', ['read'])).toBe('read');
  });

  it('depois do read, uma falha atrasada não volta a pintar de vermelho', () => {
    expect(aplicarRecibos('sent', ['failed', 'read', 'failed'])).toBe('read');
  });

  it('para o sent e o delivered, aceitamORecibo é a própria escada; o read aceita também a falha', () => {
    for (const novo of ['sent', 'delivered'] as const) {
      expect(aceitamORecibo(novo)).toEqual(aceitamAvancoPara(novo));
      expect(aceitamORecibo(novo)).not.toContain('failed');
    }
    expect(aceitamORecibo('read')).toEqual([...aceitamAvancoPara('read'), 'failed']);
  });
});

describe('a desordem da Meta (23/09/2026)', () => {
  it('⚠️ sent e delivered processados ao contrário terminam em delivered', () => {
    // A interativa de teste recebeu dois PATCH com 39 ms de diferença e
    // ficou em `sent`: o `sent` gravado por último, por cima do outro. Com a
    // escada, a ordem não importa.
    expect(aplicarRecibos('sent', ['delivered', 'sent'])).toBe('delivered');
    expect(aplicarRecibos('sent', ['sent', 'delivered'])).toBe('delivered');
  });

  it('read sem delivered antes (a doc da Meta: com a conversa aberta, o delivered não é enviado)', () => {
    expect(aplicarRecibos('sent', ['read', 'delivered', 'sent'])).toBe('read');
  });
});
