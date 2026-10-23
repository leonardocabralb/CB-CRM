import type { useTranslations } from 'next-intl';

import type { MotivoDaLixeira, Ressalva, TipoDeRessalva } from '@/lib/contacts/lixeira';

// ============================================================
// As frases da Lixeira que saem de um CÓDIGO do banco: o motivo de uma
// recusa e as ressalvas de uma restauração.
//
// ⚠️ Chave MONTADA (`motivos.<motivo>`, `ressalvas.<tipo>`): o portão de i18n
// só a CONTA. Quem cobra a frase nos dois dicionários é
// `textos-da-lixeira.test.ts`, que percorre `MOTIVOS_DA_LIXEIRA` e
// `TIPOS_DE_RESSALVA` (colhidos do tipo) com ESTAS funções de chave.
// ============================================================

export type TradutorDaLixeira = ReturnType<typeof useTranslations<'Contacts.lixeira'>>;

export function chaveDoMotivo(motivo: MotivoDaLixeira): `motivos.${MotivoDaLixeira}` {
  return `motivos.${motivo}`;
}

export function chaveDaRessalva(tipo: TipoDeRessalva): `ressalvas.${TipoDeRessalva}` {
  return `ressalvas.${tipo}`;
}

/** A frase de uma recusa. */
export function textoDoMotivo(t: TradutorDaLixeira, motivo: MotivoDaLixeira): string {
  return t(chaveDoMotivo(motivo));
}

/** Uma frase por ressalva, com o número (`{n}` no plural do ICU). */
export function textosDasRessalvas(t: TradutorDaLixeira, ressalvas: readonly Ressalva[]): string[] {
  return ressalvas.map((r) => t(chaveDaRessalva(r.tipo), { n: r.n }));
}
