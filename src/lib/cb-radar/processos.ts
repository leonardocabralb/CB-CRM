// ============================================================
// Número de processo judicial (formato CNJ) por REGEX — determinístico,
// custo zero, sem alucinação. A IA cobre a menção SEMÂNTICA ("minha
// audiência", "o recurso"); isto aqui cobre o número em si.
//
// Formato CNJ (Res. 65/2008): NNNNNNN-DD.AAAA.J.TR.OOOO
//   7 dígitos sequencial - 2 dígito verificador . ano . segmento .
//   tribunal . origem
//
// Só o formato COM pontuação é aceito, de propósito: os 20 dígitos crus
// colados a outros números (CPF+telefone numa mesma frase) geram falso
// positivo, e cliente que cita processo por escrito quase sempre cola o
// número formatado do PJe/e-SAJ.
// ============================================================

const CNJ_REGEX = /\b(\d{7})-(\d{2})\.(\d{4})\.(\d)\.(\d{2})\.(\d{4})\b/g

/** Números de processo (formato CNJ) encontrados no texto, sem repetição,
 *  na ordem em que aparecem. */
export function extrairNumerosDeProcesso(texto: string): string[] {
  const vistos = new Set<string>()
  const achados: string[] = []
  for (const m of texto.matchAll(CNJ_REGEX)) {
    if (!vistos.has(m[0])) {
      vistos.add(m[0])
      achados.push(m[0])
    }
  }
  return achados
}
