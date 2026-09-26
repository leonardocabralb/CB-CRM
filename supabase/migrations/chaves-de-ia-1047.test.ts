import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1047 — a chave de IA é do PROVEDOR, uma por conta (`cb_ia_chaves`), e a
// tabela é FECHADA ao navegador: a chave cifrada não passa pelo PostgREST
// com a sessão de ninguém. A conferência DENTRO da migration testa GRANT
// (não RLS); este teste roda no job `verificar`, que é portão.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1047_cb_ia_chaves_por_provedor.sql'), 'utf8');
const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');

describe('1047 — chaves de IA por provedor', () => {
  it('RLS ligada, NENHUMA policy e nada para anon/authenticated', () => {
    expect(/ALTER\s+TABLE\s+cb_ia_chaves\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(semComentarios)).toBe(true);
    expect(
      /REVOKE\s+ALL\s+ON\s+TABLE\s+cb_ia_chaves\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(semComentarios),
    ).toBe(true);
    expect(/CREATE\s+POLICY[^;]*\bON\s+cb_ia_chaves\b/i.test(semComentarios)).toBe(false);
    expect(/GRANT[^;]*\bON\s+TABLE\s+cb_ia_chaves\b[^;]*\b(anon|authenticated)\b/i.test(semComentarios)).toBe(false);
    expect(/GRANT\s+ALL\s+ON\s+TABLE\s+cb_ia_chaves\s+TO\s+service_role/i.test(semComentarios)).toBe(true);
  });

  it('UMA chave por (conta, provedor), num UNIQUE TOTAL — é o alvo do upsert da rota', () => {
    expect(/UNIQUE\s*\(\s*account_id\s*,\s*provedor\s*\)/i.test(semComentarios)).toBe(true);
    expect(/CHECK\s*\(\s*provedor\s+IN\s*\(\s*'openai'\s*,\s*'anthropic'\s*,\s*'gemini'\s*\)\s*\)/i.test(semComentarios)).toBe(true);
  });

  it('autoria com SET NULL: apagar o login de quem cadastrou não leva a chave do Radar', () => {
    expect(/atualizada_por\s+uuid\s+REFERENCES\s+auth\.users\s*\(\s*id\s*\)\s+ON\s+DELETE\s+SET\s+NULL/i.test(semComentarios)).toBe(true);
  });

  it('copia as chaves de hoje sem sobrescrever (reexecução) e a de embeddings só no slot vazio da OpenAI', () => {
    // A CÓPIA (fora do gatilho da janela, que sobrescreve de propósito).
    const semOGatilho = semComentarios.replace(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.cb_ia_chaves_segue_o_legado[\s\S]*?\$\$;/i,
      '',
    );
    const insercoes = semOGatilho.match(/INSERT\s+INTO\s+cb_ia_chaves[\s\S]*?;/gi) ?? [];
    expect(insercoes).toHaveLength(2);
    for (const i of insercoes) {
      expect(/ON\s+CONFLICT\s*\(\s*account_id\s*,\s*provedor\s*\)\s+DO\s+NOTHING/i.test(i)).toBe(true);
    }
    expect(/embeddings_api_key/i.test(insercoes[1])).toBe(true);
    expect(/'openai'/.test(insercoes[1])).toBe(true);
    // A chave só da base vai para os DOIS campos com o mesmo texto cifrado: é
    // a marca de origem que a troca respeita (Codex, #294).
    expect(/c\.embeddings_api_key,\s*c\.embeddings_api_key/i.test(insercoes[1])).toBe(true);
  });

  it('mais de uma chave do mesmo provedor EM USO vira AVISO, nunca parada (o banco não decifra — Codex, #294)', () => {
    const aviso = semComentarios.match(/DO\s+\$\$[\s\S]*?HAVING\s+count\(DISTINCT\s+c\.api_key\)\s*>\s*1[\s\S]*?END\s+\$\$;/i)?.[0] ?? ''
    expect(aviso).toMatch(/c\.channel_id\s+IS\s+NULL\s+OR\s+\(c\.is_active\s+AND\s+c\.auto_reply_enabled\s+IS\s+TRUE\s+AND\s+ch\.ai_autoreply_enabled\s+IS\s+NOT\s+FALSE\)/i)
    expect(aviso).toMatch(/RAISE\s+WARNING/i)
    expect(aviso).not.toMatch(/RAISE\s+EXCEPTION/i)
  })

  it('entre as linhas de conexão, a LIGADA vence a desligada na cópia (Codex, #294)', () => {
    expect(semComentarios).toMatch(/ORDER\s+BY\s+c\.account_id,\s*c\.provider,\s*\(c\.channel_id\s+IS\s+NULL\)\s+DESC,\s*\(c\.is_active\s+AND\s+c\.auto_reply_enabled\s+IS\s+TRUE\s+AND\s+ch\.ai_autoreply_enabled\s+IS\s+NOT\s+FALSE\)\s+DESC,\s*c\.is_active\s+DESC,\s*c\.created_at/i)
  })

  it('serve_embeddings: só a OpenAI tem, e NULO é "não conferida" (a cópia não afirma nada)', () => {
    expect(/serve_embeddings\s+boolean\s+CHECK\s*\(\s*provedor\s*=\s*'openai'\s+OR\s+serve_embeddings\s+IS\s+NULL\s*\)/i.test(semComentarios)).toBe(true);
    // A cópia não inventa conferência: nenhum INSERT grava um veredito (o
    // gatilho da janela ZERA para "não conferida" quando a chave muda).
    for (const i of semComentarios.match(/INSERT\s+INTO\s+cb_ia_chaves[\s\S]*?;/gi) ?? []) {
      expect(/serve_embeddings\s*=\s*(true|false)/i.test(i)).toBe(false);
      expect(/\(\s*[^)]*\bserve_embeddings\b[^)]*\)\s*VALUES/i.test(i)).toBe(false);
    }
  });

  it('a chave DEDICADA de embeddings não se perde: fica em embeddings_api_key da linha da OpenAI (Codex, #295)', () => {
    expect(/embeddings_api_key\s+text\s+CHECK/i.test(semComentarios)).toBe(true);
    const atualizacao = semComentarios.match(/UPDATE\s+cb_ia_chaves\s+k[\s\S]*?;/i)?.[0] ?? '';
    expect(/SET\s+embeddings_api_key\s*=\s*c\.embeddings_api_key/i.test(atualizacao)).toBe(true);
    // Só preenche o vazio (reexecução não sobrescreve).
    expect(/k\.embeddings_api_key\s+IS\s+NULL/i.test(atualizacao)).toBe(true);
    expect(/k\.provedor\s*=\s*'openai'/i.test(atualizacao)).toBe(true);
  });

  it('ai_configs.api_key perde o NOT NULL (a linha padrão existe sem chave)', () => {
    expect(/ALTER\s+TABLE\s+ai_configs\s+ALTER\s+COLUMN\s+api_key\s+DROP\s+NOT\s+NULL/i.test(semComentarios)).toBe(true);
  });

  it('o gatilho da JANELA leva a chave do app anterior para cb_ia_chaves — só a escrita do navegador (Codex, #294)', () => {
    const fn = semComentarios.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.cb_ia_chaves_segue_o_legado[\s\S]*?\$\$;/i)?.[0] ?? '';
    expect(fn).toMatch(/SECURITY\s+DEFINER/i);
    expect(fn).toMatch(/SET\s+search_path/i);
    // O espelho do app novo é gravado pelo serviço: copiá-lo de volta recriaria
    // a falsa chave própria dos embeddings.
    expect(fn).toMatch(/request\.jwt\.claims[\s\S]*'role'[\s\S]*'authenticated'/i);
    expect(fn).toMatch(/NEW\.channel_id\s+IS\s+NOT\s+NULL/i);
    expect(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cb_ia_chaves_segue_o_legado\(\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(semComentarios)).toBe(true);
    expect(/CREATE\s+TRIGGER\s+cb_ia_chaves_segue_o_legado\s+AFTER\s+INSERT\s+OR\s+UPDATE\s+OF\s+api_key,\s*embeddings_api_key,\s*provider\s+OR\s+DELETE\s+ON\s+ai_configs/i.test(semComentarios)).toBe(true);
    // A troca de PROVEDOR pelo app anterior retira a cópia do provedor antigo
    // (menos o que ainda a usa: conexão ligada, ou a própria da base) (Codex, #295).
    expect(fn).toMatch(/OLD\.provider\s+IS\s+DISTINCT\s+FROM\s+NEW\.provider[\s\S]*SET\s+api_key\s*=\s*embeddings_api_key[\s\S]*DELETE\s+FROM\s+cb_ia_chaves\s+WHERE\s+account_id\s*=\s*OLD\.account_id\s+AND\s+provedor\s*=\s*OLD\.provider/i);
    // O "Remover" do app anterior apaga a cópia também (Codex, #295).
    expect(fn).toMatch(/TG_OP\s*=\s*'DELETE'[\s\S]*DELETE\s+FROM\s+cb_ia_chaves\s+WHERE\s+account_id\s*=\s*OLD\.account_id\s+AND\s+provedor\s*=\s*OLD\.provider/i);
    // ...menos quando um agente de CONEXÃO ligado do mesmo provedor continua:
    // a chave passa a ser a dele (Codex, #294).
    expect(fn).toMatch(/c\.channel_id\s+IS\s+NOT\s+NULL\s+AND\s+c\.is_active[\s\S]*UPDATE\s+cb_ia_chaves\s+SET\s+api_key\s*=\s*v_da_conexao/i)
    // ...preferindo a conexão que RESPONDE (resposta automática ligada na
    // linha e na conexão), a mesma régua da cópia (Codex, #294).
    expect(fn.match(/ORDER\s+BY\s+\(c\.auto_reply_enabled\s+IS\s+TRUE\s+AND\s+ch\.ai_autoreply_enabled\s+IS\s+NOT\s+FALSE\)\s+DESC,\s*c\.created_at/gi) ?? []).toHaveLength(2)
    // ...e a linha da OpenAI que era SÓ a chave da base sai inteira — no
    // Remover e quando a tela antiga apaga a chave própria (Codex, #295).
    const apagaASoDaBase = fn.match(/DELETE\s+FROM\s+cb_ia_chaves\s+WHERE\s+account_id\s*=\s*(OLD|NEW)\.account_id\s+AND\s+provedor\s*=\s*'openai'\s+AND\s+api_key\s*=\s*embeddings_api_key/gi) ?? [];
    expect(apagaASoDaBase.map((m) => /OLD\./i.test(m) ? 'OLD' : 'NEW').sort()).toEqual(['NEW', 'OLD']);
    // A troca da chave da base leva as duas colunas da linha que era só dela.
    expect(fn).toMatch(/api_key\s*=\s*CASE\s+WHEN\s+cb_ia_chaves\.api_key\s*=\s*cb_ia_chaves\.embeddings_api_key\s+THEN\s+EXCLUDED\.api_key/i);
  });
});
