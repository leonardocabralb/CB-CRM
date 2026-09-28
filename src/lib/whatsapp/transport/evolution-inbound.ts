// ============================================================
// Evolution `messages.upsert` → NormalizedInbound.
//
// Baileys delivers a flat `{ key, pushName, message, messageTimestamp }`
// shape (very different from Meta's entry[].changes[].value envelope).
// Text arrives as `message.conversation` or
// `message.extendedTextMessage.text`; media as a typed sub-object whose
// `caption` (when present) is the text. Group chats (`@g.us`) and our own
// echoes (`key.fromMe`) are dropped — a 1:1 CRM inbox doesn't want them.
// ============================================================

import type { NormalizedInbound } from '@/lib/whatsapp/inbound-store';
import { PREFIXO_DE_TIPO_NAO_SUPORTADO } from '@/lib/ia-agentes/quem-responde';
import {
  MAX_CONTATOS,
  lerVcard,
  resumoDosContatos,
  type ContatoCompartilhado,
} from '@/lib/whatsapp/cartao-de-contato';

export interface EvolutionMessageKey {
  remoteJid?: string;
  fromMe?: boolean;
  id?: string;
  participant?: string;
  /**
   * Contrapartida em TELEFONE do `remoteJid` quando ele vem como `@lid`.
   * O WhatsApp está migrando o endereçamento para LID e a Baileys expõe o
   * número real num destes campos — os nomes variam entre versões, por isso
   * todos são aceitos.
   */
  remoteJidAlt?: string;
  senderPn?: string;
  participantPn?: string;
  participantAlt?: string;
  /**
   * O endereço que `remoteJid` tinha ANTES de a Evolution 2.3.2 reescrevê-lo
   * de `@lid` para telefone. Serve para AGIR sobre a mensagem (revogar,
   * editar): do lado do WhatsApp a conversa continua endereçada por LID, e a
   * revogação mandada para o telefone não acha nada. Ver migration 917 e
   * `lidJidFromKey` — o LID muda de campo entre versões da Evolution.
   */
  previousRemoteJid?: string;
  /**
   * Baileys 7 (Evolution 2.4): `'lid'` quando a conversa é endereçada por LID.
   * Informativo — a decisão do telefone/LID é de `phoneJidFromKey` e
   * `lidJidFromKey`, que olham os campos, não este rótulo.
   */
  addressingMode?: string;
}

export interface EvolutionUpsert {
  key?: EvolutionMessageKey;
  pushName?: string;
  message?: Record<string, unknown> | null;
  messageType?: string;
  messageTimestamp?: number | string;
  /**
   * Na 2.4, o `prepareMessage` da Evolution sobe o `contextInfo` da mensagem
   * para este nível — e, com o nosso patch (docker/evolution-cb), é aqui que
   * o `stanzaId` da citação chega. Ver `quotedProviderId`.
   */
  contextInfo?: Record<string, unknown> | null;
}

/**
 * Sufixos de JID que NÃO são conversa 1:1. Antes só `@g.us` era barrado, e
 * como `phoneFromJid` devolve os dígitos de qualquer JID, um canal do
 * WhatsApp (`@newsletter`) ou uma atualização de status (`@broadcast`)
 * entrava no inbox como se fosse um cliente novo, com telefone inventado.
 *
 * ⚠️ `@lid` NÃO está aqui de propósito. Desde a v2 o WhatsApp usa esse
 * formato no lugar do telefone em conversas legítimas — barrá-lo perderia
 * mensagem de cliente de verdade. O LID NUNCA vira `phone`: quem decide o
 * telefone é `phoneJidFromKey`, e o item que chega SÓ com o LID é resolvido
 * pelo acervo ou retido (`ehLidSemTelefone`, `sem-telefone/receber.ts`).
 * (Uma versão desta nota dizia que o contato nascia com o LID no campo
 * `phone` — era verdade até 27/07/2026, e foi o que criou os 4 contatos
 * fantasmas do commit 9606636.)
 */
const SUFIXOS_NAO_CONVERSA = ['@g.us', '@newsletter', '@broadcast'];

export function isNonChatJid(jid: string): boolean {
  return SUFIXOS_NAO_CONVERSA.some((sufixo) => jid.endsWith(sufixo));
}

/** Reduce a chat JID to digits-only phone (drops @suffix and device part). */
export function phoneFromJid(jid: string): string {
  return jid
    .replace(/@s\.whatsapp\.net$|@lid$|@g\.us$/, '')
    .replace(/:.*/, '')
    .replace(/\D/g, '');
}

