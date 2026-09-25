import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  montarCartoes,
  type CanalParaMontar,
  type ChaveParaMontar,
  type PadraoParaMontar,
  type Teste,
  type UsoNoCartao,
} from './montar';

const CANAIS: CanalParaMontar[] = [
  { id: 'canal-1', label: 'Comercial', radarEnabled: true },
  { id: 'canal-2', label: 'Pessoal', radarEnabled: false },
];

// As constantes de modelo fixo entram por parâmetro (a fonte real é o
// módulo que as usa); nos testes bastam valores reconhecíveis.
const MODELO_TRANSCRICAO = 'modelo-transcricao-teste';
const MODELO_EMBEDDINGS = 'modelo-embeddings-teste';

function chave(
  provedor: ChaveParaMontar['provedor'],
  teste: Teste = { ok: true }
): ChaveParaMontar {
  return { provedor, existe: true, teste };
}

function padrao(parcial: Partial<PadraoParaMontar> = {}): PadraoParaMontar {
  return {
    provider: 'gemini',
    model: 'gemini-3.5-flash',
    radarModel: null,
    isActive: true,
    ...parcial,
  };
}

function montar(
  chaves: ChaveParaMontar[],
  linhaPadrao: PadraoParaMontar | null = padrao(),
  embeddingsTeste: Teste = null,
  canais: CanalParaMontar[] = CANAIS
) {
  return montarCartoes(
    chaves,
    linhaPadrao,
    canais,
    embeddingsTeste,
    MODELO_TRANSCRICAO,
    MODELO_EMBEDDINGS
  );
}

function cartao(cartoes: ReturnType<typeof montarCartoes>, id: string) {
  const c = cartoes.find((x) => x.id === id);
  if (!c) throw new Error(`cartão ${id} não montado`);
  return c;
}

function uso(
  cartoes: ReturnType<typeof montarCartoes>,
  id: string,
  modulo: UsoNoCartao['modulo']
): UsoNoCartao {
  const usos = cartao(cartoes, id).usos.filter((u) => u.modulo === modulo);
  if (usos.length !== 1) {
    throw new Error(`esperava 1 uso ${modulo} no cartão ${id}, achei ${usos.length}`);
  }
  return usos[0];
}

