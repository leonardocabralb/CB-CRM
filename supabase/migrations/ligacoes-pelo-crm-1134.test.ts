import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { MOTIVOS_DO_FIM } from '../../src/lib/whatsapp/ligacoes/pelo-crm';

// ============================================================
// Pinos da 1134 (ligar e atender pelo CRM). O replay do CI prova que ela
// APLICA; a prova com dado (a reserva chamada, a faixa sem efeito, a trava de
// uma por número, a RLS) está em `cenarios-1134` e na descrição do PR. Estes
// provam o que ela não pode perder numa edição ou num merge.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const DIR = __dirname;
const ARQUIVO = '1134_cb_ligacoes_pelo_crm.sql';
const sql = fs.readFileSync(path.join(DIR, ARQUIVO), 'utf8');
const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');
const compacto = semComentarios.replace(/\s+/g, ' ').toLowerCase();
const modulo = (arquivo: string) =>
  fs.readFileSync(path.join(DIR, '../../src/lib/whatsapp/ligacoes', arquivo), 'utf8');

function corpo(texto: string, nome: string): string {
  const i = texto.indexOf(`create or replace function public.${nome}(`);
  expect(i, nome).toBeGreaterThan(-1);
  return texto.slice(i, texto.indexOf('$$;', texto.indexOf('as $$', i)));
}

/** A ÚLTIMA definição de `cb_ia_reservar_envio` antes desta (a vigente que ela recria). */
function reservaAnterior(): string {
  let vigente: string | null = null;
  for (const f of fs.readdirSync(DIR).filter((n) => /^\d{4}_.*\.sql$/.test(n) && n < ARQUIVO).sort()) {
    const texto = fs
      .readFileSync(path.join(DIR, f), 'utf8')
      .split('\n')
      .map((l) => l.replace(/--.*$/, ''))
      .join('\n')
      .replace(/\s+/g, ' ')
      .toLowerCase();
    if (texto.includes('create or replace function public.cb_ia_reservar_envio(')) {
      vigente = corpo(texto, 'cb_ia_reservar_envio');
    }
  }
  expect(vigente).not.toBeNull();
  return vigente!;
}

const CERCA = " and not (m.content_type = 'call' and not m.from_device)";

describe('1134 — as tabelas', () => {
  it('o computador é FECHADO ao navegador: RLS, sem policy, as duas metades do REVOKE', () => {
    expect(compacto).toContain('alter table cb_computadores_de_ligacao enable row level security;');
    expect(compacto).toContain('revoke all on table cb_computadores_de_ligacao from public, anon, authenticated;');
    expect(compacto).toContain('grant all on table cb_computadores_de_ligacao to service_role;');
    expect(compacto).not.toMatch(/create policy [a-z_]+ on cb_computadores_de_ligacao/);
  });

  it('a ligação ao vivo: o navegador só LÊ, pela policy na forma da 1032', () => {
    expect(compacto).toContain('revoke all on table cb_ligacoes_ao_vivo from public, anon, authenticated;');
    expect(compacto).toContain('grant select on table cb_ligacoes_ao_vivo to authenticated;');
    expect(compacto).toContain(
      'create policy cb_ligacoes_ao_vivo_leitura on cb_ligacoes_ao_vivo for select to authenticated using (account_id = any (array(select public.cb_contas_do_usuario())));',
    );
    expect(compacto).not.toMatch(/grant (insert|update|delete|all)[^;]*on table cb_ligacoes_ao_vivo to authenticated/);
  });

  it('uma ligação por número além das que tocam (a trava do ligar e do atender)', () => {
    expect(compacto).toContain(
      "create unique index if not exists cb_ligacoes_ao_vivo_uma_por_numero on cb_ligacoes_ao_vivo (channel_id) where estado <> 'tocando';",
    );
  });

  it('a ligação ao vivo SEM FK para conversa, contato ou conexão (passageira; a Lixeira recusaria o mover)', () => {
    const i = compacto.indexOf('create table if not exists cb_ligacoes_ao_vivo');
    const tabela = compacto.slice(i, compacto.indexOf(');', i));
    expect(tabela).not.toMatch(/references (public\.)?(conversations|contacts|cb_channels)/);
  });

  it('na publicação do tempo real (a tela da 4c toca por ela)', () => {
    expect(compacto).toContain('alter publication supabase_realtime add table public.cb_ligacoes_ao_vivo;');
  });

  it('o bucket das gravações é PRIVADO', () => {
    expect(compacto).toContain("values ('ligacoes', 'ligacoes', false, 10485760, array['audio/ogg'])");
    expect(compacto).toContain('public = excluded.public');
  });

  it('autoria SET NULL (1116): o login apagado não apaga a ligação', () => {
    expect(compacto).toContain('foreign key (atendente_id) references auth.users (id) on delete set null;');
  });
});