export function isLidJid(jid: string): boolean {
  return jid.endsWith('@lid');
}

/**
 * JID de TELEFONE da conversa. Devolve `null` quando só existe o LID.
 *
 * ⚠️ Esta função existe por causa de um bug que chegou a produção: o
 * WhatsApp está migrando o endereçamento para LID (`10000000000107@lid`),
 * um identificador interno que NÃO é telefone. Em produção o eco das
 * mensagens que o operador mandava do celular chegava com LID enquanto as
 * mensagens recebidas do MESMO cliente chegavam com o telefone — e como o
 * contato é procurado por telefone, o LID virava um contato novo. Resultado:
 * a conversa se partia em duas, uma com o que o cliente escreveu e outra,
 * com nome de número sem sentido, com o que o advogado respondeu.
 *
 * A regra: sem telefone de verdade, NÃO se inventa contato. Descartar é
 * ruim (a mensagem do celular não aparece), mas partir a conversa de um
 * cliente ao meio e criar um contato falso na base é pior — e some no
 * meio dos contatos reais.
 */
export function phoneJidFromKey(key: EvolutionMessageKey | undefined): string | null {
  const principal = key?.remoteJid;
  if (principal && !isLidJid(principal)) return principal;

  // A Baileys mudou o nome deste campo entre versões; aceitar todos evita
  // que um upgrade do servidor Evolution volte a partir as conversas.
  for (const alt of [key?.remoteJidAlt, key?.senderPn, key?.participantPn, key?.participantAlt]) {
    if (alt && !isLidJid(alt) && /\d/.test(alt)) return alt;
  }
  return null;
}

/**
 * Endereço `@lid` da conversa, quando o WhatsApp a endereça assim. Devolve
 * `null` em conversa não migrada — o campo nem vem.
 *
 * Serve para AGIR sobre a mensagem (revogar, editar): do lado do WhatsApp a
 * conversa migrada continua endereçada por LID, e a revogação mandada para o
 * telefone não acha nada (migration 917). ⚠️ O LID muda de CAMPO conforme a
 * versão da Evolution, e ler só um deles é o que faria `remote_jid_lid`
 * nascer NULL depois de um upgrade — devolvendo o bug de 28/07/2026 (apagar
 * pelo CRM uma mensagem enviada do celular não fazia nada):
 *
 *   - 2.3.2 (+ patch `lidfix`): `remoteJid` reescrito para telefone e o LID
 *     guardado em `previousRemoteJid`;
 *   - `develop` (2.4.0): `remoteJid` e `remoteJidAlt` TROCADOS — telefone em
 *     `remoteJid`, LID em `remoteJidAlt`;
 *   - sem troca (o payload cru da Baileys 7): `remoteJid` É o LID e o
 *     telefone vem em `remoteJidAlt` — `phoneJidFromKey` já usou o
 *     alternativo, e o LID é o próprio `remoteJid`.
 *
 * A 2.3.7 põe telefone nos dois campos e PERDE o LID: nela isto devolve
 * `null`, limitação daquela versão, não deste código. Ver
 * docs/PLANO-baileys-7.md, seção 4.2.
 */
export function lidJidFromKey(key: EvolutionMessageKey | undefined): string | null {
  for (const candidato of [key?.previousRemoteJid, key?.remoteJidAlt, key?.remoteJid]) {
    if (candidato && isLidJid(candidato)) return candidato;
  }
  return null;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
}

/**
 * Invólucros que escondem a mensagem real uma camada mais fundo. Foto "ver
 * uma vez" chega como `viewOnceMessageV2.message.imageMessage`, e mensagem
 * de conversa com autodestruição, como `ephemeralMessage.message.…`. Sem
 * descer por eles, `detectContentType` via `text` e o anexo era ignorado —
 * o cliente mandava a foto do documento e no inbox não aparecia nada.
 */
const INVOLUCROS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  // Mídia "associada" a outra (1060). A cópia AUXILIAR — o vídeo da Live
  // Photo, a versão em alta qualidade — é descartada antes, por
  // `ehMensagemAuxiliar`; o que sobra (a foto de um álbum, por exemplo) é
  // conteúdo de verdade e tem de aparecer.
  'associatedChildMessage',
] as const;

/**
 * Desce pelos invólucros até a mensagem de verdade. O limite de profundidade
 * existe porque o payload vem de fora: sem ele, um `ephemeralMessage` que
 * aponte para si mesmo (acidente ou má-fé) prenderia o laço para sempre.
 */
