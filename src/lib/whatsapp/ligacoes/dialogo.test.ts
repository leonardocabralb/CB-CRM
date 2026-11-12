import { describe, expect, it } from 'vitest';

import {
  dialogoEmTexto,
  intercalar,
  lerTrechosDaOpenAi,
  lerTrechosDoGemini,
  limparResumo,
  relogio,
  segundosDe,
  TETO_DO_RESUMO,
} from './dialogo';

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
