import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnvioRecente } from './sem-recibo';

const { lerEnviosRecentes } = vi.hoisted(() => ({ lerEnviosRecentes: vi.fn() }));
vi.mock('./sem-recibo', async (original) => ({
  ...(await original<typeof import('./sem-recibo')>()),
  lerEnviosRecentes,
}));

import { PRAZO_DOS_ALARMES_MS, avisarAlarmesDeConexao, ordemDaRodada } from './avisar-alarmes';

// ------------------------------------------------------------
// Um banco em memória que avalia os filtros (e as CERCAS) de verdade.
// ------------------------------------------------------------
type Linha = Record<string, unknown>;

function igual(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    const da = Date.parse(a);
    const db = Date.parse(b);
    if (/^\d{4}-\d\d-\d\dT/.test(a) && Number.isFinite(da) && Number.isFinite(db)) return da === db;
  }
  return a === b;
}

class BancoFalso {
  tabelas: Record<string, Linha[]> = {};
  falhas: Record<string, string> = {};
  /** Roda depois de cada SELECT de uma tabela (para simular o escritor concorrente). */
  depoisDeLer: Record<string, () => void> = {};
  chamadas: { tabela: string; op: string; filtros: string[] }[] = [];

  from(tabela: string) {
    return new ConsultaFalsa(this, tabela);
  }

  linhas(tabela: string): Linha[] {
    return (this.tabelas[tabela] ??= []);
  }

  /**
   * O dublê de `cb_gravar_alarme_de_conexao` (1122), com as mesmas cercas e a
   * mesma transação: se a escrita não vale, nada muda; o aviso vai só a quem,
   * da lista, é membro ATIVO da conta. A função de verdade é provada pela
   * conferência da própria migration.
   */
  rpc(nome: string, a: Record<string, unknown>) {
    this.chamadas.push({ tabela: `rpc:${nome}`, op: 'rpc', filtros: [`p_account_id=${String(a.p_account_id)}`] });
    const recusa = a.p_titulo ? this.falhas['rpc.com-aviso'] : this.falhas['rpc.sem-aviso'];
    if (recusa) return Promise.resolve({ data: null, error: { message: recusa } });

    const estados = this.linhas('cb_alarmes_de_conexao');
    const de = a.p_de as Linha | null;
    const para = a.p_para as Linha | null;
    const daChave = (l: Linha) =>
      l.account_id === a.p_account_id && l.channel_id === a.p_channel_id && l.tipo === a.p_tipo;
    const cercada = (l: Linha) =>
      daChave(l) &&
      igual(l.avisado_em ?? null, de?.avisado_em ?? null) &&
      igual(l.normalizou_em ?? null, de?.normalizou_em ?? null) &&
      igual(l.devido_em ?? null, de?.devido_em ?? null);

    let valeu = false;
    if (de === null && para !== null) {
      if (!estados.some((l) => l.channel_id === a.p_channel_id && l.tipo === a.p_tipo)) {
        estados.push({ account_id: a.p_account_id, channel_id: a.p_channel_id, tipo: a.p_tipo, ...para });
        valeu = true;
      }
    } else if (de !== null && para === null) {
      const antes = estados.length;
      this.tabelas.cb_alarmes_de_conexao = estados.filter((l) => !cercada(l));
      valeu = this.tabelas.cb_alarmes_de_conexao.length === antes - 1;
    } else if (de !== null && para !== null) {
      const alvo = estados.filter(cercada);
      for (const l of alvo) Object.assign(l, para);
      valeu = alvo.length === 1;
    }
    if (valeu && a.p_titulo) {
      const lista = (a.p_destinatarios as string[]) ?? [];
      for (const m of this.linhas('profiles')) {
        if (m.account_id === a.p_account_id && m.suspenso_em === null && lista.includes(String(m.user_id))) {
          this.linhas('notifications').push({
            account_id: a.p_account_id,
            user_id: m.user_id,
            type: 'whatsapp_alert',
            title: a.p_titulo,
            body: a.p_corpo,
          });
        }
      }
    }
    return Promise.resolve({ data: valeu, error: null });
  }
}

