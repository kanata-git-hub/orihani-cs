const directorEmails = new Set(['orihani001@gmail.com', 'kanata840@gmail.com']);

export function isDirectorEmail(email: string | null | undefined): boolean {
  return directorEmails.has(email?.trim().toLowerCase() ?? '');
}
