import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnvioRecente } from './sem-recibo';

const { lerEnviosRecentes } = vi.hoisted(() => ({ lerEnviosRecentes: vi.fn() }));
vi.mock('./sem-recibo', async (original) => ({
  ...(await original<typeof import('./sem-recibo')>()),
  lerEnviosRecentes,
}));

import { avisarAlarmesDeConexao } from './avisar-alarmes';

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
        const achadas = linhas.filter(casa).slice(0, this.limite).map((l) => ({ ...l }));
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

  it('um aviso por EPISÓDIO: o ciclo seguinte, ainda aceso, não repete', async () => {
    const banco = montarBanco();
    lerEnviosRecentes.mockImplementation(async (_db: unknown, canal: string, agora: number) =>
      canal === 'c1' ? travada(agora) : [],
    );
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA + 15 * MIN);
    expect(avisos(banco)).toHaveLength(2); // o dono e quem atende a c1, uma vez
  });

  it('⚠️ o aviso que o sino recusou devolve o estado, e o ciclo seguinte tenta de novo', async () => {
    const banco = montarBanco();
    lerEnviosRecentes.mockImplementation(async (_db: unknown, canal: string, agora: number) =>
      canal === 'c1' ? travada(agora) : [],
    );
    banco.falhas['notifications.insert'] = 'recusado';
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);
    expect(avisos(banco)).toHaveLength(0);
    expect(estadoDe(banco, 'c1', 'sem_recibo')).toMatchObject({ avisado_em: null });

    delete banco.falhas['notifications.insert'];
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA + 15 * MIN);
    expect(avisos(banco)).toHaveLength(2);
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
      { account_id: 'conta-1', channel_id: 'c1', tipo: 'sem_recibo', desde, avisado_em: iso(AGORA - 60 * MIN), normalizou_em: null, detalhe: {} },
    ];
    lerEnviosRecentes.mockImplementation(async (_db: unknown, canal: string, agora: number) =>
      canal === 'c1' ? [envio(agora, 2, 'z', 'delivered'), ...travada(agora)] : [],
    );
    await avisarAlarmesDeConexao(banco as unknown as SupabaseClient, AGORA);
    expect(avisos(banco).map((a) => a.user_id).sort()).toEqual(['atende-c1', 'dono']);
    expect(String(avisos(banco)[0].title)).toMatch(/^Normalizou — /);
    expect(estadoDe(banco, 'c1', 'sem_recibo')).toBeUndefined();
  });

  it('de madrugada no sábado: o (b) avisa na hora; o (c) fica guardado para a abertura do horário', async () => {
    const banco = montarBanco();
    const c1 = (banco.tabelas.cb_channels as Linha[])[0];
    c1.entrega_carimbo_em = iso(MADRUGADA - 70 * MIN);
    c1.entrega_recebida_em = iso(MADRUGADA - 10 * MIN); // 60 min de atraso, medido há 10 min
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
