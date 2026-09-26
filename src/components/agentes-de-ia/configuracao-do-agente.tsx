'use client';

// ============================================================
// Configuração de um agente de IA (F1b, 5.9): nome, descrição, instruções,
// REGRAS (D23, uma por linha), provedor e modelo (D1), conexões, horário,
// teto, transferência e para quem pode passar.
//
// ⚠️ Conexões: NENHUMA marcada = o agente não atende em conexão nenhuma
// (nunca "todas": há número de uso pessoal na conta). ⚠️ Nesta fase o agente
// ligado ainda NÃO responde cliente (F2) — a tela diz isso.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useChannels } from '@/hooks/use-channels';
import { fetchAccountMembersOrNull, memberLabel } from '@/lib/account/members';
import { AI_PROVIDER_MODELS } from '@/lib/ai/defaults';
import type { AiProvider } from '@/lib/ai/types';
import { LIMITES } from '@/lib/ia-agentes/agente';
import { ehInstagram } from '@/lib/cb-channels/transporte';
import { cn } from '@/lib/utils';
import type { AccountMember } from '@/types';
import {
  buscarChaves,
  NOME_DO_PROVEDOR,
  PROVEDORES,
  type ChavesDaConta,
  type Horario,
  type IaAgente,
} from './tipos';
import { textoDoCodigo } from './textos';
import { alteracoesDoRascunho, lerTeto } from './rascunho';

const DIAS = [1, 2, 3, 4, 5, 6, 0] as const;

