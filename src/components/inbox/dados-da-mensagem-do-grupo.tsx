"use client";

// ============================================================
// "Dados da mensagem" de uma mensagem NOSSA num grupo (1119): quem de fora da
// conta recebeu e quem leu, com a hora — o "Dados da mensagem" do WhatsApp.
// Lido do banco pela rota `GET /api/cb/groups/[id]/recibos` (decisão do
// operador, 04/11/2026: sem ler o grupo ao vivo).
//
// ⚠️ Carregando e falha NUNCA viram "ninguém": a falha diz que não carregou
// e oferece "Tentar de novo". E a lista vazia diz "nenhum recibo
// REGISTRADO" — a mensagem de antes do 5º patch da Evolution não tem recibo
// nenhum, e "ninguém recebeu" seria afirmação falsa.
// ⚠️ O estado leva o carimbo de quem é (mensagem + tentativa): o primeiro
// render depois de trocar de mensagem ou de pedir de novo mostraria o
// resultado anterior (efeito passivo, CLAUDE.md 8c).
// ============================================================

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatarTelefone } from "@/lib/contacts/telefone";

export interface ReciboNaTela {
  participante: string;
  nome: string | null;
  telefone: string | null;
  entregueEm: string;
  lidaEm: string | null;
}

export type Estado =
  | { de: string; situacao: "falhou" }
  | {
      de: string;
      situacao: "pronto";
      recibos: ReciboNaTela[];
      /** Quantos recibos há de fato (o PostgREST corta em 1000). */
      total: number;
      participantesDeFora: number | null;
    };

function hora(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DadosDaMensagemDoGrupo({
  grupoId,
  messageId,
}: {
  grupoId: string;
  messageId: string;
}) {
  const [tentativa, setTentativa] = useState(0);
  const [estado, setEstado] = useState<Estado | null>(null);
  const chave = `${grupoId}|${messageId}#${tentativa}`;

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const resposta = await fetch(
          `/api/cb/groups/${encodeURIComponent(grupoId)}/recibos?mensagem=${encodeURIComponent(messageId)}`,
        );
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
        const corpo = (await resposta.json()) as {
          recibos?: unknown;
          total?: unknown;
          participantesDeFora?: unknown;
        };
        if (!Array.isArray(corpo.recibos)) throw new Error("resposta sem recibos");
        const recibos = corpo.recibos as ReciboNaTela[];
        if (vivo) {
          setEstado({
            de: chave,
            situacao: "pronto",
            recibos,
            total: typeof corpo.total === "number" ? corpo.total : recibos.length,
            participantesDeFora:
              typeof corpo.participantesDeFora === "number" ? corpo.participantesDeFora : null,
          });
        }
      } catch {
        if (vivo) setEstado({ de: chave, situacao: "falhou" });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [chave, grupoId, messageId]);

  const atual = estado?.de === chave ? estado : null;

  return <ConteudoDosDados atual={atual} aoTentarDeNovo={() => setTentativa((n) => n + 1)} />;
}

/** O balão por estado: nulo = carregando. Separado da busca para o teste desenhar cada estado. */
export function ConteudoDosDados({
  atual,
  aoTentarDeNovo,
}: {
  atual: Estado | null;
  aoTentarDeNovo: () => void;
}) {
  const t = useTranslations("Inbox.messageInfo");
  // ⚠️ Teto de altura pelo espaço que o base-ui mede na tela
  // (`--available-height`, menos o `p-2` do popup), com piso de 12rem: no app
  // instalado no iPhone a medida pode vir errada (`ui.md`). Sem o teto, a lista
  // de um grupo grande passava da tela sem rolar (Codex, PR 457).
  return (
    <div className="flex max-h-[max(12rem,min(24rem,calc(var(--available-height,25rem)_-_1rem)))] w-72 max-w-[calc(100vw-2rem)] flex-col gap-2 p-1 text-sm">
      <p className="text-foreground shrink-0 font-medium">{t("title")}</p>
      {!atual ? (
        <p className="text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("loading")}
        </p>
      ) : atual.situacao === "falhou" ? (
        <div className="space-y-2">
          <p className="text-muted-foreground">{t("failed")}</p>
          <Button size="sm" variant="outline" onClick={aoTentarDeNovo}>
            {t("retry")}
          </Button>
        </div>
      ) : atual.recibos.length === 0 ? (
        <div className="space-y-1">
          <p className="text-muted-foreground">{t("none")}</p>
          <p className="text-muted-foreground text-xs">{t("noneHint")}</p>
        </div>
      ) : (
        <ListaDeRecibos
          recibos={atual.recibos}
          total={atual.total}
          participantesDeFora={atual.participantesDeFora}
          t={t}
        />
      )}
    </div>
  );
}

function ListaDeRecibos({
  recibos,
  total,
  participantesDeFora,
  t,
}: {
  recibos: ReciboNaTela[];
  total: number;
  participantesDeFora: number | null;
  t: ReturnType<typeof useTranslations>;
}) {
  const lidas = recibos.filter((r) => r.lidaEm);
  const soEntregues = recibos.filter((r) => !r.lidaEm);
  // Lista cortada (o teto de 1000 do PostgREST): só o que se leu, sem resumo.
  const cortada = total > recibos.length;
  // "4 de 3" não se afirma: quem entrou depois da conferência (ou um número
  // nosso não reconhecido) passa o denominador, que deixa de valer.
  const resumoValido =
    !cortada && participantesDeFora != null && participantesDeFora > 0 && recibos.length <= participantesDeFora;
  return (
    // `min-h-0` em toda a cadeia de flex: sem ele o filho cresce em vez de
    // rolar (`ui.md`). Só a lista rola; o título e o resumo ficam à vista.
    <div className="flex min-h-0 flex-col gap-2">
      {resumoValido && (
        <p className="text-muted-foreground shrink-0 text-xs">
          {t("summary", {
            entregues: recibos.length,
            lidas: lidas.length,
            total: participantesDeFora,
          })}
        </p>
      )}
      {cortada && (
        <p className="text-muted-foreground shrink-0 text-xs">
          {t("truncated", { n: recibos.length })}
        </p>
      )}
      <div data-lista-de-recibos className="min-h-0 space-y-2 overflow-y-auto overscroll-contain pr-1">
        {lidas.length > 0 && (
          <Secao titulo={t("readBy")} itens={lidas} quando={(r) => r.lidaEm ?? r.entregueEm} t={t} />
        )}
        {soEntregues.length > 0 && (
          <Secao titulo={t("deliveredTo")} itens={soEntregues} quando={(r) => r.entregueEm} t={t} />
        )}
      </div>
    </div>
  );
}

function Secao({
  titulo,
  itens,
  quando,
  t,
}: {
  titulo: string;
  itens: ReciboNaTela[];
  quando: (r: ReciboNaTela) => string;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs font-medium uppercase">{titulo}</p>
      <ul className="mt-1 space-y-1">
        {itens.map((r) => {
          const telefone = r.telefone ? formatarTelefone(r.telefone) : null;
          // Nunca o LID cru na tela: sem nome nem telefone, "Número oculto".
          const nome = r.nome ?? telefone ?? t("hiddenNumber");
          return (
            <li key={r.participante} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0">
                <span className="text-foreground block truncate">{nome}</span>
                {r.nome && telefone && (
                  <span className="text-muted-foreground block truncate text-xs tabular-nums">
                    {telefone}
                  </span>
                )}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {hora(quando(r))}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
