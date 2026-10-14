"use client";

// ============================================================
// A faixa "POSSÍVEL DUPLICATA" (1088, docs/PLANO-fichas-duplicadas.md).
//
// Mora em dois lugares: no bloco de faixas acima do compositor da conversa
// (o card do funil ABRE a conversa) e no formulário do card (o card SEM
// conversa abre o formulário — e esse é justamente o caso da ficha de
// formulário de anúncio). Pedido do operador (13/10/2026): ao entrar no card,
// o sistema avisa e oferece comparar as duas fichas.
//
// Só informa: cala com `candidatas` nula (carregando ou falhou — nunca
// afirma "sem duplicata") ou vazia. Decidir mora no "Comparar".
//
// ⚠️ Cores: o `dark:` está INERTE (`.claude/rules/ui.md`). O texto é
// `text-foreground`; o âmbar fica na borda, no fundo e no ícone — classes
// LITERAIS, como na faixa de situação do cliente.
// ============================================================

import { Users } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { intervaloEntreAsFichas, type Candidata, type MotivoDaDuplicata } from "@/lib/contacts/duplicatas";
import { identidadeDoContato, nomeDoContato } from "@/lib/contacts/identidade";
import { formatarTelefone, telefoneCanonico } from "@/lib/contacts/telefone";
import { cn } from "@/lib/utils";

type T = ReturnType<typeof useTranslations<"Duplicatas">>;

/**
 * Os motivos do par numa frase: "mesmo e-mail · telefone com um dígito de
 * diferença · mesmo primeiro nome". O primeiro nome entra UMA vez, no fim,
 * quando algum motivo dependeu dele (telefone e horário nunca valem sozinhos
 * — a regra da 1088). Chaves LITERAIS, para o portão de i18n contar.
 */
export function textoDosMotivos(t: T, motivos: MotivoDaDuplicata[]): string {
  const partes: string[] = [];
  let dependeuDoNome = false;
  for (const m of motivos) {
    switch (m.tipo) {
      case "mesmo_email":
        partes.push(t("motivoMesmoEmail"));
        break;
      case "telefone_parecido":
        partes.push(t("motivoTelefoneParecido"));
        dependeuDoNome = true;
        break;
      case "contato_antigo":
        partes.push(t("motivoContatoAntigo"));
        break;
      case "criadas_juntas": {
        const intervalo = intervaloEntreAsFichas(m.segundos);
        partes.push(
          intervalo.unidade === "segundos"
            ? t("motivoCriadasJuntasSegundos", { valor: intervalo.valor })
            : t("motivoCriadasJuntasMinutos", { valor: intervalo.valor }),
        );
        dependeuDoNome = true;
        break;
      }
    }
  }
  if (dependeuDoNome) partes.push(t("motivoMesmoPrimeiroNome"));
  return partes.join(" · ");
}

/**
 * O telefone formatado, senão o `@`, senão nada — nunca o IGSID nem o BSUID.
 * Pela grafia CANÔNICA: ficha antiga gravada com pontuação ("+55 83 …")
 * sairia "++55" direto no formatador.
 */
export function identidadeLegivel(c: {
  phone: string | null;
  wa_username?: string | null;
  instagram_username?: string | null;
}): string | null {
  if (c.phone) return formatarTelefone(telefoneCanonico(c.phone));
  return identidadeDoContato(c);
}

export function FaixaDePossivelDuplicata({
  candidatas,
  podeDecidir,
  aoComparar,
  className,
}: {
  candidatas: Candidata[] | null;
  /** Admin (D1): muda só a dica. O botão "Comparar" é de todos. */
  podeDecidir: boolean;
  aoComparar: (candidata: Candidata) => void;
  /** As margens de quem monta (no fio, `mx-3 mt-2`; no formulário, `mt-2`). */
  className?: string;
}) {
  const t = useTranslations("Duplicatas");
  if (!candidatas || candidatas.length === 0) return null;

  return (
    <div
      role="status"
      data-faixa="possivel-duplicata"
      className={cn(
        "flex max-w-full items-start gap-2.5 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-foreground",
        className,
      )}
    >
      <Users className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t("titulo")}</p>
        <ul className="mt-1 space-y-1.5">
          {candidatas.map((c) => {
            const identidade = c.ficha ? identidadeLegivel(c.ficha) : null;
            return (
              <li key={c.contatoId} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words">
                    <span className="font-medium">
                      {c.ficha ? nomeDoContato(c.ficha, t("semNome")) : t("fichaSumiu")}
                    </span>
                    {identidade && <span className="text-muted-foreground"> · {identidade}</span>}
                  </p>
                  <p className="break-words text-muted-foreground">{textoDosMotivos(t, c.motivos)}</p>
                </div>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  className="shrink-0 bg-background"
                  disabled={!c.ficha}
                  onClick={() => aoComparar(c)}
                >
                  {t("comparar")}
                </Button>
              </li>
            );
          })}
        </ul>
        <p className="mt-1.5 text-muted-foreground">{podeDecidir ? t("dicaAdmin") : t("dicaTodos")}</p>
      </div>
    </div>
  );
}
