// ============================================================
// O RASCUNHO da aba Marca — puro (sem React, sem fetch), testado.
//
// A aba mostra a marca ANTES de gravar: o que a pessoa digitou e os
// arquivos que escolheu (ainda só no navegador, como URL de objeto) viram
// uma `Marca` que a prévia desenha com os mesmos `LogoDaMarca` /
// `SimboloDaMarca` da barra lateral e do login. Se a regra de desenho
// mudar, a prévia muda junto.
//
// ⚠️ Uma marca PRÓPRIA nunca herda imagem do padrão: quem sai do padrão
// para a marca própria começa com todas as peças vazias (a mesma regra de
// `resolverMarca`). Senão a prévia mostraria o logo do padrão numa marca
// que, gravada, não o terá.
//
// O contrato da rota (`/api/cb/marca`) está em `docs/PLANO-marca-configuravel.md`.
// ============================================================

import {
  COR_DO_ICONE_PADRAO,
  LIMITE_DO_NOME,
  LIMITE_DO_NOME_CURTO,
  PECAS_DA_MARCA,
  TETO_DE_BYTES_DA_MARCA,
  caracteres,
  corValida,
  type LinhaDaMarca,
  type Marca,
  type PecaDaMarca,
} from '@/lib/marca';
import {
  CAMPO_DA_PECA,
  validarPeca,
  type ErroDaPeca,
} from '@/lib/marca-validacao';

/** O corpo que GET, POST e DELETE de `/api/cb/marca` devolvem. */
export interface RespostaDaMarca {
  marca: Marca;
  linha: LinhaDaMarca | null;
  podeEditar: boolean;
  motivo: null | 'nao_admin' | 'nao_e_a_conta_da_instalacao';
}

/**
 * Confere a forma da resposta. A rota é nossa, mas um proxy que devolva
 * HTML com 200, ou uma versão velha da rota, não pode virar "o padrão" na
 * tela (vazio por ignorância): forma desconhecida é ERRO de leitura.
 */
export function ehRespostaDaMarca(corpo: unknown): corpo is RespostaDaMarca {
  if (!corpo || typeof corpo !== 'object') return false;
  const c = corpo as Record<string, unknown>;
  const marca = c.marca as Record<string, unknown> | null | undefined;
  return (
    !!marca &&
    typeof marca === 'object' &&
    typeof marca.propria === 'boolean' &&
    typeof marca.nome === 'string' &&
    typeof c.podeEditar === 'boolean' &&
    (c.linha === null || typeof c.linha === 'object')
  );
}

// ------------------------------------------------------------
// Peças: o nome no código (camelCase) × o nome no formulário (snake_case,
// `CAMPO_DA_PECA` da validação compartilhada com a rota)
// ------------------------------------------------------------

/** O `peca` de um erro 400 da rota → a peça; desconhecido = `null`. */
export function pecaDoCampo(campo: unknown): PecaDaMarca | null {
  if (typeof campo !== 'string') return null;
  return PECAS_DA_MARCA.find((p) => CAMPO_DA_PECA[p] === campo) ?? null;
}

/** Sobre qual fundo cada peça aparece (o símbolo, sobre os dois). */
export function fundoDaPeca(peca: PecaDaMarca): 'escuro' | 'claro' | 'ambos' {
  if (peca === 'simbolo') return 'ambos';
  return peca.endsWith('Escuro') ? 'escuro' : 'claro';
}

// ------------------------------------------------------------
// Erros: os códigos da rota, que a tela também usa na validação local
// ------------------------------------------------------------

/**
 * Os códigos dos 400 da rota.
 *
 * ⚠️ Cada código é também a chave `Settings.marca.erros.<codigo>` nos dois
 * dicionários (chave MONTADA: `textos-da-marca.test.ts` cobra). Código novo
 * na rota sem entrada aqui cai no erro genérico — nunca na chave crua. Os
 * 500 (`falha_no_storage`, `falha_no_banco`) ficam de fora de propósito: a
 * tela diz só "não foi possível salvar", que é o que a pessoa pode fazer
 * algo a respeito.
 */
export const CODIGOS_DE_ERRO = [
  'nome_obrigatorio',
  'nome_longo',
  'nome_curto_longo',
  'cor_invalida',
  'peca_desconhecida',
  'tipo_nao_aceito',
  'arquivo_grande',
  'arquivo_corrompido',
  'svg_inseguro',
  'simbolo_pequeno',
  'simbolo_grande',
  'simbolo_nao_quadrado',
  'simbolo_obrigatorio',
] as const;

export type CodigoDeErro = (typeof CODIGOS_DE_ERRO)[number];

