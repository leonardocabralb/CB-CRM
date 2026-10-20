// ============================================================
// A MARCA, num lugar só (puro: serve ao navegador e ao servidor).
//
// Até a 1094 o nome e o logo eram build-args (`NEXT_PUBLIC_APP_*`),
// inlinados no bundle: trocar de marca exigia gerar outra imagem. Agora a
// marca é DADO da instalação — uma linha em `cb_marca`, editada em
// Configurações → Marca — e quem compra o sistema troca nome e logo pela
// tela. Sem linha gravada, vale o padrão do produto: Atlas CRM.
//
// Quem lê:
// - no servidor, `obterMarca()` (`src/lib/marca-servidor.ts`), em cache;
// - no navegador, `useMarca()` (`src/components/marca/marca-provider.tsx`),
//   que recebe do layout raiz a marca já resolvida.
//
// ⚠️ Uma marca PRÓPRIA nunca herda imagem do Atlas: peça que o comprador
// não enviou fica `null`, e a tela cai no símbolo com o nome em texto. O
// Atlas aparece inteiro (padrão) ou não aparece.
// ============================================================

/** O nome do produto quando a instalação não gravou marca própria. */
export const NOME_PADRAO = 'Atlas CRM'

/** O nome embaixo do ícone do app instalado (o iPhone corta nome comprido). */
export const NOME_CURTO_PADRAO = 'Atlas'

/**
 * Fundo do ícone do app instalado: a mesma cor do `themeColor` do layout e
 * do `background_color` do manifesto (o modo escuro é o padrão do app).
 */
export const COR_DO_ICONE_PADRAO = '#020617'

/**
 * Tamanhos do ícone do app instalado: 180 é o que o iPhone usa; 192 e 512,
 * os que o Android exige no manifesto. `apple-icon.tsx` gera um arquivo por
 * tamanho e `manifest.ts` aponta para eles — os dois leem daqui para não
 * divergirem (um tamanho que só um lado conhece vira ícone quebrado, sem
 * erro nenhum).
 */
export const TAMANHOS_DO_ICONE = [180, 192, 512] as const

/** As cinco imagens de uma marca. */
export const PECAS_DA_MARCA = [
  'simbolo',
  'horizontalEscuro',
  'horizontalClaro',
  'verticalEscuro',
  'verticalClaro',
] as const

export type PecaDaMarca = (typeof PECAS_DA_MARCA)[number]

/** Coluna de `cb_marca` que guarda o caminho no Storage de cada peça. */
export const COLUNA_DA_PECA: Record<PecaDaMarca, string> = {
  simbolo: 'simbolo_path',
  horizontalEscuro: 'horizontal_escuro_path',
  horizontalClaro: 'horizontal_claro_path',
  verticalEscuro: 'vertical_escuro_path',
  verticalClaro: 'vertical_claro_path',
}

/**
 * Os arquivos do Atlas CRM, servidos de `public/marca/`. São também os
 * EXEMPLOS da aba Marca: quem troca a marca baixa cada um para ver formato,
 * proporção e fundo de cada peça.
 *
 * "Escuro"/"claro" é o FUNDO onde a peça aparece: a horizontal escura tem o
 * texto branco (vai no modo escuro do app); a clara, texto preto.
 */
export const ARQUIVOS_PADRAO: Record<PecaDaMarca, string> = {
  simbolo: '/marca/atlas-simbolo.png',
  horizontalEscuro: '/marca/atlas-horizontal-escuro.png',
  horizontalClaro: '/marca/atlas-horizontal-claro.png',
  verticalEscuro: '/marca/atlas-vertical-escuro.png',
  verticalClaro: '/marca/atlas-vertical-claro.png',
}

/** Bucket público do Storage onde mora a marca própria (1094). */
export const BUCKET_DA_MARCA = 'marca'

/** Teto por imagem: o mesmo `file_size_limit` do bucket na 1094. */
export const TETO_DE_BYTES_DA_MARCA = 1_048_576

/**
 * Tipos aceitos por peça (o bucket aceita a união). O símbolo é só PNG: o
 * gerador do ícone da aba e do app instalado (`next/og`) não lê WebP, e um
 * SVG ali dependeria do que o gerador entende de SVG.
 */
