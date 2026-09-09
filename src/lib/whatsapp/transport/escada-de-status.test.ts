import { describe, expect, it } from 'vitest';
import { aceitamAvancoPara, aplicarRecibos } from './escada-de-status';

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

  it('failed nunca entra na lista de quem aceita avanço (tem regra própria na rota)', () => {
    for (const novo of ['sent', 'delivered', 'read'] as const) {
      expect(aceitamAvancoPara(novo)).not.toContain('failed');
    }
    expect(aplicarRecibos('failed', ['delivered', 'read'])).toBe('failed');
  });
});
