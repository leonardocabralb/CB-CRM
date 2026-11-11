"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CampoComVariaveis } from "@/components/automations/variaveis/campo-com-variaveis";
import { VariaveisProvider } from "@/components/automations/variaveis/contexto";
import { prefixoDeAssinatura } from "@/lib/assinatura/assinatura";
import { nomeDoEscritorio, patchesDoModulo, type AutomacaoDoModulo, type EtapaDoModulo } from "@/lib/asaas/modulo-da-cobranca";
import { CASOS_DA_PREVIA, interpolarVars, variaveisDoCaso, type CasoDaPrevia } from "@/lib/asaas/previa-da-regua";
import { ASSINATURA_DA_NOITE, TEXTO_DA_COBRANCA, TEXTO_DO_LEMBRETE, TEXTO_DO_LEMBRETE_DA_NOITE } from "@/lib/asaas/textos-da-regua";
import { chaveDaPendencia } from "@/lib/automations/pendencias";
import { cn } from "@/lib/utils";

import { lerModulo, rotuloDaEtapa, type RespostaDoModulo } from "./cobranca-comum";

/**
 * O texto de UMA etapa da régua, aberto pela tela "Cobrança automática"
 * (1135; `?tab=integracoes&aba=cobranca&etapa=<id>`). O editor é o MESMO do
 * construtor (campos em roxo, "Inserir campo", prévia com cliente real); o
 * que muda é a prévia POR CASO — uma parcela, várias, empresa — montada pelas
 * mesmas funções do envio (`previa-da-regua.ts`), com o nome do escritório e
 * a assinatura de "Quem manda".
 *
 * Salvar é um PATCH da automação (a rota do construtor): o texto do primeiro
 * "Enviar mensagem" e, no lembrete da noite, a assinatura própria dele.
 */
