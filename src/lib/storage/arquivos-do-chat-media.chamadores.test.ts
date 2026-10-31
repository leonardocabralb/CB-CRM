import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// ============================================================
// QUEM grava caminho ou URL do `chat-media` — DEFAULT-DENY.
//
// A Lixeira (1097) apaga arquivo do bucket quando a ficha sai de vez, e a
// única coisa que segura um arquivo que OUTRO registro ainda usa é
// `cb_arquivos_citados`: a lista das colunas que podem citar um caminho do
// `chat-media`. Coluna nova que guarde caminho ou URL do bucket e fique fora
// da lista = o arquivo some do registro dela quando uma ficha que também o
// citava é excluída de vez. Ninguém vê, até o anexo quebrar.
//
// Por isso todo arquivo de `src/` que cita o bucket (`'chat-media'` ou
// `CHAT_MEDIA_BUCKET`, fora de comentário) está DECLARADO aqui, com a coluna
// onde o caminho/URL termina (ou o papel, quando não grava), e a declaração
// diz se a coluna está entre as citações — conferida contra a ÚLTIMA definição
// de `cb_arquivos_citados`. Os ajudantes presos ao bucket (que sobem e
// devolvem a URL a quem chama) têm os CHAMADORES declarados do mesmo jeito.
// Arquivo novo que cite o bucket, ou chamador novo de um desses ajudantes,
// reprova até ser declarado.
//
// LIMITE DECLARADO: segue o nome do bucket e os ajudantes listados. Quem passa
// o bucket por variável a `uploadAccountMedia` sem citar o nome escapa.
// ============================================================

const raiz = path.join(__dirname, '..', '..', '..');

/** Todo `.ts`/`.tsx` de `src/`, menos teste. */
const ARQUIVOS: string[] = [];
(function varrer(dir: string) {
  for (const e of fs.readdirSync(path.join(raiz, dir), {
    withFileTypes: true,
  })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) varrer(rel);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
      ARQUIVOS.push(rel);
  }
})('src');

/**
 * Fonte sem comentários: eles CITAM o bucket ao explicar. O `//` precedido
 * de `:` fica (é URL dentro de string, `https://…`).
 */
