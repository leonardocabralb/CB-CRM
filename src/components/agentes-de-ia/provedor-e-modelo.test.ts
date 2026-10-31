import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// ============================================================
// Provedor e modelo (25/10/2026) — pinos de FONTE (o ambiente de teste é
// Node, sem DOM). O que eles seguram:
// 1. o seletor não é allow-list: "Outro (digitar o id)" e o campo de texto
//    quando a lista falha; o modelo salvo fora da lista aparece, marcado;
// 2. a rota que falha inteira vira "falhou", nunca "sem chave";
// 3. as três telas usam o seletor e o quadro de quem lê a mídia — e a
//    Configuração avisa a D27 ANTES de salvar quando "Ligado" muda.
// ============================================================

const ler = (rel: string) =>
  readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const SELETOR = ler('src/components/agentes-de-ia/provedor-e-modelo.tsx')
const CONFIG = ler('src/components/agentes-de-ia/configuracao-do-agente.tsx')
const NOVO = ler('src/components/agentes-de-ia/novo-agente-dialog.tsx')
const INTEGRACOES = ler('src/components/settings/integracoes-panel.tsx')

describe('o seletor de modelo', () => {
  it('tem a saída "Outro (digitar o id)" e volta ao campo de texto sem lista', () => {
    expect(SELETOR).toContain("t('modeloDaChave.outro')")
    expect(SELETOR).toMatch(/if \(!daChave \|\| daChave\.length === 0 \|\| digitando\)/)
    expect(SELETOR).toContain("t('modeloDaChave.falhou')")
  })

  it('o modelo SALVO fora da lista aparece, marcado', () => {
    expect(SELETOR).toMatch(/const foraDaLista = valor !== '' && !daChave\.some\(\(m\) => m\.id === valor\)/)
    expect(SELETOR).toMatch(/foraDaLista \? <option value=\{valor\}>/)
  })

  it('a rota que falha inteira = os três "falhou", nunca "sem_chave"', () => {
    const falha = SELETOR.slice(SELETOR.indexOf('const LEITURA_QUE_FALHOU'), SELETOR.indexOf('async function lerModelos'))
    expect(falha).toContain('FALHOU')
    expect(falha).not.toContain('sem_chave')
    expect(SELETOR).toMatch(/const FALHOU: ModelosDoProvedor = \{ ok: false, motivo: 'falhou'/)
  })

  it('"digitando" é carimbado com o provedor (trocar de provedor volta à lista, sem efeito)', () => {
    expect(SELETOR).toContain('const digitando = digitandoEm === provedor')
  })
})

describe('as telas', () => {
  it('Configuração: seletor, quadro da mídia e o recomendado da chave ao trocar de provedor', () => {
    expect(CONFIG).toContain('<SeletorDeModelo')
    expect(CONFIG).toContain('<QuemLeAMidia')
    expect(CONFIG).toMatch(/setModelo\(modeloRecomendado\(p, listaDaChave\(/)
    expect(CONFIG).not.toContain('AI_PROVIDER_MODELS')
  })

  it('Configuração: mudar "Ligado" avisa a D27 antes de salvar, nos dois sentidos', () => {
    const aviso = CONFIG.slice(CONFIG.indexOf('ativo !== agente.ativo'))
    expect(CONFIG).toMatch(/\{ativo !== agente\.ativo \? \(/)
    expect(aviso.slice(0, 300)).toMatch(/ativo \? t\('campo\.ativoLigando'\) : t\('campo\.ativoDesligando'\)/)
  })

  it('Novo agente: manda o modelo escolhido (ou o recomendado da chave), não o padrão fixo', () => {
    expect(NOVO).toContain('<SeletorDeModelo')
    expect(NOVO).toMatch(/modelo: modelo\.trim\(\)/)
    expect(NOVO).not.toContain('AI_PROVIDER_DEFAULT_MODEL')
    // Só busca com o diálogo aberto.
    expect(NOVO).toContain('useModelosDasChaves(aberto)')
    expect(NOVO).toMatch(/<QuemLeAMidia[^>]*compacto/)
  })

  it('Integrações: o Radar escolhe da lista (vazio = herda) e o quadro da mídia fica junto da transcrição e da leitura', () => {
    expect(INTEGRACOES).toMatch(/<SeletorDeModelo[\s\S]*?opcaoVazia=/)
    expect(INTEGRACOES).toMatch(/u\.modulo === 'transcricao' \|\| u\.modulo === 'leitura'[\s\S]{0,80}<QuemLeAMidia/)
    expect(INTEGRACOES).not.toContain('AI_PROVIDER_MODELS')
  })
})
