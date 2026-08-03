"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  ArrowLeft,
  ChevronDown,
  Plus,
  Trash2,
  GripVertical,
  MessageSquare,
  FileText,
  Tag,
  TagIcon,
  UserCheck,
  PencilLine,
  Briefcase,
  Hourglass,
  GitBranch,
  Webhook,
  CircleSlash,
  Zap,
  Loader2,
  ArrowDown,
  ArrowUp,
  MousePointerClick,
  List,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type {
  AccountMember,
  AutomationStepType,
  AutomationTriggerType,
  CustomField,
  InteractiveMessagePayload,
  KeywordMatchTriggerConfig,
  MessageTemplate,
  Tag as TagRecord,
} from "@/types"
import {
  InteractiveBuilder,
  blankButtonsPayload,
  blankListPayload,
} from "@/components/interactive/interactive-builder"
import { interactivePayloadPreviewText } from "@/lib/whatsapp/interactive"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { useChannels } from "@/hooks/use-channels"
import type { CbChannel } from "@/lib/cb-channels/repo"
import { ChannelMultiSelect, ChannelSelect } from "@/components/channels/channel-select"
import { validateChannelScopeForActivation } from "@/lib/automations/validate"

// ------------------------------------------------------------
// Types (builder-local — mirror the flattened rows we POST)
// ------------------------------------------------------------

export interface BuilderStep {
  /** Client id; the API assigns real UUIDs server-side. */
  cid: string
  step_type: AutomationStepType
  step_config: Record<string, unknown>
  branches?: { yes: BuilderStep[]; no: BuilderStep[] }
}

export interface BuilderInitial {
  id?: string
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: Record<string, unknown>
  /**
   * Canais em que esta automação pode disparar. **Array vazio = TODOS** —
   * é a mesma leitura de `channelInScope` no motor, e o save converte para
   * `null` antes de enviar. Guardar `[]` em vez de `null` aqui deixa o
   * estado do formulário com um tipo só, sem `undefined` a cada patch.
   */
  channel_ids: string[]
  /**
   * Etapas em que a automação vale (933). Mesma convenção do canal: `[]` na
   * tela = "todas", e o save converte para `null`.
   */
  stage_ids: string[]
  is_active: boolean
  steps: BuilderStep[]
}

// ------------------------------------------------------------
// Step metadata — one source of truth for icon + label + border color
// ------------------------------------------------------------

interface StepMeta {
  label: string
  icon: typeof Zap
  /** Left-border accent color per spec. */
  border: string
}

const STEP_META: Record<AutomationStepType, StepMeta> = {
  send_message: { label: "send_message", icon: MessageSquare, border: "border-l-primary" },
  send_buttons: { label: "send_buttons", icon: MousePointerClick, border: "border-l-primary" },
  send_list: { label: "send_list", icon: List, border: "border-l-primary" },
  send_template: { label: "send_template", icon: FileText, border: "border-l-primary" },
  add_tag: { label: "add_tag", icon: Tag, border: "border-l-primary" },
  remove_tag: { label: "remove_tag", icon: TagIcon, border: "border-l-primary" },
  assign_conversation: { label: "assign_conversation", icon: UserCheck, border: "border-l-primary" },
  update_contact_field: { label: "update_contact_field", icon: PencilLine, border: "border-l-primary" },
  create_deal: { label: "create_deal", icon: Briefcase, border: "border-l-primary" },
  wait: { label: "wait", icon: Hourglass, border: "border-l-border" },
  condition: { label: "condition", icon: GitBranch, border: "border-l-amber-500" },
  send_webhook: { label: "send_webhook", icon: Webhook, border: "border-l-primary" },
  close_conversation: { label: "close_conversation", icon: CircleSlash, border: "border-l-primary" },
}

const ADDABLE_STEPS: AutomationStepType[] = [
  "send_message",
  "send_buttons",
  "send_list",
  "send_template",
  "add_tag",
  "remove_tag",
  "assign_conversation",
  "update_contact_field",
  "create_deal",
  "wait",
  "condition",
  "send_webhook",
  "close_conversation",
]

/**
 * Gatilhos OFERECIDOS na tela.
 *
 * ⚠️ Não é a lista de `AutomationTriggerType` — é a lista do que DISPARA.
 * Dois tipos existem no banco e no seletor desde o upstream sem nunca terem
 * sido despachados por lugar nenhum:
 *
 * - `time_based`: nada além do cron o leria, e o cron só drena esperas
 *   parqueadas. Além disso ele não tem alvo — o motor roda por contato e
 *   "todo dia às 9h" não diz para qual. Substituído pelo gatilho relativo a
 *   data de campo personalizado (lembrete de reunião), que dispara POR
 *   contato — ver `docs/PLANO-automacoes-multicanal-e-funil.md` §4.6.
 * - `conversation_assigned`: volta junto com a caixa de saída da Fase 2, que é
 *   o que consegue observar os 6 escritores de `assigned_agent_id` (um deles no
 *   navegador).
 *
 * Os dois seguem no union de tipos: automação antiga gravada com eles continua
 * carregando e salvando. Só não se oferece o que não acontece — opção que não
 * dispara é pior que opção ausente, porque o operador monta a regra, ativa, e
 * espera.
 */
const TRIGGER_OPTIONS: { value: AutomationTriggerType }[] = [
  { value: "new_message_received" },
  { value: "first_inbound_message" },
  { value: "keyword_match" },
  { value: "interactive_reply" },
  { value: "new_contact_created" },
  { value: "tag_added" },
]

function cid(): string {
  return (
    "c_" +
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  )
}

// The send_buttons / send_list step_config IS an InteractiveMessagePayload,
// but step_config is typed generically as Record<string, unknown>. These two
// helpers hold the single unavoidable structural cast in one place so a
// payload-shape change has one seam to update instead of four scattered
// `as unknown as` sites.
function toStepConfig(p: InteractiveMessagePayload): Record<string, unknown> {
  return p as unknown as Record<string, unknown>
}
function asInteractive(cfg: Record<string, unknown>): InteractiveMessagePayload {
  return cfg as unknown as InteractiveMessagePayload
}

function blankConfig(type: AutomationStepType): Record<string, unknown> {
  switch (type) {
    case "send_message":
      return { text: "" }
    case "send_buttons":
      return toStepConfig(blankButtonsPayload())
    case "send_list":
      return toStepConfig(blankListPayload())
    case "send_template":
      return { template_name: "", language: "en_US" }
    case "add_tag":
    case "remove_tag":
      return { tag_id: "" }
    case "assign_conversation":
      return { mode: "round_robin" }
    case "update_contact_field":
      return { field: "name", value: "" }
    case "create_deal":
      return { pipeline_id: "", stage_id: "", title: "", value: 0 }
    case "wait":
      return { amount: 1, unit: "hours" }
    case "condition":
      return { subject: "tag_presence", operand: "", value: "" }
    case "send_webhook":
      return { url: "", headers: {}, body_template: "" }
    case "close_conversation":
      return {}
    default:
      return {}
  }
}

// ------------------------------------------------------------
// Account resources (tags, members, approved templates, pipelines)
//
// Loaded once at the builder root and shared via context so the
// tag / agent / template pickers below can offer existing resources
// by name instead of asking the user to paste raw UUIDs. Every picker
// falls back to a raw input when its list is empty (fresh account or
// an older deployment), so an automation is always authorable.
// ------------------------------------------------------------

