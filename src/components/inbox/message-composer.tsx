"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  KeyboardEvent,
} from "react";
import {
  Send,
  LayoutTemplate,
  Paperclip,
  Library,
  Image as ImageIcon,
  Video,
  FileText,
  Mic,
  Square,
  X,
  Loader2,
  Sparkles,
  Plus,
  MessageSquareDashed,
  Zap,
  StickyNote,
  Clock,
  CalendarClock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCan } from "@/hooks/use-can";
import { useAuth } from "@/hooks/use-auth";
import { custoDaAssinatura, nomeDePessoa } from "@/lib/assinatura/assinatura";
import type { ConversationNote, MediaLibraryItem } from "@/types";
import { InternalNoteBox } from "./internal-note-box";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from "@/lib/storage/upload-media";
import { ReplyQuote } from "./reply-quote";
import {
  alternarMarcador,
  type EstiloFormatacao,
} from "@/lib/inbox/whatsapp-format";
import { useTranslations } from "next-intl";
import {
  InteractiveBuilder,
  blankButtonsPayload,
} from "@/components/interactive/interactive-builder";
import { validateInteractivePayload } from "@/lib/whatsapp/interactive";
import type { InteractiveMessagePayload, QuickReply } from "@/types";
import { QuickReplyPicker } from "./quick-reply-picker";
import { AcervoPicker } from "./acervo-picker";
import {
  arredondarParaGrade,
  ATALHOS_DE_PRAZO,
  CICLO_MINUTOS,
  comporHorario,
  daquiAHoras,
  hojeParaInput,
  horaParaInput,
  type ChaveDeAtalho,
} from "@/lib/scheduled/display";
import {
  podeTerLegenda,
  tetoDaLegenda,
  TETO_DA_LEGENDA_META,
} from "@/lib/scheduled/midia";
import { CHAT_MEDIA_BUCKET } from "@/lib/storage/buckets";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/** Media content types an agent can send from the composer. */
export type ComposerMediaKind = "image" | "video" | "document" | "audio";

/**
 * Supabase Storage bucket holding agent-sent chat attachments (migration 023).
 *
 * ⚠️ O valor mora em `lib/storage/buckets.ts` desde a 932: o disparador das
 * agendadas roda no servidor e precisa do mesmo nome para conferir se o
 * arquivo ainda existe. Re-exportado aqui só para os call sites existentes
 * continuarem funcionando.
 */
export { CHAT_MEDIA_BUCKET };

/**
 * Meta caps media captions at 1024 chars. Enforced here and in the send route.
 *
 * ⚠️ O número mora em `lib/scheduled/midia.ts` desde a 932: agendar mídia
 * precisa da mesma regra no servidor, e um `1024` escrito de novo aqui viraria
 * a segunda cópia a envelhecer sozinha.
 */
export const MEDIA_CAPTION_MAX = TETO_DA_LEGENDA_META;

/** Hard cap on a single voice recording so it can't blow the upload/
 *  transcode limits — auto-stops the recorder when reached. */
const MAX_RECORDING_SECONDS = 5 * 60;

/**
 * Janela para desfazer um envio. Mensagem errada no WhatsApp não tem volta:
 * só resta apagar, e o cliente vê que algo foi apagado.
 *
 * Três segundos por escolha do operador: a janela ATRASA a chegada no celular
 * do cliente, então cada segundo aqui é um segundo de silêncio no atendimento.
 * Pega o arrependimento imediato — que é a maioria — sem fazer o cliente
 * achar que o atendente sumiu.
 */
const SEGUNDOS_DESFAZER = 3;

export interface SendMediaPayload {
  kind: ComposerMediaKind;
  /** Public chat-media URL Meta fetches at send time. */
  mediaUrl: string;
  /** Storage object path — lets the caller GC the object if the send fails. */
  path: string;
  /** Optional caption (image/video/document only). */
  caption?: string;
  /** Original file name — surfaced to the recipient for documents. */
  filename?: string;
  replyToId?: string;
}

interface ReplyDraft {
  /** Internal UUID of the message being replied to — sent back through onSend. */
  id: string;
  authorLabel: string;
  preview: string;
}

// Mirrors the chat-media bucket's allowed_mime_types (migration 023) for
// the file picker so unsupported files are rejected before upload rather
// than failing with a confusing Storage error. Audio has no picker — it's
// captured via the recorder.
const PICKER_ACCEPT: Record<"image" | "video" | "document", string> = {
  image: "image/png,image/jpeg,image/webp",
  video: "video/mp4,video/3gpp",
  document:
    "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain",
};

interface MediaDraft {
  kind: ComposerMediaKind;
  mediaUrl: string;
  /** Storage path — used to GC the object if the draft is discarded. */
  path: string;
  filename: string;
  caption: string;
}

interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  /**
   * Tipo do canal ativo da conversa (multi-canal). Canal 'evolution' (não
   * oficial, Baileys) não tem templates nem mensagens interativas — os dois
   * atalhos somem. A janela de 24h também não existe lá, mas isso o pai já
   * neutraliza passando sessionExpired=false. Null = conta sem canais
   * (pré-migration) → comportamento de sempre.
   */
  channelKind?: "meta" | "evolution" | null;
  onSend: (text: string, replyToId?: string) => void;
  onSendMedia: (payload: SendMediaPayload) => void;
  onSendInteractive: (payload: InteractiveMessagePayload, replyToId?: string) => void;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
  /**
   * Anotação interna recém-criada (migration 918). O compositor chama a rota
   * e devolve a linha pronta para o pai pôr no fio sem esperar o realtime —
   * quem escreve precisa ver o que escreveu na hora.
   */
  onNoteCreated?: (nota: ConversationNote) => void;
  /**
   * Agendou uma mensagem (migration 925). O pai usa para mandar a faixa
   * AGENDADAS, logo acima, recarregar a lista.
   */
  onScheduled?: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Worker that encodes mic input to Ogg/Opus entirely in the browser
 *  (vendored from opus-recorder into /public). Recording client-side in a
 *  Meta-accepted format means no server ffmpeg / transcode step. */
const OPUS_ENCODER_PATH = "/opus/encoderWorker.min.js";

