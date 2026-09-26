import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';

import { corpoDoSalvamento } from './ai-config';

// ============================================================
// A tela do assistente anterior (`/agents/legado`) depois da E2 do
// docs/PLANO-agentes-de-ia.md: a resposta automática desta configuração saiu,
// e a tela não pode continuar oferecendo um liga-desliga sem efeito — nem
// deixar de salvar o resto por causa dele.
// ============================================================

const estado = {
  provider: 'gemini' as const,
  model: '  gemini-3.7-flash  ',
  systemPrompt: '   ',
  isActive: true,
  autoReplyEnabled: true,
  maxPerConversation: 7,
};

describe('corpoDoSalvamento — o POST /api/ai/config continua inteiro', () => {
  it('devolve os campos da resposta automática com o valor LIDO (a rota reescreve a linha)', () => {
    expect(corpoDoSalvamento(estado)).toEqual({
      provider: 'gemini',
      model: 'gemini-3.7-flash',
      system_prompt: null,
      is_active: true,
      auto_reply_enabled: true,
      auto_reply_max_per_conversation: 7,
    });
  });

  it('⚠️ não manda `handoff_agent_id`: ausente, a rota não mexe na coluna; presente, um ex-membro travaria o Salvar', () => {
    expect('handoff_agent_id' in corpoDoSalvamento(estado)).toBe(false);
  });
});

describe('a tela não oferece mais a resposta automática', () => {
  const fonte = readFileSync(join(__dirname, 'ai-config.tsx'), 'utf8');

  it('nenhum controle da resposta automática é desenhado', () => {
    for (const chave of [
      'autoReply',
      'autoReplyDesc',
      'maxAutoReplies',
      'maxAutoRepliesDesc',
      'handoffTo',
      'handoffToDesc',
      'handoffQueue',
    ]) {
      expect(fonte, chave).not.toContain(`t('${chave}')`);
    }
    expect(fonte).not.toMatch(/onCheckedChange=\{setAutoReplyEnabled\}/);
    expect(fonte).not.toMatch(/setHandoffAgentId|fetchAccountMembers/);
  });

  it('diz, do dicionário, que a resposta automática é dos agentes de IA — com o caminho até eles', () => {
    expect(fonte).toContain("t('autoReplyMoved')");
    expect(fonte).toContain("t('autoReplyMovedLink')");
    expect(fonte).toMatch(/href="\/agents"/);
    for (const dic of [en, ptBR]) {
      expect(typeof dic.Settings.aiConfig.autoReplyMoved).toBe('string');
      expect(typeof dic.Settings.aiConfig.autoReplyMovedLink).toBe('string');
    }
  });

  it('nenhum outro texto da tela afirma que esta configuração responde sozinha', () => {
    const afirmaAutoReply = /auto-?repl|resposta(s)? autom[aá]tica|bot de resposta/i;
    for (const dic of [en, ptBR]) {
      for (const [chave, texto] of Object.entries(dic.Settings.aiConfig)) {
        if (chave === 'autoReplyMoved') continue;
        expect(texto, `Settings.aiConfig.${chave}`).not.toMatch(afirmaAutoReply);
      }
    }
  });
});
