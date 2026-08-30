'use client';

// ============================================================
// PerfilResumo — a legenda de um perfil, derivada da CONFIGURAÇÃO REAL.
//
// Usada no diálogo de convite (para o admin saber o que está dando antes de
// gerar o link) e na lista de Membros (o quadro "o que cada perfil dá").
// Nunca texto fixo no dicionário descrevendo o perfil: legenda escrita à mão
// mente na primeira edição do perfil — pedido explícito do operador.
// ============================================================

import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { TODAS_AS_TELAS, TELAS_SEMPRE_VISIVEIS, type TelaId } from '@/lib/perfis/catalogo';

/** TelaId → chave do namespace Sidebar (mesmo mapa do PerfisPanel). */
const ROTULO_DA_TELA: Record<TelaId, string> = {
  dashboard: 'dashboard',
  radar: 'radar',
  inbox: 'inbox',
  notifications: 'notifications',
  tarefas: 'tasks',
  contacts: 'contacts',
  agenda: 'agenda',
  pipelines: 'pipelines',
  broadcasts: 'broadcasts',
  agendadas: 'scheduled',
  automations: 'automations',
  flows: 'flows',
  agents: 'aiAgents',
  settings: 'settings',
};

export interface PerfilParaResumo {
  nome: string;
  papel_base: 'admin' | 'agent' | 'viewer';
  telas: string[];
  channel_ids: string[];
  pipeline_ids: string[];
}

export function PerfilResumo({ perfil }: { perfil: PerfilParaResumo }) {
  const t = useTranslations('PerfisPanel');
  const tSidebar = useTranslations('Sidebar');
  const tRoles = useTranslations('Settings.roles');

  const visiveis = TODAS_AS_TELAS.filter(
    (tela) =>
      (TELAS_SEMPRE_VISIVEIS as readonly string[]).includes(tela) ||
      perfil.telas.includes(tela),
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="border-border text-muted-foreground">
          {tRoles(perfil.papel_base)}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {perfil.channel_ids.length === 0
            ? t('allChannels')
            : t('someChannels', { count: perfil.channel_ids.length })}
          {' · '}
          {perfil.pipeline_ids.length === 0
            ? t('allPipelines')
            : t('somePipelines', { count: perfil.pipeline_ids.length })}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {visiveis.map((tela) => (
          <span
            key={tela}
            className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            {tSidebar(ROTULO_DA_TELA[tela])}
          </span>
        ))}
      </div>
    </div>
  );
}
