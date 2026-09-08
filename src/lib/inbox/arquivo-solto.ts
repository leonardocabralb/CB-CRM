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
  const limpo = mimeNormalizado(mime);
  if (!limpo) return null;
  for (const tipo of ["image", "video", "document"] as const) {
    if (MIMES_ACEITOS[tipo].includes(limpo)) return tipo;
  }
  return null;
}

/**
 * O MIME sem os parâmetros que alguns aplicativos anexam, em minúsculas.
 *
 * ⚠️⚠️ NÃO é só para comparar: é o valor que vai para o Storage. O bucket
 * `chat-media` tem lista EXATA de MIMEs (023), então `image/png; charset=binary`
 * — a forma que aparece em colagem de alguns aplicativos — é recusado no
 * upload mesmo depois de `tipoDoArquivo` tê-lo aceitado. Aceitar numa ponta e
 * mandar cru na outra fazia a colagem falhar exatamente no caso que o código
 * dizia suportar (achado do Codex no PR #141).
 */
export function mimeNormalizado(mime: string | null | undefined): string {
  return (mime ?? "").split(";")[0]!.trim().toLowerCase();
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
  const ext = tipoDoArquivo(mime) === "image" ? (mimeNormalizado(mime).split("/")[1] ?? "png") : "bin";
  const carimbo = agora
    .toISOString()
    .slice(0, 19)
    .replace(/[-:]/g, "")
    .replace("T", "-");
  return `imagem-${carimbo}.${ext}`;
}

/**
 * O arquivo pronto para subir: nome e MIME já ajustados. Recria o `File` só
 * quando algo mudou — recriar à toa copia os bytes sem motivo.
 */
export function arquivoParaEnviar(arquivo: File, agora?: Date): File {
  const mime = mimeNormalizado(arquivo.type);
  const nome = nomeParaColagem(arquivo.name, mime, agora);
  if (nome === arquivo.name && mime === arquivo.type) return arquivo;
  return new File([arquivo], nome, { type: mime, lastModified: arquivo.lastModified });
}

/**
 * Quantos anexos o compositor aceita de uma vez.
 *
 * ⚠️ Existe para o upload não virar uma enxurrada: cada arquivo é uma
 * requisição ao Storage e uma MENSAGEM no WhatsApp. Soltar uma pasta com 200
 * arquivos por engano mandaria 200 mensagens ao cliente. Dez cobre o uso real
 * (um conjunto de documentos, algumas fotos) e mantém o erro reversível.
 */
export const MAX_ANEXOS = 10;

export interface ArquivosRecebidos {
  /** Os que serão anexados, na ordem em que vieram. */
  aceitos: File[];
  /** Vieram e não servem — tipo que o WhatsApp não aceita. */
  recusados: number;
  /** Passaram do teto e ficaram de fora. */
  excedentes: number;
}

/**
 * Reparte o que chegou: o que vai anexar, o que não serve e o que passou do
 * teto. Os três números importam porque cada um vira um aviso diferente —
 * engolir arquivo em silêncio é o que faz o operador achar que mandou o que
 * não mandou.
 *
 * `jaAnexados` é quanto já está na fila: o teto vale para o TOTAL, não para
 * cada soltura.
 */
export function escolherArquivos(
  arquivos: readonly File[],
  jaAnexados = 0,
): ArquivosRecebidos {
  const aceitos: File[] = [];
  let recusados = 0;
  for (const arquivo of arquivos) {
    if (tipoDoArquivo(arquivo.type) === null) recusados += 1;
    else aceitos.push(arquivo);
  }
  const vagas = Math.max(0, MAX_ANEXOS - jaAnexados);
  return {
    aceitos: aceitos.slice(0, vagas),
    recusados,
    excedentes: Math.max(0, aceitos.length - vagas),
  };
}

export function colagemEhAnexo(args: { temArquivo: boolean; texto: string }): boolean {
  return args.temArquivo && args.texto.trim() === "";
}
