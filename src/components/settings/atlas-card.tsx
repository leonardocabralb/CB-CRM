"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Scale } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CartaoDoAtlas } from "@/lib/atlas/cartao";
import { cn } from "@/lib/utils";

import { SettingsChip } from "./settings-chip";

/**
 * O cartão "Atlas" da aba Integrações (1071; Fase 0 de
 * docs/PLANO-integracao-atlas.md). O admin COLA a chave de API que gerou no
 * Atlas (o campo nasce vazio sempre — nenhuma chave volta da rota); o CRM a
 * prova pelo `whoami` do Atlas, confere as permissões e a guarda cifrada.
 *
 * Mesmo esqueleto do `zapsign-card.tsx`: só admin chega aqui.
 */

/**
 * ⚠️ Lista FECHADA: código fora dela (o 429 e o 401/403 do próprio CRM, um
 * 500) cai no texto NEUTRO `atlas.semMotivo` — nunca "o Atlas devolveu um
 * erro", que mandaria o admin procurar o problema no Atlas. Código novo em
 * `cliente.ts`/`conexao.ts`/`cartao.ts` entra aqui E nos dois dicionários
 * (`atlas.motivo.<código>`, chave montada — há teste cobrando).
 */
export const CODIGOS_CONHECIDOS = [
  "chave_invalida",
  "api_fora_do_plano",
  "sem_permissao",
  "validacao",
  "nao_encontrado",
  "limite",
  "limite_do_plano",
  "idempotencia",
  "acao_desconhecida",
  "fora_do_ar",
  "rede",
  "resposta_inesperada",
  "atlas_error",
  "db_error",
  "nao_conectado",
  "chave_ilegivel",
  "outro_escritorio",
  "permissoes_faltando",
  "outro_ambiente",
  "chave_mal_colada",
] as const;

/**
 * As permissões do Atlas que o passo usa. O texto de cada uma é o rótulo que
 * a tela do Atlas mostra (só em português: no `en.json`, o rótulo vai com a
 * tradução ao lado, como os rótulos do painel da Meta).
 */
export const PERMISSOES_CONHECIDAS = ["read_client", "create_client", "update_client"] as const;

const CODIGOS = new Set<string>(CODIGOS_CONHECIDOS);
const PERMISSOES = new Set<string>(PERMISSOES_CONHECIDAS);

