/**
 * Arquivo que chega ao compositor SEM passar pelo seletor — arrastado para
 * dentro da conversa, ou colado com Ctrl+V (o print de tela é o caso que o
 * operador pediu). Puro: decide o que fazer com o que veio, sem tocar em DOM.
 *
 * ⚠️ Os tipos aceitos são os MESMOS do seletor de anexo (`PICKER_ACCEPT`), e
 * moram aqui para não existirem em duas listas: um arquivo que o seletor
 * recusa não pode entrar pela porta de trás e falhar só no envio, quando o
 * WhatsApp o rejeita.
 */

export type TipoDeAnexo = "image" | "video" | "document";

/** Mesma lista que alimenta o `accept` dos três seletores do compositor. */
export const MIMES_ACEITOS: Record<TipoDeAnexo, readonly string[]> = {
  image: ["image/png", "image/jpeg", "image/webp"],
  video: ["video/mp4", "video/3gpp"],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
  ],
};

/** O `accept=` de cada seletor, derivado da lista acima. */
export const ACEITE_DO_SELETOR: Record<TipoDeAnexo, string> = {
  image: MIMES_ACEITOS.image.join(","),
  video: MIMES_ACEITOS.video.join(","),
  document: MIMES_ACEITOS.document.join(","),
};

/**
 * Em qual dos três seletores este arquivo se encaixa? `null` = nenhum, e aí
 * o compositor recusa com aviso em vez de subir algo que o WhatsApp não
 * aceita.
 *
 * ⚠️ O MIME é comparado em minúsculas e sem os parâmetros que alguns
 * sistemas anexam (`image/png; charset=binary` aparece em colagem de
 * certos aplicativos).
 */
export function tipoDoArquivo(mime: string | null | undefined): TipoDeAnexo | null {
  const limpo = (mime ?? "").split(";")[0]!.trim().toLowerCase();
  if (!limpo) return null;
  for (const tipo of ["image", "video", "document"] as const) {
    if (MIMES_ACEITOS[tipo].includes(limpo)) return tipo;
  }
  return null;
}

/**
 * Nome para um arquivo que chegou sem nome — o print colado do Ctrl+V vem
 * como `image.png` em alguns navegadores e VAZIO em outros. O nome viaja
 * para o WhatsApp e para a coluna `media_filename`, então "" ali vira uma
 * bolha sem rótulo.
 */
export function nomeParaColagem(nomeOriginal: string, mime: string, agora = new Date()): string {
  const nome = nomeOriginal.trim();
  // "image.png" é o placeholder do Chrome, igual em toda colagem — dois
  // prints na mesma conversa ficariam com o mesmo nome.
  if (nome && nome !== "image.png") return nome;
  const ext = tipoDoArquivo(mime) === "image" ? (mime.split("/")[1] ?? "png").split(";")[0] : "bin";
  const carimbo = agora
    .toISOString()
    .slice(0, 19)
    .replace(/[-:]/g, "")
    .replace("T", "-");
  return `imagem-${carimbo}.${ext}`;
}

export interface ArquivoRecebido {
  arquivo: File;
  tipo: TipoDeAnexo;
  /** Quantos vieram junto e foram ignorados (o compositor leva UM anexo). */
  ignorados: number;
}

export type ResultadoDoArquivo =
  | { ok: true; recebido: ArquivoRecebido }
  /** Veio arquivo, mas nenhum de tipo aceito. */
  | { ok: false; motivo: "tipo_recusado" }
  /** Não veio arquivo nenhum — o navegador que trate (texto arrastado, etc.). */
  | { ok: false; motivo: "sem_arquivo" };

/**
 * Escolhe o arquivo a anexar. O compositor carrega UM anexo por vez, então
 * o primeiro ACEITO vence e o resto é contado para o aviso.
 */
export function escolherArquivo(arquivos: readonly File[]): ResultadoDoArquivo {
  if (arquivos.length === 0) return { ok: false, motivo: "sem_arquivo" };
  const aceitos = arquivos
    .map((arquivo) => ({ arquivo, tipo: tipoDoArquivo(arquivo.type) }))
    .filter((x): x is { arquivo: File; tipo: TipoDeAnexo } => x.tipo !== null);
  if (aceitos.length === 0) return { ok: false, motivo: "tipo_recusado" };
  return {
    ok: true,
    recebido: {
      arquivo: aceitos[0]!.arquivo,
      tipo: aceitos[0]!.tipo,
      ignorados: arquivos.length - 1,
    },
  };
}

/**
 * A colagem deve virar ANEXO?
 *
 * ⚠️ Só quando não há texto junto. Copiar de um editor traz texto E imagem no
 * mesmo evento (o Word e o Google Docs fazem isso), e roubar a colagem ali
 * transformaria um Ctrl+V de texto num upload — perdendo o texto que a
 * pessoa queria colar. Com texto presente, o navegador faz o normal.
 */
export function colagemEhAnexo(args: { temArquivo: boolean; texto: string }): boolean {
  return args.temArquivo && args.texto.trim() === "";
}