describe('montarCartoes — chave por PROVEDOR (1042)', () => {
  it('sem chave nenhuma, todos os provedores ficam não configurados', () => {
    const cartoes = montar([], null);
    for (const id of ['gemini', 'openai', 'anthropic', 'google_calendar']) {
      expect(cartao(cartoes, id).estado).toBe('nao_configurado');
      expect(cartao(cartoes, id).temChave).toBe(false);
    }
  });

  it('o cartão existe pela CHAVE, não por um agente: OpenAI com chave e sem agente fica "ok"', () => {
    const cartoes = montar([chave('gemini'), chave('openai')], padrao(), {
      ok: true,
    });
    expect(cartao(cartoes, 'openai')).toMatchObject({
      estado: 'ok',
      temChave: true,
      agentes: [],
    });
  });

  it('teste pendente vira "conferindo", não "erro" nem "ok"', () => {
    const cartoes = montar([chave('gemini', null)]);
    expect(cartao(cartoes, 'gemini').estado).toBe('conferindo');
  });

  it('ping com falha pinta o cartão de "erro"', () => {
    const cartoes = montar([chave('gemini', { ok: false, motivo: 'invalid_key' })]);
    expect(cartao(cartoes, 'gemini').estado).toBe('erro');
  });

  it('o Radar e o assistente ficam no cartão do provedor da linha PADRÃO', () => {
    const cartoes = montar([chave('gemini'), chave('openai')], padrao());
    expect(cartao(cartoes, 'gemini').ehDoRadar).toBe(true);
    expect(cartao(cartoes, 'openai').ehDoRadar).toBe(false);
    expect(cartao(cartoes, 'openai').usos.some((u) => u.modulo === 'radar')).toBe(false);
    expect(cartao(cartoes, 'gemini').agentes).toHaveLength(1);
  });

  it('o Radar herda o modelo do agente e a origem diz isso', () => {
    const cartoes = montar([chave('gemini')], padrao({ model: 'gemini-3.7-flash' }));
    const radar = uso(cartoes, 'gemini', 'radar');
    expect(radar).toMatchObject({
      modelo: 'gemini-3.7-flash',
      origem: 'agente',
      canais: ['Comercial'],
      canaisDesligados: ['Pessoal'],
    });
    expect(radar.indisponivel).toBeUndefined();
  });

  it('radar_model preenchido vira modelo próprio, sem tocar o do assistente', () => {
    const cartoes = montar(
      [chave('gemini')],
      padrao({ model: 'gemini-3.5-flash', radarModel: 'gemini-3.7-flash' })
    );
    expect(uso(cartoes, 'gemini', 'radar')).toMatchObject({
      modelo: 'gemini-3.7-flash',
      origem: 'proprio',
    });
    expect(uso(cartoes, 'gemini', 'conversa')).toMatchObject({
      modelo: 'gemini-3.5-flash',
      origem: 'agente',
    });
  });

  it('Radar sem NENHUM canal ligado continua na lista, marcado', () => {
    const semRadar = CANAIS.map((c) => ({ ...c, radarEnabled: false }));
    const cartoes = montar([chave('gemini')], padrao(), null, semRadar);
    const radar = uso(cartoes, 'gemini', 'radar');
    expect(radar.indisponivel).toBe('radar_sem_canal');
    expect(radar.canais).toEqual([]);
  });

  it('a transcrição mora no cartão do GEMINI, mesmo com o Radar em outro provedor', () => {
    // Desde a 1042 a transcrição lê a chave do Gemini direto — não depende
    // do provedor da linha padrão.
    const cartoes = montar(
      [chave('gemini'), chave('openai')],
      padrao({ provider: 'openai', model: 'gpt-x' })
    );
    expect(uso(cartoes, 'gemini', 'transcricao')).toMatchObject({
      modelo: MODELO_TRANSCRICAO,
      origem: 'fixo',
      canais: [],
    });
    expect(uso(cartoes, 'gemini', 'transcricao').indisponivel).toBeUndefined();
    expect(cartao(cartoes, 'openai').usos.some((u) => u.modulo === 'transcricao')).toBe(
      false
    );
  });

  it('SEM a chave, o módulo continua na lista, marcado "precisa da chave"', () => {
    // É quando o operador mais precisa descobrir o que a chave destrava.
    const cartoes = montar([], padrao());
    expect(uso(cartoes, 'gemini', 'transcricao').indisponivel).toBe('sem_chave');
    expect(uso(cartoes, 'gemini', 'radar').indisponivel).toBe('sem_chave');
    expect(uso(cartoes, 'openai', 'rag').indisponivel).toBe('sem_chave');
  });

  it('agente desligado marca o uso de conversa, e só ele', () => {
    const cartoes = montar([chave('gemini')], padrao({ isActive: false }));
    expect(uso(cartoes, 'gemini', 'conversa').indisponivel).toBe('conversa_desligada');
    expect(uso(cartoes, 'gemini', 'radar').indisponivel).toBeUndefined();
    expect(uso(cartoes, 'gemini', 'transcricao').indisponivel).toBeUndefined();
  });

  it('a base de conhecimento fica no cartão da OpenAI e a falha do embeddings conta só nele', () => {
    const cartoes = montar([chave('gemini'), chave('openai')], padrao(), {
      ok: false,
      motivo: 'invalid_key',
    });
    expect(cartao(cartoes, 'openai').estado).toBe('erro');
    expect(uso(cartoes, 'openai', 'rag')).toMatchObject({
      modelo: MODELO_EMBEDDINGS,
      origem: 'fixo',
    });
    expect(cartao(cartoes, 'gemini').usos.some((u) => u.modulo === 'rag')).toBe(false);
    expect(cartao(cartoes, 'gemini').estado).toBe('ok');
  });
});

describe('rótulos montados de Integrações', () => {
  // `modulo.${…}` e `indisponivel.${…}` são chaves MONTADAS no painel:
  // escapam do portão de i18n do CI. O compilador não cobra o dicionário.
  const MODULOS: UsoNoCartao['modulo'][] = ['conversa', 'radar', 'transcricao', 'rag'];
  const INDISPONIVEIS: NonNullable<UsoNoCartao['indisponivel']>[] = [
    'radar_sem_canal',
    'conversa_desligada',
    'sem_chave',
  ];
  for (const arquivo of ['en.json', 'pt-BR.json']) {
    it(`existem em ${arquivo}`, () => {
      const dic = JSON.parse(
        readFileSync(join(process.cwd(), 'messages', arquivo), 'utf8')
      ) as { Settings: { integracoes: Record<string, Record<string, string>> } };
      const integracoes = dic.Settings.integracoes;
      for (const m of MODULOS) expect(integracoes.modulo[m], m).toBeTruthy();
      for (const i of INDISPONIVEIS) expect(integracoes.indisponivel[i], i).toBeTruthy();
    });
  }
});
