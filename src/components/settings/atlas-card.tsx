"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Scale } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CartaoDoAtlas, ContagemDosVinculos, MudancaNoCartao } from "@/lib/atlas/cartao";
import { ESTADOS_NA_FILA, RESULTADOS_DA_MUDANCA } from "@/lib/atlas/gatilho";
import { cn } from "@/lib/utils";

import { SettingsChip } from "./settings-chip";

/**
 * O cartão "Atlas" da aba Integrações (1071; Fase 0 de
 * docs/PLANO-integracao-atlas.md). O admin COLA a chave de API que gerou no
 * Atlas (o campo nasce vazio sempre — nenhuma chave volta da rota); o CRM a
 * prova pelo `whoami` do Atlas, confere as permissões e a guarda cifrada.
 *
 * Mesmo esqueleto do `zapsign-card.tsx`: só admin chega aqui.
 *
 * Fase 2 (1072): a seção "Leitura das situações" (a última leitura, o erro
 * DELA — separado do erro da conexão —, "Ler situações agora") e as fichas
 * vinculadas por origem; o selo "Ambiente de teste" quando a instância
 * aponta para outro Atlas (a URL nunca aparece); e, na recusa
 * `outro_escritorio`, apagar os vínculos do escritório anterior (com
 * confirmação) e conectar.
 *
 * Fase 4 (1073): "Mudanças de situação" — as 20 últimas da fila do gatilho
 * "Situação mudou no Atlas", com a ficha, "anterior → nova" e o resultado
 * traduzido (`atlas.mudanca.resultado.<r>`, chave montada — há teste).
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
  // A leitura das situações (`situacoes.ts`, `CodigoDaLeitura`).
  "sem_permissao_listar",
  "api_antiga",
  "em_curso",
  "cadeado_perdido",
] as const;

/**
 * As permissões do Atlas que o passo usa. O texto de cada uma é o rótulo que
 * a tela do Atlas mostra (só em português: no `en.json`, o rótulo vai com a
 * tradução ao lado, como os rótulos do painel da Meta).
 */
export const PERMISSOES_CONHECIDAS = ["read_client", "create_client", "update_client"] as const;

const CODIGOS = new Set<string>(CODIGOS_CONHECIDOS);
const RESULTADOS = new Set<string>(RESULTADOS_DA_MUDANCA);
const NA_FILA = new Set<string>(ESTADOS_NA_FILA);
const PERMISSOES = new Set<string>(PERMISSOES_CONHECIDAS);

