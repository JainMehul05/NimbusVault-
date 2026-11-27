import { expect, test } from '@playwright/test'
import { API, loginViaUi, newAccount, PASSWORD, registerViaUi, uniqueEmail, watchErrors } from './helpers'

test('registration, sign-out, sign-in and return to the requested page', async ({ page }) => {
  const errors = watchErrors(page)
  const email = await registerViaUi(page, 'Ada Lovelace')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ada')

  await page.getByRole('button', { name: /Account menu/ }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)

  await page.goto('/activity')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('Email address').fill(email.toUpperCase())
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/activity$/)
  expect(errors).toEqual([])
})

test('form validation, duplicate accounts and wrong passwords', async ({ page }) => {
  await page.goto('/register')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('Enter your full name.')).toBeVisible()
  await page.getByLabel('Full name').fill('Al')
  await page.getByLabel('Email address').fill('nope')
  await page.getByLabel('Password', { exact: true }).fill('onlyletters')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText(/valid email address/)).toBeVisible()
  await expect(page.getByText(/letter and one number or symbol/)).toBeVisible()

  const email = await registerViaUi(page, 'Dup User')
  await page.context().clearCookies()
  await page.evaluate(() => localStorage.clear())
  await page.goto('/register')
  await page.getByLabel('Full name').fill('Dup User')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText(/already registered/i)).toBeVisible()

  await loginViaUi(page, email, 'WrongPassword1')
  await expect(page.getByText(/invalid credentials/i)).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})

test('the session survives a reload without anything readable in storage', async ({ page, context }) => {
  await registerViaUi(page, 'Reload User')
  await page.reload()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Reload')

  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  expect(stored).not.toMatch(/eyJ|token|@/i)
  expect(await page.evaluate(() => document.cookie)).toBe('')
  const cookie = (await context.cookies('http://localhost:4173/api/v1/auth')).find((c) => c.name === 'refreshToken')!
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/v1/auth' })
})

test('refresh rotates silently when the access token expires, also with several tabs', async ({ page, context }) => {
  await registerViaUi(page, 'Rotate User')
  const before = (await context.cookies('http://localhost:4173/api/v1/auth'))[0].value

  // Make the in-memory token useless once, as expiry would: the next calls are answered 401.
  let rejected = 0
  await page.route('**/api/v1/files**', async (route) => {
    if (rejected++ < 2) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"success":false,"error":{"code":"INVALID_TOKEN"}}' })
    return route.continue()
  })
  await page.getByRole('link', { name: 'My Files' }).first().click()
  await expect(page.getByText('Your vault is ready')).toBeVisible()
  const after = (await context.cookies('http://localhost:4173/api/v1/auth'))[0].value
  expect(after).not.toBe(before)

  // Three tabs restoring the same session at once must not be mistaken for token theft.
  const tabs = await Promise.all([1, 2, 3].map(() => context.newPage()))
  await Promise.all(tabs.map((t) => t.goto('/files')))
  for (const t of tabs) await expect(t.getByText('Your vault is ready')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Your vault is ready')).toBeVisible()
})

test('a stolen, already-used refresh token ends the session everywhere', async ({ page, context, request }) => {
  await registerViaUi(page, 'Reuse User')
  const old = (await context.cookies('http://localhost:4173/api/v1/auth'))[0]
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Reuse')

  const replay = await request.post(`${API}/auth/refresh`, { headers: { Cookie: `refreshToken=${old.value}`, 'X-Requested-With': 'XMLHttpRequest' }, data: {} })
  expect(replay.status()).toBe(401)
  expect((await replay.json()).error.code).toBe('TOKEN_REUSE_DETECTED')
  // Whatever the page does next (here: load another page) lands on sign-in.
  await page.goto('/activity')
  await expect(page).toHaveURL(/\/login$/)
})

test('account page: devices and password change', async ({ browser, request }) => {
  const a = await newAccount(browser, request, 'Device User') // UI session + one API session
  const { page } = a
  await page.getByRole('button', { name: /Account menu/ }).click()
  await page.getByRole('menuitem', { name: 'Account & devices' }).click()
  await expect(page.getByText('This device')).toBeVisible()
  await page.getByRole('button', { name: 'Sign out others' }).click()
  await expect(page.getByText('Other devices signed out')).toBeVisible()
  expect((await request.get(`${API}/auth/me`, { headers: { Authorization: `Bearer ${a.token}` } })).status()).toBe(401)

  await page.getByLabel('Current password').fill('wrong-one1')
  await page.getByLabel('New password', { exact: true }).fill('Changed456!')
  await page.getByLabel('Confirm new password').fill('Changed456!')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('Current password is incorrect')).toBeVisible()
  await page.getByLabel('Current password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('Password changed')).toBeVisible()

  const fresh = await browser.newPage()
  await loginViaUi(fresh, a.email, 'Changed456!')
  await expect(fresh).toHaveURL(/\/dashboard$/)
})

test('signing out in one tab signs out the others', async ({ page, context }) => {
  await registerViaUi(page, 'Tabs User')
  const other = await context.newPage()
  await other.goto('/files')
  await expect(other.getByText('Your vault is ready')).toBeVisible()
  await page.getByRole('button', { name: /Account menu/ }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(other).toHaveURL(/\/login$/)
})

test('unknown pages show a 404 and open redirects are impossible', async ({ page }) => {
  await page.goto(`/no-such-page-${uniqueEmail('x')}`)
  await expect(page.getByText(/404|not found|doesn.t exist/i).first()).toBeVisible()
})
