"use client";

// ============================================================
// Ligar e atender pelo CRM, na tela (4c, `docs/PLANO-ligar-pelo-crm.md`
// §8.15). Montado na CASCA do painel (`dashboard-shell.tsx`): é o único lugar
// em todas as telas que não remonta ao navegar — trocar de tela NÃO derruba a
// ligação. Daqui saem o painel flutuante da ligação, o cartão que toca e o
// `<audio>` com a voz do cliente; o botão "Ligar" do cabeçalho da conversa
// chama `ligar()` pelo contexto.
//
// A ligação ao vivo vem de `cb_ligacoes_ao_vivo` (1134) pelo tempo real. ⚠️ O
// DELETE traz SÓ a chave (RLS): a minha ligação acaba quando a linha dela
// some. Releitura ao assinar, a cada reconexão e de 20 em 20 s enquanto há
// ligação na tela: um evento perdido não deixa o painel "em ligação" para
// sempre.
//
// ⚠️ Uma ligação por vez nesta aba, sob trinco SÍNCRONO (`posseRef`): cada
// `await` de ligar/atender confere se a ligação ainda é a mesma — a linha
// pode sumir no meio (o cliente desligou), e o fim já soltou o áudio.
// ============================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { canMakeCalls } from "@/lib/auth/roles";
import { urlDoInbox, EVENTO_ABRIR_CONVERSA } from "@/lib/inbox/url";
import {
  faseDoEstado,
  faseSeguinte,
  juntarAoVivo,
  lerLigacaoAoVivo,
  recusaConhecida,
  releituraAoVivo,
  type FaseDaLigacao,
  type LigacaoAoVivo,
  type Recusa,
} from "@/lib/ligacoes/ao-vivo";
import {
  ErroDoAudio,
  aplicarResposta,
  montarOferta,
  pedirMicrofone,
  soltarAudio,
} from "@/lib/ligacoes/audio-da-ligacao";
import { canalNoEscopo } from "@/lib/perfis/escopo";
import { createClient } from "@/lib/supabase/client";

import { CartoesDeToque, type AtendidaPorOutro } from "./cartoes-de-toque";
import { PainelDaLigacao } from "./painel-da-ligacao";

export interface MinhaLigacao {
  /** O `cb_ligacoes.id`; nulo na feita até a rota responder. */
  id: string | null;
  direcao: "feita" | "recebida";
  conversationId: string | null;
  /** A ficha (ou o telefone) que o painel escreve. */
  nome: string;
  canalId: string | null;
  fase: FaseDaLigacao;
  recusa: Recusa | null;
  /** Relógio desta aba quando a linha virou `em_ligacao` (o cronômetro). */
  emLigacaoDesde: number | null;
  duracaoSeg: number | null;
  mudo: boolean;
  desligando: boolean;
}

interface ContextoDasLigacoes {
  aoVivo: readonly LigacaoAoVivo[];
  /** Esta aba tem uma ligação que ainda não acabou. */
  emLigacao: boolean;
  ligar: (args: { conversationId: string; nome: string; canalId: string }) => void;
}

const Contexto = createContext<ContextoDasLigacoes | null>(null);

/** Fora do provedor (teste, tela fora da casca) é `null`: o botão some. */
export function useLigacoes(): ContextoDasLigacoes | null {
  return useContext(Contexto);
}

const COLUNAS =
  "id, account_id, channel_id, direcao, estado, telefone, conversation_id, contact_id, atendente_id, desde, atualizada_em";
const RELEITURA_MS = 20_000;
/** "Atendida por Ana" fica na tela por este tempo e some. */
const ATENDIDA_POR_OUTRO_MS = 4_000;
/** "Encerrada · 4 min 21 s" fica na tela por este tempo e o painel fecha. */
const ENCERRADA_NA_TELA_MS = 8_000;

let canaisAbertos = 0;

class Cancelada extends Error {}
class Recusada extends Error {
  constructor(readonly codigo: string | null) {
    super(codigo ?? "recusada");
  }
}

const ativaAinda = (m: MinhaLigacao | null) =>
  m !== null && m.fase !== "encerrada" && m.fase !== "falhou";

/** Desligar sem painel para avisar (o provedor saiu da tela). Nunca lança. */
function desligarSemTela(id: string): void {
  void fetch(`/api/cb/ligacoes/${id}/desligar`, { method: "POST", keepalive: true }).catch(() => {});
}

