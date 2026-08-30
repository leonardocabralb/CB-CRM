"use client";

// ============================================================
// ConversaForaDaArea — o que aparece no lugar do fio quando a conversa
// selecionada está fora das conexões do perfil de quem olha.
//
// A LINHA da conversa aparece completa na lista (a busca acha conversa de
// outra área — decisão do operador, 2026-08-30); o que é barrado é ABRIR.
// Este cartão substitui o `<MessageThread>` inteiro no painel central, e
// substituir em vez de embrulhar é load-bearing: montar o MessageThread
// dispararia a busca das mensagens E o reset de não-lidas no servidor — a
// conversa de outra área seria marcada como lida por alguém que nem pode
// respondê-la.
//
// Chega-se aqui por três caminhos, todos legítimos: clique num resultado de
// busca, clique numa notificação (deep link ?conversation=) e URL colada.
// Por isso o texto explica em vez de negar — 404 ou tela vazia fariam a
// pessoa reportar defeito ao administrador, que é justamente quem configurou
// o recorte.
// ============================================================

import { useTranslations } from "next-intl";
import { ArrowLeft, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ConversaForaDaArea({ onBack }: { onBack: () => void }) {
  const t = useTranslations("ConversaForaDaArea");

  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
            <ShieldAlert className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle className="text-xl text-foreground">
            {t("title")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("body")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={onBack}
            className="w-full border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {t("back")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
