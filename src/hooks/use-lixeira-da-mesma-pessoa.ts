'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  lerItensDaMesmaPessoa,
  lerPreviaDoRestaurarEUnir,
  lerRestaurarEUnir,
  recusaDoErro,
  type ItemDaMesmaPessoa,
  type PreviaDoRestaurarEUnir,
  type RecusaDoRestaurarEUnir,
  type RespostaDoRestaurarEUnir,
} from '@/lib/contacts/restaurar-e-unir';
import { createClient } from '@/lib/supabase/client';

// ============================================================
// "Restaurar e unir" (1101, a Fase 4 da Lixeira) vista pelo navegador: a
// leitura da faixa, a prévia e a chamada. A receita (trava, identidade
// provisória, volta, união) mora nas funções do banco, que conferem admin e
// suspensão por dentro; a leitura do que elas devolvem mora em
// `src/lib/contacts/restaurar-e-unir.ts`.
//
// ⚠️ O supabase-js DEVOLVE `error`, não lança — toda chamada confere. E
// nenhuma função daqui lança: a tela recebe um motivo e o traduz.
// ============================================================

/**
 * A recusa que o app não sabe nomear (cai em `falhou`): o código e a
 * mensagem que o banco devolveu vão ao console — sem eles ninguém descobre o
 * que foi, e a tela só diz "não deu para confirmar".
 */
function avisarRecusaSemFrase(onde: string, recusa: RecusaDoRestaurarEUnir, bruto: unknown) {
  if (recusa.motivo !== 'falhou') return;
  const o = bruto && typeof bruto === 'object' ? (bruto as Record<string, unknown>) : {};
  console.error(`[lixeira] ${onde} recusou sem frase própria:`, { codigo: o.codigo, motivo: o.motivo });
}

/**
 * As fichas da Lixeira da MESMA pessoa que a ficha aberta
 * (`cb_lixeira_da_mesma_pessoa`: telefone canônico, BSUID ou Instagram).
 *
 * NULO = não sei (desligado, carregando ou falhou): a faixa CALA, nunca
 * afirma "nada na Lixeira". `ativo` falso (quem não é admin) nem pergunta —
 * o banco devolveria vazio de qualquer jeito.
 *
 * ⚠️ Carimbado com a ficha (`{ de }`): o fio não remonta ao trocar de
 * cliente, e a faixa do anterior apareceria na conversa do novo, com o
 * "Restaurar e unir" apontando para a ficha errada.
 */
export function useItensDaMesmaPessoa(
  contatoId: string | null,
  ativo: boolean,
  /** O token de resync da página (voltar à aba, reconexão). */
  resyncToken: number = 0,
): ItemDaMesmaPessoa[] | null {
  const [estado, setEstado] = useState<{ de: string | null; itens: ItemDaMesmaPessoa[] | null }>({
    de: null,
    itens: null,
  });

  useEffect(() => {
    if (!ativo || !contatoId) return;
    let vivo = true;
    void (async () => {
      let itens: ItemDaMesmaPessoa[] | null = null;
      try {
        const { data, error } = await createClient().rpc('cb_lixeira_da_mesma_pessoa', {
          p_contato: contatoId,
        });
        if (error) {
          console.error('[lixeira] a faixa da mesma pessoa falhou:', error.message);
        } else {
          itens = lerItensDaMesmaPessoa(data);
          if (!itens) console.error('[lixeira] a faixa da mesma pessoa voltou numa forma inesperada');
        }
      } catch (err) {
        console.error('[lixeira] a faixa da mesma pessoa estourou:', err);
      }
      // A recarga que falha CALA a faixa (nula): o item pode ter saído.
      if (vivo) setEstado({ de: contatoId, itens });
    })();
    return () => {
      vivo = false;
    };
  }, [contatoId, ativo, resyncToken]);

  return ativo && contatoId !== null && estado.de === contatoId ? estado.itens : null;
}

export interface EstadoDaPreviaDoRestaurarEUnir {
  /** O que a volta e a união vão fazer. NULO enquanto carrega ou quando não veio. */
  previa: PreviaDoRestaurarEUnir | null;
  /** Por que a prévia não veio (a recusa do banco, ou `falhou`). */
  recusa: RecusaDoRestaurarEUnir | null;
  carregando: boolean;
  tentarDeNovo: () => void;
}

