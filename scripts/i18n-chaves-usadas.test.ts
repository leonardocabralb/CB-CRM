import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// Testes do PRÓPRIO checador (F6 do plano 31/08). Cada caso abaixo é um
// repro MEDIDO da revisão: quatro formas de o portão mentir — duas de
// falso VERMELHO (#18, #20: travar publicação sobre código correto) e
// duas de falso VERDE (#19 parcial, #24: a proteção não proteger).
//
// O script roda como SUBPROCESSO sobre uma árvore fixture (I18N_CHECK_ROOT)
// — é o executável real, com os exits e mensagens que o CI vê.
// ============================================================

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'i18n-chaves-usadas.mjs');

const DICIONARIO = {
  Inbox: { composer: { draftHint: 'Rascunho' }, sidebar: { titulo: 'Painel' } },
  Channels: { label: 'Canal' },
  Broadcasts: { page: { table: { name: 'Nome' } } },
};

const raizes: string[] = [];
afterAll(() => {
  for (const r of raizes) rmSync(r, { recursive: true, force: true });
});

/** Monta uma árvore fixture e roda o script nela. */
function rodar(
  arquivos: Record<string, string>,
  opts: { piso?: number; dicionario?: object } = {},
): { exit: number; saida: string } {
  const raiz = mkdtempSync(join(tmpdir(), 'i18n-check-'));
  raizes.push(raiz);
  mkdirSync(join(raiz, 'messages'), { recursive: true });
  writeFileSync(
    join(raiz, 'messages', 'pt-BR.json'),
    JSON.stringify(opts.dicionario ?? DICIONARIO),
  );
  for (const [rel, conteudo] of Object.entries(arquivos)) {
    const abs = join(raiz, 'src', rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, conteudo);
  }
  try {
    const saida = execFileSync(process.execPath, [SCRIPT], {
      env: {
        ...process.env,
        I18N_CHECK_ROOT: raiz,
        I18N_CHECK_PISO: String(opts.piso ?? 0),
      },
      encoding: 'utf8',
    });
    return { exit: 0, saida };
  } catch (err) {
    const e = err as { status: number | null; stdout: string };
    return { exit: e.status ?? -1, saida: e.stdout ?? '' };
  }
}

describe('i18n-chaves-usadas — o checador em si', () => {
  it('caso motivador: chave inexistente em arquivo com binding reprova', () => {
    const r = rodar({
      'a.tsx': `
        import { useTranslations } from 'next-intl';
        export function A() {
          const t = useTranslations('Inbox.sidebar');
          return t('chaveQueNaoExiste');
        }`,
    });
    expect(r.exit).toBe(1);
    expect(r.saida).toContain('chaveQueNaoExiste');
  });

  it('#18: twMerge/toast com literal em arquivo folha NÃO são pedido de tradução', () => {
    // Medido na revisão: `toast('Contrato salvo')` reprovava o CI com
    // "chave ausente" — o padrão antigo casava qualquer identificador
    // começando com t. Só o `t` exato é tradutor-por-prop.
    const r = rodar({
      'folha.tsx': `
        export function Card({ t }: { t: (k: string) => string }) {
          const cls = twMerge('flex gap-2');
          toast('Contrato salvo');
          track('evento_x');
          return t('titulo');
        }`,
    });
    expect(r.exit).toBe(0);
    expect(r.saida).toContain('modo folha: 1');
  });

  it('#19: dois componentes com namespaces próprios — as chaves dos DOIS valem', () => {
    // Medido: o segundo `const t` sobrescrevia o primeiro no Map e
    // `draftHint` (válida sob Inbox.composer) reprovava "sob: Channels".
    const r = rodar({
      'dois.tsx': `
        import { useTranslations } from 'next-intl';
        export function Primeiro() {
          const t = useTranslations('Inbox.composer');
          return t('draftHint');
        }
        export function Segundo() {
          const t = useTranslations('Channels');
          return t('label');
        }`,
    });
    expect(r.exit).toBe(0);
  });

  it('#19: chave ausente nos DOIS namespaces continua reprovando', () => {
    const r = rodar({
      'dois.tsx': `
        import { useTranslations } from 'next-intl';
        export function Primeiro() {
          const t = useTranslations('Inbox.composer');
          return t('naoExisteEmLugarNenhum');
        }
        export function Segundo() {
          const t = useTranslations('Channels');
          return t('label');
        }`,
    });
    expect(r.exit).toBe(1);
    expect(r.saida).toContain('naoExisteEmLugarNenhum');
  });

  it('#20: chave ANINHADA que existe passa no modo folha (sufixo, não último segmento)', () => {
    // Medido: `t('table.name')` reprovava com Broadcasts.page.table.name
    // no dicionário — a chave inteira era comparada contra o conjunto de
    // últimos segmentos, que nunca contém ponto.
    const r = rodar({
      'folha.tsx': `
        export function Linha({ t }: { t: (k: string) => string }) {
          return t('table.name');
        }`,
    });
    expect(r.exit).toBe(0);
  });

  it('#20: chave aninhada que NÃO existe reprova no modo folha', () => {
    const r = rodar({
      'folha.tsx': `
        export function Linha({ t }: { t: (k: string) => string }) {
          return t('table.colunaInventada');
        }`,
    });
    expect(r.exit).toBe(1);
    expect(r.saida).toContain('table.colunaInventada');
  });

  it('#24: alias no import não vira verde silencioso — reprova nomeando o arquivo', () => {
    // Medido: `useTranslations as useTraducao` + chave inventada saía com
    // exit 0 e "OK" — o arquivo inteiro fora da cobertura, sem sinal.
    const r = rodar({
      'alias.tsx': `
        import { useTranslations as useTraducao } from 'next-intl';
        export function A() {
          const rotulos = useTraducao('Inbox.sidebar');
          return rotulos('chaveInventadaQueNaoExiste');
        }`,
    });
    expect(r.exit).toBe(1);
    expect(r.saida).toContain('alias.tsx');
    expect(r.saida).toContain('NENHUM binding');
  });

  it('#24: invocação direta sem binding é uso legítimo, não fora-de-alcance', () => {
    const r = rodar({
      'direto.tsx': `
        import { useTranslations } from 'next-intl';
        export const rotulo = () => useTranslations('Channels')('label');`,
    });
    expect(r.exit).toBe(0);
  });

  it('#24: cobertura abaixo do piso reprova apontando o ALCANCE, não uma chave', () => {
    const r = rodar(
      {
        'a.tsx': `
        import { useTranslations } from 'next-intl';
        export function A() {
          const t = useTranslations('Channels');
          return t('label');
        }`,
      },
      { piso: 10 },
    );
    expect(r.exit).toBe(1);
    expect(r.saida).toContain('cobertura CAIU');
    expect(r.saida).toContain('ALCANCE');
  });

  it('sanidade: árvore válida termina em OK', () => {
    const r = rodar({
      'a.tsx': `
        import { useTranslations } from 'next-intl';
        export function A() {
          const t = useTranslations('Inbox.composer');
          const tCanal = useTranslations('Channels');
          return t('draftHint') + tCanal('label') + t.rich('draftHint');
        }`,
    });
    expect(r.exit).toBe(0);
    expect(r.saida).toContain('OK');
  });
});