export const TIPOS_DA_PECA: Record<PecaDaMarca, readonly string[]> = {
  simbolo: ['image/png'],
  horizontalEscuro: ['image/png', 'image/webp', 'image/svg+xml'],
  horizontalClaro: ['image/png', 'image/webp', 'image/svg+xml'],
  verticalEscuro: ['image/png', 'image/webp', 'image/svg+xml'],
  verticalClaro: ['image/png', 'image/webp', 'image/svg+xml'],
}

export const LIMITE_DO_NOME = 60
export const LIMITE_DO_NOME_CURTO = 20

/** A marca resolvida: o que as telas desenham. */
export interface Marca {
  /** `false` = o padrão do produto (Atlas CRM). */
  propria: boolean
  nome: string
  nomeCurto: string
  /** `#rrggbb` — fundo do ícone do app instalado. */
  corDoIcone: string
  /** URL de cada peça; `null` = a marca própria não tem essa peça. */
  simbolo: string | null
  horizontalEscuro: string | null
  horizontalClaro: string | null
  verticalEscuro: string | null
  verticalClaro: string | null
  /** Carimbo que muda a cada gravação (fura o cache de ícone e manifesto). */
  versao: string
}

/** A linha de `cb_marca` como o banco devolve. */
export interface LinhaDaMarca {
  nome: string | null
  nome_curto: string | null
  cor_do_icone: string | null
  simbolo_path: string | null
  horizontal_escuro_path: string | null
  horizontal_claro_path: string | null
  vertical_escuro_path: string | null
  vertical_claro_path: string | null
  atualizado_em: string | null
}

const COR_HEX = /^#[0-9a-fA-F]{6}$/

export function corValida(cor: unknown): cor is string {
  return typeof cor === 'string' && COR_HEX.test(cor)
}

export function marcaPadrao(): Marca {
  return {
    propria: false,
    nome: NOME_PADRAO,
    nomeCurto: NOME_CURTO_PADRAO,
    corDoIcone: COR_DO_ICONE_PADRAO,
    ...ARQUIVOS_PADRAO,
    versao: 'padrao',
  }
}

/**
 * Linha do banco → marca desenhável.
 *
 * Sem linha, ou com o nome vazio, é o padrão. Com nome, é marca própria:
 * cada peça vem do caminho gravado (`urlPublica` monta a URL do Storage)
 * ou fica `null` — nunca o arquivo do Atlas.
 */
export function resolverMarca(
  linha: LinhaDaMarca | null,
  urlPublica: (caminho: string) => string,
): Marca {
  const nome = linha?.nome?.trim()
  if (!linha || !nome) return marcaPadrao()

  const peca = (caminho: string | null) =>
    caminho && caminho.trim() ? urlPublica(caminho) : null

  return {
    propria: true,
    nome,
    nomeCurto: linha.nome_curto?.trim() || nome,
    corDoIcone: corValida(linha.cor_do_icone)
      ? linha.cor_do_icone
      : COR_DO_ICONE_PADRAO,
    simbolo: peca(linha.simbolo_path),
    horizontalEscuro: peca(linha.horizontal_escuro_path),
    horizontalClaro: peca(linha.horizontal_claro_path),
    verticalEscuro: peca(linha.vertical_escuro_path),
    verticalClaro: peca(linha.vertical_claro_path),
    versao: linha.atualizado_em
      ? String(Date.parse(linha.atualizado_em) || linha.atualizado_em)
      : 'propria',
  }
}

/**
 * A imagem para uma forma num fundo. A vertical que falta cai na horizontal
 * do mesmo fundo; sem nenhuma, `null` — e a tela desenha símbolo + nome.
 * Nunca troca de fundo: o logo de texto branco num fundo claro some.
 */
export function logoPara(
  marca: Marca,
  forma: 'horizontal' | 'vertical',
  fundo: 'escuro' | 'claro',
): string | null {
  const horizontal =
    fundo === 'escuro' ? marca.horizontalEscuro : marca.horizontalClaro
  if (forma === 'horizontal') return horizontal
  const vertical = fundo === 'escuro' ? marca.verticalEscuro : marca.verticalClaro
  return vertical ?? horizontal
}
