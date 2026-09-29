'use client';

import { useCallback, useEffect, useState } from 'react';

import { lerPauta, type AlvosDoFunil, type ReuniaoDaPauta } from '@/lib/reunioes/pauta';

interface Pauta {
  reunioes: ReuniaoDaPauta[];
  funis: Record<string, AlvosDoFunil>;
}

/**
 * Lê a pauta de reuniões da janela pedida (`/api/cb/reunioes`).
 *
 * ⚠️ O resultado é CARIMBADO com a janela que o pediu, e `carregando` é
 * DERIVADO do carimbo: ao trocar de semana, o primeiro render já tem a janela
 * nova e os dados da velha — sem o carimbo, a semana anterior apareceria sob o
 * título da nova até a resposta chegar (a armadilha do efeito passivo).
 *
 * `recarregar` é SILENCIOSO: a janela é a mesma, então a tela continua com o
 * que tem até a resposta nova chegar (é o que o voltar ao app e a volta de
 * cada marcação pedem). Falha numa recarga mantém a pauta que já estava.
 *
 * `null` em `pauta` é "não sei", nunca "não há reunião".
 */
export function usePautaDeReunioes(janela: { de: string; ate: string }) {
  const chave = `${janela.de}|${janela.ate}`;
  const [lido, setLido] = useState<{ chave: string; pauta: Pauta | null; falhou: boolean } | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let vivo = true;
    (async () => {
      let pauta: Pauta | null = null;
      try {
        const qs = new URLSearchParams({ de: janela.de, ate: janela.ate });
        const res = await fetch(`/api/cb/reunioes?${qs.toString()}`, { cache: 'no-store' });
        if (res.ok) pauta = lerPauta(await res.json());
      } catch {
        pauta = null;
      }
      if (!vivo) return;
      setLido((antes) =>
        pauta
          ? { chave, pauta, falhou: false }
          : // A recarga que falha não apaga a pauta desta mesma janela.
            { chave, pauta: antes?.chave === chave ? antes.pauta : null, falhou: true },
      );
    })();
    return () => {
      vivo = false;
    };
  }, [chave, janela.de, janela.ate, versao]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  const doPedido = lido?.chave === chave ? lido : null;
  return {
    pauta: doPedido?.pauta ?? null,
    carregando: doPedido === null,
    falhou: doPedido?.falhou ?? false,
    recarregar,
  };
}
