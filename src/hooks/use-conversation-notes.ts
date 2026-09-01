'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import type { ConversationNote } from '@/types';

/**
 * Anotações internas de uma conversa (migration 918).
 *
 * ⚠️ Busca por `conversation_id`, e não por contato como o `useLeadEvents`.
 * É a única chave que existe em conversa de grupo — grupo não tem contato.
 *
 * ⚠️ COM realtime, ao contrário da trilha de atividade. O argumento que
 * manteve a 912 fora se inverte aqui: a anotação é escrita exatamente na tela
 * onde é lida (o compositor), e dois atendentes na mesma conversa é o caso
 * normal, não a exceção.
 *
 * ⚠️ Cobre INSERT **e** DELETE. O DELETE só funciona porque a 921 pôs a
 * tabela em REPLICA IDENTITY FULL: com a identidade padrão, a linha antiga
 * chega só com a chave primária, e sem as outras colunas o Postgres não
 * avalia nem o filtro por conversa nem a RLS — o evento não é entregue a
 * ninguém. A 918 tinha dispensado isso alegando custo de WAL; o argumento não
 * vale aqui (replica identity não afeta INSERT, que é quase toda a escrita
 * desta tabela, e UPDATE é revogado). Ver o cabeçalho da 921.
 *
 * O que isso conserta na prática: a ficha e o fio ficam na tela AO MESMO
 * TEMPO, cada um com sua instância deste hook. Apagar no fio removia a
 * anotação de lá e a deixava intacta na ficha, a dois centímetros, até
 * recarregar a página.
 */
