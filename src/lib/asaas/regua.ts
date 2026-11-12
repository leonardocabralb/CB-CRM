import { diaNoFuso, FUSO_PADRAO, paraInstante } from "@/lib/agenda/fuso";

import { classificar, diaPorExtenso, diasDeAtraso, dinheiro, ehDevida, rotulosDasParcelas, valorAtualizado, type ParcelaDoEspelho } from "./inadimplencia";

/**
 * A RÉGUA DE COBRANÇA — a parte PURA (Fase 3 do plano do Asaas, §3.6):
 * que parcela cruza que marco em que dia, a janela do dia, o lembrete do
 * vencimento, o intervalo mínimo entre cobranças, a absorção do lembrete
 * pela cobrança e as variáveis que a mensagem usa. Sem I/O: a varredura
 * (`varrer-regua.ts`) lê o banco e chama isto.
 *
 * Regras do operador (12 e 13/09/2026) que moram aqui:
 * - D13: quem JÁ estava atrasado quando a régua foi ligada fica de fora —
 *   só a parcela vista vencida DEPOIS de `regua_ativada_em` entra. "Se
 *   atrasar mais uma vez, aí sim recebe."
 * - D11: uma mensagem por CLIENTE, com TODAS as vencidas dele; o marco
 *   decide QUANDO, o conteúdo é sempre tudo; e um INTERVALO MÍNIMO (3 dias
 *   por padrão) entre cobranças ao mesmo cliente — o marco que cai dentro do
 *   intervalo é `absorvida`. ⚠️ O intervalo vale entre COBRANÇAS; o lembrete
 *   do vencimento não conta nem é contado (contando-o, o marco de 1 dia, que
 *   é o dia seguinte ao lembrete, nunca sairia).
 * - D17: lembrete no dia do vencimento — e, quando o mesmo cliente tem marco
 *   cruzando no mesmo dia, UMA mensagem só: a cobrança, com a linha "e hoje
 *   vence…"; o lembrete é absorvido.
 * - D12: só em dia útil; fim de semana e feriado nacional de data fixa
 *   empurram para o dia útil seguinte; nunca depois das 18h.
 * - D6 (revista em 13/09): a negativada entra como qualquer vencida.
 *
 * ⚠️ Toda data aqui é texto `AAAA-MM-DD` com aritmética sobre o texto (via
 * `Date.UTC`), nunca `new Date("2026-09-01")` — que é meia-noite UTC e
 * retrocede um dia no Brasil. O único lugar com fuso é `paraInstante`, para
 * a janela do dia, e `diaNoFuso`, para "que dia é hoje".
 */

/** A hora limite: nada sai depois disto (D12) — menos o lembrete da NOITE, abaixo. */
export const HORA_LIMITE = "18:00";
/**
 * O LEMBRETE DA NOITE (D12 revista pelo operador em 10/11/2026): no dia do
 * vencimento saem dois lembretes — o do dia (`hora_envio` antes das 18:00) e
 * o da noite (a partir das 18:00), com cara de mensagem automática ("Assinar
 * como" = "Mensagem automática"), para lembrar no fim do dia sem parecer uma
 * pessoa cobrando. A noite vai das 18:00 às 21:00; a cobrança de atraso
 * continua só até as 18:00. Cada turno tem a SUA trava (`marco` 0 = dia,
 * 1 = noite; CHECK da 1133).
 */
export const INICIO_DA_NOITE = "18:00";
export const HORA_LIMITE_DA_NOITE = "21:00";
/** O último `hora_envio` aceito no lembrete da noite (a janela fecha às 21:00). */
export const HORA_MAXIMA_DA_NOITE = "20:30";
export type TurnoDoLembrete = "dia" | "noite";
export const HORA_PADRAO_COBRANCA = "09:00";
export const HORA_PADRAO_LEMBRETE = "08:00";
/** A faixa que o editor aceita para `hora_envio` (a mesma de `validate.ts` para a tarefa). */
export const HORA_MINIMA = "08:00";
export const HORA_MAXIMA = "17:00";
/** O intervalo mínimo entre COBRANÇAS ao mesmo cliente (D11, 13/09): editável no cartão. */
export const INTERVALO_PADRAO_DIAS = 3;
/** Quantos dias a mais que o marco o espelho pode ter demorado a VER a vencida (C7) sem perder o marco. */
export const TOLERANCIA_DA_VISTA_DIAS = 3;
/** Depois de quanto tempo uma trava `reservado` sem desfecho é órfã. */
export const RECOLHER_TRAVA_MS = 10 * 60_000;
/**
 * Depois de quanto tempo uma trava `na_fila` (o motor reenfileirou o envio,
 * PR #205) sem desfecho no log vira `incerto`. A retentativa roda em 30 s e
 * depois em 5 min, mais o tique do agendador — uma hora cobre com folga.
 */
export const RECOLHER_NA_FILA_MS = 60 * 60_000;

/** Os valores do CHECK de `cb_asaas_regua_envios.resultado` (998), rotulados por chave montada na aba. */
export const RESULTADOS_DA_TRAVA = ["reservado", "enviado", "absorvida", "barrada", "falhou", "fora_do_escopo", "sem_automacao", "incerto", "na_fila"] as const;
export type ResultadoDaTrava = (typeof RESULTADOS_DA_TRAVA)[number];

/**
 * O que conta como "já cobrado" para o intervalo mínimo (D11) e o "uma por
 * cliente por dia": o que SAIU, o que está na fila do motor (vai sair) e o
 * incerto (pode ter saído). Mandar de menos é o lado seguro de uma cobrança.
 */
