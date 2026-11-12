"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  FileText,
  Loader2,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Play,
  RefreshCw,
  Video,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { PlayerDeAudio } from "@/components/inbox/player-de-audio";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { relogio, type Trecho } from "@/lib/whatsapp/ligacoes/dialogo";
import type { Message } from "@/types";

/**
 * A ligação no fio (1044), como o próprio WhatsApp a mostra: uma faixa no meio
 * da conversa, sem balão, sem horário de envio e sem ações — responder, reagir
 * ou apagar uma ligação não quer dizer nada.
 *
 * A hora escrita é a de quando COMEÇOU a tocar (`ligacao.inicio`), não o
 * `created_at` da linha: a linha nasce quando o CRM decide o desfecho, alguns
 * segundos depois do fim (ver `lib/whatsapp/ligacoes/registrar.ts`).
 *
 * A ligação pelo CRM (1134, `detalhes.pelo_crm`) é só REGISTRO (D6/D6b):
 * neutra, com quem ligou ou atendeu e a duração — nunca vermelha, nem a feita
 * que o cliente não atendeu (ninguém do escritório deixou de atender).
 *
 * ▶ Ouvir (4c): com a gravação no CRM (`gravacao` e `ligacao_id`), o player do
 * fio abre embaixo da faixa. O endereço é a ROTA estável
 * (`/api/cb/ligacoes/<id>/gravacao`), que confere o acesso à conversa e
 * redireciona para uma URL assinada curta do bucket PRIVADO — nunca a URL
 * assinada guardada na mensagem (ela expira).
 *
 * A transcrição (4d), também só com `ligacao_id`: "Transcrevendo…" enquanto
 * roda (`falhou` ainda vai repetir), o resumo (D11) no cartão e "Ver
 * transcrição" ao lado do ▶, que abre o diálogo e SÓ ENTÃO pergunta à rota (o
 * diálogo mora em `cb_ligacoes`, fechada ao navegador). Passados os 180 dias
 * (`expirada`), saem o ▶ e o diálogo; fica o resumo.
 *
 * O CARTÃO (pedido do operador, 11/11/2026): a ligação pelo CRM que tem o
 * que ouvir ou ler (gravação, transcrição, resumo ou a situação dela) sai
 * num cartão com o ícone na cor do tema, o resumo no corpo e "Ouvir" e "Ver
 * transcrição" como botões de verdade — na pílula, eles se perdiam entre os
 * avisos do sistema. O resto (as ligações do celular, a não atendida, as da
 * 4b) continua pílula: não há o que abrir.
 *
 * ⚠️ A cor da perdida vive no ÍCONE e na borda, nunca no texto: o par
 * `text-red-700 dark:text-red-300` resolve para o vermelho escuro nos dois
 * modos (o variant `dark:` está inerte, ver o CLAUDE.md), e ficaria ilegível
 * no tema escuro.
 */
