import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { VIAS } from '@/lib/conversations/origem-da-escrita';
import {
  apareceNaConversa,
  chaveDoAutor,
  chaveDoTexto,
  complementoDoResponsavel,
  direcaoDoMovimento,
  intercalar,
  juntarEventos,
  ordenarPorTempo,
  viaDoEvento,
} from './describe';
import type { LeadEvent, ConversationNote } from '@/types';

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

describe('juntarEventos', () => {
  it('evento do tempo real entra no lugar do tempo dele', () => {
    const naTela = [
      evento({ id: 'a', occurred_at: '2026-09-28T14:00:00+00:00' }),
      evento({ id: 'c', occurred_at: '2026-09-28T16:00:00+00:00' }),
    ];
    const novo = evento({ id: 'b', occurred_at: '2026-09-28T15:00:00+00:00' });
    expect(juntarEventos(naTela, [novo]).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('não repete o evento que chegou pelas duas vias', () => {
    const buscado = evento({ id: 'a', occurred_at: '2026-09-28T14:00:00+00:00' });
    const chegado = evento({ id: 'a', occurred_at: '2026-09-28T14:00:00+00:00' });
    expect(juntarEventos([buscado], [chegado])).toHaveLength(1);
  });

  it('no id repetido vale a versão da PRIMEIRA lista', () => {
    // A busca que volta passa a sua lista primeiro: a versão do PostgREST
    // vence a do canal.
    const buscado = evento({ id: 'a', to_stage_label: 'da busca' });
    const chegado = evento({ id: 'a', to_stage_label: 'do canal' });
    expect(juntarEventos([buscado], [chegado])[0].to_stage_label).toBe('da busca');
    expect(juntarEventos([chegado], [buscado])[0].to_stage_label).toBe('do canal');
  });

  it('a busca que volta depois de um evento chegar não o perde', () => {
    // A foto da busca é anterior ao evento: ele só existe na tela.
    const buscados = [evento({ id: 'a', occurred_at: '2026-09-28T14:00:00+00:00' })];
    const chegados = [evento({ id: 'b', occurred_at: '2026-09-28T14:35:00+00:00' })];
    expect(juntarEventos(buscados, chegados).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('não muta as listas recebidas', () => {
    const primeira = [evento({ id: 'b', occurred_at: '2026-09-28T15:00:00+00:00' })];
    const segunda = [evento({ id: 'a', occurred_at: '2026-09-28T14:00:00+00:00' })];
    juntarEventos(primeira, segunda);
    expect(primeira.map((e) => e.id)).toEqual(['b']);
    expect(segunda.map((e) => e.id)).toEqual(['a']);
  });
});

/** Item de execução já colapsado, como `itensDoFio` o entrega. */
function execucao(quando: string, vezes = 1) {
  const dia = quando.slice(0, 10);
  return {
    chave: `aut-1|${dia}|concluida`,
    quando,
    desfecho: 'concluida' as const,
    nome: 'Contrato fechado',
    vezes,
    execucaoId: 'log-1',
  };
}

describe('intercalar', () => {
  const msg = (id: string, created_at: string) => ({ id, created_at });
  const nota = (id: string, created_at: string): ConversationNote => ({
    id,
    account_id: 'conta',
    conversation_id: 'conversa',
    contact_id: null,
    author_user_id: 'quem',
    autor_nome: 'Alguém',
    texto: 'anotação',
    mencionados: [],
    fixada_em: null,
    resposta_de: null,
    created_at,
  });

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
      [execucao('2026-07-27T11:00:00+00:00')],
    );
    expect(itens).toHaveLength(4);
    for (const item of itens) {
      const preenchidas = [item.mensagem, item.evento, item.nota, item.execucao].filter(Boolean);
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

  // --- a quarta fatia: execução de automação encerrada (985) ---
  it('entra na ordem cronológica, junto das outras três', () => {
    const itens = intercalar(
      [msg('m1', '2026-07-27T09:00:00+00:00'), msg('m2', '2026-07-27T12:00:00+00:00')],
      [evento({ id: 'e1', occurred_at: '2026-07-27T11:00:00+00:00' })],
      [nota('n1', '2026-07-27T10:00:00+00:00')],
      [execucao('2026-07-27T11:30:00+00:00')],
    );
    expect(itens.map((i) => i.chave)).toEqual([
      'm:m1',
      'n:n1',
      'e:e1',
      'x:aut-1|2026-07-27|concluida',
      'm:m2',
    ]);
  });

  it('é opcional — os call sites antigos continuam funcionando', () => {
    // Mesma garantia que a nota tem: se o parâmetro perder o default, isto
    // quebra em vez de obrigar quem passa três argumentos a mudar.
    const itens = intercalar([msg('m1', '2026-07-27T09:00:00+00:00')], []);
    expect(itens.map((i) => i.chave)).toEqual(['m:m1']);
    expect(itens.every((i) => i.execucao === undefined)).toBe(true);
  });

  it('empate exato com uma anotação tem ordem determinística', () => {
    // A chave é o desempate, e `n:` vem antes de `x:` byte a byte. O que
    // importa não é QUAL vem primeiro, é a ordem não mudar entre renders.
    const mesmo = '2026-07-27T10:00:00+00:00';
    const uma = intercalar([], [], [nota('n1', mesmo)], [execucao(mesmo)]);
    const outra = intercalar([], [], [nota('n1', mesmo)], [execucao(mesmo)]);
    expect(uma.map((i) => i.chave)).toEqual(outra.map((i) => i.chave));
    expect(uma.map((i) => i.chave)).toEqual(['n:n1', 'x:aut-1|2026-07-27|concluida']);
  });

  it('a chave é a do GRUPO, não de uma linha — três conclusões do dia ocupam uma posição', () => {
    // É o que a régua de `itensDoFio` produz: `automação|dia|desfecho`. Se a
    // chave fosse o id do log, o colapso não teria posição estável no fio.
    const itens = intercalar([], [], [], [execucao('2026-07-27T18:00:00+00:00', 3)]);
    expect(itens).toHaveLength(1);
    expect(itens[0].execucao?.vezes).toBe(3);
  });
});

// ============================================================
// A trilha da CONVERSA (1083): quem abriu, encerrou, deixou pendente ou
// trocou o responsável.
// ============================================================

const ANA = '00000000-0000-4000-8000-000000000002';
const BRUNO = '00000000-0000-4000-8000-000000000001';

function daConversa(patch: Partial<LeadEvent>): LeadEvent {
  return evento({
    deal_id: null,
    conversation_id: 'conv-1',
    event_type: 'conversation_status_changed',
    origin: 'sistema',
    ...patch,
  });
}

describe('conversa (1083) — o que aparece no fio', () => {
  it('mudança de situação e de responsável aparecem', () => {
    expect(apareceNaConversa(daConversa({ from_status: 'open', to_status: 'closed' }))).toBe(true);
    expect(apareceNaConversa(daConversa({ event_type: 'conversation_assigned' }))).toBe(true);
  });

  it.each(['cliente', 'celular', 'ligacao'])(
    'criação pela mensagem (%s) fica só no Histórico: a primeira bolha já diz quem começou',
    (via) => {
      expect(apareceNaConversa(daConversa({ from_status: null, to_status: 'open', details: { via } }))).toBe(false);
    },
  );

  it('criação por automação, webhook ou pessoa aparece ("criada já encerrada" explica o Encerradas)', () => {
    expect(
      apareceNaConversa(daConversa({ from_status: null, to_status: 'closed', details: { via: 'webhook' } })),
    ).toBe(true);
    expect(
      apareceNaConversa(
        daConversa({ from_status: null, to_status: 'open', actor_label: 'Ana', details: { via: 'envio' } }),
      ),
    ).toBe(true);
  });

  it('reabrir pelo cliente aparece (não é criação)', () => {
    expect(
      apareceNaConversa(daConversa({ from_status: 'closed', to_status: 'open', details: { via: 'cliente' } })),
    ).toBe(true);
  });
});

describe('conversa (1083) — a frase da situação', () => {
  it.each([
    [null, 'open', 'conversationStarted'],
    [null, 'closed', 'conversationCreatedClosed'],
    [null, 'pending', 'conversationCreatedPending'],
    ['open', 'closed', 'conversationClosed'],
    ['pending', 'closed', 'conversationClosed'],
    ['closed', 'open', 'conversationReopened'],
    ['closed', 'pending', 'conversationReopenedPending'],
    ['open', 'pending', 'conversationPending'],
    ['pending', 'open', 'conversationOpened'],
  ] as const)('%s → %s = %s', (de, para, chave) => {
    expect(chaveDoTexto(daConversa({ from_status: de, to_status: para }))).toBe(chave);
  });

  it('responsável: pelo ID, não pelo nome (o nome falta quando o membro saiu)', () => {
    const atribuida = daConversa({ event_type: 'conversation_assigned', details: { para_responsavel_id: ANA } });
    const trocada = daConversa({
      event_type: 'conversation_assigned',
      details: { de_responsavel_id: BRUNO, para_responsavel_id: ANA },
    });
    const solta = daConversa({ event_type: 'conversation_assigned', details: { de_responsavel_id: BRUNO } });
    expect(chaveDoTexto(atribuida)).toBe('conversationAssigned');
    expect(chaveDoTexto(trocada)).toBe('conversationReassigned');
    expect(chaveDoTexto(solta)).toBe('conversationUnassigned');
  });
});

describe('conversa (1083) — o responsável que mudou junto', () => {
  const fechou = (patch: Partial<LeadEvent>) =>
    daConversa({
      from_status: 'open',
      to_status: 'closed',
      details: { responsavel_mudou: true, de_responsavel_id: BRUNO, de_responsavel: 'Bruno' },
      ...patch,
    });

  it('quem encerrou NÃO era o responsável: "(estava com Bruno)"', () => {
    expect(complementoDoResponsavel(fechou({ actor_user_id: ANA, actor_label: 'Ana' }))).toEqual({
      chave: 'suffixWasWith',
      nome: 'Bruno',
    });
  });

  it('o próprio responsável encerrou: nada a acrescentar', () => {
    expect(complementoDoResponsavel(fechou({ actor_user_id: BRUNO, actor_label: 'Bruno' }))).toBeNull();
  });

  it('a automação encerrou a de alguém: "(estava com …)"', () => {
    expect(complementoDoResponsavel(fechou({ details: { ...fechou({}).details, via: 'automacao' } }))).toEqual({
      chave: 'suffixWasWith',
      nome: 'Bruno',
    });
  });

  it('o robô deixou pendente com a Ana: "e atribuída a Ana"', () => {
    const robo = daConversa({
      from_status: 'open',
      to_status: 'pending',
      details: { via: 'robo', responsavel_mudou: true, para_responsavel_id: ANA, para_responsavel: 'Ana' },
    });
    expect(complementoDoResponsavel(robo)).toEqual({ chave: 'suffixAssignedTo', nome: 'Ana' });
  });

  it('reabrir enviando atribui a quem enviou: não repete o nome', () => {
    const envio = daConversa({
      from_status: 'closed',
      to_status: 'open',
      actor_user_id: ANA,
      actor_label: 'Ana',
      details: { via: 'envio', responsavel_mudou: true, para_responsavel_id: ANA, para_responsavel: 'Ana' },
    });
    expect(complementoDoResponsavel(envio)).toBeNull();
  });

  it('o cliente reabriu (o responsável velho foi solto): nada a acrescentar', () => {
    const cliente = daConversa({
      from_status: 'closed',
      to_status: 'open',
      details: { via: 'cliente', responsavel_mudou: true, de_responsavel_id: BRUNO, de_responsavel: 'Bruno' },
    });
    expect(complementoDoResponsavel(cliente)).toBeNull();
  });

  it('booleano de JSONB só vale com === true ("true" de texto não liga)', () => {
    expect(
      complementoDoResponsavel(fechou({ details: { responsavel_mudou: 'true', de_responsavel_id: BRUNO } })),
    ).toBeNull();
  });

  it('mudança só de responsável não ganha complemento (a frase já diz tudo)', () => {
    expect(
      complementoDoResponsavel(
        daConversa({ event_type: 'conversation_assigned', details: { responsavel_mudou: true } }),
      ),
    ).toBeNull();
  });
});

describe('conversa (1083) — quem fez', () => {
  it('a pessoa ganha de qualquer via', () => {
    expect(chaveDoAutor(daConversa({ actor_label: 'Ana', details: { via: 'envio' } }))).toEqual({
      chave: 'actorPerson',
      nome: 'Ana',
    });
  });

  it.each([
    ['cliente', 'actorCustomer'],
    ['celular', 'actorPhone'],
    ['ligacao', 'actorCall'],
    ['api', 'actorApi'],
    ['automacao', 'actorAutomation'],
    ['regua', 'actorBilling'],
    ['robo', 'actorFlow'],
    ['agente', 'actorAgent'],
    ['agendamento', 'actorScheduling'],
    ['webhook', 'actorIntegration'],
  ] as const)('via %s sem nome = %s', (via, chave) => {
    expect(chaveDoAutor(daConversa({ details: { via } })).chave).toBe(chave);
  });

  it.each([
    ['automacao', 'actorAutomationNamed'],
    ['regua', 'actorAutomationNamed'],
    ['robo', 'actorFlowNamed'],
    ['agente', 'actorAgentNamed'],
  ] as const)('via %s com o nome congelado = %s', (via, chave) => {
    expect(chaveDoAutor(daConversa({ details: { via, ref_nome: 'Follow-up' } }))).toEqual({ chave, nome: 'Follow-up' });
  });

  it('envio sem pessoa (saiu da conta) e via desconhecida caem na origem', () => {
    expect(chaveDoAutor(daConversa({ details: { via: 'envio' } })).chave).toBe('actorSystem');
    expect(chaveDoAutor(daConversa({ details: { via: 'hacker' } })).chave).toBe('actorSystem');
    expect(viaDoEvento(daConversa({ details: { via: 'hacker' } }))).toBeNull();
  });
});

describe('conversa (1083) — toda chave que a leitura devolve existe nos DOIS dicionários', () => {
  // Chave montada escapa dos portões estáticos (CLAUDE.md, seção 9): a lista
  // é COLHIDA da própria leitura, varrendo as combinações, nunca digitada.
  const dicionario = (arquivo: string) =>
    JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'messages', arquivo), 'utf8'))
      .LeadEvents as Record<string, string>;

  const chaves = new Set<string>();
  const situacoes = [null, 'open', 'pending', 'closed'];
  for (const de of situacoes) {
    for (const para of ['open', 'pending', 'closed']) {
      if (de === para) continue;
      const e = daConversa({
        from_status: de,
        to_status: para,
        details: { responsavel_mudou: true, de_responsavel_id: BRUNO, para_responsavel_id: ANA },
      });
      chaves.add(chaveDoTexto(e));
      const c = complementoDoResponsavel(e);
      if (c) chaves.add(c.chave);
    }
  }
  for (const details of [{ para_responsavel_id: ANA }, { de_responsavel_id: BRUNO, para_responsavel_id: ANA }, { de_responsavel_id: BRUNO }]) {
    chaves.add(chaveDoTexto(daConversa({ event_type: 'conversation_assigned', details })));
  }
  for (const via of [...VIAS, 'nenhuma']) {
    chaves.add(chaveDoAutor(daConversa({ details: { via } })).chave);
    chaves.add(chaveDoAutor(daConversa({ details: { via, ref_nome: 'X' } })).chave);
  }
  for (const origin of ['usuario', 'conexao', 'automacao', 'sistema', 'retroativo'] as const) {
    chaves.add(chaveDoAutor(evento({ origin })).chave);
  }

  for (const arquivo of ['en.json', 'pt-BR.json']) {
    it(`${arquivo} tem as ${chaves.size} chaves`, () => {
      const lido = dicionario(arquivo);
      const faltam = [...chaves].filter((c) => typeof lido[c] !== 'string');
      expect(faltam).toEqual([]);
    });
  }

  it('a varredura alcança os dois complementos e todas as frases da conversa', () => {
    for (const c of ['suffixWasWith', 'suffixAssignedTo', 'conversationStarted', 'conversationOpened']) {
      expect(chaves).toContain(c);
    }
  });
});
