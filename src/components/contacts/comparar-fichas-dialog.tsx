"use client";

// ============================================================
// "COMPARAR" — as duas fichas de uma possível duplicata lado a lado (1084).
//
// Pedido do operador (13/10/2026): abrir os dois cards com as informações e
// as conversas, um ao lado do outro, para conferir se são a mesma pessoa e
// então descartar ou unir. Esta é a FASE 1 (docs/PLANO-fichas-duplicadas.md):
// só o ADMIN decide (D1), e as decisões são "não é duplicata" e "pessoas
// diferentes, mas ligadas". UNIR é a fase 2 — o diálogo diz isso em vez de
// oferecer um botão que não existe (D5).
//
// ⚠️ O recorte do PERFIL vale aqui: card de funil fora do escopo e conversa
// de conexão fora do escopo NÃO aparecem (o perfil é restrição de
// visualização, `.claude/rules/perfis.md`). Derivado no RENDER, nunca no
// efeito — a lente "Ver como" troca o acesso com o diálogo aberto.
//
// ⚠️ Quem monta passa `key` com a candidata: o formulário de "ligar" é
// rascunho, e o da candidata anterior não pode sobreviver à troca.
// ============================================================

import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import {
  useComparacaoDeFichas,
  type FichaComparada,
  type MensagemComparada,
} from "@/hooks/use-comparacao-de-fichas";
import type { EstadoDasDuplicatas } from "@/hooks/use-possiveis-duplicatas";
import { formatarData, TIPO_DATA } from "@/lib/contacts/campo-data";
import type { Candidata } from "@/lib/contacts/duplicatas";
import { nomeDoContato } from "@/lib/contacts/identidade";
import { TETO_DA_DESCRICAO, type DesfechoDaEscrita } from "@/lib/contacts/relacionados";
import { canalNoEscopo, funilNoEscopo } from "@/lib/perfis/escopo";

import { identidadeLegivel, textoDosMotivos } from "./faixa-de-possivel-duplicata";

type T = ReturnType<typeof useTranslations<"Duplicatas.comparacao">>;

function rotuloDoStatus(t: T, status: string | null): string {
  if (status === "won") return t("statusGanho");
  if (status === "lost") return t("statusPerdido");
  return t("statusAberto");
}

function remetente(t: T, m: MensagemComparada): string {
  if (m.sender_type === "customer") return t("remetenteCliente");
  if (m.sender_type === "agent") return t("remetenteEquipe");
  return t("remetenteAutomacao");
}

/** "não saiu" quando a tentativa falhou — o caso do número sem WhatsApp é o que denuncia a ficha errada. */
function falhaDoEnvio(t: T, m: MensagemComparada): string | null {
  if (!m.nao_saiu && m.status !== "failed") return null;
  return m.error_title === "sem_whatsapp" ? t("naoSaiuSemWhatsapp") : t("naoSaiu");
}