export function AvisoDeLigacao({ message }: { message: Message }) {
  const t = useTranslations("Inbox.ligacao");
  const [ouvindo, setOuvindo] = useState(false);
  const detalhes = message.ligacao ?? null;
  const peloCrm = detalhes?.pelo_crm === true;
  const feita = peloCrm && detalhes?.direcao === "feita";
  // Sem os detalhes (linha anterior a eles, ou gravada à mão), o lado da
  // conversa responde: a perdida é do cliente, a atendida é da equipe.
  const perdida = detalhes ? detalhes.desfecho === "perdida" : message.sender_type === "customer";
  const video = detalhes?.video === true;

  const inicio = Date.parse(detalhes?.inicio ?? message.created_at);
  const hora = Number.isFinite(inicio) ? format(new Date(inicio), "HH:mm") : null;

  const titulo = peloCrm
    ? feita
      ? t("feitaPeloCrm")
      : t("atendidaPeloCrm")
    : perdida
      ? video
        ? t("videoPerdida")
        : t("vozPerdida")
      : video
        ? t("videoAtendida")
        : t("vozAtendida");
  const partes = [titulo];
  if (peloCrm && detalhes?.atendente?.nome) partes.push(t("por", { nome: detalhes.atendente.nome }));
  if (hora) partes.push(hora);
  if (perdida && typeof detalhes?.tocou_seg === "number") {
    partes.push(t("tocou", { segundos: detalhes.tocou_seg }));
  }
  if (peloCrm && detalhes?.desfecho === "nao_atendida") {
    partes.push(t("naoAtendida"));
  } else if (peloCrm && typeof detalhes?.duracao_seg === "number") {
    const segundos = detalhes.duracao_seg % 60;
    const minutos = Math.floor(detalhes.duracao_seg / 60);
    partes.push(minutos > 0 ? t("duracaoMin", { minutos, segundos }) : t("duracaoSeg", { segundos }));
  }
  const texto = partes.join(" · ");

  const Icone = video ? Video : feita ? PhoneOutgoing : perdida ? PhoneMissed : PhoneIncoming;
  // A gravação e a transcrição são da faixa pelo CRM com o id da ligação (as
  // da 4b não o têm). Booleano de JSONB liga só com `=== true`.
  const ligacaoId = peloCrm && typeof detalhes?.ligacao_id === "string" ? detalhes.ligacao_id : null;
  const expirada = ligacaoId !== null && detalhes?.expirada === true;
  const gravacao =
    ligacaoId && !expirada && detalhes?.gravacao === true
      ? `/api/cb/ligacoes/${encodeURIComponent(ligacaoId)}/gravacao`
      : null;
  const transcricao = ligacaoId && !expirada ? (detalhes?.transcricao ?? null) : null;
  const verTranscricao = transcricao === "pronta";
  const resumo =
    ligacaoId && typeof detalhes?.resumo === "string" && detalhes.resumo.trim()
      ? detalhes.resumo.trim()
      : null;
  const situacaoDaTranscricao = expirada
    ? t("gravacaoExpirada")
    : transcricao === "transcrevendo" || transcricao === "falhou"
      ? t("transcrevendo")
      : transcricao === "recusada"
        ? t("semTranscricao")
        : null;
  const transcrevendo = !expirada && (transcricao === "transcrevendo" || transcricao === "falhou");

  if (ligacaoId && (gravacao || verTranscricao || situacaoDaTranscricao || resumo)) {
    return (
      <div className="flex justify-center py-1.5">
        {/* `min-w-0` + `break-words`: o resumo vem da IA e pode trazer palavra
            sem espaço; `max-w-md` segura o cartão no fio largo, e no estreito
            (305 px com o painel aberto) ele ocupa a largura toda. */}
        <div className="w-full min-w-0 max-w-md rounded-2xl border border-primary/25 bg-card px-3.5 py-3 text-left text-card-foreground shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icone aria-hidden className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-tight">{titulo}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{partes.slice(1).join(" · ")}</p>
            </div>
          </div>
          {resumo && (
            <p className="mt-2.5 break-words text-[13px] leading-relaxed">
              <span className="font-medium">{t("resumo")}:</span> {resumo}
            </p>
          )}
          {situacaoDaTranscricao && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              {transcrevendo && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
              {situacaoDaTranscricao}
            </p>
          )}
          {(gravacao || verTranscricao) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {gravacao && (
                <Button
                  type="button"
                  size="sm"
                  variant={ouvindo ? "outline" : "default"}
                  onClick={() => setOuvindo((aberto) => !aberto)}
                  aria-expanded={ouvindo}
                  title={ouvindo ? t("fecharGravacao") : t("ouvirDica")}
                >
                  {ouvindo ? <X aria-hidden /> : <Play aria-hidden />}
                  {ouvindo ? t("fecharGravacao") : t("ouvir")}
                </Button>
              )}
              {verTranscricao && (
                <VerTranscricao
                  ligacaoId={ligacaoId}
                  atendente={detalhes?.atendente?.nome || null}
                  descricao={texto}
                />
              )}
            </div>
          )}
          {gravacao && ouvindo && (
            <div className="mt-2.5 rounded-xl bg-muted/70 px-3 py-2 text-foreground">
              <PlayerDeAudio src={gravacao} naBolhaDaEquipe={false} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1 py-1">
      <span
        title={perdida ? t("dicaPerdida") : undefined}
        className={cn(
          "inline-flex max-w-[85%] items-center justify-center gap-1.5 rounded-full border px-3 py-1 text-center text-[11px] leading-snug",
          perdida
            ? "border-red-500/40 bg-red-500/10 text-foreground"
            : "border-transparent bg-muted/70 text-muted-foreground",
        )}
      >
        <Icone
          aria-hidden
          className={cn("h-3.5 w-3.5 shrink-0", perdida && "text-red-600")}
        />
        <span>{texto}</span>
      </span>
    </div>
  );
}

/** O que a rota da transcrição respondeu. */
type Leitura =
  | { estado: "pronta"; trechos: Trecho[]; resumo: string | null }
  /** 404 da rota: sem transcrição para quem pede (expirou no meio, ou a conversa não é visível). */
  | { estado: "nao_encontrada" }
  /** Rede, 5xx, 401/403 ou resposta fora da forma: "tentar de novo", nunca "vazio". */
  | { estado: "falhou" };

/**
 * "Ver transcrição" (4d): o botão ao lado do ▶ e o diálogo. Só pergunta à rota
 * ao ABRIR, e cada abertura e cada "Tentar de novo" é um pedido novo. A
 * resposta é carimbada com a ligação e o pedido que a fizeram (efeito
 * passivo): o carregando é DERIVADO dela, e a resposta de antes — a falha
 * inclusive — nunca aparece como a de agora. Lista vazia só com a resposta
 * na mão (lista vazia virando afirmação).
 */
function VerTranscricao({
  ligacaoId,
  atendente,
  descricao,
}: {
  ligacaoId: string;
  /** Quem ligou ou atendeu pelo CRM (o canal do atendente da gravação). */
  atendente: string | null;
  /** O texto da pílula, que diz de qual ligação é o diálogo. */
  descricao: string;
}) {
  const t = useTranslations("Inbox.ligacao");
  const [aberto, setAberto] = useState(false);
  const [pedido, setPedido] = useState(0);
  const [lida, setLida] = useState<(Leitura & { de: string; pedido: number }) | null>(null);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    void (async () => {
      let leitura: Leitura = { estado: "falhou" };
      try {
        const r = await fetch(`/api/cb/ligacoes/${encodeURIComponent(ligacaoId)}/transcricao`, {
          cache: "no-store",
        });
        const corpo = (await r.json().catch(() => null)) as
          | { trechos?: unknown; resumo?: unknown; error?: unknown }
          | null;
        const trechos = corpo?.trechos;
        if (r.ok && Array.isArray(trechos)) {
          const resumo = typeof corpo?.resumo === "string" && corpo.resumo.trim() ? corpo.resumo.trim() : null;
          leitura = { estado: "pronta", trechos: trechos as Trecho[], resumo };
        } else if (r.status === 404 && corpo?.error === "nao_encontrada") {
          leitura = { estado: "nao_encontrada" };
        }
      } catch {
        // Sem rede: fica "falhou".
      }
      if (vivo) setLida({ ...leitura, de: ligacaoId, pedido });
    })();
    return () => {
      vivo = false;
    };
  }, [aberto, ligacaoId, pedido]);

  const atual = lida && lida.de === ligacaoId && lida.pedido === pedido ? lida : null;
  const nomeDoAtendente = atendente || t("atendente");

  return (
    <Dialog
      open={aberto}
      onOpenChange={(abrir) => {
        setAberto(abrir);
        if (abrir) setPedido((n) => n + 1);
      }}
    >
      <DialogTrigger render={<Button type="button" size="sm" variant="outline" />}>
        <FileText aria-hidden />
        {t("verTranscricao")}
      </DialogTrigger>
      {/* ⚠️ O diálogo só tem TETO (`max-h`), e a raiz do `ScrollArea` também é
          `flex-col`: o `Viewport` dele tem `height: 100%`, que não se resolve
          contra um item de flex de altura indefinida — medido no Chrome, a
          lista vazava o diálogo sem rolar. Como item de flex (rolável, de
          `min-height` 0), o viewport encolhe até caber. */}
      <DialogContent className="flex max-h-[calc(var(--altura-visivel,100dvh)-2rem)] flex-col sm:max-w-lg">
        <DialogHeader className="pr-6">
          <DialogTitle>{t("tituloDaTranscricao")}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex min-h-0 flex-1 flex-col">
          {/* A barra de rolagem fica por cima da borda direita do conteúdo. */}
          <div className="pr-3">
            {!atual ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 aria-hidden className="size-4 animate-spin" />
                {t("carregandoTranscricao")}
              </p>
            ) : atual.estado === "falhou" ? (
              <div className="flex flex-col items-start gap-2">
                <p className="text-muted-foreground">{t("falhaDaTranscricao")}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => setPedido((n) => n + 1)}>
                  <RefreshCw aria-hidden className="size-3.5" />
                  {t("tentarDeNovo")}
                </Button>
              </div>
            ) : atual.estado === "nao_encontrada" ? (
              <p className="text-muted-foreground">{t("semTranscricao")}</p>
            ) : (
              <div className="space-y-4">
                {atual.resumo && (
                  <div className="rounded-lg bg-muted/60 px-3 py-2">
                    <p className="text-xs font-medium text-muted-foreground">{t("resumo")}</p>
                    <p className="mt-1 break-words leading-relaxed">{atual.resumo}</p>
                  </div>
                )}
                {atual.trechos.length === 0 ? (
                  <p className="text-muted-foreground">{t("semFala")}</p>
                ) : (
                  <ol className="space-y-2">
                    {atual.trechos.map((trecho, i) => (
                      <li key={i} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
                        <span className="pt-0.5 text-[11px] tabular-nums text-muted-foreground">
                          {relogio(trecho.inicio)}
                        </span>
                        <p className="break-words leading-relaxed">
                          <span className="font-medium">
                            {trecho.quem === "cliente" ? t("cliente") : nomeDoAtendente}:
                          </span>{" "}
                          {trecho.texto}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
