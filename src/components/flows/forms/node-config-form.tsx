"use client";

/**
 * Per-node configuration form, dispatched by node_type.
 *
 * One component, ten branches. Each branch renders the inputs that
 * map onto the node's `config` JSONB shape (text + buttons for
 * send_buttons, prompt + var_key for collect_input, etc.) and forwards
 * edits up via `onUpdateConfig`.
 *
 * Why this lives in src/components/flows/forms/ instead of next to
 * the list editor: PR 2 (canvas editing) needs to mount the same
 * form in a side panel when a user clicks a node on the canvas.
 * Keeping the per-node forms here means there's exactly one place
 * where each form's behaviour and validation lives — drift between
 * "what the list editor shows" and "what the canvas side panel
 * shows" becomes impossible.
 *
 * `showAdvanced` is the disclosure that surfaces internal
 * identifiers (node_key, button reply_id, list row reply_id) — owned
 * by the host (NodeCard / SideSheet) so the toggle is rendered
 * outside this form alongside whatever delete/cancel buttons that
 * host wants. The form just reads the boolean and conditionally
 * renders the advanced rows.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Library,
  Loader2,
  Paperclip,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { uploadAccountMedia, MEDIA_MAX_BYTES } from "@/lib/storage/upload-media";
import { mensagemDoUpload } from "@/lib/storage/erro-de-upload";
import { AcervoPicker } from "@/components/inbox/acervo-picker";
import { useAcervo } from "@/hooks/use-acervo";
import { audioViraNotaDeVozNaMeta } from "@/lib/flows/tipo-da-midia";
import type { MediaLibraryItem } from "@/types";
import { slugify, type BuilderNode } from "../shared";
import { NextNodeRow, NodeKeySelect, TextRow } from "./fields";
import { SalvarRespostaRow } from "./salvar-resposta";
import { MoverCardForm } from "./mover-card";
import { TransferirForm } from "./transferir";
import { useFlowEditor } from "../flow-editor-state";

interface NodeConfigFormProps {
  node: BuilderNode;
  allNodes: BuilderNode[];
  showAdvanced: boolean;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}

export function NodeConfigForm({
  node,
  allNodes,
  showAdvanced,
  onUpdateConfig,
}: NodeConfigFormProps) {
  const t = useTranslations("Flows.builder.form");
  const cfg = node.config;
  switch (node.node_type) {
    case "start":
      return (
        <NextNodeRow
          value={(cfg as { next_node_key?: string }).next_node_key ?? ""}
          allNodes={allNodes}
          currentKey={node.node_key}
          onChange={(v) => onUpdateConfig({ next_node_key: v })}
          label={t("advancesTo")}
        />
      );

    case "send_message":
      return (
        <>
          <TextRow
            label={t("textToCustomer")}
            value={(cfg as { text?: string }).text ?? ""}
            onChange={(v) => onUpdateConfig({ text: v })}
            rows={3}
          />
          <NextNodeRow
            value={(cfg as { next_node_key?: string }).next_node_key ?? ""}
            allNodes={allNodes}
            currentKey={node.node_key}
            onChange={(v) => onUpdateConfig({ next_node_key: v })}
            label={t("advancesTo")}
          />
        </>
      );

    case "send_buttons":
      return (
        <SendButtonsForm
          cfg={cfg as SendButtonsCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
          showAdvanced={showAdvanced}
          t={t}
        />
      );

    case "send_list":
      return (
        <SendListForm
          cfg={cfg as SendListCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
          showAdvanced={showAdvanced}
          t={t}
        />
      );

    case "send_media":
      return (
        <SendMediaForm
          cfg={cfg as SendMediaCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
          t={t}
        />
      );

    case "collect_input":
      return (
        <>
          <TextRow
            label={t("promptToCustomer")}
            value={(cfg as { prompt_text?: string }).prompt_text ?? ""}
            onChange={(v) => onUpdateConfig({ prompt_text: v })}
            rows={2}
          />
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {t("varKeyLabel")}
            </label>
            <Input
              value={(cfg as { var_key?: string }).var_key ?? ""}
              onChange={(e) =>
                onUpdateConfig({
                  var_key: e.target.value.replace(/[^a-zA-Z0-9_]/g, ""),
                })
              }
              placeholder={t("varKeyPlaceholder")}
              className="bg-muted font-mono text-xs"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t("varKeyHelp")}{" "}
              <code className="rounded bg-muted px-1">
                {"{{vars."}
                {(cfg as { var_key?: string }).var_key || "name"}
                {"}}"}
              </code>
              .
            </p>
          </div>
          <SalvarRespostaRow
            nodeType="collect_input"
            value={(cfg as { salvar_em?: string | null }).salvar_em}
            onChange={(v) => onUpdateConfig({ salvar_em: v })}
          />
          <NextNodeRow
            value={(cfg as { next_node_key?: string }).next_node_key ?? ""}
            allNodes={allNodes}
            currentKey={node.node_key}
            onChange={(v) => onUpdateConfig({ next_node_key: v })}
            label={t("advanceAfterCapture")}
          />
        </>
      );

    case "condition":
      return (
        <ConditionForm
          cfg={cfg as ConditionCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
          t={t}
        />
      );

    case "set_tag":
      return (
        <SetTagForm
          cfg={cfg as SetTagCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
          t={t}
        />
      );

    case "move_deal_stage":
      return (
        <MoverCardForm
          cfg={cfg as { pipeline_id?: string; stage_id?: string; origem_stage_ids?: string[]; next_node_key?: string }}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
        />
      );

    case "handoff":
      return (
        <TransferirForm
          cfg={cfg as { note?: string; assign_to?: string }}
          onUpdateConfig={onUpdateConfig}
        />
      );

    case "end":
      return (
        <p className="text-xs text-muted-foreground">
          {t("endNodeHelp")}
        </p>
      );
  }
}

// ============================================================
// send_buttons
// ============================================================

interface SendButtonsCfg {
  text?: string;
  footer_text?: string;
  salvar_em?: string | null;
  buttons?: Array<{ reply_id: string; title: string; next_node_key: string }>;
}

function SendButtonsForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  showAdvanced,
  t,
}: {
  cfg: SendButtonsCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  showAdvanced: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const buttons = cfg.buttons ?? [];
  const updateButton = (
    idx: number,
    patch: Partial<NonNullable<SendButtonsCfg["buttons"]>[number]>,
  ) => {
    onUpdateConfig({
      buttons: buttons.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    });
  };
  const addButton = () =>
    onUpdateConfig({
      buttons: [
        ...buttons,
        {
          reply_id: `btn_${buttons.length + 1}`,
          title: t("defaultOptionTitle"),
          next_node_key: "",
        },
      ],
    });
  const removeButton = (idx: number) =>
    onUpdateConfig({ buttons: buttons.filter((_, i) => i !== idx) });

  return (
    <>
      <TextRow
        label={t("bodyText")}
        value={cfg.text ?? ""}
        onChange={(v) => onUpdateConfig({ text: v })}
        rows={3}
      />
      <TextRow
        label={t("footerText")}
        value={cfg.footer_text ?? ""}
        onChange={(v) => onUpdateConfig({ footer_text: v })}
      />
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs text-muted-foreground">
            {t("buttonsHelp")}
          </label>
        </div>
        <div className="flex flex-col gap-3">
          {buttons.map((b, i) => (
            <div
              key={i}
              className={cn(
                "grid grid-cols-1 gap-2 rounded-md border border-border bg-muted/40 p-3",
                showAdvanced
                  ? "md:grid-cols-[1fr_2fr_2fr_auto]"
                  : "md:grid-cols-[2fr_2fr_auto]",
              )}
            >
              {showAdvanced && (
                <Input
                  value={b.reply_id}
                  onChange={(e) =>
                    updateButton(i, {
                      reply_id: slugify(e.target.value, `btn_${i + 1}`),
                    })
                  }
                  placeholder="reply_id"
                  className="bg-muted font-mono text-xs"
                />
              )}
              <Input
                value={b.title}
                onChange={(e) => updateButton(i, { title: e.target.value })}
                placeholder={t("optionTitlePlaceholder")}
                className="bg-muted"
                maxLength={20}
              />
              <NodeKeySelect
                value={b.next_node_key || null}
                nodes={allNodes}
                excludeKey={currentKey}
                onChange={(v) => updateButton(i, { next_node_key: v ?? "" })}
                placeholder={t("nextNodePlaceholder")}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeButton(i)}
                className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        {buttons.length < 3 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={addButton}
            className="mt-2"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("addButton")}
          </Button>
        )}
      </div>
      <SalvarRespostaRow
        nodeType="send_buttons"
        value={cfg.salvar_em}
        onChange={(v) => onUpdateConfig({ salvar_em: v })}
        titulosDasOpcoes={buttons.map((b) => b.title)}
      />
    </>
  );
}

// ============================================================
// send_list
// ============================================================

interface SendListCfg {
  text?: string;
  button_label?: string;
  footer_text?: string;
  salvar_em?: string | null;
  sections?: Array<{
    title?: string;
    rows: Array<{
      reply_id: string;
      title: string;
      description?: string;
      next_node_key: string;
    }>;
  }>;
}

function SendListForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  showAdvanced,
  t,
}: {
  cfg: SendListCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  showAdvanced: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const sections = cfg.sections ?? [];
  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0);

  const updateSection = (
    sIdx: number,
    patch: Partial<NonNullable<SendListCfg["sections"]>[number]>,
  ) => {
    onUpdateConfig({
      sections: sections.map((s, i) =>
        i === sIdx ? { ...s, ...patch } : s,
      ),
    });
  };
  const addSection = () =>
    onUpdateConfig({
      sections: [
        ...sections,
        {
          title: "",
          rows: [
            {
              reply_id: `row_${totalRows + 1}`,
              title: `Option ${totalRows + 1}`,
              next_node_key: "",
            },
          ],
        },
      ],
    });
  const removeSection = (sIdx: number) =>
    onUpdateConfig({ sections: sections.filter((_, i) => i !== sIdx) });
  const updateRow = (
    sIdx: number,
    rIdx: number,
    patch: Partial<
      NonNullable<SendListCfg["sections"]>[number]["rows"][number]
    >,
  ) => {
    onUpdateConfig({
      sections: sections.map((s, i) =>
        i === sIdx
          ? {
              ...s,
              rows: s.rows.map((r, j) => (j === rIdx ? { ...r, ...patch } : r)),
            }
          : s,
      ),
    });
  };
  const addRow = (sIdx: number) =>
    onUpdateConfig({
      sections: sections.map((s, i) =>
        i === sIdx
          ? {
              ...s,
              rows: [
                ...s.rows,
                {
                  reply_id: `row_${totalRows + 1}`,
                  title: `Option ${totalRows + 1}`,
                  next_node_key: "",
                },
              ],
            }
          : s,
      ),
    });
  const removeRow = (sIdx: number, rIdx: number) =>
    onUpdateConfig({
      sections: sections.map((s, i) =>
        i === sIdx ? { ...s, rows: s.rows.filter((_, j) => j !== rIdx) } : s,
      ),
    });

  return (
    <>
      <TextRow
        label={t("bodyText")}
        value={cfg.text ?? ""}
        onChange={(v) => onUpdateConfig({ text: v })}
        rows={3}
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextRow
          label={t("buttonLabel")}
          value={cfg.button_label ?? ""}
          onChange={(v) => onUpdateConfig({ button_label: v })}
        />
        <TextRow
          label={t("footerText")}
          value={cfg.footer_text ?? ""}
          onChange={(v) => onUpdateConfig({ footer_text: v })}
        />
      </div>

      <div className="mt-2">
        <label className="mb-2 block text-xs text-muted-foreground">
          {t("rowsHelp")}
        </label>
        {sections.map((section, sIdx) => (
          <div
            key={sIdx}
            className="mb-3 rounded-md border border-border bg-muted/40 p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <Input
                value={section.title ?? ""}
                onChange={(e) =>
                  updateSection(sIdx, { title: e.target.value })
                }
                placeholder={t("sectionTitlePlaceholder", { count: sIdx + 1 })}
                className="bg-muted text-xs"
              />
              {sections.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeSection(sIdx)}
                  className="shrink-0 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  aria-label={t("removeSection")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {section.rows.map((row, rIdx) => (
              <div
                key={rIdx}
                className={cn(
                  "mb-2 grid grid-cols-1 gap-2",
                  showAdvanced
                    ? "md:grid-cols-[1fr_2fr_2fr_auto]"
                    : "md:grid-cols-[2fr_2fr_auto]",
                )}
              >
                {showAdvanced && (
                  <Input
                    value={row.reply_id}
                    onChange={(e) =>
                      updateRow(sIdx, rIdx, {
                        reply_id: slugify(
                          e.target.value,
                          `row_${rIdx + 1}`,
                        ),
                      })
                    }
                    placeholder="reply_id"
                    className="bg-muted font-mono text-xs"
                  />
                )}
                <Input
                  value={row.title}
                  onChange={(e) =>
                    updateRow(sIdx, rIdx, { title: e.target.value })
                  }
                  placeholder={t("rowTitlePlaceholder")}
                  className="bg-muted"
                  maxLength={24}
                />
                <NodeKeySelect
                  value={row.next_node_key || null}
                  nodes={allNodes}
                  excludeKey={currentKey}
                  onChange={(v) =>
                    updateRow(sIdx, rIdx, { next_node_key: v ?? "" })
                  }
                  placeholder={t("nextNodePlaceholder")}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRow(sIdx, rIdx)}
                  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {totalRows < 10 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => addRow(sIdx)}
                className="mt-1"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("addRow")}
              </Button>
            )}
          </div>
        ))}
        {/* WhatsApp's interactive-list spec caps sections at 10. Group rows
            by category (Billing / Support / Sales etc.) to give customers a
            scannable menu. */}
        {sections.length < 10 && (
          <Button variant="outline" size="sm" onClick={addSection}>
            <Plus className="h-3.5 w-3.5" />
            {t("addSection")}
          </Button>
        )}
      </div>
      <SalvarRespostaRow
        nodeType="send_list"
        value={cfg.salvar_em}
        onChange={(v) => onUpdateConfig({ salvar_em: v })}
        titulosDasOpcoes={sections.flatMap((sec) => sec.rows.map((r) => r.title))}
      />
    </>
  );
}

