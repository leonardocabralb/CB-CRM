// ============================================================
// Condição "Hora do dia" das automações — no FUSO DO ESCRITÓRIO. E o
// "Aguardar até estar dentro do horário" (`esperaPeloHorario`), que usa a
// mesma janela e a mesma régua de "dentro".
//
// ⚠️ O contêiner roda em UTC. A versão do upstream lia
// `new Date().getHours()`, que no servidor é a hora de Greenwich: a janela
// "08:00-21:00" valia das 5h às 18h de Brasília, e o modelo pronto "Out of
// Office" ("18:00-09:00") respondia "estamos fora do horário" às 15h. Nada
// estourava — o ramo errado só era tomado três horas antes. Hora, minuto e
// dia da semana saem de `partesNoFuso` (`agenda/fuso.ts`), no fuso do
// escritório; nunca de getter local nem de `TZ` no contêiner.
//
// O formato gravado continua o do upstream: `operand = "HH:mm-HH:mm"`. O
// início conta e o fim não ("08:00-21:00": 20:59 sim, 21:00 não), e início
// maior que o fim é janela que ATRAVESSA a meia-noite ("18:00-09:00" vale de
// noite e de madrugada).
//
// `somente_seg_a_sex` (só o booleano `true` liga — JSONB traz `"true"` e `1`,
// que são truthy) recorta aos dias de SEMANA. Na janela que atravessa a
// meia-noite a madrugada é do dia em que a janela COMEÇOU: "22:00-06:00, de
// segunda a sexta" inclui a madrugada de sábado (é a noite de sexta) e não a
// de segunda (é a noite de domingo). Feriado não é olhado: o rótulo diz
// "segunda a sexta", não "dia útil".
// ============================================================

import { diaNoFuso, paraInstante, partesNoFuso, type PartesNoFuso } from '@/lib/agenda/fuso';
import { diaDaSemana, somarDias } from '@/lib/agenda/grade';
import { FUSO_DO_ESCRITORIO } from '@/lib/contacts/campo-data';

const MINUTOS_NO_DIA = 24 * 60;

/**
 * A janela em minutos desde a meia-noite. `fim` só é 1440 no DIA INTEIRO
 * (`"00:00-24:00"`); nas outras, o "24:00" legado vira 0 (ver `lerJanela`).
 */
export interface JanelaDoDia {
  inicio: number;
  fim: number;
}

// Os segundos ("08:00:00") são aceitos e IGNORADOS, como no upstream: é o que
// uma ferramenta de fora costuma gravar, e recusá-los quebraria uma janela
// que funcionava.
const HORA = /^\s*(\d{1,2})(?::(\d{2})(?::(\d{2}))?)?\s*$/;

/**
 * "9", "09:00", "9:30", "08:00:00" → minutos desde a meia-noite; `null` se
 * não for hora. "24:00" só vale como FIM (o upstream aceitava, e ele é a
 * meia-noite do fim do dia).
 */
function lerHora(texto: string, podeSer24: boolean): number | null {
  const m = HORA.exec(texto);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  const seg = m[3] === undefined ? 0 : Number(m[3]);
  if (min > 59 || seg > 59) return null;
  if (h === 24 && min === 0 && seg === 0 && podeSer24) return MINUTOS_NO_DIA;
  if (h > 23) return null;
  return h * 60 + min;
}

/**
 * `"HH:mm-HH:mm"` → a janela; `null` quando não dá para ler, e quando início
 * e fim são iguais (janela vazia — o upstream também respondia "não" sempre).
 *
 * O fim "24:00" legado vira 0 quando o início não é meia-noite: "18:00-24:00"
 * e "18:00-00:00" pegam os mesmos minutos, e com UMA forma só a tela diz
 * "até as 00:00 do dia seguinte" nos dois. Com início 00:00 ele fica 1440 —
 * é o dia inteiro, e 0 faria a janela vazia.
 */
export function lerJanela(operand: unknown): JanelaDoDia | null {
  if (typeof operand !== 'string') return null;
  const partes = operand.split('-');
  if (partes.length !== 2) return null;
  const inicio = lerHora(partes[0], false);
  const lido = lerHora(partes[1], true);
  if (inicio === null || lido === null || inicio === lido) return null;
  const fim = lido === MINUTOS_NO_DIA && inicio > 0 ? 0 : lido;
  return { inicio, fim };
}

/**
 * "O dia inteiro" da tela. O `<input type="time">` não escreve 24:00, e
 * 00:00 → 00:00 é janela VAZIA — sem a caixa, "se for fim de semana,
 * responda X" só se escrevia 00:00 → 23:59, deixando o último minuto de fora.
 */
