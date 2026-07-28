import { describe, it, expect } from 'vitest';
import type { CbGroup, Conversation } from '@/types';
import {
  bloqueioDeEnvioNoGrupo,
  corDoRemetente,
  ehConversaDeGrupo,
  nomeDoGrupo,
  podeBaixarAnexo,
  podeRenomearNoWhatsApp,
  tituloDaConversa,
} from './display';

const grupo = (p: Partial<CbGroup>) => p as CbGroup;
const conv = (p: Partial<Conversation>) => p as Conversation;

describe('nomeDoGrupo', () => {
  it('apelido interno vence o nome real', () => {
    // Quem apelidou quis ver o apelido. O nome real segue visível no painel.
    expect(nomeDoGrupo(grupo({ alias: 'Caso Silva', subject: 'Família Silva' }), 'X')).toBe(
      'Caso Silva',
    );
  });

  it('sem apelido, usa o nome real', () => {
    expect(nomeDoGrupo(grupo({ alias: null, subject: 'Família Silva' }), 'X')).toBe(
      'Família Silva',
    );
  });

  it('sem nenhum dos dois, usa o texto que veio do dicionário', () => {
    // Existe grupo real sem nome: 1 dos 58 do número de produção.
    expect(nomeDoGrupo(grupo({ alias: null, subject: null }), 'Grupo sem nome')).toBe(
      'Grupo sem nome',
    );
    expect(nomeDoGrupo(null, 'Grupo sem nome')).toBe('Grupo sem nome');
  });

  it('só espaço em branco conta como ausente', () => {
    expect(nomeDoGrupo(grupo({ alias: '   ', subject: '  ' }), 'Sem nome')).toBe('Sem nome');
  });
});

describe('tituloDaConversa', () => {
  const textos = { semNome: 'Grupo sem nome', desconhecido: 'Desconhecido' };

  it('grupo usa o nome do grupo', () => {
    expect(
      tituloDaConversa(
        conv({ group_id: 'g1', group: grupo({ subject: 'Clientes SP' }) }),
        textos,
      ),
    ).toBe('Clientes SP');
  });

  it('conversa direta usa o nome do contato', () => {
    expect(
      tituloDaConversa(conv({ contact: { name: 'Ana', phone: '+5511' } as never }), textos),
    ).toBe('Ana');
  });

  it('contato sem nome cai para o telefone', () => {
    expect(
      tituloDaConversa(conv({ contact: { name: '', phone: '+5511' } as never }), textos),
    ).toBe('+5511');
  });

  it('sem contato nenhum usa o texto de desconhecido', () => {
    expect(tituloDaConversa(conv({}), textos)).toBe('Desconhecido');
  });

  it('⚠️ grupo sem o join hidratado ainda mostra algo utilizável', () => {
    // O payload de tempo real do Supabase não traz joins: uma conversa de
    // grupo recém-criada chega com `group_id` e sem `group`. Sem este caso a
    // linha apareceria com o texto de "contato desconhecido".
    expect(tituloDaConversa(conv({ group_id: 'g1' }), textos)).toBe('Grupo sem nome');
  });
});

describe('ehConversaDeGrupo', () => {
  it('responde pelo group_id, que sempre vem no payload', () => {
    expect(ehConversaDeGrupo(conv({ group_id: 'g1' }))).toBe(true);
    expect(ehConversaDeGrupo(conv({ contact_id: 'c1' }))).toBe(false);
    expect(ehConversaDeGrupo(null)).toBe(false);
  });
});

describe('podeRenomearNoWhatsApp', () => {
  it('só com admin confirmado', () => {
    expect(podeRenomearNoWhatsApp(grupo({ we_are_admin: true }))).toBe(true);
    expect(podeRenomearNoWhatsApp(grupo({ we_are_admin: false }))).toBe(false);
  });

  it('⚠️ "ainda não sei" NÃO destrava o botão', () => {
    // Habilitar por otimismo faria o operador clicar e receber um erro cru da
    // Evolution — pior que um botão desabilitado com o motivo à vista.
    expect(podeRenomearNoWhatsApp(grupo({ we_are_admin: null }))).toBe(false);
    expect(podeRenomearNoWhatsApp(null)).toBe(false);
  });
});

describe('bloqueioDeEnvioNoGrupo', () => {
  it('canal Meta bloqueia sempre, mesmo sendo admin', () => {
    // A API oficial da Meta não fala com grupo nenhum. É o impedimento mais
    // forte e precisa vencer os outros.
    expect(bloqueioDeEnvioNoGrupo(grupo({ is_announce: false, we_are_admin: true }), true)).toBe(
      'canal_meta',
    );
  });

  it('grupo só-admin bloqueia quem não é admin', () => {
    expect(bloqueioDeEnvioNoGrupo(grupo({ is_announce: true, we_are_admin: false }), false)).toBe(
      'so_admin_envia',
    );
  });

  it('grupo só-admin libera quem é admin', () => {
    expect(
      bloqueioDeEnvioNoGrupo(grupo({ is_announce: true, we_are_admin: true }), false),
    ).toBeNull();
  });

  it('grupo comum não bloqueia', () => {
    expect(
      bloqueioDeEnvioNoGrupo(grupo({ is_announce: false, we_are_admin: false }), false),
    ).toBeNull();
  });

  it('sem sincronização ainda, não bloqueia por suposição', () => {
    // `is_announce: null` = não sabemos. Bloquear no escuro impediria de
    // responder num grupo comum; se de fato for só-admin, a Evolution recusa
    // e o erro aparece na hora do envio.
    expect(
      bloqueioDeEnvioNoGrupo(grupo({ is_announce: null, we_are_admin: null }), false),
    ).toBeNull();
  });
});

describe('corDoRemetente', () => {
  it('é estável — a mesma pessoa mantém a mesma cor', () => {
    // Cor sorteada a cada render seria pior que cor nenhuma: o operador usa a
    // cor para seguir uma conversa dentro do paredão de texto.
    expect(corDoRemetente('111@lid', 8)).toBe(corDoRemetente('111@lid', 8));
  });

  it('fica dentro da paleta', () => {
    for (const jid of ['a@lid', 'bbb@lid', '5511999998888@s.whatsapp.net']) {
      const c = corDoRemetente(jid, 8);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(8);
    }
  });

  it('distribui — não joga todo mundo na mesma cor', () => {
    const usadas = new Set(
      Array.from({ length: 40 }, (_, i) => corDoRemetente(`${i}00@lid`, 8)),
    );
    expect(usadas.size).toBeGreaterThan(4);
  });

  it('sem jid não estoura', () => {
    expect(corDoRemetente(null, 8)).toBe(0);
    expect(corDoRemetente('x@lid', 0)).toBe(0);
  });
});

describe('podeBaixarAnexo', () => {
  it('oferece o botão para pendente e para falha', () => {
    expect(podeBaixarAnexo({ media_state: 'pending' })).toBe(true);
    expect(podeBaixarAnexo({ media_state: 'failed' })).toBe(true);
  });

  it('não oferece quando o arquivo já está no Storage', () => {
    expect(podeBaixarAnexo({ media_url: 'http://x/a.jpg', media_state: 'pending' })).toBe(false);
  });

  it('⚠️ não oferece para arquivo grande demais', () => {
    // Passa do teto do bucket: tentar de novo produziria a mesma falha. O
    // balão diz "veja no celular" em vez de um botão que nunca funciona.
    expect(podeBaixarAnexo({ media_state: 'too_large' })).toBe(false);
  });

  it('mensagem sem anexo não oferece nada', () => {
    expect(podeBaixarAnexo({})).toBe(false);
  });
});
