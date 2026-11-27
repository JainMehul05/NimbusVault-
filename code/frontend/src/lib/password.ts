/** Mirrors the server's password policy. Returns a message, or null when acceptable. */
export function passwordProblem(pwd: string): string | null {
  if (pwd.length < 8) return 'Use at least 8 characters.'
  if (new TextEncoder().encode(pwd).length > 72) return 'Keep your password under 72 characters.'
  if (!/\p{L}/u.test(pwd) || !/[^\p{L}]/u.test(pwd)) return 'Include at least one letter and one number or symbol.'
  return null
}
