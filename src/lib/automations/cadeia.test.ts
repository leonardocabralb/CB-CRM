import { describe, expect, it } from 'vitest';

import { chaveDeAutomacao, chaveDeFluxo, encadear, lerCadeia } from './cadeia';
import { validateStepsForActivation } from './validate';

// ------------------------------------------------------------
// A guarda anti-ciclo (D13).
//
// O operador recusou teto de profundidade — esteira comercial longa é
// legítima e um teto de 5 a quebraria em silêncio. A guarda é anti-ciclo: a
// mesma cadeia não passa duas vezes pelo mesmo lugar.
//
// Sem ela, "A aciona B, B aciona A" manda mensagem ao cliente a cada volta,
// para sempre. Não é hipótese: o laço equivalente no funil foi montado de
// propósito em produção (2026-08-03) e só parou por causa desta guarda.
// ------------------------------------------------------------

const A = chaveDeAutomacao('auto-a');
const B = chaveDeAutomacao('auto-b');
const C = chaveDeAutomacao('auto-c');

describe('encadear', () => {
  it('cadeia vazia deixa passar — é o começo da história', () => {
    // Disparo de gente, de conexão ou do relógio. Barrar aqui não impediria
    // laço nenhum e mataria a feature inteira.
    const r = encadear([], A, B);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cadeia).toEqual([A, B]);
  });

  it('CRÍTICO: A acionando A é barrado já na PRIMEIRA volta', () => {
    // A origem entra na cadeia ANTES da conferência. Sem isso, o
    // autoacionamento só seria barrado na segunda passada — depois de uma
    // execução inteira à toa, com as mensagens dela já enviadas ao cliente.
    const r = encadear([], A, A);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('ciclo');
  });

  it('CRÍTICO: A→B→A para na volta seguinte', () => {
    const ida = encadear([], A, B);
    expect(ida.ok).toBe(true);
    if (!ida.ok) return;
    // Agora B tenta voltar para A, carregando a cadeia que recebeu.
    const volta = encadear(ida.cadeia, B, A);
    expect(volta.ok).toBe(false);
    if (!volta.ok) expect(volta.motivo).toContain(A);
  });

  it('esteira LONGA de alvos distintos passa — não há teto (D13)', () => {
    // A regra que o operador pediu: 20 passos encadeados são legítimos.
    let cadeia: string[] = [];
    let anterior = chaveDeAutomacao('inicio');
    for (let i = 0; i < 20; i++) {
      const alvo = chaveDeAutomacao(`etapa-${i}`);
      const r = encadear(cadeia, anterior, alvo);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      cadeia = r.cadeia;
      anterior = alvo;
    }
    expect(cadeia.length).toBe(21);
  });

  it('a origem não é duplicada quando já está na cadeia', () => {
    // A mesma automação com DOIS passos `run_automation` — legítimo: aciona
    // B e depois C. A cadeia não pode inchar com A repetido a cada passo.
    const primeiro = encadear([], A, B);
    expect(primeiro.ok).toBe(true);
    if (!primeiro.ok) return;
    const segundo = encadear(primeiro.cadeia, A, C);
    expect(segundo.ok).toBe(true);
    if (!segundo.ok) return;
    expect(segundo.cadeia.filter((k) => k === A).length).toBe(1);
    expect(segundo.cadeia).toEqual([A, B, C]);
  });

  it('automação e robô não colidem de chave', () => {
    // Mesmo UUID em tabelas diferentes: sem o prefixo, acionar o robô X a
    // partir da automação X seria lido como ciclo e recusado.
    expect(chaveDeAutomacao('mesmo-id')).not.toBe(chaveDeFluxo('mesmo-id'));
    const r = encadear([], chaveDeAutomacao('mesmo-id'), chaveDeFluxo('mesmo-id'));
    expect(r.ok).toBe(true);
  });

  it('o mesmo robô não é acionado duas vezes na mesma cadeia', () => {
    // A segunda partida SUBSTITUIRIA a run que a primeira acabou de criar
    // (D11) — o cliente veria o robô recomeçar do zero no meio do menu.
    const F = chaveDeFluxo('robo-vendas');
    const primeiro = encadear([], A, F);
    expect(primeiro.ok).toBe(true);
    if (!primeiro.ok) return;
    expect(encadear(primeiro.cadeia, B, F).ok).toBe(false);
  });
});

describe('lerCadeia', () => {
  it('sem vars, sem cadeia — não estoura', () => {
    expect(lerCadeia(undefined)).toEqual([]);
    expect(lerCadeia({})).toEqual([]);
  });

  it('descarta o que não é texto', () => {
    // O valor vem de JSONB, onde qualquer coisa pode ter sido gravada — por
    // outra versão do código, ou à mão no SQL.
    expect(lerCadeia({ _cadeia: [A, 42, null, B, { x: 1 }] })).toEqual([A, B]);
  });

  it('valor que não é lista vira lista vazia', () => {
    expect(lerCadeia({ _cadeia: 'automation:a' })).toEqual([]);
  });
});

