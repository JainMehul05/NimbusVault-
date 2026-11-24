import { expect, test } from '@playwright/test'
import { readFile } from 'fs/promises'
import { API, bearer, newAccount, rowAction, textFile, uploadViaUi, watchErrors } from './helpers'

test('upload, download, rename, move, delete, restore and purge', async ({ browser, request }) => {
  const { page } = await newAccount(browser, request, 'File User')
  const errors = watchErrors(page)
  await page.goto('/files')
  await uploadViaUi(page, [textFile('notes.txt', 'hello world'), textFile('plan.md', '# Plan')])
  await page.getByRole('button', { name: 'Clear finished uploads' }).click()

  const [download] = await Promise.all([page.waitForEvent('download'), rowAction(page, 'notes.txt', 'Download')])
  expect(download.suggestedFilename()).toBe('notes.txt')
  expect(await readFile(await download.path(), 'utf8')).toBe('hello world')
  await expect(page).toHaveURL(/\/files$/) // downloading never navigates away

  await rowAction(page, 'notes.txt', 'Rename')
  await page.getByRole('dialog').getByLabel('Name').fill('renamed.txt')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('renamed.txt').first()).toBeVisible()

  await page.getByRole('button', { name: 'New folder' }).first().click()
  await page.getByRole('dialog').getByLabel('Folder name').fill('Projects')
  await page.getByRole('dialog').getByRole('button', { name: 'Create folder' }).click()
  await expect(page.getByRole('link', { name: 'Projects' }).first()).toBeVisible()

  await rowAction(page, 'renamed.txt', 'Move to…')
  await page.getByRole('dialog').getByText('Projects').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Move here' }).click()
  await expect(page.getByText('File moved')).toBeVisible()

  await rowAction(page, 'plan.md', 'Delete')
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('File moved to trash')).toBeVisible()

  await page.getByRole('link', { name: 'Trash' }).first().click()
  await page.getByRole('button', { name: 'Restore plan.md' }).click()
  await expect(page.getByText('Trash is empty')).toBeVisible()
  await page.goto('/files')
  await rowAction(page, 'plan.md', 'Delete')
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('File moved to trash')).toBeVisible()
  await page.goto('/trash')
  await page.getByRole('button', { name: 'Permanently delete plan.md' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete forever' }).click()
  await expect(page.getByText('Trash is empty')).toBeVisible()
  expect(errors).toEqual([])
})

test('nested folders: create, browse, breadcrumbs, search, sort, views, delete and restore the tree', async ({ browser, request }) => {
  const { page } = await newAccount(browser, request, 'Folder User')
  await page.goto('/files')
  for (const name of ['Level one', 'Level two', 'Level three']) {
    await page.getByRole('button', { name: 'New folder' }).first().click()
    await page.getByRole('dialog').getByLabel('Folder name').fill(name)
    await page.getByRole('dialog').getByRole('button', { name: 'Create folder' }).click()
    await page.getByRole('link', { name, exact: true }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
  }
  await uploadViaUi(page, [textFile('deep.txt', 'deep file'), textFile('apple.txt', 'a')])
  await page.getByRole('button', { name: 'Clear finished uploads' }).click()

  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
  await expect(crumbs).toContainText('Level one')
  await page.getByLabel('Sort files').selectOption('filename:asc')
  await expect(page.locator('body')).toContainText('apple.txt')
  await page.getByRole('button', { name: 'Grid view' }).click()
  await expect(page.getByText('deep.txt').first()).toBeVisible()
  await page.getByRole('button', { name: 'List view' }).click()

  await page.goto('/files')
  await page.getByLabel('Search files and folders').fill('deep')
  await expect(page.getByText('deep.txt').first()).toBeVisible()
  await page.getByLabel('Search files and folders').fill('zzz-nothing')
  await expect(page.getByText(/No results for/)).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()

  await rowAction(page, 'folder Level one', 'Delete')
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('Folder moved to trash')).toBeVisible()
  await expect(page.getByText('0 B of 5 GB used').first()).toBeVisible()
  await page.goto('/trash')
  await expect(page.getByText('2 files')).toBeVisible()
  await page.getByRole('button', { name: 'Restore Level one' }).click()
  await expect(page.getByText('Trash is empty')).toBeVisible()
  await page.goto('/files')
  await expect(page.getByRole('link', { name: 'Level one', exact: true }).first()).toBeVisible()
})

test('failed and oversized uploads are reported and do not consume storage', async ({ browser, request }) => {
  const a = await newAccount(browser, request, 'Quota User')
  const { page } = a
  await page.goto('/files')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'virus.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') })
  await expect(page.getByText('Unsupported file type')).toBeVisible()
  const storage = async () => (await (await request.get(`${API}/files/storage/info`, { headers: bearer(a) })).json()).data.used
  expect(await storage()).toBe('0')

  // A presigned upload that never arrives is refunded when it is cancelled.
  const begun = await (await request.post(`${API}/files/presigned-upload`, { headers: bearer(a), data: { filename: 'p.txt', contentType: 'text/plain', sizeBytes: 5 } })).json()
  expect(await storage()).toBe('5')
  expect((await request.post(`${API}/files/${begun.data.fileId}/complete`, { headers: bearer(a) })).status()).toBe(409)
  await request.delete(`${API}/files/${begun.data.fileId}/upload`, { headers: bearer(a) })
  expect(await storage()).toBe('0')

  // And one that does arrive becomes a normal file in the UI.
  const ok = await (await request.post(`${API}/files/presigned-upload`, { headers: bearer(a), data: { filename: 'direct.txt', contentType: 'text/plain', sizeBytes: 5 } })).json()
  expect((await fetch(ok.data.url, { method: 'PUT', headers: ok.data.headers, body: 'hello' })).status).toBe(200)
  expect((await request.post(`${API}/files/${ok.data.fileId}/complete`, { headers: bearer(a) })).status()).toBe(200)
  await page.reload()
  await expect(page.getByText('direct.txt').first()).toBeVisible()
})

test('a server outage shows an error with retry instead of an empty vault', async ({ browser, request }) => {
  const { page } = await newAccount(browser, request, 'Outage User')
  await page.route('**/api/v1/files?**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"success":false,"message":"Internal server error"}' }))
  await page.goto('/files')
  await expect(page.getByText('Couldn’t load this folder')).toBeVisible()
  await page.unroute('**/api/v1/files?**')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText('Your vault is ready')).toBeVisible()
})