export function unwrapMessage(
  message?: Record<string, unknown> | null
): Record<string, unknown> | null {
  let atual = message ?? null;
  for (let i = 0; i < 5 && atual; i++) {
    const involucro = INVOLUCROS.find((k) => asRecord(atual![k]));
    if (!involucro) return atual;
    const dentro = asRecord(asRecord(atual[involucro])!.message);
    if (!dentro) return atual;
    atual = dentro;
  }
  return atual;
}

/**
 * Legenda que não diz nada.
 *
 * ⚠️ MEDIDO em 2026-09-09 no payload real: documento mandado do iPhone chega
 * com `caption: "\uFFFC"` — o OBJECT REPLACEMENT CHARACTER, o marcador
 * invisível que o iOS usa no lugar do anexo. Ele não é legenda: gravado em
 * `content_text`, vira uma CAIXINHA sob o nome do arquivo na bolha, na prévia
 * da lista de conversas e no transcrito que o Radar manda para a IA.
 */
function legendaVazia(texto: string): boolean {
  return texto.replace(/[\uFFFC\s]/g, '') === '';
}

export function extractText(message?: Record<string, unknown> | null): string | null {
  const m0 = unwrapMessage(message);
  if (!m0) return null;
  if (typeof m0.conversation === 'string') return m0.conversation;
  const ext = asRecord(m0.extendedTextMessage);
  if (ext && typeof ext.text === 'string') return ext.text;
  for (const key of ['imageMessage', 'videoMessage', 'documentMessage']) {
    const m = asRecord(m0[key]);
    if (m && typeof m.caption === 'string' && m.caption && !legendaVazia(m.caption)) {
      return m.caption;
    }
  }
  // Cartão de contato (1060): o resumo vai para `content_text` — prévia,
  // busca, Radar e API leem dali; a bolha desenha o cartão por `contatos`.
  const contatos = extractContatos(m0);
  if (contatos) return resumoDosContatos(contatos);
  // Mensagem de EMPRESA com botões (modelo do WhatsApp Business): medido em
  // setembro, 22 chegaram assim e viraram bolha vazia — o texto se perdia.
  const modelo = asRecord(m0.templateMessage);
  if (modelo) return textoDoModelo(modelo);
  const interativa = asRecord(m0.interactiveMessage);
  if (interativa) return textoInterativo(interativa);
  return null;
}

/** Texto não vazio, ou nada. */
function textoOuNada(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Os botões de um modelo (`hydratedButtons`), um por linha: `[Sim]`,
 * `[Ver boleto] https://…`, `[Ligar] +55…`. O link e o telefone ficam no
 * texto porque, sem eles, "[Ver boleto]" não diz ao operador para onde o
 * cliente foi mandado.
 */
function botoesDoModelo(botoes: unknown): string[] {
  if (!Array.isArray(botoes)) return [];
  const linhas: string[] = [];
  for (const b of botoes) {
    const botao = asRecord(b);
    if (!botao) continue;
    const resposta = asRecord(botao.quickReplyButton);
    const link = asRecord(botao.urlButton);
    const ligar = asRecord(botao.callButton);
    const alvo = resposta ?? link ?? ligar;
    const rotulo = textoOuNada(alvo?.displayText);
    if (!rotulo) continue;
    const extra = textoOuNada(link?.url) ?? textoOuNada(ligar?.phoneNumber);
    linhas.push(extra ? `[${rotulo}] ${extra}` : `[${rotulo}]`);
  }
  return linhas;
}

/** Junta os blocos de texto (separados por linha em branco) e os botões. */
function montarTexto(blocos: (string | null)[], botoes: string[]): string | null {
  const partes = blocos.filter((b): b is string => !!b);
  if (botoes.length > 0) partes.push(botoes.join('\n'));
  return partes.length > 0 ? partes.join('\n\n') : null;
}

/**
 * `templateMessage` — as três formas medidas nos 22 de setembro:
 * `hydratedTemplate` (título, corpo, rodapé e botões), a variante
 * `hydratedFourRowTemplate` (mesmos campos) e `interactiveMessageTemplate`
 * (a forma nova, igual à `interactiveMessage`). A imagem do cabeçalho, quando
 * há, NÃO é baixada: a mensagem é gravada como texto.
 */
function textoDoModelo(modelo: Record<string, unknown>): string | null {
  const hidratado = asRecord(modelo.hydratedTemplate) ?? asRecord(modelo.hydratedFourRowTemplate);
  if (hidratado) {
    return montarTexto(
      [
        textoOuNada(hidratado.hydratedTitleText),
        textoOuNada(hidratado.hydratedContentText),
        textoOuNada(hidratado.hydratedFooterText),
      ],
      botoesDoModelo(hidratado.hydratedButtons),
    );
  }
  const interativo = asRecord(modelo.interactiveMessageTemplate);
  return interativo ? textoInterativo(interativo) : null;
}

/**
 * Pedido de pagamento por Pix (`nativeFlowMessage`, botão `payment_info`) —
 * medido: é o que o celular do escritório manda quando cobra pelo WhatsApp
 * Business. Vira `💠 Pix · titular · chave · valor`.
 */
function textoDoPix(parametros: Record<string, unknown>): string | null {
  const configuracoes = Array.isArray(parametros.payment_settings) ? parametros.payment_settings : [];
  const pix = configuracoes.map((c) => asRecord(asRecord(c)?.pix_static_code)).find(Boolean);
  if (!pix) return null;
  let valor: string | null = null;
  const total = asRecord(parametros.total_amount);
  if (typeof total?.value === 'number' && total.value > 0) {
    // `offset` é DIVISOR (100 = centavos), como no `total_amount` da Meta.
    const divisor = typeof total.offset === 'number' && total.offset > 0 ? total.offset : 1;
    const moeda = textoOuNada(parametros.currency) ?? 'BRL';
    try {
      valor = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda }).format(
        total.value / divisor,
      );
    } catch {
      valor = `${moeda} ${(total.value / divisor).toFixed(2)}`;
    }
  }
  return ['💠 Pix', textoOuNada(pix.merchant_name), textoOuNada(pix.key), valor]
    .filter(Boolean)
    .join(' · ');
}

