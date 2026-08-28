// ============================================================
// Cálculo de horários livres (migration 945).
//
// Dada a grade de atendimento do advogado e o que já está marcado, quais
// horários sobram. É o módulo que a Fase 2 vai usar para oferecer opções ao
// cliente, e que a Fase 1 já usa para sugerir horários ao operador.
//
// Puro de propósito: nenhuma consulta, nenhum `new Date()` sem argumento. O
// "agora" entra por parâmetro, senão o teste não consegue fixar o tempo e a
// função passa a ter resultado diferente a cada minuto.
//
// ⚠️ VAGA OFERECIDA NÃO É VAGA GARANTIDA. Entre a tela mostrar e o operador
// clicar, outra pessoa pode marcar — por isso a restrição `EXCLUDE` da 945
// existe no banco. Este módulo reduz a chance da colisão; quem impede é o
// Postgres.
// ============================================================

import type { Availability } from '@/types';

import { diaNoFuso, horaParaMinutos, minutosParaHora, paraInstante } from './fuso';

/** Um intervalo qualquer — vaga oferecida ou horário já tomado. */
export interface Intervalo {
  inicio: Date;
  fim: Date;
}

export interface ParametrosDeVagas {
  /** As faixas de atendimento. Faixa com `ativo: false` é ignorada. */
  faixas: Availability[];
  /** O que já está marcado. Reunião cancelada NÃO entra aqui. */
  ocupados: Intervalo[];
  /** Começo e fim do período consultado. */
  de: Date;
  ate: Date;
  /** O instante "agora", para a antecedência mínima. Entra por parâmetro. */
  agora: Date;
}

/**
 * Teto de dias varridos numa chamada.
 *
 * Guarda contra pedido absurdo (a tela mandando um período de dez anos por
 * causa de um bug de data): sem ele a função geraria centenas de milhares de
 * vagas e travaria o navegador. Um ano cobre com folga o
 * `janela_maxima_dias` máximo, que o CHECK da 945 limita a 365.
 */
const TETO_DE_DIAS = 366;

/** Dois intervalos se cruzam? Regra `[)`: 9h–10h e 10h–11h NÃO se cruzam. */
export function seSobrepoem(a: Intervalo, b: Intervalo): boolean {
  return a.inicio < b.fim && b.inicio < a.fim;
}

/**
 * Os dias `YYYY-MM-DD` entre dois instantes, lidos num fuso.
 *
 * ⚠️ Itera com `Date.UTC`, que não tem horário de verão, em vez de somar 24h ao
 * instante local. Somar 24h atravessando a virada do relógio pularia ou
 * repetiria um dia — e o erro só apareceria duas vezes por ano, no país errado.
 */
function diasNoPeriodo(de: Date, ate: Date, timezone: string): string[] {
  const primeiro = diaNoFuso(de, timezone);
  const ultimo = diaNoFuso(ate, timezone);

  const [ano, mes, dia] = primeiro.split('-').map(Number);
  const dias: string[] = [];

  for (let i = 0; i < TETO_DE_DIAS; i++) {
    const d = new Date(Date.UTC(ano, mes - 1, dia + i));
    const texto =
      `${d.getUTCFullYear()}-` +
      `${String(d.getUTCMonth() + 1).padStart(2, '0')}-` +
      `${String(d.getUTCDate()).padStart(2, '0')}`;
    dias.push(texto);
    if (texto >= ultimo) break;
  }

  return dias;
}

/**
 * O dia da semana de uma data `YYYY-MM-DD`, sem passar por fuso nenhum.
 *
 * A data já é local por construção (veio de `diasNoPeriodo`), então basta lê-la
 * como UTC — o que evita reintroduzir o deslocamento que acabamos de descontar.
 */
function diaDaSemanaDaData(data: string): number {
  const [ano, mes, dia] = data.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

/**
 * Os horários livres no período.
 *
 * Devolve em ordem cronológica, sem repetição. Duas faixas que se sobrepõem —
 * cadastro descuidado, "9h–12h" e "10h–14h" no mesmo dia — não produzem a mesma
 * vaga duas vezes.
 */
export function calcularVagas({
  faixas,
  ocupados,
  de,
  ate,
  agora,
}: ParametrosDeVagas): Intervalo[] {
  const porInicio = new Map<number, Intervalo>();

  for (const faixa of faixas) {
    if (!faixa.ativo) continue;

    // A janela que ESTA faixa permite. Cada advogado pode ter a sua.
    const limiteDaJanela = new Date(
      agora.getTime() + faixa.janela_maxima_dias * 24 * 60 * 60 * 1000,
    );
    // ⚠️ A antecedência é contada a partir de `agora`, não do início do dia:
    // "24 horas de antecedência" significa 24 horas, não "amanhã".
    const maisCedoPermitido = new Date(
      agora.getTime() + faixa.antecedencia_minima_horas * 60 * 60 * 1000,
    );

    const inicioDaFaixa = horaParaMinutos(faixa.hora_inicio);
    const fimDaFaixa = horaParaMinutos(faixa.hora_fim);
    const passo = faixa.duracao_minutos + faixa.intervalo_minutos;

    for (const dia of diasNoPeriodo(de, ate, faixa.timezone)) {
      if (diaDaSemanaDaData(dia) !== faixa.dia_da_semana) continue;

      for (
        let minuto = inicioDaFaixa;
        // ⚠️ A vaga tem de CABER inteira na faixa. Sem o `+ duracao`, uma
        // faixa 9h–12h com reunião de 1h ofereceria 12h–13h, uma hora depois
        // do expediente.
        minuto + faixa.duracao_minutos <= fimDaFaixa;
        minuto += passo
      ) {
        const inicio = paraInstante(dia, minutosParaHora(minuto), faixa.timezone);
        const fim = new Date(inicio.getTime() + faixa.duracao_minutos * 60000);

        if (inicio < maisCedoPermitido) continue;
        if (inicio > limiteDaJanela) continue;
        if (inicio < de || fim > ate) continue;

        const vaga = { inicio, fim };
        if (ocupados.some((o) => seSobrepoem(vaga, o))) continue;

        // Duas faixas sobrepostas gerariam a mesma vaga; a chave é o instante.
        porInicio.set(inicio.getTime(), vaga);
      }
    }
  }

  return [...porInicio.values()].sort(
    (a, b) => a.inicio.getTime() - b.inicio.getTime(),
  );
}

/**
 * Agrupa vagas por dia, para a tela montar "quinta-feira: 9h, 10h, 11h".
 *
 * A chave é o dia no fuso pedido — nunca o de UTC, senão as vagas do fim da
 * tarde apareceriam sob o dia seguinte.
 */
export function agruparVagasPorDia(
  vagas: Intervalo[],
  timezone: string,
): Map<string, Intervalo[]> {
  const porDia = new Map<string, Intervalo[]>();
  for (const vaga of vagas) {
    const dia = diaNoFuso(vaga.inicio, timezone);
    const lista = porDia.get(dia);
    if (lista) lista.push(vaga);
    else porDia.set(dia, [vaga]);
  }
  return porDia;
}
