import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Toda data em PALAVRAS do date-fns passa o locale do app.
//
// Sem `locale`, o date-fns fala inglês, e a tela em pt-BR mostra "3 minutes"
// ou "September 8, 2026" sem erro nenhum — foi assim na lista da caixa de
// entrada e no separador de dia da conversa até 10/09/2026. Este pino varre
// `src` inteiro: chamada nova sem o locale reprova aqui.
//
// ⚠️ Só conta o nome IMPORTADO DO date-fns. O projeto tem funções PRÓPRIAS
// com os mesmos nomes (o `formatRelative` de `automations/trigger-meta.ts`
// usa `Intl.RelativeTimeFormat` e recebe o idioma por outro caminho), e um
// pino por nome solto acusaria todas elas.
// ============================================================

const SRC = path.join(__dirname, '..');

const DISTANCIAS = new Set([
  'formatDistanceToNowStrict',
  'formatDistanceToNow',
  'formatDistanceStrict',
  'formatDistance',
  'formatRelative',
]);

const FORMATOS = new Set(['format']);

/** Tokens do `format` que ESCREVEM PALAVRAS e por isso dependem do locale:
 *  mês e dia da semana por extenso, período do dia (AM/PM) e as datas/horas
 *  localizadas. Numérico (`HH:mm`, `yyyy-MM-dd`) não entra. */
const TOKEN_DE_PALAVRA = /M{3,}|L{3,}|E{3,}|c{3,}|a+|b+|B+|P+|p+/;

/** Exceções conhecidas, cada uma com o motivo. Quem consertar uma TIRA daqui:
 *  o último teste cobra que toda exceção ainda seja necessária. */
const EXCECOES_DO_FORMAT: Record<string, string> = {
  'components/agents/ai-usage.tsx':
    'eixo do gráfico de uso da IA ("MMM d"): a ordem em pt-BR ("8 set") é decisão de formato pendente com o operador',
  'components/inbox/media-lightbox.tsx':
    'visualizador do upstream que NÃO está ligado (CLAUDE.md, merge de 2026-08-26)',
};

function arquivosDoSrc(dir: string): string[] {
  const saida: string[] = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, entrada.name);
    if (entrada.isDirectory()) saida.push(...arquivosDoSrc(caminho));
    else if (/\.(ts|tsx)$/.test(entrada.name) && !/\.test\.(ts|tsx)$/.test(entrada.name))
      saida.push(caminho);
  }
  return saida;
}

/** Fonte sem comentários: a documentação cita os nomes ao explicar a regra. */
function semComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Os nomes LOCAIS com que o arquivo importa do date-fns os nomes do conjunto
 *  (respeitando `formatDistance as distancia`). */
function nomesImportados(fonte: string, conjunto: Set<string>): string[] {
  const nomes: string[] = [];
  for (const m of fonte.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]date-fns['"]/g)) {
    for (const especificador of m[1].split(',')) {
      const [original, local] = especificador.trim().split(/\s+as\s+/);
      if (conjunto.has(original)) nomes.push((local ?? original).trim());
    }
  }
  return nomes;
}

/** Os argumentos da chamada que abre em `inicio` (logo depois do "("). */
function argumentos(texto: string, inicio: number): string {
  let nivel = 1;
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === '(') nivel++;
    else if (texto[i] === ')') {
      nivel--;
      if (nivel === 0) return texto.slice(inicio, i);
    }
  }
  return texto.slice(inicio);
}

interface Chamada {
  arquivo: string;
  args: string;
}

function chamadasDe(conjunto: Set<string>): Chamada[] {
  const saida: Chamada[] = [];
  for (const arquivo of arquivosDoSrc(SRC)) {
    const fonte = semComentarios(fs.readFileSync(arquivo, 'utf8'));
    const nomes = nomesImportados(fonte, conjunto);
    if (nomes.length === 0) continue;
    // `(?<![.\w])`: `Intl.NumberFormat(...).format(x)` não é o do date-fns.
    const chamada = new RegExp(`(?<![.\\w])(${nomes.join('|')})\\(`, 'g');
    for (const m of fonte.matchAll(chamada)) {
      saida.push({
        arquivo: path.relative(SRC, arquivo),
        args: argumentos(fonte, (m.index ?? 0) + m[0].length),
      });
    }
  }
  return saida;
}

/** O padrão da chamada de `format` (o primeiro texto entre aspas), sem os
 *  trechos entre aspas simples — texto escapado no padrão não é token. */
function padraoDoFormat(args: string): string | null {
  const m = args.match(/(["'])((?:\\.|(?!\1)[^\\])*)\1/);
  if (!m) return null;
  return m[1] === '"' ? m[2].replace(/'[^']*'/g, '') : m[2];
}

const temLocale = (args: string) => /\blocale\s*:/.test(args);

describe('distâncias em palavras falam o idioma do app', () => {
  const chamadas = chamadasDe(DISTANCIAS);

  it('a varredura acha as chamadas (senão o pino passaria vazio)', () => {
    expect(chamadas.length).toBeGreaterThan(0);
  });

  it('toda distância passa `locale`', () => {
    expect(chamadas.filter((c) => !temLocale(c.args)).map((c) => c.arquivo)).toEqual([]);
  });
});

describe('`format` com token de palavra fala o idioma do app', () => {
  const comPalavra = chamadasDe(FORMATOS).filter((c) => {
    const padrao = padraoDoFormat(c.args);
    return padrao !== null && TOKEN_DE_PALAVRA.test(padrao);
  });
  const semLocale = comPalavra.filter((c) => !temLocale(c.args));

  it('a varredura acha chamadas com token de palavra (senão passaria vazio)', () => {
    expect(comPalavra.length).toBeGreaterThan(0);
  });

  it('toda chamada com token de palavra passa `locale`, fora as exceções escritas', () => {
    const fora = semLocale
      .map((c) => c.arquivo)
      .filter((arquivo) => !(arquivo in EXCECOES_DO_FORMAT));
    expect(fora).toEqual([]);
  });

  it('toda exceção ainda é necessária — quem consertou tira da lista', () => {
    const aindaSemLocale = new Set(semLocale.map((c) => c.arquivo));
    const obsoletas = Object.keys(EXCECOES_DO_FORMAT).filter(
      (arquivo) => !aindaSemLocale.has(arquivo)
    );
    expect(obsoletas).toEqual([]);
  });
});
