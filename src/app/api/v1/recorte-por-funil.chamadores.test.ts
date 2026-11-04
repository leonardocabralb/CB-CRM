// ============================================================
// Pino DEFAULT-DENY do recorte por funil da chave de API (1121).
//
// A chave recortada (`api_keys.funis`) só chega a uma rota que declara
// `aceitaRecorte: true` a `requireApiKey`; as outras a recusam com 403. Este
// teste lê o FONTE de toda rota v1 e reprova:
//   · rota que passou a aceitar o recorte sem entrar no manifesto abaixo
//     (a decisão fica visível no diff, com o motivo);
//   · verbo de ESCRITA aceitando o recorte (a chave recortada é só leitura);
//   · rota do manifesto que aceita mas não chama nenhuma régua do recorte
//     (`recorte-por-funil.ts`) — salvo as que não leem dado de cliente.
// ============================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = join(__dirname);

/** Rota + verbo que aceitam a chave recortada, e por quê. */
const ACEITAM_O_RECORTE: Record<string, string> = {
  'contacts/route.ts#GET': 'lista e busca: INNER join em deals pelos funis da chave',
  'contacts/[id]/route.ts#GET': 'ficha: o cliente (a ficha que ficou) precisa estar no recorte',
  'contacts/[id]/custom-fields/route.ts#GET': 'campos: o cliente precisa estar no recorte',
  'contacts/[id]/automation-runs/route.ts#GET': 'histórico de automações: o cliente precisa estar no recorte',
  'conversations/route.ts#GET': 'lista: exige contact_id e o cliente no recorte',
  'conversations/[id]/route.ts#GET': 'conversa: o cliente dela precisa estar no recorte',
  'conversations/[id]/messages/route.ts#GET': 'mensagens: o cliente da conversa precisa estar no recorte',
  'notes/route.ts#GET': 'anotações: exige contact_id e o cliente no recorte',
  'tasks/route.ts#GET': 'tarefas: exige contact_id e o cliente no recorte',
  'tasks/[id]/route.ts#GET': 'tarefa: o cliente dela precisa estar no recorte (sem cliente = 404)',
  'deals/route.ts#GET': 'cards: só os dos funis da chave',
  'deals/[id]/route.ts#GET': 'card: só de funil da chave',
  'pipelines/route.ts#GET': 'funis: só os da chave',
  'me/route.ts#GET': 'identidade da chave (diz o recorte); não lê dado de cliente',
};

/** Aceitam o recorte sem ler dado de cliente: não precisam da régua. */
const SEM_DADO_DE_CLIENTE = new Set(['me/route.ts#GET']);

const REGUAS = /\b(contatoNoRecorte|funilNoRecorte|funisDaChave|exigirFiltroDoCliente)\b/;

function rotas(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) out.push(...rotas(caminho));
    else if (nome === 'route.ts') out.push(caminho);
  }
  return out;
}

/** `{ 'pasta/route.ts#GET': corpo do handler }`, pelo fonte. */
function handlers(): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const arquivo of rotas(RAIZ)) {
    const fonte = readFileSync(arquivo, 'utf8');
    const rel = relative(RAIZ, arquivo).split('\\').join('/');
    const partes = fonte.split(/export\s+async\s+function\s+/);
    for (const parte of partes.slice(1)) {
      const verbo = /^(GET|POST|PATCH|PUT|DELETE)\b/.exec(parte)?.[1];
      if (verbo) mapa.set(`${rel}#${verbo}`, parte);
    }
  }
  return mapa;
}

describe('recorte por funil da chave de API (1121) — quem aceita', () => {
  const todos = handlers();
  const aceitam = [...todos].filter(([, corpo]) => /aceitaRecorte:\s*true/.test(corpo));

  it('acha as rotas (o teste não está lendo uma pasta vazia)', () => {
    expect(todos.size).toBeGreaterThan(20);
  });

  it('só as rotas do manifesto aceitam a chave recortada, e todas elas aceitam', () => {
    expect(aceitam.map(([chave]) => chave).sort()).toEqual(Object.keys(ACEITAM_O_RECORTE).sort());
  });

  it('nenhum verbo de escrita aceita o recorte (a chave recortada é só leitura)', () => {
    for (const [chave] of aceitam) expect(chave.endsWith('#GET'), chave).toBe(true);
  });

  it('quem aceita e lê dado de cliente chama a régua do recorte', () => {
    for (const [chave, corpo] of aceitam) {
      if (SEM_DADO_DE_CLIENTE.has(chave)) continue;
      expect(REGUAS.test(corpo), `${chave} aceita o recorte sem recortar`).toBe(true);
    }
  });
});
