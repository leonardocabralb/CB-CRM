// ============================================================
// As falhas de `uploadAccountMedia` que acontecem ANTES do upload — sem
// sessão, ou sem conta resolvida —, com um motivo que a TELA traduz.
//
// As cinco telas que sobem arquivo (compositor, acervo, modelos, mídia do
// fluxo, mídia da automação) mostravam `err.message` cru, e o operador lia
// "Not signed in." com o resto em português. A mensagem em inglês continua
// na exceção (quem loga a vê igual); a tela passa por `mensagemDoUpload`.
// Chave LITERAL por motivo; o tradutor chega amarrado a `Upload` — o teste
// (`erro-de-upload.test.ts`) confere as chaves nos dois dicionários.
// ============================================================

export type MotivoDoErroDeUpload = 'semSessao' | 'semConta'

export class ErroDeUpload extends Error {
  constructor(
    readonly motivo: MotivoDoErroDeUpload,
    mensagem: string,
  ) {
    super(mensagem)
    this.name = 'ErroDeUpload'
  }
}

/**
 * O texto da falha do upload para a tela: o motivo traduzido quando é uma
 * das nossas; senão a mensagem do erro (a do Storage vem como está); senão o
 * `fallback` do chamador.
 */
export function mensagemDoUpload(
  err: unknown,
  t: (chave: string) => string,
  fallback: string,
): string {
  if (err instanceof ErroDeUpload) {
    switch (err.motivo) {
      case 'semSessao':
        return t('semSessao')
      case 'semConta':
        return t('semConta')
      default: {
        const nunca: never = err.motivo
        return nunca
      }
    }
  }
  return err instanceof Error ? err.message : fallback
}
