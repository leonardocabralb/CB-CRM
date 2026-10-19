import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  FALHA_SEM_RESPOSTA,
  MOTIVOS_DO_ENVIO,
  envioQueNaoSaiu,
  falhaDaResposta,
  naBolha,
} from './falha-do-envio';

// ============================================================
// A bolha do robô que NÃO saiu (06/10/2026). A frase é chave MONTADA
// (`Inbox.bubble.naoSaiu.<motivo>`): escapa dos portões de i18n, então este
// teste lê os dois dicionários.
// ============================================================

describe('envioQueNaoSaiu', () => {
  it('só com o booleano true da 1080', () => {
    expect(envioQueNaoSaiu({ nao_saiu: true, error_title: 'sem_whatsapp' })).toBe('sem_whatsapp');
    expect(envioQueNaoSaiu({ nao_saiu: false, error_title: 'sem_whatsapp' })).toBeNull();
    expect(envioQueNaoSaiu({ error_title: 'sem_whatsapp' })).toBeNull();
    // JSONB/realtime: "true" e 1 são truthy e NÃO ligam (CLAUDE.md, 8c).
    expect(envioQueNaoSaiu({ nao_saiu: 'true' as unknown as boolean, error_title: 'recusado' })).toBeNull();
  });

  it('a falha de RECIBO (saiu e não foi entregue) não é "não saiu"', () => {
    // O texto da Meta em `error_title`, sem a marca: a bolha "Não entregue".
    expect(envioQueNaoSaiu({ nao_saiu: false, error_title: 'Message undeliverable' })).toBeNull();
  });

  it('cada motivo volta como é; código desconhecido vira "incerto" (a frase que não afirma nada)', () => {
    for (const m of MOTIVOS_DO_ENVIO) expect(envioQueNaoSaiu({ nao_saiu: true, error_title: m })).toBe(m);
    expect(envioQueNaoSaiu({ nao_saiu: true, error_title: 'outro_codigo' })).toBe('incerto');
    expect(envioQueNaoSaiu({ nao_saiu: true, error_title: null })).toBe('incerto');
  });
});

