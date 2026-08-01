import { describe, expect, it } from 'vitest';

import {
  apareceNaConversa,
  chaveDoAutor,
  chaveDoTexto,
  direcaoDoMovimento,
  intercalar,
  ordenarPorTempo,
} from './describe';
import type { LeadEvent } from '@/types';

function evento(patch: Partial<LeadEvent>): LeadEvent {
  return {
    id: 'e1',
    account_id: 'conta-1',
    contact_id: 'contato-1',
    contact_label: 'Maria Silva',
    deal_id: 'negocio-1',
    conversation_id: null,
    event_type: 'stage_changed',
    occurred_at: '2026-07-27T12:00:00+00:00',
    actor_user_id: null,
    actor_label: null,
    origin: 'usuario',
    from_pipeline_id: null,
    from_pipeline_label: null,
    to_pipeline_id: null,
    to_pipeline_label: null,
    from_stage_id: null,
    from_stage_label: null,
    from_stage_position: null,
    to_stage_id: null,
    to_stage_label: null,
    to_stage_position: null,
    from_status: null,
    to_status: null,
    tag_id: null,
    tag_label: null,
    tag_color: null,
    channel_id: null,
    channel_label: null,
    reconstructed: false,
    details: null,
    created_at: '2026-07-27T12:00:00+00:00',
    ...patch,
  };
}

describe('direcaoDoMovimento', () => {
  it('lê avanço e retorno pela POSIÇÃO, não pelo rótulo', () => {
    // Se um dia isto passar a olhar o nome da etapa, "Proposta" → "Lead"
    // deixaria de ser um retorno visível e o operador perderia o único sinal
    // de que o lead esfriou.
    expect(direcaoDoMovimento(evento({ from_stage_position: 0, to_stage_position: 2 }))).toBe(
      'avanco',
    );
    expect(direcaoDoMovimento(evento({ from_stage_position: 3, to_stage_position: 1 }))).toBe(
      'retorno',
    );
    expect(direcaoDoMovimento(evento({ from_stage_position: 1, to_stage_position: 1 }))).toBe(
      'lateral',
    );
  });

  it('não inventa direção quando falta posição', () => {
    expect(direcaoDoMovimento(evento({ from_stage_position: null, to_stage_position: 2 }))).toBe(
      null,
    );
  });

  it('não compara posições entre funis diferentes', () => {
    // Réguas distintas: o Bancário pode ter 8 etapas e o Trabalhista 3.
    // Dizer "avançou" ali seria inventar uma escala comum que não existe.
    expect(
      direcaoDoMovimento(
        evento({
          event_type: 'pipeline_changed',
          from_stage_position: 0,
          to_stage_position: 2,
        }),
      ),
    ).toBe(null);
  });

  it('posição zero conta como posição, não como ausente', () => {
    // Blindagem contra `if (!posicao)`: a etapa de entrada real desta conta
    // fica na posição 0, então falsy-check sumiria com metade dos avanços.
    expect(direcaoDoMovimento(evento({ from_stage_position: 0, to_stage_position: 1 }))).toBe(
      'avanco',
    );
  });
});

describe('apareceNaConversa', () => {
  it('esconde exclusão de negócio', () => {
    // Apagar um funil cascateia TODOS os negócios dele: com 200 cards isso
    // despejaria uma linha solta em 200 conversas sem relação entre si.
    expect(apareceNaConversa(evento({ event_type: 'deal_deleted' }))).toBe(false);
  });

  it('esconde linha retroativa', () => {
    // Ela carrega a data de criação do card: no meio da conversa apareceria
    // um "negócio criado" ANTES da primeira mensagem, que ninguém viu.
    expect(apareceNaConversa(evento({ event_type: 'deal_created', reconstructed: true }))).toBe(
      false,
    );
  });

  it('mostra o que o operador pediu para ver no chat', () => {
    for (const tipo of [
      'deal_created',
      'stage_changed',
      'pipeline_changed',
      'status_changed',
      'tag_added',
      'tag_removed',
    ] as const) {
      expect(apareceNaConversa(evento({ event_type: tipo }))).toBe(true);
    }
  });
});

