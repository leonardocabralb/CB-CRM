// ============================================================
// Alarmes de conexão no sino — a régua (Fase 2 dos alarmes, 1122).
//
// A sonda da saúde (Fase 1) acende o âmbar AO VIVO, para quem está com a tela
// aberta. Aqui se decide o que vai para o SINO, gravado pelo passo do ciclo do
// agendador (`avisar-alarmes.ts`): os dois alarmes do CRM, com as regras da
// sentinela da VPS (`ops/vps/saude-whatsapp/sentinela.py`, `decidir`):
//  · UM aviso por episódio, e "Continua" a cada 24 h enquanto ele durar;
//  · "Normalizou" só com PROVA. Medição vencida ou ausente é "não sei", e o
//    "não sei" não encerra nada (expirar não é normalizar);
//  · a prova vista com o aviso dela recusado fica guardada (`normalizou_em`)
//    e sai no ciclo seguinte, mesmo sem medição nova;
//  · "Aconteceu e já normalizou" só para o aviso que ficou DEVIDO e não entrou
//    (`devido_em`). O episódio que nunca chegou a valer aviso — o do (c) de
//    madrugada, o do (b) de 10 min — sai calado.
//
// Decisões do operador (04/11/2026, `docs/PLANO-alarmes-de-conexao.md`):
//  · D3/P3b — o (c), "envios sem recibo", só vai ao sino em HORÁRIO ÚTIL:
//    segunda a sexta, das 8h às 20h de Brasília (a janela da sentinela).
//    Aceso à noite, espera a abertura do horário e só sai se ainda estiver
//    aceso; o que acendeu e apagou fora do horário não vai ao sino. A faixa da
//    tela vale sempre (é a sonda, não isto). O "Normalizou" de um aviso que
//    já saiu vai a qualquer hora: é a notícia boa de um aviso aberto;
//  · D5 — o (b) entra no sino quando a conexão FICA atrasada 30 min: o âmbar
//    da tela (mais de 5 min, medição fresca) aceso há 30 min, a qualquer hora;
//  · D6 — lembrete a cada 24 h, sem modo sombra;
//  · D2 — recebem owner/admin E os membros cujo perfil vê a conexão.
// ============================================================

import { FUSO_PADRAO, partesNoFuso } from '@/lib/agenda/fuso';
import type { AccountRole } from '@/lib/auth/roles';
import { canalNoEscopo } from '@/lib/perfis/escopo';
import type { PerfilDeAcesso } from '@/lib/perfis/tipos';

import {
  atrasoDaFronteira,
  entregaAtrasada,
  medicaoAindaVale,
  type ParDaFronteira,
} from './atraso-de-entrega';
import { envioConfirmado, semRecibo, type EnvioRecente } from './sem-recibo';

/**
 * Os tipos do CHECK de `cb_alarmes_de_conexao.tipo` (1122; os do computador
 * de ligações, 1137), EXATAMENTE — pino `ligacoes-interruptor-1137.test.ts`.
 */
export const TIPOS_DO_ALARME = ['sem_recibo', 'atraso', 'computador_fora', 'computador_qr'] as const;
export type TipoDoAlarme = (typeof TIPOS_DO_ALARME)[number];

/**
 * O (b) vai ao sino quando o episódio de atraso DURA 30 min (D5). É a DURAÇÃO,
 * não o tamanho do atraso: de 17/09 a 04/11, todo episódio fora do incidente
 * foi reinício da Evolution e acabou em menos de 30 min — um deles com 41 min
 * de atraso máximo e 25 min de duração (plano §3b). No incidente, o âmbar
 * acendeu às 02:52 e o sino receberia às ~03:30.
 */
export const DURACAO_DO_ATRASO_NO_SINO_MS = 30 * 60_000;

/**
 * O computador de ligações (4e, §8.17 do plano das ligações) com o WhatsApp
 * pedindo o QR vai ao sino quando DURA 10 min, a contar do 1º ciclo que o viu
 * (como o (b)): o admin pareando na tela não vira alarme.
 */