export function TextoDaEtapa({
  dados,
  automacao,
  etapas,
  nomeDaConexao,
  falhou,
  aoTrocarEtapa,
  aoSalvar,
}: {
  dados: RespostaDoModulo | null;
  automacao: AutomacaoDoModulo | null;
  etapas: EtapaDoModulo[];
  nomeDaConexao: (id: string) => string;
  falhou: boolean;
  aoTrocarEtapa: (id: string | null) => void;
  aoSalvar: () => Promise<void>;
}) {
  const t = useTranslations("Settings.integracoes.cobranca");
  const tb = useTranslations("Automations.builder");
  const etapa = etapas.find((e) => e.automacaoId === automacao?.id) ?? null;
  // O rascunho é carimbado com a etapa que o produziu (efeito passivo): ao
  // trocar de aba, o texto da anterior não aparece na seguinte.
  const [rascunho, setRascunho] = useState<{ de: string; texto?: string; assinatura?: string }>({ de: "" });
  const [caso, setCaso] = useState<CasoDaPrevia>("uma");
  const [salvando, setSalvando] = useState(false);
  const [agora] = useState(() => new Date());
  const meu = rascunho.de === automacao?.id ? rascunho : { de: automacao?.id ?? "" };

  const config = dados?.config;
  const escritorio = nomeDoEscritorio(config?.escritorioNome, config?.escritorioPadrao, null);
  const texto = meu.texto ?? etapa?.texto ?? "";
  const assinaturaDaNoite = meu.assinatura ?? etapa?.assinatura ?? "";
  // A assinatura que a mensagem LEVA: a da própria etapa (a da noite, a do
  // rascunho) e, sem ela, o nome automático da conta — como o envio
  // (`nomeAutomaticoParaAssinar`, meta-send). A "comum" não serve: com
  // assinaturas diferentes ela some (Codex, PR #499).
  const propria = etapa?.turno === "noite" ? assinaturaDaNoite : (etapa?.assinatura ?? "");
  const assinatura = propria.trim() || config?.assinaturaAutomatica || "";
  const vars = useMemo(() => (etapa ? variaveisDoCaso(etapa.tipo, caso, { escritorio, agora }) : {}), [etapa, caso, escritorio, agora]);
  const previa = interpolarVars(texto, vars);
  const prefixo = config?.assinaturaAtiva !== false ? prefixoDeAssinatura(assinatura).replace(/\*/g, "").trim() : "";
  const sujo = (meu.texto !== undefined && meu.texto !== etapa?.texto) || (meu.assinatura !== undefined && meu.assinatura !== (etapa?.assinatura ?? ""));

  const voltar = (
    <button type="button" onClick={() => aoTrocarEtapa(null)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      {t("texto.voltar")}
    </button>
  );

  if (!automacao || !etapa) {
    return (
      <div className="space-y-3 text-sm">
        {voltar}
        <p className="text-muted-foreground">{falhou ? t("carregarFalhou") : dados ? t("texto.naoAchada") : t("carregando")}</p>
      </div>
    );
  }

  // Sem "Enviar mensagem" no escopo de fora (montada só nos ramos, no
  // construtor): não há texto que esta tela saiba trocar — nunca um Salvar
  // que finge gravar (Codex, PR #499).
  if (etapa.texto === null) {
    return (
      <div className="space-y-3 text-sm">
        {voltar}
        <p className="text-muted-foreground">
          {t("texto.semMensagemDeFora")}{" "}
          <Link href={`/automations/${automacao.id}/edit`} className="font-medium text-primary underline-offset-2 hover:underline">
            {t("texto.abrirNoConstrutor")}
          </Link>
        </p>
      </div>
    );
  }

  const padrao = etapa.tipo === "cobranca" ? TEXTO_DA_COBRANCA : etapa.turno === "noite" ? TEXTO_DO_LEMBRETE_DA_NOITE : TEXTO_DO_LEMBRETE;

  const salvar = async () => {
    setSalvando(true);
    try {
      // Relê a etapa antes (revisão do PR): editada no construtor depois desta
      // carga, o PATCH dos passos gravaria a árvore velha por cima.
      const fresca = (await lerModulo())?.automacoes?.find((a) => a.id === automacao.id);
      if (!fresca) {
        toast.error(t("carregarFalhou"));
        return;
      }
      const patches = patchesDoModulo([fresca], {
        etapas: {
          [automacao.id]: {
            ...(meu.texto !== undefined ? { texto: meu.texto } : {}),
            ...(etapa.turno === "noite" && meu.assinatura !== undefined ? { assinatura: meu.assinatura.trim() || null } : {}),
          },
        },
      });
      for (const p of patches) {
        const res = await fetch(`/api/automations/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p.corpo) }).catch(() => null);
        if (!res || !res.ok) {
          const corpo = res ? ((await res.json().catch(() => null)) as { issues?: { codigo?: string; message?: string }[] } | null) : null;
          const motivos = (corpo?.issues ?? []).map((i) => {
            const chave = chaveDaPendencia(i);
            return chave ? tb(chave as Parameters<typeof tb>[0]) : (i.message ?? "");
          });
          toast.error(motivos.length > 0 ? motivos.join(" · ") : t("erroGravar"));
          return;
        }
      }
      toast.success(t("texto.salvo"));
      setRascunho({ de: "" });
      await aoSalvar();
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="min-w-0 space-y-4 text-sm">
      <div className="space-y-1.5">
        {voltar}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground">{t("texto.titulo")}</h2>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={salvando || texto === padrao} onClick={() => setRascunho({ ...meu, texto: padrao })}>
              {t("texto.restaurar")}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={salvando || !sujo} onClick={() => setRascunho({ de: "" })}>
              {t("descartar")}
            </Button>
            <Button type="button" size="sm" disabled={salvando || !sujo || !texto.trim()} onClick={() => void salvar()}>
              {salvando ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t("salvar")}
            </Button>
          </div>
        </div>
        <p className="max-w-[80ch] text-xs text-muted-foreground">{t("texto.desc")}</p>
      </div>

      <div role="tablist" aria-label={t("texto.etapas")} className="flex flex-wrap gap-1.5">
        {etapas.map((e) => (
          <button
            key={e.automacaoId}
            type="button"
            role="tab"
            aria-selected={e.automacaoId === automacao.id}
            disabled={sujo && e.automacaoId !== automacao.id}
            title={sujo && e.automacaoId !== automacao.id ? t("texto.salveAntes") : undefined}
            onClick={() => aoTrocarEtapa(e.automacaoId)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs disabled:opacity-50",
              e.automacaoId === automacao.id ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {rotuloDaEtapa(e, t)}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-4">
          <VariaveisProvider gatilho={automacao.trigger_type} webhookId={null} escritorio={escritorio}>
            <CampoComVariaveis rotulo={t("texto.mensagem")} value={texto} onChange={(v) => setRascunho({ ...meu, texto: v })} />
          </VariaveisProvider>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cobranca-assina-etapa">{t("texto.assina")}</Label>
              {etapa.turno === "noite" ? (
                <Input id="cobranca-assina-etapa" value={assinaturaDaNoite} maxLength={60} placeholder={ASSINATURA_DA_NOITE} onChange={(e) => setRascunho({ ...meu, assinatura: e.target.value })} />
              ) : (
                <p className="text-xs text-foreground">{etapa.assinatura || t("texto.semAssinatura")}</p>
              )}
              <p className="text-[11px] text-muted-foreground">{etapa.turno === "noite" ? t("texto.assinaNoite") : t("texto.assinaComum")}</p>
            </div>
            <div className="space-y-1">
              <Label>{t("texto.enviarPor")}</Label>
              <p className="text-xs text-foreground">{etapa.canais.length === 1 ? nomeDaConexao(etapa.canais[0]) : etapa.canais.length === 0 ? t("texto.semConexao") : t("quemManda.varios")}</p>
              <p className="text-[11px] text-muted-foreground">{t("texto.enviarPorAjuda")}</p>
            </div>
          </div>
        </section>

        <section className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-4" aria-label={t("texto.previa")}>
          <p className="text-xs font-medium text-muted-foreground">{t("texto.previa")}</p>
          <div role="group" aria-label={t("texto.previa")} className="flex flex-wrap gap-1.5">
            {CASOS_DA_PREVIA.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={caso === c}
                onClick={() => setCaso(c)}
                className={cn("h-8 rounded-md border px-3 text-xs font-medium", caso === c ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-foreground hover:bg-muted")}
              >
                {/* chave montada: `texto.caso.<caso>` — `CASOS_DA_PREVIA`, cobrada por teste */}
                {t(`texto.caso.${c}` as Parameters<typeof t>[0])}
              </button>
            ))}
          </div>
          <div className="whitespace-pre-wrap break-words rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[13px] leading-relaxed text-foreground">
            {prefixo && <span className="block font-semibold">{prefixo}</span>}
            {previa}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {/* chave montada: `texto.legenda.<caso>` */}
            {t(`texto.legenda.${caso}` as Parameters<typeof t>[0])}
          </p>
          <p className="text-[11px] text-muted-foreground">{t("texto.previaReal")}</p>
        </section>
      </div>
    </div>
  );
}
