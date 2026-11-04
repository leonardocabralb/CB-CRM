import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';
import type { PerfilDeAcesso } from '@/lib/perfis/tipos';

import {
  ATRASO_DO_SINO_SEG,
  LEMBRETE_MS,
  decidir,
  destinatarios,
  emHorarioUtil,
  medirAtraso,
  medirSemRecibo,
  textosDoAviso,
  type EstadoDoAlarme,
  type Medicao,
  type MembroDaConta,
  type Motivo,
  type TipoDoAlarme,
  type Tradutor,
} from './alarmes-no-sino';
import type { EnvioRecente } from './sem-recibo';

const MIN = 60_000;
const H = 60 * MIN;
// Quarta-feira, 04/11/2026, 09:00 de Brasília.
const AGORA = Date.parse('2026-11-04T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('emHorarioUtil — segunda a sexta, 8h–20h de Brasília (P3b)', () => {
  it.each([
    ['2026-11-04T11:00:00Z', true, 'quarta, 08:00'],
    ['2026-11-04T10:59:00Z', false, 'quarta, 07:59'],
    ['2026-11-04T22:59:00Z', true, 'quarta, 19:59'],
    ['2026-11-04T23:00:00Z', false, 'quarta, 20:00'],
    ['2026-11-06T22:30:00Z', true, 'sexta, 19:30'],
    ['2026-11-07T00:30:00Z', false, 'sexta, 21:30 (sábado em UTC)'],
    ['2026-11-07T15:00:00Z', false, 'sábado, 12:00'],
    ['2026-11-08T15:00:00Z', false, 'domingo, 12:00'],
  ])('%s → %s (%s)', (instante, esperado) => {
    expect(emHorarioUtil(new Date(instante))).toBe(esperado);
  });

  it('⚠️ feriado em dia útil CONTA como útil: o calendário não o conhece (o mesmo limite da sentinela)', () => {
    // 02/11/2026, Finados, segunda-feira.
    expect(emHorarioUtil(new Date('2026-11-02T13:00:00Z'))).toBe(true);
  });
});

function envio(minutos: number, conversa: string, status = 'sent'): EnvioRecente {
  return { criadoEm: iso(AGORA - minutos * MIN), status, conversaId: conversa };
}

describe('medirSemRecibo — (c)', () => {
  const travada = [envio(20, 'a'), envio(25, 'b'), envio(30, 'c'), envio(35, 'a'), envio(40, 'b')];

  it('leitura que falhou é "não sei"', () => {
    expect(medirSemRecibo(null, null, AGORA)).toEqual({ tipo: 'nao_sei' });
  });

  it('a régua da sonda acesa → aceso, desde o envio mais velho da sequência', () => {
    expect(medirSemRecibo(travada, null, AGORA)).toEqual({
      tipo: 'aceso',
      desdeIso: travada[4].criadoEm,
      detalhe: {},
    });
  });

  it('a PROVA do fim é um envio confirmado feito depois do começo do episódio', () => {
    const voltou = [envio(3, 'z', 'delivered'), ...travada];
    expect(medirSemRecibo(voltou, travada[4].criadoEm, AGORA)).toEqual({ tipo: 'normal', fimIso: iso(AGORA) });
  });

  it('⚠️ recibo de envio de ANTES do episódio não prova nada', () => {
    const poucos = [envio(20, 'a'), envio(90, 'x', 'delivered')];
    expect(medirSemRecibo(poucos, iso(AGORA - 60 * MIN), AGORA)).toEqual({ tipo: 'nao_sei' });
  });

  it('⚠️ a régua que só deixou de acender (ninguém enviando) não encerra o episódio', () => {
    expect(medirSemRecibo([envio(20, 'a')], iso(AGORA - 2 * H), AGORA)).toEqual({ tipo: 'nao_sei' });
  });
});

