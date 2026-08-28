// ============================================================
// Fuso horário da agenda (migration 945).
//
// ⚠️ ESTE É O MÓDULO ONDE A AGENDA FALHA EM SILÊNCIO.
//
// O contêiner roda em UTC e quem digita está em Brasília. Uma reunião marcada
// para "amanhã às 9h" que vira `2026-09-01T09:00:00Z` acontece às 6h da manhã
// para o cliente — e nada estoura, nada aparece no log, ninguém percebe até a
// pessoa ficar esperando sozinha. A migration 935 registra o mesmo erro com
// lembretes; aqui o dano é maior porque a reunião tem hora marcada com gente do
// outro lado.
//
// Por isso a aritmética mora aqui, pura e testada, em vez de espalhada pelas
// telas.
//
// ⚠️ POR QUE NÃO `date-fns-tz` (nem outra biblioteca)
// `Intl.DateTimeFormat` já carrega a base IANA completa do sistema, resolve
// horário de verão sozinho e não custa dependência nova. O truque de descobrir
// o deslocamento formatando o instante no fuso alvo é o mesmo que as
// bibliotecas usam por dentro. São ~40 linhas; a dependência seria maior.
// ============================================================

/**
 * O fuso que o escritório usa. Fica aqui, e não espalhado em literais, porque
 * é o padrão de `cb_availability.timezone` no banco — os dois precisam
 * concordar.
 */
export const FUSO_PADRAO = 'America/Sao_Paulo';

/**
 * O nome do fuso é aceito pelo sistema?
 *
 * A migration 945 NÃO valida esta coluna: a lista de fusos vive em
 * `pg_timezone_names`, que é uma view, e CHECK só aceita expressão IMMUTABLE.
 * A validação foi delegada para cá — quem gravar `timezone` sem passar por
 * aqui grava lixo que só aparece quando alguém tenta calcular um horário.
 */
export function fusoValido(timezone: string): boolean {
  if (!timezone || !timezone.trim()) return false;

  // ⚠️ DESLOCAMENTO FIXO NÃO É FUSO, e o `Intl` aceita os dois.
  // `new Intl.DateTimeFormat('en-US', { timeZone: '-03:00' })` não estoura —
  // deslocamentos são válidos no ECMA-402 desde 2022. Mas `-03:00` é uma
  // CONSTANTE: ela não sabe que existe horário de verão. Uma faixa gravada
  // assim continuaria dizendo "9h" enquanto o relógio do advogado tivesse
  // mudado, e a agenda passaria a oferecer horários uma hora fora — do jeito
  // silencioso de sempre. O Brasil aboliu o horário de verão em 2019, o que
  // torna isto invisível hoje e uma bomba-relógio se voltar.
  if (/^[+-]/.test(timezone.trim())) return false;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    // RangeError: nome desconhecido. Qualquer outra falha aqui também
    // significa que não dá para confiar neste fuso.
    return false;
  }
}

/** As partes de um instante, lidas num fuso específico. */
export interface PartesNoFuso {
  ano: number;
  /** 1–12, como as pessoas contam — não 0–11 como o `Date` do JS. */
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  /** 0 = domingo, 6 = sábado. Casa com `cb_availability.dia_da_semana`. */
  diaDaSemana: number;
}

const DIAS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Que horas são, neste instante, naquele fuso.
 *
 * ⚠️ `diaDaSemana` vem do próprio formatador, nunca de `Date.getDay()`. O
 * segundo responde no fuso de QUEM RODA o código — que em produção é UTC — e
 * erra o dia para toda reunião do fim da tarde: 20h de sexta em Brasília é
 * sábado 23h... não, é sábado 00h em UTC. Uma faixa de atendimento cadastrada
 * para sexta deixaria de casar.
 */
export function partesNoFuso(instante: Date, timezone: string): PartesNoFuso {
  const formatador = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const partes: Record<string, string> = {};
  for (const parte of formatador.formatToParts(instante)) {
    if (parte.type !== 'literal') partes[parte.type] = parte.value;
  }

  return {
    ano: Number(partes.year),
    mes: Number(partes.month),
    dia: Number(partes.day),
    // ⚠️ `hour12: false` devolve 24 (não 0) para a meia-noite em algumas
    // versões do ICU. Sem este `% 24`, meia-noite viraria "hora 24", que
    // nenhuma comparação de faixa reconhece.
    hora: Number(partes.hour) % 24,
    minuto: Number(partes.minute),
    diaDaSemana: DIAS[partes.weekday] ?? 0,
  };
}

