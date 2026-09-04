"use client";

/**
 * O mapa de saúde: linhas = transições, colunas = meses, cor RELATIVA À
 * LINHA (decisão D6: o melhor mês da transição é verde e o pior é vermelho —
 * escala absoluta pintaria "Lead → Contrato" de vermelho o ano inteiro).
 * Coorte pequena fica apagada, com o motivo no `title`; o mês corrente é
 * marcado como "em andamento". Tabela HTML pura — não há biblioteca para
 * desenhar isto, e a rolagem horizontal fica no contêiner, nunca na página.
 */
export interface CelulaDoMapa {
  /** fração 0..1 ou nulo (sem denominador) */
  taxa: number | null;
  /** 0..1 relativo à linha ou nulo */
  posicao: number | null;
  entradas: number;
  pequena: boolean;
}

export interface LinhaDoMapaDeCalor {
  chave: string;
  rotulo: string;
  celulas: CelulaDoMapa[];
}

/** Vermelho (0) → amarelo (0,5) → verde (1), sempre com alfa: legível nos dois temas. */
export function corDaCelula(posicao: number | null): string | undefined {
  if (posicao === null) return undefined;
  const matiz = Math.round(posicao * 130);
  return `hsl(${matiz} 70% 45% / 0.35)`;
}

export function MapaDeCalor({
  meses,
  linhas,
  formatarTaxa,
  tituloDaCelula,
  rotuloEmAndamento,
  rotuloPequena,
}: {
  meses: { chave: string; rotulo: string; emAndamento: boolean }[];
  linhas: LinhaDoMapaDeCalor[];
  formatarTaxa: (taxa: number | null) => string;
  tituloDaCelula: (mes: string, taxa: string, entradas: number) => string;
  rotuloEmAndamento: string;
  rotuloPequena: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="w-44 text-left font-medium text-muted-foreground" />
            {meses.map((m) => (
              <th key={m.chave} className="px-1 py-1 text-center font-medium text-muted-foreground">
                {m.rotulo}
                {m.emAndamento && (
                  <span className="block text-[10px] font-normal" title={rotuloEmAndamento}>
                    ●
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => (
            <tr key={linha.chave}>
              <th className="whitespace-nowrap pr-2 text-left font-medium text-foreground">{linha.rotulo}</th>
              {linha.celulas.map((c, i) => {
                const texto = formatarTaxa(c.taxa);
                const apagada = c.pequena || c.taxa === null;
                return (
                  <td
                    key={meses[i]?.chave ?? i}
                    className={
                      apagada
                        ? "rounded-md bg-muted/60 px-1 py-2 text-center tabular-nums text-muted-foreground"
                        : "rounded-md px-1 py-2 text-center font-medium tabular-nums text-foreground"
                    }
                    style={apagada ? undefined : { backgroundColor: corDaCelula(c.posicao) }}
                    title={`${tituloDaCelula(meses[i]?.rotulo ?? "", texto, c.entradas)}${c.pequena ? ` · ${rotuloPequena}` : ""}`}
                  >
                    {c.taxa === null ? "—" : texto}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
