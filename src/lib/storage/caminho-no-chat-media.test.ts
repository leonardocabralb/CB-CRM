import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { caminhoNoChatMedia } from './caminho-no-chat-media';

// ============================================================
// O espelho TS da guarda `cb_caminho_no_chat_media` (1097). A regra mora no
// banco; a drenagem confere de novo pelo espelho antes de apagar do bucket.
// Os dois lados SE PROVAM PELOS MESMOS EXEMPLOS: os da conferência 14.2 da
// migration (que roda no replay e na aplicação) são lidos do `.sql` e têm de
// ser exatamente os desta lista — mudou um lado sem o outro, reprova.
// ============================================================

const DIR = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const CONTA = '00000000-0000-0000-0000-000000000001';
const OUTRA = '00000000-0000-0000-0000-000000000002';

/** [entrada, conta, esperado] — a lista da conferência 14.2, nesta ordem. */
const EXEMPLOS_DA_1097: [string, string, string | null][] = [
  [
    `https://x.supabase.co/storage/v1/object/public/chat-media/account-${CONTA}/1700-a.jpg?t=1`,
    CONTA,
    `account-${CONTA}/1700-a.jpg`,
  ],
  [`account-${CONTA}/avatares/x.jpg`, CONTA, `account-${CONTA}/avatares/x.jpg`],
  [`account-${CONTA}/acervo/x.jpg`, CONTA, null],
  [`account-${OUTRA}/x.jpg`, CONTA, null],
  [
    `https://x.supabase.co/storage/v1/object/public/flow-media/account-${CONTA}/x.jpg`,
    CONTA,
    null,
  ],
  [`account-${CONTA}/../x.jpg`, CONTA, null],
  [`account-${CONTA}/a%20b.jpg`, CONTA, null],
  ['https://example.com/x.jpg', CONTA, null],
  ['inbound/x.jpg', CONTA, null],
];

/** A ÚLTIMA migration que define a função (a que vale no replay). */
function ultimaDefinicao(): string {
  let ultima = '';
  for (const arquivo of fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = fs.readFileSync(path.join(DIR, arquivo), 'utf8');
    if (/FUNCTION\s+public\.cb_caminho_no_chat_media\s*\(/i.test(sql))
      ultima = arquivo;
  }
  return ultima;
}

/** Os exemplos que a conferência 14.2 da migration testa, na ordem. */
function exemplosDoSql(arquivo: string): [string, string, string | null][] {
  const sql = fs.readFileSync(path.join(DIR, arquivo), 'utf8');
  const inicio = sql.indexOf('-- 14.2');
  const fim = sql.indexOf('a guarda do caminho errou', inicio);
  expect(
    inicio,
    'a conferência 14.2 sumiu da migration'
  ).toBeGreaterThanOrEqual(0);
  expect(
    fim,
    'a conferência 14.2 não termina na recusa conhecida'
  ).toBeGreaterThan(inicio);
  const bloco = sql.slice(inicio, fim);
  const chamada =
    /cb_caminho_no_chat_media\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)\s*(?:IS\s+DISTINCT\s+FROM\s+'([^']*)'|IS\s+NOT\s+NULL)/gi;
  return [...bloco.matchAll(chamada)].map((m) => [m[1], m[2], m[3] ?? null]);
}

describe('caminhoNoChatMedia — o espelho da guarda da 1097', () => {
  it('a guarda vigente é a da 1097 (redefinida noutra migration: atualize o espelho e este pino)', () => {
    expect(ultimaDefinicao()).toBe('1097_cb_lixeira_de_contatos.sql');
  });

  it('os exemplos da conferência 14.2 são EXATAMENTE os deste pino', () => {
    expect(exemplosDoSql(ultimaDefinicao())).toEqual(EXEMPLOS_DA_1097);
  });

  for (const [entrada, conta, esperado] of EXEMPLOS_DA_1097) {
    it(`mesma resposta do banco: ${entrada.slice(0, 90)}`, () => {
      expect(caminhoNoChatMedia(entrada, conta)).toBe(esperado);
    });
  }
});

