import { describe, expect, it } from 'vitest';

import type { Agendamento } from '@/lib/calendly/payload';
import { variaveisDoAgendamento } from '@/lib/calendly/variaveis';
import type { Meeting } from '@/types';

import {
  intercalarHistorico,
  lerReunioesExternas,
  montarReunioesExternas,
  reuniaoTerminou,
  type LinhaDaKommo,
  type LinhaDoCalendly,
} from './reunioes-externas';

const EVENTO = 'https://api.calendly.com/event_types/T';

function calendly(parcial: Partial<LinhaDoCalendly> & { id: string }): LinhaDoCalendly {
  return {
    invitee_uri: `https://api.calendly.com/scheduled_events/E/invitees/${parcial.id}`,
    event_type_uri: EVENTO,
    event_type_nome: 'Reunião com Advogado',
    inicio: '2026-09-22T13:00:00.000000Z',
    fim: '2026-09-22T13:30:00.000000Z',
    link: 'https://calendly.com/events/x/google_meet',
    situacao: 'Novo agendamento',
    recebido_em: '2026-09-19T02:59:36.714179+00:00',
    ...parcial,
  };
}

function kommo(parcial: Partial<LinhaDaKommo> & { id: string }): LinhaDaKommo {
  return { reuniao_em: '2026-05-12 17:00:00+00', link: null, marcou_onde: null, ...parcial };
}

const desmarcadas = (lista: ReturnType<typeof montarReunioesExternas>) =>
  Object.fromEntries(lista.map((r) => [r.id, r.desmarcada]));