class ConsultaFalsa implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private filtros: ((l: Linha) => boolean)[] = [];
  private descricao: string[] = [];
  private payload: unknown = null;
  private limite = Infinity;

  constructor(
    private banco: BancoFalso,
    private tabela: string,
  ) {}

  select() {
    return this;
  }
  insert(linhas: Linha[]) {
    this.op = 'insert';
    this.payload = linhas;
    return this;
  }
  upsert(linha: Linha) {
    this.op = 'upsert';
    this.payload = linha;
    return this;
  }
  update(colunas: Linha) {
    this.op = 'update';
    this.payload = colunas;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(coluna: string, valor: unknown) {
    this.descricao.push(`eq:${coluna}=${String(valor)}`);
    this.filtros.push((l) => igual(l[coluna], valor));
    return this;
  }
  is(coluna: string, valor: null) {
    this.descricao.push(`is:${coluna}=${String(valor)}`);
    this.filtros.push((l) => l[coluna] === null || l[coluna] === undefined);
    return this;
  }
  gt(coluna: string, valor: string) {
    this.filtros.push((l) => String(l[coluna]) > valor);
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    this.limite = n;
    return this;
  }
  range(de: number, ate: number) {
    this.descricao.push(`range:${de}-${ate}`);
    this.inicio = de;
    this.limite = ate - de + 1;
    return this;
  }
  private inicio = 0;

  then<A, B>(
    ok?: ((v: { data: unknown; error: { message: string } | null }) => A | PromiseLike<A>) | null,
    falha?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.executar()).then(ok, falha);
  }

  private executar(): { data: unknown; error: { message: string } | null } {
    this.banco.chamadas.push({ tabela: this.tabela, op: this.op, filtros: this.descricao });
    const recusa = this.banco.falhas[`${this.tabela}.${this.op}`];
    if (recusa) return { data: null, error: { message: recusa } };
    const linhas = this.banco.linhas(this.tabela);
    const casa = (l: Linha) => this.filtros.every((f) => f(l));
    switch (this.op) {
      case 'select': {
        // O PostgREST corta em 1000 linhas sem avisar (`max_rows`), com ou
        // sem `limit` maior: o dublê também, senão a leitura sem página passa.
        const achadas = linhas
          .filter(casa)
          .slice(this.inicio, this.inicio + Math.min(this.limite, 1000))
          .map((l) => ({ ...l }));
        this.banco.depoisDeLer[this.tabela]?.();
        return { data: achadas, error: null };
      }
      case 'insert':
        linhas.push(...(this.payload as Linha[]).map((l) => ({ ...l })));
        return { data: null, error: null };
      case 'upsert': {
        const nova = this.payload as Linha;
        if (linhas.some((l) => l.channel_id === nova.channel_id && l.tipo === nova.tipo)) {
          return { data: [], error: null };
        }
        linhas.push({ ...nova });
        return { data: [{ channel_id: nova.channel_id }], error: null };
      }
      case 'update': {
        const alvo = linhas.filter(casa);
        for (const l of alvo) Object.assign(l, this.payload);
        return { data: alvo.map((l) => ({ channel_id: l.channel_id })), error: null };
      }
      case 'delete': {
        const alvo = linhas.filter(casa);
        this.banco.tabelas[this.tabela] = linhas.filter((l) => !casa(l));
        return { data: alvo.map((l) => ({ channel_id: l.channel_id })), error: null };
      }
    }
  }
}

