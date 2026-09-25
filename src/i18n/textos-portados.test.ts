import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ============================================================
// Fase 10 do plano do merge do upstream: textos que apareciam em INGLÊS
// FIXO na tela e passaram a sair do dicionário. As traduções já existiam
// (vieram do #578 do original, pelo merge #259) e estavam órfãs — ninguém
// as pedia. Um merge que traga a versão crua de um destes arquivos
// devolveria o inglês sem conflito nenhum; este pino reprova.
// ============================================================

const SRC = path.join(__dirname, '..')
const ler = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8')

const PROIBIDOS: Record<string, string[]> = {
  'components/inbox/message-thread.tsx': [
    'return "You"',
    '? t("me")',
    'Failed to send: ${',
    'Failed to send template: ${',
    'Wait for the message to finish sending',
    'Reaction failed: ${',
    'nomeDoContato(contact, "Customer")',
    ': "network error"',
  ],
  'components/inbox/message-composer.tsx': [
    "AI isn't set up yet",
    "Couldn't draft a reply.",
    "The assistant didn't return a reply.",
    "Couldn't reach the AI assistant.",
    'Recording is too long',
    "Voice recording isn't supported",
    'Microphone access denied',
    '"Upload failed."',
    '} MB — ${kind} limit is',
    // Fase 10d: a falha da interativa sai pelo `codigo` (mensagemDaInterativa).
    'toast.error(result.error)',
    // e a do upload passa por `mensagemDoUpload` (o "Not signed in." em inglês).
    'err instanceof Error ? err.message : t("uploadFailed")',
  ],
  'app/(dashboard)/automations/page.tsx': ['aria-label="active"', 'aria-label="Open menu"', 'Failed to load automations'],
  'components/settings/invite-member-dialog.tsx': ['Could not reach the server', 'Failed to create invitation'],
  'components/contacts/contact-detail-view.tsx': ['Failed to send template: ${', ": 'network error'"],
  // Fase 10c
  'components/flows/flow-editor-state.tsx': ['Save failed', 'Status update failed', 'Delete failed'],
  'app/(dashboard)/contacts/page.tsx': ['`Filter by ${', '`Remove ${', '`Select ${'],
  'lib/presence.ts': ['"just now"', '} minutes ago`', '"a while ago"', '"Online — active now"', 'last seen ${'],
  'app/(dashboard)/broadcasts/[id]/page.tsx': ["'Unknown'", "'Unknown error'"],
  'lib/dashboard/queries.ts': ["'Unknown'", 'New message from', 'New contact: ${', '`Deal "', '`Broadcast "', '`Automation "', "'a contact'"],
  'components/contacts/import-modal.tsx': [' more)`'],
  // Fase 10d
  'components/interactive/interactive-builder.tsx': ['{validation.error}'],
  'components/settings/acervo-manager.tsx': ["err instanceof Error ? err.message : t('uploadError')"],
  'components/settings/template-manager.tsx': ['alt="Header sample"', "err instanceof Error ? err.message : t('toastUploadFailed')"],
  'components/flows/forms/node-config-form.tsx': ['err instanceof Error ? err.message : t("uploadFailed")'],
  'components/automations/automation-builder.tsx': ['err instanceof Error ? err.message : String(err)'],
}

