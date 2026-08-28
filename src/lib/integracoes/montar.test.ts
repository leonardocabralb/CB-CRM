import { describe, expect, it } from 'vitest';

import {
  montarCartoes,
  type CanalParaMontar,
  type ConfigParaMontar,
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

function config(parcial: Partial<ConfigParaMontar>): ConfigParaMontar {
  return {
    id: 'cfg-1',
    channelId: null,
    provider: 'gemini',
    model: 'gemini-3.5-flash',
    radarModel: null,
    isActive: true,
    teste: { ok: true },
    temEmbeddings: false,
    ...parcial,
  };
}

function montar(
  configs: ConfigParaMontar[],
  embeddingsTeste: Parameters<typeof montarCartoes>[2] = null,
  canais: CanalParaMontar[] = CANAIS
) {
  return montarCartoes(
    configs,
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
  modulo: UsoNoCartao['modulo'],
  modelo?: string
): UsoNoCartao {
  const usos = cartao(cartoes, id).usos.filter(
    (u) => u.modulo === modulo && (modelo === undefined || u.modelo === modelo)
  );
  if (usos.length !== 1) {
    throw new Error(
      `esperava 1 uso ${modulo}${modelo ? `/${modelo}` : ''} no cartão ${id}, achei ${usos.length}`
    );
  }
  return usos[0];
}

describe('montarCartoes', () => {
  it('sem nenhuma config, todos os provedores ficam não configurados e sem usos', () => {
    const cartoes = montar([]);
    for (const id of ['gemini', 'openai', 'anthropic', 'google_calendar']) {
      expect(cartao(cartoes, id).estado).toBe('nao_configurado');
      expect(cartao(cartoes, id).usos).toEqual([]);
    }
  });

  it('teste pendente vira "conferindo", não "erro" nem "ok"', () => {
    const cartoes = montar([config({ teste: null })]);
    expect(cartao(cartoes, 'gemini').estado).toBe('conferindo');
  });

  it('um agente com falha derruba o cartão do provedor para "erro"', () => {
    const cartoes = montar([
      config({ id: 'a', teste: { ok: true } }),
      config({
        id: 'b',
        channelId: 'canal-1',
        teste: { ok: false, motivo: 'invalid_key' },
      }),
    ]);
    expect(cartao(cartoes, 'gemini').estado).toBe('erro');
  });

  it('o Radar herda o modelo do agente e a origem diz isso', () => {
    const cartoes = montar([config({ model: 'gemini-3.7-flash' })]);
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
    const cartoes = montar([
      config({ model: 'gemini-3.5-flash', radarModel: 'gemini-3.7-flash' }),
    ]);
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
    // É o caso que originou a tela: chave cadastrada "para o Radar" e o
    // Radar desligado em todas as conexões. Sumir com a linha esconderia
    // exatamente o que o operador precisa descobrir.
    const semRadar = CANAIS.map((c) => ({ ...c, radarEnabled: false }));
    const cartoes = montar([config({})], null, semRadar);
    const radar = uso(cartoes, 'gemini', 'radar');
    expect(radar.indisponivel).toBe('radar_sem_canal');
    expect(radar.canais).toEqual([]);
  });

  it('linha de canal NÃO multiplica módulos: um modelo por módulo, da config padrão', () => {
    // Decisão de produto (2026-08-28): a configuração é por MÓDULO e vale
    // para a conta inteira. Mesmo que exista uma linha por canal no banco
    // (o schema da 903 permite; nenhuma tela cria), o cartão mostra UM
    // Radar, com o modelo do agente padrão.
    const cartoes = montar([
      config({ id: 'padrao', radarModel: 'gemini-3.7-flash' }),
      config({
        id: 'c1',
        channelId: 'canal-1',
        radarModel: null,
        model: 'gemini-3.6-flash',
      }),
    ]);
    const radares = cartao(cartoes, 'gemini').usos.filter(
      (u) => u.modulo === 'radar'
    );
    expect(radares).toHaveLength(1);
    expect(radares[0]).toMatchObject({
      modelo: 'gemini-3.7-flash',
      origem: 'proprio',
      canais: ['Comercial'],
      canaisDesligados: ['Pessoal'],
    });
  });

  it('a transcrição vale para a conta inteira: modelo fixo e SEM lista de canais', () => {
    const cartoes = montar([
      config({ id: 'g', provider: 'gemini' }),
      config({ id: 'o', provider: 'openai', model: 'gpt-x' }),
    ]);
    expect(uso(cartoes, 'gemini', 'transcricao')).toMatchObject({
      modelo: MODELO_TRANSCRICAO,
      origem: 'fixo',
      // ⚠️ Vazio de propósito: listar canais aqui sugeriria chave por
      // conexão, que é exatamente o modelo de produto descartado.
      canais: [],
    });
    expect(uso(cartoes, 'openai', 'transcricao').indisponivel).toBe(
      'transcricao_exige_gemini'
    );
  });

  it('agente desligado marca o uso de conversa, e só ele', () => {
    const cartoes = montar([config({ isActive: false })]);
    expect(uso(cartoes, 'gemini', 'conversa').indisponivel).toBe(
      'conversa_desligada'
    );
    // Radar e transcrição leem a config com requireActive false — o
    // interruptor não os afeta e a tela não pode dizer o contrário.
    expect(uso(cartoes, 'gemini', 'radar').indisponivel).toBeUndefined();
    expect(uso(cartoes, 'gemini', 'transcricao').indisponivel).toBeUndefined();
  });

  it('embeddings aparecem SÓ no cartão openai, com modelo fixo, e contam no estado dele', () => {
    // Chave de embeddings numa config cujo provider de CHAT é gemini:
    // o RAG é OpenAI-only, então o uso (e a falha) pertence ao cartão
    // openai — mesmo sem nenhum agente de chat openai.
    const cartoes = montar(
      [config({ provider: 'gemini', temEmbeddings: true })],
      { ok: false, motivo: '401' }
    );
    const openai = cartao(cartoes, 'openai');
    expect(openai.estado).toBe('erro');
    expect(uso(cartoes, 'openai', 'rag')).toMatchObject({
      modelo: MODELO_EMBEDDINGS,
      origem: 'fixo',
    });
    expect(cartao(cartoes, 'gemini').usos.some((u) => u.modulo === 'rag')).toBe(
      false
    );
    // O cartão gemini não herda a falha do embeddings.
    expect(cartao(cartoes, 'gemini').estado).toBe('ok');
  });

  it('agente de canal carrega o rótulo do canal', () => {
    const cartoes = montar([config({ channelId: 'canal-1' })]);
    expect(cartao(cartoes, 'gemini').agentes[0]).toMatchObject({
      escopo: 'canal',
      canalLabel: 'Comercial',
    });
  });
});
