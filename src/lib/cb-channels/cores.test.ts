import { describe, expect, it } from 'vitest';

import { PALETA_DE_CANAIS, coresPorCanal, corDoCanal } from './cores';
import type { CbChannel } from './repo';

function canal(id: string, created_at: string, is_default = false): CbChannel {
  return { id, created_at, is_default } as unknown as CbChannel;
}

describe('coresPorCanal', () => {
  it('distribui por created_at, NÃO pela ordem do array', () => {
    // `listChannels` ordena `is_default DESC, created_at ASC`. Se a cor
    // saísse do índice do array, marcar o mais NOVO como padrão o jogaria
    // para a frente e repintaria as conversas do escritório inteiro.
    const comercialPrimeiro = [
      canal('comercial', '2026-08-29T00:00:00Z'),
      canal('juridico', '2026-08-31T00:00:00Z'),
    ];
    const juridicoVirouPadrao = [
      canal('juridico', '2026-08-31T00:00:00Z', true),
      canal('comercial', '2026-08-29T00:00:00Z'),
    ];

    expect(coresPorCanal(comercialPrimeiro).get('comercial')).toEqual(
      coresPorCanal(juridicoVirouPadrao).get('comercial'),
    );
    expect(coresPorCanal(comercialPrimeiro).get('juridico')).toEqual(
      coresPorCanal(juridicoVirouPadrao).get('juridico'),
    );
  });

  it('conexão NOVA não recolore as antigas', () => {
    const antes = coresPorCanal([
      canal('a', '2026-08-29T00:00:00Z'),
      canal('b', '2026-08-31T00:00:00Z'),
    ]);
    const depois = coresPorCanal([
      canal('a', '2026-08-29T00:00:00Z'),
      canal('b', '2026-08-31T00:00:00Z'),
      canal('c', '2026-09-02T00:00:00Z'),
    ]);

    expect(depois.get('a')).toEqual(antes.get('a'));
    expect(depois.get('b')).toEqual(antes.get('b'));
    expect(depois.get('c')).toBeDefined();
  });

  it('dois canais distintos recebem cores distintas', () => {
    const cores = coresPorCanal([
      canal('a', '2026-08-29T00:00:00Z'),
      canal('b', '2026-08-31T00:00:00Z'),
    ]);
    expect(cores.get('a')).not.toEqual(cores.get('b'));
  });

  it('created_at empatado desempata pelo id, não pela ordem recebida', () => {
    const mesmoInstante = '2026-08-29T00:00:00Z';
    const numaOrdem = coresPorCanal([
      canal('zzz', mesmoInstante),
      canal('aaa', mesmoInstante),
    ]);
    const naOutra = coresPorCanal([
      canal('aaa', mesmoInstante),
      canal('zzz', mesmoInstante),
    ]);
    expect(numaOrdem.get('aaa')).toEqual(naOutra.get('aaa'));
    expect(numaOrdem.get('zzz')).toEqual(naOutra.get('zzz'));
  });

  it('acima do tamanho da paleta as cores repetem em vez de sumir', () => {
    const muitos = Array.from({ length: PALETA_DE_CANAIS.length + 2 }, (_, i) =>
      canal(`c${i}`, `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
    );
    const cores = coresPorCanal(muitos);
    expect(cores.size).toBe(muitos.length);
    expect(cores.get(`c${PALETA_DE_CANAIS.length}`)).toEqual(cores.get('c0'));
  });

  it('a paleta usa classes literais — sem interpolação o Tailwind não gera', () => {
    for (const cor of PALETA_DE_CANAIS) {
      expect(cor.borda).toMatch(/^border-[a-z]+-\d{3}$/);
      expect(cor.ponto).toMatch(/^bg-[a-z]+-\d{3}$/);
      expect(cor.texto).toContain('dark:');
    }
  });
});

describe('corDoCanal', () => {
  it('id que não resolve devolve null — sem cor de queda', () => {
    // Uma cor de queda afirmaria um canal que ninguém sabe qual é: em
    // registro anterior ao carimbo a mensagem pode ter saído por outro
    // número (mesma razão do travessão do `ChannelCell`).
    const cores = coresPorCanal([canal('a', '2026-08-29T00:00:00Z')]);
    expect(corDoCanal(cores, 'apagado')).toBeNull();
    expect(corDoCanal(cores, null)).toBeNull();
    expect(corDoCanal(cores, undefined)).toBeNull();
    expect(corDoCanal(cores, 'a')).toEqual(PALETA_DE_CANAIS[0]);
  });
});
