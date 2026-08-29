'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { TIPO_DATA } from '@/lib/contacts/campo-data';
import { gerarChaveDeCampo } from '@/lib/contacts/chave-do-campo';
import { opcoesDoCampo } from '@/components/contacts/campo-personalizado-input';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { CustomField } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, Copy, Loader2, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface CustomFieldsManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Dialog wrapper around {@link CustomFieldsPanel}, used on the Contacts page.
 * The same panel is rendered inline under Settings → Custom Fields, so the
 * editing UI lives in one place. Radix unmounts the dialog content on close,
 * so the panel remounts (and refetches) on each open.
 */
export function CustomFieldsManager({
  open,
  onOpenChange,
}: CustomFieldsManagerProps) {
  const t = useTranslations('Contacts.customFields');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t('title')}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('desc')}
          </DialogDescription>
        </DialogHeader>
        <CustomFieldsPanel />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Create / rename / delete account-wide custom contact field definitions.
 * Per-contact values are edited elsewhere (contact detail → Custom Fields);
 * this only manages the field catalogue. Admin+ gated by the caller — the
 * `custom_fields` RLS also rejects non-admin writes as defense in depth.
 */
export function CustomFieldsPanel() {
  const t = useTranslations('Contacts.customFields');
  const supabase = createClient();
  const { user, accountId } = useAuth();

  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  // Tipo do campo. Até a 935 todo campo nascia 'text' e a coluna era
  // decorativa; 'datetime' é o que o gatilho de lembrete lê, e a 948 fechou
  // o universo em (text, datetime, select, number) com CHECK.
  const [newType, setNewType] = useState<string>('text');
  /**
   * O identificador (948). Sugerido a partir do nome ENQUANTO o operador não
   * o tocar — depois disso a sugestão para de atropelar o que ele digitou.
   * O gerador é o gêmeo TS do SQL, então o que aparece aqui é o que o banco
   * gravaria de qualquer forma.
   */
  const [newKey, setNewKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  /** Opções do tipo `select`, separadas por vírgula (viram JSON no banco). */
  const [newOptions, setNewOptions] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchFields = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase
      .from('custom_fields')
      .select('*')
      .order('field_name');
    setFields((data as CustomField[] | null) ?? []);
    setLoading(false);
  }, [supabase, accountId]);

  // Load the field list on mount once the account is known. The setters
  // inside fetchFields run after the Supabase await — not synchronously in
  // the effect body — so the cascade the lint rule warns about doesn't apply.
  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchFields();
    }
  }, [accountId, fetchFields]);

  /** Case-insensitive name clash within the loaded list. */
  function isDuplicate(name: string, exceptId?: string): boolean {
    const lower = name.toLowerCase();
    return fields.some(
      (f) => f.id !== exceptId && f.field_name.toLowerCase() === lower
    );
  }

  /** "A, B , ,B" → ["A","B"] — apara, tira vazio e repetido. */
  function parseOpcoes(texto: string): string[] {
    return [...new Set(texto.split(',').map((o) => o.trim()).filter(Boolean))];
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    if (!accountId || !user) {
      toast.error(t('toastNoAccount'));
      return;
    }
    if (isDuplicate(name)) {
      toast.error(t('toastDuplicate', { name }));
      return;
    }

    setCreating(true);
    const { error } = await supabase.from('custom_fields').insert({
      field_name: name,
      field_type: newType,
      // A chave viaja NORMALIZADA (o gatilho da 948 normalizaria igual, mas
      // mandar pronto evita a tela mostrar uma coisa e o banco gravar outra).
      // Vazia → null, e o gatilho gera do nome.
      field_key: gerarChaveDeCampo(newKey.trim() || name) || null,
      field_options:
        newType === 'select' ? { opcoes: parseOpcoes(newOptions) } : null,
      user_id: user.id,
      account_id: accountId,
    });
    setCreating(false);

    if (error) {
      // 23505 = o índice único da chave (948): identificador já usado na conta.
      toast.error(
        error.code === '23505' ? t('toastKeyTaken') : t('toastCreateFailed'),
      );
      return;
    }
    toast.success(t('toastCreated', { name }));
    setNewName('');
    setNewType('text');
    setNewKey('');
    setKeyTouched(false);
    setNewOptions('');
    await fetchFields();
  }

  /**
   * Opções de um campo `select` existente — o catálogo muda com o tempo
   * ("Origem da dívida" ganha uma origem nova) e apagar/recriar o campo
   * perderia os valores já gravados nos contatos.
   */
  async function handleSaveOptions(
    field: CustomField,
    texto: string,
  ): Promise<boolean> {
    setBusyId(field.id);
    const { error } = await supabase
      .from('custom_fields')
      .update({ field_options: { opcoes: parseOpcoes(texto) } })
      .eq('id', field.id);
    setBusyId(null);
    if (error) {
      toast.error(t('toastOptionsFailed'));
      return false;
    }
    await fetchFields();
    return true;
  }

  /** Returns true on success so the row can keep the new name, false so it
   *  reverts to the previous one. No-ops (blank / unchanged) count as success. */
  async function handleRename(
    field: CustomField,
    nextName: string
  ): Promise<boolean> {
    const name = nextName.trim();
    if (!name || name === field.field_name) return true;
    if (isDuplicate(name, field.id)) {
      toast.error(t('toastDuplicate', { name }));
      return false;
    }
    setBusyId(field.id);
    const { error } = await supabase
      .from('custom_fields')
      .update({ field_name: name })
      .eq('id', field.id);
    setBusyId(null);
    if (error) {
      toast.error(t('toastRenameFailed'));
      return false;
    }
    await fetchFields();
    return true;
  }

  async function handleDelete(field: CustomField) {
    if (
      !window.confirm(
        t('deleteConfirm', { name: field.field_name })
      )
    ) {
      return;
    }
    setBusyId(field.id);
    const { error } = await supabase
      .from('custom_fields')
      .delete()
      .eq('id', field.id);
    setBusyId(null);
    if (error) {
      toast.error(t('toastDeleteFailed'));
      return;
    }
    toast.success(t('toastDeleted', { name: field.field_name }));
    await fetchFields();
  }

  return (
    <div className="space-y-4">
      {/* Create */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              // A sugestão segue o nome só até o operador mexer na chave.
              if (!keyTouched) setNewKey(gerarChaveDeCampo(e.target.value));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleCreate();
              }
            }}
            placeholder={t('fieldName')}
            className="bg-muted text-foreground"
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            className="shrink-0 rounded-md border border-border bg-muted px-2 py-2 text-sm text-foreground"
            aria-label={t('fieldType')}
          >
            <option value="text">{t('typeText')}</option>
            <option value={TIPO_DATA}>{t('typeDate')}</option>
            <option value="select">{t('typeSelect')}</option>
            <option value="number">{t('typeNumber')}</option>
          </select>
          <Button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
          >
            {creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            {t('addField')}
          </Button>
        </div>

        {/* O identificador (948) — o que a API usa para achar o campo.
            Sempre visível na criação: se ficasse escondido, o operador só
            descobriria a chave gerada depois, quando renomeá-la já não dá. */}
        {newName.trim() !== '' && (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-muted-foreground">
              {t('fieldKey')}
            </span>
            <Input
              value={newKey}
              onChange={(e) => {
                setKeyTouched(true);
                setNewKey(e.target.value);
              }}
              onBlur={() => setNewKey(gerarChaveDeCampo(newKey))}
              placeholder={t('fieldKeyPlaceholder')}
              className="h-8 bg-muted font-mono text-xs text-foreground"
            />
          </div>
        )}

        {newType === 'select' && (
          <Input
            value={newOptions}
            onChange={(e) => setNewOptions(e.target.value)}
            placeholder={t('optionsPlaceholder')}
            aria-label={t('optionsLabel')}
            className="bg-muted text-foreground"
          />
        )}
      </div>

      {/* List */}
      <div className="max-h-72 overflow-y-auto rounded-md border border-border">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('loading')}
          </div>
        ) : fields.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('empty')}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {fields.map((field) => (
              <FieldRow
                key={field.id}
                field={field}
                busy={busyId === field.id}
                onRename={handleRename}
                onSaveOptions={handleSaveOptions}
                onDelete={handleDelete}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A single editable row. Controlled local state lets us commit on blur /
 *  Enter and cleanly revert to the last saved name when a rename fails. */
function FieldRow({
  field,
  busy,
  onRename,
  onSaveOptions,
  onDelete,
}: {
  field: CustomField;
  busy: boolean;
  onRename: (field: CustomField, name: string) => Promise<boolean>;
  onSaveOptions: (field: CustomField, texto: string) => Promise<boolean>;
  onDelete: (field: CustomField) => void;
}) {
  const t = useTranslations('Contacts.customFields');
  const [name, setName] = useState(field.field_name);
  const [opcoes, setOpcoes] = useState(opcoesDoCampo(field).join(', '));
  const [copied, setCopied] = useState(false);

  async function commit() {
    if (name.trim() === field.field_name) {
      setName(field.field_name); // normalise any whitespace-only edit
      return;
    }
    const ok = await onRename(field, name);
    if (!ok) setName(field.field_name);
  }

  async function commitOpcoes() {
    const atual = opcoesDoCampo(field).join(', ');
    if (opcoes.trim() === atual) {
      setOpcoes(atual);
      return;
    }
    const ok = await onSaveOptions(field, opcoes);
    if (!ok) setOpcoes(atual);
  }

  async function copiarChave() {
    await navigator.clipboard.writeText(field.field_key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-2">
        <Input
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          aria-label={t('renameAria', { name: field.field_name })}
          className="focus:border-primary h-8 border-transparent bg-transparent text-foreground hover:border-border"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          onClick={() => onDelete(field)}
          title={t('deleteTitle')}
          className="shrink-0 text-muted-foreground hover:text-red-400"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
        </Button>
      </div>

      {/* A chave (948): imutável depois de criada — renomear o CAMPO não a
          muda, de propósito, senão toda integração externa quebraria a cada
          renomeio cosmético. O botão copia para colar na API. */}
      <button
        type="button"
        onClick={copiarChave}
        title={t('copyKeyTitle')}
        className="mt-0.5 flex items-center gap-1 px-1 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        {field.field_key}
        {copied ? (
          <Check className="size-3 text-primary" />
        ) : (
          <Copy className="size-3" />
        )}
      </button>

      {field.field_type === 'select' && (
        <Input
          value={opcoes}
          disabled={busy}
          onChange={(e) => setOpcoes(e.target.value)}
          onBlur={commitOpcoes}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          aria-label={t('optionsLabel')}
          placeholder={t('optionsPlaceholder')}
          className="mt-1 h-8 bg-muted text-xs text-foreground"
        />
      )}
    </li>
  );
}
