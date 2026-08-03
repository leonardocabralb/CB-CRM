// ============================================================
// Como um GRUPO aparece na tela. Funções puras, sem React — é o que dá para
// cobrir com teste neste projeto (o vitest roda em `environment: "node"`, sem
// testing-library, então componente não renderiza em teste). Mesmo desenho de
// `cb-channels/display.ts`.
//
// ⚠️ Os textos de fallback ENTRAM POR PARÂMETRO, nunca embutidos aqui. Quem
// chama tem o `t()` do next-intl; embutir "Grupo sem nome" faria uma string
// visível escapar do dicionário e nunca ser traduzida.
// ============================================================

import type { CbGroup, Conversation } from '@/types';

/** A conversa é de grupo? */
export function ehConversaDeGrupo(conversa: Conversation | null | undefined): boolean {
  return !!conversa?.group_id;
}

/**
 * Nome do grupo na tela.
 *
 * O apelido interno vence o nome real de propósito: quem apelidou um grupo
 * quis ver o apelido. O `subject` fica visível no painel do grupo, para o
 * operador conferir a que grupo do WhatsApp aquele apelido corresponde.
 */
export function nomeDoGrupo(
  grupo: Pick<CbGroup, 'alias' | 'subject'> | null | undefined,
  textoSemNome: string,
): string {
  const apelido = grupo?.alias?.trim();
  if (apelido) return apelido;
  const nome = grupo?.subject?.trim();
  if (nome) return nome;
  return textoSemNome;
}

/**
 * Título da conversa, seja ela de grupo ou de contato. Existe para a lista e
 * o cabeçalho não repetirem a mesma cadeia de `??` em quatro lugares e
 * discordarem entre si com o tempo.
 */
export function tituloDaConversa(
  // Só os três campos que a regra usa, e não a `Conversation` inteira: a tela
  // global de agendadas embute a conversa com um `select` estreito (sem
  // etiquetas, sem contadores), e exigir o tipo cheio ali obrigaria ou a
  // engordar aquela consulta ou a reescrever esta regra num segundo lugar —
  // que é exatamente o que esta função existe para impedir.
  conversa: Pick<Conversation, 'group_id' | 'group' | 'contact'>,
  textos: { semNome: string; desconhecido: string },
): string {
  if (conversa.group_id) return nomeDoGrupo(conversa.group, textos.semNome);
  return conversa.contact?.name?.trim() || conversa.contact?.phone || textos.desconhecido;
}

/**
 * O botão de renomear NO WHATSAPP pode aparecer habilitado?
 *
 * Só com `we_are_admin === true`. `null` significa "ainda não sincronizamos" e
 * NÃO destrava: habilitar por otimismo faria o operador clicar e receber um
 * erro cru da Evolution, o que é pior que um botão desabilitado com o motivo.
 */
export function podeRenomearNoWhatsApp(
  grupo: Pick<CbGroup, 'we_are_admin'> | null | undefined,
): boolean {
  return grupo?.we_are_admin === true;
}

/** Por que o campo de escrever está bloqueado, se estiver. */
export type MotivoDeBloqueio = 'canal_meta' | 'so_admin_envia' | null;

/**
 * Decide o bloqueio do composer numa conversa de grupo.
 *
 * `canal_meta` vem primeiro porque é o impedimento mais forte: a API oficial
 * da Meta não fala com grupo nenhum, admin ou não. Só depois disso importa a
 * restrição do próprio grupo.
 */
export function bloqueioDeEnvioNoGrupo(
  grupo: Pick<CbGroup, 'is_announce' | 'we_are_admin'> | null | undefined,
  canalEhMeta: boolean,
): MotivoDeBloqueio {
  if (canalEhMeta) return 'canal_meta';
  if (grupo?.is_announce === true && grupo?.we_are_admin !== true) return 'so_admin_envia';
  return null;
}

/**
 * Cor estável para o nome de quem falou, dentro do grupo.
 *
 * Sem cor por autor, um grupo de 180 pessoas vira um paredão de texto onde
 * ninguém distingue quem disse o quê. O índice sai de um hash do JID para a
 * mesma pessoa manter a mesma cor entre recargas e entre atendentes — cor
 * sorteada a cada render seria pior que cor nenhuma.
 */
export function corDoRemetente(jid: string | null | undefined, totalDeCores: number): number {
  if (!jid || totalDeCores <= 0) return 0;
  let h = 0;
  for (let i = 0; i < jid.length; i++) {
    h = (h * 31 + jid.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % totalDeCores;
}

/**
 * O anexo desta mensagem ainda pode ser buscado?
 *
 * `too_large` fica de fora: o arquivo passa do teto do bucket e tentar de novo
 * só produziria a mesma falha. O balão mostra "veja no celular" em vez de um
 * botão que nunca vai funcionar.
 */
export function podeBaixarAnexo(
  mensagem: { media_url?: string | null; media_state?: string | null },
): boolean {
  if (mensagem.media_url) return false;
  return mensagem.media_state === 'pending' || mensagem.media_state === 'failed';
}