/** Os botões nativos (`nativeFlowMessage.buttons`): o rótulo, ou o Pix. */
function botoesNativos(nativo: unknown): string[] {
  const botoes = asRecord(nativo)?.buttons;
  if (!Array.isArray(botoes)) return [];
  const linhas: string[] = [];
  for (const b of botoes) {
    const botao = asRecord(b);
    if (!botao || typeof botao.buttonParamsJson !== 'string') continue;
    let parametros: Record<string, unknown> | undefined;
    try {
      parametros = asRecord(JSON.parse(botao.buttonParamsJson));
    } catch {
      continue;
    }
    if (!parametros) continue;
    if (botao.name === 'payment_info') {
      const pix = textoDoPix(parametros);
      if (pix) linhas.push(pix);
      continue;
    }
    const rotulo = textoOuNada(parametros.display_text);
    if (!rotulo) continue;
    const extra = textoOuNada(parametros.url) ?? textoOuNada(parametros.phone_number);
    linhas.push(extra ? `[${rotulo}] ${extra}` : `[${rotulo}]`);
  }
  return linhas;
}

/** `interactiveMessage`: cabeçalho, corpo, rodapé e os botões nativos. */
function textoInterativo(interativa: Record<string, unknown>): string | null {
  return montarTexto(
    [
      textoOuNada(asRecord(interativa.header)?.title),
      textoOuNada(asRecord(interativa.body)?.text),
      textoOuNada(asRecord(interativa.footer)?.text),
    ],
    botoesNativos(interativa.nativeFlowMessage),
  );
}

/**
 * Os contatos de um cartão (`contactMessage`, um; `contactsArrayMessage`,
 * vários). `null` = a mensagem não é cartão de contato; `[]` = é, mas nenhum
 * vCard trouxe nome ou telefone.
 */
export function extractContatos(
  message?: Record<string, unknown> | null,
): ContatoCompartilhado[] | null {
  const m = unwrapMessage(message);
  if (!m) return null;
  const texto = (v: unknown) => (typeof v === 'string' ? v : null);
  const um = asRecord(m.contactMessage);
  if (um) {
    const contato = lerVcard(texto(um.vcard), texto(um.displayName));
    return contato ? [contato] : [];
  }
  const varios = asRecord(m.contactsArrayMessage);
  if (varios) {
    const lista = Array.isArray(varios.contacts) ? varios.contacts.slice(0, MAX_CONTATOS) : [];
    return lista
      .map((c) => asRecord(c))
      .map((c) => (c ? lerVcard(texto(c.vcard), texto(c.displayName)) : null))
      .filter((c): c is ContatoCompartilhado => c !== null);
  }
  return null;
}

