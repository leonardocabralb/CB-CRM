// ============================================================
// O acervo de anexos de UMA conversa — o que a aba "Arquivos" do painel
// mostra, tanto na ficha do contato quanto na do grupo.
//
// Puro e sem consulta: o fio já carrega a conversa INTEIRA e a página do
// inbox já guarda esse array, então a aba o recebe por prop. Nada aqui vai
// ao banco.
//
// ⚠️ Isso amarra a aba ao mesmo teto que o salto da busca dentro do fio: se
// um dia o fio paginar, esta lista passa a mentir POR OMISSÃO — ela não tem
// como perceber que faltou mensagem, e o operador leria "é tudo que o
// cliente mandou" sobre meia conversa. O teto de 1000 linhas do PostgREST
// chega sozinho, por crescimento de dados, sem ninguém mudar código.
//
// ⚠️ Separado de `gallery.ts` de propósito, e ele NÃO foi alargado. Aquele
// alimenta as setas ‹ › do visualizador, que só sabe desenhar imagem e
// vídeo; incluir documento ali faria as setas pararem num PDF em branco.
// Aqui a lista é de tudo, e cada tipo tem seu próprio destino no clique.
// ============================================================

import type { ContentType, Message } from "@/types";

import { mediaFilename } from "./filename";

/**
 * As três prateleiras da aba.
 *
 * `midia` junta imagem e vídeo porque é o que o visualizador folheia junto —
 * são a mesma gaveta para quem procura ("a foto do contrato"). Documento e
 * áudio ficam separados porque não se parecem com nada: um abre no leitor de
 * PDF, o outro toca.
 */
export type TipoDeAnexo = "midia" | "documento" | "audio";

export interface Anexo {
  /** `messages.id` — a identidade estável, nunca o índice na lista. */
  messageId: string;
  url: string;
  tipo: TipoDeAnexo;
  /** O `content_type` original, para a aba escolher ícone e rótulo. */
  contentType: ContentType;
  /**
   * Nome de exibição, já resolvido pela cascata de `mediaFilename` — inclui
   * o nome sintetizado, então nunca é vazio.
   */
  nome: string;
  /** A legenda, quando o remetente escreveu uma E ela não é só o nome. */
  legenda?: string;
  createdAt: string;
  /** Cliente mandou, ou fomos nós? Vira a etiqueta "Recebido"/"Enviado". */
  doCliente: boolean;
  /**
   * Começo da transcrição da nota de voz (943), quando ela existe e ficou
   * `pronta`.
   *
   * ⚠️ É o que a lista mostra NO LUGAR do nome, e não é enfeite: nota de voz
   * não tem nome de verdade — o WhatsApp entrega o id hexadecimal do arquivo
   * (`3A0B20C39A96D7D3761A.oga`). Medido na tela: trinta linhas de gibberish
   * hexadecimal, uma embaixo da outra, sem nada que diga o que é cada uma.
   * Só existe para áudio: documento tem nome de verdade.
   */
  transcricao?: string;
  /** A linha inteira — o visualizador e o download derivam coisas dela. */
  message: Message;
}

/** Teto do trecho de transcrição na lista — uma linha, e o resto sai. */
const MAX_PREVIA = 90;

/**
 * O começo da transcrição, em uma linha, ou `undefined` quando não há o que
 * mostrar. Só `pronta` conta: `falhou` e `recusada` não têm texto, e
 * `transcrevendo` teria um pela metade.
 */
export function previaDaTranscricao(message: Message): string | undefined {
  if (message.transcricao_status !== "pronta") return undefined;
  // Quebras de linha viram espaço: a lista é de uma linha só, e um `\n` cru
  // deixaria o resto do texto invisível sem encurtar a linha.
  const limpo = (message.transcricao ?? "").replace(/\s+/g, " ").trim();
  if (!limpo) return undefined;
  return limpo.length > MAX_PREVIA
    ? `${limpo.slice(0, MAX_PREVIA).trimEnd()}…`
    : limpo;
}

function tipoDoAnexo(contentType: ContentType): TipoDeAnexo | null {
  if (contentType === "image" || contentType === "video") return "midia";
  if (contentType === "document") return "documento";
  if (contentType === "audio") return "audio";
  return null;
}

/**
 * Os anexos da conversa, do mais recente para o mais antigo.
 *
 * ⚠️ Ordem INVERTIDA em relação ao fio, e isso é a feature. O fio é
 * cronológico porque conta uma história; aqui a pergunta é "o que ele
 * mandou?", cuja resposta começa pelo último.
 *
 * Ficam de fora:
 * - mensagem sem `media_url` — anexo de grupo ainda não baixado
 *   (`media_state='pending'`) ou mídia que expirou no servidor do WhatsApp;
 *   nos dois casos não há arquivo para abrir.
 * - ⚠️ mensagem APAGADA. O fio a substitui por "Esta mensagem foi apagada",
 *   e o arquivo continua no bucket — listá-la aqui ressuscitaria, numa aba
 *   nova, exatamente o que alguém pediu para sumir da conversa.
 */
export function coletarAnexos(messages: Message[]): Anexo[] {
  const anexos: Anexo[] = [];

  for (const message of messages) {
    const tipo = tipoDoAnexo(message.content_type);
    if (!tipo || !message.media_url || message.deleted_at) continue;

    const nome = mediaFilename(message);
    // A legenda só é legenda quando diz algo além do nome. No caminho da
    // Meta o filename era gravado NO `content_text`, então sem esta guarda
    // as linhas antigas mostrariam o mesmo texto duas vezes — a mesma
    // supressão que a bolha faz.
    const legenda =
      message.content_text && message.content_text !== nome
        ? message.content_text
        : undefined;

    anexos.push({
      messageId: message.id,
      url: message.media_url,
      tipo,
      contentType: message.content_type,
      nome,
      legenda,
      createdAt: message.created_at,
      doCliente: message.sender_type === "customer",
      transcricao: tipo === "audio" ? previaDaTranscricao(message) : undefined,
      message,
    });
  }

  // Inverter, em vez de ordenar por data: o fio já chega ordenado por
  // `created_at` do banco, e reordenar aqui por uma string de data
  // reintroduziria o risco de empate mal resolvido entre mensagens do mesmo
  // segundo — que no WhatsApp é comum (três documentos seguidos chegam todos
  // no mesmo minuto). `anexos` é local, então mutar é seguro.
  return anexos.reverse();
}

/** Quantos anexos de cada prateleira — alimenta o contador de cada seção. */
export function contarPorTipo(anexos: Anexo[]): Record<TipoDeAnexo, number> {
  const contagem: Record<TipoDeAnexo, number> = {
    midia: 0,
    documento: 0,
    audio: 0,
  };
  for (const anexo of anexos) contagem[anexo.tipo]++;
  return contagem;
}

/** Só os de uma prateleira, preservando a ordem. */
export function filtrarPorTipo(anexos: Anexo[], tipo: TipoDeAnexo): Anexo[] {
  return anexos.filter((a) => a.tipo === tipo);
}