export function useConversationNotes(
  conversationId: string | null | undefined,
  token = 0
) {
  const [notas, setNotas] = useState<ConversationNote[]>([]);
  const [carregando, setCarregando] = useState(false);
  /**
   * ⚠️ De qual conversa é a última busca que VOLTOU — e se voltou bem.
   *
   * `carregando` nasce falso e `notas` nasce vazia, então o primeiro render
   * de toda conversa é "sem nota nenhuma" com cara de resposta — a aba Notas
   * do grupo afirmava "Nenhuma anotação ainda" sobre grupo com anotações a
   * cada carga, e para sempre quando a busca falhava (achado do Codex no
   * PR #101). É a variante de lista-vazia-virando-afirmação do CLAUDE.md:
   * quem desenha o vazio precisa de um sinal de "já carregou ESTA conversa",
   * e carimbar a conversa (não um booleano) é o que impede o sinal do
   * cliente anterior de valer para o seguinte no render em que a troca
   * ainda não passou pelo efeito de limpeza.
   */
  const [carregada, setCarregada] = useState<{ de: string; ok: boolean } | null>(null);
  /**
   * ⚠️ A conversa ATUAL, viva — a régua de `acrescentar`/`aplicarFixacao`.
   * A guarda que os call sites faziam (`nota.conversation_id ===
   * conversationId`) era TAUTOLÓGICA: o closure em voo capturou o
   * conversationId do render do clique, e a nota devolvida é daquela mesma
   * conversa — A === A, nunca rejeita. Enquanto isso o estado do hook já é
   * do cliente B, e a nota de A aterrissava na lista dele (achado da
   * revisão de 2026-08-29/30). Ref compara contra o AGORA, não contra o
   * passado de quem chamou.
   */
  const conversaAtualRef = useRef<string | null>(conversationId ?? null);

  /**
   * ⚠️ Identidade DESTA montagem do hook, no nome do canal de realtime.
   *
   * O cliente do Supabase indexa canal por tópico: pedir
   * `supabase.channel('notas:X')` uma segunda vez devolve o MESMO objeto, já
   * inscrito — e aí o `.on()` estoura com "cannot add postgres_changes
   * callbacks after subscribe()". Como é erro não capturado dentro de um
   * efeito, ele não fica num canto da tela: derruba a página inteira.
   *
   * Aconteceu de verdade assim que o hook passou a ser usado em dois lugares
   * ao mesmo tempo (o fio do chat e a seção "Notas" da ficha) para a mesma
   * conversa. Com o sufixo, cada montagem tem tópico próprio e as duas
   * recebem o INSERT normalmente.
   */
  const instancia = useId();

  /**
   * ⚠️ A busca carrega a conversa que a pediu, e o resultado é DESCARTADO se
   * essa já não for a conversa aberta.
   *
   * Sem isso, clicar em duas conversas em sequência rápida — que é o uso
   * normal de um inbox — deixa duas buscas no ar, e quem responde por último
   * ganha. Se a primeira demorar mais, as anotações internas do cliente A
   * aparecem dentro da conversa do cliente B. Também havia uma janela curta a
   * cada troca: as mensagens são escondidas por `loading` enquanto carregam,
   * as anotações não eram, então os balões amarelos do cliente anterior
   * ficavam desenhados no fio novo até a busca voltar. É o mesmo padrão de
   * guarda que `message-thread.tsx` já usa nas duas buscas dele.
   */
  const buscar = useCallback(
    async (vivo?: () => boolean) => {
      const valeAinda = () => (vivo ? vivo() : true);
      if (!conversationId) {
        setNotas([]);
        return;
      }
      setCarregando(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from('cb_conversation_notes')
        .select('*')
        .eq('conversation_id', conversationId)
        // Mesmo teto de segurança da trilha: busca as mais recentes e deixa a
        // ordenação final para o `intercalar`, que ordena o fio inteiro.
        // ⚠️ O cartão de nota FIXADA (951) deriva DESTA janela: fixada mais
        // velha que as 200 notas mais recentes não entra e o sticky some em
        // silêncio. Hoje o máximo real é 2 notas/conversa — é a família de
        // teto-que-chega-por-crescimento já documentada (924/929); quem
        // paginar isto revisa a fixada junto.
        .order('created_at', { ascending: false })
        .limit(200);

      if (!valeAinda()) return;

      if (error) {
        // Falha aqui não pode derrubar a conversa — anotação é acessória ao
        // atendimento e o chat precisa abrir de qualquer jeito.
        console.warn('[notas] falha ao buscar anotações:', error.message);
        setNotas([]);
        setCarregada({ de: conversationId, ok: false });
      } else {
        setNotas((data ?? []) as ConversationNote[]);
        setCarregada({ de: conversationId, ok: true });
      }
      setCarregando(false);
    },
    [conversationId]
  );

  // Esvazia ao TROCAR DE CONVERSA (e só aí — não a cada resync, que
  // piscaria a lista à toa). A lista na tela é do cliente anterior; deixá-la
  // enquanto a busca nova corre é exibir anotação de um cliente dentro da
  // conversa de outro, mesmo que por um instante.
  useEffect(() => {
    conversaAtualRef.current = conversationId ?? null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotas([]);
  }, [conversationId]);

  useEffect(() => {
    let vivo = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void buscar(() => vivo);
    return () => {
      vivo = false;
    };
  }, [buscar, token]);

  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`notas:${conversationId}:${instancia}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'cb_conversation_notes',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const linha = payload.new as ConversationNote;
          setNotas((anteriores) =>
            // O próprio autor já inseriu a linha no estado ao salvar; sem esta
            // guarda a anotação apareceria duas vezes para quem a escreveu.
            anteriores.some((n) => n.id === linha.id)
              ? anteriores
              : [...anteriores, linha]
          );
        }
      )
      .on(
        'postgres_changes',
        {
          // O primeiro UPDATE que esta tabela viu na vida é o fixar/desafixar
          // da 951 (nota continua não-editável). A 921 já pôs REPLICA
          // IDENTITY FULL, então o evento chega com a linha inteira e o
          // filtro por conversa funciona.
          event: 'UPDATE',
          schema: 'public',
          table: 'cb_conversation_notes',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const linha = payload.new as ConversationNote;
          setNotas((anteriores) =>
            anteriores.map((n) => (n.id === linha.id ? linha : n))
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'cb_conversation_notes',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const id = (payload.old as { id?: string }).id;
          if (!id) return;
          setNotas((anteriores) => anteriores.filter((n) => n.id !== id));
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, instancia]);

  /** Tira a anotação da lista local. Quem apaga vê sumir na hora. */
  const remover = useCallback((id: string) => {
    setNotas((anteriores) => anteriores.filter((n) => n.id !== id));
  }, []);

  /**
   * Aplica localmente o resultado do fixar/desafixar (951): a nota devolvida
   * pela rota substitui a sua linha e QUALQUER outra fixada é zerada — o
   * banco só permite uma por contato, e fixar a nova desafixou a antiga no
   * servidor.
   */
  const aplicarFixacao = useCallback((nota: ConversationNote) => {
    // Resposta de OUTRA conversa (fixar em voo + troca) morre aqui — sem a
    // guarda, o ramo que zera `fixada_em` desafixava LOCALMENTE a nota
    // fixada do cliente novo, sem nenhum evento que consertasse depois.
    if (nota.conversation_id !== conversaAtualRef.current) return;
    setNotas((anteriores) =>
      anteriores.map((n) => {
        if (n.id === nota.id) return nota;
        return n.fixada_em ? { ...n, fixada_em: null } : n;
      })
    );
  }, []);

  /** Põe a anotação recém-criada na lista, sem esperar o realtime. */
  const acrescentar = useCallback((nota: ConversationNote) => {
    // Ver `conversaAtualRef`: a guarda dos call sites é de closure e não
    // segura resposta em voo — esta é a que vale.
    if (nota.conversation_id !== conversaAtualRef.current) return;
    setNotas((anteriores) =>
      anteriores.some((n) => n.id === nota.id)
        ? anteriores
        : [...anteriores, nota]
    );
  }, []);

  /**
   * ⚠️ O que sai daqui é sempre da conversa do render ATUAL.
   *
   * O estado é esvaziado num efeito, e efeito é PASSIVO: no primeiro render
   * depois de trocar de conversa, `notas` ainda é do cliente anterior. Quem
   * desenha algo fora do `loading` que esconde o fio — a faixa da nota
   * fixada, o cartão sticky da aba Notas — pintava a anotação do cliente A
   * sob o cabeçalho do cliente B, com o botão de desafixar agindo sobre a
   * nota de A. Foi o achado do Codex no PR #64 (corrigido no fio) e voltou
   * no painel da conversa, que usa o mesmo hook.
   *
   * A guarda vive AQUI, e não em cada consumidor, justamente porque a
   * segunda cópia foi a que faltou. Não é a comparação tautológica que o
   * `conversaAtualRef` descreve: ali o id vem de um closure do passado;
   * aqui, do prop do render atual contra o estado velho.
   */
  const notasDaConversa = useMemo(
    () => notas.filter((n) => n.conversation_id === conversationId),
    [notas, conversationId]
  );

  // Derivados contra o PROP do render atual, nunca contra o estado velho —
  // a mesma régua de `notasDaConversa` logo acima.
  const daConversaAtual = carregada !== null && carregada.de === conversationId;

  return {
    notas: notasDaConversa,
    carregando,
    /** A lista é RESPOSTA para esta conversa: uma busca voltou bem. Só aí o vazio quer dizer "sem nota". */
    pronta: daConversaAtual && carregada.ok,
    /** A última busca desta conversa falhou — o vazio NÃO é resposta. */
    falhou: daConversaAtual && !carregada.ok,
    recarregar: buscar,
    remover,
    acrescentar,
    aplicarFixacao,
  };
}
