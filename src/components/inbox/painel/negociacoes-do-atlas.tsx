"use client";

// ============================================================
// A seção "Negociação no Atlas" da aba Atlas (Fase 3 de
// docs/PLANO-integracao-atlas.md): bancos, contratos, propostas e acordos do
// cliente do Atlas ligado a esta ficha, lidos NA HORA pela rota
// `/api/cb/atlas/contato/[contactId]/negociacoes`. Nada é guardado no CRM.
//
// ⚠️ Busca SÓ quando MONTADA: a aba fechada é desmontada (`TabsContent` com
// `keepMounted` falso), então trocar de conversa não gasta a cota do Atlas
// (60/min do ESCRITÓRIO, dividida com o n8n e o passo "Criar cliente"). Quem
// monta passa `key={contact.id}` — o painel não remonta ao trocar de cliente.
// E ainda assim a resposta é CARIMBADA com o contato (`{ de }`) e comparada
// com a prop do render: efeito é passivo, e a negociação de um cliente nunca
// aparece na conversa de outro.
//
// ⚠️ Estados que NÃO viram "sem negociação": carregando, falhou, permissão
// desligada, lixeira, espera (429). "Sem negociação" só com a resposta do
// Atlas trazendo zero bancos. ⚠️ O 429 diz QUEM recusou (`EsperaPedida`): o
// balde do próprio CRM nunca vira "o Atlas pediu para esperar".
//
// As peças (`LinhaDoContrato`, `LinhaDaProposta`, `CartaoDoBanco`) moram
// FORA do componente: definidas dentro, remontariam a cada render.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { Landmark, Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { diaPorExtenso } from "@/lib/asaas/inadimplencia";
import {
  resultadoDaResposta,
  SITUACOES_DA_PROPOSTA,
  SITUACOES_DO_CONTRATO,
  TIPOS_DE_PROPOSTA,
  type BancoDoAtlas,
  type ContratoDoAtlas,
  type ErroDasNegociacoes,
  type EsperaPedida,
  type NegociacoesDoAtlas as Negociacoes,
  type PropostaDoAtlas,
  type ResultadoDasNegociacoes,
} from "@/lib/atlas/negociacoes";

import { TituloDeSecao } from "./titulo-de-secao";

type T = ReturnType<typeof useTranslations<"Inbox.atlasNegociacoes">>;

