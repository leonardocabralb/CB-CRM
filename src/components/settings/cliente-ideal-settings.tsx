'use client';

// ============================================================
// Configurações → Campos e etiquetas → "Cliente ideal (ICP)" (1124).
//
// Perfis com nome (D6), cada um com critérios sobre campos personalizados:
// TODOS os critérios casam (E) e, dentro de cada um, basta UMA das respostas
// marcadas (OU). Quem decide quem é ideal é o BANCO (`cb_clientes_ideais`);
// esta tela só grava a regra e mostra quantos ela marca hoje.
//
// As respostas oferecidas são as GRAVADAS no campo (formulário, automação,
// gente), com quantas fichas — o operador marca o padrão que reconhece.
// Resposta nova do formulário aparece aqui desmarcada.
//
// Escrita: admin (policies da 1124, `ESCRITA_DA_SECAO.fields`). RLS que barra
// devolve 0 linhas sem erro: toda escrita confere o retorno.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Gem, Loader2, Pencil, Plus, Shield, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';
import { opcoesDoCampo } from '@/lib/contacts/campo-opcoes';
import {
  MINIMO_DE_FICHAS_DO_PADRAO,
  TETO_DE_CRITERIOS,
  TETO_DE_RESPOSTAS,
  TETO_DO_NOME_DO_PERFIL,
  alternarResposta,
  contarPorPerfil,
  criteriosValidos,
  lerCriterios,
  nomeDoPerfilValido,
  respostaMarcada,
  respostasOferecidas,
  somentePadroes,
  type CriterioDeClienteIdeal,
  type PerfilDeClienteIdeal,
} from '@/lib/contacts/cliente-ideal';
import { lerClientesIdeais } from '@/lib/contacts/cliente-ideal-leitura';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { CustomField } from '@/types';

import { SettingsChip } from './settings-chip';

type Campo = Pick<CustomField, 'id' | 'field_name' | 'field_type' | 'field_options'>;

type Contagem = Map<string, { ideais: number; possiveis: number }>;

/** O que a tela carregou, carimbado com a conta (efeito passivo, seção 8c). */
type Carga =
  | { de: string; estado: 'erro' }
  | { de: string; estado: 'ok'; perfis: PerfilDeClienteIdeal[]; campos: Campo[]; contagem: Contagem | null };

const TABELA = 'cb_perfis_de_cliente_ideal';

/**
 * O erro do banco vira frase da tela; nada de texto cru do PostgREST. Chaves
 * LITERAIS de propósito: chave montada escapa dos portões de i18n.
 */
function mensagemDoErro(
  t: ReturnType<typeof useTranslations<'Settings.clienteIdeal'>>,
  codigo: string | undefined,
): string {
  if (codigo === '23505') return t('erroNomeRepetido');
  if (codigo === '23514') return t('erroInvalido');
  if (codigo === '42501') return t('erroSemPermissao');
  return t('erroSalvar');
}

