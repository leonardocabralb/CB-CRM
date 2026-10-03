import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTranslator } from 'next-intl'

import {
  CODIGOS_DE_PENDENCIA,
  avisosDaAutomacao,
  chaveDaPendencia,
  lerCaminho,
  localDoPasso,
  localizarPendencias,
} from './pendencias'
import { validateStepsForActivation, validateTriggerForActivation, type ValidationIssue } from './validate'

// A árvore do construtor, no mínimo que o módulo pede (o `BuilderStep` real
// tem o mesmo formato).
interface Passo {
  cid: string
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes: Passo[]; no: Passo[] }
}

const p = (cid: string, step_type = 'send_message', step_config: Record<string, unknown> = { text: 'oi' }): Passo => ({
  cid,
  step_type,
  step_config,
})
const cond = (cid: string, yes: Passo[], no: Passo[]): Passo => ({
  cid,
  step_type: 'condition',
  step_config: { subject: 'tag_presence', operand: 't' },
  branches: { yes, no },
})

const issue = (path: string, codigo?: string): ValidationIssue =>
  codigo ? { path, message: 'x', codigo } : { path, message: 'x' }

describe('lerCaminho', () => {
  it('desmonta o endereço do passo, com os ramos e o campo', () => {
    expect(lerCaminho('steps[0].no.steps[9].responsavel_user_id')).toEqual({
      alvo: 'passo',
      passos: [{ indice: 0 }, { ramo: 'no', indice: 9 }],
      campo: 'responsavel_user_id',
    })
    expect(lerCaminho('steps[2].yes.steps[0].no.steps[1].text')).toEqual({
      alvo: 'passo',
      passos: [{ indice: 2 }, { ramo: 'yes', indice: 0 }, { ramo: 'no', indice: 1 }],
      campo: 'text',
    })
    // Sem campo: o "tipo de passo desconhecido".
    expect(lerCaminho('steps[3]')).toEqual({ alvo: 'passo', passos: [{ indice: 3 }], campo: null })
    // Campo com ponto: o valor de uma posição do modelo.
    expect(lerCaminho('steps[1].variables.1')).toEqual({
      alvo: 'passo',
      passos: [{ indice: 1 }],
      campo: 'variables.1',
    })
  })

  it('gatilho e automação inteira', () => {
    expect(lerCaminho('trigger.tag_id')).toEqual({ alvo: 'gatilho', campo: 'tag_id' })
    expect(lerCaminho('steps')).toEqual({ alvo: 'automacao' })
  })

  it('forma desconhecida é null (e nunca some: vai para as gerais)', () => {
    for (const path of ['', 'trigger', 'trigger.', 'passos[0]', 'steps[x]', 'steps[0].maybe.steps[1]', 'steps[0].', 'steps[0]x']) {
      expect(lerCaminho(path), path).toBeNull()
    }
    expect(lerCaminho(undefined as unknown as string)).toBeNull()
  })
})

