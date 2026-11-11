"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CampoComVariaveis } from "@/components/automations/variaveis/campo-com-variaveis";
import { VariaveisProvider } from "@/components/automations/variaveis/contexto";
import { useChannels } from "@/hooks/use-channels";
import { useMembros } from "@/hooks/use-membros";
import { avisarAsaasMudou } from "@/lib/asaas/aviso";
import {
  derivarEstado,
  patchesDoModulo,
  TETO_DO_NOME_DO_ESCRITORIO,
  type EtapaDoModulo,
  type LigacaoDaRegua,
  type MudancasDoModulo,
  type PatchDaAutomacao,
} from "@/lib/asaas/modulo-da-cobranca";
import { horaDeEnvioValida, horaDeLembreteValida, turnoDaHora } from "@/lib/asaas/regua";
import { MARCOS_PADRAO, textoPadraoDaLigacao } from "@/lib/asaas/textos-da-regua";
import { chaveDaPendencia } from "@/lib/automations/pendencias";
import { ehEvolution } from "@/lib/cb-channels/transporte";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { AsaasListas } from "./asaas-listas";
import { rotuloDaEtapa, type RespostaDoModulo, type T } from "./cobranca-comum";
import { TextoDaEtapa } from "./cobranca-texto-da-etapa";

/**
 * A tela "Cobrança automática" (1135), em Configurações › Integrações ›
 * Asaas (`?tab=integracoes&aba=cobranca`). Configura de um lugar só a régua
 * do Asaas (998): o interruptor, quem manda (número, quem assina, nome do
 * escritório), a cadência (lembretes do dia e da noite, cobranças por dias de
 * atraso), as regras, o "Pedir ligação à equipe" e quem não recebe.
 *
 * É FACHADA sobre as automações da régua (`modulo-da-cobranca.ts`): o estado
 * é DERIVADO do que está gravado a cada carga, e salvar é um PATCH por
 * automação pela rota do construtor — a mesma validação de ligar. Uma
 * automação recusada não segura as outras: a tela lista quais e por quê.
 *
 * ⚠️ Os números (envios, ligações pendentes) vêm `null` quando a leitura
 * falha e SOMEM — nunca viram 0. Só admin chega aqui (a aba inteira é admin).
 */

interface Etiqueta {
  id: string;
  name: string;
}

/** O que a tela mudou e ainda não gravou. */
interface Rascunho {
  canalId?: string;
  assinatura?: string;
  somenteDiasUteis?: boolean;
  /** `null` = desligar o pedido; ausente = não mexeu */
  ligacao?: LigacaoDaRegua | null;
  etapas: Record<string, { hora?: string; ligada?: boolean }>;
  escritorio?: string;
  intervalo?: string;
}

const RASCUNHO_VAZIO: Rascunho = { etapas: {} };