describe('medirAtraso — (b), pela fronteira da 1002', () => {
  const par = (atrasoMin: number, medidoHaMin: number) => ({
    carimboIso: iso(AGORA - (medidoHaMin + atrasoMin) * MIN),
    recebidaIso: iso(AGORA - medidoHaMin * MIN),
  });

  it('fresca e com 30 min ou mais → aceso, desde o carimbo da mensagem medida', () => {
    expect(medirAtraso(par(40, 10), AGORA)).toEqual({
      tipo: 'aceso',
      desdeIso: iso(AGORA - 50 * MIN),
      detalhe: { atrasoSeg: 40 * 60, medidoEmIso: iso(AGORA - 10 * MIN) },
    });
    expect(medirAtraso(par(ATRASO_DO_SINO_SEG / 60, 10), AGORA).tipo).toBe('aceso');
  });

  it('fresca e com até 5 min → a prova do fim', () => {
    expect(medirAtraso(par(5, 10), AGORA)).toEqual({ tipo: 'normal', fimIso: iso(AGORA - 10 * MIN) });
  });

  it('entre 5 e 30 min é "não sei": o âmbar da tela acende, o sino não', () => {
    expect(medirAtraso(par(6, 10), AGORA)).toEqual({ tipo: 'nao_sei' });
    expect(medirAtraso(par(29, 10), AGORA)).toEqual({ tipo: 'nao_sei' });
  });

  it('⚠️ EXPIRAR não é normalizar: medição com mais de 1 h não acende nem encerra', () => {
    expect(medirAtraso(par(600, 61), AGORA)).toEqual({ tipo: 'nao_sei' });
    expect(medirAtraso(par(1, 61), AGORA)).toEqual({ tipo: 'nao_sei' });
  });

  it('sem medição nenhuma, "não sei"', () => {
    expect(medirAtraso({ carimboIso: null, recebidaIso: null }, AGORA)).toEqual({ tipo: 'nao_sei' });
  });
});

const DESDE = iso(AGORA - 3 * H);

function estado(over: Partial<EstadoDoAlarme> = {}): EstadoDoAlarme {
  return { desdeIso: DESDE, avisadoEmIso: null, normalizouEmIso: null, detalhe: {}, ...over };
}

const aceso: Medicao = { tipo: 'aceso', desdeIso: iso(AGORA - 40 * MIN), detalhe: {} };
const normal: Medicao = { tipo: 'normal', fimIso: iso(AGORA - 5 * MIN) };
const naoSei: Medicao = { tipo: 'nao_sei' };

