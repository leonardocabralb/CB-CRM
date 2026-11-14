"use client";

import { useEffect, useMemo, useState } from "react";

import {
  COLUNAS_DA_NOTA_DO_AVISO,
  idsDasNotasDosAvisos,
  type LinhaDaNotaDoAviso,
} from "@/lib/notifications/nota-do-aviso";
import { useAoVoltarParaOApp } from "@/hooks/use-ao-voltar-para-o-app";
import { createClient } from "@/lib/supabase/client";
import type { Notification } from "@/types";

/**
 * As anotações que os avisos de menção/resposta apontam (`note_id`, 1114) —
 * para o aviso dizer "Anotação apagada" (1132), no sino e no Meu dia.
 *
 * ⚠️ Lê VIVAS E APAGADAS de propósito (sem filtro de `apagada_em`): a marca é
 * a pergunta. A leitura é da conta pela RLS da 1032, como a aba Notas.
 *
 * ⚠️ Carimbada com a CHAVE dos ids (`{ de }`): a lista de avisos muda (tempo
 * real, recarga), e o mapa de uma leitura velha não pode responder pela
 * lista nova — um id que ela não leu seria lido como "não existe mais" e o
 * aviso de uma anotação viva diria "apagada". Devolve `null` ("não sei")
 * enquanto a leitura da lista ATUAL não volta, e se ela falhar.
 *
 * ⚠️ RELÊ a cada lista nova de avisos (recarga, tempo real, marcar lida), ao
 * VOLTAR para o app e a cada minuto com a aba à vista, não só quando os ids
 * mudam: a anotação apagada ou restaurada com a tela aberta deixaria o aviso
 * dizendo o contrário para sempre. O minuto é o que pega a apagada por OUTRA
 * pessoa com a página aberta: a lixeira só escreve em `cb_conversation_notes`,
 * e as telas de aviso assinam só `notifications`. Enquanto relê, o mapa
 * anterior continua valendo — os ids são os mesmos, então nada pisca.
 *
 * Os ids vão num `in` (o sino lê até 100 avisos; o Meu dia, menos): cabe na
 * URL e no teto de 1000 linhas.
 */
export function useNotasDosAvisos(
  avisos: readonly Pick<Notification, "type" | "note_id">[] | null,
): ReadonlyMap<string, LinhaDaNotaDoAviso> | null {
  const ids = useMemo(() => idsDasNotasDosAvisos(avisos ?? []), [avisos]);
  const chave = ids.join(",");
  const [lida, setLida] = useState<{
    de: string;
    mapa: ReadonlyMap<string, LinhaDaNotaDoAviso>;
  } | null>(null);
  const [volta, setVolta] = useState(0);
  useAoVoltarParaOApp(() => setVolta((v) => v + 1));

  // O minuto: só com avisos de anotação e com a aba à vista (escondida, quem
  // relê é a volta para o app).
  const [tique, setTique] = useState(0);
  useEffect(() => {
    if (!chave) return;
    const relogio = setInterval(() => {
      if (document.visibilityState === "visible") setTique((n) => n + 1);
    }, RELEITURA_DAS_NOTAS_MS);
    return () => clearInterval(relogio);
  }, [chave]);

  // `avisos`, `volta` e `tique` não entram no corpo: são os gatilhos da RELEITURA.
  useEffect(() => {
    if (!chave) return;
    let vivo = true;
    void createClient()
      .from("cb_conversation_notes")
      .select(COLUNAS_DA_NOTA_DO_AVISO)
      .in("id", chave.split(","))
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) {
          // "Não sei": o aviso fica como era, sem afirmar nada.
          console.warn("[avisos] não deu para ler as anotações:", error.message);
          return;
        }
        const linhas = (data ?? []) as LinhaDaNotaDoAviso[];
        setLida({ de: chave, mapa: new Map(linhas.map((l) => [l.id, l])) });
      });
    return () => {
      vivo = false;
    };
  }, [chave, avisos, volta, tique]);

  if (!chave) return VAZIO;
  return lida && lida.de === chave ? lida.mapa : null;
}

/** De quanto em quanto a aba à vista relê as anotações dos avisos. */
export const RELEITURA_DAS_NOTAS_MS = 60_000;

const VAZIO: ReadonlyMap<string, LinhaDaNotaDoAviso> = new Map();