async function lerModulo(): Promise<RespostaDoModulo | null> {
  try {
    const res = await fetch("/api/cb/asaas/regua/modulo", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as RespostaDoModulo;
  } catch {
    return null;
  }
}

interface Recusa {
  nome: string;
  motivos: string[];
}

export function CobrancaAutomatica({ etapaAberta, aoAbrirEtapa }: { etapaAberta: string | null; aoAbrirEtapa: (id: string | null) => void }) {
  const t = useTranslations("Settings.integracoes.cobranca");
  const tb = useTranslations("Automations.builder");
  const { channels, loading: canaisCarregando, falhou: canaisFalharam } = useChannels();
  const { membros, carregando: membrosCarregando } = useMembros();
  const [dados, setDados] = useState<RespostaDoModulo | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [etiquetas, setEtiquetas] = useState<Etiqueta[] | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho>(RASCUNHO_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [mexendo, setMexendo] = useState<"interruptor" | "etapa" | "padrao" | null>(null);
  const [recusas, setRecusas] = useState<Recusa[]>([]);
  const [novosDias, setNovosDias] = useState("");
  const [versaoDasListas, setVersaoDasListas] = useState(0);

  const carregar = useCallback(async (): Promise<RespostaDoModulo | null> => {
    const corpo = await lerModulo();
    if (corpo) {
      setDados(corpo);
      setFalhou(false);
    } else setFalhou(true);
    return corpo;
  }, []);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const corpo = await lerModulo();
      if (!vivo) return;
      if (corpo) setDados(corpo);
      else setFalhou(true);
    })();
    const supabase = createClient();
    void (async () => {
      const { data, error } = await supabase.from("tags").select("id, name").order("name");
      if (vivo) setEtiquetas(error ? null : ((data ?? []) as Etiqueta[]));
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const automacoes = useMemo(() => dados?.automacoes ?? [], [dados]);
  const estado = useMemo(() => derivarEstado(automacoes), [automacoes]);
  const config = dados?.config;

  // As conexões que a régua aceita: WhatsApp por QR Code (D19).
  const conexoes = useMemo(() => channels.filter((c) => ehEvolution(c)), [channels]);
  const nomeDaConexao = (id: string) => channels.find((c) => c.id === id)?.label ?? t("conexaoApagada");

  const canalAtual = rascunho.canalId ?? (estado.canal.tipo === "um" ? estado.canal.id : "");
  const assinaturaAtual = rascunho.assinatura ?? (estado.assinatura.tipo === "uma" ? (estado.assinatura.valor ?? "") : "");
  const uteisAtual = rascunho.somenteDiasUteis ?? (estado.somenteDiasUteis === "misto" ? null : estado.somenteDiasUteis);
  const escritorioAtual = rascunho.escritorio ?? config?.escritorioNome ?? "";
  const intervaloAtual = rascunho.intervalo ?? String(config?.intervaloDias ?? 3);
  const ligacaoGravada: LigacaoDaRegua | null = estado.ligacao.tipo === "igual" ? estado.ligacao.config : null;
  const ligacaoAtual: LigacaoDaRegua | null = rascunho.ligacao !== undefined ? rascunho.ligacao : ligacaoGravada;
  const ligacaoLigada = ligacaoAtual !== null;

  const sujo =
    rascunho.canalId !== undefined ||
    rascunho.assinatura !== undefined ||
    rascunho.somenteDiasUteis !== undefined ||
    rascunho.ligacao !== undefined ||
    Object.keys(rascunho.etapas).length > 0 ||
    (rascunho.escritorio !== undefined && rascunho.escritorio.trim() !== (config?.escritorioNome ?? "")) ||
    (rascunho.intervalo !== undefined && Number(rascunho.intervalo) !== config?.intervaloDias);

  const horaInvalida = (e: EtapaDoModulo, hora: string): boolean => {
    if (e.tipo === "cobranca") return !horaDeEnvioValida(hora);
    return !horaDeLembreteValida(hora) || turnoDaHora(hora) !== e.turno;
  };
  const algumaHoraInvalida = estado.etapas.some((e) => {
    const h = rascunho.etapas[e.automacaoId]?.hora;
    return h !== undefined && horaInvalida(e, h);
  });
  const intervaloInvalido = !/^\d+$/.test(intervaloAtual) || Number(intervaloAtual) > 60;
  const ligacaoIncompleta = ligacaoAtual !== null && (!ligacaoAtual.tagId || (ligacaoAtual.parcelas === null && ligacaoAtual.dias === null) || ligacaoAtual.mencionados.length === 0 || !ligacaoAtual.texto.trim());

  const motivosDaResposta = async (res: Response): Promise<string[]> => {
    const corpo = (await res.json().catch(() => null)) as { issues?: { codigo?: string; message?: string }[]; error?: string } | null;
    const issues = corpo?.issues ?? [];
    if (issues.length === 0) return [corpo?.error ?? t("erroDesconhecido")];
    return issues.map((i) => {
      const chave = chaveDaPendencia(i);
      return chave ? tb(chave as Parameters<typeof tb>[0]) : (i.message ?? "");
    });
  };

  const aplicar = async (patches: PatchDaAutomacao[]): Promise<Recusa[]> => {
    const falhas: Recusa[] = [];
    for (const p of patches) {
      const res = await fetch(`/api/automations/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p.corpo) }).catch(() => null);
      if (!res) falhas.push({ nome: p.nome, motivos: [t("erroDeRede")] });
      else if (!res.ok) falhas.push({ nome: p.nome, motivos: await motivosDaResposta(res) });
    }
    return falhas;
  };

  const salvar = async () => {
    if (!config) return;
    setSalvando(true);
    setRecusas([]);
    try {
      const mudancas: MudancasDoModulo = {
        ...(rascunho.canalId !== undefined ? { canalId: rascunho.canalId } : {}),
        ...(rascunho.assinatura !== undefined ? { assinatura: rascunho.assinatura.trim() || null } : {}),
        ...(rascunho.somenteDiasUteis !== undefined ? { somenteDiasUteis: rascunho.somenteDiasUteis } : {}),
        ...(rascunho.ligacao !== undefined ? { ligacao: rascunho.ligacao } : {}),
        etapas: rascunho.etapas,
      };
      const falhas = await aplicar(patchesDoModulo(automacoes, mudancas));
      const corpoDaConfig: Record<string, unknown> = {};
      if (rascunho.escritorio !== undefined && rascunho.escritorio.trim() !== (config.escritorioNome ?? "")) corpoDaConfig.regua_escritorio_nome = rascunho.escritorio.trim() || null;
      if (rascunho.intervalo !== undefined && Number(rascunho.intervalo) !== config.intervaloDias) corpoDaConfig.regua_intervalo_dias = Number(rascunho.intervalo);
      if (Object.keys(corpoDaConfig).length > 0) {
        const res = await fetch("/api/cb/asaas/regua/interruptor", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpoDaConfig) }).catch(() => null);
        if (!res || !res.ok) falhas.push({ nome: t("configuracaoGeral"), motivos: [t("erroGravar")] });
      }
      setRecusas(falhas);
      setRascunho(RASCUNHO_VAZIO);
      await carregar();
      avisarAsaasMudou();
      if (falhas.length === 0) toast.success(t("salvo"));
      else toast.error(t("salvoComRecusas", { n: falhas.length }));
    } finally {
      setSalvando(false);
    }
  };

  const trocarInterruptor = async (ligar: boolean) => {
    if (ligar && !window.confirm(t("confirmarLigar"))) return;
    setMexendo("interruptor");
    try {
      const res = await fetch("/api/cb/asaas/regua/interruptor", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ regua_ativa: ligar }) }).catch(() => null);
      if (!res || !res.ok) {
        toast.error(t("erroGravar"));
        return;
      }
      toast.success(t(ligar ? "ligada" : "desligada"));
      avisarAsaasMudou();
      await carregar();
    } finally {
      setMexendo(null);
    }
  };

  const criarPadrao = async () => {
    setMexendo("padrao");
    try {
      const res = await fetch("/api/cb/asaas/regua", { method: "POST", headers: { "Content-Type": "application/json" } }).catch(() => null);
      if (!res || !res.ok) {
        toast.error(t("erroCriar"));
        return;
      }
      const corpo = (await res.json().catch(() => ({}))) as { criadas?: string[]; semConexao?: boolean };
      toast.success(t("padraoCriada", { n: corpo.criadas?.length ?? 0 }));
      if (corpo.semConexao) toast.warning(t("padraoSemConexao"), { duration: 10_000 });
      await carregar();
    } finally {
      setMexendo(null);
    }
  };

  const adicionarCobranca = async () => {
    const dias = Number(novosDias);
    if (!Number.isInteger(dias) || dias < 1 || dias > 365) {
      toast.error(t("diasInvalidos"));
      return;
    }
    setMexendo("etapa");
    try {
      const res = await fetch("/api/cb/asaas/regua", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dias, ...(canalAtual ? { canal_id: canalAtual } : {}), assinatura: assinaturaAtual.trim() || null }),
      }).catch(() => null);
      if (!res || !res.ok) {
        toast.error(res?.status === 409 ? t("etapaJaExiste", { dias }) : t("erroCriar"));
        return;
      }
      const { id } = (await res.json().catch(() => ({}))) as { id?: string };
      // A etapa nova nasce com o "Pedir ligação" das outras, se houver.
      const novo = await carregar();
      const criada = novo?.automacoes?.find((a) => a.id === id);
      if (criada && ligacaoGravada) {
        const falhas = await aplicar(patchesDoModulo([criada], { ligacao: ligacaoGravada }));
        if (falhas.length > 0) setRecusas(falhas);
        await carregar();
      }
      setNovosDias("");
      toast.success(t("etapaCriada", { dias }));
    } finally {
      setMexendo(null);
    }
  };

  const mexerNaEtapa = (id: string, m: { hora?: string; ligada?: boolean }) => setRascunho((r) => ({ ...r, etapas: { ...r.etapas, [id]: { ...r.etapas[id], ...m } } }));
  const mexerNaLigacao = (m: Partial<LigacaoDaRegua>) =>
    setRascunho((r) => {
      const base = (r.ligacao !== undefined ? r.ligacao : ligacaoGravada) ?? { parcelas: 2, dias: 15, mencionados: [], tagId: "", texto: "" };
      return { ...r, ligacao: { ...base, ...m } };
    });
  const ligarLigacao = (ligar: boolean) => {
    if (!ligar) {
      setRascunho((r) => ({ ...r, ligacao: null }));
      return;
    }
    const etiqueta = etiquetas?.[0];
    setRascunho((r) => ({
      ...r,
      ligacao: ligacaoGravada ?? { parcelas: 2, dias: 15, mencionados: [], tagId: "", texto: textoPadraoDaLigacao(etiqueta?.name ?? t("etiquetaPadrao")) },
    }));
  };

  if (etapaAberta) {
    const automacao = automacoes.find((a) => a.id === etapaAberta);
    return (
      <TextoDaEtapa
        dados={dados}
        automacao={automacao ?? null}
        etapas={estado.etapas}
        assinaturaComum={estado.assinatura.tipo === "uma" ? estado.assinatura.valor : null}
        nomeDaConexao={nomeDaConexao}
        falhou={falhou}
        aoTrocarEtapa={aoAbrirEtapa}
        aoSalvar={async () => {
          await carregar();
        }}
      />
    );
  }

  const voltar = (
    <Link href="/settings?tab=integracoes" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      {t("voltar")}
    </Link>
  );

  if (falhou && !dados) {
    return (
      <div className="space-y-3 text-sm">
        {voltar}
        <p className="text-muted-foreground">
          {t("carregarFalhou")}{" "}
          <button type="button" className="underline" onClick={() => void carregar()}>
            {t("tentarDeNovo")}
          </button>
        </p>
      </div>
    );
  }
  if (!dados) {
    return (
      <div className="space-y-3 text-sm">
        {voltar}
        <p className="text-muted-foreground">{t("carregando")}</p>
      </div>
    );
  }
  if (!dados.conectado || !config) {
    return (
      <div className="space-y-3 text-sm">
        {voltar}
        <p className="text-muted-foreground">{t("naoConectado")}</p>
      </div>
    );
  }

  const ligadas = estado.etapas.filter((e) => (rascunho.etapas[e.automacaoId]?.ligada ?? e.ligada)).length;
  const faltamPadrao =
    MARCOS_PADRAO.some((d) => !estado.etapas.some((e) => e.dias === d)) || !estado.etapas.some((e) => e.turno === "dia") || !estado.etapas.some((e) => e.turno === "noite");

  return (
    <div className="min-w-0 space-y-4 pb-24 text-sm">
      <div className="space-y-1.5">
        {voltar}
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-foreground">{t("titulo")}</h2>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs font-medium",
              config.ativa ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700" : "border-amber-400/60 bg-amber-50 text-amber-700",
            )}
          >
            {config.ativa ? t("estadoLigada") : t("estadoDesligada")}
          </span>
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {mexendo === "interruptor" && <Loader2 className="size-3.5 animate-spin" />}
            {t("interruptor")}
            <Switch checked={config.ativa} disabled={mexendo !== null || salvando} onCheckedChange={(v) => void trocarInterruptor(!!v)} aria-label={t("interruptor")} />
          </label>
        </div>
        <p className="max-w-[80ch] text-muted-foreground">{t("desc")}</p>
        {config.ativa && config.ativadaEm && <p className="text-xs text-muted-foreground">{t("ativadaEm", { quando: new Date(config.ativadaEm).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) })}</p>}
        {config.ativa && ligadas === 0 && <p className="text-xs text-amber-700">{t("ligadaSemEtapa")}</p>}
        {!config.ativa && estado.etapas.some((e) => e.ligada) && <p className="text-xs text-amber-700">{t("etapasLigadasMasDesligada")}</p>}
      </div>

      <Secao titulo={t("quemManda.titulo")} desc={t("quemManda.desc")}>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="min-w-0 space-y-1.5">
            <Label>{t("quemManda.numero")}</Label>
            <Select value={canalAtual} onValueChange={(v) => v && setRascunho((r) => ({ ...r, canalId: v }))}>
              <SelectTrigger className="w-full">
                <SelectValue>{canalAtual ? nomeDaConexao(canalAtual) : estado.canal.tipo === "varios" ? t("quemManda.varios") : t("quemManda.escolher")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {conexoes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                    {c.status !== "connected" ? ` · ${t("quemManda.desconectada")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {canaisCarregando ? t("carregando") : canaisFalharam ? t("quemManda.conexoesFalharam") : conexoes.length === 0 ? t("quemManda.semConexao") : t("quemManda.numeroAjuda")}
            </p>
            {estado.canal.tipo === "varios" && rascunho.canalId === undefined && (
              <p className="text-[11px] text-amber-700">{t("quemManda.variosAviso", { nomes: estado.canal.ids.map(nomeDaConexao).join(", ") })}</p>
            )}
            {estado.etapas.some((e) => e.envioSemCanal) && rascunho.canalId === undefined && <p className="text-[11px] text-amber-700">{t("quemManda.envioSemConexao")}</p>}
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="cobranca-assinatura">{t("quemManda.assina")}</Label>
            <Input
              id="cobranca-assinatura"
              value={assinaturaAtual}
              maxLength={60}
              placeholder={estado.assinatura.tipo === "varias" ? t("quemManda.variasAssinaturas") : t("quemManda.assinaPlaceholder")}
              onChange={(e) => setRascunho((r) => ({ ...r, assinatura: e.target.value }))}
            />
            <p className="text-[11px] text-muted-foreground">{t("quemManda.assinaAjuda")}</p>
            {!config.assinaturaAtiva && <p className="text-[11px] text-amber-700">{t("quemManda.assinaturaDesligada")}</p>}
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="cobranca-escritorio">{t("quemManda.escritorio")}</Label>
            <Input
              id="cobranca-escritorio"
              value={escritorioAtual}
              maxLength={TETO_DO_NOME_DO_ESCRITORIO}
              placeholder={config.escritorioPadrao || t("quemManda.escritorioPlaceholder")}
              onChange={(e) => setRascunho((r) => ({ ...r, escritorio: e.target.value }))}
            />
            <p className="text-[11px] text-muted-foreground">{t("quemManda.escritorioAjuda", { padrao: config.escritorioPadrao || "—" })}</p>
          </div>
        </div>
      </Secao>

      <Secao titulo={t("cadencia.titulo")} desc={t("cadencia.desc")}>
        {estado.etapas.length === 0 ? (
          <p className="text-muted-foreground">{t("cadencia.vazia")}</p>
        ) : (
          <>
            <ol className="flex flex-wrap items-start gap-x-6 gap-y-3 pb-1" aria-label={t("cadencia.linhaDoTempo")}>
              {estado.etapas.map((e) => {
                const ligada = rascunho.etapas[e.automacaoId]?.ligada ?? e.ligada;
                return (
                  <li key={e.automacaoId} className="flex min-w-16 flex-col items-center gap-1 text-center">
                    <span className={cn("size-3.5 rounded-full border-2", ligada ? (e.tipo === "lembrete" ? "border-primary bg-primary/20" : "border-red-500 bg-red-500/20") : "border-border bg-muted")} />
                    <span className="text-xs font-medium text-foreground">{rotuloCurto(e, t)}</span>
                    <span className="text-[11px] text-muted-foreground">{e.tipo === "lembrete" ? t("cadencia.lembrete") : t("cadencia.cobranca")}</span>
                  </li>
                );
              })}
            </ol>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">{t("cadencia.etapa")}</th>
                    <th className="px-3 py-2 font-semibold">{t("cadencia.quando")}</th>
                    <th className="px-3 py-2 font-semibold">{t("cadencia.horario")}</th>
                    <th className="px-3 py-2 font-semibold">{t("cadencia.texto")}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t("cadencia.ligada")}</th>
                  </tr>
                </thead>
                <tbody>
                  {estado.etapas.map((e) => {
                    const m = rascunho.etapas[e.automacaoId] ?? {};
                    const hora = m.hora ?? e.hora;
                    const ligada = m.ligada ?? e.ligada;
                    const invalida = m.hora !== undefined && horaInvalida(e, m.hora);
                    return (
                      <tr key={e.automacaoId} className="border-t border-border align-middle">
                        <td className="px-3 py-2">
                          <span className="block text-[13px] font-medium text-foreground">{rotuloDaEtapa(e, t)}</span>
                          {e.nome !== rotuloDaEtapa(e, t) && <span className="block text-[11px] text-muted-foreground">{e.nome}</span>}
                          {e.turno === "noite" && <span className="mt-0.5 inline-block rounded-full bg-primary/10 px-2 text-[10.5px] font-medium text-primary">{t("cadencia.mensagemAutomatica")}</span>}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{quandoDaEtapa(e, t)}</td>
                        <td className="px-3 py-2">
                          <Input type="time" value={hora} onChange={(ev) => mexerNaEtapa(e.automacaoId, { hora: ev.target.value })} className={cn("h-8 w-28", invalida && "border-destructive")} aria-invalid={invalida} aria-label={t("cadencia.horario")} />
                          {invalida && <span className="mt-0.5 block text-[11px] text-destructive">{e.tipo === "cobranca" ? t("cadencia.horaDaCobranca") : e.turno === "noite" ? t("cadencia.horaDaNoite") : t("cadencia.horaDoDia")}</span>}
                        </td>
                        <td className="max-w-[280px] px-3 py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={e.texto ?? ""}>
                              {e.texto ? e.texto.split("\n")[0] : t("cadencia.semTexto")}
                            </span>
                            <Button type="button" size="sm" variant="outline" onClick={() => aoAbrirEtapa(e.automacaoId)} disabled={salvando}>
                              {t("cadencia.editarTexto")}
                            </Button>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Switch checked={ligada} onCheckedChange={(v) => mexerNaEtapa(e.automacaoId, { ligada: !!v })} aria-label={t("cadencia.ligarEtapa", { etapa: rotuloDaEtapa(e, t) })} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {estado.marcosRepetidos.length > 0 && <p className="text-xs text-amber-700">{t("cadencia.marcoRepetido", { marcos: estado.marcosRepetidos.join(", ") })}</p>}
        {estado.turnosRepetidos.length > 0 && <p className="text-xs text-amber-700">{t("cadencia.lembreteRepetido")}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Input type="number" min={1} max={365} value={novosDias} onChange={(e) => setNovosDias(e.target.value)} placeholder={t("cadencia.diasPlaceholder")} className="h-8 w-24" aria-label={t("cadencia.diasPlaceholder")} />
          <Button type="button" size="sm" variant="outline" onClick={() => void adicionarCobranca()} disabled={mexendo !== null || salvando || sujo || !novosDias}>
            {mexendo === "etapa" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            {t("cadencia.adicionar")}
          </Button>
          {faltamPadrao && (
            <Button type="button" size="sm" variant="ghost" onClick={() => void criarPadrao()} disabled={mexendo !== null || salvando || sujo}>
              {mexendo === "padrao" ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t("cadencia.criarPadrao")}
            </Button>
          )}
          <span className="text-[11px] text-muted-foreground">{sujo ? t("cadencia.salveAntes") : t("cadencia.adicionarAjuda")}</span>
        </div>
      </Secao>

      <Secao titulo={t("regras.titulo")}>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5 rounded-md border border-border p-3">
            <label className="flex items-center gap-2 text-[13px] font-medium text-foreground">
              <Checkbox checked={uteisAtual === true} onCheckedChange={(v) => setRascunho((r) => ({ ...r, somenteDiasUteis: v === true }))} />
              {t("regras.diasUteis")}
            </label>
            <p className="text-[11px] text-muted-foreground">{uteisAtual === null ? t("regras.diasUteisMisto") : t("regras.diasUteisAjuda")}</p>
          </div>
          <div className="space-y-1.5 rounded-md border border-border p-3">
            <Label htmlFor="cobranca-intervalo">{t("regras.intervalo")}</Label>
            <div className="flex items-center gap-2">
              <Input id="cobranca-intervalo" type="number" min={0} max={60} value={intervaloAtual} onChange={(e) => setRascunho((r) => ({ ...r, intervalo: e.target.value }))} className={cn("h-8 w-20", intervaloInvalido && "border-destructive")} />
              <span className="text-xs text-muted-foreground">{t("regras.dias")}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">{t("regras.intervaloAjuda")}</p>
          </div>
          <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3">
            <p className="text-[13px] font-medium text-foreground">{t("regras.umaPorDia")}</p>
            <p className="text-[11px] text-muted-foreground">{t("regras.umaPorDiaAjuda")}</p>
          </div>
          <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3">
            <p className="text-[13px] font-medium text-foreground">{t("regras.naoRetroativa")}</p>
            <p className="text-[11px] text-muted-foreground">{t("regras.naoRetroativaAjuda")}</p>
          </div>
        </div>
      </Secao>

      <Secao
        titulo={t("ligacao.titulo")}
        desc={t("ligacao.desc")}
        direita={<Switch checked={ligacaoLigada} onCheckedChange={(v) => ligarLigacao(!!v)} aria-label={t("ligacao.titulo")} />}
      >
        {estado.ligacao.tipo === "diferente" && rascunho.ligacao === undefined && <p className="text-xs text-amber-700">{t("ligacao.diferente")}</p>}
        {estado.etapas.some((e) => e.ligacaoAMao) && <p className="text-xs text-amber-700">{t("ligacao.aMao", { etapas: estado.etapas.filter((e) => e.ligacaoAMao).map((e) => rotuloDaEtapa(e, t)).join(", ") })}</p>}
        {ligacaoAtual ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-foreground">
              <span>{t("ligacao.quando")}</span>
              <Input type="number" min={1} max={60} value={ligacaoAtual.parcelas ?? ""} onChange={(e) => mexerNaLigacao({ parcelas: e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : null })} className="h-8 w-16" aria-label={t("ligacao.parcelas")} />
              <span>{t("ligacao.parcelasOu")}</span>
              <Input type="number" min={1} max={365} value={ligacaoAtual.dias ?? ""} onChange={(e) => mexerNaLigacao({ dias: e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : null })} className="h-8 w-16" aria-label={t("ligacao.dias")} />
              <span>{t("ligacao.diasOuMais")}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("ligacao.marcar")}</Label>
                {membrosCarregando ? (
                  <p className="text-xs text-muted-foreground">{t("carregando")}</p>
                ) : (
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                    {membros
                      .filter((m) => !m.suspenso_em || ligacaoAtual.mencionados.includes(m.user_id))
                      .map((m) => (
                        <label key={m.user_id} className="flex items-center gap-2 text-xs text-foreground">
                          <Checkbox
                            checked={ligacaoAtual.mencionados.includes(m.user_id)}
                            onCheckedChange={(v) => mexerNaLigacao({ mencionados: v === true ? [...ligacaoAtual.mencionados, m.user_id] : ligacaoAtual.mencionados.filter((x) => x !== m.user_id) })}
                          />
                          {m.full_name || t("semNome")}
                        </label>
                      ))}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>{t("ligacao.etiqueta")}</Label>
                <Select value={ligacaoAtual.tagId} onValueChange={(v) => v && mexerNaLigacao({ tagId: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{ligacaoAtual.tagId ? (etiquetas?.find((x) => x.id === ligacaoAtual.tagId)?.name ?? t("ligacao.etiquetaApagada")) : t("ligacao.escolherEtiqueta")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(etiquetas ?? []).map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">{etiquetas === null ? t("ligacao.etiquetasFalharam") : t("ligacao.etiquetaAjuda")}</p>
              </div>
            </div>
            <VariaveisProvider gatilho="asaas_cobranca_vencida" webhookId={null}>
              <CampoComVariaveis rotulo={t("ligacao.texto")} value={ligacaoAtual.texto} onChange={(texto) => mexerNaLigacao({ texto })} previa={false} ajuda={t("ligacao.textoAjuda")} />
            </VariaveisProvider>
            {ligacaoIncompleta && <p className="text-xs text-destructive">{t("ligacao.incompleta")}</p>}
            {dados.ligacoesPendentes !== null && dados.ligacoesPendentes !== undefined && ligacaoGravada && <p className="text-xs text-muted-foreground">{t("ligacao.pendentes", { n: dados.ligacoesPendentes })}</p>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("ligacao.desligada")}</p>
        )}
      </Secao>

      <Secao titulo={t("excecoes.titulo")} desc={t("excecoes.desc")}>
        <AsaasListas resumo={null} versao={versaoDasListas} aoMudar={() => setVersaoDasListas((v) => v + 1)} listas={["sem_cobranca", "ligados"]} />
      </Secao>

      <section className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-4 py-3 text-xs">
        <span className="font-medium text-foreground">{t("semana.titulo")}</span>
        {dados.envios7d ? (
          <span className="text-muted-foreground">{t("semana.numeros", { lembretes: dados.envios7d.lembretes, cobrancas: dados.envios7d.cobrancas, falhas: dados.envios7d.falhas })}</span>
        ) : (
          <span className="text-muted-foreground">{t("semana.falhou")}</span>
        )}
        <Link href="/automations" className="ml-auto text-primary underline-offset-2 hover:underline">
          {t("semana.verAutomacoes")}
        </Link>
      </section>

      {recusas.length > 0 && (
        <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs" role="alert">
          <p className="font-medium text-destructive">{t("recusas")}</p>
          <ul className="list-disc space-y-0.5 pl-4 text-foreground">
            {recusas.map((r) => (
              <li key={r.nome}>
                <span className="font-medium">{r.nome}:</span> {r.motivos.join(" · ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">{sujo ? t("naoSalvo") : t("tudoSalvo")}</span>
        <Button type="button" variant="outline" size="sm" disabled={!sujo || salvando} onClick={() => setRascunho(RASCUNHO_VAZIO)}>
          {t("descartar")}
        </Button>
        <Button type="button" size="sm" disabled={!sujo || salvando || algumaHoraInvalida || intervaloInvalido || ligacaoIncompleta} onClick={() => void salvar()}>
          {salvando ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {t("salvar")}
        </Button>
      </div>
    </div>
  );
}

function rotuloCurto(e: EtapaDoModulo, t: T): string {
  if (e.tipo === "lembrete") return e.turno === "noite" ? t("etapa.venceNoite") : t("etapa.venceDia");
  return t("etapa.dias", { dias: e.dias ?? 0 });
}

function quandoDaEtapa(e: EtapaDoModulo, t: T): string {
  if (e.tipo === "lembrete") return e.turno === "noite" ? t("cadencia.quandoNoite") : t("cadencia.quandoDia");
  return t("cadencia.quandoCobranca", { dias: e.dias ?? 0 });
}

function Secao({ titulo, desc, direita, children }: { titulo: string; desc?: string; direita?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
          {desc && <p className="max-w-[80ch] text-xs text-muted-foreground">{desc}</p>}
        </div>
        {direita}
      </div>
      {children}
    </section>
  );
}