export const OPERANDO_DO_DIA_INTEIRO = '00:00-24:00';

export function ehODiaInteiro(janela: JanelaDoDia | null): boolean {
  return janela !== null && janela.inicio === 0 && janela.fim === MINUTOS_NO_DIA;
}

/** O que a condição lê do `step_config`. */
export interface CondicaoDeHora {
  operand?: unknown;
  somente_seg_a_sex?: unknown;
}

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "sex 20:59" — o dia e a hora de um instante, como o registro os mostra. */
function horaLida(p: PartesNoFuso): string {
  return `${DIAS[p.diaDaSemana]} ${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`;
}

/**
 * A resposta da condição e a nota para o registro da execução ("hora no
 * escritório: sex 20:59") — sem ela, o ramo "não" das 20h58 do servidor em
 * UTC não diria a ninguém que hora o motor leu.
 */
export function avaliarHoraDoDia(
  cfg: CondicaoDeHora,
  agora: Date,
  fuso: string = FUSO_DO_ESCRITORIO,
): { sim: boolean; nota: string } {
  const p = partesNoFuso(agora, fuso);
  const lida = horaLida(p);
  const janela = lerJanela(cfg.operand);
  if (!janela) {
    return { sim: false, nota: `janela de horário inválida: "${String(cfg.operand ?? '')}"` };
  }

  const minutos = p.hora * 60 + p.minuto;
  let dentro: boolean;
  let diaDaJanela = p.diaDaSemana;
  if (janela.inicio < janela.fim) {
    dentro = minutos >= janela.inicio && minutos < janela.fim;
  } else if (minutos >= janela.inicio) {
    dentro = true;
  } else if (minutos < janela.fim) {
    // A madrugada: a janela começou ONTEM.
    dentro = true;
    diaDaJanela = (p.diaDaSemana + 6) % 7;
  } else {
    dentro = false;
  }

  const diaDeSemana = diaDaJanela >= 1 && diaDaJanela <= 5;
  const sim = dentro && (cfg.somente_seg_a_sex !== true || diaDeSemana);
  return { sim, nota: `hora no escritório: ${lida}` };
}

// ------------------------------------------------------------
// "Aguardar até estar dentro do horário" — o passo `wait` com
// `modo: 'horario'` (26/09/2026, decisão "B6a" do operador: a cadência da
// pré-qualificação só manda lembrete das 8h às 21h, e o que cairia fora sai
// UM só no início seguinte, com a contagem seguindo dali).
//
// Dentro da janela → segue na hora, sem estacionar. Fora → estaciona até o
// PRÓXIMO início. "Dentro" é a MESMA régua da condição "Hora do dia"
// (`avaliarHoraDoDia`), então a madrugada de uma janela que atravessa a
// meia-noite conta para o dia em que ela começou, e "só de segunda a sexta"
// quer dizer o mesmo nos dois passos.
// ------------------------------------------------------------

/**
 * O PRÓXIMO início da janela, ESTRITAMENTE depois de `agora`, num dia que a
 * janela aceita (com `somenteSegASex`, de segunda a sexta — o dia em que a
 * janela COMEÇA, como em `avaliarHoraDoDia`).
 *
 * ⚠️ Anda por DIAS DE CALENDÁRIO do escritório (`somarDias` sobre o
 * `AAAA-MM-DD` de `diaNoFuso`) e monta cada início por `paraInstante` —
 * nunca soma 24 h a um instante: num fuso com horário de verão, "amanhã às
 * 08:00" não fica a 24 h de "hoje às 08:00". E o dia da semana sai do próprio
 * texto da data (`diaDaSemana`), nunca de getter local.
 *
 * "Estritamente depois" é o que impede o agendador de girar em falso: a
 * espera estaciona num instante que ainda não chegou. `null` só se nenhum dos
 * próximos oito dias servir — inalcançável com janela válida (o pior caso,
 * sexta depois do início com "segunda a sexta", é três dias).
 */
export function proximoInicioDaJanela(
  janela: JanelaDoDia,
  somenteSegASex: boolean,
  agora: Date,
  fuso: string = FUSO_DO_ESCRITORIO,
): Date | null {
  const hoje = diaNoFuso(agora, fuso);
  const hora = comoHora(janela.inicio);
  for (let k = 0; k <= 7; k++) {
    const dia = somarDias(hoje, k);
    if (somenteSegASex) {
      const semana = diaDaSemana(dia);
      if (semana === 0 || semana === 6) continue;
    }
    const inicio = paraInstante(dia, hora, fuso);
    if (inicio.getTime() > agora.getTime()) return inicio;
  }
  return null;
}

