// ------------------------------------------------------------
// Opções de um campo personalizado `select` (948).
//
// ⚠️ Módulo PURO de propósito, e isso é load-bearing: a serialização da
// API v1 (`src/lib/api/v1/custom-fields.ts`) roda dentro de um route
// handler, que o Next empacota na layer de React Server Components —
// importar esta função de um arquivo `"use client"` a transforma num
// client-reference proxy que LANÇA ao ser chamado ("Attempted to call
// opcoesDoCampo() from the server"), com build e vitest verdes
// (reproduzido no Next 16.2.12 em 2026-08-29). A UI importa daqui
// também; a função vive num lugar só.
// ------------------------------------------------------------

import type { CustomField } from '@/types';

/**
 * As opções de um campo `select`, lidas de `field_options` (JSONB).
 * Formato: `{ "opcoes": ["A", "B"] }`. Tolerante a lixo — a coluna existe
 * desde a 001 sem nunca ter sido validada, então qualquer forma inesperada
 * degrada para lista vazia em vez de quebrar a ficha (ou a rota).
 */
export function opcoesDoCampo(field: CustomField): string[] {
  const raw = field.field_options?.opcoes;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (o): o is string => typeof o === 'string' && o.trim() !== ''
  );
}