describe('caminhoNoChatMedia — as bordas, linha a linha do SQL', () => {
  const nosso = `account-${CONTA}/1700-a.jpg`;
  const url = `https://x.supabase.co/storage/v1/object/public/chat-media/${nosso}`;

  it('URL ou conta ausente → nulo', () => {
    expect(caminhoNoChatMedia(null, CONTA)).toBeNull();
    expect(caminhoNoChatMedia(undefined, CONTA)).toBeNull();
    expect(caminhoNoChatMedia(nosso, null)).toBeNull();
    expect(caminhoNoChatMedia('', CONTA)).toBeNull();
  });

  it('conta que não é uuid → nulo (no banco, o cast estouraria); maiúsculas viram a forma canônica', () => {
    expect(caminhoNoChatMedia(nosso, 'conta-1')).toBeNull();
    expect(caminhoNoChatMedia(nosso, CONTA.toUpperCase())).toBe(nosso);
    const maiuscula = 'ABCDEF00-0000-0000-0000-000000000001';
    expect(
      caminhoNoChatMedia(`account-${maiuscula}/x.jpg`, maiuscula)
    ).toBeNull();
    expect(
      caminhoNoChatMedia(`account-${maiuscula.toLowerCase()}/x.jpg`, maiuscula)
    ).toBe(`account-${maiuscula.toLowerCase()}/x.jpg`);
  });

  it('a URL pública perde a consulta e o fragmento (o carimbo de versão da foto)', () => {
    expect(caminhoNoChatMedia(url, CONTA)).toBe(nosso);
    expect(caminhoNoChatMedia(`${url}?v=1700#x`, CONTA)).toBe(nosso);
    expect(caminhoNoChatMedia(`${url}#x?y`, CONTA)).toBe(nosso);
  });

  it('a marca da URL pública vale mesmo noutro host (o SQL não olha o host)', () => {
    expect(
      caminhoNoChatMedia(
        `https://outro.host/x/object/public/chat-media/${nosso}`,
        CONTA
      )
    ).toBe(nosso);
  });

  it('esquema sem a marca, ou caminho absoluto → nulo', () => {
    expect(
      caminhoNoChatMedia(`data:image/png;base64,${nosso}`, CONTA)
    ).toBeNull();
    expect(caminhoNoChatMedia(`s3://chat-media/${nosso}`, CONTA)).toBeNull();
    expect(caminhoNoChatMedia(`/${nosso}`, CONTA)).toBeNull();
    expect(
      caminhoNoChatMedia(
        `https://x.supabase.co/storage/v1/object/sign/chat-media/${nosso}`,
        CONTA
      )
    ).toBeNull();
  });

  it('o caminho cru da conta passa, as subpastas também — menos o acervo', () => {
    expect(caminhoNoChatMedia(nosso, CONTA)).toBe(nosso);
    expect(caminhoNoChatMedia(`account-${CONTA}/inbound/m.ogg`, CONTA)).toBe(
      `account-${CONTA}/inbound/m.ogg`
    );
    expect(caminhoNoChatMedia(`account-${CONTA}/notas/n.pdf`, CONTA)).toBe(
      `account-${CONTA}/notas/n.pdf`
    );
    expect(
      caminhoNoChatMedia(`account-${CONTA}/acervo/contrato.pdf`, CONTA)
    ).toBeNull();
    expect(
      caminhoNoChatMedia(`${url.replace('1700-a.jpg', 'acervo/x.pdf')}`, CONTA)
    ).toBeNull();
    // `acervo` sem a barra é outro nome, não a pasta.
    expect(caminhoNoChatMedia(`account-${CONTA}/acervox.jpg`, CONTA)).toBe(
      `account-${CONTA}/acervox.jpg`
    );
  });

  it('prefixo da conta incompleto ou de outra conta → nulo', () => {
    expect(caminhoNoChatMedia(`account-${CONTA}`, CONTA)).toBeNull();
    expect(caminhoNoChatMedia(`account-${CONTA}x/a.jpg`, CONTA)).toBeNull();
    expect(caminhoNoChatMedia(`x/account-${CONTA}/a.jpg`, CONTA)).toBeNull();
  });

  it('`..`, `%`, `\\`, `//` e barra sobrando → nulo (na dúvida, o arquivo fica)', () => {
    expect(caminhoNoChatMedia(`account-${CONTA}/a..b.jpg`, CONTA)).toBeNull();
    expect(caminhoNoChatMedia(`account-${CONTA}/a%2Fb.jpg`, CONTA)).toBeNull();
    expect(caminhoNoChatMedia(`account-${CONTA}/a\\b.jpg`, CONTA)).toBeNull();
    expect(caminhoNoChatMedia(`account-${CONTA}//a.jpg`, CONTA)).toBeNull();
    expect(caminhoNoChatMedia(`account-${CONTA}/pasta/`, CONTA)).toBeNull();
    expect(caminhoNoChatMedia(`account-${CONTA}/`, CONTA)).toBeNull();
    expect(caminhoNoChatMedia(`${url}/`, CONTA)).toBeNull();
  });

  it('URL pública que só tem a marca, sem caminho → nulo', () => {
    expect(
      caminhoNoChatMedia(
        'https://x/storage/v1/object/public/chat-media/',
        CONTA
      )
    ).toBeNull();
    expect(
      caminhoNoChatMedia(
        'https://x/storage/v1/object/public/chat-media/?t=1',
        CONTA
      )
    ).toBeNull();
  });
});
