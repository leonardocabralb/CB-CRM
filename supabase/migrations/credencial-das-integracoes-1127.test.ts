import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Pinos da 1127 (a credencial de cada integração na tela). A prova no banco
// mora no bloco DO da própria migration; aqui ficam as peças que uma
// "simplificação" poderia tirar sem nenhum teste de tela acusar.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1127_cb_credencial_das_integracoes.sql'), 'utf8');

// Só o código, sem os comentários (que citam as mesmas palavras).
const codigo = sql
  .split('\n')
  .filter((linha) => !linha.trim().startsWith('--'))
  .join('\n');

describe('1127 — as colunas da credencial', () => {
  for (const tabela of ['cb_tldv_config', 'cb_calendly_config', 'cb_meta_ads_config', 'cb_asaas_config']) {
    it(`${tabela} ganha conectado_em e conferido_em, sem valor para as linhas que já existem`, () => {
      const bloco = codigo.slice(codigo.indexOf(`ALTER TABLE public.${tabela}`));
      expect(bloco).toMatch(/^ALTER TABLE public\.\w+\s+ADD COLUMN IF NOT EXISTS conectado_em timestamptz,\s+ADD COLUMN IF NOT EXISTS conferido_em timestamptz;/);
    });
  }

  it('cb_ia_chaves ganha chave_gravada_em (o updated_at é o dia da cópia da 1047)', () => {
    expect(codigo).toMatch(/ALTER TABLE public\.cb_ia_chaves\s+ADD COLUMN IF NOT EXISTS chave_gravada_em timestamptz;/);
    expect(codigo).toContain("table_name = 'cb_ia_chaves' AND column_name = 'chave_gravada_em'");
  });

  it('⚠️ sem DEFAULT: a data da chave atual não existe em lugar nenhum, e inventá-la mentiria na tela', () => {
    expect(codigo).not.toMatch(/(conectado_em|chave_gravada_em) timestamptz[^,;]*DEFAULT/i);
    expect(codigo).not.toMatch(/UPDATE public\.cb_\w+/i);
  });

  it('⚠️ as tabelas seguem fechadas ao navegador: nada é concedido a anon nem a authenticated', () => {
    expect(codigo).not.toMatch(/GRANT[^;]*\b(anon|authenticated)\b/i);
    expect(codigo).toMatch(/has_table_privilege\('anon'/);
    expect(codigo).toMatch(/has_table_privilege\('authenticated'/);
  });

  it('a conferência cobre as SEIS tabelas (Atlas e ZapSign já tinham as colunas)', () => {
    for (const tabela of ['cb_tldv_config', 'cb_calendly_config', 'cb_meta_ads_config', 'cb_asaas_config', 'cb_zapsign_config', 'cb_atlas_config']) {
      expect(codigo).toContain(`'${tabela}'`);
    }
  });
});