export function MessageComposer({
  conversationId,
  sessionExpired,
  channelKind = null,
  onSend,
  onSendMedia,
  onSendInteractive,
  onOpenTemplates,
  replyTo,
  onClearReply,
  onNoteCreated,
  onScheduled,
}: MessageComposerProps) {
  const t = useTranslations("Inbox.composer");
  // Namespace próprio: os textos de agendar são compartilhados com a
  // faixa AGENDADAS, que é outro componente.
  const tAgendadas = useTranslations("Inbox.scheduled");

  const [text, setText] = useState("");
  const [drafting, setDrafting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /**
   * Mensagem escrita, ainda segurável. `null` = nada esperando.
   *
   * `enviar` é o despachante da conversa de ORIGEM, capturado no instante em
   * que a mensagem foi retida — ver a nota extensa em `handleSend`.
   */
  const [pendente, setPendente] = useState<{
    texto: string;
    replyToId?: string;
    expiraEm: number;
    enviar: (texto: string, replyToId?: string) => void;
  } | null>(null);
  const timerDesfazerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Interactive-message builder dialog + quick-reply picker.
  const [interactiveOpen, setInteractiveOpen] = useState(false);
  const [interactivePayload, setInteractivePayload] =
    useState<InteractiveMessagePayload>(blankButtonsPayload);
  const [savingQuickReply, setSavingQuickReply] = useState(false);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  const [acervoOpen, setAcervoOpen] = useState(false);

  // Media attachment state. `draft` holds an uploaded-but-not-yet-sent
  // attachment; `busy` covers the upload/transcode window.
  const [draft, setDraft] = useState<MediaDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  // Mirror of `draft` for the unmount cleanup, which can't read render
  // state. Kept in sync below so navigating away with a staged-but-unsent
  // attachment GCs the orphaned object.
  const draftRef = useRef<MediaDraft | null>(null);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  /**
   * Caminhos que JÁ pertencem a outra coisa e não podem mais ser recolhidos.
   *
   * ⚠️ Existe por causa do agendamento (932). A limpeza de desmonte acima
   * apaga o objeto do rascunho — certo para um anexo que ficou na tela e nunca
   * foi mandado. Mas agendar cria a linha no servidor e o arquivo passa a ser
   * DELA: se o operador trocar de tela enquanto o POST está no ar (ou no
   * quadro seguinte ao sucesso, antes de o rascunho sumir), a limpeza apagaria
   * o arquivo de uma agendada recém-criada — e o defeito só apareceria horas
   * depois, na hora do envio.
   *
   * Marcado ANTES do POST, de propósito: a janela perigosa é justamente a
   * espera. Se o agendamento falhar, o caminho sai daqui e volta a ser
   * recolhível.
   */
  const entreguesRef = useRef<Set<string>>(new Set());

  // Best-effort GC of a staged object the user never sent. Fire-and-forget.
  const removeStaged = useCallback((path: string | undefined) => {
    if (!path) return;
    if (entreguesRef.current.has(path)) return;
    void deleteAccountMedia(CHAT_MEDIA_BUCKET, path).catch(() => {});
  }, []);

  // Voice recording state. The recorder encodes Ogg/Opus in-browser
  // (opus-recorder) so there's no server-side transcode.
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef<import("opus-recorder").default | null>(null);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Viewers (read-only role) can browse the inbox but never send.
  // For solo users this is always true — single-owner accounts pass
  // every capability — so the disabled branch is a no-op there.
  const canSend = useCan("send-messages");
  const readOnly = !canSend;

  // ⚠️ Permissão PRÓPRIA, e de propósito mais frouxa que `canSend`: anotação
  // interna não sai para o cliente, então `viewer` também anota.
  const podeAnotar = useCan("write-notes");
  // Só o "está aberta ou não" mora aqui. Texto, menção e teclado vivem dentro
  // do `InternalNoteBox` — este arquivo é do upstream, e cada linha nossa a
  // mais é superfície de conflito no merge.
  const [anotando, setAnotando] = useState(false);
  const fecharNota = useCallback(() => setAnotando(false), []);
  // Agendar (925). Data e hora em campos separados, como no seletor que o
  // operador desenhou — e é a dupla que `comporHorario` (testada) recebe.
  const [dataAg, setDataAg] = useState("");
  const [horaAg, setHoraAg] = useState("");
  const [seletorAberto, setSeletorAberto] = useState(false);
  const [agendando, setAgendando] = useState(false);
  /**
   * ⚠️ Ref, não estado: dois Enter no mesmo tique leem `agendando === false`
   * nos dois, e o `setText("")` só acontece depois do `await`. Sem esta
   * trava, segurar Enter grava DUAS agendadas do mesmo texto e o cliente
   * recebe a mesma mensagem duas vezes no minuto marcado. O `disabled` do
   * botão protege só o clique.
   */
  const agendandoRef = useRef(false);

  /**
   * A hora escolhida, ou `null` enquanto falta metade.
   *
   * ⚠️ É esta variável que DESVIA o envio: com ela preenchida, o botão de
   * enviar agenda em vez de mandar agora. Por isso limpar os dois campos é a
   * única forma de voltar ao envio imediato — e por isso a etiqueta ao lado
   * do botão existe: hora escolhida tem de estar VISÍVEL, senão o atendente
   * digita uma resposta urgente, aperta enviar e ela sai amanhã.
   */
  const quandoAg = dataAg && horaAg ? comporHorario(dataAg, horaAg) : null;
  /** Qual atalho pintou os campos — só para destacar o botão. */
  const [atalhoAtivo, setAtalhoAtivo] = useState<ChaveDeAtalho | null>(null);

  const limparAgendamento = useCallback(() => {
    setDataAg("");
    setHoraAg("");
    setAtalhoAtivo(null);
  }, []);

  const aplicarAtalho = useCallback((chave: ChaveDeAtalho, horas: number) => {
    const { data, hora } = daquiAHoras(horas);
    setDataAg(data);
    setHoraAg(hora);
    setAtalhoAtivo(chave);
  }, []);

  /**
   * Abrir o seletor já deixa "24 horas" escolhido: amanhã, na hora de agora.
   *
   * ⚠️ Não é só conveniência — é o que faz o estado inicial ser VÁLIDO.
   * Abrindo em "hoje, agora", a hora já nasce no passado (por milissegundos),
   * e o botão de enviar apareceria armado para recusar. Um dia à frente é
   * também o piso real de uso: agendar é para depois, não para daqui a pouco.
   */
  const abrirSeletor = useCallback(
    (aberto: boolean) => {
      setSeletorAberto(aberto);
      if (aberto && !dataAg && !horaAg) {
        aplicarAtalho(ATALHOS_DE_PRAZO[0].chave, ATALHOS_DE_PRAZO[0].horas);
      }
    },
    [dataAg, horaAg, aplicarAtalho],
  );

  /**
   * O estado do agendamento, empacotado para o `<SeletorDeHorario>`.
   *
   * ⚠️ Objeto cru, sem `useMemo`: `quandoAg` é uma `Date` NOVA a cada render
   * (nasce de `comporHorario`), então memoizar não evitaria identidade nova —
   * só somaria uma lista de dependências para envelhecer errado. O consumidor
   * não é memoizado.
   */
  const ag: Agendamento = {
    quandoAg,
    dataAg,
    horaAg,
    setDataAg,
    setHoraAg,
    atalhoAtivo,
    setAtalhoAtivo,
    aplicarAtalho,
    limparAgendamento,
    seletorAberto,
    setSeletorAberto,
    abrirSeletor,
  };

  // Media (like free-form text) is only allowed inside the 24h window.
  const inputsDisabled = readOnly || sessionExpired;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Tear down any live recording + timer on unmount so a mid-record
  // navigation doesn't leak the mic, and GC a staged-but-unsent
  // attachment so it doesn't orphan in the bucket.
  useEffect(() => {
    return () => {
      clearTimer();
      cancelledRef.current = true;
      // stop() releases the mic stream + audio context inside opus-recorder.
      void recorderRef.current?.stop().catch(() => {});
      removeStaged(draftRef.current?.path);
    };
  }, [clearTimer, removeStaged]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // ⚠️ A BORDA TEM DE VOLTAR À CONTA. `scrollHeight` é a caixa de PADDING
    // (conteúdo + padding, sem borda), mas o preflight do Tailwind põe
    // `box-sizing: border-box` em tudo — então o `height` que atribuímos aqui
    // INCLUI a borda. Devolver o `scrollHeight` cru rouba 2px do texto e o
    // navegador acende a barra de rolagem com UMA linha digitada (medido no
    // app: `height: 40px` deixava 38px de conteúdo para uma linha de 20px).
    const borda = el.offsetHeight - el.clientHeight;
    // Max 4 lines (~96px), medidos na caixa de padding como o `scrollHeight`.
    el.style.height = `${Math.min(el.scrollHeight, 96) + borda}px`;
  }, []);

  // ---- Envio com janela de arrependimento ----------------------------
  //
  // Enter enviava na hora, e mensagem errada no WhatsApp não tem volta: só
  // resta apagar, o que o cliente vê. A mensagem fica retida por
  // SEGUNDOS_DESFAZER e um "Desfazer" a traz de volta ao campo.
  //
  // Duas regras, e as duas já foram violadas por engano antes:
  //
  // 1. NUNCA perder a mensagem em silêncio. Trocar de conversa, desmontar o
  //    componente ou mandar outra ENVIAM a pendente em vez de descartá-la —
  //    o operador apertou Enter, a intenção dele foi enviar.
  // 2. NUNCA entregar a quem não era o destinatário. O despachante é preso
  //    quando a mensagem é retida, não quando ela sai.

  // `onSend` por REF, não por dependência.
  //
  // O pai o memoiza com `conversation` na lista de dependências, e esse
  // objeto ganha identidade nova a cada atualização em tempo real. Se o
  // efeito de desmontagem dependesse de `onSend`, uma mensagem do cliente
  // chegando durante a janela re-registraria o efeito, o cleanup rodaria e a
  // pendente sairia antes da hora — o "Desfazer" só funcionaria em conversa
  // parada, que é justamente quando ninguém precisa dele.
  const onSendRef = useRef(onSend);
  useEffect(() => {
    onSendRef.current = onSend;
  }, [onSend]);

  // Mesmo motivo do `onSendRef`: usado dentro de callbacks que não podem
  // trocar de identidade a cada render do pai.
  const onClearReplyRef = useRef(onClearReply);
  useEffect(() => {
    onClearReplyRef.current = onClearReply;
  }, [onClearReply]);

  // Ref espelhando a pendente: o cleanup do efeito de desmontagem precisa do
  // valor mais recente sem re-registrar o efeito a cada tecla.
  const pendenteRef = useRef<{
    texto: string;
    replyToId?: string;
    enviar: (texto: string, replyToId?: string) => void;
  } | null>(null);
  useEffect(() => {
    pendenteRef.current = pendente
      ? { texto: pendente.texto, replyToId: pendente.replyToId, enviar: pendente.enviar }
      : null;
  }, [pendente]);

  const descartarTimer = useCallback(() => {
    if (timerDesfazerRef.current) {
      clearTimeout(timerDesfazerRef.current);
      timerDesfazerRef.current = null;
    }
  }, []);

  /** Manda a pendente na hora (sem esperar o relógio) e limpa o estado. */
  const liberarPendente = useCallback(() => {
    descartarTimer();
    const p = pendenteRef.current;
    pendenteRef.current = null;
    setPendente(null);
    if (p) {
      // `p.enviar`, NUNCA `onSendRef.current`: o segundo já aponta para a
      // conversa que está na tela AGORA, que pode não ser a de origem.
      p.enviar(p.texto, p.replyToId);
      // A citação some só quando a mensagem SAI. Limpando no Enter, desfazer
      // devolvia o texto mas perdia a resposta citada — e o operador teria de
      // procurar de novo a mensagem que estava respondendo.
      onClearReplyRef.current?.();
    }
  }, [descartarTimer]);

  const desfazerEnvio = useCallback(() => {
    descartarTimer();
    const p = pendenteRef.current;
    pendenteRef.current = null;
    setPendente(null);
    if (!p) return;
    // Devolve o texto ao campo para o operador corrigir em vez de redigitar.
    setText(p.texto);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(p.texto.length, p.texto.length);
      adjustHeight();
    });
  }, [descartarTimer, adjustHeight]);

  /**
   * Agenda o texto para a hora do campo (925).
   *
   * ⚠️ Não encosta em `setPendente`, e isso é a regra inteira. A janela de
   * desfazer tem TRÊS saídas que disparam na hora — trocar de conversa,
   * desmontar o componente e apertar Enter de novo. Um "modo agendar" que
   * passasse por ela mandaria em três segundos a mensagem marcada para
   * amanhã, e o operador só descobriria pela resposta do cliente.
   */
  const agendar = useCallback(
    async (
      texto: string,
      // 932: o anexo já subiu para o bucket quando foi ANEXADO — aqui só se
      // guarda o endereço dele. `replyToId` é a citação, que a 925 não
      // levava.
      extra?: { anexo?: MediaDraft | null; replyToId?: string },
    ): Promise<boolean> => {
      const data = quandoAg;
      if (!data) {
        toast.error(tAgendadas("scheduleInvalid"));
        return false;
      }
      if (data.getTime() <= Date.now()) {
        toast.error(tAgendadas("scheduleInThePast"));
        return false;
      }
      if (agendandoRef.current) return false;
      agendandoRef.current = true;
      setAgendando(true);
      const anexo = extra?.anexo ?? null;
      // O arquivo passa a ser da agendada a partir daqui — ver `entreguesRef`.
      if (anexo) entreguesRef.current.add(anexo.path);
      try {
        const res = await fetch("/api/cb/scheduled", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversationId,
            body: texto,
            scheduled_for: data.toISOString(),
            // ⚠️ A URL NÃO vai — o servidor a deriva do caminho conferido.
            // Mandá-la daqui seria oferecer um campo que ele ignora, e a
            // próxima pessoa a ler isto acharia que ela importa.
            media_path: anexo?.path,
            media_kind: anexo?.kind,
            // Só o documento mostra o nome ao destinatário; mandar sempre
            // encheria a coluna com `voice-172….ogg`.
            media_filename: anexo?.kind === "document" ? anexo.filename : undefined,
            reply_to_message_id: extra?.replyToId,
          }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) {
          // Falhou: o arquivo volta a ser do rascunho, e volta a poder ser
          // recolhido se o operador sair da tela sem tentar de novo.
          if (anexo) entreguesRef.current.delete(anexo.path);
          toast.error(json.error ?? tAgendadas("scheduleFailed"));
          return false;
        }
        toast.success(tAgendadas("scheduled"));
        // ⚠️ O campo de texto só é limpo quando ELE é o que foi agendado.
        // Agendando um ANEXO, a legenda vem do rascunho e a caixa de mensagem
        // pode ter outra coisa sendo escrita — apagá-la seria destruir, em
        // silêncio, texto que ninguém mandou apagar.
        //
        // Quando é o texto mesmo, limpar é obrigatório: senão o operador manda
        // a mesma coisa agora e de novo na hora marcada.
        if (!anexo) setText("");
        // A hora sempre sai: o próximo envio tem de ser imediato por padrão —
        // hora esquecida no campo transformaria uma resposta urgente em algo
        // que sai amanhã.
        limparAgendamento();
        // ⚠️ A citação sai da tela porque já está GUARDADA na agendada (932):
        // deixá-la ali diria que a próxima coisa digitada também responde
        // àquela bolha.
        onClearReply?.();
        // A altura só volta ao normal quando o campo foi esvaziado.
        if (!anexo && textareaRef.current) textareaRef.current.style.height = "auto";
        onScheduled?.();
        return true;
      } catch {
        if (anexo) entreguesRef.current.delete(anexo.path);
        toast.error(tAgendadas("scheduleFailed"));
        return false;
      } finally {
        agendandoRef.current = false;
        setAgendando(false);
      }
    },
    [quandoAg, conversationId, onScheduled, onClearReply, tAgendadas, limparAgendamento],
  );

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sessionExpired) return;

    // ⚠️ DESVIO ANTES DE QUALQUER COISA. Com hora no campo, esta mensagem
    // não passa pela janela de desfazer nem pelo despachante — vai para a
    // fila e pronto. Ver a nota em `agendar`.
    if (quandoAg) {
      // 932: a citação vai junto. Antes ela era descartada, e a agendada
      // chegava ao cliente como uma frase solta.
      await agendar(trimmed, { replyToId: replyTo?.id });
      return;
    }

    // Já havia uma esperando: ela vai AGORA, para a ordem das mensagens na
    // conversa do cliente ser a mesma em que foram escritas.
    liberarPendente();

    // O DESPACHANTE É CAPTURADO AQUI, e isto é a correção inteira.
    //
    // O pai reconstrói `onSend` amarrado à conversa aberta. Resolvendo o
    // despachante só na hora de disparar, uma mensagem escrita para o
    // cliente A e retida por 5s era entregue ao cliente B se o operador
    // clicasse em outra conversa nesse intervalo — o compositor NÃO
    // remonta na troca, então nada interrompia a espera. Num escritório de
    // advocacia isso é quebra de sigilo, e silenciosa: some do histórico de
    // A e aparece no de B.
    const despachante = onSendRef.current;
    setPendente({
      texto: trimmed,
      replyToId: replyTo?.id,
      expiraEm: Date.now() + SEGUNDOS_DESFAZER * 1000,
      enviar: despachante,
    });
    pendenteRef.current = { texto: trimmed, replyToId: replyTo?.id, enviar: despachante };
    timerDesfazerRef.current = setTimeout(liberarPendente, SEGUNDOS_DESFAZER * 1000);

    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, sessionExpired, replyTo?.id, liberarPendente, quandoAg, agendar]);

  // Trocar de conversa solta a pendente na hora.
  //
  // O compositor NÃO remonta nessa troca (o pai só troca o objeto da
  // conversa, sem `key`), então sem isto a barra de "enviando" ficaria
  // pendurada na thread do cliente errado, e o "Desfazer" dali jogaria o
  // texto de um cliente no campo de outro. A mensagem em si já vai para o
  // lugar certo — `enviar` está preso à origem.
  //
  // ⚠️ E fecha a caixa de anotação junto, pelo MESMO motivo. Como o
  // compositor não remonta, a caixa aberta com texto dentro sobrevivia à
  // troca — e ela salva contra o `conversationId` do render atual, então
  // clicar em Salvar depois de trocar gravaria a anotação de um cliente na
  // conversa de outro. Numa anotação interna de escritório de advocacia isso
  // é vazamento de informação entre casos, não só um erro de UI. Fechar
  // desmonta o `InternalNoteBox`, e o texto que estava dentro vai junto.
  const conversaAnteriorRef = useRef(conversationId);
  useEffect(() => {
    if (conversaAnteriorRef.current === conversationId) return;
    conversaAnteriorRef.current = conversationId;
    liberarPendente();
    // ⚠️ E a hora escolhida vai junto. O compositor não remonta na troca, e
    // uma hora esquecida transforma a próxima mensagem — que pode ser "estou
    // ligando agora" para OUTRO cliente — em algo que sai amanhã. A etiqueta
    // âmbar avisa, mas avisar não é impedir.
    limparAgendamento();
    setSeletorAberto(false);
    setAnotando(false);
  }, [conversationId, liberarPendente, limparAgendamento]);

  // Contagem regressiva da barra. Sem isto o rótulo repetiria o valor cheio
  // o tempo todo, inclusive no último instante antes de a mensagem sair.
  const [restam, setRestam] = useState(SEGUNDOS_DESFAZER);
  useEffect(() => {
    if (!pendente) return;
    const tick = () =>
      setRestam(Math.max(0, Math.ceil((pendente.expiraEm - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [pendente]);

  // Desmontagem (trocou de conversa, saiu da rota): envia em vez de perder.
  // Lista de dependências VAZIA de propósito — ver a nota em `onSendRef`.
  useEffect(() => {
    return () => {
      const p = pendenteRef.current;
      if (p) {
        pendenteRef.current = null;
        p.enviar(p.texto, p.replyToId);
      }
      if (timerDesfazerRef.current) clearTimeout(timerDesfazerRef.current);
    };
  }, []);

  // Fechar a aba é o único caso que não dá para salvar: a requisição não
  // sobrevive. Avisar é o melhor disponível.
  useEffect(() => {
    if (!pendente) return;
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [pendente]);

  /**
   * Aplica um estilo à seleção do campo. Mexe no valor e RESTAURA a seleção:
   * sem isso o cursor pula para o fim a cada clique e formatar duas palavras
   * seguidas vira um exercício de paciência.
   */
  const formatar = useCallback(
    (estilo: EstiloFormatacao) => {
      const el = textareaRef.current;
      if (!el) return;
      const r = alternarMarcador(text, el.selectionStart, el.selectionEnd, estilo);
      setText(r.texto);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(r.inicio, r.fim);
        adjustHeight();
      });
    },
    [text, adjustHeight],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Atalhos iguais aos do WhatsApp Web, para não haver o que reaprender.
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "b") {
          e.preventDefault();
          formatar("negrito");
          return;
        }
        if (k === "i") {
          e.preventDefault();
          formatar("italico");
          return;
        }
        if (e.shiftKey && k === "x") {
          e.preventDefault();
          formatar("riscado");
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, formatar]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      adjustHeight();
    },
    [adjustHeight]
  );

  // Ask the AI assistant for a suggested reply and drop it into the
  // composer for the agent to edit + send. Read-only server-side —
  // nothing is sent until the agent hits Send.
  const handleDraft = useCallback(async () => {
    if (drafting) return;
    setDrafting(true);
    try {
      const res = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "ai_not_configured") {
          toast.error("AI isn't set up yet — enable it in Settings → AI Assistant.");
        } else {
          toast.error(data.error ?? "Couldn't draft a reply.");
        }
        return;
      }
      const draftText = typeof data.draft === "string" ? data.draft.trim() : "";
      if (!draftText) {
        toast.error("The assistant didn't return a reply.");
        return;
      }
      setText(draftText);
      // Let the textarea grow to fit and drop the cursor at the end so
      // the agent can tweak immediately.
      requestAnimationFrame(() => {
        adjustHeight();
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    } catch {
      toast.error("Couldn't reach the AI assistant.");
    } finally {
      setDrafting(false);
    }
  }, [drafting, conversationId, adjustHeight]);

  // ---- Interactive message + quick replies --------------------------

  const openInteractiveBuilder = useCallback(
    (seed?: InteractiveMessagePayload) => {
      setInteractivePayload(seed ?? blankButtonsPayload());
      setInteractiveOpen(true);
    },
    [],
  );

  const sendInteractive = useCallback(() => {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    onSendInteractive(interactivePayload, replyTo?.id);
    setInteractiveOpen(false);
    onClearReply?.();
  }, [interactivePayload, onSendInteractive, replyTo?.id, onClearReply]);

  // Persist the current builder payload as a reusable interactive snippet.
  const saveAsQuickReply = useCallback(async () => {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const title = window
      .prompt(t("quickReplyNamePrompt"))
      ?.trim();
    if (!title) return;
    setSavingQuickReply(true);
    try {
      const res = await fetch("/api/quick-replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          kind: "interactive",
          interactive_payload: interactivePayload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t("quickReplySaveError"));
        return;
      }
      toast.success(t("quickReplySaved"));
    } catch {
      toast.error(t("quickReplySaveError"));
    } finally {
      setSavingQuickReply(false);
    }
  }, [interactivePayload, t]);

  // A picked quick reply: text fills the composer; interactive opens the
  // builder pre-filled so the agent can tweak before sending.
  const handlePickQuickReply = useCallback(
    (qr: QuickReply) => {
      setQuickReplyOpen(false);
      if (qr.kind === "interactive" && qr.interactive_payload) {
        // Botões/listas não entregam via Baileys — este atalho por resposta
        // rápida também precisa da barreira (o item direto já está oculto;
        // sem isto o envio morreria num 400 do servidor).
        if (channelKind === "evolution") {
          toast.error(t("interactiveNotOnChannel"));
          return;
        }
        openInteractiveBuilder(qr.interactive_payload);
        return;
      }
      const body = qr.content_text ?? "";
      // Separate the snippet from any existing draft with a newline so the
      // words don't run together ("Thanks" + "we'll…" → "Thankswe'll…").
      setText((prev) =>
        prev && !/\s$/.test(prev) ? `${prev}\n${body}` : `${prev}${body}`,
      );
      requestAnimationFrame(() => {
        adjustHeight();
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    },
    [openInteractiveBuilder, adjustHeight, channelKind, t],
  );

  // Upload a captured file to chat-media and stage it as a draft.
  const stageUpload = useCallback(
    async (kind: ComposerMediaKind, file: File) => {
      // Per-kind ceiling mirrors Meta's caps (image 5 MB, etc.) so we
      // reject before upload rather than orphaning an object that Meta
      // would then refuse at send.
      const max = MEDIA_MAX_BYTES_BY_KIND[kind];
      if (file.size > max) {
        toast.error(
          `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — ${kind} limit is ${Math.round(
            max / 1024 / 1024,
          )} MB.`,
        );
        return;
      }
      setBusy(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
        // Replacing an existing draft? GC the previous object first.
        removeStaged(draftRef.current?.path);
        setDraft({ kind, mediaUrl: publicUrl, path, filename: file.name, caption: "" });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setBusy(false);
      }
    },
    [removeStaged],
  );

  const handlePicked = useCallback(
    (kind: "image" | "video" | "document", file: File | undefined) => {
      if (file) void stageUpload(kind, file);
    },
    [stageUpload],
  );

  /**
   * Item do acervo (953) escolhido: vira o MESMO rascunho de um arquivo
   * recém-subido — com legenda, prévia, envio agora ou agendamento.
   *
   * ⚠️ A rota COPIA o objeto e devolve o caminho da cópia. É por isso que o
   * `removeStaged` daqui embaixo é seguro: o que ele pode vir a apagar é a
   * cópia, nunca o arquivo do acervo. Enviar por referência faria um envio
   * falho apagar o contrato-padrão do escritório inteiro — ver o cabeçalho de
   * `api/cb/acervo/[id]/copiar`.
   */
  const escolherDoAcervo = useCallback(
    async (item: MediaLibraryItem) => {
      setAcervoOpen(false);
      setBusy(true);
      try {
        const res = await fetch(`/api/cb/acervo/${item.id}/copiar`, {
          method: "POST",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.path) {
          toast.error(t("acervoError"));
          return;
        }
        removeStaged(draftRef.current?.path);
        setDraft({
          kind: json.kind as ComposerMediaKind,
          mediaUrl: json.mediaUrl as string,
          path: json.path as string,
          filename: (json.filename as string) ?? item.filename,
          caption: "",
        });
      } catch {
        toast.error(t("acervoError"));
      } finally {
        setBusy(false);
      }
    },
    [removeStaged, t],
  );

  // ---- Voice recording (client-side Ogg/Opus, no server transcode) ---

  // The encoded Ogg/Opus file from opus-recorder → upload as an audio
  // draft. WhatsApp renders Ogg/Opus as a playable voice note.
  const finalizeRecording = useCallback(
    async (bytes: Uint8Array) => {
      // Uint8Array is a valid BlobPart at runtime; the cast sidesteps the
      // lib.dom ArrayBufferLike-vs-ArrayBuffer generic mismatch.
      const file = new File([bytes as unknown as BlobPart], `voice-${Date.now()}.ogg`, {
        type: "audio/ogg",
      });
      if (file.size === 0) return; // cancelled / empty take
      if (file.size > MEDIA_MAX_BYTES_BY_KIND.audio) {
        toast.error("Recording is too long (over 16 MB).");
        return;
      }
      setBusy(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
        removeStaged(draftRef.current?.path);
        setDraft({ kind: "audio", mediaUrl: publicUrl, path, filename: file.name, caption: "" });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setBusy(false);
      }
    },
    [removeStaged],
  );

  const startRecording = useCallback(async () => {
    if (inputsDisabled || busy || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      toast.error("Voice recording isn't supported in this browser.");
      return;
    }
    try {
      // Lazy-load the encoder (≈400 KB worker) only when the user records,
      // keeping it out of the main bundle.
      const { default: Recorder } = await import("opus-recorder");
      const recorder = new Recorder({
        encoderPath: OPUS_ENCODER_PATH,
        numberOfChannels: 1,
        encoderApplication: 2048, // VOIP — tuned for speech
        encoderSampleRate: 48000,
        streamPages: false, // one callback with the complete file on stop
      });
      cancelledRef.current = false;
      recorder.ondataavailable = (bytes) => {
        if (cancelledRef.current) return;
        void finalizeRecording(bytes);
      };
      recorderRef.current = recorder;
      await recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      void recorderRef.current?.stop().catch(() => {});
      recorderRef.current = null;
      toast.error("Microphone access denied or unavailable.");
    }
  }, [inputsDisabled, busy, recording, finalizeRecording]);

  const stopRecording = useCallback(() => {
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  // Auto-stop at the cap so a forgotten recording can't blow the
  // upload size limit.
  useEffect(() => {
    if (recording && recordSeconds >= MAX_RECORDING_SECONDS) {
      stopRecording();
    }
  }, [recording, recordSeconds, stopRecording]);

  // ---- Draft send / discard -----------------------------------------

  const sendDraft = useCallback(async () => {
    if (!draft || busy) return;

    // ⚠️ DESVIO ANTES DE QUALQUER COISA, igual ao do texto (925). Com hora
    // escolhida, o anexo vai para a fila em vez de sair agora.
    if (quandoAg) {
      const legenda = podeTerLegenda(draft.kind) ? draft.caption.trim() : "";
      const ok = await agendar(legenda, { anexo: draft, replyToId: replyTo?.id });
      // ⚠️ Só limpa o rascunho quando DEU CERTO, e sem apagar o objeto do
      // bucket: ele passou a pertencer à agendada, e o disparador vai buscá-lo
      // lá daqui a horas. Falhou? O rascunho fica na tela, com o arquivo já
      // subido, e a pessoa tenta de novo sem reanexar.
      if (ok) setDraft(null);
      return;
    }

    onSendMedia({
      kind: draft.kind,
      mediaUrl: draft.mediaUrl,
      path: draft.path,
      // Audio takes no caption (Meta rejects it). Everything else: the
      // trimmed caption, or undefined when blank.
      caption: podeTerLegenda(draft.kind) ? draft.caption.trim() || undefined : undefined,
      filename: draft.kind === "document" ? draft.filename : undefined,
      replyToId: replyTo?.id,
    });
    // The object is now owned by the sent message — clear without GC.
    setDraft(null);
    onClearReply?.();
  }, [draft, busy, onSendMedia, replyTo?.id, onClearReply, quandoAg, agendar]);

  // Discard GCs the staged object — it was uploaded but never sent.
  const discardDraft = useCallback(() => {
    removeStaged(draft?.path);
    setDraft(null);
  }, [draft?.path, removeStaged]);

  const setCaption = useCallback((caption: string) => {
    setDraft((d) => (d ? { ...d, caption } : d));
  }, []);

  // ---- Render --------------------------------------------------------

  return (
    <div className="border-t border-border bg-card p-3">
      {/* Mensagem retida: enquanto esta barra estiver visível, nada saiu. */}
      {pendente && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2">
          <div className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-transparent" />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {t("sendingIn", { seconds: restam })} &mdash; {pendente.texto}
          </span>
          <button
            type="button"
            onClick={desfazerEnvio}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10"
          >
            {t("undoSend")}
          </button>
        </div>
      )}
      {replyTo && (
        <div className="mb-2">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        </div>
      )}
      {sessionExpired && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-400">
            {t("sessionExpiredHint")}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-amber-400 hover:text-amber-300"
            onClick={onOpenTemplates}
          >
            <LayoutTemplate className="mr-1 h-3 w-3" />
            {t("templates")}
          </Button>
        </div>
      )}

      {/* Caixa de anotação interna (918/919) — componente próprio.
          ⚠️ Ela tem <textarea> PRÓPRIA, nunca a do compositor: o
          `handleKeyDown` de lá manda Enter para `handleSend`, e a anotação
          sairia como mensagem para o cliente. */}
      {anotando && (
        <InternalNoteBox
          conversationId={conversationId}
          onSaved={onNoteCreated}
          onClose={fecharNota}
        />
      )}

      {/* Hidden file inputs driven by the attach menu. */}
      <input
        ref={imageInputRef}
        type="file"
        accept={PICKER_ACCEPT.image}
        className="hidden"
        onChange={(e) => {
          handlePicked("image", e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept={PICKER_ACCEPT.video}
        className="hidden"
        onChange={(e) => {
          handlePicked("video", e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={documentInputRef}
        type="file"
        accept={PICKER_ACCEPT.document}
        className="hidden"
        onChange={(e) => {
          handlePicked("document", e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {draft ? (
        <MediaDraftPreview
          draft={draft}
          busy={busy}
          readOnly={readOnly}
          onCaptionChange={setCaption}
          onDiscard={discardDraft}
          onSend={() => void sendDraft()}
          // 932: a prévia SUBSTITUI o compositor, então o relógio precisa
          // existir aqui também — senão anexar um arquivo tira a opção de
          // agendar da tela.
          ag={ag}
          agendando={agendando}
          inputsDisabled={inputsDisabled}
          tAgendadas={tAgendadas}
          t={t}
        />
      ) : recording ? (
        // Recording bar — replaces the composer while the mic is live.
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted px-4 py-2.5">
          <span className="flex h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
          <span className="flex-1 text-sm text-foreground">
            {t("recording", { current: formatDuration(recordSeconds), max: formatDuration(MAX_RECORDING_SECONDS) })}
          </span>
          <button
            type="button"
            onClick={cancelRecording}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-card hover:text-foreground"
          >
            {t("cancel")}
          </button>
          <Button
            size="sm"
            onClick={stopRecording}
            className="h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90"
            title={t("stopAndAttach")}
          >
            <Square className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex items-end gap-0.5">
          {/* Attach menu — photo / video / document / voice. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={inputsDisabled || busy}
              title={
                readOnly
                  ? t("readOnlyTitle")
                  : inputsDisabled
                    ? undefined
                    : t("attachMedia")
              }
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="border-border bg-popover">
              {/* O acervo vem PRIMEIRO: é o caminho curado, o que o escritório
                  quer que a equipe use. Procurar no computador é a exceção. */}
              <DropdownMenuItem onClick={() => setAcervoOpen(true)}>
                <Library className="mr-2 h-4 w-4" />
                {t("fromLibrary")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                <ImageIcon className="mr-2 h-4 w-4" />
                {t("photo")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => videoInputRef.current?.click()}>
                <Video className="mr-2 h-4 w-4" />
                {t("video")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => documentInputRef.current?.click()}>
                <FileText className="mr-2 h-4 w-4" />
                {t("document")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* + menu — interactive messages + quick replies. Gated on the
              24h window like free-form text (interactive requires it). */}
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={inputsDisabled}
              title={
                readOnly
                  ? t("readOnlyTitle")
                  : inputsDisabled
                    ? undefined
                    : t("moreActions")
              }
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="border-border bg-popover">
              {/* Botões/listas não entregam via Baileys — o item some no
                  canal Evolution; respostas rápidas de texto continuam. */}
              {channelKind !== "evolution" && (
                <DropdownMenuItem onClick={() => openInteractiveBuilder()}>
                  <MessageSquareDashed className="mr-2 h-4 w-4" />
                  {t("interactiveMessage")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setQuickReplyOpen(true)}>
                <Zap className="mr-2 h-4 w-4" />
                {t("quickReplies")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Templates são um conceito da API oficial — o botão some no
              canal Evolution. */}
          {channelKind !== "evolution" && (
            <GatedButton
              variant="ghost"
              size="sm"
              canAct={!readOnly}
              gateReason="send messages"
              title={readOnly ? undefined : t("sendTemplate")}
              className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground"
              onClick={onOpenTemplates}
            >
              <LayoutTemplate className="h-4 w-4" />
            </GatedButton>
          )}

          <GatedButton
            variant="ghost"
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            disabled={drafting}
            title={readOnly ? undefined : t("draftWithAI")}
            className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-primary"
            onClick={handleDraft}
          >
            {drafting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </GatedButton>

          {/* Anotação interna.
              ⚠️ NÃO usa `inputsDisabled`. Aquele sinalizador carrega o
              `sessionExpired`, que é a janela de 24h da Meta — regra de envio
              ao CLIENTE. Anotação não sai daqui: travá-la quando a janela
              fecha mataria a feature justamente na conversa parada, que é
              onde mais se anota ("liguei, não atendeu"). Só o papel decide, e
              o papel aqui inclui `viewer`. */}
          {podeAnotar && (
            <Button
              variant="ghost"
              size="sm"
              title={t("internalNote")}
              onClick={() => setAnotando((v) => !v)}
              className={cn(
                "h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-amber-600",
                anotando && "text-amber-600",
              )}
            >
              <StickyNote className="h-4 w-4" />
            </Button>
          )}

          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={
              readOnly
                ? t("readOnlyPlaceholder")
                : sessionExpired
                  ? t("sessionExpiredPlaceholder")
                  : t("typeMessagePlaceholder")
            }
            disabled={sessionExpired || readOnly}
            rows={1}
            // Textarea keeps its own inline title — the GatedButton
            // wrapping pattern doesn't apply to non-button inputs.
            // The placeholder text also surfaces the read-only state.
            title={readOnly ? t("readOnlyTitle") : undefined}
            className={cn(
              "flex-1 resize-none rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50",
              (sessionExpired || readOnly) && "cursor-not-allowed opacity-50"
            )}
          />

          {/* Gravar nota de voz.
              ⚠️ Botão PRÓPRIO, fora do menu do clipe, a pedido do operador:
              gravar voz é das ações mais repetidas do atendimento e estava a
              dois cliques, escondida atrás de um ícone que anuncia "anexar
              arquivo". Fica à direita, junto do relógio e do enviar, que é
              onde a mão já está quando se termina de escrever.
              ⚠️ `inputsDisabled` como o resto do que sai para o cliente: a
              nota de voz é mensagem, e fora da janela de 24h da Meta ela não
              sairia. `busy` porque um upload em curso já ocupa o compositor. */}
          {!readOnly && (
            <Button
              variant="ghost"
              size="sm"
              disabled={inputsDisabled || busy}
              title={t("voiceNote")}
              onClick={() => void startRecording()}
              className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Mic className="h-4 w-4" />
            </Button>
          )}

          {/* Agendar (925) — SELETOR que abre ACIMA do botão, nunca um
              diálogo, e a hora escolhida vira uma etiqueta enxuta aqui do
              lado. O campo cru não cabe nesta linha: medido com a ficha do
              contato aberta, um `datetime-local` de 168px derrubava a caixa
              de mensagem de 312px para 136px — menor que o próprio campo, na
              tela em que se escreve.
              ⚠️ `inputsDisabled` (e não só o papel): agendar É enviar ao
              cliente, com atraso. Fora da janela de 24h da Meta a mensagem
              não sairia de jeito nenhum. */}
          {!readOnly && (
            <SeletorDeHorario ag={ag} disabled={inputsDisabled} t={tAgendadas} />
          )}

          <GatedButton
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            disabled={!text.trim() || sessionExpired || agendando}
            onClick={handleSend}
            // O rótulo muda junto com a etiqueta: o mesmo botão faz coisas
            // diferentes, e quem passa o mouse tem de saber qual.
            title={quandoAg ? tAgendadas("scheduleAction") : undefined}
            className={cn(
              "h-9 w-9 shrink-0 p-0 disabled:opacity-40",
              quandoAg
                ? "bg-amber-500 hover:bg-amber-600"
                : "bg-primary hover:bg-primary/90",
            )}
          >
            {agendando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : quandoAg ? (
              <CalendarClock className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </GatedButton>
        </div>
      )}

      {/* Hint sits outside the flex row so its height doesn't push
          `items-end` buttons below the textarea. Indented to line up
          under the textarea left edge. */}
      {!draft && !recording && (
        <div className="mt-1 flex items-center gap-1 pl-[5.5rem]">
          {/* Inserem os marcadores do WhatsApp na seleção. O texto enviado
              continua sendo `*assim*` — é o próprio WhatsApp que formata do
              outro lado; os botões só poupam decorar a sintaxe. */}
          <BotaoFormato onClick={() => formatar("negrito")} title={t("bold")}>
            <span className="font-bold">N</span>
          </BotaoFormato>
          <BotaoFormato onClick={() => formatar("italico")} title={t("italic")}>
            <span className="italic">I</span>
          </BotaoFormato>
          <BotaoFormato onClick={() => formatar("riscado")} title={t("strike")}>
            <span className="line-through">S</span>
          </BotaoFormato>
          <BotaoFormato onClick={() => formatar("mono")} title={t("mono")}>
            <span className="font-mono text-[10px]">{"</>"}</span>
          </BotaoFormato>
          <p className="ml-1 text-[10px] text-muted-foreground">{t("draftHint")}</p>
        </div>
      )}

      {/* Interactive-message builder dialog. */}
      <Dialog open={interactiveOpen} onOpenChange={setInteractiveOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("interactiveMessage")}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto">
            <InteractiveBuilder
              value={interactivePayload}
              onChange={setInteractivePayload}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={savingQuickReply}
              onClick={saveAsQuickReply}
            >
              {savingQuickReply ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="mr-1 h-4 w-4" />
              )}
              {t("saveAsQuickReply")}
            </Button>
            <Button onClick={sendInteractive}>
              <Send className="mr-1 h-4 w-4" />
              {t("send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick-reply picker. */}
      <QuickReplyPicker
        open={quickReplyOpen}
        onOpenChange={setQuickReplyOpen}
        onPick={handlePickQuickReply}
      />

      <AcervoPicker
        open={acervoOpen}
        onOpenChange={setAcervoOpen}
        onPick={(item) => void escolherDoAcervo(item)}
      />

      {/* Agendar (925). Leva o texto que está no campo; agendar LIMPA o
          campo, do mesmo jeito que enviar — senão o operador manda a mesma
          coisa duas vezes, uma agora e outra na hora marcada. */}
    </div>
  );
}


/**
 * Staged-attachment preview with caption + send/discard. Declared at
 * module scope (not nested in MessageComposer) so React keeps it mounted
 * across the parent's re-renders — a nested component would remount the
 * caption input on every keystroke and drop focus.
 */
/**
 * Quanto o operador pode digitar de legenda.
 *
 * ⚠️ A Meta corta em 1024 o texto FINAL, e desde a 923 o servidor prefixa a
 * assinatura antes de mandar. Enquanto o contador daqui dizia 1024 e o
 * servidor exigia 1024 menos o prefixo, dava para escrever uma legenda que o
 * campo aceitava e o envio recusava — depois de o arquivo já ter subido, que
 * é o momento mais caro possível para descobrir: a mídia é descartada do
 * bucket e o operador reanexa e redigita tudo.
 */
function useTetoDaLegenda(): number {
  const { profile, assinaturaAtiva } = useAuth();
  const nome = assinaturaAtiva
    ? nomeDePessoa(profile?.full_name, profile?.email)
    : null;
  return tetoDaLegenda(custoDaAssinatura(nome));
}

function MediaDraftPreview({
  draft,
  busy,
  readOnly,
  onCaptionChange,
  onDiscard,
  onSend,
  ag,
  agendando,
  inputsDisabled,
  tAgendadas,
  t,
}: {
  draft: MediaDraft;
  busy: boolean;
  readOnly: boolean;
  onCaptionChange: (caption: string) => void;
  onDiscard: () => void;
  onSend: () => void;
  ag: Agendamento;
  agendando: boolean;
  inputsDisabled: boolean;
  tAgendadas: ReturnType<typeof useTranslations>;
  t: ReturnType<typeof useTranslations>;
}) {
  const tetoDaLegenda = useTetoDaLegenda();
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {draft.kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={draft.mediaUrl}
              alt={draft.filename}
              className="max-h-40 rounded-lg object-cover"
            />
          )}
          {draft.kind === "video" && (
            <video src={draft.mediaUrl} controls className="max-h-40 rounded-lg" />
          )}
          {draft.kind === "audio" && (
            <audio src={draft.mediaUrl} controls className="w-full" />
          )}
          {draft.kind === "document" && (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="truncate">{draft.filename}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDiscard}
          aria-label={t("removeAttachment")}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 flex items-end gap-2">
        {podeTerLegenda(draft.kind) && (
          <input
            value={draft.caption}
            maxLength={tetoDaLegenda}
            onChange={(e) => onCaptionChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder={t("addCaption")}
            className="flex-1 rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50"
          />
        )}
        {/* ⚠️ O mesmo seletor da linha normal, não uma cópia: a prévia
            SUBSTITUI o compositor, e sem ele anexar um arquivo tirava a opção
            de agendar da tela. */}
        {!readOnly && (
          <div
            className={cn(
              "flex shrink-0 items-center gap-1",
              // Sem legenda (áudio) não há campo empurrando: o bloco vai para
              // a direita sozinho.
              !podeTerLegenda(draft.kind) && "ml-auto",
            )}
          >
            <SeletorDeHorario ag={ag} disabled={inputsDisabled} t={tAgendadas} />
          </div>
        )}
        <GatedButton
          size="sm"
          canAct={!readOnly}
          gateReason="send messages"
          disabled={busy || agendando}
          onClick={onSend}
          // O mesmo botão faz coisas diferentes conforme a hora esteja
          // escolhida ou não — e quem passa o mouse tem de saber qual.
          title={ag.quandoAg ? tAgendadas("scheduleAction") : undefined}
          className={cn(
            "h-9 w-9 shrink-0 p-0 disabled:opacity-40",
            ag.quandoAg
              ? "bg-amber-500 hover:bg-amber-600"
              : "bg-primary hover:bg-primary/90",
          )}
        >
          {agendando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : ag.quandoAg ? (
            <CalendarClock className="h-4 w-4" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </GatedButton>
      </div>
    </div>
  );
}

/** Botãozinho da barra de formatação. */
function BotaoFormato({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      // `onMouseDown` com preventDefault: sem isso o clique tira o foco do
      // campo e a seleção some ANTES de o handler rodar — o botão formataria
      // um trecho vazio.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-5 w-5 items-center justify-center rounded text-[11px] leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

/**
 * O estado do agendamento, num objeto só.
 *
 * ⚠️ Existe desde a 932 porque o seletor de horário passou a ter DOIS lugares:
 * a linha normal do compositor e a prévia do anexo — que substitui o
 * compositor inteiro quando há arquivo anexado. Sem isto, agendar mídia
 * exigiria uma segunda cópia de ~130 linhas de seletor, e as duas
 * envelheceriam separadas.
 */
interface Agendamento {
  quandoAg: Date | null;
  dataAg: string;
  horaAg: string;
  setDataAg: (v: string) => void;
  setHoraAg: (v: string) => void;
  atalhoAtivo: ChaveDeAtalho | null;
  setAtalhoAtivo: (v: ChaveDeAtalho | null) => void;
  aplicarAtalho: (chave: ChaveDeAtalho, horas: number) => void;
  limparAgendamento: () => void;
  seletorAberto: boolean;
  setSeletorAberto: (v: boolean) => void;
  abrirSeletor: (aberto: boolean) => void;
}

/**
 * Agendar (925) — SELETOR que abre ACIMA do botão, nunca um diálogo, e a hora
 * escolhida vira uma etiqueta enxuta aqui do lado. O campo cru não cabe nesta
 * linha: medido com a ficha do contato aberta, um `datetime-local` de 168px
 * derrubava a caixa de mensagem de 312px para 136px — menor que o próprio
 * campo, na tela em que se escreve.
 *
 * ⚠️ `disabled` recebe `inputsDisabled` (e não só o papel): agendar É enviar
 * ao cliente, com atraso. Fora da janela de 24h da Meta a mensagem não sairia
 * de jeito nenhum.
 *
 * ⚠️ Módulo, não aninhado: aninhado, os campos de data e hora remontariam a
 * cada tecla do compositor e perderiam o foco.
 */
function SeletorDeHorario({
  ag,
  disabled,
  t,
}: {
  ag: Agendamento;
  disabled: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <>
      {/* A etiqueta é a peça de segurança desta tela, não enfeite:
          com hora escolhida o botão ao lado AGENDA em vez de enviar,
          e isso precisa estar visível. Escondido, o atendente
          digitaria uma resposta urgente e ela sairia amanhã. */}
      {ag.quandoAg && (
        <button
          type="button"
          onClick={() => ag.setSeletorAberto(true)}
          title={t("scheduleField", { min: CICLO_MINUTOS })}
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl border border-amber-500 bg-amber-500/10 px-2 text-[11px] font-medium text-amber-700 dark:text-amber-400"
        >
          {ag.quandoAg.toLocaleString(undefined, {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
          <span
            role="button"
            tabIndex={-1}
            aria-label={t("scheduleClear")}
            title={t("scheduleClear")}
            onClick={(e) => {
              e.stopPropagation();
              ag.limparAgendamento();
            }}
            className="rounded p-0.5 hover:bg-amber-500/20"
          >
            <X className="h-3 w-3" />
          </span>
        </button>
      )}

      <Popover open={ag.seletorAberto} onOpenChange={ag.abrirSeletor}>
        <PopoverTrigger
          disabled={disabled}
          title={t("scheduleField", { min: CICLO_MINUTOS })}
          aria-label={t("scheduleField", { min: CICLO_MINUTOS })}
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
            ag.quandoAg && "text-amber-600",
          )}
        >
          <Clock className="h-4 w-4" />
        </PopoverTrigger>
        {/* `side="top"`: o compositor mora no rodapé da tela, e um
            seletor abrindo para baixo nasceria fora da janela. */}
        <PopoverContent side="top" align="end" sideOffset={8} className="w-72">
          <p className="px-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("scheduleTitle")}
          </p>
          {/* Os cinco prazos que o operador pediu. Pintam os dois
              campos de uma vez; editar qualquer campo na mão apaga o
              destaque, porque aí o valor deixou de ser o do atalho. */}
          <div className="flex flex-nowrap gap-1">
            {ATALHOS_DE_PRAZO.map((a) => (
              <button
                key={a.chave}
                type="button"
                onClick={() => ag.aplicarAtalho(a.chave, a.horas)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] transition-colors",
                  ag.atalhoAtivo === a.chave
                    ? "border-amber-500 bg-amber-500/15 font-medium text-amber-700 dark:text-amber-400"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {t(`preset_${a.chave}`)}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              type="date"
              value={ag.dataAg}
              min={hojeParaInput()}
              onChange={(e) => {
                ag.setDataAg(e.target.value);
                ag.setAtalhoAtivo(null);
              }}
              aria-label={t("date")}
              className="h-9 flex-1 rounded-lg border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary/50"
            />
            <input
              type="time"
              value={ag.horaAg}
              // ⚠️ `step` em SEGUNDOS. 900 = 15 min, e é o que faz o
              // seletor nativo oferecer só :00/:15/:30/:45 — a mesma
              // grade do ciclo do agendador.
              step={CICLO_MINUTOS * 60}
              onChange={(e) => {
                // Teclado ignora o `step`: quem digitar 21:37 tem o
                // valor subido para 21:45. Arredondar aqui evita
                // prometer uma precisão que o ciclo não entrega.
                //
                // ⚠️ E a DATA anda junto. Arredondar 23:50 dá 00:00 do
                // dia SEGUINTE; gravando só a hora, o par virava
                // "00:00 de hoje" — ou seja, a escolha da pessoa
                // pulava para o passado e o servidor recusava com
                // "essa hora já passou", sem ela entender por quê.
                const bruto = e.target.value;
                const composto = ag.dataAg && bruto ? comporHorario(ag.dataAg, bruto) : null;
                if (!composto) {
                  ag.setHoraAg(bruto);
                } else {
                  const arredondado = arredondarParaGrade(composto);
                  ag.setHoraAg(horaParaInput(arredondado));
                  ag.setDataAg(hojeParaInput(arredondado));
                }
                ag.setAtalhoAtivo(null);
              }}
              aria-label={t("time")}
              className="h-9 w-[5.5rem] rounded-lg border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary/50"
            />
          </div>
          {/* A promessa do ciclo (P4.2, hoje 15 min), escrita na tela e presa
              à mesma constante que o agendador usa. */}
          <p className="text-[11px] text-muted-foreground">
            {ag.quandoAg
              ? t("scheduleHint", { min: CICLO_MINUTOS })
              : t("schedulePick")}
          </p>
          {ag.quandoAg && (
            <button
              type="button"
              onClick={ag.limparAgendamento}
              className="self-start text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              {t("scheduleClear")}
            </button>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}