export const DURACAO_DO_QR_NO_SINO_MS = 10 * 60_000;

/**
 * Os tipos que contam a DURAÇÃO do episódio antes do aviso (e antes do botão
 * das conexões, `episodioAberto`); os outros avisam aceso.
 */
const DURACAO_NO_SINO: Partial<Record<TipoDoAlarme, number>> = {
  atraso: DURACAO_DO_ATRASO_NO_SINO_MS,
  computador_qr: DURACAO_DO_QR_NO_SINO_MS,
};

/**
 * O computador de ligações sem sinal de vida há mais disto acende o
 * `computador_fora` (a máquina manda um por minuto): cobre o contêiner parado
 * e a reconstrução semanal da imagem que demorar; a troca normal leva bem
 * menos (a tela já o mostra "fora" com 3 min, `SINAL_VELHO_MS`).
 */
export const SEM_SINAL_NO_SINO_MS = 10 * 60_000;
/** O sinal que PROVA que o computador voltou (a régua da tela, `SINAL_VELHO_MS`). */
const SINAL_FRESCO_MS = 3 * 60_000;

/** "Continua" a cada 24 h enquanto o episódio durar (D6, como a sentinela). */
export const LEMBRETE_MS = 24 * 60 * 60_000;

/**
 * Segunda a sexta, das 8h às 20h de Brasília (P3b). ⚠️ O fuso é o padrão
 * (`FUSO_PADRAO`) em toda instalação, o mesmo limite da sentinela; feriado em
 * dia útil não está no calendário. O servidor roda em UTC: a hora sai de
 * `partesNoFuso`, nunca de getter local (raiz, 8f).
 */
export function emHorarioUtil(agora: Date): boolean {
  const p = partesNoFuso(agora, FUSO_PADRAO);
  return p.diaDaSemana >= 1 && p.diaDaSemana <= 5 && p.hora >= 8 && p.hora < 20;
}

/** A última medição do episódio, guardada para o texto do aviso. */
export interface DetalheDoAlarme {
  /** (b): o atraso medido, em segundos. */
  atrasoSeg?: number;
  /** (b): quando a mensagem medida chegou ao CRM (ISO). */
  medidoEmIso?: string;
}

/** O que a medição de AGORA diz de um alarme de uma conexão. */
export type Medicao =
  | { tipo: 'aceso'; desdeIso: string; detalhe: DetalheDoAlarme }
  | { tipo: 'normal'; fimIso: string }
  | { tipo: 'nao_sei' };

/**
 * (c) Envios sem recibo. `envios` nulo = a leitura falhou ("não sei"). Aceso é
 * a régua da sonda (`semRecibo`). A PROVA do fim é um envio CONFIRMADO feito
 * depois do começo do episódio ("apaga no 1º recibo"); a régua que só deixou
 * de acender (envio de menos, ninguém enviando) não prova nada.
 */
export function medirSemRecibo(
  envios: readonly EnvioRecente[] | null,
  desdeDoEpisodioIso: string | null,
  agoraMs: number,
): Medicao {
  if (envios === null) return { tipo: 'nao_sei' };
  const aceso = semRecibo(envios, agoraMs);
  if (aceso) return { tipo: 'aceso', desdeIso: aceso.desdeIso, detalhe: {} };
  if (desdeDoEpisodioIso !== null) {
    const inicio = Date.parse(desdeDoEpisodioIso);
    const voltou = envios.some(
      (e) => envioConfirmado(e.status) && Date.parse(e.criadoEm) >= inicio,
    );
    if (voltou) return { tipo: 'normal', fimIso: new Date(agoraMs).toISOString() };
  }
  return { tipo: 'nao_sei' };
}

/** O computador de ligações LIGADO, como o sinal de vida o deixou (1134/1137). */
export interface SinalDoComputador {
  ultimoSinalIso: string | null;
  /** `conectado`, `qr` ou `carregando`; nulo antes do 1º sinal. */
  whatsapp: string | null;
  /** Quando o admin ligou o interruptor: o "desde" de quem nunca deu sinal. */
  ligadoEmIso: string;
}

