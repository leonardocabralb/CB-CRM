import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1078 — as trajetórias do funil paginadas por CHAVE. O que este pino segura:
//
// 1. A 1078 é a MESMA leitura da 975 (só a paginação muda): o recorte de quem
//    passou pelo funil, o do período e as colunas calculadas têm o mesmo
//    texto. As duas funções convivem (a 975 serve a versão do app no ar
//    durante o deploy); mudar uma sem a outra faria Lista, Desempenho e Saúde
//    contarem diferente conforme a versão, sem erro nenhum.
// 2. O recorte de CHAVE e o LIMIT vêm ANTES das subconsultas caras: é todo o
//    ganho da 1078. Pôr o LIMIT no SELECT final devolveria o recálculo do
//    funil inteiro a cada página.
// 3. Quem chama é `src/lib/funil/carregar.ts`, com o nome e os parâmetros da
//    1078 — e a 975 não é mais chamada pelo app.
// ============================================================

const ler = (nome: string) => fs.readFileSync(path.join(__dirname, nome), 'utf8');
const semComentario = (sql: string) => sql.replace(/--.*$/gm, '');
const plano = (sql: string) => semComentario(sql).replace(/\s+/g, ' ').trim();

const V975 = plano(ler('0975_cb_degrau_do_funil.sql'));
const V1078 = plano(ler('1078_cb_trajetorias_por_chave.sql'));
const RAIZ = path.join(__dirname, '..', '..');
const CARREGAR = fs.readFileSync(path.join(RAIZ, 'src/lib/funil/carregar.ts'), 'utf8');

function trecho(sql: string, de: string, ate: string): string {
  const inicio = sql.indexOf(de);
  const fim = sql.indexOf(ate, inicio + de.length);
  if (inicio < 0 || fim < 0) return '';
  return sql.slice(inicio, fim + ate.length);
}

describe('1078 — trajetórias por chave', () => {
  it('quem passou pelo funil (`tocados`) é o mesmo texto da 975', () => {
    const a = trecho(V975, 'WITH tocados AS (', "'pipeline_changed') )");
    expect(a).not.toBe('');
    expect(trecho(V1078, 'WITH tocados AS (', "'pipeline_changed') )")).toBe(a);
  });

  it('o recorte do período é o mesmo texto da 975', () => {
    const de = 'p_desde IS NULL OR (d.created_at';
    const ate = "e.occurred_at < COALESCE(p_ate, 'infinity'::timestamptz) )";
    const a = trecho(V975, de, ate);
    expect(a).not.toBe('');
    expect(trecho(V1078, de, ate)).toBe(a);
  });

  it('as colunas calculadas são o mesmo texto da 975', () => {
    const de = 'SELECT a.id, a.contact_id, a.conversation_id,';
    const ate = "e.event_type IN ('deal_created', 'stage_changed', 'pipeline_changed'))";
    const a = trecho(V975, de, ate);
    expect(a).not.toBe('');
    expect(trecho(V1078, de, ate)).toBe(a);
  });

  it('⚠️ a chave e o LIMIT entram ANTES do cálculo caro', () => {
    const alvo = trecho(V1078, 'alvo AS (', 'pagina AS (');
    expect(alvo).toContain('(p_chave_apos IS NULL OR d.id > p_chave_apos)');
    expect(alvo).toContain('(p_chave_ate IS NULL OR d.id <= p_chave_ate)');
    const pagina = trecho(V1078, 'pagina AS (', 'LIMIT p_limite )');
    expect(pagina).toContain('count(*) OVER () AS restantes');
    expect(pagina).toContain('ORDER BY a.id LIMIT p_limite');
    // O SELECT final lê da página, não do alvo.
    expect(V1078).toContain('FROM pagina a LEFT JOIN contacts c ON c.id = a.contact_id ORDER BY a.id;');
  });

  it('fecha o EXECUTE para anon e devolve para authenticated e service_role', () => {
    const assinatura =
      'public.cb_funil_trajetorias_por_chave(uuid, timestamptz, timestamptz, uuid, uuid, integer)';
    expect(V1078).toContain(`REVOKE EXECUTE ON FUNCTION ${assinatura} FROM PUBLIC, anon;`);
    expect(V1078).toContain(`GRANT EXECUTE ON FUNCTION ${assinatura} TO authenticated, service_role;`);
  });

  it('o app chama a 1078, com os parâmetros dela, e não mais a 975', () => {
    expect(CARREGAR).toContain('"cb_funil_trajetorias_por_chave"');
    for (const parametro of ['p_pipeline_id', 'p_desde', 'p_ate', 'p_chave_apos', 'p_chave_ate', 'p_limite']) {
      expect(CARREGAR).toContain(parametro);
      expect(V1078).toContain(parametro);
    }
    expect(CARREGAR).not.toMatch(/["']cb_funil_trajetorias["']/);
  });
});
