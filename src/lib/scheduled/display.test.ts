import { describe, expect, it } from 'vitest';

import type { ScheduledMessage } from '@/types';
import {
  arredondarParaGrade,
  ATALHOS_DE_PRAZO,
  CICLO_MINUTOS,
  clienteEscreveuDepois,
  comporHorario,
  daquiAHoras,
  estaAtrasada,
  estaNaFila,
  hojeParaInput,
  horaParaInput,
  ordenarParaTela,
  podeDispararAgora,
} from './display';

function ag(over: Partial<ScheduledMessage> = {}): ScheduledMessage {
  return {
    id: 'ag-1',
    account_id: 'conta-1',
    conversation_id: 'conversa-1',
    channel_id: 'canal-1',
    body: 'texto',
    scheduled_for: '2026-08-05T17:30:00.000Z',
    status: 'pending',
    error: null,
    message_id: null,
    created_by: 'user-1',
    autor_nome: 'Dra. Ana',
    created_at: '2026-08-01T12:00:00.000Z',
    sent_at: null,
    entrega_incerta: false,
    ...over,
  };
}

describe('comporHorario', () => {
  it('monta a data em horário LOCAL, por componentes', () => {
    const d = comporHorario('2026-08-05', '14:30')!;
    // A armadilha é `new Date('2026-08-05')`, que é meia-noite UTC e no
    // Brasil retrocede um dia. Estas quatro asserções são exatamente o que
    // aquele caminho quebraria.
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(5);
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
  });

  it('meia-noite continua sendo o dia escolhido', () => {
    const d = comporHorario('2026-08-05', '00:00')!;
    expect(d.getDate()).toBe(5);
    expect(d.getHours()).toBe(0);
  });

  it('recusa forma inválida em vez de devolver Invalid Date', () => {
    expect(comporHorario('', '14:30')).toBeNull();
    expect(comporHorario('2026-08-05', '')).toBeNull();
    expect(comporHorario('05/08/2026', '14:30')).toBeNull();
    expect(comporHorario('2026-08-05', '14h30')).toBeNull();
    expect(comporHorario('2026-13-05', '14:30')).toBeNull();
    expect(comporHorario('2026-08-05', '25:00')).toBeNull();
    expect(comporHorario('2026-08-05', '14:60')).toBeNull();
  });

  it('⚠️ recusa 31 de fevereiro, que o JS transformaria em março', () => {
    expect(comporHorario('2026-02-31', '10:00')).toBeNull();
    expect(comporHorario('2026-04-31', '10:00')).toBeNull();
    // 2028 é bissexto — 29/02 existe e tem de passar.
    expect(comporHorario('2028-02-29', '10:00')).not.toBeNull();
    expect(comporHorario('2026-02-29', '10:00')).toBeNull();
  });
});

describe('hojeParaInput / horaParaInput', () => {
  it('usa o dia LOCAL, com dois dígitos', () => {
    expect(hojeParaInput(new Date(2026, 7, 5, 23, 30))).toBe('2026-08-05');
    expect(hojeParaInput(new Date(2026, 0, 9, 1, 0))).toBe('2026-01-09');
  });

  it('a hora também é local, com dois dígitos', () => {
    expect(horaParaInput(new Date(2026, 7, 5, 9, 5))).toBe('09:05');
    expect(horaParaInput(new Date(2026, 7, 5, 21, 0))).toBe('21:00');
    expect(horaParaInput(new Date(2026, 7, 5, 0, 0))).toBe('00:00');
  });
});

