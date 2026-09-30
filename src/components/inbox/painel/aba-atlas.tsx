"use client";

// ============================================================
// Aba "Atlas" do painel da conversa E da ficha de /contatos (Fase 2 de
// docs/PLANO-integracao-atlas.md): a situação do cliente no Atlas, desde
// quando, como o vínculo nasceu, "Abrir no Atlas" e — só para
// administradores (decisão do operador, 30/09/2026) — vincular colando o
// link da ficha do Atlas, ou desvincular.
//
// Os dados chegam por props (`useAtlasDoContato`, chamado no TOPO de quem
// monta: o botão do cabeçalho precisa deles antes de a aba abrir).
//
// Estados, NESTA ordem: carregando (a prop é OBRIGATÓRIA: sem ela a aba
// diria "sem vínculo" durante a carga — lista vazia virando afirmação),
// falhou (com "Tentar de novo"), não conectado, sem vínculo, na lixeira do
// Atlas (com "Conferir no Atlas" para o admin, depois de restaurar lá) e o
// vínculo. A falha nunca vira "sem vínculo".
//
// ⚠️ O gate de vincular é `useCan("edit-settings")` — o `requireRole('admin')`
// da rota, pela lente "Ver como" (ler o papel do perfil direto a furaria).
// ⚠️ As peças moram FORA do componente: definidas dentro, remontariam a cada
// render e o campo colado perderia o foco (a lição de `aba-cobrancas.tsx`).
// Quem monta passa `key` com o contato: o link colado é rascunho.
// ============================================================

import { useState } from "react";
import { Loader2, RefreshCw, Scale, Unlink } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCan } from "@/hooks/use-can";
import { avisarAtlasMudou } from "@/lib/atlas/aviso";
import { ehErroDoVinculo, situacaoConhecida, type AtlasDoContato, type VinculoNaTela } from "@/lib/atlas/do-contato";
import { CASOU_POR, ORIGENS_DO_VINCULO } from "@/lib/atlas/leitura";
import { cn } from "@/lib/utils";

import { AbrirNoAtlas } from "../abrir-no-atlas";
import { NegociacoesDoAtlas } from "./negociacoes-do-atlas";
import { TituloDeSecao } from "./titulo-de-secao";

type T = ReturnType<typeof useTranslations<"Inbox.atlas">>;

