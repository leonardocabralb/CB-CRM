"use client";

// ============================================================
// "Minha ordem dos blocos" (1082) — o botão no fim do menu de blocos.
//
// Cada pessoa põe os blocos de campos na ordem dela; como a ficha mostra um
// bloco por vez, o primeiro é o que já abre. Decisão do operador
// (12/10/2026): por PESSOA, não por perfil — um perfil pode cobrir duas
// áreas.
//
// ⚠️ SETAS, não arrastar: o menu mora na coluna estreita da conversa e no
// celular, onde arrastar pastilha que quebra linha erra o alvo (o catálogo,
// que arrasta, precisou de alça de 24 px e de um seletor ao lado). E é
// RASCUNHO com "Salvar": gravar a cada seta mandaria várias escritas na
// mesma linha, e a mais antiga pode chegar por último.
//
// ⚠️ O rascunho é reconciliado com os blocos NO RENDER (`lista`), nunca por
// efeito: outro admin pode apagar ou criar um bloco com a janela aberta, e
// um rascunho com chave morta salvaria lixo — ou esconderia o bloco novo.
// ============================================================

import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAuth } from "@/hooks/use-auth";
import {
  chaveDoBloco,
  mesmaOrdem,
  moverChave,
  type BlocoDeCampos,
} from "@/lib/contacts/grupos-de-campos";
import {
  apagarOrdemDosBlocos,
  gravarOrdemDosBlocos,
} from "@/lib/contacts/ordem-dos-blocos";
import { createClient } from "@/lib/supabase/client";

export function OrdemDosBlocos({
  blocos,
  rotuloDoGeral,
  propria,
  aoMudar,
}: {
  /** Os blocos JÁ na ordem de quem vê — é dela que o rascunho parte. */
  blocos: BlocoDeCampos[];
  rotuloDoGeral: string;
  /** A pessoa tem ordem própria gravada? Só então há padrão para onde voltar. */
  propria: boolean;
  /** Depois de GRAVAR: a ordem nova, ou `null` ao voltar ao padrão da conta. */
  aoMudar: (ordem: string[] | null) => void;
}) {
  const t = useTranslations("Contacts.customFields");
  const { user, accountId } = useAuth();
  const userId = user?.id ?? null;

  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState<string[] | null>(null);
  const [gravando, setGravando] = useState(false);

  const nomes = new Map(
    blocos.map((b) => [
      chaveDoBloco(b.grupo?.id ?? null),
      b.grupo?.nome ?? rotuloDoGeral,
    ]),
  );
  const atuais = [...nomes.keys()];
  const lista = rascunho
    ? [
        ...rascunho.filter((chave) => nomes.has(chave)),
        ...atuais.filter((chave) => !rascunho.includes(chave)),
      ]
    : atuais;
  const mudou = !mesmaOrdem(lista, atuais);

  const fechar = () => {
    setAberto(false);
    setRascunho(null);
  };

  const mover = (chave: string, passo: -1 | 1) => {
    const proxima = moverChave(lista, chave, passo);
    if (proxima) setRascunho(proxima);
  };

  const salvar = async () => {
    if (!userId || !accountId || gravando) return;
    setGravando(true);
    const ok = await gravarOrdemDosBlocos(
      createClient(),
      { userId, accountId },
      lista,
    );
    setGravando(false);
    if (!ok) {
      toast.error(t("toastOrderFailed"));
      return;
    }
    aoMudar(lista);
    fechar();
  };

  const voltarAoPadrao = async () => {
    if (!userId || !accountId || gravando) return;
    setGravando(true);
    const ok = await apagarOrdemDosBlocos(createClient(), { userId, accountId });
    setGravando(false);
    if (!ok) {
      toast.error(t("toastOrderResetFailed"));
      return;
    }
    aoMudar(null);
    fechar();
  };

  return (
    <Popover
      open={aberto}
      onOpenChange={(abrir) => (abrir ? setAberto(true) : fechar())}
    >
      <PopoverTrigger
        aria-label={t("myOrder")}
        title={t("myOrder")}
        className="text-muted-foreground hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted data-[popup-open]:text-foreground ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors"
      >
        <ArrowUpDown className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <PopoverHeader>
          <PopoverTitle>{t("myOrder")}</PopoverTitle>
          <PopoverDescription className="text-xs">
            {t("myOrderHint")}
          </PopoverDescription>
        </PopoverHeader>
        <ol className="flex max-h-72 flex-col overflow-y-auto">
          {lista.map((chave, i) => {
            const nome = nomes.get(chave) ?? "";
            return (
              <li key={chave} className="flex items-center gap-1 py-0.5">
                <span className="text-muted-foreground w-4 shrink-0 text-xs tabular-nums">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{nome}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={i === 0 || gravando}
                  aria-label={t("moveBlockUp", { name: nome })}
                  title={t("moveBlockUp", { name: nome })}
                  onClick={() => mover(chave, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={i === lista.length - 1 || gravando}
                  aria-label={t("moveBlockDown", { name: nome })}
                  title={t("moveBlockDown", { name: nome })}
                  onClick={() => mover(chave, 1)}
                >
                  <ArrowDown />
                </Button>
              </li>
            );
          })}
        </ol>
        <div className="flex items-center justify-between gap-2">
          {propria ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={gravando}
              onClick={() => void voltarAoPadrao()}
            >
              {t("resetOrder")}
            </Button>
          ) : (
            <span />
          )}
          <Button
            type="button"
            size="sm"
            disabled={!mudou || gravando}
            onClick={() => void salvar()}
          >
            {gravando && <Loader2 className="animate-spin" />}
            {t("saveOrder")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
