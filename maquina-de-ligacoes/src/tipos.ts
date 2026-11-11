/** Os tipos que o orquestrador, o servidor e os avisos compartilham. */

/** `carregando` cobre tudo que não é QR nem a tela conectada (abrindo, reconectando). */
export type EstadoDoWhatsapp = 'carregando' | 'qr' | 'conectado'

/** O que a tela do WhatsApp mostra da chamada agora. */
export type FaseDaChamada =
  | { fase: 'nenhuma' }
  /** Chamada RECEBIDA tocando; `quem` é o nome ou o número que a tela mostra. */
  | { fase: 'tocando'; quem: string }
  /** Chamada FEITA tocando no cliente. */
  | { fase: 'chamando' }
  | { fase: 'em_curso' }
  /** A tela de fim (ex.: "Sem resposta", "Ocupado"); `aviso` é o texto dela. */
  | { fase: 'encerrada'; aviso: string }

export type MotivoDoFim =
  | 'cliente_desligou'
  | 'atendente_desligou'
  | 'nao_atendida'
  | 'ocupado'
  | 'sem_whatsapp'
  | 'teto_30min'
  | 'ponte_caiu'
  | 'falhou'

export interface ServidorIce {
  urls: string | string[]
  username?: string
  credential?: string
}

export interface PedidoDeLigacao {
  /** O id da ligação no CRM. */
  ligacao: string
  /** O número como o WhatsApp o conhece (o CRM resolve o nono dígito). */
  numero: string
  /** A oferta WebRTC do navegador do atendente, com os candidatos. */
  oferta: string
  ice: ServidorIce[]
}

export type Recusa =
  | 'ocupada'
  | 'nada_tocando'
  | 'outra_chamada'
  | 'nao_encontrada'
  | 'whatsapp_desconectado'
  | 'oferta_invalida'
  | 'falhou'

export type Resultado = { ok: true; resposta?: string } | { ok: false; recusa: Recusa }

export interface EstadoPublico {
  whatsapp: EstadoDoWhatsapp
  ligacao: null | {
    id: string
    direcao: 'feita' | 'recebida'
    /** `encerrando`: a gravação e a ponte da ligação ainda fecham; a linha segue ocupada. */
    fase: 'preparando' | 'chamando' | 'em_ligacao' | 'encerrando'
    desde: string
    atendida_em: string | null
  }
  chrome: string
}

/** Os avisos ao CRM. Repetir um não estraga nada: o CRM grava cada informação uma vez só. */
export type Aviso =
  | { tipo: 'sinal'; whatsapp: EstadoDoWhatsapp; ligacao: string | null; chrome: string }
  | { tipo: 'chamando'; ligacao: string }
  | { tipo: 'atendida'; ligacao: string; atendida_em: string }
  | {
      tipo: 'encerrada'
      ligacao: string
      motivo: MotivoDoFim
      atendida_em: string | null
      duracao_seg: number | null
    }