export const RESULTADOS_QUE_CONTAM_COMO_ENVIO: ReadonlySet<string> = new Set(["enviado", "na_fila", "incerto"]);

/**
 * Os passos do motor que ENTREGAM ao contato: o sucesso de qualquer um deles
 * é a prova de que a cobrança chegou. ⚠️ Só o `send_message` contava, e um
 * ramo de condição pode rodar só a mídia (`validate.ts` a aceita com a
 * conexão): a execução fechava `barrada`, e o cliente cobrado ficava fora do
 * intervalo mínimo (Codex, 4ª rodada do PR #206). FICAM FORA o
 * `send_to_number` (avisa OUTRO número, a equipe) e o `send_webhook` (fala
 * com um sistema) — por isso não é o `PASSOS_DE_ENVIO` da retentativa, que
 * inclui o `send_to_number`. Botões, lista e modelo contam: se deram certo, o
 * cliente recebeu, e contar a mais só faz a régua mandar MENOS. ⚠️ Contar
 * não é permitir: `validateAsaasReguaForActivation` RECUSA esses três na
 * régua (só saem pela Meta, e a régua é QR Code) — estão aqui para o log de
 * uma automação gravada antes da recusa não virar `barrada` sobre entrega.
 */
export const PASSOS_QUE_FALAM_COM_O_CONTATO: ReadonlySet<string> = new Set(["send_message", "send_media", "send_buttons", "send_list", "send_template"]);

/** Feriados nacionais de data FIXA (MM-DD). Os móveis ficam fora da v1 (§8). */
export const FERIADOS_NACIONAIS_FIXOS = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"] as const;

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `HH:MM` entre 08:00 e 17:00? (a cobrança de atraso e o lembrete do dia) */
export function horaDeEnvioValida(hora: unknown): hora is string {
  return typeof hora === "string" && RE_HORA.test(hora) && hora >= HORA_MINIMA && hora <= HORA_MAXIMA;
}

/** O lembrete aceita também a noite: 08:00–17:00 ou 18:00–20:30. */
export function horaDeLembreteValida(hora: unknown): hora is string {
  return horaDeEnvioValida(hora) || (typeof hora === "string" && RE_HORA.test(hora) && hora >= INICIO_DA_NOITE && hora <= HORA_MAXIMA_DA_NOITE);
}

/** O turno do lembrete pela hora: a partir das 18:00 é o da noite. */
export function turnoDaHora(hora: string): TurnoDoLembrete {
  return hora >= INICIO_DA_NOITE ? "noite" : "dia";
}

/** Até quando a janela de uma automação da régua fica aberta: 21:00 no lembrete da noite, 18:00 no resto. */
export function fimDaJanela(a: Pick<AutomacaoDaRegua, "tipo" | "horaEnvio">): string {
  return a.tipo === "vence_hoje" && turnoDaHora(a.horaEnvio) === "noite" ? HORA_LIMITE_DA_NOITE : HORA_LIMITE;
}

function diaEmMs(dia: string): number {
  const [a, m, d] = dia.split("-").map(Number);
  return Date.UTC(a, m - 1, d);
}

