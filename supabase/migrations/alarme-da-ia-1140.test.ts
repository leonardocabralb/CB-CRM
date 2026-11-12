import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { MOTIVOS_DA_FALHA_DA_IA } from '@/lib/ia-agentes/alarme-da-ia'
import { TIPO_DO_ALARME_DA_IA } from '@/lib/notifications/aviso-da-ia'
import type { NotificationType } from '@/types'

import en from '../../messages/en.json'
import pt from '../../messages/pt-BR.json'

// ============================================================
// Pinos da 1140 (o alarme quando a IA para de responder): o CHECK do sino em
// paridade com o `NotificationType`, a tabela do episódio FECHADA ao
// navegador, a decisão SOB TRAVA e o contrato do RPC que `alarme-da-ia.ts`
// chama. O comportamento da função é provado pela conferência da própria
// migration (o ciclo abre → conta → lembra → reabre) e no replay local.
// ============================================================

const SQL = fs.readFileSync(path.join(__dirname, '1140_cb_alarme_da_ia.sql'), 'utf8')
const ALARME = fs.readFileSync(path.join(__dirname, '../../src/lib/ia-agentes/alarme-da-ia.ts'), 'utf8')

/** Os literais de uma lista `IN ( … )` (ou de uma união de tipos). */
const literais = (trecho: string) => [...trecho.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])

describe('1140 — o CHECK do sino', () => {
  const check = literais(SQL.slice(SQL.indexOf('ADD CONSTRAINT notifications_type_check'), SQL.indexOf('));')))

  it('o CHECK reescrito mantém os sete tipos de antes e acrescenta os dois do alarme', () => {
    expect(check).toEqual([
      'conversation_assigned',
      'note_mention',
      'note_reply',
      'task_assigned',
      'task_reply',
      'whatsapp_alert',
      'ia_transferiu',
      'ia_falhou',
      'ia_voltou',
    ])
    // A conferência cobra que nenhum antigo se perdeu.
    for (const antigo of check.slice(0, 7)) expect(SQL).toContain(`NOT LIKE '%${antigo}%'`)
  })

  it('a lista do CHECK é a MESMA do tipo TS (tipo novo sem migration não compila aqui)', () => {
    // Record exaustivo: um `NotificationType` novo sem entrada reprova o
    // typecheck. Vive no pino da migration MAIS NOVA que reescreve o CHECK.
    const doTs: Record<NotificationType, true> = {
      conversation_assigned: true,
      note_mention: true,
      note_reply: true,
      task_assigned: true,
      task_reply: true,
      whatsapp_alert: true,
      ia_transferiu: true,
      ia_falhou: true,
      ia_voltou: true,
    }
    expect(new Set(check)).toEqual(new Set(Object.keys(doTs)))
    expect(check).toContain(TIPO_DO_ALARME_DA_IA)
  })
})

describe('1140 — cb_ia_alarmes', () => {
  it('UM episódio por (conta, provedor), com os provedores que o dicionário nomeia', () => {
    expect(SQL).toMatch(/PRIMARY KEY \(account_id, provedor\)/)
    const provedores = literais(SQL.match(/cb_ia_alarmes_provedor_ck CHECK \(provedor IN \(([^)]*)\)\)/)?.[1] ?? '')
    expect(provedores.sort()).toEqual(['anthropic', 'gemini', 'openai'])
    // O título do alarme monta `provedor.<p>`: a chave existe nos DOIS dicionários.
    for (const dic of [pt, en]) {
      expect(Object.keys(dic.IaAgentes.alarme.provedor).sort()).toEqual(provedores)
    }
  })

  it('FECHADA ao navegador: RLS ligada, nenhuma policy, nada para anon/authenticated, tudo para o service_role', () => {
    expect(SQL).toMatch(/ALTER TABLE public\.cb_ia_alarmes ENABLE ROW LEVEL SECURITY;/)
    expect(SQL).not.toMatch(/CREATE POLICY/)
    expect(SQL).toMatch(/REVOKE ALL ON TABLE public\.cb_ia_alarmes FROM PUBLIC, anon, authenticated;/)
    expect(SQL).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.cb_ia_alarmes TO service_role;/)
  })

  it('a conta apagada leva o episódio junto', () => {
    expect(SQL).toMatch(/account_id\s+uuid\s+NOT NULL REFERENCES public\.accounts\(id\) ON DELETE CASCADE/)
  })
})

describe('1140 — cb_ia_registrar_falha', () => {
  const corpo = SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION public.cb_ia_registrar_falha'), SQL.indexOf('$$;'))

  it('decide SOB TRAVA da linha; o INSERT que perde a corrida (23505) relê, travado — dois processos não abrem dois avisos', () => {
    expect(corpo).toMatch(/FOR UPDATE;/)
    expect(corpo).toMatch(/EXCEPTION WHEN unique_violation THEN/)
    expect(corpo).toMatch(/LOOP[\s\S]*END LOOP;/)
  })

  it('as três respostas: abriu (1ª falha ou depois de normalizado), continua (prazo vencido), nada', () => {
    expect(corpo.match(/'acao', 'abriu'/g)).toHaveLength(2)
    expect(corpo).toMatch(/ELSIF v\.normalizou_em IS NOT NULL THEN/)
    expect(corpo).toMatch(/ELSIF v\.ultimo_aviso_em <= now\(\) - make_interval\(mins => p_lembrar_apos_min\) THEN/)
    expect(corpo).toMatch(/'acao', 'continua', 'desde', v\.desde/)
    expect(corpo).toMatch(/'acao', 'nada'/)
    // Só o lembrete e a abertura carimbam o aviso; o "nada" só conta.
    const ramoNada = corpo.slice(corpo.indexOf('ELSE'), corpo.indexOf("'acao', 'nada'"))
    expect(ramoNada).not.toMatch(/ultimo_aviso_em/)
  })

  it('SECURITY INVOKER, fechada ao navegador e aberta ao service_role (o turno roda com ele)', () => {
    expect(corpo).toMatch(/SECURITY INVOKER/)
    expect(SQL).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.cb_ia_registrar_falha\(uuid, text, text, integer\) FROM PUBLIC, anon, authenticated;/,
    )
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.cb_ia_registrar_falha\(uuid, text, text, integer\) TO service_role;/)
  })

  it('o RPC do app manda os parâmetros com os nomes da função', () => {
    for (const p of ['p_conta', 'p_provedor', 'p_motivo', 'p_lembrar_apos_min']) {
      expect(corpo).toContain(p)
      expect(ALARME).toMatch(new RegExp(`${p}: `))
    }
  })

  it('a conferência CHAMA a função num subbloco desfeito pelo SQLSTATE próprio (nunca WHEN OTHERS)', () => {
    expect(SQL).toMatch(/WHEN SQLSTATE 'P1140' THEN NULL;/)
    expect(SQL).not.toMatch(/WHEN OTHERS THEN/)
    expect(SQL).toMatch(/RAISE NOTICE '1140: banco sem conta/)
  })
})

describe('1140 — os textos montados', () => {
  it('todo motivo e todo título têm texto nos DOIS dicionários', () => {
    for (const dic of [pt, en]) {
      const alarme = dic.IaAgentes.alarme
      expect(Object.keys(alarme.motivo).sort()).toEqual([...MOTIVOS_DA_FALHA_DA_IA].sort())
      expect(Object.keys(alarme.titulo).sort()).toEqual(['abriu', 'continua', 'voltou'])
      expect(Object.keys(alarme.corpo).sort()).toEqual(['desde', 'voltou'])
      expect(typeof dic.AvisoDaIaNaTela.verEmAtraso).toBe('string')
    }
  })
})
