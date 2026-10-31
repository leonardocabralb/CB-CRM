"use client";

// ============================================================
// A aba Participantes do painel do grupo: quem está no grupo, lido ao vivo
// no WhatsApp pela rota (`useParticipantesDoGrupo`, quem monta é o painel).
//
// ⚠️ Vazio NUNCA é afirmação: carregando e falha têm frase própria, e a rota
// já responde falha para a lista vazia (o número da conexão está no grupo).
//
// O participante com conversa no CRM (1117) é a LINHA inteira: clicar abre a
// conversa individual (a página liga a faixa "Voltar para" o grupo). Sem
// conversa, o "Conversar" abre a Nova conversa com o telefone.
// ============================================================

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUpRight, Loader2, MessageSquarePlus, Search } from "lucide-react";

import type { FalhaDosParticipantes } from "@/hooks/use-participantes-do-grupo";
import { formatarTelefone } from "@/lib/contacts/telefone";
import {
  filtrarParticipantes,
  type ParticipanteNaTela,
} from "@/lib/cb-groups/participantes-na-tela";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

/** A partir de quantos participantes a busca aparece. */
const BUSCA_A_PARTIR_DE = 10;

export function ParticipantesDoGrupo({
  participantes,
  carregando,
  falha,
  onTentarDeNovo,
  onConversar,
  onAbrirConversa,
}: {
  participantes: ParticipanteNaTela[] | null;
  carregando: boolean;
  falha: FalhaDosParticipantes | null;
  onTentarDeNovo: () => void;
  /** Ausente = quem vê não pode abrir conversa: o botão não existe. */
  onConversar?: (p: ParticipanteNaTela) => void;
  /** Abre a conversa individual que JÁ existe (`conversaId`). Ausente = a linha não clica. */
  onAbrirConversa?: (conversaId: string) => void;
}) {
  const t = useTranslations("Inbox.groupSidebar");
  const [termo, setTermo] = useState("");

  if (carregando) {
    return (
      <p className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-xs">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("membersLoading")}
      </p>
    );
  }

  if (falha || !participantes) {
    return (
      <p className="text-destructive py-6 text-center text-xs">
        {falha === "sem_conexao" ? t("membersNoConnection") : t("membersFailed")}{" "}
        {falha !== "sem_conexao" && (
          <button type="button" onClick={onTentarDeNovo} className="underline underline-offset-2">
            {t("notesRetry")}
          </button>
        )}
      </p>
    );
  }

  const visiveis = filtrarParticipantes(participantes, termo);

  return (
    <div>
      <p className="text-muted-foreground mb-2 text-xs">
        {t("participants", { count: participantes.length })}
      </p>
      {participantes.length > BUSCA_A_PARTIR_DE && (
        <div className="relative mb-2">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
          <Input
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder={t("membersSearch")}
            aria-label={t("membersSearch")}
            className="h-8 pl-8 text-xs"
          />
        </div>
      )}
      {visiveis.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-xs">{t("membersNoMatch")}</p>
      ) : (
        <ul className="divide-border divide-y">
          {visiveis.map((p) => (
            <LinhaDoParticipante
              key={p.id}
              p={p}
              onConversar={onConversar}
              onAbrirConversa={onAbrirConversa}
              t={t}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function LinhaDoParticipante({
  p,
  onConversar,
  onAbrirConversa,
  t,
}: {
  p: ParticipanteNaTela;
  onConversar?: (p: ParticipanteNaTela) => void;
  onAbrirConversa?: (conversaId: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const telefone = p.telefone ? formatarTelefone(p.telefone) : null;
  // Sem nome, o telefone sobe para a linha de cima; sem nenhum dos dois, a
  // pessoa esconde o número — nunca o LID cru na tela.
  const titulo = p.somosNos ? t("membersThisNumber") : (p.nome ?? telefone ?? t("membersHiddenNumber"));
  const legenda = p.somosNos || p.nome ? telefone : null;
  const marca = p.conversaId ? t("membersHasConversation") : p.contatoId ? t("membersHasRecord") : null;

  const corpo = (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="text-foreground truncate text-sm">{titulo}</span>
        {p.papel && (
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {p.papel === "criador" ? t("membersCreator") : t("membersAdmin")}
          </Badge>
        )}
      </div>
      {(legenda || marca) && (
        <p className="text-muted-foreground truncate text-xs tabular-nums">
          {legenda}
          {legenda && marca && " · "}
          {marca}
        </p>
      )}
    </div>
  );

  // Com conversa no CRM, a linha inteira é o botão (sem botão dentro dele).
  const conversaId = p.conversaId;
  if (conversaId && onAbrirConversa && !p.somosNos) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onAbrirConversa(conversaId)}
          aria-label={t("membersOpenConversation", { nome: titulo })}
          title={t("membersOpenConversationHint")}
          className="hover:bg-muted -mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-2 text-left transition-colors"
        >
          {corpo}
          <ArrowUpRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
        </button>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 py-2">
      {corpo}
      {onConversar && p.telefone && !p.somosNos && (
        <button
          type="button"
          onClick={() => onConversar(p)}
          aria-label={t("membersConverse", { nome: titulo })}
          title={t("membersConverseHint")}
          className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}