describe('chaveDoTexto', () => {
  it('escolhe a frase pela direção do movimento', () => {
    expect(chaveDoTexto(evento({ from_stage_position: 0, to_stage_position: 1 }))).toBe(
      'stageAdvanced',
    );
    expect(chaveDoTexto(evento({ from_stage_position: 2, to_stage_position: 1 }))).toBe(
      'stageReturned',
    );
    expect(chaveDoTexto(evento({}))).toBe('stageChanged');
  });

  it('separa ganho, perda e reabertura', () => {
    expect(chaveDoTexto(evento({ event_type: 'status_changed', to_status: 'won' }))).toBe(
      'statusWon',
    );
    expect(chaveDoTexto(evento({ event_type: 'status_changed', to_status: 'lost' }))).toBe(
      'statusLost',
    );
    expect(chaveDoTexto(evento({ event_type: 'status_changed', to_status: 'open' }))).toBe(
      'statusReopened',
    );
  });
});

describe('chaveDoAutor', () => {
  it('o nome congelado ganha do estado atual', () => {
    // A trilha responde "quem era", não "quem é": trocar isto por um lookup
    // no perfil atual faria o histórico mudar sozinho quando alguém se
    // renomeia — e trilha que muda sozinha não serve de prova.
    expect(chaveDoAutor(evento({ actor_label: 'Ana', origin: 'usuario' }))).toEqual({
      chave: 'actorPerson',
      nome: 'Ana',
    });
  });

  it('sem ator, cai na origem', () => {
    expect(
      chaveDoAutor(evento({ origin: 'conexao', channel_label: 'Bancário' })),
    ).toEqual({ chave: 'actorChannel', nome: 'Bancário' });
    expect(chaveDoAutor(evento({ origin: 'automacao' })).chave).toBe('actorAutomation');
    expect(chaveDoAutor(evento({ origin: 'retroativo' })).chave).toBe('actorReconstructed');
  });

  it('origem "usuario" sem nome vira sistema, não um nome inventado', () => {
    // Acontece quando o perfil de quem agiu foi removido depois.
    expect(chaveDoAutor(evento({ origin: 'usuario', actor_label: null })).chave).toBe(
      'actorSystem',
    );
  });
});

