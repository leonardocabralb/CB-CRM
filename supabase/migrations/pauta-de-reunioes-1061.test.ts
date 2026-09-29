import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1061 — a pauta de reuniões. O que este pino segura:
//
// 1. A marca 'qualificada' entra no CHECK SEM tirar as da 1058: o aviso de
//    possível no-show lê 'compareceu' e 'faltou', e um CHECK reescrito sem
//    elas faria o Gerenciar funil recusar as marcas que já estão gravadas.
// 2. `cb_reunioes_marcos` nasce sem nada para `anon`, lida pela forma da 1032
//    e escrita só por quem move card; sem DELETE.
// 3. Quem marcou é carimbado pelo BANCO (gatilho SECURITY DEFINER com
//    search_path fixo e EXECUTE fechado nas duas metades), nunca aceito do
//    navegador.
// 4. O alvo do upsert da tela é um UNIQUE TOTAL: índice parcial não serve de
//    alvo de ON CONFLICT no PostgREST (a lição da 903).
// ============================================================

const SQL = fs.readFileSync(path.join(__dirname, '1061_cb_pauta_de_reunioes.sql'), 'utf8');
// Sem os comentários: um comentário que descreva a forma proibida não pode
// fazer o pino passar.
const CODIGO = SQL.replace(/--.*$/gm, '');

describe('1061 — pauta de reuniões', () => {
  it('o CHECK da etapa aceita as três marcas', () => {
    expect(CODIGO).toMatch(
      /CHECK \(desfecho_da_reuniao IS NULL OR desfecho_da_reuniao IN \('qualificada', 'compareceu', 'faltou'\)\)/,
    );
  });

  it('a tabela é lida pela forma da 1032 e escrita por agent', () => {
    expect(CODIGO).toMatch(
      /CREATE POLICY cb_reunioes_marcos_select ON public\.cb_reunioes_marcos FOR SELECT\s+USING \(account_id = ANY \(ARRAY\(SELECT public\.cb_contas_do_usuario\(\)\)\)\);/,
    );
    expect(CODIGO).toMatch(/cb_reunioes_marcos_insert[\s\S]*?is_account_member\(account_id, 'agent'::account_role_enum\)/);
    expect(CODIGO).toMatch(/cb_reunioes_marcos_update[\s\S]*?is_account_member\(account_id, 'agent'::account_role_enum\)/);
    expect(CODIGO).not.toMatch(/FOR DELETE/);
  });

  it('privilégios escritos, sem anon e sem DELETE', () => {
    expect(CODIGO).toContain('REVOKE ALL ON TABLE public.cb_reunioes_marcos FROM PUBLIC, anon, authenticated;');
    expect(CODIGO).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.cb_reunioes_marcos TO authenticated;');
    expect(CODIGO).not.toMatch(/GRANT[^;]*DELETE[^;]*authenticated/);
  });

  it('o carimbo é do banco: SECURITY DEFINER, search_path fixo, EXECUTE fechado nas duas metades', () => {
    expect(CODIGO).toMatch(/cb_reunioes_marcos_carimbo\(\)\s+RETURNS trigger\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/);
    expect(CODIGO).toMatch(/NEW\.registrado_por := v_uid;/);
    expect(CODIGO).toMatch(/NEW\.registrado_em := now\(\);/);
    expect(CODIGO).toContain(
      'REVOKE EXECUTE ON FUNCTION public.cb_reunioes_marcos_carimbo() FROM PUBLIC, anon, authenticated;',
    );
    expect(CODIGO).toMatch(/BEFORE INSERT OR UPDATE ON public\.cb_reunioes_marcos/);
  });

  it('o alvo do upsert é UNIQUE total por (conta, origem, reunião, marco)', () => {
    expect(CODIGO).toMatch(/CONSTRAINT cb_reunioes_marcos_um_por_marco UNIQUE \(account_id, origem, reuniao_id, marco\)/);
  });

  it('a conferência chama o gatilho e se desfaz com o SQLSTATE próprio', () => {
    expect(CODIGO).toMatch(/INSERT INTO public\.cb_reunioes_marcos \(account_id, origem, reuniao_id, marco, registrado_por_nome, registrado_em\)/);
    expect(CODIGO).toMatch(/ERRCODE = 'P1061'/);
    expect(CODIGO).toMatch(/WHEN SQLSTATE 'P1061' THEN NULL;/);
  });
});
