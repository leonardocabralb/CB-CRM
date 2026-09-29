import { describe, expect, it } from 'vitest';

import {
  resumirEquipe,
  type MembroDaEquipe,
  type TarefaDaEquipe,
} from './equipe';

const HOJE = '2026-09-29';
const EU = 'u-gestor';
const ANA = 'u-ana';
const BRUNO = 'u-bruno';
const CAIO = 'u-caio';

const MEMBROS: MembroDaEquipe[] = [
  { user_id: EU, full_name: 'Gestor' },
  { user_id: ANA, full_name: 'Ana' },
  { user_id: BRUNO, full_name: 'Bruno' },
  { user_id: CAIO, full_name: 'Caio', suspenso_em: '2026-09-28T10:00:00Z' },
];

let seq = 0;
function tarefa(extra: Partial<TarefaDaEquipe>): TarefaDaEquipe {
  seq++;
  return {
    id: `t${String(seq).padStart(3, '0')}`,
    titulo: `Tarefa ${seq}`,
    vence_em: HOJE,
    vence_as: null,
    responsavel_user_id: ANA,
    responsavel_nome: 'Ana (congelado)',
    vista_em: null,
    contact_id: 'cliente',
    contact: null,
    ...extra,
  };
}

describe('resumirEquipe', () => {
  it('separa vencidas e de hoje, contando as NÃO vistas de cada grupo', () => {
    const { comTarefas } = resumirEquipe(
      [
        tarefa({ vence_em: '2026-09-20' }),
        tarefa({ vence_em: '2026-09-25', vista_em: '2026-09-25T12:00:00Z' }),
        tarefa({}),
        tarefa({ vista_em: '2026-09-29T09:00:00Z' }),
      ],
      MEMBROS,
      EU,
      HOJE,
    );
    expect(comTarefas).toHaveLength(1);
    const ana = comTarefas[0];
    expect(ana.nome).toBe('Ana');
    expect(ana.vencidas.map((t) => t.vence_em)).toEqual(['2026-09-20', '2026-09-25']);
    expect(ana.vencidasNaoVistas).toBe(1);
    expect(ana.hoje).toHaveLength(2);
    expect(ana.hojeNaoVistas).toBe(1);
  });

  it('deixa de fora as tarefas de quem olha e as de prazo futuro', () => {
    const { comTarefas } = resumirEquipe(
      [
        tarefa({ responsavel_user_id: EU }),
        tarefa({ vence_em: '2026-09-30' }),
      ],
      MEMBROS,
      EU,
      HOJE,
    );
    expect(comTarefas).toEqual([]);
  });

  it('ordena quem tem mais vencidas primeiro', () => {
    const { comTarefas } = resumirEquipe(
      [
        tarefa({ responsavel_user_id: ANA }),
        tarefa({ responsavel_user_id: BRUNO, vence_em: '2026-09-01' }),
        tarefa({ responsavel_user_id: BRUNO, vence_em: '2026-09-02' }),
        tarefa({ responsavel_user_id: ANA, vence_em: '2026-09-03' }),
      ],
      MEMBROS,
      EU,
      HOJE,
    );
    expect(comTarefas.map((l) => l.userId)).toEqual([BRUNO, ANA]);
  });

  it('"em dia" é quem está ativo, não é quem olha e não deve nada', () => {
    const { emDia } = resumirEquipe([tarefa({ responsavel_user_id: ANA })], MEMBROS, EU, HOJE);
    // Caio está suspenso: não entra no "em dia".
    expect(emDia).toEqual([{ userId: BRUNO, nome: 'Bruno' }]);
  });

  it('suspenso COM tarefa aparece, marcado — é o gestor quem redireciona', () => {
    const { comTarefas } = resumirEquipe(
      [tarefa({ responsavel_user_id: CAIO, vence_em: '2026-09-10' })],
      MEMBROS,
      EU,
      HOJE,
    );
    expect(comTarefas[0]).toMatchObject({ userId: CAIO, suspenso: true, foraDaEquipe: false });
  });

  it('quem saiu da conta aparece com o nome congelado; sem responsável vira linha própria, no fim do empate', () => {
    const { comTarefas } = resumirEquipe(
      [
        tarefa({ responsavel_user_id: null, responsavel_nome: null }),
        tarefa({ responsavel_user_id: 'u-ex', responsavel_nome: 'Ex-membro' }),
      ],
      MEMBROS,
      EU,
      HOJE,
    );
    expect(comTarefas.map((l) => [l.userId, l.nome, l.foraDaEquipe])).toEqual([
      ['u-ex', 'Ex-membro', true],
      [null, null, false],
    ]);
  });

  it('sem a lista de membros: agrupa pelo nome congelado e não afirma quem está em dia', () => {
    const { comTarefas, emDia } = resumirEquipe([tarefa({})], null, EU, HOJE);
    expect(comTarefas[0]).toMatchObject({ nome: 'Ana (congelado)', foraDaEquipe: false });
    expect(emDia).toBeNull();
  });

  it('dentro do dia, a com hora vem antes da sem hora', () => {
    const { comTarefas } = resumirEquipe(
      [
        tarefa({ vence_as: null, titulo: 'sem hora' }),
        tarefa({ vence_as: '16:00:00', titulo: 'às 16' }),
        tarefa({ vence_as: '09:00:00', titulo: 'às 9' }),
      ],
      MEMBROS,
      EU,
      HOJE,
    );
    expect(comTarefas[0].hoje.map((t) => t.titulo)).toEqual(['às 9', 'às 16', 'sem hora']);
  });
});
