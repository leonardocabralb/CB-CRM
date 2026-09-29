import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import {
  __reiniciarParaTeste,
  agendarMovimento,
  aoConcluirMovimento,
  concluirAgora,
  concluirTodosAgora,
  type Conclusao,
  desfazerMovimento,
  desistirDoMovimento,
  ESPERA_PARA_DESFAZER_MS,
  FOLGA_DA_RETOMADA_MS,
  fotoDoMovimento,
  INTERVALO_DE_NOVA_TENTATIVA_MS,
  MAXIMO_DE_TENTATIVAS_NA_PAGINA,
  type PedidoDeMovimento,
  retomarMovimentosPendentes,
  TEMPO_DO_AVISO_MS,
  tentarAgora,
} from './mover-com-desfazer';

// ⚠️ O que este arquivo protege é a decisão do operador (29/09/2026): o
// movimento só pode deixar de acontecer por "Desfazer". Sair da página,
// atualizar ou perder a conexão no meio da espera não pode perdê-lo.

const USUARIO = 'usuario-1';
const pedido = (dealId = 'negocio-1', para = 'etapa-b'): PedidoDeMovimento => ({
  dealId,
  de: 'etapa-a',
  para,
  textos: { movido: 'movido', mudou: 'mudou', falhou: 'falhou', tentandoDeNovo: 'tentando de novo' },
});

type Resposta = { ok: boolean; status: number; corpo?: unknown } | 'rede';

let respostas: Resposta[];
let enviar: Mock<(url: string, init: { body: string; keepalive?: boolean }) => Promise<Response>>;
let guardado: Map<string, string>;
let sucesso: Mock<(texto: string) => void>;
let erro: Mock<(texto: string) => void>;
let drenar: Mock<() => void>;
let conclusoes: Conclusao[];

beforeEach(() => {
  vi.useFakeTimers();
  respostas = [];
  guardado = new Map();
  sucesso = vi.fn<(texto: string) => void>();
  erro = vi.fn<(texto: string) => void>();
  drenar = vi.fn<() => void>();
  conclusoes = [];
  enviar = vi.fn<(url: string, init: { body: string; keepalive?: boolean }) => Promise<Response>>(async () => {
    const r = respostas.shift() ?? { ok: true, status: 200, corpo: { stage_id: 'etapa-b', status: 'open' } };
    if (r === 'rede') throw new TypeError('Failed to fetch');
    return { ok: r.ok, status: r.status, json: async () => r.corpo ?? {} } as Response;
  });
  __reiniciarParaTeste({
    agora: () => Date.now(),
    enviar: enviar as unknown as typeof fetch,
    armazenamento: () => ({
      getItem: (k) => guardado.get(k) ?? null,
      setItem: (k, v) => void guardado.set(k, v),
      removeItem: (k) => void guardado.delete(k),
    }),
    sucesso,
    erro,
    drenar,
  });
  aoConcluirMovimento((c) => conclusoes.push(c));
});

afterEach(() => {
  __reiniciarParaTeste();
  vi.useRealTimers();
});

const fila = () => JSON.parse(guardado.get(`cb-movimentos-pendentes:${USUARIO}`) ?? '[]') as unknown[];
const esperar = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};

