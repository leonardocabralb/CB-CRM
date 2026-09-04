'use client';

// ============================================================
// AreasDoPerfil — "o que este perfil vê", em grupos.
//
// Substitui as duas grades chapadas do editor (14 telas + 11 seções, 25
// caixas idênticas) por quatro áreas com caixa de grupo e detalhe recolhido,
// mais o grupo "Só leitura para este papel". Quem decide o que vai em cada
// grupo é `lib/perfis/editor.ts` (puro, testado); aqui só se desenha.
//
// As seções pelo MESMO dicionário do rail de Configurações
// (`Settings.sections`): `SECTION_META.label` é inglês fixo ("Connections")
// num app pt-BR (ledger 48h, r3). Id declarado à frente da tela aparece CRU,
// não num rótulo emprestado — foi um fallback assim que fez o fantasma
// `deals` virar um segundo "Perfis de acesso" idêntico ao verdadeiro.
// ============================================================

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, Eye, Lock } from 'lucide-react';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ROTULO_DA_TELA, type SecaoId, type TelaId } from '@/lib/perfis/catalogo';
import {
  alternarGrupo,
  estadoDoGrupo,
  gruposAbertosDeInicio,
  gruposDoEditor,
  itemMarcado,
  itemTravado,
  type AreaId,
  type ItemDoEditor,
} from '@/lib/perfis/editor';
import type { PapelBase } from '@/lib/perfis/tipos';
import { SECTION_META } from './settings-sections';

interface Props {
  papel: PapelBase;
  telas: TelaId[];
  secoes: SecaoId[];
  onChange: (proximo: { telas: TelaId[]; secoes_config: SecaoId[] }) => void;
}

export function AreasDoPerfil({ papel, telas, secoes, onChange }: Props) {
  const t = useTranslations('PerfisPanel');
  const tSidebar = useTranslations('Sidebar');
  const tSecoes = useTranslations('Settings.sections');

  const rascunho = { telas, secoes_config: secoes };
  // Repartido a cada render: trocar o Papel move itens entre as áreas e o
  // grupo de só leitura, com as marcações preservadas (são as mesmas listas).
  const grupos = gruposDoEditor(papel);

  // Expansão é estado LOCAL, semeado uma vez na montagem — o diálogo desmonta
  // o conteúdo ao fechar, então cada abertura recomeça pela regra do módulo
  // (só o parcialmente marcado abre). Não persegue as props depois: abrir e
  // fechar é da pessoa.
  const [abertos, setAbertos] = useState<Set<AreaId>>(
    () => new Set(gruposAbertosDeInicio(papel, rascunho, grupos)),
  );
  const alternarAberto = (area: AreaId) =>
    setAbertos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(area)) proximo.delete(area);
      else proximo.add(area);
      return proximo;
    });

  const rotulo = (item: ItemDoEditor) =>
    item.tipo === 'tela'
      ? tSidebar(ROTULO_DA_TELA[item.id] as Parameters<typeof tSidebar>[0])
      : item.id in SECTION_META
        ? tSecoes(item.id as Parameters<typeof tSecoes>[0])
        : item.id;

  const alternarItem = (item: ItemDoEditor) => {
    if (item.tipo === 'tela') {
      onChange({
        telas: telas.includes(item.id)
          ? telas.filter((v) => v !== item.id)
          : [...telas, item.id],
        secoes_config: secoes,
      });
    } else {
      onChange({
        telas,
        secoes_config: secoes.includes(item.id)
          ? secoes.filter((v) => v !== item.id)
          : [...secoes, item.id],
      });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-muted-foreground">{t('areasLabel')}</Label>
      <div className="flex flex-col gap-1.5">
        {grupos.map((grupo) => {
          const { estado, marcados, total } = estadoDoGrupo(papel, rascunho, grupo);
          const aberto = abertos.has(grupo.area);
          const soLeitura = grupo.area === 'so-leitura';
          const nome = t(`areas.${grupo.area}` as Parameters<typeof t>[0]);
          return (
            <div
              key={grupo.area}
              className={cn(
                'rounded-md border border-border',
                soLeitura && 'border-dashed',
              )}
            >
              <div className="flex items-center gap-2 px-2 py-1.5">
                {/* A caixa do grupo liga/desliga só o que é LIVRE; o travado
                    fica como está (é o que `alternarGrupo` garante). Clicar
                    num grupo parcial LIGA o resto — o sentido mais comum. */}
                <Checkbox
                  checked={estado === 'todos'}
                  indeterminate={estado === 'alguns'}
                  onCheckedChange={() =>
                    onChange(alternarGrupo(papel, rascunho, grupo, estado !== 'todos'))
                  }
                  aria-label={
                    estado === 'todos'
                      ? t('desmarcarGrupo', { area: nome })
                      : t('marcarGrupo', { area: nome })
                  }
                />
                <button
                  type="button"
                  onClick={() => alternarAberto(grupo.area)}
                  aria-expanded={aberto}
                  title={aberto ? t('ocultarItens') : t('mostrarItens')}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium text-foreground"
                >
                  {soLeitura && <Eye className="size-3.5 shrink-0 text-muted-foreground" />}
                  <span className="truncate">{nome}</span>
                  <span className="ml-auto shrink-0 font-normal tabular-nums text-muted-foreground">
                    {t('contagemDoGrupo', { marcados, total })}
                  </span>
                  {aberto ? (
                    <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                </button>
              </div>

              {aberto && (
                <div className="border-t border-border px-2 py-2">
                  {soLeitura && (
                    <p className="mb-2 text-xs text-muted-foreground">{t('soLeituraHint')}</p>
                  )}
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {grupo.itens.map((item) => {
                      const travado = itemTravado(papel, item);
                      const marcado = itemMarcado(papel, rascunho, item);
                      return (
                        <label
                          key={`${item.tipo}:${item.id}`}
                          className={cn(
                            'flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs',
                            travado ? 'opacity-60' : 'cursor-pointer hover:bg-muted',
                          )}
                        >
                          <Checkbox
                            checked={marcado}
                            disabled={travado}
                            onCheckedChange={() => alternarItem(item)}
                          />
                          <span className="text-foreground">{rotulo(item)}</span>
                          {travado && <Lock className="size-3 text-muted-foreground" />}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t('areasHint')}</p>
    </div>
  );
}
