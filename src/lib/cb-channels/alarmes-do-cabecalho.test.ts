import { describe, expect, it } from 'vitest';

import type { ContextoDeAcesso, PerfilDeAcesso } from '@/lib/perfis/tipos';

import { alarmesDoCabecalho, alarmesPorConexao, type SaudeNoCabecalho } from './alarmes-do-cabecalho';

const ONTEM_20H = '2026-11-04T23:10:00.000Z';
const HOJE_9H = '2026-11-05T12:10:00.000Z';

function saude(over: Partial<SaudeNoCabecalho> & { id: string }): SaudeNoCabecalho {
  return { label: over.id.toUpperCase(), tone: 'ok', detail: null, atrasoSeg: null, ...over };
}

function perfil(channel_ids: string[]): PerfilDeAcesso {
  return {
    id: 'p',
    account_id: 'conta',
    nome: 'Perfil',
    papel_base: 'agent',
    telas: [],
    secoes_config: [],
    channel_ids,
    pipeline_ids: [],
    sistema: false,
  };
}

const ADMIN: ContextoDeAcesso = { papel: 'admin', perfil: perfil(['c1']) };
const SO_C1: ContextoDeAcesso = { papel: 'agent', perfil: perfil(['c1']) };
const SEM_PERFIL: ContextoDeAcesso = { papel: 'agent', perfil: null };

const alarmes = (lista: SaudeNoCabecalho[], acesso: ContextoDeAcesso = ADMIN) =>
  alarmesDoCabecalho({ saude: lista, carregando: false, falhou: false, acesso });

const todas = [
  saude({ id: 'c1', tone: 'warn', detail: 'sem_recibo', semReciboDesde: HOJE_9H }),
  saude({ id: 'c2', tone: 'down', detail: 'close' }),
  saude({ id: 'c3', episodios: [{ tipo: 'atraso', desdeIso: ONTEM_20H }], atrasoSeg: 45 * 60 }),
  saude({ id: 'c4', tone: 'ok' }),
];

