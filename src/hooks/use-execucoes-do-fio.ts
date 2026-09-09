"use client";

// ============================================================
// As execuções de automação que TERMINARAM para este contato (985).
//
// Irmão do `useExecucoesDoContato`, e a divisão é por PERGUNTA: aquele
// responde "o que está rodando agora?" (robô ativo + fila de esperas, uma
// delas por rota porque a tabela é service-role only); este responde "o que
// já terminou, e como?" — que é o que o fio narra.
//
// Lê `automation_logs` DIRETO sob RLS: a policy `automation_logs_select`
// (017) é `is_account_member(account_id)`, então qualquer membro da conta lê,
// sem rota nova. É a mesma decisão da trilha do lead (912), que já é
// intercalada no fio pelo mesmo caminho.
//
// ⚠️ Estado velho de efeito passivo (mordeu 4× neste projeto): o resultado é
// CARIMBADO com o contactId de origem e comparado contra o prop do render
// atual. Dado do cliente anterior nunca é devolvido — nem na janela entre a
// troca de conversa e a chegada do fetch, que é justamente onde o defeito
// aparece. Nada de "limpar num efeito", que o lint do React Compiler recusa e
// que deixa um render com a resposta errada.
//
// ⚠️ SEM realtime: `automation_logs` não está na publicação. Uma falha que
// aconteça com a conversa aberta e parada na tela só aparece no próximo
// resync (voltar à aba, reconexão) ou quando o `cb:execucoes-mudaram` avisa.
// Publicar a tabela seria mexer na publicação do upstream para ganhar
// segundos num evento raro.
// ============================================================

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  itensDoFio,
  type ExecucaoEncerrada,
  type ItemDeExecucao,
} from "@/lib/execucoes/desfecho";
import { EVENTO_EXECUCOES } from "./use-execucoes-do-contato";
import type { AutomationLogDesfecho, AutomationLogStepResult } from "@/types";

/** Quantas linhas encerradas buscar. O colapso e o teto vêm depois, na régua. */
const LIMITE_DE_LINHAS = 60;

interface Resultado {
  /** Já colapsadas e com teto — prontas para o `intercalar`. */
  itens: ItemDeExecucao[];
  /** true depois que a consulta DESTE contato aterrissou. */
  carregou: boolean;
  /** true quando a leitura falhou — a tela avisa em vez de dizer "nada". */
  erro: boolean;
}

interface Dados {
  contactId: string;
  itens: ItemDeExecucao[];
  erro: boolean;
}

interface LinhaDeLog {
  id: string;
  automation_id: string;
  desfecho: AutomationLogDesfecho | null;
  finalizado_em: string | null;
  error_message: string | null;
  steps_executed: AutomationLogStepResult[] | null;
  automations: { name: string | null } | { name: string | null }[] | null;
}

function mapear(linha: LinhaDeLog): ExecucaoEncerrada {
  const embed = Array.isArray(linha.automations) ? linha.automations[0] : linha.automations;
  return {
    id: linha.id,
    automationId: linha.automation_id,
    // `null` quando a automação foi apagada depois de rodar — a tela mostra um
    // rótulo genérico em vez do UUID, que o operador leria como se fosse nome.
    nomeDaAutomacao: embed?.name ?? null,
    desfecho: linha.desfecho,
    finalizadoEm: linha.finalizado_em,
    errorMessage: linha.error_message,
    stepsExecuted: linha.steps_executed,
  };
}

const SEM_ITENS: ItemDeExecucao[] = [];

export function useExecucoesDoFio(contactId: string | null | undefined): Resultado {
  const [dados, setDados] = useState<Dados | null>(null);
  const [nonce, setNonce] = useState(0);

  // Mesmo evento global do hook irmão: quem executa uma automação pelo menu +
  // do compositor vive noutra árvore, e depois de rodar há execução nova para
  // ler. Um listener por hook é mais barato que fiar callback pela página.
  useEffect(() => {
    const aoMudar = () => setNonce((n) => n + 1);
    window.addEventListener(EVENTO_EXECUCOES, aoMudar);
    return () => window.removeEventListener(EVENTO_EXECUCOES, aoMudar);
  }, []);

  useEffect(() => {
    if (!contactId) return;
    const supabase = createClient();
    let cancelado = false;

    void (async () => {
      const { data, error } = await supabase
        .from("automation_logs")
        .select(
          "id, automation_id, desfecho, finalizado_em, error_message, steps_executed, automations(name)",
        )
        .eq("contact_id", contactId)
        // ⚠️ Só o que TERMINOU. Sem este recorte vêm as execuções em curso, que
        // carregam o `status: 'failed'` semeado no INSERT — e a régua as
        // descartaria de qualquer forma, mas aqui isso já economiza a viagem.
        .not("finalizado_em", "is", null)
        .order("finalizado_em", { ascending: false })
        .limit(LIMITE_DE_LINHAS);

      if (cancelado) return;

      if (error) {
        console.error("[execucoes-do-fio] leitura falhou:", error.message);
        setDados({ contactId, itens: SEM_ITENS, erro: true });
        return;
      }

      const linhas = ((data ?? []) as unknown as LinhaDeLog[]).map(mapear);
      setDados({ contactId, itens: itensDoFio(linhas), erro: false });
    })();

    return () => {
      cancelado = true;
    };
  }, [contactId, nonce]);

  const atual = dados !== null && dados.contactId === contactId ? dados : null;

  return {
    itens: atual?.itens ?? SEM_ITENS,
    carregou: atual !== null,
    erro: atual?.erro ?? false,
  };
}
