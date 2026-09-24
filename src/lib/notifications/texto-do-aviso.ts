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
};

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