describe('ordenarPorTempo', () => {
  it('ordena do mais antigo para o mais novo', () => {
    const a = evento({ id: 'a', occurred_at: '2026-07-27T10:00:00+00:00' });
    const b = evento({ id: 'b', occurred_at: '2026-07-27T09:00:00+00:00' });
    expect(ordenarPorTempo([a, b]).map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('respeita microssegundos', () => {
    // `clock_timestamp()` dá microssegundo, e dois eventos da mesma transação
    // (transferir de funil + marcar como ganho) caem no mesmo milissegundo.
    // Passar por `Date` aqui empataria os dois e a ordem viraria sorteio.
    const a = evento({ id: 'a', occurred_at: '2026-07-27T10:00:00.123456+00:00' });
    const b = evento({ id: 'b', occurred_at: '2026-07-27T10:00:00.123457+00:00' });
    expect(ordenarPorTempo([b, a]).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('empate resolve estável, sem embaralhar entre renders', () => {
    const a = evento({ id: 'aaa', occurred_at: '2026-07-27T10:00:00+00:00' });
    const b = evento({ id: 'bbb', occurred_at: '2026-07-27T10:00:00+00:00' });
    expect(ordenarPorTempo([b, a]).map((e) => e.id)).toEqual(['aaa', 'bbb']);
    expect(ordenarPorTempo([a, b]).map((e) => e.id)).toEqual(['aaa', 'bbb']);
  });

  it('não muta a lista recebida', () => {
    const lista = [
      evento({ id: 'a', occurred_at: '2026-07-27T10:00:00+00:00' }),
      evento({ id: 'b', occurred_at: '2026-07-27T09:00:00+00:00' }),
    ];
    ordenarPorTempo(lista);
    expect(lista.map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('intercalar', () => {
  const msg = (id: string, created_at: string) => ({ id, created_at });

  it('põe o evento entre as mensagens certas', () => {
    const itens = intercalar(
      [msg('m1', '2026-07-27T09:00:00+00:00'), msg('m2', '2026-07-27T11:00:00+00:00')],
      [evento({ id: 'e1', occurred_at: '2026-07-27T10:00:00+00:00' })],
    );
    expect(itens.map((i) => i.chave)).toEqual(['m:m1', 'e:e1', 'm:m2']);
  });

  it('filtra o que não vai para a conversa', () => {
    const itens = intercalar(
      [msg('m1', '2026-07-27T09:00:00+00:00')],
      [
        evento({ id: 'e1', occurred_at: '2026-07-27T10:00:00+00:00', event_type: 'deal_deleted' }),
        evento({ id: 'e2', occurred_at: '2026-07-27T10:00:00+00:00', reconstructed: true }),
      ],
    );
    expect(itens.map((i) => i.chave)).toEqual(['m:m1']);
  });

  it('sem eventos, devolve só as mensagens na ordem', () => {
    // O caminho de todo dia: conta sem nenhuma mudança de funil registrada.
    const itens = intercalar(
      [msg('m1', '2026-07-27T09:00:00+00:00'), msg('m2', '2026-07-27T10:00:00+00:00')],
      [],
    );
    expect(itens.map((i) => i.chave)).toEqual(['m:m1', 'm:m2']);
    expect(itens.every((i) => i.evento === undefined)).toBe(true);
  });

  it('cada item carrega EXATAMENTE UMA das três fatias', () => {
    // O render discrimina por truthiness e termina em `item.mensagem!` — um
    // item com duas fatias, ou com nenhuma, vira crash naquele `!`.
    //
    // ⚠️ Escrito como contagem, e não como XOR de dois: a versão anterior era
    // `Boolean(mensagem) !== Boolean(evento)`, que passa a dar FALSO
    // NEGATIVO assim que existe uma terceira fatia — um item só com nota dá
    // `false !== false`. Se uma quarta fatia aparecer, este teste continua
    // certo sem ser reescrito.
    const itens = intercalar(
      [msg('m1', '2026-07-27T09:00:00+00:00')],
      [evento({ id: 'e1', occurred_at: '2026-07-27T10:00:00+00:00' })],
      [nota('n1', '2026-07-27T10:30:00+00:00')],
    );
    expect(itens).toHaveLength(3);
    for (const item of itens) {
      const preenchidas = [item.mensagem, item.evento, item.nota].filter(Boolean);
      expect(preenchidas).toHaveLength(1);
    }
  });

  it('intercala a anotação na hora certa, entre mensagem e evento', () => {
    const itens = intercalar(
      [msg('m1', '2026-07-27T09:00:00+00:00'), msg('m2', '2026-07-27T12:00:00+00:00')],
      [evento({ id: 'e1', occurred_at: '2026-07-27T11:00:00+00:00' })],
      [nota('n1', '2026-07-27T10:00:00+00:00')],
    );
    expect(itens.map((i) => i.chave)).toEqual(['m:m1', 'n:n1', 'e:e1', 'm:m2']);
  });

  it('a anotação é opcional — quem não passa notas continua funcionando', () => {
    // Garante que acrescentar a fatia não obrigou os call sites antigos a
    // mudar. Se o parâmetro deixar de ter default, isto quebra.
    const itens = intercalar([msg('m1', '2026-07-27T09:00:00+00:00')], []);
    expect(itens.map((i) => i.chave)).toEqual(['m:m1']);
    expect(itens.every((i) => i.nota === undefined)).toBe(true);
  });

  it('empate exato de horário não troca de lugar entre renderizações', () => {
    // A chave é o único desempate. Com prefixos distintos a ordem é estável e
    // determinística: 'e:' < 'm:' < 'n:' byte a byte.
    const mesmo = '2026-07-27T10:00:00+00:00';
    const primeira = intercalar([msg('x', mesmo)], [evento({ id: 'x', occurred_at: mesmo })], [
      nota('x', mesmo),
    ]);
    const segunda = intercalar([msg('x', mesmo)], [evento({ id: 'x', occurred_at: mesmo })], [
      nota('x', mesmo),
    ]);
    expect(primeira.map((i) => i.chave)).toEqual(['e:x', 'm:x', 'n:x']);
    expect(primeira.map((i) => i.chave)).toEqual(segunda.map((i) => i.chave));
  });
});
