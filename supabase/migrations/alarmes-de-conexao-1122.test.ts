import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Pinos da 1122 (o estado dos alarmes de conexão no sino). A prova no banco
// mora no bloco DO da própria migration; aqui ficam as peças que uma
// "simplificação" poderia tirar sem nenhum teste de tela acusar.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1122_cb_alarmes_de_conexao.sql'), 'utf8');

// Só o código, sem os comentários (que citam as mesmas palavras).
const codigo = sql
  .split('\n')
  .filter((linha) => !linha.trim().startsWith('--'))
  .join('\n');

describe('1122 — o estado dos alarmes no sino', () => {
  it('⚠️ fechada ao navegador: RLS ligada, nenhuma policy, nada para anon e authenticated', () => {
    expect(codigo).toMatch(/ALTER TABLE public\.cb_alarmes_de_conexao ENABLE ROW LEVEL SECURITY/);
    expect(codigo).toMatch(
      /REVOKE ALL ON TABLE public\.cb_alarmes_de_conexao FROM PUBLIC, anon, authenticated/,
    );
    expect(codigo).toMatch(/GRANT ALL ON TABLE public\.cb_alarmes_de_conexao TO service_role/);
    expect(codigo).not.toMatch(/CREATE POLICY/i);
  });

  it('⚠️ a conexão apagada leva o estado junto (FK composta com CASCADE)', () => {
    expect(codigo).toMatch(
      /FOREIGN KEY \(channel_id, account_id\)\s+REFERENCES public\.cb_channels \(id, account_id\)\s+ON DELETE CASCADE/,
    );
  });

  it('uma linha por conexão e tipo, e só os dois tipos que o passo do ciclo conhece', () => {
    expect(codigo).toMatch(/PRIMARY KEY \(channel_id, tipo\)/);
    expect(codigo).toMatch(/CHECK \(tipo IN \('sem_recibo', 'atraso'\)\)/);
  });

  it('⚠️ fica FORA da publicação realtime: a conferência barra a entrada nela', () => {
    expect(codigo).not.toMatch(/ALTER PUBLICATION/i);
    expect(codigo).toMatch(/pg_publication_tables/);
  });
});