describe('localizarPendencias', () => {
  it('o caso real: a tarefa sem responsável no 10º passo do ramo NÃO', () => {
    const ramoNao = Array.from({ length: 10 }, (_, i) => p(`n${i}`))
    const arvore = [cond('c0', [p('s0')], ramoNao), p('r1')]
    const pendencia = issue('steps[0].no.steps[9].responsavel_user_id', 'tarefa_sem_responsavel')
    const r = localizarPendencias(arvore, [pendencia])
    expect([...r.porPasso.keys()]).toEqual(['n9'])
    expect(r.porPasso.get('n9')).toEqual([pendencia])
    expect(r.doGatilho).toEqual([])
    expect(r.gerais).toEqual([])
  })

  it('reparte entre passos, gatilho e gerais — toda pendência sai em exatamente um lugar, na ordem', () => {
    const arvore = [p('a'), cond('b', [p('b-sim')], [p('b-nao')])]
    const issues = [
      issue('steps[0].text', 'mensagem_sem_texto'),
      issue('trigger.tag_id', 'gatilho_sem_etiqueta'),
      issue('steps', 'sem_passos'),
      issue('steps[1].yes.steps[0].text'),
      issue('steps[0].channel_id'),
      // Não casa com a árvore: índice fora, ramo inexistente, forma estranha.
      issue('steps[5].text'),
      issue('steps[1].no.steps[3].text'),
      issue('lixo'),
    ]
    const r = localizarPendencias(arvore, issues)
    expect(r.porPasso.get('a')).toEqual([issues[0], issues[4]])
    expect(r.porPasso.get('b-sim')).toEqual([issues[3]])
    expect(r.porPasso.has('b')).toBe(false)
    expect(r.doGatilho).toEqual([issues[1]])
    expect(r.gerais).toEqual([issues[2], issues[5], issues[6], issues[7]])
    const total = [...r.porPasso.values()].flat().length + r.doGatilho.length + r.gerais.length
    expect(total).toBe(issues.length)
  })

  it('só desce pelo ramo de uma CONDIÇÃO (a regra de validate.ts)', () => {
    // Um passo que não é condição mas carrega `branches` (não sai do
    // construtor, mas o endereço não pode apontar para dentro dele).
    const estranho: Passo = { ...p('x'), branches: { yes: [p('dentro')], no: [] } }
    const r = localizarPendencias([estranho], [issue('steps[0].yes.steps[0].text')])
    expect(r.porPasso.size).toBe(0)
    expect(r.gerais).toHaveLength(1)
  })

  it('casa com os endereços que validate.ts produz de verdade', () => {
    const arvore: Passo[] = [
      cond('c', [p('sim', 'add_tag', { tag_id: '' })], [p('nao', 'create_task', { titulo: 'T' })]),
      p('fim', 'send_message', { text: '' }),
    ]
    const r = localizarPendencias(arvore, [
      ...validateTriggerForActivation('tag_added', {}),
      ...validateStepsForActivation(arvore),
    ])
    expect([...r.porPasso.entries()].map(([cid, l]) => [cid, l.map((i) => i.codigo)])).toEqual([
      ['sim', ['etiqueta_nao_escolhida']],
      ['nao', ['tarefa_sem_responsavel']],
      ['fim', ['mensagem_sem_texto']],
    ])
    expect(r.doGatilho.map((i) => i.codigo)).toEqual(['gatilho_sem_etiqueta'])
    expect(r.gerais).toEqual([])
  })
})

describe('localDoPasso', () => {
  const arvore = [
    p('r0'),
    cond('r1', [p('s0'), cond('s1', [p('s1-sim')], [p('s1-nao-0'), p('s1-nao-1')])], [p('n0')]),
    p('r2'),
  ]

  it('na raiz: o número na lista, sem ramo nem pai', () => {
    expect(localDoPasso(arvore, 'r2')).toEqual({
      numero: 3,
      ramo: null,
      pai: null,
      cadeia: [{ cid: 'r2', numero: 3, ramo: null }],
    })
  })

  it('dentro de um ramo: o número conta do 1 no ramo, e o pai é a condição', () => {
    expect(localDoPasso(arvore, 'n0')).toEqual({
      numero: 1,
      ramo: 'no',
      pai: { cid: 'r1', numero: 2, ramo: null },
      cadeia: [
        { cid: 'r1', numero: 2, ramo: null },
        { cid: 'n0', numero: 1, ramo: 'no' },
      ],
    })
  })

  it('aninhado: a cadeia inteira, da raiz até o passo', () => {
    const local = localDoPasso(arvore, 's1-nao-1')
    expect(local?.numero).toBe(2)
    expect(local?.ramo).toBe('no')
    expect(local?.pai).toEqual({ cid: 's1', numero: 2, ramo: 'yes' })
    expect(local?.cadeia.map((d) => [d.cid, d.numero, d.ramo])).toEqual([
      ['r1', 2, null],
      ['s1', 2, 'yes'],
      ['s1-nao-1', 2, 'no'],
    ])
  })

  it('cid que não está na árvore é null', () => {
    expect(localDoPasso(arvore, 'sumiu')).toBeNull()
    expect(localDoPasso([], 'r0')).toBeNull()
  })
})

