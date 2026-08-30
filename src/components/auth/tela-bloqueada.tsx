"use client";

// ============================================================
// TelaBloqueada — o que aparece no lugar de uma página fora do perfil.
//
// Renderizada pelo DashboardShell quando `telaDoCaminho(pathname)` resolve
// para uma tela que `podeVerTela` nega. NUNCA um 404: quem digitou /pipelines
// na barra tem de entender que a página existe e não faz parte do perfil
// dele — 404 mandaria a pessoa reportar "o sistema quebrou" ao administrador,
// que é justamente quem configurou o recorte.
//
// ⚠️ Texto amigável É a decisão do operador (2026-08-30): notificação e busca
// podem apontar para conversa fora do escopo, e o clique cai aqui. A
// mensagem diz o que houve e com quem falar, sem tom de erro.
//
// O botão leva à PRIMEIRA tela permitida na ordem do catálogo — para o
// Advogado de fábrica é a Caixa de entrada. `settings` é o último recurso
// garantido (TELAS_SEMPRE_VISIVEIS), então o find() nunca fica vazio de
// verdade; o fallback "/settings" existe só para o TypeScript.
// ============================================================

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { ROTA_DA_TELA, TODAS_AS_TELAS } from "@/lib/perfis/catalogo";
import { podeVerTela } from "@/lib/perfis/visibilidade";

export function TelaBloqueada() {
  const t = useTranslations("TelaBloqueada");
  const { acesso } = useAuth();

  const primeiraPermitida = TODAS_AS_TELAS.find((tela) =>
    podeVerTela(acesso, tela),
  );
  const destino = primeiraPermitida
    ? ROTA_DA_TELA[primeiraPermitida]
    : "/settings";

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
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
          <Link href={destino}>
            <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
              {t("cta")}
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
