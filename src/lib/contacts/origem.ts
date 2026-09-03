// ============================================================
// Origem do contato — o bloco fixo no topo da aba Histórico (pedido do
// operador, 2026-09-03, inspirado no "Outras informações" do Chatguru:
// data de cadastro e aparelho de origem).
//
// Aqui não há "aparelho": o equivalente nosso é a CONEXÃO por onde correu a
// primeira mensagem da conversa, mais QUEM a mandou. Tudo é DERIVADO — não
// existe coluna de origem, e não deve existir: `contacts.created_at` já diz
// quando a ficha nasceu e a primeira linha de `messages` diz o resto.
//
// ⚠️ O canal pode não resolver, e isso é dado, não defeito: 117 conversas
// são anteriores ao multi-canal (carimbo nulo) e conexão apagada anula o
// `channel_id` das mensagens. Nos dois casos a resposta é "não se sabe",
// nunca o canal padrão da conta (seria inventar).
//
// Puro, para o teste: quem chama passa a primeira mensagem já buscada e um
// resolvedor de nome de canal.
// ============================================================

export interface PrimeiraMensagem {
  created_at: string;
  channel_id?: string | null;
  sender_type: "customer" | "agent" | "bot";
  from_device?: boolean | null;
}

/**
 * Quem abriu a conversa. `equipe_celular` é o celular pareado
 * (`from_device`, sem usuário do CRM por trás — a régua do Radar); `robo`
 * cobre fluxo, automação, broadcast e IA, que saem como `bot`.
 */
export type QuemFalouPrimeiro =
  | "cliente"
  | "equipe_crm"
  | "equipe_celular"
  | "robo";

export interface OrigemDoContato {
  cadastradoEm: string;
  /** `null` = a conversa ainda não tem mensagem. */
  primeiraMensagemEm: string | null;
  /** `null` = sem carimbo ou conexão apagada; `nome` nulo = id sem catálogo. */
  canal: { id: string; nome: string | null } | null;
  quemFalouPrimeiro: QuemFalouPrimeiro | null;
}

export function origemDoContato(
  contato: { created_at: string },
  primeira: PrimeiraMensagem | null,
  nomeDoCanal: (id: string) => string | null,
): OrigemDoContato {
  if (!primeira) {
    return {
      cadastradoEm: contato.created_at,
      primeiraMensagemEm: null,
      canal: null,
      quemFalouPrimeiro: null,
    };
  }
  return {
    cadastradoEm: contato.created_at,
    primeiraMensagemEm: primeira.created_at,
    canal: primeira.channel_id
      ? { id: primeira.channel_id, nome: nomeDoCanal(primeira.channel_id) }
      : null,
    quemFalouPrimeiro:
      primeira.sender_type === "customer"
        ? "cliente"
        : primeira.sender_type === "agent"
          ? primeira.from_device
            ? "equipe_celular"
            : "equipe_crm"
          : "robo",
  };
}
