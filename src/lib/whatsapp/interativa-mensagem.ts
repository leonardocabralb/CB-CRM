// ============================================================
// A falha da validação da mensagem interativa, no idioma do app.
//
// `validateInteractivePayload` (`interactive.ts`, do original) devolve o
// `error` em INGLÊS, e ele é CONTRATO: as rotas de respostas rápidas o
// devolvem no 400, o núcleo de envio o põe no `SendMessageError` e a
// ativação de automação o lista. Só que duas TELAS o mostravam cru — o
// construtor da interativa (`{validation.error}`) e o compositor
// (`toast.error(result.error)`) —, e o operador lia "Add at least one reply
// button." com o resto em português.
//
// A falha carrega também um `codigo` (e `params`), e a tela traduz por
// aqui. Chave LITERAL por código, nunca montada: o portão de i18n confere
// cada uma, e o `switch` com `never` faz o compilador cobrar código novo.
// O tradutor chega de fora, amarrado a `Interactive.validacao` — o teste
// (`interativa-mensagem.test.ts`) confere cada chave nos dois dicionários.
// ============================================================

/** Todo motivo de recusa da interativa. Código novo entra aqui primeiro. */
export const CODIGOS_DA_INTERATIVA = [
  'payloadAusente',
  'corpoAusente',
  'corpoLongo',
  'cabecalhoLongo',
  'rodapeLongo',
  'botoesAusentes',
  'botoesDemais',
  'botaoSemId',
  'botaoIdDuplicado',
  'botaoSemRotulo',
  'botaoRotuloLongo',
  'listaSemRotuloDoBotao',
  'listaRotuloDoBotaoLongo',
  'secoesAusentes',
  'secoesDemais',
  'secaoSemLinhas',
  'linhaSemId',
  'linhaIdDuplicado',
  'linhaSemTitulo',
  'linhaTituloLongo',
  'linhaDescricaoLonga',
  'linhasAusentes',
  'linhasDemais',
  'tipoInvalido',
] as const

export type CodigoDaInterativa = (typeof CODIGOS_DA_INTERATIVA)[number]

/** Os valores que a frase usa: o limite, o id repetido, o texto longo. */
export interface ParametrosDaInterativa {
  max?: number
  id?: string
  texto?: string
}

/** O tradutor de `Interactive.validacao` (o `t` do next-intl serve). */
export type TradutorDaValidacao = (
  chave: string,
  valores?: Record<string, string | number>,
) => string

export function mensagemDaInterativa(
  falha: { codigo: CodigoDaInterativa; params?: ParametrosDaInterativa },
  t: TradutorDaValidacao,
): string {
  const max = falha.params?.max ?? 0
  const id = falha.params?.id ?? ''
  const texto = falha.params?.texto ?? ''
  switch (falha.codigo) {
    case 'payloadAusente':
      return t('payloadAusente')
    case 'corpoAusente':
      return t('corpoAusente')
    case 'corpoLongo':
      return t('corpoLongo', { max })
    case 'cabecalhoLongo':
      return t('cabecalhoLongo', { max })
    case 'rodapeLongo':
      return t('rodapeLongo', { max })
    case 'botoesAusentes':
      return t('botoesAusentes')
    case 'botoesDemais':
      return t('botoesDemais', { max })
    case 'botaoSemId':
      return t('botaoSemId')
    case 'botaoIdDuplicado':
      return t('botaoIdDuplicado', { id })
    case 'botaoSemRotulo':
      return t('botaoSemRotulo')
    case 'botaoRotuloLongo':
      return t('botaoRotuloLongo', { texto, max })
    case 'listaSemRotuloDoBotao':
      return t('listaSemRotuloDoBotao')
    case 'listaRotuloDoBotaoLongo':
      return t('listaRotuloDoBotaoLongo', { max })
    case 'secoesAusentes':
      return t('secoesAusentes')
    case 'secoesDemais':
      return t('secoesDemais', { max })
    case 'secaoSemLinhas':
      return t('secaoSemLinhas')
    case 'linhaSemId':
      return t('linhaSemId')
    case 'linhaIdDuplicado':
      return t('linhaIdDuplicado', { id })
    case 'linhaSemTitulo':
      return t('linhaSemTitulo')
    case 'linhaTituloLongo':
      return t('linhaTituloLongo', { texto, max })
    case 'linhaDescricaoLonga':
      return t('linhaDescricaoLonga', { max })
    case 'linhasAusentes':
      return t('linhasAusentes')
    case 'linhasDemais':
      return t('linhasDemais', { max })
    case 'tipoInvalido':
      return t('tipoInvalido')
    default: {
      const nunca: never = falha.codigo
      return nunca
    }
  }
}