interface AutomationResources {
  tags: TagRecord[]
  members: AccountMember[]
  templates: MessageTemplate[]
  customFields: CustomField[]
  pipelines: PipelineOption[]
  stages: PipelineStageOption[]
  /** Canais da conta — para a condição por canal do passo Condição. */
  channels: CbChannel[]
}

interface PipelineOption {
  id: string
  name: string
}

interface PipelineStageOption {
  id: string
  name: string
  pipeline_id: string
  position: number
}

const ResourcesContext = createContext<AutomationResources>({
  tags: [],
  members: [],
  templates: [],
  customFields: [],
  pipelines: [],
  stages: [],
  channels: [],
})

function useResources(): AutomationResources {
  return useContext(ResourcesContext)
}

function ResourcesProvider({ children }: { children: ReactNode }) {
  const [tags, setTags] = useState<TagRecord[]>([])
  const [members, setMembers] = useState<AccountMember[]>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [customFields, setCustomFields] = useState<CustomField[]>([])
  const [pipelines, setPipelines] = useState<PipelineOption[]>([])
  const [stages, setStages] = useState<PipelineStageOption[]>([])
  // No provider, e não dentro do StepEditor: aquele monta uma vez por passo
  // aberto, e cada montagem seria um GET novo.
  const { channels } = useChannels()

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    // Tags, templates and custom fields come straight from the DB — RLS
    // scopes them to the caller's account. Only APPROVED templates can
    // actually be sent (anything else 400s at send time), matching the
    // broadcast picker.
    void (async () => {
      const [tagsRes, templatesRes, customFieldsRes, pipelinesRes, stagesRes] =
        await Promise.all([
          supabase.from("tags").select("*").order("name"),
          supabase
            .from("message_templates")
            .select("*")
            .eq("status", "APPROVED")
            .order("name"),
          supabase.from("custom_fields").select("*").order("field_name"),
          supabase.from("pipelines").select("id, name").order("name"),
          supabase
            .from("pipeline_stages")
            .select("id, name, pipeline_id, position")
            .order("position"),
        ])
      if (cancelled) return
      setTags((tagsRes.data as TagRecord[] | null) ?? [])
      setTemplates((templatesRes.data as MessageTemplate[] | null) ?? [])
      setCustomFields((customFieldsRes.data as CustomField[] | null) ?? [])
      setPipelines((pipelinesRes.data as PipelineOption[] | null) ?? [])
      setStages((stagesRes.data as PipelineStageOption[] | null) ?? [])
    })()

    // Members go through the API so we inherit its email-visibility
    // rules (agents/viewers don't see emails). Unreachable on older
    // deployments → pickers fall back to a raw agent-id input.
    void (async () => {
      try {
        const res = await fetch("/api/account/members", { cache: "no-store" })
        if (!res.ok) return
        const json = (await res.json()) as { members?: AccountMember[] }
        if (!cancelled) setMembers(json.members ?? [])
      } catch {
        // Members endpoint absent — caller falls back to raw input.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <ResourcesContext.Provider
      value={{ tags, members, templates, customFields, pipelines, stages, channels }}
    >
      {children}
    </ResourcesContext.Provider>
  )
}

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"

/** Tag dropdown by name + color, storing the tag's id. Falls back to a
 *  raw id input when no tags exist yet. */
function TagSelect({
  value,
  onChange,
  t,
}: {
  value: string
  onChange: (v: string) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { tags } = useResources()
  if (tags.length === 0) {
    return (
      <Input
        placeholder={t("tags.placeholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted text-foreground"
      />
    )
  }
  const selected = tags.find((t) => t.id === value)
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-3 w-3 shrink-0 rounded-full border border-border"
        style={{ backgroundColor: selected?.color ?? "transparent" }}
        aria-hidden
      />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT_CLASS}
      >
        <option value="">{t("tags.select")}</option>
        {tags.map((tg) => (
          <option key={tg.id} value={tg.id}>
            {tg.name}
          </option>
        ))}
        {/* Preserve a saved tag that's since been deleted so editing an
            existing automation doesn't silently drop it. */}
        {value && !selected && (
          <option value={value}>{t("tags.unknown", { id: value })}</option>
        )}
      </select>
    </div>
  )
}

/** Contact-field dropdown for "Update Contact Field": built-in columns plus
 *  any account custom fields (stored as `custom:<id>`). A saved custom field
 *  that's since been deleted is preserved as a labelled option so editing an
 *  existing automation doesn't silently drop it. */
function ContactFieldSelect({
  value,
  onChange,
  t,
}: {
  value: string
  onChange: (v: string) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { customFields } = useResources()
  const customValue = value.startsWith("custom:") ? value : ""
  const knownCustom =
    customValue && customFields.some((f) => `custom:${f.id}` === customValue)
  return (
    <select
      value={value || "name"}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT_CLASS}
    >
      <option value="name">{t("fields.name")}</option>
      <option value="email">{t("fields.email")}</option>
      <option value="company">{t("fields.company")}</option>
      {customFields.length > 0 && (
        <optgroup label={t("fields.customFields")}>
          {customFields.map((f) => (
            <option key={f.id} value={`custom:${f.id}`}>
              {f.field_name}
            </option>
          ))}
        </optgroup>
      )}
      {customValue && !knownCustom && (
        <option value={customValue}>{t("fields.unknown", { id: customValue })}</option>
      )}
    </select>
  )
}

/** Agent dropdown by name, storing the member's user_id. Falls back to
 *  a raw id input when the member list is unavailable. */
function AgentSelect({
  value,
  onChange,
  t,
}: {
  value: string
  onChange: (v: string) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { members } = useResources()
  if (members.length === 0) {
    return (
      <Input
        placeholder={t("agents.placeholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted text-foreground"
      />
    )
  }
  const selected = members.find((m) => m.user_id === value)
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT_CLASS}
    >
      <option value="">{t("agents.select")}</option>
      {members.map((m) => (
        <option key={m.user_id} value={m.user_id}>
          {m.full_name || m.email || m.user_id}
        </option>
      ))}
      {value && !selected && (
        <option value={value}>{t("agents.unknown", { id: value })}</option>
      )}
    </select>
  )
}

/** Pipeline + stage picker for Create Deal. The automation stores ids because
 *  the engine writes directly to deals, but authors should choose by name. */
function DealPipelineFields({
  pipelineId,
  stageId,
  onChange,
  t,
}: {
  pipelineId: string
  stageId: string
  onChange: (patch: { pipeline_id: string; stage_id: string }) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { pipelines, stages } = useResources()

  if (pipelines.length === 0) {
    return (
      <>
        <FieldBlock label={t("pipelines.pipelineIdLabel")}>
          <Input
            value={pipelineId}
            onChange={(e) =>
              onChange({ pipeline_id: e.target.value, stage_id: stageId })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
        <FieldBlock label={t("pipelines.stageIdLabel")}>
          <Input
            value={stageId}
            onChange={(e) =>
              onChange({ pipeline_id: pipelineId, stage_id: e.target.value })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      </>
    )
  }

  const selectedPipeline = pipelines.find((p) => p.id === pipelineId)
  const stageOptions = stages.filter((s) => s.pipeline_id === pipelineId)
  const selectedStage = stageOptions.find((s) => s.id === stageId)

  return (
    <>
      <FieldBlock label={t("pipelines.pipelineLabel")}>
        <select
          value={pipelineId}
          onChange={(e) => {
            const nextPipelineId = e.target.value
            const firstStage = stages.find(
              (s) => s.pipeline_id === nextPipelineId
            )
            onChange({
              pipeline_id: nextPipelineId,
              stage_id: firstStage?.id ?? "",
            })
          }}
          className={SELECT_CLASS}
        >
          <option value="">{t("pipelines.selectPipeline")}</option>
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {pipelineId && !selectedPipeline && (
            <option value={pipelineId}>{t("pipelines.unknownPipeline", { id: pipelineId })}</option>
          )}
        </select>
      </FieldBlock>
      <FieldBlock label={t("pipelines.stageLabel")}>
        <select
          value={stageId}
          onChange={(e) =>
            onChange({ pipeline_id: pipelineId, stage_id: e.target.value })
          }
          className={SELECT_CLASS}
          disabled={!pipelineId || stageOptions.length === 0}
        >
          <option value="">
            {pipelineId ? t("pipelines.selectStage") : t("pipelines.selectPipelineFirst")}
          </option>
          {stageOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          {stageId && pipelineId && !selectedStage && (
            <option value={stageId}>{t("pipelines.unknownStage", { id: stageId })}</option>
          )}
        </select>
      </FieldBlock>
    </>
  )
}

/** Template dropdown showing approved templates by name + language,
 *  storing both template_name and language. Falls back to manual name +
 *  language inputs when no approved templates are synced yet. */
function SendTemplateFields({
  templateName,
  language,
  onChange,
  t,
}: {
  templateName: string
  language: string
  onChange: (patch: { template_name: string; language: string }) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { templates } = useResources()

  if (templates.length === 0) {
    return (
      <>
        <FieldBlock label={t("templates.templateNameLabel")}>
          <Input
            value={templateName}
            onChange={(e) =>
              onChange({ template_name: e.target.value, language })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
        <FieldBlock label={t("templates.languageLabel")}>
          <Input
            value={language}
            onChange={(e) =>
              onChange({ template_name: templateName, language: e.target.value })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      </>
    )
  }

  // Encode name + language in the option value so two templates that
  // share a name across languages stay distinct.
  const toValue = (name: string, lang: string) => `${name}::${lang}`
  const current = templateName ? toValue(templateName, language) : ""
  const hasMatch = templates.some(
    (t) => toValue(t.name, t.language ?? "en_US") === current,
  )

  return (
    <FieldBlock label={t("templates.templateLabel")}>
      <select
        value={current}
        onChange={(e) => {
          const [name, lang] = e.target.value.split("::")
          onChange({ template_name: name ?? "", language: lang ?? "" })
        }}
        className={SELECT_CLASS}
      >
        <option value="">{t("templates.select")}</option>
        {templates.map((tmpl) => {
          const lang = tmpl.language ?? "en_US"
          return (
            <option key={tmpl.id} value={toValue(tmpl.name, lang)}>
              {tmpl.name} ({lang})
            </option>
          )
        })}
        {current && !hasMatch && (
          <option value={current}>
            {t("templates.unknown", { name: templateName, lang: language || t("templates.unknownLang") })}
          </option>
        )}
      </select>
    </FieldBlock>
  )
}

// ------------------------------------------------------------
// Main builder component
// ------------------------------------------------------------

export function AutomationBuilder({ initial }: { initial: BuilderInitial }) {
  const router = useRouter()
  const t = useTranslations("Automations.builder")
  const isEditing = !!initial.id
  const [state, setState] = useState<BuilderInitial>(initial)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  function patchTop<K extends keyof BuilderInitial>(key: K, value: BuilderInitial[K]) {
    setState((s) => ({ ...s, [key]: value }))
  }

  // --- Step tree mutations (immutable) ---

  function updateStep(path: StepPath, updater: (s: BuilderStep) => BuilderStep) {
    setState((s) => ({ ...s, steps: mapAtPath(s.steps, path, updater) }))
  }

  function addStepAt(parent: ParentScope, index: number, type: AutomationStepType) {
    const node: BuilderStep = {
      cid: cid(),
      step_type: type,
      step_config: blankConfig(type),
      branches: type === "condition" ? { yes: [], no: [] } : undefined,
    }
    setState((s) => ({ ...s, steps: insertAt(s.steps, parent, index, node) }))
    setExpandedId(node.cid)
  }

  function deleteStepAt(path: StepPath) {
    setState((s) => ({ ...s, steps: removeAt(s.steps, path) }))
  }

  function moveStepAt(path: StepPath, direction: -1 | 1) {
    setState((s) => ({ ...s, steps: moveAt(s.steps, path, direction) }))
  }

  async function save() {
    setSaving(true)
    try {
      const payload = {
        name: state.name || "Untitled automation",
        description: state.description || null,
        trigger_type: state.trigger_type,
        trigger_config: state.trigger_config,
        // Vazio vira `null` — "sem restrição". A rota também normaliza,
        // mas mandar `[]` seria pedir para a 903 desativar a automação
        // (o trigger trata array vazio como escopo órfão).
        channel_ids: state.channel_ids.length > 0 ? state.channel_ids : null,
        // Mesma regra: vazio vira `null` ("todas as etapas"). Mandar `[]`
        // seria pedir para o trigger da 933 tratar como escopo órfão.
        stage_ids: state.stage_ids.length > 0 ? state.stage_ids : null,
        is_active: state.is_active,
        steps: toApiSteps(state.steps),
      }

      const res = isEditing
        ? await fetch(`/api/automations/${initial.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/automations`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })

      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // If the server blocked activation with validation issues,
        // surface the first concrete problem so the user can fix it
        // without opening DevTools for the full array.
        const firstIssue: { path?: string; message?: string } | undefined =
          body?.issues?.[0]
        if (firstIssue?.message) {
          toast.error(firstIssue.message, {
            description: firstIssue.path ? `at ${firstIssue.path}` : undefined,
          })
        } else {
          toast.error(body?.error ?? t("toasts.saveFailed"))
        }
        return
      }
      toast.success(isEditing ? t("toasts.saved") : t("toasts.created"))
      if (!isEditing && body?.automation?.id) {
        router.replace(`/automations/${body.automation.id}/edit`)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* Top bar. At sub-sm widths the "Active" label is hidden and the
          switch moves to the right of the save button, so the name input
          gets maximum width. */}
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-card/80 px-3 py-3 sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={() => router.push("/automations")}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t("backToAutomations")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <input
          value={state.name}
          onChange={(e) => patchTop("name", e.target.value)}
          placeholder={t("untitled")}
          className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:bg-muted focus:outline-none sm:text-base"
        />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden sm:inline">{t("active")}</span>
          <Switch
            checked={state.is_active}
            onCheckedChange={(v) => patchTop("is_active", !!v)}
            aria-label={t("activeAria")}
          />
        </div>
        <Button
          onClick={save}
          disabled={saving}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isEditing ? t("save") : t("saveDraft")}
        </Button>
      </header>

      {/* Canvas */}
      <div className="relative flex-1 overflow-y-auto">
        <div className="absolute inset-0 bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:20px_20px] pointer-events-none" />
        <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-0 px-4 py-10">
          <ResourcesProvider>
            <AvisosDeCanal steps={state.steps} channelIds={state.channel_ids} />
            <TriggerCard
              type={state.trigger_type}
              config={state.trigger_config}
              channelIds={state.channel_ids}
              stageIds={state.stage_ids}
              onTypeChange={(tVal) => patchTop("trigger_type", tVal)}
              onConfigChange={(c) => patchTop("trigger_config", c)}
              onChannelIdsChange={(ids) => patchTop("channel_ids", ids)}
              onStageIdsChange={(ids) => patchTop("stage_ids", ids)}
              t={t}
            />
            <StepList
              steps={state.steps}
              parentPath={[]}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              updateStep={updateStep}
              addStepAt={addStepAt}
              deleteStepAt={deleteStepAt}
              moveStepAt={moveStepAt}
            />
          </ResourcesProvider>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Trigger card
// ------------------------------------------------------------

function TriggerCard({
  type,
  config,
  channelIds,
  stageIds,
  onTypeChange,
  onConfigChange,
  onChannelIdsChange,
  onStageIdsChange,
  t,
}: {
  type: AutomationTriggerType
  config: Record<string, unknown>
  channelIds: string[]
  stageIds: string[]
  onTypeChange: (t: AutomationTriggerType) => void
  onConfigChange: (c: Record<string, unknown>) => void
  onChannelIdsChange: (ids: string[]) => void
  onStageIdsChange: (ids: string[]) => void
  t: ReturnType<typeof useTranslations>
}) {
  const [open, setOpen] = useState(false)
  const tCanais = useTranslations("Channels")
  // Do contexto, NÃO um `useChannels()` próprio. `useChannels` não tem cache
  // nem dedup: cada chamada é um GET /api/cb/channels por montagem, e este
  // card monta junto com o provider que já busca a mesma lista. Mesmo motivo
  // que levou os fluxos a buscarem uma vez só no editor.
  const { channels } = useResources()
  // Um gatilho aposentado (§TRIGGER_OPTIONS) some da lista, mas se a automação
  // JÁ estiver gravada com ele a opção volta — só para esta automação. Sem
  // isto o `<select>` fica sem opção casando com `value` e o navegador mostra a
  // primeira da lista: a tela diria "Nova mensagem recebida" sobre uma regra
  // gravada como agendamento, e o primeiro save gravaria essa mentira.
  const opcoesDeGatilho = useMemo(
    () =>
      TRIGGER_OPTIONS.some((o) => o.value === type)
        ? TRIGGER_OPTIONS
        : [...TRIGGER_OPTIONS, { value: type }],
    [type],
  )
  return (
    // Card width: full on mobile, fixed 320px on sm+. The canvas wrapper
    // (max-w-2xl + px-4) keeps this tidy on tablet/desktop.
    <div className="z-10 w-full max-w-[320px] sm:w-80">
      <div className="rounded-lg border border-border border-l-4 border-l-blue-500 bg-card shadow-lg">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10 text-blue-400">
            <Zap className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wide text-blue-300">{t("trigger")}</div>
            <div className="truncate text-sm font-medium text-foreground">
              {t(`triggers.${type}.label`)}
            </div>
          </div>
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </button>
        {open && (
          <div className="space-y-3 border-t border-border px-4 py-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("triggerType")}
              </label>
              <select
                value={type}
                onChange={(e) => onTypeChange(e.target.value as AutomationTriggerType)}
                className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                {opcoesDeGatilho.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(`triggers.${o.value}.label`)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t(`triggers.${type}.hint`)}
              </p>
            </div>
            {/* Escopo de canal. Só aparece com 2+ números: numa conta de um
                número o seletor não decide nada. Sem ele, `channel_ids` só
                era gravável pela API — o motor sabia filtrar por canal e a
                tela não deixava dizer qual. */}
            {channels.length >= 2 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  {tCanais("scopeLabel")}
                </label>
                <ChannelMultiSelect
                  channels={channels}
                  value={channelIds}
                  onChange={onChannelIdsChange}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {tCanais("scopeHelpAll")}
                </p>
              </div>
            )}
            {/* Recorte por ETAPA: "responda, mas só para quem está na etapa
                Proposta". É o análogo do escopo de canal, e é diferente da
                config do gatilho de funil acima — aqui a pergunta é onde o
                contato ESTÁ, não para onde ele acabou de ir.

                Escondido no gatilho de funil: ali a etapa já é a config do
                próprio gatilho, e dois seletores de etapa no mesmo card com
                significados diferentes é convite a erro. */}
            {type !== "deal_stage_changed" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t("stages.scopeLabel")}
                </label>
                <SeletorDeEtapas
                  value={stageIds}
                  onChange={onStageIdsChange}
                  vazioLabel={t("stages.scopeHelpAll")}
                />
              </div>
            )}
            {type === "keyword_match" && (
              <KeywordMatchConfig
                config={config as unknown as KeywordMatchTriggerConfig}
                onChange={onConfigChange}
                t={t}
              />
            )}
            {type === "interactive_reply" && (
              <InteractiveReplyConfig config={config} onChange={onConfigChange} t={t} />
            )}
            {type === "tag_added" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Tag
                </label>
                <TagSelect
                  value={(config.tag_id as string) ?? ""}
                  onChange={(v) => onConfigChange({ ...config, tag_id: v })}
                  t={t}
                />
              </div>
            )}
            {/* Config do gatilho de funil: PARA QUAL etapa o card tem de
                entrar. Não confundir com o recorte por etapa logo abaixo, que
                pergunta onde o contato ESTÁ. */}
            {type === "deal_stage_changed" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t("stages.triggerLabel")}
                </label>
                <SeletorDeEtapas
                  value={(config.stage_ids as string[] | undefined) ?? []}
                  onChange={(ids) => onConfigChange({ ...config, stage_ids: ids })}
                  vazioLabel={t("stages.triggerHelpAll")}
                />
              </div>
            )}
            {type === "deal_status_changed" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t("stages.statusLabel")}
                </label>
                <div className="flex gap-3">
                  {(["won", "lost", "open"] as const).map((s) => {
                    const atuais = (config.statuses as string[] | undefined) ?? []
                    return (
                      <label
                        key={s}
                        className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground"
                      >
                        <input
                          type="checkbox"
                          checked={atuais.includes(s)}
                          onChange={() =>
                            onConfigChange({
                              ...config,
                              statuses: atuais.includes(s)
                                ? atuais.filter((v) => v !== s)
                                : [...atuais, s],
                            })
                          }
                          className="h-3.5 w-3.5 accent-primary"
                        />
                        {t(`stages.status_${s}`)}
                      </label>
                    )
                  })}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t("stages.statusHelpAll")}
                </p>
              </div>
            )}
            {type === "time_based" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t("schedule")}
                </label>
                <Input
                  placeholder="Cron expression or HH:mm"
                  value={(config.schedule as string) ?? ""}
                  onChange={(e) =>
                    onConfigChange({ ...config, schedule: e.target.value })
                  }
                  className="bg-muted text-foreground"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t("scheduleHint")}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function KeywordMatchConfig({
  config,
  onChange,
  t,
}: {
  config: KeywordMatchTriggerConfig
  onChange: (c: Record<string, unknown>) => void
  t: ReturnType<typeof useTranslations>
}) {
  const keywords = config?.keywords ?? []
  // Keep a local draft string so the comma and trailing space aren't
  // stripped on every keystroke (which made multi-word, comma-separated
  // entry like "SEO, search engine optimization" impossible to type).
  // We only parse into the keywords array on blur, then re-display the
  // cleaned, rejoined form. Seeded once on mount; this component remounts
  // when the trigger type changes, so the seed stays in sync.
  const [draft, setDraft] = useState(keywords.join(", "))

  // Persist the default the <select> displays. The dropdown falls back to
  // "contains" for display, but leaving it untouched would otherwise omit
  // match_type from the saved config — and activation validation then
  // rejected it (trigger.match_type). Seed once on mount; the component
  // remounts when the trigger type changes, matching the keywords draft.
  useEffect(() => {
    if (config?.match_type == null) {
      onChange({ ...config, match_type: "contains" })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function commit() {
    const parsed = draft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    setDraft(parsed.join(", "))
    onChange({ ...config, keywords: parsed })
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("keywords")}
        </label>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
            }
          }}
          placeholder={t("keywordsHint")}
          className="bg-muted text-foreground"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("config.matchType")}
        </label>
        <select
          value={config?.match_type ?? "contains"}
          onChange={(e) => onChange({ ...config, match_type: e.target.value as "exact" | "contains" })}
          className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:outline-none"
        >
          <option value="contains">{t("config.matchContains")}</option>
          <option value="exact">{t("config.matchExact")}</option>
        </select>
      </div>
    </div>
  )
}

function InteractiveReplyConfig({
  config,
  onChange,
  t,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
  t: ReturnType<typeof useTranslations>
}) {
  const ids = (config?.reply_ids as string[] | undefined) ?? []
  // Same local-draft-then-commit pattern as KeywordMatchConfig so
  // commas + spaces survive keystrokes.
  const [draft, setDraft] = useState(ids.join(", "))

  function commit() {
    const parsed = draft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    setDraft(parsed.join(", "))
    onChange({ ...config, reply_ids: parsed })
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {t("replyIds")}
      </label>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          }
        }}
        placeholder={t("replyIdsHint")}
        className="bg-muted font-mono text-foreground"
      />
      <p className="mt-1 text-[11px] text-muted-foreground">{t("replyIdsHelp")}</p>
    </div>
  )
}

