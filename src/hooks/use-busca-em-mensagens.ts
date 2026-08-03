"use client";

// ============================================================
// A metade da busca que mora no banco (RPC `cb_buscar_conversas_por_texto`,
// migration 929).
//
// A outra metade — nome, telefone, grupo, última mensagem — continua sendo
// resolvida em JS sobre a lista carregada, em `src/lib/inbox/filtros.ts`. As
// duas se somam com um OU.
//
// ⚠️ POR QUE O CONJUNTO É SEMPRE COMPLETO, E NUNCA UMA PÁGINA
// Porque o painel de filtros recorta a lista INTEIRA, em JS. Se esta busca
// devolvesse "as 50 primeiras", um filtro enxergaria 64 conversas e o outro
// enxergaria 50 — e o resultado da combinação seria errado sem dar erro. A RPC
// devolve uma linha por conversa (não por mensagem), então o conjunto completo
// é barato: o teto é o número de conversas da conta.
// ============================================================

import { useEffect, useRef, useState } from "react";

import {
  montarAchados,
  SEM_ACHADOS,
  termoBuscavel,
  type AchadosNoTexto,
  type LinhaDaBusca,
} from "@/lib/inbox/busca-em-mensagens";
import { createClient } from "@/lib/supabase/client";

/**
 * Quanto tempo parado antes de perguntar ao banco.
 *
 * Digitar "contrato" dispararia oito consultas sem isto. 300 ms é o intervalo
 * em que a pessoa ainda está digitando a mesma palavra.
 */
const ESPERA_MS = 300;

export interface BuscaEmMensagens {
  achados: AchadosNoTexto;
  /** Há consulta em curso — a lista pode crescer em seguida. */
  buscando: boolean;
  /**
   * A consulta falhou.
   *
   * ⚠️ Precisa chegar à tela. Sem aviso, a busca no corpo simplesmente para de
   * achar, e o resultado — só o que casa por nome — tem exatamente a cara de um
   * resultado legítimo. O operador concluiria que aquela mensagem não existe.
   */
  falhou: boolean;
}

export function useBuscaEmMensagens(busca: string): BuscaEmMensagens {
  const [achados, setAchados] = useState<AchadosNoTexto>(SEM_ACHADOS);
  const [buscando, setBuscando] = useState(false);
  const [falhou, setFalhou] = useState(false);

  // ⚠️ Contador de geração, e não um sinalizador de "cancelado". Digitar rápido
  // deixa várias consultas no ar ao mesmo tempo, e elas NÃO voltam em ordem: a
  // resposta de "con" pode chegar depois da de "contrato" e sobrescrever o
  // resultado certo por um mais largo. Só a geração mais recente pode escrever.
  const geracaoRef = useRef(0);

  useEffect(() => {
    // Bombardeia a geração ANTES da guarda: apagar a caixa também tem de
    // invalidar a resposta que ainda está voltando do banco.
    geracaoRef.current += 1;
    const geracao = geracaoRef.current;

    // ⚠️ Termo curto não zera estado aqui — quem zera é a derivação no fim
    // deste arquivo. Escrever estado direto no corpo do efeito é justamente o
    // que o React Compiler recusa (renderização em cascata), e o resultado
    // seria o mesmo com um render a mais.
    if (!termoBuscavel(busca)) return;

    const perguntar = async () => {
      setBuscando(true);
      const supabase = createClient();
      const { data, error } = await supabase.rpc(
        "cb_buscar_conversas_por_texto",
        { p_termo: busca },
      );

      // ⚠️ Resposta velha para aqui, e de propósito ela NÃO desliga o
      // `buscando`. Lido isolado isso parece esquecimento; não é: quem manda na
      // tela é a derivação no fim do arquivo, e a consulta seguinte reescreve o
      // valor. Desligar aqui apagaria o "buscando" da consulta que ainda está
      // em curso.
      if (geracao !== geracaoRef.current) return;

      if (error) {
        // Erro do Supabase tem propriedades não-enumeráveis: sem listar os
        // campos, o console mostra `{}`.
        console.error("Falha ao buscar no corpo das mensagens:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setFalhou(true);
        setAchados(SEM_ACHADOS);
        setBuscando(false);
        return;
      }

      setFalhou(false);
      setAchados(montarAchados(data as LinhaDaBusca[] | null));
      setBuscando(false);
    };

    // ⚠️ Entre uma letra e a resposta seguinte, a lista mostra o resultado do
    // termo ANTERIOR. Digitando "contrato" → "contratos", por ~350 ms
    // aparecem conversas que casam só com o termo curto. É deliberado: limpar
    // a cada tecla faria as linhas PISCAREM para fora e para dentro a cada
    // letra digitada, que é muito pior de usar. O aviso "buscando" é o que
    // conta ao operador que a lista ainda vai assentar.
    const timer = setTimeout(() => {
      void perguntar();
    }, ESPERA_MS);

    return () => clearTimeout(timer);
  }, [busca]);

  // ⚠️ O estado guardado é o da ÚLTIMA consulta que voltou; o que a tela vê é
  // derivado do termo de AGORA. Sem isto, apagar a caixa até sobrar "co"
  // deixaria as conversas achadas por "contrato" na lista, sem nada explicando
  // por que elas estão ali.
  const vale = termoBuscavel(busca);

  return {
    achados: vale ? achados : SEM_ACHADOS,
    buscando: vale && buscando,
    falhou: vale && falhou,
  };
}