/** `AAAA-MM-DD` + n dias (n pode ser negativo). */
export function somarDias(dia: string, n: number): string {
  return new Date(diaEmMs(dia) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado, do próprio texto (sem fuso). */
export function diaDaSemana(dia: string): number {
  return new Date(diaEmMs(dia)).getUTCDay();
}

export function ehFeriadoFixo(dia: string): boolean {
  return (FERIADOS_NACIONAIS_FIXOS as readonly string[]).includes(dia.slice(5));
}

/** Dia útil = segunda a sexta e não feriado nacional de data fixa. */
export function ehDiaUtil(dia: string): boolean {
  const s = diaDaSemana(dia);
  return s !== 0 && s !== 6 && !ehFeriadoFixo(dia);
}

/** O próprio dia, se útil; senão o próximo útil. */
export function proximoDiaUtil(dia: string): string {
  let d = dia;
  for (let i = 0; i < 10 && !ehDiaUtil(d); i++) d = somarDias(d, 1);
  return d;
}

/** O último dia útil ESTRITAMENTE antes de `dia`. */
export function diaUtilAnterior(dia: string): string {
  let d = somarDias(dia, -1);
  for (let i = 0; i < 10 && !ehDiaUtil(d); i++) d = somarDias(d, -1);
  return d;
}

export interface ContextoDaRegua {
  /** `AAAA-MM-DD` no fuso do escritório */
  hoje: string;
  /** `cb_asaas_config.regua_ativada_em` — o instante em que o interruptor foi ligado (D20) */
  reguaAtivadaEm: string | null;
  somenteDiasUteis: boolean;
  fuso: string;
}

/**
 * A parcela entrou na régua? Só a vista vencida DEPOIS de o interruptor
 * ser ligado (D13): na primeira sincronização TODAS as vencidas ganham
 * `vista_vencida_em` = aquele dia, e ligar a régua não pode despejar as 405
 * de uma vez — nem o marco de 30 dias delas, semanas depois. "Se atrasar
 * mais uma vez, aí sim recebe."
 */
export function entrouNaRegua(p: Pick<ParcelaDoEspelho, "vista_vencida_em">, reguaAtivadaEm: string | null): boolean {
  if (!p.vista_vencida_em || !reguaAtivadaEm) return false;
  return Date.parse(p.vista_vencida_em) > Date.parse(reguaAtivadaEm);
}

/**
 * O DIA-ALVO de um marco para esta parcela — ou `null` quando este marco não
 * lhe cabe. É `vencimento + marco`; se o espelho só a viu vencida DEPOIS
 * disso (o Asaas marca vencida tarde — C7 — ou a sincronização estava
 * parada), o dia em que viu, desde que dentro de `TOLERANCIA_DA_VISTA_DIAS`;
 * passado disso, o marco foi perdido e o próximo o cobre (a mensagem lista
 * tudo de qualquer jeito, D11). Com `somenteDiasUteis`, fim de semana e
 * feriado empurram para o dia útil seguinte (D12).
 */
export function diaAlvoDoMarco(p: Pick<ParcelaDoEspelho, "vencimento" | "vista_vencida_em">, marco: number, ctx: ContextoDaRegua): string | null {
  if (!RE_DIA.test(p.vencimento) || !Number.isInteger(marco) || marco < 1) return null;
  const base = somarDias(p.vencimento, marco);
  let alvo = base;
  if (p.vista_vencida_em) {
    const vista = diaNoFuso(new Date(p.vista_vencida_em), ctx.fuso);
    if (vista > base) {
      if (vista > somarDias(base, TOLERANCIA_DA_VISTA_DIAS)) return null;
      alvo = vista;
    }
  }
  return ctx.somenteDiasUteis ? proximoDiaUtil(alvo) : alvo;
}

/** Puro: `agora` está entre `hora_envio` e o fim (18:00; 21:00 no lembrete da noite) do dia `hoje`, no fuso? */
export function janelaAberta(agora: Date, hoje: string, horaEnvio: string, fuso: string = FUSO_PADRAO, limite: string = HORA_LIMITE): boolean {
  if (!RE_DIA.test(hoje) || !RE_HORA.test(horaEnvio) || !RE_HORA.test(limite)) return false;
  const inicio = paraInstante(hoje, horaEnvio, fuso).getTime();
  const fim = paraInstante(hoje, limite, fuso).getTime();
  const t = agora.getTime();
  return t >= inicio && t < fim;
}

/**
 * Os vencimentos que o LEMBRETE cobre hoje (D17). Sem "só dia útil": hoje.
 * Com ele: nada em fim de semana/feriado, e no primeiro dia útil seguinte
 * TODOS os dias desde o último dia útil (exclusive) até hoje — o boleto de
 * sábado pode ser pago na segunda sem juros, e o lembrete diz isso. ⚠️
 * Empurrar, nunca pular: ~2 de cada 7 vencimentos caem em fim de semana.
 */
export function diasDoLembrete(hoje: string, somenteDiasUteis: boolean): string[] {
  if (!somenteDiasUteis) return [hoje];
  if (!ehDiaUtil(hoje)) return [];
  const dias: string[] = [];
  for (let d = somarDias(diaUtilAnterior(hoje), 1); d <= hoje; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

/**
 * Puro: a parcela cabe no lembrete de hoje? Vencimento entre os dias do
 * lembrete (`diasDoLembrete`) e PENDING — ou já OVERDUE quando o vencimento
 * caiu no fim de semana (o Asaas pode marcar vencida antes de o lembrete
 * empurrado sair, C7). ⚠️ É a cerca da SELEÇÃO e também a da linha RELIDA no
 * Asaas: a releitura olhava só o status, e a PENDING de hoje que o Asaas
 * PRORROGOU para o fim do mês (a sincronização só a relê amanhã) mandava
 * "vence hoje" com a data futura na linha — e a trava gravada com o
 * vencimento novo barrava por 23505 o lembrete legítimo no dia certo (Codex,
 * 4ª rodada do PR #206).
 */
export function cabeNoLembrete(p: Pick<ParcelaDoEspelho, "status" | "deleted" | "vencimento">, dias: ReadonlySet<string>, hoje: string): boolean {
  if (p.deleted || !dias.has(p.vencimento)) return false;
  const classe = classificar(p.status, p.deleted);
  return classe === "a_vencer" || (classe === "vencida" && p.vencimento < hoje);
}

/**
 * O boleto ainda pode ser pago? O que o Asaas diz que não pode fica fora
 * (precisa de gente para gerar outra cobrança) e é contado no cartão.
 * `dias_ate_cancelar_registro` > 0 = o registro do boleto é cancelado N dias
 * depois do vencimento; nulo = sem cancelamento automático.
 */
export function aindaPagavel(p: Pick<ParcelaDoEspelho, "pode_pagar_apos_vencimento" | "dias_ate_cancelar_registro" | "vencimento">, hoje: string): boolean {
  if (p.pode_pagar_apos_vencimento === false) return false;
  const teto = p.dias_ate_cancelar_registro;
  if (typeof teto === "number" && teto > 0 && RE_DIA.test(p.vencimento)) {
    return somarDias(p.vencimento, teto) >= hoje;
  }
  return true;
}

/**
 * O intervalo mínimo (D11, 13/09): a cobrança de hoje é ABSORVIDA quando a
 * última cobrança ENVIADA a este cliente foi há menos de `intervaloDias`.
 * `ultimaCobrancaEm` é o instante do envio; conta-se em dias de calendário
 * no fuso do escritório — enviada dia 10, intervalo 3 → livre a partir do 13.
 */
export function dentroDoIntervalo(ultimaCobrancaEm: string | null, hoje: string, intervaloDias: number, fuso: string = FUSO_PADRAO): boolean {
  if (!ultimaCobrancaEm || !Number.isFinite(intervaloDias) || intervaloDias <= 0) return false;
  const ultima = diaNoFuso(new Date(ultimaCobrancaEm), fuso);
  return somarDias(ultima, intervaloDias) > hoje;
}

/**
 * Pessoa física ou jurídica, pelo CPF/CNPJ do espelho (só dígitos): 11 = CPF,
 * 14 = CNPJ; o resto é `null` (não sei) e é tratado como pessoa — 59 dos 73
 * devedores com ficha eram CPF, nenhum sem documento (10/11/2026). O
 * documento em si nunca sai daqui: só o tipo.
 */
export type TipoDePessoa = "fisica" | "juridica" | null;

export function tipoDePessoa(cpfCnpj: string | null | undefined): TipoDePessoa {
  const digitos = (cpfCnpj ?? "").replace(/\D/g, "");
  return digitos.length === 11 ? "fisica" : digitos.length === 14 ? "juridica" : null;
}

const DIAS_DA_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const NUMEROS_POR_EXTENSO = ["", "uma", "duas", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez"];

/** `DD/MM`, com o ano só quando não é o de `hoje` (11/09; 11/12/2025). */
function diaCurto(dia: string, hoje: string): string {
  if (!RE_DIA.test(dia)) return dia;
  const [a, m, d] = dia.split("-");
  return a === hoje.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${a}`;
}

/**
 * Quando venceu ou vence, como se fala (10/11/2026, pedido do operador: o
 * texto tem de parecer escrito para aquela pessoa): "vence hoje", "vence
 * amanhã", "venceu ontem", "venceu na sexta-feira (07/11)" até 6 dias, e
 * "venceu em 11/09" daí para trás. Relativo ao dia da MENSAGEM (`hoje`, no
 * fuso do escritório) — a varredura só manda no próprio dia.
 */
export function quandoVence(vencimento: string, hoje: string): string {
  if (!RE_DIA.test(vencimento) || !RE_DIA.test(hoje)) return "";
  if (vencimento === hoje) return "vence hoje";
  if (vencimento === somarDias(hoje, 1)) return "vence amanhã";
  if (vencimento > hoje) return `vence em ${diaCurto(vencimento, hoje)}`;
  if (vencimento === somarDias(hoje, -1)) return "venceu ontem";
  if (vencimento >= somarDias(hoje, -6)) {
    const s = diaDaSemana(vencimento);
    return `venceu ${s === 0 || s === 6 ? "no" : "na"} ${DIAS_DA_SEMANA[s]} (${diaCurto(vencimento, hoje)})`;
  }
  return `venceu em ${diaCurto(vencimento, hoje)}`;
}

/**
 * O rótulo que VAI AO CLIENTE: "Parcela 3 de 12", ou "Cobrança" na avulsa.
 * ⚠️⚠️ NUNCA a descrição da cobrança (`rotuloDaParcela` a usa, e a aba
 * Cobranças da equipe continua usando): medido em 10/11/2026, as avulsas
 * guardam ANOTAÇÃO INTERNA da equipe na descrição ("pediu para colocar para
 * após…", "recriada em nome de…", "promessa de pagamento…"), que iria
 * inteira para o WhatsApp do cliente.
 */
function rotuloParaOCliente(p: Pick<ParcelaDoEspelho, "parcela_numero" | "parcela_total">): string {
  if (p.parcela_numero === null) return "Cobrança";
  return p.parcela_total !== null && p.parcela_total > 0 ? `Parcela ${p.parcela_numero} de ${p.parcela_total}` : `Parcela ${p.parcela_numero}`;
}

function comJuros(p: Pick<ParcelaDoEspelho, "juros_e_multa">): boolean {
  return p.juros_e_multa !== null && p.juros_e_multa > 0;
}

/**
 * Uma linha de `cobranca_detalhe`, com o link na linha de baixo:
 * "• Parcela 3 de 12 — R$ 648,20 (com juros e multa) — venceu ontem\n  https://…".
 * Sem juros, só o valor (0 das parcelas em aberto tinham juros em 10/11/2026,
 * e "(valor original)" em toda linha era ruído).
 */
export function linhaDaParcela(p: ParcelaDoEspelho, hoje: string): string {
  const valor = comJuros(p) ? `${dinheiro(valorAtualizado(p))} (com juros e multa)` : dinheiro(p.valor);
  const link = p.link_fatura ?? p.link_boleto ?? "";
  return `• ${rotuloParaOCliente(p)} — ${valor} — ${quandoVence(p.vencimento, hoje)}${link ? `\n  ${link}` : ""}`;
}

function somaAtualizada(parcelas: readonly ParcelaDoEspelho[]): number {
  return Math.round(parcelas.reduce((s, p) => s + valorAtualizado(p), 0) * 100) / 100;
}

/** "MARIA-JOSÉ" → "Maria-José": a inicial de cada parte em maiúscula, o resto em minúscula. */
function comIniciais(palavra: string): string {
  return palavra.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, antes: string, letra: string) => antes + letra.toUpperCase());
}

/**
 * O primeiro nome. Pessoa (CPF, ou sem documento) ganha a inicial maiúscula
 * mesmo vindo em CAIXA ALTA — 49 dos 73 devedores com ficha tinham o nome
 * assim no Asaas (10/11/2026), e "Olá, JOÃO!" soa como cobrança automática.
 * Empresa (CNPJ) fica como antes: a sigla em caixa alta continua como está, e
 * o resto ganha a inicial maiúscula ("padaria" → "Padaria").
 */
function primeiroNome(nome: string, pessoa: TipoDePessoa): string {
  const limpo = nome.trim().split(/\s+/)[0] ?? "";
  if (pessoa === "juridica") {
    if (limpo.length <= 1 || limpo === limpo.toUpperCase()) return limpo;
    return limpo.charAt(0).toUpperCase() + limpo.slice(1).toLowerCase();
  }
  if (limpo.length <= 1) return limpo.toUpperCase();
  return comIniciais(limpo);
}

/** "Olá, Maria!" — ou só "Olá!" para empresa (CNPJ) e cliente sem nome. */
function saudacao(nome: string, pessoa: TipoDePessoa): string {
  const primeiro = pessoa === "juridica" ? "" : primeiroNome(nome, pessoa);
  return primeiro.length > 1 ? `Olá, ${primeiro}!` : "Olá!";
}

/**
 * A situação numa frase, para seguir "Vi aqui que …" (minúscula no começo,
 * sem ponto no fim), com singular e plural certos:
 * - uma: "a parcela 3 de 12, de R$ 450,00, venceu ontem";
 * - várias, na cobrança: "duas parcelas estão em aberto, somando R$ 900,00, e
 *   a mais antiga venceu em 11/10";
 * - várias, no lembrete: "duas parcelas vencem hoje, somando R$ 750,00";
 * - o lembrete empurrado do fim de semana/feriado acrescenta "… e pode(m) ser
 *   paga(s) hoje sem juros" (a mesma promessa do `vencimento_texto`, D17), e
 *   aí o valor é o ORIGINAL — "com juros e multa" ao lado de "sem juros" se
 *   contradiz (revisão do PR #494). Nenhuma de hoje: "venceram no fim de
 *   semana" (ou "no feriado"); umas de hoje e outras não: "venceram ou vencem
 *   hoje".
 * "parcelas" quando todas são de parcelamento; senão "cobranças".
 */
function fraseDaSituacao(lista: readonly ParcelaDoEspelho[], ehLembrete: boolean, hoje: string): string {
  if (lista.length === 0) return "";
  if (lista.length === 1) {
    const p = lista[0];
    const qual = p.parcela_numero === null ? "a cobrança" : rotuloParaOCliente(p).replace(/^Parcela/, "a parcela");
    // o lembrete empurrado do fim de semana/feriado (D17): ainda sem juros hoje
    const empurrado = ehLembrete && p.vencimento < hoje;
    const valor = comJuros(p) && !empurrado ? `${dinheiro(valorAtualizado(p))} com juros e multa` : dinheiro(p.valor);
    return `${qual}, de ${valor}, ${quandoVence(p.vencimento, hoje)}${empurrado ? " e pode ser paga hoje sem juros" : ""}`;
  }
  const n = lista.length;
  const quantas = `${NUMEROS_POR_EXTENSO[n] ?? String(n)} ${lista.every((p) => p.parcela_numero !== null) ? "parcelas" : "cobranças"}`;
  const total = dinheiro(somaAtualizada(lista));
  if (ehLembrete) {
    const deHoje = lista.filter((p) => p.vencimento === hoje).length;
    if (deHoje === n) return `${quantas} vencem hoje, somando ${total}`;
    const original = dinheiro(Math.round(lista.reduce((s, p) => s + p.valor, 0) * 100) / 100);
    const noFimDeSemana = lista.filter((p) => [0, 6].includes(diaDaSemana(p.vencimento))).length;
    const quando =
      deHoje > 0 ? "venceram ou vencem hoje" : noFimDeSemana === n ? "venceram no fim de semana" : noFimDeSemana === 0 ? "venceram no feriado" : "venceram no fim de semana e no feriado";
    return `${quantas} ${quando}, somando ${original}, e podem ser pagas hoje sem juros`;
  }
  return `${quantas} estão em aberto, somando ${total}, e a mais antiga ${quandoVence(lista[0].vencimento, hoje)}`;
}

export interface DadosDasVariaveis {
  clienteNome: string;
  /** pelo CPF/CNPJ do espelho (`tipoDePessoa`); ausente = `null`, tratado como pessoa */
  pessoa?: TipoDePessoa;
  escritorioNome: string;
  /** TODAS as vencidas do cliente, da mais antiga para a mais nova (D11) */
  vencidas: readonly ParcelaDoEspelho[];
  /** as que CRUZARAM o marco hoje (vazio no lembrete) */
  cruzaram: readonly ParcelaDoEspelho[];
  /** as que vencem hoje (o lembrete; ou a linha "e hoje vence…" da cobrança) */
  venceHoje: readonly ParcelaDoEspelho[];
  hoje: string;
  agora: Date;
  fuso?: string;
}

/**
 * As `{{vars.*}}` da mensagem (§3.6). `cobranca_detalhe` é TUDO o que o
 * cliente deve (D11); no lembrete, só o que vence hoje. `dias_de_atraso` é
 * o da parcela que cruzou o marco (vencida na sexta, o marco de 1 dia sai
 * na segunda com "3"); `dias_de_atraso_maior`, o da mais antiga.
 *
 * As do texto humano (10/11/2026): `saudacao` ("Olá, Maria!"/"Olá!"),
 * `cobranca_situacao` (a frase, com concordância) e `cobranca_links` (o link
 * sozinho quando há UMA cobrança a pagar; com várias — inclusive a que
 * vence hoje junto —, a lista com um por linha: o mesmo texto serve aos dois
 * casos, sem ramo por quantidade).
 * `vencidas_quantidade` é SEMPRE o número de vencidas (0 no
 * lembrete, ao contrário de `cobranca_quantidade`): é o que a condição
 * "Situação da cobrança" lê (`automations/situacao-da-cobranca.ts`).
 */
export function montarVariaveis(d: DadosDasVariaveis): Record<string, string> {
  const fuso = d.fuso ?? FUSO_PADRAO;
  const pessoa = d.pessoa ?? null;
  const ehLembrete = d.vencidas.length === 0 && d.venceHoje.length > 0;
  const daMensagem = ehLembrete ? d.venceHoje : d.vencidas;
  const detalhe = daMensagem.map((p) => linhaDaParcela(p, d.hoje)).join("\n");
  const maisAntiga = d.vencidas[0] ?? null;
  const cruzou = d.cruzaram[0] ?? null;
  const dias = (p: ParcelaDoEspelho | null) => (p ? String(Math.max(0, diasDeAtraso(p.vencimento, d.agora, fuso) ?? 0)) : "0");
  const venceHojeDetalhe = d.venceHoje.map((p) => linhaDaParcela(p, d.hoje)).join("\n");
  // O que dá para pagar a partir desta mensagem: as vencidas e, na cobrança
  // que sai no dia de outro vencimento, também a de hoje (D17) — assim o
  // texto não precisa da linha solta `vence_hoje_detalhe`.
  const paraPagar = ehLembrete ? d.venceHoje : [...d.vencidas, ...d.venceHoje];
  const unica = paraPagar.length === 1 ? paraPagar[0] : null;
  const linhasParaPagar = paraPagar.map((p) => linhaDaParcela(p, d.hoje)).join("\n");
  return {
    saudacao: saudacao(d.clienteNome, pessoa),
    cliente_nome: d.clienteNome.trim(),
    cliente_primeiro_nome: primeiroNome(d.clienteNome, pessoa),
    escritorio_nome: d.escritorioNome.trim(),
    cobranca_situacao: fraseDaSituacao(daMensagem, ehLembrete, d.hoje),
    cobranca_links: unica ? unica.link_fatura || unica.link_boleto || linhasParaPagar : linhasParaPagar,
    cobranca_detalhe: detalhe,
    // sem a descrição da avulsa (`rotuloParaOCliente`): pode ser anotação interna
    cobranca_parcelas: rotulosDasParcelas(daMensagem.map((p) => ({ ...p, descricao: null })), 12),
    cobranca_valor: dinheiro(somaAtualizada(ehLembrete ? d.venceHoje : d.vencidas)),
    cobranca_vencimento: maisAntiga ? diaPorExtenso(maisAntiga.vencimento) : d.venceHoje[0] ? diaPorExtenso(d.venceHoje[0].vencimento) : "",
    cobranca_quantidade: String(daMensagem.length),
    vencidas_quantidade: String(d.vencidas.length),
    dias_de_atraso: dias(cruzou),
    dias_de_atraso_maior: dias(maisAntiga),
    marco_detalhe: d.cruzaram.map((p) => linhaDaParcela(p, d.hoje)).join("\n"),
    // D17 revista (13/09): a cobrança do dia em que também vence parcela
    // ganha a linha "e hoje vence…"; no lembrete é o próprio detalhe.
    vence_hoje_detalhe: venceHojeDetalhe,
    vencimento_texto: textoDoVencimento(d.venceHoje, d.hoje),
  };
}

/** "vence hoje"; ou "venceu no sábado, 12/09 — o boleto pode ser pago hoje sem juros" (o lembrete empurrado, D17). */
export function textoDoVencimento(venceHoje: readonly ParcelaDoEspelho[], hoje: string): string {
  const passadas = venceHoje.filter((p) => p.vencimento < hoje);
  if (passadas.length === 0) return venceHoje.length > 0 ? "vence hoje" : "";
  const dia = passadas[0].vencimento;
  const nomes = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  const [, m, dd] = dia.split("-");
  return `venceu ${ehFeriadoFixo(dia) ? "no feriado" : `no ${nomes[diaDaSemana(dia)]}`}, ${dd}/${m} — o boleto pode ser pago hoje sem juros`;
}

export interface AutomacaoDaRegua {
  id: string;
  nome: string;
  tipo: "atraso" | "vence_hoje";
  /** `dias_de_atraso`; no lembrete, o TURNO da trava: 0 = do dia, 1 = da noite (1133) */
  marco: number;
  horaEnvio: string;
  somenteDiasUteis: boolean;
}

/**
 * Puro: a config do gatilho → o que a varredura precisa. `null` quando a
 * config não serve (a ativação já recusa; só chega aqui automação gravada
 * antes da validação).
 */
export function lerAutomacaoDaRegua(a: { id: string; name: string; trigger_type: string; trigger_config: unknown }): AutomacaoDaRegua | null {
  const cfg = (a.trigger_config ?? {}) as Record<string, unknown>;
  const somenteDiasUteis = cfg.somente_dias_uteis !== false;
  if (a.trigger_type === "asaas_cobranca_vence_hoje") {
    const horaEnvio = horaDeLembreteValida(cfg.hora_envio) ? cfg.hora_envio : HORA_PADRAO_LEMBRETE;
    return { id: a.id, nome: a.name, tipo: "vence_hoje", marco: turnoDaHora(horaEnvio) === "noite" ? 1 : 0, horaEnvio, somenteDiasUteis };
  }
  if (a.trigger_type === "asaas_cobranca_vencida") {
    const marco = Number(cfg.dias_de_atraso);
    if (!Number.isInteger(marco) || marco < 1 || marco > 365) return null;
    const horaEnvio = horaDeEnvioValida(cfg.hora_envio) ? cfg.hora_envio : HORA_PADRAO_COBRANCA;
    return { id: a.id, nome: a.name, tipo: "atraso", marco, horaEnvio, somenteDiasUteis };
  }
  return null;
}

/** Os dois gatilhos da régua — a lista que `runAutomationById`, o diálogo e a rota manual recusam. */
export const GATILHOS_DA_REGUA = ["asaas_cobranca_vencida", "asaas_cobranca_vence_hoje"] as const;

export function ehGatilhoDaRegua(tipo: string | null | undefined): boolean {
  return (GATILHOS_DA_REGUA as readonly string[]).includes(tipo ?? "");
}

/** As parcelas DEVIDAS (vencidas e negativadas — D6 revista) de um cliente, da mais antiga para a mais nova. */
export function vencidasDoCliente(parcelas: readonly ParcelaDoEspelho[]): ParcelaDoEspelho[] {
  return parcelas.filter((p) => ehDevida(classificar(p.status, p.deleted))).sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0));
}

/**
 * A ordem de escolha entre automações de cobrança: MAIOR marco primeiro,
 * empate pelo menor id. ⚠️ Uma cópia só — `agruparPorCliente` escolhe por ela
 * sobre o espelho, e a varredura escolhe DE NOVO por ela depois da releitura
 * no Asaas (a parcela do maior marco pode ter sido paga no meio). Duas
 * cópias do comparador divergiriam em silêncio.
 */
export function porMaiorMarco(a: Pick<AutomacaoDaRegua, "marco" | "id">, b: Pick<AutomacaoDaRegua, "marco" | "id">): number {
  return b.marco - a.marco || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export interface GrupoDeCobranca {
  asaasCustomerId: string;
  /**
   * a automação de MAIOR marco entre as que cruzaram hoje NO ESPELHO da
   * seleção — ⚠️ não é necessariamente a que manda: a varredura a re-escolhe
   * sobre as parcelas RELIDAS (`porMaiorMarco`, Codex, 4ª rodada do PR #206)
   */
  automacao: AutomacaoDaRegua;
  /** parcela → o marco que ela cruzou hoje (para as travas) */
  cruzaram: { parcela: ParcelaDoEspelho; automacao: AutomacaoDaRegua }[];
}

/**
 * Puro: agrupa por CLIENTE do Asaas, ATRAVÉS das automações (D11). Com
 * parcelas mensais, o marco de 30 dias da de agosto e o de 1 dia da de
 * setembro caem no mesmo dia: sai UMA mensagem — a da automação de maior
 * marco — e a trava de todas as parcelas que cruzaram leva o marco de cada
 * uma (as que não geraram mensagem ficam `absorvida`).
 */
export function agruparPorCliente(
  automacoes: readonly AutomacaoDaRegua[],
  parcelas: readonly ParcelaDoEspelho[],
  ctx: ContextoDaRegua,
  agora: Date,
  /**
   * `semJanela`: ignora a hora de envio — é como o lembrete das 8h descobre
   * que o cliente TEM marco às 9h e cede a vez (uma mensagem só, D17).
   */
  opcoes: { semJanela?: boolean } = {},
): GrupoDeCobranca[] {
  const grupos = new Map<string, GrupoDeCobranca>();
  // ⚠️ Ordem DETERMINÍSTICA (maior marco primeiro, depois o id) e UMA
  // entrada por PARCELA, com o MAIOR marco que ela cruzou hoje. Dois casos
  // reais entravam a mesma parcela duas vezes em `cruzaram`: duas automações
  // LIGADAS com o mesmo marco (a "régua padrão" criada duas vezes — Codex,
  // PR #206) e a MESMA parcela cruzando dois marcos no mesmo dia (venceu na
  // quarta, o espelho a viu vencida no sábado: o marco de 1 dia empurrado
  // para segunda cai no dia do marco de 5 — revisão adversarial do PR #206).
  // Nos dois, o INSERT do grupo levava duas linhas com a mesma chave, o
  // 23505 era lido como "outro processo pegou" e NINGUÉM enviava, em
  // silêncio, todo ciclo do dia — e no dia seguinte o marco já tinha
  // passado. A trava da parcela fica com o maior marco; o menor não precisa
  // de trava própria: no ciclo seguinte do mesmo dia o grupo bate na trava
  // do maior (23505) e sai, e amanhã o dia-alvo do menor já não é hoje.
  const ordenadas = automacoes.filter((a) => a.tipo === "atraso").sort(porMaiorMarco);
  for (const automacao of ordenadas) {
    const c = { ...ctx, somenteDiasUteis: automacao.somenteDiasUteis };
    if (!opcoes.semJanela && !janelaAberta(agora, ctx.hoje, automacao.horaEnvio, ctx.fuso)) continue;
    for (const p of parcelas) {
      if (!ehDevida(classificar(p.status, p.deleted))) continue;
      if (!entrouNaRegua(p, ctx.reguaAtivadaEm)) continue;
      if (!aindaPagavel(p, ctx.hoje)) continue;
      if (diaAlvoDoMarco(p, automacao.marco, c) !== ctx.hoje) continue;
      const g = grupos.get(p.asaas_customer_id) ?? { asaasCustomerId: p.asaas_customer_id, automacao, cruzaram: [] };
      // a parcela já entrou (pelo maior marco, ou por outra automação do mesmo marco): a trava é uma só
      if (g.cruzaram.some((x) => x.parcela.id === p.id)) continue;
      g.cruzaram.push({ parcela: p, automacao });
      if (automacao.marco > g.automacao.marco) g.automacao = automacao;
      grupos.set(p.asaas_customer_id, g);
    }
  }
  return [...grupos.values()];
}

export interface GrupoDeLembrete {
  asaasCustomerId: string;
  automacao: AutomacaoDaRegua;
  venceHoje: ParcelaDoEspelho[];
}

/**
 * Puro: os lembretes de hoje, por cliente e por TURNO (D17; a noite, 1133).
 * UM lembrete por turno — o de menor id: dois ligados no mesmo turno
 * disputariam a mesma trava. ⚠️ Só o do DIA cede a vez: cliente com marco de
 * cobrança cruzando hoje (`clientesComMarcoHoje`) não recebe o lembrete do
 * dia — a cobrança das 9h absorve (uma mensagem só, 13/09). Se às 9h a
 * cobrança não sair (pagou as vencidas antes), o cliente deixa de ter marco e
 * o lembrete volta a ser candidato no ciclo seguinte, dentro da janela. O da
 * NOITE lembra quem AINDA não pagou o que vence hoje, tenha recebido de manhã
 * o lembrete ou a cobrança com a linha de hoje (decisão do operador,
 * 10/11/2026) — a releitura no Asaas antes da trava tira quem pagou no dia.
 */
export function agruparLembretes(
  automacoes: readonly AutomacaoDaRegua[],
  parcelas: readonly ParcelaDoEspelho[],
  clientesComMarcoHoje: ReadonlySet<string>,
  ctx: ContextoDaRegua,
  agora: Date,
): GrupoDeLembrete[] {
  const saida: GrupoDeLembrete[] = [];
  for (const turno of [0, 1]) {
    const lembrete = automacoes
      .filter((a) => a.tipo === "vence_hoje" && a.marco === turno)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
    if (!lembrete) continue;
    if (!janelaAberta(agora, ctx.hoje, lembrete.horaEnvio, ctx.fuso, fimDaJanela(lembrete))) continue;
    const dias = new Set(diasDoLembrete(ctx.hoje, lembrete.somenteDiasUteis));
    if (dias.size === 0) continue;
    const grupos = new Map<string, GrupoDeLembrete>();
    for (const p of parcelas) {
      if (!cabeNoLembrete(p, dias, ctx.hoje)) continue;
      if (turno === 0 && clientesComMarcoHoje.has(p.asaas_customer_id)) continue;
      const g = grupos.get(p.asaas_customer_id) ?? { asaasCustomerId: p.asaas_customer_id, automacao: lembrete, venceHoje: [] };
      g.venceHoje.push(p);
      grupos.set(p.asaas_customer_id, g);
    }
    saida.push(...grupos.values());
  }
  return saida;
}

/**
 * Puro: o que o log da automação diz que aconteceu → o resultado da trava.
 * `enviado` com um passo que ENTREGA ao contato bem-sucedido
 * (`PASSOS_QUE_FALAM_COM_O_CONTATO`), qualquer que seja o desfecho;
 * `barrada` (condição) e `falhou` vêm do desfecho; sem log = a automação
 * não rodou (desligada entre a seleção e o disparo, ou fora do escopo).
 *
 * ⚠️ `na_fila`: o provedor RECUSOU o envio (4xx) e o motor o reenfileirou
 * (PR #205) — o log fica `partial`, sem desfecho, e o disparo volta com
 * `emEspera`. Não é "falhou" (vai rodar de novo em 30 s) nem "incerto"
 * (nada saiu); a varredura seguinte reconcilia pelo log (`reconciliarNaFila`).
 * A régua não tem "Aguardar" (validate.ts), então `emEspera` aqui é só isso.
 */
export function resultadoDoLog(
  log: { desfecho: string | null; steps_executed: { step_type: string; status: string }[] } | null,
  disparo: { candidatas: number; foraDoEscopo: number; executadas: number; emEspera?: number },
): "enviado" | "barrada" | "falhou" | "fora_do_escopo" | "sem_automacao" | "incerto" | "na_fila" {
  if (!log) {
    if (disparo.candidatas === 0) return "sem_automacao";
    if (disparo.executadas === 0 && disparo.foraDoEscopo > 0) return "fora_do_escopo";
    return disparo.executadas > 0 ? "incerto" : "sem_automacao";
  }
  // ⚠️ O envio bem-sucedido VENCE o desfecho: um `add_tag` que estoura
  // DEPOIS do `send_message` fecha o log como `falhou`, mas a mensagem SAIU
  // — registrá-la como `falhou` a tiraria do intervalo mínimo e outro marco
  // cobraria o cliente cedo demais (Codex, PR #206).
  const enviou = log.steps_executed.some((s) => PASSOS_QUE_FALAM_COM_O_CONTATO.has(s.step_type) && s.status === "success");
  if (enviou) return "enviado";
  if (log.desfecho === "falhou") return "falhou";
  if (log.desfecho === "barrada") return "barrada";
  if (log.desfecho === "concluida") return "barrada";
  if ((disparo.emEspera ?? 0) > 0) return "na_fila";
  // Sem desfecho e sem espera: o processo morreu no meio — pode ter saído.
  return "incerto";
}