describe('montarReunioesExternas', () => {
  it('casa o cancelamento pelo convite', () => {
    const a = calendly({ id: 'a' });
    const lista = montarReunioesExternas([a, calendly({ id: 'b', inicio: '2026-09-30T13:00:00Z' })], new Set([a.invitee_uri]), []);
    expect(desmarcadas(lista)).toEqual({ a: 'cancelada', b: null });
  });

  it('o convite que o reagendamento substituiu é "reagendada", com ou sem a linha do cancelamento', () => {
    // O caso de antes da 1013: o Calendly não mandou o cancelamento do antigo.
    const antigo = calendly({ id: 'antigo', inicio: '2026-09-15T16:45:00Z', recebido_em: '2026-09-14T11:42:41Z' });
    const novo = calendly({ id: 'novo', inicio: '2026-09-15T19:00:00Z', recebido_em: '2026-09-15T13:15:16Z', situacao: 'Reagendamento' });
    const sem = montarReunioesExternas([antigo, novo], new Set(), []);
    expect(desmarcadas(sem)).toEqual({ antigo: 'reagendada', novo: null });
    expect(sem.find((r) => r.id === 'novo')?.reagendamento).toBe(true);

    // Depois da 1013 o cancelamento chega — e continua sendo reagendamento.
    const com = montarReunioesExternas([antigo, novo], new Set([antigo.invitee_uri]), []);
    expect(desmarcadas(com)).toEqual({ antigo: 'reagendada', novo: null });
  });

  it('reagendamento em cadeia: cada novo horário toma o anterior, uma vez só', () => {
    const lista = montarReunioesExternas(
      [
        calendly({ id: 'r1', inicio: '2026-09-10T20:30:00Z', recebido_em: '2026-09-10T02:51:21Z' }),
        calendly({ id: 'r2', inicio: '2026-09-10T20:45:00Z', recebido_em: '2026-09-10T09:22:54Z', situacao: 'Reagendamento' }),
        calendly({ id: 'r3', inicio: '2026-09-10T16:15:00Z', recebido_em: '2026-09-10T13:25:52Z', situacao: 'Reagendamento' }),
      ],
      new Set(),
      [],
    );
    expect(desmarcadas(lista)).toEqual({ r1: 'reagendada', r2: 'reagendada', r3: null });
  });

  it('com duas reuniões futuras do mesmo tipo, só marca quando o cancelamento desempata (Codex, PR #331)', () => {
    const a = calendly({ id: 'a', inicio: '2026-10-01T13:00:00Z', recebido_em: '2026-09-20T10:00:00Z' });
    const b = calendly({ id: 'b', inicio: '2026-10-02T13:00:00Z', recebido_em: '2026-09-21T10:00:00Z' });
    // O cliente reagendou a de 01/10 (A), não a de 02/10 (B).
    const c = calendly({ id: 'c', inicio: '2026-10-03T13:00:00Z', recebido_em: '2026-09-22T10:00:00Z', situacao: 'Reagendamento' });

    // Depois da 1013 o Calendly avisa o cancelamento de A: é ele.
    expect(desmarcadas(montarReunioesExternas([a, b, c], new Set([a.invitee_uri]), []))).toEqual({
      a: 'reagendada',
      b: null,
      c: null,
    });
    // Sem o aviso, é ambíguo: não marca nenhuma (B continua de pé).
    expect(desmarcadas(montarReunioesExternas([a, b, c], new Set(), []))).toEqual({ a: null, b: null, c: null });
  });

  it('não toma reunião que JÁ tinha acontecido quando o cliente reagendou, nem de outro tipo de evento', () => {
    const lista = montarReunioesExternas(
      [
        // Aconteceu em 08/09; o reagendamento de 20/09 não pode tê-la trocado.
        calendly({ id: 'passada', inicio: '2026-09-08T14:30:00Z', recebido_em: '2026-09-07T10:00:00Z' }),
        calendly({ id: 'outro-tipo', event_type_uri: 'https://api.calendly.com/event_types/OUTRO', inicio: '2026-09-25T13:00:00Z', recebido_em: '2026-09-19T10:00:00Z' }),
        calendly({ id: 'novo', inicio: '2026-09-26T13:00:00Z', recebido_em: '2026-09-20T10:00:00Z', situacao: 'Reagendamento' }),
      ],
      new Set(),
      [],
    );
    // O convite substituído não está aqui (chegou sem contato, por exemplo):
    // melhor não marcar nada do que marcar a reunião errada.
    expect(desmarcadas(lista)).toEqual({ passada: null, 'outro-tipo': null, novo: null });
  });

  it('o texto do reagendamento é o que o Calendly grava nas variáveis', () => {
    const agendamento: Agendamento = {
      evento: 'invitee.created',
      inviteeUri: 'https://api.calendly.com/scheduled_events/E/invitees/I',
      nome: 'Maria',
      email: null,
      telefone: '5583980000016',
      telefoneOrigem: 'pergunta',
      eventoUri: EVENTO,
      eventoNome: 'Reunião com Advogado',
      eventoAgendadoUri: 'https://api.calendly.com/scheduled_events/E',
      inicio: '2026-09-25T19:00:00.000000Z',
      fim: null,
      link: null,
      local: null,
      cancelarUrl: null,
      remarcarUrl: null,
      reagendado: true,
      fusoDoConvidado: null,
      perguntas: [],
    };
    const gravado = variaveisDoAgendamento(agendamento).agendamento_situacao;
    const [novo] = montarReunioesExternas([calendly({ id: 'a', situacao: gravado })], new Set(), []);
    expect(novo.reagendamento).toBe(true);

    const primeiro = variaveisDoAgendamento({ ...agendamento, reagendado: false }).agendamento_situacao;
    const [comum] = montarReunioesExternas([calendly({ id: 'b', situacao: primeiro })], new Set(), []);
    expect(comum.reagendamento).toBe(false);
  });

  it('a reunião da Kommo some quando o Calendly tem uma no MESMO instante, em outra grafia', () => {
    const lista = montarReunioesExternas(
      [calendly({ id: 'c', inicio: '2026-09-22T18:15:00.000000Z' })],
      new Set(),
      [kommo({ id: 'k1', reuniao_em: '2026-09-22 18:15:00+00' }), kommo({ id: 'k2', reuniao_em: '2026-07-10 14:00:00+00' })],
    );
    expect(lista.map((r) => r.id)).toEqual(['c', 'k2']);
  });

  it('o Calendly cancelado também tira a duplicata da Kommo (é a mesma reunião)', () => {
    const c = calendly({ id: 'c', inicio: '2026-09-22T18:15:00Z' });
    const lista = montarReunioesExternas([c], new Set([c.invitee_uri]), [kommo({ id: 'k', reuniao_em: '2026-09-22T18:15:00Z' })]);
    expect(desmarcadas(lista)).toEqual({ c: 'cancelada' });
  });

  it('dois leads da Kommo com a mesma data viram uma reunião só', () => {
    const lista = montarReunioesExternas([], new Set(), [
      kommo({ id: 'k1', reuniao_em: '2026-05-12 17:00:00+00', marcou_onde: 'Reunião com Advogado - Kommo' }),
      kommo({ id: 'k2', reuniao_em: '2026-05-12T17:00:00Z' }),
    ]);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ id: 'k1', origem: 'kommo', evento: 'Reunião com Advogado - Kommo', desmarcada: null });
  });

  it('ordena as duas origens juntas, do mais recente para o mais antigo', () => {
    const lista = montarReunioesExternas(
      [calendly({ id: 'set', inicio: '2026-09-10T12:00:00Z' }), calendly({ id: 'out', inicio: '2026-10-01T12:00:00Z' })],
      new Set(),
      [kommo({ id: 'jun', reuniao_em: '2026-06-01 12:00:00+00' })],
    );
    expect(lista.map((r) => r.id)).toEqual(['out', 'set', 'jun']);
  });

  it('linha sem instante legível fica de fora; texto vazio vira nulo', () => {
    const lista = montarReunioesExternas(
      [calendly({ id: 'sem', inicio: null }), calendly({ id: 'ok', event_type_nome: '  ', link: '', fim: 'lixo' })],
      new Set(),
      [kommo({ id: 'k', reuniao_em: null })],
    );
    expect(lista).toEqual([
      expect.objectContaining({ id: 'ok', evento: null, link: null, fim: null, inicio: '2026-09-22T13:00:00.000Z' }),
    ]);
  });
});