describe('a janela de desfazer', () => {
  it('nada sai antes dos 4 s; depois, o card é movido pela rota, com keepalive', async () => {
    agendarMovimento(pedido(), USUARIO);
    expect(fotoDoMovimento('negocio-1')).toMatchObject({ fase: 'aguardando', para: 'etapa-b' });
    await esperar(ESPERA_PARA_DESFAZER_MS - 1);
    expect(enviar).not.toHaveBeenCalled();

    await esperar(1);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar).toHaveBeenCalledWith(
      '/api/cb/negocios/negocio-1/mover',
      expect.objectContaining({ method: 'POST', keepalive: true }),
    );
    expect(JSON.parse(enviar.mock.calls[0][1].body)).toEqual({ de: 'etapa-a', para: 'etapa-b' });
    expect(fotoDoMovimento('negocio-1')).toEqual({ fase: 'movido', para: 'etapa-b' });
    expect(conclusoes).toEqual([
      { dealId: 'negocio-1', resultado: { tipo: 'movido', stageId: 'etapa-b', status: 'open' } },
    ]);
    // As automações da etapa rodam agora, não no ciclo do agendador.
    expect(drenar).toHaveBeenCalledTimes(1);
    // Na tela, o aviso é a linha do cartão — sem toast.
    expect(sucesso).not.toHaveBeenCalled();
    expect(fila()).toEqual([]);

    await esperar(TEMPO_DO_AVISO_MS);
    expect(fotoDoMovimento('negocio-1')).toBeNull();
  });

  it('Desfazer dentro da janela: nada sai, nada fica guardado', async () => {
    agendarMovimento(pedido(), USUARIO);
    expect(fila()).toHaveLength(1);
    expect(desfazerMovimento('negocio-1')).toBe(true);
    await esperar(ESPERA_PARA_DESFAZER_MS * 3);
    expect(enviar).not.toHaveBeenCalled();
    expect(fila()).toEqual([]);
    expect(conclusoes).toEqual([]);
    // Desfazer depois que saiu não finge ter desfeito.
    expect(desfazerMovimento('negocio-1')).toBe(false);
  });
});

