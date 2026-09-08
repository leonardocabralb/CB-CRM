"use client";

// ============================================================
// /reset-password — onde a pessoa digita a senha nova.
//
// Chega-se aqui por `/auth/callback?next=/reset-password`, que já trocou
// o `code` do e-mail por uma sessão em cookie. Ou seja: quem abre esta
// tela ESTÁ autenticado, e `updateUser({ password })` basta — não há
// token para carregar daqui.
//
// ⚠️ Ela e o `/auth/callback` nasceram juntos, no mesmo PR. A tela de
// "esqueci a senha" apontava para as duas desde o upstream e nenhuma
// existia: o link do e-mail caía em 404. Quem apagar uma apaga a outra,
// ou o produto volta a não ter recuperação de senha.
//
// ⚠️ Sem sessão isto NÃO é erro de digitação — é link vencido, já usado
// ou aberto noutro navegador. O texto diz isso e oferece pedir outro, em
// vez de um "não autorizado" que não sugere saída nenhuma.
// ============================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { KeyRound, ShieldAlert } from "lucide-react";

/** Mesmo piso do cadastro (`SignupPage.passwordPlaceholder`). */
const MINIMO = 6;

type Sessao = "conferindo" | "valida" | "ausente";

export default function ResetPasswordPage() {
  const t = useTranslations("ResetPasswordPage");
  const router = useRouter();
  const [sessao, setSessao] = useState<Sessao>("conferindo");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!vivo) return;
        setSessao(data.user ? "valida" : "ausente");
      })
      .catch(() => {
        if (vivo) setSessao("ausente");
      });
    return () => {
      vivo = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);

    if (senha.length < MINIMO) {
      setErro(t("tooShort", { min: MINIMO }));
      return;
    }
    if (senha !== confirmacao) {
      setErro(t("mismatch"));
      return;
    }

    setSalvando(true);
    const { error } = await createClient().auth.updateUser({ password: senha });
    if (error) {
      setErro(error.message);
      setSalvando(false);
      return;
    }

    // `replace`, não `push`: voltar para esta tela depois de trocar a
    // senha não faz nada de útil e o formulário ficaria com a senha nova
    // no estado do histórico.
    router.replace("/dashboard");
  };

  if (sessao === "conferindo") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">{t("checking")}</p>
      </div>
    );
  }

  if (sessao === "ausente") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md border-border bg-card">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <ShieldAlert className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl text-foreground">
              {t("invalidTitle")}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {t("invalidDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/forgot-password">
              <Button className="h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90">
                {t("requestNew")}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl text-foreground">{t("title")}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {erro && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {erro}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="senha" className="text-muted-foreground">
                {t("passwordLabel")}
              </Label>
              <Input
                id="senha"
                type="password"
                autoComplete="new-password"
                placeholder={t("passwordPlaceholder", { min: MINIMO })}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmacao" className="text-muted-foreground">
                {t("confirmLabel")}
              </Label>
              <Input
                id="confirmacao"
                type="password"
                autoComplete="new-password"
                placeholder={t("confirmPlaceholder")}
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <Button
              type="submit"
              disabled={salvando}
              className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {salvando ? t("saving") : t("submitButton")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
