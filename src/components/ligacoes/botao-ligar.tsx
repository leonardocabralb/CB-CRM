"use client";

// ============================================================
// O botão "Ligar" do cabeçalho da conversa (4c, §8.1 do plano). Aparece só
// onde a conexão da conversa tem computador de ligações, e fica desligado com
// a dica do porquê (`decidirBotaoLigar`). O fio só é montado para conversa
// DENTRO do perfil (`ConversaForaDaArea` o substitui), então o recorte de
// conexões já vem feito. Vale também no fio do painel da pauta de reuniões:
// a ligação mora na casca, não na página.
//
// ⚠️ Desligado por `aria-disabled`, não `disabled`: o botão desligado precisa
// da dica no `title`, e o `disabled` engole o passar do mouse em parte dos
// navegadores.
// ============================================================

import { Phone } from "lucide-react";
import { useTranslations } from "next-intl";

import { useCan } from "@/hooks/use-can";
import { useComputadoresDeLigacao } from "@/hooks/use-computadores-de-ligacao";
import { useNomeDoMembro } from "@/hooks/use-nomes-da-ligacao";
import { decidirBotaoLigar } from "@/lib/ligacoes/ao-vivo";

import { useLigacoes } from "./ligacoes-provider";

export function BotaoLigar({
  conversationId,
  canalId,
  ehGrupo,
  temTelefone,
  nome,
}: {
  conversationId: string;
  /** `conversations.channel_id` CRU: o número que a rota de ligar usa. */
  canalId: string | null;
  ehGrupo: boolean;
  temTelefone: boolean;
  nome: string;
}) {
  const t = useTranslations("Ligacoes");
  const ligacoes = useLigacoes();
  const podeLigar = useCan("make-calls");
  const computadores = useComputadoresDeLigacao(ligacoes !== null);
  const decisao = decidirBotaoLigar({
    canalId,
    computadores,
    ehGrupo,
    temTelefone,
    podeLigar,
    emLigacao: ligacoes?.emLigacao ?? false,
    aoVivo: ligacoes?.aoVivo ?? [],
  });
  const ocupadaPor = useNomeDoMembro(
    decisao.mostra && decisao.motivo === "linha_ocupada" ? decisao.quem : null,
  );
  if (!ligacoes || !decisao.mostra || !canalId) return null;

  const desligado = decisao.motivo !== null;
  const dica =
    decisao.motivo === null
      ? t("botao.ligar")
      : decisao.motivo === "linha_ocupada" && ocupadaPor
        ? t("botao.linha_ocupadaCom", { nome: ocupadaPor })
        : t(`botao.${decisao.motivo}`);

  return (
    <button
      type="button"
      onClick={() => {
        if (!desligado) ligacoes.ligar({ conversationId, nome, canalId });
      }}
      aria-disabled={desligado}
      aria-label={dica}
      title={dica}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent"
    >
      <Phone className="h-3.5 w-3.5" />
    </button>
  );
}
