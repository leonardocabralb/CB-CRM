"use client";

// ============================================================
// O cartão da ligação recebida (4c, §8.1 do plano): no alto da tela, em
// qualquer tela do CRM, com o toque em laço — para quem atende (D9: papel de
// atendente e a conexão no perfil). "Atender" e "Silenciar"; NUNCA "Recusar"
// (D12): recusar num aparelho derruba a chamada em todos, os celulares do
// escritório também. O primeiro "Atender" leva; para os outros o cartão vira
// "Atendida por Ana" e some. O celular que atende antes, ou o cliente que
// desiste, faz o cartão sumir (a linha ao vivo sai).
//
// - "Silenciar" é só para mim, em todas as minhas abas (localStorage): o
//   cartão fica, mudo, e ainda dá para atender.
// - Com a aba escondida, sai também o aviso do sistema, para quem ligou o
//   aviso do navegador (a mesma chave das mensagens, `ativo`).
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BellOff, Phone, PhoneIncoming } from "lucide-react";

import { Button } from "@/components/ui/button";
import { avisoPossivelNoAparelho } from "@/hooks/use-browser-notifications";
import { useChannels } from "@/hooks/use-channels";
import { useNomeDoContato, useNomeDoMembro } from "@/hooks/use-nomes-da-ligacao";
import { coresPorCanal, corDoCanal, type CorDeCanal } from "@/lib/cb-channels/cores";
import { formatarTelefone } from "@/lib/contacts/telefone";
import { toquesVisiveis, type LigacaoAoVivo } from "@/lib/ligacoes/ao-vivo";
import { comecarToque } from "@/lib/ligacoes/toque-da-ligacao";
import { chaveDaPreferencia, lerPreferencia } from "@/lib/notifications/aviso-no-navegador";
import { cn } from "@/lib/utils";

export interface AtendidaPorOutro {
  linha: LigacaoAoVivo;
  ate: number;
}

const CHAVE_DAS_SILENCIADAS = "cb-ligacoes-silenciadas";
const MAX_SILENCIADAS = 20;
/** O toque velho sai da tela mesmo sem evento (o relógio do filtro). */
const TIQUE_MS = 15_000;

function lerSilenciadas(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const lidas: unknown = JSON.parse(window.localStorage.getItem(CHAVE_DAS_SILENCIADAS) ?? "[]");
    return Array.isArray(lidas)
      ? lidas.filter((id): id is string => typeof id === "string").slice(-MAX_SILENCIADAS)
      : [];
  } catch {
    return [];
  }
}

function avisoLigado(userId: string): boolean {
  try {
    return lerPreferencia(window.localStorage.getItem(chaveDaPreferencia(userId))).ativo;
  } catch {
    return false;
  }
}