function ColunaDaFicha({
  t,
  titulo,
  ficha,
  semNome,
  aoAbrirConversa,
}: {
  t: T;
  titulo: string;
  ficha: FichaComparada | undefined;
  semNome: string;
  aoAbrirConversa?: (conversaId: string) => void;
}) {
  const { acesso } = useAuth();
  if (!ficha) {
    return (
      <section className="min-w-0 rounded-lg border border-border p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
        <p className="mt-2 text-muted-foreground">{t("vazio")}</p>
      </section>
    );
  }

  const cardsVisiveis = ficha.cards.filter((c) => funilNoEscopo(acesso, c.pipeline_id));
  const cardsOcultos = ficha.cards.length - cardsVisiveis.length;
  const conversaVisivel =
    ficha.conversa !== null && (ficha.conversa.channel_id === null || canalNoEscopo(acesso, ficha.conversa.channel_id));

  return (
    <section className="min-w-0 space-y-3 rounded-lg border border-border p-3" data-ficha={ficha.id}>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
        <p className="mt-1 break-words text-base font-semibold">{nomeDoContato(ficha, semNome)}</p>
        <p className="text-xs text-muted-foreground">{t("criadaEm", { quando: formatarData(ficha.created_at) })}</p>
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t("telefone")}</dt>
        <dd className="break-words">{identidadeLegivel(ficha) ?? t("vazio")}</dd>
        <dt className="text-muted-foreground">{t("email")}</dt>
        <dd className="break-all">{ficha.email ?? t("vazio")}</dd>
      </dl>

      <div>
        <h4 className="text-xs font-medium text-muted-foreground">{t("etiquetas")}</h4>
        {ficha.etiquetas.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("semEtiquetas")}</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1">
            {ficha.etiquetas.map((e) => (
              <li key={e.nome} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  // Cor da etiqueta é DADO (hex do catálogo), não classe: vai em estilo.
                  style={{ backgroundColor: e.cor ?? undefined }}
                />
                {e.nome}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="text-xs font-medium text-muted-foreground">{t("campos")}</h4>
        {ficha.campos.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("semCampos")}</p>
        ) : (
          <dl className="mt-1 grid grid-cols-[minmax(0,40%)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            {ficha.campos.map((c) => (
              <div key={`${c.campo}:${c.valor}`} className="contents">
                <dt className="break-words text-muted-foreground">{c.campo}</dt>
                <dd className="break-words">{c.tipo === TIPO_DATA ? formatarData(c.valor) : c.valor}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div>
        <h4 className="text-xs font-medium text-muted-foreground">{t("cards")}</h4>
        {cardsVisiveis.length === 0 && cardsOcultos === 0 ? (
          <p className="text-xs text-muted-foreground">{t("semCards")}</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-xs">
            {cardsVisiveis.map((c) => (
              <li key={c.id} className="break-words">
                {c.funil ?? t("vazio")} · {c.etapa ?? t("vazio")} · {rotuloDoStatus(t, c.status)}
              </li>
            ))}
            {cardsOcultos > 0 && (
              <li className="text-muted-foreground">{t("cardsForaDoPerfil", { count: cardsOcultos })}</li>
            )}
          </ul>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-medium text-muted-foreground">{t("conversa")}</h4>
          {aoAbrirConversa && conversaVisivel && ficha.conversa && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => aoAbrirConversa(ficha.conversa!.id)}
            >
              <MessageSquare aria-hidden="true" />
              {t("abrirConversa")}
            </Button>
          )}
        </div>
        {ficha.conversa === null ? (
          <p className="text-xs text-muted-foreground">{t("semConversa")}</p>
        ) : !conversaVisivel ? (
          <p className="text-xs text-muted-foreground">{t("conversaForaDoPerfil")}</p>
        ) : ficha.mensagens.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("semMensagens")}</p>
        ) : (
          <ul className="mt-1 space-y-1.5">
            {ficha.mensagens.map((m) => {
              const falha = falhaDoEnvio(t, m);
              return (
                <li key={m.id} className="rounded-md bg-muted/50 px-2 py-1 text-xs">
                  <p className="text-muted-foreground">
                    {remetente(t, m)} · {formatarData(m.created_at)}
                    {falha && <span className="font-medium text-red-600"> · {falha}</span>}
                  </p>
                  <p className="line-clamp-3 break-words">
                    {m.deleted_at ? t("vazio") : m.content_text?.trim() || t("anexo")}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export function CompararFichasDialog({
  contatoId,
  candidata,
  aoFechar,
  podeDecidir,
  acoes,
  aoAbrirConversa,
}: {
  /** A ficha de quem abriu (a conversa ou o card). */
  contatoId: string | null;
  /** A outra ficha. NULA = diálogo fechado. */
  candidata: Candidata | null;
  aoFechar: () => void;
  /** Admin (D1). Quem não é vê as fichas e a frase de que um admin decide. */
  podeDecidir: boolean;
  acoes: Pick<EstadoDasDuplicatas, "descartar" | "desfazerDescarte" | "ligar">;
  /** Abrir a conversa da OUTRA ficha. Sem ele (nenhum caminho de navegação ali), o botão não existe. */
  aoAbrirConversa?: (conversaId: string) => void;
}) {
  const t = useTranslations("Duplicatas.comparacao");
  const tFaixa = useTranslations("Duplicatas");
  const outroId = candidata?.contatoId ?? null;
  const { fichas, carregando, falhou } = useComparacaoDeFichas(contatoId, outroId);
  const [ligando, setLigando] = useState(false);
  const [descricao, setDescricao] = useState("");
  const [gravando, setGravando] = useState(false);

  const esta = fichas?.find((f) => f.id === contatoId);
  const outra = fichas?.find((f) => f.id === outroId);

  function avisar(desfecho: DesfechoDaEscrita) {
    if (desfecho === "recusado") toast.error(t("toastRecusado"));
    else if (desfecho === "sumiu") toast.error(t("toastSumiu"));
    else toast.error(t("toastFalhou"));
  }

  async function naoEDuplicata() {
    if (!contatoId || !outroId) return;
    // Os dois ids CAPTURADOS: o "Desfazer" do toast pode ser clicado depois de
    // o operador já estar em outra conversa.
    const de = contatoId;
    const outro = outroId;
    setGravando(true);
    const desfecho = await acoes.descartar(de, outro);
    setGravando(false);
    if (desfecho !== "ok") {
      avisar(desfecho);
      return;
    }
    aoFechar();
    toast.success(t("toastDescartada"), {
      action: {
        label: t("toastDesfazer"),
        onClick: () => {
          void acoes.desfazerDescarte(de, outro).then((r) => {
            if (r === "ok") toast.success(t("toastDesfeito"));
            else avisar(r);
          });
        },
      },
    });
  }

  async function ligar() {
    if (!contatoId || !outroId) return;
    setGravando(true);
    const desfecho = await acoes.ligar(contatoId, outroId, descricao);
    setGravando(false);
    if (desfecho === "ja-vinculados") {
      aoFechar();
      toast.info(t("toastJaLigadas"));
      return;
    }
    if (desfecho !== "ok") {
      avisar(desfecho);
      return;
    }
    aoFechar();
    toast.success(t("toastLigadas"));
  }

  return (
    <Dialog open={candidata !== null} onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="max-h-[calc(var(--altura-visivel,100dvh)-2rem)] overflow-y-auto sm:max-w-5xl">
        <DialogHeader className="min-w-0">
          <DialogTitle>{t("titulo")}</DialogTitle>
          <DialogDescription className="break-words">
            {t("descricao")}
            {candidata && <span className="block">{textoDosMotivos(tFaixa, candidata.motivos)}</span>}
          </DialogDescription>
        </DialogHeader>

        {carregando ? (
          <p className="min-w-0 text-muted-foreground">{t("carregando")}</p>
        ) : falhou ? (
          <p className="min-w-0 text-red-600">{t("falhou")}</p>
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <ColunaDaFicha t={t} titulo={t("estaFicha")} ficha={esta} semNome={tFaixa("semNome")} />
            <ColunaDaFicha
              t={t}
              titulo={t("outraFicha")}
              ficha={outra}
              semNome={tFaixa("semNome")}
              aoAbrirConversa={
                aoAbrirConversa
                  ? (conversaId) => {
                      aoFechar();
                      aoAbrirConversa(conversaId);
                    }
                  : undefined
              }
            />
          </div>
        )}

        <DialogFooter className="min-w-0 sm:items-center">
          {!podeDecidir ? (
            <p className="text-xs text-muted-foreground sm:mr-auto">{t("soAdmin")}</p>
          ) : ligando ? (
            <>
              <Input
                autoFocus
                value={descricao}
                maxLength={TETO_DA_DESCRICAO}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder={t("descricaoDoVinculo")}
                aria-label={t("descricaoDoVinculo")}
                className="sm:mr-auto sm:max-w-sm"
              />
              <Button type="button" variant="outline" disabled={gravando} onClick={() => setLigando(false)}>
                {t("cancelar")}
              </Button>
              <Button type="button" disabled={gravando || carregando || falhou} onClick={() => void ligar()}>
                {t("confirmarLigacao")}
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground sm:mr-auto sm:max-w-md">{t("uniaoDepois")}</p>
              <Button
                type="button"
                variant="outline"
                disabled={gravando || carregando || falhou}
                onClick={() => setLigando(true)}
              >
                {t("ligadas")}
              </Button>
              <Button type="button" disabled={gravando || carregando || falhou} onClick={() => void naoEDuplicata()}>
                {t("naoEDuplicata")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
