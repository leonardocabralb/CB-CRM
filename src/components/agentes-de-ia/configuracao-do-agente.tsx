'use client';

// ============================================================
// Configuração de um agente de IA (F1b, 5.9): nome, descrição, instruções,
// REGRAS (D23, uma por linha) — com as REGRAS DO SISTEMA, só para ler, acima
// das instruções (27/09/2026, `regras-do-sistema.tsx`) —, provedor e modelo (D1), conexões, as ETAPAS
// do funil em que atua (D24, `onde-atua.tsx`), horário, teto, transferência
// e para quem pode passar (D25: o card vai para a etapa do escolhido).
//
// "Conduz o fechamento" (1128, decisão do operador de 08/11/2026): logo
// abaixo das regras do sistema, porque é o que troca duas delas — o cartão
// mostra a lista do RASCUNHO, e mudar a opção avisa, antes de salvar, o que
// passa a valer e o que continua proibido.
//
// As FRASES AUTORIZADAS (1131, decisão do operador 50=c de 04/10/2026,
// confirmada em 09/11/2026), logo abaixo do "Conduz o fechamento" — também
// mexem nas regras do sistema: uma por linha, conferidas pela MESMA função
// da rota antes do Salvar (`lerFrasesAutorizadasDoCorpo`), com o aviso em
// âmbar quando a lista mudou; o cartão mostra as exceções do RASCUNHO.
//
// ⚠️ Conexões: NENHUMA marcada = o agente não atende em conexão nenhuma
// (nunca "todas": há número de uso pessoal na conta). Idem as etapas.
//
// O modelo sai da lista da CHAVE do provedor (`provedor-e-modelo.tsx`,
// 25/10/2026), com o quadro de quem lê a mídia ao lado.
//
// SEÇÕES (10/11/2026, pedido do operador): Identidade, Como fala, Modelo,
// Onde atua, Quando responde, Limites e passagem e Arquivar, cada uma com uma
// linha de "por que importa" e um índice ao lado. O "Ligado" SAIU daqui: é o
// interruptor do cabeçalho (`detalhe-do-agente.tsx`), que grava na hora com o
// aviso da D27 — com ele aqui também, o rascunho guardaria o "Ligado" antigo
// e o Salvar o desfaria. O Salvar é o da barra do detalhe (`registrarSalvar`).
// ============================================================

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertCircle, Plus, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useChannels } from '@/hooks/use-channels';
import { fetchAccountMembersOrNull, memberLabel } from '@/lib/account/members';
import { opcoesDeResponsavel } from '@/lib/account/suspensao';
import { modeloRecomendado } from '@/lib/ai/defaults';
import type { AiProvider } from '@/lib/ai/types';
import { LIMITES, lerFrasesAutorizadasDoCorpo } from '@/lib/ia-agentes/agente';
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
  type SalvarDaAba,
} from './tipos';
import { SECOES_DA_CONFIGURACAO, textoDoCodigo } from './textos';
import { alteracoesDoRascunho, frasesDoTexto, lerTeto, type RascunhoDaAba } from './rascunho';
import { OndeAtua } from './onde-atua';
import { listaDaChave, QuemLeAMidia, SeletorDeModelo, useModelosDasChaves } from './provedor-e-modelo';
import { RegrasDoSistema } from './regras-do-sistema';

const DIAS = [1, 2, 3, 4, 5, 6, 0] as const;

/** As seções, na ordem da página (o índice ao lado leva a cada uma). */
const SECOES = SECOES_DA_CONFIGURACAO;
type Secao = (typeof SECOES)[number];

/** O id da seção na página (o índice rola até ela). */
function idDaSecao(agenteId: string, s: Secao): string {
  return `agente-${agenteId}-${s}`;
}

/** Uma seção: título, uma linha de por que importa, e o conteúdo. */
function Secao({
  id,
  titulo,
  porque,
  alerta,
  children,
}: {
  id: string;
  titulo: string;
  porque: string;
  alerta?: string | null;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4 space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
        <p className="text-xs text-muted-foreground">{porque}</p>
      </div>
      {alerta ? (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-xs text-amber-700">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          <span>{alerta}</span>
        </p>
      ) : null}
      {children}
    </section>
  );
}

