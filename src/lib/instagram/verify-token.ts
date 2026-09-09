// ============================================================
// O verify token do webhook do Instagram — gerado por NÓS e copiado para o
// painel da Meta (a direção inversa da Meta Cloud API, onde o operador
// escolhe e repete no campo). Um valor aleatório por conexão: a rota do
// webhook varre os canais Instagram comparando com o `hub.verify_token`
// que a Meta manda (Fase 3). Só servidor (`node:crypto`).
// ============================================================

import { randomBytes } from 'node:crypto';

export function novoVerifyToken(): string {
  return `ig-${randomBytes(16).toString('hex')}`;
}
