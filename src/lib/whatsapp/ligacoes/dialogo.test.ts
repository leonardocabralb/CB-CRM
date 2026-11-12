import { describe, expect, it } from 'vitest';

import {
  dialogoEmTexto,
  intercalar,
  lerTrechosDaOpenAi,
  lerTrechosDoGemini,
  limparResumo,
  relogio,
  segundosDe,
  soComSom,
  somDaGravacao,
  TETO_DO_RESUMO,
} from './dialogo';

/** Um começo de Ogg fictício com o cabeçalho OpusTags e as etiquetas dadas (o que a máquina grava). */
function ogg(etiquetas: string[], quantas = etiquetas.length): Uint8Array {
  const texto = (s: string) => [...new TextEncoder().encode(s)];
  const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const bytes = [...texto('OggS'), 0, 2, ...texto('OpusHead'), 1, 1, ...texto('OggS'), 0, 0];
  bytes.push(...texto('OpusTags'), ...u32(4), ...texto('Lavf'), ...u32(quantas));
  for (const e of etiquetas) bytes.push(...u32(texto(e).length), ...texto(e));
  bytes.push(...texto('OggS'), 0, 0, 7, 7, 7);
  return new Uint8Array(bytes);
}

describe('somDaGravacao (a etiqueta CB_SOM da máquina)', () => {
  it('lê os trechos com som do cabeçalho do Opus', () => {
    expect(somDaGravacao(ogg(['encoder=Lavc59 libopus', 'CB_SOM=0.6-1.1,2.3-26.9']))).toEqual([
      [0.6, 1.1],
      [2.3, 26.9],
    ]);
    // A chave sai em qualquer caixa (o ffmpeg a grava como recebeu).
    expect(somDaGravacao(ogg(['cb_som=0.0-3.0']))).toEqual([[0, 3]]);
  });

  it('"nenhum" = o lado todo em silêncio', () => {
    expect(somDaGravacao(ogg(['CB_SOM=nenhum']))).toEqual([]);
  });

  it('sem a medição: nulo (máquina antiga, arquivo estranho, etiqueta fora da forma)', () => {
    expect(somDaGravacao(new TextEncoder().encode('CLIENTE'))).toBeNull();
    expect(somDaGravacao(ogg(['encoder=Lavc59 libopus']))).toBeNull();
    expect(somDaGravacao(ogg(['CB_SOM=']))).toBeNull();
    expect(somDaGravacao(ogg(['CB_SOM=3.0-1.0']))).toBeNull();
    expect(somDaGravacao(ogg(['CB_SOM=0.0-1.0;2-3']))).toBeNull();
    // O número de etiquetas promete mais do que o arquivo tem: nulo, sem lançar.
    expect(somDaGravacao(ogg(['encoder=x'], 5))).toBeNull();
    expect(somDaGravacao(ogg(['CB_SOM=0.0-1.0']).subarray(0, 40))).toBeNull();
  });
});

describe('soComSom (o Gemini inventa fala sobre áudio sem voz, 11/11/2026)', () => {
  const trechos = [
    { inicio: 2, texto: 'Alô.' },
    { inicio: 8, texto: 'Um monólogo que ninguém disse.' },
    { inicio: 30, texto: 'Até logo.' },
  ];

  it('fica só o trecho que começa perto de som medido', () => {
    expect(soComSom(trechos, [[2.3, 3.1], [29.5, 31]])).toEqual([trechos[0], trechos[2]]);
  });

  it('a folga cobre o horário em segundos inteiros do provedor (2 s antes, 3 s depois)', () => {
    expect(soComSom([{ inicio: 5, texto: 'a' }], [[7.9, 8.2]])).toHaveLength(1);
    expect(soComSom([{ inicio: 5, texto: 'a' }], [[2.5, 3.2]])).toHaveLength(1);
    expect(soComSom([{ inicio: 5, texto: 'a' }], [[8.1, 9]])).toHaveLength(0);
    expect(soComSom([{ inicio: 5, texto: 'a' }], [[1, 2.9]])).toHaveLength(0);
  });

  it('o lado todo em silêncio fica sem trecho; sem a medição, tudo fica', () => {
    expect(soComSom(trechos, [])).toEqual([]);
    expect(soComSom(trechos, null)).toEqual(trechos);
  });
});

describe('segundosDe', () => {
  it('lê MM:SS, M:SS, H:MM:SS, fração e número', () => {
    expect(segundosDe('00:12')).toBe(12);
    expect(segundosDe('1:05')).toBe(65);
    expect(segundosDe('12:30')).toBe(750);
    expect(segundosDe('1:02:03')).toBe(3723);
    expect(segundosDe('00:12.5')).toBe(12.5);
    expect(segundosDe('00:12,5')).toBe(12.5);
    expect(segundosDe(7.25)).toBe(7.25);
    expect(segundosDe('42')).toBe(42);
  });

  it('recusa o que não é horário', () => {
    for (const v of ['', '1 min', '00:75', '1:60:00', '-3', 'abc', null, undefined, -1, Number.NaN, {}]) {
      expect(segundosDe(v)).toBeNull();
    }
  });
});

