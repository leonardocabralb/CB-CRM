// ============================================================
// O áudio do atendente na ligação pelo CRM (4c): o microfone desta aba e a
// ponte WebRTC com o computador de ligações (`maquina-de-ligacoes/ponte.html`).
// A sinalização passa pelas rotas do CRM (`/api/cb/ligacoes/…`): a oferta vai
// no pedido de ligar/atender e a resposta da máquina volta nele.
//
// ⚠️ A oferta se monta NO CLIQUE, nunca antes (medido na 4b): a de 13 min
// falhou — o endereço público do navegador (o candidato do STUN) expira com o
// NAT. Os candidatos vão DENTRO da oferta (sem trickle): a rota é um pedido
// só, e a máquina responde com os dela da mesma forma.
// ============================================================

/** O mesmo STUN público do teste B e da 4b. TURN só se a rede do escritório barrar (P8). */
export const SERVIDORES_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

/** A espera pelos candidatos de rede, como a ponte da máquina (4 s). */
const ESPERA_DOS_CANDIDATOS_MS = 4_000;

/** Erro com o código que o painel traduz (`RECUSAS` de `ao-vivo.ts`). */
export class ErroDoAudio extends Error {
  constructor(readonly codigo: "microfone_negado" | "microfone_indisponivel" | "audio_falhou") {
    super(codigo);
  }
}

export async function pedirMicrofone(): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new ErroDoAudio("microfone_indisponivel");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (erro) {
    const nome = erro instanceof DOMException ? erro.name : "";
    // Negado pela pessoa ou pela política do navegador.
    if (nome === "NotAllowedError" || nome === "SecurityError") {
      throw new ErroDoAudio("microfone_negado");
    }
    // Sem microfone, ou ocupado por outro programa.
    throw new ErroDoAudio("microfone_indisponivel");
  }
}

function esperarCandidatos(conexao: RTCPeerConnection): Promise<void> {
  return new Promise((pronto) => {
    if (conexao.iceGatheringState === "complete") return pronto();
    const teto = setTimeout(fim, ESPERA_DOS_CANDIDATOS_MS);
    function fim() {
      clearTimeout(teto);
      conexao.removeEventListener("icegatheringstatechange", aoMudar);
      pronto();
    }
    function aoMudar() {
      if (conexao.iceGatheringState === "complete") fim();
    }
    conexao.addEventListener("icegatheringstatechange", aoMudar);
  });
}

/**
 * A oferta com o microfone e os candidatos. `aoChegarAudio` recebe a voz do
 * cliente (a faixa que a máquina devolve) para tocar num `<audio>`.
 */
export async function montarOferta(
  microfone: MediaStream,
  aoChegarAudio: (fluxo: MediaStream) => void,
): Promise<{ conexao: RTCPeerConnection; oferta: string }> {
  const conexao = new RTCPeerConnection({ iceServers: SERVIDORES_ICE });
  try {
    for (const faixa of microfone.getAudioTracks()) conexao.addTrack(faixa, microfone);
    conexao.ontrack = (evento) => {
      aoChegarAudio(evento.streams[0] ?? new MediaStream([evento.track]));
    };
    await conexao.setLocalDescription(await conexao.createOffer());
    await esperarCandidatos(conexao);
    const oferta = conexao.localDescription?.sdp ?? "";
    if (!oferta.startsWith("v=0")) throw new ErroDoAudio("audio_falhou");
    return { conexao, oferta };
  } catch (erro) {
    conexao.close();
    throw erro instanceof ErroDoAudio ? erro : new ErroDoAudio("audio_falhou");
  }
}

export async function aplicarResposta(conexao: RTCPeerConnection, resposta: string): Promise<void> {
  try {
    await conexao.setRemoteDescription({ type: "answer", sdp: resposta });
  } catch {
    throw new ErroDoAudio("audio_falhou");
  }
}

/** Fecha a ponte e SOLTA o microfone (o ponto vermelho da aba some). */
export function soltarAudio(conexao: RTCPeerConnection | null, microfone: MediaStream | null): void {
  try {
    conexao?.close();
  } catch {
    // Já fechada.
  }
  microfone?.getTracks().forEach((faixa) => faixa.stop());
}