export function ClienteIdealSettings() {
  const t = useTranslations('Settings.clienteIdeal');
  const supabase = createClient();
  const { accountId } = useAuth();
  const [carga, setCarga] = useState<Carga | null>(null);
  const [nonce, setNonce] = useState(0);
  /** O perfil aberto no editor: um id, `'novo'` ou nenhum. */
  const [editando, setEditando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const recarregar = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!accountId) return;
    let vivo = true;
    void (async () => {
      const [perfisRes, camposRes, ideais] = await Promise.all([
        supabase
          .from(TABELA)
          .select('id, account_id, nome, ativo, posicao, criterios')
          .eq('account_id', accountId)
          .order('posicao')
          .order('nome'),
        // Lista PLANA (um seletor): só por nome, nunca por `posicao`.
        supabase
          .from('custom_fields')
          .select('id, field_name, field_type, field_options')
          .eq('account_id', accountId)
          .order('field_name'),
        lerClientesIdeais(supabase, accountId),
      ]);
      if (!vivo) return;
      if (perfisRes.error || camposRes.error) {
        setCarga({ de: accountId, estado: 'erro' });
        return;
      }
      const perfis = ((perfisRes.data ?? []) as Record<string, unknown>[]).map((linha) => ({
        id: String(linha.id),
        account_id: String(linha.account_id),
        nome: String(linha.nome),
        ativo: linha.ativo === true,
        posicao: Number(linha.posicao) || 0,
        criterios: lerCriterios(linha.criterios),
      }));
      setCarga({
        de: accountId,
        estado: 'ok',
        perfis,
        campos: (camposRes.data ?? []) as Campo[],
        // Contagem que falhou é "não sei", nunca zero.
        contagem: ideais ? contarPorPerfil(ideais) : null,
      });
    })();
    return () => {
      vivo = false;
    };
  }, [accountId, nonce, supabase]);

  // Carga de OUTRA conta (troca de conta com a tela aberta) é como não ter carga.
  const atual = carga && carga.de === accountId ? carga : null;

  const alternarAtivo = async (perfil: PerfilDeClienteIdeal, ativo: boolean) => {
    setOcupado(perfil.id);
    const { data, error } = await supabase.from(TABELA).update({ ativo }).eq('id', perfil.id).select('id');
    setOcupado(null);
    if (error) {
      toast.error(mensagemDoErro(t, error.code));
      return;
    }
    if (!data || data.length !== 1) {
      toast.error(t('erroZeroLinhas'));
      return;
    }
    recarregar();
  };

  const excluir = async (perfil: PerfilDeClienteIdeal) => {
    if (!window.confirm(t('confirmarExclusao', { nome: perfil.nome }))) return;
    setOcupado(perfil.id);
    const { data, error } = await supabase.from(TABELA).delete().eq('id', perfil.id).select('id');
    setOcupado(null);
    if (error) {
      toast.error(t('erroExcluir'));
      return;
    }
    if (!data || data.length !== 1) {
      toast.error(t('erroZeroLinhas'));
      return;
    }
    toast.success(t('excluido'));
    if (editando === perfil.id) setEditando(null);
    recarregar();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Gem className="size-4 text-primary" />
          {t('titulo')}
          <SettingsChip variant="admin" className="font-medium">
            <Shield />
            {t('soAdmin')}
          </SettingsChip>
        </CardTitle>
        <CardDescription className="text-muted-foreground">{t('descricao')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!atual ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('carregando')}
          </div>
        ) : atual.estado === 'erro' ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {t('erroAoCarregar')}
            <Button size="sm" variant="outline" onClick={recarregar}>
              {t('tentarDeNovo')}
            </Button>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{t('comoFunciona')}</p>
            {atual.perfis.length === 0 && editando !== 'novo' ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                {t('semPerfis')}
              </p>
            ) : null}
            <ul className="space-y-3">
              {atual.perfis.map((perfil) =>
                editando === perfil.id ? (
                  <li key={perfil.id}>
                    <EditorDePerfil
                      // Remonta ao trocar de perfil: o rascunho nasce do perfil aberto.
                      key={perfil.id}
                      perfil={perfil}
                      campos={atual.campos}
                      accountId={accountId}
                      posicaoNova={atual.perfis.length}
                      aoSalvar={() => {
                        setEditando(null);
                        recarregar();
                      }}
                      aoCancelar={() => setEditando(null)}
                    />
                  </li>
                ) : (
                  <li key={perfil.id}>
                    <LinhaDoPerfil
                      perfil={perfil}
                      campos={atual.campos}
                      contagem={atual.contagem}
                      ocupado={ocupado === perfil.id}
                      aoEditar={() => setEditando(perfil.id)}
                      aoAlternar={(ativo) => void alternarAtivo(perfil, ativo)}
                      aoExcluir={() => void excluir(perfil)}
                    />
                  </li>
                ),
              )}
            </ul>
            {editando === 'novo' ? (
              <EditorDePerfil
                key="novo"
                perfil={null}
                campos={atual.campos}
                accountId={accountId}
                posicaoNova={atual.perfis.length}
                aoSalvar={() => {
                  setEditando(null);
                  recarregar();
                }}
                aoCancelar={() => setEditando(null)}
              />
            ) : (
              <Button variant="outline" size="sm" onClick={() => setEditando('novo')}>
                <Plus />
                {t('novoPerfil')}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LinhaDoPerfil({
  perfil,
  campos,
  contagem,
  ocupado,
  aoEditar,
  aoAlternar,
  aoExcluir,
}: {
  perfil: PerfilDeClienteIdeal;
  campos: Campo[];
  contagem: Contagem | null;
  ocupado: boolean;
  aoEditar: () => void;
  aoAlternar: (ativo: boolean) => void;
  aoExcluir: () => void;
}) {
  const t = useTranslations('Settings.clienteIdeal');
  const nomes = new Map(campos.map((c) => [c.id, c.field_name]));
  const campoApagado = perfil.criterios.some((c) => !nomes.has(c.campo));
  const numeros = contagem?.get(perfil.id) ?? { ideais: 0, possiveis: 0 };

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border border-border p-3">
      <Switch
        checked={perfil.ativo}
        disabled={ocupado}
        onCheckedChange={(v) => aoAlternar(v)}
        aria-label={t('ativoDe', { nome: perfil.nome })}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-foreground">{perfil.nome}</span>
          {!perfil.ativo ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t('desligado')}</span>
          ) : null}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {perfil.criterios.map((c) => nomes.get(c.campo) ?? t('campoApagadoNome')).join(' · ')}
        </p>
        {campoApagado ? (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t('campoApagado')}</p>
        ) : perfil.ativo ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {contagem
              ? t('contagem', { ideais: numeros.ideais, possiveis: numeros.possiveis })
              : t('contagemIndisponivel')}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={aoEditar} disabled={ocupado}>
          <Pencil />
          {t('editar')}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={aoExcluir}
          disabled={ocupado}
          aria-label={t('excluirDe', { nome: perfil.nome })}
          title={t('excluir')}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

function EditorDePerfil({
  perfil,
  campos,
  accountId,
  posicaoNova,
  aoSalvar,
  aoCancelar,
}: {
  perfil: PerfilDeClienteIdeal | null;
  campos: Campo[];
  accountId: string | null;
  posicaoNova: number;
  aoSalvar: () => void;
  aoCancelar: () => void;
}) {
  const t = useTranslations('Settings.clienteIdeal');
  const supabase = createClient();
  const [nome, setNome] = useState(perfil?.nome ?? '');
  const [ativo, setAtivo] = useState(perfil?.ativo ?? true);
  const [criterios, setCriterios] = useState<CriterioDeClienteIdeal[]>(
    perfil?.criterios.length ? perfil.criterios : [{ campo: '', respostas: [] }],
  );
  const [salvando, setSalvando] = useState(false);

  const mudar = (indice: number, criterio: CriterioDeClienteIdeal) =>
    setCriterios((lista) => lista.map((c, i) => (i === indice ? criterio : c)));
  const mover = (indice: number, passo: -1 | 1) =>
    setCriterios((lista) => {
      const alvo = indice + passo;
      if (alvo < 0 || alvo >= lista.length) return lista;
      const nova = [...lista];
      [nova[indice], nova[alvo]] = [nova[alvo], nova[indice]];
      return nova;
    });

  const salvar = async () => {
    const nomeLimpo = nome.trim();
    if (!nomeDoPerfilValido(nomeLimpo)) {
      toast.error(t('erroNome', { teto: TETO_DO_NOME_DO_PERFIL }));
      return;
    }
    if (!criteriosValidos(criterios)) {
      toast.error(t('erroInvalido'));
      return;
    }
    // O CHECK aceita qualquer uuid; campo apagado deixaria o perfil inválido
    // (não marca ninguém) com cara de salvo.
    if (!criterios.every((c) => campos.some((f) => f.id === c.campo))) {
      toast.error(t('campoApagado'));
      return;
    }
    if (!accountId) return;
    setSalvando(true);
    const linha = { nome: nomeLimpo, ativo, criterios };
    const { data, error } = perfil
      ? await supabase.from(TABELA).update(linha).eq('id', perfil.id).select('id')
      : await supabase
          .from(TABELA)
          .insert({ ...linha, account_id: accountId, posicao: posicaoNova })
          .select('id');
    setSalvando(false);
    if (error) {
      toast.error(mensagemDoErro(t, error.code));
      return;
    }
    if (!data || data.length !== 1) {
      toast.error(t('erroZeroLinhas'));
      return;
    }
    toast.success(t('salvo'));
    aoSalvar();
  };

  return (
    <div className="space-y-4 rounded-lg border border-primary/40 bg-muted/30 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t('nome')}</span>
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={TETO_DO_NOME_DO_PERFIL}
            placeholder={t('nomePlaceholder')}
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <Switch checked={ativo} onCheckedChange={(v) => setAtivo(v)} />
          {t('ativo')}
        </label>
      </div>

      <p className="text-xs text-muted-foreground">{t('principalDica')}</p>

      <ol className="space-y-3">
        {criterios.map((criterio, indice) => (
          <li key={indice}>
            <EditorDeCriterio
              indice={indice}
              total={criterios.length}
              criterio={criterio}
              campos={campos}
              camposUsados={criterios.filter((_, i) => i !== indice).map((c) => c.campo)}
              aoMudar={(c) => mudar(indice, c)}
              aoSubir={() => mover(indice, -1)}
              aoDescer={() => mover(indice, 1)}
              aoRemover={() => setCriterios((lista) => lista.filter((_, i) => i !== indice))}
            />
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        {criterios.length < TETO_DE_CRITERIOS ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCriterios((lista) => [...lista, { campo: '', respostas: [] }])}
          >
            <Plus />
            {t('adicionarCriterio')}
          </Button>
        ) : null}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={aoCancelar} disabled={salvando}>
          {t('cancelar')}
        </Button>
        <Button size="sm" onClick={() => void salvar()} disabled={salvando}>
          {salvando ? <Loader2 className="animate-spin" /> : null}
          {salvando ? t('salvando') : t('salvar')}
        </Button>
      </div>
    </div>
  );
}

function EditorDeCriterio({
  indice,
  total,
  criterio,
  campos,
  camposUsados,
  aoMudar,
  aoSubir,
  aoDescer,
  aoRemover,
}: {
  indice: number;
  total: number;
  criterio: CriterioDeClienteIdeal;
  campos: Campo[];
  camposUsados: string[];
  aoMudar: (criterio: CriterioDeClienteIdeal) => void;
  aoSubir: () => void;
  aoDescer: () => void;
  aoRemover: () => void;
}) {
  const t = useTranslations('Settings.clienteIdeal');
  const campo = campos.find((c) => c.id === criterio.campo) ?? null;
  const apagado = criterio.campo !== '' && !campo;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{t('criterio', { n: indice + 1 })}</span>
        {indice === 0 ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t('principal')}</span>
        ) : null}
        <span className="flex-1" />
        <Button variant="ghost" size="icon-sm" onClick={aoSubir} disabled={indice === 0} aria-label={t('subir')}>
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={aoDescer}
          disabled={indice === total - 1}
          aria-label={t('descer')}
        >
          <ArrowDown />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={aoRemover}
          disabled={total === 1}
          aria-label={t('removerCriterio')}
        >
          <Trash2 />
        </Button>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t('campo')}</span>
        <select
          value={campo ? campo.id : ''}
          onChange={(e) => aoMudar({ campo: e.target.value, respostas: [] })}
          className="rounded-md border border-border bg-muted px-2 py-2 text-sm text-foreground"
        >
          <option value="">{apagado ? t('campoApagadoNome') : t('escolherCampo')}</option>
          {campos
            .filter((c) => c.id === criterio.campo || !camposUsados.includes(c.id))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.field_name}
              </option>
            ))}
        </select>
      </label>
      {apagado ? <p className="text-xs text-amber-700 dark:text-amber-300">{t('campoApagado')}</p> : null}
      {campo ? (
        <RespostasDoCampo
          // Remonta ao trocar de campo: as respostas são do campo escolhido.
          key={campo.id}
          campo={campo}
          criterio={criterio}
          aoMudar={aoMudar}
        />
      ) : null}
    </div>
  );
}