/**
 * `computador_fora`: sem sinal há mais de 10 min acende, com o "desde" no
 * último sinal (nunca deu sinal: desde que foi ligado). Sinal fresco prova o
 * fim. Entre os dois é "não sei" — o episódio aberto continua, nenhum começa.
 */
export function medirComputadorFora(c: SinalDoComputador, agoraMs: number): Medicao {
  const sinal = Date.parse(c.ultimoSinalIso ?? '');
  if (!Number.isFinite(sinal)) {
    return agoraMs - Date.parse(c.ligadoEmIso) > SEM_SINAL_NO_SINO_MS
      ? { tipo: 'aceso', desdeIso: c.ligadoEmIso, detalhe: {} }
      : { tipo: 'nao_sei' };
  }
  const idade = agoraMs - sinal;
  if (idade > SEM_SINAL_NO_SINO_MS) return { tipo: 'aceso', desdeIso: new Date(sinal).toISOString(), detalhe: {} };
  if (idade <= SINAL_FRESCO_MS) return { tipo: 'normal', fimIso: new Date(sinal).toISOString() };
  return { tipo: 'nao_sei' };
}

/**
 * `computador_qr`: com sinal FRESCO, o WhatsApp da máquina pedindo o QR acende
 * (o "desde" é o 1º ciclo que o viu: o sinal não conta há quanto tempo) e
 * conectado prova o fim. Sem sinal fresco ou carregando, "não sei" — o
 * `computador_fora` é quem fala da máquina parada.
 */
export function medirComputadorQr(c: SinalDoComputador, agoraMs: number): Medicao {
  const sinal = Date.parse(c.ultimoSinalIso ?? '');
  if (!Number.isFinite(sinal) || agoraMs - sinal > SINAL_FRESCO_MS) return { tipo: 'nao_sei' };
  if (c.whatsapp === 'qr') return { tipo: 'aceso', desdeIso: new Date(agoraMs).toISOString(), detalhe: {} };
  if (c.whatsapp === 'conectado') return { tipo: 'normal', fimIso: new Date(sinal).toISOString() };
  return { tipo: 'nao_sei' };
}

/**
 * (b) Atraso de entrega, pela fronteira da 1002 e com a régua do âmbar da tela:
 * medição FRESCA (até 1 h) com mais de 5 min acende; fresca com até 5 min
 * prova o fim; vencida ou ausente é "não sei" — o episódio aberto continua, e
 * nenhum novo começa. O `desde` é quando a mensagem medida chegou: dali o
 * âmbar está aceso, no mínimo.
 */
export function medirAtraso(par: ParDaFronteira, agoraMs: number): Medicao {
  const atrasoSeg = atrasoDaFronteira(par);
  const medidoEmIso = par.recebidaIso;
  if (atrasoSeg === null || medidoEmIso === null || !medicaoAindaVale(medidoEmIso, agoraMs)) {
    return { tipo: 'nao_sei' };
  }
  if (entregaAtrasada(atrasoSeg)) {
    return { tipo: 'aceso', desdeIso: medidoEmIso, detalhe: { atrasoSeg, medidoEmIso } };
  }
  return { tipo: 'normal', fimIso: medidoEmIso };
}

/** Uma linha de `cb_alarmes_de_conexao`, já traduzida. */
export interface EstadoDoAlarme {
  desdeIso: string;
  /** Quando o sino recebeu o último aviso do episódio. Nulo = ainda não. */
  avisadoEmIso: string | null;
  /** A prova do fim já veio e o aviso dela ainda não entrou. */
  normalizouEmIso: string | null;
  /** O aviso ficou devido e não entrou (o sino recusou, ou não havia a quem). */
  devidoEmIso: string | null;
  detalhe: DetalheDoAlarme;
}

