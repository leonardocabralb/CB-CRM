/**
 * O NÚMERO de uma conexão no texto da automação: `{{channel.<id>.phone}}`
 * (03/10/2026).
 *
 * O chip de um número pode cair (ban) ou ser trocado, e o número escrito à
 * mão na mensagem ("o atendimento passa ao Jurídico: (96) 9000-0016") continua
 * mandando o cliente para o número velho. A variável aponta para a CONEXÃO: o
 * "Reparear" com o chip novo grava o número novo nela, e a mensagem acompanha
 * sozinha.
 *
 * O id vai no código com `_` no lugar de `-`: o `RE_VARIAVEL` do motor só
 * aceita `[\w.]` entre as chaves (e o editor pinta a etiqueta pela mesma
 * régua, `FONTE_DO_CODIGO`). Alargar a régua mudaria o que sai de todo texto
 * que já existe.
 *
 * Puro: o motor (`engine.ts`) e o seletor do construtor (`contexto.tsx`) usam
 * as MESMAS funções, então a prévia não diverge do que sai.
 */

import { formatarTelefone } from '@/lib/contacts/telefone';

import { codigosDoTexto } from './codigos';

const RE_CODIGO_DA_CONEXAO =
  /^channel\.([0-9a-f]{8}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{12})\.phone$/;

/** O código que o botão "Inserir campo" escreve para o número de uma conexão. */
export function codigoDoNumeroDaConexao(channelId: string): string {
  return `channel.${channelId.toLowerCase().replace(/-/g, '_')}.phone`;
}

/**
 * O id (com hífens) da conexão citada; `null` quando o código não é o número
 * de uma conexão. Só a forma EXATA: `channel.<id>.phone.x` e `channel.<id>`
 * saem em branco no motor, e a etiqueta diz isso.
 */
export function conexaoDoCodigo(codigo: string): string | null {
  const m = RE_CODIGO_DA_CONEXAO.exec(codigo);
  return m ? m[1].replace(/_/g, '-') : null;
}

/** Os ids das conexões cujo número o texto cita, sem repetição. */
export function conexoesDoTexto(texto: string): string[] {
  const ids = new Set<string>();
  for (const codigo of codigosDoTexto(texto)) {
    const id = conexaoDoCodigo(codigo);
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * O número como sai. Na mensagem, a forma de `formatarTelefone` — "(96)
 * 9000-0016", a mesma de toda tela do CRM. No dado (`cru`: "Atualizar campo",
 * corpo do webhook), só os dígitos com o DDI. O `display_phone` da Meta já
 * chega formatado ("+55 11 5000-0001") e o da Evolution em dígitos: os dois
 * passam pelos dígitos. Sem número, vazio — quem envia não deixa chegar aqui
 * (`numerosDasConexoes` falha antes).
 */
export function numeroDaConexao(displayPhone: string | null | undefined, cru: boolean): string {
  const digitos = (displayPhone ?? '').replace(/\D/g, '');
  if (!digitos) return '';
  return cru ? digitos : formatarTelefone(digitos);
}