const TRACO = "—";
const MOEDA = new Intl.NumberFormat(undefined, { style: "currency", currency: "BRL" });
const PORCENTO = new Intl.NumberFormat(undefined, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Dinheiro no idioma do navegador, em reais; nulo = travessão (o Atlas não inventa valor, nem nós). */
export function dinheiroOuTraco(v: number | null): string {
  return v === null ? TRACO : MOEDA.format(v);
}

/** O desconto como veio (negativo aparece negativo); nulo = travessão. */
export function descontoOuTraco(pct: number | null): string {
  return pct === null ? TRACO : PORCENTO.format(pct / 100);
}

/** `AAAA-MM-DD` → `DD/MM/AAAA` sem passar por `Date` (meia-noite UTC voltaria um dia). */
function diaOuTraco(dia: string | null): string {
  return dia === null ? TRACO : diaPorExtenso(dia);
}

/**
 * O rótulo de uma situação ou tipo — chave MONTADA (`<grupo>.<valor>`, cobrada
 * nos dois dicionários por teste). A lista do Atlas não é fechada: o valor
 * desconhecido vira o texto de reserva (`<grupo>.outra`), nunca a chave crua.
 */
function rotulo(
  t: T,
  grupo: "situacaoDoContrato" | "situacaoDaProposta" | "tipoDaProposta",
  valor: string | null,
  conhecidos: readonly string[],
): string | null {
  if (valor === null) return null;
  const chave = conhecidos.includes(valor) ? `${grupo}.${valor}` : `${grupo}.outra`;
  return t(chave as Parameters<T>[0]);
}

function LinhaDoContrato({ c, t }: { c: ContratoDoAtlas; t: T }) {
  const situacao = rotulo(t, "situacaoDoContrato", c.status, SITUACOES_DO_CONTRATO);
  const detalhes = [
    c.titular ? t("titular", { nome: c.titular }) : null,
    situacao,
    c.is_judicializado === true ? t("judicializado") : null,
    c.settled_date ? t("quitadoEm", { dia: diaPorExtenso(c.settled_date) }) : null,
  ].filter((x): x is string => x !== null);
  return (
    <li className="min-w-0">
      <p className="text-foreground break-words">
        {c.contract_ref ?? t("semReferencia")}
        {c.debt_type && <span className="text-muted-foreground">{` · ${c.debt_type}`}</span>}
      </p>
      {detalhes.length > 0 && <p className="text-muted-foreground break-words">{detalhes.join(" · ")}</p>}
      {c.settlement && (
        <p className="text-muted-foreground break-words">
          {t("acordo", {
            valor: dinheiroOuTraco(c.settlement.total_settled_amount),
            divida: dinheiroOuTraco(c.settlement.total_debt_at_settlement),
            desconto: descontoOuTraco(c.settlement.discount_pct),
          })}
        </p>
      )}
    </li>
  );
}

function LinhaDaProposta({ p, t }: { p: PropostaDoAtlas; t: T }) {
  const detalhes = [
    rotulo(t, "situacaoDaProposta", p.status, SITUACOES_DA_PROPOSTA),
    rotulo(t, "tipoDaProposta", p.proposal_type, TIPOS_DE_PROPOSTA),
  ].filter((x): x is string => x !== null);
  return (
    <li className="min-w-0">
      <p className="text-foreground break-words">
        {`${diaOuTraco(p.date)} · ${dinheiroOuTraco(p.proposed_amount)}`}
        {detalhes.length > 0 && <span className="text-muted-foreground">{` · ${detalhes.join(" · ")}`}</span>}
      </p>
      <p className="text-muted-foreground break-words">{t("baseEDesconto", { base: dinheiroOuTraco(p.base_debt), desconto: descontoOuTraco(p.discount_pct) })}</p>
    </li>
  );
}

function CartaoDoBanco({ b, t }: { b: BancoDoAtlas; t: T }) {
  return (
    <li className="border-border bg-muted/40 min-w-0 rounded-md border px-2.5 py-2 text-xs">
      <p className="text-foreground truncate font-medium">{b.bank_name ?? t("bancoSemNome")}</p>
      <p className="text-muted-foreground">
        {`${t("dividaOriginal", { valor: dinheiroOuTraco(b.original_debt) })} · ${t("dividaAtualizada", { valor: dinheiroOuTraco(b.updated_debt) })}`}
      </p>
      {b.contracts.length > 0 && (
        <div className="mt-1.5">
          <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">{t("contratos", { n: b.contracts.length })}</p>
          <ul className="mt-0.5 space-y-1">
            {b.contracts.map((c, i) => (
              <LinhaDoContrato key={c.id ?? i} c={c} t={t} />
            ))}
          </ul>
        </div>
      )}
      {b.proposals.length > 0 && (
        <div className="mt-1.5">
          <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">{t("propostas", { n: b.proposals.length })}</p>
          <ul className="mt-0.5 space-y-1">
            {b.proposals.map((p, i) => (
              <LinhaDaProposta key={p.id ?? i} p={p} t={t} />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

/** O que a seção sabe, CARIMBADO com o contato de quem é. */
export interface EstadoDasNegociacoes {
  de: string | null;
  negociacoes: Negociacoes | null;
  erro: ErroDasNegociacoes | null;
  /** O último 429: quantos segundos, e se foi o Atlas ou o balde da rota. */
  espera: EsperaPedida | null;
}

export const ESTADO_INICIAL: EstadoDasNegociacoes = { de: null, negociacoes: null, erro: null, espera: null };

/**
 * Puro: o estado depois de uma resposta PARA `de`. No 429 a negociação já
 * mostrada DESTE contato fica (continua valendo; só não foi relida); a de
 * outro contato nunca. O ERRO anterior sai no 429: a última resposta só
 * disse "espere" — mantê-lo mostraria uma falha que pode já estar
 * resolvida (a permissão religada) ao lado da espera, e depois dela.
 */
export function proximoEstado(atual: EstadoDasNegociacoes, de: string, r: ResultadoDasNegociacoes): EstadoDasNegociacoes {
  if (r.tipo === "ok") return { de, negociacoes: r.negociacoes, erro: null, espera: null };
  if (r.tipo === "erro") return { de, negociacoes: null, erro: r.erro, espera: null };
  const mesmo = atual.de === de;
  return { de, negociacoes: mesmo ? atual.negociacoes : null, erro: null, espera: r.espera };
}

/** Puro: o que o render pode mostrar para ESTE contato (o carimbo contra a prop). */
export function estadoVisivel(estado: EstadoDasNegociacoes, contactId: string): { carregando: boolean; estado: EstadoDasNegociacoes } {
  return estado.de === contactId ? { carregando: false, estado } : { carregando: true, estado: ESTADO_INICIAL };
}

async function pedirNegociacoes(contactId: string): Promise<ResultadoDasNegociacoes> {
  const res = await fetch(`/api/cb/atlas/contato/${contactId}/negociacoes`, { cache: "no-store" }).catch(() => null);
  if (!res) return { tipo: "erro", erro: "falhou" };
  const corpo: unknown = await res.json().catch(() => null);
  return resultadoDaResposta(res.status, corpo);
}

/** A seção desenhada a partir do estado — separada para o teste. */
export function PainelDasNegociacoes({
  estado,
  carregando,
  atualizando,
  esperando,
  onAtualizar,
}: {
  estado: EstadoDasNegociacoes;
  /** ⚠️ Obrigatória: sem ela, o vazio da carga seria lido como "sem negociação". */
  carregando: boolean;
  atualizando: boolean;
  /** O botão fica travado pelo tempo pedido no 429; o aviso da espera só aparece enquanto dura. */
  esperando: boolean;
  onAtualizar: () => void;
}) {
  const t = useTranslations("Inbox.atlasNegociacoes");
  const n = estado.negociacoes;
  const bloqueado = carregando || atualizando || esperando;
  return (
    <section className="space-y-2" aria-busy={carregando || atualizando}>
      <div className="flex items-center justify-between gap-2">
        <TituloDeSecao icon={<Landmark className="h-3.5 w-3.5" aria-hidden="true" />}>{t("titulo")}</TituloDeSecao>
        {!carregando && (
          <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2" disabled={bloqueado} title={t("atualizar")} aria-label={t("atualizar")} onClick={onAtualizar}>
            {atualizando ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          </Button>
        )}
      </div>

      {carregando ? (
        <div className="flex justify-center py-6">
          <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          {/* Com a espera vencida, os segundos já não valem: o aviso sai, fica o "Tentar de novo". */}
          {esperando && estado.espera !== null && (
            <p className="px-1 text-xs text-amber-700 dark:text-amber-300" role="status">
              {estado.espera.origem === "atlas" ? t("limite", { segundos: estado.espera.segundos }) : t("limiteDoCrm", { segundos: estado.espera.segundos })}
            </p>
          )}

          {estado.erro !== null && (
            <div className="px-1 py-2 text-center">
              {/* chave montada: `erro.<código>` — `ERROS_DAS_NEGOCIACOES`, cobrados nos dois dicionários por teste */}
              <p className="text-muted-foreground text-sm">{t(`erro.${estado.erro}` as Parameters<T>[0])}</p>
              {estado.erro === "sem_permissao" && <p className="text-muted-foreground/70 mt-1 text-xs">{t("semPermissaoDica")}</p>}
              {(estado.erro === "conexao" || estado.erro === "sem_permissao_consultar") && <p className="text-muted-foreground/70 mt-1 text-xs">{t("conexaoDica")}</p>}
              <Button size="sm" variant="outline" className="mt-3" disabled={bloqueado} onClick={onAtualizar}>
                <RefreshCw className="size-3.5" />
                {t("tentarDeNovo")}
              </Button>
            </div>
          )}

          {n !== null &&
            (n.banks.length === 0 ? (
              <p className="text-muted-foreground px-1 text-sm">{t("semNegociacao")}</p>
            ) : (
              <ul className="space-y-1.5">
                {n.banks.map((b, i) => (
                  <CartaoDoBanco key={b.id ?? i} b={b} t={t} />
                ))}
              </ul>
            ))}

          {n?.truncated && (
            <p className="px-1 text-[11px] text-amber-700 dark:text-amber-300">
              {t("listaCortada", {
                bancos: n.totals.banks ?? TRACO,
                contratos: n.totals.contracts ?? TRACO,
                propostas: n.totals.proposals ?? TRACO,
              })}
            </p>
          )}

          {/* 429 no primeiro pedido: nada a mostrar além da espera — com "Tentar de novo" quando ela passar. */}
          {n === null && estado.erro === null && estado.espera !== null && (
            <div className="text-center">
              <Button size="sm" variant="outline" disabled={bloqueado} onClick={onAtualizar}>
                <RefreshCw className="size-3.5" />
                {t("tentarDeNovo")}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function NegociacoesDoAtlas({ contactId }: { contactId: string }) {
  const [estado, setEstado] = useState<EstadoDasNegociacoes>(ESTADO_INICIAL);
  const [atualizando, setAtualizando] = useState(false);
  const [esperando, setEsperando] = useState(false);
  /** Cada "Atualizar" é um pedido novo. */
  const [nonce, setNonce] = useState(0);
  /** Só a resposta do ÚLTIMO pedido vale (o "Atualizar" pode cruzar com o anterior). */
  const pedidoRef = useRef(0);
  /**
   * Um pedido por (contato, nonce): o StrictMode do desenvolvimento roda o
   * efeito duas vezes, e cada vez seria uma chamada ao Atlas. Por isso não há
   * "vivo" desligado na limpeza (a segunda volta não pede de novo, e a
   * resposta da primeira tem de valer): quem protege a tela é o carimbo
   * `{ de }` comparado com a prop.
   */
  const pedidoParaRef = useRef<string | null>(null);
  const esperaRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const chave = `${contactId}:${nonce}`;
    if (pedidoParaRef.current === chave) return;
    pedidoParaRef.current = chave;
    const n = ++pedidoRef.current;
    void (async () => {
      const r = await pedirNegociacoes(contactId);
      if (n !== pedidoRef.current) return;
      setEstado((atual) => proximoEstado(atual, contactId, r));
      setAtualizando(false);
      if (r.tipo === "limite") {
        setEsperando(true);
        if (esperaRef.current) clearTimeout(esperaRef.current);
        esperaRef.current = setTimeout(() => setEsperando(false), r.espera.segundos * 1000);
      }
    })();
  }, [contactId, nonce]);

  useEffect(
    () => () => {
      if (esperaRef.current) clearTimeout(esperaRef.current);
    },
    [],
  );

  const atualizar = () => {
    setAtualizando(true);
    setNonce((x) => x + 1);
  };

  const visivel = estadoVisivel(estado, contactId);
  return <PainelDasNegociacoes estado={visivel.estado} carregando={visivel.carregando} atualizando={atualizando} esperando={esperando} onAtualizar={atualizar} />;
}
