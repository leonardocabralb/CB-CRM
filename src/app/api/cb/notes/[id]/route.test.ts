import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// PUT /api/cb/notes/[id] — EDITAR a anotação (Fase 3; A2–A5 do operador).
//
// Só o AUTOR edita; a nota é lida sob RLS NA VERSÃO que a caixa abriu
// (`versao` = o `editada_em` dela) e o UPDATE leva a mesma cerca — edição
// concorrente vira 409, nunca sobrescrita. Os anexos que FICAM têm de ser da
// nota; os NOVOS passam pela régua do POST (lidos no armazenamento). Nada
// mudou = sem UPDATE (`editada_em` intacta). A menção acrescentada avisa só
// quem ENTROU. O aviso a um colega de verdade não se testa no preview (ele
// receberia), por isso este teste.
// ============================================================

const CONTA = 'c1000000-0000-4000-8000-000000000001';
const NOTA = 'a0000000-0000-4000-8000-000000000001';
const CONVERSA = 'c0000000-0000-4000-8000-000000000001';
const CONTATO = 'd0000000-0000-4000-8000-000000000001';
// Ids de login com forma de UUID: a rota descarta menção que não é UUID.
const ANA = 'b0000000-0000-4000-8000-00000000000a';
const BIA = 'b0000000-0000-4000-8000-00000000000b';
const CAIO = 'b0000000-0000-4000-8000-00000000000c';

const AUDIO = `account-${CONTA}/notas/a1000000-0000-4000-8000-000000000001/audio-1.ogg`;
const PDF = `account-${CONTA}/notas/a1000000-0000-4000-8000-000000000002/contrato.pdf`;
const DE_OUTRA_NOTA = `account-${CONTA}/notas/a1000000-0000-4000-8000-000000000009/outra.pdf`;

const AUDIO_GRAVADO = { caminho: AUDIO, nome: 'audio-1.ogg', mime: 'audio/ogg', bytes: 4096 };

type Linha = Record<string, unknown>;
type Filtro = { op: 'eq' | 'is' | 'in'; col: string; val: unknown };

const estado = vi.hoisted(() => ({
  usuario: '',
  papel: 'agent',
  /** A linha no "banco" (null = apagada). */
  nota: null as null | Record<string, unknown>,
  membros: [] as string[],
  /** Membros da conta SUSPENSOS (1067): o perfil existe, com `suspenso_em`. */
  suspensos: [] as string[],
  erroDoPerfil: false,
  erroDaLeitura: false,
  erroDaReleitura: false,
  erroDosMembros: false,
  erroDoUpdate: false,
  erroDoAviso: false,
  /** Roda entre a leitura e o UPDATE (outra aba apagando ou editando). */
  antesDoUpdate: null as null | (() => void),
  leiturasDaNota: [] as { colunas: string; filtros: { op: string; col: string; val: unknown }[] }[],
  updates: [] as { valores: Record<string, unknown>; filtros: { op: string; col: string; val: unknown }[] }[],
  avisos: [] as Record<string, unknown>[],
  arquivos: {} as Record<string, () => Promise<unknown>>,
  lidos: [] as string[],
  removidos: [] as string[],
}));

/** A linha casa com os filtros — `editada_em` comparado como INSTANTE (o banco compara assim). */
function casa(linha: Linha | null, filtros: Filtro[]): linha is Linha {
  if (!linha) return false;
  return filtros.every((f) => {
    if (f.op === 'is') return linha[f.col] === f.val;
    if (f.op !== 'eq') return true;
    if (f.col === 'editada_em') {
      return linha.editada_em !== null && Date.parse(String(linha.editada_em)) === Date.parse(String(f.val));
    }
    return linha[f.col] === f.val;
  });
}