export function AtlasCard() {
  const t = useTranslations("Settings.integracoes");
  const [cartao, setCartao] = useState<CartaoDoAtlas | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [chave, setChave] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [desconectando, setDesconectando] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const vivoRef = useRef(true);
  const cartaoRef = useRef<CartaoDoAtlas | null>(null);
  cartaoRef.current = cartao;

  const motivo = (codigo: string) =>
    CODIGOS.has(codigo)
      ? // chave montada: `atlas.motivo.<codigo>` — lista fechada acima
        t(`atlas.motivo.${codigo}` as Parameters<typeof t>[0])
      : t("atlas.semMotivo");
  const nomeDaPermissao = (p: string) => (PERMISSOES.has(p) ? t(`atlas.permissao.${p}` as Parameters<typeof t>[0]) : p);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/cb/atlas");
      if (!res.ok) throw new Error(String(res.status));
      const corpo = (await res.json()) as { cartao: CartaoDoAtlas };
      if (vivoRef.current) {
        setCartao(corpo.cartao);
        setFalhou(false);
      }
    } catch {
      if (!vivoRef.current) return;
      setFalhou(true);
      if (cartaoRef.current !== null) toast.error(t("recarregarFalhou"));
    }
  }, [t]);

  useEffect(() => {
    vivoRef.current = true;
    void carregar();
    return () => {
      vivoRef.current = false;
    };
  }, [carregar]);

  const conectar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch("/api/cb/atlas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chave }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string; faltando?: string[] };
      if (!res.ok) {
        const codigo = corpo.error ?? "atlas_error";
        setErro(
          codigo === "permissoes_faltando" && corpo.faltando?.length
            ? t("atlas.faltando", { permissoes: corpo.faltando.map(nomeDaPermissao).join(", ") })
            : motivo(codigo),
        );
        return;
      }
      setChave("");
      toast.success(t("atlas.conectado"));
      await carregar();
    } catch {
      // Rede caiu no meio: o botão voltaria calado.
      if (vivoRef.current) setErro(t("atlas.semMotivo"));
    } finally {
      if (vivoRef.current) setSalvando(false);
    }
  };

  // "Conferir de novo": o whoami com a chave guardada — a saída do aviso de
  // permissão desligada sem colar a chave outra vez (o Atlas a mostra uma vez só).
  const conferir = async () => {
    if (conferindo) return;
    setConferindo(true);
    try {
      const res = await fetch("/api/cb/atlas", { method: "PATCH" });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string; faltando?: string[] };
      if (res.ok) toast.success(t("atlas.conferidoOk"));
      else
        toast.error(
          corpo.error === "permissoes_faltando" && corpo.faltando?.length
            ? t("atlas.faltando", { permissoes: corpo.faltando.map(nomeDaPermissao).join(", ") })
            : t("falha", { motivo: corpo.error ? motivo(corpo.error) : t("atlas.semMotivo") }),
        );
      await carregar();
    } catch {
      toast.error(t("falha", { motivo: t("atlas.semMotivo") }));
    } finally {
      if (vivoRef.current) setConferindo(false);
    }
  };

  const desconectar = async () => {
    if (desconectando) return;
    if (!window.confirm(t("atlas.confirmarDesconectar"))) return;
    setDesconectando(true);
    try {
      const res = await fetch("/api/cb/atlas", { method: "DELETE" });
      if (!res.ok) {
        const corpo = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(corpo.error && CODIGOS.has(corpo.error) ? t("falha", { motivo: motivo(corpo.error) }) : t("salvarFalhou"));
        return;
      }
      await carregar();
    } catch {
      toast.error(t("salvarFalhou"));
    } finally {
      if (vivoRef.current) setDesconectando(false);
    }
  };

  const estado = cartao?.estado ?? "nao_conectado";
  // ⚠️ O chip é uma AFIRMAÇÃO no cabeçalho: enquanto não se sabe, "Conferindo"
  // — nunca "Não conectada" sobre uma integração que pode estar de pé.
  const [variante, rotuloDoChip] =
    cartao === null && !falhou
      ? (["muted", t("chipConferindo")] as const)
      : falhou && !cartao
        ? (["err", t("chipErro")] as const)
        : estado === "conectado"
          ? (["ok", t("chipOk")] as const)
          : estado === "erro"
            ? (["err", t("chipErro")] as const)
            : (["muted", t("chipNaoConectado")] as const);

  return (
    <div className="rounded-lg border border-border bg-card">
      <button type="button" onClick={() => setAberto((a) => !a)} aria-expanded={aberto} className="flex w-full items-center gap-3 p-4 text-left">
        <Scale className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">Atlas</span>
        <SettingsChip variant={variante}>{rotuloDoChip}</SettingsChip>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-180")} />
      </button>

      {aberto ? (
        <div className="space-y-4 border-t border-border p-4 text-sm">
          {falhou && !cartao ? (
            <p className="text-muted-foreground">
              {t("carregarFalhou")}{" "}
              <button type="button" onClick={() => void carregar()} className="underline">
                {t("tentarDeNovo")}
              </button>
            </p>
          ) : !cartao ? (
            <p className="text-muted-foreground">{t("atlas.carregando")}</p>
          ) : cartao.estado === "nao_conectado" ? (
            <>
              <p className="max-w-[62ch] text-muted-foreground">{t("atlas.desc")}</p>
              <div className="grid gap-3 sm:max-w-md">
                <div className="space-y-1">
                  <Label htmlFor="atlas-chave">{t("atlas.campoChave")}</Label>
                  <Input
                    id="atlas-chave"
                    type="password"
                    value={chave}
                    onChange={(e) => setChave(e.target.value)}
                    placeholder={t("atlas.chaveVazia")}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">{t("atlas.chaveDica")}</p>
                  <p className="text-xs text-muted-foreground">{t("atlas.permissoesDica")}</p>
                </div>
                {erro && <p className="text-xs text-destructive">{t("falha", { motivo: erro })}</p>}
                <div>
                  <Button type="button" size="sm" onClick={() => void conectar()} disabled={salvando || !chave.trim()}>
                    {salvando ? t("atlas.conectando") : t("atlas.conectar")}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-muted-foreground">
                  {cartao.escritorio ? t("atlas.escritorio", { nome: cartao.escritorio }) : t("atlas.semEscritorio")}
                </div>
                <div className="flex flex-wrap gap-2">
                  {cartao.estado === "erro" && (
                    <Button type="button" variant="outline" size="sm" onClick={() => void conferir()} disabled={conferindo}>
                      {conferindo ? t("atlas.conferindo") : t("atlas.conferir")}
                    </Button>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={() => void desconectar()} disabled={desconectando}>
                    {t("atlas.desconectar")}
                  </Button>
                </div>
              </div>
              {cartao.erro && <p className="text-xs text-destructive">{t("falha", { motivo: motivo(cartao.erro) })}</p>}
              <p className="max-w-[62ch] text-xs text-muted-foreground">{t("atlas.comoFunciona")}</p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
