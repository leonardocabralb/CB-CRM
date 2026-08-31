"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  CircleCheck,
  CircleAlert,
  Clock,
  UserPlus,
  PlayCircle,
  PauseCircle,
  OctagonX,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ChannelCell } from "@/components/channels/channel-badge";
import { useChannels } from "@/hooks/use-channels";
import type { CbChannel } from "@/lib/cb-channels/repo";

/**
 * Run history viewer.
 *
 * Lists the 50 most recent runs for a flow, newest first. Each row
 * collapses to a one-liner (contact + status + time); expanding shows
 * the full `flow_run_events` timeline for that run — useful for
 * debugging "why didn't my flow advance?" by surfacing the engine's
 * own log.
 */

interface RunRow {
  id: string;
  status:
    | "active"
    | "completed"
    | "handed_off"
    | "timed_out"
    | "paused_by_agent"
    // Uma AUTOMAÇÃO mandou parar (936) — distinto de `paused_by_agent`, que
    // quer dizer que uma pessoa entrou na conversa. O motivo fino
    // (`stopped_by_automation` vs `replaced_by_automation`) fica no
    // `end_reason`, logo abaixo na linha.
    | "stopped_by_automation"
    // Uma PESSOA decidiu parar, pelo botão da aba Automações da conversa
    // (955) — distinto de `paused_by_agent`, que é a pessoa apenas ter
    // respondido, e de `stopped_by_automation`, que é regra.
    | "stopped_by_agent"
    | "failed";
  current_node_key: string | null;
  started_at: string;
  last_advanced_at: string;
  ended_at: string | null;
  end_reason: string | null;
  vars: Record<string, unknown>;
  reprompt_count: number;
  /**
   * Canal TRAVADO na entrada do run — por onde o cliente entrou. `null`
   * nos runs anteriores à 903.
   */
  channel_id: string | null;
  contact: { id: string; name: string | null; phone: string } | null;
}

interface EventRow {
  flow_run_id: string;
  event_type: string;
  node_key: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

/**
 * Aparência e rótulo de cada status.
 *
 * ⚠️ O `status` vem de um CAST da resposta da API, não de um tipo checado:
 * um valor que o CHECK do banco aceite e esta tabela não conheça derruba a
 * página inteira. Já aconteceu — a 955 acrescentou `stopped_by_agent` e o
 * histórico estourava `TypeError` ao abrir. Daí o `META_DESCONHECIDO` do
 * consumidor: status novo aparece cru, mas a tela ABRE.
 */
const STATUS_META: Record<
  RunRow["status"],
  { chave: string; classes: string; icon: typeof Clock }
> = {
  active: {
    chave: "statusActive",
    classes: "border-emerald-600/40 bg-emerald-500/10 text-emerald-300",
    icon: PlayCircle,
  },
  completed: {
    chave: "statusCompleted",
    classes: "border-border bg-muted text-muted-foreground",
    icon: CircleCheck,
  },
  handed_off: {
    chave: "statusHandedOff",
    classes: "border-amber-600/40 bg-amber-500/10 text-amber-300",
    icon: UserPlus,
  },
  timed_out: {
    chave: "statusTimedOut",
    classes: "border-border bg-muted/60 text-muted-foreground",
    icon: Clock,
  },
  paused_by_agent: {
    chave: "statusPaused",
    classes: "border-border bg-muted text-muted-foreground",
    icon: PauseCircle,
  },
  stopped_by_automation: {
    chave: "statusStoppedByAutomation",
    classes: "border-violet-600/40 bg-violet-500/10 text-violet-300",
    icon: OctagonX,
  },
  stopped_by_agent: {
    chave: "statusStoppedByAgent",
    classes: "border-sky-600/40 bg-sky-500/10 text-sky-300",
    icon: OctagonX,
  },
  failed: {
    chave: "statusFailed",
    classes: "border-red-600/40 bg-red-500/10 text-red-300",
    icon: CircleAlert,
  },
};

const META_DESCONHECIDO = {
  chave: null,
  classes: "border-border bg-muted text-muted-foreground",
  icon: Clock,
};

export default function FlowRunsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const t = useTranslations("Flows.logs");
  const tEdit = useTranslations("Flows.edit");

