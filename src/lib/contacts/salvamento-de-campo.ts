// ============================================================
// Campo personalizado que salva sozinho (Fase B1).
//
// As DUAS perguntas que as três superfícies de edição precisam responder
// igual: "que gesto confirma este campo?" e "mudou de verdade?". Duas cópias
// divergiriam na primeira correção — e divergir aqui é gravar (ou não gravar)
// coisa diferente para o mesmo gesto, em telas que editam o MESMO dado.
// ============================================================

import { TIPO_DATA } from "@/lib/contacts/campo-data";

/**
 * O gesto que confirma o campo é SAIR dele (`blur`)?
 *
 * ⚠️ `select` é a exceção, e é o mesmo raciocínio do seletor de etapa do
 * negócio: escolher no popover JÁ é o gesto inteiro — o popover fecha e não
 * há blur útil para esperar. Nos demais, gravar a cada tecla escreveria uma
 * linha por letra digitada.
 *
 * ⚠️ O campo de DATA fica no blur de propósito, apesar de o `<input
 * type="datetime-local">` disparar `change`: ele dispara a cada PEDAÇO
 * digitado, com valores intermediários que são datas de verdade e absurdas
 * ("0002-01-01" a caminho de "2026-01-01"). Gravar isso encheria a coluna de
 * lixo — e a 935 lê essa coluna para disparar lembrete.
 */
export function gravaAoSair(fieldType: string): boolean {
  return fieldType !== "select";
}

/** O contrário: o gesto é a própria escolha. */
export function gravaAoEscolher(fieldType: string): boolean {
  return !gravaAoSair(fieldType);
}

/**
 * O valor mudou, do ponto de vista do que fica GRAVADO?
 *
 * ⚠️ Compara APARADO porque `salvarValoresDoContato` grava `v.trim()` e trata
 * `""` como exclusão da linha. Sem o `trim` dos dois lados, entrar num campo
 * que a automação preencheu com `" 300 "` e sair sem tocar em nada gravaria
 * `"300"` — uma escrita no banco que ninguém pediu, e que num CRM jurídico
 * aparece como "alguém editou a ficha".
 */
export function valorMudou(salvo: string, novo: string): boolean {
  return salvo.trim() !== novo.trim();
}

/**
 * Reexportado para quem monta o campo não precisar importar de dois lugares
 * só para saber o que é uma data.
 */
export { TIPO_DATA };
