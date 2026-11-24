import { expect, test } from '@playwright/test'
import { mkdirSync } from 'fs'
import { apiFolder, apiShare, apiUpload, API, bearer, newAccount, noOverflow, watchErrors } from './helpers'

const VIEWPORTS = { mobile: { width: 390, height: 844 }, tablet: { width: 768, height: 1024 }, desktop: { width: 1440, height: 900 } }
const OUT = process.env.E2E_SCREENSHOTS

for (const [label, viewport] of Object.entries(VIEWPORTS)) {
  test(`every page fits at ${viewport.width}px without errors`, async ({ browser, request }) => {
    test.setTimeout(180_000)
    const a = await newAccount(browser, request, 'Responsive User')
    const b = await newAccount(browser, request, 'A Rather Long Collaborator Name For Layout')
    const folder = await apiFolder(request, a, 'A folder with quite a long name that should truncate nicely')
    const file = await apiUpload(request, a, 'a-very-long-file-name-that-could-easily-overflow-a-narrow-phone-screen-if-not-truncated.txt', 'content')
    await apiUpload(request, a, 'in-folder.md', '# hi', folder)
    await apiShare(request, a, 'FILE', file, b, 'EDITOR')
    await apiShare(request, b, 'FILE', await apiUpload(request, b, 'from-b.txt', 'x'), a, 'VIEWER')
    const sharedFolder = await apiFolder(request, b, 'Shared folder')
    await apiShare(request, b, 'FOLDER', sharedFolder, a, 'EDITOR')
    const trashed = await apiUpload(request, a, 'old-document-in-the-trash.txt', 'x')
    await request.delete(`${API}/files/${trashed}`, { headers: bearer(a) })
    const link = (await (await request.post(`${API}/share-links/protected`, { headers: bearer(a), data: { fileId: file, permission: 'DOWNLOAD' } })).json()).data.token

    const { page } = a
    await page.setViewportSize(viewport)
    const errors = watchErrors(page)
    const pages: Record<string, string> = {
      dashboard: '/dashboard', files: '/files', folder: `/files/${folder}`, shared: '/shared-with-me', 'shared-folder': `/shared-with-me/folders/${sharedFolder}`,
      ask: '/ask', activity: '/activity', trash: '/trash', account: '/account', 'missing-folder': '/files/00000000-0000-4000-8000-000000000000', notfound: '/nope', share: `/share/${link}`, landing: '/',
    }
    if (OUT) mkdirSync(OUT, { recursive: true })
    for (const [name, path] of Object.entries(pages)) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('h1').first()).toBeVisible()
      await noOverflow(page)
      if (OUT) await page.screenshot({ path: `${OUT}/${label}-${name}.png`, fullPage: name === 'landing' })
    }

    // Dialogs and navigation at this size.
    await page.goto('/files')
    await page.getByRole('button', { name: /^Actions for a-very-long/ }).first().click()
    await page.getByRole('menuitem', { name: 'Share with people' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await noOverflow(page)
    if (OUT) await page.screenshot({ path: `${OUT}/${label}-share-dialog.png` })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    if (viewport.width < 1024) {
      await page.getByRole('button', { name: 'Open navigation' }).click()
      await page.getByRole('link', { name: 'Trash' }).click()
      await expect(page).toHaveURL(/\/trash$/)
    }
    expect(errors).toEqual([])

    const anon = await (await browser.newContext({ viewport })).newPage()
    for (const name of ['login', 'register']) {
      await anon.goto(`/${name}`)
      await expect(anon.locator('h1').first()).toBeVisible()
      await noOverflow(anon)
      if (OUT) await anon.screenshot({ path: `${OUT}/${label}-${name}.png` })
    }
  })
}

test('landing page: every link and button works', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const cta = page.getByRole('link', { name: 'Create your free vault' }).first()
  expect(await cta.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 81, 0)')
  const hrefs = await page.locator('a[href]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href')!))])
  expect(hrefs.length).toBeGreaterThan(6)
  for (const href of hrefs) {
    if (href.startsWith('#')) expect(await page.locator(`[id="${href.slice(1)}"]`).count(), href).toBe(1)
    else if (/^https:\/\/github\.com\//.test(href)) {
      const external = page.locator(`a[href="${href}"]`).first()
      expect(await external.getAttribute('rel')).toMatch(/noreferrer|noopener/)
    } else if (href.startsWith('/')) {
      await page.goto(href)
      await expect(page.locator('h1').first()).toBeVisible()
      await expect(page.getByText(/^404$/)).toHaveCount(0)
      await page.goto('/')
    } else throw new Error(`Unexpected external link ${href}`)
  }
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  let toggled = 0
  for (const button of await page.locator('main button:visible').all()) {
    if (await button.getAttribute('aria-expanded') !== null) {
      const before = await button.getAttribute('aria-expanded')
      await button.click()
      expect(await button.getAttribute('aria-expanded')).not.toBe(before)
      toggled++
    }
  }
  expect(toggled).toBeGreaterThan(2)
  expect(errors).toEqual([])
})
