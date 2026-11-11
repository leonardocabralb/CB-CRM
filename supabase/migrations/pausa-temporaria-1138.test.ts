import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  ERRO_DA_ARMACAO_PELA_EQUIPE,
  ERRO_DA_EQUIPE_RESPONDEU,
  MOTIVOS_DA_PAUSA,
  MOTIVOS_TEMPORARIOS,
  VOLTA_APOS_MIN_PADRAO,
  VOLTA_APOS_MIN_TETO,
} from '@/lib/ia-agentes/pausa';

// ============================================================
// 1138 — a pausa TEMPORÁRIA da IA (revisa a D26; decisões do operador de
// 11/11/2026). A lista dos motivos, as marcas e o padrão vivem nos DOIS
// lados — o SQL (o CHECK, o gatilho da pausa por gente e
// `cb_ia_voltar_da_pausa`) e o TS (`src/lib/ia-agentes/pausa.ts`). Estes pinos
// seguram que não divergem; a prova num Postgres com dado é a conferência da
// própria migration (P1138) e a descrição do PR.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1138_cb_ia_pausa_temporaria.sql'), 'utf8');
const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');
const compacto = semComentarios.replace(/\s+/g, ' ').toLowerCase();

function corpo(nome: string): string {
  const re = new RegExp(`create or replace function (public\\.)?${nome}\\(`);
  const m = re.exec(compacto);
  expect(m, nome).not.toBeNull();
  const i = m!.index;
  return compacto.slice(i, compacto.indexOf('$$;', compacto.indexOf('as $$', i)));
}

const lista = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(', ');

describe('1138 — a pausa temporária', () => {
  it('o CHECK do motivo tem EXATAMENTE os motivos do TS', () => {
    expect(compacto).toContain(`ia_pausada_por in (${lista(MOTIVOS_DA_PAUSA)})`);
  });

  it('a coluna da conta: NOT NULL DEFAULT o padrão do TS, CHECK de 0 ao teto do TS', () => {
    expect(compacto).toContain(`add column if not exists ia_volta_apos_min smallint not null default ${VOLTA_APOS_MIN_PADRAO}`);
    expect(compacto).toContain(`check (ia_volta_apos_min between 0 and ${VOLTA_APOS_MIN_TETO})`);
  });

  it('a volta: só os motivos TEMPORÁRIOS do TS; na retomada, só `gente`', () => {
    const f = corpo('cb_ia_voltar_da_pausa');
    expect(f).toContain(`c.ia_pausada_por not in (${lista(MOTIVOS_TEMPORARIOS)})`);
    expect(f).toContain(`if c.ia_pausada_por <> 'gente' then`);
  });

  it('a volta: a fala de gente depois do gatilho segura (a régua da 1049/1118)', () => {
    const f = corpo('cb_ia_voltar_da_pausa');
    expect(f).toContain("m.sender_type = 'agent' and (m.sender_id is not null or m.from_device) and m.ia_agente_id is null and not m.nao_saiu");
  });

  it('a volta: a âncora é a mais nova entre a espera e a pausa (a mesma conta de `voltaDaPausaEm`)', () => {
    expect(corpo('cb_ia_voltar_da_pausa')).toContain(
      'greatest(coalesce(c.aguardando_desde, v_gatilho), coalesce(c.ia_pausada_em, v_gatilho)) + make_interval(mins => p_minutos)',
    );
  });

  it('a volta levanta SÓ a pausa (nunca o teto nem o responsável)', () => {
    const f = corpo('cb_ia_voltar_da_pausa');
    expect(f).toContain('set ai_autoreply_disabled = false, ia_pausada_por = null, ia_pausada_em = null where');
    expect(f).not.toContain('ia_retomada_em');
    expect(f).not.toContain('assigned_agent_id');
  });

  it('o gatilho: a temporária respondida vira `gente`; o retorno sai com a marca do TS', () => {
    const f = corpo('cb_pausar_ia_por_gente');
    expect(f).toContain(`set ia_pausada_por = 'gente', ia_pausada_em = now() where cv.id = new.conversation_id and cv.ai_autoreply_disabled and cv.ia_pausada_por in (${lista(MOTIVOS_TEMPORARIOS)})`);
    expect(f).toContain(`erro = '${ERRO_DA_EQUIPE_RESPONDEU}'`);
    expect(f).toContain("and status = 'aguardando' and tipo = 'resposta'");
  });

  it('o gatilho: a pré-armação leva a marca do TS, sem agente, e só com a pausa `gente`', () => {
    const f = corpo('cb_pausar_ia_por_gente');
    expect(f).toContain(`'retomada', 1, 1, '${ERRO_DA_ARMACAO_PELA_EQUIPE}'`);
    expect(f).toContain("cv.ia_pausada_por = 'gente'");
    expect(f).toContain("new.content_type is distinct from 'call'");
    expect(f).toContain('ia_agente_id = null');
  });

  it('o gatilho continua SECURITY DEFINER e pulando o eco do próprio turno', () => {
    const f = corpo('cb_pausar_ia_por_gente');
    expect(f).toContain('security definer');
    expect(f).toContain('t.mensagem_enviada_id = new.message_id');
  });

  it('a função nova fecha ao navegador e abre ao service_role', () => {
    expect(compacto).toContain(
      'revoke execute on function public.cb_ia_voltar_da_pausa(uuid, timestamptz, integer) from public, anon, authenticated',
    );
    expect(compacto).toContain('grant execute on function public.cb_ia_voltar_da_pausa(uuid, timestamptz, integer) to service_role');
  });
});