describe('decidir — um aviso por episódio, lembrete de 24 h, "Normalizou" só com prova', () => {
  it('(c) aceso pela 1ª vez em horário útil → novo; o aviso é a escrita do estado com o carimbo', () => {
    const p = decidir('sem_recibo', null, aceso, AGORA, true);
    expect(p.motivo).toBe('novo');
    expect(p.depois).toEqual(estado({ desdeIso: aceso.tipo === 'aceso' ? aceso.desdeIso : '', avisadoEmIso: iso(AGORA) }));
    expect(p.seFalhar?.avisadoEmIso).toBeNull();
  });

  it('⚠️ (c) aceso fora do horário útil: o episódio fica GUARDADO, sem aviso (P3b)', () => {
    const p = decidir('sem_recibo', null, aceso, AGORA, false);
    expect(p.motivo).toBeNull();
    expect(p.depois?.avisadoEmIso).toBeNull();
  });

  it('(c) visto à noite e ainda aceso na abertura do horário → novo, com o começo de quando foi visto', () => {
    const p = decidir('sem_recibo', estado(), aceso, AGORA, true);
    expect(p.motivo).toBe('novo');
    expect(p.depois?.desdeIso).toBe(DESDE);
  });

  it('aceso e avisado há menos de 24 h → nada; com 24 h → lembrete', () => {
    const ha23h = estado({ avisadoEmIso: iso(AGORA - 23 * H) });
    expect(decidir('sem_recibo', ha23h, aceso, AGORA, true).motivo).toBeNull();
    const ha24h = estado({ avisadoEmIso: iso(AGORA - LEMBRETE_MS) });
    const p = decidir('sem_recibo', ha24h, aceso, AGORA, true);
    expect(p.motivo).toBe('lembrete');
    expect(p.depois?.avisadoEmIso).toBe(iso(AGORA));
  });

  it('(c) o lembrete espera o horário útil', () => {
    const ha24h = estado({ avisadoEmIso: iso(AGORA - LEMBRETE_MS) });
    expect(decidir('sem_recibo', ha24h, aceso, AGORA, false).motivo).toBeNull();
  });

  it('⚠️ voltou antes de o "Normalizou" entrar: a prova guardada deixa de valer', () => {
    const guardado = estado({ avisadoEmIso: iso(AGORA - H), normalizouEmIso: iso(AGORA - 30 * MIN) });
    const p = decidir('sem_recibo', guardado, aceso, AGORA, true);
    expect(p.motivo).toBeNull();
    expect(p.depois?.normalizouEmIso).toBeNull();
  });

  it('a prova do fim de um episódio avisado → normalizou, e a linha sai; se o aviso falhar, a prova fica guardada', () => {
    const p = decidir('sem_recibo', estado({ avisadoEmIso: iso(AGORA - H) }), normal, AGORA, true);
    expect(p.motivo).toBe('normalizou');
    expect(p.depois).toBeNull();
    expect(p.seFalhar?.normalizouEmIso).toBe(normal.tipo === 'normal' ? normal.fimIso : '');
  });

  it('o "Normalizou" de um aviso que já saiu vai a qualquer hora (notícia boa de um aviso aberto)', () => {
    const p = decidir('sem_recibo', estado({ avisadoEmIso: iso(AGORA - H) }), normal, AGORA, false);
    expect(p.motivo).toBe('normalizou');
  });

  it('⚠️ (c) que acendeu e apagou fora do horário não vai ao sino: a linha sai calada', () => {
    const p = decidir('sem_recibo', estado(), normal, AGORA, false);
    expect(p).toEqual({ motivo: null, depois: null, seFalhar: null });
  });

  it('episódio que não chegou ao sino e já acabou, em horário útil → passou', () => {
    expect(decidir('sem_recibo', estado(), normal, AGORA, true).motivo).toBe('passou');
    expect(decidir('atraso', estado(), normal, AGORA, false).motivo).toBe('passou');
  });

  it('a prova guardada (o aviso dela foi recusado) sai mesmo sem medição nova, com a hora em que foi vista', () => {
    const guardado = estado({ avisadoEmIso: iso(AGORA - H), normalizouEmIso: iso(AGORA - 20 * MIN) });
    const p = decidir('atraso', guardado, naoSei, AGORA, true);
    expect(p.motivo).toBe('normalizou');
    expect(p.seFalhar?.normalizouEmIso).toBe(iso(AGORA - 20 * MIN));
  });

  it('(b) acende a qualquer hora, até de madrugada no sábado', () => {
    const madrugada = Date.parse('2026-11-07T06:30:00Z');
    expect(decidir('atraso', null, aceso, madrugada, false).motivo).toBe('novo');
  });

  it('(b) visto e não avisado (o sino recusou) avisa de novo mesmo sem medição nova', () => {
    expect(decidir('atraso', estado(), naoSei, AGORA, false).motivo).toBe('novo');
  });

  it('⚠️ (c) visto e não avisado só avisa ACESO (P3b: "se ainda estiver aceso")', () => {
    const p = decidir('sem_recibo', estado(), naoSei, AGORA, true);
    expect(p.motivo).toBeNull();
    expect(p.depois).toEqual(estado());
  });

  it('"não sei" com o aviso de 24 h atrás → Continua, ainda sem prova', () => {
    const ha24h = estado({ avisadoEmIso: iso(AGORA - LEMBRETE_MS) });
    expect(decidir('atraso', ha24h, naoSei, AGORA, false).motivo).toBe('sem_prova');
    expect(decidir('sem_recibo', ha24h, naoSei, AGORA, true).motivo).toBe('sem_prova');
    expect(decidir('sem_recibo', ha24h, naoSei, AGORA, false).motivo).toBeNull();
  });

  it('"não sei" ou "normal" sem episódio aberto não fazem nada', () => {
    expect(decidir('atraso', null, naoSei, AGORA, true)).toEqual({ motivo: null, depois: null, seFalhar: null });
    expect(decidir('sem_recibo', null, normal, AGORA, true)).toEqual({ motivo: null, depois: null, seFalhar: null });
  });
});