  const [flow, setFlow] = useState<{ id: string; name: string } | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [notFound, setNotFound] = useState(false);
  const { channels } = useChannels();

  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/flows/${params.id}/runs`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const json = (await res.json()) as {
          flow: { id: string; name: string };
          runs: RunRow[];
          events: EventRow[];
        };
        if (!cancelled) {
          setFlow(json.flow);
          setRuns(json.runs ?? []);
          setEvents(json.events ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error(t("loadError"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  function toggle(runId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (notFound || !flow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">{tEdit("notFound")}</p>
        <button
          type="button"
          onClick={() => router.push("/flows")}
          className="text-sm text-primary hover:opacity-80"
        >
          {tEdit("backToFlows")}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <button
        type="button"
        onClick={() => router.push(`/flows/${flow.id}`)}
        className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        {flow.name}
      </button>
      <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("description")}
      </p>

      {runs.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-border bg-card/50 px-6 py-12 text-center text-sm text-muted-foreground">
          {t("emptyState")}
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-2">
          {runs.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              channels={channels}
              events={events.filter((e) => e.flow_run_id === run.id)}
              expanded={expanded.has(run.id)}
              onToggle={() => toggle(run.id)}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RunCard({
  run,
  channels,
  events,
  expanded,
  onToggle,
  t,
}: {
  run: RunRow;
  channels: CbChannel[];
  events: EventRow[];
  expanded: boolean;
  onToggle: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const meta = STATUS_META[run.status] ?? META_DESCONHECIDO;
  const StatusIcon = meta.icon;
  const contactLabel =
    run.contact?.name?.trim() || run.contact?.phone || t("unknownContact");
  const duration = run.ended_at
    ? formatDistanceToNow(new Date(run.ended_at), {
        addSuffix: false,
      })
    : null;
  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {contactLabel}
            </span>
            <Badge variant="outline" className={cn("gap-1", meta.classes)}>
              <StatusIcon className="h-3 w-3" />
              {meta.chave ? t(meta.chave) : run.status}
            </Badge>
            {run.status === "active" && run.current_node_key && (
              <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {t("atNode", { node: run.current_node_key })}
              </code>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>{t("started", { time: format(new Date(run.started_at), "PP p") })}</span>
            {run.reprompt_count > 0 && (
              <span>· {t("reprompts", { count: run.reprompt_count })}</span>
            )}
            {duration && <span>· {t("ranFor", { duration })}</span>}
            {/* Por onde o cliente entrou. Sem isto, dois runs do mesmo flow
                em números diferentes ficavam indistinguíveis no histórico. */}
            <ChannelCell channels={channels} channelId={run.channel_id} />
          </div>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border px-4 py-3">
          {Object.keys(run.vars).length > 0 && (
            <details className="mb-3">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {t("capturedVars", { count: Object.keys(run.vars).length })}
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-md bg-background p-2 text-[11px] text-muted-foreground">
                {JSON.stringify(run.vars, null, 2)}
              </pre>
            </details>
          )}
          <div className="flex flex-col gap-1">
            {events.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("noEvents")}
              </p>
            ) : (
              events.map((ev, ix) => <EventLine key={ix} ev={ev} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const EVENT_COLOR: Record<string, string> = {
  started: "text-emerald-300",
  node_entered: "text-muted-foreground",
  message_sent: "text-sky-300",
  reply_received: "text-primary",
  fallback_fired: "text-amber-300",
  handoff: "text-amber-300",
  timeout: "text-muted-foreground",
  error: "text-red-300",
  completed: "text-emerald-300",
};

function EventLine({ ev }: { ev: EventRow }) {
  const cls = EVENT_COLOR[ev.event_type] ?? "text-muted-foreground";
  return (
    <div className="flex items-start gap-2 rounded-md px-2 py-1 text-xs">
      <span className="w-32 shrink-0 text-[10px] text-muted-foreground">
        {format(new Date(ev.created_at), "HH:mm:ss")}
      </span>
      <span className={cn("w-32 shrink-0 font-mono text-[10px]", cls)}>
        {ev.event_type}
      </span>
      {ev.node_key && (
        <code className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
          {ev.node_key}
        </code>
      )}
      {Object.keys(ev.payload).length > 0 && (
        <span className="min-w-0 truncate text-[10px] text-muted-foreground">
          {summarizePayload(ev.payload)}
        </span>
      )}
    </div>
  );
}

function summarizePayload(payload: Record<string, unknown>): string {
  // Show the keys that matter most to a human debugger; full JSON is
  // available via the "Captured vars" details panel for the run.
  const keys = ["reply_id", "captured_key", "reason", "advancing_to"];
  for (const k of keys) {
    if (k in payload && payload[k] !== null && payload[k] !== undefined) {
      return `${k}=${String(payload[k]).slice(0, 80)}`;
    }
  }
  return "";
}
