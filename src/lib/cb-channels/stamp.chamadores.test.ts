import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// A entrada grava o canal NO PRÓPRIO insert, com a rede de segurança da FK
// (`gravarComCanal`, em stamp.ts). Dois retrocessos que não quebram build nem
// teste de comportamento:
//  - um merge do upstream que devolva o insert cru, sem `channel_id` — a
//    janela de 24h por número (janela-24h.ts) passa a ler a mensagem do
//    cliente como vinda de outro número;
//  - alguém "simplificar" de volta para o UPDATE separado
//    `stampMessageChannel`, que engolia a falha e deixava a mensagem sem
//    número (achado do Codex no PR #192).
// Os dois caminhos de mensagem do CLIENTE no WhatsApp ficam pinados. O
// Instagram e o grupo já nascem carimbados no insert, por outro caminho.
// ============================================================

const raiz = path.join(__dirname, '..', '..');

/** Fonte sem comentários: os arquivos citam os nomes ao EXPLICAR a decisão. */
function fonte(relativo: string): string {
  return fs
    .readFileSync(path.join(raiz, relativo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const CAMINHOS = [
  'app/api/whatsapp/webhook/route.ts',
  'lib/whatsapp/inbound-store.ts',
];

describe('entrada de mensagem do cliente: canal no próprio insert', () => {
  for (const arquivo of CAMINHOS) {
    it(`${arquivo} grava por gravarComCanal e não carimba depois`, () => {
      const f = fonte(arquivo);
      expect(f).toContain('gravarComCanal(');
      expect(f).toContain('channel_id: canal,');
      expect(f).not.toContain('stampMessageChannel(');
    });
  }
});
