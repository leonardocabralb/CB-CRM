"use client";

// ============================================================
// Quem MAIS está com esta conversa aberta (963), em FRASE, colada no
// compositor. Pedido do operador (29/09/2026): os avatares de 20 px do
// cabeçalho (`AvataresNaConversa`, que continuam lá) eram discretos demais,
// com o nome só no tooltip. A decisão de onde foi dele: acima do campo de
// resposta, porque é na hora de responder que importa saber que outra pessoa
// pode estar respondendo junto — e o cabeçalho já corta o nome do cliente.
//
// Informativa, não bloqueante; some quando não há ninguém (o dia inteiro numa
// conta de um membro só).
//
// ⚠️ Verde, nunca violeta/âmbar/cinza: essas são as cores da SITUAÇÃO da
// conversa (`STATUS_PILL`), e a faixa leria como "pendente". O texto é
// `text-foreground` (o `dark:` está inerte, `.claude/rules/ui.md`): verde
// escuro some no modo escuro, e verde claro some no claro.
// ============================================================

import { Eye } from "lucide-react";
import { useTranslations } from "next-intl";

import type { Profile } from "@/types";

/**
 * Os nomes de quem está vendo, na ordem recebida. Perfil ainda não carregado
 * (chegada por realtime antes do roster) fica de fora, como nos avatares:
 * melhor esperar o nome do que escrever "alguém".
 */
export function nomesDeQuemVe(userIds: string[], profiles: Profile[]): string[] {
  const porUserId = new Map(profiles.map((p) => [p.user_id, p]));
  const nomes: string[] = [];
  for (const userId of userIds) {
    const perfil = porUserId.get(userId);
    if (!perfil) continue;
    const nome = perfil.full_name || perfil.email;
    if (nome) nomes.push(nome);
  }
  return nomes;
}

export function FaixaDePresenca({
  userIds,
  profiles,
}: {
  /** user_ids de quem está vendo (já sem o próprio operador), ordem estável. */
  userIds: string[];
  /** Roster da conta — o mesmo que o fio passa aos avatares do cabeçalho. */
  profiles: Profile[];
}) {
  const t = useTranslations("Inbox.messageThread");
  const nomes = nomesDeQuemVe(userIds, profiles);
  if (nomes.length === 0) return null;

  const frase =
    nomes.length === 1
      ? t("presencaUm", { nome: nomes[0] })
      : nomes.length === 2
        ? t("presencaDois", { nome: nomes[0], outro: nomes[1] })
        : t("presencaMais", { nome: nomes[0], n: nomes.length - 1 });

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-3 mt-2 flex max-w-full items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-foreground"
    >
      <span aria-hidden="true" className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 motion-safe:animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      <Eye aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
      <p className="min-w-0 flex-1 break-words font-medium">{frase}</p>
    </div>
  );
}
