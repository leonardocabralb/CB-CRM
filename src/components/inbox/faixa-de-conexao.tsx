"use client";

// ============================================================
// A conexão desta conversa está fora do ar (ou surda) — dito COLADO no
// compositor, o último lugar por onde o olho passa antes de digitar.
// Decisão do operador (05/10/2026): o glifo vermelho do cabeçalho é pequeno
// e longe de onde se escreve, e a Bancário - Comercial caiu sem ninguém ver.
//
// A regra (qual estado acende qual faixa) é de `aviso-da-conexao.ts`; aqui só
// o desenho:
//
//  · VERMELHA, de fundo cheio: fora do ar. O compositor logo abaixo está
//    TRAVADO, e a frase diz por quê e qual é a saída — sem isso a pessoa
//    acharia que o CRM quebrou.
//  · ÂMBAR, o mesmo desenho da faixa de número divergente: de pé e enviando,
//    mas a entrada surda ou atrasada. Só avisa.
//
// ⚠️ Fundo `bg-red-600` com texto branco vale nos DOIS modos (o `dark:` está
// inerte, `.claude/rules/ui.md`). No âmbar, `text-amber-700`, a cor que passa
// nos dois (a mesma da faixa de número divergente).
//
// ⚠️ `min-h-0 overflow-y-auto` nas duas: no celular com o teclado aberto (a
// anotação interna segue livre durante a queda) o fio já está em zero, e a
// faixa de várias linhas tem de CEDER — rolar —, senão empurra o compositor
// para fora da casca (a armadilha do #360, `inbox-conversa.md`).
// ============================================================

import { TriangleAlert, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";

import type { AvisoDaConexao } from "@/lib/inbox/aviso-da-conexao";

export function FaixaDeConexao({
  aviso,
  podeTrocarNumero,
}: {
  aviso: AvisoDaConexao | null;
  /**
   * O seletor de número do cabeçalho oferece OUTRO número que serve (que a
   * sonda prova que envia, de WhatsApp, que alcança este contato; no grupo, o
   * número que recebe o grupo). Sem ele, a frase não manda trocar para onde
   * não há.
   */
  podeTrocarNumero: boolean;
}) {
  const t = useTranslations("Inbox.messageThread");
  if (!aviso) return null;

  if (aviso.tipo === "fora_do_ar") {
    return (
      <div
        role="alert"
        className="flex min-h-0 items-start gap-2.5 overflow-y-auto border-t border-red-700 bg-red-600 px-3 py-2.5 text-white"
      >
        <WifiOff aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1 text-xs">
          <p className="break-words text-sm font-semibold">
            {t("conexaoForaDoArTitulo", { channel: aviso.rotulo })}
          </p>
          <p className="mt-0.5 break-words">
            {podeTrocarNumero
              ? t("conexaoForaDoArComSeletor")
              : t("conexaoForaDoArSemSeletor")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="flex min-h-0 items-start gap-2 overflow-y-auto border-t border-amber-500/30 bg-amber-500/10 px-3 py-2"
    >
      <TriangleAlert
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
      />
      <div className="min-w-0 flex-1 text-xs text-amber-700 dark:text-amber-300">
        <p className="break-words font-semibold">
          {aviso.tipo === "nao_recebe"
            ? t("conexaoNaoRecebeTitulo", { channel: aviso.rotulo })
            : t("conexaoAtrasadaTitulo", { channel: aviso.rotulo })}
        </p>
        <p className="mt-0.5 break-words">
          {aviso.tipo === "nao_recebe"
            ? t("conexaoNaoRecebeTexto")
            : t("conexaoAtrasadaTexto", { minutos: aviso.minutos })}
        </p>
      </div>
    </div>
  );
}