/**
 * - `novo`: o 1º aviso do episódio;
 * - `lembrete`: 24 h depois do último, ainda aceso;
 * - `sem_prova`: 24 h depois do último, sem medição que diga se acabou;
 * - `normalizou`: a prova do fim de um episódio avisado;
 * - `passou`: a prova do fim de um episódio cujo aviso ficou devido e não entrou.
 */
export type Motivo = 'novo' | 'lembrete' | 'sem_prova' | 'normalizou' | 'passou';

export interface Passo {
  motivo: Motivo | null;
  /**
   * O estado a gravar. Com aviso, a escrita cercada dele é a REIVINDICAÇÃO
   * (raiz, 8e) e vai na MESMA transação do aviso. `null` = a linha sai.
   */
  depois: EstadoDoAlarme | null;
  /**
   * Com aviso: o estado que fica se ele NÃO entrar (marcado como devido, para
   * o fim virar "Aconteceu e já normalizou"), e o que o texto descreve. Sem
   * aviso, `null`.
   */
  seFalhar: EstadoDoAlarme | null;
}

/** NUNCA lança: a decisão inteira é pura. */
export function decidir(
  tipo: TipoDoAlarme,
  atual: EstadoDoAlarme | null,
  medicao: Medicao,
  agoraMs: number,
  horarioUtil: boolean,
): Passo {
  const agoraIso = new Date(agoraMs).toISOString();
  // P3b: o (c) só vai ao sino em horário útil; o (b), a qualquer hora. Os do
  // computador de ligações, como o (c): ligação é coisa do horário de trabalho.
  const podeAvisar = tipo === 'atraso' || horarioUtil;
  const duracao = DURACAO_NO_SINO[tipo];

  const ficar = (e: EstadoDoAlarme | null): Passo => ({ motivo: null, depois: e, seFalhar: null });
  const avisar = (motivo: 'novo' | 'lembrete' | 'sem_prova', e: EstadoDoAlarme): Passo => ({
    motivo,
    depois: { ...e, avisadoEmIso: agoraIso, devidoEmIso: null },
    seFalhar: { ...e, devidoEmIso: e.devidoEmIso ?? agoraIso },
  });
  const lembreteVenceu = (e: EstadoDoAlarme) =>
    e.avisadoEmIso !== null && agoraMs - Date.parse(e.avisadoEmIso) >= LEMBRETE_MS;

  /** O fim com prova. O "Normalizou" vai a qualquer hora; o resto, só se devido. */
  const encerrar = (e: EstadoDoAlarme, fimIso: string): Passo => {
    const guardado: EstadoDoAlarme = { ...e, normalizouEmIso: fimIso };
    if (e.avisadoEmIso !== null) return { motivo: 'normalizou', depois: null, seFalhar: guardado };
    // Nunca valeu aviso (o (c) de madrugada, o (b) de 10 min): sai calado.
    if (e.devidoEmIso === null) return ficar(null);
    // Devido e recusado: "Aconteceu e já normalizou", e o do (c) espera o horário.
    if (!podeAvisar) return ficar(guardado);
    return { motivo: 'passou', depois: null, seFalhar: guardado };
  };

  /** O episódio aberto, aceso ou "não sei": avisa o que estiver vencido. */
  const seguir = (e: EstadoDoAlarme, aceso: boolean): Passo => {
    if (!podeAvisar) return ficar(e);
    if (e.avisadoEmIso === null) {
      const durou = duracao === undefined || agoraMs - Date.parse(e.desdeIso) >= duracao;
      // P3b: o (c) só avisa ACESO ("se ainda estiver aceso"); o computador
      // também (o QR com a máquina carregando ou parada não é "pede o QR" —
      // revisão da 4e). D5: só o (b) avisa o episódio que DUROU 30 min mesmo
      // sem medição — expirar não normaliza.
      const devido = durou && (aceso || tipo === 'atraso');
      return devido ? avisar('novo', e) : ficar(e);
    }
    if (lembreteVenceu(e)) return avisar(aceso ? 'lembrete' : 'sem_prova', e);
    return ficar(e);
  };

  if (medicao.tipo === 'aceso') {
    const vivo: EstadoDoAlarme = {
      // O (b) e o QR contam a duração do 1º momento visto. O (c) ainda não
      // avisado acompanha a sequência de AGORA: a linha de uma noite sem prova
      // não empresta o "desde" dela a um episódio da manhã. Avisado, fica o
      // dito. O computador sem sinal fica com o "desde" do episódio.
      desdeIso:
        atual === null
          ? medicao.desdeIso
          : tipo === 'sem_recibo' && atual.avisadoEmIso === null
            ? medicao.desdeIso
            : atual.desdeIso,
      avisadoEmIso: atual?.avisadoEmIso ?? null,
      // Voltou antes de o "Normalizou" entrar: a prova guardada deixa de valer.
      normalizouEmIso: null,
      devidoEmIso: atual?.devidoEmIso ?? null,
      detalhe: medicao.detalhe,
    };
    return seguir(vivo, true);
  }

  if (atual === null) return ficar(null);
  if (atual.normalizouEmIso !== null) return encerrar(atual, atual.normalizouEmIso);
  if (medicao.tipo === 'normal') return encerrar(atual, medicao.fimIso);
  // Não sei: só a prova encerra.
  return seguir(atual, false);
}