/**
 * O 403 de POST/DELETE só é "você não pode trocar a marca" quando o corpo
 * diz isso: o motivo da própria rota ou o papel insuficiente do
 * `requireRole('admin')`.
 *
 * ⚠️ O mesmo `requireRole` responde 403 ("Could not load account context")
 * quando a LEITURA do perfil falha no banco. Dito como "sem permissão", o
 * soluço do banco faria o admin desistir de uma permissão que ele tem
 * (regra da área: falha ao ler a conta nunca é "não é você"). Corpo que
 * não se reconhece cai na frase genérica.
 */
export function ehRecusaDePermissao(status: number, corpo: unknown): boolean {
  if (status !== 403 || !corpo || typeof corpo !== 'object') return false;
  const { erro, error } = corpo as { erro?: unknown; error?: unknown };
  if (erro === 'nao_admin' || erro === 'nao_e_a_conta_da_instalacao') {
    return true;
  }
  // A frase do `requireRole` (`src/lib/auth/account.ts`).
  return typeof error === 'string' && /requires the '[^']+' role/.test(error);
}

export function codigoConhecido(codigo: unknown): CodigoDeErro | null {
  return typeof codigo === 'string' &&
    (CODIGOS_DE_ERRO as readonly string[]).includes(codigo)
    ? (codigo as CodigoDeErro)
    : null;
}

/**
 * Erro de peça da validação compartilhada → código da tela. ⚠️ Não compila
 * se a validação ganhar um erro que `CODIGOS_DE_ERRO` não conhece — e,
 * portanto, sem frase no dicionário.
 */
function codigoDaPeca(erro: ErroDaPeca): CodigoDeErro {
  return erro;
}

/**
 * Confere o arquivo escolhido ANTES de enviar, com as MESMAS regras da rota
 * (`validarPeca`, de `src/lib/marca-validacao.ts`): tipo da peça, teto,
 * conteúdo pela assinatura, medidas do símbolo e SVG sem nada que execute.
 * A rota confere de novo; aqui só se poupa a ida e volta (e o arquivo de
 * 1 MB subindo à toa).
 *
 * ⚠️ Acima do teto, NÃO lê o arquivo: `validarPeca` recusa pelo tamanho
 * declarado antes de olhar os bytes, e ler um vídeo de 2 GB escolhido por
 * engano travaria a aba.
 */
export async function conferirArquivo(
  peca: PecaDaMarca,
  arquivo: File
): Promise<CodigoDeErro | null> {
  let bytes = new Uint8Array(0);
  if (arquivo.size <= TETO_DE_BYTES_DA_MARCA) {
    try {
      bytes = new Uint8Array(await arquivo.arrayBuffer());
    } catch {
      return 'arquivo_corrompido';
    }
  }
  const resultado = validarPeca(peca, {
    tipo: arquivo.type,
    tamanho: arquivo.size,
    bytes,
  });
  return resultado.ok ? null : codigoDaPeca(resultado.erro);
}

// ------------------------------------------------------------
// O rascunho
// ------------------------------------------------------------

/** Arquivo escolhido e ainda não salvo; `url` é a URL de objeto da prévia. */
export interface PecaNova {
  arquivo: File;
  url: string;
}

export interface Rascunho {
  nome: string;
  nomeCurto: string;
  /** Como digitado; vazio = sem cor própria (vale o padrão). */
  corDoIcone: string;
  novas: Partial<Record<PecaDaMarca, PecaNova>>;
  /** Peças GRAVADAS que a pessoa mandou tirar. */
  removidas: readonly PecaDaMarca[];
}

/** O rascunho que reproduz o que está gravado (nada mudou). */
export function rascunhoDaLinha(linha: LinhaDaMarca | null): Rascunho {
  return {
    nome: linha?.nome ?? '',
    nomeCurto: linha?.nome_curto ?? '',
    corDoIcone: linha?.cor_do_icone ?? '',
    novas: {},
    removidas: [],
  };
}

/** A peça como está GRAVADA — nunca a do padrão numa marca própria. */
function pecaGravada(gravada: Marca, peca: PecaDaMarca): string | null {
  return gravada.propria ? gravada[peca] : null;
}

export type EstadoDaPeca = 'gravada' | 'nova' | 'removida' | 'vazia';

export function estadoDaPeca(
  gravada: Marca,
  rascunho: Rascunho,
  peca: PecaDaMarca
): EstadoDaPeca {
  if (rascunho.novas[peca]) return 'nova';
  if (rascunho.removidas.includes(peca)) return 'removida';
  return pecaGravada(gravada, peca) ? 'gravada' : 'vazia';
}

/**
 * Rascunho → a `Marca` que a prévia desenha: peça nova = URL de objeto,
 * removida = `null`, o resto = a gravada (só se a gravada já é própria).
 */
