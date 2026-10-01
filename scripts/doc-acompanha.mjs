#!/usr/bin/env node
/**
 * doc-acompanha — a mudança no contrato de integração levou a doc junto?
 *
 * Quem integra (n8n, Make, código próprio) lê a DOC, não o código: a
 * referência da API (`docs/public-api.md`), o guia dos webhooks
 * (`docs/webhooks.md`), o do MCP (`docs/mcp.md`) e a aba Configurações → API
 * → Documentação. Em 01/10/2026 uma conferência achou a referência afirmando
 * uma coisa e o código fazendo outra em mais de dez pontos — quase todos de
 * PRs que mudaram o comportamento sem tocar a doc: o agente de IA que passou
 * a mover card, o título que a API fixa, o autor das escritas da API. A regra
 * escrita ("a doc muda no mesmo PR") já existia; faltava quem a cobrasse.
 *
 * O portão: o PR que mexe num CONTRATO (as áreas abaixo) sem tocar nenhum
 * documento daquela área reprova — a não ser que um commit do PR declare,
 * com o motivo, que a doc não muda:
 *
 *     Doc-inalterada: refatoração interna, a resposta da rota é a mesma
 *
 * A declaração é DECISÃO ESCRITA, não atalho: quem a escreve afirma que leu
 * o que a doc diz sobre aquilo. Teste não conta como contrato.
 *
 *   node scripts/doc-acompanha.mjs          # o diff contra origin/main
 *   node scripts/doc-acompanha.mjs main     # contra outra base
 *
 * O diff inclui o que ainda não foi commitado (alterado e não rastreado); as
 * mensagens são as dos commits entre a base e o HEAD. No CI roda no job
 * `documentacao` de `.github/workflows/pipeline.yml`, só em pull request.
 *
 * ⚠️ O portão vê CAMINHO, não significado: uma área sem a doc tocada pede a
 * decisão; a doc tocada não prova que o texto certo mudou. E arquivo novo de
 * contrato fora destes globs passa calado — achou um, acrescente-o aqui.
 * Arquivo que muda toda semana por OUTROS motivos (`automations/engine.ts`,
 * `ia-agentes/turno.ts`, os caminhos de ingestão) não entra no glob, senão a
 * declaração vira rotina: a promessa que a doc faz sobre ele vira um pino
 * perto do código — `src/lib/webhooks/origem-dos-escritores.chamadores.test.ts`
 * (TODO escritor de `deals`, com a `source` que produz) e
 * `disparos-de-aviso.chamadores.test.ts` (quem emite cada aviso, e em que
 * ordem).
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, matchesGlob } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Cada área: o que é contrato (globs) e onde ele está escrito para quem integra. */
export const AREAS = [
  {
    nome: 'API pública (/api/v1)',
    contrato: [
      'src/app/api/v1/**',
      'src/lib/api/v1/**',
      'src/lib/api-keys/**',
      'src/lib/auth/api-context.ts',
      // O núcleo que as rotas chamam, e cujo comportamento a referência
      // descreve (efeitos do envio, erros, disparo, agendada, telefone).
      'src/lib/whatsapp/send-message.ts',
      'src/lib/whatsapp/resolve-conversation.ts',
      'src/lib/whatsapp/broadcast-core.ts',
      'src/lib/scheduled/dispatch.ts',
      'src/lib/contacts/telefone.ts',
      // O limite por chave (120/min) que a referência crava.
      'src/lib/rate-limit.ts',
      // A forma do que o `POST /messages` aceita e a referência descreve: a
      // mensagem interativa (esquema e limites) e o objeto de
      // `template.params`. Mudam pouco (4 PRs em setembro, somados).
      'src/lib/whatsapp/interactive.ts',
      'src/lib/whatsapp/meta-api.ts',
      'src/lib/whatsapp/template-send-builder.ts',
      'src/lib/whatsapp/template-body.ts',
    ],
    docs: ['docs/public-api.md'],
  },
  {
    nome: 'Avisos do CRM (webhooks enviados)',
    contrato: ['src/lib/webhooks/**'],
    // A ORIGEM (`source`) dos `deal.*` nasce no BANCO: o gatilho da fila do
    // funil (1040) e a RPC das automações (1031). Migration que redefine um
    // dos dois muda o que o integrador recebe; é cobrada pelo CONTEÚDO,
    // porque cada migration é um arquivo novo.
    conteudo: {
      arquivos: 'supabase/migrations/*.sql',
      padrao: /cb_enfileira_evento_de_funil|cb_atualizar_negocio/,
    },
    docs: ['docs/public-api.md', 'docs/webhooks.md'],
  },
  {
    nome: 'Webhooks recebidos',
    contrato: ['src/lib/webhooks-de-entrada/**', 'src/app/api/cb/entrada/**'],
    docs: ['docs/webhooks.md'],
  },
  {
    // O que a doc de integração afirma sobre eles: quem cria e move card (e
    // com qual `source` o aviso chega), os gatilhos, as variáveis.
    nome: 'Automações, robôs e agentes de IA',
    contrato: [
      'src/lib/automations/trigger-meta.ts',
      'src/lib/automations/variaveis/**',
      'src/lib/flows/mover-card.ts',
      'src/lib/ia-agentes/executar-acoes.ts',
      'src/lib/deals/create-deal.ts',
      'src/lib/cb-channels/pipeline-routing.ts',
    ],
    docs: ['docs/public-api.md', 'docs/webhooks.md'],
  },
  {
    nome: 'Servidor MCP',
    contrato: ['mcp-server/src/**'],
    docs: ['docs/mcp.md', 'mcp-server/README.md'],
  },
]

