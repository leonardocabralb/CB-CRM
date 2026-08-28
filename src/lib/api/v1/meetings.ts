// ============================================================
// Shared serialization for the public API (v1) meeting endpoints
// (migration 945).
// ============================================================

export interface ApiMeeting {
  id: string;
  owner_user_id: string | null;
  owner_nome: string;
  contact_id: string | null;
  contato_nome: string | null;
  /** Read-only via the API — set by the dashboard when it applies. */
  conversation_id: string | null;
  channel_id: string | null;
  titulo: string;
  descricao: string | null;
  local: string | null;
  tipo: 'onboarding' | 'atualizacao' | 'outra';
  starts_at: string;
  ends_at: string;
  status: 'agendada' | 'realizada' | 'cancelada' | 'falta';
  created_by: string | null;
  autor_nome: string;
  created_at: string;
  updated_at: string;
}

export function serializeMeeting(row: Record<string, unknown>): ApiMeeting {
  return {
    id: row.id as string,
    owner_user_id: (row.owner_user_id as string | null) ?? null,
    owner_nome: row.owner_nome as string,
    contact_id: (row.contact_id as string | null) ?? null,
    contato_nome: (row.contato_nome as string | null) ?? null,
    conversation_id: (row.conversation_id as string | null) ?? null,
    channel_id: (row.channel_id as string | null) ?? null,
    titulo: row.titulo as string,
    descricao: (row.descricao as string | null) ?? null,
    local: (row.local as string | null) ?? null,
    tipo: row.tipo as ApiMeeting['tipo'],
    starts_at: row.starts_at as string,
    ends_at: row.ends_at as string,
    status: row.status as ApiMeeting['status'],
    created_by: (row.created_by as string | null) ?? null,
    autor_nome: row.autor_nome as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