export function AtlasCard() {
  const t = useTranslations("Settings.integracoes");
  const [cartao, setCartao] = useState<CartaoDoAtlas | null>(null);
  const [vinculos, setVinculos] = useState<ContagemDosVinculos | null>(null);
  const [mudancas, setMudancas] = useState<MudancaNoCartao[] | null>(null);
  const [anteriores, setAnteriores] = useState<number | null>(null);
  const [lendo, setLendo] = useState(false);
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
      const corpo = (await res.json()) as { cartao: CartaoDoAtlas; vinculos: ContagemDosVinculos | null; mudancas?: MudancaNoCartao[] | null };
      if (vivoRef.current) {
        setCartao(corpo.cartao);
        setVinculos(corpo.vinculos ?? null);
        setMudancas(corpo.mudancas ?? null);
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

  // `apagarVinculosAnteriores`: o admin confirmou apagar as fichas ligadas ao
  // escritório ANTERIOR (só deste ambiente) para conectar a chave de outro.
  const conectar = async (apagarVinculosAnteriores = false) => {
    if (apagarVinculosAnteriores && !window.confirm(t("atlas.confirmarApagarVinculos", { n: anteriores ?? 0 }))) return;
    setSalvando(true);
    setErro(null);
    setAnteriores(null);
    try {
      const res = await fetch("/api/cb/atlas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chave, apagarVinculosAnteriores }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string; faltando?: string[]; vinculosAnteriores?: number };
      if (!res.ok) {
        const codigo = corpo.error ?? "atlas_error";
        if (codigo === "outro_escritorio" && typeof corpo.vinculosAnteriores === "number") setAnteriores(corpo.vinculosAnteriores);
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

  // "Ler situações agora": a mesma leitura do agendador, só desta conta.
  const lerAgora = async () => {
    if (lendo) return;
    setLendo(true);
    try {
      const res = await fetch("/api/cb/atlas/leitura", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const corpo = (await res.json().catch(() => ({}))) as {
        error?: string;
        contagem?: { clientes: number; vinculadosPeloLink: number; vinculadosPeloTelefone: number; interrompida: boolean };
      };
      if (res.ok && corpo.contagem) {
        const c = corpo.contagem;
        const valores = { clientes: c.clientes, vinculados: c.vinculadosPeloLink + c.vinculadosPeloTelefone };
        toast.success(c.interrompida ? t("atlas.lidoParcial", valores) : t("atlas.lidoOk", valores));
      } else if (res.status === 429 && corpo.error !== "limite") toast.error(t("falha", { motivo: t("atlas.leituraMuitoSeguida") }));
      else toast.error(t("falha", { motivo: corpo.error ? motivo(corpo.error) : t("atlas.semMotivo") }));
      await carregar();
    } catch {
      toast.error(t("falha", { motivo: t("atlas.semMotivo") }));
    } finally {
      if (vivoRef.current) setLendo(false);
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
        {cartao?.ambienteDeTeste && <SettingsChip variant="warn">{t("atlas.ambienteDeTeste")}</SettingsChip>}
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
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => void conectar()} disabled={salvando || !chave.trim()}>
                    {salvando ? t("atlas.conectando") : t("atlas.conectar")}
                  </Button>
                  {anteriores !== null && anteriores > 0 && (
                    <Button type="button" size="sm" variant="outline" onClick={() => void conectar(true)} disabled={salvando || !chave.trim()}>
                      {t("atlas.apagarVinculos", { n: anteriores })}
                    </Button>
                  )}
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
              {cartao.leitura && (
                <LeituraDasSituacoes
                  leitura={cartao.leitura}
                  vinculos={vinculos}
                  lendo={lendo}
                  onLerAgora={() => void lerAgora()}
                  motivo={motivo}
                />
              )}
              {cartao.leitura && mudancas && <MudancasDeSituacao mudancas={mudancas} />}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A seção "Leitura das situações" (fora do componente: definida dentro, ela
 * remontaria a cada render). As datas pelo idioma do navegador.
 */
function LeituraDasSituacoes({
  leitura,
  vinculos,
  lendo,
  onLerAgora,
  motivo,
}: {
  leitura: NonNullable<CartaoDoAtlas["leitura"]>;
  vinculos: ContagemDosVinculos | null;
  lendo: boolean;
  onLerAgora: () => void;
  motivo: (codigo: string) => string;
}) {
  const t = useTranslations("Settings.integracoes");
  const quando = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  const pelaAutomacao = vinculos ? vinculos.porOrigem.criada + vinculos.porOrigem.reativada + vinculos.porOrigem.encontrada : 0;
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{t("atlas.leituraTitulo")}</p>
        <Button type="button" variant="outline" size="sm" onClick={onLerAgora} disabled={lendo}>
          {lendo ? t("atlas.lendo") : t("atlas.lerAgora")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {leitura.ultimaEm ? t("atlas.leituraUltima", { quando: quando(leitura.ultimaEm) }) : t("atlas.leituraNunca")}
        {leitura.ultimaEm && leitura.velha && !leitura.erro ? ` ${t("atlas.leituraAtrasada")}` : ""}
      </p>
      {leitura.erro && <p className="text-xs text-destructive">{t("atlas.leituraErro", { motivo: motivo(leitura.erro) })}</p>}
      {vinculos && (
        <p className="text-xs text-muted-foreground">
          {t("atlas.vinculos", { total: vinculos.total })}{" "}
          {t("atlas.vinculosDetalhe", {
            link: vinculos.porCasamento.chat_link,
            telefone: vinculos.porCasamento.telefone,
            manual: vinculos.porOrigem.manual,
            passo: pelaAutomacao,
          })}
        </p>
      )}
      <p className="max-w-[62ch] text-xs text-muted-foreground">{t("atlas.leituraDica")}</p>
    </div>
  );
}

/**
 * "Mudanças de situação" (1073): as 20 últimas da fila do gatilho. O
 * resultado é chave montada com reserva (código fora da lista = o próprio
 * código, nunca a chave crua); o detalhe (uma linha por automação) vem do
 * servidor, como no cartão do ZapSign.
 */
function MudancasDeSituacao({ mudancas }: { mudancas: MudancaNoCartao[] }) {
  const t = useTranslations("Settings.integracoes");
  const quando = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  const rotulo = (m: MudancaNoCartao) =>
    m.resultado
      ? RESULTADOS.has(m.resultado)
        ? t(`atlas.mudanca.resultado.${m.resultado}` as Parameters<typeof t>[0])
        : m.resultado
      : NA_FILA.has(m.estado)
        ? t(`atlas.mudanca.estado.${m.estado}` as Parameters<typeof t>[0])
        : m.estado;
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="text-sm font-medium text-foreground">{t("atlas.mudancasTitulo")}</p>
      {mudancas.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("atlas.mudancasVazio")}</p>
      ) : (
        <ul className="space-y-1.5">
          {mudancas.map((m) => (
            <li key={m.id} className="min-w-0 text-xs">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-muted-foreground">{quando(m.criadaEm)}</span>
                <span className="min-w-0 truncate font-medium text-foreground">{m.ficha?.nome ?? t("atlas.semFicha")}</span>
                <span className="text-foreground">
                  {m.situacaoAnterior} → {m.situacaoNova}
                </span>
                <span
                  className={cn(
                    "rounded border px-1.5 py-px",
                    m.resultado === "disparado"
                      ? "border-emerald-500/40 text-emerald-700"
                      : m.resultado === "falhou"
                        ? "border-red-500/40 text-red-700"
                        : "border-border text-muted-foreground",
                  )}
                >
                  {rotulo(m)}
                </span>
              </div>
              {m.detalhe && <p className="mt-0.5 whitespace-pre-line break-words text-[11px] text-muted-foreground">{m.detalhe}</p>}
            </li>
          ))}
        </ul>
      )}
      <p className="max-w-[62ch] text-xs text-muted-foreground">{t("atlas.mudancasDica")}</p>
    </div>
  );
}