/** O que o passo "Aguardar" lê do `step_config` no modo horário. */
export interface EsperaPeloHorario {
  janela?: unknown;
  somente_seg_a_sex?: unknown;
}

export type DecisaoDaEspera =
  /** Já está dentro do horário: o passo segue na hora, sem estacionar. */
  | { tipo: 'segue'; nota: string }
  /** Fora: estaciona até `ate`, o próximo início. */
  | { tipo: 'espera'; ate: Date; nota: string }
  /** Janela que o motor não lê — o passo FALHA (a ativação já a recusa). */
  | { tipo: 'invalida'; nota: string };

/**
 * Segue ou espera? E a nota para o registro da execução, com a hora LIDA e
 * até quando ficou ("fora do horário (sex 22:40); aguarda até seg 08:00") —
 * sem ela, ninguém conferiria depois por que o lembrete saiu às 8h.
 */
export function esperaPeloHorario(
  cfg: EsperaPeloHorario,
  agora: Date,
  fuso: string = FUSO_DO_ESCRITORIO,
): DecisaoDaEspera {
  const janela = lerJanela(cfg.janela);
  if (!janela) {
    return { tipo: 'invalida', nota: `janela de horário inválida: "${String(cfg.janela ?? '')}"` };
  }
  const lida = horaLida(partesNoFuso(agora, fuso));
  const dentro = avaliarHoraDoDia(
    { operand: cfg.janela, somente_seg_a_sex: cfg.somente_seg_a_sex },
    agora,
    fuso,
  ).sim;
  if (dentro) return { tipo: 'segue', nota: `dentro do horário (${lida}); segue` };
  const ate = proximoInicioDaJanela(janela, cfg.somente_seg_a_sex === true, agora, fuso);
  if (!ate) {
    return { tipo: 'invalida', nota: `nenhum início da janela nos próximos dias (${lida})` };
  }
  return {
    tipo: 'espera',
    ate,
    nota: `fora do horário (${lida}); aguarda até ${horaLida(partesNoFuso(ate, fuso))}`,
  };
}

/**
 * Início e fim para o RESUMO do passo ("Aguardar o horário das 08:00 às
 * 21:00"). O dia inteiro sai "00:00 às 24:00" — "00:00 às 00:00" seria lido
 * como janela vazia. `null` quando não dá para ler.
 */
export function rotuloDaJanela(operand: unknown): { inicio: string; fim: string } | null {
  const janela = lerJanela(operand);
  if (!janela) return null;
  return {
    inicio: comoHora(janela.inicio),
    fim: ehODiaInteiro(janela) ? '24:00' : comoHora(janela.fim),
  };
}

// ------------------------------------------------------------
// A tela: dois campos de hora ↔ o operando gravado.
// ------------------------------------------------------------

function comoHora(minutos: number): string {
  // "24:00" (legado) é mostrado como "00:00": `<input type="time">` não aceita
  // 24, e "18:00-00:00" pega exatamente os mesmos minutos que "18:00-24:00".
  const m = minutos % MINUTOS_NO_DIA;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * O operando gravado → os dois campos (`HH:mm`, ou "" onde não dá para ler).
 * Lê cada lado sozinho: com um campo preenchido e o outro em branco, o
 * preenchido continua na tela.
 */
export function camposDaJanela(operand: unknown): { inicio: string; fim: string } {
  const partes = typeof operand === 'string' ? operand.split('-') : [];
  // Mais de um "-" não é janela ("09:00-12:00-18:00", um UUID que sobrou de
  // outro critério): os campos ficam em branco, coerentes com o aviso
  // "escolha o início e o fim" — preenchidos, o aviso contradiria a tela.
  if (partes.length > 2) return { inicio: '', fim: '' };
  const [a = '', b = ''] = partes;
  const inicio = lerHora(a, false);
  const fim = lerHora(b, true);
  return {
    inicio: inicio === null ? '' : comoHora(inicio),
    fim: fim === null ? '' : comoHora(fim),
  };
}

/**
 * Os dois campos → o operando (`"HH:mm-HH:mm"`, o formato do upstream). Os
 * dois em branco = operando vazio (o "obrigatório" da ativação), nunca "-".
 */
export function operandoDaJanela(inicio: string, fim: string): string {
  const a = inicio.trim();
  const b = fim.trim();
  return a || b ? `${a}-${b}` : '';
}
