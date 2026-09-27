import { describe, expect, it } from 'vitest';

import { basenameFromUrl } from '@/lib/media/filename';
import { caminhoDaCopia } from './copiar';

// O caminho da cópia do acervo é ÚNICO por envio (Codex, PR #314): dois
// leads no mesmo milissegundo não podem cair no mesmo destino, e o nome do
// arquivo continua recuperável a partir do caminho.
describe('caminhoDaCopia', () => {
  it('mesmo milissegundo, sortes diferentes → caminhos diferentes', () => {
    const a = caminhoDaCopia('conta-1', 'Boas-vindas.ogg', 1790000000000, 1);
    const b = caminhoDaCopia('conta-1', 'Boas-vindas.ogg', 1790000000000, 2);
    expect(a).not.toBe(b);
  });

  it('forma: account-<id>/<carimbo de 19 dígitos>-<nome>.<ext>', () => {
    expect(caminhoDaCopia('conta-1', 'Boas-vindas.ogg', 1790000000000, 42)).toBe(
      'account-conta-1/1790000000000000042-Boas-vindas.ogg',
    );
  });

  it('o nome do arquivo continua saindo do caminho (basenameFromUrl)', () => {
    const caminho = caminhoDaCopia('conta-1', 'Boas-vindas.ogg', 1790000000000, 987654);
    expect(basenameFromUrl(`https://x.supabase.co/storage/v1/object/public/chat-media/${caminho}`)).toBe(
      'Boas-vindas.ogg',
    );
  });
});