// ------------------------------------------------------------
// A conta de teste
// ------------------------------------------------------------
const MIN = 60_000;
// Quarta-feira, 04/11/2026, 09:30 de Brasília (horário útil).
const AGORA = Date.parse('2026-11-04T12:30:00.000Z');
// Sábado, 07/11/2026, 03:00 de Brasília (fora do horário).
const MADRUGADA = Date.parse('2026-11-07T06:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

function envio(agora: number, minutos: number, conversa: string, status = 'sent'): EnvioRecente {
  return { criadoEm: iso(agora - minutos * MIN), status, conversaId: conversa };
}
const travada = (agora: number) => [
  envio(agora, 20, 'a'),
  envio(agora, 25, 'b'),
  envio(agora, 30, 'c'),
  envio(agora, 35, 'a'),
  envio(agora, 40, 'b'),
];

function perfil(id: string, channel_ids: string[]) {
  return {
    id,
    account_id: 'conta-1',
    nome: id,
    papel_base: 'agent',
    telas: [],
    secoes_config: [],
    channel_ids,
    pipeline_ids: [],
    sistema: false,
  };
}

function montarBanco(): BancoFalso {
  const banco = new BancoFalso();
  banco.tabelas.cb_channels = [
    { id: 'c1', account_id: 'conta-1', kind: 'evolution', label: 'Comercial', entrega_carimbo_em: null, entrega_recebida_em: null },
    { id: 'm1', account_id: 'conta-1', kind: 'meta', label: 'Oficial', entrega_carimbo_em: null, entrega_recebida_em: null },
    { id: 'ig1', account_id: 'conta-1', kind: 'instagram', label: 'Direct', entrega_carimbo_em: null, entrega_recebida_em: null },
    { id: 'c9', account_id: 'conta-2', kind: 'evolution', label: 'De outra conta', entrega_carimbo_em: null, entrega_recebida_em: null },
  ];
  banco.tabelas.cb_perfis_de_acesso = [perfil('so-c1', ['c1']), perfil('so-m1', ['m1'])];
  banco.tabelas.profiles = [
    { user_id: 'dono', account_id: 'conta-1', account_role: 'owner', perfil_id: null, suspenso_em: null },
    { user_id: 'atende-c1', account_id: 'conta-1', account_role: 'agent', perfil_id: 'so-c1', suspenso_em: null },
    { user_id: 'atende-m1', account_id: 'conta-1', account_role: 'agent', perfil_id: 'so-m1', suspenso_em: null },
    { user_id: 'dono-2', account_id: 'conta-2', account_role: 'owner', perfil_id: null, suspenso_em: null },
  ];
  banco.tabelas.cb_alarmes_de_conexao = [];
  banco.tabelas.notifications = [];
  return banco;
}

const avisos = (banco: BancoFalso) => banco.tabelas.notifications as Linha[];
const estadoDe = (banco: BancoFalso, canal: string, tipo: string) =>
  (banco.tabelas.cb_alarmes_de_conexao as Linha[]).find((l) => l.channel_id === canal && l.tipo === tipo);

beforeEach(() => {
  // O idioma da instalação de referência: o dicionário é carregado na 1ª
  // chamada e guardado, então todos os testes daqui escrevem em pt-BR.
  vi.stubEnv('NEXT_PUBLIC_APP_LOCALE', 'pt-BR');
  lerEnviosRecentes.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('avisarAlarmesDeConexao — o passo do ciclo', () => {
  it('(c) aceso em horário útil: UM aviso para quem vê a conexão, e o episódio fica guardado como avisado', async () => {
    const banco = montarBanco();
    lerEnviosRecentes.mockImplementation(async (_db: unknown, canal: string, agora: number) =>
      canal === 'c1' ? travada(agora) : [envio(agora, 20, 'x', 'delivered')],
    );
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);

    expect(avisos(banco).map((a) => a.user_id).sort()).toEqual(['atende-c1', 'dono']);
    for (const a of avisos(banco)) {
      expect(a).toMatchObject({ account_id: 'conta-1', type: 'whatsapp_alert' });
      expect(String(a.title)).toContain('Comercial');
    }
    expect(estadoDe(banco, 'c1', 'sem_recibo')).toMatchObject({ account_id: 'conta-1', avisado_em: iso(AGORA) });
  });

  it('⚠️ o Instagram fica fora: nem a leitura dos envios acontece', async () => {
    const banco = montarBanco();
    lerEnviosRecentes.mockResolvedValue([]);
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);
    const lidos = lerEnviosRecentes.mock.calls.map((c) => c[1]);
    expect(lidos).toContain('c1');
    expect(lidos).toContain('m1');
    expect(lidos).not.toContain('ig1');
  });

  it('⚠️ toda leitura da conta é cercada pela conta (service role não tem RLS)', async () => {
    const banco = montarBanco();
    lerEnviosRecentes.mockResolvedValue([]);
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);
    for (const tabela of ['cb_perfis_de_acesso', 'profiles', 'cb_alarmes_de_conexao']) {
      const leituras = banco.chamadas.filter((c) => c.tabela === tabela && c.op === 'select');
      expect(leituras.length).toBeGreaterThan(0);
      for (const l of leituras) expect(l.filtros.some((f) => f.startsWith('eq:account_id='))).toBe(true);
    }
    // O suspenso fica de fora já na leitura.
    const membros = banco.chamadas.find((c) => c.tabela === 'profiles');
    expect(membros?.filtros).toContain('is:suspenso_em=null');
  });

  it('⚠️ mais de 1000 PERFIS: a leitura pagina, e o perfil depois do milésimo segue recortando (não vira "vê tudo") — achado do Codex', async () => {
    const banco = montarBanco();
    // Ordem de chave: os mil de `p…` vêm antes de `so-c1` e `so-m1`.
    banco.tabelas.cb_perfis_de_acesso = [
      ...Array.from({ length: 1000 }, (_, i) => perfil(`p${String(i).padStart(4, '0')}`, ['m1'])),
      ...banco.tabelas.cb_perfis_de_acesso,
    ];
    lerEnviosRecentes.mockImplementation(async (_db: unknown, canal: string, agora: number) =>
      canal === 'c1' ? travada(agora) : [],
    );
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);
    // `atende-m1` vê só a m1: o alarme da c1 não é dele.
    expect(avisos(banco).map((a) => a.user_id).sort()).toEqual(['atende-c1', 'dono']);
  });

  it('⚠️ mais de 1000 MEMBROS: a leitura pagina, e quem vem depois do milésimo também é avisado — achado do Codex', async () => {
    const banco = montarBanco();
    const comId = (l: Linha, i: number) => ({ id: `b${i}`, ...l });
    banco.tabelas.profiles = [
      ...Array.from({ length: 1000 }, (_, i) => ({
        id: `a${String(i).padStart(4, '0')}`,
        user_id: `outro-${i}`,
        account_id: 'conta-1',
        account_role: 'agent',
        perfil_id: 'so-m1',
        suspenso_em: null,
      })),
      ...banco.tabelas.profiles.map(comId),
    ];
    lerEnviosRecentes.mockImplementation(async (_db: unknown, canal: string, agora: number) =>
      canal === 'c1' ? travada(agora) : [],
    );
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);
    expect(avisos(banco).map((a) => a.user_id).sort()).toEqual(['atende-c1', 'dono']);
  });

  it('um aviso por EPISÓDIO: o ciclo seguinte, ainda aceso, não repete', async () => {
    const banco = montarBanco();
    lerEnviosRecentes.mockImplementation(async (_db: unknown, canal: string, agora: number) =>
      canal === 'c1' ? travada(agora) : [],
    );
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA + 15 * MIN);
    expect(avisos(banco)).toHaveLength(2); // o dono e quem atende a c1, uma vez
  });

  it('⚠️ o aviso que falhou não muda o estado junto: o episódio fica DEVIDO e o ciclo seguinte tenta de novo', async () => {
    const banco = montarBanco();
    lerEnviosRecentes.mockImplementation(async (_db: unknown, canal: string, agora: number) =>
      canal === 'c1' ? travada(agora) : [],
    );
    banco.falhas['rpc.com-aviso'] = 'recusado';
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);
    expect(avisos(banco)).toHaveLength(0);
    expect(estadoDe(banco, 'c1', 'sem_recibo')).toMatchObject({ avisado_em: null, devido_em: iso(AGORA) });

    delete banco.falhas['rpc.com-aviso'];
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA + 15 * MIN);
    expect(avisos(banco)).toHaveLength(2);
    expect(estadoDe(banco, 'c1', 'sem_recibo')).toMatchObject({ avisado_em: iso(AGORA + 15 * MIN), devido_em: null });
  });

  it('o aviso devido que nunca entrou e normalizou: "Aconteceu e já normalizou"', async () => {
    const banco = montarBanco();
    banco.tabelas.cb_alarmes_de_conexao = [
      {
        account_id: 'conta-1',
        channel_id: 'c1',
        tipo: 'sem_recibo',
        desde: iso(AGORA - 3 * 60 * MIN),
        avisado_em: null,
        normalizou_em: null,
        devido_em: iso(AGORA - 30 * MIN),
        detalhe: {},
      },
    ];
    lerEnviosRecentes.mockImplementation(async (_db: unknown, canal: string, agora: number) =>
      canal === 'c1' ? [envio(agora, 2, 'z', 'delivered')] : [],
    );
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);
    expect(String(avisos(banco)[0].title)).toMatch(/^Aconteceu e já normalizou — /);
    expect(estadoDe(banco, 'c1', 'sem_recibo')).toBeUndefined();
  });

  it('⚠️ o aviso vai só a membro ATIVO da conta, mesmo que a lista diga outro (a função confere)', async () => {
    const banco = montarBanco();
    // Quem atende a c1 é suspenso DEPOIS da leitura dos membros: a lista do
    // app ainda o traz, e a função do banco o tira.
    banco.depoisDeLer.profiles = () => {
      (banco.tabelas.profiles as Linha[])[1].suspenso_em = iso(AGORA - MIN);
    };
    lerEnviosRecentes.mockImplementation(async (_db: unknown, canal: string, agora: number) =>
      canal === 'c1' ? travada(agora) : [],
    );
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);
    expect(avisos(banco).map((a) => a.user_id)).toEqual(['dono']);
  });

  it('⚠️ só quem GANHA a escrita cercada avisa: outro escritor mudou o estado depois da leitura', async () => {
    const banco = montarBanco();
    banco.tabelas.cb_alarmes_de_conexao = [
      {
        account_id: 'conta-1',
        channel_id: 'c1',
        tipo: 'sem_recibo',
        desde: iso(AGORA - 60 * MIN),
        avisado_em: null,
        normalizou_em: null,
        devido_em: null,
        detalhe: {},
      },
    ];
    lerEnviosRecentes.mockImplementation(async (_db: unknown, canal: string, agora: number) =>
      canal === 'c1' ? travada(agora) : [],
    );
    banco.depoisDeLer.cb_alarmes_de_conexao = () => {
      const linha = estadoDe(banco, 'c1', 'sem_recibo');
      if (linha) linha.avisado_em = iso(AGORA - MIN); // o outro ciclo avisou primeiro
    };
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);
    expect(avisos(banco)).toHaveLength(0);
  });

  it('a prova do fim de um episódio avisado: "Normalizou", e a linha sai', async () => {
    const banco = montarBanco();
    const desde = iso(AGORA - 3 * 60 * MIN);
    banco.tabelas.cb_alarmes_de_conexao = [
      {
        account_id: 'conta-1',
        channel_id: 'c1',
        tipo: 'sem_recibo',
        desde,
        avisado_em: iso(AGORA - 60 * MIN),
        normalizou_em: null,
        devido_em: null,
        detalhe: {},
      },
    ];
    lerEnviosRecentes.mockImplementation(async (_db: unknown, canal: string, agora: number) =>
      canal === 'c1' ? [envio(agora, 2, 'z', 'delivered'), ...travada(agora)] : [],
    );
    // A 1ª prova só começa a FIRMAR (histerese): nada vai ao sino ainda, e o
    // começo do episódio vai à leitura (a prova pode ser mais velha que 24 h).
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);
    expect(avisos(banco)).toEqual([]);
    expect(estadoDe(banco, 'c1', 'sem_recibo')?.normalizou_em).toBe(iso(AGORA));
    expect(lerEnviosRecentes).toHaveBeenCalledWith(expect.anything(), 'c1', AGORA, desde);

    // Uma hora depois, sem envio novo: a prova firmou, e o "Normalizou" sai.
    lerEnviosRecentes.mockImplementation(async () => []);
    const depois = AGORA + 61 * MIN;
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, depois);
    expect(avisos(banco).map((a) => a.user_id).sort()).toEqual(['atende-c1', 'dono']);
    expect(String(avisos(banco)[0].title)).toMatch(/^Normalizou — /);
    expect(estadoDe(banco, 'c1', 'sem_recibo')).toBeUndefined();
  });

  it('de madrugada no sábado: o (b) aberto há 30 min avisa; o (c) fica guardado para a abertura do horário', async () => {
    const banco = montarBanco();
    const c1 = (banco.tabelas.cb_channels as Linha[])[0];
    c1.entrega_carimbo_em = iso(MADRUGADA - 100 * MIN);
    c1.entrega_recebida_em = iso(MADRUGADA - 40 * MIN); // 60 min de atraso, o âmbar aceso há 40 min
    lerEnviosRecentes.mockImplementation(async (_db: unknown, canal: string, agora: number) =>
      canal === 'c1' ? travada(agora) : [],
    );
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, MADRUGADA);

    expect(avisos(banco)).toHaveLength(2);
    expect(String(avisos(banco)[0].title)).toMatch(/atraso: Comercial$/);
    expect(estadoDe(banco, 'c1', 'atraso')).toMatchObject({ avisado_em: iso(MADRUGADA) });
    expect(estadoDe(banco, 'c1', 'sem_recibo')).toMatchObject({ avisado_em: null });
  });

  it('o aviso da conta 2 vai só à conta 2', async () => {
    const banco = montarBanco();
    lerEnviosRecentes.mockImplementation(async (_db: unknown, canal: string, agora: number) =>
      canal === 'c9' ? travada(agora) : [],
    );
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);
    expect(avisos(banco)).toEqual([expect.objectContaining({ account_id: 'conta-2', user_id: 'dono-2' })]);
  });

  it('⚠️ o passo tem prazo próprio: passado ele, as conexões que faltam ficam para o próximo ciclo', async () => {
    const banco = montarBanco();
    lerEnviosRecentes.mockResolvedValue([]);
    let relogio = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => relogio);
    lerEnviosRecentes.mockImplementation(async () => {
      relogio += PRAZO_DOS_ALARMES_MS + 1; // a 1ª conexão já come o prazo inteiro
      return [];
    });
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);
    expect(lerEnviosRecentes).toHaveBeenCalledTimes(1);
    vi.mocked(Date.now).mockRestore();
  });

  it('⚠️ com o prazo cortando a rodada, a ordem embaralhada deixa de fora uma conexão DIFERENTE a cada ciclo (Codex, #460)', async () => {
    const primeiras: string[] = [];
    for (const sorteio of [0, 0.999]) {
      const banco = montarBanco();
      let relogio = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => relogio);
      lerEnviosRecentes.mockReset();
      lerEnviosRecentes.mockImplementation(async (_db: unknown, canal: string) => {
        primeiras.push(canal);
        relogio += PRAZO_DOS_ALARMES_MS + 1; // a 1ª conexão come o prazo inteiro
        return [];
      });
      await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA, () => sorteio);
      vi.mocked(Date.now).mockRestore();
    }
    expect(primeiras).toHaveLength(2);
    expect(primeiras[0]).not.toBe(primeiras[1]);
  });

  it('ordemDaRodada embaralha sem perder nem repetir ninguém', () => {
    const itens = ['a', 'b', 'c', 'd', 'e'];
    for (const sorteio of [0, 0.3, 0.6, 0.999]) {
      expect([...ordemDaRodada(itens, () => sorteio)].sort()).toEqual(itens);
    }
    expect(ordemDaRodada([], () => 0)).toEqual([]);
  });

  it('⚠️ o estado é lido em todas as páginas: o da 1001ª linha ainda encerra o episódio (Codex, #460)', async () => {
    const banco = montarBanco();
    const outros = Array.from({ length: 1000 }, (_, i) => ({
      account_id: 'conta-1',
      channel_id: `antiga-${String(i).padStart(4, '0')}`,
      tipo: 'atraso',
      desde: iso(AGORA - 9 * 60 * MIN),
      avisado_em: null,
      normalizou_em: null,
      devido_em: null,
      detalhe: {},
    }));
    banco.tabelas.cb_alarmes_de_conexao = [
      ...outros,
      {
        account_id: 'conta-1',
        channel_id: 'c1',
        tipo: 'sem_recibo',
        desde: iso(AGORA - 3 * 60 * MIN),
        avisado_em: iso(AGORA - 2 * 60 * MIN),
        // A prova de pé há mais de uma hora (firme): fecha neste ciclo.
        normalizou_em: iso(AGORA - 70 * MIN),
        devido_em: null,
        detalhe: {},
      },
    ];
    lerEnviosRecentes.mockImplementation(async (_db: unknown, canal: string, agora: number) =>
      canal === 'c1' ? [envio(agora, 2, 'z', 'delivered')] : [],
    );
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);

    const paginas = banco.chamadas.filter((c) => c.tabela === 'cb_alarmes_de_conexao' && c.op === 'select');
    expect(paginas.filter((c) => c.filtros.some((f) => f.startsWith('range:'))).length).toBeGreaterThanOrEqual(2);
    expect(String(avisos(banco)[0]?.title)).toMatch(/^Normalizou — /);
    expect(estadoDe(banco, 'c1', 'sem_recibo')).toBeUndefined();
  });

  it('⚠️ NUNCA lança, e sem saber quem recebe (ou o que já foi avisado) nada se decide', async () => {
    const semCanais = montarBanco();
    semCanais.falhas['cb_channels.select'] = 'fora do ar';
    await expect(avisarAlarmesDeConexao(semCanais as unknown as SupabaseClient, AGORA)).resolves.toBeUndefined();
    expect(lerEnviosRecentes).not.toHaveBeenCalled();

    const semMembros = montarBanco();
    semMembros.falhas['profiles.select'] = 'fora do ar';
    lerEnviosRecentes.mockImplementation(async (_db: unknown, _c: string, agora: number) => travada(agora));
    await avisarAlarmesDeConexao(semMembros as unknown as SupabaseClient, AGORA);
    expect(avisos(semMembros).filter((a) => a.account_id === 'conta-1')).toHaveLength(0);
    expect(semMembros.tabelas.cb_alarmes_de_conexao.filter((l) => l.account_id === 'conta-1')).toHaveLength(0);
  });
});

