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
//    e sai no ciclo seguinte, mesmo sem medição nova.
//
// Decisões do operador (04/11/2026, `docs/PLANO-alarmes-de-conexao.md`):
//  · D3/P3b — o (c), "envios sem recibo", só vai ao sino em HORÁRIO ÚTIL:
//    segunda a sexta, das 8h às 20h de Brasília (a janela da sentinela).
//    Aceso à noite, espera a abertura do horário e só sai se ainda estiver
//    aceso; o que acendeu e apagou fora do horário não vai ao sino. A faixa da
//    tela vale sempre (é a sonda, não isto). O "Normalizou" de um aviso que
//    já saiu vai a qualquer hora: é a notícia boa de um aviso aberto;
//  · D5 — o (b), atraso de entrega, entra no sino com 30 min, a qualquer hora;
//  · D6 — lembrete a cada 24 h, sem modo sombra;
//  · D2 — recebem owner/admin E os membros cujo perfil vê a conexão.
// ============================================================

import { FUSO_PADRAO, partesNoFuso } from '@/lib/agenda/fuso';
import type { AccountRole } from '@/lib/auth/roles';
import { canalNoEscopo } from '@/lib/perfis/escopo';
import type { PerfilDeAcesso } from '@/lib/perfis/tipos';

import { LIMIAR_ATRASO_SEG, atrasoDaFronteira, medicaoAindaVale, type ParDaFronteira } from './atraso-de-entrega';
import { envioConfirmado, semRecibo, type EnvioRecente } from './sem-recibo';

export type TipoDoAlarme = 'sem_recibo' | 'atraso';

/**
 * O (b) acende no SINO com 30 min de atraso (D5), não com os 5 min do âmbar da
 * tela: de 17/09 a 04/11, todo atraso fora do incidente foi reinício da
 * Evolution e passou em menos de 30 min (medido, plano §3b).
 */
export const ATRASO_DO_SINO_SEG = 30 * 60;

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

/**
 * (b) Atraso de entrega, pela fronteira da 1002. Só a medição FRESCA (até 1 h,
 * a validade da tela) decide: com 30 min ou mais, acende; com até 5 min (o
 * limiar da tela), prova o fim. Entre os dois, ou com a medição vencida, é
 * "não sei": o episódio aberto continua, e nenhum novo começa.
 */
export function medirAtraso(par: ParDaFronteira, agoraMs: number): Medicao {
  const atrasoSeg = atrasoDaFronteira(par);
  const medidoEmIso = par.recebidaIso;
  if (atrasoSeg === null || medidoEmIso === null || !medicaoAindaVale(medidoEmIso, agoraMs)) {
    return { tipo: 'nao_sei' };
  }
  if (atrasoSeg >= ATRASO_DO_SINO_SEG) {
    // O episódio começa, no mínimo, quando a mensagem medida foi carimbada:
    // desde ali ela esperava na fila.
    return { tipo: 'aceso', desdeIso: par.carimboIso!, detalhe: { atrasoSeg, medidoEmIso } };
  }
  if (atrasoSeg <= LIMIAR_ATRASO_SEG) return { tipo: 'normal', fimIso: medidoEmIso };
  return { tipo: 'nao_sei' };
}

/** Uma linha de `cb_alarmes_de_conexao`, já traduzida. */
export interface EstadoDoAlarme {
  desdeIso: string;
  /** Quando o sino recebeu o último aviso do episódio. Nulo = ainda não. */
  avisadoEmIso: string | null;
  /** A prova do fim já veio e o aviso dela ainda não entrou. */
  normalizouEmIso: string | null;
  detalhe: DetalheDoAlarme;
}

/**
 * - `novo`: o 1º aviso do episódio;
 * - `lembrete`: 24 h depois do último, ainda aceso;
 * - `sem_prova`: 24 h depois do último, sem medição que diga se acabou;
 * - `normalizou`: a prova do fim de um episódio avisado;
 * - `passou`: a prova do fim de um episódio que não chegou a ir ao sino.
 */
export type Motivo = 'novo' | 'lembrete' | 'sem_prova' | 'normalizou' | 'passou';

export interface Passo {
  motivo: Motivo | null;
  /**
   * O estado a gravar: com aviso, gravá-lo é a REIVINDICAÇÃO (raiz, 8e) — só
   * quem ganha a escrita cercada manda o aviso. `null` = a linha sai.
   */
  depois: EstadoDoAlarme | null;
  /**
   * Com aviso: o estado que fica se ele NÃO entrar no sino (para o próximo
   * ciclo tentar de novo), e o que o texto descreve. Sem aviso, `null`.
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
  // P3b: o (c) só vai ao sino em horário útil; o (b), a qualquer hora.
  const podeAvisar = tipo === 'atraso' || horarioUtil;
  const ficar = (e: EstadoDoAlarme | null): Passo => ({ motivo: null, depois: e, seFalhar: null });
  const avisar = (motivo: Motivo, e: EstadoDoAlarme): Passo => ({
    motivo,
    depois: { ...e, avisadoEmIso: agoraIso },
    seFalhar: e,
  });
  const lembreteVenceu = (e: EstadoDoAlarme) =>
    e.avisadoEmIso !== null && agoraMs - Date.parse(e.avisadoEmIso) >= LEMBRETE_MS;

  if (medicao.tipo === 'aceso') {
    // Voltou antes de o "Normalizou" entrar: a prova guardada deixa de valer.
    const vivo: EstadoDoAlarme = {
      desdeIso: atual?.desdeIso ?? medicao.desdeIso,
      avisadoEmIso: atual?.avisadoEmIso ?? null,
      normalizouEmIso: null,
      detalhe: medicao.detalhe,
    };
    if (!podeAvisar) return ficar(vivo);
    if (vivo.avisadoEmIso === null) return avisar('novo', vivo);
    if (lembreteVenceu(vivo)) return avisar('lembrete', vivo);
    return ficar(vivo);
  }

  if (atual === null) return ficar(null);

  if (medicao.tipo === 'normal' || atual.normalizouEmIso !== null) {
    const fimIso =
      atual.normalizouEmIso ?? (medicao.tipo === 'normal' ? medicao.fimIso : agoraIso);
    const guardado: EstadoDoAlarme = { ...atual, normalizouEmIso: fimIso };
    if (atual.avisadoEmIso !== null) return { motivo: 'normalizou', depois: null, seFalhar: guardado };
    if (podeAvisar) return { motivo: 'passou', depois: null, seFalhar: guardado };
    // (c) que acendeu e apagou fora do horário útil: não vai ao sino (P3b).
    return ficar(null);
  }

  // Não sei: só a prova encerra.
  if (!podeAvisar) return ficar(atual);
  if (atual.avisadoEmIso === null) {
    // O (b) visto e não avisado (o sino recusou) avisa mesmo sem medição nova,
    // como a sentinela. O (c) só avisa ACESO (P3b: "se ainda estiver aceso").
    return tipo === 'atraso' ? avisar('novo', atual) : ficar(atual);
  }
  if (lembreteVenceu(atual)) return avisar('sem_prova', atual);
  return ficar(atual);
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
 * ou com a lista vazia, vê todas. O suspenso fica de fora já na leitura.
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
