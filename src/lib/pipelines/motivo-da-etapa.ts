// ============================================================
// Qual campo de MOTIVO cada etapa pergunta (1112).
//
// Plano: docs/PLANO-motivos-de-perda.md. A etapa aponta para um campo
// personalizado do tipo Lista (`pipeline_stages.campo_do_motivo_id`); quem
// leva o card até ela escolhe o motivo (Fase 2) e o passo da automação o
// grava (Fase 3).
//
// ⚠️ O banco confere só a CONTA do campo (gatilho da 1112). O TIPO é
// conferido aqui, por quem lê: o operador pode trocar o tipo do campo depois
// de ligá-lo à etapa, e o gatilho não o barra de propósito (travaria o
// "Salvar" de Gerenciar funil). Campo que deixou de ser Lista, ou que ficou
// sem opção, não serve para perguntar — e a tela de configuração AVISA, em
// vez de mostrar "não pergunta" sobre uma etapa configurada.
//
// Módulo puro: a tela de configuração, a janela e o motor das automações
// leem a mesma regra.
// ============================================================

import { opcoesDoCampo } from '@/lib/contacts/campo-opcoes';
import type { CustomField, PipelineStage } from '@/types';

/** Um campo serve para guardar motivo: é Lista e tem ao menos uma opção. */
export function serveParaMotivo(campo: CustomField): boolean {
  return campo.field_type === 'select' && opcoesDoCampo(campo).length > 0;
}

/** Os campos que o seletor de Gerenciar funil oferece, na ordem recebida. */
export function camposDeMotivo(campos: CustomField[]): CustomField[] {
  return campos.filter(serveParaMotivo);
}

/**
 * Como está o motivo de uma etapa, contra o catálogo de campos da conta:
 * - `nenhum`: a etapa não pergunta (coluna nula);
 * - `ok`: aponta para um campo que serve (`campo`);
 * - `nao_serve`: o campo existe mas deixou de ser Lista ou ficou sem opção;
 * - `sumiu`: o id não está no catálogo (a FK zera o apagado, então isto é
 *   catálogo velho ou de outra conta — nunca afirmar "não pergunta").
 */
export type MotivoDaEtapa =
  | { estado: 'nenhum' }
  | { estado: 'ok'; campo: CustomField }
  | { estado: 'nao_serve'; campo: CustomField }
  | { estado: 'sumiu'; campoId: string };

export function motivoDaEtapa(
  etapa: Pick<PipelineStage, 'campo_do_motivo_id'>,
  campos: CustomField[],
): MotivoDaEtapa {
  const id = etapa.campo_do_motivo_id;
  if (!id) return { estado: 'nenhum' };
  const campo = campos.find((c) => c.id === id);
  if (!campo) return { estado: 'sumiu', campoId: id };
  return serveParaMotivo(campo) ? { estado: 'ok', campo } : { estado: 'nao_serve', campo };
}

/** O campo que a etapa pergunta, só quando ele serve. */
export function campoDoMotivo(
  etapa: Pick<PipelineStage, 'campo_do_motivo_id'>,
  campos: CustomField[],
): CustomField | null {
  const motivo = motivoDaEtapa(etapa, campos);
  return motivo.estado === 'ok' ? motivo.campo : null;
}
