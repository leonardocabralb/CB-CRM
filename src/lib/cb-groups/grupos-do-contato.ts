// ============================================================
// Os grupos de UM cliente (1117), do lado do navegador: junta o vínculo
// (`cb_grupos_dos_contatos`), o grupo e a conversa dele. Puro, sem React.
// ============================================================

import type { CbGroup } from '@/types';

export interface GrupoDoContato {
  grupoId: string;
  /** Para `nomeDoGrupo` (o apelido vence o nome real). */
  grupo: Pick<CbGroup, 'alias' | 'subject'>;
  fotoUrl: string | null;
  participantes: number | null;
  /** A conversa do grupo no CRM; nula = o grupo ainda não tem conversa. */
  conversaId: string | null;
  /** Quando a ficha foi vista na lista do grupo pela última vez. */
  vistoEm: string;
}

export interface VinculoLido {
  group_id: string;
  visto_em: string;
}

export interface GrupoLido {
  id: string;
  subject: string | null;
  alias: string | null;
  picture_url: string | null;
  participant_count: number | null;
}

const nomeParaOrdem = (g: Pick<CbGroup, 'alias' | 'subject'>) => g.alias?.trim() || g.subject?.trim() || '';

/**
 * Monta a lista, por nome (o sem nome por último). Vínculo cujo grupo não
 * voltou (apagado no meio, ou de outra conta) fica de fora.
 */
export function montarGruposDoContato(
  vinculos: VinculoLido[],
  grupos: GrupoLido[],
  conversas: { id: string; group_id: string | null }[],
): GrupoDoContato[] {
  const porId = new Map(grupos.map((g) => [g.id, g]));
  const conversaDoGrupo = new Map<string, string>();
  for (const c of conversas) {
    if (c.group_id && !conversaDoGrupo.has(c.group_id)) conversaDoGrupo.set(c.group_id, c.id);
  }
  const lista = vinculos.flatMap((v): GrupoDoContato[] => {
    const g = porId.get(v.group_id);
    if (!g) return [];
    return [
      {
        grupoId: g.id,
        grupo: { alias: g.alias, subject: g.subject },
        fotoUrl: g.picture_url,
        participantes: g.participant_count,
        conversaId: conversaDoGrupo.get(g.id) ?? null,
        vistoEm: v.visto_em,
      },
    ];
  });
  return lista.sort((a, b) => {
    const [x, y] = [nomeParaOrdem(a.grupo), nomeParaOrdem(b.grupo)];
    if (!x || !y) return x ? -1 : y ? 1 : 0;
    return x.localeCompare(y, undefined, { sensitivity: 'base' });
  });
}
