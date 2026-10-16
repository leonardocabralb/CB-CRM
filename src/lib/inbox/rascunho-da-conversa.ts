// ============================================================
// Rascunho POR CONVERSA, guardado neste navegador (pedido do operador,
// 15/10/2026: "como o WhatsApp faz").
//
// O compositor NÃO remonta na troca de conversa, e o texto que se escrevia
// para um cliente continuava na caixa quando se abria o próximo — pronto
// para sair para a pessoa errada. Agora cada conversa tem o seu rascunho:
// trocar mostra o da conversa aberta, e voltar devolve o que ficou.
//
// Sem banco, por decisão do operador: o rascunho mora no `localStorage`,
// por PESSOA (a chave leva o `user.id` do login — outra pessoa no mesmo
// navegador não vê) e por conversa. Some ao enviar (o campo esvazia) e,
// esquecido, vence em `DIAS_DO_RASCUNHO`.
//
// Este módulo é a regra pura, com o armazenamento INJETADO (o teste roda sem
// navegador). Quem o liga ao `window.localStorage` e ao React é
// `useRascunhoDaConversa` (`src/hooks/use-rascunho-da-conversa.ts`).
// ============================================================

export const PREFIXO_DO_RASCUNHO = "cb-rascunho:";

/** Rascunho esquecido por mais tempo que isto é apagado ao ser lido. */
export const DIAS_DO_RASCUNHO = 30;
const VALIDADE_MS = DIAS_DO_RASCUNHO * 24 * 60 * 60 * 1000;

export function chaveDoRascunho(userId: string, conversationId: string): string {
  return `${PREFIXO_DO_RASCUNHO}${userId}:${conversationId}`;
}

/** O pedaço do `Storage` que o repositório usa — `localStorage` ou um dublê. */
export type Armazenamento = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * O que vai para o armazenamento: o texto e QUANDO foi escrito (para vencer).
 * `null` = nada a guardar — o rascunho só de espaços também não fica.
 */
export function paraGuardar(texto: string, agora: number): string | null {
  if (texto.trim() === "") return null;
  return JSON.stringify({ t: texto, em: agora });
}

/**
 * Lê o que foi guardado. Ilegível, vencido ou de outro formato = sem
 * rascunho: um valor estranho na chave nunca vira texto na caixa.
 */
export function lerGuardado(bruto: string | null, agora: number): string {
  if (!bruto) return "";
  try {
    const v: unknown = JSON.parse(bruto);
    if (!v || typeof v !== "object") return "";
    const { t, em } = v as { t?: unknown; em?: unknown };
    if (typeof t !== "string" || typeof em !== "number") return "";
    if (agora - em > VALIDADE_MS) return "";
    return t;
  } catch {
    return "";
  }
}

/**
 * Apaga os rascunhos vencidos ou ilegíveis — a leitura só limpa a chave que
 * lê, e a conversa que nunca mais é aberta deixaria o dela para sempre.
 * Coleta antes de apagar: remover no meio do laço desloca os índices.
 */
export function varrerVencidos(
  armazenamento: Pick<Storage, "length" | "key" | "getItem" | "removeItem">,
  agora: number,
): number {
  const vencidas: string[] = [];
  for (let i = 0; i < armazenamento.length; i++) {
    const chave = armazenamento.key(i);
    if (!chave?.startsWith(PREFIXO_DO_RASCUNHO)) continue;
    if (lerGuardado(armazenamento.getItem(chave), agora) === "") vencidas.push(chave);
  }
  for (const chave of vencidas) armazenamento.removeItem(chave);
  return vencidas.length;
}

export type NovoTexto = string | ((atual: string) => string);

export interface RepositorioDeRascunhos {
  /** O rascunho da chave: o da memória desta aba, senão o guardado. */
  ler(chave: string): string;
  /**
   * Grava o rascunho da chave — na memória (o texto exato, com os espaços de
   * quem ainda digita) e no armazenamento. Avisa quem assina só quando muda.
   */
  escrever(chave: string, novo: NovoTexto, persistir?: boolean): void;
  /** Outra aba mudou a chave (`null` = limpou tudo): relê do armazenamento. */
  esquecer(chave: string | null): void;
}

/**
 * ⚠️ Armazenamento que LANÇA (navegação privada, cota cheia, bloqueado) não
 * derruba o compositor: o rascunho continua valendo na memória desta aba,
 * só não sobrevive a recarregar a página.
 */
export function criarRepositorio(
  armazenamento: () => Armazenamento | null,
  avisar: () => void,
  agora: () => number = Date.now,
): RepositorioDeRascunhos {
  const memoria = new Map<string, string>();

  function ler(chave: string): string {
    const naMemoria = memoria.get(chave);
    if (naMemoria !== undefined) return naMemoria;
    let bruto: string | null = null;
    try {
      bruto = armazenamento()?.getItem(chave) ?? null;
    } catch {
      bruto = null;
    }
    const texto = lerGuardado(bruto, agora());
    // Fica na memória: o `getSnapshot` do React relê a cada render, e o
    // vencimento não pode virar a resposta entre duas leituras seguidas.
    memoria.set(chave, texto);
    if (bruto && texto === "") {
      try {
        armazenamento()?.removeItem(chave);
      } catch {
        // Só a limpeza do vencido; a leitura já respondeu.
      }
    }
    return texto;
  }

  function escrever(chave: string, novo: NovoTexto, persistir = true): void {
    const atual = ler(chave);
    const texto = typeof novo === "function" ? novo(atual) : novo;
    if (texto === atual) return;
    memoria.set(chave, texto);
    if (persistir) {
      try {
        const guardar = paraGuardar(texto, agora());
        if (guardar === null) armazenamento()?.removeItem(chave);
        else armazenamento()?.setItem(chave, guardar);
      } catch {
        // Fica só na memória desta aba (ver o cabeçalho da função). ⚠️ E a
        // versão VELHA sai do armazenamento: com a cota cheia, o `setItem`
        // falha e ela ficaria lá — recarregar a página ressuscitaria um
        // rascunho que a pessoa já tinha mudado (Codex, PR #414).
        try {
          armazenamento()?.removeItem(chave);
        } catch {
          // Armazenamento inteiro fora: nada guardado, nada a ressuscitar.
        }
      }
    }
    avisar();
  }

  function esquecer(chave: string | null): void {
    if (chave === null) memoria.clear();
    else memoria.delete(chave);
    avisar();
  }

  return { ler, escrever, esquecer };
}
