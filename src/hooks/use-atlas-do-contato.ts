"use client";

import { useCallback, useEffect, useState } from "react";

import { EVENTO_ATLAS_MUDOU } from "@/lib/atlas/aviso";
import { leituraParaOContato, lerAtlasDoContato, type AtlasDoContato, type LeituraGuardada, type UltimaLeitura } from "@/lib/atlas/do-contato";

import { RECARGA_MS } from "./use-inadimplencia";

/**
 * O Atlas de UM contato (Fase 2, PR B) — a rota `/api/cb/atlas/contato/[contactId]`
 * (só banco). Chamado em três lugares, cada um com a sua instância: o fio (a
 * linha do Atlas na faixa), o painel da conversa (o botão e a aba) e a ficha
 * de /contatos. A troca de conversa faz duas leituras só de banco — de
 * propósito, para não mexer na página do inbox (arquivo do upstream).
 *
 * ⚠️ Guarda `{ de, dados }` e DERIVA `carregando` de `de !== contactId`
 * (`leituraParaOContato`, puro): o
 * fio e o painel não remontam ao trocar de cliente, e entre a troca e a
 * resposta existe um render com o contato NOVO e os dados do ANTERIOR — sem
 * o carimbo, a faixa diria "rescindido no Atlas" na conversa de outro
 * cliente. É a guarda de `useCobrancasDoContato`, o molde deste hook.
 *
 * ⚠️ Relê sozinho a cada 5 min com a aba visível, ao voltar à aba, no
 * `resyncToken` de quem monta e no evento `cb:atlas-mudou` (vincular e
 * desvincular na aba): a leitura periódica roda no servidor e não avisa
 * ninguém.
 */
export function useAtlasDoContato(
  contactId: string | null | undefined,
  /** O token de resync de quem monta (a ficha de /contatos não passa: remonta a cada abertura). */
  resyncToken: number = 0,
): {
  dados: AtlasDoContato | null;
  carregando: boolean;
  falhou: boolean;
  /**
   * O Atlas está conectado nesta CONTA? `null` = ainda não se sabe. É da
   * conta, não do contato: SOBREVIVE à troca de contato, e é o que deixa a
   * aba sumir de vez numa conta sem Atlas em vez de piscar a cada cliente.
   */
  conectado: boolean | null;
  /**
   * O resultado da ÚLTIMA leitura que voltou, de QUALQUER contato (`null` =
   * nenhuma ainda). Durante o `carregando` é a do contato ANTERIOR: é o que
   * deixa o painel manter a aba entre duas fichas vinculadas em vez de
   * piscá-la (`abaAtlasNoPainel`). Nunca serve para desenhar dado.
   */
  ultimaLeitura: UltimaLeitura;
  recarregar: () => void;
} {
  const [estado, setEstado] = useState<LeituraGuardada>({ de: null, dados: null, falhou: false });
  const [conectado, setConectado] = useState<boolean | null>(null);
  const [nonce, setNonce] = useState(0);
  const recarregar = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const aoMudar = () => setNonce((n) => n + 1);
    window.addEventListener(EVENTO_ATLAS_MUDOU, aoMudar);
    return () => window.removeEventListener(EVENTO_ATLAS_MUDOU, aoMudar);
  }, []);

  useEffect(() => {
    const tique = setInterval(() => {
      if (document.visibilityState === "visible") setNonce((n) => n + 1);
    }, RECARGA_MS);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") setNonce((n) => n + 1);
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      clearInterval(tique);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, []);

  useEffect(() => {
    if (!contactId) return;
    let vivo = true;
    void (async () => {
      const res = await fetch(`/api/cb/atlas/contato/${contactId}`, { cache: "no-store" }).catch(() => null);
      if (!vivo) return;
      if (!res?.ok) {
        setEstado({ de: contactId, dados: null, falhou: true });
        return;
      }
      const json = await res.json().catch(() => null);
      if (!vivo) return;
      const lido = lerAtlasDoContato(json);
      setEstado({ de: contactId, dados: lido, falhou: lido === null });
      if (lido) setConectado(lido.conectado);
    })();
    return () => {
      vivo = false;
    };
  }, [contactId, nonce, resyncToken]);

  return { ...leituraParaOContato(estado, contactId), conectado, recarregar };
}
