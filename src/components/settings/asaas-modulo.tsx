"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Circle, Loader2, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { avisarAsaasMudou } from "@/lib/asaas/aviso";
import type { CartaoDoAsaas, ReguaDoCartao } from "@/lib/asaas/cartao";
import type { ResumoDoEspelho } from "@/lib/asaas/listas";
import { primeirosPassos } from "@/lib/asaas/primeiros-passos";
import { cn } from "@/lib/utils";

/**
 * Os blocos do MÓDULO no cartão do Asaas (1135): "Primeiros passos", "O que a
 * integração faz" (cada função, onde aparece, se está ligada e o gesto) e o
 * resumo da "Cobrança automática", cuja configuração inteira mora na tela
 * própria (`?tab=integracoes&aba=cobranca`). Antes o cartão tinha ali o
 * interruptor, o intervalo e "Criar régua padrão".
 *
 * ⚠️ Número que não chegou (resumo nulo) SOME — nunca vira 0.
 */

const LINK_DA_COBRANCA = "/settings?tab=integracoes&aba=cobranca";

export function PrimeirosPassos({ cartao, resumo, regua }: { cartao: CartaoDoAsaas; resumo: ResumoDoEspelho | null; regua: ReguaDoCartao }) {
  const t = useTranslations("Settings.integracoes.modulo");
  const passos = primeirosPassos(cartao, resumo, regua);
  const feitos = passos.filter((p) => p.situacao === "feito").length;
  if (feitos === passos.length) return null;
  return (
    <section className="min-w-0 space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs" aria-label={t("passos.titulo")}>
      <div className="flex items-center gap-2">
        <p className="font-medium text-foreground">{t("passos.titulo")}</p>
        <span className="ml-auto text-muted-foreground">{t("passos.feitos", { feitos, total: passos.length })}</span>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {passos.map((p) => (
          <li key={p.passo} className={cn("space-y-0.5 rounded-md border bg-card p-2", p.situacao === "feito" ? "border-emerald-300" : p.situacao === "falta" ? "border-primary/40" : "border-border")}>
            <span className={cn("flex items-center gap-1 text-[11px] font-medium", p.situacao === "feito" ? "text-emerald-700" : p.situacao === "falta" ? "text-primary" : "text-muted-foreground")}>
              {p.situacao === "feito" ? <Check className="size-3" aria-hidden="true" /> : <Circle className="size-3" aria-hidden="true" />}
              {/* chave montada: `passos.situacao.<situacao>` */}
              {t(`passos.situacao.${p.situacao}` as Parameters<typeof t>[0])}
            </span>
            {/* chaves montadas: `passos.<passo>.titulo` e `.desc` — `PASSOS_DO_ASAAS`, cobradas por teste */}
            <span className="block text-[12.5px] font-medium text-foreground">{t(`passos.${p.passo}.titulo` as Parameters<typeof t>[0])}</span>
            <span className="block text-[11px] leading-snug text-muted-foreground">{t(`passos.${p.passo}.desc` as Parameters<typeof t>[0], { n: p.n ?? 0 })}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function OQueAIntegracaoFaz({
  resumo,
  regua,
  avisoAtivo,
  aoMudar,
  aoVerListas,
}: {
  resumo: ResumoDoEspelho | null;
  regua: ReguaDoCartao;
  avisoAtivo: boolean;
  aoMudar: () => void;
  aoVerListas: () => void;
}) {
  const t = useTranslations("Settings.integracoes.modulo");
  const [trocando, setTrocando] = useState(false);

  const trocarAviso = async () => {
    const ligar = !avisoAtivo;
    if (!ligar && !window.confirm(t("funcoes.aviso.confirmarDesligar"))) return;
    setTrocando(true);
    try {
      const res = await fetch("/api/cb/asaas/regua/interruptor", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aviso_inadimplencia_ativo: ligar }) }).catch(() => null);
      if (!res || !res.ok) {
        toast.error(t("erroGravar"));
        return;
      }
      toast.success(t(ligar ? "funcoes.aviso.ligado" : "funcoes.aviso.desligado"));
      avisarAsaasMudou();
      aoMudar();
    } finally {
      setTrocando(false);
    }
  };

  const linhas: { id: string; status: string; tom: "ok" | "neutro" | "alerta"; acao: React.ReactNode }[] = [
    {
      id: "vinculo",
      status: resumo ? t("funcoes.vinculo.status", { ligados: resumo.ligados, confirmar: resumo.confirmar }) : "—",
      tom: resumo && resumo.confirmar > 0 ? "alerta" : "neutro",
      acao: (
        <Button type="button" size="sm" variant="outline" onClick={aoVerListas}>
          {t("funcoes.vinculo.acao")}
        </Button>
      ),
    },
    {
      id: "aviso",
      status: avisoAtivo ? (resumo ? t("funcoes.aviso.statusLigado", { n: resumo.inadimplentes }) : t("ligado")) : t("desligado"),
      tom: avisoAtivo ? "ok" : "alerta",
      acao: (
        <Button type="button" size="sm" variant="outline" onClick={() => void trocarAviso()} disabled={trocando}>
          {trocando ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {avisoAtivo ? t("desligar") : t("ligar")}
        </Button>
      ),
    },
    {
      id: "filtro",
      status: avisoAtivo ? t("funcoes.filtro.status") : t("funcoes.filtro.semAviso"),
      tom: avisoAtivo ? "neutro" : "alerta",
      acao: (
        <Link href="/inbox" className={buttonVariants({ size: "sm", variant: "outline" })}>
          {t("funcoes.filtro.acao")}
        </Link>
      ),
    },
    {
      id: "excecao",
      status: resumo ? t("funcoes.excecao.status", { n: resumo.semCobranca }) : "—",
      tom: "neutro",
      acao: (
        <Link href={LINK_DA_COBRANCA} className={buttonVariants({ size: "sm", variant: "outline" })}>
          {t("funcoes.excecao.acao")}
        </Link>
      ),
    },
    {
      id: "cobranca",
      status: regua.ativa ? t("funcoes.cobranca.statusLigada", { ligadas: regua.automacoesLigadas, total: regua.automacoesTotal }) : t("funcoes.cobranca.statusDesligada"),
      tom: regua.ativa ? "ok" : "alerta",
      acao: (
        <Link href={LINK_DA_COBRANCA} className={buttonVariants({ size: "sm" })}>
          {t("funcoes.cobranca.acao")}
        </Link>
      ),
    },
  ];

  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-border text-xs" aria-label={t("funcoes.titulo")}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <p className="font-medium text-foreground">{t("funcoes.titulo")}</p>
        <span className="ml-auto text-muted-foreground">{t("funcoes.fonte")}</span>
      </div>
      <ul className="divide-y divide-border">
        {linhas.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1 basis-80 space-y-0.5">
              {/* chaves montadas: `funcoes.<id>.titulo`, `.desc` e `.onde` — cobradas por teste */}
              <p className="text-[13px] font-medium text-foreground">{t(`funcoes.${l.id}.titulo` as Parameters<typeof t>[0])}</p>
              <p className="text-muted-foreground">{t(`funcoes.${l.id}.desc` as Parameters<typeof t>[0])}</p>
              <p className="text-[11px] text-muted-foreground">{t("onde", { onde: t(`funcoes.${l.id}.onde` as Parameters<typeof t>[0]) })}</p>
            </div>
            <span className={cn("min-w-40 font-medium", l.tom === "ok" ? "text-emerald-700" : l.tom === "alerta" ? "text-amber-700" : "text-muted-foreground")}>{l.status}</span>
            {l.acao}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** O resumo da régua no cartão; a configuração mora na tela "Cobrança automática". */
export function ResumoDaCobranca({ regua, semCobranca }: { regua: ReguaDoCartao; semCobranca: number | null }) {
  const t = useTranslations("Settings.integracoes.modulo");
  return (
    <div className="min-w-0 space-y-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <Zap className="size-3.5" aria-hidden="true" />
          {t("resumo.titulo")}
        </p>
        <span className={regua.ativa ? "text-emerald-700" : "text-muted-foreground"}>{regua.ativa ? t("ligado") : t("desligado")}</span>
      </div>
      <p className="text-muted-foreground">
        {t("resumo.etapas", { ligadas: regua.automacoesLigadas, total: regua.automacoesTotal })}
        {semCobranca !== null ? ` · ${t("resumo.excecoes", { n: semCobranca })}` : ""}
      </p>
      {(regua.marcosRepetidos.length > 0 || regua.lembreteRepetido) && <p className="text-amber-700">{t("resumo.repetido")}</p>}
      <Link href={LINK_DA_COBRANCA} className={buttonVariants({ size: "sm" })}>
        {t("resumo.configurar")}
      </Link>
    </div>
  );
}
