"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useRouter, useSearchParams } from "next/navigation"
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
  MoveRight,
  Trophy,
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
  OctagonX,
  Bot,
  BotOff,
  Sparkles,
  Paperclip,
  Upload,
  BellRing,
  ListTodo,
  CircleAlert,
  TriangleAlert,
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
import { extractVariableIndices } from "@/lib/whatsapp/template-validators"
import { linhaDoModeloNaTela } from "@/lib/automations/parametros-do-modelo"
import {
  camposDaJanela,
  ehODiaInteiro,
  lerJanela,
  OPERANDO_DO_DIA_INTEIRO,
  operandoDaJanela,
  rotuloDaJanela,
} from "@/lib/automations/hora-do-dia"
import { ehMeta } from "@/lib/cb-channels/transporte"
import { channelLabel } from "@/lib/cb-channels/display"
import { createClient } from "@/lib/supabase/client"
import { useAreasDeAutomacao } from "@/hooks/use-areas-de-automacao"
import { areaDoFunil } from "@/lib/automations/areas"
import { AsaasTriggerConfig } from "@/components/automations/asaas-trigger-config"
import { CalendlyTriggerConfig } from "@/components/automations/calendly-trigger-config"
import { ehGatilhoDaRegua, HORA_PADRAO_COBRANCA, HORA_PADRAO_LEMBRETE } from "@/lib/asaas/regua"
import { WebhookTriggerConfig } from "@/components/automations/webhook-trigger-config"
import { ZapSignTriggerConfig } from "@/components/automations/zapsign-trigger-config"
import { CondicaoPorCampoFields } from "@/components/automations/condicao-por-campo-fields"
import {
  childPath,
  insertAt,
  mapAtPath,
  moveAt,
  removeAt,
  type ParentScope,
  type StepPath,
} from "@/lib/automations/builder-tree"
import { cn } from "@/lib/utils"
import { useChannels } from "@/hooks/use-channels"
import type { CbChannel } from "@/lib/cb-channels/repo"
import { ChannelMultiSelect, ChannelSelect } from "@/components/channels/channel-select"
import { validateChannelScopeForActivation, type ValidationIssue } from "@/lib/automations/validate"
import { camposParaConferir, conferirParaLigar } from "@/lib/automations/conferir-para-ligar"
import {
  avisosDaAutomacao,
  chaveDaPendencia,
  localDoPasso,
  localizarPendencias,
  type PendenciasLocalizadas,
} from "@/lib/automations/pendencias"
import { useAuth } from "@/hooks/use-auth"
import { TIPO_DATA } from "@/lib/contacts/campo-data"
import { telefoneDigitado } from "@/lib/contacts/telefone"
import { uploadAccountMedia, MEDIA_MAX_BYTES_BY_KIND } from "@/lib/storage/upload-media"
import { mensagemDoUpload } from "@/lib/storage/erro-de-upload"
import { CHAT_MEDIA_BUCKET } from "@/lib/storage/buckets"
import { origemDoConstrutor, urlDoConstrutor, voltaDoConstrutor } from "@/lib/pipelines/url"

/** Os quatro tipos que o passo `send_media` oferece. */
type MediaKindUI = "image" | "video" | "document" | "audio"

// ------------------------------------------------------------
// Types (builder-local — mirror the flattened rows we POST)
// ------------------------------------------------------------

export interface BuilderStep {
  /** Client id; the API assigns real UUIDs server-side. */
  cid: string
  /**
   * NOSSO (26/09/2026): o id do passo NO BANCO — o que veio do servidor, ou um
   * UUID gerado aqui para o passo novo. Vai no salvamento e, ao EDITAR, o
   * servidor o MANTÉM: a espera estacionada num ramo guarda o id da condição,
   * e um id novo a cada salvamento a desviava para outro passo
   * (`replaceSteps`, `retomada.ts`). Na criação o servidor atribui ids novos
   * e a tela recarrega pela edição. Ausente só onde o navegador não gera UUID.
   */
  id?: string
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
  /** "Assinar como" (998, D18): `null` = o nome automático do escritório. */
  assinatura_personalizada: string | null
  /** A aba da tela de Automações (1055). `null` = "Geral". Só organiza. */
  area_id: string | null
  is_active: boolean
  steps: BuilderStep[]
}

/**
 * Defaults REAIS dos gatilhos da régua do Asaas (998) — a mesma lição de
 * `semearLembrete`: o que se vê é o que se salva. `dias_de_atraso` nasce 1
 * na cobrança; a hora nasce 09:00 (cobrança) / 08:00 (lembrete); "só dia
 * útil" nasce ligado. Nada é sobrescrito quando já existe.
 */
function semearRegua(tipo: AutomationTriggerType, cfg: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = { ...cfg }
  if (tipo === "asaas_cobranca_vencida" && !Number.isInteger(Number(base.dias_de_atraso))) base.dias_de_atraso = 1
  if (typeof base.hora_envio !== "string" || base.hora_envio === "") base.hora_envio = tipo === "asaas_cobranca_vencida" ? HORA_PADRAO_COBRANCA : HORA_PADRAO_LEMBRETE
  if (typeof base.somente_dias_uteis !== "boolean") base.somente_dias_uteis = true
  return base
}

/**
 * Defaults REAIS do gatilho de lembrete por data — os mesmos que os inputs
 * exibem. Sem isto eles eram só de tela (`?? 24`, `?? "antes"`): digitar
 * apenas os minutos salvava um lembrete de 30min-antes com a tela dizendo
 * 24h30, e o formulário intocado era recusado na ativação por "direção
 * inválida" — com "antes" selecionado na tela.
 *
 * ⚠️ O deslocamento é semeado só quando NENHUMA das duas metades veio
 * (a régua de "veio" espelha `motivoDeConfigInvalida`): config só-minutos é
 * um lembrete legítimo de minutos, e ganhar `offset_hours: 24` aqui o
 * tornaria 24h30 em silêncio na próxima edição.
 */
function semearLembrete(cfg: Record<string, unknown>): Record<string, unknown> {
  const ausente = (v: unknown) =>
    v === undefined || v === null || (typeof v === "string" && v.trim() === "")
  const semDeslocamento = ausente(cfg.offset_hours) && ausente(cfg.offset_minutes)
  return {
    ...cfg,
    ...(semDeslocamento ? { offset_hours: 24, offset_minutes: 0 } : {}),
    ...(ausente(cfg.direction) ? { direction: "antes" } : {}),
  }
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
  move_deal_stage: { label: "move_deal_stage", icon: MoveRight, border: "border-l-emerald-500" },
  set_deal_status: { label: "set_deal_status", icon: Trophy, border: "border-l-emerald-500" },
  // Orquestração (936): borda própria porque estes passos não falam com o
  // cliente — eles ligam e desligam OUTRAS peças. Quem lê a árvore precisa
  // ver de longe onde o controle sai desta automação.
  run_automation: { label: "run_automation", icon: Zap, border: "border-l-violet-500" },
  stop_automation: { label: "stop_automation", icon: OctagonX, border: "border-l-violet-500" },
  run_flow: { label: "run_flow", icon: Bot, border: "border-l-violet-500" },
  stop_flow: { label: "stop_flow", icon: BotOff, border: "border-l-violet-500" },
  set_ai: { label: "set_ai", icon: Sparkles, border: "border-l-violet-500" },
  send_media: { label: "send_media", icon: Paperclip, border: "border-l-primary" },
  wait: { label: "wait", icon: Hourglass, border: "border-l-border" },
  condition: { label: "condition", icon: GitBranch, border: "border-l-amber-500" },
  send_webhook: { label: "send_webhook", icon: Webhook, border: "border-l-primary" },
  close_conversation: { label: "close_conversation", icon: CircleSlash, border: "border-l-primary" },
  // Aviso para a EQUIPE (977): fala com um número fixo, não com o cliente —
  // borda própria para o olho separar "resposta ao cliente" de "aviso interno".
  send_to_number: { label: "send_to_number", icon: BellRing, border: "border-l-sky-500" },
  // Tarefa é trabalho INTERNO, como o aviso ao número: mesma borda, pelo mesmo
  // motivo — nada disto chega ao cliente.
  create_task: { label: "create_task", icon: ListTodo, border: "border-l-sky-500" },
}

const ADDABLE_STEPS: AutomationStepType[] = [
  "send_message",
  "send_buttons",
  "send_list",
  "send_template",
  "send_media",
  "add_tag",
  "remove_tag",
  "assign_conversation",
  "update_contact_field",
  "create_deal",
  "move_deal_stage",
  "set_deal_status",
  "run_automation",
  "stop_automation",
  "run_flow",
  "stop_flow",
  "set_ai",
  "wait",
  "condition",
  "send_webhook",
  "close_conversation",
  "send_to_number",
  "create_task",
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
 * espera. A lista deles mora em `GATILHOS_SEM_DISPARO` (`trigger-meta.ts`):
 * a grade do funil a usa para não desenhar cartão de chegada de regra que
 * não roda, e há teste cobrando que este seletor não ofereça nenhum deles.
 */
const TRIGGER_OPTIONS: { value: AutomationTriggerType }[] = [
  { value: "new_message_received" },
  { value: "first_inbound_message" },
  { value: "keyword_match" },
  { value: "interactive_reply" },
  { value: "new_contact_created" },
  { value: "tag_added" },
  { value: "date_field_offset" },
  { value: "calendly_booking" },
  { value: "webhook_received" },
  // A assinatura completa no ZapSign (1057): call site no webhook da integração.
  { value: "zapsign_documento_assinado" },
  // A régua do Asaas (998): os dois têm call site na varredura do cron.
  { value: "asaas_cobranca_vencida" },
  { value: "asaas_cobranca_vence_hoje" },
  // ⚠️ `manual` é oferecido, e NÃO está em `GATILHOS_SEM_DISPARO`: ele nunca é
  // despachado por evento, mas roda pelo botão "Executar automação" do menu +
  // da conversa. É o gatilho de quem só quer o botão — sem ele, o jeito de
  // fazer isso era gravar uma palavra-chave impossível, que basta alguém
  // digitar por acaso para a esteira inteira sair para o cliente.
  { value: "manual" },
]

function cid(): string {
  return (
    "c_" +
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  )
}

/**
 * O id de BANCO do passo novo, gerado aqui para ele ser o MESMO em todos os
 * salvamentos desta tela (ela não recarrega depois de salvar). Sem
 * `randomUUID` (contexto sem HTTPS), fica ausente e o servidor atribui.
 */
function idDePassoNovo(): string | undefined {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : undefined
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
    case "move_deal_stage":
      return { stage_id: "" }
    case "set_deal_status":
      return { status: "won" }
    case "run_automation":
    case "stop_automation":
      return { automation_id: "" }
    case "run_flow":
      return { flow_id: "" }
    // Imagem por padrão: é o anexo mais comum e o único cujo preenchimento
    // errado não tem dano silencioso (áudio com legenda tem — ver a config).
    case "send_media":
      return { kind: "image", url: "" }
    case "stop_flow":
      return {}
    case "send_to_number":
      return { phone: "", contact_name: "", text: "" }
    // Nasce LIGANDO a IA: é o caso que a maioria monta ("cliente respondeu ao
    // menu, devolve para o robô"). Nascer desligando faria o passo, aceito
    // sem abrir a config, calar o robô — o oposto do que quem o arrastou quis.
    case "set_ai":
      return { enabled: true }
    case "wait":
      return { amount: 1, unit: "hours" }
    case "condition":
      return { subject: "tag_presence", operand: "", value: "" }
    case "send_webhook":
      return { url: "", headers: {}, body_template: "" }
    case "close_conversation":
      return {}
    // Prazo HOJE por padrão, e sem hora: a tarefa que uma automação abre é
    // quase sempre "faça isso agora" (o contrato fechou). Nascer com prazo
    // distante faria o passo, aceito sem abrir a config, criar tarefa que não
    // aparece na lista de hoje de ninguém.
    case "create_task":
      return { titulo: "", responsavel_user_id: "", prazo_em_dias: 0 }
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
  /**
   * O gatilho em edição é um dos da régua do Asaas (998)? Aí o seletor de
   * conexão do passo aparece MESMO com uma conexão só: a ativação exige
   * `channel_id` no `send_message` (D19), e com o seletor escondido "por só
   * haver um número" a automação criada à mão nunca ligava (Codex, 2ª rodada
   * do PR #206).
   */
  reguaDoAsaas: boolean
  tags: TagRecord[]
  members: AccountMember[]
  templates: MessageTemplate[]
  customFields: CustomField[]
  pipelines: PipelineOption[]
  stages: PipelineStageOption[]
  /** Canais da conta — para a condição por canal do passo Condição. */
  channels: CbChannel[]
  /**
   * Automações da conta, para `run_automation` / `stop_automation`.
   *
   * ⚠️ Inclui a que está sendo editada, e quem filtra é cada seletor —
   * porque as duas ações querem coisas opostas dela:
   *
   * - `run_automation` a EXCLUI: acionar a si mesma é laço garantido, e o
   *   motor barraria na hora, mas só depois de o operador montar, salvar,
   *   ativar e esperar.
   * - `stop_automation` a MANTÉM: "cancele a minha própria espera pendente
   *   e comece a contar de novo" é legítimo, e some do seletor seria uma
   *   limitação que ninguém descobre. A execução em curso não se
   *   autocancela — o cron já a marcou `running`, e o passo só atinge
   *   `pending`.
   */
  automations: AutomationOption[]
  /** `undefined` numa automação nova — ela ainda não tem id. */
  automacaoAtualId?: string
  /** Robôs (fluxos) da conta, para `run_flow`. */
  flows: FlowOption[]
  /** Em que pé está a carga de cada lista acima — ver `CargaDasListas`. */
  carga: CargaDasListas
}

/**
 * ⚠️ Três estados, nunca dois. A lista vazia quer dizer três coisas: ainda
 * não chegou, chegou vazia ou a consulta falhou — e o seletor diz uma coisa
 * diferente em cada caso. Até aqui ela era só vazia, e todo seletor caía numa
 * caixa para DIGITAR o id: durante a carga o operador via "Cole o id" em vez
 * da lista, e numa falha a caixa convidava a colar um UUID que ele não tem
 * como achar ("escolher na lista, nunca digitar ID", pedido do operador).
 */
type EstadoDaLista = "carregando" | "pronto" | "falhou"

interface CargaDasListas {
  tags: EstadoDaLista
  customFields: EstadoDaLista
  /** Funis E etapas: os seletores precisam dos dois, e um sem o outro não escolhe nada. */
  pipelines: EstadoDaLista
  automations: EstadoDaLista
  flows: EstadoDaLista
  members: EstadoDaLista
  channels: EstadoDaLista
}

const CARGA_INICIAL: CargaDasListas = {
  tags: "carregando",
  customFields: "carregando",
  pipelines: "carregando",
  automations: "carregando",
  flows: "carregando",
  members: "carregando",
  channels: "carregando",
}

interface AutomationOption {
  id: string
  name: string
  is_active: boolean
  /** Para o aviso e o filtro da régua do Asaas, que o motor não aciona. */
  trigger_type: string
}

interface FlowOption {
  id: string
  name: string
  status: string
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
  reguaDoAsaas: false,
  tags: [],
  members: [],
  templates: [],
  customFields: [],
  pipelines: [],
  stages: [],
  channels: [],
  automations: [],
  flows: [],
  carga: CARGA_INICIAL,
})

function useResources(): AutomationResources {
  return useContext(ResourcesContext)
}

