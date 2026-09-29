'use client';

// ============================================================
// /reunioes — a pauta de reuniões. Plano: docs/PLANO-pauta-de-reunioes.md.
//
// ⚠️ Fica FORA do catálogo de perfis de propósito, como o Meu dia
// (`telaDoCaminho` devolve null e a guarda deixa passar): uma tela nova no
// catálogo nasceria invisível para todo perfil já gravado. O recorte por
// funil do perfil é feito DENTRO da tela.
//
// O `Suspense` é o que o `useSearchParams` exige numa página cliente.
// ============================================================

import { Suspense } from 'react';

import { PautaDeReunioes } from '@/components/reunioes/pauta-de-reunioes';

export default function ReunioesPage() {
  return (
    <Suspense fallback={null}>
      <PautaDeReunioes />
    </Suspense>
  );
}
