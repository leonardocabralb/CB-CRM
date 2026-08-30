import {
  Coins,
  FileText,
  KeyRound,
  Library,
  LayoutGrid,
  Palette,
  Plug,
  Shield,
  Smartphone,
  Tags,
  User,
  UsersRound,
  Zap,
  type LucideIcon,
  PenLine,
} from 'lucide-react';

/**
 * Settings information architecture for the redesigned page.
 *
 * The flat tab strip became a grouped left rail with a new Overview
 * landing. The URL query param stays `?tab=` (deep-linkable, and it
 * keeps the existing links in sidebar.tsx / header.tsx working) — we
 * just map the old values onto the new sections.
 */
export const SETTINGS_SECTIONS = [
  'overview',
  'profile',
  'security',
  'appearance',
  'channels',
  'templates',
  'quick-replies',
  'acervo',
  'fields',
  'deals',
  'assinatura',
  'members',
  'integracoes',
  'api',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SECTION: SettingsSection = 'overview';

/** Rail grouping. `adminOnly` items are hidden for non-admins. */
export interface SectionMeta {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: 'top' | 'account' | 'workspace';
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  overview: { id: 'overview', label: 'Overview', icon: LayoutGrid, group: 'top' },
  profile: { id: 'profile', label: 'Your profile', icon: User, group: 'account' },
  security: { id: 'security', label: 'Login & security', icon: Shield, group: 'account' },
  appearance: { id: 'appearance', label: 'Appearance', icon: Palette, group: 'account' },
  // Canais (CB Advogados) — o único lar das conexões de WhatsApp: números
  // Meta (API oficial) e números por QR Code via Evolution, N por conta.
  // Substituiu a antiga seção 'whatsapp' (EvolutionConnect single-channel);
  // o valor legado de ?tab= é remapeado em resolveSection abaixo.
  channels: { id: 'channels', label: 'Connections', icon: Smartphone, group: 'workspace' },
  templates: { id: 'templates', label: 'Templates', icon: FileText, group: 'workspace' },
  'quick-replies': { id: 'quick-replies', label: 'Quick replies', icon: Zap, group: 'workspace' },
  // Acervo (CB Advogados, 953) — os arquivos pré-selecionados que a equipe
  // envia de dentro da conversa. Vizinho de Respostas rápidas de propósito:
  // são a mesma ideia (conteúdo pronto para reusar), uma em texto e outra em
  // arquivo.
  acervo: { id: 'acervo', label: 'Media library', icon: Library, group: 'workspace' },
  fields: { id: 'fields', label: 'Fields & tags', icon: Tags, group: 'workspace' },
  deals: { id: 'deals', label: 'Deals & currency', icon: Coins, group: 'workspace' },
  assinatura: { id: 'assinatura', label: 'Message signature', icon: PenLine, group: 'workspace' },
  members: { id: 'members', label: 'Team members', icon: UsersRound, group: 'workspace' },
  // Integrações (CB Advogados) — chaves de IA, Google Agenda e o que
  // vier (TLDV, Calendly…), com estado ao vivo por integração.
  integracoes: { id: 'integracoes', label: 'Integrations', icon: Plug, group: 'workspace' },
  api: { id: 'api', label: 'API keys', icon: KeyRound, group: 'workspace' },
};

export const RAIL_GROUPS: { label: string | null; group: SectionMeta['group'] }[] = [
  { label: null, group: 'top' },
  { label: 'Account', group: 'account' },
  { label: 'Workspace', group: 'workspace' },
];

function isSection(value: string | null): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * Resolve a raw `?tab=` value to a section. Legacy tabs from the old
 * flat layout collapse onto their new home (Tags + Custom fields → the
 * merged "Fields & tags" section). Anything unknown falls back to the
 * Overview landing.
 */
export function resolveSection(raw: string | null): SettingsSection {
  if (raw === 'tags' || raw === 'custom-fields') return 'fields';
  // A antiga seção WhatsApp (single-channel) virou a seção de Conexões.
  if (raw === 'whatsapp') return 'channels';
  if (isSection(raw)) return raw;
  return DEFAULT_SECTION;
}
