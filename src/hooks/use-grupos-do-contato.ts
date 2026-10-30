'use client';

import { useCallback, useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import {
  montarGruposDoContato,
  type GrupoDoContato,
  type GrupoLido,
  type VinculoLido,
} from '@/lib/cb-groups/grupos-do-contato';

export interface EstadoDosGruposDoContato {
  /** NULO = ainda não se sabe (carregando ou falhou). Nunca vira "nenhum". */
  itens: GrupoDoContato[] | null;
  carregando: boolean;
  falhou: boolean;
  recarregar: () => void;
}

type Cliente = ReturnType<typeof createClient>;

/** Vínculos → grupos + conversas deles. NULO = alguma leitura falhou. */
async function lerGrupos(supabase: Cliente, contatoId: string): Promise<GrupoDoContato[] | null> {
  const { data: vinculos, error } = await supabase
    .from('cb_grupos_dos_contatos')
    .select('group_id, visto_em')
    .eq('contact_id', contatoId);
  if (error || !vinculos) return null;

  const lidos = vinculos as VinculoLido[];
  const ids = [...new Set(lidos.map((v) => v.group_id))];
  if (ids.length === 0) return [];

  const [grupos, conversas] = await Promise.all([
    supabase.from('cb_groups').select('id, subject, alias, picture_url, participant_count').in('id', ids),
    supabase.from('conversations').select('id, group_id').in('group_id', ids),
  ]);
  if (grupos.error || conversas.error) return null;

  return montarGruposDoContato(
    lidos,
    (grupos.data ?? []) as GrupoLido[],
    (conversas.data ?? []) as { id: string; group_id: string | null }[],
  );
}

/**
 * Os grupos de WhatsApp em que UMA ficha estava na última conferência da
 * lista (1117) — a seção Grupos da aba Relacionados do painel da conversa.
 * Só leitura: quem grava o vínculo é o servidor (`fichas-do-grupo.ts`).
 *
 * ⚠️ Guarda `{ de, itens }` e DERIVA `carregando` de `de !== contactId`, como
 * `useContatosRelacionados`: o painel não remonta ao trocar de cliente, e o
 * clique na lista do anterior abriria o grupo errado.
 */
export function useGruposDoContato(
  contactId: string | null | undefined,
  /** O token de resync da página do inbox (voltar à aba, reconexão). */
  resyncToken: number = 0,
): EstadoDosGruposDoContato {
  const [estado, setEstado] = useState<{ de: string | null; itens: GrupoDoContato[] | null }>({
    de: null,
    itens: null,
  });
  const [nonce, setNonce] = useState(0);
  const recarregar = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!contactId) return;
    let vivo = true;
    void lerGrupos(createClient(), contactId).then((itens) => {
      if (vivo) setEstado({ de: contactId, itens });
    });
    return () => {
      vivo = false;
    };
  }, [contactId, nonce, resyncToken]);

  const doContatoAtual = !!contactId && estado.de === contactId;
  return {
    itens: doContatoAtual ? estado.itens : null,
    carregando: !!contactId && !doContatoAtual,
    falhou: doContatoAtual && estado.itens === null,
    recarregar,
  };
}
