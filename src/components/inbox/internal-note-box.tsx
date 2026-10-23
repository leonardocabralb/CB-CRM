'use client';

import {
  FileText,
  Film,
  Loader2,
  Mic,
  Paperclip,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { toast } from 'sonner';

import { CitacaoDaNota } from '@/components/inbox/citacao-da-nota';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useGravadorDeVoz } from '@/hooks/use-gravador-de-voz';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import { membrosAtivos } from '@/lib/account/suspensao';
import { arquivoParaEnviar, colagemEhAnexo } from '@/lib/inbox/arquivo-solto';
import {
  ACEITE_DA_ANOTACAO,
  MAX_ANEXOS_DA_NOTA,
  MAX_SEGUNDOS_DA_GRAVACAO,
  TETO_DO_ANEXO,
  escolherAnexosDaNota,
  nomeDaGravacao,
  tamanhoLegivel,
  tipoDoAnexo,
} from '@/lib/notes/anexos';
import {
  aplicarMencao,
  filtrarMembros,
  mencionadosNoTexto,
  tokenSobOCursor,
  type MembroMencionavel,
} from '@/lib/notes/mentions';
import { apagarAnexosSubidos, subirAnexoDaNota } from '@/lib/notes/subir-anexo';
import { cn } from '@/lib/utils';
import type { ConversationNote } from '@/types';

/** Um arquivo escolhido na caixa, antes de virar anexo da anotação. */
interface Escolhido {
  /** Identidade na lista (o mesmo arquivo pode ser escolhido duas vezes). */
  id: string;
  arquivo: File;
  /** `URL.createObjectURL` da imagem, para a miniatura; revogada ao sair. */
  previa: string | null;
  /** O caminho no armazenamento depois de subir: não sobe de novo. */
  caminho: string | null;
}

/** As recusas da rota sobre os anexos que têm a mesma frase na tela. */
const RECUSAS_DO_ANEXO = new Set([
  'ATTACHMENTS_INVALID',
  'TOO_MANY_ATTACHMENTS',
  'ATTACHMENT_OUTSIDE_ACCOUNT',
  'ATTACHMENT_REPEATED',
  'ATTACHMENT_TYPE_REFUSED',
  'ATTACHMENT_TOO_LARGE',
]);

const TETO_EM_MB = Math.round(TETO_DO_ANEXO / (1024 * 1024));

function minutos(segundos: number): string {
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;
}

/**
 * A caixa amarela de anotação interna (migrations 918/919; anexos na 1102).
 *
 * Componente PRÓPRIO, e não mais um trecho dentro do `message-composer`, por
 * dois motivos: o compositor é arquivo do upstream e cada linha nossa ali é
 * superfície de conflito no merge; e com o autocomplete de menção a caixa
 * passou a ter estado e teclado próprios, que não têm nada a ver com o envio
 * de mensagem.
 *
 * ⚠️ <textarea> própria, NUNCA a do compositor. Lá o `handleKeyDown` manda
 * Enter para `handleSend` — a anotação interna sairia como mensagem para o
 * cliente, que é o pior erro possível nesta feature. Aqui Enter quebra linha
 * (anotação longa é o caso normal) e Ctrl/⌘+Enter salva.
 *
 * ANEXOS (1102; decisões D1–D7 e A1–A7 de
 * docs/PLANO-anotacao-com-anexos-e-edicao.md). Clipe, microfone, colar e
 * arrastar — todos pelo MESMO funil (`receberArquivos`: tipo, teto de 50 MiB
 * e de 10, cada recusa com aviso). Os arquivos ficam na memória da aba e
 * sobem SÓ ao Salvar, um por um, para `account-<conta>/notas/`, com
 * progresso; só então vai o POST.
 * - ⚠️⚠️ O salvar leva a conversa de ORIGEM (a do clique) até o fim: no fio
 *   a caixa fecha ao trocar de conversa, e a anotação em voo cai onde foi
 *   escrita. Desmontada no meio, quem salva segue sozinho. Por isso, salvando,
 *   Cancelar e Esc não fecham: o salvar não se interrompe.
 * - Falha no meio: a caixa PARA, mantém texto e arquivos, e o que já subiu
 *   não sobe de novo (`caminho`). Desistir — tirar da lista, Cancelar, a
 *   caixa sumir com o rascunho — APAGA o que a pessoa subiu (a regra do dono
 *   em `notas/`); o que virou anotação nunca. Resposta que não veio (rede)
 *   pode ter salvo: aqueles caminhos ficam INCERTOS e nunca são apagados.
 * - Arrastar para a caixa não chega ao compositor em volta (`stopPropagation`):
 *   o arquivo viraria anexo de MENSAGEM ao cliente.
 * - O gravador é PRÓPRIO (`useGravadorDeVoz`) e solta o microfone quando a
 *   caixa some.
 * - A caixa é da conversa em que NASCEU (`de`): no fio ela não remonta (o
 *   compositor só a fecha por efeito), e no render da troca o rascunho de um
 *   cliente apareceria sob o cabeçalho de outro — some antes.
 */