// ------------------------------------------------------------
// As MARCAS de pendência e de aviso nos cartões (29/09/2026).
//
// Nasceu do "Contrato fechado": ligar mostrava só um toast em inglês com um
// endereço ("at steps[0].no.steps[9].responsavel_user_id") que o operador não
// tinha como achar numa automação de dezenas de passos. Agora o passo com
// pendência fica em VERMELHO dizendo o que ajustar, e o que não impede ligar
// mas quebra em execução (acionar automação desligada) fica em ÂMBAR.
//
// Por contexto, e não por prop: os passos descem por StepList →
// StepRenderer → ConditionBranches → StepList, e cada nível espalharia a prop.
// A chave é o `cid` do passo — a marca segue o passo mesmo que ele mude de
// lugar (ver `pendencias.ts`).
// ------------------------------------------------------------

interface MarcasDosCartoes {
  /** O que impede ligar, por `cid` do passo. */
  pendencias: ReadonlyMap<string, ValidationIssue[]>
  /** O que não impede ligar, mas faz o passo falhar em execução. */
  avisos: ReadonlyMap<string, ValidationIssue[]>
}

const SEM_ISSUES: ValidationIssue[] = []
const SEM_MARCAS: MarcasDosCartoes = { pendencias: new Map(), avisos: new Map() }
const MarcasContext = createContext<MarcasDosCartoes>(SEM_MARCAS)

/**
 * A frase da pendência no idioma do app, pelo `codigo`. Sem código (as que já
 * nascem em português: canal, janela da Meta, condição por campo) ou com um
 * código que este bundle não conhece (deploy em curso), o `message` do
 * servidor — nunca a chave crua.
 */
function fraseDaPendencia(issue: ValidationIssue, t: ReturnType<typeof useTranslations>): string {
  const chave = chaveDaPendencia(issue)
  return chave ? t(chave) : issue.message
}

/** Os `cid` da árvore na ordem de leitura: o passo, o ramo SIM, o ramo NÃO. */
function cidsEmOrdem(steps: BuilderStep[]): string[] {
  return steps.flatMap((s) => [
    s.cid,
    ...(s.step_type === "condition" && s.branches
      ? [...cidsEmOrdem(s.branches.yes), ...cidsEmOrdem(s.branches.no)]
      : []),
  ])
}

/**
 * "Passo 10 · ramo NÃO da condição do passo 1" — o número na própria lista e,
 * subindo, cada ramo até a raiz.
 */
function descreverLocal(
  steps: BuilderStep[],
  passoCid: string,
  t: ReturnType<typeof useTranslations>,
): string | null {
  const local = localDoPasso(steps, passoCid)
  if (!local) return null
  const partes = [t("pendencias.passo", { numero: local.numero })]
  for (let k = local.cadeia.length - 1; k >= 1; k--) {
    const numero = local.cadeia[k - 1].numero
    partes.push(
      local.cadeia[k].ramo === "yes"
        ? t("pendencias.ramoSim", { numero })
        : t("pendencias.ramoNao", { numero }),
    )
  }
  return partes.join(" · ")
}

/** Uma linha do painel: onde, o que ajustar, e para onde o clique leva. */
interface LinhaDoPainel {
  local: string
  frase: string
  ir: { tipo: "passo"; cid: string } | { tipo: "gatilho" } | null
}

/**
 * As linhas do painel, na ordem de leitura da tela: o gatilho, os passos de
 * cima para baixo, e as da automação inteira (sem passo, sem link). Pendência
 * de passo que não está mais na árvore (apagado depois da recusa do servidor)
 * não vira linha — não há o que ajustar nele.
 */
function linhasDoPainel(
  steps: BuilderStep[],
  loc: PendenciasLocalizadas,
  t: ReturnType<typeof useTranslations>,
): LinhaDoPainel[] {
  const linhas: LinhaDoPainel[] = loc.doGatilho.map((issue) => ({
    local: t("pendencias.gatilho"),
    frase: fraseDaPendencia(issue, t),
    ir: { tipo: "gatilho" },
  }))
  for (const passoCid of cidsEmOrdem(steps)) {
    const doPasso = loc.porPasso.get(passoCid)
    const local = doPasso ? descreverLocal(steps, passoCid, t) : null
    if (!doPasso || !local) continue
    for (const issue of doPasso) {
      linhas.push({ local, frase: fraseDaPendencia(issue, t), ir: { tipo: "passo", cid: passoCid } })
    }
  }
  for (const issue of loc.gerais) {
    linhas.push({ local: t("pendencias.automacao"), frase: fraseDaPendencia(issue, t), ir: null })
  }
  return linhas
}

/** Quantas pendências a localização tem, somando passos, gatilho e gerais. */
function totalDePendencias(loc: PendenciasLocalizadas): number {
  let total = loc.doGatilho.length + loc.gerais.length
  for (const lista of loc.porPasso.values()) total += lista.length
  return total
}

/** O que o servidor devolveu no 400, lido campo a campo — corpo estranho vira lista vazia. */
function issuesDaResposta(body: unknown): ValidationIssue[] {
  const lista = (body as { issues?: unknown } | null)?.issues
  if (!Array.isArray(lista)) return []
  return lista.flatMap((i): ValidationIssue[] => {
    if (!i || typeof i !== "object") return []
    const { path, message, codigo } = i as Record<string, unknown>
    if (typeof path !== "string" || typeof message !== "string") return []
    return [{ path, message, ...(typeof codigo === "string" ? { codigo } : {}) }]
  })
}

/**
 * Carrega as listas da conta que os seletores usam. Era um componente-provedor
 * montado dentro do canvas; virou hook do construtor (29/09/2026) porque o
 * SALVAR — que mora no cabeçalho, fora do canvas — precisa das MESMAS listas
 * para conferir as pendências antes de ligar (`conferirParaLigar`) e marcar
 * os avisos, sem uma segunda busca. O construtor põe o resultado no
 * `ResourcesContext`, junto com `reguaDoAsaas` (que depende do gatilho em
 * edição, e por isso não sai daqui).
 *
 * `automacaoAtualId`: `undefined` numa automação nova — ela ainda não tem id
 * para se excluir.
 */