/** `dd/mm/aaaa hh:mm` no fuso de quem lê. */
function quandoFoi(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** `dd/mm/aaaa` no fuso de quem lê (o `status_changed_at` é um instante). */
function diaDe(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** A frase do erro da rota: o código traduzido, ou a genérica — nunca o texto cru. */
function mensagemDoErro(t: T, codigo: unknown): string {
  // chave montada: `erro.<código>` — os de `ERROS_DO_VINCULO`, cobrados nos dois dicionários por `do-contato.test.ts`
  return ehErroDoVinculo(codigo) ? t(`erro.${codigo}` as Parameters<T>[0]) : t("erroGenerico");
}

async function pedirVinculo(contactId: string, corpo: Record<string, unknown>): Promise<{ ok: true } | { ok: false; codigo: unknown }> {
  try {
    const res = await fetch(`/api/cb/atlas/contato/${contactId}/vinculo`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    if (res.ok) return { ok: true };
    const json = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return { ok: false, codigo: json?.error ?? null };
  } catch {
    return { ok: false, codigo: null };
  }
}

/** O rótulo da situação: as conhecidas traduzidas; outra, a reserva — nunca a chave crua. */
function rotuloDaSituacao(t: T, situacao: string | null): string {
  if (!situacao) return t("situacaoNaoLida");
  const s = situacaoConhecida(situacao);
  // chave montada: `situacao.<s>` — as de `SITUACOES_DO_ATLAS`, cobradas por `do-contato.test.ts`
  return s ? t(`situacao.${s}` as Parameters<T>[0]) : t("situacaoOutra", { situacao });
}

/** Como o vínculo nasceu (e, no automático, por quê). Origem desconhecida: a reserva. */
function comoNasceu(t: T, v: VinculoNaTela): string {
  // chaves montadas: `origem.<o>` e `casouPor.<x>` — de `ORIGENS_DO_VINCULO` e `CASOU_POR`, cobradas por `do-contato.test.ts`
  const origem = v.origem && (ORIGENS_DO_VINCULO as readonly string[]).includes(v.origem) ? t(`origem.${v.origem}` as Parameters<T>[0]) : t("origemOutra");
  const porque = v.casouPor && (CASOU_POR as readonly string[]).includes(v.casouPor) ? t(`casouPor.${v.casouPor}` as Parameters<T>[0]) : null;
  return porque ? `${origem}, ${porque}` : origem;
}

function FormularioDeVinculo({ contactId, t }: { contactId: string; t: T }) {
  const [link, setLink] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function vincular() {
    if (!link.trim() || enviando) return;
    setEnviando(true);
    setErro(null);
    const r = await pedirVinculo(contactId, { acao: "ligar", link: link.trim() });
    setEnviando(false);
    if (!r.ok) {
      setErro(mensagemDoErro(t, r.codigo));
      return;
    }
    toast.success(t("vinculado"));
    // O fio (faixa), o painel (botão) e esta aba releem pelo evento.
    avisarAtlasMudou();
  }

  return (
    <form
      className="mt-3 space-y-2 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        void vincular();
      }}
    >
      <label className="text-muted-foreground block text-xs" htmlFor={`atlas-link-${contactId}`}>
        {t("colarLink")}
      </label>
      <Input
        id={`atlas-link-${contactId}`}
        value={link}
        onChange={(e) => {
          setLink(e.target.value);
          setErro(null);
        }}
        placeholder={t("colarLinkPlaceholder")}
        autoComplete="off"
        spellCheck={false}
        className="h-8 text-xs"
      />
      {erro && <p className="text-xs text-red-700 dark:text-red-300">{erro}</p>}
      <Button type="submit" size="sm" disabled={!link.trim() || enviando}>
        {enviando && <Loader2 className="size-3.5 animate-spin" />}
        {enviando ? t("vinculando") : t("vincular")}
      </Button>
    </form>
  );
}

function Desvincular({ contactId, t }: { contactId: string; t: T }) {
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function desvincular() {
    setEnviando(true);
    const r = await pedirVinculo(contactId, { acao: "desligar" });
    setEnviando(false);
    if (!r.ok) {
      toast.error(mensagemDoErro(t, r.codigo));
      return;
    }
    setConfirmando(false);
    toast.success(t("desvinculado"));
    avisarAtlasMudou();
  }

  if (!confirmando) {
    return (
      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setConfirmando(true)}>
        <Unlink className="size-3.5" />
        {t("desvincular")}
      </Button>
    );
  }
  return (
    <div className="border-border bg-muted/40 space-y-2 rounded-md border p-2.5 text-xs">
      <p className="text-foreground">{t("confirmarDesvincular")}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="destructive" disabled={enviando} onClick={() => void desvincular()}>
          {enviando && <Loader2 className="size-3.5 animate-spin" />}
          {t("desvincular")}
        </Button>
        <Button size="sm" variant="ghost" disabled={enviando} onClick={() => setConfirmando(false)}>
          {t("cancelar")}
        </Button>
      </div>
    </div>
  );
}

/**
 * "Conferir no Atlas" (só admin), no estado LIXEIRA: restaurar no Atlas não
 * muda o `status_changed_at`, e só a listagem completa (a diária) limparia a
 * marca — a aba diria "na lixeira" e a faixa calaria a linha do Atlas por
 * dias. É o mesmo `PUT ligar` com o id do vínculo: o servidor relê o
 * cliente e tira a marca (ou responde `ainda_na_lixeira`).
 */
