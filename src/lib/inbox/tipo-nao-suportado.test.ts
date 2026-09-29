import { describe, expect, it } from 'vitest';

import { PREFIXO_DE_TIPO_NAO_SUPORTADO } from '@/lib/ia-agentes/quem-responde';
import { rotuloDeTipoNaoLido } from '@/lib/whatsapp/transport/evolution-inbound';
import { tipoNaoSuportado } from './tipo-nao-suportado';

describe('tipoNaoSuportado', () => {
  it('lê o tipo do rótulo que a Meta e a Evolution gravam', () => {
    expect(tipoNaoSuportado(`${PREFIXO_DE_TIPO_NAO_SUPORTADO} contacts]`)).toBe('contacts');
    // O rótulo da Evolution (1060) é lido pela MESMA função da tela.
    expect(tipoNaoSuportado(rotuloDeTipoNaoLido({ pollCreationMessageV3: {} }))).toBe('pollCreationMessageV3');
  });

  it('texto comum não é rótulo', () => {
    expect(tipoNaoSuportado('Olá')).toBeNull();
    expect(tipoNaoSuportado(null)).toBeNull();
    expect(tipoNaoSuportado('')).toBeNull();
  });

  it('rótulo sem tipo devolve vazio, não null', () => {
    expect(tipoNaoSuportado(`${PREFIXO_DE_TIPO_NAO_SUPORTADO}]`)).toBe('');
  });
});
