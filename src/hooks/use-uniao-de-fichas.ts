'use client';

import { useEffect, useState } from 'react';

import {
  falhaDaUniao,
  lerPrevia,
  lerResultado,
  type FalhaDaUniao,
  type PreviaDaUniao,
  type ResultadoDaUniao,
} from '@/lib/contacts/uniao';
import { createClient } from '@/lib/supabase/client';

/** O par NESTE sentido — a prévia de "A fica" não vale para "B fica". */
function chaveDoPar(fica: string, sai: string): string {
  return `${fica}>${sai}`;
}

export interface EstadoDaPrevia {
  previa: PreviaDaUniao | null;
  carregando: boolean;
  /** Por que a prévia não veio. NULO enquanto carrega ou quando veio. */
  falha: FalhaDaUniao | null;
}

/**
 * A prévia da união (1092) do par `fica` ← `sai`: o que a união vai fazer,
 * sem gravar nada (`cb_previa_da_uniao`, só admin).
 *
 * ⚠️ Carimbada com o PAR e o sentido (`{ de }`), e `carregando` DERIVADO: o
 * "Trocar" muda o sentido e, até a resposta nova chegar, a tela mostraria o
 * plano do sentido anterior — cards "apagados" que vão ficar.
 */
export function usePreviaDaUniao(
  fica: string | null,
  sai: string | null
): EstadoDaPrevia {
  const [estado, setEstado] = useState<{
    de: string | null;
    previa: PreviaDaUniao | null;
    falha: FalhaDaUniao | null;
  }>({ de: null, previa: null, falha: null });

  useEffect(() => {
    if (!fica || !sai) return;
    let vivo = true;
    const de = chaveDoPar(fica, sai);
    void createClient()
      .rpc('cb_previa_da_uniao', { p_fica: fica, p_sai: sai })
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) {
          console.error('[uniao] a prévia falhou:', error.message);
          setEstado({ de, previa: null, falha: falhaDaUniao(error) });
          return;
        }
        const previa = lerPrevia(data);
        setEstado({ de, previa, falha: previa ? null : 'falhou' });
      });
    return () => {
      vivo = false;
    };
  }, [fica, sai]);

  const doParAtual = !!fica && !!sai && estado.de === chaveDoPar(fica, sai);
  return {
    previa: doParAtual ? estado.previa : null,
    carregando: !!fica && !!sai && !doParAtual,
    falha: doParAtual ? estado.falha : null,
  };
}

/**
 * UNE as fichas (`cb_unir_fichas`): `sai` é apagada e tudo dela passa para
 * `fica`, numa transação do banco. Recusa vira motivo; nunca lança.
 *
 * ⚠️ Resposta SEM a forma esperada, mas sem erro, é união FEITA (o banco
 * confirmou): devolve a ficha que fica sem a conversa — quem chama recarrega
 * a página em vez de dizer que falhou.
 */
export async function unirFichas(
  fica: string,
  sai: string
): Promise<
  { ok: true; resultado: ResultadoDaUniao } | { ok: false; falha: FalhaDaUniao }
> {
  try {
    const { data, error } = await createClient().rpc('cb_unir_fichas', {
      p_fica: fica,
      p_sai: sai,
    });
    if (error) {
      console.error('[uniao] a união foi recusada:', error.message);
      return { ok: false, falha: falhaDaUniao(error) };
    }
    return {
      ok: true,
      resultado: lerResultado(data) ?? {
        fusaoId: '',
        ficha: fica,
        conversa: null,
      },
    };
  } catch (err) {
    console.error('[uniao] a união estourou:', err);
    return { ok: false, falha: 'falhou' };
  }
}
