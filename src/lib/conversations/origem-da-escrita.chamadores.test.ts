import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// ============================================================
// QUEM escreve em `conversations` diz de onde veio — DEFAULT-DENY.
//
// A trilha da conversa (1083) é gravada por gatilho e acerta sozinha quem
// está logado. A escrita do SERVIDOR (service role) chega sem pessoa, e só o
// código sabe se foi o cliente, o celular, a automação X ou a API — por
// `marcarOrigem`. Esquecer não dá erro nenhum: a linha sai "pelo sistema", e
// é a pergunta que a 1083 existe para responder ("quem encerrou?") que fica
// sem resposta. Teste de comportamento com dublê não pega "esqueci de
// marcar"; ler o fonte pega.
//
// Regra: toda escrita que CRIA conversa, e todo UPDATE que pode mudar
// `status` ou `assigned_agent_id` (o objeto cita uma das duas colunas, ou é
// uma variável), passa por `marcarOrigem(...)` — ou entra em
// `SEM_MARCAR_A_ORIGEM` com o motivo escrito.
// ============================================================

const SRC = path.join(__dirname, '..', '..')

/** Arquivo → por que a escrita dele não precisa de `marcarOrigem`. */
const SEM_MARCAR_A_ORIGEM: Record<string, string> = {
  'components/inbox/message-thread.tsx':
    'o navegador grava com a sessão de quem clicou (encerrar, pendente, reabrir; o canal) — o banco lê a pessoa pelo login',
  'components/inbox/painel/responsavel-menu.tsx':
    'o navegador atribui com a sessão de quem clicou — o banco lê a pessoa pelo login',
  'app/api/whatsapp/send/route.ts':
    'cria a conversa com o cliente da SESSÃO (`requireRole`), não com a service role: o banco lê a pessoa pelo login',
  'app/api/ai/autoreply/[conversationId]/route.ts':
    'o objeto (variável) é só a pausa/retomada da IA — nunca mexe em situação nem em responsável',
  'lib/cb-groups/persist.ts': 'grupo fica fora da trilha (o gatilho da 1083 pula grupo: não tem ficha)',
}

function arquivosDoSrc(dir: string): string[] {
  const saida: string[] = []
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, entrada.name)
    if (entrada.isDirectory()) saida.push(...arquivosDoSrc(caminho))
    else if (/\.(ts|tsx)$/.test(entrada.name) && !/\.test\.(ts|tsx)$/.test(entrada.name)) saida.push(caminho)
  }
  return saida
}

/** Fonte sem comentários — os arquivos citam colunas ao EXPLICAR decisões. */
function semComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

interface Escrita {
  arquivo: string
  metodo: 'insert' | 'upsert' | 'update'
  corpo: string
  marcada: boolean
}

/** Cada `.from('conversations').<escrita>(…)` com o objeto escrito. */
function escritasEmConversas(): Escrita[] {
  const achadas: Escrita[] = []
  for (const absoluto of arquivosDoSrc(SRC)) {
    const arquivo = path.relative(SRC, absoluto).split(path.sep).join('/')
    const texto = semComentarios(fs.readFileSync(absoluto, 'utf8'))
    const alvo = /\.from\(\s*['"]conversations['"]\s*\)/g
    let m: RegExpExecArray | null
    while ((m = alvo.exec(texto))) {
      const depois = texto.slice(m.index, m.index + 1500)
      const metodo = /\.(insert|upsert|update|delete|select)\(/.exec(depois)
      if (!metodo || metodo[1] === 'select' || metodo[1] === 'delete') continue
      let nivel = 1
      let i = metodo.index + metodo[0].length
      const inicio = i
      while (i < depois.length && nivel > 0) {
        if (depois[i] === '(') nivel++
        else if (depois[i] === ')') nivel--
        i++
      }
      const corpo = depois.slice(inicio, i - 1)
      // `marcarOrigem(` logo antes do cliente: `marcarOrigem(db.from(…)…`,
      // `marcarOrigem(\n supabaseAdmin()\n .from(…)…`.
      const antes = texto.slice(Math.max(0, m.index - 120), m.index)
      const marcada = /marcarOrigem\(\s*[\w.]*(\(\))?\s*$/.test(antes)
      achadas.push({ arquivo, metodo: metodo[1] as Escrita['metodo'], corpo, marcada })
    }
  }
  return achadas
}

/** UPDATE que PODE mudar situação ou responsável. */
function podeMudarSituacao(e: Escrita): boolean {
  if (e.metodo !== 'update') return true
  const objeto = e.corpo.trim()
  // Variável (`patch`, `convUpdate`, `update`): o leitor não sabe o que vai.
  if (!objeto.startsWith('{')) return true
  return /\bstatus\b\s*:|\bassigned_agent_id\b/.test(objeto)
}

describe('origem da escrita em conversations (1083) — DEFAULT-DENY', () => {
  const escritas = escritasEmConversas()

  it('a varredura enxerga as escritas (o pino não pode passar por não achar nada)', () => {
    expect(escritas.length).toBeGreaterThan(20)
    expect(escritas.filter((e) => e.marcada).length).toBeGreaterThanOrEqual(12)
  })

  it('toda escrita que cria conversa ou muda situação/responsável marca a origem ou tem motivo escrito', () => {
    const fora = escritas
      .filter((e) => podeMudarSituacao(e) && !e.marcada && !(e.arquivo in SEM_MARCAR_A_ORIGEM))
      .map((e) => `${e.arquivo}: ${e.metodo}(${e.corpo.replace(/\s+/g, ' ').slice(0, 80)})`)
    expect(fora, 'marque com `marcarOrigem` ou escreva o motivo em SEM_MARCAR_A_ORIGEM').toEqual([])
  })

  it('cada exceção continua necessária (quem passar a marcar sai da lista)', () => {
    for (const arquivo of Object.keys(SEM_MARCAR_A_ORIGEM)) {
      const semMarca = escritas.filter((e) => e.arquivo === arquivo && podeMudarSituacao(e) && !e.marcada)
      expect(semMarca.length, `${arquivo} não tem mais escrita sem marca — tire da lista`).toBeGreaterThan(0)
    }
  })

  it('os caminhos do servidor que o plano listou estão marcados', () => {
    const marcadosPorArquivo = new Set(escritas.filter((e) => e.marcada).map((e) => e.arquivo))
    for (const arquivo of [
      'lib/conversations/reopen.ts',
      'lib/whatsapp/inbound-store.ts',
      'app/api/whatsapp/webhook/route.ts',
      'lib/whatsapp/resolve-conversation.ts',
      'app/api/cb/conversas/abrir/route.ts',
      'lib/automations/destinatario.ts',
      'lib/automations/engine.ts',
      'lib/flows/engine.ts',
      'lib/ia-agentes/turno.ts',
      'lib/asaas/varrer-regua.ts',
    ]) {
      expect(marcadosPorArquivo, arquivo).toContain(arquivo)
    }
  })
})