// ------------------------------------------------------------
// A bolha OTIMISTA do envio da equipe (19/10/2026)
// ------------------------------------------------------------
describe('falhaDaResposta — a resposta não-ok da rota de envio', () => {
  it('o caso de 19/10: número sem WhatsApp — "não saiu", e SEM botão (falharia igual)', () => {
    const f = falhaDaResposta(502, {
      error: 'Evolution API error: number 550000000000 is not on WhatsApp',
      code: 'evolution_rejected',
      motivo: 'sem_whatsapp',
      detalhe: 'number 550000000000 is not on WhatsApp',
    });
    expect(f).toEqual({
      motivo: 'sem_whatsapp',
      detalhe: 'number 550000000000 is not on WhatsApp',
      podeTentarDeNovo: false,
    });
  });

  it('recusa comprovada que pode mudar: botão', () => {
    expect(falhaDaResposta(502, { motivo: 'recusado', detalhe: 'Bad Request' }).podeTentarDeNovo).toBe(true);
    expect(falhaDaResposta(502, { motivo: 'conexao_fora_do_ar' }).podeTentarDeNovo).toBe(true);
  });

  it('INCERTO nunca ganha botão — reenviar mandaria em dobro (CLAUDE.md, 8e)', () => {
    expect(falhaDaResposta(502, { motivo: 'incerto' })).toEqual({
      motivo: 'incerto',
      detalhe: null,
      podeTentarDeNovo: false,
    });
    // 500 sem motivo (o genérico do `toErrorResponse`, que pode vir DEPOIS de
    // o provedor aceitar), 502 sem corpo, corpo que não é objeto.
    expect(falhaDaResposta(500, { error: 'Internal server error' }).motivo).toBe('incerto');
    expect(falhaDaResposta(502, {}).motivo).toBe('incerto');
    expect(falhaDaResposta(504, null).motivo).toBe('incerto');
    expect(falhaDaResposta(500, 'html de erro').podeTentarDeNovo).toBe(false);
    expect(FALHA_SEM_RESPOSTA).toEqual({ motivo: 'incerto', detalhe: null, podeTentarDeNovo: false });
  });

  it('4xx sem motivo parou antes de qualquer conexão: barrado, com o texto da rota', () => {
    expect(falhaDaResposta(404, { error: 'Conversation not found' })).toEqual({
      motivo: 'barrado',
      detalhe: 'Conversation not found',
      podeTentarDeNovo: false,
    });
  });

  it('barrado só vale de novo quando a barreira passa: sessão (401) e limite (429)', () => {
    expect(falhaDaResposta(401, { error: 'Unauthorized' }).podeTentarDeNovo).toBe(true);
    expect(falhaDaResposta(429, { error: 'Rate limit exceeded' }).podeTentarDeNovo).toBe(true);
    expect(falhaDaResposta(403, { error: 'Forbidden' }).podeTentarDeNovo).toBe(false);
    expect(falhaDaResposta(400, { motivo: 'barrado', detalhe: 'WhatsApp not configured' }).podeTentarDeNovo).toBe(false);
    expect(falhaDaResposta(409, { motivo: 'barrado' }).podeTentarDeNovo).toBe(false);
  });

  it('motivo que esta versão não conhece decide pelo status — nunca vira botão por engano', () => {
    expect(falhaDaResposta(502, { motivo: 'outro' }).motivo).toBe('incerto');
    expect(falhaDaResposta(400, { motivo: 'outro', error: 'x' }).motivo).toBe('barrado');
  });

  it('o detalhe tem teto e ignora o que não é texto', () => {
    expect(falhaDaResposta(502, { motivo: 'recusado', detalhe: 'z'.repeat(1000) }).detalhe?.length).toBe(300);
    expect(falhaDaResposta(502, { motivo: 'recusado', detalhe: 42 }).detalhe).toBeNull();
    expect(falhaDaResposta(502, { motivo: 'recusado', detalhe: '   ' }).detalhe).toBeNull();
  });
});

describe('naBolha — a otimista vira "não enviada", lida por `envioQueNaoSaiu`', () => {
  it('cada motivo volta pela régua da bolha', () => {
    for (const motivo of MOTIVOS_DO_ENVIO) {
      const campos = naBolha({ motivo, detalhe: 'd', podeTentarDeNovo: false });
      expect(campos).toEqual({ status: 'failed', nao_saiu: true, error_title: motivo, error_details: 'd' });
      expect(envioQueNaoSaiu(campos)).toBe(motivo);
    }
  });
});

describe('a frase de cada motivo existe nos DOIS dicionários', () => {
  const raiz = path.join(__dirname, '..', '..', '..');
  for (const arquivo of ['messages/pt-BR.json', 'messages/en.json']) {
    it(arquivo, () => {
      const d = JSON.parse(fs.readFileSync(path.join(raiz, arquivo), 'utf8'));
      const bloco = d?.Inbox?.bubble?.naoSaiu ?? {};
      for (const m of MOTIVOS_DO_ENVIO) {
        expect(typeof bloco[m], `${arquivo}: Inbox.bubble.naoSaiu.${m}`).toBe('string');
        expect(bloco[m].trim().length).toBeGreaterThan(0);
      }
      // A frase do "recusado" manda ler o motivo da linha de baixo — neutra:
      // a recusa pode ser da Evolution, não "informada pela Meta".
      expect(d?.Inbox?.bubble?.naoSaiuMotivo).toMatch(/\{motivo\}/);
      expect(d?.Inbox?.bubble?.naoSaiuMotivo).not.toMatch(/Meta/);
      // O "barrado" parou no CRM: dizer que o WhatsApp recusou seria falso.
      expect(bloco.barrado).not.toMatch(/WhatsApp/);
    });
  }
});
