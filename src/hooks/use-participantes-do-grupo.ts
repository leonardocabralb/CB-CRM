"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  lerRespostaDosParticipantes,
  type RespostaDosParticipantes,
} from "@/lib/cb-groups/participantes-na-tela";
import type { CbGroup } from "@/types";

/** Por que a leitura falhou: a tela escreve uma frase para cada um. */
export type FalhaDosParticipantes = "sem_conexao" | "indisponivel";

interface Leitura {
  de: string | null;
  dados: RespostaDosParticipantes | null;
  falha: FalhaDosParticipantes | null;
}

/**
 * Por quanto tempo a última leitura boa de um grupo é reaproveitada. O painel
 * fica MONTADO mesmo fechado (no celular sai da tela; no desktop, largura
 * zero): sem isto, cada abertura de grupo — e cada ida e volta A → B → A —
 * custaria um `findGroupInfos` na mesma instância que atende o escritório.
 */
const VALIDADE_DA_LEITURA_MS = 3 * 60_000;

/** A última leitura boa por grupo, nesta aba. O "Tentar de novo" passa por cima. */
const leiturasRecentes = new Map<string, { em: number; dados: RespostaDosParticipantes }>();

/**
 * Quem está no grupo, lido AO VIVO pela rota (`findGroupInfos`, ~0,8 s) quando
 * o painel mostra um grupo sem leitura dos últimos 3 min — e sempre no
 * "Tentar de novo". A mesma leitura diz se o renomear vale (`podeRenomear`) e
 * atualiza o espelho do grupo.
 *
 * ⚠️ Guarda `{ de, dados }` e DERIVA `carregando` de `de !== grupoId`: o
 * painel não remonta na troca de conversa, e entre a troca e a resposta há um
 * render com o grupo NOVO e a lista do ANTERIOR.
 *
 * ⚠️ `onGrupoAtualizado` da página aplica o patch na conversa ABERTA, não pelo
 * id do grupo: a resposta de A que pousa entre a troca e a limpeza do efeito
 * (passivo) gravaria a contagem de A em B. Por isso a conferência pelo grupo
 * NA TELA (`grupoNaTelaRef`, efeito de LAYOUT, que roda no commit).
 */
export function useParticipantesDoGrupo(
  grupoId: string | null | undefined,
  onGrupoAtualizado?: (patch: Partial<CbGroup>) => void,
): {
  dados: RespostaDosParticipantes | null;
  carregando: boolean;
  falha: FalhaDosParticipantes | null;
  recarregar: () => void;
} {
  const [leitura, setLeitura] = useState<Leitura>({ de: null, dados: null, falha: null });
  const [nonce, setNonce] = useState(0);
  // O "Tentar de novo" vai ao WhatsApp mesmo com leitura recente guardada.
  const forcarRef = useRef(false);
  const recarregar = useCallback(() => {
    forcarRef.current = true;
    setNonce((n) => n + 1);
  }, []);

  const grupoNaTelaRef = useRef(grupoId ?? null);
  const aoAtualizarRef = useRef(onGrupoAtualizado);
  useLayoutEffect(() => {
    grupoNaTelaRef.current = grupoId ?? null;
    aoAtualizarRef.current = onGrupoAtualizado;
  });

  useEffect(() => {
    if (!grupoId) return;
    let vivo = true;
    const forcar = forcarRef.current;
    forcarRef.current = false;
    void (async () => {
      // Leitura recente deste grupo: mostra sem ir ao WhatsApp. O patch do
      // grupo NÃO é reaplicado — a página já o recebeu, e um renomear feito
      // depois voltaria ao nome velho.
      const guardada = forcar ? undefined : leiturasRecentes.get(grupoId);
      if (guardada && Date.now() - guardada.em < VALIDADE_DA_LEITURA_MS) {
        setLeitura({ de: grupoId, dados: guardada.dados, falha: null });
        return;
      }
      // O "Tentar de novo" mostra a carga de novo (e não a falha velha).
      setLeitura((l) => (l.de === grupoId ? { de: null, dados: null, falha: null } : l));
      const res = await fetch(`/api/cb/groups/${grupoId}/participantes`, { cache: "no-store" }).catch(
        () => null,
      );
      if (!vivo) return;
      const json = res ? await res.json().catch(() => null) : null;
      if (!vivo) return;
      const lida = res?.ok ? lerRespostaDosParticipantes(json) : null;
      if (!lida) {
        const semConexao = (json as { code?: unknown } | null)?.code === "SEM_CONEXAO";
        setLeitura({ de: grupoId, dados: null, falha: semConexao ? "sem_conexao" : "indisponivel" });
        return;
      }
      leiturasRecentes.set(grupoId, { em: Date.now(), dados: lida });
      setLeitura({ de: grupoId, dados: lida, falha: null });
      if (lida.grupo && lida.grupo.id === grupoId && grupoNaTelaRef.current === grupoId) {
        aoAtualizarRef.current?.(lida.grupo);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [grupoId, nonce]);

  const desteGrupo = !!grupoId && leitura.de === grupoId;
  return {
    dados: desteGrupo ? leitura.dados : null,
    carregando: !!grupoId && !desteGrupo,
    falha: desteGrupo ? leitura.falha : null,
    recarregar,
  };
}