/**
 * A prévia (`cb_previa_restaurar_e_unir`): a volta e a união feitas num
 * subbloco que o banco desfaz — nada fica gravado. Sem ela, sem botão.
 *
 * ⚠️ Carimbada com o item, a ficha que fica e a tentativa (`{ de }`), e
 * `carregando` DERIVADO (seção 8c).
 */
export function usePreviaDoRestaurarEUnir(
  itemId: string | null,
  fica: string | null,
): EstadoDaPreviaDoRestaurarEUnir {
  const chave = itemId && fica ? `${itemId}>${fica}` : null;
  const [tentativa, setTentativa] = useState(0);
  const [estado, setEstado] = useState<{
    de: string | null;
    previa: PreviaDoRestaurarEUnir | null;
    recusa: RecusaDoRestaurarEUnir | null;
  }>({ de: null, previa: null, recusa: null });

  useEffect(() => {
    if (!itemId || !fica) return;
    let vivo = true;
    const de = `${itemId}>${fica}#${tentativa}`;
    void (async () => {
      try {
        const { data, error } = await createClient().rpc('cb_previa_restaurar_e_unir', {
          p_item: itemId,
          p_fica: fica,
        });
        if (!vivo) return;
        if (error) {
          console.error('[lixeira] a prévia de restaurar e unir foi recusada:', error.message);
          setEstado({ de, previa: null, recusa: recusaDoErro(error) });
          return;
        }
        const resposta = lerPreviaDoRestaurarEUnir(data);
        if (!resposta) {
          console.error('[lixeira] a prévia de restaurar e unir voltou numa forma inesperada');
          setEstado({ de, previa: null, recusa: recusaDoErro(null) });
          return;
        }
        if (!resposta.ok) avisarRecusaSemFrase('a prévia de restaurar e unir', resposta.recusa, data);
        setEstado(
          resposta.ok
            ? { de, previa: resposta.previa, recusa: null }
            : { de, previa: null, recusa: resposta.recusa },
        );
      } catch (err) {
        console.error('[lixeira] a prévia de restaurar e unir estourou:', err);
        if (vivo) setEstado({ de, previa: null, recusa: recusaDoErro(null) });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [itemId, fica, tentativa]);

  const deAgora = chave ? `${chave}#${tentativa}` : null;
  const atual = deAgora !== null && estado.de === deAgora;
  const tentarDeNovo = useCallback(() => setTentativa((n) => n + 1), []);
  return {
    previa: atual ? estado.previa : null,
    recusa: atual ? estado.recusa : null,
    carregando: deAgora !== null && !atual,
    tentarDeNovo,
  };
}

/**
 * Restaura o item e o une à ficha que fica (`cb_restaurar_e_unir`), numa
 * transação do banco. Recusa vira motivo; nunca lança.
 *
 * ⚠️ Resposta SEM a forma esperada é `falhou` (ao contrário de `unirFichas`):
 * a recusa desta função volta como dado, sem erro, e não dá para afirmar que
 * uniu. O texto de `falhou` manda conferir.
 */
export async function restaurarEUnir(itemId: string, fica: string): Promise<RespostaDoRestaurarEUnir> {
  try {
    const { data, error } = await createClient().rpc('cb_restaurar_e_unir', {
      p_item: itemId,
      p_fica: fica,
    });
    if (error) {
      console.error('[lixeira] restaurar e unir foi recusado:', error.message);
      return { ok: false, recusa: recusaDoErro(error) };
    }
    const resposta = lerRestaurarEUnir(data);
    if (!resposta) {
      console.error('[lixeira] restaurar e unir voltou numa forma inesperada');
      return { ok: false, recusa: recusaDoErro(null) };
    }
    if (!resposta.ok) avisarRecusaSemFrase('restaurar e unir', resposta.recusa, data);
    return resposta;
  } catch (err) {
    console.error('[lixeira] restaurar e unir estourou:', err);
    return { ok: false, recusa: recusaDoErro(null) };
  }
}
