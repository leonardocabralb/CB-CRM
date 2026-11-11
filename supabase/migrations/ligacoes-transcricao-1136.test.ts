import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { ARQUIVOS_DA_GRAVACAO, ehCaminhoDaGravacao } from '../../src/lib/whatsapp/ligacoes/pelo-crm';

// ============================================================
// Pinos da 1136 (a transcrição das ligações pelo CRM, 4d). O replay do CI
// prova que ela APLICA, e a conferência dela CHAMA a marca, a limpeza, a
// reivindicação e a exclusão definitiva com dado fictício (desfeito). Estes
// provam o que ela não pode perder numa edição ou num merge: as duas funções
// recriadas são as VIGENTES mais só o acréscimo, e a guarda das gravações
// responde no SQL como no espelho TS.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const DIR = __dirname;
const ARQUIVO = '1136_cb_ligacoes_transcricao.sql';
const sql = fs.readFileSync(path.join(DIR, ARQUIVO), 'utf8');
const semComentarios = (t: string) =>
  t
    .split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');
const compactar = (t: string) => semComentarios(t).replace(/\s+/g, ' ').trim().toLowerCase();
const compacto = compactar(sql);

/** O corpo da função (do `create or replace` ao `$$;`), compactado. */
function corpo(texto: string, nome: string): string {
  const c = compactar(texto);
  const i = c.indexOf(`create or replace function public.${nome}(`);
  expect(i, nome).toBeGreaterThan(-1);
  return c.slice(i, c.indexOf('$$;', c.indexOf('as $$', i)));
}

/** A ÚLTIMA definição da função ANTES da 1136 (a vigente que ela recria). */
function vigenteAntes(nome: string): string {
  let vigente: string | null = null;
  for (const f of fs.readdirSync(DIR).filter((n) => /^\d{4}_.*\.sql$/.test(n) && n < ARQUIVO).sort()) {
    const texto = fs.readFileSync(path.join(DIR, f), 'utf8');
    if (compactar(texto).includes(`create or replace function public.${nome}(`)) vigente = corpo(texto, nome);
  }
  expect(vigente, nome).not.toBeNull();
  return vigente as string;
}

describe('1136 — colunas, marca e portas', () => {
  it('cb_ligacoes ganha o diálogo, o estado, o resumo e a marca da poda', () => {
    for (const coluna of [
      'transcricao jsonb',
      'transcricao_status text',
      'transcricao_erro text',
      'transcricao_desde timestamptz',
      'transcricao_em timestamptz',
      'transcricao_tentativas integer not null default 0',
      'resumo text',
      'gravacao_expirada_em timestamptz',
    ]) {
      expect(compacto).toContain(`alter table cb_ligacoes add column if not exists ${coluna};`);
    }
    expect(compacto).toContain(
      "check (transcricao_status is null or transcricao_status in ('transcrevendo', 'pronta', 'falhou', 'recusada'))",
    );
  });

  it('a faixa reflete a ligação lida SOB TRAVA, funde (||) só na faixa de ligação, e só o servidor a chama', () => {
    const sync = corpo(sql, 'cb_ligacao_sincronizar_faixa');
    expect(sync).toContain('security definer');
    expect(sync).toContain('from cb_ligacoes g where g.id = p_ligacao for update;');
    expect(sync).toContain('set ligacao = ligacao || jsonb_build_object(');
    for (const campo of ["'gravacao'", "'transcricao'", "'resumo'", "'expirada'"]) expect(sync).toContain(campo);
    expect(sync).toContain("content_type = 'call'");
    expect(compacto).toContain(
      'revoke all on function public.cb_ligacao_sincronizar_faixa(uuid) from public, anon, authenticated;',
    );
    expect(compacto).toContain('grant execute on function public.cb_ligacao_sincronizar_faixa(uuid) to service_role;');
    expect(compacto).not.toContain('cb_ligacao_marcar_faixa');
  });

  it('a fila aceita o bucket das gravações; a reivindicação mantém as portas', () => {
    expect(compacto).toContain("check (bucket in ('chat-media', 'ligacoes'))");
    expect(compacto).toContain(
      'revoke execute on function public.cb_reivindicar_arquivos_a_apagar(integer) from public, anon, authenticated;',
    );
    expect(compacto).toContain('grant execute on function public.cb_reivindicar_arquivos_a_apagar(integer) to service_role;');
    expect(compacto).toContain(
      'revoke execute on function public.cb_ligacoes_sem_gravacao(uuid, uuid[]) from public, anon, authenticated;',
    );
  });

  it('a conferência que chama é desfeita pelo SQLSTATE próprio, nunca por WHEN OTHERS', () => {
    expect(compacto).toContain("raise exception using errcode = 'p1136'");
    expect(compacto).toContain("exception when sqlstate 'p1136'");
    expect(compacto).not.toContain('when others');
  });
});

