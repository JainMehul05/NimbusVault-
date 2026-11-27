import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'

export const API = 'http://localhost:3000/api/v1'
export const PASSWORD = 'Password123!'

let counter = 0
export const uniqueEmail = (name: string) => `${name.toLowerCase().replace(/\W/g, '')}-${Date.now()}-${++counter}@e2e.test`

export interface Account {
  page: Page
  context: BrowserContext
  name: string
  email: string
  token: string
  id: string
}

/** Collects anything the browser reports as an error, so a test can assert there was none. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    // The browser logs every non-2xx response; those are asserted through the UI instead.
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`)
  })
  return errors
}

export async function registerViaUi(page: Page, name: string, email = uniqueEmail(name)): Promise<string> {
  await page.goto('/register')
  await page.getByLabel('Full name').fill(name)
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  return email
}

export async function loginViaUi(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
}

/** A separate browser profile with its own signed-in user, plus an API token for set-up. */
export async function newAccount(browser: Browser, request: APIRequestContext, name: string): Promise<Account> {
  const context = await browser.newContext()
  const page = await context.newPage()
  const email = await registerViaUi(page, name)
  const login = await request.post(`${API}/auth/login`, { data: { email, password: PASSWORD } })
  const { data } = await login.json()
  return { page, context, name, email, token: data.tokens.accessToken, id: data.user.id }
}

export const bearer = (a: Account) => ({ Authorization: `Bearer ${a.token}` })

export const textFile = (name: string, content: string) => ({ name, mimeType: name.endsWith('.md') ? 'text/markdown' : 'text/plain', buffer: Buffer.from(content) })

export async function uploadViaUi(page: Page, files: ReturnType<typeof textFile>[]) {
  await page.locator('input[type=file]').first().setInputFiles(files)
  for (const f of files) await expect(page.getByRole('region', { name: 'Uploads' }).getByText(f.name)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Uploads' }).getByRole('heading')).toHaveText(/upload(s)? complete/)
}

export async function apiUpload(request: APIRequestContext, a: Account, name: string, content: string, folderId?: string): Promise<string> {
  const res = await request.post(`${API}/files`, { headers: bearer(a), multipart: { file: textFile(name, content), ...(folderId ? { folderId } : {}) } })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).data.id
}

export async function apiFolder(request: APIRequestContext, a: Account, name: string, parentFolderId: string | null = null): Promise<string> {
  const res = await request.post(`${API}/folders`, { headers: bearer(a), data: { name, parentFolderId } })
  expect(res.status()).toBe(201)
  return (await res.json()).data.id
}

export const apiShare = (request: APIRequestContext, owner: Account, resourceType: 'FILE' | 'FOLDER', resourceId: string, grantee: Account, level: 'VIEWER' | 'EDITOR') =>
  request.post(`${API}/sharing`, { headers: bearer(owner), data: { resourceType, resourceId, granteeEmail: grantee.email, level } })

/** Opens a row's ⋯ menu and picks an item. */
export async function rowAction(page: Page, name: string, action: string) {
  await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).first().click()
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}

export async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, `horizontal overflow at ${page.url()}`).toBeLessThanOrEqual(1)
}
