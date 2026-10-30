import { describe, expect, it } from 'vitest';

// ============================================================
// Os grupos de um cliente (1117): vínculo + grupo + conversa, por nome. Ids e
// nomes fictícios.
// ============================================================

import { montarGruposDoContato, type GrupoLido } from './grupos-do-contato';

const grupo = (over: Partial<GrupoLido>): GrupoLido => ({
  id: 'g',
  subject: null,
  alias: null,
  picture_url: null,
  participant_count: null,
  ...over,
});

describe('montarGruposDoContato', () => {
  it('junta a conversa de cada grupo e ordena pelo nome (apelido vence; sem nome por último)', () => {
    const lista = montarGruposDoContato(
      [
        { group_id: 'g-sem-nome', visto_em: '2026-10-30T10:00:00Z' },
        { group_id: 'g-zeca', visto_em: '2026-10-30T10:00:00Z' },
        { group_id: 'g-apelido', visto_em: '2026-10-29T10:00:00Z' },
        // O grupo não voltou (apagado no meio): fica de fora.
        { group_id: 'g-sumiu', visto_em: '2026-10-29T10:00:00Z' },
      ],
      [
        grupo({ id: 'g-sem-nome' }),
        grupo({ id: 'g-zeca', subject: 'Zeca e família', participant_count: 4 }),
        grupo({ id: 'g-apelido', subject: 'Zzz', alias: 'Ária do caso' }),
      ],
      [
        { id: 'conv-zeca', group_id: 'g-zeca' },
        { id: 'conv-1:1', group_id: null },
      ],
    );
    expect(lista.map((g) => g.grupoId)).toEqual(['g-apelido', 'g-zeca', 'g-sem-nome']);
    expect(lista[1]).toMatchObject({ conversaId: 'conv-zeca', participantes: 4 });
    expect(lista[0].conversaId).toBeNull();
  });
});