describe('arredondarParaGrade', () => {
  it('sobe para o próximo ponto da grade de 15 minutos', () => {
    const r = arredondarParaGrade(new Date(2026, 7, 5, 21, 37, 42));
    expect(r.getHours()).toBe(21);
    expect(r.getMinutes()).toBe(45);
    expect(r.getSeconds()).toBe(0);
  });

  it('⚠️ sempre para CIMA — descer adiantaria a mensagem para o cliente', () => {
    expect(arredondarParaGrade(new Date(2026, 7, 5, 9, 1)).getMinutes()).toBe(15);
    expect(arredondarParaGrade(new Date(2026, 7, 5, 9, 14)).getMinutes()).toBe(15);
    expect(arredondarParaGrade(new Date(2026, 7, 5, 9, 16)).getMinutes()).toBe(30);
  });

  it('quem já está na grade não se mexe', () => {
    for (const m of [0, 15, 30, 45]) {
      const r = arredondarParaGrade(new Date(2026, 7, 5, 9, m));
      expect(r.getMinutes()).toBe(m);
      expect(r.getHours()).toBe(9);
    }
  });

  it('atravessa a hora, o dia e o ano', () => {
    const h = arredondarParaGrade(new Date(2026, 7, 5, 9, 50));
    expect([h.getHours(), h.getMinutes()]).toEqual([10, 0]);
    const d = arredondarParaGrade(new Date(2026, 7, 5, 23, 50));
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([6, 0, 0]);
    const a = arredondarParaGrade(new Date(2026, 11, 31, 23, 50));
    expect([a.getFullYear(), a.getMonth(), a.getDate()]).toEqual([2027, 0, 1]);
  });

  it('zera os segundos — o campo nativo não os tem', () => {
    expect(arredondarParaGrade(new Date(2026, 7, 5, 9, 0, 59)).getSeconds()).toBe(0);
    expect(arredondarParaGrade(new Date(2026, 7, 5, 9, 0, 59)).getMinutes()).toBe(0);
  });
});

describe('daquiAHoras', () => {
  it('24 horas = amanhã, na MESMA hora', () => {
    // É a regra que o operador pediu para o padrão do seletor: abrir já
    // marcando o dia seguinte no relógio de agora.
    const r = daquiAHoras(24, new Date(2026, 7, 5, 21, 0));
    expect(r).toEqual({ data: '2026-08-06', hora: '21:00' });
  });

  it('⚠️ o atalho cai na GRADE, senão preenche um valor que o campo recusa', () => {
    // 21:37 + 24h = 21:37 de amanhã, que não existe no seletor de 15 em 15.
    expect(daquiAHoras(24, new Date(2026, 7, 5, 21, 37))).toEqual({
      data: '2026-08-06',
      hora: '21:45',
    });
  });

  it('atravessa a virada do mês e do ano', () => {
    expect(daquiAHoras(24, new Date(2026, 7, 31, 14, 0)).data).toBe('2026-09-01');
    expect(daquiAHoras(24, new Date(2026, 11, 31, 14, 0)).data).toBe('2027-01-01');
  });

  it('72 horas e os prazos em dias', () => {
    const agora = new Date(2026, 7, 5, 9, 30);
    expect(daquiAHoras(72, agora)).toEqual({ data: '2026-08-08', hora: '09:30' });
    expect(daquiAHoras(24 * 7, agora).data).toBe('2026-08-12');
    expect(daquiAHoras(24 * 15, agora).data).toBe('2026-08-20');
    expect(daquiAHoras(24 * 30, agora).data).toBe('2026-09-04');
  });

  it('o resultado sempre volta a virar a MESMA data pelo comporHorario', () => {
    // Ida e volta: sem isto, um atalho poderia produzir uma string que o
    // caminho de gravação recusa, e o botão simplesmente não faria nada.
    const agora = new Date(2026, 7, 5, 21, 0);
    for (const { horas } of ATALHOS_DE_PRAZO) {
      const { data, hora } = daquiAHoras(horas, agora);
      const volta = comporHorario(data, hora);
      expect(volta).not.toBeNull();
      // O relógio 21:00 já está na grade, então o arredondamento é neutro.
      expect(volta!.getTime()).toBe(agora.getTime() + horas * 3600_000);
      expect(volta!.getMinutes() % CICLO_MINUTOS).toBe(0);
    }
  });

  it('os cinco atalhos pedidos, nesta ordem', () => {
    expect(ATALHOS_DE_PRAZO.map((a) => a.chave)).toEqual([
      'h24',
      'h72',
      'd7',
      'd15',
      'd30',
    ]);
  });
});