/** O que nunca é contrato: teste muda sem mudar o que o integrador vê. */
export function ehTeste(caminho) {
  return /\.test\.[cm]?[jt]sx?$/.test(caminho)
}

/** A linha `Doc-inalterada: <motivo>` (motivo de 10 caracteres ou mais) de alguma das mensagens; `null` sem ela. */
export function motivoDeclarado(mensagens) {
  for (const mensagem of mensagens) {
    const m = mensagem.match(/^Doc-inalterada:[ \t]*(\S.*?)[ \t]*$/m)
    if (m && m[1].length >= 10) return m[1]
  }
  return null
}

/**
 * `arquivos`: os caminhos mudados (relativos à raiz); `mensagens`: as
 * mensagens dos commits; `ler` e `lerNaBase`: o conteúdo de um caminho no
 * HEAD e na base (`null` se não existe ali), só para as áreas com regra de
 * `conteudo`. As DUAS versões contam: a migration APAGADA, ou a função
 * tirada dela, também muda a origem — lida só no HEAD, passaria calada
 * (achado do Codex no PR #368). Devolve as áreas tocadas (com `ok` por
 * área), as pendentes, o motivo declarado e o veredito.
 *
 * @param {{
 *   arquivos: string[],
 *   mensagens: string[],
 *   areas?: typeof AREAS,
 *   ler?: (caminho: string) => string | null,
 *   lerNaBase?: (caminho: string) => string | null,
 * }} entrada
 */
export function avaliar({ arquivos, mensagens, areas = AREAS, ler = () => null, lerNaBase = () => null }) {
  const tocadas = []
  for (const area of areas) {
    const porConteudo = (a) =>
      !!area.conteudo &&
      matchesGlob(a, area.conteudo.arquivos) &&
      (area.conteudo.padrao.test(ler(a) ?? '') || area.conteudo.padrao.test(lerNaBase(a) ?? ''))
    const casados = arquivos.filter(
      (a) => !ehTeste(a) && (area.contrato.some((g) => matchesGlob(a, g)) || porConteudo(a))
    )
    if (casados.length === 0) continue
    const docTocada = area.docs.some((d) => arquivos.includes(d))
    tocadas.push({ nome: area.nome, casados, docs: area.docs, ok: docTocada })
  }
  const pendentes = tocadas.filter((t) => !t.ok)
  const declaracao = motivoDeclarado(mensagens)
  return { tocadas, pendentes, declaracao, ok: pendentes.length === 0 || declaracao !== null }
}

function git(...args) {
  return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function linhas(texto) {
  return texto.split('\n').filter(Boolean)
}

function main() {
  const base = process.argv[2] ?? 'origin/main'
  const arquivos = [
    ...new Set([
      // --no-renames: arquivo movido sai como apagado + novo, e a área de
      // origem também conta (a mesma régua do `regras-do-diff.mjs`).
      ...linhas(git('diff', '--name-only', '--no-renames', `${base}...HEAD`)),
      ...linhas(git('diff', '--name-only', '--no-renames', 'HEAD')),
      ...linhas(git('ls-files', '--others', '--exclude-standard')),
    ]),
  ].sort()
  const mensagens = git('log', '--format=%B%x00', `${base}..HEAD`).split('\0')
  const ler = (caminho) => {
    try {
      return readFileSync(join(RAIZ, caminho), 'utf8')
    } catch {
      return null // apagado no diff
    }
  }
  // A versão de onde o PR partiu (a mesma régua do `base...HEAD` do diff).
  const pontoDePartida = git('merge-base', base, 'HEAD').trim()
  const lerNaBase = (caminho) => {
    try {
      return execFileSync('git', ['show', `${pontoDePartida}:${caminho}`], {
        cwd: RAIZ,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      return null // arquivo novo no PR
    }
  }

  const r = avaliar({ arquivos, mensagens, ler, lerNaBase })
  if (r.tocadas.length === 0) {
    console.log('Nenhum contrato de integração mudou: nada a cobrar da doc.')
    return
  }
  for (const t of r.tocadas) {
    const amostra = t.casados.slice(0, 3).join(', ') + (t.casados.length > 3 ? ` (+${t.casados.length - 3})` : '')
    console.log(`${t.ok ? '✓' : '✖'} ${t.nome} — mudou: ${amostra}`)
    console.log(`    doc: ${t.docs.join(' ou ')}${t.ok ? ' (tocada)' : ' — NÃO tocada'}`)
  }
  console.log(
    '\nA doc tocada não prova que o texto certo mudou; e a aba Configurações → API → Documentação' +
      ' (Settings.documentacao, nos dois dicionários) acompanha quando afirma o que mudou.'
  )
  if (r.pendentes.length === 0) return
  if (r.declaracao) {
    console.log(`\nDeclarado num commit — Doc-inalterada: ${r.declaracao}`)
    return
  }
  console.error(
    '\n✖ O contrato mudou e a doc da área não. Atualize-a no mesmo PR ou, se nada do que ela' +
      ' descreve mudou, declare num commit do PR (motivo com 10 caracteres ou mais):\n\n' +
      '    Doc-inalterada: <motivo>\n'
  )
  process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
