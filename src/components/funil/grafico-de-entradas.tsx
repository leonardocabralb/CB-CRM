"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { rotuloCurtoDoDia } from "@/lib/funil/apresentacao";
import type { EntradasNoDia } from "@/lib/funil/coorte";

/**
 * Entrada de leads por dia — linha com área, recharts direto (o Tremor
 * vendorizado do projeto só tem o BarChart; vendorizar mais 600 linhas para
 * uma área seria a terceira cópia de tooltip do repo). As cores saem de
 * classes Tailwind com `stroke=""`/`fill=""` vazios, o truque do próprio
 * Tremor, para o gráfico seguir o tema.
 */
export function GraficoDeEntradas({
  pontos,
  rotuloDaContagem,
}: {
  pontos: EntradasNoDia[];
  /** "{n} lead(s) no dia" já traduzido — recebe o número. */
  rotuloDaContagem: (n: number) => string;
}) {
  const dados = pontos.map((p) => ({ dia: p.dia, n: p.n }));
  // Eixo X: com muitos dias, deixa o recharts ralear os rótulos.
  const intervalo = dados.length > 45 ? Math.ceil(dados.length / 15) - 1 : dados.length > 14 ? 1 : 0;

  return (
    <div className="h-[280px] w-full text-muted-foreground">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={dados} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" stroke="" />
          <XAxis
            dataKey="dia"
            tickFormatter={rotuloCurtoDoDia}
            tick={{ fill: "currentColor", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval={intervalo}
            minTickGap={16}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: "currentColor", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const ponto = payload[0].payload as { dia: string; n: number };
              return (
                <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
                  <div className="text-muted-foreground">{rotuloCurtoDoDia(ponto.dia)}</div>
                  <div className="font-medium">{rotuloDaContagem(ponto.n)}</div>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="n"
            strokeWidth={2}
            className="fill-emerald-500/15 stroke-emerald-500"
            stroke=""
            fill=""
            dot={dados.length <= 31 ? { r: 3, className: "fill-emerald-500 stroke-emerald-500", stroke: "", fill: "" } : false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