describe('estaNaFila / podeDispararAgora', () => {
  it('a fila é pending + sending', () => {
    expect(estaNaFila('pending')).toBe(true);
    expect(estaNaFila('sending')).toBe(true);
    expect(estaNaFila('sent')).toBe(false);
    expect(estaNaFila('failed')).toBe(false);
  });

  it('⚠️ `sending` NÃO pode ser disparada de novo — mandaria duas vezes', () => {
    expect(podeDispararAgora(ag({ status: 'pending' }))).toBe(true);
    expect(podeDispararAgora(ag({ status: 'failed' }))).toBe(true);
    expect(podeDispararAgora(ag({ status: 'sending' }))).toBe(false);
    expect(podeDispararAgora(ag({ status: 'sent' }))).toBe(false);
  });

  it('⚠️ entrega incerta trava a retentativa mesmo com status `failed` (926)', () => {
    // "Falhou" ali quer dizer "o WhatsApp aceitou e a gravação estourou".
    // Sem esta linha, um clique manda a mesma coisa ao cliente duas vezes.
    expect(
      podeDispararAgora(ag({ status: 'failed', entrega_incerta: true })),
    ).toBe(false);
    expect(
      podeDispararAgora(ag({ status: 'pending', entrega_incerta: true })),
    ).toBe(false);
  });
});

describe('clienteEscreveuDepois', () => {
  it('avisa quando o cliente falou depois de o texto ser escrito', () => {
    expect(
      clienteEscreveuDepois(ag(), '2026-08-02T09:00:00.000Z'),
    ).toBe(true);
  });

  it('não avisa quando a última fala do cliente é anterior', () => {
    expect(
      clienteEscreveuDepois(ag(), '2026-07-30T09:00:00.000Z'),
    ).toBe(false);
  });

  it('conversa sem entrada nenhuma não avisa', () => {
    expect(clienteEscreveuDepois(ag(), null)).toBe(false);
  });

  it('não avisa sobre o que já saiu — o aviso serve para decidir', () => {
    expect(
      clienteEscreveuDepois(
        ag({ status: 'sent' }),
        '2026-08-02T09:00:00.000Z',
      ),
    ).toBe(false);
  });
});

describe('estaAtrasada', () => {
  it('passou da hora e continua pendente = o agendador não está rodando', () => {
    expect(
      estaAtrasada(ag(), new Date('2026-08-05T18:00:00.000Z')),
    ).toBe(true);
  });

  it('antes da hora não está atrasada', () => {
    expect(
      estaAtrasada(ag(), new Date('2026-08-05T17:00:00.000Z')),
    ).toBe(false);
  });

  it('só `pending` atrasa — `sending` já está sendo cuidada', () => {
    expect(
      estaAtrasada(
        ag({ status: 'sending' }),
        new Date('2026-08-05T18:00:00.000Z'),
      ),
    ).toBe(false);
    expect(
      estaAtrasada(
        ag({ status: 'failed' }),
        new Date('2026-08-05T18:00:00.000Z'),
      ),
    ).toBe(false);
  });
});

describe('ordenarParaTela', () => {
  it('a fila vem primeiro, e dentro dela a mais próxima no topo', () => {
    const lista = [
      ag({ id: 'longe', scheduled_for: '2026-09-01T10:00:00.000Z' }),
      ag({ id: 'perto', scheduled_for: '2026-08-02T10:00:00.000Z' }),
    ];
    expect(ordenarParaTela(lista).map((a) => a.id)).toEqual(['perto', 'longe']);
  });

  it('⚠️ o acervo nunca enterra a próxima a sair', () => {
    const lista = [
      ag({ id: 'enviada-recente', status: 'sent', scheduled_for: '2026-12-01T10:00:00.000Z' }),
      ag({ id: 'pendente', scheduled_for: '2026-08-02T10:00:00.000Z' }),
    ];
    // Ordenar só por `scheduled_for` poria a enviada de dezembro no fim, e a
    // pendente no topo por acaso. Aqui a regra é explícita.
    expect(ordenarParaTela(lista).map((a) => a.id)).toEqual([
      'pendente',
      'enviada-recente',
    ]);
  });

  it('no acervo, a mais recente vem primeiro', () => {
    const lista = [
      ag({ id: 'antiga', status: 'sent', scheduled_for: '2026-01-01T10:00:00.000Z' }),
      ag({ id: 'nova', status: 'failed', scheduled_for: '2026-07-01T10:00:00.000Z' }),
    ];
    expect(ordenarParaTela(lista).map((a) => a.id)).toEqual(['nova', 'antiga']);
  });

  it('não mexe na lista recebida', () => {
    const lista = [
      ag({ id: 'b', scheduled_for: '2026-09-01T10:00:00.000Z' }),
      ag({ id: 'a', scheduled_for: '2026-08-01T10:00:00.000Z' }),
    ];
    ordenarParaTela(lista);
    expect(lista.map((a) => a.id)).toEqual(['b', 'a']);
  });
});
