import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { MOTIVOS_DO_ENVIO, envioQueNaoSaiu } from './falha-do-envio';

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
      // A frase do "recusado" manda ler o motivo da linha de baixo.
      expect(typeof d?.Inbox?.bubble?.motivoDaFalha).toBe('string');
    });
  }
});