function RespostasDoCampo({
  campo,
  criterio,
  aoMudar,
}: {
  campo: Campo;
  criterio: CriterioDeClienteIdeal;
  aoMudar: (criterio: CriterioDeClienteIdeal) => void;
}) {
  const t = useTranslations('Settings.clienteIdeal');
  const supabase = createClient();
  /** As gravadas, carimbadas com o campo (efeito passivo); `null` = falhou. */
  const [gravadas, setGravadas] = useState<{
    de: string;
    lista: { resposta: string; fichas: number }[] | null;
  } | null>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const { data, error } = await supabase.rpc('cb_respostas_do_campo', { p_campo: campo.id });
      if (!vivo) return;
      setGravadas({
        de: campo.id,
        lista: error
          ? null
          : ((data ?? []) as { resposta: string; fichas: number | string }[]).map((r) => ({
              resposta: r.resposta,
              fichas: Number(r.fichas) || 0,
            })),
      });
    })();
    return () => {
      vivo = false;
    };
  }, [campo.id, supabase]);

  const carregando = !gravadas || gravadas.de !== campo.id;
  // Só os PADRÕES: a resposta de uma ficha só (senha, id, nome) nunca é
  // listada — ver `somentePadroes`.
  const { padroes, deFora } = useMemo(
    () => somentePadroes(gravadas && gravadas.de === campo.id && gravadas.lista ? gravadas.lista : []),
    [gravadas, campo.id],
  );
  const oferecidas = useMemo(
    () =>
      respostasOferecidas(
        padroes,
        campo.field_type === 'select' ? opcoesDoCampo(campo as CustomField) : [],
        criterio.respostas,
      ),
    [padroes, campo, criterio.respostas],
  );

  if (carregando) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t('carregandoRespostas')}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{t('respostasQueContam')}</p>
      {gravadas.lista === null ? (
        <p className="text-xs text-destructive">{t('erroRespostas')}</p>
      ) : null}
      {oferecidas.length === 0 ? (
        // Vazio só AFIRMA "nenhuma resposta" quando a leitura voltou e nada
        // ficou de fora; senão quem fala é o aviso de erro ou o de "de fora".
        gravadas.lista !== null && deFora === 0 ? (
          <p className="text-xs text-muted-foreground">{t('semRespostas')}</p>
        ) : null
      ) : (
        <ul className="max-h-72 space-y-0.5 overflow-y-auto pr-1">
          {oferecidas.map(({ resposta, fichas }) => {
            const marcada = respostaMarcada(criterio, resposta);
            return (
              <li key={resposta}>
                <label
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm',
                    marcada ? 'bg-primary/10' : 'hover:bg-muted',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={marcada}
                    onChange={() => aoMudar(alternarResposta(criterio, resposta))}
                    className="size-4 accent-primary"
                  />
                  <span className="min-w-0 flex-1 break-words">{resposta}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{t('fichas', { n: fichas })}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {deFora > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('deFora', { n: deFora, minimo: MINIMO_DE_FICHAS_DO_PADRAO })}
        </p>
      ) : null}
      {gravadas.lista && gravadas.lista.length >= TETO_DE_RESPOSTAS ? (
        <p className="text-xs text-muted-foreground">{t('teto', { teto: TETO_DE_RESPOSTAS })}</p>
      ) : null}
    </div>
  );
}
