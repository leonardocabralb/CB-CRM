// ============================================================
// Validação do corpo das rotas de perfis — pura, testável, sem I/O.
//
// A rota roda em SERVICE-ROLE e ignora RLS; tudo que entra na tabela passa
// por aqui primeiro. A regra de "o que cada campo aceita" mora num lugar só,
// como `permissoes.ts` das tarefas.
// ============================================================

import { ehSecaoConhecida, ehTelaConhecida, type SecaoId, type TelaId } from "./catalogo";
import type { PapelBase } from "./tipos";

export const NOME_MAX = 60;

export interface CorpoDePerfil {
  nome: string;
  papel_base: PapelBase;
  telas: TelaId[];
  secoes_config: SecaoId[];
  channel_ids: string[];
  pipeline_ids: string[];
}

export type ResultadoDeValidacao =
  | { ok: true; perfil: CorpoDePerfil }
  | { ok: false; erro: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ehPapelBase(v: unknown): v is PapelBase {
  return v === "admin" || v === "agent" || v === "viewer";
}

/**
 * Valida o corpo de criação/edição de perfil.
 *
 * - `nome` obrigatório, aparado, até NOME_MAX chars.
 * - `papel_base` ∈ {admin, agent, viewer} — `owner` nem chega ao CHECK da 956.
 * - `telas`/`secoes_config`: ids fora do catálogo são DESCARTADOS em silêncio,
 *   não erro — o catálogo evolui (tela removida do app deixa lixo no banco), e
 *   um save que reprova por id morto trancaria a edição do perfil inteiro.
 * - `channel_ids`/`pipeline_ids`: cada item precisa ter forma de uuid. Aqui o
 *   id desconhecido REPROVA: diferente de tela, canal não vem de catálogo
 *   fixo, e um id malformado indica corpo montado à mão.
 */
export function validarCorpoDePerfil(body: unknown): ResultadoDeValidacao {
  if (typeof body !== "object" || body === null) {
    return { ok: false, erro: "Corpo inválido" };
  }
  const b = body as Record<string, unknown>;

  const nome = typeof b.nome === "string" ? b.nome.trim() : "";
  if (!nome) return { ok: false, erro: "O nome do perfil é obrigatório" };
  if (nome.length > NOME_MAX) {
    return { ok: false, erro: `O nome passa de ${NOME_MAX} caracteres` };
  }

  if (!ehPapelBase(b.papel_base)) {
    return { ok: false, erro: "papel_base deve ser admin, agent ou viewer" };
  }

  const telas = (Array.isArray(b.telas) ? b.telas : [])
    .filter((t): t is string => typeof t === "string")
    .filter(ehTelaConhecida);
  const secoes = (Array.isArray(b.secoes_config) ? b.secoes_config : [])
    .filter((s): s is string => typeof s === "string")
    .filter(ehSecaoConhecida);

  const canais = Array.isArray(b.channel_ids) ? b.channel_ids : [];
  const funis = Array.isArray(b.pipeline_ids) ? b.pipeline_ids : [];
  for (const lista of [canais, funis]) {
    for (const id of lista) {
      if (typeof id !== "string" || !UUID_RE.test(id)) {
        return { ok: false, erro: "Escopo com id inválido" };
      }
    }
  }

  return {
    ok: true,
    perfil: {
      nome,
      papel_base: b.papel_base,
      telas,
      secoes_config: secoes,
      channel_ids: canais as string[],
      pipeline_ids: funis as string[],
    },
  };
}

/**
 * O save pode rebaixar o PRÓPRIO editor? Trava anti-auto-bloqueio da Fase 5:
 * um admin que edite o próprio perfil para `agent` perderia `manage-members`
 * — e com ele a única tela que desfaz o erro.
 *
 * `perfilDoEditor` é o `perfil_id` de quem está salvando; `owner` nunca é
 * barrado (não tem perfil, e o papel dele não vem de perfil).
 */
export function rebaixariaOEditor(args: {
  papelDoEditor: string | null;
  perfilDoEditor: string | null;
  perfilAlvo: string;
  novoPapel: PapelBase;
}): boolean {
  if (args.papelDoEditor === "owner") return false;
  if (args.perfilDoEditor !== args.perfilAlvo) return false;
  return args.novoPapel !== "admin";
}
