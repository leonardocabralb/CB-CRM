import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Pinos da 1122 (o estado dos alarmes de conexão no sino). A prova no banco
// mora nos blocos DO da própria migration (a função é CHAMADA, como o
// service_role, e desfeita); aqui ficam as peças que uma "simplificação"
// poderia tirar sem nenhum teste de tela acusar.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1122_cb_alarmes_de_conexao.sql'), 'utf8');

// Só o código, sem os comentários (que citam as mesmas palavras).
const codigo = sql
  .split('\n')
  .filter((linha) => !linha.trim().startsWith('--'))
  .join('\n');

const funcao = codigo.slice(
  codigo.indexOf('CREATE OR REPLACE FUNCTION public.cb_gravar_alarme_de_conexao'),
  codigo.indexOf('REVOKE EXECUTE ON FUNCTION public.cb_gravar_alarme_de_conexao'),
);

describe('1122 — a tabela do estado', () => {
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

describe('1122 — o estado e o aviso numa transação só', () => {
  it('⚠️ o aviso só entra DEPOIS de a escrita cercada valer, na mesma função (revisão: em duas escritas o alarme se perdia)', () => {
    const contagem = funcao.indexOf('GET DIAGNOSTICS v_linhas = ROW_COUNT');
    const recusa = funcao.indexOf('IF v_linhas <> 1 THEN');
    const aviso = funcao.indexOf('INSERT INTO public.notifications');
    expect(contagem).toBeGreaterThan(-1);
    expect(contagem).toBeLessThan(recusa);
    expect(recusa).toBeLessThan(aviso);
  });

  it('⚠️ a cerca é o avisado_em, o normalizou_em e o devido_em lidos — no UPDATE e no DELETE', () => {
    for (const coluna of ['avisado_em', 'normalizou_em', 'devido_em']) {
      const cerca = new RegExp(
        `a\\.${coluna}\\s+IS NOT DISTINCT FROM \\(p_de->>'${coluna}'\\)::timestamptz`,
        'g',
      );
      expect(funcao.match(cerca)).toHaveLength(2);
    }
    expect(funcao).toMatch(/ON CONFLICT \(channel_id, tipo\) DO NOTHING/);
  });

  it('⚠️ o aviso vai só a membro ATIVO da conta, conferido no banco', () => {
    expect(funcao).toMatch(/FROM public\.profiles p\s+WHERE p\.account_id = p_account_id\s+AND p\.suspenso_em IS NULL/);
  });

  it('⚠️ só o servidor executa: fechada a PUBLIC, anon e authenticated, aberta ao service_role', () => {
    expect(funcao).toMatch(/SECURITY INVOKER/);
    expect(codigo).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.cb_gravar_alarme_de_conexao\([^)]*\)\s+FROM PUBLIC, anon, authenticated/,
    );
    expect(codigo).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.cb_gravar_alarme_de_conexao\([^)]*\)\s+TO service_role/,
    );
  });

  it('⚠️ a conferência CHAMA a função como o service_role e se desfaz pelo SQLSTATE próprio', () => {
    expect(codigo).toMatch(/SET LOCAL ROLE service_role;/);
    expect(codigo).toMatch(/RAISE EXCEPTION USING ERRCODE = 'P1122'/);
    expect(codigo).toMatch(/EXCEPTION WHEN SQLSTATE 'P1122' THEN/);
    expect(codigo).not.toMatch(/WHEN OTHERS/);
  });
});