// ------------------------------------------------------------
// Validação dos passos novos (936).
//
// O que se valida no SAVE é a FORMA. O estado do alvo (existe? é da conta?
// está ativo?) é conferido no DISPARO, de propósito: uma automação alvo pode
// ser desativada depois, e uma validação que passou ontem afirmaria hoje uma
// coisa falsa.
// ------------------------------------------------------------

describe('validateSteps — orquestração', () => {
  it('run_automation sem alvo é recusado', () => {
    const issues = validateStepsForActivation([
      { step_type: 'run_automation', step_config: {} },
    ]);
    expect(issues.map((i) => i.message).join(' ')).toContain('automation is required');
  });

  it('stop_automation sem alvo é recusado', () => {
    const issues = validateStepsForActivation([
      { step_type: 'stop_automation', step_config: { automation_id: '  ' } },
    ]);
    expect(issues).toHaveLength(1);
  });

  it('run_flow sem robô é recusado', () => {
    const issues = validateStepsForActivation([{ step_type: 'run_flow', step_config: {} }]);
    expect(issues.map((i) => i.message).join(' ')).toContain('flow is required');
  });

  it('stop_flow passa sem config — não há o que escolher', () => {
    // Só existe uma run ativa por contato (`idx_one_active_run_per_contact`).
    expect(validateStepsForActivation([{ step_type: 'stop_flow', step_config: {} }])).toHaveLength(0);
  });

  it('CRÍTICO: set_ai sem booleano é recusado', () => {
    // O motor lê `!cfg.enabled`, então um valor ausente viraria "DESLIGAR" em
    // silêncio — o oposto do padrão do passo recém-arrastado, que nasce
    // ligando. Falharia calando o robô sem ninguém ter pedido.
    expect(validateStepsForActivation([{ step_type: 'set_ai', step_config: {} }])).toHaveLength(1);
    expect(
      validateStepsForActivation([{ step_type: 'set_ai', step_config: { enabled: 'sim' } }]),
    ).toHaveLength(1);
    expect(
      validateStepsForActivation([{ step_type: 'set_ai', step_config: { enabled: false } }]),
    ).toHaveLength(0);
  });

  it('passos completos passam', () => {
    expect(
      validateStepsForActivation([
        { step_type: 'run_automation', step_config: { automation_id: 'a-1' } },
        { step_type: 'run_flow', step_config: { flow_id: 'f-1' } },
        { step_type: 'set_ai', step_config: { enabled: true } },
      ]),
    ).toHaveLength(0);
  });
});

// ------------------------------------------------------------
// Passo `send_media` (Fase 4).
//
// ⚠️ A regra que MAIS importa aqui é a do áudio, e o motivo é o dano ser
// silencioso: a nota de voz sai por `sendWhatsAppAudio`, que não tem campo de
// legenda. Um texto ali seria gravado em `messages.content_text`, apareceria
// no fio para a EQUIPE e nunca chegaria ao cliente — a equipe leria uma
// conversa que o cliente não teve.
// ------------------------------------------------------------

describe('validateStepsForActivation — send_media', () => {
  it('sem arquivo é recusado', () => {
    const issues = validateStepsForActivation([
      { step_type: 'send_media', step_config: { kind: 'image' } },
    ]);
    expect(issues.map((i) => i.message).join(' ')).toContain('file is required');
  });

  it('tipo inválido é recusado', () => {
    const issues = validateStepsForActivation([
      { step_type: 'send_media', step_config: { kind: 'sticker', url: 'https://x/y.webp' } },
    ]);
    expect(issues.map((i) => i.message).join(' ')).toContain('kind must be');
  });

  it('CRÍTICO: áudio COM legenda é recusado', () => {
    const issues = validateStepsForActivation([
      {
        step_type: 'send_media',
        step_config: { kind: 'audio', url: 'https://x/y.ogg', caption: 'segue o áudio' },
      },
    ]);
    expect(issues.map((i) => i.message).join(' ')).toContain('audio has no caption');
  });

  it('áudio SEM legenda passa', () => {
    expect(
      validateStepsForActivation([
        { step_type: 'send_media', step_config: { kind: 'audio', url: 'https://x/y.ogg' } },
      ]),
    ).toHaveLength(0);
    // Legenda vazia também: é o que a tela grava ao trocar o tipo para áudio.
    expect(
      validateStepsForActivation([
        { step_type: 'send_media', step_config: { kind: 'audio', url: 'https://x/y.ogg', caption: '' } },
      ]),
    ).toHaveLength(0);
  });

  it('legenda acima de 1024 é recusada', () => {
    const issues = validateStepsForActivation([
      {
        step_type: 'send_media',
        step_config: { kind: 'image', url: 'https://x/y.png', caption: 'a'.repeat(1025) },
      },
    ]);
    expect(issues.map((i) => i.message).join(' ')).toContain('1024');
  });

  it('imagem com legenda passa', () => {
    expect(
      validateStepsForActivation([
        {
          step_type: 'send_media',
          step_config: { kind: 'image', url: 'https://x/y.png', caption: 'segue a proposta' },
        },
      ]),
    ).toHaveLength(0);
  });
});
