import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { ENCERRAMENTOS } from '../../src/lib/whatsapp/ligacoes/evento';

// ============================================================
// Pinos da 1044 (ligações de WhatsApp). O replay do CI prova que ela APLICA;
// estes provam o que ela NÃO pode perder numa edição ou num merge.
//
// LIMITE DECLARADO: lê o `.sql`. Objeto criado por `EXECUTE format(...)` num
// DO block é invisível aqui.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1044_cb_ligacoes.sql'), 'utf8');
const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');
const lerModulo = (arquivo: string) =>
  fs.readFileSync(path.join(__dirname, '../../src/lib/whatsapp/ligacoes', arquivo), 'utf8');
const registrar = lerModulo('registrar.ts');
/** Quem ESCREVE desfecho: o registro (sem bolha) e a régua (perdida/atendida). */
const escritoresDeDesfecho = registrar + lerModulo('desfecho.ts');

describe('1044 — cb_ligacoes fechada ao navegador', () => {
  it('RLS ligada, sem policy, e as DUAS metades do REVOKE', () => {
    expect(/ALTER\s+TABLE\s+cb_ligacoes\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(semComentarios)).toBe(true);
    expect(/REVOKE\s+ALL\s+ON\s+TABLE\s+cb_ligacoes\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(semComentarios)).toBe(
      true,
    );
    expect(/CREATE\s+POLICY/i.test(semComentarios)).toBe(false);
    expect(/GRANT[^;]*\bON\s+TABLE\s+cb_ligacoes\b[^;]*\b(anon|authenticated)\b/i.test(semComentarios)).toBe(false);
    expect(/GRANT\s+ALL\s+ON\s+TABLE\s+cb_ligacoes\s+TO\s+service_role/i.test(semComentarios)).toBe(true);
  });

  it('a chave do upsert é TOTAL (conta + call_id): índice parcial não serve de alvo do ON CONFLICT', () => {
    expect(semComentarios).toMatch(/CONSTRAINT\s+cb_ligacoes_conta_chamada_key\s+UNIQUE\s*\(account_id,\s*call_id\)/);
    expect(registrar).toContain("onConflict: 'account_id,call_id'");
  });

  it('a conexão é da mesma conta (FK composta) e apagá-la preserva o registro', () => {
    expect(semComentarios).toMatch(
      /FOREIGN KEY \(channel_id, account_id\)\s*REFERENCES cb_channels \(id, account_id\)\s*ON DELETE SET NULL \(channel_id\)/,
    );
  });

  it('todo desfecho que o código grava está no CHECK', () => {
    const check = /cb_ligacoes_desfecho_ck[\s\S]*?\)\s*\)/.exec(semComentarios)?.[0] ?? '';
    for (const desfecho of ['perdida', 'atendida', 'sem_telefone', 'do_escritorio', 'falhou']) {
      expect(check).toContain(`'${desfecho}'`);
      expect(escritoresDeDesfecho).toContain(`'${desfecho}'`);
    }
  });

  it('todo encerramento que o evento conhece está no CHECK', () => {
    const check = /cb_ligacoes_encerramento_ck[\s\S]*?\)\)/.exec(semComentarios)?.[0] ?? '';
    for (const e of ENCERRAMENTOS) expect(check).toContain(`'${e}'`);
  });
});

describe('1044 — messages aceita a ligação', () => {
  it("o CHECK de tipo ganha 'call' sem perder nenhum tipo de antes (0906)", () => {
    const check = /ADD CONSTRAINT messages_content_type_check[\s\S]*?\)\);/.exec(semComentarios)?.[0] ?? '';
    for (const tipo of [
      'text',
      'image',
      'document',
      'audio',
      'video',
      'location',
      'template',
      'interactive',
      'system',
      'call',
    ]) {
      expect(check).toContain(`'${tipo}'`);
    }
    expect(semComentarios).toContain('DROP CONSTRAINT IF EXISTS messages_content_type_check');
  });

  it('a coluna dos detalhes, e o teto de espera pela trava de messages', () => {
    expect(semComentarios).toContain('ADD COLUMN IF NOT EXISTS ligacao jsonb');
    expect(semComentarios).toMatch(/SET LOCAL lock_timeout = '5s'/);
  });

  it('a conferência é SÓ catálogo: depois da ALTER em messages, nenhuma linha é lida nem escrita', () => {
    // A trava exclusiva de `messages` fica presa até o fim da transação
    // (regra da 1032): escrever ali, ou varrer tabela, segura a ingestão.
    const primeiraAlter = semComentarios.search(/ALTER\s+TABLE\s+messages\b/i);
    expect(primeiraAlter).toBeGreaterThan(0);
    const depois = semComentarios.slice(primeiraAlter);
    expect(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(depois)).toBe(false);
    expect(/\bFROM\s+(public\.)?(messages|conversations|contacts)\b/i.test(depois)).toBe(false);
    expect(/WHEN\s+OTHERS/i.test(semComentarios)).toBe(false);
  });

  it('a conferência exige UM CHECK sobre content_type (um segundo, de outro nome, recusaria a ligação)', () => {
    expect(semComentarios).toMatch(/contype = 'c'\s+AND pg_get_constraintdef\(oid\) ~ '\\mcontent_type\\M'/);
    expect(semComentarios).toContain('esperava UM CHECK sobre messages.content_type');
  });
});