/**
 * Chaves que ACOMPANHAM o conteúdo sem ser ele: o contexto da mensagem e a
 * distribuição de chave de grupo, que chega junto do texto.
 */
const CHAVES_DE_CONTEXTO = new Set(['messageContextInfo', 'senderKeyDistributionMessage']);

/**
 * O rótulo gravado quando a mensagem viraria uma bolha VAZIA: um tipo que o
 * normalizador não sabe ler (enquete, vídeo redondo, evento, o que o WhatsApp
 * inventar depois). É a MESMA constante que o webhook da Meta usa para o tipo
 * que ele não lê — e é por isso que o agente de IA não abre turno com ela
 * (`abreTurno` a recusa) e a bolha a troca por "veja no WhatsApp".
 *
 * ⚠️ Texto vazio de verdade (`conversation: ""`) e `protocolMessage` ficam
 * como sempre foram: o primeiro não é tipo desconhecido, e o segundo é
 * controle (revogação e edição chegam por `messages.delete`/`.edited`), não
 * conteúdo de ninguém.
 */
export function rotuloDeTipoNaoLido(message?: Record<string, unknown> | null): string | null {
  const m = unwrapMessage(message);
  if (!m) return null;
  const tipo = Object.keys(m).find((k) => !CHAVES_DE_CONTEXTO.has(k));
  if (!tipo || tipo === 'conversation' || tipo === 'extendedTextMessage' || tipo === 'protocolMessage') {
    return null;
  }
  return `${PREFIXO_DE_TIPO_NAO_SUPORTADO} ${tipo}]`;
}

/**
 * O texto de uma mensagem como ela é GRAVADA: o que `extractText` lê, ou,
 * quando o resultado seria uma bolha de texto vazia, o rótulo do tipo não lido.
 */
export function textoParaGravar(
  message: Record<string, unknown> | null | undefined,
  contentType: NormalizedInbound['contentType'],
): string | null {
  const texto = extractText(message);
  if (texto !== null || contentType !== 'text') return texto;
  return rotuloDeTipoNaoLido(message);
}

/**
 * O tipo tem ARQUIVO a baixar da Evolution? Texto, localização e cartão de
 * contato não têm — e pedir o download deles só gasta uma chamada para
 * terminar em erro no log. (No 1:1, até 1060 só o texto ficava de fora: toda
 * localização recebida disparava um download que não podia dar certo.)
 */
export function temArquivo(contentType: string): boolean {
  return (
    contentType === 'image' ||
    contentType === 'video' ||
    contentType === 'audio' ||
    contentType === 'document'
  );
}

export function detectContentType(
  message?: Record<string, unknown> | null
): NormalizedInbound['contentType'] {
  const m = unwrapMessage(message);
  if (!m) return 'text';
  if (m.imageMessage || m.stickerMessage) return 'image';
  if (m.videoMessage) return 'video';
  if (m.audioMessage) return 'audio';
  if (m.documentMessage) return 'document';
  if (m.locationMessage) return 'location';
  if (m.contactMessage || m.contactsArrayMessage) return 'contact';
  return 'text';
}

/**
 * Tipo de associação (proto `MessageAssociation.AssociationType`) que é só
 * CÓPIA AUXILIAR de uma mídia que já chegou como mensagem própria: a versão
 * em alta qualidade (5, 10, 19) e o vídeo da Live Photo do iPhone (12).
 * Medido na mensagem de 18/09/2026: o vídeo da Live Photo chegou 1 s depois da foto, com
 * `parentMessageKey` apontando para ela. `MEDIA_ALBUM` (1) NÃO está aqui: é
 * a foto de um álbum, conteúdo de verdade.
 */
const ASSOCIACOES_AUXILIARES = new Set<unknown>([
  5,
  'HD_VIDEO_DUAL_UPLOAD',
  10,
  'HD_IMAGE_DUAL_UPLOAD',
  12,
  'MOTION_PHOTO',
  19,
  'HEVC_VIDEO_DUAL_UPLOAD',
]);

function tipoDaAssociacao(m: Record<string, unknown> | undefined): unknown {
  const tipo = asRecord(asRecord(m?.messageContextInfo)?.messageAssociation)?.associationType;
  return typeof tipo === 'string' && /^\d+$/.test(tipo) ? Number(tipo) : tipo;
}

