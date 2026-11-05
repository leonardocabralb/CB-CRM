import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';
import type { PerfilDeAcesso } from '@/lib/perfis/tipos';

import {
  DURACAO_DO_ATRASO_NO_SINO_MS,
  LEMBRETE_MS,
  decidir,
  destinatarios,
  emHorarioUtil,
  episodioAberto,
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

describe('medirAtraso — (b), com a régua do âmbar da tela', () => {
  const par = (atrasoMin: number, medidoHaMin: number) => ({
    carimboIso: iso(AGORA - (medidoHaMin + atrasoMin) * MIN),
    recebidaIso: iso(AGORA - medidoHaMin * MIN),
  });

  it('fresca e com mais de 5 min → aceso, desde quando a mensagem medida chegou', () => {
    expect(medirAtraso(par(40, 10), AGORA)).toEqual({
      tipo: 'aceso',
      desdeIso: iso(AGORA - 10 * MIN),
      detalhe: { atrasoSeg: 40 * 60, medidoEmIso: iso(AGORA - 10 * MIN) },
    });
    expect(medirAtraso(par(6, 10), AGORA).tipo).toBe('aceso');
  });

  it('fresca e com até 5 min → a prova do fim', () => {
    expect(medirAtraso(par(5, 10), AGORA)).toEqual({ tipo: 'normal', fimIso: iso(AGORA - 10 * MIN) });
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
  return {
    desdeIso: DESDE,
    avisadoEmIso: null,
    normalizouEmIso: null,
    devidoEmIso: null,
    detalhe: {},
    ...over,
  };
}

const aceso: Medicao = { tipo: 'aceso', desdeIso: iso(AGORA - 40 * MIN), detalhe: {} };
const normal: Medicao = { tipo: 'normal', fimIso: iso(AGORA - 5 * MIN) };
const naoSei: Medicao = { tipo: 'nao_sei' };

describe('decidir — (c) envios sem recibo', () => {
  it('aceso pela 1ª vez em horário útil → novo; se o aviso falhar, a linha fica DEVIDA', () => {
    const p = decidir('sem_recibo', null, aceso, AGORA, true);
    expect(p.motivo).toBe('novo');
    expect(p.depois).toEqual(estado({ desdeIso: iso(AGORA - 40 * MIN), avisadoEmIso: iso(AGORA) }));
    expect(p.seFalhar).toEqual(estado({ desdeIso: iso(AGORA - 40 * MIN), devidoEmIso: iso(AGORA) }));
  });

  it('⚠️ aceso fora do horário útil: o episódio fica GUARDADO, sem aviso e sem devido (P3b)', () => {
    const p = decidir('sem_recibo', null, aceso, AGORA, false);
    expect(p.motivo).toBeNull();
    expect(p.depois).toEqual(estado({ desdeIso: iso(AGORA - 40 * MIN) }));
  });

  it('visto à noite e ainda aceso na abertura do horário → novo, com o "desde" da sequência de AGORA', () => {
    const daNoite = estado({ desdeIso: iso(AGORA - 60 * H) });
    const p = decidir('sem_recibo', daNoite, aceso, AGORA, true);
    expect(p.motivo).toBe('novo');
    expect(p.depois?.desdeIso).toBe(iso(AGORA - 40 * MIN));
  });

  it('⚠️ o que acendeu na sexta à noite e só teve recibo na segunda de manhã sai CALADO (P3b; revisão)', () => {
    const sextaANoite = estado({ desdeIso: '2026-11-07T01:00:00.000Z' });
    const segunda = Date.parse('2026-11-09T11:31:00.000Z');
    const fim: Medicao = { tipo: 'normal', fimIso: iso(segunda) };
    expect(decidir('sem_recibo', sextaANoite, fim, segunda, true)).toEqual({
      motivo: null,
      depois: null,
      seFalhar: null,
    });
  });

  it('aceso e avisado há menos de 24 h → nada; com 24 h → lembrete; fora do horário, espera', () => {
    const ha23h = estado({ avisadoEmIso: iso(AGORA - 23 * H) });
    expect(decidir('sem_recibo', ha23h, aceso, AGORA, true).motivo).toBeNull();
    const ha24h = estado({ avisadoEmIso: iso(AGORA - LEMBRETE_MS) });
    const p = decidir('sem_recibo', ha24h, aceso, AGORA, true);
    expect(p.motivo).toBe('lembrete');
    expect(p.depois?.desdeIso).toBe(DESDE);
    expect(decidir('sem_recibo', ha24h, aceso, AGORA, false).motivo).toBeNull();
  });

  it('⚠️ visto e não avisado só avisa ACESO (P3b: "se ainda estiver aceso")', () => {
    const p = decidir('sem_recibo', estado({ devidoEmIso: iso(AGORA - H) }), naoSei, AGORA, true);
    expect(p.motivo).toBeNull();
  });

  it('o aviso devido e recusado que normaliza: "passou" em horário útil, guardado à noite', () => {
    const devido = estado({ devidoEmIso: iso(AGORA - H) });
    expect(decidir('sem_recibo', devido, normal, AGORA, true).motivo).toBe('passou');
    const aNoite = decidir('sem_recibo', devido, normal, AGORA, false);
    expect(aNoite.motivo).toBeNull();
    expect(aNoite.depois?.normalizouEmIso).toBe(normal.tipo === 'normal' ? normal.fimIso : '');
    // Na abertura, a prova guardada sai mesmo sem medição nova.
    expect(decidir('sem_recibo', aNoite.depois, naoSei, AGORA, true).motivo).toBe('passou');
  });

  it('o "Normalizou" de um aviso que já saiu vai a qualquer hora', () => {
    const avisado = estado({ avisadoEmIso: iso(AGORA - H) });
    expect(decidir('sem_recibo', avisado, normal, AGORA, false).motivo).toBe('normalizou');
  });
});

describe('decidir — (b) atraso: o âmbar aceso por 30 min (D5)', () => {
  const visto = (haMin: number) => estado({ desdeIso: iso(AGORA - haMin * MIN) });
  const amber: Medicao = { tipo: 'aceso', desdeIso: iso(AGORA - 2 * MIN), detalhe: { atrasoSeg: 600 } };

  it('o 1º ciclo que vê o âmbar só abre o episódio', () => {
    const p = decidir('atraso', null, amber, AGORA, false);
    expect(p.motivo).toBeNull();
    expect(p.depois?.desdeIso).toBe(iso(AGORA - 2 * MIN));
  });

  it('o episódio aberto há 30 min avisa, a qualquer hora; a duração conta do 1º momento visto', () => {
    expect(decidir('atraso', visto(29), amber, AGORA, false).motivo).toBeNull();
    const p = decidir('atraso', visto(DURACAO_DO_ATRASO_NO_SINO_MS / MIN), amber, AGORA, false);
    expect(p.motivo).toBe('novo');
    expect(p.depois?.desdeIso).toBe(iso(AGORA - 30 * MIN));
  });

  it('⚠️ o 16/10 (25 min de episódio, 41 min de atraso máximo) acaba antes dos 30 min: sai calado (revisão)', () => {
    const p = decidir('atraso', visto(25), normal, AGORA, false);
    expect(p).toEqual({ motivo: null, depois: null, seFalhar: null });
  });

  it('⚠️ atraso estável abaixo de 30 min por uma manhã inteira ACENDE: é a duração que conta (revisão)', () => {
    const vinteENove: Medicao = { tipo: 'aceso', desdeIso: iso(AGORA - MIN), detalhe: { atrasoSeg: 29 * 60 } };
    expect(decidir('atraso', visto(45), vinteENove, AGORA, true).motivo).toBe('novo');
  });

  it('⚠️ expirar não normaliza: o episódio de 40 min com a medição vencida avisa', () => {
    expect(decidir('atraso', visto(40), naoSei, AGORA, false).motivo).toBe('novo');
  });

  it('o incidente de 03/11: o âmbar às 02:52, o sino às ~03:30', () => {
    const doisECinquentaEDois = Date.parse('2026-11-03T05:52:00.000Z');
    const primeiro: Medicao = {
      tipo: 'aceso',
      desdeIso: iso(doisECinquentaEDois),
      detalhe: { atrasoSeg: 35_280, medidoEmIso: iso(doisECinquentaEDois) },
    };
    const as3h = decidir('atraso', null, primeiro, doisECinquentaEDois + 8 * MIN, false);
    expect(as3h.motivo).toBeNull();
    const as315 = decidir('atraso', as3h.depois, primeiro, doisECinquentaEDois + 23 * MIN, false);
    expect(as315.motivo).toBeNull();
    const as330 = decidir('atraso', as315.depois, primeiro, doisECinquentaEDois + 38 * MIN, false);
    expect(as330.motivo).toBe('novo');
  });

  it('avisado: lembrete com 24 h (aceso) ou "sem prova" (não sei); a prova → normalizou', () => {
    const avisado = estado({ avisadoEmIso: iso(AGORA - LEMBRETE_MS) });
    expect(decidir('atraso', avisado, amber, AGORA, false).motivo).toBe('lembrete');
    expect(decidir('atraso', avisado, naoSei, AGORA, false).motivo).toBe('sem_prova');
    expect(decidir('atraso', avisado, normal, AGORA, false).motivo).toBe('normalizou');
  });

  it('o aviso devido e recusado que normaliza → passou, a qualquer hora', () => {
    expect(decidir('atraso', visto(40), normal, AGORA, false).motivo).toBeNull(); // nunca devido
    const devido = estado({ desdeIso: iso(AGORA - 40 * MIN), devidoEmIso: iso(AGORA - 5 * MIN) });
    expect(decidir('atraso', devido, normal, AGORA, false).motivo).toBe('passou');
  });
});

describe('decidir — o que vale para os dois', () => {
  it('⚠️ voltou antes de o "Normalizou" entrar: a prova guardada deixa de valer', () => {
    const guardado = estado({ avisadoEmIso: iso(AGORA - H), normalizouEmIso: iso(AGORA - 30 * MIN) });
    const p = decidir('sem_recibo', guardado, aceso, AGORA, true);
    expect(p.motivo).toBeNull();
    expect(p.depois?.normalizouEmIso).toBeNull();
  });

  it('a prova guardada (o aviso dela foi recusado) sai mesmo sem medição nova, com a hora em que foi vista', () => {
    const guardado = estado({ avisadoEmIso: iso(AGORA - H), normalizouEmIso: iso(AGORA - 20 * MIN) });
    const p = decidir('atraso', guardado, naoSei, AGORA, true);
    expect(p.motivo).toBe('normalizou');
    expect(p.depois).toBeNull();
    expect(p.seFalhar?.normalizouEmIso).toBe(iso(AGORA - 20 * MIN));
  });

  it('"não sei" ou "normal" sem episódio aberto não fazem nada', () => {
    expect(decidir('atraso', null, naoSei, AGORA, true)).toEqual({ motivo: null, depois: null, seFalhar: null });
    expect(decidir('sem_recibo', null, normal, AGORA, true)).toEqual({ motivo: null, depois: null, seFalhar: null });
  });
});

describe('episodioAberto — o que o botão das conexões mostra do sino (E1)', () => {
  it('sem episódio guardado, nada: o ao vivo é da sonda, não daqui', () => {
    expect(episodioAberto('sem_recibo', null, aceso, AGORA)).toBeNull();
    expect(episodioAberto('atraso', null, aceso, AGORA)).toBeNull();
  });

  it('a prova de agora fecha JÁ, sem esperar o ciclo apagar a linha', () => {
    expect(episodioAberto('sem_recibo', estado(), normal, AGORA)).toBeNull();
    expect(episodioAberto('atraso', estado(), normal, AGORA)).toBeNull();
  });

  it('⚠️ a prova GUARDADA fecha, menos se a medição acendeu de novo (o `decidir` a anula)', () => {
    const provado = estado({ normalizouEmIso: iso(AGORA - 2 * MIN), avisadoEmIso: iso(AGORA - H) });
    expect(episodioAberto('sem_recibo', provado, naoSei, AGORA)).toBeNull();
    expect(episodioAberto('atraso', provado, naoSei, AGORA)).toBeNull();
    expect(episodioAberto('atraso', provado, aceso, AGORA)).toEqual({ tipo: 'atraso', desdeIso: DESDE });
    expect(episodioAberto('sem_recibo', provado, aceso, AGORA)).toEqual({ tipo: 'sem_recibo', desdeIso: DESDE });
  });

  it('⚠️ expirar não normaliza: o (c) AVISADO sem prova continua aberto às 8h, com o "desde" dele', () => {
    const avisado = estado({ avisadoEmIso: iso(AGORA - 10 * H) });
    expect(episodioAberto('sem_recibo', avisado, naoSei, AGORA)).toEqual({ tipo: 'sem_recibo', desdeIso: DESDE });
    const devido = estado({ devidoEmIso: iso(AGORA - 10 * H) });
    expect(episodioAberto('sem_recibo', devido, naoSei, AGORA)).toEqual({ tipo: 'sem_recibo', desdeIso: DESDE });
  });

  it('⚠️ P3b: o (c) que o sino CALA (nunca avisado nem devido) só aparece enquanto ACESO, com a sequência de agora', () => {
    expect(episodioAberto('sem_recibo', estado(), naoSei, AGORA)).toBeNull();
    expect(episodioAberto('sem_recibo', estado(), aceso, AGORA)).toEqual({
      tipo: 'sem_recibo',
      desdeIso: iso(AGORA - 40 * MIN),
    });
  });

  it('o (c) avisado e aceso fica com o "desde" já dito (a régua do `decidir`)', () => {
    const avisado = estado({ avisadoEmIso: iso(AGORA - H) });
    expect(episodioAberto('sem_recibo', avisado, aceso, AGORA)?.desdeIso).toBe(DESDE);
  });

  it('⚠️ o (b) só aparece depois de DURAR 30 min (D5): o reinício da Evolution não acende o alarme de todo mundo', () => {
    const recente = estado({ desdeIso: iso(AGORA - DURACAO_DO_ATRASO_NO_SINO_MS + MIN) });
    expect(episodioAberto('atraso', recente, aceso, AGORA)).toBeNull();
    const longo = estado({ desdeIso: iso(AGORA - DURACAO_DO_ATRASO_NO_SINO_MS) });
    expect(episodioAberto('atraso', longo, aceso, AGORA)).toEqual({
      tipo: 'atraso',
      desdeIso: iso(AGORA - DURACAO_DO_ATRASO_NO_SINO_MS),
    });
  });

  it('⚠️ o incidente de 03/11: a medição venceu às 03:52, e o (b) segue aberto de manhã', () => {
    expect(episodioAberto('atraso', estado(), naoSei, AGORA)).toEqual({ tipo: 'atraso', desdeIso: DESDE });
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