// ------------------------------------------------------------
// O computador de ligações (4e, 1137): sem sinal e pedindo o QR.
// ------------------------------------------------------------
describe('avisarAlarmesDeConexao — o computador de ligações', () => {
  const LIGADO_EM = iso(AGORA - 30 * 24 * 60 * MIN);
  function comComputador(banco: BancoFalso, extra: Linha = {}) {
    banco.tabelas.cb_computadores_de_ligacao = [
      { channel_id: 'c1', account_id: 'conta-1', whatsapp: 'conectado', ultimo_sinal_em: iso(AGORA - 30_000), ligado_em: LIGADO_EM, ...extra },
    ];
  }
  const semNada = () => lerEnviosRecentes.mockResolvedValue([]);

  it('ligado e sem sinal há 20 min, em horário útil: "fora do ar" para quem vê a conexão, desde o último sinal', async () => {
    const banco = montarBanco();
    semNada();
    comComputador(banco, { ultimo_sinal_em: iso(AGORA - 20 * MIN) });
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);
    expect(avisos(banco).map((a) => a.user_id).sort()).toEqual(['atende-c1', 'dono']);
    expect(String(avisos(banco)[0].title)).toBe('Ligações pelo CRM fora do ar: Comercial');
    expect(estadoDe(banco, 'c1', 'computador_fora')).toMatchObject({ desde: iso(AGORA - 20 * MIN), avisado_em: iso(AGORA) });
  });

  it('sem sinal há 5 min (a troca da imagem): nada — e com sinal fresco o episódio avisado normaliza', async () => {
    const banco = montarBanco();
    semNada();
    comComputador(banco, { ultimo_sinal_em: iso(AGORA - 5 * MIN) });
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);
    expect(avisos(banco)).toHaveLength(0);
    expect(estadoDe(banco, 'c1', 'computador_fora')).toBeUndefined();

    banco.tabelas.cb_alarmes_de_conexao.push({
      account_id: 'conta-1',
      channel_id: 'c1',
      tipo: 'computador_fora',
      desde: iso(AGORA - 60 * MIN),
      avisado_em: iso(AGORA - 40 * MIN),
      normalizou_em: null,
      devido_em: null,
      detalhe: {},
    });
    comComputador(banco);
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);
    expect(String(avisos(banco)[0].title)).toBe('Normalizou — Ligações pelo CRM fora do ar: Comercial');
    expect(estadoDe(banco, 'c1', 'computador_fora')).toBeUndefined();
  });

  it('pedindo o QR: o 1º ciclo só guarda; o aviso sai quando dura 10 min', async () => {
    const banco = montarBanco();
    semNada();
    comComputador(banco, { whatsapp: 'qr' });
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);
    expect(avisos(banco)).toHaveLength(0);
    expect(estadoDe(banco, 'c1', 'computador_qr')).toMatchObject({ desde: iso(AGORA), avisado_em: null });

    const depois = AGORA + 15 * MIN;
    comComputador(banco, { whatsapp: 'qr', ultimo_sinal_em: iso(depois - 30_000) });
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, depois);
    expect(String(avisos(banco)[0].title)).toBe('Ligações pelo CRM desconectadas do WhatsApp: Comercial');
  });

  it('⚠️ DESLIGADO (D16): nada acende, e o alarme aberto sai CALADO', async () => {
    const banco = montarBanco();
    semNada();
    comComputador(banco, { ultimo_sinal_em: iso(AGORA - 60 * MIN), ligado_em: null });
    banco.tabelas.cb_alarmes_de_conexao.push({
      account_id: 'conta-1',
      channel_id: 'c1',
      tipo: 'computador_fora',
      desde: iso(AGORA - 60 * MIN),
      avisado_em: iso(AGORA - 40 * MIN),
      normalizou_em: null,
      devido_em: null,
      detalhe: {},
    });
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);
    expect(avisos(banco)).toHaveLength(0);
    expect(estadoDe(banco, 'c1', 'computador_fora')).toBeUndefined();
  });

  it('fora do horário útil o sem sinal espera a abertura; a leitura dos computadores que falha não mexe em nada', async () => {
    const banco = montarBanco();
    semNada();
    comComputador(banco, { ultimo_sinal_em: iso(MADRUGADA - 20 * MIN) });
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, MADRUGADA);
    expect(avisos(banco)).toHaveLength(0);
    expect(estadoDe(banco, 'c1', 'computador_fora')).toMatchObject({ avisado_em: null });

    const outro = montarBanco();
    semNada();
    comComputador(outro, { ligado_em: null });
    outro.tabelas.cb_alarmes_de_conexao.push({
      account_id: 'conta-1',
      channel_id: 'c1',
      tipo: 'computador_qr',
      desde: iso(AGORA - 60 * MIN),
      avisado_em: null,
      normalizou_em: null,
      devido_em: null,
      detalhe: {},
    });
    outro.falhas['cb_computadores_de_ligacao.select'] = 'fora do ar';
    await avisarAlarmesDeConexao(outro as unknown as SupabaseClient, AGORA);
    expect(estadoDe(outro, 'c1', 'computador_qr')).toBeDefined();
  });
});
