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

import { formatarTelefone, telefoneCanonico } from '@/lib/contacts/telefone';

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
 * O número como sai: o que o cliente consegue salvar E ligar.
 *
 * ⚠️ Pela grafia CANÔNICA (`telefoneCanonico`): o `display_phone` da
 * Evolution é o JID, e o JID de celular antigo (DDD 31 em diante) vem SEM o
 * nono dígito — "(96) 9000-0016" não liga; "(96) 99000-0016" sim. Fixo
 * (começa em 2–5) fica como está. O da Meta já chega formatado ("+55 11
 * 5000-0001") e passa pelos dígitos.
 *
 * Na mensagem, a forma de `formatarTelefone`, a mesma de toda tela do CRM. No
 * dado (`cru`: "Atualizar campo", corpo do webhook), só os dígitos com o DDI.
 * Sem número, vazio — quem envia não deixa chegar aqui (`numerosDasConexoes`
 * falha antes).
 */
export function numeroDaConexao(displayPhone: string | null | undefined, cru: boolean): string {
  const canonico = telefoneCanonico(displayPhone);
  if (!canonico) return '';
  return cru ? canonico : formatarTelefone(canonico);
}
