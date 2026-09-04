"use client";

import { useEffect, useState } from "react";

import { diasDoPeriodo, type CampanhaMapeada, type GastoDoDia } from "@/lib/meta-ads/atribuicao";
import type { Intervalo } from "@/lib/funil/periodo";
import { createClient } from "@/lib/supabase/client";

/**
 * O gasto em anúncios que o Desempenho lê: as campanhas (com o funil de
 * cada uma) e o gasto por dia no intervalo, sob RLS (SELECT do membro —
 * a config com o token continua fechada). `conectado` é derivado de haver
 * campanhas: o membro não enxerga a config, e campanha só existe depois de
 * uma sincronização.
 *
 * Mesmo desenho do `useTrajetorias`: `carregando` DERIVADO da chave do
 * pedido, setState só no `.then`, resposta atrasada descartada.
 */

interface Resultado {
  chave: string;
  campanhas: CampanhaMapeada[];
  gastos: GastoDoDia[];
}

const PAGINA = 1000;

export function useGastosDeAnuncios(intervalo: Intervalo): {
  campanhas: CampanhaMapeada[];
  gastos: GastoDoDia[];
  carregando: boolean;
  conectado: boolean;
} {
  const supabase = createClient();
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const dias = diasDoPeriodo(intervalo, new Date());
  const chave = `${dias.desde ?? ""}|${dias.ate ?? ""}`;

  useEffect(() => {
    let ativo = true;
    void (async () => {
      const { data: campanhas } = await supabase
        .from("cb_meta_ads_campanhas")
        .select("campaign_id, nome, pipeline_id");
      const gastos: GastoDoDia[] = [];
      for (let pagina = 0; pagina < 25; pagina++) {
        let consulta = supabase
          .from("cb_meta_ads_gastos")
          .select("campaign_id, dia, gasto")
          .order("dia")
          .order("campaign_id")
          .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
        if (dias.desde) consulta = consulta.gte("dia", dias.desde);
        if (dias.ate) consulta = consulta.lt("dia", dias.ate);
        const { data } = await consulta;
        if (!data) break;
        for (const g of data) gastos.push({ campaign_id: g.campaign_id, dia: g.dia, gasto: Number(g.gasto) });
        if (data.length < PAGINA) break;
      }
      if (ativo) setResultado({ chave, campanhas: (campanhas ?? []) as CampanhaMapeada[], gastos });
    })();
    return () => {
      ativo = false;
    };
  }, [supabase, chave, dias.desde, dias.ate]);

  const vigente = resultado !== null && resultado.chave === chave;
  return {
    campanhas: vigente ? resultado.campanhas : SEM_CAMPANHAS,
    gastos: vigente ? resultado.gastos : SEM_GASTOS,
    carregando: !vigente,
    conectado: vigente && resultado.campanhas.length > 0,
  };
}

const SEM_CAMPANHAS: CampanhaMapeada[] = [];
const SEM_GASTOS: GastoDoDia[] = [];