// ------------------------------------------------------------
// Step list + card + connectors
// ------------------------------------------------------------

type ParentScope =
  | { kind: "root" }
  | { kind: "branch"; parentCid: string; branch: "yes" | "no" }

type StepPath = (
  | { kind: "root"; index: number }
  | { kind: "branch"; parentCid: string; branch: "yes" | "no"; index: number }
)[]

interface StepListProps {
  steps: BuilderStep[]
  parentPath: StepPath
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  updateStep: (path: StepPath, updater: (s: BuilderStep) => BuilderStep) => void
  addStepAt: (parent: ParentScope, index: number, type: AutomationStepType) => void
  deleteStepAt: (path: StepPath) => void
  moveStepAt: (path: StepPath, direction: -1 | 1) => void
}

function StepList(props: StepListProps) {
  const { steps, parentPath, ...rest } = props
  const parentScope: ParentScope =
    parentPath.length === 0
      ? { kind: "root" }
      : (() => {
          const last = parentPath[parentPath.length - 1]
          if (last.kind !== "branch") return { kind: "root" } as const
          return { kind: "branch", parentCid: last.parentCid, branch: last.branch } as const
        })()

  return (
    <div className="flex flex-col items-center">
      <AddButton onPick={(t) => props.addStepAt(parentScope, 0, t)} />
      {steps.map((step, idx) => (
        <StepRenderer
          key={step.cid}
          step={step}
          index={idx}
          total={steps.length}
          parentScope={parentScope}
          parentPath={parentPath}
          {...rest}
        />
      ))}
    </div>
  )
}

