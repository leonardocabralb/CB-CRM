import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Pinos da 1119 (recibos de mensagem em grupo, por participante). A prova
// com dado mora no bloco DO da própria migration (grava e se desfaz); aqui
// ficam as peças que um merge ou uma "simplificação" poderiam tirar sem
// nenhum teste de tela acusar.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1119_cb_recibos_do_grupo.sql'), 'utf8');

// Só o código, sem os comentários (que citam as mesmas palavras).
const codigo = sql
  .split('\n')
  .filter((linha) => !linha.trim().startsWith('--'))
  .join('\n');

const funcao = codigo.slice(
  codigo.indexOf('CREATE OR REPLACE FUNCTION public.cb_registrar_recibo_do_grupo'),
  codigo.indexOf('REVOKE EXECUTE ON FUNCTION public.cb_registrar_recibo_do_grupo'),
);

describe('1119 — a função que grava o recibo e conta os da mensagem', () => {
  it('⚠️ trava pela MENSAGEM antes de gravar: sem isso, dois recibos simultâneos contam "1" cada e a bolha fica em ✓', () => {
    const trava = funcao.indexOf('pg_advisory_xact_lock(');
    const insercao = funcao.indexOf('INSERT INTO public.cb_recibos_do_grupo');
    const contagem = funcao.indexOf('count(*)');
    expect(trava).toBeGreaterThan(-1);
    expect(trava).toBeLessThan(insercao);
    expect(insercao).toBeLessThan(contagem);
    expect(funcao).toMatch(/hashtextextended\(p_account_id::text \|\| '\|' \|\| p_message_id/);
  });

  it('é VOLATILE e em instruções separadas: a contagem tira foto depois da trava', () => {
    expect(funcao).toMatch(/LANGUAGE sql\s+VOLATILE/);
    expect(funcao).toMatch(/SECURITY INVOKER/);
  });

  it('só avança: recibo repetido ou fora de ordem não apaga nem atrasa', () => {
    expect(funcao).toContain('entregue_em = LEAST(r.entregue_em, EXCLUDED.entregue_em)');
    expect(funcao).toContain('lida_em = LEAST(r.lida_em, EXCLUDED.lida_em)');
    expect(funcao).toContain('telefone = COALESCE(EXCLUDED.telefone, r.telefone)');
  });

  it('o grupo é procurado NESTA conta (o de outra conta não grava nada)', () => {
    expect(funcao).toContain('WHERE g.account_id = p_account_id AND g.jid = p_group_jid');
  });

  it('só o servidor chama', () => {
    expect(codigo).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.cb_registrar_recibo_do_grupo\([^)]*\)\s+FROM PUBLIC, anon, authenticated;/,
    );
    expect(codigo).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.cb_registrar_recibo_do_grupo\([^)]*\)\s+TO service_role;/,
    );
  });
});

describe('1119 — a tabela', () => {
  it('sem FK para o fecho do contato (a Lixeira e a união são default-deny); para o grupo, composta e CASCADE', () => {
    const tabela = codigo.slice(
      codigo.indexOf('CREATE TABLE IF NOT EXISTS public.cb_recibos_do_grupo'),
      codigo.indexOf('CREATE INDEX IF NOT EXISTS cb_recibos_do_grupo_grupo_idx'),
    );
    expect(tabela).not.toMatch(/REFERENCES public\.(contacts|conversations|messages)\b/);
    expect(tabela).toMatch(
      /FOREIGN KEY \(group_id, account_id\)\s+REFERENCES public\.cb_groups \(id, account_id\) ON DELETE CASCADE/,
    );
  });

  it('leitura na forma da 1032, escrita só do servidor, nada para anon', () => {
    expect(codigo).toContain('USING (account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario())))');
    expect(codigo).toContain('REVOKE ALL ON public.cb_recibos_do_grupo FROM anon, authenticated;');
    expect(codigo).toContain('GRANT SELECT ON public.cb_recibos_do_grupo TO authenticated;');
    expect(codigo).not.toMatch(/CREATE POLICY [^;]*cb_recibos_do_grupo FOR (INSERT|UPDATE|DELETE|ALL)/);
  });

  it('o denominador nunca é negativo, e nulo quer dizer "não se sabe"', () => {
    expect(codigo).toContain('CHECK (participantes_de_fora IS NULL OR participantes_de_fora >= 0)');
  });
});
