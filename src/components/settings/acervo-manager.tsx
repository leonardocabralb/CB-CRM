'use client';

import {
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Pencil,
  Trash2,
  Upload,
  Video,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAcervo } from '@/hooks/use-acervo';
import { useCan } from '@/hooks/use-can';
import { categoriasDe, tamanhoLegivel } from '@/lib/acervo/filtro';
import {
  ACCEPT_DO_SELETOR,
  SUBPASTA_DO_ACERVO,
  type TipoDeMidia,
  tipoPeloMime,
} from '@/lib/acervo/tipos';
import { CHAT_MEDIA_BUCKET } from '@/lib/storage/buckets';
import {
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
  uploadAccountMedia,
} from '@/lib/storage/upload-media';
import type { MediaLibraryItem } from '@/types';

import { SettingsPanelHead } from './settings-panel-head';

const ICONE: Record<TipoDeMidia, typeof FileText> = {
  image: ImageIcon,
  video: Video,
  document: FileText,
  audio: Mic,
};

/**
 * Acervo de mídias (migration 953) — a tela onde o escritório monta a
 * prateleira que os atendentes usam dentro da conversa.
 *
 * ⚠️ O ARQUIVO sobe daqui direto para o Storage e só a LINHA passa pela rota.
 * Por isso o upload acontece ANTES do cadastro, e um cadastro que falha
 * APAGA o objeto recém-subido — sem isso, cada erro de rede deixaria um
 * arquivo pago no bucket que ninguém enxerga para limpar.
 */
