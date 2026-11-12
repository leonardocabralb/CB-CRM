import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import en from '../../../messages/en.json'
import ptBR from '../../../messages/pt-BR.json'

// ============================================================
// O ✨ da linha da caixa de entrada (pedido do operador, 12/11/2026): "a IA
// atende esta conversa". Tem de ser a MESMA régua do filtro "Atendimento IA"
// (`casaComAIa`, testada em `filtros.test.ts`) — um selo que acende onde o
// filtro não traz a conversa (ou o contrário) é o defeito que o chip "Em
// atraso" evita reusando a régua do selo de atraso. Sem teste de componente
// (a lista é grande demais para montar aqui): o pino lê o fonte.
// ============================================================

const fonte = fs
  .readFileSync(path.join(__dirname, 'conversation-list.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')

describe('o símbolo da IA na linha', () => {
  it('lê as conversas da IA SEMPRE (o símbolo aparece sem filtro nenhum)', () => {
    expect(fonte).toMatch(/useConversasDaIa\(\s*true,\s*resyncToken,?\s*\)/)
  })

  it('⚠️ acende pela régua do filtro "Atendimento IA", com "não sei" calando', () => {
    expect(fonte).toContain('iaAtende={conversasDaIa !== null && casaComAIa(conv, "atendimento", conversasDaIa)}')
    expect(fonte).toMatch(/\{iaAtende && \(/)
    // Nenhuma conta própria: a linha não decide pela coluna do último agente.
    expect(fonte).not.toMatch(/iaAtende=\{[^}]*ia_agente_id/)
  })

  it('a dica existe nos DOIS dicionários', () => {
    expect(ptBR.Inbox.conversationList.iaAtendendo).toBe('A IA atende esta conversa')
    expect(typeof en.Inbox.conversationList.iaAtendendo).toBe('string')
    expect(fonte).toContain('t("iaAtendendo")')
  })
})
