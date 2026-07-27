// A guarda que fecha um buraco real: até aqui a família /api/whatsapp/*
// autenticava só a SESSÃO, então um convidado `viewer` — que existe
// justamente para ser somente-leitura — enviava mensagem para clientes,
// reagia, disparava campanha e mexia na conexão do WhatsApp.
import { describe, expect, it } from 'vitest';

import { barrarPorPapel } from './barrar-por-papel';

describe('barrarPorPapel', () => {
  it('deixa passar quem alcança o mínimo', () => {
    expect(barrarPorPapel('agent', 'agent')).toBeNull();
    expect(barrarPorPapel('admin', 'agent')).toBeNull();
    expect(barrarPorPapel('owner', 'agent')).toBeNull();
    expect(barrarPorPapel('admin', 'admin')).toBeNull();
    expect(barrarPorPapel('owner', 'admin')).toBeNull();
  });

  it('barra o viewer em tudo que é escrita', () => {
    expect(barrarPorPapel('viewer', 'agent')?.status).toBe(403);
    expect(barrarPorPapel('viewer', 'admin')?.status).toBe(403);
  });

  it('barra o agent no que é de configuração', () => {
    // Conexão do WhatsApp e modelos de mensagem são `canEditSettings`,
    // que exige admin — um atendente não deve reconfigurar o número.
    expect(barrarPorPapel('agent', 'admin')?.status).toBe(403);
  });

  // Estado inesperado NUNCA pode virar permissão. Uma linha de `profiles`
  // sem papel, ou com papel que o código não conhece, tem de recusar.
  it('papel ausente, nulo ou desconhecido é BARRADO, não permitido', () => {
    for (const invalido of [undefined, null, '', 'root', 'superuser', 42, {}, []]) {
      expect(barrarPorPapel(invalido, 'agent')?.status, String(invalido)).toBe(403);
    }
  });

  it('não confunde papel parecido', () => {
    expect(barrarPorPapel('Agent', 'agent')?.status).toBe(403);
    expect(barrarPorPapel('agents', 'agent')?.status).toBe(403);
  });
});