export function AcervoManager() {
  const t = useTranslations('Settings.acervo');
  const podeGerenciar = useCan('manage-members');
  const { itens, jaCarregou, falhou, recarregar } = useAcervo();
  const inputRef = useRef<HTMLInputElement>(null);

  const [subindo, setSubindo] = useState(false);
  const [editando, setEditando] = useState<MediaLibraryItem | null>(null);
  const [tituloEdit, setTituloEdit] = useState('');
  const [categoriaEdit, setCategoriaEdit] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [apagando, setApagando] = useState<string | null>(null);

  const categorias = useMemo(() => categoriasDe(itens), [itens]);

  /**
   * Sobe o arquivo e cadastra a linha.
   *
   * O título nasce do nome do arquivo, sem extensão: é o que a pessoa acabou
   * de escolher e reconhece. Renomear fica a um clique de distância — pedir o
   * título ANTES de subir faria o operador digitar duas vezes na maioria dos
   * casos (o nome do arquivo já serve).
   */
  const subirArquivo = useCallback(
    async (file: File) => {
      const tipo = tipoPeloMime(file.type);
      if (!tipo) {
        toast.error(t('unsupportedType'));
        return;
      }
      const teto = MEDIA_MAX_BYTES_BY_KIND[tipo];
      if (file.size > teto) {
        toast.error(
          t('tooBig', {
            tamanho: tamanhoLegivel(file.size),
            teto: tamanhoLegivel(teto),
          })
        );
        return;
      }

      setSubindo(true);
      let caminho: string | null = null;
      try {
        const { path } = await uploadAccountMedia(
          CHAT_MEDIA_BUCKET,
          file,
          SUBPASTA_DO_ACERVO
        );
        caminho = path;

        const res = await fetch('/api/cb/acervo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // Sem a extensão — mas um arquivo chamado ".pdf" ficaria com
            // título vazio, que a rota recusa com 400 e a tela reportaria
            // como "não foi possível adicionar", sem dizer por quê.
            titulo:
              file.name.replace(/\.[^.]+$/, '').slice(0, 120) ||
              file.name.slice(0, 120),
            media_path: path,
            mime_type: file.type,
            size_bytes: file.size,
            filename: file.name,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(
            json?.error === 'FILE_ALREADY_IN_LIBRARY'
              ? t('alreadyInLibrary')
              : t('uploadError')
          );
          // O cadastro falhou: o objeto no bucket não pertence a ninguém.
          void deleteAccountMedia(CHAT_MEDIA_BUCKET, path).catch(() => {});
          return;
        }
        caminho = null; // cadastrado — o arquivo agora é do acervo
        toast.success(t('addedToast'));
        await recarregar();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('uploadError'));
        if (caminho) {
          void deleteAccountMedia(CHAT_MEDIA_BUCKET, caminho).catch(() => {});
        }
      } finally {
        setSubindo(false);
      }
    },
    [recarregar, t]
  );

  const salvarEdicao = useCallback(async () => {
    if (!editando) return;
    const titulo = tituloEdit.trim();
    if (!titulo) {
      toast.error(t('titleRequired'));
      return;
    }
    setSalvando(true);
    try {
      const res = await fetch(`/api/cb/acervo/${editando.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // `categoria: ''` é "tira a categoria" — a rota distingue isso de
        // ausente ("não mexe"). Sem a distinção, não haveria como devolver um
        // item para o Geral.
        body: JSON.stringify({ titulo, categoria: categoriaEdit.trim() }),
      });
      if (!res.ok) {
        toast.error(t('saveError'));
        return;
      }
      setEditando(null);
      await recarregar();
    } catch {
      toast.error(t('saveError'));
    } finally {
      setSalvando(false);
    }
  }, [editando, tituloEdit, categoriaEdit, recarregar, t]);

  const apagar = useCallback(
    async (item: MediaLibraryItem) => {
      // ⚠️ O aviso diz que o arquivo sai do acervo, NÃO que ele some das
      // conversas: quem enviou o item continua com a cópia dele no fio (a
      // rota de envio copia o objeto). Sem essa frase, o operador hesita em
      // limpar o acervo com medo de quebrar o histórico.
      if (!window.confirm(t('confirmDelete', { titulo: item.titulo }))) return;
      setApagando(item.id);
      try {
        const res = await fetch(`/api/cb/acervo/${item.id}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          toast.error(t('deleteError'));
          return;
        }
        await recarregar();
      } catch {
        toast.error(t('deleteError'));
      } finally {
        setApagando(null);
      }
    },
    [recarregar, t]
  );

  // Agrupado por categoria, com o Geral por último — a mesma ordem que o
  // seletor do compositor mostra.
  const grupos = useMemo(() => {
    const mapa = new Map<string, MediaLibraryItem[]>();
    for (const item of itens) {
      const chave = item.categoria?.trim() || '';
      const lista = mapa.get(chave);
      if (lista) lista.push(item);
      else mapa.set(chave, [item]);
    }
    return [...mapa.entries()].sort(([a], [b]) => {
      if (a === '') return 1;
      if (b === '') return -1;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });
  }, [itens]);

  return (
    <div>
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          podeGerenciar ? (
            <Button onClick={() => inputRef.current?.click()} disabled={subindo}>
              {subindo ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Upload className="mr-2 size-4" />
              )}
              {t('add')}
            </Button>
          ) : undefined
        }
      />

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_DO_SELETOR}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Zera o valor para que escolher O MESMO arquivo de novo dispare o
          // evento — sem isto, uma segunda tentativa depois de um erro não
          // acontece e a tela parece travada.
          e.target.value = '';
          if (file) void subirArquivo(file);
        }}
      />

      {!jaCarregou ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : falhou ? (
        <p className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          {t('loadError')}
        </p>
      ) : itens.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grupos.map(([categoria, lista]) => (
            <section key={categoria || '__geral__'}>
              <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                {categoria || t('uncategorized')}
              </h3>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {lista.map((item) => {
                  const Icone = ICONE[item.tipo];
                  return (
                    <li
                      key={item.id}
                      className="flex items-center gap-3 px-3 py-2.5"
                    >
                      <Icone className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {item.titulo}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.filename} · {tamanhoLegivel(item.size_bytes)}
                          {item.criador_nome ? ` · ${item.criador_nome}` : ''}
                        </p>
                      </div>
                      <a
                        href={item.media_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        {t('preview')}
                      </a>
                      {podeGerenciar && (
                        <>
                          <button
                            type="button"
                            title={t('edit')}
                            aria-label={t('edit')}
                            onClick={() => {
                              setEditando(item);
                              setTituloEdit(item.titulo);
                              setCategoriaEdit(item.categoria ?? '');
                            }}
                            className="shrink-0 p-1 text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            title={t('delete')}
                            aria-label={t('delete')}
                            disabled={apagando === item.id}
                            onClick={() => void apagar(item)}
                            className="shrink-0 p-1 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Dialog
        open={Boolean(editando)}
        onOpenChange={(aberto) => {
          if (!aberto) setEditando(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('editTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t('fieldTitle')}
              </label>
              <Input
                value={tituloEdit}
                maxLength={120}
                onChange={(e) => setTituloEdit(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t('fieldCategory')}
              </label>
              <Input
                value={categoriaEdit}
                maxLength={60}
                list="acervo-categorias"
                placeholder={t('categoryPlaceholder')}
                onChange={(e) => setCategoriaEdit(e.target.value)}
              />
              {/* Sugestão, não lista fechada: categoria é texto livre (953), e
                  um <select> obrigaria a criar categoria antes de usá-la. */}
              <datalist id="acervo-categorias">
                {categorias.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditando(null)}>
              {t('cancel')}
            </Button>
            <Button onClick={() => void salvarEdicao()} disabled={salvando}>
              {salvando && <Loader2 className="mr-2 size-4 animate-spin" />}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
