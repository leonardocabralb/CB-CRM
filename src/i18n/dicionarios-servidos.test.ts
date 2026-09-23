import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Os dicionários que esta instalação SERVE: `en.json` (a referência) e
// `pt-BR.json`, os dois completos e em paridade (`messages.test.ts`).
//
// ⚠️ `src/i18n/request.ts` carrega `messages/<locale>.json` SE O ARQUIVO
// EXISTIR, e o fallback do next-intl é por arquivo, não por chave. Um
// dicionário pela metade não cai no inglês: mostra o caminho da chave cru
// em toda tela que ele não cobre. Foi assim com o `ko.json` (apagado em
// 08/09/2026) e de novo com o `pt.json` e o `es.json` que o merge #259
// trouxe do original (23/09/2026): 1.740 chaves contra mais de 4.000 —
// quem instalasse com NEXT_PUBLIC_APP_LOCALE=pt ("português", o óbvio) via
// 58% da tela como `Inbox.sidebar.tab…`. Os portões do CI olham só o
// pt-BR, então nada reprovava.
//
// Todo merge do original pode trazê-los de volta: apagar de novo. Quem for
// SERVIR outro idioma acrescenta aqui, com o dicionário completo.
// ============================================================

const DIR = path.join(__dirname, '../../messages');

describe('dicionários servidos', () => {
  it('messages/ tem só en.json e pt-BR.json', () => {
    const arquivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
    expect(arquivos).toEqual(['en.json', 'pt-BR.json']);
  });

  it('nome de produto não é tradução: `Sidebar.title` não volta', () => {
    // A barra lateral e o <title> leem NOME_DO_APP (src/lib/marca.ts). Uma
    // chave no dicionário faria renomear o sistema exigir editar os dois, e
    // o nome divergir entre os idiomas. O #259 a recriou sem uso.
    for (const f of ['en.json', 'pt-BR.json']) {
      const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      expect(d.Sidebar?.title, f).toBeUndefined();
    }
  });

  it('nenhum texto cita o nome do projeto original', () => {
    for (const f of ['en.json', 'pt-BR.json']) {
      expect(fs.readFileSync(path.join(DIR, f), 'utf8'), f).not.toMatch(/wacrm/i);
    }
  });
});