export function montarRascunho(gravada: Marca, rascunho: Rascunho): Marca {
  const nome = rascunho.nome.trim();
  const cor = rascunho.corDoIcone.trim();
  const peca = (p: PecaDaMarca): string | null => {
    const nova = rascunho.novas[p];
    if (nova) return nova.url;
    if (rascunho.removidas.includes(p)) return null;
    return pecaGravada(gravada, p);
  };
  return {
    propria: true,
    nome,
    nomeCurto: rascunho.nomeCurto.trim() || nome,
    corDoIcone: corValida(cor) ? cor : COR_DO_ICONE_PADRAO,
    simbolo: peca('simbolo'),
    horizontalEscuro: peca('horizontalEscuro'),
    horizontalClaro: peca('horizontalClaro'),
    verticalEscuro: peca('verticalEscuro'),
    verticalClaro: peca('verticalClaro'),
    versao: 'rascunho',
  };
}

/**
 * O que impede gravar o rascunho, na ordem em que a tela mostra. A rota
 * recusaria cada um destes com o mesmo código.
 */
export function problemasDoRascunho(
  gravada: Marca,
  rascunho: Rascunho
): CodigoDeErro[] {
  const problemas: CodigoDeErro[] = [];
  const nome = rascunho.nome.trim();
  if (!nome) problemas.push('nome_obrigatorio');
  // `caracteres`, nunca `.length`: a rota e o CHECK contam ponto de código.
  else if (caracteres(nome) > LIMITE_DO_NOME) problemas.push('nome_longo');
  if (caracteres(rascunho.nomeCurto.trim()) > LIMITE_DO_NOME_CURTO) {
    problemas.push('nome_curto_longo');
  }
  const cor = rascunho.corDoIcone.trim();
  if (cor && !corValida(cor)) problemas.push('cor_invalida');
  if (!montarRascunho(gravada, rascunho).simbolo) {
    problemas.push('simbolo_obrigatorio');
  }
  return problemas;
}

export interface MudancasDoRascunho {
  nome: boolean;
  nomeCurto: boolean;
  corDoIcone: boolean;
  novas: PecaDaMarca[];
  /** Só as que existem gravadas: tirar o que não existe não é mudança. */
  remover: PecaDaMarca[];
  alguma: boolean;
}

/** O rascunho contra o que está gravado (`linha` e a `Marca` do mesmo GET). */
export function mudancasDoRascunho(
  linha: LinhaDaMarca | null,
  gravada: Marca,
  rascunho: Rascunho
): MudancasDoRascunho {
  const igual = (a: string, b: string | null | undefined) =>
    a.trim() === (b ?? '').trim();
  const nome = !igual(rascunho.nome, linha?.nome);
  const nomeCurto = !igual(rascunho.nomeCurto, linha?.nome_curto);
  // A cor compara sem caixa: `#0A0A0A` e `#0a0a0a` são a mesma cor.
  const corDoIcone = !igual(
    rascunho.corDoIcone.toLowerCase(),
    linha?.cor_do_icone?.toLowerCase()
  );
  const novas = PECAS_DA_MARCA.filter((p) => rascunho.novas[p]);
  const remover = PECAS_DA_MARCA.filter(
    (p) =>
      !rascunho.novas[p] &&
      rascunho.removidas.includes(p) &&
      !!pecaGravada(gravada, p)
  );
  return {
    nome,
    nomeCurto,
    corDoIcone,
    novas,
    remover,
    alguma:
      nome || nomeCurto || corDoIcone || novas.length > 0 || remover.length > 0,
  };
}

/**
 * O corpo do POST: o nome sempre (a rota o exige), e do resto SÓ o que
 * mudou — campo ausente = a rota mantém o gravado; presente e vazio =
 * limpar (nome curto, cor).
 */
export function formularioDoRascunho(
  linha: LinhaDaMarca | null,
  gravada: Marca,
  rascunho: Rascunho
): FormData {
  const mudancas = mudancasDoRascunho(linha, gravada, rascunho);
  const corpo = new FormData();
  corpo.append('nome', rascunho.nome.trim());
  if (mudancas.nomeCurto) corpo.append('nome_curto', rascunho.nomeCurto.trim());
  if (mudancas.corDoIcone) {
    corpo.append('cor_do_icone', rascunho.corDoIcone.trim().toLowerCase());
  }
  for (const p of mudancas.novas) {
    const nova = rascunho.novas[p]!;
    corpo.append(CAMPO_DA_PECA[p], nova.arquivo, nova.arquivo.name);
  }
  for (const p of mudancas.remover) corpo.append('remover', CAMPO_DA_PECA[p]);
  return corpo;
}

/** "1 MB" — o teto por imagem, para as frases da tela. */
export function tetoLegivel(): string {
  const mb = TETO_DE_BYTES_DA_MARCA / 1_048_576;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

/** O nome do arquivo de exemplo (`/marca/x.png` → `x.png`), para o `download`. */
export function nomeDoArquivo(caminho: string): string {
  return caminho.slice(caminho.lastIndexOf('/') + 1);
}
