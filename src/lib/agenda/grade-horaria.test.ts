import { describe, expect, it } from 'vitest';

import { FUSO_PADRAO, paraInstante } from './fuso';
import {
  ALTURA_DA_HORA,
  HORA_INICIAL,
  alturaEmPx,
  horasDaRegua,
  minutosDoDeslocamento,
  minutosDoDia,
  posicionarNoDia,
  topoDoAgora,
  topoEmPx,
} from './grade-horaria';
import type { Meeting } from '@/types';

const DIA = '2026-09-02';

function reuniao(id: string, hora: string, duracaoMin: number): Meeting {
  const inicio = paraInstante(DIA, hora, FUSO_PADRAO);
  return {
    id,
    account_id: 'conta',
    owner_user_id: 'adv',
    owner_nome: 'Advogado',
    contact_id: null,
    contato_nome: null,
    conversation_id: null,
    channel_id: null,
    titulo: `Reunião ${id}`,
    descricao: null,
    local: null,
    tipo: 'outra',
    starts_at: inicio.toISOString(),
    ends_at: new Date(inicio.getTime() + duracaoMin * 60000).toISOString(),
    status: 'agendada',
    google_event_id: null,
    google_calendar_id: null,
    google_sincronizado_em: null,
    google_erro: null,
    created_by: null,
    autor_nome: 'Autor',
    created_at: inicio.toISOString(),
    updated_at: inicio.toISOString(),
  };
}

describe('horasDaRegua', () => {
  it('vai da primeira à última hora, inclusive', () => {
    const horas = horasDaRegua();
    expect(horas[0]).toBe(HORA_INICIAL);
    expect(horas.at(-1)).toBe(23);
    expect(horas).toHaveLength(18);
  });
});

describe('minutosDoDia', () => {
  it('lê a hora no fuso da tela, não em UTC', () => {
    const nove = paraInstante(DIA, '09:00', FUSO_PADRAO);
    expect(minutosDoDia(nove, FUSO_PADRAO)).toBe(540);
  });

  it('⚠️ a reunião da noite não vira madrugada', () => {
    // 22h em Brasília é 01h do dia seguinte em UTC.
    const noite = paraInstante(DIA, '22:00', FUSO_PADRAO);
    expect(noite.toISOString()).toContain('2026-09-03T01:00');
    expect(minutosDoDia(noite, FUSO_PADRAO)).toBe(1320); // 22h, não 1h
  });
});

describe('topoEmPx', () => {
  it('a primeira hora fica no topo', () => {
    const seis = paraInstante(DIA, '06:00', FUSO_PADRAO);
    expect(topoEmPx(seis, FUSO_PADRAO)).toBe(0);
  });

  it('cada hora desce uma altura de hora', () => {
    const sete = paraInstante(DIA, '07:00', FUSO_PADRAO);
    expect(topoEmPx(sete, FUSO_PADRAO)).toBe(ALTURA_DA_HORA);
    const nove = paraInstante(DIA, '09:00', FUSO_PADRAO);
    expect(topoEmPx(nove, FUSO_PADRAO)).toBe(3 * ALTURA_DA_HORA);
  });

  it('a meia hora cai no meio', () => {
    const noveMeia = paraInstante(DIA, '09:30', FUSO_PADRAO);
    expect(topoEmPx(noveMeia, FUSO_PADRAO)).toBe(3.5 * ALTURA_DA_HORA);
  });

  it('⚠️ reunião antes da primeira hora tem topo NEGATIVO', () => {
    // Não é grampeado em zero: o retângulo entra recortado por cima, dizendo a
    // verdade sobre começar antes da faixa desenhada.
    const cinco = paraInstante(DIA, '05:00', FUSO_PADRAO);
    expect(topoEmPx(cinco, FUSO_PADRAO)).toBe(-ALTURA_DA_HORA);
  });
});

describe('alturaEmPx', () => {
  it('uma hora é uma altura de hora', () => {
    const i = paraInstante(DIA, '09:00', FUSO_PADRAO);
    const f = paraInstante(DIA, '10:00', FUSO_PADRAO);
    expect(alturaEmPx(i, f)).toBe(ALTURA_DA_HORA);
  });

  it('duas horas e meia são proporcionais', () => {
    const i = paraInstante(DIA, '09:00', FUSO_PADRAO);
    const f = paraInstante(DIA, '11:30', FUSO_PADRAO);
    expect(alturaEmPx(i, f)).toBe(2.5 * ALTURA_DA_HORA);
  });

  it('⚠️ reunião curta tem piso, para o horário caber dentro', () => {
    const i = paraInstante(DIA, '09:00', FUSO_PADRAO);
    const f = paraInstante(DIA, '09:05', FUSO_PADRAO);
    expect(alturaEmPx(i, f)).toBe(20);
  });
});