function fonte(rel: string): string {
  return fs
    .readFileSync(path.join(raiz, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const CITA_O_BUCKET =
  /['"`]chat-media['"`/]|\bCHAT_MEDIA_BUCKET\b|\/object\/public\/chat-media\//;

type Coluna = {
  /** `tabela.coluna` onde o caminho (ou a URL pública) fica gravado. */
  coluna: string;
  /** Está entre as citações de `cb_arquivos_citados`? Conferido contra o SQL. */
  citada: boolean;
  /** Obrigatório quando `citada: false`: por que não é furo (ou o furo, com nome). */
  porque?: string;
};

type Uso =
  | { grava: Coluna[]; nota?: string }
  | {
      papel:
        | 'só lê'
        | 'só sobe e devolve a URL'
        | 'só sobe e devolve o caminho'
        | 'só apaga'
        | 'só nomeia o bucket';
      nota: string;
    };

const MSG = { coluna: 'messages.media_url', citada: true };
const AGENDADA = [
  { coluna: 'cb_scheduled_messages.media_path', citada: true },
  { coluna: 'cb_scheduled_messages.media_url', citada: true },
];

/** Quem cita o bucket no código. A chave é o caminho a partir da raiz. */
const DECLARADOS: Record<string, Uso> = {
  'src/lib/storage/buckets.ts': {
    papel: 'só nomeia o bucket',
    nota: 'a constante CHAT_MEDIA_BUCKET',
  },
  'src/lib/storage/caminho-no-chat-media.ts': {
    papel: 'só lê',
    nota: 'o espelho da guarda da 1097: só reconhece a URL pública',
  },
  'src/lib/storage/arquivos-a-apagar.ts': {
    papel: 'só apaga',
    nota: 'a drenagem da fila da 1097 (o banco já tirou o que é citado)',
  },
  'src/lib/scheduled/dispatch.ts': {
    papel: 'só lê',
    nota: 'confere se o anexo da agendada ainda existe antes de reivindicar',
  },
  'src/hooks/use-acoes-da-agendada.ts': {
    papel: 'só apaga',
    nota: 'cancelar a agendada apaga o anexo — menos quando ela já virou mensagem (message_id)',
  },
  'src/app/api/cb/acervo/[id]/route.ts': {
    papel: 'só apaga',
    nota: 'apagar o item do acervo; acervo/ fica fora da guarda da Lixeira',
  },
  'src/app/api/cb/acervo/route.ts': {
    grava: [
      { coluna: 'cb_media_library.media_path', citada: true },
      {
        coluna: 'cb_media_library.media_url',
        citada: false,
        porque:
          'derivada do MESMO media_path (citado); e acervo/ fica fora da guarda — nunca entra na fila',
      },
    ],
  },
  'src/components/settings/acervo-manager.tsx': {
    grava: [{ coluna: 'cb_media_library.media_path', citada: true }],
    nota: 'sobe em acervo/ e cadastra pela rota /api/cb/acervo; apaga o objeto se o cadastro falhar',
  },
  'src/app/api/cb/scheduled/route.ts': {
    grava: AGENDADA,
    nota: 'a URL é derivada do caminho (getPublicUrl), nunca aceita do cliente',
  },
  'src/components/inbox/message-composer.tsx': {
    grava: [MSG, ...AGENDADA],
    nota: 'sobe o anexo; o envio grava a mensagem e o agendamento grava a agendada (pelas rotas); apaga o rascunho descartado',
  },
  'src/components/settings/template-manager.tsx': {
    grava: [{ coluna: 'message_templates.header_media_url', citada: true }],
    nota: 'a mídia do cabeçalho do modelo, gravada pelas rotas de modelos',
  },
  'src/components/automations/automation-builder.tsx': {
    grava: [{ coluna: 'automation_steps.step_config', citada: true }],
    nota: 'a URL vai no JSON do passo "Enviar mídia"',
  },
  'src/lib/whatsapp/foto-do-contato.ts': {
    grava: [{ coluna: 'contacts.avatar_url', citada: true }],
    nota: 'a foto em avatares/ (WhatsApp e Instagram, por guardarFoto)',
  },
  'src/lib/acervo/copiar.ts': {
    papel: 'só sobe e devolve a URL',
    nota: 'copia o item do acervo para um caminho de anexo (ver AJUDANTES)',
  },
  'src/lib/whatsapp/mirror-inbound-media.ts': {
    papel: 'só sobe e devolve a URL',
    nota: 'espelha a mídia recebida pela Meta (ver AJUDANTES)',
  },
  'src/lib/whatsapp/transport/evolution-media.ts': {
    papel: 'só sobe e devolve a URL',
    nota: 'baixa a mídia da Evolution (ver AJUDANTES)',
  },
  // 1102 — anexos da anotação interna.
  'src/lib/notes/subir-anexo.ts': {
    papel: 'só sobe e devolve o caminho',
    nota: 'sobe o anexo da anotação em notas/ e devolve o CAMINHO a quem chama (ver AJUDANTES); apaga o que a própria pessoa subiu e desistiu',
  },
  'src/lib/notes/arquivo-do-anexo.ts': {
    papel: 'só lê',
    nota: 'a rota POST /api/cb/notes lê tamanho e tipo do anexo no armazenamento (info) antes de gravar',
  },
  'src/lib/notes/anexos.ts': {
    papel: 'só lê',
    nota: 'deriva a URL pública do caminho do anexo (a tela e a API v1); a anotação guarda só o caminho',
  },
};

/**
 * Os ajudantes PRESOS ao `chat-media` que devolvem a URL (ou o caminho) a quem
 * chama: cada chamador declara onde ela termina.
 */
const AJUDANTES: {
  funcao: string;
  modulo: string;
  chamadores: Record<string, Uso>;
}[] = [
  {
    funcao: 'mirrorInboundMedia',
    modulo: 'src/lib/whatsapp/mirror-inbound-media.ts',
    chamadores: {
      'src/app/api/whatsapp/webhook/route.ts': {
        grava: [MSG],
        nota: 'a mídia recebida pela Meta',
      },
      'src/lib/instagram/midia.ts': {
        papel: 'só sobe e devolve a URL',
        nota: 'o anexo do Instagram (salvarMidiaDoInstagram, abaixo)',
      },
    },
  },
  {
    funcao: 'salvarMidiaDoInstagram',
    modulo: 'src/lib/instagram/midia.ts',
    chamadores: {
      'src/app/api/cb/instagram/webhook/route.ts': {
        grava: [MSG],
        nota: 'passa o ajudante a src/lib/instagram/persistir.ts, que grava a mensagem',
      },
    },
  },
  {
    funcao: 'fetchAndStoreEvolutionMedia',
    modulo: 'src/lib/whatsapp/transport/evolution-media.ts',
    chamadores: {
      'src/app/api/whatsapp/evolution/webhook/route.ts': {
        grava: [MSG],
        nota: 'a mídia recebida pela Evolution',
      },
      'src/app/api/cb/groups/media/[messageId]/route.ts': {
        grava: [MSG],
        nota: 'o download sob demanda do grupo',
      },
    },
  },
  {
    // 1102: devolve o CAMINHO (não a URL): a anotação guarda o caminho.
    funcao: 'subirAnexoDaNota',
    modulo: 'src/lib/notes/subir-anexo.ts',
    chamadores: {
      'src/components/inbox/internal-note-box.tsx': {
        grava: [{ coluna: 'cb_conversation_notes.anexos', citada: true }],
        nota: 'sobe ao Salvar e manda o caminho ao POST /api/cb/notes, que o grava em anexos[].caminho',
      },
    },
  },
  {
    funcao: 'copiarDoAcervo',
    modulo: 'src/lib/acervo/copiar.ts',
    chamadores: {
      'src/app/api/cb/acervo/[id]/copiar/route.ts': {
        grava: [MSG, ...AGENDADA],
        nota: 'devolve o rascunho ao compositor, que envia ou agenda',
      },
      'src/lib/flows/midia-do-no.ts': {
        grava: [MSG],
        nota: 'o nó "Enviar mídia" do robô copia a cada envio',
      },
    },
  },
];

// ── As citações que o banco confere ──────────────────────────────────────

const DIR_MIGRATIONS = path.join(raiz, 'supabase', 'migrations');

/** O corpo da ÚLTIMA definição de `cb_arquivos_citados`, sem comentários. */
function citadosVigente(): { arquivo: string; corpo: string } {
  let vigente: { arquivo: string; corpo: string } | null = null;
  for (const arquivo of fs
    .readdirSync(DIR_MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = fs
      .readFileSync(path.join(DIR_MIGRATIONS, arquivo), 'utf8')
      .replace(/--[^\n]*/g, '');
    const inicio = sql.search(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.cb_arquivos_citados\s*\(/i
    );
    if (inicio < 0) continue;
    const resto = sql.slice(inicio);
    const abre = resto.indexOf('$$');
    vigente = {
      arquivo,
      corpo: resto.slice(abre + 2, resto.indexOf('$$', abre + 2)),
    };
  }
  expect(vigente, 'cb_arquivos_citados sumiu do replay').not.toBeNull();
  return vigente!;
}

const PALAVRAS = new Set([
  'where',
  'union',
  'join',
  'on',
  'limit',
  'order',
  'group',
  'cross',
  'left',
  'as',
  'select',
]);
const DA_PROPRIA_FUNCAO = new Set(['padroes', 'urls', 'citados']);

/**
 * `tabela.coluna` que a função lê, trecho por trecho (cada `UNION` resolve os
 * apelidos dos seus `FROM`). Fica de fora o que é da própria função (as CTEs)
 * e a cerca da conta.
 */
function colunasCitadas(corpo: string): string[] {
  const achadas = new Set<string>();
  for (const parte of corpo.split(/\bUNION(?:\s+ALL)?\b/i)) {
    const apelidos = new Map<string, string>();
    for (const m of parte.matchAll(
      /\bFROM\s+(?:public\.)?(\w+)\s+(?:AS\s+)?(\w+)\b/gi
    )) {
      if (!PALAVRAS.has(m[2].toLowerCase()))
        apelidos.set(m[2], m[1].toLowerCase());
    }
    for (const m of parte.matchAll(/,\s*(\w+)\s+(\w+)\s+WHERE\b/gi)) {
      if (!PALAVRAS.has(m[2].toLowerCase()))
        apelidos.set(m[2], m[1].toLowerCase());
    }
    for (const m of parte.matchAll(/\b(\w+)\.(\w+)\b/g)) {
      const tabela = apelidos.get(m[1]);
      if (!tabela || DA_PROPRIA_FUNCAO.has(tabela) || m[2] === 'account_id')
        continue;
      achadas.add(`${tabela}.${m[2]}`);
    }
  }
  return [...achadas].sort();
}

/**
 * O que `cb_arquivos_citados` confere hoje. Coluna nova na função entra aqui
 * junto — e os escritores dela entram em DECLARADOS (os anexos de anotação
 * entraram com a 1102).
 */
const CITADAS_ESPERADAS = [
  'automation_steps.step_config',
  'cb_conversation_notes.anexos',
  'cb_groups.picture_url',
  'cb_lixeira_de_contatos.arquivos',
  'cb_media_library.media_path',
  'cb_scheduled_messages.media_path',
  'cb_scheduled_messages.media_url',
  'contacts.avatar_url',
  'flow_nodes.config',
  'message_templates.header_content',
  'message_templates.header_media_url',
  'messages.media_url',
  'profiles.avatar_url',
];

// ── Os pinos ─────────────────────────────────────────────────────────────

function colunasDe(uso: Uso): Coluna[] {
  return 'grava' in uso ? uso.grava : [];
}

describe('quem grava caminho ou URL do chat-media (default-deny)', () => {
  const citadas = new Set(colunasCitadas(citadosVigente().corpo));

  it('o leitor do SQL acha exatamente as citações conhecidas (a ÚLTIMA definição de cb_arquivos_citados)', () => {
    expect([...citadas]).toEqual(CITADAS_ESPERADAS);
  });

  it('todo arquivo que cita o bucket está declarado, e nenhuma declaração é de arquivo que não cita mais', () => {
    const citam = ARQUIVOS.filter((rel) =>
      CITA_O_BUCKET.test(fonte(rel))
    ).sort();
    expect(citam).toEqual(Object.keys(DECLARADOS).sort());
  });

  for (const { funcao, modulo, chamadores } of AJUDANTES) {
    it(`todo chamador de ${funcao} está declarado (e todo declarado ainda chama)`, () => {
      expect(fonte(modulo), `${funcao} saiu de ${modulo}`).toMatch(
        new RegExp(`function\\s+${funcao}\\b`)
      );
      const chama = new RegExp(`\\b${funcao}\\s*\\(`);
      const reais = ARQUIVOS.filter(
        (rel) => rel !== modulo && chama.test(fonte(rel))
      ).sort();
      expect(reais).toEqual(Object.keys(chamadores).sort());
    });
  }

  it('cada coluna declarada diz a verdade sobre estar entre as citações do banco', () => {
    const todas = [
      ...Object.entries(DECLARADOS),
      ...AJUDANTES.flatMap((a) => Object.entries(a.chamadores)),
    ].flatMap(([rel, uso]) => colunasDe(uso).map((c) => ({ rel, ...c })));
    expect(todas.length).toBeGreaterThan(0);
    for (const c of todas) {
      expect(
        citadas.has(c.coluna),
        `${c.coluna} (${c.rel}): a declaração diz citada=${c.citada}`
      ).toBe(c.citada);
    }
  });

  it('coluna fora das citações tem o porquê escrito (senão é FURO: o arquivo sumiria debaixo dela)', () => {
    const semPorque = [
      ...Object.entries(DECLARADOS),
      ...AJUDANTES.flatMap((a) => Object.entries(a.chamadores)),
    ]
      .flatMap(([rel, uso]) => colunasDe(uso).map((c) => ({ rel, ...c })))
      .filter((c) => !c.citada && !c.porque?.trim())
      .map((c) => `${c.coluna} (${c.rel})`);
    expect(semPorque).toEqual([]);
  });

  it('o detector enxerga as formas que interessam (senão o default-deny não prova nada)', () => {
    expect(CITA_O_BUCKET.test("uploadAccountMedia('chat-media', file)")).toBe(
      true
    );
    expect(CITA_O_BUCKET.test('const BUCKET = "chat-media";')).toBe(true);
    expect(CITA_O_BUCKET.test('storage.from(CHAT_MEDIA_BUCKET)')).toBe(true);
    expect(CITA_O_BUCKET.test("'/storage/v1/object/public/chat-media/'")).toBe(
      true
    );
    expect(CITA_O_BUCKET.test("uploadAccountMedia('flow-media', file)")).toBe(
      false
    );
    expect(CITA_O_BUCKET.test('chat-media-extra')).toBe(false);
    const sem =
      'a(); // grava no chat-media\n/* o chat-media */ b("https://x/chat-media")';
    expect(
      sem.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    ).toBe('a(); \n b("https://x/chat-media")');
    expect(
      colunasCitadas(
        'SELECT m.media_url AS u FROM messages m, padroes x WHERE m.media_url LIKE ANY (x.p) UNION ALL SELECT k.avatar_url FROM contacts k, padroes x WHERE k.account_id = p_conta'
      )
    ).toEqual(['contacts.avatar_url', 'messages.media_url']);
  });
});