function perfil(channel_ids: string[]): PerfilDeAcesso {
  return {
    id: `p-${channel_ids.join('-') || 'todas'}`,
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

describe('destinatarios — owner/admin e os membros cujo perfil vê a conexão (D2)', () => {
  const membros: MembroDaConta[] = [
    { userId: 'dono', papel: 'owner', perfil: null },
    { userId: 'admin-de-outra', papel: 'admin', perfil: perfil(['outra']) },
    { userId: 'sem-perfil', papel: 'agent', perfil: null },
    { userId: 'lista-vazia', papel: 'agent', perfil: perfil([]) },
    { userId: 'desta', papel: 'agent', perfil: perfil(['c1']) },
    { userId: 'de-outra', papel: 'agent', perfil: perfil(['outra']) },
    { userId: 'leitor-desta', papel: 'viewer', perfil: perfil(['c1', 'outra']) },
  ];

  it('o recorte é o do perfil: vazio = todas; o admin recebe mesmo com recorte', () => {
    expect(destinatarios(membros, 'c1').sort()).toEqual(
      ['admin-de-outra', 'desta', 'dono', 'leitor-desta', 'lista-vazia', 'sem-perfil'].sort(),
    );
  });

  it('sem repetir quem aparece duas vezes', () => {
    expect(destinatarios([membros[0], membros[0]], 'c1')).toEqual(['dono']);
  });
});

// ------------------------------------------------------------
// Os textos, com os dicionários de verdade
// ------------------------------------------------------------
const tradutores: [string, Tradutor][] = [
  ['pt-BR', createTranslator({ locale: 'pt-BR', messages: ptBR, namespace: 'AlarmesDeConexao' }) as unknown as Tradutor],
  ['en', createTranslator({ locale: 'en', messages: en, namespace: 'AlarmesDeConexao' }) as unknown as Tradutor],
];
const quando = (i: string) => `«${i.slice(11, 16)}»`;
const MOTIVOS: Motivo[] = ['novo', 'lembrete', 'sem_prova', 'normalizou', 'passou'];
const TIPOS: TipoDoAlarme[] = ['sem_recibo', 'atraso'];

describe('textosDoAviso — no idioma da instalação', () => {
  const doEpisodio = estado({
    desdeIso: '2026-11-04T12:10:00.000Z',
    normalizouEmIso: '2026-11-04T15:05:00.000Z',
    detalhe: { atrasoSeg: 9 * 3600 + 48 * 60, medidoEmIso: '2026-11-04T05:52:00.000Z' },
  });

  it.each(tradutores)('%s: todo tipo × motivo sai com o nome da conexão e sem chave crua nem chave de ICU', (_, t) => {
    for (const tipo of TIPOS) {
      for (const motivo of MOTIVOS) {
        const { titulo, corpo } = textosDoAviso(t, quando, tipo, motivo, doEpisodio, 'Comercial');
        expect(titulo).toContain('Comercial');
        for (const texto of [titulo, corpo]) {
          expect(texto).not.toMatch(/AlarmesDeConexao|[{}]/);
          expect(texto.length).toBeGreaterThan(10);
        }
      }
    }
  });

  it('pt-BR: o (c) diz desde quando e manda NÃO reenviar', () => {
    const t = tradutores[0][1];
    const { titulo, corpo } = textosDoAviso(t, quando, 'sem_recibo', 'novo', doEpisodio, 'Comercial');
    expect(titulo).toBe('Conexão sem confirmação de entrega: Comercial');
    expect(corpo).toContain('desde «12:10»');
    expect(corpo).toContain('Não reenvie');
  });

  it('pt-BR: o (b) diz o atraso medido, em horas quando passa de 2 h', () => {
    const t = tradutores[0][1];
    expect(textosDoAviso(t, quando, 'atraso', 'novo', doEpisodio, 'Comercial').corpo).toContain('9 h 48 min');
    const curto = { ...doEpisodio, detalhe: { atrasoSeg: 40 * 60, medidoEmIso: doEpisodio.detalhe.medidoEmIso } };
    expect(textosDoAviso(t, quando, 'atraso', 'novo', curto, 'Comercial').corpo).toContain('40 min');
  });

  it('pt-BR: os prefixos da sentinela, e o "Normalizou" com o fim e o começo', () => {
    const t = tradutores[0][1];
    expect(textosDoAviso(t, quando, 'atraso', 'lembrete', doEpisodio, 'Comercial').titulo).toMatch(/^Continua — /);
    expect(textosDoAviso(t, quando, 'atraso', 'sem_prova', doEpisodio, 'Comercial').corpo).toMatch(/^Ainda sem prova/);
    const normalizou = textosDoAviso(t, quando, 'sem_recibo', 'normalizou', doEpisodio, 'Comercial');
    expect(normalizou.titulo).toMatch(/^Normalizou — /);
    expect(normalizou.corpo).toBe('Voltou ao normal em «15:05»; tinha começado em «12:10».');
    expect(textosDoAviso(t, quando, 'atraso', 'passou', doEpisodio, 'Comercial').titulo).toMatch(
      /^Aconteceu e já normalizou — /,
    );
  });

  it('(b) sem a medição guardada diz só desde quando, sem inventar número', () => {
    const t = tradutores[0][1];
    const semMedida = { ...doEpisodio, detalhe: {} };
    expect(textosDoAviso(t, quando, 'atraso', 'novo', semMedida, 'Comercial').corpo).toBe(
      'As mensagens deste número estão chegando ao CRM com atraso desde «12:10».',
    );
  });
});