export function LigacoesProvider({
  ativo,
  children,
}: {
  /** Falso com a porta de entrada pendente: é efeito que a porta segura. */
  ativo: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("Ligacoes");
  const router = useRouter();
  const { user, profile, perfilDeAcesso } = useAuth();
  const userId = user?.id ?? null;
  // ⚠️ O papel e o perfil REAIS, como o aviso do navegador: quem simula pelo
  // "Ver como" continua sendo quem recebe a ligação (o cliente liga de verdade).
  const papelReal = profile?.account_role ?? null;
  const podeAtender = papelReal !== null && canMakeCalls(papelReal);

  const [aoVivo, setAoVivo] = useState<LigacaoAoVivo[]>([]);
  const [minha, setMinha] = useState<MinhaLigacao | null>(null);
  const [atendidasPorOutro, setAtendidasPorOutro] = useState<AtendidaPorOutro[]>([]);

  const aoVivoRef = useRef<LigacaoAoVivo[]>([]);
  const apagadasRef = useRef<Set<string>>(new Set());
  /** Quando chegou o último INSERT/UPDATE de cada linha (a releitura o respeita). */
  const eventosRef = useRef<Map<string, number>>(new Map());
  const posseRef = useRef<symbol | null>(null);
  const minhaIdRef = useRef<string | null>(null);
  const idConhecidoEmRef = useRef(0);
  const cancelarRef = useRef(false);
  /** A rota de ligar/atender já respondeu bem (antes disso, desligar espera). */
  const respondidoRef = useRef(false);
  const conexaoRef = useRef<RTCPeerConnection | null>(null);
  const microfoneRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const relerRef = useRef<(() => Promise<void>) | null>(null);

  const publicar = useCallback((proximo: LigacaoAoVivo[]) => {
    aoVivoRef.current = proximo;
    setAoVivo(proximo);
  }, []);

  /** A minha ligação acabou (a linha saiu): solta o áudio e mostra o fim. */
  const encerrarMinha = useCallback(() => {
    soltarAudio(conexaoRef.current, microfoneRef.current);
    conexaoRef.current = null;
    microfoneRef.current = null;
    minhaIdRef.current = null;
    posseRef.current = null;
    const agora = Date.now();
    setMinha((m) =>
      ativaAinda(m)
        ? {
            ...m!,
            fase: "encerrada",
            duracaoSeg:
              m!.emLigacaoDesde !== null ? Math.round((agora - m!.emLigacaoDesde) / 1000) : null,
            desligando: false,
          }
        : m,
    );
  }, []);

  /** Falhou antes de a ligação existir (ou de ser minha): solta tudo e diz por quê. */
  const falharMinha = useCallback((recusa: Recusa | null) => {
    soltarAudio(conexaoRef.current, microfoneRef.current);
    conexaoRef.current = null;
    microfoneRef.current = null;
    minhaIdRef.current = null;
    posseRef.current = null;
    setMinha((m) =>
      recusa === null ? null : m && { ...m, fase: "falhou", recusa, desligando: false },
    );
  }, []);

  /** A linha ao vivo da MINHA ligação mudou: a fase só anda. */
  const acompanharMinha = useCallback((linha: LigacaoAoVivo) => {
    if (linha.id !== minhaIdRef.current) return;
    // Reivindicada por OUTRA pessoa (o "Atender" dela chegou antes): não é a
    // minha — a recusa `ja_atendida` da rota fecha o painel.
    if (linha.atendente_id && linha.atendente_id !== userId) return;
    const nova = faseDoEstado(linha.estado);
    const agora = Date.now();
    setMinha((m) => {
      if (!m || m.id !== linha.id || !ativaAinda(m)) return m;
      const fase = faseSeguinte(m.fase, nova);
      if (fase === m.fase) return m;
      return {
        ...m,
        fase,
        emLigacaoDesde: fase === "em_ligacao" && m.emLigacaoDesde === null ? agora : m.emLigacaoDesde,
      };
    });
  }, [userId]);

  const tocarVozDoCliente = useCallback((fluxo: MediaStream) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.srcObject = fluxo;
    void audio.play().catch(() => {
      // O clique em Ligar/Atender libera a reprodução; recusa aqui é rara.
    });
  }, []);

  // ---- tempo real ----------------------------------------------------------
  useEffect(() => {
    if (!ativo || !userId) return;
    const supabase = createClient();
    let vivo = true;

    const reler = async () => {
      const comecou = Date.now();
      const { data, error } = await supabase.from("cb_ligacoes_ao_vivo").select(COLUNAS);
      if (!vivo || error) return;
      const lidas = (data ?? [])
        .map(lerLigacaoAoVivo)
        .filter((l): l is LigacaoAoVivo => l !== null);
      const recentes = new Set(
        [...eventosRef.current].filter(([, em]) => em >= comecou).map(([id]) => id),
      );
      const proximo = releituraAoVivo(lidas, aoVivoRef.current, apagadasRef.current, recentes);
      publicar(proximo);
      const minhaId = minhaIdRef.current;
      if (!minhaId) return;
      const linha = proximo.find((l) => l.id === minhaId);
      if (linha) acompanharMinha(linha);
      // Só conclui "acabou" a releitura que saiu DEPOIS de o id ser
      // conhecido: a de antes pode não ter a linha que a rota acabou de criar.
      else if (comecou > idConhecidoEmRef.current) encerrarMinha();
    };
    relerRef.current = reler;

    const canal = supabase
      .channel(`ligacoes-ao-vivo:${++canaisAbertos}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cb_ligacoes_ao_vivo" },
        (payload) => {
          if (!vivo) return;
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id?: unknown } | null)?.id;
            if (typeof id !== "string") return;
            apagadasRef.current.add(id);
            eventosRef.current.delete(id);
            publicar(juntarAoVivo(aoVivoRef.current, { tipo: "DELETE", id }, apagadasRef.current));
            if (id === minhaIdRef.current) encerrarMinha();
            return;
          }
          const linha = lerLigacaoAoVivo(payload.new);
          if (!linha) return;
          eventosRef.current.set(linha.id, Date.now());
          const antes = aoVivoRef.current.find((l) => l.id === linha.id);
          publicar(
            juntarAoVivo(aoVivoRef.current, { tipo: payload.eventType, linha }, apagadasRef.current),
          );
          acompanharMinha(linha);
          // O toque que OUTRA pessoa atendeu: "Atendida por Ana" e some.
          if (
            antes?.estado === "tocando" &&
            linha.estado !== "tocando" &&
            linha.atendente_id &&
            linha.atendente_id !== userId
          ) {
            const marca: AtendidaPorOutro = { linha, ate: Date.now() + ATENDIDA_POR_OUTRO_MS };
            setAtendidasPorOutro((atuais) => [...atuais.filter((a) => a.linha.id !== linha.id), marca]);
            window.setTimeout(() => {
              setAtendidasPorOutro((atuais) => atuais.filter((a) => a !== marca));
            }, ATENDIDA_POR_OUTRO_MS);
          }
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void reler();
      });

    return () => {
      vivo = false;
      relerRef.current = null;
      void supabase.removeChannel(canal);
    };
  }, [ativo, userId, publicar, acompanharMinha, encerrarMinha]);

  const precisaReler = aoVivo.length > 0 || ativaAinda(minha);
  useEffect(() => {
    if (!ativo || !precisaReler) return;
    const laco = window.setInterval(() => void relerRef.current?.(), RELEITURA_MS);
    return () => window.clearInterval(laco);
  }, [ativo, precisaReler]);

  // O provedor desmonta quando a casca troca o app pelo spinner: o login de
  // outra pessoa e o "Ver como" começando (Codex, #500). ⚠️ A posse cai junto
  // — o `conectar` pendente (microfone ou oferta no ar) para no próximo
  // `await` e solta o que pegou, em vez de seguir sem tela —, o áudio é solto
  // e a ligação que já existe é DESLIGADA na hora (sem isso, o cliente ficaria
  // no silêncio até a máquina notar a ponte caída).
  useEffect(
    () => () => {
      const id = minhaIdRef.current;
      const existe = respondidoRef.current;
      posseRef.current = null;
      minhaIdRef.current = null;
      soltarAudio(conexaoRef.current, microfoneRef.current);
      conexaoRef.current = null;
      microfoneRef.current = null;
      if (id && existe) desligarSemTela(id);
    },
    [],
  );

  // ---- ações ---------------------------------------------------------------
  const pedirDesligar = useCallback(
    async (id: string) => {
      try {
        const r = await fetch(`/api/cb/ligacoes/${id}/desligar`, { method: "POST" });
        // O fim chega pela linha ao vivo (o DELETE), não pela resposta.
        if (r.ok) return;
      } catch {
        // cai no aviso abaixo
      }
      toast.error(t("painel.erroAoDesligar"));
      setMinha((m) => (m && m.id === id ? { ...m, desligando: false } : m));
    },
    [t],
  );

  /** Depois de a rota responder: a linha pode ter andado (ou sumido) antes. */
  const alcancarALinha = useCallback(
    (id: string) => {
      if (apagadasRef.current.has(id)) return encerrarMinha();
      const linha = aoVivoRef.current.find((l) => l.id === id);
      if (linha) acompanharMinha(linha);
    },
    [acompanharMinha, encerrarMinha],
  );

  const conectar = useCallback(
    async (posse: symbol, pedir: (oferta: string) => Promise<Response>, idDaAtendida: string | null) => {
      const vale = () => posseRef.current === posse;
      try {
        const microfone = await pedirMicrofone();
        if (!vale() || cancelarRef.current) {
          microfone.getTracks().forEach((f) => f.stop());
          throw new Cancelada();
        }
        microfoneRef.current = microfone;
        setMinha((m) => (m ? { ...m, fase: faseSeguinte(m.fase, "conectando") } : m));
        const { conexao, oferta } = await montarOferta(microfone, tocarVozDoCliente);
        if (!vale()) {
          conexao.close();
          throw new Cancelada();
        }
        conexaoRef.current = conexao;
        if (cancelarRef.current) throw new Cancelada();

        let r: Response;
        try {
          r = await pedir(oferta);
        } catch {
          throw new Recusada("rede");
        }
        const corpo = (await r.json().catch(() => null)) as {
          ligacao?: unknown;
          resposta?: unknown;
          error?: unknown;
        } | null;
        const id = idDaAtendida ?? (typeof corpo?.ligacao === "string" ? corpo.ligacao : null);
        if (!r.ok || !id || typeof corpo?.resposta !== "string") {
          throw new Recusada(typeof corpo?.error === "string" ? corpo.error : null);
        }
        // A ligação EXISTE no servidor, e esta tela já não é dela (o provedor
        // saiu, ou ela acabou no meio do pedido): desliga, sem esperar a
        // máquina notar a ponte que nunca vai ligar.
        if (!vale()) return desligarSemTela(id);
        if (!idDaAtendida) {
          minhaIdRef.current = id;
          idConhecidoEmRef.current = Date.now();
          setMinha((m) => (m ? { ...m, id } : m));
        }
        respondidoRef.current = true;
        // Desligar clicado antes de a rota responder: a ligação existe agora.
        if (cancelarRef.current) {
          setMinha((m) => (m ? { ...m, desligando: true } : m));
          void pedirDesligar(id);
          return;
        }
        await aplicarResposta(conexao, corpo.resposta);
        if (vale()) alcancarALinha(id);
      } catch (erro) {
        if (!vale()) return;
        // Desligado pela pessoa antes de começar: fecha sem erro.
        if (erro instanceof Cancelada || cancelarRef.current) return falharMinha(null);
        const codigo =
          erro instanceof ErroDoAudio ? erro.codigo : erro instanceof Recusada ? erro.codigo : null;
        falharMinha(recusaConhecida(codigo));
      }
    },
    [alcancarALinha, falharMinha, pedirDesligar, tocarVozDoCliente],
  );

  const ligar = useCallback(
    (args: { conversationId: string; nome: string; canalId: string }) => {
      if (ativaAinda(minha) || posseRef.current) return;
      const posse = Symbol("ligacao");
      posseRef.current = posse;
      cancelarRef.current = false;
      respondidoRef.current = false;
      minhaIdRef.current = null;
      setMinha({
        id: null,
        direcao: "feita",
        conversationId: args.conversationId,
        nome: args.nome,
        canalId: args.canalId,
        fase: "microfone",
        recusa: null,
        emLigacaoDesde: null,
        duracaoSeg: null,
        mudo: false,
        desligando: false,
      });
      void conectar(
        posse,
        (oferta) =>
          fetch("/api/cb/ligacoes/ligar", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ conversationId: args.conversationId, oferta }),
          }),
        null,
      );
    },
    [conectar, minha],
  );

  const atender = useCallback(
    (linha: LigacaoAoVivo, nome: string) => {
      if (ativaAinda(minha) || posseRef.current) return;
      const posse = Symbol("ligacao");
      posseRef.current = posse;
      cancelarRef.current = false;
      respondidoRef.current = false;
      minhaIdRef.current = linha.id;
      idConhecidoEmRef.current = Date.now();
      setMinha({
        id: linha.id,
        direcao: "recebida",
        conversationId: linha.conversation_id,
        nome,
        canalId: linha.channel_id,
        fase: "microfone",
        recusa: null,
        emLigacaoDesde: null,
        duracaoSeg: null,
        mudo: false,
        desligando: false,
      });
      void conectar(
        posse,
        (oferta) =>
          fetch(`/api/cb/ligacoes/${linha.id}/atender`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ oferta }),
          }),
        linha.id,
      );
    },
    [conectar, minha],
  );

  const desligar = useCallback(() => {
    if (!ativaAinda(minha)) return;
    // Pedindo o microfone: nada saiu ainda — desiste e fecha.
    if (minha!.fase === "microfone") {
      cancelarRef.current = true;
      falharMinha(null);
      return;
    }
    setMinha((m) => (m ? { ...m, desligando: true } : m));
    const id = minhaIdRef.current;
    // A rota de ligar/atender ainda no ar: desfeita quando ela responder
    // (`conectar`). Desligar antes disso daria `ainda_tocando` na recebida.
    if (!id || !respondidoRef.current) {
      cancelarRef.current = true;
      return;
    }
    void pedirDesligar(id);
  }, [falharMinha, minha, pedirDesligar]);

  const alternarMudo = useCallback(() => {
    if (!minha) return;
    const mudo = !minha.mudo;
    microfoneRef.current?.getAudioTracks().forEach((faixa) => {
      faixa.enabled = !mudo;
    });
    setMinha((m) => (m ? { ...m, mudo } : m));
  }, [minha]);

  const fecharPainel = useCallback(() => {
    setMinha((m) => (ativaAinda(m) ? m : null));
  }, []);

  const abrirConversa = useCallback(
    (conversationId: string) => {
      router.push(urlDoInbox({ c: conversationId }));
      // Com a caixa de entrada já montada, o push só troca a query: a página
      // abre a conversa por este sinal (como o aviso do navegador).
      window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_CONVERSA, { detail: conversationId }));
    },
    [router],
  );

  // "Encerrada · 4 min 21 s" fica alguns segundos e o painel fecha sozinho.
  const encerrada = minha?.fase === "encerrada";
  useEffect(() => {
    if (!encerrada) return;
    const prazo = window.setTimeout(() => {
      setMinha((m) => (m?.fase === "encerrada" ? null : m));
    }, ENCERRADA_NA_TELA_MS);
    return () => window.clearTimeout(prazo);
  }, [encerrada]);

  // Recarregar ou fechar a aba com a ligação aberta pede confirmação: a ponte
  // cai, e a máquina desliga 15 s depois.
  const emLigacao = ativaAinda(minha);
  useEffect(() => {
    if (!emLigacao) return;
    const aoSair = (evento: BeforeUnloadEvent) => {
      evento.preventDefault();
      evento.returnValue = "";
    };
    window.addEventListener("beforeunload", aoSair);
    return () => window.removeEventListener("beforeunload", aoSair);
  }, [emLigacao]);

  const valor = useMemo<ContextoDasLigacoes>(
    () => ({ aoVivo, emLigacao, ligar }),
    [aoVivo, emLigacao, ligar],
  );

  const temToque =
    aoVivo.some((l) => l.direcao === "recebida" && l.estado === "tocando") ||
    atendidasPorOutro.length > 0;

  return (
    <Contexto.Provider value={valor}>
      {children}
      {/* A voz do cliente. Fora da árvore das páginas: navegar não a corta. */}
      <audio ref={audioRef} autoPlay className="hidden" />
      {ativo && minha && (
        <PainelDaLigacao
          minha={minha}
          onDesligar={desligar}
          onMudo={alternarMudo}
          onFechar={fecharPainel}
          onAbrirConversa={abrirConversa}
        />
      )}
      {ativo && podeAtender && temToque && userId && (
        <CartoesDeToque
          userId={userId}
          aoVivo={aoVivo}
          atendidasPorOutro={atendidasPorOutro}
          canalNoEscopo={(channelId) =>
            canalNoEscopo({ papel: papelReal, perfil: perfilDeAcesso }, channelId)
          }
          emLigacao={emLigacao}
          onAtender={atender}
        />
      )}
    </Contexto.Provider>
  );
}