describe('lerReunioesExternas', () => {
  it('lê a resposta da rota', () => {
    const r = { id: 'a', origem: 'calendly', evento: 'X', inicio: '2026-09-22T13:00:00.000Z', fim: null, desmarcada: 'reagendada', reagendamento: false, link: null };
    expect(lerReunioesExternas({ reunioes: [r] })).toEqual([r]);
  });

  it('forma estranha é "não sei" (null), nunca lista vazia', () => {
    expect(lerReunioesExternas(null)).toBeNull();
    expect(lerReunioesExternas({})).toBeNull();
    expect(lerReunioesExternas({ error: 'db_error' })).toBeNull();
    expect(lerReunioesExternas({ reunioes: [{ id: 'a', origem: 'google', inicio: '2026-09-22T13:00:00Z' }] })).toBeNull();
    expect(lerReunioesExternas({ reunioes: [{ id: 'a', origem: 'kommo', inicio: 'ontem' }] })).toBeNull();
  });

  it('valor desconhecido não inventa desmarcação; booleano só liga com true', () => {
    const [r] = lerReunioesExternas({
      reunioes: [{ id: 'a', origem: 'kommo', inicio: '2026-05-12T17:00:00Z', desmarcada: 'sumiu', reagendamento: 1 }],
    })!;
    expect(r.desmarcada).toBeNull();
    expect(r.reagendamento).toBe(false);
  });
});

describe('reuniaoTerminou', () => {
  const r = { inicio: '2026-09-30T13:00:00Z', fim: '2026-09-30T13:30:00Z' };

  it('durante a reunião ela ainda não terminou (o link continua servindo)', () => {
    expect(reuniaoTerminou(r, new Date('2026-09-30T12:59:00Z'))).toBe(false);
    expect(reuniaoTerminou(r, new Date('2026-09-30T13:01:00Z'))).toBe(false);
    expect(reuniaoTerminou(r, new Date('2026-09-30T13:30:00Z'))).toBe(true);
  });

  it('sem o fim (Kommo), conta uma hora a partir do início', () => {
    const k = { inicio: '2026-09-30T13:00:00Z', fim: null };
    expect(reuniaoTerminou(k, new Date('2026-09-30T13:59:00Z'))).toBe(false);
    expect(reuniaoTerminou(k, new Date('2026-09-30T14:00:00Z'))).toBe(true);
  });
});

describe('intercalarHistorico', () => {
  it('põe a agenda e as externas numa ordem só', () => {
    const agenda = [{ id: 'm', starts_at: '2026-09-20T15:00:00+00:00' }] as Meeting[];
    const externas = montarReunioesExternas(
      [calendly({ id: 'c', inicio: '2026-09-25T15:00:00Z' })],
      new Set(),
      [kommo({ id: 'k', reuniao_em: '2026-08-01 15:00:00+00' })],
    );
    expect(intercalarHistorico(agenda, externas).map((i) => `${i.tipo}:${i.reuniao.id}`)).toEqual([
      'externa:c',
      'agenda:m',
      'externa:k',
    ]);
  });
});
