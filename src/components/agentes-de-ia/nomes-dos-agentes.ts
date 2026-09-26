'use client';

// ============================================================
// O NOME de cada agente de IA, para a bolha "IA · <nome>". A tabela dos
// agentes só dá SELECT ao administrador (D14): quem não é admin lê pela rota
// `GET /api/cb/ia/agentes/nomes` (id e nome, arquivados inclusive).
//
// UMA busca por página, compartilhada por todas as bolhas (um cache de
// módulo): um hook com fetch próprio em cada bolha seriam centenas de
// pedidos por conversa. Um id que a lista não tem (agente criado depois da
// busca) pede de novo — no máximo uma vez por minuto. E a lista VENCE em
// 5 min: renomear o agente com a página aberta deixava o nome antigo em toda
// bolha para sempre (Codex, #309).
// ============================================================

import { useEffect, useSyncExternalStore } from 'react';

const REBUSCAR_MS = 60_000;
const VALIDADE_MS = 5 * 60_000;

let nomes = new Map<string, string>();
let buscando = false;
let buscadoEm = 0;
const ouvintes = new Set<() => void>();

function avisar() {
  for (const f of ouvintes) f();
}

function buscar() {
  if (buscando || Date.now() - buscadoEm < REBUSCAR_MS) return;
  buscando = true;
  void fetch('/api/cb/ia/agentes/nomes', { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) return;
      const corpo = (await res.json()) as { agentes?: { id: unknown; nome: unknown }[] };
      const novo = new Map<string, string>();
      for (const a of corpo.agentes ?? []) {
        if (typeof a.id === 'string' && typeof a.nome === 'string') novo.set(a.id, a.nome);
      }
      nomes = novo;
    })
    .catch(() => {})
    .finally(() => {
      buscando = false;
      buscadoEm = Date.now();
      avisar();
    });
}

function assinar(f: () => void) {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
}

/** O nome do agente de IA (`null` enquanto não se sabe, ou sem id). */
export function useNomeDoAgenteDeIa(id: string | null | undefined): string | null {
  const nome = useSyncExternalStore(
    assinar,
    () => (id ? (nomes.get(id) ?? null) : null),
    () => null,
  );
  useEffect(() => {
    if (id && (!nomes.has(id) || Date.now() - buscadoEm > VALIDADE_MS)) buscar();
  }, [id]);
  return nome;
}
