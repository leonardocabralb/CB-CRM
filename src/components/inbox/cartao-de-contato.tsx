"use client";

// ============================================================
// Cartão de contato na bolha (1060).
//
// Nome, empresa e telefones do contato que alguém compartilhou, com dois
// botões por telefone: copiar o número e "Conversar", que abre a "Nova
// conversa" com o número já preenchido (pedido do operador, 28/09/2026 — no
// caso que originou tudo, o cliente mandou o contato da assessoria que o
// cobrava, e o escritório precisava falar com ela).
//
// "Conversar" segue o WhatsApp: só aparece para o número que USA WhatsApp
// (o cartão traz o `waid`) — e só para quem pode enviar mensagem (o diálogo
// cria a conversa; o `viewer` não pode).
// ============================================================

import { useState } from "react";
import { Check, Copy, MessageSquarePlus, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import type { Message } from "@/types";
import { useCan } from "@/hooks/use-can";
import { pedirConversaComContato } from "@/lib/inbox/conversar-com-contato";
import {
  lerContatosGravados,
  numeroParaConversar,
  type ContatoCompartilhado,
  type TelefoneDoCartao,
} from "@/lib/whatsapp/cartao-de-contato";
import { FormattedText } from "./formatted-text";

/**
 * Botão sobre a bolha. O fundo claro translúcido se lê nos dois lados do fio
 * (a bolha do cliente é `bg-muted`; a da equipe, `bg-primary`) — é o mesmo
 * par do botão "toque para baixar" do anexo de grupo.
 */
const BOTAO =
  "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md bg-background/60 text-xs font-medium text-foreground hover:bg-background";

function LinhaDoTelefone({
  telefone,
  nome,
  podeConversar,
  t,
}: {
  telefone: TelefoneDoCartao;
  nome: string;
  podeConversar: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const [copiado, setCopiado] = useState(false);
  const numeroDoWhatsApp = numeroParaConversar(telefone);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(telefone.numero);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error(t("copiarFalhou"));
    }
  }

  return (
    <li className="flex items-center gap-1.5">
      <span className="min-w-0 flex-1 truncate text-sm tabular-nums" title={telefone.numero}>
        {telefone.numero}
      </span>
      <button
        type="button"
        onClick={copiar}
        aria-label={t("copiarNumero")}
        title={copiado ? t("numeroCopiado") : t("copiarNumero")}
        className={`${BOTAO} w-7`}
      >
        {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      {podeConversar && numeroDoWhatsApp && (
        <button
          type="button"
          onClick={() => pedirConversaComContato({ telefone: numeroDoWhatsApp, nome: nome || null })}
          title={t("conversarDica")}
          className={`${BOTAO} px-2`}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          {t("conversar")}
        </button>
      )}
    </li>
  );
}

function UmContato({
  contato,
  podeConversar,
  t,
}: {
  contato: ContatoCompartilhado;
  podeConversar: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const titulo = contato.nome || contato.telefones[0]?.numero || t("semNome");
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background/60 text-muted-foreground">
          <UserRound className="h-5 w-5" />
        </span>
        {/* `min-w-0` para o `truncate` valer dentro do flex. */}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" title={titulo}>
            {titulo}
          </p>
          {contato.empresa && (
            <p className="truncate text-xs opacity-80" title={contato.empresa}>
              {contato.empresa}
            </p>
          )}
        </div>
      </div>
      {contato.telefones.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {contato.telefones.map((telefone, i) => (
            <LinhaDoTelefone
              key={`${telefone.numero}-${i}`}
              telefone={telefone}
              nome={contato.nome}
              podeConversar={podeConversar}
              t={t}
            />
          ))}
        </ul>
      ) : (
        <p className="text-xs opacity-80">{t("semTelefone")}</p>
      )}
    </div>
  );
}

export function CartaoDeContato({ message }: { message: Message }) {
  const t = useTranslations("Inbox.cartaoDeContato");
  const podeConversar = useCan("send-messages");
  const contatos = lerContatosGravados(message.contatos);

  // Sem nada legível no JSON (cartão sem nome nem telefone, ou uma linha
  // gravada fora da forma): o resumo, se houver, senão o rótulo — nunca a
  // bolha vazia que esta migração existe para acabar.
  if (contatos.length === 0) {
    return <FormattedText texto={message.content_text || t("vazio")} />;
  }

  return (
    // Largura mínima para os botões caberem ao lado do número; o teto é o da
    // bolha (`max-w-full` lá).
    <div className="flex min-w-[13rem] flex-col gap-2">
      {contatos.length > 1 && (
        <p className="text-xs font-medium opacity-80">
          {t("varios", { total: contatos.length })}
        </p>
      )}
      {contatos.map((contato, i) => (
        <div key={i} className={i > 0 ? "border-t border-current/15 pt-2" : undefined}>
          <UmContato contato={contato} podeConversar={podeConversar} t={t} />
        </div>
      ))}
    </div>
  );
}