describe('chaveDaPendencia', () => {
  it('código conhecido vira a chave relativa a Automations.builder', () => {
    expect(chaveDaPendencia({ codigo: 'tarefa_sem_responsavel' })).toBe('pendencias.codigos.tarefa_sem_responsavel')
  })

  it('sem código, ou código que este bundle não conhece: null (a tela mostra o message)', () => {
    expect(chaveDaPendencia({})).toBeNull()
    expect(chaveDaPendencia({ codigo: undefined })).toBeNull()
    expect(chaveDaPendencia({ codigo: 'codigo_do_servidor_mais_novo' })).toBeNull()
    expect(chaveDaPendencia({ codigo: 42 })).toBeNull()
    // Nada de percorrer o protótipo: "toString" não é código.
    expect(chaveDaPendencia({ codigo: 'toString' })).toBeNull()
  })
})

describe('avisosDaAutomacao', () => {
  const acionar = (cid: string, automation_id: unknown) => p(cid, 'run_automation', { automation_id })
  const robo = (cid: string, flow_id: unknown) => p(cid, 'run_flow', { flow_id })
  const referencias = {
    automacoes: [
      { id: 'ligada', is_active: true },
      { id: 'desligada', is_active: false },
      { id: 'regua', is_active: false, trigger_type: 'asaas_cobranca_vencida' },
      { id: 'atlas', is_active: true, trigger_type: 'atlas_situacao_mudou' },
    ],
    robos: [
      { id: 'ativo', status: 'active' },
      { id: 'rascunho', status: 'draft' },
      { id: 'arquivado', status: 'archived' },
    ],
  }

  it('acionar automação desligada ou apagada; a ligada não avisa', () => {
    const avisos = avisosDaAutomacao(
      [acionar('a', 'ligada'), acionar('b', 'desligada'), acionar('c', 'apagada')],
      referencias,
    )
    expect(avisos.map((a) => [a.path, a.codigo])).toEqual([
      ['steps[1].automation_id', 'acionar_automacao_desligada'],
      ['steps[2].automation_id', 'acionar_automacao_apagada'],
    ])
  })

  it('acionar a régua do Asaas avisa pela régua, não por estar desligada', () => {
    const avisos = avisosDaAutomacao([acionar('a', 'regua')], referencias)
    expect(avisos.map((a) => [a.path, a.codigo])).toEqual([
      ['steps[0].automation_id', 'acionar_automacao_da_regua'],
    ])
  })

  it('acionar a "Situação mudou no Atlas" avisa (ela só roda pela leitura do Atlas), mesmo ligada', () => {
    const avisos = avisosDaAutomacao([acionar('a', 'atlas')], referencias)
    expect(avisos.map((a) => [a.path, a.codigo])).toEqual([['steps[0].automation_id', 'acionar_automacao_do_atlas']])
  })

  it('iniciar robô em rascunho, arquivado ou apagado; o ativo não avisa', () => {
    const avisos = avisosDaAutomacao(
      [robo('a', 'ativo'), robo('b', 'rascunho'), robo('c', 'arquivado'), robo('d', 'apagado')],
      referencias,
    )
    expect(avisos.map((a) => [a.path, a.codigo])).toEqual([
      ['steps[1].flow_id', 'iniciar_robo_desligado'],
      ['steps[2].flow_id', 'iniciar_robo_desligado'],
      ['steps[3].flow_id', 'iniciar_robo_apagado'],
    ])
  })

  it('percorre os ramos, com os endereços que localizarPendencias entende', () => {
    const arvore = [p('r0'), cond('c', [acionar('sim', 'desligada')], [p('n0'), robo('nao', 'apagado')])]
    const avisos = avisosDaAutomacao(arvore, referencias)
    expect(avisos.map((a) => a.path)).toEqual(['steps[1].yes.steps[0].automation_id', 'steps[1].no.steps[1].flow_id'])
    const r = localizarPendencias(arvore, avisos)
    expect([...r.porPasso.keys()]).toEqual(['sim', 'nao'])
    expect(r.gerais).toEqual([])
  })

  it('lista que não carregou (null) não afirma nada — nem "apagada"', () => {
    const arvore = [acionar('a', 'qualquer'), robo('b', 'qualquer')]
    expect(avisosDaAutomacao(arvore, { automacoes: null, robos: null })).toEqual([])
    // Só a de robôs carregou: só ela avisa.
    expect(avisosDaAutomacao(arvore, { automacoes: null, robos: [] }).map((a) => a.codigo)).toEqual([
      'iniciar_robo_apagado',
    ])
  })

  it('alvo vazio é pendência da validação, não aviso', () => {
    expect(avisosDaAutomacao([acionar('a', ''), acionar('b', undefined), robo('c', '  ')], referencias)).toEqual([])
  })
})

