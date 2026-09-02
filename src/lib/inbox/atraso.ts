// ============================================================
// Atraso de resposta na caixa de entrada (pedido do operador, 2026-09-02).
//
// "Se a última mensagem foi do cliente e passaram 10 minutos sem resposta
// nossa e sem a conversa ser encerrada, a linha precisa de um alerta visual."
//
// A pergunta "o cliente está esperando desde quando?" é respondida pelo
// BANCO, não por esta máquina: `conversations.aguardando_desde` é mantida por
// gatilho na 972 — mensagem do cliente preenche (só se estiver vazia: o
// relógio conta da PRIMEIRA mensagem sem resposta, não da última), resposta
// de GENTE limpa, encerrar limpa. São seis escritores de mensagem, e a trilha
// da 912 já ensinou que regra com N escritores mora em gatilho.
//
// ⚠️ "Resposta de gente" é `sender_id` preenchido OU `from_device` (a régua do
// Radar, medida em produção: 948 mensagens da equipe saem pelo celular
// pareado e 8 pelo CRM). Broadcast, fluxo, automação e IA NÃO fecham a
// espera — um disparo em massa apagaria o alerta de todo cliente esquecido
// (a armadilha que o Radar já documenta). Se um dia o robô tiver de contar
// como resposta, o lugar é a função do gatilho, não aqui.
//
// Aqui fica só a régua: puro, para o teste, e para a linha da lista não
// carregar aritmética de tempo.
// ============================================================

import type { Conversation } from "@/types";

/** Dez minutos: o número que o operador pediu. */
export const ATRASO_DE_RESPOSTA_MS = 10 * 60_000;

export interface Atraso {
  /** Quanto tempo o cliente espera, na unidade mais legível. */
  n: number;
  unidade: "min" | "h" | "d";
}

/**
 * `null` = sem alerta. Com alerta, quanto tempo o cliente já espera.
 *
 * Encerrada nunca alerta (o gatilho zera a coluna, mas a lista pode estar
 * segurando a linha velha por um instante); grupo também não — a coluna
 * nasce nula lá, e a régua de "cliente esperando" não faz sentido com trinta
 * participantes. Coluna ausente (deploy antes da migration) é o mesmo que
 * "ninguém esperando": a tela degrada para o que era, sem erro.
 */
export function atrasoDeResposta(
  c: Pick<Conversation, "status" | "group_id" | "aguardando_desde">,
  agoraMs: number,
): Atraso | null {
  if (!c.aguardando_desde || c.status === "closed" || c.group_id) return null;
  const desde = Date.parse(c.aguardando_desde);
  if (Number.isNaN(desde)) return null;
  const espera = agoraMs - desde;
  if (espera < ATRASO_DE_RESPOSTA_MS) return null;

  const minutos = Math.floor(espera / 60_000);
  if (minutos < 60) return { n: minutos, unidade: "min" };
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return { n: horas, unidade: "h" };
  return { n: Math.floor(horas / 24), unidade: "d" };
}