export function InternalNoteBox({
  conversationId,
  onSaved,
  onClose,
  listaParaBaixo = false,
  autoFocus = true,
  respondendoA = null,
  onLimparResposta,
}: {
  conversationId: string;
  onSaved?: (nota: ConversationNote) => void;
  /**
   * Fecha a caixa (compositor). AUSENTE na aba Notas do painel, onde a
   * caixa é fixa: sem ele o botão Cancelar some e salvar só limpa o texto.
   */
  onClose?: () => void;
  /**
   * Abre a lista de sugestões PARA BAIXO. No compositor a caixa cola no
   * rodapé da tela e a lista sobe; na aba Notas do painel ela fica no TOPO
   * de um contêiner rolável — subir seria ser cortada pelo scroll.
   */
  listaParaBaixo?: boolean;
  /**
   * ⚠️ `false` na aba Notas do painel: lá a caixa monta ao ABRIR a aba e
   * REMONTA a cada troca de conversa (key) — focar nesses momentos roubava
   * o foco de quem digitava no compositor e abria o teclado do celular só
   * de olhar as notas. No compositor a montagem é ação explícita do
   * operador ("anotar") e o foco é o esperado.
   */
  autoFocus?: boolean;
  /**
   * A anotação que esta vai RESPONDER (1075), citada em cima da caixa. O
   * estado é de quem monta (fio ou painel); a caixa só o mostra e o manda.
   */
  respondendoA?: ConversationNote | null;
  /**
   * Desiste de responder (o X da citação) e é chamado depois de salvar: na
   * aba Notas a caixa fica montada, e a próxima anotação não pode sair como
   * resposta. O texto escrito fica.
   */
  onLimparResposta?: () => void;
}) {
  const t = useTranslations('Inbox.composer');
  const tNota = useTranslations('Inbox.note');
  const { accountId } = useAuth();

  // A conversa em que a caixa nasceu (ver o cabeçalho).
  const [de] = useState(conversationId);

  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [progresso, setProgresso] = useState<{ atual: number; total: number } | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const seletorRef = useRef<HTMLInputElement>(null);

  // ⚠️ Trinco SÍNCRONO do salvar: dois Ctrl+Enter seguidos chegam antes de
  // o estado `salvando` voltar, e subiriam e gravariam em dobro.
  const salvandoRef = useRef(false);

  // --- anexos ---------------------------------------------------------
  // A lista mora num REF (lida na hora pelo funil, pelo salvar e pela
  // limpeza do desmonte) e é espelhada no estado só para desenhar: duas
  // soltas seguidas, antes de o render chegar, passariam do teto lendo o
  // estado.
  const escolhidosRef = useRef<Escolhido[]>([]);
  const [escolhidos, setEscolhidosNaTela] = useState<Escolhido[]>([]);
  const definirEscolhidos = useCallback((proximos: Escolhido[]) => {
    escolhidosRef.current = proximos;
    setEscolhidosNaTela(proximos);
  }, []);
  // Caminhos de um POST cuja resposta não veio: a anotação PODE ter sido
  // salva com eles, então a caixa nunca os apaga.
  const incertosRef = useRef<ReadonlySet<string>>(new Set());

  const receberArquivos = useCallback(
    (brutos: readonly File[]) => {
      if (salvandoRef.current || brutos.length === 0) return;
      // Nome e tipo ajustados ANTES de subir: o print colado vem sem nome
      // útil, e o bucket tem lista EXATA de tipos (midia.md).
      const arquivos = brutos.map((b) => arquivoParaEnviar(b));
      const r = escolherAnexosDaNota(arquivos, escolhidosRef.current.length);
      if (r.recusados > 0) toast.error(t('noteAttachmentRefused', { n: r.recusados }));
      if (r.grandes > 0)
        toast.error(t('noteAttachmentTooLarge', { n: r.grandes, max: TETO_EM_MB }));
      if (r.excedentes > 0)
        toast.error(
          t('noteTooManyAttachments', { n: r.excedentes, max: MAX_ANEXOS_DA_NOTA })
        );
      if (r.aceitos.length === 0) return;
      definirEscolhidos([
        ...escolhidosRef.current,
        ...r.aceitos.map((arquivo) => ({
          id: crypto.randomUUID(),
          arquivo,
          previa:
            tipoDoAnexo(arquivo.type) === 'imagem' ? URL.createObjectURL(arquivo) : null,
          caminho: null,
        })),
      ]);
    },
    [definirEscolhidos, t]
  );

  const tirar = useCallback(
    (id: string) => {
      if (salvandoRef.current) return;
      const item = escolhidosRef.current.find((e) => e.id === id);
      if (!item) return;
      if (item.previa) URL.revokeObjectURL(item.previa);
      // Já subiu e a pessoa desistiu dele: sai do armazenamento (a dona pode).
      if (item.caminho && !incertosRef.current.has(item.caminho)) {
        void apagarAnexosSubidos([item.caminho]).catch(() => {});
      }
      definirEscolhidos(escolhidosRef.current.filter((e) => e.id !== id));
    },
    [definirEscolhidos]
  );

  // A caixa sumiu (Cancelar, troca de conversa no fio, remonte no painel):
  // o rascunho vai junto — e o que ele já tinha subido, também. Com um salvar
  // EM VOO, nada se apaga: os arquivos são da anotação que está sendo gravada
  // (quem salva decide no fim). O gravador cuida do microfone sozinho.
  useEffect(() => {
    return () => {
      const itens = escolhidosRef.current;
      for (const item of itens) if (item.previa) URL.revokeObjectURL(item.previa);
      if (salvandoRef.current) return;
      const sobras = itens.flatMap((e) =>
        e.caminho && !incertosRef.current.has(e.caminho) ? [e.caminho] : []
      );
      if (sobras.length > 0) void apagarAnexosSubidos(sobras).catch(() => {});
    };
  }, []);

  // A caixa ainda está na tela? (o salvar segue depois do desmonte)
  const montadaRef = useRef(true);
  useEffect(() => {
    montadaRef.current = true;
    return () => {
      montadaRef.current = false;
    };
  }, []);

  // --- gravação -------------------------------------------------------
  const aoGravar = useCallback(
    (bytes: Uint8Array) => {
      // Uint8Array é BlobPart em tempo de execução; o cast contorna o
      // genérico ArrayBufferLike × ArrayBuffer do lib.dom (como o compositor).
      const arquivo = new File([bytes as unknown as BlobPart], nomeDaGravacao(new Date()), {
        type: 'audio/ogg',
      });
      if (arquivo.size === 0) return;
      receberArquivos([arquivo]);
    },
    [receberArquivos]
  );
  const gravador = useGravadorDeVoz({ aoGravar, maxSegundos: MAX_SEGUNDOS_DA_GRAVACAO });
  const { iniciar: iniciarGravacao } = gravador;
  const gravar = useCallback(async () => {
    if (salvandoRef.current) return;
    const r = await iniciarGravacao();
    if (r === 'sem-suporte') toast.error(t('recordingUnsupported'));
    else if (r === 'negado') toast.error(t('microphoneDenied'));
  }, [iniciarGravacao, t]);

  // --- arrastar -------------------------------------------------------
  // Contador, não booleano (o `dragleave` dispara ao passar de um filho a
  // outro). ⚠️ `stopPropagation` em todos: a caixa mora DENTRO do
  // compositor, e o arquivo solto aqui não pode virar anexo de mensagem.
  const [arrastando, setArrastando] = useState(false);
  const profundidadeRef = useRef(0);
  const ehArquivo = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  const aoArrastarEntrando = (e: DragEvent<HTMLDivElement>) => {
    if (!ehArquivo(e)) return;
    e.preventDefault();
    e.stopPropagation();
    profundidadeRef.current += 1;
    setArrastando(true);
  };
  const aoArrastarSobre = (e: DragEvent<HTMLDivElement>) => {
    if (!ehArquivo(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };
  const aoArrastarSaindo = (e: DragEvent<HTMLDivElement>) => {
    if (!ehArquivo(e)) return;
    e.stopPropagation();
    profundidadeRef.current = Math.max(0, profundidadeRef.current - 1);
    if (profundidadeRef.current === 0) setArrastando(false);
  };
  const aoSoltar = (e: DragEvent<HTMLDivElement>) => {
    if (!ehArquivo(e)) return;
    e.preventDefault();
    e.stopPropagation();
    profundidadeRef.current = 0;
    setArrastando(false);
    receberArquivos(Array.from(e.dataTransfer.files));
  };

  const aoColar = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const arquivos = Array.from(e.clipboardData.files);
      // ⚠️ Colagem COM texto não vira anexo (Word e Google Docs mandam os
      // dois, e o texto se perderia) — `colagemEhAnexo`.
      if (
        !colagemEhAnexo({
          temArquivo: arquivos.length > 0,
          texto: e.clipboardData.getData('text/plain'),
        })
      )
        return;
      e.preventDefault();
      receberArquivos(arquivos);
    },
    [receberArquivos]
  );

  // --- menção -------------------------------------------------------
  const [membros, setMembros] = useState<MembroMencionavel[]>([]);
  const [termo, setTermo] = useState<{ inicio: number; termo: string } | null>(
    null
  );
  const [destacado, setDestacado] = useState(0);

  useEffect(() => {
    let vivo = true;
    void fetchAccountMembers().then((lista) => {
      if (!vivo) return;
      // 1067: quem está suspenso não lê anotação — mencioná-lo não chega.
      setMembros(
        membrosAtivos(lista).map((m) => ({ user_id: m.user_id, rotulo: memberLabel(m) }))
      );
    });
    return () => {
      vivo = false;
    };
  }, []);

  const sugestoes = useMemo(
    () => (termo ? filtrarMembros(membros, termo.termo) : []),
    [termo, membros]
  );
  const listaAberta = termo !== null && sugestoes.length > 0;

  /**
   * ⚠️ Foco por REF num efeito, e NÃO pelo atributo `autoFocus`.
   *
   * Com `autoFocus` o texto digitado saía embaralhado: escrever "Teste da
   * anotação interna" gravava "teTeste da anotação internaste". O React
   * reaplica o foco durante o commit da caixa, e o cursor volta para o começo
   * no meio da digitação. Focar depois da montagem, com o cursor posto no fim
   * de propósito, é o mesmo padrão que `desfazerEnvio` usa no compositor.
   */
  useEffect(() => {
    if (!autoFocus) return;
    const el = areaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  // Tocar em "Responder" é pedir para escrever: o foco vai para a caixa, que
  // na aba Notas já estava montada (sem o efeito de montagem acima).
  const respondidaId = respondendoA?.id ?? null;
  useEffect(() => {
    if (!respondidaId) return;
    areaRef.current?.focus();
  }, [respondidaId]);

  const mudarTexto = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const el = e.target;
      setTexto(el.value);
      setTermo(tokenSobOCursor(el.value, el.selectionStart));
      setDestacado(0);
    },
    []
  );

  /**
   * Reavalia o token quando o cursor anda sem o texto mudar (clique, setas).
   * Sem isto, clicar no meio de um `@nome` já escrito não reabre a lista, e
   * clicar para fora não a fecha.
   */
  const moverCursor = useCallback(() => {
    const el = areaRef.current;
    if (!el) return;
    setTermo(tokenSobOCursor(el.value, el.selectionStart));
  }, []);

  const escolher = useCallback(
    (m: MembroMencionavel) => {
      if (!termo) return;
      const el = areaRef.current;
      const cursor = el?.selectionStart ?? texto.length;
      const r = aplicarMencao(texto, termo.inicio, cursor, m.rotulo);
      setTexto(r.texto);
      setTermo(null);
      setDestacado(0);
      // O cursor precisa ser reposto DEPOIS do render, senão o navegador o
      // deixa no fim do valor novo e continuar digitando escreve no lugar
      // errado quando a menção está no meio da frase.
      requestAnimationFrame(() => {
        const alvo = areaRef.current;
        if (!alvo) return;
        alvo.focus();
        alvo.setSelectionRange(r.cursor, r.cursor);
      });
    },
    [termo, texto]
  );

  const gravando = gravador.gravando;
  const salvar = useCallback(async () => {
    const limpo = texto.trim();
    const itens = escolhidosRef.current;
    if (salvandoRef.current || gravando) return;
    if (!limpo && itens.length === 0) return;
    if (itens.length > 0 && !accountId) {
      toast.error(t('noteSaveError'));
      return;
    }
    // ⚠️ A conversa de ORIGEM, presa aqui até o fim (ver o cabeçalho).
    const origem = conversationId;
    salvandoRef.current = true;
    setSalvando(true);
    let lista = itens;
    const subidos = () => lista.flatMap((e) => (e.caminho ? [e.caminho] : []));
    // Desmontada (a pessoa saiu daqui) e a anotação NÃO foi gravada: ninguém
    // mais vai tentar de novo, e o que subiu sai do armazenamento.
    const largarSeSumiu = () => {
      if (montadaRef.current) return;
      const sobras = subidos().filter((c) => !incertosRef.current.has(c));
      if (sobras.length > 0) void apagarAnexosSubidos(sobras).catch(() => {});
    };
    try {
      // 1. Sobe o que falta, um por vez (a ordem é a da lista).
      for (let i = 0; i < lista.length; i++) {
        const item = lista[i];
        if (item.caminho) continue;
        setProgresso({ atual: i + 1, total: lista.length });
        let caminho: string;
        try {
          caminho = await subirAnexoDaNota(accountId!, item.arquivo);
        } catch (erro) {
          console.warn(
            '[InternalNoteBox] o anexo não subiu:',
            erro instanceof Error ? erro.message : erro
          );
          toast.error(t('noteUploadFailed', { nome: item.arquivo.name }));
          largarSeSumiu();
          return;
        }
        lista = lista.map((e) => (e.id === item.id ? { ...e, caminho } : e));
        definirEscolhidos(lista);
      }
      setProgresso(null);

      // 2. A anotação, com os caminhos (tamanho e tipo a rota LÊ).
      let res: Response;
      try {
        res = await fetch('/api/cb/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: origem,
            texto: limpo,
            // Derivado do texto, não de quem foi clicado — ver `mentions.ts`.
            mencionados: mencionadosNoTexto(limpo, membros),
            resposta_de: respondendoA?.id,
            anexos: lista.map((e) => ({ caminho: e.caminho, nome: e.arquivo.name })),
          }),
        });
      } catch {
        // Sem resposta: a anotação PODE ter sido gravada. Os caminhos ficam
        // incertos — a caixa não os apaga nunca mais.
        incertosRef.current = new Set([...incertosRef.current, ...subidos()]);
        toast.error(t('noteSaveError'));
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const erro: unknown = json?.error;
        if (erro === 'REPLIED_NOTE_NOT_FOUND') {
          // A respondida foi apagada enquanto a pessoa escrevia: a citação
          // sai, o texto e os anexos ficam — salvar de novo grava como
          // anotação comum.
          toast.error(t('noteReplyGone'));
          onLimparResposta?.();
        } else if (erro === 'ATTACHMENT_NOT_FOUND') {
          toast.error(t('noteAttachmentGone'));
        } else if (erro === 'STORAGE_UNAVAILABLE') {
          toast.error(t('noteStorageUnavailable'));
        } else if (typeof erro === 'string' && RECUSAS_DO_ANEXO.has(erro)) {
          toast.error(t('noteAttachmentRejected'));
        } else {
          toast.error(typeof erro === 'string' && erro ? erro : t('noteSaveError'));
        }
        largarSeSumiu();
        return;
      }
      // A anotação foi salva; o aviso ao colega pode não ter saído. Dizer
      // isso é o ponto: quem escreveu "@fulano confere esse prazo" e some da
      // tela precisa saber se o fulano foi mesmo chamado.
      if (json?.mencoesNotificadas === false) toast.warning(t('noteMentionFailed'));
      if (json?.respostaNotificada === false) toast.warning(t('noteReplyFailed'));
      // ⚠️ A lista sai ANTES de fechar: os arquivos agora são da anotação, e
      // a limpeza do desmonte apagaria o que sobrasse nela.
      for (const e of lista) if (e.previa) URL.revokeObjectURL(e.previa);
      definirEscolhidos([]);
      onSaved?.(json.note as ConversationNote);
      setTexto('');
      onLimparResposta?.();
      onClose?.();
    } catch {
      toast.error(t('noteSaveError'));
    } finally {
      salvandoRef.current = false;
      setSalvando(false);
      setProgresso(null);
    }
  }, [
    texto,
    gravando,
    accountId,
    conversationId,
    membros,
    respondendoA?.id,
    definirEscolhidos,
    onSaved,
    onLimparResposta,
    onClose,
    t,
  ]);

  const tecla = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // ⚠️ A lista aberta come as teclas de navegação ANTES de qualquer outra
      // coisa. Sem isto, Enter para escolher um colega quebraria linha e
      // Escape fecharia a caixa inteira com o texto dentro.
      if (listaAberta) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setDestacado((i) => (i + 1) % sugestoes.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setDestacado((i) => (i - 1 + sugestoes.length) % sugestoes.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          escolher(sugestoes[destacado] ?? sugestoes[0]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setTermo(null);
          return;
        }
      }

      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void salvar();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        // Salvando, a caixa não fecha (como o Cancelar): o salvar não se
        // interrompe, e fechar faria parecer que a anotação foi desistida.
        if (!salvandoRef.current) onClose?.();
      }
    },
    [listaAberta, sugestoes, destacado, escolher, salvar, onClose]
  );

  // Nasceu noutra conversa: no fio o compositor a fecha no efeito da troca;
  // até lá, o rascunho de um cliente não aparece sob o cabeçalho de outro.
  if (de !== conversationId) return null;

  const cheia = escolhidos.length >= MAX_ANEXOS_DA_NOTA;
  const vazia = !texto.trim() && escolhidos.length === 0;

  return (
    <div
      className="relative mb-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-700/50 dark:bg-amber-950/40"
      onDragEnter={aoArrastarEntrando}
      onDragOver={aoArrastarSobre}
      onDragLeave={aoArrastarSaindo}
      onDrop={aoSoltar}
    >
      {/* Alvo de soltura: `pointer-events-none`, senão engole o `drop`. */}
      {arrastando && (
        <div className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-amber-500 bg-amber-100/90 dark:bg-amber-900/80">
          <span className="text-sm font-medium text-amber-950 dark:text-amber-50">
            {t('noteDropToAttach')}
          </span>
        </div>
      )}

      <p className="mb-2 text-xs text-amber-950 dark:text-amber-50">
        <span className="font-semibold">{t('noteBoxTitle')}</span>{' '}
        <span className="opacity-80">{t('noteBoxHint')}</span>
      </p>

      {respondendoA && (
        <CitacaoDaNota
          original={respondendoA}
          onCancelar={onLimparResposta}
          className="mb-2 text-amber-950 dark:text-amber-50"
        />
      )}

      <div className="relative">
        {/* A lista sobe, e não desce: a caixa fica colada no rodapé da tela,
            então para baixo ela sairia da área visível. */}
        {listaAberta && (
          <ul
            className={cn(
              'border-border bg-popover absolute left-0 z-20 max-h-48 w-64 overflow-y-auto rounded-md border py-1 shadow-md',
              listaParaBaixo ? 'top-full mt-1' : 'bottom-full mb-1'
            )}
          >
            {sugestoes.map((m, i) => (
              <li key={m.user_id}>
                <button
                  type="button"
                  // `onMouseDown` em vez de `onClick`: o clique tira o foco da
                  // textarea antes do `onClick` rodar, e aí `selectionStart`
                  // já não vale mais.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    escolher(m);
                  }}
                  onMouseEnter={() => setDestacado(i)}
                  className={cn(
                    'w-full truncate px-3 py-1.5 text-left text-sm',
                    i === destacado
                      ? 'bg-accent text-accent-foreground'
                      : 'text-popover-foreground'
                  )}
                >
                  {m.rotulo}
                </button>
              </li>
            ))}
          </ul>
        )}

        <textarea
          ref={areaRef}
          value={texto}
          onChange={mudarTexto}
          onKeyDown={tecla}
          onClick={moverCursor}
          onSelect={moverCursor}
          onPaste={aoColar}
          onBlur={() => setTermo(null)}
          rows={3}
          placeholder={t('notePlaceholder')}
          className="w-full resize-none rounded-md border border-amber-300/60 bg-amber-100/60 px-3 py-2 text-sm text-amber-950 outline-none placeholder:text-amber-900/50 focus:border-amber-500 dark:border-amber-700/50 dark:bg-amber-900/30 dark:text-amber-50 dark:placeholder:text-amber-100/40"
        />
      </div>

      {escolhidos.length > 0 && (
        <ul aria-label={tNota('anexos')} className="mt-2 flex flex-wrap gap-1.5">
          {escolhidos.map((e) => {
            const tipo = tipoDoAnexo(e.arquivo.type);
            return (
              <li
                key={e.id}
                className="flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-amber-300/60 bg-amber-100/70 py-1 pr-1 pl-1.5 text-xs text-amber-950 dark:border-amber-700/50 dark:bg-amber-900/40 dark:text-amber-50"
              >
                {e.previa ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.previa} alt="" className="size-6 shrink-0 rounded object-cover" />
                ) : tipo === 'audio' ? (
                  <Mic className="h-3.5 w-3.5 shrink-0 opacity-70" />
                ) : tipo === 'video' ? (
                  <Film className="h-3.5 w-3.5 shrink-0 opacity-70" />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
                )}
                <span className="min-w-0 truncate">{e.arquivo.name}</span>
                <span className="shrink-0 opacity-60">{tamanhoLegivel(e.arquivo.size)}</span>
                <button
                  type="button"
                  onClick={() => tirar(e.id)}
                  disabled={salvando}
                  aria-label={t('noteRemoveAttachment', { nome: e.arquivo.name })}
                  title={t('noteRemoveAttachment', { nome: e.arquivo.name })}
                  className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {gravando && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-600" />
          <span className="min-w-0 flex-1 tabular-nums">
            {t('recording', {
              current: minutos(gravador.segundos),
              max: minutos(MAX_SEGUNDOS_DA_GRAVACAO),
            })}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={gravador.parar}
            className="h-7 px-2 text-red-800 hover:bg-red-100 dark:text-red-200"
          >
            <Square className="mr-1 h-3 w-3 fill-current" />
            {t('noteStopRecording')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={gravador.descartar}
            aria-label={t('noteCancelRecording')}
            title={t('noteCancelRecording')}
            className="h-7 px-2 text-red-800 hover:bg-red-100 dark:text-red-200"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => void salvar()}
          disabled={vazia || salvando || gravando}
          title={gravando ? t('noteStopRecordingFirst') : undefined}
          className="h-8 bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          {progresso
            ? t('noteUploading', { atual: progresso.atual, total: progresso.total })
            : t('saveNote')}
        </Button>
        {onClose ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            disabled={salvando}
            className="h-8"
          >
            {t('cancel')}
          </Button>
        ) : null}
        <button
          type="button"
          onClick={() => seletorRef.current?.click()}
          disabled={salvando || cheia}
          aria-label={t('noteAttach')}
          title={t('noteAttach')}
          className="flex h-8 w-8 items-center justify-center rounded-md text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-40 dark:text-amber-100 dark:hover:bg-amber-900/40"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void gravar()}
          disabled={salvando || cheia || gravando}
          aria-label={t('noteRecord')}
          title={t('noteRecord')}
          className="flex h-8 w-8 items-center justify-center rounded-md text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-40 dark:text-amber-100 dark:hover:bg-amber-900/40"
        >
          <Mic className="h-4 w-4" />
        </button>
        <span className="ml-auto text-[10px] text-amber-900/60 dark:text-amber-100/50">
          {t('noteMentionHint')}
        </span>
      </div>

      {/* O clipe: a MESMA lista de tipos da rota (`ACEITE_DA_ANOTACAO`). */}
      <input
        ref={seletorRef}
        type="file"
        multiple
        accept={ACEITE_DA_ANOTACAO}
        className="hidden"
        onChange={(e) => {
          receberArquivos(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </div>
  );
}
