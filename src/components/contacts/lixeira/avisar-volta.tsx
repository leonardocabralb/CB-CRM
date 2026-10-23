'use client';

import { toast } from 'sonner';

import type { RespostaDaVolta } from '@/hooks/use-lixeira';
import { somarRessalvas, type MotivoDaLixeira } from '@/lib/contacts/lixeira';

import { textoDoMotivo, textosDasRessalvas, type TradutorDaLixeira } from './textos-da-lixeira';

// ============================================================
// O que dizer depois de uma restauração — o "Desfazer" do toast de mover e
// os botões da Lixeira chamam a mesma função do banco, e dizem a mesma
// coisa daqui.
//
// ⚠️ O toast conta as que VOLTARAM, nunca as pedidas. Cada ressalva
// (agendada que voltou como falha, registro que não voltou…) aparece
// escrita: restaurar "com sucesso" calando o que ficou diferente seria
// afirmar que tudo voltou como estava.
// ============================================================

function Linhas({ linhas }: { linhas: readonly string[] }) {
  if (linhas.length === 0) return null;
  return (
    <ul className="mt-1 list-disc space-y-0.5 pl-4">
      {linhas.map((linha) => (
        <li key={linha}>{linha}</li>
      ))}
    </ul>
  );
}

export function avisarVolta(
  t: TradutorDaLixeira,
  resposta: RespostaDaVolta,
  opcoes?: {
    /** O nome da ficha, quando é UMA (a tela da Lixeira sabe; o "Desfazer" não). */
    nomeDoItem?: (itemId: string) => string | null;
    /** "Abrir a ficha" no toast de UMA ficha restaurada. */
    abrirFicha?: (contactId: string) => void;
  },
): void {
  if (!resposta.ok) {
    toast.error(t('volta.falhou'), { description: textoDoMotivo(t, resposta.motivo) });
    return;
  }

  const voltaram = resposta.itens.filter((i) => i.resultado === 'restaurada');
  const recusadas = resposta.itens.filter((i) => i.resultado === 'recusada');
  const sumiram = resposta.itens.filter((i) => i.resultado === 'sumiu');

  if (voltaram.length > 0) {
    const ressalvas = textosDasRessalvas(t, somarRessalvas(voltaram));
    const uma = voltaram.length === 1 ? voltaram[0] : null;
    const nome = uma ? (opcoes?.nomeDoItem?.(uma.itemId) ?? null) : null;
    const abrir = opcoes?.abrirFicha;
    const contactId = uma?.contactId ?? null;
    toast.success(
      nome ? t('volta.restaurada', { nome }) : t('volta.restauradas', { count: voltaram.length }),
      {
        description: ressalvas.length > 0 ? <Linhas linhas={ressalvas} /> : undefined,
        // Com ressalva escrita, o padrão de 4 s some antes de a pessoa ler.
        duration: ressalvas.length > 0 ? 15_000 : undefined,
        action:
          abrir && contactId
            ? { label: t('volta.abrirFicha'), onClick: () => abrir(contactId) }
            : undefined,
      },
    );
  }

  if (recusadas.length > 0) {
    // Um motivo por linha, sem repetir; a identidade ocupada diz de quem é.
    const motivos = [
      ...new Set(recusadas.map((i) => i.motivo ?? ('falhou' as MotivoDaLixeira))),
    ];
    const ocupadas = recusadas
      .filter((i) => i.motivo === 'identidade_ocupada' && i.ocupadaPorNome)
      .map((i) => i.ocupadaPorNome as string);
    const linhas = motivos.map((m) => textoDoMotivo(t, m));
    if (ocupadas.length > 0) linhas.push(t('volta.ocupadaPor', { nomes: [...new Set(ocupadas)].join(', ') }));
    toast.error(t('volta.naoVoltaram', { count: recusadas.length }), {
      description: <Linhas linhas={linhas} />,
      duration: 15_000,
    });
  }

  if (sumiram.length > 0) {
    toast.info(t('volta.sumiram', { count: sumiram.length }));
  }

  if (resposta.itens.length === 0) {
    // Nada na Lixeira com esse pedido (outro já restaurou ou excluiu tudo).
    toast.info(t('volta.nadaNaLixeira'));
  }
}
