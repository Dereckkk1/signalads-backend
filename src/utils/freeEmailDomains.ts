// Lista de domínios de email gratuitos mais comuns
// Usada para bloquear cadastro de anunciantes/agências com email não-corporativo

export const FREE_EMAIL_DOMAINS: string[] = [
  // Google
  'gmail.com',
  'googlemail.com',

  // Microsoft
  'hotmail.com',
  'hotmail.com.br',
  'outlook.com',
  'outlook.com.br',
  'live.com',
  'msn.com',

  // Yahoo
  'yahoo.com',
  'yahoo.com.br',
  'ymail.com',
  'rocketmail.com',

  // Apple
  'icloud.com',
  'me.com',
  'mac.com',

  // ProtonMail
  'protonmail.com',
  'proton.me',
  'pm.me',

  // AOL
  'aol.com',

  // Zoho
  'zoho.com',
  'zohomail.com',

  // Brasileiros
  'bol.com.br',
  'uol.com.br',
  'terra.com.br',
  'ig.com.br',
  'globo.com',
  'globomail.com',
  'zipmail.com.br',
  'oi.com.br',
  'r7.com',

  // Temporários / Descartáveis
  'mailinator.com',
  'tempmail.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'sharklasers.com',
  'grr.la',
  'guerrillamailblock.com',
  'throwaway.email',
  'temp-mail.org',
  'fakeinbox.com',
  'yopmail.com',
  'yopmail.fr',
  'dispostable.com',
  'trashmail.com',
  'trashmail.net',
  'mailnesia.com',
  'maildrop.cc',
  'discard.email',
  'mailcatch.com',
  'mytemp.email',
  '10minutemail.com',
  'minutemail.com',
  'tempail.com',
  'mohmal.com',
  'getnada.com',
  'emailondeck.com',
  'burnermail.io',
  'inboxkitten.com',

  // Outros provedores gratuitos populares
  'mail.com',
  'email.com',
  'inbox.com',
  'gmx.com',
  'gmx.net',
  'fastmail.com',
  'tutanota.com',
  'tuta.io',
  'mail.ru',
  'yandex.com',
  'rambler.ru',
];

/**
 * Extrai o domínio de um endereço de email
 */
export function getEmailDomain(email: string): string {
  return email.toLowerCase().trim().split('@')[1] || '';
}

/**
 * Verifica se o email pertence a um provedor gratuito (lista hardcoded)
 */
export function isFreeEmailDomain(email: string): boolean {
  const domain = getEmailDomain(email);
  return FREE_EMAIL_DOMAINS.includes(domain);
}
