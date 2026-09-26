"use client";

/**
 * "Salvar a resposta na ficha" — a linha que os nós "Coletar resposta",
 * "Enviar botões" e "Enviar lista" ganharam (CB, 26/09/2026). A regra de
 * gravação mora em `src/lib/flows/resposta-na-ficha.ts`; aqui só se escolhe o
 * destino, gravado em `salvar_em` (`'name'` ou `'custom:<id>'`).
 *
 * ⚠️ Os campos vêm REPARTIDOS POR BLOCO (966) — o operador monta um bloco
 * "Previdenciário" com um campo por pergunta, e é por ele que procura. A
 * consulta é da família que REAGRUPA (`posicao`, depois `field_name`), porque
 * `agruparCampos` reparte antes de exibir.
 *
 * ⚠️ Só aparece o campo que SERVE ao nó (`campoServeAoNo`): data nunca (o que
 * o cliente digita não vira data); nos botões e na lista, nem número nem o
 * "E-mail" espelhado (o título "Sim" cairia sempre na recusa do motor, calado).
 * Um destino já gravado que não serve mais (campo apagado, virou data…)
 * aparece como "campo apagado", nunca some calado — some e o operador acha que
 * o robô não grava nada.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { opcoesDoCampo } from "@/lib/contacts/campo-opcoes";
import { agruparCampos, type BlocoDeCampos } from "@/lib/contacts/grupos-de-campos";
import { campoServeAoNo } from "@/lib/flows/resposta-na-ficha";
import type { CustomField, GrupoDeCampos } from "@/types";
import { useFlowEditor } from "../flow-editor-state";

const NAO_SALVAR = "__none__";

type EstadoDosCampos =
  | { status: "carregando" }
  | { status: "falhou" }
  | { status: "pronto"; todos: CustomField[]; grupos: GrupoDeCampos[] };

/**
 * ⚠️ Recortado pela CONTA DO ROBÔ, nunca só pela RLS: ela devolve os campos
 * de TODA conta de que a pessoa é membro, e um campo de outra conta gravado
 * no nó faria a ativação acusar "campo apagado" — ou, num robô já ativo
 * salvo direto, o robô recusaria toda escrita (Codex, PR #314).
 */
function useCamposDaFicha(contaId: string): EstadoDosCampos {
  const [estado, setEstado] = useState<EstadoDosCampos>({ status: "carregando" });
  useEffect(() => {
    let vivo = true;
    (async () => {
      const supabase = createClient();
      const [campos, grupos] = await Promise.all([
        supabase
          .from("custom_fields")
          .select("*")
          .eq("account_id", contaId)
          .order("posicao", { nullsFirst: false })
          .order("field_name"),
        supabase
          .from("cb_grupos_de_campos")
          .select("*")
          .eq("account_id", contaId)
          .order("posicao")
          .order("nome"),
      ]);
      if (!vivo) return;
      if (campos.error || grupos.error) {
        setEstado({ status: "falhou" });
        return;
      }
      setEstado({
        status: "pronto",
        todos: (campos.data ?? []) as CustomField[],
        grupos: (grupos.data ?? []) as GrupoDeCampos[],
      });
    })();
    return () => {
      vivo = false;
    };
  }, [contaId]);
  return estado;
}

