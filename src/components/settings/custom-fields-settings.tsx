'use client';

import { Shield, SlidersHorizontal } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import { CustomFieldsPanel } from '@/components/contacts/custom-fields-manager';
import { SettingsChip } from './settings-chip';

/**
 * Settings → Custom Fields card. Manages the account-wide custom
 * contact field catalogue (the same panel the Contacts page exposes
 * via a dialog). Writes are admin-gated by the caller and enforced by
 * `custom_fields` RLS.
 */
export function CustomFieldsSettings() {
  const t = useTranslations('Settings.tagsAndFields');
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <SlidersHorizontal className="size-4 text-primary" />
          {t('fieldsTitle')}
          <SettingsChip variant="admin" className="font-medium">
            <Shield />
            {t('adminRole')}
          </SettingsChip>
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t('fieldsDesc')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* A lista é mais alta AQUI, e só aqui: a caixa de 288px do diálogo da
            página de Contatos mostrava ~5 dos 15 campos desta conta, e nesta
            tela sobra página. O teto em `vh` existe porque a altura fixa
            sozinha viraria um cartão maior que a tela num laptop de 768px. */}
        <CustomFieldsPanel alturaDaLista="max-h-[min(36rem,60vh)]" />
      </CardContent>
    </Card>
  );
}