/**
 * Item que não é mensagem de ninguém, só acompanha outra (1060):
 *   - `albumMessage`: a ABERTURA de um álbum ("vêm 5 fotos"). Não tem
 *     conteúdo — as fotos chegam uma a uma, como mensagens próprias (conferido
 *     nos álbuns de setembro). Gravada, era uma bolha vazia a mais: 34 em
 *     setembro.
 *   - `associatedChildMessage` de tipo auxiliar (`ASSOCIACOES_AUXILIARES`).
 * Descartado como a reação: nem bolha, nem não-lida, nem gatilho de automação.
 */
export function ehMensagemAuxiliar(message?: Record<string, unknown> | null): boolean {
  let atual = message ?? null;
  for (let i = 0; i < 5 && atual; i++) {
    if (asRecord(atual.albumMessage)) return true;
    const filha = asRecord(atual.associatedChildMessage);
    if (filha) {
      const tipo = tipoDaAssociacao(atual) ?? tipoDaAssociacao(asRecord(filha.message));
      return ASSOCIACOES_AUXILIARES.has(tipo);
    }
    const involucro = INVOLUCROS.find((k) => k !== 'associatedChildMessage' && asRecord(atual![k]));
    if (!involucro) return false;
    atual = asRecord(asRecord(atual[involucro])!.message) ?? null;
  }
  return false;
}

/**
 * Reação (`👍` numa mensagem) não é mensagem. Hoje ela cairia como texto de
 * conteúdo nulo: bolha vazia no histórico, e — pior — disparando automações,
 * flows e resposta de IA como se o cliente tivesse escrito algo.
 *
 * Descartar é o comportamento correto até a reação ser modelada de verdade
 * (guardada e exibida na bolha da mensagem reagida, como no WhatsApp).
 */
/** Mensagens que carregam `contextInfo` com a citação dentro do próprio corpo. */
const CAIXAS_COM_CONTEXTO = [
  'extendedTextMessage',
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'stickerMessage',
  // Localização também é resposta possível, e `detectContentType` a aceita —
  // sem ela aqui a mensagem entrava e a citação se perdia (Codex, PR #184).
  'locationMessage',
  // O cartão de contato também pode responder a uma mensagem (1060).
  'contactMessage',
  'contactsArrayMessage',
] as const;

/**
 * O wamid da mensagem CITADA, se esta for uma resposta.
 *
 * Duas moradas, porque a Evolution muda de versão: no nível de cima
 * (`item.contextInfo.stanzaId`) — é onde a 2.4 com o patch da citação o
 * entrega para texto — e dentro do corpo (`extendedTextMessage.contextInfo`
 * etc.), como a 2.3.2 entregava e como a 2.4 ainda entrega para mídia (só o
 * texto é achatado). ⚠️ Sem o patch, a 2.4 descarta o `contextInfo` do texto
 * e esta função devolve null — a resposta entra sem citação (issue upstream
 * #2713). Até 09/09/2026 o CRM nunca leu isto no transporte Evolution: só o
 * caminho da Meta resolvia citação.
 */