// ============================================================
// O `codigo` vira chave MONTADA na tela (`pendencias.codigos.<codigo>`), e
// chave montada escapa do portão de i18n do CI. Este bloco é o portão: colhe
// os literais dos dois arquivos que produzem código e cobra a lista e as
// frases nos dois dicionários.
// ============================================================

const RAIZ = join(__dirname, '..', '..', '..')
const fonte = (arq: string) =>
  readFileSync(join(RAIZ, 'src', 'lib', 'automations', arq), 'utf8')
    // Fora os comentários: um exemplo num comentário não é código produzido.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
const dicionario = (arq: string) =>
  JSON.parse(readFileSync(join(RAIZ, 'messages', arq), 'utf8')) as Record<string, Record<string, Record<string, unknown>>>

function colherCodigos(texto: string): string[] {
  const achados: string[] = []
  for (const m of texto.matchAll(/\bcodigo:\s*(\S)/g)) {
    // Todo `codigo:` tem de ser seguido de um LITERAL — ternário, variável ou
    // template montariam a chave em execução, e o teste não a enxergaria.
    expect(m[1], `codigo não literal perto de: ${texto.slice(m.index, (m.index ?? 0) + 60)}`).toBe("'")
  }
  for (const m of texto.matchAll(/\bcodigo:\s*'([^']*)'/g)) achados.push(m[1])
  return achados
}

describe('todo código tem lista e frase nos dois dicionários', () => {
  const colhidos = new Set([...colherCodigos(fonte('validate.ts')), ...colherCodigos(fonte('pendencias.ts'))])

  it('o colhedor acha os códigos (senão o resto passaria vazio)', () => {
    expect(colhidos.size).toBeGreaterThan(60)
    expect(colhidos).toContain('tarefa_sem_responsavel')
    expect(colhidos).toContain('acionar_automacao_desligada')
  })

  it('CODIGOS_DE_PENDENCIA é exatamente o que os arquivos produzem', () => {
    expect([...colhidos].sort()).toEqual([...CODIGOS_DE_PENDENCIA].sort())
    expect(new Set(CODIGOS_DE_PENDENCIA).size).toBe(CODIGOS_DE_PENDENCIA.length)
  })

  for (const [arq, locale] of [
    ['pt-BR.json', 'pt-BR'],
    ['en.json', 'en'],
  ] as const) {
    it(`${arq}: uma frase por código, sem órfã, e todas renderizam`, () => {
      const messages = dicionario(arq)
      const codigos = messages.Automations.builder.pendencias as Record<string, unknown>
      expect(Object.keys(codigos.codigos as object).sort()).toEqual([...CODIGOS_DE_PENDENCIA].sort())

      const t = createTranslator({ locale, messages, namespace: 'Automations.builder' }) as unknown as (
        chave: string,
        valores?: Record<string, string | number>,
      ) => string
      const semSobra = (texto: string, onde: string) => {
        // Chave ausente volta como o caminho; valor faltando deixa "{x}".
        expect(texto, onde).not.toMatch(/Automations\.builder|pendencias\.|\{/)
        expect(texto.trim().length, onde).toBeGreaterThan(0)
      }
      for (const codigo of CODIGOS_DE_PENDENCIA) {
        const chave = chaveDaPendencia({ codigo })
        expect(chave, codigo).not.toBeNull()
        semSobra(t(chave as string), codigo)
      }
      for (const count of [1, 3]) {
        semSobra(t('pendencias.titulo', { count }), `titulo ${count}`)
        semSobra(t('pendencias.toast', { count }), `toast ${count}`)
        expect(t('pendencias.titulo', { count })).toContain(String(count))
        expect(t('pendencias.toast', { count })).toContain(String(count))
      }
      for (const chave of ['atencao', 'gatilho', 'automacao']) semSobra(t(`pendencias.${chave}`), chave)
      for (const chave of ['passo', 'ramoSim', 'ramoNao']) {
        const texto = t(`pendencias.${chave}`, { numero: 7 })
        semSobra(texto, chave)
        expect(texto, chave).toContain('7')
      }
    })
  }
})
