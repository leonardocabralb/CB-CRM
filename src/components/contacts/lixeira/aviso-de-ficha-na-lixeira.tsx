'use client';

// ============================================================
// O AVISO "há uma ficha desta pessoa na Lixeira" (1101) inteiro: a faixa e
// o "Restaurar e unir". Mora no fio da conversa e no formulário do card
// aberto pelo quadro — os mesmos lugares do aviso de possível duplicata.
//
// Só ADMIN (`delete-contacts`, o poder da Lixeira): para os outros nem a
// leitura sai (o banco devolveria vazio de qualquer jeito).
//
// ⚠️ Remonta a cada ficha (`key` com o contato, aqui dentro), como o aviso
// de duplicata: o diálogo aberto é estado DESTA ficha, e trocar de conversa
// com ele aberto não pode reabri-lo noutra.
// ============================================================

import { useState } from 'react';

import { useCan } from '@/hooks/use-can';
import { useItensDaMesmaPessoa } from '@/hooks/use-lixeira-da-mesma-pessoa';
import type { ItemDaMesmaPessoa } from '@/lib/contacts/restaurar-e-unir';

import { recarregarNaFichaQueFicou } from '../aviso-de-possivel-duplicata';
import { FaixaDeFichaNaLixeira } from './faixa-de-ficha-na-lixeira';
import { RestaurarEUnirDialog } from './restaurar-e-unir-dialog';

interface Props {
  /** A ficha de quem abriu (a conversa ou o card): é ela que fica. */
  contatoId: string;
  /** O token de resync da página (voltar à aba, reconexão). */
  resyncToken?: number;
  /** O card aberto pelo QUADRO: depois de unir, a conversa leva a faixa "Voltar ao funil". */
  origem?: 'funil';
  /** As margens de quem monta. */
  className?: string;
}

function AvisoDaFicha({ contatoId, resyncToken = 0, origem, className }: Props) {
  const podeRestaurar = useCan('delete-contacts');
  const itens = useItensDaMesmaPessoa(contatoId, podeRestaurar, resyncToken);
  const [escolhido, setEscolhido] = useState<ItemDaMesmaPessoa | null>(null);
  if (!podeRestaurar) return null;

  return (
    <>
      <FaixaDeFichaNaLixeira itens={itens} aoRestaurarEUnir={setEscolhido} className={className} />
      {/* `key` pelo item: a prévia e a falha são deste item. Dentro do Sheet
          do card, o diálogo fica na árvore dele de propósito (o base-ui
          reconhece o ANINHADO e não briga pelo foco). */}
      <RestaurarEUnirDialog
        key={escolhido?.id ?? 'nenhum'}
        itemId={escolhido?.id ?? null}
        fichaQueFica={contatoId}
        aoFechar={() => setEscolhido(null)}
        // Depois de unir, a página recarrega na conversa que ficou: as
        // mensagens que mudaram de conversa chegam por UPDATE (o fio só ouve
        // INSERT), como na união do "Comparar".
        aoUnir={(resultado) => recarregarNaFichaQueFicou(resultado, origem)}
      />
    </>
  );
}

export function AvisoDeFichaNaLixeira(props: Props) {
  return <AvisoDaFicha key={props.contatoId} {...props} />;
}
