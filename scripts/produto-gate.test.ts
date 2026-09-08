// ============================================================
// O que VIAJA para quem instalar o sistema não pode carregar a nossa
// operação nem a marca do projeto original.
//
// Este portão nasceu de um levantamento (docs/PLANO-produto-vendavel.md):
// o domínio do escritório, o IP da VPS, o nome da rede do Swarm e a marca
// do upstream estavam espalhados por 15 arquivos, incluindo dicionários e
// fixtures de teste. Limpar uma vez resolve o dia; o portão é o que
// impede a volta — e ela volta, porque todo `git merge upstream/main`
// traz as strings do projeto original de novo, e porque escrever o
// domínio de produção num teste é o caminho de menor esforço.
//
// ⚠️ ESCOPO DELIBERADAMENTE ESTREITO. Ele cobre o que já foi limpo e
// precisa ficar limpo: `src/`, `messages/`, `supabase/` e a raiz do
// projeto. NÃO cobre `docs/`, `ops/`, `CLAUDE.md`, `docker-stack.yml` nem
// os workflows — esses ainda descrevem a nossa infraestrutura de
// propósito, e são a Fase 1 e a 4.4 do plano. Ampliar o escopo antes
// daquelas fases só produziria um teste permanentemente vermelho, que é
// o tipo que as pessoas aprendem a ignorar.
//
// Ao concluir a Fase 1, acrescente `docker-stack.yml` e
// `.github/workflows/` a PASTAS_COBERTAS. Ao concluir a 4.4, acrescente
// `docs/`.
// ============================================================

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = process.cwd()

/** O que não pode aparecer, e por quê (a razão vai na mensagem da falha). */
const PROIBIDOS: ReadonlyArray<{ padrao: RegExp; motivo: string }> = [
  { padrao: /cbadvogados/i, motivo: 'domínio do escritório' },
  { padrao: /CBAdvNet/i, motivo: 'nome da rede overlay da nossa VPS' },
  { padrao: /82\.25\.76\.63/, motivo: 'IP da nossa VPS' },
  { padrao: /hxnhakmyxyhalbsktzwe/i, motivo: 'ref do nosso projeto Supabase' },
  { padrao: /leonardocabralb/i, motivo: 'conta GitHub do dono deste repositório' },
  { padrao: /a\.donauskas/i, motivo: 'e-mail do autor do projeto original' },
  { padrao: /ArnasDon/i, motivo: 'conta GitHub do autor do projeto original' },
  { padrao: /wacrm\.tech/i, motivo: 'site de marketing do projeto original' },
]

const PASTAS_COBERTAS = ['src', 'messages', 'supabase']

const ARQUIVOS_DA_RAIZ = [
  '.env.local.example',
  'package.json',
  'docker-compose.yml',
  'Dockerfile',
  'components.json',
  'next.config.ts',
  'tsconfig.json',
]

/**
 * Exceções NOMEADAS, uma por arquivo, com o motivo. Lista vazia é a meta;
 * cada entrada aqui é uma dívida escrita, não uma permissão genérica.
 */
const EXCECOES: Readonly<Record<string, string>> = {
  // O próprio portão precisa citar o que proíbe.
  'scripts/produto-gate.test.ts': 'é a lista de proibidos',
  // `homepage`, `repository` e `bugs` apontam para ESTE repositório, que é
  // o certo enquanto o arquivo estiver aqui. A geração do repositório do
  // produto (Fase 6.1 do plano) reescreve os três — e é lá, não aqui, que
  // o valor tem de mudar. Nenhum outro campo do arquivo carrega marca.
  'package.json': 'metadados do repositório, reescritos na geração do produto',
}

const EXTENSOES = /\.(ts|tsx|mts|cts|js|mjs|cjs|json|sql|md|yml|yaml|toml|css)$/

function arquivos(dir: string, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome === '.next') continue
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) arquivos(caminho, saida)
    else if (EXTENSOES.test(nome)) saida.push(caminho)
  }
  return saida
}

function cobertos(): string[] {
  const lista: string[] = []
  for (const pasta of PASTAS_COBERTAS) lista.push(...arquivos(join(RAIZ, pasta)))
  for (const nome of ARQUIVOS_DA_RAIZ) lista.push(join(RAIZ, nome))
  return lista
}

describe('o que viaja para quem instala', () => {
  it('não carrega a nossa operação nem a marca do projeto original', () => {
    const achados: string[] = []

    for (const caminho of cobertos()) {
      const rel = relative(RAIZ, caminho).split(sep).join('/')
      if (rel in EXCECOES) continue

      let texto: string
      try {
        texto = readFileSync(caminho, 'utf8')
      } catch {
        continue // arquivo opcional da raiz que não existe nesta cópia
      }

      const linhas = texto.split('\n')
      for (const { padrao, motivo } of PROIBIDOS) {
        linhas.forEach((linha, i) => {
          if (padrao.test(linha)) {
            achados.push(`${rel}:${i + 1} — ${motivo}: ${linha.trim().slice(0, 100)}`)
          }
        })
      }
    }

    expect(
      achados,
      'Estas linhas põem a nossa infraestrutura (ou a marca do projeto ' +
        'original) em arquivos que vão para quem instalar o sistema. ' +
        'Troque por um valor de exemplo (example.com, 203.0.113.10) ou por ' +
        'configuração. Se for legítimo, acrescente o arquivo a EXCECOES com ' +
        'o motivo escrito.',
    ).toEqual([])
  })

  it('está de fato varrendo arquivos', () => {
    // Cobertura, não só ausência de achado: uma varredura que pare de
    // encontrar arquivos passaria vazia e o portão viraria decoração.
    expect(cobertos().length).toBeGreaterThan(400)
  })
})
