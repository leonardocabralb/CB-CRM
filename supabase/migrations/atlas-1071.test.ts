import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1071 — a integração com o Atlas. O que este pino segura:
//
// 1. `cb_atlas_config` (a chave cifrada) é FECHADA ao navegador: RLS ligada,
//    nenhuma policy, REVOKE de anon e authenticated. A tela lê pela rota.
// 2. `cb_atlas_clientes` (o vínculo, sem dado pessoal) o membro só LÊ, pela
//    forma da 1032; escrever é do servidor.
// 3. O vínculo é 1:1 com UNIQUE TOTAL (alvo de upsert válido) e a ficha
//    apagada deixa o vínculo órfão (SET NULL da coluna), nunca o apaga junto.
// ============================================================

const SQL = fs.readFileSync(path.join(__dirname, '1071_cb_atlas.sql'), 'utf8');
// Sem os comentários: um comentário que descreva a forma proibida não pode
// fazer o pino passar.
const CODIGO = SQL.replace(/--.*$/gm, '');

describe('1071 — Atlas', () => {
  it('a conexão é fechada ao navegador, sem policy', () => {
    expect(CODIGO).toMatch(/ALTER TABLE cb_atlas_config ENABLE ROW LEVEL SECURITY;/);
    expect(CODIGO).toContain('REVOKE ALL ON TABLE cb_atlas_config FROM PUBLIC, anon, authenticated;');
    expect(CODIGO).toContain('GRANT ALL ON TABLE cb_atlas_config TO service_role;');
    expect(CODIGO).not.toMatch(/CREATE POLICY[^;]*cb_atlas_config/);
    expect(CODIGO).not.toMatch(/GRANT[^;]*ON TABLE cb_atlas_config TO (authenticated|anon)/);
  });

  it('o vínculo: o membro só lê, pela forma da 1032', () => {
    expect(CODIGO).toContain('REVOKE ALL ON TABLE cb_atlas_clientes FROM PUBLIC, anon, authenticated;');
    expect(CODIGO).toContain('GRANT SELECT ON TABLE cb_atlas_clientes TO authenticated;');
    expect(CODIGO).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*ON TABLE cb_atlas_clientes TO authenticated/);
    expect(CODIGO).toMatch(
      /CREATE POLICY cb_atlas_clientes_select ON public\.cb_atlas_clientes FOR SELECT\s+USING \(account_id = ANY \(ARRAY\(SELECT public\.cb_contas_do_usuario\(\)\)\)\);/,
    );
    expect(CODIGO.match(/CREATE POLICY/g)).toHaveLength(1);
  });

  it('1:1 com UNIQUE TOTAL, e a ficha apagada só solta o vínculo', () => {
    expect(CODIGO).toMatch(/CONSTRAINT cb_atlas_clientes_cliente_key UNIQUE \(account_id, atlas_client_id\)/);
    expect(CODIGO).toMatch(/CONSTRAINT cb_atlas_clientes_contato_key UNIQUE \(account_id, contact_id\)/);
    expect(CODIGO).toMatch(/REFERENCES contacts \(id, account_id\) ON DELETE SET NULL \(contact_id\)/);
    expect(CODIGO).toMatch(/CREATE INDEX IF NOT EXISTS cb_atlas_clientes_contato_idx\s+ON cb_atlas_clientes \(contact_id\) WHERE contact_id IS NOT NULL;/);
  });

  it('a origem do vínculo é uma lista fechada, igual à do passo', () => {
    expect(CODIGO).toMatch(/CHECK \(origem IN \('criada', 'reativada', 'encontrada', 'manual'\)\)/);
    const passo = fs.readFileSync(path.join(__dirname, '../../src/lib/atlas/criar-cliente.ts'), 'utf8');
    for (const o of passo.match(/"(criada|reativada|encontrada)"/g) ?? []) {
      expect(CODIGO).toContain(`'${o.replaceAll('"', '')}'`);
    }
  });
});