describe('textos portados para o dicionário (Fase 10)', () => {
  for (const [arquivo, textos] of Object.entries(PROIBIDOS)) {
    it(`${arquivo} não volta a ter inglês fixo`, () => {
      const fonte = ler(arquivo)
      expect(textos.filter((t) => fonte.includes(t))).toEqual([])
    })
  }

  // Fase 10d: `gateReason` virou id TIPADO (`AcaoBloqueada`), traduzido no
  // GatedButton. Os oito textos em inglês que os call sites passavam —
  // "create broadcasts", "delete broadcasts", "create automations", "create
  // flows", "create pipelines", "create deals", "add or import contacts",
  // "send messages" — viravam "seu papel não permite create broadcasts". O
  // tipo já recusa frase; este pino pega também o literal DENTRO de chaves —
  // `{"create broadcasts" as AcaoBloqueada}` compila — e deixa passar a
  // expressão legítima (`{pode ? "createFlows" : "createDeals"}`).
  const FRASE_NO_GATE = /gateReason=\{?\s*["'`][^"'`]*\s[^"'`]*["'`]/g
  it('nenhum `gateReason` é frase (com espaço) em nenhum arquivo', () => {
    const achados: string[] = []
    const varre = (dir: string) => {
      for (const nome of fs.readdirSync(dir)) {
        const c = path.join(dir, nome)
        if (fs.statSync(c).isDirectory()) varre(c)
        else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)) {
          for (const m of fs.readFileSync(c, 'utf8').matchAll(FRASE_NO_GATE))
            achados.push(`${path.relative(SRC, c)}: ${m[0]}`)
        }
      }
    }
    varre(SRC)
    expect(achados).toEqual([])
  })

  it('o pino do gateReason pega o contorno com `as` e deixa passar a expressão legítima', () => {
    const re = new RegExp(FRASE_NO_GATE.source)
    expect(re.test('gateReason="create broadcasts"')).toBe(true)
    expect(re.test('gateReason={"create broadcasts" as AcaoBloqueada}')).toBe(true)
    expect(re.test('gateReason={`create broadcasts`}')).toBe(true)
    expect(re.test('gateReason="createBroadcasts"')).toBe(false)
    expect(re.test('gateReason={pode ? "createFlows" : "createDeals"}')).toBe(false)
  })

  it('o plural do "N destinatários falharam" e o rótulo das notificações flutuantes', () => {
    for (const arq of ['en.json', 'pt-BR.json']) {
      const d = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'messages', arq), 'utf8'))
      expect(d.Broadcasts.detail.resumeHint, arq).toMatch(/\{count, plural,/)
      expect(d.Broadcasts.detail.resumeStalledHint, arq).toMatch(/\{count, plural,/)
    }
    // Sem a prop, o leitor de tela anuncia "Notifications alt+T" em inglês.
    expect(ler('components/themed-toaster.tsx')).toMatch(/containerAriaLabel=\{t\("rotulo"\)\}/)
  })

  it('título em JSX que era texto fixo (Funil do disparo, Pré-visualização da interativa)', () => {
    expect(ler('app/(dashboard)/broadcasts/[id]/page.tsx')).not.toMatch(/>\s*Funnel\s*</);
    expect(ler('components/interactive/interactive-builder.tsx')).not.toMatch(/^\s*Preview\s*$/m);
  });

  // O next-intl NÃO lê o sufixo `_plural` (é convenção do i18next): as
  // chaves `Contacts.importModal.*_plural` nunca eram pedidas e a tela saía
  // sempre no singular ("Importar 6 contato"). O plural mora na chave-base,
  // em ICU.
  describe('plural do import de contatos', () => {
    const dic = (arq: string) =>
      JSON.parse(fs.readFileSync(path.join(SRC, '..', 'messages', arq), 'utf8')) as Record<string, unknown>;
    const BASES = [
      'rowsReady', 'previewTags', 'moreRows', 'resultTags', 'importBtn',
      'toastImported', 'toastTagsAssigned', 'toastSkipped', 'toastFailed',
    ];
    for (const arq of ['en.json', 'pt-BR.json']) {
      it(`${arq}: a chave-base é plural ICU e não sobra chave \`_plural\``, () => {
        const modal = (dic(arq).Contacts as Record<string, Record<string, string>>).importModal;
        for (const b of BASES) expect(modal[b], b).toMatch(/\{\w+, plural,/);
        const sufixos: string[] = [];
        const varre = (o: unknown, caminho: string) => {
          if (!o || typeof o !== 'object') return;
          for (const [k, v] of Object.entries(o)) {
            if (k.endsWith('_plural')) sufixos.push(`${caminho}${k}`);
            varre(v, `${caminho}${k}.`);
          }
        };
        varre(dic(arq), '');
        expect(sufixos).toEqual([]);
      });
    }
  });

  it('a lista de automações escreve o gatilho pela chave do construtor, nunca pelo `label` do TRIGGER_META', () => {
    const fonte = ler('app/(dashboard)/automations/page.tsx')
    expect(fonte).toMatch(/useTranslations\("Automations\.builder\.triggers"\)/)
    expect(fonte).toMatch(/tGatilhos\(`\$\{automation\.trigger_type\}\.label`/)
  })
})
