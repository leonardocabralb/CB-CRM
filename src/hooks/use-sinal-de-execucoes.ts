"use client";

// ============================================================
// A marca "tem automação rodando" para a LISTA e para o QUADRO (985).
//
// Uma consulta por montagem, para a tela inteira — não por linha. Ver a rota
// `/api/cb/execucoes/resumo`.
//
// ⚠️ `null` enquanto não carregou, e não `{}`: os dois significariam coisas
// diferentes na tela. `{}` é "conferi, ninguém tem automação rodando"; `null`
// é "ainda não sei". Sem a distinção, a marca aparece piscando depois do
// primeiro render — e, pior, uma consulta que FALHA seria lida como "nada
// rodando", que é a armadilha do vazio-como-afirmação que este projeto
// documenta quatro vezes.
// ============================================================

import { useCallback, useEffect, useState } from "react";

import { lerResumo, type ResumoDeEsperas } from "@/lib/execucoes/espera-resumida";
import { EVENTO_EXECUCOES } from "./use-execucoes-do-contato";

export function useSinalDeExecucoes(
  ativo = true,
  /**
   * O token de resync de quem monta (a lista o incrementa ao voltar à aba e no
   * botão atualizar).
   *
   * ⚠️ Sem ele a marca só nascia na MONTAGEM: a `ConversationList` fica montada
   * por horas, então uma automação agendada depois disso não acendia o raio
   * até um recarregamento — e o inverso também, com o raio aceso o resto do
   * expediente depois de a fila esvaziar (achado da revisão, 09/09).
   */
  resyncToken?: number,
): {
  resumo: ResumoDeEsperas | null;
  recarregar: () => void;
} {
  const [resumo, setResumo] = useState<ResumoDeEsperas | null>(null);
  const [nonce, setNonce] = useState(0);

  const recarregar = useCallback(() => setNonce((n) => n + 1), []);

  // Parar/executar automação muda a fila, e quem faz isso vive noutra árvore
  // (a aba do painel, o dialog do compositor). O mesmo evento global dos
  // hooks irmãos.
  useEffect(() => {
    const aoMudar = () => setNonce((n) => n + 1);
    window.addEventListener(EVENTO_EXECUCOES, aoMudar);
    return () => window.removeEventListener(EVENTO_EXECUCOES, aoMudar);
  }, []);

  useEffect(() => {
    if (!ativo) return;
    let cancelado = false;

    void (async () => {
      const res = await fetch("/api/cb/execucoes/resumo", { cache: "no-store" }).catch(
        () => null,
      );
      if (cancelado) return;
      if (!res?.ok) {
        // Falha de rede ou 500: continua "não sei". A marca não aparece, e
        // nada na tela afirma que o cliente está sem automação.
        setResumo(null);
        return;
      }
      const json = await res.json().catch(() => null);
      if (cancelado) return;
      setResumo(lerResumo(json));
    })();

    return () => {
      cancelado = true;
    };
  }, [ativo, nonce, resyncToken]);

  return { resumo, recarregar };
}
