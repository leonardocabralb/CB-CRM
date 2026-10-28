import type { Notification } from "@/types";
import { nomeDoContato, type ContatoIdentificavel } from "@/lib/contacts/identidade";

// ============================================================
// O texto de um aviso na página de Notificações (Fase 10 do plano do merge
// do upstream).
//
// ⚠️ O aviso de ATRIBUIÇÃO nasce no gatilho da 0027 (do original), que grava
// título e corpo em INGLÊS na linha — "New conversation assigned", "Fulana
// assigned you a conversation with …" — e a página os mostrava crus. O banco
// não sabe o idioma de quem instala, então o texto sai daqui, pelo TIPO, com
// o nome de quem atribuiu e o do contato (a coluna `body` ainda saía
// "…with ." quando o contato não tinha nome). Os avisos NOSSOS (menção em
// anotação, tarefas) já gravam o texto em português e passam como estão.
// Tradutor amarrado a `NotificationsPage.tipos`; as chaves são conferidas nos
// dois dicionários pelo teste.
// ============================================================

export type AvisoComContato = Notification & {
  contact?: ContatoIdentificavel | null;
  /**
   * A conversa do aviso, só pelo nome do GRUPO (`cb_groups.subject`): aviso de
   * anotação em grupo nasce sem contato (grupo não é contato).
   */
  conversation?: { group?: { subject?: string | null } | null } | null;
};

/**
 * O embed que dá nome ao CLIENTE do aviso, na mesma forma no sino e no Meu dia.
 * ⚠️ Os dois `@` vão junto do telefone (pino `identidade-nos-embeds.test.ts`):
 * sem eles, a ficha só-BSUID cairia no rótulo genérico.
 */
export const EMBED_DO_CLIENTE_DO_AVISO =
  "contact:contacts(name, phone, wa_username, instagram_username), conversation:conversations(group:cb_groups(subject))";

/** De quem é o aviso: o cliente (ficha) ou o grupo da conversa. */
export interface ClienteDoAviso {
  tipo: "contato" | "grupo";
  nome: string;
}

/**
 * O cliente a mostrar na linha do aviso (pedido do operador, 28/10/2026: "em
 * qual cliente foi feita aquela modificação"). `null` quando não há o que
 * dizer: o aviso de atribuição já traz o contato no corpo, o de saúde do
 * WhatsApp não é de cliente, e o aviso sem ficha nem grupo legível não ganha
 * nome inventado.
 */
export function clienteDoAviso(aviso: AvisoComContato): ClienteDoAviso | null {
  if (aviso.type === "conversation_assigned" || aviso.type === "whatsapp_alert") return null;
  if (aviso.contact) {
    const nome = nomeDoContato(aviso.contact, "");
    return nome ? { tipo: "contato", nome } : null;
  }
  const grupo = aviso.conversation?.group?.subject?.trim();
  return grupo ? { tipo: "grupo", nome: grupo } : null;
}

export interface TextoDoAviso {
  titulo: string;
  corpo: string | null;
}

export function textoDoAviso(
  aviso: AvisoComContato,
  /** O nome de quem atribuiu, quando se sabe; `null` = não se sabe. */
  nomeDoAutor: string | null,
  t: (chave: string, valores?: Record<string, string>) => string,
): TextoDoAviso {
  switch (aviso.type) {
    case "conversation_assigned": {
      const contato = nomeDoContato(aviso.contact, t("atribuida.contatoSemNome"));
      return {
        titulo: t("atribuida.titulo"),
        // Sem o nome (automação, quem saiu da conta, lista de membros que não
        // carregou), a frase fica na voz passiva: "uma automação atribuiu"
        // afirmaria o que não se sabe.
        corpo: nomeDoAutor
          ? t("atribuida.corpo", { autor: nomeDoAutor, contato })
          : t("atribuida.corpoSemAutor", { contato }),
      };
    }
    default:
      return { titulo: aviso.title, corpo: aviso.body ?? null };
  }
}