function doUsuario(tabela: string) {
  const filtros: Filtro[] = [];
  let colunas = '*';
  const resolver = (modo: 'uma' | 'lista') => {
    const eq = (col: string) => filtros.find((f) => f.op === 'eq' && f.col === col)?.val;
    if (tabela === 'profiles' && modo === 'uma') {
      if (estado.erroDoPerfil) return { data: null, error: { message: 'timeout' } };
      return {
        data: {
          account_id: CONTA,
          account_role: estado.papel,
          full_name: eq('user_id') === ANA ? 'Ana Autora' : 'Bia Colega',
          email: null,
        },
        error: null,
      };
    }
    if (tabela === 'profiles') {
      if (estado.erroDosMembros) return { data: null, error: { message: 'timeout' } };
      const pedidos = (filtros.find((f) => f.op === 'in')?.val ?? []) as string[];
      return {
        data: pedidos
          .filter((id) => estado.membros.includes(id))
          .map((user_id) => ({
            user_id,
            suspenso_em: estado.suspensos.includes(user_id) ? '2026-10-20T12:00:00Z' : null,
          })),
        error: null,
      };
    }
    if (tabela === 'cb_conversation_notes' && modo === 'uma') {
      estado.leiturasDaNota.push({ colunas, filtros: [...filtros] });
      // A releitura que mede o 409 é a leitura SEM a cerca de versão.
      const releitura = !filtros.some((f) => f.col === 'editada_em');
      if (releitura ? estado.erroDaReleitura : estado.erroDaLeitura) {
        return { data: null, error: { message: 'timeout' } };
      }
      const linha = estado.nota;
      if (!casa(linha, filtros)) return { data: null, error: null };
      return { data: { ...linha }, error: null };
    }
    throw new Error(`leitura inesperada: ${tabela}/${modo}`);
  };
  const builder = {
    select: (c: string) => ((colunas = c), builder),
    eq: (col: string, val: unknown) => (filtros.push({ op: 'eq', col, val }), builder),
    is: (col: string, val: unknown) => (filtros.push({ op: 'is', col, val }), builder),
    in: (col: string, val: unknown) => (filtros.push({ op: 'in', col, val }), builder),
    maybeSingle: () => Promise.resolve(resolver('uma')),
    then: (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
      Promise.resolve(resolver('lista')).then(ok, falha),
  };
  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: estado.usuario } }, error: null }) },
    from: doUsuario,
  }),
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    storage: {
      from: (bucket: string) => ({
        info: (caminho: string) => {
          estado.lidos.push(`${bucket}:${caminho}`);
          const resposta = estado.arquivos[caminho];
          return resposta
            ? resposta()
            : Promise.resolve({
                data: null,
                error: { message: 'Object not found', status: 400, statusCode: '404' },
              });
        },
        remove: async (caminhos: string[]) => {
          estado.removidos.push(...caminhos);
          return { data: [], error: null };
        },
      }),
    },
    from(tabela: string) {
      if (tabela === 'cb_conversation_notes') {
        return {
          update(valores: Record<string, unknown>) {
            const filtros: Filtro[] = [];
            const escrita = {
              eq: (col: string, val: unknown) => (filtros.push({ op: 'eq', col, val }), escrita),
              is: (col: string, val: unknown) => (filtros.push({ op: 'is', col, val }), escrita),
              select: () => escrita,
              maybeSingle: async () => {
                estado.antesDoUpdate?.();
                estado.updates.push({ valores, filtros: [...filtros] });
                if (estado.erroDoUpdate) return { data: null, error: { message: 'deadlock' } };
                if (!casa(estado.nota, filtros)) return { data: null, error: null };
                estado.nota = { ...estado.nota, ...valores };
                return { data: { ...estado.nota }, error: null };
              },
            };
            return escrita;
          },
        };
      }
      if (tabela === 'notifications') {
        return {
          insert: async (linhas: Record<string, unknown>[]) => {
            if (estado.erroDoAviso) return { error: { message: 'timeout' } };
            estado.avisos.push(...linhas);
            return { error: null };
          },
        };
      }
      throw new Error(`tabela inesperada no admin: ${tabela}`);
    },
  }),
}));

import { PATCH, PUT } from './route';

