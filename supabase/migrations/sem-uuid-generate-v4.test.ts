import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Nenhuma migration chama `uuid_generate_v4()` (porte do #669 do original).
//
// Num projeto Supabase HOSPEDADO a extensão `uuid-ossp` mora no esquema
// `extensions`, que nem sempre está no `search_path` da sessão do
// `supabase db push`: a instalação nova (o caminho da `docs/INSTALACAO.md`)
// parava na 0001 com 42883 "function uuid_generate_v4() does not exist" —
// relatado no original (issue #668). Na nossa produção os padrões aparecem
// como `extensions.uuid_generate_v4()`, a prova de onde a extensão fica.
//
// `gen_random_uuid()` é do próprio Postgres (13+, `pg_catalog`): não depende
// de extensão nem de `search_path`. Em 25/10/2026 os 34 padrões das 12
// migrations antigas (7 do original, 5 nossas) foram trocados no TEXTO dos
// arquivos. A produção não reaplica migration e continua com os padrões de
// antes — os dois geram UUID v4, sem diferença para quem lê.
//
// Por que um teste: o replay do CI roda num Postgres local onde a extensão
// fica no `public`, e lá `uuid_generate_v4()` funciona — a migration nova que
// a usar passa verde no CI e quebra só a próxima instalação.
// ============================================================

const DIR = __dirname;
const arquivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql'));

/** O SQL sem os comentários de linha (`-- …`), onde a função pode ser citada. */
function semComentarios(sql: string): string {
  return sql
    .split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');
}

describe('UUID nas migrations', () => {
  it('CRÍTICO: nenhuma migration chama uuid_generate_v4() — use gen_random_uuid()', () => {
    const comA = arquivos.filter((f) =>
      /uuid_generate_v4\s*\(/i.test(semComentarios(fs.readFileSync(path.join(DIR, f), 'utf8'))),
    );
    expect(comA).toEqual([]);
  });
});
