import { describe, expect, it } from 'vitest';
import { parseWhatsAppFormat, stripWhatsAppFormat, alternarMarcador } from '@/lib/inbox/whatsapp-format';

// Fuzzing das invariantes que já foram quebradas uma vez: o interpretador
// chegou a APAGAR caracteres da mensagem do cliente (valores em R$, número
// de processo, nome de arquivo), e isso é perda de dado silenciosa — o
// original só existe no WhatsApp.
//
// PRNG determinístico — teste que falha tem de falhar sempre igual.
let semente = 12345;
const rnd = () => ((semente = (semente * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

const PECAS = ['*','_','~','`','```','a','B','9','R$','1.500','_00',' ','\n','.',':',',','(',')','ção','0001234','@','/','-','ab_cd','x*y'];

function aleatorio(n: number) {
  let s = '';
  for (let i = 0; i < n; i++) s += pick(PECAS);
  return s;
}

/** Texto que sai da árvore, incluindo os marcadores consumidos. */
function reconstituir(nos: ReturnType<typeof parseWhatsAppFormat>): string {
  return nos.map((no) => {
    if (no.tipo === 'texto') return no.texto;
    if (no.tipo === 'mono') return no.texto;
    return reconstituir(no.filhos);
  }).join('');
}

describe('fuzz do interpretador', () => {
  it('nenhum caractere que NÃO seja marcador se perde, em 20 mil entradas', () => {
    const semMarcador = (s: string) => s.replace(/[*_~`]/g, '');
    for (let i = 0; i < 20000; i++) {
      const entrada = aleatorio(1 + Math.floor(rnd() * 12));
      const saida = reconstituir(parseWhatsAppFormat(entrada));
      if (semMarcador(entrada) !== semMarcador(saida)) {
        throw new Error(`PERDA em ${JSON.stringify(entrada)} -> ${JSON.stringify(saida)}`);
      }
      expect(stripWhatsAppFormat(entrada).length).toBeLessThanOrEqual(entrada.length);
    }
  });

  it('nunca lança nem trava, inclusive em entrada longa e patológica', () => {
    const patologicas = [
      '*'.repeat(5000), '_'.repeat(5000), '`'.repeat(5000),
      '*a'.repeat(3000), '```'.repeat(2000),
      '*'.repeat(1000) + 'x' + '*'.repeat(1000),
      ('*_~`'.repeat(1000)),
    ];
    for (const p of patologicas) {
      const t0 = Date.now();
      expect(() => parseWhatsAppFormat(p)).not.toThrow();
      expect(Date.now() - t0).toBeLessThan(3000);
    }
  });

  it('alternarMarcador nunca corrompe: sempre dá para voltar ao original', () => {
    const estilos = ['negrito','italico','riscado','mono'] as const;
    for (let i = 0; i < 8000; i++) {
      const texto = aleatorio(1 + Math.floor(rnd() * 8));
      const a = Math.floor(rnd() * (texto.length + 1));
      const b = Math.floor(rnd() * (texto.length + 1));
      const [ini, fim] = a <= b ? [a, b] : [b, a];
      const estilo = pick([...estilos]);
      const r = alternarMarcador(texto, ini, fim, estilo);
      // Índices devolvidos têm de ser válidos e coerentes.
      expect(r.inicio).toBeGreaterThanOrEqual(0);
      expect(r.fim).toBeGreaterThanOrEqual(r.inicio);
      expect(r.fim).toBeLessThanOrEqual(r.texto.length);
      // Nada além dos marcadores daquele estilo pode mudar.
      const limpar = (s: string) => s.replace(/[*_~`]/g, '');
      expect(limpar(r.texto)).toBe(limpar(texto));
    }
  });
});