function StepRenderer({
  step,
  index,
  total,
  parentScope,
  parentPath,
  ...props
}: {
  step: BuilderStep
  index: number
  total: number
  parentScope: ParentScope
  parentPath: StepPath
} & Omit<StepListProps, "steps" | "parentPath">) {
  const t = useTranslations("Automations.builder")
  const path: StepPath = [
    ...parentPath,
    parentScope.kind === "root"
      ? { kind: "root", index }
      : { kind: "branch", parentCid: parentScope.parentCid, branch: parentScope.branch, index },
  ]
  const meta = STEP_META[step.step_type]
  const Icon = meta.icon
  const expanded = props.expandedId === step.cid
  const isCondition = step.step_type === "condition"
  // Card widths on mobile fill the full canvas column (max-w-2xl px-4
  // still keeps them reasonable). On sm+ the original fixed widths
  // come back so the flow visual stays recognisable.
  const width = isCondition
    ? "w-full max-w-[400px] sm:w-[400px]"
    : "w-full max-w-[320px] sm:w-80"

  return (
    <>
      <div className={cn("z-10 flex flex-col", width)}>
        <div
          className={cn(
            "rounded-lg border border-border border-l-4 bg-card shadow-lg",
            meta.border,
          )}
        >
          <button
            type="button"
            onClick={() => props.setExpandedId(expanded ? null : step.cid)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
          >
            <GripVertical className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {isCondition ? "Condition" : step.step_type === "wait" ? "Wait" : "Action"}
              </div>
              <div className="truncate text-sm font-medium text-foreground">{t(`steps.${meta.label}`)}</div>
              <div className="truncate text-[11px] text-muted-foreground">{previewFor(step)}</div>
            </div>
            <ChevronDown
              className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")}
            />
          </button>
          {expanded && (
            <div className="border-t border-border px-4 py-3">
              <StepEditor
                step={step}
                onChange={(next) => props.updateStep(path, () => next)}
              />
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === 0}
                    aria-label="Move up"
                    onClick={() => props.moveStepAt(path, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === total - 1}
                    aria-label="Move down"
                    onClick={() => props.moveStepAt(path, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => props.deleteStepAt(path)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {/* Sem `defaultValue`: o 2º argumento do next-intl são os
                      VALORES de interpolação, não um fallback. Ele nunca foi
                      lido, e a chave não existia em nenhum dicionário — o
                      botão mostrava "Automations.builder.delete" cru. */}
                  {t("delete")}
                </Button>
              </div>
            </div>
          )}
        </div>

        {isCondition && (
          <ConditionBranches step={step} parentPath={path} {...props} />
        )}
      </div>

      {/* A condition branches into Yes/No (rendered above by
          ConditionBranches), so it has no linear "continue" path — adding
          the trailing connector here would produce a spurious third output. */}
      {!isCondition && (
        <AddButton
          onPick={(t) => props.addStepAt(parentScope, index + 1, t)}
        />
      )}
    </>
  )
}

function ConditionBranches({
  step,
  parentPath,
  ...props
}: {
  step: BuilderStep
  parentPath: StepPath
} & Omit<StepListProps, "steps" | "parentPath">) {
  const t = useTranslations("Automations.builder")
  const yes = step.branches?.yes ?? []
  const no = step.branches?.no ?? []
  // Build the child scope by appending a branch marker. The scope the
  // StepList uses is driven by the LAST element of parentPath, so the
  // tail's `index` doesn't matter — it's replaced per child during walks.
  const yesPath: StepPath = [
    ...parentPath,
    { kind: "branch", parentCid: step.cid, branch: "yes", index: 0 },
  ]
  const noPath: StepPath = [
    ...parentPath,
    { kind: "branch", parentCid: step.cid, branch: "no", index: 0 },
  ]
  return (
    // Stack Yes/No vertically on mobile — two columns at 375px would
    // cram each branch to ~170px which is too narrow for the nested
    // cards. Two-column grid returns on sm+.
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <BranchColumn label={t("branches.yes")} color="text-primary">
        <StepList {...props} steps={yes} parentPath={yesPath} />
      </BranchColumn>
      <BranchColumn label={t("branches.no")} color="text-rose-400">
        <StepList {...props} steps={no} parentPath={noPath} />
      </BranchColumn>
    </div>
  )
}

function BranchColumn({
  label,
  color,
  children,
}: {
  label: string
  color: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center">
      <div className={cn("mb-2 text-[11px] font-semibold uppercase", color)}>{label}</div>
      {children}
    </div>
  )
}

function AddButton({ onPick }: { onPick: (t: AutomationStepType) => void }) {
  const t = useTranslations("Automations.builder")
  return (
    <div className="relative flex flex-col items-center">
      <div className="h-4 w-[2px] bg-border" aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary data-[popup-open]:border-primary data-[popup-open]:bg-primary/20 data-[popup-open]:text-primary"
          aria-label={t("addStep")}
        >
          <Plus className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-80 min-w-56 overflow-y-auto border-border bg-popover"
        >
          {ADDABLE_STEPS.map((tp) => {
            const Icon = STEP_META[tp].icon
            return (
              <DropdownMenuItem key={tp} onClick={() => onPick(tp)}>
                <Icon className="h-4 w-4" />
                {t(`steps.${STEP_META[tp].label}`)}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="h-4 w-[2px] bg-border" aria-hidden />
    </div>
  )
}

// ------------------------------------------------------------
// Seletor de ETAPAS do funil (migration 933).
//
// Usado em dois lugares com significados DIFERENTES, e por isso recebe o
// texto de ajuda de fora:
//   - no gatilho `deal_stage_changed`: "para QUAL etapa o card tem de entrar";
//   - no recorte da automação (`stage_ids`): "o contato precisa ESTAR nesta
//     etapa" — o análogo do escopo de canal.
//
// ⚠️ Em ambos, vazio = TODAS as etapas, nunca "nenhuma". É a convenção do
// projeto inteiro, e uma tela que disser o contrário faz o operador desativar
// a regra errada.
//
// Agrupa por funil porque etapa só faz sentido dentro do seu funil: "Contato
// Acordo" existe em mais de um quadro e o nome sozinho não distingue.
// ------------------------------------------------------------

function SeletorDeEtapas({
  value,
  onChange,
  vazioLabel,
}: {
  value: string[]
  onChange: (ids: string[]) => void
  vazioLabel: string
}) {
  const { pipelines, stages } = useResources()
  const tEtapas = useTranslations("Automations.builder.stages")

  const porFunil = useMemo(() => {
    return pipelines
      .map((p) => ({
        funil: p,
        etapas: stages.filter((s) => s.pipeline_id === p.id),
      }))
      .filter((g) => g.etapas.length > 0)
  }, [pipelines, stages])

  const alternar = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])

  // Etapa apagada entre editar e salvar. O trigger da 933 limpa o array em
  // `automations.stage_ids`, mas não o `trigger_config` — mesma dívida do
  // canal órfão, e a tela é quem denuncia.
  const orfaos = value.filter((id) => !stages.some((s) => s.id === id))

  if (porFunil.length === 0) return null

  return (
    <div className="rounded-md border border-border bg-muted/40 p-2">
      <p className="mb-1.5 text-[11px] text-muted-foreground">
        {value.length === 0
          ? vazioLabel
          : tEtapas("selectedCount", { count: value.length })}
      </p>
      <div className="max-h-52 space-y-2 overflow-y-auto">
        {porFunil.map((g) => (
          <div key={g.funil.id}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {g.funil.name}
            </div>
            {g.etapas.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-foreground hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={value.includes(s.id)}
                  onChange={() => alternar(s.id)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                <span className="truncate">{s.name}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      {orfaos.length > 0 && (
        <p className="mt-1 text-[11px] text-destructive">
          {tEtapas("stageGone", { count: orfaos.length })}
        </p>
      )}
    </div>
  )
}

// ------------------------------------------------------------
// Aviso AO VIVO de canal impossível.
//
// A mesma função que o servidor roda na ativação, rodando enquanto o operador
// edita. Antes, a única forma de descobrir "botões não existem no QR Code" era
// ligar o interruptor, salvar, e ler um toast — depois de já ter montado a
// automação inteira. Os fluxos já faziam assim (`flow-editor-state.tsx`); as
// automações só tinham a metade do servidor.
//
// Uma função só nas duas pontas é o ponto: duas cópias divergem, e a que
// diverge é sempre a da tela — que passa a liberar o que o servidor recusa.
// ------------------------------------------------------------

function AvisosDeCanal({
  steps,
  channelIds,
}: {
  steps: BuilderStep[]
  channelIds: string[]
}) {
  const { channels } = useResources()
  const issues = useMemo(
    () =>
      channels.length === 0
        ? []
        : validateChannelScopeForActivation(
            toApiSteps(steps),
            channelIds.length > 0 ? channelIds : null,
            channels.map((c) => ({ id: c.id, label: c.label, kind: c.kind })),
          ),
    [steps, channelIds, channels],
  )
  if (issues.length === 0) return null
  return (
    <div className="z-10 mb-4 w-full max-w-[320px] rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 sm:w-80">
      <ul className="space-y-1">
        {issues.map((issue) => (
          <li key={issue.path} className="text-[11px] leading-snug text-destructive">
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ------------------------------------------------------------
// Canal de SAÍDA do passo
//
// Grava `step_config.channel_id`, que o motor já lia desde a 903
// (`stepChannel`, engine.ts) sem nenhuma tela para preenchê-lo — dava para
// escolher POR ONDE a automação escuta, não por onde ela responde.
//
// ⚠️ Vazio NÃO é "todos", como no escopo do gatilho: aqui uma mensagem sai por
// UM número só. Vazio = herda o canal do DISPARO (com queda para o canal atual
// da conversa). Daí o rótulo próprio em vez do `allLabel` padrão "Todos os
// canais", que aqui seria mentira.
//
// ⚠️ A herança é o que faz o follow-up de 24h sair pelo número certo: o canal
// do disparo viaja no contexto JSONB e sobrevive ao passo `wait`. Fixar um
// canal à toa joga essa propriedade fora, então o padrão continua sendo herdar.
// ------------------------------------------------------------

function CanalDeSaida({
  value,
  onChange,
  t,
}: {
  value: string | null
  onChange: (id: string | null) => void
  t: ReturnType<typeof useTranslations>
}) {
  const tCanais = useTranslations("Channels")
  const { channels } = useResources()

  // CONEXÃO APAGADA. Nenhum trigger limpa `step_config` — o da 903 só toca em
  // `automations.channel_ids` —, e a validação de ativação ignora id
  // desconhecido de propósito (e nem olha passo que não seja só-Meta). Então o
  // UUID morto fica pendurado, `resolveEngineChannelPreferring` não casa, cai
  // no canal da conversa, e a promessa do seletor ("sai SEMPRE por este
  // número") deixa de valer sem erro, sem log e sem marca na tela. É a mesma
  // dívida que a condição por canal já paga logo abaixo — o seletor sozinho
  // não denuncia nada: mostra o placeholder, indistinguível de "ainda não
  // escolhi".
  //
  // `channels.length > 0` é load-bearing: a lista nasce vazia e só enche
  // depois do fetch, e sem essa guarda todo passo já salvo piscaria o aviso na
  // montagem.
  const orfao = !!value && channels.length > 0 && !channels.some((c) => c.id === value)

  // Com um número só não há o que decidir — mesma regra do resto do projeto.
  // MAS o órfão precisa aparecer para poder ser trocado: apagar uma conexão de
  // uma conta de duas deixa UMA, que é exatamente quando o aviso importa.
  if (channels.length < 2 && !orfao) return null

  return (
    <FieldBlock label={tCanais("outboundLabel")}>
      <ChannelSelect
        channels={channels}
        value={value}
        onChange={onChange}
        allowAll
        allLabel={tCanais("outboundInherit")}
      />
      {orfao ? (
        // Texto diz que a mensagem CONTINUA saindo, por outro número — o
        // oposto do `channelGone` da condição, que fica inerte. Confundir os
        // dois faria o operador achar que a automação parou, quando ela está
        // entregando pelo número errado, que é pior.
        <p className="mt-1 text-xs text-destructive">
          {t("config.outboundChannelGone")}
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {tCanais("outboundHelp")}
        </p>
      )}
    </FieldBlock>
  )
}

/** Lê o canal do passo tolerando config antiga (campo ausente) e `""`. */
function canalDoPasso(cfg: Record<string, unknown>): string | null {
  const v = cfg.channel_id
  return typeof v === "string" && v ? v : null
}

// ------------------------------------------------------------
// Per-step config editor
// ------------------------------------------------------------

function StepEditor({
  step,
  onChange,
}: {
  step: BuilderStep
  onChange: (s: BuilderStep) => void
}) {
  const t = useTranslations("Automations.builder")
  const { channels } = useResources()
  const cfg = step.step_config
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...step, step_config: { ...cfg, ...patch } })

  switch (step.step_type) {
    case "send_message":
      return (
        <>
          <FieldBlock label={t("config.messageText")}>
            <Textarea
              value={(cfg.text as string) ?? ""}
              onChange={(e) => set({ text: e.target.value })}
              placeholder={t("config.placeholderMessageText")}
              className="min-h-24 bg-muted text-foreground"
            />
          </FieldBlock>
          <CanalDeSaida
            value={canalDoPasso(cfg)}
            onChange={(id) => set({ channel_id: id })}
            t={t}
          />
        </>
      )
    case "send_buttons":
    case "send_list":
      // The whole step_config IS the interactive payload; the shared
      // builder edits it in place (and enforces Meta's limits + preview).
      return (
        <>
          <InteractiveBuilder
            value={asInteractive(cfg)}
            onChange={(payload) =>
              onChange({
                ...step,
                // ⚠️ `toStepConfig(payload)` SUBSTITUI o config inteiro — o
                // payload interativo É o config. Sem recolocar o canal aqui,
                // qualquer toque num botão apagaria a escolha de saída em
                // silêncio, e o operador só descobriria pelo número errado
                // chegando ao cliente.
                step_config: {
                  ...toStepConfig(payload),
                  ...(canalDoPasso(cfg) ? { channel_id: canalDoPasso(cfg) } : {}),
                },
              })
            }
          />
          <CanalDeSaida
            value={canalDoPasso(cfg)}
            onChange={(id) => set({ channel_id: id })}
            t={t}
          />
        </>
      )
    case "send_template":
      return (
        <>
          <SendTemplateFields
            templateName={(cfg.template_name as string) ?? ""}
            language={(cfg.language as string) ?? ""}
            onChange={(patch) => set(patch)}
            t={t}
          />
          <CanalDeSaida
            value={canalDoPasso(cfg)}
            onChange={(id) => set({ channel_id: id })}
            t={t}
          />
        </>
      )
    case "add_tag":
    case "remove_tag":
      return (
        <FieldBlock label={t("config.tagLabel")}>
          <TagSelect
            value={(cfg.tag_id as string) ?? ""}
            onChange={(v) => set({ tag_id: v })}
            t={t}
          />
        </FieldBlock>
      )
    case "assign_conversation":
      return (
        <>
          <FieldBlock label={t("config.modeLabel")}>
            <select
              value={(cfg.mode as string) ?? "round_robin"}
              onChange={(e) => set({ mode: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="round_robin">{t("config.modes.round_robin")}</option>
              <option value="specific">{t("config.modes.specific")}</option>
            </select>
          </FieldBlock>
          {cfg.mode === "specific" && (
            <FieldBlock label={t("config.agentLabel")}>
              <AgentSelect
                value={(cfg.agent_id as string) ?? ""}
                onChange={(v) => set({ agent_id: v })}
                t={t}
              />
            </FieldBlock>
          )}
        </>
      )
    case "update_contact_field":
      return (
        <>
          <FieldBlock label={t("config.fieldLabel")}>
            <ContactFieldSelect
              value={(cfg.field as string) ?? "name"}
              onChange={(v) => set({ field: v })}
              t={t}
            />
          </FieldBlock>
          <FieldBlock label={t("config.valueLabel")}>
            <Input
              value={(cfg.value as string) ?? ""}
              onChange={(e) => set({ value: e.target.value })}
              placeholder={t("config.placeholderValue")}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
        </>
      )
    case "create_deal":
      return (
        <>
          <DealPipelineFields
            pipelineId={(cfg.pipeline_id as string) ?? ""}
            stageId={(cfg.stage_id as string) ?? ""}
            onChange={(patch) => set(patch)}
            t={t}
          />
          <FieldBlock label={t("config.titleLabel")}>
            <Input
              value={(cfg.title as string) ?? ""}
              onChange={(e) => set({ title: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("config.valueLabel")}>
            <Input
              type="number"
              value={(cfg.value as number) ?? 0}
              onChange={(e) => set({ value: Number(e.target.value) })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
        </>
      )
    case "wait":
      return (
        <div className="grid grid-cols-2 gap-2">
          <FieldBlock label={t("config.amountLabel")}>
            <Input
              type="number"
              min={1}
              value={(cfg.amount as number) ?? 1}
              onChange={(e) => set({ amount: Math.max(1, Number(e.target.value)) })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("config.unitLabel")}>
            <select
              value={(cfg.unit as string) ?? "hours"}
              onChange={(e) => set({ unit: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="minutes">{t("config.units.minutes")}</option>
              <option value="hours">{t("config.units.hours")}</option>
              <option value="days">{t("config.units.days")}</option>
            </select>
          </FieldBlock>
        </div>
      )
    case "condition":
      return (
        <>
          <FieldBlock label={t("config.subjectLabel")}>
            <select
              value={(cfg.subject as string) ?? "tag_presence"}
              onChange={(e) => set({ subject: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="tag_presence">{t("config.subjects.tag_presence")}</option>
              <option value="contact_field">{t("config.subjects.contact_field")}</option>
              <option value="message_content">{t("config.subjects.message_content")}</option>
              <option value="time_of_day">{t("config.subjects.time_of_day")}</option>
              {/* Por canal: o motor ramifica assim desde a 903, mas a tela
                  nunca ofereceu. Some com um canal só (não decide nada), e
                  reaparece se a condição JÁ estiver gravada — senão o select
                  ficaria vazio e o primeiro clique trocaria o critério
                  mantendo o UUID no operando, deixando a condição
                  permanentemente falsa em silêncio. */}
              {(channels.length >= 2 || cfg.subject === "channel") && (
                <option value="channel">{t("config.subjects.channel")}</option>
              )}
            </select>
          </FieldBlock>
          <FieldBlock label={t("config.operandLabel")}>
            {cfg.subject === "channel" && channels.length > 0 ? (
              // Grava em `operand` — é o que o motor lê (cfg.operand ?? cfg.value)
              // e o que `validate.ts` exige não-vazio. Sem `allowAll`: aqui a
              // condição é "veio DESTE número", não um escopo.
              <>
                <ChannelSelect
                  channels={channels}
                  value={(cfg.operand as string) || null}
                  onChange={(id) => set({ operand: id ?? "" })}
                />
                {/* CANAL APAGADO. O trigger `cb_drop_channel_from_automations`
                    (903) limpa `automations.channel_ids`, mas NÃO toca em
                    `step_config` — nenhum trigger toca. O UUID fica pendurado,
                    a condição passa a ser sempre falsa e a automação segue
                    ATIVA, sem nada na tela nem no log dizendo por quê.
                    Dívida que a própria opção "canal" criou: antes dela não
                    havia o que orfanar. O seletor sozinho não denunciaria —
                    ele só mostraria o placeholder, indistinguível de "ainda
                    não escolhi". */}
                {!!cfg.operand &&
                  !channels.some((c) => c.id === cfg.operand) && (
                    <p className="mt-1 text-xs text-destructive">
                      {t("config.channelGone")}
                    </p>
                  )}
              </>
            ) : (
            <Input
              placeholder={
                cfg.subject === "time_of_day"
                  ? t("config.placeholderTime")
                  : cfg.subject === "contact_field"
                  ? t("config.placeholderContact")
                  : cfg.subject === "tag_presence"
                  ? t("config.placeholderTag")
                  : ""
              }
              value={(cfg.operand as string) ?? ""}
              onChange={(e) => set({ operand: e.target.value })}
              className="bg-muted text-foreground"
            />
            )}
          </FieldBlock>
          {(cfg.subject === "contact_field" || cfg.subject === "message_content") && (
            <FieldBlock label="Value">
              <Input
                value={(cfg.value as string) ?? ""}
                onChange={(e) => set({ value: e.target.value })}
                className="bg-muted text-foreground"
              />
            </FieldBlock>
          )}
        </>
      )
    case "send_webhook":
      return (
        <>
          <FieldBlock label={t("config.urlLabel")}>
            <Input
              value={(cfg.url as string) ?? ""}
              onChange={(e) => set({ url: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("config.bodyTemplateLabel")}>
            <Textarea
              value={(cfg.body_template as string) ?? ""}
              onChange={(e) => set({ body_template: e.target.value })}
              className="min-h-20 bg-muted font-mono text-xs text-foreground"
            />
          </FieldBlock>
        </>
      )
    case "close_conversation":
      return (
        <p className="text-xs text-muted-foreground">
          {/* Idem: a chave existe nos dois dicionários, então o `defaultValue`
              só enganava quem lesse. */}
          {t("config.closeConversationHint")}
        </p>
      )
    default:
      return null
  }
}

function FieldBlock({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-2 last:mb-0">
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

function previewFor(step: BuilderStep): string {
  switch (step.step_type) {
    case "send_message":
      return (step.step_config.text as string) || "no text yet"
    case "send_buttons":
    case "send_list":
      return interactivePayloadPreviewText(asInteractive(step.step_config)) || "no body yet"
    case "send_template":
      return (step.step_config.template_name as string) || "pick a template"
    case "wait":
      return `${step.step_config.amount ?? "?"} ${step.step_config.unit ?? ""}`
    case "condition":
      return `when ${step.step_config.subject ?? "?"}`
    case "send_webhook":
      return (step.step_config.url as string) || "no url"
    default:
      return ""
  }
}

// ------------------------------------------------------------
// Tree mutation helpers
// ------------------------------------------------------------

function insertAt(
  steps: BuilderStep[],
  parent: ParentScope,
  index: number,
  node: BuilderStep,
): BuilderStep[] {
  if (parent.kind === "root") {
    const copy = [...steps]
    copy.splice(index, 0, node)
    return copy
  }
  return steps.map((s) => {
    if (s.cid !== parent.parentCid || !s.branches) return s
    const list = [...s.branches[parent.branch]]
    list.splice(index, 0, node)
    return { ...s, branches: { ...s.branches, [parent.branch]: list } }
  })
}

function mapAtPath(
  steps: BuilderStep[],
  path: StepPath,
  updater: (s: BuilderStep) => BuilderStep,
): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)

  if (head.kind === "root") {
    return steps.map((s, i) => {
      if (i !== head.index) return s
      return rest.length === 0
        ? updater(s)
        : { ...s, branches: walkBranches(s.branches, rest, updater) }
    })
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const updated = bucket.map((child, i) => {
      if (i !== head.index) return child
      return rest.length === 0
        ? updater(child)
        : { ...child, branches: walkBranches(child.branches, rest, updater) }
    })
    return { ...s, branches: { ...s.branches, [head.branch]: updated } }
  })
}

function walkBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
  updater: (s: BuilderStep) => BuilderStep,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const bucket = branches[head.branch]
  const rest = path.slice(1)
  const updated = bucket.map((child, i) => {
    if (i !== head.index) return child
    return rest.length === 0
      ? updater(child)
      : { ...child, branches: walkBranches(child.branches, rest, updater) }
  })
  return { ...branches, [head.branch]: updated }
}

function removeAt(steps: BuilderStep[], path: StepPath): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)
  if (head.kind === "root") {
    if (rest.length === 0) return steps.filter((_, i) => i !== head.index)
    return steps.map((s, i) =>
      i !== head.index ? s : { ...s, branches: removeFromBranches(s.branches, rest) },
    )
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const next =
      rest.length === 0
        ? bucket.filter((_, i) => i !== head.index)
        : bucket.map((child, i) =>
            i !== head.index
              ? child
              : { ...child, branches: removeFromBranches(child.branches, rest) },
          )
    return { ...s, branches: { ...s.branches, [head.branch]: next } }
  })
}

function removeFromBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const rest = path.slice(1)
  const bucket = branches[head.branch]
  const next =
    rest.length === 0
      ? bucket.filter((_, i) => i !== head.index)
      : bucket.map((child, i) =>
          i !== head.index
            ? child
            : { ...child, branches: removeFromBranches(child.branches, rest) },
        )
  return { ...branches, [head.branch]: next }
}

function moveAt(
  steps: BuilderStep[],
  path: StepPath,
  direction: -1 | 1,
): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)
  const swap = <T,>(arr: T[], i: number) => {
    const j = i + direction
    if (j < 0 || j >= arr.length) return arr
    const copy = [...arr]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    return copy
  }
  if (head.kind === "root") {
    if (rest.length === 0) return swap(steps, head.index)
    return steps.map((s, i) =>
      i !== head.index ? s : { ...s, branches: moveInBranches(s.branches, rest, direction) },
    )
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const next = rest.length === 0 ? swap(bucket, head.index) : bucket
    return { ...s, branches: { ...s.branches, [head.branch]: next } }
  })
}

function moveInBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
  direction: -1 | 1,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const rest = path.slice(1)
  const bucket = branches[head.branch]
  const swap = <T,>(arr: T[], i: number) => {
    const j = i + direction
    if (j < 0 || j >= arr.length) return arr
    const copy = [...arr]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    return copy
  }
  const next = rest.length === 0 ? swap(bucket, head.index) : bucket
  return { ...branches, [head.branch]: next }
}

// ------------------------------------------------------------
// Serialize builder tree → API payload (flattened shape)
// ------------------------------------------------------------

interface ApiStep {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: ApiStep[]; no?: ApiStep[] }
}

export function toApiSteps(steps: BuilderStep[]): ApiStep[] {
  return steps.map((s) => ({
    step_type: s.step_type,
    step_config: s.step_config,
    branches: s.branches
      ? { yes: toApiSteps(s.branches.yes), no: toApiSteps(s.branches.no) }
      : undefined,
  }))
}

/**
 * Convert server-returned step tree (from loadStepsTree) into the
 * builder-local shape with client ids.
 */
export interface ServerStepNode {
  id: string
  step_type: string
  step_config: Record<string, unknown>
  branches: { yes: ServerStepNode[]; no: ServerStepNode[] }
}

export function fromServerSteps(nodes: ServerStepNode[]): BuilderStep[] {
  return nodes.map((n) => ({
    cid: cid(),
    step_type: n.step_type as AutomationStepType,
    step_config: n.step_config ?? {},
    branches:
      n.step_type === "condition"
        ? {
            yes: fromServerSteps(n.branches?.yes ?? []),
            no: fromServerSteps(n.branches?.no ?? []),
          }
        : undefined,
  }))
}