function editar(corpo: Record<string, unknown>, id = NOTA) {
  return PUT(
    new Request(`http://localhost/api/cb/notes/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ texto: 'Liguei para o cliente', mantidos: [AUDIO], novos: [], versao: null, ...corpo }),
    }),
    { params: Promise.resolve({ id }) }
  );
}

function existe(bytes: number, contentType: string) {
  return () => Promise.resolve({ data: { size: bytes, contentType }, error: null });
}

beforeEach(() => {
  estado.usuario = ANA;
  estado.papel = 'agent';
  estado.nota = {
    id: NOTA,
    account_id: CONTA,
    conversation_id: CONVERSA,
    contact_id: CONTATO,
    author_user_id: ANA,
    texto: 'Liguei para o cliente',
    anexos: [AUDIO_GRAVADO],
    mencionados: [],
    editada_em: null,
    fixada_em: null,
  };
  estado.membros = [ANA, BIA, CAIO];
  estado.suspensos = [];
  estado.erroDoPerfil = false;
  estado.erroDaLeitura = false;
  estado.erroDaReleitura = false;
  estado.erroDosMembros = false;
  estado.erroDoUpdate = false;
  estado.erroDoAviso = false;
  estado.antesDoUpdate = null;
  estado.leiturasDaNota = [];
  estado.updates = [];
  estado.avisos = [];
  estado.arquivos = {};
  estado.lidos = [];
  estado.removidos = [];
});

describe('PUT /api/cb/notes/[id] — quem edita (A2)', () => {
  it('o AUTOR edita: grava o texto aparado e carimba editada_em, cercado por conta, autor e versão', async () => {
    const res = await editar({ texto: '  Liguei para o cliente às 15h  ' });
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo).toMatchObject({ mudou: true, mencoesNotificadas: true });
    expect(corpo.note).toMatchObject({ id: NOTA, texto: 'Liguei para o cliente às 15h' });
    expect(typeof corpo.note.editada_em).toBe('string');
    expect(estado.updates).toHaveLength(1);
    expect(estado.updates[0].valores).toMatchObject({
      texto: 'Liguei para o cliente às 15h',
      anexos: [AUDIO_GRAVADO],
      mencionados: [],
    });
    expect(estado.updates[0].filtros).toEqual(
      expect.arrayContaining([
        { op: 'eq', col: 'id', val: NOTA },
        { op: 'eq', col: 'account_id', val: CONTA },
        { op: 'eq', col: 'author_user_id', val: ANA },
        { op: 'is', col: 'editada_em', val: null },
      ])
    );
  });

  it('quem NÃO é o autor é 403 NOT_THE_AUTHOR — nem o admin reescreve a anotação de outra pessoa', async () => {
    estado.usuario = BIA;
    estado.papel = 'admin';
    const res = await editar({ texto: 'Reescrito' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'NOT_THE_AUTHOR' });
    expect(estado.updates).toEqual([]);
  });

  it('anotação SEM autor (automação, agente de IA) não se edita', async () => {
    estado.nota!.author_user_id = null;
    const res = await editar({ texto: 'Reescrito' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'NOT_THE_AUTHOR' });
    expect(estado.updates).toEqual([]);
  });

  it('a nota é lida sob RLS, na conta de quem edita e na versão que a caixa abriu', async () => {
    await editar({ texto: 'Outro texto' });
    expect(estado.leiturasDaNota[0]).toEqual({
      colunas: '*',
      filtros: [
        { op: 'eq', col: 'id', val: NOTA },
        { op: 'eq', col: 'account_id', val: CONTA },
        { op: 'is', col: 'editada_em', val: null },
      ],
    });
  });
});

describe('PUT /api/cb/notes/[id] — os anexos', () => {
  it('o anexo que fica e NÃO é da nota é 400 ATTACHMENT_NOT_IN_NOTE, dizendo qual — sem ir ao armazenamento', async () => {
    const res = await editar({ mantidos: [AUDIO, DE_OUTRA_NOTA] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'ATTACHMENT_NOT_IN_NOTE',
      anexo: { caminho: DE_OUTRA_NOTA },
    });
    expect(estado.lidos).toEqual([]);
    expect(estado.updates).toEqual([]);
  });

  it('o que fica é o que a NOTA guarda; o novo vem com tamanho e tipo do ARMAZENAMENTO, depois deles', async () => {
    estado.arquivos[PDF] = existe(20, 'application/pdf; charset=binary');
    const res = await editar({ novos: [{ caminho: PDF, nome: 'contrato.pdf', mime: 'image/png', bytes: 1 }] });
    expect(res.status).toBe(200);
    expect(estado.lidos).toEqual([`chat-media:${PDF}`]);
    expect(estado.updates[0].valores.anexos).toEqual([
      AUDIO_GRAVADO,
      { caminho: PDF, nome: 'contrato.pdf', mime: 'application/pdf', bytes: 20 },
    ]);
  });

  it('anexo novo que não está no armazenamento é 400 ATTACHMENT_NOT_FOUND, dizendo QUAL', async () => {
    const res = await editar({ novos: [{ caminho: PDF, nome: 'contrato.pdf' }] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'ATTACHMENT_NOT_FOUND',
      anexo: { caminho: PDF, nome: 'contrato.pdf' },
    });
    expect(estado.updates).toEqual([]);
  });

  it('anexo novo grande demais ou de tipo recusado é 400 — dizendo QUAL', async () => {
    estado.arquivos[PDF] = existe(50 * 1024 * 1024 + 1, 'application/pdf');
    let res = await editar({ novos: [{ caminho: PDF, nome: 'contrato.pdf' }] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'ATTACHMENT_TOO_LARGE',
      anexo: { caminho: PDF, nome: 'contrato.pdf' },
    });
    estado.arquivos[PDF] = existe(10, 'image/gif');
    res = await editar({ novos: [{ caminho: PDF, nome: 'a.gif' }] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'ATTACHMENT_TYPE_REFUSED',
      anexo: { caminho: PDF, nome: 'a.gif' },
    });
    expect(estado.updates).toEqual([]);
  });

  it('armazenamento fora do ar é 503 STORAGE_UNAVAILABLE, nunca "não encontrado"', async () => {
    estado.arquivos[PDF] = () =>
      Promise.resolve({ data: null, error: { message: 'bad gateway', status: 502, statusCode: '502' } });
    const res = await editar({ novos: [{ caminho: PDF, nome: 'contrato.pdf' }] });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'STORAGE_UNAVAILABLE' });
    expect(estado.updates).toEqual([]);
  });

  it('anexo novo de outra conta (ou fora de notas/) é 400 antes do banco e do armazenamento', async () => {
    const res = await editar({
      novos: [{ caminho: 'account-00000000-0000-4000-8000-000000000099/notas/x/a.ogg', nome: 'a.ogg' }],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'ATTACHMENT_OUTSIDE_ACCOUNT' });
    expect(estado.leiturasDaNota).toEqual([]);
    expect(estado.lidos).toEqual([]);
  });

  it('o mesmo arquivo como "fica" e como "novo" é 400 ATTACHMENT_REPEATED', async () => {
    const res = await editar({ novos: [{ caminho: AUDIO, nome: 'audio-1.ogg' }] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'ATTACHMENT_REPEATED', anexo: { caminho: AUDIO } });
    expect(estado.updates).toEqual([]);
  });

  it('TIRAR um anexo grava a lista sem ele e NÃO apaga o arquivo (o gatilho da 1102 o põe na fila)', async () => {
    const res = await editar({ mantidos: [] });
    expect(res.status).toBe(200);
    expect(estado.updates[0].valores.anexos).toEqual([]);
    expect(estado.removidos).toEqual([]);
  });

  it('sem `mantidos` é 400, sem ler a nota: tirar todos os anexos é `[]` explícito', async () => {
    for (const mantidos of [undefined, null, 'tudo']) {
      const res = await editar({ mantidos });
      expect(res.status, String(mantidos)).toBe(400);
    }
    expect(estado.leiturasDaNota).toEqual([]);
    expect(estado.updates).toEqual([]);
  });

  it('sem texto e sem anexo é 400, sem escrever', async () => {
    const res = await editar({ texto: '   ', mantidos: [] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'texto or anexos is required' });
    expect(estado.updates).toEqual([]);
  });

  it('só de anexo vale (texto vazio, o anexo fica)', async () => {
    const res = await editar({ texto: '' });
    expect(res.status).toBe(200);
    expect(estado.updates[0].valores).toMatchObject({ texto: '', anexos: [AUDIO_GRAVADO] });
  });
});

describe('PUT /api/cb/notes/[id] — nada mudou (A4)', () => {
  it('o mesmo texto (aparado) e os mesmos anexos = 200 mudou:false, SEM UPDATE: editada_em intacta', async () => {
    const res = await editar({ texto: '  Liguei para o cliente ' });
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo).toMatchObject({ mudou: false, mencoesNotificadas: true });
    expect(corpo.note).toMatchObject({ id: NOTA, editada_em: null });
    expect(estado.updates).toEqual([]);
    expect(estado.nota!.editada_em).toBeNull();
    expect(estado.lidos).toEqual([]);
  });
});

describe('PUT /api/cb/notes/[id] — concorrência: 409, nunca sobrescrita', () => {
  it('editada noutro lugar depois que a caixa abriu = 409 NOTE_CHANGED com a nota ATUAL, sem escrever', async () => {
    estado.nota!.editada_em = '2026-10-23T15:00:00.000Z';
    estado.nota!.texto = 'Da outra aba';
    const res = await editar({ texto: 'A minha versão', versao: null });
    expect(res.status).toBe(409);
    // A nota atual vai junto: a lista da tela pode estar velha (o tempo real
    // perdeu o UPDATE), e editar de novo a partir dela daria 409 em laço.
    expect(await res.json()).toEqual({
      error: 'NOTE_CHANGED',
      note: expect.objectContaining({
        id: NOTA,
        texto: 'Da outra aba',
        editada_em: '2026-10-23T15:00:00.000Z',
      }),
    });
    expect(estado.updates).toEqual([]);
  });

  it('a versão vai ao banco como veio (quem compara o instante é ele), na leitura e no UPDATE', async () => {
    const versao = '2026-10-23T15:00:00.123+00:00';
    estado.nota!.editada_em = '2026-10-23T15:00:00.123Z';
    const res = await editar({ texto: 'Segunda edição', versao });
    expect(res.status).toBe(200);
    expect(estado.leiturasDaNota[0].filtros).toContainEqual({ op: 'eq', col: 'editada_em', val: versao });
    expect(estado.updates[0].filtros).toContainEqual({ op: 'eq', col: 'editada_em', val: versao });
  });

  it('apagada enquanto a pessoa editava = 409 NOTE_GONE', async () => {
    estado.nota = null;
    const res = await editar({ texto: 'A minha versão' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'NOTE_GONE' });
    expect(estado.updates).toEqual([]);
  });

  it('apagada ENTRE a leitura e o UPDATE (zero linhas) = 409 NOTE_GONE, medido pela releitura', async () => {
    estado.antesDoUpdate = () => {
      estado.nota = null;
    };
    const res = await editar({ texto: 'A minha versão' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'NOTE_GONE' });
  });

  it('editada ENTRE a leitura e o UPDATE = 409 NOTE_CHANGED (a cerca do UPDATE segura)', async () => {
    estado.antesDoUpdate = () => {
      estado.nota = { ...estado.nota, texto: 'Da outra aba', editada_em: '2026-10-23T15:00:01.000Z' };
    };
    const res = await editar({ texto: 'A minha versão' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'NOTE_CHANGED',
      note: { id: NOTA, texto: 'Da outra aba' },
    });
    expect(estado.nota!.texto).toBe('Da outra aba');
  });

  it('versao que não tem forma de instante é 400, sem ler a nota', async () => {
    const res = await editar({ versao: 'ontem' });
    expect(res.status).toBe(400);
    expect(estado.leiturasDaNota).toEqual([]);
  });

  it('id que não é UUID é 400 ANTES do banco (o 22P02 viraria 500)', async () => {
    const res = await editar({}, 'nota-1');
    expect(res.status).toBe(400);
    expect(estado.leiturasDaNota).toEqual([]);
  });
});

describe('PUT /api/cb/notes/[id] — erro de LEITURA não é "não encontrado" (raiz, 8b)', () => {
  it('nota que não deu para ler é 500, nunca 404, 403 ou 409', async () => {
    estado.erroDaLeitura = true;
    const res = await editar({ texto: 'Outro' });
    expect(res.status).toBe(500);
    expect(estado.updates).toEqual([]);
  });

  it('a releitura que mede o 409 falhou = 500, nunca "apagada"', async () => {
    estado.nota!.editada_em = '2026-10-23T15:00:00.000Z';
    estado.erroDaReleitura = true;
    const res = await editar({ texto: 'Outro' });
    expect(res.status).toBe(500);
  });

  it('perfil que não deu para ler é 500, nunca 403', async () => {
    estado.erroDoPerfil = true;
    const res = await editar({ texto: 'Outro' });
    expect(res.status).toBe(500);
    expect(estado.leiturasDaNota).toEqual([]);
  });

  it('UPDATE que falhou é 500', async () => {
    estado.erroDoUpdate = true;
    const res = await editar({ texto: 'Outro' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to save note' });
  });
});

describe('PUT /api/cb/notes/[id] — menção: só quem ENTROU recebe o aviso', () => {
  it('quem já estava mencionado não recebe de novo; quem entrou recebe, com o resumo dos anexos', async () => {
    estado.nota!.texto = '@Bia confere';
    estado.nota!.mencionados = [BIA];
    const res = await editar({ texto: '@Bia @Caio confiram', mencionados: [BIA, CAIO] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mudou: true, mencoesNotificadas: true });
    expect(estado.updates[0].valores.mencionados).toEqual([BIA, CAIO]);
    expect(estado.avisos).toEqual([
      expect.objectContaining({
        user_id: CAIO,
        type: 'note_mention',
        conversation_id: CONVERSA,
        contact_id: CONTATO,
        actor_user_id: ANA,
        title: 'Ana Autora mencionou você numa anotação',
        body: '@Bia @Caio confiram · 🎤 Áudio',
      }),
    ]);
  });

  it('tirar a menção grava a lista nova e não avisa ninguém', async () => {
    estado.nota!.texto = '@Bia confere';
    estado.nota!.mencionados = [BIA];
    await editar({ texto: 'confere', mencionados: [] });
    expect(estado.updates[0].valores.mencionados).toEqual([]);
    expect(estado.avisos).toEqual([]);
  });

  it('quem saiu do escritório e o próprio autor não entram na menção', async () => {
    estado.membros = [ANA, BIA];
    await editar({ texto: '@Ana @Caio @Bia', mencionados: [ANA, CAIO, BIA] });
    expect(estado.updates[0].valores.mencionados).toEqual([BIA]);
    expect(estado.avisos.map((a) => a.user_id)).toEqual([BIA]);
  });

  it('falha ao conferir os membros: fica a lista que a nota tinha, ninguém é avisado, e a tela sabe', async () => {
    estado.nota!.mencionados = [BIA];
    estado.erroDosMembros = true;
    const res = await editar({ texto: '@Bia @Caio confiram', mencionados: [BIA, CAIO] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mudou: true, mencoesNotificadas: false });
    expect(estado.updates[0].valores.mencionados).toEqual([BIA]);
    expect(estado.avisos).toEqual([]);
  });

  it('sem `mencionados` (a caixa não soube quem é da conta): fica a lista gravada, ninguém é avisado', async () => {
    estado.nota!.texto = '@Bia confere';
    estado.nota!.mencionados = [BIA];
    const res = await editar({ texto: '@Bia confere hoje', mencionados: undefined });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mudou: true, mencoesNotificadas: true });
    expect(estado.updates[0].valores.mencionados).toEqual([BIA]);
    expect(estado.avisos).toEqual([]);
  });

  it('falha ao conferir os membros SEM ninguém novo na menção: não houve a quem avisar (mencoesNotificadas true)', async () => {
    // Corrigir uma letra de "@Bia confere", com a Bia já gravada.
    estado.nota!.texto = '@Bia confre';
    estado.nota!.mencionados = [BIA];
    estado.erroDosMembros = true;
    const res = await editar({ texto: '@Bia confere', mencionados: [BIA, ANA] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mudou: true, mencoesNotificadas: true });
    expect(estado.updates[0].valores.mencionados).toEqual([BIA]);
    expect(estado.avisos).toEqual([]);
  });

  it('o SUSPENSO fica gravado na menção e não é avisado — e, gravado, não "entra" de novo quando volta', async () => {
    estado.suspensos = [CAIO];
    let res = await editar({ texto: '@Caio @Bia confiram', mencionados: [CAIO, BIA] });
    expect(res.status).toBe(200);
    expect(estado.updates[0].valores.mencionados).toEqual([CAIO, BIA]);
    expect(estado.avisos.map((a) => a.user_id)).toEqual([BIA]);
    // O Caio volta; a próxima correção não o avisa: ele já estava.
    estado.suspensos = [];
    estado.avisos = [];
    res = await editar({
      texto: '@Caio @Bia confiram hoje',
      mencionados: [CAIO, BIA],
      versao: estado.nota!.editada_em as string,
    });
    expect(res.status).toBe(200);
    expect(estado.avisos).toEqual([]);
  });

  it('o aviso que falhou não derruba a edição: 200 com mencoesNotificadas false', async () => {
    estado.erroDoAviso = true;
    const res = await editar({ texto: '@Caio confere', mencionados: [CAIO] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mudou: true, mencoesNotificadas: false });
  });
});

describe('PATCH /api/cb/notes/[id] — fixar continua aqui', () => {
  it('perfil que não deu para ler é 500, nunca 403 (raiz, 8b)', async () => {
    estado.erroDoPerfil = true;
    const res = await PATCH(
      new Request(`http://localhost/api/cb/notes/${NOTA}`, {
        method: 'PATCH',
        body: JSON.stringify({ fixada: true }),
      }),
      { params: Promise.resolve({ id: NOTA }) }
    );
    expect(res.status).toBe(500);
    expect(estado.leiturasDaNota).toEqual([]);
  });
});
