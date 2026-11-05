// ------------------------------------------------------------
// Cliente ideal (ICP) — a forma dos perfis e as contas da tela (1124).
//
// A REGRA mora no banco: `cb_clientes_ideais` decide quem é ideal ou
// possível, sempre comparando respostas NORMALIZADAS. Este módulo é puro
// (nada de supabase) e guarda só o que a tela precisa antes de gravar:
//   - o espelho do CHECK `cb_criterios_de_cliente_ideal_validos`
//     (`criteriosValidos`), para a tela recusar antes do banco;
//   - o espelho de `cb_resposta_normalizada` (`respostaNormalizada`), para a
//     caixa de uma resposta aparecer marcada quando a regra já a cobre por
//     outra grafia.
// Mudou um lado, muda o outro: `cliente-ideal.test.ts` lê a migration.
// ------------------------------------------------------------

/** Espelho do CHECK de `nome` (1124). */
export const TETO_DO_NOME_DO_PERFIL = 40;
/** Espelho do teto de critérios por perfil (1124). */
export const TETO_DE_CRITERIOS = 10;
/** Espelho do teto de respostas por critério e do LIMIT de `cb_respostas_do_campo`. */
export const TETO_DE_RESPOSTAS = 200;

export type NivelDeClienteIdeal = 'ideal' | 'possivel';

export interface CriterioDeClienteIdeal {
  /** `custom_fields.id`. */
  campo: string;
  /** As respostas que contam (basta uma). Guardadas como foram marcadas. */
  respostas: string[];
}

export interface PerfilDeClienteIdeal {
  id: string;
  account_id: string;
  nome: string;
  ativo: boolean;
  posicao: number;
  criterios: CriterioDeClienteIdeal[];
}

/** Uma linha de `cb_clientes_ideais`. */
export interface ClienteIdeal {
  contact_id: string;
  nivel: NivelDeClienteIdeal;
  perfil_id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Espelho de `cb_resposta_normalizada`: espaço repetido vira um, apara, põe
 * em minúsculas. ("Atraso de 3  à 6 meses" e "atraso de 3 à 6 MESES" são a
 * mesma resposta.)
 */
export function respostaNormalizada(texto: string | null | undefined): string {
  return (texto ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Espelho do CHECK `cb_criterios_de_cliente_ideal_validos`. */
export function criteriosValidos(criterios: unknown): boolean {
  if (!Array.isArray(criterios)) return false;
  if (criterios.length < 1 || criterios.length > TETO_DE_CRITERIOS) return false;
  const campos = new Set<string>();
  for (const criterio of criterios) {
    if (typeof criterio !== 'object' || criterio === null || Array.isArray(criterio)) return false;
    const { campo, respostas } = criterio as { campo?: unknown; respostas?: unknown };
    if (typeof campo !== 'string' || !UUID.test(campo)) return false;
    if (campos.has(campo)) return false;
    campos.add(campo);
    if (!Array.isArray(respostas)) return false;
    if (respostas.length < 1 || respostas.length > TETO_DE_RESPOSTAS) return false;
    for (const resposta of respostas) {
      if (typeof resposta !== 'string' || respostaNormalizada(resposta) === '') return false;
    }
  }
  return true;
}

/** O nome que o CHECK aceita (aparado, não vazio, até o teto). */
export function nomeDoPerfilValido(nome: string): boolean {
  return nome === nome.trim() && nome !== '' && nome.length <= TETO_DO_NOME_DO_PERFIL;
}

/**
 * Lê `criterios` de uma linha do banco. Tolerante: o CHECK garante a forma,
 * mas a tela não quebra se vier lixo — descarta o que não serve.
 */
export function lerCriterios(bruto: unknown): CriterioDeClienteIdeal[] {
  if (!Array.isArray(bruto)) return [];
  const saida: CriterioDeClienteIdeal[] = [];
  for (const item of bruto) {
    if (typeof item !== 'object' || item === null) continue;
    const { campo, respostas } = item as { campo?: unknown; respostas?: unknown };
    if (typeof campo !== 'string') continue;
    saida.push({
      campo,
      respostas: Array.isArray(respostas)
        ? respostas.filter((r): r is string => typeof r === 'string')
        : [],
    });
  }
  return saida;
}

/** A resposta já conta (ela ou outra grafia da mesma resposta)? */
export function respostaMarcada(criterio: CriterioDeClienteIdeal, resposta: string): boolean {
  const alvo = respostaNormalizada(resposta);
  return criterio.respostas.some((r) => respostaNormalizada(r) === alvo);
}

/**
 * Marca ou desmarca uma resposta. Desmarcar tira TODAS as grafias que
 * normalizam igual — senão a caixa continuaria marcada pela outra grafia.
 */
export function alternarResposta(
  criterio: CriterioDeClienteIdeal,
  resposta: string,
): CriterioDeClienteIdeal {
  const alvo = respostaNormalizada(resposta);
  if (respostaMarcada(criterio, resposta)) {
    return { ...criterio, respostas: criterio.respostas.filter((r) => respostaNormalizada(r) !== alvo) };
  }
  return { ...criterio, respostas: [...criterio.respostas, resposta.trim()] };
}

/**
 * As respostas que a tela oferece num critério: as GRAVADAS (com quantas
 * fichas), as opções do campo Lista que ninguém gravou ainda, e as já
 * marcadas que sumiram das fichas (senão não daria para desmarcá-las).
 * As gravadas vêm uma por grafia exata (é o que o operador reconhece); as
 * extras só entram se nenhuma linha já normaliza igual. A ordem é a das
 * gravadas (mais fichas antes), depois as extras.
 */
export function respostasOferecidas(
  gravadas: { resposta: string; fichas: number }[],
  opcoesDoCampo: string[],
  marcadas: string[],
): { resposta: string; fichas: number }[] {
  const saida = [...gravadas];
  const vistas = new Set(gravadas.map((g) => respostaNormalizada(g.resposta)));
  for (const texto of [...opcoesDoCampo, ...marcadas]) {
    const chave = respostaNormalizada(texto);
    if (chave === '' || vistas.has(chave)) continue;
    vistas.add(chave);
    saida.push({ resposta: texto.trim(), fichas: 0 });
  }
  return saida;
}

/** Quantos ideais e possíveis cada perfil marca hoje (pela linha de `cb_clientes_ideais`). */
export function contarPorPerfil(
  linhas: ClienteIdeal[],
): Map<string, { ideais: number; possiveis: number }> {
  const contagem = new Map<string, { ideais: number; possiveis: number }>();
  for (const linha of linhas) {
    const atual = contagem.get(linha.perfil_id) ?? { ideais: 0, possiveis: 0 };
    if (linha.nivel === 'ideal') atual.ideais += 1;
    else atual.possiveis += 1;
    contagem.set(linha.perfil_id, atual);
  }
  return contagem;
}
