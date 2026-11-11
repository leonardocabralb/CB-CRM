// ============================================================
// O toque da ligação recebida (4c): um laço gerado pelo Web Audio, sem
// arquivo, enquanto há ligação TOCANDO para a pessoa (§8.11 do plano).
//
// - ⚠️ SÓ UMA ABA TOCA: a vez é uma trava (`navigator.locks`). A aba que a
//   pega toca até o toque acabar e a solta; as outras esperam na fila e, se a
//   que tocava fechar no meio, a próxima assume. Duas abas tocando juntas
//   soariam desencontradas.
// - ⚠️ Sem um clique NESTA aba, o navegador não deixa tocar (política de
//   reprodução automática; ver `som-do-aviso.ts`). A aba sem clique nem entra
//   na fila: seguraria a vez muda e calaria a aba que pode tocar.
// ============================================================

const TRAVA_DO_TOQUE = "cb-toque-da-ligacao";
/** Um ciclo: dois toques curtos e uma pausa, como o telefone. */
const CICLO_MS = 3_000;
const VOLUME = 0.12;

let contexto: AudioContext | null = null;

function contextoDeAudio(): AudioContext | null {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return null;
  if (!contexto || contexto.state === "closed") {
    try {
      contexto = new window.AudioContext();
    } catch (erro) {
      console.warn("[toque-da-ligacao] sem áudio:", erro);
      return null;
    }
  }
  return contexto;
}

/** Dois toques de tom duplo (440 + 480 Hz); o envelope em rampa evita o estalo. */
function tocarUmCiclo(ctx: AudioContext): void {
  const inicio = ctx.currentTime + 0.02;
  for (const em of [0, 0.75]) {
    const volume = ctx.createGain();
    volume.gain.setValueAtTime(0.0001, inicio + em);
    volume.gain.exponentialRampToValueAtTime(VOLUME, inicio + em + 0.03);
    volume.gain.setValueAtTime(VOLUME, inicio + em + 0.5);
    volume.gain.exponentialRampToValueAtTime(0.0001, inicio + em + 0.56);
    volume.connect(ctx.destination);
    for (const frequencia of [440, 480]) {
      const oscilador = ctx.createOscillator();
      oscilador.type = "sine";
      oscilador.frequency.value = frequencia;
      oscilador.connect(volume);
      oscilador.start(inicio + em);
      oscilador.stop(inicio + em + 0.58);
    }
  }
}

/**
 * Começa o toque em laço e devolve quem o para. Chamar o "parar" mais de uma
 * vez é inofensivo; parar antes de a vez chegar tira a aba da fila.
 *
 * ⚠️ Aba ainda sem clique (aberta agora, ou recarregada — a porta de entrada
 * pode passar sem gesto): o toque ESPERA o primeiro gesto nela e começa ali
 * (Codex, #500). Sem isso, a ligação seguia muda depois do clique: quem pede
 * o toque continua pedindo, e ninguém o pediria de novo.
 */
export function comecarToque(): () => void {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return () => {};
  if (!navigator.userActivation || navigator.userActivation.hasBeenActive) return tocarNaVez();

  let parar: (() => void) | null = null;
  const remover = () => {
    window.removeEventListener("pointerdown", aoGesto, true);
    window.removeEventListener("keydown", aoGesto, true);
  };
  function aoGesto() {
    remover();
    parar = tocarNaVez();
  }
  window.addEventListener("pointerdown", aoGesto, true);
  window.addEventListener("keydown", aoGesto, true);
  return () => {
    remover();
    parar?.();
  };
}

/** A vez de tocar (uma aba por vez) e o laço, até o "parar". */
function tocarNaVez(): () => void {
  const controle = new AbortController();
  const tocarAteParar = async (): Promise<void> => {
    if (controle.signal.aborted) return;
    const ctx = contextoDeAudio();
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") await ctx.resume();
    } catch {
      return;
    }
    if (controle.signal.aborted) return;
    await new Promise<void>((parou) => {
      const tique = () => {
        if (ctx.state === "running") tocarUmCiclo(ctx);
      };
      tique();
      const laco = window.setInterval(tique, CICLO_MS);
      controle.signal.addEventListener(
        "abort",
        () => {
          window.clearInterval(laco);
          parou();
        },
        { once: true },
      );
    });
  };

  if (navigator.locks) {
    // Abortar a espera rejeita a promessa (AbortError): é o "saiu da fila".
    navigator.locks
      .request(TRAVA_DO_TOQUE, { signal: controle.signal }, tocarAteParar)
      .catch(() => {});
  } else {
    void tocarAteParar();
  }
  return () => controle.abort();
}
