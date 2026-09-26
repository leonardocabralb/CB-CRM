import { describe, expect, it } from 'vitest';

import { FOLGA_DO_DESFECHO_MS, desfechoDaLigacao, segundosTocando } from './desfecho';
import { ehEncerramento, lerEventoDeLigacao } from './evento';
import { ehLid, telefoneDoCallerPn, telefoneDoJid } from './telefone';

const AGORA = Date.parse('2026-09-25T15:49:00.000Z');

describe('lerEventoDeLigacao — o data do webhook CALL', () => {
  // A forma do `WACallEvent` da Baileys 7.0.0-rc13 depois do JSON da Evolution
  // (o `date` vira texto ISO).
  const offer = {
    chatId: '123456789012345@lid',
    from: '123456789012345@lid',
    callerPn: '5583999990000@s.whatsapp.net',
    id: 'D13A78D2DA5E8BEF692C3FA50DB258C0',
    date: '2026-09-25T15:49:01.000Z',
    offline: false,
    status: 'offer',
    isVideo: false,
    isGroup: false,
  };

  it('lê o offer inteiro', () => {
    expect(lerEventoDeLigacao(offer, AGORA)).toEqual({
      callId: 'D13A78D2DA5E8BEF692C3FA50DB258C0',
      situacao: 'offer',
      de: '123456789012345@lid',
      telefoneInformado: '5583999990000@s.whatsapp.net',
      video: false,
      grupo: false,
      em: Date.parse('2026-09-25T15:49:01.000Z'),
    });
  });

  it('as cinco situações que importam passam; a sinalização da chamada não', () => {
    for (const status of ['offer', 'accept', 'reject', 'timeout', 'terminate']) {
      expect(lerEventoDeLigacao({ ...offer, status }, AGORA)?.situacao).toBe(status);
    }
    for (const status of ['relaylatency', 'transport', 'preaccept', 'ringing', 'OFFER', '']) {
      expect(lerEventoDeLigacao({ ...offer, status }, AGORA)).toBeNull();
    }
  });

  it('sem id, ou forma que não é objeto, não é aviso', () => {
    expect(lerEventoDeLigacao({ ...offer, id: '' }, AGORA)).toBeNull();
    expect(lerEventoDeLigacao({ ...offer, id: 42 }, AGORA)).toBeNull();
    expect(lerEventoDeLigacao(null, AGORA)).toBeNull();
    expect(lerEventoDeLigacao([offer], AGORA)).toBeNull();
    expect(lerEventoDeLigacao('offer', AGORA)).toBeNull();
  });

  it('vídeo e grupo só com o booleano true (JSON traz "true" e 1 como truthy)', () => {
    expect(lerEventoDeLigacao({ ...offer, isVideo: true }, AGORA)?.video).toBe(true);
    expect(lerEventoDeLigacao({ ...offer, isVideo: 'true' }, AGORA)?.video).toBe(false);
    expect(lerEventoDeLigacao({ ...offer, isGroup: 1 }, AGORA)?.grupo).toBe(false);
    expect(lerEventoDeLigacao({ ...offer, isGroup: true }, AGORA)?.grupo).toBe(true);
    // A Baileys preenche `groupJid` no offer de grupo mesmo sem `type=group`.
    expect(lerEventoDeLigacao({ ...offer, groupJid: '1203@g.us' }, AGORA)?.grupo).toBe(true);
  });

  it('data ilegível cai no instante da chegada; o aviso continua valendo', () => {
    expect(lerEventoDeLigacao({ ...offer, date: 'ontem' }, AGORA)?.em).toBe(AGORA);
    expect(lerEventoDeLigacao({ ...offer, date: undefined }, AGORA)?.em).toBe(AGORA);
  });

  it('sem from, quem ligou sai do chatId', () => {
    expect(lerEventoDeLigacao({ ...offer, from: undefined }, AGORA)?.de).toBe('123456789012345@lid');
  });

  it('ehEncerramento: só reject, timeout e terminate', () => {
    expect(['reject', 'timeout', 'terminate'].every((s) => ehEncerramento(s as never))).toBe(true);
    expect(ehEncerramento('accept')).toBe(false);
    expect(ehEncerramento('offer')).toBe(false);
  });
});

