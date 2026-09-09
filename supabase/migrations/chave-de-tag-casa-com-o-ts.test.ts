import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { chaveDeTag } from '@/lib/contacts/chave-de-tag';

// ============================================================
// A régua de "mesma etiqueta" existe DUAS vezes: em TS (`chaveDeTag`) e em
// SQL (a coluna gerada `tags.name_key`, migration 983). Elas precisam
// concordar, e a divergência entre as duas é exatamente o defeito que a 983
// existe para fechar — antes dela, a API casava sem acento e o import de CSV
// casava com.
//
// Este teste lê o `translate` DO PRÓPRIO SQL e confere par a par contra o
// TS. Editar o mapa da migration sem mexer no `chaveDeTag` (ou o contrário)
// reprova aqui.
//
// LIMITE DECLARADO: confere os caracteres que o SQL mapeia. O TS colapsa
// MAIS (apaga todo `\p{Mn}`), e essa folga é deliberada — ver o cabeçalho de
// `chave-de-tag.ts`. O teste cobra a direção que importa: o SQL nunca pode
// colapsar algo que o TS mantém separado.
// ============================================================

const sql = readFileSync(
  path.join(__dirname, '983_cb_etiqueta_sem_duplicata.sql'),
  'utf8'
);

/** O primeiro `translate(..., 'de', 'para')` do arquivo. */
function mapaDoSql(): { de: string; para: string } {
  const m = sql.match(
    /translate\(\s*btrim\(name[^)]*\),\s*'([^']+)',\s*'([^']+)'\s*\)/
  );
  if (!m) throw new Error('não achei o translate da coluna gerada');
  return { de: m[1], para: m[2] };
}

describe('983 — a régua do SQL casa com a do TS', () => {
  const { de, para } = mapaDoSql();

  it('⚠️ as duas strings do translate têm o MESMO comprimento', () => {
    // Com `para` mais curta, o `translate` APAGA os caracteres sobrando em
    // vez de mapeá-los — e a chave gerada ficaria errada, em silêncio.
    expect(de.length).toBe(para.length);
  });

  it('CRÍTICO: cada caractere mapeado no SQL cai no mesmo lugar no TS', () => {
    const divergentes: string[] = [];
    for (let i = 0; i < de.length; i++) {
      if (chaveDeTag(de[i]) !== para[i].toLowerCase()) {
        divergentes.push(`${de[i]} → SQL "${para[i]}" · TS "${chaveDeTag(de[i])}"`);
      }
    }
    expect(divergentes).toEqual([]);
  });

  it('o SQL não colapsa nada que o TS mantenha separado', () => {
    // A direção perigosa: se o SQL juntasse dois nomes que o TS considera
    // diferentes, o código pediria uma etiqueta nova, levaria 23505 e ela
    // sumiria em silêncio.
    const porDestinoSql = new Map<string, string[]>();
    for (let i = 0; i < de.length; i++) {
      const lista = porDestinoSql.get(para[i].toLowerCase()) ?? [];
      lista.push(de[i]);
      porDestinoSql.set(para[i].toLowerCase(), lista);
    }
    for (const [destino, origens] of porDestinoSql) {
      for (const o of origens) expect(chaveDeTag(o)).toBe(destino);
    }
  });

  it('os nomes reais do escritório continuam distintos entre si', () => {
    // Se a régua colapsasse dois nomes em uso, a migration renomearia um
    // deles no deploy — mudança visível que ninguém pediu.
    const reais = [
      'Ag. Demissão', 'Bancário', 'Cliente Fechado', 'Demitida',
      'Desqualificado', 'Formulário', 'Imobiliario', 'Pediu Demissão',
      'Setor Acordo', 'Trabalhista', 'Typebot',
    ];
    expect(new Set(reais.map(chaveDeTag)).size).toBe(reais.length);
  });

  it('a migration RENOMEIA a duplicata, nunca apaga', () => {
    // Apagar quebraria em silêncio as regras que referenciam `tags.id` por
    // JSON — automação, fluxo e o recorte salvo da caixa de entrada —, que
    // nenhuma FK protege.
    const semComentarios = sql
      .split('\n')
      .map((l) => l.replace(/--.*$/, ''))
      .join('\n');
    expect(/UPDATE\s+tags[\s\S]*?SET\s+name\s*=/i.test(semComentarios)).toBe(true);
    expect(/DELETE\s+FROM\s+tags/i.test(semComentarios)).toBe(false);
  });
});