describe('alarmesDoCabecalho — o alarme no botão das conexões (E1)', () => {
  it('o pior primeiro: fora do ar, sem recibo, não recebe, atrasada', () => {
    const lista = [
      saude({ id: 'a', episodios: [{ tipo: 'atraso', desdeIso: ONTEM_20H }] }),
      saude({ id: 'b', tone: 'warn', detail: 'webhook' }),
      saude({ id: 'c', tone: 'warn', detail: 'sem_recibo', semReciboDesde: HOJE_9H }),
      saude({ id: 'd', tone: 'down', detail: 'close' }),
    ];
    expect(alarmes(lista).map((a) => a.tipo)).toEqual(['fora_do_ar', 'sem_recibo', 'nao_recebe', 'atrasada']);
  });

  it('D2: owner/admin veem toda conexão, mesmo com o perfil recortado', () => {
    expect(alarmes(todas).map((a) => a.canalId).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('D2: o membro vê só as conexões do perfil; sem perfil, vê todas', () => {
    expect(alarmes(todas, SO_C1).map((a) => a.canalId)).toEqual(['c1']);
    expect(alarmes(todas, SEM_PERFIL)).toHaveLength(3);
  });

  it('⚠️ sonda carregando ou que FALHOU = sem alarme (a lista guardada é a de antes)', () => {
    expect(alarmesDoCabecalho({ saude: todas, carregando: true, falhou: false, acesso: ADMIN })).toEqual([]);
    expect(alarmesDoCabecalho({ saude: todas, carregando: false, falhou: true, acesso: ADMIN })).toEqual([]);
  });

  it('⚠️ o atraso AO VIVO não acende: só o episódio de 30 min (o reinício da Evolution fica no glifo e na conversa)', () => {
    const aoVivo = [saude({ id: 'c3', tone: 'warn', detail: 'lagging', atrasoSeg: 50 * 60 })];
    expect(alarmes(aoVivo)).toEqual([]);
    const comEpisodio = [{ ...aoVivo[0], episodios: [{ tipo: 'atraso' as const, desdeIso: ONTEM_20H }] }];
    expect(alarmes(comEpisodio)).toEqual([
      { canalId: 'c3', tipo: 'atrasada', rotulo: 'C3', desdeIso: ONTEM_20H, atrasoSeg: 50 * 60 },
    ]);
  });

  it('⚠️ o episódio guardado aparece com a sonda ao vivo já apagada: o alarme da madrugada visto às 8h', () => {
    const lista = [saude({ id: 'c1', episodios: [{ tipo: 'sem_recibo', desdeIso: ONTEM_20H }] })];
    expect(alarmes(lista)).toEqual([{ canalId: 'c1', tipo: 'sem_recibo', rotulo: 'C1', desdeIso: ONTEM_20H }]);
  });

  it('ao vivo e guardado juntos: uma linha, com o "desde" mais antigo', () => {
    const lista = [
      saude({
        id: 'c1',
        tone: 'warn',
        detail: 'sem_recibo',
        semReciboDesde: HOJE_9H,
        episodios: [{ tipo: 'sem_recibo', desdeIso: ONTEM_20H }],
      }),
    ];
    expect(alarmes(lista)).toEqual([{ canalId: 'c1', tipo: 'sem_recibo', rotulo: 'C1', desdeIso: ONTEM_20H }]);
  });

  it('UMA linha por conexão, com o pior motivo: fora do ar engole os episódios', () => {
    const lista = [
      saude({
        id: 'c1',
        tone: 'down',
        detail: 'close',
        episodios: [
          { tipo: 'sem_recibo', desdeIso: ONTEM_20H },
          { tipo: 'atraso', desdeIso: ONTEM_20H },
        ],
      }),
    ];
    expect(alarmes(lista)).toEqual([{ canalId: 'c1', tipo: 'fora_do_ar', rotulo: 'C1' }]);
  });

  it('episódios ilegíveis (null) ou de sonda antiga (ausentes): só o ao vivo', () => {
    const lista = [
      saude({ id: 'c1', tone: 'warn', detail: 'webhook', episodios: null }),
      saude({ id: 'c2', tone: 'warn', detail: 'lagging', atrasoSeg: 40 * 60 }),
    ];
    expect(alarmes(lista)).toEqual([{ canalId: 'c1', tipo: 'nao_recebe', rotulo: 'C1' }]);
  });

  it('⚠️ o sem recibo AO VIVO atrás de outro motivo (fila represada: lagging; lastError) alarga do mesmo jeito', () => {
    const lista = [
      saude({ id: 'c1', tone: 'warn', detail: 'lagging', atrasoSeg: 8 * 60, semReciboDesde: HOJE_9H }),
      saude({ id: 'c2', tone: 'warn', detail: 'lastError', semReciboDesde: ONTEM_20H }),
    ];
    expect(alarmes(lista)).toEqual([
      { canalId: 'c1', tipo: 'sem_recibo', rotulo: 'C1', desdeIso: HOJE_9H },
      { canalId: 'c2', tipo: 'sem_recibo', rotulo: 'C2', desdeIso: ONTEM_20H },
    ]);
  });

  it('os alarmes da SENTINELA entram, com o "desde" dela (Fase 4)', () => {
    const lista = [
      saude({ id: 'c1', sentinela: [{ chave: 'quedas', desdeIso: ONTEM_20H }] }),
      saude({ id: 'c2', sentinela: [{ chave: 'sem_entrada', desdeIso: HOJE_9H }] }),
    ];
    expect(alarmes(lista)).toEqual([
      { canalId: 'c1', tipo: 'quedas', rotulo: 'C1', desdeIso: ONTEM_20H },
      { canalId: 'c2', tipo: 'sem_entrada', rotulo: 'C2', desdeIso: HOJE_9H },
    ]);
  });

  it('UMA linha por conexão, a pior de TODAS as fontes: mensagens perdidas vencem o sem recibo; o sem recibo vence a queda', () => {
    const perdidas = saude({
      id: 'c1',
      semReciboDesde: HOJE_9H,
      sentinela: [
        { chave: 'quedas', desdeIso: ONTEM_20H },
        { chave: 'nao_gravadas', desdeIso: ONTEM_20H },
      ],
    });
    expect(alarmes([perdidas]).map((a) => a.tipo)).toEqual(['nao_gravadas']);
    const semRecibo = saude({ id: 'c2', semReciboDesde: HOJE_9H, sentinela: [{ chave: 'quedas', desdeIso: ONTEM_20H }] });
    expect(alarmes([semRecibo]).map((a) => a.tipo)).toEqual(['sem_recibo']);
    const foraDoAr = saude({ id: 'c3', tone: 'down', detail: 'closed', sentinela: [{ chave: 'nao_gravadas', desdeIso: ONTEM_20H }] });
    expect(alarmes([foraDoAr]).map((a) => a.tipo)).toEqual(['fora_do_ar']);
  });

  it('a ordem da conta mistura as fontes pela gravidade', () => {
    const lista = [
      saude({ id: 'a', episodios: [{ tipo: 'atraso', desdeIso: ONTEM_20H }] }),
      saude({ id: 'b', sentinela: [{ chave: 'falhas', desdeIso: ONTEM_20H }] }),
      saude({ id: 'c', tone: 'warn', detail: 'webhook' }),
      saude({ id: 'd', sentinela: [{ chave: 'sem_entrada', desdeIso: ONTEM_20H }] }),
      saude({ id: 'e', sentinela: [{ chave: 'quedas', desdeIso: ONTEM_20H }] }),
      saude({ id: 'f', semReciboDesde: HOJE_9H }),
      saude({ id: 'g', sentinela: [{ chave: 'nao_gravadas', desdeIso: ONTEM_20H }] }),
      saude({ id: 'h', tone: 'down', detail: 'closed' }),
    ];
    expect(alarmes(lista).map((a) => a.tipo)).toEqual([
      'fora_do_ar',
      'nao_gravadas',
      'sem_recibo',
      'quedas',
      'sem_entrada',
      'nao_recebe',
      'falhas',
      'atrasada',
    ]);
  });

  it('a FICHA de cada conexão recebe TODOS os alarmes dela, do pior para o mais leve; o botão, só o pior', () => {
    const lista = [
      saude({
        id: 'c1',
        semReciboDesde: HOJE_9H,
        episodios: [{ tipo: 'atraso', desdeIso: ONTEM_20H }],
        sentinela: [{ chave: 'quedas', desdeIso: ONTEM_20H }],
      }),
      saude({ id: 'c2' }),
    ];
    const porConexao = alarmesPorConexao({ saude: lista, carregando: false, falhou: false });
    expect(porConexao.get('c1')?.map((a) => a.tipo)).toEqual(['sem_recibo', 'quedas', 'atrasada']);
    expect(porConexao.has('c2')).toBe(false);
    expect(alarmes(lista).map((a) => a.tipo)).toEqual(['sem_recibo']);
  });

  it('a ficha mostra os alarmes de toda conexão (o recorte D2 é só do botão) e cala com a sonda carregando ou que falhou', () => {
    const lista = [saude({ id: 'c3', semReciboDesde: HOJE_9H })];
    expect(alarmes(lista, SO_C1)).toEqual([]);
    const ficha = alarmesPorConexao({ saude: lista, carregando: false, falhou: false });
    expect(ficha.get('c3')?.map((a) => a.tipo)).toEqual(['sem_recibo']);
    expect(alarmesPorConexao({ saude: lista, carregando: true, falhou: false }).size).toBe(0);
    expect(alarmesPorConexao({ saude: lista, carregando: false, falhou: true }).size).toBe(0);
  });

  it('os transitórios (stale, pairing, lastError) não acendem', () => {
    const lista = [
      saude({ id: 'c5', tone: 'warn', detail: 'stale' }),
      saude({ id: 'c6', tone: 'warn', detail: 'pairing' }),
      saude({ id: 'c7', tone: 'warn', detail: 'lastError' }),
    ];
    expect(alarmes(lista)).toEqual([]);
  });
});

describe('o computador de ligações no botão (4e)', () => {
  it('os episódios dele viram alarme, os mais leves da conexão', () => {
    const lista = [
      saude({
        id: 'c1',
        episodios: [
          { tipo: 'computador_qr', desdeIso: HOJE_9H },
          { tipo: 'atraso', desdeIso: ONTEM_20H },
          { tipo: 'computador_fora', desdeIso: ONTEM_20H },
        ],
      }),
    ];
    const porConexao = alarmesPorConexao({ saude: lista, carregando: false, falhou: false });
    expect(porConexao.get('c1')?.map((a) => a.tipo)).toEqual(['atrasada', 'ligacoes_fora', 'ligacoes_qr']);
    expect(alarmes(lista)[0].tipo).toBe('atrasada');
    expect(alarmes([saude({ id: 'c1', episodios: [{ tipo: 'computador_fora', desdeIso: ONTEM_20H }] })])).toEqual([
      { canalId: 'c1', tipo: 'ligacoes_fora', rotulo: 'C1', desdeIso: ONTEM_20H },
    ]);
  });
});