describe('lerTrechosDoGemini', () => {
  it('lê { trechos } e ordena pelo horário, estável no empate', () => {
    const texto = JSON.stringify({
      trechos: [
        { inicio: '00:10', texto: 'segunda' },
        { inicio: '00:02', texto: '  primeira   fala ' },
        { inicio: '00:10', texto: 'terceira' },
      ],
    });
    expect(lerTrechosDoGemini(texto)).toEqual([
      { inicio: 2, texto: 'primeira fala' },
      { inicio: 10, texto: 'segunda' },
      { inicio: 10, texto: 'terceira' },
    ]);
  });

  it('aceita a lista solta e descarta trecho sem horário ou sem texto', () => {
    const texto = JSON.stringify([
      { inicio: '00:01', texto: 'ok' },
      { inicio: 'logo', texto: 'sem horário' },
      { inicio: '00:03', texto: '   ' },
    ]);
    expect(lerTrechosDoGemini(texto)).toEqual([{ inicio: 1, texto: 'ok' }]);
  });

  it('a cerca de código em volta do JSON não estraga a leitura', () => {
    expect(lerTrechosDoGemini('```json\n{"trechos": [{"inicio": "00:05", "texto": "Oi"}]}\n```')).toEqual([
      { inicio: 5, texto: 'Oi' },
    ]);
  });

  it('fala com o horário TODO fora da forma = falha (null), nunca "sem fala"; item sem texto não é fala', () => {
    expect(lerTrechosDoGemini(JSON.stringify({ trechos: [{ inicio: 'logo', texto: 'Alô?' }] }))).toBeNull();
    expect(lerTrechosDoGemini(JSON.stringify({ trechos: [{ inicio: '00:01', texto: '  ' }] }))).toEqual([]);
    expect(lerTrechosDaOpenAi({ segments: [{ start: 'x', text: 'Oi' }] })).toBeNull();
  });

  it('lado sem fala = lista vazia; resposta fora da forma = null', () => {
    expect(lerTrechosDoGemini('{"trechos": []}')).toEqual([]);
    expect(lerTrechosDoGemini('não é json')).toBeNull();
    expect(lerTrechosDoGemini('{"texto": "x"}')).toBeNull();
    expect(lerTrechosDoGemini('null')).toBeNull();
  });
});

describe('lerTrechosDaOpenAi', () => {
  it('lê os segments do verbose_json', () => {
    const corpo = {
      text: 'Alô. Bom dia.',
      segments: [
        { id: 0, start: 0.4, end: 1.2, text: ' Alô.' },
        { id: 1, start: 2.1, end: 3, text: ' Bom dia.' },
      ],
    };
    expect(lerTrechosDaOpenAi(corpo)).toEqual([
      { inicio: 0.4, texto: 'Alô.' },
      { inicio: 2.1, texto: 'Bom dia.' },
    ]);
  });

  it('sem segments: o texto vira um trecho no começo; vazio = sem fala; nada = null', () => {
    expect(lerTrechosDaOpenAi({ text: 'Tudo bem?' })).toEqual([{ inicio: 0, texto: 'Tudo bem?' }]);
    expect(lerTrechosDaOpenAi({ text: '  ' })).toEqual([]);
    expect(lerTrechosDaOpenAi({})).toBeNull();
    expect(lerTrechosDaOpenAi(null)).toBeNull();
  });
});

describe('intercalar', () => {
  it('ordena os dois lados pelo horário e junta falas seguidas da mesma pessoa', () => {
    const cliente = [
      { inicio: 1, texto: 'Alô?' },
      { inicio: 9, texto: 'Quero saber do processo.' },
      { inicio: 12, texto: 'Já mandei os documentos.' },
    ];
    const atendente = [
      { inicio: 2, texto: 'Bom dia, aqui é do escritório.' },
      { inicio: 15, texto: 'Recebi, vou conferir.' },
    ];
    expect(intercalar(cliente, atendente)).toEqual([
      { quem: 'cliente', inicio: 1, texto: 'Alô?' },
      { quem: 'atendente', inicio: 2, texto: 'Bom dia, aqui é do escritório.' },
      { quem: 'cliente', inicio: 9, texto: 'Quero saber do processo. Já mandei os documentos.' },
      { quem: 'atendente', inicio: 15, texto: 'Recebi, vou conferir.' },
    ]);
  });

  it('não altera as listas recebidas e aceita um lado vazio', () => {
    const cliente = [
      { inicio: 1, texto: 'a' },
      { inicio: 2, texto: 'b' },
    ];
    const copia = structuredClone(cliente);
    expect(intercalar(cliente, [])).toEqual([{ quem: 'cliente', inicio: 1, texto: 'a b' }]);
    expect(cliente).toEqual(copia);
    expect(intercalar([], [])).toEqual([]);
  });
});

describe('relogio e dialogoEmTexto', () => {
  it('escreve MM:SS e H:MM:SS', () => {
    expect(relogio(0)).toBe('00:00');
    expect(relogio(65.9)).toBe('01:05');
    expect(relogio(3723)).toBe('1:02:03');
  });

  it('escreve uma linha por trecho com o rótulo de cada lado', () => {
    const texto = dialogoEmTexto(
      [
        { quem: 'cliente', inicio: 1, texto: 'Alô?' },
        { quem: 'atendente', inicio: 2.6, texto: 'Bom dia.' },
      ],
      { cliente: 'Cliente', atendente: 'Atendente' },
    );
    expect(texto).toBe('[00:01] Cliente: Alô?\n[00:02] Atendente: Bom dia.');
  });
});

describe('limparResumo', () => {
  it('apara, junta espaços e corta no teto', () => {
    expect(limparResumo('  O cliente   pediu\n o contrato. ')).toBe('O cliente pediu o contrato.');
    expect(limparResumo('   ')).toBeNull();
    const longo = limparResumo('x'.repeat(TETO_DO_RESUMO + 50));
    expect(longo).toHaveLength(TETO_DO_RESUMO);
    expect(longo?.endsWith('…')).toBe(true);
  });
});
