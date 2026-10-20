// ============================================================
// O som do CRM no aviso do navegador (decisão D4 do operador, 20/10/2026;
// `docs/PLANO-avisos-do-sino-no-navegador.md`). Até aqui o CRM não tocava
// som nenhum: o pop-up saía sem `silent` e o sistema decidia.
//
// - O toque é GERADO pelo Web Audio (duas notas curtas), sem arquivo.
// - ⚠️ O Chrome só deixa a página tocar som depois de um clique NAQUELA aba
//   (política de reprodução automática). Sem o clique — ou com o áudio que
//   não está rodando por qualquer motivo —, `tocarSomDoAviso` devolve false e
//   quem chama deixa o pop-up sem `silent`: o sistema decide, como antes —
//   nunca um pop-up mudo por causa do CRM.
// - ⚠️ Duas abas recebem o MESMO INSERT pelo realtime. O toque sai uma vez a
//   cada `INTERVALO_DO_SOM_MS`, entre as abas: a trava (`navigator.locks`)
//   serializa a pergunta "alguém tocou agora?" e o carimbo no localStorage a
//   responde. Sem a trava, as duas leriam o carimbo velho ao mesmo tempo.
// ============================================================

/** Um toque a cada 10 s no máximo, somadas as abas — uma rajada não vira alarme. */
export const INTERVALO_DO_SOM_MS = 10_000;

const CHAVE_DO_ULTIMO_SOM = "cb-som-do-aviso";
const TRAVA_DO_SOM = "cb-som-do-aviso";

/** Toca de novo? Puro: o carimbo ilegível (ou ausente) conta como "nunca tocou". */
export function podeTocarDeNovo(ultimoMs: number | null, agoraMs: number): boolean {
  if (ultimoMs === null || !Number.isFinite(ultimoMs)) return true;
  // Relógio que voltou (carimbo no futuro) não segura o som para sempre.
  if (ultimoMs > agoraMs) return true;
  return agoraMs - ultimoMs >= INTERVALO_DO_SOM_MS;
}

let contexto: AudioContext | null = null;

function contextoDeAudio(): AudioContext | null {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return null;
  if (!contexto || contexto.state === "closed") {
    // ⚠️ O construtor pode lançar (sem saída de áudio, limite de contextos).
    // Quem chama decide o `silent` DENTRO do `new Notification(...)`: um erro
    // aqui derrubaria o próprio pop-up.
    try {
      contexto = new window.AudioContext();
    } catch (erro) {
      console.warn("[som-do-aviso] sem áudio:", erro);
      return null;
    }
  }
  return contexto;
}

/** As duas notas. O envelope sobe e desce em rampa: corte seco estala. */
function tocarNotas(ctx: AudioContext): void {
  const inicio = ctx.currentTime + 0.01;
  const notas: [frequencia: number, em: number][] = [
    [660, 0],
    [880, 0.13],
  ];
  for (const [frequencia, em] of notas) {
    const oscilador = ctx.createOscillator();
    const volume = ctx.createGain();
    oscilador.type = "sine";
    oscilador.frequency.value = frequencia;
    volume.gain.setValueAtTime(0.0001, inicio + em);
    volume.gain.exponentialRampToValueAtTime(0.18, inicio + em + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.0001, inicio + em + 0.22);
    oscilador.connect(volume).connect(ctx.destination);
    oscilador.start(inicio + em);
    oscilador.stop(inicio + em + 0.24);
  }
}

async function tocarJa(): Promise<void> {
  const ctx = contextoDeAudio();
  if (!ctx) return;
  if (ctx.state === "suspended") await ctx.resume();
  tocarNotas(ctx);
}

function lerUltimo(): number | null {
  try {
    const texto = window.localStorage.getItem(CHAVE_DO_ULTIMO_SOM);
    return texto === null ? null : Number(texto);
  } catch {
    return null;
  }
}

function gravarUltimo(agoraMs: number): void {
  try {
    window.localStorage.setItem(CHAVE_DO_ULTIMO_SOM, String(agoraMs));
  } catch {
    // Sem storage (aba privada), o intervalo vale só nesta aba.
  }
}

/**
 * SÍNCRONA de propósito: roda dentro da trava, que se solta assim que ela
 * volta. Esperar o toque ali dentro prenderia a trava num `resume()` que não
 * resolve — e o som do CRM calaria em todas as abas até recarregar (revisão
 * do PR).
 */
function tocarSeNinguemTocou(): void {
  const agora = Date.now();
  if (!podeTocarDeNovo(lerUltimo(), agora)) return;
  gravarUltimo(agora);
  void tocarJa().catch((erro: unknown) => {
    console.warn("[som-do-aviso] o som não tocou:", erro);
  });
}

/**
 * Pede o som de um aviso. SÍNCRONO de propósito: quem chama decide o
 * `silent` do pop-up na mesma linha, sem um `await` entre a última olhada na
 * tela e o pop-up (`use-browser-notifications.ts`).
 *
 * Devolve true só com o áudio JÁ RODANDO (`state === "running"`): aí o som do
 * CRM cobre este aviso — tocando agora ou porque outro toque saiu há menos de
 * `INTERVALO_DO_SOM_MS` — e o pop-up pode sair calado. Qualquer outra coisa
 * devolve false e o pop-up sai sem `silent` (o sistema decide).
 *
 * ⚠️ O estado é o que o navegador JÁ decidiu, não uma promessa: o Chrome
 * cria o contexto rodando quando a política deixa e suspenso quando recusa.
 * Devolver true antes disso (a ativação da aba, um `resume()` no ar) deixava
 * o pop-up mudo quando o navegador recusava o áudio (Codex, PR #425). O
 * contexto suspenso ganha um `resume()` para o próximo aviso já o achar
 * rodando.
 */
export function tocarSomDoAviso(): boolean {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return false;
  // `hasBeenActive` = a aba já recebeu um clique ou tecla. Sem ele, nem cria
  // o contexto: o Chrome o criaria suspenso (e avisaria no console).
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;

  const ctx = contextoDeAudio();
  if (!ctx) return false;
  if (ctx.state !== "running") {
    void ctx.resume().catch(() => {
      // Recusado de novo: o sistema continua decidindo, aviso a aviso.
    });
    return false;
  }

  if (navigator.locks) {
    void navigator.locks.request(TRAVA_DO_SOM, tocarSeNinguemTocou).catch(tocarSeNinguemTocou);
  } else {
    tocarSeNinguemTocou();
  }
  return true;
}

/**
 * Os botões "Ouvir" e "Enviar notificação de teste" do cartão: toca na hora,
 * fora do intervalo (é um clique). Devolve true só quando o toque SAIU — o
 * áudio já rodando —, como `tocarSomDoAviso`: o teste só sai calado com o som
 * do CRM confirmado, senão seria um teste mudo e enganoso (Codex, PR #425).
 * Com o áudio suspenso, o clique o retoma e toca em seguida, mas devolve
 * false: o teste fica com o som do sistema.
 */
export function tocarSomAgora(): boolean {
  const ctx = contextoDeAudio();
  if (!ctx) return false;
  if (ctx.state === "running") {
    tocarNotas(ctx);
    return true;
  }
  void tocarJa().catch((erro: unknown) => {
    console.warn("[som-do-aviso] o som não tocou:", erro);
  });
  return false;
}
