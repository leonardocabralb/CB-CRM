"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, KeyRound, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import type { Credencial } from "@/lib/integracoes/credencial";
import { cn } from "@/lib/utils";

import { FONTE_MONO } from "./copiar";

/** A leitura da rota; nunca lança (a falha é `"falhou"`, dita na tela). */
async function lerDaRota(de: string): Promise<{ credencial: Credencial | null } | "falhou"> {
  try {
    const res = await fetch(`/api/cb/integracoes/credencial?de=${encodeURIComponent(de)}`, { cache: "no-store" });
    if (!res.ok) return "falhou";
    const corpo = (await res.json()) as { credencial: Credencial | null };
    return { credencial: corpo.credencial };
  } catch {
    return "falhou";
  }
}

/**
 * O bloco "Chave guardada" dos cartões de Integrações (1127; pedido do
 * operador, 06/11/2026): os 4 últimos caracteres da chave, quando ela foi
 * gravada, por quem, quando respondeu pela última vez, e os botões "Testar
 * agora" e "Trocar chave". Lê e testa por `/api/cb/integracoes/credencial`.
 *
 * - `de`: a integração (`tldv`, `calendly`, `meta_ads`, `asaas`, `zapsign`,
 *   `atlas`) ou a chave de IA (`ia_openai`, `ia_gemini`, `ia_anthropic`). A de
 *   IA não tem "Testar agora": o cartão dela já pinga cada modelo.
 * - `versao`: muda quando o cartão relê o estado dele (conectou, trocou,
 *   sincronizou) — o bloco relê junto.
 * - `motivo`: a tradução do código de falha, do PRÓPRIO cartão (cada
 *   integração tem os seus códigos).
 * - `aoTestar`: o cartão relê o estado (o teste pode ter tirado ou posto a
 *   conexão em erro).
 * - `aoTrocar`: abre o campo da chave no cartão; ausente = sem o botão.
 *
 * ⚠️ Enquanto lê, o bloco diz "conferindo", nunca "sem chave" (CLAUDE.md 8c);
 * a falha da leitura é dita, com "Tentar de novo".
 */
export function CredencialDaIntegracao({
  de,
  versao,
  motivo,
  aoTestar,
  aoTrocar,
  trocando = false,
}: {
  de: string;
  versao?: unknown;
  motivo?: (codigo: string) => string;
  aoTestar?: () => void;
  aoTrocar?: () => void;
  trocando?: boolean;
}) {
  const t = useTranslations("Settings.integracoes");
  const [lida, setLida] = useState<{ credencial: Credencial | null } | "falhou" | null>(null);
  const [testando, setTestando] = useState(false);
  // O resultado do teste é carimbado com a chave que ele testou: trocada a
  // chave, o "não respondeu" da anterior some no mesmo render (CLAUDE.md 8c).
  const [resultado, setResultado] = useState<{ de: string; ok: boolean; texto: string } | null>(null);
  const vivoRef = useRef(true);
  const testavel = !de.startsWith("ia_");

  useEffect(() => {
    vivoRef.current = true;
    return () => {
      vivoRef.current = false;
    };
  }, []);

  // A carga: na montagem e a cada `versao` (o cartão releu). O estado só muda
  // na volta da promessa (a regra do React Compiler sobre setState em efeito).
  useEffect(() => {
    let vivo = true;
    void lerDaRota(de).then((r) => {
      if (vivo) setLida(r);
    });
    return () => {
      vivo = false;
    };
  }, [de, versao]);

  const carregar = useCallback(async () => {
    const r = await lerDaRota(de);
    if (vivoRef.current) setLida(r);
  }, [de]);

  const testar = async (alvo: string) => {
    if (testando) return;
    setTestando(true);
    setResultado(null);
    try {
      const res = await fetch(`/api/cb/integracoes/credencial?de=${encodeURIComponent(de)}`, { method: "POST" });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string };
      if (!vivoRef.current) return;
      if (res.ok) setResultado({ de: alvo, ok: true, texto: t("credencial.testeOk") });
      else if (res.status === 429) setResultado({ de: alvo, ok: false, texto: t("credencial.testeMuitoSeguido") });
      else {
        const codigo = corpo.error ?? "";
        setResultado({ de: alvo, ok: false, texto: t("credencial.testeFalhou", { motivo: motivo ? motivo(codigo) : codigo }) });
      }
      await carregar();
      aoTestar?.();
    } catch {
      if (vivoRef.current) setResultado({ de: alvo, ok: false, texto: t("credencial.testeSemResposta") });
    } finally {
      if (vivoRef.current) setTestando(false);
    }
  };

  if (lida === null) return <p className="text-xs text-muted-foreground">{t("credencial.conferindo")}</p>;
  if (lida === "falhou") {
    return (
      <p className="text-xs text-muted-foreground">
        {t("credencial.lerFalhou")}{" "}
        <button type="button" onClick={() => void carregar()} className="underline">
          {t("tentarDeNovo")}
        </button>
      </p>
    );
  }
  const c = lida.credencial;
  if (!c) return null;
  const estaChave = `${c.final ?? ""}|${c.gravadaEm ?? ""}|${c.ilegivel}`;
  const resultadoDestaChave = resultado && resultado.de === estaChave ? resultado : null;

  const quando = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  const gravada = c.gravadaEm
    ? c.gravadaPor
      ? t("credencial.gravadaEmPor", { quando: quando(c.gravadaEm), quem: c.gravadaPor })
      : t("credencial.gravadaEm", { quando: quando(c.gravadaEm) })
    : t("credencial.gravadaSemData");
  const testada = testavel ? (c.conferidaEm ? t("credencial.testadaEm", { quando: quando(c.conferidaEm) }) : t("credencial.nuncaTestada")) : null;

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground">{t("credencial.titulo")}</span>
        {c.ilegivel ? (
          <span className="text-destructive">{t("credencial.ilegivel")}</span>
        ) : (
          <code
            className="rounded bg-background px-1.5 py-0.5 tracking-wider text-foreground"
            style={{ fontFamily: FONTE_MONO }}
            aria-label={c.final ? t("credencial.terminaEm", { final: c.final }) : t("credencial.semFinal")}
            title={c.final ? t("credencial.terminaEm", { final: c.final }) : t("credencial.semFinal")}
          >
            {`••••${c.final ?? ""}`}
          </code>
        )}
      </div>
      <p className="text-muted-foreground">
        {gravada}
        {testada ? ` · ${testada}` : ""}
      </p>
      {testavel || (aoTrocar && !trocando) ? (
        <div className="flex flex-wrap items-center gap-2">
          {testavel ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void testar(estaChave)} disabled={testando}>
              {testando ? t("credencial.testando") : t("credencial.testar")}
            </Button>
          ) : null}
          {aoTrocar && !trocando ? (
            <Button type="button" variant="outline" size="sm" onClick={aoTrocar}>
              {t("credencial.trocar")}
            </Button>
          ) : null}
          {resultadoDestaChave ? (
            <span className={cn("inline-flex items-center gap-1", resultadoDestaChave.ok ? "text-emerald-600" : "text-destructive")}>
              {resultadoDestaChave.ok ? <Check className="size-3.5 shrink-0" /> : <X className="size-3.5 shrink-0" />}
              {resultadoDestaChave.texto}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
