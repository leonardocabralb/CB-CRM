import { describe, expect, it } from 'vitest';

import {
  aberturasDeCanal,
  canaisDoFio,
  canalDivergente,
  fioMulticanal,
  ultimoCanalDoCliente,
  type MensagemDoFio,
} from './canais-do-fio';

function msg(
  id: string,
  sender_type: string,
  channel_id: string | null,
): MensagemDoFio {
  return { id, sender_type, channel_id };
}

const COM = 'comercial';
const JUR = 'juridico';

describe('canaisDoFio', () => {
  it('ignora mensagem sem carimbo', () => {
    const fio = [msg('1', 'customer', null), msg('2', 'customer', COM)];
    expect(canaisDoFio(fio)).toEqual(new Set([COM]));
  });
});

describe('fioMulticanal', () => {
  it('GRUPO é sempre falso — lá o carimbo é corrida de webhook', () => {
    // Os dois números dentro do mesmo grupo recebem a mesma mensagem; o
    // UNIQUE descarta a segunda entrega e grava quem chegou primeiro.
    const fio = [msg('1', 'customer', COM), msg('2', 'customer', JUR)];
    expect(fioMulticanal(fio, true)).toBe(false);
    expect(fioMulticanal(fio, false)).toBe(true);
  });

  it('um canal só é falso — é o caso de 224 das 228 conversas', () => {
    expect(fioMulticanal([msg('1', 'customer', COM)], false)).toBe(false);
  });

  it('fio inteiro sem carimbo é falso, não "vários"', () => {
    const antigo = [msg('1', 'customer', null), msg('2', 'agent', null)];
    expect(fioMulticanal(antigo, false)).toBe(false);
  });
});

describe('aberturasDeCanal', () => {
  it('fio de um canal só não anuncia troca nenhuma', () => {
    const fio = [msg('1', 'customer', COM), msg('2', 'agent', COM)];
    expect(aberturasDeCanal(fio, false).size).toBe(0);
  });

  it('a primeira mensagem carimbada abre trecho', () => {
    const fio = [msg('1', 'customer', COM), msg('2', 'customer', JUR)];
    expect([...aberturasDeCanal(fio, false)]).toEqual([
      ['1', COM],
      ['2', JUR],
    ]);
  });

  it('voltar ao canal anterior abre trecho DE NOVO', () => {
    // A ida e a volta são dois momentos distintos da conversa; um separador
    // só na primeira faria o trecho do meio parecer continuação.
    const fio = [
      msg('1', 'customer', COM),
      msg('2', 'customer', JUR),
      msg('3', 'customer', COM),
    ];
    expect([...aberturasDeCanal(fio, false)]).toEqual([
      ['1', COM],
      ['2', JUR],
      ['3', COM],
    ]);
  });

  it('mensagem SEM carimbo não abre nem fecha trecho', () => {
    // As 117 conversas com histórico anterior ao multi-canal ficariam
    // cheias de separadores sem nome para escrever.
    const fio = [
      msg('1', 'customer', COM),
      msg('2', 'agent', null),
      msg('3', 'customer', COM),
      msg('4', 'customer', JUR),
    ];
    expect([...aberturasDeCanal(fio, false)]).toEqual([
      ['1', COM],
      ['4', JUR],
    ]);
  });

  it('GRUPO não recebe separador nenhum', () => {
    const fio = [msg('1', 'customer', COM), msg('2', 'customer', JUR)];
    expect(aberturasDeCanal(fio, true).size).toBe(0);
  });
});

describe('ultimoCanalDoCliente', () => {
  it('olha só o que o CLIENTE mandou', () => {
    const fio = [
      msg('1', 'customer', COM),
      msg('2', 'agent', JUR),
      msg('3', 'bot', JUR),
    ];
    expect(ultimoCanalDoCliente(fio)).toBe(COM);
  });

  it('pega o mais recente, não o primeiro', () => {
    const fio = [msg('1', 'customer', COM), msg('2', 'customer', JUR)];
    expect(ultimoCanalDoCliente(fio)).toBe(JUR);
  });

  it('sem mensagem do cliente, ou sem carimbo, devolve null', () => {
    expect(ultimoCanalDoCliente([msg('1', 'agent', COM)])).toBeNull();
    expect(ultimoCanalDoCliente([msg('1', 'customer', null)])).toBeNull();
    expect(ultimoCanalDoCliente([])).toBeNull();
  });
});

describe('canalDivergente', () => {
  const fioMisto = [
    msg('1', 'customer', JUR),
    msg('2', 'agent', JUR),
    msg('3', 'customer', COM),
  ];

  it('acusa quando a última do cliente veio por outro número', () => {
    // O caso medido em 02/09: cliente escreveu ao Comercial, a conversa
    // responde pelo Jurídico.
    expect(
      canalDivergente({ messages: fioMisto, canalDeSaida: JUR, ehGrupo: false }),
    ).toBe(COM);
  });

  it('cala quando a saída é o mesmo número da última do cliente', () => {
    expect(
      canalDivergente({ messages: fioMisto, canalDeSaida: COM, ehGrupo: false }),
    ).toBeNull();
  });

  it('canalDeSaida NULO cala — é o gate de carregamento', () => {
    // `useChannels` ainda não respondeu: um aviso montado sobre lista vazia
    // nomearia a divergência errada.
    expect(
      canalDivergente({ messages: fioMisto, canalDeSaida: null, ehGrupo: false }),
    ).toBeNull();
    expect(
      canalDivergente({
        messages: fioMisto,
        canalDeSaida: undefined,
        ehGrupo: false,
      }),
    ).toBeNull();
  });

  it('GRUPO nunca acusa', () => {
    expect(
      canalDivergente({ messages: fioMisto, canalDeSaida: JUR, ehGrupo: true }),
    ).toBeNull();
  });

  it('acusa mesmo com UM canal no fio — a conversa fixada noutro número', () => {
    // Sem `fioMulticanal` no caminho de propósito: aqui a divergência é
    // permanente, e toda resposta cai noutra conversa no celular do cliente.
    const soComercial = [msg('1', 'customer', COM)];
    expect(
      canalDivergente({
        messages: soComercial,
        canalDeSaida: JUR,
        ehGrupo: false,
      }),
    ).toBe(COM);
  });

  it('fio sem carimbo cala — não inventa divergência sobre o histórico antigo', () => {
    const antigo = [msg('1', 'customer', null)];
    expect(
      canalDivergente({ messages: antigo, canalDeSaida: JUR, ehGrupo: false }),
    ).toBeNull();
  });
});