/**
 * Quanto o fuso está deslocado de UTC NAQUELE instante, em milissegundos.
 *
 * Positivo a leste de Greenwich. Depende do instante porque o deslocamento
 * muda com o horário de verão — é justamente o que torna a conversão abaixo
 * não-trivial.
 */
function deslocamentoEmMs(instante: Date, timezone: string): number {
  const p = partesNoFuso(instante, timezone);
  const comoSeFosseUTC = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto);
  // O instante original pode ter segundos; descontamos para comparar só até o
  // minuto, que é a resolução da agenda.
  const semSegundos = Math.floor(instante.getTime() / 60000) * 60000;
  return comoSeFosseUTC - semSegundos;
}

/**
 * "1º de setembro de 2026, às 9h, em São Paulo" → o instante correspondente.
 *
 * É a conversão que a tela faz toda vez que alguém marca uma reunião.
 *
 * ⚠️ POR QUE DUAS PASSADAS
 * O deslocamento do fuso depende do instante, e o instante é justamente o que
 * queremos descobrir — a definição é circular. A primeira passada chuta usando
 * o deslocamento do horário ingênuo; a segunda recalcula já perto da resposta.
 * Isso corrige as datas de virada do horário de verão, onde o chute cai do lado
 * errado da fronteira e erraria por uma hora.
 *
 * ⚠️ HORA QUE NÃO EXISTE. Na madrugada em que o relógio adianta, horários como
 * 00h30 simplesmente não acontecem. Aqui eles caem no instante logo após o
 * salto, em vez de estourar — a alternativa seria a tela recusar um horário
 * que ela mesma ofereceu. O Brasil não usa horário de verão desde 2019, então
 * na prática isto só importa se um dia houver advogado em outro país.
 *
 * @param dia  `YYYY-MM-DD` — o dia no fuso informado, não em UTC.
 * @param hora `HH:MM` ou `HH:MM:SS` — idem.
 */
export function paraInstante(dia: string, hora: string, timezone: string): Date {
  const [ano, mes, diaDoMes] = dia.split('-').map(Number);
  const [h, min] = hora.split(':').map(Number);

  if (
    !Number.isFinite(ano) ||
    !Number.isFinite(mes) ||
    !Number.isFinite(diaDoMes) ||
    !Number.isFinite(h) ||
    !Number.isFinite(min)
  ) {
    throw new Error(`Data ou hora inválida: "${dia}" "${hora}"`);
  }

  const ingenuo = Date.UTC(ano, mes - 1, diaDoMes, h, min);

  const primeiroChute = ingenuo - deslocamentoEmMs(new Date(ingenuo), timezone);
  const ajustado = ingenuo - deslocamentoEmMs(new Date(primeiroChute), timezone);

  return new Date(ajustado);
}

/**
 * O dia (`YYYY-MM-DD`) em que este instante cai, naquele fuso.
 *
 * ⚠️ Montado a partir das partes, nunca de `toISOString().slice(0, 10)` — o
 * segundo responde em UTC e erra o dia de toda reunião marcada depois das 21h
 * em Brasília, que é o horário em que ninguém está olhando para conferir.
 */
export function diaNoFuso(instante: Date, timezone: string): string {
  const p = partesNoFuso(instante, timezone);
  return (
    `${p.ano}-` +
    `${String(p.mes).padStart(2, '0')}-` +
    `${String(p.dia).padStart(2, '0')}`
  );
}

/** A hora (`HH:MM`) em que este instante cai, naquele fuso. */
export function horaNoFuso(instante: Date, timezone: string): string {
  const p = partesNoFuso(instante, timezone);
  return `${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`;
}

/**
 * Minutos desde a meia-noite — a forma em que faixas de atendimento são
 * comparadas.
 *
 * Aceita `HH:MM` e `HH:MM:SS`, porque a coluna `time` do Postgres volta com
 * segundos e os formulários mandam sem.
 */
export function horaParaMinutos(hora: string): number {
  const [h, min] = hora.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(min)) {
    throw new Error(`Hora inválida: "${hora}"`);
  }
  return h * 60 + min;
}

/** O contrário: 545 → `"09:05"`. */
export function minutosParaHora(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const min = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
