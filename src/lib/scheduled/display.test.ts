import { describe, expect, it } from 'vitest';

import type { ScheduledMessage } from '@/types';
import {
  clienteEscreveuDepois,
  comporDeInputLocal,
  comporHorario,
  estaAtrasada,
  estaNaFila,
  hojeParaInput,
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

describe('comporDeInputLocal', () => {
  it('lê o valor do campo nativo em horário local', () => {
    const d = comporDeInputLocal('2026-08-05T14:30')!;
    expect(d.getDate()).toBe(5);
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
  });

  it('aceita o formato com segundos, que alguns navegadores devolvem', () => {
    const d = comporDeInputLocal('2026-08-05T14:30:00')!;
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
  });

  it('⚠️ recusa valor sem hora — é o caminho que vira meia-noite UTC', () => {
    expect(comporDeInputLocal('2026-08-05')).toBeNull();
    expect(comporDeInputLocal('')).toBeNull();
    expect(comporDeInputLocal('2026-08-05T')).toBeNull();
  });

  it('recusa data impossível, como o `comporHorario`', () => {
    expect(comporDeInputLocal('2026-02-31T10:00')).toBeNull();
  });
});

describe('hojeParaInput', () => {
  it('usa o dia LOCAL, com dois dígitos', () => {
    expect(hojeParaInput(new Date(2026, 7, 5, 23, 30))).toBe('2026-08-05');
    expect(hojeParaInput(new Date(2026, 0, 9, 1, 0))).toBe('2026-01-09');
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
    expect(podeDispararAgora('pending')).toBe(true);
    expect(podeDispararAgora('failed')).toBe(true);
    expect(podeDispararAgora('sending')).toBe(false);
    expect(podeDispararAgora('sent')).toBe(false);
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