export function ConfiguracaoDoAgente({
  agente,
  aoSalvar,
  aoMudarNaoSalvo,
}: {
  agente: IaAgente;
  aoSalvar: (novo: IaAgente) => void;
  /** Avisa o detalhe se há alteração não salva (a aba Playground diz isso). */
  aoMudarNaoSalvo?: (naoSalvo: boolean) => void;
}) {
  const t = useTranslations('IaAgentes');
  const router = useRouter();
  const { channels, loading: canaisCarregando } = useChannels();
  const [chaves, setChaves] = useState<ChavesDaConta>(null);
  const [membros, setMembros] = useState<AccountMember[] | null>(null);
  // `membros` nulo depois da carga = a equipe NÃO carregou (não "sem ninguém").
  const [equipeLida, setEquipeLida] = useState(false);
  const [outros, setOutros] = useState<IaAgente[] | null>(null);

  const [nome, setNome] = useState(agente.nome);
  const [descricao, setDescricao] = useState(agente.descricao);
  const [instrucoes, setInstrucoes] = useState(agente.instrucoes);
  const [regras, setRegras] = useState<string[]>(agente.regras);
  const [provedor, setProvedor] = useState<AiProvider>(agente.provedor);
  const [modelo, setModelo] = useState(agente.modelo);
  const [ativo, setAtivo] = useState(agente.ativo);
  const [conexoes, setConexoes] = useState<string[]>(agente.conexoes);
  const [horario, setHorario] = useState<Horario | null>(agente.horario);
  // O teto é TEXTO enquanto se digita: corrigido a cada tecla, apagar virava
  // "1" e digitar "5" dava "15" (revisão da F1b). Lido só para salvar.
  const [tetoTexto, setTetoTexto] = useState(String(agente.tetoRespostas));
  const [transferirPara, setTransferirPara] = useState<string | null>(agente.transferirPara);
  const [podePassarPara, setPodePassarPara] = useState<string[]>(agente.podePassarPara);
  const [salvando, setSalvando] = useState(false);
  const [confirmandoArquivar, setConfirmandoArquivar] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [c, m, lista] = await Promise.all([
        buscarChaves(),
        fetchAccountMembersOrNull(),
        fetch('/api/cb/ia/agentes', { cache: 'no-store' })
          .then(async (r) => (r.ok ? ((await r.json()) as { agentes: IaAgente[] }).agentes : null))
          .catch(() => null),
      ]);
      if (!vivo) return;
      setChaves(c);
      setMembros(m);
      setEquipeLida(true);
      setOutros(lista ? lista.filter((a) => a.id !== agente.id) : null);
    })();
    return () => {
      vivo = false;
    };
  }, [agente.id]);

  function alternar(lista: string[], id: string): string[] {
    return lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id];
  }

  const teto = lerTeto(tetoTexto, LIMITES.tetoMin, LIMITES.tetoMax);
  // Só o que MUDOU vai no PATCH (e é o que diz "há alteração não salva").
  const alteracoes = useMemo(
    () =>
      alteracoesDoRascunho(agente, {
        nome,
        descricao,
        instrucoes,
        regras,
        provedor,
        modelo,
        ativo,
        conexoes,
        horario,
        tetoRespostas: teto ?? agente.tetoRespostas,
        transferirPara,
        podePassarPara,
      }),
    [agente, nome, descricao, instrucoes, regras, provedor, modelo, ativo, conexoes, horario, teto, transferirPara, podePassarPara]
  );
  const naoSalvo = Object.keys(alteracoes).length > 0 || teto === null;

  useEffect(() => {
    aoMudarNaoSalvo?.(naoSalvo);
  }, [naoSalvo, aoMudarNaoSalvo]);

  // O destino da transferência que não está na equipe: a pessoa saiu (ou a
  // equipe não carregou). A opção fica visível com o aviso, em vez de o
  // <select> mostrar "Fila" sobre um valor que não é a fila.
  const transferenciaForaDaEquipe =
    transferirPara !== null && membros !== null && !membros.some((m) => m.user_id === transferirPara);

  // Conexões oferecidas: só WhatsApp (no Instagram o agente não responde).
  const conexoesOferecidas = channels.filter((c) => !ehInstagram(c));

  async function salvar() {
    if (teto === null || Object.keys(alteracoes).length === 0) return;
    setSalvando(true);
    try {
      const res = await fetch(`/api/cb/ia/agentes/${agente.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alteracoes),
      });
      const corpo = (await res.json().catch(() => ({}))) as { agente?: IaAgente; code?: string };
      if (!res.ok || !corpo.agente) {
        toast.error(textoDoCodigo(t, corpo.code));
        return;
      }
      toast.success(t('config.salvo'));
      aoSalvar(corpo.agente);
    } catch {
      toast.error(t('erro.generico'));
    } finally {
      setSalvando(false);
    }
  }

  async function arquivar() {
    setSalvando(true);
    try {
      const res = await fetch(`/api/cb/ia/agentes/${agente.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const corpo = (await res.json().catch(() => ({}))) as { code?: string };
        toast.error(textoDoCodigo(t, corpo.code));
        return;
      }
      toast.success(t('config.arquivado'));
      router.push('/agents');
    } catch {
      toast.error(t('erro.generico'));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="rounded-md border border-amber-300/60 bg-amber-50/40 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
        {t('config.aindaNaoResponde')}
      </p>

      <section className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ag-nome">{t('campo.nome')}</Label>
            <Input id="ag-nome" value={nome} maxLength={LIMITES.nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">{t('campo.ativo')}</p>
              <p className="text-xs text-muted-foreground">{t('campo.ativoDica')}</p>
            </div>
            <Switch checked={ativo} onCheckedChange={setAtivo} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ag-desc">{t('campo.descricao')}</Label>
          <Textarea
            id="ag-desc"
            rows={2}
            value={descricao}
            maxLength={LIMITES.descricao}
            placeholder={t('campo.descricaoDica')}
            onChange={(e) => setDescricao(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ag-instr">{t('campo.instrucoes')}</Label>
          <p className="text-xs text-muted-foreground">{t('campo.instrucoesDica')}</p>
          <Textarea
            id="ag-instr"
            rows={8}
            value={instrucoes}
            maxLength={LIMITES.instrucoes}
            onChange={(e) => setInstrucoes(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>{t('campo.regras')}</Label>
          <p className="text-xs text-muted-foreground">{t('campo.regrasDica')}</p>
          <ol className="space-y-2">
            {regras.map((r, i) => (
              <li key={i} className="flex min-w-0 items-center gap-2">
                <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">{i + 1}.</span>
                <Input
                  value={r}
                  maxLength={LIMITES.regra}
                  onChange={(e) => setRegras(regras.map((x, j) => (j === i ? e.target.value : x)))}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('campo.removerRegra')}
                  onClick={() => setRegras(regras.filter((_, j) => j !== i))}
                >
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ol>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={regras.length >= LIMITES.regras}
            onClick={() => setRegras([...regras, ''])}
          >
            <Plus className="size-4" /> {t('campo.novaRegra')}
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{t('config.modelo')}</h3>
        <div className="flex flex-wrap gap-2">
          {PROVEDORES.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={provedor === p}
              // Provedor sem chave não se escolhe (o agente nasceria mudo); o
              // que já está salvo continua clicável, para a tela não travar.
              disabled={chaves !== null && !chaves[p] && p !== agente.provedor}
              onClick={() => {
                if (p === provedor) return;
                setProvedor(p);
                setModelo(AI_PROVIDER_MODELS[p][0]);
              }}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50',
                provedor === p ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground'
              )}
            >
              {NOME_DO_PROVEDOR[p]}
              {chaves && !chaves[p] ? ` · ${t('campo.semChave')}` : ''}
            </button>
          ))}
        </div>
        {chaves && !chaves[provedor] ? (
          <p className="text-xs text-amber-700 dark:text-amber-300">{t('campo.provedorSemChave')}</p>
        ) : null}
        <div className="space-y-1.5 sm:max-w-md">
          <Label htmlFor="ag-modelo">{t('campo.modelo')}</Label>
          <Input id="ag-modelo" list="ag-modelos" value={modelo} onChange={(e) => setModelo(e.target.value)} />
          {/* Sugestão, nunca allow-list: os ids mudam mais rápido que a lista. */}
          <datalist id="ag-modelos">
            {AI_PROVIDER_MODELS[provedor].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{t('campo.conexoes')}</h3>
        <p className="text-xs text-muted-foreground">{t('campo.conexoesDica')}</p>
        {conexoesOferecidas.length < channels.length ? (
          <p className="text-xs text-muted-foreground">{t('campo.conexoesSoWhatsApp')}</p>
        ) : null}
        {canaisCarregando ? (
          <div className="h-10 animate-pulse rounded-md bg-muted/40" />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {conexoesOferecidas.map((c) => (
              <label key={c.id} className="flex min-w-0 items-center gap-2 text-sm">
                <Checkbox
                  checked={conexoes.includes(c.id)}
                  onCheckedChange={() => setConexoes(alternar(conexoes, c.id))}
                />
                <span className="min-w-0 truncate">{c.label}</span>
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{t('campo.horario')}</h3>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={horario === null}
            onCheckedChange={(v) =>
              setHorario(v === true ? null : { dias: [1, 2, 3, 4, 5], inicio: '08:00', fim: '18:00' })
            }
          />
          {t('campo.horarioSempre')}
        </label>
        {horario ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {DIAS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={horario.dias.includes(d)}
                  onClick={() => {
                    const dias = horario.dias.includes(d)
                      ? horario.dias.filter((x) => x !== d)
                      : [...horario.dias, d];
                    setHorario({ ...horario, dias });
                  }}
                  className={cn(
                    'rounded-md border px-2 py-1 text-xs',
                    horario.dias.includes(d) ? 'border-primary bg-primary/5' : 'border-border text-muted-foreground'
                  )}
                >
                  {t(`dia.${d}`)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Input
                type="time"
                className="w-32"
                value={horario.inicio}
                onChange={(e) => setHorario({ ...horario, inicio: e.target.value })}
              />
              <span className="text-muted-foreground">{t('campo.ate')}</span>
              <Input
                type="time"
                className="w-32"
                value={horario.fim}
                onChange={(e) => setHorario({ ...horario, fim: e.target.value })}
              />
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{t('config.transferencia')}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ag-teto">{t('campo.teto')}</Label>
            <Input
              id="ag-teto"
              type="number"
              min={LIMITES.tetoMin}
              max={LIMITES.tetoMax}
              className="w-24"
              value={tetoTexto}
              aria-invalid={teto === null}
              onChange={(e) => setTetoTexto(e.target.value)}
            />
            {teto === null ? (
              <p className="text-xs text-red-700 dark:text-red-300">{t('campo.tetoInvalido')}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t('campo.tetoDica')}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ag-transf">{t('campo.transferirPara')}</Label>
            <select
              id="ag-transf"
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              value={transferirPara ?? ''}
              onChange={(e) => setTransferirPara(e.target.value || null)}
            >
              <option value="">{t('campo.fila')}</option>
              {/* O valor guardado que não está na lista aparece como ele é —
                  sem isto o navegador marcava "Fila" sobre ele. */}
              {transferirPara !== null && membros === null ? (
                <option value={transferirPara}>{equipeLida ? '—' : t('campo.membroNaoCarregado')}</option>
              ) : null}
              {transferenciaForaDaEquipe ? (
                <option value={transferirPara ?? ''}>{t('campo.foraDaEquipe')}</option>
              ) : null}
              {(membros ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {memberLabel(m)}
                </option>
              ))}
            </select>
            {transferenciaForaDaEquipe ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">{t('campo.foraDaEquipeDica')}</p>
            ) : equipeLida && membros === null ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">{t('campo.equipeNaoCarregou')}</p>
            ) : null}
          </div>
        </div>
        <div className="space-y-2">
          <Label>{t('campo.podePassarPara')}</Label>
          <p className="text-xs text-muted-foreground">{t('campo.podePassarParaDica')}</p>
          {outros === null ? null : outros.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('campo.semOutrosAgentes')}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {outros.map((o) => (
                <label key={o.id} className="flex min-w-0 items-center gap-2 text-sm">
                  <Checkbox
                    checked={podePassarPara.includes(o.id)}
                    onCheckedChange={() => setPodePassarPara(alternar(podePassarPara, o.id))}
                  />
                  <span className="min-w-0 truncate">{o.nome}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        {confirmandoArquivar ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-red-700 dark:text-red-300">{t('config.arquivarConfirma')}</span>
            <Button variant="destructive" size="sm" disabled={salvando} onClick={() => void arquivar()}>
              {t('config.arquivar')}
            </Button>
            <Button variant="outline" size="sm" disabled={salvando} onClick={() => setConfirmandoArquivar(false)}>
              {t('cancelar')}
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmandoArquivar(true)}
          >
            <Trash2 className="size-4" /> {t('config.arquivar')}
          </Button>
        )}
        <Button
          onClick={() => void salvar()}
          disabled={salvando || !nome.trim() || !modelo.trim() || teto === null || !naoSalvo}
        >
          {t('config.salvar')}
        </Button>
      </div>
    </div>
  );
}
