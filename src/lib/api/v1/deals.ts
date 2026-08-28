// ============================================================
// Shared serialization for the public API (v1) pipeline/deal
// endpoints (migrations 908/910).
// ============================================================

export interface ApiPipelineStage {
  id: string;
  name: string;
  position: number;
  color: string;
}

export interface ApiPipeline {
  id: string;
  name: string;
  stages: ApiPipelineStage[];
  created_at: string;
}

export interface ApiDeal {
  id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string | null;
  /** Conversation the deal was born from (null for hand/API-created). */
  conversation_id: string | null;
  /** The number the customer ARRIVED through — historical, never moves. */
  channel_id: string | null;
  title: string;
  value: number;
  currency: string | null;
  status: 'open' | 'won' | 'lost';
  source: 'manual' | 'automation' | 'channel' | null;
  expected_close_date: string | null;
  created_at: string;
  updated_at: string | null;
}

export function serializePipeline(row: Record<string, unknown>): ApiPipeline {
  const stages = ((row.pipeline_stages as Record<string, unknown>[]) ?? [])
    .map((s) => ({
      id: s.id as string,
      name: s.name as string,
      position: s.position as number,
      color: s.color as string,
    }))
    .sort((a, b) => a.position - b.position);
  return {
    id: row.id as string,
    name: row.name as string,
    stages,
    created_at: row.created_at as string,
  };
}

export function serializeDeal(row: Record<string, unknown>): ApiDeal {
  return {
    id: row.id as string,
    pipeline_id: row.pipeline_id as string,
    stage_id: row.stage_id as string,
    contact_id: (row.contact_id as string | null) ?? null,
    conversation_id: (row.conversation_id as string | null) ?? null,
    channel_id: (row.channel_id as string | null) ?? null,
    title: row.title as string,
    value: Number(row.value ?? 0),
    currency: (row.currency as string | null) ?? null,
    status: (row.status as ApiDeal['status']) ?? 'open',
    source: (row.source as ApiDeal['source']) ?? null,
    expected_close_date: (row.expected_close_date as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: (row.updated_at as string | null) ?? null,
  };
}