export function quotedProviderId(item: EvolutionUpsert): string | null {
  const topo = asRecord(item.contextInfo)?.stanzaId;
  if (typeof topo === 'string' && topo) return topo;
  const m = unwrapMessage(item.message);
  if (!m) return null;
  for (const caixa of CAIXAS_COM_CONTEXTO) {
    const id = asRecord(asRecord(m[caixa])?.contextInfo)?.stanzaId;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}

export function isReaction(message?: Record<string, unknown> | null): boolean {
  return !!asRecord(unwrapMessage(message)?.reactionMessage);
}

/**
 * Mensagem cifrada com "message secret" (`secretEncryptedMessage`).
 *
 * ⚠️ MEDIDO em 09/09/2026, no primeiro teste de EDIÇÃO depois do upgrade da
 * Evolution para 2.4.0 / Baileys 7.0.0-rc13: quando o cliente (ou o celular
 * pareado) edita uma mensagem, o WhatsApp manda a edição assim —
 * `{ secretEncryptedMessage: { encIv, encPayload, secretEncType: 2,
 * targetMessageKey: { id } } }` — e a Baileys rc13 NÃO decifra (PRs abertos
 * no upstream: WhiskeySockets/Baileys #2690 e #2743). A Evolution entrega o
 * item como um `messages.upsert` comum, de `messageType`
 * 'secretEncryptedMessage' e sem texto nenhum: tratado como texto, virava
 * uma BOLHA VAZIA na conversa (foi assim que apareceu na tela, duas vezes,
 * às 19:44 e 19:45). Não tem conteúdo legível — descartar é a única verdade
 * possível aqui; quem sabe o alvo da edição é `edicaoCifrada`.
 */
export function isSecretEncrypted(message?: Record<string, unknown> | null): boolean {
  return !!asRecord(unwrapMessage(message)?.secretEncryptedMessage);
}

/**
 * A edição cifrada: qual mensagem foi editada. O texto NOVO não é conhecido
 * (vem em `encPayload`, cifrado); só o alvo é. `secretEncType` 2 é
 * MESSAGE_EDIT no proto do WhatsApp (1 é edição de evento, que não
 * modelamos). Quando a Evolution passar a decifrar, a edição vai chegar como
 * `messages.edited` COM texto e o caminho existente na rota cuida — este aqui
 * é o que dá para afirmar enquanto isso.
 */
export function edicaoCifrada(
  message?: Record<string, unknown> | null,
): { targetId: string } | null {
  const sec = asRecord(unwrapMessage(message)?.secretEncryptedMessage);
  if (!sec) return null;
  const tipo = sec.secretEncType;
  if (tipo !== 2 && tipo !== '2' && tipo !== 'MESSAGE_EDIT') return null;
  const alvo = asRecord(sec.targetMessageKey);
  const id = alvo?.id;
  return typeof id === 'string' && id ? { targetId: id } : null;
}

/**
 * O item é uma conversa 1:1 endereçada SÓ por `@lid` — a chave não traz o
 * telefone em campo nenhum. É a forma da cópia que a Baileys 7 emite quando o
 * celular pareado reenvia uma mensagem que ela não conseguiu decifrar
 * (`requestPlaceholderResend` sem o `msgData`: a chave vem crua do aparelho,
 * sem `remoteJidAlt`, sem `addressingMode` e sem `pushName`). Ver
 * docs/PLANO-lid-sem-telefone.md.
 */
export function ehLidSemTelefone(key: EvolutionMessageKey | undefined): boolean {
  const bruto = key?.remoteJid;
  return !!bruto && isLidJid(bruto) && phoneJidFromKey(key) === null;
}

/**
 * JID de telefone de verdade (`…@s.whatsapp.net`, com dígitos). É a régua do
 * telefone que vem de FORA da chave (`telefoneResolvido`): um LID, um grupo ou
 * um texto qualquer ali recriaria o contato falso que o descarte evita.
 */
function ehJidDeTelefone(jid: string): boolean {
  return jid.endsWith('@s.whatsapp.net') && /\d/.test(phoneFromJid(jid));
}

export interface OpcoesDoNormalize {
  /**
   * Telefone que o CHAMADOR resolveu para um item em `@lid` sem telefone — o
   * par LID→telefone já visto numa mensagem gravada (ver
   * `sem-telefone/resolver-lid.ts`). Só é usado quando a chave não traz
   * telefone nenhum; com telefone na chave, a chave manda.
   */
  telefoneResolvido?: string | null;
}

/**
 * Normalize one upsert item. Returns null for messages the inbox should
 * ignore (group chats, our own echoes, or missing key/id). `channelId` é o
 * `cb_channels.id` por onde a mensagem entrou (Fase 3), propagado para o
 * carimbo — NULL no fallback de transição.
 */
export function normalizeUpsert(
  item: EvolutionUpsert,
  accountId: string,
  configOwnerUserId: string,
  channelId: string | null = null,
  opcoes: OpcoesDoNormalize = {}
): NormalizedInbound | null {
  const bruto = item.key?.remoteJid;
  const id = item.key?.id;
  if (!bruto || !id) return null;
  if (isNonChatJid(bruto)) return null; // grupo, canal, status: não é 1:1
  if (isReaction(item.message)) return null; // reação não é mensagem (ver isReaction)
  if (isSecretEncrypted(item.message)) return null; // edição cifrada: sem texto (ver isSecretEncrypted)
  if (ehMensagemAuxiliar(item.message)) return null; // abertura de álbum, cópia auxiliar (ver ehMensagemAuxiliar)

  // Endereço de TELEFONE da conversa. Um `@lid` sem contrapartida devolve
  // null e a mensagem NÃO é gravada aqui — ver `phoneJidFromKey` para o
  // porquê: gravá-la criaria um contato falso e partiria a conversa do
  // cliente. Quem chama pode ter resolvido o telefone por fora
  // (`telefoneResolvido`); sem isso, a rota a RETÉM em vez de descartar.
  const resolvido = opcoes.telefoneResolvido;
  const jid =
    phoneJidFromKey(item.key) ??
    (resolvido && ehJidDeTelefone(resolvido) ? resolvido : null);
  if (!jid) return null;

  const phone = phoneFromJid(jid);
  if (!phone) return null;

  const ts =
    typeof item.messageTimestamp === 'number'
      ? item.messageTimestamp
      : typeof item.messageTimestamp === 'string'
        ? parseInt(item.messageTimestamp, 10) || Math.floor(Date.now() / 1000)
        : Math.floor(Date.now() / 1000);

  const contentType = detectContentType(item.message);

  return {
    accountId,
    configOwnerUserId,
    channelId,
    // `fromMe` significa "saiu desta conta de WhatsApp" — o que engloba
    // DUAS origens que o chamador precisa separar: o eco do que o próprio
    // CRM enviou (já gravado, descartar) e o que o operador digitou no
    // celular pareado (tem de aparecer). Só o `message_id` distingue,
    // e isso exige ir ao banco — por isso a decisão não é tomada aqui.
    fromMe: item.key?.fromMe === true,
    phone,
    name: item.pushName || phone,
    providerMessageId: id,
    remoteJid: jid,
    // O endereço `@lid` da conversa, venha ele no campo que vier (a Evolution
    // muda o lugar entre versões — ver `lidJidFromKey`). Sem ele não dá para
    // revogar nem editar mensagem de conversa migrada: a revogação sairia
    // para a conversa "telefone" e a mensagem vive na "@lid". Só grava quando
    // é de fato um LID — em conversa não migrada o campo nem vem. Ver 917.
    remoteJidLid: lidJidFromKey(item.key),
    quotedProviderId: quotedProviderId(item),
    timestamp: ts,
    contentType,
    text: textoParaGravar(item.message, contentType),
    // Só no cartão de contato (1060): a chave ausente nas outras mantém o
    // INSERT de sempre para todo o resto.
    ...(contentType === 'contact' ? { contatos: extractContatos(item.message) ?? [] } : {}),
    // Preenchido pelo webhook, que tem as credenciais para chamar
    // chat/getBase64FromMediaMessage — ver evolution-media.ts.
    mediaUrl: null,
    // A figurinha vira `image` (`detectContentType`); a marca separa as duas
    // para o agente de IA, que não responde figurinha (ver `figurinha`).
    ...(asRecord(unwrapMessage(item.message)?.stickerMessage) ? { figurinha: true } : {}),
  };
}

/** Uma exclusão anunciada pelo webhook `messages.delete`. */
export interface ExclusaoRecebida {
  /** Id da mensagem NO WHATSAPP — o que casa com `messages.message_id`. */
  providerMessageId: string;
  /** A mensagem apagada era nossa (`true`) ou do contato (`false`). */
  fromMe: boolean;
}

/**
 * Lê o `data` de um `messages.delete` da Evolution.
 *
 * ⚠️ A Evolution emite este evento em DUAS formas, e ler só uma delas é o
 * defeito que deixou a exclusão passar em branco:
 *
 *   1. Exclusão feita no CELULAR (ou em outro cliente do WhatsApp) — a chave
 *      vem achatada: `{ id, remoteJid, fromMe }`. Aqui `id` É o id do
 *      WhatsApp.
 *   2. Exclusão feita pela API DELA — isto é, pelo nosso botão de apagar — a
 *      chave vem aninhada em `key`, e o `id` de fora é o identificador
 *      INTERNO do banco da Evolution, que não casa com nada nosso. Usar o
 *      `id` de fora nessa forma faz o UPDATE acertar zero linhas em silêncio.
 *
 * Por isso `key.id` tem precedência sobre qualquer id de primeiro nível.
 *
 * Devolve lista porque o campo `data` também chega como array em lote; um
 * `data` que não contenha id nenhum vira lista vazia, nunca exceção.
 */
export function parseDeleteEvent(data: unknown): ExclusaoRecebida[] {
  const itens = Array.isArray(data) ? data : [data];
  const saida: ExclusaoRecebida[] = [];
  for (const bruto of itens) {
    if (!bruto || typeof bruto !== 'object') continue;
    const d = bruto as {
      id?: unknown;
      keyId?: unknown;
      fromMe?: unknown;
      key?: { id?: unknown; fromMe?: unknown } | null;
    };
    const candidato = d.key?.id ?? d.keyId ?? d.id;
    if (typeof candidato !== 'string' || !candidato) continue;
    const fromMe = d.key?.fromMe ?? d.fromMe;
    saida.push({ providerMessageId: candidato, fromMe: fromMe === true });
  }
  return saida;
}