// ============================================================
// condition
// ============================================================

interface ConditionCfg {
  subject?: "var" | "tag" | "contact_field";
  subject_key?: string;
  operator?: "equals" | "contains" | "present" | "absent";
  value?: string;
  true_next?: string;
  false_next?: string;
}

interface UserTag {
  id: string;
  name: string;
  color?: string;
}

function ConditionForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  t,
}: {
  cfg: ConditionCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const tags = useUserTags();

  const subject = cfg.subject ?? "var";
  const operator = cfg.operator ?? "equals";
  const showValue = operator === "equals" || operator === "contains";

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">{t("ifLabel")}</label>
          <Select
            value={subject}
            onValueChange={(v) =>
              onUpdateConfig({ subject: v as ConditionCfg["subject"] })
            }
          >
            <SelectTrigger className="bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="var">{t("capturedVariable")}</SelectItem>
              <SelectItem value="tag">{t("contactHasTag")}</SelectItem>
              <SelectItem value="contact_field">{t("contactField")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs text-muted-foreground">
            {subject === "var"
              ? t("varName")
              : subject === "tag"
                ? t("tagLabel")
                : t("fieldLabel")}
          </label>
          {subject === "tag" && tags.length > 0 ? (
            <Select
              value={cfg.subject_key ?? ""}
              onValueChange={(v) => onUpdateConfig({ subject_key: v })}
            >
              <SelectTrigger className="bg-muted">
                <SelectValue placeholder={t("pickTag")} />
              </SelectTrigger>
              <SelectContent>
                {tags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : subject === "contact_field" ? (
            <Select
              value={cfg.subject_key ?? ""}
              onValueChange={(v) => onUpdateConfig({ subject_key: v })}
            >
              <SelectTrigger className="bg-muted">
                <SelectValue placeholder={t("pickField")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">name</SelectItem>
                <SelectItem value="email">email</SelectItem>
                <SelectItem value="phone">phone</SelectItem>
                <SelectItem value="company">company</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={cfg.subject_key ?? ""}
              onChange={(e) =>
                onUpdateConfig({ subject_key: e.target.value })
              }
              placeholder={subject === "var" ? t("varKeyPlaceholder") : t("tagUuidPlaceholder")}
              className="bg-muted font-mono text-xs"
            />
          )}
        </div>
      </div>

      <div
        className={cn(
          "grid grid-cols-1 gap-3",
          showValue ? "md:grid-cols-2" : "",
        )}
      >
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">{t("operatorLabel")}</label>
          <Select
            value={operator}
            onValueChange={(v) =>
              onUpdateConfig({ operator: v as ConditionCfg["operator"] })
            }
          >
            <SelectTrigger className="bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="present">{t("isPresent")}</SelectItem>
              <SelectItem value="absent">{t("isAbsent")}</SelectItem>
              <SelectItem value="equals">{t("equals")}</SelectItem>
              <SelectItem value="contains">{t("contains")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {showValue && (
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t("valueLabel")}</label>
            <Input
              value={cfg.value ?? ""}
              onChange={(e) => onUpdateConfig({ value: e.target.value })}
              className="bg-muted"
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <NextNodeRow
          value={cfg.true_next ?? ""}
          allNodes={allNodes}
          currentKey={currentKey}
          onChange={(v) => onUpdateConfig({ true_next: v })}
          label={t("ifTrueAdvance")}
        />
        <NextNodeRow
          value={cfg.false_next ?? ""}
          allNodes={allNodes}
          currentKey={currentKey}
          onChange={(v) => onUpdateConfig({ false_next: v })}
          label={t("ifFalseAdvance")}
        />
      </div>
    </>
  );
}

// ============================================================
// set_tag
// ============================================================

interface SetTagCfg {
  mode?: "add" | "remove";
  tag_id?: string;
  next_node_key?: string;
}

function SetTagForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  t,
}: {
  cfg: SetTagCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const tags = useUserTags();

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">{t("actionLabel")}</label>
          <Select
            value={cfg.mode ?? "add"}
            onValueChange={(v) =>
              onUpdateConfig({ mode: v as SetTagCfg["mode"] })
            }
          >
            <SelectTrigger className="bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="add">{t("addTag")}</SelectItem>
              <SelectItem value="remove">{t("removeTag")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">{t("tagLabel")}</label>
          {tags.length > 0 ? (
            <Select
              value={cfg.tag_id ?? ""}
              onValueChange={(v) => onUpdateConfig({ tag_id: v })}
            >
              <SelectTrigger className="bg-muted">
                <SelectValue placeholder={t("pickTag")} />
              </SelectTrigger>
              <SelectContent>
                {tags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={cfg.tag_id ?? ""}
              onChange={(e) => onUpdateConfig({ tag_id: e.target.value })}
              placeholder={t("tagUuidPlaceholder")}
              className="bg-muted font-mono text-xs"
            />
          )}
        </div>
      </div>
      <NextNodeRow
        value={cfg.next_node_key ?? ""}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ next_node_key: v })}
        label={t("thenAdvanceTo")}
      />
    </>
  );
}

/**
 * Shared loader for both `condition` (subject=tag) and `set_tag`.
 * Falls back to raw UUID input if the endpoint is absent on older
 * deployments — the form remains authorable in that case.
 */
function useUserTags(): UserTag[] {
  const [tags, setTags] = useState<UserTag[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tags").catch(() => null);
        if (!res || !res.ok) return;
        const json = (await res.json()) as { tags?: UserTag[] };
        if (!cancelled) setTags(json.tags ?? []);
      } catch {
        // Tags endpoint absent — caller falls back to raw input.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return tags;
}

// ============================================================
// send_media
// ============================================================

interface SendMediaCfg {
  media_type?: "image" | "video" | "document" | "audio";
  media_url?: string;
  /** Item do acervo (CB, 26/09/2026) — ver `src/lib/flows/midia-do-no.ts`. */
  acervo_id?: string | null;
  caption?: string;
  filename?: string;
  next_node_key?: string;
}

// Mirrors the bucket's allowed_mime_types from migration 016. Kept in
// sync with the storage policy so the picker rejects unsupported files
// before they hit the network rather than failing with a confusing
// Supabase RLS / mime-type error.
//
// ⚠️ ÁUDIO não está aqui de propósito: o bucket `flow-media` não aceita
// áudio. O áudio do robô vem do ACERVO (bucket `chat-media`, que aceita) —
// é o caminho pedido pelo operador ("um arquivo pré-gravado do acervo").
const MEDIA_ACCEPT: Record<"image" | "video" | "document", string> = {
  image: "image/png,image/jpeg,image/webp",
  video: "video/mp4,video/3gpp",
  document:
    "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain",
};

const FLOW_MEDIA_BUCKET = "flow-media";

function SendMediaForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  t,
}: {
  cfg: SendMediaCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [acervoAberto, setAcervoAberto] = useState(false);
  // A conta do ROBÔ recorta o acervo: a RLS devolveria o de toda conta de que
  // a pessoa é membro (Codex, PR #314).
  const { flow } = useFlowEditor();
  const tUpload = useTranslations("Upload");
  const tResumo = useTranslations("Flows.summary");

  const mediaType = cfg.media_type ?? "image";
  const isDocument = mediaType === "document";
  const isAudio = mediaType === "audio";
  const acervoId = cfg.acervo_id || null;

  // O acervo só é lido quando o nó aponta para um item: é o que diz se o
  // item ainda existe (apagado, o robô falharia no envio) e o título atual.
  const acervo = useAcervo(Boolean(acervoId), flow.account_id);
  // ⚠️ O item escolhido AGORA vem do seletor, que leu o acervo na hora — a
  // lista acima pode ser de antes de ele existir (subido noutra aba), e sem
  // esta foto a tela diria "apagado do acervo" sobre o item recém-escolhido.
  const [escolhido, setEscolhido] = useState<MediaLibraryItem | null>(null);
  const itemDoAcervo = acervoId
    ? escolhido?.id === acervoId
      ? escolhido
      : (acervo.itens.find((i) => i.id === acervoId) ?? null)
    : null;
  const itemApagado =
    Boolean(acervoId) && acervo.jaCarregou && !acervo.falhou && !itemDoAcervo;
  // ⚠️ No número OFICIAL só .ogg (Opus) vira nota de voz; .mp3/.m4a gravado
  // no celular chega como ARQUIVO de áudio. Avisar aqui é o que evita o
  // operador contar com a "voz do Dr." e o cliente receber um anexo.
  const audioSemNotaDeVozNaMeta =
    isAudio && itemDoAcervo !== null && !audioViraNotaDeVozNaMeta(itemDoAcervo.mime_type);

  const displayName =
    itemDoAcervo?.titulo ||
    cfg.filename ||
    (cfg.media_url ? cfg.media_url.split("/").pop() ?? "" : "");
  const temArquivo = Boolean(acervoId || cfg.media_url);

  const handleFile = useCallback(
    async (file: File) => {
      if (file.size > MEDIA_MAX_BYTES) {
        toast.error(
          t("fileTooLarge", { size: (file.size / 1024 / 1024).toFixed(1) }),
        );
        return;
      }
      setUploading(true);
      try {
        // Account-scoped upload (path `account-<id>/...`) — see
        // uploadAccountMedia + migration 020's flow-media RLS policy.
        const { publicUrl } = await uploadAccountMedia(FLOW_MEDIA_BUCKET, file);
        // Patch all fields in one call so the form doesn't re-render
        // with a half-uploaded state. O upload SOLTA o item do acervo:
        // com `acervo_id` o motor ignoraria o arquivo novo.
        onUpdateConfig({
          media_url: publicUrl,
          filename: file.name,
          acervo_id: null,
        });
        toast.success(t("fileUploaded"));
      } catch (err) {
        toast.error(mensagemDoUpload(err, tUpload, t("uploadFailed")));
      } finally {
        setUploading(false);
      }
    },
    [onUpdateConfig, t, tUpload],
  );

  const escolherDoAcervo = (item: MediaLibraryItem) => {
    // O TIPO vem do item (o operador escolhe "qualquer arquivo"); a URL fica
    // só para a tela mostrar — o motor copia o item a cada envio. Áudio perde
    // a legenda: a nota de voz não leva texto (932).
    // O seletor mostra o acervo INTEIRO: quem estava em "Áudio" e tocou num
    // PDF vê o passo virar "Documento" — dito, não em silêncio.
    if (cfg.media_type && cfg.media_type !== item.tipo) {
      toast.info(t("mediaTypeFollowsLibrary", { tipo: tResumo(item.tipo) }));
    }
    onUpdateConfig({
      acervo_id: item.id,
      media_type: item.tipo,
      media_url: item.media_url,
      filename: item.filename,
      ...(item.tipo === "audio" ? { caption: "" } : {}),
    });
    setEscolhido(item);
    setAcervoAberto(false);
  };

  const handleClear = () => {
    onUpdateConfig({ media_url: "", filename: "", acervo_id: null });
  };

  return (
    <>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">{t("mediaTypeLabel")}</label>
        <Select
          value={mediaType}
          onValueChange={(v) => {
            // Changing type clears the existing file — the bucket
            // accepts different MIME sets per type and a previously
            // uploaded PDF can't be sent as an image.
            const tipo = v as NonNullable<SendMediaCfg["media_type"]>;
            onUpdateConfig({
              media_type: tipo,
              media_url: "",
              filename: "",
              acervo_id: null,
              ...(tipo === "audio" ? { caption: "" } : {}),
            });
          }}
        >
          <SelectTrigger className="bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="image">{t("imageLabel")}</SelectItem>
            <SelectItem value="video">{t("videoLabel")}</SelectItem>
            <SelectItem value="document">
              {t("documentLabel")}
            </SelectItem>
            <SelectItem value="audio">{t("audioLabel")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="mb-1 block text-xs text-muted-foreground">{t("fileLabel")}</label>
        {temArquivo ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs">
            {acervoId ? (
              <Library className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
            ) : (
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
            )}
            <a
              href={itemDoAcervo?.media_url || cfg.media_url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate text-foreground hover:text-cyan-300"
              title={displayName || cfg.media_url}
            >
              {displayName || cfg.media_url}
            </a>
            {acervoId && (
              <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                {t("fromLibraryBadge")}
              </span>
            )}
            <button
              type="button"
              onClick={handleClear}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("removeFile")}
              disabled={uploading}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => setAcervoAberto(true)}
              className="flex flex-1 items-center justify-center gap-2 rounded-md border border-dashed border-border bg-card px-3 py-4 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Library className="h-3.5 w-3.5" />
              {t("pickFromLibrary")}
            </button>
            {/* Upload do computador só para imagem, vídeo e documento: o
                bucket do robô não aceita áudio (ver MEDIA_ACCEPT). */}
            {!isAudio && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex flex-1 items-center justify-center gap-2 rounded-md border border-dashed border-border bg-card px-3 py-4 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t("uploading")}
                  </>
                ) : (
                  <>
                    <Upload className="h-3.5 w-3.5" />
                    {t("clickToUpload")}
                  </>
                )}
              </button>
            )}
          </div>
        )}
        {itemApagado && (
          <p className="mt-1 text-[10px] text-red-700 dark:text-red-300">
            {t("libraryItemMissing")}
          </p>
        )}
        {isAudio && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            {t("audioHelp")}
          </p>
        )}
        {audioSemNotaDeVozNaMeta && (
          <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
            {t("audioNotOggWarning")}
          </p>
        )}
        {!isAudio && (
          <input
            ref={fileInputRef}
            type="file"
            accept={MEDIA_ACCEPT[mediaType]}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              // Reset so picking the same file twice still fires onChange.
              e.target.value = "";
            }}
          />
        )}
        <AcervoPicker
          open={acervoAberto}
          onOpenChange={setAcervoAberto}
          onPick={escolherDoAcervo}
          contaId={flow.account_id}
        />
      </div>

      {/* Áudio não leva legenda (932): a nota de voz não tem campo de texto. */}
      {!isAudio && (
        <TextRow
          label={t("captionLabel")}
          value={cfg.caption ?? ""}
          onChange={(v) => onUpdateConfig({ caption: v })}
          rows={2}
        />
      )}

      {isDocument && (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            {t("filenameLabel")}
          </label>
          <Input
            value={cfg.filename ?? ""}
            onChange={(e) => onUpdateConfig({ filename: e.target.value })}
            placeholder={t("filenamePlaceholder")}
            className="bg-muted text-xs"
          />
        </div>
      )}

      <NextNodeRow
        value={cfg.next_node_key ?? ""}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ next_node_key: v })}
        label={t("advanceAfterSending")}
      />
    </>
  );
}
