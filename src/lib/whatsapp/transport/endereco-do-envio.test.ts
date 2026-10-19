import { describe, expect, it } from 'vitest';

import { enderecoDoEnvio, jidDoClienteNaOutraGrafia } from './endereco-do-envio';

// Números fictícios. "Com o 9" = como a ficha costuma guardar; "sem o 9" =
// como o WhatsApp endereça o número antigo de DDD 31 em diante.
const COM_9 = '5583988887777';
const SEM_9 = '558388887777';
const jid = (digitos: string) => `${digitos}@s.whatsapp.net`;
const LID = '100000000000102@lid';

describe('enderecoDoEnvio: o endereço que a Evolution USOU, não o da ficha', () => {
  it('ficha com o 9 e WhatsApp sem: grava o do WhatsApp (o caso medido em 19/10/2026)', () => {
    expect(enderecoDoEnvio(jid(SEM_9), COM_9)).toEqual({
      remoteJid: jid(SEM_9),
      remoteJidLid: null,
    });
  });

  it('ficha sem o 9 e WhatsApp com: grava o do WhatsApp', () => {
    expect(enderecoDoEnvio(jid(COM_9), SEM_9)).toEqual({
      remoteJid: jid(COM_9),
      remoteJidLid: null,
    });
  });

  it('mesma grafia: nada muda', () => {
    expect(enderecoDoEnvio(jid(COM_9), COM_9)).toEqual({
      remoteJid: jid(COM_9),
      remoteJidLid: null,
    });
  });

  it('enviada pelo LID: o LID vai para remote_jid_lid, e remote_jid segue telefone', () => {
    expect(enderecoDoEnvio(LID, `+${COM_9}`)).toEqual({
      remoteJid: jid(COM_9),
      remoteJidLid: LID,
    });
  });

  it.each([null, undefined, ''])('resposta sem o endereço (%s): o da ficha, como antes', (usado) => {
    expect(enderecoDoEnvio(usado, `+${COM_9}`)).toEqual({
      remoteJid: jid(COM_9),
      remoteJidLid: null,
    });
  });

  it.each([
    `${SEM_9}:12@s.whatsapp.net`,
    '120363000000000000@g.us',
    `${SEM_9}`,
    'lixo@s.whatsapp.net',
  ])('forma que não reconhecemos (%s): o da ficha', (usado) => {
    expect(enderecoDoEnvio(usado, COM_9)).toEqual({
      remoteJid: jid(COM_9),
      remoteJidLid: null,
    });
  });
});

describe('jidDoClienteNaOutraGrafia: corrige o que foi gravado antes', () => {
  it('gravado com o 9, cliente escreve sem: devolve o do cliente', () => {
    expect(jidDoClienteNaOutraGrafia(jid(COM_9), jid(SEM_9))).toBe(jid(SEM_9));
  });

  it('gravado sem o 9, cliente escreve com: devolve o do cliente', () => {
    expect(jidDoClienteNaOutraGrafia(jid(SEM_9), jid(COM_9))).toBe(jid(COM_9));
  });

  it('mesma grafia: nada a corrigir', () => {
    expect(jidDoClienteNaOutraGrafia(jid(COM_9), jid(COM_9))).toBeNull();
  });

  it('outro número de verdade: nunca troca (a revogação iria para a conversa de outro)', () => {
    expect(jidDoClienteNaOutraGrafia(jid(COM_9), jid('558388881111'))).toBeNull();
    expect(jidDoClienteNaOutraGrafia(jid(COM_9), jid('5511988887777'))).toBeNull();
  });

  it('sem mensagem do cliente, ou em LID: fica o gravado', () => {
    expect(jidDoClienteNaOutraGrafia(jid(COM_9), null)).toBeNull();
    expect(jidDoClienteNaOutraGrafia(jid(COM_9), undefined)).toBeNull();
    expect(jidDoClienteNaOutraGrafia(jid(COM_9), LID)).toBeNull();
  });

  it('fixo não tem nono dígito: não inventa irmã', () => {
    expect(jidDoClienteNaOutraGrafia(jid('558332221111'), jid('5583932221111'))).toBeNull();
  });

  it('gravado que não é telefone (grupo): fica o gravado', () => {
    expect(jidDoClienteNaOutraGrafia('120363000000000000@g.us', jid(SEM_9))).toBeNull();
  });
});
