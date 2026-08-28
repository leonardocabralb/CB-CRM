import { describe, expect, it } from 'vitest';

import {
  agruparPorPrazo,
  compararConcluidas,
  compararPendentes,
  diaLocal,
  grupoDaTarefa,
  horaJaPassou,
  situacaoDoPrazo,
} from './prazo';
import type { Task } from '@/types';

function tarefa(id: string, vence_em: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    account_id: 'conta',
    contact_id: 'cliente',
    criador_user_id: 'u-chefe',
    responsavel_user_id: 'u-colega',
    criador_nome: 'Chefe',
    responsavel_nome: 'Colega',
    titulo: 'Ligar para o cliente',
    descricao: null,
    vence_em,
    vence_as: null,
    status: 'aberta',
    concluida_em: null,
    lida_em: null,
    importante: false,
    tarefa_pai_id: null,
    tarefa_pai_titulo: null,
    tipo: 'tarefa',
    created_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-08-01T10:00:00Z',
    ...extra,
  };
}

describe('diaLocal', () => {
  it('usa o relógio LOCAL, não o UTC', () => {
    // ⚠️ O teste que justifica o arquivo inteiro. `new Date(2026, 7, 28, 23, 30)`
    // é 28/08 às 23h30 no fuso de quem roda. Em qualquer fuso a oeste de
    // Greenwich (Brasília inclusive) o `toISOString()` desta data já é dia 29 —
    // então uma implementação que passasse por ele daria o dia seguinte, e toda
    // tarefa marcada para hoje apareceria como "a vencer" depois das 21h.
    expect(diaLocal(new Date(2026, 7, 28, 23, 30))).toBe('2026-08-28');
  });

  it('põe zero à esquerda em mês e dia', () => {
    // Sem o padding a comparação de texto quebra: "2026-8-5" > "2026-12-01".
    expect(diaLocal(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });

  it('vira o ano corretamente', () => {
    expect(diaLocal(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
    expect(diaLocal(new Date(2027, 0, 1, 0, 1))).toBe('2027-01-01');
  });
});

describe('situacaoDoPrazo', () => {
  const agora = new Date(2026, 7, 28, 14, 0); // 28/08/2026, 14h local

  it('ontem é vencida, hoje é hoje, amanhã é a vencer', () => {
    expect(situacaoDoPrazo('2026-08-27', agora)).toBe('vencida');
    expect(situacaoDoPrazo('2026-08-28', agora)).toBe('hoje');
    expect(situacaoDoPrazo('2026-08-29', agora)).toBe('a_vencer');
  });

  it('a tarefa de hoje continua "hoje" às 23h59', () => {
    // O corte é o DIA. Se fosse a hora, o grupo mudaria sozinho no meio do
    // expediente e a tarefa apareceria em "Vencidas" sem nada ter acontecido.
    const tarde = new Date(2026, 7, 28, 23, 59);
    expect(situacaoDoPrazo('2026-08-28', tarde)).toBe('hoje');
  });

  it('compara ano e mês, não só o dia', () => {
    // Uma comparação ingênua por dia-do-mês diria que 31/07 ainda não venceu.
    expect(situacaoDoPrazo('2026-07-31', agora)).toBe('vencida');
    expect(situacaoDoPrazo('2025-12-30', agora)).toBe('vencida');
    expect(situacaoDoPrazo('2026-09-01', agora)).toBe('a_vencer');
  });
});

describe('horaJaPassou', () => {
  const agora = new Date(2026, 7, 28, 18, 0); // 18h

  it('acusa a hora vencida de hoje', () => {
    expect(horaJaPassou('2026-08-28', '09:00:00', agora)).toBe(true);
  });

  it('não acusa hora futura de hoje', () => {
    expect(horaJaPassou('2026-08-28', '19:30:00', agora)).toBe(false);
  });

  it('tarefa SEM hora nunca atrasa dentro do dia', () => {
    // Vale o dia inteiro; dizer que atrasou às 00h01 seria mentira.
    expect(horaJaPassou('2026-08-28', null, agora)).toBe(false);
  });

  it('não opina sobre outro dia', () => {
    // Para dia passado quem responde é o grupo "Vencida"; para dia futuro não
    // há atraso possível.
    expect(horaJaPassou('2026-08-27', '09:00:00', agora)).toBe(false);
    expect(horaJaPassou('2026-08-29', '09:00:00', agora)).toBe(false);
  });

  it('compara o minuto, não só a hora', () => {
    const dezEQuinze = new Date(2026, 7, 28, 10, 15);
    expect(horaJaPassou('2026-08-28', '10:10:00', dezEQuinze)).toBe(true);
    expect(horaJaPassou('2026-08-28', '10:20:00', dezEQuinze)).toBe(false);
  });
});

describe('grupoDaTarefa', () => {
  const agora = new Date(2026, 7, 28, 14, 0);

  it('concluída sai da linha do tempo', () => {
    // ⚠️ Sem isto, tarefa feita na semana passada ficaria "vencida" para
    // sempre e a lista de pendências nasceria cheia de vermelho já resolvido.
    const feita = tarefa('t1', '2026-08-20', {
      status: 'concluida',
      concluida_em: '2026-08-20T15:00:00Z',
    });
    expect(grupoDaTarefa(feita, agora)).toBe('concluidas');
  });

  it('pendente cai no grupo do prazo', () => {
    expect(grupoDaTarefa(tarefa('t1', '2026-08-27'), agora)).toBe('vencidas');
    expect(grupoDaTarefa(tarefa('t2', '2026-08-28'), agora)).toBe('hoje');
    expect(grupoDaTarefa(tarefa('t3', '2026-09-10'), agora)).toBe('a_vencer');
  });
});

describe('compararPendentes', () => {
  it('ordena por data crescente', () => {
    const lista = [
      tarefa('c', '2026-09-01'),
      tarefa('a', '2026-08-10'),
      tarefa('b', '2026-08-20'),
    ];
    expect([...lista].sort(compararPendentes).map((t) => t.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('no mesmo dia, ordena por hora', () => {
    const lista = [
      tarefa('tarde', '2026-08-28', { vence_as: '16:00:00' }),
      tarefa('manha', '2026-08-28', { vence_as: '09:00:00' }),
    ];
    expect([...lista].sort(compararPendentes).map((t) => t.id)).toEqual([
      'manha',
      'tarde',
    ]);
  });

  it('no mesmo dia, quem tem hora vem antes de quem não tem', () => {
    // A sem hora vale o dia todo — é a mais folgada das duas.
    const lista = [
      tarefa('sem-hora', '2026-08-28'),
      tarefa('com-hora', '2026-08-28', { vence_as: '17:00:00' }),
    ];
    expect([...lista].sort(compararPendentes).map((t) => t.id)).toEqual([
      'com-hora',
      'sem-hora',
    ]);
  });

  it('IMPORTANTE não reordena', () => {
    // ⚠️ Destaque visual não é eixo de ordenação: se subisse a linha, a coluna
    // de datas deixaria de ser crescente e a leitura "o que vem primeiro"
    // acabaria.
    const lista = [
      tarefa('cedo', '2026-08-10'),
      tarefa('tarde-importante', '2026-09-01', { importante: true }),
    ];
    expect([...lista].sort(compararPendentes).map((t) => t.id)).toEqual([
      'cedo',
      'tarde-importante',
    ]);
  });

  it('desempata por criação para a lista não tremer', () => {
    const lista = [
      tarefa('b', '2026-08-28', { created_at: '2026-08-02T10:00:00Z' }),
      tarefa('a', '2026-08-28', { created_at: '2026-08-01T10:00:00Z' }),
    ];
    expect([...lista].sort(compararPendentes).map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('compararConcluidas', () => {
  it('a última concluída vem primeiro', () => {
    const lista = [
      tarefa('antiga', '2026-08-01', {
        status: 'concluida',
        concluida_em: '2026-08-01T10:00:00Z',
      }),
      tarefa('recente', '2026-08-20', {
        status: 'concluida',
        concluida_em: '2026-08-25T10:00:00Z',
      }),
    ];
    expect([...lista].sort(compararConcluidas).map((t) => t.id)).toEqual([
      'recente',
      'antiga',
    ]);
  });

  it('ordena pela CONCLUSÃO, não pelo prazo', () => {
    // ⚠️ Uma tarefa muito atrasada fechada hoje tem de aparecer no topo do
    // acervo — se a régua fosse `vence_em` ela ficaria enterrada, e é
    // justamente a que alguém acabou de resolver.
    const lista = [
      tarefa('prazo-recente', '2026-08-30', {
        status: 'concluida',
        concluida_em: '2026-08-20T10:00:00Z',
      }),
      tarefa('prazo-antigo', '2026-01-05', {
        status: 'concluida',
        concluida_em: '2026-08-28T10:00:00Z',
      }),
    ];
    expect([...lista].sort(compararConcluidas).map((t) => t.id)).toEqual([
      'prazo-antigo',
      'prazo-recente',
    ]);
  });
});

describe('agruparPorPrazo', () => {
  const agora = new Date(2026, 7, 28, 14, 0);

  it('reparte e ordena os quatro grupos', () => {
    const grupos = agruparPorPrazo(
      [
        tarefa('futura', '2026-09-05'),
        tarefa('atrasada-2', '2026-08-20'),
        tarefa('hoje', '2026-08-28'),
        tarefa('atrasada-1', '2026-08-10'),
        tarefa('feita', '2026-08-15', {
          status: 'concluida',
          concluida_em: '2026-08-16T09:00:00Z',
        }),
      ],
      agora,
    );
    expect(grupos.vencidas.map((t) => t.id)).toEqual(['atrasada-1', 'atrasada-2']);
    expect(grupos.hoje.map((t) => t.id)).toEqual(['hoje']);
    expect(grupos.a_vencer.map((t) => t.id)).toEqual(['futura']);
    expect(grupos.concluidas.map((t) => t.id)).toEqual(['feita']);
  });

  it('devolve os quatro grupos mesmo vazios', () => {
    // A tela decide o que esconder; um grupo ausente obrigaria toda leitura a
    // testar `undefined`.
    const grupos = agruparPorPrazo([], agora);
    expect(grupos).toEqual({
      vencidas: [],
      hoje: [],
      a_vencer: [],
      concluidas: [],
    });
  });

  it('não muta a lista recebida', () => {
    const lista = [tarefa('b', '2026-09-01'), tarefa('a', '2026-08-01')];
    agruparPorPrazo(lista, agora);
    expect(lista.map((t) => t.id)).toEqual(['b', 'a']);
  });
});