/** Um episódio do sino ainda aberto, como o botão das conexões o mostra (E1). */
export interface EpisodioAberto {
  tipo: TipoDoAlarme;
  desdeIso: string;
}

/**
 * E1 (Fase 3): o episódio GUARDADO continua aberto para o botão das conexões
 * do cabeçalho? É isso que faz o alarme da madrugada ser visto às 8h: a sonda
 * ao vivo apaga quando a medição envelhece, e o episódio só fecha com PROVA
 * (expirar não normaliza). As regras são as do `decidir`:
 *  · a prova de agora fecha já — a linha só sai no ciclo seguinte (até
 *    ~16 min), e o botão não espera por ela; a guardada em `normalizou_em`
 *    também, MENOS se a medição acendeu de novo (o `decidir` a anula);
 *  · o (b) só conta depois de DURAR 30 min (D5): antes disso é o reinício da
 *    Evolution, que a faixa da conversa e o glifo já mostram;
 *  · o (c) que o sino CALA (P3b: visto fora do horário útil, nunca avisado
 *    nem devido) só aparece enquanto ACESO — guardado e apagado, seria o falso
 *    positivo noturno do robô para lead frio, de manhã, até o 1º recibo. O
 *    ainda não avisado acompanha a sequência de AGORA.
 */
export function episodioAberto(
  tipo: TipoDoAlarme,
  estado: EstadoDoAlarme | null,
  medicao: Medicao,
  agoraMs: number,
): EpisodioAberto | null {
  if (estado === null || medicao.tipo === 'normal') return null;
  const aceso = medicao.tipo === 'aceso';
  if (estado.normalizouEmIso !== null && !aceso) return null;
  const duracao = DURACAO_NO_SINO[tipo];
  // O QR do computador ainda não avisado só aparece ACESO (como no sino).
  if (tipo === 'computador_qr' && !aceso && estado.avisadoEmIso === null && estado.devidoEmIso === null) return null;
  if (duracao !== undefined) {
    return agoraMs - Date.parse(estado.desdeIso) >= duracao ? { tipo, desdeIso: estado.desdeIso } : null;
  }
  if (!aceso && estado.avisadoEmIso === null && estado.devidoEmIso === null) return null;
  const desdeIso = aceso && estado.avisadoEmIso === null ? medicao.desdeIso : estado.desdeIso;
  return { tipo, desdeIso };
}

/** Um membro da conta, com o papel e o perfil REAIS (nunca o do "Ver como"). */
export interface MembroDaConta {
  userId: string;
  papel: AccountRole | null;
  perfil: PerfilDeAcesso | null;
}

