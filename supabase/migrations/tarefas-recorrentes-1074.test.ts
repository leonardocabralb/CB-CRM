import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { INTERVALOS_DE_REPETICAO } from '../../src/lib/tasks/validar';

// ============================================================
// 1074 — tarefa recorrente. O que este pino segura:
//
// 1. O CHECK dos intervalos é o ESPELHO de `INTERVALOS_DE_REPETICAO`: opção
//    nova na tela sem a migration seria recusada pelo banco com 500.
// 2. O índice "uma ativa por série" e a consulta da geração falam da MESMA
//    ativa: mudar um predicado sem o outro deixa o índice de pé e sem guardar
//    nada (duas tarefas por dia na série).
// 3. Só o service role gera (o navegador não escreve em `cb_tasks` — 944).
// 4. Quem chama a geração é o ciclo das agendadas, em `after()`: tirar a
//    chamada de lá para de gerar as tarefas sem erro nenhum.
// ============================================================

const SQL = fs.readFileSync(path.join(__dirname, '1074_cb_tarefas_recorrentes.sql'), 'utf8');
const CODIGO = SQL.replace(/--.*$/gm, '');
const RAIZ = path.join(__dirname, '..', '..');
const ler = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const ATIVA = /repetir_a_cada_dias IS NOT NULL\s+AND\s+(?:t\.)?proxima_gerada_em IS NULL/;

describe('1074 — tarefa recorrente', () => {
  it('o CHECK dos intervalos é o espelho de INTERVALOS_DE_REPETICAO', () => {
    const corpo = CODIGO.match(/cb_tasks_repetir_ck\s+CHECK \(([^;]*)\);/)?.[1] ?? '';
    const lista = corpo.match(/IN \(([^)]*)\)/)?.[1] ?? '';
    expect(lista.split(',').map((n) => Number(n.trim()))).toEqual([...INTERVALOS_DE_REPETICAO]);
  });

  it('o índice único e a geração recortam a MESMA ativa', () => {
    const indice = CODIGO.match(/CREATE UNIQUE INDEX IF NOT EXISTS cb_tasks_uma_ativa_por_serie[\s\S]*?;/)?.[0] ?? '';
    expect(indice).toMatch(ATIVA);
    const funcao = CODIGO.match(/FUNCTION public\.cb_tarefas_recorrentes_gerar[\s\S]*?\$\$;/)?.[0] ?? '';
    expect(funcao).toMatch(/t\.repetir_a_cada_dias IS NOT NULL\s+AND t\.proxima_gerada_em IS NULL/);
    // Carimbar a ativa ANTES de inserir a próxima (na ordem inversa o índice
    // veria duas ativas) e travar sem esperar (dois ciclos não se pisam).
    expect(funcao.indexOf('SET proxima_gerada_em = now()')).toBeLessThan(funcao.indexOf('INSERT INTO public.cb_tasks'));
    expect(funcao).toContain('FOR UPDATE OF t SKIP LOCKED');
  });

  it('só o service role executa a geração', () => {
    expect(CODIGO).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.cb_tarefas_recorrentes_gerar\(date, integer\)\s+FROM PUBLIC, anon, authenticated;/,
    );
    expect(CODIGO).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.cb_tarefas_recorrentes_gerar\(date, integer\)\s+TO service_role;/,
    );
  });

  it('o app chama a função pelo nome certo', () => {
    expect(ler('src/lib/tasks/gerar-recorrentes.ts')).toContain(
      "admin.rpc('cb_tarefas_recorrentes_gerar'",
    );
  });

  it('o ciclo das agendadas carrega a geração, em after() com callback', () => {
    const rota = ler('src/app/api/cb/scheduled/cron/route.ts');
    expect(rota).toContain('after(() => gerarTarefasRecorrentes(admin))');
  });
});
