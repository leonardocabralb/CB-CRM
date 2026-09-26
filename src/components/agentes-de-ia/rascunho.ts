// ============================================================
// O que mudou na Configuração de um agente (F1b). PURO, testado.
//
// O Salvar manda SÓ o que mudou em relação ao que está salvo. Mandar tudo
// travava a tela quando um valor guardado deixava de valer por fora dela: o
// membro que recebia as transferências saiu da equipe, e TODO salvamento —
// até o de uma vírgula nas instruções — voltava 400 `membro_de_outra_conta`
// (revisão da F1b). E é o que diz à aba Playground que há alteração não
// salva.
//
// ⚠️ A comparação espelha o que a rota faz com o valor (`lerAlteracao`): texto
// aparado, regra vazia descartada, lista de ids sem ordem. Sem isso, um
// espaço no fim do nome contaria como "mudou" para sempre.
// ============================================================

import type { AiProvider } from '@/lib/ai/types'
import type { Horario, IaAgente } from './tipos'

export interface Rascunho {
  nome: string
  descricao: string
  instrucoes: string
  regras: string[]
  provedor: AiProvider
  modelo: string
  ativo: boolean
  conexoes: string[]
  horario: Horario | null
  tetoRespostas: number
  transferirPara: string | null
  podePassarPara: string[]
}

function regrasLimpas(regras: string[]): string[] {
  return regras.map((r) => r.trim()).filter((r) => r.length > 0)
}

function mesmoConjunto(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every((x) => s.has(x))
}

function mesmoHorario(a: Horario | null, b: Horario | null): boolean {
  if (a === null || b === null) return a === b
  return a.inicio === b.inicio && a.fim === b.fim && mesmoConjunto(a.dias.map(String), b.dias.map(String))
}

/**
 * O corpo do PATCH: só as chaves que mudaram, com os nomes da rota. Vazio =
 * nada a salvar.
 */
export function alteracoesDoRascunho(salvo: IaAgente, r: Rascunho): Record<string, unknown> {
  const corpo: Record<string, unknown> = {}
  if (r.nome.trim() !== salvo.nome) corpo.nome = r.nome
  if (r.descricao.trim() !== salvo.descricao) corpo.descricao = r.descricao
  if (r.instrucoes.trim() !== salvo.instrucoes) corpo.instrucoes = r.instrucoes
  const regras = regrasLimpas(r.regras)
  if (regras.length !== salvo.regras.length || regras.some((x, i) => x !== salvo.regras[i])) {
    corpo.regras = regras
  }
  if (r.provedor !== salvo.provedor) corpo.provedor = r.provedor
  if (r.modelo.trim() !== salvo.modelo) corpo.modelo = r.modelo
  if (r.ativo !== salvo.ativo) corpo.ativo = r.ativo
  if (!mesmoConjunto(r.conexoes, salvo.conexoes)) corpo.conexoes = r.conexoes
  if (!mesmoHorario(r.horario, salvo.horario)) corpo.horario = r.horario
  if (r.tetoRespostas !== salvo.tetoRespostas) corpo.teto_respostas = r.tetoRespostas
  if (r.transferirPara !== salvo.transferirPara) corpo.transferir_para = r.transferirPara
  if (!mesmoConjunto(r.podePassarPara, salvo.podePassarPara)) corpo.pode_passar_para = r.podePassarPara
  return corpo
}

/** "12" → 12; vazio, fração ou fora de 1..100 → `null` (o campo avisa, o Salvar trava). */
export function lerTeto(texto: string, min: number, max: number): number | null {
  const t = texto.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n >= min && n <= max ? n : null
}
