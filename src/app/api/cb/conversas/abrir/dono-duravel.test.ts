import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// `contacts.user_id` e `conversations.user_id` referenciam `auth.users` com
// **ON DELETE CASCADE**, e `conversations.contact_id` cascateia de novo.
// Quem for gravado ali leva, ao sair da conta, o contato + a conversa + todas
// as mensagens daquele cliente.
//
// O erro é fácil e invisível: a rota já tem o `user` autenticado em mão, e
// `user_id: user.id` parece a coisa óbvia a escrever — o typecheck aprova, a
// tela funciona, e a perda só aparece no dia em que alguém for removido da
// equipe. Por isso a regra é verificada no FONTE, e não por comportamento.
// (Achado do Codex na revisão do PR #79.)
// ============================================================

const fonte = fs
  .readFileSync(path.join(__dirname, 'route.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('abrir conversa: dono de registro durável', () => {
  it('resolve o dono da conta', () => {
    expect(fonte).toContain('owner_user_id');
  });

  it('não grava quem clicou em nenhum `user_id`', () => {
    // Pega tanto `user_id: user.id` quanto o repasse por parâmetro.
    expect(fonte).not.toMatch(/user_id:\s*user\.id/);
    expect(fonte).not.toMatch(/user_id:\s*userId/);
  });

  it('todo `user_id` gravado vem do dono da conta', () => {
    const gravados = [...fonte.matchAll(/user_id:\s*([A-Za-z0-9_.]+)/g)]
      .map((m) => m[1])
      // `owner_user_id` aparece no SELECT que resolve o dono, não num insert.
      .filter((v) => v !== 'owner_user_id');
    expect(gravados.length).toBeGreaterThan(0);
    for (const v of gravados) expect(v).toBe('donoDaConta');
  });
});