function useRecursosDaAutomacao(
  automacaoAtualId: string | undefined,
): Omit<AutomationResources, "reguaDoAsaas"> {
  const [tags, setTags] = useState<TagRecord[]>([])
  const [members, setMembers] = useState<AccountMember[]>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [customFields, setCustomFields] = useState<CustomField[]>([])
  const [pipelines, setPipelines] = useState<PipelineOption[]>([])
  const [stages, setStages] = useState<PipelineStageOption[]>([])
  const [automations, setAutomations] = useState<AutomationOption[]>([])
  const [flows, setFlows] = useState<FlowOption[]>([])
  // Os canais têm a carga no próprio hook; o resto sai daqui.
  const [carga, setCarga] = useState<Omit<CargaDasListas, "channels">>(CARGA_INICIAL)
  // Aqui, na raiz do construtor, e não dentro do StepEditor: aquele monta uma
  // vez por passo aberto, e cada montagem seria um GET novo.
  const { channels, loading: canaisCarregando, falhou: canaisFalharam } = useChannels()
  const cargaDosCanais: EstadoDaLista = canaisCarregando
    ? "carregando"
    : canaisFalharam
      ? "falhou"
      : "pronto"

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    // Tags, templates and custom fields come straight from the DB — RLS
    // scopes them to the caller's account. Only APPROVED templates can
    // actually be sent (anything else 400s at send time), matching the
    // broadcast picker.
    void (async () => {
      // ⚠️ O erro de cada consulta agora CONTA (antes era jogado fora e a
      // lista virava vazia): é ele que separa "a conta não tem etiqueta" de
      // "não consegui perguntar". O supabase-js devolve `error` em vez de
      // lançar; o `catch` é para o que escapa mesmo assim (rede).
      try {
        const [
          tagsRes,
          templatesRes,
          customFieldsRes,
          pipelinesRes,
          stagesRes,
          automationsRes,
          flowsRes,
        ] = await Promise.all([
          supabase.from("tags").select("*").order("name"),
          supabase
            .from("message_templates")
            .select("*")
            .eq("status", "APPROVED")
            .order("name"),
          supabase
            .from("custom_fields")
            .select("*")
            // ⚠️ Alfabética: lista PLANA. `posicao` é a ordem DENTRO do bloco
            // (966) e reinicia em cada um — ordenar a conta inteira por ela
            // intercala os blocos. Só quem REAGRUPA pode usá-la.
            .order("field_name"),
          supabase.from("pipelines").select("id, name").order("name"),
          supabase
            .from("pipeline_stages")
            .select("id, name, pipeline_id, position")
            .order("position"),
          // Orquestração (936). Traz INATIVAS também: o motor recusa acionar
          // automação desligada, e a tela precisa poder dizer isso ao operador
          // — some da lista seria pior, porque ele procuraria a automação que
          // sabe que existe e concluiria que a feature está quebrada.
          supabase.from("automations").select("id, name, is_active, trigger_type").order("name"),
          supabase.from("flows").select("id, name, status").order("name"),
        ])
        if (cancelled) return
        setTags((tagsRes.data as TagRecord[] | null) ?? [])
        setTemplates((templatesRes.data as MessageTemplate[] | null) ?? [])
        setCustomFields((customFieldsRes.data as CustomField[] | null) ?? [])
        setPipelines((pipelinesRes.data as PipelineOption[] | null) ?? [])
        setStages((stagesRes.data as PipelineStageOption[] | null) ?? [])
        setAutomations((automationsRes.data as AutomationOption[] | null) ?? [])
        setFlows((flowsRes.data as FlowOption[] | null) ?? [])
        const estado = (...rs: { error: unknown }[]): EstadoDaLista =>
          rs.some((r) => r.error) ? "falhou" : "pronto"
        setCarga((c) => ({
          ...c,
          tags: estado(tagsRes),
          customFields: estado(customFieldsRes),
          pipelines: estado(pipelinesRes, stagesRes),
          automations: estado(automationsRes),
          flows: estado(flowsRes),
        }))
      } catch {
        if (cancelled) return
        setCarga((c) => ({
          ...c,
          tags: "falhou",
          customFields: "falhou",
          pipelines: "falhou",
          automations: "falhou",
          flows: "falhou",
        }))
      }
    })()

    // Members go through the API so we inherit its email-visibility
    // rules (agents/viewers don't see emails). Falha (rede, não-200) vira
    // `falhou` — nunca a caixa de digitar o id do atendente que existia aqui.
    void (async () => {
      let resultado: { members: AccountMember[]; estado: EstadoDaLista }
      try {
        const res = await fetch("/api/account/members", { cache: "no-store" })
        if (!res.ok) {
          resultado = { members: [], estado: "falhou" }
        } else {
          const json = (await res.json()) as { members?: AccountMember[] }
          resultado = { members: json.members ?? [], estado: "pronto" }
        }
      } catch {
        resultado = { members: [], estado: "falhou" }
      }
      if (cancelled) return
      setMembers(resultado.members)
      setCarga((c) => ({ ...c, members: resultado.estado }))
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return {
    tags,
    members,
    templates,
    customFields,
    pipelines,
    stages,
    channels,
    automations,
    automacaoAtualId,
    flows,
    carga: { ...carga, channels: cargaDosCanais },
  }
}

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"

/**
 * O que um seletor mostra quando a lista dele NÃO tem o que escolher: ainda
 * carregando, a conta não tem nenhum item, ou a consulta falhou. ⚠️ Nunca
 * uma caixa para digitar o id (era o que havia aqui), e nunca um
 * `onChange`: o valor já gravado no passo fica intacto até o operador
 * escolher outro — a tela não reescreve config por abrir.
 */
function ListaSemEscolha({
  estado,
  vazio,
  t,
}: {
  estado: EstadoDaLista
  /** O texto da lista que CHEGOU vazia ("Nenhuma etiqueta cadastrada"). */
  vazio: string
  t: ReturnType<typeof useTranslations>
}) {
  if (estado === "falhou") {
    return <p className="text-xs text-destructive">{t("listas.falhou")}</p>
  }
  return (
    <select disabled className={cn(SELECT_CLASS, "cursor-not-allowed opacity-70")}>
      <option>{estado === "carregando" ? t("listas.carregando") : vazio}</option>
    </select>
  )
}

/** Tag dropdown by name + color, storing the tag's id. Sem etiqueta para
 *  escolher, `ListaSemEscolha`. */
function TagSelect({
  value,
  onChange,
  t,
}: {
  value: string
  onChange: (v: string) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { tags, carga } = useResources()
  if (tags.length === 0) {
    return <ListaSemEscolha estado={carga.tags} vazio={t("listas.semEtiquetas")} t={t} />
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
          <option value={value}>{t("tags.unknown")}</option>
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
  const { customFields, carga } = useResources()
  const customValue = value.startsWith("custom:") ? value : ""
  const knownCustom =
    customValue && customFields.some((f) => `custom:${f.id}` === customValue)
  return (
    <>
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
        {/* O campo gravado que a lista não traz: "apagado" só com a lista
            CARREGADA — durante a carga, ou com ela falhando, é só "o campo
            escolhido" (afirmar "apagado" ali seria mentira; o id, nunca). */}
        {customValue && !knownCustom && (
          <option value={customValue}>
            {carga.customFields === "pronto"
              ? t("fields.unknown")
              : t("config.campoDaFichaEscolhido")}
          </option>
        )}
      </select>
      {carga.customFields === "falhou" && (
        <p className="mt-1 text-xs text-destructive">{t("listas.falhou")}</p>
      )}
    </>
  )
}

/**
 * As colunas do contato que a condição "Campo do contato" sabe ler. ⚠️ É a
 * COLUNA da tabela, e não o seletor do "Atualizar campo" (`ContactFieldSelect`,
 * que oferece `custom:<id>`): o motor faz `contacts.select(operand)` e compara
 * o valor como texto, então um `custom:<id>` ali seria uma coluna que não
 * existe — condição sempre falsa, sem erro. Campo personalizado tem critério
 * próprio ("Campo personalizado da ficha").
 */
const COLUNAS_DO_CONTATO = ["name", "phone", "email", "company"] as const
type ColunaDoContato = (typeof COLUNAS_DO_CONTATO)[number]

function ehColunaDoContato(v: string): v is ColunaDoContato {
  return (COLUNAS_DO_CONTATO as readonly string[]).includes(v)
}

/** O rótulo de cada coluna. Chaves LITERAIS: chave montada escapa do portão de i18n. */
function rotuloDaColuna(coluna: ColunaDoContato, t: ReturnType<typeof useTranslations>): string {
  switch (coluna) {
    case "name":
      return t("fields.name")
    case "phone":
      return t("fields.phone")
    case "email":
      return t("fields.email")
    case "company":
      return t("fields.company")
  }
}

/** Parece um id (UUID)? Sobra de outro critério — nunca vai para a tela. */
const PARECE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function ColunaDoContatoSelect({
  value,
  onChange,
  t,
}: {
  value: string
  onChange: (v: string) => void
  t: ReturnType<typeof useTranslations>
}) {
  // Coluna gravada fora da lista (a caixa de texto antiga aceitava qualquer
  // coisa): vira uma opção PRESERVADA e rotulada, nunca some — sumir faria o
  // primeiro clique trocá-la sem o operador ver o que havia.
  const antiga = !!value && !ehColunaDoContato(value)
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={SELECT_CLASS}>
      <option value="">{t("fields.escolhaColuna")}</option>
      {COLUNAS_DO_CONTATO.map((c) => (
        <option key={c} value={c}>
          {rotuloDaColuna(c, t)}
        </option>
      ))}
      {antiga && (
        <option value={value}>
          {PARECE_UUID.test(value) ? t("fields.unknown") : t("fields.colunaAntiga", { coluna: value })}
        </option>
      )}
    </select>
  )
}

/** Agent dropdown by name, storing the member's user_id. Sem membro para
 *  escolher, `ListaSemEscolha`. */
function AgentSelect({
  value,
  onChange,
  t,
}: {
  value: string
  onChange: (v: string) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { members, carga } = useResources()
  if (members.length === 0) {
    return <ListaSemEscolha estado={carga.members} vazio={t("listas.semAtendentes")} t={t} />
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
          {/* Sem nome nem e-mail (o e-mail só aparece para admin), um rótulo —
              nunca o id do login. */}
          {m.full_name || m.email || t("agents.semNome")}
        </option>
      ))}
      {value && !selected && (
        <option value={value}>{t("agents.unknown")}</option>
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
  const { pipelines, stages, carga } = useResources()

  if (pipelines.length === 0) {
    return (
      <FieldBlock label={t("pipelines.pipelineLabel")}>
        <ListaSemEscolha estado={carga.pipelines} vazio={t("listas.semFunis")} t={t} />
      </FieldBlock>
    )
  }

  const selectedPipeline = pipelines.find((p) => p.id === pipelineId)
  const stageOptions = stages.filter((s) => s.pipeline_id === pipelineId)
  const selectedStage = stageOptions.find((s) => s.id === stageId)
  // Funis e etapas chegam em DUAS consultas com um estado só: a de etapas pode
  // falhar com a de funis de pé. "Apagado" só com as duas carregadas — antes
  // disso o item só não chegou, e o card diria "Etapa apagada" sobre etapa viva.
  const listasProntas = carga.pipelines === "pronto"

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
            <option value={pipelineId}>
              {listasProntas ? t("pipelines.unknownPipeline") : t("listas.carregando")}
            </option>
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
            <option value={stageId}>
              {listasProntas ? t("pipelines.unknownStage") : t("listas.carregando")}
            </option>
          )}
        </select>
        {carga.pipelines === "falhou" && (
          <p className="mt-1 text-xs text-destructive">{t("listas.falhou")}</p>
        )}
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
  onChange: (patch: Record<string, unknown>) => void
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
          // ⚠️ Trocar de modelo LIMPA os valores: as posições do anterior não
          // dizem nada sobre o novo, e um `{{3}}` vazio que sobrasse faria o
          // envio falhar por uma variável que ninguém vê na tela.
          onChange({ template_name: name ?? "", language: lang ?? "", ...VALORES_DO_MODELO_LIMPOS })
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

/** O que `ValoresDoModelo` grava, zerado — a troca de modelo recomeça daqui. */
const VALORES_DO_MODELO_LIMPOS = {
  variables: {},
  variaveis_reserva: {},
  header_text: "",
  header_text_reserva: "",
  header_media_url: "",
  button_params: {},
}

/**
 * Os valores do modelo escolhido (Fase 2.3 do plano do previdenciário): um
 * campo por `{{N}}` do corpo, com o texto de reserva ao lado; o `{{1}}` de um
 * cabeçalho de texto; o arquivo de um cabeçalho de mídia; o final do endereço
 * de um botão de URL com `{{1}}`. Só o que o modelo PEDE aparece — é a linha
 * do modelo que diz quantas variáveis há.
 *
 * ⚠️ A RESERVA é o que impede o envio de falhar: a Meta recusa parâmetro
 * vazio, e `{{contact.name}}` sai vazio para contato sem nome. O motor usa a
 * reserva quando o valor sai vazio, e falha com o motivo quando os dois saem.
 */
function ValoresDoModelo({
  modelo,
  cfg,
  set,
  t,
}: {
  modelo: MessageTemplate
  cfg: Record<string, unknown>
  set: (patch: Record<string, unknown>) => void
  t: ReturnType<typeof useTranslations>
}) {
  const valores = (cfg.variables as Record<string, string> | undefined) ?? {}
  const reservas = (cfg.variaveis_reserva as Record<string, string> | undefined) ?? {}
  const botoes = (cfg.button_params as Record<string, string> | undefined) ?? {}
  const doCorpo = extractVariableIndices(modelo.body_text ?? "")
  const cabecalhoDeTexto =
    modelo.header_type === "text" &&
    extractVariableIndices(modelo.header_content ?? "").length > 0
  const cabecalhoDeMidia =
    modelo.header_type === "image" ||
    modelo.header_type === "video" ||
    modelo.header_type === "document"
  const botoesComVariavel = (modelo.buttons ?? [])
    .map((b, i) => ({ b, i }))
    .filter(
      (x): x is { b: Extract<typeof x.b, { type: "URL" }>; i: number } =>
        x.b.type === "URL" && extractVariableIndices(x.b.url).length > 0,
    )
  const temVariavel = doCorpo.length > 0 || cabecalhoDeTexto || botoesComVariavel.length > 0

  return (
    <>
      {cabecalhoDeMidia && (
        <FieldBlock
          label={
            modelo.header_type === "image"
              ? t("templates.arquivoImagemLabel")
              : modelo.header_type === "video"
                ? t("templates.arquivoVideoLabel")
                : t("templates.arquivoDocumentoLabel")
          }
        >
          <Input
            value={(cfg.header_media_url as string) ?? ""}
            onChange={(e) => set({ header_media_url: e.target.value })}
            placeholder="https://…"
            className="bg-muted text-foreground"
          />
          {/* Sem arquivo guardado no modelo e sem endereço aqui, o envio
              falha — o aviso fica âmbar enquanto for o caso. */}
          {modelo.header_media_url || (cfg.header_media_url as string)?.trim() ? (
            <p className="mt-1 text-[11px] text-muted-foreground">{t("templates.arquivoDoModeloHint")}</p>
          ) : (
            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
              {t("templates.semArquivoNoModelo")}
            </p>
          )}
        </FieldBlock>
      )}
      {cabecalhoDeTexto && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <FieldBlock label={t("templates.cabecalhoLabel")}>
              <Input
                value={(cfg.header_text as string) ?? ""}
                onChange={(e) => set({ header_text: e.target.value })}
                className="bg-muted text-foreground"
              />
            </FieldBlock>
            <FieldBlock label={t("templates.reservaLabel")}>
              <Input
                value={(cfg.header_text_reserva as string) ?? ""}
                onChange={(e) => set({ header_text_reserva: e.target.value })}
                placeholder={t("templates.reservaPlaceholder")}
                className="bg-muted text-foreground"
              />
            </FieldBlock>
          </div>
          {vazio(cfg.header_text) && vazio(cfg.header_text_reserva) && (
            <p className="-mt-1 mb-2 text-[11px] text-amber-700 dark:text-amber-300">
              {t("templates.semValor")}
            </p>
          )}
        </>
      )}
      <FieldBlock label={t("templates.corpoLabel")}>
        <p className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted/50 p-2 text-[11px] text-muted-foreground">
          {modelo.body_text}
        </p>
      </FieldBlock>
      {doCorpo.map((n) => (
        <div key={n}>
          <div className="grid grid-cols-2 gap-2">
            <FieldBlock label={t("templates.variavelLabel", { marca: `{{${n}}}` })}>
              <Input
                value={valores[String(n)] ?? ""}
                onChange={(e) => set({ variables: { ...valores, [String(n)]: e.target.value } })}
                className="bg-muted text-foreground"
              />
            </FieldBlock>
            <FieldBlock label={t("templates.reservaLabel")}>
              <Input
                value={reservas[String(n)] ?? ""}
                onChange={(e) =>
                  set({ variaveis_reserva: { ...reservas, [String(n)]: e.target.value } })
                }
                placeholder={t("templates.reservaPlaceholder")}
                className="bg-muted text-foreground"
              />
            </FieldBlock>
          </div>
          {/* Os dois vazios = TODA execução falha ("a variável {{N}} ficou
              vazia…"), e isso só apareceria no histórico. A tela sabe
              quantas variáveis o modelo tem; o servidor, não. */}
          {vazio(valores[String(n)]) && vazio(reservas[String(n)]) && (
            <p className="-mt-1 mb-2 text-[11px] text-amber-700 dark:text-amber-300">
              {t("templates.semValor")}
            </p>
          )}
        </div>
      ))}
      {botoesComVariavel.map(({ b, i }) => (
        <FieldBlock key={i} label={t("templates.botaoLabel", { texto: b.text })}>
          <Input
            value={botoes[String(i)] ?? ""}
            onChange={(e) => set({ button_params: { ...botoes, [String(i)]: e.target.value } })}
            className="bg-muted text-foreground"
          />
          <p className="mt-1 truncate text-[11px] text-muted-foreground" title={b.url}>
            {b.url}
          </p>
          {vazio(botoes[String(i)]) ? (
            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
              {t("templates.botaoSemValor")}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">{t("templates.botaoHint")}</p>
          )}
        </FieldBlock>
      ))}
      {temVariavel && (
        <>
          <p className="mt-1 text-[11px] text-muted-foreground">{t("templates.reservaHelp")}</p>
          <DicaDeVariaveis t={t} />
        </>
      )}
    </>
  )
}

/** Texto em branco (ou ausente) num campo do passo. */
function vazio(v: unknown): boolean {
  return typeof v !== "string" || !v.trim()
}

/**
 * Os valores GRAVADOS de um passo cujo modelo não está na lista de aprovados
 * (pausado, reprovado, apagado na Meta, ou a conta ainda não sincronizou). O
 * envio continua usando esses valores — `resolveTemplateRow` não filtra por
 * situação —, então escondê-los deixaria o operador sem ver o que vai sair
 * nem por que falhou. Só leitura: para editar, escolhe-se o modelo de novo.
 */
function ValoresGravadosSemModelo({
  cfg,
  t,
}: {
  cfg: Record<string, unknown>
  t: ReturnType<typeof useTranslations>
}) {
  const valores = (cfg.variables as Record<string, unknown> | undefined) ?? {}
  const reservas = (cfg.variaveis_reserva as Record<string, unknown> | undefined) ?? {}
  const botoes = (cfg.button_params as Record<string, unknown> | undefined) ?? {}
  const posicoes = [...new Set([...Object.keys(valores), ...Object.keys(reservas)])].sort(
    (a, b) => Number(a) - Number(b),
  )
  const linhas: { rotulo: string; valor: string }[] = []
  const comReserva = (valor: unknown, reserva: unknown) =>
    [String(valor ?? ""), vazio(reserva) ? "" : `(${t("templates.reservaLabel")}: ${String(reserva)})`]
      .filter(Boolean)
      .join(" ")
  for (const n of posicoes) {
    linhas.push({ rotulo: `{{${n}}}`, valor: comReserva(valores[n], reservas[n]) })
  }
  if (!vazio(cfg.header_text) || !vazio(cfg.header_text_reserva)) {
    linhas.push({
      rotulo: t("templates.cabecalhoLabel"),
      valor: comReserva(cfg.header_text, cfg.header_text_reserva),
    })
  }
  if (!vazio(cfg.header_media_url)) {
    linhas.push({ rotulo: t("templates.arquivoLabel"), valor: String(cfg.header_media_url) })
  }
  for (const [i, v] of Object.entries(botoes)) {
    linhas.push({ rotulo: t("templates.botaoNumero", { n: Number(i) + 1 }), valor: String(v ?? "") })
  }
  if (linhas.length === 0) return null
  return (
    <FieldBlock label={t("templates.valoresGravadosLabel")}>
      <p className="mb-1 text-[11px] text-amber-700 dark:text-amber-300">
        {t("templates.valoresSemModelo")}
      </p>
      <ul className="space-y-0.5 rounded-md border border-border bg-muted/50 p-2 text-[11px] text-muted-foreground">
        {linhas.map((l, k) => (
          <li key={k} className="break-words">
            <span className="font-medium text-foreground">{l.rotulo}</span> {l.valor}
          </li>
        ))}
      </ul>
    </FieldBlock>
  )
}

// ------------------------------------------------------------
// Main builder component
// ------------------------------------------------------------

export function AutomationBuilder({ initial }: { initial: BuilderInitial }) {
  const router = useRouter()
  const t = useTranslations("Automations.builder")
  // Aberto pela grade de automações do funil? Então o voltar devolve à grade
  // daquele funil; sem origem, à tela de Automações, como sempre. Ver
  // `lib/pipelines/url.ts`.
  const origem = origemDoConstrutor(useSearchParams())
  const isEditing = !!initial.id
  const [state, setState] = useState<BuilderInitial>(() =>
    // O mesmo semear do onTypeChange, para a automação JÁ EXISTENTE aberta
    // com a config incompleta (gravada na época dos defaults só-de-tela):
    // sem isto, a tela mostraria 24h/"antes" sobre uma config sem nada, e o
    // salvar recusaria com "direção inválida" contradizendo o que se vê.
    initial.trigger_type === "date_field_offset"
      ? { ...initial, trigger_config: semearLembrete(initial.trigger_config) }
      : ehGatilhoDaRegua(initial.trigger_type)
        ? { ...initial, trigger_config: semearRegua(initial.trigger_type, initial.trigger_config) }
        : initial,
  )
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // O cartão do gatilho abre por aqui, e não por estado próprio: o painel de
  // pendências precisa abri-lo ao apontar uma pendência do gatilho.
  const [gatilhoAberto, setGatilhoAberto] = useState(false)
  const recursosCarregados = useRecursosDaAutomacao(initial.id)
  const { accountId } = useAuth()

  // --- Pendências para LIGAR (29/09/2026) ---
  //
  // Decisão do operador: o vermelho aparece AO TENTAR LIGAR (salvar com a
  // automação ativa), nunca enquanto ele monta um rascunho desligado; depois
  // disso, se apaga sozinho conforme ele corrige. Por isso a conferência roda
  // AO VIVO só com `tentouLigar` — da tentativa recusada até a próxima que der
  // certo — e com a automação ativa. Desligar o "Ativa" apaga tudo.
  const [tentouLigar, setTentouLigar] = useState(false)
  // O que o SERVIDOR recusou na última tentativa, já localizado nos passos
  // (pelo `cid`, contra a árvore que foi no pedido). Só aparece quando a
  // conferência da tela não acha nada: é a divergência (uma validação que só
  // a rota faz), e fica até a próxima tentativa.
  const [recusaDoServidor, setRecusaDoServidor] = useState<PendenciasLocalizadas | null>(null)
  // Os avisos em âmbar (não impedem ligar) aparecem a partir da primeira
  // tentativa de salvar LIGADA — inclusive a que deu certo: é o caso do
  // "Contrato fechado", que liga com um passo acionando uma automação
  // desligada, e o aviso para o n8n logo depois dele nunca sairia.
  const [mostrarAvisos, setMostrarAvisos] = useState(false)
  // Para onde rolar depois do próximo render (o passo recém-aberto, o
  // gatilho, o painel). Num efeito, e não no clique: abrir um passo FECHA o
  // que estava aberto, e se ele estava acima, o alvo sobe depois do render.
  const [rolarPara, setRolarPara] = useState<{ seletor: string } | null>(null)
  useEffect(() => {
    if (!rolarPara) return
    document.querySelector(rolarPara.seletor)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [rolarPara])

  const { channels, customFields, automations, flows, carga } = recursosCarregados
  // `null` = a lista não carregou (ou falhou): aquela conferência é pulada, e
  // quem responde é o servidor — nunca "a conta não tem canal" sobre lista
  // vazia durante a carga.
  const canaisParaConferir = useMemo(
    () =>
      carga.channels === "pronto"
        ? channels.map((c) => ({ id: c.id, label: c.label, kind: c.kind }))
        : null,
    [carga.channels, channels],
  )
  const camposDaConta = useMemo(
    () => (carga.customFields === "pronto" ? camposParaConferir(customFields, accountId) : null),
    [carga.customFields, customFields, accountId],
  )
  // As automações e robôs que os passos acionam, para os avisos. A própria
  // automação entra com o "Ativa" da TELA, não o do banco: ligá-la agora não
  // pode gerar "a automação acionada está desligada" sobre ela mesma (o
  // seletor não a oferece; só um passo antigo a aponta, e o motor recusa o
  // laço de qualquer jeito).
  const referenciasDosPassos = useMemo(
    () => ({
      automacoes:
        carga.automations === "pronto"
          ? automations.map((a) => (a.id === initial.id ? { ...a, is_active: state.is_active } : a))
          : null,
      robos: carga.flows === "pronto" ? flows : null,
    }),
    [carga.automations, automations, initial.id, state.is_active, carga.flows, flows],
  )

  const vermelhoLigado = state.is_active && tentouLigar
  const pendenciasAoVivo = useMemo(
    () =>
      vermelhoLigado
        ? localizarPendencias(
            state.steps,
            conferirParaLigar({
              triggerType: state.trigger_type,
              triggerConfig: state.trigger_config,
              channelIds: state.channel_ids,
              steps: toApiSteps(state.steps),
              canais: canaisParaConferir,
              campos: camposDaConta,
            }),
          )
        : null,
    [
      vermelhoLigado,
      state.steps,
      state.trigger_type,
      state.trigger_config,
      state.channel_ids,
      canaisParaConferir,
      camposDaConta,
    ],
  )
  const pendencias =
    pendenciasAoVivo && totalDePendencias(pendenciasAoVivo) === 0 && recusaDoServidor
      ? recusaDoServidor
      : pendenciasAoVivo
  const avisos = useMemo(
    () =>
      state.is_active && mostrarAvisos
        ? localizarPendencias(state.steps, avisosDaAutomacao(state.steps, referenciasDosPassos))
        : null,
    [state.is_active, mostrarAvisos, state.steps, referenciasDosPassos],
  )
  const marcas = useMemo<MarcasDosCartoes>(
    () => ({
      pendencias: pendencias?.porPasso ?? SEM_MARCAS.pendencias,
      avisos: avisos?.porPasso ?? SEM_MARCAS.avisos,
    }),
    [pendencias, avisos],
  )

  function irParaPasso(passoCid: string) {
    setExpandedId(passoCid)
    setRolarPara({ seletor: `[data-passo-cid="${CSS.escape(passoCid)}"]` })
  }

  function irParaGatilho() {
    setGatilhoAberto(true)
    setRolarPara({ seletor: "[data-cartao-do-gatilho]" })
  }

  /**
   * A recusa de ligar: o toast em português e o PRIMEIRO passo com pendência
   * (na ordem de leitura) aberto e à vista; sem passo, o gatilho; sem gatilho,
   * o painel.
   */
  function apontarPendencias(loc: PendenciasLocalizadas, passos: BuilderStep[], total: number) {
    toast.error(t("pendencias.toast", { count: total }))
    const primeiro = cidsEmOrdem(passos).find((c) => loc.porPasso.has(c))
    if (primeiro) irParaPasso(primeiro)
    else if (loc.doGatilho.length > 0) irParaGatilho()
    else setRolarPara({ seletor: "[data-painel-de-pendencias]" })
  }

  const { areas, falhou: areasFalharam } = useAreasDeAutomacao()
  // Quem escolheu a aba à mão não é atropelado pela sugestão do funil.
  const areaEscolhidaRef = useRef(false)
  const funilDeOrigem = origem?.funil ?? null
  const [sugestaoResolvida, setSugestaoResolvida] = useState(false)
  // Enquanto a sugestão do funil não chega, o Salvar espera: salvar antes
  // gravaria a automação em "Geral" para sempre (Codex, PR #325). Leitura das
  // abas que falhou, ou conta sem aba, não tem o que esperar.
  const aguardandoSugestao =
    !isEditing &&
    !!funilDeOrigem &&
    !areasFalharam &&
    (areas === null || (areas.length > 0 && !sugestaoResolvida))

  // Automação NOVA criada pela aba Automações de um funil: nasce na aba cujo
  // nome o funil começa ("Bancário - Comercial" → aba "Bancário"). Só
  // sugere — o seletor está à vista no cabeçalho, e sem aba que case ela
  // fica em "Geral".
  useEffect(() => {
    if (isEditing || !funilDeOrigem || !areas || areas.length === 0) return
    let vivo = true
    createClient()
      .from("pipelines")
      .select("name")
      .eq("id", funilDeOrigem)
      .maybeSingle()
      .then(
        ({ data }) => {
          if (!vivo) return
          setSugestaoResolvida(true)
          if (areaEscolhidaRef.current) return
          const sugerida = areaDoFunil((data as { name?: string } | null)?.name, areas)
          if (sugerida) setState((s) => (s.area_id ? s : { ...s, area_id: sugerida }))
        },
        () => {
          if (vivo) setSugestaoResolvida(true)
        },
      )
    return () => {
      vivo = false
    }
  }, [isEditing, funilDeOrigem, areas])

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
      id: idDePassoNovo(),
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
    // Ligar (29/09/2026): a tela confere ANTES as mesmas validações da rota.
    // Com pendência, nem chama o servidor — ele recusaria igual, e o operador
    // ficaria com um toast no lugar do passo marcado.
    if (state.is_active) {
      setMostrarAvisos(true)
      const issues = conferirParaLigar({
        triggerType: state.trigger_type,
        triggerConfig: state.trigger_config,
        channelIds: state.channel_ids,
        steps: toApiSteps(state.steps),
        canais: canaisParaConferir,
        campos: camposDaConta,
      })
      if (issues.length > 0) {
        setTentouLigar(true)
        // A última tentativa não chegou ao servidor: a recusa dele é velha.
        setRecusaDoServidor(null)
        apontarPendencias(localizarPendencias(state.steps, issues), state.steps, issues.length)
        return
      }
    }
    // A árvore que VAI no pedido: o `path` das pendências do servidor é
    // posicional, e é contra ela que se localiza — o operador pode mexer na
    // tela enquanto o pedido está no ar.
    const passosEnviados = state.steps
    setSaving(true)
    try {
      const payload = {
        name: state.name || t("untitled"),
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
        assinatura_personalizada: state.assinatura_personalizada?.trim() || null,
        area_id: state.area_id ?? null,
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
        // O servidor recusou ligar com pendências que a tela não viu (uma
        // validação que só a rota faz, ou uma lista que a tela não tinha
        // carregado): o mesmo tratamento, com as pendências DELE.
        const issues = issuesDaResposta(body)
        if (issues.length > 0) {
          const loc = localizarPendencias(passosEnviados, issues)
          setTentouLigar(true)
          setRecusaDoServidor(loc)
          apontarPendencias(loc, passosEnviados, issues.length)
        } else {
          toast.error(body?.error ?? t("toasts.saveFailed"))
        }
        return
      }
      // Deu certo: nada mais a marcar em vermelho — a próxima marca só volta
      // numa nova tentativa de ligar. Os avisos em âmbar ficam (ver acima).
      setTentouLigar(false)
      setRecusaDoServidor(null)
      const qtdDeAvisos = payload.is_active
        ? avisosDaAutomacao(passosEnviados, referenciasDosPassos).length
        : 0
      if (qtdDeAvisos > 0) toast.warning(t("pendencias.avisosToast", { count: qtdDeAvisos }))
      else toast.success(isEditing ? t("toasts.saved") : t("toasts.created"))
      if (!isEditing && body?.automation?.id) {
        // ⚠️ A origem viaja junto: criar pela coluna do funil, salvar o
        // rascunho e SÓ ENTÃO voltar é o caminho mais comum, e sem ela o
        // voltar desta tela de edição caía na tela de Automações.
        router.replace(urlDoConstrutor({ id: body.automation.id, origem }))
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
      <header className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card/80 px-3 py-3 sm:flex-nowrap sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={() => router.push(voltaDoConstrutor(origem))}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={origem ? t("backToPipeline") : t("backToAutomations")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <input
          value={state.name}
          onChange={(e) => patchTop("name", e.target.value)}
          placeholder={t("untitled")}
          className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:bg-muted focus:outline-none sm:text-base"
        />
        {/* A aba da tela de Automações (1055). Só com as abas lidas: antes
            disso a opção gravada não existiria na lista, e o seletor
            mostraria "Geral" sobre uma automação que está em outra aba. */}
        {areas && areas.length > 0 && (
          <select
            value={state.area_id ?? ""}
            onChange={(e) => {
              areaEscolhidaRef.current = true
              patchTop("area_id", e.target.value || null)
            }}
            aria-label={t("area.label")}
            title={t("area.label")}
            // No celular desce para a própria linha (o cabeçalho quebra), senão
            // aperta o nome e empurra o Salvar para fora da tela.
            className="order-last w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground sm:order-none sm:w-auto sm:max-w-[10rem] sm:shrink-0"
          >
            <option value="">{t("area.geral")}</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden sm:inline">{t("active")}</span>
          <Switch
            checked={state.is_active}
            onCheckedChange={(v) => {
              patchTop("is_active", !!v)
              // Desligada, a automação volta a ser rascunho, que pode ficar
              // incompleto: some o vermelho e o âmbar, e eles só voltam na
              // próxima tentativa de salvar LIGADA.
              if (!v) {
                setTentouLigar(false)
                setRecusaDoServidor(null)
                setMostrarAvisos(false)
              }
            }}
            aria-label={t("activeAria")}
          />
        </div>
        <Button
          onClick={save}
          disabled={saving || aguardandoSugestao}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving || aguardandoSugestao ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isEditing ? t("save") : t("saveDraft")}
        </Button>
      </header>

      {/* Canvas */}
      <div className="relative flex-1 overflow-y-auto">
        <div className="absolute inset-0 bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:20px_20px] pointer-events-none" />
        <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-0 px-4 py-10">
          <ResourcesContext.Provider
            value={{ ...recursosCarregados, reguaDoAsaas: ehGatilhoDaRegua(state.trigger_type) }}
          >
            <MarcasContext.Provider value={marcas}>
              <PainelDePendencias
                steps={state.steps}
                pendencias={pendencias}
                avisos={avisos}
                onIrParaPasso={irParaPasso}
                onIrParaGatilho={irParaGatilho}
                t={t}
              />
              {/* Com o vermelho ligado, os avisos de canal já estão no painel
                  acima (a conferência de ligar roda a mesma função) — mostrá-los
                  aqui também seria a mesma frase duas vezes. */}
              {!vermelhoLigado && <AvisosDeCanal steps={state.steps} channelIds={state.channel_ids} />}
              <TriggerCard
                aberto={gatilhoAberto}
                onAbertoChange={setGatilhoAberto}
                pendencias={pendencias?.doGatilho ?? SEM_ISSUES}
                type={state.trigger_type}
                config={state.trigger_config}
                channelIds={state.channel_ids}
                stageIds={state.stage_ids}
                onTypeChange={(tVal) =>
                  setState((s) => ({
                    ...s,
                    trigger_type: tVal,
                    // ⚠️ O lembrete por data SEMEIA os defaults NA CONFIG, não
                    // só na tela — ver `semearLembrete`. Os inputs mostravam
                    // `?? 24` / `?? "antes"` sem gravar nada: digitar só os
                    // minutos salvava um lembrete de 30min-antes com a tela
                    // dizendo 24h30, e o formulário intocado era recusado na
                    // ativação por "direção inválida" — com "antes"
                    // selecionado na tela. O que se vê é o que se salva.
                    trigger_config:
                      tVal === "date_field_offset"
                        ? semearLembrete(s.trigger_config)
                        : ehGatilhoDaRegua(tVal)
                          ? semearRegua(tVal, s.trigger_config)
                          : s.trigger_config,
                    // A régua do Asaas (998) não tem recorte por etapa: esconder o
                    // seletor não limpa o valor gravado (a armadilha da grade do
                    // funil), e `stageInScope` barraria quem não tem card.
                    stage_ids: ehGatilhoDaRegua(tVal) ? [] : s.stage_ids,
                  }))
                }
                onConfigChange={(c) => patchTop("trigger_config", c)}
                onChannelIdsChange={(ids) => patchTop("channel_ids", ids)}
                onStageIdsChange={(ids) => patchTop("stage_ids", ids)}
                assinatura={state.assinatura_personalizada}
                onAssinaturaChange={(v) => patchTop("assinatura_personalizada", v)}
                t={t}
              />
              <StepList
                steps={state.steps}
                basePath={[]}
                scope={{ kind: "root" }}
                expandedId={expandedId}
                setExpandedId={setExpandedId}
                updateStep={updateStep}
                addStepAt={addStepAt}
                deleteStepAt={deleteStepAt}
                moveStepAt={moveStepAt}
              />
            </MarcasContext.Provider>
          </ResourcesContext.Provider>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Trigger card
// ------------------------------------------------------------

function TriggerCard({
  aberto: open,
  onAbertoChange,
  pendencias,
  type,
  config,
  channelIds,
  stageIds,
  onTypeChange,
  onConfigChange,
  onChannelIdsChange,
  onStageIdsChange,
  assinatura,
  onAssinaturaChange,
  t,
}: {
  /** Aberto/fechado mora no construtor: o painel de pendências o abre. */
  aberto: boolean
  onAbertoChange: (aberto: boolean) => void
  /** As pendências do GATILHO (`trigger.*`) — vazio quando não há o que marcar. */
  pendencias: ValidationIssue[]
  type: AutomationTriggerType
  config: Record<string, unknown>
  channelIds: string[]
  stageIds: string[]
  onTypeChange: (t: AutomationTriggerType) => void
  onConfigChange: (c: Record<string, unknown>) => void
  onChannelIdsChange: (ids: string[]) => void
  onStageIdsChange: (ids: string[]) => void
  assinatura: string | null
  onAssinaturaChange: (v: string | null) => void
  t: ReturnType<typeof useTranslations>
}) {
  const tCanais = useTranslations("Channels")
  // Do contexto, NÃO um `useChannels()` próprio. `useChannels` não tem cache
  // nem dedup: cada chamada é um GET /api/cb/channels por montagem, e este
  // card monta junto com o construtor, que já busca a mesma lista. Mesmo motivo
  // que levou os fluxos a buscarem uma vez só no editor.
  const { channels, customFields } = useResources()
  // Só campos de data: oferecer um campo de texto aqui faria a automação
  // nascer muda, procurando hora onde não há.
  const camposDeData = useMemo(
    () => customFields.filter((f) => f.field_type === TIPO_DATA),
    [customFields],
  )
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
    <div data-cartao-do-gatilho className="z-10 w-full max-w-[320px] scroll-mt-6 sm:w-80">
      <div
        className={cn(
          "rounded-lg border border-border border-l-4 bg-card shadow-lg",
          pendencias.length > 0 ? "border-destructive ring-2 ring-destructive/30" : "border-l-blue-500",
        )}
      >
        <button
          type="button"
          onClick={() => onAbertoChange(!open)}
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
        <MarcasNoCartao pendencias={pendencias} avisos={SEM_ISSUES} t={t} />
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
            {type !== "deal_stage_changed" && !ehGatilhoDaRegua(type) && (
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
                  {t("tags.label")}
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
                  // ⚠️ Escolher etapa NÃO semeia `parar_ao_sair`. A automação de
                  // etapa só NASCE pelo `?stage=` da grade do funil (este
                  // seletor não oferece o gatilho — ver TRIGGER_OPTIONS), e é
                  // lá que a semente mora. Aqui, quem mexe na lista de etapas
                  // é uma automação já gravada — e as existentes não mudam
                  // (decisão do operador): semear na edição ligaria a
                  // interrupção numa regra antiga por um simples re-pique de
                  // etapa. (Uma versão semeava; 8ª rodada.)
                  onChange={(ids) => onConfigChange({ ...config, stage_ids: ids })}
                  vazioLabel={t("stages.triggerHelpAll")}
                />
                {/* Automação PRESA À ETAPA (`so-na-etapa.ts`): o card saiu, o
                    que faltava não roda. ⚠️ Só com etapa nomeada — sem etapa
                    o gatilho vale para qualquer uma, e "sair da etapa" não tem
                    de onde; o motor ignora a chave nesse caso, e mostrar a
                    caixa seria oferecer um controle que não faz nada.
                    `=== true`, como o motor. */}
                {((config.stage_ids as string[] | undefined) ?? []).length > 0 && (
                  <label className="mt-2 flex items-start gap-2 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={config.parar_ao_sair === true}
                      onChange={(e) =>
                        onConfigChange({ ...config, parar_ao_sair: e.target.checked })
                      }
                      className="mt-0.5 size-4 accent-primary"
                    />
                    <span>
                      {t("stages.pararAoSairLabel")}
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {t("stages.pararAoSairHelp")}
                      </span>
                    </span>
                  </label>
                )}
              </div>
            )}
            {/* Lembrete por data (935): "24 horas ANTES da reunião". A hora vem
                de um campo do contato — ou, desde a 947, da própria agenda. */}
            {type === "date_field_offset" && (
              <div className="space-y-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    {t("lembrete.fonteLabel")}
                  </label>
                  {/* ⚠️ Ausente = "campo", nunca "reuniao": as automações que já
                      existem não têm o atributo, e tratá-las como agenda faria o
                      lembrete do Calendly parar de sair sem erro nenhum. */}
                  <select
                    value={(config.fonte as string) ?? "campo"}
                    onChange={(e) =>
                      onConfigChange({ ...config, fonte: e.target.value })
                    }
                    className={SELECT_CLASS}
                  >
                    <option value="campo">{t("lembrete.fonteCampo")}</option>
                    <option value="reuniao">{t("lembrete.fonteReuniao")}</option>
                  </select>
                </div>

                {/* O campo de data só existe na fonte "campo" — na agenda a
                    hora vem da própria reunião, e não há o que escolher. */}
                {(config.fonte ?? "campo") === "campo" && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    {t("lembrete.campoLabel")}
                  </label>
                  <select
                    value={(config.custom_field_id as string) ?? ""}
                    onChange={(e) =>
                      onConfigChange({ ...config, custom_field_id: e.target.value })
                    }
                    className={SELECT_CLASS}
                  >
                    <option value="">{t("lembrete.escolhaCampo")}</option>
                    {camposDeData.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.field_name}
                      </option>
                    ))}
                  </select>
                  {camposDeData.length === 0 && (
                    // Sem campo de data não há o que escolher, e o operador
                    // ficaria diante de um seletor vazio sem saber por quê.
                    <p className="mt-1 text-[11px] text-destructive">
                      {t("lembrete.semCampoDeData")}
                    </p>
                  )}
                </div>
                )}

                <div className="flex items-end gap-2">
                  <div className="w-20">
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      {t("lembrete.horasLabel")}
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={(config.offset_hours as number) ?? 24}
                      onChange={(e) =>
                        onConfigChange({
                          ...config,
                          offset_hours: Number(e.target.value),
                        })
                      }
                      className="bg-muted text-foreground"
                    />
                  </div>
                  <div className="w-20">
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      {t("lembrete.minutosLabel")}
                    </label>
                    <Input
                      type="number"
                      min={0}
                      max={59}
                      value={(config.offset_minutes as number) ?? 0}
                      onChange={(e) =>
                        onConfigChange({
                          ...config,
                          offset_minutes: Number(e.target.value),
                        })
                      }
                      className="bg-muted text-foreground"
                    />
                  </div>
                  <select
                    value={(config.direction as string) ?? "antes"}
                    onChange={(e) =>
                      onConfigChange({ ...config, direction: e.target.value })
                    }
                    className={cn(SELECT_CLASS, "flex-1")}
                  >
                    <option value="antes">{t("lembrete.antes")}</option>
                    <option value="depois">{t("lembrete.depois")}</option>
                  </select>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {t("lembrete.ajuda")}
                </p>
              </div>
            )}
            {/* Agendamento no Calendly (977): qual evento, e as variáveis que
                os passos podem usar. O select vem da API do Calendly pela
                conexão feita em Integrações. */}
            {type === "calendly_booking" && (
              <CalendlyTriggerConfig config={config} onChange={onConfigChange} />
            )}
            {/* A régua do Asaas (998): o marco, a hora, "só dia útil" e as
                variáveis da cobrança. Só roda pela varredura do cron. */}
            {(type === "asaas_cobranca_vencida" || type === "asaas_cobranca_vence_hoje") && (
              <AsaasTriggerConfig type={type} config={config} onChange={onConfigChange} />
            )}
            {/* Webhook de entrada (982): QUAL webhook dispara. As variáveis
                listadas saem do ÚLTIMO acionamento real — o payload é
                arbitrário, então não há lista fixa a mostrar. */}
            {type === "webhook_received" && (
              <WebhookTriggerConfig config={config} onChange={onConfigChange} />
            )}
            {/* Assinatura no ZapSign (1057): sem configuração — só as
                variáveis e o que o casamento faz com o card. */}
            {type === "zapsign_documento_assinado" && <ZapSignTriggerConfig />}
            {/* "Assinar como" (998, D18): o prefixo de todo `send_message`
                desta automação, sob o interruptor de assinatura da conta.
                Mora na automação (uma régua são 3–4 automações e a mesma
                pessoa assina todas), não no passo nem num catálogo. */}
            <div className="border-t border-border pt-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("assinatura.label")}</label>
              <input
                value={assinatura ?? ""}
                onChange={(e) => onAssinaturaChange(e.target.value === "" ? null : e.target.value)}
                placeholder={t("assinatura.placeholder")}
                maxLength={60}
                className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">{t("assinatura.ajuda")}</p>
            </div>
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
                  placeholder={t("schedulePlaceholder")}
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
          onChange={(e) =>
            onChange({
              ...config,
              match_type: e.target.value as "exact" | "contains" | "word",
            })
          }
          className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:outline-none"
        >
          <option value="contains">{t("config.matchContains")}</option>
          <option value="word">{t("config.matchWord")}</option>
          <option value="exact">{t("config.matchExact")}</option>
        </select>
        {/* Only worth explaining for `word` — "contains" and "exact" read
            for themselves, and this is the one that changes which messages
            fire an automation in a way that isn't obvious. */}
        {config?.match_type === "word" && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("config.matchWordHint")}
          </p>
        )}
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

interface StepListProps {
  steps: BuilderStep[]
  /**
   * Path of the step that owns this list — `[]` for the root canvas,
   * the condition's own path for a branch column. Combined with
   * `scope` by `childPath` to address each child.
   */
  basePath: StepPath
  /** Which bucket this list reads and writes. */
  scope: ParentScope
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  updateStep: (path: StepPath, updater: (s: BuilderStep) => BuilderStep) => void
  addStepAt: (parent: ParentScope, index: number, type: AutomationStepType) => void
  deleteStepAt: (path: StepPath) => void
  moveStepAt: (path: StepPath, direction: -1 | 1) => void
}

function StepList(props: StepListProps) {
  const { steps, basePath, scope, ...rest } = props

  return (
    <div className="flex w-full flex-col items-center">
      <AddButton onPick={(t) => props.addStepAt(scope, 0, t)} />
      {steps.map((step, idx) => (
        <StepRenderer
          key={step.cid}
          step={step}
          index={idx}
          total={steps.length}
          basePath={basePath}
          scope={scope}
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
  scope,
  basePath,
  ...props
}: {
  step: BuilderStep
  index: number
  total: number
  scope: ParentScope
  basePath: StepPath
} & Omit<StepListProps, "steps" | "basePath" | "scope">) {
  const t = useTranslations("Automations.builder")
  // As listas da conta: o resumo do passo fechado diz o alvo pelo NOME.
  const recursos = useResources()
  const marcas = useContext(MarcasContext)
  const pendenciasDoPasso = marcas.pendencias.get(step.cid) ?? SEM_ISSUES
  const avisosDoPasso = marcas.avisos.get(step.cid) ?? SEM_ISSUES
  const path = childPath(basePath, scope, index)
  const meta = STEP_META[step.step_type]
  const Icon = meta.icon
  const expanded = props.expandedId === step.cid
  const isCondition = step.step_type === "condition"
  // A espera pelo horário mostra a JANELA no cartão fechado, não o
  // `amount`/`unit` que ficou gravado e não vale nesse modo.
  const esperaPorHorario = step.step_type === "wait" && step.step_config.modo === "horario"
  const janelaDaEspera = esperaPorHorario ? rotuloDaJanela(step.step_config.janela) : null
  const nested = basePath.length > 0
  // Card widths on mobile fill the full canvas column (max-w-2xl px-4
  // still keeps them reasonable). On sm+ fixed widths come back so the
  // flow visual stays recognisable — but only at the top level: a
  // branch column is a fraction of its condition's width, so a 320px
  // card inside one overflowed its own column and dragged the editor's
  // controls out of reach (issue #474). Nested cards fill the column
  // they were given instead.
  //
  // A condition is wider than a plain step because it has to hold two
  // branch columns side by side; 600px (the canvas is max-w-2xl, i.e.
  // 640px of content) leaves each branch ~294px — near enough to the
  // 320px a step gets at the top level for the same editors to fit.
  const width = nested
    ? "w-full"
    : isCondition
      ? "w-full max-w-[600px] sm:w-[600px]"
      : "w-full max-w-[320px] sm:w-80"

  return (
    <>
      <div data-passo-cid={step.cid} className={cn("z-10 flex min-w-0 scroll-mt-6 flex-col", width)}>
        <div
          className={cn(
            "rounded-lg border border-border border-l-4 bg-card shadow-lg",
            // Pendência (impede ligar) troca a cor da faixa pelo vermelho em
            // volta do cartão inteiro; aviso (não impede) só ganha o anel
            // âmbar — a faixa âmbar à esquerda já é da condição.
            pendenciasDoPasso.length > 0
              ? "border-destructive ring-2 ring-destructive/30"
              : cn(meta.border, avisosDoPasso.length > 0 && "ring-2 ring-amber-500/50"),
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
                {isCondition ? t("kindCondition") : step.step_type === "wait" ? t("kindWait") : t("kindAction")}
              </div>
              <div className="truncate text-sm font-medium text-foreground">{t(`steps.${meta.label}`)}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {esperaPorHorario
                  ? t("config.esperaHorarioResumo", {
                      inicio: janelaDaEspera?.inicio ?? "?",
                      fim: janelaDaEspera?.fim ?? "?",
                    }) +
                    (step.step_config.somente_seg_a_sex === true ? ` · ${t("config.segASexResumo")}` : "")
                  : previewFor(step, t, recursos)}
                {/* Visível com o passo FECHADO: numa sequência de dez esperas,
                    é assim que se confere de relance quais param na resposta. */}
                {step.step_type === "wait" && step.step_config.parar_se_responder === true
                  ? ` · ${t("config.pararSeResponderResumo")}`
                  : ""}
              </div>
            </div>
            <ChevronDown
              className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")}
            />
          </button>
          {/* Mesmo com o passo FECHADO: numa automação de dezenas de passos,
              é a frase que diz o que ajustar sem precisar abrir um por um. */}
          <MarcasNoCartao pendencias={pendenciasDoPasso} avisos={avisosDoPasso} t={t} />
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
                    aria-label={t("moveUp")}
                    onClick={() => props.moveStepAt(path, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === total - 1}
                    aria-label={t("moveDown")}
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
          <ConditionBranches step={step} path={path} {...props} />
        )}
      </div>

      {/* A condition branches into Yes/No (rendered above by
          ConditionBranches), so it has no linear "continue" path — adding
          the trailing connector here would produce a spurious third output. */}
      {!isCondition && (
        <AddButton onPick={(t) => props.addStepAt(scope, index + 1, t)} />
      )}
    </>
  )
}

function ConditionBranches({
  step,
  path,
  ...props
}: {
  step: BuilderStep
  /** The condition's OWN path. Children hang off it, one marker each. */
  path: StepPath
} & Omit<StepListProps, "steps" | "basePath" | "scope">) {
  const t = useTranslations("Automations.builder")
  const yes = step.branches?.yes ?? []
  const no = step.branches?.no ?? []
  return (
    // Stack Yes/No vertically until THIS CARD is wide enough for two
    // columns. A viewport breakpoint can't tell: a condition nested in
    // a branch is a fraction of the screen, and `sm:grid-cols-2` split
    // it anyway, leaving two columns too narrow to render a step in.
    <div className="@container mt-3 w-full">
      <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2">
        <BranchColumn label={t("branches.yes")} color="text-primary">
          <StepList
            {...props}
            steps={yes}
            basePath={path}
            scope={{ kind: "branch", parentCid: step.cid, branch: "yes" }}
          />
        </BranchColumn>
        <BranchColumn label={t("branches.no")} color="text-rose-400">
          <StepList
            {...props}
            steps={no}
            basePath={path}
            scope={{ kind: "branch", parentCid: step.cid, branch: "no" }}
          />
        </BranchColumn>
      </div>
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
    <div className="flex min-w-0 flex-col items-center">
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
  const { pipelines, stages, carga } = useResources()
  const t = useTranslations("Automations.builder")
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
  // "Apagada" só com a lista CARREGADA: durante a carga (ou numa falha só da
  // consulta de etapas) a etapa gravada só não chegou.
  const orfaos =
    carga.pipelines === "pronto" ? value.filter((id) => !stages.some((s) => s.id === id)) : []

  // Sem etapa para escolher, o estado da carga — o seletor sumir durante a
  // carga fazia o gatilho parecer "sem etapa", e numa falha nada dizia por quê.
  if (porFunil.length === 0) {
    return <ListaSemEscolha estado={carga.pipelines} vazio={t("listas.semFunis")} t={t} />
  }

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
// Pendências e avisos NA TELA (29/09/2026) — ver `MarcasDosCartoes`.
//
// O painel no topo lista uma linha por pendência ("Passo 10 · ramo NÃO da
// condição do passo 1 — Escolha o responsável da tarefa"), e cada linha leva
// ao passo: abre e rola até ele. É o que resolve a automação grande, onde o
// cartão vermelho pode estar dezenas de passos abaixo da dobra.
// ------------------------------------------------------------

/** As frases dentro do cartão, visíveis com ele FECHADO. */
function MarcasNoCartao({
  pendencias,
  avisos,
  t,
}: {
  pendencias: ValidationIssue[]
  avisos: ValidationIssue[]
  t: ReturnType<typeof useTranslations>
}) {
  if (pendencias.length === 0 && avisos.length === 0) return null
  return (
    <ul
      className={cn(
        "space-y-1 border-t px-4 py-2",
        pendencias.length > 0 ? "border-destructive/30" : "border-amber-500/30",
      )}
    >
      {pendencias.map((issue, i) => (
        <li key={`p${i}`} className="flex items-start gap-1.5 text-[11px] leading-snug text-destructive">
          <CircleAlert className="mt-px h-3 w-3 flex-shrink-0" aria-hidden />
          <span>{fraseDaPendencia(issue, t)}</span>
        </li>
      ))}
      {avisos.map((issue, i) => (
        <li
          key={`a${i}`}
          className="flex items-start gap-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-300"
        >
          <TriangleAlert className="mt-px h-3 w-3 flex-shrink-0" aria-hidden />
          <span>{fraseDaPendencia(issue, t)}</span>
        </li>
      ))}
    </ul>
  )
}

function PainelDePendencias({
  steps,
  pendencias,
  avisos,
  onIrParaPasso,
  onIrParaGatilho,
  t,
}: {
  steps: BuilderStep[]
  /** `null` = nada a marcar em vermelho (ninguém tentou ligar, ou está desligada). */
  pendencias: PendenciasLocalizadas | null
  /** `null` = nada a marcar em âmbar. */
  avisos: PendenciasLocalizadas | null
  onIrParaPasso: (passoCid: string) => void
  onIrParaGatilho: () => void
  t: ReturnType<typeof useTranslations>
}) {
  const linhasPendentes = pendencias ? linhasDoPainel(steps, pendencias, t) : []
  const linhasDeAviso = avisos ? linhasDoPainel(steps, avisos, t) : []
  if (linhasPendentes.length === 0 && linhasDeAviso.length === 0) return null

  const linha = (l: LinhaDoPainel, i: number, cor: string) => {
    const texto = (
      <>
        <span className="font-semibold">{l.local}</span> — {l.frase}
      </>
    )
    const ir = l.ir
    return (
      <li key={i} className={cn("text-xs leading-snug", cor)}>
        {ir ? (
          <button
            type="button"
            onClick={() => (ir.tipo === "passo" ? onIrParaPasso(ir.cid) : onIrParaGatilho())}
            className="w-full rounded px-1 py-0.5 text-left underline-offset-2 hover:bg-background/60 hover:underline"
          >
            {texto}
          </button>
        ) : (
          <span className="block px-1 py-0.5">{texto}</span>
        )}
      </li>
    )
  }

  return (
    <div data-painel-de-pendencias className="z-10 mb-4 w-full max-w-[600px] scroll-mt-6 space-y-2">
      {linhasPendentes.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-destructive">
            <CircleAlert className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
            {t("pendencias.titulo", { count: linhasPendentes.length })}
          </p>
          <ul className="space-y-0.5">
            {linhasPendentes.map((l, i) => linha(l, i, "text-destructive"))}
          </ul>
        </div>
      )}
      {linhasDeAviso.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
            {t("pendencias.atencao")}
          </p>
          <ul className="space-y-0.5">
            {linhasDeAviso.map((l, i) => linha(l, i, "text-amber-700 dark:text-amber-300"))}
          </ul>
        </div>
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
  allLabel,
  help,
}: {
  value: string | null
  onChange: (id: string | null) => void
  t: ReturnType<typeof useTranslations>
  /** Rótulo da opção "sem escolha" — o passo de aviso (977) não herda o disparo. */
  allLabel?: string
  help?: string
}) {
  const tCanais = useTranslations("Channels")
  const { channels, reguaDoAsaas } = useResources()

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
  // E na régua do Asaas ele aparece SEMPRE: a ativação exige a conexão no
  // passo (D19), e escondido "por só haver um número" a automação criada à
  // mão nunca ligava (Codex, 2ª rodada do PR #206).
  if (channels.length < 2 && !orfao && !reguaDoAsaas) return null

  return (
    <FieldBlock label={tCanais("outboundLabel")}>
      <ChannelSelect
        channels={channels}
        value={value}
        onChange={onChange}
        allowAll
        allLabel={allLabel ?? tCanais("outboundInherit")}
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
          {help ?? tCanais("outboundHelp")}
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

// ------------------------------------------------------------
// Seletores da orquestração (936).
//
// Os dois seguem a mesma convenção do resto do builder — lista vazia cai
// para entrada crua, para a automação nunca ficar inautorável — e os dois
// carregam DOIS avisos que não são enfeite:
//
//   1. **alvo apagado** (o id ficou órfão no JSONB). Não há FK dentro de
//      `step_config`, então apagar a automação/robô não limpa nada: o passo
//      continua ali apontando para o nada, e falharia só na hora do disparo,
//      no log, longe de quem montou.
//   2. **alvo desativado**. O motor RECUSA acionar peça desligada — de
//      propósito, para o interruptor continuar sendo freio de emergência.
//      Sem o aviso, o passo pareceria montado e certo, e não faria nada.
// ------------------------------------------------------------

/**
 * Editor do passo "Enviar arquivo".
 *
 * O arquivo sobe UMA vez, aqui, para o bucket `chat-media`, e a URL pública
 * fica gravada na config. **Não há coleta de lixo** — o mesmo objeto serve
 * toda execução da automação, para sempre; apagá-lo no envio (como a mensagem
 * agendada faz) quebraria a automação a partir do segundo disparo.
 */
function EditorDeMidia({
  cfg,
  set,
  t,
}: {
  cfg: Record<string, unknown>
  set: (patch: Record<string, unknown>) => void
  t: ReturnType<typeof useTranslations>
}) {
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const tUpload = useTranslations("Upload")
  const kind = (cfg.kind as MediaKindUI) ?? "image"
  const url = (cfg.url as string) ?? ""

  async function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = "" // permite reescolher o MESMO arquivo depois de um erro
    if (!file) return
    const max = MEDIA_MAX_BYTES_BY_KIND[kind]
    if (file.size > max) {
      setErro(t("midia.grandeDemais", { mb: Math.floor(max / 1024 / 1024) }))
      return
    }
    setErro(null)
    setEnviando(true)
    try {
      const { publicUrl } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file)
      // O nome só é usado em documento, mas guardar sempre custa nada e evita
      // perder a informação se o operador trocar o tipo depois.
      set({ url: publicUrl, filename: file.name })
    } catch (err) {
      setErro(mensagemDoUpload(err, tUpload, String(err)))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      <FieldBlock label={t("midia.tipoLabel")}>
        <select
          value={kind}
          onChange={(e) => {
            const novo = e.target.value as MediaKindUI
            // ⚠️ Trocar para ÁUDIO limpa a legenda. Sem isso ela ficaria
            // gravada na config, invisível na tela (o campo some), e a
            // validação recusaria a ativação sem o operador ver o porquê.
            set(novo === "audio" ? { kind: novo, caption: "" } : { kind: novo })
          }}
          className={SELECT_CLASS}
        >
          <option value="image">{t("midia.image")}</option>
          <option value="video">{t("midia.video")}</option>
          <option value="document">{t("midia.document")}</option>
          <option value="audio">{t("midia.audio")}</option>
        </select>
      </FieldBlock>

      <FieldBlock label={t("midia.arquivoLabel")}>
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border bg-muted px-3 py-2 text-sm text-muted-foreground hover:border-primary">
          {enviando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          <span className="truncate">
            {enviando
              ? t("midia.enviando")
              : url
                ? ((cfg.filename as string) || url.split("/").pop() || url)
                : t("midia.escolher")}
          </span>
          <input type="file" className="hidden" onChange={aoEscolher} disabled={enviando} />
        </label>
        {erro && <p className="mt-1 text-[11px] text-destructive">{erro}</p>}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block truncate text-[11px] text-primary hover:underline"
          >
            {t("midia.abrir")}
          </a>
        )}
      </FieldBlock>

      {kind === "document" && (
        <FieldBlock label={t("midia.nomeLabel")}>
          <Input
            value={(cfg.filename as string) ?? ""}
            onChange={(e) => set({ filename: e.target.value })}
            className="bg-muted text-foreground"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">{t("midia.nomeHelp")}</p>
        </FieldBlock>
      )}

      {/* ⚠️ ÁUDIO NÃO TEM LEGENDA. O campo não fica desabilitado — ele SOME, e
          no lugar entra a explicação. Um campo inerte convida a digitar; o
          texto digitado seria gravado, apareceria no fio para a equipe e não
          viajaria ao cliente. */}
      {kind === "audio" ? (
        <p className="text-[11px] text-muted-foreground">{t("midia.audioSemLegenda")}</p>
      ) : (
        <FieldBlock label={t("midia.legendaLabel")}>
          <Textarea
            value={(cfg.caption as string) ?? ""}
            onChange={(e) => set({ caption: e.target.value })}
            rows={2}
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      )}
    </>
  )
}

function SeletorDeAutomacao({
  value,
  onChange,
  acionar,
  t,
}: {
  value: string
  onChange: (v: string) => void
  /** `true` = `run_automation` (o alvo precisa estar ativo para rodar). */
  acionar: boolean
  t: ReturnType<typeof useTranslations>
}) {
  const { automations, automacaoAtualId, carga } = useResources()
  // Só `run_automation` esconde a si mesma — ver a nota em `AutomationResources`.
  // E esconde a régua do Asaas: o motor recusa acioná-la (ela só roda pela
  // varredura, `runAutomationById`), e oferecê-la seria oferecer um passo que
  // sempre falha. A JÁ ESCOLHIDA fica, para o seletor não a chamar de apagada
  // — o aviso âmbar do cartão diz o que há com ela.
  const lista = acionar
    ? automations.filter(
        (a) => a.id !== automacaoAtualId && (!ehGatilhoDaRegua(a.trigger_type) || a.id === value),
      )
    : automations
  const escolhida = lista.find((a) => a.id === value)
  // "Não existe mais" só com a lista CARREGADA: durante a carga ela está
  // vazia, e o aviso acusaria de apagada a automação que só não chegou.
  const orfa = carga.automations === "pronto" && !!value && !escolhida
  return (
    <FieldBlock label={t(acionar ? "orquestracao.runAutomationLabel" : "orquestracao.stopAutomationLabel")}>
      {lista.length === 0 ? (
        <ListaSemEscolha estado={carga.automations} vazio={t("listas.semAutomacoes")} t={t} />
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{t("orquestracao.pickAutomation")}</option>
          {lista.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.id === automacaoAtualId ? ` ${t("orquestracao.selfSuffix")}` : ""}
              {a.is_active ? "" : ` ${t("orquestracao.inactiveSuffix")}`}
            </option>
          ))}
        </select>
      )}
      {orfa && (
        <p className="mt-1 text-[11px] text-amber-500">{t("orquestracao.automationGone")}</p>
      )}
      {/* Só em `run_automation`: `stop_automation` cancela as esperas de uma
          automação desligada normalmente — é justamente o caso em que se
          quer parar o que ficou parado. */}
      {acionar && escolhida && !escolhida.is_active && (
        <p className="mt-1 text-[11px] text-amber-500">{t("orquestracao.automationInactive")}</p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        {t(acionar ? "orquestracao.runAutomationHelp" : "orquestracao.stopAutomationHelp")}
      </p>
    </FieldBlock>
  )
}

function SeletorDeRobo({
  value,
  onChange,
  t,
}: {
  value: string
  onChange: (v: string) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { flows, carga } = useResources()
  const escolhido = flows.find((f) => f.id === value)
  // Idem: "não existe mais" só com a lista carregada.
  const orfao = carga.flows === "pronto" && !!value && !escolhido
  return (
    <FieldBlock label={t("orquestracao.runFlowLabel")}>
      {flows.length === 0 ? (
        <ListaSemEscolha estado={carga.flows} vazio={t("listas.semRobos")} t={t} />
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{t("orquestracao.pickFlow")}</option>
          {flows.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.status === "active" ? "" : ` ${t("orquestracao.inactiveSuffix")}`}
            </option>
          ))}
        </select>
      )}
      {orfao && <p className="mt-1 text-[11px] text-amber-500">{t("orquestracao.flowGone")}</p>}
      {escolhido && escolhido.status !== "active" && (
        <p className="mt-1 text-[11px] text-amber-500">{t("orquestracao.flowInactive")}</p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">{t("orquestracao.runFlowHelp")}</p>
    </FieldBlock>
  )
}

/**
 * O número do passo "Enviar para um número", lido pela régua das telas
 * (`telefoneDigitado`) — a mesma da validação da ativação e do motor. O
 * motivo da recusa aparece depois de a pessoa SAIR do campo: enquanto ela
 * digita "(83" a régua diz "faltou o DDD" — verdade sobre o texto, mentira
 * sobre a intenção (o mesmo desenho da "Nova conversa").
 */
function TelefoneDoAviso({
  valor,
  aoMudar,
}: {
  valor: string
  aoMudar: (phone: string) => void
}) {
  const tTelefone = useTranslations("Contacts.telefone")
  // Número já SALVO que a régua recusa (gravado antes dela, 23/09/2026) conta
  // como tocado: o motivo aparece ao abrir o passo, sem precisar entrar e sair
  // do campo — senão a automação que vai falhar no envio abre com cara de
  // certa. Número vazio ou válido espera o blur, como antes.
  const [tocado, setTocado] = useState(() => {
    const salvo = telefoneDigitado(valor)
    return !salvo.ok && salvo.motivo !== "vazio"
  })
  const lido = telefoneDigitado(valor)
  return (
    <>
      <Input
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        onBlur={() => setTocado(true)}
        placeholder="(83) 98000-0016"
        inputMode="tel"
        className="bg-muted text-foreground"
      />
      {tocado && !lido.ok && lido.motivo !== "vazio" && (
        <p className="mt-1 text-[11px] text-destructive">
          {tTelefone(lido.motivo === "curto" ? "curto" : "invalido")}
        </p>
      )}
    </>
  )
}

/**
 * A condição "Janela de 24h da Meta aberta?" (Fase 2.8 do plano do
 * previdenciário). O que se configura é só POR QUAL NÚMERO perguntar — e, em
 * branco, é o do DISPARO (senão o da conversa): o certo quando as mensagens
 * do "Sim" também herdam o disparo. Mensagem do "Sim" FIXADA num número
 * oficial exige o MESMO número aqui — a ativação recusa a divergência
 * (`validateChannelScopeForActivation`), e o aviso aparece ao vivo. A regra
 * mora em `src/lib/automations/janela-da-meta.ts`.
 *
 * ⚠️ O seletor lista SÓ números oficiais: QR Code responde sempre "Sim" e
 * Instagram sempre "Não" — escolher um deles transformaria a condição numa
 * constante sem o operador perceber. A conexão já gravada continua na lista
 * (senão o valor sumiria da tela), com o aviso do que ela faz.
 *
 * Segue a regra da casa: some com menos de dois números, e volta se a
 * condição já apontar para uma conexão (apagada inclusive — senão o UUID
 * morto ficaria sem saída na tela).
 */
function JanelaDaMetaFields({
  value,
  onChange,
  t,
}: {
  value: string | null
  onChange: (id: string | null) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { channels } = useResources()
  const orfao = !!value && channels.length > 0 && !channels.some((c) => c.id === value)
  const escolhida = value ? channels.find((c) => c.id === value) : undefined
  const oficiais = channels.filter((c) => ehMeta(c) || c.id === value)
  // Sem número oficial nenhum, a lista inteira — só para dar como voltar ao
  // "do disparo" a partir de um valor gravado.
  const lista = oficiais.length > 0 ? oficiais : channels
  return (
    <>
      <p className="mb-2 text-[11px] text-muted-foreground">{t("config.janelaDaMetaHelp")}</p>
      {(channels.length >= 2 || orfao) && (
        <FieldBlock label={t("config.janelaDaMetaCanalLabel")}>
          <ChannelSelect
            channels={lista}
            value={value}
            onChange={onChange}
            allowAll
            allLabel={t("config.janelaDaMetaCanalAuto")}
          />
          {orfao ? (
            <p className="mt-1 text-xs text-destructive">{t("config.janelaDaMetaCanalSumiu")}</p>
          ) : escolhida && !ehMeta(escolhida) ? (
            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
              {t("config.janelaDaMetaCanalSemJanela")}
            </p>
          ) : null}
        </FieldBlock>
      )}
    </>
  )
}

/**
 * A janela de horário — dois campos de hora e a caixa "só de segunda a
 * sexta", tudo no FUSO DO ESCRITÓRIO (o motor lê por `hora-do-dia.ts`; o
 * contêiner roda em UTC). Serve a DOIS passos, com textos próprios (`para`):
 * a condição "Hora do dia" (o operando continua "HH:mm-HH:mm", o formato do
 * upstream — era um texto livre, e o "18-9" digitado errado virava condição
 * sempre "Não" sem aviso) e o "Aguardar até estar dentro do horário" (a
 * chave `janela`, no mesmo formato). As chaves de texto são LITERAIS em cada
 * ramo, nunca montadas: chave montada escapa do portão de i18n.
 */
function HoraDoDiaFields({
  para,
  operand,
  segASex,
  onOperand,
  onSegASex,
  t,
}: {
  para: "condicao" | "espera"
  operand: unknown
  segASex: boolean
  onOperand: (operand: string) => void
  /** `undefined` TIRA a chave: ausente = todos os dias. */
  onSegASex: (valor: true | undefined) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { inicio, fim } = camposDaJanela(operand)
  const gravado = typeof operand === "string" ? operand.trim() : ""
  const janela = lerJanela(gravado)
  const diaInteiro = ehODiaInteiro(janela)
  const espera = para === "espera"
  // O aviso só aparece com algo escrito: vazio é o "obrigatório" de sempre.
  const aviso = !gravado || janela
    ? null
    : inicio && fim && inicio === fim
      ? espera ? t("config.esperaHorarioIgual") : t("config.horaDoDiaIgual")
      : espera ? t("config.esperaHorarioIncompleta") : t("config.horaDoDiaIncompleta")
  return (
    <>
      <label className="mb-2 flex items-start gap-2 text-xs text-foreground">
        <input
          type="checkbox"
          checked={diaInteiro}
          // "00:00-24:00": os dois campos não o escrevem (o `<input
          // type="time">` não aceita 24:00, e 00:00 → 00:00 é janela vazia).
          // Desmarcar devolve os campos EM BRANCO, o "obrigatório" de sempre.
          onChange={(e) => onOperand(e.target.checked ? OPERANDO_DO_DIA_INTEIRO : "")}
          className="mt-0.5 size-4 accent-primary"
        />
        <span>
          {t("config.horaDoDiaInteiro")}
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            {t("config.horaDoDiaInteiroHelp")}
          </span>
        </span>
      </label>
      {diaInteiro ? null : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <FieldBlock label={t("config.horaDoDiaInicio")}>
              <Input
                type="time"
                aria-label={t("config.horaDoDiaInicio")}
                value={inicio}
                onChange={(e) => onOperand(operandoDaJanela(e.target.value, fim))}
                className="bg-muted text-foreground"
              />
            </FieldBlock>
            <FieldBlock label={t("config.horaDoDiaFim")}>
              <Input
                type="time"
                aria-label={t("config.horaDoDiaFim")}
                value={fim}
                onChange={(e) => onOperand(operandoDaJanela(inicio, e.target.value))}
                className="bg-muted text-foreground"
              />
            </FieldBlock>
          </div>
          {aviso ? (
            <p className="mb-2 text-[11px] text-amber-700 dark:text-amber-300">{aviso}</p>
          ) : janela && janela.inicio > janela.fim ? (
            // Inclui o legado "18:00-24:00": `lerJanela` o lê como "18:00-00:00".
            <p className="mb-2 text-[11px] text-muted-foreground">
              {t("config.horaDoDiaMadrugada", { inicio, fim })}
            </p>
          ) : null}
        </>
      )}
      <p className="mb-2 text-[11px] text-muted-foreground">
        {espera ? t("config.esperaHorarioHelp") : t("config.horaDoDiaHelp")}
      </p>
      <label className="flex items-start gap-2 text-xs text-foreground">
        <input
          type="checkbox"
          checked={segASex}
          // Desmarcar TIRA a chave: ausente = todos os dias, como as
          // condições gravadas antes dela.
          onChange={(e) => onSegASex(e.target.checked ? true : undefined)}
          className="mt-0.5 size-4 accent-primary"
        />
        <span>
          {t("config.horaDoDiaSegASex")}
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            {espera ? t("config.esperaHorarioSegASexHelp") : t("config.horaDoDiaSegASexHelp")}
          </span>
        </span>
      </label>
    </>
  )
}

function StepEditor({
  step,
  onChange,
}: {
  step: BuilderStep
  onChange: (s: BuilderStep) => void
}) {
  const t = useTranslations("Automations.builder")
  const { channels, pipelines, stages, templates, carga } = useResources()
  // Mesmo agrupamento do seletor do gatilho: "Contato Acordo" existe em mais
  // de um quadro, e o nome sozinho não distingue.
  const stagesPorFunil = useMemo(
    () =>
      pipelines
        .map((p) => ({ funil: p, etapas: stages.filter((s) => s.pipeline_id === p.id) }))
        .filter((g) => g.etapas.length > 0),
    [pipelines, stages],
  )
  const cfg = step.step_config
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...step, step_config: { ...cfg, ...patch } })
  // A linha do modelo escolhido (é ela que diz quantas variáveis há), pela
  // MESMA régua do envio (`linhaDoModeloNaTela` espelha `resolveTemplateRow`):
  // o catálogo é por WABA, e o mesmo nome pode ter variáveis diferentes em
  // dois números.
  const linhaDoModelo =
    step.step_type === "send_template" && cfg.template_name
      ? linhaDoModeloNaTela(
          templates,
          String(cfg.template_name),
          cfg.language as string | undefined,
          canalDoPasso(cfg),
        )
      : null
  const modeloDoPasso = linhaDoModelo?.modelo ?? null

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
            <DicaDeVariaveis t={t} />
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
          {linhaDoModelo?.emVariosNumeros && (
            <p className="mb-2 text-[11px] text-amber-700 dark:text-amber-300">
              {t("templates.emVariosNumeros")}
            </p>
          )}
          {modeloDoPasso ? (
            <ValoresDoModelo modelo={modeloDoPasso} cfg={cfg} set={set} t={t} />
          ) : (
            cfg.template_name && <ValoresGravadosSemModelo cfg={cfg} t={t} />
          )}
          <CanalDeSaida
            value={canalDoPasso(cfg)}
            onChange={(id) => {
              // Trocar a conexão pode trocar a LINHA do modelo (o catálogo é
              // por WABA): aí os valores do anterior não dizem nada sobre o
              // novo — limpa, como na troca de modelo. Mesma linha, mantém.
              const antes = modeloDoPasso?.id ?? null
              const depois = cfg.template_name
                ? (linhaDoModeloNaTela(
                    templates,
                    String(cfg.template_name),
                    cfg.language as string | undefined,
                    id,
                  ).modelo?.id ?? null)
                : null
              set(
                antes !== depois
                  ? { channel_id: id, ...VALORES_DO_MODELO_LIMPOS }
                  : { channel_id: id },
              )
            }}
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
              placeholder={t.raw("config.placeholderValue")}
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
    case "move_deal_stage":
      return (
        <FieldBlock label={t("stages.moveToLabel")}>
          {/* Uma etapa só, não várias: mover é para UM lugar. Por isso um
              seletor plano em vez do multi-select do gatilho. Etapa gravada
              que a lista não traz fica PRESERVADA como opção — "apagada" só
              com a lista carregada (a regra da condição por etapa). */}
          {stagesPorFunil.length === 0 ? (
            <ListaSemEscolha estado={carga.pipelines} vazio={t("listas.semFunis")} t={t} />
          ) : (
            <select
              value={(cfg.stage_id as string) ?? ""}
              onChange={(e) => set({ stage_id: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">{t("stages.pickStage")}</option>
              {stagesPorFunil.map((g) => (
                <optgroup key={g.funil.id} label={g.funil.name}>
                  {g.etapas.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
              {typeof cfg.stage_id === "string" &&
                cfg.stage_id !== "" &&
                !stagesPorFunil.some((g) => g.etapas.some((s) => s.id === cfg.stage_id)) && (
                  <option value={cfg.stage_id}>
                    {carga.pipelines === "pronto"
                      ? t("pipelines.unknownStage")
                      : t("listas.carregando")}
                  </option>
                )}
            </select>
          )}
          {carga.pipelines === "falhou" && stagesPorFunil.length > 0 && (
            <p className="mt-1 text-xs text-destructive">{t("listas.falhou")}</p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("stages.moveHelp")}
          </p>
        </FieldBlock>
      )
    case "set_deal_status":
      return (
        <FieldBlock label={t("stages.statusLabel")}>
          <select
            value={(cfg.status as string) ?? "won"}
            onChange={(e) => set({ status: e.target.value })}
            className={SELECT_CLASS}
          >
            <option value="won">{t("stages.status_won")}</option>
            <option value="lost">{t("stages.status_lost")}</option>
            <option value="open">{t("stages.status_open")}</option>
          </select>
        </FieldBlock>
      )
    case "run_automation":
    case "stop_automation":
      return (
        <SeletorDeAutomacao
          value={(cfg.automation_id as string) ?? ""}
          onChange={(v) => set({ automation_id: v })}
          acionar={step.step_type === "run_automation"}
          t={t}
        />
      )
    case "run_flow":
      return (
        <SeletorDeRobo
          value={(cfg.flow_id as string) ?? ""}
          onChange={(v) => set({ flow_id: v })}
          t={t}
        />
      )
    case "stop_flow":
      return (
        <p className="text-[11px] text-muted-foreground">
          {t("orquestracao.stopFlowHelp")}
        </p>
      )
    case "send_media":
      return <EditorDeMidia cfg={cfg} set={set} t={t} />
    case "set_ai":
      return (
        <FieldBlock label={t("orquestracao.aiLabel")}>
          <select
            value={cfg.enabled === false ? "off" : "on"}
            onChange={(e) => set({ enabled: e.target.value === "on" })}
            className={SELECT_CLASS}
          >
            <option value="on">{t("orquestracao.aiOn")}</option>
            <option value="off">{t("orquestracao.aiOff")}</option>
          </select>
          {/* ⚠️ O aviso só aparece ao LIGAR, que é quando o contador zera.
              Mostrá-lo sempre transformaria em ruído o único texto da tela
              que explica como o teto da IA pode ser furado. */}
          {cfg.enabled !== false && (
            <p className="mt-1 text-[11px] text-amber-500">
              {t("orquestracao.aiResetWarning")}
            </p>
          )}
        </FieldBlock>
      )
    case "wait": {
      // "Aguardar até estar dentro do horário" (26/09/2026): `modo: "horario"`
      // + `janela`. Ausente = "por um tempo", o de sempre. Trocar para o
      // horário MANTÉM `amount`/`unit` (o motor os ignora nesse modo, e voltar
      // devolve o valor); voltar para o tempo TIRA a janela e o "segunda a
      // sexta" — sem isso, uma espera por tempo carregaria recorte que não vale
      // — e GRAVA o 1 h que os campos mostram quando não havia valor (senão a
      // tela diria "1 hora" e a ativação recusaria "amount must be > 0").
      const porHorario = cfg.modo === "horario"
      return (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <FieldBlock label={t("config.esperaModoLabel")}>
              <select
                value={porHorario ? "horario" : "tempo"}
                onChange={(e) =>
                  set(
                    e.target.value === "horario"
                      ? { modo: "horario", janela: typeof cfg.janela === "string" ? cfg.janela : "" }
                      : {
                          modo: undefined,
                          janela: undefined,
                          somente_seg_a_sex: undefined,
                          amount: typeof cfg.amount === "number" ? cfg.amount : 1,
                          unit: typeof cfg.unit === "string" ? cfg.unit : "hours",
                        },
                  )
                }
                className={SELECT_CLASS}
              >
                <option value="tempo">{t("config.esperaModoTempo")}</option>
                <option value="horario">{t("config.esperaModoHorario")}</option>
              </select>
            </FieldBlock>
          </div>
          {porHorario ? (
            <div className="col-span-2">
              <HoraDoDiaFields
                para="espera"
                operand={cfg.janela}
                segASex={cfg.somente_seg_a_sex === true}
                onOperand={(janela) => set({ janela })}
                onSegASex={(somente_seg_a_sex) => set({ somente_seg_a_sex })}
                t={t}
              />
            </div>
          ) : (
            <>
              {/* ⚠️ O aviso é do tamanho da promessa: quem escolhe "segundos" está
                  contando os segundos, e o agendador acorda a espera no ciclo dele.
                  Sem dizer isso, uma pausa de 10 s que chega em 20 s parece bug. */}
              {cfg.unit === "seconds" && (
                <p className="col-span-2 text-[11px] text-amber-500">
                  {t("config.segundosAviso")}
                </p>
              )}
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
                  <option value="seconds">{t("config.units.seconds")}</option>
                  <option value="minutes">{t("config.units.minutes")}</option>
                  <option value="hours">{t("config.units.hours")}</option>
                  <option value="days">{t("config.units.days")}</option>
                </select>
              </FieldBlock>
            </>
          )}
          {/* "Pausar: até a mensagem recebida / cronômetro" do Kommo. Marcada,
              a resposta do cliente DURANTE esta espera cancela o resto da
              automação para ele (`parar-se-responder.ts`). ⚠️ `=== true`, como
              o motor: valor truthy que não é booleano não pode aparecer
              marcado aqui e ser ignorado lá. */}
          <label className="col-span-2 flex items-start gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={cfg.parar_se_responder === true}
              onChange={(e) => set({ parar_se_responder: e.target.checked })}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              {t("config.pararSeResponderLabel")}
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {t("config.pararSeResponderHelp")}
              </span>
            </span>
          </label>
        </div>
      )
    }
    case "condition": {
      // O critério em vigor. Sem `subject` gravado a tela sempre mostrou a
      // presença de etiqueta (é com ela que o passo novo nasce).
      const criterio = (cfg.subject as string | undefined) ?? "tag_presence"
      const operando = typeof cfg.operand === "string" ? cfg.operand : ""
      // A etapa gravada que a lista não traz: "apagada" só com a lista
      // CARREGADA — antes disso ela só não chegou.
      const etapaOrfa =
        !!operando &&
        carga.pipelines === "pronto" &&
        !stagesPorFunil.some((g) => g.etapas.some((s) => s.id === operando))
      // O seletor do OPERANDO de cada critério. ⚠️ Nenhum deles é uma caixa
      // de texto: o operador escolhe na lista, nunca digita o id (a caixa
      // "id da etiqueta" que existia aqui gravava o que se colasse, e uma
      // letra a mais deixava a condição sempre falsa, em silêncio).
      // `message_content` não tem operando: o motor só lê `value`.
      const seletorDoOperando =
        criterio === "tag_presence" ? (
          <FieldBlock label={t("tags.label")}>
            <TagSelect
              value={operando}
              // `subject` junto: sem ele gravado, a tela mostra etiqueta e o
              // motor não saberia o que perguntar.
              onChange={(v) => set({ subject: criterio, operand: v })}
              t={t}
            />
          </FieldBlock>
        ) : criterio === "contact_field" ? (
          <FieldBlock label={t("config.fieldLabel")}>
            <ColunaDoContatoSelect
              value={operando}
              onChange={(v) => set({ subject: criterio, operand: v })}
              t={t}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("fields.dicaPersonalizado")}
            </p>
          </FieldBlock>
        ) : criterio === "deal_stage" ? (
          <FieldBlock label={t("config.operandLabel")}>
            {stagesPorFunil.length === 0 ? (
              <ListaSemEscolha estado={carga.pipelines} vazio={t("listas.semFunis")} t={t} />
            ) : (
              <select
                value={operando}
                onChange={(e) => set({ operand: e.target.value })}
                className={SELECT_CLASS}
              >
                <option value="">{t("stages.pickStage")}</option>
                {stagesPorFunil.map((g) => (
                  <optgroup key={g.funil.id} label={g.funil.name}>
                    {g.etapas.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {etapaOrfa && <option value={operando}>{t("pipelines.unknownStage")}</option>}
              </select>
            )}
          </FieldBlock>
        ) : criterio === "deal_status" ? (
          <FieldBlock label={t("config.operandLabel")}>
            {/* A opção vazia só aparece sobre passo gravado SEM status: antes
                o seletor mostrava "Ganho" em cima de um operando vazio, e o
                motor respondia "não" a toda execução. */}
            <select
              value={operando}
              onChange={(e) => set({ operand: e.target.value })}
              className={SELECT_CLASS}
            >
              {!operando && <option value="">{t("config.escolhaStatus")}</option>}
              <option value="won">{t("stages.status_won")}</option>
              <option value="lost">{t("stages.status_lost")}</option>
              <option value="open">{t("config.negocioAberto")}</option>
            </select>
          </FieldBlock>
        ) : criterio === "channel" ? (
          <FieldBlock label={t("config.operandLabel")}>
            {channels.length > 0 ? (
              // Grava em `operand` — é o que o motor lê (cfg.operand ?? cfg.value)
              // e o que `validate.ts` exige não-vazio. Sem `allowAll`: aqui a
              // condição é "veio DESTE número", não um escopo.
              <>
                <ChannelSelect
                  channels={channels}
                  value={operando || null}
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
                {!!operando && !channels.some((c) => c.id === operando) && (
                  <p className="mt-1 text-xs text-destructive">{t("config.channelGone")}</p>
                )}
              </>
            ) : (
              // Sem conexão na lista: carregando, a conta sem nenhuma, ou a
              // consulta falhou. A conexão gravada fica como está.
              <ListaSemEscolha estado={carga.channels} vazio={t("listas.semConexoes")} t={t} />
            )}
          </FieldBlock>
        ) : null
      return (
        <>
          <FieldBlock label={t("config.subjectLabel")}>
            <select
              value={criterio}
              onChange={(e) => {
                const novo = e.target.value
                if (novo === criterio) return
                // ⚠️ Trocar de critério ZERA o operando, qualquer que seja o
                // par: em cada um ele é uma coisa (o id da etiqueta, a coluna
                // do contato, a conexão, a etapa, o status, a janela
                // "HH:mm-HH:mm", o id do campo personalizado). O que sobrasse
                // viraria etiqueta/etapa inexistente — condição sempre falsa,
                // em silêncio — e, com os seletores, um item "apagado" que
                // ninguém escolheu. O status nasce "Ganho", que é o que o
                // seletor dele mostra primeiro: o que se vê é o que se salva.
                //
                // Entrar ou sair da janela de 24h, da hora do dia ou do campo
                // personalizado (2.10) limpa também o resto: o "só de segunda
                // a sexta" é da hora, e o valor e o operador são do campo.
                const proprio = (s: unknown) =>
                  s === "meta_window_open" || s === "time_of_day" || s === "custom_field"
                set({
                  subject: novo,
                  operand: novo === "deal_status" ? "won" : "",
                  ...(proprio(novo) || proprio(cfg.subject)
                    ? {
                        somente_seg_a_sex: undefined,
                        value: "",
                        operator: novo === "custom_field" ? "equals" : undefined,
                      }
                    : {}),
                })
              }}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="tag_presence">{t("config.subjects.tag_presence")}</option>
              <option value="contact_field">{t("config.subjects.contact_field")}</option>
              <option value="custom_field">{t("config.subjects.custom_field")}</option>
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
              {/* Estado ATUAL do negócio (934). Some sem funil configurado —
                  perguntar "está na etapa X" numa conta sem etapas ofereceria
                  um seletor vazio. */}
              {(stagesPorFunil.length > 0 || cfg.subject === "deal_stage") && (
                <option value="deal_stage">{t("config.subjects.deal_stage")}</option>
              )}
              <option value="deal_status">{t("config.subjects.deal_status")}</option>
              <option value="meta_window_open">{t("config.subjects.meta_window_open")}</option>
            </select>
          </FieldBlock>
          {criterio === "custom_field" ? (
            <CondicaoPorCampoFields cfg={cfg} set={set} />
          ) : criterio === "meta_window_open" ? (
            <JanelaDaMetaFields
              value={operando || null}
              onChange={(id) => set({ operand: id ?? "" })}
              t={t}
            />
          ) : criterio === "time_of_day" ? (
            <HoraDoDiaFields
              para="condicao"
              operand={cfg.operand}
              segASex={cfg.somente_seg_a_sex === true}
              onOperand={(operand) => set({ operand })}
              onSegASex={(somente_seg_a_sex) => set({ somente_seg_a_sex })}
              t={t}
            />
          ) : (
            seletorDoOperando
          )}
          {criterio === "contact_field" && (
            <FieldBlock label={t("config.valueLabel")}>
              <Input
                value={(cfg.value as string) ?? ""}
                onChange={(e) => set({ value: e.target.value })}
                className="bg-muted text-foreground"
              />
            </FieldBlock>
          )}
          {/* O texto procurado. O motor lê SÓ `value` aqui (`includes`, sem
              diferenciar maiúsculas) — o campo "Operando" que existia antes
              não entrava em conta nenhuma. O `operand` já gravado em passos
              antigos fica onde está: é inofensivo, e a tela não reescreve
              config por abrir. */}
          {criterio === "message_content" && (
            <FieldBlock label={t("config.mensagemContemLabel")}>
              <Input
                value={(cfg.value as string) ?? ""}
                onChange={(e) => set({ value: e.target.value })}
                className="bg-muted text-foreground"
              />
            </FieldBlock>
          )}
        </>
      )
    }
    case "send_to_number":
      // Aviso para a EQUIPE (977). O canal aqui NÃO herda o do disparo (é o
      // número do cliente); ausente = a conversa que já existe com o número
      // avisado, senão o padrão da conta — por isso o rótulo próprio.
      return (
        <>
          <FieldBlock label={t("config.phoneLabel")}>
            <TelefoneDoAviso
              valor={(cfg.phone as string) ?? ""}
              aoMudar={(phone) => set({ phone })}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{t("config.phoneHint")}</p>
          </FieldBlock>
          <FieldBlock label={t("config.contactNameLabel")}>
            <Input
              value={(cfg.contact_name as string) ?? ""}
              onChange={(e) => set({ contact_name: e.target.value })}
              className="bg-muted text-foreground"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{t("config.contactNameHint")}</p>
          </FieldBlock>
          <FieldBlock label={t("config.messageText")}>
            <Textarea
              value={(cfg.text as string) ?? ""}
              onChange={(e) => set({ text: e.target.value })}
              placeholder={t("config.placeholderNotifyText", { nome: "{{vars.agendamento_nome}}", data: "{{vars.agendamento_data}}" })}
              className="min-h-24 bg-muted text-foreground"
            />
            <DicaDeVariaveis t={t} />
          </FieldBlock>
          <CanalDeSaida
            value={canalDoPasso(cfg)}
            onChange={(id) => set({ channel_id: id })}
            t={t}
            allLabel={t("config.notifyChannelInherit")}
            help={t("config.notifyChannelHelp")}
          />
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
    case "create_task":
      return (
        <>
          <FieldBlock label={t("tarefa.tituloLabel")}>
            <Input
              value={(cfg.titulo as string) ?? ""}
              onChange={(e) => set({ titulo: e.target.value })}
              className="bg-muted text-foreground"
            />
            <DicaDeVariaveis t={t} />
          </FieldBlock>
          <FieldBlock label={t("tarefa.descricaoLabel")}>
            <Textarea
              value={(cfg.descricao as string) ?? ""}
              onChange={(e) => set({ descricao: e.target.value })}
              className="min-h-16 bg-muted text-foreground"
            />
          </FieldBlock>
          {/* Para quem (Fase 2.4 do plano do previdenciário). Ausente = uma
              pessoa fixa, que é o que toda tarefa gravada antes disto faz. Nos
              outros dois modos, a pessoa escolhida embaixo vira a RESERVA —
              obrigatória na ativação: sem ninguém atribuído (o caso comum) o
              passo falharia e pararia a sequência (ver
              `responsavel-da-tarefa.ts`). */}
          <FieldBlock label={t("tarefa.responsavelLabel")}>
            <select
              value={(cfg.responsavel_modo as string) || "fixo"}
              onChange={(e) => set({ responsavel_modo: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="fixo">{t("tarefa.modoFixo")}</option>
              <option value="conversa">{t("tarefa.modoConversa")}</option>
              <option value="card">{t("tarefa.modoCard")}</option>
            </select>
          </FieldBlock>
          {(cfg.responsavel_modo as string | undefined) === "card" && (
            // Hoje só o formulário do negócio grava `deals.assigned_to` —
            // nenhuma automação nem o roteador do funil. Sem isto o operador
            // escolhe "o responsável pelo card" achando que é o dono do lead,
            // e toda tarefa cai na reserva.
            <p className="-mt-1 mb-2 text-[11px] text-muted-foreground">{t("tarefa.cardHint")}</p>
          )}
          <FieldBlock
            label={
              (cfg.responsavel_modo as string | undefined) === "conversa" ||
              (cfg.responsavel_modo as string | undefined) === "card"
                ? t("tarefa.reservaLabel")
                : t("tarefa.pessoaLabel")
            }
          >
            <AgentSelect
              value={(cfg.responsavel_user_id as string) ?? ""}
              onChange={(v) => set({ responsavel_user_id: v })}
              t={t}
            />
            {((cfg.responsavel_modo as string | undefined) === "conversa" ||
              (cfg.responsavel_modo as string | undefined) === "card") && (
              <p className="mt-1 text-xs text-muted-foreground">{t("tarefa.reservaHint")}</p>
            )}
          </FieldBlock>
          <div className="grid grid-cols-2 gap-3">
            <FieldBlock label={t("tarefa.prazoLabel")}>
              <Input
                type="number"
                min={0}
                max={365}
                value={Number(cfg.prazo_em_dias ?? 0)}
                onChange={(e) => set({ prazo_em_dias: Number(e.target.value) })}
                className="bg-muted text-foreground"
              />
              <p className="mt-1 text-xs text-muted-foreground">{t("tarefa.prazoHint")}</p>
            </FieldBlock>
            <FieldBlock label={t("tarefa.horaLabel")}>
              <Input
                type="time"
                value={((cfg.hora as string) ?? "").slice(0, 5)}
                onChange={(e) => set({ hora: e.target.value })}
                className="bg-muted text-foreground"
              />
              <p className="mt-1 text-xs text-muted-foreground">{t("tarefa.horaHint")}</p>
            </FieldBlock>
          </div>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={cfg.importante === true}
              onChange={(e) => set({ importante: e.target.checked })}
              className="size-4 accent-primary"
            />
            {t("tarefa.importanteLabel")}
          </label>
        </>
      )
    default:
      return null
  }
}

/**
 * As variáveis que qualquer passo de texto aceita (977). A lista é montada
 * em código e entra no dicionário por VALOR: chaves duplas escritas no JSON
 * quebrariam o parser ICU (icu-safety.test.ts).
 */
const VARIAVEIS_DE_TEXTO = [
  "{{contact.name}}",
  "{{contact.phone}}",
  "{{contact.email}}",
  "{{contact.company}}",
  "{{contact.campo.<chave_do_campo>}}",
  "{{contact.origem}}",
  "{{conversation.link}}",
  "{{contact.link}}",
  "{{deal.value}}",
  "{{deal.created_at}}",
  "{{now}}",
  "{{message.text}}",
]

function DicaDeVariaveis({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <p className="mt-1 text-[11px] text-muted-foreground">
      {t("config.variaveisDeTexto", { lista: VARIAVEIS_DE_TEXTO.join("  ") })}
    </p>
  )
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

/** Os critérios do seletor da condição (`config.subjects.*`). Fora deles o
 *  cartão fechado mostra "?", nunca a chave crua. */
const CRITERIOS_DA_CONDICAO = new Set([
  "tag_presence",
  "contact_field",
  "custom_field",
  "message_content",
  "time_of_day",
  "channel",
  "deal_stage",
  "deal_status",
  "meta_window_open",
])

/** Corta o texto do resumo: o cartão fechado tem uma linha só. */
function recortar(texto: string, max = 40): string {
  const limpo = texto.replace(/\s+/g, " ").trim()
  return limpo.length > max ? `${limpo.slice(0, max - 1)}…` : limpo
}

/**
 * O resumo da CONDIÇÃO no cartão fechado: o critério e, quando dá para dizer
 * pelo NOME, o alvo ("Presença de etiqueta · Cliente Fechado"). Numa
 * automação grande, só o critério obrigava a abrir condição por condição
 * para achar a que se procurava.
 *
 * ⚠️ Nunca o UUID. Alvo que a lista não resolve cai em duas coisas
 * diferentes: com a lista CARREGADA, o item foi apagado ("Etiqueta apagada");
 * ainda carregando (ou falhou), fica só o critério — afirmar "apagada"
 * durante a carga seria mentira.
 */
function resumoDaCondicao(
  cfg: Record<string, unknown>,
  t: ReturnType<typeof useTranslations>,
  r: AutomationResources,
): string {
  const criterio = cfg.subject
  if (typeof criterio !== "string" || !CRITERIOS_DA_CONDICAO.has(criterio)) return "?"
  const nome = t(`config.subjects.${criterio}`)
  const operando = typeof cfg.operand === "string" ? cfg.operand : ""
  const valor = typeof cfg.value === "string" ? cfg.value : ""
  let alvo: string | null = null
  switch (criterio) {
    case "tag_presence": {
      if (!operando) break
      const etiqueta = r.tags.find((x) => x.id === operando)
      alvo = etiqueta ? etiqueta.name : r.carga.tags === "pronto" ? t("tags.unknown") : null
      break
    }
    case "deal_stage": {
      if (!operando) break
      const etapa = r.stages.find((s) => s.id === operando)
      alvo = etapa
        ? etapa.name
        : r.carga.pipelines === "pronto"
          ? t("pipelines.unknownStage")
          : null
      break
    }
    case "deal_status":
      alvo =
        operando === "won"
          ? t("stages.status_won")
          : operando === "lost"
            ? t("stages.status_lost")
            : operando === "open"
              ? t("config.negocioAberto")
              : null
      break
    case "channel":
      if (!operando) break
      alvo =
        channelLabel(r.channels, operando) ??
        (r.carga.channels === "pronto" ? t("listas.conexaoApagada") : null)
      break
    case "contact_field": {
      // Sobra de id de outro critério não vira nome de coluna na tela.
      if (!operando || PARECE_UUID.test(operando)) break
      const coluna = ehColunaDoContato(operando) ? rotuloDaColuna(operando, t) : operando
      alvo = valor ? `${coluna} = ${recortar(valor)}` : coluna
      break
    }
    case "message_content":
      alvo = valor ? t("previa.contem", { texto: recortar(valor) }) : null
      break
    case "custom_field": {
      if (!operando) break
      const campo = r.customFields.find((f) => f.id === operando)
      alvo = campo
        ? campo.field_name
        : r.carga.customFields === "pronto"
          ? t("fields.unknown")
          : null
      break
    }
  }
  return alvo ? `${nome} · ${alvo}` : nome
}

// O resumo do passo FECHADO. Vinha do original em inglês ("when time_of_day",
// "no text yet") e aparecia assim com o app em português.
function previewFor(
  step: BuilderStep,
  t: ReturnType<typeof useTranslations>,
  recursos: AutomationResources,
): string {
  switch (step.step_type) {
    case "send_message":
      return (step.step_config.text as string) || t("previa.semTexto")
    case "send_buttons":
    case "send_list":
      return interactivePayloadPreviewText(asInteractive(step.step_config)) || t("previa.semCorpo")
    case "send_template":
      return (step.step_config.template_name as string) || t("previa.semModelo")
    case "wait":
      return `${step.step_config.amount ?? "?"} ${step.step_config.unit ?? ""}`
    case "condition":
      return resumoDaCondicao(step.step_config, t, recursos)
    case "send_webhook":
      return (step.step_config.url as string) || t("previa.semUrl")
    case "send_to_number":
      return [step.step_config.phone, (step.step_config.text as string | undefined)?.split("\n")[0]]
        .filter(Boolean)
        .join(" · ")
    default:
      return ""
  }
}

// ------------------------------------------------------------
// Serialize builder tree → API payload (flattened shape)
// ------------------------------------------------------------

interface ApiStep {
  /** O id de banco (ver `BuilderStep.id`): ausente = o servidor atribui. */
  id?: string
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: ApiStep[]; no?: ApiStep[] }
}

export function toApiSteps(steps: BuilderStep[]): ApiStep[] {
  return steps.map((s) => ({
    ...(s.id ? { id: s.id } : {}),
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
    // O id do banco volta no salvamento: é a identidade do passo (NOSSO).
    id: n.id,
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