export function CartoesDeToque({
  userId,
  aoVivo,
  atendidasPorOutro,
  canalNoEscopo,
  emLigacao,
  onAtender,
}: {
  userId: string;
  aoVivo: readonly LigacaoAoVivo[];
  atendidasPorOutro: readonly AtendidaPorOutro[];
  canalNoEscopo: (channelId: string) => boolean;
  /** Esta aba já está numa ligação: o cartão aparece, mudo, sem "Atender". */
  emLigacao: boolean;
  onAtender: (linha: LigacaoAoVivo, nome: string) => void;
}) {
  const t = useTranslations("Ligacoes");
  const { channels } = useChannels();
  const cores = useMemo(() => coresPorCanal(channels), [channels]);

  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const laco = window.setInterval(() => setAgora(Date.now()), TIQUE_MS);
    return () => window.clearInterval(laco);
  }, []);
  const toques = toquesVisiveis(aoVivo, { podeAtender: true, canalNoEscopo, agoraMs: agora });
  const atendidas = atendidasPorOutro.filter((a) => canalNoEscopo(a.linha.channel_id));

  const [silenciadas, setSilenciadas] = useState<string[]>(lerSilenciadas);
  useEffect(() => {
    const aoMudar = (evento: StorageEvent) => {
      if (evento.key === CHAVE_DAS_SILENCIADAS) setSilenciadas(lerSilenciadas());
    };
    window.addEventListener("storage", aoMudar);
    return () => window.removeEventListener("storage", aoMudar);
  }, []);
  const silenciar = (id: string) => {
    const proximas = [...silenciadas.filter((s) => s !== id), id].slice(-MAX_SILENCIADAS);
    setSilenciadas(proximas);
    try {
      window.localStorage.setItem(CHAVE_DAS_SILENCIADAS, JSON.stringify(proximas));
    } catch {
      // Sem storage, silencia só nesta aba.
    }
  };

  // O toque em laço: enquanto houver um toque não silenciado e esta aba não
  // estiver numa ligação. Uma aba por vez (`comecarToque`).
  const deveTocar = !emLigacao && toques.some((l) => !silenciadas.includes(l.id));
  useEffect(() => {
    if (!deveTocar) return;
    return comecarToque();
  }, [deveTocar]);

  // Aba escondida: o aviso do sistema, um por ligação, fechado quando ela
  // para de tocar.
  const nomeDoCanal = (id: string) => channels.find((c) => c.id === id)?.label ?? "";
  const pedidos = JSON.stringify(
    toques
      .filter((l) => !silenciadas.includes(l.id))
      .map((l) => ({
        id: l.id,
        texto: t("toque.notificacao", {
          quem: l.telefone ? formatarTelefone(l.telefone) : t("toque.numeroDesconhecido"),
          conexao: nomeDoCanal(l.channel_id),
        }),
      })),
  );
  const tituloDoAviso = t("toque.titulo");
  const avisosRef = useRef(new Map<string, Notification>());
  useEffect(() => {
    const avisos = avisosRef.current;
    const lista = JSON.parse(pedidos) as { id: string; texto: string }[];
    for (const [id, aviso] of avisos) {
      if (!lista.some((p) => p.id === id)) {
        aviso.close();
        avisos.delete(id);
      }
    }
    if (document.visibilityState !== "hidden") return;
    if (!avisoPossivelNoAparelho() || Notification.permission !== "granted") return;
    if (!avisoLigado(userId)) return;
    for (const pedido of lista) {
      if (avisos.has(pedido.id)) continue;
      try {
        const aviso = new Notification(tituloDoAviso, {
          body: pedido.texto,
          tag: `ligacao:${pedido.id}`,
          icon: "/icon",
          requireInteraction: true,
        });
        aviso.onclick = () => {
          window.focus();
          aviso.close();
        };
        avisos.set(pedido.id, aviso);
      } catch (erro) {
        console.error("[ligacoes] aviso do navegador não exibido:", erro);
      }
    }
  }, [pedidos, tituloDoAviso, userId]);
  useEffect(() => {
    const avisos = avisosRef.current;
    return () => {
      for (const aviso of avisos.values()) aviso.close();
      avisos.clear();
    };
  }, []);

  if (toques.length === 0 && atendidas.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[60] flex flex-col items-center gap-2 px-4">
      {toques.map((linha) => (
        <CartaoDeToque
          key={linha.id}
          linha={linha}
          atendida={false}
          silenciada={silenciadas.includes(linha.id)}
          emLigacao={emLigacao}
          canal={nomeDoCanal(linha.channel_id)}
          cor={corDoCanal(cores, linha.channel_id)}
          onAtender={onAtender}
          onSilenciar={() => silenciar(linha.id)}
        />
      ))}
      {atendidas.map(({ linha }) => (
        <CartaoDeToque
          key={`atendida:${linha.id}`}
          linha={linha}
          atendida
          silenciada
          emLigacao={emLigacao}
          canal={nomeDoCanal(linha.channel_id)}
          cor={corDoCanal(cores, linha.channel_id)}
          onAtender={onAtender}
          onSilenciar={() => {}}
        />
      ))}
    </div>
  );
}

function CartaoDeToque({
  linha,
  atendida,
  silenciada,
  emLigacao,
  canal,
  cor,
  onAtender,
  onSilenciar,
}: {
  linha: LigacaoAoVivo;
  atendida: boolean;
  silenciada: boolean;
  emLigacao: boolean;
  canal: string;
  cor: CorDeCanal | null;
  onAtender: (linha: LigacaoAoVivo, nome: string) => void;
  onSilenciar: () => void;
}) {
  const t = useTranslations("Ligacoes");
  const daFicha = useNomeDoContato(linha.contact_id);
  const nome =
    daFicha ?? (linha.telefone ? formatarTelefone(linha.telefone) : t("toque.numeroDesconhecido"));
  const quemAtendeu = useNomeDoMembro(atendida ? linha.atendente_id : null);

  const situacao = atendida
    ? quemAtendeu
      ? t("toque.atendidaPor", { nome: quemAtendeu })
      : t("toque.atendidaPorAlguem")
    : silenciada
      ? t("toque.silenciada")
      : t("toque.celularTambem");

  return (
    <div
      role="alert"
      className="pointer-events-auto w-full max-w-md rounded-xl border bg-card p-3 text-card-foreground shadow-lg"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white",
            !atendida && !silenciada && "animate-pulse",
          )}
        >
          <PhoneIncoming className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{nome}</p>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {cor && <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", cor.ponto)} />}
            <span className="truncate">{canal}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">{situacao}</p>
        </div>
      </div>
      {!atendida && (
        <div className="mt-3 flex items-center justify-end gap-2">
          {!silenciada && (
            <Button type="button" variant="ghost" size="sm" onClick={onSilenciar}>
              <BellOff />
              {t("toque.silenciar")}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={() => onAtender(linha, nome)}
            disabled={emLigacao}
            title={emLigacao ? t("toque.emOutraLigacao") : undefined}
            className="bg-emerald-700 text-white hover:bg-emerald-800"
          >
            <Phone />
            {t("toque.atender")}
          </Button>
        </div>
      )}
    </div>
  );
}
