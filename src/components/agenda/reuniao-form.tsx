'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FUSO_PADRAO, diaNoFuso, horaNoFuso, paraInstante } from '@/lib/agenda/fuso';
import { fetchAccountMembers } from '@/lib/account/members';
import type { AccountMember, Meeting, MeetingStatus, MeetingType } from '@/types';

/**
 * Criar e editar reunião (migration 945).
 *
 * ⚠️ O FORMULÁRIO TRABALHA EM HORA LOCAL E GRAVA INSTANTE. Os campos são
 * `<input type="date">` e `<input type="time">`, que só sabem de hora de
 * parede; a conversão para instante acontece no envio, por `paraInstante`, e é
 * a única maneira de a reunião das 14h ser às 14h para o cliente. Mandar o
 * valor cru do campo grava 14h UTC — 11h em Brasília.
 */

interface Props {
  aberto: boolean;
  aoFechar: () => void;
  /** Preenchido = edição; vazio = criação. */
  reuniao?: Meeting | null;
  /** Dia pré-selecionado ao criar (`YYYY-MM-DD`), quando veio de uma célula. */
  diaInicial?: string | null;
  /** Hora pré-selecionada (`HH:MM`), quando veio de um clique na grade. */
  horaInicial?: string | null;
  /** Cliente pré-selecionado, quando veio da ficha dele. */
  contactId?: string | null;
  aoSalvar: () => void;
}

const DURACOES = [15, 30, 45, 60, 90, 120];