export function SalvarRespostaRow({
  nodeType,
  value,
  onChange,
  titulosDasOpcoes,
}: {
  /** O nó que grava: decide quais campos servem e se o NOME aparece. */
  nodeType: "collect_input" | "send_buttons" | "send_list";
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  /** Botões/lista: os títulos, para avisar quando não casam com um campo de lista. */
  titulosDasOpcoes?: string[];
}) {
  const t = useTranslations("Flows.builder.form");
  const { flow } = useFlowEditor();
  const estado = useCamposDaFicha(flow.account_id);
  const atual = value && value.trim() ? value : NAO_SALVAR;
  // Só o "Coletar resposta" grava no NOME — botão não é nome de ninguém.
  const permitirNome = nodeType === "collect_input";

  const blocos = useMemo<BlocoDeCampos[]>(
    () =>
      estado.status === "pronto"
        ? agruparCampos(
            estado.todos.filter((c) => campoServeAoNo(nodeType, c)),
            estado.grupos,
          )
        : [],
    [estado, nodeType],
  );

  const campoEscolhido = useMemo(() => {
    if (estado.status !== "pronto" || !atual.startsWith("custom:")) return null;
    const id = atual.slice("custom:".length);
    return estado.todos.find((c) => c.id === id) ?? null;
  }, [estado, atual]);

  const destinoOrfao =
    estado.status === "pronto" &&
    atual.startsWith("custom:") &&
    (!campoEscolhido || !campoServeAoNo(nodeType, campoEscolhido));

  // "Coletar resposta" num campo de LISTA: o cliente digita livre, e o texto
  // é gravado como veio — fora das opções, filtro e condição por opção não
  // casam. Permitido (às vezes é o que se quer), mas dito.
  const textoLivreEmLista =
    nodeType === "collect_input" && campoEscolhido?.field_type === "select" && !destinoOrfao;

  // Campo de LISTA (select): título de botão que não é uma opção do campo é
  // gravado assim mesmo, e a ficha mostraria um valor fora da lista. Avisar
  // aqui é o que deixa o operador acertar os dois textos antes de ativar.
  const foraDaLista = useMemo(() => {
    if (!campoEscolhido || campoEscolhido.field_type !== "select" || !titulosDasOpcoes) return [];
    const opcoes = new Set(opcoesDoCampo(campoEscolhido).map((o) => o.trim()));
    return titulosDasOpcoes.map((x) => x.trim()).filter((x) => x && !opcoes.has(x));
  }, [campoEscolhido, titulosDasOpcoes]);

  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{t("saveAnswerLabel")}</label>
      <Select
        value={atual}
        onValueChange={(v) => onChange(!v || v === NAO_SALVAR ? null : String(v))}
      >
        <SelectTrigger className="bg-muted">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NAO_SALVAR}>{t("saveAnswerNone")}</SelectItem>
          {(permitirNome || atual === "name") && (
            <SelectItem value="name">{t("saveAnswerName")}</SelectItem>
          )}
          {estado.status === "pronto" &&
            blocos.map((bloco) => (
              <SelectGroup key={bloco.grupo?.id ?? "geral"}>
                <SelectLabel>{bloco.grupo?.nome ?? t("saveAnswerGeneralGroup")}</SelectLabel>
                {bloco.campos.map((c) => (
                  <SelectItem key={c.id} value={`custom:${c.id}`}>
                    {c.field_name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          {destinoOrfao && (
            <SelectItem value={atual}>{t("saveAnswerUnknownField")}</SelectItem>
          )}
          {/* Enquanto os campos não chegam (ou se a leitura falhou), o destino
              gravado ainda precisa de um item — sem ele o gatilho mostraria o
              valor cru, `custom:<uuid>`. */}
          {estado.status !== "pronto" && atual.startsWith("custom:") && (
            <SelectItem value={atual}>{t("saveAnswerChosenField")}</SelectItem>
          )}
        </SelectContent>
      </Select>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {permitirNome ? t("saveAnswerHelpInput") : t("saveAnswerHelpOptions")}{" "}
        {permitirNome ? t("saveAnswerNoDates") : t("saveAnswerNoDatesOrNumbers")}
      </p>
      {estado.status === "falhou" && (
        <p className="mt-1 text-[10px] text-red-700 dark:text-red-300">{t("saveAnswerLoadError")}</p>
      )}
      {destinoOrfao && (
        <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
          {t("saveAnswerOrphan")}
        </p>
      )}
      {textoLivreEmLista && (
        <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
          {t("saveAnswerFreeTextInList")}
        </p>
      )}
      {foraDaLista.length > 0 && (
        <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
          {t("saveAnswerNotInOptions", { titulos: foraDaLista.join(", ") })}
        </p>
      )}
    </div>
  );
}