describe('i18n-chaves-usadas — a guarda de cobertura é independente do modo folha (Codex, PR #91)', () => {
  it('arquivo folha que TAMBÉM importa o hook com alias reprova nomeando o arquivo', () => {
    // Antes, a existência de um `t(` folha pulava a guarda inteira: só as
    // chamadas folha eram conferidas e `tr('inventada')` do alias passava.
    const r = rodar({
      'folha-com-alias.tsx': `
        import { useTranslations as useTraducao } from 'next-intl';
        export function Folha({ t }: { t: (k: string) => string }) {
          const tr = useTraducao('Inbox.sidebar');
          return <>{t('label')}{tr('chaveInventadaQueNaoExiste')}</>;
        }`,
    });
    expect(r.exit).toBe(1);
    expect(r.saida).toContain('folha-com-alias.tsx');
    expect(r.saida).toContain('NENHUM binding');
  });

  it('import SÓ COMO TIPO não é binding em potencial — não reprova', () => {
    // `ReturnType<typeof useTranslations>` num módulo de tipos (a forma de
    // message-media.tsx) não tem chamada nenhuma a cobrir.
    const r = rodar({
      'tipos.ts': `
        import type { useTranslations } from 'next-intl';
        export type Translator = ReturnType<typeof useTranslations>;`,
      'inline.ts': `
        import { type useTranslations } from 'next-intl';
        export type Tradutor = ReturnType<typeof useTranslations>;`,
    });
    expect(r.exit).toBe(0);
  });
});

describe('i18n-chaves-usadas — a guarda vale mesmo COM binding reconhecido (Codex, PR #104)', () => {
  it('binding normal + alias no MESMO arquivo: o alias reprova nomeando o arquivo', () => {
    // Antes, `bindings.size === 0` era a porta da guarda: um `const t =
    // useTranslations(...)` legítimo ao lado do alias escondia o alias.
    const r = rodar({
      'misto.tsx': `
        import { useTranslations, useTranslations as useTraducao } from 'next-intl';
        export function A() {
          const t = useTranslations('Channels');
          const tr = useTraducao('Inbox.sidebar');
          return <>{t('label')}{tr('chaveInventadaQueNaoExiste')}</>;
        }`,
    });
    expect(r.exit).toBe(1);
    expect(r.saida).toContain('misto.tsx');
    expect(r.saida).toContain('useTraducao');
  });

  it('binding normal + envelope local chamando a fábrica: a chamada fora de binding reprova', () => {
    const r = rodar({
      'envelope.tsx': `
        import { useTranslations } from 'next-intl';
        function useTraducao(ns: string) { return useTranslations(ns); }
        export function A() {
          const t = useTranslations('Channels');
          const tr = useTraducao('Inbox.sidebar');
          return <>{t('label')}{tr('chaveInventadaQueNaoExiste')}</>;
        }`,
    });
    expect(r.exit).toBe(1);
    expect(r.saida).toContain('envelope.tsx');
    expect(r.saida).toContain('2 chamada(s), 1 reconhecida(s)');
  });

  it('binding com namespace DINÂMICO não é buraco de cobertura (cai no modo folha)', () => {
    const r = rodar({
      'dinamico.tsx': `
        import { useTranslations } from 'next-intl';
        export function A({ ns }: { ns: string }) {
          const t = useTranslations(ns);
          return t('label');
        }`,
    });
    expect(r.exit).toBe(0);
  });
});
