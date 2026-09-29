/**
 * Os códigos `{{…}}` de um texto de automação — pela MESMA régua do motor.
 *
 * ⚠️⚠️ `FONTE_DO_CODIGO` é o `RE_VARIAVEL` do `engine.ts`, letra por letra (há
 * pino lendo o fonte do motor). O editor pinta como etiqueta EXATAMENTE o que
 * o envio vai substituir: um `{{contact.campo.<chave>}}` (com `<`) não casa e
 * fica texto no envio — e fica texto na tela também. Uma régua mais larga que
 * a do motor mostraria etiqueta sobre algo que sai cru para o cliente.
 *
 * A fonte é exportada, nunca a expressão: expressão com `g` guarda
 * `lastIndex` entre chamadas, e dois módulos dividindo o mesmo objeto se
 * atrapalhariam. Cada uso cria a sua.
 */
export const FONTE_DO_CODIGO = String.raw`\{\{\s*([\w.]+)\s*\}\}`;

export type PedacoDoTexto =
  | { tipo: 'texto'; texto: string }
  | {
      tipo: 'codigo';
      /** Como está escrito no texto, espaços inclusive (`{{ now }}`). */
      bruto: string;
      /** O que vai entre as chaves, sem espaços: `contact.name`. */
      codigo: string;
    };

/** O texto repartido em pedaços de texto e códigos, na ordem. */
export function pedacosDoTexto(texto: string): PedacoDoTexto[] {
  const pedacos: PedacoDoTexto[] = [];
  let desde = 0;
  for (const m of texto.matchAll(new RegExp(FONTE_DO_CODIGO, 'g'))) {
    const inicio = m.index ?? 0;
    if (inicio > desde) pedacos.push({ tipo: 'texto', texto: texto.slice(desde, inicio) });
    pedacos.push({ tipo: 'codigo', bruto: m[0], codigo: m[1] });
    desde = inicio + m[0].length;
  }
  if (desde < texto.length) pedacos.push({ tipo: 'texto', texto: texto.slice(desde) });
  return pedacos;
}

/** Os códigos citados no texto, sem repetição, na ordem em que aparecem. */
export function codigosDoTexto(texto: string): string[] {
  const vistos = new Set<string>();
  for (const p of pedacosDoTexto(texto)) if (p.tipo === 'codigo') vistos.add(p.codigo);
  return [...vistos];
}

/**
 * O texto com cada código trocado pelo que `troca` devolver — para LEITURA
 * (o resumo do passo fechado), nunca para gravar.
 */
export function trocarCodigos(texto: string, troca: (codigo: string, bruto: string) => string): string {
  return pedacosDoTexto(texto)
    .map((p) => (p.tipo === 'texto' ? p.texto : troca(p.codigo, p.bruto)))
    .join('');
}

/** O texto que o botão "Inserir campo" escreve para um código. */
export function textoDoCodigo(codigo: string): string {
  return `{{${codigo}}}`;
}