/**
 * Quem recebe o aviso de uma conexão (D2): owner/admin e os membros cujo
 * perfil vê a conexão. O recorte é o do perfil (`canalNoEscopo`): sem perfil
 * ou com a lista vazia, vê todas. O suspenso fica de fora já na leitura (e a
 * função do banco confere de novo).
 */
export function destinatarios(membros: readonly MembroDaConta[], channelId: string): string[] {
  const ids = new Set<string>();
  for (const m of membros) {
    if (
      m.papel === 'owner' ||
      m.papel === 'admin' ||
      canalNoEscopo({ papel: m.papel, perfil: m.perfil }, channelId)
    ) {
      ids.add(m.userId);
    }
  }
  return [...ids];
}

/** O `t` do namespace `AlarmesDeConexao`, de qualquer origem. */
export type Tradutor = (chave: string, valores?: Record<string, string | number>) => string;

function tempoDoAtraso(t: Tradutor, segundos: number): string {
  const minutos = Math.round(segundos / 60);
  if (minutos < 120) return t('tempo.minutos', { minutos });
  return t('tempo.horas', { horas: Math.floor(minutos / 60), minutos: minutos % 60 });
}

function textoDoProblema(
  t: Tradutor,
  quando: (iso: string) => string,
  tipo: TipoDoAlarme,
  estado: EstadoDoAlarme,
  canal: string,
): { titulo: string; corpo: string } {
  if (tipo === 'sem_recibo') {
    return {
      titulo: t('semRecibo.titulo', { canal }),
      corpo: t('semRecibo.corpo', { desde: quando(estado.desdeIso) }),
    };
  }
  if (tipo === 'computador_fora') {
    return {
      titulo: t('computadorFora.titulo', { canal }),
      corpo: t('computadorFora.corpo', { desde: quando(estado.desdeIso) }),
    };
  }
  if (tipo === 'computador_qr') {
    return {
      titulo: t('computadorQr.titulo', { canal }),
      corpo: t('computadorQr.corpo', { desde: quando(estado.desdeIso) }),
    };
  }
  const { atrasoSeg, medidoEmIso } = estado.detalhe;
  return {
    titulo: t('atraso.titulo', { canal }),
    corpo:
      typeof atrasoSeg === 'number' && typeof medidoEmIso === 'string'
        ? t('atraso.corpo', { tempo: tempoDoAtraso(t, atrasoSeg), quando: quando(medidoEmIso) })
        : t('atraso.semMedida', { desde: quando(estado.desdeIso) }),
  };
}

/**
 * O título e o corpo do aviso, no idioma da instalação. `estado` é o que o
 * texto descreve (o `seFalhar` do passo). `quando` formata um instante na
 * hora de Brasília.
 */
export function textosDoAviso(
  t: Tradutor,
  quando: (iso: string) => string,
  tipo: TipoDoAlarme,
  motivo: Motivo,
  estado: EstadoDoAlarme,
  canal: string,
): { titulo: string; corpo: string } {
  const problema = textoDoProblema(t, quando, tipo, estado, canal);
  const fim = quando(estado.normalizouEmIso ?? estado.desdeIso);
  switch (motivo) {
    case 'novo':
      return problema;
    case 'lembrete':
      return { titulo: t('continua', { titulo: problema.titulo }), corpo: problema.corpo };
    case 'sem_prova':
      return {
        titulo: t('continua', { titulo: problema.titulo }),
        corpo: t('semProva', { desde: quando(estado.desdeIso) }),
      };
    case 'normalizou':
      return {
        titulo: t('normalizou', { titulo: problema.titulo }),
        corpo: t('normalizouCorpo', { fim, inicio: quando(estado.desdeIso) }),
      };
    case 'passou':
      return {
        titulo: t('passou', { titulo: problema.titulo }),
        corpo: t('passouCorpo', { corpo: problema.corpo, fim }),
      };
    default: {
      const nunca: never = motivo;
      return nunca;
    }
  }
}
