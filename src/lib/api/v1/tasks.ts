// ============================================================
// Shared task serialization for the public API (v1) task endpoints.
//
// Kept out of the route files so `GET/POST /api/v1/tasks` and
// `GET /api/v1/tasks/{id}` return the exact same shape.
// ============================================================

export interface ApiTask {
  id: string;
  contact_id: string;
  criador_user_id: string | null;
  criador_nome: string | null;
  responsavel_user_id: string | null;
  responsavel_nome: string | null;
  titulo: string;
  descricao: string | null;
  /** `YYYY-MM-DD` — a plain calendar date, no timezone. */
  vence_em: string;
  /** `HH:MM:SS` or null (all-day task). */
  vence_as: string | null;
  status: 'aberta' | 'concluida';
  concluida_em: string | null;
  importante: boolean;
  tipo: 'tarefa' | 'resposta';
  tarefa_pai_id: string | null;
  tarefa_pai_titulo: string | null;
  created_at: string;
  updated_at: string;
}

export function serializeTask(row: Record<string, unknown>): ApiTask {
  return {
    id: row.id as string,
    contact_id: row.contact_id as string,
    criador_user_id: (row.criador_user_id as string | null) ?? null,
    criador_nome: (row.criador_nome as string | null) ?? null,
    responsavel_user_id: (row.responsavel_user_id as string | null) ?? null,
    responsavel_nome: (row.responsavel_nome as string | null) ?? null,
    titulo: row.titulo as string,
    descricao: (row.descricao as string | null) ?? null,
    vence_em: row.vence_em as string,
    vence_as: (row.vence_as as string | null) ?? null,
    status: row.status as ApiTask['status'],
    concluida_em: (row.concluida_em as string | null) ?? null,
    importante: row.importante === true,
    tipo: row.tipo as ApiTask['tipo'],
    tarefa_pai_id: (row.tarefa_pai_id as string | null) ?? null,
    tarefa_pai_titulo: (row.tarefa_pai_titulo as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
