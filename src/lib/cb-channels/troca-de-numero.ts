// ============================================================
// O "Reparear" leu o QR com OUTRO chip? (03/10/2026)
//
// Trocar o chip de uma conexão por QR Code é "Reparear" na MESMA conexão
// (decisão do operador): tudo que aponta para ela — automações, robôs,
// filtros, conversas, funil de entrada — continua valendo, e só o número
// muda. O número novo chega por DOIS caminhos, e os dois gravam:
//
//  - a rota `/connect` (a tela do QR consulta a cada 5 s), pela linha da
//    instância em `fetchInstances` — `numeroDoPareamento`;
//  - o aviso `connection.update` da Evolution (o `wuid`), que sai DEPOIS de a
//    Evolution gravar o número — `registrarNumeroDoAviso`.
//
// ⚠️⚠️ A Evolution responde "aberta" ANTES de gravar o número do pareamento
// novo: no meio há a busca da foto de perfil (segundos). Nessa janela a linha
// de `fetchInstances` ainda traz o `ownerJid` do chip ANTERIOR, com
// `connectionStatus` ainda 'connecting' — os dois são gravados no MESMO
// update. Ler o número sem conferir o status gravava o número velho, e a
// variável do número da conexão seguia mandando o velho a todo cliente.
//
// O que não se atualizaria sozinho é o LID do próprio aparelho
// (`cb_channels.own_lid`, 916): ele é aprendido UMA vez, sobre nulo
// (`aprenderNossoLid`, a sincronização dos grupos). Com o chip novo, o LID
// velho ficaria para sempre — a ligação feita pelo aparelho novo deixaria de
// ser "do escritório" (`ligacoes/registrar.ts`) e a menção ao número num
// grupo não acenderia (`mencionaNos`). Número mudou → `own_lid` volta a nulo
// e é reaprendido.
//
// Puro, mais `registrarNumeroDoAviso` (I/O, nunca lança).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { telefoneDoJid } from '@/lib/whatsapp/ligacoes/telefone';

function digitos(telefone: string | null | undefined): string {
  return (telefone ?? '').replace(/\D/g, '');
}

/**
 * O pareamento que acabou de abrir é de OUTRO número? Pelos dígitos (o mesmo
 * chip não vira outro por formatação). Sem o número agora (a Evolution não o
 * informou), não há o que afirmar. Sem número antes, conta como troca: zerar
 * um `own_lid` que já é nulo não custa nada, e o de um número que o CRM não
 * registrou não se confere.
 */
export function trocouDeNumero(
  antes: string | null | undefined,
  agora: string | null | undefined,
): boolean {
  const novo = digitos(agora);
  return novo !== '' && digitos(antes) !== novo;
}

/**
 * O número pareado, lido da linha da instância em `fetchInstances`.
 * `pendente`: a Evolution ainda não gravou o pareamento novo (o status
 * gravado não é 'open') — o `ownerJid` ali é o do chip anterior, e quem
 * pergunta espera a próxima consulta. Status AUSENTE (versão que não o
 * devolve) não trava: vale o `ownerJid`, como antes.
 */
export function numeroDoPareamento(
  linha: { ownerJid?: unknown; connectionStatus?: unknown } | null | undefined,
): { numero?: string; pendente: boolean } {
  if (!linha) return { pendente: false };
  if (typeof linha.connectionStatus === 'string' && linha.connectionStatus !== 'open') {
    return { pendente: true };
  }
  const numero = typeof linha.ownerJid === 'string' ? telefoneDoJid(linha.ownerJid) : null;
  return numero ? { numero, pendente: false } : { pendente: false };
}

/**
 * O número do aviso `connection.update` da Evolution: só na conexão ABERTA,
 * e só de um JID de telefone (`wuid`, o `client.user.id` sem o aparelho).
 * `null` no resto — LID, aviso de queda, corpo sem `wuid`.
 */
export function numeroDoAvisoDeConexao(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { state?: unknown; wuid?: unknown };
  if (d.state !== 'open' || typeof d.wuid !== 'string') return null;
  return telefoneDoJid(d.wuid);
}

/**
 * Grava o número do aviso na conexão — e, se ele MUDOU, zera o `own_lid`. A
 * condição vive no WHERE (`display_phone` nulo ou diferente): o mesmo número
 * de novo não escreve nada, e a corrida com a rota `/connect` (que grava o
 * mesmo número pela outra via) não desfaz a troca.
 *
 * Nunca lança: roda no `after()` do webhook, e perder o número aqui ainda
 * deixa a rota `/connect` (falha vira log).
 */
export async function registrarNumeroDoAviso(
  db: SupabaseClient,
  instanceName: string,
  numero: string,
): Promise<void> {
  try {
    const { error } = await db
      .from('cb_channels')
      .update({ display_phone: numero, own_lid: null })
      .eq('instance_name', instanceName)
      .eq('kind', 'evolution')
      .or(`display_phone.is.null,display_phone.neq.${numero}`);
    if (error) {
      console.warn('[cb-channels] gravar o número do pareamento falhou (ignorado):', error.message);
    }
  } catch (err) {
    console.warn(
      '[cb-channels] gravar o número do pareamento falhou (ignorado):',
      err instanceof Error ? err.message : err,
    );
  }
}