export function ReuniaoForm({
  aberto,
  aoFechar,
  reuniao,
  diaInicial,
  horaInicial,
  contactId,
  aoSalvar,
}: Props) {
  const t = useTranslations('Agenda');

  // ⚠️ Busca direta em vez de um hook `use-membros`: a branch de Tarefas cria
  // um com esse nome, e duas versões do mesmo hook conflitariam no merge sem
  // que nenhuma das duas features precisasse disso. `fetchAccountMembers` já
  // engole o erro e devolve `[]`.
  const [membros, setMembros] = useState<AccountMember[]>([]);

  const [titulo, setTitulo] = useState('');
  const [tipo, setTipo] = useState<MeetingType>('outra');
  const [status, setStatus] = useState<MeetingStatus>('agendada');
  const [dia, setDia] = useState('');
  const [hora, setHora] = useState('09:00');
  const [duracao, setDuracao] = useState(60);
  const [responsavel, setResponsavel] = useState('');
  const [local, setLocal] = useState('');
  const [descricao, setDescricao] = useState('');

  const [salvando, setSalvando] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [confirmandoApagar, setConfirmandoApagar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const editando = Boolean(reuniao);

  useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    void fetchAccountMembers().then((lista) => {
      if (!cancelado) setMembros(lista);
    });
    return () => {
      cancelado = true;
    };
  }, [aberto]);

  // Repõe o formulário toda vez que abre — sem isto, abrir para criar depois de
  // ter editado traz os dados da reunião anterior.
  //
  // O `disable` cobre o bloco porque a regra aponta cada `setState` de dentro,
  // não a linha do `useEffect`. É o mesmo padrão do `use-conversation-notes`.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!aberto) return;

    if (reuniao) {
      const inicio = new Date(reuniao.starts_at);
      const fim = new Date(reuniao.ends_at);
      setTitulo(reuniao.titulo);
      setTipo(reuniao.tipo);
      setStatus(reuniao.status);
      setDia(diaNoFuso(inicio, FUSO_PADRAO));
      setHora(horaNoFuso(inicio, FUSO_PADRAO));
      setDuracao(Math.round((fim.getTime() - inicio.getTime()) / 60000));
      setResponsavel(reuniao.owner_user_id ?? '');
      setLocal(reuniao.local ?? '');
      setDescricao(reuniao.descricao ?? '');
    } else {
      setTitulo('');
      setTipo('outra');
      setStatus('agendada');
      setDia(diaInicial ?? diaNoFuso(new Date(), FUSO_PADRAO));
      setHora(horaInicial ?? '09:00');
      setDuracao(60);
      setResponsavel('');
      setLocal('');
      setDescricao('');
    }
    setErro(null);
    setConfirmandoApagar(false);
  }, [aberto, reuniao, diaInicial, horaInicial]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function salvar() {
    setErro(null);

    if (!titulo.trim()) {
      setErro(t('erroTitulo'));
      return;
    }
    if (!dia || !hora) {
      setErro(t('erroData'));
      return;
    }

    setSalvando(true);

    // ⚠️ Aqui é onde a hora de parede vira instante. `toISOString()` deixa a
    // string com `Z`, que é o que a validação da rota exige.
    const inicio = paraInstante(dia, hora, FUSO_PADRAO);
    const fim = new Date(inicio.getTime() + duracao * 60000);

    const corpo: Record<string, unknown> = {
      titulo: titulo.trim(),
      tipo,
      status,
      starts_at: inicio.toISOString(),
      ends_at: fim.toISOString(),
      local: local.trim() || null,
      descricao: descricao.trim() || null,
    };

    if (!editando) {
      if (responsavel) corpo.owner_user_id = responsavel;
      if (contactId) corpo.contact_id = contactId;
    }

    const resposta = await fetch(
      editando ? `/api/cb/agenda/${reuniao!.id}` : '/api/cb/agenda',
      {
        method: editando ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      },
    );

    setSalvando(false);

    if (!resposta.ok) {
      const dados = (await resposta.json().catch(() => ({}))) as {
        error?: string;
      };
      setErro(dados.error ?? t('erroSalvar'));
      return;
    }

    aoSalvar();
    aoFechar();
  }

  /**
   * Apagar a reunião.
   *
   * ⚠️ Em DOIS cliques, sem `window.confirm`: o diálogo nativo bloqueia a
   * thread e, dentro de um modal, alguns navegadores o suprimem — o operador
   * clicaria em "Apagar" e nada aconteceria. O segundo clique confirma no
   * próprio botão, que passa a dizer o que vai acontecer.
   */
  async function apagar() {
    if (!reuniao) return;

    if (!confirmandoApagar) {
      setConfirmandoApagar(true);
      return;
    }

    setErro(null);
    setApagando(true);

    const resposta = await fetch(`/api/cb/agenda/${reuniao.id}`, {
      method: 'DELETE',
    });

    setApagando(false);

    if (!resposta.ok) {
      const dados = (await resposta.json().catch(() => ({}))) as {
        error?: string;
      };
      setErro(dados.error ?? t('erroApagar'));
      setConfirmandoApagar(false);
      return;
    }

    aoSalvar();
    aoFechar();
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editando ? t('editarReuniao') : t('novaReuniao')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="titulo">{t('campoTitulo')}</Label>
            <Input
              id="titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder={t('tituloPlaceholder')}
              maxLength={200}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="dia">{t('dia')}</Label>
              <Input
                id="dia"
                type="date"
                value={dia}
                onChange={(e) => setDia(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hora">{t('hora')}</Label>
              <Input
                id="hora"
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t('duracao')}</Label>
              <Select
                value={String(duracao)}
                onValueChange={(v) => v && setDuracao(Number(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURACOES.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {t('minutos', { count: m })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('tipo')}</Label>
              <Select value={tipo} onValueChange={(v) => v && setTipo(v as MeetingType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="onboarding">{t('tipoOnboarding')}</SelectItem>
                  <SelectItem value="atualizacao">{t('tipoAtualizacao')}</SelectItem>
                  <SelectItem value="outra">{t('tipoOutra')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ⚠️ O responsável só aparece na criação. Trocar o dono de uma
              reunião existente é mudança de agenda de duas pessoas ao mesmo
              tempo, e a restrição de sobreposição avaliaria o horário na agenda
              do novo dono — recusa que a tela não teria como explicar bem. */}
          {!editando && membros.length > 1 && (
            <div className="space-y-2">
              <Label>{t('responsavel')}</Label>
              <Select value={responsavel} onValueChange={(v) => setResponsavel(v ?? '')}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {membros.find((m) => m.user_id === responsavel)?.full_name ??
                      t('euMesmo')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {membros.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {editando && (
            <div className="space-y-2">
              <Label>{t('situacao')}</Label>
              <Select
                value={status}
                onValueChange={(v) => v && setStatus(v as MeetingStatus)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agendada">{t('statusAgendada')}</SelectItem>
                  <SelectItem value="realizada">{t('statusRealizada')}</SelectItem>
                  <SelectItem value="cancelada">{t('statusCancelada')}</SelectItem>
                  <SelectItem value="falta">{t('statusFalta')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="local">{t('local')}</Label>
            <Input
              id="local"
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              placeholder={t('localPlaceholder')}
              maxLength={500}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="descricao">{t('descricao')}</Label>
            <Textarea
              id="descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={3}
              maxLength={4000}
            />
          </div>

          {erro && (
            <p className="text-sm text-destructive" role="alert">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {/* Apagar fica à ESQUERDA, longe de Salvar: são vizinhos com
              consequências opostas, e a reunião apagada não volta. */}
          {editando ? (
            <Button
              variant="ghost"
              onClick={apagar}
              disabled={salvando || apagando}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {apagando
                ? t('apagando')
                : confirmandoApagar
                  ? t('confirmarApagar')
                  : t('apagar')}
            </Button>
          ) : (
            <span />
          )}

          <div className="flex gap-2">
            <Button variant="ghost" onClick={aoFechar} disabled={salvando || apagando}>
              {t('cancelar')}
            </Button>
            <Button onClick={salvar} disabled={salvando || apagando}>
              {salvando ? t('salvando') : t('salvar')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