describe('minutosDoDeslocamento', () => {
  it('uma altura de hora para baixo é uma hora', () => {
    expect(minutosDoDeslocamento(ALTURA_DA_HORA)).toBe(60);
    expect(minutosDoDeslocamento(-ALTURA_DA_HORA)).toBe(-60);
  });

  it('arredonda ao passo de 15 minutos', () => {
    // Meia altura = 30 min, exato.
    expect(minutosDoDeslocamento(ALTURA_DA_HORA / 2)).toBe(30);
    // Um tiquinho a mais continua 30 — o passo é que manda.
    expect(minutosDoDeslocamento(ALTURA_DA_HORA / 2 + 3)).toBe(30);
  });

  it('⚠️ movimento minúsculo não muda a hora', () => {
    // Sem o arredondamento, tremer 3px viraria "adiei 3 minutos".
    expect(minutosDoDeslocamento(3)).toBe(0);
    expect(minutosDoDeslocamento(-3)).toBe(0);
  });
});

describe('posicionarNoDia', () => {
  it('reuniões que não se cruzam ficam em largura cheia', () => {
    const pos = posicionarNoDia(
      [reuniao('a', '09:00', 60), reuniao('b', '11:00', 60)],
      FUSO_PADRAO,
    );
    expect(pos).toHaveLength(2);
    expect(pos.every((p) => p.colunas === 1 && p.coluna === 0)).toBe(true);
  });

  it('⚠️ duas no mesmo horário dividem a largura, em vez de sumir uma', () => {
    const pos = posicionarNoDia(
      [reuniao('a', '09:00', 60), reuniao('b', '09:00', 60)],
      FUSO_PADRAO,
    );
    expect(pos.every((p) => p.colunas === 2)).toBe(true);
    expect(pos.map((p) => p.coluna).sort()).toEqual([0, 1]);
  });

  it('cruzamento parcial também divide', () => {
    const pos = posicionarNoDia(
      [reuniao('a', '09:00', 60), reuniao('b', '09:30', 60)],
      FUSO_PADRAO,
    );
    expect(pos.every((p) => p.colunas === 2)).toBe(true);
  });

  it('⚠️ encostadas NÃO dividem — 9h–10h e 10h–11h são consecutivas', () => {
    const pos = posicionarNoDia(
      [reuniao('a', '09:00', 60), reuniao('b', '10:00', 60)],
      FUSO_PADRAO,
    );
    expect(pos.every((p) => p.colunas === 1)).toBe(true);
  });

  it('três simultâneas viram três colunas', () => {
    const pos = posicionarNoDia(
      [reuniao('a', '09:00', 60), reuniao('b', '09:15', 60), reuniao('c', '09:30', 60)],
      FUSO_PADRAO,
    );
    expect(pos.every((p) => p.colunas === 3)).toBe(true);
    expect(pos.map((p) => p.coluna).sort()).toEqual([0, 1, 2]);
  });

  it('⚠️ reaproveita a coluna quando a anterior já terminou', () => {
    // a: 9h–10h | b: 9h–11h | c: 10h–11h
    // `c` não cruza `a`, então herda a coluna dela — são 2 colunas, não 3.
    const pos = posicionarNoDia(
      [reuniao('a', '09:00', 60), reuniao('b', '09:00', 120), reuniao('c', '10:00', 60)],
      FUSO_PADRAO,
    );
    expect(pos.every((p) => p.colunas === 2)).toBe(true);
    const porId = new Map(pos.map((p) => [p.reuniao.id, p.coluna]));
    expect(porId.get('a')).toBe(porId.get('c'));
  });

  it('grupos separados no tempo não se contaminam', () => {
    const pos = posicionarNoDia(
      [
        reuniao('a', '09:00', 60),
        reuniao('b', '09:00', 60), // grupo 1: 2 colunas
        reuniao('c', '15:00', 60), // grupo 2: sozinha
      ],
      FUSO_PADRAO,
    );
    const porId = new Map(pos.map((p) => [p.reuniao.id, p.colunas]));
    expect(porId.get('a')).toBe(2);
    expect(porId.get('c')).toBe(1);
  });

  it('lista vazia devolve vazio', () => {
    expect(posicionarNoDia([], FUSO_PADRAO)).toEqual([]);
  });

  it('posiciona com o topo e a altura corretos', () => {
    const [p] = posicionarNoDia([reuniao('a', '09:00', 90)], FUSO_PADRAO);
    expect(p.topo).toBe(3 * ALTURA_DA_HORA);
    expect(p.altura).toBe(1.5 * ALTURA_DA_HORA);
  });
});

describe('topoDoAgora', () => {
  it('posiciona dentro da faixa', () => {
    const dezEMeia = paraInstante(DIA, '10:30', FUSO_PADRAO);
    expect(topoDoAgora(dezEMeia, FUSO_PADRAO)).toBe(4.5 * ALTURA_DA_HORA);
  });

  it('⚠️ devolve null fora da faixa, em vez de grampear na borda', () => {
    // Grampeada no topo, a linha afirmaria "agora são 6h" às 3 da manhã.
    const madrugada = paraInstante(DIA, '03:00', FUSO_PADRAO);
    expect(topoDoAgora(madrugada, FUSO_PADRAO)).toBeNull();
  });
});