describe('1136 — as funções recriadas são as vigentes mais só o acréscimo', () => {
  it('cb_lixeira_purgar_um = o corpo da 1110 + a limpeza das ligações (fora e dentro do pedido)', () => {
    const nova = corpo(sql, 'cb_lixeira_purgar_um');
    const foraDoPedido =
      "v_ids := array(select distinct (l -> 'pk' ->> 'id')::uuid from jsonb_array_elements(v.ponteiros) p, " +
      "jsonb_array_elements(p -> 'linhas') l where p ->> 'tabela' = 'cb_ligacoes'); " +
      'perform cb_ligacoes_sem_gravacao(v.account_id, v_ids); ';
    const dentroDoPedido =
      'perform cb_ligacoes_sem_gravacao(v.account_id, array( select g.id from cb_ligacoes g ' +
      'where g.account_id = v.account_id and g.telefone = any (v_telefones))); ';
    expect(nova).toContain(foraDoPedido);
    expect(nova).toContain(dentroDoPedido);
    // A limpeza das ligações vem DEPOIS da dos turnos e ANTES do `if p_pedido`.
    expect(nova.indexOf(foraDoPedido)).toBeGreaterThan(nova.indexOf("cb_ia_turno_sem_conteudo(v_ids, 'exclusao')"));
    expect(nova.indexOf(foraDoPedido)).toBeLessThan(nova.indexOf('if p_pedido then'));
    expect(nova.replace(foraDoPedido, '').replace(dentroDoPedido, '')).toBe(vigenteAntes('cb_lixeira_purgar_um'));
  });

  it('cb_reivindicar_arquivos_a_apagar = o corpo da 1097 com a guarda POR BUCKET', () => {
    const nova = corpo(sql, 'cb_reivindicar_arquivos_a_apagar');
    const antiga = vigenteAntes('cb_reivindicar_arquivos_a_apagar');
    // O que muda: a guarda vira um CASE por bucket, e as citações valem só no chat-media.
    const guardaAntiga = 'and cb_caminho_no_chat_media(f.caminho, f.account_id) is distinct from f.caminho;';
    expect(antiga).toContain(guardaAntiga);
    expect(nova).toContain(
      "and case f.bucket when 'chat-media' then cb_caminho_no_chat_media(f.caminho, f.account_id) is distinct from f.caminho " +
        "when 'ligacoes' then f.caminho !~ ('^account-' || f.account_id::text || '/ligacoes/",
    );
    expect(nova).toContain('else true end;');
    expect(nova).toContain("where f.id = any (v_ids) and f.bucket = 'chat-media' loop");
    expect(nova).toContain("where g.id = any (v_ids) and g.account_id = v_conta and g.bucket = 'chat-media')));");
    // O resto é o mesmo: a trava, o recolhimento dos 10 min, o teto e o retorno.
    for (const trecho of [
      'security definer',
      "f.reivindicado_em < now() - interval '10 minutes'",
      'limit greatest(1, least(coalesce(p_limite, 25), 100)) for update skip locked',
      'set reivindicado_em = v_carimbo, tentativas = f.tentativas + 1',
      'select f.id, f.account_id, f.bucket, f.caminho, f.reivindicado_em from cb_arquivos_a_apagar f',
    ]) {
      expect(antiga).toContain(trecho);
      expect(nova).toContain(trecho);
    }
  });
});

describe('1136 — a guarda das gravações: o SQL e o espelho TS respondem igual', () => {
  const claim = semComentarios(sql);
  const m = /'\^account-' \|\| f\.account_id::text\s*\|\| '(\/ligacoes\/[^']+)'\)/.exec(claim);

  it('a forma do caminho no SQL é a lida pelo pino', () => {
    expect(m, 'o regex das gravações na reivindicação').not.toBeNull();
  });

  const CONTA = '00000000-0000-4000-8000-0000000000aa';
  const OUTRA = '00000000-0000-4000-8000-0000000000bb';
  const LIGACAO = 'abcdef12-2222-4333-8444-555555555555';
  const sqlAceita = (caminho: string, conta: string) => new RegExp(`^account-${conta}${(m as RegExpExecArray)[1]}`).test(caminho);

  const exemplos: [string, string, boolean][] = [
    [`account-${CONTA}/ligacoes/${LIGACAO}/estereo.ogg`, CONTA, true],
    [`account-${CONTA}/ligacoes/${LIGACAO}/cliente.ogg`, CONTA, true],
    [`account-${CONTA}/ligacoes/${LIGACAO}/atendente.ogg`, CONTA, true],
    [`account-${CONTA}/ligacoes/${LIGACAO}/estereo.ogg`, OUTRA, false],
    [`account-${CONTA}/ligacoes/${LIGACAO}/foto.jpg`, CONTA, false],
    [`account-${CONTA}/ligacoes/${LIGACAO.toUpperCase()}/estereo.ogg`, CONTA, false],
    [`account-${CONTA}/ligacoes/../${LIGACAO}/estereo.ogg`, CONTA, false],
    [`account-${CONTA}/ligacoes/${LIGACAO}/sub/estereo.ogg`, CONTA, false],
    [`account-${CONTA}/ligacoes/${LIGACAO}/estereo.ogg/`, CONTA, false],
    [`account-${CONTA}/acervo/estereo.ogg`, CONTA, false],
    [`account-${CONTA}/ligacoes/nao-e-uuid/estereo.ogg`, CONTA, false],
  ];

  for (const [caminho, conta, esperado] of exemplos) {
    it(`${esperado ? 'aceita' : 'recusa'} ${caminho.replace(CONTA, '<conta>').replace(OUTRA, '<outra>')} (${conta === CONTA ? 'a conta' : 'outra conta'})`, () => {
      expect(sqlAceita(caminho, conta)).toBe(esperado);
      expect(ehCaminhoDaGravacao(caminho, conta)).toBe(esperado);
    });
  }

  it('os três arquivos são os mesmos no SQL e no TS', () => {
    expect([...ARQUIVOS_DA_GRAVACAO].sort()).toEqual(['atendente.ogg', 'cliente.ogg', 'estereo.ogg']);
    expect(compacto).toContain("unnest(array['estereo.ogg', 'cliente.ogg', 'atendente.ogg'])");
    expect((m as RegExpExecArray)[1]).toContain('(estereo|cliente|atendente)\\.ogg$');
  });
});