describe('1134 — os CHECKs batem com o código', () => {
  it('todo desfecho que o código grava está no CHECK (o novo `nao_atendida` inclusive)', () => {
    const i = compacto.indexOf('add constraint cb_ligacoes_desfecho_ck');
    const check = compacto.slice(i, compacto.indexOf(';', i));
    const escritores = modulo('registrar.ts') + modulo('pelo-crm.ts');
    for (const desfecho of ['perdida', 'atendida', 'sem_telefone', 'do_escritorio', 'falhou', 'nao_atendida']) {
      expect(check).toContain(`'${desfecho}'`);
      expect(escritores).toContain(`'${desfecho}'`);
    }
  });

  it('os motivos do fim: os da máquina (`MotivoDoFim`) e o `sumiu` do CRM', () => {
    const i = compacto.indexOf('add constraint cb_ligacoes_motivo_do_fim_ck');
    const check = compacto.slice(i, compacto.indexOf(';', i));
    const daMaquina = [
      ...fs
        .readFileSync(path.join(DIR, '../../maquina-de-ligacoes/src/tipos.ts'), 'utf8')
        .match(/export type MotivoDoFim =([\s\S]*?)\n\n/)![1]
        .matchAll(/'([a-z_0-9]+)'/g),
    ].map((m) => m[1]);
    expect([...MOTIVOS_DO_FIM].sort()).toEqual(daMaquina.sort());
    for (const motivo of [...MOTIVOS_DO_FIM, 'sumiu']) expect(check).toContain(`'${motivo}'`);
    expect(modulo('pelo-crm.ts')).toContain("motivo: 'sumiu'");
  });
});

describe('1134 — a reserva do envio do agente (a retomada)', () => {
  const reserva = corpo(compacto, 'cb_ia_reservar_envio');

  it('"a equipe respondeu" não conta a faixa da ligação pelo CRM; a do celular segue contando', () => {
    expect(reserva).toContain(
      `and m.sender_type = 'agent' and not m.nao_saiu${CERCA} and m.gravada_em > v_gatilho ) then return 'equipe_respondeu'`,
    );
  });

  it('o resto do corpo é o VIGENTE (o da última migration que a definiu), só com a cerca nova', () => {
    expect(reserva.replace(CERCA, '')).toBe(reservaAnterior());
  });

  it('continua fechada ao navegador e aberta ao service_role, e a conferência a CHAMA', () => {
    expect(compacto).toContain(
      'revoke execute on function public.cb_ia_reservar_envio(uuid, timestamptz) from public, anon, authenticated;',
    );
    expect(compacto).toContain('grant execute on function public.cb_ia_reservar_envio(uuid, timestamptz) to service_role;');
    expect(compacto).toContain("raise exception using errcode = 'p1134';");
    expect(compacto).toContain("exception when sqlstate 'p1134' then");
    expect(compacto).toContain("if v_res <> 'equipe_respondeu' then");
  });
});
