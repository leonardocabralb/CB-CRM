/**
 * O ambiente do computador de ligações (docs/PLANO-ligar-pelo-crm.md, §8.13).
 * Nenhum endereço nosso mora no código: tudo chega por aqui.
 */
export interface Config {
  /** O segredo que o CRM e a máquina compartilham (cabeçalho, nos dois sentidos). */
  segredo: string
  /** Para onde vão os avisos e as gravações; nulo = só no log (sem CRM). */
  urlDoCrm: string | null
  /** O nome desta máquina nos avisos (o número dela: ex. `previdenciario`). */
  computador: string
}

export function lerConfig(env: Record<string, string | undefined>): Config {
  const segredo = (env.LIGACOES_SEGREDO ?? '').trim()
  if (segredo.length < 32) {
    throw new Error('LIGACOES_SEGREDO ausente ou curto demais (mínimo de 32 caracteres)')
  }

  const computador = (env.LIGACOES_COMPUTADOR ?? '').trim()
  if (!/^[a-z0-9-]{1,40}$/.test(computador)) {
    throw new Error('LIGACOES_COMPUTADOR inválido (só a-z, 0-9 e -, até 40)')
  }

  const url = (env.LIGACOES_URL_DO_CRM ?? '').trim()
  let urlDoCrm: string | null = null
  if (url) {
    let lida: URL
    try {
      lida = new URL(url)
    } catch {
      throw new Error('LIGACOES_URL_DO_CRM não é um endereço')
    }
    if (lida.protocol !== 'http:' && lida.protocol !== 'https:') {
      throw new Error('LIGACOES_URL_DO_CRM precisa ser http ou https')
    }
    urlDoCrm = url.replace(/\/+$/, '')
  }

  return { segredo, urlDoCrm, computador }
}
