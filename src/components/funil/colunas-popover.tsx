"use client";

import { Columns3 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  COLUNAS_FIXAS,
  COLUNAS_SEMPRE,
  colunaDoCampo,
  normalizarColunas,
  type ColunaId,
} from "@/lib/funil/lista";
import type { CustomField, GrupoDeCampos } from "@/types";

/**
 * Quais colunas a lista mostra: as fixas do negócio e, por bloco, os campos
 * personalizados da conta (o mesmo agrupamento da ficha: "Geral" primeiro,
 * depois os blocos por posição). Preferência por dispositivo, como os campos
 * do card (`campos-do-card.ts`).
 */
export function ColunasPopover({
  colunas,
  onChange,
  campos,
  grupos,
}: {
  colunas: ColunaId[];
  onChange: (colunas: ColunaId[]) => void;
  campos: CustomField[];
  grupos: GrupoDeCampos[];
}) {
  const t = useTranslations("Pipelines.funil.lista");
  const ligadas = new Set<string>(colunas);

  const alternar = (id: ColunaId, ligar: boolean) => {
    const proximo = new Set(ligadas);
    if (ligar) proximo.add(id);
    else proximo.delete(id);
    onChange(normalizarColunas([...proximo]));
  };

  const blocos: { chave: string; nome: string; campos: CustomField[] }[] = [];
  const geral = campos.filter((c) => !c.grupo_id);
  if (geral.length > 0) blocos.push({ chave: "geral", nome: t("blocoGeral"), campos: geral });
  for (const g of [...grupos].sort((a, b) => a.posicao - b.posicao || a.nome.localeCompare(b.nome))) {
    const doBloco = campos.filter((c) => c.grupo_id === g.id);
    if (doBloco.length > 0) blocos.push({ chave: g.id, nome: g.nome, campos: doBloco });
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t("escolherColunas")}
        title={t("escolherColunas")}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted"
      >
        <Columns3 className="h-4 w-4" />
        {t("escolherColunas")}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-72">
        <div className="max-h-96 overflow-y-auto">
          <p className="px-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("colunasFixas")}
          </p>
          <div className="flex flex-col">
            {COLUNAS_FIXAS.map((id) => {
              const travada = (COLUNAS_SEMPRE as readonly string[]).includes(id);
              return (
                <label
                  key={id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-0.5 py-1 text-sm hover:bg-muted"
                >
                  <Checkbox
                    checked={ligadas.has(id)}
                    disabled={travada}
                    onCheckedChange={(checked) => alternar(id, checked === true)}
                  />
                  {/* chave montada: `lista.colunas.<id>` — cobrada em lista.test.ts */}
                  <span>{t(`colunas.${id}` as Parameters<typeof t>[0])}</span>
                </label>
              );
            })}
          </div>
          {blocos.map((bloco) => (
            <div key={bloco.chave} className="mt-2">
              <p className="px-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {bloco.nome}
              </p>
              <div className="flex flex-col">
                {bloco.campos.map((campo) => {
                  const id = colunaDoCampo(campo.field_key);
                  return (
                    <label
                      key={campo.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-0.5 py-1 text-sm hover:bg-muted"
                    >
                      <Checkbox
                        checked={ligadas.has(id)}
                        onCheckedChange={(checked) => alternar(id, checked === true)}
                      />
                      <span className="truncate">{campo.field_name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