describe('desfechoDaLigacao — a régua medida em 25/09/2026', () => {
  const fim = '2026-09-25T15:49:41.000Z';
  const gravadoAgora = new Date(AGORA).toISOString();

  it('accept = atendida, mesmo com o fim gravado agora', () => {
    expect(
      desfechoDaLigacao(
        { atendida_em: fim, encerrada_em: fim, encerramento_gravado_em: gravadoAgora },
        AGORA,
      ),
    ).toBe('atendida');
  });

  it('ainda tocando: não dá para dizer', () => {
    expect(
      desfechoDaLigacao({ atendida_em: null, encerrada_em: null, encerramento_gravado_em: null }, AGORA),
    ).toBeNull();
  });

  it('fim sem accept DENTRO da folga: ainda não é perdida (o accept pode estar a caminho)', () => {
    const quase = new Date(AGORA - FOLGA_DO_DESFECHO_MS + 1).toISOString();
    expect(
      desfechoDaLigacao({ atendida_em: null, encerrada_em: fim, encerramento_gravado_em: quase }, AGORA),
    ).toBeNull();
  });

  it('fim sem accept DEPOIS da folga: perdida', () => {
    const passou = new Date(AGORA - FOLGA_DO_DESFECHO_MS).toISOString();
    expect(
      desfechoDaLigacao({ atendida_em: null, encerrada_em: fim, encerramento_gravado_em: passou }, AGORA),
    ).toBe('perdida');
  });

  it('fim sem a hora da gravação conta como antigo', () => {
    expect(
      desfechoDaLigacao({ atendida_em: null, encerrada_em: fim, encerramento_gravado_em: null }, AGORA),
    ).toBe('perdida');
  });

  it('segundosTocando: arredonda, e não inventa quando falta ponta ou o relógio volta', () => {
    expect(segundosTocando('2026-09-25T15:49:01.000Z', '2026-09-25T15:49:41.400Z')).toBe(40);
    expect(segundosTocando(null, fim)).toBeNull();
    expect(segundosTocando(fim, null)).toBeNull();
    expect(segundosTocando(fim, '2026-09-25T15:49:00.000Z')).toBeNull();
  });
});

describe('o telefone de quem ligou', () => {
  it('JID de telefone vira dígitos, sem o aparelho', () => {
    expect(telefoneDoJid('5583999990000@s.whatsapp.net')).toBe('5583999990000');
    expect(telefoneDoJid('5583999990000:12@s.whatsapp.net')).toBe('5583999990000');
  });

  it('⚠️ LID e grupo NUNCA viram telefone (a armadilha dos 8 dígitos finais)', () => {
    expect(telefoneDoJid('123456789012345@lid')).toBeNull();
    expect(telefoneDoJid('120363025246125486@g.us')).toBeNull();
    expect(telefoneDoJid(null)).toBeNull();
    expect(ehLid('123456789012345@lid')).toBe(true);
    expect(ehLid('5583999990000@s.whatsapp.net')).toBe(false);
  });

  it('callerPn: JID ou só dígitos', () => {
    expect(telefoneDoCallerPn('5583999990000@s.whatsapp.net')).toBe('5583999990000');
    expect(telefoneDoCallerPn('5583999990000')).toBe('5583999990000');
    expect(telefoneDoCallerPn('558332221234')).toBe('558332221234'); // fixo, 12 dígitos
    expect(telefoneDoCallerPn('14045551234')).toBe('14045551234'); // de fora do Brasil
  });

  it('⚠️ callerPn com o zero a mais do fixo (issue #2154 da Baileys) é recusado, não "consertado"', () => {
    // 12 dígitos do fixo + o 0 do defeito = 13, sem o 9 do celular.
    expect(telefoneDoCallerPn('5583322212340')).toBeNull();
  });

  it('callerPn estranho não vira telefone', () => {
    expect(telefoneDoCallerPn('123456789012345@lid')).toBeNull();
    expect(telefoneDoCallerPn('55839999')).toBeNull(); // brasileiro curto
    expect(telefoneDoCallerPn('1234567')).toBeNull();
    expect(telefoneDoCallerPn('')).toBeNull();
    expect(telefoneDoCallerPn(null)).toBeNull();
  });
});
