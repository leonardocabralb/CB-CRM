"use client";

// ============================================================
// "Nova conversa" — o CRM puxando a conversa, em vez de só recebê-la.
//
// Até 2026-08-31 a conversa só existia depois de o cliente escrever, ou
// depois de alguém mandar mensagem pelo CELULAR pareado (e aí o CRM só
// ficava sabendo pelo eco do webhook). Abordar um cliente PELO sistema não
// tinha porta de entrada.
//
// ⚠️ ABRE, NÃO ENVIA. O diálogo cria/reencontra contato e conversa, fixa o
// canal e sai — quem escreve é o compositor de sempre. Duas razões: o
// primeiro texto merece o compositor inteiro (anexo, acervo, gravação,
// agendamento, modelo), e um campo de mensagem aqui seria uma segunda
// implementação de envio para manter em sincronia com aquele.
//
// ⚠️ E não cria negócio (decisão do operador, 2026-08-31). O card nasce no
// PRIMEIRO ENVIO, lá no núcleo (`routeContactToPipeline`). Aqui ele viraria
// lixo no funil a cada número digitado errado.
// ============================================================

import { useEffect, useState } from "react";
import { Loader2, MessageSquarePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ChannelSelect } from "@/components/channels/channel-select";
import type { CbChannel } from "@/lib/cb-channels/repo";

/**
 * Espelho da validação do servidor (`isValidE164` sobre os dígitos).
 *
 * ⚠️ O teto de 15 não é cosmético: a busca de contato casa pelos ÚLTIMOS 8
 * DÍGITOS com tolerância a prefixo de tronco, então um JID de grupo (~18
 * dígitos) colado aqui poderia FUNDIR com o celular de um cliente real. A
 * rota recusa de novo — isto é só para o operador ver o erro antes de
 * enviar.
 */
function telefoneValido(bruto: string): boolean {
  const digitos = bruto.replace(/\D/g, "");
  return /^[1-9]\d{6,14}$/.test(digitos);
}

export function NovaConversaDialog({
  open,
  onOpenChange,
  canais,
  onAberta,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Já recortados pelo perfil de quem está olhando — ver `canaisVisiveis`. */
  canais: CbChannel[];
  /** Recebe o id da conversa aberta; o pai recarrega a lista e navega até ela. */
  onAberta: (conversationId: string) => void;
}) {
  const t = useTranslations("Inbox.novaConversa");

  const [telefone, setTelefone] = useState("");
  const [nome, setNome] = useState("");
  const [canalId, setCanalId] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Conta de um número só: não há o que escolher. (O seletor continua
  // aparecendo, dizendo por qual número a conversa vai sair — numa conta com
  // Comercial e Jurídico essa é a informação que mais importa.)
  //
  // ⚠️ Escalar, não o array: `canais` vem de um `.filter()` no pai quando o
  // perfil tem recorte, e um array nas dependências reexecutaria o efeito a
  // cada render do inbox — que re-renderiza a cada mensagem que chega.
  const unicoCanalId = canais.length === 1 ? canais[0].id : null;

  // Zera o formulário a cada ABERTURA. Manter o número anterior faria a
  // segunda conversa nascer para o cliente da primeira se alguém desse Enter
  // por reflexo.
  useEffect(() => {
    if (!open) return;
    setTelefone("");
    setNome("");
  }, [open]);

  // O canal fica num efeito SEPARADO de propósito: a lista pode chegar
  // DEPOIS da abertura (o `useChannels` do pai é assíncrono), e num efeito
  // só essa chegada apagaria o telefone já digitado. Aqui ela só preenche o
  // seletor. Com 2+ canais `unicoCanalId` é sempre null, então este efeito
  // não reage à lista — apenas reseta a escolha quando o diálogo reabre.
  useEffect(() => {
    setCanalId(unicoCanalId);
  }, [open, unicoCanalId]);

  const numeroOk = telefoneValido(telefone);
  const podeAbrir = numeroOk && !!canalId && !enviando;

  async function abrir() {
    if (!podeAbrir) return;
    setEnviando(true);
    try {
      const res = await fetch("/api/cb/conversas/abrir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefone,
          channel_id: canalId,
          nome: nome.trim() || undefined,
        }),
      });

      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Cada código tem frase própria: "erro ao abrir conversa" mandaria o
        // operador tentar de novo o que nunca vai funcionar (número inválido)
        // ou desconfiar do número quando o problema é a conexão.
        const chave =
          {
            INVALID_PHONE: "erroTelefone",
            INVALID_CHANNEL: "erroCanal",
            CHANNEL_NOT_FOUND: "erroCanalSumiu",
          }[payload?.error as string] ?? "erroGenerico";
        toast.error(t(chave));
        return;
      }

      const id = payload?.conversation_id as string | undefined;
      if (!id) {
        toast.error(t("erroGenerico"));
        return;
      }

      // A conversa já existir é resultado NORMAL, não erro: o cliente já
      // falava com o escritório e o operador só não sabia. Dizer isso evita
      // que ele ache que criou duplicata ao ver histórico aparecer.
      toast.success(payload?.criou_contato ? t("abertaNova") : t("abertaExistente"));
      onOpenChange(false);
      onAberta(id);
    } catch {
      toast.error(t("erroGenerico"));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* ⚠️ `min-w-0` no filho DIRETO: o DialogContent é grid, item de grid
          nasce com `min-width: auto`, e a linha do canal tem `truncate` —
          sem isto o intrínseco vira a largura do texto inteiro numa linha e
          o diálogo atravessa a tela. */}
      <DialogContent className="sm:max-w-md">
        <div className="min-w-0 space-y-4">
          <DialogHeader>
            <DialogTitle>{t("titulo")}</DialogTitle>
            <DialogDescription>{t("descricao")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <label htmlFor="nc-telefone" className="text-sm font-medium">
              {t("telefone")}
            </label>
            <Input
              id="nc-telefone"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void abrir();
                }
              }}
              placeholder={t("telefonePlaceholder")}
              inputMode="tel"
              autoFocus
            />
            {/* Só depois de algo digitado: o campo vazio ao abrir não é erro. */}
            {telefone.trim().length > 0 && !numeroOk && (
              <p className="text-[11px] text-destructive">{t("telefoneInvalido")}</p>
            )}
            <p className="text-[11px] text-muted-foreground">{t("telefoneDica")}</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="nc-nome" className="text-sm font-medium">
              {t("nome")}
            </label>
            <Input
              id="nc-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder={t("nomePlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-sm font-medium">{t("canal")}</span>
            {canais.length === 0 ? (
              // Sem conexão não há por onde falar, e o botão desabilitado
              // sozinho não explicaria o motivo.
              <p className="text-[11px] text-destructive">{t("semCanal")}</p>
            ) : (
              <>
                <ChannelSelect
                  channels={canais}
                  value={canalId}
                  onChange={setCanalId}
                />
                <p className="text-[11px] text-muted-foreground">{t("canalDica")}</p>
              </>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={enviando}
            >
              {t("cancelar")}
            </Button>
            <Button onClick={() => void abrir()} disabled={!podeAbrir}>
              {enviando ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <MessageSquarePlus className="mr-2 h-4 w-4" />
              )}
              {t("abrir")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
