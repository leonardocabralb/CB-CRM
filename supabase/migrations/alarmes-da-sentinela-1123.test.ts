import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { CHAVES_DA_SENTINELA } from '@/lib/cb-channels/alarmes-da-sentinela';

// ============================================================
// Pinos da 1123 (os alarmes de conexão abertos da sentinela da VPS, para o
// botão das conexões). A prova no banco mora no bloco DO da própria
// migration; aqui ficam as peças que uma "simplificação" poderia tirar sem
// nenhum teste de tela acusar — e o contrato com a sentinela (Python), que
// nenhum teste do CRM executa.
// ============================================================

const raiz = path.join(__dirname, '..', '..');
const sql = fs.readFileSync(path.join(__dirname, '1123_cb_alarmes_da_sentinela.sql'), 'utf8');
const sentinela = fs.readFileSync(path.join(raiz, 'ops/vps/saude-whatsapp/sentinela.py'), 'utf8');

// Só o código, sem os comentários (que citam as mesmas palavras).
const codigo = sql
  .split('\n')
  .filter((linha) => !linha.trim().startsWith('--'))
  .join('\n');

describe('1123 — a tabela dos alarmes da sentinela', () => {
  it('⚠️ fechada ao navegador: RLS ligada, nenhuma policy, nada para anon e authenticated', () => {
    expect(codigo).toMatch(/ALTER TABLE public\.cb_alarmes_da_sentinela ENABLE ROW LEVEL SECURITY/);
    expect(codigo).toMatch(
      /REVOKE ALL ON TABLE public\.cb_alarmes_da_sentinela FROM PUBLIC, anon, authenticated/,
    );
    expect(codigo).toMatch(/GRANT ALL ON TABLE public\.cb_alarmes_da_sentinela TO service_role/);
    expect(codigo).not.toMatch(/CREATE POLICY/i);
  });

  it('⚠️ a conexão apagada leva a linha junto (FK composta com CASCADE)', () => {
    expect(codigo).toMatch(
      /FOREIGN KEY \(channel_id, account_id\)\s+REFERENCES public\.cb_channels \(id, account_id\)\s+ON DELETE CASCADE/,
    );
  });

  it('⚠️ fica FORA da publicação realtime: a conferência barra a entrada nela', () => {
    expect(codigo).not.toMatch(/ALTER PUBLICATION/i);
    expect(codigo).toMatch(/pg_publication_tables/);
  });

  it('uma linha por conexão e chave; o upsert da sentinela depende desta chave primária', () => {
    expect(codigo).toMatch(/PRIMARY KEY \(channel_id, chave\)/);
    expect(sentinela).toMatch(/cb_alarmes_da_sentinela\?on_conflict=channel_id,chave/);
  });
});

describe('1123 — o contrato com a sentinela', () => {
  const chavesDoBanco = (/CHECK \(chave IN \(([^)]*)\)\)/.exec(codigo)?.[1] ?? '')
    .split(',')
    .map((c) => c.trim().replace(/'/g, ''));

  it('⚠️ as chaves que a sentinela grava são EXATAMENTE as do CHECK (a fora dele faria o lote inteiro falhar)', () => {
    const tupla = /CHAVES_DO_BOTAO = \(([^)]*)\)/.exec(sentinela)?.[1] ?? '';
    const chavesDaSentinela = tupla
      .split(',')
      .map((c) => c.trim().replace(/'/g, ''))
      .filter(Boolean);
    expect(chavesDaSentinela.sort()).toEqual([...chavesDoBanco].sort());
  });

  it('⚠️ e as que o CRM lê também: chave fora da lista do leitor seria descartada em silêncio', () => {
    expect([...CHAVES_DA_SENTINELA].sort()).toEqual([...chavesDoBanco].sort());
  });

  it('⚠️ o `conexao:` fica fora: a sonda do CRM já vê a conexão fora do ar ao vivo', () => {
    expect(chavesDoBanco).not.toContain('conexao');
  });
});