export function ConfiguracaoDoAgente({
  agente,
  aoSalvar,
  aoMudarNaoSalvo,
  aoMudarRascunho,
  registrarSalvar,
}: {
  agente: IaAgente;
  aoSalvar: (novo: IaAgente) => void;
  /** Avisa o detalhe se há alteração não salva (a aba Playground diz isso). */
  aoMudarNaoSalvo?: (naoSalvo: boolean) => void;
  /** Avisa o detalhe do que o Salvar mandaria agora: é o RASCUNHO que o Playground testa (DC4). */
  aoMudarRascunho?: (rascunho: RascunhoDaAba | null) => void;
  /** Entrega ao detalhe o Salvar desta aba (a barra de salvar o chama). */
  registrarSalvar?: (salvar: SalvarDaAba | null) => void;
}) {
  const t = useTranslations('IaAgentes');
  const router = useRouter();
  const { channels, loading: canaisCarregando } = useChannels();
  const [chaves, setChaves] = useState<ChavesDaConta>(null);
  const [membros, setMembros] = useState<AccountMember[] | null>(null);
  // `membros` nulo depois da carga = a equipe NÃO carregou (não "sem ninguém").
  const [equipeLida, setEquipeLida] = useState(false);
  const [outros, setOutros] = useState<IaAgente[] | null>(null);
  // Os modelos de cada chave e quem lê a mídia (`GET /api/cb/ia/modelos`).
  const modelosDasChaves = useModelosDasChaves();

  const [nome, setNome] = useState(agente.nome);
  const [descricao, setDescricao] = useState(agente.descricao);
  const [instrucoes, setInstrucoes] = useState(agente.instrucoes);
  const [regras, setRegras] = useState<string[]>(agente.regras);
  const [provedor, setProvedor] = useState<AiProvider>(agente.provedor);
  const [modelo, setModelo] = useState(agente.modelo);
  const [conexoes, setConexoes] = useState<string[]>(agente.conexoes);
  const [horario, setHorario] = useState<Horario | null>(agente.horario);
  // O teto é TEXTO enquanto se digita: corrigido a cada tecla, apagar virava
  // "1" e digitar "5" dava "15" (revisão da F1b). Lido só para salvar.
  const [tetoTexto, setTetoTexto] = useState(String(agente.tetoRespostas));
  const [transferirPara, setTransferirPara] = useState<string | null>(agente.transferirPara);
  const [avisarAoTransferir, setAvisarAoTransferir] = useState<string[]>(agente.avisarAoTransferir);
  const [podePassarPara, setPodePassarPara] = useState<string[]>(agente.podePassarPara);
  const [etapas, setEtapas] = useState<string[]>(() => agente.etapas.map((e) => e.stageId));
  const [conduzFechamento, setConduzFechamento] = useState(agente.conduzFechamento);
  // As frases são TEXTO enquanto se digita (uma por linha), como o teto: lidas
  // por `frasesDoTexto` para comparar, conferir e salvar.
  const [frasesTexto, setFrasesTexto] = useState(() => agente.frasesAutorizadas.join('\n'));
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
  const frases = useMemo(() => frasesDoTexto(frasesTexto), [frasesTexto]);
  // A MESMA conferência da rota (até 10, 1 a 400 caracteres, sem repetir):
  // fora dela, o campo avisa e o Salvar recusa — a rota responderia 400.
  const frasesValidas = lerFrasesAutorizadasDoCorpo(frases) !== null;
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
        // O "Ligado" é do cabeçalho (grava na hora): aqui ele nunca muda.
        ativo: agente.ativo,
        conexoes,
        horario,
        tetoRespostas: teto ?? agente.tetoRespostas,
        transferirPara,
        avisarAoTransferir,
        podePassarPara,
        etapas,
        conduzFechamento,
        frasesAutorizadas: frasesTexto,
      }),
    [agente, nome, descricao, instrucoes, regras, provedor, modelo, conexoes, horario, teto, transferirPara, avisarAoTransferir, podePassarPara, etapas, conduzFechamento, frasesTexto]
  );
  const naoSalvo = Object.keys(alteracoes).length > 0 || teto === null;
  const frasesMudaram = 'frases_autorizadas' in alteracoes;

  useEffect(() => {
    aoMudarNaoSalvo?.(naoSalvo);
  }, [naoSalvo, aoMudarNaoSalvo]);

  // O rascunho do Playground (DC4) é o MESMO corpo do Salvar, carimbado com a
  // versão do agente sobre a qual foi calculado.
  const rascunho = useMemo(
    () => (Object.keys(alteracoes).length > 0 ? { de: agente.updatedAt, corpo: alteracoes } : null),
    [alteracoes, agente.updatedAt]
  );
  useEffect(() => {
    aoMudarRascunho?.(rascunho);
  }, [rascunho, aoMudarRascunho]);

  // O destino da transferência que não está na equipe: a pessoa saiu (ou a
  // equipe não carregou). A opção fica visível com o aviso, em vez de o
  // <select> mostrar "Fila" sobre um valor que não é a fila.
  const transferenciaForaDaEquipe =
    transferirPara !== null && membros !== null && !membros.some((m) => m.user_id === transferirPara);
  // 1139: quem está marcado para o aviso e saiu da equipe — aparece para ser
  // desmarcado (salvar com ele seria recusado: não é mais membro da conta).
  const avisarForaDaEquipe =
    membros === null ? [] : avisarAoTransferir.filter((id) => !membros.some((m) => m.user_id === id));

  // Conexões oferecidas: só WhatsApp (no Instagram o agente não responde).
  const conexoesOferecidas = channels.filter((c) => !ehInstagram(c));

  // Etapa → nome do OUTRO agente que já atua nela (uma etapa, um agente).
  const ocupadas = useMemo(
    () => (outros ? new Map(outros.flatMap((o) => o.etapas.map((e) => [e.stageId, o.nome] as const))) : null),
    [outros]
  );

  /** O Salvar desta aba (a barra do detalhe o chama): `true` = gravou ou não havia o que gravar. */
  async function salvar(): Promise<boolean> {
    // O que o botão antigo desabilitava, agora dito.
    if (teto === null) {
      toast.error(t('campo.tetoInvalido'));
      return false;
    }
    if (!nome.trim() || !modelo.trim()) {
      toast.error(t('config.faltaNomeOuModelo'));
      return false;
    }
    if (!frasesValidas) {
      toast.error(t('campo.frasesAutorizadasInvalidas'));
      return false;
    }
    if (Object.keys(alteracoes).length === 0) return true;
    setSalvando(true);
    try {
      const res = await fetch(`/api/cb/ia/agentes/${agente.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alteracoes),
      });
      const corpo = (await res.json().catch(() => ({}))) as { agente?: IaAgente; code?: string; outroAgente?: string };
      if (!res.ok || !corpo.agente) {
        toast.error(textoDoCodigo(t, corpo.code, corpo.outroAgente));
        return false;
      }
      toast.success(t('config.salvo'));
      aoSalvar(corpo.agente);
      return true;
    } catch {
      toast.error(t('erro.generico'));
      return false;
    } finally {
      setSalvando(false);
    }
  }
  // A barra de salvar do detalhe chama o Salvar MAIS RECENTE (o do último render).
  useEffect(() => {
    registrarSalvar?.(salvar);
  });
  useEffect(() => () => registrarSalvar?.(null), [registrarSalvar]);

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

  // O estado de cada seção no índice: o que falta para o agente atender.
  const semInstrucoes = instrucoes.trim().length === 0;
  const semOndeAtuar = conexoes.length === 0 || etapas.length === 0;
  const alertaDaSecao: Partial<Record<Secao, boolean>> = {
    identidade: !nome.trim(),
    comoFala: semInstrucoes,
    ondeAtua: semOndeAtuar,
    limites: teto === null,
  };
  const rolarAte = (s: Secao) =>
    document.getElementById(idDaSecao(agente.id, s))?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="lg:grid lg:grid-cols-[176px_minmax(0,1fr)] lg:gap-6">
      {/* O índice das seções (no celular, some: a página é curta por seção). */}
      <nav aria-label={t('config.indice')} className="hidden lg:block">
        <ul className="sticky top-0 space-y-0.5 pt-1 text-sm">
          {SECOES.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => rolarAte(s)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground',
                  s === 'arquivar' && 'text-muted-foreground/70',
                )}
              >
                <span className="truncate">{t(`config.secao.${s}.titulo`)}</span>
                {alertaDaSecao[s] ? <AlertCircle className="size-3.5 shrink-0 text-amber-600" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 space-y-4">
        <Secao
          id={idDaSecao(agente.id, 'identidade')}
          titulo={t('config.secao.identidade.titulo')}
          porque={t('config.secao.identidade.porque')}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ag-nome">{t('campo.nome')}</Label>
              <Input id="ag-nome" value={nome} maxLength={LIMITES.nome} onChange={(e) => setNome(e.target.value)} />
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
          </div>
        </Secao>

        <Secao
          id={idDaSecao(agente.id, 'comoFala')}
          titulo={t('config.secao.comoFala.titulo')}
          porque={t('config.secao.comoFala.porque')}
          alerta={semInstrucoes ? t('config.secao.comoFala.semInstrucoes') : null}
        >
          {/* As regras do sistema (27/09/2026): só leitura, e vêm ANTES das
              instruções no pedido — a ordem da tela é a do pedido. A lista é
              a do rascunho: com "Conduz o fechamento", duas delas trocam; com
              frases autorizadas, duas ganham a exceção e a lista vem no fim. */}
          <RegrasDoSistema conduzFechamento={conduzFechamento} frasesAutorizadas={frases} />
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{t('campo.conduzFechamento')}</p>
                <p className="text-xs text-muted-foreground">{t('campo.conduzFechamentoDica')}</p>
              </div>
              <Switch
                checked={conduzFechamento}
                onCheckedChange={setConduzFechamento}
                aria-label={t('campo.conduzFechamento')}
              />
            </div>
            {/* O aviso vem ANTES do Salvar, só quando a opção mudou. */}
            {conduzFechamento !== agente.conduzFechamento ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {conduzFechamento ? t('campo.conduzFechamentoLigando') : t('campo.conduzFechamentoDesligando')}
              </p>
            ) : null}
          </div>
          {/* As frases autorizadas (1131): uma por linha. Fora da forma, o campo
              avisa em vermelho e o Salvar recusa; mudou, o aviso em âmbar vem
              ANTES do Salvar. */}
          <div className="space-y-1.5">
            <Label htmlFor="ag-frases">{t('campo.frasesAutorizadas')}</Label>
            <p className="text-xs text-muted-foreground">{t('campo.frasesAutorizadasDica')}</p>
            <Textarea
              id="ag-frases"
              rows={3}
              value={frasesTexto}
              aria-invalid={!frasesValidas}
              onChange={(e) => setFrasesTexto(e.target.value)}
            />
            {!frasesValidas ? (
              <p className="text-xs text-red-700 dark:text-red-300">{t('campo.frasesAutorizadasInvalidas')}</p>
            ) : frasesMudaram ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {frases.length > 0 ? t('campo.frasesAutorizadasMudando') : t('campo.frasesAutorizadasSemFrases')}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ag-instr">{t('campo.instrucoes')}</Label>
            <p className="text-xs text-muted-foreground">{t('campo.instrucoesDica')}</p>
            <Textarea
              id="ag-instr"
              rows={10}
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
        </Secao>

        <Secao
          id={idDaSecao(agente.id, 'modelo')}
          titulo={t('config.secao.modelo.titulo')}
          porque={t('config.secao.modelo.porque')}
        >
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
                  // O recomendado que a chave do provedor TEM (sem a lista, o padrão).
                  setModelo(modeloRecomendado(p, listaDaChave(modelosDasChaves.leitura?.provedores[p])));
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
            <SeletorDeModelo
              id="ag-modelo"
              provedor={provedor}
              valor={modelo}
              aoMudar={setModelo}
              lista={modelosDasChaves.leitura ? modelosDasChaves.leitura.provedores[provedor] : null}
              atualizando={modelosDasChaves.atualizando}
              aoAtualizar={modelosDasChaves.atualizar}
            />
          </div>
          {/* Quem lê áudio, imagem e PDF NÃO é este modelo (o operador pediu
              que fique claro): é a chave da conta, e o agente recebe o texto. */}
          <QuemLeAMidia leitores={modelosDasChaves.leitura ? modelosDasChaves.leitura.leitores : undefined} />
        </Secao>

        <Secao
          id={idDaSecao(agente.id, 'ondeAtua')}
          titulo={t('config.secao.ondeAtua.titulo')}
          porque={t('config.secao.ondeAtua.porque')}
          // Sem etapa, o aviso é o da própria lista de etapas (`OndeAtua`).
          alerta={conexoes.length === 0 ? t('config.secao.ondeAtua.semConexao') : null}
        >
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">{t('campo.conexoes')}</p>
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
          </div>
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-sm font-medium text-foreground">{t('ondeAtua.titulo')}</p>
            <p className="text-xs text-muted-foreground">{t('ondeAtua.dica')}</p>
            <p className="text-xs text-muted-foreground">{t('ondeAtua.soCardsNovos')}</p>
            <OndeAtua etapas={etapas} aoMudar={setEtapas} ocupadas={ocupadas} />
          </div>
        </Secao>

        <Secao
          id={idDaSecao(agente.id, 'quando')}
          titulo={t('config.secao.quando.titulo')}
          porque={t('campo.horarioDica')}
        >
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
        </Secao>

        <Secao
          id={idDaSecao(agente.id, 'limites')}
          titulo={t('config.secao.limites.titulo')}
          porque={t('config.secao.limites.porque')}
        >
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
                {/* 1067: suspenso não recebe conversa nova; o escolhido fica. */}
                {opcoesDeResponsavel(membros ?? [], (m) => m.user_id === transferirPara).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.suspenso_em
                      ? t('campo.membroSuspenso', { name: memberLabel(m) })
                      : memberLabel(m)}
                  </option>
                ))}
              </select>
              {transferenciaForaDaEquipe ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">{t('campo.foraDaEquipeDica')}</p>
              ) : equipeLida && membros === null ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">{t('campo.equipeNaoCarregou')}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{t('campo.transferirParaDica')}</p>
              )}
            </div>
          </div>
          <div className="space-y-2 border-t border-border pt-3">
            <Label>{t('campo.avisarAoTransferir')}</Label>
            <p className="text-xs text-muted-foreground">{t('campo.avisarAoTransferirDica')}</p>
            {membros === null ? (
              equipeLida ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">{t('campo.avisarEquipeNaoCarregou')}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{t('campo.membroNaoCarregado')}</p>
              )
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  {/* 1067: suspenso não é oferecido; o já marcado fica, com a marca. */}
                  {opcoesDeResponsavel(membros, (m) => avisarAoTransferir.includes(m.user_id)).map((m) => (
                    <label key={m.user_id} className="flex min-w-0 items-center gap-2 text-sm">
                      <Checkbox
                        checked={avisarAoTransferir.includes(m.user_id)}
                        onCheckedChange={() => setAvisarAoTransferir(alternar(avisarAoTransferir, m.user_id))}
                      />
                      <span className="min-w-0 truncate">
                        {m.suspenso_em ? t('campo.membroSuspenso', { name: memberLabel(m) }) : memberLabel(m)}
                      </span>
                    </label>
                  ))}
                  {avisarForaDaEquipe.map((id) => (
                    <label key={id} className="flex min-w-0 items-center gap-2 text-sm">
                      <Checkbox
                        checked
                        onCheckedChange={() => setAvisarAoTransferir(avisarAoTransferir.filter((x) => x !== id))}
                      />
                      <span className="min-w-0 truncate text-amber-700 dark:text-amber-300">{t('campo.foraDaEquipe')}</span>
                    </label>
                  ))}
                </div>
                {avisarAoTransferir.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('campo.avisarAoTransferirNinguem')}</p>
                ) : null}
              </>
            )}
          </div>
          <div className="space-y-2 border-t border-border pt-3">
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
                    {/* D25: sem etapa, não há para onde levar o card — a passagem vira transferência. */}
                    {o.etapas.length === 0 ? (
                      <span className="shrink-0 text-xs text-amber-700 dark:text-amber-300">{t('campo.passarSemEtapa')}</span>
                    ) : null}
                  </label>
                ))}
              </div>
            )}
          </div>
        </Secao>

        <section
          id={idDaSecao(agente.id, 'arquivar')}
          className="scroll-mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4"
        >
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{t('config.secao.arquivar.titulo')}</h3>
            <p className="text-xs text-muted-foreground">{t('config.secao.arquivar.porque')}</p>
          </div>
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
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmandoArquivar(true)}
            >
              <Trash2 className="size-4" /> {t('config.arquivar')}
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}
