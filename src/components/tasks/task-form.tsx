'use client';

// ============================================================
// O formulário de tarefa (944) — criar, editar, responder e desdobrar.
//
// ⚠️ UM COMPONENTE PARA OS QUATRO, e não quatro telas parecidas. Todos escrevem
// os mesmos campos e chamam a mesma rota; o que muda é o que já vem preenchido
// e o que fica escondido. Em cópias separadas, um campo novo (ou uma validação
// nova) entraria em três e esqueceria a quarta.
//
// ⚠️ RESPONDER NÃO MOSTRA DESTINATÁRIO, de propósito: a resposta volta para
// quem pediu, e é o SERVIDOR que decide isso (ver a rota). Um seletor aqui
// prometeria uma escolha que a rota ignora.
// ============================================================

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useAuth } from '@/hooks/use-auth';
import { useMembros } from '@/hooks/use-membros';
import type { EdicaoDeTarefa, NovaTarefa } from '@/hooks/use-acoes-da-tarefa';
import { memberLabel } from '@/lib/account/members';
import { diaLocal } from '@/lib/tasks/prazo';
import { MAX_TITULO } from '@/lib/tasks/validar';
import type { Task } from '@/types';

export interface TaskFormProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Cliente da tarefa nova. Ignorado quando há `tarefa` ou `tarefaPai`. */
  contactId?: string;
  /** Preenchido = modo edição. */
  tarefa?: Task | null;
  /** Preenchido = nasce a partir desta (resposta ou desdobramento). */
  tarefaPai?: Task | null;
  /** `resposta` esconde o destinatário — o servidor o fixa em quem pediu. */
  tipo?: 'tarefa' | 'resposta';
  criar: (nova: NovaTarefa) => Promise<Task | null>;
  editar: (t: Task, campos: EdicaoDeTarefa) => Promise<void>;
  salvando?: boolean;
}

export function TaskForm({
  open,
  onOpenChange,
  contactId,
  tarefa,
  tarefaPai,
  tipo = 'tarefa',
  criar,
  editar,
  salvando = false,
}: TaskFormProps) {
  const t = useTranslations('Tasks');
  const { user } = useAuth();
  const { membros } = useMembros();

  const editando = !!tarefa;
  const respondendo = tipo === 'resposta';

  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [venceEm, setVenceEm] = useState('');
  const [venceAs, setVenceAs] = useState('');
  const [importante, setImportante] = useState(false);

  // Repõe os campos toda vez que a caixa abre. Sem isto, fechar sem salvar e
  // reabrir para outro cliente traria o rascunho anterior — e a tarefa sairia
  // com o texto errado sobre a pessoa errada.
  // ⚠️ Repor por efeito é o padrão do projeto para formulário em caixa (ver
  // `contact-form`, `custom-fields-manager`, `pipeline-settings`): o Dialog
  // fica montado entre uma abertura e outra, então o estado inicial do
  // `useState` só valeria a primeira vez. O disable é o mesmo que os três usam.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      setTitulo(tarefa?.titulo ?? '');
      setDescricao(tarefa?.descricao ?? '');
      setVenceEm(tarefa?.vence_em ?? diaLocal(new Date()));
      setVenceAs(tarefa?.vence_as?.slice(0, 5) ?? '');
      setImportante(tarefa?.importante ?? false);
    // ⚠️ O DESTINATÁRIO NASCE VAZIO quando há com quem escolher, e é uma
    // decisão sobre erro silencioso: com o próprio usuário no padrão, quem
    // esquece de trocar cria para si mesmo uma tarefa que queria delegar — e o
    // colega nunca fica sabendo que havia algo para ele. Vazio, o formulário
    // não deixa salvar sem escolher. Numa conta de uma pessoa só não há
    // escolha a fazer, então cai nela mesma.
      setResponsavel(
        tarefa?.responsavel_user_id ?? (membros.length <= 1 ? (user?.id ?? '') : ''),
      );
    }
  }, [open, tarefa, membros.length, user?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const podeSalvar =
    !!titulo.trim() &&
    !!venceEm &&
    (respondendo || editando || !!responsavel) &&
    !salvando;

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (!podeSalvar) return;

    if (editando && tarefa) {
      await editar(tarefa, {
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        vence_em: venceEm,
        vence_as: venceAs || null,
        // Só manda o destinatário quando mudou — a rota zera o "lida" a cada
        // troca, e mandar o mesmo id de volta não deveria custar isso.
        ...(responsavel && responsavel !== tarefa.responsavel_user_id
          ? { responsavel_user_id: responsavel }
          : {}),
      });
      onOpenChange(false);
      return;
    }

    const nova = await criar({
      // Com pai, a rota IGNORA o contato do corpo e herda o dele — a cadeia
      // inteira fala do mesmo cliente. Mandamos assim mesmo para o caso sem pai.
      contact_id: tarefaPai?.contact_id ?? contactId,
      responsavel_user_id: respondendo ? undefined : responsavel,
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      vence_em: venceEm,
      vence_as: venceAs || null,
      importante,
      tarefa_pai_id: tarefaPai?.id,
      tipo,
    });
    if (nova) onOpenChange(false);
  }

  const titulo_da_caixa = editando
    ? t('editTask')
    : respondendo
      ? t('replyTask')
      : tarefaPai
        ? t('followUpTask')
        : t('newTask');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {titulo_da_caixa}
          </DialogTitle>
          {tarefaPai ? (
            <DialogDescription className="text-muted-foreground">
              {t('fromTask', { titulo: tarefaPai.titulo })}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <form onSubmit={submeter} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tf-titulo" className="text-muted-foreground">
              {t('fieldTitle')}
            </Label>
            <Input
              id="tf-titulo"
              value={titulo}
              maxLength={MAX_TITULO}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder={t('titlePlaceholder')}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tf-descricao" className="text-muted-foreground">
              {t('fieldDescription')}
            </Label>
            <Textarea
              id="tf-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={3}
              placeholder={t('descriptionPlaceholder')}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          {/* ⚠️ Escondido ao responder: quem recebe é quem pediu, e o servidor
              é que decide. Escondido também numa conta de uma pessoa só, onde
              não há nada a escolher — mesma convenção do seletor de canal. */}
          {!respondendo && membros.length > 1 ? (
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('fieldAssignee')}</Label>
              <Select
                value={responsavel}
                onValueChange={(v) => setResponsavel(v ?? '')}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('assigneePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {membros.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {memberLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="tf-data" className="text-muted-foreground">
                {t('fieldDueDate')}
              </Label>
              <Input
                id="tf-data"
                type="date"
                value={venceEm}
                onChange={(e) => setVenceEm(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tf-hora" className="text-muted-foreground">
                {t('fieldDueTime')}
              </Label>
              <Input
                id="tf-hora"
                type="time"
                value={venceAs}
                onChange={(e) => setVenceAs(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
              {/* A hora é opcional por pedido do operador — a etiqueta diz. */}
              <p className="text-xs text-muted-foreground">{t('dueTimeOptional')}</p>
            </div>
          </div>

          {!editando ? (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={importante}
                onCheckedChange={(v) => setImportante(v === true)}
              />
              {t('fieldImportant')}
            </label>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={salvando}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!podeSalvar}>
              {editando ? t('save') : t('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