describe('sair antes do prazo conclui NA HORA', () => {
  it('trocar de conversa ou desmontar: concluirAgora envia já, e o aviso vira toast', async () => {
    agendarMovimento(pedido(), USUARIO);
    concluirAgora('negocio-1', { avisarPorToast: true });
    await esperar(0);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(sucesso).toHaveBeenCalledWith('movido');
    await esperar(ESPERA_PARA_DESFAZER_MS);
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('atualizar, fechar a aba, ir para o fundo no celular: concluirTodosAgora envia todos', async () => {
    agendarMovimento(pedido('negocio-1'), USUARIO);
    agendarMovimento(pedido('negocio-2'), USUARIO);
    concluirTodosAgora();
    await esperar(0);
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(enviar.mock.calls.every((c) => c[1].keepalive === true)).toBe(true);
  });
});

describe('a resposta da rota', () => {
  it('409 com o card JÁ na etapa de destino conta como feito (outra aba, a retomada, um colega)', async () => {
    respostas.push({ ok: false, status: 409, corpo: { error: 'etapa_mudou', stage_id: 'etapa-b', status: 'open' } });
    agendarMovimento(pedido(), USUARIO);
    await esperar(ESPERA_PARA_DESFAZER_MS);
    expect(erro).not.toHaveBeenCalled();
    expect(conclusoes[0].resultado).toEqual({ tipo: 'movido', stageId: 'etapa-b', status: 'open' });
  });

  it('409 com o card em OUTRA etapa: nada é feito, e o operador é avisado', async () => {
    respostas.push({ ok: false, status: 409, corpo: { error: 'etapa_mudou', stage_id: 'etapa-c' } });
    agendarMovimento(pedido(), USUARIO);
    await esperar(ESPERA_PARA_DESFAZER_MS);
    expect(erro).toHaveBeenCalledWith('mudou');
    expect(conclusoes[0].resultado).toEqual({ tipo: 'mudou', stageId: 'etapa-c' });
    expect(fotoDoMovimento('negocio-1')).toBeNull();
    expect(drenar).not.toHaveBeenCalled();
    expect(fila()).toEqual([]);
  });

  it('recusa DEFINITIVA (400, 404): avisa e tira da fila — tentar de novo daria o mesmo', async () => {
    for (const status of [400, 404]) {
      respostas.push({ ok: false, status });
      agendarMovimento(pedido(), USUARIO);
      await esperar(ESPERA_PARA_DESFAZER_MS);
      expect(erro).toHaveBeenLastCalledWith('falhou');
      expect(fila()).toEqual([]);
    }
  });
});

describe('a reserva no aparelho', () => {
  it('falha PROVISÓRIA (sem rede, 5xx de um deploy): o pedido FICA, e a página tenta de novo sozinha (Codex, PR #340)', async () => {
    respostas.push('rede', { ok: false, status: 502 }, { ok: false, status: 500 });
    agendarMovimento(pedido(), USUARIO);
    await esperar(ESPERA_PARA_DESFAZER_MS);
    expect(erro).toHaveBeenCalledWith('tentando de novo');
    expect(fila()).toHaveLength(1);
    expect(conclusoes).toEqual([]);
    // O card fica TRAVADO mostrando o pedido — os botões não voltam.
    expect(fotoDoMovimento('negocio-1')).toEqual({ fase: 'tentando', para: 'etapa-b' });

    await esperar(INTERVALO_DE_NOVA_TENTATIVA_MS);
    expect(enviar).toHaveBeenCalledTimes(2);
    await esperar(INTERVALO_DE_NOVA_TENTATIVA_MS);
    expect(enviar).toHaveBeenCalledTimes(3);
    // O aviso sai uma vez só, não a cada tentativa.
    expect(erro).toHaveBeenCalledTimes(1);
    expect(fila()).toHaveLength(1);

    await esperar(INTERVALO_DE_NOVA_TENTATIVA_MS);
    expect(enviar).toHaveBeenCalledTimes(4);
    expect(fila()).toEqual([]);
    // A nova tentativa fez o movimento: o toast diz, porque a linha pode nem estar à vista.
    expect(sucesso).toHaveBeenCalledWith('movido');
    expect(conclusoes[0].resultado.tipo).toBe('movido');
  });

  it(`servidor que falha SEMPRE: no máximo ${MAXIMO_DE_TENTATIVAS_NA_PAGINA} tentativas sozinhas; a volta à aba ainda tenta`, async () => {
    enviar.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response);
    agendarMovimento(pedido(), USUARIO);
    await esperar(ESPERA_PARA_DESFAZER_MS + INTERVALO_DE_NOVA_TENTATIVA_MS * (MAXIMO_DE_TENTATIVAS_NA_PAGINA + 5));
    expect(enviar).toHaveBeenCalledTimes(MAXIMO_DE_TENTATIVAS_NA_PAGINA);
    expect(fila()).toHaveLength(1);

    retomarMovimentosPendentes(USUARIO);
    await esperar(0);
    expect(enviar).toHaveBeenCalledTimes(MAXIMO_DE_TENTATIVAS_NA_PAGINA + 1);
    expect(fila()).toHaveLength(1);
  });

  it('pedido guardado NÃO é substituído por um clique novo (Codex, PR #340)', async () => {
    respostas.push({ ok: false, status: 503 });
    agendarMovimento(pedido('negocio-1', 'etapa-b'), USUARIO);
    await esperar(ESPERA_PARA_DESFAZER_MS);
    expect(fila()).toHaveLength(1);
    expect(agendarMovimento(pedido('negocio-1', 'etapa-c'), USUARIO)).toBe(false);
    const guardados = fila() as { para: string }[];
    expect(guardados.map((e) => e.para)).toEqual(['etapa-b']);
  });

  it('Desistir: a decisão explícita tira o pedido e destrava o card; Tentar agora manda já', async () => {
    respostas.push({ ok: false, status: 503 });
    agendarMovimento(pedido(), USUARIO);
    await esperar(ESPERA_PARA_DESFAZER_MS);
    tentarAgora('negocio-1', USUARIO);
    await esperar(0);
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(fila()).toEqual([]);

    respostas.push({ ok: false, status: 503 });
    agendarMovimento(pedido(), USUARIO);
    await esperar(ESPERA_PARA_DESFAZER_MS);
    expect(desistirDoMovimento('negocio-1', USUARIO)).toBe(true);
    expect(fila()).toEqual([]);
    expect(fotoDoMovimento('negocio-1')).toBeNull();
    await esperar(INTERVALO_DE_NOVA_TENTATIVA_MS * 3);
    expect(enviar).toHaveBeenCalledTimes(3);
  });

  it('Desistir com um envio no ar que falha: o card destrava, e nada volta a tentar', async () => {
    let soltar: (r: Response) => void = () => {};
    enviar.mockImplementationOnce(() => new Promise<Response>((r) => (soltar = r)));
    respostas.push({ ok: false, status: 503 });
    agendarMovimento(pedido(), USUARIO);
    await esperar(ESPERA_PARA_DESFAZER_MS);
    await esperar(INTERVALO_DE_NOVA_TENTATIVA_MS);
    // Na segunda tentativa, com o envio ainda no ar, a pessoa desiste.
    expect(desistirDoMovimento('negocio-1', USUARIO)).toBe(true);
    soltar({ ok: false, status: 503, json: async () => ({}) } as Response);
    await esperar(0);
    expect(fotoDoMovimento('negocio-1')).toBeNull();
    const envios = enviar.mock.calls.length;
    await esperar(INTERVALO_DE_NOVA_TENTATIVA_MS * 3);
    expect(enviar).toHaveBeenCalledTimes(envios);
  });

  it('sessão vencida (401) e conta ilegível (403) também ficam: nada foi decidido (Codex, PR #340)', async () => {
    for (const status of [401, 403]) {
      __reiniciarParaTeste({
        agora: () => Date.now(),
        enviar: enviar as unknown as typeof fetch,
        armazenamento: () => ({
          getItem: (k) => guardado.get(k) ?? null,
          setItem: (k, v) => void guardado.set(k, v),
          removeItem: (k) => void guardado.delete(k),
        }),
        sucesso,
        erro,
        drenar,
      });
      guardado.clear();
      respostas.push({ ok: false, status });
      agendarMovimento(pedido(), USUARIO);
      await esperar(ESPERA_PARA_DESFAZER_MS);
      expect(fila()).toHaveLength(1);
      expect(fotoDoMovimento('negocio-1')).toEqual({ fase: 'tentando', para: 'etapa-b' });
    }
  });

  it('duas abas: o card travado pelo pedido da OUTRA aba destrava quando ela conclui (Codex, PR #340)', async () => {
    // A outra aba está na janela de desfazer: o pedido está no aparelho.
    const agora = Date.now();
    guardado.set(
      `cb-movimentos-pendentes:${USUARIO}`,
      JSON.stringify([{ id: 'da-outra', dealId: 'negocio-1', de: 'etapa-a', para: 'etapa-b', prazo: agora + 2000, textos: pedido().textos }]),
    );
    retomarMovimentosPendentes(USUARIO);
    expect(fotoDoMovimento('negocio-1')).toEqual({ fase: 'tentando', para: 'etapa-b' });
    // A outra aba concluiu (ou desfez) e tirou o pedido da fila.
    guardado.delete(`cb-movimentos-pendentes:${USUARIO}`);
    await esperar(2000 + FOLGA_DA_RETOMADA_MS);
    expect(fotoDoMovimento('negocio-1')).toBeNull();
    expect(enviar).not.toHaveBeenCalled();
  });

  it('Tentar agora num card cujo pedido já saiu da fila: destrava em vez de não fazer nada', async () => {
    respostas.push({ ok: false, status: 503 });
    agendarMovimento(pedido(), USUARIO);
    await esperar(ESPERA_PARA_DESFAZER_MS);
    expect(fotoDoMovimento('negocio-1')?.fase).toBe('tentando');
    // Outra aba concluiu: a fila do aparelho não tem mais o pedido.
    guardado.delete(`cb-movimentos-pendentes:${USUARIO}`);
    tentarAgora('negocio-1', USUARIO);
    expect(fotoDoMovimento('negocio-1')).toBeNull();
  });

  it('depois de recarregar, refaz o que ficou — mas só depois da folga (a aba dona pode estar viva)', async () => {
    agendarMovimento(pedido(), USUARIO);
    // A página morreu no meio da espera: o estado em memória some, a fila fica.
    const guardadoAntes = new Map(guardado);
    __reiniciarParaTeste({
      agora: () => Date.now(),
      enviar: enviar as unknown as typeof fetch,
      armazenamento: () => ({
        getItem: (k) => guardadoAntes.get(k) ?? null,
        setItem: (k, v) => void guardadoAntes.set(k, v),
        removeItem: (k) => void guardadoAntes.delete(k),
      }),
      sucesso,
      erro,
      drenar,
    });
    retomarMovimentosPendentes(USUARIO);
    // O pedido guardado trava o card desde a abertura, mesmo antes da folga.
    expect(fotoDoMovimento('negocio-1')).toEqual({ fase: 'tentando', para: 'etapa-b' });
    await esperar(ESPERA_PARA_DESFAZER_MS);
    expect(enviar).not.toHaveBeenCalled();

    await esperar(FOLGA_DA_RETOMADA_MS);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(JSON.parse(enviar.mock.calls[0][1].body)).toEqual({ de: 'etapa-a', para: 'etapa-b' });
    expect(guardadoAntes.size).toBe(0);
  });

  it('retomada que acha o card já no destino (o envio da página que fechou chegou): limpa, sem toast', async () => {
    respostas.push({ ok: false, status: 409, corpo: { error: 'etapa_mudou', stage_id: 'etapa-b' } });
    guardado.set(
      `cb-movimentos-pendentes:${USUARIO}`,
      JSON.stringify([{ id: 'z', dealId: 'negocio-1', de: 'etapa-a', para: 'etapa-b', prazo: 0, textos: pedido().textos }]),
    );
    retomarMovimentosPendentes(USUARIO);
    await esperar(0);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(sucesso).not.toHaveBeenCalled();
    expect(erro).not.toHaveBeenCalled();
    expect(fila()).toEqual([]);
  });

  it('a retomada nunca manda o pedido que ainda está na janela DESTA aba', async () => {
    agendarMovimento(pedido(), USUARIO);
    await esperar(ESPERA_PARA_DESFAZER_MS - 1);
    retomarMovimentosPendentes(USUARIO);
    await esperar(0);
    expect(enviar).not.toHaveBeenCalled();
    expect(desfazerMovimento('negocio-1')).toBe(true);
  });

  it('o que está no aparelho é lido, não confiado: item estragado é ignorado', async () => {
    guardado.set(
      `cb-movimentos-pendentes:${USUARIO}`,
      JSON.stringify([
        { id: 'x', dealId: 'negocio-9', de: 'a', para: 'b', prazo: 'ontem', textos: {} },
        null,
        { id: 'y', dealId: 'negocio-8', de: 'a', para: 'b', prazo: 0, textos: pedido().textos },
      ]),
    );
    retomarMovimentosPendentes(USUARIO);
    await esperar(0);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar.mock.calls[0][0]).toBe('/api/cb/negocios/negocio-8/mover');
  });

  it('aparelho que LÊ mas não grava (cota cheia): a memória segura a nova tentativa (Codex, PR #340)', async () => {
    guardado.set(`cb-movimentos-pendentes:${USUARIO}`, '[]');
    __reiniciarParaTeste({
      agora: () => Date.now(),
      enviar: enviar as unknown as typeof fetch,
      armazenamento: () => ({
        getItem: (k) => guardado.get(k) ?? null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
        removeItem: (k) => void guardado.delete(k),
      }),
      sucesso,
      erro,
      drenar,
    });
    aoConcluirMovimento((c) => conclusoes.push(c));
    respostas.push({ ok: false, status: 503 });
    agendarMovimento(pedido(), USUARIO);
    await esperar(ESPERA_PARA_DESFAZER_MS);
    expect(fotoDoMovimento('negocio-1')?.fase).toBe('tentando');
    await esperar(INTERVALO_DE_NOVA_TENTATIVA_MS);
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(conclusoes[0]?.resultado.tipo).toBe('movido');
  });

  it('armazenamento indisponível (modo privado): o movimento acontece do mesmo jeito', async () => {
    __reiniciarParaTeste({
      agora: () => Date.now(),
      enviar: enviar as unknown as typeof fetch,
      armazenamento: () => {
        throw new Error('SecurityError');
      },
      sucesso,
      erro,
      drenar,
    });
    aoConcluirMovimento((c) => conclusoes.push(c));
    respostas.push('rede');
    agendarMovimento(pedido(), USUARIO);
    await esperar(ESPERA_PARA_DESFAZER_MS);
    expect(enviar).toHaveBeenCalledTimes(1);
    // A nova tentativa acha o pedido na cópia em memória.
    await esperar(INTERVALO_DE_NOVA_TENTATIVA_MS);
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(conclusoes[0]?.resultado.tipo).toBe('movido');
  });
});
