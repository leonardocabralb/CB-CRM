import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { PREFIXO_DA_CHAVE_RESTRITA } from '@/lib/api-keys/keys';

// ============================================================
// 1143 — a chave RESTRITA (funcionário ou recortada por funil) guarda o hash
// com um prefixo, para a imagem de antes desta versão não a achar: voltar a
// imagem deixa a chave PARADA, nunca aberta para a conta inteira. O prefixo
// mora no SQL (gatilho + CHECK) e no TS (`findActiveKeyByHash`): mudou um,
// muda o outro.
//
// LIMITE DECLARADO: lê o `.sql`; a prova com dado é a conferência da própria
// migration (o gatilho exercitado num subbloco desfeito).
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1143_cb_chave_restrita_parada_ao_voltar.sql'), 'utf8');

describe('1143 — o prefixo da chave restrita', () => {
  it('o gatilho põe e tira o MESMO prefixo do TS', () => {
    expect(sql).toContain(`regexp_replace(NEW.key_hash, '^${PREFIXO_DA_CHAVE_RESTRITA}', '')`);
    expect(sql).toContain(
      `WHEN NEW.membro_user_id IS NOT NULL OR NEW.funis IS NOT NULL THEN '${PREFIXO_DA_CHAVE_RESTRITA}' || v_puro`,
    );
  });

  it('dispara em todo escritor: INSERT e UPDATE do hash e das duas colunas', () => {
    expect(sql).toMatch(
      /CREATE TRIGGER cb_api_keys_hash_da_restrita_trigger\s+BEFORE INSERT OR UPDATE OF key_hash, membro_user_id, funis ON public\.api_keys\s+FOR EACH ROW/,
    );
  });

  it('o CHECK segura as duas formas, com o mesmo prefixo', () => {
    expect(sql).toContain(
      `CHECK ((membro_user_id IS NULL AND funis IS NULL) = NOT starts_with(key_hash, '${PREFIXO_DA_CHAVE_RESTRITA}'))`,
    );
  });

  it('o prefixo não é hexadecimal: nunca colide com um hash puro', () => {
    expect(PREFIXO_DA_CHAVE_RESTRITA).not.toMatch(/^[0-9a-f]*$/);
  });
});