function ConferirNaLixeira({ contactId, atlasClientId, t }: { contactId: string; atlasClientId: string; t: T }) {
  const [enviando, setEnviando] = useState(false);

  async function conferir() {
    setEnviando(true);
    const r = await pedirVinculo(contactId, { acao: "ligar", link: atlasClientId });
    setEnviando(false);
    if (!r.ok) {
      toast.error(mensagemDoErro(t, r.codigo));
      return;
    }
    toast.success(t("foraDaLixeira"));
    avisarAtlasMudou();
  }

  return (
    <Button size="sm" variant="outline" disabled={enviando} onClick={() => void conferir()}>
      {enviando ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
      {enviando ? t("conferindo") : t("conferirNoAtlas")}
    </Button>
  );
}

export function AbaAtlas({
  contactId,
  dados,
  carregando,
  falhou,
  recarregar,
}: {
  contactId: string;
  dados: AtlasDoContato | null;
  /** ⚠️ Obrigatória: sem ela a aba afirmaria "sem vínculo" durante a carga. */
  carregando: boolean;
  falhou: boolean;
  recarregar: () => void;
}) {
  const t = useTranslations("Inbox.atlas");
  const podeVincular = useCan("edit-settings");

  if (carregando) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (falhou || !dados) {
    return (
      <div className="py-4 text-center">
        <p className="text-muted-foreground text-sm">{t("erroCarregar")}</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={recarregar}>
          <RefreshCw className="size-3.5" />
          {t("tentarDeNovo")}
        </Button>
      </div>
    );
  }

  if (!dados.conectado) {
    return (
      <div className="py-6 text-center">
        <Scale className="text-muted-foreground/40 mx-auto h-8 w-8" />
        <p className="text-muted-foreground mt-2 text-sm">{t("naoConectado")}</p>
        <p className="text-muted-foreground/70 mt-1 text-xs">{t("naoConectadoDica")}</p>
      </div>
    );
  }

  const v = dados.vinculo;
  if (!v) {
    return (
      <div className="py-6 text-center">
        <Scale className="text-muted-foreground/40 mx-auto h-8 w-8" />
        <p className="text-muted-foreground mt-2 text-sm">{t("semVinculo")}</p>
        <p className="text-muted-foreground/70 mt-1 text-xs">{podeVincular ? t("semVinculoDica") : t("semVinculoPecaAoAdmin")}</p>
        {podeVincular && <FormularioDeVinculo contactId={contactId} t={t} />}
      </div>
    );
  }

  if (v.excluidoEm) {
    return (
      <div className="space-y-3">
        <TituloDeSecao>{t("titulo")}</TituloDeSecao>
        <p className="px-1 text-sm text-amber-700 dark:text-amber-300">{t("naLixeira", { quando: quandoFoi(v.excluidoEm) ?? "—" })}</p>
        <p className="text-muted-foreground px-1 text-xs">{podeVincular ? t("naLixeiraDica") : t("naLixeiraDicaPecaAoAdmin")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <AbrirNoAtlas appUrl={v.appUrl} variante="botao" />
          {podeVincular && <ConferirNaLixeira contactId={contactId} atlasClientId={v.atlasClientId} t={t} />}
          {podeVincular && <Desvincular contactId={contactId} t={t} />}
        </div>
      </div>
    );
  }

  const desde = diaDe(v.situacaoDesde);
  const lida = quandoFoi(v.lidaEm);
  return (
    <div className="space-y-3">
      <TituloDeSecao>{t("titulo")}</TituloDeSecao>
      <div className="border-border bg-muted/40 rounded-md border px-2.5 py-2 text-xs">
        <p className="text-foreground text-sm font-medium">{rotuloDaSituacao(t, v.situacao)}</p>
        {v.situacao && <p className="text-muted-foreground">{desde ? t("desde", { dia: desde }) : t("desdeDesconhecido")}</p>}
        <p className="text-muted-foreground mt-1">{comoNasceu(t, v)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <AbrirNoAtlas appUrl={v.appUrl} variante="botao" />
        {podeVincular && <Desvincular contactId={contactId} t={t} />}
      </div>
      <p className={cn("px-1 text-[11px]", v.velha ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground/70")}>
        {lida ? (v.velha ? t("leituraAntiga", { quando: lida }) : t("dadosDe", { quando: lida })) : t("leituraNunca")}
      </p>
      {/* A negociação (Fase 3): lida NA HORA no Atlas, só com o vínculo fora
          da lixeira (lá o Atlas responde `not_found`). Montada só com a aba
          aberta: é a montagem que dispara a leitura. */}
      <NegociacoesDoAtlas key={contactId} contactId={contactId} />
    </div>
  );
}
